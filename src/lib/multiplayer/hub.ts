import { createHash, randomBytes } from "node:crypto";
import {
  DEFAULT_MAX_GUESTS,
  HubError,
  POLL_PRESENCE_MS,
  MAX_INTENTS_PER_SECOND,
  MAX_INTENT_BYTES,
  MAX_PUBLISH_BYTES,
  ROOM_IDLE_EXPIRY_MS,
  type GuestInfo,
  type RoomInfo,
  type Sink,
  type SlotId,
  type StreamEvent,
  type TokenIdentity
} from "./protocol";

// Framework-free relay core. The host's browser is the authority: it publishes filtered snapshots,
// guests send intents that are forwarded to the host. The hub stores only the last snapshot per slot.

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
const CODE_LENGTH = 6;

interface Guest {
  seatId: SlotId;
  displayName: string;
  tokenHash: string;
  sinks: Set<Sink>;
  /** Newest message published to this guest; `id` is a hub-assigned counter (not the host's rev), so lobby messages and table snapshots order correctly. */
  last?: { id: number; rev: number; snapshot: unknown };
  intentTimes: number[];
  /** Time of the last poll (HTTP fallback transport); presence also holds while a poll is recent. */
  lastPoll?: number;
  /** Whether the host has been told this guest is connected (guest_joined sent, guest_left not yet). */
  announced: boolean;
}

export interface PollResult {
  seatId: SlotId;
  roomCode: string;
  /** Present only when a message newer than `afterId` exists. */
  message?: { id: number; rev: number; snapshot: unknown };
  /** The room was closed or this guest was removed. */
  closed?: boolean;
  reason?: "room_closed" | "kicked";
}

interface Room {
  code: string;
  maxGuests: number;
  hostTokenHash: string;
  hostSinks: Set<Sink>;
  guests: Map<SlotId, Guest>;
  nextSlot: number;
  msgCounter: number;
  lastHostActivity: number;
}

export interface HubOptions {
  now?: () => number;
  idleExpiryMs?: number;
  /** A guest counts as present for this long after its last poll. */
  pollPresenceMs?: number;
}

// Tokens are looked up by their SHA-256 hash, so lookup time does not depend on how many leading
// characters of a guess are correct (the practical equivalent of a constant-time compare).
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(24).toString("base64url");

export class MultiplayerHub {
  private rooms = new Map<string, Room>();
  private tokens = new Map<string, TokenIdentity>();
  private now: () => number;
  private idleExpiryMs: number;
  private pollPresenceMs: number;
  /** Token hashes of guests whose room closed / who were kicked, so a poll can say so instead of 401. */
  private ended = new Map<string, "room_closed" | "kicked">();

  constructor(opts: HubOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.idleExpiryMs = opts.idleExpiryMs ?? ROOM_IDLE_EXPIRY_MS;
    this.pollPresenceMs = opts.pollPresenceMs ?? POLL_PRESENCE_MS;
  }

  // ---- rooms ----
  createRoom(_hostName: string, maxGuests: number = DEFAULT_MAX_GUESTS): { roomCode: string; hostToken: string } {
    this.sweep();
    let code = "";
    do {
      code = Array.from(randomBytes(CODE_LENGTH), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    } while (this.rooms.has(code));
    const hostToken = newToken();
    const hostTokenHash = hashToken(hostToken);
    this.rooms.set(code, {
      code,
      maxGuests: Math.max(1, Math.floor(maxGuests)),
      hostTokenHash,
      hostSinks: new Set(),
      guests: new Map(),
      nextSlot: 1,
      msgCounter: 0,
      lastHostActivity: this.now()
    });
    this.tokens.set(hostTokenHash, { role: "host", roomCode: code });
    return { roomCode: code, hostToken };
  }

  join(
    roomCode: string,
    displayName: string,
    existingSeatToken?: string
  ): { seatToken: string; seatId: SlotId } {
    this.sweep();
    const room = this.requireRoom(roomCode);
    if (existingSeatToken) {
      const id = this.tokens.get(hashToken(existingSeatToken));
      if (id?.role === "guest" && id.roomCode === room.code && id.seatId && room.guests.has(id.seatId)) {
        return { seatToken: existingSeatToken, seatId: id.seatId };
      }
      throw new HubError(401, "Invalid seat token");
    }
    if (room.guests.size >= room.maxGuests) throw new HubError(409, "Room is full");
    const seatId = `guest-${room.nextSlot++}`;
    const seatToken = newToken();
    const tokenHash = hashToken(seatToken);
    room.guests.set(seatId, { seatId, displayName, tokenHash, sinks: new Set(), intentTimes: [], announced: false });
    this.tokens.set(tokenHash, { role: "guest", roomCode: room.code, seatId });
    // guest_joined is sent to the host when the guest's stream connects (subscribe).
    return { seatToken, seatId };
  }

  roomInfo(roomCode: string): RoomInfo | undefined {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) return undefined;
    return {
      roomCode: room.code,
      maxGuests: room.maxGuests,
      guests: this.guestInfos(room),
      hostConnected: room.hostSinks.size > 0
    };
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  guestCount(roomCode: string): number {
    return this.rooms.get(roomCode.toUpperCase())?.guests.size ?? 0;
  }

  identify(token: string | null | undefined): TokenIdentity | undefined {
    if (!token) return undefined;
    const id = this.tokens.get(hashToken(token));
    return id && this.rooms.has(id.roomCode) ? id : undefined;
  }

  // ---- streaming ----
  /** Attach a sink for the host or a guest. Returns an unsubscribe function. */
  subscribe(token: string, sink: Sink): () => void {
    const id = this.identify(token);
    if (!id) throw new HubError(401, "Invalid token");
    const room = this.rooms.get(id.roomCode)!;
    if (id.role === "host") {
      room.hostSinks.add(sink);
      room.lastHostActivity = this.now();
      sink({ type: "host_ready", roomCode: room.code, guests: this.guestInfos(room) });
      return () => {
        room.hostSinks.delete(sink);
        room.lastHostActivity = this.now();
      };
    }
    const guest = room.guests.get(id.seatId!)!;
    guest.sinks.add(sink);
    sink({ type: "welcome", seatId: guest.seatId, roomCode: room.code });
    if (guest.last) sink({ type: "snapshot", rev: guest.last.rev, snapshot: guest.last.snapshot });
    this.updatePresence(room, guest);
    return () => {
      guest.sinks.delete(sink);
      if (room.guests.get(guest.seatId) === guest) this.updatePresence(room, guest);
    };
  }

  /**
   * HTTP fallback for guests whose event stream is blocked/buffered: returns the newest message newer than `afterId`
   * (ids are the hub's publish counter) and marks the guest present for POLL_PRESENCE_MS.
   */
  poll(token: string, afterId: number): PollResult {
    const ended = this.ended.get(hashToken(token ?? ""));
    if (ended) return { seatId: "", roomCode: "", closed: true, reason: ended };
    const id = this.identify(token);
    if (id?.role !== "guest") throw new HubError(401, "Invalid token");
    const room = this.rooms.get(id.roomCode)!;
    const guest = room.guests.get(id.seatId!)!;
    guest.lastPoll = this.now();
    this.updatePresence(room, guest);
    const result: PollResult = { seatId: guest.seatId, roomCode: room.code };
    if (guest.last && guest.last.id > afterId) result.message = guest.last;
    return result;
  }

  // ---- host commands ----
  publish(hostToken: string, toSeatId: SlotId | "all", snapshot: unknown, rev: number): void {
    const room = this.requireHost(hostToken);
    const size = Buffer.byteLength(JSON.stringify(snapshot) ?? "");
    if (size > MAX_PUBLISH_BYTES) throw new HubError(413, "Snapshot too large");
    const targets = toSeatId === "all" ? [...room.guests.values()] : [room.guests.get(toSeatId)];
    if (toSeatId !== "all" && !targets[0]) throw new HubError(404, "Unknown seat");
    for (const g of targets) {
      if (!g) continue;
      g.last = { id: ++room.msgCounter, rev, snapshot };
      for (const sink of [...g.sinks]) sink({ type: "snapshot", rev, snapshot });
    }
  }

  kick(hostToken: string, seatId: SlotId): void {
    const room = this.requireHost(hostToken);
    const guest = room.guests.get(seatId);
    if (!guest) throw new HubError(404, "Unknown seat");
    room.guests.delete(seatId);
    this.tokens.delete(guest.tokenHash);
    this.markEnded(guest.tokenHash, "kicked");
    for (const sink of [...guest.sinks]) sink({ type: "error", message: "You were removed from the room" });
    guest.sinks.clear();
    guest.announced = false;
    this.emitToHost(room, { type: "guest_left", seatId });
  }

  closeRoom(hostToken: string): void {
    this.destroyRoom(this.requireHost(hostToken));
  }

  // ---- guest commands ----
  intent(seatToken: string, name: string, args: unknown[], clientSeq: number): void {
    const id = this.identify(seatToken);
    if (id?.role !== "guest") throw new HubError(401, "Invalid token");
    const room = this.rooms.get(id.roomCode)!;
    const guest = room.guests.get(id.seatId!)!;
    if (Buffer.byteLength(JSON.stringify({ name, args })) > MAX_INTENT_BYTES) {
      throw new HubError(413, "Intent too large");
    }
    const t = this.now();
    guest.intentTimes = guest.intentTimes.filter((x) => t - x < 1000);
    if (guest.intentTimes.length >= MAX_INTENTS_PER_SECOND) throw new HubError(429, "Too many intents");
    guest.intentTimes.push(t);
    if (room.hostSinks.size === 0) throw new HubError(409, "Host is not connected");
    this.emitToHost(room, { type: "intent", fromSeatId: guest.seatId, name, args, clientSeq });
  }

  // ---- housekeeping ----
  /** Drop rooms whose host has been away longer than the idle expiry. Called lazily on requests. */
  sweep(): void {
    const t = this.now();
    for (const room of [...this.rooms.values()]) {
      if (room.hostSinks.size > 0) room.lastHostActivity = t;
      else if (t - room.lastHostActivity > this.idleExpiryMs) {
        this.destroyRoom(room);
        continue;
      }
      for (const g of room.guests.values()) this.updatePresence(room, g);
    }
  }

  private isConnected(g: Guest): boolean {
    return g.sinks.size > 0 || (g.lastPoll !== undefined && this.now() - g.lastPoll < this.pollPresenceMs);
  }

  /** Tell the host when a guest becomes connected (stream or recent poll) or stops being so. */
  private updatePresence(room: Room, g: Guest): void {
    const connected = this.isConnected(g);
    if (connected && !g.announced) {
      g.announced = true;
      this.emitToHost(room, { type: "guest_joined", seatId: g.seatId, displayName: g.displayName });
    } else if (!connected && g.announced) {
      g.announced = false;
      this.emitToHost(room, { type: "guest_left", seatId: g.seatId });
    }
  }

  private markEnded(hash: string, reason: "room_closed" | "kicked"): void {
    if (this.ended.size > 2000) this.ended.delete(this.ended.keys().next().value as string);
    this.ended.set(hash, reason);
  }

  /** Run presence checks without waiting for a request (guests that only poll lapse silently). Returns a stop function. */
  startPresenceTimer(intervalMs = 2000): () => void {
    const timer = setInterval(() => this.sweep(), intervalMs);
    (timer as { unref?: () => void }).unref?.();
    return () => clearInterval(timer);
  }

  private destroyRoom(room: Room): void {
    for (const g of room.guests.values()) {
      for (const sink of [...g.sinks]) sink({ type: "room_closed" });
      g.sinks.clear();
      this.tokens.delete(g.tokenHash);
      this.markEnded(g.tokenHash, "room_closed");
    }
    this.tokens.delete(room.hostTokenHash);
    room.hostSinks.clear();
    this.rooms.delete(room.code);
  }

  private requireRoom(code: string): Room {
    const room = this.rooms.get(code.trim().toUpperCase());
    if (!room) throw new HubError(404, "Room not found");
    return room;
  }

  private requireHost(token: string): Room {
    const id = this.identify(token);
    if (id?.role !== "host") throw new HubError(401, "Invalid host token");
    const room = this.rooms.get(id.roomCode)!;
    room.lastHostActivity = this.now();
    return room;
  }

  private emitToHost(room: Room, msg: StreamEvent): void {
    for (const sink of [...room.hostSinks]) sink(msg);
  }

  private guestInfos(room: Room): GuestInfo[] {
    return [...room.guests.values()].map((g) => ({
      seatId: g.seatId,
      displayName: g.displayName,
      connected: this.isConnected(g)
    }));
  }
}

const HUB_KEY = Symbol.for("mtg-ai.multiplayer.hub");

/** Process-wide singleton on globalThis (Next may bundle each route separately). */
export function getHub(): MultiplayerHub {
  const g = globalThis as unknown as Record<symbol, MultiplayerHub | undefined>;
  if (!g[HUB_KEY]) {
    const created = new MultiplayerHub();
    created.startPresenceTimer();
    g[HUB_KEY] = created;
  }
  return g[HUB_KEY]!;
}
