// Replays recorded legacy steps (JSONL of RecordedStep, see src/kernel/observer/recorder.ts) through the kernel observer, offline.
//   npm run kernel:observe-replay -- path/to/steps.jsonl [--out DIR]
// Why a file and not a live hook: the legacy GameSession exists only inside the browser (AppFlow.tsx); a host that wants live observation calls
// recordStep() (flag MTG_KERNEL_OBSERVER=1) from its intent handler and replays the file here. Without `intent` a step needs `meta` (orchestrator style).
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Aggregate, compareIntent, loadDraftLookup, mapIntent, renderReport, type RecordedStep, type ObserverMeta } from "../src/kernel/observer";
import { createEngine } from "../src/kernel/engine";

const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!file) { console.error("usage: kernel-observe-replay <steps.jsonl> [--out DIR]"); process.exit(2); }
const outArg = process.argv.indexOf("--out");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = outArg > 0 ? process.argv[outArg + 1] : path.join(process.cwd(), "data", "observer", `replay-${stamp}`);
mkdirSync(outDir, { recursive: true });
const diffsFile = path.join(outDir, "diffs.jsonl");
writeFileSync(diffsFile, "");

const lookup = loadDraftLookup();
const ctx = createEngine(lookup.lookup, lookup.db).ctx;
const agg = new Aggregate();
const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
const t0 = Date.now();
lines.forEach((line, i) => {
  const step = JSON.parse(line) as RecordedStep;
  const meta: ObserverMeta = step.meta ?? { seatId: step.intent?.seat ?? "", turn: step.s0.turn, phase: step.s0.phase, actionType: step.intent?.name ?? "unknown" };
  const mapped = step.intent ? mapIntent(step.intent.name, step.intent.args, step.intent.seat, step.s0) : undefined;
  const { outcome } = compareIntent(step.s0, step.s1, meta, { lookup, ctx, actionIndex: i, legacyAccepted: step.accepted !== false, ...(mapped ? { mapped } : {}) });
  agg.addOutcome(outcome);
  for (const d of outcome.diffs) { agg.addDiff(d); appendFileSync(diffsFile, JSON.stringify(d) + "\n"); }
});
agg.games = 1;
writeFileSync(path.join(outDir, "report.md"), renderReport(agg, { startedAt: new Date(t0).toISOString(), games: 1, decks: [path.basename(file)], wallClockMs: Date.now() - t0, terminations: {}, crashed: 0 }));
console.log(`replayed ${lines.length} step(s): ${JSON.stringify(agg.byCategory)}\nreport: ${path.join(outDir, "report.md")}`);
