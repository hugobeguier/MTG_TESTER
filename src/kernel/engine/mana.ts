// Mana: parsing what a mana ability produces, the mana pool, and paying a cost from the pool (optionally tapping
// mana sources first). Mana abilities never use the stack.

import type { Ability, ManaSpec } from "../schema";
import { abilitiesOf, emit, moveObject, isSummoningSick, parseManaCost, player, poolTotal, Reject, Unsupported, type ParsedCost, type Run, chars } from "./core";
import type { GameObject, ManaColor, ManaPool, ObjId, PlayerId } from "./types";
import { MANA_COLORS } from "./types";
import { effectivePool, takeMana, unitsOf, type SpendCtx } from "./manapool";

/** What a mana ability yields. `props`: spending restrictions / lasting (ManaUnit fields) that make the mana special. `alternatives`: "{W}{W}, {W}{B}, or {B}{B}", the player picks one. */
export type UnitProps = { restriction?: import("../schema").ObjectFilter; abilities?: import("../schema").ObjectFilter; keep?: boolean };
export type Production = ({ fixed: ManaColor[] } | { choose: { count: number; options: ManaColor[] } } | { alternatives: ManaColor[][] }) & { props?: UnitProps };
const propsOf = (spec: { restriction?: import("../schema").ObjectFilter; abilitiesOf?: import("../schema").ObjectFilter }): UnitProps | undefined => (spec.restriction || spec.abilitiesOf ? { ...(spec.restriction ? { restriction: spec.restriction } : {}), ...(spec.abilitiesOf ? { abilities: spec.abilitiesOf } : {}) } : undefined);

export function productionOf(r: Run, owner: PlayerId, spec: ManaSpec): Production {
  if ("colors" in spec) {
    const syms = [...spec.colors.matchAll(/\{([WUBRGC])\}/g)].map((m) => m[1] as ManaColor);
    if (!syms.length || spec.colors.replace(/\{[WUBRGC]\}/g, "") !== "") throw new Unsupported("mana:symbols", `cannot parse mana "${spec.colors}"`);
    return { fixed: syms, ...(propsOf(spec) ? { props: propsOf(spec) } : {}) };
  }
  if ("anyColor" in spec) {
    return { choose: { count: spec.anyColor, options: ["W", "U", "B", "R", "G"] }, ...(propsOf(spec) ? { props: propsOf(spec) } : {}) };
  }
  if ("commanderIdentity" in spec) {
    const id = player(r, owner).colorIdentity.filter((c): c is ManaColor => "WUBRG".includes(c)) as ManaColor[];
    return { choose: { count: spec.commanderIdentity, options: id.length ? id : (["C"] as ManaColor[]) } };
  }
  if ("perCount" in spec) throw new Unsupported("mana:per_count");
  if ("chosenColor" in spec) throw new Unsupported("mana:chosen_color");
  throw new Unsupported("mana:conditional");
}

/**
 * What a whole mana ability produces. Several specs are ALTERNATIVES ("{T}: Add {W} or {B}": dual lands, pain lands, Signets without the
 * filter cost): each must be one fixed mana of one color, and the player chooses which one when activating.
 */
export function productionOfAbility(r: Run, owner: PlayerId, a: Ability): Production {
  const specs = a.mana!.produces;
  if (specs.length === 1) return productionOf(r, owner, specs[0]);
  const options: ManaColor[] = [];
  const prods = specs.map((s) => productionOf(r, owner, s));
  if (prods.some((p) => !("fixed" in p))) throw new Unsupported("mana:multiple_specs");
  if (prods.every((p) => "fixed" in p && p.fixed.length === 1)) {
    for (const p of prods) { const c = (p as { fixed: ManaColor[] }).fixed[0]; if (!options.includes(c)) options.push(c); }
    return { choose: { count: 1, options }, ...(prods[0].props ? { props: prods[0].props } : {}) };
  }
  // "Add {W}{W}, {W}{B}, or {B}{B}": whole alternatives (filter lands)
  const alts: ManaColor[][] = [];
  for (const p of prods) { const f = (p as { fixed: ManaColor[] }).fixed; if (!alts.some((a) => a.join("") === f.join(""))) alts.push(f); }
  return { alternatives: alts, ...(prods[0].props ? { props: prods[0].props } : {}) };
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
  if (costs.some((c) => !("tap" in c) && !("sacrifice" in c && c.sacrifice === "self"))) return false;
  if (costs.some((c) => "tap" in c) && (o.tapped || isSummoningSick(r, o))) return false;
  return true;
}

/** Can this mana ability be activated by hand (a choice cost such as "Sacrifice a creature" is asked then)? Auto-tap never uses those. */
export function manaAbilityActivatable(r: Run, o: GameObject, a: Ability): boolean {
  if (o.zone !== "battlefield" || a.kind !== "mana") return false;
  const costs = a.costs ?? [];
  if (costs.some((c) => !("tap" in c) && !("mana" in c) && !("sacrifice" in c) && !("discard" in c) && !("tapOther" in c) && !("returnToHand" in c) && !("exileFrom" in c))) return false;
  if (costs.some((c) => "tap" in c) && (o.tapped || isSummoningSick(r, o))) return false;
  return true;
}

/** Pays the tap / sacrifice-self costs of a mana ability (Treasure: {T}, Sacrifice). The mana itself is added by the caller. */
export function payManaAbilityCosts(r: Run, o: GameObject, a: Ability, pid: PlayerId): void {
  for (const c of a.costs ?? []) if ("tap" in c) { o.tapped = true; emit(r, { type: "tap", id: o.id, player: pid }); }
  if ((a.costs ?? []).some((c) => "sacrifice" in c && c.sacrifice === "self")) {
    r.s.turnLog.push({ type: "sacrifice", id: o.id, player: pid, ts: r.s.clock });
    emit(r, { type: "sacrificed", id: o.id, player: pid });
    moveObject(r, o.id, "graveyard");
  }
}

export interface Need { generic: number; colored: Record<string, number> }

const assertSettled = (need: ParsedCost): void => { if (need.hybrid?.length || need.phyrexian?.length) throw new Unsupported("cost:hybrid_or_phyrexian", "a hybrid / Phyrexian cost must be settled (mana.settleCost) before it is paid"); };

function covers(pool: ManaPool, need: ParsedCost, x: number): boolean {
  assertSettled(need);
  const work: ManaPool = { ...pool };
  for (const [c, n] of Object.entries(need.colored)) { if (work[c as ManaColor] < n) return false; work[c as ManaColor] -= n; }
  return poolTotal(work) >= need.generic + need.x * x;
}

/** Spend `need` from the player's pool (plain mana + units that fit `ctx`). Returns false (and spends nothing) if it cannot be covered. */
export function payFromPool(r: Run, pid: PlayerId, need: ParsedCost, x: number, ctx?: SpendCtx): boolean {
  const eff = effectivePool(r, pid, ctx);
  if (!covers(eff, need, x)) return false;
  for (const [c, n] of Object.entries(need.colored)) for (let i = 0; i < n; i++) takeMana(r, pid, c as ManaColor, ctx);
  let generic = need.generic + need.x * x;
  for (const [c, n] of Object.entries(need.colored)) eff[c as ManaColor] -= n;
  // spend colorless first, then the largest remaining color (deterministic)
  while (generic > 0) {
    const order = [...MANA_COLORS].sort((a, b) => (a === "C" ? -1 : b === "C" ? 1 : eff[b] - eff[a]));
    const c = order.find((k) => eff[k] > 0)!;
    takeMana(r, pid, c, ctx); eff[c]--; generic--;
  }
  return true;
}

/** Mana abilities auto-tap may use: plain production only (restricted / lasting mana and filter alternatives are activated by hand). */
function autoTappable(r: Run, pid: PlayerId, a: Ability): boolean {
  try { const pr = productionOfAbility(r, pid, a); return !pr.props && !("alternatives" in pr); } catch { return false; }
}

/** Tap untapped mana sources (greedy, deterministic) until the pool covers the cost; returns false if impossible. */
export function autoTapFor(r: Run, pid: PlayerId, need: ParsedCost, x: number, only?: ObjId[], exclude: ObjId[] = [], ctx?: SpendCtx): boolean {
  const p = player(r, pid);
  const sources = r.s.battlefield
    .map((id) => r.s.objects[id])
    .filter((o) => o.controller === pid && (!only || only.includes(o.id)) && !exclude.includes(o.id))
    .flatMap((o) => manaAbilities(r, o).filter((a) => manaAbilityUsable(r, o, a) && autoTappable(r, pid, a)).map((a) => ({ o, a })));
  // single-option sources first so flexible sources stay available for the colors that need them
  const flex = (s: { a: Ability }) => { const m = s.a.mana!.produces; return m.length === 1 && "colors" in m[0] ? 0 : 1; };
  sources.sort((s1, s2) => flex(s1) - flex(s2) || Number(s1.o.id.slice(1)) - Number(s2.o.id.slice(1)));
  const used = new Set<ObjId>();
  const tapSource = (s: { o: GameObject; a: Ability }, want?: ManaColor): ManaColor[] => {
    used.add(s.o.id);
    const prod = productionOfAbility(r, pid, s.a);
    const colors = "fixed" in prod ? prod.fixed : "choose" in prod ? Array.from({ length: prod.choose.count }, () => (want && prod.choose.options.includes(want) ? want : prod.choose.options[0])) : prod.alternatives[0];
    return colors;
  };
  const gained: Array<{ s: { o: GameObject; a: Ability }; colors: ManaColor[] }> = [];
  const poolNow = () => { const w = effectivePool(r, pid, ctx); for (const g of gained) for (const c of g.colors) w[c]++; return w; };
  for (const [c, n] of Object.entries(need.colored)) {
    while (poolNow()[c as ManaColor] < n) {
      const s = sources.find((z) => !used.has(z.o.id) && (() => { const pr = productionOfAbility(r, pid, z.a); return "fixed" in pr ? pr.fixed.includes(c as ManaColor) : "choose" in pr ? pr.choose.options.includes(c as ManaColor) : false; })());
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
    payManaAbilityCosts(r, g.s.o, g.s.a, pid);
    addMana(r, pid, g.colors, g.s.o.id);
  }
  return true;
}

export function totalPotentialMana(r: Run, pid: PlayerId): number {
  let n = poolTotal(player(r, pid).manaPool) + unitsOf(r, pid).filter((u) => !u.restriction && !u.abilities).length;
  for (const id of r.s.battlefield) {
    const o = r.s.objects[id];
    if (o.controller !== pid) continue;
    for (const a of manaAbilities(r, o)) if (manaAbilityUsable(r, o, a)) { try { const pr = productionOfAbility(r, pid, a); n += "fixed" in pr ? pr.fixed.length : "choose" in pr ? pr.choose.count : Math.max(...pr.alternatives.map((a) => a.length)); } catch { /* unsupported source: not counted */ } break; }
  }
  return n;
}

/**
 * Hybrid and Phyrexian symbols become plain mana (and life). Deterministic rule, no extra question: a hybrid symbol is paid with the first
 * alternative the player can produce (pool first, then untapped mana sources), the generic {2} alternative last; a Phyrexian symbol is paid
 * with mana when the player can produce one of its colors, otherwise with 2 life.
 */
export function settleCost(r: Run, pid: PlayerId, cost: ParsedCost, phy?: Array<"mana" | "life">): { cost: ParsedCost; life: number } {
  if (!cost.hybrid?.length && !cost.phyrexian?.length) return { cost, life: 0 };
  const p = player(r, pid);
  const avail: Record<string, number> = { ...p.manaPool };
  for (const [c, n] of Object.entries(cost.colored)) avail[c] = (avail[c] ?? 0) - n;
  for (const id of r.s.battlefield) {
    const o = r.s.objects[id];
    if (o.controller !== pid) continue;
    for (const a of manaAbilities(r, o)) if (manaAbilityUsable(r, o, a)) {
      try { const pr = productionOfAbility(r, pid, a); const cs: ManaColor[] = "fixed" in pr ? pr.fixed.slice(0, 1) : "choose" in pr ? pr.choose.options : pr.alternatives.flat(); for (const c of new Set(cs)) avail[c] = (avail[c] ?? 0) + 1; } catch { /* not counted */ }
      break;
    }
  }
  const out: ParsedCost = { generic: cost.generic, colored: { ...cost.colored }, x: cost.x, mv: cost.mv, symbolColors: cost.symbolColors };
  const take = (opts: string[]): string | undefined => { const c = opts.find((k) => (avail[k] ?? 0) > 0); if (c) avail[c]--; return c; };
  for (const alts of cost.hybrid ?? []) {
    const colors = alts.filter((a) => a !== "2");
    const c = take(colors);
    if (c) out.colored[c] = (out.colored[c] ?? 0) + 1;
    else if (alts.includes("2")) out.generic += 2;
    else out.colored[colors[0]] = (out.colored[colors[0]] ?? 0) + 1; // cannot be paid: the payment fails with cannot_pay
  }
  let life = 0;
  for (const [i, colors] of (cost.phyrexian ?? []).entries()) {
    const choice = phy?.[i];
    if (choice === "life") { life += 2; continue; }
    const c = take(colors) ?? (choice === "mana" ? colors[0] : undefined); // an explicit "mana" that cannot be paid fails in the payment
    if (c) out.colored[c] = (out.colored[c] ?? 0) + 1; else life += 2;
  }
  return { cost: out, life };
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

/**
 * Which ways may the player pay Phyrexian symbol number `i` of `cost`? (CR 107.4f: the colored mana, or 2 life; life only when the player
 * has at least 2 life left after the symbols already chosen to be paid with life.) The decision itself is asked by resolve.ts.
 */
export function phyrexianOptions(r: Run, pid: PlayerId, cost: ParsedCost, chosen: Array<"mana" | "life">, i: number): { mana: boolean; life: boolean } {
  const p = player(r, pid);
  const avail: Record<string, number> = { ...p.manaPool };
  for (const u of unitsOf(r, pid)) if (!u.restriction && !u.abilities) avail[u.color] = (avail[u.color] ?? 0) + 1;
  for (const [c, n] of Object.entries(cost.colored)) avail[c] = (avail[c] ?? 0) - n;
  for (const id of r.s.battlefield) {
    const o = r.s.objects[id];
    if (o.controller !== pid) continue;
    for (const a of manaAbilities(r, o)) if (manaAbilityUsable(r, o, a) && autoTappable(r, pid, a)) {
      try { const pr = productionOfAbility(r, pid, a); const cs: ManaColor[] = "fixed" in pr ? pr.fixed.slice(0, 1) : "choose" in pr ? pr.choose.options : pr.alternatives.flat(); for (const c of new Set(cs)) avail[c] = (avail[c] ?? 0) + 1; } catch { /* not counted */ }
      break;
    }
  }
  const sym = cost.phyrexian![i];
  for (let k = 0; k < i; k++) if (chosen[k] === "mana") { const c = cost.phyrexian![k].find((x) => (avail[x] ?? 0) > 0); if (c) avail[c]--; }
  const lifeSpent = chosen.slice(0, i).filter((x) => x === "life").length * 2;
  return { mana: sym.some((c) => (avail[c] ?? 0) > 0), life: p.life - lifeSpent >= 2 };
}
