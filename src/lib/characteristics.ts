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

// "Power and toughness are each equal to the number of Zombies on the battlefield plus the number of
// Zombie cards in all graveyards." (Soulless One) — counts across EVERY player's battlefield and
// graveyards, unlike the "you control" CDA above. Left unparsed it stayed */* = 0 toughness and died the
// moment it entered.
export interface AllZonesCda {
  stat: CdaStat;
  terms: Array<{ zone: "battlefield" | "graveyard"; matcher: string }>;
}

export function parseAllZonesCda(oracleText: string): AllZonesCda | undefined {
  const match = oracleText.toLowerCase().match(/power and toughness are each equal to the number of ([a-z ]+?) on the battlefield plus the number of ([a-z ]+?) cards in all graveyards/);
  if (!match) return undefined;
  return {
    stat: "both",
    terms: [
      { zone: "battlefield", matcher: match[1].trim() },
      { zone: "graveyard", matcher: match[2].trim() }
    ]
  };
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
  // "opponents_graveyards": "+1/+1 for each creature card in your opponents' graveyards" (Wight of Precinct Six).
  zone: "battlefield" | "graveyard" | "opponents_graveyards";
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

  const opponentsGraveyards = text.match(/\bgets? \+(\d+)\/\+(\d+) for each ([a-z]+) cards? in your opponents' graveyards\b/);
  if (opponentsGraveyards) {
    return {
      power: Number.parseInt(opponentsGraveyards[1], 10),
      toughness: Number.parseInt(opponentsGraveyards[2], 10),
      matcher: opponentsGraveyards[3].trim(),
      zone: "opponents_graveyards"
    };
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
  // True only when the clause says "you control" ("Other Zombies you control get +1/+1", Lord of the
  // Accursed). Without it ("Other Zombie creatures get +1/+1", Lord of the Undead; "Black creatures get
  // +1/+1", Bad Moon) the boost applies to EVERY player's matching creatures.
  controlledOnly: boolean;
  power: number;
  toughness: number;
  // "Other creatures you control of the chosen type get +1/+1." (Morophon, the Boundless) — only
  // applies to permanents matching the source's own chosenCreatureType (set via
  // pickChosenCreatureType at ETB), on top of the plain matcher qualifier above.
  requiresChosenType?: boolean;
  // "Creatures you control of the chosen color get +1/+0." (Heraldic Banner) — only permanents of the source's chosenColor.
  requiresChosenColor?: boolean;
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
    // Reminder text in parentheses ("(Any amount of damage they deal to a creature is enough to destroy
    // it.)") isn't part of the ability.
    const text = rawClause.replace(/\([^)]*\)/g, "").trim().toLowerCase();
    // "Skeletons you control and other Zombies you control get +1/+1 and have deathtouch." (Death Baron)
    // — two groups sharing one boost; the keyword half is parseGroupKeywordGrant's.
    const compound = text.match(/^([a-z][a-z ]*?) you control and other ([a-z][a-z ]*?) you control gets? \+(\d+)\/\+(\d+)(?: and have [a-z, ]+)?\.?$/);
    if (compound) {
      const power = Number.parseInt(compound[3], 10);
      const toughness = Number.parseInt(compound[4], 10);
      boosts.push({ matcher: compound[1].trim(), excludeSelf: false, controlledOnly: true, power, toughness });
      boosts.push({ matcher: compound[2].trim(), excludeSelf: true, controlledOnly: true, power, toughness });
      continue;
    }
    const match = text.match(
      /^(other\s+)?([a-z][a-z ]*?)\s+(you control\s+)?(of the chosen (?:type|color)\s+)?gets? \+(\d+)\/\+(\d+)(?:\s+for each ([a-z0-9+/\- ]+?) counters? on (?:this|it)(?:\s+[a-z]+)?|\s+for each ([a-z ]+?) you control)?(?:\s+and have [a-z, ]+?)?\.?$/
    );
    if (!match) continue;
    const counterKind = match[7]?.trim();
    const countMatcher = match[8]?.trim();
    boosts.push({
      matcher: match[2].trim(),
      excludeSelf: Boolean(match[1]),
      controlledOnly: Boolean(match[3]),
      requiresChosenType: match[4] && /type/.test(match[4]) ? true : undefined,
      requiresChosenColor: match[4] && /color/.test(match[4]) ? true : undefined,
      power: Number.parseInt(match[5], 10),
      toughness: Number.parseInt(match[6], 10),
      multiplier: counterKind ? { kind: "counter", counterKind } : countMatcher ? { kind: "permanent_count", countMatcher } : undefined
    });
  }
  return boosts;
}

type QualifiableCard = { typeLine: string; token?: boolean; grantedTypes?: string[]; colors?: string[]; oracleText?: string };

// Color words in a qualifier ("black creatures", "nonwhite creatures") are checked against the card's
// COLORS, never its type line — Bad Moon ("Black creatures get +1/+1") and Bontu's Monument ("Black
// creature spells cost {1} less") did nothing because "black" was looked up as if it were a subtype.
const COLOR_LETTERS: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };

function hasColor(card: QualifiableCard, letter: string): boolean {
  return Boolean(card.colors?.some((color) => color.toUpperCase() === letter || COLOR_LETTERS[color.toLowerCase()] === letter));
}

// A granted type (Zur, Eternal Schemer's "target non-Aura enchantment becomes a creature," Secret
// Arcade/Biotransference-style "are Xs in addition to their other types," ...) counts the same as a
// printed one here — matches hasCardType's own "typeLine OR grantedTypes" rule (src/lib/typeGrants.ts)
// so a type-granted permanent is recognized by every qualifier-matching static ability that cares
// about its type, not just the ones that granted it.
function hasType(card: QualifiableCard, type: string): boolean {
  return card.typeLine.includes(type) || Boolean(card.grantedTypes?.includes(type));
}

const BROAD_CATEGORIES: Record<string, (card: QualifiableCard) => boolean> = {
  land: (card) => hasType(card, "Land"),
  lands: (card) => hasType(card, "Land"),
  creature: (card) => hasType(card, "Creature"),
  creatures: (card) => hasType(card, "Creature"),
  artifact: (card) => hasType(card, "Artifact"),
  artifacts: (card) => hasType(card, "Artifact"),
  enchantment: (card) => hasType(card, "Enchantment"),
  enchantments: (card) => hasType(card, "Enchantment"),
  permanent: () => true,
  permanents: () => true
};

function matchesQualifierWord(card: QualifiableCard, word: string): boolean {
  const broad = BROAD_CATEGORIES[word];
  if (broad) return broad(card);
  if (word === "token" || word === "tokens") return Boolean(card.token);
  if (word === "nontoken") return !card.token;
  if (word === "colorless") return !card.colors || card.colors.length === 0;
  const colorLetter = COLOR_LETTERS[word];
  if (colorLetter) return hasColor(card, colorLetter);
  const negatedColor = word.startsWith("non") ? COLOR_LETTERS[word.slice(3)] : undefined;
  if (negatedColor) return !hasColor(card, negatedColor);

  // Fall back to a creature-subtype match (Elves, Goblins, Zombies, ...): singularize crudely and
  // check it appears in the type line, matching how the rest of this codebase parses subtypes.
  // "ves" -> "f" covers the common Elves/Wolves/Dwarves case; other irregular plurals (e.g.
  // Harpies, Pegasus) aren't handled and will just fail to match rather than matching incorrectly.
  const singular = /ves$/i.test(word) ? word.replace(/ves$/i, "f") : word.replace(/s$/, "");
  if (!singular) return false;
  const capitalized = singular.charAt(0).toUpperCase() + singular.slice(1);
  if (card.typeLine.includes(capitalized)) return true;
  // Changeling (Taurean Mauler): a creature with it is every creature type.
  return card.typeLine.includes("Creature") && /^changeling\b/im.test(card.oracleText ?? "");
}

// A qualifier can be multiple words ("artifact creatures," "creature tokens," "enchantment
// creatures") — every word must match (each narrows the set further), same as how the printed
// English phrase reads as a conjunction of type/token requirements.
export function permanentMatchesQualifier(card: QualifiableCard, matcher: string): boolean {
  const words = matcher.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  return words.every((word) => matchesQualifierWord(card, word));
}

// Counts the matcher against a single battlefield (the CDA's own controller's — "you control").
export function countMatchingPermanents(battlefield: QualifiableCard[], matcher: string): number {
  return battlefield.filter((card) => permanentMatchesQualifier(card, matcher)).length;
}

export interface GroupKeywordGrant {
  matcher: string;
  // See GroupAnthemBoost.controlledOnly — absent "you control" means every player's matching creatures.
  controlledOnly: boolean;
  // "Other enchantment creatures you control have flying." (Soaring Lightbringer) grants to every
  // matching permanent EXCEPT the source itself; without "other," the source grants to itself too.
  excludeSelf: boolean;
  keywords: string[];
  // "Other creatures you control with flying have indestructible." (Sephara): only permanents that already have this keyword.
  withKeyword?: string;
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
    const text = rawClause.replace(/\([^)]*\)/g, "").trim().toLowerCase();
    // Death Baron: "Skeletons you control and other Zombies you control get +1/+1 and have deathtouch."
    const compound = text.match(/^([a-z][a-z ]*?) you control and other ([a-z][a-z ]*?) you control gets? \+\d+\/\+\d+ and have ([a-z, ]+?)\.?$/);
    if (compound) {
      const compoundKeywords = GRANTABLE_KEYWORDS.filter((kw) => new RegExp(`\\b${kw}\\b`).test(compound[3]));
      if (compoundKeywords.length > 0) {
        grants.push({ matcher: compound[1].trim(), excludeSelf: false, controlledOnly: true, keywords: compoundKeywords });
        grants.push({ matcher: compound[2].trim(), excludeSelf: true, controlledOnly: true, keywords: compoundKeywords });
      }
      continue;
    }
    // "Nontoken creatures you control get +1/+1 and have vigilance." / "Other Angels you control get +1/+1 and have
    // lifelink." — the keyword half of a boost-and-grant line (its P/T half is parseGroupAnthemBoost's).
    const boostAndHave = text.match(/^(other\s+)?([a-z][a-z ]*?)\s+(you control\s+)?gets? \+\d+\/\+\d+ and have ([a-z, ]+?)\.?$/);
    if (boostAndHave) {
      const boostKeywords = GRANTABLE_KEYWORDS.filter((kw) => new RegExp(`\\b${kw}\\b`).test(boostAndHave[4]));
      if (boostKeywords.length > 0) grants.push({ matcher: boostAndHave[2].trim(), excludeSelf: Boolean(boostAndHave[1]), controlledOnly: Boolean(boostAndHave[3]), keywords: boostKeywords });
      continue;
    }
    // "Other creatures you control with flying have indestructible." (Sephara, Sky's Blade)
    const withKeyword = text.match(/^(other\s+)?([a-z][a-z ]*?) you control with ([a-z ]+?) have ([a-z, ]+?)\.?$/);
    if (withKeyword) {
      const grantedKeywords = GRANTABLE_KEYWORDS.filter((kw) => new RegExp(`\\b${kw}\\b`).test(withKeyword[4]));
      if (grantedKeywords.length > 0) grants.push({ matcher: withKeyword[2].trim(), excludeSelf: Boolean(withKeyword[1]), controlledOnly: true, keywords: grantedKeywords, withKeyword: withKeyword[3].trim() });
      continue;
    }
    const match = text.match(/^(other\s+)?([a-z][a-z ]*?)\s+(you control\s+)?have\s+([a-z, ]+?)\.?$/);
    if (!match) continue;
    const keywords = GRANTABLE_KEYWORDS.filter((kw) => new RegExp(`\\b${kw}\\b`).test(match[4]));
    if (keywords.length === 0) continue;
    grants.push({ matcher: match[2].trim(), excludeSelf: Boolean(match[1]), controlledOnly: Boolean(match[3]), keywords });
  }
  return grants;
}

// "As long as <condition>, ..." static boosts and keyword grants:
//   "This creature gets +2/+2 as long as you have 25 or more life." (Angel of Vitality)
//   "As long as you have at least 7 life more than your starting life total, creatures you control get +2/+2."
//     (Righteous Valkyrie)
//   "Lieutenant — As long as you control your commander, this creature gets +2/+2 and creatures you control have
//     vigilance." (Angelic Field Marshal)
// Evaluated live against the controller's board/life by the characteristics pass.
export type StaticCondition = { kind: "life_at_least"; amount: number } | { kind: "life_over_starting"; amount: number } | { kind: "controls_commander" } | { kind: "self_untapped" } | { kind: "your_turn" };

export interface ConditionalStaticBoost {
  condition: StaticCondition;
  scope: "self" | "creatures_you_control";
  power: number;
  toughness: number;
  keyword?: string;
}

export function parseConditionalStaticBoosts(oracleText: string): ConditionalStaticBoost[] {
  const boosts: ConditionalStaticBoost[] = [];
  for (const rawClause of oracleText.split("\n")) {
    const text = rawClause.replace(/\([^)]*\)/g, "").trim().toLowerCase();
    const selfLife = text.match(/^this creature gets \+(\d+)\/\+(\d+) as long as you have (\d+) or more life\.?$/);
    if (selfLife) {
      boosts.push({ condition: { kind: "life_at_least", amount: Number.parseInt(selfLife[3], 10) }, scope: "self", power: Number.parseInt(selfLife[1], 10), toughness: Number.parseInt(selfLife[2], 10) });
      continue;
    }
    // "During your turn, this creature has first strike." (Duelist of Deep Faith-style)
    const yourTurnKeyword = text.match(/^during your turn, this creature has ([a-z ]+?)\.?$/);
    if (yourTurnKeyword) {
      boosts.push({ condition: { kind: "your_turn" }, scope: "self", power: 0, toughness: 0, keyword: yourTurnKeyword[1].trim() });
      continue;
    }
    const untappedKeyword = text.match(/^this creature has ([a-z ]+?) as long as it'?s untapped\.?$/);
    if (untappedKeyword) {
      boosts.push({ condition: { kind: "self_untapped" }, scope: "self", power: 0, toughness: 0, keyword: untappedKeyword[1].trim() });
      continue;
    }
    const overStarting = text.match(/^as long as you have at least (\d+) life more than your starting life total, creatures you control get \+(\d+)\/\+(\d+)\.?$/);
    if (overStarting) {
      boosts.push({ condition: { kind: "life_over_starting", amount: Number.parseInt(overStarting[1], 10) }, scope: "creatures_you_control", power: Number.parseInt(overStarting[2], 10), toughness: Number.parseInt(overStarting[3], 10) });
      continue;
    }
    const lieutenant = text.match(/^lieutenant\s*[—-]\s*as long as you control your commander, this creature gets \+(\d+)\/\+(\d+) and creatures you control have ([a-z ]+?)\.?$/);
    if (lieutenant) {
      const condition: StaticCondition = { kind: "controls_commander" };
      boosts.push({ condition, scope: "self", power: Number.parseInt(lieutenant[1], 10), toughness: Number.parseInt(lieutenant[2], 10) });
      boosts.push({ condition, scope: "creatures_you_control", power: 0, toughness: 0, keyword: lieutenant[3].trim() });
    }
  }
  return boosts;
}

export interface GroupManaAbilityGrant {
  matcher: string;
  excludeSelf: boolean;
  abilityText: string;
  // "Each creature you control with a counter on it has ..." (Rishkar, Peema Renegade): only permanents with any counter.
  requiresCounter?: boolean;
}

// "Creature tokens you control have '{T}: Add one mana of any color.'" (Insidious Roots) — same
// clause shape as parseGroupKeywordGrant just above, but for a granted ACTIVATED ability instead of
// a keyword: rule 604.3 requires a granted ability's actual rules text to be printed in quotes,
// which is exactly the signal that distinguishes this shape from the keyword-grant one (that
// parser's own [a-z, ]+ capture could never match text containing {, }, or : anyway) — the two
// never need to disambiguate against each other. NOT lowercased (unlike parseGroupKeywordGrant):
// the captured ability text needs to keep its real casing/punctuation ("{T}: Add ...") so every
// existing mana-ability parser (which all expect real oracle-text formatting) can read it unchanged
// once it's copied onto a matching permanent — see effectiveManaOracleText.
export function parseGroupManaAbilityGrant(oracleText: string): GroupManaAbilityGrant[] {
  const grants: GroupManaAbilityGrant[] = [];
  for (const rawClause of oracleText.split("\n")) {
    const counterMatch = rawClause.trim().match(/^each creature you control with a counter on it has\s+"([^"]+)"\.?$/i);
    if (counterMatch && /\{t\}[^"]*:\s*add\b/i.test(counterMatch[1])) {
      grants.push({ matcher: "creature", excludeSelf: false, abilityText: counterMatch[1], requiresCounter: true });
      continue;
    }
    const match = rawClause.trim().match(/^(other\s+)?([A-Za-z][A-Za-z ]*?)\s+(?:you control\s+)?have\s+"([^"]+)"\.?$/i);
    if (!match) continue;
    if (!/\{t\}[^"]*:\s*add\b/i.test(match[3])) continue;
    grants.push({ matcher: match[2].trim(), excludeSelf: Boolean(match[1]), abilityText: match[3] });
  }
  return grants;
}
