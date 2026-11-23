// NODE ONLY (fs, network): collects the Scryfall printings of every token a pack's cards can create and attaches them as `pack.tokenPrintings`.
// Same source and query as the legacy route (app/api/cards/token: api.scryfall.com, `t:token name:"X"`, every printing); the answers are cached on disk in
// data/token-printings.json so a rebuild (and the tests) work offline. Used by `npm run kernel:bundle-drafts`.
import fs from "node:fs";
import path from "node:path";
import { tokenSearchQuery, type TokenCandidate } from "../../lib/tokenArt";
import type { CardPack } from "./cardPack";
import { PREDEFINED_TOKEN_NAMES, printingKey, slimPrinting, tokenNamesOf, type TokenPrintings } from "./tokenArt";

const CACHE = path.resolve(process.cwd(), "data/token-printings.json");

export function loadTokenPrintingsCache(file = CACHE): TokenPrintings {
  try { return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as TokenPrintings) : {}; } catch { return {}; }
}

/** The names of every token a pack can make: its cards' create_tokens steps + the predefined tokens. */
export function packTokenNames(pack: Pick<CardPack, "cards">): string[] {
  const names = new Set<string>(PREDEFINED_TOKEN_NAMES);
  for (const def of Object.values(pack.cards)) for (const n of tokenNamesOf(def.kernel)) names.add(n);
  return [...names].sort();
}

async function fetchPrintings(name: string, fetcher: typeof fetch): Promise<TokenCandidate[]> {
  const out: TokenCandidate[] = [];
  let next: string | undefined = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(tokenSearchQuery({ name, colors: [] }, false))}&unique=prints&order=released&dir=desc`;
  for (let page = 0; next && page < 4; page += 1) {
    const res: Response = await fetcher(next, { headers: { "User-Agent": "MTG-AI-Commander-Lab/1.0", Accept: "application/json" } });
    if (!res.ok) break;
    const body = (await res.json()) as { data?: Array<TokenCandidate & { image_uris?: Record<string, string> }>; has_more?: boolean; next_page?: string };
    for (const c of body.data ?? []) if ((c.name ?? "").toLowerCase() === printingKey(name) && c.image_uris?.normal) out.push(slimPrinting(c));
    next = body.has_more ? body.next_page : undefined;
    await new Promise((r) => setTimeout(r, 120));
  }
  // distinct by what the chooser looks at (newest first is kept), so a pack carries one candidate per face, not one per reprint
  const seen = new Set<string>();
  return out.filter((c) => { const k = [c.oracle_text, (c.colors ?? []).join(""), c.power, c.toughness, c.type_line].join("|"); if (seen.has(k)) return false; seen.add(k); return true; });
}

export interface AttachResult { names: string[]; withArt: string[]; missing: string[]; fetched: number }

/** Fills `pack.tokenPrintings` (cache first, Scryfall for names not cached; a failed request is not cached so the next run retries). */
export async function attachTokenArt(pack: CardPack, o: { cache?: TokenPrintings; cacheFile?: string; fetcher?: typeof fetch; offline?: boolean } = {}): Promise<AttachResult> {
  const cache = o.cache ?? loadTokenPrintingsCache(o.cacheFile);
  const names = packTokenNames(pack);
  let fetched = 0;
  const out: TokenPrintings = {};
  for (const n of names) {
    const k = printingKey(n);
    if (!(k in cache) && !o.offline) {
      try { cache[k] = await fetchPrintings(n, o.fetcher ?? fetch); fetched += 1; } catch { /* offline: leave it uncached */ }
    }
    if (cache[k]?.length) out[k] = cache[k];
  }
  if (fetched) { try { fs.writeFileSync(o.cacheFile ?? CACHE, JSON.stringify(cache)); } catch { /* read-only checkout: no disk cache */ } }
  pack.tokenPrintings = out;
  return { names, withArt: names.filter((n) => out[printingKey(n)]), missing: names.filter((n) => !out[printingKey(n)]), fetched };
}
