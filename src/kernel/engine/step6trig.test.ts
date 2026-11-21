// Kernel step 6: triggers on single events (draw, gain_life, lose_life, tap, sacrifice, counter_put, discard, mill), nth, enchanted / equipped.
import { describe, expect, it } from "vitest";
import type { Ability } from "../schema";
import { cardUnsupported } from "./support";
import { fam, mk, sorcery } from "./famkit";
import { realDef } from "./testdb";

const watcher = (name: string, trigger: NonNullable<Ability["trigger"]>, steps: NonNullable<Ability["steps"]> = [{ kind: "life_change", lifeDelta: 1, who: "you" }]) =>
  mk(name, { manaCost: "{1}", types: ["enchantment"] }, [{ id: "a1", kind: "triggered", text: name, trigger, steps }]);
const world = (cards: Record<string, ReturnType<typeof watcher>>, extra: Record<string, ReturnType<typeof sorcery>> = {}) => {
  const t = fam({ ...cards, ...extra });
  for (let i = 0; i < 8; i++) { t.give("p1", "Fill A", "library"); t.give("p2", "Fill A", "library"); }
  return t;
};
const drawN = sorcery("Draw Two", "{1}", [{ kind: "draw_cards", amount: 2, who: "you" }]);
const lifeUp = sorcery("Gain Five", "{1}", [{ kind: "life_change", lifeDelta: 5, who: "you" }]);
const lifeDown = sorcery("Lose Five", "{1}", [{ kind: "life_change", lifeDelta: -5, who: "each_player" }]);
const drain = (t: ReturnType<typeof fam>) => { for (let i = 0; i < 30 && (t.state.stack.length || t.state.pending); i++) { const p = t.state.pending; if (p) t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: { ids: p.options.map((o) => o.id) } }); else t.resolveTop(); } };
const cast = (t: ReturnType<typeof fam>, n: string, p = "p1") => { t.give(p, "Plains", "battlefield"); t.ok({ type: "castSpell", player: p, cardId: t.give(p, n, "hand") }); drain(t); };

describe("draw / gain_life / lose_life triggers", () => {
  it("whose: yours fires for each card you draw, not for the opponent's draws", () => {
    const t = world({ W: watcher("W", { event: "draw", whose: "yours" }) }, { "Draw Two": drawN });
    t.give("p1", "W", "battlefield"); cast(t, "Draw Two");
    expect(t.p("p1").life).toBe(42);
  });
  it("nth: 2 per turn fires only on the second draw", () => {
    const t = world({ W: watcher("W", { event: "draw", whose: "yours", nth: { n: 2, per: "turn" } }) }, { "Draw Two": drawN });
    t.give("p1", "W", "battlefield"); cast(t, "Draw Two");
    expect(t.p("p1").life).toBe(41);
    expect(t.state.stack).toHaveLength(0);
  });
  it("opponents' draws: whose opponents", () => {
    const t = world({ W: watcher("W", { event: "draw", whose: "opponents" }) }, { "Draw Two": drawN });
    t.give("p1", "W", "battlefield"); cast(t, "Draw Two");
    expect(t.state.stack).toHaveLength(0);
    expect(t.p("p1").life).toBe(40);
  });
  it("gain_life yours: fires for your gain only; lose_life each_player fires for both", () => {
    const t = world({ G: watcher("G", { event: "gain_life", whose: "yours" }, [{ kind: "mill", amount: 1, who: "you" }]), L: watcher("L", { event: "lose_life", whose: "each" }, [{ kind: "draw_cards", amount: 1, who: "you" }]) }, { "Gain Five": lifeUp, "Lose Five": lifeDown });
    t.give("p1", "G", "battlefield"); t.give("p1", "L", "battlefield");
    cast(t, "Gain Five");
    expect(t.p("p1").life).toBe(45);
    expect(t.p("p1").library.length).toBe(7);
    cast(t, "Lose Five");
    expect(t.p("p1").hand.length).toBe(2);
  });
});

describe("sacrifice and counter_put triggers", () => {
  it("sacrifice with a subject filter reads the sacrificed permanent's last-known information", () => {
    const sac = mk("Sac Outlet", { manaCost: "{1}", types: ["artifact"] }, [{ id: "a1", kind: "activated", text: "Sacrifice a creature: you gain 1", costs: [{ sacrifice: { types: ["creature"], controller: "you" }, count: 1 }], steps: [{ kind: "life_change", lifeDelta: 1, who: "you" }] } as Ability]);
    const t = fam({ Dina: watcher("Dina", { event: "sacrifice", subject: { types: ["creature"], controller: "you" } }, [{ kind: "life_change", lifeDelta: 10, who: "you" }]), "Sac Outlet": sac });
    t.give("p1", "Dina", "battlefield");
    const o = t.give("p1", "Sac Outlet", "battlefield"); t.give("p1", "Fill A", "battlefield"); // a 1/1 creature
    t.ok({ type: "activateAbility", player: "p1", sourceId: o, abilityId: "a1" });
    drain(t);
    expect(t.p("p1").life).toBe(51);
    const t2 = fam({ Dina: watcher("Dina", { event: "sacrifice", subject: { types: ["creature"], controller: "you" } }, [{ kind: "life_change", lifeDelta: 10, who: "you" }]), "Sac Outlet": sac });
    t2.give("p1", "Dina", "battlefield"); const o2 = t2.give("p1", "Sac Outlet", "battlefield");
    t2.give("p1", "Fill Artifact", "battlefield"); // a 0/0 non-creature artifact is not a creature: the cost has nothing to pay it
    expect(t2.do({ type: "activateAbility", player: "p1", sourceId: o2, abilityId: "a1" }).error).toBeDefined();
  });
  it("counter_put on self fires when a counter lands on this permanent, not on others", () => {
    const grow = sorcery("Grow", "{1}", [{ kind: "add_counters", on: "t1", counterKind: "+1/+1", amount: 1 }], [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: { min: 1, max: 1 } }]);
    const t = fam({ C: mk("C", { manaCost: "{1}", types: ["creature"], power: 1, toughness: 1 }, [{ id: "a1", kind: "triggered", text: "c", trigger: { event: "counter_put", subject: "self" }, steps: [{ kind: "life_change", lifeDelta: 3, who: "you" }] }]), Grow: grow });
    const a = t.give("p1", "C", "battlefield"), b = t.give("p1", "Fill A", "battlefield");
    t.give("p1", "Plains", "battlefield"); t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Grow", "hand"), targets: { t1: [b] } }); drain(t);
    expect(t.state.stack).toHaveLength(0);
    t.give("p1", "Plains", "battlefield"); t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Grow", "hand"), targets: { t1: [a] } }); drain(t);
    expect(t.p("p1").life).toBe(43);
  });
  it("real drafts are supported: Vanguard Seraph, Exemplar of Light, Dina, Savra, Psychosis Crawler", () => {
    for (const n of ["Vanguard Seraph", "Dina, Essence Brewer", "Savra, Queen of the Golgari", "Psychosis Crawler", "Moonstone Eulogist"]) expect(cardUnsupported(realDef(n)!).all, n).toEqual([]);
  });
});

describe("enchanted / equipped creature dies", () => {
  it("is supported on a dies trigger (Skullclamp, Angelic Destiny)", () => {
    expect(cardUnsupported(realDef("Skullclamp")!).all).toEqual([]);
    expect(cardUnsupported(realDef("Angelic Destiny")!).all).not.toContain("trigger:subject:enchanted");
  });
});
