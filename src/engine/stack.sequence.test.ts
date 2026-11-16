// End-to-end sequences driven purely by src/engine/stack.ts (no React): the same transitions AppFlow performs, over 4 seats.
import { describe, expect, it } from "vitest";
import type { PlayerSeat } from "@/lib/types";
import type { PendingAction } from "@/engine/types";
import { initialStackState, openWindow, passPriority, pushToStack, resolveTop, type PriorityCtx, type StackState } from "@/engine/stack";

const seats = ["a", "b", "c", "d"].map((id) => ({ id, name: id, kind: "agent", hasLost: false }) as unknown as PlayerSeat);

function ctx(canReceive: (seatId: string) => boolean = () => true): PriorityCtx {
  return { seats, canReceivePriority: (seat) => canReceive(seat.id) };
}

function spell(id: string, actorSeatId = "a"): PendingAction {
  return { id, type: "spell", actorSeatId, cardId: `card-${id}`, cardName: id, manaSourceIds: [], message: `${id} cast.` } as PendingAction;
}

// Everyone passes in turn until the window closes; returns the action to resolve and the state at that point.
function passAll(state: StackState, c: PriorityCtx): { state: StackState; resolve: PendingAction } {
  let s = state;
  for (let i = 0; i < 20; i++) {
    const r = passPriority(s, c);
    s = r.state;
    if (r.resolve) return { state: s, resolve: r.resolve };
  }
  throw new Error("window never closed");
}

describe("stack sequences", () => {
  it("cast, opponent responds, everyone passes, both resolve newest-first, stack ends empty", () => {
    const c = ctx();
    const open1 = openWindow(initialStackState("a"), spell("s1", "a"), c);
    expect(open1.autoResolve).toBe(false);
    expect(open1.requiredPasses).toEqual(expect.arrayContaining(["a", "b", "c", "d"]));
    expect(open1.state.prioritySeatId).toBe("a");

    // b responds: its spell goes on top and a fresh window opens with b getting priority first, passes reset.
    let s = passPriority(open1.state, c).state;
    expect(s.prioritySeatId).toBe("b");
    const open2 = openWindow(s, spell("s2", "b"), c);
    s = open2.state;
    expect(s.stack.map((x) => x.id)).toEqual(["s1", "s2"]);
    expect(s.pending?.id).toBe("s2");
    expect(s.passes).toEqual([]);
    expect(s.prioritySeatId).toBe("b");

    const closed2 = passAll(s, c);
    expect(closed2.resolve.id).toBe("s2");
    const res2 = resolveTop(closed2.state, "s2");
    expect(res2.remaining.map((x) => x.id)).toEqual(["s1"]);
    expect(res2.state.pending).toBeUndefined();
    expect(res2.state.passes).toEqual([]);

    // The remaining item gets a new window (resume), actor first.
    const reopen = openWindow(res2.state, res2.remaining[res2.remaining.length - 1], c);
    expect(reopen.autoResolve).toBe(false);
    expect(reopen.state.stack.map((x) => x.id)).toEqual(["s1"]);
    expect(reopen.state.prioritySeatId).toBe("a");

    const closed1 = passAll(reopen.state, c);
    expect(closed1.resolve.id).toBe("s1");
    const res1 = resolveTop(closed1.state, "s1");
    expect(res1.remaining).toEqual([]);
    expect(res1.state.stack).toEqual([]);
    expect(res1.state.pending).toBeUndefined();
    expect(res1.state.passes).toEqual([]);
  });

  it("a trigger put on the stack while a spell resolves resolves next, then the stack is empty", () => {
    const c = ctx();
    const s1 = openWindow(initialStackState("a"), spell("s1"), c).state;
    const closed = passAll(s1, c);
    const resolved = resolveTop(closed.state, "s1");
    // The spell's resolution triggers something: it is pushed and gets its own window.
    const trigger = { ...spell("t1", "c"), type: "trigger" } as unknown as PendingAction;
    const pushed = pushToStack(resolved.state, trigger);
    expect(pushed.stack.map((x) => x.id)).toEqual(["t1"]);
    const open = openWindow(pushed, trigger, c);
    expect(open.state.stack).toHaveLength(1);
    expect(open.state.prioritySeatId).toBe("c");
    const closedT = passAll(open.state, c);
    expect(closedT.resolve.id).toBe("t1");
    const end = resolveTop(closedT.state, "t1");
    expect(end.state.stack).toEqual([]);
    expect(end.state.passes).toEqual([]);
  });

  it("with nobody required to pass the action auto-resolves without opening a window", () => {
    const c = ctx(() => false);
    const open = openWindow(initialStackState("a"), spell("s1"), c);
    expect(open.autoResolve).toBe(true);
    expect(open.requiredPasses).toEqual([]);
    expect(open.state.pending).toBeUndefined();
    expect(open.state.stack.map((x) => x.id)).toEqual(["s1"]);
    const res = resolveTop(open.state, "s1");
    expect(res.state.stack).toEqual([]);
    expect(res.state.passes).toEqual([]);
  });
});
