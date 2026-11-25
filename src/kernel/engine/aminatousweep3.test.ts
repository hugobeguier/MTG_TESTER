import { describe, expect, it } from "vitest";
import { G, base, lands, labelPick, abId } from "./aminatoukit";

describe("aminatou sweep: set 3", () => {
  it("Zur: enchantment creatures get deathtouch/lifelink/hexproof; {1}{W} animates a non-Aura enchantment", () => {
    const m = base(); lands(m, "p1", "Plains", "Plains");
    const z = m.give("p1", "Zur, Eternal Schemer", "battlefield"); const e = m.give("p1", "Greed", "battlefield"); const g = new G(m);
    g.act("p1", z, abId("Zur, Eternal Schemer", /becomes a creature/), { targets: { t1: [e] } });
    const c = g.chars(e); expect(c.types).toContain("creature"); expect(c.power).toBe(4); expect(c.toughness).toBe(4);
    expect(JSON.stringify(c.keywords ?? c.abilities)).toMatch(/deathtouch/i);
    g.clean("zur");
  });
  it("Starfield of Nyx: upkeep return; animation with 5+ enchantments", () => {
    const m = base(); const sf = m.give("p1", "Starfield of Nyx", "battlefield");
    const gr = m.give("p1", "Greed", "graveyard");
    for (const n of ["Propaganda", "Monologue Tax", "Sigil of the Empty Throne", "Mystic Remora"]) m.give("p1", n, "battlefield");
    const g = new G(m); void sf;
    // 5 enchantments (Starfield + 4): others become creatures with P/T = MV
    const prop = g.bf("Propaganda")[0]; const c = g.chars(prop);
    expect(c.types).toContain("creature"); expect(c.power).toBe(3);
    expect(g.chars(sf).types).not.toContain("creature"); // "each OTHER"
    expect(g.zone(gr)).toBe("graveyard");
  });
  it("Starfield of Nyx: upkeep trigger returns an enchantment card", () => {
    const m = base(); m.give("p1", "Starfield of Nyx", "battlefield"); const gr = m.give("p1", "Greed", "graveyard");
    m.state.turn.phase = "end_step" as never; const g = new G(m);
    // advance to opponent's turn then back to p1's upkeep
    for (let i = 0; i < 40 && !(g.s.turn.active === "p1" && g.s.turn.number > 1 && g.s.turn.phase === "upkeep"); i++) {
      if (g.s.pending) g.drive(); else if (g.s.stack.length) g.drive(); else g.do(g.s.turn.active, { type: "advancePhase", player: g.s.turn.active } as never);
    }
    g.drive();
    expect(g.zone(gr), g.log().join("\n")).toBe("battlefield");
  });
  it("Athreos: not a creature below 7 devotion; end step coin counter; dies -> returns", () => {
    const m = base(); const a = m.give("p1", "Athreos, Shroud-Veiled", "battlefield"); const cr = m.give("p1", "Ledger Shredder", "battlefield");
    const g = new G(m);
    expect(g.chars(a).types).not.toContain("creature"); expect(g.chars(a).keywords ?? []).toBeDefined();
    // trigger via end step
    g.s.turn.phase = "postcombat_main" as never;
    for (let i = 0; i < 10 && !(g.s.turn.phase === "end_step"); i++) g.do("p1", { type: "advancePhase", player: "p1" } as never);
    g.drive();
    expect(g.obj(cr).counters.coin, g.log().join("\n")).toBe(1);
  });
  it("Athreos: creature with coin counter returns when it dies", () => {
    const m = base(); m.give("p1", "Athreos, Shroud-Veiled", "battlefield"); const cr = m.give("p2", "Ledger Shredder", "battlefield", { counters: { coin: 1 } });
    lands(m, "p1", "Plains", "Swamp"); const sw = m.give("p1", "Swords to Plowshares", "hand"); const g = new G(m);
    g.cast("p1", sw, { targets: { t1: [cr] } });
    const back = g.find("Ledger Shredder", "battlefield"); expect(back, g.log().join("\n")).toHaveLength(1);
    expect(g.obj(back[0]).controller).toBe("p1");
  });
  it("Esper Sentinel: draw unless pay", () => {
    const m = base(); m.give("p1", "Esper Sentinel", "battlefield"); lands(m, "p2", "Island", "Island"); const bs = m.give("p2", "Brainstorm", "hand");
    m.state.turn.active = "p2"; m.state.priority = "p2";
    const g = new G(m);
    const h0 = g.pl("p1").hand.length;
    g.cast("p2", bs, {}, (p) => (p.kind === "pay_unless" ? { yes: false } : p.kind === "choose_yes_no" ? { yes: false } : p.options.some((o) => /Island|Swamp/.test(o.label)) ? labelPick(/./, p.min)(p, g) : undefined));
    expect(g.pl("p1").hand.length, g.log().join("\n")).toBe(h0 + 1);
  });
  it("Shark Typhoon: noncreature spell makes X/X shark; cycling makes shark", () => {
    const m = base(); lands(m, "p1", "Island", "Island", "Island"); m.give("p1", "Shark Typhoon", "battlefield"); const bs = m.give("p1", "Brainstorm", "hand"); const g = new G(m);
    g.cast("p1", bs, {}, (p) => p.options.length ? { ids: p.options.slice(0, Math.max(p.min, 1)).map((o) => o.id) } : undefined);
    const sh = g.find("Shark", "battlefield"); expect(sh, g.log().join("\n")).toHaveLength(1); expect(g.chars(sh[0]).power).toBe(1);
    const m2 = base(); lands(m2, "p1", "Island", "Island", "Island", "Island"); const st = m2.give("p1", "Shark Typhoon", "hand"); const g2 = new G(m2);
    const ab = ctx_cycle(g2, st);
    expect(g2.find("Shark", "battlefield").length, "cycling " + ab).toBe(1);
  });
});
function ctx_cycle(g: G, st: string) {
  g.do("p1", { type: "activateAbility", player: "p1", sourceId: st, abilityId: "a2", x: 2, autoPay: true } as never); g.drive();
  g.clean("cycling");
  const sh = g.find("Shark", "battlefield"); if (sh.length) expect(g.chars(sh[0]).power).toBe(2);
  return "a2";
}
