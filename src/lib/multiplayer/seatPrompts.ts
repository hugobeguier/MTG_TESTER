// Everything the host's AppFlow derives for ITS human seat's table (pending rule choice, block choice, mana colour box, Myriad box, library look / search
// boxes, "when this resolves you'll choose" notes, which hand cards can respond / have several faces, attack targets), computed for ANY seat and as pure
// data. A remote friend's snapshot carries exactly this for THEIR seat (`MpSnapshot.prompts`), so RemoteTable can feed ThreeGameTable the same props
// AppFlow does. Nothing here is ever built for a seat other than the viewer's (see snapshot.ts + seatSnapshot.test.ts), so it cannot leak across seats.
//
// Derived from the host's FULL session (the viewer's own library contents are needed for search boxes); the result is plain JSON.
import { canAttack, attackLockedOut } from "@/engine/combat";
import { canCastAtInstantSpeed, handCardFaceOptions, seatHasFlashGrant, type HandCardFaceOption } from "@/engine/casting";
import { getBasicLandFetchOptions, getMyriadLandscapeOptions } from "@/engine/etb";
import { spellIsImmuneToCounters } from "@/engine/legalActions";
import { chooseManaSourcesForCost, emptyManaPool, payCostFromPool } from "@/engine/mana";
import { findSpellSourceCard, resolutionPromptNote } from "@/engine/priority";
import { isPlaneswalkerCard, loyaltyCounterCount } from "@/engine/zones";
import type { BasicLandFetchSearchState, BlockChoiceState, LibraryLookState, ManaChoiceState, ManualLibrarySearchState, MyriadSearchState, MyriadTapChoiceState } from "@/engine/flowTypes";
import type { PendingAction, PendingRuleChoice } from "@/engine/types";
import { blockChoiceView, ruleChoiceView } from "@/components/viewModels";
import { counterSpellCanTarget, parseCounterSpellAbility } from "../counterSpells";
import type { GameSession, ManaPool, PlayerSeat, VisibleCard } from "../types";
import type { PromptOwners } from "./intentSpecs";

/** The host's global prompt slots (each addressed to one seat). */
export interface PromptSlots {
  pendingRuleChoice?: PendingRuleChoice;
  libraryLook?: LibraryLookState;
  blockChoice?: BlockChoiceState;
  manaChoice?: ManaChoiceState;
  myriadTapChoice?: MyriadTapChoiceState;
  myriadSearch?: MyriadSearchState;
  basicLandFetchSearch?: BasicLandFetchSearchState;
  manualLibrarySearch?: ManualLibrarySearchState;
}

/** Which seat each open prompt is addressed to. */
export function promptOwnersOf(slots: PromptSlots): PromptOwners {
  return {
    rule: slots.pendingRuleChoice?.controllerSeatId,
    look: slots.libraryLook ? (slots.libraryLook.lookerSeatId ?? slots.libraryLook.seatId) : undefined,
    block: slots.blockChoice?.defenderSeatId,
    mana: slots.manaChoice?.seatId,
    myriadTap: slots.myriadTapChoice?.seatId,
    myriadSearch: slots.myriadSearch?.seatId,
    basicLand: slots.basicLandFetchSearch?.seatId,
    manualSearch: slots.manualLibrarySearch?.seatId
  };
}

/**
 * The prompt slots addressed to `seatId`, and nothing else. This is the single gate for every choice box: the host's own table is fed only
 * `promptSlotsForSeat(slots, hostSeatId)` (so a prompt owed by a remote friend -- Grisly Salvage's look at THEIR library -- never shows on, or
 * accepts answers from, the host's screen), and each friend's snapshot is built from the same function for their own seat.
 */
export function promptSlotsForSeat(slots: PromptSlots, seatId: string): PromptSlots {
  const owners = promptOwnersOf(slots);
  return {
    pendingRuleChoice: owners.rule === seatId ? slots.pendingRuleChoice : undefined,
    libraryLook: owners.look === seatId ? slots.libraryLook : undefined,
    blockChoice: owners.block === seatId ? slots.blockChoice : undefined,
    manaChoice: owners.mana === seatId ? slots.manaChoice : undefined,
    myriadTapChoice: owners.myriadTap === seatId ? slots.myriadTapChoice : undefined,
    myriadSearch: owners.myriadSearch === seatId ? slots.myriadSearch : undefined,
    basicLandFetchSearch: owners.basicLand === seatId ? slots.basicLandFetchSearch : undefined,
    manualLibrarySearch: owners.manualSearch === seatId ? slots.manualLibrarySearch : undefined
  };
}

export interface SeatPromptInput extends PromptSlots {
  session: GameSession;
  seatId: string;
  activeSeatId?: string;
  pendingAction?: PendingAction;
  stackActions: PendingAction[];
  /** The seat's floating mana. */
  manaPool?: ManaPool;
  /** Has the seat used its land drop this turn (hand cards that are lands can only be offered as playable when not). */
  landPlayedThisTurn: boolean;
}

export interface HandCardInfo {
  /** Could be cast right now as a response to what is on the stack (instant speed, payable, legal counter target). */
  canRespond: boolean;
  /** Several faces / halves / land-or-spell choices: the play buttons the table offers for the selected card. */
  faceOptions?: HandCardFaceOption[];
}

export interface SeatPrompts {
  ruleChoice?: ReturnType<typeof ruleChoiceView>;
  blockChoice?: ReturnType<typeof blockChoiceView>;
  manaChoice?: { cardName: string; choices: ManaChoiceState["choices"] };
  myriadTapChoice?: { cardName: string };
  libraryLook?: LibraryLookState;
  myriadSearchCards?: VisibleCard[];
  basicLandFetchSearch?: { sourceCardName: string; cards: VisibleCard[] };
  /** "When this resolves you'll be asked ..." notes by stack item id. */
  stackPrompts: Record<string, string>;
  /** By hand card id. */
  handInfo: Record<string, HandCardInfo>;
  /** Present during the seat's own declare attackers step: who/what it can attack, and which of its creatures can. */
  attackTargets?: Array<{ targetId: string; label: string }>;
  attackerIds: string[];
}

function canLegallyCounter(session: GameSession, card: VisibleCard, pending: PendingAction | undefined): boolean {
  const counterAbility = parseCounterSpellAbility(card.oracleText);
  if (!counterAbility || !pending || pending.type !== "spell") return true;
  const target = findSpellSourceCard(session, pending);
  return target !== undefined && !spellIsImmuneToCounters(session, target, pending.actorSeatId) && counterSpellCanTarget(counterAbility, target.typeLine, pending.sourceZone === "command");
}

/** Pure: the prompts/hints of ONE seat. Same input -> same output. */
export function buildSeatPrompts(input: SeatPromptInput): SeatPrompts {
  const { session } = input;
  const seat = session.seats.find((item) => item.id === input.seatId) as PlayerSeat;
  const pool = input.manaPool ?? emptyManaPool();
  const mineSlots = promptSlotsForSeat(input, seat.id);
  const look = mineSlots.libraryLook;
  const block = mineSlots.blockChoice;
  const manaChoice = mineSlots.manaChoice;
  const myriadTap = mineSlots.myriadTapChoice;
  const myriadSearch = mineSlots.myriadSearch;
  const basicFetch = mineSlots.basicLandFetchSearch;

  const stackPrompts: Record<string, string> = {};
  for (const item of [...(input.pendingAction ? [input.pendingAction] : []), ...input.stackActions]) {
    const note = resolutionPromptNote(seat, item, session);
    if (note) stackPrompts[item.id] = note;
  }

  const handInfo: Record<string, HandCardInfo> = {};
  for (const card of seat.board.hand) {
    const canRespond =
      canCastAtInstantSpeed(card, seatHasFlashGrant(seat, card)) &&
      canLegallyCounter(session, card, input.pendingAction) &&
      (payCostFromPool(pool, card, card.manaValue).ok || chooseManaSourcesForCost(seat, card, card.manaValue, undefined, session.seats).ok);
    const faceOptions = handCardFaceOptions(seat, card, input.landPlayedThisTurn, input.activeSeatId, pool, session.seats, session);
    handInfo[card.id] = { canRespond, ...(faceOptions && faceOptions.length > 0 ? { faceOptions } : {}) };
  }

  const attacking = input.activeSeatId === seat.id && session.phase === "declare attackers step";
  const attackerIds = attacking ? seat.board.battlefield.filter((card) => canAttack(card, seat.board.battlefield) && !attackLockedOut(session, card)).map((card) => card.id) : [];
  let attackTargets: SeatPrompts["attackTargets"];
  if (attacking && attackerIds.length > 0) {
    attackTargets = [];
    for (const opponent of session.seats.filter((other) => other.id !== seat.id && !other.hasLost)) {
      attackTargets.push({ targetId: opponent.id, label: `Attack ${opponent.name}` });
      for (const planeswalker of opponent.board.battlefield.filter(isPlaneswalkerCard)) {
        attackTargets.push({ targetId: planeswalker.id, label: `Attack ${planeswalker.name} (${opponent.name}, ${loyaltyCounterCount(planeswalker)} loyalty)` });
      }
    }
  }

  return {
    ruleChoice: ruleChoiceView(mineSlots.pendingRuleChoice, seat, mineSlots.manualLibrarySearch, session),
    blockChoice: blockChoiceView(session, block),
    manaChoice: manaChoice ? { cardName: manaChoice.cardName, choices: manaChoice.choices } : undefined,
    myriadTapChoice: myriadTap ? { cardName: myriadTap.cardName } : undefined,
    libraryLook: look,
    myriadSearchCards: myriadSearch ? getMyriadLandscapeOptions(seat.library ?? []) : undefined,
    basicLandFetchSearch: basicFetch ? { sourceCardName: basicFetch.sourceCardName, cards: getBasicLandFetchOptions(seat.library ?? []) } : undefined,
    stackPrompts,
    handInfo,
    attackTargets,
    attackerIds
  };
}
