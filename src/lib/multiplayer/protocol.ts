// Multiplayer relay wire protocol. Snapshots are opaque JSON here (their shape is defined later,
// by the host's snapshot filter); the relay never inspects them.

export const MAX_PUBLISH_BYTES = 2 * 1024 * 1024;
export const MAX_INTENT_BYTES = 64 * 1024;
export const MAX_INTENTS_PER_SECOND = 30;
export const DEFAULT_MAX_GUESTS = 3;
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const ROOM_IDLE_EXPIRY_MS = 6 * 60 * 60 * 1000;

/** Opaque guest slot id, e.g. "guest-1". The host maps it to a game seat later. */
export type SlotId = string;

// host -> relay (HTTP POST bodies)
export type HostCommand =
  | { type: "publish"; toSeatId: SlotId | "all"; snapshot: unknown; rev: number }
  | { type: "kick"; seatId: SlotId }
  | { type: "closeRoom" };

// guest -> relay
export type GuestCommand = { type: "intent"; name: string; args: unknown[]; clientSeq: number };

// relay -> host stream
export type HostEvent =
  | { type: "host_ready"; roomCode: string; guests: GuestInfo[] }
  | { type: "guest_joined"; seatId: SlotId; displayName: string }
  | { type: "guest_left"; seatId: SlotId }
  | { type: "intent"; fromSeatId: SlotId; name: string; args: unknown[]; clientSeq: number };

// relay -> guest stream
export type GuestEvent =
  | { type: "welcome"; seatId: SlotId; roomCode: string }
  | { type: "snapshot"; rev: number; snapshot: unknown }
  | { type: "room_closed" }
  | { type: "error"; message: string };

export type StreamEvent = HostEvent | GuestEvent;
export type Sink = (msg: StreamEvent) => void;

export interface GuestInfo {
  seatId: SlotId;
  displayName: string;
  connected: boolean;
}

export interface RoomInfo {
  roomCode: string;
  maxGuests: number;
  guests: GuestInfo[];
  hostConnected: boolean;
}

export type Role = "host" | "guest";
export interface TokenIdentity {
  role: Role;
  roomCode: string;
  seatId?: SlotId;
}

export class HubError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
