// Working context + primitives shared by the whole engine: errors, events, RNG, zones, effective characteristics.
// `resolve` clones the input state into a Run, mutates the clone freely, and returns it; the caller's state is never touched.

import type { Ability, Zone } from "../schema";
import type {
  CardDef, CardLookup, ContinuousEffect, EngineError, ErrorCode, GameEvent, GameObject, GameState, Lki, ManaPool, ObjId, PlayerId, PlayerState
} from "./types";
import { isObjId } from "./types";

export class Unsupported extends Error {
  constructor(public capability: string, message?: string, public all: string[] = [capability]) { super(message ?? `unsupported: ${capability}`); }
}
export class Reject extends Error {
  constructor(public code: ErrorCode, message: string) { super(message); }
  toError(): EngineError { return { code: this.code, message: this.message }; }
}
export class LoopDetected extends Error {}

export interface Run {
  s: GameState;
  events: GameEvent[];
  defs: CardLookup;
  /** index into events up to which triggers have been scanned */
  scanned: number;
}

export function emit(r: Run, e: { type: string; [k: string]: unknown }): GameEvent {
  const ev = { ...e, seq: r.events.length } as GameEvent;
  r.events.push(ev);
  if (r.events.length > r.s.config.maxEventsPerPass) throw new LoopDetected(`more than ${r.s.config.maxEventsPerPass} events in one priority pass`);
  return ev;
}

// ---------------------------------------------------------------- deterministic RNG (mulberry32 stored in state)

export function rand(r: Run): number {
  let t = (r.s.rngState = (r.s.rngState + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const randInt = (r: Run, n: number): number => Math.floor(rand(r) * n);
export function shuffleInPlace<T>(r: Run, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = randInt(r, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------------------------------------------------------------- lookups

export const tick = (r: Run): number => ++r.s.clock;
export function player(r: Run, id: PlayerId): PlayerState {
  const p = r.s.players.find((x) => x.id === id);
  if (!p) throw new Reject("unknown_object", `unknown player ${id}`);
  return p;
}
export function obj(r: Run, id: ObjId): GameObject {
  const o = r.s.objects[id];
  if (!o) throw new Reject("unknown_object", `unknown object ${id}`);
  return o;
}
export const tryObj = (r: Run, id: string): GameObject | undefined => (isObjId(id) ? r.s.objects[id] : undefined);
export const alive = (r: Run): PlayerState[] => r.s.players.filter((p) => !p.hasLost);
/** Players in turn order starting with the active player (APNAP). */
export function apnap(r: Run): PlayerState[] {
  const ps = r.s.players;
  const start = Math.max(0, ps.findIndex((p) => p.id === r.s.turn.active));
  return [...ps.slice(start), ...ps.slice(0, start)].filter((p) => !p.hasLost);
}
export function opponentsOf(r: Run, id: PlayerId): PlayerState[] { return alive(r).filter((p) => p.id !== id); }
export function nextPlayer(r: Run, id: PlayerId): PlayerState {
  const ps = r.s.players;
  const i = ps.findIndex((p) => p.id === id);
  for (let k = 1; k <= ps.length; k++) { const p = ps[(i + k) % ps.length]; if (!p.hasLost) return p; }
  return ps[i];
}

export function defOf(r: Run, o: GameObject): CardDef | undefined {
  if (o.token) return undefined;
  const d = r.defs(o.cardName);
  if (!d) throw new Reject("unknown_card", `no card definition for "${o.cardName}"`);
  return d;
}
export function abilitiesOf(r: Run, o: GameObject): Ability[] {
  if (o.token) return [];
  return defOf(r, o)!.kernel.abilities;
}

// ---------------------------------------------------------------- mana cost symbols

export interface ParsedCost { generic: number; colored: Record<string, number>; x: number; mv: number }
export function parseManaCost(cost: string | undefined): ParsedCost {
  const out: ParsedCost = { generic: 0, colored: {}, x: 0, mv: 0 };
  if (!cost) return out;
  const rest = cost.replace(/\{([^}]*)\}/g, (_m, sym: string) => {
    if (/^\d+$/.test(sym)) { out.generic += Number(sym); out.mv += Number(sym); }
    else if (sym === "X") out.x++;
    else if (/^[WUBRGC]$/.test(sym)) { out.colored[sym] = (out.colored[sym] ?? 0) + 1; out.mv++; }
    else throw new Unsupported("cost:" + (sym.includes("/") ? (sym.includes("P") ? "phyrexian" : "hybrid") : "symbol"), `unsupported mana symbol {${sym}}`);
    return "";
  });
  if (rest.trim() !== "") throw new Unsupported("cost:unparsed", `cannot parse mana cost "${cost}"`);
  return out;
}

// ---------------------------------------------------------------- effective characteristics (layer-ready)

export interface Chars {
  name: string;
  types: string[];
  subtypes: string[];
  supertypes: string[];
  colors: string[];
  mv: number;
  power?: number;
  toughness?: number;
  keywords: string[];
}

const lc = (a: string[] | undefined) => (a ?? []).map((x) => x.toLowerCase());

export function baseChars(r: Run, o: GameObject): Chars {
  if (o.token) {
    const t = o.token;
    return { name: t.name, types: lc(t.types), subtypes: t.subtypes, supertypes: [], colors: t.colors, mv: 0, power: t.power, toughness: t.toughness, keywords: lc(t.keywords) };
  }
  const d = defOf(r, o)!;
  const pc = parseManaCost(d.manaCost);
  const colors = d.colors ?? Object.keys(pc.colored).filter((c) => c !== "C");
  const keywords = d.kernel.abilities.filter((a) => a.kind === "keyword" && a.keyword).map((a) => a.keyword!.name.toLowerCase());
  return { name: d.name, types: lc(d.types), subtypes: d.subtypes ?? [], supertypes: lc(d.supertypes), colors, mv: pc.mv, power: d.power, toughness: d.toughness, keywords };
}

/**
 * Effective characteristics: base characteristics, then continuous effects in timestamp order, then counters.
 * This is the single entry point the rest of the engine uses, so layers / static abilities can be added here later
 * (each effect already carries a timestamp and the layer order is the sort order).
 */
export function chars(r: Run, id: ObjId): Chars {
  const o = obj(r, id);
  const c = baseChars(r, o);
  const effects = r.s.effects.filter((e) => e.objectId === id && e.objectTimestamp === o.timestamp).sort((a: ContinuousEffect, b: ContinuousEffect) => a.timestamp - b.timestamp);
  for (const e of effects) {
    if (c.power !== undefined && e.power) c.power += e.power;
    if (c.toughness !== undefined && e.toughness) c.toughness += e.toughness;
    if (e.grant && !c.keywords.includes(e.grant)) c.keywords.push(e.grant);
  }
  if (c.power !== undefined) c.power += (o.counters["+1/+1"] ?? 0) - (o.counters["-1/-1"] ?? 0);
  if (c.toughness !== undefined) c.toughness += (o.counters["+1/+1"] ?? 0) - (o.counters["-1/-1"] ?? 0);
  return c;
}

export function isSummoningSick(r: Run, o: GameObject): boolean {
  const c = chars(r, o.id);
  if (!c.types.includes("creature") || c.keywords.includes("haste")) return false;
  return o.controlledSince > player(r, o.controller).lastTurnStartTs;
}

export function makeLki(r: Run, o: GameObject): Lki {
  const c = chars(r, o.id);
  return { controller: o.controller, owner: o.owner, name: c.name, types: c.types, subtypes: c.subtypes, colors: c.colors, mv: c.mv, power: c.power, toughness: c.toughness, token: !!o.token };
}

// ---------------------------------------------------------------- zones

export function zoneList(r: Run, owner: PlayerId, zone: Zone): ObjId[] {
  if (zone === "battlefield") return r.s.battlefield;
  if (zone === "stack") return r.s.stack.map((i) => i.objectId).filter((x): x is string => !!x);
  return player(r, owner)[zone as "library" | "hand" | "graveyard" | "exile" | "command"];
}

export interface MoveOpts { position?: "top" | "bottom"; controller?: PlayerId; tapped?: boolean }

/** The one function that changes an object's zone. Emits zone_change plus etb / dies / leaves. */
export function moveObject(r: Run, id: ObjId, to: Zone, opts: MoveOpts = {}): GameObject | undefined {
  const o = obj(r, id);
  const from = o.zone;
  const lki = from === "battlefield" ? makeLki(r, o) : undefined;
  if (from === "battlefield") r.s.battlefield = r.s.battlefield.filter((x) => x !== id);
  else if (from !== "stack") { const l = zoneList(r, o.owner, from); const i = l.indexOf(id); if (i >= 0) l.splice(i, 1); }
  if (lki) r.s.lki[id] = lki;
  if (from === "battlefield") { o.tapped = false; o.counters = {}; o.damage = 0; o.controller = o.owner; r.s.effects = r.s.effects.filter((e) => e.objectId !== id); }
  o.zone = to;
  o.timestamp = tick(r);
  if (to === "battlefield") {
    o.controller = opts.controller ?? o.owner;
    o.controlledSince = o.timestamp;
    o.tapped = !!opts.tapped;
    r.s.battlefield.push(id);
  } else if (to === "library") {
    const lib = player(r, o.owner).library;
    if (opts.position === "bottom") lib.push(id); else lib.unshift(id);
  } else if (to !== "stack") {
    player(r, o.owner)[to as "hand" | "graveyard" | "exile" | "command"].push(id);
  }
  emit(r, { type: "zone_change", id, from, to, name: chars(r, id).name });
  if (to === "battlefield") {
    emit(r, { type: "etb", id, player: o.controller });
    r.s.turnLog.push({ type: "etb", id, player: o.controller, name: o.cardName, types: chars(r, id).types, token: !!o.token, ts: r.s.clock });
  }
  if (from === "battlefield") {
    emit(r, { type: "leaves", id, from, to, lki });
    if (to === "graveyard" && lki!.types.includes("creature")) {
      emit(r, { type: "dies", id, player: lki!.controller, lki });
      r.s.turnLog.push({ type: "dies", id, player: lki!.controller, name: lki!.name, types: lki!.types, token: lki!.token, ts: r.s.clock });
    }
  }
  if (o.token && to !== "battlefield") { delete r.s.objects[id]; return undefined; }
  return o;
}

export function newObject(r: Run, cardName: string, owner: PlayerId, zone: Zone, extra: Partial<GameObject> = {}): GameObject {
  const id = `#${r.s.nextId++}`;
  const o: GameObject = { id, cardName, owner, controller: owner, zone, timestamp: tick(r), controlledSince: 0, tapped: false, counters: {}, damage: 0, ...extra };
  r.s.objects[id] = o;
  return o;
}

export const emptyPool = (): ManaPool => ({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
export const poolTotal = (p: ManaPool): number => p.W + p.U + p.B + p.R + p.G + p.C;

export function drawCards(r: Run, pid: PlayerId, n: number): ObjId[] {
  const p = player(r, pid);
  const drawn: ObjId[] = [];
  for (let i = 0; i < n; i++) {
    const id = p.library.shift();
    if (!id) { p.drewFromEmpty = true; emit(r, { type: "draw_failed", player: pid }); break; }
    obj(r, id).zone = "hand";
    obj(r, id).timestamp = tick(r);
    p.hand.push(id);
    drawn.push(id);
    emit(r, { type: "draw", player: pid, id });
    r.s.turnLog.push({ type: "draw", player: pid, id, ts: r.s.clock });
  }
  return drawn;
}

export function label(r: Run, id: string): string {
  if (!isObjId(id)) return r.s.players.find((p) => p.id === id)?.name ?? id;
  const o = r.s.objects[id];
  return o ? baseChars(r, o).name : id;
}
