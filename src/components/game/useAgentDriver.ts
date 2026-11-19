// The LLM/heuristic agent driver: requestAgentDecision, per-situation decide* functions, applying agent actions, agent-side rule-choice and trigger answers, thinking/reasoning bookkeeping.
// Part of the AppFlow() split: shared state arrives through `ctx` (see ./context.ts); handlers owned by other hooks are called through `lateFn` so every hook sees the current render's functions.
import { AGENT_REQUEST_TIMEOUT_MS } from "@/lib/agentRuntime";
import { type AgentAction, type AgentReasoning, type GameSession, type PlayerSeat, type VisibleCard } from "@/lib/types";
import { type BlockChoiceState, type LegalAgentAction } from "@/engine/flowTypes";
import { type PendingAction, type PendingRuleChoice, type TurnPhase } from "@/engine/types";
import { adjustedCastingCost, maxAffordableX, totalCastingCost } from "@/engine/costs";
import { agentCastTimeRemovalChoices, castModeLabels, stackTargetText } from "@/engine/castTargets";
import { applyCounterDelta, findExiledCardAnySeat, moveCardBetweenVisibleZones, shuffleCards } from "@/engine/zones";
import { applyPrimitiveActionPlan, searchableLibraryCards } from "@/engine/oneShotEffects";
import { assignBlockers, canAttack, clearCombatState, forcedAttackers, legalAttackActions, legalBlockActions } from "@/engine/combat";
import { buildAgentDecisionContext, pendingActionRequiredPasses, pendingActionSummary } from "@/engine/priority";
import { canCastAtInstantSpeed, seatHasFlashGrant } from "@/engine/casting";
import { cannotPayMessage, chooseManaSourcesForCost, manaPoolTotal, selectedManaTotal, spendManaSources, spentManaColors } from "@/engine/mana";
import { checkMoveLegal, cumulativeUpkeepCost, fallbackLegalAction, hasAgentMainPhaseAction, isCumulativeUpkeepCard, isPendingActionLikelyIrrelevantToSeat, legalMainPhaseActions, legalPriorityActions } from "@/engine/legalActions";
import { chooseAgentLibraryCardForRuleChoice, chooseWorstHandCardToDiscard, genericCostShim } from "@/engine/effects";
import { chooseLandToReturn, choosePermanentToBlink, resolveEquip, seatVerb } from "@/engine/abilities";
import { decideWithGate } from "@/lib/moveLegality";
import { effectiveMaxHandSize, isMainPhase, phaseTriggeredCards } from "@/engine/turnFlow";
import { evaluateOpeningHand } from "@/lib/mulliganHeuristics";
import { parseCounterSpellAbility } from "@/lib/counterSpells";
import { phaseEvent } from "@/engine/triggers";
import { summarizeSituation } from "@/lib/agentLessons";
import { type GameContext, lateFn } from "./context";

export function useAgentDriver(ctx: GameContext) {
  const { session, setSession, activeSeatId, prioritySeatId, setPrioritySeatId, setSelectedHandCardId, latestSessionRef, humanSeat } = ctx;
  const { agentMainActions, agentDecisionRequests, setAgentThinking, setAgentReasoning, agentStatedPlans, agentCastAttempts, agentBannedCasts, agentDecisionInfo } = ctx.agent;
  const { libraryLook, manualLibrarySearch, pendingRuleChoice, setPendingRuleChoice, blockChoice, basicLandFetchSearch } = ctx.choices;
  const { manaPools } = ctx.mana;
  const { pendingAction, setPendingAction, stackActions, stackStore, priorityPasses, setPriorityPasses, priorityStopSettings, holdPriorityOnce } = ctx.stack;
  const { loyaltyActivationsThisTurn, pendingEndTurnAfterDiscard } = ctx.turn;
  const acceptMiracleOffer = lateFn(ctx, "acceptMiracleOffer");
  const activateBasicLandFetchForAgent = lateFn(ctx, "activateBasicLandFetchForAgent");
  const activateGenericManaAbility = lateFn(ctx, "activateGenericManaAbility");
  const activateGenericSacrificeAbility = lateFn(ctx, "activateGenericSacrificeAbility");
  const activateGenericTapAbility = lateFn(ctx, "activateGenericTapAbility");
  const activateLoyaltyAbility = lateFn(ctx, "activateLoyaltyAbility");
  const activateManlandAnimation = lateFn(ctx, "activateManlandAnimation");
  const activateMyriadLandscapeForAgent = lateFn(ctx, "activateMyriadLandscapeForAgent");
  const activateSelfUntapAbility = lateFn(ctx, "activateSelfUntapAbility");
  const addEvent = lateFn(ctx, "addEvent");
  const advanceTurn = lateFn(ctx, "advanceTurn");
  const applyCastingCostPaymentSideEffect = lateFn(ctx, "applyCastingCostPaymentSideEffect");
  const beginPendingAction = lateFn(ctx, "beginPendingAction");
  const beginTriggerResolution = lateFn(ctx, "beginTriggerResolution");
  const clearAllManaPools = lateFn(ctx, "clearAllManaPools");
  const completeChoosePermanentToBlink = lateFn(ctx, "completeChoosePermanentToBlink");
  const completeConniveDiscard = lateFn(ctx, "completeConniveDiscard");
  const completePutCardsOnLibrary = lateFn(ctx, "completePutCardsOnLibrary");
  const completeReturnLandToHand = lateFn(ctx, "completeReturnLandToHand");
  const completeRuleChoice = lateFn(ctx, "completeRuleChoice");
  const cycleCard = lateFn(ctx, "cycleCard");
  const declareAttack = lateFn(ctx, "declareAttack");
  const declineMiracleOffer = lateFn(ctx, "declineMiracleOffer");
  const finishTriggerResolution = lateFn(ctx, "finishTriggerResolution");
  const hasPlayedLandThisTurn = lateFn(ctx, "hasPlayedLandThisTurn");
  const passPriority = lateFn(ctx, "passPriority");
  const payCastingCost = lateFn(ctx, "payCastingCost");
  const playCard = lateFn(ctx, "playCard");
  const removeStackAction = lateFn(ctx, "removeStackAction");
  const resolveEndTurn = lateFn(ctx, "resolveEndTurn");
  const resolveOrderedPhaseTriggers = lateFn(ctx, "resolveOrderedPhaseTriggers");
  const unlockRoomDoor = lateFn(ctx, "unlockRoomDoor");

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
      setPrioritySeatId(seatId); // 117.3a: the active player keeps priority entering the end step
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
      const required = pendingActionRequiredPasses(session.seats, actionOnStack, activeSeatId, session, manaPools, priorityStopSettings, holdPriorityOnce ? humanSeat.id : undefined, undefined, stackActions);
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

  function markAgentThinking(seatId: string, thinking: boolean) {
    setAgentThinking((current) => ({ ...current, [seatId]: thinking }));
  }

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

  return { decideAgentAttackers, decideAgentBlockAction, decideAgentPriorityAction, decideAgentTurnAction, fastForwardAgentToEndStep, markAgentThinking, recordAgentReasoning, requestAgentDecision, resolveAgentRuleChoice, shouldAgentFastForwardToEndStep };
}
