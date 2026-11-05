// Pure helpers behind the card-image pickers in ThreeGameTable.tsx (discard to hand size, put on library, connive, return a land, blink, basic-land fetch).
import type { VisibleCard } from "./types";

// Toggle a card in a multi-select with a cap (max <= 1 behaves as a radio: choosing another card replaces the previous pick).
export function toggleCardSelection(current: string[], cardId: string, max: number): string[] {
  if (current.includes(cardId)) return current.filter((id) => id !== cardId);
  if (max <= 1) return [cardId];
  if (current.length >= max) return current;
  return [...current, cardId];
}

export type CardPickOption = { id: string; name: string; selected: boolean; ariaLabel: string; detail: string };

// One tile per selectable card: the name always stays available (image fallback + screen readers); detail is the mana cost / type line shown under the art.
export function cardPickOptions(cards: Array<Pick<VisibleCard, "id" | "name" | "manaCost" | "typeLine">>, selectedIds: string[]): CardPickOption[] {
  return cards.map((card) => {
    const selected = selectedIds.includes(card.id);
    return { id: card.id, name: card.name, selected, ariaLabel: `${selected ? "Selected: " : ""}${card.name}`, detail: [card.manaCost, card.typeLine].filter(Boolean).join(" · ") };
  });
}
