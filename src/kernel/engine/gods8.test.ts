// Observer round 1: the two Theros-style gods the kernel judged wrongly (465 diffs).
//  - Callaphe, Beloved of the Sea: "*/4", the card data had no numeric toughness, so the {U}-devotion power gave a 0-toughness creature that died
//  - Athreos, Shroud-Veiled: "isn't a creature" below devotion 7 was ignored (a "lose: creature" static is a type change)
import { describe, expect, it } from "vitest";
import { cardUnsupported } from "./support";
import { charsOf } from "./testdb";
import { realDef, realTable } from "./testdb";

describe("Callaphe, Beloved of the Sea", () => {
  it("the printed data keeps the toughness 3 next to the non-numeric power", () => {
    expect(realDef("Callaphe, Beloved of the Sea")!.toughness).toBe(3);
  });
  it("power = devotion to blue (each {U} of the permanents you control), toughness 3", () => {
    const t = realTable();
    const c = t.give("p1", "Callaphe, Beloved of the Sea", "battlefield"); // {1}{U}{U}: devotion 2
    expect(charsOf(t, c)).toMatchObject({ power: 2, toughness: 3 });
    t.give("p1", "Island", "battlefield"); // lands have no mana cost
    t.give("p1", "Counterspell", "battlefield"); // not a permanent type, but a permanent on the battlefield here: {U}{U} counts
    expect(charsOf(t, c).power).toBe(4);
    t.give("p2", "Counterspell", "battlefield"); // the opponent's permanents do not count
    expect(charsOf(t, c).power).toBe(4);
  });
});

describe("Athreos, Shroud-Veiled", () => {
  it("is fully supported (lose: creature is a type change)", () => {
    expect(cardUnsupported(realDef("Athreos, Shroud-Veiled")!).all).toEqual([]);
  });
  it("is not a creature while devotion to white and black is below 7, and is a 4/7 creature at 7", () => {
    const t = realTable();
    const a = t.give("p1", "Athreos, Shroud-Veiled", "battlefield"); // {4}{W}{B}: devotion 2
    expect(charsOf(t, a).types).not.toContain("creature");
    expect(charsOf(t, a).types).toContain("enchantment");
    for (let i = 0; i < 4; i++) t.give("p1", "Angel of Finality", "battlefield"); // {3}{W} each: devotion 2 + 4 = 6, still not a creature
    expect(charsOf(t, a).types).not.toContain("creature");
    t.give("p1", "Angel of Finality", "battlefield"); // 7
    expect(charsOf(t, a).types).toContain("creature");
    expect(charsOf(t, a)).toMatchObject({ power: 4, toughness: 7 });
  });
  it("a hybrid symbol counts once for a devotion to both of its colors", () => {
    const hybrid = { name: "Hybrid Rock", manaCost: "{W/B}{W/B}{W/B}{W/B}{W/B}", types: ["artifact"], kernel: { schemaVersion: 2, abilities: [] } };
    const t = realTable(["p1", "p2"], { "Hybrid Rock": hybrid as never });
    const a = t.give("p1", "Athreos, Shroud-Veiled", "battlefield"); // 2
    t.give("p1", "Hybrid Rock", "battlefield"); // five hybrid symbols: 5, never 10 -> total 7 (a per-color count would give 12)
    expect(charsOf(t, a).types).toContain("creature");
    const t2 = realTable(["p1", "p2"], { "Hybrid Rock": { ...hybrid, manaCost: "{W/B}{W/B}{W/B}{W/B}" } as never });
    const b = t2.give("p1", "Athreos, Shroud-Veiled", "battlefield");
    t2.give("p1", "Hybrid Rock", "battlefield"); // 2 + 4 = 6 < 7: still not a creature (per-color counting would say 10)
    expect(charsOf(t2, b).types).not.toContain("creature");
  });
});
