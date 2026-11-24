// The kernel AI's decision making by lookahead (pure, deterministic). Two entry points:
//   planMain(...)      what to cast / activate at a main phase with an empty stack, with which X / modes / targets / optional-cost answers (or nothing)
//   chooseDecision(...) which answer to give to a decision the seat owns (target, sacrifice, "may", "unless", ...), by trying each candidate answer
// Both clone the state through simulate.ts, let the stack resolve, and compare evaluate.ts scores from the seat's point of view.
import type { LegalAction } from "../engine/legal";
import { evaluate } from "./evaluate";
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

/** score + no-op verdict of a leaf against the position before the action (`excludeId`: the card cast / used, which always changes zone) */
function judge(leaf: Leaf, state: GameState, ctx: EngineContext, seat: PlayerId, base: ReturnType<typeof evaluate>, baseSigNoEx: string, excludeId?: string) {
  const ev = evaluate(leaf.state, ctx, seat, excludeId);
  return { delta: ev.score - base.score, noop: ev.sig === baseSigNoEx };
}

export function planMain(acts: LegalAction[], state: GameState, ctx: EngineContext, seat: PlayerId, banned: Set<string>, usage: Record<string, number>, work: Work = { n: 0, cap: DEFAULT_WORK }): Plan | undefined {
  const freeCards = new Set(acts.filter((a) => a.kind === "castSpell" && a.free && a.action && !banned.has(a.id)).map((a) => a.objectId + "|" + (a.face ?? "")));
  // a free cast (Omniscience ...) is never worse than paying: the paid way of the same card and face is not even simulated
  const roots = acts.filter((a) => a.action && !banned.has(a.id) && (a.kind === "castSpell" || (a.kind === "activateAbility" && !a.isMana)) && (usage[a.id] ?? 0) < 2 && !(a.kind === "castSpell" && !a.free && freeCards.has(a.objectId + "|" + (a.face ?? ""))));
  if (!roots.length) return undefined;
  const me = state.players.find((p) => p.id === seat)!;
  const base = evaluate(state, ctx, seat);
  const per = roots.length <= 6 ? 8 : roots.length <= 14 ? 4 : 2;
  const found: Array<Plan & { leaf: Leaf }> = [];
  for (const a of roots) {
    if (work.n >= work.cap) break;
    const exclude = a.objectId;
    const baseEx = evaluate(state, ctx, seat, exclude);
    const leaves = explore(state, a.action!, ctx, seat, work, { maxLeaves: per });
    let best: (Plan & { leaf: Leaf }) | undefined;
    for (const leaf of leaves) {
      if (!leaf.settled) continue;
      const j = judge(leaf, state, ctx, seat, base, baseEx.sig, exclude);
      if (j.noop) continue;
      const after = leaf.state.players.find((p) => p.id === seat);
      if (after && after.life <= 5 && after.life < me.life) continue; // never pay life (or take damage) into danger
      if (!best || j.delta > best.delta + 0.02) best = { action: a.action!, script: leaf.script, delta: j.delta, id: a.id, label: a.label, noop: false, leaf };
    }
    if (best) found.push(best);
  }
  found.sort((x, y) => y.delta - x.delta);
  // hidden information: an outcome that depends on the order of a library (a draw, a reveal, a search) is judged on two orders and averaged, so the AI
  // never plans on a card it could not know
  let winner: Plan | undefined;
  for (const f of found.slice(0, 3)) {
    if (f.delta <= 0) break;
    const a = roots.find((r) => r.id === f.id)!;
    const alt = explore(withReversedLibraries(state), f.action, ctx, seat, work, { branch: false, forced: f.script });
    const leaf = alt.find((l) => l.settled);
    let delta = f.delta;
    if (leaf) {
      const baseAlt = evaluate(withReversedLibraries(state), ctx, seat);
      const ev = evaluate(leaf.state, ctx, seat, a.objectId);
      delta = (f.delta + (ev.score - baseAlt.score)) / 2;
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

