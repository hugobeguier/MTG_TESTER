// Lim-Dûl's Vault (real draft, aminatou deck): look at five; any number of times pay 1 life, bottom them in any order and look again; at the end shuffle the
// rest and put the last cards looked at on top in any order.
import { describe, expect, it } from "vitest";
import { ctx, mini } from "../integration/testgame";
import { cardUnsupported } from "./support";
import { toTableState } from "../integration/tableState";
import { pendingFor } from "./view";
import { legalActions } from "./legal";

const NAME = "Lim-Dûl's Vault";
const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
type T = ReturnType<typeof mini>;

/** library of `n` distinct basics: names are only tags, ids tell them apart; returns ids top first */
function setup(n = 12, life?: number) {
  const t = mini();
  t.give("p1", "Island", "battlefield"); t.give("p1", "Swamp", "battlefield");
  const names = ["Forest", "Mountain", "Plains", "Island", "Swamp"];
  const ids: string[] = [];
  for (let i = n - 1; i >= 0; i--) ids[i] = t.give("p1", names[i % 5], "library", { top: true });
  if (life !== undefined) t.state.players[0].life = life;
  t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", NAME, "hand") });
  t.settle();
  return { t, ids };
}
const lib = (t: T) => t.state.players[0].library;
/** answer until the next question; returns it */
const pend = (t: T) => t.state.pending;
const optIds = (t: T) => pend(t)!.options.map((o) => o.id);

describe("Lim-Dûl's Vault", () => {
  it("the draft is supported by the engine (no unsupported construct)", () => {
    const d = ctx.cards(NAME);
    expect(d?.kernel?.abilities.length).toBeGreaterThan(0);
    expect(cardUnsupported(d!).all).toEqual([]);
  });

  it("first question: the five cards are looked at, then 'repeat?' yes/no", () => {
    const { t } = setup();
    expect(pend(t)).toMatchObject({ kind: "choose_yes_no", player: "p1" });
    expect(pend(t)!.prompt.instruction).toBeTruthy();
  });

  it("zero iterations: the five cards go back on top in the chosen order, no life paid", () => {
    const { t, ids } = setup();
    t.answer({ yes: false });
    expect(pend(t)).toMatchObject({ kind: "order_library", min: 5, max: 5 });
    expect(optIds(t).sort()).toEqual(ids.slice(0, 5).sort());
    const order = [ids[4], ids[2], ids[0], ids[3], ids[1]];
    t.answer({ place: { top: order } });
    expect(lib(t).slice(0, 5)).toEqual(order);
    expect(lib(t)).toHaveLength(12);
    expect(t.state.players[0].life).toBe(40);
    expect(pend(t)).toBeFalsy();
  });

  it("one iteration: pay 1 life, bottom the five in the chosen order, look at the next five", () => {
    const { t, ids } = setup();
    t.answer({ yes: true });
    expect(pend(t)).toMatchObject({ kind: "order_library", min: 5, max: 5 });
    expect(optIds(t).sort()).toEqual(ids.slice(0, 5).sort());
    expect(t.state.players[0].life).toBe(39);
    const bottom = [ids[3], ids[1], ids[4], ids[0], ids[2]];
    t.answer({ place: { top: bottom } }); // the placement here is "to the bottom": answered in the same shape
    const q = t.state.pending;
    expect(q).toMatchObject({ kind: "choose_yes_no" });
    expect(lib(t).slice(-5)).toEqual(bottom);
    t.answer({ yes: false });
    expect(optIds(t).sort()).toEqual(ids.slice(5, 10).sort());
    t.answer({ place: { top: ids.slice(5, 10) } });
    expect(lib(t).slice(0, 5)).toEqual(ids.slice(5, 10));
    expect(lib(t)).toHaveLength(12);
  });
});

describe("Lim-Dûl's Vault: life, short libraries, answers", () => {
  const loop = (t: T, n: number) => { for (let i = 0; i < n; i++) { t.answer({ yes: true }); t.answer({ place: { top: optIds(t) } }); } };
  it("three iterations pay 3 life and the last five looked at are put on top", () => {
    const { t } = setup(20);
    loop(t, 3);
    expect(t.state.players[0].life).toBe(37);
    t.answer({ yes: false });
    const seen = optIds(t);
    t.answer({ place: { top: [...seen].reverse() } });
    expect(lib(t).slice(0, 5)).toEqual([...seen].reverse());
    expect(lib(t)).toHaveLength(20);
  });
  it("dying: at 1 life one payment is legal (life 0, the loss is a state-based action after the spell), a second is not offered", () => {
    const { t } = setup(12, 1);
    t.answer({ yes: true });
    expect(t.state.players[0].life).toBe(0);
    t.answer({ place: { top: optIds(t) } });
    expect(pend(t)).toMatchObject({ kind: "order_library" }); // no further 'pay 1 life?' question: the five cards are put back
    t.answer({ place: { top: optIds(t) } });
    expect(t.state.players[0].hasLost).toBe(true);
  });
  it("a short library: fewer than five cards are looked at and ordered", () => {
    const { t, ids } = setup(3);
    t.answer({ yes: false });
    expect(optIds(t).sort()).toEqual([...ids].sort());
    t.answer({ place: { top: [ids[2], ids[0], ids[1]] } });
    expect(lib(t)).toEqual([ids[2], ids[0], ids[1]]);
  });
  it("seven cards: after bottoming, the next look overlaps the bottomed cards", () => {
    const { t, ids } = setup(7);
    t.answer({ yes: true });
    t.answer({ place: { top: ids.slice(0, 5) } });
    t.answer({ yes: false });
    expect(optIds(t).sort()).toEqual([ids[5], ids[6], ids[0], ids[1], ids[2]].sort());
    t.answer({ place: { top: optIds(t) } });
    expect(lib(t)).toHaveLength(7);
  });
  it("an empty library does not loop forever (life bounds it) and nothing breaks", () => {
    const { t } = setup(0);
    t.answer({ yes: true });
    expect(t.state.players[0].life).toBe(39);
    t.answer({ yes: false });
    expect(pend(t)).toBeFalsy();
  });
  it("invalid answers are refused: a card that was not looked at, a missing card, a duplicate, a non-boolean", () => {
    const { t, ids } = setup();
    const p = t.state.pending!;
    const bad = (choice: object) => expect(t.do({ type: "answerDecision", player: "p1", decisionId: p.id, choice } as never).error).toBeTruthy();
    bad({ ids: [ids[0]] });
    bad({});
    t.answer({ yes: false });
    const q = t.state.pending!;
    const badO = (choice: object) => expect(t.do({ type: "answerDecision", player: "p1", decisionId: q.id, choice } as never).error).toBeTruthy();
    badO({ place: { top: ids.slice(0, 4) } });
    badO({ place: { top: [ids[0], ids[0], ids[1], ids[2], ids[3]] } });
    badO({ place: { top: [...ids.slice(0, 4), ids[7]] } });
    expect(t.state.pending?.id).toBe(q.id);
  });
  it("the opponent never sees the cards; the owner's view lists them", () => {
    const { t, ids } = setup();
    t.answer({ yes: false });
    expect(pendingFor(t.state.pending, "p2")).toMatchObject({ hidden: true, options: [], optionCount: 5 });
    expect(legalActions(t.state, "p2", ctx).some((x) => x.kind === "answerDecision")).toBe(false);
    expect(toTableState(t.state, "p2", { ctx, display: () => undefined } as never).decision).toBeUndefined();
    expect(optIds(t).sort()).toEqual(ids.slice(0, 5).sort());
  });
  it("deterministic: the same answers give the same final library", () => {
    const run = () => { const { t } = setup(20); t.answer({ yes: true }); t.answer({ place: { top: optIds(t) } }); t.answer({ yes: false }); t.answer({ place: { top: optIds(t) } }); return lib(t).join(","); };
    expect(run()).toBe(run());
  });
});
