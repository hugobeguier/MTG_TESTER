import { describe, expect, it } from "vitest";
import type { PlayerSeat } from "@/lib/types";
import type { PendingAction } from "@/engine/types";
import { initialStackState, openWindow, passPriority, pushToStack, resolveTop, resumeWindow, type PriorityCtx, type StackState } from "@/engine/stack";

// Rules 117.3 / 117.4 / 117.5 / 101.4: seat order a (active), b, c, d.
const seats = ["a", "b", "c", "d"].map((id) => ({ id, name: id, kind: id === "a" ? "human" : "agent", hasLost: false }) as unknown as PlayerSeat);

function ctxFor(can: string[], list: PlayerSeat[] = seats): PriorityCtx {
  return { seats: list, canReceivePriority: (seat) => can.includes(seat.id) && !seat.hasLost };
}
const everyone = ctxFor(["a", "b", "c", "d"]);

function spell(id: string, actorSeatId: string): PendingAction {
  return { id, type: "spell", actorSeatId, cardId: `card-${id}`, cardName: id, manaSourceIds: [], message: id } as PendingAction;
}
function trigger(id: string, controllerSeatId: string): PendingAction {
  return { id, type: "trigger", actorSeatId: controllerSeatId, controllerSeatId, sourceCardId: "x", sourceCardName: "x", message: id, effect: { kind: "draw" } } as unknown as PendingAction;
}

// Passes priority around until the window resolves; returns the order of holders.
function runAround(state: StackState, ctx: PriorityCtx) {
  const order: string[] = [state.prioritySeatId as string];
  let s = state;
  for (let i = 0; i < 20; i += 1) {
    const r = passPriority(s, ctx);
    if (r.resolve) return { order, state: r.state, resolved: r.resolve };
    s = r.state;
    order.push(s.prioritySeatId as string);
  }
  throw new Error("never resolved");
}

describe("priority order", () => {
  it("(a) active player casts: the caster first, then turn order", () => {
    const s0 = initialStackState("a");
    const { state } = openWindow(s0, spell("s1", "a"), everyone);
    expect(state.prioritySeatId).toBe("a");
    expect(runAround(state, everyone).order).toEqual(["a", "b", "c", "d"]);
  });

  it("(b) non-active player responds: they hold priority first, then turn order from THEM; afterwards the active player", () => {
    const s0 = initialStackState("a");
    const first = openWindow(s0, spell("s1", "a"), everyone).state;
    // b passes? no: c responds while holding priority.
    const second = openWindow({ ...first, passes: ["a", "b"], prioritySeatId: "c" }, spell("r1", "c"), everyone);
    expect(second.state.prioritySeatId).toBe("c");
    expect(second.state.passes).toEqual([]);
    const around = runAround(second.state, everyone);
    expect(around.order).toEqual(["c", "d", "a", "b"]);
    // (c) After r1 resolves the active player gets priority on s1, not c (r1's controller) and not b.
    const { state: afterResolve, remaining } = resolveTop(around.state, "r1");
    expect(remaining.map((x) => x.id)).toEqual(["s1"]);
    const resumed = resumeWindow(afterResolve, remaining[0], everyone);
    expect(resumed.state.prioritySeatId).toBe("a");
    expect(resumed.state.passes).toEqual([]); // (e) everybody gets a fresh chance
    expect(runAround(resumed.state, everyone).order).toEqual(["a", "b", "c", "d"]);
  });

  it("(c) the reopened window starts with the active player even when the item below was cast by another non-active player", () => {
    // stack: s1 (c) <- r1 (d); r1 resolves; s1 reopens: active a first, not c (its caster).
    let state = initialStackState("a");
    state = openWindow(state, spell("s1", "c"), everyone).state;
    state = openWindow(state, spell("r1", "d"), everyone).state;
    const { state: resolved, remaining } = resolveTop(state, "r1");
    const resumed = resumeWindow(resolved, remaining[0], everyone);
    expect(resumed.state.prioritySeatId).toBe("a");
    expect(runAround(resumed.state, everyone).order).toEqual(["a", "b", "c", "d"]);
  });

  it("(d) a trigger controlled by a non-active player gives the ACTIVE player priority first", () => {
    const s0 = initialStackState("a");
    const { state } = openWindow(s0, trigger("t1", "c"), everyone);
    expect(state.prioritySeatId).toBe("a");
    expect(runAround(state, everyone).order).toEqual(["a", "b", "c", "d"]);
  });

  it("(e) passes reset on a response, so earlier passers get another chance", () => {
    const first = openWindow(initialStackState("a"), spell("s1", "a"), everyone).state;
    const afterTwo = passPriority(passPriority(first, everyone).state, everyone).state; // a, b passed; c holds priority
    expect(afterTwo.passes).toEqual(["a", "b"]);
    const response = openWindow(afterTwo, spell("r1", "c"), everyone);
    expect(response.state.passes).toEqual([]);
    expect(runAround(response.state, everyone).order).toEqual(["c", "d", "a", "b"]);
  });

  it("(f) seats that cannot respond / eliminated seats are skipped but the order stays turn order", () => {
    const withLost = seats.map((s) => (s.id === "b" ? ({ ...s, hasLost: true } as PlayerSeat) : s));
    const ctx = ctxFor(["a", "b", "c", "d"], withLost);
    const { state } = openWindow(initialStackState("a"), spell("s1", "a"), ctx);
    expect(runAround(state, ctx).order).toEqual(["a", "c", "d"]);
    // Only a and d can respond (b, c auto-skipped, e.g. a remote seat with no legal response).
    const sparse = ctxFor(["a", "d"]);
    const open = openWindow(initialStackState("a"), spell("s1", "c"), sparse);
    expect(open.state.prioritySeatId).toBe("d"); // caster c cannot respond: next in turn order from c
    expect(runAround(open.state, sparse).order).toEqual(["d", "a"]);
    // A reopened window where the active player has no response: turn order from the active player.
    const noActive = ctxFor(["b", "d"]);
    const resumed = resumeWindow(initialStackState("a"), spell("s1", "c"), noActive);
    expect(resumed.state.prioritySeatId).toBe("b");
    expect(runAround(resumed.state, noActive).order).toEqual(["b", "d"]);
  });

  it("a caster that is the only seat able to respond holds priority and then it resolves", () => {
    const only = ctxFor(["c"]);
    const open = openWindow(pushToStack(initialStackState("a"), spell("s0", "a")), spell("s1", "c"), only);
    expect(open.state.prioritySeatId).toBe("c");
    expect(passPriority(open.state, only).resolve?.id).toBe("s1");
  });
});
