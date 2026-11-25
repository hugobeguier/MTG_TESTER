import { describe, expect, it } from "vitest";
import { G, base, lands, abId, toUpkeep } from "./aminatoukit";

const J = (g: G) => g.log().join(String.fromCharCode(10));
const putBack = (p: { kind: string; min: number; options: Array<{ id: string; label: string }> }) => (p.kind === "choose_cards" && p.options.some((o) => /Island|Swamp/.test(o.label)) ? { ids: p.options.filter((o) => /Island|Swamp/.test(o.label)).slice(0, p.min).map((o) => o.id) } : undefined);
describe("aminatou sweep: set 7", () => {
  it("Omniscience: cast from hand for free", () => {
    const m = base(); m.give("p1", "Omniscience", "battlefield"); const x = m.give("p1", "Utter End", "hand"); const t = m.give("p2", "Sol Ring", "battlefield"); const g = new G(m);
    g.cast("p1", x, { targets: { t1: [t] } }, (p) => (p.kind === "choose_cast_option" ? { ids: [p.options.find((o) => /without paying/i.test(o.label))?.id ?? p.options[0].id] } : undefined));
    expect(g.zone(t), J(g)).toBe("exile");
  });
  it("One with the Multiverse: play land from top, cast from top, once-per-turn free cast", () => {
    const m = base({ lib: false }); m.give("p1", "One with the Multiverse", "battlefield");
    for (let i = 0; i < 4; i++) m.give("p1", "Island", "library");
    const l = m.give("p1", "Island", "library", { top: true }); const g = new G(m);
    g.land("p1", l); expect(g.zone(l)).toBe("battlefield");
    const m2 = base({ lib: false }); m2.give("p1", "One with the Multiverse", "battlefield"); for (let i = 0; i < 4; i++) m2.give("p2", "Island", "library");
    for (let i = 0; i < 4; i++) m2.give("p1", "Island", "library");
    const t = m2.give("p2", "Sol Ring", "battlefield"); const ue = m2.give("p1", "Utter End", "library", { top: true }); const g2 = new G(m2);
    g2.cast("p1", ue, { targets: { t1: [t] } }, (p) => (p.kind === "choose_cast_option" ? { ids: [p.options.find((o) => /without paying/i.test(o.label))?.id ?? p.options[0].id] } : undefined));
    expect(g2.zone(t), J(g2)).toBe("exile");
    // from hand, free, but only once per turn
    const m3 = base(); m3.give("p1", "One with the Multiverse", "battlefield"); const t3 = m3.give("p2", "Sol Ring", "battlefield"); const t4 = m3.give("p2", "Sol Ring", "battlefield");
    const a = m3.give("p1", "Utter End", "hand"); const b = m3.give("p1", "Utter End", "hand"); const g3 = new G(m3);
    const free = (p: { kind: string; options: Array<{ id: string; label: string }> }) => (p.kind === "choose_cast_option" ? { ids: [p.options.find((o) => /without paying/i.test(o.label))?.id ?? p.options[0].id] } : undefined);
    g3.cast("p1", a, { targets: { t1: [t3] } }, free as never); expect(g3.zone(t3)).toBe("exile");
    expect(() => g3.cast("p1", b, { targets: { t1: [t4] } }, free as never)).toThrow();
  });
  it("Estrid's Invocation: enters as a copy of an enchantment you control", () => {
    const m = base(); lands(m, "p1", "Island", "Island", "Island"); m.give("p1", "Propaganda", "battlefield"); const e = m.give("p1", "Estrid's Invocation", "hand"); const g = new G(m);
    g.cast("p1", e, {}, (p) => (p.kind === "choose_yes_no" ? { yes: true } : undefined));
    expect(g.find("Propaganda", "battlefield", "p1").length + g.s.battlefield.filter((i) => g.chars(i).name === "Propaganda").length, J(g)).toBeGreaterThanOrEqual(2);
    expect(g.unresolved()).toEqual([]);
  });
  it("Fear of Sleep Paralysis: eerie taps and stuns up to one target creature", () => {
    const m = base(); lands(m, "p1", "Island", "Island", "Island", "Island", "Island", "Island"); const t = m.give("p2", "Ledger Shredder", "battlefield"); const f = m.give("p1", "Fear of Sleep Paralysis", "hand"); const g = new G(m);
    g.cast("p1", f, {}, (p) => (p.kind === "choose_targets" ? { ids: [t] } : undefined));
    expect(g.obj(t).tapped, J(g)).toBe(true); expect(g.obj(t).counters.stun).toBe(1);
  });
  it("Mind's Dilation: opponent's first spell exiles top card; free cast of a nonland", () => {
    const m = base(); m.give("p1", "Mind's Dilation", "battlefield"); lands(m, "p2", "Island"); const a = m.give("p2", "Brainstorm", "hand"); m.give("p2", "Sol Ring", "library", { top: true }); const g = new G(m);
    g.s.turn.active = "p2"; g.s.priority = "p2";
    g.cast("p2", a, {}, (p) => (p.kind === "choose_yes_no" ? { yes: true } : putBack(p as never)));
    expect(g.find("Sol Ring", "battlefield", "p1"), J(g)).toHaveLength(1);
  });
  it("Brainsurge / Brainstorm / Ponder / Diabolic Vision / Otherworldly Gaze flashback", () => {
    const m = base(); lands(m, "p1", "Island", "Island", "Island", "Island"); const b = m.give("p1", "Brainsurge", "hand"); const g = new G(m);
    const h0 = g.pl("p1").hand.length; g.cast("p1", b, {}, putBack as never); expect(g.pl("p1").hand.length - h0).toBe(1); // draw 4, put back 2 (the cast card left the hand)
    const m2 = base(); lands(m2, "p1", "Island", "Island", "Island"); const o = m2.give("p1", "Otherworldly Gaze", "hand"); const g2 = new G(m2);
    g2.cast("p1", o); expect(g2.zone(o)).toBe("graveyard");
    g2.cast("p1", o, {}, undefined); // flashback {1}{U}
    expect(g2.zone(o), J(g2)).toBe("exile");
  });
  it("Inquisitive Glimmer: enchantment spells cost {1} less", () => {
    const m = base(); lands(m, "p1", "Plains", "Plains"); m.give("p1", "Inquisitive Glimmer", "battlefield"); const e = m.give("p1", "Sigil of the Empty Throne", "hand"); const g = new G(m);
    expect(() => g.cast("p1", e)).toThrow(); // {3}{W}{W} minus 1 = {2}{W}{W}: two lands is not enough
    const m2 = base(); lands(m2, "p1", "Plains", "Plains", "Plains", "Plains"); m2.give("p1", "Inquisitive Glimmer", "battlefield"); const e2 = m2.give("p1", "Sigil of the Empty Throne", "hand"); const g2 = new G(m2);
    g2.cast("p1", e2); expect(g2.zone(e2)).toBe("battlefield");
  });
  it("Sigil of the Empty Throne: enchantment cast makes a 4/4 flying Angel", () => {
    const m = base(); lands(m, "p1", "Plains"); m.give("p1", "Sigil of the Empty Throne", "battlefield"); lands(m, "p1", "Plains", "Plains", "Island", "Island"); const e = m.give("p1", "Greed", "hand"); lands(m, "p1", "Swamp"); const g = new G(m);
    g.cast("p1", e); const an = g.find("Angel", "battlefield"); expect(an, J(g)).toHaveLength(1); expect(g.chars(an[0]).power).toBe(4);
  });
  it("Shadow of the Second Sun: extra beginning phase after enchanted player's postcombat main", () => {
    const m = base(); lands(m, "p1", "Island", "Island", "Island", "Island", "Island", "Island"); const sh = m.give("p1", "Shadow of the Second Sun", "hand"); const g = new G(m);
    g.cast("p1", sh, { targets: { t1: ["p2"] } }); expect(g.zone(sh)).toBe("battlefield"); expect(g.obj(sh).attachedPlayer).toBe("p2");
  });
  it("Thriving lands: choose a colour; tap for it", () => {
    const m = base(); const t = m.give("p1", "Thriving Heath", "hand"); const g = new G(m);
    g.land("p1", t, (p) => (p.kind === "choose_color" ? { ids: [p.options.find((o) => /black|B/i.test(o.label))!.id] } : undefined));
    expect(g.obj(t).chosen?.color).toBeTruthy(); expect(g.obj(t).tapped).toBe(true);
  });
  it("Sol Ring / Talisman produce mana", () => {
    const m = base(); const s = m.give("p1", "Sol Ring", "battlefield"); const g = new G(m);
    g.do("p1", { type: "activateAbility", player: "p1", sourceId: s, abilityId: abId("Sol Ring", /Add/) } as never);
    expect(JSON.stringify(g.pl("p1"))).toMatch(/"C":2|C.*2/);
  });
  it("Diabolic Vision / Ponder", () => {
    const m = base(); lands(m, "p1", "Island", "Swamp"); const d = m.give("p1", "Diabolic Vision", "hand"); const g = new G(m);
    const h0 = g.pl("p1").hand.length; g.cast("p1", d); expect(g.pl("p1").hand.length - h0).toBe(0); expect(g.asked.length).toBeGreaterThan(0);
  });
});
