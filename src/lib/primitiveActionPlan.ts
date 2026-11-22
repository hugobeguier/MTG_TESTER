// The flat step schema (PrimitiveActionStep) shared by the legacy deterministic step executor (src/engine/oneShotEffects.ts
// applyPrimitiveActionPlan / mapPrimitiveActionStep), the parsed_cards table (cardParser.ts) and the kernel capability checks
// (src/kernel/capabilities.ts). It used to be the wire format of an LLM planner (the Rules Advisor, removed -- see
// docs/rules-advisor-removal.md); the LLM prompt, JSON schema and Ollama call are gone, only the schema and its grounding filters remain.

import { z } from "zod";

// Lenient string-enum coercion for any field a small model might wrap in stray punctuation or
// case — same defensive pattern as rulesAdvisor.ts's DestinationSchema (rulesAdvisor.ts:6-17),
// generalized to take the allowed value list as a parameter instead of being hand-copied per field.
function lenientEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const cleaned = value.trim().toLowerCase().replace(/[^a-z_]/g, "");
    return values.includes(cleaned as T[number]) ? cleaned : undefined;
  }, z.enum(values).optional());
}

const TARGET_TYPES = ["creature", "artifact", "enchantment", "planeswalker", "permanent", "land", "nonland_permanent"] as const;
const REGROW_TARGET_TYPES = ["card", "permanent", "creature", "land", "enchantment", "artifact"] as const;
const MASS_PUMP_SCOPES = ["all", "controlled", "opponents"] as const;
const SACRIFICE_SCOPES = ["self", "creature_you_control", "permanent_you_control"] as const;
const MOVE_ZONES_FROM = ["hand", "graveyard"] as const;
const MOVE_ZONES_TO = ["hand", "graveyard", "exile", "library_top"] as const;
const MOVE_FILTERS = ["worst", "best", "any"] as const;
// Matches zoneEffects.ts's MillScope exactly (not re-imported — this schema stays a standalone,
// hand-kept-in-sync wire format the same way it already does for every other field here) so
// mapPrimitiveActionStep in AppFlow.tsx can pass millScope straight through to the SAME
// already-fully-executed ZoneEffect mill handling every deterministically-parsed mill card uses,
// no new execution code needed.
const MILL_SCOPES = ["you", "target_player", "each_opponent", "each_player"] as const;
// The two-sided "target player loses N life, you gain N life" (Blood Artist) / "each opponent
// loses N, you gain N" (Zulaport Cutthroat) shape — mirrors AppFlow.tsx's existing internal
// TriggerEffect "drain" kind exactly, rather than trying to express this as two separate,
// unlinked life_change steps (which is what produced Blood Artist's ambiguous parse earlier).
const DRAIN_SCOPES = ["target_player", "each_opponent"] as const;
// DamageEffect's own targetType vocabulary (removalSpells.ts) — deliberately its own field/enum
// rather than reusing TARGET_TYPES/toRemovalTargetType above: damage can target a player directly
// ("any target", "target player"), which destroy/exile/bounce never can, so the two vocabularies
// genuinely differ rather than one being a subset of the other.
const DAMAGE_TARGET_TYPES = ["any", "creature", "player"] as const;
// Mirrors MILL_SCOPES exactly — "target player discards" / "each opponent discards" is the same
// shape as mill's "whose library" scope, just for hands instead of libraries.
const DISCARD_SCOPES = ["you", "target_player", "each_opponent", "each_player"] as const;

const STEP_KINDS = [
  "destroy_target",
  "destroy_all",
  "exile_target",
  "bounce_target",
  "reanimate",
  "mill",
  "draw_cards",
  "life_change",
  "drain",
  "damage_target",
  "discard",
  "tap_target",
  "untap_target",
  "pump_target",
  "mass_pump",
  "mass_bounce",
  "create_tokens",
  "put_counters_on_self",
  "sacrifice_permanent",
  "move_card_zone"
] as const;

export const PrimitiveActionStepSchema = z.object({
  kind: z.enum(STEP_KINDS),
  // destroy_target / destroy_all / exile_target / bounce_target / reanimate
  targetType: lenientEnum(TARGET_TYPES),
  regrowTargetType: lenientEnum(REGROW_TARGET_TYPES),
  anyGraveyard: z.boolean().optional(),
  // mill / draw_cards / drain
  amount: z.number().int().min(0).max(40).optional(),
  // mill only — who mills; defaults to "you" (mapPrimitiveActionStep) when omitted so every
  // existing mill parse (which never set this field) keeps its exact old behavior.
  millScope: lenientEnum(MILL_SCOPES),
  // life_change — positive gains, negative loses; a single signed field instead of a nested
  // kind so the model only has one number to get right instead of a sign AND a sub-kind agreeing.
  lifeDelta: z.number().int().min(-40).max(40).optional(),
  // drain only — who loses the life (the caster always gains `amount` in both scopes).
  drainScope: lenientEnum(DRAIN_SCOPES),
  // damage_target only — its own vocabulary (any/creature/player), distinct from targetType above.
  damageTargetType: lenientEnum(DAMAGE_TARGET_TYPES),
  // discard only — whose hand; amount is shared with mill/draw_cards/drain above.
  discardScope: lenientEnum(DISCARD_SCOPES),
  // pump_target / mass_pump
  power: z.number().int().min(-20).max(20).optional(),
  toughness: z.number().int().min(-20).max(20).optional(),
  massPumpScope: lenientEnum(MASS_PUMP_SCOPES),
  // create_tokens
  tokenCount: z.number().int().min(1).max(20).optional(),
  tokenName: z.string().optional(),
  tokenPower: z.number().int().min(0).max(20).optional(),
  tokenToughness: z.number().int().min(0).max(20).optional(),
  tokenColors: z.array(z.string()).optional(),
  tokenTypeLine: z.string().optional(),
  // put_counters_on_self
  counterKind: z.string().optional(),
  // sacrifice_permanent
  sacrificeScope: lenientEnum(SACRIFICE_SCOPES),
  // move_card_zone
  moveFrom: lenientEnum(MOVE_ZONES_FROM),
  moveTo: lenientEnum(MOVE_ZONES_TO),
  moveFilter: lenientEnum(MOVE_FILTERS),
  moveCount: z.number().int().min(0).max(20).optional()
});

export type PrimitiveActionStep = z.infer<typeof PrimitiveActionStepSchema>;

// The single largest recurring pattern in the bulk parser's failed_cards.log (after this session's
// other primitive additions), by a wide margin: the model inventing a step kind outside the fixed
// vocabulary — "static", "attach_equipment", "add_mana", "aura", "cast", "search_library", ... —
// for a shape it should have declined instead (a continuous/static effect, an equip cost, a mana
// ability, none of which this DSL represents as a step at all). kind is a strict z.enum, so ONE
// invented value anywhere in the steps array throws and fails the WHOLE containing ability/plan —
// even when every OTHER step the model returned was perfectly valid — turning what should be a
// clean partial success (or a clean per-ability decline) into a wasted parse_status: "failed" that
// needs a manual --retry-failed round-trip. Every OTHER field in this schema already gets this same
// "drop what's unrecognized instead of rejecting the whole thing" treatment via lenientEnum — this
// is that same leniency applied one level up, at the array-element level, since a step with an
// unrecognized kind has no valid partial interpretation to coerce into (unlike, say, a bad
// targetType, which can just fall back to undefined on an otherwise-fine step).
//
// Preprocesses the RAW array (before either step schema runs) so every step that DOES have a
// recognized kind still goes through PrimitiveActionStepSchema's full, unchanged validation
// (including its existing "an out-of-range number throws" behavior — see
// primitiveActionPlan.test.ts's "out-of-range throws" test — this only filters by kind, nothing else).
export const LenientPrimitiveActionStepArraySchema = z.preprocess((value) => {
  if (!Array.isArray(value)) return value;
  const known: readonly string[] = STEP_KINDS;
  return value.filter((item) => item && typeof item === "object" && known.includes((item as { kind?: unknown }).kind as string));
}, z.array(PrimitiveActionStepSchema).default([]));

// A cheap plausibility gate against a real failure mode this session reproduced live: given "When
// this creature dies, you may draw a card." (Aven Fisher), the model returned a plan with a
// correct draw_cards step AND a fabricated move_card_zone (discard) step with no basis anywhere in
// the text — a non-declined plan the "decline rather than guess" convention doesn't catch, because
// the model wasn't uncertain about the WHOLE plan, just wrong about one extra step in it. Not
// exhaustive rules-text matching (oracleClauses.ts's deterministic parsers already own that job for
// the cards they cover) — just "does ANY keyword this step's kind would need appear anywhere in the
// text it supposedly came from." A kind with no entry here is never filtered (conservative: only
// reject what there's a concrete textual signal to reject).
const STEP_GROUNDING_KEYWORDS: Partial<Record<PrimitiveActionStep["kind"], RegExp>> = {
  destroy_target: /\bdestroy\b/i,
  destroy_all: /\bdestroy\b/i,
  exile_target: /\bexile\b/i,
  bounce_target: /\breturn\b/i,
  mass_bounce: /\breturn\b/i,
  reanimate: /\breturn\b/i,
  mill: /\bmill\b|\blibrary\b/i,
  draw_cards: /\bdraw\b/i,
  life_change: /\blife\b/i,
  drain: /\blife\b/i,
  damage_target: /\bdamage\b/i,
  discard: /\bdiscards?\b/i,
  tap_target: /\btap\b|\btaps\b|\btapped\b/i,
  untap_target: /\buntap\b|\buntaps\b|\buntapped\b/i,
  pump_target: /[+-]\d+\/[+-]\d+|\btoughness\b|\bpower\b/i,
  mass_pump: /[+-]\d+\/[+-]\d+|\btoughness\b|\bpower\b/i,
  create_tokens: /\btoken\b/i,
  put_counters_on_self: /\bcounter\b/i,
  sacrifice_permanent: /\bsacrifice\b/i,
  move_card_zone: /\bdiscard\b|\breturn\b|\bexile\b|\bhand\b|\blibrary\b/i
};

// The inverse of STEP_GROUNDING_KEYWORDS: the kind's keyword IS present, but other wording nearby
// signals a shape this primitive specifically can't express — checked in addition to the positive
// match above. Reproduced live: Duress ("Target opponent reveals their hand. You choose a
// noncreature, nonland card from it. That player discards that card.") still parsed as a plain
// discard even after the SYSTEM_PROMPT was told to decline this exact shape — a 7B model isn't
// reliably prompt-steerable here any more than anywhere else this session, so this is the same
// deterministic backstop pattern as the positive grounding check, just phrased as a reject signal.
// Currently only "discard" needs one: the discard primitive is always the discarding player's own
// unrestricted choice of card, which can't represent the CASTER choosing (reveal-hand-then-choose,
// or a type-restricted "discards a noncreature card").
const STEP_ANTI_PATTERNS: Partial<Record<PrimitiveActionStep["kind"], RegExp>> = {
  discard: /\byou choose\b|reveals? (?:their|its|your|his or her) hand|discards? an? (?:noncreature|nonland|nonartifact|creature|land|artifact|instant|sorcery|enchantment)\b/i
};

export function isStepGroundedInText(step: PrimitiveActionStep, oracleText: string): boolean {
  const pattern = STEP_GROUNDING_KEYWORDS[step.kind];
  if (pattern && !pattern.test(oracleText)) return false;
  const antiPattern = STEP_ANTI_PATTERNS[step.kind];
  return !antiPattern || !antiPattern.test(oracleText);
}

// Called on every plan/ability the model returns, right after schema validation, so an ungrounded
// step never reaches applyPrimitiveActionPlan OR gets written into the parsed_cards cache — cheaper
// to filter once here than to re-check on every future application of an already-cached step.
export function filterGroundedSteps(steps: PrimitiveActionStep[], oracleText: string): PrimitiveActionStep[] {
  return steps.filter((step) => isStepGroundedInText(step, oracleText));
}

export const PrimitiveActionPlanSchema = z.object({
  // No .min(1) — same reasoning as rulesAdvisor.ts:38-47's summary field: this is display text
  // only, a blank value degrades a log message, not correctness, so it must not throw away an
  // otherwise-valid plan.
  summary: z.string().default(""),
  // True when the card's effect doesn't map onto the primitive vocabulary at all (a mechanic this
  // engine has no primitive for — stack manipulation, replacement effects, static buffs, an
  // interactive search) — the explicit "don't guess" output, mirroring manual_review's role in
  // RuleWorkflowSchema. steps is expected empty when true, but not enforced here (a model that
  // sets both is treated as declined).
  declined: z.boolean().default(false),
  // True when the oracle text says "you may" before this effect — a real player decision, not a
  // forced action. The engine already has full "may" support for the deterministic trigger path
  // (TriggerEffect.optional -> a real accept/decline prompt, resolveAgentRuleChoice's accept-by-
  // default heuristic for agents); this flag lets a plan route into
  // that exact same mechanism instead of always applying the plan immediately.
  optional: z.boolean().default(false),
  // A simple board-state "if X"/"only if X" requirement gating the whole effect (e.g. "if you
  // control a commander", "if you control three or more artifacts") — captured as plain text
  // starting from "if"/"only if" rather than declining the ability outright. Empty string means no
  // condition. AppFlow.tsx's isBoardConditionMet (the same phrase vocabulary
  // activateOnlyIfConditionMet already used for "activate only if" activation gating) evaluates
  // this against live board state right before applying steps; a condition it can't parse into a
  // known shape evaluates to "not met" — silently skipping the effect is safer than guessing.
  condition: z.string().default(""),
  steps: LenientPrimitiveActionStepArraySchema
});

export type PrimitiveActionPlan = z.infer<typeof PrimitiveActionPlanSchema>;
