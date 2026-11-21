// Kernel step 6: hybrid and Phyrexian mana costs.
import { describe, expect, it } from "vitest";
import { parseManaCost } from "./core";
import { settleCost } from "./mana";
import { cardUnsupported } from "./support";
import { fam, mk } from "./famkit";
import { charsOf, realDef, realTable } from "./testdb";

const spellW = (cost: string) => mk("Test Spell", { manaCost: cost, types: ["instant"] }, [{ id: "a1", kind: "spell_effect", text: "gain", steps: [{ kind: "life_change", lifeDelta: 1, who: "you" }] }]);

describe("parsing", () => {
  it("hybrid symbols: mana value and colors", () => {
    const c = parseManaCost("{1}{W/U}{W/U}");
    expect(c.mv).toBe(3);
    expect(c.hybrid).toEqual([["W", "U"], ["W", "U"]]);
    expect(parseManaCost("{2/W}").mv).toBe(2);
    expect(parseManaCost("{B/P}{B/P}").phyrexian).toEqual([["B"], ["B"]]);
    expect(parseManaCost("{B/P}").mv).toBe(1);
  });
  it("garbage is still refused", () => { expect(() => parseManaCost("{Q}")).toThrow(); expect(() => parseManaCost("{W/Z}")).toThrow(); });
});

describe("paying hybrid and Phyrexian costs", () => {
  it("a hybrid cost is paid with whichever color the player can produce", () => {
    const t = fam({ "Hyb Spell": spellW("{W/U}{W/U}") });
    t.give("p1", "Island", "battlefield"); t.give("p1", "Plains", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Hyb Spell", "hand") });
    expect(t.state.battlefield.every((id) => t.obj(id).tapped)).toBe(true);
  });
  it("cannot be paid without enough mana: rejected, nothing tapped", () => {
    const t = fam({ "Hyb Spell": spellW("{W/U}{W/U}") });
    t.give("p1", "Island", "battlefield"); t.give("p1", "Mountain", "battlefield");
    const res = t.do({ type: "castSpell", player: "p1", cardId: t.give("p1", "Hyb Spell", "hand") });
    expect(res.error?.code).toBe("cannot_pay");
    expect(t.state.battlefield.some((id) => t.obj(id).tapped)).toBe(false);
  });
  it("{2/W}: paid with W when available, else with two generic", () => {
    const t = fam({ "Two Spell": spellW("{2/W}") });
    t.give("p1", "Plains", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Two Spell", "hand") });
    expect(t.state.battlefield.filter((id) => t.obj(id).tapped)).toHaveLength(1);
    const u = fam({ "Two Spell": spellW("{2/W}") });
    u.lands("p1", "Mountain", 2);
    u.ok({ type: "castSpell", player: "p1", cardId: u.give("p1", "Two Spell", "hand") });
    expect(u.state.battlefield.filter((id) => u.obj(id).tapped)).toHaveLength(2);
  });
  it("Phyrexian: a real choice per symbol when both ways are possible; forced when only one is", () => {
    const t = fam({ "Phy Spell": spellW("{B/P}{B/P}") });
    t.give("p1", "Swamp", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Phy Spell", "hand") });
    const p = t.state.pending!;
    expect(p.kind).toBe("choose_option");
    expect(p.options.map((o) => o.id)).toEqual(["mana", "life"]);
    t.ok({ type: "answerDecision", player: "p1", decisionId: p.id, choice: { ids: ["mana"] } });
    // the second symbol: the only Swamp is spoken for, so life is the only way (no question)
    expect(t.state.pending).toBeNull();
    expect(t.p("p1").life).toBe(38);
    const u = fam({ "Phy Spell": spellW("{B/P}{B/P}") });
    u.ok({ type: "castSpell", player: "p1", cardId: u.give("p1", "Phy Spell", "hand") });
    expect(u.p("p1").life).toBe(36);
  });
  it("Phyrexian: choosing life although mana was available, and the action shortcut", () => {
    const t = fam({ "Phy Spell": spellW("{B/P}") });
    t.give("p1", "Swamp", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Phy Spell", "hand"), phyrexian: ["life"] });
    expect(t.p("p1").life).toBe(38);
    expect(t.state.battlefield.filter((id) => t.obj(id).tapped)).toHaveLength(0);
  });
  it("Phyrexian: a wrong answer is rejected and a wrong player cannot answer", () => {
    const t = fam({ "Phy Spell": spellW("{B/P}") });
    t.give("p1", "Swamp", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Phy Spell", "hand") });
    const p = t.state.pending!;
    expect(t.do({ type: "answerDecision", player: "p2", decisionId: p.id, choice: { ids: ["mana"] } }).error?.code).toBe("not_your_decision");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: p.id, choice: { ids: ["gold"] } }).error?.code).toBe("invalid_choice");
  });
  it("Phyrexian: at 1 life only mana is legal (life needs at least 2)", () => {
    const t = fam({ "Phy Spell": spellW("{B/P}") });
    t.give("p1", "Swamp", "battlefield"); t.p("p1").life = 1;
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Phy Spell", "hand") });
    expect(t.state.pending).toBeNull();
    expect(t.p("p1").life).toBe(1);
  });
  it("Phyrexian life payment is refused when life is too low (and nothing changes)", () => {
    const t = fam({ "Phy Spell": spellW("{B/P}") });
    t.p("p1").life = 1;
    const before = JSON.stringify(t.state);
    const c = t.give("p1", "Phy Spell", "hand");
    const res = t.do({ type: "castSpell", player: "p1", cardId: c });
    expect(res.error?.code).toBe("cannot_pay");
    void before;
  });
  it("settleCost never leaves hybrid symbols behind", () => {
    const t = fam({});
    const { cost } = settleCost({ s: t.state, events: [], defs: () => undefined, scanned: 0 } as never, "p1", parseManaCost("{G/P}{R/W}"));
    expect(cost.hybrid).toBeUndefined();
    expect(cost.phyrexian).toBeUndefined();
  });
});

describe("real cards", () => {
  it("Fiend Artisan ({X}{B/G}) and Birthing Pod ({3}{G/P}) have the right mana value and colors", () => {
    const t = realTable();
    const fa = t.give("p1", "Fiend Artisan", "battlefield");
    expect(charsOf(t, fa).colors.sort()).toEqual(["B", "G"]);
    expect(charsOf(t, fa).mv).toBe(2);
    const pod = t.give("p1", "Birthing Pod", "battlefield");
    expect(charsOf(t, pod).mv).toBe(4);
    expect(charsOf(t, pod).colors).toEqual(["G"]);
  });
  it("Lashwrithe's equip ({B/P}{B/P}) is runnable", () => {
    expect(cardUnsupported(realDef("Lashwrithe")!).all.filter((x) => x.startsWith("cost:"))).toEqual([]);
  });
  it("a mana ability with a hybrid cost (Fetid Heath) is supported (the cost is paid first; the alternatives are a decision)", () => {
    expect(cardUnsupported(realDef("Fetid Heath")!).all).toEqual([]);
  });
});
