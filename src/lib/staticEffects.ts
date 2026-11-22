import type { InterpretedEffect } from "./types";

// Cheap pre-filter so we don't run the parser for the vast majority of
// permanents that obviously have nothing to do with attack restrictions.
export function looksLikeAttackTaxCandidate(oracleText: string): boolean {
  const text = oracleText.toLowerCase();
  return text.includes("attack") && (text.includes("pay") || text.includes("can't attack") || text.includes("cant attack"));
}

// Matches the exact templated text Wizards uses for this family of cards (Propaganda, Ghostly
// Prison, Sphere of Safety, Grand Melee, etc.), including the "{X}, where X is the number of
// <type> you control" variant so the tax stays accurate as the board changes instead of being
// cached as a stale number from whenever the permanent entered.
export function deterministicAttackTax(sourceCardId: string, sourceCardName: string, oracleText: string): InterpretedEffect | undefined {
  const text = oracleText.toLowerCase();
  const appliesTo: InterpretedEffect["appliesTo"] = text.includes("planeswalker") ? "both" : "controller";

  const dynamicMatch = text.match(
    /creatures can'?t attack you(?: or (?:a |planeswalkers? )?you control)? unless their controller pays \{x\} for each[^,.]*, where x is the number of ([a-z]+?)s? you control/
  );
  if (dynamicMatch && dynamicMatch[1] === "enchantment") {
    return {
      kind: "attack_tax",
      amountPerAttacker: 0,
      formula: "enchantment_count",
      appliesTo,
      sourceCardId,
      sourceCardName,
      interpretedBy: "deterministic"
    };
  }

  const fixedMatch = text.match(/creatures can'?t attack you(?: or (?:a |planeswalkers? )?you control)? unless their controller pays \{(\d+)\} for each/);
  if (fixedMatch) {
    return {
      kind: "attack_tax",
      amountPerAttacker: Number.parseInt(fixedMatch[1], 10),
      appliesTo,
      sourceCardId,
      sourceCardName,
      interpretedBy: "deterministic"
    };
  }

  return undefined;
}

export function effectiveAttackTaxAmount(effect: InterpretedEffect, enchantmentCount: number): number {
  if (effect.formula === "enchantment_count") return enchantmentCount;
  return effect.amountPerAttacker;
}
