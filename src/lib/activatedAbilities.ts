// Parses the common "{cost}, Sacrifice ~: effect" template (Viscera Seer, Carrion Feeder, Food/
// Clue tokens, etc.) into structured data, following this codebase's deterministic-first pattern
// (see staticEffects.ts). Only covers effect shapes this engine can safely execute today — mana-
// producing and temporary-pump effects are recognized as "sacrifice ability shaped" but return no
// effect, so callers can choose not to surface them as legal actions rather than silently no-op.

export type SacrificeEffect =
  | { kind: "scry" | "surveil" | "draw_cards" | "gain_life" | "lose_life"; amount: number }
  | { kind: "add_counter"; counterKind: string; amount: number };

export interface SacrificeAbility {
  costMana: number;
  costTap: boolean;
  costDiscard: boolean;
  sacrificeTarget: "self" | "creature";
  effect: SacrificeEffect;
  clause: string;
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
};

function numberWordToInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) return parsed;
  return NUMBER_WORDS[value.toLowerCase()];
}

const SACRIFICE_CLAUSE_PATTERN = /^((?:(?:\{[^}]+\}|discard a card)\s*,?\s*)*)sacrifice\s+(this\s+[a-z]+|an?\s+creature)\s*:\s*(.+?)\.?\s*$/i;

export function parseGenericSacrificeAbilities(oracleText: string): SacrificeAbility[] {
  const abilities: SacrificeAbility[] = [];
  const clauses = oracleText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    const match = clause.match(SACRIFICE_CLAUSE_PATTERN);
    if (!match) continue;

    const costPrefix = match[1];
    const targetPhrase = match[2].toLowerCase();
    const effectText = match[3];

    const costTap = /\{t\}/i.test(costPrefix);
    const costDiscard = /discard a card/i.test(costPrefix);
    const manaSymbols = costPrefix.match(/\{(\d+)\}/g) ?? [];
    const costMana = manaSymbols.reduce((total, symbol) => total + (Number.parseInt(symbol.replace(/[{}]/g, ""), 10) || 0), 0);
    const sacrificeTarget: "self" | "creature" = targetPhrase.startsWith("this") ? "self" : "creature";

    const effect = parseSacrificeEffectText(effectText);
    if (!effect) continue;

    abilities.push({ costMana, costTap, costDiscard, sacrificeTarget, effect, clause });
  }

  return abilities;
}

function parseSacrificeEffectText(text: string): SacrificeEffect | undefined {
  const lower = text.toLowerCase();

  const scryMatch = lower.match(/\bscry\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (scryMatch) {
    const amount = numberWordToInt(scryMatch[1]);
    if (amount) return { kind: "scry", amount };
  }

  const surveilMatch = lower.match(/\bsurveil\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (surveilMatch) {
    const amount = numberWordToInt(surveilMatch[1]);
    if (amount) return { kind: "surveil", amount };
  }

  const drawMatch = lower.match(/\bdraw\s+(a|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\b/);
  if (drawMatch) {
    const amount = numberWordToInt(drawMatch[1]);
    if (amount) return { kind: "draw_cards", amount };
  }

  const gainMatch = lower.match(/\byou gain\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\b/);
  if (gainMatch) {
    const amount = numberWordToInt(gainMatch[1]);
    if (amount) return { kind: "gain_life", amount };
  }

  const loseMatch = lower.match(/\byou lose\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\b/);
  if (loseMatch) {
    const amount = numberWordToInt(loseMatch[1]);
    if (amount) return { kind: "lose_life", amount };
  }

  const counterMatch = lower.match(/\bput an? \+1\/\+1 counter on (?:this creature|it)\b/);
  if (counterMatch) return { kind: "add_counter", counterKind: "+1/+1", amount: 1 };

  return undefined;
}
