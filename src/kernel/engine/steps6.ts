// Kernel step 6 step kinds (long tail): investigate, proliferate, gain_control, exchange_life, and friends. Registered by steps.ts
// (it is the only importer, which keeps the registry in one place). Same contract as every step: never mutate before asking.

import type { Ability, ObjectFilter, Prompt, Step } from "../schema";
import { invalidateIndex } from "./layers";
import { emit, label, newObject, player, Reject, tick, tryObj, Unsupported, type Run } from "./core";
import { addDurable, expiryFor, SUPPORTED_DURABLE_DURATIONS } from "./durable";
import { addMana } from "./mana";
import { addUnits } from "./manapool";
import { evalQuantity, objectsMatching, resolvePlayers } from "./query";
import { addCounters, changeLife, decide, fallbackPromptOf, players, refs, type AskSpec, type Handler, type StepSpec } from "./steps";
import type { ObjId } from "./types";

export const STEPS6: Record<string, StepSpec> = {
  investigate: {
    fields: ["amount", "who"],
    run: (r, ex, step) => ({ push: [{ kind: "create_tokens", tokenCount: step.amount ?? 1, tokenName: "Clue", tokenTypeLine: "Artifact — Clue", who: step.who ?? "you" } as Step] })
  },
  proliferate: {
    fields: [],
    run: (_r, ex) => ({ push: [{ kind: "__proliferate" as never, player: ex.env.controller } as Step] })
  },
  gain_control: {
    fields: ["target", "who", "all", "filter", "duration"],
    run: (r, ex, step) => {
      const env = ex.env;
      let ids: string[];
      if (step.all) {
        const victims = resolvePlayers(r, step.who ?? "each_opponent", env);
        ids = objectsMatching(r, (step.filter ?? {}) as ObjectFilter, env).filter((id) => victims.includes(tryObj(r, id)!.controller));
      } else ids = refs(r, env, step);
      if (step.duration !== undefined && !(typeof step.duration === "string" && SUPPORTED_DURABLE_DURATIONS.has(step.duration))) throw new Unsupported(`duration:${typeof step.duration === "string" ? step.duration : "object"}`);
      for (const id of ids) {
        const o = tryObj(r, id);
        if (!o || o.zone !== "battlefield" || o.controller === env.controller) continue;
        const was = o.controller;
        o.controller = env.controller;
        o.controlledSince = tick(r); // summoning sick under its new controller
        emit(r, { type: "control_changed", id, from: was, to: env.controller });
        if (step.duration) addDurable(r, { owner: env.controller, source: env.source, expires: expiryFor(r, step.duration as never, env.controller), control: { objectId: id, objectTs: o.timestamp, was } });
      }
      return "done";
    }
  },
  exchange_life: {
    fields: ["who", "withWho"],
    run: (r, ex, step) => {
      const a = players(r, ex.env, step)[0];
      const b = resolvePlayers(r, (step.withWho ?? "target_player") as never, ex.env)[0];
      if (!a || !b || a === b) return "done";
      const la = player(r, a).life, lb = player(r, b).life;
      changeLife(r, ex.env, a, lb - la);
      changeLife(r, ex.env, b, la - lb);
      ex.env.lastLifeLost = Math.max(0, la - lb); // "if you lost life this way"
      emit(r, { type: "life_exchanged", players: [a, b] });
      return "done";
    }
  }
};

// ---------------------------------------------------------------- counters: "put those counters on", "remove all counters"

export const INTERNAL6: Record<string, Handler> = {
  /** Reveal one card of a filter (from hand): the owner picks it when there is a choice; the reveal is public. */
  __reveal_pick: (r, ex, step, answer) => {
    const cands = objectsMatching(r, step.filter as ObjectFilter, ex.env);
    if (!cands.length) return "done";
    let ids = cands;
    if (cands.length > 1) {
      const spec: AskSpec = { kind: "choose_cards", player: ex.env.controller, prompt: (step.prompt as Prompt | undefined) ?? fallbackPromptOf(r, ex.env, "reveal", "Choose a card to reveal."), options: cands.map((id) => ({ id, label: label(r, id) })), min: 1, max: 1 };
      const d = decide(spec, answer);
      if ("ask" in d) return d;
      ids = d.ids;
    }
    emit(r, { type: "reveal", player: ex.env.controller, ids: [ids[0]], names: [label(r, ids[0])] });
    return "done";
  },
  /** Proliferate: choose any number of permanents with counters; each gets one more counter of each kind it has. */
  __proliferate: (r, ex, step, answer) => {
    const pid = String(step.player);
    const cands = r.s.battlefield.filter((id) => Object.values(r.s.objects[id].counters).some((n) => n > 0));
    if (!cands.length) return "done";
    const spec: AskSpec = { kind: "choose_cards", player: pid, prompt: (step.prompt as Prompt | undefined) ?? fallbackPromptOf(r, ex.env, "proliferate", "Choose any number of permanents with counters: each gets another counter of each kind it has."), options: cands.map((id) => ({ id, label: label(r, id) })), min: 0, max: cands.length };
    const d = decide(spec, answer);
    if ("ask" in d) return d;
    for (const id of d.ids as ObjId[]) for (const [kind, n] of Object.entries(tryObj(r, id)?.counters ?? {})) if (n > 0) addCounters(r, [id], kind, 1);
    emit(r, { type: "proliferated", player: pid, ids: d.ids });
    return "done";
  }
};

// ---------------------------------------------------------------- add_mana (several specs, any color, chosen color; no restrictions)

const COLOR_KEYS = ["W", "U", "B", "R", "G"] as const;

type Outcome = { colors: string[]; props?: { restriction?: ObjectFilter; abilities?: ObjectFilter } };

/** The outcomes one unit of the step can produce: each is a list of mana colors added together (with the spending restriction of its spec). */
function manaOutcomes(r: Run, src: ObjId, specs: Array<Record<string, unknown>>): Outcome[] {
  const out: Outcome[] = [];
  for (const sp of specs) {
    const props = sp.restriction || sp.abilitiesOf ? { ...(sp.restriction ? { restriction: sp.restriction as ObjectFilter } : {}), ...(sp.abilitiesOf ? { abilities: sp.abilitiesOf as ObjectFilter } : {}) } : undefined;
    const put = (colors: string[]) => out.push({ colors, ...(props ? { props } : {}) });
    if (typeof sp.colors === "string") {
      const syms = [...sp.colors.matchAll(/{([WUBRGC])}/g)].map((m) => m[1]);
      if (!syms.length || sp.colors.replace(/{[WUBRGC]}/g, "") !== "") throw new Unsupported("field:add_mana.produces");
      put(syms);
    } else if (sp.anyColorAmount !== undefined) for (const c of COLOR_KEYS) put([c]); // placeholder outcomes: the combination decision decides
    else if (typeof sp.anyColor === "number") for (const c of COLOR_KEYS) put(Array(sp.anyColor).fill(c));
    else if (typeof sp.chosenColor === "number") {
      const col = tryObj(r, src)?.chosen?.color;
      if (!col) throw new Unsupported("field:add_mana.chosenColor", "no color was chosen for this permanent");
      const key = ({ white: "W", blue: "U", black: "B", red: "R", green: "G" } as Record<string, string>)[col.toLowerCase()] ?? col.toUpperCase();
      put(Array(sp.chosenColor).fill(key));
    } else throw new Unsupported("field:add_mana.produces");
  }
  const seen = new Set<string>();
  return out.filter((o) => { const k = o.colors.join("") + JSON.stringify(o.props ?? {}); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Adds the mana: plain into the pool, special (restricted / lasting) as units. */
function give(r: Run, pid: string, o: Outcome, keep: boolean, src: ObjId): void {
  if (o.props || keep) addUnits(r, pid, o.colors as never, { ...(o.props ?? {}), ...(keep ? { keep: true } : {}) }, src);
  else addMana(r, pid, o.colors as never, src);
}

STEPS6.add_mana = {
  fields: ["produces", "amount", "who", "duration"],
  run: (r, ex, step) => {
    const dur = step.duration;
    if (dur !== undefined && dur !== "until_end_of_turn") throw new Unsupported(`duration:${typeof dur === "string" ? dur : Object.keys(dur)[0]}`);
    const keep = dur === "until_end_of_turn";
    const specs = (step.produces ?? []) as Array<Record<string, unknown>>;
    const outs = manaOutcomes(r, ex.env.source, specs);
    const n = step.amount === undefined ? 1 : evalQuantity(r, step.amount as never, ex.env);
    const pid = players(r, ex.env, step)[0] ?? ex.env.controller;
    // "add N mana in any combination of colors": ONE decision splitting N between the colors
    const combo = specs.length === 1 && (specs[0].anyColorAmount !== undefined || (specs[0].anyColor === 1 && n > 1));
    if (combo) {
      const total = specs[0].anyColorAmount !== undefined ? evalQuantity(r, specs[0].anyColorAmount as never, ex.env) * Math.max(0, n) : Math.max(0, n);
      if (total === 0) return "done";
      return { push: [{ kind: "__mana_combo" as never, player: pid, total, props: outs[0].props, keep, prompt: step.prompt } as Step] };
    }
    if (outs.length === 1) { for (let i = 0; i < n; i++) give(r, pid, outs[0], keep, ex.env.source); return "done"; }
    return { push: Array.from({ length: Math.max(0, n) }, () => ({ kind: "__mana_pick" as never, player: pid, outcomes: outs, keep, prompt: step.prompt }) as Step) };
  }
};

INTERNAL6.__mana_pick = (r, ex, step, answer) => {
  const outs = step.outcomes as Outcome[];
  const labelOf = (o: Outcome) => o.colors.join("") + (o.props ? " (restricted)" : "");
  const spec: AskSpec = {
    kind: outs.every((o) => o.colors.length === 1) ? "choose_color" : "choose_option", player: String(step.player),
    prompt: (step.prompt as Prompt | undefined) ?? fallbackPromptOf(r, ex.env, "add mana", "Choose the mana to add."),
    options: outs.map((o, i) => ({ id: outs.findIndex((x) => x.colors.join("") === o.colors.join("")) === i ? o.colors.join("") : `${o.colors.join("")}#${i}`, label: labelOf(o) })), min: 1, max: 1
  };
  const d = decide(spec, answer);
  if ("ask" in d) return d;
  const picked = outs.find((o, i) => spec.options[i].id === d.ids[0])!;
  give(r, String(step.player), picked, !!step.keep, ex.env.source);
  return "done";
};

/** Split `total` mana between the five colors: the answer is `assign: {W: 2, U: 0, ...}`. */
INTERNAL6.__mana_combo = (r, ex, step, answer) => {
  const total = Number(step.total);
  const spec: AskSpec = {
    kind: "assign_mana", player: String(step.player), prompt: (step.prompt as Prompt | undefined) ?? fallbackPromptOf(r, ex.env, "add mana", `Choose ${total} mana in any combination of colors.`),
    options: COLOR_KEYS.map((c) => ({ id: c, label: c })), min: total, max: total, mana: { total, colors: [...COLOR_KEYS] }
  };
  if (!answer) return { ask: spec };
  const asg = answer.assign ?? {};
  let sum = 0;
  for (const [c, v] of Object.entries(asg)) {
    if (!(COLOR_KEYS as readonly string[]).includes(c)) throw new Reject("invalid_choice", `${c} is not a color of mana`);
    if (!Number.isInteger(v) || v < 0) throw new Reject("invalid_choice", "amounts must be whole numbers, 0 or more");
    sum += v;
  }
  if (sum !== total) throw new Reject("invalid_choice", `the amounts must add up to ${total}, got ${sum}`);
  const colors = COLOR_KEYS.flatMap((c) => Array(asg[c] ?? 0).fill(c));
  give(r, String(step.player), { colors, ...(step.props ? { props: step.props as Outcome["props"] } : {}) }, !!step.keep, ex.env.source);
  return "done";
};

/** add_counters / remove_counters with kind "same_as_source" / "any" (move counters between permanents, Ozolith / Angelic Sleuth style). */
export function countersTransferSteps(base: Record<string, StepSpec>): void {
  const plainAdd = base.add_counters, plainRemove = base.remove_counters;
  STEPS6.add_counters = {
    fields: [...plainAdd.fields, "from"],
    run: (r, ex, step, answer) => {
      if (step.counterKind !== "same_as_source") return plainAdd.run(r, ex, step, answer);
      // every counter of the source object (its last-known counters when it already left) or the counters a remove_counters step saved
      let pairs: Array<[string, number]>;
      if (typeof step.from === "string") pairs = (ex.env.chosen[step.from] ?? []).map((s) => { const [k, n] = s.split(":"); return [k, Number(n)] as [string, number]; });
      else { const eo = ex.env.eventObj; const l = eo ? r.s.lki[eo] : undefined; pairs = Object.entries(l?.counters ?? tryObj(r, eo ?? "")?.counters ?? {}); }
      for (const id of refs(r, ex.env, { ...step, target: step.on ?? "self" } as Step)) for (const [k, n] of pairs) if (n > 0) addCounters(r, [id], k, n);
      return "done";
    }
  };
  STEPS6.remove_counters = {
    fields: [...plainRemove.fields, "saveAs"],
    run: (r, ex, step, answer) => {
      if (step.counterKind !== "any") { const st = plainRemove.run(r, ex, step, answer); return st; }
      const n = step.amount === undefined ? 1 : evalQuantity(r, step.amount as never, ex.env);
      const saved: string[] = [];
      for (const id of refs(r, ex.env, { ...step, target: step.on ?? "self" } as Step)) {
        const o = tryObj(r, id); if (!o) continue;
        const kinds = Object.entries(o.counters).filter(([, c]) => c > 0);
        const total = kinds.reduce((a, [, c]) => a + c, 0);
        if (n < total && kinds.length > 1) throw new Unsupported("field:remove_counters.choose_kinds", "removing some of several kinds of counters needs a choice (not modelled)");
        let left = Math.min(n, total);
        for (const [k, c] of kinds) { const take = Math.min(left, c); if (take > 0) { addCounters(r, [id], k, -take); saved.push(`${k}:${take}`); left -= take; } }
      }
      if (typeof step.saveAs === "string") ex.env.chosen[step.saveAs] = saved;
      return "done";
    }
  };
}

// ---------------------------------------------------------------- emblems

/** An emblem is a token object in its owner's command zone whose abilities work from there (statics, replacements and triggers). */
STEPS6.create_emblem = {
  fields: ["who", "emblem"],
  run: (r, ex, step) => {
    const emblem = step.emblem as { abilities: Ability[] } | undefined;
    if (!emblem?.abilities?.length) throw new Unsupported("field:create_emblem.emblem");
    for (const pid of players(r, ex.env, step)) {
      const def = { name: "Emblem", types: ["emblem"], subtypes: [], colors: [], keywords: [], abilities: emblem.abilities.map((a) => ({ ...structuredClone(a), id: `emblem:${a.id}`, zone: "command" as const })) };
      const o = newObject(r, "Emblem", pid, "command", { token: def });
      o.controller = pid;
      player(r, pid).command.push(o.id);
      invalidateIndex(r);
      emit(r, { type: "emblem_created", id: o.id, player: pid });
    }
    return "done";
  }
};

// reveal with a `filter`: "reveal a Plains or Swamp card from your hand" (the Snarl lands)
export function wrapRevealStep(base: Record<string, StepSpec>): void {
  const plain = base.reveal;
  STEPS6.reveal = {
    fields: [...plain.fields, "filter"],
    run: (r, ex, step, answer) => (step.filter ? { push: [{ kind: "__reveal_pick" as never, filter: step.filter, prompt: step.prompt } as Step] } : plain.run(r, ex, step, answer))
  };
}
