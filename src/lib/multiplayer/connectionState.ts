// Pure state machines behind the multiplayer hooks (useMpHost / useMpGuest), so the logic is testable without React.
import type { GuestInfo, HostEvent } from "./protocol";
import type { LobbyMessage } from "./lobby";
import type { MpSnapshot } from "./snapshot";

// ---------- host ----------

export type HostStatus = "off" | "creating" | "waiting" | "live" | "reconnecting" | "closed" | "error";

export interface HostState {
  status: HostStatus;
  roomCode?: string;
  guests: GuestInfo[];
  error?: string;
}

export const initialHostState: HostState = { status: "off", guests: [] };

export type HostAction =
  | { type: "creating" }
  | { type: "created"; roomCode: string }
  | { type: "stream_open" }
  | { type: "stream_lost" }
  | { type: "event"; event: HostEvent }
  | { type: "error"; message: string }
  | { type: "closed" }
  | { type: "guest_removed"; seatId: string }
  | { type: "reset" };

const upsert = (guests: GuestInfo[], guest: GuestInfo) => (guests.some((g) => g.seatId === guest.seatId) ? guests.map((g) => (g.seatId === guest.seatId ? guest : g)) : [...guests, guest]);

export function hostReducer(state: HostState, action: HostAction): HostState {
  switch (action.type) {
    case "creating":
      return { status: "creating", guests: [] };
    case "created":
      return { ...state, status: "waiting", roomCode: action.roomCode, error: undefined };
    case "stream_open":
      return state.status === "reconnecting" ? { ...state, status: state.guests.length ? "live" : "waiting" } : state;
    case "stream_lost":
      return state.status === "off" || state.status === "closed" || state.status === "error" ? state : { ...state, status: "reconnecting" };
    case "event": {
      const e = action.event;
      if (e.type === "host_ready") return { ...state, status: e.guests.some((g) => g.connected) ? "live" : "waiting", roomCode: e.roomCode, guests: e.guests };
      if (e.type === "guest_joined") return { ...state, status: "live", guests: upsert(state.guests, { seatId: e.seatId, displayName: e.displayName, connected: true }) };
      if (e.type === "guest_left") {
        const guests = state.guests.map((g) => (g.seatId === e.seatId ? { ...g, connected: false } : g));
        return { ...state, guests, status: guests.some((g) => g.connected) ? "live" : "waiting" };
      }
      return state; // intents are M4
    }
    case "error":
      return { ...state, status: "error", error: action.message };
    case "closed":
      return { ...state, status: "closed" };
    case "guest_removed": {
      const guests = state.guests.filter((g) => g.seatId !== action.seatId);
      return { ...state, guests, status: state.status === "live" && !guests.some((g) => g.connected) ? "waiting" : state.status };
    }
    case "reset":
      return initialHostState;
  }
}

/** Seats currently connected (what a snapshot has to be sent to). */
export const connectedGuests = (state: HostState) => state.guests.filter((g) => g.connected);

/**
 * Decides whether a freshly built snapshot is worth publishing: skips unchanged content, hands out strictly increasing revs.
 * `force()` makes the next snapshot go out even if unchanged (a guest just joined and has nothing yet).
 */
export class PublishGate {
  private lastFingerprint: string | undefined;
  private rev = 0;
  private forced = false;

  force() {
    this.forced = true;
  }

  /** Returns the rev to publish with, or undefined to skip. */
  admit(fingerprint: string): number | undefined {
    if (!this.forced && fingerprint === this.lastFingerprint) return undefined;
    this.forced = false;
    this.lastFingerprint = fingerprint;
    return ++this.rev;
  }

  /** A publish failed: forget the fingerprint so the same content is retried. */
  failed() {
    this.lastFingerprint = undefined;
  }

  get currentRev() {
    return this.rev;
  }
}

// ---------- guest ----------

export type GuestStatus = "idle" | "joining" | "connecting" | "waiting" | "live" | "reconnecting" | "closed" | "error";

export interface GuestState {
  status: GuestStatus;
  seatId?: string;
  roomCode?: string;
  snapshot?: MpSnapshot;
  rev: number;
  /** Latest lobby (seats / decks) while the host is on its setup screen. */
  lobby?: LobbyMessage;
  error?: string;
}

export const initialGuestState: GuestState = { status: "idle", rev: 0 };

export type GuestAction =
  | { type: "joining" }
  | { type: "connecting" }
  | { type: "stream_open" }
  | { type: "stream_lost" }
  | { type: "welcome"; seatId: string; roomCode: string }
  | { type: "snapshot"; rev: number; snapshot: MpSnapshot }
  | { type: "lobby"; message: LobbyMessage }
  | { type: "room_closed" }
  | { type: "error"; message: string; fatal?: boolean };

export function guestReducer(state: GuestState, action: GuestAction): GuestState {
  switch (action.type) {
    case "joining":
      return { ...initialGuestState, status: "joining" };
    case "connecting":
      return { ...state, status: "connecting" };
    case "stream_open":
      return state.status === "reconnecting" || state.status === "connecting" ? { ...state, status: state.snapshot ? "live" : "waiting" } : state;
    case "stream_lost":
      return state.status === "closed" || state.status === "error" || state.status === "idle" ? state : { ...state, status: "reconnecting" };
    case "welcome":
      return { ...state, seatId: action.seatId, roomCode: action.roomCode, status: state.snapshot ? "live" : "waiting" };
    case "snapshot":
      // Replays after a reconnect and out-of-order deliveries must never move the table backwards.
      if (action.rev < state.rev) return state;
      return { ...state, snapshot: action.snapshot, rev: action.rev, status: "live", error: undefined };
    case "lobby":
      if (state.lobby && action.message.rev < state.lobby.rev) return state;
      // Lobby messages are only sent while the host is on its setup screen, so any old table is stale: show the lobby again.
      return { ...state, lobby: action.message, snapshot: undefined, rev: 0, status: state.status === "connecting" || state.status === "reconnecting" ? state.status : "waiting" };
    case "room_closed":
      return { ...state, status: "closed" };
    case "error":
      return { ...state, status: action.fatal === false ? state.status : "error", error: action.message };
  }
}

/** Reconnect delay: 1s, 2s, 4s ... capped at 15s. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(15_000, 1000 * 2 ** Math.max(0, attempt));
}
