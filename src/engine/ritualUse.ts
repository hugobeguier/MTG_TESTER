// Mana rituals for AGENT seats. A spell whose only effect is "Add {B}{B}{B}." (Dark Ritual, Rite of Flame, Seething Song, Cabal Ritual, Pyretic Ritual,
// Desperate Ritual, Mana Geyser) puts mana in the pool that EMPTIES at the end of the phase. Reported live: the AI cast Dark Ritual with nothing to spend
// it on and the mana "went up in flames". An agent is only offered a ritual when, after paying for it and adding its mana, a spell in hand (or its
// commander) is castable from that floating mana alone (the same pool-first payment the agent really uses: chooseManaSourcesOrFloating), at the speed
// the window allows. Human seats are never filtered: a human decides what to do with their own mana.
// Agents do NOT activate "add mana" one-shot abilities (Lotus Petal, Treasure sacrifice) at all: legalActivatedAbilityActions refuses add_mana to a
// non-human seat, so they cannot waste that mana either.
import { hasResolvableTarget } from "@/engine/castTargets";
import { canCastAtInstantSpeed, castRestrictedByTurnCount, seatHasFlashGrant, spellCastLockedOut } from "@/engine/casting";
import { adjustedCastingCost } from "@/engine/costs";
import { addPools, chooseManaSourcesOrFloating, emptyManaPool, payCostFromPool, spendManaSources } from "@/engine/mana";
import { manaFromTappedOpponentLands } from "@/engine/casting";
import { isLandCard } from "@/engine/shared";
import { etbEffectText } from "@/lib/oracleClauses";
import { parseSpellExtraEffects } from "@/lib/spellExtras";
import type { GameSession, ManaColor, ManaPool, PlayerSeat, VisibleCard } from "@/lib/types";

const RIDER_LINE = /^(threshold|splice onto|storm|flashback|rebound|spell mastery|delirium)\b/i;

/** The mana a pure ritual spell adds (fixed part only), or undefined when the card is not a pure mana ritual. */
export function ritualYield(card: VisibleCard, session?: GameSession, casterSeatId?: string): ManaPool | undefined {
  if (!/\b(Instant|Sorcery)\b/.test(card.typeLine)) return undefined;
  const text = etbEffectText(card.oracleText).replace(/\([^)]*\)/g, "").trim();
  if (!text) return undefined;
  const extras = parseSpellExtraEffects(text);
  if (extras.length === 1 && extras[0].kind === "add_fixed_mana") return { ...emptyManaPool(), [extras[0].color]: extras[0].amount };
  if (extras.length === 1 && extras[0].kind === "add_mana_per_tapped_opponent_land") {
    const amount = session && casterSeatId ? manaFromTappedOpponentLands(session, casterSeatId) : 0;
    return { ...emptyManaPool(), [extras[0].color]: amount };
  }
  const pool = emptyManaPool();
  let added = false;
  for (const line of card.oracleText.replace(/\([^)]*\)/g, "").split("\n").map((item) => item.trim()).filter(Boolean)) {
    if (RIDER_LINE.test(line)) continue;
    for (const rawSentence of line.split(/\.\s*/).map((item) => item.trim()).filter(Boolean)) {
      // Rite of Flame: "Add {R}{R}, then add {R} for each card named Rite of Flame in each graveyard." - the fixed part is the first clause.
      const sentence = rawSentence.replace(/,\s*then add \{[^}]+\}[^.]* for each .*$/i, "");
      const match = sentence.match(/^add ((?:\{[wubrgc]\})+)(?: for each .*)?$/i);
      if (!match) return undefined;
      added = true;
      if (/ for each /i.test(sentence)) continue;
      for (const symbol of match[1].match(/\{([wubrgc])\}/gi) ?? []) pool[symbol[1].toUpperCase() as ManaColor] += 1;
    }
  }
  return added ? pool : undefined;
}

export function isPureRitual(card: VisibleCard): boolean {
  return ritualYield(card) !== undefined;
}

/**
 * Would casting `ritual` now leave floating mana that a following cast really spends? true for a card that is not a ritual (no restriction).
 * timing "response": only instant-speed (or flash) casts count.
 */
export function wouldRitualBeUsed(session: GameSession, seat: PlayerSeat, ritual: VisibleCard, activeSeatId: string | undefined, timing: "sorcery" | "response" = "sorcery"): boolean {
  const gained = ritualYield(ritual, session, seat.id);
  if (!gained) return true;
  if (Object.values(gained).every((amount) => amount === 0)) return false;
  const cost = adjustedCastingCost(seat, ritual, ritual.manaValue, "hand", activeSeatId, session.seats);
  const payment = chooseManaSourcesOrFloating(seat, ritual, cost, undefined, session.seats);
  if (!payment.ok) return false;
  const paidSeat: PlayerSeat = payment.floating ? { ...seat, floatingMana: payment.remaining } : spendManaSources(seat, payment.sourceIds);
  const after: PlayerSeat = {
    ...paidSeat,
    floatingMana: addPools(paidSeat.floatingMana ?? emptyManaPool(), gained),
    board: { ...paidSeat.board, hand: paidSeat.board.hand.filter((card) => card.id !== ritual.id) }
  };
  const afterSession: GameSession = { ...session, seats: session.seats.map((item) => (item.id === seat.id ? after : item)) };
  if (spellCastLockedOut(afterSession, seat.id, activeSeatId)) return false;
  const flashGranted = seatHasFlashGrant(after);
  const candidates = [...after.board.hand, ...(after.board.commander ? [after.board.commander] : [])];
  return candidates.some((card) => {
    if (isLandCard(card) || isPureRitual(card) || castRestrictedByTurnCount(afterSession, card)) return false;
    if (timing === "response" && !canCastAtInstantSpeed(card, flashGranted || seatHasFlashGrant(after, card))) return false;
    const isCommander = card.id === after.board.commander?.id;
    const total = adjustedCastingCost(after, card, card.manaValue, isCommander ? "command" : "hand", activeSeatId, session.seats) + (isCommander ? card.commanderTax ?? 0 : 0);
    if (total <= 0 || !payCostFromPool(after.floatingMana ?? emptyManaPool(), card, total, { seat: after, allSeats: afterSession.seats }).ok) return false;
    return hasResolvableTarget(afterSession, seat.id, card);
  });
}
