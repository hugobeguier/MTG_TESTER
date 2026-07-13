import { describe, expect, it } from "vitest";
import { buildCatalog, lookupCard, normalizeCardName, type CardCatalog } from "./cardCatalog";
import { createDeckFromList } from "./deckParser";
import type { CardRecord } from "./types";

const catalogCards: CardRecord[] = [
  card("Atraxa, Praetors' Voice", "Legendary Creature - Phyrexian Angel Horror", ["W", "U", "B", "G"]),
  card("Sol Ring", "Artifact", []),
  card("Swords to Plowshares", "Instant", ["W"]),
  card("Counterspell", "Instant", ["U"]),
  card("Lightning Bolt", "Instant", ["R"]),
  card("Forest", "Basic Land - Forest", []),
  card("Banned Spell", "Sorcery", ["B"], "banned")
];

const catalog: CardCatalog = {
  cards: catalogCards,
  byName: new Map(catalogCards.map((item) => [normalizeCardName(item.name), item])),
  source: "builtin"
};

describe("card catalog deck enrichment", () => {
  it("looks up card names case-insensitively", () => {
    expect(lookupCard(catalog, "sol ring")?.name).toBe("Sol Ring");
  });

  it("normalizes single and double slash split-card separators", () => {
    expect(normalizeCardName("Secret Arcade / Dusty Parlor")).toBe(normalizeCardName("Secret Arcade // Dusty Parlor"));
  });

  it("prefers exact card names over matching card-face aliases", () => {
    const localCatalog = buildCatalog(
      [
        card("Brainstorm", "Instant", ["U"]),
        {
          ...card("Harmonized Trio // Brainstorm", "Creature - Merfolk Bard Wizard // Instant", ["U"]),
          faces: [
            { name: "Harmonized Trio", typeLine: "Creature - Merfolk Bard Wizard", oracleText: "Test front face.", colors: ["U"] },
            { name: "Brainstorm", typeLine: "Instant", oracleText: "Test back face.", colors: ["U"] }
          ]
        }
      ],
      undefined,
      "builtin"
    );

    expect(lookupCard(localCatalog, "Brainstorm")?.name).toBe("Brainstorm");
  });

  it("enriches valid Commander deck lists with real card data", () => {
    const deck = createDeckFromList({
      owner: "test",
      commander: "Atraxa, Praetors' Voice",
      deckList: "Commander: Atraxa, Praetors' Voice\n1 Sol Ring\n1 Swords to Plowshares\n97 Forest",
      catalog: { lookup: (name) => lookupCard(catalog, name) }
    });

    expect(deck.validation.legal).toBe(true);
    expect(deck.commanderCard?.name).toBe("Atraxa, Praetors' Voice");
    expect(deck.cards.find((item) => item.name === "Sol Ring")?.card?.typeLine).toBe("Artifact");
  });

  it("rejects unknown, banned, and off-color cards when catalog data is available", () => {
    const deck = createDeckFromList({
      owner: "test",
      commander: "Atraxa, Praetors' Voice",
      deckList: "Commander: Atraxa, Praetors' Voice\n1 Unknown Card\n1 Banned Spell\n1 Lightning Bolt\n96 Forest",
      catalog: { lookup: (name) => lookupCard(catalog, name) }
    });

    expect(deck.validation.legal).toBe(false);
    expect(deck.validation.errors.join(" ")).toContain("Unknown card: Unknown Card.");
    expect(deck.validation.errors.join(" ")).toContain("Banned Spell is not legal in Commander.");
    expect(deck.validation.errors.join(" ")).toContain("Lightning Bolt has color identity R");
  });
});

function card(name: string, typeLine: string, colorIdentity: string[], commander = "legal"): CardRecord {
  return {
    id: `test-${normalizeCardName(name).replace(/[^a-z0-9]+/g, "-")}`,
    name,
    typeLine,
    oracleText: typeLine.includes("Land") ? "Tap: Add mana." : "Test oracle text.",
    manaValue: typeLine.includes("Land") ? 0 : 1,
    colors: colorIdentity,
    colorIdentity,
    legalities: { commander }
  };
}
