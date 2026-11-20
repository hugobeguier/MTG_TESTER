// Read-only evaluation of the schema's closed vocabularies against a game state: object filters, quantities,
// predicates, player/object references. Unknown vocabulary throws Unsupported (never silently false/true).

import type { Cmp, ObjectFilter, Predicate, Quantity, PlayerRef, Zone } from "../schema";
import { alive, apnap, chars, isSummoningSick, obj, opponentsOf, player, tryObj, Unsupported, type Run } from "./core";
import type { CastInfo, LogEntry, ObjId, PlayerId } from "./types";
import { isObjId } from "./types";

/** What references resolve against. `Env` (interpreter) and trigger/timing contexts are all structurally compatible. */
export interface QCtx {
  controller: PlayerId;
  source?: ObjId;
  x?: number;
  targets?: Record<string, string[]>;
  chosen?: Record<string, string[]>;
  done?: string[];
  created?: string[];
  iterated?: string;
  eventObj?: string;
  eventPlayer?: PlayerId;
  amount?: number;
  lastLifeLost?: number;
  item?: { cast?: CastInfo };
  cast?: CastInfo;
  /** the player being tested by players_count */
  thatPlayer?: PlayerId;
}

export const SUPPORTED_FILTER_KEYS: ReadonlySet<string> = new Set([
  "types", "notTypes", "subtypes", "supertypes", "notSupertypes", "colors", "notColors", "controller", "owner", "zone", "colored",
  "another", "token", "tapped", "hasCounter", "mv", "power", "toughness", "named", "with", "anyOf", "notSubtypes", "without", "isCommander"
]);

export function cmp(a: number, c: Cmp, r: Run, q: QCtx): boolean {
  const b = evalQuantity(r, c.value, q);
  switch (c.op) { case "<": return a < b; case "<=": return a <= b; case "=": return a === b; case ">=": return a >= b; case ">": return a > b; }
}

export function matchesFilter(r: Run, id: string, f: ObjectFilter, q: QCtx): boolean {
  for (const k of Object.keys(f)) if (!SUPPORTED_FILTER_KEYS.has(k)) throw new Unsupported(`filter:${k}`);
  if (f.anyOf && !f.anyOf.some((sub) => matchesFilter(r, id, sub, q))) return false;
  const o = tryObj(r, id);
  if (!o) return false;
  const c = chars(r, id);
  const lcAll = (a: string[]) => a.map((x) => x.toLowerCase());
  if (f.zone && f.zone !== "any" && o.zone !== f.zone) return false;
  if (f.types) {
    for (const t of lcAll(f.types)) {
      if (t === "spell") { if (o.zone !== "stack") return false; }
      else if (t === "permanent") { if (o.zone !== "battlefield") return false; }
      else if (t === "card") { /* any card */ }
      else if (!c.types.includes(t)) return false;
    }
  }
  if (f.notTypes && lcAll(f.notTypes).some((t) => c.types.includes(t))) return false;
  if (f.subtypes && !lcAll(f.subtypes).every((t) => lcAll(c.subtypes).includes(t))) return false;
  if (f.notSubtypes && lcAll(f.notSubtypes).some((t) => lcAll(c.subtypes).includes(t))) return false;
  if (f.supertypes && !lcAll(f.supertypes).every((t) => c.supertypes.includes(t))) return false;
  if (f.notSupertypes && lcAll(f.notSupertypes).some((t) => c.supertypes.includes(t))) return false;
  const colorName: Record<string, string> = { W: "white", U: "blue", B: "black", R: "red", G: "green" };
  const hasColor = (x: string) => c.colors.some((k) => k === x || colorName[k] === x.toLowerCase() || k.toLowerCase() === x.toLowerCase());
  if (f.colors && !f.colors.every(hasColor)) return false;
  if (f.notColors && f.notColors.some(hasColor)) return false;
  if (f.colored !== undefined && (c.colors.length > 0) !== f.colored) return false;
  if (f.controller === "you" && o.controller !== q.controller) return false;
  if (f.controller === "opponent" && o.controller === q.controller) return false;
  if (f.owner === "you" && o.owner !== q.controller) return false;
  if (f.owner === "opponent" && o.owner === q.controller) return false;
  if (f.another && id === q.source) return false;
  if (f.token !== undefined && !!o.token !== f.token) return false;
  if (f.tapped !== undefined && o.tapped !== f.tapped) return false;
  if (f.hasCounter && !(o.counters[f.hasCounter] > 0)) return false;
  if (f.isCommander !== undefined && !!o.isCommander !== f.isCommander) return false;
  if (f.named && c.name.toLowerCase() !== f.named.toLowerCase()) return false;
  if (f.mv && !cmp(c.mv, f.mv, r, q)) return false;
  if (f.power && (c.power === undefined || !cmp(c.power, f.power, r, q))) return false;
  if (f.toughness && (c.toughness === undefined || !cmp(c.toughness, f.toughness, r, q))) return false;
  if (f.with && !lcAll(f.with).every((k) => c.keywords.includes(k))) return false;
  if (f.without && lcAll(f.without).some((k) => c.keywords.includes(k))) return false;
  return true;
}

/** Ids of objects in `zone` (battlefield by default) matching the filter. Library/hand/etc. span every player unless owner is set. */
export function objectsMatching(r: Run, f: ObjectFilter, q: QCtx, zoneDefault: Zone = "battlefield"): ObjId[] {
  const zone = f.zone && f.zone !== "any" ? f.zone : zoneDefault;
  let pool: ObjId[];
  if (f.zone === "any") pool = Object.keys(r.s.objects);
  else if (zone === "battlefield") pool = r.s.battlefield;
  else if (zone === "stack") pool = r.s.stack.map((i) => i.objectId).filter((x): x is string => !!x);
  else pool = r.s.players.flatMap((p) => p[zone as "hand" | "library" | "graveyard" | "exile" | "command"]);
  return pool.filter((id) => matchesFilter(r, id, { ...f, zone: f.zone === "any" ? undefined : zone }, q));
}

// ---------------------------------------------------------------- references

export function resolvePlayers(r: Run, ref: PlayerRef | undefined, q: QCtx): PlayerId[] {
  switch (ref ?? "you") {
    case "you": return [q.controller];
    case "each_player": return apnap(r).map((p) => p.id);
    case "each_opponent": return apnap(r).filter((p) => p.id !== q.controller).map((p) => p.id);
    case "opponent": {
      const o = opponentsOf(r, q.controller);
      if (o.length !== 1) throw new Unsupported("player_ref:opponent_multiplayer", '"opponent" is ambiguous with more than one opponent');
      return [o[0].id];
    }
    case "target_player": {
      const ids = Object.values(q.targets ?? {}).flat().filter((t) => !isObjId(t));
      if (!ids.length) throw new Unsupported("player_ref:target_player_missing", "no player target chosen");
      return [ids[0]];
    }
    case "controller_of_target":
    case "owner_of_target": {
      const t = Object.values(q.targets ?? {}).flat().find((x) => isObjId(x));
      if (!t) throw new Unsupported("player_ref:target_missing");
      const lk = r.s.lki[t];
      if (lk) return [ref === "controller_of_target" ? lk.controller : lk.owner];
      const o = tryObj(r, t);
      if (!o) return []; // target gone
      return [ref === "controller_of_target" ? o.controller : o.owner];
    }
    case "that_player":
      if (q.thatPlayer) return [q.thatPlayer];
      if (q.eventPlayer) return [q.eventPlayer];
      throw new Unsupported("player_ref:that_player_missing");
  }
}

export function resolveObjs(r: Run, ref: string | undefined, q: QCtx): string[] {
  if (!ref) return [];
  if (/^t\d+$/.test(ref)) return q.targets?.[ref] ?? [];
  switch (ref) {
    case "self": return q.source ? [q.source] : [];
    case "chosen": return Object.values(q.chosen ?? {}).flat();
    case "event_object": return q.eventObj ? [q.eventObj] : [];
    case "created": return q.created ?? [];
    case "iterated": return q.iterated ? [q.iterated] : [];
    default: throw new Unsupported(`ref:${ref}`);
  }
}

// ---------------------------------------------------------------- quantities

export function evalQuantity(r: Run, qy: Quantity, q: QCtx): number {
  if (typeof qy === "number") return qy;
  if ("math" in qy) {
    const a = qy.args.map((x) => evalQuantity(r, x, q));
    switch (qy.math) {
      case "+": return a.reduce((x, y) => x + y, 0);
      case "-": return a.slice(1).reduce((x, y) => x - y, a[0] ?? 0);
      case "*": return a.reduce((x, y) => x * y, 1);
      case "min": return Math.min(...a);
      case "max": return Math.max(...a);
      case "div_down": return Math.floor(a[0] / a[1]);
      case "div_up": return Math.ceil(a[0] / a[1]);
    }
  }
  switch (qy.ref) {
    case "X": return q.x ?? 0;
    case "count": return objectsMatching(r, qy.of, q).length;
    case "stat": {
      const ids = resolveObjs(r, qy.of, q);
      if (!ids.length) return 0;
      const lk = r.s.lki[ids[0]];
      if (lk && tryObj(r, ids[0])?.zone !== "battlefield") return qy.stat === "power" ? lk.power ?? 0 : qy.stat === "toughness" ? lk.toughness ?? 0 : lk.mv;
      if (!tryObj(r, ids[0])) return 0;
      const c = chars(r, ids[0]);
      return qy.stat === "power" ? c.power ?? 0 : qy.stat === "toughness" ? c.toughness ?? 0 : c.mv;
    }
    case "counters": {
      if (["you", "opponent", "each_opponent", "each_player", "target_player", "controller_of_target", "owner_of_target", "that_player"].includes(qy.on as string)) throw new Unsupported("quantity:player_counters");
      const ids = resolveObjs(r, qy.on, q);
      const o = ids[0] ? tryObj(r, ids[0]) : undefined;
      if (!o) return 0;
      return qy.kind === "any" ? Object.values(o.counters).reduce((a, b) => a + b, 0) : o.counters[qy.kind] ?? 0;
    }
    case "life_lost_this_way": return q.lastLifeLost ?? 0;
    case "event_amount": return q.amount ?? 0;
    case "life_total": return player(r, resolvePlayers(r, qy.who, q)[0]).life;
    case "starting_life": return 40;
    case "count_this_turn": return countLog(r, qy.event, q, qy.filter, qy.actor).length;
    case "greatest":
    case "sum": {
      const vals = objectsMatching(r, qy.of, q).map((id) => { const c = chars(r, id); return qy.stat === "power" ? c.power ?? 0 : qy.stat === "toughness" ? c.toughness ?? 0 : qy.stat === "mana_value" ? c.mv : (() => { throw new Unsupported(`quantity:${qy.ref}.${qy.stat}`); })(); });
      return qy.ref === "sum" ? vals.reduce((a, b) => a + b, 0) : Math.max(0, ...vals);
    }
    default: throw new Unsupported(`quantity:${(qy as { ref: string }).ref}`);
  }
}

// ---------------------------------------------------------------- turn log

const EVENT_TO_LOG: Record<string, string> = { gain_life: "gain_life", lose_life: "lose_life", token_created: "token_created", cast: "cast", etb: "etb", dies: "dies", draw: "draw", discard: "discard", sacrifice: "sacrifice", mill: "mill" };

export function countLog(r: Run, event: string, q: QCtx, filter?: ObjectFilter, actor?: PlayerRef): LogEntry[] {
  const type = EVENT_TO_LOG[event];
  if (!type) throw new Unsupported(`event:${event}`, `the engine does not log "${event}" events`);
  const actors = actor ? resolvePlayers(r, actor, q) : undefined;
  return r.s.turnLog.filter((e) => {
    if (e.type !== type) return false;
    if (actors && (!e.player || !actors.includes(e.player))) return false;
    if (filter) {
      const f = filter;
      if (f.types && !f.types.every((t) => (e.types ?? []).includes(t.toLowerCase()))) return false;
      if (f.notTypes && f.notTypes.some((t) => (e.types ?? []).includes(t.toLowerCase()))) return false;
      if (f.token !== undefined && !!e.token !== f.token) return false;
      const extra = Object.keys(f).filter((k) => !["types", "notTypes", "token"].includes(k));
      if (extra.length) throw new Unsupported(`filter:${extra[0]}@turn_log`);
    }
    return true;
  });
}

// ---------------------------------------------------------------- predicates

const MAIN_PHASES = ["precombat_main", "postcombat_main"];

export function evalPredicate(r: Run, p: Predicate, q: QCtx): boolean {
  if ("all" in p) return p.all.every((x) => evalPredicate(r, x, q));
  if ("any" in p) return p.any.some((x) => evalPredicate(r, x, q));
  if ("not" in p) return !evalPredicate(r, p.not, q);
  if ("unsupported" in p) throw new Unsupported("predicate:unsupported", `unsupported predicate: ${p.unsupported}`);
  const cast = q.cast ?? q.item?.cast;
  switch (p.check) {
    case "cast_during": {
      if (!cast) throw new Unsupported("predicate:cast_during", "cast_during evaluated on something that was not cast");
      // "your main phase": a main phase of the caster's own turn (every Addendum card reads this way)
      const own = cast.activePlayer === cast.caster;
      switch (p.phase) {
        case "main": return MAIN_PHASES.includes(cast.phase) && own;
        case "combat": return ["beginning_of_combat", "combat", "declare_attackers", "declare_blockers", "combat_damage", "end_of_combat"].includes(cast.phase);
        case "your_turn": return own;
        case "opponent_turn": return !own;
        case "end_step": return cast.phase === "end_step";
      }
      return false;
    }
    case "cast_from": if (!cast) throw new Unsupported("predicate:cast_from"); return cast.from === p.zone;
    case "turn_is": return (r.s.turn.active === q.controller) === (p.whose === "yours");
    case "phase_is": return p.phase === "main" as string ? MAIN_PHASES.includes(r.s.turn.phase) : r.s.turn.phase === p.phase;
    case "controls": {
      const n = objectsMatching(r, { ...p.filter, controller: p.filter.controller ?? "you" }, q).length;
      return p.count ? cmp(n, p.count, r, q) : n >= 1;
    }
    case "life": { const ps = resolvePlayers(r, p.who, q); return ps.length > 0 && ps.every((id) => cmp(player(r, id).life, p.cmp, r, q)); }
    case "zone_count": {
      const z = p.zone;
      let n = 0;
      for (const id of resolvePlayers(r, p.who, q)) n += z === "battlefield" ? objectsMatching(r, { ...p.filter, controller: id === q.controller ? "you" : "opponent" }, q).length : (player(r, id)[z as "hand"] as ObjId[]).filter((o) => !p.filter || matchesFilter(r, o, p.filter, q)).length;
      return cmp(n, p.cmp, r, q);
    }
    case "did_this_turn": { const n = countLog(r, p.event, q, undefined, p.actor).length; return p.cmp ? cmp(n, p.cmp, r, q) : n >= 1; }
    case "nth_this_turn": return countLog(r, p.event, q, p.filter, p.actor).length === p.n;
    case "compare": return cmp(evalQuantity(r, p.left, q), p.cmp, r, q);
    case "stat": {
      const ids = resolveObjs(r, p.of, q);
      if (!ids[0] || !tryObj(r, ids[0])) return false;
      if (p.stat === "power" || p.stat === "toughness" || p.stat === "mana_value") return cmp(evalQuantity(r, { ref: "stat", of: p.of, stat: p.stat }, q), p.cmp, r, q);
      throw new Unsupported(`predicate:stat.${p.stat}`);
    }
    case "matches": { const ids = resolveObjs(r, p.obj, q); return ids.length > 0 && ids.every((id) => matchesFilter(r, id, p.filter, q)); }
    case "source_state": {
      const o = q.source ? tryObj(r, q.source) : undefined;
      if (p.state === "on_battlefield") return !!o && o.zone === "battlefield";
      if (p.state === "tapped") return !!o && o.tapped;
      throw new Unsupported(`predicate:source_state.${p.state}`);
    }
    case "turn_number": throw new Unsupported("predicate:turn_number");
    case "step_done": return (q.done ?? []).includes(p.step);
    case "most_life": { const ps = resolvePlayers(r, p.who, q); const max = Math.max(...alive(r).map((x) => x.life)); return ps.every((id) => player(r, id).life === max); }
    default: throw new Unsupported(`predicate:${(p as { check: string }).check}`);
  }
}

export function isSick(r: Run, id: ObjId): boolean { return isSummoningSick(r, obj(r, id)); }
