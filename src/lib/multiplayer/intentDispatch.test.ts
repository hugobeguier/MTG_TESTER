import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { IntentQueue, dispatchIntent, type IntentEvent, type IntentRegistry } from "./intentDispatch";
import { createIntentHandlers } from "./intentProxy";
import { buildMpIntentRegistry } from "@/components/game/mpIntents";

const seatOfSlot = (slot: string) => ({ "guest-1": "seat-b", "guest-2": "seat-c" })[slot as "guest-1"];
const ev = (over: Partial<IntentEvent> = {}): IntentEvent => ({ fromSeatId: "guest-1", name: "onKeepHand", args: [], clientSeq: 1, ...over });

function setup(over: { inMulligan?: boolean; kept?: Record<string, boolean> } = {}) {
  const calls: Array<unknown[]> = [];
  const handlers = {
    keepOpeningHand: (seatId?: string) => calls.push(["keep", seatId]),
    mulliganOpeningHand: (seatId?: string) => calls.push(["mulligan", seatId]),
    toggleMulliganReturnCard: (card: { id: string }, seatId?: string) => calls.push(["toggle", card.id, seatId])
  };
  const registry = buildMpIntentRegistry({ handlers: handlers as never, inMulligan: () => over.inMulligan ?? true, hasKept: (id) => Boolean(over.kept?.[id]) });
  return { calls, registry };
}

describe("dispatchIntent", () => {
  it("runs a whitelisted intent as the SENDER's seat", () => {
    const { calls, registry } = setup();
    expect(dispatchIntent(registry, ev(), seatOfSlot)).toEqual({ ok: true });
    expect(dispatchIntent(registry, ev({ fromSeatId: "guest-2", name: "onMulligan" }), seatOfSlot)).toEqual({ ok: true });
    expect(calls).toEqual([["keep", "seat-b"], ["mulligan", "seat-c"]]);
  });

  it("never takes a seat from the args: extra/foreign seat arguments are rejected and the handler is not called", () => {
    const { calls, registry } = setup();
    expect(dispatchIntent(registry, ev({ args: ["seat-a"] }), seatOfSlot).ok).toBe(false);
    expect(dispatchIntent(registry, ev({ name: "onToggleMulliganReturnCard", args: ["card-1", "seat-a"] }), seatOfSlot).ok).toBe(false);
    expect(dispatchIntent(registry, ev({ name: "onToggleMulliganReturnCard", args: [{ id: "x", seatId: "seat-a" }] }), seatOfSlot).ok).toBe(false);
    expect(calls).toEqual([]);
    dispatchIntent(registry, ev({ name: "onToggleMulliganReturnCard", args: ["card-1"] }), seatOfSlot);
    expect(calls).toEqual([["toggle", "card-1", "seat-b"]]);
  });

  it("rejects names outside the whitelist (including prototype keys and host-only handlers)", () => {
    const { calls, registry } = setup();
    for (const name of ["startGame", "playCard", "toString", "__proto__", "constructor", "lobby_take_seat", ""]) expect(dispatchIntent(registry, ev({ name }), seatOfSlot).ok, name).toBe(false);
    expect(calls).toEqual([]);
  });

  it("rejects a slot that holds no seat (spectator)", () => {
    const { calls, registry } = setup();
    expect(dispatchIntent(registry, ev({ fromSeatId: "guest-9" }), seatOfSlot)).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it("applies the game-state check (wrong stage / already kept)", () => {
    const stage = setup({ inMulligan: false });
    expect(dispatchIntent(stage.registry, ev(), seatOfSlot).ok).toBe(false);
    const kept = setup({ kept: { "seat-b": true } });
    expect(dispatchIntent(kept.registry, ev(), seatOfSlot).ok).toBe(false);
    expect(dispatchIntent(kept.registry, ev({ fromSeatId: "guest-2" }), seatOfSlot).ok).toBe(true);
    expect(stage.calls.concat(kept.calls)).toEqual([["keep", "seat-c"]]);
  });

  it("a registry entry's schema failure never reaches call()", () => {
    const call = vi.fn();
    const registry: IntentRegistry = { x: { schema: z.tuple([z.number()]), call } };
    expect(dispatchIntent(registry, ev({ name: "x", args: ["no"] }), seatOfSlot).ok).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });
});

describe("IntentQueue", () => {
  it("keeps arrival order and hands out one at a time", () => {
    const q = new IntentQueue();
    q.push(ev({ clientSeq: 1, name: "a" }));
    q.push(ev({ clientSeq: 2, name: "b" }));
    q.push(ev({ fromSeatId: "guest-2", clientSeq: 1, name: "c" }));
    expect([q.shift()?.name, q.shift()?.name, q.shift()?.name, q.shift()]).toEqual(["a", "b", "c", undefined]);
  });
  it("drops duplicate and out-of-date clientSeq per slot, but slots count independently", () => {
    const q = new IntentQueue();
    expect(q.push(ev({ clientSeq: 5 }))).toBe(true);
    expect(q.push(ev({ clientSeq: 5 }))).toBe(false);
    expect(q.push(ev({ clientSeq: 4 }))).toBe(false);
    expect(q.push(ev({ clientSeq: 6 }))).toBe(true);
    expect(q.push(ev({ fromSeatId: "guest-2", clientSeq: 1 }))).toBe(true);
    expect(q.length).toBe(3);
  });
  it("rejects a non-finite clientSeq and can forget a slot", () => {
    const q = new IntentQueue();
    expect(q.push(ev({ clientSeq: Number.NaN }))).toBe(false);
    q.push(ev({ clientSeq: 9 }));
    q.forget("guest-1");
    expect(q.length).toBe(0);
    expect(q.push(ev({ clientSeq: 1 }))).toBe(true);
  });
});

describe("guest side encoding", () => {
  it("sends only the card id for the mulligan toggle and plain args otherwise", () => {
    const sent: Array<[string, unknown[]]> = [];
    const h = createIntentHandlers((name, args) => void sent.push([name, args]));
    h.onToggleMulliganReturnCard({ id: "c1", name: "Big", oracleText: "..." });
    h.onKeepHand();
    expect(sent).toEqual([["onToggleMulliganReturnCard", ["c1"]], ["onKeepHand", []]]);
    expect(Object.keys(h).sort()).toEqual(["onKeepHand", "onMulligan", "onToggleMulliganReturnCard"]);
  });
});
