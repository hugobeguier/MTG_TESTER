// How the kernel AI pays (CR 601.2g-h): it PLANS the payment before it casts. The chosen action is rehearsed on a clone in which the AI pays by hand, up to the
// `pay_mana` question; the plan then picks the sources to tap with a policy and the action goes out with them as `payWith` (so the engine taps exactly those):
//   - free sources first: plain lands, mana rocks, Talisman / pain-land colorless; single-purpose sources before flexible ones
//   - sources whose colors the rest of the hand still needs are kept for last
//   - a sacrifice-self source (Treasure, Lotus Petal) and a source that hurts (pain colors, Mana Confluence) only when nothing else pays, and a hurting one never
//     when it would leave the AI at or below its life floor
// Pure and deterministic: no randomness, no clock; the rehearsal costs a handful of `resolve` calls.
import { resolve } from "../engine/resolve";
import { suggestTaps, type TapPolicy } from "../engine/mana";
import { parseManaCost, type Run } from "../engine/core";
import type { Action, EngineContext, GameState, ObjId, PlayerId } from "../engine/types";
import type { ScriptEntry } from "./simulate";
import { policyAnswer } from "./simulate";

/** below this life the AI never pays life / takes damage for mana */
export const LIFE_FLOOR = 6;

/** colors the rest of the hand (everything but the card being cast) asks for, by number of symbols */
export function handColorNeeds(state: GameState, ctx: EngineContext, seat: PlayerId, except?: ObjId): Record<string, number> {
  const out: Record<string, number> = {};
  const me = state.players.find((p) => p.id === seat);
  for (const id of me?.hand ?? []) {
    if (id === except) continue;
    const name = state.objects[id]?.cardName;
    const cost = name ? ctx.cards(name)?.manaCost : undefined;
    for (const m of cost?.matchAll(/\{([WUBRG])\}/g) ?? []) out[m[1]] = (out[m[1]] ?? 0) + 1;
  }
  return out;
}

/** Rehearse `action` on a clone with the seat paying by hand; the total cost the engine asks for (what is left to pay), or undefined when the action needs no payment / cannot be followed. */
function rehearse(state: GameState, action: Action, ctx: EngineContext, seat: PlayerId, script: ScriptEntry[]): { cost: string; sourceId?: ObjId } | undefined {
  const s0 = structuredClone(state);
  s0.config.manualPay = [seat];
  const { autoPay: _a, payWith: _p, ...bare } = action as Action & { autoPay?: boolean; payWith?: ObjId[] }; void _a; void _p;
  let res = resolve(s0, bare as Action, ctx);
  const queue = [...script];
  for (let i = 0; i < 12 && !res.error && res.state.pending && res.state.pending.kind !== "pay_mana"; i++) {
    const p = res.state.pending;
    const choice = queue.length && queue[0].kind === p.kind && p.player === seat ? queue.shift()!.choice : policyAnswer(p, res.state, ctx, p.player);
    res = resolve(res.state, { type: "answerDecision", player: p.player, decisionId: p.id, choice }, ctx);
  }
  const p = res.state.pending;
  if (res.error || !p || p.kind !== "pay_mana" || !p.pay || p.player !== seat) return undefined;
  return { cost: p.pay.cost };
}

/** The sources the AI taps for this action, chosen by the policy above; undefined = let the engine pay (it cannot be rehearsed, or the pool already covers it). */
export function planPayment(state: GameState, action: Action, ctx: EngineContext, seat: PlayerId, script: ScriptEntry[] = []): ObjId[] | undefined {
  if (action.type !== "castSpell" && action.type !== "activateAbility" && action.type !== "unlockDoor" && action.type !== "turnFaceUp" && action.type !== "castPrepared") return undefined;
  let rehearsal: ReturnType<typeof rehearse>;
  try { rehearsal = rehearse(state, action, ctx, seat, script); } catch { return undefined; }
  if (!rehearsal) return undefined;
  const need = parseManaCost(rehearsal.cost);
  const run: Run = { s: state, events: [], defs: (n: string) => ctx.cards(n), ...(ctx.db ? { db: ctx.db } : {}), scanned: 0 };
  const cardId = action.type === "castSpell" ? action.cardId : undefined;
  const keep = handColorNeeds(state, ctx, seat, cardId) as TapPolicy["keep"];
  const life = state.players.find((p) => p.id === seat)?.life ?? 0;
  const exclude = action.type === "activateAbility" ? [action.sourceId] : [];
  const tries: TapPolicy[] = [{ noOneShot: true, noHurt: true, keep }, { noOneShot: true, noHurt: life <= LIFE_FLOOR, keep }, { noHurt: true, keep }, { noHurt: life <= LIFE_FLOOR, keep }];
  for (const policy of tries) {
    const picks = suggestTaps(run, seat, need, 0, undefined, policy, exclude);
    if (picks) return picks;
  }
  return undefined;
}

/** `action` with the planned sources attached (payWith + autoPay), or unchanged when there is nothing to plan. */
export function withPlannedPayment(action: Action, state: GameState, ctx: EngineContext, seat: PlayerId, script: ScriptEntry[] = []): Action {
  const picks = planPayment(state, action, ctx, seat, script);
  if (!picks || !picks.length) return action;
  return { ...action, payWith: picks, autoPay: true } as Action;
}
