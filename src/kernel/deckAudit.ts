// Pure classification helpers for scripts/deck-card-audit.ts (Phase 1 audit). No I/O here so it can be unit-tested.

export type AuditClass = "verified-candidate" | "suspect" | "declined" | "failed" | "missing";

export interface ClassifyInput {
  rowStatus: string | undefined; // parsed_cards.parse_status, undefined = no row
  validatorOk?: boolean;
}

export function classifyCard(input: ClassifyInput): AuditClass {
  const s = input.rowStatus;
  if (s === undefined) return "missing";
  if (s === "declined") return "declined";
  if (s === "ok") return input.validatorOk ? "verified-candidate" : "suspect";
  return "failed";
}

const HEURISTIC_WORDS: Array<[string, RegExp]> = [
  ["if", /\bif\b/i], ["only", /\bonly\b/i], ["unless", /\bunless\b/i], ["during", /\bduring\b/i],
  ["Addendum", /\baddendum\b/i], ["instead", /\binstead\b/i], ["as long as", /\bas long as\b/i],
  ["choose", /\bchoose\b/i], ["each", /\beach\b/i], ["that many", /\bthat many\b/i]
];

const stripReminder = (s: string) => s.replace(/\([^)]*\)/g, " ");

export function heuristicFlags(oracle: string): string[] {
  const text = stripReminder(oracle);
  return HEURISTIC_WORDS.filter(([, re]) => re.test(text)).map(([w]) => w);
}

const COMPLEX_RULES: Array<[string, RegExp]> = [
  ["modal", /\bchoose (one|two|three|any number|up to)|•/i],
  ["replacement", /\b(instead|would|prevent|enters the battlefield (tapped|with)|as .* enters)\b/i],
  ["conditional", /\b(if|unless|as long as|only)\b/i],
  ["X", /\{X\}|\bX\b/],
  ["alt-cost", /\b(kicker|flashback|escape|miracle|cycling|channel|evoke|overload|madness|convoke|rather than pay|additional cost|alternative cost|exploit|connive)\b/i],
  ["delayed/duration", /\b(until|at the beginning of the next|for as long as)\b/i],
  ["multi-target/choice", /\b(up to|another target|each opponent|any number|that many)\b/i],
  ["copy/control", /\b(copy|gain control|exchange|cast .* without paying)\b/i]
];

export function complexityTags(oracle: string): string[] {
  const text = stripReminder(oracle);
  return COMPLEX_RULES.filter(([, re]) => re.test(text)).map(([t]) => t);
}

// simple = no complexity tags at all (basic lands, vanilla/keyword creatures, plain mana rocks, plain one-effect spells).
export function complexityOf(oracle: string): { level: "simple" | "complex"; tags: string[] } {
  const tags = complexityTags(oracle);
  return { level: tags.length ? "complex" : "simple", tags };
}
