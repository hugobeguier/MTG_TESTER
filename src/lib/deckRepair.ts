import type { CardRecord, DeckCard } from "./types";
import { isBracketThreeBannedCard, wouldCompleteEarlyCombo } from "./bracketPolicy";
import type { EdhrecSynergyCard } from "./edhrec";

export interface CardLookup {
  lookup(name: string): CardRecord | undefined;
}

const BASICS_BY_COLOR: Record<string, string> = {
  W: "Plains",
  U: "Island",
  B: "Swamp",
  R: "Mountain",
  G: "Forest"
};

const BASIC_LANDS = new Set([...Object.values(BASICS_BY_COLOR), "Wastes"]);
const TARGET_LANDS = 37;
// Non-land slots are capped at this so fillWithBasics always has room left to reach TARGET_LANDS —
// without this, a land-light generated deck (small local models routinely under-supply lands) gets
// its 100 slots filled entirely by curated spells before basics ever run, and never recovers.
const MAX_NONLAND_CARDS = 100 - TARGET_LANDS;

const CURATED_PACKAGES: Record<string, string[]> = {
  ramp: [
    "Sol Ring",
    "Arcane Signet",
    "Fellwar Stone",
    "Mind Stone",
    "Thought Vessel",
    "Wayfarer's Bauble",
    "Commander's Sphere",
    "Talisman of Progress",
    "Talisman of Dominance",
    "Talisman of Hierarchy",
    "Cultivate",
    "Kodama's Reach",
    "Nature's Lore",
    "Three Visits",
    "Farseek",
    "Skyshroud Claim",
    "Sakura-Tribe Elder",
    "Birds of Paradise",
    "Llanowar Elves",
    "Elvish Mystic"
  ],
  draw: [
    "Skullclamp",
    "Idol of Oblivion",
    "Mind's Eye",
    "Esper Sentinel",
    "Rhystic Study",
    "Mystic Remora",
    "Fact or Fiction",
    "Ponder",
    "Brainstorm",
    "Read the Bones",
    "Night's Whisper",
    "Phyrexian Arena",
    "Harmonize",
    "Guardian Project",
    "Beast Whisperer",
    "Toski, Bearer of Secrets",
    "Reckless Impulse",
    "Faithless Looting"
  ],
  removal: [
    "Swords to Plowshares",
    "Path to Exile",
    "Generous Gift",
    "Beast Within",
    "Krosan Grip",
    "Putrefy",
    "Mortify",
    "Anguished Unmaking",
    "Utter End",
    "Void Rend",
    "Counterspell",
    "Arcane Denial",
    "Negate",
    "Reality Shift",
    "Feed the Swarm",
    "Go for the Throat",
    "Terminate",
    "Bedevil",
    "Chaos Warp",
    "Abrade"
  ],
  wipe: [
    "Austere Command",
    "Farewell",
    "Damnation",
    "Toxic Deluge",
    "Blasphemous Act",
    "Chain Reaction",
    "Cyclonic Rift",
    "Evacuation",
    "Vanquish the Horde"
  ],
  protection: [
    "Swiftfoot Boots",
    "Lightning Greaves",
    "Heroic Intervention",
    "Tamiyo's Safekeeping",
    "Teferi's Protection",
    "Flawless Maneuver",
    "Boros Charm",
    "Malakir Rebirth",
    "Counterspell",
    "Swan Song"
  ],
  threat: [
    "Sun Titan",
    "Consecrated Sphinx",
    "Archon of Sun's Grace",
    "Shark Typhoon",
    "Sigil of the Empty Throne",
    "Starfield of Nyx",
    "Eternal Witness",
    "Avenger of Zendikar",
    "Craterhoof Behemoth",
    "Blood Artist",
    "Pitiless Plunderer",
    "Torment of Hailfire",
    "Young Pyromancer",
    "Talrand, Sky Summoner",
    "Murmuring Mystic",
    "Comet Storm",
    "Approach of the Second Sun"
  ],
  utilityLand: [
    "Command Tower",
    "Path of Ancestry",
    "Exotic Orchard",
    "Reflecting Pool",
    "Reliquary Tower",
    "Myriad Landscape",
    "Bojuka Bog",
    "Rogue's Passage",
    "War Room",
    "Evolving Wilds",
    "Terramorphic Expanse",
    "Prairie Stream",
    "Drowned Catacomb",
    "Glacial Fortress",
    "Isolated Chapel",
    "Caves of Koilos",
    "Adarkar Wastes",
    "Underground River",
    "Temple of Deceit",
    "Temple of Silence"
  ]
};

const PACKAGE_TARGETS: Array<[keyof typeof CURATED_PACKAGES, number]> = [
  ["ramp", 12],
  ["draw", 10],
  ["removal", 10],
  ["wipe", 3],
  ["protection", 5],
  ["threat", 16]
];

export function repairCommanderDeckCards(input: {
  commander: string;
  cards: DeckCard[];
  colors: string[];
  catalog: CardLookup;
  /** EDHREC's live synergy data for this commander, highest-synergy-first; omit if unavailable. */
  synergyCards?: EdhrecSynergyCard[];
}) {
  const commanderRecord = input.catalog.lookup(input.commander);
  const commanderColors = new Set(commanderRecord?.colorIdentity ?? input.colors);
  const colors = commanderColors.size > 0 ? [...commanderColors] : input.colors;
  const repaired: DeckCard[] = [];
  const seenNonBasics = new Set<string>();

  addCard(repaired, { name: commanderRecord?.name ?? input.commander, count: 1, role: "commander", card: commanderRecord });
  seenNonBasics.add(normalizeName(commanderRecord?.name ?? input.commander));

  for (const card of input.cards) {
    if (countCards(repaired) >= 100) break;
    if (card.role === "commander" || normalizeName(card.name) === normalizeName(input.commander)) continue;
    const record = input.catalog.lookup(card.name);
    if (!record) continue;
    if (!isCommanderIdentityLegal(record, commanderColors)) continue;
    if (isBracketThreeBannedCard(record.name)) continue;

    const isBasic = isBasicLand(record.name);
    // Once non-land slots are full, stop admitting more spells (even ones already in the input)
    // so there's still room left for fillWithCuratedCards/fillWithBasics to reach TARGET_LANDS —
    // covers the pathological case where the input itself is already ~100 cards but land-light.
    if (!isBasic && !record.typeLine.includes("Land") && nonLandCount(repaired) >= MAX_NONLAND_CARDS) continue;
    const key = normalizeName(record.name);
    if (!isBasic && seenNonBasics.has(key)) continue;
    if (!isBasic && wouldCompleteEarlyCombo(record.name, seenNonBasics)) continue;
    if (!isBasic) seenNonBasics.add(key);

    const remainingSlots = 100 - countCards(repaired);
    addCard(repaired, {
      ...card,
      name: record.name,
      count: isBasic ? Math.min(card.count, remainingSlots) : 1,
      cardId: record.id,
      card: record
    });
  }

  // EDHREC's synergy picks for this exact commander are a better default than the static curated
  // packages below (which are generic across every commander in a color combination) — slotted in
  // after whatever the LLM/decklist already chose, but before the generic fill, so they get priority
  // over "any removal spell" while still yielding to cards the caller explicitly picked.
  for (const synergyCard of input.synergyCards ?? []) {
    if (countCards(repaired) >= 100) break;
    const key = normalizeName(synergyCard.name);
    if (key === normalizeName(input.commander) || seenNonBasics.has(key)) continue;
    if (isBracketThreeBannedCard(synergyCard.name)) continue;
    const record = input.catalog.lookup(synergyCard.name);
    if (!record) continue;
    if (!isCommanderIdentityLegal(record, commanderColors)) continue;
    if (wouldCompleteEarlyCombo(record.name, seenNonBasics)) continue;
    const isLand = synergyCard.category === "utilitylands" || record.typeLine.includes("Land");
    if (!isLand && nonLandCount(repaired) >= MAX_NONLAND_CARDS) continue;
    seenNonBasics.add(key);
    addCard(repaired, {
      name: record.name,
      count: 1,
      role: synergyCard.category === "utilitylands" ? "land" : undefined,
      cardId: record.id,
      card: record
    });
  }

  fillWithCuratedCards(repaired, seenNonBasics, commanderColors, input.catalog, colors.length > 0 ? colors : ["G"]);
  return repaired;
}

function isCommanderIdentityLegal(card: CardRecord, commanderColors: Set<string>) {
  if (commanderColors.size === 0) return true;
  return card.colorIdentity.every((color) => commanderColors.has(color));
}

function fillWithCuratedCards(cards: DeckCard[], seenNonBasics: Set<string>, commanderColors: Set<string>, catalog: CardLookup, colors: string[]) {
  addPackage(cards, seenNonBasics, commanderColors, catalog, "utilityLand", Math.max(0, TARGET_LANDS - landCount(cards)));

  // Both spell-filling passes below are capped by the remaining non-land budget, not by
  // "however many slots are left until 100" — that's what used to let curated spells claim every
  // remaining slot before fillWithBasics ever got a turn. Land completion (fillWithBasics) always
  // runs last and reaches TARGET_LANDS precisely because these loops can never exceed
  // MAX_NONLAND_CARDS between them.
  for (const [role, target] of PACKAGE_TARGETS) {
    const budget = Math.max(0, MAX_NONLAND_CARDS - nonLandCount(cards));
    addPackage(cards, seenNonBasics, commanderColors, catalog, role, Math.min(Math.max(0, target - roleCount(cards, role)), budget));
  }

  for (const [role] of PACKAGE_TARGETS) {
    const budget = Math.max(0, MAX_NONLAND_CARDS - nonLandCount(cards));
    if (budget <= 0) break;
    addPackage(cards, seenNonBasics, commanderColors, catalog, role, budget);
  }

  fillWithBasics(cards, colors, 100);
}

function addPackage(
  cards: DeckCard[],
  seenNonBasics: Set<string>,
  commanderColors: Set<string>,
  catalog: CardLookup,
  role: keyof typeof CURATED_PACKAGES,
  count: number
) {
  let added = 0;
  for (const name of CURATED_PACKAGES[role]) {
    if (added >= count || countCards(cards) >= 100) break;
    const record = catalog.lookup(name);
    if (!record) continue;
    if (!isCommanderIdentityLegal(record, commanderColors)) continue;
    if (isBracketThreeBannedCard(record.name)) continue;
    if (role === "utilityLand" && landCount(cards) >= TARGET_LANDS) break;
    const key = normalizeName(record.name);
    if (seenNonBasics.has(key)) continue;
    if (wouldCompleteEarlyCombo(record.name, seenNonBasics)) continue;
    seenNonBasics.add(key);
    addCard(cards, { name: record.name, count: 1, role: role === "utilityLand" ? "land" : role, cardId: record.id, card: record });
    added += 1;
  }
}

function fillWithBasics(cards: DeckCard[], colors: string[], target: number) {
  let index = 0;
  while (countCards(cards) < target) {
    const basic = BASICS_BY_COLOR[colors[index % colors.length]] ?? "Wastes";
    addCard(cards, { name: basic, count: 1, role: "land" });
    index += 1;
  }
}

function addCard(cards: DeckCard[], card: DeckCard) {
  const existing = cards.find((item) => item.name === card.name);
  if (existing && isBasicLand(card.name)) {
    existing.count += card.count;
    return;
  }
  cards.push(card);
}

function countCards(cards: DeckCard[]) {
  return cards.reduce((sum, card) => sum + card.count, 0);
}

function landCount(cards: DeckCard[]) {
  return cards.filter((card) => card.role === "land" || isBasicLand(card.name)).reduce((sum, card) => sum + card.count, 0);
}

function nonLandCount(cards: DeckCard[]) {
  return countCards(cards) - landCount(cards);
}

function roleCount(cards: DeckCard[], role: string) {
  return cards.filter((card) => card.role === role).reduce((sum, card) => sum + card.count, 0);
}

function isBasicLand(name: string) {
  return BASIC_LANDS.has(name);
}

function normalizeName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
