// Casting spells and playing cards: drawing, cycling, playCard (the cast pipeline), cast-time prompts (X, copy, face, alt cost, modes, labeled targets), commander casting, loyalty abilities, cast-trigger keywords, graveyard/exile casting.
// Part of the AppFlow() split: shared state arrives through `ctx` (see ./context.ts); handlers owned by other hooks are called through `lateFn` so every hook sees the current render's functions.
import { type CastChoices, type PendingAction, type PendingRuleChoice } from "@/engine/types";
import { type GameSession, type PlayerSeat, type VisibleCard } from "@/lib/types";
import { type ZoneEffect } from "@/lib/zoneEffects";
import { activateGraveyardReturnInSession, findLandRaidTriggers } from "@/engine/triggerFinders";
import { addEmblemToSeat, parseEtbZoneEffect } from "@/engine/oneShotEffects";
import { additionalSacrificeCandidates, applyChosenFaceToCard, canCastAtInstantSpeed, castFaceDecision, castRestrictedByTurnCount, independentlyCastableSpellFaces, matchesAdditionalSacrificeType, modalDoubleFacedLandSplit, pathOfAncestryScries, playCardFromZone, recordCommanderCast, roomDoorFaces, seatHasFlashGrant, spellCastLockedOut, spellFaceCostCard, targetingTax, unlockSecondRoomDoor } from "@/engine/casting";
import { adjustedCastingCost, cardWithFaceManaCost, coloredPipCount, fateDesignLifeAltCostKey, hasFateDesignLifeAltCost, hasOmniscienceFreeHandCast, hasOnceEachTurnFreeHandCastPermission, hasSingleKicker, isHistoricCard, manaValueFromManaCost, maxAffordableX, onceEachTurnFreeCastKey, staticCostReduction, takeMiracleOffer, totalCastingCost, unlockCostReduction, xSymbolCount } from "@/engine/costs";
import { agentCastTimeRemovalChoices, applyLabeledContinuation, castFaceCard, castModeLabels, hasResolvableTarget, modeSetAnswer, nextCastPrompt, stackTargetText } from "@/engine/castTargets";
import { applyChosenColor, applyChosenCreatureType, isSagaCard } from "@/engine/etb";
import { applyCounterDelta, enterAsCopyCandidates, findExiledCardAnySeat, isPlaneswalkerCard, loyaltyCounterCount, parseEnterAsCopyEffect, possessive, shuffleCards } from "@/engine/zones";
import { applyGenericModalEffect, applyRemovalEffect, applyZoneEffect, drawForSeat, resolveAgentLibraryLookWorkflow } from "@/engine/effects";
import { cannotPayMessage, chooseManaSourcesForCost, chooseManaSourcesOrFloating, formatManaPoolPayment, isAvailableManaSource, isDragonMana, manaChoicesForCard, manaPoolTotal, payCostFromPool, selectedManaTotal, spendManaSources, spentManaColors } from "@/engine/mana";
import { checkMoveLegal, formatLoyaltyCost, loyaltyTurnKey } from "@/engine/legalActions";
import { commonTriggerEffect, findCommonTriggersForPermanentEntered, makeCommonTrigger } from "@/engine/triggers";
import { cycleCardInSession, tapCreaturesAltCostFor, zoneChoiceSpecFor } from "@/engine/abilities";
import { etbEffectText, oracleClauses, parseAdditionalDiscardCost, parseAdditionalSacrificeCost, parseEmblemGrant, parseModalHeader } from "@/lib/oracleClauses";
import { findSpellSourceCard } from "@/engine/priority";
import { graveyardCastPermission } from "@/lib/graveyardCasting";
import { hasChooseCreatureTypeEtb, parseChooseColorEtb } from "@/lib/characteristics";
import { hasKeyword, isLandCard } from "@/engine/shared";
import { isMainPhase } from "@/engine/turnFlow";
import { landTurnKey, recordLandPlay } from "@/engine/lands";
import { libraryTopCastPermission } from "@/lib/libraryCasting";
import { parseCycling } from "@/lib/cycling";
import { parseRemovalEffect } from "@/lib/removalSpells";
import { removalEffectTargetSpec, zoneEffectTargetSpec } from "@/lib/targetSpecs";
import { type GameContext, lateFn } from "./context";

export function useCasting(ctx: GameContext) {
  const { session, setSession, activeSeatId, setSelectedHandCardId, humanSeat } = ctx;
  const { setLibraryLook, pendingRuleChoice, setPendingRuleChoice } = ctx.choices;
  const { copyMana, setCopyMana, manaContributions, lastCastManaContributors } = ctx.mana;
  const { pendingAction, stackStore, castDispatchInFlight, CAST_DISPATCH_STALE_MS } = ctx.stack;
  const { landPlaysThisTurn, firstDrawThisTurn, loyaltyActivationsThisTurn } = ctx.turn;
  const addEvent = lateFn(ctx, "addEvent");
  const applySagaEntryLoreCounter = lateFn(ctx, "applySagaEntryLoreCounter");
  const beginPendingAction = lateFn(ctx, "beginPendingAction");
  const clearManaContributions = lateFn(ctx, "clearManaContributions");
  const consultRulesAdvisor = lateFn(ctx, "consultRulesAdvisor");
  const consultStaticEffectInterpreter = lateFn(ctx, "consultStaticEffectInterpreter");
  const hasPlayedLandThisTurn = lateFn(ctx, "hasPlayedLandThisTurn");
  const humanActionBlockedByChoice = lateFn(ctx, "humanActionBlockedByChoice");
  const poolForSeat = lateFn(ctx, "poolForSeat");
  const queueCommonTriggers = lateFn(ctx, "queueCommonTriggers");
  const maybeRequestTarget = lateFn(ctx, "maybeRequestTarget");
  const respondWithCard = lateFn(ctx, "respondWithCard");
  const restrictedManaPoolForSeat = lateFn(ctx, "restrictedManaPoolForSeat");
  const setSeatManaPool = lateFn(ctx, "setSeatManaPool");
  const spendRestrictedMana = lateFn(ctx, "spendRestrictedMana");
  const startLibraryLook = lateFn(ctx, "startLibraryLook");

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
      const restrictedResult = payCostFromPool(restricted, costCard, totalCost, { seat, allSeats: session.seats });
      if (restrictedResult.ok) {
        return { ok: true as const, source: "restricted" as const, sourceIds: [] as string[], pool: undefined, spent: restrictedResult.spent, forCard: costCard };
      }
    }
    if (seat.kind === "human") {
      // life: a Phyrexian pip the pool has no colour for ({G/P}, Birthing Pod) is paid with 2 life; seat: Morophon's coloured-pip reduction.
      const result = payCostFromPool(poolForSeat(seatId), costCard, totalCost, { life: seat.life, seat, allSeats: session.seats });
      return result.ok
        ? { ok: true as const, source: "pool" as const, sourceIds: [] as string[], pool: result.pool, spent: result.spent, lifeCost: "lifeCost" in result ? result.lifeCost : 0 }
        : { ok: false as const, sourceIds: [] as string[], reason: result.reason };
    }
    // An agent's floating mana (a ritual's) pays first when it covers the whole cost; otherwise lands are tapped as before.
    const result = chooseManaSourcesOrFloating(seat, costCard, totalCost, undefined, session.seats);
    if (result.ok && result.floating && result.remaining) {
      return { ok: true as const, source: "floating" as const, sourceIds: [] as string[], pool: result.remaining, spent: result.spent };
    }
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
    } else if (payment.source === "floating") {
      const remaining = payment.pool;
      setSession((current) => ({ ...current, seats: current.seats.map((item) => (item.id === seatId ? { ...item, floatingMana: manaPoolTotal(remaining) > 0 ? remaining : undefined } : item)) }));
    } else if (payment.source === "pool" && payment.pool) {
      setSeatManaPool(seatId, payment.pool);
      clearManaContributions(seatId);
      // Phyrexian mana paid with life (the pool had no {G} for Birthing Pod's {G/P}).
      if (payment.lifeCost > 0) {
        const life = payment.lifeCost;
        setSession((current) => ({ ...current, seats: current.seats.map((item) => (item.id === seatId ? { ...item, life: Math.max(0, item.life - life) } : item)) }));
        addEvent(`${session.seats.find((item) => item.id === seatId)?.name ?? "Player"} pays ${life} life for Phyrexian mana.`, seatId, "Mana");
      }
    }
  }

  function drawCard(seatId: string) {
    const next = drawForSeat(session, seatId, `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} draws a card.`);
    setSession(next);
  }

  // CR 702.94a: the miracle trigger for a player's first card drawn this turn goes on the stack the next time a player would receive priority,
  // after the whole draw effect (and a Brainstorm put-back) finished. useGameEffects calls this once nothing else is mid-resolution; the
  // candidate card (PlayerSeat.drawnThisTurn.miracleCandidateId, set by drawForSeat) must still be in hand. Native "Miracle {cost}" and
  // Aminatou's granted miracle both come through takeMiracleOffer; the offer is a normal pendingRuleChoice (routed to the seat's own snapshot
  // for a remote friend, auto-answered for an AI seat).
  function offerPendingMiracle() {
    const taken = takeMiracleOffer(session);
    if (!taken) return;
    setSession(() => taken.session);
    const offer = taken.offer;
    if (!offer) return;
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "miracle_offer",
      controllerSeatId: offer.seatId,
      sourceCardId: offer.card.id,
      sourceCardName: offer.card.name,
      prompt: offer.granterName
        ? `${offer.granterName} grants miracle. Reveal ${offer.card.name} and cast it for its miracle cost, or it stays in hand at full cost.`
        : `${offer.card.name} has miracle. Reveal it and cast it for its miracle cost, or it stays in hand at full cost.`,
      miracleCost: offer.cost
    });
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
      const clickedSeat = session.seats.find((item) => item.id === seatId);
      const clicked = clickedSeat?.kind === "human" && (sourceZone === "hand" || sourceZone === "exile") ? clickedSeat.board.hand.find((item) => item.id === cardId) : undefined;
      if (clicked && !isLandCard(clicked) && canCastAtInstantSpeed(clicked, seatHasFlashGrant(clickedSeat!, clicked))) {
        respondWithCard(cardId, sourceZone === "exile" ? "exile" : "hand", undefined, undefined, undefined, seatId);
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
      const firstPrompt = nextCastPrompt(session, seatId, planCard, chosenX > 0 ? chosenX : undefined, answers, stackStore.ref.current.stack);
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
            item.id !== seatId ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((permanent) => (toTapOrbs.has(permanent.id) ? { ...permanent, tapped: true, tapUsed: true } : permanent)) } }
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
          item.id !== seatId ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((permanent) => (toTap.has(permanent.id) ? { ...permanent, tapped: true, tapUsed: true } : permanent)) } }
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
      if (caster.kind === "human") startLibraryLook("scry", 1, undefined, undefined, undefined, undefined, undefined, caster.id);
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
      respondWithCard(cardId, "exile", undefined, undefined, undefined, seatId);
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

    // "Destroy/Exile target ...[. Draw a card.]" (Garruk, Cursed Huntsman's -3): the aimed removal is its own step. A human chooses the target (even a single legal
    // one) before the rest of the ability follows; an agent keeps the deterministic pick. The trailing sentences are the rider.
    const loyaltyRemoval = /\bthen return\b|\bunder (?:its owner's|your) control\b/i.test(abilityText) ? undefined : parseRemovalEffect(abilityText);
    if (loyaltyRemoval && (loyaltyRemoval.kind === "destroy" || loyaltyRemoval.kind === "exile" || loyaltyRemoval.kind === "bounce") && !parseModalHeader(abilityText)) {
      const riderText = abilityText.split(/(?<=\.)\s+/).slice(1).join(" ");
      const rider = riderText ? commonTriggerEffect(riderText, "clause") : undefined;
      if (seat.kind === "human" && maybeRequestTarget(seatId, card, removalEffectTargetSpec(loyaltyRemoval, card.id), false, { kind: "removal", effect: loyaltyRemoval, rider })) return;
      setSession((current) => applyRemovalEffect(current, seatId, card.name, card, loyaltyRemoval));
      if (rider) window.setTimeout(() => queueCommonTriggers([makeCommonTrigger(seatId, seatId, card, rider, `${card.name}'s ability continues.`)]), 0);
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
      respondWithCard(choice.sourceCardId, choice.sourceZone === "command" || choice.sourceZone === "graveyard" || choice.sourceZone === "library" ? "hand" : choice.sourceZone, [chosenCard], undefined, choice.faceIndex, choice.controllerSeatId);
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
      else respondWithCard(resume.cardId, resume.sourceZone, undefined, undefined, picked.faceIndex, resume.seatId);
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
      controllerSeatId: base.resume.seatId ?? humanSeat.id,
      sourceCardId: base.planCard.id,
      sourceCardName: base.planCard.name,
      planCard: base.planCard,
      chosenX: base.chosenX,
      prompt: prompt.prompt,
      promptKind: prompt.kind,
      ...(prompt.kind === "modeset" ? { modeSet: { min: prompt.min, max: prompt.max, repeatable: prompt.repeatable } } : {}),
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
    const next = nextCastPrompt(session, choice.controllerSeatId, choice.planCard, choice.chosenX, answers, stackStore.ref.current.stack);
    if (next) {
      openCastPrompt(next, { planCard: choice.planCard, chosenX: choice.chosenX, answers, resume: choice.resume });
      return;
    }
    setPendingRuleChoice(undefined);
    const resume = choice.resume;
    window.setTimeout(() => {
      if (resume.via === "playCard") playCard(resume.seatId, resume.cardId, resume.position, resume.sourceZone, resume.faceIndex, resume.sacrificeTargets, answers, resume.altChoice);
      else respondWithCard(resume.cardId, resume.sourceZone, resume.sacrificeTargets, answers, resume.faceIndex, resume.seatId);
    }, 0);
  }

  // The mode set of a "choose one or more / any number / choose N, repeats allowed" spell, answered in one go as a list of option positions. Re-validated here (a
  // remote friend's answer arrives through the same whitelisted intent): within [min, max], every position real, a mode repeated only when the spell allows it.
  function completeCastModeSet(positions: number[]) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_cast_targets" || choice.promptKind !== "modeset" || !choice.modeSet) return;
    // Modes resolve (and their targets are chosen) in the order they are printed on the card (modeSetAnswer sorts them).
    const modes = modeSetAnswer(choice.modeSet, choice.options, positions);
    if (!modes) return;
    const answers: CastChoices = { modes, modesDone: true, targets: [...choice.answers.targets] };
    const next = nextCastPrompt(session, choice.controllerSeatId, choice.planCard, choice.chosenX, answers, stackStore.ref.current.stack);
    if (next) {
      openCastPrompt(next, { planCard: choice.planCard, chosenX: choice.chosenX, answers, resume: choice.resume });
      return;
    }
    setPendingRuleChoice(undefined);
    const resume = choice.resume;
    window.setTimeout(() => {
      if (resume.via === "playCard") playCard(resume.seatId, resume.cardId, resume.position, resume.sourceZone, resume.faceIndex, resume.sacrificeTargets, answers, resume.altChoice);
      else respondWithCard(resume.cardId, resume.sourceZone, resume.sacrificeTargets, answers, resume.faceIndex, resume.seatId);
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

  return { activateGraveyardAbility, activateLoyaltyAbility, applyCastingCostPaymentSideEffect, castCommander, castFromExile, castFromGraveyard, checkCastTriggeredKeywords, chooseCreatureToSacrificeForCast, commitCrime, completeCastAlt, completeCastCopy, completeCastFace, completeCastModeSet, completeCastPrompt, completeCastX, completeLabeledTarget, completeSpellMode, cycleCard, drawCard, offerPendingMiracle, openCastPrompt, payCastingCost, playCard, shuffleLibrary, unlockRoomDoor };
}
