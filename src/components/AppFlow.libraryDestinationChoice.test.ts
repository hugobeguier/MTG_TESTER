import { describe, expect, it } from "vitest";
import { chooseAgentLibraryCardForRuleChoice, moveLibraryCardToDestination } from "./AppFlow";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "typeLine">): VisibleCard {
  return { oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "library", ...overrides };
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

function session(seats: PlayerSeat[]): GameSession {
  return {
    id: "test",
    createdAt: "",
    status: "playing",
    phase: "precombat main phase",
    turn: 1,
    xmage: { enabled: false, status: "not_configured", message: "" },
    seats,
    events: []
  };
}

describe("moveLibraryCardToDestination — Dina's Guidance's real per-pick choice of zone", () => {
  it("places the card in hand and moves zone counts by exactly one", () => {
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const player = seat({ id: "p", name: "You", kind: "human", library: [bear], zones: { library: 1, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 } });
    const result = moveLibraryCardToDestination(session([player]), "p", "bear", "hand", false);
    const after = result.seats.find((s) => s.id === "p")!;
    expect(after.board.hand.map((c) => c.id)).toEqual(["bear"]);
    expect(after.board.graveyard ?? []).toHaveLength(0);
    expect(after.zones.hand).toBe(1);
    expect(after.zones.library).toBe(0);
  });

  it("places the card in the graveyard and moves zone counts by exactly one", () => {
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const player = seat({ id: "p", name: "You", kind: "human", library: [bear], zones: { library: 1, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 } });
    const result = moveLibraryCardToDestination(session([player]), "p", "bear", "graveyard", false);
    const after = result.seats.find((s) => s.id === "p")!;
    expect(after.board.hand).toHaveLength(0);
    expect(after.board.graveyard?.map((c) => c.id)).toEqual(["bear"]);
    expect(after.zones.graveyard).toBe(1);
    expect(after.zones.library).toBe(0);
  });
});

describe("chooseAgentLibraryCardForRuleChoice — Dina's Guidance's \"creature\" restriction", () => {
  it("picks a creature, not a land, honoring allowedCardFilter", () => {
    const forest = card({ id: "forest", name: "Forest", typeLine: "Basic Land — Forest" });
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const player = seat({ id: "p", name: "You", kind: "agent", library: [forest, bear] });
    const choice = {
      id: "choice-1",
      kind: "choose_card_from_library" as const,
      controllerSeatId: "p",
      sourceCardId: "dinas-guidance",
      sourceCardName: "Dina's Guidance",
      prompt: "Search your library for a creature card.",
      destination: "hand" as const,
      destinationChoices: ["hand" as const, "graveyard" as const],
      maxChoices: 1,
      allowedCardFilter: "creature"
    };
    const picked = chooseAgentLibraryCardForRuleChoice(player, choice);
    expect(picked?.id).toBe("bear");
  });
});
