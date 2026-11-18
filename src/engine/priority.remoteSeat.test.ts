import { describe, expect, it } from "vitest";
import { canReceivePriorityForPendingAction, nextPrioritySeatId, pendingActionRequiredPasses } from "./priority";
import { DEFAULT_STOP_SETTINGS } from "@/lib/priorityStops";
import { priorityStopsForSeat, remoteSeatCanAct, remoteSeatsCanAct, remoteTurnStopSettings } from "@/lib/multiplayer/remoteSeatPolicy";
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

  it("waits for the remote seat whenever it holds a real response, whatever the HOST's stop settings say", () => {
    expect(pendingActionRequiredPasses(seats, phase("host"), "host", session, pools, fullControl, undefined)).toEqual(["host", "friend"]);
    // default argument = the shipped policy; the host's default grid does not stop on its own untap step, the friend still gets the window
    expect(pendingActionRequiredPasses(seats, phase("host"), "host", session, pools, DEFAULT_STOP_SETTINGS, undefined)).toEqual(["friend"]);
    expect(canReceivePriorityForPendingAction(friend, phase("host"), "host", session, pools, { ...DEFAULT_STOP_SETTINGS, stopOnStackResponse: false, stopOnAttacked: false, stopOnTargeted: false }, undefined)).toBe(true);
  });

  it("a remote seat with nothing to respond with is not waited on", () => {
    const idle = seat("idle", "human", { remoteSlot: "guest-2" });
    expect(pendingActionRequiredPasses([host, idle, bot], phase("host"), "host", { ...session, seats: [host, idle, bot] }, pools, DEFAULT_STOP_SETTINGS, undefined)).toEqual([]);
  });

  it("priority passes to the remote seat after the host, and back", () => {
    expect(nextPrioritySeatId(seats, "host", ["host"], phase("host"), "host", session, pools, fullControl, undefined)).toBe("friend");
    expect(nextPrioritySeatId(seats, "host", ["host", "friend"], phase("host"), "host", session, pools, fullControl, undefined)).toBe("host");
  });

  it("solo (no remote seats) is unaffected", () => {
    const solo = [host, bot];
    expect(pendingActionRequiredPasses(solo, phase("host"), "host", { ...session, seats: solo }, pools, fullControl, undefined)).toEqual(["host"]);
  });

  it("a friend's own phase window asks the friend only when they have a response; the host is asked as well", () => {
    expect(pendingActionRequiredPasses(seats, phase("friend"), "friend", session, pools, fullControl, undefined)).toEqual(["host", "friend"]);
  });

  it("the friend's own turn pauses on both main phases and the declare attackers step, never on the host's grid", () => {
    const stops = remoteTurnStopSettings(1);
    expect(Object.keys(stops.phaseStops).sort()).toEqual(["1:declare attackers step", "1:postcombat main phase", "1:precombat main phase"]);
    expect(stops.fullControl).toBe(false);
    expect(priorityStopsForSeat(friend, DEFAULT_STOP_SETTINGS).fullControl).toBe(true);
    expect(priorityStopsForSeat(host, DEFAULT_STOP_SETTINGS)).toBe(DEFAULT_STOP_SETTINGS);
  });
});
