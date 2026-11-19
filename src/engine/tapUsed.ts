// "Used" taps: the rule behind the manual untap shortcut (the "T" hotkey / toggle tap) for HUMAN seats.
//
// Real Magic has no "untap" button: a land that was tapped for mana and a creature that paid its {T} cost stay tapped. The digital convenience of undoing a
// MISCLICK is kept only while nothing came of the tap. A permanent that was USED cannot be manually untapped for the rest of the turn:
//   * its mana was spent or partly spent (the pool payment clears the contribution record and marks the source used),
//   * it paid a cost: an activated ability's {T}, convoke/crew/orb taps, an automatic payment (spendManaSources),
//   * a paid mana ability ran (a signet/Viridescent Bog spent {1} from the pool).
// `tapUsed` lives on the VisibleCard; the untap step and real untap effects ("untap target permanent", Seedborn Muse, ...) clear it.
// Mana tapped into the pool that is still fully there (a contribution record and the colour is still floating) is removed from the pool when the tap is undone.
// Pure functions only: no React, no session access beyond the card handed in.
import type { GameSession, ManaColor, ManaPool, VisibleCard } from "@/lib/types";
import { addManaToPool, effectiveManaOracleText, payCostFromPool, signetAbility, tapVisibleCard } from "@/engine/mana";
import { genericCostShim } from "@/engine/effects";

export type ManaContribution = { cardId: string; color: ManaColor; amount: number };

export type ManualUntapDecision =
  | { ok: true; removeFromPool?: { color: ManaColor; amount: number } }
  | { ok: false; reason: string };

export function markTapUsed(card: VisibleCard): VisibleCard {
  return { ...card, tapped: true, tapUsed: true };
}

export function clearTapUsed(card: VisibleCard): VisibleCard {
  return card.tapUsed ? { ...card, tapUsed: false } : card;
}

export function tapRefusalMessage(cardName: string): string {
  return `${cardName} was already used this turn and can't be untapped.`;
}

/**
 * May a human manually untap `card`? `contributions` are the unspent mana records of the card's controller (useManaUi's manaContributions, cleared whenever
 * the pool is spent from) and `pool` the controller's current floating mana.
 */
export function canManuallyUntap(card: VisibleCard, contributions: readonly ManaContribution[], pool: ManaPool): ManualUntapDecision {
  if (!card.tapped) return { ok: true };
  if (card.tapUsed) return { ok: false, reason: tapRefusalMessage(card.name) };
  const contribution = contributions.find((item) => item.cardId === card.id);
  if (contribution) {
    // The mana this tap made must still be floating in full; anything less means part of it was spent (or the phase emptied the pool).
    if (pool[contribution.color] < contribution.amount) return { ok: false, reason: tapRefusalMessage(card.name) };
    return { ok: true, removeFromPool: { color: contribution.color, amount: contribution.amount } };
  }
  return { ok: true };
}

/** Marks the given permanents of a seat as used (they stay tapped; see canManuallyUntap). */
export function markPermanentsUsed(session: GameSession, seatId: string, cardIds: readonly string[]): GameSession {
  if (cardIds.length === 0) return session;
  const ids = new Set(cardIds);
  return {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id !== seatId ? seat : { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (ids.has(card.id) && card.tapped && !card.tapUsed ? { ...card, tapUsed: true } : card)) } }
    )
  };
}

export type ManualToggleResult = {
  session: GameSession;
  // Set when a human's untap was refused (the permanent was used this turn): the caller logs it.
  refused?: string;
  // Mana a successful untap takes back out of the pool (the tap's own unspent mana).
  removeFromPool?: { color: ManaColor; amount: number };
};

/**
 * The manual "toggle tap" (the T key / click on a battlefield permanent that has nothing better to do): THE function the UI calls. An untapped permanent is
 * tapped (a misclick tap carries no `tapUsed`, so it can be undone); a tapped one is untapped only if a human's rule allows it (canManuallyUntap).
 * Agents (non-human seats) keep the old free toggle: the rule exists to stop a human reusing mana or an ability.
 */
export function toggleTapManually(session: GameSession, seatId: string, cardId: string, contributions: readonly ManaContribution[], pool: ManaPool): ManualToggleResult {
  const seat = session.seats.find((item) => item.id === seatId);
  const card = seat?.board.battlefield.find((item) => item.id === cardId);
  if (!seat || !card) return { session };
  let removeFromPool: ManualToggleResult["removeFromPool"];
  if (card.tapped && seat.kind === "human") {
    const decision = canManuallyUntap(card, contributions, pool);
    if (!decision.ok) return { session, refused: decision.reason };
    removeFromPool = decision.removeFromPool;
  }
  const next: GameSession = {
    ...session,
    seats: session.seats.map((item) =>
      item.id !== seatId ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((permanent) => (permanent.id === cardId ? { ...permanent, tapped: !permanent.tapped, tapUsed: false } : permanent)) } }
    )
  };
  return removeFromPool ? { session: next, removeFromPool } : { session: next };
}

export type SignetTapResult =
  | { ok: true; session: GameSession; pool: ManaPool; generic: number; symbols: ManaColor[] }
  | { ok: false; reason: string };

/**
 * Taps a paid signet-shaped mana source ("{1}, {T}: Add {B}{G}." Signets, Viridescent Bog) for a human: the {N} is paid out of `pool` (a land tapped first, or any
 * floating mana) and one of EACH listed colour is added. The tap counts as USED when a cost was paid (a hand untap cannot replay it: that was +1 mana per
 * untap). The caller records the contribution and logs.
 */
export function tapPaidSignet(session: GameSession, seatId: string, cardId: string, pool: ManaPool): SignetTapResult {
  const card = session.seats.find((seat) => seat.id === seatId)?.board.battlefield.find((item) => item.id === cardId);
  const signet = card ? signetAbility(effectiveManaOracleText(card)) : undefined;
  if (!card || !signet) return { ok: false, reason: "not a paid signet" };
  const paid = signet.generic > 0 ? payCostFromPool(pool, genericCostShim(signet.generic), signet.generic) : { ok: true as const, pool };
  if (!paid.ok) return { ok: false, reason: `${card.name} needs {${signet.generic}} first: tap a land (or another source) so the mana is in your pool, then tap ${card.name}.` };
  let next = paid.pool;
  for (const symbol of signet.symbols) next = addManaToPool(next, symbol, 1);
  const tapped = tapVisibleCard(session, seatId, cardId, "battlefield");
  return { ok: true, session: signet.generic > 0 ? markPermanentsUsed(tapped, seatId, [cardId]) : tapped, pool: next, generic: signet.generic, symbols: signet.symbols };
}
