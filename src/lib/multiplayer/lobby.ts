// Multiplayer lobby (M4 stage 2). Pure logic only: the lobby lives on the HOST (its setup-screen seat configs), friends see a filtered copy
// (LobbyMessage, published over the normal relay channel) and send intents (lobby_take_seat / lobby_leave_seat / lobby_set_deck) that the host
// validates here and applies to its configs. The host hook is components/game/useMpLobby.ts; the guest UI is components/LobbyScreen.tsx.
//
// A friend's seat is a SeatConfig with `remoteSlot`: REMOTE_UNASSIGNED = open for a friend, a real slot id ("guest-1") = claimed by that guest.
import { z } from "zod";
import type { GuestInfo, SlotId } from "./protocol";
import { REMOTE_UNASSIGNED, activeSeats } from "./seatMap";

export const LOBBY_VERSION = 1;
export const LOBBY_MAX_DECKLIST_CHARS = 20_000;
export const LOBBY_MAX_NAME_CHARS = 60;
export const LOBBY_MAX_COMMANDER_CHARS = 120;
export const LOBBY_MAX_HOST_DECKS = 300;

export type LobbyDeckStatus = "empty" | "building" | "ready" | "error";

/** The slice of the host's SeatConfig (components/DeckSetup.tsx) the lobby reads and writes. */
export interface LobbyConfig {
  seatId: string;
  name: string;
  kind: "human" | "agent";
  remoteSlot?: string;
  /** Nobody plays this seat (host chose "Empty"); it is not in the game and friends never see it. */
  empty?: boolean;
  mode: "commander" | "decklist";
  commander: string;
  deckList: string;
  deck?: { validation: { legal: boolean; errors: string[]; warnings: string[] } };
  status: "empty" | "building" | "ready" | "error";
  message: string;
  activity: string[];
}

export interface HostDeckSummary {
  id: string;
  label: string;
  commander: string;
}

export interface LobbySeatView {
  seatId: string;
  label: string;
  /** agent = AI seat, open = a friend may take it, friend = taken, host = the host's own seat. */
  kind: "agent" | "open" | "friend" | "host";
  takenBy?: string;
  connected?: boolean;
  you: boolean;
  deck?: { status: LobbyDeckStatus; name?: string; commander?: string; message?: string; errors: string[]; warnings: string[] };
}

export interface LobbyMessage {
  kind: "lobby";
  v: typeof LOBBY_VERSION;
  rev: number;
  hostName: string;
  seats: LobbySeatView[];
  /** Names (+ commander) of the decks saved on the host machine. */
  hostDecks: HostDeckSummary[];
  /** Seat this guest holds, if any. */
  yourSeatId?: string;
  /** Last problem with this guest's request (taken seat, bad deck ...). */
  notice?: string;
}

export const isRemoteConfig = (c: Pick<LobbyConfig, "remoteSlot">) => c.remoteSlot !== undefined;
export const isOpenConfig = (c: Pick<LobbyConfig, "remoteSlot">) => c.remoteSlot === REMOTE_UNASSIGNED;
export const seatOfSlot = <T extends Pick<LobbyConfig, "remoteSlot">>(configs: T[], slot: SlotId): T | undefined => configs.find((c) => c.remoteSlot === slot);

/** A deck counts only once it has been through the host's validation and is legal. */
export function deckReady(c: Pick<LobbyConfig, "deck" | "status">): boolean {
  return c.status !== "building" && Boolean(c.deck?.validation.legal) && c.deck!.validation.errors.length === 0;
}

// ---------- intents (guest -> host) ----------

const SeatId = z.string().min(1).max(64);
const SavedDeckRef = z.object({ source: z.literal("saved"), id: z.string().min(1).max(300) });
const NewDeck = z.object({
  source: z.literal("new"),
  name: z.string().trim().min(1).max(LOBBY_MAX_NAME_CHARS),
  commander: z.string().trim().max(LOBBY_MAX_COMMANDER_CHARS).default(""),
  deckList: z.string().min(1).max(LOBBY_MAX_DECKLIST_CHARS)
});
export const DeckChoiceSchema = z.discriminatedUnion("source", [SavedDeckRef, NewDeck]);
export type DeckChoice = z.infer<typeof DeckChoiceSchema>;

export type LobbyIntent = { type: "take_seat"; seatId: string } | { type: "leave_seat" } | { type: "set_deck"; deck: DeckChoice };

export const LOBBY_INTENT_NAMES = ["lobby_take_seat", "lobby_leave_seat", "lobby_set_deck"] as const;
export const isLobbyIntentName = (name: string) => (LOBBY_INTENT_NAMES as readonly string[]).includes(name);

/** Whitelist + validation of a relayed intent. Never throws; anything not understood is an error (the guest is untrusted). */
export function parseLobbyIntent(name: string, args: unknown[]): { ok: true; intent: LobbyIntent } | { ok: false; error: string } {
  const bad = { ok: false as const, error: "That request was not understood." };
  try {
    if (name === "lobby_take_seat") {
      const seatId = SeatId.safeParse(args[0]);
      return seatId.success && args.length === 1 ? { ok: true, intent: { type: "take_seat", seatId: seatId.data } } : bad;
    }
    if (name === "lobby_leave_seat") return args.length === 0 ? { ok: true, intent: { type: "leave_seat" } } : bad;
    if (name === "lobby_set_deck") {
      const deck = DeckChoiceSchema.safeParse(args[0]);
      if (!deck.success || args.length !== 1) return { ok: false, error: "The deck was not accepted (check the name, commander and list size)." };
      return { ok: true, intent: { type: "set_deck", deck: deck.data } };
    }
  } catch {
    /* fall through */
  }
  return bad;
}

/** The "Commander: X" line of a pasted list, if any. */
export function commanderFromList(deckList: string): string {
  const m = /^\s*commander\s*:\s*(.+?)\s*$/im.exec(deckList);
  return m ? m[1] : "";
}

/** Turns a deck choice into what the setup form's validation takes (commander + deck list), looking saved decks up in the host's library. */
export function resolveDeckChoice(choice: DeckChoice, library: { id: string; label: string; commander: string; deckList: string }[]): { ok: true; name: string; commander: string; deckList: string } | { ok: false; error: string } {
  if (choice.source === "saved") {
    const saved = library.find((d) => d.id === choice.id);
    return saved ? { ok: true, name: saved.label, commander: saved.commander, deckList: saved.deckList } : { ok: false, error: "That saved deck no longer exists on the host." };
  }
  return { ok: true, name: choice.name, commander: choice.commander || commanderFromList(choice.deckList), deckList: choice.deckList };
}

// ---------- state changes on the host's configs (all return new arrays; the same array when nothing changed) ----------

/** Deck fields cleared when a seat is (re)opened or its friend leaves. */
export const OPEN_SEAT_PATCH = { mode: "decklist" as const, commander: "", deckList: "", deck: undefined, status: "empty" as const, message: "Waiting for a friend to take this seat.", activity: [] as string[] };

/** Patch that turns a seat into an open friend seat (host's selector, "free seat"). */
export const openSeatPatch = () => ({ kind: "human" as const, remoteSlot: REMOTE_UNASSIGNED, empty: false, ...OPEN_SEAT_PATCH, activity: [] as string[] });

const DECK_FIELDS = ["mode", "commander", "deckList", "deck", "status", "message", "activity"] as const;

export function claimSeat<T extends LobbyConfig>(configs: T[], guests: GuestInfo[], slot: SlotId, seatId: string): { configs: T[]; error?: string } {
  const target = configs.find((c) => c.seatId === seatId);
  if (!guests.some((g) => g.seatId === slot && g.connected)) return { configs, error: "You are not connected." };
  if (!target || !isRemoteConfig(target)) return { configs, error: "That seat is not open for friends." };
  if (target.remoteSlot === slot) return { configs };
  if (!isOpenConfig(target)) return { configs, error: "Someone else already took that seat." };
  const old = seatOfSlot(configs, slot);
  return {
    configs: configs.map((c) => {
      if (c.seatId === seatId) {
        const carried = old ? Object.fromEntries(DECK_FIELDS.map((f) => [f, old[f]])) : {};
        return { ...c, ...carried, remoteSlot: slot };
      }
      if (old && c.seatId === old.seatId) return { ...c, ...openSeatPatch() };
      return c;
    })
  };
}

export function releaseSlot<T extends LobbyConfig>(configs: T[], slot: SlotId): T[] {
  const seat = seatOfSlot(configs, slot);
  return seat ? configs.map((c) => (c === seat ? { ...c, ...openSeatPatch() } : c)) : configs;
}

/** Frees seats claimed by a slot that is no longer in the room at all (kicked / room restored without it). A merely disconnected guest keeps the
 * seat so a reconnect with the same token slots back in; readiness (lobbyBlockers) still demands a live connection. */
export function reconcileClaims<T extends LobbyConfig>(configs: T[], guests: GuestInfo[]): T[] {
  let changed = false;
  const next = configs.map((c) => {
    if (!isRemoteConfig(c) || isOpenConfig(c) || guests.some((g) => g.seatId === c.remoteSlot)) return c;
    changed = true;
    return { ...c, ...openSeatPatch() };
  });
  return changed ? next : configs;
}

/** Reasons PLAY must stay disabled because of the friend seats (empty when every friend seat is taken, connected and has a legal deck). */
export function lobbyBlockers(configs: LobbyConfig[], guests: GuestInfo[]): { seatId: string; reason: string }[] {
  const out: { seatId: string; reason: string }[] = [];
  for (const c of activeSeats(configs)) {
    if (!isRemoteConfig(c)) continue;
    if (isOpenConfig(c)) out.push({ seatId: c.seatId, reason: "open - waiting for a friend to take it" });
    else if (!guests.some((g) => g.seatId === c.remoteSlot && g.connected)) out.push({ seatId: c.seatId, reason: "its friend is disconnected" });
    else if (c.status === "building") out.push({ seatId: c.seatId, reason: "deck is still validating" });
    else if (!deckReady(c)) out.push({ seatId: c.seatId, reason: "no valid deck yet" });
  }
  return out;
}

// ---------- the message friends see ----------

const deckName = (c: LobbyConfig, names: Record<string, string>) => (c.deckList.trim() ? names[c.seatId] || undefined : undefined);

/** What `slot` may see: everyone's seat + deck status/commander, but deck errors/warnings and notices only for their own seat. */
export function buildLobbyMessage(input: {
  configs: LobbyConfig[];
  guests: GuestInfo[];
  slot: SlotId;
  hostName: string;
  hostDecks: HostDeckSummary[];
  deckNames?: Record<string, string>;
  notice?: string;
  rev: number;
}): LobbyMessage {
  const names = input.deckNames ?? {};
  const seats: LobbySeatView[] = activeSeats(input.configs).map((c) => {
    const you = c.remoteSlot === input.slot;
    const base = { seatId: c.seatId, label: c.name, you };
    if (!isRemoteConfig(c)) return { ...base, kind: c.kind === "agent" ? "agent" : "host" };
    if (isOpenConfig(c)) return { ...base, kind: "open" };
    const guest = input.guests.find((g) => g.seatId === c.remoteSlot);
    const status: LobbyDeckStatus = c.status === "building" ? "building" : deckReady(c) ? "ready" : c.status === "error" || c.deck ? "error" : "empty";
    const deck: LobbySeatView["deck"] = {
      status,
      name: deckName(c, names),
      commander: c.commander || undefined,
      message: you ? c.message : undefined,
      errors: you ? (c.deck?.validation.errors ?? []).slice(0, 10) : [],
      warnings: you ? (c.deck?.validation.warnings ?? []).slice(0, 10) : []
    };
    return { ...base, kind: "friend", takenBy: guest?.displayName ?? "Friend", connected: Boolean(guest?.connected), deck };
  });
  return {
    kind: "lobby",
    v: LOBBY_VERSION,
    rev: input.rev,
    hostName: input.hostName,
    seats,
    hostDecks: input.hostDecks.slice(0, LOBBY_MAX_HOST_DECKS),
    yourSeatId: seatOfSlot(input.configs, input.slot)?.seatId,
    notice: input.notice
  };
}

/** Stable text of a message ignoring rev (publish only on change). */
export const lobbyFingerprint = (m: LobbyMessage) => JSON.stringify({ ...m, rev: 0 });

export function isLobbyMessage(value: unknown): value is LobbyMessage {
  const m = value as Partial<LobbyMessage> | null;
  return Boolean(m && typeof m === "object" && m.kind === "lobby" && m.v === LOBBY_VERSION && typeof m.rev === "number" && Array.isArray(m.seats) && Array.isArray(m.hostDecks));
}

// ---------- decks a guest remembers in its own browser ----------

export interface MyDeck {
  name: string;
  commander: string;
  deckList: string;
}
export const MY_DECKS_KEY = "mtg-mp-my-decks";
export const MY_DECKS_MAX = 30;

export function parseMyDecks(raw: string | null | undefined): MyDeck[] {
  try {
    const value = JSON.parse(raw ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter((d): d is MyDeck => d && typeof d.name === "string" && typeof d.deckList === "string" && typeof d.commander === "string")
      .slice(0, MY_DECKS_MAX);
  } catch {
    return [];
  }
}

/** Adds/replaces (by name, case-insensitive) a remembered deck; newest first. */
export function rememberDeck(decks: MyDeck[], deck: MyDeck): MyDeck[] {
  return [deck, ...decks.filter((d) => d.name.toLowerCase() !== deck.name.toLowerCase())].slice(0, MY_DECKS_MAX);
}
