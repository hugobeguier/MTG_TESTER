// Mana: parsing what a mana ability produces, the mana pool, and paying a cost from the pool (optionally tapping
// mana sources first). Mana abilities never use the stack.

import type { Ability, ManaSpec } from "../schema";
import { abilitiesOf, emit, moveObject, isSummoningSick, parseManaCost, player, poolTotal, Reject, Unsupported, type ParsedCost, type Run, chars } from "./core";
import type { GameObject, ManaColor, ManaPool, ObjId, PlayerId } from "./types";
import { MANA_COLORS } from "./types";
import { addUnits, effectivePool, takeMana, unitFits, unitsOf, type SpendCtx } from "./manapool";
import { evalPredicate, objectsMatching } from "./query";

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
  if ("perCount" in spec) {
    // "Add {B} for each Swamp you control" (Cabal Coffers, Crypt of Agadeem): the count is read when the ability is activated
    const color = spec.color.replace(/[{}]/g, "") as ManaColor;
    if (!(MANA_COLORS as readonly string[]).includes(color)) throw new Unsupported("mana:symbols", `cannot parse mana "${spec.color}"`);
    return { fixed: Array.from({ length: objectsMatching(r, spec.perCount, { controller: owner }).length }, () => color), ...(propsOf(spec) ? { props: propsOf(spec) } : {}) };
  }
  if ("chosenColor" in spec) throw new Unsupported("mana:chosen_color");
  if ("conditional" in spec) {
    // "Add one mana of any color. If you control a creature with power 4 or greater, add two mana of that color instead" (Ilysian Caryatid): the branch is read when the mana is made
    const branch = evalPredicate(r, spec.conditional.if, { controller: owner }) ? spec.conditional.then : spec.conditional.else;
    if (branch.length !== 1) throw new Unsupported("mana:conditional");
    return productionOf(r, owner, branch[0]);
  }
  throw new Unsupported("mana:conditional");
}

/**
 * What a whole mana ability produces. Several specs are ALTERNATIVES ("{T}: Add {W} or {B}": dual lands, pain lands, Signets without the
 * filter cost): each must be one fixed mana of one color, and the player chooses which one when activating.
 */
export function productionOfAbility(r: Run, owner: PlayerId, a: Ability): Production {
  if (a.scripted?.handler === "mana_colors_an_opponent_land_could_produce") {
    // Fellwar Stone: one mana of a color that a land an opponent controls could produce (basic land types and the mana abilities of their lands)
    const found = new Set<ManaColor>();
    const basic: Record<string, ManaColor> = { plains: "W", island: "U", swamp: "B", mountain: "R", forest: "G" };
    for (const id of r.s.battlefield) {
      const o = r.s.objects[id];
      if (!o || o.controller === owner || !chars(r, id).types.includes("land")) continue;
      for (const t of chars(r, id).subtypes) if (basic[t.toLowerCase()]) found.add(basic[t.toLowerCase()]);
      for (const ab of manaAbilities(r, o)) { try { const p = productionOfAbility(r, o.controller, ab); if ("fixed" in p) p.fixed.forEach((c) => c !== "C" && found.add(c)); else if ("choose" in p) p.choose.options.forEach((c) => c !== "C" && found.add(c)); else p.alternatives.flat().forEach((c) => c !== "C" && found.add(c)); } catch { /* an ability the engine cannot read produces nothing here */ } }
    }
    return found.size ? { choose: { count: 1, options: [...found] } } : { fixed: [] };
  }
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

/** Forsaken Monument: "Whenever you tap a permanent for {C}, add an additional {C}." One extra {C} per Monument the player controls when a mana ability that makes {C} is paid by tapping. */
export function withTapBonus(r: Run, pid: PlayerId, colors: ManaColor[]): ManaColor[] {
  if (!colors.includes("C")) return colors;
  let extra = 0;
  for (const id of r.s.battlefield) { const o = r.s.objects[id]; if (o && o.controller === pid && abilitiesOf(r, o).some((a) => a.scripted?.handler === "tapped_for_colorless_mana")) extra++; }
  return extra ? [...colors, ...Array<ManaColor>(extra).fill("C")] : colors;
}

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
  for (const c of a.costs ?? []) if ("tap" in c) { o.tapped = true; emit(r, { type: "tap", id: o.id, player: pid, forMana: true }); }
  if ((a.costs ?? []).some((c) => "sacrifice" in c && c.sacrifice === "self")) {
    r.s.turnLog.push({ type: "sacrifice", id: o.id, player: pid, ts: r.s.clock });
    emit(r, { type: "sacrificed", id: o.id, player: pid });
    moveObject(r, o.id, "graveyard");
  }
}

export interface Need { generic: number; colored: Record<string, number> }

const assertSettled = (need: ParsedCost): void => { if (need.hybrid?.length || need.phyrexian?.length) throw new Unsupported("cost:hybrid_or_phyrexian", "a hybrid / Phyrexian cost must be settled (mana.settleCost) before it is paid"); };

/** "Players may spend mana as though it were mana of any color" (Mycosynth Lattice): a permanent anywhere on the battlefield grants it to every player. */
export function anyColorSpendActive(r: Run): boolean {
  return r.s.battlefield.some((id) => {
    const o = r.s.objects[id];
    return !!o && abilitiesOf(r, o).some((a) => a.kind === "static" && !!a.static?.modify?.some((m) => "grant" in m && String(m.grant).toLowerCase() === "spend mana as though it were mana of any color"));
  });
}

/** Under that permission every colored symbol is paid by any mana; only {C} still needs colorless mana (CR 609.4b). */
function relaxColors(r: Run, need: ParsedCost): ParsedCost {
  if (!anyColorSpendActive(r)) return need;
  const colored: Record<string, number> = {};
  let generic = need.generic;
  for (const [c, n] of Object.entries(need.colored)) { if (c === "C") colored[c] = n; else generic += n; }
  return { ...need, generic, colored };
}

function covers(pool: ManaPool, need: ParsedCost, x: number): boolean {
  assertSettled(need);
  const work: ManaPool = { ...pool };
  for (const [c, n] of Object.entries(need.colored)) { if (work[c as ManaColor] < n) return false; work[c as ManaColor] -= n; }
  return poolTotal(work) >= need.generic + need.x * x;
}

/** Spend `need` from the player's pool (plain mana + units that fit `ctx`). Returns false (and spends nothing) if it cannot be covered. */
export function payFromPool(r: Run, pid: PlayerId, need0: ParsedCost, x: number, ctx?: SpendCtx): boolean {
  const need = relaxColors(r, need0);
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
function autoTappable(r: Run, pid: PlayerId, a: Ability, ctx?: SpendCtx): boolean {
  try {
    const pr = productionOfAbility(r, pid, a);
    if ("alternatives" in pr) return false;
    if (!pr.props) return true;
    // restricted mana ("Spend this mana only to cast an Angel spell", Giada): usable by the automatic payment when it fits what is being paid for
    const color = "fixed" in pr ? pr.fixed[0] : pr.choose.options[0];
    return !!color && unitFits(r, pid, { color, ...pr.props }, ctx);
  } catch { return false; }
}

/** Generic-only mana cost of a "{2}, {T}: Add ..." ability (Signets, Cabal Coffers, Crypt of Agadeem), or undefined when the ability has any other cost. */
function paidGenericCost(a: Ability): number | undefined {
  const costs = a.costs ?? [];
  const mana = costs.filter((c) => "mana" in c) as Array<{ mana: string }>;
  if (mana.length !== 1 || costs.some((c) => !("tap" in c) && !("mana" in c))) return undefined;
  try { const pc = parseManaCost(mana[0].mana); return Object.keys(pc.colored).length || pc.hybrid?.length || pc.phyrexian?.length || pc.x ? undefined : pc.generic; } catch { return undefined; }
}

/** Spend `n` mana from a simulated pool: colorless first, then colors the cost does not need, then anything. Returns the colors spent, or undefined if the pool has too little. */
function deductGeneric(work: ManaPool, n: number, keep: Record<string, number>): ManaColor[] | undefined {
  const spent: ManaColor[] = [];
  const order = (surplusOnly: boolean): ManaColor[] => [...MANA_COLORS].filter((c) => (surplusOnly ? work[c] - (keep[c] ?? 0) > 0 : work[c] > 0)).sort((x, y) => (x === "C" ? -1 : y === "C" ? 1 : work[y] - work[x]));
  while (spent.length < n) {
    const c = order(true)[0] ?? order(false)[0];
    if (!c) return undefined;
    work[c]--; spent.push(c);
  }
  return spent;
}

/**
 * Tap untapped mana sources (greedy, deterministic) until the pool covers the cost; returns false if impossible. Sources that need a mana
 * payment of their own ("{1}, {T}: Add {U}{R}") are used last, and only when their output is larger than the generic cost they consume
 * (the net gain): that cost is paid out of the mana made by the other sources.
 */
export function autoTapFor(r: Run, pid: PlayerId, need0: ParsedCost, x: number, only?: ObjId[], exclude: ObjId[] = [], ctx?: SpendCtx): boolean {
  const need = relaxColors(r, need0);
  type Src = { o: GameObject; a: Ability; pay?: number };
  const sources: Src[] = r.s.battlefield
    .map((id) => r.s.objects[id])
    .filter((o) => o.controller === pid && (!only || only.includes(o.id)) && !exclude.includes(o.id))
    .flatMap((o): Src[] => manaAbilities(r, o).flatMap((a): Src[] => {
      if (manaAbilityUsable(r, o, a) && autoTappable(r, pid, a, ctx)) return [{ o, a }];
      const pay = paidGenericCost(a);
      if (pay === undefined || o.zone !== "battlefield" || ((a.costs ?? []).some((c) => "tap" in c) && (o.tapped || isSummoningSick(r, o))) || !autoTappable(r, pid, a, ctx)) return [];
      try { const pr = productionOfAbility(r, pid, a); return "fixed" in pr && pr.fixed.length > pay || "choose" in pr && pr.choose.count > pay ? [{ o, a, pay }] : []; } catch { return []; }
    }));
  // single-option free sources first so flexible sources stay available for the colors that need them; paid sources last
  const flex = (s: Src) => { if (s.pay !== undefined) return 2; const m = s.a.mana!.produces; return m.length === 1 && "colors" in m[0] ? 0 : 1; };
  // a permanent with several mana abilities (a land that is also a Swamp: {B} and {C}{C}) is tapped for the one that wastes the least
  const size = (s: Src): number => { try { const pr = productionOfAbility(r, pid, s.a); return "fixed" in pr ? pr.fixed.length : "choose" in pr ? pr.choose.count : Math.max(...pr.alternatives.map((x) => x.length)); } catch { return 0; } };
  const best = new Map<ObjId, number>();
  for (const s of sources) best.set(s.o.id, Math.max(best.get(s.o.id) ?? 0, size(s)));
  const waste = (s: Src): number => (best.get(s.o.id) ?? 0) - size(s);
  sources.sort((s1, s2) => flex(s1) - flex(s2) || waste(s1) - waste(s2) || Number(s1.o.id.slice(1)) - Number(s2.o.id.slice(1)));
  const used = new Set<ObjId>();
  const colorsOf = (s: Src, want?: ManaColor): ManaColor[] => {
    const prod = productionOfAbility(r, pid, s.a);
    const base = "fixed" in prod ? prod.fixed : "choose" in prod ? Array.from({ length: prod.choose.count }, () => (want && prod.choose.options.includes(want) ? want : prod.choose.options[0])) : prod.alternatives[0];
    return (s.a.costs ?? []).some((c) => "tap" in c) ? withTapBonus(r, pid, base) : base;
  };
  const gained: Array<{ s: Src; colors: ManaColor[] }> = [];
  /** the pool after every chosen source: free ones add mana, paid ones first spend their generic cost (undefined: not payable) */
  const simulate = (list: typeof gained): ManaPool | undefined => {
    const w = effectivePool(r, pid, ctx);
    for (const g of list) if (g.s.pay === undefined) for (const c of g.colors) w[c]++;
    for (const g of list) if (g.s.pay !== undefined) { if (!deductGeneric(w, g.s.pay, need.colored)) return undefined; for (const c of g.colors) w[c]++; }
    return w;
  };
  const poolNow = (): ManaPool => simulate(gained)!;
  const take = (pick: (z: Src) => boolean, want?: ManaColor): boolean => {
    for (const z of sources) {
      if (used.has(z.o.id) || !pick(z)) continue;
      const cand = { s: z, colors: colorsOf(z, want) };
      if (!cand.colors.length || !simulate([...gained, cand])) continue;
      used.add(z.o.id); gained.push(cand);
      return true;
    }
    return false;
  };
  for (const [c, n] of Object.entries(need.colored)) {
    while (poolNow()[c as ManaColor] < n) {
      if (!take((z) => { const pr = productionOfAbility(r, pid, z.a); return "fixed" in pr ? pr.fixed.includes(c as ManaColor) : "choose" in pr ? pr.choose.options.includes(c as ManaColor) : false; }, c as ManaColor)) return false;
    }
  }
  while (!covers(poolNow(), need, x)) { if (!take(() => true)) return false; }
  // commit: free sources first, then each paid source (its cost is spent from the pool before its mana is added)
  for (const g of gained) if (g.s.pay === undefined) {
    payManaAbilityCosts(r, g.s.o, g.s.a, pid);
    const props = productionOfAbility(r, pid, g.s.a).props;
    if (props) addUnits(r, pid, g.colors, props, g.s.o.id); else addMana(r, pid, g.colors, g.s.o.id);
  }
  for (const g of gained) if (g.s.pay !== undefined) {
    const eff = effectivePool(r, pid, ctx);
    const spent = deductGeneric(eff, g.s.pay, need.colored);
    if (!spent) return false;
    for (const c of spent) takeMana(r, pid, c, ctx);
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
export function settleCost(r: Run, pid: PlayerId, cost: ParsedCost, phy?: Array<"mana" | "life">, only?: ObjId[]): { cost: ParsedCost; life: number } {
  if (!cost.hybrid?.length && !cost.phyrexian?.length) return { cost, life: 0 };
  const p = player(r, pid);
  const avail: Record<string, number> = { ...p.manaPool };
  for (const [c, n] of Object.entries(cost.colored)) avail[c] = (avail[c] ?? 0) - n;
  for (const id of r.s.battlefield) {
    const o = r.s.objects[id];
    if (o.controller !== pid || (only && !only.includes(id))) continue; // with an explicit payWith list only those sources can make the mana
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
