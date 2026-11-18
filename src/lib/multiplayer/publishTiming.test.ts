import { describe, expect, it } from "vitest";
import { PUBLISH_LEAD_MS, PUBLISH_MIN_INTERVAL_MS, publishDelayMs } from "./publishTiming";

describe("publishDelayMs", () => {
  it("publishes quickly after a quiet period (the old debounce always waited 150 ms)", () => {
    expect(publishDelayMs(1000, undefined)).toBe(PUBLISH_LEAD_MS);
    expect(publishDelayMs(10_000, 1000)).toBe(PUBLISH_LEAD_MS);
    expect(PUBLISH_LEAD_MS).toBeLessThan(150);
  });
  it("spaces publishes during a burst, never longer than the min interval", () => {
    expect(publishDelayMs(1050, 1000)).toBe(PUBLISH_MIN_INTERVAL_MS - 50);
    expect(publishDelayMs(1000, 1000)).toBe(PUBLISH_MIN_INTERVAL_MS);
    for (let now = 1000; now < 1300; now += 7) expect(publishDelayMs(now, 1000)).toBeLessThanOrEqual(PUBLISH_MIN_INTERVAL_MS);
  });
});
