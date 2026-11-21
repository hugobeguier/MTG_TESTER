// Per-unit mana (kernel step 7). Plain mana stays in `PlayerState.manaPool` (counts per color); mana with a spending restriction, a rider
// or a duration is a ManaUnit in `PlayerState.manaUnits`:
//   - restriction: an object filter the SPELL it pays for must match ("only to cast Dragon spells"); `{zone:"stack"}` = any spell
//   - abilities: an object filter for the SOURCE of an activated ability it may also pay for ("or activate abilities of Dragons")
//   - keep: "you don't lose this mana as steps and phases end" until the end of the turn
//   - rider: steps queued as a triggered ability when the mana is spent on a spell ("when you spend this mana to cast a spell, ...")
// Spending validates the restriction against what is being paid for (a SpendCtx); units that do not fit are simply not available.
// Units empty with the pool at the end of every step / phase unless `keep`; `keep` units die at cleanup.

import type { ObjectFilter, Step } from "../schema";
import { chars, emit, player, tryObj, type Run } from "./core";
import { matchesFilter } from "./query";
import type { ManaColor, ManaPool, ObjId, PlayerId, QueuedTrigger } from "./types";
import { MANA_COLORS } from "./types";

export interface ManaUnit {
  color: ManaColor;
  restriction?: ObjectFilter;
  abilities?: ObjectFilter;
  keep?: boolean;
  rider?: Step[];
  source?: ObjId;
}

/** What mana is being spent on: a spell (its stack object) or an activated ability (its source). `spent` collects the colors used. */
export interface SpendCtx {
  spell?: ObjId;
  abilitySource?: ObjId;
  spent: ManaColor[];
  /** riders of the units spent (queued by `flushRiders`) */
  riders?: Array<{ steps: Step[]; source?: ObjId }>;
}

export const unitsOf = (r: Run, pid: PlayerId): ManaUnit[] => (player(r, pid).manaUnits ??= []);

export function addUnits(r: Run, pid: PlayerId, colors: ManaColor[], props: Omit<ManaUnit, "color">, source?: ObjId): void {
  const u = unitsOf(r, pid);
  for (const color of colors) u.push({ color, ...structuredClone(props), ...(source ? { source } : {}) });
  emit(r, { type: "mana_added", player: pid, colors, source, restricted: !!(props.restriction || props.abilities), kept: !!props.keep });
}

/** May this unit pay for what `ctx` describes? A unit without restrictions can pay for anything. */
export function unitFits(r: Run, pid: PlayerId, u: ManaUnit, ctx: SpendCtx | undefined): boolean {
  if (!u.restriction && !u.abilities) return true;
  if (!ctx) return false;
  if (ctx.spell) {
    if (!u.restriction) return false; // restricted to abilities only
    const { zone, ...rest } = u.restriction;
    void zone;
    return !tryObj(r, ctx.spell) ? false : !Object.keys(rest).length || matchesFilter(r, ctx.spell, rest as ObjectFilter, { controller: pid, source: ctx.spell });
  }
  if (ctx.abilitySource) {
    if (!u.abilities) return false;
    return !!tryObj(r, ctx.abilitySource) && matchesFilter(r, ctx.abilitySource, u.abilities, { controller: pid, source: ctx.abilitySource });
  }
  return false;
}

/** Plain pool + the units that fit, as one pool (what a payment can draw on). */
export function effectivePool(r: Run, pid: PlayerId, ctx?: SpendCtx): ManaPool {
  const p = player(r, pid);
  const out: ManaPool = { ...p.manaPool };
  for (const u of unitsOf(r, pid)) if (unitFits(r, pid, u, ctx)) out[u.color]++;
  return out;
}

/** Take `n` mana of `color` for a payment: units first (restricted / lasting mana would otherwise be wasted), then the plain pool. */
export function takeMana(r: Run, pid: PlayerId, color: ManaColor, ctx: SpendCtx | undefined): boolean {
  const p = player(r, pid);
  const units = unitsOf(r, pid);
  // restricted units first, then lasting ones, then any unrestricted unit, then the plain pool
  const rank = (u: ManaUnit) => (u.restriction || u.abilities ? 0 : u.keep ? 1 : 2);
  const idx = units.map((u, i) => ({ u, i })).filter((x) => x.u.color === color && unitFits(r, pid, x.u, ctx)).sort((a, b) => rank(a.u) - rank(b.u) || a.i - b.i)[0];
  if (idx && rank(idx.u) < 2) {
    units.splice(idx.i, 1);
    ctx?.spent.push(color);
    if (idx.u.rider) (ctx!.riders ??= []).push({ steps: idx.u.rider, source: idx.u.source });
    return true;
  }
  if (p.manaPool[color] > 0) { p.manaPool[color]--; ctx?.spent.push(color); return true; }
  if (idx) { units.splice(idx.i, 1); ctx?.spent.push(color); if (idx.u.rider) (ctx!.riders ??= []).push({ steps: idx.u.rider, source: idx.u.source }); return true; }
  return false;
}

/** Queue the riders of mana spent on a spell as triggered abilities (they go on the stack above the spell). */
export function flushRiders(r: Run, pid: PlayerId, ctx: SpendCtx): void {
  for (const rd of ctx.riders ?? []) {
    const q: QueuedTrigger = {
      id: `rd${r.s.nextId++}`, sourceId: rd.source ?? ctx.spell ?? "", abilityId: "__rider", controller: pid,
      ctx: { eventObj: ctx.spell }, label: "mana rider", delayed: { steps: rd.steps, targets: {} }
    };
    r.s.triggerQueue.push(q);
  }
  ctx.riders = [];
}

/** Mana empties at the end of every step / phase (`all` = cleanup: lasting mana goes too). */
export function emptyPools(r: Run, all: boolean): void {
  for (const p of r.s.players) {
    const keepRed = !all && keepsRed(r, p.id) ? p.manaPool.R : 0;
    p.manaPool = { W: 0, U: 0, B: 0, R: keepRed, G: 0, C: 0 };
    p.manaUnits = (p.manaUnits ?? []).filter((u) => u.keep && !all);
  }
}

import { playerHas } from "./layers";
const keepsRed = (r: Run, pid: PlayerId): boolean => playerHas(r, pid, "keep_unspent_red_mana_between_steps_and_phases");

export const poolSize = (r: Run, pid: PlayerId): number => MANA_COLORS.reduce((n, c) => n + player(r, pid).manaPool[c], 0) + unitsOf(r, pid).length;
void chars;
