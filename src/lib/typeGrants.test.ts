import { describe, expect, it } from "vitest";
import { hasCardType, parseTypeGrantEffects, typeGrantAppliesTo } from "./typeGrants";

describe("parseTypeGrantEffects", () => {
  it("parses Secret Arcade's nonland-permanent enchantment grant", () => {
    expect(parseTypeGrantEffects("Nonland permanents you control and permanent spells you control are enchantments in addition to their other types.")).toEqual([
      { granteeFilter: "nonland permanent", grantedType: "Enchantment" }
    ]);
  });

  it("parses Biotransference's creature-scoped artifact grant", () => {
    expect(
      parseTypeGrantEffects(
        "Creatures you control are artifacts in addition to their other types. The same is true for creature spells you control and creature cards you own that aren't on the battlefield."
      )
    ).toEqual([{ granteeFilter: "creature", grantedType: "Artifact" }]);
  });

  it("parses a compound granted-type phrase by its last word (Ashaya, Soul of the Wild)", () => {
    expect(parseTypeGrantEffects("Nontoken creatures you control are Forest lands in addition to their other types.")).toEqual([
      { granteeFilter: "nontoken creature", grantedType: "Land" }
    ]);
  });

  it("declines a creature-subtype grant (Sigarda's Summons -- Angels isn't a card type)", () => {
    expect(
      parseTypeGrantEffects("Creatures you control with +1/+1 counters on them have base power and toughness 4/4, have flying, and are Angels in addition to their other types.")
    ).toEqual([]);
  });

  it("declines an artifact-subtype grant (Armed with Proof -- Equipment isn't a card type)", () => {
    expect(parseTypeGrantEffects("Clues you control are Equipment in addition to their other types and have \"Equipped creature gets +2/+0\" and equip {2}.")).toEqual([]);
  });

  it("declines a basic-land-type (subtype) grant (Dryad of the Ilysian Grove)", () => {
    expect(parseTypeGrantEffects("Lands you control are every basic land type in addition to their other types.")).toEqual([]);
  });

  it("declines a self-referential grant with no you-control scope (Adaptive Automaton)", () => {
    expect(parseTypeGrantEffects("This creature is the chosen type in addition to its other types.")).toEqual([]);
  });
});

describe("typeGrantAppliesTo", () => {
  it("matches nonland-permanent scope to a creature but not a land", () => {
    expect(typeGrantAppliesTo("nonland permanent", { typeLine: "Creature — Kor Cleric" })).toBe(true);
    expect(typeGrantAppliesTo("nonland permanent", { typeLine: "Land" })).toBe(false);
  });

  it("matches a specific card-type scope", () => {
    expect(typeGrantAppliesTo("creature", { typeLine: "Creature — Bear" })).toBe(true);
    expect(typeGrantAppliesTo("creature", { typeLine: "Artifact" })).toBe(false);
  });
});

describe("hasCardType", () => {
  it("checks the printed type line", () => {
    expect(hasCardType({ typeLine: "Creature — Bear" }, "Creature")).toBe(true);
    expect(hasCardType({ typeLine: "Creature — Bear" }, "Enchantment")).toBe(false);
  });

  it("also checks granted types", () => {
    expect(hasCardType({ typeLine: "Creature — Kor Cleric", grantedTypes: ["Enchantment"] }, "Enchantment")).toBe(true);
  });
});
