import { describe, expect, it } from "vitest";
import type { PlayerSeat } from "@/lib/types";
import type { PendingAction } from "@/engine/types";
import { nextPrioritySeatId } from "@/engine/priority";
import {
  clearStack,
  initialStackState,
  openWindow,
  passPriority,
  pushToStack,
  removeFromStack,
  resolveTop,
  restoreStack,
  returnPriorityToActor,
  setActivePlayer,
  snapshotStack,
  updateOnStack,
  type PriorityCtx,
  type StackState
} from "@/engine/stack";

const seats = ["a", "b", "c", "d"].map((id) => ({ id, name: id, kind: "agent", hasLost: false }) as unknown as PlayerSeat);

function ctx(required: string[]): PriorityCtx {
  return { seats, canReceivePriority: (seat) => required.includes(seat.id) };
}

function spell(id: string, actorSeatId = "a"): PendingAction {
  return { id, type: "spell", actorSeatId, cardId: `card-${id}`, cardName: id, manaSourceIds: [], message: `${id} cast.` } as PendingAction;
}

function phase(id: string): PendingAction {
  return { id, type: "phase", actorSeatId: "a", message: "phase" };
}

function frozen(state: StackState): StackState {
  return JSON.parse(JSON.stringify(state));
}

describe("stack state", () => {
  it("pushes spells, dedupes by id, ignores phase actions", () => {
    const s0 = initialStackState("a");
    const s1 = pushToStack(s0, spell("s1"));
    expect(s1.stack.map((x) => x.id)).toEqual(["s1"]);
    expect(pushToStack(s1, spell("s1")).stack).toHaveLength(1);
    expect(pushToStack(s1, phase("p1")).stack).toHaveLength(1);
    expect(s0.stack).toEqual([]);
  });

  it("updates in place and removes returning the remainder", () => {
    const s = pushToStack(pushToStack(initialStackState("a"), spell("s1")), spell("s2"));
    const updated = updateOnStack(s, { ...spell("s1"), cardName: "renamed" } as PendingAction);
    expect((updated.stack[0] as { cardName: string }).cardName).toBe("renamed");
    const before = frozen(s);
    const { state, remaining } = removeFromStack(s, "s2");
    expect(remaining.map((x) => x.id)).toEqual(["s1"]);
    expect(state.stack).toEqual(remaining);
    expect(frozen(s)).toEqual(before);
  });

  it("auto-resolves when nobody is required to pass (spell still goes on the stack)", () => {
    const s0 = initialStackState("a");
    const r = openWindow(s0, spell("s1"), ctx([]));
    expect(r.autoResolve).toBe(true);
    expect(r.requiredPasses).toEqual([]);
    expect(r.state.pending).toBeUndefined();
    expect(r.state.stack.map((x) => x.id)).toEqual(["s1"]);
    expect(s0.stack).toEqual([]);
  });

  it("opens a window with the actor first, top item in both pending and stack", () => {
    const action = spell("s1", "b");
    const r = openWindow(initialStackState("a"), action, ctx(["a", "b", "c"]));
    expect(r.autoResolve).toBe(false);
    expect(r.requiredPasses).toEqual(["a", "b", "c"]);
    expect(r.state.pending).toBe(action);
    expect(r.state.stack).toEqual([action]);
    expect(r.state.prioritySeatId).toBe("b");
    expect(r.state.passes).toEqual([]);
  });

  it("phase windows are not put on the stack; resuming an item already on the stack does not duplicate it", () => {
    const p = openWindow(initialStackState("a"), phase("p1"), ctx(["c"]));
    expect(p.state.stack).toEqual([]);
    expect(p.state.pending?.id).toBe("p1");
    expect(p.state.prioritySeatId).toBe("c");
    const withSpell = pushToStack(initialStackState("a"), spell("s1"));
    expect(openWindow(withSpell, spell("s1"), ctx(["a"])).state.stack).toHaveLength(1);
  });

  it("resolves only when every required seat has passed, advancing in turn order", () => {
    const c = ctx(["a", "c", "d"]);
    const s = openWindow(initialStackState("a"), spell("s1", "a"), c).state;
    expect(s.prioritySeatId).toBe("a");
    let r = passPriority(s, c);
    expect(r.resolve).toBeUndefined();
    expect(r.state.passes).toEqual(["a"]);
    expect(r.state.prioritySeatId).toBe("c");
    r = passPriority(r.state, c);
    expect(r.resolve).toBeUndefined();
    expect(r.state.prioritySeatId).toBe("d");
    r = passPriority(r.state, c);
    expect(r.resolve?.id).toBe("s1");
  });

  it("does not mutate the input when passing", () => {
    const c = ctx(["a", "b"]);
    const s = openWindow(initialStackState("a"), spell("s1"), c).state;
    const before = frozen(s);
    passPriority(s, c);
    expect(frozen(s)).toEqual(before);
  });

  it("with no window open, passing just moves priority to the next seat", () => {
    expect(passPriority(initialStackState("d"), ctx([])).state.prioritySeatId).toBe("a");
  });

  it("a response goes on top and takes the window", () => {
    const c = ctx(["a", "b"]);
    const s1 = openWindow(initialStackState("a"), spell("s1", "a"), c).state;
    const response = spell("s2", "b");
    const s2 = openWindow(s1, response, c).state;
    expect(s2.stack.map((x) => x.id)).toEqual(["s1", "s2"]);
    expect(s2.pending).toBe(response);
    expect(s2.prioritySeatId).toBe("b");
    expect(s2.passes).toEqual([]);
  });

  it("resolveTop clears pending and passes and returns the remaining stack", () => {
    const c = ctx(["a", "b"]);
    let s = openWindow(initialStackState("a"), spell("s1"), c).state;
    s = openWindow(s, spell("s2", "b"), c).state;
    s = passPriority(s, c).state;
    const before = frozen(s);
    const { state, remaining } = resolveTop(s, "s2");
    expect(state.pending).toBeUndefined();
    expect(state.passes).toEqual([]);
    expect(remaining.map((x) => x.id)).toEqual(["s1"]);
    expect(state.stack).toEqual(remaining);
    expect(frozen(s)).toEqual(before);
    const phaseState = openWindow(initialStackState("a"), phase("p1"), ctx(["a"])).state;
    expect(resolveTop(phaseState, "p1").state.pending).toBeUndefined();
  });

  it("pins 4-seat priority ordering after the actor", () => {
    const required = ["a", "b", "c", "d"];
    const act = spell("s1", "c");
    const order: string[] = [];
    let passes: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const next = nextPrioritySeatId(seats, "c", passes, act, (seat) => required.includes(seat.id));
      order.push(next);
      passes = [...passes, next];
    }
    expect(order).toEqual(["c", "d", "a", "b"]);
  });

  it("returns priority to the actor and sets the active player", () => {
    const s = initialStackState("a");
    expect(returnPriorityToActor(s, "c").prioritySeatId).toBe("c");
    const t = setActivePlayer(s, "b");
    expect(t.activeSeatId).toBe("b");
    expect(t.prioritySeatId).toBe("b");
    expect(s.activeSeatId).toBe("a");
  });

  it("snapshot round-trips the flat save fields and clearStack empties the window", () => {
    const c = ctx(["a", "b"]);
    let s = openWindow(initialStackState("a"), spell("s1"), c).state;
    s = passPriority(s, c).state;
    const snap = snapshotStack(s);
    expect(snap).toEqual({ activeSeatId: "a", prioritySeatId: "b", priorityPasses: ["a"] });
    const restored = restoreStack(snap);
    expect(restored.activeSeatId).toBe("a");
    expect(restored.prioritySeatId).toBe("b");
    expect(restored.passes).toEqual(["a"]);
    expect(restored.stack).toEqual([]);
    const cleared = clearStack(s);
    expect(cleared.stack).toEqual([]);
    expect(cleared.pending).toBeUndefined();
    expect(cleared.passes).toEqual([]);
    expect(cleared.activeSeatId).toBe("a");
  });
});
