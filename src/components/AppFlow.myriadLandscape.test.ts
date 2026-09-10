import { describe, expect, it } from "vitest";
import { chooseBestBasicLandPairForMyriad } from "./AppFlow";
import type { PlayerSeat, VisibleCard } from "@/lib/types";

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

function commanderWithColorIdentity(colorIdentity: string[]): VisibleCard {
  return card({ id: "commander", name: "Test Commander", typeLine: "Legendary Creature — Test", colorIdentity, commander: true });
}

function basicLand(id: string, name: string): VisibleCard {
  return card({ id, name, typeLine: `Basic Land — ${name}` });
}

describe("chooseBestBasicLandPairForMyriad", () => {
  it("fetches a pair of the completely missing color instead of doubling up on an existing one (reported live)", () => {
    // Deck is black/green; caster has swamps out but no forests at all — Myriad Landscape should
    // find two Forests, not two more Swamps.
    const library = [basicLand("s1", "Swamp"), basicLand("s2", "Swamp"), basicLand("f1", "Forest"), basicLand("f2", "Forest")];
    const existingSwamp = basicLand("existing-swamp", "Swamp");
    const player = seat({
      id: "p",
      name: "Player",
      kind: "agent",
      library,
      board: { hand: [], battlefield: [existingSwamp], commander: commanderWithColorIdentity(["B", "G"]) }
    });
    const pair = chooseBestBasicLandPairForMyriad(player);
    expect(pair.map((c) => c.name)).toEqual(["Forest", "Forest"]);
  });

  it("falls back to a pairable but already-covered color when nothing else can form a pair", () => {
    const library = [basicLand("s1", "Swamp"), basicLand("s2", "Swamp"), basicLand("f1", "Forest")]; // only one Forest — can't pair
    const existingSwamp = basicLand("existing-swamp", "Swamp");
    const player = seat({
      id: "p",
      name: "Player",
      kind: "agent",
      library,
      board: { hand: [], battlefield: [existingSwamp], commander: commanderWithColorIdentity(["B", "G"]) }
    });
    const pair = chooseBestBasicLandPairForMyriad(player);
    expect(pair.map((c) => c.name)).toEqual(["Swamp", "Swamp"]);
  });

  it("still returns nothing when no basic land type has two copies at all (regression guard)", () => {
    const library = [basicLand("f1", "Forest"), basicLand("s1", "Swamp")];
    const player = seat({ id: "p", name: "Player", kind: "agent", library, board: { hand: [], battlefield: [] } });
    expect(chooseBestBasicLandPairForMyriad(player)).toEqual([]);
  });
});
