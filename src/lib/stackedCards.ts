// Rule 601.2a: a spell being cast is on the stack, not in the hand, so it can never be discarded, put back, or chosen
// as a card "in your hand". In this app a cast spell's card physically stays in its source zone (usually the hand) until it
// resolves, so every hand-based choice has to filter those cards out. This is the one shared definition of "which cards are
// stacked"; engine pickers, the choice view models, the AI's picks and the Rules Advisor context all read it.

import type { PendingAction } from "@/engine/types";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

/** Card ids of every (non-copy) spell currently on the stack, including the one holding the open priority window. */
export function spellCardIdsOnStack(stack: readonly PendingAction[], pending?: PendingAction): string[] {
  const ids = new Set<string>();
  for (const item of pending ? [...stack, pending] : stack) {
    if (item.type === "spell" && !item.isCopy) ids.add(item.cardId);
  }
  return Array.from(ids);
}

/** The session's recorded stacked-spell ids (stamped by the game-state choke point). */
export function stackedCardIds(session: Pick<GameSession, "stackSpellCardIds"> | undefined): readonly string[] {
  return session?.stackSpellCardIds ?? [];
}

/** The seat's hand minus any card that is on the stack as a spell. */
export function handExcludingStack(seat: PlayerSeat, excludeIds: readonly string[] | undefined): VisibleCard[] {
  if (!excludeIds || excludeIds.length === 0) return seat.board.hand;
  return seat.board.hand.filter((card) => !excludeIds.includes(card.id));
}

/** A copy of the seat whose hand no longer lists stacked spells; hand it to any picker that only takes a seat. */
export function seatWithoutStackedCards(session: Pick<GameSession, "stackSpellCardIds">, seat: PlayerSeat): PlayerSeat {
  const ids = session.stackSpellCardIds;
  if (!ids || ids.length === 0) return seat;
  return { ...seat, board: { ...seat.board, hand: handExcludingStack(seat, ids) } };
}
