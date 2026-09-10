import { describe, expect, it } from "vitest";
import { applyDeterministicPhaseTrigger, isRecognizedBoardCondition } from "./AppFlow";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

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

function session(seats: PlayerSeat[]): GameSession {
  return {
    id: "test",
    createdAt: "",
    status: "playing",
    phase: "upkeep step",
    turn: 1,
    xmage: { enabled: false, status: "not_configured", message: "" },
    seats,
    events: []
  };
}

// Real oracle text, verified via local card DB.
const PADEEM_TEXT =
  "Artifacts you control have hexproof. (They can't be the targets of spells or abilities your opponents control.)\nAt the beginning of your upkeep, if you control the artifact with the greatest mana value or tied for the greatest mana value, draw a card.";

function padeem(): VisibleCard {
  return card({ id: "padeem", name: "Padeem, Consul of Innovation", typeLine: "Legendary Artifact Creature — Human Wizard", oracleText: PADEEM_TEXT, manaValue: 2 });
}

describe("isRecognizedBoardCondition — Padeem's greatest-mana-value condition", () => {
  it("recognizes the exact condition text", () => {
    expect(isRecognizedBoardCondition("you control the artifact with the greatest mana value or tied for the greatest mana value")).toBe(true);
  });
});

describe("applyDeterministicPhaseTrigger — Padeem, Consul of Innovation", () => {
  it("draws when the controller's own artifact ties for the board's greatest mana value", () => {
    const servo = card({ id: "servo", name: "Servo", typeLine: "Artifact Creature — Servo", manaValue: 0 });
    const topOfLibrary = card({ id: "top", name: "Top Card", typeLine: "Instant", zone: "library" });
    const you = seat({
      id: "you",
      name: "You",
      kind: "agent",
      library: [topOfLibrary],
      zones: { library: 1, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 },
      board: { hand: [], battlefield: [padeem(), servo] }
    });
    const result = applyDeterministicPhaseTrigger(session([you]), "you", padeem(), "upkeep step");
    expect(result).toBeDefined();
    expect(result!.seats.find((s) => s.id === "you")!.board.hand).toHaveLength(1);
  });

  it("does not draw when an OPPONENT controls a higher-mana-value artifact (reported live bug)", () => {
    const servo = card({ id: "servo", name: "Servo", typeLine: "Artifact Creature — Servo", manaValue: 0 });
    const darksteelCitadel = card({ id: "citadel", name: "Darksteel Citadel", typeLine: "Land — Citadel", oracleText: "Indestructible\n{T}: Add {C}.", manaValue: 0 });
    const you = seat({ id: "you", name: "You", kind: "agent", board: { hand: [], battlefield: [padeem(), servo, darksteelCitadel] } });
    const opponentArtifact = card({ id: "opp-artifact", name: "Opponent's Artifact", typeLine: "Artifact", manaValue: 2 });
    const opponent = seat({ id: "opp", name: "Opponent", kind: "agent", board: { hand: [], battlefield: [opponentArtifact] } });
    const result = applyDeterministicPhaseTrigger(session([you, opponent]), "you", padeem(), "upkeep step");
    expect(result).toBeDefined();
    expect(result!.seats.find((s) => s.id === "you")!.board.hand).toHaveLength(0);
  });

  it("does not draw when this seat controls no artifact at all", () => {
    const you = seat({ id: "you", name: "You", kind: "agent", board: { hand: [], battlefield: [] } });
    const opponentArtifact = card({ id: "opp-artifact", name: "Opponent's Artifact", typeLine: "Artifact", manaValue: 2 });
    const opponent = seat({ id: "opp", name: "Opponent", kind: "agent", board: { hand: [], battlefield: [opponentArtifact] } });
    const result = applyDeterministicPhaseTrigger(session([you, opponent]), "you", padeem(), "upkeep step");
    expect(result).toBeDefined();
    expect(result!.seats.find((s) => s.id === "you")!.board.hand).toHaveLength(0);
  });
});
