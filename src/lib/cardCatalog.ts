import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { CardRecord } from "./types";

export interface CardCatalog {
  cards: CardRecord[];
  byName: Map<string, CardRecord>;
  loadedAt?: string;
  source: "generated" | "builtin";
}

interface StoredCardCatalog {
  importedAt?: string;
  source?: string;
  cards: CardRecord[];
}

const CATALOG_PATH = path.join(process.cwd(), "data", "commander-cards.json");

let cachedCatalog: CardCatalog | undefined;
// The data file's modified time when the catalog was cached: a running server picks up a refreshed catalog (npm run cards:import) without a restart.
let cachedCatalogMtimeMs: number | undefined;

export function loadCardCatalog(): CardCatalog {
  const currentMtimeMs = existsSync(CATALOG_PATH) ? statSync(CATALOG_PATH).mtimeMs : undefined;
  if (cachedCatalog && cachedCatalogMtimeMs === currentMtimeMs) return cachedCatalog;

  if (existsSync(CATALOG_PATH)) {
    cachedCatalogMtimeMs = currentMtimeMs;
    const stored = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as StoredCardCatalog;
    cachedCatalog = buildCatalog(stored.cards, stored.importedAt, "generated");
    return cachedCatalog;
  }

  cachedCatalog = buildCatalog(BUILTIN_CARDS, undefined, "builtin");
  return cachedCatalog;
}

export function getCatalogStatus() {
  const catalog = loadCardCatalog();
  return {
    available: catalog.source === "generated",
    source: catalog.source,
    cardCount: catalog.cards.length,
    loadedAt: catalog.loadedAt,
    path: "data/commander-cards.json"
  };
}



export function lookupCard(catalog: CardCatalog, name: string) {
  return catalog.byName.get(normalizeCardName(name));
}

export function normalizeCardName(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9/+ -]/g, "")
    .replace(/\s*\/+\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
}



export function buildCatalog(cards: CardRecord[], loadedAt: string | undefined, source: CardCatalog["source"]): CardCatalog {
  const byName = new Map<string, CardRecord>();
  for (const card of cards) {
    byName.set(normalizeCardName(card.name), card);
  }
  for (const card of cards) {
    if (card.faces) {
      for (const face of card.faces) {
        const faceName = normalizeCardName(face.name);
        if (!byName.has(faceName)) {
          byName.set(faceName, card);
        }
      }
    }
  }
  return { cards, byName, loadedAt, source };
}




const BUILTIN_CARDS: CardRecord[] = [
  {
    id: "builtin-sol-ring",
    name: "Sol Ring",
    typeLine: "Artifact",
    oracleText: "Tap: Add two colorless mana.",
    manaCost: "{1}",
    manaValue: 1,
    colors: [],
    colorIdentity: [],
    legalities: { commander: "legal" }
  },
  {
    id: "builtin-arcane-signet",
    name: "Arcane Signet",
    typeLine: "Artifact",
    oracleText: "Tap: Add one mana of any color in your commander's color identity.",
    manaCost: "{2}",
    manaValue: 2,
    colors: [],
    colorIdentity: [],
    legalities: { commander: "legal" }
  },
  {
    id: "builtin-command-tower",
    name: "Command Tower",
    typeLine: "Land",
    oracleText: "Tap: Add one mana of any color in your commander's color identity.",
    manaValue: 0,
    colors: [],
    colorIdentity: [],
    legalities: { commander: "legal" }
  },
  ...["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"].map((name) => ({
    id: `builtin-${name.toLowerCase()}`,
    name,
    typeLine: name === "Wastes" ? "Basic Land" : `Basic Land - ${name}`,
    oracleText: "Tap: Add mana.",
    manaValue: 0,
    colors: [],
    colorIdentity: [],
    legalities: { commander: "legal" }
  })),
  commander("Atraxa, Praetors' Voice", ["W", "U", "B", "G"], "Flying, vigilance, deathtouch, lifelink. At the beginning of your end step, proliferate.", "4", "4"),
  commander("Shalai, Voice of Plenty", ["G", "W"], "Flying. You, planeswalkers you control, and other creatures you control have hexproof.", "3", "4"),
  commander("Kess, Dissident Mage", ["U", "B", "R"], "During each of your turns, you may cast an instant or sorcery card from your graveyard.", "3", "4"),
  commander("Meren of Clan Nel Toth", ["B", "G"], "Whenever another creature you control dies, you get an experience counter.", "3", "4")
];

function commander(name: string, colorIdentity: string[], oracleText: string, power: string, toughness: string): CardRecord {
  return {
    id: `builtin-${normalizeCardName(name).replace(/[^a-z0-9]+/g, "-")}`,
    name,
    typeLine: "Legendary Creature - Commander",
    oracleText,
    manaCost: "{4}",
    manaValue: 4,
    colors: colorIdentity,
    colorIdentity,
    power,
    toughness,
    legalities: { commander: "legal" }
  };
}
