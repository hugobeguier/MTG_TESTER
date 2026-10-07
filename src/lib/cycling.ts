// "Cycling {2}" (Barren Moor, Forgotten Cave, Tranquil Thicket): pay the cost and discard this card from your hand to draw a card.
// "Plainscycling {2}" (Angel of the Ruins) / "Landcycling {1}" / "Basic landcycling {1}": the same, but search your library for a card of that
// type instead of drawing (searchType is the card's type word, e.g. "Plains" or "Land").
export function parseCycling(oracleText: string): { costManaText: string; searchType?: string; basicOnly?: boolean } | undefined {
  const match = oracleText.match(/^(basic )?([a-z]*?)cycling ((?:\{[^}]+\})+)/im);
  if (!match) return undefined;
  const searchType = match[2] ? match[2].charAt(0).toUpperCase() + match[2].slice(1) : undefined;
  return { costManaText: match[3].toUpperCase(), ...(searchType ? { searchType } : {}), ...(match[1] ? { basicOnly: true } : {}) };
}
