import { describe, expect, it } from "vitest";
import { validateBracketThreeDeck } from "./bracketPolicy";
import type { DeckCard } from "./types";

describe("validateBracketThreeDeck", () => {
  it("accepts singleton decks with at most three game changers", () => {
    const cards: DeckCard[] = [
      { name: "Meren of Clan Nel Toth", count: 1 },
      { name: "Sol Ring", count: 1 },
      { name: "The One Ring", count: 1 },
      { name: "Demonic Tutor", count: 1 },
      { name: "Rhystic Study", count: 1 },
      { name: "Forest", count: 95 }
    ];

    expect(validateBracketThreeDeck({ commander: "Meren of Clan Nel Toth", cards }).legal).toBe(true);
  });

  it("rejects non-basic duplicates and warns on too many game changers", () => {
    const cards: DeckCard[] = [
      { name: "Kess, Dissident Mage", count: 1 },
      { name: "Counterspell", count: 2 },
      { name: "The One Ring", count: 1 },
      { name: "Demonic Tutor", count: 1 },
      { name: "Rhystic Study", count: 1 },
      { name: "Force of Will", count: 1 },
      { name: "Island", count: 94 }
    ];

    const report = validateBracketThreeDeck({ commander: "Kess, Dissident Mage", cards });
    expect(report.legal).toBe(false);
    expect(report.errors.join(" ")).toContain("Counterspell");
    expect(report.warnings.join(" ")).toContain("at most 3");
  });
});
