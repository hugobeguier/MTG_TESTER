// Performance guards for big late-game boards (the live report: < 1 fps at turn 17 with many creatures on every board). The bounds are generous (about 5-10x the
// measured cost on a development machine) so they only trip on a real regression such as a quadratic scan coming back, not on a slow CI box.
import { describe, expect, it } from "vitest";
import { KernelSession } from "./kernelSession";
import { ctx } from "./testgame";
import { BIG_DECKS, bigState } from "./bigBoard";
import { resolve } from "../engine/resolve";
import { legalActions } from "../engine/legal";
import { planMain } from "../ai/plan";
import { profileFromState } from "../ai/profile";

const timed = <T,>(f: () => T): { v: T; ms: number } => { const t = performance.now(); const v = f(); return { v, ms: performance.now() - t }; };

describe("late-game board performance", () => {
  const st = bigState(BIG_DECKS, 8, 8); // 4 x (8 creatures + 2 lands) = 40 permanents, 32 graveyard cards
  const ks = KernelSession.fromState(st, { ctx });
  const seat = ks.actor!;
  legalActions(st, seat, ctx); // warm the card lookups (the first call reads the card database)

  it("one engine step stays cheap (the AI and legalActions are built from them)", () => {
    const adv = { type: "advancePhase" as const, player: seat };
    resolve(st, adv, ctx);
    const { ms } = timed(() => { for (let i = 0; i < 5; i++) resolve(st, adv, ctx); });
    expect(ms / 5).toBeLessThan(250); // measured ~10 ms
  });

  it("legalActions on 40 permanents", () => {
    const { v, ms } = timed(() => legalActions(st, seat, ctx));
    expect(v.length).toBeGreaterThan(1);
    expect(ms).toBeLessThan(4000); // measured ~0.3 s
  });

  it("an AI main-phase decision spends at most its step budget and finishes in bounded time", () => {
    const acts = legalActions(st, seat, ctx).filter((a) => a.kind !== "playLand");
    const prof = profileFromState(st, ctx, seat);
    const work = { n: 0, cap: 900 };
    const { ms } = timed(() => planMain(acts, st, ctx, seat, new Set(), {}, work, prof));
    expect(work.n).toBeLessThanOrEqual(900 + 60); // the budget is a count of engine steps (a last walk may overshoot by its own clamp)
    expect(ms).toBeLessThan(20000); // measured ~1 s
  });
});
