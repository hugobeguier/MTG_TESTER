import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeAbilityNeeds, computeImplementation } from "./capabilities";
import { describeFilter, describeManaSpec, describePredicate, describeQuantity, describeStatic, describeStep, describeTarget, describeTrigger, generatePrompts } from "./prompts";
import { CardSchema, type Ability, type Card, type ObjectFilter, type Predicate } from "./schema";
import { loadDraft } from "./engine/testkit";

const card = (abilities: Ability[], extra: Partial<Card> = {}): Card => ({ schemaVersion: 2, abilities, review: { status: "draft" }, ...extra });
const ok = (c: Card) => expect(CardSchema.safeParse(c).success, JSON.stringify(CardSchema.safeParse(c))).toBe(true);
const spell = (steps: Ability["steps"], extra: Partial<Ability> = {}): Ability => ({ id: "a1", kind: "spell_effect", text: "x", steps, ...extra });
const needs = (a: Ability) => computeAbilityNeeds(a);
const ab = (c: Card, id: string) => c.abilities.find((a) => a.id === id)!;

describe("cast_during: 'a main phase' vs 'your main phase'", () => {
  it("are different schema values with different wording", () => {
    const a: Predicate = { check: "cast_during", phase: "main" };
    const b: Predicate = { check: "cast_during", phase: "your_main" };
    expect(describePredicate(a)).toContain("a main phase");
    expect(describePredicate(b)).toContain("your own main phase");
    expect(describePredicate(b)).not.toBe(describePredicate(a));
  });
});

describe("review.notes", () => {
  it("is an optional string array; Draconic Visitor keeps rulings there, identical in both decks", () => {
    ok(card([], { review: { status: "draft", notes: ["a ruling"] } }));
    expect(CardSchema.safeParse(card([], { review: { status: "draft", notes: [""] } })).success).toBe(false);
    const read = (d: string) => JSON.parse(fs.readFileSync(path.join("data", "kernel-drafts", d, "draconic-visitor.json"), "utf8"));
    const l = read("lathliss"), r = read("reign-of-dragons");
    expect(l).toEqual(r);
    expect(l.review.notes.length).toBeGreaterThan(2);
    expect(l.review.oracleOverride.source.length).toBeLessThan(260);
  });
});

describe("draft fixes", () => {
  it("Athreos: devotion to white and black is ONE count of W-or-B symbols", () => {
    const w = ab(loadDraft("athreos-shroud-veiled"), "a2").static!.while as { left: unknown };
    expect(w.left).toEqual({ ref: "devotion", color: ["W", "B"] });
    expect(describeQuantity({ ref: "devotion", color: ["W", "B"] })).toContain("hybrid");
  });
  it("Arcane Denial: its controller chooses a number 0-2 then draws that many", () => {
    const dt = ab(loadDraft("arcane-denial"), "a1").steps![1] as { steps: Array<{ kind: string; choice?: string; min?: number; max?: number; amount?: unknown; who?: string }> };
    expect(dt.steps[0]).toMatchObject({ kind: "choose", choice: "number", min: 0, max: 2, who: "controller_of_target" });
    expect(dt.steps[1]).toMatchObject({ kind: "draw_cards", who: "controller_of_target", amount: { ref: "step_result", step: "n1" } });
    expect(dt.steps[1].amount).not.toBe(2);
  });
  it("Woe Strider: escape counters only when cast with escape", () => {
    expect(ab(loadDraft("woe-strider"), "a3").replacement!.condition).toEqual({ check: "cast_with", option: "escape" });
  });
  it("Martial Impetus: only creatures attacking an opponent", () => {
    const s = ab(loadDraft("martial-impetus"), "a3").steps![0] as unknown as { filter: Record<string, unknown> };
    expect(s.filter.attackingOpponent).toBe(true);
    expect(describeFilter(s.filter as never)).toContain("attacking one of your opponents");
  });
  it("Council's Judgment: everyone votes; every permanent tied for most votes is exiled", () => {
    const steps = ab(loadDraft("council-s-judgment"), "a1").steps!;
    expect(steps[0]).toMatchObject({ kind: "vote", voters: "each_player", tie: "all_tied" });
    expect(steps[1]).toMatchObject({ kind: "exile_target", target: "vote_winners" });
    expect(describeStep(steps[0])).toContain("every one tied for the most votes wins");
  });
  it("Cache Grab: food if you control a Squirrel OR returned a Squirrel card to hand this way", () => {
    const steps = ab(loadDraft("cache-grab"), "a1").steps!;
    const cond = steps[3].condition!.if as { any: Array<Record<string, unknown>> };
    expect(cond.any[0]).toMatchObject({ check: "controls" });
    expect(JSON.stringify(cond.any[1])).toContain('"step":"s3"');
    expect(steps[2].id).toBe("s3");
  });
  it("Guardian Project uses name_matches instead of a scripted handler", () => {
    const a = ab(loadDraft("guardian-project"), "a1");
    expect(a.scripted).toBeUndefined();
    expect(JSON.stringify(a.trigger)).toContain("name_matches");
  });
  it("double-faced cards carry a face per ability", () => {
    const c = loadDraft("journey-to-eternity-atzal-cave-of-eternity");
    expect(c.abilities.map((a) => a.face)).toEqual(["Journey to Eternity", "Journey to Eternity", "Atzal, Cave of Eternity", "Atzal, Cave of Eternity", "Atzal, Cave of Eternity"]);
  });
});

describe("new schema fields (parse, render, report as needs)", () => {
  it("cant attack with protects", () => {
    const c = card([{ id: "a1", kind: "static", text: "x", static: { affects: { subtypes: ["Inkling"] }, modify: [{ cant: "attack", protects: "you_and_planeswalkers" }] } }]);
    ok(c);
    expect(describeStatic(c.abilities[0].static!)).toContain("can't attack you or planeswalkers you control");
    expect(needs(c.abilities[0])).toContain("static:cant_protects");
  });
  it("counter cost from a filter", () => {
    const c = card([{ id: "a1", kind: "activated", text: "x", costs: [{ counters: { kind: "+1/+1", count: 2, remove: true, from: { types: ["creature"], controller: "you" } } }], steps: [{ kind: "scry", amount: 1 }] }]);
    ok(c);
    expect(needs(c.abilities[0])).toContain("cost:counters_from_filter");
  });
  it("filters: blocking, enteredThisTurn, attackingOpponent, sameNameAs, that_player/active_player", () => {
    const f: ObjectFilter = { types: ["creature"], blocking: true, enteredThisTurn: true, sameNameAs: "t1", controller: "that_player" };
    ok(card([spell([{ kind: "destroy_all", filter: { ...f } }])]));
    const text = describeFilter({ ...f });
    expect(text).toContain("blocking");
    expect(text).toContain("entered this turn");
    expect(text).toContain("same name as");
    expect(text).toContain("that player controls");
    expect(describeFilter({ types: ["creature"], controller: "active_player" })).toContain("the active player controls");
    for (const k of ["blocking", "enteredThisTurn", "sameNameAs"]) expect(needs(card([spell([{ kind: "destroy_all", filter: { [k]: k === "sameNameAs" ? "t1" : true } }])]).abilities[0])).toContain(`filter:${k}`);
  });
  it("steps: vote, exchange_life, regenerate, repeat_process, create_emblem", () => {
    const emblem = { id: "e1", kind: "static" as const, text: "x", static: { affects: "you" as const, modify: [{ extraLandDrops: 1 }] } };
    const c = card([spell([
      { kind: "vote", voters: "each_player", candidates: { types: ["creature"] }, tie: "controller_chooses" },
      { kind: "exchange_life", who: "you", withWho: "target_player" },
      { kind: "regenerate", target: "t1" },
      { kind: "repeat_process", steps: [{ kind: "scry", amount: 1 }], repeatIf: { check: "step_done", step: "s1" } },
      { kind: "create_emblem", who: "you", emblem: { abilities: [emblem] } }
    ])]);
    ok(c);
    const n = needs(c.abilities[0]);
    for (const k of ["vote", "exchange_life", "regenerate", "repeat_process", "create_emblem"]) expect(n).toContain(`step:${k}`);
    expect(describeStep(c.abilities[0].steps![1])).toContain("exchange life totals");
  });
  it("damage_prevented event, notFromZone, damageSource", () => {
    const c = card([{ id: "a1", kind: "triggered", text: "x", trigger: { event: "damage_prevented", subject: "you" }, steps: [{ kind: "scry", amount: 1 }] },
      { id: "a2", kind: "triggered", text: "x", trigger: { event: "unspecified", subject: { types: ["creature"], zone: "any" }, toZone: "graveyard", notFromZone: "battlefield", damageSource: { subtypes: ["Human"] } }, steps: [{ kind: "scry", amount: 1 }] }]);
    ok(c);
    expect(describeTrigger(c.abilities[0].trigger!)).toContain("is prevented");
    expect(describeTrigger(c.abilities[1].trigger!)).toContain("from anywhere other than");
    expect(needs(c.abilities[1])).toContain("trigger:damage_source");
  });
  it("token fields: tapped, attacking, abilities (typed)", () => {
    const ability: Ability = { id: "k1", kind: "triggered", text: "When this token dies, you gain 1 life.", trigger: { event: "dies", subject: "self" }, steps: [{ kind: "life_change", who: "you", amount: 1 }] };
    const c = card([spell([{ kind: "create_tokens", tokenCount: 1, tokenName: "Inkling", tokenPower: 2, tokenToughness: 1, tokenTapped: true, tokenAttacking: "attacked_opponent", tokenAbilities: [ability] }])]);
    ok(c);
    expect(describeStep(c.abilities[0].steps![0])).toMatch(/tapped and attacking that opponent/);
    // a malformed token ability is rejected (it is typed now)
    expect(CardSchema.safeParse(card([spell([{ kind: "create_tokens", tokenAbilities: [{ kind: "triggered" }] }])])).success).toBe(false);
  });
  it("predicates mana_spent, cast_with, name_matches, step_done.who", () => {
    const preds: Predicate[] = [{ check: "mana_spent", color: "B" }, { check: "cast_with", option: "escape" }, { check: "name_matches", obj: "event_object", among: [{ types: ["creature"], another: true }] }, { check: "step_done", step: "s1", who: "that_player" }];
    for (const p of preds) ok(card([spell([{ kind: "scry", amount: 1, condition: { when: "on_resolution", if: p } }])]));
    expect(describePredicate(preds[0])).toContain("{B} mana was spent");
    expect(describePredicate(preds[2])).toContain("same name");
  });
  it("targets: anyNumber and maxQuantity", () => {
    const t1 = { id: "t1", what: "player" as const, count: { min: 0, max: 1 }, anyNumber: true };
    const t2 = { id: "t1", what: "object" as const, filter: { types: ["creature"] }, count: { min: 0, max: 1 }, maxQuantity: { ref: "X" as const } };
    ok(card([spell([{ kind: "scry", amount: 1 }], { targets: [t1] })]));
    expect(describeTarget(t1)).toBe("any number of target players");
    expect(describeTarget(t2)).toBe("up to X target creatures");
    expect(needs(card([spell([{ kind: "scry", amount: 1 }], { targets: [t1] })]).abilities[0])).toContain("targets:any_number");
    expect(needs(card([spell([{ kind: "scry", amount: 1 }], { targets: [t2] })]).abilities[0])).toContain("targets:variable_count");
  });
  it("quantities: opponents_count, step_result, step_count, life_gained_this_turn, multi-colour devotion", () => {
    for (const q of [{ ref: "opponents_count" }, { ref: "step_result", step: "s1" }, { ref: "step_count", step: "s1" }, { ref: "life_gained_this_turn", who: "you" }, { ref: "devotion", color: ["W", "B"] }] as const) {
      const c = card([spell([{ kind: "draw_cards", amount: q as never }])]);
      ok(c);
      expect(describeQuantity(q as never).length).toBeGreaterThan(3);
      expect(needs(c.abilities[0]).some((n) => n.startsWith("quantity:"))).toBe(true);
    }
  });
  it("mana: variable-count any colour", () => {
    const m = { anyColorAmount: { ref: "X" as const } };
    ok(card([{ id: "a1", kind: "mana", text: "x", mana: { produces: [m] } }]));
    expect(describeManaSpec(m)).toContain("X mana in any combination of colors");
  });
  it("modes: distinctTargets; abilities: face; replacement recipient may be an ObjRef", () => {
    ok(card([spell([{ kind: "scry", amount: 1 }], { face: "Back", modes: { choose: { min: 2, max: 2 }, distinct: true, distinctTargets: true, options: [{ id: "m1", text: "m", steps: [{ kind: "scry", amount: 1 }] }] } })]));
    ok(card([{ id: "a1", kind: "replacement", text: "x", replacement: { event: "would_deal_damage", recipient: "t1", result: { mode: "prevent" } } }]));
    const c = card([spell([{ kind: "scry", amount: 1 }], { face: "Back" })]);
    expect(needs(c.abilities[0])).toContain("face");
  });
  it("everything new is reported as a need (nothing looks implemented)", () => {
    const c = computeImplementation(generatePrompts(card([{ id: "a1", kind: "static", text: "x", static: { affects: "you", modify: [{ cant: "attack", protects: "you" }] } }]), "T"));
    expect(c.abilities[0].implementation).toBe("needed");
  });
});

describe("kernel:check-copies invariant", () => {
  it("a card has identical JSON in every deck dir", () => {
    const root = path.join("data", "kernel-drafts");
    const seen = new Map<string, { dir: string; text: string }>();
    const bad: string[] = [];
    for (const d of fs.readdirSync(root)) {
      const dir = path.join(root, d);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".json") || f.startsWith("_")) continue;
        const text = JSON.stringify(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")), (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
        const prev = seen.get(f);
        if (prev && prev.text !== text) bad.push(`${f}: ${prev.dir} vs ${d}`);
        else if (!prev) seen.set(f, { dir: d, text });
      }
    }
    expect(bad).toEqual([]);
  });
});
