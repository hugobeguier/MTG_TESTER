// Per-seat view of a GameSession for multiplayer: the HOST's engine owns the full session; every remote seat gets filterForSeat(...) of it.
// Pure: no React, no network, no mutation of the input (unchanged sub-objects are shared, not cloned - serialise before sending).
//
// What is private (Magic-correct): other seats' hands, ALL libraries (the viewer's own too: they may know the count, not the order), other seats'
// decklists (`seat.deck`), face-down identities (manifest `faceDownCardName`, hideaway cards in exile) and per-seat pending prompts.
// Public and left intact: battlefield, graveyard, exile (face-up), command zone, life/counters, everything else.
//
// REVEALED CARDS: the session has NO revealed/public-temporarily mechanism (no flag, no event type). So `options.revealedCardIds` is an
// extension point: any hand/library card whose id is in the set is left intact for everyone. The host would fill it from a future reveal log.
//
// Stub ids: `hidden:<seatId>:<zone>:<index>` - index-based, so no identity leaks (real ids can embed the card name, e.g. "builtin-sol-ring").
// They are stable between snapshots for an unchanged zone but shift when a card leaves the middle of a hand (UI keys only; do not use them for rules).
//
// KNOWN LEAKS (not structurally redactable):
//  * GameEvent.message/detail are free text. We best-effort replace names of cards that are hidden from the viewer (other seats' hand/library cards whose
//    name appears in no public zone and not in the viewer's own cards) by "a card". This misses renamed forms, partial names, copies of names that are
//    public elsewhere (e.g. a basic land name), and anything the log says in prose about hand contents (counts, "discards 2 cards" is fine, "discards X" is redacted only if X is hidden).
//  * A spell in flight on the stack is not in the session, so its name may be redacted from the log until it lands in a public zone (over-redaction, safe).
//  * Ids of face-down battlefield cards are replaced by an opaque id, so attackTargetId/attachedToId style references to them dangle in the guest view.
//  * Ids of public cards are left as-is; if a public card's id embeds its name that is already public.
import type { GameEvent, GameSession, PlayerSeat, VisibleCard } from "../types";

export interface ViewOptions {
  /** Keep the last N events (default 100). */
  maxEvents?: number;
  /** Extension point: ids of hand/library cards currently revealed to everyone (no session mechanism exists yet). */
  revealedCardIds?: ReadonlySet<string>;
}

/** Viewer id for a spectator: owns no seat, so every hand, library and prompt is hidden. */
export const SPECTATOR_VIEWER = "spectator";

const DEFAULT_MAX_EVENTS = 100;
const REDACTED_NAME = "a card";

function stubCard(seatId: string, zone: "hand" | "library" | "exile" | "battlefield", index: number): VisibleCard {
  return {
    id: `hidden:${seatId}:${zone}:${index}`,
    name: "Hidden card",
    typeLine: "",
    oracleText: "",
    manaValue: 0,
    colors: [],
    role: "hidden",
    zone
  };
}

function isFaceDownExile(card: VisibleCard): boolean {
  return Boolean(card.hideawaySourceId) || Boolean(card.faceDownCardName);
}

// Seat-specific prompts ("seat X owes a choice") carry card names/options only the addressee may see; keep just the viewer's.
const PER_SEAT_QUEUES = [
  "pendingDiscardChoices",
  "pendingDiscoverChoices",
  "pendingPunisherChoices",
  "pendingFreeCastChoices",
  "pendingBraidsChoices",
  "pendingVentureChoices",
  "pendingSacrificeChoices",
  "pendingCounterChoices",
  "pendingPlayerChoices",
  "pendingShockChoices"
] as const;

function filterSeat(seat: PlayerSeat, isViewer: boolean, revealed: ReadonlySet<string>): PlayerSeat {
  const keep = (card: VisibleCard) => revealed.has(card.id);
  const next: PlayerSeat = { ...seat };
  // Own hand intact; others' hand -> same-length stubs (revealed cards stay).
  const hand = seat.board.hand;
  const library = seat.library;
  const exile = seat.board.exile;
  const board = { ...seat.board };
  if (!isViewer) {
    board.hand = hand.map((card, i) => (keep(card) ? card : stubCard(seat.id, "hand", i)));
    board.battlefield = seat.board.battlefield.map((card, i) => {
      if (!card.faceDownCardName) return card;
      const { faceDownCardName: _hidden, ...rest } = card;
      return { ...rest, id: stubCard(seat.id, "battlefield", i).id };
    });
    if (exile) board.exile = exile.map((card, i) => (isFaceDownExile(card) && !keep(card) ? stubCard(seat.id, "exile", i) : card));
    delete next.deck;
  }
  next.board = board;
  // Libraries: nobody sees contents (count lives in zones.library, kept as is). Length-preserving stubs for anything that reads library.length.
  if (library) next.library = library.map((card, i) => (keep(card) ? card : stubCard(seat.id, "library", i)));
  return next;
}

/** Names of cards the viewer cannot see: other seats' hand/library cards (not revealed), minus every name visible to the viewer. */
function hiddenNamesFor(session: GameSession, viewerSeatId: string, revealed: ReadonlySet<string>): Set<string> {
  const hidden = new Set<string>();
  const visible = new Set<string>();
  for (const seat of session.seats) {
    const own = seat.id === viewerSeatId;
    const pub = [...seat.board.battlefield, ...(seat.board.graveyard ?? []), ...(seat.board.exile ?? []).filter((c) => !isFaceDownExile(c) || own)];
    if (seat.board.commander) pub.push(seat.board.commander);
    for (const c of pub) if (!c.faceDownCardName || own) visible.add(c.name);
    const priv = [...seat.board.hand, ...(seat.library ?? [])];
    for (const c of priv) {
      if (own || revealed.has(c.id)) visible.add(c.name);
      else hidden.add(c.name);
    }
    for (const c of seat.board.battlefield) if (c.faceDownCardName && !own) hidden.add(c.faceDownCardName);
  }
  for (const name of visible) hidden.delete(name);
  hidden.delete("Hidden card");
  hidden.delete("");
  return hidden;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactEvents(events: GameEvent[], hiddenNames: Set<string>): GameEvent[] {
  if (hiddenNames.size === 0) return events;
  const names = [...hiddenNames].sort((a, b) => b.length - a.length || a.localeCompare(b));
  const pattern = new RegExp(`(?<![\\w'])(?:${names.map(escapeRegExp).join("|")})(?![\\w'])`, "gi");
  return events.map((event) => {
    const message = event.message.replace(pattern, REDACTED_NAME);
    const detail = event.detail === undefined ? undefined : event.detail.replace(pattern, REDACTED_NAME);
    if (message === event.message && detail === event.detail) return event;
    return detail === undefined ? { ...event, message } : { ...event, message, detail };
  });
}

/** The session as `viewerSeatId` may see it. Throws if that seat does not exist. Same input + options -> same output. */
export function filterForSeat(session: GameSession, viewerSeatId: string, options: ViewOptions = {}): GameSession {
  if (viewerSeatId !== SPECTATOR_VIEWER && !session.seats.some((seat) => seat.id === viewerSeatId)) throw new Error(`filterForSeat: unknown seat ${viewerSeatId}`);
  const revealed = options.revealedCardIds ?? new Set<string>();
  const maxEvents = Math.max(0, options.maxEvents ?? DEFAULT_MAX_EVENTS);
  const hiddenNames = hiddenNamesFor(session, viewerSeatId, revealed);

  const next: GameSession = { ...session };
  next.seats = session.seats.map((seat) => filterSeat(seat, seat.id === viewerSeatId, revealed));
  next.events = redactEvents(maxEvents === 0 ? [] : session.events.slice(-maxEvents), hiddenNames);
  for (const key of PER_SEAT_QUEUES) {
    const queue = session[key] as Array<{ seatId: string }> | undefined;
    if (queue) (next as unknown as Record<string, unknown>)[key] = queue.filter((entry) => entry.seatId === viewerSeatId);
  }
  return next;
}

/**
 * The existing table UI treats the FIRST seat with kind "human" as "me" and every kind "agent" seat as an opponent. For a guest, make the viewer the
 * only human and everyone else (host, other friends, AI) an "agent". Everything else (ids, names, agentName, ...) is preserved; input is not mutated.
 *
 * Other code assuming "first human is me": ThreeGameTable.tsx (`human = seats.find(kind==="human")`, hover/drag handlers, PLAYER_AREAS rotation by human index),
 * PlayerBoard.tsx / GameTable.tsx (perspective), AppFlow.tsx + game/context.ts (`humanSeat`), and ~160 `kind === "human"` sites in src/engine/* and
 * src/components/game/* (priority, prompts, decisions). The guest UI must be a read-only renderer fed by this view, not run those hooks.
 */
export function relabelForGuest(session: GameSession, viewerSeatId: string): GameSession {
  // Spectator: the table needs exactly one "human" (its camera/hand panel), so the first human seat (the host) plays that role, shown with a hidden hand.
  const meId = viewerSeatId === SPECTATOR_VIEWER ? (session.seats.find((seat) => seat.kind === "human") ?? session.seats[0])?.id : viewerSeatId;
  if (!session.seats.some((seat) => seat.id === meId)) throw new Error(`relabelForGuest: unknown seat ${viewerSeatId}`);
  return { ...session, seats: session.seats.map((seat) => ({ ...seat, kind: seat.id === meId ? "human" : "agent" })) };
}

/** filterForSeat + relabelForGuest. Named to avoid clashing with decisions.ts `viewForSeat` (which redacts PendingDecision payloads, not sessions). */
export function buildGuestSession(session: GameSession, viewerSeatId: string, options: ViewOptions = {}): GameSession {
  return relabelForGuest(filterForSeat(session, viewerSeatId, options), viewerSeatId);
}
