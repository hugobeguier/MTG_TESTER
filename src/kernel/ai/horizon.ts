// LOOKAHEAD HORIZON for the kernel AI (pure, deterministic): simulate.ts stops when the stack is empty, so "at the beginning of my end step ..." effects and delayed
// triggers are never seen. extendToEndStep() carries a settled simulated state through the rest of the AI's own turn up to the end step trigger window (no
// attackers declared, the triggers put on the stack and resolved with the policy answers) so the effects flow into evaluate.ts. It is only used when it can
// matter (endStepLive) and spends the same engine-step budget (Work) as everything else, with its own small clamp, so it never loops.
import { resolve } from "../engine/resolve";
import type { EngineContext, GameState, PlayerId } from "../engine/types";
import { policyAnswer, type Work } from "./simulate";
import { shapeOf } from "./shape";
import type { DeckProfile } from "./profile";

/** most engine steps one horizon run may take */
export const HORIZON_STEPS = 40;

/** can the rest of this turn change the position through an end-step / delayed trigger of `seat`? (cheap: a scan of its permanents) */
export function endStepLive(state: GameState, ctx: EngineContext, seat: PlayerId, profile?: DeckProfile): boolean {
  if (state.turn.active !== seat || state.gameOver) return false;
  if ((state.delayedTriggers ?? []).some((d) => d.controller === seat)) return true;
  if (profile && !profile.hasEndStepPayoff) return false; // the deck has nothing that acts at an end step
  for (const id of state.battlefield) {
    const o = state.objects[id];
    if (o && o.controller === seat && shapeOf(ctx.cards(o.cardName)).endStepEffect) return true;
  }
  return false;
}

/**
 * The state after the end-step triggers of the current turn have resolved, or undefined when that could not be reached cheaply (budget out, a refusal, a
 * decision the policy cannot answer). Nothing is declared in combat; opponents never act. Never mutates its input.
 */
export function extendToEndStep(state: GameState, ctx: EngineContext, seat: PlayerId, work: Work): GameState | undefined {
  const startTurn = state.turn.number;
  let s = state;
  let reachedEnd = s.turn.phase === "end_step";
  for (let i = 0; i < HORIZON_STEPS; i++) {
    if (work.n >= work.cap || s.gameOver || s.turn.number !== startTurn) return undefined;
    if (s.pending) {
      const p = s.pending;
      work.n++;
      let r;
      try { r = resolve(s, { type: "answerDecision", player: p.player, decisionId: p.id, choice: policyAnswer({ ...p }, s, ctx, p.player) }, ctx); } catch { return undefined; }
      if (r.error) return undefined;
      s = r.state;
      continue;
    }
    if (s.turn.phase === "end_step") reachedEnd = true;
    if (s.stack.length) {
      if (!s.priority) return undefined;
      work.n++;
      let r;
      try { r = resolve(s, { type: "passPriority", player: s.priority, fastForward: true }, ctx); } catch { return undefined; }
      if (r.error) return undefined;
      s = r.state;
      continue;
    }
    if (reachedEnd) return s; // at the end step with the stack empty: the triggers have run
    work.n++;
    let r;
    try { r = resolve(s, { type: "advancePhase", player: seat }, ctx); } catch { return undefined; }
    if (r.error) return undefined;
    s = r.state;
  }
  return undefined;
}
