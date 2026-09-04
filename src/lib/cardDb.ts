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
