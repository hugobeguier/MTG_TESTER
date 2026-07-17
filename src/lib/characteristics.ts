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

export type ManaColorLetter = "W" | "U" | "B" | "R" | "G";

export interface DevotionCda {
  stat: CdaStat;
  color: ManaColorLetter;
}

const COLOR_NAMES: Record<string, ManaColorLetter> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };

// "~'s power is equal to your devotion to blue." (Callaphe, Beloved of the Sea; the whole God
// cycle) — a separate CDA shape from parseCharacteristicDefiningAbility above since devotion counts
// colored mana symbols in printed costs across the battlefield, not a count of matching permanents.
export function parseDevotionCda(oracleText: string): DevotionCda | undefined {
  const text = oracleText.toLowerCase();

  const both = text.match(/power and toughness are each equal to your devotion to (white|blue|black|red|green)\b/);
  if (both) return { stat: "both", color: COLOR_NAMES[both[1]] };

  const powerOnly = text.match(/(?<!and toughness )\bpower is equal to your devotion to (white|blue|black|red|green)\b/);
  if (powerOnly) return { stat: "power", color: COLOR_NAMES[powerOnly[1]] };

  const toughnessOnly = text.match(/\btoughness is equal to your devotion to (white|blue|black|red|green)\b/);
  if (toughnessOnly) return { stat: "toughness", color: COLOR_NAMES[toughnessOnly[1]] };

  return undefined;
}

// Devotion (rule 704.6b-ish, official term): count every colored mana symbol of the given color in
// the mana costs of permanents you control — hybrid ({B/G}) and Phyrexian ({U/P}) symbols count
// toward every color they could produce, not just their "primary" color.
export function computeDevotion(battlefield: Array<{ manaCost?: string }>, color: ManaColorLetter): number {
  let count = 0;
  for (const card of battlefield) {
    const symbols = card.manaCost?.match(/\{[^}]+\}/g) ?? [];
    for (const symbol of symbols) {
      const inner = symbol.slice(1, -1).toUpperCase();
      if (inner.split("/").includes(color)) count += 1;
    }
  }
  return count;
}

// "As this land/artifact/creature/enchantment enters, choose a creature type." (Cavern of Souls,
// Urza's Incubator, Herald's Horn, Morophon, Kindred Discovery, Metallic Mimic, ...) — a mandatory,
// non-optional choice made as part of resolution rather than a "when/whenever" triggered ability,
// so it's checked separately from commonTriggerEffect rather than folded into that union.
export function hasChooseCreatureTypeEtb(oracleText: string): boolean {
  return oracleText
    .split("\n")
    .some((line) => /^as (?:this [a-z]+|[a-z][a-z',. ]*?) enters(?: the battlefield)?,?\s*choose a creature type\.?$/i.test(line.trim()));
}

function creatureTypesOf(typeLine: string): string[] {
  if (!typeLine.includes("Creature")) return [];
  const dashIndex = typeLine.indexOf("—");
  if (dashIndex === -1) return [];
  return typeLine
    .slice(dashIndex + 1)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// Real Magic leaves "choose a creature type" up to the controller with no "correct" answer, and
// this engine has no UI to prompt for a free-form choice yet — so it picks deterministically: the
// creature type most represented across the whole card pool passed in (ideally the controller's
// full deck, not just the current battlefield, so a tribal deck picks its actual tribe even before
// any copies have been drawn), tie-broken alphabetically for determinism.
export function pickChosenCreatureType(cardPool: Array<{ typeLine: string }>): string | undefined {
  const counts = new Map<string, number>();
  for (const card of cardPool) {
    for (const type of creatureTypesOf(card.typeLine)) {
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return sorted[0]?.[0];
}

export interface ChooseColorEtb {
  excludedColor?: ManaColorLetter;
}

// "As [this land/it/this permanent] enters, choose a color[ other than X]." (the Thriving cycle,
// the Gate cycle, Hall of Triumph, ...) — split per-sentence rather than per-line, since some
// cards combine this with an unrelated leading sentence on the same oracle-text line ("This land
// enters tapped. As it enters, choose a color other than black."). A naive whole-line match would
// either miss that shape or, worse, loosely match compound variants this doesn't model ("...choose
// a color and a creature type," "...choose a color word") as if they were the plain single-color
// choice — anchoring each candidate to a single full sentence rules both out.
export function parseChooseColorEtb(oracleText: string): ChooseColorEtb | undefined {
  for (const line of oracleText.split("\n")) {
    for (const sentence of line.split(/(?<=\.)\s+/)) {
      const match = sentence
        .trim()
        .match(/^as (?:this [a-z]+|it|[a-z][a-z',. ]*?) enters,?\s*choose a color(?:\s+other than (white|blue|black|red|green))?\.?$/i);
      if (match) return { excludedColor: match[1] ? COLOR_NAMES[match[1].toLowerCase()] : undefined };
    }
  }
  return undefined;
}

// Same "no UI to prompt for a free-form choice yet, so pick deterministically" reasoning as
// pickChosenCreatureType — picks the colored mana symbol most represented across the whole card
// pool (ideally the controller's full deck, so a mono-color-heavy deck picks the color it actually
// wants before any relevant spells have been drawn), excluding the restricted color, tie-broken
// alphabetically.
export function pickChosenColor(cardPool: Array<{ manaCost?: string }>, excludedColor?: ManaColorLetter): ManaColorLetter | undefined {
  const candidates = (["W", "U", "B", "R", "G"] as ManaColorLetter[]).filter((color) => color !== excludedColor);
  const sorted = candidates.map((color) => ({ color, count: computeDevotion(cardPool, color) })).sort((a, b) => b.count - a.count || a.color.localeCompare(b.color));
  return sorted[0]?.color;
}

export interface SelfAnthemBoost {
  power: number;
  toughness: number;
  matcher: string;
  zone: "battlefield" | "graveyard";
}

// "~ gets +N/+N for each [creature] you control." (a battlefield anthem) or "...for each creature
// card in your graveyard." (Jarad, Golgari Lich Lord-style graveyard anthem) — layer 7d, additive
// on top of whatever base power/toughness layers 7a/7b left behind, unlike
// parseCharacteristicDefiningAbility's replace-the-base CDAs above. Declines the rarer "in all
// graveyards"/opponent-count wording, same "narrow, well-templated shapes only" pattern used
// throughout this codebase.
export function parseSelfAnthemBoost(oracleText: string): SelfAnthemBoost | undefined {
  const text = oracleText.toLowerCase();

  const graveyard = text.match(/\bgets? \+(\d+)\/\+(\d+) for each ([a-z]+) cards? in your graveyard\b/);
  if (graveyard) {
    return { power: Number.parseInt(graveyard[1], 10), toughness: Number.parseInt(graveyard[2], 10), matcher: graveyard[3].trim(), zone: "graveyard" };
  }

  const battlefield = text.match(/\bgets? \+(\d+)\/\+(\d+) for each ([a-z ]+?) you control\b/);
  if (battlefield) {
    return { power: Number.parseInt(battlefield[1], 10), toughness: Number.parseInt(battlefield[2], 10), matcher: battlefield[3].trim(), zone: "battlefield" };
  }

  return undefined;
}

export interface GroupAnthemBoost {
  matcher: string;
  excludeSelf: boolean;
  power: number;
  toughness: number;
  // "Other creatures you control of the chosen type get +1/+1." (Morophon, the Boundless) — only
  // applies to permanents matching the source's own chosenCreatureType (set via
  // pickChosenCreatureType at ETB), on top of the plain matcher qualifier above.
  requiresChosenType?: boolean;
  // Undefined means a flat +N/+N with no multiplier ("Creatures you control get +1/+1.").
  multiplier?: { kind: "counter"; counterKind: string } | { kind: "permanent_count"; countMatcher: string };
}

// "[Other] [Qualifier] you control [of the chosen type] get +N/+N[ for each [kind] counter on
// this/it | for each [X] you control]." (Boon of the Spirit Realm's blessing-counter anthem, plain
// flat group pumps, Morophon's chosen-type anthem, ...) — the group counterpart to
// parseSelfAnthemBoost (which only ever buffs the source itself). Declines opponent-count/
// graveyard-count multipliers and any condition beyond a single "for each" clause — narrow,
// well-templated shapes only, matching this codebase's other deterministic parsers.
export function parseGroupAnthemBoost(oracleText: string): GroupAnthemBoost[] {
  const boosts: GroupAnthemBoost[] = [];
  for (const rawClause of oracleText.split("\n")) {
    const text = rawClause.trim().toLowerCase();
    const match = text.match(
      /^(other\s+)?([a-z][a-z ]*?)\s+(?:you control\s+)?(of the chosen type\s+)?gets? \+(\d+)\/\+(\d+)(?:\s+for each ([a-z0-9+/\- ]+?) counters? on (?:this|it)(?:\s+[a-z]+)?|\s+for each ([a-z ]+?) you control)?\.?$/
    );
    if (!match) continue;
    const counterKind = match[6]?.trim();
    const countMatcher = match[7]?.trim();
    boosts.push({
      matcher: match[2].trim(),
      excludeSelf: Boolean(match[1]),
      requiresChosenType: match[3] ? true : undefined,
      power: Number.parseInt(match[4], 10),
      toughness: Number.parseInt(match[5], 10),
      multiplier: counterKind ? { kind: "counter", counterKind } : countMatcher ? { kind: "permanent_count", countMatcher } : undefined
    });
  }
  return boosts;
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

function matchesQualifierWord(card: { typeLine: string; token?: boolean }, word: string): boolean {
  const broad = BROAD_CATEGORIES[word];
  if (broad) return broad(card.typeLine);
  if (word === "token" || word === "tokens") return Boolean(card.token);

  // Fall back to a creature-subtype match (Elves, Goblins, Zombies, ...): singularize crudely and
  // check it appears in the type line, matching how the rest of this codebase parses subtypes.
  // "ves" -> "f" covers the common Elves/Wolves/Dwarves case; other irregular plurals (e.g.
  // Harpies, Pegasus) aren't handled and will just fail to match rather than matching incorrectly.
  const singular = /ves$/i.test(word) ? word.replace(/ves$/i, "f") : word.replace(/s$/, "");
  if (!singular) return false;
  const capitalized = singular.charAt(0).toUpperCase() + singular.slice(1);
  return card.typeLine.includes(capitalized);
}

// A qualifier can be multiple words ("artifact creatures," "creature tokens," "enchantment
// creatures") — every word must match (each narrows the set further), same as how the printed
// English phrase reads as a conjunction of type/token requirements.
export function permanentMatchesQualifier(card: { typeLine: string; token?: boolean }, matcher: string): boolean {
  const words = matcher.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  return words.every((word) => matchesQualifierWord(card, word));
}

// Counts the matcher against a single battlefield (the CDA's own controller's — "you control").
export function countMatchingPermanents(battlefield: Array<{ typeLine: string; token?: boolean }>, matcher: string): number {
  return battlefield.filter((card) => permanentMatchesQualifier(card, matcher)).length;
}

export interface GroupKeywordGrant {
  matcher: string;
  // "Other enchantment creatures you control have flying." (Soaring Lightbringer) grants to every
  // matching permanent EXCEPT the source itself; without "other," the source grants to itself too.
  excludeSelf: boolean;
  keywords: string[];
}

const GRANTABLE_KEYWORDS = [
  "flying",
  "reach",
  "menace",
  "deathtouch",
  "trample",
  "first strike",
  "double strike",
  "lifelink",
  "wither",
  "infect",
  "indestructible",
  "vigilance",
  "defender",
  "hexproof",
  "shroud",
  "haste",
  "ward"
];

// "[Other] [Qualifier] you control have Keyword[, Keyword, and Keyword]." (Soaring Lightbringer,
// "Dragons you control have indestructible," "Enchantment creatures you control have deathtouch,
// lifelink, and hexproof," ...) — a static group anthem, distinct from parseSelfAnthemBoost (which
// only ever buffs the source itself) and from Aura/Equipment-granted keywords in attachments.ts
// (which grant to whatever they're attached to, not to a whole qualifying group). Declines P/T
// anthems ("Creatures you control get +1/+1") and conditional/dynamic grants — narrow, well-
// templated shapes only, matching this codebase's other deterministic parsers.
export function parseGroupKeywordGrant(oracleText: string): GroupKeywordGrant[] {
  const grants: GroupKeywordGrant[] = [];
  for (const rawClause of oracleText.split("\n")) {
    const text = rawClause.trim().toLowerCase();
    const match = text.match(/^(other\s+)?([a-z][a-z ]*?)\s+(?:you control\s+)?have\s+([a-z, ]+?)\.?$/);
    if (!match) continue;
    const keywords = GRANTABLE_KEYWORDS.filter((kw) => new RegExp(`\\b${kw}\\b`).test(match[3]));
    if (keywords.length === 0) continue;
    grants.push({ matcher: match[2].trim(), excludeSelf: Boolean(match[1]), keywords });
  }
  return grants;
}
