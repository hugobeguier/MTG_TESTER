// Mana: parsing what a mana ability produces, the mana pool, and paying a cost from the pool (optionally tapping
// mana sources first). Mana abilities never use the stack.

import type { Ability, ManaSpec } from "../schema";
import { abilitiesOf, emit, isSummoningSick, parseManaCost, player, poolTotal, Reject, Unsupported, type ParsedCost, type Run, chars } from "./core";
import type { GameObject, ManaColor, ManaPool, ObjId, PlayerId } from "./types";
import { MANA_COLORS } from "./types";

export type Production = { fixed: ManaColor[] } | { choose: { count: number; options: ManaColor[] } };

export function productionOf(r: Run, owner: PlayerId, spec: ManaSpec): Production {
  if ("colors" in spec) {
    if (spec.restriction || spec.abilitiesOf) throw new Unsupported("mana:restriction");
    const syms = [...spec.colors.matchAll(/\{([WUBRGC])\}/g)].map((m) => m[1] as ManaColor);
    if (!syms.length || spec.colors.replace(/\{[WUBRGC]\}/g, "") !== "") throw new Unsupported("mana:symbols", `cannot parse mana "${spec.colors}"`);
    return { fixed: syms };
  }
  if ("anyColor" in spec) {
    if (spec.restriction || spec.abilitiesOf) throw new Unsupported("mana:restriction");
    return { choose: { count: spec.anyColor, options: ["W", "U", "B", "R", "G"] } };
  }
  if ("commanderIdentity" in spec) {
    const id = player(r, owner).colorIdentity.filter((c): c is ManaColor => "WUBRG".includes(c)) as ManaColor[];
    return { choose: { count: spec.commanderIdentity, options: id.length ? id : (["C"] as ManaColor[]) } };
  }
  if ("perCount" in spec) throw new Unsupported("mana:per_count");
  if ("chosenColor" in spec) throw new Unsupported("mana:chosen_color");
  throw new Unsupported("mana:conditional");
}

/** Mana abilities of an object (kind "mana"). */
export const manaAbilities = (r: Run, o: GameObject): Ability[] => abilitiesOf(r, o).filter((a) => a.kind === "mana");

export function addMana(r: Run, pid: PlayerId, colors: ManaColor[], source?: ObjId): void {
  const p = player(r, pid);
  for (const c of colors) p.manaPool[c]++;
  emit(r, { type: "mana_added", player: pid, colors, source });
}

/** Can this permanent's mana ability be activated right now (untapped, not a summoning-sick creature, tap-only cost)? */
export function manaAbilityUsable(r: Run, o: GameObject, a: Ability): boolean {
  if (o.zone !== "battlefield" || a.kind !== "mana") return false;
  const costs = a.costs ?? [];
  if (costs.some((c) => !("tap" in c))) return false;
  if (costs.length && (o.tapped || isSummoningSick(r, o))) return false;
  return true;
}

export interface Need { generic: number; colored: Record<string, number> }

function covers(pool: ManaPool, need: ParsedCost, x: number): boolean {
  const work: ManaPool = { ...pool };
  for (const [c, n] of Object.entries(need.colored)) { if (work[c as ManaColor] < n) return false; work[c as ManaColor] -= n; }
  return poolTotal(work) >= need.generic + need.x * x;
}

/** Spend `need` from the player's pool. Returns false (and spends nothing) if the pool cannot cover it. */
export function payFromPool(r: Run, pid: PlayerId, need: ParsedCost, x: number): boolean {
  const p = player(r, pid);
  if (!covers(p.manaPool, need, x)) return false;
  for (const [c, n] of Object.entries(need.colored)) p.manaPool[c as ManaColor] -= n;
  let generic = need.generic + need.x * x;
  // spend colorless first, then the largest remaining color (deterministic)
  while (generic > 0) {
    const order = [...MANA_COLORS].sort((a, b) => (a === "C" ? -1 : b === "C" ? 1 : p.manaPool[b] - p.manaPool[a]));
    const c = order.find((k) => p.manaPool[k] > 0)!;
    p.manaPool[c]--; generic--;
  }
  return true;
}

/** Tap untapped mana sources (greedy, deterministic) until the pool covers the cost; returns false if impossible. */
export function autoTapFor(r: Run, pid: PlayerId, need: ParsedCost, x: number, only?: ObjId[], exclude: ObjId[] = []): boolean {
  const p = player(r, pid);
  const sources = r.s.battlefield
    .map((id) => r.s.objects[id])
    .filter((o) => o.controller === pid && (!only || only.includes(o.id)) && !exclude.includes(o.id))
    .flatMap((o) => manaAbilities(r, o).filter((a) => manaAbilityUsable(r, o, a)).map((a) => ({ o, a })));
  // single-option sources first so flexible sources stay available for the colors that need them
  const flex = (s: { a: Ability }) => { const m = s.a.mana!.produces[0]; return "colors" in m ? 0 : 1; };
  sources.sort((s1, s2) => flex(s1) - flex(s2) || Number(s1.o.id.slice(1)) - Number(s2.o.id.slice(1)));
  const used = new Set<ObjId>();
  const tapSource = (s: { o: GameObject; a: Ability }, want?: ManaColor): ManaColor[] => {
    used.add(s.o.id);
    const prod = productionOf(r, pid, s.a.mana!.produces[0]);
    const colors = "fixed" in prod ? prod.fixed : Array.from({ length: prod.choose.count }, () => (want && prod.choose.options.includes(want) ? want : prod.choose.options[0]));
    return colors;
  };
  const gained: Array<{ s: { o: GameObject; a: Ability }; colors: ManaColor[] }> = [];
  const poolNow = () => { const w = { ...p.manaPool }; for (const g of gained) for (const c of g.colors) w[c]++; return w; };
  for (const [c, n] of Object.entries(need.colored)) {
    while (poolNow()[c as ManaColor] < n) {
      const s = sources.find((z) => !used.has(z.o.id) && (() => { const pr = productionOf(r, pid, z.a.mana!.produces[0]); return "fixed" in pr ? pr.fixed.includes(c as ManaColor) : pr.choose.options.includes(c as ManaColor); })());
      if (!s) return false;
      gained.push({ s, colors: tapSource(s, c as ManaColor) });
    }
  }
  while (!covers(poolNow(), need, x)) {
    const s = sources.find((z) => !used.has(z.o.id));
    if (!s) return false;
    gained.push({ s, colors: tapSource(s) });
  }
  for (const g of gained) {
    if ((g.s.a.costs ?? []).some((c) => "tap" in c)) { g.s.o.tapped = true; emit(r, { type: "tap", id: g.s.o.id, player: pid }); }
    addMana(r, pid, g.colors, g.s.o.id);
  }
  return true;
}

export function totalPotentialMana(r: Run, pid: PlayerId): number {
  let n = poolTotal(player(r, pid).manaPool);
  for (const id of r.s.battlefield) {
    const o = r.s.objects[id];
    if (o.controller !== pid) continue;
    for (const a of manaAbilities(r, o)) if (manaAbilityUsable(r, o, a)) { try { const pr = productionOf(r, pid, a.mana!.produces[0]); n += "fixed" in pr ? pr.fixed.length : pr.choose.count; } catch { /* unsupported source: not counted */ } break; }
  }
  return n;
}

export function costFromString(cost: string, tax = 0): ParsedCost {
  const c = parseManaCost(cost);
  c.generic += tax; c.mv += tax;
  return c;
}

export function assertAffordable(ok: boolean): void {
  if (!ok) throw new Reject("cannot_pay", "cannot pay the mana cost with the available mana");
}

export { chars };
