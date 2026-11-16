"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { AgentAction, AgentReasoning, CardImageUris, ColoredMana, CommanderDeck, GameEvent, GameSession, InterpretedEffect, ManaColor, ManaContribution, ManaPool, PlayerSeat, RestrictedManaBatch, VisibleCard } from "@/lib/types";
import { deserializeTurnCounters, isCleanSaveStop, SAVE_FORMAT_VERSION, serializeTurnCounters, type GameSnapshot } from "@/lib/saveGame";
import { deterministicRuleWorkflow, eventRelevantOracleText, type RuleWorkflow } from "@/lib/rulesAdvisor";
import { decideWithGate } from "@/lib/moveLegality";
import type { PrimitiveActionPlan, PrimitiveActionStep } from "@/lib/primitiveActionPlan";
import { evaluateOpeningHand } from "@/lib/mulliganHeuristics";
import { looksLikeAttackTaxCandidate } from "@/lib/staticEffects";
import { effectivePower } from "@/lib/counters";
import { parseGenericManaAbilities, parseGenericSacrificeAbilities, parseGenericTapAbilities, parseSearchLibraryEffectText } from "@/lib/activatedAbilities";
import { basicLandFetchCostRequiresTap, basicLandFetchManaCost, cardMatchesTypeFilter, cardsLeaveGraveyardEffectText, etbEffectText, isAttackTriggerAddManaClause, isBasicLandFetchAbility, isSagaTransformChapter, oracleClauses, parseAdditionalDiscardCost, parseAdditionalSacrificeCost, parseEmblemGrant, parseGainsAbilityGrant, parseModalHeader, parseSpellModalHeader, parseSagaChapters, type SagaChapters } from "@/lib/oracleClauses";
import { needsTokenArt, tokenArtLookupKey } from "@/lib/tokenArt";
import { parseSpellExtraEffects } from "@/lib/spellExtras";
import { restrictedBatchUsable, isDragonMana, addManaToPool, addPools, attackTriggerManaHeuristicSplit, cannotPayMessage, chooseManaSourcesForCost, effectiveManaOracleText, emptyManaPool, formatManaPoolPayment, isAvailableManaSource, isBoardConditionMet, isSacrificeManaSource, manaAbilityCounterRemovalKind, manaChoicesForCard, manaPoolTotal, manaProducedBy, payCostFromPool, selectedManaTotal, signetAbility, spendManaSources, spentManaColors, tapVisibleCard } from "@/engine/mana";
export { attackTriggerManaHeuristicSplit, isDragonMana, chooseManaSourcesForCost, costlyTapManaColors, isAvailableManaSource, isRecognizedBoardCondition, lifeGainedThisTurn, manaAmountFromAddClause, manaChoicesForCard, manaProducedBy, signetAbility, spendManaSources } from "@/engine/mana";
import { emblemSourceCards } from "@/engine/shared";
export { emblemAsShimCard } from "@/engine/shared";
import { hasHaste, hasKeyword, isLandCard, numberWordToInt } from "@/engine/shared";
export { isLandCard } from "@/engine/shared";
import { parseCreateTokenSpecs } from "@/engine/tokens";
export { agentBestCopyCandidate, parseCreateTokenSpecs } from "@/engine/tokens";
import { adjustedCastingCost, cardWithFaceManaCost, coloredPipCount, fateDesignLifeAltCostKey, findMiracleGranter, hasFateDesignLifeAltCost, hasOmniscienceFreeHandCast, hasOnceEachTurnFreeHandCastPermission, hasSingleKicker, isHistoricCard, manaValueFromManaCost, maxAffordableX, miracleCostFor, onceEachTurnFreeCastKey, parseMiracleCost, staticCostReduction, totalCastingCost, unlockCostReduction, xSymbolCount } from "@/engine/costs";
export { adjustedCastingCost, cardWithFaceManaCost, manaValueFromManaCost, maxAffordableX, miracleCostFor, staticCostReduction, totalCastingCost } from "@/engine/costs";
import { landDropsAllowed, landPlaysMade, landTurnKey, recordLandPlay } from "@/engine/lands";
export { entersBattlefieldTapped, landDropsAllowed, landPlaysMade, recordLandPlay, revealLandControlExempt, revealLandTypes, revealableLandCards } from "@/engine/lands";
import { applyCounterDelta, applyEntersWithCounterKind, applyEntersWithXCounters, applyLoreCounterEtb, applyPutCardsOnLibrary, colorsAmongPermanentsControlled, enterAsCopyCandidates, entersWithCounterPerColorControlled, entersWithFixedCounterKind, findExiledCardAnySeat, findPermanentById, isPlaneswalkerCard, loyaltyCounterCount, moveCardBetweenVisibleZones, moveCommanderToCommandZone, moveLibraryCard, parseEnterAsCopyEffect, possessive, putLookedAtCardsInGraveyard, reorderTopLibraryCards, rulesEvent, shuffleCards } from "@/engine/zones";
export { applyGraveyardExile, findEnterAsCopyTarget, moveCardBetweenVisibleZones, moveCommanderToCommandZone, parseEnterAsCopyEffect, putLookedAtCardsInGraveyard, shuffleCards } from "@/engine/zones";
export type { GraveyardReturnOptions } from "@/engine/zones";
import { graveyardCastPermission } from "@/lib/graveyardCasting";
import { libraryTopCastPermission } from "@/lib/libraryCasting";
import { summarizeSituation } from "@/lib/agentLessons";
import { parseTargetedEffect, targetedEffectSpec } from "@/lib/targetedEffects";
import { UNDERCITY_ROOM_NAMES, UNDERCITY_ROOM_TEXT, isUndercityRoom } from "@/lib/undercity";
import { parseCycling } from "@/lib/cycling";
import { annihilatorAmount } from "@/lib/keywords";
import { counterSpellCanTarget, parseCounterSpellAbility, parseDelayedUpkeepDraws } from "@/lib/counterSpells";
import { enchantRestriction, equipCost, isAura, isEquipment, isRemovalStyleAura } from "@/lib/attachments";
import { hasChooseCreatureTypeEtb, parseChooseColorEtb, permanentMatchesQualifier } from "@/lib/characteristics";
import { parseRemovalEffect, type RemovalEffect } from "@/lib/removalSpells";
import { abilityOracleText, hasCardType } from "@/lib/typeGrants";
import { parseZoneEffect, type ZoneEffect } from "@/lib/zoneEffects";
import { legalTargets, targetsStillLegal, type ChosenTarget, type TargetSpec } from "@/lib/targeting";
import { removalEffectTargetSpec, zoneEffectTargetSpec } from "@/lib/targetSpecs";
import { stopKey, TURN_PHASES } from "@/lib/priorityStops";
import { anyPhaseTrigger } from "@/lib/phaseTriggers";
import { activateSteelHellkiteX, applyGenericModalEffect, applyMassBounceEffect, applyMassPumpEffect, applyPrimitiveAction, applyRemovalEffect, applySimpleLifeChange, applySpellExtraEffect, applyTargetedPumpEffect, applyZoneEffect, castTargetLegal, chooseAgentLibraryCardForRuleChoice, chooseRemovalTarget, chooseWorstHandCardToDiscard, discardableHandCards, drawForSeat, drawMultipleForSeat, genericCostShim, genericManaAbilityCostShim, genericModalModeHasLegalTarget, matchesEachPlayerSacrificeFilter, matchesPermanentSacrificeFilter, matchesSacrificeFilter, noLegalTargetEvent, parseCounterAccumulationTrigger, parseGenericModalEffect, parseTargetedPump, putLookedAtCardsOnBottom, removalEffectHasLegalTarget, resolveAgentLibraryLookWorkflow, resolveDynamicAmount, resolveProliferate, substituteX, transformPermanent } from "@/engine/effects";
export { activateSteelHellkiteX, agentSurveilDecision, applyGenericModalEffect, applyMassBounceEffect, applyMassPumpEffect, applyMill, applyRemovalEffect, applyRevealTopExchange, applySimpleLifeChange, applySpellExtraEffect, applyTargetedPumpEffect, applyZoneEffect, castTargetLegal, chooseAgentLibraryCardForRuleChoice, drawForSeat, drawMultipleForSeat, genericCostShim, matchesPermanentSacrificeFilter, parseGenericModalEffect, parseTargetedPump, payWardIfNeeded, putLookedAtCardsOnBottom, resolveAgentLibraryLookWorkflow, resolveDeferredChoice, resolveSacrificeSelfThenSearch, resolveSearchLibraryPut, substituteX } from "@/engine/effects";
export type { PrimitiveAction } from "@/engine/effects";
import { applyEntersWithCounterReplacements, destroyCreatures, moveCardAcrossSeats, moveLibraryCardToDestination } from "@/engine/entry";
export { applyEntersWithCounterReplacements, applyGraveyardReturn, destroyCreatures, moveCardAcrossSeats, moveLibraryCardToDestination, returnLinkedExiles } from "@/engine/entry";
import { createTokensForSeat } from "@/engine/tokens";
export { createTokensForSeat } from "@/engine/tokens";
import { BRAIDS_TYPE_FILTER, applyDeterministicPhaseTrigger, applyDigToBattlefield, applyTargetedEffect, braidsDeclinePenalty, braidsOpponentIds, braidsRunOpponents, braidsSharedTypeFilter, commonTriggerEffect, echoCostText, enterUndercityRoom, findCommonTriggersForPermanentEntered, hasOnceEachTurnLimiter, isMerenEndStepEffect, makeCommonTrigger, payRedMana, phaseClauseConditionMet, phaseConditionBlocks, phaseEffectText, phaseEvent, resolveEcho, resolveTriggerEffect, takeInitiative, ventureIntoUndercity } from "@/engine/triggers";
export { BRAIDS_TYPE_FILTER, applyBraidsEndStep, applyDeterministicPhaseTrigger, applyDigToBattlefield, applyMerenEndStepEffect, applyTargetedEffect, braidsDeclinePenalty, braidsOpponentIds, braidsRunOpponents, braidsSharedTypeFilter, commonTriggerEffect, echoCostText, enterUndercityRoom, findCommonTriggersForPermanentEntered, phaseClauseConditionMet, phaseConditionBlocks, phaseEffectText, phaseEvent, resolveEcho, resolveTriggerEffect, takeInitiative, ventureIntoUndercity } from "@/engine/triggers";
import type { CastChoices, PendingAction, PendingRuleChoice, PendingTargetedEffect, TurnPhase } from "@/engine/types";
export type { CastChoices } from "@/engine/types";
import { checkStateBasedActions } from "@/engine/stateBased";
export { runStateBasedActionsPass, winTheGame } from "@/engine/stateBased";
import { hasHexproof, hasIndestructible, hasShroud } from "@/engine/damage";
export { addDamageShieldsFromSpec, applyCombatDamageToTarget } from "@/engine/damage";
import { ThreeGameTable, type StackFeedEntry } from "./ThreeGameTable";
import { usePriorityStopSettings } from "./hooks/usePriorityStopSettings";
import { useDeckLibrary } from "./hooks/useDeckLibrary";
import { useSavedGames } from "./hooks/useSavedGames";
import { SetupScreen } from "./SetupScreen";
import { GameOverDialog } from "./GameOverDialog";
import { AGENT_REQUEST_TIMEOUT_MS, MAX_SESSION_EVENTS, agentPaceMs, loadRuleWorkflowCacheOnce, logAdvisorUse, prewarmRuleWorkflowCache, primitiveActionPlanCache, ruleWorkflowCache, ruleWorkflowCacheKey, saveRuleWorkflowCache, stackBeatMs, warmUpAgentModel } from "@/lib/agentRuntime";
import { type BasicLandFetchSearchState, type BlockChoiceState, type LegalAgentAction, type LibraryLookMode, type LibraryLookState, type ManaChoiceState, type ManualLibrarySearchState, type MyriadSearchState, type MyriadTapChoiceState } from "@/engine/flowTypes";
import { applyDeckToSeat, createInitialConfigs, fallbackCommander, formatDeckList, inferColors, validateConfigsForPlay, type SeatConfig } from "@/components/DeckSetup";
import { animateEnchantmentSpec, applyEnchantmentAnimation, applyGenericAbilityEffect, applyGenericTapEffect, applySacrificeEffect, canTapForCost, chooseAnnihilatorSacrifices, chooseLandToReturn, choosePermanentToBlink, cycleCardInSession, parseGenericAbilityEffect, payGenericManaCost, payGenericSacrificeCost, payGenericTapCost, resolveEquip, resolveManlandAnimation, resolveSelfUntapAbility, seatVerb, tapCreaturesAltCostFor, zoneChoiceSpecFor } from "@/engine/abilities";
import { buildAgentDecisionContext, findSpellSourceCard, nextPrioritySeatId, pendingActionRequiredPasses, pendingActionSummary, resolutionPromptNote, shouldConsultRulesAdvisor, withPendingActionSourceCard } from "@/engine/priority";
import { checkMoveLegal, cumulativeUpkeepCost, fallbackLegalAction, formatLoyaltyCost, hasAgentMainPhaseAction, isCumulativeUpkeepCard, isPendingActionLikelyIrrelevantToSeat, legalMainPhaseActions, legalPriorityActions, loyaltyTurnKey, spellIsImmuneToCounters } from "@/engine/legalActions";
import { additionalSacrificeCandidates, applyChosenFaceToCard, applySpellDamagePrevention, canCastAtInstantSpeed, castFaceDecision, castRestrictedByTurnCount, chooseAdditionalCostSacrifice, chooseFreeCastCard, handCardFaceOptions, independentlyCastableSpellFaces, manaFromTappedOpponentLands, markHandCardFreeCastable, matchesAdditionalSacrificeType, modalDoubleFacedLandSplit, pathOfAncestryScries, payAdditionalDiscardCost, playCardFromZone, recordCommanderCast, roomDoorFaces, sacrificeForAdditionalCost, seatHasFlashGrant, spellCastLockedOut, spellFaceCostCard, spellResolutionDestination, targetingTax, unlockSecondRoomDoor } from "@/engine/casting";
import { applyMetalcraftAttackDebuff, assignBlockers, attackLockedOut, canAttack, cleanupCombat, clearCombatState, countCreaturesAttackingSeat, createCombatBlockChoice, forcedAttackers, hasVigilance, legalAttackActions, legalBlockActions, resolveAttackTarget, resolveCombatDamage, resolveHumanUnblockedDamage, totalAttackTax } from "@/engine/combat";
import { MODAL_DONE_INDEX, addEmblemToSeat, applyCastRevealUntilCreatures, applyChosenEachPlayerSacrifice, applyConniveDiscard, applyDigPick, applyEachPlayerSacrificeEffect, applyLivingDeathEffect, applyPrimitiveActionPlan, applyPunisherChoiceEffect, findEmblemGraveyardReturns, isBraidsEndStepText, isLivingDeathEffect, parseEachPlayerSacrificeEffect, parseEtbZoneEffect, parseMassBounceEffect, parseMassPump, parsePunisherChoiceEffect, parseSimpleDrawEffect, parseSimpleLifeChange, remainingLibraryTotalManaValue, searchableLibraryCards, surveilBonusForSeat } from "@/engine/oneShotEffects";
import { applyEndStepEffects, clearTemporaryBuffs, effectiveMaxHandSize, hasExtraBeginningPhaseAura, humanPhaseGraveyardChoice, isMainPhase, isReanimateFromAnyGraveyardPhaseTrigger, makePhaseStackTrigger, nextSeatForTurn, nextSeatId, phaseEventName, phaseTriggeredCards, planOffTurnPhaseTriggers, resolveEndStepExileDamage, resolvePendingUpkeepDraws, rollForStartingSeat, scheduleDelayedPhaseTrigger, targetCreatureCounterPhaseTrigger, untapForSeat } from "@/engine/turnFlow";
import { activateGraveyardReturnInSession, agentTargetedTriggerKinds, agentTriggerTarget, findAnyCombatDamageToOpponentTriggers, findAttackTriggers, findBreenaAttackTriggers, findCardsLeftGraveyardTriggers, findCastTriggers, findCombatDamageToPlayerTriggers, findCommonTriggersForPermanentDied, findEntersBatchWatcherTriggers, findLandRaidTriggers, findLeavesBattlefieldTriggers, findLifeGainTriggers, findMultiAttackTriggers, findPutIntoGraveyardTriggers, findSacrificeWatcherTriggers, grantKeywordsToCreature, hasSorcerySpeedOnlyLimiter, lifeGainReplacementBonus, parseMetalcraftAttackDebuff, triggerDamageAiming } from "@/engine/triggerFinders";
import { chooseReadAheadChapter, applyAuraAttachToPlayer, applyAuraAttachment, applyChosenColor, applyChosenCreatureType, chooseAuraAttachTarget, chooseBestBasicLandPairForMyriad, entersWithChargeCounterPerKick, entersWithXCounters, exploreCount, getBasicLandFetchOptions, getMyriadLandscapeOptions, grantsExtraTurn, handCardsOfTypes, isSagaCard, loreCounterCount, resolveBasicLandFetchSearch, resolveExplore, resolveMyriadLandscapeSearch, type AuraAttachResult } from "@/engine/etb";
import { agentCastTimeRemovalChoices, applyCastGenericModes, applyCastRemoval, applyLabeledContinuation, castFaceCard, castModeLabels, castStructure, describeRemovalMode, discardOptions, encodeChosenTarget, findCardAnywhere, hasResolvableTarget, labeledTargetOptions, nextCastPrompt, sacrificeOptions, spellModePrompt, spellTargetSlots, stackTargetText, steelHellkiteXOptions } from "@/engine/castTargets";
import { useStackState } from "@/components/hooks/useStackState";
import { MULLIGAN_HARD_CAP, MULLIGAN_SOFT_CAP, addLibraryLookEvent, agentKeepsHand, isLimDulsVault, keepOpeningHandSize, openingHandBattlefieldCards, openingHandKeepSize, putOpeningHandCardOnBattlefield, resolveAgentLimDulVault, withOpeningHand } from "@/engine/mulligan";
import { blockChoiceView, ruleChoiceLabel, ruleChoiceView } from "@/components/viewModels";
export type { LegalAgentAction } from "@/engine/flowTypes";
export { resolvePendingUpkeepDraws, untapForSeat, clearTemporaryBuffs, resolveEndStepExileDamage, hasPhaseTrigger, humanPhaseGraveyardChoice, applyEndStepEffects, makePhaseStackTrigger, planOffTurnPhaseTriggers, scheduleDelayedPhaseTrigger, rollForStartingSeat } from "@/engine/turnFlow";
export { applyExalted, resolveCombatDamage, cleanupCombat, assignBlockers, attackLockedOut, creatureCantBlock, hasVigilance, resolveAttackTarget, countCreaturesAttackingSeat, legalAttackActions, legalBlockActions, forcedAttackers, totalAttackTax } from "@/engine/combat";
export { validateConfigsForPlay, applyDeckToSeat } from "@/components/DeckSetup";
export { animateEnchantmentSpec, resolveEquip, payGenericSacrificeCost, applySacrificeEffect, payGenericTapCost, parseGenericAbilityEffect, applyGenericAbilityEffect, payGenericManaCost, applyGenericTapEffect, cycleCardInSession, tapCreaturesAltCostFor } from "@/engine/abilities";
export { grantsExtraTurn, basicLandFetchBeholdType, resolveBasicLandFetchSearch, chooseBestBasicLandPairForMyriad, applySagaEntryLoreCounterHeadless, advanceSagaLoreCountersHeadless } from "@/engine/etb";
export { legalMainPhaseActions, legalPriorityActions, checkMoveLegal, UNTAP_LANDS_SAFE_LIFE, untapAllLandsIsWorthIt, graveyardHateOnStack, graveyardShuffleIsWorthIt } from "@/engine/legalActions";
export type { MoveCheckContext } from "@/engine/legalActions";
export { recordCommanderCast, applySpellDamagePrevention, spellCastLockedOut, manaFromTappedOpponentLands, payAdditionalDiscardCost, sacrificeForAdditionalCost, additionalSacrificeCandidates, chooseAdditionalCostSacrifice, pathOfAncestryScries, chooseFreeCastCard, markHandCardFreeCastable, spellResolutionDestination, modalDoubleFacedLandSplit, roomDoorFaces, independentlyCastableSpellFaces, isSplitSpellCard, spellFaceCastableFromHand, spellFaceCostCard, castFaceOptions, castFaceDecision, handCardFaceOptions, targetingTax, seatHasFlashGrant, playCardFromZone } from "@/engine/casting";
export type { CastFaceOption, CastFaceDecision, HandCardFaceOption } from "@/engine/casting";
export { spellModePrompt, labeledTargetOptions, castStructure, nextCastPrompt, stackTargetText, agentCastTimeRemovalChoices, castModeLabels, applyCastRemoval, applyCastGenericModes, spellTargetSlots, applyLabeledContinuation, steelHellkiteXOptions, hasResolvableRemovalTarget, AGENT_UNSUPPORTED_SPELL_TEXT, hasResolvableTarget } from "@/engine/castTargets";
export { parseEtbZoneEffect, parseSimpleLifeChange, parseSimpleDrawEffect, parseMassPump, parseMassBounceEffect, hideawayDamageConditionMet, applyDigPick, searchableLibraryCards, remainingLibraryTotalManaValue, addEmblemToSeat, parseSearchLibraryPutEffect, parseEmblemReturnWatchers, findEmblemGraveyardReturns, parseEachPlayerSacrificeEffect, applyEachPlayerSacrificeEffect, applyChosenEachPlayerSacrifice, isBraidsEndStepText, parsePunisherChoiceEffect, applyPunisherChoiceEffect, isLivingDeathEffect, applyLivingDeathEffect, applyCastRevealUntilCreatures } from "@/engine/oneShotEffects";
export type { EmblemReturnWatcher } from "@/engine/oneShotEffects";
export { findEntersBatchWatcherTriggers, isArchaeomancersMapLandRaidTrigger, findLandRaidTriggers, findSacrificeWatcherTriggers, findPutIntoGraveyardTriggers, findCommonTriggersForPermanentDied, findLeavesBattlefieldTriggers, grantKeywordsToCreature, findLifeGainTriggers, lifeGainReplacementBonus, findMultiAttackTriggers, findAttackTriggers, findCombatDamageToPlayerTriggers, parseAnyCreatureCombatDamageToOpponentTrigger, findAnyCombatDamageToOpponentTriggers, parseBreenaAttackTrigger, findBreenaAttackTriggers, findCardsLeftGraveyardTriggers, findCastTriggers, activateGraveyardReturnInSession } from "@/engine/triggerFinders";
export { shouldConsultRulesAdvisor, pendingActionRequiredPasses, pendingActionWillPromptSeat, resolutionPromptNote, canReceivePriorityForPendingAction } from "@/engine/priority";
export { openingHandBattlefieldCards, putOpeningHandCardOnBattlefield, resolveAgentMulligans, withOpeningHand, makeShuffledLibrary, expandDeckCards, resolveAgentLimDulVault } from "@/engine/mulligan";

type FlowMode = "setup" | "game";
type GameStage = "mulligan" | "playing";

interface OllamaStatus {
  ok: boolean;
  message: string;
  models?: string[];
}

export function AppFlow({ initialSession, ollama }: { initialSession: GameSession; ollama: OllamaStatus }) {
  const [mode, setMode] = useState<FlowMode>("setup");
  const [session, rawSetSession] = useState(() => checkStateBasedActions(initialSession));
  // Every session update is routed through here so state-based actions (rule 704) are checked
  // after every single change, instead of relying on scattered call sites to remember to do it.
  const setSession = useCallback((update: GameSession | ((prev: GameSession) => GameSession)) => {
    rawSetSession((current) => {
      const next = checkStateBasedActions(typeof update === "function" ? update(current) : update);
      // The event log is prepended to on every action and never trimmed; copying/filtering an ever-growing array on each update gets
      // slower all game. Newest events come first, so dropping the tail only loses the oldest history.
      return next.events.length > MAX_SESSION_EVENTS ? { ...next, events: next.events.slice(0, MAX_SESSION_EVENTS) } : next;
    });
  }, []);
  // One-time load of whatever rule-workflow classifications persisted from earlier sessions —
  // localStorage isn't available during SSR, so this has to happen client-side on mount rather than
  // at module init time.
  useEffect(() => {
    loadRuleWorkflowCacheOnce();
  }, []);
  const stackStore = useStackState({ activeSeatId: initialSession.activePlayerId ?? initialSession.seats[1]?.id, prioritySeatId: initialSession.activePlayerId ?? initialSession.seats[1]?.id });
  const { replaceStack: replaceStackActions, push: pushStackAction, update: updateStackAction, remove: removeStackAction, setPending: setPendingAction, setPasses: setPriorityPasses, setPrioritySeatId, setActiveSeatId } = stackStore;
  const activeSeatId = stackStore.state.activeSeatId as string; // was useState<string>; keeps read sites' types
  // Stable identity for the table's session prop: a fresh `{ ...session }` on every render made everything inside the table that
  // depends on `props.session` recompute on unrelated re-renders (hover, thinking text, timers).
  const tableSession = useMemo(() => (session.activePlayerId === activeSeatId ? session : { ...session, activePlayerId: activeSeatId }), [session, activeSeatId]);
  const [selectedHandCardId, setSelectedHandCardId] = useState<string | undefined>();
  const [inspectedCard, setInspectedCard] = useState<VisibleCard | undefined>();
  const [gameStage, setGameStage] = useState<GameStage>("mulligan");
  const [gameOverDismissed, setGameOverDismissed] = useState(false);
  const [mulligans, setMulligans] = useState<Record<string, number>>({});
  const [keptHands, setKeptHands] = useState<Record<string, boolean>>({});
  const [mulliganReturnCardIds, setMulliganReturnCardIds] = useState<string[]>([]);
  const [libraryLook, setLibraryLook] = useState<LibraryLookState | undefined>();
  const [manualLibrarySearch, setManualLibrarySearch] = useState<ManualLibrarySearchState | undefined>();
  const [pendingRuleChoice, setPendingRuleChoice] = useState<PendingRuleChoice | undefined>();
  const [blockChoice, setBlockChoice] = useState<BlockChoiceState | undefined>();
  const [selectedBlockerIds, setSelectedBlockerIds] = useState<string[]>([]);
  const [myriadSearch, setMyriadSearch] = useState<MyriadSearchState | undefined>();
  const [myriadTapChoice, setMyriadTapChoice] = useState<MyriadTapChoiceState | undefined>();
  const [basicLandFetchSearch, setBasicLandFetchSearch] = useState<BasicLandFetchSearchState | undefined>();
  const stackActions = stackStore.state.stack;
  const pendingAction = stackStore.state.pending;
  const priorityPasses = stackStore.state.passes;
  const prioritySeatId = stackStore.state.prioritySeatId as string; // was useState<string> (always set); keeps read sites' types
  // Always-current views of state for the legality gate: an agent decision awaits an LLM call, so the render-time `session` captured by its closure can be
  // stale by the time the answer arrives. The gate re-validates the proposal against these, never against the stale closure.
  const latestSessionRef = useRef(session);
  latestSessionRef.current = session;
  const { priorityStopSettings, updatePriorityStopSettings } = usePriorityStopSettings();
  // One-shot "stop me on the very next priority window" flag (the "Stop Next" button) — deliberately
  // session-only (not persisted): armed by a click, consumed the next time beginPendingAction or
  // resumeStackAction opens/reopens a window at all, regardless of whether that window ends up
  // actually including the human in requiredPasses.
  const [holdPriorityOnce, setHoldPriorityOnce] = useState(false);
  const [manaPools, setManaPools] = useState<Record<string, ManaPool>>({});
  // Sunken Palace: how many of a seat's floating {U} are "copy" mana (the spell they pay for is copied). Emptied with the pool.
  const [copyMana, setCopyMana] = useState<Record<string, number>>({});
  const [manaContributions, setManaContributions] = useState<Record<string, ManaContribution[]>>({});
  const [restrictedManaBatches, setRestrictedManaBatches] = useState<Record<string, RestrictedManaBatch[]>>({});
  const [manaChoice, setManaChoice] = useState<ManaChoiceState | undefined>();
  // The human tucked the open choice box away ("Minimize") to look at the board. The choice itself stays pending; while this is set the
  // human's own game actions (cast, activate, pass) are refused with a message — see humanActionBlockedByChoice — except tapping lands.
  const [choiceMinimized, setChoiceMinimized] = useState(false);
  const [setupMessage, setSetupMessage] = useState<string | undefined>();
  const { configs, setConfigs, deckLibrary, defaultDecksApplied } = useDeckLibrary(initialSession.seats);
  const { savedGames, setSavedGames } = useSavedGames(mode);
  // startGame is async (it awaits an Ollama mulligan decision per agent seat, which can take
  // several seconds each) with nothing else gating re-entry — playBlockedByBuild only reflects
  // per-seat deck-build status, not "a game is currently being started." Without this, clicking
  // PLAY more than once before the first call resolves fired multiple full startGame() runs
  // concurrently, each eventually calling setSession with its own independently-drawn opening
  // hands; whichever resolved last silently clobbered the others' session state. Reported live as
  // a freshly started game's action log suddenly containing a second "Created a 4-player Commander
  // session..." entry and every hand changing out from under the player mid-mulligan.
  const [gameStarting, setGameStarting] = useState(false);
  // Count of consultRulesAdvisor calls currently awaiting their fetch (0 = none in flight). This is
  // the general fix for a whole class of "trigger sometimes silently does nothing" bugs: the phase-
  // advance timers below have always correctly waited on pendingAction/pendingRuleChoice/etc, but
  // consultRulesAdvisor is a fire-and-forget async call that doesn't set any of those while its fetch
  // is in flight — so a phase whose only trigger resolves purely through the Rules Advisor (rather
  // than opening a pendingRuleChoice, like order_triggers/manual_review do) had nothing stopping the
  // "nothing to do this phase, advance after 1100ms" timer from firing first and skipping straight
  // past it, win or lose depending on how fast that particular round trip happened to be. Scry/
  // surveil phase triggers were fixed by routing them around this fetch entirely (resolvePhaseScryOrSurveil),
  // but that only helps the shapes this engine's deterministic layer already recognizes — anything
  // that has to fall through to the Rules Advisor for a real answer is still exposed to this race.
  // Needs to be real state (not a ref) so clearing it triggers the re-render that lets the guarded
  // effects re-evaluate once the in-flight consult resolves.
  const [rulesAdvisorPending, setRulesAdvisorPending] = useState(0);
  const autoValidatedDefaultDeck = useRef(false);
  const agentMainActions = useRef<Set<string>>(new Set());
  const agentDecisionRequests = useRef<Set<string>>(new Set());
  // Render-visible counterparts to agentDecisionRequests (which is a ref and intentionally never
  // triggers a re-render, since it exists purely as a scheduling de-dupe guard). agentThinking
  // drives the "thinking" pulse on the HUD badge; agentReasoning holds each seat's most recent
  // decision so the badge stays clickable after the fact. Keyed by seat.id.
  const [agentThinking, setAgentThinking] = useState<Record<string, boolean>>({});
  const [agentReasoning, setAgentReasoning] = useState<Record<string, AgentReasoning>>({});
  // A one-shot relay baton for an agent's stated short-term plan (AgentAction.manaPlan, e.g. "holding
  // up 2 mana for a counterspell") — not UI-facing, so a ref like landPlaysThisTurn/spellsCastThisTurn
  // below rather than useState. requestAgentDecision reads and clears a seat's entry right before its
  // next real decision (surfacing it exactly once as context.previousStatedPlan), then re-populates it
  // from that decision's own manaPlan if the agent restates one — see requestAgentDecision for why a
  // forced single-legal-action step must not touch this.
  const agentStatedPlans = useRef<Record<string, string>>({});
  const landPlaysThisTurn = useRef<Set<string>>(new Set());
  // How many spells each seat has cast this turn (key: "${turn}:${seatId}") — feeds the "their
  // first spell each turn" condition cast-triggers can have (Mind's Dilation, ...); never cleaned
  // up between turns since old turns' keys are harmless clutter, same as landPlaysThisTurn.
  const spellsCastThisTurn = useRef<Map<string, number>>(new Map());
  const firstDrawThisTurn = useRef<Set<string>>(new Set());
  const loyaltyActivationsThisTurn = useRef<Set<string>>(new Set());
  // Ids of the permanents whose floating mana paid for the spell being cast right now (Path of Ancestry's scry needs to know).
  const lastCastManaContributors = useRef<string[]>([]);
  const phaseTriggersChecked = useRef<Set<string>>(new Set());
  const cleanupDiscardChecked = useRef<Set<string>>(new Set());
  // Klauth, Unrivaled Ancient's restricted mana batch is only ever created during its own seat's
  // combat, so the next time that same seat reaches ITS OWN cleanup step is always the end of the
  // exact turn it was created on — no need to track which turn a batch came from separately.
  const cleanupRestrictedManaChecked = useRef<Set<string>>(new Set());
  // Set by endTurn() when the "End Turn" shortcut finds the seat over its max hand size — that
  // shortcut jumps straight past the cleanup step (where the discard normally happens, via the
  // cleanupDiscardChecked effect below) to the next player's untap step, so without this the
  // discard requirement (rule 514.1) never gets a chance to fire and a human could keep an
  // unlimited hand just by always ending their turn early instead of stepping through phases.
  // Cleared once the discard resolves and the turn is actually allowed to end.
  const pendingEndTurnAfterDiscard = useRef<string | undefined>(undefined);
  // When resolveOrderedPhaseTriggers (multiple simultaneous phase triggers, ordered by the
  // controller) hits one that needs its own interactive choice — cumulative upkeep pay/sacrifice,
  // a real graveyard/battlefield target, or a scry/surveil window — it can only open ONE
  // pendingRuleChoice/libraryLook at a time, so it stops there and stashes whatever triggers were
  // still left in the chosen order here. Reproduced live as a seat with Debtors' Knell, Virtue of
  // Persistence, and Aminatou, Veil Piercer all triggering the same upkeep only ever getting asked
  // Aminatou's surveil choice — the two reanimation triggers were silently dropped (or auto-picked
  // by the deterministic heuristic with no prompt at all) the moment the loop hit the first
  // interactive one and returned. Every completion handler for those interactive choices calls
  // resumePendingOrderedTriggers() once it's done, which continues this queue instead of just
  // stopping after the first entry.
  const pendingOrderedTriggerResume = useRef<
    { seatId: string; triggers: Extract<PendingRuleChoice, { kind: "order_triggers" }>["triggers"]; stacked?: Array<Extract<PendingAction, { type: "trigger" }>> } | undefined
  >(undefined);
  // Reentrancy guard for playCard's non-land ("cast a spell") branch. playCard's own top-of-function
  // guard (`if (pendingAction) return`) reads pendingAction from React state, which two synchronous
  // calls to playCard in the same tick both see as whatever it was as of the LAST commit — neither
  // call can see the other's in-flight dispatch, since setPendingAction/pushStackAction's effects on
  // component state don't land until React actually re-renders. beginPendingAction, called from
  // inside playCard, both increments spellsCastThisTurn (a ref, so this second call sees a fresh
  // castOrdinal) and independently re-scans/re-queues every "whenever you cast..." trigger on the
  // board (findCastTriggers) — so a same-tick duplicate dispatch queues that scan twice, with two
  // real trigger actions landing on the stack from one actual cast. This ref is set the instant a
  // cast is dispatched and cleared on a fresh macrotask (after React has had a chance to commit and
  // make the real pendingAction guard effective again), closing that window without changing
  // behavior for any two casts that aren't literally dispatched in the same tick. Reproduced live as
  // Beast Whisperer and Guardian Project each drawing/triggering twice for a single creature cast.
  // Timestamp (not a plain boolean) so the guard below can self-heal if the macrotask reset is ever
  // dropped — e.g. a backgrounded/throttled tab delaying window.setTimeout(fn, 0) far longer than
  // intended. A boolean stuck true has no recovery path: every future playCard call silently no-ops
  // forever (the guard below returns before ever calling addEvent), which is indistinguishable from
  // "this card doesn't work" with zero diagnostic trail. Reported live as Kodama's Reach appearing to
  // do nothing when cast — traced to this exact guard, not anything about the card itself.
  const castDispatchInFlight = useRef<number | null>(null);
  const CAST_DISPATCH_STALE_MS = 500;
  const processedDeathBatchRef = useRef<GameSession["pendingDeaths"]>(undefined);
  const processedEntryBatchRef = useRef<GameSession["pendingEntries"]>(undefined);
  const processedLeaveBatchRef = useRef<GameSession["pendingLeaves"]>(undefined);
  const processedCombatDamageToPlayerBatchRef = useRef<GameSession["pendingCombatDamageToPlayer"]>(undefined);
  const processedGraveyardDepartureBatchRef = useRef<GameSession["pendingGraveyardDepartures"]>(undefined);
  // Card ids already offered (or auto-resolved) the "move to the command zone instead?" choice —
  // a commander that's declined the move (or an agent's auto-accepted one) stays in the graveyard
  // still flagged commander: true, so without this the detection effect below would re-offer the
  // exact same card every single render.
  const commanderZoneChoiceAsked = useRef<Set<string>>(new Set());
  // Aura card ids already offered (or that never qualified for) the post-resolution retarget
  // choice below — an Aura stays attached (attachedToId set) for its whole time on the battlefield,
  // so without this the detection effect would re-offer the same already-resolved Aura forever.
  const auraRetargetAsked = useRef<Set<string>>(new Set());
  // The resolving beat (see resolvePendingAction): ids already waiting out their beat (so a second trigger of the same resolution is a no-op),
  // the newest closure of the real resolver (the beat callback must not run a stale one), and the recent-resolutions feed the table shows.
  const resolveBeatIds = useRef<Set<string>>(new Set());
  const resolveNowRef = useRef<(action: PendingAction) => void>(() => undefined);
  // Activated abilities waiting on the stack: the effect closure per stack item (see putAbilityOnStack), and the newest closures of the
  // functions those effects call (so an effect that resolves later never runs against a stale view of the game).
  const abilityResolvers = useRef<Map<string, () => void>>(new Map());
  const abilityApiRef = useRef<{
    resolveSacrificeAbilityEffect: (seatId: string, paid: NonNullable<ReturnType<typeof payGenericSacrificeCost>>) => void;
    resolveTapAbilityEffect: (seatId: string, cardId: string, paid: NonNullable<ReturnType<typeof payGenericTapCost>>, chosenCardId?: string) => void;
  }>({ resolveSacrificeAbilityEffect: () => undefined, resolveTapAbilityEffect: () => undefined });
  const [stackFeed, setStackFeed] = useState<StackFeedEntry[]>([]);
  const humanSeat = session.seats.find((seat) => seat.kind === "human") ?? session.seats[0];
  const selectedHandCard = selectedHandCardId ? humanSeat.board.hand.find((card) => card.id === selectedHandCardId) : undefined;
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
    const counterTargetCard = findSpellSourceCard(session, pendingAction);
    return (
      counterTargetCard !== undefined &&
      !spellIsImmuneToCounters(session, counterTargetCard, pendingAction.actorSeatId) &&
      counterSpellCanTarget(counterAbility, counterTargetCard.typeLine, pendingAction.sourceZone === "command")
    );
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
    const ready = configs.filter((config) => config.deck?.validation.legal).length;
    return `${ready}/${configs.length} decks ready`;
  }, [configs]);

  function updateConfig(seatId: string, patch: Partial<SeatConfig>) {
    setConfigs((current) => current.map((config) => (config.seatId === seatId ? { ...config, ...patch } : config)));
  }

  function resumeTopStackAction(stack: PendingAction[]) {
    const nextAction = stack[stack.length - 1];
    if (nextAction) {
      window.setTimeout(() => resumeStackAction(nextAction), 0);
      return true;
    }
    return false;
  }

  function poolForSeat(seatId: string) {
    return manaPools[seatId] ?? emptyManaPool();
  }

  function setSeatManaPool(seatId: string, pool: ManaPool) {
    setManaPools((current) => ({ ...current, [seatId]: pool }));
  }

  function clearManaPool(seatId: string) {
    // "You don't lose unspent red mana as steps and phases end." (Leyline Tyrant) — the red stays; everything else empties.
    const keepsRed = session.seats.find((seat) => seat.id === seatId)?.board.battlefield.some((card) => !card.abilitiesStripped && /you don'?t lose unspent red mana as steps and phases end/i.test(card.oracleText));
    setSeatManaPool(seatId, keepsRed ? { ...emptyManaPool(), R: poolForSeat(seatId).R } : emptyManaPool());
    setManaContributions((current) => ({ ...current, [seatId]: [] }));
    setCopyMana((current) => (current[seatId] ? { ...current, [seatId]: 0 } : current));
  }

  // Rule 500.4: a step or phase ending empties every player's mana pool, not just the active
  // player's — mana floated by a non-active seat (e.g. holding up an instant during an opponent's
  // end step) is just as unused once that window closes. clearManaPool's callers used to only
  // target the active seat, so a responder's floating mana silently survived phase changes forever.
  function clearAllManaPools(seats: PlayerSeat[]) {
    for (const seat of seats) clearManaPool(seat.id);
  }

  function clearManaContributions(seatId: string) {
    setManaContributions((current) => ({ ...current, [seatId]: [] }));
  }

  function restrictedManaPoolForSeat(seatId: string, forCard?: VisibleCard): ManaPool {
    const batches = (restrictedManaBatches[seatId] ?? []).filter((batch) => restrictedBatchUsable(batch, forCard));
    return batches.reduce((pool, batch) => addPools(pool, batch.remaining), emptyManaPool());
  }

  // Drains `spent` out of a seat's restricted-mana batches, oldest batch first, dropping any batch
  // that's fully drained. `spent` is always <= restrictedManaPoolForSeat's own total per color (only
  // ever called right after a successful payCostFromPool against that exact pool), so this never
  // needs to handle an over-drain.
  function spendRestrictedMana(seatId: string, spent: ManaPool, forCard?: VisibleCard) {
    setRestrictedManaBatches((current) => {
      const batches = current[seatId] ?? [];
      const remainingSpend = { ...spent };
      const nextBatches: RestrictedManaBatch[] = [];
      for (const batch of batches) {
        if (!restrictedBatchUsable(batch, forCard)) {
          nextBatches.push(batch);
          continue;
        }
        const nextRemaining = { ...batch.remaining };
        for (const color of Object.keys(nextRemaining) as ManaColor[]) {
          const take = Math.min(nextRemaining[color], remainingSpend[color]);
          nextRemaining[color] -= take;
          remainingSpend[color] -= take;
        }
        if (manaPoolTotal(nextRemaining) > 0) nextBatches.push({ ...batch, remaining: nextRemaining });
      }
      return { ...current, [seatId]: nextBatches };
    });
  }

  function addRestrictedManaBatch(seatId: string, sourceCardName: string, amounts: ManaPool, spellType?: string) {
    if (manaPoolTotal(amounts) <= 0) return;
    setRestrictedManaBatches((current) => ({
      ...current,
      [seatId]: [...(current[seatId] ?? []), { id: crypto.randomUUID(), sourceCardName, remaining: amounts, restriction: "cast_spells_only", ...(spellType ? { spellType } : {}) }]
    }));
  }

  // "Until end of turn" — cleared only at the cleanup step of the turn the batch was created, never
  // by clearAllManaPools (which this deliberately never touches, so it survives every phase/step
  // change on its own, unlike a normal mana pool).
  function clearRestrictedManaForSeat(seatId: string) {
    setRestrictedManaBatches((current) => (current[seatId]?.length ? { ...current, [seatId]: [] } : current));
  }

  // Tries a seat's restricted mana (Klauth's floating batch, if any) before falling back to the
  // normal pool-then-auto-tap payment every other cost uses — restricted mana can pay for CASTING A
  // SPELL only (never an activated ability's cost; see this function's own call sites, all three of
  // which are genuine spell casts). Scoped to full coverage: if the restricted pool alone can't cover
  // the whole cost, this simply doesn't use any of it (falling through to the normal payment for the
  // FULL cost) rather than partially blending restricted mana with freshly-tapped sources for the
  // remainder — a deliberate simplification (never a rules violation: choosing not to spend
  // available floating mana is always legal, rule 106.4) that keeps this from having to reconstruct
  // a partially-reduced cost's own colored-pip requirements.
  function payCastingCost(seatId: string, seat: PlayerSeat, costCard: VisibleCard, totalCost: number) {
    const restricted = restrictedManaPoolForSeat(seatId, costCard);
    if (manaPoolTotal(restricted) > 0) {
      const restrictedResult = payCostFromPool(restricted, costCard, totalCost);
      if (restrictedResult.ok) {
        return { ok: true as const, source: "restricted" as const, sourceIds: [] as string[], pool: undefined, spent: restrictedResult.spent, forCard: costCard };
      }
    }
    if (seat.kind === "human") {
      const result = payCostFromPool(poolForSeat(seatId), costCard, totalCost);
      return result.ok
        ? { ok: true as const, source: "pool" as const, sourceIds: [] as string[], pool: result.pool, spent: result.spent }
        : { ok: false as const, sourceIds: [] as string[], reason: result.reason };
    }
    const result = chooseManaSourcesForCost(seat, costCard, totalCost, undefined, session.seats);
    return result.ok
      ? { ok: true as const, source: "tapped" as const, sourceIds: result.sourceIds, pool: undefined, spent: result.spent }
      : { ok: false as const, sourceIds: result.sourceIds, reason: result.reason };
  }

  // Applies whichever side effect payCastingCost's successful result actually needs — draining the
  // restricted batch, updating the human's floating pool, or (for "tapped") nothing here at all,
  // since spendManaSources against payment.sourceIds already happens at each call site's own
  // existing post-payment step.
  function applyCastingCostPaymentSideEffect(seatId: string, payment: ReturnType<typeof payCastingCost>) {
    lastCastManaContributors.current = payment.ok && payment.source === "pool" ? (manaContributions[seatId] ?? []).map((item) => item.cardId) : [];
    if (!payment.ok) return;
    if (payment.source === "restricted") {
      spendRestrictedMana(seatId, payment.spent, "forCard" in payment ? payment.forCard : undefined);
    } else if (payment.source === "pool" && payment.pool) {
      setSeatManaPool(seatId, payment.pool);
      clearManaContributions(seatId);
    }
  }

  function addManaContribution(seatId: string, cardId: string, color: ManaColor, amount: number) {
    setManaContributions((current) => ({
      ...current,
      [seatId]: [...(current[seatId] ?? []).filter((item) => item.cardId !== cardId), { cardId, color, amount }]
    }));
  }

  function removeManaContribution(seatId: string, cardId: string) {
    const contribution = manaContributions[seatId]?.find((item) => item.cardId === cardId);
    if (!contribution) return;
    setManaPools((current) => {
      const pool = current[seatId] ?? emptyManaPool();
      return {
        ...current,
        [seatId]: {
          ...pool,
          [contribution.color]: Math.max(0, pool[contribution.color] - contribution.amount)
        }
      };
    });
    setManaContributions((current) => ({ ...current, [seatId]: (current[seatId] ?? []).filter((item) => item.cardId !== cardId) }));
  }

  function addFloatingMana(seatId: string, color: ManaColor) {
    const seat = session.seats.find((item) => item.id === seatId);
    setSeatManaPool(seatId, addManaToPool(poolForSeat(seatId), color, color === "C" ? 1 : 1));
    addEvent(`${seat?.name ?? "Player"} adds ${color} to their mana pool.`, seatId, "Mana");
  }

  // TEMP DEBUG (remove before finishing): tracking down a reported "Veyra's turn gets skipped
  // entirely" bug — logs every activeSeatId/session.activePlayerId change plus each seat's hasLost
  // state, so a live capture can show whether activePlayerId ever desyncs from activeSeatId or
  // whether Veyra's seat gets hasLost:true incorrectly.
  useEffect(() => {
    const w = window as unknown as { __mtgTurnTrace?: unknown[] };
    w.__mtgTurnTrace = w.__mtgTurnTrace ?? [];
    (w.__mtgTurnTrace as unknown[]).push({
      at: Date.now(),
      turn: session.turn,
      phase: session.phase,
      activeSeatId,
      sessionActivePlayerId: session.activePlayerId,
      seats: session.seats.map((seat) => ({ id: seat.id, name: seat.name, hasLost: Boolean(seat.hasLost), lossReason: seat.lossReason, life: seat.life }))
    });
    // Diagnostic only; keep the most recent entries so a long game doesn't grow it forever.
    if ((w.__mtgTurnTrace as unknown[]).length > 300) (w.__mtgTurnTrace as unknown[]).splice(0, (w.__mtgTurnTrace as unknown[]).length - 300);
  }, [activeSeatId, session.activePlayerId, session.turn, session.phase, session.seats]);

  useEffect(() => {
    if (autoValidatedDefaultDeck.current) return;
    const pending = configs.filter((config) => config.mode === "decklist" && config.deckList.trim() && !config.deck);
    if (pending.length === 0) return;
    autoValidatedDefaultDeck.current = true;
    pending.forEach((config) => void buildDeck(config));
  }, [configs]);

  // Emblem "whenever ... is put into your graveyard from the battlefield / dies, return it at the beginning of the next end step" (Daretti, Scrap
  // Savant; Liliana, Heretical Healer): watched by comparing each committed session with the previous one, so every way a permanent can reach a
  // graveyard (combat, destroy, sacrifice, state-based actions) is covered without touching each path. The trigger is one-shot and records the card.
  const emblemWatchPrevious = useRef(session);
  useEffect(() => {
    const previous = emblemWatchPrevious.current;
    emblemWatchPrevious.current = session;
    if (previous === session || session.seats.every((seat) => (seat.emblems?.length ?? 0) === 0)) return;
    const earned = findEmblemGraveyardReturns(previous, session);
    if (earned.length === 0) return;
    setSession((current) => earned.reduce((next, trigger) => scheduleDelayedPhaseTrigger(next, trigger), current));
  }, [session]);

  // destroyCreatures() is a pure session transformer with no access to queueCommonTriggers (that
  // lives in this component's closure), so it stashes what died onto session.pendingDeaths instead
  // — this effect is the single place that drains it and queues "whenever a creature dies"
  // triggers, so every death path (combat, removal spells, sacrifice, state-based 0-toughness)
  // fires death triggers the same way instead of each call site having to remember to do it.
  useEffect(() => {
    // beginPendingAction (called by queueCommonTriggers below) unconditionally overwrites whatever
    // pendingAction is currently live, with no rescue for it — pushStackAction only preserves
    // "spell"/"trigger" actions, not "phase" actions (isStackAction excludes them), so a phase-
    // advance action waiting on priority passes (e.g. declare blockers step -> combat damage step)
    // gets silently orphaned if a death trigger interjects mid-resolution (a very real case: combat
    // damage itself can kill a creature the same instant it's waiting to advance past that step).
    // The result looks like agents "getting stuck" passing priority, or an attack that never applies
    // damage, because the real in-flight action was dropped with nothing left pointing at it. Defer
    // draining pendingDeaths until the stack is genuinely idle, mirroring the same `!pendingAction`
    // guard already used by the phase-trigger and block-declaration effects below.
    if (pendingAction) return;
    const deaths = session.pendingDeaths;
    if (!deaths || deaths.length === 0 || deaths === processedDeathBatchRef.current) return;
    processedDeathBatchRef.current = deaths;
    const deathTriggers = [
      ...deaths.flatMap((death) => findCommonTriggersForPermanentDied(session, death.seatId, death.card, death.attachedSourceIds, deaths)),
      // "Whenever a Food is put into a graveyard from the battlefield" (Ygra): any permanent type, not only creatures.
      ...deaths.flatMap((death) => findPutIntoGraveyardTriggers(session, death.seatId, death.card)),
      // Mazirek-style "whenever a player sacrifices another permanent" (any permanent type, so not part of the creature-death scan above).
      ...findSacrificeWatcherTriggers(session, deaths)
    ];
    setSession((current) => (current.pendingDeaths === deaths ? { ...current, pendingDeaths: undefined } : current));
    if (deathTriggers.length > 0) queueCommonTriggers(deathTriggers);
    // A death's own "when this dies" clause can also need a workflow the deterministic
    // common-trigger system doesn't cover (scry/surveil/search-on-death) — consult the rules
    // advisor for those, same as the human-only manual move-to-graveyard path already did, but now
    // for every real death (combat, removal, sacrifice, SBA) and for agent seats too. Skipped when
    // commonTriggerEffect already owns the clause, to avoid double-resolving it or risking an
    // Ollama hallucination for a card that's already fully handled.
    for (const death of deaths) {
      if (death.card.typeLine.includes("Creature") && commonTriggerEffect(death.card.oracleText, "died") === undefined) {
        void consultRulesAdvisor("card_moved_to_graveyard", death.seatId, death.card);
      }
    }
  }, [session.pendingDeaths, pendingAction]);

  // Same shape as the pendingDeaths-draining effect just above, for the entry side: reanimation
  // (moveCardAcrossSeats) and a search/tutor landing on the battlefield
  // (moveLibraryCardToDestination) are both pure functions with no access to queueCommonTriggers
  // either, unlike casting a creature spell (which already queues its own ETB triggers directly at
  // resolution). Reproduced live as Avenger of Zendikar returned via Virtue of Persistence never
  // creating its Plant tokens.
  useEffect(() => {
    if (pendingAction) return;
    const entries = session.pendingEntries;
    if (!entries || entries.length === 0 || entries === processedEntryBatchRef.current) return;
    processedEntryBatchRef.current = entries;
    // A permanent's own ETB "zone" effect (Eternal Witness's/Regrowth's "return target card from
    // your graveyard to your hand", Sun Titan's reanimate, ...) previously never ran when the
    // permanent entered via a non-cast vector (Reanimate, Meren, Virtue of Persistence, Living
    // Death, a tutor-to-battlefield) — only findCommonTriggersForPermanentEntered's TriggerEffect
    // shapes were checked below, so a ZoneEffect-shaped ETB silently fell through to
    // consultRulesAdvisor and never visibly resolved. Reproduced live: Eternal Witness returned to
    // the battlefield by Living Death never returned a card from the graveyard to hand. An entry
    // with a recognized zone effect is treated as fully handled and skips the trigger/advisor paths
    // below either way.
    const zoneEffectsByEntry = entries.map((entry) => ({ entry, zoneEffect: parseEtbZoneEffect(etbEffectText(entry.card.oracleText)) }));
    const remainingEntries = zoneEffectsByEntry.filter(({ zoneEffect }) => zoneEffect === undefined).map(({ entry }) => entry);
    // A regrow-shaped ETB reanimated into human control deserves a real choice, same as casting it
    // directly does (see the cast-time regrow branch above) — but this effect batches every
    // simultaneous entry into one update with no access to setPendingRuleChoice mid-batch. Only the
    // FIRST such entry in a batch becomes an interactive choice; any further one in the same
    // simultaneous batch (rare — multiple regrow-shaped permanents reentering at once) falls back to
    // the deterministic heuristic below rather than queuing multiple choices.
    let deferredChoiceEntry: { entry: (typeof entries)[number]; zoneEffect: ZoneEffect; spec: TargetSpec; optional: boolean } | undefined;
    for (const { entry, zoneEffect } of zoneEffectsByEntry) {
      if (deferredChoiceEntry || zoneEffect?.kind !== "regrow") continue;
      if (session.seats.find((seat) => seat.id === entry.seatId)?.kind !== "human") continue;
      const spec = zoneEffectTargetSpec(zoneEffect);
      if (!spec || legalTargets(session, entry.seatId, spec, entry.card).length <= 1) continue;
      deferredChoiceEntry = { entry, zoneEffect, spec, optional: /\byou may\b/i.test(etbEffectText(entry.card.oracleText)) };
    }
    // A creature whose enters effect is removal ("When this creature enters, destroy target creature an opponent controls": Ravenous
    // Chupacabra, Shriekmaw, Reclamation Sage, Acidic Slime) did nothing when it entered any way but a cast. A human controller picks the
    // target (the first such entry; others use the heuristic); an agent's is chosen automatically.
    const removalByEntry = remainingEntries
      // (An enters effect the trigger system already owns — a Dragon's "deals damage to any target" — is not also applied here.)
      .map((entry) => ({
        entry,
        removal:
          entry.card.token || commonTriggerEffect(entry.card.oracleText, "entered", undefined, session.seats.find((seat) => seat.id === entry.seatId)) !== undefined
            ? undefined
            : parseRemovalEffect(etbEffectText(entry.card.oracleText))
      }))
      .filter((item): item is { entry: (typeof entries)[number]; removal: RemovalEffect } => item.removal !== undefined && item.removal.kind !== "modal");
    let deferredRemovalEntry: { entry: (typeof entries)[number]; removal: RemovalEffect } | undefined;
    for (const item of removalByEntry) {
      if (deferredRemovalEntry) break;
      const spec = removalEffectTargetSpec(item.removal, item.entry.card.id);
      if (!spec || session.seats.find((seat) => seat.id === item.entry.seatId)?.kind !== "human") continue;
      if (legalTargets(session, item.entry.seatId, spec, item.entry.card).length > 1) deferredRemovalEntry = item;
    }
    const entryTriggers = [
      ...remainingEntries.flatMap((entry) => findCommonTriggersForPermanentEntered(session, entry.seatId, entry.card)),
      // "Whenever one or more other creatures you control enter, if they entered from a graveyard" (Twilight Diviner): one trigger for the whole simultaneous batch.
      ...findEntersBatchWatcherTriggers(session, entries)
    ];
    setSession((current) => {
      let next = current.pendingEntries === entries ? { ...current, pendingEntries: undefined } : current;
      for (const item of removalByEntry) {
        if (item !== deferredRemovalEntry) next = applyRemovalEffect(next, item.entry.seatId, item.entry.card.name, item.entry.card, item.removal);
      }
      for (const { entry, zoneEffect } of zoneEffectsByEntry) {
        if (zoneEffect && entry !== deferredChoiceEntry?.entry) next = applyZoneEffect(next, entry.seatId, entry.card.name, zoneEffect);
      }
      // Rule 714.2a: a Saga reanimated/tutored/blinked onto the battlefield through this batched
      // entry path (not a normal cast, which its own spell-resolution path already covers) still
      // gets its own chapter 1 the instant it enters, same as any other vector.
      for (const entry of entries) {
        // Only a Saga with no lore counter yet: a cast Saga already got its chapter I in the spell-resolution path, and this batch also
        // lists it - a second counter here fired chapter II (The Misty Mountains Cold made two Treasures and two Dragons at once).
        const enteredSaga = next.seats.find((seat) => seat.id === entry.seatId)?.board.battlefield.find((card) => card.id === entry.card.id);
        if (isSagaCard(entry.card) && enteredSaga && loreCounterCount(enteredSaga) === 0) next = applySagaEntryLoreCounter(next, entry.seatId, entry.card.id);
      }
      return next;
    });
    if (entryTriggers.length > 0) queueCommonTriggers(entryTriggers);
    // Same "let the rules advisor handle whatever the deterministic common-trigger system doesn't
    // own" fallback as the pendingDeaths effect's own, for ETB clauses instead of death clauses.
    for (const entry of remainingEntries) {
      if (removalByEntry.some((item) => item.entry === entry)) continue;
      // A token with no rules text (a vanilla Zombie) has nothing for the rules advisor to read.
      if (entry.card.token && !etbEffectText(entry.card.oracleText).trim()) continue;
      if (commonTriggerEffect(entry.card.oracleText, "entered", undefined, session.seats.find((seat) => seat.id === entry.seatId)) === undefined) {
        void consultRulesAdvisor("spell_resolved_to_battlefield", entry.seatId, entry.card);
      }
    }
    if (deferredRemovalEntry) {
      const removalSpec = removalEffectTargetSpec(deferredRemovalEntry.removal, deferredRemovalEntry.entry.card.id)!;
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_effect_target",
        controllerSeatId: deferredRemovalEntry.entry.seatId,
        sourceCardId: deferredRemovalEntry.entry.card.id,
        sourceCardName: deferredRemovalEntry.entry.card.name,
        sourceCard: deferredRemovalEntry.entry.card,
        prompt: removalSpec.prompt,
        spec: removalSpec,
        optional: /\byou may\b/i.test(etbEffectText(deferredRemovalEntry.entry.card.oracleText)),
        pending: { kind: "removal", effect: deferredRemovalEntry.removal }
      });
    } else if (deferredChoiceEntry) {
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_effect_target",
        controllerSeatId: deferredChoiceEntry.entry.seatId,
        sourceCardId: deferredChoiceEntry.entry.card.id,
        sourceCardName: deferredChoiceEntry.entry.card.name,
        sourceCard: deferredChoiceEntry.entry.card,
        prompt: deferredChoiceEntry.spec.prompt,
        spec: deferredChoiceEntry.spec,
        optional: deferredChoiceEntry.optional,
        pending: { kind: "zone", effect: deferredChoiceEntry.zoneEffect }
      });
    }
  }, [session.pendingEntries, pendingAction]);

  // Same shape again, for pendingCombatDamageToPlayer — see that field's own comment on GameSession
  // for the bug this fixes (Toski, Bearer of Secrets drawing off damage dealt to a blocking
  // creature, since the generic phase-trigger sweep had no way to check the actual damage target).
  useEffect(() => {
    if (pendingAction) return;
    const hits = session.pendingCombatDamageToPlayer;
    if (!hits || hits.length === 0 || hits === processedCombatDamageToPlayerBatchRef.current) return;
    processedCombatDamageToPlayerBatchRef.current = hits;
    // "One or more" group triggers (Parapet Thrasher's modal) fire once per source per damage step, however many creatures connected.
    const groupSeen = new Set<string>();
    const damageTriggers = hits
      .flatMap((hit) => [
        ...findCombatDamageToPlayerTriggers(session, hit.seatId, hit.card, hit.damagedSeatId),
        ...findAnyCombatDamageToOpponentTriggers(session, hit.seatId, hit.card, hit.damagedSeatId)
      ])
      .filter((trigger) => {
        // Also "Whenever one or more artifact creatures you control deal combat damage to a player" (Thopter Spy Network): once per source.
        const sourceText = session.seats.flatMap((seat) => seat.board.battlefield).find((card) => card.id === trigger.sourceCardId)?.oracleText ?? "";
        const isGroupTrigger = trigger.effect.kind === "modal" || /\bwhenever one or more [^,.]*\bdeal combat damage to a player\b/i.test(sourceText);
        if (!isGroupTrigger) return true;
        if (groupSeen.has(trigger.sourceCardId)) return false;
        groupSeen.add(trigger.sourceCardId);
        return true;
      });
    // Initiative: a creature that deals combat damage to the player with the initiative makes its controller take it.
    const initiativeHit = hits.find((hit) => session.initiativeSeatId && hit.damagedSeatId === session.initiativeSeatId && hit.seatId !== session.initiativeSeatId);
    if (initiativeHit) {
      setSession((current) => (current.initiativeSeatId === initiativeHit.damagedSeatId ? takeInitiative(current, initiativeHit.seatId) : current));
    }
    // Monarch: a creature that deals combat damage to the monarch makes its controller the monarch.
    const stealingHit = hits.find((hit) => session.monarchSeatId && hit.damagedSeatId === session.monarchSeatId && hit.seatId !== session.monarchSeatId);
    setSession((current) => {
      const cleared = current.pendingCombatDamageToPlayer === hits ? { ...current, pendingCombatDamageToPlayer: undefined } : current;
      if (!stealingHit || cleared.monarchSeatId !== stealingHit.damagedSeatId) return cleared;
      const thief = cleared.seats.find((seat) => seat.id === stealingHit.seatId);
      return thief ? rulesEvent({ ...cleared, monarchSeatId: thief.id }, thief.id, `${thief.name} becomes the monarch by dealing combat damage to the monarch.`) : cleared;
    });
    if (damageTriggers.length > 0) queueCommonTriggers(damageTriggers);
  }, [session.pendingCombatDamageToPlayer, pendingAction]);

  // Attack triggers: "Whenever this creature attacks, ..." / "Whenever a creature attacks you or a
  // planeswalker you control, ..." — queued per DECLARED attacker (see pendingAttackDeclarations on
  // GameSession) instead of by the old once-per-phase sweep that fired for every creature with
  // "attacks" text whether or not it attacked.
  // Initiative: a room that was just entered puts its effect on the stack (so targets and choices work like any other trigger).
  useEffect(() => {
    const rooms = session.pendingVentureRooms;
    if (!rooms || rooms.length === 0 || pendingAction || pendingRuleChoice) return;
    const [next, ...rest] = rooms;
    setSession((current) => ({ ...current, pendingVentureRooms: rest.length > 0 ? rest : undefined }));
    if (!isUndercityRoom(next.room)) return;
    const shim = { id: "undercity-" + next.room, name: "Undercity: " + UNDERCITY_ROOM_NAMES[next.room], typeLine: "", oracleText: "", manaValue: 0, colors: [], role: "effect", zone: "battlefield" } as VisibleCard;
    queueCommonTriggers([makeCommonTrigger(next.seatId, next.seatId, shim, { kind: "venture_room", room: next.room }, shim.name + ": " + UNDERCITY_ROOM_TEXT[next.room])]);
  }, [session.pendingVentureRooms, pendingAction, pendingRuleChoice]);

  // Initiative: a human chooses which room to enter next when the Undercity branches.
  useEffect(() => {
    const choices = session.pendingVentureChoices;
    if (!choices || choices.length === 0 || pendingAction || pendingRuleChoice) return;
    const [next, ...rest] = choices;
    setSession((current) => ({ ...current, pendingVentureChoices: rest.length > 0 ? rest : undefined }));
    const shim = { id: "undercity", name: "Undercity", typeLine: "", oracleText: "", manaValue: 0, colors: [], role: "effect", zone: "battlefield" } as VisibleCard;
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "choose_trigger_option",
      controllerSeatId: next.seatId,
      sourceCardId: shim.id,
      sourceCardName: "Undercity",
      prompt: "Venture into the Undercity: choose the next room.",
      options: next.options.map((room, index) => ({ index, label: isUndercityRoom(room) ? UNDERCITY_ROOM_NAMES[room] + " — " + UNDERCITY_ROOM_TEXT[room] : room })),
      trigger: makeCommonTrigger(next.seatId, next.seatId, shim, { kind: "venture_choice", options: next.options }, "Undercity branch."),
      remainingStack: []
    });
  }, [session.pendingVentureChoices, pendingAction, pendingRuleChoice]);

  // Punisher effects: a human victim chooses, each time, between losing the life, sacrificing, and discarding.
  useEffect(() => {
    const queue = session.pendingPunisherChoices;
    if (!queue || queue.length === 0 || pendingAction || pendingRuleChoice) return;
    const [next, ...rest] = queue;
    setSession((current) => ({ ...current, pendingPunisherChoices: rest.length > 0 ? rest : undefined }));
    openPunisherPrompt(next.seatId, next.sourceName, next.lifeAmount, next.times);
  }, [session.pendingPunisherChoices, pendingAction, pendingRuleChoice]);

  // Braids, Arisen Nightmare: the controller's "you may sacrifice a permanent", then each human opponent's "may sacrifice one that shares a type".
  useEffect(() => {
    const queue = session.pendingBraidsChoices;
    if (!queue || queue.length === 0 || pendingAction || pendingRuleChoice) return;
    const [next, ...rest] = queue;
    setSession((current) => ({ ...current, pendingBraidsChoices: rest.length > 0 ? rest : undefined }));
    const braidsController = session.seats.find((seat) => seat.id === next.braidsSeatId);
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "choose_each_player_sacrifice",
      controllerSeatId: next.seatId,
      sourceCardId: next.sourceCardId,
      sourceCardName: next.sourceName,
      prompt:
        next.stage === "controller"
          ? `${next.sourceName}: you may sacrifice an artifact, creature, enchantment, land, or planeswalker. Close this window to sacrifice nothing.`
          : `${next.sourceName}: you may sacrifice a permanent that shares a card type (${next.typeFilter ?? ""}). Close this window to lose 2 life and let ${braidsController?.name ?? "its controller"} draw a card.`,
      typeFilter: next.typeFilter ?? BRAIDS_TYPE_FILTER,
      braids: { stage: next.stage, braidsSeatId: next.braidsSeatId, remainingOpponentIds: next.remainingOpponentIds }
    });
  }, [session.pendingBraidsChoices, pendingAction, pendingRuleChoice]);

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

  // Rishkar's Expertise: "You may cast a spell with mana value 5 or less from your hand without paying its mana cost."
  useEffect(() => {
    const queue = session.pendingFreeCastChoices;
    if (!queue || queue.length === 0 || pendingAction || pendingRuleChoice) return;
    const [next, ...rest] = queue;
    setSession((current) => ({ ...current, pendingFreeCastChoices: rest.length > 0 ? rest : undefined }));
    const caster = session.seats.find((seat) => seat.id === next.seatId);
    const eligible = (caster?.board.hand ?? []).filter((card) => !isLandCard(card) && card.manaValue <= next.maxManaValue);
    if (!caster || eligible.length === 0) return;
    if (caster.kind !== "human") {
      const pick = chooseFreeCastCard(eligible);
      if (!pick) return;
      setSession((current) => markHandCardFreeCastable(current, caster.id, pick.id));
      window.setTimeout(() => playCard(caster.id, pick.id, undefined, "exile"), 150);
      return;
    }
    const shim = { id: "free-cast-" + next.sourceName, name: next.sourceName, typeLine: "", oracleText: "", manaValue: 0, colors: [], role: "effect", zone: "battlefield" } as VisibleCard;
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "choose_trigger_option",
      controllerSeatId: caster.id,
      sourceCardId: shim.id,
      sourceCardName: next.sourceName,
      prompt: next.sourceName + ": you may cast a spell with mana value " + next.maxManaValue + " or less from your hand without paying its mana cost.",
      options: [...eligible.map((card, index) => ({ index, label: "Cast " + card.name + " (mana value " + card.manaValue + ")" })), { index: eligible.length, label: "Don't cast anything" }],
      trigger: makeCommonTrigger(caster.id, caster.id, shim, { kind: "free_cast_choice", cardIds: eligible.map((card) => card.id) }, next.sourceName + " free cast."),
      remainingStack: []
    });
  }, [session.pendingFreeCastChoices, pendingAction, pendingRuleChoice]);

  // Discover: cast the exiled card free, or put it into hand.
  useEffect(() => {
    const queue = session.pendingDiscoverChoices;
    if (!queue || queue.length === 0 || pendingAction || pendingRuleChoice) return;
    const [next, ...rest] = queue;
    setSession((current) => ({ ...current, pendingDiscoverChoices: rest.length > 0 ? rest : undefined }));
    // An agent always takes the free cast (it is the better option).
    if (session.seats.find((seat) => seat.id === next.seatId)?.kind !== "human") {
      window.setTimeout(() => playCard(next.seatId, next.cardId, undefined, "exile"), 150);
      return;
    }
    const exiledCard = session.seats.find((seat) => seat.id === next.seatId)?.board.exile?.find((card) => card.id === next.cardId);
    const shim = exiledCard ?? ({ id: next.cardId, name: next.cardName, typeLine: "", oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "exile" } as VisibleCard);
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "choose_trigger_option",
      controllerSeatId: next.seatId,
      sourceCardId: next.cardId,
      sourceCardName: next.sourceName,
      prompt: next.sourceName + ": " + next.cardName + " — cast it without paying its mana cost, or put it into your hand?",
      options: [{ index: 0, label: "Cast " + next.cardName + " for free" }, { index: 1, label: "Put it into my hand" }],
      trigger: makeCommonTrigger(next.seatId, next.seatId, shim, { kind: "discover_choice", cardName: next.cardName }, next.sourceName + " discover."),
      remainingStack: []
    });
  }, [session.pendingDiscoverChoices, pendingAction, pendingRuleChoice]);

  // A discard the human chooses for themselves (forced discards, rummage effects): opens the picker for what the resolver deferred.
  useEffect(() => {
    const queue = session.pendingDiscardChoices;
    if (!queue || queue.length === 0 || pendingAction || pendingRuleChoice) return;
    const [next, ...rest] = queue;
    setSession((current) => ({ ...current, pendingDiscardChoices: rest.length > 0 ? rest : undefined }));
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "discard_to_hand_size",
      controllerSeatId: next.seatId,
      sourceCardName: next.sourceName,
      prompt: next.sourceName + ": choose " + (next.count === 1 ? "a card" : next.count + " cards") + " to discard." + (next.thenDraw ? " You then draw " + next.thenDraw + "." : ""),
      requiredDiscards: next.count,
      thenDraw: next.thenDraw
    });
  }, [session.pendingDiscardChoices, pendingAction, pendingRuleChoice]);

  // "Each player sacrifices N creatures" (Necrotic Hex): opens the human's picker for the sacrifices the resolver deferred.
  useEffect(() => {
    const queue = session.pendingSacrificeChoices;
    if (!queue || queue.length === 0 || pendingAction || pendingRuleChoice) return;
    const [next, ...rest] = queue;
    setSession((current) => ({ ...current, pendingSacrificeChoices: rest.length > 0 ? rest : undefined }));
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "choose_each_player_sacrifice",
      controllerSeatId: next.seatId,
      sourceCardId: next.sourceCardId,
      sourceCardName: next.sourceCardName,
      prompt: next.sourceCardName + ": choose a " + (next.typeFilter ?? "creature") + " to sacrifice (" + next.count + " to go).",
      typeFilter: next.typeFilter ?? "creature",
      remaining: next.count,
      excludeTokensFromSourceId: next.sourceCardId
    });
  }, [session.pendingSacrificeChoices, pendingAction, pendingRuleChoice]);

  // Token art: Scryfall has real token cards. Ask the server (which asks Scryfall once per distinct token and caches it) and stamp the image on every matching token.
  const tokenArtCache = useRef<Map<string, CardImageUris | null>>(new Map());
  const tokenArtInFlight = useRef<Set<string>>(new Set());
  const [tokenArtVersion, setTokenArtVersion] = useState(0);
  useEffect(() => {
    if (mode !== "game") return;
    const needing = session.seats.flatMap((seat) => seat.board.battlefield).filter(needsTokenArt);
    if (needing.length === 0) return;
    const keyOf = (card: VisibleCard) => tokenArtLookupKey(card);
    if (needing.some((card) => tokenArtCache.current.get(keyOf(card)))) {
      setSession((current) => ({
        ...current,
        seats: current.seats.map((seat) => ({
          ...seat,
          board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (needsTokenArt(card) && tokenArtCache.current.get(keyOf(card)) ? { ...card, imageUris: tokenArtCache.current.get(keyOf(card)) ?? undefined } : card)) }
        }))
      }));
    }
    for (const card of needing) {
      const key = keyOf(card);
      if (tokenArtCache.current.has(key) || tokenArtInFlight.current.has(key)) continue;
      tokenArtInFlight.current.add(key);
      const params = new URLSearchParams({ name: card.name, power: card.power ?? "", toughness: card.toughness ?? "", colors: (card.colors ?? []).join(""), typeLine: card.typeLine ?? "", text: card.oracleText ?? "" });
      void fetch(`/api/cards/token?${params.toString()}`)
        .then((response) => (response.ok ? response.json() : { imageUris: undefined }))
        .then((body: { imageUris?: CardImageUris }) => tokenArtCache.current.set(key, body.imageUris ?? null))
        .catch(() => tokenArtCache.current.set(key, null))
        .finally(() => {
          tokenArtInFlight.current.delete(key);
          setTokenArtVersion((value) => value + 1);
        });
    }
  }, [session.seats, mode, tokenArtVersion]);

  // A parked human choice (Toxic Deluge X, Council's Judgment vote, Crackle with Power targets, Brudiclad token): open its prompt.
  useEffect(() => {
    const queue = session.pendingPlayerChoices;
    if (!queue || queue.length === 0 || pendingAction || pendingRuleChoice) return;
    const [next, ...rest] = queue;
    setSession((current) => ({ ...current, pendingPlayerChoices: rest.length > 0 ? rest : undefined }));
    const holder = session.seats.find((seat) => seat.id === next.seatId);
    if (!holder) return;
    const stub = { id: next.sourceCardId, name: next.sourceCardName, typeLine: "", oracleText: "", manaValue: 0, colors: [], role: "effect", zone: "battlefield" } as VisibleCard;
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "choose_trigger_option",
      controllerSeatId: next.seatId,
      sourceCardId: next.sourceCardId,
      sourceCardName: next.sourceCardName,
      prompt: next.prompt,
      // Values shaped "seatId:cardId" (or a bare card id) point at a card: show its art and text in the picker.
      options: next.options.map((option, index) => {
        const maybeId = option.value.split(":").pop() ?? "";
        return { index, label: option.label, cardId: maybeId && findCardAnywhere(session, maybeId) ? maybeId : undefined };
      }),
      trigger: makeCommonTrigger(next.seatId, next.seatId, stub, { kind: "deferred_choice", resolver: next.resolver, data: next.data, values: next.options.map((option) => option.value) }, `${next.sourceCardName} resolves.`),
      remainingStack: []
    });
  }, [session.pendingPlayerChoices, pendingAction, pendingRuleChoice]);

  // Shockland-style lands a human just played: ask whether to pay the life for it to be untapped.
  useEffect(() => {
    const queue = session.pendingShockChoices;
    if (!queue || queue.length === 0 || pendingAction || pendingRuleChoice) return;
    const [next, ...rest] = queue;
    setSession((current) => ({ ...current, pendingShockChoices: rest.length > 0 ? rest : undefined }));
    const land = session.seats.find((seat) => seat.id === next.seatId)?.board.battlefield.find((card) => card.id === next.cardId);
    if (!land) return;
    if (next.revealTypes) {
      const hand = session.seats.find((seat) => seat.id === next.seatId)?.board.hand ?? [];
      const candidates = handCardsOfTypes(hand, next.revealTypes, land.id);
      if (candidates.length === 0) return;
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_trigger_option",
        controllerSeatId: next.seatId,
        sourceCardId: next.cardId,
        sourceCardName: next.cardName,
        prompt: `${next.cardName}: reveal a ${next.revealTypes.join(" or ")} card from your hand so it is untapped? (If you don't, it stays tapped.)`,
        options: [...candidates.map((card, index) => ({ index, label: `Reveal ${card.name}` })), { index: candidates.length, label: "Don't reveal (tapped)" }],
        trigger: makeCommonTrigger(next.seatId, next.seatId, land, { kind: "reveal_land_untap", cardIds: candidates.map((card) => card.id) }, `${next.cardName} enters.`),
        remainingStack: []
      });
      return;
    }
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "choose_trigger_option",
      controllerSeatId: next.seatId,
      sourceCardId: next.cardId,
      sourceCardName: next.cardName,
      prompt: `${next.cardName}: pay ${next.life} life to have it enter untapped? (If you don't, it stays tapped.)`,
      options: [{ index: 0, label: `Pay ${next.life} life (untapped)` }, { index: 1, label: "Don't pay (tapped)" }],
      trigger: makeCommonTrigger(next.seatId, next.seatId, land, { kind: "shock_pay", life: next.life }, `${next.cardName} enters.`),
      remainingStack: []
    });
  }, [session.pendingShockChoices, pendingAction, pendingRuleChoice]);

  // Counter placement a human has to aim (Breena, the Demagogue's two +1/+1 counters): opens the same creature picker Athreos uses.
  useEffect(() => {
    const queue = session.pendingCounterChoices;
    if (!queue || queue.length === 0 || pendingAction || pendingRuleChoice) return;
    const [next, ...rest] = queue;
    setSession((current) => ({ ...current, pendingCounterChoices: rest.length > 0 ? rest : undefined }));
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "choose_creature_on_battlefield",
      controllerSeatId: next.seatId,
      sourceCardId: next.sourceCardId,
      sourceCardName: next.sourceCardName,
      prompt: `${next.sourceCardName}: choose a creature to put ${next.amount > 1 ? `${next.amount} ` : "a"} ${next.counterKind} counter${next.amount > 1 ? "s" : ""} on.`,
      counterKind: next.counterKind,
      amount: next.amount,
      restrictToYourControl: next.restrictToYourControl
    });
  }, [session.pendingCounterChoices, pendingAction, pendingRuleChoice]);

  // Monarch (rule 724): the monarch draws an extra card at the beginning of their own end step.
  const monarchDrawChecked = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (mode !== "game" || gameStage !== "playing" || pendingAction || pendingRuleChoice) return;
    if (session.phase !== "end step" || !session.monarchSeatId || session.monarchSeatId !== activeSeatId) return;
    const key = `${session.turn}:${session.monarchSeatId}`;
    if (monarchDrawChecked.current.has(key)) return;
    monarchDrawChecked.current.add(key);
    const monarchSeatId = session.monarchSeatId;
    setSession((current) => applyEndStepEffects(current, monarchSeatId));
  }, [mode, gameStage, pendingAction, pendingRuleChoice, session.phase, session.turn, session.monarchSeatId, activeSeatId, session.seats]);

  // Dragonhawk, Fate's Tempest: at the beginning of its controller's end step, damage for every impulse-exiled card still in exile.
  const exileDamageChecked = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (mode !== "game" || gameStage !== "playing" || pendingAction || pendingRuleChoice) return;
    if (session.phase !== "end step") return;
    const active = session.seats.find((seat) => seat.id === activeSeatId);
    if (!active || !(active.board.exile ?? []).some((card) => card.exileEndStepDamage?.controllerSeatId === activeSeatId)) return;
    const key = `${session.turn}:${activeSeatId}`;
    if (exileDamageChecked.current.has(key)) return;
    exileDamageChecked.current.add(key);
    setSession((current) => resolveEndStepExileDamage(current, activeSeatId));
  }, [mode, gameStage, pendingAction, pendingRuleChoice, session.phase, session.turn, activeSeatId, session.seats]);

  // Life gain has a dozen separate call sites that each just add to seat.life, so instead of hooking each one this watches every
  // seat's life total and treats any rise as "you gained life": applies Angel of Vitality's +1, then queues the
  // "whenever you gain life" triggers. (Manual +/- life edits count too — acceptable for a table that is also a sandbox.)
  const lifeWatchRef = useRef<{ sessionId: string; lives: Record<string, number>; gainTurns: Record<string, number> }>({ sessionId: "", lives: {}, gainTurns: {} });
  useEffect(() => {
    const watch = lifeWatchRef.current;
    if (watch.sessionId !== session.id) {
      lifeWatchRef.current = { sessionId: session.id, lives: Object.fromEntries(session.seats.map((seat) => [seat.id, seat.life])), gainTurns: {} };
      return;
    }
    if (mode !== "game" || gameStage !== "playing") {
      for (const seat of session.seats) watch.lives[seat.id] = seat.life;
      return;
    }
    const gains: Array<{ seatId: string; amount: number }> = [];
    for (const seat of session.seats) {
      const previous = watch.lives[seat.id];
      watch.lives[seat.id] = seat.life;
      if (previous !== undefined && seat.life > previous && !seat.hasLost) gains.push({ seatId: seat.id, amount: seat.life - previous });
    }
    if (gains.length === 0) return;
    const bonuses = new Map(gains.map((gain) => [gain.seatId, lifeGainReplacementBonus(session.seats.find((seat) => seat.id === gain.seatId)!)]));
    const queued: Array<Extract<PendingAction, { type: "trigger" }>> = [];
    for (const gain of gains) {
      const amount = gain.amount + (bonuses.get(gain.seatId) ?? 0);
      const firstThisTurn = watch.gainTurns[gain.seatId] !== session.turn;
      watch.gainTurns[gain.seatId] = session.turn;
      queued.push(...findLifeGainTriggers(session, { seatId: gain.seatId, amount, firstThisTurn }));
    }
    const bonusSeats = gains.filter((gain) => (bonuses.get(gain.seatId) ?? 0) > 0);
    if (bonusSeats.length > 0) {
      for (const gain of bonusSeats) watch.lives[gain.seatId] += bonuses.get(gain.seatId) ?? 0;
      setSession((current) => ({
        ...current,
        seats: current.seats.map((seat) => (bonuses.get(seat.id) ? { ...seat, life: seat.life + (bonuses.get(seat.id) ?? 0) } : seat))
      }));
    }
    if (queued.length > 0 && !pendingAction) queueCommonTriggers(queued);
  }, [session.seats, mode, gameStage]);

  const processedBlockBatchRef = useRef<GameSession["pendingBlockDeclarations"]>(undefined);
  useEffect(() => {
    if (pendingAction) return;
    const blocks = session.pendingBlockDeclarations;
    if (!blocks || blocks.length === 0 || blocks === processedBlockBatchRef.current) return;
    processedBlockBatchRef.current = blocks;
    const queued = blocks.flatMap((block) => findAttackTriggers(session, { seatId: block.seatId, card: block.card, defendingSeatId: block.attackerSeatId }, "blocks").triggers);
    setSession((current) => (current.pendingBlockDeclarations === blocks ? { ...current, pendingBlockDeclarations: undefined } : current));
    if (queued.length > 0) queueCommonTriggers(queued);
  }, [session.pendingBlockDeclarations, pendingAction]);

  const processedAttackBatchRef = useRef<GameSession["pendingAttackDeclarations"]>(undefined);
  useEffect(() => {
    if (pendingAction) return;
    const attacks = session.pendingAttackDeclarations;
    if (!attacks || attacks.length === 0 || attacks === processedAttackBatchRef.current) return;
    processedAttackBatchRef.current = attacks;
    const queued: Array<Extract<PendingAction, { type: "trigger" }>> = [];
    const unparsed: Array<{ seatId: string; source: VisibleCard }> = [];
    for (const attack of attacks) {
      const found = findAttackTriggers(session, attack);
      queued.push(...found.triggers);
      unparsed.push(...found.unparsed);
    }
    // "Whenever you attack with two or more creatures" (Firemane Commando): judged once enough creatures are attacking, once per turn.
    const multi = [...new Set(attacks.map((attack) => attack.seatId))].map((attackerSeatId) => findMultiAttackTriggers(session, attackerSeatId));
    queued.push(...multi.flatMap((entry) => entry.triggers));
    const multiKeys = multi.flatMap((entry) => entry.keys);
    setSession((current) => {
      const cleared = current.pendingAttackDeclarations === attacks ? { ...current, pendingAttackDeclarations: undefined } : current;
      return multiKeys.length > 0 ? { ...cleared, onceEachTurnEffectsUsed: [...(cleared.onceEachTurnEffectsUsed ?? []), ...multiKeys] } : cleared;
    });
    if (queued.length > 0) queueCommonTriggers(queued);
    // A clause no deterministic parser understands still goes to the rules advisor, as the old sweep did.
    for (const item of unparsed) void consultRulesAdvisor(phaseEventName("declare attackers step"), item.seatId, item.source);
  }, [session.pendingAttackDeclarations, pendingAction]);

  // Same shape again, for pendingGraveyardDepartures — see that field's own comment on GameSession
  // for the bug this fixes (Willow Geist, Insidious Roots: "whenever one or more cards leave your
  // graveyard, ..." had no event to fire off of at all before this field existed).
  useEffect(() => {
    if (pendingAction) return;
    const departures = session.pendingGraveyardDepartures;
    if (!departures || departures.length === 0 || departures === processedGraveyardDepartureBatchRef.current) return;
    processedGraveyardDepartureBatchRef.current = departures;
    const departureTriggers = departures.flatMap((departure) => findCardsLeftGraveyardTriggers(session, departure.seatId));
    setSession((current) => (current.pendingGraveyardDepartures === departures ? { ...current, pendingGraveyardDepartures: undefined } : current));
    if (departureTriggers.length > 0) queueCommonTriggers(departureTriggers);
    // Same "let the rules advisor handle whatever the deterministic common-trigger system doesn't
    // own" fallback as the pendingDeaths/pendingEntries effects' own, for a departure clause the
    // parser recognizes as present but can't resolve into a known effect shape.
    for (const departure of departures) {
      const seat = session.seats.find((item) => item.id === departure.seatId);
      for (const source of seat?.board.battlefield ?? []) {
        if (cardsLeaveGraveyardEffectText(source.oracleText) && commonTriggerEffect(source.oracleText, "cards_left_graveyard") === undefined) {
          void consultRulesAdvisor("cards_left_graveyard", departure.seatId, source);
        }
      }
    }
  }, [session.pendingGraveyardDepartures, pendingAction]);

  // Rule 903.9a: a commander that would go to the graveyard may be put into the command zone
  // instead, owner's choice — destroyCreatures/moveCardBetweenVisibleZones no longer auto-redirect
  // it there (see their own comments), so it just sits in the graveyard, still flagged
  // commander: true, until this offers the real choice. Runs generically off session state instead
  // of hooking into any one move path, so it catches a commander reaching the graveyard however it
  // got there (combat, removal, sacrifice, mill, ...) — including an agent seat's, auto-accepted
  // immediately rather than via a real prompt, matching the old unconditional behavior for them.
  useEffect(() => {
    if (mode !== "game" || gameStage !== "playing" || pendingAction || pendingRuleChoice || libraryLook) return;
    // A commander that went back to the command zone/battlefield may die or be exiled again later:
    // forget ids no longer sitting in a graveyard/exile so the next departure is offered afresh.
    for (const askedId of Array.from(commanderZoneChoiceAsked.current)) {
      if (!session.seats.some((s) => (s.board.graveyard ?? []).some((c) => c.id === askedId) || (s.board.exile ?? []).some((c) => c.id === askedId))) commanderZoneChoiceAsked.current.delete(askedId);
    }
    for (const seat of session.seats) {
      if (seat.board.commander) continue;
      // Rule 903.9a covers graveyard AND exile (Swords, Path, Grasp of Fate, Oblivion Ring...). The
      // commander's owner is whoever's seat it belongs to; the card may sit in any seat's exile
      // (a caster's "exile" destination), so look across all seats for one this seat owns.
      const exiledCommander = session.seats
        .flatMap((other) => (other.board.exile ?? []).map((card) => ({ card, holderId: other.id })))
        .find(({ card, holderId }) => card.commander && (card.ownerSeatId ?? holderId) === seat.id)?.card;
      const graveyardOne = (seat.board.graveyard ?? []).find((card) => card.commander);
      const graveyardCommander = graveyardOne ?? exiledCommander;
      const fromZone: "graveyard" | "exile" = graveyardOne ? "graveyard" : "exile";
      if (!graveyardCommander || commanderZoneChoiceAsked.current.has(graveyardCommander.id)) continue;
      commanderZoneChoiceAsked.current.add(graveyardCommander.id);
      if (seat.kind === "human") {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "commander_zone_choice",
          controllerSeatId: seat.id,
          sourceCardId: graveyardCommander.id,
          sourceCardName: graveyardCommander.name,
          fromZone,
          prompt: `${graveyardCommander.name} is in ${fromZone === "exile" ? "exile" : "your graveyard"}. Move it to the command zone instead?`
        });
      } else {
        setSession((current) => moveCommanderToCommandZone(current, seat.id, graveyardCommander.id));
      }
      return;
    }
  }, [session, mode, gameStage, pendingAction, pendingRuleChoice, libraryLook]);

  // Creatures that left the battlefield without dying (bounced, exiled): queue their "whenever a creature you control leaves the
  // battlefield" triggers. Waits for an idle stack, like the death and entry drains.
  useEffect(() => {
    if (pendingAction) return;
    const leaves = session.pendingLeaves;
    if (!leaves || leaves.length === 0 || leaves === processedLeaveBatchRef.current) return;
    processedLeaveBatchRef.current = leaves;
    const triggers = leaves.flatMap((leave) => findLeavesBattlefieldTriggers(session, leave.seatId, leave.card));
    setSession((current) => (current.pendingLeaves === leaves ? { ...current, pendingLeaves: undefined } : current));
    if (triggers.length > 0) queueCommonTriggers(triggers);
  }, [session.pendingLeaves, pendingAction]);

  // "No interactive targeting exists for Auras" (see chooseAuraAttachTarget's own doc comment) — a
  // human's Aura auto-attaches to whatever the heuristic picked the instant it resolves, deep
  // inside a setSession updater with no access to setPendingRuleChoice. This offers a post-hoc
  // redirect instead: any Aura that just entered attached to a creature, under a human's control,
  // gets one chance to be pointed at a different eligible creature before settling in — an agent's
  // Aura is left exactly as the heuristic attached it (matching the old behavior for them).
  useEffect(() => {
    if (mode !== "game" || gameStage !== "playing" || pendingAction || pendingRuleChoice || libraryLook) return;
    for (const seat of session.seats) {
      if (seat.kind !== "human") continue;
      for (const card of seat.board.battlefield) {
        if (!isAura(card) || !card.attachedToId || auraRetargetAsked.current.has(card.id)) continue;
        auraRetargetAsked.current.add(card.id);
        const restriction = enchantRestriction(card.oracleText);
        if (restriction !== "creature" && restriction !== "creature_you_control") continue;
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_aura_attach_target",
          controllerSeatId: seat.id,
          sourceCardId: card.id,
          sourceCardName: card.name,
          prompt: `${card.name} attached automatically — choose a different creature to enchant, or close this to keep it where it is.`,
          restrictToYourControl: restriction === "creature_you_control" || !isRemovalStyleAura(card.oracleText)
        });
        return;
      }
    }
  }, [session, mode, gameStage, pendingAction, pendingRuleChoice, libraryLook]);

  useEffect(() => {
    if (mode !== "game" || gameStage !== "playing") return;
    const prioritySeat = session.seats.find((seat) => seat.id === prioritySeatId);
    if (!pendingAction || prioritySeat?.kind !== "agent") return;
    const requiredNow = pendingActionRequiredPasses(
      session.seats,
      pendingAction,
      activeSeatId,
      session,
      manaPools,
      priorityStopSettings,
      holdPriorityOnce ? humanSeat.id : undefined
    );
    if (!requiredNow.includes(prioritySeat.id)) {
      // If nobody actually needs to respond any more (e.g. the caster spent their last mana paying
      // for the very spell that opened this window, so a stale-session prioritySeatId assignment no
      // longer has any real responder behind it), nextPrioritySeatId's fallback returns the pending
      // action's own actor — which, when that actor is already the current prioritySeatId, is a
      // same-value setState that React silently no-ops. Nothing else ever revisits this window, so
      // the stack sits on "Waiting for responses" forever with an empty requiredPasses list and no
      // guard key ever set (this was the actual mechanism behind the "stuck after casting an instant
      // in response" reports — reproduced live via Playwright, not card-specific). Resolving directly
      // here mirrors beginPendingAction's own "requiredPasses.length === 0" fast path.
      if (requiredNow.length === 0) {
        // Cleanup matters here as much as it does for the decision timer below: without it, this
        // effect re-firing (session.seats gets a new array reference on nearly every render, so this
        // is routine, not rare) before the 0ms timeout pops schedules a second, third, ... resolve of
        // the exact same captured pendingAction, applying its effect multiple times over — a real
        // regression caught live (duplicate React keys from the duplicated effects) right after this
        // branch was first added.
        const resolveTimer = window.setTimeout(() => resolvePendingAction(pendingAction), 0);
        return () => window.clearTimeout(resolveTimer);
      }
      setPrioritySeatId(
        nextPrioritySeatId(
          session.seats,
          pendingAction.actorSeatId,
          priorityPasses,
          pendingAction,
          activeSeatId,
          session,
          manaPools,
          priorityStopSettings,
          holdPriorityOnce ? humanSeat.id : undefined
        )
      );
      return;
    }
    const key = `priority:${pendingAction.id}:${prioritySeat.id}:${priorityPasses.join(",")}`;
    if (agentDecisionRequests.current.has(key)) return;
    // The guard is added inside the timer callback, not here — adding it eagerly used to mean an
    // unrelated setSession call (any of them; session.seats gets a new array reference every time)
    // firing within this 850ms window would re-run this effect, whose cleanup cancels the timer
    // below without ever calling decideAgentPriorityAction, so its finally (the only place that
    // deletes the key) never runs either. The key stayed in the set forever, permanently blocking
    // this exact decision — the seat's "thinking" indicator would spin indefinitely with no LLM
    // call ever made or retried, since every future run of this effect saw the same key and bailed
    // out at the check above. This is what produced Sarkhan's Triumph's caster getting stuck
    // "waiting for responses" forever (Stuck.jpg/Response.jpg) — a race, not a deterministic bug,
    // which is why it only happened sometimes.
    const timer = window.setTimeout(() => {
      agentDecisionRequests.current.add(key);
      markAgentThinking(prioritySeat.id, true);
      void decideAgentPriorityAction(prioritySeat, pendingAction, key);
    }, agentPaceMs(850));
    return () => window.clearTimeout(timer);
  }, [mode, gameStage, pendingAction, priorityPasses, prioritySeatId, session.seats, session.turn, activeSeatId, manaPools, priorityStopSettings, holdPriorityOnce, humanSeat.id]);

  useEffect(() => {
    // stackActions: the step's own triggers sit on the stack until they have all resolved; nothing new is swept in while they do.
    if (mode !== "game" || gameStage !== "playing" || pendingAction || stackActions.length > 0 || libraryLook || pendingRuleChoice) return;
    if (!TURN_PHASES.includes(session.phase as TurnPhase)) return;
    const activeSeat = session.seats.find((seat) => seat.id === activeSeatId);
    if (!activeSeat) return;
    // extraBeginningPhaseActive is part of the key because Shadow of the Second Sun replays
    // untap/upkeep/draw a second time within the SAME turn number — without it, the second
    // upkeep step collided with the first upkeep step's already-used key and silently never
    // fired again (reported live: the extra upkeep never triggered Aminatou, Veil Piercer's
    // surveil 2).
    const key = `${session.turn}:${activeSeat.id}:${session.phase}:${session.extraBeginningPhaseActive ?? false}:${session.extraCombatsPending ?? 0}`;
    // Phase-trigger registry (src/lib/phaseTriggers.ts): every OTHER seat's watchers ("each upkeep", "each opponent's upkeep", "each combat", ...)
    // and due delayed triggers go on the stack first (APNAP: the non-active players' triggers resolve before the active player's), as real trigger
    // stack items, so the human gets a response window when they hold a real response and none otherwise. The active player's own triggers wait
    // for that stack to empty (this effect re-runs when it does) and are handled by the per-card flow below.
    const otherKey = `${key}:other`;
    if (!phaseTriggersChecked.current.has(otherKey)) {
      phaseTriggersChecked.current.add(otherKey);
      const plan = planOffTurnPhaseTriggers(session, session.phase as TurnPhase, activeSeat.id);
      if (plan.consumedDelayedIds.length > 0) {
        setSession((current) => ({ ...current, delayedPhaseTriggers: (current.delayedPhaseTriggers ?? []).filter((item) => !plan.consumedDelayedIds.includes(item.id)) }));
      }
      if (plan.triggers.length > 0) {
        queueCommonTriggers(plan.triggers);
        return;
      }
    }
    if (phaseTriggersChecked.current.has(key)) return;
    phaseTriggersChecked.current.add(key);
    const triggers = phaseTriggeredCards(activeSeat, session.phase as TurnPhase);
    if (triggers.length === 0) return;
    if (triggers.length === 1) {
      const phase = session.phase as TurnPhase;
      const sourceCard = triggers[0];
      if (phase === "upkeep step" && isCumulativeUpkeepCard(sourceCard)) {
        openCumulativeUpkeepChoice(activeSeat.id, sourceCard);
        return;
      }
      if (activeSeat.kind === "human" && resolvePhaseScryOrSurveil(activeSeat.id, sourceCard, phase)) return;
      // "Put target creature card from a graveyard onto the battlefield under your control." (Virtue
      // of Persistence) — a real target choice across every player's graveyard, checked before the
      // deterministic auto-pick below so a human controller gets asked instead of just having
      // chooseReanimationTarget's heuristic pick handed to them (an agent still goes straight through
      // applyDeterministicPhaseTrigger unchanged, same as every other phase trigger).
      if (activeSeat.kind === "human" && isReanimateFromAnyGraveyardPhaseTrigger(sourceCard, phase)) {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_creature_from_graveyards",
          controllerSeatId: activeSeat.id,
          sourceCardId: sourceCard.id,
          sourceCardName: sourceCard.name,
          prompt: `${sourceCard.name}: choose a creature card in any graveyard to return to the battlefield under your control.`
        });
        return;
      }
      // "At the beginning of your end step, choose target creature card in your graveyard. If that
      // card's mana value is less than or equal to the number of experience counters you have,
      // return it to the battlefield. Otherwise, put it into your hand." (Meren of Clan Nel Toth) —
      // same shape as Virtue of Persistence just above (a real target choice instead of the
      // deterministic applyMerenEndStepEffect heuristic), restricted to the controller's own
      // graveyard only ("in your graveyard," not "in a graveyard") and with the mana-value-vs-
      // experience-counters branch threaded through as manaValueCeiling. An agent still goes
      // straight through applyMerenEndStepEffect unchanged.
      if (activeSeat.kind === "human" && phase === "end step" && isMerenEndStepEffect(sourceCard.oracleText)) {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_creature_from_graveyards",
          controllerSeatId: activeSeat.id,
          sourceCardId: sourceCard.id,
          sourceCardName: sourceCard.name,
          prompt: `${sourceCard.name}: choose a creature card in your graveyard.`,
          manaValueCeiling: activeSeat.experienceCounters ?? 0,
          restrictToYourGraveyard: true
        });
        return;
      }
      // "Put a coin counter on another target creature." (Athreos, Shroud-Veiled) — a real
      // battlefield target choice, checked before the deterministic auto-pick below for the same
      // reason as the graveyard-reanimation check just above (an agent still goes straight through
      // applyDeterministicPhaseTrigger unchanged, via chooseCounterTarget's heuristic).
      const targetCounterEffect = targetCreatureCounterPhaseTrigger(sourceCard, phase);
      if (activeSeat.kind === "human" && targetCounterEffect) {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_creature_on_battlefield",
          controllerSeatId: activeSeat.id,
          sourceCardId: sourceCard.id,
          sourceCardName: sourceCard.name,
          prompt: `${sourceCard.name}: choose a creature to put ${targetCounterEffect.amount > 1 ? `${targetCounterEffect.amount} ` : "a"} ${targetCounterEffect.counterKind} counter${targetCounterEffect.amount > 1 ? "s" : ""} on.`,
          counterKind: targetCounterEffect.counterKind,
          amount: targetCounterEffect.amount,
          restrictToYourControl: targetCounterEffect.scope === "target_creature_you_control"
        });
        return;
      }
      // "At the beginning of your first main phase, add {G}{G}." (Hulking Raptor) — straight into the mana pool.
      const phaseMana = phaseEffectText(sourceCard.oracleText, phase).match(/at the beginning of your first main phase, add ((?:\{[wubrgc]\})+)\.?/i);
      if (phaseMana) {
        let pool = poolForSeat(activeSeat.id);
        for (const symbol of phaseMana[1].match(/\{([wubrgc])\}/gi) ?? []) pool = addManaToPool(pool, symbol[1].toUpperCase() as ManaColor, 1);
        setSeatManaPool(activeSeat.id, pool);
        addEvent(`${sourceCard.name} adds ${phaseMana[1]} to ${activeSeat.name}'s mana pool.`, activeSeat.id, "Rules action");
        return;
      }
      // Modal, echo, graveyard-return and aimed-target prompts for a human (shared with the ordered multi-trigger loop).
      if (openHumanPhaseChoice(activeSeat, sourceCard, phase)) return;
      // Braids, Arisen Nightmare: a human controller answers "you may sacrifice a permanent" through a picker (see pendingBraidsChoices).
      if (activeSeat.kind === "human" && isBraidsEndStepText(sourceCard.oracleText)) {
        setSession((current) => ({
          ...current,
          pendingBraidsChoices: [...(current.pendingBraidsChoices ?? []), { stage: "controller", seatId: activeSeat.id, braidsSeatId: activeSeat.id, sourceName: sourceCard.name, sourceCardId: sourceCard.id }]
        }));
        return;
      }
      // Decide synchronously against the current render's session (consistent with the same kind
      // of pre-check already used to skip the advisor for ETB triggers) — consultRulesAdvisor has
      // real side effects (fetch, later setSession calls), so it must never run from inside a
      // setSession updater, which React may in principle invoke more than once.
      // The deterministic effect goes on the stack as a real trigger (response window for whoever holds a real response, recorded target for an
      // agent's aimed trigger, intervening "if" checked now and again on resolution); with nothing to respond to it resolves at once.
      const stacked = makePhaseStackTrigger(session, activeSeat.id, sourceCard, phase);
      if (stacked && stacked !== "blocked") {
        queueCommonTriggers([stacked]);
      } else if (!stacked) {
        if (resolvePhaseScryOrSurveil(activeSeat.id, sourceCard, phase)) return;
        if (!phaseConditionBlocks(session, activeSeat.id, phaseEffectText(sourceCard.oracleText, phase))) {
          void consultRulesAdvisor(phaseEventName(phase), activeSeat.id, sourceCard);
        }
      }
      return;
    }
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "order_triggers",
      controllerSeatId: activeSeat.id,
      prompt: `${activeSeat.name} has ${triggers.length} ${session.phase} triggers. Choose the order they resolve.`,
      triggers: triggers.map((card) => ({
        sourceCardId: card.id,
        sourceCardName: card.name,
        text: card.oracleText
      })),
      orderedTriggers: []
    });
  }, [mode, gameStage, pendingAction, stackActions.length, libraryLook, pendingRuleChoice, session.phase, session.turn, session.seats, activeSeatId]);

  // Picks continueOrderedPhaseTriggers's queue back up once whatever interactive choice it stopped
  // on (a reanimation/counter target, a cumulative-upkeep pay-or-sacrifice, or a scry/surveil
  // window) has actually closed — gated on pendingRuleChoice/libraryLook both being clear so this
  // never fires while that choice is still open, and driven by an effect (rather than called
  // directly from each choice's completion handler) specifically so it reads the session this
  // render actually committed instead of the stale pre-choice session those handlers closed over,
  // which would otherwise race their own setSession call and silently revert it. Reproduced live as
  // a seat with Debtors' Knell, Virtue of Persistence, and Aminatou, Veil Piercer all triggering the
  // same upkeep only ever getting asked Aminatou's surveil choice, with the other two reanimation
  // triggers silently dropped.
  useEffect(() => {
    if (pendingRuleChoice || libraryLook) return;
    const resume = pendingOrderedTriggerResume.current;
    if (!resume) return;
    pendingOrderedTriggerResume.current = undefined;
    continueOrderedPhaseTriggers(resume.seatId, resume.triggers, resume.stacked);
  }, [session, pendingRuleChoice, libraryLook]);

  // Rule 514.1/514.2 (cleanup step): the active player discards down to their maximum hand size
  // (7, unless something on the board says otherwise). Modeled as a pendingRuleChoice, same as
  // every other "controller must decide something" moment (order_triggers, choose_card_from_library,
  // ...) — that reuses the existing guards elsewhere (the main agent-decision effect below already
  // bails out while pendingRuleChoice is set) instead of needing new plumbing. Scoped to the active
  // seat only: only the turn-taking player's hand realistically changes during their own turn in
  // this engine, so per-turn-a-cleanup-step-fires is enough coverage without queueing every seat.
  useEffect(() => {
    if (mode !== "game" || gameStage !== "playing" || pendingAction || pendingRuleChoice) return;
    if (session.phase !== "cleanup step") return;
    const activeSeat = session.seats.find((seat) => seat.id === activeSeatId);
    if (!activeSeat) return;
    const key = `${session.turn}:${activeSeat.id}`;
    if (cleanupDiscardChecked.current.has(key)) return;
    cleanupDiscardChecked.current.add(key);
    const maxHandSize = effectiveMaxHandSize(activeSeat);
    const requiredDiscards = activeSeat.board.hand.length - maxHandSize;
    if (requiredDiscards <= 0) return;
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "discard_to_hand_size",
      controllerSeatId: activeSeat.id,
      prompt: seatVerb(
        activeSeat,
        `${activeSeat.name} has ${activeSeat.board.hand.length} cards and must discard down to ${maxHandSize}.`,
        `You have ${activeSeat.board.hand.length} cards and must discard down to ${maxHandSize}.`
      ),
      requiredDiscards
    });
  }, [mode, gameStage, pendingAction, pendingRuleChoice, session.phase, session.turn, activeSeatId, session.seats]);

  // Rule 514.2-adjacent: Klauth's "until end of turn, you don't lose this mana as steps and phases
  // end" exception itself ends once that same turn reaches its own cleanup step — clearAllManaPools
  // never touches restrictedManaBatches (see its own doc comment), so this is the one explicit place
  // that actually expires it.
  useEffect(() => {
    if (mode !== "game" || gameStage !== "playing") return;
    if (session.phase !== "cleanup step") return;
    const activeSeat = session.seats.find((seat) => seat.id === activeSeatId);
    if (!activeSeat) return;
    const key = `${session.turn}:${activeSeat.id}`;
    if (cleanupRestrictedManaChecked.current.has(key)) return;
    cleanupRestrictedManaChecked.current.add(key);
    if ((restrictedManaBatches[activeSeat.id]?.length ?? 0) > 0) clearRestrictedManaForSeat(activeSeat.id);
  }, [mode, gameStage, session.phase, session.turn, activeSeatId, session.seats, restrictedManaBatches]);

  useEffect(() => {
    if (
      mode !== "game" ||
      gameStage !== "playing" ||
      pendingAction ||
      libraryLook ||
      pendingRuleChoice ||
      manualLibrarySearch ||
      blockChoice ||
      basicLandFetchSearch ||
      rulesAdvisorPending > 0
    )
      return;
    if (session.phase === "declare blockers step") {
      const choice = createCombatBlockChoice(session, activeSeatId);
      if (!choice) {
        const key = `no-blockers:${session.turn}:${activeSeatId}`;
        if (agentDecisionRequests.current.has(key)) return;
        // See the priority-response effect above for why the guard is added inside the timer
        // callback rather than here: an eagerly-added guard whose timer gets cancelled by an
        // unrelated re-render (cleanup fires, callback never does) orphans the key forever, since
        // nothing else ever deletes it — this exact spot used to leave combat permanently stuck
        // with no blockers ever declared and no way to advance.
        const timer = window.setTimeout(() => {
          agentDecisionRequests.current.add(key);
          advanceTurn();
        }, agentPaceMs(700));
        return () => window.clearTimeout(timer);
      }
      const defender = session.seats.find((seat) => seat.id === choice.defenderSeatId);
      if (!defender) return;
      if (defender.kind === "human") {
        const key = `human-block:${session.turn}:${choice.attackerSeatId}:${choice.defenderSeatId}:${choice.attackerCardId}`;
        if (agentDecisionRequests.current.has(key)) return;
        agentDecisionRequests.current.add(key);
        setBlockChoice(choice);
        addEvent(seatVerb(defender, `${defender.name} chooses blockers.`, "You choose blockers."), defender.id, "Phase change");
        return;
      }
      const key = `block:${session.turn}:${activeSeatId}:${choice.defenderSeatId}:${choice.attackerCardId}`;
      if (agentDecisionRequests.current.has(key)) return;
      const timer = window.setTimeout(() => {
        agentDecisionRequests.current.add(key);
        markAgentThinking(defender.id, true);
        void decideAgentBlockAction(defender, choice, key);
      }, agentPaceMs(1100));
      return () => window.clearTimeout(timer);
    }
    const activeSeat = session.seats.find((seat) => seat.id === activeSeatId);
    if (activeSeat?.kind !== "agent") return;
    if (shouldAgentFastForwardToEndStep(activeSeat)) {
      const key = `fast-end:${session.turn}:${activeSeat.id}:${session.phase}`;
      if (agentDecisionRequests.current.has(key)) return;
      const timer = window.setTimeout(() => {
        agentDecisionRequests.current.add(key);
        fastForwardAgentToEndStep(activeSeat.id);
        agentDecisionRequests.current.delete(key);
      }, agentPaceMs(500));
      return () => window.clearTimeout(timer);
    }
    const actionKey = `${session.turn}:${activeSeat.id}:${session.phase}`;
    if (agentDecisionRequests.current.has(actionKey)) return;
    const shouldAskAgent =
      session.phase === "precombat main phase" ||
      session.phase === "postcombat main phase" ||
      session.phase === "declare attackers step";
    if (!shouldAskAgent) {
      const timer = window.setTimeout(() => advanceTurn(), agentPaceMs(1100));
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      agentDecisionRequests.current.add(actionKey);
      markAgentThinking(activeSeat.id, true);
      if (session.phase === "declare attackers step") {
        void decideAgentAttackers(activeSeat, actionKey);
      } else {
        void decideAgentTurnAction(activeSeat, actionKey);
      }
    }, agentPaceMs(1100));
    return () => window.clearTimeout(timer);
  }, [mode, gameStage, pendingAction, libraryLook, pendingRuleChoice, manualLibrarySearch, blockChoice, basicLandFetchSearch, rulesAdvisorPending, activeSeatId, session.phase, session.turn, session.seats]);

  // Human turn auto-advance: chains the human's own turn from stop to stop (per priorityStopSettings'
  // phase grid) instead of requiring a manual Advance Phase click for every one of TURN_PHASES' 12
  // steps. Sibling to the agent driver effect above and reusing its exact guard block — "declare
  // blockers step" is deliberately excluded below since that step is handled by the combined effect
  // above regardless of whose turn it is (an agent may be defending against the human's own attack).
  useEffect(() => {
    if (
      mode !== "game" ||
      gameStage !== "playing" ||
      pendingAction ||
      libraryLook ||
      pendingRuleChoice ||
      manualLibrarySearch ||
      blockChoice ||
      basicLandFetchSearch ||
      rulesAdvisorPending > 0 ||
      session.phase === "declare blockers step"
    )
      return;
    if (activeSeatId !== humanSeat.id || priorityStopSettings.fullControl) return;
    const humanSeatIndex = Math.max(0, session.seats.findIndex((seat) => seat.id === humanSeat.id));
    if (priorityStopSettings.phaseStops[stopKey(session.phase, humanSeatIndex)]) return;
    // Footgun guard: an unticked "declare attackers step" would otherwise sail straight past any
    // real attack the human could still declare — there's no pendingAction/choice state guarding
    // that window the way blockChoice/pendingRuleChoice do for defense, since declareAttack mutates
    // the session directly rather than opening one. Stays regardless of the grid so unticking this
    // one cell can't silently make attacking impossible.
    if (session.phase === "declare attackers step") {
      const opponents = session.seats.filter((seat) => seat.id !== humanSeat.id && !seat.hasLost);
      if (legalAttackActions(humanSeat, opponents).length > 0) return;
    }
    const key = `human-advance:${session.turn}:${session.phase}`;
    if (agentDecisionRequests.current.has(key)) return;
    // Guard added inside the timer callback, not here — see the priority-response effect above for
    // why (an eagerly-added guard whose timer gets cancelled by an unrelated re-render orphans
    // forever, since nothing else ever deletes it).
    const timer = window.setTimeout(() => {
      agentDecisionRequests.current.add(key);
      advanceTurn();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    mode,
    gameStage,
    pendingAction,
    libraryLook,
    pendingRuleChoice,
    manualLibrarySearch,
    blockChoice,
    basicLandFetchSearch,
    rulesAdvisorPending,
    activeSeatId,
    session.phase,
    session.turn,
    session.seats,
    humanSeat.id,
    priorityStopSettings
  ]);

  useEffect(() => {
    if (mode !== "game" || gameStage !== "playing" || !pendingRuleChoice) return;
    const controller = session.seats.find((seat) => seat.id === pendingRuleChoice.controllerSeatId);
    if (controller?.kind !== "agent") return;
    const timer = window.setTimeout(() => resolveAgentRuleChoice(pendingRuleChoice), agentPaceMs(900));
    return () => window.clearTimeout(timer);
  }, [mode, gameStage, pendingRuleChoice, session.seats]);

  async function requestAgentDecision(seat: PlayerSeat, purpose: string, legalActions: LegalAgentAction[], sessionOverride?: GameSession, rejectionNotes?: string[], extraContext?: Record<string, unknown>) {
    if (legalActions.length === 0) return undefined;
    // No judgment call to make when there's exactly one legal option — skip the LLM round trip
    // entirely rather than spending a model call on a forced play (e.g. only pass_priority is legal).
    if (legalActions.length === 1) {
      const only = legalActions[0];
      agentDecisionInfo.current[seat.id] = { situation: summarizeSituation({ purpose, phase: (sessionOverride ?? session).phase, turn: (sessionOverride ?? session).turn, ...buildAgentDecisionContext(sessionOverride ?? session, seat, {}) }), options: [{ id: only.id, label: only.label, score: 0 }], chosenId: only.id, turn: (sessionOverride ?? session).turn, phase: (sessionOverride ?? session).phase };
      return {
        actionType: only.actionType,
        legalActionId: only.id,
        targetIds: only.targetIds,
        cardId: only.cardId,
        reason: "Only legal action available.",
        fallbackAction: only.actionType === "end_turn" ? "end_turn" : "pass_priority"
      } satisfies AgentAction;
    }
    const activeSession = sessionOverride ?? session;
    // Surface whatever this seat said it planned to do at its last real decision (e.g. "holding up 2
    // mana for a counterspell"), then clear it — a one-shot relay baton, not a persistent flag. If the
    // agent still wants to hold the plan for the decision after this one, it restates manaPlan below
    // and the baton carries forward again; otherwise it silently lapses. See the field's declaration
    // for why a forced single-legal-action step above must not reach this.
    const previousStatedPlan = agentStatedPlans.current[seat.id];
    delete agentStatedPlans.current[seat.id];
    const decisionContext = buildAgentDecisionContext(activeSession, seat, {
          purpose,
          activeSeatId,
          prioritySeatId,
          phase: activeSession.phase,
          turn: activeSession.turn,
          pendingAction: pendingAction ? pendingActionSummary(activeSession, pendingAction) : undefined,
          stack: stackActions.map((item) => pendingActionSummary(activeSession, item)),
          heuristicHint: purpose === "opening_hand_mulligan" ? evaluateOpeningHand(seat) : undefined,
          previousStatedPlan: previousStatedPlan || undefined
        });
    const response = await fetch("/api/agents/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(AGENT_REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        agentName: seat.agentName ?? seat.name,
        seatName: seat.name,
        // rejectedProposals: moves the legality gate already refused in THIS decision (with the reason), so the model does not pick them again.
        context: { ...decisionContext, ...(extraContext ?? {}), ...(rejectionNotes?.length ? { rejectedProposals: rejectionNotes } : {}) },
        legalActions
      })
    });
    const result = (await response.json()) as {
      source: "ollama" | "fallback" | "invalid";
      message?: string;
      action?: AgentAction;
      options?: Array<{ id: string; label: string; score: number; reasons?: string[] }>;
    };
    // Kept for the 🧠 chat: what this decision looked like, so the human can ask about it afterwards.
    agentDecisionInfo.current[seat.id] = {
      situation: summarizeSituation(decisionContext),
      options: result.options ?? legalActions.slice(0, 8).map((candidate) => ({ id: candidate.id, label: candidate.label, score: 0 })),
      chosenId: result.action?.legalActionId,
      turn: activeSession.turn,
      phase: activeSession.phase
    };
    if (result.message && result.source !== "ollama") {
      addEvent(`${seat.name} agent decision fallback: ${result.message}`, seat.id, "Agent decision");
    }
    if (result.action?.manaPlan) {
      agentStatedPlans.current[seat.id] = result.action.manaPlan;
    }
    return result.action;
  }

  // An agent that keeps choosing the same cast without it ever happening is stuck (the cast is offered as payable but the real cast refuses):
  // after three identical picks in a row that action is dropped for the rest of the phase so the agent can do something else or pass.
  const agentCastAttempts = useRef<{ key: string; count: number }>({ key: "", count: 0 });
  const agentBannedCasts = useRef<Set<string>>(new Set());

  async function decideAgentTurnAction(seat: PlayerSeat, requestKey: string) {
    try {
      const phaseKey = `${session.turn}:${seat.id}:${session.phase}`;
      // Legal options from the LIVE state (not the render closure), minus casts that already failed to complete three times this phase.
      const regenerate = () => {
        const live = latestSessionRef.current;
        const liveSeat = live.seats.find((item) => item.id === seat.id) ?? seat;
        return legalMainPhaseActions(liveSeat, hasPlayedLandThisTurn(seat.id, live.turn), stackStore.ref.current.activeSeatId as string, live.turn, loyaltyActivationsThisTurn.current, live).filter(
          (candidate) => !agentBannedCasts.current.has(`${phaseKey}:${candidate.id}`)
        );
      };
      // Central legality gate (src/lib/moveLegality.ts, checkMoveLegal): a proposal that is stale, hallucinated or illegal is REJECTED (nothing changes), logged,
      // excluded from this decision's options, and the seat decides again — at most MAX_DECISION_REJECTIONS times, then the best remaining legal action, else pass.
      const decision = await decideWithGate({
        regenerate,
        ask: (options, notes) => requestAgentDecision(seat, "main_phase", options, undefined, notes),
        check: (candidate) => {
          const live = latestSessionRef.current;
          return checkMoveLegal(live, seat.id, candidate, {
            mode: "agent",
            hasPlayedLand: hasPlayedLandThisTurn(seat.id, live.turn),
            activeSeatId: stackStore.ref.current.activeSeatId as string,
            stackEmpty: !stackStore.ref.current.pending,
            fresh: regenerate()
          });
        },
        onReject: (rejection) => addEvent(`${seat.name} tried ${rejection.label} but it is not legal: ${rejection.reason}; nothing was spent.`, seat.id, "Rules action")
      });
      const action = decision.proposal;
      const legal = decision.action;
      if (!legal) {
        advanceTurn();
        return;
      }
      if (legal.actionType === "cast_spell" || legal.actionType === "cast_commander") {
        const attemptKey = `${phaseKey}:${legal.id}`;
        agentCastAttempts.current = agentCastAttempts.current.key === attemptKey ? { key: attemptKey, count: agentCastAttempts.current.count + 1 } : { key: attemptKey, count: 1 };
        if (agentCastAttempts.current.count >= 3) {
          agentBannedCasts.current.add(attemptKey);
          addEvent(`${seat.name} could not complete ${legal.label} after several tries; it will do something else this phase.`, seat.id, "Rules action");
          agentCastAttempts.current = { key: "", count: 0 };
          window.setTimeout(() => advanceTurn(), 0);
          return;
        }
      } else {
        agentCastAttempts.current = { key: "", count: 0 };
      }
      addEvent(`${seat.name} chooses ${legal.label}. ${action?.reason ?? ""}`.trim(), seat.id, "Agent decision");
      recordAgentReasoning(seat.id, { label: legal.label, reason: action?.reason ?? "", deliberation: action?.deliberation, purpose: "main_phase", at: new Date().toISOString() });
      applyAgentTurnAction(seat, legal);
    } catch (error) {
      addEvent(`${seat.name} agent decision failed: ${error instanceof Error ? error.message : "unknown error"}.`, seat.id, "Agent decision");
      applyAgentTurnAction(
        seat,
        fallbackLegalAction(legalMainPhaseActions(seat, hasPlayedLandThisTurn(seat.id, session.turn), activeSeatId, session.turn, loyaltyActivationsThisTurn.current, session))
      );
    } finally {
      agentDecisionRequests.current.delete(requestKey);
      markAgentThinking(seat.id, false);
    }
  }

  async function decideAgentAttackers(seat: PlayerSeat, requestKey: string) {
    let workingSession = session;
    try {
      let guard = 0;
      while (guard < 20) {
        guard += 1;
        const currentSeat = workingSession.seats.find((item) => item.id === seat.id);
        if (!currentSeat) break;
        const opponents = workingSession.seats.filter((item) => item.id !== seat.id && !item.hasLost);
        const legalActions = legalAttackActions(currentSeat, opponents);
        if (!legalActions.some((item) => item.actionType === "attack")) break;
        // Same central gate: an attacker that is tapped/summoning sick/gone is rejected with a reason and the agent re-decides; if it cannot name a legal
        // attacker it declares no more attackers (never an attack the rules forbid).
        const attackSession = workingSession;
        const decision = await decideWithGate({
          regenerate: () => legalAttackActions(attackSession.seats.find((item) => item.id === seat.id) ?? currentSeat, opponents),
          ask: (options, notes) => requestAgentDecision(currentSeat, "declare_attackers", options, attackSession, notes),
          check: (candidate) => checkMoveLegal(attackSession, seat.id, candidate, { mode: "agent", hasPlayedLand: true, activeSeatId, stackEmpty: true, fresh: legalActions }),
          onReject: (rejection) => addEvent(`${seat.name} tried ${rejection.label} but it is not legal: ${rejection.reason}.`, seat.id, "Rules action"),
          preferPass: true
        });
        const action = decision.proposal;
        const legal = decision.action;
        if (!legal || legal.actionType !== "attack" || !legal.cardId) break;
        workingSession = declareAttack(workingSession, seat.id, legal.cardId, legal.targetIds[0]);
        workingSession = {
          ...workingSession,
          events: [
            {
              id: crypto.randomUUID(),
              at: new Date().toISOString(),
              seatId: seat.id,
              message: `${seat.name} declares an attacker: ${legal.label}. ${action?.reason ?? ""}`.trim(),
              detail: "Agent decision"
            },
            ...workingSession.events
          ]
        };
        recordAgentReasoning(seat.id, { label: legal.label, reason: action?.reason ?? "", purpose: "declare_attackers", at: new Date().toISOString() });
      }
      // Whatever the agent chose, creatures that must attack do (goaded ones not at the player who goaded them).
      const agentSeat = workingSession.seats.find((item) => item.id === seat.id);
      for (const forced of agentSeat ? forcedAttackers(workingSession, agentSeat) : []) {
        const forcedTarget = forced.targetIds.map((id) => workingSession.seats.find((item) => item.id === id)).filter((item): item is PlayerSeat => Boolean(item)).sort((a, b) => a.life - b.life)[0];
        if (forcedTarget) workingSession = declareAttack(workingSession, seat.id, forced.cardId, forcedTarget.id);
      }
    } catch (error) {
      workingSession = {
        ...workingSession,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: seat.id,
            message: `${seat.name} attacker declaration failed: ${error instanceof Error ? error.message : "unknown error"}.`,
            detail: "Agent decision"
          },
          ...workingSession.events
        ]
      };
    } finally {
      setSession(workingSession);
      window.setTimeout(() => advanceTurn(), 0);
      agentDecisionRequests.current.delete(requestKey);
      markAgentThinking(seat.id, false);
    }
  }

  async function decideAgentPriorityAction(seat: PlayerSeat, actionOnStack: PendingAction, requestKey: string) {
    try {
      // Cheap pre-filter before the full decision call (Phase 5a item 3) — canReceivePriorityForPendingAction
      // already confirmed this seat has a genuine instant-speed option, so skipping here isn't "nothing
      // to do," it's "nothing about this specific event gives a reason to consider that option."
      if (isPendingActionLikelyIrrelevantToSeat(seat, actionOnStack, session)) {
        passPriority();
        return;
      }
      // Same central gate as the main phase. The live state is read after the (possibly slow) model call: if the stack moved on meanwhile
      // (the spell resolved, was countered) the proposed response is stale and rejected instead of cast into the wrong situation.
      const regenerate = () => {
        const live = latestSessionRef.current;
        const liveSeat = live.seats.find((item) => item.id === seat.id) ?? seat;
        const livePending = stackStore.ref.current.pending;
        if (!livePending || livePending.id !== actionOnStack.id) return [{ id: "pass-priority", actionType: "pass_priority" as const, targetIds: [], label: "pass priority" }];
        return legalPriorityActions(liveSeat, livePending, stackStore.ref.current.activeSeatId as string, live);
      };
      const decision = await decideWithGate({
        regenerate,
        ask: (options, notes) => requestAgentDecision(seat, "priority_response", options, undefined, notes),
        check: (candidate) =>
          checkMoveLegal(latestSessionRef.current, seat.id, candidate, {
            mode: "agent",
            hasPlayedLand: true,
            activeSeatId: stackStore.ref.current.activeSeatId as string,
            stackEmpty: !stackStore.ref.current.pending,
            fresh: regenerate()
          }),
        onReject: (rejection) => addEvent(`${seat.name} tried ${rejection.label} but it is not legal: ${rejection.reason}; nothing was spent.`, seat.id, "Rules action")
      });
      const action = decision.proposal;
      const legal = decision.action;
      if (!legal) {
        passPriority();
        return;
      }
      addEvent(`${seat.name} chooses ${legal.label}. ${action?.reason ?? ""}`.trim(), seat.id, "Agent decision");
      recordAgentReasoning(seat.id, { label: legal.label, reason: action?.reason ?? "", deliberation: action?.deliberation, purpose: "priority_response", at: new Date().toISOString() });
      applyAgentPriorityAction(seat, legal, actionOnStack);
    } catch (error) {
      addEvent(`${seat.name} priority decision failed: ${error instanceof Error ? error.message : "unknown error"}.`, seat.id, "Agent decision");
      passPriority();
    } finally {
      agentDecisionRequests.current.delete(requestKey);
      markAgentThinking(seat.id, false);
    }
  }

  // Loops the same way decideAgentAttackers loops over multiple attack declarations: each pass
  // offers every not-yet-chosen eligible blocker for this one attacker plus "no more blockers",
  // so the agent can keep adding creatures to a gang-block before the attacker is finally marked
  // decided — mirroring the human toggle-then-confirm flow's "pick order = damage order" semantics.
  async function decideAgentBlockAction(seat: PlayerSeat, choice: BlockChoiceState, requestKey: string) {
    const chosenBlockerIds: string[] = [];
    let noBlockReason = "";
    try {
      let guard = 0;
      while (guard < 8) {
        guard += 1;
        const legalActions = legalBlockActions(session, choice).filter((item) => item.actionType !== "block" || !chosenBlockerIds.includes(item.cardId ?? ""));
        if (!legalActions.some((item) => item.actionType === "block")) break;
        const purpose = chosenBlockerIds.length > 0 ? "declare_blockers_additional" : "declare_blockers";
        const blockDecision = await decideWithGate({
          regenerate: () => legalBlockActions(latestSessionRef.current, choice).filter((item) => item.actionType !== "block" || !chosenBlockerIds.includes(item.cardId ?? "")),
          ask: (options, notes) => requestAgentDecision(seat, purpose, options, undefined, notes, chosenBlockerIds.length > 0 ? { blockingSoFar: [...chosenBlockerIds] } : undefined),
          check: (candidate) => checkMoveLegal(latestSessionRef.current, seat.id, candidate, { mode: "agent", hasPlayedLand: true, activeSeatId, stackEmpty: true, fresh: legalActions }),
          onReject: (rejection) => addEvent(`${seat.name} tried ${rejection.label} but it is not legal: ${rejection.reason}.`, seat.id, "Rules action"),
          preferPass: true
        });
        const action = blockDecision.proposal;
        const legal = blockDecision.action;
        if (!legal || legal.actionType !== "block" || !legal.cardId) {
          noBlockReason = action?.reason ?? "";
          break;
        }
        chosenBlockerIds.push(legal.cardId);
        addEvent(`${seat.name} adds ${legal.label}. ${action?.reason ?? ""}`.trim(), seat.id, "Agent decision");
        recordAgentReasoning(seat.id, { label: legal.label, reason: action?.reason ?? "", purpose: "declare_blockers", at: new Date().toISOString() });
      }
      if (chosenBlockerIds.length === 0) {
        addEvent(`${seat.name} chooses no blocks. ${noBlockReason}`.trim(), seat.id, "Agent decision");
        // Recorded like every other decision, so "ask the agent about this decision" explains THIS choice instead of the last priority pass.
        recordAgentReasoning(seat.id, { label: `declare no blockers vs ${session.seats.flatMap((item) => item.board.battlefield).find((card) => card.id === choice.attackerCardId)?.name ?? "the attacker"}`, reason: noBlockReason, purpose: "declare_blockers", at: new Date().toISOString() });
      }
      setSession((current) => assignBlockers(current, choice, chosenBlockerIds));
    } catch (error) {
      addEvent(`${seat.name} block decision failed: ${error instanceof Error ? error.message : "unknown error"}.`, seat.id, "Agent decision");
      setSession((current) => assignBlockers(current, choice, chosenBlockerIds));
    } finally {
      agentDecisionRequests.current.delete(requestKey);
      markAgentThinking(seat.id, false);
    }
  }

  function applyAgentTurnAction(seat: PlayerSeat, action: LegalAgentAction | undefined) {
    if (action?.actionType === "end_turn") {
      // Same rule-514.1 check as the human's endTurn() — an agent choosing "end_turn" hits the
      // exact same shortcut that skips past the cleanup step, so it needs the same guard.
      const maxHandSize = effectiveMaxHandSize(seat);
      const requiredDiscards = seat.board.hand.length - maxHandSize;
      if (requiredDiscards > 0) {
        pendingEndTurnAfterDiscard.current = seat.id;
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "discard_to_hand_size",
          controllerSeatId: seat.id,
          prompt: seatVerb(
            seat,
            `${seat.name} has ${seat.board.hand.length} cards and must discard down to ${maxHandSize} before ending the turn.`,
            `You have ${seat.board.hand.length} cards and must discard down to ${maxHandSize} before ending the turn.`
          ),
          requiredDiscards
        });
        return;
      }
      setSelectedHandCardId(undefined);
      setPriorityPasses([]);
      setSession((current) => resolveEndTurn(current, seat.id));
      return;
    }
    if (!action || action.actionType === "pass_priority") {
      advanceTurn();
      return;
    }
    if (action.actionType === "play_land" && action.cardId) {
      playCard(seat.id, action.cardId, undefined, action.sourceZone === "exile" ? "exile" : "hand", action.faceIndex);
      return;
    }
    if ((action.actionType === "cast_spell" || action.actionType === "cast_commander") && action.cardId) {
      agentMainActions.current.add(`${session.turn}:${seat.id}:${session.phase}`);
      playCard(seat.id, action.cardId, undefined, action.actionType === "cast_commander" ? "command" : action.sourceZone === "exile" ? "exile" : action.sourceZone === "graveyard" ? "graveyard" : action.sourceZone === "library" ? "library" : "hand", action.faceIndex);
      return;
    }
    if (action.actionType === "activate_ability" && action.cardId && action.abilityKind === "basic_land_fetch") {
      activateBasicLandFetchForAgent(seat.id, action.cardId);
      return;
    }
    if (action.actionType === "activate_ability" && action.cardId && action.abilityKind === "unlock_room_door" && action.faceIndex !== undefined) {
      unlockRoomDoor(seat.id, action.cardId, action.faceIndex);
      return;
    }
    if (action.actionType === "activate_ability" && action.cardId && action.abilityKind === "generic_sacrifice" && action.abilityIndex !== undefined) {
      activateGenericSacrificeAbility(seat.id, action.cardId, action.abilityIndex);
      return;
    }
    if (action.actionType === "activate_ability" && action.cardId && action.abilityKind === "generic_tap" && action.abilityIndex !== undefined) {
      activateGenericTapAbility(seat.id, action.cardId, action.abilityIndex);
      return;
    }
    if (action.actionType === "activate_ability" && action.cardId && action.abilityKind === "self_untap" && action.abilityIndex !== undefined) {
      activateSelfUntapAbility(seat.id, action.cardId, action.abilityIndex);
      return;
    }
    if (action.actionType === "activate_ability" && action.cardId && action.abilityKind === "cycling") {
      cycleCard(seat.id, action.cardId);
      return;
    }
    if (action.actionType === "activate_ability" && action.cardId && action.abilityKind === "generic_mana" && action.abilityIndex !== undefined) {
      activateGenericManaAbility(seat.id, action.cardId, action.abilityIndex);
      return;
    }
    if (action.actionType === "activate_ability" && action.cardId && action.abilityKind === "myriad_landscape") {
      activateMyriadLandscapeForAgent(seat.id, action.cardId);
      return;
    }
    if (action.actionType === "activate_ability" && action.cardId && action.abilityKind === "equip") {
      setSession((current) => resolveEquip(current, seat.id, action.cardId!)?.session ?? current);
      return;
    }
    if (action.actionType === "activate_ability" && action.cardId && action.abilityKind === "animate_manland") {
      activateManlandAnimation(seat.id, action.cardId);
      return;
    }
    if (action.actionType === "activate_ability" && action.cardId && action.abilityKind === "loyalty_ability" && action.loyaltyCost !== undefined) {
      activateLoyaltyAbility(seat.id, action.cardId, action.loyaltyCost, action.detail ?? "");
      return;
    }
    advanceTurn();
  }

  function shouldAgentFastForwardToEndStep(seat: PlayerSeat) {
    if (pendingAction || pendingRuleChoice || libraryLook || manualLibrarySearch || blockChoice || basicLandFetchSearch) return false;
    if (session.phase === "end step" || session.phase === "cleanup step") return false;
    if (!isMainPhase(session.phase) && session.phase !== "declare attackers step") return false;
    if (phaseTriggeredCards(seat, session.phase as TurnPhase).length > 0) return false;

    const hasMainAction = hasAgentMainPhaseAction(seat, hasPlayedLandThisTurn(seat.id, session.turn), activeSeatId, session.turn, loyaltyActivationsThisTurn.current, session);
    const hasAttack = seat.board.battlefield.some((card) => canAttack(card, seat.board.battlefield));

    if (session.phase === "precombat main phase") return !hasMainAction && !hasAttack;
    if (session.phase === "declare attackers step") return !hasAttack && !hasAgentMainPhaseAction(seat, true, activeSeatId, session.turn, loyaltyActivationsThisTurn.current, session);
    if (session.phase === "postcombat main phase") return !hasMainAction;
    return false;
  }

  function fastForwardAgentToEndStep(seatId: string) {
    setSession((current) => {
      const active = current.seats.find((seat) => seat.id === seatId);
      if (!active || current.activePlayerId !== seatId || current.phase === "end step" || current.phase === "cleanup step") return current;
      clearAllManaPools(current.seats);
      setPrioritySeatId(nextSeatId(current.seats, seatId));
      return clearCombatState({
        ...current,
        phase: "end step",
        events: [
          phaseEvent(seatId, `${active.name} has no profitable actions and moves to the end step.`),
          ...current.events
        ]
      });
    });
  }

  function applyAgentPriorityAction(seat: PlayerSeat, legal: LegalAgentAction, actionOnStack: PendingAction) {
    if (actionOnStack.type === "trigger" && actionOnStack.controllerSeatId === seat.id && legal.id === "resolve-trigger") {
      // The controller's "resolve" is only its own pass (rule 117.4): when another seat (the human, or an agent holding a real
      // instant-speed response) is also required, priority moves on to them and the trigger resolves once all have passed.
      // With nobody else required this is the old direct, log-free fast path.
      const required = pendingActionRequiredPasses(session.seats, actionOnStack, activeSeatId, session, manaPools, priorityStopSettings, holdPriorityOnce ? humanSeat.id : undefined);
      if (required.some((seatId) => seatId !== seat.id && !priorityPasses.includes(seatId))) {
        passPriority();
        return;
      }
      resolveAgentPendingTrigger(actionOnStack);
      return;
    }
    if (legal.actionType === "cast_spell" && legal.cardId) {
      agentRespondWithCard(seat, legal.cardId, legal.sourceZone === "exile" ? "exile" : "hand");
      return;
    }
    if (legal.actionType === "activate_ability" && legal.cardId && legal.abilityKind === "basic_land_fetch") {
      activateBasicLandFetchForAgent(seat.id, legal.cardId);
      window.setTimeout(() => passPriority(), 0);
      return;
    }
    if (legal.actionType === "activate_ability" && legal.cardId && legal.abilityKind === "generic_sacrifice" && legal.abilityIndex !== undefined) {
      activateGenericSacrificeAbility(seat.id, legal.cardId, legal.abilityIndex);
      window.setTimeout(() => passPriority(), 0);
      return;
    }
    if (legal.actionType === "activate_ability" && legal.cardId && legal.abilityKind === "generic_tap" && legal.abilityIndex !== undefined) {
      activateGenericTapAbility(seat.id, legal.cardId, legal.abilityIndex);
      window.setTimeout(() => passPriority(), 0);
      return;
    }
    if (legal.actionType === "activate_ability" && legal.cardId && legal.abilityKind === "self_untap" && legal.abilityIndex !== undefined) {
      activateSelfUntapAbility(seat.id, legal.cardId, legal.abilityIndex);
      window.setTimeout(() => passPriority(), 0);
      return;
    }
    if (legal.actionType === "activate_ability" && legal.cardId && legal.abilityKind === "generic_mana" && legal.abilityIndex !== undefined) {
      activateGenericManaAbility(seat.id, legal.cardId, legal.abilityIndex);
      window.setTimeout(() => passPriority(), 0);
      return;
    }
    if (legal.actionType === "activate_ability" && legal.cardId && legal.abilityKind === "myriad_landscape") {
      activateMyriadLandscapeForAgent(seat.id, legal.cardId);
      window.setTimeout(() => passPriority(), 0);
      return;
    }
    passPriority();
  }

  function agentRespondWithCard(seat: PlayerSeat, cardId: string, sourceZone: "hand" | "exile" = "hand") {
    if (!pendingAction) return;
    const card = sourceZone === "exile" ? findExiledCardAnySeat(session, cardId) : seat.board.hand.find((item) => item.id === cardId);
    // canCastAtInstantSpeed applies identically regardless of source — an exiled sorcery still
    // can't be flashed in, only an exiled instant/flash card can. flashGranted mirrors
    // legalPriorityActions' own check (a battlefield Vedalken Orrery/Leyline of Anticipation), so an
    // agent offered this response as legal there doesn't get silently refused here.
    if (!card || !(canCastAtInstantSpeed(card, seatHasFlashGrant(seat, card)) || (sourceZone === "exile" && card.exiledPlayableAnyTime))) {
      passPriority();
      return;
    }
    // Backstop gate (the decision loop already validated this): target, lockout, timing. Nothing is spent when it refuses.
    const gate = checkMoveLegal(session, seat.id, { id: `respond${sourceZone === "exile" ? "-exile" : ""}:${cardId}`, actionType: "cast_spell", cardId, sourceZone: sourceZone === "exile" ? "exile" : undefined, targetIds: [], label: `respond with ${card.name}` }, { mode: "human", hasPlayedLand: true, activeSeatId, stackEmpty: false });
    if (!gate.legal) {
      addEvent(`${seat.name} tried to respond with ${card.name} but it is not legal: ${gate.reason}; nothing was spent.`, seat.id, "Rules action");
      passPriority();
      return;
    }
    const fixedCost = adjustedCastingCost(seat, card, card.manaValue, sourceZone === "exile" ? "exile" : "hand", activeSeatId, session.seats);
    const chosenX = maxAffordableX(seat, card, fixedCost);
    const adjustedCost = totalCastingCost(seat, card, card.manaValue, chosenX, session.seats);
    const payment = payCastingCost(seat.id, seat, card, adjustedCost);
    if (!payment.ok) {
      addEvent(cannotPayMessage(seat, card, selectedManaTotal(seat, payment.sourceIds), adjustedCost, payment.reason), seat.id, "Mana");
      passPriority();
      return;
    }
    applyCastingCostPaymentSideEffect(seat.id, payment);
    const counterAbility = parseCounterSpellAbility(card.oracleText);
    const counterTargetId = counterAbility && pendingAction.type === "spell" ? pendingAction.id : undefined;
    // Targets are named as the response is put on the stack (rule 601.2c), same as an agent's main-phase cast, so the human sees them and can respond.
    const castChoices = card.faces?.length ? undefined : agentCastTimeRemovalChoices(session, seat.id, card, chosenX > 0 ? chosenX : undefined);
    const targetText = stackTargetText(session, castChoices?.targets ?? [], counterTargetId && pendingAction.type === "spell" ? pendingAction.cardName ?? "a spell" : undefined, castModeLabels(card, chosenX > 0 ? chosenX : undefined, castChoices));
    const action: PendingAction = {
      id: crypto.randomUUID(),
      type: "spell",
      actorSeatId: seat.id,
      cardId,
      cardName: card.name,
      cardTypeLine: card.typeLine,
      sourceZone: sourceZone === "exile" ? "exile" : undefined,
      manaSourceIds: payment.sourceIds,
      manaSpentColors: spentManaColors(payment.spent),
      chosenX: chosenX > 0 ? chosenX : undefined,
      counterTargetId,
      castChoices,
      message: `${seat.name} responds with ${card.name}${chosenX > 0 ? ` (X=${chosenX})` : ""}${sourceZone === "exile" ? " from exile" : ""}${targetText} using ${manaPoolTotal(payment.spent)} mana.`
    };
    beginPendingAction(action, "Stack");
  }

  function resolveAgentPendingTrigger(trigger: Extract<PendingAction, { type: "trigger" }>) {
    setPendingAction(undefined);
    setPriorityPasses([]);
    const remainingStack = removeStackAction(trigger.id);
    beginTriggerResolution(trigger, remainingStack);
  }

  async function buildDeck(config: SeatConfig) {
    const commander = config.commander.trim() || fallbackCommander(config.name);
    const colors = inferColors(commander);
    updateConfig(config.seatId, {
      commander,
      status: "building",
      message: config.mode === "decklist" ? "Validating deck list..." : "Asking Ollama to build this deck..."
    });

    const response = await fetch("/api/decks/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentName: config.name,
        commander,
        colors,
        deckList: config.mode === "decklist" ? config.deckList : undefined
      })
    });
    const result = (await response.json()) as {
      source: "decklist" | "ollama" | "ollama-invalid" | "error";
      message: string;
      notes?: string;
      deck?: CommanderDeck;
    };
    if (!result.deck) {
      updateConfig(config.seatId, { status: "error", message: result.message || "Deck build failed." });
      return;
    }
    const deck = result.deck;
    const activity = [
      result.source === "ollama"
        ? `${config.name} received an Ollama deck draft and the app repaired/validated it against the card catalog.`
        : result.source === "ollama-invalid"
          ? `${config.name} received an Ollama deck draft, but it still failed validation.`
          : `${config.name} validated the pasted deck list.`,
      result.notes ? `Agent notes: ${result.notes}` : undefined,
      `Deck score ${deck.score.total}. ${deck.validation.cardCount} cards. ${deck.validation.gameChangerCount} Game Changers.`,
      ...deck.score.notes
    ].filter((item): item is string => Boolean(item));

    updateConfig(config.seatId, {
      commander,
      deck,
      deckList: formatDeckList(deck),
      status: deck.validation.legal ? "ready" : "error",
      message:
        result.source === "decklist"
          ? result.message
          : result.source === "ollama"
          ? "Ollama built and validated this deck."
          : deck.validation.errors[0] ?? result.message,
      activity
    });
  }

  async function startGame() {
    if (gameStarting) return;
    setGameStarting(true);
    try {
      await startGameInner();
    } finally {
      setGameStarting(false);
    }
  }

  async function startGameInner() {
    setSetupMessage(undefined);
    const validated = validateConfigsForPlay(configs);
    if (!validated.ready) {
      setConfigs(validated.configs);
      const blockers = validated.configs.filter((config) => config.status === "error").map((config) => `${config.name}: ${config.message}`);
      setSetupMessage(`Cannot start yet. ${blockers.join(" ")}`);
      return;
    }

    const deckedSeats = session.seats.map((seat) => {
      const config = validated.configs.find((item) => item.seatId === seat.id);
      if (!config?.deck) return seat;
      return applyDeckToSeat(seat, config.deck);
    });
    const openingSeats = deckedSeats.map((seat) => withOpeningHand(seat, 7, 0));
    // Every agent seat's mulligan decision below is its own live Ollama round-trip — the single
    // most important call this session makes, and the one place a timeout is most costly, since
    // there's no cache to fall back on for a first-ever decision. Started AFTER resolving mulligans
    // (not before/concurrently, as this used to) so it never competes with them for the same local
    // Ollama instance's (typically serial, not truly parallel) generation queue — reported live as
    // agent mulligans themselves timing out ("Ollama is unavailable") because this fire-and-forget
    // prewarm's own PREWARM_CONCURRENCY-many requests were already occupying it. Still fire-and-
    // forget and still never delays the game actually starting (that still means "mulligans
    // resolved, ready to play," not "every setup step finished") — it now runs during the human's
    // own opening-hand deliberation instead, a naturally idle window for Ollama. Runs over every
    // seat's full deck (not just the human's) since the cache is shared board-wide — any seat
    // encountering a card benefits every other seat's later encounter of the same card too.
    const agentResolved = await resolveAgentMulligansWithLLM(openingSeats);
    void prewarmRuleWorkflowCache(openingSeats);
    const nextSession: GameSession = {
      ...session,
      status: "ready",
      winnerSeatId: undefined,
      attackPool: undefined,
      activePlayerId: activeSeatId,
      phase: "opening hand",
      turn: 0,
      seats: agentResolved.seats,
      // Nothing from a previous game carries over: monarch, initiative, dungeon progress, queued triggers and per-turn bookkeeping all start fresh.
      monarchSeatId: undefined,
      monarchDrawTurn: undefined,
      initiativeSeatId: undefined,
      undercityRooms: undefined,
      pendingVentureRooms: undefined,
      pendingVentureChoices: undefined,
      pendingEntries: undefined,
      pendingDeaths: undefined,
      pendingLeaves: undefined,
      pendingSacrificeChoices: undefined,
      pendingCounterChoices: undefined,
      pendingDiscardChoices: undefined,
      pendingDiscoverChoices: undefined,
      pendingPunisherChoices: undefined,
      pendingBraidsChoices: undefined,
      pendingFreeCastChoices: undefined,
      pendingCombatDamageToPlayer: undefined,
      pendingAttackDeclarations: undefined,
      pendingBlockDeclarations: undefined,
      extraCombatsPending: undefined,
      extraTurnsQueue: undefined,
      extraBeginningPhaseActive: undefined,
      onceEachTurnEffectsUsed: undefined,
      events: [
        ...agentResolved.events,
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          message: "Opening hands drawn. Choose whether to keep or mulligan."
        },
        ...session.events
      ]
    };
    // Per-turn bookkeeping is keyed by turn number, so a restarted game (turn 1 again) would find the last game's entries: forget them all.
    for (const ref of [agentMainActions, agentDecisionRequests, landPlaysThisTurn, firstDrawThisTurn, loyaltyActivationsThisTurn, phaseTriggersChecked, cleanupDiscardChecked, cleanupRestrictedManaChecked]) ref.current.clear();
    spellsCastThisTurn.current.clear();
    agentStatedPlans.current = {};
    setRestrictedManaBatches({});
    setSession(nextSession);
    setMulligans(agentResolved.mulligans);
    setKeptHands(agentResolved.keptHands);
    setMulliganReturnCardIds([]);
    setPendingAction(undefined);
    replaceStackActions([]);
    setPriorityPasses([]);
    setManaPools({});
    setManaContributions({});
    setManaChoice(undefined);
    setManualLibrarySearch(undefined);
    setPendingRuleChoice(undefined);
    setBlockChoice(undefined);
    setSetupMessage(undefined);
    setGameStage("mulligan");
    setGameOverDismissed(false);
    setMode("game");
  }

  // Whether Save is currently allowed, and why not if it isn't — every transient/in-flight value
  // this checks is provably empty when it returns ok, so buildSaveSnapshot below never has to
  // serialize PendingAction, the stack, an open choice modal, or an in-flight agent LLM call.
  function currentCleanSaveStopStatus() {
    return isCleanSaveStop({
      mode,
      gameStage,
      sessionStatus: session.status,
      hasPendingAction: Boolean(pendingAction),
      stackActionCount: stackActions.length,
      hasOpenModal: Boolean(
        libraryLook ||
          manualLibrarySearch ||
          pendingRuleChoice ||
          blockChoice ||
          myriadSearch ||
          myriadTapChoice ||
          basicLandFetchSearch ||
          manaChoice ||
          inspectedCard ||
          selectedHandCardId ||
          selectedBlockerIds.length > 0 ||
          mulliganReturnCardIds.length > 0
      ),
      pendingDeathsCount: session.pendingDeaths?.length ?? 0,
      pendingEntriesCount: session.pendingEntries?.length ?? 0,
      pendingCombatDamageToPlayerCount: session.pendingCombatDamageToPlayer?.length ?? 0,
      pendingGraveyardDeparturesCount: session.pendingGraveyardDepartures?.length ?? 0,
      anyAgentThinking: Object.values(agentThinking).some(Boolean),
      prioritySeatId,
      humanSeatId: humanSeat.id
    });
  }

  function buildSaveSnapshot(): GameSnapshot {
    return {
      formatVersion: SAVE_FORMAT_VERSION,
      savedAt: new Date().toISOString(),
      session,
      ...stackStore.snapshot(),
      gameStage,
      holdPriorityOnce,
      mulligans,
      keptHands,
      manaPools,
      manaContributions,
      restrictedManaBatches,
      turnCounters: serializeTurnCounters({
        landPlaysThisTurn: landPlaysThisTurn.current,
        spellsCastThisTurn: spellsCastThisTurn.current,
        firstDrawThisTurn: firstDrawThisTurn.current,
        loyaltyActivationsThisTurn: loyaltyActivationsThisTurn.current,
        phaseTriggersChecked: phaseTriggersChecked.current,
        cleanupDiscardChecked: cleanupDiscardChecked.current,
        cleanupRestrictedManaChecked: cleanupRestrictedManaChecked.current,
        agentMainActions: agentMainActions.current,
        commanderZoneChoiceAsked: commanderZoneChoiceAsked.current,
        auraRetargetAsked: auraRetargetAsked.current
      })
    };
  }

  async function saveGameNow() {
    const status = currentCleanSaveStopStatus();
    if (!status.ok) return;
    const activeSeatName = session.seats.find((seat) => seat.id === activeSeatId)?.name ?? "Unknown";
    const name = `Turn ${session.turn} — ${activeSeatName}`;
    try {
      const response = await fetch("/api/saves", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, snapshot: buildSaveSnapshot() })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      addEvent(`Saved "${name}".`, undefined, "Rules action");
    } catch (error) {
      addEvent(`Failed to save the game: ${error instanceof Error ? error.message : "unknown error"}.`, undefined, "Rules action");
    }
  }

  // The mirror image of startGameInner's own tail above — restores every piece of state that tail
  // resets, then hands off to the game screen exactly the way starting a fresh game does. No page
  // reload, so there's no SSR/hydration path to get wrong.
  function applySnapshot(snapshot: GameSnapshot) {
    if (snapshot.formatVersion !== SAVE_FORMAT_VERSION) {
      setSetupMessage(`This save is from an incompatible version (format ${snapshot.formatVersion}, this build expects ${SAVE_FORMAT_VERSION}) and can't be loaded.`);
      return;
    }
    setSession(snapshot.session);
    stackStore.restore(snapshot, snapshot.session.seats[1]?.id ?? snapshot.session.seats[0].id); // seats + passes; clears pending and stack
    setGameStage(snapshot.gameStage);
    setHoldPriorityOnce(snapshot.holdPriorityOnce);
    setMulligans(snapshot.mulligans);
    setKeptHands(snapshot.keptHands);
    setManaPools(snapshot.manaPools);
    setManaContributions(snapshot.manaContributions);
    setRestrictedManaBatches(snapshot.restrictedManaBatches);
    const counters = deserializeTurnCounters(snapshot.turnCounters);
    landPlaysThisTurn.current = counters.landPlaysThisTurn;
    spellsCastThisTurn.current = counters.spellsCastThisTurn;
    firstDrawThisTurn.current = counters.firstDrawThisTurn;
    loyaltyActivationsThisTurn.current = counters.loyaltyActivationsThisTurn;
    phaseTriggersChecked.current = counters.phaseTriggersChecked;
    cleanupDiscardChecked.current = counters.cleanupDiscardChecked;
    cleanupRestrictedManaChecked.current = counters.cleanupRestrictedManaChecked;
    agentMainActions.current = counters.agentMainActions;
    commanderZoneChoiceAsked.current = counters.commanderZoneChoiceAsked;
    auraRetargetAsked.current = counters.auraRetargetAsked;
    agentDecisionRequests.current = new Set();
    // Every one of these is guaranteed empty by the clean-stop gate at save time — cleared here too
    // since this game object (React state, not the snapshot) may still be carrying stale values from
    // whatever was on screen just before Load was clicked.
    setMulliganReturnCardIds([]);
    setLibraryLook(undefined);
    setManualLibrarySearch(undefined);
    setPendingRuleChoice(undefined);
    setBlockChoice(undefined);
    setSelectedBlockerIds([]);
    setMyriadSearch(undefined);
    setMyriadTapChoice(undefined);
    setBasicLandFetchSearch(undefined);
    setManaChoice(undefined);
    setSelectedHandCardId(undefined);
    setInspectedCard(undefined);
    setAgentThinking({});
    setAgentReasoning({});
    defaultDecksApplied.current = true;
    setConfigs(createInitialConfigs(snapshot.session.seats));
    setSetupMessage(undefined);
    setMode("game");
  }

  async function loadSavedGame(id: string) {
    try {
      const response = await fetch(`/api/saves/${id}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot: GameSnapshot = await response.json();
      applySnapshot(snapshot);
    } catch (error) {
      setSetupMessage(`Failed to load save: ${error instanceof Error ? error.message : "unknown error"}.`);
    }
  }

  async function deleteSavedGameEntry(id: string) {
    setSavedGames((current) => current.filter((item) => item.id !== id));
    try {
      await fetch(`/api/saves/${id}`, { method: "DELETE" });
    } catch {
      // Best-effort — the row already dropped from view; a failed DELETE just leaves a stale row
      // server-side until the next successful one, no different from any other fire-and-forget
      // cleanup in this file.
    }
  }

  async function resolveAgentMulligansWithLLM(seats: PlayerSeat[]) {
    const mulliganCounts: Record<string, number> = {};
    const kept: Record<string, boolean> = {};
    const events: GameEvent[] = [];
    const resolvedSeats: PlayerSeat[] = [];

    // One warm-up per distinct agent model, all at once, before any real decision request below —
    // see warmUpAgentModel. They used to run one-per-seat inside the loop (so each seat's warm-up
    // queued behind the previous seat's whole mulligan chain); they are independent, so overlap them.
    await Promise.all(
      Array.from(new Set(seats.filter((seat) => seat.kind === "agent").map((seat) => seat.agentName ?? seat.name))).map((agentName) => warmUpAgentModel(agentName))
    );

    for (const seat of seats) {
      if (seat.kind !== "agent") {
        resolvedSeats.push(seat);
        continue;
      }

      let nextSeat = seat;
      let count = 0;
      while (count < MULLIGAN_HARD_CAP) {
        // Past the soft cap, stop grinding down to a tiny hand unless there's still no land to
        // show for it — a 4-card hand is already a real handicap, and it's rarely worth going
        // lower just to smooth the curve further. Landless is the one case worth pushing past it.
        if (count >= MULLIGAN_SOFT_CAP && nextSeat.board.hand.some(isLandCard)) break;
        const actions: LegalAgentAction[] = [
          { id: "keep-hand", actionType: "keep_hand", targetIds: [], label: `keep ${openingHandKeepSize(count)}` },
          { id: "mulligan", actionType: "mulligan", targetIds: [], label: "take a mulligan" }
        ];
        // Computed here (not just inside requestAgentDecision's own context-building) so the event
        // log can show WHY, not just WHAT — previously this heuristic verdict and the LLM's own
        // stated reason were both computed/requested but silently discarded, leaving
        // describeMulliganOutcome's bare "kept/mulliganed N" as the only visible record. Reported
        // live as "I still think they think weird sometimes" with no way to see the reasoning at all.
        const heuristicHint = evaluateOpeningHand(nextSeat, count);
        let chosen: AgentAction | undefined;
        // A forceMulligan hand is mulliganed whatever the model says (see overrodeKeep below), so the
        // live Ollama round-trip (~3-4s measured, up to the 40s timeout) can't change the outcome — skip it.
        if (!heuristicHint.forceMulligan) {
          try {
            chosen = await requestAgentDecision(nextSeat, "opening_hand_mulligan", actions);
          } catch {
            chosen = undefined;
          }
        }
        let chosenId = chosen?.legalActionId ?? (agentKeepsHand(nextSeat, count) ? "keep-hand" : "mulligan");
        // heuristicHint.forceMulligan is the same "not a judgment call" tier as the 0/7-lands
        // automatic mulligan — route.ts's system prompt only ever advises the model to defer to the
        // heuristic, and a small local model can still talk itself into keeping a hand this bad with
        // reasoning that doesn't hold up. Override the model's choice outright rather than trust the
        // prompt wording to hold in every case.
        const overrodeKeep = heuristicHint.forceMulligan && chosenId === "keep-hand";
        if (overrodeKeep) chosenId = "mulligan";
        // After two mulligans each further one costs a card: a hand the heuristic calls keepable (2-5 lands) is kept whatever the model says,
        // or the agent spirals down to a 4-card hand with nothing to play.
        if (count >= 2 && heuristicHint.keep && chosenId === "mulligan") chosenId = "keep-hand";
        const decisionLabel = chosenId === "keep-hand" ? `keeps its ${openingHandKeepSize(count)}-card hand` : `mulligans its ${openingHandKeepSize(count)}-card hand`;
        const reasonParts = [
          overrodeKeep ? "overriding the model's proposed keep — hand quality too low to keep" : chosen?.reason?.trim(),
          heuristicHint.reasons.length > 0 ? `heuristic: ${heuristicHint.reasons.join("; ")}` : undefined
        ].filter((part): part is string => Boolean(part));
        const reasoningText = reasonParts.length > 0 ? ` ${reasonParts.join(" — ")}.` : "";
        events.push({
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: seat.id,
          message: `${seat.name} ${decisionLabel}.${reasoningText}`,
          detail: "Agent decision"
        });
        recordAgentReasoning(seat.id, {
          label: chosenId === "keep-hand" ? "keep hand" : "mulligan",
          reason: reasonParts.join(" — "),
          purpose: "opening_hand_mulligan",
          at: new Date().toISOString()
        });
        if (chosenId === "keep-hand") break;
        count += 1;
        nextSeat = withOpeningHand(nextSeat, 7, count);
      }

      mulliganCounts[seat.id] = count;
      kept[seat.id] = true;
      nextSeat = keepOpeningHandSize(nextSeat, openingHandKeepSize(count));
      resolvedSeats.push(nextSeat);
    }

    return { seats: resolvedSeats, mulligans: mulliganCounts, keptHands: kept, events };
  }

  function keepOpeningHand() {
    const keepSize = openingHandKeepSize(mulligans[humanSeat.id] ?? 0);
    const returnCount = Math.max(0, humanSeat.board.hand.length - keepSize);
    if (mulliganReturnCardIds.length !== returnCount) {
      addEvent(`Choose ${returnCount} card${returnCount === 1 ? "" : "s"} to shuffle into your library before keeping.`, humanSeat.id, "Mulligan");
      return;
    }
    // Every seat has now kept a hand (agents resolved their mulligans up front in startGame; the
    // human is the last to confirm) — this is the correct moment to roll for who plays first,
    // rather than defaulting to a fixed seat.
    const { winnerId: firstSeatId, rolls } = rollForStartingSeat(session.seats);
    setKeptHands((current) => ({ ...current, [humanSeat.id]: true }));
    setMulliganReturnCardIds([]);
    setGameStage("playing");
    setActiveSeatId(firstSeatId);
    setPrioritySeatId(nextSeatId(session.seats, firstSeatId));
    setSession((current) => {
      const started: GameSession = {
      ...current,
      status: "playing",
      activePlayerId: firstSeatId,
      phase: "untap step",
      turn: 1,
      seats: current.seats.map((seat) => (seat.id === humanSeat.id ? keepOpeningHandSize(seat, keepSize, mulliganReturnCardIds, true) : seat)),
      events: [
        phaseEvent(
          firstSeatId,
          (() => {
            const firstSeat = current.seats.find((seat) => seat.id === firstSeatId);
            return firstSeat ? seatVerb(firstSeat, `${firstSeat.name} starts turn 1: untap step.`, "You start turn 1: untap step.") : "Player starts turn 1: untap step.";
          })()
        ),
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          message: `${current.seats
            .map((seat) => `${seat.name} rolls ${rolls[seat.id] ?? "?"}`)
            .join(", ")}. ${current.seats.find((seat) => seat.id === firstSeatId)?.name ?? "Player"} wins the roll and goes first.`,
          detail: "Starting player roll"
        },
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: humanSeat.id,
          message: keepSize === 7 ? "You kept 7. The game begins." : `You kept ${keepSize} and shuffled ${7 - keepSize} card${7 - keepSize === 1 ? "" : "s"} into your library. The game begins.`
        },
        ...current.events
      ]
      };
      // Leylines and friends: agents always begin the game with them on the battlefield.
      return started.seats.filter((seat) => seat.kind !== "human").reduce(
        (next, seat) => openingHandBattlefieldCards(seat).reduce((inner, card) => putOpeningHandCardOnBattlefield(inner, seat.id, card.id), next),
        started
      );
    });
    // ...and the human is asked about each one in their opening hand.
    const humanLeylines = openingHandBattlefieldCards({ ...humanSeat, board: { ...humanSeat.board, hand: humanSeat.board.hand.filter((card) => !mulliganReturnCardIds.includes(card.id)) } });
    if (humanLeylines.length > 0) {
      window.setTimeout(() => askOpeningHandBattlefield(humanSeat.id, humanLeylines.map((card) => card.id)), 100);
    }
  }

  function askOpeningHandBattlefield(seatId: string, remainingIds: string[]) {
    const [cardId, ...rest] = remainingIds;
    const card = session.seats.find((item) => item.id === seatId)?.board.hand.find((entry) => entry.id === cardId);
    if (!cardId) return;
    // Not found in the (possibly stale) closure: ask by id anyway through the trigger's own source info.
    const shim = card ?? ({ id: cardId, name: "Opening-hand card", typeLine: "", oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "hand" } as VisibleCard);
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "choose_trigger_option",
      controllerSeatId: seatId,
      sourceCardId: cardId,
      sourceCardName: shim.name,
      prompt: `${shim.name}: begin the game with it on the battlefield?`,
      options: [{ index: 0, label: "Yes, put it onto the battlefield" }, { index: 1, label: "No, keep it in hand" }],
      trigger: makeCommonTrigger(seatId, seatId, shim, { kind: "opening_hand_battlefield", remainingIds: rest }, shim.name + " opening hand."),
      remainingStack: []
    });
  }

  function mulliganOpeningHand() {
    const currentCount = mulligans[humanSeat.id] ?? 0;
    const nextCount = currentCount + 1;
    const nextKeepSize = openingHandKeepSize(nextCount);
    setMulligans((current) => ({ ...current, [humanSeat.id]: nextCount }));
    setSelectedHandCardId(undefined);
    setMulliganReturnCardIds([]);
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) => (seat.id === humanSeat.id ? withOpeningHand(seat, 7, nextCount) : seat)),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: humanSeat.id,
          message: nextCount === 1 ? "You shuffled your hand into your library and drew 7. First mulligan is free; you can still keep 7." : `You shuffled your hand into your library and drew 7. Choose ${7 - nextKeepSize} card${7 - nextKeepSize === 1 ? "" : "s"} not to keep.`
        },
        ...current.events
      ]
    }));
  }

  function toggleMulliganReturnCard(card: VisibleCard) {
    const keepSize = openingHandKeepSize(mulligans[humanSeat.id] ?? 0);
    const required = Math.max(0, humanSeat.board.hand.length - keepSize);
    if (required === 0) return;
    setMulliganReturnCardIds((current) => {
      if (current.includes(card.id)) return current.filter((id) => id !== card.id);
      if (current.length >= required) return current;
      return [...current, card.id];
    });
  }

  function advanceTurn() {
    if (pendingAction) return;
    const activeSeat = session.seats.find((seat) => seat.id === activeSeatId);
    if (!activeSeat) return;
    // "Attacks each combat if able" / goaded: a human can't pass the declare attackers step with such a creature still home.
    if (activeSeat.kind === "human" && session.phase === "declare attackers step" && !pendingRuleChoice) {
      const forced = forcedAttackers(session, activeSeat)[0];
      if (forced) {
        const card = activeSeat.board.battlefield.find((entry) => entry.id === forced.cardId);
        if (card && forced.targetIds.length === 1) {
          const targetName = session.seats.find((entry) => entry.id === forced.targetIds[0])?.name ?? "the defender";
          setSession((current) => declareAttack(current, activeSeat.id, forced.cardId, forced.targetIds[0]));
          addEvent(`${card.name} must attack each combat; it attacks ${targetName}.`, activeSeat.id, "Rules action");
          return;
        }
        if (card) {
          setPendingRuleChoice({
            id: crypto.randomUUID(),
            kind: "choose_trigger_option",
            controllerSeatId: activeSeat.id,
            sourceCardId: card.id,
            sourceCardName: card.name,
            prompt: `${card.name} must attack each combat: whom does it attack?`,
            options: forced.targetIds.map((id, index) => ({ index, label: "Attack " + (session.seats.find((entry) => entry.id === id)?.name ?? id) })),
            trigger: makeCommonTrigger(activeSeat.id, activeSeat.id, card, { kind: "forced_attack", cardId: card.id, targetIds: forced.targetIds }, card.name + " must attack."),
            remainingStack: []
          });
          return;
        }
      }
    }
    const action: PendingAction = {
      id: crypto.randomUUID(),
      type: "phase",
      actorSeatId: activeSeat.id,
      message: seatVerb(activeSeat, `${activeSeat.name} wants to pass ${session.phase}.`, `You want to pass ${session.phase}.`)
    };
    setSelectedHandCardId(undefined);
    beginPendingAction(action, "Priority window");
  }

  function endTurn() {
    if (pendingAction) return;
    const activeSeat = session.seats.find((seat) => seat.id === activeSeatId);
    if (!activeSeat || activeSeat.id !== humanSeat.id) return;
    // Rule 514.1: discard down to the maximum hand size before the turn actually ends. The
    // shortcut this button takes skips straight past the cleanup step (where that normally
    // happens) to the next player's untap step, so it has to check for this itself instead of
    // relying on the cleanup-step effect ever getting a chance to run.
    // The shortcut would skip combat entirely, which a creature that must attack doesn't allow.
    if (["untap step", "upkeep step", "draw step", "precombat main phase", "beginning of combat step"].includes(session.phase)) {
      const mustAttack = forcedAttackers(session, activeSeat)[0];
      const mustAttackCard = mustAttack ? activeSeat.board.battlefield.find((entry) => entry.id === mustAttack.cardId) : undefined;
      if (mustAttackCard) {
        addEvent(`${mustAttackCard.name} must attack each combat; move to combat instead of ending the turn.`, activeSeat.id, "Rules action");
        return;
      }
    }
    const maxHandSize = effectiveMaxHandSize(activeSeat);
    const requiredDiscards = activeSeat.board.hand.length - maxHandSize;
    if (requiredDiscards > 0) {
      pendingEndTurnAfterDiscard.current = activeSeat.id;
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "discard_to_hand_size",
        controllerSeatId: activeSeat.id,
        prompt: seatVerb(
          activeSeat,
          `${activeSeat.name} has ${activeSeat.board.hand.length} cards and must discard down to ${maxHandSize} before ending the turn.`,
          `You have ${activeSeat.board.hand.length} cards and must discard down to ${maxHandSize} before ending the turn.`
        ),
        requiredDiscards
      });
      return;
    }

    // Don't let this shortcut silently skip past a phase where something on the board (anyone's
    // board — "at the beginning of each end step"/"each upkeep" cards fire off the active player's
    // own turn too) still has a triggered ability waiting to fire, e.g. an end step trigger, or a
    // beginning-of-combat trigger the human hasn't reached yet. When one exists somewhere between
    // here and cleanup, advance a single phase at a time instead so the normal per-phase trigger
    // detection (the phaseTriggersChecked effect above) gets a chance to run, rather than jumping
    // straight to the next player's untap step the way the full skip below does.
    const remainingPhases = TURN_PHASES.slice(Math.max(0, TURN_PHASES.indexOf(session.phase as TurnPhase)));
    const hasPendingTrigger = remainingPhases.some(
      (phase) => session.seats.some((seat) => phaseTriggeredCards(seat, phase).length > 0) || anyPhaseTrigger(session.seats, phase, activeSeat.id, { delayed: session.delayedPhaseTriggers, turn: session.turn })
    );
    // Shadow of the Second Sun's extra untap/upkeep/draw never shows up in phaseTriggeredCards
    // (the Aura granting it lives on its caster's battlefield, not the active seat's, and its own
    // trigger text doesn't match the generic phase-trigger patterns anyway — see
    // hasExtraBeginningPhaseAura) — checked separately so this shortcut can't skip straight past it
    // to the next player's untap step the same way a real pending trigger already prevents above.
    const hasPendingExtraBeginningPhase =
      TURN_PHASES.indexOf(session.phase as TurnPhase) <= TURN_PHASES.indexOf("postcombat main phase") &&
      hasExtraBeginningPhaseAura(session, activeSeat.id);
    if (hasPendingTrigger || hasPendingExtraBeginningPhase) {
      setPriorityPasses([]);
      setSession((current) => resolvePhaseAdvance(current));
      return;
    }

    setSelectedHandCardId(undefined);
    setPriorityPasses([]);
    setSession((current) => resolveEndTurn(current, activeSeat.id));
  }

  function resolvePhaseAdvance(current: GameSession) {
    const activeId = current.activePlayerId ?? activeSeatId;
    const activeIndex = Math.max(0, current.seats.findIndex((seat) => seat.id === activeId));
    const activeSeat = current.seats[activeIndex];
    const phaseIndex = TURN_PHASES.indexOf(current.phase as TurnPhase);
    let nextPhase = phaseIndex >= 0 ? TURN_PHASES[phaseIndex + 1] : TURN_PHASES[0];
    // Shadow of the Second Sun: "At the beginning of each of enchanted player's postcombat main
    // phases, there is an additional beginning phase after this phase." Reroutes postcombat main's
    // normal -> end step transition through a real untap/upkeep/draw sequence instead (see
    // extraBeginningPhaseActive's doc comment on GameSession) so every other permanent's own
    // upkeep-triggered ability (Mystic Remora's cumulative upkeep, etc.) fires exactly like it would
    // on any other turn — this isn't a separate hand-rolled resolution path, just the same phases
    // visited twice.
    let extraBeginningPhaseActive = current.extraBeginningPhaseActive;
    // Additional combat phase: passing end of combat loops back to beginning of combat once per owed extra combat.
    let extraCombatsPending = current.extraCombatsPending;
    if (current.phase === "end of combat step" && (extraCombatsPending ?? 0) > 0) {
      nextPhase = "beginning of combat step";
      extraCombatsPending = (extraCombatsPending ?? 0) - 1;
    }
    if (current.phase === "postcombat main phase" && hasExtraBeginningPhaseAura(current, activeSeat.id)) {
      nextPhase = "untap step";
      extraBeginningPhaseActive = true;
    } else if (current.phase === "draw step" && current.extraBeginningPhaseActive) {
      nextPhase = "end step";
      extraBeginningPhaseActive = false;
    }
    clearAllManaPools(current.seats);

    if (!nextPhase) {
      // nextSeatForTurn (not a raw nextInRotation call) so a queued extra turn (rule 500.7 —
      // Temporal Mastery, Time Warp, ...) takes priority over normal rotation, the same way
      // resolveEndTurn already checks it — this is the only other place a turn changes hands.
      const { seat: nextSeat, queue } = nextSeatForTurn(current.seats, activeIndex, current.extraTurnsQueue);
      setActiveSeatId(nextSeat.id);
      setPrioritySeatId(nextSeatId(current.seats, nextSeat.id));
      loyaltyActivationsThisTurn.current.clear();
      return runPhaseActions(
        clearTemporaryBuffs({
          ...current,
          activePlayerId: nextSeat.id,
          extraCombatsPending: undefined,
          turn: current.turn + 1,
          phase: TURN_PHASES[0],
          extraTurnsQueue: queue,
          extraBeginningPhaseActive: false,
          // session.turn is an internal per-seat turn index (it increments once for every individual
          // player's turn, so a 4-player game's first full round is turns 1-4, not turn 1) — real
          // players talk about "turn 1/2/3" meaning the round (everyone's Nth turn), so the
          // player-facing event text divides it down instead of showing the raw internal counter.
          events: [
            phaseEvent(
              nextSeat.id,
              seatVerb(
                nextSeat,
                `${nextSeat.name} starts ${nextSeat.id === activeId ? "an extra turn" : `turn ${Math.max(1, Math.ceil((current.turn + 1) / Math.max(1, current.seats.length)))}`}: ${TURN_PHASES[0]}.`,
                `You start ${nextSeat.id === activeId ? "an extra turn" : `turn ${Math.max(1, Math.ceil((current.turn + 1) / Math.max(1, current.seats.length)))}`}: ${TURN_PHASES[0]}.`
              )
            ),
            ...current.events
          ]
        }),
        nextSeat.id,
        TURN_PHASES[0]
      );
    }

    setPrioritySeatId(nextSeatId(current.seats, activeSeat.id));
    return runPhaseActions(
      {
        ...current,
        phase: nextPhase,
        extraBeginningPhaseActive,
        extraCombatsPending,
        events: [
          phaseEvent(activeSeat.id, seatVerb(activeSeat, `${activeSeat.name} passes to ${nextPhase}.`, `You pass to ${nextPhase}.`)),
          ...current.events
        ]
      },
      activeSeat.id,
      nextPhase
    );
  }

  function resolveEndTurn(rawCurrent: GameSession, seatId: string) {
    // The End Turn shortcut skips the end step, so its "beginning of your end step" effects happen here instead.
    const current = applyEndStepEffects(rawCurrent, seatId);
    const activeIndex = Math.max(0, current.seats.findIndex((seat) => seat.id === seatId));
    const activeSeat = current.seats[activeIndex];
    if (!activeSeat) return current;

    const { seat: nextSeat, queue } = nextSeatForTurn(current.seats, activeIndex, current.extraTurnsQueue);
    clearAllManaPools(current.seats);
    setActiveSeatId(nextSeat.id);
    setPrioritySeatId(nextSeatId(current.seats, nextSeat.id));
    loyaltyActivationsThisTurn.current.clear();

    const cleaned = cleanupCombat(
      {
        ...current,
        events: [
          phaseEvent(
            activeSeat.id,
            seatVerb(activeSeat, `${activeSeat.name} ends their turn and skips the remaining phases.`, "You end your turn and skip the remaining phases.")
          ),
          ...current.events
        ]
      },
      activeSeat.id
    );

    return runPhaseActions(
      clearTemporaryBuffs({
        ...cleaned,
        activePlayerId: nextSeat.id,
          extraCombatsPending: undefined,
        turn: current.turn + 1,
        phase: TURN_PHASES[0],
        extraTurnsQueue: queue,
        extraBeginningPhaseActive: false,
        events: [
          phaseEvent(
            nextSeat.id,
            seatVerb(
              nextSeat,
              `${nextSeat.name} starts ${nextSeat.id === seatId ? "an extra turn" : `turn ${Math.max(1, Math.ceil((current.turn + 1) / Math.max(1, current.seats.length)))}`}: ${TURN_PHASES[0]}.`,
              `You start ${nextSeat.id === seatId ? "an extra turn" : `turn ${Math.max(1, Math.ceil((current.turn + 1) / Math.max(1, current.seats.length)))}`}: ${TURN_PHASES[0]}.`
            )
          ),
          ...cleaned.events
        ]
      }),
      nextSeat.id,
      TURN_PHASES[0]
    );
  }

  function runPhaseActions(session: GameSession, seatId: string, phase: TurnPhase): GameSession {
    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat) return session;

    if (phase === "untap step") {
      return untapForSeat(session, seatId);
    }

    if (phase === "upkeep step") {
      session = resolvePendingUpkeepDraws(session);
      // Initiative: the player who has it ventures into the Undercity at the beginning of their upkeep.
      if (session.initiativeSeatId === seatId) session = ventureIntoUndercity(session, seatId);
    }

    if (phase === "draw step") {
      // "Skip your draw step." (Dragon Appeasement, Damia, Colfenor's Plans)
      if (seat.board.battlefield.some((card) => !card.abilitiesStripped && /^skip your draw step\.?$/im.test(card.oracleText.replace(/\([^)]*\)/g, "")))) {
        return rulesEvent(advanceSagaLoreCounters(session, seatId), seatId, `${seat.name} skips their draw step.`);
      }
      const drawnSession = drawForSeat(session, seatId, seatVerb(seat, `${seat.name} draws for turn.`, "You draw for turn."));
      return advanceSagaLoreCounters(drawnSession, seatId);
    }

    if (phase === "combat damage step") {
      return resolveCombatDamage(session, seatId);
    }

    if (phase === "end of combat step") {
      return cleanupCombat(session, seatId);
    }

    return session;
  }

  // Arcane Denial's "at the beginning of the next turn's upkeep" delayed draws (see
  // GameSession.pendingUpkeepDraws and parseDelayedUpkeepDraws) — "the next turn's upkeep" means
  // the very next upkeep step that begins, whoever's turn it is, not each scheduled seat's own next
  // upkeep. So this drains the WHOLE queue the first time any upkeep step is reached, rather than
  // filtering by the seat whose upkeep this is.
  // Adds one Saga's next lore counter and, if that counter lands on one of its own numbered
  // chapters, resolves that chapter's effect (triggerSagaChapter below) and, only for a Saga whose
  // reminder text actually calls for it (chapters.sacrificesOnFinalChapter — see its own doc comment
  // on SagaChapters), sacrifices it once its counters reach its own final chapter (rule 714.4) —
  // safe to do right away regardless of which of triggerSagaChapter's resolution paths that final
  // chapter took, since none of them depend on the source permanent still being on the battlefield
  // once queued (see its own comment). A transforming Saga (Fable of the Mirror-Breaker, ...) or a
  // bounce-style one (The Aesir Escape Valhalla) has sacrificesOnFinalChapter false precisely because
  // its own final chapter's effect (handled by triggerSagaChapter, above) already relocated or
  // transformed it — sacrificing it too here would fight that. Shared by both real moments a Saga
  // gains a counter: entering the battlefield (chapter 1, via applySagaEntryLoreCounter below) and
  // each of its controller's later draw steps (advanceSagaLoreCounters below, looping over every
  // Saga still short of its own chapter count).
  function applySagaLoreCounter(session: GameSession, seatId: string, saga: VisibleCard, chapters: SagaChapters): GameSession {
    let next = applyLoreCounterEtb(session, seatId, saga.id);
    const newCount = loreCounterCount(saga) + 1;
    const chapterText = chapters.effectByChapter.get(newCount);
    if (chapterText) next = triggerSagaChapter(next, seatId, saga, chapterText);
    if (newCount >= chapters.chapterCount && chapters.sacrificesOnFinalChapter) next = moveCardBetweenVisibleZones(next, seatId, saga.id, "graveyard");
    return next;
  }

  // Rule 714.2a's "as this Saga enters" half — looks the just-entered card up by id (rather than
  // trusting whatever pre-entry face data a caller has on hand) so loreCounterCount always reads the
  // real, freshly-placed permanent's own counters (always 0 here, but this keeps the same single
  // source of truth applySagaLoreCounter's other caller uses). A no-op for a non-Saga or a card not
  // actually on this seat's battlefield.
  // Read ahead: the Saga starts with the chosen number of lore counters and only THAT chapter triggers (skipped chapters don't).
  function applySagaReadAhead(session: GameSession, seatId: string, saga: VisibleCard, chapters: SagaChapters, chapter: number): GameSession {
    let next = session;
    for (let index = 0; index < chapter; index += 1) next = applyLoreCounterEtb(next, seatId, saga.id);
    const chapterText = chapters.effectByChapter.get(chapter);
    if (chapterText) next = triggerSagaChapter(next, seatId, saga, chapterText);
    if (chapter >= chapters.chapterCount && chapters.sacrificesOnFinalChapter) next = moveCardBetweenVisibleZones(next, seatId, saga.id, "graveyard");
    return next;
  }

  function applySagaEntryLoreCounter(session: GameSession, seatId: string, cardId: string): GameSession {
    const saga = session.seats.find((seat) => seat.id === seatId)?.board.battlefield.find((card) => card.id === cardId);
    const chapters = saga ? parseSagaChapters(saga.oracleText) : undefined;
    if (saga && chapters && /^read ahead\b/im.test(saga.oracleText)) {
      const controller = session.seats.find((seat) => seat.id === seatId);
      if (controller?.kind === "human") {
        window.setTimeout(
          () =>
            setPendingRuleChoice({
              id: crypto.randomUUID(),
              kind: "choose_trigger_option",
              controllerSeatId: seatId,
              sourceCardId: saga.id,
              sourceCardName: saga.name,
              prompt: saga.name + ": read ahead — choose the chapter to start on.",
              options: Array.from({ length: chapters.chapterCount }, (_, index) => ({ index, label: "Chapter " + (index + 1) + " — " + (chapters.effectByChapter.get(index + 1) ?? "").slice(0, 90) })),
              trigger: makeCommonTrigger(seatId, seatId, saga, { kind: "read_ahead", chapterCount: chapters.chapterCount }, saga.name + " read ahead."),
              remainingStack: []
            }),
          0
        );
        return session;
      }
      return applySagaReadAhead(session, seatId, saga, chapters, chooseReadAheadChapter(session, seatId, chapters));
    }
    return saga && chapters ? applySagaLoreCounter(session, seatId, saga, chapters) : session;
  }

  // Rule 714.2a's "after your draw step" half. Generalizes what advanceUrzaSagaLoreCounters (Urza's
  // Saga only, hardcoded to exactly 3 chapters and Urza's Saga's own chapter III search) used to do:
  // works for any real Saga, using parseSagaChapters to learn its own chapter count and each
  // chapter's own effect text from its actual printed oracle text instead.
  function advanceSagaLoreCounters(session: GameSession, seatId: string): GameSession {
    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat) return session;
    const sagas = seat.board.battlefield
      .map((card) => ({ card, chapters: parseSagaChapters(card.oracleText) }))
      .filter((entry): entry is { card: VisibleCard; chapters: SagaChapters } => Boolean(entry.chapters) && loreCounterCount(entry.card) < entry.chapters!.chapterCount);
    if (sagas.length === 0) return session;

    let next = session;
    for (const { card: saga, chapters } of sagas) {
      next = applySagaLoreCounter(next, seatId, saga, chapters);
    }

    return next;
  }

  // Resolves one Saga chapter's own effect text, generalizing the same "deterministic first, LLM/DSL
  // fallback second" shape activateLoyaltyAbility already uses for a loyalty ability's text (a
  // structurally identical case: one card, several numbered/gated sub-abilities). Four paths, tried
  // in order:
  // 1. "This Saga gains \"...\"" (Urza's Saga chapter I/II) — not a one-shot effect at all, so it's
  //    applied directly here rather than through the trigger/DSL pipeline: append the granted text
  //    onto the Saga's own oracleText, the same pattern parseEnterAsCopyEffect's copy targets
  //    (Mirrormade, Estrid's Invocation) already use for a permanent's oracleText growing to
  //    include more text.
  // 2. "Exile this Saga, then return it to the battlefield transformed ..." (Fable of the Mirror-
  //    Breaker and the rest of the "transforming Saga" template) / "Exile ~, then return it to the
  //    battlefield (front face up)." (the Final Fantasy/March of the Machine "Dominant" cycle —
  //    Elesh Norn // The Argent Etchings, Urabrask // The Great Work, ...; a Saga printed on the BACK
  //    face of a transforming legendary creature, so its own final chapter flips back to the FRONT
  //    face instead — mechanically the same flip, just worded from the other direction) — these are
  //    exactly the shape sacrificesOnFinalChapter is false for (see SagaChapters' own doc comment),
  //    so both are applied directly via the same transformPermanent flip every other transforming
  //    permanent in this engine already uses (Growing Rites of Itlimoc's phase trigger, Heliod,
  //    Westvale Abbey, ...), rather than routed through commonTriggerEffect (no "transform"
  //    TriggerEffect kind exists) or the Rules Advisor (no transform workflow either).
  //    transformPermanent's own flip (currentFaceIndex 0 <-> 1) is direction-agnostic, so the same
  //    call is correct whichever face this chapter is written from. A declared simplification shared
  //    with those other transform call sites: a real exile-then-return is a new object and would
  //    retrigger ETBs and reset summoning sickness, neither of which transformPermanent's in-place
  //    flip does.
  // 3. commonTriggerEffect recognizes the shape (a plain draw/destroy/mill/token/etc. effect) — queue
  //    it as a real trigger, deferred via setTimeout to dodge reentrancy (queueCommonTriggers calls
  //    beginPendingAction, so calling it synchronously from inside advanceSagaLoreCounters — itself
  //    called from deep inside a setSession updater via runPhaseActions — would be reentrant).
  // 4. Neither matches — defer to consultRulesAdvisor (deterministicRuleWorkflow, then the primitive-
  //    action-plan LLM fallback), same "saga_chapter" treatment as loyalty_ability: a shallow-copied
  //    card whose oracleText is replaced by just this chapter's own clause. Also deferred, for the
  //    same reentrancy reason — consultRulesAdvisor itself calls setSession.
  function triggerSagaChapter(session: GameSession, seatId: string, saga: VisibleCard, chapterText: string): GameSession {
    const grantedAbility = parseGainsAbilityGrant(chapterText);
    if (grantedAbility) {
      return {
        ...session,
        seats: session.seats.map((seat) =>
          seat.id === seatId
            ? {
                ...seat,
                board: {
                  ...seat.board,
                  battlefield: seat.board.battlefield.map((card) =>
                    card.id === saga.id ? { ...card, oracleText: `${card.oracleText}\n${grantedAbility}` } : card
                  )
                }
              }
            : seat
        )
      };
    }
    if (isSagaTransformChapter(chapterText)) {
      return transformPermanent(session, seatId, saga.id, saga.name, false);
    }
    const effect = commonTriggerEffect(chapterText, "clause");
    if (effect) {
      const trigger: Extract<PendingAction, { type: "trigger" }> = {
        id: crypto.randomUUID(),
        type: "trigger",
        actorSeatId: seatId,
        controllerSeatId: seatId,
        sourceCardId: saga.id,
        sourceCardName: saga.name,
        triggerKind: "common",
        effect,
        message: `${saga.name}'s chapter triggers.`
      };
      window.setTimeout(() => queueCommonTriggers([trigger]), 0);
      return session;
    }
    window.setTimeout(() => void consultRulesAdvisor("saga_chapter", seatId, { ...saga, oracleText: chapterText }), 0);
    return session;
  }

  function declareAttack(session: GameSession, seatId: string, cardId: string | undefined, targetId: string | undefined): GameSession {
    const attacker = session.seats.find((seat) => seat.id === seatId);
    if (!attacker) return session;
    const attackingCard = attacker.board.battlefield.find((card) => card.id === cardId && canAttack(card, attacker.board.battlefield) && !attackLockedOut(session, card));
    const target = resolveAttackTarget(session, targetId);

    if (!attackingCard || !target) {
      return {
        ...session,
        events: [phaseEvent(seatId, seatVerb(attacker, `${attacker.name} declares no attackers.`, "You declare no attackers.")), ...session.events]
      };
    }

    const targetLabel = target.planeswalker ? `${target.planeswalker.name} (${target.seat.name})` : target.seat.name;
    const tax = totalAttackTax(target.seat, Boolean(target.planeswalker));
    const taxCard = genericCostShim(tax);
    // Prefer whatever the attacker (a human) has already manually tapped into their floating pool —
    // same pool-first-then-auto-tap preference as every other cost in this engine, so choosing which
    // specific lands pay an attack tax actually works instead of always auto-tapping invisibly.
    const attackerPool = attacker.kind === "human" ? poolForSeat(seatId) : undefined;
    const taxPoolPayment = tax > 0 && attackerPool ? payCostFromPool(attackerPool, taxCard, tax) : undefined;
    const payment = tax > 0 ? (taxPoolPayment?.ok ? taxPoolPayment : chooseManaSourcesForCost(attacker, taxCard, tax, undefined, session.seats)) : undefined;
    if (tax > 0 && !payment?.ok) {
      return {
        ...session,
        events: [
          phaseEvent(
            seatId,
            seatVerb(
              attacker,
              `${attacker.name} cannot attack ${targetLabel} with ${attackingCard.name}: unable to pay the {${tax}} attack tax.`,
              `You cannot attack ${targetLabel} with ${attackingCard.name}: unable to pay the {${tax}} attack tax.`
            )
          ),
          ...session.events
        ]
      };
    }
    if (taxPoolPayment?.ok) {
      setSeatManaPool(seatId, taxPoolPayment.pool);
      clearManaContributions(seatId);
    }

    const staysUntapped = hasVigilance(attackingCard);
    const taxedAttacker = payment?.ok && !taxPoolPayment?.ok ? spendManaSources(attacker, payment.sourceIds) : attacker;

    const attackDeclaredSession: GameSession = {
      ...session,
      attackPool: session.attackPool?.turn === session.turn ? session.attackPool : { turn: session.turn, ids: attacker.board.battlefield.map((card) => card.id) },
      // Drained by the pendingAttackDeclarations effect, which queues this attacker's "whenever ... attacks"
      // triggers (and any watcher's, e.g. Marchesa's Decree on the defending player's side).
      pendingAttackDeclarations: [...(session.pendingAttackDeclarations ?? []), { seatId, card: { ...attackingCard, attacking: true }, defendingSeatId: target.seat.id }],
      seats: session.seats.map((seat) =>
        seat.id === seatId
          ? {
              ...taxedAttacker,
              board: {
                ...taxedAttacker.board,
                battlefield: taxedAttacker.board.battlefield.map((card) =>
                  card.id === attackingCard.id
                    ? { ...card, attacking: true, tapped: staysUntapped ? card.tapped : true, attackTargetId: target.planeswalker?.id ?? target.seat.id }
                    : card
                )
              }
            }
          : seat
      ),
      events: [
        phaseEvent(
          seatId,
          seatVerb(
            attacker,
            `${attacker.name} attacks ${targetLabel} with ${attackingCard.name}${tax > 0 ? ` after paying {${tax}} for the attack tax` : ""}.`,
            `You attack ${targetLabel} with ${attackingCard.name}${tax > 0 ? ` after paying {${tax}} for the attack tax` : ""}.`
          )
        ),
        ...session.events
      ]
    };

    // Klauth, Unrivaled Ancient: "Whenever ~ attacks, add X mana in any combination of colors,
    // where X is the total power of attacking creatures. Spend this mana only to cast spells. Until
    // end of turn, you don't lose this mana as steps and phases end." X is read off THIS seat's
    // currently-attacking creatures at the moment this specific attack is declared — this engine
    // declares attackers one at a time (not as one simultaneous batch the way real Magic's declare-
    // attackers step works), so if Klauth isn't the last attacker declared this combat, X undercounts
    // the eventual full attacking party; a real, disclosed simplification rather than a rules-perfect
    // model. A human gets a real choice of how to split X across colors (distribute_attack_trigger_
    // mana); an agent gets an immediate heuristic split (see attackTriggerManaHeuristicSplit).
    if (isAttackTriggerAddManaClause(attackingCard.oracleText)) {
      const attackerSeatAfterDeclare = attackDeclaredSession.seats.find((item) => item.id === seatId);
      const totalAttackingPower = (attackerSeatAfterDeclare?.board.battlefield ?? [])
        .filter((permanent) => permanent.attacking)
        .reduce((total, permanent) => total + effectivePower(permanent), 0);
      if (totalAttackingPower > 0) {
        if (attacker.kind === "human") {
          window.setTimeout(
            () =>
              setPendingRuleChoice({
                id: crypto.randomUUID(),
                kind: "distribute_attack_trigger_mana",
                controllerSeatId: seatId,
                sourceCardId: attackingCard.id,
                sourceCardName: attackingCard.name,
                prompt: `${attackingCard.name}: distribute ${totalAttackingPower} mana among any combination of colors.`,
                amount: totalAttackingPower
              }),
            0
          );
        } else {
          addRestrictedManaBatch(seatId, attackingCard.name, attackTriggerManaHeuristicSplit(attacker, totalAttackingPower));
        }
      }
    }

    // "Metalcraft — Whenever this creature attacks, if you control three or more artifacts,
    // creatures your opponents control lose all abilities and have base power and toughness N/N
    // until end of turn." (Vedalken Humiliator) — checked directly here for the same reason as the
    // "whenever you attack a player" block just below: this needs to know exactly which creature is
    // attacking and who its controller's opponents are, which the generic "declare attackers step"
    // phase-trigger sweep (fires once per phase entry regardless of which creature is actually
    // attacking, with no concept of "this creature" or "your opponents") can't express — reported
    // live as it debuffing the attacker's own creatures instead of the opponents'.
    const metalcraftDebuff = parseMetalcraftAttackDebuff(attackingCard.oracleText);
    const controlsThreeOrMoreArtifacts = taxedAttacker.board.battlefield.filter((card) => hasCardType(card, "Artifact")).length >= 3;
    const metalcraftDebuffedSession =
      metalcraftDebuff && controlsThreeOrMoreArtifacts
        ? applyMetalcraftAttackDebuff(attackDeclaredSession, seatId, attackingCard.name, metalcraftDebuff)
        : attackDeclaredSession;

    // "Whenever you attack a player, EFFECT" (Soaring Lightbringer's token creation, ...) — a
    // genuinely different trigger family from the phase-based triggers this engine already models:
    // hasPhaseTrigger's "declare attackers step" match only fires once per phase entry (not once per
    // individual attack declared) and doesn't distinguish attacking a player from attacking a
    // planeswalker, so it was never actually wired up anywhere. Checked directly here, the one place
    // that already knows an attack against a PLAYER specifically (not a planeswalker) was just
    // declared. Scoped to token-creation effects only (the only shape this card pool needs); other
    // effect kinds are declined rather than guessed at.
    let attackTriggeredSession = metalcraftDebuffedSession;
    if (!target.planeswalker) {
      for (const source of taxedAttacker.board.battlefield) {
        const attackEffectClause = oracleClauses(source.oracleText)
          .map((clause) => clause.match(/^whenever you attack an? player,\s*(.+)$/i))
          .find((match): match is RegExpMatchArray => match !== null)?.[1];
        if (!attackEffectClause) continue;
        const tokenSpecs = parseCreateTokenSpecs(attackEffectClause);
        if (tokenSpecs.length === 0) continue;
        const created = createTokensForSeat(attackTriggeredSession, seatId, source.id, tokenSpecs);
        const createdTokenIds = new Set(created.createdTokens.map((token) => token.id));
        attackTriggeredSession = {
          ...created.session,
          seats: created.session.seats.map((seat) =>
            seat.id === seatId
              ? {
                  ...seat,
                  board: {
                    ...seat.board,
                    battlefield: seat.board.battlefield.map((card) =>
                      createdTokenIds.has(card.id) ? { ...card, tapped: true, attacking: true, attackTargetId: target.seat.id, summoningSick: false } : card
                    )
                  }
                }
              : seat
          ),
          events: [
            {
              id: crypto.randomUUID(),
              at: new Date().toISOString(),
              seatId,
              message: `${source.name} triggers: ${attacker.name} creates ${created.createdTokens.map((token) => token.name).join(", ")}, tapped and attacking ${target.seat.name}.`,
              detail: "Rules action"
            },
            ...created.session.events
          ]
        };
      }
    }

    // Breena, the Demagogue: symmetric and board-wide (see findBreenaAttackTriggers's own doc
    // comment) — resolved inline here, the same synchronous-resolution convention this function
    // already uses for the Metalcraft debuff and "whenever you attack a player" token creation just
    // above, rather than routed through the stack-based trigger queue those don't use either.
    // Excludes a planeswalker attack, matching the same `!target.planeswalker` scope the "whenever
    // you attack a player" block above already applies to its own identical "attacks a player"
    // wording.
    if (!target.planeswalker) {
      const breenaTriggers = findBreenaAttackTriggers(attackTriggeredSession, seatId, target.seat.id);
      for (const trigger of breenaTriggers) {
        attackTriggeredSession = {
          ...attackTriggeredSession,
          events: [
            { id: crypto.randomUUID(), at: new Date().toISOString(), seatId: trigger.controllerSeatId, message: trigger.message, detail: "Rules action" },
            ...attackTriggeredSession.events
          ]
        };
        // The draw half resolves now; a human Breena controller then picks which creature gets the counters.
        const counterThen = trigger.effect.then?.kind === "add_counter" ? trigger.effect.then : undefined;
        const controllerIsHuman = attackTriggeredSession.seats.find((item) => item.id === trigger.controllerSeatId)?.kind === "human";
        if (counterThen && controllerIsHuman) {
          const { then: _deferred, ...drawOnly } = trigger.effect;
          attackTriggeredSession = resolveTriggerEffect(attackTriggeredSession, { ...trigger, effect: drawOnly as typeof trigger.effect });
          const controllerSeat = attackTriggeredSession.seats.find((item) => item.id === trigger.controllerSeatId);
          if (controllerSeat?.board.battlefield.some((card) => card.typeLine.includes("Creature"))) {
            attackTriggeredSession = {
              ...attackTriggeredSession,
              pendingCounterChoices: [
                ...(attackTriggeredSession.pendingCounterChoices ?? []),
                { seatId: trigger.controllerSeatId, sourceCardId: trigger.sourceCardId, sourceCardName: trigger.sourceCardName, counterKind: counterThen.counterKind, amount: counterThen.amount, restrictToYourControl: true }
              ]
            };
          }
        } else {
          attackTriggeredSession = resolveTriggerEffect(attackTriggeredSession, trigger);
        }
      }
    }

    const annihilatorN = annihilatorAmount(attackingCard.oracleText);
    if (!annihilatorN) return attackTriggeredSession;
    // A human defender chooses which permanents to sacrifice (the picker opens from pendingSacrificeChoices).
    if (target.seat.kind === "human" && target.seat.board.battlefield.length > annihilatorN) {
      return { ...attackTriggeredSession, pendingSacrificeChoices: [...(attackTriggeredSession.pendingSacrificeChoices ?? []), { seatId: target.seat.id, sourceCardId: attackingCard.id, sourceCardName: attackingCard.name + "'s annihilator", count: annihilatorN, typeFilter: "permanent" }] };
    }
    const sacrifices = chooseAnnihilatorSacrifices(target.seat, annihilatorN);
    if (sacrifices.length === 0) return attackTriggeredSession;
    return destroyCreatures(
      attackTriggeredSession,
      sacrifices.map((card) => ({
        seatId: target.seat.id,
        cardId: card.id,
        message: `${target.seat.name} sacrifices ${card.name} to ${attackingCard.name}'s annihilator ${annihilatorN}.`
      })),
      "Rules action"
    );
  }

  // Shared by both the human UI (toggle-then-confirm) and the agent decision loop (accumulate one
  // creature at a time, then finalize) — assigns every id in blockerCardIds as a blocker for this
  // attacker, in that order, which becomes the attacker's damage-assignment order (rule 509.2:
  // whoever declared the blocks chooses the order, so "the order you picked them in" is exactly
  // that choice). An empty array declares no blockers, same as before.
  function toggleHumanBlocker(blockerCardId: string) {
    setSelectedBlockerIds((current) => (current.includes(blockerCardId) ? current.filter((id) => id !== blockerCardId) : [...current, blockerCardId]));
  }

  function confirmHumanBlockers() {
    const choice = blockChoice;
    if (!choice) return;
    setBlockChoice(undefined);
    setSession((current) => assignBlockers(current, choice, selectedBlockerIds));
    setSelectedBlockerIds([]);
  }

  function passHumanBlocks() {
    const choice = blockChoice;
    if (!choice) return;
    setBlockChoice(undefined);
    setSelectedBlockerIds([]);
    setSession((current) => resolveHumanUnblockedDamage(current, choice));
  }

  function payCumulativeUpkeep() {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "manual_review") return;
    const seat = session.seats.find((item) => item.id === choice.controllerSeatId);
    const source = seat?.board.battlefield.find((card) => card.id === choice.sourceCardId);
    if (!seat || !source || !isCumulativeUpkeepCard(source)) return;
    const cost = cumulativeUpkeepCost(source);
    const costCard = genericCostShim(cost);
    // Prefer whatever the player has already manually tapped into their floating pool (so choosing
    // which specific lands to tap for this actually works, same as casting a spell from hand does),
    // falling back to auto-tapping untapped lands if they haven't pre-tapped anything — upkeep is
    // the very start of a turn, so there's usually nothing floating yet, and this can't force the
    // player to have pre-tapped before the choice even opens. This used to only ever check the pool
    // with no fallback, so pressing "Pay 1" silently failed every time (reported live as "I press
    // Pay 1 and nothing happens") since nothing is ever floating this early in the turn.
    const pool = poolForSeat(seat.id);
    const poolPayment = payCostFromPool(pool, costCard, cost);
    const payment = poolPayment.ok ? poolPayment : chooseManaSourcesForCost(seat, costCard, cost, source.id, session.seats);
    const availableMana = poolPayment.ok ? manaPoolTotal(pool) : selectedManaTotal(seat, payment.sourceIds);
    if (!payment.ok) {
      addEvent(cannotPayMessage(seat, costCard, availableMana, cost, payment.reason), seat.id, "Mana");
      return;
    }
    if (poolPayment.ok) {
      setSeatManaPool(seat.id, poolPayment.pool);
      clearManaContributions(seat.id);
    }
    setSession((current) => ({
      ...current,
      seats: current.seats.map((item) => {
        if (item.id !== seat.id) return item;
        const spent = poolPayment.ok ? item : spendManaSources(item, payment.sourceIds);
        return {
          ...spent,
          board: {
            ...spent.board,
            battlefield: spent.board.battlefield.map((card) => (card.id === source.id ? applyCounterDelta(card, "age", 1) : card))
          }
        };
      }),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: seat.id,
          message: `${seat.name} pays ${source.name}'s cumulative upkeep for ${cost} mana and adds an age counter.`,
          detail: "Rules advisor"
        },
        ...current.events
      ]
    }));
    setPendingRuleChoice(undefined);
  }

  function sacrificeRuleChoiceSource() {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "manual_review") return;
    setPendingRuleChoice(undefined);
    setSession((current) => moveCardBetweenVisibleZones(current, choice.controllerSeatId, choice.sourceCardId, "graveyard"));
  }

  // Cumulative upkeep (Mystic Remora, ...) has real payment mechanics (payCumulativeUpkeep,
  // sacrificeRuleChoiceSource, resolveAgentRuleChoice's manual_review branch) but, before this, no
  // deterministic path ever OPENED that choice — the phase-trigger scheduler only knew "deterministic
  // effect or consult the Rules Advisor," and a 3B model asked to classify "Cumulative upkeep {1}
  // (...)" text often just didn't recognize it, silently returning workflow "none" (which logs
  // nothing at all) instead of "manual_review." Opening this choice directly, deterministically,
  // whenever the trigger source has the keyword removes that guesswork entirely for this one
  // extremely well-defined shape.
  function openCumulativeUpkeepChoice(seatId: string, sourceCard: VisibleCard) {
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "manual_review",
      controllerSeatId: seatId,
      sourceCardId: sourceCard.id,
      sourceCardName: sourceCard.name,
      prompt: `Pay ${sourceCard.name}'s cumulative upkeep or sacrifice it.`
    });
  }

  // "At the beginning of your upkeep, scry/surveil N" (Aminatou, Veil Piercer's "surveil 2", ...) is
  // an extremely common, well-templated shape that the server-side Rules Advisor DOES already
  // recognize deterministically (deterministicRuleWorkflow, verified directly) — the actual bug was
  // never misclassification, it's that resolving it goes through consultRulesAdvisor's async fetch,
  // which races against the separate "no legal action this phase, advance after 1100ms" timer that
  // isn't blocked by anything while that fetch is still in flight (pendingRuleChoice stays unset the
  // whole time for scry/surveil, unlike order_triggers/manual_review). If advanceTurn() fires first,
  // the game moves on to the next phase and the surveil/scry window is effectively skipped — which is
  // exactly the intermittent "sometimes it just doesn't do anything" the trigger produced. Resolving
  // this synchronously here, like openCumulativeUpkeepChoice, removes the race entirely by never
  // going through the async round trip for this shape at all. Returns whether it matched.
  function resolvePhaseScryOrSurveil(seatId: string, sourceCard: VisibleCard, phase: TurnPhase): boolean {
    const clauseText = phaseEffectText(sourceCard.oracleText, phase);
    // Same non-anchored strip as applyDeterministicPhaseTrigger's own leading-condition guard (see
    // its comment) — a keyword ability name can sit in front of "at the beginning of..." here too.
    if (/^if\b/i.test(clauseText.replace(/^.*?\bat the beginning of[^,]*,\s*/i, ""))) return false;
    const match = clauseText.match(/\b(scry|surveil)\s+(\d+|a|one|two|three|four|five)\b/i);
    if (!match) return false;
    const baseCount = numberWordToInt(match[2]);
    if (!baseCount) return false;
    const mode = match[1].toLowerCase() as "scry" | "surveil";
    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat) return false;
    // "You may look at an additional two cards each time you surveil." (Enhanced Surveillance) —
    // scry is unaffected, only surveil.
    const count = mode === "surveil" ? baseCount + surveilBonusForSeat(seat) : baseCount;
    if (seat.kind === "human") {
      startLibraryLook(mode, count);
    } else {
      setSession((current) => resolveAgentLibraryLookWorkflow(current, seatId, sourceCard.name, mode === "scry" ? "scry_cards" : "surveil_cards", count));
    }
    return true;
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

  function drawCard(seatId: string) {
    const next = drawForSeat(session, seatId, `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} draws a card.`);
    setSession(next);
    checkMiracleAfterDraw(session, next);
  }

  function checkMiracleAfterDraw(priorSession: GameSession, nextSession: GameSession) {
    for (const nextSeat of nextSession.seats) {
      const priorHand = priorSession.seats.find((seat) => seat.id === nextSeat.id)?.board.hand ?? [];
      const nextHand = nextSeat.board.hand;
      if (nextHand.length <= priorHand.length) continue;

      const turnKey = `${nextSession.turn}:${nextSeat.id}`;
      if (firstDrawThisTurn.current.has(turnKey)) continue;
      firstDrawThisTurn.current.add(turnKey);

      const priorIds = new Set(priorHand.map((card) => card.id));
      const firstDrawn = nextHand.find((card) => !priorIds.has(card.id));
      if (!firstDrawn) continue;

      // Native Miracle (Temporal Mastery, Bonfire of the Damned, ...) was never checked here at
      // all — only Aminatou, Veil Piercer's granted-miracle case below was, and that's scoped to
      // Enchantment cards specifically (matching her own "Enchantment cards in your hand have
      // miracle" text), which no naturally-miracle card actually is. So a card with its own printed
      // "Miracle {cost}" line just went to hand at full cost with the miracle window never offered.
      const nativeMiracleCost = parseMiracleCost(firstDrawn);
      if (nativeMiracleCost !== undefined) {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "miracle_offer",
          controllerSeatId: nextSeat.id,
          sourceCardId: firstDrawn.id,
          sourceCardName: firstDrawn.name,
          prompt: `${firstDrawn.name} has miracle. Cast it for its miracle cost, or it stays in hand at full cost.`,
          // A static reducer (Inquisitive Glimmer, ...) stacks with the printed miracle cost too —
          // same floor rule 601.2f applies here, see miracleCostFor's own comment.
          miracleCost: Math.max(coloredPipCount(firstDrawn), nativeMiracleCost - staticCostReduction(nextSeat, firstDrawn))
        });
        return;
      }

      const granter = findMiracleGranter(nextSeat);
      if (!granter || !firstDrawn.typeLine.includes("Enchantment")) continue;

      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "miracle_offer",
        controllerSeatId: nextSeat.id,
        sourceCardId: firstDrawn.id,
        sourceCardName: firstDrawn.name,
        prompt: `${granter.name} grants miracle. Cast ${firstDrawn.name} for its miracle cost, or it stays in hand at full cost.`,
        miracleCost: miracleCostFor(nextSeat, firstDrawn)
      });
      return;
    }
  }

  function shuffleLibrary(seatId: string) {
    setLibraryLook(undefined);
    setSession((current) => {
      const seat = current.seats.find((item) => item.id === seatId);
      return {
        ...current,
        seats: current.seats.map((item) =>
          item.id === seatId
            ? {
                ...item,
                library: shuffleCards(item.library ?? [])
              }
            : item
        ),
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId,
            message: `${seat?.name ?? "Player"} shuffles their library.`
          },
          ...current.events
        ]
      };
    });
  }

  // "Cycling {cost}": pay the cost, discard the card from hand, draw a card. Instant speed, so only the stack being empty is checked.
  function cycleCard(seatId: string, cardId: string) {
    if (pendingAction) {
      addEvent("Finish resolving what's on the stack before cycling.", seatId, "Timing");
      return;
    }
    const cyclingSeat = session.seats.find((item) => item.id === seatId);
    const cyclingCard = cyclingSeat?.board.hand.find((item) => item.id === cardId);
    const cyclingInfo = cyclingCard ? parseCycling(cyclingCard.oracleText) : undefined;
    const humanSearch = Boolean(cyclingSeat?.kind === "human" && cyclingInfo?.searchType);
    const result = cycleCardInSession(session, seatId, cardId, { skipSearch: humanSearch });
    if (!result.ok) {
      addEvent(result.message, seatId, "Timing");
      return;
    }
    setSession(() => result.session);
    // Plainscycling and friends: the human chooses the card to search for.
    if (humanSearch && cyclingCard && cyclingInfo?.searchType) {
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_card_from_library",
        controllerSeatId: seatId,
        sourceCardId: cardId,
        sourceCardName: cyclingCard.name,
        prompt: `Search your library for a ${cyclingInfo.basicOnly ? "basic " : ""}${cyclingInfo.searchType} card.`,
        destination: "hand",
        maxChoices: 1,
        allowedCardFilter: (cyclingInfo.basicOnly ? "basic " : "") + cyclingInfo.searchType.toLowerCase()
      });
    }
  }

  function playCard(
    seatId: string,
    cardId: string,
    position?: { x: number; z: number },
    sourceZone: "hand" | "command" | "exile" | "graveyard" | "library" = "hand",
    faceIndex?: number,
    preChosenSacrificeTargets?: VisibleCard[],
    castChoices?: CastChoices,
    altChoice?: "alt" | "normal"
  ) {
    if (humanActionBlockedByChoice(seatId)) return;
    if (pendingAction) {
      // Something is on the stack and the human clicked a card: an instant/flash card is a RESPONSE, not a main-phase play — route it there instead of refusing
      // (the "Can't play a card while Monstrous Onslaught is still on the stack" dead end).
      const clicked = seatId === humanSeat.id && (sourceZone === "hand" || sourceZone === "exile") ? humanSeat.board.hand.find((item) => item.id === cardId) : undefined;
      if (clicked && !isLandCard(clicked) && canCastAtInstantSpeed(clicked, seatHasFlashGrant(humanSeat, clicked))) {
        respondWithCard(cardId, sourceZone === "exile" ? "exile" : "hand");
        return;
      }
      // Said out loud: a click that silently does nothing looks like a broken card (Breaching Dragonstorm's free cast).
      addEvent(`Can't play a card while "${pendingAction.type === "spell" ? pendingAction.cardName : pendingAction.type === "trigger" ? pendingAction.sourceCardName : "an action"}" is still on the stack - resolve or pass priority first.`, seatId, "Timing");
      return;
    }
    if (castDispatchInFlight.current !== null) {
      // A genuine same-tick re-dispatch (the case this guard exists for) is always well under this
      // threshold — anything older means the macrotask reset simply never ran, so treat it as stale
      // and let this call through instead of silently blocking every cast for the rest of the
      // session. Logged either way so a blocked attempt is never invisible again.
      const age = Date.now() - castDispatchInFlight.current;
      if (age < CAST_DISPATCH_STALE_MS) {
        addEvent(`A card is already being played; try again in a moment.`, seatId, "Timing");
        return;
      }
    }
    const seat = session.seats.find((item) => item.id === seatId);
    const card =
      sourceZone === "command"
        ? seat?.board.commander
        : sourceZone === "exile"
          ? findExiledCardAnySeat(session, cardId)
          : sourceZone === "graveyard"
            ? seat?.board.graveyard?.find((item) => item.id === cardId)
            : sourceZone === "library"
              ? seat?.library?.find((item, index) => index === 0 && item.id === cardId)
              : seat?.board.hand.find((item) => item.id === cardId);
    if (!seat || !card) {
      addEvent(`Couldn't find that card in ${sourceZone === "hand" ? "your hand" : "your " + sourceZone} to play it (it may have already been played or moved).`, seatId, "Timing");
      return;
    }

    if (sourceZone === "command" && card.id !== cardId) return;
    if (spellCastLockedOut(session, seatId, activeSeatId)) {
      addEvent(`${seat.name} can't cast spells during ${session.seats.find((item) => item.id === activeSeatId)?.name ?? "that player"}'s turn.`, seatId, "Timing");
      return;
    }
    if (castRestrictedByTurnCount(session, card)) {
      addEvent(`${seat.name} can't cast ${card.name} during their first three turns of the game.`, seatId, "Timing");
      return;
    }
    // Casting from the graveyard needs an actual permission — flashback, a standing "you may cast this card from
    // your graveyard" (Gravecrawler), or a one-turn grant (Zul Ashur). Re-checked here even though the legal
    // action / pile button only offers it when one exists.
    const graveyardPermission =
      sourceZone === "graveyard"
        ? graveyardCastPermission(card, { seatId, turn: session.turn, controllerBattlefield: seat.board.battlefield })
        : undefined;
    if (sourceZone === "graveyard" && !graveyardPermission) {
      addEvent(`${seat.name} can't cast ${card.name} from the graveyard right now.`, seatId, "Timing");
      return;
    }
    // The top card of the library can only be cast while a permanent says so (Thundermane Dragon).
    if (sourceZone === "library" && !libraryTopCastPermission(card, seat.board.battlefield)) {
      addEvent(`${seat.name} can't cast ${card.name} from the top of their library right now.`, seatId, "Timing");
      return;
    }
    // Defense-in-depth: this should already be true whenever this path is reachable (the legal
    // action offering it only exists under the same condition), but exile-play permission is
    // itself temporary/scoped, so re-check it here too.
    if (sourceZone === "exile" && (card.exiledPlayableBySeatId !== seatId || (card.exiledPlayableUntilTurn !== undefined && session.turn > card.exiledPlayableUntilTurn))) {
      addEvent(`${seat.name} may not cast ${card.name} from exile (${card.exiledPlayableBySeatId !== seatId ? "the permission belongs to another player" : "the permission has expired"}).`, seatId, "Timing");
      return;
    }

    const dfcSplit = modalDoubleFacedLandSplit(card);
    const doors = roomDoorFaces(card);
    const spellFaces = independentlyCastableSpellFaces(card);
    // A split / Adventure card cast from the hand with no half named (a drag onto the table, "Play Selected", ...): Magic makes the caster CHOOSE one half
    // and pay only that half's cost. Without this the whole card was priced at both halves' costs added together (8 for Find // Finality) and always
    // resolved as its first half. The decision is per half: cost, timing, targets. One castable half is cast directly; several ask the human.
    if (faceIndex === undefined && spellFaces && sourceZone === "hand") {
      const decision = castFaceDecision(session, seat, card, activeSeatId, seat.kind === "human" ? poolForSeat(seatId) : undefined);
      if (decision.kind === "single") {
        faceIndex = decision.faceIndex;
      } else if (decision.kind === "choose") {
        const usable = decision.options.filter((option) => option.castable && option.payable);
        if (seat.kind === "human") {
          setPendingRuleChoice({
            id: crypto.randomUUID(),
            kind: "choose_cast_face",
            controllerSeatId: seatId,
            sourceCardId: cardId,
            sourceCardName: card.name,
            prompt: `${card.name}: which half do you cast? You pay only that half's cost.`,
            options: usable.map((option) => ({ faceIndex: option.faceIndex, label: option.label })),
            resume: { via: "playCard", seatId, cardId, position, sourceZone, sacrificeTargets: preChosenSacrificeTargets }
          });
          setSelectedHandCardId(undefined);
          return;
        }
        faceIndex = usable[0].faceIndex;
      } else if (decision.kind === "unpayable") {
        const why = decision.options.map((option) => `${option.label.replace(/^Cast /, "")} ${option.castable ? "cannot be paid" : "cannot be cast right now"}`).join("; ");
        addEvent(`${seat.name} cannot cast ${card.name}: ${why}.`, seatId, "Mana");
        setSelectedHandCardId(undefined);
        return;
      }
    }
    const playingAsLand = dfcSplit ? faceIndex === dfcSplit.landIndex : isLandCard(card);
    // From here on the half that was chosen decides timing and targets; the combined card never does.
    const chosenHalf = spellFaces && faceIndex !== undefined ? spellFaces[faceIndex] : undefined;
    const timingCard = chosenHalf ? { ...card, name: chosenHalf.name, typeLine: chosenHalf.typeLine, oracleText: chosenHalf.oracleText } : card;

    // Sorcery-speed timing (rule 305.3 for lands, 307.5/601.3a-adjacent for sorcery-speed spells):
    // lands and any card that isn't instant-speed can only be played on the caster's own turn,
    // during one of their main phases. This path (playCard) is the ONLY entry point for a human's
    // drag-and-drop main-phase play — the response-window path (respondWithCard) is separate and
    // already gates on canCastAtInstantSpeed. Without this check here, a drag that lands on the
    // battlefield during e.g. the draw step (or an opponent's turn) would silently succeed: the
    // card moves, and for lands it also burns the turn's one-land allowance with nothing to show
    // for it, leaving the player unable to play a land later in their real main phase.
    if ((playingAsLand || !(canCastAtInstantSpeed(timingCard, seatHasFlashGrant(seat, timingCard)) || (sourceZone === "exile" && card.exiledPlayableAnyTime))) && (activeSeatId !== seatId || !isMainPhase(session.phase))) {
      addEvent(
        `${seat.name} can only ${playingAsLand ? "play a land" : `cast ${card.name}`} during a main phase on their own turn.`,
        seatId,
        "Timing"
      );
      setSelectedHandCardId(undefined);
      return;
    }

    // Central legality gate (checkMoveLegal, src/lib/moveLegality.ts) — the same rules check the agents' decisions go through, so a human's play
    // and an agent's play are refused for the same reasons, with a stated reason, before any mana is spent or any card moves.
    const playGate = checkMoveLegal(
      session,
      seatId,
      {
        id: `${playingAsLand ? "play-land" : sourceZone === "command" ? "cast-commander" : "cast"}:${cardId}`,
        actionType: playingAsLand ? "play_land" : sourceZone === "command" ? "cast_commander" : "cast_spell",
        cardId,
        sourceZone: sourceZone === "exile" || sourceZone === "graveyard" || sourceZone === "library" ? sourceZone : undefined,
        faceIndex,
        targetIds: [],
        label: card.name
      },
      { mode: "human", hasPlayedLand: hasPlayedLandThisTurn(seatId, session.turn), activeSeatId, stackEmpty: true }
    );
    if (!playGate.legal) {
      addEvent(`${seat.name} cannot ${playingAsLand ? "play" : "cast"} ${card.name}: ${playGate.reason}.`, seatId, "Rules action");
      setSelectedHandCardId(undefined);
      return;
    }

    // Set the instant this call has committed to actually playing/casting the card (every guard
    // above has passed), cleared on a fresh macrotask — see castDispatchInFlight's own comment for
    // why this can't just rely on the pendingAction state guard at the top of this function.
    castDispatchInFlight.current = Date.now();
    window.setTimeout(() => {
      castDispatchInFlight.current = null;
    }, 0);

    if (playingAsLand) {
      // From exile only with a permission (a hideaway land's free play); that permission was checked above.
      if (sourceZone !== "hand" && sourceZone !== "exile") return;
      if (hasPlayedLandThisTurn(seatId, session.turn)) {
        addEvent(`${seat.name} already played a land this turn.`, seatId, "Mana");
        return;
      }
      recordLandPlay(landPlaysThisTurn.current, landTurnKey(seatId, session.turn));
      const playedFaceCard = applyChosenFaceToCard(card, faceIndex);
      const playedName = playedFaceCard.name;
      // "As this land enters, choose a color[/creature type]" (the Thriving cycle, the Gate cycle,
      // Cavern of Souls, ...) — this whole block was previously only wired into the spell-resolution
      // path (see the matching comments below), which a land play never goes through (lands never
      // hit the stack), so a land with this clause entered with chosenColor/chosenCreatureType left
      // unset for BOTH agents and the human, silently limiting it to its base color forever. Mirrors
      // that path exactly: auto-pick immediately (needed for agents, and as the human's default),
      // then for the human specifically follow up with a real choice modal pre-loaded with that pick.
      const chooseColorEtb = parseChooseColorEtb(playedFaceCard.oracleText);
      const choosesCreatureType = hasChooseCreatureTypeEtb(playedFaceCard.oracleText);
      // Hoisted above setSession (and reused both inside the updater and in the consultRulesAdvisor
      // guard below) since it's a pure function of the played card's own oracle text — computing it
      // twice from two different scopes let it silently drift out of sync with the "don't double up"
      // guard, see that guard's own comment.
      const zoneEffect = parseEtbZoneEffect(etbEffectText(playedFaceCard.oracleText));
      // Captured out of the setSession updater below rather than queued from inside it — React 18
      // StrictMode's dev-mode double-invocation of functional setState updaters (intended to catch
      // exactly this: an updater that isn't a pure function of its input) was calling
      // queueCommonTriggers TWICE for a single land play, since both invocations start from the same
      // `current` and both compute a genuinely-changed session (the guard below only catches a
      // separate symptom — a real re-dispatch of an already-resolved land play, where the second
      // invocation's playedSession === current). Reported live as Archaeomancer's Map's land-raid
      // trigger firing twice per land entering. queueCommonTriggers is now called once, after
      // setSession returns, using whichever invocation's triggers were captured last — since both
      // invocations compute the same triggers from the same `current`, which one "wins" doesn't matter.
      let capturedTriggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];
      let landZoneChoice: ZoneEffect | undefined;
      setSession((current) => {
        const playedSession = playCardFromZone(current, seatId, cardId, `${seat.name} plays ${playedName}.`, position, "battlefield", [], sourceZone === "exile" ? "exile" : "hand", faceIndex);
        // playCardFromZone returns the same session reference, untouched, when the card was already
        // gone from hand (playCard re-entered for a land play already resolved — e.g. a duplicate
        // dispatch of the same agent/human decision) — bail out here rather than falling through to
        // the ETB-trigger scan below, which would otherwise re-detect the land that already entered
        // and queue a second copy of its "a land entered" triggers even though no second land
        // actually entered.
        if (playedSession === current) return current;
        const chosenTypeSession = choosesCreatureType ? applyChosenCreatureType(playedSession, seatId, cardId) : playedSession;
        const coloredSession = chooseColorEtb ? applyChosenColor(chosenTypeSession, seatId, cardId, chooseColorEtb.excludedColor) : chosenTypeSession;
        // Rule 714.2a: "As this Saga enters ... add a lore counter" (Urza's Saga specifically is the
        // only real Saga that's also a land, hence this hook living in the land-play path — every
        // other Saga's own ETB is handled at its own spell-resolution path instead).
        const nextSession = isSagaCard(playedFaceCard) ? applySagaEntryLoreCounter(coloredSession, seatId, cardId) : coloredSession;
        // Land ETB triggers never went through parseZoneEffect at all before (only the spell-
        // resolution path did) — a land whose whole ETB is a zone effect (Bojuka Bog's "exile
        // target player's graveyard," ...) had nowhere deterministic to resolve, and fell straight
        // to consultRulesAdvisor for every single one. shouldConsultRulesAdvisor now declines the
        // "land_played" event once this already covers it, so the two don't double up.
        // A human with a real choice (Bojuka Bog's player, a regrow land) is asked instead; the prompt opens right after this update.
        const humanLandChoice = zoneEffect && seat.kind === "human" && zoneChoiceSpecFor(nextSession, seatId, zoneEffect, card) !== undefined;
        landZoneChoice = humanLandChoice ? zoneEffect : undefined;
        const zoneResolvedSession = zoneEffect && !humanLandChoice ? applyZoneEffect(nextSession, seatId, playedName, zoneEffect) : nextSession;
        capturedTriggers = [
          ...findCommonTriggersForPermanentEntered(zoneResolvedSession, seatId, card),
          ...findLandRaidTriggers(zoneResolvedSession, seatId, card)
        ];
        return zoneResolvedSession;
      });
      // Read AFTER the updater has run: React may defer a functional updater (when other state updates are already queued, as on a
      // human's land play), and reading these two right after setSession then saw them still empty - Spinerock Knoll's hideaway never fired.
      window.setTimeout(() => {
        if (capturedTriggers.length > 0) queueCommonTriggers(capturedTriggers);
        const pendingLandEffect = landZoneChoice;
        if (!pendingLandEffect) return;
        {
          const spec = zoneEffectTargetSpec(pendingLandEffect);
          if (!spec) return;
          setPendingRuleChoice({
            id: crypto.randomUUID(),
            kind: "choose_effect_target",
            controllerSeatId: seatId,
            sourceCardId: cardId,
            sourceCardName: playedName,
            sourceCard: { ...card, name: playedName },
            prompt: spec.prompt,
            spec,
            optional: false,
            pending: { kind: "zone", effect: pendingLandEffect }
          });
        }
      }, 0);
      if (seat.kind === "human") {
        if (choosesCreatureType) {
          window.setTimeout(
            () =>
              setPendingRuleChoice({
                id: crypto.randomUUID(),
                kind: "choose_creature_type",
                controllerSeatId: seatId,
                sourceCardId: cardId,
                sourceCardName: playedName,
                prompt: `Choose a creature type for ${playedName}.`
              }),
            0
          );
        } else if (chooseColorEtb) {
          const excludedColor = chooseColorEtb.excludedColor;
          window.setTimeout(
            () =>
              setPendingRuleChoice({
                id: crypto.randomUUID(),
                kind: "choose_color",
                controllerSeatId: seatId,
                sourceCardId: cardId,
                sourceCardName: playedName,
                prompt: `Choose a color for ${playedName}${excludedColor ? ` (other than ${excludedColor})` : ""}.`,
                excludedColor
              }),
            0
          );
        }
      }
      // Same "don't double up" reasoning as parseZoneEffect's own guard just above — a land ETB
      // clause commonTriggerEffect OR parseZoneEffect already owns deterministically
      // (return_land_to_hand, draw_cards, scry_cards, exile_graveyard, ...) has nowhere useful left
      // for the rules advisor to add, and asking it anyway risks a confusing extra manual_review
      // prompt or a wasted/hallucinated LLM call on top of the already-correct deterministic
      // resolution. The zoneEffect half of this was missing entirely: shouldConsultRulesAdvisor
      // itself declines "land_played" once parseZoneEffect recognizes the card (see its own guard),
      // but consultRulesAdvisor falls through to the broader consultPrimitiveActionPlanner whenever
      // shouldConsultRulesAdvisor declines — so Bojuka Bog's already-correctly-resolved graveyard
      // exile was ALSO handed to that LLM fallback with no reason left to interpret, which
      // hallucinated a battlefield-creature exile instead. Reproduced live: Bojuka Bog exiled a
      // live Blood Artist off the battlefield instead of an empty/opposing graveyard.
      if (commonTriggerEffect(playedFaceCard.oracleText, "entered", undefined, seat) === undefined && !zoneEffect) {
        void consultRulesAdvisor("land_played", seatId, card);
      }
      void consultStaticEffectInterpreter(seatId, card);
      setSelectedHandCardId(undefined);
      return;
    }

    // Rule 601.2c: a spell with no legal target for a targeted effect (removal, reanimation, or an
    // Aura's own "Enchant X" line) can't legally be cast at all — this was previously only enforced
    // for agents (legalMainPhaseActions builds their action list from it); a human clicking "Play
    // Selected" went straight through to payment, so e.g. Animate Dead with nothing in any graveyard
    // would cast, resolve, and fizzle into the graveyard instead of never being castable.
    if (!hasResolvableTarget(session, seatId, timingCard)) {
      const sacrificeCostMissing = parseAdditionalSacrificeCost(timingCard.oracleText);
      addEvent(
        sacrificeCostMissing && additionalSacrificeCandidates(seat, sacrificeCostMissing, cardId).length < sacrificeCostMissing.count
          ? `${seat.name} cannot cast ${timingCard.name}; there is no ${sacrificeCostMissing.permanentType} to sacrifice as its additional cost.`
          : `${seat.name} cannot cast ${timingCard.name}; there is no legal target.`,
        seatId,
        "Mana"
      );
      setSelectedHandCardId(undefined);
      return;
    }

    // "As an additional cost to cast this spell, sacrifice a creature." (Village Rites, ...) — a
    // human with a genuine choice (more than one legal creature) picks their own instead of getting
    // silently auto-resolved by chooseSacrificeTargets' heuristic inside beginPendingAction. Opened
    // (and this call returns) BEFORE any mana/cost is spent — nothing above this point has mutated
    // state yet, so re-entering playCard once the human picks (see
    // chooseCreatureToSacrificeForCast's resumeVia "playCard" branch) just replays this same
    // function from the top with preChosenSacrificeTargets now set, which short-circuits straight
    // past this check on the second pass. Scoped to count === 1, same precedent as
    // choose_creature_to_sacrifice's own count-1 scope limit.
    if (!preChosenSacrificeTargets) {
      const additionalSacrificeCost = parseAdditionalSacrificeCost(card.oracleText);
      if (
        additionalSacrificeCost?.count === 1 &&
        seat.kind === "human" &&
        additionalSacrificeCandidates(seat, additionalSacrificeCost, cardId).length > 1
      ) {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_creature_to_sacrifice_for_cast",
          controllerSeatId: seatId,
          sourceCardId: cardId,
          sourceCardName: card.name,
          prompt: `${card.name}: choose ${additionalSacrificeCost.permanentType === "creature" ? "a creature" : `a ${additionalSacrificeCost.permanentType}`} to sacrifice as an additional cost.`,
          sacrificeType: additionalSacrificeCost.permanentType,
          resumeVia: "playCard",
          sourceZone,
          faceIndex,
          position
        });
        return;
      }
    }

    const doorFace = doors && faceIndex !== undefined ? doors[faceIndex] : undefined;
    const spellFace = spellFaces && faceIndex !== undefined ? spellFaces[faceIndex] : undefined;
    // Flashback replaces the mana cost with the flashback cost (the same override mechanism an Adventure face uses).
    const flashbackCostText = graveyardPermission?.kind === "flashback" ? graveyardPermission.costText : undefined;
    // Sephara's "pay {W} and tap four flyers rather than pay this spell's mana cost": offered whenever the creatures exist. A human is asked;
    // an agent always takes it, since it is the cheaper way.
    const tapAlt = sourceZone === "hand" && !flashbackCostText && !doorFace && !spellFace ? tapCreaturesAltCostFor(seat, card) : undefined;
    if (tapAlt && seat.kind === "human" && altChoice === undefined && !castChoices) {
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_cast_alt",
        controllerSeatId: seatId,
        sourceCardId: cardId,
        sourceCardName: card.name,
        prompt: `${card.name}: pay the alternative cost instead of its mana cost?`,
        altLabel: `Pay ${tapAlt.costManaText} and tap ${tapAlt.creatureIds.length >= tapAlt.count ? tapAlt.count : tapAlt.creatureIds.length} untapped creature${tapAlt.count === 1 ? "" : "s"}${tapAlt.withKeyword ? ` with ${tapAlt.withKeyword}` : ""}`,
        resume: { seatId, cardId, position, sourceZone, faceIndex, sacrificeTargets: preChosenSacrificeTargets }
      });
      setSelectedHandCardId(undefined);
      return;
    }
    // "As an additional cost to cast this spell, discard a card": a human picks the card(s) before anything is paid.
    const additionalDiscard = sourceZone === "hand" && seat.kind === "human" && card.chosenAdditionalDiscardIds === undefined ? parseAdditionalDiscardCost(card.oracleText) : undefined;
    if (additionalDiscard && seat.board.hand.filter((handCard) => handCard.id !== cardId).length > additionalDiscard.count) {
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "discard_to_hand_size",
        controllerSeatId: seatId,
        sourceCardName: card.name,
        prompt: `${card.name}: choose ${additionalDiscard.count === 1 ? "a card" : additionalDiscard.count + " cards"} to discard as an additional cost.`,
        requiredDiscards: additionalDiscard.count,
        castResume: { seatId, cardId, position, sourceZone, faceIndex }
      });
      setSelectedHandCardId(undefined);
      return;
    }
    // "You may have this enter as a copy of ...": a human picks what to copy (or declines) first.
    const copyEffectForPrompt = sourceZone === "hand" && seat.kind === "human" && card.chosenCopyTargetId === undefined ? parseEnterAsCopyEffect(card.oracleText) : undefined;
    if (copyEffectForPrompt) {
      const candidates = enterAsCopyCandidates(session, seatId, copyEffectForPrompt);
      if (candidates.length > 0) {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_cast_copy",
          controllerSeatId: seatId,
          sourceCardId: cardId,
          sourceCardName: card.name,
          prompt: `${card.name}: choose what it enters as a copy of.`,
          options: [...candidates.map((candidate) => ({ cardId: candidate.id, label: `${candidate.name} (${session.seats.find((item) => item.board.battlefield.some((entry) => entry.id === candidate.id))?.name ?? "?"})` })), { cardId: "none", label: "Don't copy anything" }],
          resume: { seatId, cardId, position, sourceZone, faceIndex, sacrificeTargets: preChosenSacrificeTargets }
        });
        setSelectedHandCardId(undefined);
        return;
      }
    }
    // Sephara's alternative cost: the human chooses which creatures to tap.
    if (tapAlt && seat.kind === "human" && altChoice === "alt" && card.chosenTapAltIds === undefined && tapAlt.creatureIds.length > tapAlt.count) {
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_creature_to_sacrifice",
        controllerSeatId: seatId,
        sourceCardId: cardId,
        sourceCardName: card.name,
        prompt: `${card.name}: choose ${tapAlt.count} untapped creatures to tap${tapAlt.withKeyword ? " with " + tapAlt.withKeyword : ""}.`,
        abilityIndex: -1,
        count: tapAlt.count,
        tapSubtype: "creature",
        eligibleIds: tapAlt.creatureIds,
        castResume: { seatId, cardId, position, sourceZone, faceIndex }
      });
      setSelectedHandCardId(undefined);
      return;
    }
    const useTapAlt = Boolean(tapAlt) && (seat.kind !== "human" || altChoice === "alt");
    const costCard = useTapAlt && tapAlt
      ? cardWithFaceManaCost(card, tapAlt.costManaText)
      : flashbackCostText
      ? cardWithFaceManaCost(card, flashbackCostText)
      : doorFace
        ? cardWithFaceManaCost(card, doorFace.manaCost)
        : spellFace
          ? spellFaceCostCard(card, spellFace)
          : card;
    const baseCost = useTapAlt && tapAlt
      ? manaValueFromManaCost(tapAlt.costManaText)
      : flashbackCostText
      ? manaValueFromManaCost(flashbackCostText)
      : doorFace
        ? manaValueFromManaCost(doorFace.manaCost)
        : spellFace
          ? manaValueFromManaCost(spellFace.manaCost)
          : card.manaValue;
    const fixedCost =
      adjustedCastingCost(seat, costCard, baseCost, sourceZone, activeSeatId, session.seats, session.turn, session.onceEachTurnEffectsUsed) +
      (sourceZone === "command" ? card.commanderTax ?? 0 : 0) +
      targetingTax(session, seatId, castChoices?.targets ?? []);
    // One with the Multiverse: fixedCost came back 0 specifically because of its once-per-turn
    // permission (not because the card is genuinely free or discounted some other way) — recorded
    // now, at the moment this cast actually commits, not inside adjustedCastingCost itself (a pure
    // function called from many purely-informational sites too — see its own doc comment).
    const usesOnceEachTurnFreeCast =
      sourceZone === "hand" &&
      fixedCost === 0 &&
      baseCost > 0 &&
      !(card.exiledPlayableFree || hasOmniscienceFreeHandCast(seat)) &&
      hasOnceEachTurnFreeHandCastPermission(seat);
    // Demon of Fate's Design: same "fixedCost came back 0 because of a specific permission, not
    // because the spell is genuinely free" reasoning as usesOnceEachTurnFreeCast above, except this
    // one also charges real life (adjustedCastingCost only waives the mana half).
    const usesFateDesignLifeAltCost =
      sourceZone === "hand" &&
      fixedCost === 0 &&
      baseCost > 0 &&
      !usesOnceEachTurnFreeCast &&
      !(card.exiledPlayableFree || hasOmniscienceFreeHandCast(seat)) &&
      card.typeLine.includes("Enchantment") &&
      hasFateDesignLifeAltCost(seat);
    // Room doors never carry an {X} in their real card pool, so forcing chosenX to 0 there was
    // never a live bug — but an Adventure/Omen spell face (Exude Toxin's {X}{B}{B}) needs the same
    // X-affordability logic every other X spell gets, so spellFace goes through maxAffordableX
    // instead of being forced to 0 the way doorFace is.
    const maxX = doorFace ? 0 : maxAffordableX(seat, costCard, fixedCost, seat.kind === "human" ? poolForSeat(seatId) : undefined);
    // X, kicker and multikicker: a human chooses how much to pay instead of always paying the maximum.
    if (seat.kind === "human" && maxX >= 1 && sourceZone === "hand" && card.chosenCastX === undefined) {
      const single = hasSingleKicker(card.oracleText);
      const hasX = xSymbolCount(costCard.manaCost) > 0;
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_cast_x",
        controllerSeatId: seatId,
        sourceCardId: cardId,
        sourceCardName: card.name,
        prompt: single ? `${card.name}: pay the kicker?` : hasX ? `${card.name}: choose X (you can afford up to ${maxX}).` : `${card.name}: how many times do you pay the multikicker (up to ${maxX})?`,
        options: single
          ? [{ value: 1, label: "Pay the kicker" }, { value: 0, label: "Don't kick it" }]
          : Array.from({ length: Math.min(maxX, 25) + 1 }, (_, value) => ({ value, label: hasX ? "X = " + value : value + " time" + (value === 1 ? "" : "s") })).reverse(),
        resume: { seatId, cardId, position, sourceZone, faceIndex, sacrificeTargets: preChosenSacrificeTargets }
      });
      setSelectedHandCardId(undefined);
      return;
    }
    const chosenX = Math.min(maxX, card.chosenCastX ?? maxX);
    // A cast whose mana cost was waived outright ("without paying its mana cost"): fixedCost already holds just the extra taxes.
    const costWaived = baseCost > 0 && adjustedCastingCost(seat, costCard, baseCost, sourceZone, activeSeatId, session.seats, session.turn, session.onceEachTurnEffectsUsed) === 0;
    const totalCost = costWaived ? fixedCost : totalCastingCost(seat, costCard, baseCost, chosenX, session.seats) + (sourceZone === "command" ? card.commanderTax ?? 0 : 0);
    // payCastingCost tries a seat's restricted mana (Klauth's floating batch, if any) before the
    // normal pool-then-auto-tap payment every other cost uses — see its own doc comment.
    const payment = payCastingCost(seatId, seat, costCard, totalCost);
    const availableMana = payment.ok ? manaPoolTotal(payment.spent) : seat.kind === "human" ? manaPoolTotal(poolForSeat(seatId)) : selectedManaTotal(seat, payment.sourceIds);
    if (!payment.ok) {
      addEvent(cannotPayMessage(seat, costCard, availableMana, totalCost, payment.reason), seatId, "Mana");
      if (card.chosenCastX !== undefined) {
        setSession((current) => ({ ...current, seats: current.seats.map((item) => (item.id === seatId ? { ...item, board: { ...item.board, hand: item.board.hand.map((handCard) => (handCard.id === cardId ? { ...handCard, chosenCastX: undefined } : handCard)) } } : item)) }));
      }
      setSelectedHandCardId(undefined);
      return;
    }

    // Modes and targets are chosen as the spell is cast (rule 601.2c), after we know it can be paid for but before anything is spent.
    if (seat.kind === "human" && !castChoices) {
      const planCard: VisibleCard = doorFace
        ? { ...card, name: doorFace.name, typeLine: doorFace.typeLine, oracleText: doorFace.oracleText }
        : spellFace
          ? { ...card, name: spellFace.name, typeLine: spellFace.typeLine, oracleText: spellFace.oracleText }
          : dfcSplit
            ? { ...card, name: dfcSplit.spellFace.name, typeLine: dfcSplit.spellFace.typeLine, oracleText: dfcSplit.spellFace.oracleText }
            : card;
      const answers: CastChoices = { targets: [] };
      const firstPrompt = nextCastPrompt(session, seatId, planCard, chosenX > 0 ? chosenX : undefined, answers);
      if (firstPrompt) {
        openCastPrompt(firstPrompt, { planCard, chosenX: chosenX > 0 ? chosenX : undefined, answers, resume: { via: "playCard", seatId, cardId, position, sourceZone, faceIndex, sacrificeTargets: preChosenSacrificeTargets, altChoice } });
        setSelectedHandCardId(undefined);
        return;
      }
    }

    applyCastingCostPaymentSideEffect(seatId, payment);
    // Orb of Dragonkind's discount on a Dragon spell: the Orb(s) that gave it get tapped.
    if ((sourceZone === "hand" || sourceZone === "command") && card.typeLine.includes("Dragon") && !useTapAlt) {
      const orbs = seat.board.battlefield.filter((permanent) => isDragonMana(permanent));
      const genericRoom = Math.max(0, card.manaValue - coloredPipCount(card));
      const toTapOrbs = new Set(orbs.slice(0, Math.min(orbs.length, genericRoom)).map((permanent) => permanent.id));
      if (toTapOrbs.size > 0) {
        setSession((current) => ({
          ...current,
          seats: current.seats.map((item) =>
            item.id !== seatId ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((permanent) => (toTapOrbs.has(permanent.id) ? { ...permanent, tapped: true } : permanent)) } }
          ),
          events: [{ id: crypto.randomUUID(), at: new Date().toISOString(), seatId, message: `${seat.name} pays {1} and taps Orb of Dragonkind for two mana toward ${card.name}.`, detail: "Rules action" }, ...current.events]
        }));
      }
    }
    if (useTapAlt && tapAlt) {
      const toTap = new Set(card.chosenTapAltIds && card.chosenTapAltIds.length === tapAlt.count ? card.chosenTapAltIds : tapAlt.creatureIds.slice(0, tapAlt.count));
      setSession((current) => ({
        ...current,
        seats: current.seats.map((item) =>
          item.id !== seatId ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((permanent) => (toTap.has(permanent.id) ? { ...permanent, tapped: true } : permanent)) } }
        ),
        events: [{ id: crypto.randomUUID(), at: new Date().toISOString(), seatId, message: `${seat.name} pays ${tapAlt.costManaText} and taps ${toTap.size} creatures instead of ${card.name}'s mana cost.`, detail: "Rules action" }, ...current.events]
      }));
    }

    const castName = doorFace?.name ?? spellFace?.name ?? (dfcSplit ? dfcSplit.spellFace.name : card.name);
    const castTypeLine = doorFace?.typeLine ?? spellFace?.typeLine ?? (dfcSplit ? dfcSplit.spellFace.typeLine : card.typeLine);
    const spentManaText = payment.source === "tapped" ? ` using ${availableMana} mana` : ` spending ${formatManaPoolPayment(payment.spent)}`;
    const xText = chosenX > 0 ? ` (X=${chosenX})` : "";
    // An agent picks its modes and targets now (rule 601.2c); for an Adventure/Omen/split/modal-DFC spell face that is the face's own text.
    const castFace = castFaceCard(card, doorFace ?? spellFace ?? (dfcSplit ? dfcSplit.spellFace : undefined));
    const finalCastChoices = castChoices ?? (seat.kind !== "human" && sourceZone !== "command" ? agentCastTimeRemovalChoices(session, seatId, castFace, chosenX > 0 ? chosenX : undefined) : undefined);
    const action: PendingAction = {
      id: crypto.randomUUID(),
      type: "spell",
      actorSeatId: seatId,
      cardId,
      cardName: castName,
      cardTypeLine: castTypeLine,
      sourceZone,
      flashback: graveyardPermission?.exileAfter ? true : undefined,
      manaSourceIds: payment.sourceIds,
      manaSpentColors: spentManaColors(payment.spent),
      position,
      // A genuine transform DFC creature (Heliod, the Radiant Dawn // Heliod, the Warped Eclipse)
      // isn't a Room door, an Adventure/Omen spell face, or an MDFC land — none of doorFace/
      // spellFace/dfcSplit apply, so without this it would enter still carrying its combined,
      // both-faces oracleText (this card data's convention for any 2-faced card) instead of
      // resolving to just its front face the way applyChosenFaceToCard needs a real faceIndex to do.
      // It only ever enters showing face 0 (the front); transformPermanent flips it later.
      faceIndex:
        doorFace ? faceIndex : spellFace ? faceIndex : dfcSplit ? dfcSplit.spellIndex : !doors && card.faces?.length === 2 ? 0 : undefined,
      chosenX: chosenX > 0 ? chosenX : undefined,
      castChoices: finalCastChoices,
      message: `${seat.name} casts ${castName}${xText}${stackTargetText(session, finalCastChoices?.targets ?? [], undefined, castModeLabels(castFace, chosenX > 0 ? chosenX : undefined, finalCastChoices))}${sourceZone === "command" ? " from the command zone" : sourceZone === "exile" ? " from exile" : sourceZone === "graveyard" ? (flashbackCostText ? " with flashback" : " from the graveyard") : sourceZone === "library" ? " from the top of their library" : ""}${spentManaText}.`
    };
    if (usesOnceEachTurnFreeCast) {
      setSession((current) => ({
        ...current,
        onceEachTurnEffectsUsed: [...(current.onceEachTurnEffectsUsed ?? []), onceEachTurnFreeCastKey(current.turn, seatId)]
      }));
    }
    if (usesFateDesignLifeAltCost) {
      setSession((current) => ({
        ...current,
        onceEachTurnEffectsUsed: [...(current.onceEachTurnEffectsUsed ?? []), fateDesignLifeAltCostKey(current.turn, seatId)],
        seats: current.seats.map((item) => (item.id === seatId ? { ...item, life: item.life - baseCost } : item)),
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId,
            message: `${seat.name} pays ${baseCost} life instead of ${castName}'s mana cost.`,
            detail: "Rules action"
          },
          ...current.events
        ]
      }));
    }
    if (sourceZone === "command") setSession((current) => recordCommanderCast(current, seatId, cardId));
    beginPendingAction(action, "Stack", preChosenSacrificeTargets);
    // A spell that targets an opponent or something of theirs is a crime (Magda, the Hoardmaster).
    {
      const targetsOpponent = (finalCastChoices?.targets ?? []).some((target) => target.seatId !== seatId);
      const agentRemoval = seat.kind !== "human" && !castChoices && (() => {
        const removal = parseRemovalEffect(etbEffectText(card.oracleText));
        return removal !== undefined && ["destroy", "exile", "damage", "bounce", "destroy_up_to_x"].includes(removal.kind);
      })();
      if (targetsOpponent || agentRemoval) commitCrime(seatId);
    }
    // Sunken Palace: if the spell was paid for (at least partly) with its marked {U}, copy the spell. The copy goes on the stack above the
    // original, so it resolves first; it is not cast (no cast triggers), pays nothing and keeps the original's modes and targets.
    if (seat.kind === "human" && payment.source === "pool" && (copyMana[seatId] ?? 0) > 0 && (payment.spent.U ?? 0) >= 1) {
      const copyCardId = `${cardId}-spellcopy-${crypto.randomUUID()}`;
      setCopyMana((current) => ({ ...current, [seatId]: Math.max(0, (current[seatId] ?? 0) - 1) }));
      setSession((current) => ({
        ...current,
        seats: current.seats.map((item) =>
          item.id !== seatId ? item : { ...item, board: { ...item.board, hand: [...item.board.hand, { ...card, id: copyCardId, token: true, spellCopy: true, zone: "hand" as const }] } }
        ),
        events: [{ id: crypto.randomUUID(), at: new Date().toISOString(), seatId, message: `Sunken Palace's mana copies ${castName}.`, detail: "Rules action" }, ...current.events]
      }));
      const copyAction: PendingAction = { ...action, id: crypto.randomUUID(), cardId: copyCardId, sourceZone: "hand", manaSourceIds: [], isCopy: true, flashback: undefined, message: `${castName} is copied.` } as PendingAction;
      window.setTimeout(() => beginPendingAction(copyAction, "Stack"), 0);
    }
    setSelectedHandCardId(undefined);
  }

  // Rule 700.13: targeting an opponent, anything they control, or a card in their graveyard is committing a crime. Fires "Whenever you commit a
  // crime, ..." (Magda, the Hoardmaster: a tapped Treasure, once each turn). A human's chosen targets are known; an agent's removal spell counts
  // as one because its targets are chosen as it resolves.
  function commitCrime(seatId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat) return;
    const triggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];
    const usedKeys: string[] = [];
    for (const source of seat.board.battlefield) {
      if (source.abilitiesStripped) continue;
      for (const clause of oracleClauses(source.oracleText)) {
        const match = clause.replace(/\([^)]*\)/g, "").trim().match(/^whenever you commit a crime, (.+?)(?:\s+this ability triggers only once each turn\.?)?$/i);
        if (!match) continue;
        const key = `${session.turn}:${source.id}:crime`;
        if (/triggers only once each turn/i.test(clause) && ((session.onceEachTurnEffectsUsed ?? []).includes(key) || usedKeys.includes(key))) continue;
        const effect = commonTriggerEffect(match[1], "clause", undefined, seat);
        if (!effect) continue;
        usedKeys.push(key);
        triggers.push(makeCommonTrigger(seatId, seatId, source, effect, `${source.name} triggers because ${seat.name} committed a crime.`));
      }
    }
    if (triggers.length === 0) return;
    setSession((current) => ({ ...current, onceEachTurnEffectsUsed: [...(current.onceEachTurnEffectsUsed ?? []), ...usedKeys] }));
    window.setTimeout(() => queueCommonTriggers(triggers), 0);
  }

  function declareHumanAttack(cardId: string, targetId: string) {
    if (pendingAction || activeSeatId !== humanSeat.id) return;
    setSession((current) => declareAttack(current, humanSeat.id, cardId, targetId));
    setInspectedCard(undefined);
  }

  function unlockRoomDoor(seatId: string, cardId: string, faceIndex: number) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    const doors = card ? roomDoorFaces(card) : undefined;
    if (!seat || !card || !doors) return;
    const lockedDoor = doors[faceIndex];
    const shim = cardWithFaceManaCost(card, lockedDoor.manaCost);
    const totalCost = Math.max(0, manaValueFromManaCost(lockedDoor.manaCost) - unlockCostReduction(seat));
    // Prefer whatever's already floating in the human's pool, same pool-first-then-auto-tap
    // preference as every other cost (unlike acceptMiracleOffer/Room-door-unlock's sibling cases
    // above, this one IS a deliberate button click, so a human gets a real chance to pre-tap first).
    const pool = seat.kind === "human" ? poolForSeat(seatId) : undefined;
    const poolPayment = pool ? payCostFromPool(pool, shim, totalCost) : undefined;
    const payment = poolPayment?.ok ? poolPayment : chooseManaSourcesForCost(seat, shim, totalCost, undefined, session.seats);
    if (!payment.ok) {
      addEvent(cannotPayMessage(seat, shim, selectedManaTotal(seat, payment.sourceIds), totalCost, payment.reason), seatId, "Mana");
      return;
    }
    if (poolPayment?.ok) {
      setSeatManaPool(seatId, poolPayment.pool);
      clearManaContributions(seatId);
    }
    setSession((current) => ({
      ...current,
      seats: current.seats.map((item) => {
        if (item.id !== seatId) return item;
        const spent = poolPayment?.ok ? item : spendManaSources(item, payment.sourceIds);
        return {
          ...spent,
          board: {
            ...spent.board,
            battlefield: spent.board.battlefield.map((permanent) =>
              permanent.id === cardId ? unlockSecondRoomDoor(permanent, faceIndex) : permanent
            )
          }
        };
      }),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} unlocks ${lockedDoor.name} on ${card.name} using ${formatManaPoolPayment(payment.spent)}.`
        },
        ...current.events
      ]
    }));
  }

  // A search_library effect needs the interactive library-search choice UI (pendingRuleChoice),
  // which the pure payGenericSacrificeCost/applySacrificeEffect functions can't reach —
  // detected here first, cost paid synchronously against the current session (mirroring how
  // toggleTapCard already reads `session` directly for a same-tick decision), then the same
  // choose_card_from_library flow real tutor spells already use takes over: resolveAgentRuleChoice's
  // existing effect auto-resolves it for agent seats, and the human gets the normal search modal.
  function activateGenericSacrificeAbility(seatId: string, cardId: string, abilityIndex: number) {
    if (humanActionBlockedByChoice(seatId)) return;
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    const ability = card ? parseGenericSacrificeAbilities(abilityOracleText(card))[abilityIndex] : undefined;
    const humanPool = seat?.kind === "human" ? poolForSeat(seatId) : undefined;
    // "Activate only as a sorcery." (Fiend Artisan, Birthing Pod): only in the controller's own main phase with an empty stack.
    if (card && ability && hasSorcerySpeedOnlyLimiter(ability.clause) && !(activeSeatId === seatId && isMainPhase(session.phase) && !pendingAction)) {
      addEvent(`${card.name} can only be activated as a sorcery: during your own main phase with an empty stack.`, seatId, "Rules action");
      return;
    }
    if (card && ability?.effect.kind === "search_library") {
      const paid = payGenericSacrificeCost(session, seatId, cardId, abilityIndex, humanPool);
      if (!paid) return;
      if (paid.poolSpent) {
        setSeatManaPool(seatId, paid.poolSpent);
        clearManaContributions(seatId);
      }
      const searchEffect = ability.effect;
      setSession(() => paid.session);
      // The search is the ability's effect: it goes on the stack (cost paid) and opens only when the ability resolves.
      putAbilityOnStack(seatId, card, ability.clause, () =>
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_card_from_library",
          controllerSeatId: seatId,
          sourceCardId: cardId,
          sourceCardName: card.name,
          prompt: `Search your library: ${ability.clause}`,
          destination: searchEffect.destination,
          tapped: searchEffect.tapped,
          maxChoices: searchEffect.count,
          allowedCardFilter: searchEffect.cardTypeFilter
        })
      );
      return;
    }
    // "Sacrifice a creature" (as opposed to "Sacrifice this creature"/"this artifact," i.e.
    // sacrificeTarget "creature" not "self") needs the same kind of interactive-choice detour as
    // search_library just above — payGenericSacrificeCost is a pure function with no access to
    // setPendingRuleChoice, so it always fell back to chooseSacrificeTargets' heuristic (sacrifice
    // the least valuable creature, tokens first) with no way for a human to choose. Scoped to
    // sacrificeCount === 1 (Viscera Seer and the overwhelming majority of real cards with this
    // shape) — a fixed-count plural sacrifice (Westvale Abbey's "Sacrifice five creatures") would
    // need a multi-select UI this doesn't build, so it stays on the deterministic heuristic
    // unchanged rather than only interactively picking one of the five. Reported live as "Viscera
    // Seer does not let me choose a creature, it just sacrifices itself."
    if (
      card &&
      ability &&
      seat?.kind === "human" &&
      ability.sacrificeTarget !== "self" &&
      (ability.sacrificeCount === 1 ||
        seat.board.battlefield.filter((creature) =>
          ability.sacrificeTarget === "permanent"
            ? creature.id !== cardId && matchesPermanentSacrificeFilter(creature, ability.sacrificeTargetTypeFilter)
            : creature.typeLine.includes("Creature") && creature.id !== (ability.sacrificeExcludesSelf ? cardId : undefined) && matchesSacrificeFilter(creature, ability.sacrificeTargetTypeFilter)
        ).length > ability.sacrificeCount)
    ) {
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_creature_to_sacrifice",
        controllerSeatId: seatId,
        sourceCardId: cardId,
        sourceCardName: card.name,
        prompt: `${card.name}: choose ${ability.sacrificeTarget === "permanent" ? "a permanent" : "a creature"} to sacrifice.`,
        abilityIndex,
        typeFilter: ability.sacrificeTargetTypeFilter,
        excludeCardId: ability.sacrificeExcludesSelf || ability.sacrificeTarget === "permanent" ? cardId : undefined,
        anyPermanent: ability.sacrificeTarget === "permanent" || undefined,
        count: ability.sacrificeCount
      });
      return;
    }
    // "Choose one — mode. mode. mode." (Cankerbloom's "Destroy target artifact/enchantment/
    // Proliferate") needs the same interactive-choice detour, one level deeper: the COST is paid
    // immediately (unlike choose_creature_to_sacrifice above, choosing a MODE doesn't affect what
    // gets sacrificed here, since Cankerbloom's sacrificeTarget is "self"), then the modal choice
    // opens instead of applyRemovalEffect's own "modal" case auto-picking. Only chooseCount 1
    // ("Choose one") is interactive — see choose_modal_option's own doc comment for why "Choose two"
    // stays on the deterministic path. Reported live as Cankerbloom always destroying an artifact
    // with no way to pick Destroy Enchantment or Proliferate.
    if (card && ability?.effect.kind === "removal" && ability.effect.effect.kind === "modal" && ability.effect.effect.chooseCount === 1 && seat?.kind === "human") {
      const modalEffect = ability.effect.effect;
      // Rule 602.2b/601.2c: an ability with no legal target for any mode cannot be activated. Checked BEFORE the cost is paid; paying (sacrificing the
      // source) and then finding no viable mode used to silently throw the permanent away for nothing.
      if (!modalEffect.modes.some((mode) => removalEffectHasLegalTarget(session, seatId, card, mode))) {
        addEvent(`${card.name} cannot be activated: none of its modes has a legal target. Nothing was sacrificed or paid.`, seatId, "Rules action");
        return;
      }
      const paid = payGenericSacrificeCost(session, seatId, cardId, abilityIndex, humanPool);
      if (!paid) return;
      if (paid.poolSpent) {
        setSeatManaPool(seatId, paid.poolSpent);
        clearManaContributions(seatId);
      }
      setSession(() => paid.session);
      const viableModes = modalEffect.modes.filter((mode) => removalEffectHasLegalTarget(paid.session, seatId, paid.card, mode));
      if (viableModes.length === 0) return;
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_modal_option",
        controllerSeatId: seatId,
        sourceCardId: cardId,
        sourceCardName: card.name,
        prompt: `${card.name}: choose one.`,
        options: viableModes.map((mode, index) => ({ index, label: describeRemovalMode(mode) })),
        modes: viableModes,
        sourceCard: paid.card
      });
      return;
    }
    const paid = payGenericSacrificeCost(session, seatId, cardId, abilityIndex, humanPool);
    if (!paid) return;
    if (paid.poolSpent) {
      setSeatManaPool(seatId, paid.poolSpent);
      clearManaContributions(seatId);
    }
    finishPaidSacrificeAbility(seatId, paid);
  }

  // After a sacrifice ability's cost is paid (rule 602.2): the cost is committed now and the effect goes on the stack, resolving only once everyone has
  // had priority. A mana ability (Ashnod's Altar's "Sacrifice a creature: Add {C}{C}") never uses the stack: its mana is added at once.
  function finishPaidSacrificeAbility(seatId: string, paid: NonNullable<ReturnType<typeof payGenericSacrificeCost>>) {
    setSession(() => paid.session);
    if (paid.ability.effect.kind === "add_mana") {
      let pool = poolForSeat(seatId);
      for (const symbol of paid.ability.effect.symbols.match(/{([wubrgc])}/gi) ?? []) pool = addManaToPool(pool, symbol[1].toUpperCase() as ManaColor, 1);
      setSeatManaPool(seatId, pool);
      addEvent(`${paid.card.name} adds ${paid.ability.effect.symbols} to ${session.seats.find((item) => item.id === seatId)?.name ?? "the player"}'s mana pool.`, seatId, "Rules action");
      return;
    }
    putAbilityOnStack(seatId, paid.card, paid.ability.clause, () => abilityApiRef.current.resolveSacrificeAbilityEffect(seatId, paid));
  }

  // An activated ability (cost already paid) goes on the stack as an ability item; `resolve` runs when it resolves. Shown in the stack dock like a trigger.
  function putAbilityOnStack(seatId: string, card: VisibleCard, label: string, resolve: () => void) {
    const resolverId = crypto.randomUUID();
    abilityResolvers.current.set(resolverId, resolve);
    const activator = session.seats.find((item) => item.id === seatId);
    const ability = makeCommonTrigger(seatId, seatId, card, { kind: "deferred_ability", resolverId }, `${activator?.name ?? "A player"} activates ${card.name}: ${label}`);
    beginPendingAction(ability, "Stack");
  }

  // The effect of a sacrifice ability, applied when it RESOLVES (the cost was paid and committed at activation): Birthing Pod opens its
  // mana-value-restricted search (the sacrificed creature is known), the human gets their look windows and targets, everything else applies.
  function resolveSacrificeAbilityEffect(seatId: string, paid: NonNullable<ReturnType<typeof payGenericSacrificeCost>>) {
    // The human's own choices after the cost is paid (look windows, targets), whichever way the cost was paid - including a sacrifice the
    // human chose from a list - so every route into a sacrifice ability asks the same questions.
    const seat = session.seats.find((item) => item.id === seatId);
    const cardId = paid.card.id;
    // Orb of Dragonkind: the human looks at the top cards and picks which Dragon (if any) to take.
    if (seat?.kind === "human" && paid.ability.effect.kind === "dig_type_to_hand") {
      const digEffect = paid.ability.effect;
      const top = (session.seats.find((item) => item.id === seatId)?.library ?? []).slice(0, digEffect.count);
      const candidates = top.filter((candidate) => candidate.typeLine.toLowerCase().includes(digEffect.typeWord));
      if (candidates.length >= 1) {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_dig_card",
          controllerSeatId: seatId,
          sourceCardId: cardId,
          sourceCardName: paid.card.name,
          prompt: paid.card.name + ": you look at the top " + top.length + " cards. Reveal a " + digEffect.typeWord + " card to put in your hand?",
          count: digEffect.count,
          typeWord: digEffect.typeWord,
          options: [...candidates.map((candidate, index) => ({ index, label: candidate.name + " (" + candidate.typeLine + ")", cardId: candidate.id })), { index: candidates.length, label: "Take nothing", cardId: "none" }]
        });
        return;
      }
    }
    // Scry/surveil from a sacrifice ability: the human looks at the cards and decides.
    if (seat?.kind === "human" && (paid.ability.effect.kind === "scry" || paid.ability.effect.kind === "surveil")) {
      const lookEffect = paid.ability.effect;
      startLibraryLook(lookEffect.kind as LibraryLookMode, (lookEffect as { amount: number }).amount + (lookEffect.kind === "surveil" ? surveilBonusForSeat(seat) : 0));
      return;
    }
    // One-verb effects on a chosen target after a sacrifice (Yawgmoth's counter): the human picks it.
    if (seat?.kind === "human" && paid.ability.effect.kind === "targeted_effect") {
      const targeted = paid.ability.effect.effect;
      if (maybeRequestTarget(seatId, paid.card, targetedEffectSpec(targeted, paid.card.id, paid.card.name), false, { kind: "targeted", effect: targeted })) return;
    }
    // "Destroy target creature" and friends after a sacrifice (Thrashing Brontodon): the human aims it.
    if (seat?.kind === "human" && paid.ability.effect.kind === "removal" && paid.ability.effect.effect.kind !== "modal") {
      const removalEff = paid.ability.effect.effect;
      if (maybeRequestTarget(seatId, paid.card, removalEffectTargetSpec(removalEff, cardId), false, { kind: "removal", effect: removalEff })) return;
      if (openAbilityDamageAim(seatId, paid.card, removalEff, session)) return;
    }
    // "Return target Zombie card from your graveyard to your hand" (Memorial to Folly, Haven of the Spirit Dragon): the human picks the card.
    if (seat?.kind === "human" && paid.ability.effect.kind === "zone_effect") {
      const zoneEff = paid.ability.effect.effect;
      if (maybeRequestTarget(seatId, paid.card, zoneChoiceSpecFor(session, seatId, zoneEff, paid.card), false, { kind: "zone", effect: zoneEff })) return;
    }
    // Fiend Artisan: "search for a creature card with mana value X or less" — X was fixed when the cost was paid.
    if (paid.ability.effect.kind === "search_creature_by_x") {
      const limit = paid.xValue ?? 0;
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_card_from_library",
        controllerSeatId: seatId,
        sourceCardId: paid.card.id,
        sourceCardName: paid.card.name,
        prompt: `${paid.card.name}: search your library for a creature card with mana value ${limit} or less and put it onto the battlefield.`,
        destination: "battlefield",
        tapped: false,
        maxChoices: 1,
        allowedCardFilter: "creature",
        manaValueRestriction: { op: "lte", value: limit }
      });
      return;
    }
    if (paid.ability.effect.kind === "search_creature_by_sacrificed_mv") {
      const wantedValue = Math.max(0, ...paid.sacrificed.map((creature) => creature.manaValue)) + 1;
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_card_from_library",
        controllerSeatId: seatId,
        sourceCardId: paid.card.id,
        sourceCardName: paid.card.name,
        prompt: `${paid.card.name}: search your library for a creature card with mana value ${wantedValue} and put it onto the battlefield.`,
        destination: "battlefield",
        tapped: false,
        maxChoices: 1,
        allowedCardFilter: "creature",
        manaValueRestriction: { op: "eq", value: wantedValue }
      });
      return;
    }
    setSession((current) => applySacrificeEffect(current, seatId, paid.card, paid.ability.effect, paid.ability.clause, paid.sacrificed));
  }

  function activateGenericTapAbility(seatId: string, cardId: string, abilityIndex: number, chosenDiscardId?: string, chosenCardId?: string, chosenTapIds?: string[]) {
    if (humanActionBlockedByChoice(seatId)) return;
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    const ability = card ? parseGenericTapAbilities(abilityOracleText(card))[abilityIndex] : undefined;
    const humanPool = seat?.kind === "human" ? poolForSeat(seatId) : undefined;
    if (seat?.kind === "human" && card && ability) {
      // Dry run of the whole cost first, so a human who can't pay gets told why instead of a click
      // that silently does nothing — and so the discard prompt below is only ever offered for an
      // activation that will actually go through once they've picked.
      if (!payGenericTapCost(session, seatId, cardId, abilityIndex, humanPool, chosenDiscardId, chosenTapIds)) {
        addEvent(
          ability.costDiscard && discardableHandCards(seat, ability.costDiscardType).length === 0
            ? `You have no ${ability.costDiscardType ? `${ability.costDiscardType.toLowerCase()} card` : "card"} in hand to discard, so you can't activate ${card.name}.`
            : !ability.costTapCreatures && card.tapped
              ? `${card.name} is already tapped, so you can't activate its {T} ability.`
              : !ability.costTapCreatures && card.typeLine.includes("Creature") && card.summoningSick && !hasHaste(card)
                ? `${card.name} came under your control this turn (summoning sick), so it can't use a {T} ability yet.`
                : `You can't pay for ${card.name}'s ability right now (${ability.costManaText || "no mana"}).`,
          seatId,
          "Rules action"
        );
        return;
      }
      // The discard half of the cost is the player's own choice (Cryptbreaker: "Discard a card") —
      // payGenericTapCost's chooseWorstHandCardToDiscard would otherwise pick for them.
      if (ability.costDiscard && !chosenDiscardId) {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "discard_to_hand_size",
          controllerSeatId: seatId,
          sourceCardName: card.name,
          prompt: `${card.name}: choose a ${ability.costDiscardType ? `${ability.costDiscardType.toLowerCase()} card` : "card"} to discard as part of the cost.`,
          requiredDiscards: 1,
          activation: { cardId, abilityIndex, discardType: ability.costDiscardType }
        });
        return;
      }
    }
    // "Tap three untapped Zombies you control" (Cryptbreaker): the human chooses which ones.
    if (seat?.kind === "human" && card && ability?.costTapCreatures && !chosenTapIds) {
      const tapCost = ability.costTapCreatures;
      const eligible = seat.board.battlefield.filter((creature) => canTapForCost(creature, tapCost.subtype));
      if (eligible.length > tapCost.count) {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_creature_to_sacrifice",
          controllerSeatId: seatId,
          sourceCardId: cardId,
          sourceCardName: card.name,
          prompt: `${card.name}: choose ${tapCost.count} untapped ${tapCost.subtype}s to tap.`,
          abilityIndex,
          count: tapCost.count,
          tapSubtype: tapCost.subtype
        });
        return;
      }
    }
    // Cemetery Reaper ("exile target creature card from a graveyard") and Zul Ashur ("choose target Zombie card in your graveyard"): the human
    // picks the card before paying; the activation then re-runs with that card.
    if (seat?.kind === "human" && card && ability && chosenCardId === undefined) {
      const effect = ability.effect;
      const pool =
        effect.kind === "exile_graveyard_creature_then_tokens"
          ? session.seats.flatMap((other) => (other.board.graveyard ?? []).filter((graveCard) => graveCard.typeLine.includes("Creature")).map((graveCard) => ({ seatId: other.id, cardId: graveCard.id })))
          : effect.kind === "grant_graveyard_cast"
            ? (seat.board.graveyard ?? []).filter((graveCard) => permanentMatchesQualifier(graveCard, effect.cardMatcher)).map((graveCard) => ({ seatId: seat.id, cardId: graveCard.id }))
            : undefined;
      if (pool && pool.length >= 1) {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_ability_card_target",
          controllerSeatId: seatId,
          sourceCardId: cardId,
          sourceCardName: card.name,
          prompt: effect.kind === "grant_graveyard_cast" ? card.name + ": choose a card in your graveyard you may cast this turn." : card.name + ": choose a creature card from a graveyard to exile.",
          cards: pool,
          activation: { cardId, abilityIndex, via: "tap" }
        });
        return;
      }
    }
    if (card && ability?.effect.kind === "search_library") {
      const paid = payGenericTapCost(session, seatId, cardId, abilityIndex, humanPool, chosenDiscardId, chosenTapIds);
      if (!paid) return;
      if (paid.poolSpent) {
        setSeatManaPool(seatId, paid.poolSpent);
        clearManaContributions(seatId);
      }
      const searchEffect = ability.effect;
      setSession(() => paid.session);
      // The search is the ability's effect: it goes on the stack (cost paid) and opens only when the ability resolves.
      putAbilityOnStack(seatId, card, ability.clause, () =>
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_card_from_library",
          controllerSeatId: seatId,
          sourceCardId: cardId,
          sourceCardName: card.name,
          prompt: `Search your library: ${ability.clause}`,
          destination: searchEffect.destination,
          tapped: searchEffect.tapped,
          maxChoices: searchEffect.count,
          allowedCardFilter: searchEffect.cardTypeFilter
        })
      );
      return;
    }
    const paid = payGenericTapCost(session, seatId, cardId, abilityIndex, humanPool, chosenDiscardId, chosenTapIds);
    if (!paid) return;
    if (paid.poolSpent) {
      setSeatManaPool(seatId, paid.poolSpent);
      clearManaContributions(seatId);
    }
    // Sunken Palace: the mana goes into the pool, marked so that the spell it pays for is copied.
    if (paid.ability.effect.kind === "add_copy_mana") {
      const manaColor = paid.ability.effect.symbol.replace(/[{}]/g, "") as ManaColor;
      setSession(() => paid.session);
      setSeatManaPool(seatId, addManaToPool(paid.poolSpent ?? poolForSeat(seatId), manaColor, 1));
      setCopyMana((current) => ({ ...current, [seatId]: (current[seatId] ?? 0) + 1 }));
      addEvent(`${paid.card.name} adds ${paid.ability.effect.symbol}; the spell it pays for will be copied.`, seatId, "Rules action");
      return;
    }
    // Cost paid and committed; the effect goes on the stack and is applied when the ability resolves (rule 602.2).
    setSession(() => paid.session);
    putAbilityOnStack(seatId, paid.card, paid.ability.clause, () => abilityApiRef.current.resolveTapAbilityEffect(seatId, cardId, paid, chosenCardId));
  }

  // The effect of a {T} ability, applied when it resolves: the human's look windows and targets, then the effect itself.
  function resolveTapAbilityEffect(seatId: string, cardId: string, paid: NonNullable<ReturnType<typeof payGenericTapCost>>, chosenCardId?: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    // Loot, Exuberant Explorer: after paying, the human sees the top cards and picks which creature (if any) enters.
    if (seat?.kind === "human" && paid.ability.effect.kind === "dig_creature_to_battlefield") {
      const digEffect = paid.ability.effect;
      const owner = session.seats.find((item) => item.id === seatId);
      const landCount = owner?.board.battlefield.filter((permanent) => isLandCard(permanent)).length ?? 0;
      const top = (owner?.library ?? []).slice(0, digEffect.count);
      const candidates = top.filter((candidate) => candidate.typeLine.includes("Creature") && candidate.manaValue <= landCount);
      if (candidates.length >= 1) {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_dig_card",
          controllerSeatId: seatId,
          sourceCardId: cardId,
          sourceCardName: paid.card.name,
          prompt: paid.card.name + ": you look at the top " + top.length + " cards. Put a creature with mana value " + landCount + " or less onto the battlefield?",
          count: digEffect.count,
          typeWord: "creature",
          toBattlefieldMaxManaValue: landCount,
          options: [...candidates.map((candidate, index) => ({ index, label: candidate.name + " (mana value " + candidate.manaValue + ")", cardId: candidate.id })), { index: candidates.length, label: "Take nothing", cardId: "none" }]
        });
        return;
      }
    }
    // "Target creature can't be blocked this turn." (Rogue's Passage): the human chooses the creature after paying.
    if (seat?.kind === "human" && paid.ability.effect.kind === "target_unblockable") {
      const yours = session.seats.find((item) => item.id === seatId)?.board.battlefield.filter((card) => card.typeLine.includes("Creature")) ?? [];
      if (yours.length >= 2) {
        setPendingRuleChoice({ id: crypto.randomUUID(), kind: "choose_creature_for_grant", controllerSeatId: seatId, sourceCardId: cardId, sourceCardName: paid.card.name, prompt: paid.card.name + ": choose the creature that can't be blocked this turn.", keywords: ["can't be blocked"] });
        return;
      }
    }
    // One-verb effects on a chosen target ({T}: Target creature gains lifelink ...): the human picks it.
    if (seat?.kind === "human" && paid.ability.effect.kind === "targeted_effect") {
      const targeted = paid.ability.effect.effect;
      if (maybeRequestTarget(seatId, paid.card, targetedEffectSpec(targeted, paid.card.id, paid.card.name), false, { kind: "targeted", effect: targeted })) return;
    }
    // Lord of the Undead and friends: "return target Zombie card from your graveyard to your hand" — the human picks the card.
    if (seat?.kind === "human" && paid.ability.effect.kind === "zone_effect") {
      const zoneEff = paid.ability.effect.effect;
      if (maybeRequestTarget(seatId, paid.card, zoneChoiceSpecFor(session, seatId, zoneEff, paid.card), false, { kind: "zone", effect: zoneEff })) return;
    }
    // Geier Reach Sanitarium: everyone draws, then discards; the human's own discard is their choice.
    if (seat?.kind === "human" && paid.ability.effect.kind === "each_player_loots") {
      setSession((current) => applyGenericTapEffect(current, seatId, cardId, paid.card.name, paid.ability.effect, paid.ability.clause, undefined, { skipDiscardSeatId: seatId }));
      const owner = session.seats.find((item) => item.id === seatId);
      if (owner && owner.board.hand.length + ((owner.library ?? []).length > 0 ? 1 : 0) >= 1) {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "discard_to_hand_size",
          controllerSeatId: seatId,
          sourceCardName: paid.card.name,
          prompt: paid.card.name + ": choose a card to discard.",
          requiredDiscards: 1
        });
      }
      return;
    }
    setSession((current) => applyGenericTapEffect(current, seatId, cardId, paid.card.name, paid.ability.effect, paid.ability.clause, chosenCardId));
  }

  function activateSelfUntapAbility(seatId: string, cardId: string, abilityIndex: number) {
    if (humanActionBlockedByChoice(seatId)) return;
    const seat = session.seats.find((item) => item.id === seatId);
    const humanPool = seat?.kind === "human" ? poolForSeat(seatId) : undefined;
    const resolved = resolveSelfUntapAbility(session, seatId, cardId, abilityIndex, humanPool);
    if (resolved.poolSpent) {
      setSeatManaPool(seatId, resolved.poolSpent);
      clearManaContributions(seatId);
    }
    setSession(() => resolved.session);
  }

  // "Deals N damage to any target" from an activated ability (Prodigal Pyromancer-style): the human aims it. True when the prompt opened.
  function openAbilityDamageAim(seatId: string, sourceCard: VisibleCard, effect: RemovalEffect, afterPaymentSession: GameSession): boolean {
    if (effect.kind !== "damage" || typeof effect.amount !== "number" || effect.targetType === "creature") return false;
    const options = labeledTargetOptions(afterPaymentSession, seatId, effect.targetType === "player" ? "player" : "any_damage", sourceCard);
    if (options.length < 2) return false;
    setSession(() => afterPaymentSession);
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "choose_labeled_target",
      controllerSeatId: seatId,
      sourceCardId: sourceCard.id,
      sourceCardName: sourceCard.name,
      sourceCard,
      slots: [{ prompt: sourceCard.name + ": choose a target for " + effect.amount + " damage.", options }],
      slotIndex: 0,
      picks: [],
      continuation: { kind: "damage", effect }
    });
    return true;
  }

  function activateGenericManaAbility(seatId: string, cardId: string, abilityIndex: number, chosenCardId?: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    const ability = card ? parseGenericManaAbilities(card.oracleText)[abilityIndex] : undefined;
    // Steel Hellkite's {X}: the agent takes the best X; a human is asked which X (with what it would destroy).
    if (seat && card && ability?.costHasX) {
      const options = steelHellkiteXOptions(session, seat, card);
      if (options.length === 0) {
        addEvent(`${card.name} has no X worth activating right now (it must have dealt combat damage this turn, once per turn).`, seatId, "Rules action");
        return;
      }
      if (seat.kind !== "human") {
        const best = options.find((option) => option.best) ?? options[0];
        setSession((current) => activateSteelHellkiteX(current, seatId, cardId, best.x));
        return;
      }
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_trigger_option",
        controllerSeatId: seatId,
        sourceCardId: cardId,
        sourceCardName: card.name,
        prompt: `${card.name}: choose X (destroys each nonland permanent with mana value X controlled by a player it damaged this turn).`,
        options: options.map((option, index) => ({ index, label: `X = ${option.x}: destroys ${option.theirs} of theirs, ${option.mine} of yours` })),
        trigger: makeCommonTrigger(seatId, seatId, card, { kind: "deferred_choice", resolver: "steel_hellkite_x", data: { cardId }, values: options.map((option) => String(option.x)) }, `${card.name}'s ability resolves.`),
        remainingStack: []
      });
      return;
    }
    const effect = ability ? parseGenericAbilityEffect(ability.effectText) : undefined;
    const humanPool = seat?.kind === "human" ? poolForSeat(seatId) : undefined;
    // "Exile target card from a graveyard" (Scavenging Ooze): the human picks the card, then pays.
    if (seat?.kind === "human" && card && ability && effect?.kind === "exile_graveyard_card_scavenge" && chosenCardId === undefined) {
      const pool = session.seats.flatMap((other) => (other.board.graveyard ?? []).map((graveCard) => ({ seatId: other.id, cardId: graveCard.id })));
      if (pool.length === 0) {
        addEvent(`There is no card in any graveyard for ${card.name} to exile.`, seatId, "Rules action");
        return;
      }
      if (!payGenericManaCost(session, seatId, cardId, abilityIndex, humanPool)) {
        addEvent(`You don't have enough open mana to activate ${card.name} (${ability.costManaText || "no mana"}).`, seatId, "Rules action");
        return;
      }
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_ability_card_target",
        controllerSeatId: seatId,
        sourceCardId: cardId,
        sourceCardName: card.name,
        prompt: `${card.name}: choose a card from a graveyard to exile.`,
        cards: pool,
        activation: { cardId, abilityIndex }
      });
      return;
    }
    if (card && ability && effect?.kind === "search_library") {
      const paid = payGenericManaCost(session, seatId, cardId, abilityIndex, humanPool);
      if (!paid) return;
      if (paid.poolSpent) {
        setSeatManaPool(seatId, paid.poolSpent);
        clearManaContributions(seatId);
      }
      const searchEffect = effect.effect;
      setSession(() => paid.session);
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_card_from_library",
        controllerSeatId: seatId,
        sourceCardId: cardId,
        sourceCardName: card.name,
        prompt: `Search your library: ${ability.clause}`,
        destination: searchEffect.destination,
        tapped: searchEffect.tapped,
        maxChoices: searchEffect.count,
        allowedCardFilter: searchEffect.cardTypeFilter
      });
      return;
    }
    const paid = payGenericManaCost(session, seatId, cardId, abilityIndex, humanPool);
    if (!paid) {
      if (seat && card && ability) {
        // Say why instead of silently doing nothing: rule 119.4 lets you pay life equal to your life total but never more.
        const why =
          ability.costLife > seat.life
            ? `you can't pay ${ability.costLife} life with only ${seat.life}`
            : hasOnceEachTurnLimiter(ability.clause) && session.onceEachTurnEffectsUsed?.includes(`${session.turn}:${cardId}:generic_mana:${abilityIndex}`)
              ? "it can only be activated once each turn"
              : "its cost can't be paid right now";
        addEvent(`${card.name} can't be activated: ${why}.`, seatId, "Rules action");
      }
      return;
    }
    if (paid.poolSpent) {
      setSeatManaPool(seatId, paid.poolSpent);
      clearManaContributions(seatId);
    }
    // Greed's "{B}, Pay 2 life: Draw a card." is this shape (a generic mana ability whose effect is
    // a plain card draw) — every other draw path already checks for a miracle window right after
    // drawing (see drawCard above for the simplest example); this one never did, so drawing your
    // first card of the turn off Greed silently skipped the miracle offer a natural/granted-miracle
    // draw would have gotten.
    // The human aims a targeted pump (Rhonas the Indomitable) or removal ability instead of the heuristic picking.
    if (seat?.kind === "human" && chosenCardId === undefined) {
      const aimEffect = paid.effect;
      const aimSpec =
        aimEffect.kind === "pump"
          ? ({ id: "target", zone: "battlefield", permanentType: "creature", controller: "any", min: 1, max: 1, excludedCardIds: aimEffect.effect.another ? [cardId] : [], prompt: `${paid.card.name}: choose a target creature.` } as TargetSpec)
          : aimEffect.kind === "removal" && aimEffect.effect.kind !== "modal"
            ? removalEffectTargetSpec(aimEffect.effect, cardId)
            : undefined;
      if (aimSpec) {
        setSession(() => paid.session);
        const pending: PendingTargetedEffect | undefined = aimEffect.kind === "pump" ? { kind: "pump", effect: aimEffect.effect } : aimEffect.kind === "removal" ? { kind: "removal", effect: aimEffect.effect } : undefined;
        if (pending && maybeRequestTarget(seatId, paid.card, aimSpec, false, pending)) return;
      }
      if (aimEffect.kind === "removal" && openAbilityDamageAim(seatId, paid.card, aimEffect.effect, paid.session)) return;
      // Zur, Eternal Schemer: "Target non-Aura enchantment you control becomes a creature ...": the human chooses which.
      if (aimEffect.kind === "animate_enchantment" && seat) {
        const animateSpec = animateEnchantmentSpec(seat, paid.card.name);
        setSession(() => paid.session);
        if (maybeRequestTarget(seatId, paid.card, animateSpec, false, { kind: "animate_enchantment" })) return;
      }
      if (aimEffect.kind === "zone") {
        const zoneEff = aimEffect.effect;
        setSession(() => paid.session);
        if (maybeRequestTarget(seatId, paid.card, zoneChoiceSpecFor(session, seatId, zoneEff, paid.card), false, { kind: "zone", effect: zoneEff })) return;
      }
      if (aimEffect.kind === "trigger" && aimEffect.effect.kind === "targeted_effect") {
        const targeted = aimEffect.effect.effect;
        setSession(() => paid.session);
        if (maybeRequestTarget(seatId, paid.card, targetedEffectSpec(targeted, paid.card.id, paid.card.name), false, { kind: "targeted", effect: targeted })) return;
      }
    }
    const next = applyGenericAbilityEffect(paid.session, seatId, paid.card, paid.effect, chosenCardId);
    setSession(next);
    checkMiracleAfterDraw(session, next);
  }

  // Only ever wired to the human control panel's own Equip button (ThreeGameTable only offers it
  // when the inspected card's owner is a human seat) — agents equip through a separate call site
  // straight into resolveEquip, unaffected by this interactive gate.
  function activateEquip(seatId: string, cardId: string) {
    if (humanActionBlockedByChoice(seatId)) return;
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    if (!seat || !card) return;

    // Rule 702.6e: equip is sorcery-speed only — same main-phase/own-turn/empty-stack condition
    // already used for a human's land/spell plays (playCard). Agents already get this right via
    // legalActivatedAbilityActions' own sorcerySpeedAllowed gate; this closes the human-only gap
    // that let Equip fire unconditionally at any time, including combat or an opponent's turn.
    if (pendingAction || activeSeatId !== seatId || !isMainPhase(session.phase)) {
      addEvent(`${seat.name} can only equip ${card.name} during a main phase on their own turn, with an empty stack.`, seatId, "Timing");
      return;
    }

    const cost = equipCost(card.oracleText);
    if (cost === undefined) return;
    const creatures = seat.board.battlefield.filter((item) => item.typeLine.includes("Creature"));
    if (creatures.length === 0) return;
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "choose_equip_target",
      controllerSeatId: seatId,
      sourceCardId: cardId,
      sourceCardName: card.name,
      prompt: `${card.name}: choose a creature to equip.`,
      cost
    });
  }

  // Human resolution for choose_equip_target — the human already picked which creature to equip;
  // this pays the cost (mana-pool-first-then-auto-tap, same as the agent path) and attaches, only
  // once a target is actually chosen (see choose_equip_target's own doc comment for why this is
  // "open the choice, pay once picked" rather than resolveEquip's auto-pick-then-apply order).
  function confirmEquipTarget(targetCardId: string) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_equip_target") return;
    const seat = session.seats.find((item) => item.id === choice.controllerSeatId);
    const humanPool = seat?.kind === "human" ? poolForSeat(choice.controllerSeatId) : undefined;
    const resolved = resolveEquip(session, choice.controllerSeatId, choice.sourceCardId, humanPool, targetCardId);
    if (!resolved) return;
    setPendingRuleChoice(undefined);
    if (resolved.poolSpent) {
      setSeatManaPool(choice.controllerSeatId, resolved.poolSpent);
      clearManaContributions(choice.controllerSeatId);
    }
    setSession(() => resolved.session);
  }

  function activateManlandAnimation(seatId: string, cardId: string) {
    if (humanActionBlockedByChoice(seatId)) return;
    const seat = session.seats.find((item) => item.id === seatId);
    const humanPool = seat?.kind === "human" ? poolForSeat(seatId) : undefined;
    const resolved = resolveManlandAnimation(session, seatId, cardId, humanPool);
    if (!resolved) return;
    if (resolved.poolSpent) {
      setSeatManaPool(seatId, resolved.poolSpent);
      clearManaContributions(seatId);
    }
    setSession(() => resolved.session);
  }

  // Prowess and extort both trigger the instant a spell is cast (put on the stack), regardless of
  // whether it came from a main-phase cast or an instant-speed response — beginPendingAction is
  // the one choke point every spell cast passes through, so it's checked here rather than at each
  // of the three call sites that construct a "spell" PendingAction.
  function checkCastTriggeredKeywords(action: Extract<PendingAction, { type: "spell" }>) {
    const caster = session.seats.find((seat) => seat.id === action.actorSeatId);
    const sourceCard = findSpellSourceCard(session, action);
    if (!caster || !sourceCard) return;

    // "The next spell you cast this turn has affinity for artifacts" is used up by this cast
    // whether or not it actually reduced anything (e.g. zero artifacts controlled) — the cost
    // itself was already computed with the discount by adjustedCastingCost/maxAffordableX earlier
    // in playCard, before beginPendingAction (and this function) ever runs.
    if (caster.nextSpellHasArtifactAffinity || caster.nextSpellHasImprovise) {
      setSession((current) => ({
        ...current,
        seats: current.seats.map((seat) => (seat.id === caster.id ? { ...seat, nextSpellHasArtifactAffinity: false, nextSpellHasImprovise: false } : seat))
      }));
    }

    // Path of Ancestry: its mana spent on a creature spell sharing a type with your commander scries 1.
    if (pathOfAncestryScries(session, caster.id, sourceCard, [...action.manaSourceIds, ...lastCastManaContributors.current])) {
      if (caster.kind === "human") startLibraryLook("scry", 1);
      else setSession((current) => resolveAgentLibraryLookWorkflow(current, caster.id, "Path of Ancestry", "scry_cards", 1));
      addEvent(`Path of Ancestry: ${caster.name} scries 1.`, caster.id, "Rules action");
    }
    // Carnelian Orb of Dragonkind: "If that mana is spent on a Dragon creature spell, it gains haste until end of turn." The mark rides on
    // the spell's card (every zone it can be cast from) and survives into the battlefield copy made on resolution.
    if (/\bdragon\b/i.test(sourceCard.typeLine) && sourceCard.typeLine.includes("Creature")) {
      const paidIds = [...action.manaSourceIds, ...lastCastManaContributors.current];
      const hasteMana = caster.board.battlefield.some((card) => paidIds.includes(card.id) && /if that mana is spent on a dragon creature spell, it gains haste until end of turn/i.test(card.oracleText));
      if (hasteMana) {
        const grant = (card: VisibleCard): VisibleCard => (card.id !== sourceCard.id ? card : { ...card, temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), "haste"], grantedKeywords: [...(card.grantedKeywords ?? []), "haste"] });
        setSession((current) => ({
          ...current,
          seats: current.seats.map((seat) =>
            seat.id !== caster.id
              ? seat
              : {
                  ...seat,
                  library: seat.library?.map(grant),
                  board: { ...seat.board, hand: seat.board.hand.map(grant), commander: seat.board.commander ? grant(seat.board.commander) : seat.board.commander, graveyard: seat.board.graveyard?.map(grant), exile: seat.board.exile?.map(grant) }
                }
          )
        }));
        addEvent(`Carnelian Orb of Dragonkind: ${sourceCard.name} gains haste until end of turn.`, caster.id, "Rules action");
      }
    }
    lastCastManaContributors.current = [];

    if (!sourceCard.typeLine.includes("Creature")) {
      const prowessCreatureIds = caster.board.battlefield.filter((card) => hasKeyword(card, "prowess")).map((card) => card.id);
      if (prowessCreatureIds.length > 0) {
        setSession((current) => ({
          ...current,
          seats: current.seats.map((seat) =>
            seat.id === caster.id
              ? {
                  ...seat,
                  board: {
                    ...seat.board,
                    battlefield: seat.board.battlefield.map((card) =>
                      prowessCreatureIds.includes(card.id)
                        ? { ...card, temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + 1, temporaryToughnessBonus: (card.temporaryToughnessBonus ?? 0) + 1 }
                        : card
                    )
                  }
                }
              : seat
          ),
          events: [
            {
              id: crypto.randomUUID(),
              at: new Date().toISOString(),
              seatId: caster.id,
              message: `${caster.name}'s prowess creature${prowessCreatureIds.length === 1 ? "" : "s"} get +1/+1 until end of turn from casting ${sourceCard.name}.`,
              detail: "Rules action"
            },
            ...current.events
          ]
        }));
      }
    }

    const extortSources = caster.board.battlefield.filter((card) => hasKeyword(card, "extort"));
    for (const extortSource of extortSources) {
      const manaSource = caster.board.battlefield.find(
        (card) =>
          isAvailableManaSource(card, caster, session.seats) &&
          !card.tapped &&
          (manaChoicesForCard(card, caster, session.seats).includes("W") || manaChoicesForCard(card, caster, session.seats).includes("B"))
      );
      if (!manaSource) continue;
      const opponentIds = session.seats.filter((seat) => seat.id !== caster.id && !seat.hasLost).map((seat) => seat.id);
      if (opponentIds.length === 0) continue;
      setSession((current) => ({
        ...current,
        seats: current.seats.map((seat) => {
          if (seat.id === caster.id) return spendManaSources({ ...seat, life: seat.life + opponentIds.length }, [manaSource.id]);
          if (opponentIds.includes(seat.id)) return { ...seat, life: Math.max(0, seat.life - 1) };
          return seat;
        }),
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: caster.id,
            message: `${caster.name} extorts with ${extortSource.name}: each opponent loses 1 life, ${caster.name} gains ${opponentIds.length}.`,
            detail: "Rules action"
          },
          ...current.events
        ]
      }));
    }

    if (isHistoricCard(sourceCard)) {
      const historicTriggerSources = caster.board.battlefield.filter((card) => /whenever you cast a historic spell,\s*draw a card/i.test(card.oracleText));
      for (const source of historicTriggerSources) {
        setSession((current) => drawForSeat(current, caster.id, `${source.name} triggers: ${caster.name} draws a card from casting the historic spell ${sourceCard.name}.`));
      }
    }
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

  // Single entry point for the "Cast from Exile" buttons (CardInspector, the exile pile viewer):
  // playCard() bails out silently whenever something is already on the stack awaiting responses
  // (main-phase casting only), which used to make those buttons a dead click during a response
  // window. Route through respondWithCard instead whenever one is open.
  // The Cast button in the graveyard pile viewer (flashback, Gravecrawler, a Zul Ashur grant).
  function activateGraveyardAbility(seatId: string, cardId: string) {
    if (humanActionBlockedByChoice(seatId)) return;
    const result = activateGraveyardReturnInSession(session, seatId, cardId);
    if (!result.ok) {
      addEvent(result.message, seatId, "Timing");
      return;
    }
    setSession(() => result.session);
  }

  function castFromGraveyard(seatId: string, cardId: string) {
    playCard(seatId, cardId, undefined, "graveyard");
  }

  function castFromExile(seatId: string, cardId: string) {
    if (pendingAction) {
      respondWithCard(cardId, "exile");
      return;
    }
    // An Adventure/Omen-shaped card in exile can only be cast as its permanent face from here on
    // (see legalMainPhaseActions' matching exile-loop comment) — playCard needs that face's index
    // explicitly, since without one it falls back to the stale combined card for cost/effect
    // purposes instead of the specific face this button actually means to cast.
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.exile?.find((item) => item.id === cardId);
    const spellFaces = card ? independentlyCastableSpellFaces(card) : undefined;
    const permanentFaceIndex = spellFaces?.findIndex((face) => !face.typeLine.includes("Adventure") && !face.typeLine.includes("Omen"));
    playCard(seatId, cardId, undefined, "exile", permanentFaceIndex !== undefined && permanentFaceIndex >= 0 ? permanentFaceIndex : undefined);
  }

  function resolvePendingTrigger() {
    if (!pendingAction || pendingAction.type !== "trigger" || prioritySeatId !== pendingAction.controllerSeatId) return;
    const trigger = pendingAction;
    setPendingAction(undefined);
    setPriorityPasses([]);
    const remainingStack = removeStackAction(trigger.id);
    beginTriggerResolution(trigger, remainingStack);
  }

  // Single entry point for actually resolving a trigger once it's off the priority stack — gates
  // on effect.optional (a "you may" clause) by asking the controller first (a real prompt for a
  // human, a deterministic accept-by-default heuristic for an agent — see resolveAgentRuleChoice)
  // instead of always doing it. Mandatory effects skip straight to finishTriggerResolution.
  function beginTriggerResolution(trigger: Extract<PendingAction, { type: "trigger" }>, remainingStack: PendingAction[]) {
    if (trigger.effect.optional) {
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "optional_trigger",
        controllerSeatId: trigger.controllerSeatId,
        sourceCardId: trigger.sourceCardId,
        sourceCardName: trigger.sourceCardName,
        prompt: `${trigger.message} Do you want to?`,
        trigger,
        remainingStack
      });
      return;
    }
    finishTriggerResolution(trigger, remainingStack, true);
  }

  // Human-controlled triggers that need a real decision: opens the prompt and returns true (the trigger resolves when they answer), or
  // returns false to let the normal automatic resolution run (agents, or nothing to choose between).
  function openTriggerOptionPrompt(trigger: Extract<PendingAction, { type: "trigger" }>, remainingStack: PendingAction[], queueing?: Array<Extract<PendingAction, { type: "trigger" }>>): boolean {
    const controller = session.seats.find((seat) => seat.id === trigger.controllerSeatId);
    if (!controller || controller.kind !== "human" || trigger.effect.chosenOption !== undefined) return false;
    const open = (prompt: string, options: Array<{ index: number; label: string; cardId?: string }>) => {
      setPendingRuleChoice({ id: crypto.randomUUID(), kind: "choose_trigger_option", controllerSeatId: controller.id, sourceCardId: trigger.sourceCardId, sourceCardName: trigger.sourceCardName, prompt, options, trigger, remainingStack, queueing });
      return true;
    };
    // Ghalta / Wrenn and Seven: pick the cards to put onto the battlefield one at a time, "Done" ends it.
    if (trigger.effect.kind === "put_any_from_hand") {
      const effect = trigger.effect;
      const picked = effect.pickedIds ?? [];
      const remaining = controller.board.hand.filter((card) => !picked.includes(card.id) && (effect.filter === "permanent" ? !/Instant|Sorcery/.test(card.typeLine) : card.typeLine.includes(effect.filter.charAt(0).toUpperCase() + effect.filter.slice(1))));
      if (remaining.length === 0) return false;
      return open(
        `${trigger.sourceCardName}: put which ${effect.filter} cards from your hand onto the battlefield? (${picked.length} chosen)`,
        [...remaining.map((card, index) => ({ index, label: `${card.name}${card.power !== undefined ? ` (${card.power}/${card.toughness})` : ""}`, cardId: card.id })), { index: MODAL_DONE_INDEX, label: picked.length > 0 ? "Done" : "Put none" }]
      );
    }
    // "Choose two / one or more / any number": one mode per prompt, a Done button once enough are picked.
    if (trigger.effect.kind === "modal" && trigger.effect.modal.chooseCount > 1) {
      const modal = trigger.effect.modal;
      const picked = trigger.effect.pickedModes ?? [];
      const viable = modal.modes
        .map((mode, index) => ({ mode, index }))
        .filter(({ mode, index }) => !picked.includes(index) && genericModalModeHasLegalTarget(session, controller.id, mode));
      if (picked.length + viable.length <= (modal.atMost ? 1 : modal.chooseCount) && !modal.atMost) return false;
      if (viable.length === 0 || (picked.length === 0 && viable.length < 2)) return false;
      const options = viable.map(({ mode, index }) => ({ index, label: mode.text ?? `Mode ${index + 1}` }));
      if (picked.length >= 1 && modal.atMost) options.push({ index: MODAL_DONE_INDEX, label: "Done choosing" });
      return open(`${trigger.sourceCardName}: choose ${modal.atMost ? "modes (" + (picked.length > 0 ? picked.length + " chosen" : "one or more") + ")" : "mode " + (picked.length + 1) + " of " + modal.chooseCount}.`, options);
    }
    if (trigger.effect.kind === "modal" && trigger.effect.modal.chooseCount === 1) {
      const modal = trigger.effect.modal;
      const source = session.seats.flatMap((seat) => seat.board.battlefield).find((card) => card.id === trigger.sourceCardId);
      const options = modal.modes
        .map((mode, index) => ({ mode, index }))
        .filter(({ mode, index }) => genericModalModeHasLegalTarget(session, controller.id, mode) && !(modal.distinctPerTurn && session.onceEachTurnEffectsUsed?.includes(`${session.turn}:${source?.id ?? trigger.sourceCardId}:mode:${index}`)))
        .map(({ mode, index }) => ({ index, label: mode.text ?? `Mode ${index + 1}` }));
      if (options.length >= 2) return open(`${trigger.sourceCardName}: choose one.`, options);
      return false;
    }
    // Emeria Shepherd: a Plains lets you choose the battlefield instead of the hand, asked before the card itself.
    if (trigger.effect.kind === "landfall_return_nonland_permanent" && trigger.effect.plainsToBattlefield && trigger.effect.toHand === undefined) {
      const entered = session.seats.flatMap((seat) => seat.board.battlefield).find((card) => card.id === trigger.contextCardId);
      if (entered?.typeLine.includes("Plains") && controller.board.graveyard?.some((card) => !isLandCard(card) && /Creature|Artifact|Enchantment|Planeswalker|Battle/.test(card.typeLine))) {
        return open(`${trigger.sourceCardName}: return the card to the battlefield instead of your hand?`, [{ index: 0, label: "Battlefield (the land is a Plains)" }, { index: 1, label: "Hand" }]);
      }
    }
    const cardPrompt = triggerCardPrompt(trigger, controller);
    if (cardPrompt && cardPrompt.cards.length >= 2) {
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_trigger_card",
        controllerSeatId: controller.id,
        sourceCardId: trigger.sourceCardId,
        sourceCardName: trigger.sourceCardName,
        prompt: cardPrompt.prompt,
        zone: cardPrompt.zone,
        cards: cardPrompt.cards,
        picksNeeded: cardPrompt.picksNeeded,
        picked: [],
        trigger,
        remainingStack,
        queueing
      });
      return true;
    }
    if (trigger.effect.kind === "dragon_from_hand_attacking") {
      const word = trigger.effect.subtype.toLowerCase();
      const candidates = controller.board.hand.filter((card) => card.typeLine.includes("Creature") && card.typeLine.toLowerCase().includes(word));
      if (candidates.length === 0) return false;
      return open(
        `${trigger.sourceCardName}: put a ${trigger.effect.subtype} creature card from your hand onto the battlefield tapped and attacking?`,
        [...candidates.map((card, index) => ({ index, label: `${card.name} (${card.power ?? "?"}/${card.toughness ?? "?"})` })), { index: candidates.length, label: "No thanks" }]
      );
    }
    if (trigger.effect.kind === "rotate_control") {
      return open(`${trigger.sourceCardName}: choose a direction. Each player gains control of the nonland permanents of the next player that way.`, [{ index: 0, label: "Left" }, { index: 1, label: "Right" }]);
    }
    if (trigger.effect.kind === "discard_any_then_draw") {
      if (controller.board.hand.length === 0) return false;
      return open(`${trigger.sourceCardName}: discard which cards? You draw that many.`, discardOptions(controller, []));
    }
    if (trigger.effect.kind === "choose_named_mode") {
      const names = trigger.effect.options;
      return open(trigger.sourceCardName + ": choose " + names.join(" or ") + ".", names.map((label, index) => ({ index, label })));
    }
    if (trigger.effect.kind === "hideaway") {
      const top = (controller.library ?? []).slice(0, trigger.effect.count);
      if (top.length < 2) return false;
      return open(`${trigger.sourceCardName}: you look at the top ${top.length} cards. Choose one to exile face down; the rest go to the bottom.`, top.map((card, index) => ({ index, label: `${card.name} (${card.typeLine}, mana value ${card.manaValue})` })));
    }
    if (trigger.effect.kind === "pay_red_for_damage") {
      let max = 0;
      for (let count = 12; count >= 1; count -= 1) {
        if (chooseManaSourcesForCost(controller, genericManaAbilityCostShim({ costManaText: "{R}".repeat(count) }), count, undefined, session.seats).ok) {
          max = count;
          break;
        }
      }
      if (max === 0) return false;
      return open(`${trigger.sourceCardName}: pay how much {R}? It deals that much damage to a target.`, Array.from({ length: max + 1 }, (_, count) => ({ index: count, label: count === 0 ? "Don't pay" : "{R} x" + count + " — " + count + " damage" })));
    }
    // One-verb effects on a player (Blood Artist's drain): the human chooses who.
    if (trigger.effect.kind === "targeted_effect" && trigger.effect.effect.who.kind === "player") {
      const targeted = trigger.effect.effect;
      const players = legalTargets(session, controller.id, targetedEffectSpec(targeted, trigger.sourceCardId, trigger.sourceCardName), findPermanentById(session, trigger.sourceCardId) ?? ({ id: trigger.sourceCardId, name: trigger.sourceCardName, typeLine: "", oracleText: "", manaValue: 0, colors: [], role: "effect", zone: "battlefield" } as VisibleCard)).filter((entry) => entry.kind === "player");
      if (players.length >= 2) return open(`${trigger.sourceCardName}: choose a player.`, players.map((entry, index) => ({ index, label: `${session.seats.find((seat) => seat.id === entry.seatId)?.name ?? entry.seatId}${entry.seatId === controller.id ? " (you)" : ""} — ${session.seats.find((seat) => seat.id === entry.seatId)?.life ?? 0} life` })));
    }
    // The Undercity's Trap! (a player loses 5 life) and Arena (goad a creature): the human aims them.
    if (trigger.effect.kind === "venture_room" && (trigger.effect.room === "trap" || trigger.effect.room === "arena")) {
      const slot = trigger.effect.room === "trap" ? "player" : "opponent_creature";
      const aimSource = { id: trigger.sourceCardId, name: trigger.sourceCardName, typeLine: "", oracleText: "", manaValue: 0, colors: [], role: "effect", zone: "battlefield" } as VisibleCard;
      const aimOptions = labeledTargetOptions(session, controller.id, slot, aimSource);
      if (aimOptions.length >= 2) return open(trigger.sourceCardName + ": choose a " + (slot === "player" ? "player" : "creature") + ".", aimOptions.map((option, index) => ({ index, label: option.label })));
    }
    // "You may put a land card from your hand onto the battlefield" (Archaeomancer's Map): the human picks which land.
    if (trigger.effect.kind === "put_land_from_hand") {
      const lands = controller.board.hand.filter((card) => card.typeLine.includes("Land"));
      if (lands.length >= 2) return open(`${trigger.sourceCardName}: choose a land card from your hand to put onto the battlefield.`, lands.map((card, index) => ({ index, label: card.name })));
    }
    // "Deals N damage to any target" triggers: the human aims the damage.
    if (trigger.effect.kind === "damage_effect" || trigger.effect.kind === "context_power_damage") {
      const aiming = triggerDamageAiming(session, trigger, controller.id);
      if (aiming && aiming.options.length >= 2) return open(`${trigger.sourceCardName}: choose a target for ${aiming.effect.kind === "damage" ? (aiming.effect.amount === "X" ? (aiming.effect.xDefinition ? resolveDynamicAmount(session, controller.id, aiming.effect.xDefinition) : "X") : aiming.effect.amount) : ""} damage.`, aiming.options.map((option, index) => ({ index, label: option.label })));
    }
    // God-Eternal Bontu: "sacrifice any number of other permanents, then draw that many cards" — the human picks which ones, one at a time.
    if (trigger.effect.kind === "sacrifice_surplus_then_draw") {
      if (controller.board.battlefield.filter((card) => card.id !== trigger.sourceCardId).length === 0) return false;
      return open(`${trigger.sourceCardName}: sacrifice which other permanents? You draw that many cards.`, sacrificeOptions(controller, trigger.sourceCardId, []));
    }
    return false;
  }

  // Which cards a human-controlled trigger asks them to pick, and from where. Undefined for triggers that need no card choice.
  function triggerCardPrompt(trigger: Extract<PendingAction, { type: "trigger" }>, controller: PlayerSeat): { prompt: string; zone: "battlefield" | "graveyard"; cards: Array<{ seatId: string; cardId: string }>; picksNeeded: number } | undefined {
    const ownCreatures = controller.board.battlefield.filter((card) => card.typeLine.includes("Creature")).map((card) => ({ seatId: controller.id, cardId: card.id }));
    const ownGraveyardCreatures = (controller.board.graveyard ?? []).filter((card) => card.typeLine.includes("Creature") && card.id !== trigger.sourceCardId).map((card) => ({ seatId: controller.id, cardId: card.id }));
    switch (trigger.effect.kind) {
      case "target_creature_gains_keyword":
        return { prompt: `${trigger.sourceCardName}: choose a creature you control to gain ${trigger.effect.keywords.join(" and ")} until end of turn.`, zone: "battlefield", cards: ownCreatures, picksNeeded: 1 };
      // Eternal Taskmaster: "pay {2}{B}. If you do, return target creature card from your graveyard to your hand": the human picks the card.
      case "pay_then_zone": {
        const zoneSpec = zoneEffectTargetSpec(trigger.effect.zoneEffect);
        const sourceForTargets = session.seats.flatMap((seat) => seat.board.battlefield).find((card) => card.id === trigger.sourceCardId);
        if (!zoneSpec || !sourceForTargets) return undefined;
        return {
          prompt: `${trigger.sourceCardName}: choose the card to return.`,
          zone: "graveyard",
          cards: legalTargets(session, controller.id, zoneSpec, sourceForTargets).filter((target): target is Extract<ReturnType<typeof legalTargets>[number], { kind: "card" }> => target.kind === "card").map((target) => ({ seatId: target.seatId, cardId: target.card.id })),
          picksNeeded: 1
        };
      }
      // One-verb effects on a chosen permanent (Wizard Class's counter, Heliod's counter, ...): the human picks it.
      case "targeted_effect": {
        const targeted = trigger.effect.effect;
        if (targeted.who.kind !== "permanent") return undefined;
        const aimSource = findPermanentById(session, trigger.sourceCardId) ?? ({ id: trigger.sourceCardId, name: trigger.sourceCardName, typeLine: "", oracleText: "", manaValue: 0, colors: [], role: "effect", zone: "battlefield" } as VisibleCard);
        const entries = legalTargets(session, controller.id, targetedEffectSpec(targeted, aimSource.id, trigger.sourceCardName), aimSource).filter((entry): entry is Extract<ReturnType<typeof legalTargets>[number], { kind: "card" }> => entry.kind === "card");
        return { prompt: `${trigger.sourceCardName}: choose a target.`, zone: "battlefield", cards: entries.map((entry) => ({ seatId: entry.seatId, cardId: entry.card.id })), picksNeeded: 1 };
      }
      // The Undercity's Forge: two +1/+1 counters on a creature you control.
      case "venture_room":
        if (trigger.effect.room !== "forge") return undefined;
        return { prompt: "Forge: choose a creature to put two +1/+1 counters on.", zone: "battlefield", cards: ownCreatures, picksNeeded: 1 };
      // "Put a +1/+1 counter on target creature (you control)": the human picks it.
      case "add_counter": {
        const counterEffect = trigger.effect;
        if (counterEffect.scope !== "target_creature" && counterEffect.scope !== "target_creature_you_control") return undefined;
        return {
          prompt: `${trigger.sourceCardName}: choose a creature to put ${counterEffect.amount === 1 ? "a" : counterEffect.amount} ${counterEffect.counterKind} counter${counterEffect.amount === 1 ? "" : "s"} on.`,
          zone: "battlefield",
          cards: session.seats
            .filter((seat) => !seat.hasLost && (counterEffect.scope !== "target_creature_you_control" || seat.id === controller.id))
            .flatMap((seat) => seat.board.battlefield.filter((card) => card.typeLine.includes("Creature") && (seat.id === controller.id || (!hasShroud(card) && !hasHexproof(card)))).map((card) => ({ seatId: seat.id, cardId: card.id }))),
          picksNeeded: 1
        };
      }
      case "exile_up_to_artifacts_enchantments":
        return {
          prompt: `${trigger.sourceCardName}: choose up to ${trigger.effect.count} artifacts and/or enchantments to exile.`,
          zone: "battlefield",
          cards: session.seats
            .filter((seat) => seat.id !== controller.id && !seat.hasLost)
            .flatMap((seat) => seat.board.battlefield.filter((card) => (card.typeLine.includes("Artifact") || card.typeLine.includes("Enchantment")) && !hasShroud(card) && !hasHexproof(card)).map((card) => ({ seatId: seat.id, cardId: card.id }))),
          picksNeeded: trigger.effect.count
        };
      case "exile_until_leaves_each_opponent":
        return {
          prompt: `${trigger.sourceCardName}: choose up to one nonland permanent per opponent to exile until it leaves.`,
          zone: "battlefield",
          cards: session.seats
            .filter((seat) => seat.id !== controller.id && !seat.hasLost)
            .flatMap((seat) => seat.board.battlefield.filter((card) => !isLandCard(card) && !hasShroud(card) && !hasHexproof(card)).map((card) => ({ seatId: seat.id, cardId: card.id }))),
          picksNeeded: session.seats.filter((seat) => seat.id !== controller.id && !seat.hasLost).length
        };
      case "pump_target_creature":
        return { prompt: `${trigger.sourceCardName}: choose a creature you control to get the bonus.`, zone: "battlefield", cards: ownCreatures, picksNeeded: 1 };
      case "double_power_counters":
        return { prompt: `${trigger.sourceCardName}: choose a creature to put counters on equal to its power.`, zone: "battlefield", cards: ownCreatures, picksNeeded: 1 };
      case "counters_on_up_to_creatures":
        return { prompt: `${trigger.sourceCardName}: choose up to ${trigger.effect.count} creatures to put a ${trigger.effect.counterKind} counter on.`, zone: "battlefield", cards: ownCreatures, picksNeeded: trigger.effect.count };
      case "gift_destroy_artifact_or_enchantment":
        return {
          prompt: `${trigger.sourceCardName}: choose an artifact or enchantment an opponent controls to destroy.`,
          zone: "battlefield",
          cards: session.seats
            .filter((seat) => seat.id !== controller.id && !seat.hasLost)
            .flatMap((seat) => seat.board.battlefield.filter((card) => card.typeLine.includes("Artifact") || card.typeLine.includes("Enchantment")).map((card) => ({ seatId: seat.id, cardId: card.id }))),
          picksNeeded: 1
        };
      case "graveyard_creature_to_library_top":
        return { prompt: `${trigger.sourceCardName}: choose a creature card in your graveyard to put on top of your library.`, zone: "graveyard", cards: ownGraveyardCreatures, picksNeeded: 1 };
      case "landfall_return_nonland_permanent":
        return {
          prompt: `${trigger.sourceCardName}: choose a nonland permanent card in your graveyard to return.`,
          zone: "graveyard",
          cards: (controller.board.graveyard ?? []).filter((card) => !isLandCard(card) && /Creature|Artifact|Enchantment|Planeswalker|Battle/.test(card.typeLine)).map((card) => ({ seatId: controller.id, cardId: card.id })),
          picksNeeded: 1
        };
      case "aura_reanimate":
        return {
          prompt: `${trigger.sourceCardName}: choose a creature card in a graveyard to return to the battlefield under your control.`,
          zone: "graveyard",
          cards: session.seats.flatMap((other) => (other.board.graveyard ?? []).filter((card) => card.typeLine.includes("Creature")).map((card) => ({ seatId: other.id, cardId: card.id }))),
          picksNeeded: 1
        };
      case "exile_self_return_creature_to_hand":
        return { prompt: `${trigger.sourceCardName}: choose a creature card in your graveyard to return to your hand.`, zone: "graveyard", cards: ownGraveyardCreatures, picksNeeded: 1 };
      // Memnarch / Deathbringer Liege / Soul-Guide Lantern: the target is named when the ability goes on the stack, not at resolution.
      case "become_artifact_target":
        return {
          prompt: `${trigger.sourceCardName}: choose a permanent to become an artifact.`,
          zone: "battlefield",
          cards: session.seats.flatMap((seat) => seat.board.battlefield.filter((card) => !hasCardType(card, "Artifact") && !card.phasedOut && (seat.id === controller.id || (!hasShroud(card) && !hasHexproof(card)))).map((card) => ({ seatId: seat.id, cardId: card.id }))),
          picksNeeded: 1
        };
      case "gain_control_target_artifact":
        return {
          prompt: `${trigger.sourceCardName}: choose an artifact to gain control of.`,
          zone: "battlefield",
          cards: session.seats.filter((seat) => seat.id !== controller.id).flatMap((seat) => seat.board.battlefield.filter((card) => hasCardType(card, "Artifact") && !card.phasedOut && !hasShroud(card) && !hasHexproof(card)).map((card) => ({ seatId: seat.id, cardId: card.id }))),
          picksNeeded: 1
        };
      case "destroy_tapped_creature":
        return {
          prompt: `${trigger.sourceCardName}: choose a tapped creature to destroy.`,
          zone: "battlefield",
          cards: session.seats.flatMap((seat) => seat.board.battlefield.filter((card) => card.tapped && card.typeLine.includes("Creature") && !card.phasedOut && (seat.id === controller.id || (!hasShroud(card) && !hasHexproof(card)))).map((card) => ({ seatId: seat.id, cardId: card.id }))),
          picksNeeded: 1
        };
      case "exile_card_from_graveyard":
        return { prompt: `${trigger.sourceCardName}: choose a card in a graveyard to exile.`, zone: "graveyard", cards: session.seats.flatMap((seat) => (seat.board.graveyard ?? []).map((card) => ({ seatId: seat.id, cardId: card.id }))), picksNeeded: 1 };
      default:
        return undefined;
    }
  }

  // One click of a trigger's card pick (battlefield or graveyard); reopens for the next pick of an "up to N", otherwise resolves.
  function completeTriggerCard(cardId: string) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_trigger_card") return;
    const picked = [...choice.picked, cardId];
    const pickedEntry = choice.cards.find((entry) => entry.cardId === cardId);
    const remaining = choice.cards.filter((entry) => !picked.includes(entry.cardId) && !(choice.trigger.effect.kind === "exile_until_leaves_each_opponent" && entry.seatId === pickedEntry?.seatId));
    if (picked.length < choice.picksNeeded && remaining.length > 0) {
      setPendingRuleChoice({ ...choice, id: crypto.randomUUID(), picked, cards: remaining, prompt: `${choice.trigger.sourceCardName}: choose another (${picked.length} of up to ${choice.picksNeeded} chosen).` });
      return;
    }
    setPendingRuleChoice(undefined);
    const chosen = { ...choice.trigger, effect: { ...choice.trigger.effect, chosenOption: picked.join(",") } } as Extract<PendingAction, { type: "trigger" }>;
    if (choice.queueing) {
      queueCommonTriggers(choice.queueing.map((queued) => (queued.id === choice.trigger.id ? chosen : queued)));
      return;
    }
    setSession((current) => resolveTriggerEffect(current, chosen));
    resumeAfterTriggerChoice(choice.trigger, choice.remainingStack);
  }

  function completeTriggerOption(index: number) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_trigger_option") return;
    setPendingRuleChoice(undefined);
    // Leyline Tyrant: pay the chosen red now, then pick what the damage hits.
    if (choice.trigger.effect.kind === "pay_red_for_damage") {
      const paid = index > 0 ? payRedMana(session, choice.controllerSeatId, index) : undefined;
      if (paid) {
        const source = { id: choice.sourceCardId, name: choice.sourceCardName, typeLine: "", oracleText: "", colors: ["R"], manaValue: 0, role: "permanent", zone: "graveyard" } as VisibleCard;
        const options = labeledTargetOptions(paid.session, choice.controllerSeatId, "any_damage", source);
        const damage: RemovalEffect = { kind: "damage", amount: paid.count, targetType: "any" };
        setSession(() => paid.session);
        if (options.length >= 2) {
          setPendingRuleChoice({
            id: crypto.randomUUID(),
            kind: "choose_labeled_target",
            controllerSeatId: choice.controllerSeatId,
            sourceCardId: choice.sourceCardId,
            sourceCardName: choice.sourceCardName,
            sourceCard: source,
            slots: [{ prompt: choice.sourceCardName + ": choose a target for " + paid.count + " damage.", options }],
            slotIndex: 0,
            picks: [],
            continuation: { kind: "damage", effect: damage }
          });
        } else {
          setSession(() => applyRemovalEffect(paid.session, choice.controllerSeatId, choice.sourceCardName, source, damage));
        }
      }
      resumeAfterTriggerChoice(choice.trigger, choice.remainingStack);
      return;
    }
    // Undercity branch: enter the chosen room.
    if (choice.trigger.effect.kind === "venture_choice") {
      const room = choice.trigger.effect.options[index];
      if (isUndercityRoom(room)) setSession((current) => enterUndercityRoom(current, choice.controllerSeatId, room));
      return;
    }
    // Punisher: the victim's pick, then the next repetition.
    if (choice.trigger.effect.kind === "punisher_prompt") {
      const { lifeAmount, remaining } = choice.trigger.effect;
      const victimId = choice.controllerSeatId;
      const sourceName = choice.sourceCardName;
      if (index === 0) {
        setSession((current) => rulesEvent({ ...current, seats: current.seats.map((seat) => (seat.id === victimId ? { ...seat, life: Math.max(0, seat.life - lifeAmount) } : seat)) }, victimId, `${current.seats.find((seat) => seat.id === victimId)?.name ?? "Player"} loses ${lifeAmount} life to ${sourceName}.`));
      } else if (index === 1) {
        setSession((current) => ({ ...current, pendingSacrificeChoices: [...(current.pendingSacrificeChoices ?? []), { seatId: victimId, sourceCardId: "punisher", sourceCardName: sourceName, count: 1, typeFilter: "nonland permanent" }] }));
      } else {
        setSession((current) => ({ ...current, pendingDiscardChoices: [...(current.pendingDiscardChoices ?? []), { seatId: victimId, count: 1, sourceName }] }));
      }
      if (remaining > 1) window.setTimeout(() => setSession((current) => ({ ...current, pendingPunisherChoices: [...(current.pendingPunisherChoices ?? []), { seatId: victimId, sourceName, lifeAmount, times: remaining - 1 }] })), 300);
      return;
    }
    // Put any number of cards from hand onto the battlefield: each click adds a card; Done resolves.
    if (choice.trigger.effect.kind === "put_any_from_hand") {
      const effect = choice.trigger.effect;
      const picked = effect.pickedIds ?? [];
      const controller = session.seats.find((seat) => seat.id === choice.controllerSeatId);
      const remaining = (controller?.board.hand ?? []).filter((card) => !picked.includes(card.id) && (effect.filter === "permanent" ? !/Instant|Sorcery/.test(card.typeLine) : card.typeLine.includes(effect.filter.charAt(0).toUpperCase() + effect.filter.slice(1))));
      const added = index === MODAL_DONE_INDEX ? undefined : remaining[index];
      const nextPicked = added ? [...picked, added.id] : picked;
      if (added && remaining.length > 1) {
        const nextTrigger = { ...choice.trigger, effect: { ...effect, pickedIds: nextPicked } } as Extract<PendingAction, { type: "trigger" }>;
        const queueing = choice.queueing?.map((queued) => (queued.id === choice.trigger.id ? nextTrigger : queued));
        if (openTriggerOptionPrompt(nextTrigger, choice.remainingStack, queueing)) return;
      }
      const finished = { ...choice.trigger, effect: { ...effect, pickedIds: nextPicked, chosenOption: nextPicked.join(",") } } as Extract<PendingAction, { type: "trigger" }>;
      if (choice.queueing) {
        queueCommonTriggers(choice.queueing.map((queued) => (queued.id === choice.trigger.id ? finished : queued)));
        return;
      }
      setSession((current) => resolveTriggerEffect(current, finished));
      resumeAfterTriggerChoice(choice.trigger, choice.remainingStack);
      return;
    }
    // Choose-several modal trigger: each click adds a mode; the last pick (or Done) resolves it.
    if (choice.trigger.effect.kind === "modal" && choice.trigger.effect.modal.chooseCount > 1) {
      const effect = choice.trigger.effect;
      const picked = index === MODAL_DONE_INDEX ? effect.pickedModes ?? [] : [...(effect.pickedModes ?? []), index];
      const moreViable = effect.modal.modes.some((mode, modeIndex) => !picked.includes(modeIndex) && genericModalModeHasLegalTarget(session, choice.controllerSeatId, mode));
      if (index !== MODAL_DONE_INDEX && picked.length < effect.modal.chooseCount && moreViable) {
        const nextTrigger = { ...choice.trigger, effect: { ...effect, pickedModes: picked } } as Extract<PendingAction, { type: "trigger" }>;
        const queueing = choice.queueing?.map((queued) => (queued.id === choice.trigger.id ? nextTrigger : queued));
        if (openTriggerOptionPrompt(nextTrigger, choice.remainingStack, queueing)) return;
      }
      const finished = { ...choice.trigger, effect: { ...effect, pickedModes: picked, chosenOption: [...picked].sort((a, b) => a - b).join(",") } } as Extract<PendingAction, { type: "trigger" }>;
      if (choice.queueing) {
        queueCommonTriggers(choice.queueing.map((queued) => (queued.id === choice.trigger.id ? finished : queued)));
        return;
      }
      setSession((current) => resolveTriggerEffect(current, finished));
      resumeAfterTriggerChoice(choice.trigger, choice.remainingStack);
      return;
    }
    // Rishkar's Expertise: the picked hand card moves to exile with a free-cast permission and is cast right away; the last option declines.
    if (choice.trigger.effect.kind === "free_cast_choice") {
      const pickedId = choice.trigger.effect.cardIds[index];
      if (pickedId) {
        setSession((current) => markHandCardFreeCastable(current, choice.controllerSeatId, pickedId));
        window.setTimeout(() => playCard(choice.controllerSeatId, pickedId, undefined, "exile"), 100);
      }
      return;
    }
    // Discover: cast it free (it is in exile with the permission), or take it into hand.
    if (choice.trigger.effect.kind === "discover_choice") {
      if (index === 0) {
        window.setTimeout(() => playCard(choice.controllerSeatId, choice.sourceCardId, undefined, "exile"), 50);
      } else {
        setSession((current) => {
          const moved = moveCardAcrossSeats(current, choice.controllerSeatId, choice.sourceCardId, choice.controllerSeatId, "hand");
          return moved.session;
        });
      }
      return;
    }
    // Leylines: begin the game on the battlefield (or not), then ask about the next one.
    if (choice.trigger.effect.kind === "opening_hand_battlefield") {
      const rest = choice.trigger.effect.remainingIds;
      if (index === 0) setSession((current) => putOpeningHandCardOnBattlefield(current, choice.controllerSeatId, choice.sourceCardId));
      if (rest.length > 0) window.setTimeout(() => askOpeningHandBattlefield(choice.controllerSeatId, rest), 100);
      return;
    }
    // A creature that must attack: attack the chosen opponent.
    if (choice.trigger.effect.kind === "forced_attack") {
      const forced = choice.trigger.effect;
      const targetId = forced.targetIds[index];
      if (targetId) setSession((current) => declareAttack(current, choice.controllerSeatId, forced.cardId, targetId));
      return;
    }
    // Echo: pay or sacrifice, as chosen.
    if (choice.trigger.effect.kind === "echo_choice") {
      const costText = choice.trigger.effect.costText;
      setSession((current) => resolveEcho(current, choice.controllerSeatId, choice.sourceCardId, costText, index === 0 ? "pay" : "sacrifice"));
      return;
    }
    // Emeria Shepherd: remember battlefield-or-hand, then go on to pick the card.
    if (choice.trigger.effect.kind === "landfall_return_nonland_permanent" && choice.trigger.effect.toHand === undefined) {
      const updated = { ...choice.trigger, effect: { ...choice.trigger.effect, toHand: index === 1 } } as Extract<PendingAction, { type: "trigger" }>;
      const updatedQueue = choice.queueing?.map((queued) => (queued.id === choice.trigger.id ? updated : queued));
      if (openTriggerOptionPrompt(updated, choice.remainingStack, updatedQueue)) return;
      if (updatedQueue) {
        queueCommonTriggers(updatedQueue);
        return;
      }
      setSession((current) => resolveTriggerEffect(current, updated));
      resumeAfterTriggerChoice(choice.trigger, choice.remainingStack);
      return;
    }
    // Read ahead: start the Saga on the chosen chapter.
    if (choice.trigger.effect.kind === "read_ahead") {
      const saga = session.seats.find((seat) => seat.id === choice.controllerSeatId)?.board.battlefield.find((card) => card.id === choice.sourceCardId);
      const chapters = saga ? parseSagaChapters(saga.oracleText) : undefined;
      if (saga && chapters) setSession((current) => applySagaReadAhead(current, choice.controllerSeatId, saga, chapters, index + 1));
      resumeAfterTriggerChoice(choice.trigger, choice.remainingStack);
      return;
    }
    // Bontu: each click adds a permanent to sacrifice; the last option finishes.
    if (choice.trigger.effect.kind === "sacrifice_surplus_then_draw") {
      const effect = choice.trigger.effect;
      const owner = session.seats.find((seat) => seat.id === choice.controllerSeatId);
      const already = effect.sacrificeIds ?? [];
      const remaining = (owner?.board.battlefield ?? []).filter((card) => card.id !== choice.sourceCardId && !already.includes(card.id));
      const finish = (ids: string[]) => {
        const done = { ...choice.trigger, effect: { ...effect, sacrificeIds: ids, chosenOption: ids.join(",") } } as Extract<PendingAction, { type: "trigger" }>;
        if (choice.queueing) {
          queueCommonTriggers(choice.queueing.map((queued) => (queued.id === choice.trigger.id ? done : queued)));
          return;
        }
        setSession((current) => resolveTriggerEffect(current, done));
        resumeAfterTriggerChoice(choice.trigger, choice.remainingStack);
      };
      if (owner && index < remaining.length) {
        const picked = [...already, remaining[index].id];
        if (picked.length < owner.board.battlefield.filter((card) => card.id !== choice.sourceCardId).length) {
          const nextTrigger = { ...choice.trigger, effect: { ...effect, sacrificeIds: picked } } as Extract<PendingAction, { type: "trigger" }>;
          setPendingRuleChoice({
            ...choice,
            id: crypto.randomUUID(),
            trigger: nextTrigger,
            prompt: choice.sourceCardName + ": sacrifice which other permanents? (" + picked.length + " chosen)",
            options: sacrificeOptions(owner, choice.sourceCardId, picked),
            queueing: choice.queueing?.map((queued) => (queued.id === choice.trigger.id ? nextTrigger : queued))
          });
          return;
        }
        finish(picked);
        return;
      }
      finish(already);
      return;
    }
    // Discard any number: each click adds a card; the last option finishes.
    if (choice.trigger.effect.kind === "discard_any_then_draw") {
      const effect = choice.trigger.effect;
      const owner = session.seats.find((seat) => seat.id === choice.controllerSeatId);
      const already = effect.discardIds ?? [];
      const remaining = (owner?.board.hand ?? []).filter((card) => !already.includes(card.id));
      if (owner && index < remaining.length) {
        const picked = [...already, remaining[index].id];
        const nextTrigger = { ...choice.trigger, effect: { ...effect, discardIds: picked } } as Extract<PendingAction, { type: "trigger" }>;
        if (picked.length < Math.min(owner.board.hand.length, effect.max ?? Number.POSITIVE_INFINITY)) {
          setPendingRuleChoice({
            ...choice,
            id: crypto.randomUUID(),
            trigger: nextTrigger,
            prompt: choice.sourceCardName + ": discard which cards? (" + picked.length + " chosen" + (effect.max ? ", up to " + effect.max : "") + ") You draw that many.",
            options: discardOptions(owner, picked),
            queueing: choice.queueing?.map((queued) => (queued.id === choice.trigger.id ? nextTrigger : queued))
          });
          return;
        }
        const done = { ...nextTrigger, effect: { ...effect, discardIds: picked, chosenOption: picked.join(",") } } as Extract<PendingAction, { type: "trigger" }>;
        if (choice.queueing) {
          queueCommonTriggers(choice.queueing.map((queued) => (queued.id === choice.trigger.id ? done : queued)));
          return;
        }
        setSession((current) => resolveTriggerEffect(current, done));
        resumeAfterTriggerChoice(choice.trigger, choice.remainingStack);
        return;
      }
      const finished = { ...choice.trigger, effect: { ...effect, chosenOption: already.join(",") } } as Extract<PendingAction, { type: "trigger" }>;
      if (choice.queueing) {
        queueCommonTriggers(choice.queueing.map((queued) => (queued.id === choice.trigger.id ? finished : queued)));
        return;
      }
      setSession((current) => resolveTriggerEffect(current, finished));
      resumeAfterTriggerChoice(choice.trigger, choice.remainingStack);
      return;
    }
    // Aimed damage: remember WHAT was picked (not its position in a list that may have changed by resolution).
    let encodedOption: string | undefined;
    if (choice.trigger.effect.kind === "targeted_effect" && choice.trigger.effect.effect.who.kind === "player") {
      const targeted = choice.trigger.effect.effect;
      const pickSource = findPermanentById(session, choice.trigger.sourceCardId) ?? ({ id: choice.trigger.sourceCardId, name: choice.trigger.sourceCardName, typeLine: "", oracleText: "", manaValue: 0, colors: [], role: "effect", zone: "battlefield" } as VisibleCard);
      const players = legalTargets(session, choice.controllerSeatId, targetedEffectSpec(targeted, choice.trigger.sourceCardId, choice.trigger.sourceCardName), pickSource).filter((entry) => entry.kind === "player");
      if (players[index]) encodedOption = "p:" + players[index].seatId;
    }
    if (choice.trigger.effect.kind === "venture_room" && (choice.trigger.effect.room === "trap" || choice.trigger.effect.room === "arena")) {
      const slot = choice.trigger.effect.room === "trap" ? "player" : "opponent_creature";
      const aimSource = { id: choice.trigger.sourceCardId, name: choice.trigger.sourceCardName, typeLine: "", oracleText: "", manaValue: 0, colors: [], role: "effect", zone: "battlefield" } as VisibleCard;
      const picked = labeledTargetOptions(session, choice.controllerSeatId, slot, aimSource)[index]?.target;
      if (picked) encodedOption = picked.kind === "player" ? encodeChosenTarget(picked) : picked.cardId;
    }
    if (choice.trigger.effect.kind === "damage_effect" || choice.trigger.effect.kind === "context_power_damage") {
      const aiming = triggerDamageAiming(session, choice.trigger, choice.controllerSeatId);
      const picked = aiming?.options[index]?.target;
      if (picked) encodedOption = encodeChosenTarget(picked);
    }
    const chosen = { ...choice.trigger, effect: { ...choice.trigger.effect, chosenOption: encodedOption ?? String(index) } } as Extract<PendingAction, { type: "trigger" }>;
    if (choice.queueing) {
      queueCommonTriggers(choice.queueing.map((queued) => (queued.id === choice.trigger.id ? chosen : queued)));
      return;
    }
    setSession((current) => resolveTriggerEffect(current, chosen));
    resumeAfterTriggerChoice(choice.trigger, choice.remainingStack);
  }

  function finishTriggerResolution(trigger: Extract<PendingAction, { type: "trigger" }>, remainingStack: PendingAction[], accepted: boolean) {
    if (trigger.effect.kind === "deferred_ability") {
      // An activated ability resolves: its cost was paid when it was activated; this applies its effect.
      const resolve = abilityResolvers.current.get(trigger.effect.resolverId);
      abilityResolvers.current.delete(trigger.effect.resolverId);
      resolve?.();
    } else if (accepted && trigger.effect.kind === "draw_then_put_back") {
      // "Draw a card, then put a card from your hand on top of your library" (Aminatou, the
      // Fateshifter's +1, ...) needs a real choice of WHICH card goes back — resolveTriggerEffect
      // is a pure function with no access to pendingRuleChoice, so it used to always auto-pick the
      // highest-mana-value card for both agents and the human. The draw itself isn't a choice, so
      // that still happens immediately here; only the put-back half routes through pendingRuleChoice
      // (same mechanism as discard_to_hand_size: a real prompt for a human, a deterministic
      // highest-mana-value-first pick for an agent — see resolveAgentRuleChoice).
      const controllerSeat = session.seats.find((seat) => seat.id === trigger.controllerSeatId);
      const seatName = controllerSeat?.name ?? "Player";
      const { drawAmount, putBackAmount } = trigger.effect;
      // Computed synchronously against `session` here, NOT by writing into a captured variable from
      // inside the setSession updater (as this used to) — setSession's updater doesn't run
      // synchronously, so requiredCount was always computed against postDrawHandSize's untouched
      // initial value of 0, making `if (requiredCount > 0)` false every time and silently skipping
      // the put-back choice for every permanent-triggered draw_then_put_back (Aminatou, the
      // Fateshifter's +1, ...). Same fix already applied to applyRuleWorkflow's cast-spell copy of
      // this same logic (Brainstorm, Brainsurge, ...) — this trigger-based twin just hadn't gotten it.
      const drawnSession =
        drawAmount > 0
          ? drawMultipleForSeat(session, trigger.controllerSeatId, drawAmount, `${seatName} draws ${drawAmount} from ${trigger.sourceCardName}.`)
          : session;
      const postDrawHandSize = drawnSession.seats.find((seat) => seat.id === trigger.controllerSeatId)?.board.hand.length ?? 0;
      checkMiracleAfterDraw(session, drawnSession);
      setSession(() => drawnSession);
      const requiredCount = Math.min(putBackAmount, postDrawHandSize);
      if (requiredCount > 0) {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "put_cards_on_library",
          controllerSeatId: trigger.controllerSeatId,
          sourceCardId: trigger.sourceCardId,
          sourceCardName: trigger.sourceCardName,
          prompt: `${seatName} must put ${requiredCount} card${requiredCount === 1 ? "" : "s"} from hand on top of their library.`,
          requiredCount,
          trigger,
          remainingStack
        });
        return;
      }
    } else if (accepted && trigger.effect.kind === "venture_room" && session.seats.find((seat) => seat.id === trigger.controllerSeatId)?.kind === "human" && ["secret_entrance", "lost_well", "throne"].includes(trigger.effect.room)) {
      // Rooms that look at the library: the human searches, scries or picks the creature themselves.
      const roomOwner = session.seats.find((seat) => seat.id === trigger.controllerSeatId)!;
      const room = trigger.effect.room;
      if (room === "secret_entrance") {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_card_from_library",
          controllerSeatId: roomOwner.id,
          sourceCardId: trigger.sourceCardId,
          sourceCardName: trigger.sourceCardName,
          prompt: "Secret Entrance: search your library for a basic land card.",
          destination: "hand",
          maxChoices: 1,
          allowedCardFilter: "basic land"
        });
      } else if (room === "lost_well") {
        startLibraryLook("scry", 2);
      } else {
        const top = (roomOwner.library ?? []).slice(0, 10);
        const candidates = top.filter((card) => card.typeLine.includes("Creature"));
        if (candidates.length === 0) {
          setSession((current) => resolveTriggerEffect(current, trigger));
        } else {
          setPendingRuleChoice({
            id: crypto.randomUUID(),
            kind: "choose_dig_card",
            controllerSeatId: roomOwner.id,
            sourceCardId: trigger.sourceCardId,
            sourceCardName: trigger.sourceCardName,
            prompt: "Throne of the Dead Three: put a creature from the top ten onto the battlefield with three +1/+1 counters and hexproof?",
            count: 10,
            typeWord: "creature",
            toBattlefieldMaxManaValue: 999,
            throneBonus: true,
            options: [...candidates.map((card, index) => ({ index, label: card.name + " (mana value " + card.manaValue + ")", cardId: card.id })), { index: candidates.length, label: "Take nothing", cardId: "none" }]
          });
        }
      }
      resumeAfterTriggerChoice(trigger, remainingStack);
      return;
    } else if (accepted && trigger.effect.kind === "proliferate" && session.seats.find((seat) => seat.id === trigger.controllerSeatId)?.kind === "human") {
      // Proliferate (Norn's Choirmaster): the human chooses which permanents and players get another counter.
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_proliferate_targets",
        controllerSeatId: trigger.controllerSeatId,
        sourceCardId: trigger.sourceCardId,
        sourceCardName: trigger.sourceCardName,
        prompt: `${trigger.sourceCardName}: choose any number of permanents and/or players to proliferate.`
      });
      resumeAfterTriggerChoice(trigger, remainingStack);
      return;
    } else if (accepted && trigger.effect.kind === "search_library_put" && session.seats.find((seat) => seat.id === trigger.controllerSeatId)?.kind === "human") {
      // A human searches their own library themselves (the picker lists only cards that match the searched type); an agent's pick is made by
      // resolveSearchLibraryPut in the generic branch below. completeRuleChoice puts the card onto the battlefield and shuffles.
      const searchEffect = trigger.effect;
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_card_from_library",
        controllerSeatId: trigger.controllerSeatId,
        sourceCardId: trigger.sourceCardId,
        sourceCardName: trigger.sourceCardName,
        prompt: `${trigger.sourceCardName}: search your library for ${/^[aeiou]/.test(searchEffect.filter) ? "an" : "a"} ${searchEffect.filter} card and put it onto the battlefield${searchEffect.tapped ? " tapped" : ""}, then shuffle.`,
        destination: "battlefield",
        tapped: searchEffect.tapped,
        maxChoices: 1,
        allowedCardFilter: searchEffect.filter
      });
      resumeAfterTriggerChoice(trigger, remainingStack);
      return;
    } else if (accepted && openTriggerOptionPrompt(trigger, remainingStack)) {
      return;
    } else if (accepted && (trigger.effect.kind === "scry_cards" || trigger.effect.kind === "surveil_cards") && session.seats.find((seat) => seat.id === trigger.controllerSeatId)?.kind === "human") {
      // The human looks at the cards and decides, instead of the automatic keep-everything-good heuristic.
      const lookSeat = session.seats.find((seat) => seat.id === trigger.controllerSeatId)!;
      const isSurveil = trigger.effect.kind === "surveil_cards";
      startLibraryLook(isSurveil ? "surveil" : "scry", trigger.effect.amount + (isSurveil ? surveilBonusForSeat(lookSeat) : 0));
    } else if (accepted && trigger.effect.kind === "connive") {
      // "Draw a card, then discard a card" (Ledger Shredder, ...) needs a real choice of WHICH
      // card to discard — resolveTriggerEffect is a pure function with no access to
      // pendingRuleChoice, so it always auto-picked via chooseWorstHandCardToDiscard for both
      // agents AND the human, reported live as "Ledger Shredder ... not letting me choose a card
      // to discard." Same shape as draw_then_put_back just above: the draw itself isn't a choice,
      // so it happens immediately; only which card gets discarded (and therefore whether it's the
      // nonland that earns the +1/+1 counter) routes through pendingRuleChoice.
      startConniveIteration(trigger, remainingStack, trigger.effect.amount, session);
      return;
    } else if (accepted && trigger.effect.kind === "sacrifice_self_then_search" && session.seats.find((seat) => seat.id === trigger.controllerSeatId)?.kind === "human") {
      // The land is sacrificed first, then the search (a basic of the listed types, tapped) is the reflexive trigger's.
      const searchEffect = trigger.effect;
      const owner = session.seats.find((seat) => seat.id === trigger.controllerSeatId);
      const onBattlefield = owner?.board.battlefield.some((card) => card.id === trigger.sourceCardId);
      if (owner && onBattlefield) {
        setSession((current) => {
          const sacrificed = moveCardBetweenVisibleZones(current, trigger.controllerSeatId, trigger.sourceCardId, "graveyard");
          const gained = searchEffect.lifeGain > 0 ? { ...sacrificed, seats: sacrificed.seats.map((seat) => (seat.id === trigger.controllerSeatId ? { ...seat, life: seat.life + searchEffect.lifeGain } : seat)) } : sacrificed;
          return rulesEvent(gained, trigger.controllerSeatId, `${trigger.sourceCardName} is sacrificed${searchEffect.lifeGain > 0 ? ` and ${owner.name} gains ${searchEffect.lifeGain} life` : ""}.`);
        });
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_card_from_library",
          controllerSeatId: trigger.controllerSeatId,
          sourceCardId: trigger.sourceCardId,
          sourceCardName: trigger.sourceCardName,
          prompt: `${trigger.sourceCardName}: search your library for a basic ${searchEffect.filter} card and put it onto the battlefield tapped.`,
          destination: "battlefield",
          tapped: true,
          maxChoices: 1,
          allowedCardFilter: searchEffect.filter
        });
        return;
      }
    } else if (accepted && trigger.effect.kind === "draw_then_permanent") {
      // The draw happens now; WHICH permanent (or none) is the human's choice, asked with the hand as it is after the draw.
      const controllerSeat = session.seats.find((seat) => seat.id === trigger.controllerSeatId);
      if (controllerSeat?.kind === "human") {
        const drawnSession = drawMultipleForSeat(session, trigger.controllerSeatId, trigger.effect.amount, `${controllerSeat.name} draws ${trigger.effect.amount} from ${trigger.sourceCardName}.`);
        checkMiracleAfterDraw(session, drawnSession);
        setSession(() => drawnSession);
        const permanents = drawnSession.seats.find((seat) => seat.id === trigger.controllerSeatId)?.board.hand.filter((card) => !/Instant|Sorcery/.test(card.typeLine)) ?? [];
        if (permanents.length > 0) {
          const sourceCard = findPermanentById(drawnSession, trigger.sourceCardId) ?? ({ id: trigger.sourceCardId, name: trigger.sourceCardName, typeLine: "", oracleText: "", colors: [], manaValue: 0, role: "permanent", zone: "battlefield" } as VisibleCard);
          setPendingRuleChoice({
            id: crypto.randomUUID(),
            kind: "choose_trigger_option",
            controllerSeatId: trigger.controllerSeatId,
            sourceCardId: trigger.sourceCardId,
            sourceCardName: trigger.sourceCardName,
            prompt: `${trigger.sourceCardName}: put a permanent card from your hand onto the battlefield?`,
            options: [...permanents.map((card, index) => ({ index, label: card.name })), { index: permanents.length, label: "Don't put one" }],
            trigger: makeCommonTrigger(trigger.controllerSeatId, trigger.controllerSeatId, sourceCard, { kind: "put_permanent_from_hand" }, `${trigger.sourceCardName} triggers.`),
            remainingStack
          });
          return;
        }
      } else {
        setSession((current) => resolveTriggerEffect(current, trigger));
      }
    } else if (accepted && trigger.effect.kind === "draw_then_land") {
      // The draw happens now; WHICH land (or none) is the human's choice, asked with the hand as it is after the draw.
      const controllerSeat = session.seats.find((seat) => seat.id === trigger.controllerSeatId);
      if (controllerSeat?.kind === "human") {
        const drawnSession = drawMultipleForSeat(session, trigger.controllerSeatId, trigger.effect.amount, `${controllerSeat.name} draws ${trigger.effect.amount} from ${trigger.sourceCardName}.`);
        checkMiracleAfterDraw(session, drawnSession);
        const lands = drawnSession.seats.find((seat) => seat.id === trigger.controllerSeatId)?.board.hand.filter((card) => card.typeLine.includes("Land")) ?? [];
        const ownerAuto = trigger.effect.ownerToo ? resolveTriggerEffect(drawnSession, { ...trigger, effect: { ...trigger.effect, ownerToo: true }, controllerSeatId: findPermanentById(drawnSession, trigger.sourceCardId)?.ownerSeatId ?? trigger.controllerSeatId }) : drawnSession;
        setSession(() => (trigger.effect.kind === "draw_then_land" && trigger.effect.ownerToo && findPermanentById(drawnSession, trigger.sourceCardId)?.ownerSeatId !== trigger.controllerSeatId ? ownerAuto : drawnSession));
        if (lands.length > 0) {
          const sourceCard = findPermanentById(drawnSession, trigger.sourceCardId) ?? ({ id: trigger.sourceCardId, name: trigger.sourceCardName, typeLine: "", oracleText: "", colors: [], manaValue: 0, role: "permanent", zone: "battlefield" } as VisibleCard);
          setPendingRuleChoice({
            id: crypto.randomUUID(),
            kind: "choose_trigger_option",
            controllerSeatId: trigger.controllerSeatId,
            sourceCardId: trigger.sourceCardId,
            sourceCardName: trigger.sourceCardName,
            prompt: `${trigger.sourceCardName}: put a land card from your hand onto the battlefield?`,
            options: [...lands.map((card, index) => ({ index, label: card.name })), { index: lands.length, label: "Don't put a land" }],
            trigger: makeCommonTrigger(trigger.controllerSeatId, trigger.controllerSeatId, sourceCard, { kind: "put_land_from_hand" }, `${trigger.sourceCardName} triggers.`),
            remainingStack
          });
          return;
        }
      } else {
        setSession((current) => resolveTriggerEffect(current, trigger));
      }
    } else if (accepted && trigger.effect.kind === "return_land_to_hand") {
      // Karoo/bounce lands (Simic Growth Chamber, ...): mandatory, but WHICH land is a real choice
      // — resolveTriggerEffect is a pure function with no access to pendingRuleChoice, so this
      // always needs the same real-prompt-for-a-human/deterministic-pick-for-an-agent split as
      // connive's discard and draw_then_put_back's put-back above. No lands to return can't
      // actually happen (the karoo land itself is already on the battlefield by the time this
      // trigger fires, so it's always at least one legal target), but the check falls through to
      // the shared resume logic below rather than assuming otherwise.
      const controllerSeat = session.seats.find((seat) => seat.id === trigger.controllerSeatId);
      const hasLand = controllerSeat?.board.battlefield.some((permanent) => permanent.typeLine.includes("Land"));
      if (hasLand) {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "return_land_to_hand",
          controllerSeatId: trigger.controllerSeatId,
          sourceCardId: trigger.sourceCardId,
          sourceCardName: trigger.sourceCardName,
          prompt: `${controllerSeat?.name ?? "Player"} must return a land they control to its owner's hand.`,
          trigger,
          remainingStack
        });
        return;
      }
    } else if (accepted && trigger.effect.kind === "blink") {
      // Aminatou, the Fateshifter's -1: WHICH permanent is a real choice, same shape as
      // return_land_to_hand just above. Unlike a karoo land (always guaranteed a legal target),
      // "another permanent" can genuinely have none — if this planeswalker is the controller's
      // only permanent, the ability just does nothing, matching real rules for a targeted ability
      // that finds no legal target once it resolves.
      const controllerSeat = session.seats.find((seat) => seat.id === trigger.controllerSeatId);
      const hasOtherPermanent = controllerSeat?.board.battlefield.some((permanent) => permanent.id !== trigger.sourceCardId);
      if (hasOtherPermanent) {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "choose_permanent_to_blink",
          controllerSeatId: trigger.controllerSeatId,
          sourceCardId: trigger.sourceCardId,
          sourceCardName: trigger.sourceCardName,
          prompt: `${controllerSeat?.name ?? "Player"} must choose another permanent they own to exile and return to the battlefield.`,
          trigger,
          remainingStack
        });
        return;
      }
      addEvent(`${trigger.sourceCardName} finds no other permanent to blink and has no effect.`, trigger.controllerSeatId, "Rules action");
    } else if (accepted) {
      setSession((current) => {
        const next = resolveTriggerEffect(current, trigger);
        checkMiracleAfterDraw(current, next);
        return next;
      });
    } else {
      addEvent(
        `${session.seats.find((seat) => seat.id === trigger.controllerSeatId)?.name ?? "Player"} declines ${trigger.sourceCardName}'s optional effect.`,
        trigger.controllerSeatId,
        "Rules action"
      );
    }
    if (trigger.parentAction) {
      // resumeStackAction, not beginPendingAction: the parent is an ALREADY-cast spell being
      // resumed after this interrupting trigger resolves, not a brand-new action. beginPendingAction
      // re-runs its whole "spell" preamble (checkCastTriggeredKeywords, findCastTriggers) every time
      // it's called — calling it here re-applied extort/prowess/historic-draw a second time and
      // re-queued every OTHER "whenever you cast" trigger on the board a second time too, for every
      // cast that got interrupted by any trigger (Mystic Remora among them, but not specific to it —
      // reported live as "the LLM firing twice for almost every card").
      window.setTimeout(() => resumeStackAction(trigger.parentAction!), 0);
    } else {
      resumeTopStackAction(remainingStack);
    }
  }

  // Handles both optional_trigger (the deterministic trigger queue's own "you may") and
  // optional_primitive_plan (the LLM-fallback path's equivalent, offered by
  // offerOptionalPrimitivePlan) — they share the same OptionalTriggerModal/view kind in
  // ThreeGameTable.tsx (ruleChoiceView projects both to "optional_trigger"), so the accept/decline
  // handlers bound to that modal need to resolve whichever underlying choice is actually pending.
  function acceptOptionalTrigger() {
    const choice = pendingRuleChoice;
    if (!choice) return;
    if (choice.kind === "optional_trigger") {
      setPendingRuleChoice(undefined);
      finishTriggerResolution(choice.trigger, choice.remainingStack, true);
      return;
    }
    if (choice.kind === "optional_primitive_plan") {
      setPendingRuleChoice(undefined);
      setSession((current) => applyPrimitiveActionPlan(current, choice.controllerSeatId, choice.sourceCard, choice.steps));
      addEvent(`${choice.sourceCardName}: ${choice.prompt.replace(/ Do you want to\?$/, "")}.`, choice.controllerSeatId, "Rules advisor (primitive plan)");
    }
  }

  function declineOptionalTrigger() {
    const choice = pendingRuleChoice;
    if (!choice) return;
    if (choice.kind === "optional_trigger") {
      setPendingRuleChoice(undefined);
      finishTriggerResolution(choice.trigger, choice.remainingStack, false);
      return;
    }
    if (choice.kind === "optional_primitive_plan") {
      setPendingRuleChoice(undefined);
      const seatName = session.seats.find((seat) => seat.id === choice.controllerSeatId)?.name ?? "Player";
      addEvent(`${seatName} declines ${choice.sourceCardName}'s optional effect.`, choice.controllerSeatId, "Rules advisor (primitive plan)");
    }
  }

  // Shared completion for the "put cards on top of library" choice (finishTriggerResolution's
  // draw_then_put_back branch) — called from both the human's modal confirm and
  // resolveAgentRuleChoice's deterministic pick, so the stack-advance logic that follows only needs
  // to live in one place.
  function completePutCardsOnLibrary(cardIds: string[]) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "put_cards_on_library") return;
    setPendingRuleChoice(undefined);
    setSession((current) => applyPutCardsOnLibrary(current, choice.controllerSeatId, choice.sourceCardName, cardIds.slice(0, choice.requiredCount)));
    const trigger = choice.trigger;
    if (!trigger) {
      // A cast spell's own draw_then_put_back (see the type's own comment) — the stack/priority
      // were already resolved before this choice ever opened, so there's nothing left to resume.
      return;
    }
    if (trigger.parentAction) {
      // resumeStackAction, not beginPendingAction: the parent is an ALREADY-cast spell being
      // resumed after this interrupting trigger resolves, not a brand-new action. beginPendingAction
      // re-runs its whole "spell" preamble (checkCastTriggeredKeywords, findCastTriggers) every time
      // it's called — calling it here re-applied extort/prowess/historic-draw a second time and
      // re-queued every OTHER "whenever you cast" trigger on the board a second time too, for every
      // cast that got interrupted by any trigger (Mystic Remora among them, but not specific to it —
      // reported live as "the LLM firing twice for almost every card").
      window.setTimeout(() => resumeStackAction(trigger.parentAction!), 0);
    } else {
      resumeTopStackAction(choice.remainingStack ?? []);
    }
  }

  function resumeAfterTriggerChoice(trigger: Extract<PendingAction, { type: "trigger" }>, remainingStack: PendingAction[]) {
    if (trigger.parentAction) {
      window.setTimeout(() => resumeStackAction(trigger.parentAction!), 0);
    } else {
      resumeTopStackAction(remainingStack);
    }
  }

  // Draws one card for a single connive iteration, then opens a real "choose which card to
  // discard" choice — or, if there's nothing left in hand to discard, moves straight on to
  // whatever's left (another iteration for a rare "connives twice," or resuming the stack).
  // Takes the session to draw from explicitly (rather than reading the component's `session` state)
  // so a same-tick recursive call (the empty-hand skip below) operates on the just-drawn state
  // instead of a stale pre-draw snapshot — setSession's updater doesn't run synchronously, so a
  // second read of `session` immediately after the first draw would still see the old hand.
  function startConniveIteration(
    trigger: Extract<PendingAction, { type: "trigger" }>,
    remainingStack: PendingAction[],
    iterationsLeft: number,
    fromSession: GameSession
  ) {
    if (iterationsLeft <= 0) {
      setSession(() => fromSession);
      resumeAfterTriggerChoice(trigger, remainingStack);
      return;
    }
    const controllerSeat = fromSession.seats.find((seat) => seat.id === trigger.controllerSeatId);
    const seatName = controllerSeat?.name ?? "Player";
    const drawnSession = drawForSeat(fromSession, trigger.controllerSeatId, `${trigger.sourceCardName} connives: ${seatName} draws a card.`);
    checkMiracleAfterDraw(fromSession, drawnSession);
    const postDrawHandSize = drawnSession.seats.find((seat) => seat.id === trigger.controllerSeatId)?.board.hand.length ?? 0;
    if (postDrawHandSize === 0) {
      startConniveIteration(trigger, remainingStack, iterationsLeft - 1, drawnSession);
      return;
    }
    setSession(() => drawnSession);
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "connive_discard",
      controllerSeatId: trigger.controllerSeatId,
      sourceCardId: trigger.sourceCardId,
      sourceCardName: trigger.sourceCardName,
      prompt: `${seatName} connives: choose a card to discard.`,
      remainingAmount: iterationsLeft - 1,
      trigger,
      remainingStack
    });
  }

  // Shared completion for the connive discard choice — called from both the human's modal confirm
  // and resolveAgentRuleChoice's deterministic pick (chooseWorstHandCardToDiscard), same split as
  // completePutCardsOnLibrary above.
  function completeConniveDiscard(cardIds: string[]) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "connive_discard") return;
    setPendingRuleChoice(undefined);
    const discardId = cardIds[0];
    const trigger = choice.trigger;
    const remainingStack = choice.remainingStack ?? [];
    if (!discardId) {
      if (trigger) startConniveIteration(trigger, remainingStack, choice.remainingAmount, session);
      return;
    }
    const discardedSession = applyConniveDiscard(session, choice.controllerSeatId, choice.sourceCardId, choice.sourceCardName, discardId);
    if (choice.remainingAmount > 0 && trigger) {
      startConniveIteration(trigger, remainingStack, choice.remainingAmount, discardedSession);
      return;
    }
    setSession(() => discardedSession);
    if (trigger) resumeAfterTriggerChoice(trigger, remainingStack);
  }

  // Shared completion for the karoo/bounce-land choice — called from both the human's modal confirm
  // and resolveAgentRuleChoice's deterministic pick (chooseLandToReturn), same split as
  // completeConniveDiscard/completePutCardsOnLibrary above.
  function completeReturnLandToHand(cardIds: string[]) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "return_land_to_hand") return;
    setPendingRuleChoice(undefined);
    const landId = cardIds[0];
    if (landId) {
      setSession((current) => moveCardBetweenVisibleZones(current, choice.controllerSeatId, landId, "hand"));
    }
    const trigger = choice.trigger;
    if (trigger) resumeAfterTriggerChoice(trigger, choice.remainingStack ?? []);
  }

  function completeChoosePermanentToBlink(cardIds: string[]) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_permanent_to_blink") return;
    setPendingRuleChoice(undefined);
    const targetId = cardIds[0];
    // Any ETB triggers the blinked permanent's return causes (its own "when this enters," and any
    // OTHER permanent watching for one) — captured here (not queued via queueCommonTriggers, which
    // would race resumeAfterTriggerChoice's own pendingAction update below) and appended to the
    // resumed stack instead, so they resolve next, same LIFO ordering as any other trigger caused
    // by resolving another one. Same captured-variable pattern as playCard's land-ETB scan: setSession's
    // updater may run twice under StrictMode, but both invocations compute the same triggers from
    // the same `current`, so which one "wins" doesn't matter.
    let capturedTriggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];
    if (targetId) {
      setSession((current) => {
        const { session: blinkedSession, movedCard } = moveCardAcrossSeats(current, choice.controllerSeatId, targetId, choice.controllerSeatId, "battlefield");
        if (!movedCard) return current;
        capturedTriggers = findCommonTriggersForPermanentEntered(blinkedSession, choice.controllerSeatId, movedCard);
        return {
          ...blinkedSession,
          events: [
            {
              id: crypto.randomUUID(),
              at: new Date().toISOString(),
              seatId: choice.controllerSeatId,
              message: `${choice.sourceCardName} exiles ${movedCard.name}, then returns it to the battlefield under its controller's control.`,
              detail: "Rules action"
            },
            ...blinkedSession.events
          ]
        };
      });
    }
    const trigger = choice.trigger;
    if (trigger) resumeAfterTriggerChoice(trigger, [...(choice.remainingStack ?? []), ...capturedTriggers]);
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
    const view = withPendingActionSourceCard(session, action, stackStore.ref.current.stack) as unknown as StackFeedEntry["view"];
    const startEventId = session.events[0]?.id;
    setStackFeed((previous) => [{ id: action.id, view, startEventId, status: "resolving" as const }, ...previous.filter((entry) => entry.id !== action.id)].slice(0, 5));
    window.setTimeout(() => {
      resolveBeatIds.current.delete(action.id);
      // A response was put on the stack while the beat ran: it resolves first and this item comes back through the normal stack resume.
      const stack = stackStore.ref.current.stack;
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
  resolveNowRef.current = resolvePendingActionNow;
  abilityApiRef.current = { resolveSacrificeAbilityEffect, resolveTapAbilityEffect };

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
      const counterTargetAction = stackStore.ref.current.stack.find((item) => item.id === action.counterTargetId);
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

  // Who must pass for the top stack item to resolve (drives the priority pips next to the stack). Same call the priority driver makes.
  const requiredPassesForPanel = useMemo(
    () =>
      pendingAction
        ? pendingActionRequiredPasses(session.seats, pendingAction, activeSeatId, session, manaPools, priorityStopSettings, holdPriorityOnce ? humanSeat.id : undefined)
        : [],
    [pendingAction, session, activeSeatId, manaPools, priorityStopSettings, holdPriorityOnce, humanSeat.id]
  );

  // "When this resolves you'll have to choose" notes for the human, keyed by stack item id (shown on the stack entries).
  const stackPrompts = useMemo(() => {
    const notes: Record<string, string> = {};
    const humanForNotes = session.seats.find((seat) => seat.kind === "human");
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

  // True (and logs why) when the human tried to act while a minimized choice is still waiting for an answer. Acting then could overwrite
  // the parked choice or resolve things out of order, so the player resumes it first. Agents' actions are never blocked.
  function humanActionBlockedByChoice(seatId?: string): boolean {
    if (!choiceMinimized) return false;
    if (seatId !== undefined && seatId !== humanSeat.id) return false;
    const prompt = pendingRuleChoice && "prompt" in pendingRuleChoice ? pendingRuleChoice.prompt : undefined;
    addEvent(`Finish the pending choice first${prompt ? ` (${prompt})` : ""} — press Resume at the top of the board.`, humanSeat.id, "Rules action");
    return true;
  }

  function addEvent(message: string, seatId?: string, detail?: string) {
    setSession((current) => ({
      ...current,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message,
          detail
        },
        ...current.events
      ]
    }));
  }

  function markAgentThinking(seatId: string, thinking: boolean) {
    setAgentThinking((current) => ({ ...current, [seatId]: thinking }));
  }

  // The situation and scored options of each agent's latest decision (see requestAgentDecision), attached to its reasoning for the 🧠 chat.
  const agentDecisionInfo = useRef<Record<string, Pick<AgentReasoning, "situation" | "options" | "chosenId" | "turn" | "phase">>>({});

  function recordAgentReasoning(seatId: string, reasoning: AgentReasoning) {
    // Consumed once: a decision recorded without a fresh model call (forced/fallback block, pass) must not inherit the PREVIOUS decision's board and options.
    const info = agentDecisionInfo.current[seatId];
    delete agentDecisionInfo.current[seatId];
    setAgentReasoning((current) => {
      const previous = current[seatId];
      const history = previous ? [...(previous.history ?? []), { turn: previous.turn, phase: previous.phase, purpose: previous.purpose, label: previous.label, reason: previous.reason.slice(0, 240) }].slice(-12) : undefined;
      return { ...current, [seatId]: { ...(info ?? {}), ...reasoning, ...(history ? { history } : {}) } };
    });
  }

  function queueCommonTriggers(rawTriggers: Array<Extract<PendingAction, { type: "trigger" }>>) {
    if (rawTriggers.length === 0) return;
    // An agent's targeted trigger aims as it goes on the stack (rule 603.3d), so the human sees the target in the stack panel and can respond to it.
    const triggers = rawTriggers.map((trigger) => {
      if (trigger.effect.chosenOption !== undefined) return trigger;
      const controller = session.seats.find((seat) => seat.id === trigger.controllerSeatId);
      if (!controller || controller.kind === "human") return trigger;
      const chosen = agentTargetedTriggerKinds.has(trigger.effect.kind) ? agentTriggerTarget(session, trigger) : undefined;
      return chosen ? { ...trigger, effect: { ...trigger.effect, chosenOption: chosen } } : trigger;
    });
    // A human's modal trigger (its mode) and targeted triggers (their targets) are decided as the trigger goes onto the stack, so the
    // opponents see the choice before they respond. Only modes and targets: costs and "you may" amounts are still settled on resolution.
    for (const trigger of triggers) {
      if (trigger.effect.chosenOption !== undefined) continue;
      const controller = session.seats.find((seat) => seat.id === trigger.controllerSeatId);
      if (controller?.kind !== "human") continue;
      const asksAtQueueTime = trigger.effect.kind === "modal" || trigger.effect.kind === "put_any_from_hand" || triggerCardPrompt(trigger, controller) !== undefined;
      if (asksAtQueueTime && openTriggerOptionPrompt(trigger, [], triggers)) return;
    }
    const [firstTrigger, ...laterTriggers] = triggers;
    if (laterTriggers.length > 0) {
      replaceStackActions([...stackStore.ref.current.stack, ...laterTriggers]);
      addEvent(`${triggers.length} triggered abilities were put onto the stack.`, firstTrigger.controllerSeatId, "Trigger");
    }
    beginPendingAction(firstTrigger, "Trigger");
  }

  async function consultRulesAdvisor(event: string, seatId: string, sourceCard: VisibleCard, castTargets?: ChosenTarget[]) {
    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat) return;
    // A card with no oracle text at all (a plain vanilla creature — Alpine Grizzly, Balduvian
    // Bears, ...) has nothing on it for either advisor to interpret; the engine's core systems
    // (P/T, mana cost, combat, zone changes) already fully handle it without any LLM call. Same
    // "vanilla = trim(oracleText) === ''" definition cardDb.ts's bulk parser uses to skip these
    // cards offline — this is that same skip applied at the live call site, rather than relying on
    // the incidental fact that every vanilla card shares the same (event, "") primitiveActionPlanCache
    // key and so happens to only cost one real Ollama call per event type per session.
    if (!sourceCard.oracleText.trim()) return;
    // shouldConsultRulesAdvisor's keyword pre-gate exists to avoid wasting a consultation on text
    // with nothing for the RuleWorkflow vocabulary (draw/scry/search/...) to resolve — but that
    // gate returning false doesn't mean the card has NO effect, just that this narrower advisor
    // doesn't cover it (e.g. its keyword list has no "destroy" at all). Route those to the broader
    // primitive-action planner instead of silently doing nothing, same as this function's own
    // fallback-of-last-resort role for the shapes it DOES recognize.
    if (!shouldConsultRulesAdvisor(event, sourceCard)) {
      void consultPrimitiveActionPlanner(event, seatId, sourceCard, castTargets);
      return;
    }

    const advisorInput = {
      event,
      actorName: seat.name,
      sourceCard,
      battlefield: seat.board.battlefield,
      hand: seat.board.hand,
      graveyard: seat.board.graveyard ?? [],
      exile: seat.board.exile ?? [],
      libraryPreview: (seat.library ?? []).slice(0, 12).map((card) => ({
        id: card.id,
        name: card.name,
        typeLine: card.typeLine,
        oracleText: card.oracleText
      }))
    };

    // Re-run the (free, pure) deterministic classifier before ever trusting a cached answer for this
    // shape — a cached entry only ever came from a genuine Ollama call (see saveRuleWorkflowCache's
    // own call site below), so if this exact card has since gained real deterministic coverage, that
    // fix must win over a stale pre-fix Ollama answer, not be silently shadowed by it forever.
    // Reproduced live: Cultivate fetching only one land because an earlier Ollama misclassification
    // (from before deterministicRuleWorkflow covered this shape — see its own
    // search_basic_lands_split_battlefield_hand branch) was still sitting in this browser's
    // localStorage-backed ruleWorkflowCache and short-circuited the request below entirely, so the
    // now-fixed deterministic classifier never got a chance to run again for this card.
    const deterministic = deterministicRuleWorkflow(advisorInput);
    if (deterministic) {
      applyRuleWorkflow(seatId, sourceCard, deterministic, "deterministic");
      return;
    }

    // A classification is a pure function of (event, this card's own oracle text) — see
    // ruleWorkflowCache's own comment — so a prior real consultation for the exact same shape
    // (this game or, thanks to loadRuleWorkflowCacheOnce, an earlier one) can be reused outright,
    // skipping the network round-trip to Ollama entirely.
    const cacheKey = ruleWorkflowCacheKey(event, sourceCard.oracleText);
    const cached = ruleWorkflowCache.get(cacheKey);
    if (cached) {
      applyRuleWorkflow(seatId, sourceCard, cached, "cached");
      return;
    }

    setRulesAdvisorPending((count) => count + 1);
    try {
      const response = await fetch("/api/rules/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(AGENT_REQUEST_TIMEOUT_MS),
        body: JSON.stringify(advisorInput)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = (await response.json()) as { source: "deterministic" | "ollama" | "fallback"; workflow: RuleWorkflow };
      // Only a genuine Ollama classification is worth caching (see RULE_WORKFLOW_CACHE_STORAGE_KEY's
      // own comment) — a "deterministic" result is free to recompute, and always should be, so any
      // later fix to deterministicRuleWorkflow takes effect on the very next cast; a "fallback"
      // result (the advisor itself failed) is a transient degradation, not a real classification.
      if (result.source === "ollama") saveRuleWorkflowCache(cacheKey, result.workflow);
      applyRuleWorkflow(seatId, sourceCard, result.workflow, result.source);
    } catch (error) {
      addEvent(
        `Rules advisor could not check ${sourceCard.name}: ${error instanceof Error ? error.message : "unknown error"}.`,
        seatId,
        "Rules advisor"
      );
    } finally {
      setRulesAdvisorPending((count) => Math.max(0, count - 1));
    }
  }

  // The primitive-action fallback: consultRulesAdvisor's own narrower RuleWorkflow vocabulary (draw/
  // scry/surveil/search) has no shape for "destroy target X," "sacrifice a permanent," "put counters
  // on this," etc. — this is the broader, closed-primitive-vocabulary fallback for everything else,
  // called only when consultRulesAdvisor's own gate has already given up on a card (see its own call
  // site). Same shape as consultRulesAdvisor itself: cache check, fetch, apply, degrade safely on
  // failure — reuses ruleWorkflowCacheKey's (event, oracleText) key convention against the sibling
  // primitiveActionPlanCache rather than inventing a new key scheme.
  async function consultPrimitiveActionPlanner(event: string, seatId: string, sourceCard: VisibleCard, castTargets?: ChosenTarget[]) {
    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat) return;
    // Nothing left once scoped to this event (e.g. a creature whose entire oracle text is an
    // activated ability, with no separate "when this dies"/"enters" clause of its own) — decline
    // outright rather than asking the LLM to interpret an empty prompt.
    if (!eventRelevantOracleText(event, sourceCard.oracleText).trim()) return;

    const cacheKey = ruleWorkflowCacheKey(event, sourceCard.oracleText);
    const cached = primitiveActionPlanCache.get(cacheKey);
    if (cached) {
      logAdvisorUse({
        path: "primitive-plan",
        source: "cached",
        card: sourceCard.name,
        oracleText: sourceCard.oracleText,
        event,
        detail: cached.plan.declined ? "declined" : `${cached.plan.steps.length} steps: ${cached.plan.summary}`
      });
      if (!cached.plan.declined && cached.plan.steps.length > 0 && isBoardConditionMet(cached.plan.condition ?? "", seat)) {
        if (cached.plan.optional) {
          offerOptionalPrimitivePlan(seatId, sourceCard, cached.plan.steps, cached.plan.summary);
        } else {
          setSession((current) => applyPrimitiveActionPlan(current, seatId, sourceCard, cached.plan.steps, castTargets));
          addEvent(
            `${sourceCard.name}: ${cached.plan.summary || "resolved via the primitive-action fallback"} (cached)${cached.usedXMageGrounding ? " — grounded via XMage reference" : ""}.`,
            seatId,
            "Rules advisor (primitive plan)"
          );
        }
      }
      return;
    }

    setRulesAdvisorPending((count) => count + 1);
    try {
      const response = await fetch("/api/rules/primitive-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(AGENT_REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          cardName: sourceCard.name,
          // Scoped the same way requestRuleWorkflow's own Ollama call already is — unlike that
          // sibling, this fallback used to send the card's full, unscoped oracle text regardless of
          // event, so a creature with an activated ability but no real death trigger (Cankerbloom's
          // "{1}, Sacrifice this creature: Choose one — Destroy target artifact. ...", no "when this
          // dies" clause at all) had its cost-gated ability text handed to the LLM as if it were the
          // effect of THIS card_moved_to_graveyard event — with nothing telling it that text belongs
          // to a different, unrelated event. Reported live: sacrificing Cankerbloom to pay its own
          // activation cost caused its death to ALSO destroy an extra artifact and sacrifice an
          // unrelated permanent, on top of the real (correctly resolved) activated-ability effect.
          oracleText: eventRelevantOracleText(event, sourceCard.oracleText),
          actorName: seat.name,
          battlefieldSummary: seat.board.battlefield.map((card) => `${card.name} (${card.typeLine})`),
          handSummary: seat.board.hand.map((card) => card.name),
          graveyardSummary: (seat.board.graveyard ?? []).map((card) => card.name),
          event
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = (await response.json()) as { source: "ollama" | "fallback" | "cache"; plan: PrimitiveActionPlan; usedXMageGrounding: boolean };
      primitiveActionPlanCache.set(cacheKey, { plan: result.plan, usedXMageGrounding: result.usedXMageGrounding });
      logAdvisorUse({
        path: "primitive-plan",
        source: result.source,
        card: sourceCard.name,
        oracleText: sourceCard.oracleText,
        event,
        detail: result.plan.declined ? "declined" : `${result.plan.steps.length} steps: ${result.plan.summary}`
      });
      if (!result.plan.declined && result.plan.steps.length > 0 && isBoardConditionMet(result.plan.condition ?? "", seat)) {
        if (result.plan.optional) {
          offerOptionalPrimitivePlan(seatId, sourceCard, result.plan.steps, result.plan.summary);
        } else {
          setSession((current) => applyPrimitiveActionPlan(current, seatId, sourceCard, result.plan.steps, castTargets));
          addEvent(
            `${sourceCard.name}: ${result.plan.summary || "resolved via the primitive-action fallback"}${result.usedXMageGrounding ? " — grounded via XMage reference" : ""}.`,
            seatId,
            "Rules advisor (primitive plan)"
          );
        }
      }
    } catch (error) {
      addEvent(
        `Primitive-action planner could not resolve ${sourceCard.name}: ${error instanceof Error ? error.message : "unknown error"}.`,
        seatId,
        "Rules advisor"
      );
    } finally {
      setRulesAdvisorPending((count) => Math.max(0, count - 1));
    }
  }

  // Opens the same optional_trigger-shaped accept/decline prompt the deterministic trigger path
  // already has (see beginTriggerResolution's own doc comment) for a primitive-action plan whose
  // oracle text said "you may" — called from both of consultPrimitiveActionPlanner's branches
  // (client-cache hit and live fetch) instead of applying the plan immediately.
  function offerOptionalPrimitivePlan(seatId: string, sourceCard: VisibleCard, steps: PrimitiveActionStep[], summary: string) {
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "optional_primitive_plan",
      controllerSeatId: seatId,
      sourceCardId: sourceCard.id,
      sourceCardName: sourceCard.name,
      prompt: `${summary || `${sourceCard.name}'s effect`}. Do you want to?`,
      sourceCard,
      steps
    });
  }

  function applyRuleWorkflow(seatId: string, sourceCard: VisibleCard, workflow: RuleWorkflow, source: "deterministic" | "ollama" | "fallback" | "cached") {
    if (workflow.workflow === "none") return;

    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat) return;
    const isHuman = seat.kind === "human";
    logAdvisorUse({ path: "rule-workflow", source, card: sourceCard.name, oracleText: sourceCard.oracleText, detail: `${workflow.workflow}: ${workflow.summary ?? ""}` });
    addEvent(`Rules advisor (${source}):${workflow.summary || `${sourceCard.name} needs manual review (no summary returned).`}`, seatId, "Rules advisor");

    if (workflow.workflow === "proliferate") {
      setSession((current) => resolveProliferate(current));
      return;
    }

    // Every other workflow below routes through pendingRuleChoice/setSession, which already have
    // agent-side auto-resolution (resolveAgentRuleChoice, resolveAgentLibraryLookWorkflow) — this
    // used to bail out for non-human seats entirely, silently skipping agent-cast draw/search/scry
    // spells' actual effects after only logging the rules-advisor event.
    if (workflow.workflow === "search_basic_lands_shared_type_to_battlefield_tapped") {
      if (isHuman) {
        setInspectedCard(undefined);
        setMyriadSearch({ seatId, sourceCardId: workflow.sourceCardId ?? sourceCard.id });
        return;
      }
      // myriadSearch has no agent auto-resolver; auto-search directly instead of leaving it stuck.
      const pair = chooseBestBasicLandPairForMyriad(seat);
      if (pair.length === 2) {
        setSession((current) => resolveMyriadLandscapeSearch(current, seatId, workflow.sourceCardId ?? sourceCard.id, pair.map((card) => card.id)));
      } else {
        addEvent(`${seat.name} has no valid basic land pair to find for ${sourceCard.name}.`, seatId, "Rules advisor");
      }
      return;
    }

    if (workflow.workflow === "search_basic_lands_split_battlefield_hand") {
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_card_from_library",
        controllerSeatId: seatId,
        sourceCardId: workflow.sourceCardId ?? sourceCard.id,
        sourceCardName: sourceCard.name,
        prompt: workflow.summary || `Search your library for ${sourceCard.name}.`,
        destination: "battlefield",
        tapped: true,
        maxChoices: Math.max(1, workflow.maxChoices || 2),
        allowedCardFilter: workflow.allowedCardFilter,
        splitDestination: "hand",
        // The player decides which found land goes onto the battlefield (tapped) and which to hand; the second find gets the other zone.
        destinationChoices: isHuman ? ["battlefield", "hand"] : undefined
      });
      return;
    }

    if (
      workflow.workflow === "search_library_to_hand" ||
      workflow.workflow === "search_library_to_battlefield" ||
      workflow.workflow === "search_library_to_graveyard" ||
      workflow.workflow === "search_library_to_hand_or_graveyard" ||
      workflow.workflow === "search_library_to_library"
    ) {
      const destination: "hand" | "battlefield" | "graveyard" | "library" =
        workflow.workflow === "search_library_to_battlefield"
          ? "battlefield"
          : workflow.workflow === "search_library_to_graveyard"
            ? "graveyard"
            : workflow.workflow === "search_library_to_library"
              ? "library"
              : workflow.destination === "battlefield" || workflow.destination === "graveyard" || workflow.destination === "library"
                ? workflow.destination
                : "hand";
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_card_from_library",
        controllerSeatId: seatId,
        sourceCardId: workflow.sourceCardId ?? sourceCard.id,
        sourceCardName: sourceCard.name,
        prompt: workflow.summary || `Search your library for ${sourceCard.name}.`,
        destination,
        destinationChoices: workflow.destinationChoices,
        tapped: workflow.tapped,
        maxChoices: Math.max(1, workflow.maxChoices || 1),
        allowedCardFilter: workflow.allowedCardFilter,
        manaValueRestriction: workflow.manaValueRestriction,
        totalManaValueLimit: workflow.totalManaValueLimit,
        reveal: /\breveal (?:it|that card|them|those cards|the card)\b/i.test(sourceCard.oracleText)
      });
      return;
    }

    if (workflow.workflow === "draw_cards") {
      const count = Math.max(1, workflow.maxChoices || 1);
      setSession((current) => {
        const next = drawMultipleForSeat(current, seatId, count, `${seat.name} draws ${count} from ${sourceCard.name}.`);
        checkMiracleAfterDraw(current, next);
        return next;
      });
      return;
    }

    if (workflow.workflow === "draw_then_put_back") {
      // Same shape as finishTriggerResolution's draw_then_put_back branch (a permanent's triggered
      // "draw N, then put M back," e.g. Aminatou's +1) but for a cast spell (Brainstorm, Brainsurge,
      // ...) — the draw itself isn't a choice, so it happens immediately; only which cards go back
      // is a real decision, routed through the same put_cards_on_library choice (a real prompt for a
      // human, resolveAgentRuleChoice's highest-mana-value-first pick for an agent).
      // postDrawHandSize is computed synchronously against `session` here, NOT by writing into a
      // captured variable from inside the setSession updater below (as this used to) — setSession's
      // updater doesn't run synchronously, so requiredCount was always computed against
      // postDrawHandSize's untouched initial value of 0, making `if (requiredCount > 0)` false every
      // time: the draw itself worked, but the "then put N back" choice never opened for ANY
      // draw_then_put_back spell, reported live as "Brainsurge does not work."
      const drawAmount = Math.max(1, workflow.maxChoices || 1);
      const putBackAmount = workflow.putBackAmount ?? 0;
      const drawnSession = drawMultipleForSeat(session, seatId, drawAmount, `${seat.name} draws ${drawAmount} from ${sourceCard.name}.`);
      const postDrawHandSize = drawnSession.seats.find((item) => item.id === seatId)?.board.hand.length ?? 0;
      checkMiracleAfterDraw(session, drawnSession);
      setSession(() => drawnSession);
      const requiredCount = Math.min(putBackAmount, postDrawHandSize);
      if (requiredCount > 0) {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "put_cards_on_library",
          controllerSeatId: seatId,
          sourceCardId: workflow.sourceCardId ?? sourceCard.id,
          sourceCardName: sourceCard.name,
          prompt: `${seat.name} must put ${requiredCount} card${requiredCount === 1 ? "" : "s"} from hand on top of their library.`,
          requiredCount
        });
      }
      return;
    }

    if (
      workflow.workflow === "scry_cards" ||
      workflow.workflow === "surveil_cards" ||
      workflow.workflow === "look_at_top_cards" ||
      workflow.workflow === "look_at_top_cards_reveal_type_to_hand" ||
      workflow.workflow === "reorder_top_cards"
    ) {
      const baseCount = Math.max(1, workflow.maxChoices || 1);
      // Enhanced Surveillance's "additional two cards each time you surveil" — see
      // surveilBonusForSeat's own doc comment; doesn't apply to scry or the other workflows here.
      const count = workflow.workflow === "surveil_cards" ? baseCount + surveilBonusForSeat(seat) : baseCount;
      const lookWorkflow = workflow.workflow;
      if (isHuman) {
        // "look_at_top_cards" (Diabolic Vision: "look at the top N, put one into hand and the rest
        // on top in any order") needs its own mode — it used to be folded into "scry", which only
        // ever loaded a single card and offered top/bottom choices, neither of which lets a card
        // actually reach hand. "look_at_top_cards_reveal_type_to_hand" (Growing Rites of Itlimoc:
        // same look-then-pick shape, but only a card matching allowedCardFilter may go to hand, and
        // the rest go to the BOTTOM, not back on top) is its own mode for that same reason.
        // "reorder_top_cards" (Ponder-style: put them all back, no hand pick) keeps using plain
        // "reorder".
        const humanMode: LibraryLookMode =
          lookWorkflow === "surveil_cards"
            ? "surveil"
            : lookWorkflow === "reorder_top_cards"
              ? "reorder"
              : lookWorkflow === "look_at_top_cards"
                ? "choose_one"
                : lookWorkflow === "look_at_top_cards_reveal_type_to_hand"
                  ? "choose_one_bottom"
                  : "scry";
        // Portent: the human chooses WHICH player's library to look at (and may then have that player shuffle).
        if (lookWorkflow === "reorder_top_cards" && /target player'?s library/i.test(sourceCard.oracleText)) {
          const lookSpec: TargetSpec = { id: "target", zone: "player", controller: "any", min: 1, max: 1, prompt: `${sourceCard.name}: choose a player whose library you look at.` };
          if (maybeRequestTarget(seatId, sourceCard, lookSpec, false, { kind: "library_look", count, offerShuffle: /you may have that player shuffle/i.test(sourceCard.oracleText) })) return;
        }
        startLibraryLook(
          humanMode,
          count,
          workflow.allowedCardFilter,
          lookWorkflow === "reorder_top_cards" || lookWorkflow === "scry_cards" ? workflow.drawCountAfter : undefined,
          lookWorkflow === "look_at_top_cards_reveal_type_to_hand" ? workflow.restDestination : undefined
        );
        return;
      }
      setSession((current) =>
        resolveAgentLibraryLookWorkflow(
          current,
          seatId,
          sourceCard.name,
          lookWorkflow,
          count,
          workflow.allowedCardFilter,
          lookWorkflow === "reorder_top_cards" || lookWorkflow === "scry_cards" ? workflow.drawCountAfter : undefined,
          lookWorkflow === "look_at_top_cards_reveal_type_to_hand" ? workflow.restDestination : undefined
        )
      );
      return;
    }

    if (workflow.workflow === "manual_review") {
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "manual_review",
        controllerSeatId: seatId,
        sourceCardId: workflow.sourceCardId ?? sourceCard.id,
        sourceCardName: sourceCard.name,
        prompt: workflow.summary || `${sourceCard.name} needs manual review — resolve its effect by hand.`
      });
    }
  }

  // Runs once when a permanent enters the battlefield: interprets static abilities that tax
  // attacking (Propaganda-style effects) so the result can be cached on the card and enforced
  // deterministically thereafter, instead of re-parsing oracle text every combat.
  async function consultStaticEffectInterpreter(seatId: string, card: VisibleCard) {
    if (!looksLikeAttackTaxCandidate(card.oracleText)) return;
    try {
      const response = await fetch("/api/rules/static-effect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(AGENT_REQUEST_TIMEOUT_MS),
        body: JSON.stringify({ sourceCardId: card.id, sourceCardName: card.name, oracleText: card.oracleText })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = (await response.json()) as { source: "deterministic" | "ollama" | "fallback"; effect?: InterpretedEffect };
      if (result.effect) applyInterpretedEffect(seatId, card.id, result.effect);
    } catch (error) {
      addEvent(
        `Static-effect interpreter could not evaluate ${card.name}: ${error instanceof Error ? error.message : "unknown error"}.`,
        seatId,
        "Rules advisor"
      );
    }
  }

  function applyInterpretedEffect(seatId: string, cardId: string, effect: InterpretedEffect) {
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) =>
        seat.id === seatId
          ? {
              ...seat,
              board: {
                ...seat.board,
                battlefield: seat.board.battlefield.map((card) =>
                  card.id === cardId ? { ...card, interpretedEffects: [...(card.interpretedEffects ?? []), effect] } : card
                )
              }
            }
          : seat
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `Static-effect interpreter (${effect.interpretedBy}): ${effect.sourceCardName} taxes attackers ${
            effect.formula === "enchantment_count" ? "{1} per enchantment its controller controls" : `{${effect.amountPerAttacker}}`
          } per attacking creature.`,
          detail: "Rules advisor"
        },
        ...current.events
      ]
    }));
  }

  function hasPlayedLandThisTurn(seatId: string, turn: number) {
    const seat = session.seats.find((item) => item.id === seatId);
    return landPlaysMade(landPlaysThisTurn.current, landTurnKey(seatId, turn)) >= (seat ? landDropsAllowed(seat) : 1);
  }

  function changeLife(seatId: string, delta: number) {
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) => (seat.id === seatId ? { ...seat, life: Math.max(0, seat.life + delta) } : seat)),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${current.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} ${delta > 0 ? "gains" : "loses"} ${Math.abs(delta)} life.`
        },
        ...current.events
      ]
    }));
  }

  function moveCardToGraveyard(seatId: string, cardId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.hand.find((item) => item.id === cardId) ?? seat?.board.battlefield.find((item) => item.id === cardId) ?? seat?.board.exile?.find((item) => item.id === cardId);
    setSelectedHandCardId(undefined);
    setInspectedCard(undefined);
    const nextSession = moveCardBetweenVisibleZones(session, seatId, cardId, "graveyard");
    const triggers = card && card.zone === "battlefield" ? findCommonTriggersForPermanentDied(nextSession, seatId, card) : [];
    setSession(nextSession);
    // See the matching guard in resolvePendingAction: skip the advisor when the deterministic
    // common-trigger system already owns this card's death clause, to avoid double-resolving it
    // (or, for effect kinds outside the advisor's workflow enum, risking an Ollama hallucination).
    if (card && card.zone === "battlefield" && commonTriggerEffect(card.oracleText, "died") === undefined) {
      void consultRulesAdvisor("card_moved_to_graveyard", seatId, card);
    }
    if (triggers.length > 0) {
      window.setTimeout(() => queueCommonTriggers(triggers), 0);
    }
  }

  function moveCardToExile(seatId: string, cardId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card =
      seat?.board.hand.find((item) => item.id === cardId) ??
      seat?.board.battlefield.find((item) => item.id === cardId) ??
      seat?.board.graveyard?.find((item) => item.id === cardId);
    setSelectedHandCardId(undefined);
    setInspectedCard(undefined);
    setSession((current) => moveCardBetweenVisibleZones(current, seatId, cardId, "exile"));
    if (card) void consultRulesAdvisor("card_moved_to_exile", seatId, card);
  }

  function moveCardToHand(seatId: string, cardId: string) {
    setSession((current) => moveCardBetweenVisibleZones(current, seatId, cardId, "hand"));
  }

  function moveBattlefieldCard(seatId: string, cardId: string, position: { x: number; z: number }) {
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) =>
        seat.id === seatId
          ? {
              ...seat,
              board: {
                ...seat.board,
                battlefield: seat.board.battlefield.map((card) => (card.id === cardId ? { ...card, battlefieldPosition: position } : card))
              }
            }
          : seat
      )
    }));
  }

  function changeCounter(seatId: string, cardId: string, kind: string, delta: number) {
    setSession((current) => {
      const next = {
        ...current,
        seats: current.seats.map((seat) =>
          seat.id === seatId
            ? {
                ...seat,
                board: {
                  ...seat.board,
                  battlefield: seat.board.battlefield.map((card) => (card.id === cardId ? applyCounterDelta(card, kind, delta) : card))
                }
              }
            : seat
        ),
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId,
            message: `${current.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} ${delta > 0 ? "adds" : "removes"} a ${kind} counter ${delta > 0 ? "to" : "from"} ${
              current.seats.find((seat) => seat.id === seatId)?.board.battlefield.find((card) => card.id === cardId)?.name ?? "a permanent"
            }.`
          },
          ...current.events
        ]
      };
      return next;
    });
  }

  function activateLoyaltyAbility(seatId: string, cardId: string, loyaltyCost: number, abilityText: string) {
    if (humanActionBlockedByChoice(seatId)) return;
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    if (!seat || !card || !isPlaneswalkerCard(card)) return;
    if (seat.id !== activeSeatId) {
      addEvent(`${seat.name} can activate loyalty abilities only during their own turn.`, seat.id, "Loyalty");
      return;
    }
    if (pendingAction || !isMainPhase(session.phase)) {
      addEvent(`${card.name}'s loyalty ability can be activated only during a main phase while the stack is empty.`, seat.id, "Loyalty");
      return;
    }
    const key = loyaltyTurnKey(seat.id, card.id, session.turn);
    if (loyaltyActivationsThisTurn.current.has(key)) {
      addEvent(`${card.name} already activated a loyalty ability this turn.`, seat.id, "Loyalty");
      return;
    }
    if (loyaltyCost < 0 && loyaltyCounterCount(card) < Math.abs(loyaltyCost)) {
      addEvent(`${card.name} does not have enough loyalty counters for ${formatLoyaltyCost(loyaltyCost)}.`, seat.id, "Loyalty");
      return;
    }

    loyaltyActivationsThisTurn.current.add(key);
    setSession((current) => ({
      ...current,
      seats: current.seats.map((item) =>
        item.id === seatId
          ? {
              ...item,
              board: {
                ...item.board,
                battlefield: item.board.battlefield.map((permanent) => (permanent.id === cardId ? applyCounterDelta(permanent, "loyalty", loyaltyCost) : permanent))
              }
            }
          : item
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} activates ${card.name} ${formatLoyaltyCost(loyaltyCost)}: ${abilityText}`,
          detail: "Loyalty"
        },
        ...current.events
      ]
    }));

    if (/costs? \{1\} less to cast for each artifact you control|has affinity for artifacts/i.test(abilityText)) {
      setSession((current) => ({
        ...current,
        seats: current.seats.map((item) => (item.id === seatId ? { ...item, nextSpellHasArtifactAffinity: true } : item)),
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId,
            message: `${possessive(seat)} next spell this turn costs {1} less to cast for each artifact ${seat.name === "You" ? "you control" : `${seat.name} controls`}.`,
            detail: "Loyalty"
          },
          ...current.events
        ]
      }));
      return;
    }

    const emblemGrant = parseEmblemGrant(abilityText);
    if (emblemGrant) {
      grantEmblem(seatId, card.name, emblemGrant.clauses);
      return;
    }

    const effect = commonTriggerEffect(abilityText, "clause");
    if (effect) {
      const trigger: Extract<PendingAction, { type: "trigger" }> = {
        id: crypto.randomUUID(),
        type: "trigger",
        actorSeatId: seatId,
        controllerSeatId: seatId,
        sourceCardId: card.id,
        sourceCardName: card.name,
        triggerKind: "common",
        effect,
        message: `${card.name}'s loyalty ability is on the stack.`
      };
      window.setTimeout(() => queueCommonTriggers([trigger]), 0);
      return;
    }

    void consultRulesAdvisor("loyalty_ability", seatId, { ...card, oracleText: abilityText });
  }

  // Rule 111.7-111.9: an emblem has no physical card and, once created, lasts the rest of the game
  // — it just gets appended to the controller's emblem list, never removed by anything short of the
  // game ending. From here on its own text is scanned for triggers the same way a permanent's is
  // (see phaseTriggeredCards/emblemsWithPhaseTrigger and applyDeterministicPhaseTrigger's emblem
  // branch), independent of whatever ability originally granted it.
  function grantEmblem(seatId: string, sourceName: string, clauses: string[]) {
    setSession((current) => addEmblemToSeat(current, seatId, sourceName, clauses));
  }

  function castCommander(seatId: string, position?: { x: number; z: number }) {
    const seat = session.seats.find((item) => item.id === seatId);
    const commander = seat?.board.commander;
    if (!seat || !commander) return;
    playCard(seatId, commander.id, position, "command");
  }

  function resolveMyriadLandscape(seatId: string, cardId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    setInspectedCard(undefined);
    if (!seat || !card) return;
    if (card.tapped) {
      addEvent(`${card.name} is tapped and cannot activate its search ability.`, seatId, "Rules action");
      return;
    }
    const totalCost = 2;
    // Myriad Landscape's own {T} is a separate cost component of this same ability (302.6) — it must
    // stay untapped to pay that, so it can't also be tapped as one of the 2 generic mana sources
    // (moot for the pool path below: this function already bailed out above if the card itself were
    // tapped, so its own mana can never be sitting in the floating pool at this point).
    const costCard = genericCostShim(totalCost);
    const pool = poolForSeat(seatId);
    const poolPayment = payCostFromPool(pool, costCard, totalCost);
    const payment = poolPayment.ok ? poolPayment : chooseManaSourcesForCost(seat, costCard, totalCost, cardId, session.seats);
    const availableMana = poolPayment.ok ? manaPoolTotal(pool) : selectedManaTotal(seat, payment.sourceIds);
    if (!payment.ok) {
      addEvent(cannotPayMessage(seat, costCard, availableMana, totalCost, payment.reason), seatId, "Mana");
      return;
    }
    if (poolPayment.ok) {
      setSeatManaPool(seatId, poolPayment.pool);
      clearManaContributions(seatId);
    } else {
      setSession((current) => ({
        ...current,
        seats: current.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item))
      }));
    }
    setMyriadSearch({ seatId, sourceCardId: cardId });
  }

  function chooseMyriadLandscapeTapMana() {
    const choice = myriadTapChoice;
    setMyriadTapChoice(undefined);
    if (!choice) return;
    tapForMana(choice.seatId, choice.cardId, "battlefield", "C");
  }

  function chooseMyriadLandscapeSearch() {
    const choice = myriadTapChoice;
    setMyriadTapChoice(undefined);
    if (!choice) return;
    resolveMyriadLandscape(choice.seatId, choice.cardId);
  }

  // Agents have no interactive land-picker, so they auto-resolve the search the same way
  // basic-land fetches already do for them (chooseBestBasicLandPairForMyriad).
  function activateMyriadLandscapeForAgent(seatId: string, cardId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    if (!seat || !card || card.tapped) return;
    const totalCost = 2;
    const payment = chooseManaSourcesForCost(seat, genericCostShim(totalCost), totalCost, cardId, session.seats);
    if (!payment.ok) return;
    const pair = chooseBestBasicLandPairForMyriad(seat);
    if (pair.length !== 2) return;
    setSession((current) => {
      const spentSeats = current.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item));
      return resolveMyriadLandscapeSearch({ ...current, seats: spentSeats }, seatId, cardId, pair.map((item) => item.id));
    });
  }

  function resolveBasicLandFetch(seatId: string, cardId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    setInspectedCard(undefined);
    if (!seat || !card || !isBasicLandFetchAbility(card)) return;
    if (basicLandFetchCostRequiresTap(card) && card.tapped) {
      addEvent(`${card.name} is tapped and cannot activate its fetch ability.`, seatId, "Rules action");
      return;
    }
    const options = getBasicLandFetchOptions(seat.library ?? []);
    if (options.length === 0) {
      addEvent(`${seat.name} has no basic lands to find with ${card.name}.`, seatId, "Rules action");
      return;
    }
    // Wayfarer's Bauble-style "{2}, {T}, Sacrifice ...: Search..." has a real generic-mana
    // component that this whole system never used to pay at all (it was modeled only on Evolving
    // Wilds' plain "{T}, Sacrifice ...", which costs 0 here) — paid up front, same "pay first, then
    // open the picker" order as resolveMyriadLandscape, so a human who can't afford it gets a clear
    // message instead of picking a land only to have nothing happen.
    const manaCost = basicLandFetchManaCost(card);
    if (manaCost > 0) {
      const costCard = genericCostShim(manaCost);
      const pool = poolForSeat(seatId);
      const poolPayment = payCostFromPool(pool, costCard, manaCost);
      const payment = poolPayment.ok ? poolPayment : chooseManaSourcesForCost(seat, costCard, manaCost, cardId, session.seats);
      const availableMana = poolPayment.ok ? manaPoolTotal(pool) : selectedManaTotal(seat, payment.sourceIds);
      if (!payment.ok) {
        addEvent(cannotPayMessage(seat, costCard, availableMana, manaCost, payment.reason), seatId, "Mana");
        return;
      }
      if (poolPayment.ok) {
        setSeatManaPool(seatId, poolPayment.pool);
        clearManaContributions(seatId);
      } else {
        setSession((current) => ({
          ...current,
          seats: current.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item))
        }));
      }
    }
    setBasicLandFetchSearch({ seatId, sourceCardId: cardId, sourceCardName: card.name });
  }

  // Agent counterpart to resolveBasicLandFetch — pays the same {2}-if-any generic mana cost, then
  // auto-picks a basic land the same way resolveBasicLandFetchSearch always has for agents (no
  // chosenCardId).
  function activateBasicLandFetchForAgent(seatId: string, cardId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    if (!seat || !card || !isBasicLandFetchAbility(card)) return;
    const manaCost = basicLandFetchManaCost(card);
    const payment = manaCost > 0 ? chooseManaSourcesForCost(seat, genericCostShim(manaCost), manaCost, cardId, session.seats) : undefined;
    if (manaCost > 0 && !payment?.ok) return;
    setSession((current) => {
      const spentSeats = payment?.ok ? current.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item)) : current.seats;
      return resolveBasicLandFetchSearch({ ...current, seats: spentSeats }, seatId, cardId);
    });
  }

  function completeBasicLandFetch(cardId: string) {
    const activeSearch = basicLandFetchSearch;
    if (!activeSearch) return;
    setSession((current) => resolveBasicLandFetchSearch(current, activeSearch.seatId, activeSearch.sourceCardId, cardId));
    setBasicLandFetchSearch(undefined);
  }

  function completeMyriadLandscape(cardIds: string[]) {
    const activeSearch = myriadSearch;
    if (!activeSearch) return;
    setSession((current) => resolveMyriadLandscapeSearch(current, activeSearch.seatId, activeSearch.sourceCardId, cardIds));
    setMyriadSearch(undefined);
  }

  function startLibraryLook(
    mode: LibraryLookMode,
    count: number,
    allowedCardFilter?: string,
    drawCountAfter?: number,
    restDestination?: "bottom" | "graveyard",
    // Portent looks at ANOTHER player's library.
    targetSeatId?: string,
    shuffleOfferSource?: string
  ) {
    // setLibraryLook must not be called from inside setSession's updater (React may invoke that
    // updater more than once, and other setState calls inside it are unreliable) — computed against
    // the current session directly instead, mirroring every other modal-opening call in this file.
    // Reproduced live as Diabolic Vision's "look at the top 5, pick one" window never opening at
    // all: the event log line this same call also wrote could still show up (the returned session
    // object was still correct), while the actual look-window state silently never stuck.
    const seat = session.seats.find((item) => item.id === (targetSeatId ?? humanSeat.id));
    const cards = (seat?.library ?? []).slice(0, mode === "scry" ? 1 : count);
    setLibraryLook({
      seatId: targetSeatId ?? humanSeat.id,
      ...(shuffleOfferSource ? { shuffleOfferSource } : {}),
      mode,
      cards,
      remaining: count,
      orderedCards: mode === "reorder" ? [] : undefined,
      allowedCardFilter,
      restDestination,
      drawCountAfter
    });
    addEvent(
      mode === "scry"
        ? `${humanSeat.name} starts scry ${count}.`
        : mode === "reorder"
          ? `${humanSeat.name} looks at the top ${cards.length} card${cards.length === 1 ? "" : "s"} and will put them back in any order.`
          : mode === "choose_one_bottom"
            ? `${humanSeat.name} looks at the top ${cards.length} card${cards.length === 1 ? "" : "s"}, may reveal a ${allowedCardFilter ?? "matching"} card to hand, and will put the rest ${restDestination === "graveyard" ? "into the graveyard" : "on the bottom"}.`
            : `${humanSeat.name} looks at the top ${cards.length} card${cards.length === 1 ? "" : "s"} to ${mode}.`,
      humanSeat.id
    );
  }

  // "Look at the top five cards of your library. As many times as you choose, you may pay 1 life,
  // put those cards on the bottom of your library in any order, then look at the top five cards of
  // your library. Then shuffle and put the last cards you looked at this way on top in any order."
  // (Lim-Dûl's Vault) — the deterministic rules-advisor explicitly declines this shape as an
  // unmodeled repeatable loop (see rulesAdvisor.ts's "as many times as you choose" check), which
  // left it doing nothing at all for a human caster. This trio of functions (start/repeat/keep)
  // implements the loop as its own interactive flow instead. The "any order" on the bottom-placed
  // cards each repeat is simplified to "same order they were looked at in" — asking for a fresh
  // reorder every single repeat would make the loop far more tedious than the card itself; the
  // meaningful choice (what ends up on top at the end) still gets the real reorder step via
  // keepLimDulVaultCards handing off to the existing "reorder" mode.
  function startLimDulVaultLook(seatId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const cards = (seat?.library ?? []).slice(0, 5);
    setLibraryLook({ seatId, mode: "vault_look", cards, remaining: cards.length });
    addEvent(
      `${seat?.name ?? "Player"} looks at the top ${cards.length} card${cards.length === 1 ? "" : "s"} of their library (Lim-Dûl's Vault).`,
      seatId
    );
  }

  function repeatLimDulVault() {
    const activeLook = libraryLook;
    if (!activeLook || activeLook.mode !== "vault_look" || activeLook.cards.length === 0) return;
    const seatId = activeLook.seatId;
    // Paying the last point of life would eliminate the player; refuse rather than let a misclick end the game.
    const payingSeat = session.seats.find((item) => item.id === seatId);
    if (payingSeat && payingSeat.life <= 1) {
      addEvent(`${payingSeat.name} can't afford to pay 1 life for Lim-Dûl's Vault without losing the game.`, seatId, "Rules action");
      return;
    }
    const lookedAtIds = new Set(activeLook.cards.map((card) => card.id));
    setSession((current) => {
      const seat = current.seats.find((item) => item.id === seatId);
      if (!seat) return current;
      const rest = (seat.library ?? []).filter((card) => !lookedAtIds.has(card.id));
      return {
        ...current,
        seats: current.seats.map((item) => (item.id === seatId ? { ...item, life: item.life - 1, library: [...rest, ...activeLook.cards] } : item)),
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId,
            message: `${seat.name} pays 1 life, puts those cards on the bottom of their library, and looks at the next 5 (Lim-Dûl's Vault).`,
            detail: "Rules action"
          },
          ...current.events
        ]
      };
    });
    const seat = session.seats.find((item) => item.id === seatId);
    // The bottomed cards are part of the library again, so a library of five or fewer shows the same cards a second time.
    const nextCards = [...(seat?.library ?? []).filter((card) => !lookedAtIds.has(card.id)), ...activeLook.cards].slice(0, 5);
    setLibraryLook({ seatId, mode: "vault_look", cards: nextCards, remaining: nextCards.length });
  }

  function keepLimDulVaultCards() {
    const activeLook = libraryLook;
    if (!activeLook || activeLook.mode !== "vault_look") return;
    const seatId = activeLook.seatId;
    const keptIds = new Set(activeLook.cards.map((card) => card.id));
    setSession((current) => {
      const seat = current.seats.find((item) => item.id === seatId);
      if (!seat) return current;
      const shuffledRest = shuffleCards((seat.library ?? []).filter((card) => !keptIds.has(card.id)));
      return {
        ...current,
        // The kept cards stay on top (in looked-at order) until the human orders them, so closing the dialog early can't lose them.
        seats: current.seats.map((item) => (item.id === seatId ? { ...item, library: [...activeLook.cards, ...shuffledRest] } : item)),
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId,
            message: `${seat.name} shuffles their library (Lim-Dûl's Vault).`,
            detail: "Rules action"
          },
          ...current.events
        ]
      };
    });
    if (activeLook.cards.length === 0) {
      setLibraryLook(undefined);
      return;
    }
    setLibraryLook({ seatId, mode: "reorder", cards: activeLook.cards, remaining: activeLook.cards.length, orderedCards: [] });
    addEvent(
      `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} will put those ${activeLook.cards.length} card${activeLook.cards.length === 1 ? "" : "s"} back on top in any order (Lim-Dûl's Vault).`,
      seatId
    );
  }

  // destination: the per-pick zone override for Dina's Guidance-style choose_card_from_library
  // choices (see PendingRuleChoice.destinationChoices/chosenDestinations) — undefined for every
  // ordinary single-destination search, which just falls back to `choice.destination` as before.
  function chooseRuleLibraryCard(cardId: string, destination?: "hand" | "graveyard" | "battlefield") {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_card_from_library") return;
    const chosenCardIds = [...(choice.chosenCardIds ?? []), cardId];
    // Kodama's Reach / Cultivate (split destination): the first find goes wherever the player said, the second gets the other zone.
    const firstSplitDestination = choice.splitDestination && choice.chosenCardIds?.length ? choice.chosenDestinations?.[choice.chosenCardIds[0]] : undefined;
    const effectiveDestination = destination ?? (firstSplitDestination ? (firstSplitDestination === "battlefield" ? "hand" : "battlefield") : undefined);
    const chosenDestinations = effectiveDestination ? { ...(choice.chosenDestinations ?? {}), [cardId]: effectiveDestination } : choice.chosenDestinations;
    // Protean Hulk-style total-mana-value budget: finish on its own once nothing else fits.
    const controllerLibrary = session.seats.find((item) => item.id === choice.controllerSeatId)?.library ?? [];
    const remainingBudget = remainingLibraryTotalManaValue({ totalManaValueLimit: choice.totalManaValueLimit, chosenCardIds }, controllerLibrary);
    const budgetExhausted =
      remainingBudget !== undefined &&
      searchableLibraryCards(controllerLibrary.filter((card) => !chosenCardIds.includes(card.id)), { ...choice, remainingTotalManaValue: remainingBudget }).length === 0;
    if (chosenCardIds.length >= choice.maxChoices || budgetExhausted) {
      completeRuleChoice({ ...choice, chosenDestinations }, chosenCardIds);
      return;
    }
    // "Up to N" (Archaeomancer's Map's "up to two basic Plains cards," ...) — keep the search open
    // for further picks instead of finalizing after the first one, which used to cap every
    // multi-card search at exactly one card regardless of maxChoices.
    setPendingRuleChoice({ ...choice, chosenCardIds, chosenDestinations });
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
  // false when there's nothing to ask (no spec for this effect, the controller isn't human, or 0/1
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
    if (pool.length <= 1) return false;
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
        startLibraryLook("reorder", choice.pending.count, undefined, undefined, undefined, target.seatId, choice.pending.offerShuffle ? choice.sourceCardName : undefined);
      }
      return;
    }
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

  // Human resolution for choose_creature_to_sacrifice_for_cast — the human already picked which
  // creature to sacrifice as an additional cost; this just replays whichever of playCard/
  // respondWithCard originally opened the choice (resumeVia), now with preChosenSacrificeTargets
  // set so that function's own interception check short-circuits and casting proceeds normally with
  // the chosen creature threaded straight through to beginPendingAction. See
  // choose_creature_to_sacrifice_for_cast's own doc comment for why this has to happen before the
  // spell goes on the stack rather than after, unlike most other interactive choices in this file.
  function chooseCreatureToSacrificeForCast(seatId: string, cardId: string) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_creature_to_sacrifice_for_cast") return;
    const seat = session.seats.find((item) => item.id === seatId);
    const chosenCard = seat?.board.battlefield.find((item) => item.id === cardId);
    if (!seat || !chosenCard || !matchesAdditionalSacrificeType(chosenCard, choice.sacrificeType ?? "creature")) return;
    setPendingRuleChoice(undefined);
    if (choice.resumeVia === "playCard") {
      playCard(choice.controllerSeatId, choice.sourceCardId, choice.position, choice.sourceZone, choice.faceIndex, [chosenCard]);
    } else {
      respondWithCard(choice.sourceCardId, choice.sourceZone === "command" || choice.sourceZone === "graveyard" || choice.sourceZone === "library" ? "hand" : choice.sourceZone, [chosenCard], undefined, choice.faceIndex);
    }
  }

  // Human resolution for choose_modal_option — the human already picked which mode; a destroy/
  // exile/bounce mode needs a further target choice (chained into choose_effect_target — the same
  // general single-target gate a plain cast removal spell uses, so Cankerbloom's destroy/exile
  // targeting gets the same board-ring UI), a proliferate mode needs the "choose any number" choice
  // (chained into choose_proliferate_targets), and every other mode (destroy_all/
  // destroy_all_conditional/damage/mass_damage) has no target to choose at all, so it just applies
  // immediately via the same applyRemovalEffect the deterministic/agent path already uses for those
  // shapes.
  function completeCastX(index: number) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_cast_x") return;
    setPendingRuleChoice(undefined);
    const value = choice.options[index]?.value ?? 0;
    const resume = choice.resume;
    setSession((current) => ({
      ...current,
      seats: current.seats.map((item) => (item.id === resume.seatId ? { ...item, board: { ...item.board, hand: item.board.hand.map((card) => (card.id === resume.cardId ? { ...card, chosenCastX: value } : card)) } } : item))
    }));
    window.setTimeout(() => playCard(resume.seatId, resume.cardId, resume.position, resume.sourceZone, resume.faceIndex, resume.sacrificeTargets), 50);
  }

  function completeCastCopy(index: number) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_cast_copy") return;
    setPendingRuleChoice(undefined);
    const picked = choice.options[index]?.cardId ?? "none";
    const resume = choice.resume;
    setSession((current) => ({
      ...current,
      seats: current.seats.map((item) => (item.id === resume.seatId ? { ...item, board: { ...item.board, hand: item.board.hand.map((card) => (card.id === resume.cardId ? { ...card, chosenCopyTargetId: picked } : card)) } } : item))
    }));
    window.setTimeout(() => playCard(resume.seatId, resume.cardId, resume.position, resume.sourceZone, resume.faceIndex, resume.sacrificeTargets), 50);
  }

  // The human picked which half of a split / Adventure card to cast: replay the cast naming that half.
  function completeCastFace(index: number) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_cast_face") return;
    const picked = choice.options[index];
    if (!picked) return;
    setPendingRuleChoice(undefined);
    const resume = choice.resume;
    window.setTimeout(() => {
      if (resume.via === "playCard") playCard(resume.seatId, resume.cardId, resume.position, resume.sourceZone, picked.faceIndex, resume.sacrificeTargets);
      else respondWithCard(resume.cardId, resume.sourceZone, undefined, undefined, picked.faceIndex);
    }, 0);
  }

  function completeCastAlt(index: number) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_cast_alt") return;
    setPendingRuleChoice(undefined);
    const resume = choice.resume;
    window.setTimeout(() => playCard(resume.seatId, resume.cardId, resume.position, resume.sourceZone, resume.faceIndex, resume.sacrificeTargets, undefined, index === 0 ? "alt" : "normal"), 0);
  }

  function openCastPrompt(
    prompt: NonNullable<ReturnType<typeof nextCastPrompt>>,
    base: { planCard: VisibleCard; chosenX?: number; answers: CastChoices; resume: Extract<PendingRuleChoice, { kind: "choose_cast_targets" }>["resume"] }
  ) {
    const options = prompt.options.map((option) => ("mode" in option ? { label: option.label, mode: option.mode } : { label: option.label, target: option.target }));
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "choose_cast_targets",
      controllerSeatId: base.resume.via === "playCard" ? base.resume.seatId : humanSeat.id,
      sourceCardId: base.planCard.id,
      sourceCardName: base.planCard.name,
      planCard: base.planCard,
      chosenX: base.chosenX,
      prompt: prompt.prompt,
      promptKind: prompt.kind,
      options,
      answers: { modes: base.answers.modes ? [...base.answers.modes] : undefined, modesDone: base.answers.modesDone, targets: [...base.answers.targets] },
      resume: base.resume
    });
  }

  // One answer to a cast-time question; asks the next one, or replays the cast with every answer attached.
  function completeCastPrompt(index: number) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_cast_targets") return;
    const option = choice.options[index];
    if (!option) return;
    const answers: CastChoices = { modes: [...(choice.answers.modes ?? [])], modesDone: choice.answers.modesDone, targets: [...choice.answers.targets] };
    if (choice.promptKind === "modes" && option.mode === -1) answers.modesDone = true;
    else if (choice.promptKind === "modes" && option.mode !== undefined) answers.modes!.push(option.mode);
    else if (option.target) answers.targets.push(option.target);
    if (!answers.modes?.length) delete answers.modes;
    const next = nextCastPrompt(session, choice.controllerSeatId, choice.planCard, choice.chosenX, answers);
    if (next) {
      openCastPrompt(next, { planCard: choice.planCard, chosenX: choice.chosenX, answers, resume: choice.resume });
      return;
    }
    setPendingRuleChoice(undefined);
    const resume = choice.resume;
    window.setTimeout(() => {
      if (resume.via === "playCard") playCard(resume.seatId, resume.cardId, resume.position, resume.sourceZone, resume.faceIndex, resume.sacrificeTargets, answers, resume.altChoice);
      else respondWithCard(resume.cardId, resume.sourceZone, resume.sacrificeTargets, answers, resume.faceIndex);
    }, 0);
  }

  // One answer to a labeled target list; reopens for the next slot, or runs the spell's effect once the last one is in.
  function completeLabeledTarget(index: number) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_labeled_target") return;
    const option = choice.slots[choice.slotIndex]?.options[index];
    if (!option) return;
    const picks = [...choice.picks, option.target];
    if (choice.slotIndex + 1 < choice.slots.length) {
      setPendingRuleChoice({ ...choice, id: crypto.randomUUID(), slotIndex: choice.slotIndex + 1, picks });
      return;
    }
    setPendingRuleChoice(undefined);
    setSession((current) => applyLabeledContinuation(current, choice.controllerSeatId, choice.sourceCard, choice.continuation, picks));
  }

  // One mode pick of a multi-mode spell; asks again until chooseCount modes are chosen, then applies them together.
  function completeSpellMode(index: number) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_spell_modes" || choice.picked.includes(index) || index < 0 || index >= choice.labels.length) return;
    const picked = [...choice.picked, index];
    const total = (choice.removalModes ?? choice.genericModes ?? []).length;
    if (picked.length < choice.chooseCount && picked.length < total) {
      setPendingRuleChoice({ ...choice, id: crypto.randomUUID(), picked });
      return;
    }
    setPendingRuleChoice(undefined);
    setSession((current) => {
      if (choice.removalModes) {
        const modes = picked.map((pick) => choice.removalModes![pick]);
        return applyRemovalEffect(current, choice.controllerSeatId, choice.sourceCardName, choice.sourceCard, { kind: "modal", chooseCount: modes.length, modes }, choice.chosenX);
      }
      const modes = picked.map((pick) => choice.genericModes![pick]);
      return applyGenericModalEffect(current, choice.controllerSeatId, choice.sourceCard, { chooseCount: modes.length, modes, distinctPerTurn: choice.distinctPerTurn });
    });
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
      if (options.length >= 2) {
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
      if (yours.length >= 2) {
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

    addEvent(`Rules choice reviewed for ${choice.sourceCardName}.`, choice.controllerSeatId, "Rules advisor");
    setPendingRuleChoice(undefined);
  }

  function completeDiscardChoice(cardIds: string[]) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "discard_to_hand_size") return;
    completeRuleChoice(choice, cardIds);
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
    addEvent(`${seat.name} orders ${session.phase} triggers: ${triggers.map((trigger) => trigger.sourceCardName).join(" -> ")}.`, seatId, "Rules advisor");
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
      addEvent(`No rule choice was made for ${ruleChoiceLabel(pendingRuleChoice)}.`, pendingRuleChoice.controllerSeatId, "Rules advisor");
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
      addEvent(cannotPayMessage(seat, card, selectedManaTotal(seat, payment.sourceIds), choice.miracleCost, payment.reason), seat.id, "Rules advisor");
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
      addEvent(`${session.seats.find((seat) => seat.id === choice.controllerSeatId)?.name ?? "Player"} declines to cast ${choice.sourceCardName} for its miracle cost.`, choice.controllerSeatId, "Rules advisor");
    }
    setPendingRuleChoice(undefined);
  }

  function resolveAgentRuleChoice(choice: PendingRuleChoice) {
    const seat = session.seats.find((item) => item.id === choice.controllerSeatId);
    if (!seat) return;
    if (choice.kind === "choose_card_from_library") {
      // "Up to N" (Archaeomancer's Map's "up to two basic Plains cards," ...) — loop for as many as
      // maxChoices allows rather than always picking just one, excluding each already-chosen card
      // object so a search with only one legal match left still stops cleanly instead of re-picking
      // the same card twice.
      const chosen: VisibleCard[] = [];
      const chosenIds = new Set<string>();
      for (let i = 0; i < choice.maxChoices; i += 1) {
        // Protean Hulk-style total-mana-value budget: take the most expensive creature that still fits, until nothing does.
        if (choice.totalManaValueLimit !== undefined) {
          const remaining = choice.totalManaValueLimit - chosen.reduce((sum, picked) => sum + picked.manaValue, 0);
          const fits = searchableLibraryCards((seat.library ?? []).filter((candidate) => !chosenIds.has(candidate.id)), { ...choice, remainingTotalManaValue: remaining });
          const best = fits.reduce<VisibleCard | undefined>((top, candidate) => (!top || candidate.manaValue > top.manaValue ? candidate : top), undefined);
          if (!best) break;
          chosen.push(best);
          chosenIds.add(best.id);
          continue;
        }
        const card = chooseAgentLibraryCardForRuleChoice(seat, choice, chosenIds, chosen, session.seats);
        if (!card) break;
        chosen.push(card);
        chosenIds.add(card.id);
      }
      if (chosen.length === 0) {
        addEvent(`${seat.name} searches their library for ${choice.allowedCardFilter && !/^cards?( matching the source effect)?$/i.test(choice.allowedCardFilter) ? `a ${choice.allowedCardFilter} card` : "a card"} (${choice.sourceCardName}) but finds nothing to reveal, then shuffles.`, seat.id, "Rules advisor");
        setSession((current) => ({ ...current, seats: current.seats.map((item) => (item.id === seat.id ? { ...item, library: shuffleCards(item.library ?? []) } : item)) }));
        setPendingRuleChoice(undefined);
        return;
      }
      addEvent(`${seat.name} chooses ${chosen.map((card) => card.name).join(", ")} for ${choice.sourceCardName}.`, seat.id, "Rules advisor");
      completeRuleChoice(choice, chosen.map((card) => card.id));
      return;
    }
    if (choice.kind === "order_triggers") {
      const ordered = [...choice.orderedTriggers, ...choice.triggers];
      setPendingRuleChoice(undefined);
      resolveOrderedPhaseTriggers(choice.controllerSeatId, ordered);
      return;
    }
    if (choice.kind === "miracle_offer") {
      const card = seat.board.hand.find((item) => item.id === choice.sourceCardId);
      const payment = card ? chooseManaSourcesForCost(seat, card, choice.miracleCost, undefined, session.seats) : undefined;
      if (card && payment?.ok) {
        acceptMiracleOffer();
        return;
      }
      declineMiracleOffer();
      return;
    }
    if (choice.kind === "optional_trigger") {
      // Deterministic accept-by-default heuristic, matching how every other agent rule-choice
      // here is decided without an LLM round-trip — most "you may" effects are beneficial, and the
      // trigger-chain circuit breaker (see resolveTriggerEffect) is what actually protects against
      // an unbounded loop, not this choice. A more deliberate agent policy (e.g. stop after N
      // self-copies even though it still could) would need real judgment and is future work.
      // An optional effect that COSTS life (Savra: "you may pay 2 life. If you do, each other player sacrifices a creature") is only worth
      // it while the agent is healthy and an opponent actually has a creature to lose.
      if (choice.trigger.effect.kind === "lose_life" && choice.trigger.effect.then) {
        const lifeCost = choice.trigger.effect.amount;
        const opponentHasCreature = session.seats.some((other) => other.id !== seat.id && !other.hasLost && other.board.battlefield.some((card) => card.typeLine.includes("Creature")));
        if (seat.life - lifeCost < 10 || !opponentHasCreature) {
          addEvent(`${seat.name} declines ${choice.sourceCardName}'s optional effect (not worth ${lifeCost} life right now).`, seat.id, "Rules advisor");
          setPendingRuleChoice(undefined);
          finishTriggerResolution(choice.trigger, choice.remainingStack, false);
          return;
        }
      }
      addEvent(`${seat.name} chooses to do ${choice.sourceCardName}'s optional effect.`, seat.id, "Rules advisor");
      setPendingRuleChoice(undefined);
      finishTriggerResolution(choice.trigger, choice.remainingStack, true);
      return;
    }
    if (choice.kind === "optional_primitive_plan") {
      // Same accept-by-default heuristic as optional_trigger just above, for the LLM-fallback
      // path's equivalent "you may" choice.
      setPendingRuleChoice(undefined);
      setSession((current) => applyPrimitiveActionPlan(current, choice.controllerSeatId, choice.sourceCard, choice.steps));
      addEvent(`${seat.name}: ${choice.prompt.replace(/ Do you want to\?$/, "")}.`, seat.id, "Rules advisor (primitive plan)");
      return;
    }
    if (choice.kind === "discard_to_hand_size") {
      // Same "highest mana value first" heuristic chooseWorstHandCardToDiscard already uses for
      // discard-cost activated abilities, generalized to pick N cards instead of just one.
      let hand = seat.board.hand;
      const discardIds: string[] = [];
      for (let count = 0; count < choice.requiredDiscards && hand.length > 0; count += 1) {
        const worst = hand.reduce((current, card) => (card.manaValue > current.manaValue ? card : current));
        discardIds.push(worst.id);
        hand = hand.filter((card) => card.id !== worst.id);
      }
      completeRuleChoice(choice, discardIds);
      return;
    }
    if (choice.kind === "put_cards_on_library") {
      // Same "highest mana value first" heuristic as discard_to_hand_size above.
      let hand = seat.board.hand;
      const putBackIds: string[] = [];
      for (let count = 0; count < choice.requiredCount && hand.length > 0; count += 1) {
        const worst = hand.reduce((current, card) => (card.manaValue > current.manaValue ? card : current));
        putBackIds.push(worst.id);
        hand = hand.filter((card) => card.id !== worst.id);
      }
      completePutCardsOnLibrary(putBackIds);
      return;
    }
    if (choice.kind === "connive_discard") {
      const worst = chooseWorstHandCardToDiscard(seat);
      completeConniveDiscard(worst ? [worst.id] : []);
      return;
    }
    if (choice.kind === "return_land_to_hand") {
      const land = chooseLandToReturn(seat, choice.sourceCardId);
      completeReturnLandToHand(land ? [land.id] : []);
      return;
    }
    if (choice.kind === "choose_permanent_to_blink") {
      const target = choosePermanentToBlink(seat, choice.sourceCardId);
      completeChoosePermanentToBlink(target ? [target.id] : []);
      return;
    }
    if (choice.kind === "manual_review") {
      const source = seat.board.battlefield.find((card) => card.id === choice.sourceCardId);
      // Cumulative upkeep previously had no agent-specific handling at all — it fell all the way
      // through to "passes manual review" below, which neither pays the cost nor sacrifices the
      // permanent, just dismisses the choice and leaves the card sitting there with its upkeep
      // unpaid and unresolved. Mirrors the human's own payCumulativeUpkeep/sacrificeRuleChoiceSource
      // decision with a simple, deterministic "pay if affordable" heuristic, matching how every
      // other optional-cost decision in this file is made without needing an LLM judgment call.
      if (source && isCumulativeUpkeepCard(source)) {
        const cost = cumulativeUpkeepCost(source);
        const payment = chooseManaSourcesForCost(seat, genericCostShim(cost), cost, undefined, session.seats);
        if (payment.ok) {
          setSession((current) => ({
            ...current,
            seats: current.seats.map((item) =>
              item.id === seat.id
                ? spendManaSources(
                    { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === source.id ? applyCounterDelta(card, "age", 1) : card)) } },
                    payment.sourceIds
                  )
                : item
            ),
            events: [
              {
                id: crypto.randomUUID(),
                at: new Date().toISOString(),
                seatId: seat.id,
                message: `${seat.name} pays ${source.name}'s cumulative upkeep for ${cost} mana and adds an age counter.`,
                detail: "Rules advisor"
              },
              ...current.events
            ]
          }));
        } else {
          addEvent(`${seat.name} can't pay ${source.name}'s cumulative upkeep and sacrifices it.`, seat.id, "Rules advisor");
          setSession((current) => moveCardBetweenVisibleZones(current, seat.id, source.id, "graveyard"));
        }
        setPendingRuleChoice(undefined);
        return;
      }
    }
    addEvent(`${seat.name} passes manual review for ${choice.sourceCardName}.`, seat.id, "Rules advisor");
    setPendingRuleChoice(undefined);
  }

  function searchLibraryCardToHand(cardId: string) {
    setSession((current) => {
      const seat = current.seats.find((item) => item.id === humanSeat.id);
      const card = seat?.library?.find((item) => item.id === cardId);
      if (!seat || !card) return current;
      return {
        ...current,
        seats: current.seats.map((item) =>
          item.id === humanSeat.id
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
            seatId: humanSeat.id,
            message: `${humanSeat.name} searches their library for ${card.name} and puts it into hand.`
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
        controllerSeatId: humanSeat.id,
        sourceCardId: stub.id,
        sourceCardName: activeLook.shuffleOfferSource,
        prompt: `${activeLook.shuffleOfferSource}: have ${targetName} shuffle their library?`,
        options: [{ index: 0, label: "Shuffle" }, { index: 1, label: "Don't shuffle" }],
        trigger: makeCommonTrigger(humanSeat.id, humanSeat.id, stub, { kind: "shuffle_library", seatId: activeLook.seatId }, `${activeLook.shuffleOfferSource}: shuffle option.`),
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
    setLibraryLook({ seatId: activeLook.seatId, mode: "reorder", cards: remainingCards, remaining: remainingCards.length, orderedCards: [] });
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

  // A permanent whose only function is producing mana (a land or a mana rock, not a creature and
  // not equipment) doesn't need the card inspector at all — tapping it for mana is the only thing
  // there is to decide, so a single click should just do it (or open the color-choice modal
  // toggleTapCard already shows for multi-color sources), instead of requiring the hidden hover +
  // "T" keyboard shortcut to discover that tapping is even possible.
  function isSimpleManaSourcePermanent(card: VisibleCard, seat: PlayerSeat) {
    // A card with a SECOND real ability that also costs {T} isn't "simple" — besides tapping for
    // mana it has something else worth choosing (a generic sacrifice ability like Mind Stone's "{1},
    // {T}, Sacrifice this artifact: Draw a card," a generic tap ability, or a land-fetch ability
    // requiring {T}), so a bare click can't just auto-resolve to the mana tap; it needs the inspector
    // so that other ability is actually reachable (see the dedicated Myriad Landscape branch above,
    // and toggleTapCard's own matching dispatch check below, for the same shape).
    // Used to special-case only Myriad Landscape by name, which meant Mind Stone's identically-shaped
    // sacrifice ability was silently unreachable by mouse click — reported live: clicking it (or
    // right-clicking) always just tapped it for mana, with no way to ever reach the sacrifice-draw
    // ability once it was already tapped.
    return (
      !card.typeLine.includes("Creature") &&
      !isEquipment(card) &&
      isAvailableManaSource(card, seat, session.seats) &&
      !parseGenericSacrificeAbilities(abilityOracleText(card)).some((ability) => ability.costTap) &&
      parseGenericTapAbilities(abilityOracleText(card)).length === 0 &&
      !(isBasicLandFetchAbility(card) && basicLandFetchCostRequiresTap(card))
    );
  }

  function handleInspectCard(card: VisibleCard) {
    const ownerSeat = session.seats.find((seat) => seat.board.battlefield.some((item) => item.id === card.id));
    // A battlefield click hands this function whatever card object was baked into the 3D mesh's
    // userData at the last scene rebuild (keyed off tableRenderKey) — that can lag one render behind
    // the real session state (e.g. its tapped flag), unlike the "T" hotkey's toggleTapCard, which
    // already re-reads the card straight from session and never had this problem. Re-resolving to
    // the live battlefield card here (falling back to the passed-in one for non-battlefield cards,
    // e.g. hand clicks, which are plain DOM-rendered and never go stale) keeps every check below, and
    // the inspector modal itself, in sync with what's actually on the table right now.
    const liveCard = ownerSeat?.board.battlefield.find((item) => item.id === card.id) ?? card;
    if (ownerSeat?.id === humanSeat.id && liveCard.name === "Myriad Landscape" && !liveCard.tapped) {
      // Only offer the choice when the search ability is actually payable (2 generic, from mana
      // already floating in the pool OR from sources other than this land itself); otherwise
      // there's nothing to choose between, so just tap for the colorless mana like any other simple
      // mana source. Checking the pool first matches resolveMyriadLandscape's own payment order —
      // without it, a human with 2 mana already floating (and no OTHER untapped source left to
      // auto-tap) never got offered the search choice at all, since chooseManaSourcesForCost alone
      // has no concept of already-floating mana.
      const searchCostShim = genericCostShim(2);
      if (payCostFromPool(poolForSeat(ownerSeat.id), searchCostShim, 2).ok || chooseManaSourcesForCost(ownerSeat, searchCostShim, 2, liveCard.id, session.seats).ok) {
        setMyriadTapChoice({ seatId: ownerSeat.id, cardId: liveCard.id, cardName: liveCard.name });
      } else {
        tapForMana(ownerSeat.id, liveCard.id, "battlefield", "C");
      }
      return;
    }
    if (ownerSeat?.id === humanSeat.id && isSimpleManaSourcePermanent(liveCard, humanSeat)) {
      toggleTapCard(humanSeat.id, liveCard.id, "battlefield");
      return;
    }
    setInspectedCard(liveCard);
  }

  function toggleTapCard(seatId: string, cardId: string, location: "battlefield" | "command") {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = location === "command" ? seat?.board.commander : seat?.board.battlefield.find((item) => item.id === cardId);
    // Same special-case as handleInspectCard's dedicated Myriad Landscape branch, needed here too
    // since the "T" keyboard shortcut (see ThreeGameTable's setMovementKey) calls this function
    // directly, bypassing handleInspectCard entirely — without this, that shortcut always just
    // tapped Myriad Landscape for colorless mana with no way to ever reach its search ability.
    if (seatId === humanSeat.id && location === "battlefield" && card?.name === "Myriad Landscape" && !card.tapped && seat) {
      // Same pool-first check as handleInspectCard's own Myriad Landscape branch above (this
      // shortcut bypasses that one entirely, so it needs its own copy of the fix too).
      const searchCostShim = genericCostShim(2);
      if (payCostFromPool(poolForSeat(seatId), searchCostShim, 2).ok || chooseManaSourcesForCost(seat, searchCostShim, 2, card.id, session.seats).ok) {
        setMyriadTapChoice({ seatId, cardId, cardName: card.name });
      } else {
        tapForMana(seatId, cardId, "battlefield", "C");
      }
      return;
    }
    // Generalizes the Myriad Landscape case above to every other permanent whose {T} is (also) the
    // cost of a real non-mana activated ability — a generic sacrifice ability like Wayfarer's
    // Bauble's "{2}, {T}, Sacrifice: search for a basic land," a generic tap ability like Retrofitter
    // Foundry's, or Mind Stone's "{1}, {T}, Sacrifice this artifact: Draw a card." Deliberately NOT
    // gated on "isn't a mana source" (it used to be, which is exactly what let this fall through to
    // the mana-tap branch below for a card that's BOTH a plain mana rock AND has this second ability
    // — reported live: pressing the "T" hotkey on Mind Stone always just tapped it for {C}, with no
    // way to ever reach the sacrifice-draw ability). Routes to the same card inspector a click
    // already opens instead, so the human gets an actual choice of what to activate — including
    // still tapping for mana, since the inspector shows that option too whenever it applies.
    if (
      seatId === humanSeat.id &&
      location === "battlefield" &&
      seat &&
      card &&
      !card.tapped &&
      (parseGenericSacrificeAbilities(abilityOracleText(card)).some((ability) => ability.costTap) ||
        parseGenericTapAbilities(abilityOracleText(card)).length > 0 ||
        (isBasicLandFetchAbility(card) && basicLandFetchCostRequiresTap(card)))
    ) {
      setInspectedCard(card);
      return;
    }
    if (seat && card && !card.tapped && isAvailableManaSource(card, seat, session.seats)) {
      if (location === "battlefield" && tapSignet(seatId, cardId)) return;
      const choices = manaChoicesForCard(card, seat, session.seats);
      if (choices.length > 1) {
        setManaChoice({ seatId, cardId, cardName: card.name, location, choices });
        return;
      }
      tapForMana(seatId, cardId, location, choices[0] ?? "C");
      return;
    }

    if (card?.tapped) {
      removeManaContribution(seatId, cardId);
    }

    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) => {
        if (seat.id !== seatId) return seat;
        const nextCommander =
          location === "command" && seat.board.commander?.id === cardId
            ? { ...seat.board.commander, tapped: !seat.board.commander.tapped }
            : seat.board.commander;
        const nextBattlefield =
          location === "battlefield"
            ? seat.board.battlefield.map((card) => (card.id === cardId ? { ...card, tapped: !card.tapped } : card))
            : seat.board.battlefield;

        return {
          ...seat,
          board: {
            ...seat.board,
            commander: nextCommander,
            battlefield: nextBattlefield
          }
        };
      })
    }));
    setInspectedCard((current) => (current?.id === cardId ? { ...current, tapped: !current.tapped } : current));
  }

  // A dedicated "tap for mana" entry point for the card inspector's own button (see CardInspector's
  // onTapForMana below) — needed because toggleTapCard's mana branch is no longer reachable at all
  // for a card that ALSO has another {T}-cost ability (Mind Stone, ...), since that shape now always
  // routes to the inspector instead (see toggleTapCard's own comment). Without this, fixing the
  // "can't reach Mind Stone's sacrifice ability" bug would have traded it for a new one: no longer
  // being able to just tap such a card for mana at all. Battlefield-only (unlike toggleTapCard/
  // tapForMana's shared "battlefield" | "command" location) since a card sitting in the command zone
  // isn't a permanent yet and can't produce mana regardless.
  function tapPermanentForMana(seatId: string, cardId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    if (!seat || !card || card.tapped || !isAvailableManaSource(card, seat, session.seats)) return;
    if (tapSignet(seatId, cardId)) return;
    const choices = manaChoicesForCard(card, seat, session.seats);
    if (choices.length > 1) {
      setManaChoice({ seatId, cardId, cardName: card.name, location: "battlefield", choices });
      return;
    }
    tapForMana(seatId, cardId, "battlefield", choices[0] ?? "C");
  }

  // Izzet Signet and friends: pay the {N} from mana already in the pool, then add one of each color (it used to ask for ONE color and add it twice, free).
  function tapSignet(seatId: string, cardId: string): boolean {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    const signet = card ? signetAbility(effectiveManaOracleText(card)) : undefined;
    if (!seat || !card || !signet) return false;
    if (card.tapped || !isAvailableManaSource(card, seat, session.seats)) return true;
    const pool = manaPools[seatId] ?? emptyManaPool();
    const paid = signet.generic > 0 ? payCostFromPool(pool, genericCostShim(signet.generic), signet.generic) : { ok: true as const, pool };
    if (!paid.ok) {
      addEvent(`${card.name} needs {${signet.generic}} first: tap a land (or another source) so the mana is in your pool, then tap ${card.name}.`, seatId, "Mana");
      return true;
    }
    let next = paid.pool;
    for (const symbol of signet.symbols) next = addManaToPool(next, symbol, 1);
    setManaPools((current) => ({ ...current, [seatId]: next }));
    for (const symbol of signet.symbols) addManaContribution(seatId, cardId, symbol, 1);
    setSession((current) => tapVisibleCard(current, seatId, cardId, "battlefield"));
    addEvent(`${seat.name} pays {${signet.generic}} and taps ${card.name} for ${signet.symbols.map((symbol) => "{" + symbol + "}").join("")}.`, seatId, "Mana");
    setInspectedCard((current) => (current?.id === cardId ? { ...current, tapped: true } : current));
    setManaChoice(undefined);
    return true;
  }

  function tapForMana(seatId: string, cardId: string, location: "battlefield" | "command", color: ManaColor) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = location === "command" ? seat?.board.commander : seat?.board.battlefield.find((item) => item.id === cardId);
    if (!seat || !card || card.tapped || !isAvailableManaSource(card, seat, session.seats)) return;
    if (location === "battlefield" && signetAbility(effectiveManaOracleText(card)) && tapSignet(seatId, cardId)) return;
    // A Treasure (or any "{T}, Sacrifice this: Add ...") is used up by tapping it, and a storage land loses its counter - the automatic payment
    // already did this through spendManaSources; a manual tap only ever tapped it, so Treasures stayed on the battlefield.
    const consumedOnUse = location === "battlefield" && (isSacrificeManaSource(card) || manaAbilityCounterRemovalKind(card.oracleText) !== undefined);
    setSession((current) =>
      consumedOnUse ? { ...current, seats: current.seats.map((item) => (item.id === seatId ? spendManaSources(item, [cardId]) : item)) } : tapVisibleCard(current, seatId, cardId, location)
    );
    const amount = manaProducedBy(card, seat);
    setManaPools((current) => {
      const pool = current[seatId] ?? emptyManaPool();
      return { ...current, [seatId]: addManaToPool(pool, color, amount) };
    });
    addManaContribution(seatId, cardId, color, amount);
    addEvent(`${seat.name} taps ${card.name} for ${amount > 1 ? amount : ""}${color}.`, seatId, "Mana");
    setInspectedCard((current) => (current?.id === cardId ? { ...current, tapped: true } : current));
    setManaChoice(undefined);
  }

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
      />
    );
  }

  return (
    <main className="app-shell game-shell">
      {session.status === "complete" && !gameOverDismissed ? (
        <GameOverDialog session={session} gameStarting={gameStarting} setupMessage={setupMessage} onPlayAgain={startGame} onDismiss={() => setGameOverDismissed(true)} onBackToSetup={() => setMode("setup")} />
      ) : null}
      <button className="game-back-button" type="button" onClick={() => setMode("setup")} aria-label="Back to setup">
        ×
      </button>
      <button
        className="game-save-button"
        type="button"
        onClick={saveGameNow}
        disabled={!currentCleanSaveStopStatus().ok}
        title={currentCleanSaveStopStatus().reason ?? "Save this game"}
      >
        Save
      </button>
      <ThreeGameTable
        stackPrompts={stackPrompts}
        stackFeed={stackFeed}
        requiredPasses={requiredPassesForPanel}
        priorityPasses={priorityPasses}
        choiceMinimized={choiceMinimized}
        onSetChoiceMinimized={setChoiceMinimized}
        gameStage={gameStage}
        humanMulligans={mulligans[humanSeat.id] ?? 0}
        mulliganReturnCardIds={mulliganReturnCardIds}
        mulliganReturnRequired={Math.max(0, humanSeat.board.hand.length - openingHandKeepSize(mulligans[humanSeat.id] ?? 0))}
        session={tableSession}
        prioritySeatId={prioritySeatId}
        pendingAction={pendingAction ? withPendingActionSourceCard(session, pendingAction, stackActions) : undefined}
        stackActions={stackActions.map((action) => withPendingActionSourceCard(session, action, stackActions))}
        agentThinking={agentThinking}
        agentReasoning={agentReasoning}
        manaPool={poolForSeat(humanSeat.id)}
        manaChoice={manaChoice?.seatId === humanSeat.id ? manaChoice : undefined}
        myriadTapChoice={myriadTapChoice?.seatId === humanSeat.id ? myriadTapChoice : undefined}
        blockChoice={blockChoiceView(session, blockChoice)}
        selectedCardCanRespond={selectedCardCanRespond}
        selectedCardFaceOptions={selectedCardFaceOptions}
        onPlayCardFace={(seatId, cardId, faceIndex) => playCard(seatId, cardId, undefined, "hand", faceIndex)}
        onKeepHand={keepOpeningHand}
        onMulligan={mulliganOpeningHand}
        onToggleMulliganReturnCard={toggleMulliganReturnCard}
        onAdvanceTurn={advanceTurn}
        onEndTurn={endTurn}
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
        onOpenLibrarySearch={() => setManualLibrarySearch({ seatId: humanSeat.id, destination: "hand" })}
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
        onActivateSelfUntap={activateSelfUntapAbility}
        onActivateGenericMana={activateGenericManaAbility}
        onActivateEquip={activateEquip}
        onActivateManlandAnimation={activateManlandAnimation}
        onChangeLife={changeLife}
        libraryLook={libraryLook}
        ruleChoice={ruleChoiceView(pendingRuleChoice, humanSeat, manualLibrarySearch, session)}
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
        myriadSearchCards={myriadSearch ? getMyriadLandscapeOptions(humanSeat.library ?? []) : undefined}
        basicLandFetchSearch={
          basicLandFetchSearch
            ? {
                sourceCardName: basicLandFetchSearch.sourceCardName,
                cards: getBasicLandFetchOptions(humanSeat.library ?? [])
              }
            : undefined
        }
        onCloseLibrarySearch={() => {
          setManualLibrarySearch(undefined);
          if (pendingRuleChoice?.controllerSeatId === humanSeat.id) cancelRuleChoice();
        }}
        onChooseNextTrigger={chooseNextUpkeepTrigger}
        onSearchLibraryCardToHand={(cardId, destination) => {
          if (pendingRuleChoice?.controllerSeatId === humanSeat.id) {
            chooseRuleLibraryCard(cardId, destination);
            return;
          }
          searchLibraryCardToHand(cardId);
        }}
        onFinishLibrarySearch={finishRuleLibrarySearch}
        onCloseMyriadSearch={() => setMyriadSearch(undefined)}
        onCompleteMyriadSearch={completeMyriadLandscape}
        onCloseBasicLandFetchSearch={() => setBasicLandFetchSearch(undefined)}
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
        onChooseMana={(color) => manaChoice && tapForMana(manaChoice.seatId, manaChoice.cardId, manaChoice.location, color)}
        onCancelManaChoice={() => setManaChoice(undefined)}
        onChooseMyriadTapMana={chooseMyriadLandscapeTapMana}
        onChooseMyriadTapSearch={chooseMyriadLandscapeSearch}
        onCancelMyriadTapChoice={() => setMyriadTapChoice(undefined)}
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
