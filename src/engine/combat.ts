// Combat: attack/block restrictions and keyword predicates, attack targets and attack tax, legal attack/block actions for agents,
// block choice creation, blocked/unblocked combat damage resolution and simulation, exalted, combat cleanup.
// Extracted verbatim from components/AppFlow.tsx; AppFlow.tsx re-exports the previously public symbols.

import { seatVerb } from "@/engine/abilities";
import { allProtectionColors, applyCombatDamageToTarget, applyDamagePrevention, applyDealtDamageTriggers, damageDoublingFactor, hasDeathtouch, hasFlying, hasHexproof, hasIndestructible, hasInfect, hasLifelink, hasShroud, hasWither, isProtectedFrom, markDamageOnCard } from "@/engine/damage";
import { genericCostShim } from "@/engine/effects";
import { destroyCreatures } from "@/engine/entry";
import { type BlockChoiceState, type LegalAgentAction } from "@/engine/flowTypes";
import { chooseManaSourcesForCost, spendManaSources } from "@/engine/mana";
import { hasHaste, hasKeyword } from "@/engine/shared";
import { phaseEvent } from "@/engine/triggers";
import { applyCounterDelta, isPlaneswalkerCard, loyaltyCounterCount, rulesEvent } from "@/engine/zones";
import { bushidoAmount, canBlockAdditionalCreature, canBlockOnlyFliers, landwalkEvades, mustAttackEachCombat } from "@/lib/combatRestrictions";
import { effectivePower, effectiveToughness } from "@/lib/counters";
import { hasKeyword as hasKeywordText, wardAmount as cardWardAmount } from "@/lib/keywords";
import { effectiveAttackTaxAmount } from "@/lib/staticEffects";
import { hasCardType } from "@/lib/typeGrants";
import { type GameSession, type InterpretedEffect, type PlayerSeat, type VisibleCard } from "@/lib/types";

// Exalted (rule 702.83): a creature attacking ALONE gets +1/+1 for each instance among its controller's permanents. Applied once, when
// damage is about to be dealt, because attackers are declared one at a time here and "alone" is only knowable afterwards.
// "Clues you control have exalted." (Merchant of Truth) adds one instance per Clue.
export function applyExalted(session: GameSession, attackerSeatId: string): GameSession {
  const seat = session.seats.find((item) => item.id === attackerSeatId);
  const attackers = seat?.board.battlefield.filter((card) => card.attacking) ?? [];
  if (!seat || attackers.length !== 1) return session;
  const [lone] = attackers;
  if (lone.temporaryGrantedKeywords?.includes("exalted-applied")) return session;
  const clueExalted = seat.board.battlefield.some((card) => !card.abilitiesStripped && /\bclues you control have exalted\b/i.test(card.oracleText));
  const instances = seat.board.battlefield.reduce((total, card) => {
    if ((card.abilitiesStripped || card.phasedOut)) return total;
    let count = hasKeywordText(card.oracleText, "exalted") ? 1 : 0;
    if (clueExalted && card.typeLine.includes("Clue")) count += 1;
    return total + count;
  }, 0);
  if (instances === 0) return session;
  return rulesEvent(
    {
      ...session,
      seats: session.seats.map((item) =>
        item.id !== attackerSeatId
          ? item
          : {
              ...item,
              board: {
                ...item.board,
                battlefield: item.board.battlefield.map((card) =>
                  card.id === lone.id
                    ? { ...card, temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + instances, temporaryToughnessBonus: (card.temporaryToughnessBonus ?? 0) + instances, temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), "exalted-applied"] }
                    : card
                )
              }
            }
      )
    },
    attackerSeatId,
    `${lone.name} attacks alone and gets +${instances}/+${instances} (exalted).`
  );
}

export function resolveCombatDamage(inputSession: GameSession, attackerId: string): GameSession {
  const session = applyExalted(inputSession, attackerId);
  const attacker = session.seats.find((seat) => seat.id === attackerId);
  if (!attacker) return session;
  // Rule 702.8-adjacent Fog effect (Spore Frog's "Prevent all combat damage that would be dealt
  // this turn.", see applySacrificeEffect's "prevent_combat_damage" case) — self-resets once the
  // turn actually changes (see combatDamagePrevented's own doc comment on GameSession), so this
  // check alone is enough without a separate end-of-turn cleanup step. No exceptType: identical
  // to the original all-or-nothing behavior, skip this attacking seat's whole damage assignment.
  const preventedThisTurn = session.combatDamagePrevented?.turn === session.turn;
  const exceptType = session.combatDamagePrevented?.exceptType;
  if (preventedThisTurn && !exceptType) {
    return {
      ...session,
      events: [phaseEvent(attackerId, "All combat damage is prevented this turn."), ...session.events]
    };
  }
  // "Prevent all combat damage that would be dealt this turn by non-Spider creatures." — an
  // exceptType exempts matching attackers from the block above instead of skipping every
  // attacker outright, so Arachnogenesis's own freshly-created Spiders can still deal damage.
  const attackingCardIds = attacker.board.battlefield
    .filter((card) => card.attacking)
    .filter((card) => !preventedThisTurn || (exceptType !== undefined && card.typeLine.includes(exceptType)))
    .map((card) => card.id);
  if (attackingCardIds.length === 0) {
    return {
      ...session,
      events: [phaseEvent(attackerId, "No attacking creatures assign combat damage."), ...session.events]
    };
  }

  let result = session;
  for (const cardId of attackingCardIds) {
    const currentAttacker = result.seats.find((seat) => seat.id === attackerId);
    const attackingCard = currentAttacker?.board.battlefield.find((card) => card.id === cardId);
    if (!attackingCard) continue;
    const target = resolveAttackTarget(result, attackingCard.attackTargetId);
    if (!target) continue;
    const allBlockers = target.seat.board.battlefield.filter((card) => card.blocking && (card.blockingTargetId === attackingCard.id || card.extraBlockingTargetId === attackingCard.id));
    const orderedBlockers = attackingCard.damageAssignmentOrder
      ? attackingCard.damageAssignmentOrder.map((blockerId) => allBlockers.find((card) => card.id === blockerId)).filter((card): card is VisibleCard => Boolean(card))
      : allBlockers;
    result =
      orderedBlockers.length > 0
        ? resolveBlockedCombatDamage(result, attackerId, attackingCard, target, orderedBlockers)
        : // Unblocked: a double striker deals its damage twice (first-strike step, then the regular one) - this used to deal it once.
          Array.from({ length: hasDoubleStrike(attackingCard) ? 2 : 1 }).reduce<GameSession>(
            (acc) => applyCombatDamageToTarget(acc, attackingCard.name, target, Math.max(0, effectivePower(attackingCard)), attackingCard, attackerId),
            result
          );
  }
  return result;
}

export function cleanupCombat(session: GameSession, seatId: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  return {
    ...clearCombatState(session),
    events: [
      phaseEvent(seatId, seat ? seatVerb(seat, `${seat.name} clears combat at end of combat.`, "You clear combat at end of combat.") : "Player clears combat at end of combat."),
      ...session.events
    ]
  };
}

// Hoisted for the same reason as untapForSeat/resolveCombatDamage/cleanupCombat above — was a
// nested closure but never actually touched React state, only session/markAttackDecided/canBlock/
// phaseEvent/seatVerb, all already module-level.
export function assignBlockers(session: GameSession, choice: BlockChoiceState, blockerCardIds: string[]): GameSession {
  const attacker = session.seats.find((seat) => seat.id === choice.attackerSeatId);
  const defender = session.seats.find((seat) => seat.id === choice.defenderSeatId);
  const attackingCard = attacker?.board.battlefield.find((card) => card.id === choice.attackerCardId && card.attacking);
  if (!attacker || !defender || !attackingCard) return session;
  // Lure ("All creatures able to block this creature do so."): every creature that can block it must.
  const lureForced = !attackingCard.abilitiesStripped && /^all creatures able to block (?:this creature|[a-z',\- ]+) do so\.?$/im.test(attackingCard.oracleText)
    ? defender.board.battlefield.filter((card) => canBlock(card, attackingCard, defender.board.battlefield)).map((card) => card.id)
    : undefined;
  const blockers = (lureForced ?? blockerCardIds)
    .map((id) => defender.board.battlefield.find((card) => card.id === id && canBlock(card, attackingCard, defender.board.battlefield)))
    .filter((card): card is VisibleCard => Boolean(card))
    // Challenger Troll: its controller's power-4-or-greater creatures can't be blocked by more than one creature.
    .slice(0, attackerLimitedToOneBlocker(attacker, attackingCard) ? 1 : undefined);
  // Menace: a lone blocker is not a legal block, so the attacker goes unblocked.
  const menaceRejected = hasMenace(attackingCard) && blockers.length === 1;
  if (menaceRejected) blockers.length = 0;
  // Archangel of Tithes: while it attacks, each creature that blocks costs its controller {1}. Only as many blockers as can be paid for block.
  let blockTaxSession = session;
  const blockTax = blockTaxPerBlocker(attackingCard);
  if (blockTax > 0 && blockers.length > 0) {
    for (let count = blockers.length; count >= 0; count -= 1) {
      const total = count * blockTax;
      const payment = total === 0 ? undefined : chooseManaSourcesForCost(defender, genericCostShim(total), total, undefined, session.seats);
      if (total === 0 || payment?.ok) {
        if (payment?.ok) blockTaxSession = { ...session, seats: session.seats.map((seat) => (seat.id === defender.id ? spendManaSources(seat, payment.sourceIds) : seat)) };
        blockers.length = count;
        break;
      }
    }
  }
  const decidedSession = markAttackDecided(blockTaxSession, attacker.id, attackingCard.id);
  if (blockers.length === 0) {
    return {
      ...decidedSession,
      events: [
        phaseEvent(
          defender.id,
          menaceRejected
            ? `${attackingCard.name} has menace; a single blocker isn't a legal block, so it is unblocked.`
            : seatVerb(defender, `${defender.name} declares no blockers for ${attackingCard.name}.`, `You declare no blockers for ${attackingCard.name}.`)
        ),
        ...decidedSession.events
      ]
    };
  }

  const blockerIds = new Set(blockers.map((card) => card.id));
  return {
    ...decidedSession,
    pendingBlockDeclarations: [...(decidedSession.pendingBlockDeclarations ?? []), ...blockers.map((blocker) => ({ seatId: defender.id, card: { ...blocker, blocking: true }, attackerSeatId: attacker.id }))],
    seats: decidedSession.seats.map((seat) => {
      if (seat.id === defender.id) {
        return {
          ...seat,
          // Afflict N: whenever this creature becomes blocked, the defending player loses N life.
          life: seat.life - (attackingCard.abilitiesStripped ? 0 : Number.parseInt(attackingCard.oracleText.match(/^afflict (\d+)/im)?.[1] ?? "0", 10)),
          board: {
            ...seat.board,
            battlefield: seat.board.battlefield.map((card) =>
              blockerIds.has(card.id)
                ? {
                    ...card,
                    blocking: true,
                    ...(card.blocking ? { extraBlockingTargetId: attackingCard.id } : { blockingTargetId: attackingCard.id }),
                    // Flanking: a blocker without flanking gets -1/-1 until end of turn.
                    ...(hasKeywordText(attackingCard.oracleText, "flanking") && !hasKeywordText(card.oracleText, "flanking") ? { temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) - 1, temporaryToughnessBonus: (card.temporaryToughnessBonus ?? 0) - 1 } : {}),
                    // Bushido N: +N/+N until end of turn whenever it blocks.
                    ...(bushidoAmount(card) > 0 ? { temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + bushidoAmount(card), temporaryToughnessBonus: (card.temporaryToughnessBonus ?? 0) + bushidoAmount(card) } : {})
                  }
                : card
            )
          }
        };
      }
      if (seat.id === attacker.id && (blockers.length > 1 || bushidoAmount(attackingCard) > 0)) {
        return {
          ...seat,
          board: {
            ...seat.board,
            battlefield: seat.board.battlefield.map((card) =>
              card.id === attackingCard.id
                ? {
                    ...card,
                    ...(blockers.length > 1 ? { damageAssignmentOrder: blockers.map((blocker) => blocker.id) } : {}),
                    // Bushido N: +N/+N until end of turn whenever it becomes blocked.
                    ...(bushidoAmount(card) > 0 ? { temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + bushidoAmount(card), temporaryToughnessBonus: (card.temporaryToughnessBonus ?? 0) + bushidoAmount(card) } : {})
                  }
                : card
            )
          }
        };
      }
      return seat;
    }),
    events: [
      phaseEvent(
        defender.id,
        seatVerb(
          defender,
          `${defender.name} blocks ${attackingCard.name} with ${blockers.map((blocker) => blocker.name).join(" and ")}${blockers.length > 1 ? ` (damage order: ${blockers.map((blocker) => blocker.name).join(" then ")})` : ""}.`,
          `You block ${attackingCard.name} with ${blockers.map((blocker) => blocker.name).join(" and ")}${blockers.length > 1 ? ` (damage order: ${blockers.map((blocker) => blocker.name).join(" then ")})` : ""}.`
        )
      ),
      ...decidedSession.events
    ]
  };
}

// hasCardType, not a bare typeLine check: a permanent that's a creature only via a granted type
// (Starfield of Nyx's enchantments, the enchantment-animation feature, man-land animation, ...)
// has that on grantedTypes, not its own printed typeLine, which never changes. A bare typeLine
// check meant none of those could ever attack or block despite genuinely being creatures —
// reported live via this session's man-land audit (Celestial Colonnade correctly became a 4/4 but
// still couldn't attack with it).
// "~ can't attack or block unless you control another creature with power 4 or greater." (Rhonas the Indomitable).
// controllerBattlefield is the permanent's controller's board; without it the restriction is assumed satisfied
// (a caller with no board to check shouldn't wrongly forbid the attack — declareAttack and the legal-action lists
// pass the real board).
function attackBlockRestrictionMet(card: VisibleCard, controllerBattlefield?: VisibleCard[]): boolean {
  if ((card.abilitiesStripped || card.phasedOut) || !controllerBattlefield) return true;
  for (const line of card.oracleText.split("\n")) {
    const match = line.replace(/\([^)]*\)/g, "").match(/can'?t attack or block unless you control (?:another|an?) creature with power (\d+) or greater/i);
    if (!match) continue;
    const needed = Number.parseInt(match[1], 10);
    return controllerBattlefield.some((other) => other.id !== card.id && other.typeLine.includes("Creature") && effectivePower(other) >= needed);
  }
  return true;
}

// A creature that arrived after the first attacker was declared this combat can't be declared as an attacker (Utvara Hellkite + Dragon Tempest).
export function attackLockedOut(session: GameSession, card: VisibleCard) {
  return Boolean(session.attackPool && session.attackPool.turn === session.turn && !session.attackPool.ids.includes(card.id));
}

export function canAttack(card: VisibleCard, controllerBattlefield?: VisibleCard[]) {
  if (!attackBlockRestrictionMet(card, controllerBattlefield)) return false;
  return hasCardType(card, "Creature") && !card.tapped && !card.phasedOut && (!card.summoningSick || hasHaste(card)) && !card.attacking && !hasDefender(card);
}

export function creatureCantBlock(card: VisibleCard): boolean {
  // "Target creature can't block this turn." is recorded as a temporary pseudo-keyword, like "can't be blocked".
  if (card.temporaryGrantedKeywords?.includes("can't block")) return true;
  if ((card.abilitiesStripped || card.phasedOut)) return false;
  const shortName = card.name.toLowerCase().split(" // ")[0].split(",")[0].trim();
  return card.oracleText.split("\n").some((line) => {
    const clause = line.replace(/\([^)]*\)/g, "").trim().toLowerCase().replace(/\.$/, "");
    return clause === "this creature can't block" || clause === `${card.name.toLowerCase()} can't block` || clause === `${shortName} can't block`;
  });
}

// "This creature can't be blocked by creatures with power 2 or less." (Steel Leaf Champion)
function attackerEvadesBlocker(attacker: VisibleCard, blocker: VisibleCard): boolean {
  if ((attacker.abilitiesStripped || attacker.phasedOut)) return false;
  // "Target creature can't be blocked this turn." (Rogue's Passage) is recorded as a temporary pseudo-keyword.
  if (attacker.temporaryGrantedKeywords?.includes("can't be blocked")) return true;
  if (attacker.oracleText.split("\n").some((line) => /^(?:this creature )?can'?t be blocked\.?$/i.test(line.replace(/\([^)]*\)/g, "").trim()))) return true;
  for (const line of attacker.oracleText.split("\n")) {
    const match = line.replace(/\([^)]*\)/g, "").match(/can'?t be blocked by creatures with power (\d+) or less/i);
    if (match && effectivePower(blocker) <= Number.parseInt(match[1], 10)) return true;
  }
  // Champion of Lambholt's static (see the keyword-grant scan in runStateBasedActionsPass).
  for (const keyword of attacker.grantedKeywords ?? []) {
    const below = keyword.match(/^can't be blocked by power below (-?\d+)$/);
    if (below && effectivePower(blocker) < Number.parseInt(below[1], 10)) return true;
  }
  return false;
}

export function canBlock(card: VisibleCard, attacker?: VisibleCard, controllerBattlefield?: VisibleCard[]) {
  if (!hasCardType(card, "Creature") || card.tapped || card.phasedOut) return false;
  // A creature that already blocks can block one more attacker when its text allows ("can block an additional creature each combat").
  if (card.blocking && !(canBlockAdditionalCreature(card) && !card.extraBlockingTargetId && attacker && attacker.id !== card.blockingTargetId)) return false;
  if (creatureCantBlock(card)) return false;
  if (!attackBlockRestrictionMet(card, controllerBattlefield)) return false;
  if (attacker && attackerEvadesBlocker(attacker, card)) return false;
  // "Target creature can't block this creature this turn." (Kozilek's Pathfinder)
  if (attacker && card.temporaryGrantedKeywords?.includes("can't block:" + attacker.id)) return false;
  if (attacker && hasFlying(attacker) && !hasFlying(card) && !hasReach(card)) return false;
  // Landwalk: unblockable while the defending player controls a land of that type; "can block only creatures with flying".
  if (attacker && landwalkEvades(attacker, controllerBattlefield)) return false;
  if (attacker && canBlockOnlyFliers(card) && !hasFlying(attacker)) return false;
  if (attacker && isProtectedFrom(attacker, card)) return false;
  // Rule 702.111b: menace requires two or more blockers — enforced where the blockers are assigned together (assignBlockers),
  // since a single creature is only illegal as the WHOLE block, not as one member of a gang block.
  return true;
}

function hasReach(card: VisibleCard) {
  return hasKeyword(card, "reach");
}

function hasMenace(card: VisibleCard) {
  return hasKeyword(card, "menace");
}

function hasTrample(card: VisibleCard) {
  return hasKeyword(card, "trample");
}

function hasFirstStrike(card: VisibleCard) {
  return hasKeyword(card, "first strike");
}

function hasDoubleStrike(card: VisibleCard) {
  return hasKeyword(card, "double strike");
}

// "As long as this creature is attacking, creatures can't block unless their controller pays {1} for each of those creatures."
function blockTaxPerBlocker(attacker: VisibleCard): number {
  if ((attacker.abilitiesStripped || attacker.phasedOut)) return 0;
  const match = attacker.oracleText.match(/as long as this creature is attacking, creatures can'?t block unless their controller pays \{(\d+)\} for each of those creatures/i);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function attackerLimitedToOneBlocker(attackerSeat: PlayerSeat, attacker: VisibleCard): boolean {
  return (
    effectivePower(attacker) >= 4 &&
    attackerSeat.board.battlefield.some((card) => !card.abilitiesStripped && /\bcreature you control with power 4 or greater can'?t be blocked by more than one creature\b/i.test(card.oracleText))
  );
}

// "Prevent all combat damage that would be dealt to this creature." (Seraph of the Sword) — combat damage only; other
// damage and "destroy" effects still affect it.
function preventsCombatDamageToSelf(card: VisibleCard): boolean {
  return !card.abilitiesStripped && /\bprevent all (?:combat )?damage that would be dealt to this creature\b/i.test(card.oracleText);
}

export function hasVigilance(card: VisibleCard) {
  return hasKeyword(card, "vigilance");
}

function hasDefender(card: VisibleCard) {
  return hasKeyword(card, "defender");
}

function hasWard(card: VisibleCard) {
  return hasKeyword(card, "ward");
}

export function describeKeywords(card: VisibleCard): string[] {
  const keywords: string[] = [];
  if (hasFlying(card)) keywords.push("flying");
  if (hasReach(card)) keywords.push("reach");
  if (hasMenace(card)) keywords.push("menace");
  if (hasDeathtouch(card)) keywords.push("deathtouch");
  if (hasTrample(card)) keywords.push("trample");
  if (hasDoubleStrike(card)) keywords.push("double strike");
  else if (hasFirstStrike(card)) keywords.push("first strike");
  if (hasIndestructible(card)) keywords.push("indestructible");
  if (hasVigilance(card)) keywords.push("vigilance");
  if (hasDefender(card)) keywords.push("defender");
  if (hasHaste(card)) keywords.push("haste");
  if (hasLifelink(card)) keywords.push("lifelink");
  if (hasWither(card)) keywords.push("wither");
  if (hasInfect(card)) keywords.push("infect");
  if (hasHexproof(card)) keywords.push("hexproof");
  if (hasShroud(card)) keywords.push("shroud");
  const ward = cardWardAmount(card.oracleText);
  if (ward !== undefined) keywords.push(`ward {${ward}}`);
  else if (hasWard(card)) keywords.push("ward");
  const protection = allProtectionColors(card);
  if (protection.length > 0) keywords.push(`protection from ${protection.join(" and ")}`);
  return keywords;
}

export function resolveAttackTarget(session: GameSession, targetId: string | undefined): { seat: PlayerSeat; planeswalker?: VisibleCard } | undefined {
  if (!targetId) return undefined;
  const seat = session.seats.find((item) => item.id === targetId);
  if (seat) return { seat };
  for (const candidate of session.seats) {
    const planeswalker = candidate.board.battlefield.find((card) => card.id === targetId && isPlaneswalkerCard(card));
    if (planeswalker) return { seat: candidate, planeswalker };
  }
  return undefined;
}

// "...where X is the number of creatures attacking you." (Arachnogenesis) — counts only attackers
// whose target IS the named seat itself (the player), not a planeswalker that seat controls (real
// wording says "attacking you," not "attacking you or a planeswalker you control").
export function countCreaturesAttackingSeat(session: GameSession, seatId: string): number {
  let count = 0;
  for (const seat of session.seats) {
    for (const card of seat.board.battlefield) {
      if (!card.attacking) continue;
      const target = resolveAttackTarget(session, card.attackTargetId);
      if (target && target.seat.id === seatId && !target.planeswalker) count += 1;
    }
  }
  return count;
}

function markAttackDecided(session: GameSession, seatId: string, cardId: string): GameSession {
  return {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === seatId
        ? {
            ...seat,
            board: {
              ...seat.board,
              battlefield: seat.board.battlefield.map((card) => (card.id === cardId ? { ...card, blockDecided: true } : card))
            }
          }
        : seat
    )
  };
}

// Reuses the same "+1/+1" counter kind the manual inspector +/- controls already write, so
// counters gained either way stay consistent.
export function plusOneCounterCount(card: VisibleCard) {
  return card.counters?.find((counter) => counter.kind === "+1/+1")?.count ?? 0;
}

export function clearCombatState(session: GameSession): GameSession {
  return {
    ...session,
    attackPool: undefined,
    seats: session.seats.map((seat) => ({
      ...seat,
      zones: seat.board.battlefield.some((card) => card.exileAtEndOfCombat) ? { ...seat.zones, battlefield: seat.zones.battlefield - seat.board.battlefield.filter((card) => card.exileAtEndOfCombat).length } : seat.zones,
      board: {
        ...seat.board,
        // Myriad tokens are exiled at end of combat.
        battlefield: seat.board.battlefield.filter((card) => !card.exileAtEndOfCombat).map((card) => ({
          ...card,
          attacking: false,
          attackTargetId: undefined,
          blockDecided: false,
          blocking: false,
          blockingTargetId: undefined,
          extraBlockingTargetId: undefined
        }))
      }
    }))
  };
}

function describeAttackOption(card: VisibleCard, legalBlockers: VisibleCard[], tax: number): string {
  const keywords = describeKeywords(card);
  const keywordText = keywords.length > 0 ? ` (${keywords.join(", ")})` : "";
  const taxText = tax > 0 ? ` Attacking here costs an additional {${tax}} generic mana due to a static effect.` : "";
  return `${effectivePower(card)}/${effectiveToughness(card)}${keywordText} ${card.oracleText} (${legalBlockers.length} untapped creature${legalBlockers.length === 1 ? "" : "s"} there could legally block).${taxText}`.trim();
}

export function legalAttackActions(seat: PlayerSeat, opponents: PlayerSeat[] = []): LegalAgentAction[] {
  const attackers = seat.board.battlefield.filter((card) => canAttack(card, seat.board.battlefield));
  const actions: LegalAgentAction[] = [];
  for (const card of attackers) {
    for (const opponent of opponents) {
      const legalBlockers = opponent.board.battlefield.filter((blocker) => canBlock(blocker, card, opponent.board.battlefield));
      const tax = totalAttackTax(opponent, false);
      if (tax === 0 || chooseManaSourcesForCost(seat, genericCostShim(tax), tax, undefined, opponents).ok) {
        actions.push({
          id: `attack:${card.id}:${opponent.id}`,
          actionType: "attack",
          cardId: card.id,
          targetIds: [opponent.id],
          label: `attack ${opponent.name} with ${card.name}`,
          detail: describeAttackOption(card, legalBlockers, tax),
          role: card.role
        });
      }
      for (const planeswalker of opponent.board.battlefield.filter(isPlaneswalkerCard)) {
        const planeswalkerTax = totalAttackTax(opponent, true);
        if (planeswalkerTax > 0 && !chooseManaSourcesForCost(seat, genericCostShim(planeswalkerTax), planeswalkerTax, undefined, opponents).ok) continue;
        actions.push({
          id: `attack:${card.id}:${planeswalker.id}`,
          actionType: "attack",
          cardId: card.id,
          targetIds: [planeswalker.id],
          label: `attack ${planeswalker.name} (${opponent.name}'s planeswalker, ${loyaltyCounterCount(planeswalker)} loyalty) with ${card.name}`,
          detail: describeAttackOption(card, legalBlockers, planeswalkerTax),
          role: card.role
        });
      }
    }
  }
  actions.push({ id: "no-attacks", actionType: "pass_priority", targetIds: [], label: "declare no attackers" });
  return actions;
}

export function createCombatBlockChoice(session: GameSession, attackerSeatId: string | undefined): BlockChoiceState | undefined {
  if (!attackerSeatId) return undefined;
  const attacker = session.seats.find((seat) => seat.id === attackerSeatId);
  const attackingCard = attacker?.board.battlefield.find((card) => card.attacking && !card.blockDecided);
  const target = attackingCard ? resolveAttackTarget(session, attackingCard.attackTargetId) : undefined;
  if (!attacker || !attackingCard || !target) return undefined;
  return {
    attackerSeatId: attacker.id,
    defenderSeatId: target.seat.id,
    attackerCardId: attackingCard.id,
    targetId: attackingCard.attackTargetId ?? target.seat.id
  };
}

function dealsDamageInCombatStep(card: VisibleCard, step: "first" | "regular") {
  if (hasDoubleStrike(card)) return true;
  if (hasFirstStrike(card)) return step === "first";
  return step === "regular";
}

interface BlockedCombatOutcome {
  blockerDamageMarked: number;
  attackerDamageMarked: number;
  blockerDestroyed: boolean;
  attackerDestroyed: boolean;
  trampleOverflow: number;
  attackerLifegain: number;
  blockerLifegain: number;
  blockerMinusCounters: number;
  attackerMinusCounters: number;
}

interface MultiBlockedCombatOutcome {
  blockerResults: Array<{ blocker: VisibleCard; damageMarked: number; destroyed: boolean; lifegain: number; minusCounters: number }>;
  attackerDamageMarked: number;
  attackerDestroyed: boolean;
  trampleOverflow: number;
  attackerLifegain: number;
  attackerMinusCounters: number;
}

// Generalizes simulateBlockedCombat to two or more blockers on the same attacker (rule 509/510).
// The attacker's controller assigns damage among blockers in `blockers`' order — at least lethal
// (or, with deathtouch, 1) to one before any moves to the next; trample sends whatever's left after
// every blocker has lethal to the defending player/planeswalker, and without trample any leftover
// (the attacker has more power than total lethal needed) is simply dumped on the last blocker in
// order, since it has no other legal home and doesn't matter mechanically where it lands. Each
// blocker still deals its own full power to the attacker, same as a single block, just summed.
function simulateMultiBlockedCombat(attackingCard: VisibleCard, blockers: VisibleCard[]): MultiBlockedCombatOutcome {
  const attackerPower = Math.max(0, effectivePower(attackingCard));
  const attackerToughness = effectiveToughness(attackingCard) - (attackingCard.damage ?? 0);

  let attackerAlive = true;
  let attackerDamageMarked = 0;
  let trampleOverflow = 0;

  const states = blockers.map((card) => ({
    card,
    alive: true,
    damageMarked: 0,
    dealtToAttacker: 0,
    toughness: effectiveToughness(card) - (card.damage ?? 0),
    protectedFromAttacker: isProtectedFrom(card, attackingCard) || preventsCombatDamageToSelf(card)
  }));

  for (const step of ["first", "regular"] as const) {
    const attackerActs = attackerAlive && dealsDamageInCombatStep(attackingCard, step);

    if (attackerActs) {
      const targets = states.filter((state) => state.alive && !state.protectedFromAttacker);
      if (targets.length > 0) {
        let remaining = attackerPower;
        for (const state of targets) {
          if (remaining <= 0) break;
          const lethalNeeded = hasDeathtouch(attackingCard) ? 1 : Math.max(1, state.toughness - state.damageMarked);
          const assign = Math.min(remaining, lethalNeeded);
          state.damageMarked += assign;
          remaining -= assign;
        }
        if (hasTrample(attackingCard)) trampleOverflow += remaining;
        else if (remaining > 0) targets[targets.length - 1].damageMarked += remaining;
      } else if (hasTrample(attackingCard)) {
        trampleOverflow += attackerPower;
      }
    }

    const dealtDamageThisStep = new Set<string>();
    for (const state of states) {
      if (!state.alive || !dealsDamageInCombatStep(state.card, step)) continue;
      if (isProtectedFrom(attackingCard, state.card) || preventsCombatDamageToSelf(attackingCard)) continue;
      const dealt = Math.max(0, effectivePower(state.card));
      attackerDamageMarked += dealt;
      state.dealtToAttacker += dealt;
      dealtDamageThisStep.add(state.card.id);
    }

    for (const state of states) {
      if (
        state.alive &&
        !hasIndestructible(state.card) &&
        (state.damageMarked >= state.toughness || (hasDeathtouch(attackingCard) && attackerActs && !state.protectedFromAttacker && state.damageMarked > 0))
      ) {
        state.alive = false;
      }
    }
    if (attackerAlive && !hasIndestructible(attackingCard)) {
      const deathtouchHit = states.some((state) => hasDeathtouch(state.card) && dealtDamageThisStep.has(state.card.id));
      if (attackerDamageMarked >= attackerToughness || deathtouchHit) attackerAlive = false;
    }
  }

  const blockerResults = states.map((state) => ({
    blocker: state.card,
    damageMarked: state.damageMarked,
    destroyed: !state.alive,
    lifegain: hasLifelink(state.card) ? state.dealtToAttacker : 0,
    minusCounters: hasWither(attackingCard) || hasInfect(attackingCard) ? state.damageMarked : 0
  }));

  return {
    blockerResults,
    attackerDamageMarked,
    attackerDestroyed: !attackerAlive,
    trampleOverflow,
    attackerLifegain: hasLifelink(attackingCard) ? blockerResults.reduce((total, result) => total + result.damageMarked, 0) + trampleOverflow : 0,
    attackerMinusCounters: states.some((state) => hasWither(state.card) || hasInfect(state.card)) ? attackerDamageMarked : 0
  };
}

function simulateBlockedCombat(attackingCard: VisibleCard, blocker: VisibleCard): BlockedCombatOutcome {
  const attackerPower = Math.max(0, effectivePower(attackingCard));
  const blockerPower = Math.max(0, effectivePower(blocker));
  const attackerToughness = effectiveToughness(attackingCard);
  const blockerToughness = effectiveToughness(blocker);
  const blockerProtected = isProtectedFrom(blocker, attackingCard) || preventsCombatDamageToSelf(blocker);
  const attackerProtected = isProtectedFrom(attackingCard, blocker) || preventsCombatDamageToSelf(attackingCard);

  let attackerAlive = true;
  let blockerAlive = true;
  let attackerDamageMarked = 0;
  let blockerDamageMarked = 0;
  let trampleOverflow = 0;

  for (const step of ["first", "regular"] as const) {
    const attackerActs = attackerAlive && dealsDamageInCombatStep(attackingCard, step);
    const blockerActs = blockerAlive && dealsDamageInCombatStep(blocker, step);

    if (attackerActs && !blockerProtected) {
      const lethalNeeded = hasDeathtouch(attackingCard) ? 1 : Math.max(1, blockerToughness - blockerDamageMarked);
      const assignedToBlocker = hasTrample(attackingCard) ? Math.min(attackerPower, lethalNeeded) : attackerPower;
      trampleOverflow += hasTrample(attackingCard) ? Math.max(0, attackerPower - assignedToBlocker) : 0;
      blockerDamageMarked += assignedToBlocker;
    } else if (attackerActs && hasTrample(attackingCard)) {
      // Protection prevents damage to the blocker, but a trampling attacker's damage still goes
      // through to the defending player/planeswalker for the full amount.
      trampleOverflow += attackerPower;
    }
    if (blockerActs && !attackerProtected) {
      attackerDamageMarked += blockerPower;
    }
    if (blockerAlive && !hasIndestructible(blocker) && (blockerDamageMarked >= blockerToughness || (hasDeathtouch(attackingCard) && attackerActs && !blockerProtected && blockerDamageMarked > 0))) {
      blockerAlive = false;
    }
    if (attackerAlive && !hasIndestructible(attackingCard) && (attackerDamageMarked >= attackerToughness || (hasDeathtouch(blocker) && blockerActs && !attackerProtected && attackerDamageMarked > 0))) {
      attackerAlive = false;
    }
  }

  return {
    blockerDamageMarked,
    attackerDamageMarked,
    blockerDestroyed: !blockerAlive,
    attackerDestroyed: !attackerAlive,
    trampleOverflow,
    attackerLifegain: hasLifelink(attackingCard) ? blockerDamageMarked + trampleOverflow : 0,
    blockerLifegain: hasLifelink(blocker) ? attackerDamageMarked : 0,
    blockerMinusCounters: hasWither(attackingCard) || hasInfect(attackingCard) ? blockerDamageMarked : 0,
    attackerMinusCounters: hasWither(blocker) || hasInfect(blocker) ? attackerDamageMarked : 0
  };
}

// blockers must all belong to target.seat and be ordered the way the attacker's controller wants
// damage assigned (attackingCard.damageAssignmentOrder, falling back to however they're passed in
// for the single-blocker case where order is moot).
function resolveBlockedCombatDamage(
  inputSession: GameSession,
  attackerSeatId: string,
  attackingCard: VisibleCard,
  target: { seat: PlayerSeat; planeswalker?: VisibleCard },
  rawBlockers: VisibleCard[]
): GameSession {
  let session = inputSession;
  // A creature blocking two attackers deals its damage to the first one only.
  const blockers = rawBlockers.map((blocker) => (blocker.extraBlockingTargetId === attackingCard.id ? { ...blocker, temporaryPowerBonus: (blocker.temporaryPowerBonus ?? 0) - Math.max(0, effectivePower(blocker)) } : blocker));
  // Twinflame Tyrant: each side's combat damage to the other side's creatures is doubled when its controller has the doubler.
  const doubled = (card: VisibleCard, factor: number): VisibleCard => (factor > 1 ? { ...card, temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + Math.max(0, effectivePower(card)) * (factor - 1) } : card);
  const attackerFactor = damageDoublingFactor(session, attackerSeatId, target.seat.id);
  const blockerFactor = damageDoublingFactor(session, target.seat.id, attackerSeatId);
  // "Prevent all damage target creature would deal this turn": that creature deals no damage in this combat.
  const silenced = (card: VisibleCard): VisibleCard =>
    (session.damageShields ?? []).some((shield) => shield.turn === session.turn && shield.protect.kind === "from_source" && shield.protect.cardId === card.id)
      ? { ...card, temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) - Math.max(0, effectivePower(card)) }
      : card;
  const rawOutcome = simulateMultiBlockedCombat(silenced(doubled(attackingCard, attackerFactor)), blockers.map((blocker) => silenced(doubled(blocker, blockerFactor))));

  // Prevention shields (Enshrouding Mist, "prevent the next N damage", ...) apply to the damage each creature was assigned; the combat
  // outcome (deaths, lifelink, -1/-1 counters) is then re-derived from what actually got through. Seraph-style statics are already inside the simulation.
  const preventedInCombat = (seatId: string, card: VisibleCard, damage: number, source: VisibleCard) => {
    const result = applyDamagePrevention(session, { kind: "permanent", seatId, cardId: card.id, isCreature: true }, card.name, damage, true, source.name, source);
    session = result.session;
    return result.remaining;
  };
  for (const [seatId, card, source] of [[target.seat.id, blockers[0], attackingCard], [attackerSeatId, attackingCard, blockers[0]]] as Array<[string, VisibleCard, VisibleCard]>) {
    if (preventsCombatDamageToSelf(card) && effectivePower(source) > 0) session = rulesEvent(session, seatId, `${source.name}'s combat damage to ${card.name} is prevented by ${card.name}.`);
  }
  const outcome: MultiBlockedCombatOutcome = { ...rawOutcome, blockerResults: rawOutcome.blockerResults.map((entry) => ({ ...entry })) };
  if (session.damageShields?.length) {
    for (const entry of outcome.blockerResults) {
      if (entry.damageMarked <= 0) continue;
      const left = preventedInCombat(target.seat.id, entry.blocker, entry.damageMarked, attackingCard);
      if (left === entry.damageMarked) continue;
      entry.minusCounters = Math.min(entry.minusCounters, left);
      entry.destroyed = !hasIndestructible(entry.blocker) && ((entry.blocker.damage ?? 0) + left >= effectiveToughness(entry.blocker) || (hasDeathtouch(attackingCard) && left > 0));
      entry.damageMarked = left;
    }
    if (outcome.attackerDamageMarked > 0) {
      const left = preventedInCombat(attackerSeatId, attackingCard, outcome.attackerDamageMarked, blockers[0]);
      if (left !== outcome.attackerDamageMarked) {
        const scale = left / outcome.attackerDamageMarked;
        outcome.blockerResults.forEach((entry) => (entry.lifegain = Math.floor(entry.lifegain * scale)));
        outcome.attackerMinusCounters = Math.min(outcome.attackerMinusCounters, left);
        outcome.attackerDestroyed = !hasIndestructible(attackingCard) && ((attackingCard.damage ?? 0) + left >= effectiveToughness(attackingCard) || (left > 0 && blockers.some((blocker) => hasDeathtouch(blocker))));
        outcome.attackerDamageMarked = left;
      }
    }
    outcome.attackerLifegain = hasLifelink(attackingCard) ? outcome.blockerResults.reduce((total, entry) => total + entry.damageMarked, 0) + outcome.trampleOverflow : 0;
  }

  const destructions: Array<{ seatId: string; cardId: string; message: string }> = [];
  for (const result of outcome.blockerResults) {
    if (result.destroyed) {
      destructions.push({ seatId: target.seat.id, cardId: result.blocker.id, message: `${result.blocker.name} is destroyed by combat damage from ${attackingCard.name}.` });
    }
  }
  if (outcome.attackerDestroyed) {
    destructions.push({
      seatId: attackerSeatId,
      cardId: attackingCard.id,
      message: `${attackingCard.name} is destroyed by combat damage from ${blockers.map((blocker) => blocker.name).join(" and ")}.`
    });
  }

  const totalBlockerLifegain = outcome.blockerResults.reduce((total, result) => total + result.lifegain, 0);
  const tradeSummary = outcome.blockerResults.map((result) => `${result.damageMarked} to ${result.blocker.name}`).join(", ");

  let nextSession: GameSession = {
    ...session,
    seats: session.seats.map((seat) => {
      if (seat.id === attackerSeatId && outcome.attackerLifegain > 0) return { ...seat, life: seat.life + outcome.attackerLifegain };
      if (seat.id === target.seat.id && totalBlockerLifegain > 0) return { ...seat, life: seat.life + totalBlockerLifegain };
      return seat;
    }),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: attackerSeatId,
        message: `${attackingCard.name} trades combat damage with ${blockers.map((blocker) => blocker.name).join(" and ")} (${tradeSummary}, ${outcome.attackerDamageMarked} to ${attackingCard.name}).`,
        detail: "Combat damage"
      },
      ...session.events
    ]
  };

  for (const result of outcome.blockerResults) {
    if (result.minusCounters <= 0) continue;
    nextSession = {
      ...nextSession,
      seats: nextSession.seats.map((seat) =>
        seat.id === target.seat.id
          ? {
              ...seat,
              board: {
                ...seat.board,
                battlefield: seat.board.battlefield.map((card) => (card.id === result.blocker.id ? applyCounterDelta(card, "-1/-1", result.minusCounters) : card))
              }
            }
          : seat
      )
    };
  }
  if (outcome.attackerMinusCounters > 0) {
    nextSession = {
      ...nextSession,
      seats: nextSession.seats.map((seat) =>
        seat.id === attackerSeatId
          ? { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === attackingCard.id ? applyCounterDelta(card, "-1/-1", outcome.attackerMinusCounters) : card)) } }
          : seat
      )
    };
  }

  // Survivors keep the damage they took (it can matter to a burn spell later this turn).
  for (const result of outcome.blockerResults) {
    if (!result.destroyed && result.minusCounters <= 0) nextSession = { ...nextSession, seats: markDamageOnCard(nextSession.seats, target.seat.id, result.blocker.id, result.damageMarked) };
  }
  if (!outcome.attackerDestroyed && outcome.attackerMinusCounters <= 0) nextSession = { ...nextSession, seats: markDamageOnCard(nextSession.seats, attackerSeatId, attackingCard.id, outcome.attackerDamageMarked) };

  if (outcome.trampleOverflow > 0) {
    nextSession = applyCombatDamageToTarget(nextSession, attackingCard.name, target, outcome.trampleOverflow, attackingCard, attackerSeatId);
  }
  // Damage-taken triggers ("whenever this creature is dealt damage"): every creature that was actually dealt combat damage.
  for (const result of outcome.blockerResults) nextSession = applyDealtDamageTriggers(nextSession, target.seat.id, result.blocker, result.damageMarked);
  nextSession = applyDealtDamageTriggers(nextSession, attackerSeatId, attackingCard, outcome.attackerDamageMarked);

  return destroyCreatures(nextSession, destructions);
}

function describeBlockTrade(attacker: VisibleCard | undefined, blocker: VisibleCard): string {
  if (!attacker) return "(trade outcome unclear from power/toughness alone).";
  const attackerPower = Number.parseInt(attacker.power ?? "", 10);
  const attackerToughness = Number.parseInt(attacker.toughness ?? "", 10);
  const blockerPower = Number.parseInt(blocker.power ?? "", 10);
  const blockerToughness = Number.parseInt(blocker.toughness ?? "", 10);
  if ([attackerPower, attackerToughness, blockerPower, blockerToughness].some((value) => Number.isNaN(value))) {
    return "(trade outcome unclear from power/toughness alone).";
  }

  const outcome = simulateBlockedCombat(attacker, blocker);
  const keywordNotes = Array.from(new Set([...describeKeywords(attacker), ...describeKeywords(blocker)]));
  const noteSuffix = keywordNotes.length > 0 ? ` [${keywordNotes.join(", ")}]` : "";
  const trampleNote = outcome.trampleOverflow > 0 ? `, ${outcome.trampleOverflow} tramples over` : "";

  if (outcome.blockerDestroyed && outcome.attackerDestroyed) return `(would trade: both creatures die${trampleNote}${noteSuffix}).`;
  if (outcome.blockerDestroyed && !outcome.attackerDestroyed) return `(blocker dies, attacker survives${trampleNote}${noteSuffix}).`;
  if (!outcome.blockerDestroyed && outcome.attackerDestroyed) return `(attacker dies, blocker survives${noteSuffix}).`;
  return `(neither creature dies${trampleNote}${noteSuffix}).`;
}

export function legalBlockActions(session: GameSession, choice: BlockChoiceState): LegalAgentAction[] {
  const defender = session.seats.find((seat) => seat.id === choice.defenderSeatId);
  const attacker = session.seats.find((seat) => seat.id === choice.attackerSeatId);
  const attackingCard = attacker?.board.battlefield.find((card) => card.id === choice.attackerCardId);
  const actions: LegalAgentAction[] =
    defender?.board.battlefield.filter((card) => canBlock(card, attackingCard, defender.board.battlefield)).map((card) => ({
      id: `block:${card.id}`,
      actionType: "block" as const,
      cardId: card.id,
      targetIds: [choice.attackerCardId],
      label: `block ${attackingCard?.name ?? "attacker"} with ${card.name}`,
      detail: `${effectivePower(card)}/${effectiveToughness(card)} ${card.oracleText} ${describeBlockTrade(attackingCard, card)}`.trim(),
      role: card.role
    })) ?? [];
  actions.push({ id: "no-blocks", actionType: "pass_priority", targetIds: [choice.attackerCardId], label: "declare no blockers" });
  return actions;
}

export function resolveHumanUnblockedDamage(session: GameSession, choice: BlockChoiceState): GameSession {
  const attacker = session.seats.find((seat) => seat.id === choice.attackerSeatId);
  const defender = session.seats.find((seat) => seat.id === choice.defenderSeatId);
  const attackingCard = attacker?.board.battlefield.find((card) => card.id === choice.attackerCardId && card.attacking);
  if (!attacker || !defender || !attackingCard) return session;
  const decidedSession = markAttackDecided(session, attacker.id, attackingCard.id);
  return {
    ...decidedSession,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: attacker.id,
        message: `${defender.name} declares no blockers for ${attackingCard.name}.`,
        detail: "Phase change"
      },
      ...decidedSession.events
    ]
  };
}

// Creatures that must attack ("attacks each combat if able", or goaded) and the opponents each may legally attack. A goaded creature can't attack
// the player who goaded it unless that player is the only one it can attack.
export function forcedAttackers(session: GameSession, seat: PlayerSeat): Array<{ cardId: string; targetIds: string[] }> {
  const opponents = session.seats.filter((other) => other.id !== seat.id && !other.hasLost);
  const byCard = new Map<string, string[]>();
  for (const action of legalAttackActions(seat, opponents)) {
    if (action.actionType !== "attack" || !action.cardId) continue;
    const card = seat.board.battlefield.find((entry) => entry.id === action.cardId);
    if (!card || !mustAttackEachCombat(card)) continue;
    byCard.set(card.id, [...(byCard.get(card.id) ?? []), action.targetIds[0]]);
  }
  return [...byCard.entries()].map(([cardId, targetIds]) => {
    const goader = seat.board.battlefield.find((entry) => entry.id === cardId)?.goaded?.bySeatId;
    const others = goader ? targetIds.filter((id) => id !== goader) : targetIds;
    return { cardId, targetIds: others.length > 0 ? others : targetIds };
  });
}

function attackTaxEffectsFor(defender: PlayerSeat, targetIsPlaneswalker: boolean): InterpretedEffect[] {
  return defender.board.battlefield
    .flatMap((card) => card.interpretedEffects ?? [])
    .filter((effect) => {
      if (effect.kind !== "attack_tax") return false;
      return targetIsPlaneswalker ? effect.appliesTo !== "controller" : effect.appliesTo !== "planeswalkers";
    });
}

// Sum of all attack-tax effects the defending seat has in play, evaluated against their current
// board state (e.g. Sphere of Safety's per-enchantment amount can change turn to turn).
export function totalAttackTax(defender: PlayerSeat, targetIsPlaneswalker: boolean): number {
  const enchantmentCount = defender.board.battlefield.filter((card) => card.typeLine.includes("Enchantment")).length;
  // "As long as this creature is untapped, creatures can't attack you or planeswalkers you control unless their controller
  // pays {1} for each of those creatures." (Archangel of Tithes) — read straight from the text, for cards the interpreter
  // hasn't already turned into an attack_tax effect.
  const textTax = defender.board.battlefield
    .filter((card) => !(card.abilitiesStripped || card.phasedOut) && !(card.interpretedEffects ?? []).some((effect) => effect.kind === "attack_tax"))
    .reduce((total, card) => {
      const match = card.oracleText.match(/creatures can'?t attack you or planeswalkers you control unless their controller pays \{(\d+)\} for each of those creatures/i);
      if (!match) return total;
      if (/as long as this creature is untapped/i.test(card.oracleText) && card.tapped) return total;
      return total + Number.parseInt(match[1], 10);
    }, 0);
  return (
    textTax +
    attackTaxEffectsFor(defender, targetIsPlaneswalker).reduce((total, effect) => total + effectiveAttackTaxAmount(effect, enchantmentCount), 0)
  );
}

export function applyMetalcraftAttackDebuff(
  session: GameSession,
  attackerSeatId: string,
  sourceName: string,
  effect: { power: number; toughness: number }
): GameSession {
  const affectedNames: string[] = [];
  const seats = session.seats.map((seat) => {
    if (seat.id === attackerSeatId) return seat;
    const battlefield = seat.board.battlefield.map((card) => {
      if (!hasCardType(card, "Creature")) return card;
      affectedNames.push(card.name);
      return { ...card, temporaryBasePower: effect.power, temporaryBaseToughness: effect.toughness, temporaryAbilitiesStripped: true };
    });
    return { ...seat, board: { ...seat.board, battlefield } };
  });
  if (affectedNames.length === 0) return session;
  return {
    ...session,
    seats,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: attackerSeatId,
        message: `${sourceName}'s Metalcraft trigger: ${affectedNames.join(", ")} lose all abilities and have base power and toughness ${effect.power}/${effect.toughness} until end of turn.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}
