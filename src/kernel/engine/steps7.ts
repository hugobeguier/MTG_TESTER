// Kernel step 7 step kinds and field extensions (long tail). Registered by steps.ts after the step 6 registry. Same contract as every
// step: never mutate before asking. Wrapped steps keep their base behaviour for the fields they already handled.

import type { ObjectFilter, Prompt, Step } from "../schema";
import { chars, emit, label, moveObject, player, tryObj, Unsupported, type Run } from "./core";
import { addDurable } from "./durable";
import { addLink } from "./links";
import { evalQuantity, objectsMatching, resolveObjs, resolvePlayers } from "./query";
import { addRegenShield } from "./regen";
import { setResult } from "./saved";
import { recordMilled, revealUntilRun } from "./reveal7";
import { checkCounterAnswer, counterSpec } from "./counters7";
import { addCounters, dealDamage, decide, destroyObject, discardCard, fallbackPromptOf, players, refs, type AskSpec, type Handler, type StepResult, type StepSpec } from "./steps";
import type { Env, ObjId } from "./types";

import { addTemporaryPT as addPump } from "./steps";
const qty = (r: Run, env: Env, step: Step, key = "amount", dflt = 1): number => (step[key] === undefined ? dflt : evalQuantity(r, step[key] as never, env));
const cardOptions = (r: Run, ids: ObjId[]) => ids.map((id) => ({ id, label: label(r, id) }));

export const STEPS7: Record<string, StepSpec> = {};
export const INTERNAL7: Record<string, Handler> = {};

type Pre = (r: Run, ex: Parameters<Handler>[1], step: Step, answer: Parameters<Handler>[3]) => StepResult | undefined;
/** Extend a base step: `extra` are the new fields, `pre` may take over a run (returning a result) or fall through to the base behaviour. */
function extend(base: Record<string, StepSpec>, kind: string, extra: string[], pre?: Pre): void {
  const b = base[kind];
  STEPS7[kind] = { fields: [...b.fields, ...extra], run: (r, ex, step, answer) => (pre ? (pre(r, ex, step, answer) ?? b.run(r, ex, step, answer)) : b.run(r, ex, step, answer)) };
}

export function steps7(base: Record<string, StepSpec>): void {
  // destroy_target.amount: "destroy X target ...": never more than `amount` of the chosen targets
  extend(base, "destroy_target", ["amount"], (r, ex, step) => {
    if (step.amount === undefined) return undefined;
    const n = qty(r, ex.env, step);
    let k = 0;
    for (const t of refs(r, ex.env, step)) { if (k >= n) break; if (destroyObject(r, t, !!step.noRegenerate)) k++; }
    return "done";
  });
  // exile_target: linked exile, "until this leaves the battlefield"
  extend(base, "exile_target", ["linkExile", "who", "duration"], (r, ex, step) => {
    const env = ex.env;
    const dur = step.duration as string | undefined;
    if (dur !== undefined && dur !== "while_source_on_battlefield") throw new Unsupported(`duration:${String(dur)}`);
    const srcObj = tryObj(r, env.source);
    // "until this leaves the battlefield": if the source is already gone (it left before the trigger resolved) nothing is exiled
    if (dur === "while_source_on_battlefield" && (!srcObj || srcObj.zone !== "battlefield")) return "done";
    for (const t of refs(r, env, step)) {
      const o = tryObj(r, t);
      if (!o || o.zone === "stack") continue;
      moveObject(r, t, "exile"); emit(r, { type: "exiled", id: t });
      const after = tryObj(r, t);
      if (!after || after.zone !== "exile") continue;
      if (step.linkExile) addLink(r, env.source, t);
      if (dur === "while_source_on_battlefield" && srcObj) addDurable(r, { owner: env.controller, source: env.source, expires: { ev: "never" }, unexile: { objectId: t, objectTs: after.timestamp, sourceId: env.source, sourceTs: srcObj.timestamp } });
    }
    return "done";
  });
  // untap_target with a count: "untap up to five lands"
  extend(base, "untap_target", ["amount", "upTo"], (r, ex, step) => {
    if (step.amount === undefined) return undefined;
    return { push: [{ kind: "__untap_pick" as never, filter: step.filter, n: qty(r, ex.env, step), upTo: !!step.upTo, prompt: step.prompt, target: step.target } as Step] };
  });
  // add_counters to a whole group
  extend(base, "add_counters", ["all", "filter"], (r, ex, step) => {
    if (!step.all) return undefined;
    const n = qty(r, ex.env, step);
    addCounters(r, objectsMatching(r, (step.filter ?? {}) as ObjectFilter, ex.env), String(step.counterKind), n);
    return "done";
  });
  // discard "up to N" / "any number": the player chooses how many, the number discarded is the step result (and "that many")
  extend(base, "discard", ["upTo", "min", "saveAs"], (r, ex, step) => {
    if (!step.upTo && step.min === undefined) return undefined;
    return { push: players(r, ex.env, step).map((p) => ({ kind: "__discard_up_to" as never, player: p, n: qty(r, ex.env, step), id: step.id, saveAs: step.saveAs, prompt: step.prompt }) as Step) };
  });
  // reanimate of several cards: each with a different mana value / all matching
  extend(base, "reanimate", ["differentManaValues", "all", "filter"], (r, ex, step) => {
    if (!step.differentManaValues && !step.all) return undefined;
    const ctl = resolvePlayers(r, step.who ?? "you", ex.env)[0];
    const f = (step.filter ?? {}) as ObjectFilter;
    let ids = step.all ? objectsMatching(r, { ...f, zone: f.zone ?? "graveyard" }, ex.env) : refs(r, ex.env, step);
    if (step.differentManaValues) { const seen = new Set<number>(); ids = ids.filter((id) => { const mv = chars(r, id).mv; if (seen.has(mv)) return false; seen.add(mv); return true; }); }
    for (const t of ids) { const o = tryObj(r, t); if (o && o.zone === "graveyard") { moveObject(r, t, "battlefield", { controller: ctl }); emit(r, { type: "reanimated", id: t }); } }
    return "done";
  });
  // remove_counters of ANY kind with a choice: "move any number of counters", or removing fewer than there are of several kinds
  extend(base, "remove_counters", ["upTo"], (r, ex, step) => {
    if (step.counterKind !== "any") return undefined;
    const id = refs(r, ex.env, { ...step, target: step.on ?? "self" } as Step)[0];
    const o = id ? tryObj(r, id) : undefined;
    if (!o) return step.upTo ? "done" : undefined;
    const kinds = Object.entries(o.counters).filter(([, c]) => c > 0);
    const total = kinds.reduce((a, [, c]) => a + c, 0);
    const n = Math.min(qty(r, ex.env, step), total);
    if (!step.upTo && (kinds.length <= 1 || n >= total)) return undefined;
    if (total === 0) { if (typeof step.saveAs === "string") ex.env.chosen[step.saveAs] = []; return "done"; }
    return { push: [{ kind: "__counters_pick" as never, on: id, n, upTo: !!step.upTo, saveAs: step.saveAs, prompt: step.prompt } as Step] };
  });
  extend(base, "grant_effect", ["appliesTo"]);
  // "you and target opponent each draw / create": the same step also for `alsoWho` (run once per extra player, "that player")
  for (const kind of ["draw_cards", "create_tokens", "damage_target"]) {
    const b = base[kind];
    STEPS7[kind] = {
      fields: [...b.fields, "alsoWho"],
      run: (r, ex, step, answer) => {
        if (step.alsoWho === undefined) return b.run(r, ex, step, answer);
        const extra = resolvePlayers(r, step.alsoWho as never, ex.env);
        const plain = { ...step, alsoWho: undefined } as Step;
        const first = b.run(r, ex, plain, answer);
        if (typeof first === "object") return first; // a question inside the base step: asked before the extra players are served
        const saved = ex.env.thatPlayer;
        // the extra players get the same effect as plain players: for damage the group part (all / filter / target) is not repeated
        const forExtra = kind === "damage_target" ? { ...plain, all: undefined, filter: undefined, target: undefined } : plain;
        for (const p of extra) { ex.env.thatPlayer = p; b.run(r, ex, { ...forExtra, who: "that_player" } as Step, undefined); }
        ex.env.thatPlayer = saved;
        return "done";
      }
    };
  }
  // mass_pump on what a player controls ("creatures defending player controls get -1/-1")
  { const b = base.mass_pump; STEPS7.mass_pump = { fields: [...b.fields, "who"], run: (r, ex, step, answer) => {
    if (!step.who) return b.run(r, ex, step, answer);
    const owners = resolvePlayers(r, step.who as never, ex.env);
    const f = { ...(step.filter ?? {}), controller: undefined } as ObjectFilter;
    const p = qty(r, ex.env, step, "power", 0), t = qty(r, ex.env, step, "toughness", 0);
    if (step.duration !== undefined && step.duration !== "until_end_of_turn") throw new Unsupported("duration:" + String(step.duration));
    for (const id of objectsMatching(r, f, ex.env)) if (owners.includes(tryObj(r, id)!.controller)) addPump(r, id, p, t);
    return "done";
  } }; }
  // reveal until a card / N cards matching a filter are revealed (they stay in the library: the revealed set)
  extend(base, "reveal", ["until"], (r, ex, step) => { if (step.until === undefined) return undefined; revealUntilRun(r, ex.env, step); return "done"; });
  // mill remembers what it milled ("a card milled this way")
  { const b = base.mill; STEPS7.mill = { fields: b.fields, run: (r, ex, step, answer) => { const n = qty(r, ex.env, step); const before = players(r, ex.env, step).flatMap((p) => player(r, p).library.slice(0, Math.max(0, n))); const res = b.run(r, ex, step, answer); recordMilled(ex.env, before.filter((id) => tryObj(r, id)?.zone === "graveyard")); return res; } }; }
  STEPS7.extra_turn = {
    fields: ["who"],
    run: (r, ex, step) => {
      for (const pid of resolvePlayers(r, (step.who ?? "you") as never, ex.env)) { (r.s.extraTurns ??= []).push(pid); emit(r, { type: "extra_turn_added", player: pid }); }
      return "done";
    }
  };
  STEPS7.regenerate = {
    fields: ["target", "duration", "noRegenerate"],
    run: (r, ex, step) => {
      if (step.duration !== undefined && step.duration !== "until_end_of_turn") throw new Unsupported(`duration:${String(step.duration)}`);
      for (const id of refs(r, ex.env, step)) addRegenShield(r, id);
      return "done";
    }
  };
  STEPS7.fight_pairs = {
    fields: ["fighters", "against", "pairing"],
    run: (r, ex, step) => {
      if (step.pairing !== "controller_chooses") throw new Unsupported("field:fight_pairs.pairing");
      const fighters = resolveObjs(r, String(step.fighters), ex.env).filter((id) => tryObj(r, id)?.zone === "battlefield");
      // the pool is fixed now: the creatures that exist when the step starts (the fighters themselves are never in it)
      const pool = objectsMatching(r, (step.against ?? {}) as ObjectFilter, ex.env).filter((id) => !fighters.includes(id));
      return { push: fighters.map((f, i) => ({ kind: "__fight_pair" as never, fighter: f, pool, index: i, prompt: step.prompt }) as Step) };
    }
  };

  INTERNAL7.__counters_pick = (r, ex, step, answer) => {
    const on = String(step.on);
    const o = tryObj(r, on);
    const avail = Object.fromEntries(Object.entries(o?.counters ?? {}).filter(([, c]) => c > 0));
    const n = Math.min(Number(step.n), Object.values(avail).reduce((a, b) => a + b, 0));
    const spec = counterSpec(r, ex.env.controller, (step.prompt as Prompt | undefined) ?? fallbackPromptOf(r, ex.env, "counters", `Choose ${step.upTo ? "up to " : ""}${n} counter${n === 1 ? "" : "s"} from ${label(r, on)}.`), avail, step.upTo ? 0 : n, n, (k) => k);
    if (!answer) return { ask: spec };
    const asg = checkCounterAnswer(spec, answer);
    const saved: string[] = [];
    for (const [k, v] of Object.entries(asg)) { addCounters(r, [on], k, -v); saved.push(`${k}:${v}`); }
    if (typeof step.saveAs === "string") ex.env.chosen[step.saveAs] = saved;
    return "done";
  };
  INTERNAL7.__miracle = (r, ex, step, answer) => {
    const id = String(step.card), pid = ex.env.controller;
    const o = tryObj(r, id);
    if (!o || o.zone !== "hand" || o.timestamp !== Number(step.ts) || !o.owner || o.owner !== pid) return "done"; // it left the hand: the miracle is lost
    const spec: AskSpec = { kind: "choose_yes_no", player: pid, prompt: { title: "Miracle", instruction: "Reveal the card you just drew and cast it for its miracle cost?" }, options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }], min: 1, max: 1 };
    const d = decide(spec, answer);
    if ("ask" in d) return d;
    if (d.yes) { emit(r, { type: "reveal", player: pid, ids: [id], names: [label(r, id)] }); (r.castNow ??= []).push({ player: pid, id, ts: o.timestamp, withoutPaying: false, option: String(step.option) }); }
    return "done";
  };
  INTERNAL7.__untap_pick = (r, ex, step, answer) => {
    const cands = step.target ? refs(r, ex.env, step) : objectsMatching(r, (step.filter ?? {}) as ObjectFilter, ex.env);
    const tapped = cands.filter((id) => tryObj(r, id)?.tapped);
    const n = Math.min(Number(step.n), tapped.length);
    if (n <= 0) return "done";
    let ids = tapped;
    if (!(tapped.length <= n && !step.upTo)) {
      const spec: AskSpec = { kind: "choose_cards", player: ex.env.controller, prompt: (step.prompt as Prompt | undefined) ?? fallbackPromptOf(r, ex.env, "untap", `Choose ${step.upTo ? "up to " : ""}${n} to untap.`), options: cardOptions(r, tapped), min: step.upTo ? 0 : n, max: n };
      const d = decide(spec, answer);
      if ("ask" in d) return d;
      ids = d.ids;
    }
    for (const id of ids) { const o = tryObj(r, id); if (o && o.tapped) { o.tapped = false; emit(r, { type: "untap", id }); } }
    return "done";
  };
  INTERNAL7.__discard_up_to = (r, ex, step, answer) => {
    const pid = String(step.player);
    const hand = player(r, pid).hand;
    const n = Math.min(Number(step.n), hand.length);
    let ids: string[] = [];
    if (n > 0) {
      const spec: AskSpec = { kind: "choose_cards", player: pid, prompt: (step.prompt as Prompt | undefined) ?? fallbackPromptOf(r, ex.env, "discard", `Choose up to ${n} card${n === 1 ? "" : "s"} to discard.`), options: cardOptions(r, hand), min: 0, max: n };
      const d = decide(spec, answer);
      if ("ask" in d) return d;
      ids = d.ids;
      for (const id of ids) discardCard(r, pid, id);
    }
    setResult(ex.env, step.id as string | undefined, ids.length);
    if (typeof step.saveAs === "string") setResult(ex.env, step.saveAs, ids.length);
    ex.env.amount = ids.length; // "that many"
    return "done";
  };
  INTERNAL7.__fight_pair = (r, ex, step, answer) => {
    const f = String(step.fighter);
    if (tryObj(r, f)?.zone !== "battlefield") return "done";
    const used = new Set<string>(ex.env.chosen.__fought ?? []);
    const open = (step.pool as string[]).filter((id) => !used.has(id) && tryObj(r, id)?.zone === "battlefield");
    if (!open.length) return "done";
    let target = open[0];
    if (open.length > 1) {
      const spec: AskSpec = { kind: "choose_cards", player: ex.env.controller, prompt: (step.prompt as Prompt | undefined) ?? fallbackPromptOf(r, ex.env, "fight", `Choose the creature ${label(r, f)} fights.`), options: cardOptions(r, open), min: 1, max: 1 };
      const d = decide(spec, answer);
      if ("ask" in d) return d;
      target = d.ids[0];
    }
    (ex.env.chosen.__fought ??= []).push(target);
    fight(r, ex.env, f, target);
    return "done";
  };
}

/** Two creatures fight: each deals damage equal to its power to the other (701.12), simultaneously. */
export function fight(r: Run, env: Env, a: ObjId, b: ObjId): void {
  if (tryObj(r, a)?.zone !== "battlefield" || tryObj(r, b)?.zone !== "battlefield") return;
  const pa = chars(r, a).power ?? 0, pb = chars(r, b).power ?? 0;
  emit(r, { type: "fight", a, b });
  dealDamage(r, env, a, b, pa);
  dealDamage(r, env, b, a, pb);
}
