import { describe, expect, it } from "vitest";
import { parseCycling } from "./cycling";

describe("parseCycling", () => {
  it("reads the cost off a keyword line, ignoring reminder text", () => {
    expect(parseCycling("Cycling {B} ({B}, Discard this card: Draw a card.)")).toEqual({ costManaText: "{B}" });
    expect(parseCycling("Cycling {2}")).toEqual({ costManaText: "{2}" });
  });
  it("ignores cards without cycling, and landcycling", () => {
    expect(parseCycling("Flying")).toBeUndefined();
    expect(parseCycling("Plainscycling {2}")).toBeUndefined();
  });
});
