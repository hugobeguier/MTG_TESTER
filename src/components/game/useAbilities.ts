// Activated abilities: generic sacrifice/tap/mana abilities, equip, manland animation, ability-on-stack plumbing and their deferred effect resolvers.
// Part of the AppFlow() split: shared state arrives through `ctx` (see ./context.ts); handlers owned by other hooks are called through `lateFn` so every hook sees the current render's functions.
import { type GameSession, type ManaColor, type VisibleCard } from "@/lib/types";
import { type LibraryLookMode } from "@/engine/flowTypes";
import { type PendingTargetedEffect } from "@/engine/types";
import { type RemovalEffect } from "@/lib/removalSpells";
import { type TargetSpec } from "@/lib/targeting";
import { abilityOracleText } from "@/lib/typeGrants";
import { activateSteelHellkiteX, discardableHandCards, matchesPermanentSacrificeFilter, matchesSacrificeFilter, removalEffectHasLegalTarget } from "@/engine/effects";
import { addManaToPool } from "@/engine/mana";
import { animateEnchantmentSpec, applyGenericAbilityEffect, applyGenericTapEffect, applySacrificeEffect, canTapForCost, parseGenericAbilityEffect, payGenericManaCost, payGenericSacrificeCost, payGenericTapCost, resolveEquip, resolveManlandAnimation, resolveSelfUntapAbility, zoneChoiceSpecFor } from "@/engine/abilities";
import { describeRemovalMode, labeledTargetOptions, steelHellkiteXOptions } from "@/engine/castTargets";
import { equipCost } from "@/lib/attachments";
import { hasHaste, isLandCard } from "@/engine/shared";
import { hasOnceEachTurnLimiter, makeCommonTrigger } from "@/engine/triggers";
import { hasSorcerySpeedOnlyLimiter } from "@/engine/triggerFinders";
import { isMainPhase } from "@/engine/turnFlow";
import { parseGenericManaAbilities, parseGenericSacrificeAbilities, parseGenericTapAbilities } from "@/lib/activatedAbilities";
import { permanentMatchesQualifier } from "@/lib/characteristics";
import { removalEffectTargetSpec } from "@/lib/targetSpecs";
import { surveilBonusForSeat } from "@/engine/oneShotEffects";
import { targetedEffectSpec } from "@/lib/targetedEffects";
import { applyScriptedAbility, payScriptedCost, scriptedAbilityById, scriptedCostPayable, scriptedNextSlot } from "@/engine/cardAbilities";
import { type GameContext, lateFn } from "./context";

export function useAbilities(ctx: GameContext) {
  const { session, setSession, activeSeatId } = ctx;
  const { pendingRuleChoice, setPendingRuleChoice } = ctx.choices;
  const { setCopyMana } = ctx.mana;
  const { pendingAction, abilityResolvers, abilityApiRef } = ctx.stack;
  const addEvent = lateFn(ctx, "addEvent");
  const beginPendingAction = lateFn(ctx, "beginPendingAction");
  const clearManaContributions = lateFn(ctx, "clearManaContributions");
  const humanActionBlockedByChoice = lateFn(ctx, "humanActionBlockedByChoice");
  const maybeRequestTarget = lateFn(ctx, "maybeRequestTarget");
  const poolForSeat = lateFn(ctx, "poolForSeat");
  const setSeatManaPool = lateFn(ctx, "setSeatManaPool");
  const startLibraryLook = lateFn(ctx, "startLibraryLook");

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
      startLibraryLook(lookEffect.kind as LibraryLookMode, (lookEffect as { amount: number }).amount + (lookEffect.kind === "surveil" ? surveilBonusForSeat(seat) : 0), undefined, undefined, undefined, undefined, undefined, seatId);
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

  // Card-specific activated abilities (engine/cardAbilities.ts): each choice (sacrifices, targets, X) is asked one at a time - a human always gets a
  // prompt, even with a single option - then the cost is paid (pool first) and the effect goes on the stack (a mana ability resolves at once).
  function activateScriptedAbility(seatId: string, cardId: string, abilityId: string, picks: string[] = []) {
    if (picks.length === 0 && humanActionBlockedByChoice(seatId)) return;
    const ability = scriptedAbilityById(abilityId);
    const seat = session.seats.find((item) => item.id === seatId);
    const pool = ability?.zone === "hand" ? seat?.board.hand : ability?.zone === "graveyard" ? seat?.board.graveyard : seat?.board.battlefield;
    const card = pool?.find((item) => item.id === cardId);
    if (!ability || !seat || !card || !ability.matches(card)) return;
    if (ability.sorcery && !(activeSeatId === seatId && isMainPhase(session.phase) && !pendingAction)) {
      addEvent(`${card.name} can only be activated as a sorcery: during your own main phase with an empty stack.`, seatId, "Rules action");
      return;
    }
    const humanPool = seat.kind === "human" ? poolForSeat(seatId) : undefined;
    if (!scriptedCostPayable(session, seatId, card, ability, humanPool)) {
      addEvent(`You can't pay for ${card.name}'s ability right now.`, seatId, "Rules action");
      return;
    }
    const next = scriptedNextSlot(session, seatId, card, ability, picks);
    if (!next) {
      addEvent(`${card.name} cannot be activated: nothing legal to choose. Nothing was paid.`, seatId, "Rules action");
      return;
    }
    if (next !== "done") {
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_trigger_option",
        controllerSeatId: seatId,
        sourceCardId: cardId,
        sourceCardName: card.name,
        prompt: next.prompt,
        options: next.options.map((option, index) => ({ index, label: option.label, cardId: option.cardId })),
        trigger: makeCommonTrigger(seatId, seatId, card, { kind: "deferred_choice", resolver: "scripted_ability", data: { abilityId, cardId, picks }, values: next.options.map((option) => option.value) }, `${card.name}'s ability resolves.`),
        remainingStack: []
      });
      return;
    }
    const paid = payScriptedCost(session, seatId, card, ability, picks, humanPool);
    if (!paid) return;
    let poolNow = paid.poolSpent;
    if (paid.poolSpent) clearManaContributions(seatId);
    const addMana = () => {
      if (!ability.mana) return;
      let target = poolNow ?? poolForSeat(seatId);
      for (const symbol of ability.mana.match(/[WUBRGC]/g) ?? []) target = addManaToPool(target, symbol as ManaColor, 1);
      poolNow = target;
      setSeatManaPool(seatId, target);
    };
    if (paid.poolSpent) setSeatManaPool(seatId, paid.poolSpent);
    if (ability.manaAbility) {
      setSession(() => applyScriptedAbility(paid.session, seatId, card, ability, picks).session);
      addMana();
      return;
    }
    setSession(() => paid.session);
    putAbilityOnStack(seatId, card, ability.label(card), () => {
      setSession((current) => applyScriptedAbility(current, seatId, card, ability, picks).session);
      addMana();
    });
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
      if (yours.length >= 1) {
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
    if (options.length === 0) return false;
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

  return { activateScriptedAbility, activateEquip, activateGenericManaAbility, activateGenericSacrificeAbility, activateGenericTapAbility, activateManlandAnimation, activateSelfUntapAbility, confirmEquipTarget, finishPaidSacrificeAbility, resolveSacrificeAbilityEffect, resolveTapAbilityEffect };
}
