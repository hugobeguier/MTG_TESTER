import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestAttackTaxWorkflow } from "@/lib/staticEffects";

const StaticEffectRequestSchema = z.object({
  sourceCardId: z.string().min(1),
  sourceCardName: z.string().min(1),
  oracleText: z.string()
});

export async function POST(request: NextRequest) {
  const input = StaticEffectRequestSchema.parse(await request.json());
  try {
    return NextResponse.json(await requestAttackTaxWorkflow(input.sourceCardId, input.sourceCardName, input.oracleText));
  } catch (error) {
    return NextResponse.json({
      source: "fallback",
      effect: undefined,
      error: error instanceof Error ? error.message : "Static-effect interpreter unavailable."
    });
  }
}
