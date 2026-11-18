// Host -> guest snapshot: what ONE viewer may see of the host's live game. Pure and JSON-safe; the host hook (components/game/useMpHost.ts) builds
// one per viewer per change and publishes it through the relay. Built on view.ts (hidden info is stubbed there), so nothing private ever reaches the wire.
//
// Two kinds of viewer:
//  * SPECTATOR_VIEWER (a guest holding no seat): NO private data at all - every hand is stubs of the right count, no libraries' contents, no decklists,
//    no pending prompts/decisions of any seat, no host-only UI. The host's seat is drawn as the table's "human".
//  * a seat id (a friend sitting at a remote seat): the same, except that seat's OWN hand/prompts/mulligan state are real and that seat is the table's
//    only "human" (so the table draws its hand and camera). Other seats (host included) are relabelled "agent" with hidden hands.
import type { PendingActionView } from "@/components/ThreeGameTable";
import type { GameSession, ManaPool } from "../types";
import { mulliganReturnRequired, waitingForNames } from "./mulliganGate";
import { hostHumanSeat } from "./seatMap";
import { SPECTATOR_VIEWER, buildGuestSession } from "./view";
import { HOST_SEAT_NAME, eventsForViewer } from "./viewerText";
import { buildSeatPrompts, type PromptSlots, type SeatPrompts } from "./seatPrompts";

export const SNAPSHOT_VERSION = 2;
/** Events kept in a snapshot (newest first, like GameSession.events). Keeps a snapshot well under MAX_PUBLISH_BYTES. */
export const SNAPSHOT_MAX_EVENTS = 100;

/** SPECTATOR_VIEWER or the id of the seat the snapshot is built for. */
export type SnapshotViewer = string;

/** A seated viewer's own opening-hand state (private: it names which of its own cards it will shuffle away). */
export interface MulliganSeatState {
  kept: boolean;
  returnCardIds: string[];
  returnRequired: number;
}

/** The host's live state, as the host hook reads it (all public except what view.ts filters out of `session`). */
export interface SnapshotInput {
  session: GameSession;
  hostName: string;
  activeSeatId?: string;
  prioritySeatId?: string;
  priorityPasses: string[];
  /** Seats that must pass before the top stack item resolves (drives the priority pips). */
  requiredPasses?: string[];
  pendingAction?: PendingActionView;
  stackActions: PendingActionView[];
  gameStage: "mulligan" | "playing";
  /** Public: mulligans taken per seat id. */
  mulligans?: Record<string, number>;
  /** The host seat's floating mana (public information). */
  hostManaPool?: ManaPool;
  /** Floating mana per seat id (public information); a seated viewer gets its own as `myManaPool`. */
  manaPools?: Record<string, ManaPool>;
  /** Opening hand: which seats have kept (public) ... */
  keptHands?: Record<string, boolean>;
  /** ... and the cards each seat has picked to shuffle away (only that seat's entry is ever sent, to that seat). */
  mulliganReturnCardIds?: Record<string, string[]>;
  /** The host's open prompts (each addressed to one seat); only the viewer's own ever reach that viewer (seatPrompts.ts). */
  prompts?: PromptSlots;
  /** Per seat: has it used its land drop this turn (drives which hand cards offer a land play). */
  landPlayed?: Record<string, boolean>;
  /** Result of the newest intent the host processed from THIS viewer (last clientSeq + why it was refused), set per viewer by the host hook. */
  ack?: { seq: number; error?: string };
  /** Names of friends the game is waiting on because they are disconnected (the game is paused while this is non-empty). */
  pausedFor?: string[];
}

export interface MpSnapshot {
  v: typeof SNAPSHOT_VERSION;
  rev: number;
  viewer: SnapshotViewer;
  hostName: string;
  /** The host's own seat (real id; its player name is `hostName`). */
  hostSeatId: string;
  /** Seated viewer: the seat the table draws as "me" (the only `human` in `session`, hand face-up). Absent for a spectator. */
  mySeatId?: string;
  /** Filtered + relabelled session; activePlayerId already equals activeSeatId. */
  session: GameSession;
  activeSeatId?: string;
  prioritySeatId?: string;
  priorityPasses: string[];
  requiredPasses: string[];
  pendingAction?: PendingActionView;
  stackActions: PendingActionView[];
  gameStage: "mulligan" | "playing";
  mulligans: Record<string, number>;
  hostManaPool?: ManaPool;
  /** Seated viewer's own floating mana. */
  myManaPool?: ManaPool;
  /** Names of human seats still deciding their opening hand (empty outside the mulligan step). */
  mulliganWaiting: string[];
  /** Seated viewer only, during the mulligan step: own opening-hand state. */
  mulligan?: MulliganSeatState;
  /** Seated viewer only: everything the host's own table derives for its prompts (rule choice, block choice, library look, hand hints, attack targets, ...). */
  prompts?: SeatPrompts;
  /** Seated viewer only: result of their newest intent (the table shows `error` as a toast). */
  ack?: { seq: number; error?: string };
  /** Friends the game is paused for (disconnected); shown to everybody as "Waiting for <name> to reconnect". */
  pausedFor: string[];
}

/** Same input + viewer + rev -> same output. Input is not mutated. Throws for a seat id the session does not have. */
export function buildSnapshot(input: SnapshotInput, viewer: SnapshotViewer, rev = 0): MpSnapshot {
  const mySeat = viewer === SPECTATOR_VIEWER ? undefined : input.session.seats.find((seat) => seat.id === viewer);
  if (viewer !== SPECTATOR_VIEWER && !mySeat) throw new Error(`buildSnapshot: unknown viewer ${String(viewer)}`);
  // session.events is newest-first (addEvent prepends), so trim from the front before view.ts (which keeps the tail of what it is given).
  const trimmed: GameSession = { ...input.session, events: input.session.events.slice(0, SNAPSHOT_MAX_EVENTS) };
  const guestSession = buildGuestSession(trimmed, viewer, { maxEvents: SNAPSHOT_MAX_EVENTS });
  const hostSeatId = (hostHumanSeat(input.session.seats) ?? input.session.seats[0])?.id ?? "";
  // The host's seat is literally named "You" and its log lines are second person: a guest reads them with the host's real name.
  const session: GameSession = {
    ...guestSession,
    seats: guestSession.seats.map((seat) => (seat.id === hostSeatId && seat.name === HOST_SEAT_NAME ? { ...seat, name: input.hostName } : seat)),
    events: eventsForViewer(guestSession.events, hostSeatId, input.hostName)
  };
  const mulligans = input.mulligans ?? {};
  const keptHands = input.keptHands ?? {};
  const inMulligan = input.gameStage === "mulligan";
  const activePlayerId = input.activeSeatId ?? session.activePlayerId;
  return {
    v: SNAPSHOT_VERSION,
    rev,
    viewer,
    hostName: input.hostName,
    hostSeatId,
    mySeatId: mySeat?.id,
    session: activePlayerId === session.activePlayerId ? session : { ...session, activePlayerId },
    activeSeatId: input.activeSeatId,
    prioritySeatId: input.prioritySeatId,
    priorityPasses: [...input.priorityPasses],
    requiredPasses: [...(input.requiredPasses ?? [])],
    pendingAction: input.pendingAction,
    stackActions: input.stackActions,
    gameStage: input.gameStage,
    mulligans: { ...mulligans },
    hostManaPool: input.hostManaPool,
    myManaPool: mySeat ? input.manaPools?.[mySeat.id] : undefined,
    pausedFor: [...(input.pausedFor ?? [])],
    ack: mySeat ? input.ack : undefined,
    prompts: mySeat
      ? buildSeatPrompts({
          ...(input.prompts ?? {}),
          session: input.session,
          seatId: mySeat.id,
          activeSeatId: input.activeSeatId,
          pendingAction: input.pendingAction as never,
          stackActions: input.stackActions as never,
          manaPool: input.manaPools?.[mySeat.id],
          landPlayedThisTurn: Boolean(input.landPlayed?.[mySeat.id])
        })
      : undefined,
    mulliganWaiting: inMulligan ? waitingForNames(input.session.seats.map((seat) => (seat.id === hostSeatId ? { ...seat, name: input.hostName } : seat)), keptHands) /* the host seat is literally named "You" */ : [],
    mulligan:
      mySeat && inMulligan
        ? {
            kept: Boolean(keptHands[mySeat.id]),
            returnCardIds: [...(input.mulliganReturnCardIds?.[mySeat.id] ?? [])],
            returnRequired: keptHands[mySeat.id] ? 0 : mulliganReturnRequired(mySeat.board.hand, mulligans[mySeat.id] ?? 0)
          }
        : undefined
  };
}

/** Stable text of a snapshot ignoring `rev`; used to skip publishing when nothing changed. */
export function snapshotFingerprint(snapshot: MpSnapshot): string {
  return JSON.stringify({ ...snapshot, rev: 0 });
}

/** Runtime guard for what a guest receives (the relay treats snapshots as opaque). */
export function isMpSnapshot(value: unknown): value is MpSnapshot {
  const s = value as Partial<MpSnapshot> | null;
  return Boolean(s && typeof s === "object" && s.v === SNAPSHOT_VERSION && typeof s.rev === "number" && s.session && Array.isArray(s.session.seats));
}
