// SQLite-backed store for the card catalog and the LLM-parsed ability cache (mtg-commander-engine-
// spec.md's Phase 1 "parsed_cards" idea, adapted to this app's actual stack: one local file instead
// of Postgres, Ollama instead of the Claude API). cardCatalog.ts's JSON-file loader stays exactly as
// is — everything already depends on its exact Map shape and it's fully tested — this module is a
// separate, additive store that (a) mirrors the same card data into a queryable SQLite file and (b)
// owns the new parsed_cards table that a card-effect parse gets cached into, keyed by oracle_id so a
// re-run (or a different card printing with the same oracle text) never re-parses the same card twice.
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { loadCardCatalog, normalizeCardName } from "./cardCatalog";
import type { CardRecord } from "./types";
import type { CardParse } from "./cardParser";

const DB_PATH = path.join(process.cwd(), "data", "cards.db");

let db: Database.Database | undefined;

export function getCardDb(): Database.Database {
  if (db) return db;

  const dir = path.dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      oracle_id TEXT PRIMARY KEY,
      scryfall_id TEXT,
      name TEXT NOT NULL,
      type_line TEXT NOT NULL DEFAULT '',
      oracle_text TEXT NOT NULL DEFAULT '',
      mana_cost TEXT,
      mana_value REAL NOT NULL DEFAULT 0,
      colors TEXT NOT NULL DEFAULT '[]',
      color_identity TEXT NOT NULL DEFAULT '[]',
      legalities TEXT NOT NULL DEFAULT '{}',
      raw TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name);

    CREATE TABLE IF NOT EXISTS parsed_cards (
      oracle_id TEXT PRIMARY KEY,
      card_name TEXT NOT NULL,
      parse_status TEXT NOT NULL,
      source TEXT NOT NULL,
      model TEXT,
      abilities TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      parsed_at TEXT NOT NULL
    );

    -- A saved-game snapshot (src/lib/saveGame.ts's GameSnapshot), taken only at a "clean stop" (see
    -- isCleanSaveStop) so it never needs to serialize in-flight stack/modal state. The scalar
    -- columns below exist so the setup screen's saved-games list is a cheap query; the state column
    -- is the whole snapshot as JSON, only ever read in full when actually loading a save.
    CREATE TABLE IF NOT EXISTS saved_games (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      format_version INTEGER NOT NULL,
      turn INTEGER NOT NULL,
      phase TEXT NOT NULL,
      summary TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      state TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_saved_games_saved_at ON saved_games(saved_at DESC);

    -- mtg-commander-engine-spec.md's Phase 3a: a static, indexed mirror of magefree/mage's own
    -- per-card Java implementations (scripts/ingest-xmage-cards.mjs populates this from a local
    -- sparse checkout at data/xmage-source — see that script), keyed by xmageKeyForCardName's
    -- normalized form of the card's OWN filename (not a name this project supplies — the ingestion
    -- key is always derived from the real file XMage shipped, so it can never be wrong about what
    -- it actually indexed, independent of how well xmageKeyForCardName's Scryfall-name-to-key guess
    -- happens to work for any given lookup). Not yet consulted by anything at runtime — this is the
    -- ingestion half only; the declined-card lookup/grounding half is future work.
    CREATE TABLE IF NOT EXISTS xmage_cards (
      xmage_key TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      source TEXT NOT NULL,
      ingested_at TEXT NOT NULL
    );
  `);

  // First open: seed the cards table from the existing JSON catalog cardCatalog.ts already loads,
  // rather than re-fetching Scryfall — this DB is a queryable mirror of that same import, not a
  // second source of truth. Re-running scripts/import-commander-cards.mjs still requires re-running
  // this migration (delete data/cards.db, or call migrateCardsFromCatalog(true)) to pick up changes.
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM cards").get() as { count: number };
  if (count === 0) {
    migrateCardsFromCatalog(db);
  }

  return db;
}

function migrateCardsFromCatalog(target: Database.Database, force = false) {
  const catalog = loadCardCatalog();
  if (catalog.source !== "generated" && !force) {
    // Only the builtin placeholder deck is loaded — nothing worth mirroring yet (cardCatalog.ts
    // falls back to a handful of BUILTIN_CARDS when data/commander-cards.json is missing).
    return;
  }

  const insert = target.prepare(`
    INSERT INTO cards (oracle_id, scryfall_id, name, type_line, oracle_text, mana_cost, mana_value, colors, color_identity, legalities, raw)
    VALUES (@oracle_id, @scryfall_id, @name, @type_line, @oracle_text, @mana_cost, @mana_value, @colors, @color_identity, @legalities, @raw)
    ON CONFLICT(oracle_id) DO UPDATE SET
      scryfall_id = excluded.scryfall_id, name = excluded.name, type_line = excluded.type_line,
      oracle_text = excluded.oracle_text, mana_cost = excluded.mana_cost, mana_value = excluded.mana_value,
      colors = excluded.colors, color_identity = excluded.color_identity, legalities = excluded.legalities,
      raw = excluded.raw
  `);

  const insertMany = target.transaction((cards: CardRecord[]) => {
    for (const card of cards) {
      const oracleId = card.oracleId ?? card.id;
      insert.run({
        oracle_id: oracleId,
        scryfall_id: card.id,
        name: card.name,
        type_line: card.typeLine ?? "",
        oracle_text: card.oracleText ?? "",
        mana_cost: card.manaCost ?? null,
        mana_value: card.manaValue ?? 0,
        colors: JSON.stringify(card.colors ?? []),
        color_identity: JSON.stringify(card.colorIdentity ?? []),
        legalities: JSON.stringify(card.legalities ?? {}),
        raw: JSON.stringify(card)
      });
    }
  });

  insertMany(catalog.cards);
}

export interface CardDbRow {
  oracleId: string;
  scryfallId: string | null;
  name: string;
  typeLine: string;
  oracleText: string;
  manaCost: string | null;
  manaValue: number;
  colors: string[];
  colorIdentity: string[];
  legalities: Record<string, string>;
}

function rowToCard(row: {
  oracle_id: string;
  scryfall_id: string | null;
  name: string;
  type_line: string;
  oracle_text: string;
  mana_cost: string | null;
  mana_value: number;
  colors: string;
  color_identity: string;
  legalities: string;
}): CardDbRow {
  return {
    oracleId: row.oracle_id,
    scryfallId: row.scryfall_id,
    name: row.name,
    typeLine: row.type_line,
    oracleText: row.oracle_text,
    manaCost: row.mana_cost,
    manaValue: row.mana_value,
    colors: JSON.parse(row.colors),
    colorIdentity: JSON.parse(row.color_identity),
    legalities: JSON.parse(row.legalities)
  };
}

export function getCardByOracleId(oracleId: string): CardDbRow | undefined {
  const row = getCardDb().prepare("SELECT * FROM cards WHERE oracle_id = ?").get(oracleId) as Parameters<typeof rowToCard>[0] | undefined;
  return row ? rowToCard(row) : undefined;
}

export function getCardByName(name: string): CardDbRow | undefined {
  const row = getCardDb()
    .prepare("SELECT * FROM cards WHERE lower(name) = lower(?) LIMIT 1")
    .get(normalizeCardName(name)) as Parameters<typeof rowToCard>[0] | undefined;
  return row ? rowToCard(row) : undefined;
}

// Candidate cards for the bulk parser: real (non-vanilla) rules text, not already in parsed_cards.
// "Vanilla" here means literally empty oracle text — reminder text on keyword-only cards (e.g. a
// plain "Flying" creature with no other line) still has real text and gets a real (if trivial) parse.
export function listUnparsedCandidates(limit?: number): CardDbRow[] {
  const sql = `
    SELECT c.* FROM cards c
    LEFT JOIN parsed_cards p ON p.oracle_id = c.oracle_id
    WHERE p.oracle_id IS NULL AND trim(c.oracle_text) != ''
    ORDER BY c.name
    ${limit ? "LIMIT @limit" : ""}
  `;
  const rows = (limit ? getCardDb().prepare(sql).all({ limit }) : getCardDb().prepare(sql).all()) as Parameters<typeof rowToCard>[0][];
  return rows.map(rowToCard);
}

export function countVanillaCards(): number {
  const { count } = getCardDb().prepare("SELECT COUNT(*) AS count FROM cards WHERE trim(oracle_text) = ''").get() as { count: number };
  return count;
}

export interface ParsedCardRow {
  oracleId: string;
  cardName: string;
  parseStatus: "ok" | "declined" | "failed";
  source: "llm_parsed" | "manual_override";
  model: string | null;
  abilities: CardParse["abilities"];
  error: string | null;
  parsedAt: string;
}

export function getParsedCard(oracleId: string): ParsedCardRow | undefined {
  const row = getCardDb().prepare("SELECT * FROM parsed_cards WHERE oracle_id = ?").get(oracleId) as
    | {
        oracle_id: string;
        card_name: string;
        parse_status: string;
        source: string;
        model: string | null;
        abilities: string;
        error: string | null;
        parsed_at: string;
      }
    | undefined;
  if (!row) return undefined;
  return {
    oracleId: row.oracle_id,
    cardName: row.card_name,
    parseStatus: row.parse_status as ParsedCardRow["parseStatus"],
    source: row.source as ParsedCardRow["source"],
    model: row.model,
    abilities: JSON.parse(row.abilities),
    error: row.error,
    parsedAt: row.parsed_at
  };
}

export interface SaveParsedCardInput {
  oracleId: string;
  cardName: string;
  parseStatus: "ok" | "declined" | "failed";
  source: "llm_parsed" | "manual_override";
  model?: string;
  abilities: CardParse["abilities"];
  error?: string;
}

// Never overwrite a manually-corrected entry with a fresh LLM pass (spec Phase 1a point 8) — a
// human already fixed this card once, a bulk re-run should leave it alone.
export function saveParsedCard(input: SaveParsedCardInput): void {
  const existing = getParsedCard(input.oracleId);
  if (existing?.source === "manual_override" && input.source === "llm_parsed") return;

  getCardDb()
    .prepare(`
      INSERT INTO parsed_cards (oracle_id, card_name, parse_status, source, model, abilities, error, parsed_at)
      VALUES (@oracleId, @cardName, @parseStatus, @source, @model, @abilities, @error, @parsedAt)
      ON CONFLICT(oracle_id) DO UPDATE SET
        card_name = excluded.card_name, parse_status = excluded.parse_status, source = excluded.source,
        model = excluded.model, abilities = excluded.abilities, error = excluded.error, parsed_at = excluded.parsed_at
    `)
    .run({
      oracleId: input.oracleId,
      cardName: input.cardName,
      parseStatus: input.parseStatus,
      source: input.source,
      model: input.model ?? null,
      abilities: JSON.stringify(input.abilities),
      error: input.error ?? null,
      parsedAt: new Date().toISOString()
    });
}

export function getParseStats() {
  const totalCards = (getCardDb().prepare("SELECT COUNT(*) AS n FROM cards").get() as { n: number }).n;
  const vanilla = countVanillaCards();
  const parsed = (getCardDb().prepare("SELECT COUNT(*) AS n FROM parsed_cards").get() as { n: number }).n;
  const byStatus = getCardDb().prepare("SELECT parse_status, COUNT(*) AS n FROM parsed_cards GROUP BY parse_status").all() as Array<{
    parse_status: string;
    n: number;
  }>;
  return {
    totalCards,
    vanilla,
    nonVanilla: totalCards - vanilla,
    parsed,
    remaining: totalCards - vanilla - parsed,
    byStatus: Object.fromEntries(byStatus.map((row) => [row.parse_status, row.n]))
  };
}

// mtg-commander-engine-spec.md Phase 3a — derives the same lookup key from a card's real (Scryfall)
// name that xmage_cards' own ingestion (scripts/ingest-xmage-cards.mjs) derives from each Java
// file's actual filename, so a name computed here can be looked up against a key computed there.
// Only the FRONT face's name is used for a "//"-joined name (e.g. "Aang, Swift Savior // Aang and
// La, Ocean's Fury"): XMage names a transform/modal-DFC card's file after its front face alone.
// True split cards (Fire // Ice) are the one real exception — XMage combines both halves into one
// file, "FireIce.java" — but front-face-only still gets the large majority of "//" names right,
// since most of them are transforms/MDFCs, not true splits. Validated empirically at 98.5% against
// this project's own ~30,500-card catalog (data/cards.db) before this function was trusted anywhere;
// the misses are a mix of genuine XMage coverage gaps (a card it hasn't implemented at all) and true
// split cards missing under this front-face-only key — a documented, known gap, not silently assumed
// away. Lowercased so the SQLite key comparison never depends on case matching exactly.
export function xmageKeyForCardName(name: string): string {
  const frontFace = name.split(/\s*\/\/\s*/)[0];
  return frontFace
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics left behind by NFKD (Jötun -> Jotun)
    .replace(/[Ææ]/g, "Ae") // the ligature isn't decomposed by NFKD, so it needs its own rule
    .replace(/[^a-zA-Z0-9 ]/g, "") // strip apostrophes/commas/periods/hyphens/etc.
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join("")
    .toLowerCase();
}

export interface XMageCardRow {
  xmageKey: string;
  filePath: string;
  source: string;
  ingestedAt: string;
}

export function getXMageCardByKey(xmageKey: string): XMageCardRow | undefined {
  const row = getCardDb().prepare("SELECT * FROM xmage_cards WHERE xmage_key = ?").get(xmageKey) as
    | { xmage_key: string; file_path: string; source: string; ingested_at: string }
    | undefined;
  return row ? { xmageKey: row.xmage_key, filePath: row.file_path, source: row.source, ingestedAt: row.ingested_at } : undefined;
}

// Looks a card up the same way a future declined-card grounding step would: by its real name,
// through xmageKeyForCardName, rather than requiring the caller to compute the key itself.
export function getXMageCardByName(cardName: string): XMageCardRow | undefined {
  return getXMageCardByKey(xmageKeyForCardName(cardName));
}

// Bulk upsert for scripts/ingest-xmage-cards.mjs — replaces the whole table's contents with exactly
// what's on disk right now (a stale entry for a file XMage has since renamed/removed would otherwise
// linger forever with no natural expiry), inside one transaction so a re-ingest is atomic rather than
// leaving the table half-old/half-new if it's interrupted partway through.
export function replaceAllXMageCards(entries: Array<{ xmageKey: string; filePath: string; source: string }>): void {
  const db = getCardDb();
  const ingestedAt = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO xmage_cards (xmage_key, file_path, source, ingested_at)
    VALUES (@xmageKey, @filePath, @source, @ingestedAt)
    ON CONFLICT(xmage_key) DO UPDATE SET
      file_path = excluded.file_path, source = excluded.source, ingested_at = excluded.ingested_at
  `);
  const run = db.transaction((rows: Array<{ xmageKey: string; filePath: string; source: string }>) => {
    db.prepare("DELETE FROM xmage_cards").run();
    for (const row of rows) insert.run({ ...row, ingestedAt });
  });
  run(entries);
}

export function getXMageIngestStats() {
  const total = (getCardDb().prepare("SELECT COUNT(*) AS n FROM xmage_cards").get() as { n: number }).n;
  const lastIngestedAt = (getCardDb().prepare("SELECT MAX(ingested_at) AS at FROM xmage_cards").get() as { at: string | null }).at;
  return { total, lastIngestedAt };
}
