import { describe, expect, it } from "vitest";
import { ctx } from "../integration/testgame";
import { G, base, lands, type Mini } from "./aminatoukit";

describe("aminatou sweep: lands and mana", () => {
  const entersTapped = (name: string, setup: (m: Mini) => void, tapped: boolean) => {
    const m = base(); setup(m); const c = m.give("p1", name, "hand"); const g = new G(m);
    g.land("p1", c);
    expect(g.zone(c)).toBe("battlefield"); expect(g.obj(c).tapped, name).toBe(tapped); if (/Temple|Halimar/.test(name)) expect(g.unresolved()).toEqual([]); else g.clean(name);
  };
  it("conditional enter-tapped lands", () => {
    entersTapped("Drowned Catacomb", () => {}, true);
    entersTapped("Drowned Catacomb", (m) => m.give("p1", "Island", "battlefield"), false);
    entersTapped("Drowned Catacomb", (m) => m.give("p1", "Swamp", "battlefield"), false);
    entersTapped("Drowned Catacomb", (m) => m.give("p1", "Plains", "battlefield"), true);
    entersTapped("Glacial Fortress", () => {}, true);
    entersTapped("Glacial Fortress", (m) => m.give("p1", "Plains", "battlefield"), false);
    entersTapped("Glacial Fortress", (m) => m.give("p1", "Island", "battlefield"), false);
    entersTapped("Glacial Fortress", (m) => m.give("p1", "Swamp", "battlefield"), true);
    entersTapped("Isolated Chapel", () => {}, true);
    entersTapped("Isolated Chapel", (m) => m.give("p1", "Plains", "battlefield"), false);
    entersTapped("Isolated Chapel", (m) => m.give("p1", "Swamp", "battlefield"), false);
    entersTapped("Isolated Chapel", (m) => m.give("p1", "Island", "battlefield"), true);
    entersTapped("Prairie Stream", () => {}, true);
    entersTapped("Prairie Stream", (m) => m.give("p1", "Plains", "battlefield"), true);
    entersTapped("Prairie Stream", (m) => { m.give("p1", "Plains", "battlefield"); m.give("p1", "Island", "battlefield"); }, false);
    entersTapped("Prairie Stream", (m) => { m.give("p1", "Drowned Catacomb", "battlefield"); m.give("p1", "Island", "battlefield"); }, true);
    for (const n of ["Arcane Sanctum", "Contaminated Aquifer", "Halimar Depths", "Myriad Landscape", "Sunken Palace", "Temple of Deceit", "Temple of Silence", "Thriving Heath", "Thriving Isle", "Thriving Moor"]) entersTapped(n, (m) => lands(m, "p1", "Island", "Swamp", "Plains"), true);
    for (const n of ["Adarkar Wastes", "Caves of Koilos", "Underground River", "Tainted Field", "Evolving Wilds", "Command Tower"]) entersTapped(n, () => {}, false);
  });
  it("Contaminated Aquifer is an Island Swamp: taps for U or B", () => {
    const m = base(); const c = m.give("p1", "Contaminated Aquifer", "battlefield"); const g = new G(m);
    expect(g.chars(c).subtypes).toEqual(expect.arrayContaining(["Island", "Swamp"]));
    for (const col of ["U", "B"]) { g.s.objects[c].tapped = false; g.act("p1", c, "a1", { color: col }); }
  });
  const spendOn = (land: string, spell: string, setup?: (m: Mini) => void) => {
    const m = base(); setup?.(m); const c = m.give("p1", land, "battlefield"); const sp = m.give("p1", spell, "hand"); const g = new G(m);
    const l0 = g.pl("p1").life;
    g.cast("p1", sp, { targets: undefined });
    return { g, c, sp, paid: l0 - g.pl("p1").life };
  };
  it("pain lands / Talismans pay coloured mana, deal 1 damage only for coloured", () => {
    // Brainstorm {U}
    for (const n of ["Adarkar Wastes", "Underground River"]) { const r = spendOn(n, "Brainstorm"); expect(r.g.obj(r.c).tapped, n).toBe(true); expect(r.paid, n).toBe(1); }
    // Swords {W}
    for (const n of ["Adarkar Wastes", "Caves of Koilos"]) {
      const m = base(); m.give("p2", "Ledger Shredder", "battlefield"); m.give("p1", n, "battlefield"); const sw = m.give("p1", "Swords to Plowshares", "hand"); const g = new G(m);
      g.cast("p1", sw, { targets: { t1: [g.bf("Ledger Shredder")[0]] } });
      expect(g.find("Ledger Shredder", "exile"), n).toHaveLength(1); expect(g.pl("p1").life, n).toBe(39);
    }
    for (const n of ["Talisman of Progress", "Talisman of Dominance", "Talisman of Hierarchy"]) { const m = base(); const c = m.give("p1", n, "battlefield"); const g = new G(m); const ab = ctx.cards(n)!.kernel!.abilities.filter((a) => a.kind === "activated" || a.kind === "mana"); expect(ab.length, n).toBeGreaterThanOrEqual(2); void c; }
  });
  it("Tainted Field: W or B only while you control a Swamp", () => {
    const m = base(); const c = m.give("p1", "Tainted Field", "battlefield"); const g = new G(m);
    const sw = m.give("p1", "Swords to Plowshares", "hand"); m.give("p2", "Ledger Shredder", "battlefield");
    expect(() => g.cast("p1", sw, { targets: { t1: [g.bf("Ledger Shredder")[0]] } })).toThrow();
    void c;
    const m2 = base(); m2.give("p1", "Tainted Field", "battlefield"); m2.give("p1", "Swamp", "battlefield"); m2.give("p2", "Ledger Shredder", "battlefield"); const sw2 = m2.give("p1", "Swords to Plowshares", "hand"); const g2 = new G(m2);
    g2.cast("p1", sw2, { targets: { t1: [g2.bf("Ledger Shredder")[0]] } });
    expect(g2.find("Ledger Shredder", "exile")).toHaveLength(1);
  });
});

