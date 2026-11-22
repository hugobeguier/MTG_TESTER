// Choice prompts: the human/agent answers to every pendingRuleChoice kind (targets, modal options, colors, creature types, sacrifices, discards, ordering, miracle offers) and library-look window handlers.
// Part of the AppFlow() split: shared state arrives through `ctx` (see ./context.ts); handlers owned by other hooks are called through `lateFn` so every hook sees the current render's functions.
import { type ChosenTarget, type TargetSpec, legalTargets, targetsStillLegal } from "@/lib/targeting";
import { type ColoredMana, type GameSession, type ManaColor, type PlayerSeat, type VisibleCard } from "@/lib/types";
import { type PendingAction, type PendingRuleChoice, type PendingTargetedEffect, type TurnPhase } from "@/engine/types";
import { TURN_PHASES } from "@/lib/priorityStops";
import { addLibraryLookEvent } from "@/engine/mulligan";
import { applyAuraAttachment } from "@/engine/etb";
import { applyChosenEachPlayerSacrifice, applyDigPick, isBraidsEndStepText } from "@/engine/oneShotEffects";
import { applyCounterDelta, moveCardBetweenVisibleZones, moveCommanderToCommandZone, moveLibraryCard, possessive, putLookedAtCardsInGraveyard, reorderTopLibraryCards, shuffleCards } from "@/engine/zones";
import { applyDeterministicPhaseTrigger, applyDigToBattlefield, applyTargetedEffect, braidsDeclinePenalty, braidsOpponentIds, braidsRunOpponents, braidsSharedTypeFilter, commonTriggerEffect, echoCostText, isMerenEndStepEffect, makeCommonTrigger, phaseClauseConditionMet, phaseConditionBlocks, phaseEffectText } from "@/engine/triggers";
import { applyEnchantmentAnimation, canTapForCost, payGenericSacrificeCost } from "@/engine/abilities";
import { applyRemovalEffect, applyTargetedPumpEffect, applyZoneEffect, drawMultipleForSeat, matchesEachPlayerSacrificeFilter, matchesPermanentSacrificeFilter, matchesSacrificeFilter, noLegalTargetEvent, parseCounterAccumulationTrigger, parseGenericModalEffect, putLookedAtCardsOnBottom } from "@/engine/effects";
import { cannotPayMessage, chooseManaSourcesForCost, emptyManaPool, formatManaPoolPayment, manaPoolTotal, selectedManaTotal } from "@/engine/mana";
import { cardMatchesTypeFilter } from "@/lib/oracleClauses";
import { emblemSourceCards } from "@/engine/shared";
import { grantKeywordsToCreature } from "@/engine/triggerFinders";
import { hasCardType } from "@/lib/typeGrants";
import { humanPhaseGraveyardChoice, isReanimateFromAnyGraveyardPhaseTrigger, makePhaseStackTrigger, phaseEventName, targetCreatureCounterPhaseTrigger } from "@/engine/turnFlow";
import { isCumulativeUpkeepCard } from "@/engine/legalActions";
import { labeledTargetOptions } from "@/engine/castTargets";
import { moveCardAcrossSeats, moveLibraryCardToDestination } from "@/engine/entry";
import { removalEffectTargetSpec, zoneEffectTargetSpec } from "@/lib/targetSpecs";
import { roomDoorFaces } from "@/engine/casting";
import { ruleChoiceLabel } from "@/components/viewModels";
import { targetedEffectSpec } from "@/lib/targetedEffects";
import { type GameContext, lateFn } from "./context";

export function useChoicePrompts(ctx: GameContext) {
  const { session, setSession, setSelectedHandCardId, humanSeat } = ctx;
  const { libraryLook, setLibraryLook, manualLibrarySearch, setManualLibrarySearch, pendingRuleChoice, setPendingRuleChoice, pendingOrderedTriggerResume } = ctx.choices;
  const { setPriorityPasses } = ctx.stack;
  const { pendingEndTurnAfterDiscard } = ctx.turn;
  const activateGenericManaAbility = lateFn(ctx, "activateGenericManaAbility");
  const activateGenericTapAbility = lateFn(ctx, "activateGenericTapAbility");
  const addEvent = lateFn(ctx, "addEvent");
  const chooseRuleLibraryCard = lateFn(ctx, "chooseRuleLibraryCard");
  const addRestrictedManaBatch = lateFn(ctx, "addRestrictedManaBatch");
  const beginPendingAction = lateFn(ctx, "beginPendingAction");
  const clearManaContributions = lateFn(ctx, "clearManaContributions");
  const commitCrime = lateFn(ctx, "commitCrime");
  const completeCastAlt = lateFn(ctx, "completeCastAlt");
  const completeCastCopy = lateFn(ctx, "completeCastCopy");
  const completeCastFace = lateFn(ctx, "completeCastFace");
  const completeCastPrompt = lateFn(ctx, "completeCastPrompt");
  const completeCastX = lateFn(ctx, "completeCastX");
  const completeLabeledTarget = lateFn(ctx, "completeLabeledTarget");
  const completeSpellMode = lateFn(ctx, "completeSpellMode");
  const completeTriggerCard = lateFn(ctx, "completeTriggerCard");
  const completeTriggerOption = lateFn(ctx, "completeTriggerOption");
  const consultRulesAdvisor = lateFn(ctx, "consultRulesAdvisor");
  const finishPaidSacrificeAbility = lateFn(ctx, "finishPaidSacrificeAbility");
  const openCumulativeUpkeepChoice = lateFn(ctx, "openCumulativeUpkeepChoice");
  const openTriggerOptionPrompt = lateFn(ctx, "openTriggerOptionPrompt");
  const playCard = lateFn(ctx, "playCard");
  const poolForSeat = lateFn(ctx, "poolForSeat");
  const queueCommonTriggers = lateFn(ctx, "queueCommonTriggers");
  const resolveEndTurn = lateFn(ctx, "resolveEndTurn");
  const resolvePhaseScryOrSurveil = lateFn(ctx, "resolvePhaseScryOrSurveil");
  const setSeatManaPool = lateFn(ctx, "setSeatManaPool");
  const startLibraryLook = lateFn(ctx, "startLibraryLook");

  function openPunisherPrompt(seatId: string, sourceName: string, lifeAmount: number, remaining: number) {
    if (remaining <= 0) return;
    const victim = session.seats.find((seat) => seat.id === seatId);
    const shim = { id: "punisher-" + sourceName, name: sourceName, typeLine: "", oracleText: "", manaValue: 0, colors: [], role: "effect", zone: "battlefield" } as VisibleCard;
    const canSacrifice = Boolean(victim?.board.battlefield.some((card) => !card.typeLine.includes("Land")));
    const canDiscard = Boolean(victim && victim.board.hand.length > 0);
    const options = [{ index: 0, label: "Lose " + lifeAmount + " life" }, ...(canSacrifice ? [{ index: 1, label: "Sacrifice a nonland permanent" }] : []), ...(canDiscard ? [{ index: 2, label: "Discard a card" }] : [])];
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "choose_trigger_option",
      controllerSeatId: seatId,
      sourceCardId: shim.id,
      sourceCardName: sourceName,
      prompt: sourceName + ": lose " + lifeAmount + " life unless you sacrifice a nonland permanent or discard a card (" + remaining + " to go).",
      options,
      trigger: makeCommonTrigger(seatId, seatId, shim, { kind: "punisher_prompt", lifeAmount, remaining }, sourceName + " punisher."),
      remainingStack: []
    });
  }

  // Finalizes an in-progress multi-pick library search early — legal for "up to N" (never for a
  // flat required N, since finishRuleLibrarySearch is only ever offered once at least one pick has
  // been made, and a flat N still needs all N chosen before chooseRuleLibraryCard itself finalizes).
  function finishRuleLibrarySearch() {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_card_from_library" || !choice.chosenCardIds?.length) return;
    completeRuleChoice(choice, choice.chosenCardIds);
  }

  // The shared human-choice gate for any single-target effect with a real TargetSpec (see
  // src/lib/targetSpecs.ts) — call this BEFORE applying a removal/zone effect that a human
  // controls. Opens choose_effect_target and returns true when it did (the caller must not also
  // apply the effect — it'll happen later, from chooseEffectTarget/declineEffectTarget); returns
  // false when there is nothing to ask (no spec for this effect, the controller is not human, or no
  // legal targets exist — a foregone auto-pick isn't a real decision, matching this engine's
  // existing "only intercept the choice-worthy shapes" pattern everywhere else). Reads `session`
  // from the enclosing component scope, same as every other resolver here.
  // The prompts a HUMAN phase-trigger controller gets, shared by the single-trigger dispatch and the ordered multi-trigger loop (the loop used to
  // lack the modal, echo, graveyard-return and aimed-target prompts, so a second trigger in the same step was auto-resolved). Returns true when
  // it opened a prompt (or consumed the trigger), false to fall through to the deterministic resolution.
  function openHumanPhaseChoice(activeSeat: PlayerSeat, sourceCard: VisibleCard, phase: TurnPhase): boolean {
    if (activeSeat.kind !== "human") return false;
      // "At the beginning of ..., choose one / one or more —": a human picks the modes (Black Market Connections, Abiding Grace).
      if (activeSeat.kind === "human") {
        const phaseModalText = phaseEffectText(sourceCard.oracleText, phase);
        const phaseModal = /\bchoose\b/i.test(phaseModalText) ? parseGenericModalEffect(phaseModalText, undefined) : undefined;
        if (phaseModal && !parseCounterAccumulationTrigger(phaseModalText, sourceCard.name)) {
          const modalTrigger = makeCommonTrigger(activeSeat.id, activeSeat.id, sourceCard, { kind: "modal", modal: phaseModal }, `${sourceCard.name} triggers.`);
          if (openTriggerOptionPrompt(modalTrigger, [], undefined)) return true;
        }
      }
      // Echo: a human decides whether to pay it.
      if (activeSeat.kind === "human") {
        const echoMatch = phaseEffectText(sourceCard.oracleText, phase).match(/^echo ((?:\{[^}]+\})+|\d+)/i);
        if (echoMatch && !sourceCard.echoResolved) {
          const costText = echoCostText(echoMatch[1]);
          setPendingRuleChoice({
            id: crypto.randomUUID(),
            kind: "choose_trigger_option",
            controllerSeatId: activeSeat.id,
            sourceCardId: sourceCard.id,
            sourceCardName: sourceCard.name,
            prompt: `${sourceCard.name}: pay echo ${costText}, or sacrifice it?`,
            options: [{ index: 0, label: `Pay ${costText}` }, { index: 1, label: "Sacrifice it" }],
            trigger: makeCommonTrigger(activeSeat.id, activeSeat.id, sourceCard, { kind: "echo_choice", costText }, sourceCard.name + " echo."),
            remainingStack: []
          });
          return true;
        }
      }
      // A human whose upkeep/end-step trigger returns a card from their own graveyard picks the card (and gets the "you may").
      if (activeSeat.kind === "human") {
        const graveyardChoice = humanPhaseGraveyardChoice(session, activeSeat.id, sourceCard, phase);
        if (graveyardChoice === "skip") return true;
        if (graveyardChoice) {
          if (graveyardChoice.effect.kind === "regrow") {
            if (maybeRequestTarget(activeSeat.id, sourceCard, zoneEffectTargetSpec(graveyardChoice.effect), graveyardChoice.optional, { kind: "zone", effect: graveyardChoice.effect })) return true;
          } else if ((activeSeat.board.graveyard ?? []).some((card) => card.typeLine.includes("Creature"))) {
            setPendingRuleChoice({
              id: crypto.randomUUID(),
              kind: "choose_creature_from_graveyards",
              controllerSeatId: activeSeat.id,
              sourceCardId: sourceCard.id,
              sourceCardName: sourceCard.name,
              prompt: `${sourceCard.name}: choose a creature card in your graveyard to return to the battlefield.`,
              restrictToYourGraveyard: true
            });
            return true;
          }
        }
      }
      // "At the beginning of your upkeep, <one verb> target ..." (Extravagant Replication): a human aims it.
      if (activeSeat.kind === "human") {
        const phaseClause = phaseEffectText(sourceCard.oracleText, phase);
        const aimed = phaseClause ? commonTriggerEffect(phaseClause, "clause", undefined, activeSeat) : undefined;
        if (aimed?.kind === "targeted_effect" && maybeRequestTarget(activeSeat.id, sourceCard, targetedEffectSpec(aimed.effect, sourceCard.id, sourceCard.name), Boolean(aimed.optional), { kind: "targeted", effect: aimed.effect })) return true;
      }
    // Any other single-effect trigger whose controller makes a choice (Surrak, the Hunt Caller's haste target, ...): reuse the trigger prompts.
    const phaseClauseText = phaseEffectText(sourceCard.oracleText, phase);
    const genericEffect = phaseClauseText && phaseClauseConditionMet(session, activeSeat.id, phaseClauseText) ? commonTriggerEffect(phaseClauseText, "clause", undefined, activeSeat) : undefined;
    if (genericEffect && genericEffect.kind !== "targeted_effect" && genericEffect.kind !== "add_counter" && genericEffect.kind !== "modal") {
      const genericTrigger = makeCommonTrigger(activeSeat.id, activeSeat.id, sourceCard, genericEffect, `${sourceCard.name} triggers.`);
      if (openTriggerOptionPrompt(genericTrigger, [], undefined)) return true;
    }
    // "At the beginning of your upkeep, you may <do something deterministic>" (Cemetery Tampering, Land Tax): a human gets the yes/no instead of an automatic yes.
    if (phaseClauseText && /^[^.]*\byou may\b/i.test(phaseClauseText.replace(/\([^)]*\)/g, "")) && phaseClauseConditionMet(session, activeSeat.id, phaseClauseText) && applyDeterministicPhaseTrigger(session, activeSeat.id, sourceCard, phase) !== undefined) {
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_trigger_option",
        controllerSeatId: activeSeat.id,
        sourceCardId: sourceCard.id,
        sourceCardName: sourceCard.name,
        prompt: `${sourceCard.name}: ${phaseClauseText.replace(/\([^)]*\)/g, "").trim()} Do it?`,
        options: [{ index: 0, label: "Yes" }, { index: 1, label: "No" }],
        trigger: makeCommonTrigger(activeSeat.id, activeSeat.id, sourceCard, { kind: "phase_optional", phase }, `${sourceCard.name} triggers.`),
        remainingStack: []
      });
      return true;
    }
    return false;
  }

  function maybeRequestTarget(controllerSeatId: string, sourceCard: VisibleCard, spec: TargetSpec | undefined, optional: boolean, pending: PendingTargetedEffect): boolean {
    if (!spec) return false;
    const controllerSeat = session.seats.find((seat) => seat.id === controllerSeatId);
    if (controllerSeat?.kind !== "human") return false;
    const pool = legalTargets(session, controllerSeatId, spec, sourceCard);
    // Humans always choose their targets (even a single legal one: the player confirms it); with none there is nothing to ask.
    if (pool.length === 0) return false;
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "choose_effect_target",
      controllerSeatId,
      sourceCardId: sourceCard.id,
      sourceCardName: sourceCard.name,
      sourceCard,
      prompt: spec.prompt,
      spec,
      optional,
      pending
    });
    return true;
  }

  // Human resolution for choose_effect_target — the human already picked a target; re-enters
  // whichever pure applier the pending continuation names, with the pick threaded through in place
  // of that applier's own heuristic. Re-checks legality first (rule 608.2b): the target may have
  // become illegal (removed, gained hexproof, phased out, ...) between the choice opening and the
  // player clicking, in which case the effect fizzles instead of resolving against something stale.
  function chooseEffectTarget(target: ChosenTarget) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_effect_target") return;
    setPendingRuleChoice(undefined);
    if (target.seatId !== choice.controllerSeatId) commitCrime(choice.controllerSeatId);
    if (choice.pending.kind === "library_look") {
      if (target.kind === "player" && targetsStillLegal(session, choice.controllerSeatId, choice.spec, choice.sourceCard, [target])) {
        startLibraryLook("reorder", choice.pending.count, undefined, undefined, undefined, target.seatId, choice.pending.offerShuffle ? choice.sourceCardName : undefined, choice.controllerSeatId);
      }
      return;
    }
    // The rest of an ability whose first sentence was the aimed destroy/exile ("... Draw a card.") goes on the stack once the target is in.
    const rider = choice.pending.kind === "removal" && targetsStillLegal(session, choice.controllerSeatId, choice.spec, choice.sourceCard, [target]) ? choice.pending.rider : undefined;
    if (rider) window.setTimeout(() => queueCommonTriggers([makeCommonTrigger(choice.controllerSeatId, choice.controllerSeatId, choice.sourceCard, rider, `${choice.sourceCardName}'s ability continues.`)]), 0);
    setSession((current) => {
      if (!targetsStillLegal(current, choice.controllerSeatId, choice.spec, choice.sourceCard, [target])) {
        return noLegalTargetEvent(current, choice.controllerSeatId, choice.sourceCardName);
      }
      if (choice.pending.kind === "removal") {
        return applyRemovalEffect(current, choice.controllerSeatId, choice.sourceCardName, choice.sourceCard, choice.pending.effect, choice.pending.chosenX, target);
      }
      if (choice.pending.kind === "pump") return applyTargetedPumpEffect(current, choice.controllerSeatId, choice.sourceCard, choice.pending.effect, target);
      if (choice.pending.kind === "animate_enchantment") {
        const picked = target.kind === "card" ? current.seats.find((other) => other.id === target.seatId)?.board.battlefield.find((card) => card.id === target.cardId) : undefined;
        return picked && target.kind === "card" ? applyEnchantmentAnimation(current, choice.controllerSeatId, choice.sourceCardName, { seatId: target.seatId, card: picked }) : current;
      }
      if (choice.pending.kind === "targeted") return applyTargetedEffect(current, choice.controllerSeatId, choice.sourceCard, choice.pending.effect, target);
      if (choice.pending.kind === "library_look") return current;
      return applyZoneEffect(current, choice.controllerSeatId, choice.sourceCardName, choice.pending.effect, choice.pending.chosenX, target);
    });
  }

  // Human resolution for choose_effect_target's Decline button — only ever shown for an optional
  // ("you may") effect (see the choice's own optional field); the effect simply doesn't happen,
  // same as declining optional_trigger.
  function declineEffectTarget() {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_effect_target" || !choice.optional) return;
    setPendingRuleChoice(undefined);
  }

  // Human resolution for choose_creature_from_graveyards — mirrors applyZoneEffect's own "reanimate"
  // case (used for the agent/deterministic path via chooseReanimationTarget), just with the target
  // already picked by the player instead of the heuristic. sourceSeatId is whichever player's
  // graveyard the card is actually sitting in (Virtue of Persistence's pool spans every graveyard,
  // not just the controller's own), separate from the choice's own controllerSeatId.
  function chooseGraveyardReanimationTarget(sourceSeatId: string, cardId: string) {
    if (pendingRuleChoice?.kind === "choose_trigger_card") {
      completeTriggerCard(cardId);
      return;
    }
    if (pendingRuleChoice?.kind === "choose_ability_card_target") {
      const ability = pendingRuleChoice;
      setPendingRuleChoice(undefined);
      if (ability.activation.via === "tap") activateGenericTapAbility(ability.controllerSeatId, ability.activation.cardId, ability.activation.abilityIndex, undefined, cardId);
      else activateGenericManaAbility(ability.controllerSeatId, ability.activation.cardId, ability.activation.abilityIndex, cardId);
      return;
    }
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_creature_from_graveyards") return;
    setPendingRuleChoice(undefined);
    setSession((current) => {
      const sourceSeat = current.seats.find((seat) => seat.id === sourceSeatId);
      const card = sourceSeat?.board.graveyard?.find((item) => item.id === cardId);
      if (!sourceSeat || !card) return current;
      // Meren of Clan Nel Toth's own conditional: mana value within the experience-counter budget
      // returns it to the battlefield as normal; too expensive puts it in hand instead (still the
      // controller's choice of WHICH card, just not where it ends up) — see applyMerenEndStepEffect's
      // matching deterministic-agent branch for the same rule. Every other consumer of this choice
      // (Reanimate, Virtue of Persistence) leaves manaValueCeiling undefined and always goes to the
      // battlefield, same as before.
      const manaValueCeiling = choice.manaValueCeiling;
      const toHand = manaValueCeiling !== undefined && card.manaValue > manaValueCeiling;
      if (toHand) {
        const movedSession = moveCardBetweenVisibleZones(current, sourceSeatId, cardId, "hand");
        return {
          ...movedSession,
          events: [
            {
              id: crypto.randomUUID(),
              at: new Date().toISOString(),
              seatId: choice.controllerSeatId,
              message: `${choice.sourceCardName} puts ${card.name} from ${possessive(sourceSeat)} graveyard into ${sourceSeat.name === "You" ? "your" : "their"} hand (mana value too high to return to the battlefield with ${manaValueCeiling} experience counter${manaValueCeiling === 1 ? "" : "s"}).`,
              detail: "Rules action"
            },
            ...movedSession.events
          ]
        };
      }
      const { session: reanimatedSession } = moveCardAcrossSeats(current, sourceSeatId, cardId, choice.controllerSeatId, "battlefield");
      const lifeLost = choice.loseLifeEqualToManaValue ? card.manaValue : 0;
      return {
        ...reanimatedSession,
        seats: lifeLost > 0 ? reanimatedSession.seats.map((item) => (item.id === choice.controllerSeatId ? { ...item, life: item.life - lifeLost } : item)) : reanimatedSession.seats,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: choice.controllerSeatId,
            message: `${choice.sourceCardName} returns ${card.name} from ${possessive(sourceSeat)} graveyard to the battlefield under its new controller.${lifeLost > 0 ? ` ${current.seats.find((item) => item.id === choice.controllerSeatId)?.name ?? "The controller"} loses ${lifeLost} life.` : ""}`,
            detail: "Rules action"
          },
          ...reanimatedSession.events
        ]
      };
    });
  }

  // Human resolution for choose_creature_to_sacrifice — the human already picked which creature to
  // sacrifice, so this just finishes activateGenericSacrificeAbility's deferred flow: pay the rest
  // of the cost (mana/life/discard) with the chosen creature threaded through instead of
  // chooseSacrificeTargets' heuristic, then apply the effect exactly as the non-interactive path
  // does. Reads `session` directly (not a setSession updater) — same same-tick-decision pattern
  // activateGenericSacrificeAbility's own final branch already uses for this exact family of calls.
  function chooseSacrificeCostTarget(seatId: string, cardId: string) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_creature_to_sacrifice") return;
    const seat = session.seats.find((item) => item.id === seatId);
    const chosenCard = seat?.board.battlefield.find((item) => item.id === cardId);
    if (!seat || !chosenCard) return;
    // Several creatures to choose (Westvale Abbey's five, Cryptbreaker's three Zombies): collect picks one at a time.
    const isEligible = (card: VisibleCard) =>
      choice.eligibleIds
        ? choice.eligibleIds.includes(card.id) && !card.tapped
        : choice.tapSubtype
        ? canTapForCost(card, choice.tapSubtype)
        : choice.anyPermanent
          ? card.id !== choice.excludeCardId && matchesPermanentSacrificeFilter(card, choice.typeFilter)
          : hasCardType(card, "Creature") && card.id !== choice.excludeCardId && matchesSacrificeFilter(card, choice.typeFilter?.toLowerCase());
    // A friend's pick arrives over the wire: it must be one the prompt offers (eligible, not already picked), not just any permanent they control.
    if (!isEligible(chosenCard) || (choice.pickedIds ?? []).includes(cardId)) return;
    const pickedIds = [...(choice.pickedIds ?? []), cardId];
    const needed = choice.count - pickedIds.length;
    if (needed > 0) {
      const left = seat.board.battlefield.filter((card) => isEligible(card) && !pickedIds.includes(card.id));
      if (left.length > needed) {
        setPendingRuleChoice({ ...choice, id: crypto.randomUUID(), pickedIds, prompt: choice.prompt.replace(/ \(\d+ chosen\)$/, "") + " (" + pickedIds.length + " chosen)" });
        return;
      }
      pickedIds.push(...left.slice(0, needed).map((card) => card.id));
    }
    setPendingRuleChoice(undefined);
    if (choice.castResume) {
      const resume = choice.castResume;
      setSession((current) => ({
        ...current,
        seats: current.seats.map((item) => (item.id === resume.seatId ? { ...item, board: { ...item.board, hand: item.board.hand.map((card) => (card.id === resume.cardId ? { ...card, chosenTapAltIds: pickedIds } : card)) } } : item))
      }));
      window.setTimeout(() => playCard(resume.seatId, resume.cardId, resume.position, resume.sourceZone, resume.faceIndex, undefined, undefined, "alt"), 50);
      return;
    }
    if (choice.tapSubtype) {
      activateGenericTapAbility(choice.controllerSeatId, choice.sourceCardId, choice.abilityIndex, undefined, undefined, pickedIds);
      return;
    }
    const humanPool = seat.kind === "human" ? poolForSeat(seatId) : undefined;
    const chosenCards = pickedIds.map((id) => seat.board.battlefield.find((card) => card.id === id)).filter((card): card is VisibleCard => Boolean(card));
    const paid = payGenericSacrificeCost(session, choice.controllerSeatId, choice.sourceCardId, choice.abilityIndex, humanPool, chosenCards);
    if (!paid) return;
    if (paid.poolSpent) {
      setSeatManaPool(choice.controllerSeatId, paid.poolSpent);
      clearManaContributions(choice.controllerSeatId);
    }
    finishPaidSacrificeAbility(choice.controllerSeatId, paid);
  }

  // Human resolution for choose_each_player_sacrifice — every OTHER seat's sacrifice/discard already
  // resolved when applyEachPlayerSacrificeEffect first ran (see its humanSacrificeNeededSeatId
  // deferral); this only applies the human controller's own pick, via the same destroyCreatures-
  // routed helper (applyChosenEachPlayerSacrifice) so death triggers fire correctly for it too.
  function chooseEachPlayerSacrificeTarget(seatId: string, cardId: string) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_each_player_sacrifice") return;
    const seat = session.seats.find((item) => item.id === seatId);
    const chosenCard = seat?.board.battlefield.find((item) => item.id === cardId);
    if (!seat || !chosenCard) return;
    // A friend's pick arrives over the wire: it must satisfy the sacrifice's own filter (not, say, a Treasure token instead of the creature the effect demands).
    if (!matchesEachPlayerSacrificeFilter(chosenCard, choice.typeFilter) || (choice.excludeTokensFromSourceId && chosenCard.token && chosenCard.tokenSourceCardId === choice.excludeTokensFromSourceId)) return;
    setPendingRuleChoice(undefined);
    // Braids, Arisen Nightmare: after the sacrifice, the opponents' halves follow (the controller's pick sets the shared type).
    if (choice.braids) {
      const braids = choice.braids;
      setSession((current) => {
        const sacrificed = applyChosenEachPlayerSacrifice(current, choice.controllerSeatId, chosenCard.id, choice.sourceCardName);
        return braids.stage === "controller"
          ? braidsRunOpponents(sacrificed, braids.braidsSeatId, choice.sourceCardName, choice.sourceCardId, braidsSharedTypeFilter(chosenCard), braidsOpponentIds(sacrificed, braids.braidsSeatId))
          : braidsRunOpponents(sacrificed, braids.braidsSeatId, choice.sourceCardName, choice.sourceCardId, choice.typeFilter, braids.remainingOpponentIds ?? []);
      });
      return;
    }
    setSession((current) => applyChosenEachPlayerSacrifice(current, choice.controllerSeatId, chosenCard.id, choice.sourceCardName));
    // More to choose (Necrotic Hex's six): reopen with the card just picked gone.
    const left = (choice.remaining ?? 1) - 1;
    if (left > 0) {
      const stillThere = seat.board.battlefield.filter(
        (card) => card.id !== chosenCard.id && matchesEachPlayerSacrificeFilter(card, choice.typeFilter) && !(choice.excludeTokensFromSourceId && card.token && card.tokenSourceCardId === choice.excludeTokensFromSourceId)
      );
      if (stillThere.length > left) {
        window.setTimeout(
          () => setPendingRuleChoice({ ...choice, id: crypto.randomUUID(), remaining: left, prompt: choice.sourceCardName + ": choose a creature to sacrifice (" + left + " to go)." }),
          0
        );
      } else {
        // Exactly as many left as must go: no choice remains.
        for (const card of stillThere) setSession((current) => applyChosenEachPlayerSacrifice(current, choice.controllerSeatId, card.id, choice.sourceCardName));
      }
    }
  }

  function chooseModalOption(index: number) {
    if (pendingRuleChoice?.kind === "choose_cast_face") {
      completeCastFace(index);
      return;
    }
    if (pendingRuleChoice?.kind === "choose_cast_alt") {
      completeCastAlt(index);
      return;
    }
    if (pendingRuleChoice?.kind === "choose_cast_copy") {
      completeCastCopy(index);
      return;
    }
    if (pendingRuleChoice?.kind === "choose_cast_x") {
      completeCastX(index);
      return;
    }
    if (pendingRuleChoice?.kind === "choose_cast_targets") {
      completeCastPrompt(index);
      return;
    }
    if (pendingRuleChoice?.kind === "choose_spell_modes") {
      completeSpellMode(index);
      return;
    }
    if (pendingRuleChoice?.kind === "choose_dig_card") {
      const dig = pendingRuleChoice;
      const picked = dig.options.find((option) => option.index === index);
      if (!picked) return;
      setPendingRuleChoice(undefined);
      setSession((current) =>
        dig.toBattlefieldMaxManaValue !== undefined
          ? applyDigToBattlefield(current, dig.controllerSeatId, dig.sourceCardName, dig.count, dig.toBattlefieldMaxManaValue, picked.cardId, dig.throneBonus ? { throne: true } : undefined)
          : applyDigPick(current, dig.controllerSeatId, dig.sourceCardName, dig.count, dig.typeWord, picked.cardId)
      );
      return;
    }
    if (pendingRuleChoice?.kind === "choose_labeled_target") {
      completeLabeledTarget(index);
      return;
    }
    if (pendingRuleChoice?.kind === "choose_trigger_option") {
      completeTriggerOption(index);
      return;
    }
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_modal_option") return;
    const mode = choice.modes[index];
    if (!mode) return;
    if (mode.kind === "proliferate") {
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_proliferate_targets",
        controllerSeatId: choice.controllerSeatId,
        sourceCardId: choice.sourceCardId,
        sourceCardName: choice.sourceCardName,
        prompt: `${choice.sourceCardName}: choose any number of permanents and/or players to proliferate.`
      });
      return;
    }
    if (mode.kind === "damage" && mode.targetType !== "creature") {
      const options = labeledTargetOptions(session, choice.controllerSeatId, mode.targetType === "player" ? "player" : "any_damage", choice.sourceCard);
      if (options.length >= 1) {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_labeled_target",
          controllerSeatId: choice.controllerSeatId,
          sourceCardId: choice.sourceCardId,
          sourceCardName: choice.sourceCardName,
          sourceCard: choice.sourceCard,
          slots: [{ prompt: choice.sourceCardName + ": choose a target for the damage.", options }],
          slotIndex: 0,
          picks: [],
          continuation: { kind: "damage", effect: mode }
        });
        return;
      }
    }
    if (mode.kind === "grant_keywords") {
      const yours = session.seats.find((seat) => seat.id === choice.controllerSeatId)?.board.battlefield.filter((card) => card.typeLine.includes("Creature")) ?? [];
      if (yours.length >= 1) {
        setPendingRuleChoice({ id: crypto.randomUUID(), kind: "choose_creature_for_grant", controllerSeatId: choice.controllerSeatId, sourceCardId: choice.sourceCardId, sourceCardName: choice.sourceCardName, prompt: choice.sourceCardName + ": choose a creature you control to gain " + mode.keywords.join(" and ") + " until end of turn.", keywords: mode.keywords });
        return;
      }
    }
    if (mode.kind === "destroy" || mode.kind === "exile" || mode.kind === "bounce") {
      const spec = removalEffectTargetSpec(mode, choice.sourceCard.id);
      if (maybeRequestTarget(choice.controllerSeatId, choice.sourceCard, spec, false, { kind: "removal", effect: mode })) return;
      // 0 or 1 legal target — no real decision (or none at all); fall through to the unchanged
      // deterministic path, same as before this choice existed.
      setPendingRuleChoice(undefined);
      setSession((current) => applyRemovalEffect(current, choice.controllerSeatId, choice.sourceCardName, choice.sourceCard, mode));
      return;
    }
    // destroy_all / destroy_all_conditional / damage / mass_damage — no target to choose.
    setPendingRuleChoice(undefined);
    setSession((current) => applyRemovalEffect(current, choice.controllerSeatId, choice.sourceCardName, choice.sourceCard, mode));
  }

  // Human resolution for choose_proliferate_targets — the real per-permanent/per-player choice
  // version of the blanket resolveProliferate (AppFlow.tsx), which always proliferated everything
  // eligible with no choice UI at all.
  function chooseProliferateTargets(cardIds: string[], playerSeatIds: string[]) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_proliferate_targets") return;
    setPendingRuleChoice(undefined);
    const cardIdSet = new Set(cardIds);
    const playerIdSet = new Set(playerSeatIds);
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) => ({
        ...seat,
        poison: playerIdSet.has(seat.id) && (seat.poison ?? 0) > 0 ? (seat.poison ?? 0) + 1 : seat.poison,
        experienceCounters: playerIdSet.has(seat.id) && (seat.experienceCounters ?? 0) > 0 ? (seat.experienceCounters ?? 0) + 1 : seat.experienceCounters,
        board: {
          ...seat.board,
          battlefield: seat.board.battlefield.map((card) =>
            cardIdSet.has(card.id) && card.counters && card.counters.length > 0
              ? { ...card, counters: card.counters.map((counter) => ({ ...counter, count: counter.count + 1 })) }
              : card
          )
        }
      })),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: choice.controllerSeatId,
          message: `${choice.sourceCardName} proliferates ${cardIds.length + playerSeatIds.length === 0 ? "nothing" : `${cardIds.length + playerSeatIds.length} permanent(s)/player(s)`}.`,
          detail: "Rules action"
        },
        ...current.events
      ]
    }));
  }

  // Human resolution for choose_creature_on_battlefield — mirrors resolveTriggerEffect's own
  // "add_counter" branch (used for the agent/deterministic path via chooseCounterTarget), just
  // with the target already picked by the player instead of the heuristic.
  function chooseBattlefieldCreatureTarget(targetSeatId: string, cardId: string) {
    if (pendingRuleChoice?.kind === "choose_trigger_card") {
      completeTriggerCard(cardId);
      return;
    }
    if (pendingRuleChoice?.kind === "choose_creature_for_grant") {
      const grant = pendingRuleChoice;
      setPendingRuleChoice(undefined);
      setSession((current) => grantKeywordsToCreature(current, grant.controllerSeatId, cardId, grant.keywords, grant.sourceCardName));
      return;
    }
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_creature_on_battlefield") return;
    setPendingRuleChoice(undefined);
    setSession((current) => {
      const targetSeat = current.seats.find((seat) => seat.id === targetSeatId);
      const card = targetSeat?.board.battlefield.find((item) => item.id === cardId);
      if (!targetSeat || !card) return current;
      return {
        ...current,
        seats: current.seats.map((seat) =>
          seat.id === targetSeatId
            ? {
                ...seat,
                board: {
                  ...seat.board,
                  battlefield: seat.board.battlefield.map((item) =>
                    item.id === cardId ? applyCounterDelta(item, choice.counterKind, choice.amount) : item
                  )
                }
              }
            : seat
        ),
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: choice.controllerSeatId,
            message: `${choice.sourceCardName} puts a ${choice.counterKind} counter on ${card.name}.`,
            detail: "Rules action"
          },
          ...current.events
        ]
      };
    });
  }

  // Human resolution for choose_aura_attach_target — just re-runs the same applyAuraAttachment the
  // deterministic heuristic already used, with the player's own pick instead of the heuristic's.
  function chooseAuraRetarget(targetSeatId: string, cardId: string) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_aura_attach_target") return;
    setPendingRuleChoice(undefined);
    setSession((current) => applyAuraAttachment(current, choice.controllerSeatId, choice.sourceCardId, targetSeatId, cardId));
  }

  // Human resolution for distribute_attack_trigger_mana (Klauth, Unrivaled Ancient's attack
  // trigger) — distribution must total exactly choice.amount (rule 601.2c-adjacent: X's value is
  // fixed once the trigger fires; this doesn't offer paying less than the full amount).
  function confirmAttackTriggerManaColors(distribution: Partial<Record<ColoredMana, number>>) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "distribute_attack_trigger_mana") return;
    const pool = emptyManaPool();
    for (const color of ["W", "U", "B", "R", "G"] as ColoredMana[]) pool[color] = Math.max(0, distribution[color] ?? 0);
    if (manaPoolTotal(pool) !== choice.amount) return;
    setPendingRuleChoice(undefined);
    addRestrictedManaBatch(choice.controllerSeatId, choice.sourceCardName, pool, choice.spellType);
    addEvent(`${choice.sourceCardName} adds ${formatManaPoolPayment(pool)}, spendable only to cast ${choice.spellType ? choice.spellType + " " : ""}spells this turn.`, choice.controllerSeatId, "Rules action");
  }

  function acceptCommanderZoneChoice() {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "commander_zone_choice") return;
    setPendingRuleChoice(undefined);
    setSession((current) => moveCommanderToCommandZone(current, choice.controllerSeatId, choice.sourceCardId));
  }

  function declineCommanderZoneChoice() {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "commander_zone_choice") return;
    setPendingRuleChoice(undefined);
    addEvent(`${choice.sourceCardName} stays in ${choice.fromZone === "exile" ? "exile" : "the graveyard"}.`, choice.controllerSeatId, "Rules action");
  }

  // Overrides the deterministic auto-pick (pickChosenCreatureType/pickChosenColor already applied
  // it at resolution time, same as for an agent) with whatever the human actually picked — just
  // updates the already-resolved permanent's field directly, no re-resolution needed.
  function chooseCreatureTypeChoice(creatureType: string) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_creature_type") return;
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) =>
        seat.id === choice.controllerSeatId
          ? { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === choice.sourceCardId ? { ...card, chosenCreatureType: creatureType } : card)) } }
          : seat
      )
    }));
    addEvent(`${choice.sourceCardName}'s chosen creature type is ${creatureType}.`, choice.controllerSeatId, "Rules action");
    setPendingRuleChoice(undefined);
  }

  function chooseColorChoice(color: ManaColor) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_color") return;
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) =>
        seat.id === choice.controllerSeatId
          ? { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === choice.sourceCardId ? { ...card, chosenColor: color } : card)) } }
          : seat
      )
    }));
    addEvent(`${choice.sourceCardName}'s chosen color is ${color}.`, choice.controllerSeatId, "Rules action");
    setPendingRuleChoice(undefined);
  }

  function completeRuleChoice(choice: PendingRuleChoice, cardIds: string[]) {
    if (choice.kind === "choose_card_from_library") {
      const selectedIds = cardIds.slice(0, choice.maxChoices);
      const splitDestination = choice.splitDestination;
      // "... then shuffle." — every tutor/fetch in the deck ends with it; a search that put the card on top of the library is the one exception
      // (those shuffle first, then place), so it is left alone.
      const shuffleAfterSearch = (searched: GameSession): GameSession =>
        choice.destination === "library"
          ? searched
          : { ...searched, seats: searched.seats.map((item) => (item.id === choice.controllerSeatId ? { ...item, library: shuffleCards(item.library ?? []) } : item)) };
      setSession((current) =>
        shuffleAfterSearch(selectedIds.reduce((next, cardId, index) => {
          // Dina's Guidance-style per-pick choice (see PendingRuleChoice.destinationChoices) wins
          // over both the split-destination convention and the plain single destination below —
          // the controller explicitly chose this card's zone, so nothing else should override it.
          const chosenDestination = choice.chosenDestinations?.[cardId];
          if (chosenDestination) return moveLibraryCardToDestination(next, choice.controllerSeatId, cardId, chosenDestination, chosenDestination === "battlefield" ? Boolean(choice.tapped) : false, choice.reveal);
          return splitDestination && index > 0
            ? moveLibraryCardToDestination(next, choice.controllerSeatId, cardId, splitDestination, false, choice.reveal)
            : moveLibraryCardToDestination(next, choice.controllerSeatId, cardId, choice.destination, Boolean(choice.tapped), choice.reveal);
        }, current))
      );
      setPendingRuleChoice(undefined);
      return;
    }

    if (choice.kind === "order_triggers") {
      resolveOrderedPhaseTriggers(choice.controllerSeatId, [...choice.orderedTriggers, ...choice.triggers]);
      setPendingRuleChoice(undefined);
      return;
    }

    if (choice.kind === "discard_to_hand_size" && choice.castResume) {
      const resume = choice.castResume;
      const picks = cardIds.slice(0, choice.requiredDiscards).filter((id) => id !== resume.cardId);
      setPendingRuleChoice(undefined);
      setSession((current) => ({
        ...current,
        seats: current.seats.map((item) => (item.id === resume.seatId ? { ...item, board: { ...item.board, hand: item.board.hand.map((card) => (card.id === resume.cardId ? { ...card, chosenAdditionalDiscardIds: picks } : card)) } } : item))
      }));
      window.setTimeout(() => playCard(resume.seatId, resume.cardId, resume.position, resume.sourceZone, resume.faceIndex), 50);
      return;
    }

    if (choice.kind === "discard_to_hand_size" && choice.activation && cardIds[0]) {
      setPendingRuleChoice(undefined);
      activateGenericTapAbility(choice.controllerSeatId, choice.activation.cardId, choice.activation.abilityIndex, cardIds[0]);
      return;
    }

    if (choice.kind === "discard_to_hand_size") {
      const seat = session.seats.find((item) => item.id === choice.controllerSeatId);
      const discardIds = cardIds.slice(0, choice.requiredDiscards);
      // If endTurn() opened this choice specifically to enforce the discard before its shortcut
      // skips the rest of the turn, finish that skip now that the discard is resolved — chained
      // inside the same setSession update so resolveEndTurn sees the post-discard hand, not stale
      // pre-discard state.
      const endTurnAfter = pendingEndTurnAfterDiscard.current === choice.controllerSeatId;
      pendingEndTurnAfterDiscard.current = undefined;
      setSession((current) => {
        const discarded = discardIds.reduce((next, cardId) => moveCardBetweenVisibleZones(next, choice.controllerSeatId, cardId, "graveyard"), current);
        const drawn = choice.thenDraw ? drawMultipleForSeat(discarded, choice.controllerSeatId, choice.thenDraw, `${seat?.name ?? "Player"} draws ${choice.thenDraw} card${choice.thenDraw === 1 ? "" : "s"} from ${choice.sourceCardName ?? "the discard"}.`) : discarded;
        return endTurnAfter ? resolveEndTurn(drawn, choice.controllerSeatId) : drawn;
      });
      addEvent(
        `${seat?.name ?? "Player"} discards ${discardIds.length} card${discardIds.length === 1 ? "" : "s"}${choice.sourceCardName ? ` to ${choice.sourceCardName}.` : " to hand size."}`,
        choice.controllerSeatId,
        "Rules action"
      );
      if (endTurnAfter) {
        setSelectedHandCardId(undefined);
        setPriorityPasses([]);
      }
      setPendingRuleChoice(undefined);
      return;
    }

    addEvent(`Rules choice reviewed for ${choice.sourceCardName}.`, choice.controllerSeatId, "Rules");
    setPendingRuleChoice(undefined);
  }

  function completeDiscardChoice(cardIds: string[]) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "discard_to_hand_size") return;
    // Rule 601.2a: a spell on the stack can't be discarded, even if a stale/forged pick names it.
    completeRuleChoice(choice, cardIds.filter((id) => !session.stackSpellCardIds?.includes(id)));
  }

  function chooseNextUpkeepTrigger(sourceCardId: string) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "order_triggers") return;
    const trigger = choice.triggers.find((item) => item.sourceCardId === sourceCardId);
    if (!trigger) return;
    const remaining = choice.triggers.filter((item) => item.sourceCardId !== sourceCardId);
    const orderedTriggers = [...choice.orderedTriggers, trigger];
    if (remaining.length > 0) {
      setPendingRuleChoice({ ...choice, triggers: remaining, orderedTriggers });
      return;
    }
    setPendingRuleChoice(undefined);
    resolveOrderedPhaseTriggers(choice.controllerSeatId, orderedTriggers);
  }

  function resolveOrderedPhaseTriggers(seatId: string, triggers: Array<{ sourceCardId: string; sourceCardName: string; text: string }>) {
    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat) return;
    addEvent(`${seat.name} orders ${session.phase} triggers: ${triggers.map((trigger) => trigger.sourceCardName).join(" -> ")}.`, seatId, "Rules");
    continueOrderedPhaseTriggers(seatId, triggers);
  }

  function continueOrderedPhaseTriggers(seatId: string, triggers: Array<{ sourceCardId: string; sourceCardName: string; text: string }>, carried: Array<Extract<PendingAction, { type: "trigger" }>> = []) {
    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat) return;
    const phase = TURN_PHASES.includes(session.phase as TurnPhase) ? (session.phase as TurnPhase) : undefined;
    // The deterministic triggers collected so far, in the order the controller chose (first resolves first). They go on the stack together once the
    // loop has finished (or has been resumed after an interactive prompt), so the human can respond to them like to any other trigger.
    const stackItems = [...carried];
    const stash = (remaining: typeof triggers) => {
      pendingOrderedTriggerResume.current = remaining.length > 0 || stackItems.length > 0 ? { seatId, triggers: remaining, stacked: stackItems } : undefined;
    };
    // Threaded sequentially so, e.g., two deterministically-resolved reanimation triggers in the
    // chosen order each see the board state left by the one before them — same "same class of
    // bug, single fix point" reasoning as applyDeterministicPhaseTrigger's own comment.
    let workingSession = session;
    for (let i = 0; i < triggers.length; i += 1) {
      const trigger = triggers[i];
      const workingSeat = workingSession.seats.find((item) => item.id === seatId);
      // An emblem has no battlefield entry; its stand-in card carries its text through the same dispatch (see emblemAsShimCard).
      const card = workingSeat?.board.battlefield.find((item) => item.id === trigger.sourceCardId) ?? emblemSourceCards(workingSeat ?? seat).find((item) => item.id === trigger.sourceCardId);
      if (!card) continue;
      const remaining = triggers.slice(i + 1);

      // Cumulative upkeep needs an actual pay-or-sacrifice decision (see openCumulativeUpkeepChoice)
      // rather than a deterministic session transform or an Ollama classification — only one
      // pendingRuleChoice can be open at a time, so this commits whatever's been resolved so far,
      // stashes whatever's still left in pendingOrderedTriggerResume, and stops here; payCumulativeUpkeep
      // / sacrificeRuleChoiceSource call resumePendingOrderedTriggers once the player answers, which
      // picks the queue back up instead of silently dropping it (the previous behavior).
      if (phase === "upkeep step" && isCumulativeUpkeepCard(card)) {
        if (workingSession !== session) setSession(workingSession);
        stash(remaining);
        openCumulativeUpkeepChoice(seatId, card);
        return;
      }

      // Same reasoning (and the same resume mechanism) as the single-trigger dispatch effect above
      // for isReanimateFromAnyGraveyardPhaseTrigger / targetCreatureCounterPhaseTrigger — without
      // this, a human controller's second (or third) simultaneous reanimation/counter trigger this
      // upkeep skipped straight to applyDeterministicPhaseTrigger's auto-pick heuristic with no
      // prompt at all, reported live as "I only got to choose the surveil, not which creatures
      // entered the battlefield" when Debtors' Knell, Virtue of Persistence, and Aminatou, Veil
      // Piercer all triggered on the same upkeep.
      if (phase && seat.kind === "human" && isReanimateFromAnyGraveyardPhaseTrigger(card, phase)) {
        if (workingSession !== session) setSession(workingSession);
        stash(remaining);
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_creature_from_graveyards",
          controllerSeatId: seatId,
          sourceCardId: card.id,
          sourceCardName: card.name,
          prompt: `${card.name}: choose a creature card in any graveyard to return to the battlefield under your control.`
        });
        return;
      }
      if (phase === "end step" && seat.kind === "human" && isMerenEndStepEffect(card.oracleText)) {
        if (workingSession !== session) setSession(workingSession);
        stash(remaining);
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_creature_from_graveyards",
          controllerSeatId: seatId,
          sourceCardId: card.id,
          sourceCardName: card.name,
          prompt: `${card.name}: choose a creature card in your graveyard.`,
          manaValueCeiling: seat.experienceCounters ?? 0,
          restrictToYourGraveyard: true
        });
        return;
      }
      // Braids, Arisen Nightmare: queued for a human controller's picker (see pendingBraidsChoices); the other triggers carry on.
      if (phase === "end step" && seat.kind === "human" && isBraidsEndStepText(card.oracleText)) {
        workingSession = {
          ...workingSession,
          pendingBraidsChoices: [...(workingSession.pendingBraidsChoices ?? []), { stage: "controller", seatId, braidsSeatId: seatId, sourceName: card.name, sourceCardId: card.id }]
        };
        continue;
      }
      const targetCounterEffect = phase ? targetCreatureCounterPhaseTrigger(card, phase) : undefined;
      if (phase && seat.kind === "human" && targetCounterEffect) {
        if (workingSession !== session) setSession(workingSession);
        stash(remaining);
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_creature_on_battlefield",
          controllerSeatId: seatId,
          sourceCardId: card.id,
          sourceCardName: card.name,
          prompt: `${card.name}: choose a creature to put ${targetCounterEffect.amount > 1 ? `${targetCounterEffect.amount} ` : "a"} ${targetCounterEffect.counterKind} counter${targetCounterEffect.amount > 1 ? "s" : ""} on.`,
          counterKind: targetCounterEffect.counterKind,
          amount: targetCounterEffect.amount,
          restrictToYourControl: targetCounterEffect.scope === "target_creature_you_control"
        });
        return;
      }

      // A human's scry/surveil is a look window opened right here; an agent's goes on the stack with the rest (see below).
      if (phase && seat.kind === "human" && resolvePhaseScryOrSurveil(seatId, card, phase)) {
        if (workingSession !== session) setSession(workingSession);
        stash(remaining);
        // The agent path resolves via its own separate functional setSession update
        // (resolveAgentLibraryLookWorkflow), not via workingSession — stopping the loop here (rather
        // than continuing and later overwriting that update with this function's own stale
        // workingSession) keeps that update intact, same as before this function grew a resume queue.
        return;
      }
      // The same human prompts the single-trigger dispatch opens (modal, echo, graveyard return, aimed target, ...).
      if (phase && seat.kind === "human") {
        stash(remaining);
        if (openHumanPhaseChoice(seat, card, phase)) {
          if (workingSession !== session) setSession(workingSession);
          return;
        }
        pendingOrderedTriggerResume.current = undefined;
      }
      const stacked = phase ? makePhaseStackTrigger(workingSession, seatId, card, phase) : undefined;
      if (stacked && stacked !== "blocked") {
        stackItems.push(stacked);
      } else if (!stacked) {
        // No deterministic handler: an agent's scry/surveil text is still resolved directly, anything else goes to the rules advisor.
        if (phase && resolvePhaseScryOrSurveil(seatId, card, phase)) {
          if (workingSession !== session) setSession(workingSession);
          if (stackItems.length > 0) queueCommonTriggers(stackItems);
          return;
        }
        if (!phase || !phaseConditionBlocks(workingSession, seatId, phaseEffectText(card.oracleText, phase))) {
          void consultRulesAdvisor(phase ? phaseEventName(phase) : "phase_trigger", seatId, card);
        }
      }
    }
    if (workingSession !== session) setSession(workingSession);
    if (stackItems.length > 0) queueCommonTriggers(stackItems);
  }

  function cancelRuleChoice() {
    // Braids, Arisen Nightmare: closing the picker declines the "may". An opponent who declines takes the penalty (and the next opponent is asked).
    if (pendingRuleChoice?.kind === "choose_each_player_sacrifice" && pendingRuleChoice.braids) {
      const declined = pendingRuleChoice;
      const braids = declined.braids!;
      setPendingRuleChoice(undefined);
      if (braids.stage === "opponent") {
        setSession((current) =>
          braidsRunOpponents(
            braidsDeclinePenalty(current, declined.controllerSeatId, braids.braidsSeatId, declined.sourceCardName),
            braids.braidsSeatId,
            declined.sourceCardName,
            declined.sourceCardId,
            declined.typeFilter,
            braids.remainingOpponentIds ?? []
          )
        );
      }
      addEvent(`${declined.sourceCardName}: ${braids.stage === "opponent" ? "no permanent is sacrificed" : "nothing is sacrificed"}.`, declined.controllerSeatId, "Rules action");
      return;
    }
    if (pendingRuleChoice) {
      addEvent(`No rule choice was made for ${ruleChoiceLabel(pendingRuleChoice)}.`, pendingRuleChoice.controllerSeatId, "Rules");
      // Don't let a cancelled discard-to-hand-size choice leave a stale "end the turn once this
      // resolves" flag armed for whatever the NEXT discard_to_hand_size choice turns out to be
      // (e.g. a real cleanup-step one on a future turn).
      if (pendingRuleChoice.kind === "discard_to_hand_size" && pendingEndTurnAfterDiscard.current === pendingRuleChoice.controllerSeatId) {
        pendingEndTurnAfterDiscard.current = undefined;
      }
    }
    setPendingRuleChoice(undefined);
  }

  function acceptMiracleOffer(faceIndex?: number) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "miracle_offer") return;
    const seat = session.seats.find((item) => item.id === choice.controllerSeatId);
    const card = seat?.board.hand.find((item) => item.id === choice.sourceCardId);
    if (!seat || !card) {
      setPendingRuleChoice(undefined);
      return;
    }
    // A Room card offered a miracle-like cast still needs its door choice honored — faceIndex comes
    // from which button the player actually clicked (see ruleChoiceView's doorFaces), not an
    // implicit "always face 0" default the way this used to always resolve.
    const doors = roomDoorFaces(card);
    const chosenDoor = doors && faceIndex !== undefined ? doors[faceIndex] : undefined;
    const castName = chosenDoor?.name ?? card.name;

    // Miracle is an interrupt that fires the instant a card is drawn, so a human never gets a
    // chance to pre-tap lands into their floating pool the way normal casting requires. Auto-select
    // untapped battlefield sources instead, same as the agent path, and tap them on resolution.
    const payment = chooseManaSourcesForCost(seat, card, choice.miracleCost, undefined, session.seats);
    if (!payment.ok) {
      addEvent(cannotPayMessage(seat, card, selectedManaTotal(seat, payment.sourceIds), choice.miracleCost, payment.reason), seat.id, "Rules");
      setPendingRuleChoice(undefined);
      return;
    }

    setPendingRuleChoice(undefined);
    beginPendingAction(
      {
        id: crypto.randomUUID(),
        type: "spell",
        actorSeatId: seat.id,
        cardId: card.id,
        cardName: castName,
        sourceZone: "hand",
        faceIndex,
        manaSourceIds: payment.sourceIds,
        message: `${seat.name} casts ${castName} for its miracle cost (${choice.miracleCost}) using ${formatManaPoolPayment(payment.spent)}.`
      },
      "Stack"
    );
  }

  function declineMiracleOffer() {
    const choice = pendingRuleChoice;
    if (choice?.kind === "miracle_offer") {
      addEvent(`${session.seats.find((seat) => seat.id === choice.controllerSeatId)?.name ?? "Player"} declines to cast ${choice.sourceCardName} for its miracle cost.`, choice.controllerSeatId, "Rules");
    }
    setPendingRuleChoice(undefined);
  }

  function searchLibraryCardToHand(cardId: string, searcherSeatId: string = manualLibrarySearch?.seatId ?? humanSeat.id) {
    setSession((current) => {
      const seat = current.seats.find((item) => item.id === searcherSeatId);
      const card = seat?.library?.find((item) => item.id === cardId);
      if (!seat || !card) return current;
      return {
        ...current,
        seats: current.seats.map((item) =>
          item.id === searcherSeatId
            ? {
                ...item,
                library: (item.library ?? []).filter((libraryCard) => libraryCard.id !== cardId),
                board: {
                  ...item.board,
                  hand: [...item.board.hand, { ...card, zone: "hand" as const }]
                },
                zones: {
                  ...item.zones,
                  hand: item.zones.hand + 1,
                  library: Math.max(0, item.zones.library - 1)
                }
              }
            : item
        ),
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: searcherSeatId,
            message: `${seat.name} searches their library for ${card.name} and puts it into hand.`
          },
          ...current.events
        ]
      };
    });
    setManualLibrarySearch(undefined);
  }

  function keepLibraryLookCardOnTop(cardId: string) {
    const activeLook = libraryLook;
    if (!activeLook) return;
    if (activeLook.mode === "scry") {
      setSession((current) => {
        const scried = addLibraryLookEvent(current, activeLook.seatId, `${current.seats.find((seat) => seat.id === activeLook.seatId)?.name ?? "Player"} keeps ${activeLook.cards.find((card) => card.id === cardId)?.name ?? "that card"} on top and finishes scrying.`);
        // "Scry 2, then draw two cards." (Read the Bones): the draw follows the scry.
        return activeLook.drawCountAfter ? drawMultipleForSeat(scried, activeLook.seatId, activeLook.drawCountAfter, `${scried.seats.find((seat) => seat.id === activeLook.seatId)?.name ?? "Player"} draws ${activeLook.drawCountAfter} card${activeLook.drawCountAfter === 1 ? "" : "s"}.`) : scried;
      });
      setLibraryLook(undefined);
      return;
    }

    setSession((current) => moveLibraryCard(current, activeLook.seatId, cardId, "top"));
    setLibraryLook((current) => {
      if (!current) return current;
      const cards = current.cards.filter((card) => card.id !== cardId);
      return cards.length > 0 ? { ...current, cards } : undefined;
    });
  }

  function putLibraryLookCardOnBottom(cardId: string) {
    const activeLook = libraryLook;
    if (!activeLook) return;
    if (activeLook.mode === "scry") {
      const nextRemaining = Math.max(0, activeLook.remaining - 1);
      setSession((current) => {
        const moved = moveLibraryCard(current, activeLook.seatId, cardId, "bottom");
        const seat = moved.seats.find((item) => item.id === activeLook.seatId);
        const nextCard = nextRemaining > 0 ? (seat?.library ?? [])[0] : undefined;
        setLibraryLook(nextCard ? { seatId: activeLook.seatId, mode: "scry", cards: [nextCard], remaining: nextRemaining, drawCountAfter: activeLook.drawCountAfter } : undefined);
        // "Scry 2, then draw two cards." (Read the Bones): the scry is over (no card left to look at), so the draw happens now.
        if (!nextCard && activeLook.drawCountAfter) {
          return drawMultipleForSeat(moved, activeLook.seatId, activeLook.drawCountAfter, `${moved.seats.find((item) => item.id === activeLook.seatId)?.name ?? "Player"} draws ${activeLook.drawCountAfter} card${activeLook.drawCountAfter === 1 ? "" : "s"}.`);
        }
        return moved;
      });
      return;
    }

    setLibraryLook((current) => {
      if (!current) return current;
      const cards = current.cards.filter((card) => card.id !== cardId);
      return cards.length > 0 ? { ...current, cards } : undefined;
    });
  }

  function putLibraryLookCardInGraveyard(cardId: string) {
    const activeLook = libraryLook;
    if (!activeLook || activeLook.mode !== "surveil") return;
    setSession((current) => moveLibraryCard(current, activeLook.seatId, cardId, "graveyard"));
    setLibraryLook((current) => {
      if (!current) return current;
      const cards = current.cards.filter((card) => card.id !== cardId);
      return cards.length > 0 ? { ...current, cards } : undefined;
    });
  }

  function orderLibraryLookCardOnTop(cardId: string) {
    const activeLook = libraryLook;
    if (!activeLook || activeLook.mode !== "reorder") return;
    const card = activeLook.cards.find((item) => item.id === cardId);
    if (!card) return;
    const orderedCards = [...(activeLook.orderedCards ?? []), card];
    const remainingCards = activeLook.cards.filter((item) => item.id !== cardId);
    if (remainingCards.length > 0) {
      setLibraryLook({ ...activeLook, cards: remainingCards, orderedCards });
      return;
    }
    // orderedCards is built in click order (kept that way for the "Chosen: A -> B -> C" trail
    // above), but reorderTopLibraryCards puts its first element on top of the library. Physically
    // placing cards back one at a time stacks each new one ON TOP of the ones already placed, so
    // the card clicked LAST is the one that ends up on top (drawn next) — reported live as the
    // opposite of that happening, with the first card clicked landing on top instead.
    const drawCountAfter = activeLook.drawCountAfter;
    setSession((current) => {
      const reordered = reorderTopLibraryCards(current, activeLook.seatId, [...orderedCards].reverse());
      if (!drawCountAfter) return reordered;
      // Ponder's own "...then draw a card." half — see LibraryLookState.drawCountAfter's doc
      // comment for why this is the only "reorder" completion that draws afterward.
      const seatName = reordered.seats.find((seat) => seat.id === activeLook.seatId)?.name ?? "Player";
      return drawMultipleForSeat(reordered, activeLook.seatId, drawCountAfter, `${seatName} draws ${drawCountAfter === 1 ? "a card" : `${drawCountAfter} cards`}.`);
    });
    setLibraryLook(undefined);
    if (activeLook.shuffleOfferSource) {
      const stub = { id: "shuffle-offer", name: activeLook.shuffleOfferSource, typeLine: "Instant", oracleText: "", colors: [], manaValue: 0, role: "spell", zone: "graveyard" } as VisibleCard;
      const targetName = session.seats.find((seat) => seat.id === activeLook.seatId)?.name ?? "that player";
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_trigger_option",
        controllerSeatId: activeLook.lookerSeatId ?? activeLook.seatId,
        sourceCardId: stub.id,
        sourceCardName: activeLook.shuffleOfferSource,
        prompt: `${activeLook.shuffleOfferSource}: have ${targetName} shuffle their library?`,
        options: [{ index: 0, label: "Shuffle" }, { index: 1, label: "Don't shuffle" }],
        trigger: makeCommonTrigger(activeLook.lookerSeatId ?? activeLook.seatId, activeLook.lookerSeatId ?? activeLook.seatId, stub, { kind: "shuffle_library", seatId: activeLook.seatId }, `${activeLook.shuffleOfferSource}: shuffle option.`),
        remainingStack: []
      });
    }
  }

  // "choose_one" (Diabolic Vision-style "look at the top N, put one into hand, the rest on top in
  // any order") is a two-phase interaction: this handles phase one (send exactly one looked-at card
  // to hand), then hands off to the existing "reorder" mode/orderLibraryLookCardOnTop for phase two
  // (choosing what order the rest go back in) — reusing that flow rather than duplicating it.
  // "choose_one_bottom" (Growing Rites of Itlimoc) is a ONE-phase variant instead: allowedCardFilter
  // restricts which card this even accepts (enforced here, not just in the UI, so a stale click
  // can't bypass it), and the rest go straight to the bottom with no reorder phase at all — bottom-
  // of-library order is practically unobservable, so there's no real second choice to make.
  function sendLibraryLookCardToHand(cardId: string) {
    const activeLook = libraryLook;
    if (!activeLook || (activeLook.mode !== "choose_one" && activeLook.mode !== "choose_one_bottom")) return;
    const card = activeLook.cards.find((item) => item.id === cardId);
    if (!card) return;
    if (activeLook.allowedCardFilter && !cardMatchesTypeFilter(card.typeLine, activeLook.allowedCardFilter)) return;
    setSession((current) => moveLibraryCardToDestination(current, activeLook.seatId, cardId, "hand", false));
    const remainingCards = activeLook.cards.filter((item) => item.id !== cardId);
    if (activeLook.mode === "choose_one_bottom") {
      setSession((current) =>
        activeLook.restDestination === "graveyard"
          ? putLookedAtCardsInGraveyard(current, activeLook.seatId, remainingCards)
          : putLookedAtCardsOnBottom(current, activeLook.seatId, remainingCards)
      );
      setLibraryLook(undefined);
      return;
    }
    if (remainingCards.length === 0) {
      setLibraryLook(undefined);
      return;
    }
    setLibraryLook({ seatId: activeLook.seatId, ...(activeLook.lookerSeatId ? { lookerSeatId: activeLook.lookerSeatId } : {}), mode: "reorder", cards: remainingCards, remaining: remainingCards.length, orderedCards: [] });
  }

  // Closing the library-look window (the X button, or clicking the backdrop) for every other mode
  // just abandons the look with the library untouched — a real, if incidental, existing affordance.
  // "choose_one_bottom" (Growing Rites of Itlimoc) is different: ONLY the creature reveal is
  // optional ("you may") — "put the rest on the bottom" is mandatory regardless, so declining the
  // reveal must still send every looked-at card to the bottom rather than leaving them stuck
  // wherever they physically sit in the library.
  function closeLibraryLook() {
    if (libraryLook?.mode === "choose_one_bottom") {
      setSession((current) =>
        libraryLook.restDestination === "graveyard"
          ? putLookedAtCardsInGraveyard(current, libraryLook.seatId, libraryLook.cards)
          : putLookedAtCardsOnBottom(current, libraryLook.seatId, libraryLook.cards)
      );
    }
    setLibraryLook(undefined);
  }

  // The "Search Library" box and its answers, for any seat (the table callbacks onOpenLibrarySearch / onCloseLibrarySearch / onSearchLibraryCardToHand).
  function openManualLibrarySearch(seatId: string) {
    setManualLibrarySearch({ seatId, destination: "hand" });
  }
  function closeLibrarySearch(seatId: string) {
    setManualLibrarySearch(undefined);
    if (pendingRuleChoice?.controllerSeatId === seatId) cancelRuleChoice();
  }
  function searchOrChooseLibraryCard(seatId: string, cardId: string, destination?: "hand" | "graveyard" | "battlefield") {
    if (pendingRuleChoice?.controllerSeatId === seatId) {
      chooseRuleLibraryCard(cardId, destination);
      return;
    }
    searchLibraryCardToHand(cardId, seatId);
  }

  return { closeLibrarySearch, openManualLibrarySearch, searchOrChooseLibraryCard, acceptCommanderZoneChoice, acceptMiracleOffer, cancelRuleChoice, chooseAuraRetarget, chooseBattlefieldCreatureTarget, chooseColorChoice, chooseCreatureTypeChoice, chooseEachPlayerSacrificeTarget, chooseEffectTarget, chooseGraveyardReanimationTarget, chooseModalOption, chooseNextUpkeepTrigger, chooseProliferateTargets, chooseSacrificeCostTarget, closeLibraryLook, completeDiscardChoice, completeRuleChoice, confirmAttackTriggerManaColors, continueOrderedPhaseTriggers, declineCommanderZoneChoice, declineEffectTarget, declineMiracleOffer, finishRuleLibrarySearch, keepLibraryLookCardOnTop, maybeRequestTarget, openHumanPhaseChoice, openPunisherPrompt, orderLibraryLookCardOnTop, putLibraryLookCardInGraveyard, putLibraryLookCardOnBottom, resolveOrderedPhaseTriggers, searchLibraryCardToHand, sendLibraryLookCardToHand };
}
