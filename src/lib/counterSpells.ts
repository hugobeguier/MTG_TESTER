// Parses "Counter target [X] spell[, unless its controller pays {N}]" into structured data,
// following this codebase's deterministic-first pattern (see staticEffects.ts). Only spells are
// covered (not "counter target activated/triggered ability") — that's a separate, larger feature
// since this engine's stack model treats spells and abilities differently.

export type CounterSpellRestriction = "any" | "creature" | "noncreature" | "commander";

export interface CounterSpellAbility {
  restriction: CounterSpellRestriction;
  taxAmount?: number;
}

export function parseCounterSpellAbility(oracleText: string): CounterSpellAbility | undefined {
  const text = oracleText.toLowerCase();

  const taxMatch = text.match(/counter target spell unless its controller pays \{(\d+)\}/);
  if (taxMatch) return { restriction: "any", taxAmount: Number.parseInt(taxMatch[1], 10) };

  if (/\bcounter target creature spell\b/.test(text)) return { restriction: "creature" };
  if (/\bcounter target noncreature spell\b/.test(text)) return { restriction: "noncreature" };
  if (/\bcounter target commander spell\b/.test(text)) return { restriction: "commander" };
  if (/\bcounter target spell\b/.test(text)) return { restriction: "any" };

  return undefined;
}

export interface DelayedUpkeepDraws {
  // "Its controller may draw up to two cards at the beginning of the next turn's upkeep." — the
  // countered spell's own controller, not this spell's caster. Always taken at face value (this
  // engine's standard "always take the beneficial choice" policy for unmodeled optional decisions —
  // see Estrid's Invocation's own "you may" handling), so "up to N" always draws the full N.
  targetControllerDraws?: number;
  // "You draw a card at the beginning of the next turn's upkeep." — this spell's own caster,
  // unconditional (no "may").
  casterDraws?: number;
}

// Arcane Denial's compound delayed-draw clauses, on top of its own "Counter target spell" (parsed
// separately by parseCounterSpellAbility above) — both fire once the next upkeep step begins,
// scheduled onto GameSession.pendingUpkeepDraws since the spell itself is long gone from the stack
// by then. Reported live as neither draw ever happening: this whole shape was previously entirely
// unmodeled, following this codebase's "declined rather than guessed" pattern for effect shapes
// with no support built yet.
export function parseDelayedUpkeepDraws(oracleText: string): DelayedUpkeepDraws | undefined {
  const text = oracleText.toLowerCase();
  const targetMatch = text.match(/\bits controller may draw up to (\w+) cards? at the beginning of the next turn'?s upkeep\b/);
  const casterMatch = text.match(/\byou draw (a|one|two|three|four|five|\d+) cards? at the beginning of the next turn'?s upkeep\b/);
  if (!targetMatch && !casterMatch) return undefined;
  const wordToInt: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
  const toAmount = (word: string) => wordToInt[word] ?? Number.parseInt(word, 10);
  return {
    targetControllerDraws: targetMatch ? toAmount(targetMatch[1]) : undefined,
    casterDraws: casterMatch ? toAmount(casterMatch[1]) : undefined
  };
}

export function counterSpellCanTarget(ability: CounterSpellAbility, targetTypeLine: string, targetIsCommanderSpell: boolean): boolean {
  if (ability.restriction === "creature") return targetTypeLine.includes("Creature");
  if (ability.restriction === "noncreature") return !targetTypeLine.includes("Creature");
  if (ability.restriction === "commander") return targetIsCommanderSpell;
  return true;
}

// "This spell can't be countered." (Void Rend, ...) — a self-immunity printed directly on the
// targeted spell's own oracle text, independent of anything its controller has on the battlefield.
export function hasCantBeCountered(oracleText: string): boolean {
  return /\bthis spell can'?t be countered\b/i.test(oracleText);
}

export type CounterImmunityScope = "creature_spells" | "spells";

// "[Creature s]pells you [control/cast] can't be countered." — a static grant from a permanent the
// caster controls, distinct from hasCantBeCountered's on-the-spell-itself wording. "creature_spells"
// narrows to creature spells only; "spells" covers everything the controller casts.
export function parseCounterImmunityGrant(oracleText: string): CounterImmunityScope | undefined {
  const text = oracleText.toLowerCase();
  if (/\bcreature spells you (?:control|cast) can'?t be countered\b/.test(text)) return "creature_spells";
  if (/\bspells you (?:control|cast) can'?t be countered\b/.test(text)) return "spells";
  return undefined;
}

export function counterImmunityScopeMatches(scope: CounterImmunityScope, targetTypeLine: string): boolean {
  return scope === "spells" || targetTypeLine.includes("Creature");
}
