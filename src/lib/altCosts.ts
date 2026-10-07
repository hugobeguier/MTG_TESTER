// "You may pay {W} and tap four untapped creatures you control with flying rather than pay this spell's mana cost." (Sephara, Sky's
// Blade) — an alternative cost with a mana part and a "tap N untapped creatures" part. Only this shape is modelled.
export interface TapCreaturesAltCost {
  costManaText: string;
  count: number;
  // The creature qualifier ("creatures"), and an optional keyword they must have ("flying").
  withKeyword?: string;
}

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

export function parseTapCreaturesAltCost(oracleText: string): TapCreaturesAltCost | undefined {
  const match = oracleText.match(
    /you may pay ((?:\{[^}]+\})+) and tap (one|two|three|four|five|six|\d+) untapped creatures you control(?: with ([a-z ]+?))? rather than pay this spell's mana cost/i
  );
  if (!match) return undefined;
  return {
    costManaText: match[1].toUpperCase(),
    count: WORDS[match[2].toLowerCase()] ?? Number.parseInt(match[2], 10),
    ...(match[3] ? { withKeyword: match[3].toLowerCase() } : {})
  };
}
