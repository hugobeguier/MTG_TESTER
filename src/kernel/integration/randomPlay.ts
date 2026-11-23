// TEST SUPPORT: a seeded random player that drives a kernel game through legalActions (positions for property tests, smoke games for the host).
import { legalActions, type LegalAction } from "../engine/legal";
import { resolve } from "../engine/resolve";
import { defaultAnswer } from "../observer/actions";
import type { Action, EngineContext, GameState, PlayerId } from "../engine/types";

export function mulberry(seed: number): () => number {
  let s = seed | 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The player the engine is waiting for (decision owner, declaring player, priority holder), or undefined. */
export function actorOf(s: GameState): PlayerId | undefined {
  if (s.gameOver) return undefined;
  if (s.pending) return s.pending.player;
  const ex = s.combat?.expect;
  if (ex) return ex.kind === "attackers" ? ex.player : ex.players[0];
  return s.priority ?? undefined;
}

/** Choose one action of `acts` at random (passing is chosen less often so games develop) and turn it into a resolvable Action. */
export function pickAction(acts: LegalAction[], rng: () => number, s: GameState): Action | undefined {
  if (!acts.length) return undefined;
  const a0 = acts[0];
  if (a0.kind === "answerDecision") {
    const p = a0.pending!;
    const c = a0.choices?.length ? a0.choices[Math.floor(rng() * a0.choices.length)] : defaultAnswer(p, s, p.player) ?? (p.cancellable ? { cancel: true } : { ids: [] });
    return { type: "answerDecision", player: p.player, decisionId: p.id, choice: c };
  }
  if (a0.kind === "declareAttackers") {
    const list = (a0.attackers ?? []).filter((a) => a.defenders.length && (a0.mustAttack?.includes(a.id) || rng() < 0.5)).map((a) => ({ id: a.id, defender: a.defenders[Math.floor(rng() * a.defenders.length)] }));
    return { type: "declareAttackers", player: a0.player, attackers: list };
  }
  if (a0.kind === "declareBlockers") {
    const used = new Set<string>();
    const blocks: Array<{ blocker: string; attacker: string }> = [];
    for (const b of a0.blockers ?? []) if (rng() < 0.4 && b.attackers.length) { const at = b.attackers[Math.floor(rng() * b.attackers.length)]; if (!used.has(b.id)) { used.add(b.id); blocks.push({ blocker: b.id, attacker: at }); } }
    return { type: "declareBlockers", player: a0.player, blocks };
  }
  const nonPass = acts.filter((a) => a.kind !== "passPriority" && !(a.isMana && rng() < 0.85));
  const pool = nonPass.length && rng() < 0.7 ? nonPass : acts;
  return pool[Math.floor(rng() * pool.length)].action;
}

export interface Step { state: GameState; actor: PlayerId; acts: LegalAction[] }

/** Plays up to `steps` actions; `onPosition` sees every position (state before the action, the actor, their legal actions). Returns the final state. */
export function playRandom(state: GameState, ctx: EngineContext, seed: number, steps: number, onPosition?: (p: Step) => void): GameState {
  const rng = mulberry(seed);
  let s = state;
  for (let i = 0; i < steps; i++) {
    const actor = actorOf(s);
    if (!actor) break;
    const acts = legalActions(s, actor, ctx);
    onPosition?.({ state: s, actor, acts });
    const act = pickAction(acts, rng, s);
    if (!act) break;
    const res = resolve(s, act, ctx);
    if (res.error) { if (res.error.code === "loop_detected") { s = res.state; break; } continue; } // a rejected pick leaves the state alone; try again
    s = res.state;
  }
  return s;
}
