import { describe, expect, it } from "vitest";
import { deterministicAttackTax, effectiveAttackTaxAmount, looksLikeAttackTaxCandidate } from "./staticEffects";

describe("looksLikeAttackTaxCandidate", () => {
  it("accepts Propaganda-shaped text", () => {
    expect(looksLikeAttackTaxCandidate("Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.")).toBe(true);
  });

  it("rejects unrelated oracle text", () => {
    expect(looksLikeAttackTaxCandidate("Flying, deathtouch\nWhenever this creature attacks, draw a card.")).toBe(false);
  });
});

describe("deterministicAttackTax", () => {
  it("parses Propaganda's fixed {2}-per-attacker tax", () => {
    const effect = deterministicAttackTax(
      "propaganda-1",
      "Propaganda",
      "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you."
    );
    expect(effect).toEqual({
      kind: "attack_tax",
      amountPerAttacker: 2,
      appliesTo: "controller",
      sourceCardId: "propaganda-1",
      sourceCardName: "Propaganda",
      interpretedBy: "deterministic"
    });
  });

  it("parses Ghostly Prison identically to Propaganda", () => {
    const effect = deterministicAttackTax(
      "ghostly-prison-1",
      "Ghostly Prison",
      "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you."
    );
    expect(effect?.amountPerAttacker).toBe(2);
    expect(effect?.interpretedBy).toBe("deterministic");
  });

  it("parses Sphere of Safety's dynamic per-enchantment tax and marks it as controller-and-planeswalker", () => {
    const effect = deterministicAttackTax(
      "sphere-of-safety-1",
      "Sphere of Safety",
      "Creatures can't attack you or planeswalkers you control unless their controller pays {X} for each of those creatures, where X is the number of enchantments you control."
    );
    expect(effect).toMatchObject({
      kind: "attack_tax",
      formula: "enchantment_count",
      appliesTo: "both",
      interpretedBy: "deterministic"
    });
    expect(effectiveAttackTaxAmount(effect!, 5)).toBe(5);
  });

  it("does not false-positive Sphere of Safety's dynamic text against the fixed-amount pattern", () => {
    const text = "Creatures can't attack you or planeswalkers you control unless their controller pays {X} for each of those creatures, where X is the number of enchantments you control.";
    const fixedOnlyMatch = /creatures can'?t attack you(?: or (?:a |planeswalkers? )?you control)? unless their controller pays \{(\d+)\} for each/.test(text);
    expect(fixedOnlyMatch).toBe(false);
    expect(deterministicAttackTax("sphere-of-safety-2", "Sphere of Safety", text)?.formula).toBe("enchantment_count");
  });

  it("returns undefined for a card with no attack-tax text", () => {
    expect(deterministicAttackTax("bear-1", "Grizzly Bears", "Vanilla 2/2 creature.")).toBeUndefined();
  });
});
