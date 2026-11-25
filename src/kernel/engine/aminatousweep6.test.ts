import { describe, expect, it } from "vitest";
import { G, base, lands, abId } from "./aminatoukit";

const putBack = (p: { kind: string; min: number; options: Array<{ id: string; label: string }> }) => (p.kind === "choose_cards" && p.options.some((o) => /Island|Swamp/.test(o.label)) ? { ids: p.options.filter((o) => /Island|Swamp/.test(o.label)).slice(0, p.min).map((o) => o.id) } : undefined);
const J = (g: G) => g.log().join(String.fromCharCode(10));
const kw = (g: G, id: string) => JSON.stringify(g.chars(id).keywords ?? g.chars(id).abilities);
describe("aminatou sweep: set 6", () => {
  it("Archon of Sun's Grace: constellation Pegasus token with flying + lifelink", () => {
    const m = base(); lands(m, "p1", "Plains", "Plains", "Plains", "Swamp"); m.give("p1", "Archon of Sun's Grace", "battlefield"); const e = m.give("p1", "Greed", "hand"); const g = new G(m);
    g.cast("p1", e);
    const pg = g.find("Pegasus", "battlefield"); expect(pg, J(g)).toHaveLength(1);
    expect(g.chars(pg[0]).power).toBe(2); expect(kw(g, pg[0])).toMatch(/flying/); expect(kw(g, pg[0])).toMatch(/lifelink/);
  });
  it("Soaring Lightbringer: other enchantment creatures fly", () => {
    const m = base(); m.give("p1", "Soaring Lightbringer", "battlefield"); const ec = m.give("p1", "Doomwake Giant", "battlefield"); const g = new G(m);
    expect(kw(g, ec)).toMatch(/flying/);
  });
  it("Doomwake Giant: constellation -1/-1 to opponents' creatures", () => {
    const m = base(); lands(m, "p1", "Swamp", "Swamp", "Swamp", "Swamp", "Swamp"); const t = m.give("p2", "Ledger Shredder", "battlefield"); const d = m.give("p1", "Doomwake Giant", "hand"); const g = new G(m);
    g.cast("p1", d); expect(g.chars(t).power, J(g)).toBe(0); expect(g.chars(t).toughness).toBe(2);
  });
  it("Boon of the Spirit Realm: blessing counter and anthem", () => {
    const m = base(); lands(m, "p1", "Plains", "Plains", "Plains", "Plains", "Plains"); const cr = m.give("p1", "Ledger Shredder", "battlefield"); const b = m.give("p1", "Boon of the Spirit Realm", "hand"); const g = new G(m);
    g.cast("p1", b); expect(g.obj(b).counters.blessing, J(g)).toBe(1); expect(g.chars(cr).power).toBe(2);
  });
  it("Callaphe: power = devotion to blue", () => {
    const m = base(); const c = m.give("p1", "Callaphe, Beloved of the Sea", "battlefield"); const g = new G(m);
    expect(g.chars(c).power).toBe(2);
  });
  it("Moon-Blessed Cleric: ETB tutor enchantment to top", () => {
    const m = base(); lands(m, "p1", "Plains", "Plains", "Plains"); const e = m.give("p1", "Greed", "library"); const cl = m.give("p1", "Moon-Blessed Cleric", "hand"); const g = new G(m);
    g.cast("p1", cl); expect(g.pl("p1").library[0], J(g)).toBe(e);
  });
  it("Monologue Tax: opponent's second spell gives a Treasure", () => {
    const m = base(); m.give("p1", "Monologue Tax", "battlefield"); lands(m, "p2", "Island", "Island", "Island"); const a = m.give("p2", "Brainstorm", "hand"); const b = m.give("p2", "Ponder", "hand"); const g = new G(m);
    g.s.turn.active = "p2"; g.s.priority = "p2";
    g.cast("p2", a, {}, putBack as never); g.cast("p2", b);
    expect(g.find("Treasure", "battlefield", "p1"), J(g)).toHaveLength(1);
  });
  it("Mystic Remora: draw when an opponent casts a noncreature spell", () => {
    const m = base(); lands(m, "p2", "Island", "Island"); m.give("p1", "Mystic Remora", "battlefield"); const a = m.give("p2", "Brainstorm", "hand"); const g = new G(m);
    g.s.turn.active = "p2"; g.s.priority = "p2";
    const h = g.pl("p1").hand.length;
    g.cast("p2", a, {}, (p) => (p.kind === "pay_unless" ? { yes: false } : p.kind === "choose_yes_no" ? { yes: true } : p.options.length ? { ids: p.options.slice(0, Math.max(p.min, 1)).map((o) => o.id) } : undefined));
    expect(g.pl("p1").hand.length - h, J(g)).toBe(1);
  });
  it("Ledger Shredder: connives on the second spell of a turn", () => {
    const m = base(); lands(m, "p1", "Island", "Island", "Island"); m.give("p1", "Ledger Shredder", "battlefield"); const a = m.give("p1", "Brainstorm", "hand"); const b = m.give("p1", "Ponder", "hand"); const g = new G(m);
    g.cast("p1", a, {}, putBack as never); const h = g.pl("p1").hand.length; g.cast("p1", b);
    expect(g.unresolved()).toEqual([]);
    expect(J(g)).toMatch(/conniv/i);
    void h;
  });
  it("Greed: {B}, pay 2 life: draw", () => {
    const m = base(); lands(m, "p1", "Swamp"); const gr = m.give("p1", "Greed", "battlefield"); const g = new G(m);
    g.act("p1", gr, abId("Greed", /Draw a card/)); expect(g.pl("p1").hand.length).toBe(1); expect(g.pl("p1").life).toBe(38);
  });
  it("Enhanced Surveillance: surveil looks at 2 more; exile: shuffle graveyard in", () => {
    const m = base(); lands(m, "p1", "Island"); m.give("p1", "Enhanced Surveillance", "battlefield"); const o = m.give("p1", "Otherworldly Gaze", "hand"); const g = new G(m);
    let n = 0; g.cast("p1", o, {}, (p) => { if (p.kind === "order_library") n = p.options.length; return undefined; }); expect(n).toBe(5);
    const m2 = base(); const es = m2.give("p1", "Enhanced Surveillance", "battlefield"); const gy = m2.give("p1", "Ponder", "graveyard"); const g2 = new G(m2);
    g2.act("p1", es, abId("Enhanced Surveillance", /Shuffle your graveyard/)); expect(g2.zone(gy), J(g2)).toBe("library"); expect(g2.zone(es)).toBe("exile");
  });
  it("Timely Ward / Vanishing", () => {
    const m = base(); lands(m, "p1", "Plains", "Plains", "Plains"); const cr = m.give("p1", "Ledger Shredder", "battlefield"); const tw = m.give("p1", "Timely Ward", "hand"); const g = new G(m);
    g.cast("p1", tw, { targets: { t1: [cr] } }); expect(g.zone(tw)).toBe("battlefield"); expect(kw(g, cr)).toMatch(/indestructible/);
    const m2 = base(); lands(m2, "p1", "Island", "Island", "Island"); const t2 = m2.give("p2", "Ledger Shredder", "battlefield"); const v = m2.give("p1", "Vanishing", "hand"); const g2 = new G(m2);
    g2.cast("p1", v, { targets: { t1: [t2] } }); g2.act("p1", v, abId("Vanishing", /phases out/)); expect(g2.s.phased?.some((x) => x.id === t2)).toBe(true);
  });
  it("Overwhelming Splendor: creatures lose abilities, 1/1", () => {
    const m = base(); lands(m, "p1", "Plains", "Plains", "Plains", "Plains", "Plains", "Plains", "Plains", "Plains"); const t = m.give("p2", "Ledger Shredder", "battlefield"); const o = m.give("p1", "Overwhelming Splendor", "hand"); const g = new G(m);
    g.cast("p1", o, { targets: { t1: ["p2"] } }); const c = g.chars(t); expect(c.power, J(g)).toBe(1); expect(c.toughness).toBe(1); expect(kw(g, t)).not.toMatch(/flying/);
  });
  it("Temporal Mastery: extra turn + exile; Devastation Tide bounces nonlands", () => {
    const m = base(); lands(m, "p1", "Island", "Island", "Island", "Island", "Island", "Island", "Island"); const tm = m.give("p1", "Temporal Mastery", "hand"); const g = new G(m);
    g.cast("p1", tm); expect(g.zone(tm)).toBe("exile"); expect(g.events.some((e) => e.type === "extra_turn_added")).toBe(true);
    const m2 = base(); lands(m2, "p1", "Island", "Island", "Island", "Island", "Island"); const a = m2.give("p1", "Sol Ring", "battlefield"); const b = m2.give("p2", "Ledger Shredder", "battlefield"); const dt = m2.give("p1", "Devastation Tide", "hand"); const g2 = new G(m2);
    g2.cast("p1", dt); expect(g2.zone(a)).toBe("hand"); expect(g2.zone(b)).toBe("hand");
  });
  it("Redress Fate returns artifacts and enchantments from your graveyard", () => {
    const m = base(); lands(m, "p1", "Plains", "Plains", "Plains", "Plains", "Plains", "Plains", "Plains", "Plains"); const a = m.give("p1", "Sol Ring", "graveyard"); const b = m.give("p1", "Greed", "graveyard"); const c = m.give("p1", "Ledger Shredder", "graveyard"); const rf = m.give("p1", "Redress Fate", "hand"); const g = new G(m);
    g.cast("p1", rf); expect(g.zone(a)).toBe("battlefield"); expect(g.zone(b)).toBe("battlefield"); expect(g.zone(c)).toBe("graveyard");
  });
  it("Blasphemous Edict: free with 13 creatures; each player sacrifices thirteen", () => {
    const m = base(); lands(m, "p1", "Swamp"); for (let i = 0; i < 14; i++) m.give("p1", "Ledger Shredder", "battlefield"); for (let i = 0; i < 14; i++) m.give("p2", "Ledger Shredder", "battlefield");
    const be = m.give("p1", "Blasphemous Edict", "hand"); const g = new G(m);
    g.do("p1", { type: "castSpell", player: "p1", cardId: be, autoPay: true } as never); g.drive((p) => { console.log("EDICT", p.kind, JSON.stringify(p.options)); return p.kind === "choose_cast_option" ? { ids: [p.options[p.options.length - 1].id] } : undefined; });
    expect(g.s.battlefield.filter((i) => g.obj(i).cardName === "Ledger Shredder").length, J(g)).toBe(2);
  });
  it("Counterspell / Void Rend / Utter End", () => {
    const m = base(); lands(m, "p1", "Island", "Island"); lands(m, "p2", "Island", "Island"); const sp = m.give("p2", "Brainstorm", "hand"); const cs = m.give("p1", "Counterspell", "hand"); const g = new G(m);
    g.s.turn.active = "p2"; g.s.priority = "p2";
    g.do("p2", { type: "castSpell", player: "p2", cardId: sp, autoPay: true } as never); g.do("p2", { type: "passPriority", player: "p2" } as never);
    g.cast("p1", cs, { targets: { t1: [sp] } }); expect(g.zone(sp)).toBe("graveyard"); expect(g.pl("p2").hand.length).toBe(0);
    const m2 = base(); lands(m2, "p1", "Plains", "Island", "Swamp"); const t = m2.give("p2", "Sol Ring", "battlefield"); const vr = m2.give("p1", "Void Rend", "hand"); const g2 = new G(m2);
    g2.cast("p1", vr, { targets: { t1: [t] } }); expect(g2.zone(t)).toBe("graveyard");
    const m3 = base(); lands(m3, "p1", "Plains", "Plains", "Swamp", "Swamp"); const t3 = m3.give("p2", "Sol Ring", "battlefield"); const ue = m3.give("p1", "Utter End", "hand"); const g3 = new G(m3);
    g3.cast("p1", ue, { targets: { t1: [t3] } }); expect(g3.zone(t3)).toBe("exile");
  });
});
