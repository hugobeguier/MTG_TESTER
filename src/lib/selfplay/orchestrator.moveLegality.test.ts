// Whole-game smoke test for the central legality gate: with the shipped decks, a game must never get stuck and must never commit a no-op action,
// even when the decision maker keeps proposing illegal / stale / hallucinated moves (the gate rejects them, the seat re-decides, then falls back).
import { describe, expect, it } from "vitest";
import { createSelfPlayGame, playGame } from "./orchestrator";
import { heuristicBrain, type Brain } from "./brains";

const DECKS = ["decks/foundations/Wretched Ranks.txt", "decks/foundations/Calling All Angels.txt", "decks/foundations/Keen Engineering.txt", "decks/foundations/Tramplesaurus Rex.txt"];

function newGame(seed: number) {
  return createSelfPlayGame({ deckListPaths: DECKS, seatNames: ["A", "B", "C", "D"], forceFirstSeatIndex: 0, seed });
}

describe("self-play with the legality gate", () => {
  it("heuristic brains play several turns with no stuck game and no committed no-op action", async () => {
    for (const seed of [1, 2, 3, 6, 7]) {
      const session = newGame(seed);
      const result = await playGame(session, Object.fromEntries(session.seats.map((seat) => [seat.id, heuristicBrain])), { turnCap: 10 });
      expect(result.terminationReason).not.toBe("crash");
      expect(result.terminationReason).not.toBe("timeout");
      expect(result.gateEvents.filter((event) => event.kind === "noop")).toEqual([]);
      expect(result.turns).toBeGreaterThan(2);
    }
  }, 60000);

  it("a brain that keeps proposing hallucinated or stale ids is rejected, never loops, and the game still progresses", async () => {
    let calls = 0;
    const chaotic: Brain = async (request) => {
      calls += 1;
      // Every other main-phase decision names an id that is not (or no longer) offered; the rest are the heuristic's pick.
      if (request.purpose === "main_phase" && calls % 2 === 0) {
        return { source: "invalid", action: { actionType: "cast_spell", legalActionId: `cast:ghost-${calls}`, targetIds: [], reason: "chaos", fallbackAction: "pass_priority" } };
      }
      return heuristicBrain(request);
    };
    const session = newGame(4);
    const result = await playGame(session, Object.fromEntries(session.seats.map((seat) => [seat.id, chaotic])), { turnCap: 6 });
    expect(result.terminationReason).not.toBe("crash");
    expect(result.terminationReason).not.toBe("timeout");
    expect(result.gateEvents.some((event) => event.kind === "rejected")).toBe(true);
    expect(result.gateEvents.filter((event) => event.kind === "noop")).toEqual([]);
    expect(result.turns).toBeGreaterThan(2);
  }, 60000);

  it("a brain that ALWAYS names an illegal id cannot stall the game: every phase ends in the deterministic fallback", async () => {
    const stubborn: Brain = async () => ({ source: "invalid", action: { actionType: "cast_spell", legalActionId: "cast:never-legal", targetIds: [], reason: "stubborn", fallbackAction: "pass_priority" } });
    const session = newGame(5);
    const result = await playGame(session, Object.fromEntries(session.seats.map((seat) => [seat.id, stubborn])), { turnCap: 4 });
    expect(result.terminationReason).not.toBe("crash");
    expect(result.terminationReason).not.toBe("timeout");
    expect(result.turns).toBeGreaterThan(2);
  }, 60000);
});
