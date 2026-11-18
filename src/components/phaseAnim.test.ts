import { describe, expect, it } from "vitest";
import { PHASE_ANIM_MS, nextPhaseTween, phaseProgress } from "./phaseAnim";

describe("phase animation", () => {
  it("a card first seen already phased out is drawn ghosted without animating", () => {
    const tween = nextPhaseTween(undefined, 1000, 1);
    expect(phaseProgress(tween, 1000, 1)).toBe(1);
  });
  it("flipping the flag eases from the current level to the new one", () => {
    const solid = nextPhaseTween(undefined, 0, 0);
    const out = nextPhaseTween(solid, 5000, 1);
    expect(phaseProgress(out, 5000, 1)).toBe(0);
    const mid = phaseProgress(out, 5000 + PHASE_ANIM_MS / 2, 1);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    expect(phaseProgress(out, 5000 + PHASE_ANIM_MS, 1)).toBe(1);
    // flipping back mid-way starts from where it was (no jump)
    const back = nextPhaseTween(out, 5000 + PHASE_ANIM_MS / 2, 0);
    expect(phaseProgress(back, 5000 + PHASE_ANIM_MS / 2, 0)).toBeCloseTo(mid, 5);
    expect(phaseProgress(back, 9000, 0)).toBe(0);
  });
  it("an unchanged flag keeps its tween", () => {
    const t = nextPhaseTween(undefined, 0, 0);
    expect(nextPhaseTween(t, 99, 0)).toBe(t);
  });
});
