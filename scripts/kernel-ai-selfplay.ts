// Kernel-only AI self-play: every seat is driven by the kernel AI (chooseAiAction) on a KernelSession, with real drafted decks. Measures the lookahead AI against
// the frozen pre-lookahead heuristics (scripts/kernel-ai-baseline.ts).
//
//   npm run kernel:ai-selfplay -- --games 20 --seed 100 --decks "Aminatou;Saheeli;Meren;The Ur Dragon" [--ai new|old|both] [--turns 40] [--watchdog-ms 300000]
// Game i uses seed S + i. Every game runs in its own child process under a wall-clock watchdog (a game that never returns is killed and counted as `hang`).
// Per-turn action cap: 400 AI steps (then the turn is force-passed and counted). Output: one summary table per AI variant.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { KernelSession } from "../src/kernel/integration/kernelSession";
import { ctx, deckNames } from "../src/kernel/integration/testgame";
import { chooseAiAction as chooseNew, type AiMemory } from "../src/components/game/kernelAi";
import { chooseAiAction as chooseOld } from "./kernel-ai-baseline";
import { evaluate } from "../src/kernel/ai/evaluate";
import type { Action, PlayerId } from "../src/kernel/engine/types";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) { const n = argv[i + 1]; if (n !== undefined && !n.startsWith("--")) { out[argv[i].slice(2)] = n; i++; } else out[argv[i].slice(2)] = "1"; }
  return out;
}

interface Spec { ai: "new" | "old"; seed: number; decks: string[]; turns: number }
interface Result {
  ai: string; seed: number; finished: boolean; reason: string; turns: number; winner?: string; casts: number; noopCasts: number; harmfulCasts: number; activations: number; decisions: number; aiMs: number; maxDecisionMs: number; capHits: number;
  noopNames: string[];
}

function playGame(spec: Spec): Result {
  const players = spec.decks.map((d, i) => { const { cards, commander } = deckNames(d); return { id: `p${i + 1}`, name: d, deck: cards, ...(commander ? { commander } : {}), kind: "agent" as const }; });
  const ks = KernelSession.fromDecks({ ctx, decks: players, seed: spec.seed, startPhase: "precombat_main" });
  const choose = spec.ai === "new" ? chooseNew : chooseOld;
  const mem: Record<string, AiMemory> = {}; let memTurn = -1;
  const r: Result = { ai: spec.ai, seed: spec.seed, finished: false, reason: "", turns: 0, casts: 0, noopCasts: 0, harmfulCasts: 0, activations: 0, decisions: 0, aiMs: 0, maxDecisionMs: 0, capHits: 0, noopNames: [] };
  let watch: { seat: PlayerId; id: string; sig: string; score: number; name: string } | undefined;
  let turnSteps = 0, lastTurn = -1, total = 0;
  while (!ks.gameOver && total++ < 60000) {
    const s = ks.state;
    if (s.turn.number > spec.turns) { r.reason = "turn cap"; break; }
    if (s.turn.number !== lastTurn) { lastTurn = s.turn.number; turnSteps = 0; }
    if (memTurn !== s.turn.number) { for (const k of Object.keys(mem)) mem[k] = { banned: new Set() }; memTurn = s.turn.number; }
    if (watch && !s.pending && s.stack.length === 0) {
      const ev = evaluate(s, ctx, watch.seat, watch.id);
      if (ev.sig === watch.sig) { r.noopCasts++; r.noopNames.push(watch.name); }
      else if (ev.score - watch.score < -2) r.harmfulCasts++;
      watch = undefined;
    }
    const actor = ks.actor;
    if (!actor) { r.reason = "no actor"; break; }
    mem[actor] ??= { banned: new Set() };
    const acts = ks.legal(actor);
    const t0 = performance.now();
    let action: Action | undefined = choose(acts, s, ctx, actor, mem[actor]);
    const dt = performance.now() - t0;
    r.aiMs += dt; r.decisions++; r.maxDecisionMs = Math.max(r.maxDecisionMs, dt);
    if (dt > 700 && process.env.AI_SLOW) process.stderr.write("slow " + dt.toFixed(0) + "ms turn " + s.turn.number + " " + actor + " " + s.turn.phase + " acts=" + acts.length + " -> " + JSON.stringify(action) + "\n");
    if (!action) { r.reason = "no action"; break; }
    if (++turnSteps > 400) { r.capHits++; const pass = acts.find((a) => a.kind === "passPriority")?.action; if (pass && !s.pending) action = pass; if (turnSteps > 1200) { r.reason = "action cap"; break; } }
    if (action.type === "castSpell" || action.type === "activateAbility") {
      const a = acts.find((x) => x.action === action);
      if (action.type === "castSpell") r.casts++; else r.activations++;
      const ex = a?.objectId; const ev = evaluate(s, ctx, actor, ex);
      if (!watch) watch = { seat: actor, id: ex ?? "", sig: ev.sig, score: ev.score, name: a?.label ?? action.type };
    }
    const res = ks.dispatch(actor, action);
    if (!res.ok) { const pass = acts.find((x) => x.kind === "passPriority")?.action ?? { type: "passPriority" as const, player: actor }; if (s.pending || ks.state.pending) { r.reason = `refused decision: ${res.error?.message}`; break; } ks.dispatch(actor, pass); }
  }
  r.turns = ks.state.turn.number;
  if (ks.gameOver) { r.finished = true; r.winner = ks.gameOver.winner ? players.find((p) => p.id === ks.gameOver!.winner)?.name : "draw"; r.reason = ks.gameOver.reason; }
  else if (!r.reason) r.reason = "step cap";
  return r;
}

const EV = "@@res ";
const args = parseArgs(process.argv.slice(2));

if (args.child) {
  const r = playGame(JSON.parse(args.child) as Spec);
  process.stdout.write(EV + JSON.stringify(r) + "\n");
  process.exit(0);
}

function runChild(spec: Spec, watchdogMs: number): Promise<Result> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join("node_modules", "vite-node", "vite-node.mjs"), "-c", "vitest.config.ts", "scripts/kernel-ai-selfplay.ts", "--", "--child", JSON.stringify(spec)], { stdio: ["ignore", "pipe", "inherit"] });
    let done = false;
    const finish = (r: Result): void => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish({ ai: spec.ai, seed: spec.seed, finished: false, reason: "hang", turns: 0, casts: 0, noopCasts: 0, harmfulCasts: 0, activations: 0, decisions: 0, aiMs: 0, maxDecisionMs: 0, capHits: 0, noopNames: [] }); }, watchdogMs);
    createInterface({ input: child.stdout! }).on("line", (line) => { if (line.startsWith(EV)) finish(JSON.parse(line.slice(EV.length)) as Result); });
    child.on("exit", () => finish({ ai: spec.ai, seed: spec.seed, finished: false, reason: "child exited", turns: 0, casts: 0, noopCasts: 0, harmfulCasts: 0, activations: 0, decisions: 0, aiMs: 0, maxDecisionMs: 0, capHits: 0, noopNames: [] }));
  });
}

async function main(): Promise<void> {
  const games = Number(args.games ?? 4), seed = Number(args.seed ?? 100), turns = Number(args.turns ?? 40), watchdog = Number(args["watchdog-ms"] ?? 300000);
  const decks = (args.decks ?? "Aminatou;Saheeli;Meren;The Ur Dragon").split(/[;,]/).map((d) => d.trim()).filter(Boolean);
  const variants = args.ai === "new" ? ["new"] : args.ai === "old" ? ["old"] : ["old", "new"];
  for (const ai of variants as Array<"new" | "old">) {
    const results: Result[] = [];
    for (let i = 0; i < games; i++) {
      // rotate the seating so no deck always starts
      const rot = i % decks.length;
      const order = [...decks.slice(rot), ...decks.slice(0, rot)];
      const r = await runChild({ ai, seed: seed + i, decks: order, turns }, watchdog);
      results.push(r);
      process.stderr.write(`[${ai}] game ${i + 1}/${games} seed ${r.seed}: ${r.finished ? `won by ${r.winner}` : r.reason} turn ${r.turns} casts ${r.casts} noop ${r.noopCasts}\n`);
    }
    const sum = (f: (r: Result) => number) => results.reduce((a, r) => a + f(r), 0);
    const wins: Record<string, number> = {};
    for (const r of results) if (r.finished) wins[r.winner ?? "?"] = (wins[r.winner ?? "?"] ?? 0) + 1;
    const noopNames: Record<string, number> = {};
    for (const r of results) for (const n of r.noopNames) noopNames[n] = (noopNames[n] ?? 0) + 1;
    const fin = results.filter((r) => r.finished);
    console.log(`\n=== AI: ${ai}  games ${games}  seed ${seed}  decks ${decks.join(" | ")} ===`);
    console.log(`finished ${fin.length}/${games}  hangs ${results.filter((r) => r.reason === "hang").length}  avg turns (finished) ${fin.length ? (fin.reduce((a, r) => a + r.turns, 0) / fin.length).toFixed(1) : "-"}  avg turns (all) ${(sum((r) => r.turns) / games).toFixed(1)}`);
    console.log(`wins ${JSON.stringify(wins)}`);
    console.log(`casts ${sum((r) => r.casts)}  no-op casts ${sum((r) => r.noopCasts)}  harmful casts (own eval drop > 2) ${sum((r) => r.harmfulCasts)}  activations ${sum((r) => r.activations)}  turn-cap hits ${sum((r) => r.capHits)}`);
    console.log(`AI decisions ${sum((r) => r.decisions)}  avg ${(sum((r) => r.aiMs) / Math.max(1, sum((r) => r.decisions))).toFixed(2)} ms  worst ${Math.max(...results.map((r) => r.maxDecisionMs)).toFixed(0)} ms`);
    const top = Object.entries(noopNames).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (top.length) console.log(`no-op casts by card: ${top.map(([n, c]) => `${n} x${c}`).join("; ")}`);
  }
  process.exit(0);
}
void main();
