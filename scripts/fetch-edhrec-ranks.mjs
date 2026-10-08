import { createReadStream, createWriteStream } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

// Writes data/edhrec-ranks.json ({ "Card Name": rank }, lower = more played) from Scryfall's oracle-cards bulk file. It never touches
// data/commander-cards.json, so the card texts the tests are built on stay exactly as they are. Used by `npm run choice-audit` to
// put the cards most players bring first.
const HEADERS = { "user-agent": "MTG-AI Commander Lab/0.1 (https://github.com/hugobeguier/MTG-AI)", accept: "application/json;q=0.9,*/*;q=0.8" };
const TMP = path.join(process.cwd(), "data", "oracle-cards-ranks.jsonl.gz");
const OUT = path.join(process.cwd(), "data", "edhrec-ranks.json");

const index = await (await fetch("https://api.scryfall.com/bulk-data", { headers: HEADERS })).json();
const bulk = index.data?.find((entry) => entry.type === "oracle_cards");
if (!bulk?.jsonl_download_uri) throw new Error("Scryfall bulk-data index has no oracle_cards jsonl_download_uri.");
const response = await fetch(bulk.jsonl_download_uri, { headers: HEADERS });
if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status}`);
await pipeline(Readable.fromWeb(response.body), createWriteStream(TMP));

const ranks = {};
const rl = readline.createInterface({ input: createReadStream(TMP).pipe(createGunzip()), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const card = JSON.parse(line);
  if (card.object === "card" && typeof card.edhrec_rank === "number") ranks[card.name] = card.edhrec_rank;
}
await writeFile(OUT, JSON.stringify(ranks));
await rm(TMP, { force: true });
console.log(`Wrote ${Object.keys(ranks).length} ranks to ${OUT}`);
