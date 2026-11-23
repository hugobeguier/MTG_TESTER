// Test helpers for the step 10 tests.
import type { Table } from "./testkit";
import type { Choice } from "./types";

type P = { kind: string; player: string; id: string; options: Array<{ id: string; label?: string }>; min: number; max: number } | null;
/** Answer every pending decision with `pick` (default: yes / first option) and resolve the stack until nothing is left. */
export function drain(t: Table, pick?: (p: NonNullable<P>) => Choice | undefined, max = 60): void {
  for (let i = 0; i < max; i++) {
    const p = t.state.pending as never as P;
    if (p) {
      const c = pick?.(p) ?? (p.kind === "choose_yes_no" ? { yes: true } : { ids: p.options.slice(0, Math.max(p.min, 0)).map((o) => o.id) });
      t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: c });
      continue;
    }
    if (t.state.stack.length || t.state.triggerQueue.length) { t.ok({ type: "passPriority", player: t.state.priority! }); continue; }
    return;
  }
}
export const toAttackers = (t: Table, player = "p1"): void => { for (let i = 0; i < 6 && t.state.turn.phase !== "declare_attackers"; i++) t.ok({ type: "advancePhase", player }); };
