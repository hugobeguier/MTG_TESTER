import { z } from "zod";
import type { VisibleCard } from "./types";
import { deathEffectText, etbEffectText } from "./oracleClauses";
import { ollamaFetch, OLLAMA_TIMEOUT_MS } from "./ollama";

const DestinationSchema = z.preprocess((value) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" && (value.trim() === "" || value.trim().toLowerCase() === "none")) return undefined;
  return value;
}, z.enum(["hand", "battlefield", "graveyard", "exile", "library"]).optional());

export const RuleWorkflowSchema = z.object({
  workflow: z.enum([
    "none",
    "search_basic_lands_shared_type_to_battlefield_tapped",
    "search_library_to_hand",
    "search_library_to_battlefield",
    "search_library_to_graveyard",
    "draw_cards",
    "scry_cards",
    "surveil_cards",
    "look_at_top_cards",
    "reorder_top_cards",
    "move_card_between_zones",
    "proliferate",
    "manual_review"
  ]),
  summary: z.string().min(1),
  sourceCardId: z.string().optional(),
  maxChoices: z.number().int().min(0).max(20).default(0),
  allowedCardFilter: z.string().optional(),
  destination: DestinationSchema,
  tapped: z.boolean().optional(),
  requiresHumanChoice: z.boolean().default(true),
  warnings: z.array(z.string()).default([])
});

export type RuleWorkflow = z.infer<typeof RuleWorkflowSchema>;

export interface RuleAdvisorInput {
  event: string;
  actorName: string;
  sourceCard: VisibleCard;
  battlefield: VisibleCard[];
  hand: VisibleCard[];
  graveyard: VisibleCard[];
  exile: VisibleCard[];
  libraryPreview: Array<Pick<VisibleCard, "id" | "name" | "typeLine" | "oracleText">>;
}

export function deterministicRuleWorkflow(input: RuleAdvisorInput): RuleWorkflow | undefined {
  const text = input.sourceCard.oracleText.toLowerCase();
  if (isUpkeepTriggeredText(text) && !input.event.includes("upkeep")) {
    return {
      workflow: "none",
      summary: `${input.sourceCard.name} has an upkeep trigger; no workflow is needed for ${input.event}.`,
      sourceCardId: input.sourceCard.id,
      maxChoices: 0,
      requiresHumanChoice: false,
      warnings: []
    };
  }

  if (input.event.includes("upkeep") && text.includes("cumulative upkeep")) {
    return {
      workflow: "manual_review",
      summary: `${input.sourceCard.name} has cumulative upkeep. Choose whether to pay its upkeep cost or sacrifice it.`,
      sourceCardId: input.sourceCard.id,
      maxChoices: 1,
      requiresHumanChoice: true,
      warnings: ["Cumulative upkeep payment is surfaced for manual handling until pay-or-sacrifice choices are implemented."]
    };
  }

  // A land whose entire text is just its tapped-entry condition plus a mana ability (e.g. check
  // lands, most tap-lands) has nothing left for the advisor to do — that condition is already
  // evaluated automatically. Lands with a genuine extra trigger (Bojuka Bog's exile, Halimar
  // Depths' reorder, ...) have a line that doesn't match either shape, so they fall through as before.
  if (isOnlyTappedConditionText(input.sourceCard.oracleText)) {
    return {
      workflow: "none",
      summary: `${input.sourceCard.name}'s tapped-entry condition is evaluated automatically; no additional workflow is needed.`,
      sourceCardId: input.sourceCard.id,
      maxChoices: 0,
      requiresHumanChoice: false,
      warnings: []
    };
  }

  // For an ETB or "dies" event, only the clause(s) actually gated by that trigger apply — a
  // sacrifice-cost or dies-triggered ability elsewhere in the same oracle text (e.g. Mind Stone's
  // "{1}, {T}, Sacrifice this artifact: Draw a card." or Solemn Simulacrum's "When this creature
  // dies, you may draw a card.") must not be read as something that happens on entering.
  const scopedText = eventRelevantOracleText(input.event, input.sourceCard.oracleText).toLowerCase();
  const isEtbOrDeathEvent =
    input.event === "land_played" || input.event === "spell_resolved_to_battlefield" || input.event === "card_moved_to_graveyard";
  if (isEtbOrDeathEvent && !scopedText.trim()) {
    return {
      workflow: "none",
      summary: `${input.sourceCard.name} has no clause relevant to ${input.event}; no workflow is needed.`,
      sourceCardId: input.sourceCard.id,
      maxChoices: 0,
      requiresHumanChoice: false,
      warnings: []
    };
  }

  if (scopedText.includes("proliferate")) {
    return {
      workflow: "proliferate",
      summary: `${input.sourceCard.name} instructs ${input.actorName} to proliferate.`,
      sourceCardId: input.sourceCard.id,
      maxChoices: 0,
      requiresHumanChoice: false,
      warnings: extractDrawCount(scopedText) ? [`${input.sourceCard.name} also draws a card after this resolves; that follow-up draw is not yet automated.`] : []
    };
  }

  const scryCount = extractKeywordCount(scopedText, "scry");
  if (scryCount) {
    return {
      workflow: "scry_cards",
      summary: `${input.sourceCard.name} instructs ${input.actorName} to scry ${scryCount}.`,
      sourceCardId: input.sourceCard.id,
      maxChoices: scryCount,
      requiresHumanChoice: true,
      warnings: []
    };
  }

  const surveilCount = extractKeywordCount(scopedText, "surveil");
  if (surveilCount) {
    return {
      workflow: "surveil_cards",
      summary: `${input.sourceCard.name} instructs ${input.actorName} to surveil ${surveilCount}.`,
      sourceCardId: input.sourceCard.id,
      maxChoices: surveilCount,
      requiresHumanChoice: true,
      warnings: []
    };
  }

  // Checked before the plain draw count below: a card that both reorders its top cards and
  // later says "draw a card" (e.g. Ponder) must not be short-circuited into just drawing.
  const lookCount = extractLookAtTopCount(scopedText);
  if (lookCount && (scopedText.includes("put them back in any order") || scopedText.includes("put those cards back in any order"))) {
    return {
      workflow: "reorder_top_cards",
      summary: `${input.sourceCard.name} instructs ${input.actorName} to look at the top ${lookCount} card${lookCount === 1 ? "" : "s"} and put them back in any order.`,
      sourceCardId: input.sourceCard.id,
      maxChoices: lookCount,
      requiresHumanChoice: true,
      warnings: extractDrawCount(scopedText) ? [`${input.sourceCard.name} also draws a card after this resolves; that follow-up draw is not yet automated.`] : []
    };
  }

  if (lookCount) {
    return {
      workflow: "look_at_top_cards",
      summary: `${input.sourceCard.name} instructs ${input.actorName} to look at the top ${lookCount} card${lookCount === 1 ? "" : "s"} of their library.`,
      sourceCardId: input.sourceCard.id,
      maxChoices: lookCount,
      requiresHumanChoice: true,
      warnings: ["This opens a look window; exact follow-up placement still needs a specific workflow."]
    };
  }

  const drawCount = extractDrawCount(scopedText);
  if (drawCount) {
    return {
      workflow: "draw_cards",
      summary: `${input.sourceCard.name} instructs ${input.actorName} to draw ${drawCount} card${drawCount === 1 ? "" : "s"}.`,
      sourceCardId: input.sourceCard.id,
      maxChoices: drawCount,
      requiresHumanChoice: false,
      warnings: []
    };
  }

  if (
    (input.event.includes("activated") && input.sourceCard.name === "Myriad Landscape") ||
    (input.sourceCard.name !== "Myriad Landscape" &&
      scopedText.includes("search your library") &&
      scopedText.includes("two basic land") &&
      scopedText.includes("share a land type"))
  ) {
    return {
      workflow: "search_basic_lands_shared_type_to_battlefield_tapped",
      summary: `${input.sourceCard.name} can search for up to two basic lands sharing a land type and put them onto the battlefield tapped.`,
      sourceCardId: input.sourceCard.id,
      maxChoices: 2,
      allowedCardFilter: "basic lands sharing a land type",
      destination: "battlefield",
      tapped: true,
      requiresHumanChoice: true,
      warnings: []
    };
  }

  // "Search your library for a card, put that card into your graveyard, then shuffle." (Entomb,
  // Buried Alive, ...) — checked before the to-hand/to-battlefield branches below since those two
  // would otherwise never match this shape anyway (neither "hand" nor "battlefield" appears), but
  // ordering it first keeps the graveyard-destination intent unambiguous if a future card's text
  // happens to mention more than one zone.
  if (scopedText.includes("search your library") && scopedText.includes("put") && scopedText.includes("graveyard")) {
    return {
      workflow: "search_library_to_graveyard",
      summary: `${input.sourceCard.name} can search the library for a card and put it into the graveyard.`,
      sourceCardId: input.sourceCard.id,
      maxChoices: 1,
      allowedCardFilter: "cards matching the source effect",
      destination: "graveyard",
      requiresHumanChoice: true,
      warnings: ["Exact card restrictions may need manual review."]
    };
  }

  if (scopedText.includes("search your library") && scopedText.includes("put") && scopedText.includes("hand")) {
    return {
      workflow: "search_library_to_hand",
      summary: `${input.sourceCard.name} can search the library for a card and put it into hand.`,
      sourceCardId: input.sourceCard.id,
      maxChoices: 1,
      allowedCardFilter: "cards matching the source effect",
      destination: "hand",
      requiresHumanChoice: true,
      warnings: ["Exact card restrictions may need manual review."]
    };
  }

  if (
    scopedText.includes("search your library") &&
    (scopedText.includes("put") || scopedText.includes("onto the battlefield")) &&
    scopedText.includes("battlefield")
  ) {
    return {
      workflow: "search_library_to_battlefield",
      summary: `${input.sourceCard.name} can search the library and put a card onto the battlefield.`,
      sourceCardId: input.sourceCard.id,
      maxChoices: 1,
      allowedCardFilter: "cards matching the source effect",
      destination: "battlefield",
      tapped: scopedText.includes("tapped"),
      requiresHumanChoice: true,
      warnings: ["Exact card restrictions may need manual review."]
    };
  }

  return undefined;
}

// "land_played"/"spell_resolved_to_battlefield" are ETB-shaped; "card_moved_to_graveyard" is a
// death event. Everything else (an instant/sorcery resolving, a loyalty ability's own text, a
// phase trigger already isolated by its caller, ...) keeps using the full oracle text, since
// there's no single later-gated clause to strip out of those.
function eventRelevantOracleText(event: string, oracleText: string): string {
  if (event === "land_played" || event === "spell_resolved_to_battlefield") return etbEffectText(oracleText);
  if (event === "card_moved_to_graveyard") return deathEffectText(oracleText);
  return oracleText;
}

function isUpkeepTriggeredText(text: string) {
  return text.includes("at the beginning of your upkeep") || text.includes("at the beginning of each upkeep");
}

function isOnlyTappedConditionText(oracleText: string): boolean {
  const lines = oracleText
    .toLowerCase()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;
  return lines.every(
    (line) => /\bthis land enters (?:the battlefield )?tapped\b/.test(line) || /^\{t\}/.test(line)
  );
}

function extractKeywordCount(text: string, keyword: "scry" | "surveil") {
  const match = text.match(new RegExp(`\\b${keyword}\\s+(x|\\d+|one|two|three|four|five|six|seven|eight|nine|ten)\\b`));
  return match ? numberWordToInt(match[1]) : undefined;
}

function extractDrawCount(text: string) {
  const match = text.match(/\bdraw\s+(a|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\b/);
  if (match) return numberWordToInt(match[1]);
  if (/\bdraw a card\b/.test(text)) return 1;
  return undefined;
}

function extractLookAtTopCount(text: string) {
  const match = text.match(/\blook at the top\s+(x|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\b/);
  return match ? numberWordToInt(match[1]) : undefined;
}

function numberWordToInt(value?: string) {
  if (!value || value === "x") return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) return parsed;
  return (
    {
      a: 1,
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10
    } as Record<string, number>
  )[value];
}

export async function requestRuleWorkflow(input: RuleAdvisorInput, baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434") {
  const deterministic = deterministicRuleWorkflow(input);
  if (deterministic) return { source: "deterministic" as const, workflow: deterministic };

  // Scope the oracle text the same way the deterministic pass does, so the LLM fallback can't
  // reintroduce the same "dies"/activated-ability-cost misread the deterministic layer avoids.
  const scopedInput = {
    ...input,
    sourceCard: { ...input.sourceCard, oracleText: eventRelevantOracleText(input.event, input.sourceCard.oracleText) }
  };

  const model = process.env.OLLAMA_RULES_MODEL ?? process.env.OLLAMA_MODEL ?? "llama3.2";
  const response = await ollamaFetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: {
        type: "object",
        properties: {
          workflow: { type: "string" },
          summary: { type: "string" },
          sourceCardId: { type: "string" },
          maxChoices: { type: "number" },
          allowedCardFilter: { type: "string" },
          destination: { type: "string" },
          tapped: { type: "boolean" },
          requiresHumanChoice: { type: "boolean" },
          warnings: { type: "array", items: { type: "string" } }
        },
        required: ["workflow", "summary", "requiresHumanChoice", "warnings"]
      },
      messages: [
        {
          role: "system",
          content:
            "You are an MTG rules workflow classifier. Return JSON only. Do not change game state. Classify what UI workflow is needed for the source card effect using the supplied battlefield, hand, graveyard, exile, and library preview. The sourceCard's oracleText has already been trimmed to only the clause relevant to this event — do not infer or recall other abilities the card might have from training data; classify based solely on the given text. Use scry_cards for scry N, surveil_cards for surveil N, draw_cards for draw N, look_at_top_cards for effects that only look at top N cards, reorder_top_cards for effects that look at top N cards and put them back in any order, search_library_to_hand/search_library_to_battlefield/search_library_to_graveyard for library search effects depending on which zone the found card actually goes to (never open a search of the graveyard itself — the search always happens in the library; the destination is just where the found card ends up). Put N in maxChoices. Prefer manual_review if unsure."
        },
        {
          role: "user",
          content: JSON.stringify(scopedInput)
        }
      ]
    })
  }, OLLAMA_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`Ollama rules request failed with HTTP ${response.status}.`);
  }

  const body = await response.json();
  const content = body.message?.content;
  if (typeof content !== "string") {
    throw new Error("Ollama response did not include message.content.");
  }

  return { source: "ollama" as const, workflow: RuleWorkflowSchema.parse(JSON.parse(content)) };
}
