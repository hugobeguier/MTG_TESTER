import { describe, expect, it } from "vitest";
import { createDeckFromList, parseDeckList } from "./deckParser";

describe("parseDeckList", () => {
  it("accepts common counted deck list lines", () => {
    const parsed = parseDeckList("Commander: Meren of Clan Nel Toth\n1 Sol Ring\n1 Arcane Signet\n38 Forest");

    expect(parsed.errors).toEqual([]);
    expect(parsed.commander).toBe("Meren of Clan Nel Toth");
    expect(parsed.cards.find((card) => card.name === "Sol Ring")?.count).toBe(1);
  });

  it("reports malformed counts", () => {
    const parsed = parseDeckList("one Sol Ring");

    expect(parsed.errors[0]).toContain("Line 1");
  });

  it("detects non-basic duplicates through deck validation", () => {
    const deck = createDeckFromList({
      owner: "test",
      commander: "Kess, Dissident Mage",
      deckList: "1 Kess, Dissident Mage\n2 Counterspell\n97 Island"
    });

    expect(deck.validation.legal).toBe(false);
    expect(deck.validation.errors.join(" ")).toContain("Counterspell");
  });

  it("allows basic land duplicates", () => {
    const deck = createDeckFromList({
      owner: "test",
      commander: "Meren of Clan Nel Toth",
      deckList: "1 Meren of Clan Nel Toth\n1 Sol Ring\n98 Forest"
    });

    expect(deck.validation.errors.join(" ")).not.toContain("Forest appears");
  });

  it("trims Moxfield set codes, collector numbers, and foil markers", () => {
    const parsed = parseDeckList("1 Aminatou, the Fateshifter (C18) 37 *F*\n1 Sol Ring (DSC) 94\n6 Island (DSK) 280");

    expect(parsed.cards).toEqual([
      { name: "Aminatou, the Fateshifter", count: 1, role: "spell" },
      { name: "Sol Ring", count: 1, role: "ramp" },
      { name: "Island", count: 6, role: "land" }
    ]);
  });
});
