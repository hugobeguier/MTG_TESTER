import { NextResponse } from "next/server";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tokenSearchQuery } from "@/lib/tokenArt";
import type { CardImageUris } from "@/lib/types";

// GET /api/cards/token?name=Servo%20Token&power=1&toughness=1&colors=  -> { imageUris } (cached on disk; Scryfall asked at most once per token)
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

async function searchScryfall(query: string): Promise<CardImageUris | undefined> {
  const response = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=art&order=released&dir=desc`, {
    headers: { "User-Agent": "MTG-AI-Commander-Lab/1.0", Accept: "application/json" }
  });
  if (!response.ok) return undefined;
  const body = (await response.json()) as { data?: Array<{ image_uris?: Record<string, string> }> };
  const uris = body.data?.find((card) => card.image_uris?.normal)?.image_uris;
  return uris ? { small: uris.small, normal: uris.normal, large: uris.large, png: uris.png, artCrop: uris.art_crop, borderCrop: uris.border_crop } as CardImageUris : undefined;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const name = url.searchParams.get("name") ?? "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const card = { name, power: url.searchParams.get("power") ?? undefined, toughness: url.searchParams.get("toughness") ?? undefined, colors: (url.searchParams.get("colors") ?? "").split("").filter(Boolean) };
  const key = `${name}|${card.power ?? ""}/${card.toughness ?? ""}|${card.colors.join("")}`;
  const cache = readCache();
  if (key in cache) return NextResponse.json({ imageUris: cache[key] ?? undefined });
  try {
    const found = (await searchScryfall(tokenSearchQuery(card, true))) ?? (await searchScryfall(tokenSearchQuery(card, false)));
    cache[key] = found ?? null;
    writeCache(cache);
    return NextResponse.json({ imageUris: found });
  } catch {
    return NextResponse.json({ imageUris: undefined });
  }
}
