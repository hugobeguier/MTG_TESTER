import type { CommanderDeck, DeckCard } from "./types";
import { scoreDeck, validateBracketThreeDeck } from "./bracketPolicy";

export interface ParsedDeckList {
  commander?: string;
  cards: DeckCard[];
  errors: string[];
}

const COUNTED_LINE = /^(\d+)\s+(.+?)\s*$/;
const COMMANDER_LINE = /^(commander|general)\s*:\s*(.+?)\s*$/i;
const IGNORED_PREFIX = /^(\/\/|#|sideboard\b|maybeboard\b)/i;

export function parseDeckList(input: string, fallbackCommander?: string): ParsedDeckList {
  const merged = new Map<string, DeckCard>();
  const errors: string[] = [];
  let commander = fallbackCommander?.trim() || undefined;

  for (const [index, rawLine] of input.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || IGNORED_PREFIX.test(line)) continue;

    const commanderMatch = line.match(COMMANDER_LINE);
    if (commanderMatch) {
      commander = cleanCardName(commanderMatch[2]);
      addCard(merged, commander, 1, "commander");
      continue;
    }

    const counted = line.match(COUNTED_LINE);
    if (!counted) {
      errors.push(`Line ${index + 1} must look like "1 Sol Ring".`);
      continue;
    }

    const count = Number.parseInt(counted[1], 10);
    const name = cleanCardName(counted[2]);
    if (!Number.isFinite(count) || count < 1) {
      errors.push(`Line ${index + 1} has an invalid count.`);
      continue;
    }
    if (!name) {
      errors.push(`Line ${index + 1} is missing a card name.`);
      continue;
    }

    addCard(merged, name, count, inferRole(name));
    if (!commander) {
      commander = name;
    }
  }

  return { commander, cards: [...merged.values()], errors };
}

export function createDeckFromList(input: {
  owner: string;
  commander?: string;
  deckList: string;
  colors?: string[];
}): CommanderDeck {
  const parsed = parseDeckList(input.deckList, input.commander);
  const commander = parsed.commander ?? input.commander?.trim() ?? "Unknown Commander";
  const validation = validateBracketThreeDeck({ commander, cards: parsed.cards });
  const deck: CommanderDeck = {
    id: slug(`${input.owner}-${commander}`),
    name: `${commander} Deck List`,
    commander,
    bracket: 3,
    colors: input.colors ?? [],
    cards: parsed.cards,
    createdBy: input.owner,
    createdAt: new Date().toISOString(),
    validation: {
      ...validation,
      errors: [...parsed.errors, ...validation.errors]
    },
    score: {
      total: 0,
      curve: 0,
      mana: 0,
      interaction: 0,
      synergy: 0,
      resilience: 0,
      bracketFit: 0,
      notes: []
    }
  };
  deck.validation.legal = deck.validation.errors.length === 0;
  deck.score = scoreDeck(deck);
  return deck;
}

export function createDeckFromCards(input: {
  owner: string;
  commander: string;
  cards: DeckCard[];
  colors?: string[];
  name?: string;
}): CommanderDeck {
  const validation = validateBracketThreeDeck({ commander: input.commander, cards: input.cards });
  const deck: CommanderDeck = {
    id: slug(`${input.owner}-${input.commander}`),
    name: input.name ?? `${input.commander} Generated Deck`,
    commander: input.commander,
    bracket: 3,
    colors: input.colors ?? [],
    cards: input.cards,
    createdBy: input.owner,
    createdAt: new Date().toISOString(),
    validation,
    score: {
      total: 0,
      curve: 0,
      mana: 0,
      interaction: 0,
      synergy: 0,
      resilience: 0,
      bracketFit: 0,
      notes: []
    }
  };
  deck.score = scoreDeck(deck);
  return deck;
}

function addCard(cards: Map<string, DeckCard>, name: string, count: number, role?: string) {
  const existing = cards.get(name);
  if (existing) {
    existing.count += count;
    existing.role ??= role;
  } else {
    cards.set(name, { name, count, role });
  }
}

function cleanCardName(name: string) {
  return name
    .replace(/\s+\*[A-Z]+\*\s*$/i, "")
    .replace(/\s+\[[^\]]+\]\s*$/i, "")
    .replace(/\s+\([A-Z0-9]{2,6}\)\s+[A-Z0-9-]+[a-z]?\s*$/i, "")
    .replace(/\s+\([^)]+\)\s*$/i, "")
    .trim();
}

function inferRole(name: string) {
  const lower = name.toLowerCase();
  if (["plains", "island", "swamp", "mountain", "forest", "wastes"].includes(lower) || lower.includes("tower")) {
    return "land";
  }
  if (lower.includes("signet") || lower.includes("talisman") || lower.includes("sol ring")) return "ramp";
  if (lower.includes("draw") || lower.includes("study") || lower.includes("clamp")) return "draw";
  if (lower.includes("swords") || lower.includes("path to exile") || lower.includes("destroy")) return "removal";
  return "spell";
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
