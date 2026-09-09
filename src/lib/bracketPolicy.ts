import type { CardRecord, CommanderDeck, DeckArchetype, DeckValidationReport } from "./types";

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

// The leading ratio must beat the runner-up by at least this multiple to count as a real signal
// rather than noise from an otherwise-balanced 100-card pile — without it, decks that are only
// marginally more removal-heavy than draw-heavy (or vice versa) would get force-sorted into a
// archetype they don't really commit to.
const ARCHETYPE_DOMINANCE_MARGIN = 1.2;
// A board-presence-heavy deck whose creatures/threats average above this mana value reads as "big
// stuff," not "aggro" — aggro specifically means it's trying to win fast and cheap.
const AGGRO_AVG_MANA_VALUE_CEILING = 3.5;

function nonlandCardsOf(deck: Pick<CommanderDeck, "cards">) {
  return deck.cards.filter((card) => card.role !== "land" && card.role !== "commander" && !isBasicLand(card));
}

function countByRole(cards: CommanderDeck["cards"], roles: string[]) {
  return cards.filter((card) => roles.includes(card.role ?? "")).reduce((sum, card) => sum + card.count, 0);
}

// Classifies a deck's game plan from its already-tagged card roles (see deckParser.ts'
// inferRoleFromRecord/inferRole and deckRepair.ts' CURATED_PACKAGES, the source of every role a
// card in `cards` can carry) rather than any new per-card data. Deliberately coarse: "combo" here
// really means "light on board presence, heavy on ramp/card selection" — a genuine proxy given this
// engine has no dedicated combo-piece tag, not a claim that specific combo pieces were detected.
export function inferDeckArchetype(deck: Pick<CommanderDeck, "cards">): DeckArchetype {
  const nonland = nonlandCardsOf(deck);
  const nonlandTotal = nonland.reduce((sum, card) => sum + card.count, 0);
  if (nonlandTotal === 0) return "midrange";

  const boardPresenceRatio = countByRole(nonland, ["creature", "threat"]) / nonlandTotal;
  const interactionRatio = countByRole(nonland, ["removal", "wipe"]) / nonlandTotal;
  const advantageRatio = countByRole(nonland, ["draw", "ramp"]) / nonlandTotal;

  const ranked = (
    [
      { archetype: "aggro", ratio: boardPresenceRatio },
      { archetype: "control", ratio: interactionRatio },
      { archetype: "combo", ratio: advantageRatio }
    ] satisfies Array<{ archetype: DeckArchetype; ratio: number }>
  ).sort((a, b) => b.ratio - a.ratio);

  const [leader, runnerUp] = ranked;
  if (leader.ratio === 0 || leader.ratio < runnerUp.ratio * ARCHETYPE_DOMINANCE_MARGIN) return "midrange";

  if (leader.archetype === "aggro") {
    const manaValues = nonland
      .filter((card) => card.role === "creature" || card.role === "threat")
      .map((card) => card.card?.manaValue)
      .filter((value): value is number => value !== undefined);
    const avgManaValue = manaValues.length > 0 ? manaValues.reduce((sum, value) => sum + value, 0) / manaValues.length : undefined;
    if (avgManaValue !== undefined && avgManaValue > AGGRO_AVG_MANA_VALUE_CEILING) return "midrange";
  }

  return leader.archetype;
}

// Individual role categories worth naming in a game plan summary — a finer grain than the three
// combined ratios inferDeckArchetype sorts on above, since "leans on ramp and card draw" is a more
// concrete, actionable reminder than the archetype label alone.
const GAME_PLAN_ROLE_LABELS: Record<string, string> = {
  ramp: "ramp",
  draw: "card draw",
  removal: "removal",
  wipe: "board wipes",
  protection: "protection",
  threat: "threats",
  creature: "creatures"
};

const ARCHETYPE_LABEL: Record<DeckArchetype, string> = {
  aggro: "an aggro deck",
  control: "a control deck",
  combo: "a combo deck",
  midrange: "a midrange deck"
};

const ARCHETYPE_TACTICAL_LINE: Record<DeckArchetype, string> = {
  aggro: "Curve out with cheap threats and keep the pressure on before the table stabilizes.",
  control: "Hold up interaction, answer the biggest threat, and look to win in the late game.",
  combo: "Use ramp and card selection to assemble the plan, then protect it once it's found.",
  midrange: "Develop the board and answer threats as they come, rather than racing toward one plan."
};

// Composes a short, deterministic strategy summary for a deck at build time (see deckParser.ts'
// createDeckFromList/createDeckFromCards) — no new LLM call, so it works identically for every deck
// build path and stays stable/testable. Deliberately doesn't repeat the commander's own oracle text
// (agentSeatSnapshot in AppFlow.tsx already sends that separately); this is the strategic summary
// layered on top of it, so e.g. Saheeli's actual cost-reduction ability is read from one place and
// "this deck leans on ramp and threats" from another.
export function buildDeckGamePlan(deck: Pick<CommanderDeck, "cards">, archetype: DeckArchetype): string {
  const nonland = nonlandCardsOf(deck);
  const leaningOn = Object.entries(GAME_PLAN_ROLE_LABELS)
    .map(([role, label]) => ({ label, count: countByRole(nonland, [role]) }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
    .map((entry) => entry.label)
    .join(" and ");

  const summary = leaningOn ? `This is ${ARCHETYPE_LABEL[archetype]} leaning on ${leaningOn}.` : `This is ${ARCHETYPE_LABEL[archetype]}.`;
  return `${summary} ${ARCHETYPE_TACTICAL_LINE[archetype]}`;
}

function isGameChanger(name: string, card?: CardRecord) {
  return card?.isGameChanger === true || GAME_CHANGERS.has(name);
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
