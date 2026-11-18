import { describe, expect, it } from "vitest";
import type { GameSession } from "../types";
import { applyDragOverlay, pruneDragOverlay, recordDrag } from "./dragOverlay";

const session = (pos: { x: number; z: number }) =>
  ({ seats: [{ id: "me", board: { hand: [], battlefield: [{ id: "c1", battlefieldPosition: pos }, { id: "c2", battlefieldPosition: { x: 5, z: 5 } }] } }, { id: "other", board: { hand: [], battlefield: [{ id: "c1", battlefieldPosition: { x: 9, z: 9 } }] } }] }) as unknown as GameSession;
const posOf = (s: GameSession, seat: string, card: string) => (s.seats.find((x) => x.id === seat)?.board.battlefield.find((c) => c.id === card) as { battlefieldPosition?: unknown }).battlefieldPosition;

describe("drag overlay", () => {
  it("shows the dragged position on my battlefield only, and is a no-op when empty", () => {
    const base = session({ x: 0, z: 0 });
    expect(applyDragOverlay(base, "me", {})).toBe(base);
    const shown = applyDragOverlay(base, "me", recordDrag({}, "c1", { x: 3, z: 4 }, false, 0));
    expect(posOf(shown, "me", "c1")).toEqual({ x: 3, z: 4 });
    expect(posOf(shown, "me", "c2")).toEqual({ x: 5, z: 5 });
    expect(posOf(shown, "other", "c1")).toEqual({ x: 9, z: 9 });
  });
  it("keeps a card being dragged, whatever the snapshots say", () => {
    const overlay = recordDrag({}, "c1", { x: 3, z: 4 }, false, 0);
    expect(pruneDragOverlay(overlay, session({ x: 0, z: 0 }), "me", 99, 100_000)).toBe(overlay);
  });
  it("releases a dropped card once the snapshot shows it there, the host answered the drop, or it timed out", () => {
    const dropped = recordDrag({}, "c1", { x: 3, z: 4 }, true, 1000, 50);
    expect(pruneDragOverlay(dropped, session({ x: 0, z: 0 }), "me", 49, 1500)).toBe(dropped); // still waiting
    expect(pruneDragOverlay(dropped, session({ x: 3, z: 4 }), "me", undefined, 1500)).toEqual({}); // confirmed
    expect(pruneDragOverlay(dropped, session({ x: 0, z: 0 }), "me", 50, 1500)).toEqual({}); // answered (a refusal snaps back)
    expect(pruneDragOverlay(dropped, session({ x: 0, z: 0 }), "me", 49, 6000)).toEqual({}); // lost
  });
  it("forgets a card that left the battlefield", () => {
    expect(pruneDragOverlay(recordDrag({}, "gone", { x: 1, z: 1 }, false, 0), session({ x: 0, z: 0 }), "me", undefined, 0)).toEqual({});
  });
});
