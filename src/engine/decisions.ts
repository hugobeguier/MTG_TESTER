// Serializable "awaiting a decision from seat X" model (pure, no React). A prompt that used to be modal React state becomes a plain-data
// PendingDecision that a remote player could be shown and could answer later. Kinds so far: mana_color, declare_blockers, library_look,
// library_search (flavors manual / myriad / basic_land_fetch) and myriad_tap; more (rule choices, targets, ...) follow in later commits.
// Visibility rule: everything public in real Magic is visible to all seats; hands and libraries are private; "look at" is private to the
// looker, "reveal" is public. `visibility` says whether seats other than the addressee may see the full payload.

import type { ManaColor } from "@/lib/types";
import type { LibraryLookState } from "@/engine/flowTypes";

export type LibrarySearchFlavor = "manual" | "myriad" | "basic_land_fetch";

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
  | (DecisionBase & { kind: "declare_blockers"; attackerSeatId: string; defenderSeatId: string; attackerCardId: string; targetId: string })
  // Scry / surveil / reorder / dig of a library. `look` is the existing LibraryLookState payload; `look.cards`/`look.orderedCards` are the secret part.
  // Addressee = the looker (look.lookerSeatId, else look.seatId); Portent looks at ANOTHER player's library. Every mode is "look at" => private;
  // no libraryLook mode reveals publicly (reveal-top-N effects do not use this prompt). choose_one_bottom only reveals the one chosen card on pick.
  | (DecisionBase & { kind: "library_look"; look: LibraryLookState })
  // Library searches. flavor "manual": the player's own search button (destination, tapped); "myriad": Myriad Landscape (sourceCardId);
  // "basic_land_fetch": fetch-a-basic ETB (sourceCardId, sourceCardName). A "search" is private to the searcher.
  | (DecisionBase & { kind: "library_search"; flavor: LibrarySearchFlavor; destination?: "hand"; tapped?: boolean; sourceCardId?: string })
  // Myriad Landscape: which land to tap for the cost (payload mirrors MyriadTapChoiceState).
  | (DecisionBase & { kind: "myriad_tap"; cardId: string; cardName: string });

export type DecisionKind = PendingDecision["kind"];

// Slot key: one slot per kind, except library_search which gets one per flavor (manual / myriad / basic fetch were independent prompts and
// must never clobber each other).
export type SlotKey = Exclude<DecisionKind, "library_search"> | `library_search:${LibrarySearchFlavor}`;
export function slotKey(decision: PendingDecision): SlotKey {
  return decision.kind === "library_search" ? `library_search:${decision.flavor}` : decision.kind;
}

export type DecisionAnswer =
  | { id: string; kind: "color"; color: ManaColor }
  | { id: string; kind: "blockers"; cardIds: string[] }
  // library_look: pick one looked-at card (keep on top / bottom / graveyard / to hand / order next) or finish the look.
  | { id: string; kind: "look_pick"; cardId: string; action: "top" | "bottom" | "graveyard" | "hand" | "order" }
  | { id: string; kind: "look_done" }
  // library_search: the chosen card ids (myriad takes up to two, the others one; empty = find nothing).
  | { id: string; kind: "search_pick"; cardIds: string[] }
  // myriad_tap: tap the offered land (plain confirmation).
  | { id: string; kind: "tap_confirm" }
  | { id: string; kind: "decline" };

// What other seats get to see of a private decision (cardCount only for library_look: how many cards are looked at, never which).
export interface RedactedDecision {
  id: string;
  seatId: string;
  kind: DecisionKind;
  visibility: "private" | "public";
  sourceCardName?: string;
  cardCount?: number;
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
  if (decision.kind === "library_look") {
    if (answer.kind === "look_done") return { ok: true };
    if (answer.kind !== "look_pick") return { ok: false, reason: "a library_look decision needs a look_pick or look_done answer" };
    if (!decision.look.cards.some((card) => card.id === answer.cardId)) return { ok: false, reason: "that card is not among the looked-at cards" };
    return { ok: true };
  }
  if (decision.kind === "library_search") {
    if (answer.kind !== "search_pick") return { ok: false, reason: "a library_search decision needs a search_pick answer" };
    const max = decision.flavor === "myriad" ? 2 : 1;
    if (answer.cardIds.length > max) return { ok: false, reason: `a ${decision.flavor} search takes at most ${max} card${max === 1 ? "" : "s"}` };
    return { ok: true };
  }
  if (decision.kind === "myriad_tap") {
    if (answer.kind !== "tap_confirm") return { ok: false, reason: "a myriad_tap decision needs a tap_confirm answer" };
    return { ok: true };
  }
  if (answer.kind !== "blockers") return { ok: false, reason: "a declare_blockers decision needs a blockers answer" };
  return { ok: true };
}

// Private decisions are fully visible to the addressee only; public ones to everyone. The library_look payload (cards/orderedCards) is never
// copied into the redacted view.
export function viewForSeat(decision: PendingDecision, seatId: string): PendingDecision | RedactedDecision {
  if (decision.seatId === seatId || decision.visibility === "public") return decision;
  const redacted: RedactedDecision = { id: decision.id, seatId: decision.seatId, kind: decision.kind, visibility: decision.visibility, sourceCardName: decision.sourceCardName, redacted: true };
  if (decision.kind === "library_look") redacted.cardCount = decision.look.cards.length;
  return redacted;
}
