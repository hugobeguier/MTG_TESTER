import { describe, expect, it } from "vitest";
import { MultiplayerHub } from "./hub";
import { HubError, MAX_INTENT_BYTES, MAX_PUBLISH_BYTES, type StreamEvent } from "./protocol";

function setup(maxGuests = 3) {
  let t = 1_000_000;
  const hub = new MultiplayerHub({ now: () => t, idleExpiryMs: 1000 });
  const room = hub.createRoom("host", maxGuests);
  const advance = (ms: number) => (t += ms);
  return { hub, room, advance };
}
const collect = () => {
  const msgs: StreamEvent[] = [];
  return { msgs, sink: (m: StreamEvent) => void msgs.push(m) };
};
const status = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return e instanceof HubError ? e.status : -1;
  }
  return 0;
};

describe("MultiplayerHub", () => {
  it("creates rooms with a short unambiguous code", () => {
    const { room } = setup();
    expect(room.roomCode).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(room.hostToken.length).toBeGreaterThan(20);
  });

  it("joins, enforces capacity, and is case-insensitive on code", () => {
    const { hub, room } = setup(2);
    expect(hub.join(room.roomCode.toLowerCase(), "a").seatId).toBe("guest-1");
    expect(hub.join(room.roomCode, "b").seatId).toBe("guest-2");
    expect(status(() => hub.join(room.roomCode, "c"))).toBe(409);
    expect(status(() => hub.join("NOPE22", "c"))).toBe(404);
    expect(hub.guestCount(room.roomCode)).toBe(2);
    expect(hub.roomCount).toBe(1);
  });

  it("reconnect with seat token resumes the same slot; bad token rejected", () => {
    const { hub, room } = setup(1);
    const a = hub.join(room.roomCode, "a");
    expect(hub.join(room.roomCode, "a", a.seatToken)).toEqual(a);
    expect(status(() => hub.join(room.roomCode, "a", "bogus"))).toBe(401);
    expect(status(() => hub.subscribe("bogus", () => {}))).toBe(401);
  });

  it("routes publish to one seat or all, and replays last snapshot on resubscribe", () => {
    const { hub, room } = setup();
    const a = hub.join(room.roomCode, "a");
    const b = hub.join(room.roomCode, "b");
    const ca = collect();
    const cb = collect();
    const unsubA = hub.subscribe(a.seatToken, ca.sink);
    hub.subscribe(b.seatToken, cb.sink);
    hub.publish(room.hostToken, a.seatId, { x: 1 }, 1);
    expect(ca.msgs.at(-1)).toEqual({ type: "snapshot", rev: 1, snapshot: { x: 1 } });
    expect(cb.msgs.some((m) => m.type === "snapshot")).toBe(false);
    hub.publish(room.hostToken, "all", { y: 2 }, 2);
    expect(cb.msgs.at(-1)).toMatchObject({ rev: 2 });
    unsubA();
    hub.publish(room.hostToken, a.seatId, { z: 3 }, 3);
    const again = collect();
    hub.subscribe(a.seatToken, again.sink);
    expect(again.msgs.map((m) => m.type)).toEqual(["welcome", "snapshot"]);
    expect(again.msgs[1]).toMatchObject({ rev: 3, snapshot: { z: 3 } });
  });

  it("guest stream events reach host; intents are forwarded", () => {
    const { hub, room } = setup();
    const host = collect();
    hub.subscribe(room.hostToken, host.sink);
    expect(host.msgs[0]).toMatchObject({ type: "host_ready" });
    const a = hub.join(room.roomCode, "Ann");
    const unsub = hub.subscribe(a.seatToken, () => {});
    expect(host.msgs.at(-1)).toEqual({ type: "guest_joined", seatId: "guest-1", displayName: "Ann" });
    hub.intent(a.seatToken, "play", [1, 2], 7);
    expect(host.msgs.at(-1)).toEqual({ type: "intent", fromSeatId: "guest-1", name: "play", args: [1, 2], clientSeq: 7 });
    unsub();
    expect(host.msgs.at(-1)).toEqual({ type: "guest_left", seatId: "guest-1" });
  });

  it("rejects wrong roles, offline host, and oversize payloads", () => {
    const { hub, room } = setup();
    const a = hub.join(room.roomCode, "a");
    expect(status(() => hub.intent(room.hostToken, "x", [], 1))).toBe(401);
    expect(status(() => hub.publish(a.seatToken, "all", {}, 1))).toBe(401);
    expect(status(() => hub.intent(a.seatToken, "x", [], 1))).toBe(409); // no host stream
    hub.subscribe(room.hostToken, () => {});
    expect(status(() => hub.intent(a.seatToken, "x", ["a".repeat(MAX_INTENT_BYTES)], 1))).toBe(413);
    expect(status(() => hub.publish(room.hostToken, "all", "a".repeat(MAX_PUBLISH_BYTES), 1))).toBe(413);
    expect(status(() => hub.publish(room.hostToken, "guest-9", {}, 1))).toBe(404);
  });

  it("rate limits intents per guest per second", () => {
    const { hub, room, advance } = setup();
    hub.subscribe(room.hostToken, () => {});
    const a = hub.join(room.roomCode, "a");
    for (let i = 0; i < 30; i++) hub.intent(a.seatToken, "x", [], i);
    expect(status(() => hub.intent(a.seatToken, "x", [], 99))).toBe(429);
    advance(1001);
    expect(status(() => hub.intent(a.seatToken, "x", [], 100))).toBe(0);
  });

  it("kick revokes the seat token and frees the slot", () => {
    const { hub, room } = setup(1);
    const a = hub.join(room.roomCode, "a");
    const c = collect();
    hub.subscribe(a.seatToken, c.sink);
    hub.kick(room.hostToken, a.seatId);
    expect(c.msgs.at(-1)?.type).toBe("error");
    expect(status(() => hub.subscribe(a.seatToken, () => {}))).toBe(401);
    expect(hub.join(room.roomCode, "b").seatId).toBe("guest-2");
  });

  it("closeRoom notifies guests and invalidates tokens", () => {
    const { hub, room } = setup();
    const a = hub.join(room.roomCode, "a");
    const c = collect();
    hub.subscribe(a.seatToken, c.sink);
    hub.closeRoom(room.hostToken);
    expect(c.msgs.at(-1)).toEqual({ type: "room_closed" });
    expect(hub.roomCount).toBe(0);
    expect(hub.identify(room.hostToken)).toBeUndefined();
  });

  it("expires rooms whose host has been away too long, not ones with a connected host", () => {
    const { hub, room, advance } = setup();
    const unsub = hub.subscribe(room.hostToken, () => {});
    advance(5000);
    hub.sweep();
    expect(hub.roomCount).toBe(1);
    unsub();
    advance(1001);
    hub.sweep();
    expect(hub.roomCount).toBe(0);
  });
});
