import { describe, expect, it } from "vitest";
import { createDeckFromCards, createDeckFromList, parseDeckList } from "./deckParser";
import type { CardRecord } from "./types";

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

  it("infers role from the spell face of a modal double-faced spell // land card, not the combined type line", () => {
    const mdfc: CardRecord = {
      id: "mdfc-1",
      name: "Sea Gate Restoration // Sea Gate, Reborn",
      typeLine: "Sorcery // Land",
      oracleText: "Draw cards equal to the number of cards in your hand plus one.",
      manaCost: "{4}{U}{U}{U}",
      manaValue: 7,
      colors: ["U"],
      colorIdentity: ["U"],
      faces: [
        { name: "Sea Gate Restoration", typeLine: "Sorcery", oracleText: "Draw cards equal to the number of cards in your hand plus one.", colors: ["U"], manaCost: "{4}{U}{U}{U}" },
        { name: "Sea Gate, Reborn", typeLine: "Land", oracleText: "{T}: Add {U}.", colors: [] }
      ]
    };
    const catalog = { lookup: (name: string) => (name === "Sea Gate Restoration // Sea Gate, Reborn" ? mdfc : undefined) };
    const deck = createDeckFromCards({
      owner: "test",
      commander: "Aminatou, Veil Piercer",
      cards: [{ name: "Sea Gate Restoration // Sea Gate, Reborn", count: 1 }],
      catalog
    });

    expect(deck.cards[0].role).not.toBe("land");
    expect(deck.cards[0].role).toBe("draw");
  });
});
