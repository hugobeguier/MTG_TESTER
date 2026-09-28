// Goldspan Dragon has no mana ability of its own — it's a vanilla flying/haste beater whose only
// other text is a Treasure-on-attack trigger and a granted ability: "Treasures you control have
// '{T}, Sacrifice this artifact: Add two mana of any one color.'" That granted-ability clause is
// quoted, not parenthetical, so the earlier reminder-text fix (Storm the Vault) didn't catch it — and
// Scryfall's own producedMana field for this card independently lists all 5 colors (it's a union over
// every mana ability the card's TEXT ever mentions, including one that belongs to a Treasure, not the
// Dragon). Both together made the Dragon itself look like an available "any color" mana source that
// got sacrificed the moment it was tapped for mana, silently, since isSacrificeManaSource's regex
// matched the same quoted "sacrifice this artifact" text. Caught live by self-play's anomaly detector
// immediately after the Phyrexian Tower fix.
import { describe, expect, it } from "vitest";
import { chooseManaSourcesForCost, isAvailableManaSource, manaChoicesForCard } from "./AppFlow";
import type { PlayerSeat, VisibleCard } from "@/lib/types";

function goldspanDragon(overrides: Partial<VisibleCard> = {}): VisibleCard {
  return {
    id: "goldspan-dragon",
    name: "Goldspan Dragon",
    typeLine: "Creature — Dragon",
    oracleText:
      'Flying, haste\nWhenever this creature attacks or becomes the target of a spell, create a Treasure token.\nTreasures you control have "{T}, Sacrifice this artifact: Add two mana of any one color."',
    manaCost: "{3}{R}{R}",
    manaValue: 5,
    colors: ["R"],
    producedMana: ["B", "G", "R", "U", "W"],
    power: "4",
    toughness: "4",
    role: "permanent",
    zone: "battlefield",
    ...overrides
  };
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

describe("Goldspan Dragon — a granted ability quoted in its own text isn't its own mana ability", () => {
  it("is not treated as an available mana source", () => {
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [goldspanDragon()] } });
    expect(isAvailableManaSource(goldspanDragon(), player)).toBe(false);
    expect(manaChoicesForCard(goldspanDragon(), player)).toEqual([]);
  });

  it("is never chosen to pay a cost, even when it's the only untapped permanent", () => {
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [goldspanDragon()] } });
    const genericCostShim: VisibleCard = { ...goldspanDragon(), id: "cost-shim", oracleText: "", manaCost: "{1}", producedMana: undefined };
    const payment = chooseManaSourcesForCost(player, genericCostShim, 1, undefined, [player]);
    expect(payment.ok).toBe(false);
  });

  it("still lets a real Treasure token (the actual granted-to object, not reminder/quoted text) act as a mana source", () => {
    const treasure: VisibleCard = {
      id: "treasure-1",
      name: "Treasure",
      typeLine: "Token Artifact",
      oracleText: "{T}, Sacrifice this artifact: Add two mana of any one color.",
      manaValue: 0,
      colors: [],
      role: "permanent",
      zone: "battlefield",
      token: true
    };
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [treasure] } });
    expect(isAvailableManaSource(treasure, player)).toBe(true);
  });
});
