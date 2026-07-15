// Splits oracle text into its individual ability clauses (this card data's convention uses "\n"
// between abilities) and isolates which ones actually apply to a given moment — entering the
// battlefield vs. dying vs. an activated-ability cost — so callers don't misread a "dies" trigger
// or an activated ability's cost as something that happens immediately on ETB (or vice versa).
// Shared between the client-side engine (AppFlow.tsx) and the Rules Advisor (rulesAdvisor.ts) so
// both apply the same rule instead of drifting apart.

export function oracleClauses(oracleText: string): string[] {
  return oracleText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function isActivatedAbilityClause(clause: string): boolean {
  return /^\{[^}]+\}/.test(clause) && clause.includes(":");
}

export function isDeathTriggerClause(clause: string): boolean {
  return /\b(when|whenever)\b[^.]{0,80}\bdies\b/i.test(clause);
}

// Oracle text with activated-ability and "dies"-triggered clauses stripped out, so ETB-time
// parsing (token creation, life/card-draw effects, rules-advisor workflow detection) can't
// misfire on abilities that are actually gated behind a later death trigger or a separate
// activated cost (e.g. Mind Stone's "{1}, {T}, Sacrifice this artifact: Draw a card." must not
// resolve the moment it's cast, and Hangarback Walker's death trigger must not fire on ETB).
export function etbEffectText(oracleText: string): string {
  return oracleClauses(oracleText)
    .filter((clause) => !isActivatedAbilityClause(clause) && !isDeathTriggerClause(clause))
    .join(" ");
}

// The inverse: isolates just the "dies"-triggered clause(s), so a permanent's death effect (e.g.
// Solemn Simulacrum's "When this creature dies, you may draw a card.") is parsed from the right
// sentence instead of the whole card (which would otherwise also match its unrelated ETB clause).
export function deathEffectText(oracleText: string): string {
  return oracleClauses(oracleText)
    .filter((clause) => isDeathTriggerClause(clause))
    .join(" ");
}
