// Triggered-ability resolution: putting triggers on the stack, option/card prompts for them, finishing them, optional-trigger accept/decline, connive/blink/put-on-library completions, queueCommonTriggers.
// Part of the AppFlow() split: shared state arrives through `ctx` (see ./context.ts); handlers owned by other hooks are called through `lateFn` so every hook sees the current render's functions.
import { type GameSession, type PlayerSeat, type VisibleCard } from "@/lib/types";
import { MODAL_DONE_INDEX, applyConniveDiscard, applyPrimitiveActionPlan, surveilBonusForSeat } from "@/engine/oneShotEffects";
import { type PendingAction } from "@/engine/types";
import { type RemovalEffect } from "@/lib/removalSpells";
import { agentTargetedTriggerKinds, agentTriggerTarget, triggerDamageAiming } from "@/engine/triggerFinders";
import { applyPutCardsOnLibrary, findPermanentById, moveCardBetweenVisibleZones, rulesEvent } from "@/engine/zones";
import { applyRemovalEffect, drawForSeat, drawMultipleForSeat, genericManaAbilityCostShim, genericModalModeHasLegalTarget, resolveDynamicAmount } from "@/engine/effects";
import { chooseManaSourcesForCost } from "@/engine/mana";
import { discardOptions, encodeChosenTarget, labeledTargetOptions, sacrificeOptions } from "@/engine/castTargets";
import { handExcludingStack } from "@/lib/stackedCards";
import { enterUndercityRoom, findCommonTriggersForPermanentEntered, makeCommonTrigger, payRedMana, resolveEcho, resolveTriggerEffect } from "@/engine/triggers";
import { hasCardType } from "@/lib/typeGrants";
import { hasHexproof, hasShroud } from "@/engine/damage";
import { isLandCard } from "@/engine/shared";
import { isUndercityRoom } from "@/lib/undercity";
import { legalTargets } from "@/lib/targeting";
import { markHandCardFreeCastable } from "@/engine/casting";
import { moveCardAcrossSeats } from "@/engine/entry";
import { parseSagaChapters } from "@/lib/oracleClauses";
import { putOpeningHandCardOnBattlefield } from "@/engine/mulligan";
import { targetedEffectSpec } from "@/lib/targetedEffects";
import { zoneEffectTargetSpec } from "@/lib/targetSpecs";
import { triggerCardPrompt, triggerTargetOptionPrompt } from "@/engine/triggerPrompts";
import { type GameContext, lateFn } from "./context";

export function useTriggerResolution(ctx: GameContext) {
  const { session, setSession, prioritySeatId } = ctx;
  const { pendingRuleChoice, setPendingRuleChoice } = ctx.choices;
  const { pendingAction, setPendingAction, setPriorityPasses, stackStore, abilityResolvers } = ctx.stack;
  const activateScriptedAbility = lateFn(ctx, "activateScriptedAbility");
  const addEvent = lateFn(ctx, "addEvent");
  const applySagaReadAhead = lateFn(ctx, "applySagaReadAhead");
  const askOpeningHandBattlefield = lateFn(ctx, "askOpeningHandBattlefield");
  const beginPendingAction = lateFn(ctx, "beginPendingAction");
  const declareAttack = lateFn(ctx, "declareAttack");
  const playCard = lateFn(ctx, "playCard");
  const removeStackAction = lateFn(ctx, "removeStackAction");
  const replaceStackActions = lateFn(ctx, "replaceStackActions");
  const resumeStackAction = lateFn(ctx, "resumeStackAction");
  const resumeTopStackAction = lateFn(ctx, "resumeTopStackAction");
  const startLibraryLook = lateFn(ctx, "startLibraryLook");

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
    const cardPrompt = triggerCardPrompt(session, trigger, controller);
    if (cardPrompt && cardPrompt.cards.length >= 1) {
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
      if (handExcludingStack(controller, session.stackSpellCardIds).length === 0) return false;
      return open(`${trigger.sourceCardName}: discard which cards? You draw that many.`, discardOptions(controller, [], session.stackSpellCardIds));
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
    // Player / goad / "any target" damage targets: the human always chooses (even with a single legal target).
    const targetPrompt = triggerTargetOptionPrompt(session, trigger, controller);
    if (targetPrompt) return open(targetPrompt.prompt, targetPrompt.options);
    // "You may put a land card from your hand onto the battlefield" (Archaeomancer's Map): the human picks which land.
    if (trigger.effect.kind === "put_land_from_hand") {
      const lands = controller.board.hand.filter((card) => card.typeLine.includes("Land"));
      if (lands.length >= 2) return open(`${trigger.sourceCardName}: choose a land card from your hand to put onto the battlefield.`, lands.map((card, index) => ({ index, label: card.name })));
    }
    // God-Eternal Bontu: "sacrifice any number of other permanents, then draw that many cards" — the human picks which ones, one at a time.
    if (trigger.effect.kind === "sacrifice_surplus_then_draw") {
      if (controller.board.battlefield.filter((card) => card.id !== trigger.sourceCardId).length === 0) return false;
      return open(`${trigger.sourceCardName}: sacrifice which other permanents? You draw that many cards.`, sacrificeOptions(controller, trigger.sourceCardId, []));
    }
    return false;
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
    // Card-specific activated ability (engine/cardAbilities.ts): the answer is one more pick; ask the next question or pay and resolve.
    if (choice.trigger.effect.kind === "deferred_choice" && choice.trigger.effect.resolver === "scripted_ability") {
      const data = choice.trigger.effect.data as { abilityId: string; cardId: string; picks: string[] };
      const value = choice.trigger.effect.values[index];
      if (value !== undefined) activateScriptedAbility(choice.controllerSeatId, data.cardId, data.abilityId, [...data.picks, value]);
      return;
    }
    // Leyline Tyrant: pay the chosen red now, then pick what the damage hits.
    if (choice.trigger.effect.kind === "pay_red_for_damage") {
      const paid = index > 0 ? payRedMana(session, choice.controllerSeatId, index) : undefined;
      if (paid) {
        const source = { id: choice.sourceCardId, name: choice.sourceCardName, typeLine: "", oracleText: "", colors: ["R"], manaValue: 0, role: "permanent", zone: "graveyard" } as VisibleCard;
        const options = labeledTargetOptions(paid.session, choice.controllerSeatId, "any_damage", source);
        const damage: RemovalEffect = { kind: "damage", amount: paid.count, targetType: "any" };
        setSession(() => paid.session);
        if (options.length >= 1) {
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
      const remaining = (owner ? handExcludingStack(owner, session.stackSpellCardIds) : []).filter((card) => !already.includes(card.id));
      if (owner && index < remaining.length) {
        const picked = [...already, remaining[index].id];
        const nextTrigger = { ...choice.trigger, effect: { ...effect, discardIds: picked } } as Extract<PendingAction, { type: "trigger" }>;
        if (picked.length < Math.min(handExcludingStack(owner, session.stackSpellCardIds).length, effect.max ?? Number.POSITIVE_INFINITY)) {
          setPendingRuleChoice({
            ...choice,
            id: crypto.randomUUID(),
            trigger: nextTrigger,
            prompt: choice.sourceCardName + ": discard which cards? (" + picked.length + " chosen" + (effect.max ? ", up to " + effect.max : "") + ") You draw that many.",
            options: discardOptions(owner, picked, session.stackSpellCardIds),
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
      const drawnPutBackSeat = drawnSession.seats.find((seat) => seat.id === trigger.controllerSeatId);
      const postDrawHandSize = drawnPutBackSeat ? handExcludingStack(drawnPutBackSeat, drawnSession.stackSpellCardIds).length : 0;
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
        startLibraryLook("scry", 2, undefined, undefined, undefined, undefined, undefined, trigger.controllerSeatId);
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
      startLibraryLook(isSurveil ? "surveil" : "scry", trigger.effect.amount + (isSurveil ? surveilBonusForSeat(lookSeat) : 0), undefined, undefined, undefined, undefined, undefined, lookSeat.id);
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
      addEvent(`${choice.sourceCardName}: ${choice.prompt.replace(/ Do you want to\?$/, "")}.`, choice.controllerSeatId, "Rules");
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
      addEvent(`${seatName} declines ${choice.sourceCardName}'s optional effect.`, choice.controllerSeatId, "Rules");
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
    setSession((current) => applyPutCardsOnLibrary(current, choice.controllerSeatId, choice.sourceCardName, cardIds.filter((id) => !current.stackSpellCardIds?.includes(id)).slice(0, choice.requiredCount)));
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
    const drawnSeat = drawnSession.seats.find((seat) => seat.id === trigger.controllerSeatId);
    const postDrawHandSize = drawnSeat ? handExcludingStack(drawnSeat, drawnSession.stackSpellCardIds).length : 0;
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
    // A friend's answer arrives over the wire: only a land on the chooser's own battlefield may be returned (not a graveyard/exile card).
    const landId = session.seats.find((seat) => seat.id === choice.controllerSeatId)?.board.battlefield.find((card) => card.id === cardIds[0] && card.typeLine.includes("Land"))?.id;
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
    // Same wire-answer check as the land return: only a permanent the chooser controls (other than the source) may be blinked.
    const targetId = session.seats.find((seat) => seat.id === choice.controllerSeatId)?.board.battlefield.find((card) => card.id === cardIds[0] && card.id !== choice.sourceCardId)?.id;
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
      const asksAtQueueTime = trigger.effect.kind === "modal" || trigger.effect.kind === "put_any_from_hand" || triggerCardPrompt(session, trigger, controller) !== undefined || triggerTargetOptionPrompt(session, trigger, controller) !== undefined;
      if (asksAtQueueTime && openTriggerOptionPrompt(trigger, [], triggers)) return;
    }
    const [firstTrigger, ...laterTriggers] = triggers;
    if (laterTriggers.length > 0) {
      replaceStackActions([...stackStore.ref.current.stack,...laterTriggers]);
      addEvent(`${triggers.length} triggered abilities were put onto the stack.`, firstTrigger.controllerSeatId, "Trigger");
    }
    beginPendingAction(firstTrigger, "Trigger");
  }

  return { acceptOptionalTrigger, beginTriggerResolution, completeChoosePermanentToBlink, completeConniveDiscard, completePutCardsOnLibrary, completeReturnLandToHand, completeTriggerCard, completeTriggerOption, declineOptionalTrigger, finishTriggerResolution, openTriggerOptionPrompt, queueCommonTriggers, resolvePendingTrigger };
}
