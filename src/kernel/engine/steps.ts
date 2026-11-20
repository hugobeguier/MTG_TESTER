// Step interpreter. A resolving ability is an `Exec` (a stack of step-list frames + an environment). Every step
// either completes, pushes more steps (expansion), or asks a decision; when it asks, the whole Exec is stored in the
// pending decision and re-entered with the answer. A handler must not mutate before it asks.

import type { ObjectFilter, Prompt, Step } from "../schema";
import { promptForMay } from "../prompts";
import {
  chars, drawCards, emit, label, moveObject, newObject, obj, parseManaCost, player, shuffleInPlace, tick, tryObj, Unsupported, Reject, type Run
} from "./core";
import { evalPredicate, evalQuantity, matchesFilter, objectsMatching, resolveObjs, resolvePlayers } from "./query";
import type { Choice, DecisionKind, DecisionOption, Env, Exec, ObjId, PlayerId, StackItem, TokenDef } from "./types";
import { isObjId } from "./types";

export interface AskSpec { kind: DecisionKind; player: PlayerId; prompt: Prompt; options: DecisionOption[]; min: number; max: number; repeatable?: boolean; numeric?: boolean }
export type StepResult = "done" | { ask: AskSpec } | { push: Step[] };
export type StepStatus = { status: "done" } | { status: "ask"; spec: AskSpec };

export const META_FIELDS = ["kind", "id", "src", "prompt", "optional", "condition", "__asked"];

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

const fallbackPrompt = (r: Run, env: Env, title: string, instruction: string): Prompt => ({ title: `${label(r, env.source)}: ${title}`, instruction });
const promptOr = (r: Run, env: Env, step: Step, title: string, instruction: string): Prompt => step.prompt ?? fallbackPrompt(r, env, title, instruction);
const cardOptions = (r: Run, ids: ObjId[]): DecisionOption[] => ids.map((id) => ({ id, label: label(r, id) }));

// ---------------------------------------------------------------- shared effects

export function changeLife(r: Run, env: Env | undefined, pid: PlayerId, delta: number): void {
  if (delta === 0) return;
  const p = player(r, pid);
  p.life += delta;
  if (delta > 0) { emit(r, { type: "life_gain", player: pid, amount: delta }); r.s.turnLog.push({ type: "gain_life", player: pid, amount: delta, ts: r.s.clock }); }
  else { emit(r, { type: "life_loss", player: pid, amount: -delta }); r.s.turnLog.push({ type: "lose_life", player: pid, amount: -delta, ts: r.s.clock }); if (env) env.lastLifeLost = -delta; }
}

export function dealDamage(r: Run, env: Env | undefined, source: string | undefined, target: string, amount: number): void {
  if (amount <= 0) return;
  if (!isObjId(target)) {
    emit(r, { type: "damage", source, target, amount });
    changeLife(r, env, target, -amount);
    return;
  }
  const o = tryObj(r, target);
  if (!o || o.zone !== "battlefield") return;
  const c = chars(r, target);
  if (c.types.includes("creature")) { o.damage += amount; emit(r, { type: "damage", source, target, amount }); }
  else if (c.types.includes("planeswalker")) { o.counters.loyalty = Math.max(0, (o.counters.loyalty ?? 0) - amount); emit(r, { type: "damage", source, target, amount }); }
}

function hasKeyword(r: Run, id: ObjId, kw: string): boolean { return chars(r, id).keywords.includes(kw); }

export function destroyObject(r: Run, id: ObjId): boolean {
  const o = tryObj(r, id);
  if (!o || o.zone !== "battlefield") return false;
  if (hasKeyword(r, id, "indestructible")) { emit(r, { type: "destroy_prevented", id }); return false; }
  emit(r, { type: "destroyed", id });
  moveObject(r, id, "graveyard");
  return true;
}

function discardCard(r: Run, pid: PlayerId, id: ObjId): void {
  moveObject(r, id, "graveyard");
  emit(r, { type: "discard", player: pid, id });
  r.s.turnLog.push({ type: "discard", player: pid, id, name: label(r, id), types: chars(r, id).types, ts: r.s.clock });
}

function parseTypeLine(tl: string | undefined): { types: string[]; subtypes: string[] } {
  const [left, right] = (tl ?? "Creature").split(/\s+[—-]\s+/);
  const types = left.split(/\s+/).filter(Boolean).map((t) => t.toLowerCase()).filter((t) => t !== "legendary" && t !== "basic");
  return { types, subtypes: (right ?? "").split(/\s+/).filter(Boolean) };
}

// ---------------------------------------------------------------- step registry

type Handler = (r: Run, ex: Exec, step: Step, answer: Choice | undefined) => StepResult;
interface StepSpec { fields: string[]; run: Handler }

const players = (r: Run, env: Env, step: Step): PlayerId[] => resolvePlayers(r, step.who ?? "you", env);
const qty = (r: Run, env: Env, step: Step, key = "amount", dflt = 1): number => (step[key] === undefined ? dflt : evalQuantity(r, step[key] as never, env));
const refs = (r: Run, env: Env, step: Step, key = "target"): string[] => resolveObjs(r, step[key] as string | undefined, env);

const STEPS: Record<string, StepSpec> = {
  draw_cards: {
    fields: ["amount", "who"],
    run: (r, ex, step) => { const n = qty(r, ex.env, step); for (const p of players(r, ex.env, step)) drawCards(r, p, n); return "done"; }
  },
  life_change: {
    fields: ["lifeDelta", "amount", "who"],
    run: (r, ex, step) => {
      const delta = step.lifeDelta !== undefined ? Number(step.lifeDelta) : qty(r, ex.env, step, "amount", 0);
      for (const p of players(r, ex.env, step)) changeLife(r, ex.env, p, delta);
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
    fields: ["amount", "target", "who", "source", "all", "filter"],
    run: (r, ex, step) => {
      const env = ex.env;
      const amount = qty(r, env, step);
      const src = step.source ? refs(r, env, step, "source")[0] : env.source;
      let targets: string[];
      if (step.all) targets = objectsMatching(r, (step.filter ?? {}) as ObjectFilter, env);
      else if (step.target) targets = refs(r, env, step);
      else targets = players(r, env, step);
      for (const t of targets) dealDamage(r, env, src, t, amount);
      return "done";
    }
  },
  destroy_target: { fields: ["target", "noRegenerate"], run: (r, ex, step) => { for (const t of refs(r, ex.env, step)) destroyObject(r, t); return "done"; } },
  destroy_all: {
    fields: ["filter", "noRegenerate"],
    run: (r, ex, step) => { for (const id of objectsMatching(r, (step.filter ?? {}) as ObjectFilter, ex.env)) destroyObject(r, id); return "done"; }
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
  reanimate: {
    fields: ["target", "who", "tapped"],
    run: (r, ex, step) => {
      const ctl = resolvePlayers(r, step.who ?? "you", ex.env)[0];
      for (const t of refs(r, ex.env, step)) { const o = tryObj(r, t); if (o && o.zone === "graveyard") { moveObject(r, t, "battlefield", { controller: ctl, tapped: !!step.tapped }); emit(r, { type: "reanimated", id: t }); } }
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
    run: (r, ex, step) => ({ push: players(r, ex.env, step).map((p) => ({ kind: "__discard" as never, player: p, n: qty(r, ex.env, step), prompt: step.prompt }) as Step) })
  },
  tap_target: {
    fields: ["target"],
    run: (r, ex, step) => { for (const t of refs(r, ex.env, step)) { const o = tryObj(r, t); if (o && o.zone === "battlefield" && !o.tapped) { o.tapped = true; emit(r, { type: "tap", id: t }); } } return "done"; }
  },
  untap_target: {
    fields: ["target", "all", "filter"],
    run: (r, ex, step) => {
      const ids = step.all ? objectsMatching(r, (step.filter ?? {}) as ObjectFilter, ex.env) : refs(r, ex.env, step);
      for (const t of ids) { const o = tryObj(r, t); if (o && o.zone === "battlefield" && o.tapped) { o.tapped = false; emit(r, { type: "untap", id: t }); } }
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
    fields: ["target", "modify", "duration"],
    run: (r, ex, step) => {
      requireEot(step);
      const mods = (step.modify ?? []) as Array<Record<string, unknown>>;
      for (const m of mods) if (!("grant" in m) || Object.keys(m).length !== 1 || typeof m.grant !== "string") throw new Unsupported(`field:grant_effect.modify.${Object.keys(m)[0]}`);
      for (const id of refs(r, ex.env, step)) for (const m of mods) addEffect(r, id, { grant: String(m.grant).toLowerCase() });
      return "done";
    }
  },
  create_tokens: {
    fields: ["tokenCount", "tokenName", "tokenPower", "tokenToughness", "tokenColors", "tokenTypeLine", "tokenKeywords", "tokenTapped", "who"],
    run: (r, ex, step) => {
      const env = ex.env;
      const { types, subtypes } = parseTypeLine(step.tokenTypeLine as string | undefined);
      if (subtypes.some((s) => ["Treasure", "Food", "Clue", "Blood", "Map", "Powerstone"].includes(s))) throw new Unsupported("token:predefined_abilities", `${subtypes.join(" ")} tokens carry rules the engine does not model yet`);
      const def: TokenDef = {
        name: String(step.tokenName ?? subtypes[0] ?? "Token"), types, subtypes,
        colors: ((step.tokenColors as string[] | undefined) ?? []).filter((c) => c !== "colorless"),
        power: step.tokenPower === undefined ? undefined : evalQuantity(r, step.tokenPower as never, env),
        toughness: step.tokenToughness === undefined ? undefined : evalQuantity(r, step.tokenToughness as never, env),
        keywords: (step.tokenKeywords as string[] | undefined) ?? []
      };
      const n = qty(r, env, step, "tokenCount");
      env.created = [];
      for (const pid of players(r, env, step)) {
        for (let i = 0; i < n; i++) {
          const o = newObject(r, def.name, pid, "exile", { token: def });
          // enters the battlefield through the normal zone change so etb triggers fire
          o.zone = "exile";
          moveObject(r, o.id, "battlefield", { controller: pid, tapped: !!step.tokenTapped });
          env.created.push(o.id);
          emit(r, { type: "token_created", id: o.id, player: pid });
          r.s.turnLog.push({ type: "token_created", id: o.id, player: pid, name: def.name, types: def.types.map((t) => t.toLowerCase()), token: true, ts: r.s.clock });
        }
      }
      return "done";
    }
  },
  put_counters_on_self: {
    fields: ["counterKind", "amount"],
    run: (r, ex, step) => { addCounters(r, [ex.env.source], String(step.counterKind), qty(r, ex.env, step)); return "done"; }
  },
  add_counters: {
    fields: ["on", "counterKind", "amount"],
    run: (r, ex, step) => { addCounters(r, resolveObjs(r, String(step.on ?? "self"), ex.env), String(step.counterKind), qty(r, ex.env, step)); return "done"; }
  },
  remove_counters: {
    fields: ["on", "counterKind", "amount"],
    run: (r, ex, step) => { addCounters(r, resolveObjs(r, String(step.on ?? "self"), ex.env), String(step.counterKind), -qty(r, ex.env, step)); return "done"; }
  },
  sacrifice_permanent: {
    fields: ["who", "amount", "filter", "target"],
    run: (r, ex, step) => {
      const env = ex.env;
      if (step.target) {
        if (step.target !== "self") throw new Unsupported(`field:sacrifice_permanent.target=${String(step.target)}`);
        for (const id of refs(r, env, step)) sacrificeObject(r, id);
        return "done";
      }
      return { push: players(r, env, step).map((p) => ({ kind: "__sacrifice" as never, player: p, n: qty(r, env, step), filter: step.filter, prompt: step.prompt }) as Step) };
    }
  },
  move_card_zone: {
    fields: ["target", "moveTo", "moveFrom", "from", "position", "tapped"],
    run: (r, ex, step) => {
      const to = step.moveTo as "hand" | "graveyard" | "exile" | "battlefield" | "library";
      const from = (step.from ?? step.moveFrom) as string | undefined;
      for (const t of refs(r, ex.env, step)) {
        const o = tryObj(r, t);
        if (!o || o.zone === "stack" || (from && o.zone !== from)) continue;
        moveObject(r, t, to, { position: step.position as "top" | "bottom" | undefined, controller: to === "battlefield" ? ex.env.controller : undefined, tapped: !!step.tapped });
      }
      return "done";
    }
  },
  counter_spell: {
    fields: ["target"],
    run: (r, ex, step) => {
      for (const t of refs(r, ex.env, step)) {
        const i = r.s.stack.findIndex((it) => it.objectId === t);
        if (i < 0) continue;
        const [item] = r.s.stack.splice(i, 1);
        emit(r, { type: "spell_countered", id: t, by: ex.env.source, controller: item.controller });
        moveObject(r, t, "graveyard");
      }
      return "done";
    }
  },
  shuffle: { fields: ["who"], run: (r, ex, step) => { for (const p of players(r, ex.env, step)) { shuffleInPlace(r, player(r, p).library); emit(r, { type: "shuffle", player: p }); } return "done"; } },
  scry: { fields: ["amount", "who"], run: (r, ex, step) => ({ push: players(r, ex.env, step).map((p) => ({ kind: "__scry" as never, player: p, n: qty(r, ex.env, step), prompt: step.prompt, to: "bottom" }) as Step) }) },
  surveil: { fields: ["amount", "who"], run: (r, ex, step) => ({ push: players(r, ex.env, step).map((p) => ({ kind: "__scry" as never, player: p, n: qty(r, ex.env, step), prompt: step.prompt, to: "graveyard" }) as Step) }) },
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
  if_else: {
    fields: ["if", "then", "else"],
    run: (r, ex, step) => ({ push: (evalPredicate(r, step.if!, ex.env) ? step.then : step.else) ?? [] })
  }
};

export const STEP_FIELDS: Record<string, string[]> = Object.fromEntries(Object.entries(STEPS).map(([k, v]) => [k, v.fields]));
export const SUPPORTED_ENGINE_STEP_KINDS: ReadonlySet<string> = new Set(Object.keys(STEPS));

function requireEot(step: Step): void {
  if (step.duration !== undefined && step.duration !== "until_end_of_turn") throw new Unsupported(`duration:${typeof step.duration === "string" ? step.duration : Object.keys(step.duration)[0]}`);
}

function addEffect(r: Run, id: ObjId, e: { power?: number; toughness?: number; grant?: string }): void {
  const o = tryObj(r, id);
  if (!o || o.zone !== "battlefield") return;
  r.s.effects.push({ id: `e${r.s.effects.length}_${r.s.clock}`, timestamp: tick(r), objectId: id, objectTimestamp: o.timestamp, until: "end_of_turn", ...e });
  emit(r, { type: "effect_added", id, ...e });
}

function addCounters(r: Run, ids: string[], kind: string, n: number): void {
  for (const id of ids) {
    const o = tryObj(r, id);
    if (!o || o.zone !== "battlefield") continue;
    const next = Math.max(0, (o.counters[kind] ?? 0) + n);
    o.counters[kind] = next;
    if (next === 0) delete o.counters[kind];
    emit(r, { type: n >= 0 ? "counter_added" : "counter_removed", id, kind, amount: Math.abs(n) });
  }
}

function sacrificeObject(r: Run, id: ObjId): void {
  const o = tryObj(r, id);
  if (!o || o.zone !== "battlefield") return;
  const owner = o.controller;
  emit(r, { type: "sacrificed", id, player: owner });
  r.s.turnLog.push({ type: "sacrifice", id, player: owner, ts: r.s.clock });
  moveObject(r, id, "graveyard");
}

// ---------------------------------------------------------------- internal steps

const INTERNAL: Record<string, Handler> = {
  __part: (_r, ex, step) => { ex.env.targets = ex.env.item.parts[Number(step.index)].targets; return "done"; },
  __may: (r, ex, step, answer) => {
    const spec: AskSpec = { kind: "choose_yes_no", player: ex.env.controller, prompt: step.prompt!, options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }], min: 1, max: 1 };
    const d = decide(spec, answer);
    if ("ask" in d) return d;
    return d.yes ? { push: [step.inner as Step] } : "done";
  },
  __discard: (r, ex, step, answer) => {
    const pid = String(step.player);
    const hand = player(r, pid).hand;
    const n = Math.min(Number(step.n), hand.length);
    if (n <= 0) return "done";
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
    const mine = r.s.battlefield.filter((id) => r.s.objects[id].controller === pid && matchesFilter(r, id, f, { ...ex.env, controller: pid }));
    const n = Math.min(Number(step.n), mine.length);
    if (n <= 0) return "done";
    if (n === mine.length) { for (const id of [...mine]) sacrificeObject(r, id); return "done"; }
    const spec: AskSpec = { kind: "choose_cards", player: pid, prompt: (step.prompt as Prompt | undefined) ?? fallbackPrompt(r, ex.env, "sacrifice", `Choose ${n} permanent${n === 1 ? "" : "s"} to sacrifice.`), options: cardOptions(r, mine), min: n, max: n };
    const d = decide(spec, answer);
    if ("ask" in d) return d;
    for (const id of d.ids) sacrificeObject(r, id);
    return "done";
  },
  __scry: (r, ex, step, answer) => {
    const pid = String(step.player);
    const lib = player(r, pid).library;
    const n = Math.min(Number(step.n), lib.length);
    if (n <= 0) return "done";
    const top = lib.slice(0, n);
    const to = String(step.to);
    const spec: AskSpec = {
      kind: "choose_cards", player: pid,
      prompt: (step.prompt as Prompt | undefined) ?? fallbackPrompt(r, ex.env, to === "bottom" ? "scry" : "surveil", to === "bottom" ? "Choose any cards to put on the bottom of your library; the rest stay on top." : "Choose any cards to put into your graveyard; the rest stay on top."),
      options: cardOptions(r, top), min: 0, max: n
    };
    const d = decide(spec, answer);
    if ("ask" in d) return d;
    // the kept cards stay on top in their current order (ordering the top is a documented simplification)
    for (const id of d.ids) moveObject(r, id, to === "bottom" ? "library" : "graveyard", { position: "bottom" });
    emit(r, { type: to === "bottom" ? "scry" : "surveil", player: pid, count: n, moved: d.ids.length });
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
      eventObj: item.trigger?.eventObj, eventPlayer: item.trigger?.eventPlayer, amount: item.trigger?.amount
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
    if (internal) result = internal(r, ex, step, pendingAnswer);
    else {
      const spec = STEPS[step.kind];
      if (!spec) throw new Unsupported(`step:${step.kind}`);
      if (step.unlessPay) throw new Unsupported("step:unless_pay");
      for (const k of Object.keys(step)) if (!META_FIELDS.includes(k) && !spec.fields.includes(k)) throw new Unsupported(`field:${step.kind}.${k}`);
      if (step.condition && !pendingAnswer && !evalPredicate(r, step.condition.if, ex.env)) { frame.i++; continue; }
      if (step.optional && !(step as Step & { __asked?: boolean }).__asked) {
        const inner = { ...step, optional: false, condition: undefined, __asked: true } as Step;
        const may: Step = { kind: "__may" as never, inner, prompt: step.prompt ?? promptForMay(label(r, ex.env.source), String(step.kind).replace(/_/g, " ")) } as Step;
        frame.steps = [...frame.steps]; frame.steps[frame.i] = may;
        continue;
      }
      result = spec.run(r, ex, step, pendingAnswer);
      if (result === "done" && step.id) ex.env.done.push(step.id);
    }
    if (typeof result === "object" && "ask" in result) return { status: "ask", spec: result.ask };
    pendingAnswer = undefined;
    frame.i++;
    if (typeof result === "object" && "push" in result) {
      if (!internal && step.id) ex.env.done.push(step.id);
      ex.frames.push({ steps: result.push, i: 0 });
    }
  }
}

export { parseManaCost };
