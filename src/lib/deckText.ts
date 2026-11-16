// Small helpers over deck-list text ("Commander: Name" + "1 Card" lines).
export function commanderFromDeckList(deckList: string): string {
  return deckList.match(/^Commander:\s*(.+)$/im)?.[1].trim() ?? "";
}
