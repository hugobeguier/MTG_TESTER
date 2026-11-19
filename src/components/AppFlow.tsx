"use client";

import { useEffect, useMemo } from "react";
import type { GameSession } from "@/lib/types";
import { chooseManaSourcesForCost, payCostFromPool } from "@/engine/mana";
export { attackTriggerManaHeuristicSplit, chooseManaSourcesForCost, costlyTapManaColors, isAvailableManaSource, isRecognizedBoardCondition, lifeGainedThisTurn, manaAmountFromAddClause, manaChoicesForCard, manaProducedBy, signetAbility, spendManaSources } from "@/engine/mana";
export { emblemAsShimCard } from "@/engine/shared";

export { agentBestCopyCandidate, parseCreateTokenSpecs } from "@/engine/tokens";
export { adjustedCastingCost, cardWithFaceManaCost, manaValueFromManaCost, maxAffordableX, miracleCostFor, staticCostReduction, totalCastingCost } from "@/engine/costs";
export { entersBattlefieldTapped, landDropsAllowed, landPlaysMade, recordLandPlay, revealLandTypes } from "@/engine/lands";
import { isPlaneswalkerCard, loyaltyCounterCount } from "@/engine/zones";
export { applyGraveyardExile, findEnterAsCopyTarget, moveCardBetweenVisibleZones, moveCommanderToCommandZone, parseEnterAsCopyEffect, putLookedAtCardsInGraveyard, shuffleCards } from "@/engine/zones";

import { parseCounterSpellAbility } from "@/lib/counterSpells";
import { stopKey } from "@/lib/priorityStops";
export { activateSteelHellkiteX, agentSurveilDecision, applyGenericModalEffect, applyMassBounceEffect, applyMassPumpEffect, applyMill, applyRemovalEffect, applySimpleLifeChange, applySpellExtraEffect, applyTargetedPumpEffect, applyZoneEffect, castTargetLegal, chooseAgentLibraryCardForRuleChoice, drawForSeat, drawMultipleForSeat, genericCostShim, matchesPermanentSacrificeFilter, parseGenericModalEffect, parseTargetedPump, payWardIfNeeded, putLookedAtCardsOnBottom, resolveAgentLibraryLookWorkflow, resolveDeferredChoice, substituteX } from "@/engine/effects";

export { applyEntersWithCounterReplacements, destroyCreatures, moveCardAcrossSeats, moveLibraryCardToDestination, returnLinkedExiles } from "@/engine/entry";
export { createTokensForSeat } from "@/engine/tokens";
export { BRAIDS_TYPE_FILTER, applyBraidsEndStep, applyDeterministicPhaseTrigger, applyDigToBattlefield, applyMerenEndStepEffect, applyTargetedEffect, braidsDeclinePenalty, braidsRunOpponents, braidsSharedTypeFilter, commonTriggerEffect, findCommonTriggersForPermanentEntered, phaseClauseConditionMet, phaseConditionBlocks, phaseEffectText, phaseEvent, resolveTriggerEffect, ventureIntoUndercity } from "@/engine/triggers";
export type { CastChoices } from "@/engine/types";
export { runStateBasedActionsPass, winTheGame } from "@/engine/stateBased";
export { addDamageShieldsFromSpec, applyCombatDamageToTarget } from "@/engine/damage";
import { ThreeGameTable } from "./ThreeGameTable";
import { SetupScreen } from "./SetupScreen";
import { GameOverDialog } from "./GameOverDialog";
import { useGameState, type GameContext, type HandlerApi } from "./game/context";
import { useManaUi } from "./game/useManaUi";
import { useGameSetup } from "./game/useGameSetup";
import { useTurnFlow } from "./game/useTurnFlow";
import { useCombatUi } from "./game/useCombatUi";
import { useStackResolution } from "./game/useStackResolution";
import { useTriggerResolution } from "./game/useTriggerResolution";
import { useCasting } from "./game/useCasting";
import { useAbilities } from "./game/useAbilities";
import { useChoicePrompts } from "./game/useChoicePrompts";
import { useAgentDriver } from "./game/useAgentDriver";
import { useGameActions } from "./game/useGameActions";
import { useRulesAdvisor } from "./game/useRulesAdvisor";
import { useSpecialEffects } from "./game/useSpecialEffects";
import { useGameEffects } from "./game/useGameEffects";
import { useSeatYield } from "./game/useSeatYield";
import { hostHumanSeat } from "@/lib/multiplayer/seatMap";
import { useMpHost } from "./game/useMpHost";
import { MpPauseBanner } from "./MpPauseBanner";
import { pendingActionRequiredPasses, resolutionPromptNote, withPendingActionSourceCard } from "@/engine/priority";
import { legalCounterSpellTargets } from "@/engine/legalActions";
import { canCastAtInstantSpeed, handCardFaceOptions, roomDoorFaces, seatHasFlashGrant } from "@/engine/casting";
import { attackLockedOut, canAttack } from "@/engine/combat";
import { getBasicLandFetchOptions, getMyriadLandscapeOptions } from "@/engine/etb";
import { mulliganReturnRequired, waitingForNames } from "@/lib/multiplayer/mulliganGate";
import { blockChoiceView, ruleChoiceView } from "@/components/viewModels";
import { promptSlotsForSeat } from "@/lib/multiplayer/seatPrompts";
export type { LegalAgentAction } from "@/engine/flowTypes";
export { resolvePendingUpkeepDraws, untapForSeat, clearTemporaryBuffs, resolveEndStepExileDamage, hasPhaseTrigger, humanPhaseGraveyardChoice, applyEndStepEffects, makePhaseStackTrigger, planOffTurnPhaseTriggers, scheduleDelayedPhaseTrigger, rollForStartingSeat } from "@/engine/turnFlow";
export { applyExalted, resolveCombatDamage, cleanupCombat, assignBlockers, attackLockedOut, creatureCantBlock, hasVigilance, resolveAttackTarget, countCreaturesAttackingSeat, legalAttackActions, legalBlockActions, forcedAttackers, totalAttackTax } from "@/engine/combat";
export { validateConfigsForPlay, applyDeckToSeat } from "@/components/DeckSetup";
import { playingConfigs } from "@/components/DeckSetup";
export { animateEnchantmentSpec, resolveEquip, payGenericSacrificeCost, applySacrificeEffect, payGenericTapCost, parseGenericAbilityEffect, applyGenericAbilityEffect, payGenericManaCost, applyGenericTapEffect, cycleCardInSession, tapCreaturesAltCostFor } from "@/engine/abilities";
export { grantsExtraTurn, basicLandFetchBeholdType, resolveBasicLandFetchSearch, chooseBestBasicLandPairForMyriad, applySagaEntryLoreCounterHeadless, advanceSagaLoreCountersHeadless } from "@/engine/etb";
export { legalMainPhaseActions, legalPriorityActions, checkMoveLegal, untapAllLandsIsWorthIt } from "@/engine/legalActions";

export { recordCommanderCast, applySpellDamagePrevention, spellCastLockedOut, payAdditionalDiscardCost, sacrificeForAdditionalCost, additionalSacrificeCandidates, chooseAdditionalCostSacrifice, pathOfAncestryScries, chooseFreeCastCard, markHandCardFreeCastable, spellResolutionDestination, modalDoubleFacedLandSplit, roomDoorFaces, independentlyCastableSpellFaces, isSplitSpellCard, castFaceDecision, handCardFaceOptions, targetingTax, seatHasFlashGrant, playCardFromZone } from "@/engine/casting";

export { spellModePrompt, castStructure, nextCastPrompt, stackTargetText, agentCastTimeRemovalChoices, castModeLabels, applyCastRemoval, applyCastGenericModes, spellTargetSlots, applyLabeledContinuation, steelHellkiteXOptions, hasResolvableRemovalTarget, AGENT_UNSUPPORTED_SPELL_TEXT, hasResolvableTarget } from "@/engine/castTargets";
export { parseEtbZoneEffect, parseSimpleLifeChange, parseSimpleDrawEffect, parseMassPump, parseMassBounceEffect, hideawayDamageConditionMet, applyDigPick, searchableLibraryCards, remainingLibraryTotalManaValue, addEmblemToSeat, findEmblemGraveyardReturns, parseEachPlayerSacrificeEffect, applyEachPlayerSacrificeEffect, applyChosenEachPlayerSacrifice, isBraidsEndStepText, parsePunisherChoiceEffect, applyPunisherChoiceEffect, isLivingDeathEffect, applyLivingDeathEffect, applyCastRevealUntilCreatures } from "@/engine/oneShotEffects";

export { findEntersBatchWatcherTriggers, isArchaeomancersMapLandRaidTrigger, findLandRaidTriggers, findSacrificeWatcherTriggers, findPutIntoGraveyardTriggers, findCommonTriggersForPermanentDied, findLeavesBattlefieldTriggers, grantKeywordsToCreature, findLifeGainTriggers, lifeGainReplacementBonus, findMultiAttackTriggers, findAttackTriggers, findCombatDamageToPlayerTriggers, parseAnyCreatureCombatDamageToOpponentTrigger, findAnyCombatDamageToOpponentTriggers, parseBreenaAttackTrigger, findBreenaAttackTriggers, findCardsLeftGraveyardTriggers, findCastTriggers, activateGraveyardReturnInSession } from "@/engine/triggerFinders";
export { shouldConsultRulesAdvisor, pendingActionRequiredPasses, resolutionPromptNote, canReceivePriorityForPendingAction } from "@/engine/priority";
export { openingHandBattlefieldCards, putOpeningHandCardOnBattlefield, resolveAgentMulligans, withOpeningHand, resolveAgentLimDulVault } from "@/engine/mulligan";


interface OllamaStatus {
  ok: boolean;
  message: string;
  models?: string[];
}

// AppFlow() is glue + JSX. State: game/context.ts (useGameState). Handlers/effects: game/use*.ts hooks sharing one GameContext - see src/components/README.md.
export function AppFlow({ initialSession, ollama, multiplayerHost = false }: { initialSession: GameSession; ollama: OllamaStatus; multiplayerHost?: boolean }) {
  const state = useGameState(initialSession, { emptyNonHostSeats: multiplayerHost }); // /mp/host: seats 1-3 start Empty (play alone), not AI
  const { mode, setMode, session, activeSeatId, prioritySeatId, tableSession, selectedHandCardId, setSelectedHandCardId, inspectedCard, setInspectedCard, gameStage, gameOverDismissed, setGameOverDismissed, setupMessage, configs, deckLibrary, savedGames, gameStarting, humanSeat, selectedHandCard } = state;
  const { agentThinking, agentReasoning } = state.agent;
  const { mulligans, keptHands, mulliganReturnCardIds, libraryLook, manualLibrarySearch, setManualLibrarySearch, pendingRuleChoice, blockChoice, selectedBlockerIds, myriadSearch, setMyriadSearch, myriadTapChoice, setMyriadTapChoice, basicLandFetchSearch, setBasicLandFetchSearch, choiceMinimized, setChoiceMinimized } = state.choices;
  const { manaPools, manaChoice, setManaChoice } = state.mana;
  const { pendingAction, stackActions, priorityPasses, priorityStopSettings, updatePriorityStopSettings, holdPriorityOnce, setHoldPriorityOnce, resolveNowRef, abilityApiRef, stackFeed } = state.stack;
  // Handlers live in the game/ hooks; they all read the same GameContext and call each other through ctx.late (filled just below).
  const late = {} as HandlerApi;
  const ctx: GameContext = { ...state, late };
  Object.assign(late, useManaUi(ctx), useGameSetup(ctx), useTurnFlow(ctx), useCombatUi(ctx), useStackResolution(ctx), useTriggerResolution(ctx), useCasting(ctx), useAbilities(ctx), useChoicePrompts(ctx), useAgentDriver(ctx), useGameActions(ctx), useRulesAdvisor(ctx), useSpecialEffects(ctx), useSeatYield(ctx));
  const { cancelManaChoice, cancelMyriadTapChoice, chooseManaColor, closeBasicLandFetchSearch, closeLibrarySearch, closeMyriadSearch, openManualLibrarySearch, searchOrChooseLibraryCard, acceptCommanderZoneChoice, acceptMiracleOffer, acceptOptionalTrigger, activateEquip, activateGenericManaAbility, activateGenericSacrificeAbility, activateGenericTapAbility, activateScriptedAbility, activateGraveyardAbility, activateLoyaltyAbility, activateManlandAnimation, activateSelfUntapAbility, advanceTurn, buildDeck, cancelRuleChoice, castCommander, castFromExile, castFromGraveyard, changeCounter, changeLife, chooseAuraRetarget, chooseBattlefieldCreatureTarget, chooseColorChoice, chooseCreatureToSacrificeForCast, chooseCreatureTypeChoice, chooseEachPlayerSacrificeTarget, chooseEffectTarget, chooseGraveyardReanimationTarget, chooseModalOption, chooseMyriadLandscapeSearch, chooseMyriadLandscapeTapMana, chooseNextUpkeepTrigger, chooseProliferateTargets, chooseRuleLibraryCard, chooseSacrificeCostTarget, closeLibraryLook, completeBasicLandFetch, completeChoosePermanentToBlink, completeConniveDiscard, completeDiscardChoice, completeMyriadLandscape, completePutCardsOnLibrary, completeReturnLandToHand, confirmAttackTriggerManaColors, confirmEquipTarget, confirmHumanBlockers, currentCleanSaveStopStatus, cycleCard, declareHumanAttack, declineCommanderZoneChoice, declineEffectTarget, declineMiracleOffer, declineOptionalTrigger, deleteSavedGameEntry, drawCard, endTurn, finishRuleLibrarySearch, handleInspectCard, hasPlayedLandThisTurn, keepLibraryLookCardOnTop, keepLimDulVaultCards, keepOpeningHand, loadSavedGame, moveBattlefieldCard, moveCardToExile, moveCardToGraveyard, moveCardToHand, mulliganOpeningHand, openResponseWindow, orderLibraryLookCardOnTop, passHumanBlocks, passPriority, payCumulativeUpkeep, playCard, poolForSeat, putLibraryLookCardInGraveyard, putLibraryLookCardOnBottom, repeatLimDulVault, resolveBasicLandFetch, resolveMyriadLandscape, resolvePendingActionNow, resolvePendingTrigger, resolveSacrificeAbilityEffect, resolveTapAbilityEffect, respondWithSelectedCard, sacrificeRuleChoiceSource, saveGameNow, searchLibraryCardToHand, sendLibraryLookCardToHand, shuffleLibrary, startGame, tapForMana, tapPermanentForMana, toggleHumanBlocker, toggleMulliganReturnCard, toggleTapCard, unlockRoomDoor, updateConfig, toggleSeatYield } = late;
  // All useEffect blocks (original relative order), after every handler hook.
  useGameEffects(ctx);
  useMpHost(ctx, { enabled: multiplayerHost }); // read-only publisher for /mp/host; no-op otherwise

  // A priority window is offered whenever untapped lands could cover the cost, not only once mana
  // is already floating (see canReceivePriorityForPendingAction) — this must accept the same
  // fallback, or the "Respond Selected" button stays disabled for a human who hasn't pre-tapped,
  // making instant-speed responses look broken during another player's turn.
  // A type-restricted counterspell ("counter target creature/noncreature/commander spell") in hand
  // used to look just as respondable as any other instant here, even against a stack action it
  // can't legally target — the button stayed enabled, and the human only found out it did nothing
  // useful after already spending the mana and the card (respondWithCard now refuses this too, but
  // this check is what actually surfaces it up front instead of after the fact).
  const selectedCardCanLegallyCounter = (() => {
    if (!selectedHandCard) return true;
    const counterAbility = parseCounterSpellAbility(selectedHandCard.oracleText);
    if (!counterAbility || !pendingAction || pendingAction.type !== "spell") return true;
    // Any legal spell on the stack will do, not only the top one: the target is chosen in the cast prompt.
    return legalCounterSpellTargets(session, stackActions, counterAbility).length > 0;
  })();
  const selectedCardCanRespond = selectedHandCard
    ? canCastAtInstantSpeed(selectedHandCard, seatHasFlashGrant(humanSeat, selectedHandCard)) &&
      selectedCardCanLegallyCounter &&
      (payCostFromPool(poolForSeat(humanSeat.id), selectedHandCard, selectedHandCard.manaValue).ok ||
        chooseManaSourcesForCost(humanSeat, selectedHandCard, selectedHandCard.manaValue, undefined, session.seats).ok)
    : false;
  const selectedCardFaceOptions = selectedHandCard
    ? handCardFaceOptions(humanSeat, selectedHandCard, hasPlayedLandThisTurn(humanSeat.id, session.turn), activeSeatId, poolForSeat(humanSeat.id), session.seats, session)
    : undefined;
  const inspectedRoomLockedFaceIndex = (() => {
    if (!inspectedCard) return undefined;
    const doors = roomDoorFaces(inspectedCard);
    const unlocked = inspectedCard.unlockedFaceIndices ?? [];
    if (!doors || unlocked.length !== 1) return undefined;
    return unlocked[0] === 0 ? 1 : 0;
  })();
  const humanAttackTargets = (() => {
    if (!inspectedCard) return undefined;
    if (activeSeatId !== humanSeat.id || session.phase !== "declare attackers step") return undefined;
    const isOwnBattlefieldCreature = humanSeat.board.battlefield.some((card) => card.id === inspectedCard.id);
    if (!isOwnBattlefieldCreature || !canAttack(inspectedCard) || attackLockedOut(session, inspectedCard)) return undefined;
    const targets: Array<{ targetId: string; label: string }> = [];
    for (const opponent of session.seats.filter((seat) => seat.id !== humanSeat.id && !seat.hasLost)) {
      targets.push({ targetId: opponent.id, label: `Attack ${opponent.name}` });
      for (const planeswalker of opponent.board.battlefield.filter(isPlaneswalkerCard)) {
        targets.push({ targetId: planeswalker.id, label: `Attack ${planeswalker.name} (${opponent.name}, ${loyaltyCounterCount(planeswalker)} loyalty)` });
      }
    }
    return targets;
  })();
  const playBlockedByBuild = configs.some((config) => config.status === "building");

  const setupSummary = useMemo(() => {
    const playing = playingConfigs(configs);
    const ready = playing.filter((config) => config.deck?.validation.legal).length;
    return `${ready}/${playing.length} decks ready`;
  }, [configs]);
  resolveNowRef.current = resolvePendingActionNow;
  abilityApiRef.current = { resolveSacrificeAbilityEffect, resolveTapAbilityEffect };

  // Who must pass for the top stack item to resolve (drives the priority pips next to the stack). Same call the priority driver makes.
  const requiredPassesForPanel = useMemo(
    () =>
      pendingAction
        ? pendingActionRequiredPasses(session.seats, pendingAction, activeSeatId, session, manaPools, priorityStopSettings, holdPriorityOnce ? humanSeat.id : undefined, undefined, stackActions)
        : [],
    [pendingAction, stackActions, session, activeSeatId, manaPools, priorityStopSettings, holdPriorityOnce, humanSeat.id]
  );

  // "When this resolves you'll have to choose" notes for the human, keyed by stack item id (shown on the stack entries).
  const stackPrompts = useMemo(() => {
    const notes: Record<string, string> = {};
    const humanForNotes = hostHumanSeat(session.seats);
    if (!humanForNotes) return notes;
    for (const item of [...(pendingAction ? [pendingAction] : []), ...stackActions]) {
      const note = resolutionPromptNote(humanForNotes, item, session);
      if (note) notes[item.id] = note;
    }
    return notes;
  }, [pendingAction, stackActions, session]);

  // A new choice always opens expanded, and a finished one leaves nothing to resume.
  useEffect(() => {
    setChoiceMinimized(false);
  }, [pendingRuleChoice?.id, manaChoice, libraryLook]);

  if (mode === "setup") {
    return (
      <SetupScreen
        setupSummary={setupSummary}
        ollama={ollama}
        xmage={session.xmage}
        setupMessage={setupMessage}
        playBlockedByBuild={playBlockedByBuild}
        gameStarting={gameStarting}
        onStartGame={startGame}
        savedGames={savedGames}
        onLoadSavedGame={loadSavedGame}
        onDeleteSavedGame={deleteSavedGameEntry}
        configs={configs}
        deckLibrary={deckLibrary}
        onBuildDeck={buildDeck}
        onUpdateConfig={updateConfig}
        multiplayerHost={multiplayerHost}
      />
    );
  }

  // The host's screen shows only the prompts addressed to the HOST's seat (a friend's prompts live in their own snapshot).
  const hostPrompts = promptSlotsForSeat({ pendingRuleChoice, libraryLook, blockChoice, manaChoice, myriadTapChoice, myriadSearch, basicLandFetchSearch, manualLibrarySearch }, humanSeat.id);
  return (
    <main className="app-shell game-shell">
      {session.status === "complete" && !gameOverDismissed ? (
        <GameOverDialog session={session} gameStarting={gameStarting} setupMessage={setupMessage} onPlayAgain={startGame} onDismiss={() => setGameOverDismissed(true)} onBackToSetup={() => setMode("setup")} />
      ) : null}
      <button className="game-back-button" type="button" onClick={() => setMode("setup")} aria-label="Back to setup">
        ×
      </button>
      {multiplayerHost ? null : (
      <button
        className="game-save-button"
        type="button"
        onClick={saveGameNow}
        disabled={!currentCleanSaveStopStatus().ok}
        title={currentCleanSaveStopStatus().reason ?? "Save this game"}
      >
        Save
      </button>
      )}
      <MpPauseBanner names={state.mpPausedFor} />
      <ThreeGameTable
        stackPrompts={stackPrompts}
        stackFeed={stackFeed}
        requiredPasses={requiredPassesForPanel}
        priorityPasses={priorityPasses}
        choiceMinimized={choiceMinimized}
        onSetChoiceMinimized={setChoiceMinimized}
        gameStage={gameStage}
        humanMulligans={mulligans[humanSeat.id] ?? 0}
        mulliganReturnCardIds={mulliganReturnCardIds[humanSeat.id] ?? []}
        mulliganKept={Boolean(keptHands[humanSeat.id])}
        mulliganWaitingFor={waitingForNames(session.seats.filter((seat) => seat.id !== humanSeat.id), keptHands)}
        mulliganReturnRequired={keptHands[humanSeat.id] ? 0 : mulliganReturnRequired(humanSeat.board.hand, mulligans[humanSeat.id] ?? 0)}
        session={tableSession}
        prioritySeatId={prioritySeatId}
        pendingAction={pendingAction ? withPendingActionSourceCard(session, pendingAction, stackActions) : undefined}
        stackActions={stackActions.map((action) => withPendingActionSourceCard(session, action, stackActions))}
        agentThinking={agentThinking}
        agentReasoning={agentReasoning}
        manaPool={poolForSeat(humanSeat.id)}
        manaChoice={hostPrompts.manaChoice}
        myriadTapChoice={hostPrompts.myriadTapChoice}
        blockChoice={blockChoiceView(session, hostPrompts.blockChoice)}
        selectedCardCanRespond={selectedCardCanRespond}
        selectedCardFaceOptions={selectedCardFaceOptions}
        onPlayCardFace={(seatId, cardId, faceIndex) => playCard(seatId, cardId, undefined, "hand", faceIndex)}
        onKeepHand={() => keepOpeningHand()}
        onMulligan={() => mulliganOpeningHand()}
        onToggleMulliganReturnCard={(card) => toggleMulliganReturnCard(card)}
        onAdvanceTurn={advanceTurn}
        onEndTurn={() => endTurn()}
        onDrawCard={drawCard}
        onInspectCard={handleInspectCard}
        onCloseInspectCard={() => setInspectedCard(undefined)}
        onPassPriority={passPriority}
        priorityStopSettings={priorityStopSettings}
        onTogglePhaseStop={(phase, seatIndex) =>
          updatePriorityStopSettings((prev) => ({
            ...prev,
            phaseStops: { ...prev.phaseStops, [stopKey(phase, seatIndex)]: !prev.phaseStops[stopKey(phase, seatIndex)] }
          }))
        }
        onToggleStopOnStackResponse={() => updatePriorityStopSettings((prev) => ({ ...prev, stopOnStackResponse: !prev.stopOnStackResponse }))}
        onToggleStopOnAttacked={() => updatePriorityStopSettings((prev) => ({ ...prev, stopOnAttacked: !prev.stopOnAttacked }))}
        onToggleStopOnTargeted={() => updatePriorityStopSettings((prev) => ({ ...prev, stopOnTargeted: !prev.stopOnTargeted }))}
        onToggleStopOnChoicePrompt={() => updatePriorityStopSettings((prev) => ({ ...prev, stopOnChoicePrompt: prev.stopOnChoicePrompt === false }))}
        onToggleFullControl={() => updatePriorityStopSettings((prev) => ({ ...prev, fullControl: !prev.fullControl }))}
        holdPriorityOnce={holdPriorityOnce}
        yielding={priorityStopSettings.yields?.[humanSeat.id] !== undefined}
        onToggleYield={() => toggleSeatYield(humanSeat.id)}
        onStopNext={() => setHoldPriorityOnce(true)}
        onPlayCard={playCard}
        onCycleCard={cycleCard}
        onCastFromExile={castFromExile}
        onCastFromGraveyard={castFromGraveyard}
        onActivateGraveyardAbility={activateGraveyardAbility}
        onRespond={openResponseWindow}
        onRespondWithSelectedCard={respondWithSelectedCard}
        onResolvePendingTrigger={resolvePendingTrigger}
        onToggleBlocker={toggleHumanBlocker}
        selectedBlockerIds={selectedBlockerIds}
        onConfirmBlockers={confirmHumanBlockers}
        onPassBlocks={passHumanBlocks}
        onPayCumulativeUpkeep={payCumulativeUpkeep}
        onSacrificeRuleSource={sacrificeRuleChoiceSource}
        onShuffleLibrary={shuffleLibrary}
        onOpenLibrarySearch={() => openManualLibrarySearch(humanSeat.id)}
        onMoveCardToGraveyard={moveCardToGraveyard}
        onMoveCardToExile={moveCardToExile}
        onMoveCardToHand={moveCardToHand}
        onMoveBattlefieldCard={moveBattlefieldCard}
        onTapForMana={tapPermanentForMana}
        onChangeCounter={changeCounter}
        onActivateLoyalty={activateLoyaltyAbility}
        onCastCommander={castCommander}
        onResolveMyriadLandscape={resolveMyriadLandscape}
        onResolveBasicLandFetch={resolveBasicLandFetch}
        onActivateSacrificeAbility={activateGenericSacrificeAbility}
        onActivateTapAbility={activateGenericTapAbility}
        onActivateScriptedAbility={activateScriptedAbility}
        onActivateSelfUntap={activateSelfUntapAbility}
        onActivateGenericMana={activateGenericManaAbility}
        onActivateEquip={activateEquip}
        onActivateManlandAnimation={activateManlandAnimation}
        onChangeLife={changeLife}
        libraryLook={hostPrompts.libraryLook}
        ruleChoice={ruleChoiceView(hostPrompts.pendingRuleChoice, humanSeat, hostPrompts.manualLibrarySearch, session)}
        onAcceptMiracle={acceptMiracleOffer}
        onDeclineMiracle={declineMiracleOffer}
        onAcceptOptionalTrigger={acceptOptionalTrigger}
        onDeclineOptionalTrigger={declineOptionalTrigger}
        onAcceptCommanderZoneChoice={acceptCommanderZoneChoice}
        onDeclineCommanderZoneChoice={declineCommanderZoneChoice}
        onCompleteDiscardChoice={completeDiscardChoice}
        onCompletePutCardsOnLibrary={completePutCardsOnLibrary}
        onCompleteConniveDiscard={completeConniveDiscard}
        onCompleteReturnLandToHand={completeReturnLandToHand}
        onCompleteChoosePermanentToBlink={completeChoosePermanentToBlink}
        onChooseCreatureType={chooseCreatureTypeChoice}
        onChooseColor={chooseColorChoice}
        onConfirmAttackTriggerManaColors={confirmAttackTriggerManaColors}
        onChooseGraveyardReanimationTarget={chooseGraveyardReanimationTarget}
        onChooseSacrificeCostTarget={chooseSacrificeCostTarget}
        onChooseEachPlayerSacrifice={chooseEachPlayerSacrificeTarget}
        onChooseCreatureToSacrificeForCast={chooseCreatureToSacrificeForCast}
        onChooseModalOption={chooseModalOption}
        onChooseEffectTarget={chooseEffectTarget}
        onDeclineEffectTarget={declineEffectTarget}
        onConfirmProliferateTargets={chooseProliferateTargets}
        onChooseBattlefieldCreatureTarget={chooseBattlefieldCreatureTarget}
        onChooseAuraRetarget={chooseAuraRetarget}
        onChooseEquipTarget={confirmEquipTarget}
        myriadSearchCards={hostPrompts.myriadSearch ? getMyriadLandscapeOptions(humanSeat.library ?? []) : undefined}
        basicLandFetchSearch={
          hostPrompts.basicLandFetchSearch
            ? {
                sourceCardName: hostPrompts.basicLandFetchSearch.sourceCardName,
                cards: getBasicLandFetchOptions(humanSeat.library ?? [])
              }
            : undefined
        }
        onCloseLibrarySearch={() => closeLibrarySearch(humanSeat.id)}
        onChooseNextTrigger={chooseNextUpkeepTrigger}
        onSearchLibraryCardToHand={(cardId, destination) => searchOrChooseLibraryCard(humanSeat.id, cardId, destination)}
        onFinishLibrarySearch={finishRuleLibrarySearch}
        onCloseMyriadSearch={closeMyriadSearch}
        onCompleteMyriadSearch={completeMyriadLandscape}
        onCloseBasicLandFetchSearch={closeBasicLandFetchSearch}
        onCompleteBasicLandFetchSearch={completeBasicLandFetch}
        onKeepLibraryLookCardOnTop={keepLibraryLookCardOnTop}
        onOrderLibraryLookCardOnTop={orderLibraryLookCardOnTop}
        onPutLibraryLookCardOnBottom={putLibraryLookCardOnBottom}
        onPutLibraryLookCardInGraveyard={putLibraryLookCardInGraveyard}
        onSendLibraryLookCardToHand={sendLibraryLookCardToHand}
        onRepeatVaultLook={repeatLimDulVault}
        onKeepVaultLookCards={keepLimDulVaultCards}
        onCloseLibraryLook={closeLibraryLook}
        onSelectHandCard={(card) => setSelectedHandCardId((current) => (current === card.id ? undefined : card.id))}
        onToggleTapCard={toggleTapCard}
        onChooseMana={chooseManaColor}
        onCancelManaChoice={cancelManaChoice}
        onChooseMyriadTapMana={chooseMyriadLandscapeTapMana}
        onChooseMyriadTapSearch={chooseMyriadLandscapeSearch}
        onCancelMyriadTapChoice={cancelMyriadTapChoice}
        inspectedCard={inspectedCard}
        selectedCardId={selectedHandCardId}
        lockedRoomDoorFaceIndex={inspectedRoomLockedFaceIndex}
        onUnlockRoomDoor={unlockRoomDoor}
        humanAttackTargets={humanAttackTargets}
        onDeclareAttack={declareHumanAttack}
      />
    </main>
  );
}
