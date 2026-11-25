// Step interpreter. A resolving ability is an `Exec` (a stack of step-list frames + an environment). Every step
// either completes, pushes more steps (expansion), or asks a decision; when it asks, the whole Exec is stored in the
// pending decision and re-entered with the answer. A handler must not mutate before it asks.

import { protectedFrom } from "./protection";
import { phaseOut } from "./phasing";
import type { ObjectFilter, PlayerRef, Prompt, Step } from "../schema";
import { promptForMay } from "../prompts";
import {
  abilitiesOf, chars, continueHooks, opponentsOf, targetHooks, continuing, drawCards, emit, label, moveObject, NeedAsk, newObject, obj, parseManaCost, player, shuffleInPlace, takeAnswer, tick, tryObj, Unsupported, Reject, type Run
  , untapObject, stunLocked
} from "./core";
import { evalPredicate, evalQuantity, matchesFilter, objectsMatching, resolveObjs, resolvePlayers, type QCtx } from "./query";
import { applyReplacements, runAfter } from "./replacements";
import type { Choice, DecisionKind, DecisionOption, Env, Exec, ObjId, PlayerId, StackItem, TokenDef } from "./types";
import type { Ability } from "../schema";
import type { ContinuousEffect } from "./types";
import { isObjId } from "./types";
import { chooseCandidates, chooserOf, chooseStep } from "./choose";
import { moveStep } from "./moves";
import { applyScry, placementSpec, readPlacement } from "./placement";
import { lookTopStep, revealStep, searchPickStep, searchStep } from "./library";
import { repeatStep } from "./repeat";
import { unlessDiscardHandler, unlessHandler, unlessPaySupported, type UnlessPay } from "./unlesspay";
import { addMana } from "./mana";
import { cantBeCountered, invalidateIndex } from "./layers";
import { attachStep } from "./attach";
import { checkCounterAnswer, counterSpec } from "./counters7";
import { copyStep } from "./copy";
import { transformStep } from "./faces";
import { delayedStep, grantToPlayers, isDurablePermission, permissionStep } from "./durablesteps";
import { saveList, setResult } from "./saved";
import { regenerates } from "./regen";
import { addCommanderDamage, isCommanderObj } from "./commander";
import { INTERNAL7, STEPS7, steps7 } from "./steps7";
import { INTERNAL11, STEPS11 } from "./step11";
import { addDurable, expiryFor, hasFlag, SUPPORTED_DURABLE_DURATIONS } from "./durable";
import { countersTransferSteps, INTERNAL6, STEPS6, wrapRevealStep } from "./steps6";

export interface AskSpec { kind: DecisionKind; player: PlayerId; prompt: Prompt; options: DecisionOption[]; min: number; max: number; repeatable?: boolean; numeric?: boolean; mana?: { total: number; colors: string[] }; counters?: { min: number; max: number; available: Record<string, number> }; placement?: { to: "bottom" | "graveyard" | "none"; stack: "top" | "bottom" }; pay?: import("./types").PayInfo }
export type StepResult = "done" | { ask: AskSpec } | { push: Step[] };
export type StepStatus = { status: "done" } | { status: "ask"; spec: AskSpec };

export const META_FIELDS = ["kind", "id", "src", "srcs", "prompt", "optional", "condition", "__asked", "unlessPay", "amountLockedOn", "optionalCost", "reflexive", "onlyPlayers"];

/** Validate an answer against the spec computed from the current state. */
export function decide(spec: AskSpec, answer: Choice | undefined): { ask: AskSpec } | { ids: string[]; number?: number; yes?: boolean } {
  if (!answer) return { ask: spec };
  if (spec.numeric) {
    const n = answer.number;
    if (typeof n !== "number" || !Number.isInteger(n) || n < spec.min || n > spec.max) throw new Reject("invalid_choice", `choose a number from ${spec.min} to ${spec.max}`);
    return { ids: [], number: n };
  }
  const ids = answer.ids ?? (answer.yes !== undefined ? [answer.yes ? "yes" : "no"] : []);
  if (ids.length < spec.min || ids.length > spec.max) throw new Reject("invalid_choice", `choose between ${spec.min} and ${spec.max} option(s), got ${ids.length}`);
  const valid = new Set(spec.options.map((o) => o.id));
  for (const id of ids) if (!valid.has(id)) throw new Reject("invalid_choice", `"${id}" is not a legal option`);
  if (!spec.repeatable && new Set(ids).size !== ids.length) throw new Reject("invalid_choice", "options must be distinct");
  return { ids, yes: ids[0] === "yes" };
}

export const fallbackPromptOf = (r: Run, env: Env, title: string, instruction: string): Prompt => ({ title: `${label(r, env.source)}: ${title}`, instruction });
const fallbackPrompt = (r: Run, env: Env, title: string, instruction: string): Prompt => ({ title: `${label(r, env.source)}: ${title}`, instruction });
const promptOr = (r: Run, env: Env, step: Step, title: string, instruction: string): Prompt => step.prompt ?? fallbackPrompt(r, env, title, instruction);
const cardOptions = (r: Run, ids: ObjId[]): DecisionOption[] => ids.map((id) => ({ id, label: label(r, id) }));

// ---------------------------------------------------------------- shared effects

export function changeLife(r: Run, env: Env | undefined, pid: PlayerId, delta: number): void {
  if (delta === 0) return;
  const ev = applyReplacements(r, { kind: delta > 0 ? "gain_life" : "lose_life", player: pid, amount: Math.abs(delta) });
  if (ev.cancelled || (ev.kind !== "gain_life" && ev.kind !== "lose_life") || ev.amount <= 0) { runAfter(r, ev); return; }
  delta = delta > 0 ? ev.amount : -ev.amount;
  const p = player(r, pid);
  p.life += delta;
  if (delta > 0) { emit(r, { type: "life_gain", player: pid, amount: delta, life: p.life }); r.s.turnLog.push({ type: "gain_life", player: pid, amount: delta, ts: r.s.clock }); }
  else { emit(r, { type: "life_loss", player: pid, amount: -delta, life: p.life }); r.s.turnLog.push({ type: "lose_life", player: pid, amount: -delta, ts: r.s.clock }); if (env) env.lastLifeLost = -delta; }
  runAfter(r, ev);
}

/** Deals damage through the replacement pipeline; returns the damage actually dealt (0 when prevented or nothing could be hit). */
export function dealDamage(r: Run, env: Env | undefined, source: string | undefined, target: string, amount: number, combat = false): number {
  if (amount <= 0) return 0;
  if (!isObjId(target) && hasFlag(r, target, "protection_everything")) { emit(r, { type: "damage_prevented", source, target, amount }); return 0; } // protection from everything (a player: Perch Protection)
  const ev = applyReplacements(r, { kind: "damage", source, target, amount, combat });
  if (ev.cancelled || ev.kind !== "damage" || ev.amount <= 0) { emit(r, { type: "damage_prevented", source, target, amount }); runAfter(r, ev); return 0; }
  amount = ev.amount;
  if (isObjId(target) && protectedFrom(r, target, source)) { emit(r, { type: "damage_prevented", source, target, amount }); return 0; } // protection (protection.ts)
  let dealt = 0;
  const srcLive = source ? tryObj(r, source) : undefined;
  const deathtouch = !!srcLive && srcLive.zone === "battlefield" && chars(r, srcLive.id).keywords.includes("deathtouch");
  if (!isObjId(target)) {
    emit(r, { type: "damage", source, target, amount, combat, batch: r.batch });
    dealt = amount;
    r.s.turnLog.push({ type: "damage_to_player", player: target, id: source, amount, ts: r.s.clock });
    if (combat && source) r.s.turnLog.push({ type: "combat_damage_to_player", player: target, id: source, amount, ts: r.s.clock });
    if (combat && source && isCommanderObj(r, source)) addCommanderDamage(r, target, source, amount);
    changeLife(r, env, target, -amount);
    // the monarchy: combat damage to the monarch by a creature makes that creature's controller the monarch
    const srcObj = source ? tryObj(r, source) : undefined;
    if (combat && !r.s.config.mirrorHeadless?.noMonarchSteal && r.s.monarch === target && srcObj && srcObj.controller !== target && chars(r, srcObj.id).types.includes("creature")) { r.s.monarch = srcObj.controller; emit(r, { type: "monarch_changed", player: srcObj.controller }); }
  } else {
    const o = tryObj(r, target);
    if (o && o.zone === "battlefield") {
      const c = chars(r, target);
      if (c.types.includes("creature")) { const lethal = Math.max(0, (c.toughness ?? 0) - o.damage); const excess = amount - (deathtouch ? Math.min(1, lethal || 1) : lethal); if (excess > 0) r.s.turnLog.push({ type: "excess_damage", player: o.controller, id: target, amount: excess, ts: r.s.clock }); o.damage += amount; if (deathtouch) o.dtHit = true; dealt = amount; emit(r, { type: "damage", source, target, amount, combat, batch: r.batch }); }
      else if (c.types.includes("planeswalker")) { const excess = amount - (o.counters.loyalty ?? 0); if (excess > 0) r.s.turnLog.push({ type: "excess_damage", player: o.controller, id: target, amount: excess, ts: r.s.clock }); o.counters.loyalty = Math.max(0, (o.counters.loyalty ?? 0) - amount); dealt = amount; emit(r, { type: "damage", source, target, amount, combat, batch: r.batch }); }
      else if (c.types.includes("battle")) { o.counters.defense = Math.max(0, (o.counters.defense ?? 0) - amount); dealt = amount; emit(r, { type: "damage", source, target, amount, combat, batch: r.batch }); }
    }
  }
  runAfter(r, ev);
  return dealt;
}

function hasKeyword(r: Run, id: ObjId, kw: string): boolean { return chars(r, id).keywords.includes(kw); }

export function destroyObject(r: Run, id: ObjId, noRegen = false): boolean {
  const o = tryObj(r, id);
  if (!o || o.zone !== "battlefield") return false;
  if (hasKeyword(r, id, "indestructible")) { emit(r, { type: "destroy_prevented", id }); return false; }
  if (!noRegen && regenerates(r, id)) return false;
  emit(r, { type: "destroyed", id });
  moveObject(r, id, "graveyard");
  return true;
}

export function discardCard(r: Run, pid: PlayerId, id: ObjId): void {
  const ev = applyReplacements(r, { kind: "discard", player: pid, id });
  if (ev.cancelled) { runAfter(r, ev); return; }
  moveObject(r, id, "graveyard");
  emit(r, { type: "discard", player: pid, id });
  r.s.turnLog.push({ type: "discard", player: pid, id, name: label(r, id), types: chars(r, id).types, ts: r.s.clock });
  runAfter(r, ev);
}

export const PREDEFINED_TOKEN_ABILITIES: Record<string, Ability> = {
  Treasure: { id: "t:treasure", kind: "mana", text: "{T}, Sacrifice this artifact: Add one mana of any color.", costs: [{ tap: "self" }, { sacrifice: "self", count: 1 }], mana: { produces: [{ anyColor: 1 }] } },
  Food: { id: "t:food", kind: "activated", text: "{2}, {T}, Sacrifice this artifact: You gain 3 life.", costs: [{ mana: "{2}" }, { tap: "self" }, { sacrifice: "self", count: 1 }], steps: [{ kind: "life_change", lifeDelta: 3, who: "you" }] },
  Clue: { id: "t:clue", kind: "activated", text: "{2}, Sacrifice this artifact: Draw a card.", costs: [{ mana: "{2}" }, { sacrifice: "self", count: 1 }], steps: [{ kind: "draw_cards", amount: 1, who: "you" }] },
  Blood: { id: "t:blood", kind: "activated", text: "{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.", costs: [{ mana: "{1}" }, { tap: "self" }, { discard: {}, count: 1 }, { sacrifice: "self", count: 1 }], steps: [{ kind: "draw_cards", amount: 1, who: "you" }] }
};

/** The token a create_tokens step describes (before any replacement effect sees it). Predefined artifact tokens carry their rules. */
export function tokenDefFromStep(r: Run, env: QCtx, step: Step): TokenDef {
  const { types, subtypes } = parseTypeLine(step.tokenTypeLine as string | undefined);
  const abilities: Ability[] = [];
  for (const s of subtypes) {
    if (PREDEFINED_TOKEN_ABILITIES[s]) abilities.push(PREDEFINED_TOKEN_ABILITIES[s]);
    else if (["Map", "Powerstone", "Junk", "Gold", "Shard", "Incubator"].includes(s)) throw new Unsupported("token:predefined_abilities", s + " tokens carry rules the engine does not model yet");
  }
  for (const a of (step.tokenAbilities as Ability[] | undefined) ?? []) abilities.push(structuredClone(a)); // the token's own printed abilities ("When this token dies, you gain 1 life")
  return {
    name: String(step.tokenName ?? subtypes[0] ?? "Token"), types, subtypes,
    colors: ((step.tokenColors as string[] | undefined) ?? []).filter((c) => c !== "colorless"),
    power: step.tokenPower === undefined ? undefined : evalQuantity(r, step.tokenPower as never, env),
    toughness: step.tokenToughness === undefined ? undefined : evalQuantity(r, step.tokenToughness as never, env),
    keywords: (step.tokenKeywords as string[] | undefined) ?? [],
    ...(abilities.length ? { abilities } : {})
  };
}

export function createToken(r: Run, pid: PlayerId, def: TokenDef, tapped: boolean, created: string[]): void {
  const o = newObject(r, def.name, pid, "exile", { token: structuredClone(def) });
  // enters the battlefield through the normal zone change (enter replacements, etb triggers)
  moveObject(r, o.id, "battlefield", { controller: pid, tapped });
  if (r.s.objects[o.id]?.zone !== "battlefield") { delete r.s.objects[o.id]; return; } // an enter replacement kept it off the battlefield
  created.push(o.id);
  emit(r, { type: "token_created", id: o.id, player: pid, name: def.name, ...(def.copy ? { copy: true } : {}) });
  r.s.turnLog.push({ type: "token_created", id: o.id, player: pid, name: def.name, types: def.types.map((t) => t.toLowerCase()), token: true, ts: r.s.clock });
}

/**
 * Runs steps right now on behalf of a replacement effect. They may ask the player (shock land: "pay 2 life?", Thriving land:
 * "choose a color"): the question aborts the whole action with NeedAsk and is answered by replaying it (replacements.ts).
 */
export function runInline(r: Run, o: { source: ObjId; controller: PlayerId; steps: Step[]; eventObj?: string; eventPlayer?: PlayerId; amount?: number; x?: number }): void {
  const item: StackItem = { id: "inline", kind: "triggered", sourceId: o.source, controller: o.controller, abilityId: "", parts: [{ specs: [], steps: o.steps, targets: {} }], x: o.x ?? 0 };
  const ex = startExec(item);
  ex.env.eventObj = o.eventObj; ex.env.eventPlayer = o.eventPlayer; ex.env.amount = o.amount;
  let st = runExec(r, ex);
  while (st.status === "ask") {
    const given = takeAnswer(r);
    if (given === undefined) throw new NeedAsk(st.spec);
    st = runExec(r, ex, given);
  }
}

function parseTypeLine(tl: string | undefined): { types: string[]; subtypes: string[] } {
  const [left, right] = (tl ?? "Creature").split(/\s+[—-]\s+/);
  const types = left.split(/\s+/).filter(Boolean).map((t) => t.toLowerCase()).filter((t) => t !== "legendary" && t !== "basic");
  return { types, subtypes: (right ?? "").split(/\s+/).filter(Boolean) };
}

// ---------------------------------------------------------------- step registry

export type Handler = (r: Run, ex: Exec, step: Step, answer: Choice | undefined) => StepResult;
export interface StepSpec { fields: string[]; run: Handler }

/** a per-player step counts as done (for the whole step: "if you do") and done by that player (step_done with who) once the player actually did it */
export function noteDone(env: Env, step: Step, pid: PlayerId): void {
  if (!step.stepId) return;
  const id = String(step.stepId);
  const by = ((env.doneBy ??= {})[id] ??= []);
  if (!by.includes(pid)) by.push(pid);
  if (!env.done.includes(id)) env.done.push(id);
}
const PER_PLAYER_DONE: ReadonlySet<string> = new Set(["discard", "sacrifice_permanent"]);
export const players = (r: Run, env: Env, step: Step): PlayerId[] => (step.onlyPlayers ? (step.onlyPlayers as PlayerId[]) : resolvePlayers(r, step.who ?? "you", env));
const qty = (r: Run, env: Env, step: Step, key = "amount", dflt = 1): number => (step[key] === undefined ? dflt : evalQuantity(r, step[key] as never, env));
export const refs = (r: Run, env: Env, step: Step, key = "target"): string[] => resolveObjs(r, step[key] as string | undefined, env);

const STEPS: Record<string, StepSpec> = {
  draw_cards: {
    fields: ["amount", "who"],
    run: (r, ex, step) => { const n = qty(r, ex.env, step); for (const p of players(r, ex.env, step)) drawCards(r, p, n); return "done"; }
  },
  life_change: {
    fields: ["lifeDelta", "amount", "who", "lose"],
    run: (r, ex, step) => {
      const raw = step.lifeDelta !== undefined ? evalQuantity(r, step.lifeDelta as never, ex.env) : qty(r, ex.env, step, "amount", 0);
      const delta = step.lose ? -Math.abs(raw) : raw;
      let lost = 0;
      for (const p of players(r, ex.env, step)) { const before = player(r, p).life; changeLife(r, ex.env, p, delta); if (delta < 0) lost += Math.max(0, before - player(r, p).life); }
      if (delta < 0) ex.env.lastLifeLost = lost; // "you gain life equal to the life lost this way" (all players together)
      return "done";
    }
  },
  drain: {
    fields: ["amount"],
    run: (r, ex, step) => {
      const n = qty(r, ex.env, step);
      let total = 0;
      for (const p of resolvePlayers(r, "each_opponent", ex.env)) { changeLife(r, ex.env, p, -n); total += n; }
      changeLife(r, ex.env, ex.env.controller, total);
      return "done";
    }
  },
  damage_target: {
    fields: ["amount", "target", "who", "source", "all", "filter", "excessTo", "divided", "damageTargetType", "excludeWho"],
    run: (r, ex, step) => {
      const env = ex.env;
      const amount = qty(r, env, step);
      const src = step.source ? refs(r, env, step, "source")[0] : env.source;
      let targets: string[];
      if (step.all) targets = objectsMatching(r, (step.filter ?? {}) as ObjectFilter, env);
      else if (step.damageTargetType !== undefined) {
        // "deals X damage to the player or planeswalker it's attacking" (Myr Battlesphere): the defender of the source attacker
        if (step.damageTargetType !== "attacked_player_or_planeswalker") throw new Unsupported(`field:damage_target.damageTargetType=${String(step.damageTargetType)}`);
        const at = src ? r.s.combat?.attackers.find((a) => a.id === src) : undefined;
        targets = at ? [at.defender] : [];
      }
      else if (step.target) targets = refs(r, env, step);
      else targets = players(r, env, step);
      // "to each OTHER opponent" (Parapet Thrasher): the scope minus excludeWho
      if (step.excludeWho) { const out = resolvePlayers(r, step.excludeWho as never, env); targets = targets.filter((t) => !out.includes(t)); }
      if (step.divided && targets.length > 1 && amount > 0) return { push: [{ kind: "__divide_damage" as never, targets, amount, source: src, prompt: step.prompt } as Step] };
      for (const t of targets) {
        if (step.excessTo === undefined) { dealDamage(r, env, src, t, amount); continue; }
        if (step.excessTo !== "controller_of_target") throw new Unsupported(`field:damage_target.excessTo=${String(step.excessTo)}`);
        // "excess damage is dealt to that creature's controller instead": lethal damage (1 from a deathtouch source) goes to the creature, the rest to its controller
        const o = tryObj(r, t);
        if (!o || o.zone !== "battlefield") continue;
        const srcLive = src ? tryObj(r, src) : undefined;
        const dt = !!srcLive && srcLive.zone === "battlefield" && chars(r, srcLive.id).keywords.includes("deathtouch");
        const lethal = dt ? 1 : Math.max(0, (chars(r, t).toughness ?? 0) - o.damage);
        const owner = o.controller;
        dealDamage(r, env, src, t, Math.min(amount, lethal));
        if (amount > lethal) dealDamage(r, env, src, owner, amount - lethal);
      }
      return "done";
    }
  },
  destroy_target: { fields: ["target", "noRegenerate"], run: (r, ex, step) => { let n = 0; for (const t of refs(r, ex.env, step)) if (destroyObject(r, t)) n++; setResult(ex.env, step.id, n); return "done"; } }, // the result = how many died ("if that creature dies this way")
  destroy_all: {
    fields: ["filter", "noRegenerate", "targetType"],
    run: (r, ex, step) => { let n = 0; const f = (step.filter ?? (step.targetType ? { types: [String(step.targetType)] } : {})) as ObjectFilter; for (const id of objectsMatching(r, f, ex.env)) if (destroyObject(r, id)) n++; setResult(ex.env, step.id, n); return "done"; }
  },
  exile_target: {
    fields: ["target"],
    run: (r, ex, step) => {
      for (const t of refs(r, ex.env, step)) { const o = tryObj(r, t); if (o && o.zone !== "stack") { moveObject(r, t, "exile"); emit(r, { type: "exiled", id: t }); } }
      return "done";
    }
  },
  bounce_target: {
    fields: ["target"],
    run: (r, ex, step) => { for (const t of refs(r, ex.env, step)) { const o = tryObj(r, t); if (o && o.zone === "battlefield") { moveObject(r, t, "hand"); emit(r, { type: "bounced", id: t }); } } return "done"; }
  },
  mass_bounce: {
    fields: ["filter"],
    run: (r, ex, step) => { for (const id of objectsMatching(r, (step.filter ?? {}) as ObjectFilter, ex.env)) moveObject(r, id, "hand"); return "done"; }
  },
  reanimate: { // (event_object may also be in exile: Athreos returns a creature that was put into exile)
    fields: ["target", "who", "tapped", "anyGraveyard"], // anyGraveyard: only the target spec differs (any player's graveyard)
    run: (r, ex, step) => {
      const ctl = resolvePlayers(r, step.who ?? "you", ex.env)[0];
      for (const t of refs(r, ex.env, step)) { const o = tryObj(r, t); if (o && (o.zone === "graveyard" || (o.zone === "exile" && step.target === "event_object"))) { moveObject(r, t, "battlefield", { controller: ctl, tapped: !!step.tapped }); emit(r, { type: "reanimated", id: t }); (ex.env.created ??= []).push(t); } }
      return "done";
    }
  },
  mill: {
    fields: ["amount", "who"],
    run: (r, ex, step) => {
      const n = qty(r, ex.env, step);
      for (const pid of players(r, ex.env, step)) {
        for (let i = 0; i < n; i++) {
          const id = player(r, pid).library[0];
          if (!id) break;
          moveObject(r, id, "graveyard");
          emit(r, { type: "mill", player: pid, id });
          r.s.turnLog.push({ type: "mill", player: pid, id, ts: r.s.clock });
        }
      }
      return "done";
    }
  },
  discard: {
    fields: ["amount", "who"],
    run: (r, ex, step) => ({ push: players(r, ex.env, step).map((p) => ({ kind: "__discard" as never, player: p, n: qty(r, ex.env, step), prompt: step.prompt, stepId: step.id }) as Step) })
  },
  tap_target: {
    fields: ["target"],
    run: (r, ex, step) => {
      for (const t of refs(r, ex.env, step)) {
        if (r.entering?.id === t) { r.entering.tapped = true; continue; } // "enters tapped" decided while it is entering
        const o = tryObj(r, t);
        if (o && o.zone === "battlefield" && !o.tapped) { o.tapped = true; emit(r, { type: "tap", id: t }); }
      }
      return "done";
    }
  },
  untap_target: {
    fields: ["target", "all", "filter"],
    run: (r, ex, step) => {
      const ids = step.all ? objectsMatching(r, (step.filter ?? {}) as ObjectFilter, ex.env) : refs(r, ex.env, step);
      for (const t of ids) { const o = tryObj(r, t); if (o && o.zone === "battlefield" && o.tapped) untapObject(r, o); }
      return "done";
    }
  },
  pump_target: {
    fields: ["target", "power", "toughness", "duration"],
    run: (r, ex, step) => {
      requireEot(step);
      const p = qty(r, ex.env, step, "power", 0), t = qty(r, ex.env, step, "toughness", 0);
      for (const id of refs(r, ex.env, step)) addEffect(r, id, { power: p, toughness: t });
      return "done";
    }
  },
  mass_pump: {
    fields: ["filter", "power", "toughness", "duration"],
    run: (r, ex, step) => {
      requireEot(step);
      const p = qty(r, ex.env, step, "power", 0), t = qty(r, ex.env, step, "toughness", 0);
      for (const id of objectsMatching(r, (step.filter ?? {}) as ObjectFilter, ex.env)) addEffect(r, id, { power: p, toughness: t });
      return "done";
    }
  },
  grant_effect: {
    fields: ["target", "modify", "duration", "who", "filter", "replacement", "all", "phaseOut", "prepared"],
    run: (r, ex, step) => {
      if (step.prepared) { for (const id of refs(r, ex.env, step)) { const o = tryObj(r, id); if (o && o.zone === "battlefield") { o.prepared = true; invalidateIndex(r); emit(r, { type: "prepared", id }); } } return "done"; } // "this creature becomes prepared"
      if (step.phaseOut) { for (const id of (step.filter && !step.target ? objectsMatching(r, step.filter as ObjectFilter, ex.env) : refs(r, ex.env, step))) phaseOut(r, id); return "done"; } // a filter = "all permanents you control phase out" // "enchanted creature phases out" (Vanishing, phasing.ts)
      if (step.all && !step.filter && !step.target) throw new Unsupported("field:grant_effect.all", "an unfiltered mass grant");
      // player-scoped form: a replacement shield / a player flag for a while (durable.ts)
      if (!step.target && !step.filter) { grantToPlayers(r, ex.env, step); return "done"; }
      if ((!step.duration || step.duration === "until_end_of_turn") && (step.modify as Array<Record<string, unknown>> | undefined)?.every((m) => "grantAbility" in m)) { // "it gains 'When this creature dies, exile it.'": the object keeps the ability as long as it stays that object
        for (const id of refs(r, ex.env, step)) { const o = tryObj(r, id); if (!o || (o.zone !== "stack" && o.zone !== "battlefield")) continue; for (const m of step.modify as Array<{ grantAbility: import("../schema").Ability }>) { r.s.effects.push({ id: `e${r.s.effects.length}_${r.s.clock}`, timestamp: tick(r), objectId: id, objectTimestamp: o.timestamp, until: step.duration ? "end_of_turn" : "leaves", ability: m.grantAbility }); } invalidateIndex(r); }
        return "done";
      }
      { // "can't attack you or planeswalkers you control until your next turn / for as long as it has a vow counter": a durable ban on attacking (combat.attackProblem reads it)
        const ms = (step.modify ?? []) as Array<Record<string, unknown>>;
        if (ms.length === 1 && ms[0].cant === "attack") {
          const dur = step.duration, env = ex.env;
          const forAsLong = typeof dur === "object" && dur !== null && "forAsLongAs" in dur ? (dur as { forAsLongAs: import("../schema").Predicate }).forAsLongAs : undefined;
          if (!forAsLong && dur !== undefined && !(typeof dur === "string" && (dur === "until_end_of_turn" || SUPPORTED_DURABLE_DURATIONS.has(dur)))) throw new Unsupported(`duration:${typeof dur === "string" ? dur : Object.keys(dur as object)[0]}`);
          const ban: NonNullable<import("./types").DurableEffect["attackBan"]> = { ...(ms[0].protects ? { protects: ms[0].protects as "you" | "you_and_planeswalkers" } : {}) };
          if (step.target) ban.objects = refs(r, env, step).map((id) => ({ id, ts: tryObj(r, id)?.timestamp ?? -1 }));
          else ban.controllerOf = resolvePlayers(r, step.who ?? "you", env)[0];
          if (forAsLong) { ban.whileP = forAsLong; ban.chosen = structuredClone(env.chosen); }
          addDurable(r, { owner: env.controller, source: env.source, expires: forAsLong ? { ev: "never" } : expiryFor(r, (dur as never) ?? "until_end_of_turn", env.controller), attackBan: ban });
          return "done";
        }
      }
      requireEot(step);
      // mass form ("creatures you control gain indestructible until end of turn"): the filter picks the permanents, `who` is only whose perspective it is
      const mods = ((step.modify ?? []) as Array<Record<string, unknown>>).map((m) => (m.cant === "be_blocked" && Object.keys(m).length === 1 ? { grant: "unblockable" } : m)); // "it can't be blocked this turn" = unblockable for the turn
      const GRANTABLE = ["grant", "lose", "setBasePT", "addTypes", "setTypes", "setColors", "pt"];
      for (const m of mods) if (Object.keys(m).length !== 1 || !GRANTABLE.includes(Object.keys(m)[0])) throw new Unsupported(`field:grant_effect.modify.${Object.keys(m)[0]}`);
      const until = step.duration === undefined ? "leaves" as const : "end_of_turn" as const; // no duration in the text = the effect lasts as long as the object stays that permanent (Zur: "becomes a creature"; Memnarch: "lasts indefinitely")
      const granted = step.target ? refs(r, ex.env, step) : objectsMatching(r, step.filter as ObjectFilter, ex.env);
      for (const id of granted) for (const m of mods) {
        if ("grant" in m) addEffect(r, id, { grant: String(m.grant).toLowerCase() }, until);
        else if ("lose" in m) addEffect(r, id, { lose: String(m.lose) }, until);
        else if ("pt" in m) { const b = m.pt as { power: never; toughness: never }; addEffect(r, id, { power: evalQuantity(r, b.power, ex.env), toughness: evalQuantity(r, b.toughness, ex.env) }, until); }
        else if ("setBasePT" in m) { const b = m.setBasePT as { power: never; toughness: never }; addEffect(r, id, { base: { power: evalQuantity(r, b.power, ex.env), toughness: evalQuantity(r, b.toughness, ex.env) } }, until); }
        else if ("addTypes" in m) addEffect(r, id, { addTypes: m.addTypes as string[] }, until);
        else if ("setTypes" in m) addEffect(r, id, { setTypes: m.setTypes as string[] }, until);
        else addEffect(r, id, { setColors: m.setColors as string[] }, until);
      }
      return "done";
    }
  },
  // Exploit (CR 702.110): "you may sacrifice a creature" (the optional wrapper asks first); the keyword's second ability triggers on the `exploited` event
  exploit: {
    fields: ["amount"],
    run: () => ({ push: [
      { kind: "choose", who: "you", from: { types: ["creature"], controller: "you" }, min: 1, max: 1, saveAs: "__exploit" } as unknown as Step,
      { kind: "__exploit_done" } as unknown as Step
    ] })
  },
  // Animate Dead: the Aura's "enchant" text is rewritten as it enters (it now enchants the creature put onto the battlefield with it); the reanimate / attach steps after it do the work
  rewrite_enchant: { fields: [], run: () => "done" },
  unprepare: {
    fields: ["target"],
    run: (r, ex, step) => { for (const id of refs(r, ex.env, step)) { const o = tryObj(r, id); if (o) { o.prepared = undefined; invalidateIndex(r); } } return "done"; }
  },
  // morph: turn a face-down permanent face up (CR 702.37e; modelled as an ability that uses the stack)
  turn_face_up: {
    fields: ["target"],
    run: (r, ex, step) => {
      for (const id of refs(r, ex.env, step)) { const o = tryObj(r, id); if (o?.faceDown && o.zone === "battlefield") { o.faceDown = undefined; invalidateIndex(r); emit(r, { type: "turned_face_up", id, player: o.controller }); } }
      return "done";
    }
  },
  extra_combat: {
    fields: [],
    run: (r) => { r.s.extraCombats++; emit(r, { type: "extra_combat_added" }); return "done"; }
  },
  create_tokens: {
    fields: ["tokenCount", "tokenName", "tokenPower", "tokenToughness", "tokenColors", "tokenTypeLine", "tokenKeywords", "tokenTapped", "who", "tokenAbilities", "tokenAttacking", "attackTarget"],
    run: (r, ex, step) => {
      const env = ex.env;
      const def = tokenDefFromStep(r, env, step);
      const n = qty(r, env, step, "tokenCount");
      env.created = [];
      for (const pid of players(r, env, step)) {
        // the creation is ONE event ("tokens would be created"): replacement effects see all of it at once
        const ev = applyReplacements(r, { kind: "tokens", player: pid, groups: n > 0 ? [{ def, count: n, tapped: !!step.tokenTapped }] : [] });
        if (!ev.cancelled && ev.kind === "tokens") for (const g of ev.groups) for (let i = 0; i < g.count; i++) createToken(r, pid, g.def, !!g.tapped, env.created);
        runAfter(r, ev);
      }
      if (step.tokenAttacking && r.s.combat) {
        // "tapped and attacking that player" (Soaring Lightbringer): enters attacking (never declared: no attack triggers); only the defending player of the triggering attack is modelled
        if (step.attackTarget !== "that_player" || !env.eventPlayer) throw new Unsupported("field:create_tokens.attackTarget");
        for (const id of env.created) { const o = tryObj(r, id); if (o && o.zone === "battlefield") r.s.combat.attackers.push({ id, ts: o.timestamp, defender: env.eventPlayer, blockers: [], blocked: false }); }
      }
      return "done";
    }
  },
  put_counters_on_self: {
    fields: ["counterKind", "amount"],
    run: (r, ex, step) => { addCounters(r, [ex.env.source], String(step.counterKind), qty(r, ex.env, step)); return "done"; }
  },
  add_counters: {
    fields: ["on", "counterKind", "amount", "counterPT"],
    run: (r, ex, step) => {
      standardCounterPT(step);
      if (typeof step.on === "string" && PLAYER_COUNTER_TARGETS.has(step.on)) { addPlayerCounters(r, resolvePlayers(r, step.on as PlayerRef, ex.env), String(step.counterKind), qty(r, ex.env, step)); return "done"; }
      addCounters(r, resolveObjs(r, String(step.on ?? "self"), ex.env), String(step.counterKind), qty(r, ex.env, step)); return "done";
    }
  },
  remove_counters: {
    fields: ["on", "counterKind", "amount"],
    run: (r, ex, step) => {
      if (typeof step.on === "string" && PLAYER_COUNTER_TARGETS.has(step.on)) { addPlayerCounters(r, resolvePlayers(r, step.on as PlayerRef, ex.env), String(step.counterKind), -qty(r, ex.env, step)); return "done"; }
      addCounters(r, resolveObjs(r, String(step.on ?? "self"), ex.env), String(step.counterKind), -qty(r, ex.env, step)); return "done";
    }
  },
  sacrifice_permanent: {
    fields: ["who", "amount", "filter", "target", "all", "greatestPower", "costPerCounter", "except"],
    run: (r, ex, step) => {
      const env = ex.env;
      if (step.all) { // "each player sacrifices all ...": every matching permanent each listed player controls
        const keep = step.except ? refs(r, env, { ...step, target: step.except } as Step) : []; // "sacrifices the rest" (Promise of Loyalty)
        for (const p of players(r, env, step)) for (const id of objectsMatching(r, (step.filter ?? {}) as ObjectFilter, env)) if (tryObj(r, id)?.controller === p && !keep.includes(id)) sacrificeObject(r, id);
        return "done";
      }
      if (step.target) {
        // an explicit object ("chosen": Disciple of Bolas): sacrifice it, later steps read what it was as `sacrificed` (last-known information)
        const ids = refs(r, env, step);
        for (const id of ids) sacrificeObject(r, id);
        if (step.target !== "self") env.sacrificed = ids;
        return "done";
      }
      return { push: players(r, env, step).map((p) => ({ kind: "__sacrifice" as never, player: p, n: qty(r, env, step), filter: step.filter, greatestPower: step.greatestPower, prompt: step.prompt, stepId: step.id }) as Step) };
    }
  },
  attach: attachStep,
  copy: copyStep,
  transform: transformStep,
  permission_to_play: permissionStep,
  create_delayed_trigger: delayedStep,
  move_card_zone: moveStep,
  search_library: searchStep,
  look_top: lookTopStep,
  reveal: revealStep,
  repeat_for_each: repeatStep,
  add_mana: {
    fields: ["produces", "amount"],
    run: (r, ex, step) => {
      const specs = (step.produces ?? []) as Array<Record<string, unknown>>;
      if (specs.length !== 1 || typeof specs[0].colors !== "string" || specs[0].restriction) throw new Unsupported("field:add_mana.produces");
      const syms = [...String(specs[0].colors).matchAll(/\{([WUBRGC])\}/g)].map((m) => m[1] as never);
      const n = qty(r, ex.env, step);
      for (let i = 0; i < n; i++) addMana(r, ex.env.controller, syms, ex.env.source);
      return "done";
    }
  },
  counter_spell: {
    fields: ["target"],
    run: (r, ex, step) => {
      for (const t of refs(r, ex.env, step)) {
        const i = r.s.stack.findIndex((it) => it.objectId === t || it.id === t); // a spell, or (ward) an ability on the stack
        if (i < 0) continue;
        if (isObjId(t) && cantBeCountered(r, t)) { emit(r, { type: "counter_failed", id: t, by: ex.env.source, reason: "can't be countered" }); continue; }
        const [item] = r.s.stack.splice(i, 1);
        emit(r, { type: "spell_countered", id: t, by: ex.env.source, controller: item.controller, item: item.id, left: r.s.stack.length, ...(item.objectId ? {} : { ability: true, source: item.sourceId }) });
        if (item.objectId) moveObject(r, t, "graveyard");
      }
      return "done";
    }
  },
  shuffle: { fields: ["who", "target"], run: (r, ex, step) => {
    if (step.target) { // "shuffle this card into its owner's library" (Scavenger Regent // Exude Toxin): the card goes into the library first
      for (const id of refs(r, ex.env, step)) { const o = tryObj(r, id); if (!o || o.zone === "library") continue; moveObject(r, id, "library", { position: "top" }); shuffleInPlace(r, player(r, o.owner).library); emit(r, { type: "shuffle", player: o.owner }); }
      return "done";
    }
    for (const p of players(r, ex.env, step)) { shuffleInPlace(r, player(r, p).library); emit(r, { type: "shuffle", player: p }); } return "done"; } },
  scry: { fields: ["amount", "who"], run: (r, ex, step) => ({ push: players(r, ex.env, step).map((p) => ({ kind: "__scry" as never, player: p, n: qty(r, ex.env, step), prompt: step.prompt, to: "bottom" }) as Step) }) },
  surveil: { fields: ["amount", "who"], run: (r, ex, step) => ({ push: players(r, ex.env, step).map((p) => ({ kind: "__scry" as never, player: p, n: qty(r, ex.env, step) + surveilExtra(r, p), prompt: step.prompt, to: "graveyard" }) as Step) }) },
  connive: {
    fields: ["on", "amount"],
    run: (r, ex, step) => {
      const n = qty(r, ex.env, step);
      const ctl = ex.env.controller;
      const on = resolveObjs(r, String(step.on ?? "self"), ex.env)[0];
      emit(r, { type: "connive", id: on, player: ctl });
      return { push: [{ kind: "draw_cards", amount: n, who: "you" }, { kind: "__connive_discard" as never, player: ctl, n, on, prompt: step.prompt }] };
    }
  },
  choose: chooseStep,
  if_else: {
    fields: ["if", "then", "else"],
    // no `if` + optionalCost = "you may pay {B}. If you do, ...": the payment itself was the choice (the later step reads step_done), nothing to branch on (Nihil Spellbomb)
    run: (r, ex, step) => (step.if === undefined && !step.then && !step.else ? "done" : { push: (evalPredicate(r, step.if!, ex.env) ? step.then : step.else) ?? [] })
  }
};

countersTransferSteps(STEPS);
wrapRevealStep(STEPS);
Object.assign(STEPS, STEPS6);
steps7(STEPS);
Object.assign(STEPS, STEPS7);
Object.assign(STEPS, STEPS11);

export const STEP_FIELDS: Record<string, string[]> = Object.fromEntries(Object.entries(STEPS).map(([k, v]) => [k, v.fields]));
export const SUPPORTED_ENGINE_STEP_KINDS: ReadonlySet<string> = new Set(Object.keys(STEPS));

function requireEot(step: Step): void {
  if (step.duration !== undefined && step.duration !== "until_end_of_turn") throw new Unsupported(`duration:${typeof step.duration === "string" ? step.duration : Object.keys(step.duration)[0]}`);
}

export function addTemporaryPT(r: Run, id: ObjId, power: number, toughness: number): void { addEffect(r, id, { power, toughness }); }

function addEffect(r: Run, id: ObjId, e: Partial<Pick<ContinuousEffect, "power" | "toughness" | "grant" | "lose" | "base" | "addTypes" | "setTypes" | "setColors">>, until: ContinuousEffect["until"] = "end_of_turn"): void {
  const o = tryObj(r, id);
  if (!o || (o.zone !== "battlefield" && !(o.zone === "stack" && e.grant))) return; // a keyword granted to a creature SPELL ("it gains haste") stays on the permanent it becomes (core.moveObject re-stamps it)
  r.s.effects.push({ id: `e${r.s.effects.length}_${r.s.clock}`, timestamp: tick(r), objectId: id, objectTimestamp: o.timestamp, until, ...e });
  emit(r, { type: "effect_added", id, ...e });
}

/** `counterPT` restates what a +1/+1 / -1/-1 counter already does (chars() applies it by kind); any other P/T-per-counter rule is not modelled. */
export function standardCounterPT(step: Step): void {
  const pt = step.counterPT as number[] | undefined;
  if (!pt) return;
  const k = String(step.counterKind);
  if (!((k === "+1/+1" && pt[0] === 1 && pt[1] === 1) || (k === "-1/-1" && pt[0] === -1 && pt[1] === -1))) throw new Unsupported("field:add_counters.counterPT");
}

/** `on` values of add_counters / remove_counters that name a PLAYER (experience counters), not a permanent */
export const PLAYER_COUNTER_TARGETS: ReadonlySet<string> = new Set(["you", "opponent", "each_opponent", "each_player", "that_player"]);

export function addPlayerCounters(r: Run, pids: string[], kind: string, n: number): void {
  for (const pid of pids) {
    const p = player(r, pid);
    const counters = (p.counters ??= {});
    counters[kind] = Math.max(0, (counters[kind] ?? 0) + n);
    emit(r, { type: "player_counters", player: pid, kind, amount: n });
  }
}

export function addCounters(r: Run, ids: string[], kind: string, n: number): void {
  for (const id of ids) {
    if (r.entering?.id === id && n > 0) { r.entering.counters[kind] = (r.entering.counters[kind] ?? 0) + n; continue; }
    const o = tryObj(r, id);
    if (!o || o.zone === "stack") continue;
    if (o.zone !== "battlefield" && n < 0) continue;
    if (n > 0) {
      const ev = applyReplacements(r, { kind: "counters", id, counter: kind, amount: n });
      if (ev.cancelled || ev.kind !== "counters" || ev.amount <= 0) { runAfter(r, ev); continue; }
      o.counters[kind] = (o.counters[kind] ?? 0) + ev.amount;
      emit(r, { type: "counter_added", id, kind, amount: ev.amount });
      runAfter(r, ev);
      continue;
    }
    if (kind === "stun" && stunLocked(r, o)) continue;
    const next = Math.max(0, (o.counters[kind] ?? 0) + n);
    o.counters[kind] = next;
    if (next === 0) delete o.counters[kind];
    emit(r, { type: n >= 0 ? "counter_added" : "counter_removed", id, kind, amount: Math.abs(n) });
  }
}

/** Enhanced Surveillance: "you may look at an additional two cards each time you surveil" (summed over the player's permanents with that marker). */
function surveilExtra(r: Run, pid: PlayerId): number {
  let n = 0;
  for (const id of r.s.battlefield) { const o = r.s.objects[id]; if (o?.controller !== pid) continue; for (const a of abilitiesOf(r, o)) if (a.scripted?.handler === "surveil_additional_cards") n += Number((a.scripted.params as { extra?: number } | undefined)?.extra ?? 0); }
  return n;
}

export function sacrificeObject(r: Run, id: ObjId): void {
  const o = tryObj(r, id);
  if (!o || o.zone !== "battlefield") return;
  const owner = o.controller;
  emit(r, { type: "sacrificed", id, player: owner });
  r.s.turnLog.push({ type: "sacrifice", id, player: owner, ts: r.s.clock });
  moveObject(r, id, "graveyard");
}

// ---------------------------------------------------------------- internal steps

const INTERNAL: Record<string, Handler> = {
  ...INTERNAL6,
  ...INTERNAL7,
  ...INTERNAL11,
  __part: (_r, ex, step) => { ex.env.targets = ex.env.item.parts[Number(step.index)].targets; return "done"; },
  __reflexive_pick: (r, ex, step, answer) => {
    const spec = step.spec as { id: string; prompt?: Prompt };
    const cands = targetHooks.candidates!(r, spec, ex.env);
    if (!cands.length) { ex.env.targets[spec.id] = []; return "done"; }
    const ask: AskSpec = { kind: "choose_targets", player: ex.env.controller, prompt: spec.prompt ?? fallbackPrompt(r, ex.env, "choose a target", "Choose a target."), options: cands.map((id: string) => ({ id, label: label(r, id) })), min: 1, max: 1 };
    const d = decide(ask, answer);
    if ("ask" in d) return d;
    ex.env.targets[spec.id] = d.ids;
    return "done";
  },
  __may: (r, ex, step, answer) => {
    const spec: AskSpec = { kind: "choose_yes_no", player: (step.asker as PlayerId | undefined) ?? ex.env.controller, prompt: step.prompt!, options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }], min: 1, max: 1 };
    const d = decide(spec, answer);
    if ("ask" in d) return d;
    if (!d.yes) {
      // "you may cast it" (permission_to_play): the log names the card(s) that were offered
      const inner = step.inner as Step | undefined;
      let offered: ObjId[] | undefined;
      if (inner?.kind === "permission_to_play") { try { offered = resolveObjs(r, String(inner.what ?? inner.target), ex.env); } catch { offered = undefined; } }
      emit(r, { type: "may_declined", source: ex.env.source, ability: ex.env.item.abilityId, player: (step.asker as PlayerId | undefined) ?? ex.env.controller, item: ex.env.item.id, ...(offered?.length ? { cards: offered, withoutPaying: !!(inner?.withoutPaying || inner?.withoutPayingManaCost) } : {}) }); // the log says the player chose not to
    }
    return d.yes ? { push: [step.inner as Step] } : "done";
  },
  // "an opponent" (who: "opponent") with several opponents: the controller chooses one (CR 608.2d); the auto-pick for a single opponent never asks
  __pick_opponent: (r, ex, step, answer) => {
    const opps = opponentsOf(r, ex.env.controller);
    if (opps.length <= 1) { ex.env.chosenOpponent = opps[0]?.id; return "done"; }
    const spec: AskSpec = { kind: "choose_option", player: ex.env.controller, prompt: step.prompt ?? fallbackPrompt(r, ex.env, "choose an opponent", "Choose an opponent."), options: opps.map((p) => ({ id: p.id, label: label(r, p.id) })), min: 1, max: 1 };
    const d = decide(spec, answer);
    if ("ask" in d) return d;
    ex.env.chosenOpponent = d.ids[0];
    emit(r, { type: "player_chosen", source: ex.env.source, player: ex.env.controller, chosen: d.ids[0] });
    return "done";
  },
  __iter: (_r, ex, step) => {
    for (const id of (step.clear as string[] | undefined) ?? []) ex.env.done = ex.env.done.filter((d) => d !== id);
    ex.env.iterated = step.object as string | undefined;
    ex.env.thatPlayer = step.player as PlayerId | undefined;
    return "done";
  },
  __search_pick: (r, ex, step, answer) => searchPickStep(r, ex, step, answer),
  __exploit_done: (r, ex) => {
    const ids = (ex.env.chosen.__exploit ?? []).filter((id) => tryObj(r, id)?.zone === "battlefield");
    for (const id of ids) { sacrificeObject(r, id); emit(r, { type: "exploited", id: ex.env.source, sacrificed: id, player: ex.env.controller }); }
    return "done";
  },
  __unless: (r, ex, step, answer) => unlessHandler(r, ex.env, step, answer),
  __unless_discard: (r, ex, step, answer) => unlessDiscardHandler(r, ex.env, step, answer),
  __discard: (r, ex, step, answer) => {
    const pid = String(step.player);
    const hand = player(r, pid).hand;
    const n = Math.min(Number(step.n), hand.length);
    if (n <= 0) return "done"; // nothing to discard: "if you do" is false (the step only counts as done for the players that discarded)
    noteDone(ex.env, step, pid);
    if (n === hand.length) { for (const id of [...hand]) discardCard(r, pid, id); return "done"; }
    const spec: AskSpec = { kind: "choose_cards", player: pid, prompt: (step.prompt as Prompt | undefined) ?? fallbackPrompt(r, ex.env, "discard", `Choose ${n} card${n === 1 ? "" : "s"} to discard.`), options: cardOptions(r, hand), min: n, max: n };
    const d = decide(spec, answer);
    if ("ask" in d) return d;
    for (const id of d.ids) discardCard(r, pid, id);
    return "done";
  },
  __connive_discard: (r, ex, step, answer) => {
    const pid = String(step.player);
    const hand = player(r, pid).hand;
    const n = Math.min(Number(step.n), hand.length);
    const finish = (discarded: ObjId[]) => {
      const nonland = discarded.filter((id) => !chars(r, id).types.includes("land")).length;
      const on = String(step.on);
      if (nonland > 0 && tryObj(r, on)?.zone === "battlefield") addCounters(r, [on], "+1/+1", nonland);
    };
    if (n <= 0) return "done";
    if (n === hand.length) { const all = [...hand]; const nl = all.map((id) => id); for (const id of nl) discardCard(r, pid, id); finish(all); return "done"; }
    const spec: AskSpec = { kind: "choose_cards", player: pid, prompt: (step.prompt as Prompt | undefined) ?? fallbackPrompt(r, ex.env, "connive", "Choose a card to discard after drawing (connive)."), options: cardOptions(r, hand), min: n, max: n };
    const d = decide(spec, answer);
    if ("ask" in d) return d;
    // card types are read before the discard moves them (they stay the same in the graveyard, but keep the order explicit)
    for (const id of d.ids) discardCard(r, pid, id);
    finish(d.ids);
    return "done";
  },
  __sacrifice: (r, ex, step, answer) => {
    const pid = String(step.player);
    const f = { ...(step.filter as ObjectFilter | undefined), controller: undefined } as ObjectFilter;
    let mine = r.s.battlefield.filter((id) => r.s.objects[id].controller === pid && matchesFilter(r, id, f, { ...ex.env, controller: pid }));
    if (step.greatestPower) { // "a creature with the greatest power among creatures they control": only the tied-highest ones may be chosen
      const top = Math.max(...mine.map((id) => chars(r, id).power ?? 0));
      mine = mine.filter((id) => (chars(r, id).power ?? 0) === top);
    }
    const n = Math.min(Number(step.n), mine.length);
    if (n <= 0) return "done";
    noteDone(ex.env, step, pid); // "each player who can't ...", "if you sacrificed a permanent this way": this player did sacrifice
    ex.env.sacrificedTypes = [...new Set(mine.flatMap((id) => chars(r, id).types))]; // narrowed below to what was really sacrificed
    if (n === mine.length) { ex.env.sacrificedTypes = [...new Set(mine.flatMap((id) => chars(r, id).types))]; ex.env.sacrificed = [...mine]; for (const id of [...mine]) sacrificeObject(r, id); return "done"; }
    const spec: AskSpec = { kind: "choose_cards", player: pid, prompt: (step.prompt as Prompt | undefined) ?? fallbackPrompt(r, ex.env, "sacrifice", `Choose ${n} permanent${n === 1 ? "" : "s"} to sacrifice.`), options: cardOptions(r, mine), min: n, max: n };
    const d = decide(spec, answer);
    if ("ask" in d) return d;
    ex.env.sacrificedTypes = [...new Set(d.ids.flatMap((id) => chars(r, id).types))]; ex.env.sacrificed = [...d.ids];
    for (const id of d.ids) sacrificeObject(r, id);
    return "done";
  },
  // damage divided as the controller chooses among the targets (each gets at least 1 when the amount allows): reuses the assign_counters decision (answer = choice.assign)
  __divide_damage: (r, ex, step, answer) => {
    const live = (step.targets as string[]).filter((t) => (isObjId(t) ? tryObj(r, t)?.zone === "battlefield" : true));
    const amount = Number(step.amount);
    if (live.length === 0) return "done";
    const src = step.source as string | undefined;
    let split: Record<string, number>;
    if (live.length === 1) split = { [live[0]]: amount };
    else {
      const spec = counterSpec(r, ex.env.controller, (step.prompt as Prompt | undefined) ?? fallbackPrompt(r, ex.env, "damage", `Divide ${amount} damage among the targets.`), Object.fromEntries(live.map((t) => [t, amount])), amount, amount, (id) => (isObjId(id) ? label(r, id) : `player ${id}`));
      if (!answer) return { ask: spec };
      split = checkCounterAnswer(spec, answer);
      if (amount >= live.length && live.some((t) => !(split[t] > 0))) throw new Reject("invalid_choice", "each target must be assigned at least 1 damage");
    }
    for (const t of live) if (split[t] > 0) dealDamage(r, ex.env, src, t, split[t]);
    return "done";
  },
  __scry: (r, ex, step, answer) => {
    const pid = String(step.player);
    const lib = player(r, pid).library;
    const n = Math.min(Number(step.n), lib.length);
    if (n <= 0) return "done";
    const top = lib.slice(0, n);
    const to = String(step.to);
    const spec = placementSpec(pid,
      (step.prompt as Prompt | undefined) ?? fallbackPrompt(r, ex.env, `${to === "bottom" ? "scry" : "surveil"} ${n}`, to === "bottom"
        ? `Scry ${n}: choose the cards to put on the bottom of your library, then put the rest back on top in the order you want (first = the next card you draw).`
        : `Surveil ${n}: choose the cards to put into your graveyard, then put the rest back on top in the order you want (first = the next card you draw).`),
      cardOptions(r, top), { to: to === "bottom" ? "bottom" : "graveyard", stack: "top" });
    if (!answer) return { ask: spec };
    const placed = readPlacement(spec, answer);
    applyScry(r, pid, placed);
    emit(r, { type: to === "bottom" ? "scry" : "surveil", player: pid, count: n, moved: placed.toBottom.length + placed.toGraveyard.length });
    return "done";
  }
};

// ---------------------------------------------------------------- executor

export function startExec(item: StackItem): Exec {
  const steps: Step[] = [];
  item.parts.forEach((p, i) => { steps.push({ kind: "__part" as never, index: i } as Step, ...p.steps); });
  return {
    frames: [{ steps, i: 0 }], partIndex: 0,
    env: {
      item, source: item.sourceId, controller: item.controller, x: item.x, targets: {}, chosen: {}, done: [], created: [],
      eventObj: item.trigger?.eventObj, eventPlayer: item.trigger?.eventPlayer, amount: item.trigger?.amount, sacrificed: item.sacrificed, batchObjs: item.trigger?.batchObjs
    }
  };
}

export function runExec(r: Run, ex: Exec, answer?: Choice): StepStatus {
  let pendingAnswer = answer;
  for (;;) {
    const frame = ex.frames[ex.frames.length - 1];
    if (!frame) return { status: "done" };
    if (frame.i >= frame.steps.length) { ex.frames.pop(); continue; }
    const step = frame.steps[frame.i];
    const internal = INTERNAL[step.kind as string];
    let result: StepResult;
    // continue mode (unresolved.ts): a step the engine cannot run is reported and skipped, the steps after it still run
    if (!internal && continuing(r)) {
      const needs = continueHooks.stepNeeds?.(step) ?? [];
      if (needs.length) { continueHooks.stepSkipped?.(r, ex.env.source, ex.env.item.abilityId, step, needs); pendingAnswer = undefined; frame.i++; continue; }
    }
    try {
    if (internal) result = internal(r, ex, step, pendingAnswer);
    else {
      const spec = STEPS[step.kind];
      if (!spec) throw new Unsupported(`step:${step.kind}`);
      if (step.who === "opponent" && ex.env.chosenOpponent === undefined && !pendingAnswer && opponentsOf(r, ex.env.controller).length > 1) { // a single-opponent reference in a multiplayer game: choose the opponent first
        frame.steps = [...frame.steps]; frame.steps.splice(frame.i, 0, { kind: "__pick_opponent" as never } as Step);
        continue;
      }
      if (step.unlessPay && !unlessPaySupported(step.unlessPay as unknown as UnlessPay)) throw new Unsupported("step:unless_pay");
      if (step.optionalCost && !unlessPaySupported({ payer: "you", cost: step.optionalCost as never })) throw new Unsupported("step:optional_cost");
      for (const k of Object.keys(step)) if (!META_FIELDS.includes(k) && !spec.fields.includes(k)) throw new Unsupported(`field:${step.kind}.${k}`);
      if (step.condition && !pendingAnswer && /"that_player"/.test(JSON.stringify(step.condition.if)) && (step.who === "each_player" || step.who === "each_opponent") && !step.onlyPlayers) {
        // "each player who can't ...": the condition is judged for EACH player (CR 608.2c), "that player" being the one being considered; the step then runs for the players that qualify
        const qual = resolvePlayers(r, step.who, ex.env).filter((p) => evalPredicate(r, step.condition!.if, { ...ex.env, thatPlayer: p }));
        if (!qual.length) { frame.i++; continue; }
        frame.steps = [...frame.steps]; frame.steps[frame.i] = { ...step, condition: undefined, onlyPlayers: qual } as Step;
        continue;
      }
      if (step.condition && !pendingAnswer && !evalPredicate(r, step.condition.if, ex.env)) { frame.i++; continue; }
      // "you may reveal a <filter> card from your hand": with nothing to reveal the step is skipped (and does not count as done)
      if (step.kind === "reveal" && step.filter && !pendingAnswer && !objectsMatching(r, step.filter as ObjectFilter, ex.env).length) { frame.i++; continue; }
      if (step.optionalCost) {
        // "you may pay {1}. If you do, <step>": the unless-pay machinery, inverted (the step runs only when the payment is made)
        const inner = { ...step, optionalCost: undefined, optional: false } as Step; // paying IS the choice: no second question
        frame.steps = [...frame.steps]; frame.steps[frame.i] = { kind: "__unless" as never, inner, pay: { payer: "you", cost: step.optionalCost, inverse: true } } as Step;
        continue;
      }
      if (step.optional && step.repeatCount === undefined && step.sharesCardTypeWith === undefined && !(step as Step & { __asked?: boolean }).__asked && !isDurablePermission(step)) { // a durable permission ("until end of turn" / for as long as it stays exiled) is always granted: the player decides when (and whether) to cast, not up front // "as many times as you choose" asks on every round instead (steps7 __repeat_ask)
        const inner = { ...step, optional: false, condition: undefined, __asked: true } as Step;
        // "you may put a land card from your hand onto the battlefield" with no land card in hand: nothing to decide, so no question; the log says so (CR 608.2: do as much as possible)
        if (step.kind === "choose" && !step.choice && step.from && !step.fromLooked && !step.fromRevealed && !step.fromMilled) {
          let chooser: PlayerId | undefined; try { chooser = chooserOf(r, ex.env, step); } catch { chooser = undefined; }
          if (chooser && !chooseCandidates(r, ex.env, step, chooser).length) {
            emit(r, { type: "nothing_to_choose", source: ex.env.source, ability: ex.env.item.abilityId, player: chooser, zone: (step.from as ObjectFilter).zone ?? "battlefield", item: ex.env.item.id });
            frame.steps = [...frame.steps]; frame.steps[frame.i] = inner;
            continue;
          }
        }
        const asker = step.kind === "search_library" || (step.kind === "choose" && step.who) ? resolvePlayers(r, step.who ?? "you", ex.env)[0] : undefined; // "its controller MAY search" / "each player MAY choose a creature": they decide
        const may: Step = { kind: "__may" as never, inner, asker, prompt: step.prompt ?? promptForMay(label(r, ex.env.source), String(step.kind).replace(/_/g, " ")) } as Step;
        frame.steps = [...frame.steps]; frame.steps[frame.i] = may;
        continue;
      }
      if (step.unlessPay) {
        const inner = { ...step, unlessPay: undefined } as Step; delete inner.costPerCounter;
        let pay = step.unlessPay as unknown as { cost: Array<{ mana?: string }> };
        if (step.costPerCounter) { // cumulative upkeep: the cost is paid once per counter of that kind on the source
          const n = tryObj(r, ex.env.source)?.counters[String(step.costPerCounter)] ?? 0;
          pay = { ...pay, cost: pay.cost.map((c) => (c.mana ? { ...c, mana: c.mana.repeat(Math.max(n, 1)) } : c)) };
        }
        frame.steps = [...frame.steps]; frame.steps[frame.i] = { kind: "__unless" as never, inner, pay } as Step;
        continue;
      }
      if (step.reflexive && typeof step.target === "string" && !["move_card_zone", "copy"].includes(step.kind) && !(step.kind === "reanimate" && step.amount !== undefined)) {
        // "When you do, destroy target nonland permanent" (Skyfisher Spider): the reflexive trigger picks its target NOW, after the earlier steps ran
        const tspec = ex.env.item.parts.flatMap((pp) => pp.specs).find((sp) => sp.id === step.target);
        if (tspec && (tspec.what === "any" || tspec.what === "player")) { // "any target" / "target player": chosen NOW among players and permanents (the reflexive trigger's own targeting)
          frame.steps = [...frame.steps]; frame.steps.splice(frame.i, 1, { kind: "__reflexive_pick" as never, spec: tspec } as unknown as Step, { ...step, reflexive: undefined } as Step);
          continue;
        }
        if (tspec) {
          const pick = { kind: "choose", who: "you", from: tspec.filter ?? {}, min: 1, max: 1, saveAs: "chosen" } as unknown as Step;
          frame.steps = [...frame.steps]; frame.steps.splice(frame.i, 1, pick, { ...step, target: "chosen", reflexive: undefined } as Step);
          continue;
        }
      }
      result = spec.run(r, ex, step, pendingAnswer);
      if (result === "done" && step.id) ex.env.done.push(step.id);
    }
    } catch (e) {
      // continue mode: something this step needed turned out to be unsupported while running (a reference, predicate or field the static check could not see)
      if (!(e instanceof Unsupported) || !continuing(r)) throw e;
      continueHooks.stepSkipped?.(r, ex.env.source, ex.env.item.abilityId, step, e.all);
      pendingAnswer = undefined; frame.i++; continue;
    }
    if (typeof result === "object" && "ask" in result) return { status: "ask", spec: result.ask };
    pendingAnswer = undefined;
    frame.i++;
    if (typeof result === "object" && "push" in result) {
      if (!internal && step.id && !PER_PLAYER_DONE.has(step.kind as string)) ex.env.done.push(step.id); // discard / sacrifice: done = some player actually did it (noteDone)
      ex.frames.push({ steps: result.push, i: 0 });
    }
  }
}

export { parseManaCost };
