// The card environment of a spec run: real drafts (data/kernel-drafts, same lookup the observer / table use) + data/cards.db printed data + the helper catalog.
// Node only. One environment per preferred deck, cached for the process (building it costs a DB open and the draft index).
import "../engine/resolve"; // FIRST: the engine modules import each other in a cycle that only initialises when resolve.ts is entered first
import fs from "node:fs";
import path from "node:path";
import { CardSchema } from "../schema";
import { createEngine } from "../engine/setup";
import type { CardDef, EngineContext } from "../engine/types";
import { loadDraftLookup, type DraftLookup } from "../observer/draftLookup";
import { CATALOG } from "./catalog";

export const DRAFTS_DIR = path.resolve(process.cwd(), "data/kernel-drafts");
export const SPECS_DIR = path.resolve(process.cwd(), "data/kernel-specs");
const BASIC = /^(Snow-Covered )?(Plains|Island|Swamp|Mountain|Forest)$|^Wastes$/;

export interface SpecEnv {
  deck?: string;
  ctx: EngineContext;
  lookup: DraftLookup;
  /** the full card name used by the engine ("Secret Arcade" -> "Secret Arcade // Dusty Parlor"), or undefined if no such card exists anywhere */
  canonical(name: string): string | undefined;
  /** true when the card is a real card with a draft (or a catalog stand-in / basic land); false = the engine would only hold a stub with no abilities */
  hasDraft(name: string): boolean;
  isCatalog(name: string): boolean;
}

export function slugify(name: string): string { return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }

/** card names (full) of a deck folder, from its _index.json */
export function deckCards(deck: string): string[] {
  const ix = path.join(DRAFTS_DIR, deck, "_index.json");
  if (!fs.existsSync(ix)) throw new Error(`no deck folder data/kernel-drafts/${deck} (decks: ${fs.readdirSync(DRAFTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).join(", ")})`);
  return (JSON.parse(fs.readFileSync(ix, "utf8")).cards as Array<{ name: string }>).map((c) => c.name);
}
export function deckFolders(): string[] { return fs.readdirSync(DRAFTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(DRAFTS_DIR, d.name, "_index.json"))).map((d) => d.name); }

const envs = new Map<string, SpecEnv>();
export function getEnv(deck?: string): SpecEnv {
  const key = deck ?? "";
  const hit = envs.get(key);
  if (hit) return hit;
  const lookup = loadDraftLookup();
  const over = new Map<string, CardDef | undefined>();
  if (deck) {
    const ix = path.join(DRAFTS_DIR, deck, "_index.json");
    if (!fs.existsSync(ix)) throw new Error(`no deck folder data/kernel-drafts/${deck}`);
    for (const e of JSON.parse(fs.readFileSync(ix, "utf8")).cards as Array<{ name: string; slug: string }>) {
      const base = lookup.lookup(e.name);
      if (!base) continue;
      try { over.set(e.name, { ...base, kernel: CardSchema.parse(JSON.parse(fs.readFileSync(path.join(DRAFTS_DIR, deck, e.slug + ".json"), "utf8"))) }); } catch { /* unreadable draft: keep the default one */ }
    }
  }
  const cards = (name: string): CardDef | undefined => CATALOG.get(name)?.def ?? over.get(name) ?? lookup.lookup(name);
  const canonical = (name: string): string | undefined => {
    if (CATALOG.has(name)) return name;
    // the decks list a two-faced card by its front face ("Secret Arcade"); the DB has "Secret Arcade // Dusty Parlor"
    if (name.includes(" // ") && lookup.hasDraft(name.split(" // ")[0])) return name.split(" // ")[0];
    const c = lookup.canonical(name).card;
    if (lookup.hasDraft(c) || BASIC.test(c)) return c;
    try { return lookup.db.card(c)?.name; } catch { return undefined; }
  };
  const env: SpecEnv = {
    deck, ctx: createEngine(cards, lookup.db).ctx, lookup, canonical,
    hasDraft: (n) => CATALOG.has(n) || BASIC.test(n) || lookup.hasDraft(n),
    isCatalog: (n) => CATALOG.has(n)
  };
  envs.set(key, env);
  return env;
}
