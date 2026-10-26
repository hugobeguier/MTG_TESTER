import { NextRequest, NextResponse } from "next/server";
import { loadCardCatalog, normalizeCardName } from "@/lib/cardCatalog";

// Name search over the local card catalog, for the deck editor's "add a card" box.
export async function GET(request: NextRequest) {
  const query = normalizeCardName(request.nextUrl.searchParams.get("q") ?? "");
  if (query.length < 2) return NextResponse.json([]);
  const matches = loadCardCatalog()
    .cards.filter((card) => normalizeCardName(card.name).includes(query))
    .sort((a, b) => {
      const aStarts = normalizeCardName(a.name).startsWith(query) ? 0 : 1;
      const bStarts = normalizeCardName(b.name).startsWith(query) ? 0 : 1;
      return aStarts - bStarts || a.name.length - b.name.length;
    })
    .slice(0, 12)
    .map((card) => ({ name: card.name, typeLine: card.typeLine, manaCost: card.manaCost }));
  return NextResponse.json(matches);
}
