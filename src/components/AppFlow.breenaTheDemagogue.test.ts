import { describe, expect, it } from "vitest";
import { findBreenaAttackTriggers, parseBreenaAttackTrigger, resolveTriggerEffect } from "./AppFlow";
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
    phase: "declare attackers step",
    turn: 1,
    xmage: { enabled: false, status: "not_configured", message: "" },
    seats,
    events: []
  };
}

// Real oracle text, verified via local card DB.
const BREENA_TEXT =
  "Flying\nWhenever a player attacks one of your opponents, if that opponent has more life than another of your opponents, that attacking player draws a card and you put two +1/+1 counters on a creature you control.";

function breena(id = "breena"): VisibleCard {
  return card({ id, name: "Breena, the Demagogue", typeLine: "Legendary Creature — Bird Warlock", oracleText: BREENA_TEXT });
}

describe("parseBreenaAttackTrigger", () => {
  it("parses Breena's real printed text", () => {
    expect(parseBreenaAttackTrigger(BREENA_TEXT)).toEqual({ drawAmount: 1, counterAmount: 2 });
  });

  it("does not match the far more common self-relative 'whenever you attack a player' template", () => {
    expect(parseBreenaAttackTrigger("Whenever you attack a player, create a 1/1 white Soldier creature token.")).toBeUndefined();
  });
});

describe("findBreenaAttackTriggers", () => {
  it("fires when the defender has more life than another of the watcher's opponents (reported live)", () => {
    const attackerSeat = seat({ id: "attacker", name: "Attacker", kind: "agent" });
    const defender = seat({ id: "defender", name: "Defender", kind: "agent", life: 30 });
    const lowLifeOther = seat({ id: "low-life", name: "Low Life", kind: "agent", life: 10 });
    const breenaController = seat({ id: "breena-seat", name: "Breena Controller", kind: "agent", board: { hand: [], battlefield: [breena()] } });

    const triggers = findBreenaAttackTriggers(session([attackerSeat, defender, lowLifeOther, breenaController]), "attacker", "defender");

    expect(triggers).toHaveLength(1);
    expect(triggers[0].actorSeatId).toBe("attacker"); // the attacking player gets the draw
    expect(triggers[0].controllerSeatId).toBe("breena-seat"); // Breena's own controller gets the counters
    expect(triggers[0].effect).toEqual({
      kind: "actor_draws_cards",
      amount: 1,
      then: { kind: "add_counter", counterKind: "+1/+1", amount: 2, scope: "target_creature_you_control" }
    });
  });

  it("does not fire when the defender has the LOWEST life among the watcher's opponents", () => {
    const attackerSeat = seat({ id: "attacker", name: "Attacker", kind: "agent" });
    const defender = seat({ id: "defender", name: "Defender", kind: "agent", life: 5 });
    const higherLifeOther = seat({ id: "high-life", name: "High Life", kind: "agent", life: 30 });
    const breenaController = seat({ id: "breena-seat", name: "Breena Controller", kind: "agent", board: { hand: [], battlefield: [breena()] } });

    const triggers = findBreenaAttackTriggers(session([attackerSeat, defender, higherLifeOther, breenaController]), "attacker", "defender");
    expect(triggers).toHaveLength(0);
  });

  it("does not fire for a watcher with only one opponent (no 'another' to compare against)", () => {
    // Only two seats total: Breena's controller (the watcher, and here also the attacker) and their
    // single opponent (the defender, at a high life total). No THIRD opponent exists for the watcher
    // to compare the defender's life against, so the condition can never be satisfied regardless of
    // how high the defender's life is.
    const breenaControllerAndAttacker = seat({ id: "breena-seat", name: "Breena Controller", kind: "agent", board: { hand: [], battlefield: [breena()] } });
    const onlyOpponent = seat({ id: "only-opponent", name: "Only Opponent", kind: "agent", life: 30 });

    const triggers = findBreenaAttackTriggers(session([breenaControllerAndAttacker, onlyOpponent]), "breena-seat", "only-opponent");
    expect(triggers).toHaveLength(0);
  });

  it("still fires when Breena's own controller is the attacker", () => {
    const breenaControllerAndAttacker = seat({ id: "breena-seat", name: "Breena Controller", kind: "agent", board: { hand: [], battlefield: [breena()] } });
    const defender = seat({ id: "defender", name: "Defender", kind: "agent", life: 30 });
    const lowLifeOther = seat({ id: "low-life", name: "Low Life", kind: "agent", life: 10 });

    const triggers = findBreenaAttackTriggers(session([breenaControllerAndAttacker, defender, lowLifeOther]), "breena-seat", "defender");
    expect(triggers).toHaveLength(1);
    expect(triggers[0].actorSeatId).toBe("breena-seat");
    expect(triggers[0].controllerSeatId).toBe("breena-seat");
  });

  it("does not fire for a card with no matching ability", () => {
    const attackerSeat = seat({ id: "attacker", name: "Attacker", kind: "agent" });
    const defender = seat({ id: "defender", name: "Defender", kind: "agent", life: 30 });
    const lowLifeOther = seat({ id: "low-life", name: "Low Life", kind: "agent", life: 10 });
    const noBreena = seat({
      id: "other-seat",
      name: "Other",
      kind: "agent",
      board: { hand: [], battlefield: [card({ id: "vanilla", name: "Vanilla", typeLine: "Creature — Bear" })] }
    });
    expect(findBreenaAttackTriggers(session([attackerSeat, defender, lowLifeOther, noBreena]), "attacker", "defender")).toHaveLength(0);
  });
});

describe("resolveTriggerEffect — actor_draws_cards chained with add_counter (Breena)", () => {
  it("the attacking player draws, then Breena's own controller puts counters on their own creature", () => {
    const topOfLibrary = card({ id: "top", name: "Top Card", typeLine: "Instant", zone: "library" });
    const attackerSeat = seat({
      id: "attacker",
      name: "Attacker",
      kind: "agent",
      library: [topOfLibrary],
      zones: { library: 1, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 }
    });
    const breenaCreature = card({ id: "breena-creature", name: "Grizzly Bears", typeLine: "Creature — Bear", power: "2", toughness: "2" });
    const breenaController = seat({ id: "breena-seat", name: "Breena Controller", kind: "agent", board: { hand: [], battlefield: [breena(), breenaCreature] } });

    const trigger = {
      id: "t1",
      type: "trigger" as const,
      actorSeatId: "attacker",
      controllerSeatId: "breena-seat",
      sourceCardId: "breena",
      sourceCardName: "Breena, the Demagogue",
      triggerKind: "common" as const,
      effect: {
        kind: "actor_draws_cards" as const,
        amount: 1,
        then: { kind: "add_counter" as const, counterKind: "+1/+1", amount: 2, scope: "target_creature_you_control" as const }
      },
      message: "Breena, the Demagogue triggers."
    };

    const result = resolveTriggerEffect(session([attackerSeat, breenaController]), trigger);
    const attackerAfter = result.seats.find((s) => s.id === "attacker")!;
    const breenaControllerAfter = result.seats.find((s) => s.id === "breena-seat")!;
    expect(attackerAfter.board.hand).toHaveLength(1);
    const boostedCreature = breenaControllerAfter.board.battlefield.find((c) => c.id === "breena-creature")!;
    expect(boostedCreature.counters).toEqual([{ kind: "+1/+1", count: 2 }]);
  });
});
