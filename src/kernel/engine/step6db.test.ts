// Kernel step 6: the host card database (CardDb): full creature-type list for "choose a creature type", faces / layout of multi-faced cards.
import { describe, expect, it } from "vitest";
import { cardUnsupported } from "./support";
import { realDef, realTable, testDb } from "./testdb";

describe("CardDb (test adapter from data/cards.db)", () => {
  it("knows creature types, names and the printed data of cards", () => {
    const db = testDb();
    expect(db.creatureTypes()).toContain("Dragon");
    expect(db.creatureTypes()).toContain("Phyrexian");
    expect(db.creatureTypes()).not.toContain("Forest");
    expect(db.cardNames()).toContain("Sol Ring");
    expect(db.card("Thunderbreak Regent")).toMatchObject({ types: ["creature"], subtypes: ["Dragon"], manaCost: "{2}{R}{R}", power: 4, toughness: 4 });
    expect(db.card("nonexistent card name")).toBeUndefined();
  });
  it("derives layouts of multi-faced cards", () => {
    const db = testDb();
    expect(db.card("Agadeem's Awakening // Agadeem, the Undercrypt")).toMatchObject({ layout: "modal_dfc" });
    expect(db.card("Westvale Abbey // Ormendahl, Profane Prince")?.layout).toBe("transform");
    expect(Object.keys(db.card("Westvale Abbey // Ormendahl, Profane Prince")!.faces!)).toEqual(["Westvale Abbey", "Ormendahl, Profane Prince"]);
  });
  it("a def built from a draft carries the db metadata", () => {
    const d = realDef("Herald's Horn")!;
    expect(d.types).toEqual(["artifact"]);
    expect(d.manaCost).toBe("{3}");
  });
  it("choose a creature type offers the whole list when a db is attached (and only the core list without)", () => {
    expect(cardUnsupported(realDef("Herald's Horn")!).all).toEqual([]);
    const t = realTable();
    t.lands("p1", "Plains", 0);
    const horn = realDef("Herald's Horn")!;
    expect(horn.kernel.abilities.some((a) => JSON.stringify(a).includes("creature_type"))).toBe(true);
    for (let i = 0; i < 3; i++) t.give("p1", "Mountain", "battlefield");
    const id = t.give("p1", "Herald's Horn", "hand");
    const res = t.ok({ type: "castSpell", player: "p1", cardId: id });
    expect(res.pending).toBeUndefined();
    const res2 = t.resolveTop();
    expect(res2.pending?.kind).toBe("choose_option");
    const labels = res2.pending!.options.map((o) => o.label);
    expect(labels).toContain("Wurm");
    expect(labels.length).toBeGreaterThan(200);
  });
});
