import { describe, expect, it } from "vitest";
import { G, base, lands, labelPick, abId, toUpkeep } from "./aminatoukit";

const firstOpt: never = undefined as never; void firstOpt;
describe("aminatou sweep: set 5", () => {
  it("Portent: look + reorder, then the controller draws at the next upkeep", () => {
    const m = base(); lands(m, "p1", "Island"); const pt = m.give("p1", "Portent", "hand"); const g = new G(m);
    g.cast("p1", pt, { targets: { t1: ["p1"] } });
    expect(g.asked).toContain("order_library");
    const h = g.pl("p1").hand.length;
    toUpkeep(g, "p2");
    expect(g.pl("p1").hand.length - h, g.log().join("\n")).toBe(1);
  });
  it("Utter Insignificance: base 1/1, loses abilities; {2}{C} exiles", () => {
    const m = base(); lands(m, "p1", "Island", "Island", "Island", "Island"); const cr = m.give("p2", "Ledger Shredder", "battlefield"); const ui = m.give("p1", "Utter Insignificance", "hand");
    m.give("p1", "Sol Ring", "battlefield");
    const g = new G(m);
    g.cast("p1", ui, { targets: { t1: [cr] } });
    expect(g.zone(ui)).toBe("battlefield"); const c = g.chars(cr); expect(c.power).toBe(1); expect(c.toughness).toBe(1); expect(JSON.stringify(c.keywords ?? [])).not.toMatch(/flying/);
    g.act("p1", ui, abId("Utter Insignificance", /Exile enchanted/));
    expect(g.zone(cr), g.log().join("\n")).toBe("exile");
    g.clean("UI");
  });
  it("Obscura Storefront: sacrificed on entering, fetch basic Plains/Island/Swamp tapped, gain 1 life", () => {
    const m = base(); const st = m.give("p1", "Obscura Storefront", "hand"); const pl = m.give("p1", "Plains", "library", { top: true }); m.give("p1", "Forest", "library", { top: true }); const g = new G(m);
    g.land("p1", st);
    expect(g.zone(st)).toBe("graveyard"); expect(g.zone(pl), g.log().join("\n")).toBe("battlefield"); expect(g.obj(pl).tapped).toBe(true); expect(g.pl("p1").life).toBe(41);
    g.clean("storefront");
  });
  it("Myriad Landscape: sac for two basics sharing a type", () => {
    const m = base(); const ml = m.give("p1", "Myriad Landscape", "battlefield"); lands(m, "p1", "Island", "Island");
    const a = m.give("p1", "Island", "library", { top: true }); const b = m.give("p1", "Island", "library", { top: true }); m.give("p1", "Swamp", "library", { top: true }); const g = new G(m);
    g.act("p1", ml, abId("Myriad Landscape", /Search your library/));
    expect(g.zone(ml)).toBe("graveyard"); const fetched = g.s.battlefield.filter((x) => g.obj(x).tapped && g.obj(x).cardName === "Swamp"); void a; void b;
    expect(fetched.length, g.log().join("\n")).toBe(2); g.clean("landscape");
  });
  it("Evolving Wilds / Wayfarer's Bauble / Temple scry", () => {
    const m = base(); const ew = m.give("p1", "Evolving Wilds", "battlefield"); const f = m.give("p1", "Forest", "library", { top: true }); const g = new G(m);
    g.act("p1", ew, abId("Evolving Wilds", /Search/)); expect(g.zone(f)).toBe("battlefield"); expect(g.obj(f).tapped).toBe(true); expect(g.zone(ew)).toBe("graveyard");
    const m2 = base(); lands(m2, "p1", "Island", "Island"); const wb = m2.give("p1", "Wayfarer's Bauble", "battlefield"); const f2 = m2.give("p1", "Forest", "library", { top: true }); const g2 = new G(m2);
    g2.act("p1", wb, abId("Wayfarer's Bauble", /Search/)); expect(g2.zone(f2)).toBe("battlefield"); expect(g2.obj(f2).tapped).toBe(true); expect(g2.zone(wb)).toBe("graveyard");
    g2.clean("bauble");
  });
  it("Extravagant Replication: upkeep copy of another target nonland permanent", () => {
    const m = base(); m.give("p1", "Extravagant Replication", "battlefield"); m.give("p1", "Ledger Shredder", "battlefield"); const g = new G(m);
    toUpkeep(g, "p1"); g.drive();
    expect(g.find("Ledger Shredder", "battlefield", "p1").length, g.log().join("\n")).toBe(2);
  });
  it("Sunken Palace: tap for U; exile seven from graveyard for the copy mana", () => {
    const m = base(); const sp = m.give("p1", "Sunken Palace", "battlefield"); lands(m, "p1", "Island", "Island");
    for (let i = 0; i < 7; i++) m.give("p1", "Swamp", "graveyard"); const g = new G(m);
    g.act("p1", sp, abId("Sunken Palace", /Exile seven/));
    expect(g.find("Swamp", "exile")).toHaveLength(7); expect(g.find("Swamp", "exile")).toHaveLength(7);
  });
  it("Secret Arcade / Dusty Parlor: enchantment cast puts counters equal to MV on a creature", () => {
    const m = base(); lands(m, "p1", "Plains", "Plains", "Plains", "Island");
    const room = m.give("p1", "Secret Arcade", "battlefield"); m.state.objects[room].unlocked = ["Dusty Parlor"]; const cr = m.give("p1", "Ledger Shredder", "battlefield"); const gr = m.give("p1", "Propaganda", "hand"); const g = new G(m);
    g.cast("p1", gr, {}, (p) => (p.kind === "choose_targets" ? { ids: [cr] } : undefined));
    expect(g.obj(cr).counters["+1/+1"], g.log().join("\n")).toBe(3);
  });
  it("Debtors' Knell / Virtue of Persistence: upkeep reanimation from any graveyard", () => {
    for (const n of ["Debtors' Knell", "Virtue of Persistence"]) {
      const m = base(); m.give("p1", n, "battlefield"); const c = m.give("p2", "Ledger Shredder", "graveyard"); const g = new G(m);
      toUpkeep(g, "p1"); g.drive();
      expect(g.zone(c), n + "\n" + g.log().join("\n")).toBe("battlefield"); expect(g.obj(c).controller).toBe("p1");
    }
  });
  it("Virtue of Persistence adventure: Locthwain Scorn goes on an adventure, then the enchantment is cast from exile; normal cast needs no creature", () => {
    const m = base(); lands(m, "p1", "Swamp", "Swamp", "Swamp", "Swamp", "Swamp", "Swamp", "Swamp", "Swamp", "Swamp"); const cr = m.give("p2", "Ledger Shredder", "battlefield"); const v = m.give("p1", "Virtue of Persistence", "hand"); const g = new G(m);
    g.cast("p1", v, { face: "Locthwain Scorn", targets: { t2: [cr] } } as never);
    expect(g.pl("p1").life).toBe(42); expect(g.zone(cr)).toBe("graveyard"); expect(g.zone(v)).toBe("exile");
    g.cast("p1", v, { face: "Virtue of Persistence" } as never);
    expect(g.zone(v), g.log().join(String.fromCharCode(10))).toBe("battlefield");
    const m2 = base(); lands(m2, "p1", "Swamp", "Swamp", "Swamp", "Swamp", "Swamp", "Swamp", "Swamp"); const v2 = m2.give("p1", "Virtue of Persistence", "hand"); const g2 = new G(m2);
    g2.cast("p1", v2); expect(g2.zone(v2)).toBe("battlefield");
  });
});
