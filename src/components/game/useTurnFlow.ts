// Turn and phase progression: advanceTurn/endTurn/resolvePhaseAdvance, phase actions, saga lore counters and chapters, cumulative upkeep, scry/surveil phase triggers.
// Part of the AppFlow() split: shared state arrives through `ctx` (see ./context.ts); handlers owned by other hooks are called through `lateFn` so every hook sees the current render's functions.
import { type GameSession, type VisibleCard } from "@/lib/types";
import { type PendingAction, type TurnPhase } from "@/engine/types";
import { type SagaChapters, isSagaTransformChapter, parseGainsAbilityGrant, parseSagaChapters } from "@/lib/oracleClauses";
import { TURN_PHASES } from "@/lib/priorityStops";
import { anyPhaseTrigger } from "@/lib/phaseTriggers";
import { applyCounterDelta, applyLoreCounterEtb, moveCardBetweenVisibleZones, rulesEvent } from "@/engine/zones";
import { applyEndStepEffects, clearTemporaryBuffs, effectiveMaxHandSize, hasExtraBeginningPhaseAura, nextSeatForTurn, phaseTriggeredCards, resolvePendingUpkeepDraws, skipsFirstTurnDraw, untapForSeat } from "@/engine/turnFlow";
import { cannotPayMessage, chooseManaSourcesForCost, manaPoolTotal, payCostFromPool, selectedManaTotal, spendManaSources } from "@/engine/mana";
import { chooseReadAheadChapter, loreCounterCount } from "@/engine/etb";
import { cleanupCombat, forcedAttackers, resolveCombatDamage } from "@/engine/combat";
import { commonTriggerEffect, makeCommonTrigger, phaseEffectText, phaseEvent, ventureIntoUndercity } from "@/engine/triggers";
import { cumulativeUpkeepCost, isCumulativeUpkeepCard } from "@/engine/legalActions";
import { drawForSeat, genericCostShim, resolveAgentLibraryLookWorkflow, transformPermanent } from "@/engine/effects";
import { numberWordToInt } from "@/engine/shared";
import { seatVerb } from "@/engine/abilities";
import { surveilBonusForSeat } from "@/engine/oneShotEffects";
import { type GameContext, lateFn } from "./context";

export function useTurnFlow(ctx: GameContext) {
  const { session, setSession, activeSeatId, setActiveSeatId, setPrioritySeatId, setSelectedHandCardId, humanSeat } = ctx;
  const { pendingRuleChoice, setPendingRuleChoice } = ctx.choices;
  const { pendingAction, setPriorityPasses } = ctx.stack;
  const { loyaltyActivationsThisTurn, pendingEndTurnAfterDiscard } = ctx.turn;
  const addEvent = lateFn(ctx, "addEvent");
  const beginPendingAction = lateFn(ctx, "beginPendingAction");
  const clearAllManaPools = lateFn(ctx, "clearAllManaPools");
  const clearManaContributions = lateFn(ctx, "clearManaContributions");
  const consultRulesAdvisor = lateFn(ctx, "consultRulesAdvisor");
  const declareAttack = lateFn(ctx, "declareAttack");
  const poolForSeat = lateFn(ctx, "poolForSeat");
  const queueCommonTriggers = lateFn(ctx, "queueCommonTriggers");
  const setSeatManaPool = lateFn(ctx, "setSeatManaPool");
  const startLibraryLook = lateFn(ctx, "startLibraryLook");

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

  function endTurn(actingSeatId: string = humanSeat.id) {
    if (pendingAction) return;
    const activeSeat = session.seats.find((seat) => seat.id === activeSeatId);
    if (!activeSeat || activeSeat.id !== actingSeatId) return;
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
      setPrioritySeatId(nextSeat.id); // 117.3a: the active player receives priority at the start of each step
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

    setPrioritySeatId(activeSeat.id); // 117.3a
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

  // A friend's seat cannot act yet (remoteSeatsCanAct is false), so its whole turn is skipped by the host the moment it begins: nobody could advance it.
  function skipRemoteSeatTurn(seatId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat) return;
    addEvent(`${seat.name} cannot take actions yet in multiplayer, so their turn is skipped.`, seatId, "Rules action");
    setSelectedHandCardId(undefined);
    setPriorityPasses([]);
    setSession((current) => (current.activePlayerId === seatId ? resolveEndTurn(current, seatId) : current));
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
    setPrioritySeatId(nextSeat.id); // 117.3a
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
      // CR 103.8: the starting player of a two-player game skips the draw of their first turn
      if (skipsFirstTurnDraw(session, seatId)) return rulesEvent(advanceSagaLoreCounters(session, seatId), seatId, `${seat.name} skips their first draw (two-player game).`);
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
      startLibraryLook(mode, count, undefined, undefined, undefined, undefined, undefined, seatId);
    } else {
      setSession((current) => resolveAgentLibraryLookWorkflow(current, seatId, sourceCard.name, mode === "scry" ? "scry_cards" : "surveil_cards", count));
    }
    return true;
  }

  return { skipRemoteSeatTurn, advanceTurn, applySagaEntryLoreCounter, applySagaReadAhead, endTurn, openCumulativeUpkeepChoice, payCumulativeUpkeep, resolveEndTurn, resolvePhaseAdvance, resolvePhaseScryOrSurveil, sacrificeRuleChoiceSource };
}
