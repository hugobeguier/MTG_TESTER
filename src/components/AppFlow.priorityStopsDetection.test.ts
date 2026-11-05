import { describe, expect, it } from "vitest";
import { canReceivePriorityForPendingAction, pendingActionRequiredPasses } from "./AppFlow";
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

function pendingActionRequiredPassesForTest(seats: PlayerSeat[], action: never, activeSeatId: string, s: GameSession, pools: Record<string, ManaPool>, stops: PriorityStopSettings) {
  return pendingActionRequiredPasses(seats, action, activeSeatId, s, pools, stops, undefined);
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

  it("does NOT stop when the human has nothing to do and the step is not ticked (fast-turns optimization)", () => {
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const human = seat({ id: "human", name: "You", kind: "human", board: { hand: [], battlefield: [bear] } });
    const sable = seat({ id: "sable", name: "Sable", kind: "agent" });
    const s = session([human, sable], "end step");
    const stops: PriorityStopSettings = { ...DEFAULT_STOP_SETTINGS, phaseStops: {} };
    const pools: Record<string, ManaPool> = { human: emptyPool(), sable: emptyPool() };

    expect(canReceivePriorityForPendingAction(human, phaseAction("sable"), "sable", s, pools, stops, undefined)).toBe(false);
  });

  it("does NOT stop on a ticked opponent end step when the human has nothing castable", () => {
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const human = seat({ id: "human", name: "You", kind: "human", board: { hand: [], battlefield: [bear] } });
    const sable = seat({ id: "sable", name: "Sable", kind: "agent" });
    const s = session([human, sable], "end step");
    const stops: PriorityStopSettings = { ...DEFAULT_STOP_SETTINGS, phaseStops: { [stopKey("end step", 1)]: true } };
    const pools: Record<string, ManaPool> = { human: emptyPool(), sable: emptyPool() };

    expect(canReceivePriorityForPendingAction(human, phaseAction("sable"), "sable", s, pools, stops, undefined)).toBe(false);
  });

  it("does NOT stop on a ticked opponent end step when the human holds an instant but has no mana", () => {
    const bolt = card({ id: "bolt", name: "Lightning Bolt", typeLine: "Instant", oracleText: "Lightning Bolt deals 3 damage to any target.", manaCost: "{R}", manaValue: 1, zone: "hand" });
    const human = seat({ id: "human", name: "You", kind: "human", board: { hand: [bolt], battlefield: [] } });
    const sable = seat({ id: "sable", name: "Sable", kind: "agent" });
    const s = session([human, sable], "end step");
    const stops: PriorityStopSettings = { ...DEFAULT_STOP_SETTINGS, phaseStops: { [stopKey("end step", 1)]: true } };
    const pools: Record<string, ManaPool> = { human: emptyPool(), sable: emptyPool() };

    expect(canReceivePriorityForPendingAction(human, phaseAction("sable"), "sable", s, pools, stops, undefined)).toBe(false);
  });

  it("full control stops at an opponent's unticked step when an affordable instant exists", () => {
    const bolt = card({ id: "bolt", name: "Lightning Bolt", typeLine: "Instant", oracleText: "Lightning Bolt deals 3 damage to any target.", manaCost: "{R}", manaValue: 1, zone: "hand" });
    const mountain = card({ id: "m1", name: "Mountain", typeLine: "Basic Land — Mountain" });
    const human = seat({ id: "human", name: "You", kind: "human", board: { hand: [bolt], battlefield: [mountain] } });
    const sable = seat({ id: "sable", name: "Sable", kind: "agent" });
    const s = session([human, sable], "upkeep step");
    const stops: PriorityStopSettings = { ...DEFAULT_STOP_SETTINGS, phaseStops: {}, fullControl: true };
    const pools: Record<string, ManaPool> = { human: emptyPool(), sable: emptyPool() };

    expect(canReceivePriorityForPendingAction(human, phaseAction("sable"), "sable", s, pools, stops, undefined)).toBe(true);
  });

  it("an opponent's spell on the stack: no prompt with nothing castable, prompt with an affordable instant", () => {
    const spell = { id: "sp", type: "spell" as const, actorSeatId: "sable", cardId: "x", cardName: "Lim-Dul's Vault", cardTypeLine: "Instant", manaSourceIds: [], message: "" };
    const stops: PriorityStopSettings = { ...DEFAULT_STOP_SETTINGS, phaseStops: {} };
    const pools: Record<string, ManaPool> = { human: emptyPool(), sable: emptyPool() };
    const sable = seat({ id: "sable", name: "Sable", kind: "agent" });
    const idle = seat({ id: "human", name: "You", kind: "human", board: { hand: [], battlefield: [card({ id: "m", name: "Mountain", typeLine: "Basic Land — Mountain" })] } });
    expect(canReceivePriorityForPendingAction(idle, spell, "sable", session([idle, sable], "end step"), pools, stops, undefined)).toBe(false);
    const bolt = card({ id: "bolt", name: "Lightning Bolt", typeLine: "Instant", oracleText: "Lightning Bolt deals 3 damage to any target.", manaCost: "{R}", manaValue: 1, zone: "hand" });
    const ready = seat({ id: "human", name: "You", kind: "human", board: { hand: [bolt], battlefield: [card({ id: "m", name: "Mountain", typeLine: "Basic Land — Mountain" })] } });
    expect(canReceivePriorityForPendingAction(ready, spell, "sable", session([ready, sable], "end step"), pools, stops, undefined)).toBe(true);
  });

  it("an instant with no legal target is not a response (human is not asked to pass for it)", () => {
    const spell = { id: "sp", type: "spell" as const, actorSeatId: "sable", cardId: "x", cardName: "Lim-Dul's Vault", cardTypeLine: "Instant", manaSourceIds: [], message: "" };
    const stops: PriorityStopSettings = { ...DEFAULT_STOP_SETTINGS, phaseStops: {} };
    const pools: Record<string, ManaPool> = { human: emptyPool(), sable: emptyPool() };
    const sable = seat({ id: "sable", name: "Sable", kind: "agent" });
    const doom = card({ id: "doom", name: "Doom Blade", typeLine: "Instant", oracleText: "Destroy target nonblack creature.", manaCost: "{1}{B}", manaValue: 2, zone: "hand" });
    const swamps = [card({ id: "s1", name: "Swamp", typeLine: "Basic Land — Swamp" }), card({ id: "s2", name: "Swamp", typeLine: "Basic Land — Swamp" })];
    const human = seat({ id: "human", name: "You", kind: "human", board: { hand: [doom], battlefield: swamps } });
    expect(canReceivePriorityForPendingAction(human, spell, "sable", session([human, sable], "end step"), pools, stops, undefined)).toBe(false);
  });

  it("the human's OWN trigger with nothing to respond with resolves without a prompt", () => {
    const trigger = { id: "tr", type: "trigger" as const, actorSeatId: "human", controllerSeatId: "human", sourceCardId: "c", sourceCardName: "Some Trigger", triggerKind: "common" as const, effect: { kind: "draw", amount: 1 }, message: "" } as never;
    const stops: PriorityStopSettings = { ...DEFAULT_STOP_SETTINGS };
    const pools: Record<string, ManaPool> = { human: emptyPool(), sable: emptyPool() };
    const human = seat({ id: "human", name: "You", kind: "human" });
    const sable = seat({ id: "sable", name: "Sable", kind: "agent" });
    expect(pendingActionRequiredPassesForTest([human, sable], trigger, "human", session([human, sable], "precombat main phase"), pools, stops)).toEqual([]);
    // An agent's trigger still needs its controller's pass.
    const agentTrigger = { ...(trigger as object), actorSeatId: "sable", controllerSeatId: "sable" } as never;
    expect(pendingActionRequiredPassesForTest([human, sable], agentTrigger, "human", session([human, sable], "precombat main phase"), pools, stops)).toEqual(["sable"]);
  });

  describe("agent triggers open a response window for the human (rule 603.3: every trigger gives all players priority)", () => {
    const bolt = () => card({ id: "bolt", name: "Lightning Bolt", typeLine: "Instant", oracleText: "Lightning Bolt deals 3 damage to any target.", manaCost: "{R}", manaValue: 1, zone: "hand" });
    const mountain = () => card({ id: "m1", name: "Mountain", typeLine: "Basic Land — Mountain" });
    const agentTrigger = (id: string, controller = "sable") =>
      ({ id, type: "trigger" as const, actorSeatId: controller, controllerSeatId: controller, sourceCardId: "c", sourceCardName: "Some Trigger", triggerKind: "common" as const, effect: { kind: "draw", amount: 1 }, message: "" }) as never;
    const pools: Record<string, ManaPool> = { human: emptyPool(), sable: emptyPool() };
    const stops: PriorityStopSettings = { ...DEFAULT_STOP_SETTINGS, phaseStops: {} };
    const sable = () => seat({ id: "sable", name: "Sable", kind: "agent" });

    it("human with an affordable instant is required to pass on an agent's trigger, after the controller", () => {
      const human = seat({ id: "human", name: "You", kind: "human", board: { hand: [bolt()], battlefield: [mountain()] } });
      const s = session([human, sable()], "upkeep step");
      expect(pendingActionRequiredPassesForTest([human, sable()], agentTrigger("t1"), "sable", s, pools, stops)).toEqual(["human", "sable"]);
    });

    it("human with no legal response is NOT asked; only the controller passes (auto-resolves fast)", () => {
      const human = seat({ id: "human", name: "You", kind: "human", board: { hand: [bolt()], battlefield: [] } });
      const s = session([human, sable()], "upkeep step");
      expect(pendingActionRequiredPassesForTest([human, sable()], agentTrigger("t1"), "sable", s, pools, stops)).toEqual(["sable"]);
    });

    it("a batch of triggers produces no human prompt when the human has no response", () => {
      const human = seat({ id: "human", name: "You", kind: "human" });
      const s = session([human, sable()], "precombat main phase");
      for (const id of ["a", "b", "c", "d", "e"]) {
        expect(pendingActionRequiredPassesForTest([human, sable()], agentTrigger(id), "sable", s, pools, stops)).toEqual(["sable"]);
      }
    });

    it("full control still only opens the window when a real response exists", () => {
      const fc: PriorityStopSettings = { ...stops, fullControl: true };
      const idle = seat({ id: "human", name: "You", kind: "human" });
      expect(pendingActionRequiredPassesForTest([idle, sable()], agentTrigger("t1"), "sable", session([idle, sable()], "upkeep step"), pools, fc)).toEqual(["sable"]);
      const ready = seat({ id: "human", name: "You", kind: "human", board: { hand: [bolt()], battlefield: [mountain()] } });
      expect(pendingActionRequiredPassesForTest([ready, sable()], agentTrigger("t1"), "sable", session([ready, sable()], "upkeep step"), pools, fc)).toContain("human");
    });

    it("another agent with a real instant-speed response also gets a window on a different agent's trigger", () => {
      const human = seat({ id: "human", name: "You", kind: "human" });
      const rook = seat({ id: "rook", name: "Rook", kind: "agent", board: { hand: [bolt()], battlefield: [mountain()] } });
      const s = session([human, sable(), rook], "upkeep step");
      const p = { ...pools, rook: emptyPool() };
      expect(pendingActionRequiredPassesForTest([human, sable(), rook], agentTrigger("t1"), "sable", s, p, stops)).toEqual(["sable", "rook"]);
    });

    it("the human's own trigger: agents with a real response get a window too, human unchanged", () => {
      const human = seat({ id: "human", name: "You", kind: "human" });
      const rook = seat({ id: "rook", name: "Rook", kind: "agent", board: { hand: [bolt()], battlefield: [mountain()] } });
      const s = session([human, sable(), rook], "upkeep step");
      const p = { ...pools, rook: emptyPool() };
      expect(pendingActionRequiredPassesForTest([human, sable(), rook], agentTrigger("t1", "human"), "human", s, p, stops)).toEqual(["rook"]);
    });
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
