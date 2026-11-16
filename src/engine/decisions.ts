// Serializable "awaiting a decision from seat X" model (pure, no React). A prompt that used to be modal React state becomes a plain-data
// PendingDecision that a remote player could be shown and could answer later. Only two kinds exist so far (mana_color, declare_blockers);
// more kinds (library look, rule choices, targets, ...) follow in later commits.
// Visibility rule: everything public in real Magic is visible to all seats; hands and libraries are private; "look at" is private to the
// looker, "reveal" is public. `visibility` says whether seats other than the addressee may see the full payload.

import type { ManaColor } from "@/lib/types";

export interface DecisionBase {
  id: string;
  // The addressee: the seat that must answer.
  seatId: string;
  visibility: "private" | "public";
  sourceCardId?: string;
  sourceCardName?: string;
  prompt?: string;
}

export type PendingDecision =
  | (DecisionBase & { kind: "mana_color"; choices: ManaColor[]; cardId: string; cardName: string; location: "battlefield" | "command" })
  | (DecisionBase & { kind: "declare_blockers"; attackerSeatId: string; defenderSeatId: string; attackerCardId: string; targetId: string });

export type DecisionKind = PendingDecision["kind"];

export type DecisionAnswer =
  | { id: string; kind: "color"; color: ManaColor }
  | { id: string; kind: "blockers"; cardIds: string[] }
  | { id: string; kind: "decline" };

// What other seats get to see of a private decision.
export interface RedactedDecision {
  id: string;
  seatId: string;
  kind: DecisionKind;
  visibility: "private" | "public";
  sourceCardName?: string;
  redacted: true;
}

// Double-open guard: a slot holds one decision; opening into an occupied slot returns the existing one unchanged.
export function openDecision(current: PendingDecision | undefined, next: PendingDecision): { decision: PendingDecision; ok: boolean } {
  if (current) return { decision: current, ok: false };
  return { decision: next, ok: true };
}

// Deterministic id from a counter the caller owns.
export function decisionIdFor(counter: number): string {
  return `decision-${counter}`;
}

// `fromSeatId` is the seat the answer came from; the caller supplies it (the transport knows who sent it).
export function validateAnswer(decision: PendingDecision, answer: DecisionAnswer, fromSeatId: string): { ok: true } | { ok: false; reason: string } {
  if (answer.id !== decision.id) return { ok: false, reason: "answer id does not match the open decision" };
  if (fromSeatId !== decision.seatId) return { ok: false, reason: "answer came from a seat that was not asked" };
  if (answer.kind === "decline") return { ok: true };
  if (decision.kind === "mana_color") {
    if (answer.kind !== "color") return { ok: false, reason: "a mana_color decision needs a color answer" };
    if (!decision.choices.includes(answer.color)) return { ok: false, reason: "that color was not offered" };
    return { ok: true };
  }
  if (answer.kind !== "blockers") return { ok: false, reason: "a declare_blockers decision needs a blockers answer" };
  return { ok: true };
}

export function viewForSeat(decision: PendingDecision, seatId: string): PendingDecision | RedactedDecision {
  if (decision.seatId === seatId || decision.visibility === "public") return decision;
  return { id: decision.id, seatId: decision.seatId, kind: decision.kind, visibility: decision.visibility, sourceCardName: decision.sourceCardName, redacted: true };
}
