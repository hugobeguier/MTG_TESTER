// Regression guard (kernel observer round 2): a Saga gets its lore counter as the PRECOMBAT MAIN phase begins (rule 714.3b), not in the draw step.
// The orchestrator's phase switch is not exported, so this reads the source: the draw-step case must not advance Sagas, the precombat-main case must.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("headless Saga lore counters", () => {
  const src = readFileSync(new URL("./orchestrator.ts", import.meta.url), "utf8");
  const between = (from: string, to: string): string => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
  it("the draw step does not add lore counters", () => { expect(between('case "draw step": {', 'case "precombat main phase":')).not.toContain("advanceSagaLoreCountersHeadless"); });
  it("the precombat main phase adds them before the main-phase decisions", () => { expect(between('case "precombat main phase":', "runMainPhase(")).toContain("advanceSagaLoreCountersHeadless"); });
});
