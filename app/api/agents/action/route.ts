import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestAgentAction } from "@/lib/ollama";
import { knowledgeFilesForPurpose, loadKnowledgePack } from "@/lib/knowledge";
import { scoreLegalActions, type ScoringContext } from "@/lib/actionScoring";

const LegalActionSchema = z.object({
  id: z.string().min(1),
  actionType: z.enum([
    "keep_hand",
    "mulligan",
    "play_land",
    "cast_spell",
    "cast_commander",
    "activate_ability",
    "attack",
    "block",
    "pass_priority",
    "end_turn"
  ]),
  cardId: z.string().optional(),
  targetIds: z.array(z.string()).default([]),
  label: z.string().min(1),
  detail: z.string().optional(),
  role: z.string().optional()
});

const AgentActionRequestSchema = z.object({
  agentName: z.string().min(1),
  seatName: z.string().min(1),
  model: z.string().optional(),
  context: z.unknown(),
  legalActions: z.array(LegalActionSchema).min(1)
});

function toScoringContext(context: unknown): ScoringContext {
  if (typeof context !== "object" || context === null) return {};
  return context as ScoringContext;
}

export async function POST(request: NextRequest) {
  const input = AgentActionRequestSchema.parse(await request.json());
  const legalActionIds = new Set(input.legalActions.map((action) => action.id));
  const scoringContext = toScoringContext(input.context);
  const scoredActions = scoreLegalActions(input.legalActions, scoringContext);

  try {
    const knowledge = await loadKnowledgePack(knowledgeFilesForPurpose(scoringContext.purpose));
    // Only the two consequential decision points get asked to deliberate at length — attack/block
    // declarations are already fairly mechanical and there can be many of them per turn, so asking
    // for a full internal argument there would slow the game down for little benefit with a small
    // local model.
    const wantsDeliberation = scoringContext.purpose === "main_phase" || scoringContext.purpose === "priority_response";
    const system = [
      knowledge,
      [
        "You are a Magic: The Gathering Commander player controlling one agent seat.",
        "Choose exactly one legal action from the supplied legalActions list.",
        "Do not invent card IDs, targets, mana, zones, or actions.",
        "legalActions are pre-sorted by a deterministic heuristic score (higher = generally better);",
        "prefer higher-scored actions unless multiplayer politics, threat assessment, or immediate-win",
        "prevention clearly favor a different legal action.",
        "Return JSON only. Set legalActionId to the chosen legalActions.id.",
        "Prefer legal, useful plays, but pass when no action improves your position."
      ].join("\n"),
      wantsDeliberation
        ? [
            "Before deciding, argue with yourself: pick out the 2-3 legalActions genuinely worth considering",
            "(not every option — skip the obviously bad ones), and for each one write 1-2 sentences on what it",
            "accomplishes and what it costs, risks, or gives up (tempo, a card, exposing yourself to a blowout,",
            "provoking an opponent, ...). Weigh them against each other, then say which one wins the argument",
            "and why. Put this full internal argument in `deliberation` (plain text, a few sentences per option",
            "is fine). Then set legalActionId to whichever action you actually decided on, and give a short",
            "one-sentence `reason` summarizing the final call — deliberation is the working-out, reason is the verdict."
          ].join("\n")
        : undefined
    ]
      .filter(Boolean)
      .join("\n\n---\n\n");

    const action = await requestAgentAction({
      model: input.model ?? agentModelName(input.agentName),
      system,
      prompt: JSON.stringify({
        seatName: input.seatName,
        context: input.context,
        legalActions: scoredActions
      }),
      requireDeliberation: wantsDeliberation
    });

    if (!action.legalActionId || !legalActionIds.has(action.legalActionId)) {
      return NextResponse.json({
        source: "invalid",
        message: "Agent chose an action that was not in the legal action list.",
        action: fallbackAction(scoredActions, "Invalid LLM action; using fallback.")
      });
    }

    return NextResponse.json({ source: "ollama", action });
  } catch (error) {
    const message =
      error instanceof Error
        ? `Ollama is unavailable or returned an invalid decision: ${error.message}. Used deterministic fallback.`
        : "Ollama is unavailable. Used deterministic fallback.";
    return NextResponse.json({
      source: "fallback",
      message,
      action: fallbackAction(scoredActions, "Ollama unavailable; using deterministic fallback.")
    });
  }
}

function fallbackAction(scoredActions: ReturnType<typeof scoreLegalActions>, reason: string) {
  const preferred = scoredActions[0];

  return {
    actionType: preferred.actionType,
    legalActionId: preferred.id,
    targetIds: preferred.targetIds,
    cardId: preferred.cardId,
    reason,
    fallbackAction: preferred.actionType === "end_turn" ? "end_turn" : "pass_priority"
  };
}

function agentModelName(agentName: string) {
  return `mtg-${agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
