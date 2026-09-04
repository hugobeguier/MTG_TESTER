// Manual override tool — mtg-commander-engine-spec.md's Phase 1, point 6: let a human hand-correct
// a card whose LLM parse (cardParser.ts, cached via cardDb.ts) got it wrong. Writes go through
// /api/rules/override-card with source: "manual_override", which saveParsedCard's own guard
// (cardDb.ts) then protects forever from being overwritten by a future bulk llm_parsed re-run
// (scripts/parse-cards.mjs --full / --retry-declined / --retry-failed).
//
// Usage:
//   node scripts/override-card.mjs --name "Blood Artist" --show
//     Prints the card's oracle text and current cached parse (if any) — a starting point to edit.
//   node scripts/override-card.mjs --name "Blood Artist" --file correction.json
//     Reads { "abilities": [...] } from correction.json (same shape cardParser.ts's Ability/
//     AbilitySchema uses — copy the "cached.abilities" array from --show's output and edit it) and
//     saves it as a manual_override.
//   node scripts/override-card.mjs --oracle-id <id> --file correction.json
//     Same, addressed by oracle_id instead of name (use this if the name is ambiguous).
//   PARSE_CARDS_BASE_URL=http://127.0.0.1:3001 node scripts/override-card.mjs --name "..." --show

import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const option = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);

const NAME = option("name");
const ORACLE_ID = option("oracle-id");
const FILE = option("file");
const SHOW = flag("show");
const BASE_URL = process.env.PARSE_CARDS_BASE_URL ?? "http://127.0.0.1:3001";

async function main() {
  if (!NAME && !ORACLE_ID) {
    console.error('Provide --name "Card Name" or --oracle-id <id>.');
    process.exit(1);
  }

  if (SHOW) {
    const params = new URLSearchParams();
    if (ORACLE_ID) params.set("oracleId", ORACLE_ID);
    if (NAME) params.set("name", NAME);
    const result = await fetchJson(`${BASE_URL}/api/rules/override-card?${params}`);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!FILE) {
    console.error('Provide --file <path to JSON with { "abilities": [...] }>, or --show to inspect the card first.');
    process.exit(1);
  }

  const correction = JSON.parse(await readFile(FILE, "utf8"));
  if (!Array.isArray(correction.abilities)) {
    console.error('Correction file must have an "abilities" array — run with --show first to see the expected shape.');
    process.exit(1);
  }

  const result = await fetchJson(`${BASE_URL}/api/rules/override-card`, {
    method: "POST",
    body: JSON.stringify({ oracleId: ORACLE_ID, name: NAME, abilities: correction.abilities })
  });
  console.log(JSON.stringify(result, null, 2));
}

async function fetchJson(url, init) {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
  const body = await response.json();
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${url} -> HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
