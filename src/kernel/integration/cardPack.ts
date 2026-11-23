// A "card pack" = everything the browser needs to run the kernel for one or more decks, as plain JSON: the engine's card definitions (kernel
// card JSON + printed characteristics), the creature-type list for "choose a creature type", the printed display data the legacy table renders
// (type line, oracle text, art, faces) and the deck lists. Packs are produced by `npm run kernel:bundle-drafts` (Node, reads data/kernel-drafts and
// data/cards.db) into public/kernel-packs/<deck>.json and fetched by the browser; this file is pure (no fs, no sqlite) and is what the app imports.
import type { CardDb, CardDef, CardInfo, CardLookup } from "../engine/types";
import type { CardImageUris, CardFaceRecord } from "../../lib/types";

/** The part of the legacy CardRecord the table renders. */
export interface DisplayCard {
  name: string;
  typeLine: string;
  oracleText: string;
  manaCost?: string;
  manaValue: number;
  colors: string[];
  colorIdentity?: string[];
  producedMana?: string[];
  imageUris?: CardImageUris;
  faces?: CardFaceRecord[];
  power?: string;
  toughness?: string;
  loyalty?: string;
}

export interface PackDeck { name: string; commander?: string; cards: Array<{ name: string; count: number }> }
export interface PackUnsupported { name: string; needs: string[] }

export interface CardPack {
  version: 1;
  /** deck display name and folder slug under data/kernel-drafts */
  deck: string;
  slug: string;
  generatedAt: string;
  /** engine card definitions by card name (every drafted card of the deck, its basic lands, its commander) */
  cards: Record<string, CardDef>;
  /** printed data by name (the CardDb of the engine: faces, layout) */
  info: Record<string, CardInfo>;
  creatureTypes: string[];
  display: Record<string, DisplayCard>;
  /** the deck list(s) this pack was built from (the first is the deck itself) */
  decks: PackDeck[];
  /** cards the kernel cannot fully run (empty = the deck is fully runnable); continue mode skips only the unsupported part */
  unsupported: PackUnsupported[];
}

export interface PackKit {
  lookup: CardLookup;
  db: CardDb;
  display(name: string): DisplayCard | undefined;
  deck(name: string): PackDeck | undefined;
  names: string[];
}

/** Merge packs (later packs do not override earlier cards of the same name) into the lookup / CardDb / display accessors the engine and toSession use. */
export function packKit(packs: readonly CardPack[]): PackKit {
  const cards = new Map<string, CardDef>();
  const info = new Map<string, CardInfo>();
  const display = new Map<string, DisplayCard>();
  const decks = new Map<string, PackDeck>();
  const types = new Set<string>();
  for (const p of packs) {
    for (const [n, c] of Object.entries(p.cards)) if (!cards.has(n)) cards.set(n, c);
    for (const [n, c] of Object.entries(p.info)) if (!info.has(n)) info.set(n, c);
    for (const [n, c] of Object.entries(p.display)) if (!display.has(n)) display.set(n, c);
    for (const d of p.decks) if (!decks.has(d.name)) decks.set(d.name, d);
    for (const t of p.creatureTypes) types.add(t);
  }
  const names = [...cards.keys()].sort();
  // a card the legacy side knows by its front face only ("Stensian Sanguinist") resolves to the pack's "Front // Back" entry
  const front = new Map<string, string>();
  for (const n of names) { const f = n.split(" / ")[0].split(" // ")[0]; if (f !== n && !cards.has(f) && !front.has(f)) front.set(f, n); }
  const real = (name: string): string => (cards.has(name) ? name : front.get(name) ?? name);
  const creatureTypes = [...types].sort();
  return {
    lookup: (name) => cards.get(real(name)),
    db: { creatureTypes: () => creatureTypes, cardNames: () => names, card: (name) => info.get(real(name)) },
    display: (name) => display.get(real(name)),
    deck: (name) => decks.get(name),
    names
  };
}

/** Runtime guard for a fetched pack. */
export function isCardPack(v: unknown): v is CardPack {
  const p = v as Partial<CardPack> | null;
  return !!p && typeof p === "object" && p.version === 1 && typeof p.deck === "string" && !!p.cards && typeof p.cards === "object" && Array.isArray(p.decks);
}

/** Browser: fetch the packs of the given deck slugs from `base` (default /kernel-packs). */
export async function fetchPacks(slugs: readonly string[], base = "/kernel-packs", fetcher: typeof fetch = fetch): Promise<CardPack[]> {
  const out: CardPack[] = [];
  for (const slug of slugs) {
    const res = await fetcher(`${base}/${slug}.json`);
    if (!res.ok) throw new Error(`kernel pack "${slug}" not found (${res.status}); run "npm run kernel:bundle-drafts"`);
    const json: unknown = await res.json();
    if (!isCardPack(json)) throw new Error(`kernel pack "${slug}" is malformed`);
    out.push(json);
  }
  return out;
}

/** "Legendary Creature - Elf Druid" style type line for a card the legacy catalog does not know (tokens, missing cards). */
export function typeLineOf(types: readonly string[], subtypes: readonly string[] = [], supertypes: readonly string[] = []): string {
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const left = [...supertypes.map(cap), ...types.map(cap)].join(" ");
  return subtypes.length ? `${left} — ${subtypes.join(" ")}` : left;
}

/** Display data synthesised from an engine definition (fallback when the legacy catalog has no record). */
export function displayFromDef(def: CardDef): DisplayCard {
  const mv = [...(def.manaCost ?? "").matchAll(/\{([^}]+)\}/g)].reduce((s, m) => s + (/^\d+$/.test(m[1]) ? Number(m[1]) : m[1] === "X" ? 0 : 1), 0);
  const letters: Record<string, string> = { W: "W", U: "U", B: "B", R: "R", G: "G" };
  const colors = def.colors ?? [...new Set([...(def.manaCost ?? "").matchAll(/[WUBRG]/g)].map((m) => letters[m[0]]))];
  const oracle = def.kernel.abilities.map((a) => a.text).filter(Boolean).join("\n");
  return {
    name: def.name, typeLine: typeLineOf(def.types, def.subtypes, def.supertypes), oracleText: oracle, ...(def.manaCost ? { manaCost: def.manaCost } : {}), manaValue: mv, colors,
    ...(def.power !== undefined ? { power: String(def.power) } : {}), ...(def.toughness !== undefined ? { toughness: String(def.toughness) } : {}),
    ...(def.loyalty !== undefined ? { loyalty: String(def.loyalty) } : {})
  };
}
