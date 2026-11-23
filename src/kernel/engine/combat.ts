// Combat rules: who may attack what, who may block what, taxes, and the damage step (first strike / double strike / trample /
// deathtouch / lifelink, damage divided among several blockers). resolve.ts owns the turn structure and priority; this module
// owns the legality checks and the two declarations (turn-based actions) plus the damage computation.
//
// Everything reads EFFECTIVE characteristics through chars() (a creature that lost its abilities has no flying) and restrictions
// through layers.restrictionsOf (cant attack / cant block / cant be blocked / attack & block taxes / evasion / must attack).
//
// Damage assignment (current rules, no "damage assignment order"): an attacker blocked by several creatures divides its damage
// among them freely (trample: it may assign to the defender once every blocker got lethal damage; deathtouch makes 1 lethal).
// That choice is a pending decision (`assign_damage`) for the attacker's controller; every other case is assigned automatically.

import { protectedFrom } from "./protection";
import type { ObjectFilter } from "../schema";
import { attackerEntry, chars, defenderPlayer, emit, isSummoningSick, label, obj, parseManaCost, player, Reject, tick, tryObj, alive, type ParsedCost, type Run } from "./core";
import { goadersOf, restrictionsOf } from "./layers";
import { autoTapFor, payFromPool } from "./mana";
import { durables } from "./durable";
import { evalPredicate, matchesFilter, type QCtx } from "./query";
import { changeLife, dealDamage, type AskSpec } from "./steps";
import type { Action, Attacker, CombatCreature, CombatState, Choice, ObjId, PlayerId } from "./types";
import { isObjId } from "./types";

type DeclareAttackers = Extract<Action, { type: "declareAttackers" }>;
type DeclareBlockers = Extract<Action, { type: "declareBlockers" }>;

export const newCombat = (): CombatState => ({ attackers: [], dealtFirst: [], expect: null });

const hasKw = (r: Run, id: ObjId, kw: string): boolean => chars(r, id).keywords.includes(kw);
const isCreature = (r: Run, id: ObjId): boolean => chars(r, id).types.includes("creature");
const LETTER: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
const colorsOf = (r: Run, id: ObjId): string[] => chars(r, id).colors.map((c) => LETTER[c.toLowerCase()] ?? c.toUpperCase());

/** A combatant is valid while it is the same object as when it entered combat and still a creature on the battlefield. */
function valid(r: Run, c: CombatCreature): boolean {
  const o = r.s.objects[c.id];
  return !!o && o.zone === "battlefield" && o.timestamp === c.ts && isCreature(r, c.id);
}

// ================================================================ attacking

/** Players and planeswalkers / battles that `pid` may point attackers at. */
export function defenderOptions(r: Run, pid: PlayerId): string[] {
  const out: string[] = [];
  for (const p of alive(r)) if (p.id !== pid) out.push(p.id);
  for (const id of r.s.battlefield) {
    const o = r.s.objects[id];
    if (o.controller === pid || !alive(r).some((p) => p.id === o.controller)) continue;
    const t = chars(r, id).types;
    if (t.includes("planeswalker") || t.includes("battle")) out.push(id);
  }
  return out;
}

/** Does a "protects" restriction (can't attack you / planeswalkers you control; tax) cover an attack on `defender`? */
function covers(r: Run, protects: string | undefined, source: ObjId, defender: string): boolean {
  if (!protects) return true;
  const sc = tryObj(r, source)?.controller;
  if (!sc) return false;
  if (defender === sc) return true;
  return protects === "you_and_planeswalkers" && isObjId(defender) && r.s.objects[defender]?.controller === sc && chars(r, defender).types.includes("planeswalker");
}

/** Why this creature can not attack (that defender), or null. */
export function attackProblem(r: Run, id: ObjId, pid: PlayerId, defender?: string): string | null {
  const o = tryObj(r, id);
  if (!o || o.zone !== "battlefield") return "it is not on the battlefield";
  if (o.controller !== pid) return `${label(r, id)} is not controlled by ${pid}`;
  const c = chars(r, id);
  if (!c.types.includes("creature")) return `${label(r, id)} is not a creature`;
  if (o.tapped) return `${label(r, id)} is tapped`;
  if (c.keywords.includes("defender")) return `${label(r, id)} has defender`;
  if (isSummoningSick(r, o)) return `${label(r, id)} is summoning sick`;
  for (const x of restrictionsOf(r, id)) {
    if (x.kind !== "cant" || x.what !== "attack") continue;
    if (x.except && matchesFilter(r, id, x.except, { controller: tryObj(r, x.source)?.controller ?? pid, source: x.source })) continue;
    if (!x.protects) return `${label(r, id)} can't attack`;
    if (defender !== undefined && covers(r, x.protects, x.source, defender)) return `${label(r, id)} can't attack ${label(r, defender)} (${label(r, x.source)})`;
  }
  for (const d of durables(r)) { // "can't attack you or planeswalkers you control until your next turn / for as long as ..." granted by a resolved ability
    const b = d.attackBan;
    if (!b || !(b.objects ? b.objects.some((x) => x.id === id && x.ts === o.timestamp) : b.controllerOf === o.controller)) continue;
    if (b.whileP && !evalPredicate(r, b.whileP, { controller: d.owner, source: d.source, chosen: b.chosen ?? {} })) continue;
    if (!b.protects) return `${label(r, id)} can't attack`;
    const mine = defender === d.owner || (b.protects === "you_and_planeswalkers" && !!defender && isObjId(defender) && r.s.objects[defender]?.controller === d.owner && chars(r, defender).types.includes("planeswalker"));
    if (defender !== undefined && mine) return `${label(r, id)} can't attack ${label(r, defender)} (${label(r, d.source)})`;
  }
  return null;
}

export function legalAttackers(r: Run, pid: PlayerId): ObjId[] {
  const defs = defenderOptions(r, pid);
  return r.s.battlefield.filter((id) => r.s.objects[id].controller === pid && defs.some((d) => attackProblem(r, id, pid, d) === null));
}

const mustAttackNow = (r: Run, id: ObjId): boolean => restrictionsOf(r, id).some((x) => x.kind === "mustAttack") || goadersOf(r, id).length > 0; // goaded: attacks each combat if able

/** A goaded creature attacks a player other than its goaders (or their planeswalkers) if able. */
function goadProblem(r: Run, id: ObjId, pid: PlayerId, defender: string, defs: string[]): string | null {
  const goaders = goadersOf(r, id);
  if (!goaders.length) return null;
  const owner = (d: string) => defenderPlayer(r, d);
  if (!goaders.includes(owner(defender) as string)) return null;
  const alternative = defs.some((d) => !goaders.includes(owner(d) as string) && attackProblem(r, id, pid, d) === null);
  return alternative ? `${label(r, id)} is goaded: it must attack a player other than ${goaders.join(", ")} if able` : null;
}

function addCost(into: ParsedCost, cost: ParsedCost): void {
  into.generic += cost.generic; into.mv += cost.mv; into.x += cost.x;
  for (const [k, n] of Object.entries(cost.colored)) into.colored[k] = (into.colored[k] ?? 0) + n;
}

/** Pays a combined attack / block tax: from the pool first, then by tapping mana sources (autoPay false: pool only). */
function payTax(r: Run, pid: PlayerId, total: ParsedCost, a: { payWith?: ObjId[]; autoPay?: boolean }, what: string): void {
  if (total.mv === 0) return;
  if (payFromPool(r, pid, total, 0)) return;
  const allowTap = a.payWith !== undefined || a.autoPay !== false;
  if (!(allowTap && autoTapFor(r, pid, total, 0, a.payWith) && payFromPool(r, pid, total, 0))) throw new Reject("cannot_pay", `cannot pay the ${what} tax`);
  emit(r, { type: "tax_paid", player: pid, what });
}

function bumpBatch(r: Run): number { r.batch = tick(r); return r.batch; }

/** Applies a validated attack declaration. Returns the number of attackers. */
export function declareAttackers(r: Run, a: DeclareAttackers): number {
  const combat = r.s.combat;
  const ex = combat?.expect;
  if (!combat || ex?.kind !== "attackers") throw new Reject("not_declaring", "attackers are not being declared right now");
  if (ex.player !== a.player) throw new Reject("not_your_declaration", `only ${ex.player} declares attackers this turn`);
  const seen = new Set<ObjId>();
  const defs = defenderOptions(r, a.player);
  const tax: ParsedCost = { generic: 0, colored: {}, x: 0, mv: 0 };
  for (const at of a.attackers) {
    if (seen.has(at.id)) throw new Reject("illegal_attack", `${label(r, at.id)} is declared twice`);
    seen.add(at.id);
    if (!tryObj(r, at.id)) throw new Reject("unknown_object", `unknown creature ${at.id}`);
    if (!defs.includes(at.defender)) throw new Reject("illegal_attack", `${label(r, at.defender)} cannot be attacked by ${a.player}`);
    const why = attackProblem(r, at.id, a.player, at.defender) ?? goadProblem(r, at.id, a.player, at.defender, defs);
    if (why) throw new Reject("illegal_attack", why);
    if (!r.s.config.mirrorHeadless?.noAttackTax) for (const x of restrictionsOf(r, at.id)) if (x.kind === "attackTax" && covers(r, x.protects, x.source, at.defender)) addCost(tax, parseManaCost(x.cost));
  }
  // requirements: every creature that must attack and could attack something does
  for (const id of legalAttackers(r, a.player)) {
    if (mustAttackNow(r, id) && !seen.has(id)) throw new Reject("attack_requirement", `${label(r, id)} attacks each combat if able`);
  }
  payTax(r, a.player, tax, a, "attack");
  const batch = bumpBatch(r);
  for (const at of a.attackers) {
    const o = obj(r, at.id);
    if (!hasKw(r, at.id, "vigilance")) { o.tapped = true; emit(r, { type: "tap", id: at.id, player: a.player }); }
    combat.attackers.push({ id: at.id, ts: o.timestamp, defender: at.defender, blockers: [], blocked: false });
    emit(r, { type: "attack", id: at.id, player: a.player, defender: at.defender, defendingPlayer: defenderPlayer(r, at.defender), batch });
    r.s.turnLog.push({ type: "attack", id: at.id, player: a.player, name: label(r, at.id), types: chars(r, at.id).types, ts: r.s.clock });
  }
  combat.expect = null;
  emit(r, { type: "attackers_declared", player: a.player, count: a.attackers.length });
  return a.attackers.length;
}

// ================================================================ blocking

/** Why `blocker` can not block `attacker` (evasion), or null. */
function evasionProblem(r: Run, attacker: ObjId, blocker: ObjId, defendingPlayer: PlayerId): string | null {
  const ac = chars(r, attacker), bc = chars(r, blocker);
  const bad = (why: string) => `${label(r, blocker)} can't block ${label(r, attacker)}: ${why}`;
  if (ac.keywords.includes("unblockable")) return bad("it can't be blocked");
  if (protectedFrom(r, attacker, blocker)) return bad("protection");
  if (ac.keywords.includes("flying") && !bc.keywords.includes("flying") && !bc.keywords.includes("reach")) return bad("flying");
  if (ac.keywords.includes("fear") && !bc.types.includes("artifact") && !colorsOf(r, blocker).includes("B")) return bad("fear");
  if (ac.keywords.includes("intimidate") && !bc.types.includes("artifact") && !colorsOf(r, attacker).some((x) => colorsOf(r, blocker).includes(x))) return bad("intimidate");
  if (ac.keywords.includes("skulk") && (bc.power ?? 0) > (ac.power ?? 0)) return bad("skulk");
  // shadow: a creature with shadow can block and be blocked only by creatures with shadow
  if (ac.keywords.includes("shadow") !== bc.keywords.includes("shadow")) return bad("shadow");
  // landwalk (forestwalk...): unblockable while the defending player controls a land of that type (the keyword's param)
  for (const a of ac.abilities) {
    if (a.kind !== "keyword" || a.keyword?.name.toLowerCase() !== "landwalk") continue;
    const lt = String(a.keyword.param ?? "").toLowerCase();
    if (lt && r.s.battlefield.some((id) => r.s.objects[id].controller === defendingPlayer && chars(r, id).types.includes("land") && chars(r, id).subtypes.some((s) => s.toLowerCase() === lt))) return bad(`${lt}walk`);
  }
  for (const x of restrictionsOf(r, attacker)) {
    const sctl = tryObj(r, x.source)?.controller ?? defendingPlayer;
    const q = (): QCtx => ({ controller: sctl, source: x.source });
    if (x.kind === "cant" && x.what === "be_blocked") {
      if (!x.except || !matchesFilter(r, blocker, x.except, q())) return bad(`${label(r, x.source)}`);
    }
  }
  return null;
}

/** "can't be blocked by creatures with power 2 or less", "...unless defending player controls an artifact" (static `evasion`). */
function evasionStatics(r: Run, attacker: ObjId, blocker: ObjId, defendingPlayer: PlayerId): string | null {
  for (const x of restrictionsOf(r, attacker)) {
    if (x.kind !== "evasion" || !x.cantBeBlockedBy) continue;
    const q: QCtx = { controller: tryObj(r, x.source)?.controller ?? defendingPlayer, source: x.source };
    if (!matchesFilter(r, blocker, x.cantBeBlockedBy, q)) continue;
    if (x.unlessDefenderControls && r.s.battlefield.some((id) => r.s.objects[id].controller === defendingPlayer && matchesFilter(r, id, x.unlessDefenderControls!, { ...q, controller: defendingPlayer }))) continue;
    return `${label(r, blocker)} can't block ${label(r, attacker)} (${label(r, x.source)})`;
  }
  return null;
}

export function blockProblem(r: Run, blocker: ObjId, attacker: ObjId, pid: PlayerId): string | null {
  const bo = tryObj(r, blocker);
  if (!bo || bo.zone !== "battlefield") return "the blocker is not on the battlefield";
  if (bo.controller !== pid) return `${label(r, blocker)} is not controlled by ${pid}`;
  if (!isCreature(r, blocker)) return `${label(r, blocker)} is not a creature`;
  if (bo.tapped) return `${label(r, blocker)} is tapped`;
  for (const x of restrictionsOf(r, blocker)) {
    if (x.kind !== "cant" || x.what !== "block") continue;
    if (x.except && matchesFilter(r, blocker, x.except, { controller: tryObj(r, x.source)?.controller ?? pid, source: x.source })) continue;
    return `${label(r, blocker)} can't block`;
  }
  const at = attackerEntry(r, attacker);
  if (!at) return `${label(r, attacker)} is not attacking`;
  const dp = defenderPlayer(r, at.defender);
  if (dp !== pid) return `${label(r, attacker)} is not attacking ${pid} or a permanent ${pid} controls`;
  return evasionProblem(r, attacker, blocker, pid) ?? evasionStatics(r, attacker, blocker, pid);
}

/** Defending players (turn order) that have something to declare: attacked, with an untapped creature that could block an attacker. */
export function blockersToDeclare(r: Run, order: PlayerId[]): PlayerId[] {
  const combat = r.s.combat;
  if (!combat) return [];
  const live = combat.attackers.filter((a) => attackerEntry(r, a.id));
  return order.filter((pid) => {
    const mine = r.s.battlefield.filter((id) => r.s.objects[id].controller === pid && isCreature(r, id) && !r.s.objects[id].tapped);
    return live.some((a) => defenderPlayer(r, a.defender) === pid && mine.some((b) => blockProblem(r, b, a.id, pid) === null));
  });
}

/** Applies one defending player's block declaration. Returns true when every defending player has declared. */
export function declareBlockers(r: Run, a: DeclareBlockers): boolean {
  const combat = r.s.combat;
  const ex = combat?.expect;
  if (!combat || ex?.kind !== "blockers") throw new Reject("not_declaring", "blockers are not being declared right now");
  if (!ex.players.includes(a.player)) throw new Reject("not_your_declaration", `${a.player} has no blockers to declare (waiting for ${ex.players.join(", ")})`);
  const used = new Set<ObjId>();
  const per = new Map<ObjId, ObjId[]>();
  const tax: ParsedCost = { generic: 0, colored: {}, x: 0, mv: 0 };
  for (const b of a.blocks) {
    if (!tryObj(r, b.blocker)) throw new Reject("unknown_object", `unknown creature ${b.blocker}`);
    if (!tryObj(r, b.attacker)) throw new Reject("unknown_object", `unknown creature ${b.attacker}`);
    if (used.has(b.blocker)) throw new Reject("illegal_block", `${label(r, b.blocker)} can only block one creature`);
    used.add(b.blocker);
    const why = blockProblem(r, b.blocker, b.attacker, a.player);
    if (why) throw new Reject("illegal_block", why);
    per.set(b.attacker, [...(per.get(b.attacker) ?? []), b.blocker]);
    for (const x of restrictionsOf(r, b.blocker)) if (x.kind === "blockTax") addCost(tax, parseManaCost(x.cost));
  }
  for (const [atk, bl] of per) if (hasKw(r, atk, "menace") && bl.length < 2) throw new Reject("illegal_block", `${label(r, atk)} has menace: it must be blocked by two or more creatures`);
  for (const [atk, bl] of per) if (hasKw(r, atk, "can't be blocked by more than one creature") && bl.length > 1) throw new Reject("illegal_block", `${label(r, atk)} can't be blocked by more than one creature`);
  payTax(r, a.player, tax, a, "block");
  const batch = bumpBatch(r);
  for (const b of a.blocks) {
    const at = attackerEntry(r, b.attacker)!;
    at.blockers.push({ id: b.blocker, ts: obj(r, b.blocker).timestamp });
    at.blocked = true;
    emit(r, { type: "block", id: b.blocker, attacker: b.attacker, player: a.player, batch });
  }
  for (const [atk, bl] of per) emit(r, { type: "blocked", id: atk, blockers: bl });
  ex.players = ex.players.filter((p) => p !== a.player);
  emit(r, { type: "blockers_declared", player: a.player, count: a.blocks.length });
  if (ex.players.length === 0) { combat.expect = null; return true; }
  return false;
}

// ================================================================ damage

interface Item { src: ObjId; target: string; amount: number }
export interface DamageAsk { attacker: ObjId; spec: AskSpec; total: number; lethal: Record<string, number>; trample: boolean }

const defenderValid = (r: Run, defender: string): boolean => {
  if (!isObjId(defender)) return alive(r).some((p) => p.id === defender);
  const o = r.s.objects[defender];
  return !!o && o.zone === "battlefield";
};

/** Damage that is lethal to `id` from `src` (deathtouch: 1; damage already marked counts). */
function lethalFor(r: Run, id: ObjId, deathtouch: boolean): number {
  const o = obj(r, id);
  const t = chars(r, id).toughness ?? 0;
  const left = Math.max(0, t - o.damage);
  return deathtouch ? Math.min(1, Math.max(left, 1)) : left;
}

export function anyFirstStrike(r: Run): boolean {
  const combat = r.s.combat;
  if (!combat) return false;
  const ids: CombatCreature[] = [];
  for (const a of combat.attackers) { ids.push(a, ...a.blockers); }
  return ids.some((c) => valid(r, c) && (hasKw(r, c.id, "first strike") || hasKw(r, c.id, "double strike")));
}

const dealsThisStep = (r: Run, c: CombatState, id: ObjId, which: "first" | "regular"): boolean => {
  const fs = hasKw(r, id, "first strike"), ds = hasKw(r, id, "double strike");
  return which === "first" ? fs || ds : !c.dealtFirst.includes(id) || ds;
};

/**
 * What every combatant deals in this step, or the question the next multi-blocked attacker's controller has to answer.
 * Reads state only: nothing is dealt until every question is answered.
 */
export function gatherDamage(r: Run, which: "first" | "regular", assigned: Record<ObjId, Record<string, number>>): { items: Item[] } | { ask: DamageAsk } {
  const combat = r.s.combat!;
  const items: Item[] = [];
  for (const a of combat.attackers) {
    if (!valid(r, a) || !dealsThisStep(r, combat, a.id, which)) continue;
    const power = Math.max(0, chars(r, a.id).power ?? 0);
    if (power === 0) continue;
    const dt = hasKw(r, a.id, "deathtouch"), trample = hasKw(r, a.id, "trample");
    const defOk = defenderValid(r, a.defender);
    const blk = a.blockers.filter((b) => valid(r, b));
    if (!a.blocked) { if (defOk) items.push({ src: a.id, target: a.defender, amount: power }); continue; }
    if (blk.length === 0) { if (trample && defOk) items.push({ src: a.id, target: a.defender, amount: power }); continue; }
    if (blk.length === 1) {
      const b = blk[0].id;
      if (trample && defOk) {
        const l = Math.min(power, lethalFor(r, b, dt));
        if (l > 0) items.push({ src: a.id, target: b, amount: l });
        if (power - l > 0) items.push({ src: a.id, target: a.defender, amount: power - l });
      } else items.push({ src: a.id, target: b, amount: power });
      continue;
    }
    const asg = assigned[a.id];
    if (!asg) {
      const lethal: Record<string, number> = {};
      for (const b of blk) lethal[b.id] = lethalFor(r, b.id, dt);
      const options = blk.map((b) => ({ id: b.id, label: `${label(r, b.id)} (lethal: ${lethal[b.id]})` }));
      if (trample && defOk) options.push({ id: a.defender, label: `${isObjId(a.defender) ? label(r, a.defender) : "the defending player"} (trample)` });
      const spec: AskSpec = {
        kind: "assign_damage", player: obj(r, a.id).controller,
        prompt: { title: `${label(r, a.id)}: assign combat damage`, instruction: `Divide ${power} combat damage among the creatures blocking ${label(r, a.id)}${trample ? " (trample: damage may go to the defender once every blocker has lethal damage)" : ""}.` },
        options, min: 0, max: power
      };
      return { ask: { attacker: a.id, spec, total: power, lethal, trample: trample && defOk } };
    }
    for (const [t, n] of Object.entries(asg)) if (n > 0) items.push({ src: a.id, target: t, amount: n });
  }
  for (const a of combat.attackers) {
    if (!valid(r, a)) continue;
    for (const b of a.blockers) {
      if (!valid(r, b) || !dealsThisStep(r, combat, b.id, which)) continue;
      const power = Math.max(0, chars(r, b.id).power ?? 0);
      if (power > 0) items.push({ src: b.id, target: a.id, amount: power });
    }
  }
  return { items };
}

/** Validates an `assign` answer against the question; throws Reject(invalid_choice). */
export function checkAssignment(ask: { total: number; lethal: Record<string, number>; trample: boolean; options: string[] }, choice: Choice): Record<string, number> {
  const asg = choice.assign;
  if (!asg) throw new Reject("invalid_choice", "answer with choice.assign: { <creature id>: damage }");
  let sum = 0;
  for (const [id, n] of Object.entries(asg)) {
    if (!ask.options.includes(id)) throw new Reject("invalid_choice", `${id} is not a legal recipient`);
    if (!Number.isInteger(n) || n < 0) throw new Reject("invalid_choice", "damage must be a whole number, 0 or more");
    sum += n;
  }
  if (sum !== ask.total) throw new Reject("invalid_choice", `assign exactly ${ask.total} damage (got ${sum})`);
  const toDefender = Object.entries(asg).filter(([id, n]) => !(id in ask.lethal) && n > 0).reduce((s, [, n]) => s + n, 0);
  if (toDefender > 0) {
    if (!ask.trample) throw new Reject("invalid_choice", "only a creature with trample may assign damage to the defender");
    for (const [b, l] of Object.entries(ask.lethal)) if ((asg[b] ?? 0) < l) throw new Reject("invalid_choice", `trample: assign lethal damage (${l}) to ${b} before the defender`);
  }
  return asg;
}

/** Deals the gathered damage at once (through the replacement pipeline); lifelink gains follow; records first-strike dealers. */
export function applyDamage(r: Run, which: "first" | "regular", items: Item[]): void {
  const combat = r.s.combat!;
  r.batch = tick(r);
  emit(r, { type: "combat_damage_step", which });
  const dealtBy = new Map<ObjId, number>();
  for (const it of items) {
    const n = dealDamage(r, undefined, it.src, it.target, it.amount, true);
    dealtBy.set(it.src, (dealtBy.get(it.src) ?? 0) + n);
  }
  for (const [src, n] of dealtBy) {
    if (n > 0 && tryObj(r, src)?.zone === "battlefield" && hasKw(r, src, "lifelink")) changeLife(r, undefined, obj(r, src).controller, n);
  }
  if (which === "first") {
    for (const a of combat.attackers) for (const c of [a, ...a.blockers]) if (valid(r, c) && (hasKw(r, c.id, "first strike") || hasKw(r, c.id, "double strike")) && !combat.dealtFirst.includes(c.id)) combat.dealtFirst.push(c.id);
  }
}

export type { Attacker, ObjectFilter };
