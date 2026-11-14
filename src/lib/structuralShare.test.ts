import { describe, expect, it } from "vitest";
import { shareSessionSeats, shareStructure } from "./structuralShare";

describe("shareStructure", () => {
  it("returns the previous reference when contents are equal", () => {
    const prev = { seats: [{ id: "a", board: { battlefield: [{ id: "c1", counters: [{ kind: "+1/+1", count: 1 }] }] } }] };
    const next = { seats: [{ id: "a", board: { battlefield: [{ id: "c1", counters: [{ kind: "+1/+1", count: 1 }] }] } }] };
    expect(shareStructure(prev, next)).toBe(prev);
  });

  it("keeps unchanged siblings and replaces only what changed", () => {
    const keep = { id: "c1", power: "2" };
    const prev = { list: [keep, { id: "c2", power: "3" }] };
    const next = { list: [{ id: "c1", power: "2" }, { id: "c2", power: "4" }] };
    const result = shareStructure(prev, next);
    expect(result).toEqual(next);
    expect(result.list[0]).toBe(keep);
    expect(result.list[1]).not.toBe(prev.list[1]);
  });

  it("matches id-keyed arrays across reordering without losing content", () => {
    const a = { id: "a", n: 1 };
    const b = { id: "b", n: 2 };
    const result = shareStructure([a, b], [{ id: "b", n: 2 }, { id: "a", n: 1 }]);
    expect(result).toEqual([b, a]);
    expect(result[0]).toBe(b);
    expect(result[1]).toBe(a);
  });

  it("is always deeply equal to next, including added and removed keys and undefined values", () => {
    const prev = { x: 1, gone: 2 } as Record<string, unknown>;
    const next = { x: 1, added: undefined } as Record<string, unknown>;
    const result = shareStructure(prev, next);
    expect(result).toEqual(next);
    expect(Object.keys(result)).toEqual(["x", "added"]);
  });

  it("does not treat non-plain objects as equal", () => {
    const prev = { when: new Date(1) };
    const next = { when: new Date(1) };
    expect(shareStructure(prev, next).when).toBe(next.when);
  });
});

describe("shareSessionSeats", () => {
  it("returns the previous session when only seats were rebuilt with equal content", () => {
    const events = [{ id: "e" }];
    const prev = { turn: 1, events, seats: [{ id: "s", life: 40 }] };
    const next = { turn: 1, events, seats: [{ id: "s", life: 40 }] };
    expect(shareSessionSeats(prev, next)).toBe(prev);
  });

  it("keeps new top-level fields but reuses unchanged seats", () => {
    const seats = [{ id: "s", life: 40 }];
    const prev = { turn: 1, events: [] as unknown[], seats };
    const next = { turn: 2, events: [] as unknown[], seats: [{ id: "s", life: 40 }] };
    const result = shareSessionSeats(prev, next);
    expect(result.turn).toBe(2);
    expect(result.seats).toBe(seats);
  });
});
