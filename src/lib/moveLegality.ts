// Central, deterministic legality gate for proposed moves.
//
// The rules engine is the referee; an agent (LLM or heuristic) only PROPOSES. Anything that is illegal under the Magic rules, or that the
// engine cannot actually perform (so it would be paid for and then silently do nothing), must be REJECTED before it is committed: no mana
// spent, no card moved, no stack item created. A rejected action is not "used": it is simply excluded from the options of the decision it was
// rejected in, so the seat can do something else now and may try it again later.
//
// This file is the pure core (no React, no AppFlow import, so it can be unit tested and shared by the live game and the self-play
// orchestrator):
//   - validateProposal      is this id still one of the currently-legal options (not stale, not hallucinated, not already rejected)?
//   - createRejectionLedger what was rejected in this decision and why, with a hard cap so a seat can never loop forever
//   - decideWithGate        ask -> validate -> (reject + re-ask, capped) -> deterministic fallback -> pass; always terminates
// The engine-aware half (card in the claimed zone, timing, land drop, target, payability, summoning sickness, ...) is `checkMoveLegal` in
// AppFlow.tsx, which explains WHY an action is illegal and is shared by the human and agent paths.
import type { LegalAgentAction } from "@/components/AppFlow";

export type RejectionCode = "unknown_action" | "stale" | "excluded" | "illegal" | "no_effect";

export type LegalityResult = { legal: true } | { legal: false; reason: string; code: RejectionCode };

/** How many rejected proposals one decision tolerates before the deterministic fallback takes over. */
export const MAX_DECISION_REJECTIONS = 3;

export function legalResult(): LegalityResult {
  return { legal: true };
}

export function illegalResult(reason: string, code: RejectionCode = "illegal"): LegalityResult {
  return { legal: false, reason, code };
}

export interface Rejection {
  actionId: string;
  label: string;
  reason: string;
  code: RejectionCode;
}

export interface RejectionLedger {
  readonly rejections: Rejection[];
  readonly excluded: Set<string>;
  readonly cap: number;
  reject(action: { id: string; label: string }, reason: string, code?: RejectionCode): void;
  exhausted(): boolean;
  /** Short lines for the LLM re-ask ("do not choose X again: reason"). Contains only the seat's own options, never hidden information. */
  notesForPrompt(): string[];
}

export function createRejectionLedger(cap: number = MAX_DECISION_REJECTIONS): RejectionLedger {
  const rejections: Rejection[] = [];
  const excluded = new Set<string>();
  return {
    rejections,
    excluded,
    cap,
    reject(action, reason, code = "illegal") {
      if (!excluded.has(action.id)) rejections.push({ actionId: action.id, label: action.label, reason, code });
      excluded.add(action.id);
    },
    exhausted() {
      return rejections.length >= cap;
    },
    notesForPrompt() {
      return rejections.map((item) => `Rejected, not legal right now: "${item.label}" (${item.reason}). Choose a different legalActions entry.`);
    }
  };
}

export type ProposalVerdict = { legal: true; action: LegalAgentAction } | { legal: false; reason: string; code: RejectionCode };

/**
 * Is the proposed id a currently-legal option? `fresh` must be generated from the LIVE state at validation time (after any await), so an id that
 * was legal when the question was asked but is not any more (state changed, card already played, mana already spent) is caught as stale.
 */
export function validateProposal(proposedId: string | undefined, fresh: LegalAgentAction[], excluded: ReadonlySet<string> = new Set()): ProposalVerdict {
  if (!proposedId) return { legal: false, reason: "no action was chosen", code: "unknown_action" };
  if (excluded.has(proposedId)) return { legal: false, reason: "that action was already rejected for this decision", code: "excluded" };
  const found = fresh.find((item) => item.id === proposedId);
  if (!found) return { legal: false, reason: "it is not one of the currently legal options (the card moved, a cost can no longer be paid, or the game state changed)", code: "stale" };
  return { legal: true, action: found };
}

const FALLBACK_ORDER: LegalAgentAction["actionType"][] = ["cast_spell", "cast_commander", "play_land", "activate_ability", "attack", "block"];

/** Best remaining legal action that is not excluded, else the first pass/end-turn option, else undefined (caller passes). */
export function pickFallback(fresh: LegalAgentAction[], excluded: ReadonlySet<string>, preferPass = false): LegalAgentAction | undefined {
  const remaining = fresh.filter((item) => !excluded.has(item.id));
  // Combat declarations: when the seat cannot give a legal answer, the safe default is NOT to attack/block.
  if (preferPass) return remaining.find((item) => item.actionType === "pass_priority" || item.actionType === "end_turn");
  for (const type of FALLBACK_ORDER) {
    const hit = remaining.find((item) => item.actionType === type);
    if (hit) return hit;
  }
  return remaining.find((item) => item.actionType === "pass_priority" || item.actionType === "end_turn") ?? remaining[0];
}

export interface GatedDecision<Proposal> {
  action: LegalAgentAction | undefined;
  /** The raw proposal the winning action came from (undefined when the deterministic fallback chose it). */
  proposal?: Proposal;
  source: "proposal" | "fallback" | "none";
  rejections: Rejection[];
}

/**
 * Ask the seat for an action; every proposal goes through the gate. A rejected proposal is excluded and the seat is asked again (at most `cap`
 * rejections), then the best remaining legal action is taken, else nothing (the caller passes). Terminates after at most cap + 1 asks.
 *   regenerate  fresh legal options from the live state
 *   ask         the decision maker (LLM, heuristic brain, ...); receives the options and the rejection notes so far
 *   check       optional extra engine-aware check on a candidate that is in the fresh list (returns the reason when it is not actually legal)
 *   onReject    called for each rejection (logging)
 */
export async function decideWithGate<Proposal extends { legalActionId?: string }>(input: {
  regenerate: () => LegalAgentAction[];
  ask: (options: LegalAgentAction[], notes: string[]) => Promise<Proposal | undefined>;
  check?: (action: LegalAgentAction) => LegalityResult;
  onReject?: (rejection: Rejection) => void;
  cap?: number;
  /** Fall back to passing (declare no attackers/blockers) rather than to the best remaining action. */
  preferPass?: boolean;
}): Promise<GatedDecision<Proposal>> {
  const ledger = createRejectionLedger(input.cap);
  const record = (action: { id: string; label: string }, reason: string, code: RejectionCode) => {
    ledger.reject(action, reason, code);
    input.onReject?.(ledger.rejections[ledger.rejections.length - 1] ?? { actionId: action.id, label: action.label, reason, code });
  };
  let asks = 0;
  while (!ledger.exhausted() && asks < ledger.cap + 1) {
    asks += 1;
    const options = input.regenerate().filter((item) => !ledger.excluded.has(item.id));
    if (options.length === 0) return { action: undefined, source: "none", rejections: ledger.rejections };
    const proposal = await input.ask(options, ledger.notesForPrompt());
    // validate against state regenerated AFTER the await, not the list the question was asked with
    const live = input.regenerate();
    const verdict = validateProposal(proposal?.legalActionId, live, ledger.excluded);
    if (verdict.legal) {
      const extra = input.check?.(verdict.action);
      if (!extra || extra.legal) return { action: verdict.action, proposal, source: "proposal", rejections: ledger.rejections };
      record(verdict.action, extra.reason, extra.code);
      continue;
    }
    // A proposal with no usable id (LLM down, invalid output) has nothing to reject: fall through to the deterministic pick immediately.
    if (!proposal?.legalActionId) break;
    record({ id: proposal.legalActionId, label: [...options, ...live].find((item) => item.id === proposal.legalActionId)?.label ?? proposal.legalActionId }, verdict.reason, verdict.code);
  }
  // Deterministic fallback: best remaining legal option that also passes the engine check; else pass.
  for (let guard = 0; guard < 50; guard += 1) {
    const picked = pickFallback(input.regenerate(), ledger.excluded, input.preferPass);
    if (!picked) return { action: undefined, source: "none", rejections: ledger.rejections };
    const extra = input.check?.(picked);
    if (!extra || extra.legal) return { action: picked, source: "fallback", rejections: ledger.rejections };
    record(picked, extra.reason, extra.code);
  }
  return { action: undefined, source: "none", rejections: ledger.rejections };
}

/** Did a commit actually change anything? Used to catch an action that was "applied" into a no-op (the state object is returned untouched). */
export function committedChange<T>(before: T, after: T): boolean {
  return before !== after;
}
