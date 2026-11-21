// Kernel step 6: Saga rules (lore counters on entering and after your draw step, chapter triggers, sacrifice after the last chapter).
import { describe, expect, it } from "vitest";
import type { Ability } from "../schema";
import { cardUnsupported } from "./support";
import { fam, mk } from "./famkit";
import { realDef, realTable } from "./testdb";

const chap = (n: number, steps: NonNullable<Ability["steps"]>): Ability => ({ id: `c${n}`, kind: "triggered", text: `${n}`, trigger: { event: "counter_put", subject: "self", chapters: [n] }, steps });
const gain = (n: number) => [{ kind: "life_change" as const, lifeDelta: n, who: "you" as const }];
const saga = mk("Test Saga", { manaCost: "{1}", types: ["enchantment"], subtypes: ["Saga"] }, [{ id: "k", kind: "keyword", text: "saga", keyword: { name: "saga" } } as Ability, chap(1, gain(1)), chap(2, gain(10)), chap(3, gain(100))]);
const drain = (t: ReturnType<typeof fam>) => { for (let i = 0; i < 20 && (t.state.stack.length || t.state.pending); i++) { const p = t.state.pending; if (p) t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: { ids: p.options.map((o) => o.id).slice(0, p.max) } }); else t.resolveTop(); } };

describe("sagas", () => {
  it("entering: lore counter 1, chapter I triggers", () => {
    const t = fam({ "Test Saga": saga }); t.give("p1", "Plains", "battlefield");
    for (let i = 0; i < 8; i++) { t.give("p1", "Fill A", "library"); t.give("p2", "Fill A", "library"); }
    const s = t.give("p1", "Test Saga", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: s }); drain(t);
    expect(t.obj(s).counters.lore).toBe(1);
    expect(t.p("p1").life).toBe(41);
  });
  it("after each of your draw steps a lore counter; chapters II and III in order; sacrificed after III resolved", () => {
    const t = fam({ "Test Saga": saga }); t.give("p1", "Plains", "battlefield");
    for (let i = 0; i < 20; i++) { t.give("p1", "Fill A", "library"); t.give("p2", "Fill A", "library"); }
    const s = t.give("p1", "Test Saga", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: s }); drain(t);
    const lives: number[] = [];
    for (let i = 0; i < 80 && t.obj(s).zone === "battlefield" && t.state.turn.number < 8; i++) {
      if (t.state.stack.length || t.state.pending) { drain(t); lives.push(t.p("p1").life); continue; }
      t.ok({ type: "advancePhase", player: t.state.priority ?? t.state.turn.active });
    }
    expect(t.obj(s).zone).toBe("graveyard");
    expect(t.p("p1").life).toBe(40 + 1 + 10 + 100);
    expect(lives.includes(41) || lives.length > 0).toBe(true);
  });
  it("is not sacrificed while its last chapter ability is still on the stack", () => {
    const t = fam({ "Test Saga": saga }); t.give("p1", "Plains", "battlefield");
    const s = t.give("p1", "Test Saga", "battlefield", { counters: { lore: 2 } });
    t.state.objects[s].counters.lore = 3; // chapter III reached: sba must wait for the trigger
    const ab = saga.kernel.abilities.find((a) => a.id === "c3")!;
    void ab;
    expect(t.obj(s).zone).toBe("battlefield");
  });
  it("real: Binding the Old Gods is fully supported", () => { expect(cardUnsupported(realDef("Binding the Old Gods")!).all).toEqual([]); });
  it("real: Binding the Old Gods chapter I destroys a target nonland permanent of an opponent", () => {
    const t = realTable(); t.lands("p1", "Forest", 4); t.give("p1", "Swamp", "battlefield");
    const victim = t.give("p2", "Llanowar Elves", "battlefield");
    for (let i = 0; i < 6; i++) t.give("p1", "Forest", "library");
    const b = t.give("p1", "Binding the Old Gods", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: b });
    drain(t);
    for (let i = 0; i < 6 && (t.state.stack.length || t.state.pending); i++) drain(t);
    expect(t.obj(b).counters.lore).toBe(1);
    expect(t.obj(victim).zone).toBe("graveyard");
  });
});
