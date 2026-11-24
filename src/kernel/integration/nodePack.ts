// NODE ONLY (fs, sqlite): builds a CardPack from data/kernel-drafts/<slug>, data/cards.db, the legacy card catalog and the deck list file.
// Used by `npm run kernel:bundle-drafts` and by tests. The app never imports this file (it imports cardPack.ts and fetches the JSON).
import fs from "node:fs";
import path from "node:path";
import { loadDraftLookup, type DraftLookup } from "../observer/draftLookup";
import { cardUnsupported } from "../engine/support";
import { parseDeckList } from "../../lib/deckParser";
import { loadCardCatalog, lookupCard } from "../../lib/cardCatalog";
import { draftHash } from "./draftHash";
import { displayFromDef, type CardPack, type DisplayCard, type PackDeck } from "./cardPack";
import type { CardInfo } from "../engine/types";

const BASICS = ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"];

export function draftSlugs(root = path.resolve(process.cwd(), "data/kernel-drafts")): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, "_index.json"))).map((d) => d.name).sort();
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** decks/**.txt whose file name matches the deck name (letters and digits only), or undefined. */
export function findDeckFile(deckName: string, decksRoot = path.resolve(process.cwd(), "decks")): string | undefined {
  if (!fs.existsSync(decksRoot)) return undefined;
  const want = key(deckName);
  const hits: string[] = [];
  const walk = (dir: string) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.name.toLowerCase().endsWith(".txt") && key(path.basename(e.name, ".txt")) === want) hits.push(p); } };
  walk(decksRoot);
  return hits[0];
}

export function readDeck(deckName: string): PackDeck | undefined {
  const file = findDeckFile(deckName);
  if (!file) return undefined;
  const parsed = parseDeckList(fs.readFileSync(file, "utf8"));
  return { name: deckName, ...(parsed.commander ? { commander: parsed.commander } : {}), cards: parsed.cards.map((c) => ({ name: c.name, count: c.count })) };
}

export interface BuildPackOptions { dl?: DraftLookup; root?: string; /** read the legacy card catalog (art, oracle text; 52 MB JSON) for display data; false = synthesise it from the card definitions (fast, used by tests) */ catalog?: boolean }

export function buildPack(slug: string, opts: BuildPackOptions = {}): CardPack {
  const root = opts.root ?? path.resolve(process.cwd(), "data/kernel-drafts");
  const dl = opts.dl ?? loadDraftLookup({ draftsRoot: root });
  const index = JSON.parse(fs.readFileSync(path.join(root, slug, "_index.json"), "utf8")) as { deck: string; cards: Array<{ name: string }> };
  const deck = readDeck(index.deck);
  const names = new Set<string>([...index.cards.map((c) => c.name), ...BASICS]);
  for (const c of deck?.cards ?? []) names.add(c.name);
  if (deck?.commander) names.add(deck.commander);
  const catalog = opts.catalog === false ? undefined : loadCardCatalog();
  const cards: CardPack["cards"] = {};
  const info: CardPack["info"] = {};
  const display: CardPack["display"] = {};
  const unsupported: CardPack["unsupported"] = [];
  for (const name of [...names].sort()) {
    const def = dl.lookup(name);
    if (!def) continue;
    cards[name] = def;
    let ci: CardInfo | undefined;
    try { ci = dl.db.card(name); } catch { ci = undefined; }
    if (ci) { const { oracle: _o, ...rest } = ci; info[name] = rest as CardInfo; }
    const rec = catalog ? lookupCard(catalog, name) : undefined;
    const synth = displayFromDef(def);
    display[name] = rec
      ? ({ name: rec.name, typeLine: rec.typeLine, oracleText: rec.oracleText, ...(rec.manaCost ? { manaCost: rec.manaCost } : {}), manaValue: rec.manaValue, colors: rec.colors, colorIdentity: rec.colorIdentity, ...(rec.producedMana ? { producedMana: rec.producedMana } : {}), ...(rec.imageUris ? { imageUris: rec.imageUris } : {}), ...(rec.faces ? { faces: rec.faces } : {}), ...(rec.power !== undefined ? { power: rec.power } : {}), ...(rec.toughness !== undefined ? { toughness: rec.toughness } : {}), ...(rec.loyalty !== undefined ? { loyalty: rec.loyalty } : {}) } as DisplayCard)
      : synth;
    if (!dl.noDraft.has(name)) { const sup = cardUnsupported(def); if (!sup.ok) unsupported.push({ name, needs: sup.all }); }
  }
  return { version: 1, deck: index.deck, slug, generatedAt: new Date().toISOString(), draftHash: draftHash(slug, root), cards, info, creatureTypes: [...dl.db.creatureTypes()], display, decks: deck ? [deck] : [], unsupported };
}
