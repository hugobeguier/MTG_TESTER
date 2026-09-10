import { describe, expect, it } from "vitest";
import { chooseAgentLibraryCardForRuleChoice } from "./AppFlow";
import type { PlayerSeat, VisibleCard } from "@/lib/types";

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "typeLine">): VisibleCard {
  return { oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "battlefield", ...overrides };
}

function seat(overrides: Partial<PlayerSeat> & Pick<PlayerSeat, "id" | "name" | "kind">): PlayerSeat {
  return {
    life: 40,
    commanderDamage: {},
    zones: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield: [] },
    ...overrides
  };
}

function commanderWithColorIdentity(colorIdentity: string[]): VisibleCard {
  return card({ id: "commander", name: "Test Commander", typeLine: "Legendary Creature — Test", colorIdentity, commander: true });
}

function basicLandChoice(overrides: Partial<{ maxChoices: number }> = {}) {
  return {
    id: "choice-1",
    kind: "choose_card_from_library" as const,
    controllerSeatId: "p",
    sourceCardId: "kodamas-reach",
    sourceCardName: "Kodama's Reach",
    prompt: "Search your library for up to two basic land cards.",
    destination: "battlefield" as const,
    maxChoices: overrides.maxChoices ?? 2,
    allowedCardFilter: "basic land cards"
  };
}

describe("chooseAgentLibraryCardForRuleChoice — basic land color-gap preference (Kodama's Reach)", () => {
  it("fetches a color the seat is completely missing over one it already has (reported live)", () => {
    const forest = card({ id: "forest", name: "Forest", typeLine: "Basic Land — Forest" });
    const swamp = card({ id: "swamp", name: "Swamp", typeLine: "Basic Land — Swamp" });
    const plains = card({ id: "plains", name: "Plains", typeLine: "Basic Land — Plains" });
    // Veyra, the Ur-Dragon: WUBRG. Already has green + black on the battlefield, blue in hand.
    const existingForest = card({ id: "existing-forest", name: "Forest", typeLine: "Basic Land — Forest" });
    const existingSwamp = card({ id: "existing-swamp", name: "Swamp", typeLine: "Basic Land — Swamp" });
    const player = seat({
      id: "p",
      name: "Player",
      kind: "agent",
      library: [forest, swamp, plains],
      board: { hand: [], battlefield: [existingForest, existingSwamp], commander: commanderWithColorIdentity(["W", "U", "B", "R", "G"]) }
    });
    const picked = chooseAgentLibraryCardForRuleChoice(player, basicLandChoice(), new Set(), [], [player]);
    expect(picked?.id).toBe("plains");
  });

  it("the second pick in the same search chases a DIFFERENT missing color than the first", () => {
    const plains = card({ id: "plains", name: "Plains", typeLine: "Basic Land — Plains" });
    const mountain = card({ id: "mountain", name: "Mountain", typeLine: "Basic Land — Mountain" });
    const swamp = card({ id: "swamp", name: "Swamp", typeLine: "Basic Land — Swamp" });
    const existingForest = card({ id: "existing-forest", name: "Forest", typeLine: "Basic Land — Forest" });
    const existingSwamp = card({ id: "existing-swamp", name: "Swamp", typeLine: "Basic Land — Swamp" });
    const player = seat({
      id: "p",
      name: "Player",
      kind: "agent",
      library: [swamp, plains, mountain],
      board: { hand: [], battlefield: [existingForest, existingSwamp], commander: commanderWithColorIdentity(["W", "U", "B", "R", "G"]) }
    });
    const first = chooseAgentLibraryCardForRuleChoice(player, basicLandChoice(), new Set(), [], [player]);
    expect(first?.id).not.toBe("swamp"); // already covered — a totally missing color should win
    const second = chooseAgentLibraryCardForRuleChoice(player, basicLandChoice(), new Set(first ? [first.id] : []), first ? [first] : [], [player]);
    expect(second?.id).not.toBe("swamp");
    expect(second?.id).not.toBe(first?.id);
  });

  it("falls back to a deck-color land once every deck color is already covered (regression guard)", () => {
    const plains = card({ id: "plains", name: "Plains", typeLine: "Basic Land — Plains" });
    const island = card({ id: "island", name: "Island", typeLine: "Basic Land — Island" });
    const existingPlains = card({ id: "existing-plains", name: "Plains", typeLine: "Basic Land — Plains" });
    const existingIsland = card({ id: "existing-island", name: "Island", typeLine: "Basic Land — Island" });
    const player = seat({
      id: "p",
      name: "Player",
      kind: "agent",
      library: [plains, island],
      board: { hand: [], battlefield: [existingPlains, existingIsland], commander: commanderWithColorIdentity(["W", "U"]) }
    });
    const picked = chooseAgentLibraryCardForRuleChoice(player, basicLandChoice(), new Set(), [], [player]);
    expect(["plains", "island"]).toContain(picked?.id);
  });

  it("still just picks the first basic land when the deck's colors aren't known (regression guard)", () => {
    const swamp = card({ id: "swamp", name: "Swamp", typeLine: "Basic Land — Swamp" });
    const island = card({ id: "island", name: "Island", typeLine: "Basic Land — Island" });
    const player = seat({ id: "p", name: "Player", kind: "agent", library: [swamp, island], board: { hand: [], battlefield: [] } });
    const picked = chooseAgentLibraryCardForRuleChoice(player, basicLandChoice(), new Set(), [], [player]);
    expect(picked?.id).toBe("swamp");
  });
});
