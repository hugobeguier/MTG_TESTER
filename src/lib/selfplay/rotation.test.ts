// Guards the independence property rotation.ts's header comment argues for by construction — this
// codebase has already shipped two versions of this rotation that LOOKED independent (different
// periods) but weren't (periods sharing a common factor), each only caught by someone reading a real
// run's numbers after the fact. This test checks the actual joint distribution instead of trusting
// the arithmetic.
import { describe, expect, it } from "vitest";
import { computeGameRotation, DECK_FILES } from "./rotation";

describe("computeGameRotation", () => {
  // A large multiple of every axis's period so every (pairIndex, forceFirstSeatIndex) bucket gets an
  // equal, exact number of samples — deterministic sequences repeat exactly, so this isn't a
  // statistical test, it's an exact-count check.
  const CYCLE = 2 * DECK_FILES.length * 2 * 3; // pairIndex period * forceFirstSeatIndex period(already
  // folded into pairIndex's 2*length) * ollamaSeatIndex period, i.e. plenty of full cycles.
  const SAMPLE = CYCLE * 10;

  it("never lets ollamaSeatIndex correlate with forceFirstSeatIndex", () => {
    const counts: Record<0 | 1, { 0: number; 1: number }> = { 0: { 0: 0, 1: 0 }, 1: { 0: 0, 1: 0 } };
    for (let i = 0; i < SAMPLE; i += 1) {
      const { forceFirstSeatIndex, ollamaSeatIndex } = computeGameRotation(i);
      counts[forceFirstSeatIndex][ollamaSeatIndex] += 1;
    }
    // Same ollamaSeatIndex=0:1 ratio regardless of forceFirstSeatIndex value — a real correlation
    // (like the period-6 bug) would show up as a different ratio between these two rows.
    expect(counts[0][0] / counts[0][1]).toBeCloseTo(counts[1][0] / counts[1][1], 10);
  });

  it("never lets ollamaSeatIndex correlate with which decks are paired this game", () => {
    const counts = new Map<number, { 0: number; 1: number }>();
    for (let i = 0; i < SAMPLE; i += 1) {
      const { pairIndex, ollamaSeatIndex } = computeGameRotation(i);
      const bucket = counts.get(pairIndex) ?? { 0: 0, 1: 0 };
      bucket[ollamaSeatIndex] += 1;
      counts.set(pairIndex, bucket);
    }
    const ratios = [...counts.values()].map((bucket) => bucket[0] / bucket[1]);
    for (const ratio of ratios) expect(ratio).toBeCloseTo(ratios[0], 10);
  });

  it("gives every deck pairing an equal share of who-goes-first", () => {
    // Independent of ollamaSeatIndex entirely: deck pairing changes every 2 games, aligned with
    // forceFirstSeatIndex's own period-2 alternation, so each pairing should see forceFirstSeatIndex
    // 0 and 1 equally often.
    const counts = new Map<number, { 0: number; 1: number }>();
    for (let i = 0; i < SAMPLE; i += 1) {
      const { pairIndex, forceFirstSeatIndex } = computeGameRotation(i);
      const bucket = counts.get(pairIndex) ?? { 0: 0, 1: 0 };
      bucket[forceFirstSeatIndex] += 1;
      counts.set(pairIndex, bucket);
    }
    for (const bucket of counts.values()) expect(bucket[0]).toBe(bucket[1]);
  });

  it("covers every deck pairing", () => {
    const seen = new Set<number>();
    for (let i = 0; i < SAMPLE; i += 1) seen.add(computeGameRotation(i).pairIndex);
    expect(seen.size).toBe(DECK_FILES.length);
  });
});
