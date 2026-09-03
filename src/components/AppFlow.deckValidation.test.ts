import { describe, expect, it } from "vitest";
import { validateConfigsForPlay } from "./AppFlow";
import type { CommanderDeck } from "@/lib/types";

function deck(overrides: Partial<CommanderDeck> = {}): CommanderDeck {
  return {
    id: "deck-1",
    name: "Test Deck",
    commander: "Meren of Clan Nel Toth",
    bracket: 3,
    colors: ["B", "G"],
    cards: [],
    createdBy: "You",
    createdAt: "",
    validation: { legal: true, errors: [], warnings: [], cardCount: 100, uniqueNonBasicCount: 40, gameChangerCount: 0 },
    score: { total: 50, curve: 0, mana: 0, interaction: 0, synergy: 0, resilience: 0, bracketFit: 0, notes: [] },
    ...overrides
  };
}

function config(overrides: Partial<Parameters<typeof validateConfigsForPlay>[0][number]> = {}) {
  return {
    seatId: "seat-human",
    name: "You",
    kind: "human" as const,
    mode: "decklist" as const,
    commander: "Meren of Clan Nel Toth",
    deckList: "Commander: Meren of Clan Nel Toth\n1 Three Visits\n98 Forest",
    status: "ready" as const,
    message: "",
    activity: [],
    ...overrides
  };
}

describe("validateConfigsForPlay", () => {
  it("passes a seat through when its deck was already built via buildDeck's own catalog-aware round trip", () => {
    const built = deck();
    const result = validateConfigsForPlay([config({ deck: built })]);
    expect(result.ready).toBe(true);
    expect(result.configs[0].deck).toBe(built);
    expect(result.configs[0].status).toBe("ready");
  });

  it("blocks play instead of silently rebuilding a decklist-mode seat's deck with no card catalog", () => {
    // Reported live: Kodama's Reach, Cultivate, and Three Visits all "did nothing" when cast —
    // traced to this exact fallback substituting a mock, oracle-text-less deck (built with no
    // catalog access) that still reported itself as fully legal. A missing config.deck must block
    // starting the game, not get silently patched over with fake card data.
    const result = validateConfigsForPlay([config({ deck: undefined })]);
    expect(result.ready).toBe(false);
    expect(result.configs[0].status).toBe("error");
    expect(result.configs[0].message).toBe("Build or validate this deck before pressing Play.");
    expect(result.configs[0].deck).toBeUndefined();
  });

  it("still blocks play for a deck that failed its own validation", () => {
    const invalid = deck({ validation: { legal: false, errors: ["Deck list is missing a commander."], warnings: [], cardCount: 99, uniqueNonBasicCount: 40, gameChangerCount: 0 } });
    const result = validateConfigsForPlay([config({ deck: invalid })]);
    expect(result.ready).toBe(false);
    expect(result.configs[0].message).toBe("Deck list is missing a commander.");
  });
});
