// The `pay_mana` question (paying by hand, CR 601.2g-h): built from a cost and the player's pool; shared by casts / activations (resolve.ts) and
// "unless pays" / "you may pay" steps (unlesspay.ts). Declarations with a tax report the same text in their refusal.

import type { ParsedCost, Run } from "./core";
import { effectivePool, type SpendCtx } from "./manapool";
import { costString, poolShortfall } from "./mana";
import type { AskSpec } from "./steps";
import type { PayInfo, PlayerId } from "./types";

export interface PaymentPlan { need: ParsedCost; x: number; life: number; parts: PayInfo["parts"]; ctx: SpendCtx; what: string }

/** The pool as text: "{W}{U}{U}" ("" when empty). */
export function poolText(pool: Record<string, number>): string {
  return (["W", "U", "B", "R", "G", "C"]).map((c) => `{${c}}`.repeat(pool[c] ?? 0)).join("");
}

/** The question: shown while the pool is short; the player taps sources (each tap goes to the pool) and the payment is made as soon as it covers the cost. */
export function paySpec(r: Run, pid: PlayerId, plan: PaymentPlan): AskSpec {
  const pool = effectivePool(r, pid, plan.ctx) as Record<string, number>;
  const remaining = poolShortfall(r, pid, plan.need, plan.x, plan.ctx);
  const total = costString(plan.need, plan.x);
  return {
    kind: "pay_mana", player: pid,
    prompt: { title: `${plan.what}: pay ${total || "the cost"}`, instruction: `Your pool holds ${poolText(pool) || "no mana"}; ${remaining} more needed. Tap mana sources to add mana to your pool, then the cost is paid from it.` },
    options: [{ id: "pay", label: "Pay" }, { id: "cancel", label: "Cancel" }], min: 1, max: 1,
    pay: { cost: total, parts: plan.parts, remaining, life: plan.life, pool: Object.fromEntries(Object.entries(pool).filter(([, n]) => n > 0)), what: plan.what }
  };
}
