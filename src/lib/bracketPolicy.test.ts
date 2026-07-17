import { describe, expect, it } from "vitest";
import { findEarlyComboViolations, validateBracketThreeDeck, wouldCompleteEarlyCombo } from "./bracketPolicy";
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

  it("rejects non-basic duplicates and too many game changers", () => {
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
    expect(report.errors.join(" ")).toContain("at most 3");
  });

  it("rejects mass land destruction and chainable extra-turn cards", () => {
    const cards: DeckCard[] = [
      { name: "Meren of Clan Nel Toth", count: 1 },
      { name: "Armageddon", count: 1 },
      { name: "Nexus of Fate", count: 1 },
      { name: "Forest", count: 97 }
    ];

    const report = validateBracketThreeDeck({ commander: "Meren of Clan Nel Toth", cards });
    expect(report.legal).toBe(false);
    expect(report.errors.join(" ")).toContain("Armageddon");
    expect(report.errors.join(" ")).toContain("Nexus of Fate");
  });

  it("rejects a deck containing both halves of a known early two-card infinite combo", () => {
    const cards: DeckCard[] = [
      { name: "Meren of Clan Nel Toth", count: 1 },
      { name: "Isochron Scepter", count: 1 },
      { name: "Dramatic Reversal", count: 1 },
      { name: "Forest", count: 97 }
    ];

    const report = validateBracketThreeDeck({ commander: "Meren of Clan Nel Toth", cards });
    expect(report.legal).toBe(false);
    expect(report.errors.join(" ")).toContain("Isochron Scepter + Dramatic Reversal");
  });
});

describe("findEarlyComboViolations / wouldCompleteEarlyCombo", () => {
  it("finds a known combo pair regardless of order", () => {
    expect(findEarlyComboViolations(["Dramatic Reversal", "Isochron Scepter", "Sol Ring"])).toEqual([["Isochron Scepter", "Dramatic Reversal"]]);
  });

  it("does not flag a combo piece on its own", () => {
    expect(findEarlyComboViolations(["Isochron Scepter", "Sol Ring"])).toEqual([]);
  });

  it("detects that adding a candidate would complete a combo already in progress", () => {
    const present = new Set(["Isochron Scepter"]);
    expect(wouldCompleteEarlyCombo("Dramatic Reversal", present)).toBe(true);
    expect(wouldCompleteEarlyCombo("Sol Ring", present)).toBe(false);
  });
});
