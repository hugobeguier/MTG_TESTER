// Decision protocol for choosing WHICH counters move / are removed (kernel step 7): Resourceful Defense, The Ozolith ("move any number of
// counters"), Hopeful Initiate / Retribution of the Ancients ("remove N +1/+1 counters from among creatures you control").
//   - decision kind `assign_counters`; `pending.counters = {min, max, available}`; the answer is `choice.assign`.
//     "available" maps an option id to how many counters it can give: a counter KIND (removing from one permanent) or an OBJECT id
//     (removing counters of one kind from among several permanents). The amounts must add up to between min and max.

import type { ObjectFilter, Prompt } from "../schema";
import { label, Reject, tryObj, type Run } from "./core";
import { evalQuantity, objectsMatching, type QCtx } from "./query";
import type { AskSpec } from "./steps";
import type { Choice, ObjId, PlayerId } from "./types";

export type CounterSource = { kind: string; from: ObjectFilter };

/** Objects (and how many counters of `kind` each) a "remove counters from among" cost can draw on. */
export function counterCandidates(r: Run, kind: string, from: ObjectFilter, q: QCtx): Array<{ id: ObjId; n: number }> {
  return objectsMatching(r, from, q).map((id) => ({ id, n: tryObj(r, id)?.counters[kind] ?? 0 })).filter((x) => x.n > 0);
}

export const counterCount = (r: Run, c: { count?: unknown }, q: QCtx): number => (typeof c.count === "number" ? c.count : c.count === undefined ? 0 : evalQuantity(r, c.count as never, q));

/** The question: split `max` (at least `min`) between the options. */
export function counterSpec(r: Run, player: PlayerId, prompt: Prompt, available: Record<string, number>, min: number, max: number, labelOf: (id: string) => string): AskSpec {
  return {
    kind: "assign_counters", player, prompt, options: Object.keys(available).map((id) => ({ id, label: labelOf(id) })), min, max,
    counters: { min, max, available: { ...available } }
  };
}

/** Validate an `assign` answer against the spec and return it (never mutates). */
export function checkCounterAnswer(spec: AskSpec, answer: Choice): Record<string, number> {
  const c = spec.counters!;
  const asg = answer.assign ?? {};
  let sum = 0;
  for (const [id, v] of Object.entries(asg)) {
    if (!(id in c.available)) throw new Reject("invalid_choice", `"${id}" is not a legal option`);
    if (!Number.isInteger(v) || v < 0) throw new Reject("invalid_choice", "amounts must be whole numbers, 0 or more");
    if (v > c.available[id]) throw new Reject("invalid_choice", `only ${c.available[id]} available from ${id}`);
    sum += v;
  }
  if (sum < c.min || sum > c.max) throw new Reject("invalid_choice", `the amounts must add up to ${c.min === c.max ? c.min : `${c.min}-${c.max}`}, got ${sum}`);
  return Object.fromEntries(Object.entries(asg).filter(([, v]) => v > 0));
}

export const objectLabel = (r: Run) => (id: string) => label(r, id);
