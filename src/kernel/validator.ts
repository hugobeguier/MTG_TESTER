// Card validator (spec section 4). Pure and deterministic, no LLM. Given a card's oracle text and a
// draft v2 Card, returns {ok, issues[]}. `ok` means "no errors": it can go to human approval.
// A card needing kernel work (`implementation: "needed"`) is still valid; unsupported *parsing*
// ({unsupported} nodes, declined abilities) is not.

import { computeAbilityNeeds, computeCastOptionNeeds } from "./capabilities";
import {
  costHasX, describeCost, describePredicate, describeQuantity, describeStep, describeTarget,
  promptForCost, stepNeedsPrompt, describeTrigger, describeStatic, describeReplacement, describeCostReduction, describeManaSpec, withCardName
} from "./prompts";
import { CardSchema, type Ability, type Card, type Step, type TargetSpec } from "./schema";

export interface Issue {
  code: string;
  severity: "error" | "warning";
  message: string;
  ability?: string;
  clause?: number;
}
export interface ValidationResult { ok: boolean; issues: Issue[] }

// ------------------------------------------------------------------ normalization

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripReminder(s: string): string {
  return s.replace(/\([^)]*\)/g, " ");
}

/** reminder text stripped, card name -> "~", dashes unified, whitespace collapsed; case kept. */
function normRaw(s: string, name: string): string {
  let t = stripReminder(s);
  const names = [...new Set([name, name.split(",")[0]].filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const n of names) t = t.replace(new RegExp(escapeRe(n), "gi"), "~");
  return t.replace(/[—–]/g, "-").replace(/[ \t]+/g, " ").replace(/ ?- ?/g, (m) => (m.includes(" ") ? " - " : m)).trim();
}

function normLine(s: string, name: string): string {
  return normRaw(s, name).toLowerCase();
}

function linesOf(s: string, name: string): string[] {
  return s.split("\n").map((l) => normRaw(l, name)).filter(Boolean);
}

/** Sentence-level clauses of an ability's text (bullets stay whole). */
export function clausesOf(text: string, name: string): string[] {
  const out: string[] = [];
  for (const line of linesOf(text, name)) {
    if (line.startsWith("•")) { out.push(line); continue; }
    out.push(...line.split(/(?<=[.!?])\s+(?=["“A-Z~•{])/).map((c) => c.trim()).filter(Boolean));
  }
  return out;
}

// ------------------------------------------------------------------ generic walkers

const META_KEYS = new Set(["text", "prompt", "title", "instruction", "src", "srcs", "legacy", "review", "implementation", "needs", "source", "id", "handler"]);

function walk(node: unknown, visit: (key: string | undefined, value: unknown) => void, key?: string): void {
  visit(key, node);
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit, key));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, visit, k);
}

function deepSrcs(node: unknown): Set<number> {
  const out = new Set<number>();
  walk(node, (k, v) => {
    if (k === "src" && typeof v === "number") out.add(v);
    if (k === "srcs" && Array.isArray(v)) v.forEach((n) => typeof n === "number" && out.add(n));
  });
  return out;
}

/** JSON with metadata keys dropped and unsupported conditions removed (they back nothing). */
function cleanJson(node: unknown): string {
  const isUnsupported = (p: unknown) => !!p && typeof p === "object" && "unsupported" in (p as object);
  const clean = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(clean).filter((x) => x !== undefined);
    if (n && typeof n === "object") {
      const o = n as Record<string, unknown>;
      if ("when" in o && "if" in o && isUnsupported(o.if)) return undefined;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) {
        if (META_KEYS.has(k)) continue;
        if ((k === "interveningIf" || k === "while" || k === "condition") && isUnsupported(v)) continue;
        const c = clean(v);
        if (c !== undefined) out[k] = c;
      }
      return out;
    }
    return n;
  };
  return JSON.stringify(clean(node));
}

// ------------------------------------------------------------------ lexicon

/** "its other types", "another player", "each other opponent" are not "another object": drop them before testing. */
function stripNonObjectOther(c: string): string {
  return c
    .replace(/\b(in addition to )?(its|their|his|her) other (card )?(types|colors|abilities)\b/g, " ")
    // "this creature or another Zombie": self is itself one, so a filter without `another` says the same thing
    .replace(/(~|\bthis (creature|permanent|artifact|enchantment|land)) or (another|other)\b/g, " ")
    .replace(/\b(another|each other|every other|any other|an other) (player|opponent)s?\b/g, " ")
    .replace(/\bother (players|opponents)\b/g, " ");
}

/** "power and toughness are each equal to", "each of up to two target creatures" etc. do not mean an each-scope. */
function stripEachFalsePositives(c: string): string {
  return c
    .replace(/\b(power and toughness (are |is )?each equal|each equal to|each equal)\b/g, " ")
    .replace(/\bboth (its )?power and toughness\b/g, " ")
    .replace(/\ball (other )?(abilities|card types|creature types)\b/g, " ")
    .replace(/\beach of (up to )?(one|two|three|four|five|any number of) (other )?targets?\b/g, " ")
    .replace(/\beach of up to (one|two|three|four|five) other target\b/g, " ");
}

interface Lexeme { id: string; test: (clause: string) => boolean; backed: RegExp; hint: string }

const re = (r: RegExp) => (c: string) => r.test(c);
const COND_BACK = /"repeatIf":|"conditions":\[\{|"chosen_is"|"conditional":\{|"condition":\{|"interveningIf"|"while":|"unlessPay"|"kind":"if_else"|"replacement":\{|"ifPaid"|"forAsLongAs"|"only":\[\{|"nth|"limit"|"cast_during"|"mustAttack"/;
const CONDITIONAL_WORDS = "addendum|threshold|delirium|metalcraft|ferocious|formidable|morbid|raid|revolt|hellbent|coven|spell mastery|descend";

function costPart(c: string): string {
  return c.includes(":") ? c.split(":")[0] : "";
}

const LEXICON: Lexeme[] = [
  { id: "if", test: re(/\bif\b|^otherwise\b|\botherwise\b/), backed: COND_BACK, hint: "a condition (conditions[], step.condition, trigger.interveningIf, if_else, replacement)" },
  { id: "unless", test: re(/\bunless\b/), backed: COND_BACK, hint: "a condition or unlessPay" },
  { id: "as long as", test: re(/\bas long as\b/), backed: /"while":|"forAsLongAs"|"conditions":\[\{|"condition":\{/, hint: "static.while / forAsLongAs / castOption.condition" },
  // An ability word ("Ferocious - ...") needs a condition of its own only when the clause does not already spell the condition
  // out with if / unless / as long as (the "if" lexeme then demands it): one condition backs both.
  { id: "conditional word", test: (c) => new RegExp(`^(?:${CONDITIONAL_WORDS}) - `).test(c) && !/\bif\b|\bunless\b|\bas long as\b/.test(c), backed: COND_BACK, hint: "a condition for the ability word" },
  { id: "only", test: re(/\bonly\b/), backed: new RegExp(`"timing":\\{|"restriction":|"abilitiesOf":|${COND_BACK.source}`), hint: "timing.only / timing.limit / mana restriction / a condition" },
  { id: "during", test: re(/\bduring\b/), backed: new RegExp(`"timing":\\{|${COND_BACK.source}`), hint: "a condition or timing.only" },
  { id: "instead", test: re(/\binstead\b|\bwould\b/), backed: /"replacement":\{|"kind":"if_else"|"replaceSteps"|"conditional":\{/, hint: "a replacement ability" },
  { id: "may", test: re(/\bmay\b/), backed: /"optional":true|"extraLandDrops"|"repeatable":true|"choice":"number"/, hint: "optional: true (or modes.repeatable for \"may choose the same mode more than once\")" },
  { id: "up to", test: re(/\bup to\b|\bany number\b/), backed: /"min":0|"upTo":true/, hint: "a count with min 0" },
  // "another"/"other" on an object needs filter.another. Not objects: "its other types", "another player", "each other opponent".
  { id: "another", test: (c) => /\b(another|other)\b/.test(stripNonObjectOther(c)), backed: /"another":true|"excludeSelf"|"excludeWho"/, hint: "filter.another" },
  { id: "target", test: re(/\btarget\b/), backed: /"targets":\[\{|target_player|Scope":"target_player"/, hint: "targets[]" },
  { id: "each", test: (c) => /(?<!for )\b(each|all)\b(?! turn| combat| time)/.test(stripEachFalsePositives(c)), backed: /each_(opponent|player)|"each"|"kind":"vote"|"vote_winners"|destroy_all|mass_pump|mass_bounce|repeat_for_each|fight_pairs|Scope":"(each|all)|"all"|"perOpponent"|"alsoWho"|"alsoOn"|"affects":\{|"extraLandDrops"|"replacement":\{"event":"[a-z_]+","subject":\{/, hint: "an each_* scope, destroy_all/mass_*, repeat_for_each, perOpponent or alsoWho" },
  { id: "duration", test: re(/\buntil end of turn\b|\bthis turn\b|\bfor as long as\b|\buntil your next turn\b/), backed: /"duration"|"until"|forAsLongAs|this_turn|"nth|"limit"|"window"|controllerDealtDamageBy|"turn_is"|"cast_during"|"per":"turn"|"repeatRestriction"|"count_this_turn"|"enteredThisTurn"|"life_gained_this_turn"/, hint: "a duration (or a this-turn condition)" },
  { id: "quantity", test: re(/\bx\b|\bthat many\b|\bequal to\b|\bthe number of\b|\bfor each\b/), backed: /"ref":|"math":|"per":|\{X\}|repeat_for_each|"perOpponent"/, hint: "a Quantity object with ref/math (or repeat_for_each)" },
  { id: "trigger", test: re(/^(?:[a-z' ]+ - )?(when|whenever|at the beginning of)\b/), backed: /"trigger":\{|create_delayed_trigger/, hint: "a trigger" },
  { id: "landfall", test: re(/^landfall - /), backed: /"trigger":\{/, hint: "a trigger" },
  { id: "nth", test: re(/\b(first|second|third|fourth|fifth)\b.{0,40}\beach turn\b|\bsecond spell\b/), backed: /"nth/, hint: "trigger.nth or nth_this_turn" },
  { id: "cost:tap", test: (c) => /\{t\}/.test(costPart(c)), backed: /"tap":"self"/, hint: "costs: [{tap:'self'}]" },
  { id: "cost:sacrifice", test: (c) => /\bsacrifice\b/.test(costPart(c)), backed: /"sacrifice":/, hint: "costs: [{sacrifice}]" },
  { id: "cost:discard", test: (c) => /\bdiscard\b/.test(costPart(c)), backed: /"discard":/, hint: "costs: [{discard}]" },
  { id: "cost:exile", test: (c) => /\bexile\b/.test(costPart(c)), backed: /"exileFrom":/, hint: "costs: [{exileFrom}]" },
  { id: "cost:life", test: (c) => /\bpay \d+ life\b/.test(costPart(c)), backed: /"life":/, hint: "costs: [{life}]" },
  { id: "mana", test: re(/\badd \{/), backed: /"kind":"mana"|add_mana|"produces"/, hint: "kind:'mana' with mana.produces" },
  { id: "cast option", test: re(/^(?:[a-z' ]+ - )?(kicker|multikicker|flashback|escape|miracle|evoke|overload|madness|convoke|gift|escalate)\b/), backed: /"castOptions"/, hint: "a castOptions entry" },
  { id: "keyword", test: re(/^(?:[a-z' ]+ - )?(cycling|channel|equip|enchant)\b/), backed: /"keyword":\{"name":"(cycling|channel|equip|enchant)|"zone":"(hand|graveyard)"|"castOptions"/, hint: "a keyword or zone-ed ability" }
];

// ------------------------------------------------------------------ units (steps / modes) for clause scoping

interface Unit { json: string; srcs: Set<number> }

function unitsOf(ability: Ability): Unit[] {
  const units: Unit[] = [];
  for (const s of ability.steps ?? []) units.push({ json: cleanJson(s), srcs: deepSrcs(s) });
  for (const o of ability.modes?.options ?? []) units.push({ json: cleanJson(o), srcs: deepSrcs(o) });
  return units;
}

function structuralJson(ability: Ability, card: Card): string {
  const rest: Record<string, unknown> = { ...ability };
  delete rest.steps;
  if (ability.modes) rest.modes = { choose: ability.modes.choose, distinct: ability.modes.distinct, repeatable: ability.modes.repeatable, optionCount: ability.modes.options.length };
  return cleanJson({ ...rest, castOptions: card.castOptions });
}

// ------------------------------------------------------------------ the validator

const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100
};
const NUMBER_WORD_RE = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b`, "g");
const MEANINGFUL_NUM_KEYS = new Set(["loyalty", "amount", "lifeDelta", "power", "toughness", "tokenCount", "tokenPower", "tokenToughness", "moveCount", "value", "count", "delta", "energy", "life"]);

function textNumbers(text: string): { plain: number[]; generic: number[]; symbols: string[] } {
  const symbols = [...text.matchAll(/\{([^}]+)\}/g)].map((m) => m[1].toUpperCase());
  const stripped = text.replace(/\{[^}]*\}/g, " ");
  const plain = [...stripped.matchAll(/\d+/g)].map((m) => Number(m[0]));
  for (const m of stripped.toLowerCase().matchAll(NUMBER_WORD_RE)) plain.push(NUMBER_WORDS[m[1]]);
  // "half" / "twice" imply a divisor / multiplier of 2
  for (const _m of stripped.toLowerCase().matchAll(/\b(half|twice)\b/g)) plain.push(2);
  const generic = symbols.filter((s) => /^\d+$/.test(s)).map(Number);
  return { plain, generic, symbols: symbols.filter((s) => s !== "T" && s !== "Q") };
}

function jsonLiterals(card: Card): { all: Set<number>; meaningful: number[]; symbols: Set<string> } {
  const all = new Set<number>();
  const meaningful: number[] = [];
  const symbols = new Set<string>();
  const visit = (node: unknown, key?: string) => {
    if (typeof node === "number") {
      all.add(Math.abs(node));
      if (key && MEANINGFUL_NUM_KEYS.has(key)) meaningful.push(Math.abs(node));
    } else if (typeof node === "string") {
      for (const m of node.matchAll(/\{([^}]+)\}/g)) symbols.add(m[1].toUpperCase());
      // a counter kind such as "+1/+1" / "-1/-1" states its numbers
      for (const m of node.matchAll(/^[+\-\u2212]?(\d+)\/[+\-\u2212]?(\d+)$/g)) { all.add(Number(m[1])); all.add(Number(m[2])); }
    } else if (Array.isArray(node)) node.forEach((n) => visit(n, key));
    else if (node && typeof node === "object") {
      // predicate mana_spent {color:"W"} stands for the symbol {W} of the oracle text
      if ((node as { check?: string }).check === "mana_spent" && typeof (node as { color?: string }).color === "string") symbols.add((node as { color: string }).color.toUpperCase());
      for (const [k, v] of Object.entries(node)) if (!META_KEYS.has(k)) visit(v, k);
    }
  };
  visit({ abilities: card.abilities, castOptions: card.castOptions });
  return { all, meaningful, symbols };
}

function allSteps(ability: Ability): Step[] {
  const out: Step[] = [];
  const rec = (s: Step) => { out.push(s); for (const k of ["then", "else", "steps"] as const) s[k]?.forEach(rec); };
  ability.steps?.forEach(rec);
  ability.modes?.options.forEach((o) => o.steps.forEach(rec));
  if (ability.replacement && "steps" in ability.replacement.result) ability.replacement.result.steps.forEach(rec);
  return out;
}

const CAST_WORDS = ["kicker", "multikicker", "flashback", "escape", "miracle", "evoke", "overload", "madness", "convoke", "gift", "escalate"];

export function validateCard(cardInput: unknown, oracleText: string, cardName: string): ValidationResult {
  const issues: Issue[] = [];
  const err = (code: string, message: string, extra: Partial<Issue> = {}) => issues.push({ code, severity: "error", message, ...extra });
  const warn = (code: string, message: string, extra: Partial<Issue> = {}) => issues.push({ code, severity: "warning", message, ...extra });
  const done = (): ValidationResult => ({ ok: !issues.some((i) => i.severity === "error"), issues });

  const parsed = CardSchema.safeParse(cardInput);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 20)) err("SCHEMA", `${i.path.join(".")}: ${i.message}`);
    return done();
  }
  const card = parsed.data as Card;
  const ignored = new Set((card.review?.ignore ?? []).map((i) => i.lexeme));

  // ---- 3. every oracle line is claimed by an ability (or cast option)
  const oracleLines = oracleText.split("\n").map((l) => normLine(l, cardName)).filter(Boolean);
  const abilityLines = card.abilities.flatMap((a) => linesOf(a.text, cardName).map((l) => l.toLowerCase()));
  const abilityFull = card.abilities.map((a) => linesOf(a.text, cardName).join(" ").toLowerCase());
  const keywordNames = card.abilities.map((a) => a.keyword?.name.toLowerCase()).filter(Boolean) as string[];
  const claims = (piece: string): boolean =>
    abilityFull.some((f) => f.includes(piece)) ||
    abilityLines.some((l) => l.length >= piece.length * 0.5 && piece.includes(l)) ||
    keywordNames.includes(piece);
  for (const line of oracleLines) {
    if (claims(line)) continue;
    const first = line.split(/[\s{-]/)[0];
    if (CAST_WORDS.includes(first) && card.castOptions?.some((c) => c.kind === first)) continue;
    const pieces = line.split(/,\s*/);
    if (pieces.length > 1 && pieces.every(claims)) continue;
    err("LINE_UNCLAIMED", `Oracle line is not claimed by any ability: "${line}"`);
  }
  for (const a of card.abilities) {
    for (const l of linesOf(a.text, cardName).map((x) => x.toLowerCase())) {
      if (!oracleLines.some((o) => o.includes(l) || l.includes(o))) warn("TEXT_NOT_IN_ORACLE", `Ability text not found in oracle: "${l}"`, { ability: a.id });
    }
  }

  const cardSteps: Step[] = [
    ...card.abilities.flatMap(allSteps),
    ...(card.castOptions ?? []).flatMap((o) => [...(o.effects?.addSteps ?? []), ...(o.effects?.replaceSteps ?? [])])
  ];

  // ---- per ability
  for (const a of card.abilities) {
    const aErr = (code: string, message: string, clause?: number) => err(code, message, { ability: a.id, clause });
    const clauses = clausesOf(a.text, cardName);
    const units = unitsOf(a);
    const structural = structuralJson(a, card);
    const srcSet = deepSrcs(a);
    const strict = srcSet.size > 0;

    // 4. clause coverage
    if (strict) {
      clauses.forEach((c, i) => { if (!srcSet.has(i)) aErr("CLAUSE_UNCOVERED", `Clause ${i} not covered by any step/condition/mode (src): "${c}"`, i); });
      for (const s of srcSet) if (s >= clauses.length) aErr("SRC_OUT_OF_RANGE", `src ${s} but the ability text has only ${clauses.length} clause(s)`);
    } else if (["spell_effect", "activated", "triggered"].includes(a.kind) && !a.modes && clauses.length > Math.max(1, a.steps?.length ?? 0) && !a.declined) {
      warn("CLAUSE_COUNT", `${clauses.length} sentences but ${a.steps?.length ?? 0} steps; add src indices to prove coverage`, { ability: a.id });
    }

    // 5. lexicon
    clauses.forEach((clause, i) => {
      const lc = clause.toLowerCase();
      const scope = structural + (strict ? units.filter((u) => u.srcs.has(i)).map((u) => u.json).join("") : units.map((u) => u.json).join(""));
      for (const lx of LEXICON) {
        if (ignored.has(lx.id) || !lx.test(lc)) continue;
        if (!lx.backed.test(scope)) aErr("LEXEME_UNBACKED", `Clause ${i} "${clause}" says "${lx.id}" but no field backs it. Expected ${lx.hint}.`, i);
      }
    });

    // modes
    const modeText = clauses.join(" ").toLowerCase();
    const modeRe = /\bchoose (one or both|one or more|one|two|three|four|five|up to (?:one|two|three|four|five)|any number)\b/g;
    let modeMatch: RegExpExecArray | null = null;
    for (let m = modeRe.exec(modeText); m; m = modeRe.exec(modeText)) {
      // a modal header continues with a dash, a period or "that ..."; "choose two target creature cards" is a target phrase
      if (/^\s*([—–:-]|\.|,|that\b|$)/.test(modeText.slice(m.index + m[0].length))) { modeMatch = m; break; }
    }
    if (modeMatch) {
      if (!a.modes) aErr("MODE_MISMATCH", `Text says "choose ${modeMatch[1]}" but the ability has no modes`);
      else {
        const w = modeMatch[1];
        const n = a.modes.options.length;
        const num = (s: string) => ({ one: 1, two: 2, three: 3, four: 4, five: 5 } as Record<string, number>)[s] ?? 1;
        const expected = w === "one or both" ? { min: 1, max: 2 } : w === "one or more" ? { min: 1, max: n } : w === "any number" ? { min: 0, max: n } : w.startsWith("up to") ? { min: 0, max: num(w.split(" ")[2]) } : { min: num(w), max: num(w) };
        if (a.modes.choose.min !== expected.min || a.modes.choose.max !== expected.max) aErr("MODE_MISMATCH", `Text says "choose ${w}" (min ${expected.min}, max ${expected.max}) but modes.choose is ${a.modes.choose.min}..${a.modes.choose.max}`);
        const sameMode = /same mode more than once/.test(modeText);
        if (sameMode && !a.modes.repeatable) aErr("MODE_MISMATCH", `Text says you may choose the same mode more than once but modes.repeatable is not true`);
        if (!sameMode && a.modes.repeatable) aErr("MODE_MISMATCH", `modes.repeatable is true but the text does not allow choosing the same mode more than once`);
        if (a.modes.repeatable && a.modes.distinct) aErr("MODE_MISMATCH", `modes.repeatable and modes.distinct cannot both be true`);
        const bullets = linesOf(a.text, cardName).filter((l) => l.startsWith("•")).length;
        if (bullets && bullets !== n) aErr("MODE_MISMATCH", `Text has ${bullets} bullet modes but modes.options has ${n}`);
      }
    }

    // 7. structural lint
    if (a.kind === "triggered" && !a.trigger) aErr("STRUCT_TRIGGER_MISSING", "kind 'triggered' needs a trigger");
    if (a.kind === "replacement" && !a.replacement) aErr("STRUCT_REPLACEMENT_MISSING", "kind 'replacement' needs a replacement");
    if (a.kind === "static" && !a.static && !a.costReduction && !a.declined) aErr("EMPTY_ABILITY", "static ability has no `static` spec");
    if (a.kind === "mana") {
      if (a.targets?.length) aErr("STRUCT_MANA_TARGETS", "mana abilities cannot have targets");
      if (!a.mana && !allSteps(a).some((s) => s.kind === "add_mana")) aErr("STRUCT_MANA_MISSING", "kind 'mana' needs mana.produces");
    }
    if (a.modes) for (const o of a.modes.options) if (!o.steps.length) aErr("STRUCT_MODE_EMPTY", `mode option ${o.id} has no steps`);
    if (["spell_effect", "activated", "triggered"].includes(a.kind) && !a.declined) {
      const hasContent = a.steps?.length || a.modes || a.replacement || a.static || a.mana || a.scripted || a.keyword;
      if (!hasContent) aErr("EMPTY_ABILITY", `${a.kind} ability has no steps, modes or other effect`);
    }
    if (a.declined) aErr("DECLINED_ABILITY", "ability is declined (no deterministic outcome)");

    // a granted ability ("grantAbility": {...targets...}) is its own scope: its steps refer to ITS targets, not to the granting ability's
    const refCheck = (node: unknown, declared: Set<string>, where: string): void => {
      const go = (n: unknown, k: string | undefined, decl: Set<string>): void => {
        if (typeof n === "string") { if (/^td+$/.test(n) && k !== "id" && !decl.has(n)) aErr("STRUCT_UNDECLARED_TARGET", `${where} references ${n} which is not declared in targets`); return; }
        if (Array.isArray(n)) { n.forEach((x) => go(x, k, decl)); return; }
        if (n && typeof n === "object") for (const [kk, vv] of Object.entries(n)) {
          if (kk === "grantAbility" && vv && typeof vv === "object") go(vv, kk, new Set(((vv as { targets?: Array<{ id: string }> }).targets ?? []).map((t) => t.id)));
          else go(vv, kk, decl);
        }
      };
      go(node, undefined, declared);
    };
    const declared = new Set((a.targets ?? []).map((t) => t.id));
    const { modes, ...rest } = a;
    refCheck(rest, declared, "ability");
    for (const o of modes?.options ?? []) refCheck(o, new Set([...declared, ...(o.targets ?? []).map((t) => t.id)]), `mode ${o.id}`);
    // 'chosen' (an object picked by a choose step) may be saved by a choose step in ANY ability of the card
    // (e.g. an "as this enters" replacement), as may a remembered option (chosenType / chosenColor / chosen_is).
    const usesChosen = (() => { let used = false; walk(a, (k, v) => { if (v === "chosen" && k !== "saveAs") used = true; }); return used; })();
    if (usesChosen && !cardSteps.some((s) => s.kind === "choose" && s.saveAs === "chosen")) aErr("STRUCT_CHOSEN_UNDEFINED", "'chosen' is used but no choose step in the card saves it (saveAs: 'chosen')");
    const remembered = (kind: string) => cardSteps.some((s) => s.kind === "choose" && s.remember === true && s.choice === kind);
    const json = JSON.stringify({ ...a, text: undefined });
    if (/"chosenType":true/.test(json) && !remembered("creature_type")) aErr("STRUCT_CHOSEN_UNDEFINED", "filter.chosenType is used but no choose step (choice: 'creature_type', remember: true) in the card remembers a type");
    if (/"chosenColor":/.test(json) && !remembered("color")) aErr("STRUCT_CHOSEN_UNDEFINED", "chosenColor is used but no choose step (choice: 'color', remember: true) in the card remembers a color");
    walk(a, (_k, v) => {
      if (v && typeof v === "object" && (v as { check?: string }).check === "chosen_is") {
        const kind = (v as { kind: string }).kind;
        if (!remembered(kind)) aErr("STRUCT_CHOSEN_UNDEFINED", `chosen_is (${kind}) is used but no choose step (choice: '${kind}', remember: true) in the card remembers it`);
      }
      if (v && typeof v === "object" && (v as { check?: string }).check === "step_done") {
        const id = (v as { step: string }).step;
        if (!allSteps(a).some((st) => st.id === id)) aErr("STRUCT_STEP_REF", `step_done refers to step id '${id}' which does not exist in this ability`);
      }
    });

    // unsupported nodes
    let unsupportedFound = false;
    walk({ ...a, text: undefined }, (k, v) => { if (k === "unsupported" && typeof v === "string") unsupportedFound = true; });
    if (unsupportedFound) aErr("UNSUPPORTED_NODE", "contains an {unsupported} node (free-text condition/cost the schema cannot express); expand the vocabulary or rewrite");

    // implementation flag consistency
    const needs = computeAbilityNeeds(a);
    const expect = needs.length ? "needed" : "implemented";
    if (a.implementation === undefined) warn("IMPLEMENTATION_MISSING", "implementation not set; run computeImplementation", { ability: a.id });
    else if (a.implementation !== expect || JSON.stringify(a.needs ?? []) !== JSON.stringify(needs)) warn("IMPLEMENTATION_STALE", `implementation/needs out of date (expected ${expect}: ${needs.join(", ") || "-"})`, { ability: a.id });

    // prompts (0b)
    const needPrompt = (has: unknown, what: string) => { if (!has) aErr("PROMPT_MISSING", `${what} has no prompt`); };
    const checkTargets = (list: TargetSpec[] | undefined, where: string) => list?.forEach((t) => needPrompt(t.prompt, `${where} target ${t.id}`));
    checkTargets(a.targets, "ability");
    if (a.modes) { needPrompt(a.modes.prompt, "modes"); a.modes.options.forEach((o) => checkTargets(o.targets, `mode ${o.id}`)); }
    if (a.optional) needPrompt(a.prompt, "ability 'may'");
    for (const s of allSteps(a)) {
      if (stepNeedsPrompt(s)) needPrompt(s.prompt, `step ${s.kind}${s.optional ? " (optional)" : ""}`);
      if (s.unlessPay) needPrompt(s.unlessPay.prompt, `step ${s.kind} unlessPay`);
    }
    for (const c of a.costs ?? []) if (promptForCost(cardName, c)) needPrompt(c.prompt, `cost ${describeCost(c)}`);
    if (a.costs?.some(costHasX)) needPrompt(a.xPrompt, "X cost (xPrompt)");
    if (a.replacement?.optional) needPrompt(a.replacement.prompt, "optional replacement");
  }

  for (const o of card.castOptions ?? []) {
    if (!o.prompt) err("PROMPT_MISSING", `cast option ${o.id} (${o.kind}) has no prompt`);
    if (JSON.stringify(o).includes('"unsupported"')) err("UNSUPPORTED_NODE", `cast option ${o.id} contains an {unsupported} node`);
    const needs = computeCastOptionNeeds(o);
    if (o.implementation !== undefined && JSON.stringify(o.needs ?? []) !== JSON.stringify(needs)) warn("IMPLEMENTATION_STALE", `cast option ${o.id} needs out of date`);
  }

  // ---- 6. literal cross-check (card level)
  // A PURE scripted stub (scripted marker, no steps/modes/static/replacement/mana/keyword parameter) says "the engine
  // implements this line"; its own numbers and symbols are the handler's business, so they are exempt here. Everything else must
  // be encoded. Use scripted.params (counted) when a marker should carry a number.
  const isPureStub = (a: Ability) => !!a.scripted && !a.steps?.length && !a.modes && !a.static && !a.replacement && !a.mana && a.keyword?.param === undefined;
  const stubLines = new Set(card.abilities.filter(isPureStub).flatMap((a) => linesOf(a.text, cardName).map((l) => l.toLowerCase())));
  const oracleClean = oracleText.split("\n").map((l) => normRaw(l, cardName)).filter((l) => !stubLines.has(l.toLowerCase())).join("\n");
  const litIgnored = (token: string) => ignored.has("literal") || ignored.has(`literal:${token}`);
  const t = textNumbers(oracleClean);
  const j = jsonLiterals(card);
  // "+1/+1 for each X": the 1s are the pump's sign/size, not a quantity, when the card's power/toughness is a Quantity
  const pumpOnly = (n: number) => {
    const withoutPump = textNumbers(oracleClean.replace(/[+\-\u2212]\d+\/[+\-\u2212]\d+/g, " "));
    return !withoutPump.plain.includes(n);
  };
  const hasQuantityPT = /"(power|toughness)":\{/.test(JSON.stringify(card.abilities));
  for (const n of new Set(t.plain)) {
    if (j.all.has(n) || litIgnored(String(n))) continue;
    if (n === 1 && hasQuantityPT && pumpOnly(1)) continue;
    err("LITERAL_MISMATCH", `Oracle text contains the number ${n} but no field in the card has it`);
  }
  const textMulti = new Map<number, number>();
  // ordinals ("third turn") may account for a JSON number but never demand one
  const ORD: Record<string, number> = { second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
  const ordinals = [...oracleClean.toLowerCase().matchAll(new RegExp(`\\b(${Object.keys(ORD).join("|")})\\b`, "g"))].map((m) => ORD[m[1]]);
  for (const n of [...t.plain, ...t.generic, ...ordinals]) textMulti.set(n, (textMulti.get(n) ?? 0) + 1);
  const jsonMulti = new Map<number, number>();
  for (const n of j.meaningful) if (n > 1) jsonMulti.set(n, (jsonMulti.get(n) ?? 0) + 1);
  for (const [n, c] of jsonMulti) {
    if ((textMulti.get(n) ?? 0) < c && !litIgnored(String(n))) err("LITERAL_MISMATCH", `The card uses the number ${n} ${c} time(s) in effects but the oracle text only has it ${textMulti.get(n) ?? 0} time(s)`);
  }
  for (const s of new Set(t.symbols)) {
    if (j.symbols.has(s)) continue;
    if (/^\d+$/.test(s) && j.all.has(Number(s))) continue;
    if (litIgnored(`{${s}}`)) continue;
    // "costs {X} less, where X is ...": the {X} is the Quantity in costReduction.amount
    if (s === "X" && card.abilities.some((a) => a.costReduction && typeof a.costReduction.amount !== "number")) continue;
    err("LITERAL_MISMATCH", `Oracle text has mana symbol {${s}} that no cost/mana field contains`);
  }
  const rawSymbols = new Set([...oracleText.matchAll(/\{([^}]+)\}/g)].map((m) => m[1].toUpperCase()));
  for (const s of j.symbols) {
    // reminder text counts here: a basic land's whole mana ability is "({T}: Add {U}.)"
    if (s !== "T" && s !== "Q" && !t.symbols.includes(s) && !rawSymbols.has(s) && !litIgnored(`{${s}}`)) err("LITERAL_MISMATCH", `The card has mana symbol {${s}} that the oracle text does not`);
  }

  return done();
}

// ------------------------------------------------------------------ 8. plain-English re-render

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function describeTriggerSpec(a: Ability): string {
  return describeTrigger(a.trigger!);
}

function renderSteps(steps: Step[], targets: Map<string, TargetSpec>): string {
  return steps.map((s, i) => {
    let d = describeStep(s, targets);
    if (s.optional) d = `you may ${d}`;
    if (s.unlessPay) {
      const payer = s.unlessPay.payer === "you" ? "you" : s.unlessPay.payer.replace(/_/g, " ");
      const manaOnly = s.unlessPay.cost.every((c) => "mana" in c);
      d += ` unless ${payer} ${manaOnly ? (payer === "you" ? "pay" : "pays") : ""} ${s.unlessPay.cost.map(describeCost).join(" and ")}${s.unlessPay.x !== undefined ? ` (X = ${describeQuantity(s.unlessPay.x)})` : ""}`.replace(/  +/g, " ");
    }
    if (s.condition) d = `IF ${describePredicate(s.condition.if)}: ${d}`;
    return `${i === 0 ? "" : "Then, "}${i === 0 ? cap(d) : d}.`;
  }).join(" ");
}

/** Human-approval rendering: oracle clause next to what the structured data actually says. */
export function renderForApproval(card: Card, cardName: string): string {
  return withCardName(cardName, () => renderForApprovalFor(card, cardName));
}

function renderForApprovalFor(card: Card, cardName: string): string {
  const out: string[] = [`${cardName} [${card.review?.status ?? "draft"}]`];
  for (const o of card.castOptions ?? []) {
    out.push(`  Cast option ${o.id}: you may use ${o.kind} (from ${o.from}, cost ${o.cost.map(describeCost).join(", ")}${o.replacesManaCost ? ", replaces mana cost" : ""}) [${o.implementation ?? "?"}]`);
  }
  for (const a of card.abilities) {
    out.push(`  [${a.id}] ${a.kind}${a.zone && a.zone !== "battlefield" ? ` (from ${a.zone})` : ""} [${a.implementation ?? "?"}${a.needs?.length ? `: needs ${a.needs.join(", ")}` : ""}]`);
    out.push(`    Oracle: ${a.text.replace(/\n/g, " / ")}`);
    if (a.trigger) out.push(`    Trigger: ${describeTriggerSpec(a)}`);
    if (a.costs?.length) out.push(`    Cost: ${a.costs.map(describeCost).join(", ")}`);
    if (a.timing) out.push(`    Timing: ${[a.timing.speed, a.timing.limit ? `${a.timing.limit.count} per ${a.timing.limit.per}` : "", ...(a.timing.only ?? []).map(describePredicate)].filter(Boolean).join("; ")}`);
    for (const c of a.conditions ?? []) out.push(`    Condition (${c.when}): ${describePredicate(c.if)}`);
    const tm = new Map<string, TargetSpec>((a.targets ?? []).map((x) => [x.id, x]));
    for (const x of a.targets ?? []) out.push(`    Target ${x.id}: ${describeTarget(x)}${x.prompt ? `  <- prompt: "${x.prompt.instruction}"` : ""}`);
    if (a.modes) {
      out.push(`    Modes: choose ${a.modes.choose.min === a.modes.choose.max ? a.modes.choose.min : `${a.modes.choose.min}-${a.modes.choose.max}`}${a.modes.repeatable ? " (the same mode may be chosen more than once)" : ""}${a.modes.prompt ? `  <- prompt: "${a.modes.prompt.instruction}"` : ""}`);
      for (const o of a.modes.options) {
        const om = new Map([...tm, ...(o.targets ?? []).map((x) => [x.id, x] as [string, TargetSpec])]);
        out.push(`      - ${renderSteps(o.steps, om)}${o.targets?.map((x) => ` (target: ${describeTarget(x)})`).join("") ?? ""}`);
      }
    }
    if (a.steps?.length) out.push(`    Effect: ${renderSteps(a.steps, tm)}`);
    if (a.replacement) out.push(`    Replacement: ${describeReplacement(a.replacement)}`);
    if (a.scripted) out.push(`    Scripted (engine-specific rule, not described by the fields above): ${a.scripted.handler}`);
    if (a.mana) out.push(`    Mana: add ${a.mana.produces.map(describeManaSpec).join(" and ")}`);
    if (a.costReduction) out.push(`    Cost reduction: this ability ${describeCostReduction(a.costReduction)}`);
    if (a.static) out.push(`    Static: ${describeStatic(a.static)}`);
    if (a.keyword) out.push(`    Keyword: ${a.keyword.name}${a.keyword.param !== undefined ? ` ${a.keyword.param}` : ""}`);
    if (a.optional) out.push(`    (optional: ${a.prompt?.instruction ?? "no prompt"})`);
    if (a.xPrompt) out.push(`    X prompt: "${a.xPrompt.instruction}"`);
  }
  return out.join("\n");
}
