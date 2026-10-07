import { describe, expect, it } from "vitest";
import { parseCycling } from "./cycling";

describe("parseCycling", () => {
  it("reads the cost off a keyword line, ignoring reminder text", () => {
    expect(parseCycling("Cycling {B} ({B}, Discard this card: Draw a card.)")).toEqual({ costManaText: "{B}" });
    expect(parseCycling("Cycling {2}")).toEqual({ costManaText: "{2}" });
  });
  it("ignores cards without cycling", () => {
    expect(parseCycling("Flying")).toBeUndefined();
  });
  it("reads typecycling as a search for that type", () => {
    expect(parseCycling("Plainscycling {2} ({2}, Discard this card: Search your library for a Plains card.)")).toEqual({ costManaText: "{2}", searchType: "Plains" });
    expect(parseCycling("Basic landcycling {1}")).toEqual({ costManaText: "{1}", searchType: "Land", basicOnly: true });
  });
});
