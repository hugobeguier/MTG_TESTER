import { describe, expect, it } from "vitest";
import { PublishGate, connectedGuests, guestReducer, hostReducer, initialGuestState, initialHostState, reconnectDelayMs, type GuestState, type HostState } from "./connectionState";
import type { MpSnapshot } from "./snapshot";

const snap = (rev: number) => ({ v: 1, rev, session: { seats: [] } }) as unknown as MpSnapshot;

describe("hostReducer", () => {
  it("tracks room creation and guests joining and leaving", () => {
    let s: HostState = hostReducer(initialHostState, { type: "creating" });
    s = hostReducer(s, { type: "created", roomCode: "ABC234" });
    expect(s).toMatchObject({ status: "waiting", roomCode: "ABC234" });
    s = hostReducer(s, { type: "event", event: { type: "guest_joined", seatId: "guest-1", displayName: "Ann" } });
    expect(s.status).toBe("live");
    s = hostReducer(s, { type: "event", event: { type: "guest_joined", seatId: "guest-1", displayName: "Ann" } });
    expect(s.guests).toHaveLength(1);
    s = hostReducer(s, { type: "event", event: { type: "guest_left", seatId: "guest-1" } });
    expect(s.status).toBe("waiting");
    expect(connectedGuests(s)).toHaveLength(0);
    expect(s.guests[0].connected).toBe(false);
  });

  it("host_ready restores the guest list after a reconnect", () => {
    let s = hostReducer(hostReducer(initialHostState, { type: "creating" }), { type: "created", roomCode: "X" });
    s = hostReducer(s, { type: "stream_lost" });
    expect(s.status).toBe("reconnecting");
    s = hostReducer(s, { type: "event", event: { type: "host_ready", roomCode: "X", guests: [{ seatId: "guest-1", displayName: "A", connected: true }] } });
    expect(s.status).toBe("live");
  });

  it("does not leave the closed/error states on a stray stream_lost", () => {
    expect(hostReducer({ ...initialHostState, status: "closed" }, { type: "stream_lost" }).status).toBe("closed");
  });
});

describe("PublishGate", () => {
  it("skips unchanged content and hands out increasing revs", () => {
    const g = new PublishGate();
    expect(g.admit("a")).toBe(1);
    expect(g.admit("a")).toBeUndefined();
    expect(g.admit("b")).toBe(2);
  });
  it("force() republishes unchanged content once; failed() retries it", () => {
    const g = new PublishGate();
    g.admit("a");
    g.force();
    expect(g.admit("a")).toBe(2);
    expect(g.admit("a")).toBeUndefined();
    g.failed();
    expect(g.admit("a")).toBe(3);
  });
});

describe("guestReducer", () => {
  it("goes joining -> connecting -> waiting -> live and ignores stale snapshots", () => {
    let s: GuestState = guestReducer(initialGuestState, { type: "joining" });
    s = guestReducer(s, { type: "connecting" });
    s = guestReducer(s, { type: "stream_open" });
    expect(s.status).toBe("waiting");
    s = guestReducer(s, { type: "snapshot", rev: 3, snapshot: snap(3) });
    expect(s).toMatchObject({ status: "live", rev: 3 });
    s = guestReducer(s, { type: "snapshot", rev: 2, snapshot: snap(2) });
    expect(s.rev).toBe(3);
  });

  it("keeps the last snapshot while reconnecting and goes live again on open", () => {
    let s = guestReducer(guestReducer(initialGuestState, { type: "connecting" }), { type: "snapshot", rev: 1, snapshot: snap(1) });
    s = guestReducer(s, { type: "stream_lost" });
    expect(s).toMatchObject({ status: "reconnecting", rev: 1 });
    s = guestReducer(s, { type: "stream_open" });
    expect(s.status).toBe("live");
  });

  it("room_closed and fatal errors are terminal for stream_lost", () => {
    const closed = guestReducer(initialGuestState, { type: "room_closed" });
    expect(guestReducer(closed, { type: "stream_lost" }).status).toBe("closed");
    expect(guestReducer(initialGuestState, { type: "error", message: "x" })).toMatchObject({ status: "error", error: "x" });
  });
});

describe("reconnectDelayMs", () => {
  it("backs off and caps", () => {
    expect([0, 1, 2, 3].map(reconnectDelayMs)).toEqual([1000, 2000, 4000, 8000]);
    expect(reconnectDelayMs(10)).toBe(15_000);
  });
});

describe("lobby state", () => {
  const lobby = (rev: number) => ({ kind: "lobby", v: 1, rev, hostName: "H", seats: [], hostDecks: [] }) as unknown as import("./lobby").LobbyMessage;
  it("guest keeps the newest lobby and a lobby replaces a stale table", () => {
    let s = guestReducer({ ...initialGuestState, status: "live", rev: 5, snapshot: snap(5) }, { type: "lobby", message: lobby(2) });
    expect(s.snapshot).toBeUndefined();
    expect(s.status).toBe("waiting");
    s = guestReducer(s, { type: "lobby", message: lobby(1) });
    expect(s.lobby?.rev).toBe(2);
  });
  it("host drops a removed guest", () => {
    let s = hostReducer(hostReducer(initialHostState, { type: "creating" }), { type: "created", roomCode: "X" });
    s = hostReducer(s, { type: "event", event: { type: "guest_joined", seatId: "guest-1", displayName: "A" } });
    s = hostReducer(s, { type: "guest_removed", seatId: "guest-1" });
    expect(s.guests).toEqual([]);
    expect(s.status).toBe("waiting");
  });
});
