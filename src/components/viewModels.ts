// UI view-model builders: ruleChoiceView / blockChoiceView (what the choice dialogs display), effective-stat decoration and
// rule-choice labels.
// Extracted verbatim from components/AppFlow.tsx; AppFlow.tsx re-exports the previously public symbols.

import { canTapForCost } from "@/engine/abilities";
import { findCardAnywhere } from "@/engine/castTargets";
import { matchesAdditionalSacrificeType, roomDoorFaces } from "@/engine/casting";
import { canBlock } from "@/engine/combat";
import { handExcludingStack } from "@/lib/stackedCards";
import { discardableHandCards, matchesEachPlayerSacrificeFilter, matchesPermanentSacrificeFilter, matchesSacrificeFilter } from "@/engine/effects";
import { type BlockChoiceState, type ManualLibrarySearchState } from "@/engine/flowTypes";
import { cumulativeUpkeepCost, isCumulativeUpkeepCard } from "@/engine/legalActions";
import { remainingLibraryTotalManaValue, searchableLibraryCards } from "@/engine/oneShotEffects";
import { type PendingRuleChoice } from "@/engine/types";
import { effectivePower, effectiveToughness } from "@/lib/counters";
import { legalTargets, type ChosenTarget } from "@/lib/targeting";
import { hasCardType } from "@/lib/typeGrants";
import { type GameSession, type PlayerSeat, type VisibleCard } from "@/lib/types";

export function ruleChoiceView(
  choice: PendingRuleChoice | undefined,
  humanSeat: PlayerSeat,
  manualSearch: ManualLibrarySearchState | undefined,
  session: GameSession
) {
  if (choice?.controllerSeatId === humanSeat.id) {
    if (choice.kind === "choose_card_from_library") {
      const chosenCardIds = new Set(choice.chosenCardIds ?? []);
      return {
        kind: "choose_card_from_library" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        cards: searchableLibraryCards((humanSeat.library ?? []).filter((card) => !chosenCardIds.has(card.id)), {
          ...choice,
          remainingTotalManaValue: remainingLibraryTotalManaValue(choice, humanSeat.library ?? [])
        }),
        // Kodama's Reach / Cultivate: after the first find's zone is picked, the second find just goes to the other zone.
        destination:
          choice.splitDestination && chosenCardIds.size > 0 && choice.destinationChoices
            ? choice.chosenDestinations?.[[...chosenCardIds][0]] === "battlefield"
              ? choice.splitDestination
              : "battlefield"
            : choice.destination,
        destinationChoices: choice.splitDestination && chosenCardIds.size > 0 ? undefined : choice.destinationChoices,
        allowedCardFilter: choice.allowedCardFilter,
        maxChoices: choice.maxChoices,
        chosenCount: chosenCardIds.size
      };
    }
    if (choice.kind === "choose_creature_from_graveyards") {
      return {
        kind: "choose_creature_from_graveyards" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        actionLabel: choice.manaValueCeiling !== undefined ? "Choose (Battlefield or Hand)" : "Return to Battlefield",
        cards: session.seats
          .filter((seat) => !choice.restrictToYourGraveyard || seat.id === choice.controllerSeatId)
          .flatMap((seat) =>
            (seat.board.graveyard ?? [])
              .filter((card) => hasCardType(card, "Creature"))
              .map((card) => ({ card, seatId: seat.id, seatName: seat.name }))
          )
      };
    }
    if (choice.kind === "choose_creature_to_sacrifice") {
      const filter = choice.typeFilter?.toLowerCase();
      return {
        kind: "choose_creature_to_sacrifice" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        actionLabel: choice.tapSubtype ? "Tap" : "Sacrifice",
        // Always the controller's own board — a sacrifice cost has no "sacrifice an opponent's
        // creature" shape, unlike choose_creature_on_battlefield's restrictToYourControl (which
        // varies per targeted effect) or choose_creature_from_graveyards' any-graveyard pool.
        // The source permanent itself is a legal choice ("a creature", not "another creature") —
        // deliberately not excluded, unlike choose_creature_on_battlefield's own sourceCardId filter.
        cards: humanSeat.board.battlefield
          .filter((card) =>
            !choice.pickedIds?.includes(card.id) &&
            (choice.eligibleIds
              ? choice.eligibleIds.includes(card.id) && !card.tapped
              : choice.tapSubtype
              ? canTapForCost(card, choice.tapSubtype)
              : choice.anyPermanent
                ? card.id !== choice.excludeCardId && matchesPermanentSacrificeFilter(card, choice.typeFilter)
                : hasCardType(card, "Creature") && card.id !== choice.excludeCardId && matchesSacrificeFilter(card, filter))
          )
          .map((card) => ({ card, seatId: humanSeat.id, seatName: humanSeat.name }))
      };
    }
    if (choice.kind === "choose_each_player_sacrifice") {
      return {
        kind: "choose_each_player_sacrifice" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        actionLabel: "Sacrifice",
        cards: humanSeat.board.battlefield
          .filter((card) => matchesEachPlayerSacrificeFilter(card, choice.typeFilter) && !(choice.excludeTokensFromSourceId && card.token && card.tokenSourceCardId === choice.excludeTokensFromSourceId))
          .map((card) => ({ card, seatId: humanSeat.id, seatName: humanSeat.name }))
      };
    }
    if (choice.kind === "choose_creature_to_sacrifice_for_cast") {
      return {
        kind: "choose_creature_to_sacrifice_for_cast" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        actionLabel: "Sacrifice",
        cards: humanSeat.board.battlefield
          .filter((card) => matchesAdditionalSacrificeType(card, choice.sacrificeType ?? "creature"))
          .map((card) => ({ card, seatId: humanSeat.id, seatName: humanSeat.name }))
      };
    }
    if (choice.kind === "choose_cast_x") {
      return { kind: "choose_modal_option" as const, sourceCardName: choice.sourceCardName, prompt: choice.prompt, options: choice.options.map((option, index) => ({ index, label: option.label })) };
    }
    if (choice.kind === "choose_cast_copy") {
      return { kind: "choose_modal_option" as const, sourceCardName: choice.sourceCardName, prompt: choice.prompt, options: choice.options.map((option, index) => ({ index, label: option.label, card: findCardAnywhere(session, option.cardId, choice.controllerSeatId) })) };
    }
    if (choice.kind === "choose_cast_face") {
      return { kind: "choose_modal_option" as const, sourceCardName: choice.sourceCardName, prompt: choice.prompt, options: choice.options.map((option, index) => ({ index, label: option.label })) };
    }
    if (choice.kind === "choose_cast_alt") {
      return { kind: "choose_modal_option" as const, sourceCardName: choice.sourceCardName, prompt: choice.prompt, options: [{ index: 0, label: choice.altLabel }, { index: 1, label: "Pay the normal mana cost" }] };
    }
    // A card target (a graveyard creature, a permanent) is shown with its art and text, not just its name.
    const cardForTarget = (target: ChosenTarget | undefined): VisibleCard | undefined => (target?.kind === "card" ? findCardAnywhere(session, target.cardId, target.seatId) : undefined);
    if (choice.kind === "choose_cast_targets" && choice.promptKind === "modeset" && choice.modeSet) {
      return { kind: "choose_modal_set" as const, sourceCardName: choice.sourceCardName, prompt: choice.prompt, options: choice.options.map((option, index) => ({ index, label: option.label })), ...choice.modeSet };
    }
    if (choice.kind === "choose_cast_targets") {
      return { kind: "choose_modal_option" as const, sourceCardName: choice.sourceCardName, prompt: choice.prompt, options: choice.options.map((option, index) => ({ index, label: option.label, card: cardForTarget(option.target) })) };
    }
    if (choice.kind === "choose_spell_modes") {
      return {
        kind: "choose_modal_option" as const,
        sourceCardName: choice.sourceCardName,
        prompt: `${choice.sourceCardName}: choose mode ${choice.picked.length + 1} of ${choice.chooseCount}.`,
        options: choice.labels.map((label, index) => ({ index, label })).filter((option) => !choice.picked.includes(option.index))
      };
    }
    if (choice.kind === "choose_dig_card") {
      return { kind: "choose_modal_option" as const, sourceCardName: choice.sourceCardName, prompt: choice.prompt, options: choice.options.map((option) => ({ index: option.index, label: option.label, card: findCardAnywhere(session, option.cardId, choice.controllerSeatId) })) };
    }
    if (choice.kind === "choose_labeled_target") {
      const slot = choice.slots[choice.slotIndex];
      return { kind: "choose_modal_option" as const, sourceCardName: choice.sourceCardName, prompt: slot.prompt, options: slot.options.map((option, index) => ({ index, label: option.label, card: cardForTarget(option.target) })) };
    }
    if (choice.kind === "choose_creature_for_grant") {
      const owner = session.seats.find((seat) => seat.id === choice.controllerSeatId);
      return {
        kind: "choose_creature_on_battlefield" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        actionLabel: "Give " + choice.keywords.join(" and "),
        cards: (owner?.board.battlefield ?? []).filter((card) => card.typeLine.includes("Creature")).map((card) => ({ card, seatId: owner!.id, seatName: owner!.name }))
      };
    }
    if (choice.kind === "choose_trigger_card") {
      const cards = choice.cards.flatMap((entry) => {
        const owner = session.seats.find((seat) => seat.id === entry.seatId);
        const card = choice.zone === "graveyard" ? owner?.board.graveyard?.find((item) => item.id === entry.cardId) : owner?.board.battlefield.find((item) => item.id === entry.cardId);
        return owner && card ? [{ card, seatId: owner.id, seatName: owner.name }] : [];
      });
      return choice.zone === "graveyard"
        ? { kind: "choose_creature_from_graveyards" as const, sourceCardName: choice.sourceCardName, prompt: choice.prompt, actionLabel: "Choose", cards }
        : { kind: "choose_creature_on_battlefield" as const, sourceCardName: choice.sourceCardName, prompt: choice.prompt, actionLabel: "Choose", cards };
    }
    if (choice.kind === "choose_trigger_option") {
      return { kind: "choose_modal_option" as const, sourceCardName: choice.sourceCardName, prompt: choice.prompt, options: choice.options.map((option) => ({ ...option, card: option.cardId ? findCardAnywhere(session, option.cardId, choice.controllerSeatId) : undefined })) };
    }
    if (choice.kind === "choose_ability_card_target") {
      return {
        kind: "choose_creature_from_graveyards" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        actionLabel: /exile/i.test(choice.prompt) ? "Exile" : "Choose",
        cards: choice.cards.flatMap((entry) => {
          const owner = session.seats.find((seat) => seat.id === entry.seatId);
          const card = owner?.board.graveyard?.find((item) => item.id === entry.cardId);
          return owner && card ? [{ card, seatId: owner.id, seatName: owner.name }] : [];
        })
      };
    }
    if (choice.kind === "choose_modal_option") {
      return {
        kind: "choose_modal_option" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        options: choice.options
      };
    }
    if (choice.kind === "choose_effect_target") {
      // legalTargets (src/lib/targeting.ts) is the single source of truth for this pool — the same
      // function maybeRequestTarget used to decide whether to even open this choice, and the same
      // one targetsStillLegal re-checks against at resolution time, so the two can never disagree.
      const pool = legalTargets(session, choice.controllerSeatId, choice.spec, choice.sourceCard);
      if (choice.spec.zone === "player") {
        return {
          kind: "choose_effect_target" as const,
          sourceCardName: choice.sourceCardName,
          prompt: choice.prompt,
          optional: choice.optional,
          zone: "player" as const,
          cards: [],
          players: pool
            .filter((target): target is Extract<typeof pool[number], { kind: "player" }> => target.kind === "player")
            .map((target) => ({ seatId: target.seatId, seatName: session.seats.find((seat) => seat.id === target.seatId)?.name ?? "" }))
        };
      }
      return {
        kind: "choose_effect_target" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        optional: choice.optional,
        zone: choice.spec.zone === "graveyard" ? ("graveyard" as const) : ("battlefield" as const),
        cards: pool
          .filter((target): target is Extract<typeof pool[number], { kind: "card" }> => target.kind === "card")
          .map((target) => ({ card: target.card, seatId: target.seatId, seatName: session.seats.find((seat) => seat.id === target.seatId)?.name ?? "" })),
        players: []
      };
    }
    if (choice.kind === "choose_proliferate_targets") {
      return {
        kind: "choose_proliferate_targets" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        cards: session.seats.flatMap((seat) =>
          seat.board.battlefield
            .filter((card) => card.counters && card.counters.length > 0)
            .map((card) => ({ card, seatId: seat.id, seatName: seat.name }))
        ),
        players: session.seats
          .filter((seat) => (seat.poison ?? 0) > 0 || (seat.experienceCounters ?? 0) > 0)
          .map((seat) => ({
            seatId: seat.id,
            seatName: seat.name,
            countersLabel: [seat.poison ? `${seat.poison} poison` : undefined, seat.experienceCounters ? `${seat.experienceCounters} experience` : undefined]
              .filter(Boolean)
              .join(", ")
          }))
      };
    }
    if (choice.kind === "choose_creature_on_battlefield") {
      return {
        kind: "choose_creature_on_battlefield" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        actionLabel: `Put a ${choice.counterKind} counter here`,
        cards: session.seats
          .filter((seat) => !choice.restrictToYourControl || seat.id === choice.controllerSeatId)
          .flatMap((seat) =>
            seat.board.battlefield
              .filter((card) => hasCardType(card, "Creature") && card.id !== choice.sourceCardId)
              .map((card) => ({ card, seatId: seat.id, seatName: seat.name }))
          )
      };
    }
    if (choice.kind === "choose_aura_attach_target") {
      return {
        kind: "choose_aura_attach_target" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        actionLabel: `Enchant with ${choice.sourceCardName}`,
        // Same targetOwn scoping as chooseAuraAttachTarget's own candidate search: a beneficial
        // aura's pool is the controller's own creatures, a removal-style aura's is opponents' only.
        cards: session.seats
          .filter((seat) => (choice.restrictToYourControl ? seat.id === choice.controllerSeatId : seat.id !== choice.controllerSeatId))
          .flatMap((seat) => seat.board.battlefield.filter((card) => hasCardType(card, "Creature")).map((card) => ({ card, seatId: seat.id, seatName: seat.name })))
      };
    }
    if (choice.kind === "choose_equip_target") {
      const controllerSeat = session.seats.find((seat) => seat.id === choice.controllerSeatId);
      return {
        kind: "choose_equip_target" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        actionLabel: `Equip ${choice.sourceCardName}`,
        // Equip's own reminder text is always "target creature YOU control" — no opponent pool,
        // unlike an Aura's beneficial-vs-removal split.
        cards: (controllerSeat?.board.battlefield ?? [])
          .filter((card) => hasCardType(card, "Creature"))
          .map((card) => ({ card, seatId: choice.controllerSeatId, seatName: controllerSeat?.name ?? "" }))
      };
    }
    if (choice.kind === "order_triggers") {
      return {
        kind: "order_triggers" as const,
        prompt: choice.prompt,
        triggers: choice.triggers,
        orderedTriggers: choice.orderedTriggers
      };
    }
    if (choice.kind === "miracle_offer") {
      // A Room card offered a miracle-like cast (Aminatou, Veil Piercer's granted miracle, ...)
      // still needs a door choice like any other cast of it — without this, acceptMiracleOffer had
      // no way to know a face was even in play and always cast face 0 (whichever door happens to
      // print first) regardless of which one the player actually wanted, reported live as Secret
      // Arcade // Dusty Parlor always choosing Secret Arcade for itself.
      const sourceSeat = session.seats.find((seat) => seat.id === choice.controllerSeatId);
      const sourceCard = sourceSeat?.board.hand.find((card) => card.id === choice.sourceCardId);
      const doors = sourceCard ? roomDoorFaces(sourceCard) : undefined;
      return {
        kind: "miracle_offer" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        miracleCost: choice.miracleCost,
        doorFaces: doors ? ([doors[0].name, doors[1].name] as [string, string]) : undefined
      };
    }
    if (choice.kind === "optional_trigger" || choice.kind === "optional_primitive_plan") {
      // Both project to the same "optional_trigger" view kind — ThreeGameTable.tsx's
      // OptionalTriggerModal only ever reads sourceCardName/prompt, and AppFlow.tsx's
      // acceptOptionalTrigger/declineOptionalTrigger (bound to that modal's onAccept/onDecline)
      // already branch internally on the real pendingRuleChoice.kind, so reusing the exact same
      // modal needs no new UI component.
      return {
        kind: "optional_trigger" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt
      };
    }
    if (choice.kind === "commander_zone_choice") {
      return {
        kind: "commander_zone_choice" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt
      };
    }
    if (choice.kind === "discard_to_hand_size") {
      return {
        kind: "discard_to_hand_size" as const,
        prompt: choice.prompt,
        hand: discardableHandCards(humanSeat, choice.activation?.discardType, session.stackSpellCardIds),
        requiredDiscards: choice.requiredDiscards,
        sourceCardName: choice.sourceCardName
      };
    }
    if (choice.kind === "put_cards_on_library") {
      return {
        kind: "put_cards_on_library" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        hand: handExcludingStack(humanSeat, session.stackSpellCardIds),
        requiredCount: choice.requiredCount
      };
    }
    if (choice.kind === "connive_discard") {
      return {
        kind: "connive_discard" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        hand: handExcludingStack(humanSeat, session.stackSpellCardIds)
      };
    }
    if (choice.kind === "return_land_to_hand") {
      return {
        kind: "return_land_to_hand" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        lands: humanSeat.board.battlefield.filter((card) => card.typeLine.includes("Land"))
      };
    }
    if (choice.kind === "choose_permanent_to_blink") {
      return {
        kind: "choose_permanent_to_blink" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        permanents: humanSeat.board.battlefield.filter((card) => card.id !== choice.sourceCardId)
      };
    }
    if (choice.kind === "choose_creature_type") {
      return {
        kind: "choose_creature_type" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        currentChoice: humanSeat.board.battlefield.find((card) => card.id === choice.sourceCardId)?.chosenCreatureType
      };
    }
    if (choice.kind === "choose_color") {
      return {
        kind: "choose_color" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        excludedColor: choice.excludedColor,
        currentChoice: humanSeat.board.battlefield.find((card) => card.id === choice.sourceCardId)?.chosenColor
      };
    }
    if (choice.kind === "distribute_attack_trigger_mana") {
      return {
        kind: "distribute_attack_trigger_mana" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        amount: choice.amount
      };
    }
    const source = humanSeat.board.battlefield.find((card) => card.id === choice.sourceCardId);
    return {
      kind: "manual_review" as const,
      sourceCardId: choice.sourceCardId,
      sourceCardName: choice.sourceCardName,
      prompt: choice.prompt,
      isCumulativeUpkeep: source ? isCumulativeUpkeepCard(source) : false,
      cumulativeUpkeepCost: source && isCumulativeUpkeepCard(source) ? cumulativeUpkeepCost(source) : undefined
    };
  }

  if (manualSearch?.seatId === humanSeat.id) {
    return {
      kind: "choose_card_from_library" as const,
      sourceCardName: "Manual Search",
      prompt: "Choose a card from your library.",
      cards: humanSeat.library ?? [],
      destination: manualSearch.destination,
      maxChoices: 1,
      chosenCount: 0
    };
  }

  return undefined;
}

function withEffectiveStats(card: VisibleCard): VisibleCard {
  // The live numbers become the printed ones, so every modifier is dropped from the copy: the block prompt applies effectivePower() again,
  // which used to count +1/+1 counters and pumps twice (a 10/10 Managorger Hydra was shown as 19/19).
  return {
    ...card,
    power: card.power !== undefined ? String(effectivePower(card)) : card.power,
    toughness: card.toughness !== undefined ? String(effectiveToughness(card)) : card.toughness,
    setPowerOverride: undefined,
    setToughnessOverride: undefined,
    cdaPower: undefined,
    cdaToughness: undefined,
    temporaryPowerBonus: undefined,
    temporaryToughnessBonus: undefined,
    attachmentPowerBonus: undefined,
    attachmentToughnessBonus: undefined,
    counters: card.counters?.filter((counter) => counter.kind !== "+1/+1" && counter.kind !== "-1/-1")
  };
}

export function blockChoiceView(session: GameSession, choice: BlockChoiceState | undefined) {
  if (!choice) return undefined;
  const attacker = session.seats.find((seat) => seat.id === choice.attackerSeatId);
  const defender = session.seats.find((seat) => seat.id === choice.defenderSeatId);
  const attackingCard = attacker?.board.battlefield.find((card) => card.id === choice.attackerCardId && card.attacking);
  if (!attacker || !defender || !attackingCard) return undefined;
  return {
    attackerName: attacker.name,
    defenderName: defender.name,
    attackingCard: withEffectiveStats(attackingCard),
    blockers: defender.board.battlefield.filter((card) => canBlock(card, attackingCard, defender.board.battlefield)).map(withEffectiveStats)
  };
}

export function ruleChoiceLabel(choice: PendingRuleChoice) {
  if (choice.kind === "order_triggers") return "phase triggers";
  if (choice.kind === "discard_to_hand_size") return "discarding to hand size";
  return choice.sourceCardName;
}
