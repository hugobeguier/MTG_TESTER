// Paying by hand in kernel mode (docs/kernel-payment-plan.md): the pure part of the payment banner. The engine opens a `pay_mana` decision when a cost is not
// covered by the mana pool; the player taps sources (clicking the glowing permanents, the T key, the inspector) and the cast completes by itself once the pool
// covers the cost. Nothing here taps anything: `suggestionFor` only COMPUTES which sources the "Auto-pay (suggest)" button would tap.
import { parseManaCost, type Run } from "@/kernel/engine/core";
import type { LegalAction } from "@/kernel/engine/legal";
import { suggestTaps } from "@/kernel/engine/mana";
import type { EngineContext, GameState, ObjId, PayInfo, PlayerId } from "@/kernel/engine/types";

export interface PaymentModel {
  /** the open decision's id (changes after every tap) */
  decisionId: string;
  what: string;
  pay: PayInfo;
  /** "Cast X" ... for the banner title */
  title: string;
  /** the whole message of the banner: total with its parts, the pool, what is missing */
  instruction: string;
  /** a declaration waiting for its tax instead of a pay_mana decision */
  declaration?: boolean;
}

const pretty = (s: string): string => s || "nothing";

/** The open payment of `human`, or undefined. */
export function paymentOf(state: GameState, human: PlayerId): PaymentModel | undefined {
  const p = state.pending;
  if (!p || p.kind !== "pay_mana" || p.player !== human || !p.pay) return undefined;
  return { decisionId: p.id, what: p.pay.what, pay: p.pay, title: p.pay.what, instruction: paymentInstruction(p.pay) };
}

/** "Pay {2}{W}{U}{B} = {W}{U}{B} + commander tax {2}. Pool: {W}{U}{B}. {2} more needed." */
export function paymentInstruction(pay: PayInfo): string {
  const parts = pay.parts.length > 1 ? ` (${pay.parts.map((x) => `${x.label.toLowerCase()} ${x.cost}`).join(" + ")})` : "";
  const pool = (["W", "U", "B", "R", "G", "C"]).map((c) => `{${c}}`.repeat(pay.pool[c] ?? 0)).join("");
  const life = pay.life > 0 ? ` and ${pay.life} life` : "";
  return `Total ${pretty(pay.cost)}${life}${parts}. Pool: ${pretty(pool)}. ${pay.remaining ? `${pay.remaining} more needed.` : "Covered."}`;
}

/** the sources the banner glows: every permanent with a mana ability usable now, plus the taps that can be taken back */
export function payableSources(legal: LegalAction[]): ObjId[] {
  const out = new Set<ObjId>();
  for (const a of legal) if (a.objectId && ((a.kind === "activateAbility" && a.isMana) || a.kind === "untapForMana")) out.add(a.objectId);
  return [...out];
}

/** The sources "Auto-pay (suggest)" proposes for the rest of the cost: never a sacrifice-self source or a damaging one; undefined = no suggestion that way. */
export function suggestionFor(state: GameState, ctx: EngineContext, human: PlayerId): ObjId[] | undefined {
  const p = state.pending;
  if (!p || p.kind !== "pay_mana" || !p.pay) return undefined;
  const run: Run = { s: state, events: [], defs: (n: string) => ctx.cards(n), ...(ctx.db ? { db: ctx.db } : {}), scanned: 0 };
  try { return suggestTaps(run, human, parseManaCost(p.pay.cost), 0); } catch { return undefined; }
}
