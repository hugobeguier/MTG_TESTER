import { describe, expect, it } from "vitest";
import { applyZoneEffect } from "./AppFlow";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "typeLine">): VisibleCard {
  return { oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "graveyard", power: "1", toughness: "1", ...overrides };
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
    phase: "precombat main phase",
    turn: 1,
    xmage: { enabled: false, status: "not_configured", message: "" },
    seats,
    events: []
  };
}

describe("applyZoneEffect — Fathomless descent's dynamic reanimate ceiling (Squirming Emergence)", () => {
  it("picks the biggest LEGAL creature (mana value <= graveyard permanent count), never the too-expensive one", () => {
    const graveyard = [
      card({ id: "small", name: "Small Creature", typeLine: "Creature — Bear", manaValue: 1, power: "1", toughness: "1" }),
      card({ id: "medium", name: "Medium Creature", typeLine: "Creature — Bear", manaValue: 2, power: "3", toughness: "3" }),
      card({ id: "big", name: "Big Creature", typeLine: "Creature — Bear", manaValue: 3, power: "9", toughness: "9" })
    ];
    // Exactly 2 permanent cards in the graveyard (small + medium; "big" itself also counts, so the
    // real ceiling here is actually the count of ALL permanent cards present — see the next test for
    // an isolated, unambiguous ceiling count).
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [], graveyard } });
    const result = applyZoneEffect(session([player]), "p", "Squirming Emergence", {
      kind: "reanimate",
      anyGraveyard: false,
      targetType: "nonland_permanent",
      manaValueCeiling: "graveyard_permanent_count"
    });
    const after = result.seats.find((s) => s.id === "p")!;
    // Ceiling = 3 (all three permanent cards count), so the biggest (mana value 3) IS legal here.
    expect(after.board.battlefield.map((c) => c.id)).toEqual(["big"]);
  });

  it("respects a ceiling lower than the biggest creature's mana value", () => {
    const graveyard = [
      card({ id: "small", name: "Small Creature", typeLine: "Creature — Bear", manaValue: 1, power: "1", toughness: "1" }),
      card({ id: "big", name: "Big Creature", typeLine: "Creature — Bear", manaValue: 3, power: "9", toughness: "9" }),
      card({ id: "bolt", name: "Lightning Bolt", typeLine: "Instant", manaValue: 1 })
    ];
    // Permanent cards in graveyard: "small" and "big" only (Lightning Bolt is an Instant, doesn't
    // count) — ceiling = 2, so "big" (mana value 3) is illegal; "small" (mana value 1) is the pick.
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [], graveyard } });
    const result = applyZoneEffect(session([player]), "p", "Squirming Emergence", {
      kind: "reanimate",
      anyGraveyard: false,
      targetType: "nonland_permanent",
      manaValueCeiling: "graveyard_permanent_count"
    });
    const after = result.seats.find((s) => s.id === "p")!;
    expect(after.board.battlefield.map((c) => c.id)).toEqual(["small"]);
  });

  it("never picks a land card (nonland_permanent excludes lands)", () => {
    const graveyard = [
      card({ id: "forest", name: "Forest", typeLine: "Basic Land — Forest", manaValue: 0 }),
      card({ id: "small", name: "Small Creature", typeLine: "Creature — Bear", manaValue: 1, power: "1", toughness: "1" })
    ];
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [], graveyard } });
    const result = applyZoneEffect(session([player]), "p", "Squirming Emergence", {
      kind: "reanimate",
      anyGraveyard: false,
      targetType: "nonland_permanent",
      manaValueCeiling: "graveyard_permanent_count"
    });
    const after = result.seats.find((s) => s.id === "p")!;
    expect(after.board.battlefield.map((c) => c.id)).toEqual(["small"]);
  });
});
