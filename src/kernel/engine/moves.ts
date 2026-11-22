// step:move_card_zone, the general "put cards from anywhere to anywhere" step. Sources (first match wins):
//   target       object refs (t1, self, event_object, chosen...), as before
//   what         a saved list ("chosen", "found", ...), "rest_of_looked_cards" / "looked_cards", "top_of_library", "all" (a whole zone),
//                "graveyard_of_tN" (the graveyard of a targeted player) or "choose" (the player picks one matching `filter`)
//   moveFrom|from + who (+ moveCount | all)   the top N cards of those players' library / their whole graveyard, exile...
// Every move goes through moveObject: replacement effects (dies, leaves, enters, would-be-put-into-zone), zone-change events, a
// fresh timestamp (a card that changes zone is a new object). Cards put into a library: `position` top / bottom; `ordered:
// "any_order"` asks the controller for the order, `order: "random"` uses the seeded RNG. Only imported by steps.ts.

import type { ObjectFilter, Step, Zone } from "../schema";
import { emit, label, moveObject, obj, player, shuffleInPlace, tryObj, Unsupported, type Run } from "./core";
import { evalQuantity, matchesFilter, resolveObjs, resolvePlayers } from "./query";
import { liveIds, saveList, setResult } from "./saved";
import { addLink } from "./links";
import { faceNames, defOf } from "./core";
import { decide, type AskSpec, type StepResult, type StepSpec } from "./steps";
import type { Env, ObjId, PlayerId } from "./types";
import { isObjId } from "./types";

export const MOVE_FIELDS = ["target", "moveTo", "moveFrom", "from", "position", "tapped", "what", "who", "filter", "ordered", "order", "all", "moveCount", "saveAs", "shuffle", "withCounters", "underControlOf", "faceDown", "faceUp", "linkExile", "transformed", "excludeLatest", "reflexive"];
/** `what` values the engine understands besides a saved-choice name. */
export const MOVE_WHAT_KINDS = ["choose", "all", "top_of_library", "rest_of_looked_cards", "looked_cards", "rest_of_revealed_cards", "revealed_cards", "chosen", "found"];
export const isMoveWhatSupported = (w: string): boolean => MOVE_WHAT_KINDS.includes(w) || /^graveyard_of_t\d+$/.test(w);

const ZONES = ["hand", "graveyard", "exile", "library", "battlefield", "command"] as const;

function zoneCards(r: Run, pid: PlayerId, zone: Zone): ObjId[] {
  if (zone === "battlefield") return r.s.battlefield.filter((id) => r.s.objects[id].controller === pid);
  if (!(ZONES as readonly string[]).includes(zone)) throw new Unsupported(`field:move_card_zone.from=${zone}`);
  return [...player(r, pid)[zone as "hand" | "graveyard" | "exile" | "library" | "command"]];
}

function targetPlayers(r: Run, env: Env, tid: string): PlayerId[] {
  return (env.targets[tid] ?? []).filter((x) => !isObjId(x));
}

/** The cards a source-form step moves (nothing is moved yet), or an ask for "choose". */
function sourceCards(r: Run, env: Env, step: Step): ObjId[] {
  const what = ((step.what === "rest_of_revealed_cards" ? "rest_of_looked_cards" : step.what === "revealed_cards" ? "looked_cards" : step.what) as string | undefined);
  const from = (step.from ?? step.moveFrom) as Zone | undefined;
  const filter = step.filter as ObjectFilter | undefined;
  const fits = (id: ObjId, owner: PlayerId) => !filter || matchesFilter(r, id, { ...filter, zone: undefined, owner: undefined, controller: undefined }, { ...env, controller: owner });

  if (step.target) { const t = resolveObjs(r, step.target as string, env).filter((id) => !from || tryObj(r, id)?.zone === from); return step.excludeLatest ? t.slice(0, -1) : t; }
  if (what && /^graveyard_of_t\d+$/.test(what)) {
    return targetPlayers(r, env, what.slice("graveyard_of_".length)).flatMap((p) => zoneCards(r, p, "graveyard"));
  }
  if (what === "top_of_library") return resolvePlayers(r, step.who ?? "you", env).flatMap((p) => player(r, p).library.slice(0, 1));
  if (what && what !== "all" && what !== "choose") {
    if (!isMoveWhatSupported(what) && !(what in env.chosen)) throw new Unsupported(`field:move_card_zone.what=${what}`);
    const ids = resolveObjs(r, what, env).filter((id) => fits(id, tryObj(r, id)?.owner ?? env.controller));
    return from ? ids.filter((id) => tryObj(r, id)?.zone === from) : ids;
  }
  // zone form: a zone of some players (+ optional count from the top of a library)
  if (!from) throw new Unsupported("field:move_card_zone.from", "move_card_zone needs a source (target, what, or from + who)");
  const out: ObjId[] = [];
  for (const pid of resolvePlayers(r, step.who ?? "you", env)) {
    let cards = zoneCards(r, pid, from).filter((id) => fits(id, pid));
    const all = what === "all" || step.all === true || step.moveCount === "all";
    if (!all && (from === "library" || step.moveCount !== undefined)) {
      const n = step.moveCount === undefined ? 1 : evalQuantity(r, step.moveCount as never, env);
      if (from !== "library") throw new Unsupported("field:move_card_zone.moveCount", "a count is only supported for a library (top cards)");
      cards = (step.position === "bottom" && step.moveTo !== "library" ? cards.slice(-n) : cards.slice(0, n));
    }
    out.push(...cards);
  }
  return out;
}

export const moveStep: StepSpec = {
  fields: MOVE_FIELDS,
  run: (r, ex, step, answer): StepResult => {
    const env = ex.env;
    const to = step.moveTo as Zone | undefined;
    if (!to || !(ZONES as readonly string[]).includes(to)) throw new Unsupported(`field:move_card_zone.moveTo=${String(to)}`);
    if (step.reflexive && typeof step.target === "string") {
      // "When you do, return target creature card ...": the reflexive trigger chooses its target NOW (after the earlier steps were done), not when the ability was put on the stack
      const spec = env.item.parts.flatMap((p) => p.specs).find((sp) => sp.id === step.target);
      if (spec) return { push: [{ ...step, target: undefined, reflexive: undefined, what: "choose", filter: spec.filter, moveFrom: spec.filter?.zone, who: "you" } as Step] };
    }
    if (step.what === "choose") {
      // "return a creature card from your graveyard": the player picks one matching the filter, then it moves
      const key = "__move_choice";
      return { push: [
        { kind: "choose", from: { ...(step.filter ?? {}), zone: step.filter?.zone ?? step.from ?? step.moveFrom }, count: 1, saveAs: key, who: step.who } as Step,
        { ...step, what: key, filter: undefined, who: step.who } as Step
      ] };
    }
    let ids = liveIds(r, env, sourceCards(r, env, step)).filter((id) => { const o = tryObj(r, id); return !!o && o.zone !== "stack"; });

    // ---- order of cards going to a library
    if (to === "library" && ids.length > 1) {
      if (step.ordered === "any_order" || step.order === "chosen") {
        const spec: AskSpec = {
          kind: "choose_cards", player: env.controller,
          prompt: step.prompt ?? { title: `${label(r, env.source)}: order the cards`, instruction: `Put the cards in order, first = ${step.position === "bottom" ? "closest to the top of that group" : "on top of the library"}.` },
          options: ids.map((id) => ({ id, label: label(r, id) })), min: ids.length, max: ids.length
        };
        const d = decide(spec, answer);
        if ("ask" in d) return d;
        ids = d.ids;
      } else if (step.order === "random") ids = shuffleInPlace(r, [...ids]);
    }

    // ---- who controls what enters the battlefield
    let controller = env.controller;
    if (to === "battlefield") {
      const zoneForm = !step.target && !!(step.what === "all" || step.what === "top_of_library" || step.moveFrom || step.from);
      if (step.underControlOf === "owner") controller = "" as PlayerId;
      else if (!zoneForm && step.who) controller = resolvePlayers(r, step.who, env)[0] ?? env.controller;
    }
    const counters = step.withCounters ? { [(step.withCounters as { kind: string }).kind]: evalQuantity(r, (step.withCounters as { count: never }).count, env) } : undefined;

    // the cards go to the library in order: first listed ends up on top (so top-bound cards are placed last-first)
    const placing = to === "library" && step.position !== "bottom" ? [...ids].reverse() : ids;
    const moved: ObjId[] = [];
    for (const id of placing) {
      const o = tryObj(r, id);
      if (!o || o.zone === "stack") continue;
      const names = step.transformed && !o.token ? faceNames(defOf(r, o)!) : [];
      if (step.transformed && to === "battlefield" && names.length < 2) continue; // only a double-faced card can enter transformed
      moveObject(r, id, to, { position: step.position as "top" | "bottom" | undefined, controller: to === "battlefield" ? (controller || o.owner) : undefined, tapped: !!step.tapped, counters, ...(names.length > 1 && to === "battlefield" ? { face: names[1] } : {}) });
      const after = tryObj(r, id);
      if (after?.zone === to) {
        moved.push(id);
        if (step.faceDown && to === "exile") after.faceDown = true;
        if (step.linkExile && to === "exile") addLink(r, env.source, id);
      }
    }
    if (to === "library" && step.shuffle) for (const p of new Set(ids.map((id) => obj(r, id).owner))) { shuffleInPlace(r, player(r, p).library); emit(r, { type: "shuffle", player: p }); }
    const order = to === "library" && step.position !== "bottom" ? [...moved].reverse() : moved;
    if (step.saveAs) saveList(r, env, String(step.saveAs), order);
    if (step.id && !step.saveAs) setResult(env, step.id, moved.length);
    return "done";
  }
};

