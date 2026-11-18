// Bridges to the Rules Advisor / primitive-action planner / static-effect interpreter (LLM fallbacks) and applies their workflows.
// Part of the AppFlow() split: shared state arrives through `ctx` (see ./context.ts); handlers owned by other hooks are called through `lateFn` so every hook sees the current render's functions.
import { AGENT_REQUEST_TIMEOUT_MS, logAdvisorUse, primitiveActionPlanCache, ruleWorkflowCache, ruleWorkflowCacheKey, saveRuleWorkflowCache } from "@/lib/agentRuntime";
import { type ChosenTarget, type TargetSpec } from "@/lib/targeting";
import { type InterpretedEffect, type VisibleCard } from "@/lib/types";
import { type LibraryLookMode } from "@/engine/flowTypes";
import { type PrimitiveActionPlan, type PrimitiveActionStep } from "@/lib/primitiveActionPlan";
import { type RuleWorkflow, deterministicRuleWorkflow, eventRelevantOracleText } from "@/lib/rulesAdvisor";
import { applyPrimitiveActionPlan, surveilBonusForSeat } from "@/engine/oneShotEffects";
import { chooseBestBasicLandPairForMyriad, resolveMyriadLandscapeSearch } from "@/engine/etb";
import { drawMultipleForSeat, resolveAgentLibraryLookWorkflow, resolveProliferate } from "@/engine/effects";
import { isBoardConditionMet } from "@/engine/mana";
import { looksLikeAttackTaxCandidate } from "@/lib/staticEffects";
import { shouldConsultRulesAdvisor } from "@/engine/priority";
import { type GameContext, lateFn } from "./context";

export function useRulesAdvisor(ctx: GameContext) {
  const { session, setSession, setInspectedCard } = ctx;
  const { setRulesAdvisorPending } = ctx.agent;
  const { setPendingRuleChoice, setMyriadSearch } = ctx.choices;
  const addEvent = lateFn(ctx, "addEvent");
  const checkMiracleAfterDraw = lateFn(ctx, "checkMiracleAfterDraw");
  const maybeRequestTarget = lateFn(ctx, "maybeRequestTarget");
  const startLibraryLook = lateFn(ctx, "startLibraryLook");

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
          lookWorkflow === "look_at_top_cards_reveal_type_to_hand" ? workflow.restDestination : undefined,
          undefined,
          undefined,
          seatId
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

  return { consultRulesAdvisor, consultStaticEffectInterpreter };
}
