// Kernel step 7 step kinds and field extensions (long tail). Registered by steps.ts after the step 6 registry. Same contract as every
// step: never mutate before asking. Wrapped steps keep their base behaviour for the fields they already handled.

import type { ObjectFilter, Prompt, Step } from "../schema";
import { untapObject, chars, emit, label, moveObject, player, tick, tryObj, Unsupported, type Run } from "./core";
import { addDurable } from "./durable";
import { addLink } from "./links";
import { evalQuantity, objectsMatching, resolveObjs, resolvePlayers } from "./query";
import { addRegenShield } from "./regen";
import { defenderOptions } from "./combat";
import { playerHas } from "./layers";
import { lookedLive, saveList, setResult } from "./saved";
import { targetHooks } from "./core";
import { isObjId } from "./types";
import { shuffleInPlace } from "./core";
import { recordMilled, revealUntilRun } from "./reveal7";
import { checkCounterAnswer, counterSpec } from "./counters7";
import { addCounters, changeLife, dealDamage, decide, destroyObject, discardCard, fallbackPromptOf, noteDone, players, refs, sacrificeObject, type AskSpec, type Handler, type StepResult, type StepSpec } from "./steps";
import type { Env, ObjId } from "./types";

import { addTemporaryPT as addPump } from "./steps";
const qty = (r: Run, env: Env, step: Step, key = "amount", dflt = 1): number => (step[key] === undefined ? dflt : evalQuantity(r, step[key] as never, env));
const cardOptions = (r: Run, ids: ObjId[]) => ids.map((id) => ({ id, label: label(r, id) }));

export const STEPS7: Record<string, StepSpec> = {};
export const INTERNAL7: Record<string, Handler> = {
  /** a copy on the stack: its controller may choose new targets, slot by slot (copy.chooseNewTargets) */
  __retarget: (r, ex, step, answer) => {
    const item = r.s.stack.find((i) => i.id === step.itemId);
    if (!item) return "done";
    let pi = Number(step.pi), si = Number(step.si);
    for (; pi < item.parts.length; pi++, si = 0) {
      const part = item.parts[pi];
      for (; si < part.specs.length; si++) {
        const spec = part.specs[si], cur = part.targets[spec.id] ?? [];
        if (!cur.length) continue;
        const q = { controller: item.controller, source: item.sourceId, x: item.x };
        const cands = [...new Set([...(targetHooks.candidates?.(r, spec, q, item.objectId) ?? []), ...cur.filter((t) => !isObjId(t) || tryObj(r, t))])];
        const d = decide({ kind: "choose_targets", player: item.controller, prompt: fallbackPromptOf(r, ex.env, "new targets", `Choose the target${cur.length === 1 ? "" : "s"} of the copy (choosing the same ones keeps them).`), options: cands.map((id) => ({ id, label: isObjId(id) ? label(r, id) : `player ${id}` })), min: cur.length, max: cur.length }, answer);
        if ("ask" in d) return d;
        part.targets[spec.id] = d.ids;
        return { push: [{ kind: "__retarget" as never, itemId: step.itemId, pi, si: si + 1 } as unknown as Step] };
      }
    }
    return "done";
  },
  /** the controller picks ONE of explicit objects and it is saved under `saveAs` */
  __choose_ids: (r, ex, step, answer) => {
    const ids = (step.ids as ObjId[]).filter((id) => tryObj(r, id)?.zone === "battlefield");
    if (ids.length <= 1) { saveList(r, ex.env, String(step.saveAs), ids); return "done"; }
    const d = decide({ kind: "choose_cards", player: ex.env.controller, prompt: fallbackPromptOf(r, ex.env, "choose one", "Choose one of them."), options: cardOptions(r, ids), min: 1, max: 1 }, answer);
    if ("ask" in d) return d;
    saveList(r, ex.env, String(step.saveAs), d.ids);
    return "done";
  },
  __spirit_note: (r, ex) => { const live = (ex.env.chosen.chosen ?? []).filter((id) => tryObj(r, id)?.zone === "battlefield"); ex.env.chosen.__sd = [...new Set([...(ex.env.chosen.__sd ?? []), ...live])]; return "done"; },
  __spirit_win: (r, ex) => {
    const n = (ex.env.chosen.__sd ?? []).length;
    if (n >= 5 && !playerHas(r, ex.env.controller, "can't win the game") && !r.s.gameOver) { r.s.gameOver = { winner: ex.env.controller, reason: `${label(r, ex.env.source)}: you put +1/+1 counters on five Dragons and win the game` }; emit(r, { type: "game_over", ...r.s.gameOver }); }
    return "done";
  },
  /** Braids, Arisen Nightmare: this player MAY sacrifice a permanent that shares a card type with what was sacrificed; the answer is theirs alone (decision addressed to them) */
  __sacrifice_shares: (r, ex, step, answer) => {
    const pid = String(step.player), env = ex.env, types = env.sacrificedTypes ?? [];
    const mine = r.s.battlefield.filter((id) => r.s.objects[id].controller === pid && chars(r, id).types.some((t) => types.includes(t)));
    if (!mine.length) return "done";
    const d = decide({ kind: "choose_cards", player: pid, prompt: (step.prompt as Prompt | undefined) ?? fallbackPromptOf(r, env, "sacrifice", `You may sacrifice a permanent that shares a card type with ${types.join(" / ")}. Choose one, or none.`), options: cardOptions(r, mine), min: 0, max: 1 }, answer);
    if ("ask" in d) return d;
    if (d.ids.length) { for (const id of d.ids) sacrificeObject(r, id); noteDone(env, step, pid); }
    return "done";
  },
  /** "as many times as you choose, ..." (Lim-Dul's Vault): ask whether to do the nested steps once more; each answer "yes" runs them and asks again */
  __repeat_ask: (r, ex, step, answer) => {
    // a round that starts with paying life cannot be started without the life (CR 119.4); a guard bounds the rounds (the player could otherwise loop forever on an empty library)
    const first = (step.inner as Step[])[0];
    const cost = first?.kind === "life_change" && typeof first.lifeDelta === "number" && first.lifeDelta < 0 ? -first.lifeDelta : 0;
    const rounds = Number(step.rounds ?? 0);
    if (rounds >= 100 || (cost && player(r, ex.env.controller).life < cost)) return "done";
    const prompt = (step.prompt as Prompt | undefined) ?? fallbackPromptOf(r, ex.env, "repeat", "Do this (again)?");
    const d = decide({ kind: "choose_yes_no", player: ex.env.controller, prompt, options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }], min: 1, max: 1 }, answer);
    if ("ask" in d) return d;
    return d.yes ? { push: [...(step.inner as Step[]), { ...step, rounds: rounds + 1 } as Step] } : "done";
  },
  /** "put any number of target creature cards with total mana value X or less ... onto the battlefield" (Ancient Brass Dragon): picked one at a time, only cards that still fit the budget are offered */
  __reanimate_pick: (r, ex, step, answer) => {
    const env = ex.env, base = step.base as Step, picked = step.picked as ObjId[];
    const budget = evalQuantity(r, base.amount as never, env);
    const used = picked.reduce((n, id) => n + chars(r, id).mv, 0);
    const tspec = typeof base.target === "string" ? env.item.parts.flatMap((pp) => pp.specs).find((sp) => sp.id === base.target) : undefined;
    const f = ((base.filter ?? tspec?.filter ?? {}) as ObjectFilter);
    const cands = objectsMatching(r, { ...f, zone: f.zone ?? "graveyard", owner: undefined }, env).filter((id) => !picked.includes(id) && used + chars(r, id).mv <= budget);
    const finish = (): StepResult => {
      const ctl = resolvePlayers(r, base.who ?? "you", env)[0];
      for (const t of picked) { const o = tryObj(r, t); if (o && o.zone === "graveyard") { moveObject(r, t, "battlefield", { controller: ctl }); emit(r, { type: "reanimated", id: t }); (env.created ??= []).push(t); } }
      return "done";
    };
    if (!cands.length) return finish();
    const d = decide({ kind: "choose_cards", player: env.controller, prompt: fallbackPromptOf(r, env, "reanimate", `Choose a creature card (total mana value ${budget} or less; ${budget - used} left), or none to stop.`), options: cardOptions(r, cands), min: 0, max: 1 }, answer);
    if ("ask" in d) return d;
    if (!d.ids.length) return finish();
    return { push: [{ kind: "__reanimate_pick", base, picked: [...picked, d.ids[0]] } as unknown as Step] };
  },
};

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
  extend(base, "reanimate", ["differentManaValues", "all", "filter", "amount"], (r, ex, step) => {
    if (step.amount !== undefined && !step.all) return { push: [{ kind: "__reanimate_pick", base: step, picked: [] } as unknown as Step] };
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
  // "becomes a copy of <card> until end of turn" (Scion of the Ur-Dragon): a layer-1 copy effect, the copy machinery of copy.ts (copiable values, same object)
  extend(base, "grant_effect", ["appliesTo"], (r, ex, step) => {
    const ms = (step.modify ?? []) as Array<Record<string, unknown>>;
    const c = ms.find((m) => "copyOf" in m);
    if (!c) return undefined;
    if (ms.length !== 1 || !(step.target === "self" || typeof step.target === "string") || !(step.duration === undefined || step.duration === "until_end_of_turn")) throw new Unsupported("field:grant_effect.modify.copyOf");
    // "put it into your graveyard ... becomes a copy of THAT card": the card is followed into its new zone (the saved list is re-stamped)
    let of = c.copyOf;
    if (typeof of === "string" && ex.env.chosen[of]) { saveList(r, ex.env, "__copy_src", ex.env.chosen[of].filter((id) => isObjId(id) && !!tryObj(r, id))); of = "__copy_src"; }
    return base.copy.run(r, ex, { kind: "copy", of, target: step.target, duration: step.duration } as Step, undefined);
  });
  extend(base, "sacrifice_permanent", ["sharesCardTypeWith"], (r, ex, step) => {
    if (step.sharesCardTypeWith === undefined) return undefined;
    if (step.sharesCardTypeWith !== "sacrificed") throw new Unsupported("field:sacrifice_permanent.sharesCardTypeWith");
    return { push: players(r, ex.env, step).map((p) => ({ kind: "__sacrifice_shares" as never, player: p, stepId: step.id, prompt: step.prompt }) as Step) };
  });
  // life loss only for the players of the group who did NOT do an earlier per-player step (Braids: "for each opponent who doesn't, that player loses 2 life")
  extend(base, "life_change", ["onlyForPlayersWhoDidNot"], (r, ex, step) => {
    if (step.onlyForPlayersWhoDidNot === undefined) return undefined;
    const done = ex.env.doneBy?.[String(step.onlyForPlayersWhoDidNot)] ?? [];
    const raw = step.lifeDelta !== undefined ? evalQuantity(r, step.lifeDelta as never, ex.env) : qty(r, ex.env, step, "amount", 0);
    const delta = step.lose ? -Math.abs(raw) : raw;
    let lost = 0;
    for (const p of players(r, ex.env, step).filter((x) => !done.includes(x))) { const before = player(r, p).life; changeLife(r, ex.env, p, delta); if (delta < 0) lost += Math.max(0, before - player(r, p).life); }
    if (delta < 0) ex.env.lastLifeLost = lost;
    return "done";
  });
  extend(base, "repeat_for_each", ["repeatCount"], (_r, _ex, step) => {
    if (step.repeatCount === undefined) return undefined;
    if (step.repeatCount !== "as_many_as_you_choose") throw new Unsupported("field:repeat_for_each.repeatCount");
    return { push: [{ kind: "__repeat_ask" as never, inner: step.steps ?? [], prompt: step.prompt } as Step] };
  });
  // shuffle everything except the cards just looked at (Lim-Dul's Vault: they are put on top afterwards)
  extend(base, "shuffle", ["exceptLooked"], (r, ex, step) => {
    if (!step.exceptLooked) return undefined;
    for (const p of resolvePlayers(r, step.who ?? "you", ex.env)) {
      const lib = player(r, p).library, held = lookedLive(r, ex.env).filter((id) => lib.includes(id));
      const rest = lib.filter((id) => !held.includes(id));
      shuffleInPlace(r, rest); lib.splice(0, lib.length, ...held, ...rest);
      emit(r, { type: "shuffle", player: p });
    }
    return "done";
  });
  // Aminatou, the Fateshifter: every player gains control of the nonland permanents (other than the source) controlled by the next player in the chosen direction
  extend(base, "gain_control", ["rotate", "excludeSelf"], (r, ex, step) => {
    if (step.rotate === undefined) return undefined;
    if (step.rotate !== "next_player_in_chosen_direction") throw new Unsupported("field:gain_control.rotate");
    const env = ex.env;
    const dir = tryObj(r, env.source)?.chosen?.mode;
    if (dir !== "left" && dir !== "right") throw new Unsupported("field:gain_control.rotate", "no direction was chosen");
    const seats = r.s.players.filter((p) => !p.hasLost).map((p) => p.id);
    // the next player to the left is the next in turn order; a permanent controlled by Q goes to the player whose next player (in that direction) is Q
    const dest = (q: string): string => { const i = seats.indexOf(q); return seats[(i + (dir === "left" ? -1 : 1) + seats.length) % seats.length]; };
    const moves = objectsMatching(r, (step.filter ?? {}) as ObjectFilter, env).filter((id) => !(step.excludeSelf && id === env.source)).map((id) => ({ id, to: dest(tryObj(r, id)!.controller) }));
    for (const m of moves) {
      const o = tryObj(r, m.id);
      if (!o || o.zone !== "battlefield" || o.controller === m.to) continue;
      const was = o.controller;
      o.controller = m.to; o.controlledSince = tick(r);
      emit(r, { type: "control_changed", id: m.id, from: was, to: m.to });
    }
    return "done";
  });
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

  // manifest dread: look at the top two cards, put one onto the battlefield face down as a 2/2 creature, the other into the graveyard (701.62)
  STEPS7.manifest_dread = { fields: ["who"], run: (r, ex, step) => ({ push: players(r, ex.env, step).map((p) => ({ kind: "__manifest_dread" as never, player: p, prompt: step.prompt }) as Step) }) };
  INTERNAL7.__manifest_dread = (r, ex, step, answer) => {
    const pid = String(step.player);
    const top = player(r, pid).library.slice(0, 2);
    if (top.length === 0) return "done";
    let pick = top[0];
    if (top.length > 1) {
      emit(r, { type: "looked_at", player: pid, owner: pid, ids: [...top], names: top.map((id) => label(r, id)) });
      const spec: AskSpec = { kind: "choose_cards", player: pid, prompt: (step.prompt as Prompt | undefined) ?? fallbackPromptOf(r, ex.env, "manifest", "Choose a card to manifest face down; the other goes to your graveyard."), options: cardOptions(r, top), min: 1, max: 1 };
      const d = decide(spec, answer);
      if ("ask" in d) return d;
      pick = d.ids[0];
    }
    ex.env.created = [];
    for (const id of top) if (id !== pick) moveObject(r, id, "graveyard");
    const m = moveObject(r, pick, "battlefield", { controller: pid, faceDown: true });
    if (m && m.zone === "battlefield") ex.env.created.push(m.id);
    return "done";
  };
  // "reselect which player or permanent target attacking creature is attacking" (Misleading Signpost): the controller picks any legal defender for that attacker
  STEPS7.reselect_attack_target = { fields: ["target"], run: (r, ex, step) => {
    const at = refs(r, ex.env, step).map((id) => r.s.combat?.attackers.find((a) => a.id === id)).find((a) => !!a);
    if (!at) return "done";
    const atk = tryObj(r, at.id);
    if (!atk) return "done";
    const opts = defenderOptions(r, atk.controller);
    if (opts.length < 2) return "done";
    return { push: [{ kind: "__reselect_attack" as never, attacker: at.id, opts, prompt: step.prompt } as Step] };
  } };
  INTERNAL7.__reselect_attack = (r, ex, step, answer) => {
    const at = r.s.combat?.attackers.find((a) => a.id === step.attacker);
    if (!at) return "done";
    const opts = step.opts as string[];
    const spec: AskSpec = { kind: "choose_option", player: ex.env.controller, prompt: (step.prompt as Prompt | undefined) ?? fallbackPromptOf(r, ex.env, "reselect", `Choose which player or permanent ${label(r, at.id)} is attacking.`), options: opts.map((o) => ({ id: o, label: label(r, o) })), min: 1, max: 1 };
    const d = decide(spec, answer);
    if ("ask" in d) return d;
    at.defender = d.ids[0];
    emit(r, { type: "attack_target_changed", id: at.id, defender: at.defender });
    return "done";
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
    for (const id of ids) { const o = tryObj(r, id); if (o && o.tapped) untapObject(r, o); }
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
