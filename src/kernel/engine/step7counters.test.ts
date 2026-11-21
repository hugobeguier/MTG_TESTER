// Kernel step 7: which counters move / are removed (assign_counters decisions), counters removed from among several permanents as a cost.
import { describe, expect, it } from "vitest";
import type { Step } from "../schema";
import { cardUnsupported } from "./support";
import { fam, mk } from "./famkit";
import { loadDraft } from "./testkit";
import { pendingFor } from "./view";

const def = (slug: string) => ({ name: slug, types: [] as string[], kernel: loadDraft(slug) });
const ans = (t: ReturnType<typeof fam>, choice: object) => t.ok({ type: "answerDecision", player: t.state.pending!.player, decisionId: t.state.pending!.id, choice });

const mover = mk("Mover", { manaCost: "{1}", types: ["artifact"] }, [{ id: "a1", kind: "activated", text: "{1}: Move any number of counters from target permanent onto another.", costs: [{ mana: "{1}" }],
  targets: [{ id: "t1", what: "object", filter: { controller: "you" }, count: { min: 1, max: 1 } }, { id: "t2", what: "object", filter: { controller: "you" }, count: { min: 1, max: 1 } }],
  steps: [{ kind: "remove_counters", on: "t1", counterKind: "any", amount: { ref: "counters", kind: "any", on: "t1" }, upTo: true, saveAs: "moved" } as Step, { kind: "add_counters", on: "t2", counterKind: "same_as_source", amount: 1, from: "moved" } as Step] }]);
const setup = () => {
  const t = fam({ Mover: mover });
  t.give("p1", "Plains", "battlefield");
  const m = t.give("p1", "Mover", "battlefield");
  const a = t.give("p1", "Fill A", "battlefield", { counters: { "+1/+1": 2, charge: 3 } }), b = t.give("p1", "Fill B", "battlefield");
  return { t, m, a, b };
};

describe("remove counters: choose which and how many (Resourceful Defense / The Ozolith)", () => {
  it("both cards are supported", () => { for (const n of ["resourceful-defense", "the-ozolith"]) expect(cardUnsupported(def(n)).all, n).toEqual([]); });
  it("asks for an amount per counter kind, then moves exactly those", () => {
    const { t, m, a, b } = setup();
    t.ok({ type: "activateAbility", player: "p1", sourceId: m, abilityId: "a1", targets: { t1: [a], t2: [b] } });
    t.resolveTop();
    const p = t.state.pending!;
    expect(p.kind).toBe("assign_counters");
    expect(p.counters).toEqual({ min: 0, max: 5, available: { "+1/+1": 2, charge: 3 } });
    ans(t, { assign: { "+1/+1": 1, charge: 3 } });
    expect(t.obj(a).counters).toEqual({ "+1/+1": 1 });
    expect(t.obj(b).counters).toEqual({ "+1/+1": 1, charge: 3 });
  });
  it("moving none is allowed", () => {
    const { t, m, a, b } = setup();
    t.ok({ type: "activateAbility", player: "p1", sourceId: m, abilityId: "a1", targets: { t1: [a], t2: [b] } });
    t.resolveTop(); ans(t, { assign: {} });
    expect(t.obj(a).counters).toEqual({ "+1/+1": 2, charge: 3 }); expect(t.obj(b).counters).toEqual({});
  });
  it("more than available, an unknown kind, negative amounts are rejected; so is the wrong player", () => {
    const { t, m, a, b } = setup();
    t.ok({ type: "activateAbility", player: "p1", sourceId: m, abilityId: "a1", targets: { t1: [a], t2: [b] } });
    t.resolveTop();
    const p = t.state.pending!;
    for (const assign of [{ charge: 4 }, { loyalty: 1 }, { charge: -1 }, { "+1/+1": 3 }, { "+1/+1": 2, charge: 3, x: 1 }] as Array<Record<string, number>>) expect(t.do({ type: "answerDecision", player: "p1", decisionId: p.id, choice: { assign } }).error?.code).toBe("invalid_choice");
    expect(t.do({ type: "answerDecision", player: "p2", decisionId: p.id, choice: { assign: { charge: 1 } } }).error?.code).toBe("not_your_decision");
    expect(t.obj(a).counters).toEqual({ "+1/+1": 2, charge: 3 });
  });
  it("another player sees the question without its options (pendingFor)", () => {
    const { t, m, a, b } = setup();
    t.ok({ type: "activateAbility", player: "p1", sourceId: m, abilityId: "a1", targets: { t1: [a], t2: [b] } });
    t.resolveTop();
    const other = pendingFor(t.state.pending, "p2")!;
    expect((other as { options: unknown[] }).options).toEqual([]);
  });
});

describe("remove counters from among creatures you control (cost)", () => {
  const retr = mk("Retr Test", { manaCost: "{1}", types: ["enchantment"] }, [{ id: "a1", kind: "activated", text: "Remove X +1/+1 counters from among creatures you control: gain X life", costs: [{ counters: { kind: "+1/+1", count: { ref: "X" }, remove: true, from: { types: ["creature"], controller: "you" } } }], steps: [{ kind: "life_change", who: "you", amount: { ref: "X" } } as Step] }]);
  const two = mk("Two Counter Test", { manaCost: "{1}", types: ["enchantment"] }, [{ id: "a1", kind: "activated", text: "Remove two +1/+1 counters from among creatures you control: gain 5", costs: [{ counters: { kind: "+1/+1", count: 2, remove: true, from: { types: ["creature"], controller: "you" } } }], steps: [{ kind: "life_change", who: "you", lifeDelta: 5 } as Step] }]);
  const mkT = (card: string, defn: ReturnType<typeof mk>) => {
    const t = fam({ [card]: defn });
    const c = t.give("p1", card, "battlefield");
    const a = t.give("p1", "Fill A", "battlefield", { counters: { "+1/+1": 2 } }), b = t.give("p1", "Fill B", "battlefield", { counters: { "+1/+1": 1 } });
    return { t, c, a, b };
  };
  it("Hopeful Initiate / Retribution of the Ancients are supported", () => { for (const n of ["hopeful-initiate", "retribution-of-the-ancients"]) expect(cardUnsupported(def(n)).all, n).toEqual([]); });
  it("a fixed number: asks how many to take from each creature", () => {
    const { t, c, a, b } = mkT("Two Counter Test", two);
    t.ok({ type: "activateAbility", player: "p1", sourceId: c, abilityId: "a1" });
    const p = t.state.pending!;
    expect(p.kind).toBe("assign_counters");
    expect(p.counters!.available).toEqual({ [a]: 2, [b]: 1 });
    ans(t, { assign: { [a]: 1, [b]: 1 } });
    expect(t.obj(a).counters["+1/+1"]).toBe(1); expect(t.obj(b).counters["+1/+1"]).toBeUndefined();
    t.resolveTop(); expect(t.p("p1").life).toBe(45);
  });
  it("wrong totals are rejected and nothing is paid", () => {
    const { t, c, a, b } = mkT("Two Counter Test", two);
    t.ok({ type: "activateAbility", player: "p1", sourceId: c, abilityId: "a1" });
    const p = t.state.pending!;
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: p.id, choice: { assign: { [a]: 1 } } }).error?.code).toBe("invalid_choice");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: p.id, choice: { assign: { [b]: 2 } } }).error?.code).toBe("invalid_choice");
    expect(t.obj(a).counters["+1/+1"]).toBe(2);
  });
  it("only one creature has counters: nothing to decide", () => {
    const t = fam({ "Two Counter Test": two });
    const c = t.give("p1", "Two Counter Test", "battlefield"); const a = t.give("p1", "Fill A", "battlefield", { counters: { "+1/+1": 3 } });
    t.ok({ type: "activateAbility", player: "p1", sourceId: c, abilityId: "a1" });
    expect(t.state.pending).toBeNull(); expect(t.obj(a).counters["+1/+1"]).toBe(1);
  });
  it("not enough counters: cannot pay", () => {
    const t = fam({ "Two Counter Test": two });
    const c = t.give("p1", "Two Counter Test", "battlefield"); t.give("p1", "Fill A", "battlefield", { counters: { "+1/+1": 1 } });
    expect(t.do({ type: "activateAbility", player: "p1", sourceId: c, abilityId: "a1" }).error?.code).toBe("cannot_pay");
  });
  it("X is asked first (capped by the counters available), then the split", () => {
    const { t, c, a, b } = mkT("Retr Test", retr);
    t.ok({ type: "activateAbility", player: "p1", sourceId: c, abilityId: "a1" });
    expect(t.state.pending!.kind).toBe("choose_x"); expect(t.state.pending!.max).toBe(3);
    ans(t, { number: 3 });
    expect(t.state.pending).toBeNull(); // taking all: nothing to decide
    expect([t.obj(a).counters["+1/+1"], t.obj(b).counters["+1/+1"]]).toEqual([undefined, undefined]);
    t.resolveTop(); expect(t.p("p1").life).toBe(43);
  });
  it("X = 1 with two candidates asks which creature", () => {
    const { t, c, a, b } = mkT("Retr Test", retr);
    t.ok({ type: "activateAbility", player: "p1", sourceId: c, abilityId: "a1" });
    ans(t, { number: 1 }); ans(t, { assign: { [b]: 1 } });
    expect(t.obj(b).counters["+1/+1"]).toBeUndefined(); expect(t.obj(a).counters["+1/+1"]).toBe(2);
  });
  it("cancelling at the counters question pays nothing", () => {
    const { t, c, a } = mkT("Two Counter Test", two);
    t.ok({ type: "activateAbility", player: "p1", sourceId: c, abilityId: "a1" });
    ans(t, { cancel: true });
    expect(t.obj(a).counters["+1/+1"]).toBe(2); expect(t.state.pending).toBeNull();
  });
});

describe("counters removed from self with X (Crucible of the Spirit Dragon)", () => {
  it("removes X counters", () => {
    const k = mk("Storage Test", { types: ["land"] }, [{ id: "a1", kind: "activated", text: "t", costs: [{ counters: { kind: "storage", count: { ref: "X" }, remove: true, from: "self" } }], steps: [{ kind: "life_change", who: "you", amount: { ref: "X" } } as Step] }]);
    const t = fam({ "Storage Test": k }); const s = t.give("p1", "Storage Test", "battlefield", { counters: { storage: 3 } });
    t.ok({ type: "activateAbility", player: "p1", sourceId: s, abilityId: "a1", x: 2 });
    expect(t.obj(s).counters.storage).toBe(1);
    t.resolveTop(); expect(t.p("p1").life).toBe(42);
  });
});
