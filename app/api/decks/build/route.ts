import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createDeckFromCards } from "@/lib/deckParser";
import { requestCommanderDeck } from "@/lib/ollama";
import { createSampleDeck } from "@/lib/sampleDecks";

const BuildDeckRequestSchema = z.object({
  agentName: z.string().min(1),
  commander: z.string().min(1),
  colors: z.array(z.enum(["W", "U", "B", "R", "G"])).default([])
});

export async function POST(request: NextRequest) {
  const input = BuildDeckRequestSchema.parse(await request.json());

  try {
    const generated = await requestCommanderDeck({
      ...input,
      model: process.env.OLLAMA_MODEL ?? agentModelName(input.agentName)
    });
    const deck = createDeckFromCards({
      owner: input.agentName,
      commander: generated.commander || input.commander,
      colors: generated.colors.length > 0 ? generated.colors : input.colors,
      cards: generated.cards,
      name: `${generated.commander || input.commander} Ollama Deck`
    });

    if (!deck.validation.legal) {
      return NextResponse.json({
        source: "ollama-invalid",
        message: deck.validation.errors[0] ?? "Ollama returned a deck that needs fixes.",
        notes: generated.notes,
        deck
      });
    }

    return NextResponse.json({
      source: "ollama",
      message: generated.notes ?? "Ollama built and validated this Bracket 3 deck.",
      deck
    });
  } catch (error) {
    const fallback = createSampleDeck(input.agentName, input.commander, input.colors);
    return NextResponse.json({
      source: "fallback",
      message:
        error instanceof Error
          ? `Ollama is unavailable or returned invalid JSON: ${error.message}. Used local role-based fallback.`
          : "Ollama is unavailable. Used local role-based fallback.",
      deck: fallback
    });
  }
}

function agentModelName(agentName: string) {
  return `mtg-${agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
