// The stack and priority: stack-array helpers, passPriority, response windows, beginPendingAction/resumeStackAction, responding with a card, and resolvePendingAction/resolvePendingActionNow (the big per-action-type resolver).
// Part of the AppFlow() split: shared state arrives through `ctx` (see ./context.ts); handlers owned by other hooks are called through `lateFn` so every hook sees the current render's functions.
import { type AuraAttachResult, applyAuraAttachToPlayer, applyAuraAttachment, applyChosenColor, applyChosenCreatureType, chooseAuraAttachTarget, entersWithChargeCounterPerKick, entersWithXCounters, exploreCount, grantsExtraTurn, isSagaCard, resolveExplore } from "@/engine/etb";
import { type CastChoices, type PendingAction } from "@/engine/types";
import { type ChosenTarget, legalTargets } from "@/lib/targeting";
import { type GameSession, type ManaColor, type VisibleCard } from "@/lib/types";
import { type StackFeedEntry } from "@/components/ThreeGameTable";
import { addManaToPool, attackTriggerManaHeuristicSplit, cannotPayMessage, chooseManaSourcesForCost, manaPoolTotal, payCostFromPool, selectedManaTotal, spendManaSources, spentManaColors } from "@/engine/mana";
import { additionalSacrificeCandidates, applyChosenFaceToCard, applySpellDamagePrevention, canCastAtInstantSpeed, castFaceDecision, castRestrictedByTurnCount, chooseAdditionalCostSacrifice, independentlyCastableSpellFaces, manaFromTappedOpponentLands, payAdditionalDiscardCost, playCardFromZone, sacrificeForAdditionalCost, seatHasFlashGrant, spellCastLockedOut, spellFaceCostCard, spellResolutionDestination, targetingTax } from "@/engine/casting";
import { adjustedCastingCost, hasSingleKicker, maxAffordableX, totalCastingCost } from "@/engine/costs";
import { applyCastGenericModes, applyCastRemoval, castModeLabels, castStructure, describeRemovalMode, hasResolvableTarget, nextCastPrompt, spellModePrompt, spellTargetSlots, stackTargetText } from "@/engine/castTargets";
import { applyCastRevealUntilCreatures, applyEachPlayerSacrificeEffect, applyLivingDeathEffect, applyPunisherChoiceEffect, isLivingDeathEffect, parseEachPlayerSacrificeEffect, parseEtbZoneEffect, parseMassBounceEffect, parseMassPump, parsePunisherChoiceEffect, parseSimpleDrawEffect, parseSimpleLifeChange } from "@/engine/oneShotEffects";
import { applyEntersWithCounterKind, applyEntersWithXCounters, colorsAmongPermanentsControlled, entersWithCounterPerColorControlled, entersWithFixedCounterKind, findExiledCardAnySeat, findPermanentById, moveCardBetweenVisibleZones, rulesEvent } from "@/engine/zones";
import { applyEntersWithCounterReplacements } from "@/engine/entry";
import { applyGenericModalEffect, applyMassBounceEffect, applyMassPumpEffect, applyPrimitiveAction, applySimpleLifeChange, applySpellExtraEffect, applyTargetedPumpEffect, applyZoneEffect, castTargetLegal, chooseRemovalTarget, drawMultipleForSeat, genericCostShim, parseGenericModalEffect, parseTargetedPump, substituteX } from "@/engine/effects";
import { applyTargetedEffect, commonTriggerEffect, findCommonTriggersForPermanentEntered } from "@/engine/triggers";
import { checkStateBasedActions } from "@/engine/stateBased";
import { countCreaturesAttackingSeat } from "@/engine/combat";
import { counterSpellCanTarget, parseCounterSpellAbility, parseDelayedUpkeepDraws } from "@/lib/counterSpells";
import { createTokensForSeat, parseCreateTokenSpecs } from "@/engine/tokens";
import { etbEffectText, parseAdditionalDiscardCost, parseAdditionalSacrificeCost, parseModalHeader, parseSpellModalHeader } from "@/lib/oracleClauses";
import { findCastTriggers, findEntersBatchWatcherTriggers } from "@/engine/triggerFinders";
import { findSpellSourceCard, isStackAction, nextPrioritySeatId, pendingActionRequiredPasses, withPendingActionSourceCard } from "@/engine/priority";
import { flushSync } from "react-dom";
import { hasChooseCreatureTypeEtb, parseChooseColorEtb } from "@/lib/characteristics";
import { hasIndestructible } from "@/engine/damage";
import { isAura } from "@/lib/attachments";
import { isLandCard } from "@/engine/shared";
import { isLimDulsVault, resolveAgentLimDulVault } from "@/engine/mulligan";
import { parseRemovalEffect } from "@/lib/removalSpells";
import { parseSearchLibraryEffectText } from "@/lib/activatedAbilities";
import { parseSpellExtraEffects } from "@/lib/spellExtras";
import { parseTargetedEffect } from "@/lib/targetedEffects";
import { parseZoneEffect } from "@/lib/zoneEffects";
import { removalEffectTargetSpec, zoneEffectTargetSpec } from "@/lib/targetSpecs";
import { spellIsImmuneToCounters } from "@/engine/legalActions";
import { stackBeatMs } from "@/lib/agentRuntime";
import { type GameContext, lateFn } from "./context";

export function useStackResolution(ctx: GameContext) {
  const { session, setSession, activeSeatId, prioritySeatId, setPrioritySeatId, selectedHandCardId, setSelectedHandCardId, humanSeat } = ctx;
  const { setPendingRuleChoice, auraRetargetAsked } = ctx.choices;
  const { manaPools } = ctx.mana;
  const { pendingAction, setPendingAction, setStackActions, priorityPasses, setPriorityPasses, priorityStopSettings, holdPriorityOnce, setHoldPriorityOnce, stackActionsRef, resolveBeatIds, resolveNowRef, setStackFeed } = ctx.stack;
  const { spellsCastThisTurn } = ctx.turn;
  const addEvent = lateFn(ctx, "addEvent");
  const addRestrictedManaBatch = lateFn(ctx, "addRestrictedManaBatch");
  const applyCastingCostPaymentSideEffect = lateFn(ctx, "applyCastingCostPaymentSideEffect");
  const applySagaEntryLoreCounter = lateFn(ctx, "applySagaEntryLoreCounter");
  const beginTriggerResolution = lateFn(ctx, "beginTriggerResolution");
  const checkCastTriggeredKeywords = lateFn(ctx, "checkCastTriggeredKeywords");
  const checkMiracleAfterDraw = lateFn(ctx, "checkMiracleAfterDraw");
  const clearManaContributions = lateFn(ctx, "clearManaContributions");
  const consultRulesAdvisor = lateFn(ctx, "consultRulesAdvisor");
  const consultStaticEffectInterpreter = lateFn(ctx, "consultStaticEffectInterpreter");
  const humanActionBlockedByChoice = lateFn(ctx, "humanActionBlockedByChoice");
  const openCastPrompt = lateFn(ctx, "openCastPrompt");
  const payCastingCost = lateFn(ctx, "payCastingCost");
  const poolForSeat = lateFn(ctx, "poolForSeat");
  const queueCommonTriggers = lateFn(ctx, "queueCommonTriggers");
  const resolvePhaseAdvance = lateFn(ctx, "resolvePhaseAdvance");
  const setSeatManaPool = lateFn(ctx, "setSeatManaPool");
  const startLibraryLook = lateFn(ctx, "startLibraryLook");
  const startLimDulVaultLook = lateFn(ctx, "startLimDulVaultLook");

  function replaceStackActions(next: PendingAction[]) {
    stackActionsRef.current = next;
    setStackActions(next);
  }

  function pushStackAction(action: PendingAction) {
    if (!isStackAction(action)) return;
    const current = stackActionsRef.current;
    if (current.some((item) => item.id === action.id)) return;
    replaceStackActions([...current, action]);
  }

  function updateStackAction(action: PendingAction) {
    replaceStackActions(stackActionsRef.current.map((item) => (item.id === action.id ? action : item)));
  }

  function removeStackAction(actionId: string) {
    const next = stackActionsRef.current.filter((item) => item.id !== actionId);
    replaceStackActions(next);
    return next;
  }

  function resumeTopStackAction(stack: PendingAction[]) {
    const nextAction = stack[stack.length - 1];
    if (nextAction) {
      window.setTimeout(() => resumeStackAction(nextAction), 0);
      return true;
    }
    return false;
  }

  function passPriority() {
    if (prioritySeatId === humanSeat.id && humanActionBlockedByChoice(humanSeat.id)) return;
    if (!pendingAction) {
      const nextSeat = session.seats[(Math.max(0, session.seats.findIndex((seat) => seat.id === prioritySeatId)) + 1) % session.seats.length];
      setPrioritySeatId(nextSeat.id);
      return;
    }

    const passingSeatId = prioritySeatId;
    const requiredPasses = pendingActionRequiredPasses(
      session.seats,
      pendingAction,
      activeSeatId,
      session,
      manaPools,
      priorityStopSettings,
      holdPriorityOnce ? humanSeat.id : undefined
    );
    const nextPasses = Array.from(new Set([...priorityPasses, passingSeatId]));
    const passedByEveryone = requiredPasses.every((seatId) => nextPasses.includes(seatId));

    setSession((current) => ({
      ...current,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: passingSeatId,
          message: `${current.seats.find((seat) => seat.id === passingSeatId)?.name ?? "Player"} passed priority.`
        },
        ...current.events
      ]
    }));

    if (passedByEveryone) {
      resolvePendingAction(pendingAction);
      return;
    }

    setPriorityPasses(nextPasses);
    setPrioritySeatId(
      nextPrioritySeatId(
        session.seats,
        pendingAction.actorSeatId,
        nextPasses,
        pendingAction,
        activeSeatId,
        session,
        manaPools,
        priorityStopSettings,
        holdPriorityOnce ? humanSeat.id : undefined
      )
    );
  }

  function openResponseWindow() {
    if (!pendingAction) return;
    setSession((current) => ({
      ...current,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: humanSeat.id,
          message: `${humanSeat.name} is reviewing the pending ${pendingAction.type}.`,
          detail: "Priority window"
        },
        ...current.events
      ]
    }));
  }

  // Reopens the priority window for an action that's already on the stack (used when priority
  // comes back around to it after whatever was on top of it resolved) — as opposed to
  // beginPendingAction, which is for a brand-new action that hasn't been logged or pushed yet.
  // Sharing beginPendingAction for both used to be exactly the bug: it unconditionally pushes a
  // fresh "casts X..." event (using the action's own fixed id) into session.events every time it
  // runs, with no de-dupe check the way pushStackAction itself already has one (`current.some(item
  // => item.id === action.id)`). An action resumed multiple times over a busy stack (several
  // responses each resolving in turn, handing priority back to the same still-pending spell between
  // each one) re-logged that same "casts X..." line — with its wording drifting between calls since
  // requiredPasses is recomputed fresh each time (whoever could still respond keeps shrinking as the
  // stack empties out) — every single time, which is what produced the repeated "Encountered two
  // children with the same key" React warnings for the same event id.
  function resumeStackAction(action: PendingAction) {
    // holdPriorityOnce is consumed here rather than in passPriority — a one-shot "stop me on the
    // very next window" is used up the moment the next window is actually opened/reopened, whether
    // or not it ends up including the human (their affordability check may simply say no).
    const holdSeatId = holdPriorityOnce ? humanSeat.id : undefined;
    if (holdPriorityOnce) setHoldPriorityOnce(false);
    const requiredPasses = pendingActionRequiredPasses(session.seats, action, activeSeatId, session, manaPools, priorityStopSettings, holdSeatId);
    if (requiredPasses.length === 0) {
      window.setTimeout(() => resolvePendingAction(action), 0);
      return;
    }
    setPendingAction(action);
    setPriorityPasses([]);
    setPrioritySeatId(
      nextPrioritySeatId(session.seats, action.actorSeatId, [], action, activeSeatId, session, manaPools, priorityStopSettings, holdSeatId)
    );
  }

  function beginPendingAction(action: PendingAction, detail: string, preChosenSacrificeTargets?: VisibleCard[]) {
    // Set when this cast has its own triggers (Ledger Shredder's "cast your second spell", Mystic
    // Remora, ...) waiting to be queued below — rule 601.2i puts those on the stack ABOVE the spell
    // that triggered them before anyone gets priority, so this spell must not open its own priority
    // window (fast-resolve or otherwise) until that's happened. Reported live: Moon-Blessed Cleric's
    // ETB search resolved (and even prompted the human to pick an enchantment) before Ledger
    // Shredder's connive trigger from casting it — because the trigger-queuing below is itself
    // deferred via setTimeout to dodge reentrancy, and the requiredPasses.length===0 fast path
    // further down used to fire its own independent setTimeout unconditionally, racing (and usually
    // winning against) the trigger ever making it onto the stack.
    let hasCastTriggers = false;
    if (action.type === "spell" && !action.isCopy) {
      checkCastTriggeredKeywords(action);
      const sourceCard = findSpellSourceCard(session, action);
      if (sourceCard) {
        const turnSeatKey = `${session.turn}:${action.actorSeatId}`;
        const priorSpellCount = spellsCastThisTurn.current.get(turnSeatKey) ?? 0;
        const castOrdinal = priorSpellCount + 1;
        spellsCastThisTurn.current.set(turnSeatKey, castOrdinal);
        // Old Stickfingers: "When you cast this spell, reveal ... until you reveal X creature cards ..." (resolves before the spell does).
        if (/when you cast this spell, reveal cards from the top of your library until you reveal/i.test(sourceCard.oracleText)) {
          setSession((current) => applyCastRevealUntilCreatures(current, action.actorSeatId, sourceCard, action.chosenX));
        }
        const castTriggers = findCastTriggers(session, action.actorSeatId, sourceCard, castOrdinal);
        hasCastTriggers = castTriggers.length > 0;
        // Deferred, same reasoning as the land-ETB-trigger scheduling elsewhere in this file:
        // queueCommonTriggers itself calls beginPendingAction, so calling it synchronously here
        // (still inside this very call to beginPendingAction) would be reentrant.
        if (hasCastTriggers) {
          window.setTimeout(() => queueCommonTriggers(castTriggers), 0);
        }
      }
    }
    // See resumeStackAction's own matching comment — consumed here for the same reason, whichever of
    // the two functions actually opens the next window.
    const holdSeatId = holdPriorityOnce ? humanSeat.id : undefined;
    if (holdPriorityOnce) setHoldPriorityOnce(false);
    const requiredPasses = pendingActionRequiredPasses(session.seats, action, activeSeatId, session, manaPools, priorityStopSettings, holdSeatId);
    // Whether the human specifically had a real response here but the stops policy chose to
    // auto-pass it anyway (as opposed to genuinely having nothing to respond with) — computed by
    // asking the same question under full control, where every legal response always stops. Purely
    // for the event-log wording below; a skipped response should never look identical to "nothing to
    // respond with" in the log.
    const humanAutoPassedByPolicy =
      !requiredPasses.includes(humanSeat.id) &&
      pendingActionRequiredPasses(session.seats, action, activeSeatId, session, manaPools, { ...priorityStopSettings, fullControl: true }, holdSeatId).includes(
        humanSeat.id
      );
    pushStackAction(action);
    // Rule 601.2h: a mandatory additional cost (Village Rites' "sacrifice a creature", ...) is paid
    // immediately when casting, the same moment as mana — computed once here rather than at each of
    // the several call sites that can create a "spell" PendingAction (playCard, respondWithCard,
    // agentRespondWithCard, miracle), since hasResolvableTarget already guarantees a legal sacrifice
    // exists before any of them are allowed to construct this action in the first place.
    const castSourceCard = action.type === "spell" && !action.isCopy ? findSpellSourceCard(session, action) : undefined;
    const additionalSacrifice = castSourceCard ? parseAdditionalSacrificeCost(castSourceCard.oracleText) : undefined;
    const actorSeat = session.seats.find((seat) => seat.id === action.actorSeatId);
    // preChosenSacrificeTargets: a human already picked which creature via the interactive
    // choose_creature_to_sacrifice_for_cast detour (playCard/respondWithCard's own interception,
    // before this action was ever constructed) — used in place of chooseSacrificeTargets' heuristic
    // when present, same "human choice overrides the deterministic pick" shape as
    // choose_creature_to_sacrifice's payGenericSacrificeCost call elsewhere in this file.
    const sacrificeTargets =
      preChosenSacrificeTargets ?? (additionalSacrifice && actorSeat ? chooseAdditionalCostSacrifice(actorSeat, additionalSacrifice, action.type === "spell" ? action.manaSourceIds : [], action.type === "spell" ? action.cardId : undefined) : undefined);
    setSession((current) => {
      // Rule 601.2h: costs are paid as part of casting a spell, immediately — not deferred until
      // it resolves. This used to only happen in playCardFromZone at resolution time, so an
      // agent's chosen mana sources stayed marked untapped on the battlefield for the entire
      // window the spell sat on the stack: the same land/rock could be illegally re-selected to
      // pay for a second spell cast in response before the first one ever resolved. A human's own
      // `manaSourceIds` is empty when they paid from an already-floating pool (tapForMana already
      // tapped those sources at click time), but non-empty when respondWithCard fell back to
      // auto-tapping untapped sources for an instant-speed response — this immediate tap is what
      // stops that same land from being double-spent on a second response before this one resolves.
      // Tapping again at resolution is a no-op either way once a source is already tapped/sacrificed.
      const manaSpentSession: GameSession = {
        ...current,
        seats:
          action.type === "spell" && action.manaSourceIds.length > 0
            ? current.seats.map((seat) => (seat.id === action.actorSeatId ? spendManaSources(seat, action.manaSourceIds) : seat))
            : current.seats
      };
      // Routed through destroyCreatures (not a raw zone move) so this sacrifice is scanned for death
      // triggers exactly like every other death path (combat, removal, state-based) already is —
      // previously a direct moveCardBetweenVisibleZones call here silently skipped that scan
      // entirely. Reported live as Meren of Clan Nel Toth's "whenever another creature you control
      // dies, you get an experience counter" never firing off a Village Rites-style additional-cost
      // sacrifice, even though the identical sacrifice via an ETB effect (Plaguecrafter) already
      // correctly triggered it.
      const sacrificedSession = sacrificeTargets
        ? sacrificeForAdditionalCost(manaSpentSession, action.actorSeatId, sacrificeTargets, action.type === "spell" ? action.cardName : "this spell")
        : manaSpentSession;
      // Same moment, same rule (601.2h) for a discard cost — see payAdditionalDiscardCost.
      const discardPaidSession = castSourceCard && parseAdditionalDiscardCost(castSourceCard.oracleText) ? payAdditionalDiscardCost(sacrificedSession, action.actorSeatId, castSourceCard) : sacrificedSession;
      // The mana value of the creature sacrificed as the additional cost is stamped on the spell, for "mana value X or less, where X is 2 plus the
      // sacrificed creature's mana value" (Eldritch Evolution) to read when it resolves.
      const costsPaidSession: GameSession =
        action.type === "spell" && sacrificeTargets && sacrificeTargets.length > 0
          ? {
              ...discardPaidSession,
              seats: discardPaidSession.seats.map((seat) =>
                seat.id !== action.actorSeatId ? seat : { ...seat, board: { ...seat.board, hand: seat.board.hand.map((handCard) => (handCard.id === action.cardId ? { ...handCard, sacrificedManaValue: sacrificeTargets.reduce((sum, target) => sum + target.manaValue, 0) } : handCard)) } }
              )
            }
          : discardPaidSession;
      const noResponseNote = humanAutoPassedByPolicy ? `No stop set for ${session.phase} — auto-passed.` : "No available responses.";
      // "X casts Harrow, sacrificing Forest": the additional cost is paid now, at cast time, and stays paid even if the spell is countered.
      const castMessage =
        action.type === "spell" && sacrificeTargets && sacrificeTargets.length > 0 && action.message.endsWith(".")
          ? `${action.message.slice(0, -1)}, sacrificing ${sacrificeTargets.map((target) => target.name).join(" and ")}.`
          : action.message;
      const baseMessage =
        detail === "Stack" && action.type === "spell"
          ? `${castMessage} ${requiredPasses.length > 0 ? "Waiting for responses." : noResponseNote}`
          : `${castMessage}${requiredPasses.length > 0 ? "" : ` ${noResponseNote}`}`;
      return {
        ...costsPaidSession,
        events: [
          {
            id: action.id,
            at: new Date().toISOString(),
            seatId: action.actorSeatId,
            message: baseMessage,
            detail
          },
          ...costsPaidSession.events
        ]
      };
    });

    // hasCastTriggers: leave this action sitting on the stack (already pushed above) with no
    // priority window of its own for now — the deferred queueCommonTriggers call above will push its
    // trigger(s) on top and open the real next window, and resumeTopStackAction reopens this one
    // normally once that trigger clears (see beginPendingAction's own comment on why).
    if (hasCastTriggers) return;

    if (requiredPasses.length === 0) {
      window.setTimeout(() => resolvePendingAction(action), 0);
      return;
    }

    setPendingAction(action);
    setPriorityPasses([]);
    setPrioritySeatId(
      nextPrioritySeatId(session.seats, action.actorSeatId, [], action, activeSeatId, session, manaPools, priorityStopSettings, holdSeatId)
    );
  }

  function respondWithSelectedCard() {
    if (!selectedHandCardId) return;
    respondWithCard(selectedHandCardId, "hand");
  }

  // Generalized so a human can respond with either a hand card (the normal "Play Selected during
  // a response window" flow) or an exiled card they currently have play permission for — gated by
  // the same canCastAtInstantSpeed check either way, so an exiled sorcery still isn't offered as a
  // response, only an exiled instant/flash card is.
  function respondWithCard(cardId: string, sourceZone: "hand" | "exile", preChosenSacrificeTargets?: VisibleCard[], castChoices?: CastChoices, faceIndex?: number) {
    if (humanActionBlockedByChoice(humanSeat.id)) return;
    if (!pendingAction || prioritySeatId !== humanSeat.id) {
      if (pendingAction) addEvent("You don't have priority right now, so you can't cast that yet.", humanSeat.id, "Timing");
      return;
    }
    const card = sourceZone === "exile" ? findExiledCardAnySeat(session, cardId) : humanSeat.board.hand.find((item) => item.id === cardId);
    if (!card) return;
    // A split / Adventure card answered with from the hand: the caster chooses ONE half (instant-speed halves only) and pays only that half's cost.
    const respondFaces = sourceZone === "hand" ? independentlyCastableSpellFaces(card) : undefined;
    if (respondFaces && faceIndex === undefined) {
      const decision = castFaceDecision(session, humanSeat, card, activeSeatId, poolForSeat(humanSeat.id), true);
      if (decision.kind === "single") {
        faceIndex = decision.faceIndex;
      } else if (decision.kind === "choose") {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_cast_face",
          controllerSeatId: humanSeat.id,
          sourceCardId: cardId,
          sourceCardName: card.name,
          prompt: `${card.name}: which half do you cast? You pay only that half's cost.`,
          options: decision.options.filter((option) => option.castable && option.payable).map((option) => ({ faceIndex: option.faceIndex, label: option.label })),
          resume: { via: "respondWithCard", cardId, sourceZone }
        });
        return;
      } else if (decision.kind === "unpayable") {
        addEvent(`${humanSeat.name} cannot respond with ${card.name}: ${decision.options.map((option) => `${option.label.replace(/^Cast /, "")} ${option.castable ? "cannot be paid" : "cannot be cast right now"}`).join("; ")}.`, humanSeat.id, "Mana");
        return;
      }
    }
    const respondHalf = respondFaces && faceIndex !== undefined ? respondFaces[faceIndex] : undefined;
    // Everything below prices and judges the chosen half (name, type, text, cost), not the combined card.
    const castView = respondHalf ? spellFaceCostCard(card, respondHalf) : card;
    if (
      sourceZone === "exile" &&
      (card.exiledPlayableBySeatId !== humanSeat.id || (card.exiledPlayableUntilTurn !== undefined && session.turn > card.exiledPlayableUntilTurn))
    ) {
      addEvent(`You may not cast ${card.name} from exile (the permission has expired or isn't yours).`, humanSeat.id, "Timing");
      return;
    }
    if (!canCastAtInstantSpeed(castView, seatHasFlashGrant(humanSeat, castView)) && !(sourceZone === "exile" && card.exiledPlayableAnyTime)) {
      addEvent(`${humanSeat.name} cannot respond with ${card.name}; it is not playable at instant speed.`, humanSeat.id, "Mana");
      return;
    }
    if (!hasResolvableTarget(session, humanSeat.id, castView)) {
      addEvent(`${humanSeat.name} cannot respond with ${card.name}; there is no legal target.`, humanSeat.id, "Mana");
      return;
    }
    if (spellCastLockedOut(session, humanSeat.id, activeSeatId) || castRestrictedByTurnCount(session, card)) {
      addEvent(`${humanSeat.name} cannot respond with ${card.name}: an effect stops this player from casting spells right now.`, humanSeat.id, "Rules action");
      return;
    }
    // Same interactive detour as playCard's own — see choose_creature_to_sacrifice_for_cast's doc
    // comment for why this has to happen before the spell goes on the stack, not after. Nothing
    // above this point has mutated state yet (pendingAction/prioritySeatId are read, not written),
    // so re-entering respondWithCard once the human picks just replays this function from the top.
    if (!preChosenSacrificeTargets) {
      const additionalSacrificeCost = parseAdditionalSacrificeCost(card.oracleText);
      if (
        additionalSacrificeCost?.count === 1 &&
        additionalSacrificeCandidates(humanSeat, additionalSacrificeCost, cardId).length > 1
      ) {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_creature_to_sacrifice_for_cast",
          controllerSeatId: humanSeat.id,
          sourceCardId: cardId,
          sourceCardName: card.name,
          prompt: `${card.name}: choose ${additionalSacrificeCost.permanentType === "creature" ? "a creature" : `a ${additionalSacrificeCost.permanentType}`} to sacrifice as an additional cost.`,
          sacrificeType: additionalSacrificeCost.permanentType,
          resumeVia: "respondWithCard", faceIndex: respondHalf ? faceIndex : undefined,
          sourceZone
        });
        return;
      }
    }
    const counterAbility = parseCounterSpellAbility(castView.oracleText);
    // The agent path (legalPriorityActions) already refuses to even offer a type-restricted
    // counterspell ("counter target creature/noncreature/commander spell") against an illegal
    // target — this mirrors that same check for a human's own respond flow, which previously had
    // no such gate at all: selecting e.g. Essence Scatter (creature-only) against a noncreature
    // spell would spend the mana and card, then silently do nothing useful at resolution, with no
    // explanation of why. Checked before mana leaves the pool, same as the no-legal-target check
    // above, so a rejected response doesn't cost anything.
    if (counterAbility && !parseModalHeader(castView.oracleText)) {
      const counterTargetCard = pendingAction.type === "spell" ? findSpellSourceCard(session, pendingAction) : undefined;
      const isCommanderSpell = pendingAction.type === "spell" && pendingAction.sourceZone === "command";
      const legalCounterTarget =
        counterTargetCard &&
        !spellIsImmuneToCounters(session, counterTargetCard, pendingAction.actorSeatId) &&
        counterSpellCanTarget(counterAbility, counterTargetCard.typeLine, isCommanderSpell);
      if (!legalCounterTarget) {
        addEvent(
          `${humanSeat.name} cannot respond with ${card.name}; ${pendingAction.type === "spell" ? `it can't legally counter ${pendingAction.cardName}` : "there is no spell on the stack to counter"}.`,
          humanSeat.id,
          "Mana"
        );
        return;
      }
    }
    const fixedCost = adjustedCastingCost(humanSeat, castView, castView.manaValue, sourceZone === "exile" ? "exile" : "hand", activeSeatId, session.seats) + targetingTax(session, humanSeat.id, castChoices?.targets ?? []);
    const pool = poolForSeat(humanSeat.id);
    // canReceivePriorityForPendingAction already offers this priority window whenever untapped
    // lands could cover the cost, not only when mana is already floating — payment must accept the
    // same fallback (auto-tap, same as the agent path and acceptMiracleOffer), or a human who
    // hasn't manually pre-tapped can never actually resolve an instant-speed response even though
    // they were given the chance to try.
    const chosenX = manaPoolTotal(pool) > 0 ? maxAffordableX(humanSeat, castView, fixedCost, pool) : maxAffordableX(humanSeat, castView, fixedCost);
    const respondWaived = castView.manaValue > 0 && adjustedCastingCost(humanSeat, castView, castView.manaValue, sourceZone === "exile" ? "exile" : "hand", activeSeatId, session.seats) === 0;
    const adjustedCost = respondWaived ? fixedCost : totalCastingCost(humanSeat, castView, castView.manaValue, chosenX, session.seats);
    const payment = payCastingCost(humanSeat.id, humanSeat, castView, adjustedCost);
    const availableMana = payment.ok ? manaPoolTotal(payment.spent) : selectedManaTotal(humanSeat, payment.sourceIds);
    if (!isLandCard(card) && !payment.ok) {
      addEvent(cannotPayMessage(humanSeat, castView, availableMana, adjustedCost, payment.reason), humanSeat.id, "Mana");
      return;
    }
    const manaSourceIds = isLandCard(card) ? [] : payment.sourceIds;
    if (!castChoices && !isLandCard(card)) {
      const answers: CastChoices = { targets: [] };
      const firstPrompt = nextCastPrompt(session, humanSeat.id, castView, chosenX > 0 ? chosenX : undefined, answers);
      if (firstPrompt) {
        openCastPrompt(firstPrompt, { planCard: castView, chosenX: chosenX > 0 ? chosenX : undefined, answers, resume: { via: "respondWithCard", cardId, sourceZone, faceIndex: respondHalf ? faceIndex : undefined, sacrificeTargets: preChosenSacrificeTargets } });
        return;
      }
    }
    if (!isLandCard(card) && payment.ok) {
      applyCastingCostPaymentSideEffect(humanSeat.id, payment);
    }
    const counterTargetId = counterAbility && pendingAction.type === "spell" ? pendingAction.id : undefined;
    const action: PendingAction = {
      id: crypto.randomUUID(),
      type: "spell",
      actorSeatId: humanSeat.id,
      cardId,
      cardName: castView.name,
      cardTypeLine: castView.typeLine,
      sourceZone: sourceZone === "exile" ? "exile" : undefined,
      manaSourceIds,
      manaSpentColors: payment.ok ? spentManaColors(payment.spent) : undefined,
      faceIndex: respondHalf ? faceIndex : undefined,
      chosenX: chosenX > 0 ? chosenX : undefined,
      counterTargetId,
      castChoices,
      message: `${humanSeat.name} responds with ${castView.name}${chosenX > 0 ? ` (X=${chosenX})` : ""}${stackTargetText(session, castChoices?.targets ?? [], counterTargetId && pendingAction.type === "spell" ? pendingAction.cardName ?? "a spell" : undefined, castModeLabels(castView, chosenX > 0 ? chosenX : undefined, castChoices))}${sourceZone === "exile" ? " from exile" : ""}.`
    };
    if (sourceZone === "hand") setSelectedHandCardId(undefined);
    beginPendingAction(action, "Stack", preChosenSacrificeTargets);
  }

  // Every route into resolution (all passed, nothing to respond to, auto-resolve) comes through here. A spell, ability or trigger first waits out a
  // short visible "Resolving…" beat on the stack, then really resolves; its result lines are read off the events produced meanwhile.
  function resolvePendingAction(action: PendingAction) {
    const beat = stackBeatMs(action);
    if (beat <= 0) {
      resolvePendingActionNow(action);
      return;
    }
    if (resolveBeatIds.current.has(action.id)) return;
    resolveBeatIds.current.add(action.id);
    const view = withPendingActionSourceCard(session, action, stackActionsRef.current) as unknown as StackFeedEntry["view"];
    const startEventId = session.events[0]?.id;
    setStackFeed((previous) => [{ id: action.id, view, startEventId, status: "resolving" as const }, ...previous.filter((entry) => entry.id !== action.id)].slice(0, 5));
    window.setTimeout(() => {
      resolveBeatIds.current.delete(action.id);
      // A response was put on the stack while the beat ran: it resolves first and this item comes back through the normal stack resume.
      const stack = stackActionsRef.current;
      const index = stack.findIndex((item) => item.id === action.id);
      if (index >= 0 && index < stack.length - 1) {
        setStackFeed((previous) => previous.filter((entry) => entry.id !== action.id));
        return;
      }
      // flushSync: resolution used to run inside a click handler, where React applies every state update before the handler returns. The
      // resolver reads values written inside its own setSession updater (the library search to open, triggers to queue) from a follow-up
      // timer, so from this timer it must see the same thing: without it the updater had not run yet and Cultivate never opened its search.
      flushSync(() => resolveNowRef.current(action));
      setStackFeed((previous) => previous.map((entry) => (entry.id === action.id ? { ...entry, status: "resolved" as const, resolvedAt: Date.now() } : entry)));
    }, beat);
  }

  function resolvePendingActionNow(action: PendingAction) {
    setPendingAction(undefined);
    setPriorityPasses([]);
    if (action.type === "phase") {
      setSession((current) => {
        const next = resolvePhaseAdvance(current);
        checkMiracleAfterDraw(current, next);
        return next;
      });
      return;
    }

    if (action.type === "trigger") {
      const remainingStack = removeStackAction(action.id);
      beginTriggerResolution(action, remainingStack);
      return;
    }

    // "unless that player pays {N}" cast triggers (Mystic Remora, Esper Sentinel, ...) used to be
    // checked here, at the triggering spell's own resolution — see findCastTriggers' own doc comment
    // on why that broke the moment the spell got countered (its resolution is never reached at all).
    // They're now found and queued at cast time instead, the same way every other cast trigger is —
    // see beginPendingAction's own findCastTriggers call.

    // Lim-Dûl's Vault's repeatable look/bottom loop (see startLimDulVaultLook's own comment) needs
    // its own interactive flow the generic spell-resolution path further below has no way to
    // express — intercepted here, before that path runs, for a human caster only; an agent caster
    // still falls through to it unchanged (declined as manual_review, same as before this existed).
    if (action.type === "spell") {
      const actor = session.seats.find((seat) => seat.id === action.actorSeatId);
      const sourceCard = findSpellSourceCard(session, action);
      if (actor?.kind === "human" && isLimDulsVault(sourceCard?.name)) {
        const remainingStack = removeStackAction(action.id);
        setSession((current) => moveCardBetweenVisibleZones(current, action.actorSeatId, action.cardId, "graveyard"));
        startLimDulVaultLook(action.actorSeatId);
        resumeTopStackAction(remainingStack);
        return;
      }
      // An agent caster: resolved by a deterministic chooser (bounded pay-life loop, best card on top) instead of doing nothing.
      if (actor && actor.kind !== "human" && sourceCard && isLimDulsVault(sourceCard.name)) {
        const remainingStack = removeStackAction(action.id);
        setSession((current) => resolveAgentLimDulVault(moveCardBetweenVisibleZones(current, action.actorSeatId, action.cardId, "graveyard"), action.actorSeatId, sourceCard.name));
        resumeTopStackAction(remainingStack);
        return;
      }
      // "Put target creature card from a graveyard onto the battlefield." (Reanimate, and any other
      // single-effect any-graveyard reanimation spell) — same "needs its own interactive flow, no
      // way to express it inside the generic spell-resolution chain further below" reasoning as
      // Lim-Dûl's Vault just above: that chain runs entirely inside a pure setSession updater with
      // no access to setPendingRuleChoice, so chooseReanimationTarget's heuristic auto-pick was all
      // it could ever do. Virtue of Persistence already has this exact human branch for its own
      // (phase-trigger) version of the same effect (see the phaseTriggersChecked effect above) — this
      // is the missing cast-spell counterpart. Reported live as "Reanimate didn't let me choose
      // target creature from a graveyard." Scoped to anyGraveyard reanimate effects only (Persist's
      // own-graveyard-only version stays on the deterministic path unchanged) and only when it's the
      // spell's entire resolution (no modal header) so deferring here can't silently skip some other
      // simultaneous effect the same card also has.
      const isModalReanimateCard = sourceCard ? Boolean(parseSpellModalHeader(sourceCard.oracleText)) : false;
      const reanimateZoneEffect = sourceCard && !isModalReanimateCard ? parseZoneEffect(etbEffectText(sourceCard.oracleText)) : undefined;
      if (actor?.kind === "human" && !action.castChoices && sourceCard && reanimateZoneEffect?.kind === "reanimate" && reanimateZoneEffect.anyGraveyard) {
        const remainingStack = removeStackAction(action.id);
        setSession((current) => moveCardBetweenVisibleZones(current, action.actorSeatId, action.cardId, "graveyard"));
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_creature_from_graveyards",
          controllerSeatId: action.actorSeatId,
          sourceCardId: sourceCard.id,
          sourceCardName: sourceCard.name,
          prompt: `${sourceCard.name}: choose a creature card in any graveyard to return to the battlefield.`,
          loseLifeEqualToManaValue: reanimateZoneEffect.loseLifeEqualToManaValue
        });
        resumeTopStackAction(remainingStack);
        return;
      }
      // Eternal Witness/Regrowth-shaped "return target card from your graveyard to your hand" — same
      // "needs its own interactive flow" reasoning as the Reanimate branch just above. A permanent
      // whose ETB is a regrow effect (Eternal Witness, not just Regrowth-style sorceries) still needs
      // the normal battlefield-entry treatment (playCardFromZone) and its own ETB-trigger scan; this
      // deliberately skips this file's OTHER simultaneous-ETB extras a few hundred lines below (tokens,
      // X/multikicker/color counters, explore) — same declared simplification the Reanimate/Lim-Dûl's
      // Vault branches above already accept, on the theory that a real "target card" ETB never also
      // needs those. Only intercepts when there's an actual decision (2+ legal targets) — see
      // maybeRequestTarget's own doc comment. Reported live: Eternal Witness returned via Living Death
      // (and the same gap applies to casting it directly) picked "some card" with no say from the human.
      if (actor?.kind === "human" && !action.castChoices && sourceCard && reanimateZoneEffect?.kind === "regrow") {
        const regrowSpec = zoneEffectTargetSpec(reanimateZoneEffect);
        const regrowPool = regrowSpec ? legalTargets(session, action.actorSeatId, regrowSpec, sourceCard) : [];
        const optional = /\byou may\b/i.test(etbEffectText(sourceCard.oracleText));
        // "you may return target card ..." (Eternal Witness) is a real decision even with a single legal card: decline = return nothing.
        if (regrowSpec && (regrowPool.length > 1 || (optional && regrowPool.length > 0))) {
          const remainingStack = removeStackAction(action.id);
          const resolutionDestination = spellResolutionDestination(session, action);
          let capturedEntryTriggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];
          setSession((current) => {
            const played = playCardFromZone(
              current,
              action.actorSeatId,
              action.cardId,
              `${action.cardName} resolves.`,
              action.position,
              resolutionDestination,
              action.manaSourceIds,
              action.sourceZone ?? "hand",
              action.faceIndex
            );
            if (resolutionDestination === "battlefield") capturedEntryTriggers = findCommonTriggersForPermanentEntered(played, action.actorSeatId, sourceCard!);
            return played;
          });
          if (capturedEntryTriggers.length > 0) queueCommonTriggers(capturedEntryTriggers);
          setPendingRuleChoice({
            id: crypto.randomUUID(),
            kind: "choose_effect_target",
            controllerSeatId: action.actorSeatId,
            sourceCardId: sourceCard.id,
            sourceCardName: sourceCard.name,
            sourceCard,
            prompt: regrowSpec.prompt,
            spec: regrowSpec,
            optional,
            pending: { kind: "zone", effect: reanimateZoneEffect }
          });
          resumeTopStackAction(remainingStack);
          return;
        }
      }
      // Generic destroy/exile/bounce/damage spells (Murder, Swords to Plowshares, Lightning Bolt,
      // ...) cast directly — same "needs its own interactive flow" reasoning as the two branches
      // above, for the removal-effect family instead of the zone-effect one. Deliberately excludes a
      // modal card (parseRemovalEffect returns its "modal" kind for one, and removalEffectTargetSpec
      // returns undefined for that kind — the mode itself isn't chosen yet here) and "any target"
      // damage (removalEffectTargetSpec also declines that — needs a combined creature-or-player pool
      // this phase doesn't build). Only intercepts with a real decision (2+ legal targets).
      // A cast modal spell: the human picks the mode(s).
      const modalPrompt = actor?.kind === "human" && !action.castChoices && sourceCard ? spellModePrompt(session, action.actorSeatId, sourceCard, action.chosenX) : undefined;
      if (actor?.kind === "human" && sourceCard && modalPrompt) {
        const remainingStack = removeStackAction(action.id);
        const resolutionDestination = spellResolutionDestination(session, action);
        setSession((current) =>
          playCardFromZone(current, action.actorSeatId, action.cardId, `${action.cardName} resolves.`, action.position, resolutionDestination, action.manaSourceIds, action.sourceZone ?? "hand", action.faceIndex)
        );
        if (modalPrompt.chooseCount === 1 && modalPrompt.removalModes) {
          // A single removal mode keeps the existing flow, which also lets the human pick that mode's target.
          setPendingRuleChoice({
            id: crypto.randomUUID(),
            kind: "choose_modal_option",
            controllerSeatId: action.actorSeatId,
            sourceCardId: sourceCard.id,
            sourceCardName: sourceCard.name,
            prompt: `${sourceCard.name}: choose one.`,
            options: modalPrompt.removalModes.map((mode, index) => ({ index, label: modalPrompt.labels[index] ?? describeRemovalMode(mode) })),
            modes: modalPrompt.removalModes,
            sourceCard
          });
        } else {
          setPendingRuleChoice({
            id: crypto.randomUUID(),
            kind: "choose_spell_modes",
            controllerSeatId: action.actorSeatId,
            sourceCardId: sourceCard.id,
            sourceCardName: sourceCard.name,
            sourceCard,
            chooseCount: modalPrompt.chooseCount,
            chosenX: action.chosenX,
            removalModes: modalPrompt.removalModes,
            genericModes: modalPrompt.genericModes,
            distinctPerTurn: modalPrompt.distinctPerTurn,
            labels: modalPrompt.labels,
            picked: []
          });
        }
        resumeTopStackAction(remainingStack);
        return;
      }
      // Ram Through / Bite Down / Tamiyo's Safekeeping / "any target" damage: the human picks the targets from a labeled list.
      const labeledSpell = actor?.kind === "human" && !action.castChoices && sourceCard ? spellTargetSlots(session, action.actorSeatId, sourceCard, action.chosenX) : undefined;
      if (actor?.kind === "human" && sourceCard && labeledSpell) {
        const remainingStack = removeStackAction(action.id);
        const resolutionDestination = spellResolutionDestination(session, action);
        setSession((current) =>
          playCardFromZone(current, action.actorSeatId, action.cardId, `${action.cardName} resolves.`, action.position, resolutionDestination, action.manaSourceIds, action.sourceZone ?? "hand", action.faceIndex)
        );
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_labeled_target",
          controllerSeatId: action.actorSeatId,
          sourceCardId: sourceCard.id,
          sourceCardName: sourceCard.name,
          sourceCard,
          slots: labeledSpell.slots,
          slotIndex: 0,
          picks: [],
          continuation: labeledSpell.continuation
        });
        resumeTopStackAction(remainingStack);
        return;
      }
      const castRemovalEffect = sourceCard && !isModalReanimateCard ? parseRemovalEffect(etbEffectText(sourceCard.oracleText)) : undefined;
      const castRemovalTargetSpec = castRemovalEffect ? removalEffectTargetSpec(castRemovalEffect, sourceCard!.id) : undefined;
      if (actor?.kind === "human" && !action.castChoices && sourceCard && castRemovalEffect && castRemovalTargetSpec) {
        const removalPool = legalTargets(session, action.actorSeatId, castRemovalTargetSpec, sourceCard);
        // "you may destroy target ..." (Reclamation Sage) is a real decision even with a single legal target: decline = destroy nothing.
        const optionalRemoval = /\byou may\b/i.test(etbEffectText(sourceCard.oracleText));
        if (removalPool.length > 1 || (optionalRemoval && removalPool.length > 0)) {
          const remainingStack = removeStackAction(action.id);
          const resolutionDestination = spellResolutionDestination(session, action);
          setSession((current) =>
            playCardFromZone(
              current,
              action.actorSeatId,
              action.cardId,
              `${action.cardName} resolves.`,
              action.position,
              resolutionDestination,
              action.manaSourceIds,
              action.sourceZone ?? "hand",
              action.faceIndex
            )
          );
          setPendingRuleChoice({
            id: crypto.randomUUID(),
            kind: "choose_effect_target",
            controllerSeatId: action.actorSeatId,
            sourceCardId: sourceCard.id,
            sourceCardName: sourceCard.name,
            sourceCard,
            prompt: castRemovalTargetSpec.prompt,
            spec: castRemovalTargetSpec,
            optional: optionalRemoval,
            pending: { kind: "removal", effect: castRemovalEffect, chosenX: action.chosenX }
          });
          resumeTopStackAction(remainingStack);
          return;
        }
      }
    }

    if (action.counterTargetId) {
      const counterTargetAction = stackActionsRef.current.find((item) => item.id === action.counterTargetId);
      if (counterTargetAction && counterTargetAction.type === "spell") {
        const counterCardRaw = findSpellSourceCard(session, action);
        const counterAbility = counterCardRaw ? parseCounterSpellAbility(counterCardRaw.oracleText) : undefined;
        const targetSeat = session.seats.find((seat) => seat.id === counterTargetAction.actorSeatId);
        // Prefer whatever the targeted caster (a human) already has floating, same pool-first-then-
        // auto-tap preference as every other cost — they get one shot at this the instant the
        // counterspell resolves, so if they'd pre-tapped specific lands in anticipation, that choice
        // is honored instead of being silently ignored in favor of auto-tapping different lands.
        const taxCard = counterAbility?.taxAmount !== undefined ? genericCostShim(counterAbility.taxAmount) : undefined;
        const targetPool = targetSeat?.kind === "human" ? poolForSeat(targetSeat.id) : undefined;
        const taxPoolPayment = taxCard && targetPool ? payCostFromPool(targetPool, taxCard, counterAbility!.taxAmount!) : undefined;
        const taxPayment =
          counterAbility?.taxAmount !== undefined && targetSeat
            ? taxPoolPayment?.ok
              ? taxPoolPayment
              : chooseManaSourcesForCost(targetSeat, taxCard!, counterAbility.taxAmount, undefined, session.seats)
            : undefined;
        if (taxPoolPayment?.ok && targetSeat) {
          setSeatManaPool(targetSeat.id, taxPoolPayment.pool);
          clearManaContributions(targetSeat.id);
        }
        const counterTargetCard = findSpellSourceCard(session, counterTargetAction);
        const immune = counterTargetCard ? spellIsImmuneToCounters(session, counterTargetCard, counterTargetAction.actorSeatId) : false;
        const isCountered = !immune && !(counterAbility?.taxAmount !== undefined && taxPayment?.ok);

        const remainingStackAfterCounterspell = removeStackAction(action.id);
        const stackAfterCounter = isCountered ? removeStackAction(counterTargetAction.id) : remainingStackAfterCounterspell;

        setSession((current) => {
          const rawSourceCard = findSpellSourceCard(current, action);
          const sourceCard = rawSourceCard ? applyChosenFaceToCard(rawSourceCard, action.faceIndex) : undefined;
          let next = playCardFromZone(
            current,
            action.actorSeatId,
            action.cardId,
            `${action.cardName} resolves.`,
            action.position,
            "graveyard",
            action.manaSourceIds,
            action.sourceZone ?? "hand",
            action.faceIndex
          );
          if (sourceCard) void consultRulesAdvisor("spell_resolved_to_graveyard", action.actorSeatId, sourceCard);

          // Arcane Denial's delayed draws are unconditional parts of ITS resolution, separate from
          // whether the counter itself actually landed (e.g. a "can't be countered" target still
          // lets these fire) — scheduled regardless of the isCountered branch below.
          const delayedDraws = sourceCard ? parseDelayedUpkeepDraws(sourceCard.oracleText) : undefined;
          if (delayedDraws) {
            const scheduled: NonNullable<GameSession["pendingUpkeepDraws"]> = [...(next.pendingUpkeepDraws ?? [])];
            if (delayedDraws.targetControllerDraws) {
              scheduled.push({ seatId: counterTargetAction.actorSeatId, amount: delayedDraws.targetControllerDraws, sourceName: action.cardName });
            }
            if (delayedDraws.casterDraws) {
              scheduled.push({ seatId: action.actorSeatId, amount: delayedDraws.casterDraws, sourceName: action.cardName });
            }
            next = { ...next, pendingUpkeepDraws: scheduled };
          }

          if (isCountered) {
            const targetCurrentSeat = next.seats.find((seat) => seat.id === counterTargetAction.actorSeatId);
            const targetCard =
              counterTargetAction.sourceZone === "command"
                ? targetCurrentSeat?.board.commander
                : targetCurrentSeat?.board.hand.find((card) => card.id === counterTargetAction.cardId);
            if (targetCard) {
              next = moveCardBetweenVisibleZones(next, counterTargetAction.actorSeatId, targetCard.id, "graveyard");
            }
            next = {
              ...next,
              events: [
                {
                  id: crypto.randomUUID(),
                  at: new Date().toISOString(),
                  seatId: action.actorSeatId,
                  message: `${action.cardName} counters ${counterTargetAction.cardName}.`,
                  detail: "Rules action"
                },
                ...next.events
              ]
            };
            // "Its controller creates a 2/2 blue Bird creature token with flying." (Swan Song): the countered spell's controller gets the token.
            if (counterAbility?.controllerTokenClause) {
              const specs = parseCreateTokenSpecs(counterAbility.controllerTokenClause);
              if (specs.length > 0) next = createTokensForSeat(next, counterTargetAction.actorSeatId, action.cardId, specs).session;
            }
          } else {
            next = {
              ...next,
              seats: next.seats.map((seat) =>
                taxPayment?.ok && !taxPoolPayment?.ok && seat.id === counterTargetAction.actorSeatId ? spendManaSources(seat, taxPayment.sourceIds) : seat
              ),
              events: [
                {
                  id: crypto.randomUUID(),
                  at: new Date().toISOString(),
                  seatId: counterTargetAction.actorSeatId,
                  message: `${counterTargetAction.cardName}'s controller pays {${counterAbility?.taxAmount}} to avoid being countered by ${action.cardName}.`,
                  detail: "Rules action"
                },
                ...next.events
              ]
            };
          }

          if (!resumeTopStackAction(stackAfterCounter)) {
            setPrioritySeatId(action.actorSeatId);
          }
          return next;
        });
        return;
      }
    }

    const remainingStack = removeStackAction(action.id);
    // Every side effect below that isn't "just return a new session" (queueing triggers, opening a
    // pendingRuleChoice, consulting the rules advisor/static-effect interpreter, resuming the stack)
    // used to fire directly inside this updater body — React 18 StrictMode's dev-mode double-
    // invocation of functional setState updaters (see the identical land-play fix above for the
    // confirmed mechanism) called every one of them TWICE for a single spell/creature resolution,
    // since both invocations start from the same `current` and both compute a genuinely-changed
    // session (the `playedSession === current` bailout a few lines down only catches a real
    // re-dispatch of an already-resolved action, not two same-`current` StrictMode invocations).
    // Reported live as Avenger of Zendikar creating 8 Plant tokens instead of 4, and as the human's
    // commander being silently bounced to the command zone with no visible causing spell — a
    // duplicate (phantom) resolution of some other permanent's own ETB trigger re-picking a target
    // once its real target was already gone. Every one-time side effect is captured into an outer
    // variable here instead, and only actually fires once, after setSession returns.
    // Grisly Salvage-shaped "reveal the top N, you may put a <type> card into your hand, put the rest into your graveyard" cast by the
    // human: opened as the interactive look window after the updater below (the automatic pick is only for agents).
    let capturedDigLook: { amount: number; filter?: string } | undefined;
    let capturedHumanPrompt:
      | { kind: "choose_creature_type"; cardId: string; cardName: string }
      | { kind: "choose_color"; cardId: string; cardName: string; excludedColor?: string }
      | {
          kind: "choose_card_from_library";
          cardId: string;
          cardName: string;
          destination: "hand" | "battlefield" | "graveyard" | "library";
          tapped?: boolean;
          maxChoices: number;
          allowedCardFilter?: string;
        }
      | undefined;
    let capturedAdvisorCall: { event: "spell_resolved_to_battlefield" | "spell_resolved_to_graveyard"; seatId: string; sourceCard: VisibleCard; castTargets?: ChosenTarget[] } | undefined;
    let capturedStaticInterpreterCall: { seatId: string; card: VisibleCard } | undefined;
    // Mana a resolving spell adds (Mana Geyser) — mana pools live in this component's React state, not
    // in the session the updater below returns, so it's captured here and added after the updater runs.
    let capturedSpellMana: { color: ManaColor; amount: number; note?: string } | undefined;
    let capturedRestrictedMana: { amount: number; spellType: string; sourceName: string } | undefined;
    let capturedTriggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];
    setSession((current) => {
      const baseDestination = spellResolutionDestination(current, action);
      const rawSourceCard = findSpellSourceCard(current, action);
      // let, not const: reassigned below once playedSession exists, to the real post-resolution
      // battlefield card — see that reassignment's own comment for why (Estrid's Invocation's
      // "enter as a copy" bug).
      let sourceCard = rawSourceCard ? applyChosenFaceToCard(rawSourceCard, action.faceIndex) : undefined;
      // An Aura with a creature-restricted "Enchant" clause and no legal target on the battlefield
      // is put into its owner's graveyard instead of resolving (rule 608.2b); "Enchant player" is
      // targeted at a player seat instead (see attach_player below); other restrictions this
      // engine doesn't model targeting for (Enchant land/artifact) just enter without attaching
      // rather than being wrongly treated as having "no legal target."
      // An Aura aimed at cast time (the human's prompt, or an agent's pre-pick) attaches there if the target is still legal; if it is not, the spell fizzles (608.2b).
      const castAuraTarget = sourceCard && baseDestination === "battlefield" && isAura(sourceCard) ? action.castChoices?.targets[0] : undefined;
      const auraAttach: AuraAttachResult | undefined =
        sourceCard && baseDestination === "battlefield" && isAura(sourceCard)
          ? castAuraTarget && castAuraTarget.kind === "card"
            ? castTargetLegal(current, action.actorSeatId, sourceCard, castAuraTarget) && current.seats.find((seat) => seat.id === castAuraTarget.seatId)?.board.battlefield.some((card) => card.id === castAuraTarget.cardId)
              ? { kind: "attach", seatId: castAuraTarget.seatId, cardId: castAuraTarget.cardId }
              : { kind: "no_target" }
            : chooseAuraAttachTarget(current, action.actorSeatId, sourceCard.oracleText)
          : undefined;
      if (castAuraTarget && auraAttach?.kind === "attach") auraRetargetAsked.current.add(action.cardId);
      const destination = auraAttach?.kind === "no_target" ? "graveyard" : baseDestination;
      const playedSession = playCardFromZone(
        current,
        action.actorSeatId,
        action.cardId,
        `${action.cardName} resolves.`,
        action.position,
        destination,
        action.manaSourceIds,
        action.sourceZone ?? "hand",
        action.faceIndex
      );
      // playCardFromZone returns the same session reference, untouched, when the card was already
      // gone from its source zone (this spell already resolved — e.g. this very updater function
      // being invoked a second time for the same resolution, which React may do in development; see
      // the identical guard on the land-play path above for the confirmed mechanism and the bug it
      // fixed there). Bail out here too rather than falling through to the ETB-trigger scan below,
      // which would otherwise re-detect the permanent that already entered and queue a second copy
      // of its ETB/cast triggers even though nothing new actually happened — reported live as Beast
      // Whisperer and Guardian Project each drawing/triggering twice off a single creature cast.
      if (playedSession === current) return current;
      // Estrid's Invocation: "enter as a copy of an enchantment you control" is a replacement effect
      // playCardFromZone itself applies (see its own comment) — but every ETB-effect check from here
      // down (tokenSpecs, zoneEffect, removalEffect, pumpEffect, massPumpEffect, simpleLifeEffect,
      // searchLibraryEffect, isModalCard/genericModalEffect, chooseCreatureType/chooseColorEtb,
      // findCommonTriggersForPermanentEntered, and the consultRulesAdvisor/ownEtbAlreadyHandled
      // decision) reads sourceCard.oracleText, and until this reassignment it was still the STALE,
      // pre-copy reference captured above — so whatever a copy effect actually copied was silently
      // ignored and the permanent's ETB was evaluated against Estrid's Invocation's own blank text
      // instead (reported live as "did not work as intended"). findPermanentById on the post-
      // playCardFromZone session picks up the real (possibly copied) characteristics; harmless
      // no-op reassignment to an equal object for every card that isn't a copy effect.
      if (destination === "battlefield" && sourceCard) {
        sourceCard = findPermanentById(playedSession, sourceCard.id) ?? sourceCard;
      }
      // Only the entering permanent's own ETB-effect text counts here — a "dies" trigger or an
      // activated ability elsewhere in the same oracle text (e.g. Hangarback Walker's death
      // trigger) must not be read as something that happens immediately on resolution.
      // action.chosenX threaded through for "Create twice X ... tokens" (Pest Infestation) — the
      // same chosenX the removal effect further below resolves its own "destroy up to X" against.
      // countCreaturesAttackingSeat threaded through for "Create X ... tokens, where X is the
      // number of creatures attacking you" (Arachnogenesis) — a board-state count, unrelated to
      // chosenX (this card has no {X} in its cost at all).
      // A PERMANENT whose enters-effect is already a queued trigger (Grave Titan's "When this creature
      // enters or attacks, create two 2/2 Zombies", Liliana's Mastery) must not ALSO make those tokens
      // here — the trigger system creates them when it resolves, so doing both doubled every such
      // card (4 Zombies instead of 2). Non-permanent spells keep creating their tokens here.
      const etbTokensOwnedByTrigger =
        destination === "battlefield" &&
        sourceCard !== undefined &&
        commonTriggerEffect(sourceCard.oracleText, "entered", undefined, playedSession.seats.find((seat) => seat.id === action.actorSeatId))?.kind === "create_tokens";
      const tokenSpecs =
        // Syphon Flesh's "a Zombie for each creature sacrificed this way" is made by its sacrifice effect, not once more here.
        sourceCard && !etbTokensOwnedByTrigger && !/for each creature sacrificed this way/i.test(etbEffectText(sourceCard.oracleText))
          ? parseCreateTokenSpecs(etbEffectText(sourceCard.oracleText), undefined, undefined, action.chosenX, countCreaturesAttackingSeat(playedSession, action.actorSeatId))
          : [];
      // Beast Within ("its controller creates..."), Generous Gift ("its owner creates..."), and any
      // future card sharing this "destroy target permanent, the affected player creates a
      // consolation token" template: the token belongs to whoever controlled/owned the DESTROYED
      // permanent, not the caster — createTokensForSeat otherwise has no way to know that and
      // always credited the caster instead, even when they destroyed an opponent's permanent.
      // Peeking at chooseRemovalTarget here (before the removal effect itself resolves further
      // below) and again inside applyRemovalEffect's own "destroy" case both read the same
      // still-unmutated session, so they deterministically agree on the same target. Reported live
      // as Beast Within handing the caster a free 3/3 Beast when it destroyed an opponent's land
      // instead of that opponent getting it — Generous Gift's "its owner" wording (rather than
      // Beast Within's "its controller") was initially missed by this same check and reproduced
      // live moments later, handing Veyra a Food token for destroying Sable's commander.
      const tokenRecipientSeatId = (() => {
        if (!sourceCard) return action.actorSeatId;
        const grantsToOwner = /\bits owner creates\b/i.test(etbEffectText(sourceCard.oracleText));
        const grantsToController = /\bits controller creates\b/i.test(etbEffectText(sourceCard.oracleText));
        if (!grantsToOwner && !grantsToController) return action.actorSeatId;
        const previewEffect = parseRemovalEffect(etbEffectText(sourceCard.oracleText));
        if (previewEffect?.kind !== "destroy") return action.actorSeatId;
        const target = chooseRemovalTarget(
          playedSession,
          action.actorSeatId,
          previewEffect.targetType,
          sourceCard,
          previewEffect.excludedColors,
          previewEffect.artifactsExcluded,
          previewEffect.basicsExcluded,
          true
        );
        if (!target) return action.actorSeatId;
        // "Owner" and "controller" only diverge once a control-changing effect (Threaten, a Mind
        // Control-style Aura, ...) has moved the permanent off its owner's battlefield first — rare,
        // but ownerSeatId is already tracked on VisibleCard for exactly this (see the bounce case in
        // applyRemovalEffect below), so there's no reason to approximate it here.
        return grantsToOwner ? (target.card.ownerSeatId ?? target.seatId) : target.seatId;
      })();
      const baseResolvedSession =
        auraAttach?.kind === "attach"
          ? applyAuraAttachment(playedSession, action.actorSeatId, sourceCard!.id, auraAttach.seatId, auraAttach.cardId)
          : auraAttach?.kind === "attach_player"
            ? applyAuraAttachToPlayer(playedSession, action.actorSeatId, sourceCard!.id, auraAttach.seatId)
            : playedSession;
      const tokenCreation = sourceCard && tokenSpecs.length > 0 ? createTokensForSeat(baseResolvedSession, tokenRecipientSeatId, sourceCard.id, tokenSpecs, { queueEntries: false }) : undefined;
      const tokenResolvedSession = tokenCreation?.session ?? baseResolvedSession;
      // "Prevent all combat damage that would be dealt this turn[ by non-X creatures]." — reachable
      // here from a directly cast spell (Arachnogenesis, and any other Fog effect printed as an
      // instant/sorcery rather than an activated sacrifice ability like Spore Frog, whose own
      // separate applySacrificeEffect case is untouched). Applies regardless of the spell's own
      // destination, same reasoning as removalEffect/zoneEffect below.
      // Portent: "Draw a card at the beginning of the next turn's upkeep." (counterspells schedule theirs in their own branch)
      const delayedCasterDraws = sourceCard ? parseDelayedUpkeepDraws(sourceCard.oracleText)?.casterDraws : undefined;
      const delayedBase: GameSession = delayedCasterDraws
        ? { ...tokenResolvedSession, pendingUpkeepDraws: [...(tokenResolvedSession.pendingUpkeepDraws ?? []), { seatId: action.actorSeatId, amount: delayedCasterDraws, sourceName: action.cardName }] }
        : tokenResolvedSession;
      const combatPreventionSession = sourceCard ? applySpellDamagePrevention(delayedBase, action.actorSeatId, sourceCard, action.castChoices?.targets[0], action.manaSpentColors ?? []) : delayedBase;
      const xCounterSession =
        sourceCard && destination === "battlefield" && action.chosenX && entersWithXCounters(sourceCard.oracleText)
          ? applyEntersWithXCounters(combatPreventionSession, action.actorSeatId, sourceCard.id, action.chosenX)
          : combatPreventionSession;
      // Multikicker's charge-counter cycle (Everflowing Chalice, ...) reuses chosenX for "times
      // kicked" (see parseMultikickerCost) — same shape as the +1/+1-counter case above, just a
      // different counter kind and not restricted to creatures.
      const multikickerCounterSession =
        sourceCard && destination === "battlefield" && action.chosenX && entersWithChargeCounterPerKick(sourceCard.oracleText)
          ? applyEntersWithCounterKind(xCounterSession, action.actorSeatId, sourceCard.id, "charge", action.chosenX)
          : xCounterSession;
      // Ramos, Dragon Engine: a fixed (not X-cost) ETB counter count read off board state instead
      // of anything the caster chose — without this it entered with zero +1/+1 counters, so its own
      // "Add {C} for each +1/+1 counter" mana ability always produced nothing no matter how many
      // colors were actually on the battlefield.
      const colorCounterSeat = multikickerCounterSession.seats.find((seat) => seat.id === action.actorSeatId);
      const colorCounterSession =
        sourceCard && destination === "battlefield" && colorCounterSeat && entersWithCounterPerColorControlled(sourceCard.oracleText)
          ? applyEntersWithXCounters(
              multikickerCounterSession,
              action.actorSeatId,
              sourceCard.id,
              colorsAmongPermanentsControlled(colorCounterSeat, sourceCard.id)
            )
          : multikickerCounterSession;
      // Storage lands (Gemstone Mine, Dark Depths, the Vivid cycle, Tendo Ice Bridge, ...): a fixed,
      // printed ETB counter count unrelated to anything the caster chose or the board state —
      // see entersWithFixedCounterKind's own comment.
      const fixedCounterEntry = sourceCard && destination === "battlefield" ? entersWithFixedCounterKind(sourceCard.oracleText) : undefined;
      const fixedCounterSession = fixedCounterEntry
        ? applyEntersWithCounterKind(colorCounterSession, action.actorSeatId, sourceCard!.id, fixedCounterEntry.kind, fixedCounterEntry.count)
        : colorCounterSession;
      // Giada, Font of Hope & co.: a different permanent's "enters with an additional +1/+1 counter".
      const replacementCounterSession =
        sourceCard && destination === "battlefield" ? applyEntersWithCounterReplacements(fixedCounterSession, action.actorSeatId, sourceCard.id) : fixedCounterSession;
      // Josu Vess-style single kicker: remember on the permanent that it was kicked, for its "if it was kicked" trigger.
      const kickedSession =
        sourceCard && destination === "battlefield" && action.chosenX && hasSingleKicker(sourceCard.oracleText)
          ? { ...replacementCounterSession, seats: replacementCounterSession.seats.map((seat) => (seat.id === action.actorSeatId ? { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((c) => (c.id === sourceCard.id ? { ...c, kicked: true } : c)) } } : seat)) }
          : replacementCounterSession;
      const exploreTimes = sourceCard && destination === "battlefield" ? exploreCount(sourceCard.oracleText) : undefined;
      const exploredSession = exploreTimes ? resolveExplore(kickedSession, action.actorSeatId, sourceCard!.id, exploreTimes) : kickedSession;
      // Generic destroy/exile/direct-damage spells (Murder, Lightning Bolt, ...) — applies
      // regardless of where the spell itself ends up, since instants/sorceries resolve to the
      // graveyard while their effect still needs to happen.
      const etbDamageOwnedByTrigger =
        destination === "battlefield" &&
        sourceCard !== undefined &&
        commonTriggerEffect(sourceCard.oracleText, "entered", undefined, playedSession.seats.find((s) => s.id === action.actorSeatId))?.kind === "damage_effect";
      const removalEffect = sourceCard && !etbDamageOwnedByTrigger ? parseRemovalEffect(etbEffectText(sourceCard.oracleText)) : undefined;
      const castStruct = action.castChoices && sourceCard ? castStructure(sourceCard, action.chosenX) : undefined;
      // "When this creature enters, you MAY destroy target artifact or enchantment." (Reclamation Sage): the controller
      // declines rather than destroying their own permanent — a seat with no opposing target to hit skips the optional destroy.
      const optionalDestroyWithNoOpposingTarget =
        removalEffect?.kind === "destroy" &&
        !action.castChoices &&
        sourceCard !== undefined &&
        /\byou may\b/i.test(etbEffectText(sourceCard.oracleText)) &&
        !chooseRemovalTarget(
          exploredSession, action.actorSeatId, removalEffect.targetType, sourceCard, removalEffect.excludedColors, removalEffect.artifactsExcluded, removalEffect.basicsExcluded, true, removalEffect.minToughness, true
        );
      const removalResolvedSession =
        optionalDestroyWithNoOpposingTarget && sourceCard
          ? rulesEvent(exploredSession, action.actorSeatId, `${sourceCard.name}: ${exploredSession.seats.find((seat) => seat.id === action.actorSeatId)?.name ?? "the controller"} chooses not to destroy anything.`)
          : removalEffect && sourceCard
          ? action.castChoices && (castStruct?.kind === "removal" || castStruct?.kind === "removal_modal")
            ? applyCastRemoval(exploredSession, action.actorSeatId, sourceCard, removalEffect, action.chosenX, action.castChoices)
            : applyPrimitiveAction(exploredSession, action.actorSeatId, sourceCard, { kind: "removal", effect: removalEffect, chosenX: action.chosenX })
          : exploredSession;
      // "Choose one/two —" cards are fully owned by removalEffect above (if a removal-shaped mode
      // exists) or genericModalEffect below (otherwise) — the whole-text zoneEffect scan a few
      // lines down has no awareness of modal headers at all and would otherwise misfire on any
      // card whose bullets include reanimate/mill/regrow/gain-control wording, applying that one
      // bullet's effect unconditionally regardless of which mode should actually have been chosen
      // (e.g. Profane Command's reanimate mode would always trigger even on a "choose one or both"
      // card, and even if a different mode was the one actually wanted).
      // The card's OWN modal text only: a "Choose one —" behind an activated ability's cost (Cankerbloom) is not applied on cast/entry.
      const isModalCard = Boolean(sourceCard && parseSpellModalHeader(sourceCard.oracleText));
      // Reanimate/mill/regrow/steal-control spells (Reanimate, Regrowth, Threaten, ...) — same
      // "applies regardless of the spell's own destination" reasoning as removal effects above.
      const zoneEffect = sourceCard && !isModalCard ? parseEtbZoneEffect(etbEffectText(sourceCard.oracleText)) : undefined;
      const castZoneTarget = castStruct?.kind === "zone" ? action.castChoices?.targets[0] : undefined;
      const humanDigLook = zoneEffect?.kind === "look_dig" && zoneEffect.restDestination === "graveyard" && session.seats.find((seat) => seat.id === action.actorSeatId)?.kind === "human";
      if (zoneEffect?.kind === "look_dig" && humanDigLook) capturedDigLook = { amount: zoneEffect.amount, filter: zoneEffect.cardTypeFilter };
      const zoneResolvedSession =
        humanDigLook
          ? removalResolvedSession
          : zoneEffect && sourceCard
          ? castStruct?.kind === "zone" && zoneEffect.kind !== "sacrifice_then_reanimate" && (!castZoneTarget || !castTargetLegal(removalResolvedSession, action.actorSeatId, sourceCard, castZoneTarget))
            ? rulesEvent(removalResolvedSession, action.actorSeatId, `${sourceCard.name}'s target is no longer legal; it does nothing.`)
            : applyZoneEffect(removalResolvedSession, action.actorSeatId, sourceCard.name, zoneEffect, action.chosenX, castZoneTarget, castStruct?.kind === "zone" ? action.castChoices?.targets : undefined)
          : removalResolvedSession;
      // "When this artifact enters, search your library for up to two basic Plains cards, ..."
      // (Archaeomancer's Map, and the same ETB-tutor shape on plenty of other permanents) — this
      // parser already exists for activated-ability search effects (parseGenericAbilityEffect); an
      // ETB-triggered one never went through any deterministic path at all before, falling straight
      // to the Ollama-backed rules advisor for every single one, with no guarantee it actually
      // requests the card's own printed count. Originally also restricted to destination ===
      // "battlefield" on the theory that a search is only ever an ETB clause on a permanent, never a
      // spell's own destination — but plenty of sorceries (Three Visits, Nature's Lore, Rampant
      // Growth, ...) ARE nothing but this exact clause as their whole effect, resolving to the
      // graveyard like any other sorcery while the search still needs to happen. Gating on
      // destination made those fall all the way through with searchLibraryEffect permanently
      // undefined, silently doing nothing on resolution — reported live as "Three Visits resolves"
      // (mana spent, event logged) with no Forest ever actually fetched. Applies "regardless of
      // where the spell itself ends up," the same reasoning removalEffect/zoneEffect above already
      // use, scoped only to a non-modal card's own etbEffectText.
      const searchLibraryEffect =
        sourceCard && !isModalCard ? parseSearchLibraryEffectText(etbEffectText(sourceCard.oracleText)) : undefined;
      // "Each player exiles all creature cards from their graveyard, then sacrifices all creatures
      // they control, then puts all cards they exiled this way onto the battlefield." (Living Death)
      // — unrestricted by destination, same as removalEffect/zoneEffect above (it's a sorcery,
      // resolving to the graveyard, not a permanent's own ETB).
      const isLivingDeath = sourceCard && !isModalCard && isLivingDeathEffect(etbEffectText(sourceCard.oracleText));
      const livingDeathResolvedSession = isLivingDeath && sourceCard ? applyLivingDeathEffect(zoneResolvedSession, sourceCard.name) : zoneResolvedSession;
      // "Each player sacrifices a creature or planeswalker of their choice. If a player can't,
      // they discard a card instead." (Plaguecrafter) — see applyEachPlayerSacrificeEffect's own
      // doc comment for why this needs a bespoke shape instead of any existing TriggerEffect kind.
      const eachPlayerSacrificeEffect =
        sourceCard && !isModalCard && destination === "battlefield" ? parseEachPlayerSacrificeEffect(etbEffectText(sourceCard.oracleText)) : undefined;
      const eachPlayerSacrificeApplied =
        eachPlayerSacrificeEffect && sourceCard ? applyEachPlayerSacrificeEffect(livingDeathResolvedSession, sourceCard.name, eachPlayerSacrificeEffect) : undefined;
      const eachPlayerSacrificeResolvedSession = eachPlayerSacrificeApplied?.session ?? livingDeathResolvedSession;
      // A human player who had nothing to sacrifice chooses their own discard instead of getting
      // silently auto-resolved by heuristic (see applyEachPlayerSacrificeEffect's
      // humanDiscardNeededSeatId) — reuses discard_to_hand_size's picker UI/kind with an explicit
      // sourceCardName so its header and event-log message read correctly for this trigger instead
      // of "to hand size." Safe to call setPendingRuleChoice here mid-pipeline: it's an independent
      // state slice from session, and React batches both updates from this synchronous handler.
      if (eachPlayerSacrificeApplied?.humanDiscardNeededSeatId && sourceCard) {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "discard_to_hand_size",
          controllerSeatId: eachPlayerSacrificeApplied.humanDiscardNeededSeatId,
          sourceCardName: sourceCard.name,
          prompt: `${sourceCard.name}: you have no creature or planeswalker to sacrifice — choose a card to discard instead.`,
          requiredDiscards: 1
        });
      }
      // A human with a genuine choice of what to sacrifice picks their own creature/planeswalker
      // instead of getting silently auto-resolved by heuristic — see
      // applyEachPlayerSacrificeEffect's humanSacrificeNeededSeatId. Same "independent state slice,
      // safe to set mid-pipeline" reasoning as the discard choice just above.
      if (eachPlayerSacrificeApplied?.humanSacrificeNeededSeatId && sourceCard && eachPlayerSacrificeEffect) {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_each_player_sacrifice",
          controllerSeatId: eachPlayerSacrificeApplied.humanSacrificeNeededSeatId,
          sourceCardId: sourceCard.id,
          sourceCardName: sourceCard.name,
          prompt: `${sourceCard.name}: choose a ${eachPlayerSacrificeEffect.typeFilter} to sacrifice.`,
          typeFilter: eachPlayerSacrificeEffect.typeFilter
        });
      }
      // "Target creature gets +N/+N or -N/-N until end of turn." (Giant Growth, Afflict, ...) — a
      // plain (non-modal) single-mode pump/debuff spell; X is substituted from the spell's own
      // chosenX first, same as every other X-aware effect here. Modal pump modes (Profane Command's
      // -X/-X) are handled inside genericModalEffect below instead.
      const pumpEffect =
        sourceCard && !isModalCard
          ? parseTargetedPump(action.chosenX !== undefined ? substituteX(etbEffectText(sourceCard.oracleText), action.chosenX) : etbEffectText(sourceCard.oracleText))
          : undefined;
      // Any other one-verb spell on a target ("Target creature gains haste until end of turn"): the cast-time pick, or the agent's best target.
      const targetedSpellEffect = sourceCard && !isModalCard && !pumpEffect ? parseTargetedEffect(etbEffectText(sourceCard.oracleText)) : undefined;
      const targetedSpellSession =
        targetedSpellEffect && sourceCard
          ? applyTargetedEffect(eachPlayerSacrificeResolvedSession, action.actorSeatId, sourceCard, targetedSpellEffect, castStruct?.kind === "targeted" ? action.castChoices?.targets[0] : undefined)
          : eachPlayerSacrificeResolvedSession;
      const castPumpTarget = castStruct?.kind === "pump" ? action.castChoices?.targets[0] : undefined;
      const pumpResolvedSession =
        pumpEffect && sourceCard
          ? castStruct?.kind === "pump" && (!castPumpTarget || !castTargetLegal(eachPlayerSacrificeResolvedSession, action.actorSeatId, sourceCard, castPumpTarget))
            ? rulesEvent(eachPlayerSacrificeResolvedSession, action.actorSeatId, `${sourceCard.name}'s target is no longer legal; it does nothing.`)
            : applyTargetedPumpEffect(eachPlayerSacrificeResolvedSession, action.actorSeatId, sourceCard, pumpEffect, castPumpTarget)
          : targetedSpellSession;
      // Board-wide sibling of the single-target pump above: "Each non-Dragon creature gets -X/-X
      // until end of turn." (Exude Toxin, ...) — same X-substitution-first handling, just no single
      // "target creature" to find, so it needed its own parser/applier instead of reusing pumpEffect.
      const massPumpEffect =
        sourceCard && !isModalCard
          ? parseMassPump(action.chosenX !== undefined ? substituteX(etbEffectText(sourceCard.oracleText), action.chosenX) : etbEffectText(sourceCard.oracleText))
          : undefined;
      const massPumpResolvedSession =
        massPumpEffect && sourceCard ? applyMassPumpEffect(pumpResolvedSession, action.actorSeatId, sourceCard.name, massPumpEffect) : pumpResolvedSession;
      // "Return all creatures to their owners' hands." (Evacuation, and the same unqualified
      // mass-bounce wording on a few other cards) — previously entirely unmodeled (no TriggerEffect/
      // ZoneEffect kind covers "every creature on the battlefield goes to hand"), so a spell shaped
      // like this silently did nothing at all. Reported live as "Evacuation did not return all
      // creatures to their owners hands." Unrestricted by destination, same "applies regardless of
      // the spell's own destination" reasoning as removal/zone/pump above.
      const massBounceEffect = sourceCard && !isModalCard ? parseMassBounceEffect(etbEffectText(sourceCard.oracleText)) : undefined;
      const massBounceResolvedSession =
        massBounceEffect && sourceCard ? applyMassBounceEffect(massPumpResolvedSession, action.actorSeatId, sourceCard.name, massBounceEffect) : massPumpResolvedSession;
      // "Target creature gets -3/-3 until end of turn. You gain 2 life." (Locthwain Scorn, and the
      // same "removal/pump plus a flat life change" template on plenty of other real cards) — a
      // second, independent clause on the same spell that removalEffect/pumpEffect/massPumpEffect
      // above don't touch (each of those only ever recognizes its own one effect per card and
      // returns early), so without this the life change was silently dropped whenever the spell's
      // main effect was something else. Scanned as its own pass over the same scoped text, same
      // "applies regardless of the spell's own destination" reasoning as removal/zone/pump.
      // A PERMANENT whose enters-effect is already a queued trigger (Inspiring Overseer's "you gain 1 life and draw a
      // card") must not also apply its life change here — it gained 2 life instead of 1.
      const lifeOwnedByTrigger =
        destination === "battlefield" &&
        sourceCard !== undefined &&
        commonTriggerEffect(sourceCard.oracleText, "entered", undefined, playedSession.seats.find((s) => s.id === action.actorSeatId)) !== undefined;
      const simpleLifeEffect = sourceCard && !isModalCard && !lifeOwnedByTrigger ? parseSimpleLifeChange(etbEffectText(sourceCard.oracleText)) : undefined;
      const simpleLifeResolvedSession =
        simpleLifeEffect && sourceCard ? applySimpleLifeChange(massBounceResolvedSession, action.actorSeatId, sourceCard.name, simpleLifeEffect) : massBounceResolvedSession;
      // "Repeat the following process X times. Each opponent loses N life unless that player
      // sacrifices a nonland permanent or discards a card." (Torment of Hailfire, ...) — same
      // "applies regardless of the spell's own destination" reasoning as removal/zone/pump/life
      // above (it's a sorcery, resolving to the graveyard). See parsePunisherChoiceEffect/
      // applyPunisherChoiceEffect's own comments for why every affected opponent's choice here is
      // heuristic-decided rather than a real prompt. Reported live as this card doing nothing
      // recognizable — no deterministic path existed for it at all before this.
      const punisherEffect = sourceCard && !isModalCard ? parsePunisherChoiceEffect(etbEffectText(sourceCard.oracleText)) : undefined;
      const punisherResolvedSession =
        punisherEffect && sourceCard
          ? applyPunisherChoiceEffect(simpleLifeResolvedSession, action.actorSeatId, sourceCard.name, punisherEffect, Math.max(0, action.chosenX ?? 0))
          : simpleLifeResolvedSession;
      // "Draw two cards." (Village Rites, and the same shape on plenty of other instants/sorceries)
      // — same "independent clause, own pass" reasoning as simpleLifeEffect above, but scoped to
      // NON-battlefield destinations only: a permanent's own ETB "draw a card" trigger is already
      // fully owned by commonTriggerEffect's draw_cards case further down (queued through
      // findCommonTriggersForPermanentEntered), so matching it here too would double the draw. This
      // used to have no deterministic path at all for a plain instant/sorcery draw, resolving
      // entirely through the Ollama-backed rules advisor instead — reported live as Village Rites
      // drawing 4 cards instead of 2 (a non-deterministic LLM response, not a fixed doubling).
      const simpleDrawEffect =
        sourceCard && !isModalCard && destination !== "battlefield" ? parseSimpleDrawEffect(etbEffectText(sourceCard.oracleText)) : undefined;
      const simpleDrawResolvedSession =
        simpleDrawEffect && sourceCard
          ? drawMultipleForSeat(
              punisherResolvedSession,
              action.actorSeatId,
              simpleDrawEffect.amount,
              `${punisherResolvedSession.seats.find((seat) => seat.id === action.actorSeatId)?.name ?? "Player"} draws ${simpleDrawEffect.amount} card${simpleDrawEffect.amount === 1 ? "" : "s"} from ${sourceCard.name}.`
            )
          : punisherResolvedSession;
      // The one-off instant/sorcery shapes in spellExtras.ts (Sign in Blood, Hit the Mother Lode,
      // Necrotic Hex, Monstrous Onslaught, Ezuri's Predation, Mutilate, Overwhelming Stampede,
      // Rishkar's Expertise, Chaos Warp, Chandra's Ignition, Bite Down, Mana Geyser, ...) — each used
      // to resolve as "mana spent, nothing happens" or fall to the LLM planner. Spells only: a
      // permanent's own ETB text is owned by commonTriggerEffect.
      const spellExtraEffects =
        sourceCard && !isModalCard && destination !== "battlefield" ? parseSpellExtraEffects(etbEffectText(sourceCard.oracleText)) : [];
      const spellExtrasResolvedSession = sourceCard
        ? spellExtraEffects.reduce((acc, effect) => {
            const chosen = castStruct?.kind === "extra" && castStruct.effect.kind === effect.kind ? action.castChoices?.targets : undefined;
            if (chosen && !chosen.every((target) => castTargetLegal(acc, action.actorSeatId, sourceCard, target))) {
              return rulesEvent(acc, action.actorSeatId, `${sourceCard.name}'s target is no longer legal; it does nothing.`);
            }
            // Rishkar's Expertise: the draw happens now; the free cast is a choice, queued (pendingFreeCastChoices) for the caster to answer.
            if (effect.kind === "draw_greatest_power_then_free_cast" && effect.freeCastMaxManaValue >= 0) {
              const drawn = applySpellExtraEffect(acc, action.actorSeatId, sourceCard, { ...effect, freeCastMaxManaValue: -1 }, action.chosenX, chosen);
              return { ...drawn, pendingFreeCastChoices: [...(drawn.pendingFreeCastChoices ?? []), { seatId: action.actorSeatId, sourceName: sourceCard.name, maxManaValue: effect.freeCastMaxManaValue }] };
            }
            return applySpellExtraEffect(acc, action.actorSeatId, sourceCard, effect, action.chosenX, chosen);
          }, simpleDrawResolvedSession)
        : simpleDrawResolvedSession;
      const manaExtra = spellExtraEffects.find((effect) => effect.kind === "add_mana_per_tapped_opponent_land");
      if (manaExtra && manaExtra.kind === "add_mana_per_tapped_opponent_land") {
        const amount = manaFromTappedOpponentLands(simpleDrawResolvedSession, action.actorSeatId);
        if (amount > 0) capturedSpellMana = { color: manaExtra.color, amount };
      }
      // Dark Ritual's fixed mana, and Culling Ritual's one mana per permanent it destroys (the first of its two colors; the pool has no color prompt).
      for (const fixed of spellExtraEffects) {
        if (fixed.kind === "add_fixed_mana") capturedSpellMana = { color: fixed.color, amount: fixed.amount };
        if (fixed.kind === "destroy_each_nonland_at_most") {
          const destroyed = simpleDrawResolvedSession.seats.reduce((total, other) => total + other.board.battlefield.filter((card) => !isLandCard(card) && card.manaValue <= fixed.maxManaValue && !hasIndestructible(card) && !card.phasedOut).length, 0);
          if (destroyed > 0) capturedSpellMana = { color: fixed.manaColors[0], amount: destroyed, note: `one for each permanent destroyed (${fixed.manaColors.join(" or ")}; added as ${fixed.manaColors[0]})` };
        }
      }
      const restrictedManaExtra = spellExtraEffects.find((effect) => effect.kind === "add_restricted_mana");
      if (restrictedManaExtra && restrictedManaExtra.kind === "add_restricted_mana" && sourceCard) {
        capturedRestrictedMana = { amount: restrictedManaExtra.amount, spellType: restrictedManaExtra.spellType, sourceName: sourceCard.name };
      }
      // Rule 500.7: "Take an extra turn after this one." (Temporal Mastery, Time Warp, ...) —
      // applies regardless of the spell's own destination, same "still happens even though the
      // instant/sorcery itself resolves to the graveyard" reasoning as removal/zone/pump above.
      // Only queued here (see nextSeatForTurn) — the actual turn hand-off happens later, whenever
      // the current turn's own cleanup step or an End Turn shortcut next needs to pick who's next.
      const extraTurnGrantedSession =
        sourceCard && grantsExtraTurn(sourceCard.oracleText)
          ? { ...spellExtrasResolvedSession, extraTurnsQueue: [...(spellExtrasResolvedSession.extraTurnsQueue ?? []), action.actorSeatId] }
          : spellExtrasResolvedSession;
      const genericModalEffect = sourceCard && isModalCard && !removalEffect ? parseGenericModalEffect(sourceCard.oracleText, action.chosenX) : undefined;
      const preTriggerSession =
        genericModalEffect && sourceCard
          ? castStruct?.kind === "generic_modal" && action.castChoices
            ? applyCastGenericModes(extraTurnGrantedSession, action.actorSeatId, sourceCard, genericModalEffect, action.castChoices)
            : applyGenericModalEffect(extraTurnGrantedSession, action.actorSeatId, sourceCard, genericModalEffect)
          : extraTurnGrantedSession;
      // "As this enters, choose a creature type" (Cavern of Souls, Urza's Incubator, Morophon, ...)
      // — locked in immediately, before SBAs recompute anthems/cost reducers that read it back off
      // chosenCreatureType. Not routed through the trigger-queue/accept-decline UI: it's a
      // mandatory choice with no "when/whenever" wording, not an optional triggered ability.
      const chosenTypeSession =
        sourceCard && destination === "battlefield" && hasChooseCreatureTypeEtb(sourceCard.oracleText)
          ? applyChosenCreatureType(preTriggerSession, action.actorSeatId, sourceCard.id)
          : preTriggerSession;
      // "As this land enters, choose a color other than X" (the Thriving cycle, the Gate cycle,
      // ...) — same immediate, mandatory-choice reasoning as chosenCreatureType above, just for a
      // color instead of a creature type.
      const chooseColorEtb = sourceCard ? parseChooseColorEtb(sourceCard.oracleText) : undefined;
      const chosenColorSession =
        sourceCard && destination === "battlefield" && chooseColorEtb
          ? applyChosenColor(chosenTypeSession, action.actorSeatId, sourceCard.id, chooseColorEtb.excludedColor)
          : chosenTypeSession;
      // The auto-pick above already locked in a real (deterministic) choice — that's necessary for
      // agents, which have no UI to prompt, and is applied uniformly so the rest of this resolution
      // (SBA recompute, etc.) always has a real value to work with. For a HUMAN caster specifically,
      // immediately follow up with a real choice modal pre-loaded with that auto-pick as the
      // default, so they get an actual say instead of the engine silently deciding for them —
      // overriding it just updates the already-resolved permanent's field directly, no re-resolution
      // needed. Captured rather than fired here — see capturedHumanPrompt's own comment above.
      if (sourceCard && destination === "battlefield" && action.actorSeatId === humanSeat.id) {
        if (hasChooseCreatureTypeEtb(sourceCard.oracleText)) {
          capturedHumanPrompt = { kind: "choose_creature_type", cardId: sourceCard.id, cardName: sourceCard.name };
        } else if (chooseColorEtb) {
          capturedHumanPrompt = { kind: "choose_color", cardId: sourceCard.id, cardName: sourceCard.name, excludedColor: chooseColorEtb.excludedColor };
        }
      }
      // Unlike the creature-type/color choices above (auto-picked immediately into the session so
      // agents always have a real value, with a follow-up modal only for humans), a library search
      // has no "immediate deterministic value" to fall back on — it's pendingRuleChoice-or-nothing
      // for every seat kind alike, same as the activated-ability version of this same shape
      // (activateGenericManaAbility et al.). The existing generic agent-rule-choice effect already
      // auto-resolves any pendingRuleChoice for a non-human controller a moment later, so this needs
      // no separate agent branch.
      if (sourceCard && searchLibraryEffect) {
        capturedHumanPrompt = {
          kind: "choose_card_from_library",
          cardId: sourceCard.id,
          cardName: sourceCard.name,
          destination: searchLibraryEffect.destination,
          tapped: searchLibraryEffect.tapped,
          maxChoices: searchLibraryEffect.count,
          allowedCardFilter: searchLibraryEffect.cardTypeFilter
        };
      }
      // Rule 714.2a: "As this Saga enters ... add a lore counter" — the spell-cast half of the same
      // hook playCard's land branch applies for Urza's Saga specifically (the one real Saga that's
      // also a land); every other real Saga is cast as a plain enchantment spell, so this is the
      // path that actually gives it its own chapter 1.
      const sagaCounterSession =
        sourceCard && destination === "battlefield" && isSagaCard(sourceCard)
          ? applySagaEntryLoreCounter(chosenColorSession, action.actorSeatId, sourceCard.id)
          : chosenColorSession;
      // Run state-based actions now, before checking ETB-trigger applicability, so grantedTypes
      // (Secret Arcade-style type grants) and the other SBA-computed fields are fresh — otherwise
      // a permanent that only becomes (e.g.) an enchantment via a separate static ability wouldn't
      // be recognized as one yet by "an enchantment enters" watchers, including its own, on the
      // very turn it enters. Safe to call early: checkStateBasedActions is pure and idempotent,
      // and the setSession wrapper still re-runs it on whatever this returns.
      const resolvedSession = destination === "battlefield" ? checkStateBasedActions(sagaCounterSession) : sagaCounterSession;
      const queuedTriggers =
        sourceCard && destination === "battlefield"
          ? [
              ...findCommonTriggersForPermanentEntered(resolvedSession, action.actorSeatId, sourceCard),
              ...findEntersBatchWatcherTriggers(resolvedSession, [{ seatId: action.actorSeatId, card: findPermanentById(resolvedSession, sourceCard.id) ?? sourceCard }])
            ]
          : [];
      if (sourceCard) {
        // If the deterministic common-trigger system already owns this card's own ETB clause
        // (draw/gain life/lose life/tokens/counters, queued above), don't also ask the rules
        // advisor about it — that would either double the effect (a second draw_cards workflow)
        // or, for effect kinds the advisor's workflow enum can't express, fall through to the
        // Ollama fallback and risk it hallucinating an unrelated workflow for a card that's
        // already fully handled (the same class of bug fixed for check lands). A "choose a
        // creature type" permanent is also fully owned deterministically now (choice + whatever
        // "of the chosen type" static clause references it), even though it has no
        // commonTriggerEffect match of its own. removalEffect/zoneEffect/massPumpEffect/
        // simpleLifeEffect are each fully owned the moment they're recognized, regardless of
        // destination or isModalCard (see their own "applies regardless of the spell's own
        // destination" comments above) — reported live as Beast Within destroying three
        // permanents instead of one: the deterministic path (removalEffect) already destroyed
        // one, but with removalEffect gated behind isModalCard here, the non-modal case fell
        // through to consultRulesAdvisor/consultPrimitiveActionPlanner as a "nothing handled
        // this" fallback, which re-resolved the same destroy effect on its own, picking a
        // different target each time as the board changed. genericModalEffect only exists at
        // all when isModalCard is true (see its own parse guard above), so it doesn't need a
        // separate isModalCard check. A recognized pump/debuff spell is the same story (also
        // usually an instant/sorcery).
        const ownEtbAlreadyHandled =
          (destination === "battlefield" &&
            (commonTriggerEffect(sourceCard.oracleText, "entered", undefined, resolvedSession.seats.find((seat) => seat.id === action.actorSeatId)) !== undefined ||
              hasChooseCreatureTypeEtb(sourceCard.oracleText) ||
              chooseColorEtb !== undefined ||
              eachPlayerSacrificeEffect !== undefined)) ||
          // searchLibraryEffect is no longer battlefield-only (see its own computation above), so
          // it has to sit outside the destination-gated group here too — a graveyard-destination
          // tutor sorcery already has this deterministically handled the moment it's recognized,
          // same as removalEffect/zoneEffect below.
          searchLibraryEffect !== undefined ||
          removalEffect !== undefined ||
          genericModalEffect !== undefined ||
          zoneEffect !== undefined ||
          pumpEffect !== undefined ||
          massPumpEffect !== undefined ||
          simpleLifeEffect !== undefined ||
          punisherEffect !== undefined ||
          simpleDrawEffect !== undefined ||
          spellExtraEffects.length > 0 ||
          isLivingDeath ||
          massBounceEffect ||
          grantsExtraTurn(sourceCard.oracleText);
        // "Scry 2, then draw two cards." (Read the Bones): the draw and life clauses are handled above, but the scry itself is the advisor's workflow.
        const scryThenDraw = /^\s*scry \w+,? then draw\b/i.test(etbEffectText(sourceCard.oracleText));
        if (!ownEtbAlreadyHandled || scryThenDraw) {
          capturedAdvisorCall = {
            event: destination === "battlefield" ? "spell_resolved_to_battlefield" : "spell_resolved_to_graveyard",
            seatId: action.actorSeatId,
            sourceCard,
            // Targets named as an advisor-planned spell was cast (see agentPlannedCastChoices).
            castTargets: castStruct === undefined ? action.castChoices?.targets : undefined
          };
        }
        if (destination === "battlefield") {
          capturedStaticInterpreterCall = { seatId: action.actorSeatId, card: sourceCard };
        }
      }
      capturedTriggers = [...queuedTriggers, ...(tokenCreation?.triggers ?? [])];
      if (simpleDrawEffect) checkMiracleAfterDraw(current, resolvedSession);
      return resolvedSession;
    });
    // Every capturedX variable above is only ever assigned inside the setSession updater just
    // above, then read here, synchronously, on the very next line. That relies on the updater
    // having actually run by the time this line executes — true when setSession is the only state
    // update in flight, but resolvePendingAction always calls setPendingAction/setPriorityPasses
    // first, and this whole function itself is invoked from a bare window.setTimeout (see
    // beginPendingAction's "no responses required" auto-resolve, and every other call site),
    // outside any React event handler. React 18's automatic batching defers the updater itself
    // in exactly that shape — confirmed live with a call-id-tagged trace: this function's own
    // post-setSession line ran and read every capturedX variable at its stale initial value
    // BEFORE the updater (tagged with the same call id) ever executed, for every single spell
    // whose resolution didn't already have some other pending interactive choice open. Kodama's
    // Reach/Cultivate's consultRulesAdvisor call (capturedAdvisorCall) and Three Visits/Nature's
    // Lore's search-library prompt (capturedHumanPrompt) both went through this exact path and
    // both silently no-opped — reported live as "resolves, mana spent, nothing happens." Deferring
    // this whole block by one more macrotask lets the already-scheduled updater run first.
    window.setTimeout(() => {
      if (capturedSpellMana) {
        setSeatManaPool(action.actorSeatId, addManaToPool(poolForSeat(action.actorSeatId), capturedSpellMana.color, capturedSpellMana.amount));
        addEvent(`${action.cardName} adds ${capturedSpellMana.amount} {${capturedSpellMana.color}} (${capturedSpellMana.note ?? `${capturedSpellMana.amount} tapped land${capturedSpellMana.amount === 1 ? "" : "s"} among your opponents'`}).`, action.actorSeatId, "Rules action");
      }
      if (capturedRestrictedMana) {
        const restricted = capturedRestrictedMana;
        const caster = session.seats.find((item) => item.id === action.actorSeatId);
        if (caster?.kind === "human") {
          setPendingRuleChoice({
            id: crypto.randomUUID(),
            kind: "distribute_attack_trigger_mana",
            controllerSeatId: action.actorSeatId,
            sourceCardId: action.cardId,
            sourceCardName: restricted.sourceName,
            prompt: `${restricted.sourceName}: choose any combination of colors for ${restricted.amount} mana. Spend it only to cast ${restricted.spellType} spells.`,
            amount: restricted.amount,
            spellType: restricted.spellType
          });
        } else if (caster) {
          addRestrictedManaBatch(action.actorSeatId, restricted.sourceName, attackTriggerManaHeuristicSplit(caster, restricted.amount), restricted.spellType);
        }
      }
      if (capturedTriggers.length > 0) {
        queueCommonTriggers(capturedTriggers);
      } else if (!resumeTopStackAction(remainingStack)) {
        setPrioritySeatId(action.actorSeatId);
      }
      if (capturedDigLook) {
        startLibraryLook("choose_one_bottom", capturedDigLook.amount, capturedDigLook.filter, undefined, "graveyard");
      }
      if (capturedHumanPrompt) {
        const prompt = capturedHumanPrompt;
        if (prompt.kind === "choose_creature_type") {
          setPendingRuleChoice({
            id: crypto.randomUUID(),
            kind: "choose_creature_type",
            controllerSeatId: action.actorSeatId,
            sourceCardId: prompt.cardId,
            sourceCardName: prompt.cardName,
            prompt: `Choose a creature type for ${prompt.cardName}.`
          });
        } else if (prompt.kind === "choose_color") {
          setPendingRuleChoice({
            id: crypto.randomUUID(),
            kind: "choose_color",
            controllerSeatId: action.actorSeatId,
            sourceCardId: prompt.cardId,
            sourceCardName: prompt.cardName,
            prompt: `Choose a color for ${prompt.cardName}${prompt.excludedColor ? ` (other than ${prompt.excludedColor})` : ""}.`,
            excludedColor: prompt.excludedColor
          });
        } else {
          setPendingRuleChoice({
            id: crypto.randomUUID(),
            kind: "choose_card_from_library",
            controllerSeatId: action.actorSeatId,
            sourceCardId: prompt.cardId,
            sourceCardName: prompt.cardName,
            prompt: `${prompt.cardName}: search your library.`,
            destination: prompt.destination,
            tapped: prompt.tapped,
            maxChoices: prompt.maxChoices,
            allowedCardFilter: prompt.allowedCardFilter
          });
        }
      }
      if (capturedAdvisorCall) {
        const advisorCall = capturedAdvisorCall;
        void consultRulesAdvisor(advisorCall.event, advisorCall.seatId, advisorCall.sourceCard, advisorCall.castTargets);
      }
      if (capturedStaticInterpreterCall) {
        const staticCall = capturedStaticInterpreterCall;
        void consultStaticEffectInterpreter(staticCall.seatId, staticCall.card);
      }
    }, 0);
  }

  return { beginPendingAction, openResponseWindow, passPriority, removeStackAction, replaceStackActions, resolvePendingAction, resolvePendingActionNow, respondWithCard, respondWithSelectedCard, resumeStackAction, resumeTopStackAction };
}
