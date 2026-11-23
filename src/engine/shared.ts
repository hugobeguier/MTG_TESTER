// Tiny shared leaf helpers for src/engine/* modules, extracted verbatim from components/AppFlow.tsx.
// Keeps engine modules (mana.ts, later costs.ts/lands.ts, ...) from importing back from AppFlow.
// AppFlow.tsx imports these and re-exports the ones that were previously public (isLandCard).

import type { EmblemState, PlayerSeat, VisibleCard } from "@/lib/types";
import { emblemDisplayName } from "@/lib/phaseTriggers";
import { hasKeyword as hasKeywordText } from "@/lib/keywords";

export const COMMANDER_STARTING_LIFE = 40;

export function hasKeyword(card: VisibleCard, keyword: string) {
  // Layer 6: a creature that's lost all abilities (Utter Insignificance, Overwhelming Splendor —
  // see abilitiesStripped's doc comment) has lost its printed keywords. The granted lists are already
  // timestamp-filtered by the state-based pass (stateBased.ts): grants from effects older than the strip
  // are gone from them, grants from later effects remain, so they are read as-is.
  if (card.phasedOut) return false;
  // "Loses [keyword]" (Archetype of Imagination, Shadowspear): only the printed text is cancelled; grants newer than the loss are already in the granted lists.
  return (!card.abilitiesStripped && !card.lostKeywords?.includes(keyword) && hasKeywordText(card.oracleText, keyword)) || Boolean(card.grantedKeywords?.includes(keyword)) || Boolean(card.groupGrantedKeywords?.includes(keyword));
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

// A TRANSFORMING double-faced card whose front is not a land but whose back is (Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun; Storm the Vault //
// Vault of Catlacan). Its combined type line contains "Land", but in hand it is the nonland front: the back face can only be reached by transforming on
// the battlefield (CR 712.8a-b), never played or cast. (A modal DFC, whose back face has no "(Transforms from ...)" reminder, really can be played as a land.)
export function isNonlandFrontTransformCard(card: VisibleCard): boolean {
  if (!card.faces || card.faces.length !== 2) return false;
  const [front, back] = card.faces;
  return !front.typeLine.includes("Land") && back.typeLine.includes("Land") && /^\(transforms from /i.test(back.oracleText.trim());
}

export function isLandCard(card: VisibleCard) {
  if (isNonlandFrontTransformCard(card)) return false;
  return card.typeLine.includes("Land") || card.role === "land";
}

export function isBasicLandCard(card: VisibleCard) {
  return card.typeLine.includes("Basic Land") || ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"].includes(card.name);
}

export function basicLandTypes(card: VisibleCard) {
  // grantedTypes carries land subtypes handed out by Urborg / Yavimaya ("Each land is a Swamp in addition to its other land types").
  return ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"].filter((type) => card.name === type || card.typeLine.includes(type) || Boolean(card.grantedTypes?.includes(type)));
}

export function capitalizeWord(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// A fake card carrying an emblem's own captured rules text, so it can flow through the exact same
// phase-trigger dispatch (hasPhaseTrigger/applyDeterministicPhaseTrigger/consultRulesAdvisor) a
// real permanent's phase-triggered ability already does — none of that machinery ever needs to look
// the source back up in seat.board.battlefield by id, it only ever reads the VisibleCard it was
// handed directly, so an emblem (which has no battlefield entry at all) can safely stand in as one.
export function emblemAsShimCard(emblem: EmblemState): VisibleCard {
  return {
    id: emblem.id,
    name: emblemDisplayName(emblem.sourceName),
    typeLine: "Emblem",
    oracleText: emblem.oracleText,
    manaValue: 0,
    colors: [],
    colorIdentity: [],
    role: "effect",
    zone: "command"
  };
}

// The seat's emblems as stand-in cards, for static-effect scans that already walk "the permanents that could grant this" (anthems, cost reducers).
export function emblemSourceCards(seat: PlayerSeat): VisibleCard[] {
  return (seat.emblems ?? []).map(emblemAsShimCard);
}
