import { describe, expect, it } from "vitest";
import { annihilatorAmount, hasKeyword, protectionColors, wardAmount } from "./keywords";

describe("hasKeyword", () => {
  it("detects keywords present in oracle text", () => {
    expect(hasKeyword("Flying, lifelink", "flying")).toBe(true);
    expect(hasKeyword("Flying, lifelink", "lifelink")).toBe(true);
    expect(hasKeyword("Defender\n{T}: Add {C}.", "defender")).toBe(true);
  });

  it("does not false-positive on unrelated text", () => {
    expect(hasKeyword("This creature can't block.", "defender")).toBe(false);
    expect(hasKeyword("Whenever this creature deals combat damage, draw a card.", "wither")).toBe(false);
  });
});

describe("wardAmount", () => {
  it("extracts a numeric mana ward cost", () => {
    expect(wardAmount("Ward {2}")).toBe(2);
    expect(wardAmount("Flying\nWard {1}")).toBe(1);
  });

  it("returns undefined for an alternate-cost ward it can't parse numerically", () => {
    expect(wardAmount("Ward—Pay 2 life.")).toBeUndefined();
  });
});

describe("annihilatorAmount", () => {
  it("extracts the annihilator amount", () => {
    expect(annihilatorAmount("Annihilator 2 (Whenever this creature attacks, defending player sacrifices two permanents.)")).toBe(2);
  });

  it("returns undefined when annihilator isn't present", () => {
    expect(annihilatorAmount("Flying, trample")).toBeUndefined();
  });
});

describe("protectionColors", () => {
  it("parses a single protection color", () => {
    expect(protectionColors("Protection from red")).toEqual(["red"]);
  });

  it("parses multiple protection colors from separate clauses", () => {
    expect(protectionColors("Protection from white and from black")).toEqual(["white", "black"]);
  });

  it("returns an empty list for unsupported protection forms", () => {
    expect(protectionColors("Protection from everything")).toEqual([]);
    expect(protectionColors("Protection from Dragons")).toEqual([]);
  });
});
