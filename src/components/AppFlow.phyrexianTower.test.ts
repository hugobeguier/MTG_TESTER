// Phyrexian Tower has two SEPARATE mana abilities: "{T}: Add {C}." (free) and "{T}, Sacrifice a
// creature: Add {B}{B}." (costs a creature, not itself). isSacrificeManaSource used to just check
// whether the word "sacrifice" appeared anywhere in a "{T}...: Add" shaped clause, with no regard for
// WHAT gets sacrificed — so it matched the second clause and treated the whole LAND as a
// self-consuming Treasure-style source, meaning spendManaSources sacrificed Phyrexian Tower itself
// every time it was tapped for its plain, free colorless mana. Caught live by self-play's anomaly
// detector immediately after the Storm the Vault fix (silent_death_after_etb / silent_battlefield_
// departure): the land vanished into the graveyard the next time it was used for mana, with no log
// entry naming it, even though nothing about its free ability should ever remove it from the
// battlefield.
import { describe, expect, it } from "vitest";
import { chooseManaSourcesForCost, isAvailableManaSource, manaChoicesForCard, spendManaSources } from "./AppFlow";
import type { PlayerSeat, VisibleCard } from "@/lib/types";

function phyrexianTower(overrides: Partial<VisibleCard> = {}): VisibleCard {
  return {
    id: "phyrexian-tower",
    name: "Phyrexian Tower",
    typeLine: "Legendary Land",
    oracleText: "{T}: Add {C}.\n{T}, Sacrifice a creature: Add {B}{B}.",
    manaValue: 0,
    colors: [],
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

describe("Phyrexian Tower — a separate 'sacrifice a creature' ability doesn't make the land self-consuming", () => {
  it("is an available mana source offering only colorless (its free ability), not black (its costly one)", () => {
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [phyrexianTower()] } });
    expect(isAvailableManaSource(phyrexianTower(), player)).toBe(true);
    expect(manaChoicesForCard(phyrexianTower(), player)).toEqual(["C"]);
  });

  it("stays on the battlefield, just tapped, after being spent for its free ability", () => {
    const tower = phyrexianTower();
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [tower] } });
    const payment = chooseManaSourcesForCost(player, { ...tower, id: "cost-shim", oracleText: "", manaCost: "{1}" }, 1, undefined, [player]);
    expect(payment.ok).toBe(true);
    expect(payment.sourceIds).toEqual(["phyrexian-tower"]);

    const afterSeat = spendManaSources(player, payment.sourceIds);
    const afterTower = afterSeat.board.battlefield.find((card) => card.id === "phyrexian-tower");
    expect(afterTower).toBeDefined();
    expect(afterTower?.tapped).toBe(true);
  });

  it("still lets a genuine self-sacrificing source (a real Treasure) get consumed on use", () => {
    const treasure: VisibleCard = {
      id: "treasure-1",
      name: "Treasure",
      typeLine: "Token Artifact",
      oracleText: "{T}, Sacrifice this artifact: Add one mana of any color.",
      manaValue: 0,
      colors: [],
      role: "permanent",
      zone: "battlefield",
      token: true
    };
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [treasure] } });
    const afterSeat = spendManaSources(player, ["treasure-1"]);
    expect(afterSeat.board.battlefield.find((card) => card.id === "treasure-1")).toBeUndefined();
  });
});
