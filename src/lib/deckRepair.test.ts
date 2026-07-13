import { describe, expect, it } from "vitest";
import { repairCommanderDeckCards } from "./deckRepair";
import type { CardRecord } from "./types";

describe("repairCommanderDeckCards", () => {
  it("removes off-identity generated cards and fills the deck with legal basics", () => {
    const catalog = makeCatalog([
      card("Shalai, Voice of Plenty", "Legendary Creature - Angel", ["G", "W"]),
      card("Swords to Plowshares", "Instant", ["W"]),
      card("Counterspell", "Instant", ["U"]),
      card("Sol Ring", "Artifact", []),
      card("Arcane Signet", "Artifact", []),
      card("Beast Within", "Instant", ["G"]),
      card("Eternal Witness", "Creature - Human Shaman", ["G"]),
      card("Forest", "Basic Land - Forest", []),
      card("Plains", "Basic Land - Plains", [])
    ]);

    const repaired = repairCommanderDeckCards({
      commander: "Shalai, Voice of Plenty",
      colors: ["G", "W"],
      catalog,
      cards: [
        { name: "Shalai, Voice of Plenty", count: 1, role: "commander" },
        { name: "Swords to Plowshares", count: 1, role: "removal" },
        { name: "Counterspell", count: 1, role: "interaction" }
      ]
    });

    expect(repaired.reduce((sum, item) => sum + item.count, 0)).toBe(100);
    expect(repaired.some((item) => item.name === "Counterspell")).toBe(false);
    expect(repaired.some((item) => item.name === "Swords to Plowshares")).toBe(true);
    expect(repaired.some((item) => item.name === "Sol Ring")).toBe(true);
    expect(repaired.some((item) => item.name === "Beast Within")).toBe(true);
    expect(repaired.filter((item) => ["Forest", "Plains"].includes(item.name)).reduce((sum, item) => sum + item.count, 0)).toBeLessThan(98);
  });
});

function makeCatalog(cards: CardRecord[]) {
  return {
    lookup: (name: string) => cards.find((card) => card.name === name)
  };
}

function card(name: string, typeLine: string, colorIdentity: string[]): CardRecord {
  return {
    id: `test-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    typeLine,
    oracleText: "Test oracle text.",
    manaValue: typeLine.includes("Land") ? 0 : 1,
    colors: colorIdentity,
    colorIdentity,
    legalities: { commander: "legal" }
  };
}
