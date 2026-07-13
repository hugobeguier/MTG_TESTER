import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import { createDeckFromCards, createDeckFromList } from "@/lib/deckParser";
import { createSampleDeck } from "@/lib/sampleDecks";

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
  const catalogInfo = {
    source: catalog.source,
    cardCount: catalog.cards.length,
    loadedAt: catalog.loadedAt
  };

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
      catalog: catalogInfo,
      message: deck.validation.legal ? "Deck list is legal and enriched with real card data." : deck.validation.errors[0] ?? "Deck needs fixes.",
      deck
    });
  }

  const commander = lookup.lookup(input.commander)?.name ?? input.commander;
  try {
    const cards = await fetchEdhrecAverageDeck(commander);
    const deck = createDeckFromList({
      owner: input.agentName,
      commander,
      deckList: cards.join("\n"),
      colors: input.colors,
      catalog: lookup
    });

    return NextResponse.json({
      source: "edhrec",
      catalog: catalogInfo,
      message: deck.validation.legal
        ? `Grabbed the EDHREC average deck for ${commander}.`
        : deck.validation.errors[0] ?? "EDHREC deck needs fixes.",
      deck
    });
  } catch (error) {
    const fallback = createSampleDeck(input.agentName, commander, input.colors);
    const deck = createDeckFromCards({
      owner: fallback.createdBy,
      commander: fallback.commander,
      colors: fallback.colors,
      cards: fallback.cards,
      name: fallback.name,
      catalog: lookup
    });
    return NextResponse.json({
      source: "fallback",
      message:
        error instanceof Error
          ? `EDHREC lookup failed: ${error.message} Used local role-based fallback.`
          : "EDHREC is unavailable. Used local role-based fallback.",
      catalog: catalogInfo,
      deck
    });
  }
}

// EDHREC's average deck endpoint returns { deck: ["1 Card Name", ...] } — a ready deck list.
async function fetchEdhrecAverageDeck(commander: string): Promise<string[]> {
  const slug = edhrecSlug(commander);
  const response = await fetch(`https://json.edhrec.com/pages/average-decks/${slug}.json`, {
    headers: { "user-agent": "MTG-AI Commander Lab/0.1" }
  });
  if (!response.ok) {
    throw new Error(`EDHREC returned HTTP ${response.status} for "${slug}".`);
  }
  const body = (await response.json()) as { deck?: string[] };
  if (!Array.isArray(body.deck) || body.deck.length === 0) {
    throw new Error(`EDHREC page for "${slug}" had no average deck list.`);
  }
  return body.deck;
}

function edhrecSlug(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/["',.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
