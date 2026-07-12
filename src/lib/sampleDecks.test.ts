import { describe, expect, it } from "vitest";
import { createSampleDeck } from "./sampleDecks";

describe("createSampleDeck", () => {
  it("creates a role-balanced 100-card fallback deck instead of mostly basics", () => {
    const deck = createSampleDeck("Veyra", "Shalai, Voice of Plenty", ["G", "W"]);
    const basics = deck.cards
      .filter((card) => ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"].includes(card.name))
      .reduce((sum, card) => sum + card.count, 0);

    expect(deck.validation.legal).toBe(true);
    expect(deck.validation.cardCount).toBe(100);
    expect(basics).toBeLessThan(40);
    expect(deck.cards.some((card) => card.role === "ramp")).toBe(true);
    expect(deck.cards.some((card) => card.role === "draw")).toBe(true);
    expect(deck.cards.some((card) => card.role === "removal")).toBe(true);
  });
});
