// Kernel step 6: last-known counters on leaves triggers (The Ozolith, Angelic Sleuth), moving counters, state triggers.
import { describe, expect, it } from "vitest";
import { cardUnsupported } from "./support";
import { sorcery } from "./famkit";
import { realDef, realTable } from "./testdb";
import type { Step } from "../schema";

const kill = sorcery("Kill It", "{1}", [{ kind: "destroy_target", target: "t1" } as Step], [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: { min: 1, max: 1 } }]);
const drain = (t: ReturnType<typeof realTable>) => { for (let i = 0; i < 20 && (t.state.stack.length || t.state.pending); i++) { const p = t.state.pending; if (p) t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: p.kind === "choose_yes_no" ? { yes: true } : { ids: p.options.map((o) => o.id).slice(0, p.max) } }); else t.resolveTop(); } };
const setup = (name: string) => {
  const t = realTable(["p1", "p2"], { "Kill It": kill });
  t.give("p1", "Plains", "battlefield");
  const holder = t.give("p1", name, "battlefield");
  return { t, holder };
};

describe("leaves triggers with 'if it had counters on it'", () => {
  it("The Ozolith and Angelic Sleuth are supported", () => {
    expect(cardUnsupported(realDef("The Ozolith")!).all.filter((x) => x.includes("leaves"))).toEqual([]);
    expect(cardUnsupported(realDef("Angelic Sleuth")!).all).toEqual([]);
  });
  it("The Ozolith takes the counters of a creature you control that leaves", () => {
    const { t, holder } = setup("The Ozolith");
    const c = t.give("p1", "Llanowar Elves", "battlefield", { counters: { "+1/+1": 2, shield: 1 } });
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Kill It", "hand"), targets: { t1: [c] } });
    drain(t);
    expect(t.obj(c).zone).toBe("graveyard");
    expect(t.obj(holder).counters).toEqual({ "+1/+1": 2, shield: 1 });
  });
  it("a creature that had no counters does not trigger it (intervening if)", () => {
    const { t, holder } = setup("The Ozolith");
    const c = t.give("p1", "Llanowar Elves", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Kill It", "hand"), targets: { t1: [c] } });
    drain(t);
    expect(t.obj(holder).counters).toEqual({});
  });
  it("an opponent's creature does not trigger it", () => {
    const { t, holder } = setup("The Ozolith");
    const c = t.give("p2", "Llanowar Elves", "battlefield", { counters: { "+1/+1": 1 } });
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Kill It", "hand"), targets: { t1: [c] } });
    drain(t);
    expect(t.obj(holder).counters).toEqual({});
  });
  it("Angelic Sleuth investigates when another permanent with counters leaves", () => {
    const { t } = setup("Angelic Sleuth");
    const c = t.give("p1", "Llanowar Elves", "battlefield", { counters: { "+1/+1": 1 } });
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Kill It", "hand"), targets: { t1: [c] } });
    drain(t);
    expect(t.state.battlefield.some((id) => t.obj(id).token?.subtypes.includes("Clue"))).toBe(true);
  });
});

describe("counters transfer steps", () => {
  it("remove_counters any saves what was removed; removing only some of several kinds is now a decision (assign_counters)", () => {
    const some = sorcery("Strip Some", "{1}", [{ kind: "remove_counters", on: "t1", counterKind: "any", amount: 1, saveAs: "moved" } as Step], [{ id: "t1", what: "object", filter: { zone: "battlefield" }, count: { min: 1, max: 1 } }]);
    const t = realTable(["p1", "p2"], { "Strip Some": some });
    t.give("p1", "Plains", "battlefield");
    const c = t.give("p1", "Llanowar Elves", "battlefield", { counters: { a: 1, b: 1 } });
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Strip Some", "hand"), targets: { t1: [c] } });
    const res = t.do({ type: "passPriority", player: "p1" });
    const res2 = res.error ? res : t.do({ type: "passPriority", player: "p2" });
    expect(res2.error).toBeUndefined();
    expect(t.state.pending!.kind).toBe("assign_counters");
    t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { assign: { b: 1 } } });
    expect(t.obj(c).counters).toEqual({ a: 1 });
  });
});
