import { describe, expect, it } from "vitest";
import { parseTapCreaturesAltCost } from "./altCosts";

describe("parseTapCreaturesAltCost", () => {
  it("reads Sephara's alternative cost", () => {
    const text = "You may pay {W} and tap four untapped creatures you control with flying rather than pay this spell's mana cost.\nFlying, lifelink";
    expect(parseTapCreaturesAltCost(text)).toEqual({ costManaText: "{W}", count: 4, withKeyword: "flying" });
  });
  it("declines other text", () => {
    expect(parseTapCreaturesAltCost("Flying")).toBeUndefined();
  });
});
