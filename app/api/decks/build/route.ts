import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createDeckFromCards } from "@/lib/deckParser";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import { requestCommanderDeck } from "@/lib/ollama";
import { createSampleDeck } from "@/lib/sampleDecks";
import { createDeckFromList } from "@/lib/deckParser";
import { repairCommanderDeckCards } from "@/lib/deckRepair";
import { fetchEdhrecSynergyData } from "@/lib/edhrec";
import { knowledgeFilesForPurpose, loadKnowledgePack } from "@/lib/knowledge";

const BuildDeckRequestSchema = z.object({
  agentName: z.string().min(1),
  commander: z.string().min(1),
  colors: z.array(z.enum(["W", "U", "B", "R", "G"])).default([]),
  deckList: z.string().optional()
});

export async function POST(request: NextRequest) {
  const input = BuildDeckRequestSchema.parse(await request.json());
  const catalog = loadCardCatalog();
  const lookup = { lookup: (name: string) => lookupCard(catalog, name) };

  if (input.deckList?.trim()) {
    const deck = createDeckFromList({
      owner: input.agentName,
      commander: input.commander,
      deckList: input.deckList,
      colors: input.colors,
      catalog: lookup
    });

    return NextResponse.json({
      source: "decklist",
      catalog: {
        source: catalog.source,
        cardCount: catalog.cards.length,
        loadedAt: catalog.loadedAt
      },
      message: deck.validation.legal ? "Deck list is legal and enriched with real card data." : deck.validation.errors[0] ?? "Deck needs fixes.",
      deck
    });
  }

  // The commander's real color identity, looked up from the local card catalog, is the ground
  // truth from here on — never the client's naive name-based color guess, and never whatever an
  // LLM echoes back for "commander"/"colors". A small local model has no reliable way to know e.g.
  // that The Ur-Dragon is WUBRG rather than "dragon = red", and trusting its answer (or failing to
  // look the card up because it mangled the name slightly) is what used to produce a five-color
  // commander whose deck was padded with 28 Basic Mountains.
  const commanderRecord = lookupCard(catalog, input.commander);
  const commander = commanderRecord?.name ?? input.commander;
  const colors = commanderRecord && commanderRecord.colorIdentity.length > 0 ? commanderRecord.colorIdentity : input.colors;
  const synergyData = await fetchEdhrecSynergyData(commander);

  try {
    const knowledge = await loadKnowledgePack(knowledgeFilesForPurpose("deckbuilding"));
    const generated = await requestCommanderDeck({
      ...input,
      commander,
      colors,
      model: process.env.OLLAMA_MODEL ?? agentModelName(input.agentName),
      synergyCardNames: synergyData?.cards.slice(0, 40).map((card) => card.name),
      knowledge
    });
    const cards = repairCommanderDeckCards({
      commander,
      colors,
      cards: generated.cards,
      catalog: lookup,
      synergyCards: synergyData?.cards
    });
    const deck = createDeckFromCards({
      owner: input.agentName,
      commander,
      colors,
      cards,
      name: `${commander} Ollama Deck`,
      catalog: lookup
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
      catalog: {
        source: catalog.source,
        cardCount: catalog.cards.length,
        loadedAt: catalog.loadedAt
      },
      deck
    });
  } catch (error) {
    const fallback = createSampleDeck(input.agentName, commander, colors, lookup);
    const cards = repairCommanderDeckCards({
      commander: fallback.commander,
      colors: fallback.colors,
      cards: fallback.cards,
      catalog: lookup,
      synergyCards: synergyData?.cards
    });
    const deck = createDeckFromCards({
      owner: fallback.createdBy,
      commander: fallback.commander,
      colors: fallback.colors,
      cards,
      name: fallback.name,
      catalog: lookup
    });
    return NextResponse.json({
      source: "fallback",
      message:
        error instanceof Error
          ? `Ollama is unavailable or returned invalid JSON: ${error.message}. Used local role-based fallback.`
          : "Ollama is unavailable. Used local role-based fallback.",
      catalog: {
        source: catalog.source,
        cardCount: catalog.cards.length,
        loadedAt: catalog.loadedAt
      },
      deck
    });
  }
}

function agentModelName(agentName: string) {
  return `mtg-${agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
