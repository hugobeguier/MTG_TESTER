import { describe, expect, it } from "vitest";
import {
  counterImmunityScopeMatches,
  counterSpellCanTarget,
  hasCantBeCountered,
  parseCounterImmunityGrant,
  parseCounterSpellAbility
} from "./counterSpells";

describe("parseCounterSpellAbility", () => {
  it("parses a plain unconditional counter (Counterspell)", () => {
    expect(parseCounterSpellAbility("Counter target spell.")).toEqual({ restriction: "any" });
  });

  it("parses a creature-restricted counter (Essence Scatter)", () => {
    expect(parseCounterSpellAbility("Counter target creature spell.")).toEqual({ restriction: "creature" });
  });

  it("parses a noncreature-restricted counter (Negate)", () => {
    expect(parseCounterSpellAbility("Counter target noncreature spell.")).toEqual({ restriction: "noncreature" });
  });

  it("parses a mana-tax counter (Mana Leak)", () => {
    expect(parseCounterSpellAbility("Counter target spell unless its controller pays {3}.")).toEqual({ restriction: "any", taxAmount: 3 });
  });

  it("returns undefined for a spell with no counter ability", () => {
    expect(parseCounterSpellAbility("Destroy target creature.")).toBeUndefined();
  });
});

describe("counterSpellCanTarget", () => {
  it("an unrestricted counter can target anything", () => {
    expect(counterSpellCanTarget({ restriction: "any" }, "Sorcery", false)).toBe(true);
    expect(counterSpellCanTarget({ restriction: "any" }, "Creature — Bear", false)).toBe(true);
  });

  it("a creature-restricted counter can only target creature spells", () => {
    expect(counterSpellCanTarget({ restriction: "creature" }, "Creature — Bear", false)).toBe(true);
    expect(counterSpellCanTarget({ restriction: "creature" }, "Instant", false)).toBe(false);
  });

  it("a noncreature-restricted counter cannot target creature spells", () => {
    expect(counterSpellCanTarget({ restriction: "noncreature" }, "Creature — Bear", false)).toBe(false);
    expect(counterSpellCanTarget({ restriction: "noncreature" }, "Instant", false)).toBe(true);
  });

  it("a commander-restricted counter only targets spells cast from the command zone", () => {
    expect(counterSpellCanTarget({ restriction: "commander" }, "Creature — Legendary Dragon", true)).toBe(true);
    expect(counterSpellCanTarget({ restriction: "commander" }, "Creature — Legendary Dragon", false)).toBe(false);
  });
});

describe("hasCantBeCountered", () => {
  it("recognizes a self-printed counter-immunity clause (Void Rend)", () => {
    expect(hasCantBeCountered("Destroy target creature or planeswalker. This spell can't be countered.")).toBe(true);
  });

  it("returns false for a spell with no such clause", () => {
    expect(hasCantBeCountered("Destroy target creature.")).toBe(false);
  });
});

describe("parseCounterImmunityGrant", () => {
  it("parses a creature-spells-only immunity grant", () => {
    expect(parseCounterImmunityGrant("Creature spells you control can't be countered.")).toBe("creature_spells");
  });

  it("parses an all-spells immunity grant", () => {
    expect(parseCounterImmunityGrant("Spells you cast can't be countered.")).toBe("spells");
  });

  it("returns undefined for oracle text with no immunity grant", () => {
    expect(parseCounterImmunityGrant("Flying, vigilance.")).toBeUndefined();
  });
});

describe("counterImmunityScopeMatches", () => {
  it("an all-spells scope matches any target", () => {
    expect(counterImmunityScopeMatches("spells", "Instant")).toBe(true);
    expect(counterImmunityScopeMatches("spells", "Creature — Bear")).toBe(true);
  });

  it("a creature_spells scope only matches creature spells", () => {
    expect(counterImmunityScopeMatches("creature_spells", "Creature — Bear")).toBe(true);
    expect(counterImmunityScopeMatches("creature_spells", "Instant")).toBe(false);
  });
});
