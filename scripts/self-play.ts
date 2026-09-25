// Milestone 2 of the self-play plan built the heuristicBrain-mirror runner (no Ollama, no network) —
// the fast rules-engine fuzzer. Milestone 3 adds --ollama: the headline matchup, ollamaBrain vs
// heuristicBrain, POSTing to the live /api/agents/action route (requires `npm run dev` running, and
// Ollama reachable behind it for a real, non-fallback measurement). Both modes run through
// src/lib/selfplay/orchestrator.ts and audit rules integrity after every action via
// src/lib/selfplay/audit.ts — this stays a rules-integrity check on every game, not just a skill
// measurement, in either mode.
//
// Run with vite-node (ships with the installed vitest, so it reuses vitest.config.ts's "@" -> "./src"
// alias, same convention as the rest of this repo's tooling):
//   npx vite-node scripts/self-play.ts --games=20
//   npm run selfplay -- --games=50 --seed=1 --verbose
//   npm run selfplay -- --strict          (halt immediately on the first audit violation and dump it)
//   npm run selfplay -- --ollama --games=20            (needs `npm run dev` + Ollama running)
//   SELFPLAY_BASE_URL=http://127.0.0.1:3001 npm run selfplay -- --ollama
//   npm run selfplay -- --ollama --games=1 --start-index=5     (continues a bigger run's rotation —
//                                                                 see CliArgs.startIndex's own comment)
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { heuristicBrain, ollamaBrain, type Brain } from "../src/lib/selfplay/brains";
import { createSelfPlayGame, playGame, type PlayGameResult } from "../src/lib/selfplay/orchestrator";
import { SelfPlayStrictViolationError, type AuditCheck, type AuditViolation } from "../src/lib/selfplay/audit";

interface CliArgs {
  games: number;
  seed?: number;
  strict: boolean;
  verbose: boolean;
  ollama: boolean;
  // Offsets every gameIndex-derived rotation (deck pairing, first seat, which seat is ollama, seed)
  // by this amount, so `--games=1 --start-index=5` behaves exactly like gameIndex 5 inside one big
  // `--games=24` run. Exists so a real --ollama run (each game taking several real-Ollama-call
  // minutes) can be split across several short, plain FOREGROUND invocations — one game (or a small
  // batch) per call, each blocking until done — instead of one long-running/backgrounded process,
  // which is what got killed by the environment's idle-background memory-pressure reaper. The
  // rotation periods (deck pairing period 8, first-seat period 2, ollama-seat period 4) are unchanged
  // by this — only WHERE the sequence starts.
  startIndex: number;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (name: string) => argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const gamesArg = get("games");
  const seedArg = get("seed");
  const startIndexArg = get("start-index");
  return {
    games: gamesArg ? Number.parseInt(gamesArg, 10) : 20,
    seed: seedArg ? Number.parseInt(seedArg, 10) : undefined,
    strict: argv.includes("--strict"),
    verbose: argv.includes("--verbose"),
    ollama: argv.includes("--ollama"),
    startIndex: startIndexArg ? Number.parseInt(startIndexArg, 10) : 0
  };
}

// The four root decklists the plan names (Meren.txt, UrDragon.txt, Saheeli.txt, "Aminatou 100
// cards.txt") — cycled across games (game i pairs decks[i % 4] vs decks[(i+1) % 4]) so a run of any
// meaningful size exercises more than one deck's card pool, not just Meren vs UrDragon.
const DECK_FILES = ["Meren.txt", "UrDragon.txt", "Saheeli.txt", "Aminatou 100 cards.txt"];

// ollamaBrain's request carries seatName as agentName, and agentModelName(agentName) (src/lib/
// ollama.ts:28) resolves it to a real, already-pulled Ollama model as literally "mtg-<lowercased
// name>" — the live game's own three-agent roster (src/lib/sessionStore.ts, AgentName in
// src/lib/types.ts) only ever names its seats "Veyra"/"Malik"/"Sable", each tied to one of these
// exact decks (Veyra=UrDragon, Malik=Saheeli, Sable=Meren — see sessionStore.ts:63-65 and
// AppFlow.tsx:19222-19224's own name->commander lookup). Reusing those exact names here, instead of
// the generic "Seat A"/"Seat B" the heuristic-mirror mode uses, is what makes --ollama's requests
// resolve to a real trained model instead of 404ing on "mtg-seat-a". "Aminatou 100 cards.txt" has no
// matching persona/model in that roster at all — kept in DECK_FILES for the heuristic-only fuzzer
// (deck identity doesn't need a model there), but under --ollama it's given no special-cased name and
// so predictably falls back every time it's the ollama seat's deck; this is a real, documented gap
// (no 4th trained model exists), not a bug in this script.
const DECK_AGENT_NAMES: Record<string, string> = { "Meren.txt": "Sable", "UrDragon.txt": "Veyra", "Saheeli.txt": "Malik" };

function formatViolation(violation: AuditViolation): string {
  return `  [${violation.check}] turn ${violation.turn} ${violation.phase} (after ${violation.precedingAction}): ${violation.message}`;
}

function dumpAndExit(error: SelfPlayStrictViolationError): never {
  console.error("\n" + "=".repeat(70));
  console.error("STRICT MODE: halted on the first audit violation.");
  console.error("=".repeat(70));
  for (const violation of error.violations) console.error(formatViolation(violation));
  console.error("\nSession dump:");
  console.error(JSON.stringify(error.session, null, 2));
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `Self-play: ${args.games} game(s), ${args.ollama ? "ollamaBrain vs heuristicBrain" : "heuristicBrain vs heuristicBrain"}${args.seed !== undefined ? `, base seed ${args.seed}` : ""}${args.strict ? ", strict mode" : ""}.`
  );
  if (args.ollama) {
    console.log(`Ollama matchup base URL: ${process.env.SELFPLAY_BASE_URL ?? "http://127.0.0.1:3000"} (needs \`npm run dev\` + Ollama running).`);
  }

  const outDir = path.join(process.cwd(), "bench", "selfplay-results");
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);

  const results: Array<PlayGameResult & { gameIndex: number; seatNames: [string, string]; deckFiles: [string, string]; firstSeatIndex: 0 | 1; ollamaSeatIndex?: 0 | 1 }> = [];
  const violationsByCheck = new Map<AuditCheck, number>();
  const violationExamples = new Map<AuditCheck, AuditViolation>();
  const terminationCounts: Record<string, number> = {};
  let crashed = 0;
  const spellEffectCoverage = { matched: 0, unmatched: 0 };
  const unmatchedSpellCards = new Map<string, number>();
  // Milestone 3 bookkeeping — only meaningful when args.ollama is set.
  const ollamaBrainInstance = args.ollama ? ollamaBrain() : undefined;
  let ollamaWins = 0;
  let heuristicWins = 0;
  let ollamaNoWinner = 0;
  const ollamaSourceCounts: Record<string, number> = {};

  for (let gameIndex = 0; gameIndex < args.games; gameIndex += 1) {
    // globalIndex, not the local loop's own gameIndex, drives every rotation below — see startIndex's
    // own comment: this is what makes several small `--games=1 --start-index=N` invocations behave
    // exactly like one big `--games=24` run, so the deck/first-seat/ollama-seat periods (8/2/4) stay
    // correct across calls instead of restarting from 0 every time.
    const globalIndex = args.startIndex + gameIndex;
    // Deck pairing changes every TWO games (pairIndex), while who-goes-first alternates every SINGLE
    // game (globalIndex % 2) — deliberately different periods so within each 2-game block, the same
    // deck matchup is played once with each seat going first. Driving both off the same index
    // (an earlier version of this script did exactly that) silently confounds them: deck identity
    // and turn order would move in lockstep, so a lopsided "first-seat win rate" could just as
    // easily be "whichever deck happened to always go second is the stronger deck" rather than a
    // real turn-order effect. Caught by actually reading this run's own numbers — see the report.
    const pairIndex = Math.floor(globalIndex / 2) % DECK_FILES.length;
    const deckFiles: [string, string] = [DECK_FILES[pairIndex], DECK_FILES[(pairIndex + 1) % DECK_FILES.length]];
    // See DECK_AGENT_NAMES' own comment: under --ollama, seat names must match the live game's real
    // agent roster so ollamaBrain's requests resolve to an actually-pulled model instead of 404ing.
    const seatNames: [string, string] = args.ollama
      ? [DECK_AGENT_NAMES[deckFiles[0]] ?? deckFiles[0], DECK_AGENT_NAMES[deckFiles[1]] ?? deckFiles[1]]
      : ["Seat A", "Seat B"];
    const forceFirstSeatIndex: 0 | 1 = (globalIndex % 2) as 0 | 1;
    const seed = args.seed !== undefined ? args.seed + globalIndex : undefined;

    const session = createSelfPlayGame({ deckListPaths: deckFiles, seatNames, forceFirstSeatIndex, seed });
    // Which physical seat gets ollamaBrain this game.
    //
    // CORRECTED after a real 24-game run exposed the bug: this used to be
    // `Math.floor(globalIndex / 2) % 2` on the theory that "period 4 vs deckFiles' period 8" was
    // enough to decouple them. It isn't — pairIndex is `Math.floor(globalIndex / 2) % 4`, i.e. the
    // SAME underlying counter (`Math.floor(globalIndex / 2)`) just read mod 4 instead of mod 2, and
    // since 2 evenly divides 4, `pairIndex % 2` and the old ollamaSeatIndex were mathematically
    // IDENTICAL for every game — not merely correlated, identical. The result: every deck that ever
    // appeared in a 24-game run got exactly one brain assignment for its entire run (Sable/Meren and
    // Malik/Saheeli were ALWAYS the ollama seat; Veyra/UrDragon and Aminatou were ALWAYS the
    // heuristic seat), so that run's win/loss record cannot distinguish "ollamaBrain plays worse"
    // from "Sable/Malik's decks are just weaker than Veyra/Aminatou's" — precisely the deck/brain
    // confound this file's own header comment on deckFiles/forceFirstSeatIndex already warned about
    // avoiding, reintroduced by a period choice that LOOKED distinct (4 vs 8) but wasn't
    // number-theoretically independent (a period must be coprime with, not just different from, the
    // period(s) it needs to decouple from). Fixed by using a period-3 rotation over the raw
    // `globalIndex` itself — NOT derived from `Math.floor(globalIndex / 2)` — so it shares no common
    // factor with forceFirstSeatIndex's period 2 or deckFiles' effective period 8 (2*4); LCM(8,2,3) =
    // 24, so a 24-game run now genuinely covers every (deck pairing, first seat, ollama seat)
    // combination instead of silently fixing one of them per deck.
    const ollamaSeatIndex: 0 | 1 = args.ollama ? ((Math.floor(globalIndex / 3) % 2) as 0 | 1) : undefined!;
    const brains: Record<string, Brain> = args.ollama
      ? { [session.seats[ollamaSeatIndex].id]: ollamaBrainInstance!, [session.seats[1 - ollamaSeatIndex].id]: heuristicBrain }
      : { [session.seats[0].id]: heuristicBrain, [session.seats[1].id]: heuristicBrain };

    let result: PlayGameResult;
    try {
      // Default timeoutMs (60s) is sized for heuristicBrain's mirror match, which never makes a
      // network call — a real Ollama round trip (main_phase/priority_response decisions ask the
      // model to deliberate at length, per route.ts's wantsDeliberation) routinely takes several
      // seconds each, and a game has dozens of decisions, so --ollama needs a much longer per-game
      // budget or every game hits "timeout" before either brain gets a fair shake.
      result = await playGame(session, brains, { strict: args.strict, timeoutMs: args.ollama ? 20 * 60 * 1000 : undefined });
    } catch (error) {
      if (error instanceof SelfPlayStrictViolationError) dumpAndExit(error);
      throw error;
    }

    results.push({ ...result, gameIndex: globalIndex, seatNames, deckFiles, firstSeatIndex: forceFirstSeatIndex, ollamaSeatIndex: args.ollama ? ollamaSeatIndex : undefined });
    terminationCounts[result.terminationReason] = (terminationCounts[result.terminationReason] ?? 0) + 1;
    if (result.terminationReason === "crash") crashed += 1;
    spellEffectCoverage.matched += result.spellEffectCoverage.matched;
    spellEffectCoverage.unmatched += result.spellEffectCoverage.unmatched;
    for (const [cardName, count] of Object.entries(result.unmatchedSpellCards)) {
      unmatchedSpellCards.set(cardName, (unmatchedSpellCards.get(cardName) ?? 0) + count);
    }
    for (const violation of result.violations) {
      violationsByCheck.set(violation.check, (violationsByCheck.get(violation.check) ?? 0) + 1);
      if (!violationExamples.has(violation.check)) violationExamples.set(violation.check, violation);
    }

    if (args.ollama) {
      const ollamaSeatId = session.seats[ollamaSeatIndex].id;
      const heuristicSeatId = session.seats[1 - ollamaSeatIndex].id;
      if (!result.winnerSeatId) ollamaNoWinner += 1;
      else if (result.winnerSeatId === ollamaSeatId) ollamaWins += 1;
      else if (result.winnerSeatId === heuristicSeatId) heuristicWins += 1;
      const ollamaDecisions = result.decisionCounts[ollamaSeatId] ?? {};
      for (const [source, count] of Object.entries(ollamaDecisions)) {
        ollamaSourceCounts[source] = (ollamaSourceCounts[source] ?? 0) + count;
      }
    }

    const winnerName = result.winnerSeatId ? session.seats.find((seat) => seat.id === result.winnerSeatId)?.name : undefined;
    appendFileSync(
      outFile,
      JSON.stringify({
        gameIndex: globalIndex,
        deckFiles,
        seatNames: session.seats.map((seat) => seat.name),
        seatIds: session.seats.map((seat) => seat.id),
        firstSeatId: session.activePlayerId,
        winnerSeatId: result.winnerSeatId,
        winnerName,
        turns: result.turns,
        wallClockMs: result.wallClockMs,
        terminationReason: result.terminationReason,
        decisionCounts: result.decisionCounts,
        spellEffectCoverage: result.spellEffectCoverage,
        unmatchedSpellCards: result.unmatchedSpellCards,
        ollamaSeatId: args.ollama ? session.seats[ollamaSeatIndex].id : undefined,
        violationCount: result.violations.length,
        violations: result.violations
      }) + "\n"
    );

    if (args.verbose) {
      console.log(
        `Game ${globalIndex + 1} (batch ${gameIndex + 1}/${args.games}): ${deckFiles.join(" vs ")} — winner ${winnerName ?? "(none)"} in ${result.turns} turns (${result.terminationReason}), ${result.violations.length} violation(s), ${result.wallClockMs}ms.`
      );
      for (const violation of result.violations) console.log(formatViolation(violation));
    } else {
      process.stdout.write(result.violations.length > 0 ? "!" : ".");
    }
  }

  if (!args.verbose) console.log("");

  const totalTurns = results.reduce((sum, result) => sum + result.turns, 0);
  const totalViolations = results.reduce((sum, result) => sum + result.violations.length, 0);
  // "First seat" means whichever seat rolled/was forced to go first that game (result.firstSeatIndex
  // into result.session.seats), not a fixed identity — deck files rotate across games too, so this
  // is purely "does going first matter," decoupled from which deck happened to be in that slot.
  let winsByFirstSeat = 0;
  let winsBySecondSeat = 0;
  let noWinner = 0;
  for (const result of results) {
    if (!result.winnerSeatId) {
      noWinner += 1;
      continue;
    }
    if (result.session.seats[result.firstSeatIndex]?.id === result.winnerSeatId) winsByFirstSeat += 1;
    else winsBySecondSeat += 1;
  }

  console.log("\n" + "=".repeat(70));
  console.log(`Self-play summary — ${results.length} game(s)`);
  console.log("=".repeat(70));
  console.log(`Termination reasons: ${Object.entries(terminationCounts).map(([reason, count]) => `${reason}=${count}`).join(", ")}`);
  console.log(`Average turns per game: ${(totalTurns / Math.max(1, results.length)).toFixed(1)}`);
  console.log(`Games with no winner (turn cap/timeout/crash): ${noWinner}`);
  console.log(`First-seat win rate: ${winsByFirstSeat}/${winsByFirstSeat + winsBySecondSeat} (heuristicBrain mirror match — should trend toward 50% across enough games if first-player advantage is real but not overwhelming).`);
  if (crashed > 0) console.log(`Crashed games (orchestrator threw, not an audit violation): ${crashed}`);
  if (args.ollama) {
    const ollamaDecided = ollamaWins + heuristicWins;
    console.log("\n--- Milestone 3 matchup: ollamaBrain vs heuristicBrain (seats/decks swapped across games) ---");
    console.log(
      `Win rate: ollamaBrain ${ollamaWins}/${ollamaDecided + ollamaNoWinner} (${ollamaDecided > 0 ? ((ollamaWins / (ollamaDecided + ollamaNoWinner)) * 100).toFixed(1) : "0.0"}%), ` +
        `heuristicBrain ${heuristicWins}/${ollamaDecided + ollamaNoWinner} (${ollamaDecided > 0 ? ((heuristicWins / (ollamaDecided + ollamaNoWinner)) * 100).toFixed(1) : "0.0"}%), ` +
        `no winner ${ollamaNoWinner}.`
    );
    const ollamaDecisionTotal = Object.values(ollamaSourceCounts).reduce((sum, count) => sum + count, 0);
    const nonOllamaSourced = (ollamaSourceCounts.fallback ?? 0) + (ollamaSourceCounts.invalid ?? 0);
    console.log(
      `ollamaBrain decision sources (${ollamaDecisionTotal} total): ` +
        Object.entries(ollamaSourceCounts).map(([source, count]) => `${source}=${count}`).join(", ")
    );
    console.log(
      `Silent-fallback rate (fallback+invalid, out of the ollama seat's own decisions): ${nonOllamaSourced}/${ollamaDecisionTotal}` +
        (ollamaDecisionTotal > 0 ? ` (${((nonOllamaSourced / ollamaDecisionTotal) * 100).toFixed(1)}%)` : "") +
        ` — a high rate here means this run's win rate mostly reflects heuristicBrain playing itself, not real LLM skill.`
    );
  }
  const spellTotal = spellEffectCoverage.matched + spellEffectCoverage.unmatched;
  console.log(
    `Bare instant/sorcery effect coverage: ${spellEffectCoverage.matched}/${spellTotal} matched a deterministic effect` +
      (spellTotal > 0 ? ` (${((spellEffectCoverage.matched / spellTotal) * 100).toFixed(1)}%)` : "") +
      `; ${spellEffectCoverage.unmatched} resolved with mana spent but no recognized effect (tutors/counterspells/unmatched templates — see resolveBareSpellEffect's gap list).`
  );
  if (unmatchedSpellCards.size > 0) {
    // The actionable backlog this whole coverage stat exists to produce: which specific cards keep
    // getting cast with no effect, ranked by how often it happened, so implementation work can be
    // prioritized by real in-game frequency rather than by eyeballing a decklist.
    const ranked = [...unmatchedSpellCards.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`Unimplemented-effect cards this run (name: times cast with no effect), most frequent first:`);
    for (const [cardName, count] of ranked) console.log(`  ${cardName}: ${count}`);
  }

  console.log("\n--- Rules-integrity audit ---");
  console.log(`Total violations across all games: ${totalViolations}`);
  if (violationsByCheck.size === 0) {
    console.log("No violations found.");
  } else {
    for (const [check, count] of [...violationsByCheck.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${check}: ${count}`);
      const example = violationExamples.get(check);
      if (example) console.log(`    e.g. ${formatViolation(example)}`);
    }
  }

  console.log(`\nFull per-game JSONL: ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
