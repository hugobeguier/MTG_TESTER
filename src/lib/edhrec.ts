// Live synergy data from EDHREC's unofficial (but widely used) public JSON endpoint. No API key or
// auth is involved — it's the same JSON the edhrec.com commander page itself fetches client-side.
// This is a best-effort enrichment: any failure (network, timeout, unrecognized shape, unknown
// commander) resolves to `undefined` so callers fall back to the deterministic curated packages
// already used elsewhere in the deck builder, matching this codebase's "decline rather than guess"
// pattern rather than surfacing a hard error over a missing nice-to-have.

const EDHREC_FETCH_TIMEOUT_MS = 5000;

// EDHREC groups a commander's page into named card lists; these are the ones worth pulling
// deck-building candidates from, in priority order. "newcards" (too unproven) and "gamechangers"
// (handled separately so the Bracket 3 three-card cap can be enforced) are deliberately excluded.
const SYNERGY_CATEGORIES = [
  "highsynergycards",
  "topcards",
  "creatures",
  "manaartifacts",
  "utilityartifacts",
  "instants",
  "sorceries",
  "enchantments",
  "planeswalkers",
  "utilitylands"
];

export interface EdhrecSynergyCard {
  name: string;
  category: string;
  synergy: number;
}

export interface EdhrecSynergyData {
  commander: string;
  /** Deduplicated, highest-synergy-first, across every non-excluded category. */
  cards: EdhrecSynergyCard[];
  gameChangerCards: string[];
}

export function edhrecCommanderSlug(commanderName: string): string | undefined {
  // Partner/background commander pairs and split cards use a different EDHREC URL shape this
  // module doesn't model — declined rather than guessed at (same as elsewhere in this codebase).
  if (/ \+ |\/\//.test(commanderName)) return undefined;
  const slug = commanderName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return slug || undefined;
}

interface EdhrecCardview {
  name?: string;
  synergy?: number;
}

interface EdhrecCardlist {
  tag?: string;
  cardviews?: EdhrecCardview[];
}

interface EdhrecPageResponse {
  container?: {
    json_dict?: {
      cardlists?: EdhrecCardlist[];
    };
  };
}

export async function fetchEdhrecSynergyData(commanderName: string): Promise<EdhrecSynergyData | undefined> {
  const slug = edhrecCommanderSlug(commanderName);
  if (!slug) return undefined;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EDHREC_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`https://json.edhrec.com/pages/commanders/${slug}.json`, { signal: controller.signal });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as EdhrecPageResponse;
    const cardlists = payload.container?.json_dict?.cardlists;
    if (!Array.isArray(cardlists)) return undefined;

    const seen = new Set<string>();
    const cards: EdhrecSynergyCard[] = [];
    for (const category of SYNERGY_CATEGORIES) {
      const list = cardlists.find((entry) => entry.tag === category);
      for (const view of list?.cardviews ?? []) {
        if (!view.name || seen.has(view.name)) continue;
        seen.add(view.name);
        cards.push({ name: view.name, category, synergy: view.synergy ?? 0 });
      }
    }
    cards.sort((a, b) => b.synergy - a.synergy);

    const gameChangerList = cardlists.find((entry) => entry.tag === "gamechangers");
    const gameChangerCards = (gameChangerList?.cardviews ?? []).map((view) => view.name).filter((name): name is string => Boolean(name));

    return { commander: commanderName, cards, gameChangerCards };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
