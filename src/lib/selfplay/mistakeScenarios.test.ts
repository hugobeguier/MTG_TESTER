import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fallbackAction, scoreLegalActions } from "@/lib/actionScoring";
import { ALL_CATEGORIES, analyzeDecision } from "./mistakes";
import { MISTAKE_SCENARIOS } from "./mistakeScenarios";

// docs/agents/real-game-mistakes.md is the log the human fills in. Its table columns are:
//   Date | Category tag | Card / situation | What the agent did | What it should do | Status | Fixture
// A row with a fixture name must have a scenario in mistakeScenarios.ts; a row whose status starts with "fixed" gets a regression check.
interface LogRow {
  date: string;
  category: string;
  situation: string;
  status: string;
  fixture: string;
}

function readLog(): LogRow[] {
  const text = readFileSync(path.join(process.cwd(), "docs", "agents", "real-game-mistakes.md"), "utf8");
  const rows: LogRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 7 || /^-+$/.test(cells[0].replace(/:/g, "")) || cells[0].toLowerCase() === "date") continue;
    rows.push({ date: cells[0], category: cells[1].replace(/`/g, ""), situation: cells[2], status: cells[5], fixture: cells[6].replace(/`/g, "") });
  }
  return rows;
}

describe("real-game mistake log", () => {
  const rows = readLog();

  it("has the user's known examples", () => {
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });

  it("uses only known category tags", () => {
    for (const row of rows) expect(ALL_CATEGORIES as string[], `row "${row.situation}"`).toContain(row.category);
  });

  for (const row of rows.filter((entry) => entry.fixture)) {
    describe(`${row.fixture} (${row.category})`, () => {
      const scenario = MISTAKE_SCENARIOS[row.fixture];

      it("has a scenario fixture with the same category", () => {
        expect(scenario, `no fixture "${row.fixture}" in mistakeScenarios.ts`).toBeDefined();
        expect(scenario.category).toBe(row.category);
      });

      it("is flagged by the mistake detector when the bad action is taken", () => {
        const point = { purpose: scenario.purpose, context: scenario.context, legalActions: scenario.legalActions };
        const bad = scenario.legalActions.find((action) => action.id === scenario.badActionId)!;
        const flags = analyzeDecision(point, bad, scoreLegalActions(scenario.legalActions, scenario.context));
        expect(flags.map((flag) => flag.category)).toContain(scenario.category);
      });

      if (/^fixed/i.test(row.status)) {
        it("is no longer chosen by the deterministic scorer + play guards (regression)", () => {
          const scored = scoreLegalActions(scenario.legalActions, scenario.context);
          expect(fallbackAction(scored, "regression").legalActionId).not.toBe(scenario.badActionId);
        });
      }
    });
  }
});
