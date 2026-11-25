// The kernel AI's decision making by lookahead (pure, deterministic). Two entry points:
//   planMain(...)      what to cast / activate at a main phase with an empty stack, with which X / modes / targets / optional-cost answers (or nothing)
//   chooseDecision(...) which answer to give to a decision the seat owns (target, sacrifice, "may", "unless", ...), by trying each candidate answer
// Both clone the state through simulate.ts, let the stack resolve, and compare evaluate.ts scores from the seat's point of view.
import type { LegalAction } from "../engine/legal";
import { evaluate } from "./evaluate";
import { endStepLive, extendToEndStep } from "./horizon";
import { shapeOf } from "./shape";
import type { DeckProfile } from "./profile";
import { candidates, explore, policyAnswer, withReversedLibraries, type Leaf, type ScriptEntry, type Work } from "./simulate";
import type { Action, Choice, EngineContext, GameState, PendingView, PlayerId } from "../engine/types";

export interface Plan {
  action: Action;
  /** the answers to give, in order, to the decisions the action opens */
  script: ScriptEntry[];
  /** score of the resulting position minus the score now (hidden-information robust) */
  delta: number;
  id: string;
  label: string;
  /** the simulated position after the action (public effect) */
  noop: boolean;
}

/** budget: how many engine steps one decision may spend (a count, so the result never depends on machine speed) */
export const DEFAULT_WORK = 900;

/**
 * The score the seat gets for a position: the position itself, or (when the seat has an end-step / delayed payoff, horizon.ts) the position after this turn's
 * end-step triggers resolved. Baseline and leaves go through the same function, so only what the action CHANGES shows up in the delta.
 */
type Scorer = (s: GameState) => number;

function makeScorer(state: GameState, ctx: EngineContext, seat: PlayerId, work: Work, profile?: DeckProfile): Scorer {
  let horizon = true;
  const memo = new WeakMap<GameState, number>();
  const raw = (s: GameState): number => {
    if (horizon && endStepLive(s, ctx, seat, profile)) { const h = extendToEndStep(s, ctx, seat, work); if (h) return evaluate(h, ctx, seat, undefined, profile).score; if (s === state) horizon = false; } // too expensive here: no horizon for this decision
    return evaluate(s, ctx, seat, undefined, profile).score;
  };
  const baseScore = raw(state);
  memo.set(state, baseScore);
  return (s) => { const m = memo.get(s); if (m !== undefined) return m; const v = raw(s); memo.set(s, v); return v; };
}

/** is a sacrifice outlet worth trying first? (the seat controls a payoff for creatures dying, a recursion engine or an end-step effect) */
function payoffLive(state: GameState, ctx: EngineContext, seat: PlayerId, profile?: DeckProfile): boolean {
  if (profile && !profile.sacOutlets.length && !profile.recursion.length) return false;
  for (const id of state.battlefield) {
    const o = state.objects[id];
    if (!o || o.controller !== seat) continue;
    const sh = shapeOf(ctx.cards(o.cardName));
    if (sh.deathPayoff || sh.recursionEngine || sh.endStepEffect) return true;
  }
  return false;
}

export function planMain(acts: LegalAction[], state: GameState, ctx: EngineContext, seat: PlayerId, banned: Set<string>, usage: Record<string, number>, work: Work = { n: 0, cap: DEFAULT_WORK }, profile?: DeckProfile): Plan | undefined {
  const freeCards = new Set(acts.filter((a) => a.kind === "castSpell" && a.free && a.action && !banned.has(a.id)).map((a) => a.objectId + "|" + (a.face ?? "")));
  // a free cast (Omniscience ...) is never worse than paying: the paid way of the same card and face is not even simulated
  let roots = acts.filter((a) => a.action && !banned.has(a.id) && (a.kind === "castSpell" || (a.kind === "activateAbility" && !a.isMana)) && (usage[a.id] ?? 0) < 2 && !(a.kind === "castSpell" && !a.free && freeCards.has(a.objectId + "|" + (a.face ?? ""))));
  if (!roots.length) return undefined;
  // planning priority: when a payoff for creatures dying / returning is live, the sacrifice outlets are explored first (they would otherwise be starved by the step budget)
  if (payoffLive(state, ctx, seat, profile)) {
    const outlet = (a: LegalAction): number => (a.kind === "activateAbility" && a.objectId && shapeOf(ctx.cards(state.objects[a.objectId]?.cardName ?? "")).sacOutlet ? 0 : 1);
    roots = roots.map((r, i) => ({ r, i })).sort((x, y) => outlet(x.r) - outlet(y.r) || x.i - y.i).map((x) => x.r);
  }
  const me = state.players.find((p) => p.id === seat)!;
  const base = evaluate(state, ctx, seat, undefined, profile);
  const scorer = makeScorer(state, ctx, seat, work, profile);
  const baseScore = scorer(state);
  const per = roots.length <= 6 ? 8 : roots.length <= 14 ? 4 : 2;
  const found: Array<Plan & { leaf: Leaf }> = [];
  for (const a of roots) {
    if (work.n >= work.cap) break;
    const exclude = a.objectId;
    const baseEx = evaluate(state, ctx, seat, exclude, profile);
    const leaves = explore(state, a.action!, ctx, seat, work, { maxLeaves: per });
    let best: (Plan & { leaf: Leaf }) | undefined;
    // screen every leaf on the position itself (no-op verdict, danger check), then re-judge the most promising ones past the stack to the end step (horizon.ts)
    const screened: Array<{ leaf: Leaf; pre: number }> = [];
    for (const leaf of leaves) {
      if (!leaf.settled) continue;
      const ev = evaluate(leaf.state, ctx, seat, exclude, profile);
      if (ev.sig === baseEx.sig) continue; // changed nothing
      const after = leaf.state.players.find((p) => p.id === seat);
      if (after && after.life <= 5 && after.life < me.life) continue; // never pay life (or take damage) into danger
      screened.push({ leaf, pre: ev.score - base.score });
    }
    // (leaf order is kept for ties: the first of equally good answers wins, as before)
    const live = screened.filter((x) => endStepLive(x.leaf.state, ctx, seat, profile)).sort((x, y) => y.pre - x.pre).slice(0, 3);
    for (const { leaf, pre } of screened) {
      let delta = pre;
      if (endStepLive(leaf.state, ctx, seat, profile)) { if (!live.some((x) => x.leaf === leaf)) continue; delta = scorer(leaf.state) - baseScore; }
      if (!best || delta > best.delta + 0.02) best = { action: a.action!, script: leaf.script, delta, id: a.id, label: a.label, noop: false, leaf };
    }
    if (best) found.push(best);
  }
  found.sort((x, y) => y.delta - x.delta);
  // hidden information: an outcome that depends on the order of a library (a draw, a reveal, a search) is judged on two orders and averaged, so the AI
  // never plans on a card it could not know
  let winner: Plan | undefined;
  for (const f of found.slice(0, 3)) {
    if (f.delta <= 0) break;
    const alt = explore(withReversedLibraries(state), f.action, ctx, seat, work, { branch: false, forced: f.script });
    const leaf = alt.find((l) => l.settled);
    let delta = f.delta;
    if (leaf) {
      const rev = withReversedLibraries(state);
      delta = (f.delta + (scorer(leaf.state) - scorer(rev))) / 2;
    }
    if (delta > 0 && (!winner || delta > winner.delta)) winner = { action: f.action, script: f.script, delta, id: f.id, label: f.label, noop: false };
  }
  return winner;
}

/** The answer the seat gives to a decision it owns: each candidate answer is simulated (the stack resolved) and the best resulting position wins; ties keep the policy answer. */
export function chooseDecision(p: PendingView, state: GameState, ctx: EngineContext, seat: PlayerId, work: Work = { n: 0, cap: 300 }): Choice {
  let cands: Choice[] = [];
  try { cands = candidates(p, state, ctx, seat); } catch { cands = []; }
  if (cands.length < 2) return cands[0] ?? policyAnswer(p, state, ctx, seat);
  let best = cands[0], bestScore = -Infinity;
  for (const c of cands) {
    if (work.n >= work.cap && bestScore > -Infinity) break;
    const leaves = explore(state, { type: "answerDecision", player: p.player, decisionId: p.id, choice: c }, ctx, seat, work, { branch: false, maxLeaves: 1 });
    const leaf = leaves.find((l) => l.settled);
    if (!leaf) continue;
    const s = evaluate(leaf.state, ctx, seat).score;
    if (s > bestScore + 1e-9) { bestScore = s; best = c; }
  }
  return best;
}

