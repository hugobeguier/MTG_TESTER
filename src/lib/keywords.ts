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

export function hasKeyword(oracleText: string, name: string): boolean {
  const definition = KEYWORD_TABLE.find((entry) => entry.name === name);
  return definition ? definition.pattern.test(oracleText) : new RegExp(`\\b${name}\\b`, "i").test(oracleText);
}

// Ward's cost is usually mana ("Ward {2}") but can be an alternate cost ("Ward—Pay 2 life."); this
// only extracts the common numeric-mana form and returns undefined otherwise (callers that can't
// resolve an amount should treat the ability as present but its cost as unknown/unenforced).
export function wardAmount(oracleText: string): number | undefined {
  const match = oracleText.match(/\bward\s*(?:—|-|:)?\s*\{?(\d+)/i);
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
