// Headless kernel observer: runs AI-vs-AI self-play games on the legacy engine and, after every applied action, runs the kernel beside it and
// logs every disagreement. See src/kernel/observer/README.md.
//
//   npm run kernel:observe -- --games 20 --seed 1 --decks Meren,Saheeli,"Wretched Ranks"
//   options: --games N  --seed S  --decks a,b[,c...]  --timeout-ms 120000  --first-seat 0|1  --max-diffs-per-game N  --lenient  --out DIR
// Game i uses decks[i % n] vs decks[(i + 1) % n], seed S + i (seeds the setup AND the whole game, see seedRuntime), first seat i % 2 unless --first-seat.
// A diff line carries `repro`: the exact command that replays that single game.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { heuristicBrain } from "../src/lib/selfplay/brains";
import { createSelfPlayGame, playGame, seedRuntime } from "../src/lib/selfplay/orchestrator";
import { Aggregate, KernelObserver, loadDraftLookup, renderReport, type Diff, type ObserverMeta } from "../src/kernel/observer";

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { out[a.slice(2)] = next; i++; } else out[a.slice(2)] = true;
  }
  return out;
}

const deckFile = (name: string): string => (/\.txt$/i.test(name) ? name : `${name}.txt`);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const games = Number(args.games ?? 5);
  const baseSeed = args.seed !== undefined && args.seed !== true ? Number(args.seed) : 1;
  const decks = String(args.decks ?? "Meren,Saheeli").split(",").map((d) => d.trim()).filter(Boolean);
  if (decks.length < 2) throw new Error("--decks needs at least two deck names");
  const timeoutMs = Number(args["timeout-ms"] ?? 120000);
  const firstSeatArg = args["first-seat"] !== undefined && args["first-seat"] !== true ? Number(args["first-seat"]) : undefined;
  const maxDiffsPerGame = Number(args["max-diffs-per-game"] ?? 400);
  const lenient = args.lenient === true;
  const startIndex = Number(args["start-index"] ?? 0);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = typeof args.out === "string" ? args.out : path.join(process.cwd(), "data", "observer", stamp);
  mkdirSync(outDir, { recursive: true });
  const diffsFile = path.join(outDir, "diffs.jsonl");
  writeFileSync(diffsFile, "");

  const lookup = loadDraftLookup();
  const aggregate = new Aggregate();
  const terminations: Record<string, number> = {};
  let crashed = 0;
  const t0 = Date.now();
  console.log(`kernel observer: ${games} game(s), decks ${decks.join(" | ")}, base seed ${baseSeed}, drafts ${lookup.draftCount()} -> ${outDir}`);

  for (let i = 0; i < games; i++) {
    const g = startIndex + i;
    const a = decks[g % decks.length], b = decks[(g + 1) % decks.length];
    const seed = baseSeed + g;
    const firstSeat = firstSeatArg ?? g % 2;
    const repro = `npm run kernel:observe -- --games 1 --seed ${seed} --decks ${a},${b} --first-seat ${firstSeat}${lenient ? " --lenient" : ""}`;
    const restore = seedRuntime(seed);
    const started = Date.now();
    let reason = "crash";
    let turns = 0;
    let gameDiffs = 0;
    try {
      const session = createSelfPlayGame({ deckListPaths: [deckFile(a), deckFile(b)], seatNames: [a, b], forceFirstSeatIndex: firstSeat, seed });
      const observer = new KernelObserver({
        lookup, game: g, seed, decks: [a, b], aggregate, lenient, maxDiffsPerGame,
        deckOfSeat: { [session.seats[0].id]: a, [session.seats[1].id]: b },
        sink: (d: Diff) => { gameDiffs++; appendFileSync(diffsFile, JSON.stringify({ ...d, repro }) + "\n"); }
      });
      const brains = { [session.seats[0].id]: heuristicBrain, [session.seats[1].id]: heuristicBrain };
      const result = await playGame(session, brains, { timeoutMs, onAction: (p, n, m) => observer.onAction(p, n, { ...m, seatId: m.seatId ?? "" } as ObserverMeta) });
      observer.finish();
      reason = result.terminationReason;
      turns = result.turns;
    } catch (error) {
      crashed++;
      console.error(`game ${g} crashed in the legacy engine/orchestrator: ${error instanceof Error ? error.message : error}`);
    } finally {
      restore();
    }
    aggregate.games++;
    terminations[reason] = (terminations[reason] ?? 0) + 1;
    console.log(`game ${i + 1}/${games} [${a} vs ${b}] seed ${seed}: ${reason}, ${turns} turns, ${gameDiffs} diffs, ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }

  const report = renderReport(aggregate, { startedAt: new Date(t0).toISOString(), games, seed: baseSeed, decks, wallClockMs: Date.now() - t0, terminations, crashed, command: `npm run kernel:observe -- --games ${games} --seed ${baseSeed} --decks ${decks.join(",")}` });
  writeFileSync(path.join(outDir, "report.md"), report);
  writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ byCategory: aggregate.byCategory, byDeck: aggregate.byDeck, byIntent: aggregate.byIntent, byField: aggregate.byField, byCapability: aggregate.byCapability, actions: aggregate.actions }, null, 2));
  console.log(`\nreport: ${path.join(outDir, "report.md")}\ndiffs:  ${diffsFile}`);
  console.log(report.split("\n").slice(0, 14).join("\n"));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
