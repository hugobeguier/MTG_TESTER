// Pure type-line parsing shared by the Node-only observer lookup (draftLookup.ts) and the browser-safe adapter / card packs.
const SUPERS = new Set(["legendary", "basic", "snow", "world", "ongoing"]);
const TYPES = new Set(["artifact", "creature", "enchantment", "instant", "land", "planeswalker", "sorcery", "battle", "kindred", "tribal"]);

/** "Legendary Artifact Creature — Elf Druid" -> lowercase types, supertypes, subtypes as printed. "Token" is dropped. */
export function parseTypeLine(line: string): { types: string[]; subtypes: string[]; supertypes: string[] } {
  // the legacy engine writes its token type lines with an ASCII hyphen ("Token Artifact - Treasure", "Token Creature - Insect")
  const front = line.split(" // ")[0].replace(/^([^—]*?)\s-\s/, "$1 — ");
  const [left, right] = front.split(" — ");
  const words = left.split(/\s+/).map((w) => w.toLowerCase()).filter(Boolean);
  return { types: words.filter((w) => TYPES.has(w)), supertypes: words.filter((w) => SUPERS.has(w)), subtypes: right ? right.split(/\s+/).filter(Boolean) : [] };
}
