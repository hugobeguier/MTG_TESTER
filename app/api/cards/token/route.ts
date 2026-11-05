import { NextResponse } from "next/server";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pickTokenPrinting, tokenArtLookupKey, tokenSearchQuery, type TokenCandidate } from "@/lib/tokenArt";
import type { CardImageUris } from "@/lib/types";

// GET /api/cards/token?name=Servo%20Token&power=1&toughness=1&colors=&typeLine=...&text=...  -> { imageUris } (cached on disk; Scryfall asked at most once per token)
const CACHE_PATH = path.join(process.cwd(), "data", "token-art.json");

function readCache(): Record<string, CardImageUris | null> {
  try {
    return existsSync(CACHE_PATH) ? (JSON.parse(readFileSync(CACHE_PATH, "utf8")) as Record<string, CardImageUris | null>) : {};
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, CardImageUris | null>) {
  try {
    mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(cache));
  } catch {
    // a read-only deploy just loses the disk cache
  }
}

// Every printing of the token name (unique=prints so same-art/different-text variants such as the two Pests are all present), up to 3 pages.
async function searchScryfall(query: string): Promise<TokenCandidate[]> {
  const out: TokenCandidate[] = [];
  let next: string | undefined = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=released&dir=desc`;
  for (let page = 0; next && page < 3; page += 1) {
    const response: Response = await fetch(next, { headers: { "User-Agent": "MTG-AI-Commander-Lab/1.0", Accept: "application/json" } });
    if (!response.ok) break;
    const body = (await response.json()) as { data?: TokenCandidate[]; has_more?: boolean; next_page?: string };
    out.push(...(body.data ?? []));
    next = body.has_more ? body.next_page : undefined;
  }
  return out;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const name = url.searchParams.get("name") ?? "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const card = { name, power: url.searchParams.get("power") ?? undefined, toughness: url.searchParams.get("toughness") ?? undefined, typeLine: url.searchParams.get("typeLine") ?? undefined, oracleText: url.searchParams.get("text") ?? undefined, colors: (url.searchParams.get("colors") ?? "").split("").filter(Boolean) };
  const key = tokenArtLookupKey(card);
  const cache = readCache();
  if (key in cache) return NextResponse.json({ imageUris: cache[key] ?? undefined });
  try {
    const found = pickTokenPrinting(card, await searchScryfall(tokenSearchQuery(card, false)));
    cache[key] = found ?? null;
    writeCache(cache);
    return NextResponse.json({ imageUris: found });
  } catch {
    return NextResponse.json({ imageUris: undefined });
  }
}
