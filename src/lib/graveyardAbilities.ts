// Activated abilities that work from the graveyard: "{4}{B}{B}: Return this card from your graveyard to the battlefield with a
// +1/+1 counter on it. This ability costs {4} less to activate if an opponent controls four or more nonbasic lands." (Razorlash
// Transmogrant). Only this return-to-battlefield shape is modelled.
export interface GraveyardReturnAbility {
  costManaText: string;
  withCounter: boolean;
  // Generic mana the cost drops by while an opponent controls enough nonbasic lands.
  discount?: { amount: number; nonbasicLands: number };
}

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };

export function parseGraveyardReturnAbility(oracleText: string): GraveyardReturnAbility | undefined {
  for (const line of oracleText.split("\n")) {
    const match = line.match(/^((?:\{[^}]+\})+): return this card from your graveyard to the battlefield( with a \+1\/\+1 counter on it)?\./i);
    if (!match) continue;
    const discount = line.match(/this ability costs \{(\d+)\} less to activate if an opponent controls (\w+) or more nonbasic lands/i);
    const lands = discount ? (WORDS[discount[2].toLowerCase()] ?? Number.parseInt(discount[2], 10)) : undefined;
    return {
      costManaText: match[1].toUpperCase(),
      withCounter: Boolean(match[2]),
      ...(discount && lands ? { discount: { amount: Number.parseInt(discount[1], 10), nonbasicLands: lands } } : {})
    };
  }
  return undefined;
}

// Lowers the first generic {N} symbol by `amount` (never below 0), leaving coloured symbols alone.
export function reduceGenericCost(costManaText: string, amount: number): string {
  return costManaText.replace(/\{(\d+)\}/, (_whole, digits: string) => {
    const reduced = Math.max(0, Number.parseInt(digits, 10) - amount);
    return reduced > 0 ? `{${reduced}}` : "";
  });
}
