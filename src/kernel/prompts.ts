// Deterministic player-prompt + English description generator (Phase 0b). Everything here is
// built from structured fields only, never free LLM text, so prompts are consistent and correct.
// Also used by the validator's plain-English re-render.

import type {
  Ability, Card, CastOption, Cmp, Cost, ManaSpec, Modes, ObjectFilter, Predicate, Prompt, Quantity, Step, TargetSpec
} from "./schema";

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
export function numberWord(n: number): string {
  return Number.isInteger(n) && n >= 0 && n <= 20 ? WORDS[n] : String(n);
}

// The name of the card whose text is being rendered, so "self" reads "Grave Titan" instead of "this permanent".
// Set by the callers that render one card at a time (generatePrompts, renderForApproval, the approval script);
// anything else falls back to the generic wording.
let currentCardName: string | undefined;
export function setRenderCardName(name: string | undefined): void { currentCardName = name; }
export function withCardName<T>(name: string, fn: () => T): T {
  const prev = currentCardName;
  currentCardName = name;
  try { return fn(); } finally { currentCardName = prev; }
}
/** "this permanent" or the card's own name. */
export function selfName(): string { return currentCardName ?? "this permanent"; }
/** possessive: "Grave Titan's" / "this permanent's" */
function selfPoss(): string { return `${selfName()}'s`; }

const IRREGULAR_PLURALS: Record<string, string> = {
  fish: "fish", sheep: "sheep", deer: "deer", moose: "moose", djinn: "djinn", elk: "elk", salamander: "salamanders",
  mouse: "mice", fungus: "fungi", cyclops: "cyclopes", homunculus: "homunculi", octopus: "octopuses", ox: "oxen",
  wolf: "wolves", werewolf: "werewolves", dwarf: "dwarves", thief: "thieves", elf: "elves", knife: "knives", leaf: "leaves",
  goblin: "goblins", human: "humans", "time lord": "time lords", "dragon": "dragons"
};

function plural(noun: string): string {
  // pluralize the last word only: "artifact creature" -> "artifact creatures", "Time Lord" -> "Time Lords"
  const m = /^(.*?)(\S+)$/.exec(noun);
  if (m && m[1]) return `${m[1]}${plural(m[2])}`;
  const irregular = IRREGULAR_PLURALS[noun.toLowerCase()];
  if (irregular) return noun.charAt(0) === noun.charAt(0).toUpperCase() && noun !== noun.toLowerCase() ? irregular.charAt(0).toUpperCase() + irregular.slice(1) : irregular;
  if (/(s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

function list(items: string[], joiner: "or" | "and" = "or"): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} ${joiner} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${joiner} ${items[items.length - 1]}`;
}

function lc(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

// ------------------------------------------------------------------ quantities / comparisons

export function describeQuantity(q: Quantity): string {
  if (typeof q === "number") return String(q);
  if ("math" in q) {
    const args = q.args.map(describeQuantity);
    if (q.math === "min" || q.math === "max") return `the ${q.math === "min" ? "lesser" : "greater"} of ${args.join(" and ")}`;
    if (q.math === "div_down" || q.math === "div_up") return `${args[0]} divided by ${args[1]}, rounded ${q.math === "div_down" ? "down" : "up"}`;
    return args.join(` ${q.math === "*" ? "x" : q.math} `);
  }
  switch (q.ref) {
    case "X": return "X";
    case "count": return `the number of ${describeFilter(q.of, { plural: true })}`;
    case "devotion": return Array.isArray(q.color) ? `your devotion to ${q.color.join(" and ")} (one count of symbols of ${list(q.color)}; a hybrid symbol counts once)` : `your devotion to ${q.color}`;
    case "opponents_count": return "the number of opponents you have";
    case "step_result": return `the number affected this way (${q.step})`;
    case "step_count": return `the number of times (${q.step}) was performed`;
    case "life_gained_this_turn": return `the amount of life ${q.who === "you" ? "you have" : `${playerName(q.who)} has`} gained this turn`;
    case "stat": return `${refName(q.of)}'s ${q.stat.replace(/_/g, " ")}`;
    case "counters": return `the number of ${q.kind} counters on ${q.on === "you" ? "you" : q.on}`;
    case "life_lost_this_way": return "the life lost this way";
    case "event_amount": return "that many";
    case "commander_colors": return "the number of colors in your commanders' color identity";
    case "greatest": return `the greatest ${q.stat.replace(/_/g, " ")} among ${describeFilter(q.of, { plural: true })}`;
    case "sum": return `the total ${q.stat.replace(/_/g, " ")} of ${describeFilter(q.of, { plural: true })}`;
    case "life_total": return q.who === "you" ? "your life total" : `${playerName(q.who)}'s life total`;
    case "starting_life": return "your starting life total";
    case "count_this_turn": return `the number of ${q.filter ? describeFilter(q.filter, { plural: true }) : "things"} that ${q.event.replace(/_/g, " ")} this turn`;
    case "damage_taken_this_turn": return `the damage dealt to ${playerName(q.who)} this turn`;
    case "saved_count": return `the number of those cards still in ${q.zone ?? "exile"}`;
    case "players_count": return `the number of ${q.who === "each_opponent" ? "opponents" : "players"} for which ${describePredicate(q.where)}`;
  }
}

const PHASE_NOUN: Record<string, string> = {
  untap: "untap step", upkeep: "upkeep step", draw: "draw step", main: "main phase", precombat_main: "first main phase", postcombat_main: "second main phase", beginning_of_combat: "beginning of combat step",
  combat: "combat phase", declare_attackers: "declare attackers step", declare_blockers: "declare blockers step",
  combat_damage: "combat damage step", end_of_combat: "end of combat step", end_step: "end step", cleanup: "cleanup step"
};

function playerName(p: string): string {
  switch (p) {
    case "you": return "you";
    case "opponent": return "an opponent";
    case "gift_recipient": return "the opponent who received the gift";
    case "each_opponent": return "each opponent";
    case "each_player": return "each player";
    case "target_player": return "target player";
    case "controller_of_target": return "its controller";
    case "owner_of_target": return "its owner";
    default: return "that player";
  }
}

function describeCmp(c: Cmp): string {
  const v = describeQuantity(c.value);
  const num = typeof c.value === "number";
  switch (c.op) {
    case "<=": return num ? `${v} or less` : `less than or equal to ${v}`;
    case ">=": return num ? `${v} or greater` : `greater than or equal to ${v}`;
    case "=": return v;
    case "<": return `less than ${v}`;
    case ">": return `greater than ${v}`;
  }
}

// ------------------------------------------------------------------ object filters

export interface FilterOptions {
  plural?: boolean;
  /** omit the leading "another/other" (target phrasing puts it before the word "target") */
  skipAnother?: boolean;
  /** describe the object as a spell (types become adjectives: "artifact spell", "noncreature spell") */
  spell?: boolean;
}

/** "a"/"an" in front of a noun phrase. */
export function withArticle(phrase: string): string {
  return /^[aeiou]/i.test(phrase) ? `an ${phrase}` : `a ${phrase}`;
}

/** How a card/object reference reads in prose ("self" -> "this permanent"). */
export function refName(ref: string, targets?: Map<string, TargetSpec>): string {
  if (targets?.has(ref)) return describeTarget(targets.get(ref)!);
  switch (ref) {
    case "self": return selfName();
    case "event_object": return "that object";
    case "sacrificed": return "the sacrificed permanent";
    case "created": return "the token just created";
    case "iterated": return "that object";
    case "chosen": return "the chosen object";
    case "equipped": return "the equipped creature";
    case "enchanted": return "the enchanted creature";
    case "linked_exile": return `the card exiled with ${selfName()}`;
    case "rest_of_looked_cards": return "the rest of the looked-at cards";
    default: return ref;
  }
}

export function describeFilter(f: ObjectFilter, opts: FilterOptions = {}): string {
  if (f.anyOf?.length) {
    const suffix = f.controller === "you" ? " you control" : f.controller === "opponent" ? " an opponent controls" : "";
    return `${list(f.anyOf.map((g) => describeFilter(g, opts)))}${suffix}`;
  }
  const adjectives: string[] = [];
  if (f.another && !opts.skipAnother) adjectives.push(opts.plural ? "other" : "another");
  if (f.colored === true) adjectives.push("colored");
  if (f.colored === false) adjectives.push("colorless");
  if (f.tapped === true) adjectives.push("tapped");
  if (f.tapped === false) adjectives.push("untapped");
  if (f.attacking) adjectives.push("attacking");
  if (f.blocking) adjectives.push("blocking");
  if (f.enteredThisTurn) adjectives.push("that entered this turn");
  if (f.isCommander) adjectives.push("commander");

  for (const t of f.notTypes ?? []) adjectives.push(`non${t.toLowerCase()}`);
  for (const t of f.notSubtypes ?? []) adjectives.push(`non-${t}`);
  for (const t of f.notSupertypes ?? []) adjectives.push(`non${t.toLowerCase()}`);
  for (const t of f.supertypes ?? []) adjectives.push(t.toLowerCase());
  for (const c of f.colors ?? []) adjectives.push(c.toLowerCase());
  for (const c of f.notColors ?? []) adjectives.push(`non${c.toLowerCase()}`);
  if (f.chosenColor) adjectives.push("of the chosen color");
  if (f.token === true) adjectives.push("token");
  if (f.token === false) adjectives.unshift("nontoken");

  const spell = opts.spell || f.zone === "stack";
  const typeWords = (f.types ?? []).filter((t) => !(spell && t.toLowerCase() === "spell")).map((t) => t.toLowerCase());
  let noun: string;
  if (spell) {
    // "creature spell", "noncreature spell": the types describe the spell
    adjectives.push(...typeWords, ...(f.subtypes ?? []));
    noun = "spell";
  } else if (f.subtypes?.length) noun = list(f.subtypes);
  // several types on one filter all apply ("artifact creature"); alternatives are written with anyOf
  else if (typeWords.length) noun = typeWords.join(" ");
  else noun = !f.zone || f.zone === "battlefield" ? "permanent" : "card";
  // singular type words with a zone other than battlefield read as cards
  const inZone = !spell && f.zone && f.zone !== "battlefield" && f.zone !== "any";
  if (inZone && (f.types?.length || f.subtypes?.length)) noun = `${noun} card`;
  if (opts.plural) noun = noun.split(/ or |, or |, /).map(plural).join(" or ").replace(/ cards\b/g, " cards");
  if (opts.plural && /\bcard\b/.test(noun)) noun = noun.replace(/\bcard\b/g, "cards");

  let out = [...adjectives, noun].join(" ");
  if (f.named) out += ` named ${f.named}`;
  if (f.with?.length) out += ` with ${list(f.with, "and")}`;
  if (f.without?.length) out += ` without ${list(f.without, "or")}`;
  if (f.chosenType) out += " of the chosen type";
  if (f.attackingYou) out += " attacking you";
  if (f.attackingOpponent) out += " attacking one of your opponents";
  if (f.sameNameAs) out += ` with the same name as ${refName(f.sameNameAs)}`;
  if (f.sharesCreatureTypeWith) out += ` that shares a creature type with ${refName(f.sharesCreatureTypeWith)}`;
  if (f.sameName) out += " with the same name";
  if (f.hasCounter) out += ` with ${f.hasCounter === "any" ? "a counter" : `a ${f.hasCounter} counter`} on it`;
  if (f.hasBasicLandType) out += " with a basic land type";
  for (const [label, cmp] of [["mana value", f.mv], ["power", f.power], ["toughness", f.toughness]] as const) {
    if (cmp) out += ` with ${label} ${describeCmp(cmp)}`;
  }
  if (f.controllerDealtDamageBy) out += " whose controller was dealt combat damage by it this turn";
  if (f.controller === "you") out += " you control";
  else if (f.controller === "opponent") out += " an opponent controls";
  else if (f.controller === "defending_player") out += " the defending player controls";
  else if (f.controller === "enchanted_player") out += " the enchanted player controls";
  else if (f.controller === "that_player") out += " that player controls";
  else if (f.controller === "active_player") out += " the active player controls";
  if (inZone) {
    const who = f.owner === "you" ? "your" : f.owner === "opponent" ? "an opponent's" : "a";
    out += f.zone === "exile" ? (f.owner === "opponent" ? " an opponent owns in exile" : " in exile") : ` in ${who} ${f.zone}`;
  } else if (f.zone === "any" && f.owner === "opponent") out += " an opponent owns";
  return out;
}

// ------------------------------------------------------------------ predicates

export function describePredicate(p: Predicate): string {
  if ("unsupported" in p) return `[unsupported condition: "${p.unsupported}"]`;
  if ("all" in p) return p.all.map(describePredicate).join(" and ");
  if ("any" in p) return p.any.map(describePredicate).join(" or ");
  if ("not" in p) {
    if ("check" in p.not && p.not.check === "source_state" && p.not.state === "on_battlefield") return `${selfName()} is no longer on the battlefield`;
    return `it is not true that ${describePredicate(p.not)}`;
  }
  switch (p.check) {
    case "cast_during": return `this spell was cast during ${p.phase === "main" ? "a main phase" : p.phase === "your_main" ? "your own main phase" : p.phase === "your_turn" ? "your turn" : p.phase === "opponent_turn" ? "an opponent's turn" : p.phase === "end_step" ? "an end step" : "combat"}`;
    case "cast_from": return `it was cast from ${p.zone}`;
    case "turn_is": return `it is ${p.whose === "yours" ? "your" : "an opponent's"} turn`;
    case "phase_is": return `it is ${p.phase === "main" ? "a main phase" : `the ${PHASE_NOUN[p.phase]}`}`;
    case "nth_this_turn": return `it is the ${p.n === 1 ? "first" : p.n === 2 ? "second" : `#${p.n}`} ${p.event.replace(/_/g, " ")} this turn`;
    case "controls": {
      const f = { ...p.filter, controller: p.filter.controller === "you" ? undefined : p.filter.controller };
      if (!p.count) return `you control ${withArticle(describeFilter(f))}`;
      const plain = p.count.op === ">=" && typeof p.count.value === "number";
      const n = plain ? `${numberWord(p.count.value as number)} or more` : describeCmp(p.count);
      const one = p.count.op === "=" && p.count.value === 1;
      return `you control ${one ? withArticle(describeFilter(f)) : `${n} ${describeFilter(f, { plural: true })}`}`;
    }
    case "life": return `${p.who === "you" ? "your" : `${playerName(p.who)}'s`} life total is ${describeCmp(p.cmp)}`;
    case "zone_count": return `${playerName(p.who)} ${p.who === "you" ? "have" : "has"} ${describeCmp(p.cmp)} ${p.filter ? describeFilter(p.filter, { plural: true }) : "cards"} in ${p.zone}`;
    case "did_this_turn": return `${playerName(p.actor)} ${p.event.replace(/_/g, " ")} this turn`;
    case "stat": {
      const subj = refName(p.of);
      const boolMatch = /^(.*?)_?is_(.+)$/.exec(p.stat);
      // yes/no stats such as "controller_is_monarch = 1"
      if (boolMatch && p.cmp.op === "=" && (p.cmp.value === 1 || p.cmp.value === 0)) {
        const owner = boolMatch[1] ? `the ${boolMatch[1].replace(/_/g, " ")} of ${subj}` : subj;
        return `${owner} ${p.cmp.value === 1 ? "is" : "is not"} the ${boolMatch[2].replace(/_/g, " ")}`;
      }
      // "page_counters >= 4" reads "this permanent has four or more page counters"
      const counters = /^(.*)_counters$/.exec(p.stat);
      if (counters) return `${subj} has ${describeCmp(p.cmp).replace(/ or greater$/, " or more")} ${counters[1].replace(/_/g, " ")} counters`;
      return `${subj}'s ${p.stat.replace(/_/g, " ")} is ${describeCmp(p.cmp)}`;
    }
    case "matches": return `${refName(p.obj)} is ${withArticle(describeFilter(p.filter))}`;
    case "kicked": case "paid_additional_cost": return !p.option ? "the additional cost was paid" : /^{/.test(p.option) || p.check === "kicked" ? `${p.option} was paid` : `the additional cost (${p.option}) was paid`;
    case "source_state": return `${selfName()} is ${p.state.replace(/_/g, " ")}`;
    case "compare": return `${describeQuantity(p.left)} is ${describeCmp(p.cmp)}`;
    case "turn_number": return p.cmp.op === "<=" && typeof p.cmp.value === "number" ? `it is ${p.scope === "yours" ? "one of your first" : "one of the first"} ${numberWord(p.cmp.value)} turns of the game` : `${p.scope === "yours" ? "your turn number" : "the turn number"} is ${describeCmp(p.cmp)}`;
    case "chosen_is": return `the chosen ${p.kind.replace(/_/g, " ")} is ${p.value}`;
    case "most_life": return `${p.who === "you" ? "you have" : `${playerName(p.who)} has`} the most life or are tied for the most life`;
    case "step_done": return `${p.who && p.who !== "you" ? `${playerName(p.who)} did` : "you did"} (${p.step})`;
    case "mana_spent": return `${p.cmp ? `${describeCmp(p.cmp)} ` : "at least one "}{${p.color}} mana was spent to cast this spell`;
    case "cast_with": return `it was cast with ${p.option}`;
    case "name_matches": return `${refName(p.obj)} has the same name as ${list(p.among.map((f) => withArticle(describeFilter(f))))}`;
    case "attacked_opponent_has_more_life": return "the attacked opponent has more life than another of your opponents";
    case "attacked_defender": return `${p.who === "all" ? "all" : p.who === "none" ? "none" : "at least one"} of those creatures attacked ${p.defender === "you" ? "you" : "you or a planeswalker you control"}`;
  }
}

// ------------------------------------------------------------------ targets

function countPhrase(min: number, max: number): string {
  if (min === max) return max === 1 ? "" : `${numberWord(max)} `;
  if (min === 0) return `up to ${numberWord(max)} `;
  return `${numberWord(min)} to ${numberWord(max)} `;
}

export function describeTarget(t: TargetSpec): string {
  const { min, max } = t.count;
  const multi = max > 1 || !!t.anyNumber || t.maxQuantity !== undefined;
  if (t.anyNumber || t.maxQuantity !== undefined) {
    const lead = t.anyNumber ? "any number of " : `${min === 0 ? "up to " : ""}${describeQuantity(t.maxQuantity!)} `;
    const another2 = t.filter?.another ? "other " : "";
    const what = t.what === "player" ? "players" : t.what === "any" ? "targets" : describeFilter(t.filter ?? {}, { plural: true, skipAnother: true });
    return t.what === "any" ? `${lead}${another2}targets` : `${lead}${another2}target ${what}`;
  }
  const another = t.filter?.another ? (multi ? "other " : "another ") : "";
  let noun: string;
  if (t.what === "player") noun = multi ? "players" : "player";
  else if (t.what === "any") noun = "any target";
  else noun = describeFilter(t.filter ?? {}, { plural: multi, skipAnother: true });
  if (t.what === "any") return `${countPhrase(min, max)}${another}${multi ? "targets" : "target"}`.trim();
  if (t.perOpponent) return `${countPhrase(min, max)}${another}target ${noun} (one choice for each opponent)`.trim();
  return `${countPhrase(min, max)}${another}target ${noun}`.trim();
}

function targetTitle(name: string, t: TargetSpec): string {
  return `${name}: choose ${t.count.max > 1 || t.anyNumber || t.maxQuantity !== undefined ? "targets" : "a target"}`;
}

// ------------------------------------------------------------------ costs / steps

/** "an artifact you control" for 1, "two artifacts you control" for more. */
function countedFilter(count: Quantity, f: ObjectFilter): string {
  return count === 1 ? withArticle(describeFilter(f)) : `${describeQuantity(count)} ${describeFilter(f, { plural: true })}`;
}

function counterPhrase(count: Quantity, kind: string): string {
  return count === 1 ? `a ${kind} counter` : `${describeQuantity(count)} ${kind} counters`;
}

export function describeCost(c: Cost): string {
  if ("unsupported" in c) return `[unsupported cost: "${c.unsupported}"]`;
  if ("mana" in c) return c.mana;
  if ("tap" in c) return "{T}";
  if ("untap" in c) return "{Q}";
  if ("tapOther" in c) return `tap ${c.count === 1 ? "an untapped" : `${describeQuantity(c.count)} untapped`} ${describeFilter(c.tapOther, { plural: c.count !== 1 })}`;
  if ("sacrifice" in c) return c.sacrifice === "self" ? `sacrifice ${selfName()}` : `sacrifice ${countedFilter(c.count, c.sacrifice)}`;
  if ("discard" in c) return c.discard === "self" ? `discard ${selfName()}` : c.discard === "hand" ? "discard your hand" : `discard ${countedFilter(c.count, c.discard)}`;
  if ("life" in c) return typeof c.life === "number" ? `pay ${c.life} life` : `pay life equal to ${describeQuantity(c.life)}`;
  if ("exileFrom" in c) return c.what === "self" ? `exile ${selfName()} from ${c.exileFrom}` : `exile ${describeQuantity(c.count)} ${describeFilter({ ...c.what, zone: c.what.zone ?? c.exileFrom }, { plural: c.count !== 1 })}`;
  if ("returnToHand" in c) return c.returnToHand === "self" ? `return ${selfName()} to its owner's hand` : `return ${countedFilter(c.count, c.returnToHand)} to its owner's hand`;
  if ("counters" in c) return `${c.counters.remove ? "remove" : "put"} ${counterPhrase(c.counters.count, c.counters.kind)} ${c.counters.remove ? "from" : "on"} ${c.counters.from === "self" ? selfName() : `among ${describeFilter(c.counters.from, { plural: true })} (you choose which)`}`;
  if ("reveal" in c) return "reveal a card";
  if ("loyalty" in c) {
    const q = c.loyalty;
    if (typeof q === "number") return q >= 0 ? `+${q}` : `−${Math.abs(q)}`;
    if (typeof q === "object" && "math" in q && q.math === "*" && q.args[0] === -1) return `−${describeQuantity(q.args[1])}`;
    return `−${describeQuantity(q)}`;
  }
  return `pay ${c.energy} energy`;
}

function stepTarget(step: Step, targets: Map<string, TargetSpec>): string {
  const ref = step.target;
  if (ref) return refName(ref, targets);
  // v1 steps
  const legacy = (step.targetType ?? step.damageTargetType) as string | undefined;
  // "the player or planeswalker it's attacking" is not a target
  if (legacy?.startsWith("attacked_")) return `the ${legacy.slice("attacked_".length).replace(/_/g, " ")} it's attacking`;
  if (legacy) return legacy === "any" ? "any target" : `target ${String(legacy).replace(/_/g, " ")}`;
  return "the target";
}

function whoPhrase(who: Step["who"], fallback = "you"): string {
  switch (who ?? fallback) {
    case "you": return "you";
    case "each_opponent": return "each opponent";
    case "each_player": return "each player";
    case "target_player": return "target player";
    case "opponent": return "an opponent";
    case "controller_of_target": return "its controller";
    case "owner_of_target": return "its owner";
    default: return "that player";
  }
}

function amt(step: Step, key = "amount"): string {
  const v = step[key] as Quantity | undefined;
  return v === undefined ? "?" : describeQuantity(v);
}

function cards(n: string): string {
  return n === "1" ? "a card" : `${n} cards`;
}

/** Imperative description of one step, e.g. "draw 2 cards", "destroy target creature". */
export function describeStep(step: Step, targets: Map<string, TargetSpec> = new Map()): string {
  const t = () => stepTarget(step, targets);
  const dur = step.duration && step.duration !== "instant" ? ` ${typeof step.duration === "string" ? step.duration === "until_end_of_turn" ? "until end of turn" : step.duration.replace(/_/g, " ") : "for a duration"}` : "";
  switch (step.kind) {
    case "destroy_target": return `destroy ${t()}`;
    case "destroy_all": return `destroy each ${step.filter ? describeFilter(step.filter) : String(step.targetType ?? "permanent")}`;
    case "exile_target": return `exile ${t()}`;
    case "bounce_target": return `return ${t()} to its owner's hand`;
    case "reanimate": return `return ${step.target ? t() : "a card"} from the graveyard to the battlefield`;
    case "mill": return `${step.who && step.who !== "you" ? whoPhrase(step.who) : "you"} mill ${amt(step)} cards`.replace(/^you mill/, "mill");
    case "draw_cards": return `${step.who && step.who !== "you" ? `${whoPhrase(step.who)} draws` : "draw"} ${cards(amt(step))}`;
    case "life_change": {
      const d = step.lifeDelta as number | undefined;
      const you = !step.who || step.who === "you";
      const lose = d !== undefined && d < 0;
      const n = d !== undefined ? String(Math.abs(d)) : amt(step);
      return you ? `${lose ? "lose" : "gain"} ${n} life` : `${playerName(step.who!)} ${lose ? "loses" : "gains"} ${n} life`;
    }
    case "drain": return `${step.drainScope === "each_opponent" ? "each opponent" : "target player"} loses ${amt(step)} life and you gain that much`;
    case "damage_target": {
      const src = step.source ? `${refName(String(step.source), targets)} deals` : "deal";
      const excess = step.excessTo ? `, excess damage is dealt to ${refName(String(step.excessTo), targets)} instead` : "";
      return `${src} ${amt(step)} damage ${step.divided ? "divided as you choose among " : "to "}${t()}${excess}`;
    }
    case "discard": return `${step.who && step.who !== "you" ? whoPhrase(step.who) : "you"} discard ${cards(amt(step))}`.replace(/^you discard/, "discard");
    case "tap_target": return `tap ${t()}`;
    case "untap_target": return `untap ${t()}`;
    case "pump_target": return `${t()} gets ${fmtSigned(step.power)}/${fmtSigned(step.toughness)}${dur}`;
    case "mass_pump": return `${String(step.massPumpScope ?? "all")} creatures get ${fmtSigned(step.power)}/${fmtSigned(step.toughness)}${dur}`;
    case "mass_bounce": return `return all ${step.filter ? describeFilter(step.filter, { plural: true }) : "matching permanents"} to their owners' hands`;
    case "create_tokens": return describeTokens(step);
    case "put_counters_on_self": return `put ${counterPhrase(step.amount ?? 1, String(step.counterKind ?? "+1/+1"))} on ${selfName()}`;
    case "sacrifice_permanent": {
      const what = step.filter ? withArticle(describeFilter({ ...step.filter, zone: undefined })) : "a permanent";
      return `${whoPhrase(step.who)} sacrifice${step.who && step.who !== "you" ? "s" : ""} ${what}`.replace(/^you sacrifice/, "sacrifice");
    }
    case "move_card_zone": return describeMove(step, t);
    case "search_library": return `${step.who && step.who !== "you" ? `${whoPhrase(step.who)} searches` : "search"} ${step.who && step.who !== "you" ? "their" : "your"} library for ${step.filter ? `a ${describeFilter(step.filter)}` : "a card"}, put it onto ${String(step.to) === "hand" ? "your hand" : `the ${String(step.to ?? "battlefield")}`}${step.shuffle ? ", then shuffle" : ""}`;
    case "add_counters": return `put ${counterPhrase(step.amount ?? 1, String(step.counterKind ?? "").trim())} on ${step.on ? refName(String(step.on), targets) : "it"}`;
    case "remove_counters": return `remove ${counterPhrase(step.amount ?? 1, String(step.counterKind ?? "").trim())} from ${step.on ? refName(String(step.on), targets) : "it"}`;
    case "extra_turn": return "take an extra turn after this one";
    case "connive": return `${String(step.on ?? "it")} connives (draw, discard, +1/+1 counter if the discarded card is nonland)`;
    case "exploit": return "sacrifice a creature (exploit)";
    case "fight": return `${refName(String(step.a ?? "self"), targets)} fights ${refName(String(step.b ?? "t1"), targets)}`;
    case "fight_pairs": return `${step.fighters === "created" ? "each of the tokens just created" : refName(String(step.fighters ?? "created"), targets)} fights a different ${step.against ? describeFilter(step.against) : "creature"}, the pairing chosen by ${step.pairing === "controller_chooses" || !step.pairing ? "you" : "the controller"}`;
    case "investigate": return `investigate${step.amount === undefined || step.amount === 1 ? "" : ` ${amt(step)} times`}`;
    case "proliferate": return "proliferate";
    case "extra_combat": return `${step.untapAttackers ? "untap all attacking creatures, then " : ""}there is an additional combat phase after this one`;
    case "attach": return `attach ${refName(String(step.what), targets)} to ${refName(String(step.to), targets)}`;
    case "gain_control": return `gain control of ${t()}${dur}`;
    case "grant_effect": return `${t()} ${describeModifiers(step.modify as Modifier[] | undefined, false, "step")}${dur}`;
    case "permission_to_play": return `cast or play ${refName(String(step.what ?? step.target), targets)}${step.withoutPaying ? " without paying its mana cost" : ""}${dur}`;
    case "choose": return describeChoose(step);
    case "add_mana": return Array.isArray(step.produces) && step.produces.length ? `add ${(step.produces as ManaSpec[]).map(describeManaSpec).join(" and ")}` : "add mana";
    case "create_delayed_trigger": return "create a delayed trigger";
    case "counter_spell": return `counter ${t()}`;
    case "copy": return `copy ${t()}`;
    case "scry": case "surveil": return `${step.kind} ${amt(step)}`;
    case "look_top": return `look at the top ${amt(step) === "1" ? "card" : `${numberWordQ(step.amount)} cards`} of your library`;
    case "repeat_for_each": return step.over ? `for each ${describeFilter(step.over as ObjectFilter)}, ${(step.steps ?? []).map((x) => describeStep(x, targets)).join(", then ") || "repeat"}` : "repeat for each matching object";
    case "shuffle": return "shuffle";
    case "reveal": return `reveal ${t()}`;
    case "transform": return `transform ${t()}`;
    case "set_life": return `set life total to ${amt(step)}`;
    case "if_else": return `if ${step.if ? describePredicate(step.if) : "?"}: ${(step.then ?? []).map((s) => describeStep(s, targets)).join(", then ")}${step.else?.length ? `; otherwise ${step.else.map((s) => describeStep(s, targets)).join(", then ")}` : ""}`;
    case "rewrite_enchant": return "rewrite this Aura's enchant restriction";
    case "vote": {
      const cand = step.candidates ? describeFilter(step.candidates) : (step.voteOptions as string[] | undefined)?.join(" or ") ?? "an option";
      return `${step.voters === "each_opponent" ? "each opponent" : "each player"} votes for ${step.candidates ? withArticle(cand) : cand}${step.voters === "each_opponent" ? "" : " (starting with you)"}; ${step.tie === "controller_chooses" ? "if tied you choose among the tied" : "every one tied for the most votes wins"}`;
    }
    case "mutual_reveal": return step.players === "target_players" ? "two target players each reveal the top card of their library, each loses life equal to the mana value of the card the other revealed, then each puts the card they revealed into their hand" : "you and target player each reveal the top card of your library, each loses life equal to the mana value of the card the other revealed, then each puts the card they revealed into their hand";
    case "exchange_life": return `exchange life totals with ${whoPhrase((step.withWho as Step["who"]) ?? "target_player")}`;
    case "regenerate": return `regenerate ${t()}`;
    case "repeat_process": return `${(step.steps ?? []).map((x) => describeStep(x, targets)).join(", then ")}; then repeat this process ${step.repeatIf ? `as long as ${describePredicate(step.repeatIf as Predicate)}` : "as often as you choose"}`;
    case "create_emblem": return `you get an emblem with "${((step.emblem as { abilities?: { text: string }[] } | undefined)?.abilities ?? []).map((a) => a.text).join(" ")}"`;
    default: return String((step as Step).kind).replace(/_/g, " ");
  }
}

function fmtSigned(q: unknown): string {
  if (q === undefined) return "?";
  if (typeof q === "number") return q >= 0 ? `+${q}` : String(q);
  return `+${describeQuantity(q as Quantity)}`;
}

function targetMap(...lists: (TargetSpec[] | undefined)[]): Map<string, TargetSpec> {
  const m = new Map<string, TargetSpec>();
  for (const l of lists) for (const t of l ?? []) m.set(t.id, t);
  return m;
}

// ------------------------------------------------------------------ prompt builders

export function promptForTarget(name: string, t: TargetSpec): Prompt {
  return { title: targetTitle(name, t), instruction: `Choose ${describeTarget(t)}.` };
}

export function promptForModes(name: string, modes: Modes): Prompt {
  const { min, max } = modes.choose;
  let instruction: string;
  if (min === max) instruction = `Choose ${numberWord(min)} mode${min === 1 ? "" : "s"}${min > 1 && modes.distinct && !modes.repeatable ? " (each different)" : ""}.`;
  else if (min === 0) instruction = `Choose up to ${numberWord(max)} mode${max === 1 ? "" : "s"}.`;
  else if (min === 1 && max === 2) instruction = "Choose one or both modes.";
  else if (min === 1 && max === modes.options.length) instruction = "Choose one or more modes.";
  else instruction = `Choose ${numberWord(min)} or more modes (up to ${numberWord(max)}).`;
  if (modes.repeatable) instruction += " You may choose the same mode more than once.";
  if (modes.distinctTargets) instruction += " Each mode must target a different object or player.";
  return { title: `${name}: choose ${min === 1 && max === 1 ? "a mode" : "modes"}`, instruction };
}

export function promptForX(name: string, hint?: string): Prompt {
  return { title: `${name}: choose X`, instruction: `Choose a value for X${hint ? ` (${hint})` : ""}.` };
}

export function promptForMay(name: string, doing: string): Prompt {
  return { title: `${name}: optional`, instruction: `Do you want to ${doing.replace(/\byou may (?=(?:cast|play|exile|put|return|draw|discard|sacrifice|pay|have|choose|search|look|reveal|create|untap|tap|copy|gain|attach)\b)/gi, "").replace(/^may /i, "")}?` };
}

export function promptForCost(name: string, c: Cost): Prompt | undefined {
  if ("sacrifice" in c && c.sacrifice !== "self") return { title: `${name}: choose what to sacrifice`, instruction: `Choose ${describeQuantity(c.count)} ${describeFilter(c.sacrifice, { plural: c.count !== 1 })} to sacrifice.` };
  if ("discard" in c && typeof c.discard === "object") return { title: `${name}: choose what to discard`, instruction: `Choose ${describeQuantity(c.count)} ${describeFilter(c.discard, { plural: c.count !== 1 })} to discard.` };
  if ("tapOther" in c) return { title: `${name}: choose what to tap`, instruction: `Choose ${describeQuantity(c.count)} untapped ${describeFilter(c.tapOther, { plural: c.count !== 1 })} to tap.` };
  if ("exileFrom" in c && c.what !== "self") return { title: `${name}: choose what to exile`, instruction: `Choose ${describeQuantity(c.count)} ${describeFilter({ ...c.what, zone: c.what.zone ?? c.exileFrom }, { plural: c.count !== 1 })} to exile.` };
  if ("returnToHand" in c && c.returnToHand !== "self") return { title: `${name}: choose what to return`, instruction: `Choose ${describeQuantity(c.count)} ${describeFilter(c.returnToHand, { plural: c.count !== 1 })} to return to hand.` };
  if ("reveal" in c && c.reveal !== "self") return { title: `${name}: choose what to reveal`, instruction: `Choose a ${describeFilter(c.reveal)} to reveal.` };
  return undefined;
}

export function promptForCastOption(name: string, o: CastOption): Prompt {
  const cost = o.cost.map(describeCost).join(", ");
  if (o.kind === "gift") return { title: `${name}: gift`, instruction: `Do you want to promise ${o.gift ? `a ${o.gift}` : "a gift"} to an opponent? If you do, choose that opponent.` };
  if (o.kind === "escalate") return { title: `${name}: escalate`, instruction: `Do you want to pay ${cost} for each mode beyond the first?` };
  if (!o.optional) return { title: `${name}: additional cost`, instruction: `Choose how to pay the additional cost (${cost}).` };
  const verb = o.kind === "additional" || o.kind === "kicker" ? `pay the additional ${o.kind === "kicker" ? "kicker " : ""}cost` : o.kind === "cast_from_zone" ? `cast it from ${o.from}` : `cast it using its ${o.kind} cost`;
  return { title: `${name}: ${o.kind} option`, instruction: `Do you want to ${verb}${cost ? ` (${cost})` : ""}?` };
}

/** Does this cost need the player to choose a value for X? */
export function costHasX(c: Cost): boolean {
  return JSON.stringify(c).match(/\{X\}|"ref":"X"/i) !== null;
}

const DECISION_STEP_KINDS = new Set(["choose", "search_library", "discard", "sacrifice_permanent", "connive", "exploit", "fight_pairs", "vote"]);
/** A permission_to_play that outlasts this resolution ("until end of turn", "as long as it stays exiled"): always granted, the player decides later when (and whether) to cast, so no up-front question and no prompt. */
export const isDurablePermission = (step: Step): boolean => step.kind === "permission_to_play" && !((((step.what ?? step.target) as string | undefined) === "linked_exile" && step.duration === undefined) || step.duration === "instant");
export function stepNeedsPrompt(step: Step): boolean {
  if (isDurablePermission(step)) return false;
  return step.optional === true || DECISION_STEP_KINDS.has(step.kind);
}

function promptForStep(name: string, step: Step, targets: Map<string, TargetSpec>): Prompt {
  const optionalCost = step.optionalCost as Cost[] | undefined;
  if (step.optional && optionalCost && optionalCost.length > 0) {
    const cost = optionalCost.map(describeCost).join(" and ");
    const doing = step.kind === "if_else" ? "the effect that follows happens" : describeStep({ ...step, optional: undefined, optionalCost: undefined }, targets);
    return { title: `${name}: optional payment`, instruction: `Do you want to pay ${cost}? If you do, ${doing}.` };
  }
  if (step.optional) return promptForMay(name, describeStep(step, targets));
  switch (step.kind) {
    case "choose": return { title: `${name}: choose`, instruction: `Choose ${describeStep(step, targets).replace(/^choose /, "")}.` };
    case "search_library": return { title: `${name}: search`, instruction: `Choose a ${step.filter ? describeFilter(step.filter) : "card"} from the library.` };
    case "discard": return { title: `${name}: discard`, instruction: `Choose ${step.amount === undefined || step.amount === 1 ? "a card" : `${amt(step)} cards`} to discard.` };
    case "sacrifice_permanent": return { title: `${name}: sacrifice`, instruction: "Choose a permanent to sacrifice." };
    case "fight_pairs": return { title: `${name}: choose fights`, instruction: `Choose which ${step.against ? describeFilter(step.against) : "creature"} each token fights. Each token fights a different one; tokens beyond the number of creatures fight nothing.` };
    case "vote": return { title: `${name}: vote`, instruction: `Vote for ${step.candidates ? withArticle(describeFilter(step.candidates)) : (step.voteOptions as string[] | undefined)?.join(" or ") ?? "an option"}. Players vote in turn order starting with the caster; ${step.tie === "controller_chooses" ? "ties are broken by the controller" : "every choice tied for the most votes wins"}.` };
    case "connive": return { title: `${name}: connive`, instruction: "Choose a card to discard after drawing (connive)." };
    default: return { title: `${name}: choose`, instruction: "Make a choice." };
  }
}

// ------------------------------------------------------------------ fill missing prompts

function stepList(name: string, steps: Step[], targets: Map<string, TargetSpec>, abilityId: string): Step[] {
  return steps.map((s) => {
    const out: Step = { ...s };
    if (isDurablePermission(s)) delete out.prompt; // never asked (see isDurablePermission): a stale stored question like "Do you want to you may play exiled..." must not survive
    else if (s.prompt && /\bDo you want to you may /.test(s.prompt.instruction)) out.prompt = { ...s.prompt, instruction: s.prompt.instruction.replace(/\bDo you want to you may /g, "Do you want to ") }; // a question stored by an older generator
    else if (stepNeedsPrompt(s) && !s.prompt) out.prompt = withSource(promptForStep(name, s, targets), name, abilityId);
    if (s.unlessPay && !s.unlessPay.prompt) {
      out.unlessPay = {
        ...s.unlessPay,
        prompt: withSource({ title: `${name}: pay or not`, instruction: `Do you want to ${s.unlessPay.cost.every((c) => "mana" in c) ? "pay " : ""}${s.unlessPay.cost.map(describeCost).join(" and ")}? If you don't, ${describeStep({ ...s, unlessPay: undefined }, targets)}.` }, name, abilityId)
      };
    }
    for (const key of ["then", "else", "steps"] as const) if (s[key]) out[key] = stepList(name, s[key]!, targets, abilityId);
    return out;
  });
}

function withSource(p: Prompt, card: string, ability: string): Prompt {
  return { ...p, source: { card, ability } };
}

/** Returns a copy of the card with every missing prompt filled from the structured fields. */
export function generatePrompts(card: Card, cardName: string): Card {
  return withCardName(cardName, () => generatePromptsFor(card, cardName));
}

function generatePromptsFor(card: Card, cardName: string): Card {
  const abilities = card.abilities.map((a): Ability => {
    const out: Ability = { ...a };
    const abilityTargets = targetMap(a.targets);
    if (a.targets) out.targets = a.targets.map((t) => (t.prompt ? t : { ...t, prompt: withSource(promptForTarget(cardName, t), cardName, a.id) }));
    if (a.modes) {
      out.modes = {
        ...a.modes,
        prompt: a.modes.prompt ?? withSource(promptForModes(cardName, a.modes), cardName, a.id),
        options: a.modes.options.map((o) => {
          const tm = targetMap(a.targets, o.targets);
          return {
            ...o,
            targets: o.targets?.map((t) => (t.prompt ? t : { ...t, prompt: withSource(promptForTarget(cardName, t), cardName, a.id) })),
            steps: stepList(cardName, o.steps, tm, a.id)
          };
        })
      };
    }
    if (a.steps) out.steps = stepList(cardName, a.steps, abilityTargets, a.id);
    if (a.replacement) {
      const r = a.replacement;
      const result = "steps" in r.result ? { ...r.result, steps: stepList(cardName, r.result.steps, abilityTargets, a.id) } : r.result;
      out.replacement = { ...r, result, prompt: r.optional && !r.prompt ? withSource(promptForMay(cardName, "apply this replacement"), cardName, a.id) : r.prompt };
    }
    if (a.costs) {
      out.costs = a.costs.map((c) => {
        if (c.prompt) return c;
        const p = promptForCost(cardName, c);
        return p ? { ...c, prompt: withSource(p, cardName, a.id) } : c;
      });
      if (!a.xPrompt && a.costs.some(costHasX)) {
        out.xPrompt = withSource(promptForX(cardName, a.costs.some((c) => "mana" in c && /\{X\}/i.test(c.mana)) ? "paid in mana" : "the amount used in the cost"), cardName, a.id);
      }
    }
    if (a.prompt && /\bDo you want to you may /.test(a.prompt.instruction)) out.prompt = { ...a.prompt, instruction: a.prompt.instruction.replace(/\bDo you want to you may /g, "Do you want to ") }; // stored by an older generator
    else if (a.optional && !a.prompt) {
      const doing = (a.steps ?? []).map((s) => describeStep(s, abilityTargets)).join(", then ") || "use this ability";
      out.prompt = withSource(promptForMay(cardName, doing), cardName, a.id);
    }
    return out;
  });
  const castOptions = card.castOptions?.map((o) => (o.prompt ? o : { ...o, prompt: withSource(promptForCastOption(cardName, o), cardName, o.id) }));
  return { ...card, abilities, ...(castOptions ? { castOptions } : {}) };
}

// ------------------------------------------------------------------ plain-English helpers for steps

function numberWordQ(q: unknown): string {
  if (q === undefined) return "?";
  return typeof q === "number" ? numberWord(q) : describeQuantity(q as Quantity);
}

function describeTokens(step: Step): string {
  const count = step.tokenCount === undefined ? 1 : (step.tokenCount as Quantity);
  const cnt = count === 1 ? "a" : typeof count === "number" ? numberWord(count) : describeQuantity(count);
  const p = step.tokenPower !== undefined ? describeQuantity(step.tokenPower as Quantity) : "?";
  const th = step.tokenToughness !== undefined ? describeQuantity(step.tokenToughness as Quantity) : "?";
  const colors = Array.isArray(step.tokenColors) && step.tokenColors.length ? `${(step.tokenColors as string[]).map((c) => c.toLowerCase()).join(" and ")} ` : "";
  let noun = String(step.tokenName ?? "").trim();
  if (typeof step.tokenTypeLine === "string") {
    const [left, right] = step.tokenTypeLine.split(/\s*[—-]\s*/);
    noun = [right, left?.toLowerCase()].filter(Boolean).join(" ").trim() || noun;
  }
  const kw = Array.isArray(step.tokenKeywords) && step.tokenKeywords.length ? ` with ${list(step.tokenKeywords as string[], "and")}` : "";
  const state = `${step.tokenTapped ? " tapped" : ""}${step.tokenAttacking ? (step.tokenAttacking === true ? " and attacking" : step.tokenAttacking === "attacked_opponent" ? " and attacking that opponent" : step.tokenAttacking === "same_defender" ? " and attacking the same defender" : " and attacking (you choose who)") : ""}`;
  const ab = Array.isArray(step.tokenAbilities) && step.tokenAbilities.length ? ` and "${(step.tokenAbilities as { text: string }[]).map((a) => a.text).join(" ")}"` : "";
  return `create ${cnt} ${p}/${th} ${colors}${noun} ${count === 1 ? "token" : "tokens"}${kw}${ab}${state}`.replace(/\s+/g, " ");
}

function zoneDestination(zone: unknown): string {
  switch (zone) {
    case "hand": return "your hand";
    case "graveyard": return "its owner's graveyard";
    case "library": return "its owner's library";
    case "exile": return "exile";
    case "battlefield": return "the battlefield";
    default: return String(zone ?? "another zone");
  }
}

function describeMove(step: Step, t: () => string): string {
  const to = step.moveTo;
  if (step.what === "rest_of_looked_cards") {
    return `put the rest of the looked-at cards ${step.position ? `on the ${String(step.position)} of` : "into"} your ${String(to ?? "library")}${step.order === "random" ? " in a random order" : ""}`;
  }
  if (step.all) {
    const who = step.who;
    const poss = !who || who === "you" ? "your" : who === "each_opponent" ? "each opponent's" : who === "each_player" ? "each player's" : "that player's";
    const from = String(step.from ?? "graveyard");
    return to === "exile" ? `exile all cards from ${poss} ${from}` : `put all cards from ${poss} ${from} into ${zoneDestination(to)}`;
  }
  const what = step.target ? t() : "a card";
  switch (to) {
    case "exile": return `exile ${what}${step.faceDown ? " face down" : ""}`;
    case "hand": return `put ${what} into your hand`;
    case "battlefield": return `put ${what} onto the battlefield`;
    case "library": if (step.position) return `put ${what} on the ${String(step.position)} of its owner's library`; return `put ${what} into ${zoneDestination(to)}`;
    case "graveyard": return `put ${what} into ${zoneDestination(to)}`;
    default: return `move ${what} to ${String(to ?? "another zone")}`;
  }
}

function describeChoose(step: Step): string {
  if (step.choice) {
    const what = step.choice === "mode" && step.options?.length ? `one of ${list(step.options)}` : `a ${step.choice.replace(/_/g, " ")}`;
    return `choose ${what}`;
  }
  if (!step.from) return "choose an object";
  const f = step.from as ObjectFilter;
  const c = step.count as Quantity | undefined;
  let desc = c === undefined || c === 1 ? withArticle(describeFilter(f)) : `${describeQuantity(c)} ${describeFilter(f, { plural: true })}`;
  if (step.fromLooked) desc = `${desc.replace(/ in (?:a|your|an opponent's) library$/, "")} from among the looked-at cards`;
  return `choose ${desc}`;
}

// ------------------------------------------------------------------ static abilities, modifiers

type Modifier = Record<string, any>;

function cantText(c: string): string {
  switch (c) {
    case "be_blocked": return "be blocked";
    case "be_countered": return "be countered";
    case "cast": return "cast spells";
    case "gain_life": return "gain life";
    case "search": return "search libraries";
    default: return c.replace(/_/g, " ");
  }
}

function modifierPhrase(m: Modifier, isPlural: boolean, ctx: "static" | "step"): string {
  const have = ctx === "step" ? (isPlural ? "gain" : "gains") : isPlural ? "have" : "has";
  const be = isPlural ? "are" : "is";
  if (m.pt) {
    const { power: pw, toughness: tg } = m.pt as { power: Quantity; toughness: Quantity };
    const gets = isPlural ? "get" : "gets";
    if (typeof pw !== "number" && JSON.stringify(pw) === JSON.stringify(tg)) return `${gets} +X/+X, where X is ${describeQuantity(pw)}`;
    return `${gets} ${fmtSigned(pw)}/${fmtSigned(tg)}`;
  }
  if (m.setBasePT) {
    const { power: pw, toughness: tg } = m.setBasePT as { power: Quantity; toughness: Quantity };
    const hasW = isPlural ? "have" : "has";
    // "has the power and toughness of <ref>" (Duplicant)
    if (typeof pw === "object" && typeof tg === "object" && "ref" in pw && "ref" in tg && pw.ref === "stat" && tg.ref === "stat" && pw.of === tg.of) return `${hasW} the power and toughness of ${refName(pw.of)}`;
    if (typeof pw !== "number" && JSON.stringify(pw) === JSON.stringify(tg)) return `${hasW} power and toughness each equal to ${describeQuantity(pw)}`;
    return `${hasW} base power and toughness ${describeQuantity(pw)}/${describeQuantity(tg)}`;
  }
  if (m.grant !== undefined) {
    const g = String(m.grant);
    const words = g.trim().split(/\s+/);
    return !/['’]/.test(g) && (words.length <= 2 || /^no /.test(g)) ? `${have} ${g}` : g;
  }
  if (m.grantAbility) return `${have} an ability`;
  if (m.lose !== undefined) return `${isPlural ? "lose" : "loses"} ${String(m.lose)}`;
  if (m.setTypes) return `${be} ${(m.setTypes as string[]).join(" ")}`;
  if (m.addTypes) {
    const types = (m.addTypes as string[]).map((x) => x.toLowerCase());
    if (ctx === "step") return `becomes ${withArticle(types.join(" "))} in addition to its other types`;
    return isPlural ? `are ${types.map(plural).join(", ")} in addition to their other types` : `is also ${withArticle(types.join(" "))}`;
  }
  if (m.cant) return `can't ${cantText(String(m.cant))}${m.protects ? (m.protects === "you" ? " you" : " you or planeswalkers you control") : ""}${m.except ? ` (except ${describeFilter(m.except as ObjectFilter, { plural: true })})` : ""}`;
  if (m.evasion) {
    const e = m.evasion as { cantBeBlockedBy?: ObjectFilter; unlessDefenderControls?: ObjectFilter };
    const parts: string[] = [];
    if (e.cantBeBlockedBy) parts.push(`can't be blocked by ${describeFilter(e.cantBeBlockedBy, { plural: true })}`);
    if (e.unlessDefenderControls) parts.push(`can't be blocked unless defending player controls ${withArticle(describeFilter(e.unlessDefenderControls))}`);
    return parts.join(" and ") || "has evasion";
  }
  if (m.copyOf) return `${be} a copy of ${refName(String(m.copyOf))}`;
  if (m.mustAttack) return `${isPlural ? "attack" : "attacks"} each combat if able`;
  if (m.copySubtypesOf) return `${isPlural ? "have" : "has"} the creature types of ${refName(String(m.copySubtypesOf))}`;
  if (m.attackTax) return `can't attack ${m.attackTax.protects === "you_and_planeswalkers" ? "you or planeswalkers you control" : "you"} unless their controller pays ${String(m.attackTax.cost)} for each creature they control that's attacking ${m.attackTax.protects === "you_and_planeswalkers" ? "a protected player or planeswalker" : "you"}`;
  if (m.blockTax) return `can't block unless their controller pays ${String(m.blockTax.cost)} for each creature they control that's blocking`;
  if (m.addChosenType) return `${be} the chosen type in addition to ${isPlural ? "their" : "its"} other types`;
  if (m.setColors) return `${be} ${(m.setColors as string[]).map((c) => c.toLowerCase()).join(" and ")}`;
  if (m.extraLandDrops) return `may play ${m.extraLandDrops === 1 ? "an additional land" : `${numberWord(m.extraLandDrops)} additional lands`} on each of your turns`;
  return JSON.stringify(m);
}

/** "gets +1/+0 and has flying" style phrase for a list of modifiers. */
export function describeModifiers(mods: Modifier[] | undefined, isPlural = false, ctx: "static" | "step" = "static"): string {
  if (!mods?.length) return "gains an effect";
  return mods.map((m) => modifierPhrase(m, isPlural, ctx)).join(" and ");
}

function subjectPhrase(affects: unknown): { text: string; plural: boolean } {
  if (typeof affects === "string") {
    if (affects === "you") return { text: "you", plural: true };
    if (["self", "equipped", "enchanted", "event_object", "chosen", "linked_exile"].includes(affects) || /^t\d+$/.test(affects)) return { text: refName(affects), plural: false };
    return { text: playerName(affects), plural: false };
  }
  return { text: describeFilter(affects as ObjectFilter, { plural: true }), plural: true };
}

function cap1(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function describeDuration(d: unknown): string {
  if (!d || d === "instant") return "";
  if (d === "until_end_of_turn") return " until end of turn";
  if (d === "until_end_of_your_next_turn") return " until the end of your next turn";
  if (d === "until_your_next_end_step") return " until your next end step";
  if (typeof d === "string") return ` ${d.replace(/_/g, " ")}`;
  if (typeof d === "object" && d && "forAsLongAs" in d) return ` for as long as ${describePredicate((d as { forAsLongAs: Predicate }).forAsLongAs)}`;
  if (typeof d === "object" && d && "until" in d) return ` until ${String((d as { until: string }).until).replace(/_/g, " ")}`;
  return "";
}

/** Whole static ability as a sentence, e.g. "Colorless creatures you control get +2/+2." */
export function describeStatic(spec: NonNullable<Ability["static"]>): string {
  const subj = subjectPhrase(spec.affects);
  const tail = spec.while
    ? ("not" in spec.while ? ` unless ${describePredicate(spec.while.not)}` : ` as long as ${describePredicate(spec.while)}`)
    : "";
  const cost = spec.modify.find((m) => "costMod" in m) as { costMod: { filter: ObjectFilter; delta: Quantity } } | undefined;
  if (cost) {
    const { filter, delta } = cost.costMod;
    // delta is ADDED to the cost: a negative number (or -1 * Quantity) is a reduction
    const negQ = typeof delta === "object" && "math" in delta && delta.math === "*" && delta.args[0] === -1 ? delta.args[1] : undefined;
    const neg = typeof delta === "number" ? delta < 0 : negQ !== undefined;
    const mag: Quantity = typeof delta === "number" ? Math.abs(delta) : negQ ?? delta;
    const amount = typeof mag === "number" ? `{${mag}}` : `{X}, where X is ${describeQuantity(mag)},`;
    return `${cap1(describeFilter(filter, { plural: true, spell: true }))}${spec.affects === "you" ? " you cast" : ""} cost ${amount} ${neg ? "less" : "more"} to cast${tail}`;
  }
  const phrases = describeModifiers(spec.modify as Modifier[], subj.plural, "static");
  return `${cap1(subj.text)} ${phrases}${tail}${describeDuration(spec.duration)}`;
}

export function describeReplacement(r: NonNullable<Ability["replacement"]>): string {
  const subj = r.subject === undefined ? selfName() : typeof r.subject === "string" ? playerName(r.subject) : withArticle(describeFilter(r.subject));
  const ev = r.event.replace(/^would_/, "").replace(/_/g, " ");
  const recipient = r.recipient === undefined ? "" : r.recipient === "self" ? ` to ${selfName()}` : typeof r.recipient === "string" ? ` to ${playerName(r.recipient)}` : ` to ${withArticle(describeFilter(r.recipient))}`;
  const kindWord = r.damageType === "combat" ? "combat " : r.damageType === "noncombat" ? "noncombat " : "";
  const fromSrc = r.damageSource ? ` by ${withArticle(describeFilter(r.damageSource))}` : "";
  const dur = describeDuration(r.duration);
  const condTxt = r.condition ? ` (only if ${describePredicate(r.condition)})` : "";
  const evText = r.event === "would_deal_damage" ? `be dealt ${kindWord}damage${fromSrc}` : ev;
  const head = r.event === "would_deal_damage"
    ? `If ${kindWord}damage${fromSrc} would be dealt${recipient}${dur}${condTxt}`.replace("If damage", "If damage")
    : `If ${subj} would ${evText}${recipient}${dur}${condTxt}`;
  const res = r.result;
  if (res.mode === "prevent") return `${head}, prevent it`;
  if (res.mode === "modify") {
    const set = res.set as Record<string, unknown>;
    if (Object.keys(set).length === 1 && set.tapped === true) return `${head}, it ${ev === "enter" ? "enters" : "is"} tapped`;
    return `${head}, modify it: ${JSON.stringify(set)}`;
  }
  return `${head}, ${res.mode === "instead" ? "instead: " : "also: "}${res.steps.map((s) => describeStep(s)).join(", then ")}`;
}

function costAmountText(q: Quantity): string {
  return typeof q === "number" ? `{${q}}` : `{X}, where X is ${describeQuantity(q)},`;
}

export function describeCostReduction(cr: NonNullable<Ability["costReduction"]>): string {
  const amount = costAmountText(cr.amount);
  const per = cr.per ? ` for each ${describeFilter(cr.per).replace(/^another /, "other ")}` : "";
  const cond = cr.condition ? ` if ${describePredicate(cr.condition)}` : "";
  return `costs ${amount} less${per}${cond}`;
}

/** Plain English for one ManaSpec ("{W}{W}", "one mana of any color", "mana of the chosen color"...). */
export function describeManaSpec(m: ManaSpec): string {
  const restr = (r?: ObjectFilter, a?: ObjectFilter) => {
    const parts: string[] = [];
    if (r) parts.push(`cast ${withArticle(describeFilter(r, { spell: true }))}`);
    if (a) parts.push(`activate abilities of ${describeFilter(a, { plural: true })}`);
    return parts.length ? ` (spend only to ${parts.join(" or ")})` : "";
  };
  if ("colors" in m) return `${m.colors}${restr(m.restriction, m.abilitiesOf)}`;
  if ("anyColor" in m) return `${m.anyColor === 1 ? "one mana" : `${numberWord(m.anyColor)} mana of a single color`} of any color${restr(m.restriction, m.abilitiesOf)}`.replace("mana of a single color of any color", "mana of any one color");
  if ("perCount" in m) return `{${m.color}} for each ${describeFilter(m.perCount)}${restr(m.restriction, m.abilitiesOf)}`;
  if ("commanderIdentity" in m) return "one mana of any color in your commander's color identity";
  if ("anyColorAmount" in m) return `${describeQuantity(m.anyColorAmount)} mana in any combination of colors${restr(m.restriction, m.abilitiesOf)}`;
  if ("chosenColor" in m) return `${m.chosenColor === 1 ? "one mana" : `${numberWord(m.chosenColor)} mana`} of the chosen color${restr(m.restriction, m.abilitiesOf)}`;
  return `if ${describePredicate(m.conditional.if)}: ${m.conditional.then.map(describeManaSpec).join(" and ")}; otherwise ${m.conditional.else.map(describeManaSpec).join(" and ")}`;
}

// ------------------------------------------------------------------ triggers

function roman(n: number): string {
  const pairs: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, sym] of pairs) while (n >= v) { out += sym; n -= v; }
  return out;
}

const ORDINALS = ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ordinal = (n: number) => ORDINALS[n] ?? `${n}th`;

/** [third person singular, plural / "you" form] */
const EVENT_VERBS: Record<string, [string, string]> = {
  etb: ["enters", "enter"], leaves: ["leaves", "leave"], dies: ["dies", "die"], cast: ["casts", "cast"],
  draw: ["draws", "draw"], discard: ["discards", "discard"], attack: ["attacks", "attack"], block: ["blocks", "block"],
  deals_damage: ["deals", "deal"], deals_combat_damage_to_player: ["deals", "deal"], gain_life: ["gains", "gain"],
  lose_life: ["loses", "lose"], token_created: ["creates", "create"], sacrifice: ["sacrifices", "sacrifice"],
  exploit: ["exploits", "exploit"], cycle: ["cycles", "cycle"], tap: ["becomes tapped", "become tapped"],
  becomes_target: ["becomes", "become"], activate: ["activates", "activate"], mill: ["mills", "mill"], commit_crime: ["commits", "commit"]
};

const ZONE_NAMES: Record<string, string> = { battlefield: "the battlefield", graveyard: "a graveyard", hand: "a hand", library: "a library", exile: "exile", stack: "the stack", command: "the command zone" };

const PLAYER_SUBJECTS = new Set(["you", "opponent", "each_opponent", "each_player", "target_player", "that_player", "controller_of_target", "owner_of_target"]);

/** Plain-English trigger condition, e.g. "Whenever you cast a colorless spell". */
export function describeTrigger(tr: NonNullable<Ability["trigger"]>): string {
  if (!tr.alsoOn?.length) return describeTriggerSingle(tr);
  const base = { ...tr, alsoOn: undefined, interveningIf: undefined };
  const parts = [base, ...tr.alsoOn.map((a) => ({ ...base, ...a }))].map((t) => describeTriggerSingle(t).replace(/^Whenever /, ""));
  let out = parts[0];
  for (const p of parts.slice(1)) {
    // share the leading subject: "Foo enters" + "Foo attacks" -> "Foo enters or attacks"
    const w1 = out.split(" "), w2 = p.split(" ");
    let k = 0;
    while (k < w1.length - 1 && k < w2.length - 1 && w1[k] === w2[k]) k++;
    out += ` or ${k > 0 ? w2.slice(k).join(" ") : p}`;
  }
  return withIf(`Whenever ${out}`, tr);
}

function describeTriggerSingle(tr: NonNullable<Ability["trigger"]>): string {
  if (tr.chapters?.length) return `Chapter ${tr.chapters.map(roman).join(", ")}`;
  const whoseWord = tr.whose === "yours" ? "your" : tr.whose === "opponents" ? "each opponent's" : "each";
  if (tr.event === "begin_step") {
    const step = String(tr.step ?? "upkeep");
    if (step === "beginning_of_combat") return withIf(`At the beginning of combat on ${tr.whose === "yours" ? "your turn" : tr.whose === "opponents" ? "each opponent's turn" : "each turn"}`, tr);
    const noun = step === "upkeep" ? "upkeep" : (PHASE_NOUN[step] ?? step.replace(/_/g, " "));
    return withIf(`At the beginning of ${whoseWord} ${noun}`, tr);
  }
  if (tr.event === "unspecified" && tr.interveningIf) return `When ${describePredicate(tr.interveningIf)}`;

  // who does it: a player subject, or the `whose` field
  const subjIsPlayer = typeof tr.subject === "string" && PLAYER_SUBJECTS.has(tr.subject);
  const actorKey = subjIsPlayer ? (tr.subject as string) : tr.whose === "yours" ? "you" : tr.whose === "opponents" ? "opponent" : tr.whose === "each" ? "each_player" : undefined;
  const actor = actorKey ? (actorKey === "each_player" ? "a player" : actorKey === "each_opponent" ? "an opponent" : playerName(actorKey)) : undefined;
  const actorIsYou = actorKey === "you";
  const poss = actorIsYou ? "your" : "their";

  // the object the event is about
  let objNp: string | undefined;
  let objPlural = false;
  if (tr.subject !== undefined && !subjIsPlayer) {
    if (typeof tr.subject === "string") objNp = refName(tr.subject);
    else if (tr.batch) { objNp = `one or more ${describeFilter(tr.subject, { plural: true })}`; objPlural = true; }
    else objNp = withArticle(describeFilter(tr.subject));
  }
  const verb = (ev: string, pl: boolean) => EVENT_VERBS[ev]?.[pl ? 1 : 0] ?? ev.replace(/_/g, " ");
  const nth = tr.nth ? `${ordinal(tr.nth.n)} ` : "";
  const per = tr.nth ? ` each ${tr.nth.per}` : "";
  const ev = tr.event;
  const actorVerb = (e: string) => `${actor ?? "a player"} ${verb(e, actorIsYou)}`;
  const filterSubj = tr.subject !== undefined && !subjIsPlayer && typeof tr.subject !== "string" ? tr.subject : undefined;
  let body: string;
  switch (ev) {
    case "etb": body = `${objNp ?? "a permanent"} ${verb(ev, objPlural)}`; break;
    case "dies": body = `${objNp ?? "a creature"} ${verb(ev, objPlural)}`; break;
    case "leaves": {
      const s = objNp ?? "a permanent";
      if (tr.toZone) body = `${s} ${objPlural ? "are" : "is"} put into ${ZONE_NAMES[tr.toZone] ?? tr.toZone}${tr.fromZone ? ` from ${ZONE_NAMES[tr.fromZone] ?? tr.fromZone}` : ""}`;
      else body = `${s} ${verb(ev, objPlural)} ${ZONE_NAMES[tr.fromZone ?? "battlefield"] ?? tr.fromZone}`;
      break;
    }
    case "cast": {
      const spellNp = filterSubj ? withArticle(describeFilter(filterSubj, { spell: true })) : objNp ?? "a spell";
      body = `${actorVerb(ev)} ${tr.nth ? `${poss} ${nth}spell${per}` : spellNp}`;
      break;
    }
    case "draw": body = `${actorVerb(ev)} ${tr.nth ? `${poss} ${nth}card${per}` : "a card"}`; break;
    case "discard": {
      const what = filterSubj ? withArticle(`${describeFilter({ ...filterSubj, zone: undefined })}${filterSubj.types?.length || filterSubj.subtypes?.length ? " card" : ""}`) : "a card";
      body = `${actorVerb(ev)} ${tr.nth ? `${poss} ${nth}card${per}` : what}`;
      break;
    }
    case "attack": {
      if (tr.minCount) body = `${actor ?? "you"} ${verb(ev, actorIsYou || !actor)} with ${numberWord(tr.minCount)} or more ${filterSubj ? describeFilter(filterSubj, { plural: true }) : "creatures"}`;
      else body = objNp ? `${objNp} ${verb(ev, objPlural)}` : `${actor ?? "a creature"} ${verb(ev, actorIsYou)}`;
      if (tr.alone) body += " alone";
      if (tr.defender) body += tr.defender === "you" ? " you" : tr.defender === "you_or_your_planeswalkers" ? " you or a planeswalker you control" : " a player other than you";
      break;
    }
    case "damage_prevented": body = `damage that would be dealt to ${actor ?? "you"} is prevented`; break;
    case "dealt_damage": body =`${objNp ?? "a creature"} ${objPlural ? "are" : "is"} dealt damage`; break;
    case "commit_crime": body = `${actorVerb(ev)} a crime`; break;
    case "block": body = `${objNp ?? "a creature"} ${verb(ev, objPlural)}`; break;
    case "deals_damage": body = `${objNp ?? "a source"} ${verb(ev, objPlural)} damage`; break;
    case "deals_combat_damage_to_player": body = `${objNp ?? "a creature"} ${verb(ev, objPlural)} combat damage to ${tr.whose === "yours" ? "you" : tr.whose === "opponents" ? "an opponent" : "a player"}`; break;
    case "gain_life": body = `${actorVerb(ev)} life`; break;
    case "lose_life": body = `${actorVerb(ev)} life`; break;
    case "token_created": body = `${actorVerb(ev)} ${filterSubj ? withArticle(describeFilter({ ...filterSubj, token: true })) : "a token"}`; break;
    case "counter_put": body = `a counter is put on ${objNp ?? "a permanent"}`; break;
    case "sacrifice": body = !actor && objNp ? `${objNp} ${objPlural ? "are" : "is"} sacrificed` : `${actorVerb(ev)} ${objNp ?? "a permanent"}`; break;
    case "exploit": body = `${objNp ?? selfName()} ${verb(ev, objPlural)} a creature`; break;
    case "cycle": body = `${actorVerb(ev)} ${objNp ?? "a card"}`; break;
    case "tap": body = objNp ? `${objNp} ${verb(ev, objPlural)}` : `${actorVerb(ev)} a permanent`; break;
    case "landfall": body = `a land enters under ${tr.whose === "opponents" ? "an opponent's" : tr.whose === "each" ? "a player's" : "your"} control`; break;
    case "becomes_target": body = `${objNp ?? "a permanent"} ${verb(ev, objPlural)} the target of a spell or ability`; break;
    case "activate": body = `${actorVerb(ev)} an ability${objNp ? ` of ${objNp}` : ""}`; break;
    case "mill": body = `${actorVerb(ev)} a card`; break;
    default: body = `${objNp ?? actor ?? "something"} ${ev.replace(/_/g, " ")}`;
  }
  // nth on events that have no natural "your second card" wording
  if (tr.nth && !["cast", "draw", "discard"].includes(ev)) body += ` for the ${ordinal(tr.nth.n)} time each ${tr.nth.per}`;
  return withIf(`Whenever ${body}`, tr);
}

function withIf(base: string, tr: NonNullable<Ability["trigger"]>): string {
  const quals = [tr.notFromZone ? `from anywhere other than ${ZONE_NAMES[tr.notFromZone] ?? tr.notFromZone}` : "", tr.damageSource ? `(damage source: ${withArticle(describeFilter(tr.damageSource))})` : ""].filter(Boolean).join(" ");
  const withQ = quals ? `${base} ${quals}` : base;
  return tr.interveningIf ? `${withQ}, if ${describePredicate(tr.interveningIf)}` : withQ;
}
