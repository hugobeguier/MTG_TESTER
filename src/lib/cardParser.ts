// Offline whole-card parser — mtg-commander-engine-spec.md's Phase 1 "parse_card(oracle_text) ->
// TriggerDescriptor[] + StaticAbility[] + ActivatedAbility[]", adapted to run on the same Ollama
// stack and the same primitive-step vocabulary primitiveActionPlan.ts already uses at runtime,
// rather than the spec's original 40-60-op DSL: an ability this parser can't express in that
// vocabulary gets declined here exactly like a runtime fallback declines, instead of a second
// effect language the engine would need separate code to execute. Where primitiveActionPlan.ts
// resolves ONE already-identified clause with live battlefield context, this resolves a whole
// card's oracle text with no game-state context at all — it enumerates every ability on the card
// once, offline, so a bulk run can populate the parsed_cards cache in cardDb.ts.
import { z } from "zod";
import { ollamaFetch, OLLAMA_CARD_PARSE_TIMEOUT_MS } from "./ollama";
import { LenientPrimitiveActionStepArraySchema, PRIMITIVE_ACTION_STEP_JSON_SCHEMA, filterGroundedSteps } from "./primitiveActionPlan";

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
export const TRIGGER_EVENTS = [
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

export const CardParseSchema = z.object({
  declined: z.boolean().default(false),
  abilities: z.array(AbilitySchema).default([])
});

export type CardParse = z.infer<typeof CardParseSchema>;

// Maps the free-form `event` strings AppFlow.tsx's consultRulesAdvisor/consultPrimitiveActionPlanner
// call sites already pass (see their call sites — "card_moved_to_graveyard", phaseEventName(phase)
// results, etc.) onto the (kind, triggerEvent) an offline-parsed ability needs to have to safely
// answer that same event live. Deliberately a narrow allowlist, not every event those call sites
// use: an event with no entry here (loyalty_ability — ambiguous among a planeswalker's several
// activated abilities since the client already scopes oracleText to one specific ability's text
// before calling; card_moved_to_exile — no corresponding trigger concept in TRIGGER_EVENTS; any
// phase name not listed) always falls through to a live call in the route, same as a cache miss.
const EVENT_ABILITY_MATCH: Record<string, { kind: Ability["kind"]; triggerEvent?: (typeof TRIGGER_EVENTS)[number] }> = {
  card_moved_to_graveyard: { kind: "triggered", triggerEvent: "dies" },
  spell_resolved_to_battlefield: { kind: "triggered", triggerEvent: "etb" },
  spell_resolved_to_graveyard: { kind: "spell_effect" },
  land_played: { kind: "triggered", triggerEvent: "etb" },
  upkeep_trigger: { kind: "triggered", triggerEvent: "upkeep" },
  end_step_trigger: { kind: "triggered", triggerEvent: "end_step" },
  beginning_of_combat_step_trigger: { kind: "triggered", triggerEvent: "beginning_of_combat" }
};

// Picks the single cached ability that safely answers `event`, or undefined if there's no match,
// more than one candidate (ambiguous — e.g. two "dies" triggers), or the match is itself declined/
// stepless. Ambiguity resolves to undefined rather than a guess so the caller always has a safe
// "fall through to a live call" path, never a wrong cached action applied silently.
export function matchAbilityForEvent(event: string, abilities: Ability[]): Ability | undefined {
  const rule = EVENT_ABILITY_MATCH[event];
  if (!rule) return undefined;
  const candidates = abilities.filter(
    (ability) =>
      ability.kind === rule.kind &&
      (!rule.triggerEvent || ability.triggerEvent === rule.triggerEvent) &&
      !ability.declined &&
      ability.steps.length > 0
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

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

export interface CardParseInput {
  cardName: string;
  oracleText: string;
  typeLine: string;
}

const SYSTEM_PROMPT = `You are an MTG rules parser. Return JSON only. Do not change game state.
Break the given card's oracle text into a list of distinct abilities. For EACH ability, classify it:
- kind "triggered": has a "when/whenever/at the beginning of" clause. triggerEvent is REQUIRED on every triggered ability — never omit it or leave it blank. Set it to the closest match from this fixed list — do not invent one:
  etb (enters the battlefield), dies, attacks, upkeep, end_step, beginning_of_combat, combat_damage_to_player, cast (you cast a spell), other (any trigger condition not covered above — still set triggerEvent to the literal string "other", never omit the field).
  Put any extra condition (an "if"/"only if" clause, a restriction) in condition as plain text, verbatim starting from "if"/"only if". A leading condition clause is not by itself a reason to decline or skip steps — still translate the rest of the effect into steps normally; the condition is checked separately at game time before the steps run. Only decline (see below) when the condition itself depends on something that can't be resolved from board state (what happened earlier this resolution, a computed amount, etc.), or when the effect's steps don't map onto the primitive vocabulary.
- kind "activated": has a cost ":" or a cost followed by "," before the effect (e.g. "{2}, T: ..."). Put the cost text in cost.
- kind "static": a continuous effect with no trigger and no activation cost (e.g. "Other creatures you control get +1/+1.").
- kind "keyword": a bare keyword ability with no other text (Flying, Trample, Menace, etc.) — one entry per keyword, text = the keyword, steps = [].
- kind "spell_effect": an Instant or Sorcery's own effect text — what happens when the spell resolves. It has no trigger clause and no activation cost of its own (casting it IS the cost). A modal/instant/sorcery card has exactly one spell_effect ability (even if its text has multiple sentences/clauses) unless it's explicitly modal ("choose one —"), in which case still emit ONE spell_effect ability covering the whole effect. Never classify an Instant/Sorcery's main effect as "triggered" or "static".

For "triggered", "activated", and "spell_effect" abilities, ALSO translate the effect into a sequence of PRIMITIVE steps from this fixed vocabulary — do not invent a kind outside this list:
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
- tap_target { targetType }: taps one target permanent of targetType. untap_target { targetType }: untaps one target permanent of targetType. Only for "tap/untap target X" as the ability's OWN effect (e.g. a triggered ability, or an instant/sorcery's spell_effect) — never use these for an ACTIVATED ability's own cost (its "cost" field already captures "{T}: ..." or "{2}, T: ..." on the source itself — that's not a step).
- pump_target { power, toughness }: one target creature gets +power/+toughness (or negative) until end of turn.
- mass_pump { power, toughness, massPumpScope }: every creature in massPumpScope (all/controlled/opponents) gets +power/+toughness until end of turn.
- mass_bounce {}: return every creature on the battlefield to its owner's hand.
- create_tokens { tokenCount, tokenName, tokenPower, tokenToughness, tokenColors, tokenTypeLine }: create tokenCount tokens.
- put_counters_on_self { counterKind, amount }: put amount counters of counterKind on the source card itself.
- sacrifice_permanent { sacrificeScope }: the caster sacrifices a permanent (self = the source card itself, creature_you_control/permanent_you_control = caster's choice among that type).
- move_card_zone { moveFrom, moveTo, moveFilter, moveCount }: move moveCount cards from moveFrom (hand/graveyard) to moveTo (hand/graveyard/exile/library_top).

Never emit a "search_library" step, or ANY step kind outside the exact list above (no "attach_equipment", no "conditional", no invented kind of any sort) — if even ONE step in an ability's effect has no matching primitive, decline that entire ability (steps=[], declined=true) rather than emitting the steps that DO match plus an invented one for the rest.
If an ability's effect doesn't map cleanly onto this vocabulary (stack manipulation, replacement effects, static/continuous buffs — those belong under kind "static" with steps=[], counterspells, an interactive search, anything conditional you can't resolve from the given text alone), keep its kind as whichever of triggered/activated/static/keyword best describes the ability, set that ability's declined=true, and leave steps=[] — rather than guessing at steps. "declined" is a field, never a kind value: kind must always be exactly one of triggered/activated/static/keyword, even on a declined ability. Only set the top-level declined=true if NOTHING on the card could be classified at all.
Always set each ability's text to the exact clause of oracle text it came from, so a human can audit the parse later.
Set an ability's optional=true if its own text says "you may" before the effect (a real choice the controller gets to make) — false for anything mandatory. Independent of declined: still translate the effect into steps normally either way, optional only marks whether the player gets asked first.
Base the parse solely on the given oracle text — do not infer or recall other abilities the card might have from training data.`;

export interface CardParseResult {
  plan: CardParse;
  model: string;
}

export async function requestCardParse(
  input: CardParseInput,
  baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"
): Promise<CardParseResult> {
  const model = process.env.OLLAMA_RULES_MODEL ?? process.env.OLLAMA_MODEL ?? "qwen2.5:7b-instruct-q5_K_M";
  const userContent = JSON.stringify({ cardName: input.cardName, typeLine: input.typeLine, oracleText: input.oracleText });

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent }
  ];

  // One retry with the validation error appended, per spec Phase 1a point 6 — a small local model
  // occasionally emits a kind/triggerEvent outside the enum or drops a required field; the raw
  // zod error message is usually specific enough for the model to self-correct on a second try.
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const content = await callOllama(baseUrl, model, messages);
      const plan = CardParseSchema.parse(JSON.parse(content));
      // Filter against each ability's own extracted text (more precise than the whole card's
      // oracleText — reduces the odds an unrelated step's keyword happens to appear on a different
      // ability elsewhere on the same card), falling back to the full text only if the model left
      // an ability's text blank.
      const groundedPlan = {
        ...plan,
        declined: deriveCardDeclined(plan.abilities),
        abilities: plan.abilities.map((ability) => ({ ...ability, steps: filterGroundedSteps(ability.steps, ability.text || input.oracleText) }))
      };
      return { plan: groundedPlan, model };
    } catch (error) {
      lastError = error;
      const detail = error instanceof z.ZodError ? JSON.stringify(error.issues) : error instanceof Error ? error.message : String(error);
      messages.push(
        { role: "assistant", content: "(previous response omitted — it failed validation)" },
        { role: "user", content: `That response was invalid: ${detail}\nReturn corrected JSON only, matching the schema.` }
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function callOllama(baseUrl: string, model: string, messages: Array<{ role: string; content: string }>): Promise<string> {
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
            declined: { type: "boolean" },
            abilities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  kind: { type: "string" },
                  triggerEvent: { type: "string" },
                  condition: { type: "string" },
                  cost: { type: "string" },
                  text: { type: "string" },
                  steps: { type: "array", items: PRIMITIVE_ACTION_STEP_JSON_SCHEMA },
                  declined: { type: "boolean" },
                  optional: { type: "boolean" }
                },
                // triggerEvent is only semantically meaningful on kind:"triggered", but marking it
                // required here (rather than just in prose) is what actually gets a small local
                // model to stop omitting it on triggered abilities — a junk/blank value on a
                // non-triggered ability is harmless, lenientEnum coerces it to undefined either way.
                // optional/condition are required for the same reason (condition="" when there is none).
                required: ["kind", "triggerEvent", "optional", "condition"]
              }
            }
          },
          required: ["declined", "abilities"]
        },
        messages
      })
    },
    OLLAMA_CARD_PARSE_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(`Ollama card-parse request failed with HTTP ${response.status}.`);
  }
  const body = await response.json();
  const content = body.message?.content;
  if (typeof content !== "string") {
    throw new Error("Ollama response did not include message.content.");
  }
  return content;
}
