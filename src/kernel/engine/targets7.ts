// Kernel step 7: target-count forms of a TargetSpec ("any number of", "up to X", "for each opponent"). The bounds of a slot depend on the
// current state (X, number of candidates), so they are computed here instead of reading `spec.count` directly.

import type { TargetSpec } from "../schema";
import { opponentsOf, tryObj, type Run } from "./core";
import { evalQuantity, type QCtx } from "./query";

/** Minimum and maximum number of targets of ONE slot given its candidates (for perOpponent: per opponent). */
export function targetBounds(r: Run, spec: TargetSpec, q: QCtx, nCands: number): { min: number; max: number } {
  if (spec.anyNumber) return { min: 0, max: nCands };
  if (spec.maxQuantity !== undefined) {
    const max = Math.max(0, evalQuantity(r, spec.maxQuantity, q));
    return { min: Math.min(spec.count.min, max), max };
  }
  return { min: spec.count.min, max: spec.count.max };
}

/** Does the slot mention X (so X must be chosen before targets)? */
export const slotUsesX = (spec: TargetSpec): boolean => JSON.stringify(spec).includes('"ref":"X"');

/** The candidates belonging to one opponent (an object they control, or the player itself). */
export function ofOpponent(r: Run, cands: string[], opp: string): string[] {
  return cands.filter((id) => (id === opp) || tryObj(r, id)?.controller === opp);
}

export const opponentIds = (r: Run, pid: string): string[] => opponentsOf(r, pid).map((p) => p.id);

/** Upper bound for validating a whole answer to a slot (all opponents together for perOpponent). */
export function totalMax(r: Run, spec: TargetSpec, q: QCtx, nCands: number): number {
  const b = targetBounds(r, spec, q, nCands);
  return spec.perOpponent ? b.max * Math.max(1, opponentIds(r, q.controller).length) : b.max;
}
