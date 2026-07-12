import type { CommanderDeck, DeckValidationReport } from "./types";

const BASIC_LANDS = new Set([
  "Plains",
  "Island",
  "Swamp",
  "Mountain",
  "Forest",
  "Wastes"
]);

export const GAME_CHANGERS = new Set([
  "Ancient Tomb",
  "Cyclonic Rift",
  "Demonic Tutor",
  "Dockside Extortionist",
  "Enlightened Tutor",
  "Fierce Guardianship",
  "Force of Will",
  "Gaea's Cradle",
  "Jeweled Lotus",
  "Mana Crypt",
  "Mana Drain",
  "Mystical Tutor",
  "Rhystic Study",
  "Smothering Tithe",
  "The One Ring",
  "Thassa's Oracle",
  "Vampiric Tutor"
]);

export function validateBracketThreeDeck(
  deck: Pick<CommanderDeck, "commander" | "cards">
): DeckValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const total = deck.cards.reduce((sum, card) => sum + card.count, 0);
  const nonBasicDuplicates = deck.cards.filter(
    (card) => card.count > 1 && !BASIC_LANDS.has(card.name)
  );
  const gameChangerCount = deck.cards.reduce(
    (sum, card) => sum + (GAME_CHANGERS.has(card.name) ? card.count : 0),
    0
  );

  if (!deck.commander.trim()) {
    errors.push("A Commander deck must name a commander.");
  }

  if (total !== 100) {
    errors.push(`Commander decks must contain exactly 100 cards including the commander; found ${total}.`);
  }

  for (const duplicate of nonBasicDuplicates) {
    errors.push(`${duplicate.name} appears ${duplicate.count} times; non-basic cards must be singleton.`);
  }

  if (gameChangerCount > 3) {
    errors.push(`Bracket 3 allows at most 3 Game Changer cards; found ${gameChangerCount}.`);
  }

  if (gameChangerCount === 3) {
    warnings.push("This deck is at the Bracket 3 Game Changer limit.");
  }

  return {
    legal: errors.length === 0,
    errors,
    warnings,
    cardCount: total,
    uniqueNonBasicCount: deck.cards.filter((card) => !BASIC_LANDS.has(card.name)).length,
    gameChangerCount
  };
}

export function scoreDeck(deck: Pick<CommanderDeck, "cards" | "validation">) {
  const landCount = deck.cards
    .filter((card) => card.role === "land" || BASIC_LANDS.has(card.name))
    .reduce((sum, card) => sum + card.count, 0);
  const rampCount = deck.cards.filter((card) => card.role === "ramp").length;
  const drawCount = deck.cards.filter((card) => card.role === "draw").length;
  const removalCount = deck.cards.filter((card) => card.role === "removal").length;
  const protectionCount = deck.cards.filter((card) => card.role === "protection").length;
  const notes: string[] = [];

  const mana = clampScore(100 - Math.abs(37 - landCount) * 8 + rampCount * 2);
  const interaction = clampScore(removalCount * 8);
  const synergy = clampScore(drawCount * 5 + rampCount * 3);
  const resilience = clampScore(protectionCount * 12 + drawCount * 2);
  const curve = clampScore(75);
  const bracketFit = deck.validation.legal ? clampScore(100 - deck.validation.gameChangerCount * 8) : 30;

  if (landCount < 34) notes.push("Land count is low for a Commander deck.");
  if (removalCount < 8) notes.push("Interaction package is thin.");
  if (drawCount < 8) notes.push("Card draw package could be deeper.");

  const total = Math.round((curve + mana + interaction + synergy + resilience + bracketFit) / 6);
  return { total, curve, mana, interaction, synergy, resilience, bracketFit, notes };
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
