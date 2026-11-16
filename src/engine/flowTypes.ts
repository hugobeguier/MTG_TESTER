// Choice-state and legal-action types shared between AppFlow.tsx and the engine modules (library look / scry, myriad and
// basic-land-fetch searches, block choice, mana choice, LegalAgentAction).
// Extracted verbatim from components/AppFlow.tsx; AppFlow.tsx re-exports the previously public symbols.

import { type AgentAction, type ManaColor, type VisibleCard } from "@/lib/types";

// "choose_one_bottom" (Growing Rites of Itlimoc: "look at the top N, reveal a [type] card to
// hand, the rest to the BOTTOM in any order") is its own mode distinct from "choose_one" (Diabolic
// Vision: any card, rest back on TOP) — same look-then-pick shape, different destination for the
// leftover cards and a real type restriction on the pick.
export type LibraryLookMode = "scry" | "surveil" | "reorder" | "choose_one" | "choose_one_bottom" | "vault_look";

export interface LibraryLookState {
  seatId: string;
  // Portent: after the reorder, offer "have that player shuffle" (the card that offers it).
  shuffleOfferSource?: string;
  mode: LibraryLookMode;
  cards: VisibleCard[];
  remaining: number;
  orderedCards?: VisibleCard[];
  // "choose_one_bottom" only: restricts which looked-at card may actually be sent to hand (Growing
  // Rites of Itlimoc's "a creature card", Grisly Salvage's "a creature or land card") — undefined
  // for every other mode, which allow any card.
  allowedCardFilter?: string;
  // "choose_one_bottom" only: where the cards NOT sent to hand go once resolved. Undefined means the
  // bottom of the library (Growing Rites of Itlimoc's own template, and this mode's original/default
  // behavior) — "graveyard" is Grisly Salvage's real destination for the rest.
  restDestination?: "bottom" | "graveyard";
  // "reorder" only, set solely by the direct reorder_top_cards workflow (Ponder's "...then draw a
  // card.") — how many cards to draw once the reorder itself completes. Left unset by every other
  // path that reuses "reorder" mode (the "choose_one" two-phase hand-off, Lim-Dûl's Vault's loop),
  // which have no trailing draw of their own.
  drawCountAfter?: number;
}

export interface MyriadSearchState {
  seatId: string;
  sourceCardId: string;
}

export interface MyriadTapChoiceState {
  seatId: string;
  cardId: string;
  cardName: string;
}

export interface BasicLandFetchSearchState {
  seatId: string;
  sourceCardId: string;
  sourceCardName: string;
}

export interface ManualLibrarySearchState {
  seatId: string;
  destination: "hand";
  tapped?: boolean;
}

export interface BlockChoiceState {
  attackerSeatId: string;
  defenderSeatId: string;
  attackerCardId: string;
  targetId: string;
}

export interface ManaChoiceState {
  seatId: string;
  cardId: string;
  cardName: string;
  location: "battlefield" | "command";
  choices: ManaColor[];
}

export interface LegalAgentAction {
  id: string;
  actionType: AgentAction["actionType"];
  cardId?: string;
  abilityKind?:
    | "basic_land_fetch"
    | "unlock_room_door"
    | "generic_sacrifice"
    | "generic_tap"
    | "self_untap"
    | "generic_mana"
    | "myriad_landscape"
    | "equip"
    | "loyalty_ability"
    | "animate_manland"
    | "cycling";
  abilityIndex?: number;
  // generic_sacrifice only: the permanents the cost would sacrifice (read by the agent play guards, src/lib/playGuards.ts).
  sacrificeCardIds?: string[];
  faceIndex?: number;
  loyaltyCost?: number;
  // Set only for a cast_spell action sourced from exile (impulse-draw/steal-and-play effects) or from the
  // graveyard (flashback, "you may cast this card from your graveyard") — absent means the normal "from hand" path.
  sourceZone?: "exile" | "graveyard" | "library";
  targetIds: string[];
  label: string;
  detail?: string;
  role?: string;
}
