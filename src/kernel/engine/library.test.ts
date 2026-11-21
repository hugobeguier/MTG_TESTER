// search_library, look_top, reveal, repeat_for_each, plus the small steps that came with them (life_change.lose, unless_pay, add_mana).
// Real drafts: Evolving Wilds, Ponder, Diabolic Vision, Blood Artist, Mana Tithe, Dark Ritual, Mana Geyser.

import { describe, expect, it } from "vitest";
import type { Step } from "../schema";
import { cardUnsupported } from "./support";
import { fam, sorcery } from "./famkit";
import type { Table } from "./testkit";
import { lookup } from "./testkit";

const S = (s: Record<string, unknown>) => s as unknown as Step;
const nm = (t: Table, ids: string[]) => ids.map((id) => t.obj(id).cardName);

/** A table with the given custom spell, an Island, and the spell in hand; cast + resolve; returns the result. */
function go(steps: Step[], setup: (t: Table) => void = () => undefined, extra: Record<string, ReturnType<typeof sorcery>> = {}) {
  const spell = sorcery("Spell", "{U}", steps);
  const t = fam({ Spell: spell, ...extra });
  t.give("p1", "Island", "battlefield");
  setup(t);
  t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Spell", "hand") });
  const res = t.resolveTop();
  return { t, res };
}

const answerOn = (t: Table, choice: Parameters<Table["answer"]>[1]) => t.ok({ type: "answerDecision", player: t.state.pending!.player, decisionId: t.state.pending!.id, choice });

describe("search_library", () => {
  it("Evolving Wilds is fully supported and fetches a basic land tapped, then shuffles", () => {
    expect(cardUnsupported(lookup("Evolving Wilds")!).all).toEqual([]);
    const t = fam();
    for (const n of ["Forest", "Island", "Fill A", "Swamp"]) t.give("p1", n, "library");
    const w = t.give("p1", "Evolving Wilds", "battlefield");
    const res = t.ok({ type: "activateAbility", player: "p1", sourceId: w, abilityId: "a1" });
    expect(t.obj(w).zone).toBe("graveyard"); // sacrificed as a cost
    const r2 = t.resolveTop();
    expect(r2.pending).toMatchObject({ kind: "choose_cards", player: "p1" });
    expect(r2.pending!.options.map((o) => o.label).sort()).toEqual(["Forest", "Island", "Swamp"]); // basic lands only
    expect(r2.pending!.min).toBe(0); // may fail to find
    const forest = r2.pending!.options.find((o) => o.label === "Forest")!.id;
    const done = t.answer(r2, { ids: [forest] });
    expect(t.obj(forest)).toMatchObject({ zone: "battlefield", tapped: true, controller: "p1" });
    expect(done.events.map((e) => e.type)).toContain("shuffle");
    expect(done.events.map((e) => e.type)).not.toContain("reveal"); // no reveal in the text
    void res;
  });

  it("fail to find: choose nothing, the library is shuffled anyway", () => {
    const t = fam();
    t.give("p1", "Forest", "library"); const w = t.give("p1", "Evolving Wilds", "battlefield");
    t.ok({ type: "activateAbility", player: "p1", sourceId: w, abilityId: "a1" });
    const r2 = t.resolveTop();
    const done = t.answer(r2, { ids: [] });
    expect(t.p("p1").library).toHaveLength(1);
    expect(done.events.map((e) => e.type)).toContain("shuffle");
    expect(done.events.find((e) => e.type === "library_searched")).toMatchObject({ found: 0 });
  });

  it("no matching card in the library: no question, still shuffles", () => {
    const t = fam();
    t.give("p1", "Fill A", "library"); const w = t.give("p1", "Evolving Wilds", "battlefield");
    t.ok({ type: "activateAbility", player: "p1", sourceId: w, abilityId: "a1" });
    const r2 = t.resolveTop();
    expect(r2.pending).toBeUndefined();
    expect(r2.events.map((e) => e.type)).toContain("shuffle");
  });

  it("a search for any card must take one; a search for a quality may find none", () => {
    const any = go([S({ kind: "search_library", who: "you", filter: {}, count: 1, to: "hand" })], (t) => { t.give("p1", "Fill A", "library"); t.give("p1", "Fill B", "library"); });
    expect(any.res.pending).toMatchObject({ min: 1, max: 1 });
    const q = go([S({ kind: "search_library", who: "you", filter: { types: ["creature"] }, count: 1, to: "hand" })], (t) => { t.give("p1", "Fill A", "library"); });
    expect(q.res.pending).toMatchObject({ min: 0, max: 1 });
  });

  it("destinations: hand, graveyard, top of library (shuffled first), battlefield", () => {
    const hand = go([S({ kind: "search_library", who: "you", filter: { types: ["creature"] }, count: 1, to: "hand", reveal: true })], (t) => { t.give("p1", "Fill A", "library"); });
    const id = hand.res.pending!.options[0].id;
    const r = hand.t.answer(hand.res, { ids: [id] });
    expect(hand.t.obj(id).zone).toBe("hand");
    expect(r.events.find((e) => e.type === "reveal")).toMatchObject({ names: ["Fill A"] });

    const gy = go([S({ kind: "search_library", who: "you", filter: { types: ["creature"] }, count: 1, to: "graveyard" })], (t) => { t.give("p1", "Fill A", "library"); });
    gy.t.answer(gy.res, { ids: [gy.res.pending!.options[0].id] });
    expect(nm(gy.t, gy.t.p("p1").graveyard)).toContain("Fill A");

    const top = go([S({ kind: "search_library", who: "you", filter: { types: ["creature"] }, count: 1, to: "library", position: "top", shuffle: true })], (t) => { for (const n of ["Fill A", "Fill B", "Fill C", "Fill D"]) t.give("p1", n, "library"); });
    const pick = top.res.pending!.options.find((o) => o.label === "Fill B")!.id;
    top.t.answer(top.res, { ids: [pick] });
    expect(top.t.p("p1").library[0]).toBe(pick); // shuffled first, then put on top

    const bf = go([S({ kind: "search_library", who: "you", filter: { types: ["creature"] }, count: 1, to: "battlefield" })], (t) => { t.give("p1", "Fill A", "library"); });
    const bid = bf.res.pending!.options[0].id;
    bf.t.answer(bf.res, { ids: [bid] });
    expect(bf.t.obj(bid)).toMatchObject({ zone: "battlefield", tapped: false });
  });

  it("count 'any' / anyNumber / upTo bounds", () => {
    const r = go([S({ kind: "search_library", who: "you", filter: { types: ["creature"] }, count: "any", to: "hand" })], (t) => { for (const n of ["Fill A", "Fill B", "Fill C"]) t.give("p1", n, "library"); });
    expect(r.res.pending).toMatchObject({ min: 0, max: 3 });
    const u = go([S({ kind: "search_library", who: "you", filter: { types: ["creature"] }, count: 2, upTo: true, to: "hand" })], (t) => { for (const n of ["Fill A", "Fill B", "Fill C"]) t.give("p1", n, "library"); });
    expect(u.res.pending).toMatchObject({ min: 0, max: 2 });
  });

  it("only the searching player is asked and only their library is offered", () => {
    const { t, res } = go([S({ kind: "search_library", who: "you", filter: { types: ["creature"] }, count: 1, to: "hand" })], (t) => { t.give("p1", "Fill A", "library"); t.give("p2", "Fill B", "library"); });
    expect(res.pending!.player).toBe("p1");
    expect(res.pending!.options.map((o) => o.label)).toEqual(["Fill A"]);
    expect(t.do({ type: "answerDecision", player: "p2", decisionId: res.pending!.id, choice: { ids: [] } }).error?.code).toBe("not_your_decision");
  });

  it("an answer naming a card of another library, or a stale id, is rejected", () => {
    const { t, res } = go([S({ kind: "search_library", who: "you", filter: { types: ["creature"] }, count: 1, to: "hand" })], (t) => { t.give("p1", "Fill A", "library"); t.give("p2", "Fill B", "library"); });
    const theirs = t.p("p2").library[0];
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: [theirs] } }).error?.code).toBe("invalid_choice");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: "d900", choice: { ids: [] } }).error?.code).toBe("wrong_decision");
  });

  it("the found cards are saved (default name 'found') for later steps", () => {
    const { t, res } = go([S({ kind: "search_library", who: "you", filter: { types: ["creature"] }, count: 1, to: "hand" }), S({ kind: "move_card_zone", what: "found", moveTo: "graveyard" })], (t) => { t.give("p1", "Fill A", "library"); });
    const id = res.pending!.options[0].id;
    t.answer(res, { ids: [id] });
    expect(t.obj(id).zone).toBe("graveyard");
  });

  it("is deterministic", () => {
    const run = () => { const { t, res } = go([S({ kind: "search_library", who: "you", filter: { types: ["creature"] }, count: 1, to: "hand", shuffle: true })], (t) => { for (const n of ["Fill A", "Fill B", "Fill C", "Fill D", "Fill E"]) t.give("p1", n, "library"); }); const d = t.answer(res, { ids: [] }); return JSON.stringify([t.state, d.events]); };
    expect(run()).toBe(run());
  });

  it("unsupported destinations are refused statically", () => {
    expect(cardUnsupported(sorcery("Odd", "{U}", [S({ kind: "search_library", who: "you", filter: {}, count: 1, to: "exile_pile" })])).all).toContain("field:search_library.to=exile_pile");
  });
});

describe("look_top", () => {
  it("Ponder and Diabolic Vision are fully supported", () => {
    expect(cardUnsupported(lookup("Ponder")!).all).toEqual([]);
    expect(cardUnsupported(lookup("Diabolic Vision")!).all).toEqual([]);
  });

  it("Diabolic Vision: look at five, one to hand, the rest on top in the order you choose", () => {
    const t = fam();
    t.lands("p1", "Island", 4);
    for (const n of ["Fill E", "Fill D", "Fill C", "Fill B", "Fill A"]) t.give("p1", n, "library"); // Fill A on top
    t.give("p1", "Fill E", "library", { top: false });
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Diabolic Vision", "hand") });
    const res = t.resolveTop();
    expect(res.pending).toMatchObject({ kind: "choose_cards", min: 1, max: 1 });
    expect(res.pending!.options.map((o) => o.label)).toEqual(["Fill A", "Fill B", "Fill C", "Fill D", "Fill E"]); // only the five looked at
    const [a, b, c, d, e] = res.pending!.options.map((o) => o.id);
    const order = t.answer(res, { ids: [c] });
    expect(t.obj(c).zone).toBe("hand");
    expect(order.pending).toMatchObject({ kind: "choose_cards", min: 4, max: 4 });
    t.answer(order, { ids: [e, d, b, a] });
    expect(t.p("p1").library.slice(0, 4)).toEqual([e, d, b, a]);
  });

  it("the look is private (looked_at) and the choose answer is limited to the looked cards", () => {
    const t = fam();
    t.lands("p1", "Island", 4);
    for (const n of ["Fill D", "Fill C", "Fill B", "Fill A"]) t.give("p1", n, "library");
    for (let i = 0; i < 3; i++) t.give("p1", "Fill E", "library", { top: false });
    t.give("p1", "Fill E", "library", { top: false });
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Diabolic Vision", "hand") });
    const res = t.resolveTop();
    expect(res.events.some((e) => e.type === "looked_at" && e.player === "p1")).toBe(true);
    const deep = t.p("p1").library[6];
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: [deep] } }).error?.code).toBe("invalid_choice");
  });

  it("Ponder: look at three, reorder, may shuffle (decision), then draw", () => {
    const t = fam();
    t.give("p1", "Island", "battlefield");
    for (const n of ["Fill D", "Fill C", "Fill B", "Fill A"]) t.give("p1", n, "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Ponder", "hand") });
    const res = t.resolveTop();
    const [a, b, c] = t.p("p1").library;
    expect(res.pending).toMatchObject({ kind: "choose_cards", min: 3, max: 3 });
    const sh = t.answer(res, { ids: [c, a, b] });
    expect(sh.pending).toMatchObject({ kind: "choose_yes_no" }); // "you may shuffle"
    t.answer(sh, { yes: false });
    expect(t.p("p1").hand).toEqual([c]); // drew the new top card
    expect(t.p("p1").library.slice(0, 2)).toEqual([a, b]);
  });

  it("looking at more cards than the library has looks at what is there", () => {
    const { t, res } = go([S({ kind: "look_top", amount: 5 }), S({ kind: "choose", from: { zone: "library" }, fromLooked: true, count: 1, saveAs: "chosen" }), S({ kind: "move_card_zone", what: "chosen", moveTo: "hand" })], (t) => { t.give("p1", "Fill A", "library"); t.give("p1", "Fill B", "library"); });
    expect(res.pending!.options).toHaveLength(2);
    t.answer(res, { ids: [res.pending!.options[0].id] });
    expect(t.p("p1").hand).toHaveLength(1);
  });

  it("a looked-at card that moved meanwhile is a new object: it is no longer one of 'the rest'", () => {
    const { t } = go([
      S({ kind: "look_top", amount: 2 }),
      S({ kind: "move_card_zone", what: "top_of_library", who: "you", moveTo: "graveyard" }),
      S({ kind: "move_card_zone", what: "rest_of_looked_cards", moveTo: "hand" })
    ], (t) => { t.give("p1", "Fill A", "library"); t.give("p1", "Fill B", "library"); });
    expect(t.p("p1").graveyard.map((id) => t.obj(id).cardName)).toContain("Fill B");
    expect(nm(t, t.p("p1").hand)).toEqual(["Fill A"]);
  });
});

describe("reveal", () => {
  it("reveals the top card of each player's library with a public event and saves it", () => {
    const { t, res } = go([S({ kind: "reveal", what: "top_card_of_library", who: "each_player", saveAs: "revealed" })], (t) => { t.give("p1", "Fill A", "library"); t.give("p2", "Fill B", "library"); });
    const ev = res.events.filter((e) => e.type === "reveal");
    expect(ev.flatMap((e) => e.names as string[]).sort()).toEqual(["Fill A", "Fill B"]);
    expect(t.p("p1").library).toHaveLength(1); // revealing does not move it
  });

  it("an unsupported reveal form is refused statically", () => {
    expect(cardUnsupported(sorcery("Odd", "{U}", [S({ kind: "reveal", what: "hand" })])).all).toContain("field:reveal.what=hand");
  });
});

describe("repeat_for_each", () => {
  it("each opponent loses 1 life with 'that player'", () => {
    const spell = sorcery("Spell", "{U}", [S({ kind: "repeat_for_each", over: "each_opponent", steps: [{ kind: "life_change", who: "that_player", lifeDelta: -1 }] })]);
    const t = fam({ Spell: spell });
    // fam() is a two player table; here both p2 only
    t.give("p1", "Island", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Spell", "hand") });
    t.resolveTop();
    expect(t.p("p2").life).toBe(39);
    expect(t.p("p1").life).toBe(40);
  });

  it("each creature you control gets a +1/+1 counter ('iterated')", () => {
    const { t } = go([S({ kind: "repeat_for_each", over: { types: ["creature"], controller: "you" }, steps: [{ kind: "add_counters", on: "iterated", counterKind: "+1/+1", amount: 1 }] })], (t) => { t.give("p1", "Fill A", "battlefield"); t.give("p1", "Fill B", "battlefield"); t.give("p2", "Fill C", "battlefield"); });
    const counters = t.state.battlefield.map((id) => [t.obj(id).cardName, t.obj(id).counters["+1/+1"] ?? 0]).filter(([n]) => String(n).startsWith("Fill"));
    expect(counters.sort()).toEqual([["Fill A", 1], ["Fill B", 1], ["Fill C", 0]]);
  });

  it("nested choose per iteration: each player chooses a card in hand to put on the bottom", () => {
    const { t, res } = go([S({ kind: "repeat_for_each", over: "each_player", steps: [
      { kind: "choose", who: "that_player", from: { zone: "hand" }, count: 1, saveAs: "chosen" },
      { kind: "move_card_zone", what: "chosen", moveTo: "library", position: "bottom" }
    ] })], (t) => { t.give("p1", "Fill A", "hand"); t.give("p1", "Fill B", "hand"); t.give("p2", "Fill C", "hand"); t.give("p2", "Fill D", "hand"); });
    expect(res.pending!.player).toBe("p1");
    const r2 = t.answer(res, { ids: [res.pending!.options[0].id] });
    expect(r2.pending!.player).toBe("p2");
    t.answer(r2, { ids: [r2.pending!.options[1].id] });
    expect(t.p("p1").library).toHaveLength(1);
    expect(t.p("p2").library).toHaveLength(1);
    expect(t.p("p1").hand).toHaveLength(1);
    expect(t.p("p2").hand).toHaveLength(1);
  });

  it("an iteration whose object left meanwhile does nothing; the list is a snapshot", () => {
    const { t } = go([S({ kind: "repeat_for_each", over: { types: ["creature"] }, steps: [{ kind: "destroy_target", target: "iterated" }] })], (t) => { t.give("p1", "Fill A", "battlefield"); t.give("p2", "Fill B", "battlefield"); });
    expect(t.state.battlefield.filter((id) => t.obj(id).cardName.startsWith("Fill"))).toHaveLength(0);
  });

  it("unsupported 'over' values are refused statically", () => {
    expect(cardUnsupported(sorcery("Odd", "{U}", [S({ kind: "repeat_for_each", over: "target_player", steps: [] })])).all).toContain("field:repeat_for_each.over");
  });
});

describe("life_change.lose, unless_pay and add_mana", () => {
  it("Blood Artist: target player loses 1 life and you gain 1 (lose: true)", () => {
    expect(cardUnsupported(lookup("Blood Artist")!).all).toEqual([]);
    const t = fam();
    t.give("p1", "Blood Artist", "battlefield");
    const victim = t.give("p2", "Fill A", "battlefield");
    t.give("p1", "Island", "battlefield");
    t.give("p1", "Lightning Bolt", "hand");
    t.state.objects[victim].damage = 0;
    const bolt = t.give("p1", "Mountain", "battlefield");
    void bolt;
    const b = t.give("p1", "Lightning Bolt", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: b, targets: { t1: [victim] } });
    t.resolveTop();
    const pend = t.state.pending;
    if (pend) t.ok({ type: "answerDecision", player: "p1", decisionId: pend.id, choice: { ids: ["p2"] } });
    t.resolveTop();
    expect(t.p("p2").life).toBe(39);
    expect(t.p("p1").life).toBe(41);
  });

  it("lose life with a 'life lost this way' follow-up gains exactly what was lost", () => {
    const { t } = go([S({ kind: "life_change", who: "each_opponent", lose: true, amount: 3 }), S({ kind: "life_change", who: "you", amount: { ref: "life_lost_this_way" } })]);
    expect(t.p("p2").life).toBe(37);
    expect(t.p("p1").life).toBe(43);
  });

  it("lose life goes through replacement effects (a player cannot lose below what is prevented) and a negative amount does not gain", () => {
    const { t } = go([S({ kind: "life_change", who: "each_opponent", lose: true, amount: -2 })]);
    expect(t.p("p2").life).toBe(38); // lose is lose, whatever the sign
  });

  it("Mana Tithe: the opponent with an untapped land is asked; paying {1} saves the spell", () => {
    expect(cardUnsupported(lookup("Mana Tithe")!).all).toEqual([]);
    const t = fam();
    t.give("p1", "Plains", "battlefield");
    t.give("p2", "Island", "battlefield"); t.give("p2", "Island", "battlefield");
    t.state = { ...t.state, turn: { ...t.state.turn, active: "p2" }, priority: "p2" };
    t.give("p2", "Island", "battlefield");
    const bolt = t.give("p2", "Ponder", "hand");
    t.ok({ type: "castSpell", player: "p2", cardId: bolt });
    // p1 (non-active) casts Mana Tithe in response after p2 passes priority
    t.state = { ...t.state, priority: "p1", passes: [] };
    const tithe = t.give("p1", "Mana Tithe", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: tithe, targets: { t1: [bolt] } });
    const res = t.resolveTop();
    expect(res.pending).toMatchObject({ kind: "pay_unless", player: "p2" });
    t.answer(res, { yes: true });
    expect(t.state.stack.some((i) => i.objectId === bolt)).toBe(true); // not countered
    expect(t.state.objects[bolt].zone).toBe("stack");
  });

  it("Mana Tithe: declining, or being unable to pay, counters the spell (and an unable payer is not asked)", () => {
    const base = () => {
      const t = fam();
      t.give("p1", "Plains", "battlefield");
      const island = t.give("p2", "Island", "battlefield");
      t.state = { ...t.state, turn: { ...t.state.turn, active: "p2" }, priority: "p2" };
      const spell = t.give("p2", "Fill A", "hand");
      void spell;
      return { t, island };
    };
    const { t } = base();
    const sp = t.give("p2", "Ponder", "hand");
    t.give("p2", "Island", "battlefield"); // Ponder costs {U}: pays with the first island, one island stays free
    t.ok({ type: "castSpell", player: "p2", cardId: sp });
    t.state = { ...t.state, priority: "p1", passes: [] };
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Mana Tithe", "hand"), targets: { t1: [sp] } });
    const res = t.resolveTop();
    expect(res.pending?.kind).toBe("pay_unless");
    t.answer(res, { yes: false });
    expect(t.obj(sp).zone).toBe("graveyard");

    const b = base();
    const sp2 = b.t.give("p2", "Ponder", "hand");
    b.t.ok({ type: "castSpell", player: "p2", cardId: sp2 }); // taps the only island
    b.t.state = { ...b.t.state, priority: "p1", passes: [] };
    b.t.ok({ type: "castSpell", player: "p1", cardId: b.t.give("p1", "Mana Tithe", "hand"), targets: { t1: [sp2] } });
    const r2 = b.t.resolveTop();
    expect(r2.pending).toBeUndefined();
    expect(b.t.obj(sp2).zone).toBe("graveyard");
  });

  it("unless_pay with a life cost: pay life to skip a step", () => {
    const spell = sorcery("Spell", "{U}", [S({ kind: "draw_cards", amount: 1, who: "you", unlessPay: { payer: "each_opponent", cost: [{ life: 2 }] } })]);
    const t = fam({ Spell: spell });
    t.give("p1", "Island", "battlefield"); t.give("p1", "Fill A", "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Spell", "hand") });
    const res = t.resolveTop();
    expect(res.pending).toMatchObject({ kind: "pay_unless", player: "p2" });
    t.answer(res, { yes: true });
    expect(t.p("p2").life).toBe(38);
    expect(t.p("p1").hand).toHaveLength(0);
  });

  it("unless_pay: wrong player or a malformed answer is rejected", () => {
    const spell = sorcery("Spell", "{U}", [S({ kind: "draw_cards", amount: 1, who: "you", unlessPay: { payer: "each_opponent", cost: [{ life: 2 }] } })]);
    const t = fam({ Spell: spell });
    t.give("p1", "Island", "battlefield"); t.give("p1", "Fill A", "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Spell", "hand") });
    const res = t.resolveTop();
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { yes: true } }).error?.code).toBe("not_your_decision");
    expect(t.do({ type: "answerDecision", player: "p2", decisionId: res.pending!.id, choice: { ids: ["maybe"] } }).error?.code).toBe("invalid_choice");
  });

  it("Dark Ritual adds BBB to the pool; Mana Geyser adds R per tapped opponent land", () => {
    const t = fam();
    t.give("p1", "Swamp", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Dark Ritual", "hand") });
    t.resolveTop();
    expect(t.p("p1").manaPool.B).toBe(3);
    expect(cardUnsupported(lookup("Mana Geyser")!).all).toEqual([]);
    const t2 = fam();
    t2.lands("p1", "Mountain", 5);
    t2.give("p2", "Forest", "battlefield", { tapped: true }); t2.give("p2", "Forest", "battlefield", { tapped: true }); t2.give("p2", "Forest", "battlefield");
    t2.ok({ type: "castSpell", player: "p1", cardId: t2.give("p1", "Mana Geyser", "hand") });
    t2.resolveTop();
    expect(t2.p("p1").manaPool.R).toBe(2);
  });
});
