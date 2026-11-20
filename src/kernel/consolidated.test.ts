import { describe, expect, it } from "vitest";
import { computeAbilityNeeds, computeImplementation } from "./capabilities";
import { describeCostReduction, describeFilter, describeManaSpec, describePredicate, describeReplacement, describeStatic, describeStep, describeTrigger, generatePrompts, withCardName } from "./prompts";
import { CardSchema, type Ability, type Card, type Quantity, type Step } from "./schema";
import { renderForApproval, validateCard } from "./validator";

const prep = (card: Card, name: string) => computeImplementation(generatePrompts(card, name));
const codes = (card: Card, oracle: string, name: string) => validateCard(prep(card, name), oracle, name).issues.filter((i) => i.severity === "error").map((i) => i.code);
const card = (abilities: Ability[], extra: Partial<Card> = {}): Card => ({ schemaVersion: 2, abilities, review: { status: "draft" }, ...extra });
const spell = (text: string, steps: Ability["steps"], extra: Partial<Ability> = {}): Ability => ({ id: "a1", kind: "spell_effect", text, steps, ...extra });
const tok = (n: number | object): Step => ({ kind: "create_tokens", tokenCount: n, tokenName: "Zombie", tokenPower: 2, tokenToughness: 2, tokenColors: ["black"], tokenTypeLine: "Creature - Zombie" });

describe("consolidated schema: new fields parse", () => {
  const ok = (c: Card) => expect(CardSchema.safeParse(c).success, JSON.stringify(CardSchema.safeParse(c))).toBe(true);
  it("filters, quantities, predicates", () => {
    ok(card([spell("x", [{ kind: "damage_target", all: true, filter: { types: ["creature"], notSubtypes: ["Dragon"], without: ["flying"], isCommander: true, sameName: true, sharesCreatureTypeWith: "t1", chosenType: true, chosenColor: true, attackingYou: true, controller: "defending_player" }, amount: { ref: "life_total", who: "you" } }])]));
    ok(card([spell("x", [{ kind: "draw_cards", amount: { math: "div_down", args: [{ ref: "starting_life" }, 2] }, condition: { when: "on_resolution", if: { check: "compare", left: { ref: "count_this_turn", event: "dies" }, cmp: { op: ">=", value: { ref: "players_count", who: "each_opponent", where: { check: "most_life", who: "that_player" } } } } } }])]));
    ok(card([spell("x", [{ kind: "fight", a: "created", b: "iterated" }, { kind: "investigate" }, { kind: "proliferate" }, { kind: "extra_combat" }])]));
  });
  it("triggers, replacement, statics, mana, cast options, costs", () => {
    ok(card([{ id: "a1", kind: "triggered", text: "x", trigger: { event: "attack", subject: "self", alsoOn: [{ event: "block" }, { event: "leaves", toZone: "graveyard" }], minCount: 2, defender: "you", chapters: [1, 2] }, steps: [{ kind: "scry", amount: 1 }] }]));
    ok(card([{ id: "a1", kind: "replacement", text: "x", replacement: { event: "would_deal_damage", recipient: "self", damageType: "combat", damageSource: { types: ["creature"] }, duration: "until_end_of_turn", result: { mode: "prevent" } } }]));
    ok(card([{ id: "a1", kind: "static", text: "x", static: { affects: "you", modify: [{ blockTax: { cost: "{1}", per: "blocker" } }, { setColors: ["green"] }, { extraLandDrops: 1 }, { addChosenType: true }, { costMod: { filter: {}, delta: { math: "*", args: [-1, { ref: "counters", kind: "+1/+1", on: "self" }] } } }, { attackTax: { cost: "{1}", per: "attacker", protects: "you_and_planeswalkers" } }] } }]));
    ok(card([{ id: "a1", kind: "mana", text: "x", mana: { produces: [{ colors: "{W}", restriction: { subtypes: ["Angel"] } }, { chosenColor: 1 }, { conditional: { if: { check: "turn_number", scope: "game", cmp: { op: ">", value: 1 } }, then: [{ anyColor: 2 }], else: [{ anyColor: 1 }] } }] } }]));
    ok(card([{ id: "a1", kind: "activated", text: "x", costs: [{ loyalty: -3 }], costReduction: { amount: 3, applies: "generic", condition: { check: "chosen_is", kind: "mode", value: "A" } }, steps: [{ kind: "choose", choice: "mode", options: ["A", "B"], remember: true }] }],
      { castOptions: [{ id: "c1", kind: "gift", gift: "card", from: "hand", cost: [], replacesManaCost: false, optional: true, condition: { check: "step_done", step: "s" } }, { id: "c2", kind: "escalate", from: "hand", cost: [{ mana: "{G}" }], replacesManaCost: false, perExtraMode: true, optional: false }] }));
  });
  it("targets perOpponent, modes.repeatRestriction, review.oracleOverride, scripted.params", () => {
    ok(card([spell("x", [{ kind: "exile_target", target: "t1" }], { targets: [{ id: "t1", what: "object", count: { min: 0, max: 1 }, perOpponent: true }], modes: { choose: { min: 1, max: 1 }, distinct: true, repeatRestriction: "this_turn", options: [{ id: "m", text: "m", steps: [{ kind: "scry", amount: 1 }] }] }, scripted: { handler: "h", params: { n: 1 } } })],
      { review: { status: "draft", oracleOverride: { text: "t", source: "s" } } }));
  });
});

describe("consolidated validator fixes", () => {
  it("number words beyond ten are numbers", () => {
    const text = "Create thirteen tapped 2/2 black Zombie creature tokens.";
    expect(codes(card([spell(text, [tok(13)])]), text, "Qwertyuiop")).toEqual([]);
    expect(codes(card([spell(text, [tok(3)])]), text, "Qwertyuiop")).toContain("LITERAL_MISMATCH");
    const t2 = "Create twenty 2/2 black Zombie creature tokens.";
    expect(codes(card([spell(t2, [tok(20)])]), t2, "Qwertyuiop")).toEqual([]);
  });
  it("review.ignore can suppress LITERAL_MISMATCH (all, or one token)", () => {
    const text = "Create thirteen 2/2 black Zombie creature tokens.";
    const c = card([spell(text, [tok(1)])]);
    expect(codes(c, text, "Qwertyuiop")).toContain("LITERAL_MISMATCH");
    expect(codes({ ...c, review: { status: "draft", ignore: [{ lexeme: "literal:13", reason: "test" }] } }, text, "Qwertyuiop")).not.toContain("LITERAL_MISMATCH");
    expect(codes({ ...c, review: { status: "draft", ignore: [{ lexeme: "literal", reason: "test" }] } }, text, "Qwertyuiop")).not.toContain("LITERAL_MISMATCH");
  });
  it("a pure scripted stub is exempt from the literal check for its own text; a stub with steps is not", () => {
    const text = "At the beginning of your upkeep, do the 7 thing.";
    const stub: Ability = { id: "a1", kind: "triggered", text, trigger: { event: "begin_step", step: "upkeep", whose: "yours" }, scripted: { handler: "thing" } };
    expect(codes(card([stub]), text, "Qwertyuiop")).not.toContain("LITERAL_MISMATCH");
    expect(codes(card([{ ...stub, steps: [{ kind: "scry", amount: 1 }] }]), text, "Qwertyuiop")).toContain("LITERAL_MISMATCH");
  });
  it("ability words do not force a second condition; plain conditional words still do", () => {
    const text = "Ferocious - If you control a creature with power 4 or greater, draw a card.";
    const c = card([spell(text, [{ kind: "draw_cards", amount: 1, who: "you", condition: { when: "on_resolution", if: { check: "controls", filter: { types: ["creature"], power: { op: ">=", value: 4 } } } } }])]);
    expect(codes(c, text, "Qwertyuiop")).toEqual([]);
    const bare = "Ferocious - Draw a card.";
    expect(codes(card([spell(bare, [{ kind: "draw_cards", amount: 1 }])]), bare, "Qwertyuiop")).toContain("LEXEME_UNBACKED");
  });
  it("'other'/'another' on non-objects and 'this creature or another X' are not flagged", () => {
    for (const text of ["Whenever this creature enters, it is a Goblin in addition to its other types.", "Whenever this creature or another Zombie enters, draw a card."]) {
      const c = card([{ id: "a1", kind: "triggered", text, trigger: { event: "etb", subject: { subtypes: ["Zombie"] } }, steps: [{ kind: "draw_cards", amount: 1, who: "you" }] }]);
      expect(codes(c, text, "Qwertyuiop")).not.toContain("LEXEME_UNBACKED");
    }
    const real = "Whenever another Zombie enters, draw a card.";
    expect(codes(card([{ id: "a1", kind: "triggered", text: real, trigger: { event: "etb", subject: { subtypes: ["Zombie"] } }, steps: [{ kind: "draw_cards", amount: 1, who: "you" }] }]), real, "Qwertyuiop")).toContain("LEXEME_UNBACKED");
  });
  it("Gift keyword line is claimed by a gift cast option", () => {
    const text = "Gift a card (You may promise an opponent a gift as you cast this spell. If you do, they draw a card first.)\nYou gain 2 life.";
    const c = card([{ id: "a1", kind: "spell_effect", text: "You gain 2 life.", steps: [{ kind: "life_change", lifeDelta: 2, who: "you" }] }],
      { castOptions: [{ id: "c1", kind: "gift", gift: "card", from: "hand", cost: [], replacesManaCost: false, optional: true }] });
    expect(codes(c, text, "Qwertyuiop")).toEqual([]);
  });
  it("+1/+1 for each X needs no literal 1", () => {
    const text = "This creature gets +1/+1 for each creature card in your graveyard.";
    const q: Quantity = { ref: "count", of: { types: ["creature"], zone: "graveyard", owner: "you" } };
    const c = card([{ id: "a1", kind: "static", text, static: { affects: "self", modify: [{ pt: { power: q, toughness: q } }] } }]);
    expect(codes(c, text, "Qwertyuiop")).toEqual([]);
  });
  it("half / ordinals count as the numbers they imply", () => {
    const text = "Create X 2/2 black Zombie creature tokens, where X is half the number of Zombies you control, rounded down.";
    const c = card([spell(text, [{ ...tok({ math: "div_down", args: [{ ref: "count", of: { subtypes: ["Zombie"], controller: "you" } }, 2] }) }])]);
    expect(codes(c, text, "Qwertyuiop")).toEqual([]);
  });
  it("chosen options are checked across abilities, and step_done must name a real step", () => {
    const choose: Ability = { id: "a1", kind: "replacement", text: "As this enters, choose a creature type.", replacement: { event: "would_enter", result: { mode: "also", steps: [{ kind: "choose", choice: "creature_type", remember: true }] } } };
    const stat: Ability = { id: "a2", kind: "static", text: "Creatures you control of the chosen type get +1/+1.", static: { affects: { types: ["creature"], controller: "you", chosenType: true }, modify: [{ pt: { power: 1, toughness: 1 } }] } };
    const text = "As this enters, choose a creature type.\nCreatures you control of the chosen type get +1/+1.";
    expect(codes(card([choose, stat]), text, "Qwertyuiop")).toEqual([]);
    expect(codes(card([stat]), "Creatures you control of the chosen type get +1/+1.", "Qwertyuiop")).toContain("STRUCT_CHOSEN_UNDEFINED");
    const bad = spell("Draw a card. If you do, draw a card.", [{ kind: "draw_cards", amount: 1, src: 0 }, { kind: "draw_cards", amount: 1, src: 1, condition: { when: "on_resolution", if: { check: "step_done", step: "nope" }, src: 1 } }]);
    expect(codes(card([bad]), "Draw a card. If you do, draw a card.", "Qwertyuiop")).toContain("STRUCT_STEP_REF");
  });
});

describe("consolidated renderer", () => {
  it("opponents read 'an opponent controls'", () => {
    expect(describeFilter({ types: ["creature"], controller: "opponent" })).toBe("creature an opponent controls");
    expect(describeFilter({ types: ["creature"], controller: "opponent" }, { plural: true })).toBe("creatures an opponent controls");
  });
  it("uses the card name for self, and the generic wording outside a card", () => {
    expect(describeStep({ kind: "add_counters", on: "self", counterKind: "+1/+1", amount: 1 })).toBe("put a +1/+1 counter on this permanent");
    withCardName("Grave Titan", () => expect(describeStep({ kind: "add_counters", on: "self", counterKind: "+1/+1", amount: 1 })).toBe("put a +1/+1 counter on Grave Titan"));
  });
  it("plurals", () => {
    expect(describeFilter({ subtypes: ["Elf"] }, { plural: true })).toBe("Elves");
    expect(describeFilter({ subtypes: ["Wolf"] }, { plural: true })).toBe("Wolves");
    expect(describeFilter({ subtypes: ["Fish"] }, { plural: true })).toBe("Fish");
    expect(describeFilter({ types: ["artifact", "creature"] }, { plural: true })).toBe("artifact creatures");
  });
  it("crew grant reads 'an artifact creature'", () => {
    expect(describeStep({ kind: "grant_effect", target: "self", modify: [{ addTypes: ["Artifact", "Creature"] }], duration: "until_end_of_turn" })).toContain("an artifact creature");
  });
  it("new vocabulary renders", () => {
    expect(describeTrigger({ event: "etb", subject: "self", alsoOn: [{ event: "attack" }] })).toBe("Whenever this permanent enters or attacks");
    expect(describeTrigger({ event: "etb", subject: "self", alsoOn: [{ event: "leaves", fromZone: "battlefield", toZone: "graveyard" }] })).toContain("or is put into a graveyard from the battlefield");
    expect(describeTrigger({ event: "attack", whose: "yours", batch: true, minCount: 2 })).toBe("Whenever you attack with two or more creatures");
    expect(describeTrigger({ event: "dealt_damage", subject: "self" })).toBe("Whenever this permanent is dealt damage");
    expect(describeTrigger({ event: "counter_put", subject: "self", chapters: [1, 2] })).toBe("Chapter I, II");
    expect(describePredicate({ check: "compare", left: { ref: "life_total", who: "you" }, cmp: { op: ">=", value: { math: "+", args: [{ ref: "starting_life" }, 7] } } })).toContain("your life total");
    expect(describeFilter({ types: ["creature"], without: ["flying"] })).toBe("creature without flying");
    expect(describeFilter({ types: ["creature"], notSubtypes: ["Zombie"] })).toBe("non-Zombie creature");
    expect(describeCostReduction({ amount: 3, applies: "generic", condition: { check: "stat", of: "self", stat: "controller_is_monarch", cmp: { op: "=", value: 1 } } })).toContain("costs {3} less if");
    expect(describeManaSpec({ colors: "{W}", restriction: { subtypes: ["Angel"] } })).toBe("{W} (spend only to cast an Angel spell)");
    expect(describeReplacement({ event: "would_deal_damage", recipient: "self", damageType: "combat", result: { mode: "prevent" } })).toBe("If combat damage would be dealt to this permanent, prevent it");
    expect(describeStatic({ affects: "you", modify: [{ blockTax: { cost: "{1}", per: "blocker" } }] })).toContain("can't block unless");
    expect(renderForApproval(prep(card([{ id: "a1", kind: "mana", text: "{T}: Add {W}.", costs: [{ tap: "self" }], mana: { produces: [{ colors: "{W}" }] } }]), "X"), "X")).toContain("Mana: add {W}");
  });
});

describe("consolidated capabilities: everything new is a need", () => {
  const needs = (a: Ability) => computeAbilityNeeds(a);
  it("filters / quantities / refs / steps", () => {
    const n = needs(spell("x", [{ kind: "fight", a: "created", b: "iterated" }, { kind: "damage_target", all: true, filter: { notSubtypes: ["Z"], isCommander: true }, amount: { ref: "life_total", who: "you" } }]));
    expect(n).toEqual(expect.arrayContaining(["step:fight", "ref:created", "ref:iterated", "filter:notSubtypes", "filter:isCommander", "quantity:life_total"]));
  });
  it("triggers, mana, cost reduction, targets, modes, replacement, cast options", () => {
    expect(needs({ id: "a", kind: "triggered", text: "", trigger: { event: "attack", subject: "self", alsoOn: [{ event: "block" }], minCount: 2, defender: "you", chapters: [1] }, steps: [{ kind: "draw_cards", amount: 1 }] }))
      .toEqual(expect.arrayContaining(["trigger:multi_event", "trigger:block", "trigger:min_count", "trigger:defender", "trigger:chapters"]));
    expect(needs({ id: "a", kind: "mana", text: "", mana: { produces: [{ colors: "{W}", restriction: { subtypes: ["Angel"] } }] } })).toContain("mana:restriction");
    expect(needs({ id: "a", kind: "static", text: "", costReduction: { amount: { ref: "X" }, applies: "generic", condition: { check: "life", who: "you", cmp: { op: ">", value: 1 } } } }))
      .toEqual(expect.arrayContaining(["cost_reduction:conditional", "cost_reduction:variable"]));
    expect(needs(spell("x", [{ kind: "scry", amount: 1 }], { targets: [{ id: "t1", what: "object", count: { min: 0, max: 1 }, perOpponent: true }] }))).toContain("targets:per_opponent");
    expect(needs({ id: "a", kind: "activated", text: "", costs: [{ loyalty: -3 }], steps: [{ kind: "draw_cards", amount: 1 }] })).toContain("cost:loyalty");
    expect(needs({ id: "a", kind: "replacement", text: "", replacement: { event: "would_deal_damage", duration: "until_end_of_turn", result: { mode: "prevent" } } })).toContain("replacement:duration");
    expect(needs({ id: "a", kind: "static", text: "", static: { affects: "you", modify: [{ extraLandDrops: 1 }] } })).toContain("static:extraLandDrops");
    const c = computeImplementation(card([], { castOptions: [{ id: "c", kind: "additional", from: "hand", cost: [], replacesManaCost: false, optional: false, condition: { check: "turn_number", scope: "game", cmp: { op: ">", value: 1 } } }] }));
    expect(c.castOptions![0].needs).toEqual(expect.arrayContaining(["cast_option:mandatory", "cast_option:conditional", "predicate:turn_number"]));
  });
});
