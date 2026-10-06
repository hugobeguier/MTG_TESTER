// "Cycling {2}" (Barren Moor, Forgotten Cave, Tranquil Thicket): pay the cost and discard this card from your hand to draw a card.
// Plain mana-cost cycling only; landcycling/typecycling variants search instead of draw and aren't modelled.
export function parseCycling(oracleText: string): { costManaText: string } | undefined {
  const match = oracleText.match(/^cycling ((?:\{[^}]+\})+)/im);
  return match ? { costManaText: match[1].toUpperCase() } : undefined;
}
