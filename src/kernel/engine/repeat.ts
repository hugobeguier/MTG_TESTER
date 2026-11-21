// step:repeat_for_each. "For each opponent / each creature you control / each player, <steps>". The list is fixed when the step
// starts (a snapshot); each iteration runs the nested steps with `iterated` (an object) or "that player" set to the item.
// Only imported by steps.ts.

import type { ObjectFilter, PlayerRef, Step } from "../schema";
import { Unsupported } from "./core";
import { objectsMatching, resolvePlayers } from "./query";
import type { StepSpec } from "./steps";

export const REPEAT_FIELDS = ["over", "steps"];
export const REPEAT_PLAYER_REFS = ["each_opponent", "each_player"];

export const repeatStep: StepSpec = {
  fields: REPEAT_FIELDS,
  run: (r, ex, step) => {
    const env = ex.env;
    const inner = (step.steps ?? []) as Step[];
    const over = step.over as PlayerRef | ObjectFilter | undefined;
    if (!over) throw new Unsupported("field:repeat_for_each.over");
    const ids = inner.map((s) => s.id).filter((x): x is string => !!x);
    const out: Step[] = [];
    if (typeof over === "string") {
      if (!REPEAT_PLAYER_REFS.includes(over)) throw new Unsupported(`field:repeat_for_each.over=${over}`);
      for (const p of resolvePlayers(r, over, env)) out.push({ kind: "__iter" as never, player: p, clear: ids } as Step, ...inner);
    } else {
      for (const id of objectsMatching(r, over, env)) out.push({ kind: "__iter" as never, object: id, clear: ids } as Step, ...inner);
    }
    out.push({ kind: "__iter" as never, clear: ids } as Step);
    return { push: out };
  }
};
