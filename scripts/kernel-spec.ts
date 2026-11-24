// Runs the per-card behaviour specs (data/kernel-specs/*.spec.json) against the real kernel. See docs/card-spec-format.md.
//   npm run kernel:spec                          every spec file
//   npm run kernel:spec -- --deck Aminatou       the specs of every card of data/kernel-drafts/<deck> (uses that deck's drafts); lists cards without a spec
//   npm run kernel:spec -- --card "Mystic Remora"   one card (also finds files that list it in `cards`)
//   npm run kernel:spec -- --file path.spec.json
//   options: --scenario <text> (name contains)  --status accepted|draft  --changed (spec files newer than the last run)  --json (JSON on stdout)  --verbose  --no-save
import "../src/kernel/engine/resolve"; // FIRST (the engine modules import each other in a cycle)
import fs from "node:fs";
import path from "node:path";
import { deckCards, deckFolders, slugify, SPECS_DIR } from "../src/kernel/spec/env";
import { loadSpec, runSpec, specPaths, type LoadedSpec } from "../src/kernel/spec/load";
import { consoleReport, isGreen, markdown } from "../src/kernel/spec/report";
import type { ScenarioResult } from "../src/kernel/spec/run";
import { getEnv } from "../src/kernel/spec/env";

const args = process.argv.slice(2).filter((a) => a !== "--");
/** value of --name: every word up to the next --flag (npm drops the quotes around "Mystic Remora") */
const opt = (n: string): string | undefined => { const i = args.indexOf(n); if (i < 0) return undefined; const out: string[] = []; for (let j = i + 1; j < args.length && !args[j].startsWith("--"); j++) out.push(args[j]); return out.length ? out.join(" ") : undefined; };
const flag = (n: string) => args.includes(n);
const RESULTS = path.join(SPECS_DIR, "_results");

function lastRunMs(): number {
  if (!fs.existsSync(RESULTS)) return 0;
  return Math.max(0, ...fs.readdirSync(RESULTS).filter((f) => f.endsWith(".json")).map((f) => fs.statSync(path.join(RESULTS, f)).mtimeMs));
}

function main(): number {
  const deckArg = opt("--deck");
  const deck = deckArg ? deckFolders().find((d) => d.toLowerCase() === deckArg.toLowerCase() || d.toLowerCase().startsWith(deckArg.toLowerCase())) : undefined;
  if (deckArg && !deck) { console.error(`no deck "${deckArg}" in data/kernel-drafts (decks: ${deckFolders().join(", ")})`); return 2; }
  let specs: LoadedSpec[] = specPaths().map(loadSpec);
  const notes: string[] = [];
  if (opt("--file")) specs = [loadSpec(path.resolve(opt("--file")!))];
  if (deck) {
    const names = deckCards(deck);
    const env = getEnv(deck);
    const want = new Set(names.map((n) => slugify(n)));
    const covered = new Set<string>();
    specs = specs.filter((s) => {
      const cs = s.file ? [s.file.card, ...(s.file.cards ?? [])] : [path.basename(s.path).replace(/\.spec\.json$/, "")];
      const hit = cs.filter((c) => want.has(slugify(c)) || want.has(slugify(env.canonical(c) ?? c)));
      hit.forEach((c) => covered.add(slugify(env.canonical(c) ?? c)));
      return hit.length > 0;
    });
    const missing = names.filter((n) => !covered.has(slugify(n)));
    notes.push(`deck ${deck}: ${names.length - missing.length}/${names.length} cards have a spec file; without one: ${missing.join(", ") || "(none)"}`);
  }
  const card = opt("--card");
  if (card) specs = specs.filter((s) => (s.file ? [s.file.card, ...(s.file.cards ?? [])] : []).some((c) => slugify(c) === slugify(card)) || path.basename(s.path).startsWith(slugify(card)));
  const status = opt("--status");
  if (status) specs = specs.filter((s) => s.file?.status === status);
  if (flag("--changed")) { const t = lastRunMs(); specs = specs.filter((s) => s.mtimeMs > t); }
  if (!specs.length) { console.error("no spec files selected" + (card ? ` for "${card}" (write data/kernel-specs/${slugify(card)}.spec.json)` : "")); return 2; }

  const results: ScenarioResult[] = [];
  for (const s of specs) results.push(...runSpec(s, { deck, scenario: opt("--scenario") }));

  const when = new Date().toISOString().replace(/[:.]/g, "-");
  if (!flag("--no-save")) {
    fs.mkdirSync(RESULTS, { recursive: true });
    fs.writeFileSync(path.join(RESULTS, `${when}.json`), JSON.stringify({ when, args, notes, results }, null, 1));
    fs.writeFileSync(path.join(RESULTS, `${when}.md`), markdown(results, { when, args }));
  }
  if (flag("--json")) console.log(JSON.stringify({ when, args, notes, results }, null, 1));
  else { console.log(consoleReport(results, flag("--verbose"))); for (const n of notes) console.log(n); if (!flag("--no-save")) console.log(`saved data/kernel-specs/_results/${when}.{json,md}`); }
  return results.every(isGreen) ? 0 : 1;
}
process.exit(main());
