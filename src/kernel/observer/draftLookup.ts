// Node-side card definitions for the observer: the kernel JSON drafts (data/kernel-drafts/**) by card name, printed data (types, cost, P/T)
// from data/cards.db (read-only, through the engine's test CardDb adapter) and, for cards without a draft, a STUB definition (no abilities)
// so the kernel can still hold the object. Stubs are recorded in `noDraft` so the observer can report `no_draft` and skip comparisons that
// involve them. Never imported by the app: Node only (fs, better-sqlite3).
import fs from "node:fs";
import path from "node:path";
import { CardSchema, type Card } from "../schema";
import { sqliteCardDb } from "../engine/testdb";
import type { CardDb, CardDef, CardInfo, CardLookup } from "../engine/types";

const SUPERS = new Set(["legendary", "basic", "snow", "world", "ongoing"]);
const TYPES = new Set(["artifact", "creature", "enchantment", "instant", "land", "planeswalker", "sorcery", "battle", "kindred", "tribal"]);

/** "Legendary Artifact Creature — Elf Druid" -> lowercase types, supertypes, subtypes as printed. "Token" is dropped. */
export function parseTypeLine(line: string): { types: string[]; subtypes: string[]; supertypes: string[] } {
  // the legacy engine writes its token type lines with an ASCII hyphen ("Token Artifact - Treasure", "Token Creature - Insect")
  const front = line.split(" // ")[0].replace(/^([^—]*?)\s-\s/, "$1 — ");
  const [left, right] = front.split(" — ");
  const words = left.split(/\s+/).map((w) => w.toLowerCase()).filter(Boolean);
  return { types: words.filter((w) => TYPES.has(w)), supertypes: words.filter((w) => SUPERS.has(w)), subtypes: right ? right.split(/\s+/).filter(Boolean) : [] };
}

/** The legacy fields the stub needs (a VisibleCard satisfies this). */
export interface LegacyCardInfo { name: string; typeLine: string; manaCost?: string; power?: string; toughness?: string; loyalty?: string; colors?: string[] }

export interface DraftLookup {
  /** the engine's card lookup (never undefined: a card without draft gets a stub definition) */
  lookup: CardLookup;
  db: CardDb;
  /** remember the legacy printed data of a card so a stub can be built from it when the DB does not know the card */
  register(info: LegacyCardInfo): void;
  hasDraft(name: string): boolean;
  /** "Agadeem, the Undercrypt" -> { card: "Agadeem's Awakening // Agadeem, the Undercrypt", face: "Agadeem, the Undercrypt" }: the legacy engine renames a double-faced card to its played face */
  canonical(name: string): { card: string; face?: string };
  /** names that were looked up and have NO draft (stubs) */
  noDraft: Set<string>;
  draftCount(): number;
}

let nameToFile: Map<string, string> | undefined;
/** face name (and full name) -> the full "A // B" name used by the draft index */
const aliases = new Map<string, string>();
function draftFiles(root: string): Map<string, string> {
  if (nameToFile) return nameToFile;
  const m = new Map<string, string>();
  if (fs.existsSync(root)) {
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      const ix = path.join(root, d.name, "_index.json");
      if (!d.isDirectory() || !fs.existsSync(ix)) continue;
      for (const e of JSON.parse(fs.readFileSync(ix, "utf8")).cards as Array<{ name: string; slug: string }>) {
        if (!m.has(e.name)) m.set(e.name, path.join(root, d.name, e.slug + ".json"));
        if (e.name.includes(" // ")) for (const part of e.name.split(" // ")) if (!aliases.has(part)) aliases.set(part, e.name);
      }
    }
  }
  return (nameToFile = m);
}

/** Basic lands have no draft file: the kernel derives their mana ability from the land type, so a stub IS their full definition. */
const BASIC_LANDS = /^(Snow-Covered )?(Plains|Island|Swamp|Mountain|Forest)$|^Wastes$/;
const num = (v: string | undefined): number | undefined => (v !== undefined && /^-?\d+$/.test(v) ? Number(v) : undefined);

export function loadDraftLookup(opts: { draftsRoot?: string; dbFile?: string } = {}): DraftLookup {
  const root = opts.draftsRoot ?? path.resolve(process.cwd(), "data/kernel-drafts");
  const files = draftFiles(root);
  let db: CardDb;
  try { db = sqliteCardDb(opts.dbFile); } catch { db = { creatureTypes: () => [], cardNames: () => [], card: () => undefined }; }
  const cache = new Map<string, CardDef | null>();
  const legacy = new Map<string, LegacyCardInfo>();
  const noDraft = new Set<string>();

  const infoOf = (name: string): CardInfo | undefined => {
    let info: CardInfo | undefined;
    try { info = db.card(name); } catch { info = undefined; }
    const l = legacy.get(name);
    // the test CardDb adapter does not read the loyalty of single-faced planeswalkers: take it from the legacy card
    if (info) {
      // the DB leaves out a stat that is a characteristic-defining value (Callaphe: "*"/4 has no power, but a real toughness): take numeric stats it lacks from the legacy card
      const fix: Partial<CardInfo> = {};
      if (info.loyalty === undefined && info.types.includes("planeswalker") && num(l?.loyalty) !== undefined) fix.loyalty = num(l?.loyalty);
      if (info.toughness === undefined && num(l?.toughness) !== undefined) fix.toughness = num(l?.toughness);
      if (info.power === undefined && num(l?.power) !== undefined) fix.power = num(l?.power);
      return Object.keys(fix).length ? { ...info, ...fix } : info;
    }
    if (!l) return undefined;
    return { name, ...(l.manaCost ? { manaCost: l.manaCost } : {}), ...parseTypeLine(l.typeLine), ...(num(l.power) !== undefined ? { power: num(l.power) } : {}), ...(num(l.toughness) !== undefined ? { toughness: num(l.toughness) } : {}), ...(num(l.loyalty) !== undefined ? { loyalty: num(l.loyalty) } : {}) };
  };

  const build = (name: string): CardDef | undefined => {
    const info = infoOf(name);
    const file = files.get(name);
    if (file && info) {
      try {
        const kernel: Card = CardSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
        const { oracle: _o, name: _n, ...meta } = info;
        return { name, ...meta, kernel } as CardDef;
      } catch { /* an invalid draft file counts as no draft */ }
    }
    if (!BASIC_LANDS.test(name)) noDraft.add(name);
    const base = info ?? { name, types: [] };
    const { oracle: _o, name: _n, ...meta } = base;
    return { name, ...meta, kernel: { schemaVersion: 2, abilities: [] } } as CardDef;
  };

  const lookup: CardLookup = (name) => {
    const hit = cache.get(name);
    if (hit !== undefined) return hit ?? undefined;
    const def = build(name);
    cache.set(name, def ?? null);
    return def;
  };

  return {
    lookup,
    db,
    register(info) {
      // a card looked up before it was registered keeps its definition; only unseen names pick up the legacy data
      if (!legacy.has(info.name)) legacy.set(info.name, info);
    },
    hasDraft: (name) => files.has(name) || aliases.has(name) || BASIC_LANDS.test(name),
    canonical(name) {
      const full = aliases.get(name);
      if (!full || full === name) return { card: name };
      const parts = full.split(" // ");
      return parts[0] === name ? { card: full } : { card: full, face: name };
    },
    noDraft,
    draftCount: () => files.size
  };
}
