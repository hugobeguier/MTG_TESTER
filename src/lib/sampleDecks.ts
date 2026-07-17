import type { CardRecord, CommanderDeck, DeckCard } from "./types";
import { scoreDeck, validateBracketThreeDeck } from "./bracketPolicy";

export interface SampleDeckCatalog {
  lookup(name: string): CardRecord | undefined;
}

const BASICS_BY_COLOR: Record<string, string> = {
  W: "Plains",
  U: "Island",
  B: "Swamp",
  R: "Mountain",
  G: "Forest"
};

const COLORLESS_LANDS = [
  "Command Tower",
  "Path of Ancestry",
  "Exotic Orchard",
  "Reflecting Pool",
  "Reliquary Tower",
  "Temple of the False God",
  "Myriad Landscape",
  "Bojuka Bog",
  "Rogue's Passage",
  "War Room"
];

const ROLE_PACKAGES: Record<string, string[]> = {
  ramp: [
    "Sol Ring",
    "Arcane Signet",
    "Fellwar Stone",
    "Wayfarer's Bauble",
    "Mind Stone",
    "Commander's Sphere",
    "Thought Vessel",
    "Cultivate",
    "Kodama's Reach",
    "Nature's Lore",
    "Three Visits",
    "Skyshroud Claim"
  ],
  draw: [
    "Skullclamp",
    "Guardian Project",
    "Beast Whisperer",
    "Harmonize",
    "Return of the Wildspeaker",
    "Rishkar's Expertise",
    "Toski, Bearer of Secrets",
    "Idol of Oblivion",
    "Village Rites",
    "Read the Bones",
    "Fact or Fiction",
    "Reconnaissance Mission"
  ],
  removal: [
    "Swords to Plowshares",
    "Path to Exile",
    "Generous Gift",
    "Beast Within",
    "Krosan Grip",
    "Putrefy",
    "Mortify",
    "Chaos Warp",
    "Terminate",
    "Reality Shift",
    "Feed the Swarm",
    "Bedevil"
  ],
  wipe: ["Austere Command", "Blasphemous Act", "Damnation", "Toxic Deluge"],
  protection: [
    "Heroic Intervention",
    "Swiftfoot Boots",
    "Lightning Greaves",
    "Teferi's Protection",
    "Tamiyo's Safekeeping",
    "Flawless Maneuver",
    "Boros Charm",
    "Malakir Rebirth"
  ],
  synergy: [
    "Eternal Witness",
    "Reclamation Sage",
    "Sakura-Tribe Elder",
    "Solemn Simulacrum",
    "Acidic Slime",
    "Avenger of Zendikar",
    "Sun Titan",
    "Seedborn Muse",
    "Victimize",
    "Living Death",
    "Young Pyromancer",
    "Talrand, Sky Summoner",
    "Murmuring Mystic",
    "Past in Flames",
    "Sevinne's Reclamation",
    "Anointed Procession",
    "Champion of Lambholt",
    "Cathars' Crusade",
    "Mazirek, Kraul Death Priest",
    "Viscera Seer",
    "Blood Artist",
    "Pitiless Plunderer"
  ],
  wincon: [
    "Craterhoof Behemoth",
    "Torment of Hailfire",
    "Finale of Devastation",
    "Comet Storm",
    "Approach of the Second Sun",
    "Overwhelming Stampede"
  ]
};

// `catalog` is optional so callers with no card database loaded (the demo-seat seed in
// sessionStore.ts, this module's own tests) can keep passing colors directly — but whenever it's
// available (the /api/decks/build fallback path), the commander's real color identity always wins
// over the caller's guess. Without this, a caller that mis-guesses a commander's colors (e.g. a
// naive "dragon = red" hint for a 5-color commander like The Ur-Dragon) would bake that wrong,
// lopsided mana base into the deck here, before repairCommanderDeckCards ever gets a chance to
// recompute it correctly — basics aren't deduped/rebalanced later, only topped up.
export function createSampleDeck(agentName: string, commander: string, colors: string[], catalog?: SampleDeckCatalog): CommanderDeck {
  const commanderColorIdentity = catalog?.lookup(commander)?.colorIdentity;
  const baseColors = commanderColorIdentity && commanderColorIdentity.length > 0 ? commanderColorIdentity : colors;
  const normalizedColors = baseColors.length === 0 ? ["G"] : baseColors;
  const cards = uniqueCards([
    { name: commander, count: 1, role: "commander" },
    ...takeRole("ramp", 12),
    ...takeRole("draw", 10),
    ...takeRole("removal", 10),
    ...takeRole("wipe", 3),
    ...takeRole("protection", 6),
    ...takeRole("synergy", 20),
    ...takeRole("wincon", 2),
    ...landPackage(normalizedColors)
  ]);

  fillWithBasics(cards, normalizedColors, 100);

  const draft = { commander, cards };
  const validation = validateBracketThreeDeck(draft);
  const deck: CommanderDeck = {
    id: slug(`${agentName}-${commander}`),
    name: `${commander} Bracket 3 Draft`,
    commander,
    bracket: 3,
    colors: normalizedColors,
    cards,
    createdBy: agentName,
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

function takeRole(role: keyof typeof ROLE_PACKAGES, count: number): DeckCard[] {
  return ROLE_PACKAGES[role].slice(0, count).map((name) => ({ name, count: 1, role }));
}

function landPackage(colors: string[]): DeckCard[] {
  return COLORLESS_LANDS.slice(0, Math.min(10, 4 + colors.length * 2)).map((name) => ({ name, count: 1, role: "land" }));
}

function fillWithBasics(cards: DeckCard[], colors: string[], target: number) {
  let index = 0;
  while (cards.reduce((sum, card) => sum + card.count, 0) < target) {
    const basic = BASICS_BY_COLOR[colors[index % colors.length]] ?? "Forest";
    const existing = cards.find((card) => card.name === basic);
    if (existing) existing.count += 1;
    else cards.push({ name: basic, count: 1, role: "land" });
    index += 1;
  }
}

function uniqueCards(cards: DeckCard[]) {
  const seen = new Set<string>();
  return cards.filter((card) => {
    if (seen.has(card.name)) return false;
    seen.add(card.name);
    return true;
  });
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
