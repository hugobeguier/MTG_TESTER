// Ordered placement (CR 701.18 scry, 701.46 surveil, "put them back in any order"): the decision `order_library` asks which cards go to the bottom /
// graveyard and the ORDER of the cards that stay on top. Real drafts: Ponder, Brainstorm, Halimar Depths, Otherworldly Gaze (surveil), Lim-Dul's Vault.

import { describe, expect, it } from "vitest";
import type { Step } from "../schema";
import { cardUnsupported } from "./support";
import { fam, sorcery } from "./famkit";
import type { Table } from "./testkit";
import { lookup } from "./testkit";
import { pendingFor, viewFor, viewResult } from "./view";

const S = (s: Record<string, unknown>) => s as unknown as Step;
const nm = (t: Table, ids: string[]) => ids.map((id) => t.obj(id).cardName);

/** A table with a custom spell (a scry / surveil), an Island, a library A B C D E (A on top), the spell cast and resolved up to its question. */
function go(steps: Step[], n = 5) {
  const t = fam({ Spell: sorcery("Spell", "{U}", steps) });
  t.give("p1", "Island", "battlefield");
  for (const x of ["E", "D", "C", "B", "A"].slice(5 - n)) t.give("p1", `Fill ${x}`, "library");
  for (let i = 0; i < 3; i++) t.give("p1", "Fill E", "library", { top: false });
  t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Spell", "hand") });
  const res = t.resolveTop();
  const ids = res.pending!.options.map((o) => o.id);
  return { t, res, ids };
}
const scry = (n: number) => S({ kind: "scry", amount: n });
const surveil = (n: number) => S({ kind: "surveil", amount: n });

describe("scry: which cards go to the bottom, and the order of the rest", () => {
  it("asks an order_library decision listing exactly the looked-at cards, with a prompt", () => {
    const { res, t, ids } = go([scry(3)]);
    expect(res.pending).toMatchObject({ kind: "order_library", player: "p1", min: 0, max: 3, placement: { to: "bottom", stack: "top" } });
    expect(nm(t, ids)).toEqual(["Fill A", "Fill B", "Fill C"]);
    expect(res.pending!.prompt.instruction).toMatch(/Scry 3/);
  });

  it("the kept cards go back on top in the chosen order (first = next draw) and the bottom cards in order at the bottom", () => {
    const { t, res, ids } = go([scry(4)]);
    const [a, b, c, d] = ids;
    const lenBefore = t.p("p1").library.length;
    t.answer(res, { place: { toBottom: [b, d], top: [c, a] } });
    const lib = t.p("p1").library;
    expect(lib).toHaveLength(lenBefore);
    expect(lib.slice(0, 2)).toEqual([c, a]);
    expect(lib.slice(-2)).toEqual([b, d]); // b first, d last: b is nearer the top of the bottom group
    expect(t.state.pending).toBeFalsy();
  });

  it("everything on top, reversed: the library is reordered, nothing moves zones", () => {
    const { t, res, ids } = go([scry(3)]);
    t.answer(res, { place: { top: [...ids].reverse() } });
    expect(t.p("p1").library.slice(0, 3)).toEqual([...ids].reverse());
  });

  it("everything to the bottom", () => {
    const { t, res, ids } = go([scry(3)]);
    t.answer(res, { place: { toBottom: [ids[2], ids[0], ids[1]] } });
    expect(t.p("p1").library.slice(-3)).toEqual([ids[2], ids[0], ids[1]]);
    expect(nm(t, t.p("p1").library.slice(0, 2))).toEqual(["Fill D", "Fill E"]);
  });

  it("the legacy answer { ids } (cards to move) still works: the rest stay on top in their current order", () => {
    const { t, res, ids } = go([scry(3)]);
    t.answer(res, { ids: [ids[1]] });
    expect(t.p("p1").library.slice(0, 2)).toEqual([ids[0], ids[2]]);
    expect(t.p("p1").library.at(-1)).toBe(ids[1]);
  });

  it("scry 1 and a library shorter than the scry", () => {
    const { t, res, ids } = go([scry(8)], 2);
    expect(ids).toHaveLength(5); // library has 2 + 3 fillers
    t.answer(res, { place: { top: ids } });
  });

  it("rejects missing, duplicated and foreign ids, and the wrong destination", () => {
    const { t, res, ids } = go([scry(3)]);
    const deep = t.p("p1").library[6];
    const bad = (place: Record<string, string[]>) => t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { place } }).error?.code;
    expect(bad({ top: [ids[0], ids[1]] })).toBe("invalid_choice"); // one card not placed
    expect(bad({ top: [ids[0], ids[0], ids[1], ids[2]] })).toBe("invalid_choice"); // twice
    expect(bad({ top: [ids[0], ids[1]], toBottom: [ids[1]] })).toBe("invalid_choice"); // in two places
    expect(bad({ top: [ids[0], ids[1], deep] })).toBe("invalid_choice"); // foreign
    expect(bad({ top: [ids[0], ids[1]], toGraveyard: [ids[2]] })).toBe("invalid_choice"); // scry has no graveyard
    expect(t.state.pending).toBeDefined();
    t.answer(res, { place: { top: ids } });
  });

  it("is deterministic: the same answers give the same library", () => {
    const run = () => { const { t, res, ids } = go([scry(3)]); t.answer(res, { place: { toBottom: [ids[0]], top: [ids[2], ids[1]] } }); return nm(t, t.p("p1").library); };
    expect(run()).toEqual(run());
  });
});

describe("hidden information", () => {
  it("the opponent's view of the decision has no options and no card names; the deciding player sees them", () => {
    const { t, res } = go([scry(3)]);
    const b = viewResult(res, "p2");
    expect(b.pending).toMatchObject({ hidden: true, options: [], kind: "order_library", player: "p1" });
    expect(JSON.stringify(b)).not.toContain("Fill A");
    expect(JSON.stringify(pendingFor(t.state.pending, "p2"))).not.toContain("Fill");
    expect(JSON.stringify(viewFor(t.state, "p2"))).not.toContain("Fill A");
    expect(JSON.stringify(viewResult(res, "p1").pending)).toContain("Fill A");
  });
});

describe("surveil", () => {
  it("graveyard + order of the rest", () => {
    const { t, res, ids } = go([surveil(4)]);
    expect(res.pending).toMatchObject({ kind: "order_library", placement: { to: "graveyard", stack: "top" } });
    const [a, b, c, d] = ids;
    t.answer(res, { place: { toGraveyard: [a, d], top: [c, b] } });
    expect(t.p("p1").library.slice(0, 2)).toEqual([c, b]);
    expect(t.p("p1").graveyard).toEqual(expect.arrayContaining([a, d]));
    expect(t.obj(a).zone).toBe("graveyard");
    expect(t.obj(d).zone).toBe("graveyard");
  });
  it("rejects the bottom for a surveil", () => {
    const { t, res, ids } = go([surveil(2)]);
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { place: { toBottom: [ids[0]], top: [ids[1]] } } }).error?.code).toBe("invalid_choice");
  });
});

describe("real cards: put them back in any order", () => {
  it("Ponder: the three cards come back in the order named (first = next draw)", () => {
    expect(cardUnsupported(lookup("Ponder")!).all).toEqual([]);
    const t = fam();
    t.give("p1", "Island", "battlefield");
    for (const n of ["Fill D", "Fill C", "Fill B", "Fill A"]) t.give("p1", n, "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Ponder", "hand") });
    const res = t.resolveTop();
    expect(res.pending).toMatchObject({ kind: "order_library", placement: { to: "none", stack: "top" }, min: 3, max: 3 });
    const [a, b, c] = t.p("p1").library;
    const sh = t.answer(res, { place: { top: [b, c, a] } });
    t.answer(sh, { yes: false });
    expect(t.p("p1").hand).toEqual([b]);
    expect(t.p("p1").library.slice(0, 2)).toEqual([c, a]);
  });

  it("Ponder rejects a card that was not looked at and an incomplete order", () => {
    const t = fam();
    t.give("p1", "Island", "battlefield");
    for (const n of ["Fill D", "Fill C", "Fill B", "Fill A"]) t.give("p1", n, "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Ponder", "hand") });
    const res = t.resolveTop();
    const lib = t.p("p1").library;
    const err = (ids: string[]) => t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { place: { top: ids } } }).error?.code;
    expect(err([lib[0], lib[1]])).toBe("invalid_choice");
    expect(err([lib[0], lib[1], lib[3]])).toBe("invalid_choice");
    expect(err([lib[0], lib[0], lib[1]])).toBe("invalid_choice");
  });

  it("Brainstorm: the two cards put back are ordered by the player (from the hand), first = top", () => {
    const t = fam();
    t.give("p1", "Island", "battlefield");
    for (const n of ["Fill D", "Fill C", "Fill B", "Fill A"]) t.give("p1", n, "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Brainstorm", "hand") });
    const res = t.resolveTop();
    const [x, y] = res.pending!.options.map((o) => o.id);
    const ord = t.answer(res, { ids: [x, y] });
    expect(ord.pending).toMatchObject({ kind: "order_library", placement: { to: "none" } });
    t.answer(ord, { place: { top: [y, x] } });
    expect(t.p("p1").library.slice(0, 2)).toEqual([y, x]);
  });
});
