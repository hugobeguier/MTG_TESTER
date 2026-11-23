// Position evaluation for the kernel AI (pure, deterministic). score(state, seat) is "how good is this position for `seat`", from PUBLIC information plus
// the seat's own hand: opponents' hands and every library count only by size (never by content), so a simulated draw or search cannot leak what the AI
// could not know. The unit is roughly "one average card": a 2/2 creature ~ 4, a land ~ 1.3, a card in hand 0.8, a life point 0.3 (steeper when low).
import { effectiveViews, type ObjectView } from "../engine/legal";
import { parseManaCost } from "../engine/core";
import type { EngineContext, GameState, ObjId, PlayerId } from "../engine/types";

const KEYWORD_BONUS: Record<string, number> = {
  deathtouch: 1, indestructible: 1.5, hexproof: 1, shroud: 0.6, menace: 0.5, "first strike": 0.5, "double strike": 1.2, haste: 0.3, vigilance: 0.3, reach: 0.3,
  flash: 0.2, ward: 0.6, "protection": 0.6, infect: 0.5, toxic: 0.3, annihilator: 1.5, undying: 0.8, persist: 0.6, flying: 0.6, lifelink: 0.5, trample: 0.3, "can't be blocked": 0.8
};

/** Value of one permanent (a view of it). Creatures by size + keywords + mana value, planeswalkers by loyalty, other permanents by mana value; lands are valued in `evaluate` (diminishing). */
export function permanentValue(v: ObjectView): number {
  if (v.types.includes("creature")) {
    const hasPt = v.power !== undefined && v.toughness !== undefined;
    const p = Math.max(0, Number(hasPt ? v.power : v.manaValue ?? 0)), t = Math.max(0, Number(hasPt ? v.toughness : v.manaValue ?? 0));
    const defender = v.keywords.includes("defender");
    let val = 1.2 + (defender ? 0.35 : 0.85) * p + 0.7 * t + 0.25 * (v.manaValue ?? 0);
    for (const k of v.keywords) { const b = KEYWORD_BONUS[k]; if (b) val += k === "flying" || k === "lifelink" || k === "trample" || k === "double strike" ? b + 0.1 * p : b; }
    const extra = v.abilities.filter((a) => a.kind !== "keyword" && a.kind !== "mana").length;
    val += 0.35 * Math.min(3, extra);
    if (v.isCommander) val += 2;
    return val;
  }
  if (v.types.includes("planeswalker")) return 2 + 0.35 * (v.loyalty ?? 0) + 0.3 * (v.manaValue ?? 0);
  if (v.types.includes("land")) return 1.3;
  const mana = v.abilities.some((a) => a.kind === "mana");
  if (v.types.includes("battle")) return 1;
  return (mana ? 1 : 0.6) + 0.4 * (v.manaValue ?? 0) + (v.isCommander ? 2 : 0);
}

/** value of a life total: ~0.3 per point, flattening above 25, sharply negative below 12 */
export function lifeValue(life: number): number {
  const l = Math.max(life, -5);
  return 0.3 * Math.min(l, 25) + 0.1 * Math.max(0, l - 25) - (l < 12 ? 0.12 * (12 - l) * (12 - l) : 0);
}

export interface Evaluation {
  /** the position for `seat`: own value minus the opponents' (a blend of their average and their strongest) */
  score: number;
  /** a signature of everything an action could change (life, own hand, graveyards, permanents with counters / stats): equal signatures = the action changed nothing */
  sig: string;
  /** per player (alive or not) the value of that seat alone */
  perPlayer: Record<PlayerId, number>;
}

function playerValue(state: GameState, p: GameState["players"][number], views: Record<ObjId, ObjectView>, cmdDamageTaken: number): number {
  let val = lifeValue(p.life);
  const lands: number[] = [];
  for (const id of state.battlefield) {
    const o = state.objects[id];
    if (!o || o.controller !== p.id) continue;
    const v = views[id];
    if (!v) continue;
    if (v.types.includes("land") && !v.types.includes("creature")) { lands.push(1); continue; }
    val += permanentValue(v);
  }
  for (let i = 0; i < lands.length; i++) val += i < 7 ? 1.3 : 0.5;
  const hand = p.hand.length;
  val += 0.8 * Math.min(hand, 7) + 0.2 * Math.max(0, hand - 7);
  if (p.library.length < 7) val -= (7 - p.library.length) * 0.8;
  val -= 0.3 * cmdDamageTaken + (cmdDamageTaken >= 15 ? 3 : 0);
  val -= 1.5 * (p.counters?.poison ?? 0);
  if (state.monarch === p.id) val += 2;
  for (const id of p.command) if (state.objects[id]?.isCommander) val += 1.5; // a commander ready to be cast
  return val;
}

export function evaluate(state: GameState, ctx: EngineContext, seat: PlayerId, excludeId?: ObjId): Evaluation {
  const views = effectiveViews(state, ctx, state.battlefield);
  const perPlayer: Record<PlayerId, number> = {};
  const sig: string[] = [];
  for (const p of state.players) {
    const dmg = Object.entries(state.commanderDamage?.[p.id] ?? {}).reduce((m, [, d]) => Math.max(m, d), 0);
    perPlayer[p.id] = playerValue(state, p, views, dmg);
    const ids = (a: readonly ObjId[]) => a.filter((x) => x !== excludeId).join(",");
    sig.push(`${p.id}|${p.hasLost ? "L" : ""}${p.life}|h${p.id === seat ? ids(p.hand) : p.hand.length - (p.hand.includes(excludeId as ObjId) ? 1 : 0)}|l${p.id === seat ? p.library.join(",") : p.library.length}|g${ids(p.graveyard)}|e${ids(p.exile)}|c${ids(p.command)}|${JSON.stringify(p.counters ?? {})}`);
  }
  for (const id of state.battlefield) {
    const o = state.objects[id], v = views[id];
    if (!o || !v) continue;
    sig.push(`${id}:${o.controller}:${JSON.stringify(o.counters)}:${o.attachedTo ?? ""}:${v.power ?? ""}/${v.toughness ?? ""}:${v.keywords.join(".")}:${v.types.join(".")}`);
  }
  const me = state.players.find((p) => p.id === seat);
  const opps = state.players.filter((p) => p.id !== seat && !p.hasLost);
  let score = (perPlayer[seat] ?? 0);
  if (opps.length) {
    const vals = opps.map((p) => perPlayer[p.id]);
    score -= 0.5 * (vals.reduce((a, b) => a + b, 0) / vals.length) + 0.5 * Math.max(...vals);
  }
  score += 30 * state.players.filter((p) => p.id !== seat && p.hasLost).length;
  if (me?.hasLost) score -= 1000;
  if (state.gameOver?.winner === seat) score += 1000;
  else if (state.gameOver && state.gameOver.winner !== seat) score -= 1000;
  return { score, sig: sig.join("\n"), perPlayer };
}

/** Value of a single object wherever it is (battlefield permanent by its view; a card elsewhere by mana value): used to rank targets / sacrifices / discards. */
export function objectValue(state: GameState, ctx: EngineContext, id: ObjId): number {
  const o = state.objects[id];
  if (!o) return 0;
  if (o.zone === "battlefield") { try { return permanentValue(effectiveViews(state, ctx, [id])[id]); } catch { return 1; } }
  const def = ctx.cards(o.cardName);
  const mv = def ? parseManaCost(def.manaCost ?? "").mv : 0;
  if (def?.types.includes("land")) return 0.8;
  if (def?.types.includes("creature")) return 1 + 0.5 * mv + (def.power ? 0.2 * Number(def.power) : 0);
  return 0.8 + 0.3 * mv;
}
