import { describe, expect, it } from "vitest";
import { createSampleDeck, type SampleDeckCatalog } from "./sampleDecks";
import type { CardRecord } from "./types";

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

  it("prefers the catalog's real color identity over a wrong caller-supplied color guess", () => {
    const urDragonRecord: CardRecord = {
      id: "test-the-ur-dragon",
      name: "The Ur-Dragon",
      typeLine: "Legendary Creature - Dragon",
      oracleText: "Flying. Whenever one or more Dragons you control attack, ...",
      manaValue: 7,
      colors: ["W", "U", "B", "R", "G"],
      colorIdentity: ["W", "U", "B", "R", "G"]
    };
    const catalog: SampleDeckCatalog = { lookup: (name) => (name === "The Ur-Dragon" ? urDragonRecord : undefined) };

    const deck = createSampleDeck("Malik", "The Ur-Dragon", ["R"], catalog);
    const mountains = deck.cards.find((card) => card.name === "Mountain")?.count ?? 0;
    const otherBasics = ["Forest", "Plains", "Island", "Swamp"].map((name) => deck.cards.find((card) => card.name === name)?.count ?? 0);

    expect(mountains).toBeLessThan(30);
    expect(otherBasics.every((count) => count > 0)).toBe(true);
  });

  it("falls back to the caller-supplied colors when no catalog is given", () => {
    const deck = createSampleDeck("Malik", "Kess, Dissident Mage", ["U", "B", "R"]);
    expect(deck.colors).toEqual(["U", "B", "R"]);
  });
});
