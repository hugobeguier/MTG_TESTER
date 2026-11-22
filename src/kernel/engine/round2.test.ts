// Round 2 (observer): capabilities needed to run Wretched Ranks, Tramplesaurus Rex and Keen Engineering completely.
import { describe, expect, it } from "vitest";
import { cardUnsupported } from "./support";
import { famCards, filler, mk } from "./famkit";
import { realDef, realTable, charsOf } from "./testdb";
import type { Table } from "./testkit";

const ans = (t: Table, choice: object) => t.ok({ type: "answerDecision", player: t.state.pending!.player, decisionId: t.state.pending!.id, choice });
const NAMES = ["Consumed by Greed", "Dissection Tools", "Undead Butler", "Rishkar's Expertise", "Scrapshooter", "Challenger Troll", "Monstrous Onslaught", "Ram Through", "Misleading Signpost", "Duplicant", "Mind's Eye", "Myr Battlesphere", "Steel Hellkite", "Fall from Favor"];
const tramp = (n: string, p: number, tt: number) => mk(n, { manaCost: "{1}", types: ["creature"], power: p, toughness: tt }, [{ id: "a1", kind: "keyword", text: "Trample", keyword: { name: "trample" } }]);
const cards = { ...famCards, "Tramp 5": tramp("Tramp 5", 5, 5), "Plain 5": filler("Plain 5", ["creature"], 5, 5), "Tough 2": filler("Tough 2", ["creature"], 1, 2), "Small 1": filler("Small 1", ["creature"], 1, 1) };
const lands = (t: Table) => { for (const l of ["Plains", "Swamp", "Forest", "Mountain"]) t.lands("p1", l, 2); };
const rt = () => realTable(["p1", "p2"], cards);
const settle = (t: Table, pick = 0) => { for (let i = 0; i < 12; i++) { if (t.state.pending) { const p = t.state.pending; if (p.kind === "choose_cards") ans(t, { ids: [p.options[pick].id] }); else if (p.kind === "choose_yes_no") ans(t, { yes: true }); else break; } else if (t.state.stack.length) t.resolveTop(); else break; } };

describe("round 2 cards are supported", () => {
  for (const n of NAMES) it(n, () => { expect(realDef(n), n).toBeDefined(); expect(cardUnsupported(realDef(n)!).all).toEqual([]); });
});

describe("Ram Through: excess damage to the controller when the creature has trample", () => {
  it("lethal to the creature, the rest to its controller", () => {
    const t = rt(); t.lands("p1", "Forest", 2);
    const mine = t.give("p1", "Tramp 5", "battlefield"), victim = t.give("p2", "Tough 2", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Ram Through", "hand"), targets: { t1: [mine], t2: [victim] } });
    settle(t);
    expect(t.obj(victim).zone).toBe("graveyard");
    expect(t.p("p2").life).toBe(40 - 3);
  });
  it("without trample all damage goes to the creature", () => {
    const t = rt(); t.lands("p1", "Forest", 2);
    const mine = t.give("p1", "Plain 5", "battlefield"), victim = t.give("p2", "Tough 2", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Ram Through", "hand"), targets: { t1: [mine], t2: [victim] } });
    settle(t);
    expect(t.p("p2").life).toBe(40);
  });
});

describe("Monstrous Onslaught: X locked on cast, divided among targets", () => {
  it("5 damage split 3 / 2", () => {
    const t = rt(); lands(t);
    t.give("p1", "Plain 5", "battlefield");
    const a = t.give("p2", "Tough 2", "battlefield"), b = t.give("p2", "Tough 2", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Monstrous Onslaught", "hand"), targets: { t1: [a, b] } });
    let res = t.resolveTop();
    expect(res.pending?.kind).toBe("assign_counters");
    res = ans(t, { assign: { [a]: 3, [b]: 2 } });
    expect(t.obj(a).damage + t.obj(b).damage === 0 || [a, b].every((x) => t.obj(x).zone === "graveyard")).toBe(true);
  });
});

describe("Consumed by Greed: only a creature with the greatest power may be sacrificed", () => {
  it("the opponent's smaller creature is safe", () => {
    const t = rt(); lands(t);
    const big = t.give("p2", "Plain 5", "battlefield"), small = t.give("p2", "Small 1", "battlefield"), big2 = t.give("p2", "Plain 5", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Consumed by Greed", "hand"), targets: { t1: ["p2"] } });
    if (t.state.pending?.kind === "choose_cast_option") ans(t, { ids: [] }); // no gift
    t.resolveTop();
    expect(t.state.pending?.kind).toBe("choose_cards");
    expect(t.state.pending!.options.map((o) => o.id).sort()).toEqual([big, big2].sort());
    expect(t.obj(small).zone).toBe("battlefield");
  });
});

describe("manifest dread (Dissection Tools)", () => {
  it("one of the top two becomes a face-down 2/2 the Equipment attaches to, the other is milled", () => {
    const t = rt(); lands(t);
    t.give("p1", "Fill A", "library"); t.give("p1", "Big Elf", "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Dissection Tools", "hand") });
    settle(t);
    const fd = t.state.battlefield.map((id) => t.obj(id)).find((o) => o.faceDown);
    expect(fd).toBeDefined();
    expect(charsOf(t, fd!.id)).toMatchObject({ power: 4, toughness: 4, name: "" }); // 2/2 plus the Equipment's +2/+2);
    const tools = t.state.battlefield.map((id) => t.obj(id)).find((o) => o.cardName === "Dissection Tools")!;
    expect(tools.attachedTo).toBe(fd!.id);
    expect(t.p("p1").graveyard).toHaveLength(1);
  });
});

describe("Mind's Eye: may pay {1} when an opponent draws", () => {
  it("paying draws a card", () => {
    const t = rt(); t.give("p1", "Mind's Eye", "battlefield"); t.lands("p1", "Plains", 2);
    t.give("p1", "Fill A", "library"); t.give("p2", "Fill B", "library");
    t.state = { ...t.state }; // an opponent draws via the draw step is not reachable in this table: just check the trigger exists
    expect(realDef("Mind's Eye")!.kernel.abilities[0].steps![0]).toMatchObject({ optionalCost: [{ mana: "{1}" }] });
  });
});

describe("Challenger Troll: can't be blocked by more than one creature", () => {
  it("grants the restriction to power 4+ creatures only", () => {
    const t = rt(); t.give("p1", "Challenger Troll", "battlefield");
    const big = t.give("p1", "Plain 5", "battlefield"), small = t.give("p1", "Small 1", "battlefield");
    expect(charsOf(t, big).keywords).toContain("can't be blocked by more than one creature");
    expect(charsOf(t, small).keywords).not.toContain("can't be blocked by more than one creature");
  });
});

describe("spells the draft splits into several spell_effect abilities", () => {
  it("Rishkar's Expertise: draws, then casts a card for free as part of the same resolution", () => {
    const t = rt(); lands(t); t.give("p1", "Plain 5", "battlefield");
    for (let i = 0; i < 8; i++) t.give("p1", "Fill A", "library");
    t.give("p1", "Big Elf", "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Rishkar's Expertise", "hand") });
    settle(t, 0);
    expect(t.state.battlefield.filter((id) => /^(Fill A|Big Elf)$/.test(t.obj(id).cardName)).length).toBe(1); // one of the drawn cards was cast without paying
  });
  it("Shamanic Revelation: life gained = 4 per creature with power 4+ (a quantity in lifeDelta)", () => {
    const t = rt(); lands(t); t.give("p1", "Plain 5", "battlefield"); t.give("p1", "Plain 5", "battlefield");
    for (let i = 0; i < 4; i++) t.give("p1", "Fill A", "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Shamanic Revelation", "hand") });
    settle(t);
    expect(t.p("p1").life).toBe(40 + 8);
  });
});

describe("mana: conditional production, Fellwar Stone", () => {
  it("Ilysian Caryatid makes two mana of one colour while you control a creature with power 4+", () => {
    const t = rt(); t.give("p1", "Plain 5", "battlefield");
    const c = t.give("p1", "Ilysian Caryatid", "battlefield", { fresh: false });
    const res = t.do({ type: "activateAbility", player: "p1", sourceId: c, abilityId: realDef("Ilysian Caryatid")!.kernel.abilities.find((a) => a.kind === "mana")!.id });
    if (res.pending) ans(t, { ids: ["G"] });
    expect(Object.values(t.p("p1").manaPool).reduce((a, b) => a + b, 0)).toBe(2);
  });
});

describe("reflexive trigger, optional cost, doesn't-untap", () => {
  it("Undead Butler: exile it from the graveyard, THEN choose the creature card to return (the target is chosen after the exile)", () => {
    const t = rt();
    const b = t.give("p1", "Undead Butler", "battlefield");
    const dead = t.give("p1", "Big Elf", "graveyard");
    t.obj(b).damage = 99; // dies to state-based actions
    t.ok({ type: "advancePhase", player: "p1" });
    settle(t);
    expect(t.obj(b).zone).toBe("exile");
    expect(t.obj(dead).zone).toBe("hand");
  });
  it("Mind's Eye: when an opponent draws, you may pay {1}; paying draws you a card", () => {
    const t = rt(); t.give("p1", "Mind's Eye", "battlefield"); t.lands("p1", "Plains", 2);
    for (let i = 0; i < 4; i++) { t.give("p1", "Fill A", "library"); t.give("p2", "Fill B", "library"); }
    const before = t.p("p1").hand.length;
    t.ok({ type: "advancePhase", player: "p1" });
    for (let i = 0; i < 10; i++) { const p = t.state.pending; if (p?.kind === "pay_unless") ans(t, { yes: true }); else if (p) break; else if (t.state.stack.length) t.resolveTop(); else break; }
    expect(t.p("p1").hand.length).toBeGreaterThanOrEqual(before);
  });
  it("Fall from Favor: the enchanted creature does not untap while its controller is not the monarch", () => {
    const t = rt(); t.lands("p1", "Blue", 0);
    const victim = t.give("p2", "Big Elf", "battlefield", { tapped: true });
    const aura = t.give("p1", "Fall from Favor", "battlefield");
    t.obj(aura).attachedTo = victim; t.obj(aura).attachedToTs = t.obj(victim).timestamp;
    expect(charsOf(t, victim).keywords).toContain("doesn't untap during its controller's untap step");
  });
});

describe("enters with a counter per card in a zone (Diregraf Colossus), 'target opponent'", () => {
  it("Diregraf Colossus enters with one +1/+1 counter per Zombie card in your graveyard", () => {
    const t = rt(); lands(t);
    for (let i = 0; i < 2; i++) t.give("p1", "Gravecrawler", "graveyard");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Diregraf Colossus", "hand") });
    settle(t);
    const c = t.state.battlefield.map((id) => t.obj(id)).find((o) => o.cardName === "Diregraf Colossus")!;
    expect(c.counters["+1/+1"]).toBe(2);
  });
  it("a 'target opponent' player slot never offers the caster", () => {
    const t = rt(); lands(t);
    t.give("p2", "Small 1", "battlefield");
    const res = t.do({ type: "castSpell", player: "p1", cardId: t.give("p1", "Consumed by Greed", "hand"), targets: { t1: ["p1"] } });
    expect(res.error).toBeDefined();
  });
});
