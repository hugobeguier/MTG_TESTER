// The layer system: ONE pipeline for static abilities and timestamped temporary effects. `computeChars` (reached through
// core.chars) takes an object's copiable characteristics and applies, in layer order:
//   4 types (addTypes / setTypes)         5 colors (setColors)
//   6 abilities (grant / lose; a "loses all abilities" effect removes abilities from EARLIER timestamps only)
//   7a characteristic-defining P/T        7b base-setting P/T (later timestamp wins)
//   7c +N/+N effects, then counters       (7c is commutative, so timestamps do not matter there)
// Layers 1-3 (copy, control, text) have no vocabulary in the schema yet and are skipped.
//
// Each static ability is (re)evaluated at the moment its layer is applied, against the object's PARTIAL characteristics
// (reads through chars() of an object being computed return that partial result, see Run.busy), so "creatures you
// control" sees an enchantment a lower layer turned into a creature, and a quantity like "artifacts you control" cannot recurse forever.
// Dependencies (613.8) are approximated by that fixed order: effects of layers 4-6 keep applying even if their source
// loses its abilities later (613.6); an effect of layer 7 is dropped when its source no longer has the static ability.

import { withKeywordExtras } from "./keywords8";
import type { Ability, Cost, ObjectFilter, Quantity, StaticSpec } from "../schema";
import { baseChars, continueHooks, continuing, obj, printedAbilities, tryObj, Unsupported, type Chars, type Run } from "./core";
import { evalPredicate, evalQuantity, matchesFilter, objectsMatching, resolveObjs } from "./query";
import type { ContinuousEffect, GameObject, ObjId, PlayerId } from "./types";

export interface StaticSrc { id: ObjId; ability: Ability; spec: StaticSpec; ts: number; controller: PlayerId }
export interface ReplSrc { id: ObjId; ability: Ability; ts: number; controller: PlayerId }
export interface Idx { statics: StaticSrc[]; repls: ReplSrc[]; l6: boolean }
type Modify = StaticSpec["modify"][number];

const CARD_TYPES = new Set(["artifact", "creature", "enchantment", "land", "planeswalker", "instant", "sorcery", "battle", "kindred", "tribal"]);
const BASIC_LAND_MANA: Record<string, string> = { plains: "{W}", island: "{U}", swamp: "{B}", mountain: "{R}", forest: "{G}" };

// ---------------------------------------------------------------- source index

/** Static / replacement sources currently in play. Rebuilt lazily; moveObject drops it on every zone change. */
export function getIndex(r: Run): Idx {
  if (r.idx) return r.idx;
  const statics: StaticSrc[] = [];
  const repls: ReplSrc[] = [];
  let l6 = false;
  const consider = (o: GameObject) => {
    if (continuing(r)) continueHooks.continuous?.(r, o.id); // unsupported statics / replacements / triggers of this permanent: reported once, ignored
    for (const a of printedAbilities(r, o)) {
      if ((a.zone ?? "battlefield") !== o.zone) continue;
      if (a.kind === "static" && a.static) {
        statics.push({ id: o.id, ability: a, spec: a.static, ts: o.timestamp, controller: o.controller });
        if (a.static.modify.some((m) => "grant" in m || "lose" in m || "addTypes" in m || "setTypes" in m || "grantAbility" in m)) l6 = true;
      } else if (a.kind === "replacement" && a.replacement) repls.push({ id: o.id, ability: a, ts: o.timestamp, controller: o.controller });
    }
  };
  for (const id of r.s.battlefield) { const o = r.s.objects[id]; if (o) consider(o); }
  for (const p of r.s.players) for (const id of [...p.graveyard, ...p.command]) { const o = r.s.objects[id]; if (o) consider(o); }
  for (const it of r.s.stack) { const o = it.objectId ? r.s.objects[it.objectId] : undefined; if (o) consider(o); } // "this spell can't be countered": statics that work on the stack
  return (r.idx = { statics, repls, l6 });
}
export function invalidateIndex(r: Run): void { r.idx = undefined; }

/** True when some effect can change abilities (so battlefield abilities must be read through chars()). */
export function layerSixActive(r: Run): boolean {
  return getIndex(r).l6 || r.s.effects.some((e) => e.grant !== undefined || e.lose !== undefined || e.addTypes !== undefined);
}

// ---------------------------------------------------------------- attachment

/** The object `o` is attached to, if that is still valid (same object, still on the battlefield). */
export function hostOf(r: Run, o: GameObject): GameObject | undefined {
  if (!o.attachedTo) return undefined;
  const h = r.s.objects[o.attachedTo];
  return h && h.zone === "battlefield" && h.timestamp === o.attachedToTs ? h : undefined;
}

// ---------------------------------------------------------------- applying one static to one object

const qctx = (s: StaticSrc) => ({ controller: s.controller, source: s.id });

function affectsObject(r: Run, s: StaticSrc, id: ObjId): boolean {
  const a = s.spec.affects;
  if (typeof a === "string") {
    switch (a) {
      case "self": return s.id === id;
      case "enchanted":
      case "equipped": { const so = tryObj(r, s.id); const h = so && hostOf(r, so); return !!h && h.id === id; }
      case "you": case "each_player": case "each_opponent": case "opponent": case "target_player": case "that_player":
      case "controller_of_target": case "owner_of_target":
        return false; // affects players, not objects (costMod / extraLandDrops are read through their own queries)
      default: throw new Unsupported(`static:affects:${a}`);
    }
  }
  const f = a as ObjectFilter;
  const o = tryObj(r, id);
  if (!o) return false;
  if (!f.zone && o.zone !== "battlefield") return false; // statics default to permanents
  return matchesFilter(r, id, f, qctx(s));
}

function sourceIntact(r: Run, s: StaticSrc): boolean {
  if (!layerSixActive(r)) return true;
  const so = tryObj(r, s.id);
  if (!so) return false;
  if (so.zone !== "battlefield") return true; // graveyard / command statics are not subject to battlefield ability removal
  return abilitiesIncludes(r, s.id, s.ability);
}
function abilitiesIncludes(r: Run, id: ObjId, a: Ability): boolean {
  // by id, not identity: a host lookup may hand out a fresh copy of the card definition on every call
  return computeChars(r, id).abilities.some((x) => x === a || (x.id === a.id && x.kind === a.kind));
}

function whileOk(r: Run, s: StaticSrc, memo: Map<StaticSrc, boolean>): boolean {
  if (!s.spec.while) return true;
  let v = memo.get(s);
  if (v === undefined) { v = evalPredicate(r, s.spec.while, qctx(s)); memo.set(s, v); }
  return v;
}

function addType(c: Chars, name: string): void {
  const l = name.toLowerCase();
  if (CARD_TYPES.has(l)) { if (!c.types.includes(l)) c.types.push(l); }
  else if (!c.subtypes.some((x) => x.toLowerCase() === l)) c.subtypes.push(name);
}
function setTypes(c: Chars, names: string[]): void {
  c.types = []; c.subtypes = [];
  for (const n of names) addType(c, n);
}
const keywordAbility = (name: string): Ability => ({ id: "g:" + name, kind: "keyword", text: name, keyword: { name } });
function grantKeyword(c: Chars, name: string): void {
  const l = name.toLowerCase();
  if (!c.abilities.some((a) => a.kind === "keyword" && a.keyword?.name.toLowerCase() === l)) c.abilities = withKeywordExtras([...c.abilities, keywordAbility(l)]);
}
/** "lose: creature" = "isn't a creature" (Athreos, Shroud-Veiled; Theros gods): a type change in layer 4, not an ability loss */
const losesType = (what: string): boolean => CARD_TYPES.has(what.toLowerCase());
function loseAbilities(c: Chars, what: string): void {
  const l = what.toLowerCase();
  if (losesType(l)) { c.types = c.types.filter((t) => t !== l); return; }
  if (l === "all abilities" || l === "all") c.abilities = [];
  else c.abilities = c.abilities.filter((a) => !(a.kind === "keyword" && a.keyword?.name.toLowerCase() === l) && a.id !== "kw:" + l);
}

interface Item { layer: number; ts: number; seq: number; run: () => void }
// layer numbers: 4 types, 5 colors, 6 abilities, 7.1 CDA, 7.2 base P/T, 7.3 pump
const L = { types: 4, colors: 5, abilities: 6, cda: 7.1, base: 7.2, pump: 7.3 };

/** Which layer one StaticSpec modifier belongs to (null = not a characteristic: handled by other queries). */
function layerOf(m: Modify, spec: StaticSpec): number | null {
  if ("addTypes" in m || "setTypes" in m || "copySubtypesOf" in m || "addChosenType" in m) return L.types;
  if ("setColors" in m) return L.colors;
  if ("lose" in m && losesType(m.lose)) return L.types;
  if ("grant" in m || "lose" in m || "grantAbility" in m) return L.abilities;
  if ("setBasePT" in m) return spec.affects === "self" && !spec.while && (typeof m.setBasePT.power !== "number" || typeof m.setBasePT.toughness !== "number") ? L.cda : L.base;
  if ("pt" in m) return L.pump;
  return null;
}

function applyModify(r: Run, s: StaticSrc, m: Modify, c: Chars): void {
  const q = qctx(s);
  if ("addTypes" in m) m.addTypes.forEach((t) => addType(c, t));
  else if ("addChosenType" in m) { const ch = tryObj(r, s.id)?.chosen?.type; if (ch) addType(c, ch); } // Metallic Mimic: the type its controller chose as it entered
  else if ("setTypes" in m) setTypes(c, m.setTypes);
  else if ("copySubtypesOf" in m) {
    // Duplicant: the creature types of the LAST card exiled with it replace its own ("It's still a Shapeshifter": that type stays)
    const from = resolveObjs(r, String(m.copySubtypesOf), q).map((id) => tryObj(r, id)).filter((x): x is GameObject => !!x).pop();
    if (from) { const keep = c.subtypes.filter((t) => t.toLowerCase() === "shapeshifter"); c.subtypes = [...keep]; for (const t of baseChars(r, from).subtypes) if (!c.subtypes.includes(t)) c.subtypes.push(t); }
  }
  else if ("setColors" in m) c.colors = [...m.setColors];
  else if ("grant" in m) grantKeyword(c, m.grant);
  else if ("grantAbility" in m) { const ga = m.grantAbility as Ability; const gid = `ga:${s.id}:${ga.id ?? "x"}`; if (!c.abilities.some((x) => x.id === gid)) c.abilities = [...c.abilities, { ...ga, id: gid }]; }
  else if ("lose" in m) loseAbilities(c, m.lose);
  else if ("setBasePT" in m) { c.power = evalQuantity(r, m.setBasePT.power, q); c.toughness = evalQuantity(r, m.setBasePT.toughness, q); }
  else if ("pt" in m) {
    const p = evalQuantity(r, m.pt.power, q), t = evalQuantity(r, m.pt.toughness, q);
    if (c.power !== undefined) c.power += p;
    if (c.toughness !== undefined) c.toughness += t;
  }
}

function effectItems(e: ContinuousEffect, c: Chars, seq: () => number): Item[] {
  const out: Item[] = [];
  const add = (layer: number, run: () => void) => out.push({ layer, ts: e.timestamp, seq: seq(), run });
  if (e.addTypes) add(L.types, () => e.addTypes!.forEach((t) => addType(c, t)));
  if (e.setColors) add(L.colors, () => { c.colors = [...e.setColors!]; });
  if (e.grant) add(L.abilities, () => grantKeyword(c, e.grant!));
  if (e.lose) add(L.abilities, () => loseAbilities(c, e.lose!));
  if (e.base) add(L.base, () => { c.power = e.base!.power; c.toughness = e.base!.toughness; });
  if (e.power !== undefined || e.toughness !== undefined) add(L.pump, () => { if (c.power !== undefined) c.power += e.power ?? 0; if (c.toughness !== undefined) c.toughness += e.toughness ?? 0; });
  return out;
}

/** Intrinsic mana ability of a basic land type the object has (a Swamp taps for {B}); added at the start of layer 6. */
function landTypeAbilities(c: Chars): Ability[] {
  const out: Ability[] = [];
  for (const st of c.subtypes) {
    const sym = BASIC_LAND_MANA[st.toLowerCase()];
    if (!sym || !c.types.includes("land")) continue;
    const has = c.abilities.some((a) => a.kind === "mana" && a.mana?.produces.some((p) => "colors" in p && p.colors.includes(sym)));
    if (!has) out.push({ id: "land:" + st.toLowerCase(), kind: "mana", text: `{T}: Add ${sym}.`, costs: [{ tap: "self" } as Cost], mana: { produces: [{ colors: sym }] } });
  }
  return out;
}

function applyLayers(r: Run, o: GameObject, c: Chars, idx: Idx, effects: ContinuousEffect[]): void {
  let n = 0;
  const seq = () => n++;
  const memo = (r.epoch?.whiles ?? new Map()) as Map<StaticSrc, boolean>;
  const items: Item[] = [];
  for (const s of idx.statics) {
    for (const m of s.spec.modify) {
      const layer = layerOf(m, s.spec);
      if (layer === null) continue;
      items.push({
        layer, ts: s.ts, seq: seq(), run: () => {
          if (!affectsObject(r, s, o.id) || !whileOk(r, s, memo)) return;
          if (layer >= 7 && !sourceIntact(r, s)) return;
          applyModify(r, s, m, c);
        }
      });
    }
  }
  for (const e of effects) items.push(...effectItems(e, c, seq));
  items.sort((a, b) => a.layer - b.layer || a.ts - b.ts || a.seq - b.seq);
  let landDone = false;
  for (const it of items) {
    if (!landDone && it.layer >= L.abilities) { landDone = true; c.abilities = [...landTypeAbilities(c), ...c.abilities]; }
    it.run();
  }
  if (!landDone) c.abilities = [...landTypeAbilities(c), ...c.abilities];
}

function applyCounters(c: Chars, o: GameObject): void {
  const d = (o.counters["+1/+1"] ?? 0) - (o.counters["-1/-1"] ?? 0);
  if (c.power !== undefined) c.power += d;
  if (c.toughness !== undefined) c.toughness += d;
}

/** Run fn with a shared characteristics memo: no state changes may happen inside (pure reads), so a nested chars() of the same object is computed once. */
export function withCharsEpoch<T>(r: Run, fn: () => T): T {
  if (r.epoch) return fn();
  r.epoch = { chars: new Map(), whiles: new Map() };
  try { return fn(); } finally { r.epoch = undefined; }
}

export function computeChars(r: Run, id: ObjId): Chars {
  if (!r.epoch) return withCharsEpoch(r, () => computeChars0(r, id));
  const hit = r.epoch.chars.get(id);
  if (hit && !r.busy?.has(id)) return hit;
  const c = computeChars0(r, id);
  if (!r.busy?.has(id)) r.epoch.chars.set(id, c);
  return c;
}
function computeChars0(r: Run, id: ObjId): Chars {
  const busy = (r.busy ??= new Map());
  const partial = busy.get(id);
  if (partial) return partial;
  const o = obj(r, id);
  const c = baseChars(r, o);
  const idx = getIndex(r);
  const effects = r.s.effects.filter((e) => e.objectId === id && e.objectTimestamp === o.timestamp);
  if (idx.statics.length || effects.length) {
    busy.set(id, c);
    try { applyLayers(r, o, c, idx, effects); } finally { busy.delete(id); }
  }
  applyCounters(c, o);
  c.keywords = [...new Set(c.abilities.filter((a) => a.kind === "keyword" && a.keyword).map((a) => a.keyword!.name.toLowerCase().replace(/_/g, " ")))];
  return c;
}

// ---------------------------------------------------------------- restrictions (read by combat checks) and costs

export type Restriction =
  | { kind: "cant"; what: string; except?: ObjectFilter; protects?: string; source: ObjId }
  | { kind: "mustAttack"; source: ObjId }
  | { kind: "attackTax" | "blockTax"; cost: string; protects?: string; source: ObjId }
  | { kind: "evasion"; source: ObjId; cantBeBlockedBy?: ObjectFilter; unlessDefenderControls?: ObjectFilter };

/** Restrictions static abilities currently put on this object (can't attack/block, attacks each combat, taxes, evasion). */
export function restrictionsOf(r: Run, id: ObjId): Restriction[] {
  const out: Restriction[] = [];
  const memo = new Map<StaticSrc, boolean>();
  for (const s of getIndex(r).statics) {
    const mods = s.spec.modify.filter((m) => "cant" in m || "mustAttack" in m || "attackTax" in m || "blockTax" in m || "evasion" in m);
    if (!mods.length) continue;
    if (!affectsObject(r, s, id) || !whileOk(r, s, memo) || !sourceIntact(r, s)) continue;
    for (const m of mods) {
      if ("cant" in m) out.push({ kind: "cant", what: m.cant, except: m.except, protects: m.protects, source: s.id });
      else if ("mustAttack" in m) out.push({ kind: "mustAttack", source: s.id });
      else if ("attackTax" in m) out.push({ kind: "attackTax", cost: m.attackTax.cost === "{X}" && s.ability.scripted?.params && "x" in (s.ability.scripted.params as object) ? `{${evalQuantity(r, (s.ability.scripted.params as { x: never }).x, qctx(s))}}` : m.attackTax.cost, /* Sphere of Safety: {X} with X from the scripted params, read now */ protects: m.attackTax.protects, source: s.id });
      else if ("blockTax" in m) out.push({ kind: "blockTax", cost: m.blockTax.cost, source: s.id });
      else if ("evasion" in m) out.push({ kind: "evasion", source: s.id, cantBeBlockedBy: m.evasion.cantBeBlockedBy, unlessDefenderControls: m.evasion.unlessDefenderControls });
    }
  }
  return out;
}
/** Plain "can't attack" (restrictions that only protect a particular defender are the combat step's business). */
export const canAttack = (r: Run, id: ObjId): boolean => !restrictionsOf(r, id).some((x) => x.kind === "cant" && x.what === "attack" && !x.protects);
export const canBlock = (r: Run, id: ObjId): boolean => !restrictionsOf(r, id).some((x) => x.kind === "cant" && x.what === "block");
export const cantBeCountered = (r: Run, id: ObjId): boolean => !!r.s.objects[id]?.castGrants?.includes("cant:be_countered") || restrictionsOf(r, id).some((x) => x.kind === "cant" && x.what === "be_countered");
/** The players who currently goad this creature: controllers of the sources whose statics grant it "goaded". */
export function goadersOf(r: Run, id: ObjId): PlayerId[] {
  const memo = new Map<StaticSrc, boolean>();
  const out: PlayerId[] = [];
  for (const s of getIndex(r).statics) {
    if (!s.spec.modify.some((m) => "grant" in m && m.grant.toLowerCase() === "goaded")) continue;
    if (!affectsObject(r, s, id) || !whileOk(r, s, memo) || !sourceIntact(r, s)) continue;
    if (!out.includes(s.controller)) out.push(s.controller);
  }
  return out;
}
/** Static abilities that give a PLAYER something ("you have hexproof", "you can't lose the game", "no maximum hand size"). */
export function playerHas(r: Run, pid: PlayerId, what: string): boolean {
  const memo = new Map<StaticSrc, boolean>();
  for (const s of getIndex(r).statics) {
    if (!s.spec.modify.some((m) => "grant" in m && m.grant.toLowerCase() === what)) continue;
    const a = s.spec.affects;
    const applies = a === "you" ? pid === s.controller : a === "each_player" ? true : a === "each_opponent" ? pid !== s.controller : false;
    if (applies && whileOk(r, s, memo) && sourceIntact(r, s)) return true;
  }
  return false;
}
/** "Your opponents can't cast spells during your turn": static cant cast on players. */
export function playerCantCast(r: Run, pid: PlayerId): boolean {
  const memo = new Map<StaticSrc, boolean>();
  for (const s of getIndex(r).statics) {
    if (!s.spec.modify.some((m) => "cant" in m && m.cant === "cast")) continue;
    const a = s.spec.affects;
    const applies = a === "you" ? pid === s.controller : a === "each_player" ? true : a === "each_opponent" ? pid !== s.controller : false;
    if (applies && whileOk(r, s, memo) && sourceIntact(r, s)) return true;
  }
  return false;
}
export const mustAttack = (r: Run, id: ObjId): boolean => restrictionsOf(r, id).some((x) => x.kind === "mustAttack");

/** How many land drops a player has per turn (1 + extraLandDrops statics whose source they control). */
export function landDrops(r: Run, pid: PlayerId): number {
  let n = 1;
  const memo = new Map<StaticSrc, boolean>();
  for (const s of getIndex(r).statics) {
    const m = s.spec.modify.find((x) => "extraLandDrops" in x);
    if (!m || !("extraLandDrops" in m) || s.controller !== pid || s.spec.affects !== "you") continue;
    if (!whileOk(r, s, memo) || !sourceIntact(r, s)) continue;
    n += m.extraLandDrops;
  }
  return n;
}

/**
 * Net change to the generic mana of a spell being cast (negative = cheaper): "costMod" statics of permanents (the
 * delta is ADDED: a reduction is negative) plus the spell's own affinity-style `costReduction` keyword abilities.
 */
export function spellCostDelta(r: Run, caster: PlayerId, spellId: ObjId): number {
  let delta = 0;
  const memo = new Map<StaticSrc, boolean>();
  for (const s of getIndex(r).statics) {
    for (const m of s.spec.modify) {
      if (!("costMod" in m)) continue;
      const who = s.spec.affects;
      const applies = who === "you" ? caster === s.controller : who === "each_player" ? true : who === "each_opponent" ? caster !== s.controller : false;
      if (!applies || !whileOk(r, s, memo) || !sourceIntact(r, s)) continue;
      if (!matchesFilter(r, spellId, m.costMod.filter, qctx(s))) continue;
      delta += evalQuantity(r, m.costMod.delta, qctx(s));
    }
  }
  const o = obj(r, spellId);
  for (const a of printedAbilities(r, o)) {
    const cr = a.costReduction;
    if (!cr || (a.zone && a.zone !== "stack") || (a.kind !== "keyword" && a.kind !== "static" && a.kind !== "cast_option")) continue;
    const q = { controller: caster, source: spellId };
    if (cr.condition && !evalPredicate(r, cr.condition, q)) continue;
    const per = cr.per ? objectsMatching(r, cr.per, q).length : 1;
    delta -= evalQuantity(r, cr.amount as Quantity, q) * per;
  }
  return delta;
}

const COLOR_WORDS: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
/**
 * "You may cast artifact spells as though they had flash" (Shimmer Myr, Yeva): a static player grant whose text names the spells ("cast
 * <colors / types> spells as though they had flash"). True when `pid` has such a grant that covers the spell `spellId`.
 */
export function flashGrantCovers(r: Run, pid: PlayerId, spellId: ObjId): boolean {
  // Heliod, the Radiant Dawn (back face): "you may cast spells as though they had flash" (scripted marker)
  for (const id of r.s.battlefield) { const o = r.s.objects[id]; if (o && o.controller === pid && printedAbilities(r, o).some((x) => x.scripted?.handler === "cast_spells_as_though_flash")) return true; }
  const memo = new Map<StaticSrc, boolean>();
  const c = computeChars(r, spellId);
  for (const s of getIndex(r).statics) {
    if (s.spec.affects !== "you" || s.controller !== pid) continue;
    for (const m of s.spec.modify) {
      if (!("grant" in m)) continue;
      const hit = /^cast ([\w ]+?) spells as though they had flash$/i.exec(m.grant.replace(/_/g, " "));
      if (!hit || !whileOk(r, s, memo) || !sourceIntact(r, s)) continue;
      const words = hit[1].toLowerCase().split(" ").filter(Boolean);
      const ok = words.every((w) => (COLOR_WORDS[w] ? c.colors.some((x) => x === COLOR_WORDS[w] || x.toLowerCase() === w) : c.types.includes(w)));
      if (ok) return true;
    }
  }
  return false;
}
