// Parses characteristic-defining abilities (layer 7a) — "This creature's power and toughness are
// each equal to the number of X you control" — the most common CDA shape in the Commander pool.
// Compound conditions ("plus the number of..."), opponent-based counts, graveyard/hand-size
// counts, and devotion are all out of scope; those are recognized as "not this pattern" and
// simply left unparsed rather than guessed at.

export type CdaStat = "both" | "power" | "toughness";

export interface CharacteristicDefiningAbility {
  stat: CdaStat;
  matcher: string;
}

export function parseCharacteristicDefiningAbility(oracleText: string): CharacteristicDefiningAbility | undefined {
  const text = oracleText.toLowerCase();

  const both = text.match(/power and toughness are each equal to the number of ([a-z ]+?) you control\b/);
  if (both) return { stat: "both", matcher: both[1].trim() };

  const powerOnly = text.match(/(?<!and toughness )\bpower is equal to the number of ([a-z ]+?) you control\b/);
  if (powerOnly) return { stat: "power", matcher: powerOnly[1].trim() };

  const toughnessOnly = text.match(/\btoughness is equal to the number of ([a-z ]+?) you control\b/);
  if (toughnessOnly) return { stat: "toughness", matcher: toughnessOnly[1].trim() };

  return undefined;
}

const BROAD_CATEGORIES: Record<string, (typeLine: string) => boolean> = {
  land: (typeLine) => typeLine.includes("Land"),
  lands: (typeLine) => typeLine.includes("Land"),
  creature: (typeLine) => typeLine.includes("Creature"),
  creatures: (typeLine) => typeLine.includes("Creature"),
  artifact: (typeLine) => typeLine.includes("Artifact"),
  artifacts: (typeLine) => typeLine.includes("Artifact"),
  enchantment: (typeLine) => typeLine.includes("Enchantment"),
  enchantments: (typeLine) => typeLine.includes("Enchantment"),
  permanent: () => true,
  permanents: () => true
};

// Counts the matcher against a single battlefield (the CDA's own controller's — "you control").
export function countMatchingPermanents(battlefield: Array<{ typeLine: string }>, matcher: string): number {
  const key = matcher.trim().toLowerCase();
  const broad = BROAD_CATEGORIES[key];
  if (broad) return battlefield.filter((card) => broad(card.typeLine)).length;

  // Fall back to a creature-subtype match (Elves, Goblins, Zombies, ...): singularize crudely and
  // check it appears in the type line, matching how the rest of this codebase parses subtypes.
  // "ves" -> "f" covers the common Elves/Wolves/Dwarves case; other irregular plurals (e.g.
  // Harpies) aren't handled and will just count 0 rather than match incorrectly.
  const singular = /ves$/i.test(key) ? key.replace(/ves$/i, "f") : key.replace(/s$/, "");
  if (!singular) return 0;
  const capitalized = singular.charAt(0).toUpperCase() + singular.slice(1);
  return battlefield.filter((card) => card.typeLine.includes(capitalized)).length;
}
