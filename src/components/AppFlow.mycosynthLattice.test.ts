import { describe, expect, it } from "vitest";
import { chooseManaSourcesForCost } from "./AppFlow";
import { hasCardType, parseTypeGrantEffects } from "@/lib/typeGrants";
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

const LATTICE_TEXT =
  "All permanents are artifacts in addition to their other types.\nAll cards that aren't on the battlefield, spells, and permanents are colorless.\nPlayers may spend mana as though it were mana of any color.";

function mycosynthLattice(): VisibleCard {
  return card({ id: "lattice", name: "Mycosynth Lattice", typeLine: "Artifact", oracleText: LATTICE_TEXT });
}

function forest(id: string): VisibleCard {
  return card({ id, name: "Forest", typeLine: "Basic Land — Forest" });
}

describe("Mycosynth Lattice — global artifact type grant", () => {
  it("parses as a global (controller-agnostic) grant", () => {
    expect(parseTypeGrantEffects(LATTICE_TEXT)).toEqual([{ granteeFilter: "permanent", grantedType: "Artifact", global: true }]);
  });
});

describe("Mycosynth Lattice — 'spend mana as though it were mana of any color'", () => {
  it("without the Lattice, a colored pip can't be paid with the wrong color of mana (regression guard)", () => {
    const hellkiteIgniter = card({ id: "hellkite", name: "Hellkite Igniter", typeLine: "Creature — Dragon", manaCost: "{5}{R}{R}", manaValue: 7 });
    const caster = seat({
      id: "caster",
      name: "Caster",
      kind: "agent",
      board: { hand: [], battlefield: [forest("f1"), forest("f2"), forest("f3"), forest("f4"), forest("f5"), forest("f6"), forest("f7")] }
    });
    const result = chooseManaSourcesForCost(caster, hellkiteIgniter, 7, undefined, [caster]);
    expect(result.ok).toBe(false);
  });

  it("with the Lattice in play, any 7 mana (no red source required) pays {5}{R}{R}", () => {
    const hellkiteIgniter = card({ id: "hellkite", name: "Hellkite Igniter", typeLine: "Creature — Dragon", manaCost: "{5}{R}{R}", manaValue: 7 });
    const caster = seat({
      id: "caster",
      name: "Caster",
      kind: "agent",
      board: {
        hand: [],
        battlefield: [mycosynthLattice(), forest("f1"), forest("f2"), forest("f3"), forest("f4"), forest("f5"), forest("f6"), forest("f7")]
      }
    });
    const result = chooseManaSourcesForCost(caster, hellkiteIgniter, 7, undefined, [caster]);
    expect(result.ok).toBe(true);
  });

  it("a Lattice on ANOTHER player's battlefield still grants the permission (it isn't a 'you control' effect)", () => {
    const hellkiteIgniter = card({ id: "hellkite", name: "Hellkite Igniter", typeLine: "Creature — Dragon", manaCost: "{5}{R}{R}", manaValue: 7 });
    const caster = seat({
      id: "caster",
      name: "Caster",
      kind: "agent",
      board: { hand: [], battlefield: [forest("f1"), forest("f2"), forest("f3"), forest("f4"), forest("f5"), forest("f6"), forest("f7")] }
    });
    const opponent = seat({ id: "opp", name: "Opponent", kind: "agent", board: { hand: [], battlefield: [mycosynthLattice()] } });
    const result = chooseManaSourcesForCost(caster, hellkiteIgniter, 7, undefined, [caster, opponent]);
    expect(result.ok).toBe(true);
  });
});

describe("hasCardType — sees a Mycosynth-Lattice-granted artifact type", () => {
  it("a land is only an artifact once the recompute pass has stamped the granted type on it", () => {
    const plainForest = forest("f1");
    expect(hasCardType(plainForest, "Artifact")).toBe(false);
    const grantedForest = { ...plainForest, grantedTypes: ["Artifact"] };
    expect(hasCardType(grantedForest, "Artifact")).toBe(true);
  });
});
