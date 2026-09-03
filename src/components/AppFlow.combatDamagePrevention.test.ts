import { describe, expect, it } from "vitest";
import { applySacrificeEffect } from "./AppFlow";
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

function session(seats: PlayerSeat[], turn = 1): GameSession {
  return {
    id: "test",
    createdAt: "",
    status: "playing",
    phase: "declare attackers step",
    turn,
    xmage: { enabled: false, status: "not_configured", message: "" },
    seats,
    events: []
  };
}

describe("applySacrificeEffect — prevent_combat_damage (Spore Frog)", () => {
  it("stamps combatDamagePrevented with the current turn and logs an event", () => {
    const sporeFrog = card({ id: "frog", name: "Spore Frog", typeLine: "Creature — Frog" });
    const player = seat({ id: "p", name: "Player", kind: "human", board: { hand: [], battlefield: [sporeFrog] } });
    const before = session([player], 7);

    const after = applySacrificeEffect(before, "p", sporeFrog, { kind: "prevent_combat_damage" }, "Sacrifice this creature: Prevent all combat damage that would be dealt this turn.");

    expect(after.combatDamagePrevented).toEqual({ turn: 7 });
    expect(after.events[0].message).toContain("all combat damage is prevented this turn");
  });

  it("does not touch combatDamagePrevented for an unrelated sacrifice effect", () => {
    const mindStone = card({ id: "mind-stone", name: "Mind Stone", typeLine: "Artifact" });
    const player = seat({ id: "p", name: "Player", kind: "human", board: { hand: [], battlefield: [mindStone] } });
    const before = session([player], 3);

    const after = applySacrificeEffect(before, "p", mindStone, { kind: "draw_cards", amount: 1 }, "Sacrifice this artifact: Draw a card.");

    expect(after.combatDamagePrevented).toBeUndefined();
  });
});
