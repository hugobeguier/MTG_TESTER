// Working context + primitives shared by the whole engine: errors, events, RNG, zones, effective characteristics.
// `resolve` clones the input state into a Run, mutates the clone freely, and returns it; the caller's state is never touched.

import type { Ability, Zone } from "../schema";
import type {
  Attacker, Choice, CardDef, CardLookup, EngineError, ErrorCode, GameEvent, GameObject, GameState, Lki, ManaPool, ObjId, PlayerId, PlayerState, TokenDef
} from "./types";
import { isObjId } from "./types";
import { computeChars, invalidateIndex, layerSixActive } from "./layers";
import { applyReplacements, runAfter } from "./replacements";
import { releaseUnexiled } from "./durable";
import { askCommandZone } from "./commander";
import { maybeQueueMiracle } from "./miracle";

export class Unsupported extends Error {
  constructor(public capability: string, message?: string, public all: string[] = [capability]) { super(message ?? `unsupported: ${capability}`); }
}
export class Reject extends Error {
  constructor(public code: ErrorCode, message: string) { super(message); }
  toError(): EngineError { return { code: this.code, message: this.message }; }
}
export class LoopDetected extends Error {}
/**
 * Thrown when a decision is needed somewhere the resumable-step mechanism cannot reach (inside a replacement effect, in a
 * choke point deep in the engine). resolve() turns it into a pending decision that replays the whole action (see replacements.ts).
 */
export class NeedAsk extends Error {
  constructor(public spec: import("./steps").AskSpec) { super("decision needed inside a replacement effect"); }
}
/** The next recorded answer of the replay protocol (undefined = the question is new: abort with NeedAsk). */
export function takeAnswer(r: Run): Choice | undefined {
  const a = r.answers?.[r.answerIdx ?? 0];
  if (a !== undefined) r.answerIdx = (r.answerIdx ?? 0) + 1;
  return a;
}

export interface Run {
  s: GameState;
  events: GameEvent[];
  defs: CardLookup;
  /** the host's card database (carddb.ts), when supplied */
  db?: import("./types").CardDb;
  /** index into events up to which triggers have been scanned */
  scanned: number;
  /** recorded answers to replacement-ordering questions (replay protocol, replacements.ts) and how many were consumed */
  answers?: Choice[];
  answerIdx?: number;
  /** id shared by the events of one simultaneous action (all attackers of a declaration, all combat damage of a step): "batch" triggers */
  batch?: number;
  /** batch triggers already queued during this run: "<holder>:<ability>:<event>:<batch>" */
  seenBatch?: Set<string>;
  /** a permanent that is entering the battlefield right now (replacement steps of "as this enters" effects may tap it / add counters to it) */
  entering?: { id: ObjId; tapped: boolean; counters: Record<string, number> };
  /** cached static/replacement source index (layers.ts); dropped whenever a zone changes */
  idx?: import("./layers").Idx;
  /** objects whose characteristics are being computed right now (layers.ts): reads see the partial result */
  busy?: Map<ObjId, Chars>;
  /** delayed triggers created during this run -> number of events emitted before (those cannot fire them) */
  dtBorn?: Record<string, number>;
  /** a cast / land play that happens DURING the resolution of an ability ("you may play the exiled card"): timing restrictions are ignored (608.2g) */
  ignoreTiming?: boolean;
  /** cards the resolving ability lets its controller cast / play right after it finishes resolving (permission_to_play with no duration) */
  castNow?: Array<{ player: PlayerId; id: ObjId; ts: number; withoutPaying: boolean; /** cast with this option id (miracle) */ option?: string }>;
  /** a miracle cast is in progress: the miracle option may be chosen */
  castingMiracle?: boolean;
  /** replacement effects currently applying (their nested steps must not re-apply them), as "<source>:<ability>" */
  activeRepl?: string[];
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

/** The printed mana cost string of what this object currently is (a copy / token: its snapshot; a card: its current face). */
export function manaCostOf(r: Run, o: GameObject): string {
  const t = o.copyDef ?? o.token;
  if (t) return t.manaCost ?? "";
  const d = defOf(r, o);
  return d ? faceMeta(d, o).manaCost ?? "" : "";
}

export function defOf(r: Run, o: GameObject): CardDef | undefined {
  if (o.token) return undefined;
  const d = r.defs(o.cardName);
  if (!d) throw new Reject("unknown_card", `no card definition for "${o.cardName}"`);
  return d;
}
/** Printed abilities: card JSON, or a token's own abilities + keyword abilities. Zone-agnostic; see abilitiesOf for the effective list. */
export function printedAbilities(r: Run, o: GameObject): Ability[] {
  if (o.token || o.copyDef) return tokenAbilities((o.copyDef ?? o.token)!);
  const def = defOf(r, o)!;
  const cur = currentFace(def, o);
  return cur === undefined ? def.kernel.abilities : def.kernel.abilities.filter((a) => !a.face || a.face === cur);
}

// ---------------------------------------------------------------- faces (double-faced / modal / split cards)

/** Face names of a card: the distinct `face` values of its abilities, front first. Empty for single-faced cards. */
export function faceNames(def: CardDef): string[] {
  const out: string[] = [];
  for (const a of def.kernel.abilities) if (a.face && !out.includes(a.face)) out.push(a.face);
  return out;
}
export function currentFace(def: CardDef, o: GameObject): string | undefined {
  const names = faceNames(def);
  if (!names.length) return undefined;
  return o.face && names.includes(o.face) ? o.face : names[0];
}
/** The printed characteristics of the face this object shows. */
export function faceMeta(def: CardDef, o: GameObject): { manaCost?: string; types: string[]; subtypes?: string[]; supertypes?: string[]; colors?: string[]; power?: number; toughness?: number } {
  const cur = currentFace(def, o);
  const names = faceNames(def);
  if (cur === undefined || cur === names[0]) return def;
  return def.faces?.[cur] ?? def;
}
export function tokenAbilities(t: TokenDef): Ability[] {
  const kw = t.keywords.map((k): Ability => ({ id: "k:" + k.toLowerCase(), kind: "keyword", text: k, keyword: { name: k.toLowerCase() } }));
  return [...kw, ...(t.abilities ?? [])];
}
/** Effective abilities: on the battlefield what layer 6 leaves (a stripped permanent has none), elsewhere the printed ones. */
export function abilitiesOf(r: Run, o: GameObject): Ability[] {
  if (o.zone === "battlefield" && layerSixActive(r)) return chars(r, o.id).abilities;
  return printedAbilities(r, o);
}

// ---------------------------------------------------------------- mana cost symbols

/**
 * `hybrid`: one entry per hybrid symbol, its alternatives ("W","U" for {W/U}; "2","W" for {2/W}). `phyrexian`: one entry per Phyrexian symbol, the
 * colors that may pay it (or 2 life). Both are settled into plain generic / colored mana (and life) by mana.settleCost before anything is paid.
 * `symbolColors`: every color a symbol shows (the card's colors / devotion), hybrids included.
 */
export interface ParsedCost { generic: number; colored: Record<string, number>; x: number; mv: number; hybrid?: string[][]; phyrexian?: string[][]; symbolColors?: string[] }
export function parseManaCost(cost: string | undefined): ParsedCost {
  const out: ParsedCost = { generic: 0, colored: {}, x: 0, mv: 0 };
  if (!cost) return out;
  const rest = cost.replace(/\{([^}]*)\}/g, (_m, sym: string) => {
    if (/^\d+$/.test(sym)) { out.generic += Number(sym); out.mv += Number(sym); }
    else if (sym === "X") out.x++;
    else if (/^[WUBRGC]$/.test(sym)) { out.colored[sym] = (out.colored[sym] ?? 0) + 1; out.mv++; (out.symbolColors ??= []).push(sym); }
    else if (/^([WUBRGC2](\/[WUBRGC])+(\/P)?|[WUBRGC]\/P)$/.test(sym)) {
      const parts = sym.split("/");
      const colors = parts.filter((p) => /^[WUBRGC]$/.test(p));
      if (parts.includes("P")) { (out.phyrexian ??= []).push(colors); out.mv++; }
      else { (out.hybrid ??= []).push(parts); out.mv += parts.includes("2") ? 2 : 1; }
      for (const c of colors) (out.symbolColors ??= []).push(c);
    }
    else throw new Unsupported("cost:symbol", `unsupported mana symbol {${sym}}`);
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
  /** effective abilities after layer 6 (printed + granted - removed) */
  abilities: Ability[];
}

const lc = (a: string[] | undefined) => (a ?? []).map((x) => x.toLowerCase());

/** Characteristics before any continuous effect (copiable values; layers.ts applies everything else). */
export function baseChars(r: Run, o: GameObject): Chars {
  if (o.token || o.copyDef) {
    const t = (o.copyDef ?? o.token)!;
    return { name: t.name, types: lc(t.types), subtypes: [...t.subtypes], supertypes: lc(t.supertypes), colors: [...t.colors], mv: parseManaCost(t.manaCost).mv, power: t.power, toughness: t.toughness, keywords: lc(t.keywords), abilities: tokenAbilities(t) };
  }
  const d = defOf(r, o)!;
  const m = faceMeta(d, o);
  const abilities = printedAbilities(r, o);
  const pc = parseManaCost(m.manaCost);
  const colors = m.colors ?? [...new Set(pc.symbolColors ?? [])].filter((c) => c !== "C");
  const keywords = abilities.filter((a) => a.kind === "keyword" && a.keyword).map((a) => a.keyword!.name.toLowerCase().replace(/_/g, " "));
  return { name: currentFace(d, o) ?? d.name, types: lc(m.types), subtypes: [...(m.subtypes ?? [])], supertypes: lc(m.supertypes), colors: [...colors], mv: pc.mv, power: m.power, toughness: m.toughness, keywords, abilities };
}

/**
 * Effective characteristics. THE single entry point the rest of the engine reads power/toughness/types/keywords/abilities
 * from: base values, then the layer system (layers.ts: types/colors/abilities/P-T over static abilities and timestamped
 * temporary effects), then counters. Recomputed on every call (nothing else tracks mutations, so there is no cache).
 */
export function chars(r: Run, id: ObjId): Chars { return computeChars(r, id); }

export function isSummoningSick(r: Run, o: GameObject): boolean {
  const c = chars(r, o.id);
  if (!c.types.includes("creature") || c.keywords.includes("haste")) return false;
  return o.controlledSince > player(r, o.controller).lastTurnStartTs;
}

export function makeLki(r: Run, o: GameObject): Lki {
  const c = chars(r, o.id);
  return { controller: o.controller, owner: o.owner, name: c.name, types: c.types, subtypes: c.subtypes, colors: c.colors, mv: c.mv, power: c.power, toughness: c.toughness, token: !!o.token, counters: { ...o.counters } };
}

// ---------------------------------------------------------------- zones

export function zoneList(r: Run, owner: PlayerId, zone: Zone): ObjId[] {
  if (zone === "battlefield") return r.s.battlefield;
  if (zone === "stack") return r.s.stack.map((i) => i.objectId).filter((x): x is string => !!x);
  return player(r, owner)[zone as "library" | "hand" | "graveyard" | "exile" | "command"];
}

export interface MoveOpts { /** battlefield only: enters showing this face ("transformed") */ face?: string; position?: "top" | "bottom"; controller?: PlayerId; tapped?: boolean; /** enters with these counters (battlefield only) */ counters?: Record<string, number> }

/** The one function that changes an object's zone. Replacement effects (enters tapped, would die, ...) apply first; emits zone_change plus etb / dies / leaves. */
export function moveObject(r: Run, id: ObjId, to: Zone, opts: MoveOpts = {}): GameObject | undefined {
  const o = obj(r, id);
  const from = o.zone;
  const oldTs = o.timestamp;
  let tapped = !!opts.tapped;
  let enterCounters: Record<string, number> | undefined;
  let after: ReturnType<typeof applyReplacements> | undefined;
  if (to === "battlefield") {
    const controller = opts.controller ?? o.owner;
    const keep = o.controller;
    o.controller = controller; // "you control" in an enters-the-battlefield replacement means the player it enters under
    const ev = applyReplacements(r, { kind: "enter", id, from, controller, tapped, counters: {}, x: o.castX });
    o.controller = keep;
    if (ev.cancelled || ev.kind !== "enter") { runAfter(r, ev); return r.s.objects[id]; }
    tapped = ev.tapped; enterCounters = { ...ev.counters };
    for (const [k, n] of Object.entries(opts.counters ?? {})) enterCounters[k] = (enterCounters[k] ?? 0) + n;
    opts = { ...opts, controller };
    after = ev;
    if (!o.token) { const dd = defOf(r, o); if (dd?.loyalty && lc(dd.types).includes("planeswalker")) enterCounters = { ...enterCounters, loyalty: (enterCounters?.loyalty ?? 0) + dd.loyalty }; }
  } else {
    const ev = applyReplacements(r, { kind: "zone", id, from, to, position: opts.position });
    if (ev.cancelled || ev.kind !== "zone") { runAfter(r, ev); return r.s.objects[id]; }
    to = ev.to;
    // commander: a replacement for hand / library (903.9b); the graveyard / exile move is a state-based action (resolve.ts sba)
    if (o.isCommander && from !== "command" && (to === "hand" || to === "library") && askCommandZone(r, o, to)) to = "command";
    if (from === "stack" && to === "graveyard" && o.exileInstead) to = "exile"; // flashback: exiled instead of going anywhere else from the stack
    after = ev;
  }
  invalidateIndex(r);
  const lki = from === "battlefield" || from === "graveyard" ? makeLki(r, o) : undefined; // graveyard: "whenever cards leave your graveyard"
  if (from === "battlefield") r.s.battlefield = r.s.battlefield.filter((x) => x !== id);
  else if (from !== "stack") { const l = zoneList(r, o.owner, from); const i = l.indexOf(id); if (i >= 0) l.splice(i, 1); }
  if (lki) r.s.lki[id] = lki;
  if (from === "battlefield") { o.tapped = false; o.counters = {}; o.damage = 0; o.dtHit = undefined; o.controller = o.owner; o.attachedTo = undefined; o.attachedToTs = undefined; o.copyDef = undefined; o.copyUntilEot = undefined; r.s.effects = r.s.effects.filter((e) => e.objectId !== id); }
  o.zone = to;
  o.exileInstead = undefined;
  o.faceDown = undefined;
  o.commanderDeclined = undefined;
  if (to !== "battlefield" && to !== "stack") o.face = undefined; // a card in any other zone shows its front face
  if (from === "battlefield" && to === "battlefield") o.face = undefined;
  if (to === "battlefield" && opts.face) o.face = opts.face;
  if (!(from === "stack" && to === "battlefield")) o.cast = undefined;
  o.timestamp = tick(r);
  if (to === "battlefield") {
    o.controller = opts.controller ?? o.owner;
    o.controlledSince = o.timestamp;
    o.tapped = tapped;
    if (enterCounters) for (const [k, n] of Object.entries(enterCounters)) if (n > 0) o.counters[k] = (o.counters[k] ?? 0) + n;
    r.s.battlefield.push(id);
  } else if (to === "library") {
    const lib = player(r, o.owner).library;
    if (opts.position === "bottom") lib.push(id); else lib.unshift(id);
  } else if (to !== "stack" && !o.token && !o.isCopy) { // a token that leaves the battlefield ceases to exist (below), it never lands in a zone list
    player(r, o.owner)[to as "hand" | "graveyard" | "exile" | "command"].push(id);
  }
  invalidateIndex(r);
  emit(r, { type: "zone_change", id, from, to, owner: o.owner, name: chars(r, id).name });
  if (to === "battlefield") {
    emit(r, { type: "etb", id, player: o.controller, from });
    r.s.turnLog.push({ type: "etb", id, player: o.controller, name: o.cardName, types: chars(r, id).types, token: !!o.token, ts: r.s.clock });
  }
  if (from === "graveyard" && lki) emit(r, { type: "leaves", id, from, to, lki });
  if (from === "battlefield") {
    emit(r, { type: "leaves", id, from, to, lki });
    releaseUnexiled(r, id, oldTs);
    if (to === "graveyard" && lki!.types.includes("creature")) {
      emit(r, { type: "dies", id, player: lki!.controller, lki });
      r.s.turnLog.push({ type: "dies", id, player: lki!.controller, name: lki!.name, types: lki!.types, token: lki!.token, ts: r.s.clock });
    }
  }
  const ceases = (o.token || o.isCopy) && to !== "battlefield" && !(o.isCopy && !o.token && to === "stack");
  // a token with its own "when this dies / leaves" trigger stays as an inert record (not in any zone list) so the trigger can find its source; other tokens vanish
  const keep = ceases && !!o.token && !!(o.copyDef ?? o.token).abilities?.some((a) => a.kind === "triggered" && (a.trigger?.event === "dies" || a.trigger?.event === "leaves"));
  if (ceases && !keep) delete r.s.objects[id];
  if (after) runAfter(r, after); // "also" steps of the replacement effects that applied, after the move
  return ceases ? undefined : o;
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
    const ev = applyReplacements(r, { kind: "draw", player: pid });
    if (ev.cancelled) { runAfter(r, ev); continue; } // replaced or prevented: no card, and not a failed draw either
    const drawsBefore = r.s.turnLog.filter((e) => e.type === "draw" && e.player === pid).length;
    const id = p.library.shift();
    if (!id) { p.drewFromEmpty = true; emit(r, { type: "draw_failed", player: pid }); break; }
    obj(r, id).zone = "hand";
    obj(r, id).timestamp = tick(r);
    p.hand.push(id);
    drawn.push(id);
    emit(r, { type: "draw", player: pid, id });
    r.s.turnLog.push({ type: "draw", player: pid, id, ts: r.s.clock });
    runAfter(r, ev);
    maybeQueueMiracle(r, pid, id, drawsBefore);
  }
  return drawn;
}

export function label(r: Run, id: string): string {
  if (!isObjId(id)) return r.s.players.find((p) => p.id === id)?.name ?? id;
  const o = r.s.objects[id];
  return o ? baseChars(r, o).name : id;
}

// ---------------------------------------------------------------- combat facts (state lives in GameState.combat; rules in combat.ts)

/** The attacker entry of a creature that is still attacking (same object as when it was declared, still on the battlefield). */
export function attackerEntry(r: Run, id: ObjId): Attacker | undefined {
  const a = r.s.combat?.attackers.find((x) => x.id === id);
  const o = r.s.objects[id];
  return a && o && o.zone === "battlefield" && o.timestamp === a.ts ? a : undefined;
}
export const isAttacking = (r: Run, id: ObjId): boolean => !!attackerEntry(r, id);
export function isBlocking(r: Run, id: ObjId): boolean {
  const o = r.s.objects[id];
  if (!o || o.zone !== "battlefield") return false;
  return !!r.s.combat?.attackers.some((a) => attackerEntry(r, a.id) && a.blockers.some((b) => b.id === id && b.ts === o.timestamp));
}
/** The player an attack is aimed at: the defender itself, or the controller of the attacked planeswalker / battle. */
export function defenderPlayer(r: Run, defender: string): PlayerId | undefined {
  if (!isObjId(defender)) return defender;
  const o = r.s.objects[defender];
  return o && o.zone === "battlefield" ? o.controller : undefined;
}
