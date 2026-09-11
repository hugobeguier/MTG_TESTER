// mtg-commander-engine-spec.md's Phase 3a: ingests magefree/mage's own per-card Java
// implementations as a static reference corpus, indexed by a normalized form of each file's own
// name (see xmageKeyForCardName's sibling copy of this same rule in src/lib/cardDb.ts, used by
// FUTURE lookup code — this script only ever derives a key from the real file on disk, never
// guesses one, so the ingested index can't be wrong about what it actually found). Opens
// data/cards.db directly with better-sqlite3 rather than importing src/lib/cardDb.ts — same
// "plain scripts talk to SQLite directly, don't cross the .mjs/.ts boundary" convention
// scripts/parse-cards.mjs already uses.
//
// Usage:
//   node scripts/ingest-xmage-cards.mjs           # clone (first run) or pull (later runs), then index
//   node scripts/ingest-xmage-cards.mjs --no-fetch # skip the git step, just re-index what's on disk
//   node scripts/ingest-xmage-cards.mjs --validate # also report the hit-rate against data/cards.db's
//                                                   # own card names (diagnostic only, no writes)

import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const XMAGE_SOURCE_DIR = path.join(REPO_ROOT, "data", "xmage-source");
const CARDS_DIR = path.join(XMAGE_SOURCE_DIR, "Mage.Sets", "src", "mage", "cards");
const DB_PATH = path.join(REPO_ROOT, "data", "cards.db");
const REPO_URL = "https://github.com/magefree/mage.git";

const args = new Set(process.argv.slice(2));
const skipFetch = args.has("--no-fetch");
const validate = args.has("--validate");

function run(cmd, cmdArgs, cwd) {
  console.log(`$ ${cmd} ${cmdArgs.join(" ")}`);
  execFileSync(cmd, cmdArgs, { cwd, stdio: "inherit" });
}

function ensureSourceCheckout() {
  if (skipFetch) {
    if (!existsSync(CARDS_DIR)) {
      throw new Error(`--no-fetch given but ${CARDS_DIR} doesn't exist yet — run without --no-fetch once first.`);
    }
    console.log("Skipping git fetch (--no-fetch); indexing whatever is already on disk.");
    return;
  }
  if (!existsSync(path.join(XMAGE_SOURCE_DIR, ".git"))) {
    mkdirSync(path.dirname(XMAGE_SOURCE_DIR), { recursive: true });
    // --filter=blob:none --sparse: fetches only the cards directory's blobs at the current commit,
    // not the ~1 GB full repo with history — see mtg-commander-engine-spec.md Phase 3a for why.
    run("git", ["clone", "--depth", "1", "--filter=blob:none", "--sparse", REPO_URL, XMAGE_SOURCE_DIR], REPO_ROOT);
    run("git", ["sparse-checkout", "set", "Mage.Sets/src/mage/cards"], XMAGE_SOURCE_DIR);
  } else {
    // Best-effort refresh: a stale local checkout is still useful (this is a re-run, not a first
    // ingest), so a failed pull (offline, network hiccup) logs and continues with what's on disk
    // rather than aborting the whole ingestion.
    try {
      run("git", ["pull", "--ff-only"], XMAGE_SOURCE_DIR);
    } catch (error) {
      console.warn(`git pull failed, continuing with the existing local checkout: ${error.message}`);
    }
  }
}

// Every letter subdirectory (a/, b/, ..., z/, plus a handful of non-letter ones for cards XMage's
// own convention buckets oddly) under Mage.Sets/src/mage/cards holds one .java file per card name.
function findCardFiles() {
  const files = [];
  for (const letterDir of readdirSync(CARDS_DIR)) {
    const full = path.join(CARDS_DIR, letterDir);
    if (!statSync(full).isDirectory()) continue;
    for (const file of readdirSync(full)) {
      if (file.endsWith(".java")) files.push(path.join(full, file));
    }
  }
  return files;
}

function ensureTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS xmage_cards (
      xmage_key TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      source TEXT NOT NULL,
      ingested_at TEXT NOT NULL
    );
  `);
}

function ingest(db, files) {
  const ingestedAt = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO xmage_cards (xmage_key, file_path, source, ingested_at)
    VALUES (@xmageKey, @filePath, @source, @ingestedAt)
    ON CONFLICT(xmage_key) DO UPDATE SET
      file_path = excluded.file_path, source = excluded.source, ingested_at = excluded.ingested_at
  `);
  const runAll = db.transaction((entries) => {
    // A full replace, not an incremental upsert: a card XMage has since renamed/removed would
    // otherwise leave a stale row behind forever with no natural expiry.
    db.prepare("DELETE FROM xmage_cards").run();
    for (const entry of entries) insert.run({ ...entry, ingestedAt });
  });
  const entries = files.map((filePath) => ({
    xmageKey: path.basename(filePath, ".java").toLowerCase(),
    filePath: path.relative(REPO_ROOT, filePath).split(path.sep).join("/"),
    source: readFileSync(filePath, "utf8")
  }));
  runAll(entries);
  return entries.length;
}

// Mirrors xmageKeyForCardName in src/lib/cardDb.ts exactly — kept in sync by hand since this script
// can't import a .ts module directly (see the file header). Only used for --validate's diagnostic
// hit-rate report, never for the ingestion key itself (which always comes straight from the real
// filename, see ingest() above).
function xmageKeyForCardName(name) {
  const frontFace = name.split(/\s*\/\/\s*/)[0];
  return frontFace
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[Ææ]/g, "Ae")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join("")
    .toLowerCase();
}

function reportValidation(db) {
  const hasCardsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cards'").get();
  if (!hasCardsTable) {
    console.log("No `cards` table found in data/cards.db yet (run the app once, or npm run cards:import) — skipping validation.");
    return;
  }
  const names = db.prepare("SELECT DISTINCT name FROM cards").all().map((row) => row.name);
  const keys = new Set(db.prepare("SELECT xmage_key FROM xmage_cards").all().map((row) => row.xmage_key));
  let hits = 0;
  const misses = [];
  for (const name of names) {
    if (keys.has(xmageKeyForCardName(name))) hits += 1;
    else misses.push(name);
  }
  console.log(`Validation: ${hits}/${names.length} (${((100 * hits) / names.length).toFixed(1)}%) of data/cards.db's own card names resolve to an ingested XMage file.`);
  if (misses.length > 0) {
    console.log(`First ${Math.min(10, misses.length)} misses (a mix of genuine XMage coverage gaps and the documented split-card edge case): ${misses.slice(0, 10).join(", ")}`);
  }
}

ensureSourceCheckout();
const files = findCardFiles();
console.log(`Found ${files.length} card implementation files under ${path.relative(REPO_ROOT, CARDS_DIR)}.`);

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
ensureTable(db);
const count = ingest(db, files);
console.log(`Ingested ${count} XMage card implementations into ${path.relative(REPO_ROOT, DB_PATH)}'s xmage_cards table.`);

if (validate) reportValidation(db);

db.close();
