// CR 103.8: in a two-player game the starting player skips the draw of their first turn; with 3+ players nobody skips.
// Found by the kernel observer (the legacy engine always drew). Checked on the rule helper and on the real headless turn loop.
import { describe, expect, it } from "vitest";
import { skipsFirstTurnDraw } from "@/engine/turnFlow";
import type { GameSession } from "@/lib/types";
import { heuristicBrain as passBrain } from "./brains";
import { createSelfPlayGame, playGame } from "./orchestrator";

const fake = (seats: number, turn: number, active: string): GameSession => ({ turn, activePlayerId: active, seats: Array.from({ length: seats }, (_, i) => ({ id: `s${i}` })) }) as unknown as GameSession;

describe("skipsFirstTurnDraw (rule helper)", () => {
  it("two players: only the starting player's first turn", () => {
    expect(skipsFirstTurnDraw(fake(2, 1, "s0"), "s0")).toBe(true);
    expect(skipsFirstTurnDraw(fake(2, 2, "s1"), "s1")).toBe(false); // the second player draws on their first turn
    expect(skipsFirstTurnDraw(fake(2, 3, "s0"), "s0")).toBe(false);
  });
  it("three and four players: nobody skips", () => {
    for (const n of [3, 4]) { expect(skipsFirstTurnDraw(fake(n, 1, "s0"), "s0")).toBe(false); expect(skipsFirstTurnDraw(fake(n, 2, "s1"), "s1")).toBe(false); }
  });
});

describe("the headless turn loop follows it", () => {
  const firstDrawDelta = async (players: number): Promise<number> => {
    const decks = ["Meren.txt", "Saheeli.txt", "Aminatou.txt", "Meren.txt"].slice(0, players);
    const session = createSelfPlayGame({ deckListPaths: decks, forceFirstSeatIndex: 0, seed: 5 });
    const brains = Object.fromEntries(session.seats.map((s) => [s.id, passBrain]));
    let delta: number | undefined;
    await playGame(session, brains, { turnCap: 1, timeoutMs: 60000, onAction: (prev, next, meta) => { if (delta === undefined && meta.actionType === "phase:draw") delta = prev.seats.find((s) => s.id === meta.seatId)!.board.hand.length - next.seats.find((s) => s.id === meta.seatId)!.board.hand.length; } });
    return Math.abs(delta ?? NaN);
  };
  it("2 players: 0 cards drawn on turn 1", async () => { expect(await firstDrawDelta(2)).toBe(0); });
  it("3 players: 1 card drawn on turn 1", async () => { expect(await firstDrawDelta(3)).toBe(1); });
  it("4 players: 1 card drawn on turn 1", async () => { expect(await firstDrawDelta(4)).toBe(1); });
});
