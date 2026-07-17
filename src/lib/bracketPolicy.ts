import type { CardRecord, CommanderDeck, DeckValidationReport } from "./types";

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

// Bracket 3 ("Upgraded") bans one-sided/symmetrical mass land destruction/denial outright, per the
// official Commander Brackets rules. Curated and non-exhaustive (same "decline rather than guess"
// scope as GAME_CHANGERS above) — covers the cards most commonly cited by bracket judges, not every
// card that could ever destroy multiple lands.
export const MASS_LAND_DESTRUCTION = new Set([
  "Armageddon",
  "Ravages of War",
  "Catastrophe",
  "Jokulhaups",
  "Decree of Annihilation",
  "Sunder",
  "Cataclysm",
  "Obliterate",
  "Impending Disaster",
  "Cleansing"
]);

// Bracket 3 allows two-card infinite combos only if they can't realistically come together before
// the late game; it does not allow cheap/fast, commonly-known two-card lines. This is a curated list
// of specific well-known "turns on as early as it's assembled" pairs, not a combo detector — a deck
// can still contain either card alone, or a full combo built from three or more pieces, without
// tripping this check. Each pair is unordered.
export const EARLY_INFINITE_COMBO_PAIRS: Array<[string, string]> = [
  ["Thassa's Oracle", "Demonic Consultation"],
  ["Thassa's Oracle", "Tainted Pact"],
  ["Isochron Scepter", "Dramatic Reversal"],
  ["Splinter Twin", "Deceiver Exarch"],
  ["Splinter Twin", "Pestermite"],
  ["Kiki-Jiki, Mirror Breaker", "Deceiver Exarch"],
  ["Kiki-Jiki, Mirror Breaker", "Zealous Conscripts"],
  ["Food Chain", "Eternal Scourge"],
  ["Food Chain", "Squee, Goblin Nabob"],
  ["Heliod, Sun-Crowned", "Walking Ballista"],
  ["Basalt Monolith", "Rings of Brighthearth"]
];

// The official rule targets cards that let a player chain/loop extra turns together (take another
// extra turn as part of resolving one), not merely owning several different one-shot extra-turn
// spells — a deck can run Time Warp, Temporal Manipulation, and Karn's Temporal Sundering together
// and still only ever take one extra turn at a time. Nexus of Fate is the card most commonly named
// by bracket judges for this: shuffling back into the library lets a tutor/wheel effect draw into it
// again the same turn, chaining extra turns rather than taking just one.
export const CHAINABLE_EXTRA_TURN_CARDS = new Set(["Nexus of Fate"]);

export function isMassLandDestruction(cardName: string): boolean {
  return MASS_LAND_DESTRUCTION.has(cardName);
}

export function isChainableExtraTurn(cardName: string): boolean {
  return CHAINABLE_EXTRA_TURN_CARDS.has(cardName);
}

export function isBracketThreeBannedCard(cardName: string): boolean {
  return isMassLandDestruction(cardName) || isChainableExtraTurn(cardName);
}

// Case/punctuation-insensitive so callers can pass either exact card names or an already-
// normalized dedup key (deckRepair.ts's `seenNonBasics`, keyed by its own normalizeName) without
// the two ever silently failing to match each other.
function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function findEarlyComboViolations(cardNames: Iterable<string>): Array<[string, string]> {
  const present = new Set([...cardNames].map(normalize));
  return EARLY_INFINITE_COMBO_PAIRS.filter(([a, b]) => present.has(normalize(a)) && present.has(normalize(b)));
}

// For the deck builder: would adding `candidateName` alongside the cards already chosen complete
// one of the known fast combo pairs? Used to skip a candidate while assembling a deck, rather than
// only catching the finished deck at validation time.
export function wouldCompleteEarlyCombo(candidateName: string, presentNames: ReadonlySet<string>): boolean {
  const candidate = normalize(candidateName);
  const present = new Set([...presentNames].map(normalize));
  return EARLY_INFINITE_COMBO_PAIRS.some(
    ([a, b]) => (normalize(a) === candidate && present.has(normalize(b))) || (normalize(b) === candidate && present.has(normalize(a)))
  );
}

export function validateBracketThreeDeck(
  deck: Pick<CommanderDeck, "commander" | "cards"> & { colors?: string[]; commanderCard?: CardRecord }
): DeckValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const total = deck.cards.reduce((sum, card) => sum + card.count, 0);
  const nonBasicDuplicates = deck.cards.filter(
    (card) => card.count > 1 && !isBasicLand(card)
  );
  const gameChangerCount = deck.cards.reduce(
    (sum, card) => sum + (isGameChanger(card.name, card.card) ? card.count : 0),
    0
  );

  if (!deck.commander.trim()) {
    errors.push("A Commander deck must name a commander.");
  }

  if (deck.commanderCard) {
    const canBeCommander =
      (deck.commanderCard.typeLine.includes("Legendary") && deck.commanderCard.typeLine.includes("Creature")) ||
      /can be your commander/i.test(deck.commanderCard.oracleText);
    if (!canBeCommander) {
      errors.push(`${deck.commanderCard.name} is not a legendary creature commander in this validator.`);
    }
    if (deck.commanderCard.legalities?.commander && deck.commanderCard.legalities.commander !== "legal") {
      errors.push(`${deck.commanderCard.name} is not legal in Commander.`);
    }
  }

  if (total !== 100) {
    errors.push(`Commander decks must contain exactly 100 cards including the commander; found ${total}.`);
  }

  for (const duplicate of nonBasicDuplicates) {
    errors.push(`${duplicate.name} appears ${duplicate.count} times; non-basic cards must be singleton.`);
  }

  const commanderColors = new Set(deck.commanderCard?.colorIdentity ?? deck.colors ?? []);
  for (const card of deck.cards) {
    if (card.name !== deck.commander && isMassLandDestruction(card.name)) {
      errors.push(`${card.name} is mass land destruction/denial, which Bracket 3 does not allow.`);
    }
    if (card.name !== deck.commander && isChainableExtraTurn(card.name)) {
      errors.push(`${card.name} can chain extra turns together, which Bracket 3 does not allow (a single extra turn at a time is fine).`);
    }
    if (!card.card) continue;
    if (card.card.legalities?.commander && card.card.legalities.commander !== "legal") {
      errors.push(`${card.card.name} is not legal in Commander.`);
    }
    const offColor = card.card.colorIdentity.filter((color) => !commanderColors.has(color));
    if ((deck.commanderCard || commanderColors.size > 0) && offColor.length > 0) {
      errors.push(`${card.card.name} has color identity ${card.card.colorIdentity.join("")}, outside commander identity ${[...commanderColors].join("")}.`);
    }
  }

  for (const [a, b] of findEarlyComboViolations(deck.cards.map((card) => card.name))) {
    errors.push(`${a} + ${b} is a fast two-card infinite combo; Bracket 3 only allows combos that can't come together until the late game.`);
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
    uniqueNonBasicCount: deck.cards.filter((card) => !isBasicLand(card)).length,
    gameChangerCount
  };
}

export function scoreDeck(deck: Pick<CommanderDeck, "cards" | "validation">) {
  const landCount = deck.cards
    .filter((card) => card.role === "land" || isBasicLand(card))
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

function isBasicLand(card: CommanderDeck["cards"][number]) {
  return BASIC_LANDS.has(card.name) || card.card?.typeLine.includes("Basic Land") === true;
}

function isGameChanger(name: string, card?: CardRecord) {
  return card?.isGameChanger === true || GAME_CHANGERS.has(name);
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
