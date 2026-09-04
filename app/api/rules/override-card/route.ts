import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AbilitySchema, deriveCardDeclined } from "@/lib/cardParser";
import { getCardByOracleId, getCardByName, getParsedCard, saveParsedCard } from "@/lib/cardDb";

// Phase 1, point 6 of mtg-commander-engine-spec.md — a human-correction path for a bad cached
// parse. saveParsedCard already refuses to let a bulk llm_parsed re-run clobber a manual_override
// entry (cardDb.ts); this route is the missing other half — the only place that ever actually
// writes source: "manual_override". GET first (or scripts/override-card.mjs --show) to see the
// card's oracle text and current cached parse as a starting point, then POST the corrected
// abilities array back.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const oracleId = searchParams.get("oracleId") ?? undefined;
  const name = searchParams.get("name") ?? undefined;
  if (!oracleId && !name) {
    return NextResponse.json({ status: "error", error: "Provide oracleId or name." }, { status: 400 });
  }

  const card = oracleId ? getCardByOracleId(oracleId) : getCardByName(name!);
  if (!card) {
    return NextResponse.json({ status: "error", error: `Card not found: ${oracleId ?? name}` }, { status: 404 });
  }

  const cached = getParsedCard(card.oracleId);
  return NextResponse.json({
    oracleId: card.oracleId,
    cardName: card.name,
    typeLine: card.typeLine,
    oracleText: card.oracleText,
    cached: cached ?? null
  });
}

const OverrideCardRequestSchema = z.object({
  oracleId: z.string().optional(),
  name: z.string().optional(),
  abilities: z.array(AbilitySchema).min(1)
});

export async function POST(request: NextRequest) {
  const input = OverrideCardRequestSchema.parse(await request.json());
  if (!input.oracleId && !input.name) {
    return NextResponse.json({ status: "error", error: "Provide oracleId or name." }, { status: 400 });
  }

  const card = input.oracleId ? getCardByOracleId(input.oracleId) : getCardByName(input.name!);
  if (!card) {
    return NextResponse.json({ status: "error", error: `Card not found: ${input.oracleId ?? input.name}` }, { status: 404 });
  }

  const parseStatus = deriveCardDeclined(input.abilities) ? "declined" : "ok";
  saveParsedCard({ oracleId: card.oracleId, cardName: card.name, parseStatus, source: "manual_override", abilities: input.abilities });
  return NextResponse.json({ status: "saved", oracleId: card.oracleId, cardName: card.name, parseStatus, source: "manual_override" });
}
