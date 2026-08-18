import { protectionColors, type ProtectionColor } from "./keywords";

// Parses Aura/Equipment oracle text into structured data, following this codebase's
// deterministic-first pattern (see staticEffects.ts). Covers a fixed "+N/+N" power/toughness
// bonus and keyword/protection grants ("has trample"/"has hexproof and haste") — dynamic bonuses
// ("+1/+1 for each enchantment you control") are recognized as attach-shaped but not applied.

export function isAura(card: { typeLine: string }): boolean {
  return card.typeLine.includes("Aura");
}

export function isEquipment(card: { typeLine: string }): boolean {
  return card.typeLine.includes("Equipment");
}

export type EnchantRestriction = "creature" | "creature_you_control" | "permanent" | "player" | "other";

export function enchantRestriction(oracleText: string): EnchantRestriction | undefined {
  const match = oracleText.match(/^enchant\s+(.+)$/im);
  if (!match) return undefined;
  const target = match[1].trim().toLowerCase();
  if (target === "creature you control") return "creature_you_control";
  if (target === "creature") return "creature";
  if (target.includes("permanent")) return "permanent";
  if (target === "player" || target === "opponent") return "player";
  return "other";
}

export function equipCost(oracleText: string): number | undefined {
  const match = oracleText.match(/\bequip\s*(?:—|-)?\s*\{(\d+)\}/i);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

export interface AttachedBonus {
  power: number;
  toughness: number;
}

export function attachedPowerToughnessBonus(oracleText: string): AttachedBonus | undefined {
  const match = oracleText.match(/\b(?:enchanted|equipped) creature gets ([+-]\d+)\/([+-]\d+)(?!\s+for each)/i);
  if (!match) return undefined;
  return { power: Number.parseInt(match[1], 10), toughness: Number.parseInt(match[2], 10) };
}

// Layer 7b: "has base power and toughness N/M" replaces the creature's base P/T outright, instead
// of adding to it — a different, stronger effect than attachedPowerToughnessBonus above (Almost
// Perfect's Aura is a debuff that overwrites a big creature down to 9/10, not a -N/-N pump).
export type AttachedBaseOverride = AttachedBonus | "life_total";

export function attachedBasePowerToughness(oracleText: string): AttachedBaseOverride | undefined {
  const text = oracleText.toLowerCase();
  // "[^.]*" between "creature" and "has base power" tolerates other clauses sharing the same
  // sentence (Utter Insignificance: "Enchanted creature loses all abilities and has base power and
  // toughness 1/1.") — a direct "creature has base power" adjacency requirement missed this real
  // card entirely, silently never applying the 1/1 override.
  if (/\b(?:enchanted|equipped) creature[^.]*\bhas base power and toughness x\/x, where x is your life total\b/.test(text)) {
    return "life_total";
  }
  const fixed = text.match(/\b(?:enchanted|equipped) creature[^.]*\bhas base power and toughness (\d+)\/(\d+)/);
  if (fixed) return { power: Number.parseInt(fixed[1], 10), toughness: Number.parseInt(fixed[2], 10) };
  return undefined;
}

// "Enchanted/equipped creature loses all abilities" (Utter Insignificance) — a single-target
// counterpart to playerCreatureLockEffect below (Overwhelming Splendor's player-wide version).
// Scoped to this exact "enchanted/equipped creature ... loses all abilities" shape rather than a
// bare substring search, so a card that merely mentions losing abilities in some other clause isn't
// misread as this effect.
export function attachmentStripsAllAbilities(oracleText: string): boolean {
  return /\b(?:enchanted|equipped) creature loses all abilities\b/i.test(oracleText);
}

// "Creatures enchanted player controls lose all abilities and have base power and toughness N/M."
// (Overwhelming Splendor) — deliberately narrow to this card's exact real-world wording rather than
// a general "enchant player + board-wide creature debuff" grammar, following this codebase's
// declined-rather-than-guessed pattern for effect shapes with only one real motivating example.
export function playerCreatureLockEffect(oracleText: string): AttachedBonus | undefined {
  const match = oracleText.toLowerCase().match(/\bcreatures enchanted player controls lose all abilities and have base power and toughness (\d+)\/(\d+)\b/);
  if (!match) return undefined;
  return { power: Number.parseInt(match[1], 10), toughness: Number.parseInt(match[2], 10) };
}

// "Enchanted player can't activate abilities that aren't mana abilities or loyalty abilities."
// (Overwhelming Splendor's second clause) — same narrow, single-card scoping as
// playerCreatureLockEffect above.
export function restrictsNonManaNonLoyaltyAbilities(oracleText: string): boolean {
  return /\benchanted player can'?t activate abilities that aren'?t mana abilities or loyalty abilities\b/i.test(oracleText);
}

// "At the beginning of each of enchanted player's postcombat main phases, there is an additional
// beginning phase after this phase." (Shadow of the Second Sun) — same narrow single-card scoping
// as the two functions above; the trigger's own "enchanted player's" phrasing doesn't match the
// generic "at the beginning of your postcombat main phase" pattern every other phase trigger uses
// (see phaseTriggerTextMatches in AppFlow.tsx), and even if it did, that dispatch only ever looks
// at the ACTIVE seat's own battlefield — this Aura lives on its CASTER's battlefield, not the
// enchanted player's, so resolvePhaseAdvance checks for it directly instead.
export function attachmentGrantsExtraBeginningPhase(oracleText: string): boolean {
  return /\badditional beginning phase after this phase\b/i.test(oracleText);
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

// Isolates the "Enchanted/Equipped creature ... has X[, Y and Z]." clause(s) so keyword grants
// aren't confused with the source's own keywords (an Equipment can itself have, say, flying,
// without granting flying to what it's equipped to).
function hasClauseText(oracleText: string): string {
  const matches = [...oracleText.toLowerCase().matchAll(/\b(?:enchanted|equipped) creature[^.]*\bhas\b([^.]+)\./g)];
  return matches.map((match) => match[1]).join(" ");
}

export function grantedKeywords(oracleText: string): string[] {
  const clause = hasClauseText(oracleText);
  if (!clause) return [];
  return GRANTABLE_KEYWORDS.filter((keyword) => new RegExp(`\\b${keyword}\\b`).test(clause));
}

export function grantedProtectionColors(oracleText: string): ProtectionColor[] {
  const clause = hasClauseText(oracleText);
  return clause ? protectionColors(clause) : [];
}

const NEGATIVE_AURA_PATTERNS = [/can'?t attack/i, /can'?t block/i, /doesn'?t untap/i, /loses all abilities/i, /gets -\d+\/-\d+/i];

// Auras with no legality restriction to "creature you control" could go either on your own board
// (a buff) or an opponent's (Pacifism-style removal). With no target-choice UI, this decides which
// by checking whether the aura's own text reads as a downside for its target.
export function isRemovalStyleAura(oracleText: string): boolean {
  return NEGATIVE_AURA_PATTERNS.some((pattern) => pattern.test(oracleText));
}
