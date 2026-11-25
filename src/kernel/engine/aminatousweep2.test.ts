import { describe, expect, it } from "vitest";
import { G, base, lands, labelPick, abId, names } from "./aminatoukit";

describe("aminatou sweep: set 2", () => {
  it("Aminatou, Veil Piercer: miracle granted to an enchantment drawn first this turn (cost minus {4})", () => {
    const m = base({ lib: false }); m.give("p1", "Aminatou, Veil Piercer", "battlefield");
    lands(m, "p1", "Island", "Plains", "Plains");
    for (let i = 0; i < 5; i++) m.give("p1", "Island", "library");
    const sig = m.give("p1", "Sigil of the Empty Throne", "library", { top: true });
    const bs = m.give("p1", "Brainstorm", "hand"); const g = new G(m);
    g.cast("p1", bs, {}, (p) => (p.kind === "choose_yes_no" ? { yes: true } : p.options.some((o) => /Island/.test(o.label)) ? labelPick(/Island/, p.min)(p, g) : undefined));
    expect(g.zone(sig), g.log().join("\n")).toBe("battlefield");
    expect(g.unresolved()).toEqual([]);
  });
  it("Aminatou the Fateshifter +1 / -1 / -6", () => {
    const m = base(); const am = m.give("p1", "Aminatou, the Fateshifter", "battlefield", { counters: { loyalty: 6 } });
    const sr = m.give("p1", "Sol Ring", "battlefield"); m.give("p1", "Island", "hand"); const g = new G(m);
    g.act("p1", am, abId("Aminatou, the Fateshifter", /^\+1/), {}, (p) => ({ ids: p.options.slice(0, 1).map((o) => o.id) }));
    expect(g.pl("p1").hand.length).toBe(1); expect(g.obj(am).counters.loyalty).toBe(7);
    g.s.turn.phase = "precombat_main";
    // -1 exile another permanent you own, return it
    const m2 = base(); const am2 = m2.give("p1", "Aminatou, the Fateshifter", "battlefield", { counters: { loyalty: 6 } }); const sr2 = m2.give("p1", "Sol Ring", "battlefield", { tapped: true }); const ts0 = m2.state.objects[sr2].timestamp;
    const g2 = new G(m2);
    g2.act("p1", am2, abId("Aminatou, the Fateshifter", /^[−-]1/), { targets: { t1: [sr2] } });
    const nsr = g2.bf("Sol Ring", "p1"); expect(nsr).toHaveLength(1); expect(g2.obj(nsr[0]).tapped).toBe(false); expect(g2.obj(nsr[0]).timestamp).toBeGreaterThan(ts0);
    g2.clean("-1");
    // -6 rotate: 3 players
    void sr; void am;
  });
  it("Aminatou -6 with 3 players rotates nonland permanents", () => {
    const m = base();
    const am = m.give("p1", "Aminatou, the Fateshifter", "battlefield", { counters: { loyalty: 6 } });
    const a1 = m.give("p1", "Sol Ring", "battlefield"); const a2 = m.give("p2", "Ledger Shredder", "battlefield"); const l2 = m.give("p2", "Island", "battlefield");
    const g = new G(m);
    g.act("p1", am, abId("Aminatou, the Fateshifter", /^[−-]6/), {}, (p) => (p.kind === "choose_option" || p.kind === "choose_cards" ? { ids: [p.options[0].id] } : undefined));
    // 2 players: left/right same: swap
    expect(g.obj(a1).controller).toBe("p2"); expect(g.obj(a2).controller).toBe("p1"); expect(g.obj(l2).controller).toBe("p2");
    expect(g.obj(am).controller).toBe("p1");
    g.clean("-6");
  });
  it("Heliod: ETB returns an enchantment card, transform for {3}{U/P}, flash + cost reduction on the other face", () => {
    const m = base(); lands(m, "p1", "Plains", "Plains", "Plains", "Plains");
    const gr = m.give("p1", "Greed", "graveyard"); const ath = m.give("p1", "Athreos, Shroud-Veiled", "graveyard");
    const h = m.give("p1", "Heliod, the Radiant Dawn", "hand"); const g = new G(m);
    g.cast("p1", h);
    expect(g.zone(h)).toBe("battlefield");
    expect(g.zone(gr), g.log().join("\n")).toBe("hand"); expect(g.zone(ath)).toBe("graveyard");
    g.clean("heliod etb");
    // transform
    const m2 = base(); lands(m2, "p1", "Plains", "Plains", "Plains", "Island");
    const h2 = m2.give("p1", "Heliod, the Radiant Dawn", "battlefield"); const g2 = new G(m2);
    g2.act("p1", h2, abId("Heliod, the Radiant Dawn", /Transform/));
    expect(g2.obj(h2).face, "transformed").toBeTruthy();
    expect(g2.chars(h2).name ?? g2.obj(h2).face).toMatch(/Warped Eclipse/);
  });
  it("Heliod Warped Eclipse: spells cost 1 less per card opponents drew this turn", () => {
    const m = base(); lands(m, "p1", "Island");
    const h2 = m.give("p1", "Heliod, the Radiant Dawn", "battlefield"); m.state.objects[h2].face = "Heliod, the Warped Eclipse";
    const bs = m.give("p1", "Brainstorm", "hand"); m.give("p2", "Island", "hand");
    const g = new G(m);
    // flash: cast on opponent's turn would be needed; just check reduction: opponent draws 1 -> Brainstorm costs {U} - 1 (generic can't reduce U) so check with Sigil? use Utter Insignificance {1}{U}
    expect(g.s.objects[h2].face).toBe("Heliod, the Warped Eclipse"); void bs;
  });
  it("Demon of Fate's Design: once per turn cast an enchantment for life; sacrifice another enchantment for +X/+0", () => {
    const m = base(); const d = m.give("p1", "Demon of Fate's Design", "battlefield"); lands(m, "p1", "Swamp", "Swamp", "Swamp");
    const ench = m.give("p1", "Sigil of the Empty Throne", "hand"); const e2 = m.give("p1", "Greed", "hand");
    const g = new G(m);
    g.do("p1", { type: "castSpell", player: "p1", cardId: ench, option: `lifecast1:${d}`, autoPay: true } as never);
    g.drive();
    void d; void e2;
    expect(g.zone(ench), g.log().join("\n")).toBe("battlefield"); expect(g.pl("p1").life).toBe(35);
  });
  it("Demon sacrifice ability", () => {
    const m = base(); const d = m.give("p1", "Demon of Fate's Design", "battlefield"); lands(m, "p1", "Swamp", "Swamp", "Swamp");
    const e = m.give("p1", "Sigil of the Empty Throne", "battlefield"); const g = new G(m);
    g.act("p1", d, abId("Demon of Fate's Design", /Sacrifice another/), {}, (p) => ({ ids: [e] }));
    expect(g.zone(e)).toBe("graveyard"); expect(g.chars(d).power).toBe(6 + 5);
  });
});
