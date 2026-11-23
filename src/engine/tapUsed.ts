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
import { addManaToPool, effectiveManaOracleText, isSacrificeManaSource, lifeGainForTap, manaAbilityCounterRemovalKind, painDamageForTap, payCostFromPool, signetAbility, tapVisibleCard, tokenTapManaAbility } from "@/engine/mana";
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
 * The manual "toggle tap" (the T key / click on a battlefield permanent that has nothing better to do): THE function the UI calls. Manually TAPPING an untapped
 * permanent is always allowed (costs like "tap two untapped artifacts", convoke, crew, summoning-sick creatures). Manually UNTAPPING is a TAKE-BACK of a mana tap
 * only (see untapForManaDecision): tapped for mana, that mana still floating in full, nothing cast / activated / paid since (every such event marks the source
 * `tapUsed` and drops its contribution). Everything else only untaps in the untap step or through a real effect.
 * The one exception is Sandbox mode (`sandbox`: the multiplayer host's explicit test tools), where the toggle is free for any seat.
 */
export function toggleTapManually(session: GameSession, seatId: string, cardId: string, contributions: readonly ManaContribution[], pool: ManaPool, sandbox = false): ManualToggleResult {
  const seat = session.seats.find((item) => item.id === seatId);
  const card = seat?.board.battlefield.find((item) => item.id === cardId);
  if (!seat || !card) return { session };
  let removeFromPool: ManualToggleResult["removeFromPool"];
  if (card.tapped && !sandbox) {
    const decision = untapForManaDecision(card, contributions, pool);
    if (!decision.ok) return { session, refused: decision.reason };
    removeFromPool = decision.removeFromPool;
  }
  const next: GameSession = {
    ...session,
    seats: session.seats.map((item) =>
      item.id !== seatId ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((permanent) => (permanent.id === cardId ? { ...permanent, tapped: !permanent.tapped, tapUsed: false } : permanent)) } }
    )
  };
  return { session: next, ...(removeFromPool ? { removeFromPool } : {}) };
}

/**
 * The take-back rule for a human's tapped permanent (pure; the caller passes the seat's unspent-mana records and floating pool). Allowed only when ALL hold:
 *  - the permanent was tapped for mana by the manual mana tap (a contribution record exists: lands that entered tapped, attackers, {T} ability costs, "tap an
 *    untapped artifact" costs and pain / life-gain / sacrifice / counter-removal mana abilities never get one),
 *  - it is not marked used (its mana was not spent, no spell or ability was put on the stack since, the phase did not end),
 *  - the mana it made is still floating in full (retracted exactly: its own colour and amount).
 */
export function untapForManaDecision(card: VisibleCard, contributions: readonly ManaContribution[], pool: ManaPool): ManualUntapDecision {
  if (!card.tapped) return { ok: true };
  if (card.tapUsed) return { ok: false, reason: `${card.name} can't be untapped: that mana was already spent (or a spell or ability was cast since).` };
  const contribution = contributions.find((item) => item.cardId === card.id);
  if (!contribution) return { ok: false, reason: untapRefusalMessage(card.name) };
  if (pool[contribution.color] < contribution.amount) return { ok: false, reason: `${card.name} can't be untapped: that mana was already spent.` };
  return { ok: true, removeFromPool: { color: contribution.color, amount: contribution.amount } };
}

/** Is tapping `card` for `color` a PURE mana tap that can be taken back? Pain / life gain / sacrifice (Treasure, Gilded Goose) / counter removal have side effects that stay. */
export function isRetractableManaTap(card: VisibleCard, color: ManaColor): boolean {
  return painDamageForTap(card, color) <= 0 && lifeGainForTap(card) <= 0 && !isSacrificeManaSource(card) && manaAbilityCounterRemovalKind(card.oracleText) === undefined && tokenTapManaAbility(card) === undefined;
}

export function untapRefusalMessage(cardName: string): string {
  return `${cardName} can't be untapped: it was not tapped for mana this turn (it entered tapped, attacked, or was tapped for an ability or cost), so it only untaps in your untap step or through a card effect.`;
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
