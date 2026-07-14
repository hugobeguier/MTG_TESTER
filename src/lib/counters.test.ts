import { describe, expect, it } from "vitest";
import { counterCount, effectivePower, effectiveToughness, plusMinusCounterBonus } from "./counters";
import type { VisibleCard } from "./types";

function card(overrides: Partial<VisibleCard> = {}): VisibleCard {
  return {
    id: "card-1",
    name: "Test Creature",
    typeLine: "Creature",
    oracleText: "",
    manaValue: 1,
    colors: [],
    role: "creature",
    zone: "battlefield",
    power: "2",
    toughness: "2",
    ...overrides
  };
}

describe("counters", () => {
  it("counterCount returns 0 when no counters of that kind exist", () => {
    expect(counterCount(card(), "+1/+1")).toBe(0);
  });

  it("plusMinusCounterBonus nets +1/+1 against -1/-1 counters", () => {
    const withCounters = card({
      counters: [
        { kind: "+1/+1", count: 3 },
        { kind: "-1/-1", count: 1 }
      ]
    });
    expect(plusMinusCounterBonus(withCounters)).toBe(2);
  });

  it("effectivePower/effectiveToughness add the counter bonus to printed values (Hangarback Walker with X=2)", () => {
    const hangarback = card({ power: "0", toughness: "0", counters: [{ kind: "+1/+1", count: 2 }] });
    expect(effectivePower(hangarback)).toBe(2);
    expect(effectiveToughness(hangarback)).toBe(2);
  });

  it("effectiveToughness can go to 0 or below when -1/-1 counters outweigh the base", () => {
    const shrunk = card({ power: "2", toughness: "2", counters: [{ kind: "-1/-1", count: 3 }] });
    expect(effectiveToughness(shrunk)).toBe(-1);
  });

  it("treats a missing power/toughness as 0 before adding the counter bonus", () => {
    const noPrintedPT = card({ power: undefined, toughness: undefined, counters: [{ kind: "+1/+1", count: 1 }] });
    expect(effectivePower(noPrintedPT)).toBe(1);
    expect(effectiveToughness(noPrintedPT)).toBe(1);
  });
});
