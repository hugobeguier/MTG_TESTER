// The game's useEffect blocks, kept together and in their original relative order (React runs effects in definition order).
// Triggers/state-based-action detection, phase timers, agent scheduling, token-art loading, etc. Mostly calls handlers from the other game/ hooks via ctx.late.
// Part of the AppFlow() split: shared state arrives through `ctx` (see ./context.ts); handlers owned by other hooks are called through `lateFn` so every hook sees the current render's functions.
import { BRAIDS_TYPE_FILTER, commonTriggerEffect, findCommonTriggersForPermanentEntered, isMerenEndStepEffect, makeCommonTrigger, phaseConditionBlocks, phaseEffectText, takeInitiative } from "@/engine/triggers";
import { type CardImageUris, type ManaColor, type VisibleCard } from "@/lib/types";
import { type PendingAction, type TurnPhase } from "@/engine/types";
import { type RemovalEffect, parseRemovalEffect } from "@/lib/removalSpells";
import { TURN_PHASES, stopKey } from "@/lib/priorityStops";
import { type TargetSpec, legalTargets } from "@/lib/targeting";
import { UNDERCITY_ROOM_NAMES, UNDERCITY_ROOM_TEXT, isUndercityRoom } from "@/lib/undercity";
import { type ZoneEffect } from "@/lib/zoneEffects";
import { addManaToPool } from "@/engine/mana";
import { agentPaceMs } from "@/lib/agentRuntime";
import { applyEndStepEffects, effectiveMaxHandSize, isReanimateFromAnyGraveyardPhaseTrigger, makePhaseStackTrigger, phaseEventName, phaseTriggeredCards, planOffTurnPhaseTriggers, resolveEndStepExileDamage, scheduleDelayedPhaseTrigger, targetCreatureCounterPhaseTrigger } from "@/engine/turnFlow";
import { applyRemovalEffect, applyZoneEffect } from "@/engine/effects";
import { cardsLeaveGraveyardEffectText, etbEffectText } from "@/lib/oracleClauses";
import { chooseFreeCastCard, markHandCardFreeCastable } from "@/engine/casting";
import { createCombatBlockChoice, legalAttackActions } from "@/engine/combat";
import { enchantRestriction, isAura, isRemovalStyleAura } from "@/lib/attachments";
import { findAnyCombatDamageToOpponentTriggers, findAttackTriggers, findCardsLeftGraveyardTriggers, findCombatDamageToPlayerTriggers, findCommonTriggersForPermanentDied, findEntersBatchWatcherTriggers, findLeavesBattlefieldTriggers, findLifeGainTriggers, findMultiAttackTriggers, findPutIntoGraveyardTriggers, findSacrificeWatcherTriggers, lifeGainReplacementBonus } from "@/engine/triggerFinders";
import { findCardAnywhere } from "@/engine/castTargets";
import { findEmblemGraveyardReturns, isBraidsEndStepText, parseEtbZoneEffect } from "@/engine/oneShotEffects";
import { handCardsOfTypes, isSagaCard, loreCounterCount } from "@/engine/etb";
import { isCumulativeUpkeepCard } from "@/engine/legalActions";
import { isLandCard } from "@/engine/shared";
import { moveCommanderToCommandZone, rulesEvent } from "@/engine/zones";
import { needsTokenArt, tokenArtLookupKey } from "@/lib/tokenArt";
import { remoteSeatCanAct, priorityStopsForSeat } from "@/lib/multiplayer/remoteSeatPolicy";
import { nextPrioritySeatId, pendingActionRequiredPasses, yieldMomentFor } from "@/engine/priority";
import { yieldAutoPasses } from "@/engine/yieldPolicy";
import { removalEffectTargetSpec, zoneEffectTargetSpec } from "@/lib/targetSpecs";
import { seatVerb } from "@/engine/abilities";
import { useEffect } from "react";
import { type GameContext, lateFn } from "./context";

export function useGameEffects(ctx: GameContext) {
  const { mode, session, setSession, activeSeatId, prioritySeatId, setPrioritySeatId, gameStage: liveGameStage, configs, autoValidatedDefaultDeck, humanSeat } = ctx;
  // Paused for a disconnected friend (multiplayer): every effect below treats the game as "not playing", so nothing advances until they are back.
  const gameStage = ctx.mpPausedFor.length > 0 ? ("paused" as const) : liveGameStage;
  const { rulesAdvisorPending, agentDecisionRequests } = ctx.agent;
  const { libraryLook, manualLibrarySearch, pendingRuleChoice, setPendingRuleChoice, blockChoice, setBlockChoice, basicLandFetchSearch, pendingOrderedTriggerResume, commanderZoneChoiceAsked, auraRetargetAsked } = ctx.choices;
  const { manaPools, restrictedManaBatches } = ctx.mana;
  const { pendingAction, stackActions, priorityPasses, priorityStopSettings, holdPriorityOnce } = ctx.stack;
  const { phaseTriggersChecked, cleanupDiscardChecked, cleanupRestrictedManaChecked, processedDeathBatchRef, processedEntryBatchRef, processedLeaveBatchRef, processedCombatDamageToPlayerBatchRef, processedGraveyardDepartureBatchRef, emblemWatchPrevious, tokenArtCache, tokenArtInFlight, tokenArtVersion, setTokenArtVersion, monarchDrawChecked, exileDamageChecked, lifeWatchRef, processedBlockBatchRef, processedAttackBatchRef } = ctx.turn;
  const addEvent = lateFn(ctx, "addEvent");
  const advanceTurn = lateFn(ctx, "advanceTurn");
  const applySagaEntryLoreCounter = lateFn(ctx, "applySagaEntryLoreCounter");
  const buildDeck = lateFn(ctx, "buildDeck");
  const clearRestrictedManaForSeat = lateFn(ctx, "clearRestrictedManaForSeat");
  const consultRulesAdvisor = lateFn(ctx, "consultRulesAdvisor");
  const continueOrderedPhaseTriggers = lateFn(ctx, "continueOrderedPhaseTriggers");
  const decideAgentAttackers = lateFn(ctx, "decideAgentAttackers");
  const decideAgentBlockAction = lateFn(ctx, "decideAgentBlockAction");
  const decideAgentPriorityAction = lateFn(ctx, "decideAgentPriorityAction");
  const decideAgentTurnAction = lateFn(ctx, "decideAgentTurnAction");
  const fastForwardAgentToEndStep = lateFn(ctx, "fastForwardAgentToEndStep");
  const markAgentThinking = lateFn(ctx, "markAgentThinking");
  const openCumulativeUpkeepChoice = lateFn(ctx, "openCumulativeUpkeepChoice");
  const openHumanPhaseChoice = lateFn(ctx, "openHumanPhaseChoice");
  const openPunisherPrompt = lateFn(ctx, "openPunisherPrompt");
  const playCard = lateFn(ctx, "playCard");
  const poolForSeat = lateFn(ctx, "poolForSeat");
  const queueCommonTriggers = lateFn(ctx, "queueCommonTriggers");
  const resolveAgentRuleChoice = lateFn(ctx, "resolveAgentRuleChoice");
  const resolvePendingAction = lateFn(ctx, "resolvePendingAction");
  const resolvePhaseScryOrSurveil = lateFn(ctx, "resolvePhaseScryOrSurveil");
  const setSeatManaPool = lateFn(ctx, "setSeatManaPool");
  const skipRemoteSeatTurn = lateFn(ctx, "skipRemoteSeatTurn");
  const shouldAgentFastForwardToEndStep = lateFn(ctx, "shouldAgentFastForwardToEndStep");

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
  useEffect(() => {
    if (mode !== "game" || gameStage !== "playing" || pendingAction || pendingRuleChoice) return;
    if (session.phase !== "end step" || !session.monarchSeatId || session.monarchSeatId !== activeSeatId) return;
    const key = `${session.turn}:${session.monarchSeatId}`;
    if (monarchDrawChecked.current.has(key)) return;
    monarchDrawChecked.current.add(key);
    const monarchSeatId = session.monarchSeatId;
    setSession((current) => applyEndStepEffects(current, monarchSeatId));
  }, [mode, gameStage, pendingAction, pendingRuleChoice, session.phase, session.turn, session.monarchSeatId, activeSeatId, session.seats]);
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
  useEffect(() => {
    if (pendingAction) return;
    const blocks = session.pendingBlockDeclarations;
    if (!blocks || blocks.length === 0 || blocks === processedBlockBatchRef.current) return;
    processedBlockBatchRef.current = blocks;
    const queued = blocks.flatMap((block) => findAttackTriggers(session, { seatId: block.seatId, card: block.card, defendingSeatId: block.attackerSeatId }, "blocks").triggers);
    setSession((current) => (current.pendingBlockDeclarations === blocks ? { ...current, pendingBlockDeclarations: undefined } : current));
    if (queued.length > 0) queueCommonTriggers(queued);
  }, [session.pendingBlockDeclarations, pendingAction]);
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

  // A friend whose seat cannot act yet (lib/multiplayer/remoteSeatPolicy) would hold the game forever on their own turn (turn 1 untap included): skip it.
  useEffect(() => {
    if (mode !== "game" || gameStage !== "playing" || pendingAction || pendingRuleChoice || libraryLook || manualLibrarySearch || blockChoice) return;
    const activeSeat = session.seats.find((seat) => seat.id === activeSeatId);
    if (!activeSeat || activeSeat.hasLost || remoteSeatCanAct(activeSeat)) return;
    const key = `remote-skip:${session.turn}:${activeSeat.id}`;
    if (agentDecisionRequests.current.has(key)) return;
    const timer = window.setTimeout(() => {
      agentDecisionRequests.current.add(key);
      skipRemoteSeatTurn(activeSeat.id);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [mode, gameStage, pendingAction, pendingRuleChoice, libraryLook, manualLibrarySearch, blockChoice, session.turn, session.activePlayerId, activeSeatId]);

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
    // The active human seat is the host's own or a remote friend's: each pauses on its OWN stops (a friend's live in priorityStopSettings.bySeat).
    const turnSeat = session.seats.find((seat) => seat.id === activeSeatId);
    if (!turnSeat || turnSeat.kind !== "human") return;
    const turnStops = priorityStopsForSeat(turnSeat, priorityStopSettings, session.seats.indexOf(turnSeat), session.seats.length);
    // A seat on "Yield until end of turn" is auto-advanced through its own turn too (no own-turn stops, not even declare attackers) until the yield ends.
    const yielding = yieldAutoPasses(priorityStopSettings.yields?.[turnSeat.id], yieldMomentFor(turnSeat, undefined, session, activeSeatId, priorityStopSettings, holdPriorityOnce && turnSeat.id === humanSeat.id ? turnSeat.id : undefined));
    if (turnStops.fullControl) return;
    const humanSeatIndex = Math.max(0, session.seats.indexOf(turnSeat));
    if (!yielding && turnStops.phaseStops[stopKey(session.phase, humanSeatIndex)]) return;
    // Footgun guard: an unticked "declare attackers step" would otherwise sail straight past any
    // real attack the human could still declare — there's no pendingAction/choice state guarding
    // that window the way blockChoice/pendingRuleChoice do for defense, since declareAttack mutates
    // the session directly rather than opening one. Stays regardless of the grid so unticking this
    // one cell can't silently make attacking impossible.
    if (session.phase === "declare attackers step" && !yielding) {
      const opponents = session.seats.filter((seat) => seat.id !== turnSeat.id && !seat.hasLost);
      if (legalAttackActions(turnSeat, opponents).length > 0) return;
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
}
