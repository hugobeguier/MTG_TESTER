// Which targets a HUMAN-controlled triggered ability asks its controller to choose as it goes on the stack (rule 603.3d). Pure: the hook
// (components/game/useTriggerResolution.ts) opens the prompt from this and tests assert on it. A human never has a target picked for them.
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import type { PendingAction } from "@/engine/types";
import { findPermanentById } from "@/engine/zones";
import { hasHexproof, hasShroud } from "@/engine/damage";
import { isLandCard } from "@/engine/shared";
import { hasCardType } from "@/lib/typeGrants";
import { legalTargets } from "@/lib/targeting";
import { targetedEffectSpec } from "@/lib/targetedEffects";
import { zoneEffectTargetSpec } from "@/lib/targetSpecs";
import { labeledTargetOptions } from "@/engine/castTargets";
import { triggerDamageAiming } from "@/engine/triggerFinders";
import { resolveDynamicAmount } from "@/engine/effects";

// Which cards a human-controlled trigger asks them to pick, and from where. Undefined for triggers that need no card choice.
export function triggerCardPrompt(session: GameSession, trigger: Extract<PendingAction, { type: "trigger" }>, controller: PlayerSeat): { prompt: string; zone: "battlefield" | "graveyard"; cards: Array<{ seatId: string; cardId: string }>; picksNeeded: number } | undefined {
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

export type TriggerOptionPrompt = { prompt: string; options: Array<{ index: number; label: string }> };

// The option-list target prompts (a player, a creature to goad, damage "any target") of a human-controlled trigger. Even a single legal target is offered:
// the player confirms it. Undefined when the trigger asks for no such target (or nothing is legal, so the trigger would have no target).
export function triggerTargetOptionPrompt(session: GameSession, trigger: Extract<PendingAction, { type: "trigger" }>, controller: PlayerSeat): TriggerOptionPrompt | undefined {
  const seatLabel = (seatId: string) => session.seats.find((seat) => seat.id === seatId);
  // One-verb effects on a player (Blood Artist's drain): the human chooses who.
  if (trigger.effect.kind === "targeted_effect" && trigger.effect.effect.who.kind === "player") {
    const targeted = trigger.effect.effect;
    const source = findPermanentById(session, trigger.sourceCardId) ?? ({ id: trigger.sourceCardId, name: trigger.sourceCardName, typeLine: "", oracleText: "", manaValue: 0, colors: [], role: "effect", zone: "battlefield" } as VisibleCard);
    const players = legalTargets(session, controller.id, targetedEffectSpec(targeted, trigger.sourceCardId, trigger.sourceCardName), source).filter((entry) => entry.kind === "player");
    if (players.length >= 1) return { prompt: `${trigger.sourceCardName}: choose a player.`, options: players.map((entry, index) => ({ index, label: `${seatLabel(entry.seatId)?.name ?? entry.seatId}${entry.seatId === controller.id ? " (you)" : ""} — ${seatLabel(entry.seatId)?.life ?? 0} life` })) };
  }
  // The Undercity's Trap! (a player loses 5 life) and Arena (goad a creature): the human aims them.
  if (trigger.effect.kind === "venture_room" && (trigger.effect.room === "trap" || trigger.effect.room === "arena")) {
    const slot = trigger.effect.room === "trap" ? "player" : "opponent_creature";
    const aimSource = { id: trigger.sourceCardId, name: trigger.sourceCardName, typeLine: "", oracleText: "", manaValue: 0, colors: [], role: "effect", zone: "battlefield" } as VisibleCard;
    const aimOptions = labeledTargetOptions(session, controller.id, slot, aimSource);
    if (aimOptions.length >= 1) return { prompt: trigger.sourceCardName + ": choose a " + (slot === "player" ? "player" : "creature") + ".", options: aimOptions.map((option, index) => ({ index, label: option.label })) };
  }
  // "Deals N damage to any target" triggers: the human aims the damage.
  if (trigger.effect.kind === "damage_effect" || trigger.effect.kind === "context_power_damage") {
    const aiming = triggerDamageAiming(session, trigger, controller.id);
    if (aiming && aiming.options.length >= 1) {
      const amount = aiming.effect.kind === "damage" ? (aiming.effect.amount === "X" ? (aiming.effect.xDefinition ? resolveDynamicAmount(session, controller.id, aiming.effect.xDefinition) : "X") : aiming.effect.amount) : "";
      return { prompt: `${trigger.sourceCardName}: choose a target for ${amount} damage.`, options: aiming.options.map((option, index) => ({ index, label: option.label })) };
    }
  }
  return undefined;
}
