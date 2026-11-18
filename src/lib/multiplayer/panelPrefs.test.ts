import { describe, expect, it } from "vitest";
import { PANEL_COLLAPSED_KEY, collapsedAfterModeChange, panelNeedsAttention, readCollapsed, writeCollapsed } from "./panelPrefs";

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};
const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };

describe("multiplayer panel preferences", () => {
  it("remembers the flag and survives unavailable storage", () => {
    const storage = memory();
    expect(readCollapsed(storage)).toBeUndefined();
    writeCollapsed(true, storage);
    expect(storage.getItem(PANEL_COLLAPSED_KEY)).toBe("1");
    expect(readCollapsed(storage)).toBe(true);
    writeCollapsed(false, storage);
    expect(readCollapsed(storage)).toBe(false);
    expect(() => writeCollapsed(true, throwing)).not.toThrow();
    expect(readCollapsed(throwing)).toBeUndefined();
    expect(readCollapsed(undefined)).toBeUndefined();
  });
  it("collapses when a game starts and reopens on the setup screen", () => {
    expect(collapsedAfterModeChange("setup", "game", false)).toBe(true);
    expect(collapsedAfterModeChange("game", "setup", true)).toBe(false);
    expect(collapsedAfterModeChange("game", "game", false)).toBe(false); // the user reopened it mid-game: leave it
    expect(collapsedAfterModeChange(undefined, "setup", true)).toBe(true);
  });
  it("the chip warns about a disconnected guest, a paused game, or a connection problem", () => {
    const ok = { status: "live" as const, guests: [{ seatId: "guest-1", displayName: "A", connected: true }] };
    expect(panelNeedsAttention(ok, [])).toBe(false);
    expect(panelNeedsAttention({ ...ok, guests: [{ seatId: "guest-1", displayName: "A", connected: false }] }, [])).toBe(true);
    expect(panelNeedsAttention(ok, ["Friend"])).toBe(true);
    expect(panelNeedsAttention({ ...ok, status: "reconnecting" }, [])).toBe(true);
    expect(panelNeedsAttention({ ...ok, status: "error", error: "x" }, [])).toBe(true);
  });
});
