// Parses "Counter target [X] spell[, unless its controller pays {N}]" into structured data,
// following this codebase's deterministic-first pattern (see staticEffects.ts). Only spells are
// covered (not "counter target activated/triggered ability") — that's a separate, larger feature
// since this engine's stack model treats spells and abilities differently.

export type CounterSpellRestriction = "any" | "creature" | "noncreature" | "commander";

export interface CounterSpellAbility {
  restriction: CounterSpellRestriction;
  taxAmount?: number;
}

export function parseCounterSpellAbility(oracleText: string): CounterSpellAbility | undefined {
  const text = oracleText.toLowerCase();

  const taxMatch = text.match(/counter target spell unless its controller pays \{(\d+)\}/);
  if (taxMatch) return { restriction: "any", taxAmount: Number.parseInt(taxMatch[1], 10) };

  if (/\bcounter target creature spell\b/.test(text)) return { restriction: "creature" };
  if (/\bcounter target noncreature spell\b/.test(text)) return { restriction: "noncreature" };
  if (/\bcounter target commander spell\b/.test(text)) return { restriction: "commander" };
  if (/\bcounter target spell\b/.test(text)) return { restriction: "any" };

  return undefined;
}

export function counterSpellCanTarget(ability: CounterSpellAbility, targetTypeLine: string, targetIsCommanderSpell: boolean): boolean {
  if (ability.restriction === "creature") return targetTypeLine.includes("Creature");
  if (ability.restriction === "noncreature") return !targetTypeLine.includes("Creature");
  if (ability.restriction === "commander") return targetIsCommanderSpell;
  return true;
}
