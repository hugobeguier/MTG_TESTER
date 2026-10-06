import { describe, expect, it } from "vitest";
import { parseGraveyardReturnAbility, reduceGenericCost } from "./graveyardAbilities";

describe("parseGraveyardReturnAbility", () => {
  it("reads Razorlash Transmogrant's return ability and its discount", () => {
    const text =
      "This creature can't block.\n{4}{B}{B}: Return this card from your graveyard to the battlefield with a +1/+1 counter on it. This ability costs {4} less to activate if an opponent controls four or more nonbasic lands.";
    expect(parseGraveyardReturnAbility(text)).toEqual({ costManaText: "{4}{B}{B}", withCounter: true, discount: { amount: 4, nonbasicLands: 4 } });
  });
  it("declines other text", () => {
    expect(parseGraveyardReturnAbility("Flying")).toBeUndefined();
  });
  it("reduces only the generic part", () => {
    expect(reduceGenericCost("{4}{B}{B}", 4)).toBe("{B}{B}");
    expect(reduceGenericCost("{4}{B}{B}", 2)).toBe("{2}{B}{B}");
  });
});
