// The single "does this permanent currently have its abilities / does it exist at all?" layer shared by the engine, the AI, the interpreters and the UI.
// Two card flags feed it, both recomputed/maintained by the engine:
//   - `abilitiesStripped`: layer 6 "loses all abilities" (Utter Insignificance, Overwhelming Splendor, Vedalken Humiliator...). Derived fresh every
//     state-based-action pass in engine/stateBased.ts from the attachments/effects acting on the permanent. Abilities of the Aura itself (its own
//     {2}{C}: exile ability) belong to a different permanent and are unaffected.
//   - `phasedOut`: rule 702.26 phasing (engine/phasing.ts). A phased-out permanent is treated as though it does not exist at all.
// Layer 6 ordering: `abilitiesStripped` only means the permanent's OWN (printed) abilities are gone. Abilities/keywords granted by other effects follow
// timestamp order (monotonic GameSession.effectTimestampCounter): the state-based pass drops granted keywords/protection/mana/activated abilities whose
// source is older than the latest stripping effect (`abilitiesStrippedAt`) and keeps later ones, so grantedKeywords / grantedManaAbilityText /
// grantedAbilityText are always already filtered and every reader (hasKeyword, abilityOracleText, mana, UI, AI snapshot) just reads them.
// Every scan that reads a battlefield permanent's oracle text as a source of triggers, statics, activated/mana abilities or keywords should go
// through these helpers instead of testing the flags ad hoc (the Copper Dragon bug was a loop that checked `phasedOut` but not `abilitiesStripped`).
import type { VisibleCard } from "./types";

type PhaseFlags = Pick<VisibleCard, "phasedOut">;
type AbilityFlags = Pick<VisibleCard, "phasedOut" | "abilitiesStripped">;

/** Rule 702.26: phased-out permanents are treated as though they do not exist (not counted, not targeted, no triggers, no mana, no combat). */
export function isPhasedOut(card: PhaseFlags): boolean {
  return Boolean(card.phasedOut);
}

/** The permanent exists for rules purposes and still has its own abilities (not phased out, has not lost all abilities). */
export function hasActiveAbilities(card: AbilityFlags): boolean {
  return !card.phasedOut && !card.abilitiesStripped;
}

/** The oracle text whose abilities currently apply: "" when the permanent lost all abilities or is phased out. */
export function activeAbilityText(card: AbilityFlags & Pick<VisibleCard, "oracleText">): string {
  return hasActiveAbilities(card) ? card.oracleText : "";
}

/** The permanents that exist for rules purposes (drops phased-out ones): use for counts, devotion, sweepers, target pools. */
export function existingPermanents<T extends PhaseFlags>(cards: readonly T[]): T[] {
  return cards.filter((card) => !card.phasedOut);
}

/** The permanents whose own abilities apply: use as the source list for triggers, statics, activated and mana abilities. */
export function abilitySources<T extends AbilityFlags>(cards: readonly T[]): T[] {
  return cards.filter(hasActiveAbilities);
}
