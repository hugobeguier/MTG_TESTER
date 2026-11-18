import { describe, expect, it } from "vitest";
import { canReceivePriorityForPendingAction, nextPrioritySeatId, pendingActionRequiredPasses } from "./priority";
import { DEFAULT_STOP_SETTINGS } from "@/lib/priorityStops";
import { remoteSeatCanAct, remoteSeatsCanAct } from "@/lib/multiplayer/remoteSeatPolicy";
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
  it("ships with remote seats unable to act yet", () => {
    expect(remoteSeatsCanAct).toBe(false);
    expect(remoteSeatCanAct(friend)).toBe(false);
    expect(remoteSeatCanAct(host)).toBe(true);
  });

  it("never waits for a remote seat while it cannot act, even with full control", () => {
    expect(canReceivePriorityForPendingAction(friend, phase("host"), "host", session, pools, fullControl, undefined, false)).toBe(false);
    expect(pendingActionRequiredPasses(seats, phase("host"), "host", session, pools, fullControl, undefined, false)).toEqual(["host"]);
    // default argument = the shipped policy
    expect(pendingActionRequiredPasses(seats, phase("host"), "host", session, pools, fullControl, undefined)).toEqual(["host"]);
  });

  it("still waits for the remote seat once remote seats can act", () => {
    expect(pendingActionRequiredPasses(seats, phase("host"), "host", session, pools, fullControl, undefined, true)).toEqual(["host", "friend"]);
  });

  it("hands priority only to the host when the remote seat is skipped, and solo (no remote seats) is unaffected", () => {
    expect(nextPrioritySeatId(seats, "host", ["host"], phase("host"), "host", session, pools, fullControl, undefined, false)).toBe("host");
    const solo = [host, bot];
    expect(pendingActionRequiredPasses(solo, phase("host"), "host", { ...session, seats: solo }, pools, fullControl, undefined, false)).toEqual(["host"]);
  });

  it("a friend's own phase window requires no pass from the friend", () => {
    expect(pendingActionRequiredPasses(seats, phase("friend"), "friend", session, pools, fullControl, undefined, false)).toEqual(["host"]);
  });
});
