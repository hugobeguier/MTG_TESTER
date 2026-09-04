import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestCardParse } from "@/lib/cardParser";
import { getCardByOracleId, getCardByName, getParsedCard, saveParsedCard, getParseStats } from "@/lib/cardDb";

export async function GET() {
  return NextResponse.json(getParseStats());
}

const ParseCardRequestSchema = z.object({
  oracleId: z.string().optional(),
  name: z.string().optional(),
  // --dry-run from scripts/parse-cards.mjs: run the LLM call and validate it, but never write to
  // parsed_cards — for prompt-tuning against a small sample before a real (cache-writing) run.
  dryRun: z.boolean().default(false),
  // Re-parse even if a cache entry already exists (skipped for manual_override entries regardless
  // — see saveParsedCard's own guard in cardDb.ts).
  force: z.boolean().default(false)
});

export async function POST(request: NextRequest) {
  const input = ParseCardRequestSchema.parse(await request.json());
  if (!input.oracleId && !input.name) {
    return NextResponse.json({ status: "error", error: "Provide oracleId or name." }, { status: 400 });
  }

  const card = input.oracleId ? getCardByOracleId(input.oracleId) : getCardByName(input.name!);
  if (!card) {
    return NextResponse.json({ status: "error", error: `Card not found: ${input.oracleId ?? input.name}` }, { status: 404 });
  }

  if (!card.oracleText.trim()) {
    return NextResponse.json({ status: "skipped_vanilla", oracleId: card.oracleId, cardName: card.name });
  }

  if (!input.force && !input.dryRun) {
    const cached = getParsedCard(card.oracleId);
    if (cached) {
      return NextResponse.json({ status: "cached", oracleId: cached.oracleId, cardName: cached.cardName, parseStatus: cached.parseStatus, source: cached.source });
    }
  }

  try {
    const { plan, model } = await requestCardParse({ cardName: card.name, oracleText: card.oracleText, typeLine: card.typeLine });
    const parseStatus = plan.declined ? "declined" : "ok";
    if (!input.dryRun) {
      saveParsedCard({ oracleId: card.oracleId, cardName: card.name, parseStatus, source: "llm_parsed", model, abilities: plan.abilities });
    }
    return NextResponse.json({ status: input.dryRun ? "dry_run" : "parsed", oracleId: card.oracleId, cardName: card.name, parseStatus, plan, model });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!input.dryRun) {
      saveParsedCard({ oracleId: card.oracleId, cardName: card.name, parseStatus: "failed", source: "llm_parsed", abilities: [], error: message });
    }
    // 200, not 500 — same safe-degrade convention as /api/rules/primitive-plan: a failed parse is
    // expected/loggable batch-job output, not a server error the caller needs a separate branch for.
    return NextResponse.json({ status: "failed", oracleId: card.oracleId, cardName: card.name, error: message });
  }
}
