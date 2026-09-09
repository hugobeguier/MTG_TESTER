import { describe, expect, it } from "vitest";
import { buildDeckGamePlan, findEarlyComboViolations, inferDeckArchetype, validateBracketThreeDeck, wouldCompleteEarlyCombo } from "./bracketPolicy";
import type { CardRecord, DeckCard } from "./types";

let cardCounter = 0;

function cardRecord(manaValue: number): CardRecord {
  cardCounter += 1;
  return { id: `card-${cardCounter}`, name: `Card ${cardCounter}`, typeLine: "Creature", oracleText: "", manaValue, colors: [], colorIdentity: [] };
}

function nonlandCards(count: number, role: string, manaValue = 3): DeckCard[] {
  return Array.from({ length: count }, (_, index) => ({ name: `${role} ${index}`, count: 1, role, card: cardRecord(manaValue) }));
}

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

describe("inferDeckArchetype", () => {
  it("classifies a creature-heavy, low-curve deck as aggro", () => {
    const cards: DeckCard[] = [
      ...nonlandCards(30, "creature", 2),
      ...nonlandCards(5, "removal", 2),
      ...nonlandCards(5, "draw", 2),
      { name: "Forest", count: 37, role: "land" }
    ];
    expect(inferDeckArchetype({ cards })).toBe("aggro");
  });

  it("does not call a board-heavy deck aggro when its creatures are expensive", () => {
    const cards: DeckCard[] = [
      ...nonlandCards(30, "creature", 6),
      ...nonlandCards(5, "removal", 3),
      ...nonlandCards(5, "draw", 3),
      { name: "Forest", count: 37, role: "land" }
    ];
    expect(inferDeckArchetype({ cards })).toBe("midrange");
  });

  it("classifies a removal/wipe-heavy, creature-light deck as control", () => {
    const cards: DeckCard[] = [
      ...nonlandCards(20, "removal", 3),
      ...nonlandCards(8, "wipe", 4),
      ...nonlandCards(5, "creature", 4),
      ...nonlandCards(5, "draw", 3),
      { name: "Forest", count: 37, role: "land" }
    ];
    expect(inferDeckArchetype({ cards })).toBe("control");
  });

  it("classifies a draw/ramp-heavy, board-light deck as combo", () => {
    const cards: DeckCard[] = [
      ...nonlandCards(15, "draw", 2),
      ...nonlandCards(15, "ramp", 2),
      ...nonlandCards(3, "removal", 2),
      ...nonlandCards(3, "creature", 3),
      { name: "Forest", count: 37, role: "land" }
    ];
    expect(inferDeckArchetype({ cards })).toBe("combo");
  });

  it("classifies a balanced deck (no dominant plan) as midrange", () => {
    const cards: DeckCard[] = [
      ...nonlandCards(14, "creature", 4),
      ...nonlandCards(14, "removal", 3),
      ...nonlandCards(7, "draw", 3),
      ...nonlandCards(7, "ramp", 2),
      { name: "Forest", count: 37, role: "land" }
    ];
    expect(inferDeckArchetype({ cards })).toBe("midrange");
  });
});

describe("buildDeckGamePlan", () => {
  it("names the two heaviest role categories and an archetype-appropriate tactical line", () => {
    const cards: DeckCard[] = [
      ...nonlandCards(15, "ramp", 2),
      ...nonlandCards(15, "draw", 2),
      ...nonlandCards(3, "removal", 2),
      { name: "Forest", count: 37, role: "land" }
    ];
    const plan = buildDeckGamePlan({ cards }, "combo");
    expect(plan).toContain("combo deck");
    expect(plan).toContain("ramp");
    expect(plan).toContain("card draw");
    expect(plan).not.toContain("removal");
  });

  it("produces distinct text per archetype for the same deck", () => {
    const cards: DeckCard[] = [...nonlandCards(20, "creature", 3), { name: "Forest", count: 37, role: "land" }];
    const plans = new Set((["aggro", "control", "combo", "midrange"] as const).map((archetype) => buildDeckGamePlan({ cards }, archetype)));
    expect(plans.size).toBe(4);
  });

  it("still returns a sensible sentence for a deck with no tagged nonland roles", () => {
    const cards: DeckCard[] = [{ name: "Forest", count: 37, role: "land" }];
    const plan = buildDeckGamePlan({ cards }, "midrange");
    expect(plan).toContain("midrange deck");
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
