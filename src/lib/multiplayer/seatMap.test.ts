import { describe, expect, it } from "vitest";
import { REMOTE_UNASSIGNED, assignSlots, hostHumanSeat, missingGuests, remoteSeatIds, seatForSlot, slotForSeat } from "./seatMap";
import type { GuestInfo } from "./protocol";
import type { GameSession } from "../types";

const g = (seatId: string, connected = true): GuestInfo => ({ seatId, displayName: seatId, connected });
const cfg = (seatId: string, remote = false, slot = REMOTE_UNASSIGNED) => ({ seatId, remoteSlot: remote ? slot : undefined });

describe("seatMap", () => {
  const seats = [cfg("a"), cfg("b", true), cfg("c"), cfg("d", true)];
  it("assigns connected guests to remote seats in seat order", () => {
    expect(assignSlots(seats, [g("guest-2"), g("guest-1")])).toEqual({ "guest-1": "b", "guest-2": "d" });
  });
  it("ignores disconnected guests and reports missing seats", () => {
    expect(assignSlots(seats, [g("guest-1"), g("guest-2", false)])).toEqual({ "guest-1": "b" });
    expect(missingGuests(seats, [g("guest-1"), g("guest-2", false)])).toEqual(["d"]);
    expect(missingGuests(seats, [])).toEqual(["b", "d"]);
    expect(missingGuests(seats, [g("guest-1"), g("guest-2")])).toEqual([]);
    expect(missingGuests([cfg("a")], [])).toEqual([]);
  });
  it("is stable: a seat keeps its slot while that guest stays connected", () => {
    const placed = [cfg("b", true, "guest-2"), cfg("d", true)];
    expect(assignSlots(placed, [g("guest-1"), g("guest-2")])).toEqual({ "guest-2": "b", "guest-1": "d" });
  });
  it("extra guests stay unassigned", () => {
    expect(assignSlots([cfg("b", true)], [g("guest-1"), g("guest-2")])).toEqual({ "guest-1": "b" });
  });
  it("session lookups", () => {
    const session = { seats: [{ id: "a", kind: "human" }, { id: "b", kind: "human", remoteSlot: "guest-1" }] } as unknown as GameSession;
    expect(remoteSeatIds(session)).toEqual(["b"]);
    expect(slotForSeat(session, "b")).toBe("guest-1");
    expect(slotForSeat(session, "a")).toBeUndefined();
    expect(seatForSlot(session, "guest-1")).toBe("b");
    expect(seatForSlot(session, "guest-9")).toBeUndefined();
  });
  it("hostHumanSeat prefers the human seat without remoteSlot", () => {
    const s = [{ id: "r", kind: "human", remoteSlot: "guest-1" }, { id: "h", kind: "human" }, { id: "x", kind: "agent" }] as never[];
    expect((hostHumanSeat(s) as unknown as { id: string }).id).toBe("h");
    expect(hostHumanSeat([{ kind: "agent" as const }])).toBeUndefined();
  });
});
