import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeImplementation, SUPPORTED_STEP_KINDS } from "./capabilities";
import { FIXTURES, SPHINX_ORACLE, sphinx, valorous, temporal, shark } from "./fixtures/examples";
import { liftV1Card } from "./liftV1";
import { describeCost, describePredicate, describeReplacement, describeStatic, describeStep, describeTarget, describeTrigger, generatePrompts } from "./prompts";
import { CardSchema, EXISTING_STEP_KINDS, type Ability, type Card, type Step } from "./schema";
import { renderForApproval, validateCard } from "./validator";

const prep = (card: Card, name: string) => computeImplementation(generatePrompts(card, name));
const errors = (r: ReturnType<typeof validateCard>) => r.issues.filter((i) => i.severity === "error");

describe("kernel: the 16 spec examples", () => {
  for (const f of FIXTURES) {
    it(`${f.name} validates once prompts and implementation are generated`, () => {
      const card = prep(f.card, f.name);
      expect(CardSchema.safeParse(card).success).toBe(true);
      const result = validateCard(card, f.oracle, f.name);
      expect(errors(result), JSON.stringify(errors(result), null, 1)).toEqual([]);
      expect(result.ok).toBe(true);
    });
  }
  it("covers 16 examples", () => expect(FIXTURES).toHaveLength(16));
});

describe("kernel: Sphinx's Insight", () => {
  it("correct version passes and is flagged needed (cast_during is not supported yet)", () => {
    const card = prep(sphinx.card, "Sphinx's Insight");
    expect(validateCard(card, SPHINX_ORACLE, "Sphinx's Insight").ok).toBe(true);
    expect(card.abilities[0].implementation).toBe("needed");
    expect(card.abilities[0].needs).toContain("predicate:cast_during");
  });

  it("the current v1 row (unconditional life gain) FAILS", () => {
    const v1 = liftV1Card([{
      kind: "spell_effect", condition: "", cost: "", text: SPHINX_ORACLE, declined: false, optional: false,
      steps: [{ kind: "draw_cards", amount: 2 }, { kind: "life_change", lifeDelta: 2 }]
    }]);
    const result = validateCard(prep(v1, "Sphinx's Insight"), SPHINX_ORACLE, "Sphinx's Insight");
    expect(result.ok).toBe(false);
    expect(errors(result).map((i) => i.code)).toContain("LEXEME_UNBACKED");
    expect(errors(result).some((i) => /addendum|"if"|during/.test(i.message))).toBe(true);
  });

  it("dropping the condition from the Addendum step is caught (strict src mode)", () => {
    const wrong = structuredClone(sphinx.card);
    wrong.abilities[0].steps![1] = { kind: "life_change", lifeDelta: 2, who: "you", src: 1 };
    expect(validateCard(prep(wrong, "Sphinx's Insight"), SPHINX_ORACLE, "Sphinx's Insight").ok).toBe(false);
  });

  it("a wrong number is caught", () => {
    const wrong = structuredClone(sphinx.card);
    wrong.abilities[0].steps![0] = { kind: "draw_cards", amount: 3, who: "you", src: 0 };
    const r = validateCard(prep(wrong, "Sphinx's Insight"), SPHINX_ORACLE, "Sphinx's Insight");
    expect(errors(r).map((i) => i.code)).toContain("LITERAL_MISMATCH");
  });

  it("re-render shows the condition in plain English", () => {
    expect(renderForApproval(prep(sphinx.card, "Sphinx's Insight"), "Sphinx's Insight")).toContain("IF this spell was cast during a main phase: gain 2 life");
  });
});

describe("kernel: prompts", () => {
  it("a modal spell with no prompts fails; generated prompts fix it", () => {
    const bare = computeImplementation(valorous.card);
    const r = validateCard(bare, valorous.oracle, "Valorous Stance");
    expect(r.ok).toBe(false);
    expect(errors(r).filter((i) => i.code === "PROMPT_MISSING").length).toBeGreaterThanOrEqual(3);
    expect(validateCard(prep(valorous.card, "Valorous Stance"), valorous.oracle, "Valorous Stance").ok).toBe(true);
  });

  it("builds the documented sentences", () => {
    expect(describeTarget({ id: "t1", what: "object", filter: { types: ["creature"], controller: "opponent" }, count: { min: 0, max: 2 } }))
      .toBe("up to two target creatures an opponent controls");
    const card = prep(valorous.card, "Valorous Stance");
    expect(card.abilities[0].modes!.prompt).toMatchObject({ title: "Valorous Stance: choose a mode", instruction: "Choose one mode." });
    expect(card.abilities[0].modes!.options[1].targets![0].prompt!.instruction).toBe("Choose target creature with toughness 4 or greater.");
  });

  it("X cost gets an X prompt", () => {
    const card = prep(shark.card, "Shark Typhoon");
    expect(card.abilities[1].xPrompt?.instruction).toMatch(/value for X/);
  });
});

describe("kernel: implementation flag", () => {
  it("an ability the kernel cannot run is flagged needed but the card is still valid", () => {
    const card = prep(temporal.card, "Temporal Mastery");
    expect(card.abilities[0].implementation).toBe("needed");
    expect(card.abilities[0].needs).toContain("step:extra_turn");
    expect(card.castOptions![0].needs).toContain("cast_option:miracle");
    expect(validateCard(card, temporal.oracle, "Temporal Mastery").ok).toBe(true);
  });

  it("a plain supported card is implemented", () => {
    const card = computeImplementation({
      schemaVersion: 2,
      abilities: [{ id: "a1", kind: "spell_effect", text: "Draw three cards.", steps: [{ kind: "draw_cards", amount: 3, who: "you" }] }]
    });
    expect(card.abilities[0]).toMatchObject({ implementation: "implemented", needs: [] });
    expect(validateCard(card, "Draw three cards.", "Divination").ok).toBe(true);
  });

  it("supported step kinds match src/lib/primitiveActionPlan.ts STEP_KINDS", () => {
    const src = readFileSync(path.resolve(__dirname, "../lib/primitiveActionPlan.ts"), "utf8");
    const block = src.match(/const STEP_KINDS = \[([\s\S]*?)\] as const/)![1];
    const kinds = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect([...kinds].sort()).toEqual([...EXISTING_STEP_KINDS].sort());
    expect([...SUPPORTED_STEP_KINDS].sort()).toEqual([...kinds].sort());
  });
});

describe("kernel: v1 lift", () => {
  it("free-text conditions become unsupported predicates and block approval", () => {
    const text = "At the beginning of your upkeep, if you control a commander, draw a card.";
    const v1 = liftV1Card([{ kind: "triggered", triggerEvent: "upkeep", condition: "if you control a commander", text, steps: [{ kind: "draw_cards", amount: 1 }] }]);
    expect(v1.abilities[0].conditions![0].if).toEqual({ unsupported: "if you control a commander" });
    expect(v1.abilities[0].trigger).toEqual({ event: "begin_step", step: "upkeep" });
    expect(CardSchema.safeParse(v1).success).toBe(true);
    const r = validateCard(prep(v1, "X"), text, "X");
    expect(errors(r).map((i) => i.code)).toEqual(expect.arrayContaining(["UNSUPPORTED_NODE", "LEXEME_UNBACKED"]));
  });

  it("synthesizes targets and mana kinds", () => {
    const v1 = liftV1Card([
      { kind: "spell_effect", text: "Destroy target creature.", steps: [{ kind: "destroy_target", targetType: "creature" }] },
      { kind: "activated", cost: "{T}", text: "{T}: Add {G}.", steps: [] }
    ]);
    expect(v1.abilities[0].targets![0]).toMatchObject({ id: "t1", filter: { types: ["creature"] } });
    expect(v1.abilities[0].steps![0].target).toBe("t1");
    expect(v1.abilities[1].kind).toBe("mana");
    expect(v1.abilities[1].costs).toEqual([{ tap: "self" }]);
  });
});

describe("field-aware implementation check", () => {
  it("flags step fields the legacy executor lacks even when the kind exists", () => {
    const card = computeImplementation({
      schemaVersion: 2,
      abilities: [{ id: "a1", kind: "spell_effect", text: "x", steps: [{ kind: "sacrifice_permanent", who: "each_player", all: true, filter: { colored: true } }] }]
    } as Card);
    expect(card.abilities[0].implementation).toBe("needed");
    expect(card.abilities[0].needs).toEqual(expect.arrayContaining(["field:sacrifice_permanent.all", "filter:colored"]));
  });

  it("checks fields per step kind (a field another kind reads is ignored by this one)", () => {
    const needsOf = (step: Record<string, unknown>) =>
      computeImplementation({ schemaVersion: 2, abilities: [{ id: "a1", kind: "spell_effect", text: "x", steps: [step] }] } as Card).abilities[0].needs;
    expect(needsOf({ kind: "create_tokens", tokenCount: 1, tokenName: "Thopter", tokenPower: 1, tokenToughness: 1, tokenColors: [], tokenTypeLine: "Artifact Creature" })).toEqual([]);
    expect(needsOf({ kind: "create_tokens", tokenCount: 1, tokenKeywords: ["flying"] })).toContain("field:create_tokens.tokenKeywords");
    expect(needsOf({ kind: "create_tokens", tokenCount: 1, amount: 2 })).toContain("field:create_tokens.amount");
    expect(needsOf({ kind: "reanimate", targetType: "creature" })).toContain("field:reanimate.targetType");
    expect(needsOf({ kind: "draw_cards", amount: 1, then: [{ kind: "draw_cards", amount: 1 }] })).toContain("field:draw_cards.then");
  });

  it("a cast trigger with a plain spell filter is runnable by the legacy cast-trigger parser", () => {
    const needsOf = (subject: unknown) =>
      computeImplementation({
        schemaVersion: 2,
        abilities: [{ id: "a1", kind: "triggered", text: "x", trigger: { event: "cast", subject, whose: "yours" }, steps: [{ kind: "draw_cards", amount: 1, who: "you" }] }]
      } as Card).abilities[0].needs;
    expect(needsOf({ colors: ["colorless"] })).toEqual([]);
    expect(needsOf({ types: ["artifact"] })).toEqual([]);
    expect(needsOf({ types: ["artifact"], mv: { op: ">=", n: 3 } })).toContain("trigger:subject");
  });
});

describe("kernel: plain-English re-render (trigger / static / step wording)", () => {
  const trig = (tr: NonNullable<Ability["trigger"]>) => describeTrigger(tr);

  it("casts: the actor is the subject and the filter describes the spell", () => {
    expect(trig({ event: "cast", subject: { colors: ["colorless"] }, whose: "yours" })).toBe("Whenever you cast a colorless spell");
    expect(trig({ event: "cast", subject: { types: ["artifact"] }, whose: "yours" })).toBe("Whenever you cast an artifact spell");
    expect(trig({ event: "cast", whose: "opponents" })).toBe("Whenever an opponent casts a spell");
  });

  it("draws, nth, batches, zones and states read naturally", () => {
    expect(trig({ event: "draw", whose: "opponents" })).toBe("Whenever an opponent draws a card");
    expect(trig({ event: "draw", whose: "yours", nth: { n: 2, per: "turn" } })).toBe("Whenever you draw your second card each turn");
    expect(trig({ event: "deals_combat_damage_to_player", subject: { types: ["artifact", "creature"], controller: "you" }, batch: true }))
      .toBe("Whenever one or more artifact creatures you control deal combat damage to a player");
    expect(trig({ event: "etb", subject: { types: ["artifact"], controller: "you" } })).toBe("Whenever an artifact you control enters");
    expect(trig({ event: "leaves", subject: "self", fromZone: "battlefield", toZone: "graveyard" })).toBe("Whenever this permanent is put into a graveyard from the battlefield");
    expect(trig({ event: "becomes_target", subject: "self" })).toBe("Whenever this permanent becomes the target of a spell or ability");
    expect(trig({ event: "dies", subject: "self" })).toBe("Whenever this permanent dies");
    expect(trig({ event: "begin_step", step: "upkeep", whose: "yours", interveningIf: { check: "controls", filter: { types: ["artifact"], controller: "you" } } }))
      .toBe("At the beginning of your upkeep, if you control an artifact");
    expect(trig({ event: "unspecified", subject: "self", interveningIf: { check: "stat", of: "self", stat: "page_counters", cmp: { op: ">=", value: 4 } } }))
      .toBe("When this permanent has 4 or more page counters");
  });

  it("statics read as sentences (multi-type filters mean AND, plural verbs)", () => {
    expect(describeStatic({ affects: { types: ["creature"], colors: ["colorless"], controller: "you" }, modify: [{ pt: { power: 2, toughness: 2 } }] }))
      .toBe("Colorless creatures you control get +2/+2");
    expect(describeStatic({ affects: { types: ["artifact", "creature"], controller: "you", another: true }, modify: [{ pt: { power: 1, toughness: 1 } }] }))
      .toBe("Other artifact creatures you control get +1/+1");
    expect(describeStatic({ affects: "self", modify: [{ setBasePT: { power: { ref: "count", of: { types: ["artifact"], controller: "you" } }, toughness: { ref: "count", of: { types: ["artifact"], controller: "you" } } } }] }))
      .toBe("This permanent has power and toughness each equal to the number of artifacts you control");
    expect(describeStatic({ affects: "you", modify: [{ costMod: { filter: { types: ["artifact"] }, delta: -1 } }] })).toBe("Artifact spells you cast cost {1} less to cast");
    expect(describeStatic({ affects: "enchanted", modify: [{ grant: "doesn't untap during its controller's untap step" }], while: { not: { check: "stat", of: "enchanted", stat: "controller_is_monarch", cmp: { op: "=", value: 1 } } } }))
      .toBe("The enchanted creature doesn't untap during its controller's untap step unless the controller of the enchanted creature is the monarch");
    expect(describeStatic({ affects: { types: ["artifact"], controller: "you" }, modify: [{ grant: "hexproof" }] })).toBe("Artifacts you control have hexproof");
  });

  it("step wording keeps the who, the filter and the token description", () => {
    const d = (s: Step) => describeStep(s);
    expect(d({ kind: "life_change", lifeDelta: -1, who: "each_opponent" })).toBe("each opponent loses 1 life");
    expect(d({ kind: "life_change", lifeDelta: 2, who: "you" })).toBe("gain 2 life");
    expect(d({ kind: "sacrifice_permanent", who: "each_player", filter: { colored: true } })).toBe("each player sacrifices a colored permanent");
    expect(d({ kind: "mass_bounce", filter: { types: ["creature"], attacking: true } })).toBe("return all attacking creatures to their owners' hands");
    expect(d({ kind: "create_tokens", tokenCount: 2, tokenName: "Thopter", tokenPower: 1, tokenToughness: 1, tokenColors: ["colorless"], tokenTypeLine: "Artifact Creature — Thopter", tokenKeywords: ["flying"] }))
      .toBe("create two 1/1 colorless Thopter artifact creature tokens with flying");
    expect(d({ kind: "add_counters", on: "self", counterKind: "+1/+1", amount: 1 })).toBe("put a +1/+1 counter on this permanent");
    expect(d({ kind: "grant_effect", target: "self", modify: [{ cant: "be_blocked" }], duration: "until_end_of_turn" })).toBe("this permanent can't be blocked until end of turn");
    expect(d({ kind: "move_card_zone", who: "each_opponent", from: "graveyard", all: true, moveTo: "exile" })).toBe("exile all cards from each opponent's graveyard");
  });

  it("filters: nontoken, spells on the stack, costs and replacements", () => {
    expect(describeTarget({ id: "t1", what: "object", filter: { types: ["creature"], token: false }, count: { min: 1, max: 1 } })).toBe("target nontoken creature");
    expect(describeTarget({ id: "t1", what: "object", filter: { types: ["spell"], zone: "stack" }, count: { min: 1, max: 1 } })).toBe("target spell");
    expect(describeTarget({ id: "t1", what: "object", filter: { notTypes: ["creature"], types: ["spell"], zone: "stack" }, count: { min: 1, max: 1 } })).toBe("target noncreature spell");
    expect(describeCost({ life: { ref: "commander_colors" } })).toBe("pay life equal to the number of colors in your commanders' color identity");
    expect(describeCost({ returnToHand: { types: ["artifact"], controller: "you" }, count: 1 })).toBe("return an artifact you control to its owner's hand");
    expect(describeReplacement({ event: "would_enter", result: { mode: "modify", set: { tapped: true } } })).toBe("If this permanent would enter, it enters tapped");
    expect(describePredicate({ check: "controls", filter: { types: ["artifact"], controller: "you" }, count: { op: ">=", value: 4 } })).toBe("you control four or more artifacts");
  });

  it("the Forsaken Monument draft no longer renders as 'colorless permanent casts you'", () => {
    const card = JSON.parse(readFileSync(path.join(__dirname, "../../data/kernel-drafts/keen-engineering/forsaken-monument.json"), "utf8")) as Card;
    const out = renderForApproval(card, "Forsaken Monument");
    expect(out).toContain("Trigger: Whenever you cast a colorless spell");
    expect(out).not.toContain("casts you");
  });
});
