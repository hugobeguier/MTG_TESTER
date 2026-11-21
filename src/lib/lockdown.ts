// Static debuff / lockdown text readers shared by the engine (state-based pass, combat), the AI and the Rules Advisor:
//   - per-player attack bans ("can't attack you or planeswalkers you control": Vow of Malice, Combat Calligrapher, Promise of Loyalty, Orzhov Advokist)
//   - "loses [keyword]" (Archetype of Imagination's static, Shadowspear's until-end-of-turn ability) with its "can't have or gain" rider
//   - group base-P/T setters with extra keywords/subtypes (Sigarda's Summons, Graaz)
//   - conditional attack restrictions ("can't attack unless you control four or more artifacts": Gadrak)
// Pure text/data helpers; the layer timestamps and board scans live in engine/stateBased.ts and engine/combat.ts.

/** A stored ban on attacking one player (and their planeswalkers). Each ban ends by itself: when the counter is gone, or at the start of `untilTurnOfSeatId`'s turn. */
export interface AttackBan {
  againstSeatId: string;
  /** The ban applies only while the creature carries a counter of this kind (Promise of Loyalty: "vow"). */
  whileCounter?: string;
  /** "until your next turn": removed when this seat's next turn begins (engine/turnFlow.ts untapForSeat). */
  untilTurnOfSeatId?: string;
}

const KEYWORDS = [
  "flying", "reach", "menace", "deathtouch", "trample", "first strike", "double strike", "lifelink", "wither", "infect", "indestructible", "vigilance",
  "defender", "hexproof", "shroud", "haste", "intimidate", "fear", "skulk", "shadow"
];

function cleanLines(oracleText: string): string[] {
  return oracleText.split("\n").map((line) => line.replace(/\([^)]*\)/g, "").trim().toLowerCase());
}

function singularize(word: string): string {
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function keywordsIn(list: string): string[] {
  return KEYWORDS.filter((keyword) => new RegExp(`\\b${keyword}\\b`).test(list));
}

// --- Attack bans -------------------------------------------------------------------------------------------------------------------------------

/** "Enchanted creature ... can't attack you or planeswalkers you control" (Vow of Malice): bans the attached creature from attacking the Aura's controller only. */
export function attachmentCantAttackController(oracleText: string): boolean {
  return /\b(?:enchanted|equipped) creature\b[^.]*?\bcan'?t attack you or planeswalkers you control(?!\s+unless)/i.test(oracleText.replace(/\([^)]*\)/g, ""));
}

export interface StaticAttackBan {
  /** Creature subtype (capitalized singular, e.g. "Inkling") the ban is limited to, or undefined for every creature. */
  subtype?: string;
}

/** "Inklings can't attack you or planeswalkers you control." (Combat Calligrapher) / "Creatures can't attack you ..." -- a plain ban, not a tax ("unless ..."). */
export function parseStaticAttackBans(oracleText: string): StaticAttackBan[] {
  const bans: StaticAttackBan[] = [];
  for (const line of cleanLines(oracleText)) {
    const match = line.match(/^([a-z][a-z' -]*?) can'?t attack you or planeswalkers you control\.?$/);
    if (!match) continue;
    const subject = match[1].trim();
    if (subject === "creatures" || subject === "creature") bans.push({});
    else if (/^[a-z]+s$/.test(subject)) bans.push({ subtype: capitalize(singularize(subject)) });
  }
  return bans;
}

// --- "loses [keyword]" ------------------------------------------------------------------------------------------------------------------------

export interface KeywordLossStatic {
  /** Which permanents lose it: creatures/permanents, controlled by the source's opponents, its controller, or anyone. */
  type: "creature" | "permanent";
  controller: "opponents" | "you" | "any";
  keywords: string[];
  /** "...and can't have or gain flying": grants with a LATER timestamp are blocked too. */
  cantGain: boolean;
}

function parseLossBody(body: string): { keywords: string[]; cantGain: boolean; untilEndOfTurn: boolean } | undefined {
  const match = body.match(/^lose ([a-z, ]+?)(?: and can'?t (?:have or )?gain ([a-z, ]+?))?( until end of turn)?\.?$/);
  if (!match) return undefined;
  const keywords = keywordsIn(match[1]);
  if (keywords.length === 0) return undefined;
  return { keywords, cantGain: Boolean(match[2]), untilEndOfTurn: Boolean(match[3]) };
}

/** Static "[Creatures/Permanents] [your opponents control] lose [keyword[s]][ and can't have or gain it]." (no duration: an until-end-of-turn one is an ability's effect). */
export function parseKeywordLossStatics(oracleText: string): KeywordLossStatic[] {
  const found: KeywordLossStatic[] = [];
  for (const line of cleanLines(oracleText)) {
    if (line.includes(":")) continue;
    const match = line.match(/^(creatures|permanents)(?: (your opponents control|you control))? (lose .+)$/);
    if (!match) continue;
    const body = parseLossBody(match[3]);
    if (!body || body.untilEndOfTurn) continue;
    found.push({ type: match[1] === "creatures" ? "creature" : "permanent", controller: match[2] === "your opponents control" ? "opponents" : match[2] === "you control" ? "you" : "any", keywords: body.keywords, cantGain: body.cantGain });
  }
  return found;
}

export interface KeywordLossEffect {
  type: "creature" | "permanent";
  controller: "opponents" | "you" | "any";
  keywords: string[];
}

/** An activated ability's effect text: "Permanents your opponents control lose hexproof and indestructible until end of turn." (Shadowspear). */
export function parseKeywordLossEffect(effectText: string): KeywordLossEffect | undefined {
  const match = effectText.replace(/\([^)]*\)/g, "").trim().toLowerCase().match(/^(creatures|permanents)(?: (your opponents control|you control))? (lose .+)$/);
  if (!match) return undefined;
  const body = parseLossBody(match[3]);
  if (!body || !body.untilEndOfTurn) return undefined;
  return { type: match[1] === "creatures" ? "creature" : "permanent", controller: match[2] === "your opponents control" ? "opponents" : match[2] === "you control" ? "you" : "any", keywords: body.keywords };
}

// --- Group base P/T ---------------------------------------------------------------------------------------------------------------------------

export interface GroupBaseSet {
  excludeSelf: boolean;
  /** "...with +1/+1 counters on them" (Sigarda's Summons). */
  requiresPlusCounter: boolean;
  power: number;
  toughness: number;
  keywords: string[];
  /** Subtypes added "in addition to their other types" (capitalized, singular). */
  addedSubtypes: string[];
}

/** "[Other] creatures you control [with +1/+1 counters on them] have base power and toughness N/M[, have flying,] [and are Angels in addition to their other types]." */
export function parseGroupBaseSet(oracleText: string): GroupBaseSet[] {
  const found: GroupBaseSet[] = [];
  for (const line of cleanLines(oracleText)) {
    const match = line.match(/^(other )?creatures you control( with \+1\/\+1 counters? on them)? have base power and toughness (\d+)\/(\d+)(.*?)\.?$/);
    if (!match) continue;
    const rest = match[5];
    const keywordClause = rest.match(/^,? ?(?:and )?have ([a-z, ]+?)(?:,? and are |,? are |$)/);
    const subtypeClause = rest.match(/\bare ([a-z ]+?) in addition to their other (?:creature )?types\b/);
    found.push({
      excludeSelf: Boolean(match[1]),
      requiresPlusCounter: Boolean(match[2]),
      power: Number.parseInt(match[3], 10),
      toughness: Number.parseInt(match[4], 10),
      keywords: keywordClause ? keywordsIn(keywordClause[1]) : [],
      addedSubtypes: subtypeClause ? subtypeClause[1].split(/\s+and\s+|,\s*/).map((word) => capitalize(singularize(word.trim()))).filter(Boolean) : []
    });
  }
  return found;
}

// --- Conditional attack restriction -------------------------------------------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1 };

export interface ConditionalAttackRestriction {
  /** The card type/subtype word, capitalized singular ("Artifact", "Creature", "Land"). */
  type: string;
  count: number;
}

/** "Gadrak can't attack unless you control four or more artifacts." (the creature's own name or "this creature"). */
export function parseConditionalAttackRestriction(oracleText: string): ConditionalAttackRestriction[] {
  const found: ConditionalAttackRestriction[] = [];
  for (const line of cleanLines(oracleText)) {
    const match = line.match(/^[a-z',\- ]+? can'?t attack unless you control (\w+) or more ([a-z]+)\.?$/);
    if (!match) continue;
    const count = NUMBER_WORDS[match[1]] ?? Number.parseInt(match[1], 10);
    if (!Number.isFinite(count)) continue;
    found.push({ type: capitalize(singularize(match[2])), count });
  }
  return found;
}

// --- Evasion by blocker characteristics (intimidate / fear / skulk) ----------------------------------------------------------------------------

/** Rule 702.13 intimidate, 702.36 fear: can be blocked only by artifact creatures and/or creatures sharing a color (fear: black). */
export function evasionBlocksBlocker(
  attacker: { colors: string[]; typeLine: string },
  blocker: { colors: string[]; typeLine: string },
  has: (keyword: string) => boolean
): boolean {
  const blockerIsArtifact = blocker.typeLine.includes("Artifact");
  if (has("fear") && !blockerIsArtifact && !blocker.colors.includes("B")) return true;
  if (has("intimidate") && !blockerIsArtifact && !blocker.colors.some((color) => attacker.colors.includes(color))) return true;
  return false;
}
