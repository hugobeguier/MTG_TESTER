// The ONE summoning-sickness predicate. The engine tracks a per-permanent `summoningSick` flag (set when a creature enters or changes
// controller, cleared by untapForSeat at the start of its CONTROLLER's next turn); a creature with haste (printed or granted) ignores it,
// and a noncreature permanent is never "sick" (a Vehicle only counts while it is currently a creature, i.e. its typeLine says so).
// Attack legality, {T}-ability legality, mana-source checks AND the table's hourglass badge all call this, so they can never disagree.
import type { VisibleCard } from "@/lib/types";
import { hasHaste } from "@/engine/shared";

export const SUMMONING_SICK_TOOLTIP = "Summoning sick: can't attack or use {T} abilities until its controller's next turn";

export function isSummoningSick(card: Pick<VisibleCard, "typeLine" | "summoningSick" | "oracleText" | "grantedKeywords" | "groupGrantedKeywords" | "abilitiesStripped" | "phasedOut">): boolean {
  return Boolean(card.summoningSick) && card.typeLine.includes("Creature") && !hasHaste(card as VisibleCard);
}

/** Hourglass outline on a 24x24 grid, shared by the HTML badge (inline SVG) and the 3D table's canvas sprite. */
export const HOURGLASS_PATH = "M6 2h12v2c0 3-2 5.5-4.5 8 2.5 2.5 4.5 5 4.5 8v2H6v-2c0-3 2-5.5 4.5-8C8 9.5 6 7 6 4z";
