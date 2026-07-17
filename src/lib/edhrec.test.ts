import { describe, expect, it } from "vitest";
import { edhrecCommanderSlug } from "./edhrec";

describe("edhrecCommanderSlug", () => {
  it("lowercases, strips punctuation, and hyphenates a plain commander name", () => {
    expect(edhrecCommanderSlug("The Ur-Dragon")).toBe("the-ur-dragon");
  });

  it("strips a comma and apostrophe", () => {
    expect(edhrecCommanderSlug("Atraxa, Praetors' Voice")).toBe("atraxa-praetors-voice");
  });

  it("keeps existing hyphens in a hyphenated name", () => {
    expect(edhrecCommanderSlug("Kiki-Jiki, Mirror Breaker")).toBe("kiki-jiki-mirror-breaker");
  });

  it("declines partner/background commander pairs", () => {
    expect(edhrecCommanderSlug("Tymna the Weaver + Kraum, Ludevic's Opus")).toBeUndefined();
  });

  it("declines split cards", () => {
    expect(edhrecCommanderSlug("Fire // Ice")).toBeUndefined();
  });
});
