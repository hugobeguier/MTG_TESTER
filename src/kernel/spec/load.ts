// Finds and validates spec files (data/kernel-specs/<card-slug>.spec.json) and runs them. A file that does not validate yields one SPEC_ERROR result.
import fs from "node:fs";
import path from "node:path";
import { formatZodError, SpecFile, type SpecFileSpec } from "./schema";
import { runScenario, type ScenarioResult } from "./run";
import { SPECS_DIR, slugify } from "./env";

export interface LoadedSpec { path: string; file?: SpecFileSpec; errors?: string[]; mtimeMs: number }

export function specPaths(dir = SPECS_DIR): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".spec.json")).sort().map((f) => path.join(dir, f));
}
export function specPathFor(card: string, dir = SPECS_DIR): string { return path.join(dir, `${slugify(card)}.spec.json`); }

export function loadSpec(p: string): LoadedSpec {
  const mtimeMs = fs.statSync(p).mtimeMs;
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return { path: p, errors: [`invalid JSON: ${(e as Error).message}`], mtimeMs }; }
  const r = SpecFile.safeParse(raw);
  if (!r.success) return { path: p, errors: formatZodError(r.error), mtimeMs };
  return { path: p, file: r.data, mtimeMs };
}

export interface RunOptions { deck?: string; scenario?: string }
export function runSpec(s: LoadedSpec, o: RunOptions = {}): ScenarioResult[] {
  if (!s.file) return [{ card: path.basename(s.path).replace(/\.spec\.json$/, ""), scenario: "(file)", status: "SPEC_ERROR", failures: [], specError: s.errors!.join("\n"), unsupported: [], noDraft: [], actionLog: [], lastEvents: [], stack: [], durationMs: 0 }];
  const out: ScenarioResult[] = [];
  for (const sc of s.file.scenarios) {
    if (o.scenario && !sc.name.toLowerCase().includes(o.scenario.toLowerCase())) continue;
    out.push(runScenario(s.file, sc, { deck: o.deck }));
  }
  return out;
}
