import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestRuleWorkflow } from "@/lib/rulesAdvisor";

const ZoneNameSchema = z.enum(["library", "hand", "battlefield", "graveyard", "exile", "command"]);

const VisibleCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  typeLine: z.string(),
  oracleText: z.string(),
  manaCost: z.string().optional(),
  manaValue: z.number(),
  colors: z.array(z.string()),
  colorIdentity: z.array(z.string()).optional(),
  producedMana: z.array(z.string()).optional(),
  role: z.string(),
  zone: ZoneNameSchema,
  counters: z.array(z.object({ kind: z.string(), count: z.number() })).optional()
});

const RuleCheckRequestSchema = z.object({
  event: z.string().min(1),
  actorName: z.string().min(1),
  sourceCard: VisibleCardSchema,
  battlefield: z.array(VisibleCardSchema).default([]),
  hand: z.array(VisibleCardSchema).default([]),
  graveyard: z.array(VisibleCardSchema).default([]),
  exile: z.array(VisibleCardSchema).default([]),
  libraryPreview: z.array(VisibleCardSchema.pick({ id: true, name: true, typeLine: true, oracleText: true })).default([])
});

export async function POST(request: NextRequest) {
  const input = RuleCheckRequestSchema.parse(await request.json());
  try {
    return NextResponse.json(await requestRuleWorkflow(input));
  } catch (error) {
    return NextResponse.json({
      source: "fallback",
      workflow: {
        workflow: "manual_review",
        summary: error instanceof Error ? `Rules advisor unavailable: ${error.message}` : "Rules advisor unavailable.",
        maxChoices: 0,
        requiresHumanChoice: true,
        warnings: ["Use manual zone movement until the rules advisor is available."]
      }
    });
  }
}
