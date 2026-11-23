// Kernel step 10 (a): Scion of Draco (domain), Ramos (spell colors), Ancient Brass Dragon (reanimate amount), Sarkhan, Soul Aflame (copy with exceptName).
import { describe, expect, it } from "vitest";
import { filler, instant, mk } from "./famkit";
import { drain, toAttackers } from "./step10kit";
import { cardUnsupported } from "./support";
import { charsOf, realDef, realTable } from "./testdb";

const names = ["Scion of Draco", "Ramos, Dragon Engine", "Ancient Brass Dragon", "Sarkhan, Soul Aflame"];
describe("step 10a: supported", () => { for (const n of names) it(n, () => { expect(cardUnsupported(realDef(n)!).all, n).toEqual([]); }); });

describe("Scion of Draco: domain", () => {
  it("costs {2} less for each basic land type among your lands", () => {
    const t = realTable();
    for (let i = 0; i < 4; i++) { t.give("p1", "Island", "battlefield"); t.give("p1", "Mountain", "battlefield"); }
    const c = t.give("p1", "Scion of Draco", "hand");
    expect(t.do({ type: "castSpell", player: "p1", cardId: c }).error).toBeUndefined(); // {12} - 2 types * 2 = 8 lands
    const u = realTable();
    for (let i = 0; i < 8; i++) u.give("p1", "Mountain", "battlefield");
    expect(u.do({ type: "castSpell", player: "p1", cardId: u.give("p1", "Scion of Draco", "hand") }).error?.code).toBe("cannot_pay"); // one type: {10}
  });
});

describe("Ramos, Dragon Engine", () => {
  it("puts a +1/+1 counter for each color of a spell you cast", () => {
    const gold = mk("Gold Spell", { manaCost: "{R}{G}", types: ["instant"] }, [{ id: "a1", kind: "spell_effect", text: "x", steps: [] } as never]);
    const t = realTable(["p1", "p2"], { "Gold Spell": gold });
    const ramos = t.give("p1", "Ramos, Dragon Engine", "battlefield");
    t.give("p1", "Mountain", "battlefield"); t.give("p1", "Forest", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Gold Spell", "hand") }); drain(t);
    expect(t.obj(ramos).counters["+1/+1"]).toBe(2);
  });
});

describe("Ancient Brass Dragon: roll, then reanimate any number with total mana value X or less", () => {
  it("puts back only cards that fit the roll", () => {
    const cards = { "Cheap One": mk("Cheap One", { manaCost: "{1}", types: ["creature"], power: 1, toughness: 1 }, []), "Cheap Two": mk("Cheap Two", { manaCost: "{2}", types: ["creature"], power: 1, toughness: 1 }, []), "Huge": mk("Huge", { manaCost: "{9}{9}{9}", types: ["creature"], power: 9, toughness: 9 }, []) };
    const t = realTable(["p1", "p2"], cards);
    const d = t.give("p1", "Ancient Brass Dragon", "battlefield"); t.obj(d).controlledSince = -1;
    const a = t.give("p1", "Cheap One", "graveyard"), b = t.give("p2", "Cheap Two", "graveyard"), h = t.give("p2", "Huge", "graveyard");
    toAttackers(t); t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: d, defender: "p2" }] });
    for (let i = 0; i < 4 && String(t.state.turn.phase) !== "postcombat_main"; i++) { drain(t, (p) => (p.kind === "choose_cards" ? { ids: p.options.filter((o) => [a, b].includes(o.id)).map((o) => o.id).slice(0, 1) } : undefined)); if (String(t.state.turn.phase) !== "postcombat_main") t.ok({ type: "advancePhase", player: "p1" }); }
    drain(t, (p) => (p.kind === "choose_cards" ? { ids: p.options.filter((o) => [a, b].includes(o.id)).map((o) => o.id).slice(0, 1) } : undefined));
    expect(t.obj(h).zone).toBe("graveyard");
    expect([a, b].some((id) => t.obj(id).zone === "battlefield")).toBe(true);
  });
});

describe("Sarkhan, Soul Aflame: becomes a copy of a Dragon, keeping its name, legendary", () => {
  it("copies the entering Dragon until end of turn", () => {
    const t = realTable(["p1", "p2"], { "Test Dragon": mk("Test Dragon", { manaCost: "{1}", types: ["creature"], subtypes: ["Dragon"], power: 5, toughness: 5 }, []) });
    const s = t.give("p1", "Sarkhan, Soul Aflame", "battlefield");
    t.give("p1", "Island", "battlefield"); t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Test Dragon", "hand") }); drain(t);
    const c = charsOf(t, s);
    expect(c.name).toBe("Sarkhan, Soul Aflame");
    expect(c.types).toContain("creature");
    expect(c.supertypes).toContain("legendary");
    expect(c.power).toBe(5);
  });
});

describe("Rhythm of the Wild: nontoken creatures you control have riot (granted 'as this enters')", () => {
  const crea = mk("Plain Bear", { manaCost: "{1}", types: ["creature"], power: 2, toughness: 2 }, []);
  const mkT = () => { const t = realTable(["p1", "p2"], { "Plain Bear": crea }); t.give("p1", "Rhythm of the Wild", "battlefield"); t.give("p1", "Island", "battlefield"); return t; };
  it("riot: +1/+1 counter", () => {
    const t = mkT(); const b = t.give("p1", "Plain Bear", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: b }); drain(t, (p) => (p.options.some((o) => o.id === "+1/+1 counter") ? { ids: ["+1/+1 counter"] } : undefined));
    expect(t.obj(b).zone).toBe("battlefield"); expect(t.obj(b).counters["+1/+1"]).toBe(1); expect(charsOf(t, b).keywords).not.toContain("haste");
  });
  it("riot: haste", () => {
    const t = mkT(); const b = t.give("p1", "Plain Bear", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: b }); drain(t, (p) => (p.options.some((o) => o.id === "haste") ? { ids: ["haste"] } : undefined));
    expect(t.obj(b).counters["+1/+1"] ?? 0).toBe(0); expect(charsOf(t, b).keywords).toContain("haste");
  });
});

describe("Rith: other Dragons have ward {2}", () => {
  it("a Dragon gets the ward trigger", () => {
    const t = realTable(["p1", "p2"], { "Test Dragon": mk("Test Dragon", { manaCost: "{1}", types: ["creature"], subtypes: ["Dragon"], power: 2, toughness: 2 }, []) });
    t.give("p1", "Rith, Liberated Primeval", "battlefield"); const d = t.give("p1", "Test Dragon", "battlefield");
    expect(charsOf(t, d).abilities.some((a) => a.keyword?.name === "ward")).toBe(true);
  });
});

describe("Targeting taxes: Terror of the Peaks, Callaphe", () => {
  const zap = instant("Zap Target", "{R}", [{ kind: "damage_target", target: "t1", amount: 1 } as never], [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: { min: 1, max: 1 } }]);
  it("Terror of the Peaks: an opponent's spell that targets it costs 3 more life", () => {
    expect(cardUnsupported(realDef("Terror of the Peaks")!).all).toEqual([]);
    const t = realTable(["p1", "p2"], { "Zap Target": zap });
    const terror = t.give("p1", "Terror of the Peaks", "battlefield");
    t.give("p2", "Mountain", "battlefield"); t.p("p2"); t.state.priority = "p2";
    t.ok({ type: "castSpell", player: "p2", cardId: t.give("p2", "Zap Target", "hand"), targets: { t1: [terror] } });
    expect(t.p("p2").life).toBe(37);
  });
  it("Callaphe: spells opponents cast that target its controller's creatures cost {1} more", () => {
    expect(cardUnsupported(realDef("Callaphe, Beloved of the Sea")!).all).toEqual([]);
    const t = realTable(["p1", "p2"], { "Zap Target": zap, "Bear": mk("Bear", { manaCost: "{1}", types: ["creature"], power: 2, toughness: 2 }, []) });
    t.give("p1", "Callaphe, Beloved of the Sea", "battlefield"); const bear = t.give("p1", "Bear", "battlefield");
    t.give("p2", "Mountain", "battlefield"); t.state.priority = "p2";
    expect(t.do({ type: "castSpell", player: "p2", cardId: t.give("p2", "Zap Target", "hand"), targets: { t1: [bear] } }).error?.code).toBe("cannot_pay");
    t.give("p2", "Mountain", "battlefield");
    expect(t.do({ type: "castSpell", player: "p2", cardId: t.state.players[1].hand[0], targets: { t1: [bear] } }).error).toBeUndefined();
  });
});
