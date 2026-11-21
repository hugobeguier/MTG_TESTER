// Kernel step 6: mana abilities with a choice cost (Ashnod's Altar, Phyrexian Tower, Gilded Goose), more add_mana forms.
import { describe, expect, it } from "vitest";
import { cardUnsupported } from "./support";
import { realDef, realTable } from "./testdb";

const act = (t: ReturnType<typeof realTable>, src: string, id: string, extra: object = {}) => t.do({ type: "activateAbility", player: "p1", sourceId: src, abilityId: id, ...extra } as never);

describe("mana abilities with a choice cost", () => {
  it("all three cards are fully supported", () => {
    for (const n of ["Ashnod's Altar", "Phyrexian Tower", "Gilded Goose"]) expect(cardUnsupported(realDef(n)!).all).toEqual([]);
  });
  it("Ashnod's Altar: sacrificing the only creature is automatic, adds {C}{C}, no stack", () => {
    const t = realTable();
    const altar = t.give("p1", "Ashnod's Altar", "battlefield");
    const c = t.give("p1", "Llanowar Elves", "battlefield");
    const res = act(t, altar, "a1");
    expect(res.error).toBeUndefined();
    expect(t.obj(c).zone).toBe("graveyard");
    expect(t.p("p1").manaPool.C).toBe(2);
    expect(t.state.stack).toHaveLength(0);
  });
  it("with several creatures the player is asked which one; only listed creatures are legal; nothing is paid until answered", () => {
    const t = realTable();
    const altar = t.give("p1", "Ashnod's Altar", "battlefield");
    const a = t.give("p1", "Llanowar Elves", "battlefield"), b = t.give("p1", "Plaguecrafter", "battlefield");
    const mine = t.give("p2", "Llanowar Elves", "battlefield");
    const res = t.ok({ type: "activateAbility", player: "p1", sourceId: altar, abilityId: "a1" } as never);
    expect(res.pending).toMatchObject({ kind: "choose_cards", player: "p1", min: 1, max: 1 });
    expect(res.pending!.options.map((o) => o.id).sort()).toEqual([a, b].sort());
    expect(t.p("p1").manaPool.C).toBe(0);
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: [mine] } }).error?.code).toBe("invalid_choice");
    expect(t.do({ type: "answerDecision", player: "p2", decisionId: res.pending!.id, choice: { ids: [a] } }).error?.code).toBe("not_your_decision");
    t.answer(res, { ids: [b] });
    expect(t.obj(b).zone).toBe("graveyard");
    expect(t.obj(a).zone).toBe("battlefield");
    expect(t.p("p1").manaPool.C).toBe(2);
  });
  it("with no creature to sacrifice the activation is refused and nothing changes", () => {
    const t = realTable();
    const altar = t.give("p1", "Ashnod's Altar", "battlefield");
    expect(act(t, altar, "a1").error?.code).toBe("cannot_activate");
    expect(t.p("p1").manaPool.C).toBe(0);
  });
  it("Phyrexian Tower: tap + sacrifice a creature for {B}{B}; summoning-sick use of {T} on the Tower is not the issue (a land)", () => {
    const t = realTable();
    const tower = t.give("p1", "Phyrexian Tower", "battlefield");
    t.give("p1", "Llanowar Elves", "battlefield");
    expect(act(t, tower, "a2").error).toBeUndefined();
    expect(t.obj(tower).tapped).toBe(true);
    expect(t.p("p1").manaPool.B).toBe(2);
    expect(act(t, tower, "a2").error?.code).toBe("cannot_activate"); // already tapped
  });
  it("Gilded Goose: sacrifice a Food (chosen) then the color of the any-color mana is asked", () => {
    const t = realTable();
    const goose = t.give("p1", "Gilded Goose", "battlefield");
    // two Foods as tokens: create through a real Food source
    const food = (owner: string) => { const id = t.give(owner, "Llanowar Elves", "battlefield"); const o = t.obj(id); o.cardName = "Food Token"; o.token = { name: "Food", types: ["artifact"], subtypes: ["Food"], colors: [], keywords: [] }; return id; };
    const x = food("p1"), y = food("p1");
    let res = t.ok({ type: "activateAbility", player: "p1", sourceId: goose, abilityId: "a4" } as never);
    expect(res.pending?.kind).toBe("choose_cards");
    res = t.answer(res, { ids: [x] });
    expect(res.pending?.kind).toBe("choose_color");
    t.answer(res, { ids: ["G"] });
    expect(t.p("p1").manaPool.G).toBe(1);
    expect(t.state.objects[x]).toBeUndefined(); // a token that leaves the battlefield ceases to exist
    expect(t.state.battlefield).not.toContain(x);
    expect(t.state.battlefield).toContain(y);
    expect(t.obj(goose).tapped).toBe(true);
  });
});

import { fam, sorcery } from "./famkit";
import type { Step } from "../schema";

describe("add_mana: several specs / any color / amount", () => {
  const mk = (produces: object[], amount?: number) => sorcery("Mana Test", "{1}", [{ kind: "add_mana", produces, ...(amount !== undefined ? { amount } : {}) } as Step]);
  const run = (produces: object[], amount: number | undefined, picks: string[]) => {
    const t = fam({ "Mana Test": mk(produces, amount) }); t.give("p1", "Plains", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Mana Test", "hand") });
    let res = t.resolveTop();
    for (const pick of picks) { expect(res.pending).toBeTruthy(); res = t.answer(res, { ids: [pick] }); }
    return { t, res };
  };
  it("one fixed spec adds without a question", () => { const { t, res } = run([{ colors: "{B}{B}" }], undefined, []); expect(res.pending).toBeUndefined(); expect(t.p("p1").manaPool.B).toBe(2); });
  it("alternatives ({B} or {G}) per unit: each unit is chosen separately", () => {
    const { t } = run([{ colors: "{B}" }, { colors: "{G}" }], 3, ["B", "G", "G"]);
    expect(t.p("p1").manaPool).toMatchObject({ B: 1, G: 2 });
  });
  it("any color, N mana of the chosen color", () => {
    const { t } = run([{ anyColor: 2 }], undefined, ["RR"]);
    expect(t.p("p1").manaPool.R).toBe(2);
  });
  it("an illegal color answer is rejected", () => {
    const t = fam({ "Mana Test": mk([{ colors: "{B}" }, { colors: "{G}" }]) }); t.give("p1", "Plains", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Mana Test", "hand") });
    const res = t.resolveTop();
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: ["R"] } }).error?.code).toBe("invalid_choice");
  });
  it("mana with a spending restriction is supported now (it becomes restricted mana, see step7mana.test.ts)", () => {
    expect(cardUnsupported(mk([{ anyColor: 1, restriction: { subtypes: ["Dragon"] } }])).all).not.toContain("field:add_mana.produces");
  });
});
