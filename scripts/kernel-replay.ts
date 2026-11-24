// Replays a kernel game saved by the table's "Save game log" button (data/observer/live-logs/<timestamp>.json) and prints its stack log.
//   npm run kernel:replay -- <file> [--until N] [--state-out PATH] [--quiet]
// The engine is deterministic, so the saved start state plus the ordered actions rebuild the exact game. --until N stops after N actions and writes the full state
// there (default: <file>.state-N.json next to the file) so the position can be loaded in a test; a step whose result differs from the recording is reported.
import "../src/kernel/engine/resolve"; // FIRST: the engine modules import each other in a cycle that only initialises when resolve.ts is entered first
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadDraftLookup } from "../src/kernel/observer";
import { createEngine } from "../src/kernel/engine";
import { replayGame, finalSummary } from "../src/kernel/integration/replayFile";
import { readReplayFile } from "../src/kernel/integration/replayStore";
import { draftHash } from "../src/kernel/integration/draftHash";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a));
const opt = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!file) { console.error("usage: kernel-replay <file.json> [--until N] [--state-out PATH] [--quiet]"); process.exit(2); }

const replay = readReplayFile(file);
for (const [slug, hash] of Object.entries(replay.meta.draftHashes)) {
  try { const now = draftHash(slug); if (now !== hash) console.warn(`warning: the drafts of "${slug}" changed since the game was saved (${hash} -> ${now}); the replay may diverge`); } catch { /* deck folder gone */ }
}
const lookup = loadDraftLookup();
const ctx = createEngine(lookup.lookup, lookup.db).ctx;
const untilArg = opt("--until");
const until = untilArg === undefined ? undefined : Number(untilArg);
const res = replayGame(replay, ctx, until !== undefined ? { until } : {});

console.log(`game ${replay.meta.gameId}: ${replay.meta.decks.join(" vs ")}, seed ${replay.seed}, saved ${replay.savedAt}`);
console.log(`replayed ${res.applied} of ${replay.steps.length} action(s)${res.divergence ? "" : " without divergence"}`);
if (res.divergence) console.log(`DIVERGENCE at action ${res.divergence.step}: ${res.divergence.why}\n  recorded: ${res.divergence.expected}\n  replayed: ${res.divergence.got}`);
if (!args.includes("--quiet")) console.log(`\n--- stack log ---\n${res.stackLog}\n`);
console.log("--- final state ---");
console.log(JSON.stringify(finalSummary(res.ks.state), null, 1));
if (until !== undefined || opt("--state-out")) {
  const out = opt("--state-out") ?? path.join(path.dirname(file), `${path.basename(file, ".json")}.state-${until}.json`);
  if (!existsSync(path.dirname(path.resolve(out)))) { console.error(`cannot write ${out}: folder missing`); process.exit(1); }
  writeFileSync(out, JSON.stringify(res.ks.state), "utf8");
  console.log(`state after ${res.applied} action(s) written to ${out}`);
}
process.exit(res.divergence ? 1 : 0);
