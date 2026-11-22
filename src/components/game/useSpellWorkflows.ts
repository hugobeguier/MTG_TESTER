// Deterministic spell/ability workflows (draw / scry / surveil / library search) and the attack-tax static-effect reader.
// Part of the AppFlow() split: shared state arrives through `ctx` (see ./context.ts); handlers owned by other hooks are called through `lateFn` so every hook sees the current render's functions.
// There is no LLM in this path any more (the Rules Advisor was removed, see docs/rules-advisor-removal.md): a card whose text deterministicRuleWorkflow does not recognise is simply not resolved here.
import { type ChosenTarget, type TargetSpec } from "@/lib/targeting";
import { type InterpretedEffect, type VisibleCard } from "@/lib/types";
import { type LibraryLookMode } from "@/engine/flowTypes";
import { type RuleWorkflow, deterministicRuleWorkflow } from "@/lib/rulesAdvisor";
import { surveilBonusForSeat } from "@/engine/oneShotEffects";
import { chooseBestBasicLandPairForMyriad, resolveMyriadLandscapeSearch } from "@/engine/etb";
import { drawMultipleForSeat, resolveAgentLibraryLookWorkflow, resolveProliferate } from "@/engine/effects";
import { deterministicAttackTax } from "@/lib/staticEffects";
import { shouldConsultRulesAdvisor } from "@/engine/priority";
import { handExcludingStack } from "@/lib/stackedCards";
import { findUnresolvedClauses, reportUnresolvedForCard } from "@/engine/unresolved";
import { useUnresolvedPoster } from "./useUnresolvedPoster";
import { type GameContext, lateFn } from "./context";

export function useSpellWorkflows(ctx: GameContext) {
  const { session, setSession, setInspectedCard } = ctx;
  const { setPendingRuleChoice, setMyriadSearch } = ctx.choices;
  const addEvent = lateFn(ctx, "addEvent");
  const maybeRequestTarget = lateFn(ctx, "maybeRequestTarget");
  const startLibraryLook = lateFn(ctx, "startLibraryLook");

  useUnresolvedPoster(ctx);

  // "Never fail silently": logs "Couldn't resolve: <card> - <clause>" for every clause of `sourceCard` no deterministic parser recognises (see engine/unresolved.ts).
  function reportUnresolved(event: string, seatId: string, sourceCard: VisibleCard) {
    try {
      if (findUnresolvedClauses(sourceCard, event).length === 0) return;
      setSession((current) => reportUnresolvedForCard(current, seatId, sourceCard, event));
    } catch {
      /* diagnostics must never break resolution */
    }
  }

  // Resolves the draw/scry/surveil/search shapes deterministicRuleWorkflow recognises; anything else is left to the other deterministic systems; clauses none of them recognise are reported as unresolved.
  function consultRulesAdvisor(event: string, seatId: string, sourceCard: VisibleCard, _castTargets?: ChosenTarget[]) {
    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat) return;
    // The spell-resolution path reports on its own (it knows what the other parsers already handled); these events always come through here.
    if (event === "land_played" || event === "saga_chapter" || event === "loyalty_ability") reportUnresolved(event, seatId, sourceCard);
    if (!sourceCard.oracleText.trim() || !shouldConsultRulesAdvisor(event, sourceCard)) return;
    const deterministic = deterministicRuleWorkflow({
      event,
      actorName: seat.name,
      sourceCard,
      battlefield: seat.board.battlefield,
      hand: handExcludingStack(seat, session.stackSpellCardIds), // a spell on the stack isn't in hand (601.2a)
      graveyard: seat.board.graveyard ?? [],
      exile: seat.board.exile ?? [],
      libraryPreview: (seat.library ?? []).slice(0, 12).map((card) => ({ id: card.id, name: card.name, typeLine: card.typeLine, oracleText: card.oracleText }))
    });
    if (deterministic) applyRuleWorkflow(seatId, sourceCard, deterministic);
  }

  function applyRuleWorkflow(seatId: string, sourceCard: VisibleCard, workflow: RuleWorkflow) {
    if (workflow.workflow === "none") return;

    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat) return;
    const isHuman = seat.kind === "human";
    addEvent(`${workflow.summary || `${sourceCard.name} needs manual review (no summary returned).`}`, seatId, "Rules");

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
        addEvent(`${seat.name} has no valid basic land pair to find for ${sourceCard.name}.`, seatId, "Rules");
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
  // Runs once when a permanent enters the battlefield: reads static abilities that tax attacking (Propaganda-style effects) so the result can be cached on the card and enforced deterministically thereafter.
  function consultStaticEffectInterpreter(seatId: string, card: VisibleCard) {
    const effect = deterministicAttackTax(card.id, card.name, card.oracleText);
    if (effect) applyInterpretedEffect(seatId, card.id, effect);
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
          message: `Attack tax: ${effect.sourceCardName} taxes attackers ${
            effect.formula === "enchantment_count" ? "{1} per enchantment its controller controls" : `{${effect.amountPerAttacker}}`
          } per attacking creature.`,
          detail: "Rules"
        },
        ...current.events
      ]
    }));
  }

  return { consultRulesAdvisor, consultStaticEffectInterpreter, reportUnresolved };
}
