// Host side of the multiplayer LOBBY (M4 stage 2), used by useMpHost. While the host is on its setup screen: publishes a per-guest `lobby` message
// (seats, saved-deck names, that guest's own deck status) through the relay, and applies the guests' lobby intents (take/leave a seat, choose a deck)
// to the setup configs. A guest's deck goes through the SAME buildDeck (POST /api/decks/build, run by the host's browser) as the setup form's
// "Validate Deck" button, so it is enriched and validated identically. Pure rules live in src/lib/multiplayer/lobby.ts.
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { hostActionsStore } from "@/lib/multiplayer/hostStatusStore";
import { buildLobbyMessage, isLobbyIntentName, lobbyFingerprint, claimSeat, parseLobbyIntent, reconcileClaims, releaseSlot, resolveDeckChoice, seatOfSlot, type LobbyConfig } from "@/lib/multiplayer/lobby";
import type { HostState } from "@/lib/multiplayer/connectionState";
import type { HostEvent } from "@/lib/multiplayer/protocol";
import { lateFn, type GameContext } from "./context";
import type { SeatConfig } from "@/components/DeckSetup";

type IntentEvent = Extract<HostEvent, { type: "intent" }>;
type Post = (path: string, token: string | null, body: unknown, keepalive?: boolean) => Promise<unknown>;

export const LOBBY_PUBLISH_DEBOUNCE_MS = 100;

export function useMpLobby(args: {
  ctx: GameContext;
  state: HostState;
  enabled: boolean;
  hostName: string;
  tokenRef: MutableRefObject<string | null>;
  intentRef: MutableRefObject<((event: IntentEvent) => void) | undefined>;
  post: Post;
  removeGuest: (slot: string) => void;
}) {
  const { ctx, state, enabled, hostName, tokenRef, intentRef, post, removeGuest } = args;
  const { configs, setConfigs, deckLibrary, mode } = ctx;
  const buildDeck = lateFn(ctx, "buildDeck");
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [deckNames, setDeckNames] = useState<Record<string, string>>({});
  const latest = useRef({ configs, deckLibrary, guests: state.guests, buildDeck, mode });
  latest.current = { configs, deckLibrary, guests: state.guests, buildDeck, mode };
  const revRef = useRef(0);
  const sentRef = useRef(new Map<string, string>());
  const setNotice = (slot: string, text: string | undefined) =>
    setNotices((cur) => {
      if ((cur[slot] ?? undefined) === text) return cur;
      const next = { ...cur };
      if (text) next[slot] = text;
      else delete next[slot];
      return next;
    });

  // Guest intents (the relay forwards them with the authenticated slot in fromSeatId).
  intentRef.current = (event) => {
    if (!isLobbyIntentName(event.name)) return;
    const slot = event.fromSeatId;
    const cur = latest.current;
    if (cur.mode !== "setup") return setNotice(slot, "The game has already started.");
    const parsed = parseLobbyIntent(event.name, event.args);
    if (!parsed.ok) return setNotice(slot, parsed.error);
    const intent = parsed.intent;
    if (intent.type === "take_seat") {
      const result = claimSeat(cur.configs as LobbyConfig[], cur.guests, slot, intent.seatId);
      if (result.error) return setNotice(slot, result.error);
      setNotice(slot, undefined);
      setConfigs((list) => claimSeat(list as LobbyConfig[], latest.current.guests, slot, intent.seatId).configs as SeatConfig[]);
      return;
    }
    if (intent.type === "leave_seat") {
      setNotice(slot, undefined);
      setConfigs((list) => releaseSlot(list as LobbyConfig[], slot) as SeatConfig[]);
      return;
    }
    const seat = seatOfSlot(cur.configs, slot);
    if (!seat) return setNotice(slot, "Take a seat first, then choose a deck.");
    const resolved = resolveDeckChoice(intent.deck, cur.deckLibrary);
    if (!resolved.ok) return setNotice(slot, resolved.error);
    setNotice(slot, undefined);
    setDeckNames((names) => ({ ...names, [seat.seatId]: resolved.name }));
    const patch = { commander: resolved.commander, deckList: resolved.deckList, deck: undefined, mode: "decklist" as const, status: "empty" as const, activity: [] as string[] };
    setConfigs((list) => list.map((c) => (c.seatId === seat.seatId ? { ...c, ...patch } : c)));
    void Promise.resolve(cur.buildDeck({ ...seat, ...patch })).catch((e) => {
      setConfigs((list) => list.map((c) => (c.seatId === seat.seatId ? { ...c, status: "error" as const, message: `Deck validation failed: ${e instanceof Error ? e.message : String(e)}` } : c)));
    });
  };

  // Free seats whose guest left the room entirely.
  useEffect(() => {
    if (!enabled) return;
    const next = reconcileClaims(configs as LobbyConfig[], state.guests);
    if (next !== configs) setConfigs(next as SeatConfig[]);
  }, [enabled, configs, state.guests, setConfigs]);

  // Host "kick": remove from the relay, forget the guest, free the seat.
  useEffect(() => {
    if (!enabled) return;
    hostActionsStore.set({
      kick: (slot) => {
        const token = tokenRef.current;
        if (token) void post("/api/mp/kick", token, { seatId: slot }).catch(() => {});
        removeGuest(slot);
        setConfigs((list) => releaseSlot(list as LobbyConfig[], slot) as SeatConfig[]);
        sentRef.current.delete(slot);
      }
    });
    return () => hostActionsStore.set(undefined);
  }, [enabled, tokenRef, post, removeGuest, setConfigs]);

  // Publish one lobby message per connected guest whenever its content changes (the relay replays the last one to a (re)connecting guest).
  useEffect(() => {
    if (!enabled || mode !== "setup") return;
    const timer = setTimeout(() => {
      const token = tokenRef.current;
      if (!token) return;
      const hostDecks = deckLibrary.map((d) => ({ id: d.id, label: d.label, commander: d.commander }));
      for (const guest of state.guests) {
        if (!guest.connected) continue;
        const message = buildLobbyMessage({ configs: configs as LobbyConfig[], guests: state.guests, slot: guest.seatId, hostName, hostDecks, deckNames, notice: notices[guest.seatId], rev: 0 });
        const fingerprint = lobbyFingerprint(message);
        if (sentRef.current.get(guest.seatId) === fingerprint) continue;
        sentRef.current.set(guest.seatId, fingerprint);
        const rev = ++revRef.current;
        post("/api/mp/publish", token, { toSeatId: guest.seatId, snapshot: { ...message, rev }, rev }).catch(() => sentRef.current.delete(guest.seatId));
      }
    }, LOBBY_PUBLISH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, mode, configs, deckLibrary, state.guests, hostName, deckNames, notices, tokenRef, post]);

  // Going back to setup after a game: resend the lobby even if it looks unchanged (guests hold the old table).
  useEffect(() => {
    if (mode !== "setup") sentRef.current.clear();
  }, [mode]);
}
