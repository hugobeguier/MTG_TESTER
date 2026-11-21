// Kernel step 6 triggers driven by single engine events: draw, gain_life, lose_life, tap, sacrifice, counter_put, discard, mill,
// token_created. One matcher for all of them (`matchSimple`), called from resolve.scanTriggers. Qualifiers supported: subject (self /
// you / opponent / each_player / an object filter / enchanted / equipped), whose (player events), nth per turn, minimum amount none.

import type { ObjectFilter, TriggerSpec } from "../schema";
import { hostOf } from "./layers";
import { matchesFilter, type QCtx } from "./query";
import { tryObj, Unsupported, type Run } from "./core";
import type { GameEvent, Lki, ObjId, PlayerId, TriggerContext } from "./types";

/** engine event type -> trigger event name */
export const SIMPLE_EVENTS: Record<string, string> = {
  draw: "draw", life_gain: "gain_life", life_loss: "lose_life", tap: "tap", sacrificed: "sacrifice", counter_added: "counter_put",
  discard: "discard", mill: "mill", token_created: "token_created"
};
export const SIMPLE_TRIGGER_EVENTS: ReadonlySet<string> = new Set(Object.values(SIMPLE_EVENTS));
const PLAYER_EVENTS = new Set(["draw", "gain_life", "lose_life", "discard", "mill"]);
const LOG_TYPE: Record<string, string> = { draw: "draw", gain_life: "gain_life", lose_life: "lose_life", discard: "discard", mill: "mill", sacrifice: "sacrifice", token_created: "token_created" };

function lkiOk(f: ObjectFilter, l: Lki, q: QCtx, id: string): boolean {
  const lc = (a: string[]) => a.map((x) => x.toLowerCase());
  for (const k of Object.keys(f)) if (!["types", "notTypes", "subtypes", "notSubtypes", "colors", "controller", "owner", "token", "another", "named", "hasCounter", "zone"].includes(k)) throw new Unsupported(`filter:${k}@sacrifice_trigger`);
  if (f.types && !lc(f.types).every((t) => t === "permanent" || t === "card" || l.types.includes(t))) return false;
  if (f.notTypes && lc(f.notTypes).some((t) => l.types.includes(t))) return false;
  if (f.subtypes && !lc(f.subtypes).every((t) => lc(l.subtypes).includes(t))) return false;
  if (f.notSubtypes && lc(f.notSubtypes).some((t) => lc(l.subtypes).includes(t))) return false;
  if (f.colors) { const names: Record<string, string> = { W: "white", U: "blue", B: "black", R: "red", G: "green" }; const have = l.colors.map((c) => names[c] ?? c.toLowerCase()); if (!lc(f.colors).every((c) => have.includes(c))) return false; }
  if (f.controller === "you" && l.controller !== q.controller) return false;
  if (f.controller === "opponent" && l.controller === q.controller) return false;
  if (f.owner === "you" && l.owner !== q.controller) return false;
  if (f.token !== undefined && l.token !== f.token) return false;
  if (f.another && id === q.source) return false;
  if (f.named && l.name.toLowerCase() !== f.named.toLowerCase()) return false;
  return true;
}

/** Does this single-event trigger fire? `ev` is the engine event; returns the context or null. */
export function matchSimple(r: Run, ev: GameEvent & Record<string, unknown>, tr: TriggerSpec, h: { id: ObjId; controller: PlayerId }, evIdx = r.events.length): TriggerContext | null {
  const name = SIMPLE_EVENTS[ev.type];
  const q: QCtx = { controller: h.controller, source: h.id };
  const s = tr.subject;
  let ctx: TriggerContext;
  let actorPlayer: PlayerId | undefined;
  if (PLAYER_EVENTS.has(name)) {
    const who = ev.player as PlayerId;
    actorPlayer = who;
    let ok: boolean;
    if (s === undefined) ok = tr.whose ? tr.whose === "each" || (tr.whose === "yours") === (who === h.controller) : who === h.controller;
    else if (s === "you") ok = who === h.controller;
    else if (s === "opponent" || s === "each_opponent") ok = who !== h.controller;
    else if (s === "each_player") ok = true;
    else throw new Unsupported(`trigger:subject:${typeof s === "string" ? s : "filter"}`);
    if (!ok) return null;
    ctx = { eventPlayer: who, eventObj: ev.id as string | undefined, amount: ev.amount as number | undefined };
  } else {
    const id = (ev.id ?? ev.target) as ObjId;
    const live = tryObj(r, id);
    const l = r.s.lki[id];
    let ok: boolean;
    if (s === undefined || s === "self") ok = id === h.id;
    else if (s === "enchanted" || s === "equipped") { const ho = tryObj(r, h.id); const host = ho && hostOf(r, ho); ok = !!host && host.id === id; }
    else if (s === "you" || s === "opponent" || s === "each_opponent" || s === "each_player") {
      const ctl = (ev.player as PlayerId | undefined) ?? live?.controller;
      ok = s === "each_player" || (s === "you" ? ctl === h.controller : ctl !== undefined && ctl !== h.controller);
    } else if (typeof s === "object") {
      if (name === "sacrifice") { if (!l) return null; ok = lkiOk(s as ObjectFilter, l, q, id); }
      else ok = !!live && live.zone === "battlefield" && matchesFilter(r, id, s as ObjectFilter, q);
    } else throw new Unsupported(`trigger:subject:${String(s)}`);
    if (!ok) return null;
    actorPlayer = (ev.player as PlayerId | undefined) ?? live?.controller ?? l?.controller;
    if (tr.whose && tr.whose !== "each" && actorPlayer !== undefined && (tr.whose === "yours") !== (actorPlayer === h.controller)) return null;
    if (name === "counter_put" && tr.chapters) {
      // Saga chapters: a lore counter that brings the Saga to one of the listed chapter numbers
      if (ev.kind !== "lore" || !live || !tr.chapters.includes(live.counters.lore ?? 0)) return null;
    }
    ctx = { eventObj: id, eventPlayer: actorPlayer, amount: ev.amount as number | undefined, ...(l && name === "sacrifice" ? { lki: l } : {}) };
  }
  if (tr.nth) {
    const type = LOG_TYPE[name];
    if (!type || tr.nth.per !== "turn") throw new Unsupported("trigger:nth");
    const n = r.s.turnLog.filter((e) => e.type === type && (!PLAYER_EVENTS.has(name) || e.player === actorPlayer)).length;
    // the log already holds every event of this resolution: do not count the ones that come after this event
    const later = r.events.slice(evIdx + 1).filter((e) => e.type === ev.type && (!PLAYER_EVENTS.has(name) || (e as { player?: PlayerId }).player === actorPlayer)).length;
    if (n - later !== tr.nth.n) return null;
  }
  return ctx;
}
