// Bulk offline card parser — mtg-commander-engine-spec.md's Phase 1a, run against this app's real
// stack: reads data/cards.db directly (built once by src/lib/cardDb.ts on first access) to pick
// candidates, then POSTs each one to the running dev server's /api/rules/parse-card, which does the
// actual Ollama call + parsed_cards cache write (same pattern as scripts/agent-bench.mjs: hit the
// real endpoint, don't reimplement its logic here). Requires `npm run dev` already running.
//
// Usage:
//   node scripts/parse-cards.mjs --sample --dry-run     # ~50 iconic staples, don't write cache
//   node scripts/parse-cards.mjs --sample                # same, but writes to parsed_cards
//   node scripts/parse-cards.mjs --limit=200              # first 200 unparsed non-vanilla cards
//   node scripts/parse-cards.mjs --full                    # every unparsed non-vanilla card
//   node scripts/parse-cards.mjs --retry-failed             # re-run cards previously marked failed
//   node scripts/parse-cards.mjs --retry-declined            # re-run cards previously marked declined
//   node scripts/parse-cards.mjs --full --concurrency=8
//   PARSE_CARDS_BASE_URL=http://127.0.0.1:3001 node scripts/parse-cards.mjs --sample

import Database from "better-sqlite3";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : fallback;
};

const DRY_RUN = flag("dry-run");
const FULL = flag("full");
const SAMPLE = flag("sample");
const RETRY_FAILED = flag("retry-failed");
const RETRY_DECLINED = flag("retry-declined");
const FORCE = flag("force");
const LIMIT = option("limit", undefined);
const CONCURRENCY = Number(option("concurrency", 5));
const BASE_URL = process.env.PARSE_CARDS_BASE_URL ?? "http://127.0.0.1:3001";
const DB_PATH = path.join(process.cwd(), "data", "cards.db");
const FAILED_LOG_PATH = path.join(process.cwd(), "data", "failed_cards.log");

// A ~50-card validation set spanning trigger-heavy, activated, static, and keyword-only cards —
// pulled from the same staples sampleDecks.ts already builds agent decks out of, so a good parse
// here is a real signal about parse quality on the cards that actually show up in-game.
const ICONIC_SAMPLE = [
  "Sol Ring", "Arcane Signet", "Command Tower", "Cultivate", "Kodama's Reach",
  "Skullclamp", "Guardian Project", "Beast Whisperer", "Rishkar's Expertise",
  "Swords to Plowshares", "Path to Exile", "Generous Gift", "Beast Within", "Chaos Warp",
  "Austere Command", "Blasphemous Act", "Damnation", "Toxic Deluge",
  "Heroic Intervention", "Swiftfoot Boots", "Lightning Greaves", "Teferi's Protection", "Boros Charm",
  "Eternal Witness", "Reclamation Sage", "Sakura-Tribe Elder", "Solemn Simulacrum", "Acidic Slime",
  "Avenger of Zendikar", "Sun Titan", "Seedborn Muse", "Victimize", "Living Death",
  "Young Pyromancer", "Talrand, Sky Summoner", "Blood Artist", "Zulaport Cutthroat", "Mikaeus, the Unhallowed",
  "Rhystic Study", "Smothering Tithe", "Cyclonic Rift", "Dockside Extortionist", "The One Ring",
  "Demonic Tutor", "Vampiric Tutor", "Mystical Tutor", "Enlightened Tutor",
  "Atraxa, Praetors' Voice", "Shalai, Voice of Plenty", "Kess, Dissident Mage", "Meren of Clan Nel Toth"
];

async function main() {
  await mkdir(path.dirname(DB_PATH), { recursive: true });
  // Round-trip through the running server first: this is what actually creates/migrates data/cards.db
  // (cardDb.ts's getCardDb() auto-seeds it from data/commander-cards.json on first call) — the script
  // itself only ever reads the file directly, it never migrates it.
  const initialStats = await fetchJson(`${BASE_URL}/api/rules/parse-card`, { method: "GET" });
  console.log(`Cards in DB: ${initialStats.totalCards} (${initialStats.vanilla} vanilla, ${initialStats.remaining} unparsed non-vanilla, ${initialStats.parsed} already cached).`);

  const db = new Database(DB_PATH, { readonly: true });
  const candidates = selectCandidates(db);
  db.close();

  if (candidates.length === 0) {
    console.log("No candidates to process.");
    return;
  }
  console.log(`Processing ${candidates.length} card(s) with concurrency ${CONCURRENCY}${DRY_RUN ? " (dry run — cache will not be written)" : ""}.`);

  // Keyed by result.status (parsed/dry_run/cached/skipped_vanilla/failed/error) plus, for
  // parsed/dry_run results, a parallel ok/declined split — kept separate from status so a cache
  // hit's stored parseStatus never gets conflated with a freshly-parsed one under the same key.
  const tally = { byStatus: {}, ok: 0, declined: 0 };
  let completed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < candidates.length) {
      const card = candidates[cursor];
      cursor += 1;
      const result = await parseOne(card);
      completed += 1;

      tally.byStatus[result.status] = (tally.byStatus[result.status] ?? 0) + 1;
      if ((result.status === "parsed" || result.status === "dry_run") && result.parseStatus) {
        tally[result.parseStatus] = (tally[result.parseStatus] ?? 0) + 1;
      }
      if (result.status === "failed" || result.status === "error") {
        await logFailure(card, result.error ?? "unknown error");
      }

      if (completed % 100 === 0 || completed === candidates.length) {
        console.log(
          `[${completed}/${candidates.length}] ok=${tally.ok} declined=${tally.declined} failed=${tally.byStatus.failed ?? 0} error=${tally.byStatus.error ?? 0} cached=${tally.byStatus.cached ?? 0}`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, worker));

  console.log("Done.", tally);
  if ((tally.byStatus.failed ?? 0) > 0 || (tally.byStatus.error ?? 0) > 0) {
    console.log(`Failures logged to ${FAILED_LOG_PATH} — re-run with --retry-failed once fixed.`);
  }
}

function selectCandidates(db) {
  if (RETRY_FAILED) {
    return db
      .prepare(`SELECT c.oracle_id, c.name FROM parsed_cards p JOIN cards c ON c.oracle_id = p.oracle_id WHERE p.parse_status = 'failed' ORDER BY c.name`)
      .all();
  }

  if (RETRY_DECLINED) {
    // Only llm_parsed rows — never touches a manual_override entry, same guard saveParsedCard
    // already enforces server-side; this filter just avoids the wasted round-trip.
    return db
      .prepare(
        `SELECT c.oracle_id, c.name FROM parsed_cards p JOIN cards c ON c.oracle_id = p.oracle_id WHERE p.parse_status = 'declined' AND p.source = 'llm_parsed' ORDER BY c.name`
      )
      .all();
  }

  if (SAMPLE) {
    const placeholders = ICONIC_SAMPLE.map(() => "?").join(",");
    return db.prepare(`SELECT oracle_id, name FROM cards WHERE name IN (${placeholders})`).all(...ICONIC_SAMPLE);
  }

  const limitClause = !FULL && LIMIT ? "LIMIT ?" : !FULL ? "LIMIT 200" : "";
  const sql = `
    SELECT c.oracle_id, c.name FROM cards c
    LEFT JOIN parsed_cards p ON p.oracle_id = c.oracle_id
    WHERE p.oracle_id IS NULL AND trim(c.oracle_text) != ''
    ORDER BY c.name
    ${limitClause}
  `;
  return limitClause === "LIMIT ?" ? db.prepare(sql).all(Number(LIMIT)) : db.prepare(sql).all();
}

async function parseOne(card, attempt = 0) {
  try {
    const result = await fetchJson(`${BASE_URL}/api/rules/parse-card`, {
      method: "POST",
      body: JSON.stringify({ oracleId: card.oracle_id, dryRun: DRY_RUN, force: FORCE || RETRY_FAILED || RETRY_DECLINED })
    });
    return result;
  } catch (error) {
    if (attempt < 3) {
      const backoffMs = 500 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return parseOne(card, attempt + 1);
    }
    return { status: "error", oracleId: card.oracle_id, cardName: card.name, error: error instanceof Error ? error.message : String(error) };
  }
}

async function logFailure(card, error) {
  await appendFile(FAILED_LOG_PATH, `${new Date().toISOString()}\t${card.oracle_id}\t${card.name}\t${error}\n`, "utf8");
}

async function fetchJson(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json" }
  });
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${url} -> HTTP ${response.status}`);
  }
  return response.json();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
