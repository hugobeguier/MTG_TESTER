// When the host publishes after a game-state change. The old rule was a pure 150 ms debounce: every change restarted the timer, so a friend's click
// waited 150 ms plus the POST, and during a burst of changes (a card being dragged) nothing went out until the burst stopped. Now: the first change after a
// quiet period goes out after LEAD_MS (just enough to batch the several React state updates one action causes), and during a burst snapshots go out at
// most every MIN_INTERVAL_MS. A pending timer is never pushed back, so latency is bounded.
export const PUBLISH_LEAD_MS = 40;
export const PUBLISH_MIN_INTERVAL_MS = 120;

/** Milliseconds to wait before publishing, given when the previous publish started (undefined = never). */
export function publishDelayMs(now: number, lastPublishStartedAt: number | undefined): number {
  if (lastPublishStartedAt === undefined) return PUBLISH_LEAD_MS;
  return Math.max(PUBLISH_LEAD_MS, lastPublishStartedAt + PUBLISH_MIN_INTERVAL_MS - now);
}
