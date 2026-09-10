import { describe, expect, it } from "vitest";
import { canReceivePriorityForPendingAction } from "./AppFlow";
import { DEFAULT_STOP_SETTINGS, stopKey, type PriorityStopSettings } from "@/lib/priorityStops";
import type { GameSession, ManaPool, PlayerSeat, VisibleCard } from "@/lib/types";

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "typeLine">): VisibleCard {
  return { oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "battlefield", ...overrides };
}

function seat(overrides: Partial<PlayerSeat> & Pick<PlayerSeat, "id" | "name" | "kind">): PlayerSeat {
  return {
    life: 40,
    commanderDamage: {},
    zones: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield: [] },
    ...overrides
  };
}

function session(seats: PlayerSeat[], phase: string): GameSession {
  return {
    id: "test",
    createdAt: "",
    status: "playing",
    phase,
    turn: 3,
    xmage: { enabled: false, status: "not_configured", message: "" },
    seats,
    events: []
  };
}

function emptyPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

// A phase-pass action belonging to the ACTIVE seat (Sable) — the exact shape advanceTurn() builds
// when a turn auto-advances into a new phase, which is what a human's own stop check runs against.
function phaseAction(actorSeatId: string) {
  return { id: "action-1", type: "phase" as const, actorSeatId, message: "" };
}

describe("canReceivePriorityForPendingAction — priority Stops detection gap (reported live)", () => {
  it("recognizes a genuine zero-cost 'Sacrifice a creature: ...' activated ability as a legal response", () => {
    // Real oracle text, verified via local card DB.
    const viscera = card({ id: "vs", name: "Viscera Seer", typeLine: "Creature — Vampire Wizard", oracleText: "Sacrifice a creature: Scry 1." });
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const human = seat({ id: "human", name: "You", kind: "human", board: { hand: [], battlefield: [viscera, bear] } });
    const sable = seat({ id: "sable", name: "Sable", kind: "agent" });
    const s = session([human, sable], "end step");
    // Sable is turnOwnerSeatIndex 1 — the default grid already ticks exactly this for every agent
    // seat's end step (see priorityStops.ts's defaultPhaseStops).
    const stops: PriorityStopSettings = { ...DEFAULT_STOP_SETTINGS, phaseStops: { [stopKey("end step", 1)]: true } };
    const pools: Record<string, ManaPool> = { human: emptyPool(), sable: emptyPool() };

    const stopped = canReceivePriorityForPendingAction(human, phaseAction("sable"), "sable", s, pools, stops, undefined);
    expect(stopped).toBe(true);
  });

  it("recognizes an affordable instant in hand, with mana untapped but not yet floating, as a legal response", () => {
    // Real oracle text, verified via local card DB.
    const bolt = card({ id: "bolt", name: "Lightning Bolt", typeLine: "Instant", oracleText: "Lightning Bolt deals 3 damage to any target.", manaCost: "{R}", manaValue: 1, zone: "hand" });
    const mountain = card({ id: "m1", name: "Mountain", typeLine: "Basic Land — Mountain" });
    const human = seat({ id: "human", name: "You", kind: "human", board: { hand: [bolt], battlefield: [mountain] } });
    const sable = seat({ id: "sable", name: "Sable", kind: "agent" });
    const s = session([human, sable], "end step");
    const stops: PriorityStopSettings = { ...DEFAULT_STOP_SETTINGS, phaseStops: { [stopKey("end step", 1)]: true } };
    const pools: Record<string, ManaPool> = { human: emptyPool(), sable: emptyPool() };

    const stopped = canReceivePriorityForPendingAction(human, phaseAction("sable"), "sable", s, pools, stops, undefined);
    expect(stopped).toBe(true);
  });

  it("does NOT stop when the human genuinely has nothing to do (regression guard on the fast-turns optimization)", () => {
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const human = seat({ id: "human", name: "You", kind: "human", board: { hand: [], battlefield: [bear] } });
    const sable = seat({ id: "sable", name: "Sable", kind: "agent" });
    const s = session([human, sable], "end step");
    const stops: PriorityStopSettings = { ...DEFAULT_STOP_SETTINGS, phaseStops: { [stopKey("end step", 1)]: true } };
    const pools: Record<string, ManaPool> = { human: emptyPool(), sable: emptyPool() };

    const stopped = canReceivePriorityForPendingAction(human, phaseAction("sable"), "sable", s, pools, stops, undefined);
    expect(stopped).toBe(false);
  });

  it("does not stop for an untapped Viscera Seer with a legal ability if the phase box isn't ticked (sanity check on the fixture itself)", () => {
    const viscera = card({ id: "vs", name: "Viscera Seer", typeLine: "Creature — Vampire Wizard", oracleText: "Sacrifice a creature: Scry 1." });
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const human = seat({ id: "human", name: "You", kind: "human", board: { hand: [], battlefield: [viscera, bear] } });
    const sable = seat({ id: "sable", name: "Sable", kind: "agent" });
    const s = session([human, sable], "declare attackers step");
    const stops: PriorityStopSettings = { ...DEFAULT_STOP_SETTINGS, phaseStops: { [stopKey("end step", 1)]: true } };
    const pools: Record<string, ManaPool> = { human: emptyPool(), sable: emptyPool() };

    const stopped = canReceivePriorityForPendingAction(human, phaseAction("sable"), "sable", s, pools, stops, undefined);
    expect(stopped).toBe(false);
  });
});
