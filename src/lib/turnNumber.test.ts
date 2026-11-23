import { describe, expect, it } from "vitest";
import { displayTurnNumber } from "./turnNumber";
import { buildIndicatorView } from "@/components/game/turnIndicatorView";

// the global count is one per player's turn; seat s (0-based) of n plays global turns s+1, s+1+n, ...
describe("displayTurnNumber", () => {
  for (const n of [2, 3, 4]) {
    it(`${n} players: every seat's Kth turn shows as turn K`, () => {
      for (let round = 1; round <= 5; round++) for (let seat = 0; seat < n; seat++) expect(displayTurnNumber((round - 1) * n + seat + 1, n)).toBe(round);
    });
  }
  it("4 players, global turn 11 (the reported bug) is turn 3", () => {
    expect(displayTurnNumber(11, 4)).toBe(3);
  });
  it("never below 1 and tolerates a zero seat count", () => {
    expect(displayTurnNumber(0, 4)).toBe(1);
    expect(displayTurnNumber(1, 0)).toBe(1);
  });
  it("after an elimination legacy keeps dividing by the full seat count (eliminated seats stay in the list), so the number advances more slowly", () => {
    // 4 players, seat 3 out: only 3 turns per round now but the divisor stays 4 (legacy behaviour, mirrored on purpose)
    expect([9, 10, 11, 12, 13].map((t) => displayTurnNumber(t, 4))).toEqual([3, 3, 3, 3, 4]);
  });
  it("the indicator banner shows the displayed number, not the global one", () => {
    const seats = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }];
    const v = buildIndicatorView({ seats, humanSeatId: "a", activeSeatId: "c", phase: "upkeep", turnNumber: displayTurnNumber(11, seats.length), stackSize: 0 });
    expect(v.banner).toBe("Turn 3 - C's turn");
  });
});
