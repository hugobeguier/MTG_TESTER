import { describe, expect, it } from "vitest";
import { AbilitySchema, deriveCardDeclined, matchAbilityForEvent, type Ability } from "./cardParser";

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

describe("matchAbilityForEvent", () => {
  it("matches a single non-declined, steps-populated triggered ability for its event", () => {
    const abilities = [ability({ kind: "triggered", triggerEvent: "dies", declined: false, steps: [{ kind: "draw_cards", amount: 1 }] })];
    expect(matchAbilityForEvent("card_moved_to_graveyard", abilities)?.triggerEvent).toBe("dies");
  });

  it("does not match a declined ability even if the event/kind line up", () => {
    const abilities = [ability({ kind: "triggered", triggerEvent: "dies", declined: true, steps: [] })];
    expect(matchAbilityForEvent("card_moved_to_graveyard", abilities)).toBeUndefined();
  });

  it("does not match an ambiguous event with no cache entry", () => {
    const abilities = [ability({ kind: "activated", declined: false, steps: [{ kind: "draw_cards", amount: 1 }] })];
    expect(matchAbilityForEvent("loyalty_ability", abilities)).toBeUndefined();
  });
});
