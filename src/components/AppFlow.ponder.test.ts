import { describe, expect, it } from "vitest";
import { parseSimpleDrawEffect, resolveAgentLibraryLookWorkflow } from "./AppFlow";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const PONDER_ORACLE_TEXT = "Look at the top three cards of your library, then put them back in any order. You may shuffle.\nDraw a card.";

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name">): VisibleCard {
  return { typeLine: "Sorcery", oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "library", ...overrides };
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

describe("parseSimpleDrawEffect — Ponder's look/reorder-then-draw template", () => {
  it("declines (rather than short-circuiting to a plain draw) so the rules advisor's reorder_top_cards workflow gets a chance to run", () => {
    expect(parseSimpleDrawEffect(PONDER_ORACLE_TEXT)).toBeUndefined();
  });

  it("still matches a genuinely plain draw spell with no look/reorder text", () => {
    expect(parseSimpleDrawEffect("Draw two cards.")).toEqual({ amount: 2 });
  });
});

describe("resolveAgentLibraryLookWorkflow — reorder_top_cards with a trailing draw", () => {
  it("draws the trailing card count for an agent even though the reorder itself stays a no-op", () => {
    const libraryCards = [card({ id: "l1", name: "Top Card" }), card({ id: "l2", name: "Second Card" }), card({ id: "l3", name: "Third Card" })];
    const agent = seat({
      id: "a1",
      name: "Agent",
      kind: "agent",
      library: libraryCards,
      board: { hand: [], battlefield: [] },
      zones: { library: libraryCards.length, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 }
    });
    const result = resolveAgentLibraryLookWorkflow(session([agent]), "a1", "Ponder", "reorder_top_cards", 3, undefined, 1);
    const after = result.seats.find((item) => item.id === "a1")!;
    expect(after.board.hand).toHaveLength(1);
    expect(after.library).toHaveLength(2);
  });

  it("does not draw when no drawCountAfter is given", () => {
    const libraryCards = [card({ id: "l1", name: "Top Card" }), card({ id: "l2", name: "Second Card" })];
    const agent = seat({ id: "a1", name: "Agent", kind: "agent", library: libraryCards, board: { hand: [], battlefield: [] } });
    const result = resolveAgentLibraryLookWorkflow(session([agent]), "a1", "Some Scry Card", "scry_cards", 1);
    const after = result.seats.find((item) => item.id === "a1")!;
    expect(after.board.hand).toHaveLength(0);
    expect(after.library).toHaveLength(2);
  });
});
