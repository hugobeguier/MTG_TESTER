// Loop guard: a game that applies too many actions (or the same state over and over) ends as "stalled" with a diagnostic instead of looping.
import { describe, expect, it } from "vitest";
import { createSelfPlayGame, createStallGuard, playGame, stallFingerprint } from "./orchestrator";
import { heuristicBrain } from "./brains";

const DECKS = ["decks/foundations/Wretched Ranks.txt", "decks/foundations/Calling All Angels.txt"];

describe("self-play loop guard", () => {
  it("ends a game that exceeds maxActions as stalled, with the last actions in the diagnostic", async () => {
    const session = createSelfPlayGame({ deckListPaths: DECKS, seatNames: ["A", "B"], forceFirstSeatIndex: 0, seed: 1 });
    const result = await playGame(session, Object.fromEntries(session.seats.map((s) => [s.id, heuristicBrain])), { turnCap: 10, maxActions: 5 });
    expect(result.terminationReason).toBe("stalled");
    expect(result.stallDiagnostic?.reason).toBe("max-actions");
    expect(result.stallDiagnostic?.lastActions.length).toBeGreaterThan(0);
  });

  it("flags many consecutive actions that leave the fingerprint unchanged", () => {
    const session = createSelfPlayGame({ deckListPaths: DECKS, seatNames: ["A", "B"], forceFirstSeatIndex: 0, seed: 1 });
    const guard = createStallGuard(1000, 3);
    const meta = { seatId: "x", turn: 1, phase: "precombat main phase", actionType: "cast_spell" };
    expect(stallFingerprint(session)).toBe(stallFingerprint({ ...session }));
    guard(session, meta); guard(session, meta); guard(session, meta);
    expect(() => guard(session, meta)).toThrow(/stalled \(identical-state\)/);
  });

  it("does not interfere with a normal game", async () => {
    const session = createSelfPlayGame({ deckListPaths: DECKS, seatNames: ["A", "B"], forceFirstSeatIndex: 0, seed: 1 });
    const result = await playGame(session, Object.fromEntries(session.seats.map((s) => [s.id, heuristicBrain])), { turnCap: 10 });
    expect(result.terminationReason).not.toBe("stalled");
  }, 60000);
});
