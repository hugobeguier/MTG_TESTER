// Engine side of the lockdown effects (text readers are in lib/lockdown.ts):
//   - attackBannedAgainst: the single "may this creature attack that player (or their planeswalkers)?" check, fed by static sources (Combat Calligrapher),
//     attached Auras (Vow of Malice, derived by the state-based pass), per-creature stored bans (Promise of Loyalty vow counters) and per-seat stored bans
//     (Orzhov Advokist). Called from legalAttackActions, the human/guest/self-play attack declarations.
//   - expireAttackBans: "until your next turn" ends as that player's turn begins (untapForSeat).
//   - Promise of Loyalty / Orzhov Advokist / Perch Protection resolution. An agent decides deterministically, a human is asked (pendingPlayerChoices,
//     answered through resolveDeferredChoice with the "vow_choice" / "advokist_choice" resolvers).
import { destroyCreatures } from "@/engine/entry";
import { phaseOutPermanent } from "@/engine/phasing";
import { applyCounterDelta, queuePlayerChoice, rulesEvent } from "@/engine/zones";
import { counterCount, effectivePower, effectiveToughness } from "@/lib/counters";
import { abilitySources } from "@/lib/effectivePermanent";
import { parseStaticAttackBans, type AttackBan } from "@/lib/lockdown";
import { hasCardType } from "@/lib/typeGrants";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const banActive = (ban: AttackBan, defenderSeatId: string, card: VisibleCard) =>
  ban.againstSeatId === defenderSeatId && (!ban.whileCounter || counterCount(card, ban.whileCounter) > 0);

/** True when `card` (controlled by `attackerSeat`) may not attack `defender` or a planeswalker `defender` controls. */
export function attackBannedAgainst(attackerSeat: PlayerSeat, card: VisibleCard, defender: PlayerSeat): boolean {
  if (card.attackBans?.some((ban) => banActive(ban, defender.id, card))) return true;
  if (card.attachmentCantAttackSeatIds?.includes(defender.id)) return true;
  if (attackerSeat.creatureAttackBans?.some((ban) => ban.againstSeatId === defender.id)) return true;
  for (const source of abilitySources(defender.board.battlefield)) {
    for (const ban of parseStaticAttackBans(source.oracleText)) {
      if (!ban.subtype || card.typeLine.includes(ban.subtype) || card.grantedTypes?.includes(ban.subtype)) return true;
    }
  }
  return false;
}

/** "Until your next turn": drops every ban that ends when `seatId`'s turn begins. */
export function expireAttackBans(session: GameSession, seatId: string): GameSession {
  const ends = (ban: AttackBan) => ban.untilTurnOfSeatId === seatId;
  const hasAny = session.seats.some((seat) => seat.creatureAttackBans?.some(ends) || seat.board.battlefield.some((card) => card.attackBans?.some(ends)));
  if (!hasAny) return session;
  return {
    ...session,
    seats: session.seats.map((seat) => ({
      ...seat,
      creatureAttackBans: seat.creatureAttackBans?.some(ends) ? seat.creatureAttackBans.filter((ban) => !ends(ban)) || undefined : seat.creatureAttackBans,
      board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.attackBans?.some(ends) ? { ...card, attackBans: card.attackBans.filter((ban) => !ends(ban)) } : card)) }
    }))
  };
}

const livingCreatures = (seat: PlayerSeat) => seat.board.battlefield.filter((card) => hasCardType(card, "Creature") && !card.phasedOut);
const bestCreature = (cards: VisibleCard[]) =>
  [...cards].sort((a, b) => effectivePower(b) + effectiveToughness(b) - (effectivePower(a) + effectiveToughness(a)) || b.manaValue - a.manaValue)[0];

// --- Promise of Loyalty -----------------------------------------------------------------------------------------------------------------------

export const PROMISE_OF_LOYALTY_TEXT = /each player puts a vow counter on a creature they control and sacrifices the rest/i;

/** One player's pick: the kept creature gets the vow counter (and the ban on attacking the caster for as long as it has it), the rest are sacrificed. */
export function applyVowChoice(session: GameSession, seatId: string, keepId: string | undefined, casterSeatId: string, sourceName: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  const creatures = livingCreatures(seat);
  const kept = creatures.find((card) => card.id === keepId) ?? bestCreature(creatures);
  if (!kept) return session;
  let next: GameSession = {
    ...session,
    seats: session.seats.map((item) =>
      item.id !== seatId
        ? item
        : {
            ...item,
            board: {
              ...item.board,
              battlefield: item.board.battlefield.map((card) => {
                if (card.id !== kept.id) return card;
                const marked = applyCounterDelta(card, "vow", 1);
                return seatId === casterSeatId ? marked : { ...marked, attackBans: [...(card.attackBans ?? []), { againstSeatId: casterSeatId, whileCounter: "vow" }] };
              })
            }
          }
    )
  };
  next = rulesEvent(next, seatId, `${sourceName}: ${seat.name} puts a vow counter on ${kept.name} and sacrifices the rest.`);
  return destroyCreatures(next, creatures.filter((card) => card.id !== kept.id).map((card) => ({ seatId, cardId: card.id, message: `${seat.name} sacrifices ${card.name} to ${sourceName}.` })), "Rules action");
}

/** Every player picks; agents keep their best creature, a human is asked (resolver "vow_choice"). */
export function applyPromiseOfLoyalty(session: GameSession, casterSeatId: string, sourceName: string): GameSession {
  let next = session;
  for (const seat of session.seats.filter((item) => !item.hasLost)) {
    const creatures = livingCreatures(seat);
    if (creatures.length === 0) continue;
    if (seat.kind === "human" && creatures.length > 1) {
      next = queuePlayerChoice(next, {
        seatId: seat.id,
        sourceCardId: "promise-of-loyalty",
        sourceCardName: sourceName,
        prompt: `${sourceName}: choose the creature that gets a vow counter (all your other creatures are sacrificed).`,
        options: creatures.map((card) => ({ label: `${card.name} (${effectivePower(card)}/${effectiveToughness(card)})`, value: card.id })),
        resolver: "vow_choice",
        data: { casterSeatId }
      });
      continue;
    }
    next = applyVowChoice(next, seat.id, undefined, casterSeatId, sourceName);
  }
  return next;
}

// --- Orzhov Advokist --------------------------------------------------------------------------------------------------------------------------

export const ADVOKIST_TEXT = /each player may put two \+1\/\+1 counters on a creature they control\. if a player does, creatures that player controls can'?t attack you or planeswalkers you control until your next turn/i;

/** One player's answer: two +1/+1 counters on the chosen creature and, in exchange, no attacking the controller until the controller's next turn. */
export function applyAdvokistChoice(session: GameSession, seatId: string, creatureId: string | undefined, controllerSeatId: string, sourceName: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const target = seat?.board.battlefield.find((card) => card.id === creatureId && hasCardType(card, "Creature") && !card.phasedOut);
  if (!seat || !target) return session;
  const next: GameSession = {
    ...session,
    seats: session.seats.map((item) =>
      item.id !== seatId
        ? item
        : {
            ...item,
            creatureAttackBans: seatId === controllerSeatId ? item.creatureAttackBans : [...(item.creatureAttackBans ?? []), { againstSeatId: controllerSeatId, untilTurnOfSeatId: controllerSeatId }],
            board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === target.id ? applyCounterDelta(card, "+1/+1", 2) : card)) }
          }
    )
  };
  return rulesEvent(next, seatId, `${sourceName}: ${seat.name} puts two +1/+1 counters on ${target.name}${seatId === controllerSeatId ? "" : " and can't attack the controller until their next turn"}.`);
}

/** The upkeep trigger. The controller always takes the counters; an agent opponent declines (the ban costs more than two counters are worth), a human is asked. */
export function applyAdvokistTrigger(session: GameSession, controllerSeatId: string, sourceName: string): GameSession {
  let next = session;
  for (const seat of session.seats.filter((item) => !item.hasLost)) {
    const creatures = livingCreatures(seat);
    if (creatures.length === 0) continue;
    if (seat.kind === "human") {
      next = queuePlayerChoice(next, {
        seatId: seat.id,
        sourceCardId: "orzhov-advokist",
        sourceCardName: sourceName,
        prompt:
          seat.id === controllerSeatId
            ? `${sourceName}: put two +1/+1 counters on a creature you control?`
            : `${sourceName}: put two +1/+1 counters on a creature you control? If you do, your creatures can't attack its controller until their next turn.`,
        options: [...creatures.map((card) => ({ label: `${card.name} (${effectivePower(card)}/${effectiveToughness(card)})`, value: card.id })), { label: "No", value: "none" }],
        resolver: "advokist_choice",
        data: { controllerSeatId }
      });
      continue;
    }
    if (seat.id === controllerSeatId) next = applyAdvokistChoice(next, seat.id, bestCreature(creatures)?.id, controllerSeatId, sourceName);
  }
  return next;
}

// --- Perch Protection -------------------------------------------------------------------------------------------------------------------------

export const PERCH_PROTECTION_TEXT = /if the gift was promised, all permanents you control phase out, and until your next turn, your life total can'?t change and you gain protection from everything/i;

/**
 * "All permanents you control phase out, and until your next turn, your life total can't change and you gain protection from everything."
 * The permanents phase back in during this player's next untap step (engine/phasing.ts applyPhasingStep); the player lock is cleared at the same moment.
 */
export function applyPerchProtection(session: GameSession, seatId: string, sourceName: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  let next = session;
  for (const card of seat.board.battlefield) next = phaseOutPermanent(next, card.id);
  next = { ...next, seats: next.seats.map((item) => (item.id === seatId ? { ...item, lockedUntilSeatTurn: true } : item)) };
  return rulesEvent(next, seatId, `${sourceName}: ${seat.name}'s permanents phase out; until their next turn their life total can't change and they have protection from everything.`);
}

/** Clears the Perch Protection lock when the seat's next turn begins. */
export function clearPlayerLock(session: GameSession, seatId: string): GameSession {
  if (!session.seats.some((seat) => seat.id === seatId && seat.lockedUntilSeatTurn)) return session;
  return { ...session, seats: session.seats.map((seat) => (seat.id === seatId ? { ...seat, lockedUntilSeatTurn: undefined } : seat)) };
}

/** A resolving spell's lockdown riders. `giftPromised` is the cast-time answer to a "Gift" option (not yet offered by the UI, so it is false in live play). */
export function applySpellLockdownEffects(session: GameSession, seatId: string, sourceCard: VisibleCard, giftPromised: boolean): GameSession {
  const text = sourceCard.oracleText.replace(/\([^)]*\)/g, " ");
  if (PROMISE_OF_LOYALTY_TEXT.test(text)) return applyPromiseOfLoyalty(session, seatId, sourceCard.name);
  if (giftPromised && PERCH_PROTECTION_TEXT.test(text)) return applyPerchProtection(session, seatId, sourceCard.name);
  return session;
}
