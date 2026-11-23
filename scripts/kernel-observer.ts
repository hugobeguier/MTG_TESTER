// Headless kernel observer: runs AI-vs-AI self-play games on the legacy engine and, after every applied action, runs the kernel beside it and
// logs every disagreement. See src/kernel/observer/README.md.
//
//   npm run kernel:observe -- --games 20 --seed 1 --decks Meren,Saheeli,"Wretched Ranks"
//   options: --games N  --seed S  --decks a,b[,c...]  --timeout-ms 120000  --first-seat 0|1  --max-diffs-per-game N  --lenient  --continue  --out DIR
//   --continue: run the kernel in live-game mode (config.onUnsupported = "continue"): unsupported cards / abilities become `unresolved` events (written to
//   <out>/kernel-unresolved.jsonl in the live sink format, engine "kernel") instead of "kernel refused" diffs; `npm run unresolved:report -- <out>` merges them with the legacy ones
// Game i uses decks[i % n] vs decks[(i + 1) % n], seed S + i (seeds the setup AND the whole game, see seedRuntime), first seat i % 2 unless --first-seat.
// Every game runs in its own child process under a wall-clock watchdog (--watchdog-ms, default 240000): a game that never returns (a synchronous loop in the
// legacy engine, the kernel or the observer) is killed, counted as `hang`, written to <out>/hangs.jsonl with its repro, and the batch continues.
// --in-process runs the games in this process instead (no watchdog; a hang freezes the run).
// A diff line carries `repro`: the exact command that replays that single game.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { writeSync } from "node:fs";
import { heuristicBrain } from "../src/lib/selfplay/brains";
import { createSelfPlayGame, playGame, seedRuntime } from "../src/lib/selfplay/orchestrator";
import type { UnresolvedRecord } from "../src/lib/unresolvedLog";
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

interface GameSpec { g: number; a: string; b: string; seed: number; firstSeat: number; lenient: boolean; continueMode: boolean; timeoutMs: number; maxDiffsPerGame: number }
interface GameResult { reason: string; turns: number; legacyUnresolved: Array<import("../src/lib/types").UnresolvedEffectRecord>; stall?: import("../src/lib/selfplay/orchestrator").StallDiagnostic; lastActions?: string[] }

/** plays and observes ONE game in this process (seeds the runtime, restores it afterwards) */
async function playOne(spec: GameSpec, lookup: ReturnType<typeof loadDraftLookup>, aggregate: Aggregate, onDiff: (d: Diff) => void, onUnresolved: (r: UnresolvedRecord) => void, trace?: (line: string) => void): Promise<GameResult> {
  const { g, a, b, seed, firstSeat } = spec;
  const restore = seedRuntime(seed);
  try {
    const session = createSelfPlayGame({ deckListPaths: [deckFile(a), deckFile(b)], seatNames: [a, b], forceFirstSeatIndex: firstSeat, seed });
    const observer = new KernelObserver({
      lookup, game: g, seed, decks: [a, b], aggregate, lenient: spec.lenient, maxDiffsPerGame: spec.maxDiffsPerGame, ...(spec.continueMode ? { onUnsupported: "continue" as const, onUnresolved } : {}),
      deckOfSeat: { [session.seats[0].id]: a, [session.seats[1].id]: b },
      sink: onDiff
    });
    const brains = { [session.seats[0].id]: heuristicBrain, [session.seats[1].id]: heuristicBrain };
    const result = await playGame(session, brains, { timeoutMs: spec.timeoutMs, onAction: (p, n, m) => { trace?.(`t${n.turn} ${n.phase} ${m.seatId ?? ""} ${m.actionType}${m.actionLabel ? " " + m.actionLabel : ""}`); observer.onAction(p, n, { ...m, seatId: m.seatId ?? "" } as ObserverMeta); } });
    observer.finish();
    return { reason: result.terminationReason, turns: result.turns, legacyUnresolved: result.session.unresolvedEffects ?? [], ...(result.stallDiagnostic ? { stall: result.stallDiagnostic } : {}) };
  } finally { restore(); }
}

const EV = "@@ev ";
const emit = (o: unknown): void => { writeSync(1, EV + JSON.stringify(o) + "\n"); };
/** child side: forwards every outcome / diff / unresolved record / action trace to the parent as one JSON line each */
class StreamAggregate extends Aggregate {
  override addOutcome(o: Parameters<Aggregate["addOutcome"]>[0]): void { emit({ t: "outcome", o }); }
  override addDiff(d: Diff): void { emit({ t: "diff", d }); }
}
async function childMain(spec: GameSpec): Promise<void> {
  const r = await playOne(spec, loadDraftLookup(), new StreamAggregate(), () => {}, (rec) => emit({ t: "unresolved", rec }), (line) => emit({ t: "act", line }));
  emit({ t: "result", r });
}

/** parent side: runs one game in a child process; no result within watchdogMs => the child is killed and the game is a `hang` */
function runInChild(spec: GameSpec, watchdogMs: number, aggregate: Aggregate, onDiff: (d: Diff) => void, onUnresolved: (r: UnresolvedRecord) => void, argv: string[]): Promise<GameResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join("node_modules", "vite-node", "vite-node.mjs"), "-c", "vitest.config.ts", "scripts/kernel-observer.ts", "--", ...argv.filter((x) => x !== "--in-process"), "--child", JSON.stringify(spec)], { stdio: ["ignore", "pipe", "inherit"] });
    const recent: string[] = [];
    let result: GameResult | undefined;
    let done = false;
    const finish = (r: GameResult): void => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish({ reason: "hang", turns: 0, legacyUnresolved: [], lastActions: [...recent] }); }, watchdogMs);
    createInterface({ input: child.stdout! }).on("line", (line) => {
      if (!line.startsWith(EV)) return;
      try {
        const m = JSON.parse(line.slice(EV.length));
        if (m.t === "outcome") aggregate.addOutcome(m.o);
        else if (m.t === "diff") { aggregate.addDiff(m.d); onDiff(m.d); }
        else if (m.t === "unresolved") onUnresolved(m.rec);
        else if (m.t === "act") { recent.push(m.line); if (recent.length > 12) recent.shift(); }
        else if (m.t === "result") result = m.r;
      } catch { /* ignore a malformed line */ }
    });
    child.on("exit", () => setTimeout(() => finish(result ? { ...result, lastActions: [...recent] } : { reason: "crash", turns: 0, legacyUnresolved: [], lastActions: [...recent] }), 200));
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((x) => x !== "--");
  const args = parseArgs(argv);
  if (typeof args.child === "string") { await childMain(JSON.parse(args.child) as GameSpec); return; }
  const inProcess = args["in-process"] === true;
  const watchdogMs = Number(args["watchdog-ms"] ?? 240000);
  const games = Number(args.games ?? 5);
  const baseSeed = args.seed !== undefined && args.seed !== true ? Number(args.seed) : 1;
  // ";" separates the names when any name contains a comma ("Breena, the Demagogue"); otherwise ","
  const decksArg = String(args.decks ?? "Meren,Saheeli");
  const decks = decksArg.split(decksArg.includes(";") ? ";" : ",").map((d) => d.trim()).filter(Boolean);
  if (decks.length < 2) throw new Error("--decks needs at least two deck names");
  const timeoutMs = Number(args["timeout-ms"] ?? 120000);
  const firstSeatArg = args["first-seat"] !== undefined && args["first-seat"] !== true ? Number(args["first-seat"]) : undefined;
  const maxDiffsPerGame = Number(args["max-diffs-per-game"] ?? 400);
  const lenient = args.lenient === true;
  const continueMode = args.continue === true;
  const startIndex = Number(args["start-index"] ?? 0);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = typeof args.out === "string" ? args.out : path.join(process.cwd(), "data", "observer", stamp);
  mkdirSync(outDir, { recursive: true });
  const diffsFile = path.join(outDir, "diffs.jsonl");
  writeFileSync(diffsFile, "");
  const kernelUnresolvedFile = path.join(outDir, "kernel-unresolved.jsonl");
  writeFileSync(kernelUnresolvedFile, "");
  const kernelUnresolved: UnresolvedRecord[] = [];

  const lookup = loadDraftLookup();
  const aggregate = new Aggregate();
  const terminations: Record<string, number> = {};
  let crashed = 0;
  const legacyUnresolved: Array<import("../src/lib/types").UnresolvedEffectRecord> = [];
  const t0 = Date.now();
  console.log(`kernel observer: ${games} game(s), decks ${decks.join(" | ")}, base seed ${baseSeed}, drafts ${lookup.draftCount()} -> ${outDir}`);

  for (let i = 0; i < games; i++) {
    const g = startIndex + i;
    const a = decks[g % decks.length], b = decks[(g + 1) % decks.length];
    const seed = baseSeed + g;
    const firstSeat = firstSeatArg ?? g % 2;
    const repro = `npm run kernel:observe -- --games 1 --seed ${seed} --decks "${a};${b}" --first-seat ${firstSeat}${lenient ? " --lenient" : ""}${continueMode ? " --continue" : ""}`;
    const started = Date.now();
    let reason = "crash";
    let turns = 0;
    let gameDiffs = 0;
    const onDiff = (d: Diff): void => { gameDiffs++; appendFileSync(diffsFile, JSON.stringify({ ...d, repro }) + "\n"); };
    const onUnresolved = (rec: UnresolvedRecord): void => { kernelUnresolved.push(rec); appendFileSync(kernelUnresolvedFile, JSON.stringify(rec) + "\n"); };
    const spec: GameSpec = { g, a, b, seed, firstSeat, lenient, continueMode, timeoutMs, maxDiffsPerGame };
    try {
      if (inProcess) {
        const r = await playOne(spec, lookup, aggregate, onDiff, onUnresolved);
        reason = r.reason; turns = r.turns;
        for (const u of r.legacyUnresolved) legacyUnresolved.push(u);
      } else {
        const r = await runInChild(spec, watchdogMs, aggregate, onDiff, onUnresolved, argv);
        reason = r.reason; turns = r.turns;
        for (const u of r.legacyUnresolved) legacyUnresolved.push(u);
        if (r.reason === "hang") {
          appendFileSync(path.join(outDir, "hangs.jsonl"), JSON.stringify({ game: g, seed, decks: [a, b], firstSeat, watchdogMs, repro, lastActions: r.lastActions }) + "\n");
          console.error(`game ${g} HUNG (no result after ${watchdogMs} ms, child killed); last actions: ${(r.lastActions ?? []).slice(-3).join(" | ")}
  repro: ${repro}`);
        }
        if (r.stall) console.error(`game ${g} stalled (${r.stall.reason}) at turn ${r.stall.turn} ${r.stall.phase}; last actions: ${r.stall.lastActions.slice(-4).join(" | ")}`);
      }
    } catch (error) {
      crashed++;
      console.error(`game ${g} crashed in the legacy engine/orchestrator: ${error instanceof Error ? error.message : error}`);
    }
    aggregate.games++;
    terminations[reason] = (terminations[reason] ?? 0) + 1;
    console.log(`game ${i + 1}/${games} [${a} vs ${b}] seed ${seed}: ${reason}, ${turns} turns, ${gameDiffs} diffs, ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }

  const report = renderReport(aggregate, { startedAt: new Date(t0).toISOString(), games, seed: baseSeed, decks, wallClockMs: Date.now() - t0, terminations, crashed, command: `npm run kernel:observe -- --games ${games} --seed ${baseSeed} --decks "${decks.join(";")}"` });
  writeFileSync(path.join(outDir, "report.md"), report);
  writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ byCategory: aggregate.byCategory, byDeck: aggregate.byDeck, byIntent: aggregate.byIntent, byField: aggregate.byField, byCapability: aggregate.byCapability, actions: aggregate.actions }, null, 2));
  // Legacy engine "Couldn't resolve" clauses seen in these games (engine/unresolved.ts); the jsonl also feeds `npm run unresolved:report -- <file>`.
  writeFileSync(path.join(outDir, "legacy-unresolved.jsonl"), legacyUnresolved.map((u) => JSON.stringify(u)).join("\n") + (legacyUnresolved.length ? "\n" : ""));
  const unresolvedByCard = new Map<string, number>();
  for (const u of legacyUnresolved) unresolvedByCard.set(`${u.cardName} - ${u.clause}`, (unresolvedByCard.get(`${u.cardName} - ${u.clause}`) ?? 0) + 1);
  console.log("\nlegacy unresolved effects by card");
  console.table([...unresolvedByCard.entries()].sort((x, y) => y[1] - x[1]).slice(0, 25).map(([card, times]) => ({ card, times })));
  if (continueMode) {
    const keyOf = (u: UnresolvedRecord): string => `${u.cardName} - ${u.capability ?? ""} - ${u.clause.slice(0, 60)}`;
    const byKey = new Map<string, number>();
    for (const u of kernelUnresolved) byKey.set(keyOf(u), (byKey.get(keyOf(u)) ?? 0) + 1);
    console.log(`\nkernel unresolved (continue mode): ${kernelUnresolved.length} records -> ${kernelUnresolvedFile}`);
    console.table([...byKey.entries()].sort((x, y) => y[1] - x[1]).slice(0, 25).map(([card, times]) => ({ card, times })));
  }
  console.log(`\nreport:${path.join(outDir, "report.md")}\ndiffs:  ${diffsFile}`);
  console.log(report.split("\n").slice(0, 14).join("\n"));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
