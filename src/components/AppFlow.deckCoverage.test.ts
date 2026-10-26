// Bulk clause-coverage check over every shipped deck: each oracle line is run through the deterministic parsers (clauseCoverage.recognises).
// "Unrecognised" lines are NOT necessarily broken (many cards are handled by inline single-card code, and the per-deck audit tests cover those),
// but the count per deck must never grow: a new card or a parser regression that adds an unrecognised clause fails here.
// To list the offenders run:  UPDATE_COVERAGE=1 npx vitest run src/components/AppFlow.deckCoverage.test.ts  (prints them per deck).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import { recognises, stripReminder } from "./clauseCoverage";

const catalog = loadCardCatalog();
// Baselines measured when the audits were written (lines the shared recogniser does not claim; see each AppFlow.*Audit/Deck test for the behaviour checks).
const DECKS: Array<[string, number]> = [
  ["Aminatou.txt", 45],
  ["Lathliss, Dragon Queen.txt", 10],
  ["Meren.txt", 41],
  ["The Ur Dragon.txt", 44],
  ["Saheeli.txt", 16],
  ["decks/custom/Breena, the Demagogue.txt", 34],
  ["decks/foundations/Calling All Angels.txt", 4],
  ["decks/foundations/Keen Engineering.txt", 13],
  ["decks/foundations/Reign Of Dragons.txt", 9],
  ["decks/foundations/Tramplesaurus Rex.txt", 7],
  ["decks/foundations/Wretched Ranks.txt", 4]
];

function deckCardNames(file: string): string[] {
  const names = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(\d+\s|Commander:)/.test(line))
    .map((line) => line.replace(/^Commander:\s*/, "").replace(/^\d+\s+/, "").replace(/\s+\(.*$/, "").replace(/\s+\*.*$/, "").trim());
  return [...new Set(names)];
}

describe("deck clause coverage (bulk)", () => {
  it.each(DECKS)("%s: every card resolves in the catalog and unrecognised clauses stay at or below %i", (file, baseline) => {
    const unresolved: string[] = [];
    const flagged: string[] = [];
    for (const name of deckCardNames(file)) {
      const card = lookupCard(catalog, name) as { oracleText?: string } | undefined;
      if (!card) {
        unresolved.push(name);
        continue;
      }
      for (const line of (card.oracleText ?? "").split("\n").map((l) => l.trim()).filter(Boolean)) {
        let ok = false;
        try {
          ok = recognises(name, line, card.oracleText ?? "");
        } catch {
          ok = false;
        }
        if (!ok) flagged.push(`${name} | ${stripReminder(line).slice(0, 140)}`);
      }
    }
    if (process.env.UPDATE_COVERAGE) console.log(`${file}\n${flagged.join("\n")}`);
    expect(unresolved, `cards missing from the catalog in ${file}`).toEqual([]);
    expect(flagged.length, `unrecognised clauses in ${file}`).toBeLessThanOrEqual(baseline);
  });
});
