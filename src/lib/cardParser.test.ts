import { describe, expect, it } from "vitest";
import { AbilitySchema, deriveCardDeclined, type Ability } from "./cardParser";

function ability(overrides: Partial<Ability>): Ability {
  return AbilitySchema.parse({ kind: "static", ...overrides });
}

describe("deriveCardDeclined", () => {
  it("is true when there are no abilities at all", () => {
    expect(deriveCardDeclined([])).toBe(true);
  });

  it("is true when every ability is declined", () => {
    expect(deriveCardDeclined([ability({ declined: true }), ability({ declined: true })])).toBe(true);
  });

  // Reproduced live: a bare "Vigilance" keyword card came back with one ability (kind: "keyword",
  // declined: false) but the model's own top-level declined flag was still true — this is the exact
  // regression case that motivated computing the aggregate instead of trusting the model's self-report.
  it("is false when at least one ability was successfully classified, ignoring any stray top-level self-report", () => {
    expect(deriveCardDeclined([ability({ kind: "keyword", text: "Vigilance", declined: false })])).toBe(false);
  });

  it("is false when only some abilities are declined", () => {
    expect(deriveCardDeclined([ability({ declined: true }), ability({ declined: false })])).toBe(false);
  });
});
