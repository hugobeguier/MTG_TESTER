import { describe, expect, it } from "vitest";
import { repairCommanderDeckCards } from "./deckRepair";
import type { CardRecord } from "./types";

describe("repairCommanderDeckCards", () => {
  it("removes off-identity generated cards and fills the deck with legal basics", () => {
    const catalog = makeCatalog([
      card("Shalai, Voice of Plenty", "Legendary Creature - Angel", ["G", "W"]),
      card("Swords to Plowshares", "Instant", ["W"]),
      card("Counterspell", "Instant", ["U"]),
      card("Sol Ring", "Artifact", []),
      card("Arcane Signet", "Artifact", []),
      card("Beast Within", "Instant", ["G"]),
      card("Eternal Witness", "Creature - Human Shaman", ["G"]),
      card("Forest", "Basic Land - Forest", []),
      card("Plains", "Basic Land - Plains", [])
    ]);

    const repaired = repairCommanderDeckCards({
      commander: "Shalai, Voice of Plenty",
      colors: ["G", "W"],
      catalog,
      cards: [
        { name: "Shalai, Voice of Plenty", count: 1, role: "commander" },
        { name: "Swords to Plowshares", count: 1, role: "removal" },
        { name: "Counterspell", count: 1, role: "interaction" }
      ]
    });

    expect(repaired.reduce((sum, item) => sum + item.count, 0)).toBe(100);
    expect(repaired.some((item) => item.name === "Counterspell")).toBe(false);
    expect(repaired.some((item) => item.name === "Swords to Plowshares")).toBe(true);
    expect(repaired.some((item) => item.name === "Sol Ring")).toBe(true);
    expect(repaired.some((item) => item.name === "Beast Within")).toBe(true);
    expect(repaired.filter((item) => ["Forest", "Plains"].includes(item.name)).reduce((sum, item) => sum + item.count, 0)).toBeLessThan(98);
  });

  it("derives a diverse manabase from the commander's real color identity, ignoring a wrong single-color hint fed in as `colors`", () => {
    // Reproduces the reported bug: a five-color commander (The Ur-Dragon) whose caller-supplied
    // `colors` guessed only red ("dragon = red") used to lock in an all-Mountain basic land base.
    const catalog = makeCatalog([
      card("The Ur-Dragon", "Legendary Creature - Dragon", ["W", "U", "B", "R", "G"]),
      card("Sol Ring", "Artifact", []),
      card("Forest", "Basic Land - Forest", []),
      card("Plains", "Basic Land - Plains", []),
      card("Island", "Basic Land - Island", []),
      card("Swamp", "Basic Land - Swamp", []),
      card("Mountain", "Basic Land - Mountain", [])
    ]);

    const repaired = repairCommanderDeckCards({
      commander: "The Ur-Dragon",
      colors: ["R"],
      catalog,
      cards: []
    });

    const mountains = repaired.find((item) => item.name === "Mountain")?.count ?? 0;
    const otherBasics = ["Forest", "Plains", "Island", "Swamp"].map((name) => repaired.find((item) => item.name === name)?.count ?? 0);
    expect(mountains).toBeLessThan(30);
    expect(otherBasics.every((count) => count > 0)).toBe(true);
  });

  it("excludes mass land destruction, chainable extra-turn cards, and one half of an early combo pair", () => {
    const catalog = makeCatalog([
      card("Meren of Clan Nel Toth", "Legendary Creature - Human Shaman", ["B", "G"]),
      card("Armageddon", "Sorcery", ["B"]),
      card("Nexus of Fate", "Instant", ["G"]),
      card("Isochron Scepter", "Artifact", []),
      card("Dramatic Reversal", "Instant", ["G"]),
      card("Sol Ring", "Artifact", []),
      card("Forest", "Basic Land - Forest", []),
      card("Swamp", "Basic Land - Swamp", [])
    ]);

    const repaired = repairCommanderDeckCards({
      commander: "Meren of Clan Nel Toth",
      colors: ["B", "G"],
      catalog,
      cards: [
        { name: "Isochron Scepter", count: 1 },
        { name: "Dramatic Reversal", count: 1 },
        { name: "Sol Ring", count: 1 }
      ],
      synergyCards: [
        { name: "Armageddon", category: "sorceries", synergy: 0.9 },
        { name: "Nexus of Fate", category: "instants", synergy: 0.8 }
      ]
    });

    expect(repaired.some((item) => item.name === "Armageddon")).toBe(false);
    expect(repaired.some((item) => item.name === "Nexus of Fate")).toBe(false);
    expect(repaired.some((item) => item.name === "Isochron Scepter")).toBe(true);
    expect(repaired.some((item) => item.name === "Dramatic Reversal")).toBe(false);
  });
  it("tops up a land-light generated deck to the target land count", () => {
    // Simulates the reported bug: a small local model returns a deck with real, catalog-resolvable
    // spells but almost no lands. Every curated non-basic name here resolves (unlike the tiny
    // catalogs above, which mostly don't, so they never exercised this path), so pre-fix behavior
    // would let these spells fill all 100 slots before basics ever got a turn.
    const catalog = makeCatalog([
      card("Shalai, Voice of Plenty", "Legendary Creature - Angel", ["G", "W"]),
      ...CURATED_SPELL_NAMES.map((name) => card(name, "Instant", [])),
      ...CURATED_LAND_NAMES.map((name) => card(name, "Land", [])),
      card("Forest", "Basic Land - Forest", []),
      card("Plains", "Basic Land - Plains", [])
    ]);

    const repaired = repairCommanderDeckCards({
      commander: "Shalai, Voice of Plenty",
      colors: ["G", "W"],
      catalog,
      cards: []
    });

    expect(repaired.reduce((sum, item) => sum + item.count, 0)).toBe(100);
    const lands = repaired
      .filter((item) => item.role === "land" || ["Forest", "Plains"].includes(item.name))
      .reduce((sum, item) => sum + item.count, 0);
    expect(lands).toBeGreaterThanOrEqual(36);
  });

  it("reaches the land target even when the input is already 100 cards but land-light", () => {
    // Only 6 of the 100 input cards are lands — pre-fix, the copy loop alone would fill all 100
    // slots with spells (capped only by "countCards < 100"), leaving fillWithBasics nothing to do.
    const spellInput = CURATED_SPELL_NAMES.slice(0, 94).map((name) => ({ name, count: 1 }));
    const landInput = CURATED_LAND_NAMES.slice(0, 6).map((name) => ({ name, count: 1, role: "land" }));
    const catalog = makeCatalog([
      card("Meren of Clan Nel Toth", "Legendary Creature - Human Shaman", ["B", "G"]),
      ...CURATED_SPELL_NAMES.map((name) => card(name, "Instant", [])),
      ...CURATED_LAND_NAMES.map((name) => card(name, "Land", []))
    ]);

    const repaired = repairCommanderDeckCards({
      commander: "Meren of Clan Nel Toth",
      colors: ["B", "G"],
      catalog,
      cards: [...spellInput, ...landInput]
    });

    expect(repaired.reduce((sum, item) => sum + item.count, 0)).toBe(100);
    const lands = repaired.filter((item) => item.role === "land").reduce((sum, item) => sum + item.count, 0);
    expect(lands).toBeGreaterThanOrEqual(36);
  });
});

// Real curated-package names (see CURATED_PACKAGES in deckRepair.ts) so addPackage/the copy loop
// actually resolves them against the test catalog — the smaller catalogs in the tests above mostly
// don't match any curated name, which is why they never exercised the land-shortfall bug.
const CURATED_SPELL_NAMES = [
  "Sol Ring", "Arcane Signet", "Fellwar Stone", "Mind Stone", "Thought Vessel", "Wayfarer's Bauble",
  "Commander's Sphere", "Talisman of Progress", "Talisman of Dominance", "Talisman of Hierarchy",
  "Cultivate", "Kodama's Reach", "Nature's Lore", "Three Visits", "Farseek", "Skyshroud Claim",
  "Sakura-Tribe Elder", "Birds of Paradise", "Llanowar Elves", "Elvish Mystic",
  "Skullclamp", "Idol of Oblivion", "Mind's Eye", "Esper Sentinel", "Rhystic Study", "Mystic Remora",
  "Fact or Fiction", "Ponder", "Brainstorm", "Read the Bones", "Night's Whisper", "Phyrexian Arena",
  "Harmonize", "Guardian Project", "Beast Whisperer", "Toski, Bearer of Secrets", "Reckless Impulse",
  "Faithless Looting",
  "Swords to Plowshares", "Path to Exile", "Generous Gift", "Beast Within", "Krosan Grip", "Putrefy",
  "Mortify", "Anguished Unmaking", "Utter End", "Void Rend", "Counterspell", "Arcane Denial", "Negate",
  "Reality Shift", "Feed the Swarm", "Go for the Throat", "Terminate", "Bedevil", "Chaos Warp", "Abrade",
  "Austere Command", "Farewell", "Damnation", "Toxic Deluge", "Blasphemous Act", "Chain Reaction",
  "Cyclonic Rift", "Evacuation", "Vanquish the Horde",
  "Swiftfoot Boots", "Lightning Greaves", "Heroic Intervention", "Tamiyo's Safekeeping",
  "Teferi's Protection", "Flawless Maneuver", "Boros Charm", "Malakir Rebirth", "Swan Song",
  "Sun Titan", "Consecrated Sphinx", "Archon of Sun's Grace", "Shark Typhoon",
  "Sigil of the Empty Throne", "Starfield of Nyx", "Eternal Witness", "Avenger of Zendikar",
  "Craterhoof Behemoth", "Blood Artist", "Pitiless Plunderer", "Torment of Hailfire",
  "Young Pyromancer", "Talrand, Sky Summoner", "Murmuring Mystic", "Comet Storm",
  "Approach of the Second Sun"
];

const CURATED_LAND_NAMES = [
  "Command Tower", "Path of Ancestry", "Exotic Orchard", "Reflecting Pool", "Reliquary Tower",
  "Myriad Landscape", "Bojuka Bog", "Rogue's Passage", "War Room", "Evolving Wilds",
  "Terramorphic Expanse", "Prairie Stream", "Drowned Catacomb", "Glacial Fortress", "Isolated Chapel",
  "Caves of Koilos", "Adarkar Wastes", "Underground River", "Temple of Deceit", "Temple of Silence"
];

function makeCatalog(cards: CardRecord[]) {
  return {
    lookup: (name: string) => cards.find((card) => card.name === name)
  };
}

function card(name: string, typeLine: string, colorIdentity: string[]): CardRecord {
  return {
    id: `test-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    typeLine,
    oracleText: "Test oracle text.",
    manaValue: typeLine.includes("Land") ? 0 : 1,
    colors: colorIdentity,
    colorIdentity,
    legalities: { commander: "legal" }
  };
}
