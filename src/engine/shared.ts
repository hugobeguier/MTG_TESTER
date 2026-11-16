// Tiny shared leaf helpers for src/engine/* modules, extracted verbatim from components/AppFlow.tsx.
// Keeps engine modules (mana.ts, later costs.ts/lands.ts, ...) from importing back from AppFlow.
// AppFlow.tsx imports these and re-exports the ones that were previously public (isLandCard).

import type { VisibleCard } from "@/lib/types";
import { hasKeyword as hasKeywordText } from "@/lib/keywords";

export const COMMANDER_STARTING_LIFE = 40;

export function hasKeyword(card: VisibleCard, keyword: string) {
  // Layer 6: a creature that's lost all abilities (Utter Insignificance, Overwhelming Splendor —
  // see abilitiesStripped's doc comment) has neither its printed keywords nor any granted ones,
  // regardless of what either source's text says.
  if (card.abilitiesStripped) return false;
  return hasKeywordText(card.oracleText, keyword) || Boolean(card.grantedKeywords?.includes(keyword));
}

export function hasHaste(card: VisibleCard) {
  return hasKeyword(card, "haste");
}

export function numberWordToInt(value?: string) {
  if (!value || value === "x") return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) return parsed;
  return (
    {
      a: 1,
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      eleven: 11,
      twelve: 12,
      thirteen: 13,
      fourteen: 14,
      fifteen: 15,
      sixteen: 16,
      seventeen: 17,
      eighteen: 18,
      nineteen: 19,
      twenty: 20
    } as Record<string, number>
  )[value];
}

export function isLandCard(card: VisibleCard) {
  return card.typeLine.includes("Land") || card.role === "land";
}

export function isBasicLandCard(card: VisibleCard) {
  return card.typeLine.includes("Basic Land") || ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"].includes(card.name);
}

export function basicLandTypes(card: VisibleCard) {
  return ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"].filter((type) => card.name === type || card.typeLine.includes(type));
}

export function capitalizeWord(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
