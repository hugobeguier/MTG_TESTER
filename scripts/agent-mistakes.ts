// Mistake detector CLI — runs N headless heuristic-brain self-play games and reports recurring "wasteful play" (see
// src/lib/selfplay/mistakes.ts for the categories) plus general health metrics. Deterministic: game i uses seed (--seed + i).
//
//   npm run agent:mistakes -- --games=60 --seed=1                    (foundations 4-seat pods; report -> bench/mistakes/latest.{md,json})
//   npm run agent:mistakes -- --games=60 --seed=1 --label=baseline   (report -> docs/agents/mistakes/baseline.{md,json}, committed)
//   npm run agent:mistakes -- --pool=legacy --games=20               (the 2-seat Meren/UrDragon/Saheeli/Aminatou pairings)
//   npm run agent:mistakes -- --unguarded                            (ignore the play guards: shows what they prevent / proves the detectors fire)
//   npm run agent:mistakes -- --full-log                             (also dump per-game flagged records to bench/mistakes/games.jsonl)
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { heuristicBrain, type Brain } from "../src/lib/selfplay/brains";
import { createSelfPlayGame, playGame, seedRuntime, type PlayGameResult } from "../src/lib/selfplay/orchestrator";
import { DECK_FILES, computeGameRotation } from "../src/lib/selfplay/rotation";
import { ALL_CATEGORIES, MistakeRecorder, unguardedHeuristicBrain, type MistakeCategory, type MistakeRecord } from "../src/lib/selfplay/mistakes";

const FOUNDATIONS = [
  ["decks/foundations/WretchedRanks.txt", "Wretched Ranks"],
  ["decks/foundations/ReignOfDragons.txt", "Reign of Dragons"],
  ["decks/foundations/TramplesaurusRex.txt", "Tramplesaurus Rex"],
  ["decks/foundations/CallingAllAngels.txt", "Calling All Angels"]
] as const;

interface Args {
  pool: "foundations" | "legacy";
  games: number;
  seed: number;
  label?: string;
  unguarded: boolean;
  fullLog: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  return {
    pool: get("pool") === "legacy" ? "legacy" : "foundations",
    games: Number.parseInt(get("games") ?? "30", 10),
    seed: Number.parseInt(get("seed") ?? "1", 10),
    label: get("label"),
    unguarded: argv.includes("--unguarded"),
    fullLog: argv.includes("--full-log")
  };
}

interface GameSummary {
  game: number;
  seed: number;
  decks: string[];
  terminationReason: string;
  turns: number;
  winner?: string;
  wallClockMs: number;
  violations: number;
  flags: number;
}

interface CategoryStat {
  count: number;
  games: number;
  cards: Record<string, number>;
  examples: MistakeRecord[];
}

function pct(n: number, d: number) {
  return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const brain: Brain = args.unguarded ? unguardedHeuristicBrain : heuristicBrain;
  const stats = new Map<MistakeCategory, CategoryStat>();
  const gameSummaries: GameSummary[] = [];
  const winnerCounts: Record<string, number> = {};
  const actionsByType: Record<string, number> = {};
  const decisionsByPurpose: Record<string, number> = {};
  const unmatchedSpells: Record<string, number> = {};
  const outDir = path.join(process.cwd(), "bench", "mistakes");
  mkdirSync(outDir, { recursive: true });
  const fullLogFile = path.join(outDir, "games.jsonl");
  if (args.fullLog) writeFileSync(fullLogFile, "");
  let totalDecisions = 0;
  let crashes = 0;

  for (let i = 0; i < args.games; i += 1) {
    const seed = args.seed + i;
    let deckFiles: string[];
    let seatNames: string[];
    let forceFirst: number;
    if (args.pool === "foundations") {
      const rotate = i % FOUNDATIONS.length;
      const rotated = [...FOUNDATIONS.slice(rotate), ...FOUNDATIONS.slice(0, rotate)];
      deckFiles = rotated.map((entry) => entry[0]);
      seatNames = rotated.map((entry) => entry[1]);
      forceFirst = Math.floor(i / FOUNDATIONS.length) % FOUNDATIONS.length;
    } else {
      const rotation = computeGameRotation(i);
      deckFiles = [DECK_FILES[rotation.pairIndex], DECK_FILES[(rotation.pairIndex + 1) % DECK_FILES.length]];
      seatNames = ["Seat A", "Seat B"];
      forceFirst = rotation.forceFirstSeatIndex;
    }
    const restoreRuntime = seedRuntime(seed);
    const session = createSelfPlayGame({ deckListPaths: deckFiles, seatNames, forceFirstSeatIndex: forceFirst, seed });
    const idToName = Object.fromEntries(session.seats.map((seat) => [seat.id, seat.name]));
    const recorder = new MistakeRecorder(i, idToName);
    const wrapped = recorder.wrap(brain);
    const brains: Record<string, Brain> = Object.fromEntries(session.seats.map((seat) => [seat.id, wrapped]));

    let result: PlayGameResult;
    try {
      result = await playGame(session, brains, { timeoutMs: 120000, onAction: recorder.onAction });
    } catch (error) {
      crashes += 1;
      console.error(`game ${i} threw: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    } finally {
      restoreRuntime();
    }
    if (result.terminationReason === "crash") crashes += 1;

    const winner = result.winnerSeatId ? idToName[result.winnerSeatId] : undefined;
    if (winner) winnerCounts[winner] = (winnerCounts[winner] ?? 0) + 1;
    totalDecisions += recorder.log.decisions;
    for (const [key, value] of Object.entries(recorder.log.actionsByType)) actionsByType[key] = (actionsByType[key] ?? 0) + value;
    for (const [key, value] of Object.entries(recorder.log.decisionsByPurpose)) decisionsByPurpose[key] = (decisionsByPurpose[key] ?? 0) + value;
    for (const [key, value] of Object.entries(result.unmatchedSpellCards)) unmatchedSpells[key] = (unmatchedSpells[key] ?? 0) + value;

    const seenInGame = new Set<MistakeCategory>();
    for (const record of recorder.log.records) {
      const stat = stats.get(record.category) ?? { count: 0, games: 0, cards: {}, examples: [] };
      stat.count += 1;
      if (!seenInGame.has(record.category)) {
        seenInGame.add(record.category);
        stat.games += 1;
      }
      for (const cardName of record.cardNames) stat.cards[cardName] = (stat.cards[cardName] ?? 0) + 1;
      if (stat.examples.length < 3) stat.examples.push(record);
      stats.set(record.category, stat);
    }
    if (args.fullLog) appendFileSync(fullLogFile, JSON.stringify({ game: i, seed, records: recorder.log.records }) + "\n");

    gameSummaries.push({
      game: i,
      seed,
      decks: deckFiles.map((file) => path.basename(file, ".txt")),
      terminationReason: result.terminationReason,
      turns: result.turns,
      winner,
      wallClockMs: result.wallClockMs,
      violations: result.violations.length,
      flags: recorder.log.records.length
    });
    process.stdout.write(result.violations.length > 0 ? "!" : recorder.log.records.length > 0 ? "?" : ".");
  }
  console.log("");

  const finished = gameSummaries.filter((game) => game.terminationReason === "win").length;
  const nGames = gameSummaries.length;
  const avgTurns = gameSummaries.reduce((sum, game) => sum + game.turns, 0) / Math.max(1, nGames);
  const seatsPerGame = args.pool === "foundations" ? 4 : 2;
  const health = {
    games: nGames,
    seedRange: `${args.seed}..${args.seed + args.games - 1}`,
    pool: args.pool,
    unguarded: args.unguarded,
    finishedPct: nGames ? (finished / nGames) * 100 : 0,
    timeouts: gameSummaries.filter((game) => game.terminationReason === "timeout").length,
    turnCaps: gameSummaries.filter((game) => game.terminationReason === "turn-cap").length,
    crashes,
    avgTurnsPerSeat: avgTurns / seatsPerGame,
    auditViolations: gameSummaries.reduce((sum, game) => sum + game.violations, 0),
    decisions: totalDecisions,
    winnerSpread: winnerCounts,
    actionsByType,
    decisionsByPurpose,
    passRate: (actionsByType.pass_priority ?? 0) + (actionsByType.end_turn ?? 0) > 0 ? ((actionsByType.pass_priority ?? 0) + (actionsByType.end_turn ?? 0)) / Math.max(1, totalDecisions) : 0,
    avgWallClockMs: gameSummaries.reduce((sum, game) => sum + game.wallClockMs, 0) / Math.max(1, nGames)
  };

  const ranked = [...stats.entries()].sort((a, b) => b[1].count - a[1].count);
  const flagsPerGame = Object.fromEntries(ALL_CATEGORIES.map((category) => [category, stats.get(category)?.count ?? 0]));
  const json = {
    health,
    categories: Object.fromEntries(ranked.map(([category, stat]) => [category, { count: stat.count, games: stat.games, topCards: Object.entries(stat.cards).sort((a, b) => b[1] - a[1]).slice(0, 8), examples: stat.examples }])),
    flagCounts: flagsPerGame,
    engineGaps_unmodeledSpellsCastWithNoEffect: Object.entries(unmatchedSpells).sort((a, b) => b[1] - a[1]).slice(0, 25),
    games: gameSummaries
  };

  const md: string[] = [];
  md.push(`# Agent mistake report${args.label ? ` — ${args.label}` : ""}`);
  md.push("");
  md.push(`Pool \`${args.pool}\`, ${nGames} games, seeds ${health.seedRange}, ${args.unguarded ? "play guards DISABLED (diagnostic run)" : "play guards on"}. Heuristic brain on every seat.`);
  md.push("");
  md.push("## Health");
  md.push("");
  md.push(`- Finished with a winner: ${finished}/${nGames} (${pct(finished, nGames)}); turn-cap ${health.turnCaps}, timeout ${health.timeouts}, crash ${crashes}`);
  md.push(`- Average turns per seat: ${health.avgTurnsPerSeat.toFixed(1)}; audit violations: ${health.auditViolations}; avg wall clock ${health.avgWallClockMs.toFixed(0)} ms/game`);
  md.push(`- Winner spread: ${Object.entries(winnerCounts).map(([name, n]) => `${name} ${n}`).join(", ") || "none"}`);
  md.push(`- Decisions: ${totalDecisions}; pass/end-turn share ${(health.passRate * 100).toFixed(1)}%; by action: ${Object.entries(actionsByType).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  md.push("");
  md.push("## Flags by category");
  md.push("");
  md.push("| Category | Flags | Games hit | Flags/game | Top cards |");
  md.push("|---|---:|---:|---:|---|");
  for (const category of ALL_CATEGORIES) {
    const stat = stats.get(category);
    const top = stat ? Object.entries(stat.cards).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, c]) => `${n} (${c})`).join(", ") : "";
    md.push(`| ${category} | ${stat?.count ?? 0} | ${stat?.games ?? 0} | ${((stat?.count ?? 0) / Math.max(1, nGames)).toFixed(2)} | ${top} |`);
  }
  md.push("");
  md.push("## Examples");
  for (const [category, stat] of ranked) {
    md.push("");
    md.push(`### ${category} (${stat.count})`);
    for (const example of stat.examples) {
      md.push("");
      md.push(`- game ${example.game}, turn ${example.turn} ${example.phase}, ${example.seat} (${example.purpose}): ${example.message}`);
      md.push(`  - chose: ${example.chosen}; open mana ${example.state.openMana}; life ${JSON.stringify(example.state.life)}`);
      md.push(`  - hand: ${example.state.hand.join(", ") || "-"}`);
      md.push(`  - boards: ${Object.entries(example.state.battlefield).map(([n, cards]) => `${n}: ${cards.slice(0, 8).join(", ") || "-"}`).join(" | ")}`);
      if (example.alternatives.length) md.push(`  - alternatives: ${example.alternatives.map((a) => `${a.label}${a.vetoed ? " [vetoed]" : ""} (${a.score})`).join("; ")}`);
    }
  }
  md.push("");
  md.push("## Engine gaps (not agent mistakes): spells cast that resolved with no modelled effect");
  md.push("");
  for (const [name, count] of Object.entries(unmatchedSpells).sort((a, b) => b[1] - a[1]).slice(0, 15)) md.push(`- ${name}: ${count}`);
  md.push("");

  const reportDir = args.label ? path.join(process.cwd(), "docs", "agents", "mistakes") : outDir;
  mkdirSync(reportDir, { recursive: true });
  const base = path.join(reportDir, args.label ?? "latest");
  writeFileSync(`${base}.json`, JSON.stringify(json, null, 2));
  writeFileSync(`${base}.md`, md.join("\n"));
  console.log(md.slice(0, 22 + ALL_CATEGORIES.length).join("\n"));
  console.log(`\nReport: ${base}.md / .json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
