import { describe, expect, it } from "vitest";
import { isLastToKeep, mulliganReturnRequired, undecidedSeats, waitingForNames } from "./mulliganGate";

const seats = [
  { id: "h", name: "Host", kind: "human" as const, board: { hand: [] } },
  { id: "f", name: "Friend", kind: "human" as const, board: { hand: [] } },
  { id: "ai", name: "Bot", kind: "agent" as const, board: { hand: [] } }
];

describe("mulligan gate", () => {
  it("waits for every human seat; agents never count", () => {
    expect(undecidedSeats(seats, { ai: true }).map((s) => s.id)).toEqual(["h", "f"]);
    expect(waitingForNames(seats, { ai: true, h: true })).toEqual(["Friend"]);
    expect(waitingForNames(seats, { ai: true, h: true, f: true })).toEqual([]);
  });
  it("the last undecided human is the one whose keep starts the game, in either order", () => {
    expect(isLastToKeep(seats, { ai: true }, "h")).toBe(false);
    expect(isLastToKeep(seats, { ai: true, h: true }, "f")).toBe(true);
    expect(isLastToKeep(seats, { ai: true, f: true }, "h")).toBe(true);
  });
  it("a solo host (no friends) is immediately last", () => {
    expect(isLastToKeep([seats[0], seats[2]], { ai: true }, "h")).toBe(true);
  });
  it("London mulligan return count: the first mulligan is free, then one card each", () => {
    const hand = new Array(7).fill(0);
    expect([0, 1, 2, 3].map((n) => mulliganReturnRequired(hand, n))).toEqual([0, 0, 1, 2]);
  });
});
