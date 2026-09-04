import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestPrimitiveActionPlan } from "@/lib/primitiveActionPlan";
import { matchAbilityForEvent } from "@/lib/cardParser";
import { getCardByName, getParsedCard } from "@/lib/cardDb";

const PrimitivePlanRequestSchema = z.object({
  cardName: z.string().min(1),
  oracleText: z.string(),
  actorName: z.string().min(1),
  battlefieldSummary: z.array(z.string()).default([]),
  handSummary: z.array(z.string()).default([]),
  graveyardSummary: z.array(z.string()).default([]),
  // Optional: which of AppFlow.tsx's consultRulesAdvisor event strings triggered this call — lets
  // this route try the parsed_cards cache (cardDb.ts/cardParser.ts) before ever calling Ollama.
  // Omitted or unrecognized just skips straight to the live call, same as before this existed.
  event: z.string().optional()
});

export async function POST(request: NextRequest) {
  const input = PrimitivePlanRequestSchema.parse(await request.json());

  if (input.event) {
    const cacheHit = tryCache(input.cardName, input.event);
    if (cacheHit) return NextResponse.json(cacheHit);
  }

  try {
    return NextResponse.json(await requestPrimitiveActionPlan(input));
  } catch (error) {
    // Same safe-degrade shape as /api/rules/check — a declined plan (no steps) rather than a 500,
    // so the client never needs a separate "the network call itself failed" branch to reason about.
    return NextResponse.json({
      source: "fallback",
      plan: {
        summary: error instanceof Error ? `Primitive-action planner unavailable: ${error.message}` : "Primitive-action planner unavailable.",
        declined: true,
        optional: false,
        condition: "",
        steps: []
      }
    });
  }
}

function tryCache(cardName: string, event: string) {
  const card = getCardByName(cardName);
  if (!card) return undefined;
  const parsed = getParsedCard(card.oracleId);
  if (!parsed || parsed.parseStatus !== "ok") return undefined;

  const ability = matchAbilityForEvent(event, parsed.abilities);
  if (!ability) return undefined;

  return {
    source: "cache" as const,
    plan: {
      summary: ability.text || `${cardName}: resolved from the pre-parsed cache.`,
      declined: false,
      optional: ability.optional,
      condition: ability.condition,
      steps: ability.steps
    }
  };
}
