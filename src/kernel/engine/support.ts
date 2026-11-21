// Static capability check: what in a card the ENGINE (not the older capabilities.ts registry) can run today.
// Returns capability names in the same "kind:detail" style as `needs` in the card JSON. resolve() refuses to cast /
// play / activate anything with a non-empty result (strict mode), so nothing is ever silently skipped.

import type { Ability, Cost, ObjectFilter, Predicate, Quantity, Step } from "../schema";
import { SUPPORTED_FILTER_KEYS } from "./query";
import { META_FIELDS, STEP_FIELDS, SUPPORTED_ENGINE_STEP_KINDS } from "./steps";
import { CHOOSE_CHOICES } from "./choose";

import { SEARCH_DESTINATIONS } from "./library";
import { REPEAT_PLAYER_REFS } from "./repeat";
import { unlessPaySupported, type UnlessPay } from "./unlesspay";
import type { CardDef } from "./types";
import { castOptionUnsupported } from "./castopts";
import { SUPPORTED_DURABLE_DURATIONS } from "./durable";
import { SIMPLE_TRIGGER_EVENTS } from "./triggers6";

const PASSIVE_KEYWORDS = new Set([
  "flying", "haste", "vigilance", "trample", "first strike", "double strike", "deathtouch", "lifelink", "reach", "menace",
  "indestructible", "hexproof", "flash", "defender", "shroud", "fear", "intimidate", "unblockable", "skulk", "shadow", "landwalk", "changeling", "saga",
  // "enchant <filter>": the Aura's target is the spell's own target (resolve.ts attaches it on resolution, SBA 704.5m)
  "enchant",
  // label-only keywords: the faces / rules they name are modelled by the abilities themselves
  "back_face", "back face", "improvise", "convoke"
]);
/** Keywords a static ability may grant / remove: only the passive ones the engine reads from chars().keywords. */
const isPassive = (k: string) => PASSIVE_KEYWORDS.has(k.toLowerCase()) && k.toLowerCase() !== "enchant";
const TOKEN_FILTER_KEYS = new Set(["types", "notTypes", "subtypes", "notSubtypes", "colors", "notColors", "controller", "token", "anyOf", "colored"]);
const SUPPORTED_PREDICATES = new Set([
  "cast_during", "cast_from", "turn_is", "phase_is", "controls", "life", "zone_count", "did_this_turn", "nth_this_turn", "compare",
  "stat", "matches", "source_state", "step_done", "most_life", "kicked", "paid_additional_cost", "cast_with", "chosen_is", "mana_spent"
]);
const SUPPORTED_QUANTITY_REFS = new Set(["X", "count", "stat", "counters", "life_lost_this_way", "event_amount", "life_total", "starting_life", "count_this_turn", "greatest", "sum", "step_result", "players_count", "opponents_count", "commander_colors", "devotion"]);
const SUPPORTED_REFS = new Set(["linked_exile", "self", "chosen", "event_object", "created", "iterated", "enchanted", "sacrificed", "looked_cards", "rest_of_looked_cards"]);
const COMBAT_TRIGGER_EVENTS = new Set(["attack", "block", "deals_damage", "deals_combat_damage_to_player", "dealt_damage"]);
export const SUPPORTED_TRIGGER_EVENTS = new Set(["etb", "dies", "cast", "begin_step", "cycle", "leaves", "becomes_target", "unspecified", ...COMBAT_TRIGGER_EVENTS, ...SIMPLE_TRIGGER_EVENTS]);
const SUPPORTED_BEGIN_STEPS = new Set(["upkeep", "end_step", "draw", "beginning_of_combat", "declare_attackers", "declare_blockers", "end_of_combat", "precombat_main", "postcombat_main"]);
/** Scripted markers the engine implements (resolve.ts). A scripted ability is otherwise reported as unsupported. */
export const SCRIPTED_HANDLERS: ReadonlySet<string> = new Set(["roll_d20_result_is_X", "storm", "become_monarch", "crew", "can_be_your_commander", "next_spell_gains_keyword", "next_spell_this_turn_cant_be_countered", "improvise"]);
const PLAIN_COST = /^(\{(\d+|[WUBRGC])\})+$/;

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
  if (q.ref === "players_count" && "where" in q) checkPredicate((q as unknown as { where: Predicate }).where, out);
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

function checkCost(c: Cost, out: string[], kind?: string): void {
  if ("unsupported" in c) return add(out, "cost:unsupported");
  // hybrid / Phyrexian symbols are settled by mana.settleCost (a mana ABILITY with such a cost, Fetid Heath, is not supported)
  if ("mana" in c) return; // hybrid / Phyrexian symbols are settled by mana.settleCost (Phyrexian ones are asked as a decision)
  if ("tap" in c) return;
  // sacrifice / discard / exile / tap / return costs that need a choice: asked as decisions while activating (costs.ts); not for mana abilities
  if ("sacrifice" in c) { if (c.sacrifice !== "self") checkFilter(c.sacrifice, out); checkQuantity(c.count, out); return; }
  if ("discard" in c) { if (c.discard === "self") { if (kind !== "activated") add(out, "cost:discard_self"); } else { if (typeof c.discard === "object") checkFilter(c.discard, out); } checkQuantity(c.count, out); return; }
  if ("exileFrom" in c) {
    if ((c as unknown as { what: unknown }).what === "self") { if (c.exileFrom !== "battlefield") add(out, "cost:exile_self_from_zone"); }
    else if (!["graveyard", "hand", "exile"].includes(c.exileFrom)) add(out, `cost:exile_from_${c.exileFrom}`);
    else checkFilter(c.what as object, out);
    checkQuantity(c.count, out); return;
  }
  if ("tapOther" in c) { checkFilter(c.tapOther, out); checkQuantity(c.count, out); return; }
  if ("returnToHand" in c) { if (c.returnToHand === "self") add(out, "cost:return_self_to_hand"); else checkFilter(c.returnToHand, out); checkQuantity(c.count, out); return; }
  if ("life" in c) return checkQuantity(c.life, out);
  if ("loyalty" in c) { if (kind !== "activated") add(out, "cost:loyalty"); return checkQuantity(c.loyalty, out); }
  if ("counters" in c) { if (c.counters.from !== "self") { if (!c.counters.remove) add(out, "cost:counters_from_filter"); else checkFilter(c.counters.from as ObjectFilter, out); checkQuantity(c.counters.count as Quantity | undefined, out); } return; }
  add(out, `cost:${Object.keys(c).find((k) => k !== "prompt" && k !== "src" && k !== "count" && k !== "what")}`);
}

function checkStep(s: Step, out: string[]): void {
  if (!SUPPORTED_ENGINE_STEP_KINDS.has(s.kind)) add(out, `step:${s.kind}`);
  else {
    const allowed = STEP_FIELDS[s.kind];
    for (const k of Object.keys(s)) if (!META_FIELDS.includes(k) && !allowed.includes(k) && !["then", "else", "if"].includes(k)) add(out, `field:${s.kind}.${k}`);
  }
  if (s.kind === "add_counters" && s.counterPT) { const k = String(s.counterKind), pt = s.counterPT as number[]; if (!((k === "+1/+1" && pt[0] === 1 && pt[1] === 1) || (k === "-1/-1" && pt[0] === -1 && pt[1] === -1))) add(out, "field:add_counters.counterPT"); }
  if (s.unlessPay && !unlessPaySupported(s.unlessPay as unknown as UnlessPay)) add(out, "step:unless_pay");
  if (s.kind === "choose") {
    if (s.choice !== undefined && !CHOOSE_CHOICES.includes(s.choice)) add(out, `field:choose.choice=${s.choice}`);
    if (s.choice === undefined && !s.from && !s.fromLooked && !s.fromRevealed && !s.fromMilled) add(out, "field:choose.from");
    if (s.choice === "mode" && !(s.options as string[] | undefined)?.length) add(out, "field:choose.options");
    if (s.choice === "number" && s.max === undefined) add(out, "field:choose.max");
    for (const k of ["count", "min", "max"]) checkQuantity(s[k] as Quantity | undefined, out);
    if (s.from) checkFilter(s.from as object, out);
  }
  if (s.kind === "move_card_zone") {
    if (!s.target && !s.what && !(s.from ?? s.moveFrom)) add(out, "field:move_card_zone.from");
    if (typeof s.what === "string" && ["exiled_this_way", "creature_type"].includes(s.what)) add(out, `field:move_card_zone.what=${s.what}`);
    if (s.ordered !== undefined && s.ordered !== "any_order") add(out, "field:move_card_zone.ordered");
    if (s.moveCount !== undefined && s.moveCount !== "all" && (s.from ?? s.moveFrom) !== "library") add(out, "field:move_card_zone.moveCount");
    if (s.what === "choose" && s.who && s.who !== "you") add(out, "field:move_card_zone.who");
    checkQuantity(typeof s.moveCount === "object" ? (s.moveCount as Quantity) : undefined, out);
    if (s.withCounters) checkQuantity((s.withCounters as { count: Quantity }).count, out);
  }
  if (s.kind === "search_library") {
    if (s.to !== undefined && !SEARCH_DESTINATIONS.includes(String(s.to))) add(out, `field:search_library.to=${String(s.to)}`);
    if (typeof s.count === "string" && s.count !== "any") add(out, "field:search_library.count");
    checkQuantity(typeof s.count === "object" ? (s.count as Quantity) : undefined, out);
  }
  if (s.kind === "create_tokens") for (const a of ((s.tokenAbilities as Ability[] | undefined) ?? [])) abilityUnsupported(a).forEach((n) => add(out, n));
  if (s.kind === "create_emblem") for (const a of ((s.emblem as { abilities?: Ability[] } | undefined)?.abilities ?? [])) abilityUnsupported({ ...a, zone: "battlefield" }).forEach((n) => add(out, n)); // emblem abilities work from the command zone, judged as if on the battlefield
  if (s.kind === "reveal" && !(s.until !== undefined || s.what === "top_card_of_library" || (s.what === undefined && (s.target || s.filter)))) add(out, `field:reveal.what=${String(s.what)}`);
  if (s.kind === "repeat_for_each") {
    if (typeof s.over === "string" ? !REPEAT_PLAYER_REFS.includes(s.over) : !s.over) add(out, `field:repeat_for_each.over`);
    if (s.over && typeof s.over === "object") checkFilter(s.over as object, out);
  }
  if (s.kind === "grant_effect" && !s.target && !s.filter) {
    // player-scoped: a replacement shield or the "no maximum hand size" flag
    const mods = (s.modify ?? []) as Array<Record<string, unknown>>;
    if (s.replacement) checkReplacement({ id: "g", kind: "replacement", text: "", replacement: { ...(s.replacement as object), duration: undefined } } as unknown as Ability, out);
    else if (s.appliesTo === "next_spell_cast") { /* handled below */ } else if (!(mods.length && mods.every((m) => "grant" in m && String(m.grant).toLowerCase() === "no maximum hand size"))) add(out, "field:grant_effect.who");
    if (s.appliesTo && s.appliesTo !== "next_spell_cast") add(out, "field:grant_effect.appliesTo");
    if (s.appliesTo === "next_spell_cast") for (const m of (s.modify ?? []) as Array<Record<string, unknown>>) if (!(typeof m.grant === "string" || m.cant === "be_countered")) add(out, "field:grant_effect.modify");
  }
  if (s.kind === "permission_to_play") {
    const ref = (s.what ?? s.target) as string | undefined;
    if (!ref) add(out, "field:permission_to_play.what");
  }
  if (s.kind === "add_mana") {
    const sp = (s.produces ?? []) as Array<Record<string, unknown>>;
    if (!sp.length || sp.some((x) => !(typeof x.anyColor === "number" || x.anyColorAmount !== undefined || typeof x.chosenColor === "number" || (typeof x.colors === "string" && /^(\{[WUBRGC]\})+$/.test(x.colors))))) add(out, "field:add_mana.produces");
  }
  // "amount fixed as you cast it": X is already fixed at cast time; any other quantity would have to be evaluated then (not modelled)
  if (s.amountLockedOn && ["amount", "power", "toughness"].some((k) => s[k] !== undefined && JSON.stringify(s[k]).replace(/"ref":"X"/g, "").includes('"ref"'))) add(out, "field:amountLockedOn");
  if (s.duration !== undefined && s.duration !== "until_end_of_turn") {
    const d = s.duration;
    const playerGrant = s.kind === "grant_effect" && !s.target && !s.filter;
    const ok = (s.kind === "exile_target" && d === "while_source_on_battlefield") || (s.kind === "permission_to_play" && d === "instant" && ((s.what ?? s.target) === "linked_exile")) || ((s.kind === "permission_to_play" || s.kind === "gain_control") && typeof d === "string" && SUPPORTED_DURABLE_DURATIONS.has(d))
      || (playerGrant && typeof d === "string" && (SUPPORTED_DURABLE_DURATIONS.has(d) || d === "instant"))
      || (playerGrant && typeof d === "object" && "until" in d && String(d.until) === "unspecified");
    if (!ok) add(out, `duration:${typeof d === "string" ? d : Object.keys(d)[0]}`);
  }
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

// ---------------------------------------------------------------- statics (layers.ts) and replacements (replacements.ts)

const PLAYER_AFFECTS = new Set(["you", "each_player", "each_opponent"]);
const PLAYER_GRANTS = new Set(["hexproof", "can't lose the game", "no maximum hand size", "keep_unspent_red_mana_between_steps_and_phases"]);
const isPlayerGrant = (g: string): boolean => PLAYER_GRANTS.has(g.toLowerCase()) || /^cast [\w ]+? spells as though they had flash$/i.test(g.replace(/_/g, " "));

function checkStatic(a: Ability, out: string[]): void {
  const sp = a.static;
  if (!sp) return add(out, "static");
  const aff = sp.affects;
  const playerMods = sp.modify.every((m) => "costMod" in m || "extraLandDrops" in m);
  const playerStatic = typeof aff === "string" && PLAYER_AFFECTS.has(aff) && sp.modify.every((m) => "costMod" in m || "extraLandDrops" in m || ("grant" in m && isPlayerGrant(m.grant)) || ("cant" in m && m.cant === "cast"));
  if (typeof aff === "string") {
    if (aff === "self" || aff === "enchanted" || aff === "equipped") { /* supported (attachedTo host) */ }
    else if (PLAYER_AFFECTS.has(aff) && (playerMods || playerStatic)) { /* costMod / extraLandDrops / player grants read the player */ }
    else add(out, `static:affects:${aff}`);
  } else checkFilter(aff, out);
  if (typeof aff !== "string" && playerMods) add(out, "static:affects:filter_for_player_effect");
  if (typeof aff === "string" && PLAYER_AFFECTS.has(aff) && !playerMods && !playerStatic) add(out, `static:affects:${aff}`);
  for (const m of sp.modify) {
    if (playerStatic) continue;
    if ("grantAbility" in m) { abilityUnsupported(m.grantAbility as Ability).forEach((n) => add(out, n)); continue; }
    if ("pt" in m) { checkQuantity(m.pt.power, out); checkQuantity(m.pt.toughness, out); }
    else if ("setBasePT" in m) { checkQuantity(m.setBasePT.power, out); checkQuantity(m.setBasePT.toughness, out); }
    else if ("addTypes" in m || "setTypes" in m || "setColors" in m) { /* layers 4 / 5 */ }
    else if ("grant" in m) { if (!isPassive(m.grant) && m.grant.toLowerCase() !== "goaded") add(out, `static:grant:${m.grant}`); }
    else if ("lose" in m) { if (m.lose.toLowerCase() !== "all abilities" && !isPassive(m.lose)) add(out, `static:lose:${m.lose}`); }
    else if ("cant" in m) {
      if (m.cant !== "attack" && m.cant !== "block" && m.cant !== "be_blocked" && m.cant !== "be_countered") add(out, `static:cant:${m.cant}`);
      if (m.except) checkFilter(m.except, out);
      if (m.protects && m.cant !== "attack") add(out, "static:cant.protects");
    }
    else if ("mustAttack" in m || "evasion" in m) { if ("evasion" in m) { checkFilter(m.evasion.cantBeBlockedBy, out); checkFilter(m.evasion.unlessDefenderControls, out); } }
    else if ("attackTax" in m) { if (!PLAIN_COST.test(m.attackTax.cost)) add(out, "static:attackTax.cost"); }
    else if ("blockTax" in m) { if (!PLAIN_COST.test(m.blockTax.cost)) add(out, "static:blockTax.cost"); }
    else if ("costMod" in m) { checkFilter(m.costMod.filter, out); checkQuantity(m.costMod.delta, out); }
    else if ("extraLandDrops" in m) { /* landDrops() */ }
    else add(out, `static:${Object.keys(m)[0]}`);
  }
  if (sp.duration) add(out, `static:duration`);
  checkPredicate(sp.while, out);
}

const REPL_STEP_EVENTS = new Set(["would_draw", "would_gain_life", "would_lose_life", "would_deal_damage", "would_die", "would_be_put_into_zone", "would_discard"]);
const MODIFY_KEYS: Record<string, string[]> = {
  would_enter: ["tapped", "counters"], would_create_token: ["count", "tapped"], would_gain_life: ["amount"], would_lose_life: ["amount"],
  would_deal_damage: ["amount", "damageMultiplier"], would_be_put_into_zone: ["to"], would_die: ["to"], would_add_counters: ["amount"]
};

function checkReplacement(a: Ability, out: string[]): void {
  const sp = a.replacement;
  if (!sp) return add(out, "replacement");
  const ev = sp.event as string;
  const bad = (detail: string) => add(out, `replacement:${ev}.${detail}`);
  // a one-shot shield written on a spell / activated ability: only "prevent damage until end of turn" is modelled (it becomes a durable replacement when the ability resolves)
  if (a.kind !== "replacement") {
    if (!((a.kind === "spell_effect" || a.kind === "activated") && ev === "would_deal_damage" && sp.result.mode === "prevent" && sp.duration === "until_end_of_turn")) return add(out, `replacement:${ev}.shield`);
    checkFilter(sp.damageSource, out);
    return;
  }
  if (!["would_enter", "would_create_token", "would_add_counters", ...REPL_STEP_EVENTS].includes(ev)) return add(out, `replacement:${ev}`);
  if (sp.duration) bad("duration");
  checkPredicate(sp.condition, out);
  checkFilter(sp.damageSource, out);
  if (sp.recipient && typeof sp.recipient === "object") checkFilter(sp.recipient, out);
  const subj = sp.subject;
  if (subj && typeof subj === "object") {
    if (ev === "would_create_token") for (const k of Object.keys(subj)) { if (!TOKEN_FILTER_KEYS.has(k)) add(out, `filter:${k}@token_replacement`); }
    else checkFilter(subj, out);
  }
  const res = sp.result;
  if (res.mode === "prevent") { if (ev === "would_enter") bad("prevent"); return; }
  if (res.mode === "modify") {
    const ok = MODIFY_KEYS[ev] ?? [];
    for (const k of Object.keys(res.set)) {
      if (k === "unlessPay" && ev === "would_enter" && Object.keys(res.set[k] as object).join() === "life") continue; // optional life payment (replacements.applyUnlessPay)
      if (!ok.includes(k)) bad(`modify.${k}`);
    }
    return;
  }
  const steps = res.steps;
  steps.forEach((s) => checkStep(s, out));
  if (ev === "would_enter") {
    const asCopy = res.mode === "instead" && steps.every((s) => s.kind === "copy" && s.asEnters);
    if (res.mode !== "also" && !asCopy) return bad(res.mode);
    // "as this enters" steps run before the permanent moves (replacements.applyEnterSteps): counters, tapping it, a payment, a color choice
    for (const s of steps) {
      const okKind = ["add_counters", "tap_target", "life_change", "choose", "copy", "reveal"].includes(s.kind);
      const okOn = s.kind === "add_counters" ? (s.on === undefined || s.on === "self" || s.on === "event_object") : s.kind === "tap_target" ? (s.target === "self" || s.target === "event_object") : s.kind === "copy" ? (s.asEnters === true || s.target === "self") : true;
      if (!okKind || !okOn) bad(`also:${s.kind}`);
    }
  } else if (ev === "would_create_token") {
    for (const s of steps) { if (s.kind !== "create_tokens") bad(`step:${s.kind}`); else if (s.who !== undefined && s.who !== "you") bad("who"); }
  } else if (!REPL_STEP_EVENTS.has(ev)) bad(res.mode);
}

/** Abilities that work from another zone: statics in graveyard / command / on the stack, activated from hand / graveyard (cycling, channel), "when you cycle this", "when you cast this spell". */
function zoneSupported(a: Ability): boolean {
  if ((a.kind === "static" || a.kind === "replacement") && (a.zone === "graveyard" || a.zone === "command")) return true;
  if (a.kind === "static" && a.zone === "stack") return true;
  if (a.kind === "triggered" && a.zone === "command" && a.id.startsWith("emblem:")) return true; // an emblem's trigger (steps6.create_emblem); scanTriggers only reads emblem objects there
  if (a.kind === "activated" && (a.zone === "hand" || a.zone === "graveyard")) return true;
  if (a.kind === "triggered" && a.zone === "hand" && a.trigger?.event === "cycle") return true;
  if (a.kind === "triggered" && a.zone === "stack" && a.trigger?.event === "cast" && (a.trigger.subject === "self")) return true;
  return false;
}

/** Capabilities this one ability needs that the engine lacks. Empty = fully supported. */
export function abilityUnsupported(a: Ability): string[] {
  const out: string[] = [];
  if (a.declined) add(out, "declined");
  if (a.scripted && !SCRIPTED_HANDLERS.has(a.scripted.handler)) add(out, `scripted:${a.scripted.handler}`);
  if (a.replacement || a.kind === "replacement") checkReplacement(a, out);
  if (a.static || (a.kind === "static" && !a.costReduction)) checkStatic(a, out);
  if (a.costReduction) {
    // implemented for a spell's own affinity-style keyword ("costs {1} less for each ..."): layers.ts spellCostDelta
    const cr = a.costReduction;
    // a spell's own (keyword / static on the stack) or an activated ability's own ("this ability costs {1} less") reduction of the generic part
    const own = ((a.kind === "keyword" || a.kind === "static" || a.kind === "cast_option") && (!a.zone || a.zone === "stack")) || (a.kind === "activated" && (!a.zone || a.zone === "hand" || a.zone === "graveyard"));
    if (!own || cr.applies !== "generic") add(out, "cost_reduction");
    else { checkFilter(cr.per, out); checkQuantity(cr.amount, out); checkPredicate(cr.condition, out); }
  }
  // cycling / channel are activated abilities (the keyword is only a label); the costs and steps carry the rules
  const kwn = String((a.keyword as { name?: string } | undefined)?.name ?? "").toLowerCase();
  const labelKw = a.kind === "activated" && ["crew", "cycling", "channel", "landcycling", "basic landcycling", "typecycling", "equip"].includes(kwn);
  if (a.keyword && !PASSIVE_KEYWORDS.has(kwn.replace(/_/g, " ")) && !labelKw && !(a.costReduction && kwn === "affinity") && !(a.kind === "triggered" && a.trigger && (a.trigger.event === "cycle" || ["living_weapon", "storm", "ward", "hideaway", "training", "mentor", "dethrone", "survival", "exploit", "myriad"].includes(kwn)))) add(out, `keyword:${kwn || "?"}`);
  if (a.zone && a.zone !== "battlefield" && a.kind !== "spell_effect" && !zoneSupported(a)) add(out, `zone:${a.zone}`);
  // several specs = alternatives ("Add {W} or {B}"); the engine runs them when each is a single fixed mana symbol
  // several specs = alternatives; each must be fixed symbols ("Add {W} or {B}", "Add {W}{W}, {W}{B}, or {B}{B}")
  if (a.mana && a.mana.produces.length > 1 && !a.mana.produces.every((m) => "colors" in m && /^({[WUBRGC]})+$/.test(m.colors))) add(out, "mana:multiple_specs");
  if (a.mana?.produces.some((m) => "anyColorAmount" in m)) add(out, "mana:variable_amount");
  if (a.modes?.repeatRestriction) add(out, "modes:repeat_restriction");
  if (a.modes?.distinctTargets) add(out, "modes:distinct_targets");
  const t = a.timing;
  if (t?.window) add(out, "timing:window");
  t?.only?.forEach((p) => checkPredicate(p, out));
  a.costs?.forEach((c) => checkCost(c, out, a.kind));
  a.conditions?.forEach((c) => checkPredicate(c.if, out));
  const tr = a.trigger;
  if (tr) {
    // the main event and every alsoOn alternative (omitted qualifiers are inherited)
    const alts = [tr, ...(tr.alsoOn ?? []).map((x) => ({ ...tr, ...Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)) }) as typeof tr)];
    for (const t of alts) {
      const combat = COMBAT_TRIGGER_EVENTS.has(t.event);
      if (!SUPPORTED_TRIGGER_EVENTS.has(t.event)) add(out, `trigger:${t.event}`);
      if (t.event === "begin_step" && !(t.step && SUPPORTED_BEGIN_STEPS.has(t.step))) add(out, `trigger:begin_step:${t.step ?? "?"}`);
      for (const k of ["fromZone", "toZone", "chapters", "notFromZone"] as const) if (t[k] !== undefined && !((t.event === "leaves" || t.event === "etb") && (k === "fromZone" || k === "toZone")) && !(t.event === "counter_put" && k === "chapters")) add(out, `trigger:${k}`);
      // state trigger: event unspecified on the permanent itself with a condition (queueStateTriggers); anything else "unspecified" is not modelled
      if (t.event === "unspecified" && !(tr.interveningIf && (t.subject === undefined || t.subject === "self"))) add(out, "trigger:unspecified");
      if (t.batch && !(["attack", "deals_combat_damage_to_player", "counter_put", "dies", "leaves", "etb"].includes(t.event))) add(out, "trigger:batch");
      if (t.minCount !== undefined && !(t.batch && combat)) add(out, "trigger:minCount");
      if (t.defender !== undefined && t.event !== "attack") add(out, "trigger:defender");
      if (t.damageSource !== undefined && t.event !== "dealt_damage" && t.event !== "deals_damage") add(out, "trigger:damageSource");
      if (t.nth && (t.nth.per !== "turn" || !(t.event === "cast" || ["draw", "gain_life", "lose_life", "discard", "mill", "sacrifice", "token_created"].includes(t.event)))) add(out, "trigger:nth");
      if (t.subject && typeof t.subject === "object") checkFilter(t.subject, out);
      if (t.subject && typeof t.subject === "string") {
        const base = ["self", "you", "opponent", "each_opponent", "each_player"];
        if (!base.includes(t.subject) && !((combat || SIMPLE_TRIGGER_EVENTS.has(t.event) || t.event === "dies" || t.event === "leaves") && (t.subject === "enchanted" || t.subject === "equipped"))) add(out, `trigger:subject:${t.subject}`);
      }
      if (t.damageSource) checkFilter(t.damageSource, out);
    }
    if (tr.alsoOn?.some((x) => x.event === "begin_step" && !(x.step && SUPPORTED_BEGIN_STEPS.has(x.step)))) add(out, "trigger:begin_step");
    checkPredicate(tr.interveningIf, out);
  }
  const specs = [...(a.targets ?? []), ...(a.modes?.options.flatMap((o) => o.targets ?? []) ?? [])];
  for (const sp of specs) { if (sp.maxQuantity !== undefined) checkQuantity(sp.maxQuantity, out); checkFilter(sp.filter, out); checkPredicate(sp.onlyIf, out); }
  a.steps?.forEach((s) => checkStep(s, out));
  a.modes?.options.forEach((o) => o.steps.forEach((s) => checkStep(s, out)));
  return out;
}

export interface CardSupport { ok: boolean; abilities: Array<{ id: string; needs: string[] }>; castOptions: string[]; all: string[] }

/** Everything one cast option needs that the engine lacks (kind, costs, added steps, condition). */
export function castOptionNeeds(c: NonNullable<CardDef["kernel"]["castOptions"]>[number]): string[] {
  const out = castOptionUnsupported(c);
  c.cost.forEach((k) => checkCost(k, out));
  c.effects?.addSteps?.forEach((s) => checkStep(s, out));
  checkPredicate(c.condition, out);
  return out;
}

/** Predicates that read how a spell was cast name an option of THIS card (its id or kind); anything else cannot be answered. */
function castPredicateNeeds(def: CardDef, out: string[]): void {
  const tags = new Set((def.kernel.castOptions ?? []).flatMap((c) => [c.id, c.kind]));
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (typeof o.check === "string" && ["kicked", "paid_additional_cost", "cast_with"].includes(o.check) && typeof o.option === "string" && !tags.has(o.option)) add(out, `predicate:${o.check}:${o.option}`);
    Object.values(o).forEach(walk);
  };
  walk(def.kernel.abilities);
}

export function cardUnsupported(def: CardDef): CardSupport {
  const abilities = def.kernel.abilities.map((a) => ({ id: a.id, needs: abilityUnsupported(a) }));
  const castOptions = (def.kernel.castOptions ?? []).flatMap((c) => castOptionNeeds(c));
  castPredicateNeeds(def, castOptions);
  const all = [...new Set([...abilities.flatMap((a) => a.needs), ...castOptions])];
  return { ok: all.length === 0, abilities, castOptions, all };
}
