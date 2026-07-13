import type { CardRecord, DeckCard } from "./types";

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

    const isBasic = isBasicLand(record.name);
    const key = normalizeName(record.name);
    if (!isBasic && seenNonBasics.has(key)) continue;
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

  fillWithCuratedCards(repaired, seenNonBasics, commanderColors, input.catalog, colors.length > 0 ? colors : ["G"]);
  return repaired;
}

function isCommanderIdentityLegal(card: CardRecord, commanderColors: Set<string>) {
  if (commanderColors.size === 0) return true;
  return card.colorIdentity.every((color) => commanderColors.has(color));
}

function fillWithCuratedCards(cards: DeckCard[], seenNonBasics: Set<string>, commanderColors: Set<string>, catalog: CardLookup, colors: string[]) {
  addPackage(cards, seenNonBasics, commanderColors, catalog, "utilityLand", Math.max(0, TARGET_LANDS - landCount(cards)));

  for (const [role, target] of PACKAGE_TARGETS) {
    addPackage(cards, seenNonBasics, commanderColors, catalog, role, Math.max(0, target - roleCount(cards, role)));
  }

  for (const [role] of PACKAGE_TARGETS) {
    if (countCards(cards) >= 100) break;
    addPackage(cards, seenNonBasics, commanderColors, catalog, role, 100 - countCards(cards));
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
    if (role === "utilityLand" && landCount(cards) >= TARGET_LANDS) break;
    const key = normalizeName(record.name);
    if (seenNonBasics.has(key)) continue;
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

function roleCount(cards: DeckCard[], role: string) {
  return cards.filter((card) => card.role === role).reduce((sum, card) => sum + card.count, 0);
}

function isBasicLand(name: string) {
  return BASIC_LANDS.has(name);
}

function normalizeName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
