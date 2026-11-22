// Schema and helpers for the parsed_cards table rows (cardDb.ts): the per-card ability list in the primitive-step vocabulary of primitiveActionPlan.ts.
// The offline LLM parser that used to fill the table (requestCardParse) was removed with the Rules Advisor; existing rows stay readable.
import { z } from "zod";
import { LenientPrimitiveActionStepArraySchema } from "./primitiveActionPlan";

function lenientEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const cleaned = value.trim().toLowerCase().replace(/[^a-z_]/g, "");
    return values.includes(cleaned as T[number]) ? cleaned : undefined;
  }, z.enum(values).optional());
}

// The trigger points this engine actually recognizes today (AppFlow.tsx's "entered"/"died"/
// "combat_damage_to_player" clause modes, rulesAdvisor.ts's upkeep handling, the "beginning of
// combat"/"attacks" phase checks) — not the full rules-text space of possible trigger conditions.
// "other" is the deliberate escape hatch for a real trigger (e.g. "whenever you draw a card")
// that has no runtime hook yet: it's still recorded with its condition text for future review
// rather than forced into a bucket that would fire it at the wrong time.
const TRIGGER_EVENTS = [
  "etb",
  "dies",
  "attacks",
  "upkeep",
  "end_step",
  "beginning_of_combat",
  "combat_damage_to_player",
  "cast",
  "other"
] as const;

export const AbilitySchema = z.object({
  kind: z.enum(["triggered", "activated", "static", "keyword", "spell_effect"]),
  triggerEvent: lenientEnum(TRIGGER_EVENTS),
  condition: z.string().default(""),
  cost: z.string().default(""),
  text: z.string().default(""),
  steps: LenientPrimitiveActionStepArraySchema,
  declined: z.boolean().default(false),
  // "You may ..." — a real player decision, not a forced action. Threaded through matchAbilityForEvent's
  // cache hits into the same optional-plan flow primitiveActionPlan.ts's own optional field drives
  // (see its doc comment) — the two schemas carry the same field for the same reason.
  optional: z.boolean().default(false)
});

export type Ability = z.infer<typeof AbilitySchema>;

const CardParseSchema = z.object({
  declined: z.boolean().default(false),
  abilities: z.array(AbilitySchema).default([])
});

export type CardParse = z.infer<typeof CardParseSchema>;

// The model's own top-level CardParseSchema.declined is unreliable — reproduced live, it routinely
// comes back true even when every ability underneath was classified fine (a bare "Vigilance"
// keyword card, "{T}: Add {C}{C}.", etc. — one real ability, declined=false, yet the top-level flag
// still said declined=true, silently sending a perfectly usable card straight to the "declined"
// cache bucket). The SYSTEM_PROMPT already says top-level declined should only be true when NOTHING
// on the card could be classified — recompute it deterministically from the ability list itself
// (the same aggregate fact) instead of trusting the model's separate self-report of it.
export function deriveCardDeclined(abilities: Ability[]): boolean {
  return abilities.length === 0 || abilities.every((ability) => ability.declined);
}
