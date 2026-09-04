// Translates a card's oracle text into a sequence of primitive game actions (draw N cards,
// destroy target X, sacrifice a permanent, ...) when none of this codebase's deterministic
// per-effect parsers recognize the wording — the fallback-of-last-resort for the exact bug class
// this session kept finding for lands: a real, printed effect that no hand-written regex matches,
// silently doing nothing instead of erroring. Modeled directly on rulesAdvisor.ts's own shape
// (deterministic-first — there is none here, this module is LLM-only by design — then an
// Ollama call with JSON-schema-constrained decoding and a Zod validation pass), reusing its
// infrastructure (ollamaFetch, OLLAMA_TIMEOUT_MS) rather than duplicating it.
//
// Deliberately a FLAT schema, one level deep, rather than a 1:1 mirror of AppFlow.tsx's own nested
// PrimitiveAction union (RemovalEffect/ZoneEffect nested inside a step nested inside an array) —
// the same lesson rulesAdvisor.ts's own schema already encodes (ollama.ts:95-103's comment on why a
// required field a small model can't reliably satisfy stalls generation): the flatter and shallower
// the JSON schema handed to a 7B local model, the more reliably it actually produces valid output.
// AppFlow.tsx's mapPrimitiveActionStep is the (equally deterministic, fully tested) translation from
// this flat wire shape to the richer internal PrimitiveAction union.

import { z } from "zod";
import { ollamaFetch, OLLAMA_TIMEOUT_MS } from "./ollama";

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
  // sets both is treated as declined; see requestPrimitiveActionPlan's caller).
  declined: z.boolean().default(false),
  // True when the oracle text says "you may" before this effect — a real player decision, not a
  // forced action. The engine already has full "may" support for the deterministic trigger path
  // (TriggerEffect.optional -> a real accept/decline prompt, resolveAgentRuleChoice's accept-by-
  // default heuristic for agents); this flag is what lets consultPrimitiveActionPlanner route into
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

export interface PrimitiveActionPlanInput {
  cardName: string;
  oracleText: string;
  actorName: string;
  battlefieldSummary: string[];
  handSummary: string[];
  graveyardSummary: string[];
}

const SYSTEM_PROMPT = `You are an MTG card-effect translator. Return JSON only. Do not change game state.
Translate the given card's effect text into a sequence of PRIMITIVE actions from this fixed vocabulary — do not invent a kind outside this list:
- destroy_target { targetType }: destroy one target permanent of targetType.
- destroy_all { targetType }: destroy every permanent of targetType (a board wipe).
- exile_target { targetType }: exile one target permanent of targetType.
- bounce_target { targetType }: return one target permanent of targetType to its owner's hand.
- reanimate { regrowTargetType, anyGraveyard }: return a card of regrowTargetType from a graveyard to the battlefield (anyGraveyard=true if it can be any player's graveyard, false if only the caster's).
- mill { amount, millScope }: puts amount cards from the top of a library into its owner's graveyard. millScope: you (default, the caster's own library), target_player (one chosen opponent's library), each_opponent (every opponent's library), each_player (everyone's library including the caster's).
- draw_cards { amount }: the caster draws amount cards.
- life_change { lifeDelta }: the CASTER'S OWN life total changes by lifeDelta (positive = gain, negative = lose). Only use this for a one-sided effect with no other player involved — if the text also changes an opponent's life in the same breath (drain), emit ONLY "drain" below for that effect, NEVER life_change too. drain already includes the caster's gain; a separate life_change step for that same gain double-counts it and is always wrong.
- drain { amount, drainScope }: ONE step that both makes the caster gain amount life AND makes drainScope lose amount life — this single step is the complete translation of "target player loses N life and you gain N life" (or "...you gain that much life"). Do not add a second step (life_change or anything else) for the same sentence; drain already moves the caster's life for you. drainScope: target_player (one target opponent) or each_opponent (every opponent at once). ("each opponent loses N, you gain life equal to the total" needs a summed amount this vocabulary can't compute — decline that one instead of guessing a number.)
- damage_target { amount, damageTargetType }: deals amount damage to one target. damageTargetType: creature (default), player (a player directly, not a creature), any (creature, player, or planeswalker — "any target"/"target creature or player"). Never use this for damage to EVERY creature/player at once — there's no primitive for a mass-damage sweeper; decline that instead.
- discard { amount, discardScope }: makes discardScope discard amount cards, its own unrestricted choice of which ones. discardScope: you (the caster discards), target_player (default, one target opponent), each_opponent (every opponent), each_player (everyone including the caster). Only use this for a plain "discards N cards" effect — if the caster (not the discarding player) gets to pick which specific card, or there's a type restriction on which card ("discards a noncreature card," reveal-hand-then-choose like Duress), decline instead; this primitive can't express that choice.
- tap_target { targetType }: taps one target permanent of targetType. untap_target { targetType }: untaps one target permanent of targetType. Only for "tap/untap target X" as the spell/ability's OWN effect — never use these for an activated ability's OWN cost (e.g. "{T}: ..." on the source itself, or "{2}, T: ...") — that's a cost, not a step, and is handled elsewhere.
- pump_target { power, toughness }: one target creature gets +power/+toughness (or negative) until end of turn.
- mass_pump { power, toughness, massPumpScope }: every creature in massPumpScope (all/controlled/opponents) gets +power/+toughness until end of turn.
- mass_bounce {}: return every creature on the battlefield to its owner's hand.
- create_tokens { tokenCount, tokenName, tokenPower, tokenToughness, tokenColors, tokenTypeLine }: create tokenCount tokens.
- put_counters_on_self { counterKind, amount }: put amount counters of counterKind on the source card itself.
- sacrifice_permanent { sacrificeScope }: the caster sacrifices a permanent (self = the source card itself, creature_you_control/permanent_you_control = caster's choice among that type).
- move_card_zone { moveFrom, moveTo, moveFilter, moveCount }: move moveCount cards from moveFrom (hand/graveyard) to moveTo (hand/graveyard/exile/library_top).

Never emit a "search_library" step — that primitive doesn't exist yet; if a card's ONLY effect is a library search, set declined=true instead of approximating it with move_card_zone or anything else.
If the effect has a leading "if <condition>"/"only if <condition>" clause describing a simple board-state requirement (e.g. "if you control a commander", "if you control three or more artifacts", "if you control an Angel or a Demon"), put that clause verbatim (starting from "if"/"only if") in the condition field and still translate the REST of the effect into steps normally — a leading condition clause by itself is not a reason to decline. Leave condition ("") when there is none.
If the effect doesn't map cleanly onto the primitive vocabulary at all (stack manipulation, replacement effects, static/continuous buffs, counterspells, an interactive search), OR its condition depends on something other than current board state (what happened earlier this resolution, an amount only computable at resolution time, etc.), set declined=true and steps=[] rather than guessing — a wrong action is worse than no action.
Set optional=true if the oracle text says "you may" before this effect (a real choice the controller gets to make, not something that just happens) — false for anything mandatory. This is independent of declined/steps: still translate the effect into steps normally either way, optional only marks whether the player gets asked first.
The oracleText given has already been scoped to the relevant clause for this event — do not infer or recall other abilities the card might have from training data; translate based solely on the given text.`;

// Ollama's structured-output `format` wants a plain JSON-schema object, not a zod schema — this is
// that schema for a single PrimitiveActionStep, hand-kept in sync with PrimitiveActionStepSchema
// above. Exported so cardParser.ts (which embeds an array of these per ability) doesn't hand-copy it.
export const PRIMITIVE_ACTION_STEP_JSON_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string" },
    targetType: { type: "string" },
    regrowTargetType: { type: "string" },
    anyGraveyard: { type: "boolean" },
    amount: { type: "number" },
    millScope: { type: "string" },
    lifeDelta: { type: "number" },
    drainScope: { type: "string" },
    damageTargetType: { type: "string" },
    discardScope: { type: "string" },
    power: { type: "number" },
    toughness: { type: "number" },
    massPumpScope: { type: "string" },
    tokenCount: { type: "number" },
    tokenName: { type: "string" },
    tokenPower: { type: "number" },
    tokenToughness: { type: "number" },
    tokenColors: { type: "array", items: { type: "string" } },
    tokenTypeLine: { type: "string" },
    counterKind: { type: "string" },
    sacrificeScope: { type: "string" },
    moveFrom: { type: "string" },
    moveTo: { type: "string" },
    moveFilter: { type: "string" },
    moveCount: { type: "number" }
  },
  // "amount" added to required alongside "kind" for the same reason cardParser.ts's ability-level
  // schema requires triggerEvent: prose alone ("mill { amount }", "drain { amount, drainScope }")
  // wasn't enough — reproduced live, a drain step came back with drainScope set but amount missing
  // (and unrelated fields like power/counterKind/moveCount filled in instead), which silently
  // dropped the whole step in mapPrimitiveActionStep since amount is what it checks for. Harmless
  // for kinds that don't use amount (destroy_target, pump_target, ...) — those already got ignored
  // fields from the model routinely (see the same drain repro above) and mapPrimitiveActionStep
  // only ever reads the fields each kind actually declares.
  required: ["kind", "amount"]
} as const;

export async function requestPrimitiveActionPlan(input: PrimitiveActionPlanInput, baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434") {
  const model = process.env.OLLAMA_RULES_MODEL ?? process.env.OLLAMA_MODEL ?? "qwen2.5:7b-instruct-q5_K_M";
  const response = await ollamaFetch(
    `${baseUrl}/api/chat`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: {
          type: "object",
          properties: {
            summary: { type: "string" },
            declined: { type: "boolean" },
            optional: { type: "boolean" },
            condition: { type: "string" },
            steps: {
              type: "array",
              items: PRIMITIVE_ACTION_STEP_JSON_SCHEMA
            }
          },
          // optional/condition in required for the same reason amount is required on the step schema
          // above — marking a field required in the schema itself is what actually gets the model to
          // reliably set it (condition="" when there is none) rather than default-omitting it.
          required: ["summary", "declined", "optional", "condition", "steps"]
        },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              cardName: input.cardName,
              oracleText: input.oracleText,
              actorName: input.actorName,
              battlefield: input.battlefieldSummary,
              hand: input.handSummary,
              graveyard: input.graveyardSummary
            })
          }
        ]
      })
    },
    OLLAMA_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(`Ollama primitive-plan request failed with HTTP ${response.status}.`);
  }

  const body = await response.json();
  const content = body.message?.content;
  if (typeof content !== "string") {
    throw new Error("Ollama response did not include message.content.");
  }

  const plan = PrimitiveActionPlanSchema.parse(JSON.parse(content));
  return { source: "ollama" as const, plan: { ...plan, steps: filterGroundedSteps(plan.steps, input.oracleText) } };
}
