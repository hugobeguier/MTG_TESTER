// Working context + primitives shared by the whole engine: errors, events, RNG, zones, effective characteristics.
// `resolve` clones the input state into a Run, mutates the clone freely, and returns it; the caller's state is never touched.

import { withKeywordExtras } from "./keywords8";
import type { Ability, Zone } from "../schema";
import type {
  Attacker, Choice, CardDef, CardLookup, EngineError, ErrorCode, GameEvent, GameObject, GameState, Lki, ManaPool, ObjId, PlayerId, PlayerState, TokenDef
} from "./types";
import { isObjId } from "./types";
import { computeChars, invalidateIndex, layerSixActive } from "./layers";
import { applyReplacements, runAfter } from "./replacements";
import { releaseUnexiled } from "./durable";
import { askCommandZone } from "./commander";
import { offerDredge } from "./dredge";
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
  /** memo of finished characteristics + `while` results, alive only during one outermost computeChars / withCharsEpoch (no state changes inside, layers.ts) */
  epoch?: { chars: Map<ObjId, Chars>; whiles: Map<unknown, boolean> };
  /** delayed triggers created during this run -> number of events emitted before (those cannot fire them) */
  dtBorn?: Record<string, number>;
  /** a cast / land play that happens DURING the resolution of an ability ("you may play the exiled card"): timing restrictions are ignored (608.2g) */
  ignoreTiming?: boolean;
  /** cards the resolving ability lets its controller cast / play right after it finishes resolving (permission_to_play with no duration) */
  castNow?: Array<{ player: PlayerId; id: ObjId; ts: number; withoutPaying: boolean; /** "if you don't, put it into your hand": a cast that cannot be made moves the card there */ elseToHand?: boolean; /** cast with this option id (miracle) */ option?: string }>;
  /** a miracle cast is in progress: the miracle option may be chosen */
  castingMiracle?: boolean;
  /** replacement effects currently applying (their nested steps must not re-apply them), as "<source>:<ability>" */
  activeRepl?: string[];
  /** continue mode: `unresolved` events already emitted during this run (one per card + ability + capability + clause) */
  unresolvedRun?: Set<string>;
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
/**
 * Late-bound continue-mode hooks (set by resolve.ts; core.ts cannot import unresolved.ts without an import cycle). blocked(r, a): this ability's frame
 * (trigger / static / replacement / targets ...) is unsupported, so it is left out of every read; optionBlocked: same for a cast option.
 */
export const continueHooks: {
  blocked?: (r: Run, a: Ability) => boolean;
  optionBlocked?: (r: Run, c: import("../schema").CastOption) => boolean;
  /** any ability whose frame is unsupported (also activated / mana ones, which stay visible but are never used by automatic payment) */
  unusable?: (a: Ability) => boolean;
  /** the effects index was (re)built: report unsupported continuous abilities of this object once */
  continuous?: (r: Run, id: ObjId) => void;
  /** what ONE step needs that the engine lacks (memoized) and the report of a skipped step */
  stepNeeds?: (s: import("../schema").Step) => string[];
  stepSkipped?: (r: Run, source: ObjId, abilityId: string, step: import("../schema").Step, needs: string[]) => void;
} = {};
/** set by resolve.ts: the legal targets of a target spec (copy.ts uses it to let the controller of a copy choose new targets) */
export const targetHooks: { candidates?: (r: Run, spec: unknown, q: unknown, self?: ObjId) => string[] } = {};
/** continue mode: unsupported things are reported (`unresolved` events) and skipped instead of refusing the action */
export const continuing = (r: Run): boolean => r.s.config.onUnsupported === "continue";

/** Printed abilities exactly as the card / token data lists them (continue mode: including the ones the engine cannot run). */
export function rawPrintedAbilities(r: Run, o: GameObject): Ability[] {
  if (o.token || o.copyDef) return tokenAbilities((o.copyDef ?? o.token)!);
  const def = defOf(r, o)!;
  if (isRoomOnBattlefield(def, o)) { const open = o.unlocked ?? []; return withKeywordExtras(def.kernel.abilities.filter((a) => !a.face || open.includes(a.face))); } // Rooms (CR 709.5): only the unlocked doors' abilities exist
  const cur = currentFace(def, o);
  return withKeywordExtras(cur === undefined ? def.kernel.abilities : def.kernel.abilities.filter((a) => !a.face || a.face === cur));
}
/** Printed abilities: card JSON, or a token's own abilities + keyword abilities. Zone-agnostic; see abilitiesOf for the effective list. Continue mode leaves out the ones whose frame is unsupported. */
export function printedAbilities(r: Run, o: GameObject): Ability[] {
  const all = rawPrintedAbilities(r, o);
  const blocked = continueHooks.blocked;
  return blocked && continuing(r) ? all.filter((a) => !blocked(r, a)) : all;
}

// ---------------------------------------------------------------- faces (double-faced / modal / split cards)

/** Face names of a card: the distinct `face` values of its abilities, front first. Empty for single-faced cards. */
export function faceNames(def: CardDef): string[] {
  const out: string[] = [];
  for (const a of def.kernel.abilities) if (a.face && !out.includes(a.face)) out.push(a.face);
  return out;
}
/** A Room permanent: its characteristics come from the doors that are unlocked (CR 709.4), not from one chosen face. */
export function isRoomOnBattlefield(def: CardDef, o: GameObject): boolean { return def.layout === "room" && o.zone === "battlefield" && faceNames(def).length >= 2; }
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
  return withKeywordExtras(tokenAbilitiesRaw(t));
}
function tokenAbilitiesRaw(t: TokenDef): Ability[] {
  const kw = t.keywords.map((k): Ability => ({ id: "k:" + k.toLowerCase(), kind: "keyword", text: k, keyword: { name: k.toLowerCase() } }));
  return [...kw, ...(t.abilities ?? [])];
}
/** Effective abilities: on the battlefield what layer 6 leaves (a stripped permanent has none), elsewhere the printed ones. */
/** a face-down permanent has no abilities of its own; turning a morph creature face up is the special action turnFaceUp (resolve.ts), which pays this cost */
export function morphCostOf(r: Run, o: GameObject): string | undefined {
  if (!o.faceDown || o.zone !== "battlefield" || o.token || o.copyDef) return undefined;
  const mk = rawPrintedAbilities(r, o).find((a) => a.kind === "keyword" && a.keyword?.name.toLowerCase() === "morph");
  return typeof mk?.keyword?.param === "string" ? mk.keyword.param : undefined;
}
export function abilitiesOf(r: Run, o: GameObject): Ability[] {
  if (o.faceDown && o.zone === "battlefield") return baseChars(r, o).abilities;
  if (o.zone === "battlefield" && layerSixActive(r)) return chars(r, o.id).abilities;
  if (o.leftWith && (o.zone === "graveyard" || o.zone === "exile")) return [...printedAbilities(r, o), ...o.leftWith];
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
  if (o.faceDown && o.zone === "battlefield") return { name: "", types: ["creature"], subtypes: [], supertypes: [], colors: [], mv: 0, power: 2, toughness: 2, keywords: [], abilities: [] };
  if (o.token || o.copyDef) {
    const t = (o.copyDef ?? o.token)!;
    return { name: t.name, types: lc(t.types), subtypes: [...t.subtypes], supertypes: lc(t.supertypes), colors: [...t.colors], mv: parseManaCost(t.manaCost).mv, power: t.power, toughness: t.toughness, keywords: lc(t.keywords), abilities: tokenAbilities(t) };
  }
  const d = defOf(r, o)!;
  if (isRoomOnBattlefield(d, o)) return roomChars(r, o, d);
  const m = faceMeta(d, o);
  const abilities = printedAbilities(r, o);
  const pc = parseManaCost(m.manaCost);
  const colors = m.colors ?? [...new Set(pc.symbolColors ?? [])].filter((c) => c !== "C");
  const keywords = abilities.filter((a) => a.kind === "keyword" && a.keyword).map((a) => a.keyword!.name.toLowerCase().replace(/_/g, " "));
  return { name: currentFace(d, o) ?? d.name, types: lc(m.types), subtypes: [...(m.subtypes ?? [])], supertypes: lc(m.supertypes), colors: [...colors], mv: pc.mv, power: m.power, toughness: m.toughness, keywords, abilities };
}

/**
 * A Room on the battlefield (CR 709.4): it is an enchantment Room whatever its doors; name, mana cost, colors and abilities are those of the UNLOCKED
 * doors only (one door open: that half; both open: both halves, mana values added). With both doors locked it has no name (CR 709.5), no abilities, no colors, mana value 0.
 */
function roomChars(r: Run, o: GameObject, d: CardDef): Chars {
  const names = faceNames(d);
  const open = names.filter((n) => (o.unlocked ?? []).includes(n));
  const metaOf = (n: string) => (n === names[0] ? d : d.faces?.[n] ?? d);
  const abilities = printedAbilities(r, o);
  const front = metaOf(names[0]);
  let mv = 0; const colors = new Set<string>();
  for (const n of open) { const pc = parseManaCost(metaOf(n).manaCost); mv += pc.mv; for (const c of metaOf(n).colors ?? pc.symbolColors ?? []) if (c !== "C") colors.add(c); }
  return {
    name: open.length === 0 ? "" : open.length === 1 ? open[0] : names.join(" // "), types: lc(front.types), subtypes: [...new Set([...(front.subtypes ?? []), ...names.flatMap((n) => metaOf(n).subtypes ?? [])])],
    supertypes: lc(front.supertypes), colors: [...colors], mv, power: undefined, toughness: undefined,
    keywords: abilities.filter((a) => a.kind === "keyword" && a.keyword).map((a) => a.keyword!.name.toLowerCase().replace(/_/g, " ")), abilities
  };
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
  return { controller: o.controller, owner: o.owner, name: c.name, types: c.types, subtypes: c.subtypes, colors: c.colors, mv: c.mv, power: c.power, toughness: c.toughness, token: !!o.token, ...((o.token ?? o.copyDef) ? { copyDef: structuredClone((o.copyDef ?? o.token)!) } : {}), counters: { ...o.counters }, ...(o.attachedTo ? { attachedTo: o.attachedTo } : {}) };
}

// ---------------------------------------------------------------- zones

export function zoneList(r: Run, owner: PlayerId, zone: Zone): ObjId[] {
  if (zone === "battlefield") return r.s.battlefield;
  if (zone === "stack") return r.s.stack.map((i) => i.objectId).filter((x): x is string => !!x);
  return player(r, owner)[zone as "library" | "hand" | "graveyard" | "exile" | "command"];
}

export interface MoveOpts { /** battlefield only: enters face down (manifest): a 2/2 colorless creature with no name or abilities */ faceDown?: boolean; /** battlefield only: enters showing this face ("transformed") */ face?: string; position?: "top" | "bottom"; controller?: PlayerId; tapped?: boolean; /** enters with these counters (battlefield only) */ counters?: Record<string, number> }

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
  // abilities a static effect had GIVEN it (Mikaeus: undying) are part of its last-known information: its dies / leaves triggers still use them
  o.leftWith = from === "battlefield" && !o.token ? chars(r, id).abilities.filter((a) => a.id.startsWith("g:") || a.id.startsWith("ga:") || a.id.startsWith("kw:")) : undefined;
  if (o.leftWith && !o.leftWith.length) o.leftWith = undefined;
  if (from === "battlefield" && layerSixActive(r)) { const eff = new Set(chars(r, id).abilities.map((a) => a.id)); const lost = printedAbilities(r, o).filter((a) => !eff.has(a.id)).map((a) => a.id); o.leftLost = lost.length ? lost : undefined; }
  else o.leftLost = undefined;
  if (from === "battlefield") { o.tapped = false; o.counters = {}; o.damage = 0; o.dtHit = undefined; o.controller = o.owner; o.attachedTo = undefined; o.attachedToTs = undefined; o.attachedPlayer = undefined; o.copyDef = undefined; o.copyUntilEot = undefined; r.s.effects = r.s.effects.filter((e) => e.objectId !== id); }
  // abilities gained by a resolved effect (Rivaz of the Claw): a spell keeps them as the permanent it becomes, any other move ends them
  const kept = from === "stack" && to === "battlefield";
  if (!kept && from === "stack") r.s.effects = r.s.effects.filter((e) => e.objectId !== id);
  o.zone = to;
  o.exileInstead = undefined;
  o.faceDown = undefined; o.prepared = undefined; o.auraTarget = undefined;
  o.commanderDeclined = undefined;
  if (to !== "battlefield" && to !== "stack") o.face = undefined; // a card in any other zone shows its front face
  if (from === "battlefield" && to === "battlefield") o.face = undefined;
  if (to === "battlefield" && opts.face) o.face = opts.face;
  // Rooms (CR 709.5): a Room that resolves as a spell enters with the door of the half that was cast unlocked; entering any other way (Redress Fate, reanimation, flicker) both doors are locked
  o.unlocked = to === "battlefield" && from === "stack" && defOf(r, o)?.layout === "room" && o.face ? [o.face] : undefined;
  if (to === "battlefield" && opts.faceDown) o.faceDown = true;
  if (!(from === "stack" && to === "battlefield")) o.cast = undefined;
  o.timestamp = tick(r);
  if (kept) for (const e of r.s.effects) if (e.objectId === id) e.objectTimestamp = o.timestamp;
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
    if (o.unlocked?.length) emit(r, { type: "door_unlocked", id, player: o.controller, face: o.unlocked[0], fully: false }); // the cast half's door unlocks as the Room enters
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
    if (offerDredge(r, pid)) continue; // dredge (dredge.ts)
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

/** Fear of Sleep Paralysis: stun counters can't be removed from permanents ITS controller's opponents control. */
export function stunLocked(r: Run, o: GameObject): boolean {
  return r.s.battlefield.some((id) => { const x = r.s.objects[id]; return !!x && x.controller !== o.controller && abilitiesOf(r, x).some((a) => a.scripted?.handler === "stun_counters_cant_be_removed_from_opponent_permanents"); });
}

/**
 * Untapping a permanent (CR 122.1g): if it has a stun counter, a stun counter is removed from it INSTEAD and it stays tapped (and when stun counters
 * can't be removed from it, nothing happens). Returns true when it really untapped.
 */
export function untapObject(r: Run, o: GameObject): boolean {
  if (!o.tapped) return false;
  if ((o.counters.stun ?? 0) > 0) {
    if (stunLocked(r, o)) return false;
    o.counters.stun -= 1;
    if (o.counters.stun === 0) delete o.counters.stun;
    emit(r, { type: "counter_removed", id: o.id, kind: "stun", amount: 1 });
    return false;
  }
  o.tapped = false;
  emit(r, { type: "untap", id: o.id });
  return true;
}
