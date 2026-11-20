// What the kernel can execute TODAY. Derived honestly from the existing code:
//  - step kinds: the 20 in src/lib/primitiveActionPlan.ts STEP_KINDS (a test asserts they match)
//  - predicates: what src/engine/mana.ts isBoardConditionMet evaluates (controls N+ of a type,
//    graveyard counts, life comparisons, "created a token / gained life this turn")
//  - trigger events: cardParser.ts TRIGGER_EVENTS
// Everything else is unsupported and shows up in an ability's `needs` list. Growing the kernel =
// adding entries here (and the code that backs them).

import {
  EXISTING_STEP_KINDS, type Ability, type Card, type CastOption, type Cost, type Predicate, type Step
} from "./schema";

export const SUPPORTED_STEP_KINDS: ReadonlySet<string> = new Set(EXISTING_STEP_KINDS);

// Predicate `check` names isBoardConditionMet can answer (coarsely) and combinators it can express.
export const SUPPORTED_PREDICATES: ReadonlySet<string> = new Set([
  "controls",    // "you control N or more <type>", "you control a <type>"
  "zone_count",  // "N or more <type> cards in your graveyard"
  "life",        // "opponent has more life", "at least N life more than starting"
  "did_this_turn", // "you created a token / gained life this turn"
  "any"          // "you control an X or a Y"
]);

// cardParser TRIGGER_EVENTS mapped to schema events; begin_step only for these steps.
export const SUPPORTED_TRIGGER_EVENTS: ReadonlySet<string> = new Set([
  "etb", "dies", "attack", "begin_step", "deals_combat_damage_to_player", "cast"
]);
export const SUPPORTED_BEGIN_STEPS: ReadonlySet<string> = new Set(["upkeep", "end_step", "beginning_of_combat"]);

export const SUPPORTED_COST_ATOMS: ReadonlySet<string> = new Set(["mana", "tap"]);
export const SUPPORTED_CONDITION_WHEN: ReadonlySet<string> = new Set(["on_trigger", "on_resolution"]);
export const SUPPORTED_DURATIONS: ReadonlySet<string> = new Set(["instant", "until_end_of_turn"]);
// Keyword abilities that need active kernel behaviour rather than passive engine handling.
export const UNSUPPORTED_KEYWORDS: ReadonlySet<string> = new Set(["exploit", "connive", "landwalk", "enchant", "crew", "improvise"]);

// Fields the legacy step executor (PrimitiveActionStepSchema in src/lib/primitiveActionPlan.ts) understands, plus
// the structural/meta fields checked separately (condition, duration, nesting, prompts). A step using any other
// field (filter, all, who, imprint, ...) only looks implemented if we judge by kind, so it is reported as a need.
// Verified against mapPrimitiveActionStep in src/engine/oneShotEffects.ts (the code that actually runs a plan step):
// each kind reads ONLY the fields below. A field the schema allows but the kind ignores (e.g. `amount` on
// create_tokens, `targetType` on reanimate) would silently do nothing, so it counts as a need.
// Meta fields every step may carry: id/src/prompt are bookkeeping; target/optional/condition/unlessPay/duration are
// handled by the separate checks in checkStep (plan-level optional/condition exist in the legacy plan; per-step
// branching `if`/`then`/`else`/nested `steps` do NOT exist in the legacy executor, so they are not listed here).
export const STEP_META_FIELDS: ReadonlySet<string> = new Set([
  "kind", "id", "src", "prompt", "target", "optional", "condition", "unlessPay", "duration"
]);
export const LEGACY_STEP_FIELDS_BY_KIND: Readonly<Record<string, readonly string[]>> = {
  destroy_target: ["targetType"],
  destroy_all: ["targetType"], // executor only honours artifact / enchantment, anything else becomes creature
  exile_target: ["targetType"],
  bounce_target: ["targetType"],
  reanimate: ["regrowTargetType", "anyGraveyard"],
  mill: ["amount", "millScope"],
  draw_cards: ["amount"],
  life_change: ["lifeDelta"],
  drain: ["amount", "drainScope"],
  damage_target: ["amount", "damageTargetType"],
  discard: ["amount", "discardScope"],
  tap_target: ["targetType"],
  untap_target: ["targetType"],
  pump_target: ["power", "toughness"],
  mass_pump: ["power", "toughness", "massPumpScope"],
  mass_bounce: [],
  create_tokens: ["tokenCount", "tokenName", "tokenPower", "tokenToughness", "tokenColors", "tokenTypeLine"], // no keywords/abilities
  put_counters_on_self: ["counterKind", "amount"],
  sacrifice_permanent: ["sacrificeScope"],
  move_card_zone: ["moveFrom", "moveTo", "moveFilter", "moveCount"]
};
// Union of every legacy field, kept for callers that only need "is this a legacy-schema field at all".
export const LEGACY_STEP_FIELDS: ReadonlySet<string> = new Set([
  ...STEP_META_FIELDS, ...Object.values(LEGACY_STEP_FIELDS_BY_KIND).flat()
]);

// The legacy "cast" trigger (triggerFinders.ts CAST_TRIGGER_PATTERN) matches "whenever you / an opponent / a player casts
// a [type or colour or subtype] spell" -- a spell filter built from these keys only. Anything richer is a need.
const CAST_SUBJECT_KEYS: ReadonlySet<string> = new Set(["types", "notTypes", "colors", "subtypes"]);
function castSubjectSupported(subject: unknown): boolean {
  return typeof subject === "object" && subject !== null && !Array.isArray(subject) &&
    !("ref" in subject) && !("who" in subject) &&
    Object.keys(subject).every((k) => CAST_SUBJECT_KEYS.has(k));
}

// Consolidated pass: vocabulary the legacy engine has no equivalent for. Detected by key / value anywhere in an ability
// (metadata such as text and prompts is stripped first) and reported as a need, so nothing new ever looks implemented.
const NEW_FILTER_KEYS = ["notSubtypes", "without", "isCommander", "sameName", "sharesCreatureTypeWith", "chosenType", "chosenColor", "attackingYou"] as const;
const NEW_QUANTITY_REFS = ["life_total", "starting_life", "count_this_turn", "players_count"] as const;
const NEW_STATIC_MODIFIERS = ["addChosenType", "blockTax", "setColors", "extraLandDrops", "mustAttack", "copySubtypesOf", "setBasePT", "addTypes", "attackTax"] as const;

function stripMeta(ability: unknown): string {
  return JSON.stringify(ability, (k, v) => (k === "text" || k === "prompt" || k === "xPrompt" || k === "legacy" || k === "review" ? undefined : v));
}

function addUnique(list: string[], value: string) {
  if (!list.includes(value)) list.push(value);
}

function checkQuantityFields(obj: Record<string, unknown>, needs: string[]) {
  for (const key of ["amount", "power", "toughness", "tokenPower", "tokenToughness", "tokenCount"]) {
    const v = obj[key];
    if (v !== undefined && typeof v !== "number") addUnique(needs, `quantity:${(v as { ref?: string; math?: string }).ref ?? "math"}`);
  }
}

function checkPredicate(p: Predicate, needs: string[]) {
  if ("unsupported" in p) return addUnique(needs, "predicate:unsupported");
  if ("all" in p) { addUnique(needs, "predicate:all"); p.all.forEach((c) => checkPredicate(c, needs)); return; }
  if ("any" in p) { if (!SUPPORTED_PREDICATES.has("any")) addUnique(needs, "predicate:any"); p.any.forEach((c) => checkPredicate(c, needs)); return; }
  if ("not" in p) { addUnique(needs, "predicate:not"); checkPredicate(p.not, needs); return; }
  if (!SUPPORTED_PREDICATES.has(p.check)) addUnique(needs, `predicate:${p.check}`);
}

function checkPredicateOpt(p: Predicate | undefined, needs: string[]) {
  if (p) checkPredicate(p, needs);
}

function checkCost(cost: Cost, needs: string[]) {
  if ("unsupported" in cost) return addUnique(needs, "cost:unsupported");
  const atom = Object.keys(cost).find((k) => k !== "prompt" && k !== "src" && k !== "count" && k !== "what")!;
  if (!SUPPORTED_COST_ATOMS.has(atom)) addUnique(needs, `cost:${atom}`);
  if ("mana" in cost && /\{X\}/i.test(cost.mana)) addUnique(needs, "cost:x");
}

function checkStep(step: Step, needs: string[]) {
  if (!SUPPORTED_STEP_KINDS.has(step.kind)) addUnique(needs, `step:${step.kind}`);
  checkQuantityFields(step, needs);
  const kindFields = LEGACY_STEP_FIELDS_BY_KIND[step.kind];
  for (const key of Object.keys(step).sort()) {
    if (STEP_META_FIELDS.has(key)) continue;
    // An unknown (new) kind is already reported as step:<kind>; list its fields against the union only.
    if (kindFields ? kindFields.includes(key) : LEGACY_STEP_FIELDS.has(key)) continue;
    if (key === "who" && step.who === "you") continue;
    addUnique(needs, `field:${step.kind}.${key}`);
  }
  if (step.condition) {
    if (!SUPPORTED_CONDITION_WHEN.has(step.condition.when)) addUnique(needs, `condition_when:${step.condition.when}`);
    checkPredicate(step.condition.if, needs);
  }
  if (step.if) checkPredicate(step.if, needs);
  if (step.unlessPay) addUnique(needs, "step:unless_pay");
  if (step.duration !== undefined && !(typeof step.duration === "string" && SUPPORTED_DURATIONS.has(step.duration))) {
    addUnique(needs, `duration:${typeof step.duration === "string" ? step.duration : Object.keys(step.duration)[0]}`);
  }
  for (const nested of [step.then, step.else, step.steps]) nested?.forEach((s) => checkStep(s, needs));
}

export function computeAbilityNeeds(ability: Ability): string[] {
  const needs: string[] = [];
  if (ability.declined) addUnique(needs, "declined");
  if (ability.scripted) addUnique(needs, `scripted:${ability.scripted.handler}`);
  if (ability.replacement) addUnique(needs, `replacement:${ability.replacement.event}`);
  if (ability.static) addUnique(needs, "static");
  if (ability.kind === "static" && !ability.static && !ability.costReduction) addUnique(needs, "static");
  if (ability.kind === "cast_option") addUnique(needs, "cast_option");
  if (ability.kind === "replacement" && !ability.replacement) addUnique(needs, "replacement");
  if (ability.modes) addUnique(needs, "modes");
  if (ability.zone && ability.zone !== "battlefield" && ability.kind !== "spell_effect") addUnique(needs, `zone:${ability.zone}`);
  if (ability.keyword && UNSUPPORTED_KEYWORDS.has(ability.keyword.name)) addUnique(needs, `keyword:${ability.keyword.name}`);
  if (ability.mana?.produces.some((m) => !("colors" in m))) addUnique(needs, "mana:variable");
  if (ability.costReduction) addUnique(needs, "cost_reduction");

  const json = stripMeta(ability);
  if (json.includes('"linked_exile"')) addUnique(needs, "ref:linked_exile");
  if (json.includes('"sacrificed"')) addUnique(needs, "ref:sacrificed");
  if (json.includes('"created"')) addUnique(needs, "ref:created");
  if (json.includes('"iterated"')) addUnique(needs, "ref:iterated");
  if (json.includes('"defending_player"')) addUnique(needs, "filter:defending_player");
  if (/"colored":(true|false)/.test(json)) addUnique(needs, "filter:colored");
  for (const k of NEW_FILTER_KEYS) if (json.includes(`"${k}":`)) addUnique(needs, `filter:${k}`);
  for (const r of NEW_QUANTITY_REFS) if (json.includes(`"ref":"${r}"`)) addUnique(needs, `quantity:${r}`);
  if (/"math":"div_(down|up)"/.test(json)) addUnique(needs, "quantity:division");
  if (ability.static) for (const m of ability.static.modify) for (const k of NEW_STATIC_MODIFIERS) if (k in m) addUnique(needs, `static:${k}`);
  if (ability.static?.modify.some((m) => "costMod" in m && typeof m.costMod.delta !== "number")) addUnique(needs, "static:costMod_quantity");
  if (ability.costReduction) {
    if (ability.costReduction.condition) addUnique(needs, "cost_reduction:conditional");
    if (typeof ability.costReduction.amount !== "number") addUnique(needs, "cost_reduction:variable");
    checkPredicateOpt(ability.costReduction.condition, needs);
  }
  if (ability.mana?.produces.some((m) => JSON.stringify(m).match(/"(restriction|abilitiesOf)"/))) addUnique(needs, "mana:restriction");
  if (ability.mana?.produces.some((m) => "conditional" in m)) addUnique(needs, "mana:conditional");
  if (ability.mana?.produces.some((m) => "chosenColor" in m)) addUnique(needs, "mana:chosen_color");
  if (ability.replacement) {
    const r = ability.replacement;
    if (r.duration) addUnique(needs, "replacement:duration");
    if (r.recipient || r.damageType || r.damageSource) addUnique(needs, "replacement:damage_qualifiers");
  }
  if (ability.modes?.repeatRestriction) addUnique(needs, "modes:repeat_restriction");
  if (ability.modes?.repeatable) addUnique(needs, "modes:repeatable");
  if (ability.modes && ability.modes.choose.max > 1) addUnique(needs, "modes:multiple");

  const t = ability.timing;
  if (t && (t.only?.length || t.limit || t.window)) addUnique(needs, "timing");
  t?.only?.forEach((p) => checkPredicate(p, needs));

  ability.costs?.forEach((c) => checkCost(c, needs));
  ability.conditions?.forEach((c) => {
    if (!SUPPORTED_CONDITION_WHEN.has(c.when)) addUnique(needs, `condition_when:${c.when}`);
    checkPredicate(c.if, needs);
  });

  const tr = ability.trigger;
  if (tr) {
    if (!SUPPORTED_TRIGGER_EVENTS.has(tr.event)) addUnique(needs, `trigger:${tr.event}`);
    if (tr.event === "begin_step" && !(tr.step && SUPPORTED_BEGIN_STEPS.has(tr.step))) addUnique(needs, `trigger:begin_step:${tr.step ?? "?"}`);
    if (tr.batch) addUnique(needs, "trigger:batch");
    if (tr.nth) addUnique(needs, "trigger:nth");
    if (tr.interveningIf) { addUnique(needs, "trigger:intervening_if"); checkPredicate(tr.interveningIf, needs); }
    if (tr.subject && tr.subject !== "self" && !(tr.event === "cast" && castSubjectSupported(tr.subject))) addUnique(needs, "trigger:subject");
    if (tr.fromZone || tr.toZone) addUnique(needs, "trigger:zones");
    if (tr.minCount) addUnique(needs, "trigger:min_count");
    if (tr.chapters?.length) addUnique(needs, "trigger:chapters");
    if (tr.defender) addUnique(needs, "trigger:defender");
    if (tr.alsoOn?.length) {
      addUnique(needs, "trigger:multi_event");
      for (const alt of tr.alsoOn) {
        if (!SUPPORTED_TRIGGER_EVENTS.has(alt.event)) addUnique(needs, `trigger:${alt.event}`);
        if (alt.event === "begin_step" && !((alt.step ?? tr.step) && SUPPORTED_BEGIN_STEPS.has((alt.step ?? tr.step)!))) addUnique(needs, `trigger:begin_step:${alt.step ?? tr.step ?? "?"}`);
        if (alt.fromZone || alt.toZone) addUnique(needs, "trigger:zones");
        if (alt.subject !== undefined && alt.subject !== "self") addUnique(needs, "trigger:subject");
      }
    }
  }

  const allTargets = [...(ability.targets ?? []), ...(ability.modes?.options.flatMap((o) => o.targets ?? []) ?? [])];
  if (allTargets.some((t2) => t2.count.min !== 1 || t2.count.max !== 1)) addUnique(needs, "targets:multi");
  if (allTargets.some((t2) => t2.perOpponent)) addUnique(needs, "targets:per_opponent");

  ability.steps?.forEach((s) => checkStep(s, needs));
  ability.modes?.options.forEach((o) => o.steps.forEach((s) => checkStep(s, needs)));
  if (ability.replacement && "steps" in ability.replacement.result) ability.replacement.result.steps.forEach((s) => checkStep(s, needs));
  return needs;
}

export function computeCastOptionNeeds(option: CastOption): string[] {
  // No cast-option kind is executed by the kernel yet (the legacy engine handles miracle/cycling etc.).
  const needs = [`cast_option:${option.kind}`];
  if (!option.optional) addUnique(needs, "cast_option:mandatory");
  if (option.condition) { addUnique(needs, "cast_option:conditional"); checkPredicate(option.condition, needs); }
  if (option.perExtraMode) addUnique(needs, "cast_option:per_extra_mode");
  option.cost.forEach((c) => checkCost(c, needs));
  for (const list of [option.effects?.addSteps, option.effects?.replaceSteps]) list?.forEach((s) => checkStep(s, needs));
  return needs;
}

// Returns a copy of the card with implementation/needs filled on every ability and cast option.
export function computeImplementation(card: Card): Card {
  return {
    ...card,
    abilities: card.abilities.map((a) => {
      const needs = computeAbilityNeeds(a);
      return { ...a, implementation: needs.length ? ("needed" as const) : ("implemented" as const), needs };
    }),
    castOptions: card.castOptions?.map((c) => {
      const needs = computeCastOptionNeeds(c);
      return { ...c, implementation: needs.length ? ("needed" as const) : ("implemented" as const), needs };
    })
  };
}

export function cardNeeds(card: Card): string[] {
  const out: string[] = [];
  for (const a of computeImplementation(card).abilities) a.needs?.forEach((n) => addUnique(out, n));
  card.castOptions?.forEach((c) => computeCastOptionNeeds(c).forEach((n) => addUnique(out, n)));
  return out;
}
