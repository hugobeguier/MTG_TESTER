// Legal-action enumeration for agents: legalMainPhaseActions, legalPriorityActions, legalActivatedAbilityActions, room unlocks, move
// legality check (checkMoveLegal) and the main-phase agent heuristics.
// Extracted verbatim from components/AppFlow.tsx; AppFlow.tsx re-exports the previously public symbols.

import { abilityCostWithX, chooseAbilityX, destroyAllTypesVictims, chooseCreaturesToTapForCost, chooseEquipTarget, chooseGenericTapTarget, genericAbilityEffectHasLegalTarget, genericManaAbilityAffordable, parseGenericAbilityEffect, parseLoyaltyAbilities, tapCreaturesAltCostFor } from "@/engine/abilities";
import { AGENT_UNSUPPORTED_SPELL_TEXT, hasResolvableTarget, steelHellkiteXOptions } from "@/engine/castTargets";
import { additionalSacrificeCandidates, canCastAtInstantSpeed, castRestrictedByTurnCount, independentlyCastableSpellFaces, modalDoubleFacedLandSplit, roomDoorFaces, seatHasFlashGrant, spellCastLockedOut, spellFaceCastableFromHand, spellFaceCostCard } from "@/engine/casting";
import { canAttack, resolveAttackTarget } from "@/engine/combat";
import { adjustedCastingCost, cardWithFaceManaCost, manaValueFromManaCost, maxAffordableX, totalCastingCost, unlockCostReduction } from "@/engine/costs";
import { chooseSacrificeTargets, discardableHandCards, genericCostShim, genericManaAbilityCostShim, removalEffectHasLegalTarget, zoneEffectHasLegalTarget } from "@/engine/effects";
import { chooseBestBasicLandPairForMyriad, getBasicLandFetchOptions } from "@/engine/etb";
import { type LegalAgentAction } from "@/engine/flowTypes";
import { activateOnlyIfConditionMet, chooseManaSourcesForCost, chooseManaSourcesOrFloating, formatManaPoolPayment, isBoardConditionMet } from "@/engine/mana";
import { isPureRitual, wouldRitualBeUsed } from "@/engine/ritualUse";
import { commanderColorCount, hideawayDamageConditionMet } from "@/engine/oneShotEffects";
import { findSpellSourceCard, pendingActionSourceCard } from "@/engine/priority";
import { hasHaste, isLandCard } from "@/engine/shared";
import { hasSorcerySpeedOnlyLimiter } from "@/engine/triggerFinders";
import { hasOnceEachTurnLimiter } from "@/engine/triggers";
import { isMainPhase } from "@/engine/turnFlow";
import { type PendingAction } from "@/engine/types";
import { findExiledCardAnySeat, isPlaneswalkerCard, loyaltyCounterCount } from "@/engine/zones";
import { isBoardWipeText } from "@/lib/actionScoring";
import { parseGenericManaAbilities, parseGenericSacrificeAbilities, parseGenericTapAbilities, parseManlandAnimation, parseSelfUntapAbilities } from "@/lib/activatedAbilities";
import { equipCost, isAura, isEquipment, restrictsNonManaNonLoyaltyAbilities } from "@/lib/attachments";
import { permanentMatchesQualifier } from "@/lib/characteristics";
import { counterImmunityScopeMatches, counterSpellCanTarget, hasCantBeCountered, parseCounterImmunityGrant, parseCounterSpellAbility, type CounterSpellAbility } from "@/lib/counterSpells";
import { counterCount } from "@/lib/counters";
import { parseCycling } from "@/lib/cycling";
import { graveyardCastPermission } from "@/lib/graveyardCasting";
import { libraryTopCastPermission } from "@/lib/libraryCasting";
import { illegalResult, legalResult, validateProposal, type LegalityResult } from "@/lib/moveLegality";
import { basicLandFetchCostRequiresTap, basicLandFetchManaCost, isBasicLandFetchAbility, parseAdditionalSacrificeCost, parseModalHeader } from "@/lib/oracleClauses";
import { abilityOracleText } from "@/lib/typeGrants";
import { type GameSession, type PlayerSeat, type VisibleCard } from "@/lib/types";

export function loyaltyTurnKey(seatId: string, cardId: string, turn: number) {
  return `${turn}:${seatId}:${cardId}`;
}

export function formatLoyaltyCost(cost: number) {
  return cost > 0 ? `+${cost}` : `${cost}`;
}

export function isCumulativeUpkeepCard(card: VisibleCard) {
  return /\bcumulative upkeep\b/i.test(card.oracleText);
}

export function cumulativeUpkeepCost(card: VisibleCard) {
  const ageCounters = card.counters?.find((counter) => counter.kind === "age")?.count ?? 0;
  const text = card.oracleText.toLowerCase();
  const genericMatch = text.match(/cumulative upkeep\s*\{(\d+)\}/);
  const base = genericMatch ? Number.parseInt(genericMatch[1], 10) : 1;
  return Math.max(1, base) * (ageCounters + 1);
}

export function legalMainPhaseActions(
  seat: PlayerSeat,
  hasPlayedLand: boolean,
  activeSeatId: string | undefined,
  turn: number,
  activatedLoyaltyKeys: Set<string>,
  session: GameSession
): LegalAgentAction[] {
  const actions: LegalAgentAction[] = [];
  if (!hasPlayedLand) {
    for (const card of seat.board.hand) {
      const split = modalDoubleFacedLandSplit(card);
      if (split) {
        actions.push({
          id: `play-land:${card.id}:face${split.landIndex}`,
          actionType: "play_land",
          cardId: card.id,
          faceIndex: split.landIndex,
          targetIds: [],
          label: `play ${split.landFace.name} (land side of ${card.name})`,
          detail: `${split.landFace.oracleText} (land drop available this turn)`.trim(),
          role: card.role
        });
        continue;
      }
      if (isLandCard(card)) {
        actions.push({
          id: `play-land:${card.id}`,
          actionType: "play_land",
          cardId: card.id,
          targetIds: [],
          label: `play land ${card.name}`,
          detail: `${card.oracleText} (land drop available this turn)`.trim(),
          role: card.role
        });
      }
    }
    // A land this seat was given permission to play from exile (a hideaway land's free play) uses the land drop like any other.
    for (const card of seat.board.exile ?? []) {
      if (card.exiledPlayableBySeatId !== seat.id || !isLandCard(card)) continue;
      if (card.exiledPlayableUntilTurn !== undefined && turn > card.exiledPlayableUntilTurn) continue;
      actions.push({
        id: `play-land-exile:${card.id}`,
        actionType: "play_land",
        cardId: card.id,
        sourceZone: "exile",
        targetIds: [],
        label: `play land ${card.name} from exile`,
        detail: `${card.oracleText} (land drop available this turn)`.trim(),
        role: card.role
      });
    }
  }
  for (const card of seat.board.hand) {
    const split = modalDoubleFacedLandSplit(card);
    if (split) {
      const totalCost = adjustedCastingCost(seat, card, card.manaValue, "hand", activeSeatId, session.seats);
      const payment = chooseManaSourcesOrFloating(seat, card, totalCost, undefined, session.seats);
      // hasResolvableTarget reads oracleText/typeLine off whatever card it's given — the top-level
      // VisibleCard fields describe the *primary* face, not necessarily this spell face (Malakir
      // Rebirth // Malakir Mire and the rest of the Zendikar Rising MDFC cycle put the spell face
      // first, so this happens to already line up for that cycle, but relying on that would silently
      // stop working for any MDFC printed the other way round). Building a shim from split.spellFace
      // keeps this correct regardless of face order, so a target-requiring spell face (e.g. "return
      // target creature card from your graveyard") with no legal target is never offered as castable.
      if (payment.ok && hasResolvableTarget(session, seat.id, { ...card, name: split.spellFace.name, typeLine: split.spellFace.typeLine, oracleText: split.spellFace.oracleText })) {
        actions.push({
          id: `cast:${card.id}:face${split.spellIndex}`,
          actionType: "cast_spell",
          cardId: card.id,
          faceIndex: split.spellIndex,
          targetIds: [],
          label: `cast ${split.spellFace.name}`,
          detail: `${split.spellFace.manaCost ?? ""} ${split.spellFace.typeLine}. ${split.spellFace.oracleText} Payable with ${formatManaPoolPayment(payment.spent)}.`.trim(),
          role: card.role
        });
      }
      continue;
    }

    const doors = roomDoorFaces(card);
    if (doors) {
      doors.forEach((door, index) => {
        const shim = cardWithFaceManaCost(card, door.manaCost);
        const totalCost = adjustedCastingCost(seat, shim, manaValueFromManaCost(door.manaCost), "hand", activeSeatId, session.seats);
        const payment = chooseManaSourcesOrFloating(seat, shim, totalCost, undefined, session.seats);
        if (!payment.ok) return;
        actions.push({
          id: `cast:${card.id}:face${index}`,
          actionType: "cast_spell",
          cardId: card.id,
          faceIndex: index,
          targetIds: [],
          label: `cast ${door.name} (unlock this door)`,
          detail: `${door.manaCost ?? ""} ${door.typeLine}. ${door.oracleText} Payable with ${formatManaPoolPayment(payment.spent)}.`.trim(),
          role: card.role
        });
      });
      continue;
    }

    const spellFaces = independentlyCastableSpellFaces(card);
    if (spellFaces) {
      spellFaces.forEach((face, index) => {
        // An aftermath half is only castable from the graveyard; every half is priced from its OWN cost, type and text (never the combined card's).
        if (!spellFaceCastableFromHand(face)) return;
        const shim = spellFaceCostCard(card, face);
        const baseCost = shim.manaValue;
        const fixedCost = adjustedCastingCost(seat, shim, baseCost, "hand", activeSeatId, session.seats);
        const chosenX = maxAffordableX(seat, shim, fixedCost);
        const totalCost = totalCastingCost(seat, shim, baseCost, chosenX, session.seats);
        const payment = chooseManaSourcesOrFloating(seat, shim, totalCost, undefined, session.seats);
        if (!payment.ok) return;
        if (!hasResolvableTarget(session, seat.id, { ...card, name: face.name, typeLine: face.typeLine, oracleText: face.oracleText })) return;
        const xNote = chosenX > 0 ? ` Casting for X=${chosenX}.` : "";
        actions.push({
          id: `cast:${card.id}:face${index}`,
          actionType: "cast_spell",
          cardId: card.id,
          faceIndex: index,
          targetIds: [],
          label: chosenX > 0 ? `cast ${face.name} (X=${chosenX})` : `cast ${face.name}`,
          detail: `${face.manaCost ?? ""} ${face.typeLine}. ${face.oracleText} Payable with ${formatManaPoolPayment(payment.spent)}.${xNote}`.trim(),
          role: card.role
        });
      });
      continue;
    }

    if (isLandCard(card)) continue;
    if (castRestrictedByTurnCount(session, card)) continue;
    if (spellCastLockedOut(session, seat.id, activeSeatId)) continue;

    const fixedCost = adjustedCastingCost(seat, card, card.manaValue, "hand", activeSeatId, session.seats);
    const chosenX = maxAffordableX(seat, card, fixedCost);
    const totalCost = totalCastingCost(seat, card, card.manaValue, chosenX, session.seats);
    let payment = chooseManaSourcesOrFloating(seat, card, totalCost, undefined, session.seats);
    // An alternative cost (Sephara) that lets an otherwise unaffordable spell be cast.
    const legalTapAlt = tapCreaturesAltCostFor(seat, card);
    if (legalTapAlt) {
      const altPayment = chooseManaSourcesForCost(seat, cardWithFaceManaCost(card, legalTapAlt.costManaText), manaValueFromManaCost(legalTapAlt.costManaText), undefined, session.seats);
      if (altPayment.ok) payment = altPayment;
    }
    if (!payment.ok) continue;
    if (!hasResolvableTarget(session, seat.id, card)) continue;
    const xNote = chosenX > 0 ? ` Casting for X=${chosenX}.` : "";
    actions.push({
      id: `cast:${card.id}`,
      actionType: "cast_spell",
      cardId: card.id,
      targetIds: [],
      label: chosenX > 0 ? `cast ${card.name} (X=${chosenX})` : `cast ${card.name}`,
      detail: `${card.manaCost ?? ""} ${card.typeLine}. ${card.oracleText} Payable with ${formatManaPoolPayment(payment.spent)}.${xNote}`.trim(),
      role: card.role
    });
  }
  // Cards exiled by an impulse-draw/steal-and-play effect (see zoneEffects.ts), or by casting an
  // Adventure card's spell half (see spellResolutionDestination's "exile" branch), that this seat
  // is currently permitted to cast — land-plays from exile aren't offered (a deliberate scope
  // limit, see playCard's playingAsLand branch, which only ever removes from hand). Scanned across
  // every seat's exile, not just this one's own: a card exiled by an effect like Mind's Dilation's
  // physically sits in its OWNER's exile, which can be a different seat than the one permitted to
  // cast it (see playCardFromZone's own cross-seat handling).
  for (const card of session.seats.flatMap((s) => s.board.exile ?? [])) {
    if (card.exiledPlayableBySeatId !== seat.id || isLandCard(card)) continue;
    if (card.exiledPlayableUntilTurn !== undefined && turn > card.exiledPlayableUntilTurn) continue;
    // An Adventure/Omen-shaped card in exile can only be cast as its OTHER (permanent) face from
    // here on — the spell half is what got it exiled in the first place, and real rules don't let
    // it be cast again. Simplification: this also applies to the much rarer case of an Adventure
    // card exiled by an unrelated impulse-draw/steal effect before either face was ever cast, where
    // real rules would actually allow choosing either face — declined in favor of always offering
    // the permanent face, since nothing here tracks whether this specific exiled copy has already
    // used its spell half.
    const spellFaces = independentlyCastableSpellFaces(card);
    const permanentFace = spellFaces?.find((face) => !face.typeLine.includes("Adventure") && !face.typeLine.includes("Omen"));
    const permanentFaceIndex = permanentFace ? spellFaces!.indexOf(permanentFace) : undefined;
    const castCard = permanentFace ? cardWithFaceManaCost(card, permanentFace.manaCost) : card;
    const baseCost = permanentFace ? manaValueFromManaCost(permanentFace.manaCost) : card.manaValue;
    const fixedCost = adjustedCastingCost(seat, castCard, baseCost, "exile", activeSeatId, session.seats);
    // "Without paying its mana cost" (a hideaway land's free play, Mind's Dilation, ...): playCard charges nothing for such a cast
    // (its costWaived rule), so the listing must not price the spell at its printed cost either. Pricing it in full hid the card from
    // an agent that could not afford the real cost, e.g. Mosswort Bridge's hidden card was never offered after the ability was paid.
    const costWaivedHere = baseCost > 0 && fixedCost === 0;
    const chosenX = costWaivedHere ? 0 : maxAffordableX(seat, castCard, fixedCost);
    const totalCost = costWaivedHere ? fixedCost : totalCastingCost(seat, castCard, baseCost, chosenX, session.seats);
    const payment = chooseManaSourcesOrFloating(seat, castCard, totalCost, undefined, session.seats);
    if (!payment.ok) continue;
    const targetCheckCard = permanentFace ? { ...card, name: permanentFace.name, typeLine: permanentFace.typeLine, oracleText: permanentFace.oracleText } : card;
    if (!hasResolvableTarget(session, seat.id, targetCheckCard)) continue;
    actions.push({
      id: `cast-exile:${card.id}`,
      actionType: "cast_spell",
      cardId: card.id,
      sourceZone: "exile",
      faceIndex: permanentFaceIndex,
      targetIds: [],
      label: `cast ${permanentFace?.name ?? card.name} from exile`,
      detail: permanentFace
        ? `${permanentFace.manaCost ?? ""} ${permanentFace.typeLine}. ${permanentFace.oracleText} Payable with ${formatManaPoolPayment(payment.spent)}.`.trim()
        : `${card.manaCost ?? ""} ${card.typeLine}. ${card.oracleText} Payable with ${formatManaPoolPayment(payment.spent)}.`.trim(),
      role: card.role
    });
  }
  // Cards in this seat's own graveyard it may cast from there: flashback (Army of the Damned, Moan of the
  // Unhallowed), a standing "you may cast this card from your graveyard" (Gravecrawler), or a one-turn grant
  // (Zul Ashur). See graveyardCasting.ts.
  for (const card of seat.board.graveyard ?? []) {
    const permission = graveyardCastPermission(card, { seatId: seat.id, turn, controllerBattlefield: seat.board.battlefield });
    if (!permission) continue;
    const castCard = permission.costText ? cardWithFaceManaCost(card, permission.costText) : card;
    const baseCost = permission.costText ? manaValueFromManaCost(permission.costText) : card.manaValue;
    const fixedCost = adjustedCastingCost(seat, castCard, baseCost, "graveyard", activeSeatId, session.seats);
    const chosenX = maxAffordableX(seat, castCard, fixedCost);
    const totalCost = totalCastingCost(seat, castCard, baseCost, chosenX, session.seats);
    const payment = chooseManaSourcesOrFloating(seat, castCard, totalCost, undefined, session.seats);
    if (!payment.ok) continue;
    if (!hasResolvableTarget(session, seat.id, card)) continue;
    actions.push({
      id: `cast-graveyard:${card.id}`,
      actionType: "cast_spell",
      cardId: card.id,
      sourceZone: "graveyard",
      targetIds: [],
      label: `cast ${card.name} from the graveyard${permission.kind === "flashback" ? " (flashback)" : ""}`,
      detail: `${permission.costText ?? card.manaCost ?? ""} ${card.typeLine}. ${card.oracleText} Payable with ${formatManaPoolPayment(payment.spent)}.`.trim(),
      role: card.role
    });
  }
  // The top card of the library, when a permanent lets it be cast from there (Thundermane Dragon).
  const topCard = (seat.library ?? [])[0];
  // (A land on top, playable with One with the Multiverse, is a human's land play; agents are not offered it as a cast.)
  if (topCard && !isLandCard(topCard) && libraryTopCastPermission(topCard, seat.board.battlefield)) {
    const fixedCost = adjustedCastingCost(seat, topCard, topCard.manaValue, "library", activeSeatId, session.seats);
    const chosenX = maxAffordableX(seat, topCard, fixedCost);
    const totalCost = totalCastingCost(seat, topCard, topCard.manaValue, chosenX, session.seats);
    const payment = chooseManaSourcesOrFloating(seat, topCard, totalCost, undefined, session.seats);
    if (payment.ok && hasResolvableTarget(session, seat.id, topCard)) {
      actions.push({
        id: `cast-library:${topCard.id}`,
        actionType: "cast_spell",
        cardId: topCard.id,
        sourceZone: "library",
        targetIds: [],
        label: `cast ${topCard.name} from the top of the library`,
        detail: `${topCard.manaCost ?? ""} ${topCard.typeLine}. ${topCard.oracleText} It gains haste. Payable with ${formatManaPoolPayment(payment.spent)}.`.trim(),
        role: topCard.role
      });
    }
  }
  actions.push(...legalRoomUnlockActions(seat, session.seats));
  const commander = seat.board.commander;
  if (commander) {
    const totalCost = adjustedCastingCost(seat, commander, commander.manaValue, "command", activeSeatId, session.seats) + (commander.commanderTax ?? 0);
    const payment = chooseManaSourcesOrFloating(seat, commander, totalCost, undefined, session.seats);
    if (payment.ok && hasResolvableTarget(session, seat.id, commander)) {
      actions.push({
        id: `cast-commander:${commander.id}`,
        actionType: "cast_commander",
        cardId: commander.id,
        targetIds: [],
        label: `cast commander ${commander.name}`,
        detail: `${commander.manaCost ?? ""} commander tax ${commander.commanderTax ?? 0}. ${commander.oracleText} Payable with ${formatManaPoolPayment(payment.spent)}.`.trim(),
        role: commander.role
      });
    }
  }
  // Cycling (Barren Moor, Forgotten Cave, Tranquil Thicket): trade a surplus land for a fresh card. Offered only when the seat is already
  // flooded — six or more lands in play, or four-plus with this turn's land drop used.
  const landsInPlay = seat.board.battlefield.filter((permanent) => isLandCard(permanent)).length;
  const handHasLand = seat.board.hand.some((card) => isLandCard(card));
  for (const card of seat.board.hand) {
    const cycling = parseCycling(card.oracleText);
    // Landcycling (Angel of the Ruins' Plainscycling): the seven-drop is dead weight early, and the fetched land is what it needs.
    if (cycling?.searchType && !handHasLand && landsInPlay <= 4 && card.manaValue > landsInPlay + 1 && chooseManaSourcesForCost(seat, genericManaAbilityCostShim({ costManaText: cycling.costManaText }), manaValueFromManaCost(cycling.costManaText), undefined, session.seats).ok) {
      actions.push({
        id: `cycle:${card.id}`,
        actionType: "activate_ability",
        abilityKind: "cycling",
        cardId: card.id,
        targetIds: [],
        label: `${cycling.searchType.toLowerCase()}cycle ${card.name}`,
        detail: `${cycling.searchType}cycling ${cycling.costManaText}: discard this card to search for a ${cycling.searchType} card (you have ${landsInPlay} lands and none in hand).`,
        role: card.role
      });
    }
  }
  if (landsInPlay >= 6 || (hasPlayedLand && landsInPlay >= 4)) {
    for (const card of seat.board.hand) {
      const cycling = parseCycling(card.oracleText);
      if (cycling?.searchType) continue;
      if (!cycling || !chooseManaSourcesForCost(seat, genericManaAbilityCostShim({ costManaText: cycling.costManaText }), manaValueFromManaCost(cycling.costManaText), undefined, session.seats).ok) continue;
      actions.push({
        id: `cycle:${card.id}`,
        actionType: "activate_ability",
        abilityKind: "cycling",
        cardId: card.id,
        targetIds: [],
        label: `cycle ${card.name}`,
        detail: `Cycling ${cycling.costManaText}: discard this card to draw a card (you have ${landsInPlay} lands in play).`,
        role: card.role
      });
    }
  }
  actions.push(...legalActivatedAbilityActions(seat, true, turn, activatedLoyaltyKeys, session, !hasPlayedLand));
  actions.push({ id: "pass-phase", actionType: "pass_priority", targetIds: [], label: "pass this phase" });
  actions.push({ id: "end-turn", actionType: "end_turn", targetIds: [], label: "end turn and skip remaining phases" });
  // This list is the stack-empty main-phase list: a "counter target spell" card has nothing to target here (rule 601.2c), so it is never offered.
  // (Reported live: Sable cast Swan Song on turn 1 with nothing on the stack.) Responses are a separate list that does check the stack.
  return actions.filter((action) => {
    if (action.actionType !== "cast_spell" || !action.cardId) return true;
    const handCard = seat.board.hand.find((card) => card.id === action.cardId);
    if (handCard && agentWastesRitual(session, seat, handCard, activeSeatId, "sorcery")) return false;
    return !handCard || !isTargetedCounterspell(handCard);
  });
}

// A pure mana ritual (Dark Ritual) offered to an AGENT with nothing it could then cast from the floating mana: the mana would empty unspent (see ritualUse.ts).
function agentWastesRitual(session: GameSession, seat: PlayerSeat, card: VisibleCard, activeSeatId: string | undefined, timing: "sorcery" | "response"): boolean {
  return seat.kind !== "human" && isPureRitual(card) && !wouldRitualBeUsed(session, seat, card, activeSeatId, timing);
}

// A card whose spell is "Counter target ... spell" (Swan Song, Counterspell, Negate, ...) and is not a modal card that may have a non-counter mode.
function isTargetedCounterspell(card: { oracleText: string }): boolean {
  return Boolean(parseCounterSpellAbility(card.oracleText)) && !parseModalHeader(card.oracleText);
}

export function hasAgentMainPhaseAction(seat: PlayerSeat, hasPlayedLand: boolean, activeSeatId: string | undefined, turn: number, activatedLoyaltyKeys: Set<string>, session: GameSession) {
  return legalMainPhaseActions(seat, hasPlayedLand, activeSeatId, turn, activatedLoyaltyKeys, session).some((action) =>
    action.actionType === "play_land" || action.actionType === "cast_spell" || action.actionType === "cast_commander" || action.actionType === "activate_ability"
  );
}

// "This spell can't be countered." (printed on the target itself) or "[Creature s]pells you
// [control/cast] can't be countered." (a static grant from a permanent the target's controller
// has) — checked wherever a counterspell's legality or resolution depends on being able to target
// the spell at all.
export function spellIsImmuneToCounters(session: GameSession, targetCard: VisibleCard, targetControllerSeatId: string): boolean {
  if (hasCantBeCountered(targetCard.oracleText)) return true;
  const controller = session.seats.find((seat) => seat.id === targetControllerSeatId);
  if (!controller) return false;
  return controller.board.battlefield.some((source) => {
    const scope = parseCounterImmunityGrant(source.oracleText);
    return scope !== undefined && counterImmunityScopeMatches(scope, targetCard.typeLine);
  });
}

// Rule 114 / 701.5: a counterspell targets ONE spell on the stack, whichever the caster picks - not "the spell below me". These are the spells
// on the stack (top first) the card's own restriction allows and that are not uncounterable. A copy of a spell (isCopy) is a spell too (it has
// no card of its own, so it is judged by the type line recorded on the stack item). `stack` may list the top item twice (it is in both the
// pending window and the stack array): duplicates by id are dropped.
export function legalCounterSpellTargets(session: GameSession, stack: PendingAction[], ability: CounterSpellAbility): Array<Extract<PendingAction, { type: "spell" }>> {
  const seen = new Set<string>();
  const spells: Array<Extract<PendingAction, { type: "spell" }>> = [];
  for (const item of stack) {
    if (item.type !== "spell" || seen.has(item.id)) continue;
    seen.add(item.id);
    spells.push(item);
  }
  return spells.reverse().filter((item) => {
    const card = findSpellSourceCard(session, item);
    if (!card) return item.isCopy === true && counterSpellCanTarget(ability, item.cardTypeLine ?? "", false);
    return !spellIsImmuneToCounters(session, card, item.actorSeatId) && counterSpellCanTarget(ability, card.typeLine, item.sourceZone === "command");
  });
}

// Phase 5a's other auto-pass gate — canReceivePriorityForPendingAction already guarantees this seat
// has SOME legal instant-speed response before decideAgentPriorityAction is ever called, so "has an
// option" is never in question here; this is the narrower "is it worth spending an LLM call to
// weigh that option" check. Deliberately conservative: only returns true when there's a clear reason
// nothing about the pending action could concern this seat, never when unsure — an agent silently
// missing a real response is a worse failure than one extra Ollama call. Doesn't attempt "would this
// kill my creature" (no structured per-target data reaches this dispatch layer, only oracle text and
// a message string) — "mentions target at all" already covers that case conservatively, since a
// removal/damage spell that could kill a creature always says "target" somewhere in its text.
export function isPendingActionLikelyIrrelevantToSeat(seat: PlayerSeat, pendingAction: PendingAction, session: GameSession): boolean {
  // The actor's own spell/trigger gets its own required-pass handling elsewhere (rule 117.3b —
  // caster responds to their own action first); never second-guess that path here.
  if (pendingAction.actorSeatId === seat.id) return false;
  if (pendingAction.type === "trigger" && pendingAction.controllerSeatId === seat.id) return false;

  const oracleText = pendingActionSourceCard(session, pendingAction)?.oracleText ?? "";
  if (!oracleText) return false;
  if (isBoardWipeText(oracleText)) return false;
  // Graveyard hate concerns a seat whose graveyard has cards (it may answer with a graveyard shuffle such as Enhanced Surveillance's).
  if ((seat.board.graveyard?.length ?? 0) > 0 && graveyardHateOnStack(session, seat, [pendingAction])) return false;
  const text = oracleText.toLowerCase();
  // A mass effect with no literal "target" (Blasphemous Act-style "all creatures", Wrath-adjacent
  // "each player" clauses not already caught by isBoardWipeText) still touches this seat's board.
  if (/\beach (player|opponent|creature)\b/.test(text) || /\ball (creatures|players|permanents)\b/.test(text)) return false;
  // Anything with an explicit target could plausibly hit this seat, their permanents, or something
  // they care about — don't try to resolve who it actually targets here, just don't skip.
  if (/\btarget\b/.test(text)) return false;

  return true;
}

export function legalPriorityActions(seat: PlayerSeat, pendingAction: PendingAction, activeSeatId: string | undefined, session: GameSession): LegalAgentAction[] {
  if (pendingAction.type === "trigger" && pendingAction.controllerSeatId === seat.id) {
    return [{ id: "resolve-trigger", actionType: "pass_priority", targetIds: [], label: `resolve ${pendingAction.sourceCardName} trigger` }];
  }
  const pendingSpellTarget = pendingAction.type === "spell" ? findSpellSourceCard(session, pendingAction) : undefined;
  // Instant-speed responses can come from hand OR from an exile pile the seat currently has play
  // permission for (impulse-draw/steal-and-play — see zoneEffects.ts) — gated by the exact same
  // canCastAtInstantSpeed check either way, so an exiled sorcery still isn't offered as a response,
  // only an exiled instant/flash card is. Scanned across every seat's exile, not just this one's
  // own: a card exiled by an effect like Mind's Dilation's physically sits in its OWNER's exile,
  // which can be a different seat than the one permitted to cast it (see playCardFromZone's own
  // cross-seat handling).
  const respondableCards: Array<{ card: VisibleCard; sourceZone: "exile" | undefined }> = [
    ...seat.board.hand.map((card) => ({ card, sourceZone: undefined })),
    ...session.seats
      .flatMap((s) => s.board.exile ?? [])
      .filter((card) => card.exiledPlayableBySeatId === seat.id && (card.exiledPlayableUntilTurn === undefined || session.turn <= card.exiledPlayableUntilTurn))
      .map((card) => ({ card, sourceZone: "exile" as const }))
  ];
  const flashGranted = seatHasFlashGrant(seat);
  const actions: LegalAgentAction[] = respondableCards
    .filter(() => !spellCastLockedOut(session, seat.id, activeSeatId))
    .filter(({ card, sourceZone }) => canCastAtInstantSpeed(card, flashGranted || seatHasFlashGrant(seat, card)) || (sourceZone === "exile" && Boolean(card.exiledPlayableAnyTime)))
    .filter(({ card }) => {
      const counterAbility = parseCounterSpellAbility(card.oracleText);
      if (!counterAbility || parseModalHeader(card.oracleText)) return true;
      if (!pendingSpellTarget || pendingAction.type !== "spell") return false;
      if (spellIsImmuneToCounters(session, pendingSpellTarget, pendingAction.actorSeatId)) return false;
      return counterSpellCanTarget(counterAbility, pendingSpellTarget.typeLine, pendingAction.sourceZone === "command");
    })
    .filter(({ card }) => {
      const fixedCost = adjustedCastingCost(seat, card, card.manaValue, "hand", activeSeatId, session.seats);
      const chosenX = maxAffordableX(seat, card, fixedCost);
      return chooseManaSourcesOrFloating(seat, card, totalCastingCost(seat, card, card.manaValue, chosenX, session.seats), undefined, session.seats).ok;
    })
    .filter(({ card }) => hasResolvableTarget(session, seat.id, card))
    .filter(({ card, sourceZone }) => sourceZone === "exile" || !agentWastesRitual(session, seat, card, activeSeatId, "response"))
    .map(({ card, sourceZone }) => ({
      id: sourceZone === "exile" ? `respond-exile:${card.id}` : `respond:${card.id}`,
      actionType: "cast_spell" as const,
      cardId: card.id,
      sourceZone,
      targetIds: [pendingAction.id],
      label: `respond with ${card.name}${sourceZone === "exile" ? " from exile" : ""}`,
      detail: `${card.manaCost ?? ""} ${card.typeLine}. ${card.oracleText}`.trim(),
      role: card.role
    }));
  // Loyalty/equip activation isn't legal at instant speed, so turn/activatedLoyaltyKeys are unused
  // here — sorcerySpeedAllowed=false skips that branch entirely.
  actions.push(...legalActivatedAbilityActions(seat, false, session.turn, EMPTY_LOYALTY_KEYS, session, true, [pendingAction]));
  actions.push({ id: "pass-priority", actionType: "pass_priority", targetIds: [pendingAction.id], label: "pass priority" });
  return actions;
}

export const EMPTY_LOYALTY_KEYS = new Set<string>();

export function legalActivatedAbilityActions(seat: PlayerSeat, sorcerySpeedAllowed: boolean, turn: number, activatedLoyaltyKeys: Set<string>, session: GameSession, landDropAvailable = true, stack: PendingAction[] = []): LegalAgentAction[] {
  const actions: LegalAgentAction[] = seat.board.battlefield
    .filter((card) => {
      if ((card.abilitiesStripped || card.phasedOut)) return false;
      if (!isBasicLandFetchAbility(card)) return false;
      const requiresTap = basicLandFetchCostRequiresTap(card);
      // Rule 302.6: only applies when the cost actually includes {T} (Evolving Wilds) — Sakura-
      // Tribe Elder's plain sacrifice cost isn't restricted by being tapped or summoning sick.
      if (requiresTap && card.tapped) return false;
      if (requiresTap && card.typeLine.includes("Creature") && card.summoningSick && !hasHaste(card)) return false;
      // Wayfarer's Bauble-style "{2}, {T}, Sacrifice ...: Search..." has a real generic-mana
      // component on top of tap+sacrifice — Evolving Wilds' plain "{T}, Sacrifice ..." costs 0 here,
      // so this is a no-op affordability check for that whole original card family.
      const manaCost = basicLandFetchManaCost(card);
      if (manaCost > 0 && !chooseManaSourcesForCost(seat, genericCostShim(manaCost), manaCost, card.id, session.seats).ok) return false;
      return getBasicLandFetchOptions(seat.library ?? []).length > 0;
    })
    .map((card) => ({
      id: `activate-basic-fetch:${card.id}`,
      actionType: "activate_ability" as const,
      abilityKind: "basic_land_fetch" as const,
      cardId: card.id,
      targetIds: [],
      label: `activate ${card.name}`,
      detail: `Sacrifice ${card.name}: search your library for a basic land, put it onto the battlefield tapped, then shuffle.`
    }));

  for (const card of seat.board.battlefield) {
    if ((card.abilitiesStripped || card.phasedOut)) continue;
    parseGenericSacrificeAbilities(abilityOracleText(card)).forEach((ability, abilityIndex) => {
      if (!activateOnlyIfConditionMet(ability.clause, seat)) return;
      // "Activate only as a sorcery." (Fiend Artisan, Birthing Pod): never offered at instant speed.
      if (hasSorcerySpeedOnlyLimiter(ability.clause) && !sorcerySpeedAllowed) return;
      // An {X} cost: the engine picks X (see chooseAbilityX); with no fetchable creature the ability is not offered.
      const abilityX = ability.costX ? chooseAbilityX(session, seat, card, ability) : 0;
      if (abilityX === undefined) return;
      const payAbility = ability.costX ? abilityCostWithX(ability, abilityX) : ability;
      // Evolving Wilds/Terramorphic Expanse-style "search a basic land" abilities now also match
      // the general search_library shape below, but isBasicLandFetchAbility already owns them via
      // its own simpler auto-resolving system (basic_land_fetch) — without this, the same physical
      // ability would show up twice in the legal-actions list, once auto-picking a land and once
      // opening the interactive search UI for the exact same choice.
      if (ability.effect.kind === "search_library" && isBasicLandFetchAbility(card)) return;
      // Graveyard hate only when it hurts opponents more than you (Scavenger Grounds).
      if (
        ability.effect.kind === "exile_all_graveyards" &&
        session.seats.filter((other) => other.id !== seat.id).reduce((total, other) => total + (other.board.graveyard ?? []).length, 0) < (seat.board.graveyard ?? []).length + 4
      ) {
        return;
      }
      // Wasted-activation guards. The zone effects below need something to act on (a creature card to return, a graveyard to exile), exactly
      // as the tap-ability loop checks; without it Memorial to Folly was offered (and its land sacrificed) with an empty graveyard.
      if (ability.effect.kind === "zone_effect" && !zoneEffectHasLegalTarget(session, seat.id, ability.effect.effect)) return;
      if (seat.kind !== "human" && ability.effect.kind === "zone_effect") {
        const zone = ability.effect.effect;
        // Enhanced Surveillance's "Exile this enchantment: Shuffle your graveyard into your library." - see graveyardShuffleIsWorthIt.
        if (zone.kind === "graveyard_to_library" && zone.scope === "you" && !graveyardShuffleIsWorthIt(session, seat, stack)) return;
        // Nihil Spellbomb / Soul-Guide Lantern: graveyard hate is only worth the artifact when opponents' graveyards hold something.
        if (zone.kind === "exile_graveyard") {
          const theirs = session.seats.filter((other) => other.id !== seat.id && !other.hasLost).reduce((total, other) => total + (other.board.graveyard?.length ?? 0), 0);
          if (zone.scope === "you" || theirs < 3) return;
        }
      }
      // Selfless Spirit / Spectacular Spider-Man: an agent sacrifices its creature only IN RESPONSE to something on the stack, never at random.
      if (seat.kind !== "human" && ability.effect.kind === "grant_keywords_to_your_creatures" && !(stack && stack.length > 0 && !sorcerySpeedAllowed)) return;
      // Spore Frog's fog does nothing outside a combat with attackers.
      if (seat.kind !== "human" && ability.effect.kind === "prevent_combat_damage" && !(/declare blockers|combat damage/i.test(session.phase) && session.seats.some((other) => other.id !== seat.id && other.board.battlefield.some((attacker) => attacker.attacking)))) return;
      if (ability.costTap && card.tapped) return;
      // Rule 302.6: a creature with summoning sickness can't be tapped to pay an activated
      // ability's {T} cost (Viscera Seer, Carrion Feeder-style "{T}, Sacrifice a creature: ..."
      // are themselves creatures) unless it has haste. Non-creature permanents (Food/Clue tokens,
      // artifacts) have no such restriction.
      if (ability.costTap && card.typeLine.includes("Creature") && card.summoningSick && !hasHaste(card)) return;
      if (ability.costDiscard && seat.board.hand.length === 0) return;
      // Rule 119.4: a life payment (Arid Mesa and the rest of the fetch-land cycle's "Pay 1 life"
      // cost, ...) can only be made if the player's life total is at least that much.
      if (ability.costLife > 0 && seat.life < ability.costLife) return;
      if (ability.sacrificeTarget !== "self" && !chooseSacrificeTargets(seat, ability.sacrificeTargetTypeFilter, ability.sacrificeCount, ability.sacrificeExcludesSelf || ability.sacrificeTarget === "permanent" ? card.id : undefined, ability.sacrificeTarget === "permanent")) return;
      if (ability.effect.kind === "search_library" && (seat.library?.length ?? 0) === 0) return;
      // Sacrificing for floating mana is a human's play; an agent has no way to spend the pool, so it is never offered to one.
      if (ability.effect.kind === "add_mana" && seat.kind !== "human") return;
      // Rule 601.2c-equivalent for an activated ability: don't offer "activate Cankerbloom" with
      // nothing to destroy any more than legalMainPhaseActions offers casting a removal spell with
      // no legal target (see hasResolvableRemovalTarget) — same underlying check, reused here.
      if (ability.effect.kind === "removal" && !removalEffectHasLegalTarget(session, seat.id, card, ability.effect.effect)) return;
      // excludeCardId: card.id — this ability's own {T} (Mind Stone's "{1}, {T}, Sacrifice...")
      // already requires the source untapped; it can't also tap itself via its own separate mana
      // ability to help pay the generic portion of this same activation (a permanent can only
      // supply one tap). Without this exclusion a mana-producing sacrifice permanent could pay part
      // of its own cost with itself — reported live as Mind Stone tapping for {C} and then still
      // being sacrificed for its draw ability the same turn.
      const sacrificeCostTotal = manaValueFromManaCost(payAbility.costManaText);
      const affordable = sacrificeCostTotal === 0 || chooseManaSourcesForCost(seat, genericManaAbilityCostShim(payAbility), sacrificeCostTotal, card.id, session.seats).ok;
      if (!affordable) return;
      const sacrificeCards =
        ability.sacrificeTarget === "self"
          ? [card]
          : (chooseSacrificeTargets(seat, ability.sacrificeTargetTypeFilter, ability.sacrificeCount, ability.sacrificeExcludesSelf || ability.sacrificeTarget === "permanent" ? card.id : undefined, ability.sacrificeTarget === "permanent") ?? []);
      const targetNames = sacrificeCards.map((target) => target.name);
      actions.push({
        id: `activate-sacrifice:${card.id}:${abilityIndex}`,
        actionType: "activate_ability",
        abilityKind: "generic_sacrifice",
        abilityIndex,
        sacrificeCardIds: sacrificeCards.map((target) => target.id),
        cardId: card.id,
        targetIds: [],
        label: `activate ${card.name} (sacrifice ${targetNames.join(", ") || "a creature"}${ability.costX ? `, X=${abilityX}` : ""})`,
        detail: ability.clause
      });
    });
  }

  for (const card of seat.board.battlefield) {
    if ((card.abilitiesStripped || card.phasedOut)) continue;
    parseGenericTapAbilities(abilityOracleText(card)).forEach((ability, abilityIndex) => {
      if (!activateOnlyIfConditionMet(ability.clause, seat)) return;
      if (hasSorcerySpeedOnlyLimiter(ability.clause) && !sorcerySpeedAllowed) return;
      if (ability.costRemoveCounter && counterCount(card, ability.costRemoveCounter) < 1) return;
      if (ability.costExileGraveyard && (seat.board.graveyard?.length ?? 0) < ability.costExileGraveyard) return;
      // Sunken Palace's marked mana only helps a human, who spends it from the pool; agents are not offered it.
      if (ability.effect.kind === "add_copy_mana" && seat.kind !== "human") return;
      if (ability.costLifeCommanderColors && seat.life <= commanderColorCount(seat)) return;
      if (ability.costLife && seat.life <= ability.costLife + 4) return;
      // Hideaway lands (Spinerock Knoll, Mosswort Bridge): worth activating only with a hidden card and the condition already true.
      if (ability.effect.kind === "hideaway_play") {
        // A hidden LAND can only be played with a land drop left (the play-land-from-exile action below), so paying for it with none would be wasted.
        const hiddenCard = seat.board.exile?.find((hidden) => hidden.hideawaySourceId === card.id);
        if (!hiddenCard || (isLandCard(hiddenCard) && !landDropAvailable)) return;
        const damageMet = hideawayDamageConditionMet(session, seat.id, ability.effect.conditionText);
        if (!(damageMet !== undefined ? damageMet : isBoardConditionMet(ability.effect.conditionText, seat, session.seats))) return;
      }
      if (ability.costDiscard && discardableHandCards(seat, ability.costDiscardType).length === 0) return;
      if (ability.costTapCreatures) {
        if (!chooseCreaturesToTapForCost(seat, ability.costTapCreatures.count, ability.costTapCreatures.subtype)) return;
      } else {
        if (card.tapped) return;
        // Rule 302.6: same summoning-sickness gate as the sacrifice-ability loop above — a creature
        // can't be tapped to pay a {T} cost the turn it entered without haste.
        if (card.typeLine.includes("Creature") && card.summoningSick && !hasHaste(card)) return;
      }
      if (ability.costDiscard && seat.board.hand.length === 0) return;
      // excludeCardId: card.id — same self-tap exclusion as the sacrifice-ability loop above.
      const tapCostTotal = manaValueFromManaCost(ability.costManaText);
      const affordable = tapCostTotal === 0 || chooseManaSourcesForCost(seat, genericManaAbilityCostShim(ability), tapCostTotal, card.id, session.seats).ok;
      if (!affordable) return;
      if (
        (ability.effect.kind === "counter_and_transform" || ability.effect.kind === "bounce_own") &&
        !chooseGenericTapTarget(seat, ability.effect.targetTypeFilter)
      ) {
        return;
      }
      if (ability.effect.kind === "search_library" && (seat.library?.length ?? 0) === 0) return;
      // Steel Overseer: needs a permanent to put the counters on.
      if (ability.effect.kind === "counter_on_each_you_control" && !seat.board.battlefield.some((c) => permanentMatchesQualifier(c, ability.effect.kind === "counter_on_each_you_control" ? ability.effect.qualifier : ""))) return;
      // Nevinyrral's Disk: a board wipe is only offered to an agent when it takes clearly more from opponents than from itself (the source counts as lost).
      if (ability.effect.kind === "destroy_all_types" && seat.kind !== "human") {
        const victims = destroyAllTypesVictims(session, ability.effect.types);
        const mine = victims.filter((victim) => victim.seatId === seat.id).length;
        if (victims.length - mine < mine + 3) return;
      }
      // Nothing to act on: no creature card in any graveyard to exile, or no legal graveyard target.
      if (ability.effect.kind === "exile_graveyard_creature_then_tokens" && !session.seats.some((s) => (s.board.graveyard ?? []).some((c) => c.typeLine.includes("Creature")))) return;
      if (ability.effect.kind === "zone_effect" && !zoneEffectHasLegalTarget(session, seat.id, ability.effect.effect)) return;
      // A self-mill tap ability (Skull Prophet) is only worth an agent's activation while the library is deep: never mill toward an empty library.
      if (ability.effect.kind === "zone_effect" && ability.effect.effect.kind === "mill" && (seat.library?.length ?? 0) < ability.effect.effect.amount + 20) return;
      if (ability.effect.kind === "grant_graveyard_cast" && !(seat.board.graveyard ?? []).some((c) => permanentMatchesQualifier(c, ability.effect.kind === "grant_graveyard_cast" ? ability.effect.cardMatcher : ""))) return;
      actions.push({
        id: `activate-generic-tap:${card.id}:${abilityIndex}`,
        actionType: "activate_ability",
        abilityKind: "generic_tap",
        abilityIndex,
        cardId: card.id,
        targetIds: [],
        label: `activate ${card.name}`,
        detail: ability.clause
      });
    });
  }

  // "{cost}: Untap ~." (Retrofitter Foundry's "{3}: Untap this artifact.") only ever does anything
  // useful while the permanent is actually tapped — no {T} in its own cost, so summoning sickness
  // (rule 302.6) doesn't apply here regardless of whether the source is a creature.
  for (const card of seat.board.battlefield.filter((item) => item.tapped && !(item.abilitiesStripped || item.phasedOut))) {
    parseSelfUntapAbilities(card.oracleText).forEach((ability, abilityIndex) => {
      if (!activateOnlyIfConditionMet(ability.clause, seat)) return;
      const affordable = ability.costMana === 0 || chooseManaSourcesForCost(seat, genericCostShim(ability.costMana), ability.costMana, undefined, session.seats).ok;
      if (!affordable) return;
      actions.push({
        id: `activate-self-untap:${card.id}:${abilityIndex}`,
        actionType: "activate_ability",
        abilityKind: "self_untap",
        abilityIndex,
        cardId: card.id,
        targetIds: [],
        label: `activate ${card.name} (untap)`,
        detail: ability.clause
      });
    });
  }

  for (const card of seat.board.battlefield) {
    if ((card.abilitiesStripped || card.phasedOut)) continue;
    parseGenericManaAbilities(card.oracleText).forEach((ability, abilityIndex) => {
      if (!activateOnlyIfConditionMet(ability.clause, seat)) return;
      if (hasSorcerySpeedOnlyLimiter(ability.clause) && !sorcerySpeedAllowed) return;
      if (ability.costDiscard && seat.board.hand.length === 0) return;
      if (hasOnceEachTurnLimiter(ability.clause) && session.onceEachTurnEffectsUsed?.includes(`${session.turn}:${card.id}:generic_mana:${abilityIndex}`)) return;
      if (ability.costHasX) {
        const best = steelHellkiteXOptions(session, seat, card).find((option) => option.best);
        if (!best) return;
        actions.push({ id: `activate-generic-mana:${card.id}:${abilityIndex}`, actionType: "activate_ability", abilityKind: "generic_mana", abilityIndex, cardId: card.id, targetIds: [], label: `activate ${card.name} (X=${best.x})`, detail: ability.clause });
        return;
      }
      if (!genericManaAbilityAffordable(seat, ability, session.seats)) return;
      const effect = parseGenericAbilityEffect(ability.effectText);
      if (!effect) return;
      if (!genericAbilityEffectHasLegalTarget(session, seat.id, card, effect)) return;
      // Beledros Witherbloom: an agent pays life to untap lands only when it unlocks a spell it could not otherwise cast (a human decides for themselves).
      if (effect.kind === "untap_all_lands" && seat.kind !== "human" && !untapAllLandsIsWorthIt(seat, ability.costLife, session.seats)) return;
      actions.push({
        id: `activate-generic-mana:${card.id}:${abilityIndex}`,
        actionType: "activate_ability",
        abilityKind: "generic_mana",
        abilityIndex,
        cardId: card.id,
        targetIds: [],
        label: `activate ${card.name}`,
        detail: ability.clause
      });
    });
  }

  for (const card of seat.board.battlefield.filter((item) => item.name === "Myriad Landscape" && !item.tapped)) {
    if (!chooseManaSourcesForCost(seat, genericCostShim(2), 2, card.id, session.seats).ok) continue;
    if (chooseBestBasicLandPairForMyriad(seat).length !== 2) continue;
    actions.push({
      id: `activate-myriad:${card.id}`,
      actionType: "activate_ability",
      abilityKind: "myriad_landscape",
      cardId: card.id,
      targetIds: [],
      label: `activate ${card.name}`,
      detail: `{2}, {T}, Sacrifice ${card.name}: search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.`
    });
  }

  // Man-land animation has no {T} in its own cost (Celestial Colonnade, Mishra's Factory, ...),
  // so unlike every other ability in this function it's legal at instant speed, not gated by
  // sorcerySpeedAllowed. Excludes an already-animated-this-turn land: reactivating would just
  // re-apply the exact same until-end-of-turn state for no benefit.
  for (const card of seat.board.battlefield.filter((item) => !item.temporaryAnimatedAsCreature)) {
    const animation = parseManlandAnimation(card.oracleText);
    if (!animation) continue;
    if (animation.cost > 0 && !chooseManaSourcesForCost(seat, genericCostShim(animation.cost), animation.cost, card.id, session.seats).ok) continue;
    actions.push({
      id: `activate-manland:${card.id}`,
      actionType: "activate_ability",
      abilityKind: "animate_manland",
      cardId: card.id,
      targetIds: [],
      label: `activate ${card.name} (become a creature)`,
      detail: `Until end of turn, ${card.name} becomes a ${animation.power}/${animation.toughness} creature${animation.keywords ? ` with ${animation.keywords.join(", ")}` : ""}. It's still a land.`
    });
  }

  // Equip and loyalty abilities are both sorcery-speed only (rules 702.6e, 606.3): not offered
  // while responding during a priority window, only from the controller's own main phase.
  if (sorcerySpeedAllowed) {
    for (const card of seat.board.battlefield.filter((item) => isEquipment(item))) {
      const cost = equipCost(card.oracleText);
      if (cost === undefined) continue;
      if (cost > 0 && !chooseManaSourcesForCost(seat, genericCostShim(cost), cost, undefined, session.seats).ok) continue;
      const target = chooseEquipTarget(seat, card);
      if (!target) continue;
      actions.push({
        id: `activate-equip:${card.id}`,
        actionType: "activate_ability",
        abilityKind: "equip",
        cardId: card.id,
        targetIds: [],
        label: `activate ${card.name} (equip ${target.name})`,
        detail: `Equip {${cost}}: Attach ${card.name} to ${target.name}. ${card.oracleText}`.trim()
      });
    }

    for (const card of seat.board.battlefield.filter((item) => isPlaneswalkerCard(item))) {
      if (activatedLoyaltyKeys.has(loyaltyTurnKey(seat.id, card.id, turn))) continue;
      parseLoyaltyAbilities(card.oracleText).forEach((ability, abilityIndex) => {
        if (ability.cost < 0 && loyaltyCounterCount(card) < Math.abs(ability.cost)) return;
        // "The next spell you cast this turn has affinity for artifacts." (Saheeli, the Gifted's
        // second +1) does nothing at all with no spell left in hand to cast this turn — same "don't
        // offer a strictly pointless action" reasoning chooseEquipTarget already applies to a
        // non-improving equip move, just for a loyalty ability instead. Without this, the ability
        // still showed up as a legal action with nothing distinguishing it from a genuinely useful
        // pick, and an agent activated it with an empty hand instead of its sibling +1 (which always
        // makes a Servo token) — reported live, burning the planeswalker's one activation this turn
        // for an effect that could never matter.
        if (
          /costs? \{1\} less to cast for each artifact you control|has affinity for artifacts/i.test(ability.text) &&
          !seat.board.hand.some((handCard) => !handCard.typeLine.includes("Land"))
        ) {
          return;
        }
        actions.push({
          id: `activate-loyalty:${card.id}:${abilityIndex}`,
          actionType: "activate_ability",
          abilityKind: "loyalty_ability",
          cardId: card.id,
          loyaltyCost: ability.cost,
          targetIds: [],
          label: `activate ${card.name} ${formatLoyaltyCost(ability.cost)}`,
          detail: ability.text
        });
      });
    }
  }

  // "Enchanted player can't activate abilities that aren't mana abilities or loyalty abilities."
  // (Overwhelming Splendor). This engine doesn't expose land-tap-for-mana as a discrete
  // activate_ability action (mana costs are paid automatically through chooseManaSourcesForCost),
  // so no abilityKind produced above is a genuine rule-605.1 mana ability — the restriction
  // therefore reduces, in this engine's model, to "only loyalty_ability actions remain legal."
  const playerLocked = session.seats.some((lockSeat) =>
    lockSeat.board.battlefield.some(
      (card) => isAura(card) && card.attachedToSeatId === seat.id && restrictsNonManaNonLoyaltyAbilities(card.oracleText)
    )
  );
  if (playerLocked) return actions.filter((action) => action.abilityKind === "loyalty_ability");

  return actions;
}

function legalRoomUnlockActions(seat: PlayerSeat, allSeats?: PlayerSeat[]): LegalAgentAction[] {
  const actions: LegalAgentAction[] = [];
  for (const card of seat.board.battlefield) {
    const doors = roomDoorFaces(card);
    if (!doors) continue;
    const unlocked = card.unlockedFaceIndices ?? [];
    if (unlocked.length !== 1) continue;
    const lockedIndex = unlocked[0] === 0 ? 1 : 0;
    const lockedDoor = doors[lockedIndex];
    const shim = cardWithFaceManaCost(card, lockedDoor.manaCost);
    const totalCost = Math.max(0, manaValueFromManaCost(lockedDoor.manaCost) - unlockCostReduction(seat));
    const payment = chooseManaSourcesForCost(seat, shim, totalCost, undefined, allSeats);
    if (!payment.ok) continue;
    actions.push({
      id: `unlock-door:${card.id}`,
      actionType: "activate_ability",
      abilityKind: "unlock_room_door",
      faceIndex: lockedIndex,
      cardId: card.id,
      targetIds: [],
      label: `unlock ${lockedDoor.name} on ${card.name}`,
      detail: `${lockedDoor.manaCost ?? ""} ${lockedDoor.oracleText} Payable with ${formatManaPoolPayment(payment.spent)}.`.trim(),
      role: card.role
    });
  }
  return actions;
}

export interface MoveCheckContext {
  /** "agent": the action must also be a currently-offered option (`fresh`) and its mana must be payable. "human": rules checks only; payment is interactive. */
  mode: "agent" | "human";
  /** Has this seat already used its land drop(s) this turn? */
  hasPlayedLand: boolean;
  activeSeatId: string | undefined;
  /** True when nothing is on the stack (sorcery-speed plays need this; instant-speed responses need the opposite). */
  stackEmpty: boolean;
  /** Agent mode: the legal options regenerated from the LIVE state. The action must be one of them (catches stale ids, double-casts, a second land drop, ...). */
  fresh?: LegalAgentAction[];
}

// The central rules gate (see src/lib/moveLegality.ts): is this proposed move legal RIGHT NOW, and if not, why. Pure; never mutates the session. Humans and
// agents share it. It only refuses what the Magic rules forbid or what the engine cannot perform; a legal-but-pointless play (a wrath with no creatures, a
// draw spell with an empty library) is allowed here and left to the play guards (playGuards.ts).
export function checkMoveLegal(session: GameSession, seatId: string, action: LegalAgentAction, ctx: MoveCheckContext): LegalityResult {
  if (action.actionType === "pass_priority" || action.actionType === "end_turn" || action.actionType === "keep_hand" || action.actionType === "mulligan") return legalResult();
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat || seat.hasLost) return illegalResult("that player is not in the game");
  const ownMainWithEmptyStack = ctx.activeSeatId === seatId && isMainPhase(session.phase) && ctx.stackEmpty;
  const isResponse = action.id.startsWith("respond");
  const zone: "hand" | "command" | "exile" | "graveyard" | "library" =
    action.actionType === "cast_commander" ? "command" : action.sourceZone === "exile" ? "exile" : action.sourceZone === "graveyard" ? "graveyard" : action.sourceZone === "library" ? "library" : "hand";

  if (action.actionType === "play_land" || action.actionType === "cast_spell" || action.actionType === "cast_commander") {
    const card =
      zone === "command"
        ? seat.board.commander
        : zone === "exile"
          ? findExiledCardAnySeat(session, action.cardId ?? "")
          : zone === "graveyard"
            ? seat.board.graveyard?.find((item) => item.id === action.cardId)
            : zone === "library"
              ? (seat.library ?? [])[0]?.id === action.cardId ? (seat.library ?? [])[0] : undefined
              : seat.board.hand.find((item) => item.id === action.cardId);
    if (!card || (zone === "command" && card.id !== action.cardId)) {
      return illegalResult(`the card is not in ${zone === "hand" ? "the hand" : `the ${zone}`} any more`, "stale");
    }
    if (zone === "exile" && (card.exiledPlayableBySeatId !== seatId || (card.exiledPlayableUntilTurn !== undefined && session.turn > card.exiledPlayableUntilTurn))) {
      return illegalResult("there is no longer permission to play it from exile");
    }
    if (zone === "graveyard" && !graveyardCastPermission(card, { seatId, turn: session.turn, controllerBattlefield: seat.board.battlefield })) {
      return illegalResult("it has no flashback or other permission to be cast from the graveyard");
    }
    if (zone === "library" && !libraryTopCastPermission(card, seat.board.battlefield)) {
      return illegalResult("nothing lets it be cast from the top of the library");
    }
    const split = modalDoubleFacedLandSplit(card);
    const playingAsLand = action.actionType === "play_land" || (split !== undefined && action.faceIndex === split.landIndex);
    if (playingAsLand) {
      if (!ownMainWithEmptyStack) return illegalResult("a land can only be played in the player's own main phase with an empty stack", "illegal");
      if (ctx.hasPlayedLand) return illegalResult("the land drop for this turn is already used");
      return ctx.mode === "agent" && ctx.fresh ? membershipVerdict(action, ctx.fresh) : legalResult();
    }
    // The chosen half decides everything about the cast: its own type (timing), text (targets) and name — never the combined card's.
    const face = action.faceIndex !== undefined ? (split && action.faceIndex === split.spellIndex ? split.spellFace : independentlyCastableSpellFaces(card)?.[action.faceIndex]) : undefined;
    if (face && zone === "hand" && !spellFaceCastableFromHand(face)) return illegalResult(`${face.name} is an aftermath half and can only be cast from the graveyard`);
    const targetCard = face ? { ...card, name: face.name, typeLine: face.typeLine, oracleText: face.oracleText } : card;
    const instantSpeed = canCastAtInstantSpeed(targetCard, seatHasFlashGrant(seat, targetCard)) || (zone === "exile" && Boolean(card.exiledPlayableAnyTime));
    if (isResponse) {
      if (ctx.stackEmpty) return illegalResult("there is nothing on the stack to respond to");
      if (!instantSpeed) return illegalResult(`${targetCard.name} is not an instant and has no flash`);
    } else if (!ownMainWithEmptyStack && !instantSpeed) {
      return illegalResult(`${targetCard.name} can only be cast in the player's own main phase with an empty stack`);
    }
    // Rule 601.2c: "counter target spell" needs a spell on the stack to target when it is cast — with an empty stack there is no legal target.
    if (ctx.stackEmpty && isTargetedCounterspell(targetCard)) return illegalResult(`${targetCard.name} needs a spell on the stack to counter, and the stack is empty`);
    if (spellCastLockedOut(session, seatId, ctx.activeSeatId)) return illegalResult("an effect stops this player from casting spells right now");
    if (castRestrictedByTurnCount(session, card)) return illegalResult(`${card.name} cannot be cast during the first three turns of the game`);
    if (!hasResolvableTarget(session, seatId, targetCard)) {
      const unsupported = seat.kind !== "human" && AGENT_UNSUPPORTED_SPELL_TEXT.some((pattern) => pattern.test(targetCard.oracleText));
      const sacrificeCost = parseAdditionalSacrificeCost(targetCard.oracleText);
      if (sacrificeCost && additionalSacrificeCandidates(seat, sacrificeCost, card.id).length < sacrificeCost.count) {
        return illegalResult(`${card.name} has an additional cost that cannot be paid (no ${sacrificeCost.permanentType} to sacrifice)`);
      }
      return illegalResult(
        unsupported
          ? `${card.name} has an effect the engine cannot carry out for an automated player`
          : `${card.name} has no legal target or an additional cost that cannot be paid (nothing to sacrifice or discard)`
      );
    }
    return ctx.mode === "agent" && ctx.fresh ? membershipVerdict(action, ctx.fresh, "its mana cost cannot be paid or an extra condition is not met") : legalResult();
  }

  if (action.actionType === "activate_ability") {
    const onBattlefield = seat.board.battlefield.find((item) => item.id === action.cardId);
    const inHand = seat.board.hand.find((item) => item.id === action.cardId);
    if (!onBattlefield && !(action.abilityKind === "cycling" && inHand)) return illegalResult("the source is no longer where the ability can be activated", "stale");
    const sorcerySpeed = action.abilityKind === "loyalty_ability" || action.abilityKind === "equip" || action.abilityKind === "unlock_room_door";
    if (sorcerySpeed && !ownMainWithEmptyStack) return illegalResult("this ability can only be activated in the player's own main phase with an empty stack");
    return ctx.mode === "agent" && ctx.fresh
      ? membershipVerdict(action, ctx.fresh, "a cost cannot be paid (tapped, summoning sick, nothing to sacrifice or discard, not enough mana or life) or its condition is not met")
      : legalResult();
  }

  if (action.actionType === "attack") {
    const attacker = seat.board.battlefield.find((item) => item.id === action.cardId);
    if (!attacker) return illegalResult("the attacker is no longer on the battlefield", "stale");
    if (attacker.tapped) return illegalResult(`${attacker.name} is tapped`);
    if (!canAttack(attacker, seat.board.battlefield)) return illegalResult(`${attacker.name} cannot attack (summoning sick or restricted)`);
    return ctx.mode === "agent" && ctx.fresh ? membershipVerdict(action, ctx.fresh) : legalResult();
  }

  if (action.actionType === "block") {
    return ctx.mode === "agent" && ctx.fresh ? membershipVerdict(action, ctx.fresh, "that creature cannot legally block this attacker") : legalResult();
  }
  return legalResult();
}

function membershipVerdict(action: LegalAgentAction, fresh: LegalAgentAction[], reason = "it is not currently a legal option"): LegalityResult {
  const verdict = validateProposal(action.id, fresh);
  return verdict.legal ? legalResult() : illegalResult(reason, verdict.code);
}

export function fallbackLegalAction(actions: LegalAgentAction[]) {
  return (
    actions.find((action) => action.actionType === "cast_spell") ??
    actions.find((action) => action.actionType === "cast_commander") ??
    actions.find((action) => action.actionType === "play_land") ??
    actions.find((action) => action.actionType === "activate_ability") ??
    actions.find((action) => action.actionType === "attack") ??
    actions.find((action) => action.actionType === "block") ??
    actions.find((action) => action.actionType === "pass_priority") ??
    actions[0]
  );
}

// Rule 118.4: a life-payment cost can't be paid if it would take the payer below 0 life.
// Agent policy for "Pay N life: Untap all lands you control." (Beledros Witherbloom). The ability is legal for anyone with the life, but
// paying 10 life is only right when it buys something real: a spell worth casting (mana value 4+) that the lands still untapped cannot
// pay for NOW but the full set of lands can, and only while the payment leaves a safe life total (20+) so it never walks into lethal.
const UNTAP_LANDS_SAFE_LIFE = 20;
export function untapAllLandsIsWorthIt(seat: PlayerSeat, costLife: number, allSeats?: PlayerSeat[]): boolean {
  if (seat.life - costLife < UNTAP_LANDS_SAFE_LIFE) return false;
  const untappedSeat: PlayerSeat = {
    ...seat,
    board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.tapped && card.typeLine.includes("Land") ? { ...card, tapped: false } : card)) }
  };
  return seat.board.hand.some(
    (card) =>
      !card.typeLine.includes("Land") &&
      card.manaValue >= 4 &&
      !chooseManaSourcesForCost(seat, card, card.manaValue, undefined, allSeats).ok &&
      chooseManaSourcesForCost(untappedSeat, card, card.manaValue, undefined, allSeats).ok
  );
}

// "Exile this enchantment: Shuffle your graveyard into your library." (Enhanced Surveillance). The shuffle is only worth the card when it
// protects or recovers something: (a) an opponent's spell/ability on the stack is about to exile or otherwise gut the graveyard, or (b) the
// library is nearly empty and the graveyard holds cards that would keep the seat from decking, or (c) a big graveyard that is not a
// resource (no recursion in play) while the library is thinning. A reanimator's graveyard is its engine, so it is never shuffled away
// without a graveyard-hate response. Empty graveyard: never (nothing to protect or recover).
const GRAVEYARD_HATE_TEXT = /\bexile\b[^.]{0,80}\bgraveyards?\b|\bexile target card from a graveyard\b|\bexile (?:all )?cards? from (?:a|target|each|all)\b[^.]{0,40}graveyards?|\binto a graveyard from anywhere, exile it instead\b|\bgraveyards? (?:is|are) exiled\b/i;
function graveyardHateOnStack(session: GameSession, seat: PlayerSeat, stack: PendingAction[]): boolean {
  return stack.some((item) => {
    if (item.actorSeatId === seat.id) return false;
    if (item.type === "trigger" && item.controllerSeatId === seat.id) return false;
    const text = (pendingActionSourceCard(session, item)?.oracleText ?? "").replace(/\([^)]*\)/g, "");
    return GRAVEYARD_HATE_TEXT.test(text);
  });
}
function graveyardIsResource(seat: PlayerSeat): boolean {
  const cards = [...seat.board.battlefield, ...seat.board.hand, ...(seat.board.commander ? [seat.board.commander] : [])];
  return cards.some((card) => !card.abilitiesStripped && /\b(?:from|in) (?:your|a) graveyard\b/i.test(card.oracleText));
}
function graveyardShuffleIsWorthIt(session: GameSession, seat: PlayerSeat, stack: PendingAction[] = []): boolean {
  const graveyardSize = seat.board.graveyard?.length ?? 0;
  if (graveyardSize === 0) return false;
  if (graveyardHateOnStack(session, seat, stack)) return true;
  const librarySize = seat.library?.length ?? 0;
  if (librarySize <= 5 && graveyardSize >= 3) return true;
  if (graveyardSize >= 10 && librarySize <= 20 && !graveyardIsResource(seat)) return true;
  return false;
}

// Is any seat's attacking creature currently declared against this seat — as the defending player
// directly, or as the controller of an attacked planeswalker (resolveAttackTarget covers both). Used
// by the priority-stop policy's "I'm being attacked" condition; combat-state-only (attacking/
// attackTargetId are cleared at cleanupCombat), so this is naturally false outside combat.
export function seatIsBeingAttacked(session: GameSession, seatId: string): boolean {
  return session.seats.some((attackerSeat) =>
    attackerSeat.board.battlefield.some((card) => card.attacking && resolveAttackTarget(session, card.attackTargetId)?.seat.id === seatId)
  );
}




