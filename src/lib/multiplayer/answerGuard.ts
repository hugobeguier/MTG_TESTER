// Host-side validation of a friend's ANSWER to an open prompt (pure; no React). The wire carries no prompt id, so an answer always lands on whatever prompt is
// open for that seat right now; this module checks the answer against THAT prompt's offered options and the answering seat's own zones, so a modified
// client cannot pick a card/option the prompt never offered (a tutor via the library-look "graveyard" button, a free colour of mana, an opponent's creature for
// a "your control" counter, skipping a mandatory discard, ...). Handlers still re-check what they always did; this is the extra gate in front of them.
// Returns a refusal reason, or undefined when the answer is acceptable. Intents it does not know are not its business (`when` + schema cover those).
import type { GameSession, PlayerSeat, VisibleCard } from "../types";
import type { PendingRuleChoice } from "@/engine/types";
import type { PromptSlots } from "./seatPrompts";

export interface AnswerView {
  session: GameSession;
  slots: PromptSlots;
}

const NO_PROMPT = "no such prompt is waiting for you";

const unique = (ids: string[]) => new Set(ids).size === ids.length;

function seatOf(session: GameSession, seatId: string): PlayerSeat | undefined {
  return session.seats.find((seat) => seat.id === seatId);
}

/** Cards of the seat's hand that a prompt may ask about (a spell already on the stack is not in the hand any more, rule 601.2a). */
function handCards(session: GameSession, seat: PlayerSeat | undefined): VisibleCard[] {
  return (seat?.board.hand ?? []).filter((card) => !session.stackSpellCardIds?.includes(card.id));
}

function inBounds(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < length;
}

/** The number of offered options an `onChooseModalOption` index is an index into, by prompt kind; undefined when the prompt takes no such answer. */
function modalOptionCount(choice: PendingRuleChoice): number | undefined {
  switch (choice.kind) {
    case "choose_cast_face":
    case "choose_cast_copy":
    case "choose_cast_x":
    case "choose_cast_targets":
    case "choose_modal_option":
      return choice.options.length;
    case "choose_cast_alt":
      return 2;
    case "choose_spell_modes":
      return choice.labels.length;
    case "choose_labeled_target":
      return choice.slots[choice.slotIndex]?.options.length;
    default:
      return undefined;
  }
}

function ruleAnswerRefusal(name: string, seatId: string, args: unknown[], session: GameSession, choice: PendingRuleChoice | undefined): string | undefined {
  if (!choice || choice.controllerSeatId !== seatId) return NO_PROMPT;
  const seat = seatOf(session, seatId);
  const hand = handCards(session, seat);
  const bf = seat?.board.battlefield ?? [];
  switch (name) {
    case "onCompleteDiscardChoice": {
      if (choice.kind !== "discard_to_hand_size") return NO_PROMPT;
      const ids = args[0] as string[];
      // A cast waiting on its additional discard cost must not discard the spell itself.
      const pool = hand.filter((card) => card.id !== choice.castResume?.cardId);
      if (!unique(ids) || !ids.every((id) => pool.some((card) => card.id === id))) return "those are not cards in your hand";
      return ids.length === Math.min(choice.requiredDiscards, pool.length) ? undefined : `you must discard exactly ${Math.min(choice.requiredDiscards, pool.length)} card(s)`;
    }
    case "onCompletePutCardsOnLibrary": {
      if (choice.kind !== "put_cards_on_library") return NO_PROMPT;
      const ids = args[0] as string[];
      if (!unique(ids) || !ids.every((id) => hand.some((card) => card.id === id))) return "those are not cards in your hand";
      return ids.length === Math.min(choice.requiredCount, hand.length) ? undefined : `you must put back exactly ${Math.min(choice.requiredCount, hand.length)} card(s)`;
    }
    case "onCompleteConniveDiscard": {
      if (choice.kind !== "connive_discard") return NO_PROMPT;
      const ids = args[0] as string[];
      if (!unique(ids) || !ids.every((id) => hand.some((card) => card.id === id))) return "those are not cards in your hand";
      return ids.length === Math.min(1, hand.length) ? undefined : "you must discard a card";
    }
    case "onCompleteReturnLandToHand": {
      if (choice.kind !== "return_land_to_hand") return NO_PROMPT;
      const ids = args[0] as string[];
      const lands = bf.filter((card) => card.typeLine.includes("Land"));
      if (ids.length > 1 || !ids.every((id) => lands.some((card) => card.id === id))) return "pick one land you control";
      return lands.length > 0 && ids.length === 0 ? "you must return a land" : undefined;
    }
    case "onCompleteChoosePermanentToBlink": {
      if (choice.kind !== "choose_permanent_to_blink") return NO_PROMPT;
      const ids = args[0] as string[];
      return ids.length <= 1 && ids.every((id) => id !== choice.sourceCardId && bf.some((card) => card.id === id)) ? undefined : "pick one permanent you control";
    }
    case "onChooseNextTrigger":
      return choice.kind === "order_triggers" && choice.triggers.some((trigger) => trigger.sourceCardId === args[0]) ? undefined : "that trigger is not one of the choices";
    case "onChooseModalOption": {
      if (choice.kind === "choose_dig_card") return choice.options.some((option) => option.index === args[0]) ? undefined : "that is not one of the options";
      if (choice.kind === "choose_trigger_option") return choice.options.some((option) => option.index === args[0]) ? undefined : "that is not one of the options";
      const count = modalOptionCount(choice);
      if (count === undefined) return NO_PROMPT;
      return inBounds(args[0] as number, count) ? undefined : "that is not one of the options";
    }
    case "onChooseModalSet":
      return choice.kind === "choose_cast_targets" && choice.promptKind === "modeset" && (args[0] as number[]).every((position) => inBounds(position, choice.options.length)) ? undefined : "that is not a valid choice of modes";
    case "onChooseGraveyardReanimationTarget": {
      const [targetSeat, cardId] = args as [string, string];
      if (choice.kind === "choose_trigger_card") return choice.cards.some((entry) => entry.cardId === cardId && entry.seatId === targetSeat) && !choice.picked.includes(cardId) ? undefined : "that is not one of the choices";
      if (choice.kind === "choose_ability_card_target") return choice.cards.some((entry) => entry.cardId === cardId && entry.seatId === targetSeat) ? undefined : "that is not one of the choices";
      if (choice.kind !== "choose_creature_from_graveyards") return NO_PROMPT;
      if (choice.restrictToYourGraveyard && targetSeat !== seatId) return "that is not in your graveyard";
      const card = seatOf(session, targetSeat)?.board.graveyard?.find((item) => item.id === cardId);
      return card && card.typeLine.includes("Creature") ? undefined : "that is not a creature card in that graveyard";
    }
    case "onChooseBattlefieldCreatureTarget": {
      const [targetSeat, cardId] = args as [string, string];
      if (choice.kind === "choose_trigger_card") return choice.cards.some((entry) => entry.cardId === cardId && entry.seatId === targetSeat) && !choice.picked.includes(cardId) ? undefined : "that is not one of the choices";
      if (choice.kind !== "choose_creature_on_battlefield" && choice.kind !== "choose_creature_for_grant") return NO_PROMPT;
      const card = seatOf(session, targetSeat)?.board.battlefield.find((item) => item.id === cardId);
      if (!card || !card.typeLine.includes("Creature")) return "that is not a creature on the battlefield";
      return choice.kind === "choose_creature_on_battlefield" && choice.restrictToYourControl && targetSeat !== seatId ? "you must choose a creature you control" : undefined;
    }
    case "onChooseAuraRetarget": {
      const [targetSeat, cardId] = args as [string, string];
      if (choice.kind !== "choose_aura_attach_target") return NO_PROMPT;
      if (!seatOf(session, targetSeat)?.board.battlefield.some((item) => item.id === cardId)) return "that is not a permanent on the battlefield";
      return choice.restrictToYourControl && targetSeat !== seatId ? "you must choose a permanent you control" : undefined;
    }
    case "onChooseEquipTarget":
      return choice.kind === "choose_equip_target" && bf.some((card) => card.id === args[0] && card.typeLine.includes("Creature")) ? undefined : "pick a creature you control";
    case "onConfirmProliferateTargets": {
      if (choice.kind !== "choose_proliferate_targets") return NO_PROMPT;
      const [cardIds, seatIds] = args as [string[], string[]];
      const everyCard = session.seats.flatMap((item) => item.board.battlefield);
      if (!cardIds.every((id) => everyCard.some((card) => card.id === id && (card.counters?.length ?? 0) > 0))) return "you can only proliferate permanents that have counters";
      return seatIds.every((id) => session.seats.some((item) => item.id === id)) ? undefined : "unknown player";
    }
    case "onChooseCreatureType":
      return choice.kind === "choose_creature_type" && /^[A-Za-z' \-]{1,40}$/.test(args[0] as string) ? undefined : "that is not a creature type";
    case "onChooseColor":
      return choice.kind === "choose_color" ? undefined : NO_PROMPT;
    case "onConfirmAttackTriggerManaColors": {
      if (choice.kind !== "distribute_attack_trigger_mana") return NO_PROMPT;
      const colors = new Set(["W", "U", "B", "R", "G"]);
      return Object.keys(args[0] as object).every((key) => colors.has(key)) ? undefined : "only coloured mana can be chosen";
    }
    case "onChooseSacrificeCostTarget":
      return choice.kind === "choose_creature_to_sacrifice" && !(choice.pickedIds ?? []).includes(args[1] as string) ? undefined : "that was already chosen";
    default:
      return undefined;
  }
}

/** Refusal for the answer-style intents (those whose `when` is an answer* state); undefined for every other intent. */
export function answerRefusal(name: string, seatId: string, args: unknown[], view: AnswerView): string | undefined {
  const { session, slots } = view;
  switch (name) {
    // library look (scry / surveil / dig / vault): the card must be one of the cards the look is showing right now
    case "onKeepLibraryLookCardOnTop":
    case "onOrderLibraryLookCardOnTop":
    case "onPutLibraryLookCardOnBottom":
    case "onPutLibraryLookCardInGraveyard":
    case "onSendLibraryLookCardToHand": {
      const look = slots.libraryLook;
      if (!look) return NO_PROMPT;
      if (!look.cards.some((card) => card.id === args[0])) return "that card is not one of the cards you are looking at";
      if (name === "onPutLibraryLookCardInGraveyard" && look.mode !== "surveil") return "you can only do that while surveilling";
      if (name === "onSendLibraryLookCardToHand" && look.mode !== "choose_one" && look.mode !== "choose_one_bottom") return "you cannot take a card now";
      if (name === "onOrderLibraryLookCardOnTop" && look.mode !== "reorder") return "you are not ordering cards";
      return undefined;
    }
    case "onChooseMana": {
      const choice = slots.manaChoice;
      return choice && choice.choices.includes(args[0] as never) ? undefined : "that colour is not one of the choices";
    }
    case "onConfirmBlockers": {
      return slots.blockChoice ? undefined : NO_PROMPT;
    }
    case "onCompleteMyriadSearch":
      return slots.myriadSearch && (args[0] as string[]).length <= 2 && unique(args[0] as string[]) ? undefined : "pick up to two different lands";
    case "onSearchLibraryCardToHand": {
      // The rule-driven search is validated card by card in chooseRuleLibraryCard; the manual box is the host's own (sandbox) tool.
      if (slots.pendingRuleChoice?.controllerSeatId === seatId) return slots.pendingRuleChoice.kind === "choose_card_from_library" ? undefined : NO_PROMPT;
      return slots.manualLibrarySearch?.seatId === seatId ? undefined : NO_PROMPT;
    }
    case "onAcceptMiracle":
    case "onDeclineMiracle":
      return slots.pendingRuleChoice?.kind === "miracle_offer" && slots.pendingRuleChoice.controllerSeatId === seatId ? undefined : NO_PROMPT;
    case "onFinishLibrarySearch":
      return slots.pendingRuleChoice?.kind === "choose_card_from_library" && slots.pendingRuleChoice.controllerSeatId === seatId ? undefined : NO_PROMPT;
    case "onCompleteDiscardChoice":
    case "onCompletePutCardsOnLibrary":
    case "onCompleteConniveDiscard":
    case "onCompleteReturnLandToHand":
    case "onCompleteChoosePermanentToBlink":
    case "onChooseNextTrigger":
    case "onChooseModalOption":
    case "onChooseModalSet":
    case "onChooseGraveyardReanimationTarget":
    case "onChooseBattlefieldCreatureTarget":
    case "onChooseAuraRetarget":
    case "onChooseEquipTarget":
    case "onConfirmProliferateTargets":
    case "onChooseCreatureType":
    case "onChooseColor":
    case "onConfirmAttackTriggerManaColors":
    case "onChooseSacrificeCostTarget":
      return ruleAnswerRefusal(name, seatId, args, session, slots.pendingRuleChoice);
    default:
      return undefined;
  }
}
