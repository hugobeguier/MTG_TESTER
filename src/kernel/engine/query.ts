// Read-only evaluation of the schema's closed vocabularies against a game state: object filters, quantities,
// predicates, player/object references. Unknown vocabulary throws Unsupported (never silently false/true).

import type { Cmp, ObjectFilter, Predicate, Quantity, PlayerRef, Zone } from "../schema";
import { linkedObjs } from "./links";
import { alive, apnap, attackerEntry, chars, defenderPlayer, isAttacking, isBlocking, isSummoningSick, manaCostOf, obj, opponentsOf, player, tryObj, Unsupported, type Run } from "./core";
import { hostOf } from "./layers";
import { lookedLive, resultOf, savedObjs } from "./saved";
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
  /** saved-choice bookkeeping (saved.ts) */
  savedTs?: Record<string, number>;
  lastChosen?: string;
  looked?: string[];
  sacrificed?: string[];
}

export const SUPPORTED_FILTER_KEYS: ReadonlySet<string> = new Set([
  "types", "notTypes", "subtypes", "supertypes", "notSupertypes", "colors", "notColors", "controller", "owner", "zone", "colored",
  "another", "token", "tapped", "hasCounter", "mv", "power", "toughness", "named", "with", "anyOf", "notSubtypes", "without", "isCommander",
  "attacking", "blocking", "attackingYou", "attackingOpponent", "chosenType", "hasBasicLandType", "enteredThisTurn", "chosenColor", "sameNameAs", "sharesCreatureTypeWith", "sameName"
]);

export function cmp(a: number, c: Cmp, r: Run, q: QCtx): boolean {
  const b = evalQuantity(r, c.value, q);
  switch (c.op) { case "<": return a < b; case "<=": return a <= b; case "=": return a === b; case ">=": return a >= b; case ">": return a > b; }
}

const countersLeft = (c: Record<string, number> | undefined, kind: string): number => (kind === "any" ? Object.values(c ?? {}).reduce((a, b) => a + b, 0) : (c ?? {})[kind] ?? 0);

export function matchesFilter(r: Run, id: string, f: ObjectFilter, q: QCtx): boolean {
  for (const k of Object.keys(f)) if (!SUPPORTED_FILTER_KEYS.has(k)) throw new Unsupported(`filter:${k}`);
  if (f.anyOf && !f.anyOf.some((sub) => matchesFilter(r, id, sub, q))) return false;
  const o = tryObj(r, id);
  // last-known information: a permanent that left the battlefield (a token no longer exists) is judged on what it had ("if it had counters on it")
  if ((!o || o.zone !== "battlefield") && r.s.lki[id] && Object.keys(f).length === 1 && f.hasCounter) return countersLeft(r.s.lki[id].counters, f.hasCounter) > 0;
  if (!o) return false;
  const c = chars(r, id);
  const lcAll = (a: string[]) => a.map((x) => x.toLowerCase());
  if (f.zone && f.zone !== "any" && o.zone !== f.zone) return false;
  if (f.types) {
    for (const t of lcAll(f.types)) {
      if (t === "spell") { if (o.zone !== "stack") return false; }
      else if (t === "permanent") { if (o.zone !== "battlefield" && !(f.zone && f.zone !== "battlefield" && ["artifact", "creature", "enchantment", "land", "planeswalker", "battle"].some((x) => c.types.includes(x)))) return false; }
      else if (t === "card") { /* any card */ }
      else if (!c.types.includes(t)) return false;
    }
  }
  if (f.notTypes && lcAll(f.notTypes).some((t) => c.types.includes(t))) return false;
  // changeling: every creature type
  const changeling = c.keywords.includes("changeling") && c.types.includes("creature");
  const isCreatureType = (t: string) => (r.db ? r.db.creatureTypes().some((x) => x.toLowerCase() === t) : !["aura", "equipment", "vehicle", "saga", "food", "clue", "treasure", "forest", "island", "plains", "swamp", "mountain"].includes(t));
  if (f.subtypes && !lcAll(f.subtypes).every((t) => lcAll(c.subtypes).includes(t) || (changeling && isCreatureType(t)))) return false;
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
  if (f.hasCounter && !((f.hasCounter === "any" ? Object.values(o.counters).reduce((a, b) => a + b, 0) : o.counters[f.hasCounter]) > 0)) return false;
  if (f.isCommander !== undefined && !!o.isCommander !== f.isCommander) return false;
  if (f.hasBasicLandType !== undefined && c.subtypes.some((s) => ["plains", "island", "swamp", "mountain", "forest"].includes(s.toLowerCase())) !== f.hasBasicLandType) return false;
  if (f.enteredThisTurn !== undefined && r.s.turnLog.some((e) => e.type === "etb" && e.id === id) !== f.enteredThisTurn) return false;
  if (f.chosenColor) { const col = q.source ? tryObj(r, q.source)?.chosen?.color : undefined; const key = col ? ({ white: "W", blue: "U", black: "B", red: "R", green: "G" } as Record<string, string>)[col.toLowerCase()] ?? col.toUpperCase() : undefined; if (!key || !c.colors.some((x) => x === key || x.toLowerCase() === (col ?? "").toLowerCase())) return false; }
  if (f.sameNameAs) { const ref = resolveObjs(r, f.sameNameAs as string, q)[0]; const rn = ref ? (r.s.lki[ref]?.name ?? (tryObj(r, ref) ? chars(r, ref).name : undefined)) : undefined; if (!rn || rn !== c.name) return false; }
  if (f.sharesCreatureTypeWith) { const ref = resolveObjs(r, f.sharesCreatureTypeWith as string, q)[0]; const rs = ref ? (r.s.lki[ref]?.subtypes ?? (tryObj(r, ref) ? chars(r, ref).subtypes : [])) : []; if (!c.subtypes.some((x) => rs.includes(x))) return false; }
  if (f.named && c.name.toLowerCase() !== f.named.toLowerCase()) return false;
  if (f.mv && !cmp(c.mv, f.mv, r, q)) return false;
  if (f.power && (c.power === undefined || !cmp(c.power, f.power, r, q))) return false;
  if (f.toughness && (c.toughness === undefined || !cmp(c.toughness, f.toughness, r, q))) return false;
  if (f.attacking !== undefined && isAttacking(r, id) !== f.attacking) return false;
  if (f.blocking !== undefined && isBlocking(r, id) !== f.blocking) return false;
  if (f.attackingYou !== undefined || f.attackingOpponent !== undefined) {
    const dp = attackerEntry(r, id) ? defenderPlayer(r, attackerEntry(r, id)!.defender) : undefined;
    if (f.attackingYou !== undefined && (dp === q.controller) !== f.attackingYou) return false;
    if (f.attackingOpponent !== undefined && (dp !== undefined && dp !== q.controller) !== f.attackingOpponent) return false;
  }
  if (f.chosenType) {
    // "creature spells of the chosen type": the type remembered by the source (a permanent that chose it as it entered)
    const chosen = q.source ? tryObj(r, q.source)?.chosen?.type : undefined;
    if (!chosen || !lcAll(c.subtypes).includes(chosen.toLowerCase())) return false;
  }
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
  if (/^(t\d+|__c)$/.test(ref)) return q.targets?.[ref] ?? [];
  switch (ref) {
    case "self": return q.source ? [q.source] : [];
    case "enchanted":
    case "equipped": { const so = q.source ? tryObj(r, q.source) : undefined; const h = so && hostOf(r, so); return h ? [h.id] : []; }
    case "chosen": return savedObjs(r, { ...q, chosen: q.chosen ?? {} }, "chosen");
    case "sacrificed": return q.sacrificed ?? [];
    case "looked_cards":
    case "rest_of_looked_cards": return lookedLive(r, { ...q, chosen: q.chosen ?? {} });
    case "linked_exile": return linkedObjs(r, q.source);
    case "event_object": return q.eventObj ? [q.eventObj] : [];
    case "created": return q.created ?? [];
    case "iterated": return q.iterated ? [q.iterated] : [];
    default:
      if (q.chosen && ref in q.chosen) return savedObjs(r, { ...q, chosen: q.chosen }, ref);
      throw new Unsupported(`ref:${ref}`);
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
      { const gone = typeof qy.on === "string" && /^(event_object|sacrificed)$/.test(qy.on) ? resolveObjs(r, qy.on, q)[0] : undefined; const l = gone ? r.s.lki[gone] : undefined; if (l && tryObj(r, gone!)?.zone !== "battlefield") return countersLeft(l.counters, qy.kind); }
      if (["you", "opponent", "each_opponent", "each_player", "target_player", "controller_of_target", "owner_of_target", "that_player"].includes(qy.on as string)) throw new Unsupported("quantity:player_counters");
      const ids = resolveObjs(r, qy.on, q);
      const o = ids[0] ? tryObj(r, ids[0]) : undefined;
      if (!o) return 0;
      return qy.kind === "any" ? Object.values(o.counters).reduce((a, b) => a + b, 0) : o.counters[qy.kind] ?? 0;
    }
    case "life_lost_this_way": return q.lastLifeLost ?? 0;
    case "step_result": { const n = resultOf({ chosen: q.chosen ?? {} }, qy.step); if (n === undefined) throw new Unsupported("quantity:step_result", `step ${qy.step} left no numeric result`); return n; }
    case "event_amount": return q.amount ?? 0;
    case "life_total": return player(r, resolvePlayers(r, qy.who, q)[0]).life;
    case "starting_life": return 40;
    case "count_this_turn": return countLog(r, qy.event, q, qy.filter, qy.actor).length;
    case "greatest":
    case "sum": {
      const vals = objectsMatching(r, qy.of, q).map((id) => { const c = chars(r, id); return qy.stat === "power" ? c.power ?? 0 : qy.stat === "toughness" ? c.toughness ?? 0 : qy.stat === "mana_value" ? c.mv : (() => { throw new Unsupported(`quantity:${qy.ref}.${qy.stat}`); })(); });
      return qy.ref === "sum" ? vals.reduce((a, b) => a + b, 0) : Math.max(0, ...vals);
    }
    case "players_count": {
      // "the number of opponents who ...": each player of `who` is tested with `where` read as "that player"
      const w = (qy as unknown as { where?: Predicate }).where;
      return resolvePlayers(r, (qy as unknown as { who: PlayerRef }).who, q).filter((pid) => !w || evalPredicate(r, w, { ...q, thatPlayer: pid })).length;
    }
    case "opponents_count": return opponentsOf(r, q.controller).length;
    case "commander_colors": return player(r, q.controller).colorIdentity.filter((c) => "WUBRG".includes(c)).length;
    case "devotion": {
      // mana symbols of the given colors among the mana costs of permanents you control (hybrid symbols count for each color they show)
      const colors = ([] as string[]).concat((qy as unknown as { color: string | string[] }).color).map((c) => c.toUpperCase());
      let n = 0;
      for (const id of r.s.battlefield) {
        const o = r.s.objects[id];
        if (o.controller !== q.controller) continue;
        for (const sym of manaCostOf(r, o).matchAll(/{([^}]*)}/g)) if (sym[1].split("/").some((part) => colors.includes(part))) n++;
      }
      return n;
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
  const cast = q.cast ?? q.item?.cast ?? (q.source ? tryObj(r, q.source)?.cast : undefined);
  switch (p.check) {
    case "cast_during": {
      if (!cast) throw new Unsupported("predicate:cast_during", "cast_during evaluated on something that was not cast");
      // "your_main" = "during your main phase": a main phase of the caster's OWN turn (every Addendum card reads this way);
      // "main" = "a main phase" of any player's turn
      const own = cast.activePlayer === cast.caster;
      switch (p.phase) {
        case "main": return MAIN_PHASES.includes(cast.phase);
        case "your_main": return MAIN_PHASES.includes(cast.phase) && own;
        case "combat": return ["beginning_of_combat", "combat", "declare_attackers", "declare_blockers", "first_strike_damage", "combat_damage", "end_of_combat"].includes(cast.phase);
        case "your_turn": return own;
        case "opponent_turn": return !own;
        case "end_step": return cast.phase === "end_step";
      }
      return false;
    }
    case "kicked":
    case "paid_additional_cost":
    case "cast_with": {
      if (!cast) throw new Unsupported(`predicate:${p.check}`, `${p.check} evaluated on something that was not cast`);
      const paid = cast.paid ?? [];
      const opt = (p as { option?: string }).option;
      if (opt !== undefined) return paid.includes(opt);
      if (p.check === "kicked") return paid.includes("kicker");
      return ["additional", "kicker", "gift"].some((k) => paid.includes(k));
    }
    case "mana_spent": {
      if (!cast) throw new Unsupported("predicate:mana_spent", "mana_spent evaluated on something that was not cast");
      const n = (cast.spent ?? []).filter((c) => c === p.color).length;
      return p.cmp ? cmp(n, p.cmp, r, q) : n >= 1;
    }
    case "cast_from": if (!cast) throw new Unsupported("predicate:cast_from"); return cast.from === p.zone;
    case "turn_is": return (r.s.turn.active === q.controller) === (p.whose === "yours");
    case "phase_is": return p.phase === "main" as string ? MAIN_PHASES.includes(r.s.turn.phase) : r.s.turn.phase === p.phase;
    case "controls": {
      const ids = objectsMatching(r, { ...p.filter, controller: p.filter.controller ?? "you" }, q);
      // sameName: the objects must share one name ("three lands with the same name"): the size of the biggest group counts
      const n = p.filter.sameName ? Math.max(0, ...Object.values(ids.reduce<Record<string, number>>((m, i) => { const nm = chars(r, i).name; m[nm] = (m[nm] ?? 0) + 1; return m; }, {}))) : ids.length;
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
      { const m = /^([a-z]+)_counters$/.exec(p.stat); if (m) return cmp(tryObj(r, ids[0])!.counters[m[1]] ?? 0, p.cmp, r, q); }
      if (p.stat === "controller_is_monarch") return cmp(r.s.monarch !== undefined && r.s.monarch === tryObj(r, ids[0])!.controller ? 1 : 0, p.cmp, r, q);
      if (p.stat === "power" || p.stat === "toughness" || p.stat === "mana_value") return cmp(evalQuantity(r, { ref: "stat", of: p.of, stat: p.stat }, q), p.cmp, r, q);
      throw new Unsupported(`predicate:stat.${p.stat}`);
    }
    case "matches": { const ids = resolveObjs(r, p.obj, q); return ids.length > 0 && ids.every((id) => matchesFilter(r, id, p.filter, q)); }
    case "source_state": {
      const o = q.source ? tryObj(r, q.source) : undefined;
      if (p.state === "on_battlefield") return !!o && o.zone === "battlefield";
      if (p.state === "tapped") return !!o && o.tapped;
      if (p.state === "attacking") return !!o && isAttacking(r, o.id);
      throw new Unsupported(`predicate:source_state.${p.state}`);
    }
    case "turn_number": throw new Unsupported("predicate:turn_number");
    case "chosen_is": {
      const so = q.source ? tryObj(r, q.source) : undefined;
      const ch = so?.chosen;
      const v = p.kind === "color" ? ch?.color : p.kind === "mode" ? ch?.mode : p.kind === "creature_type" ? ch?.type : p.kind === "card_type" ? ch?.cardType : p.kind === "basic_land_type" ? ch?.landType : ch?.name;
      return v !== undefined && v.toLowerCase() === p.value.toLowerCase();
    }
    case "step_done": return (q.done ?? []).includes(p.step);
    case "most_life": { const ps = resolvePlayers(r, p.who, q); const max = Math.max(...alive(r).map((x) => x.life)); return ps.every((id) => player(r, id).life === max); }
    default: throw new Unsupported(`predicate:${(p as { check: string }).check}`);
  }
}

export function isSick(r: Run, id: ObjId): boolean { return isSummoningSick(r, obj(r, id)); }
