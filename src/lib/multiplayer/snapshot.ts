// Host -> guest snapshot: what a SPECTATOR may see of the host's live game. Pure and JSON-safe; the host hook (components/game/useMpHost.ts) builds
// one per change and publishes it through the relay. Built on view.ts (hidden info is stubbed there), so nothing private ever reaches the wire.
//
// Spectator privacy rule: NO private data at all - every hand is stubs of the right count, no libraries' contents, no decklists, no pending
// prompts/decisions of any seat, no host-only UI (inspected card, selection, priority-stop settings, agent reasoning).
import type { PendingActionView } from "@/components/ThreeGameTable";
import type { GameSession, ManaPool } from "../types";
import { SPECTATOR_VIEWER, buildGuestSession } from "./view";

export const SNAPSHOT_VERSION = 1;
/** Events kept in a snapshot (newest first, like GameSession.events). Keeps a snapshot well under MAX_PUBLISH_BYTES. */
export const SNAPSHOT_MAX_EVENTS = 100;

export type SnapshotViewer = typeof SPECTATOR_VIEWER;

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
}

export interface MpSnapshot {
  v: typeof SNAPSHOT_VERSION;
  rev: number;
  viewer: SnapshotViewer;
  hostName: string;
  /** The seat the table treats as "me" (the host's seat; the only `human` in `session`). */
  hostSeatId: string;
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
}

/** Same input + viewer + rev -> same output. Input is not mutated. Only the spectator viewer exists in M3 (seat viewers arrive with intents, M4). */
export function buildSnapshot(input: SnapshotInput, viewer: SnapshotViewer, rev = 0): MpSnapshot {
  if (viewer !== SPECTATOR_VIEWER) throw new Error(`buildSnapshot: unsupported viewer ${String(viewer)}`);
  // session.events is newest-first (addEvent prepends), so trim from the front before view.ts (which keeps the tail of what it is given).
  const trimmed: GameSession = { ...input.session, events: input.session.events.slice(0, SNAPSHOT_MAX_EVENTS) };
  const session = buildGuestSession(trimmed, SPECTATOR_VIEWER, { maxEvents: SNAPSHOT_MAX_EVENTS });
  const hostSeatId = session.seats.find((seat) => seat.kind === "human")?.id ?? session.seats[0]?.id ?? "";
  const activePlayerId = input.activeSeatId ?? session.activePlayerId;
  return {
    v: SNAPSHOT_VERSION,
    rev,
    viewer,
    hostName: input.hostName,
    hostSeatId,
    session: activePlayerId === session.activePlayerId ? session : { ...session, activePlayerId },
    activeSeatId: input.activeSeatId,
    prioritySeatId: input.prioritySeatId,
    priorityPasses: [...input.priorityPasses],
    requiredPasses: [...(input.requiredPasses ?? [])],
    pendingAction: input.pendingAction,
    stackActions: input.stackActions,
    gameStage: input.gameStage,
    mulligans: { ...(input.mulligans ?? {}) },
    hostManaPool: input.hostManaPool
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
