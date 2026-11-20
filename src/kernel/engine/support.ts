// Static capability check: what in a card the ENGINE (not the older capabilities.ts registry) can run today.
// Returns capability names in the same "kind:detail" style as `needs` in the card JSON. resolve() refuses to cast /
// play / activate anything with a non-empty result (strict mode), so nothing is ever silently skipped.

import type { Ability, Cost, Predicate, Quantity, Step } from "../schema";
import { SUPPORTED_FILTER_KEYS } from "./query";
import { META_FIELDS, STEP_FIELDS, SUPPORTED_ENGINE_STEP_KINDS } from "./steps";
import type { CardDef } from "./types";

const PASSIVE_KEYWORDS = new Set([
  "flying", "haste", "vigilance", "trample", "first strike", "double strike", "deathtouch", "lifelink", "reach", "menace",
  "indestructible", "hexproof", "flash", "defender", "shroud", "fear", "intimidate", "unblockable"
]);
const SUPPORTED_PREDICATES = new Set([
  "cast_during", "cast_from", "turn_is", "phase_is", "controls", "life", "zone_count", "did_this_turn", "nth_this_turn", "compare",
  "stat", "matches", "source_state", "step_done", "most_life"
]);
const SUPPORTED_QUANTITY_REFS = new Set(["X", "count", "stat", "counters", "life_lost_this_way", "event_amount", "life_total", "starting_life", "count_this_turn", "greatest", "sum"]);
const SUPPORTED_REFS = new Set(["self", "chosen", "event_object", "created", "iterated"]);
export const SUPPORTED_TRIGGER_EVENTS = new Set(["etb", "dies", "cast", "begin_step"]);
const SUPPORTED_BEGIN_STEPS = new Set(["upkeep", "end_step", "draw", "beginning_of_combat"]);

const add = (out: string[], v: string) => { if (!out.includes(v)) out.push(v); };

function checkFilter(f: object | undefined, out: string[]): void {
  if (!f) return;
  for (const [k, v] of Object.entries(f)) {
    if (!SUPPORTED_FILTER_KEYS.has(k)) add(out, `filter:${k}`);
    if (k === "anyOf") (v as object[]).forEach((s) => checkFilter(s, out));
    if ((k === "mv" || k === "power" || k === "toughness") && v) checkQuantity((v as { value: Quantity }).value, out);
  }
}

function checkQuantity(q: Quantity | undefined, out: string[]): void {
  if (q === undefined || typeof q === "number") return;
  if ("math" in q) { q.args.forEach((a) => checkQuantity(a, out)); return; }
  if (!SUPPORTED_QUANTITY_REFS.has(q.ref)) { add(out, `quantity:${q.ref}`); return; }
  if ("of" in q && typeof q.of === "object") checkFilter(q.of, out);
  if ("filter" in q) checkFilter(q.filter as object | undefined, out);
}

function checkPredicate(p: Predicate | undefined, out: string[]): void {
  if (!p) return;
  if ("all" in p) return p.all.forEach((x) => checkPredicate(x, out));
  if ("any" in p) return p.any.forEach((x) => checkPredicate(x, out));
  if ("not" in p) return checkPredicate(p.not, out);
  if ("unsupported" in p) return add(out, "predicate:unsupported");
  if (!SUPPORTED_PREDICATES.has(p.check)) return add(out, `predicate:${p.check}`);
  if ("filter" in p) checkFilter(p.filter, out);
  if ("cmp" in p && p.cmp) checkQuantity(p.cmp.value, out);
  if (p.check === "compare") checkQuantity(p.left, out);
}

function checkCost(c: Cost, out: string[]): void {
  if ("unsupported" in c) return add(out, "cost:unsupported");
  if ("mana" in c) { if (/\{[^}]*[\/P][^}]*\}/.test(c.mana)) add(out, "cost:hybrid_or_phyrexian"); return; }
  if ("tap" in c) return;
  if ("sacrifice" in c) { if (c.sacrifice !== "self") add(out, "cost:sacrifice_other"); return; }
  if ("life" in c) return checkQuantity(c.life, out);
  if ("counters" in c) return;
  add(out, `cost:${Object.keys(c).find((k) => k !== "prompt" && k !== "src" && k !== "count" && k !== "what")}`);
}

function checkStep(s: Step, out: string[]): void {
  if (!SUPPORTED_ENGINE_STEP_KINDS.has(s.kind)) add(out, `step:${s.kind}`);
  else {
    const allowed = STEP_FIELDS[s.kind];
    for (const k of Object.keys(s)) if (!META_FIELDS.includes(k) && !allowed.includes(k) && !["then", "else", "if"].includes(k)) add(out, `field:${s.kind}.${k}`);
  }
  if (s.unlessPay) add(out, "step:unless_pay");
  if (s.duration !== undefined && s.duration !== "until_end_of_turn") add(out, `duration:${typeof s.duration === "string" ? s.duration : Object.keys(s.duration)[0]}`);
  for (const k of ["amount", "power", "toughness", "tokenCount", "tokenPower", "tokenToughness"]) checkQuantity(s[k] as Quantity | undefined, out);
  checkFilter(s.filter, out);
  for (const k of ["target", "on", "source"]) {
    const v = s[k];
    if (typeof v === "string" && !SUPPORTED_REFS.has(v) && !/^t\d+$/.test(v)) add(out, `ref:${v}`);
  }
  if (s.condition) checkPredicate(s.condition.if, out);
  checkPredicate(s.if, out);
  for (const nested of [s.then, s.else, s.steps]) nested?.forEach((x) => checkStep(x, out));
}

/** Capabilities this one ability needs that the engine lacks. Empty = fully supported. */
export function abilityUnsupported(a: Ability): string[] {
  const out: string[] = [];
  if (a.declined) add(out, "declined");
  if (a.scripted) add(out, `scripted:${a.scripted.handler}`);
  if (a.replacement || a.kind === "replacement") add(out, `replacement:${a.replacement?.event ?? "?"}`);
  if (a.static || a.kind === "static") add(out, "static");
  if (a.kind === "cast_option") add(out, "cast_option");
  if (a.costReduction) add(out, "cost_reduction");
  if (a.keyword && !PASSIVE_KEYWORDS.has(a.keyword.name.toLowerCase())) add(out, `keyword:${a.keyword.name}`);
  if (a.zone && a.zone !== "battlefield" && a.kind !== "spell_effect") add(out, `zone:${a.zone}`);
  if (a.mana?.produces.length && a.mana.produces.length > 1) add(out, "mana:multiple_specs");
  if (a.modes?.repeatRestriction) add(out, "modes:repeat_restriction");
  const t = a.timing;
  if (t?.window) add(out, "timing:window");
  t?.only?.forEach((p) => checkPredicate(p, out));
  a.costs?.forEach((c) => checkCost(c, out));
  a.conditions?.forEach((c) => checkPredicate(c.if, out));
  const tr = a.trigger;
  if (tr) {
    if (!SUPPORTED_TRIGGER_EVENTS.has(tr.event)) add(out, `trigger:${tr.event}`);
    if (tr.event === "begin_step" && !(tr.step && SUPPORTED_BEGIN_STEPS.has(tr.step))) add(out, `trigger:begin_step:${tr.step ?? "?"}`);
    for (const k of ["batch", "fromZone", "toZone", "chapters", "minCount", "defender", "alsoOn"] as const) if (tr[k] !== undefined) add(out, `trigger:${k}`);
    if (tr.nth && (tr.nth.per !== "turn" || tr.event !== "cast")) add(out, "trigger:nth");
    if (tr.subject && typeof tr.subject === "object") checkFilter(tr.subject, out);
    if (tr.subject && typeof tr.subject === "string" && !["self", "you", "opponent", "each_opponent", "each_player"].includes(tr.subject)) add(out, `trigger:subject:${tr.subject}`);
    checkPredicate(tr.interveningIf, out);
  }
  const specs = [...(a.targets ?? []), ...(a.modes?.options.flatMap((o) => o.targets ?? []) ?? [])];
  for (const sp of specs) { if (sp.perOpponent) add(out, "targets:per_opponent"); checkFilter(sp.filter, out); }
  a.steps?.forEach((s) => checkStep(s, out));
  a.modes?.options.forEach((o) => o.steps.forEach((s) => checkStep(s, out)));
  return out;
}

export interface CardSupport { ok: boolean; abilities: Array<{ id: string; needs: string[] }>; castOptions: string[]; all: string[] }

export function cardUnsupported(def: CardDef): CardSupport {
  const abilities = def.kernel.abilities.map((a) => ({ id: a.id, needs: abilityUnsupported(a) }));
  const castOptions = (def.kernel.castOptions ?? []).map((c) => `cast_option:${c.kind}`);
  const all = [...new Set([...abilities.flatMap((a) => a.needs), ...castOptions])];
  return { ok: all.length === 0, abilities, castOptions, all };
}
