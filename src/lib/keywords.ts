// Keyword abilities modeled as data (per the engine spec: "model keywords as data ... so new ones
// can be added without code changes") rather than one hardcoded regex per keyword scattered across
// callers. Shared between the client engine (AppFlow.tsx) and any other rules-aware code (e.g.
// rulesAdvisor.ts) so keyword knowledge doesn't drift between them.

export type KeywordCategory = "evasion" | "protection" | "combat" | "static";

export interface KeywordDefinition {
  name: string;
  category: KeywordCategory;
  pattern: RegExp;
}

export const KEYWORD_TABLE: KeywordDefinition[] = [
  { name: "flying", category: "evasion", pattern: /\bflying\b/i },
  { name: "reach", category: "evasion", pattern: /\breach\b/i },
  { name: "menace", category: "evasion", pattern: /\bmenace\b/i },
  { name: "deathtouch", category: "combat", pattern: /\bdeathtouch\b/i },
  { name: "trample", category: "combat", pattern: /\btrample\b/i },
  { name: "first strike", category: "combat", pattern: /\bfirst strike\b/i },
  { name: "double strike", category: "combat", pattern: /\bdouble strike\b/i },
  { name: "lifelink", category: "combat", pattern: /\blifelink\b/i },
  { name: "wither", category: "combat", pattern: /\bwither\b/i },
  { name: "infect", category: "combat", pattern: /\binfect\b/i },
  { name: "indestructible", category: "static", pattern: /\bindestructible\b/i },
  { name: "vigilance", category: "static", pattern: /\bvigilance\b/i },
  { name: "defender", category: "static", pattern: /\bdefender\b/i },
  { name: "haste", category: "static", pattern: /\bhaste\b/i },
  { name: "prowess", category: "static", pattern: /\bprowess\b/i },
  { name: "extort", category: "static", pattern: /\bextort\b/i },
  { name: "annihilator", category: "static", pattern: /\bannihilator\b/i },
  { name: "hexproof", category: "protection", pattern: /\bhexproof\b/i },
  { name: "shroud", category: "protection", pattern: /\bshroud\b/i },
  { name: "ward", category: "protection", pattern: /\bward\b/i }
];

// Words that mean a line is a sentence of rules text, not a list of keywords. "Flying" inside "Create a 5/5
// Dragon creature token with flying" or "...gains trample until end of turn" is NOT the card having that
// keyword — a plain text search made Nogi, Sarkhan and Dragonmaster Outcast permanent fliers, Rhonas a
// trampler, and the Surraks permanently hasty.
const NON_KEYWORD_WORDS = new Set([
  "you", "your", "target", "creature", "creatures", "this", "that", "each", "when", "whenever", "at", "if", "get", "gets", "have", "has",
  "gain", "gains", "create", "creates", "deals", "deal", "tap", "untap", "draw", "until", "spell", "spells", "cast", "may", "can", "can't",
  "return", "put", "destroy", "exile", "sacrifice", "add", "all", "other", "another", "with", "as", "long", "than", "then", "token", "tokens"
]);

// The comma/semicolon-separated tokens of every line that consists only of keyword abilities ("Flying, vigilance",
// "Ward {2}", "Protection from red"), lowercased, reminder text removed.
export function keywordLineTokens(oracleText: string): string[] {
  const tokens: string[] = [];
  for (const rawLine of oracleText.split("\n")) {
    const line = rawLine.replace(/\([^)]*\)/g, "").trim().toLowerCase();
    if (!line || line.includes(":")) continue;
    const parts = line.split(/[,;]/).map((part) => part.trim()).filter(Boolean);
    const looksLikeKeywords = parts.length > 0 && parts.every((part) => {
      const words = part.replace(/\{[^}]+\}/g, " ").split(/[\s—-]+/).filter(Boolean);
      return words.length <= 5 && !words.some((word) => NON_KEYWORD_WORDS.has(word));
    });
    if (looksLikeKeywords) tokens.push(...parts);
  }
  return tokens;
}

export function hasKeyword(oracleText: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startsWithName = new RegExp(`^${escaped}(?![a-z])`);
  return keywordLineTokens(oracleText).some((token) => startsWithName.test(token));
}

// Ward's cost is usually mana ("Ward {2}") but can be an alternate cost ("Ward—Pay 2 life."); this
// only extracts the common numeric-mana form and returns undefined otherwise (callers that can't
// resolve an amount should treat the ability as present but its cost as unknown/unenforced).
export function wardAmount(oracleText: string): number | undefined {
  const match = oracleText.match(/\bward\s*(?:—|-|:)?\s*\{?(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

// "Ward—Pay 2 life." (Zul Ashur, Lich Lord) — the life-payment form, which wardAmount above deliberately
// doesn't read.
export function wardLifeAmount(oracleText: string): number | undefined {
  const match = oracleText.match(/\bward\s*(?:—|-)\s*pay (\d+) life/i);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

export function annihilatorAmount(oracleText: string): number | undefined {
  const match = oracleText.match(/\bannihilator\s+(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

const PROTECTION_COLORS = ["white", "blue", "black", "red", "green"] as const;
export type ProtectionColor = (typeof PROTECTION_COLORS)[number];

// Only "protection from [color]" is parsed — the far most common form in constructed/Commander
// play. "Protection from everything," "protection from artifacts," and named-quality protection
// ("protection from Dragons") are not detected; cards using those forms are simply treated as not
// having protection for the purposes of this engine's blocking/damage-prevention checks.
export function protectionColors(oracleText: string): ProtectionColor[] {
  const text = oracleText.toLowerCase();
  // Multi-color protection is templated as "Protection from white and from black.", so the
  // "and from X" continuation needs to match too, not just the leading "protection from X".
  return PROTECTION_COLORS.filter((color) => new RegExp(`\\b(?:protection from|and from) ${color}\\b`).test(text));
}
