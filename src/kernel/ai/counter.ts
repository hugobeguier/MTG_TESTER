// Should this seat spend a counterspell on the opponent's spell on the stack? Deterministic: a threat score for the spell against a threshold that depends on
// the counter (hard / soft "unless its controller pays") and on this seat's situation. Pure: reads state, never mutates it.
import { effectiveView, type ObjectView } from "@/kernel/engine/legal";
import type { EngineContext, GameState, ObjId, PlayerId, StackItem } from "@/kernel/engine/types";

function view(state: GameState, ctx: EngineContext, id: ObjId): ObjectView | undefined {
  try { return effectiveView(state, id, ctx); } catch { return undefined; }
}

/** "unless its controller pays {1}" -> 1; undefined for a hard counter. Non-numeric costs (X, life) are read as 1 per symbol. */
export function softCounterTax(text: string): number | undefined {
  const m = /unless (?:its controller|that player|they|the player) pays? ((?:\{[^}]+\})+)/i.exec(text);
  if (!m) return undefined;
  let n = 0;
  for (const s of m[1].match(/\{([^}]+)\}/g) ?? []) { const v = s.slice(1, -1); n += /^\d+$/.test(v) ? Number(v) : 1; }
  return n;
}

/** How much a spell matters (about 0 = trivial, 2.5+ = worth a card, 5+ = bomb). Cheap mana rocks, cantrips and small creatures stay low; commanders, planeswalkers, big creatures, sweepers rate high. */
export function spellThreat(state: GameState, ctx: EngineContext, objectId: ObjId): number {
  const v = view(state, ctx, objectId);
  if (!v) return 1;
  const mv = v.manaValue ?? 0;
  const text = v.abilities.map((a) => a.text).join(" ");
  const manaAbility = v.abilities.some((a) => a.kind === "mana");
  let t: number;
  if (v.types.includes("creature")) {
    t = 0.6 + 0.45 * mv + 0.15 * Math.max(0, Number(v.power ?? 0)) + 0.3 * Math.min(3, v.abilities.filter((a) => a.kind !== "keyword" && a.kind !== "mana").length);
  } else if (v.types.includes("planeswalker")) {
    t = 2.5 + 0.4 * mv;
  } else if (v.types.includes("instant") || v.types.includes("sorcery")) {
    t = 0.4 + 0.45 * mv;
    if (/\b(?:destroy|exile) all\b|\beach (?:other )?(?:creature|player)\b|extra turn|\bgain control\b/i.test(text)) t += 2;
  } else if (manaAbility) {
    t = 0.2 + 0.2 * mv; // a mana rock / dork-like permanent: low impact unless it makes a lot
    if (/\{[CWUBRG]\}\{[CWUBRG]\}/.test(text) || /\badd (?:two|three)\b/i.test(text)) t += 2.2;
  } else {
    t = 0.5 + 0.4 * mv; // other artifacts / enchantments / battles
    if (/\b(?:destroy|exile) all\b|\beach (?:other )?(?:creature|player)\b/i.test(text)) t += 1;
  }
  if (v.isCommander) t += 3;
  return t;
}

/** Mana the spell's controller still has after paying for it: pool plus every untapped permanent with a mana ability (a rock or dork counts 1; "add {C}{C}" counts 2). */
export function spareMana(state: GameState, ctx: EngineContext, who: PlayerId): number {
  const p = state.players.find((x) => x.id === who);
  let n = p ? Object.values(p.manaPool as Record<string, number>).reduce((a, b) => a + (b || 0), 0) : 0;
  for (const id of state.battlefield) {
    const o = state.objects[id];
    if (!o || o.controller !== who || o.tapped) continue;
    const v = view(state, ctx, id);
    if (!v) continue;
    const mana = v.abilities.filter((a) => a.kind === "mana");
    if (!mana.length) continue;
    if (v.types.includes("creature") && !v.types.includes("land") && v.summoningSick) continue;
    n += mana.some((a) => /\{[CWUBRG]\}\{[CWUBRG]\}/.test(a.text) || /\badd (?:two|three)\b/i.test(a.text)) ? 2 : 1;
  }
  return n;
}

/**
 * Whether to cast `counterId` (a counterspell in `seat`'s hand) against `top`.
 *  - threat of the spell must reach a threshold: 2 for a hard counter, 1.5 for a soft one (Mana Tithe is a 1-mana card);
 *  - a soft counter ("unless its controller pays N") is only cast when the caster has fewer spare mana than N (otherwise they just pay, and it is a wasted card);
 *  - a commander or a bomb is countered regardless of how the numbers fall (threshold passed by a wide margin);
 *  - holding a second counterspell, or a full grip (7+ cards, would discard anyway), lowers the threshold; the threshold is not relaxed for the only counter.
 */
export function shouldCounter(state: GameState, ctx: EngineContext, seat: PlayerId, top: StackItem, counterId: ObjId): boolean {
  if (!top.objectId) return false;
  const cv = view(state, ctx, counterId);
  const text = cv?.abilities.map((a) => a.text).join(" ") ?? "";
  const tax = softCounterTax(text);
  if (tax !== undefined && spareMana(state, ctx, top.controller) >= tax) return false;
  let threshold = tax !== undefined ? 1.5 : 2;
  const me = state.players.find((p) => p.id === seat);
  if ((me?.hand.length ?? 0) >= 7) threshold -= 1;
  const others = (me?.hand ?? []).filter((id) => id !== counterId && /\bcounter target (?:\w+ )*spell\b/i.test(view(state, ctx, id)?.abilities.map((a) => a.text).join(" ") ?? ""));
  if (others.length) threshold -= 0.5;
  return spellThreat(state, ctx, top.objectId) >= threshold;
}
