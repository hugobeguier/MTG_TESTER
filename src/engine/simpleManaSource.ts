// "A permanent whose only function is producing mana": one click taps it for mana (no card inspector needed). Shared by the host's click handling
// (components/game/useManaUi.ts) and a remote friend's table (RemoteTable decides locally whether a click is a tap or an inspect).
import { isEquipment } from "@/lib/attachments";
import { parseGenericSacrificeAbilities, parseGenericTapAbilities } from "@/lib/activatedAbilities";
import { basicLandFetchCostRequiresTap, isBasicLandFetchAbility } from "@/lib/oracleClauses";
import { abilityOracleText } from "@/lib/typeGrants";
import type { PlayerSeat, VisibleCard } from "@/lib/types";
import { isAvailableManaSource } from "./mana";

/**
 * A mana land/rock (not a creature, not equipment) with no second real ability that also costs {T}: a card with one (Mind Stone's "{1},{T}, Sacrifice: draw",
 * a generic tap ability, a land-fetch needing {T}) is not "simple", because a bare click could never reach that other ability.
 */
export function isSimpleManaSourcePermanent(card: VisibleCard, seat: PlayerSeat, seats: PlayerSeat[]): boolean {
  return (
    !card.typeLine.includes("Creature") &&
    !isEquipment(card) &&
    isAvailableManaSource(card, seat, seats) &&
    !parseGenericSacrificeAbilities(abilityOracleText(card)).some((ability) => ability.costTap) &&
    parseGenericTapAbilities(abilityOracleText(card)).length === 0 &&
    !(isBasicLandFetchAbility(card) && basicLandFetchCostRequiresTap(card))
  );
}
