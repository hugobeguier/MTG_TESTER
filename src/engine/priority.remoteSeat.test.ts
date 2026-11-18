import { describe, expect, it } from "vitest";
import { canReceivePriorityForPendingAction, nextPrioritySeatId, pendingActionRequiredPasses } from "./priority";
import { DEFAULT_STOP_SETTINGS } from "@/lib/priorityStops";
import { priorityStopsForSeat, remoteSeatCanAct, remoteSeatsCanAct } from "@/lib/multiplayer/remoteSeatPolicy";
import { defaultSeatStopSettings } from "@/lib/multiplayer/seatStops";
import type { GameSession, ManaPool, PlayerSeat } from "@/lib/types";

function seat(id: string, kind: "human" | "agent", extra: Partial<PlayerSeat> = {}): PlayerSeat {
  return { id, name: id, kind, life: 40, commanderDamage: {}, zones: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 }, board: { hand: [], battlefield: [] }, ...extra };
}
// A zero-cost instant-speed ability is a real response, so a human seat holding one is waited on (see canReceivePriorityForPendingAction).
const seer = (id: string) => ({ id, name: "Viscera Seer", typeLine: "Creature - Vampire Wizard", oracleText: "Sacrifice a creature: Scry 1.", manaValue: 1, colors: [], role: "permanent", zone: "battlefield" }) as PlayerSeat["board"]["battlefield"][number];
const withSeer = (id: string): PlayerSeat["board"] => ({ hand: [], battlefield: [seer(id)] });
const host = seat("host", "human", { board: withSeer("s1") });
const friend = seat("friend", "human", { remoteSlot: "guest-1", board: withSeer("s2") });
const bot = seat("bot", "agent");
const seats = [host, friend, bot];
const session = { id: "t", createdAt: "", status: "playing", phase: "untap step", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] } as GameSession;
const pools: Record<string, ManaPool> = {};
const fullControl = { ...DEFAULT_STOP_SETTINGS, fullControl: true };
const phase = (actor: string) => ({ id: "a", type: "phase" as const, actorSeatId: actor, message: "" });

describe("remote seats and priority", () => {
  it("ships with remote seats able to act (they play through intents)", () => {
    expect(remoteSeatsCanAct).toBe(true);
    expect(remoteSeatCanAct(friend)).toBe(true);
    expect(remoteSeatCanAct(host)).toBe(true);
    expect(remoteSeatCanAct(friend, false)).toBe(false);
  });

  it("while remote seats are switched off, a remote seat is never waited on, even with full control", () => {
    expect(canReceivePriorityForPendingAction(friend, phase("host"), "host", session, pools, fullControl, undefined, false)).toBe(false);
    expect(pendingActionRequiredPasses(seats, phase("host"), "host", session, pools, fullControl, undefined, false)).toEqual(["host"]);
  });

  it("the host's own grid and Full Control never decide whether the friend is asked", () => {
    // untap step of the host's turn: the host's Full Control asks the host, but the friend follows their OWN (default) stops and is not asked
    expect(pendingActionRequiredPasses(seats, phase("host"), "host", session, pools, fullControl, undefined)).toEqual(["host"]);
    expect(pendingActionRequiredPasses(seats, phase("host"), "host", session, pools, DEFAULT_STOP_SETTINGS, undefined)).toEqual([]);
  });

  it("the friend gets the SAME default stops as the host: not asked at every phase, even with a free response", () => {
    for (const p of ["untap step", "upkeep step", "draw step", "precombat main phase", "beginning of combat step", "combat damage step", "cleanup step"]) {
      expect(canReceivePriorityForPendingAction(friend, phase("host"), "host", { ...session, phase: p }, pools, DEFAULT_STOP_SETTINGS, undefined), p).toBe(false);
    }
  });

  it("the friend is asked at their own default stops, on stack responses, and where the default grid has an opponent's step", () => {
    const own = { ...session, phase: "precombat main phase" };
    expect(canReceivePriorityForPendingAction(friend, phase("friend"), "friend", own, pools, DEFAULT_STOP_SETTINGS, undefined)).toBe(true);
    expect(canReceivePriorityForPendingAction(friend, phase("host"), "host", { ...session, phase: "end step" }, pools, DEFAULT_STOP_SETTINGS, undefined)).toBe(true);
    const spell = { id: "s", type: "spell" as const, actorSeatId: "host", message: "" } as never;
    expect(canReceivePriorityForPendingAction(friend, spell, "host", session, pools, DEFAULT_STOP_SETTINGS, undefined)).toBe(true);
  });

  it("the friend's OWN settings decide: Full Control, Stop Next, a switched-off stack response, a ticked phase", () => {
    const withSeat = (patch: object) => ({ ...DEFAULT_STOP_SETTINGS, bySeat: { friend: { ...defaultSeatStopSettings(1, 3), ...patch } } });
    expect(canReceivePriorityForPendingAction(friend, phase("host"), "host", session, pools, withSeat({ fullControl: true }), undefined)).toBe(true);
    expect(canReceivePriorityForPendingAction(friend, phase("host"), "host", session, pools, withSeat({ holdOnce: true }), undefined)).toBe(true);
    const spell = { id: "s", type: "spell" as const, actorSeatId: "host", message: "" } as never;
    expect(canReceivePriorityForPendingAction(friend, spell, "host", session, pools, withSeat({ stopOnStackResponse: false, stopOnAttacked: false, stopOnTargeted: false }), undefined)).toBe(false);
    expect(canReceivePriorityForPendingAction(friend, phase("host"), "host", session, pools, withSeat({ phaseStops: { "0:untap step": true } }), undefined)).toBe(true);
    // the host's Full Control does not leak into the friend's seat
    expect(canReceivePriorityForPendingAction(friend, phase("host"), "host", session, pools, { ...fullControl, bySeat: { friend: defaultSeatStopSettings(1, 3) } }, undefined)).toBe(false);
  });

  it("a remote seat with nothing to respond with is not waited on", () => {
    const idle = seat("idle", "human", { remoteSlot: "guest-2" });
    expect(pendingActionRequiredPasses([host, idle, bot], phase("host"), "host", { ...session, seats: [host, idle, bot] }, pools, DEFAULT_STOP_SETTINGS, undefined)).toEqual([]);
  });

  it("priority passes to the remote seat after the host, and back (friend on Full Control)", () => {
    const stops = { ...DEFAULT_STOP_SETTINGS, fullControl: true, bySeat: { friend: { ...defaultSeatStopSettings(1, 3), fullControl: true } } };
    expect(nextPrioritySeatId(seats, "host", ["host"], phase("host"), "host", session, pools, stops, undefined)).toBe("friend");
    expect(nextPrioritySeatId(seats, "host", ["host", "friend"], phase("host"), "host", session, pools, stops, undefined)).toBe("host");
  });

  it("solo (no remote seats) is unaffected", () => {
    const solo = [host, bot];
    expect(pendingActionRequiredPasses(solo, phase("host"), "host", { ...session, seats: solo }, pools, fullControl, undefined)).toEqual(["host"]);
  });

  it("a friend with no real response is never waited on, whatever their settings (no deadlock)", () => {
    const idle = seat("idle", "human", { remoteSlot: "guest-2" });
    const all = [host, idle, bot];
    const stops = { ...DEFAULT_STOP_SETTINGS, bySeat: { idle: { ...defaultSeatStopSettings(1, 3), fullControl: true, holdOnce: true } } };
    expect(pendingActionRequiredPasses(all, phase("host"), "host", { ...session, seats: all }, pools, stops, undefined)).toEqual([]);
  });

  it("default seat stops mirror the host's grid from the friend's seat", () => {
    const stops = defaultSeatStopSettings(1, 3);
    expect(Object.keys(stops.phaseStops).sort()).toEqual(["0:declare blockers step", "0:end step", "1:declare attackers step", "1:postcombat main phase", "1:precombat main phase", "2:declare blockers step", "2:end step"]);
    expect(stops.fullControl).toBe(false);
    expect(priorityStopsForSeat(friend, DEFAULT_STOP_SETTINGS, 1, 3)).toEqual(stops);
    expect(priorityStopsForSeat(host, DEFAULT_STOP_SETTINGS, 0, 3)).toBe(DEFAULT_STOP_SETTINGS);
  });
});
