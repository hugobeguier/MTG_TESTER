import { describe, expect, it } from "vitest";
import { findAnyCombatDamageToOpponentTriggers, parseAnyCreatureCombatDamageToOpponentTrigger, resolveTriggerEffect } from "./AppFlow";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

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

function session(seats: PlayerSeat[]): GameSession {
  return {
    id: "test",
    createdAt: "",
    status: "playing",
    phase: "combat damage step",
    turn: 1,
    xmage: { enabled: false, status: "not_configured", message: "" },
    seats,
    events: []
  };
}

// Real oracle text, verified via local card DB — the first (relevant) ability only; the second
// activated ability is unrelated and irrelevant to this trigger.
const GIX_TEXT =
  "Whenever a creature deals combat damage to one of your opponents, its controller may pay 1 life. If they do, they draw a card.\n{4}{B}{B}{B}, Discard X cards: Exile the top X cards of target opponent's library. You may play lands and cast spells from among cards exiled this way without paying their mana costs.";

function gix(id = "gix"): VisibleCard {
  return card({ id, name: "Gix, Yawgmoth Praetor", typeLine: "Legendary Creature — Phyrexian Praetor", oracleText: GIX_TEXT });
}

describe("parseAnyCreatureCombatDamageToOpponentTrigger", () => {
  it("parses Gix's real printed text", () => {
    expect(parseAnyCreatureCombatDamageToOpponentTrigger(GIX_TEXT)).toEqual({ lifeCost: 1, drawAmount: 1 });
  });

  it("does not match the far more common self-relative 'a creature you control' template", () => {
    expect(parseAnyCreatureCombatDamageToOpponentTrigger("Whenever a creature you control deals combat damage to a player, you gain 1 life.")).toBeUndefined();
  });
});

describe("findAnyCombatDamageToOpponentTriggers", () => {
  it("fires for a THIRD seat's Gix, unrelated to who controls the attacker (reported live)", () => {
    const attacker = card({ id: "attacker", name: "Attacking Creature", typeLine: "Creature — Bear" });
    const attackerController = seat({ id: "attacker-seat", name: "Attacker", kind: "agent", board: { hand: [], battlefield: [attacker] } });
    const damaged = seat({ id: "damaged-seat", name: "Damaged", kind: "agent", life: 30 });
    const gixController = seat({ id: "gix-seat", name: "Gix Controller", kind: "agent", board: { hand: [], battlefield: [gix()] } });

    const triggers = findAnyCombatDamageToOpponentTriggers(session([attackerController, damaged, gixController]), "attacker-seat", attacker, "damaged-seat");

    expect(triggers).toHaveLength(1);
    expect(triggers[0].actorSeatId).toBe("attacker-seat"); // the attacker's controller gets the pay-life choice
    expect(triggers[0].controllerSeatId).toBe("gix-seat"); // Gix's own controller owns the trigger source
    expect(triggers[0].effect).toEqual({ kind: "actor_may_pay_life_to_draw", lifeCost: 1, drawAmount: 1 });
  });

  it("does not fire when the damaged player is Gix's OWN controller (not an opponent of themselves)", () => {
    const attacker = card({ id: "attacker", name: "Attacking Creature", typeLine: "Creature — Bear" });
    const attackerController = seat({ id: "attacker-seat", name: "Attacker", kind: "agent", board: { hand: [], battlefield: [attacker] } });
    const gixController = seat({ id: "gix-seat", name: "Gix Controller", kind: "agent", board: { hand: [], battlefield: [gix()] } });

    // Gix's own controller is the one taking the damage this time.
    const triggers = findAnyCombatDamageToOpponentTriggers(session([attackerController, gixController]), "attacker-seat", attacker, "gix-seat");
    expect(triggers).toHaveLength(0);
  });

  it("still fires when Gix's controller is the attacker themselves, hitting a real opponent", () => {
    const attacker = card({ id: "attacker", name: "Attacking Creature", typeLine: "Creature — Bear" });
    const gixControllerAndAttacker = seat({ id: "gix-seat", name: "Gix Controller", kind: "agent", board: { hand: [], battlefield: [attacker, gix()] } });
    const damaged = seat({ id: "damaged-seat", name: "Damaged", kind: "agent", life: 30 });

    const triggers = findAnyCombatDamageToOpponentTriggers(session([gixControllerAndAttacker, damaged]), "gix-seat", attacker, "damaged-seat");
    expect(triggers).toHaveLength(1);
    expect(triggers[0].actorSeatId).toBe("gix-seat");
    expect(triggers[0].controllerSeatId).toBe("gix-seat");
  });

  it("does not fire for a noncreature damage source or a card with no matching ability", () => {
    const nonCreature = card({ id: "nc", name: "Not A Creature", typeLine: "Artifact" });
    const attackerController = seat({ id: "attacker-seat", name: "Attacker", kind: "agent" });
    const gixController = seat({ id: "gix-seat", name: "Gix Controller", kind: "agent", board: { hand: [], battlefield: [gix()] } });
    expect(findAnyCombatDamageToOpponentTriggers(session([attackerController, gixController]), "attacker-seat", nonCreature, "damaged-seat")).toHaveLength(0);

    const attacker = card({ id: "attacker", name: "Attacking Creature", typeLine: "Creature — Bear" });
    const noGix = seat({ id: "other-seat", name: "Other", kind: "agent", board: { hand: [], battlefield: [card({ id: "vanilla", name: "Vanilla", typeLine: "Creature — Bear" })] } });
    expect(findAnyCombatDamageToOpponentTriggers(session([attackerController, noGix]), "attacker-seat", attacker, "damaged-seat")).toHaveLength(0);
  });
});

describe("resolveTriggerEffect — actor_may_pay_life_to_draw", () => {
  it("pays the life and draws for the ATTACKER's controller, not Gix's own controller", () => {
    const topOfLibrary = card({ id: "top", name: "Top Card", typeLine: "Instant", zone: "library" });
    const attackerController = seat({
      id: "attacker-seat",
      name: "Attacker",
      kind: "agent",
      life: 40,
      library: [topOfLibrary],
      zones: { library: 1, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 }
    });
    const gixController = seat({ id: "gix-seat", name: "Gix Controller", kind: "agent", life: 40, board: { hand: [], battlefield: [gix()] } });

    const trigger = {
      id: "t1",
      type: "trigger" as const,
      actorSeatId: "attacker-seat",
      controllerSeatId: "gix-seat",
      sourceCardId: "gix",
      sourceCardName: "Gix, Yawgmoth Praetor",
      triggerKind: "common" as const,
      effect: { kind: "actor_may_pay_life_to_draw" as const, lifeCost: 1, drawAmount: 1 },
      message: "Gix, Yawgmoth Praetor triggers."
    };

    const result = resolveTriggerEffect(session([attackerController, gixController]), trigger);
    const attackerAfter = result.seats.find((s) => s.id === "attacker-seat")!;
    const gixControllerAfter = result.seats.find((s) => s.id === "gix-seat")!;
    expect(attackerAfter.life).toBe(39);
    expect(attackerAfter.board.hand).toHaveLength(1);
    expect(gixControllerAfter.life).toBe(40); // untouched — the payoff belongs to the attacker, not Gix's controller
  });

  it("declines to pay when it would be fatal, and does not draw", () => {
    const attackerController = seat({ id: "attacker-seat", name: "Attacker", kind: "agent", life: 1 });
    const gixController = seat({ id: "gix-seat", name: "Gix Controller", kind: "agent" });
    const trigger = {
      id: "t1",
      type: "trigger" as const,
      actorSeatId: "attacker-seat",
      controllerSeatId: "gix-seat",
      sourceCardId: "gix",
      sourceCardName: "Gix, Yawgmoth Praetor",
      triggerKind: "common" as const,
      effect: { kind: "actor_may_pay_life_to_draw" as const, lifeCost: 1, drawAmount: 1 },
      message: "Gix, Yawgmoth Praetor triggers."
    };
    const result = resolveTriggerEffect(session([attackerController, gixController]), trigger);
    expect(result.seats.find((s) => s.id === "attacker-seat")!.life).toBe(1);
    expect(result.seats.find((s) => s.id === "attacker-seat")!.board.hand).toHaveLength(0);
  });
});
