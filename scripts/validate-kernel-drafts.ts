// Loads a directory of kernel-schema card drafts (data/kernel-drafts/<deck>/<card>.json + _index.json), runs
// generatePrompts -> computeImplementation -> validateCard against the Scryfall oracle text in data/cards.db
// (read-only) and prints ok/issues per card.
//
//   npm run kernel:validate-drafts -- data/kernel-drafts/keen-engineering [--write] [--approval]
//
//   --write     rewrite each draft with prompts + implementation/needs filled in (idempotent)
//   --approval  also write APPROVAL.md next to the drafts (spot-check list + complex cards + kernel to-do table)
import Database from "better-sqlite3";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { computeImplementation } from "../src/kernel/capabilities";
import { complexityOf } from "../src/kernel/deckAudit";
import { describeCost, describeCostReduction, describeFilter, describeManaSpec, setRenderCardName, describeReplacement, describeStatic, describeStep, describeTarget, describeTrigger, generatePrompts } from "../src/kernel/prompts";
import type { Ability, Card, Step, TargetSpec } from "../src/kernel/schema";
import { renderForApproval, validateCard } from "../src/kernel/validator";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) {
  console.error("usage: kernel:validate-drafts -- <drafts dir> [--write] [--approval]");
  process.exit(2);
}
const WRITE = args.includes("--write");
const APPROVAL = args.includes("--approval");
const PRUNE = args.includes("--prune"); // with --write: remove review.ignore entries that are no longer needed

interface IndexEntry { slug: string; name: string; questions?: string[] }
interface Index { deck: string; cards: IndexEntry[]; decisions?: string[] }
const index: Index = JSON.parse(readFileSync(path.join(dir, "_index.json"), "utf8"));

const db = new Database(path.join("data", "cards.db"), { readonly: true, fileMustExist: true });
const stmt = db.prepare("SELECT name, type_line, oracle_text FROM cards WHERE lower(name) = lower(?) OR lower(name) LIKE lower(?) || ' // %' ORDER BY (lower(name) = lower(?)) DESC LIMIT 1");

interface Row { entry: IndexEntry; oracle: string; typeLine: string; card: Card; ok: boolean; issues: ReturnType<typeof validateCard>["issues"] }
const rows: Row[] = [];
const onDisk = new Set(readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_")).map((f) => f.replace(/\.json$/, "")));

for (const entry of index.cards) {
  onDisk.delete(entry.slug);
  const found = stmt.get(entry.name, entry.name, entry.name) as { oracle_text: string; type_line: string } | undefined;
  const file = path.join(dir, `${entry.slug}.json`);
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, "utf8")); } catch (e) {
    rows.push({ entry, oracle: found?.oracle_text ?? "", typeLine: found?.type_line ?? "", card: { schemaVersion: 2, abilities: [] }, ok: false, issues: [{ code: "LOAD", severity: "error", message: `cannot read ${file}: ${(e as Error).message}` }] });
    continue;
  }
  // A card missing from the DB may carry its own oracle text (review.oracleOverride, with where it came from).
  const override = (raw as Card).review?.oracleOverride;
  let source: { oracle_text: string; type_line: string } | undefined = found;
  const extraIssues: ReturnType<typeof validateCard>["issues"] = [];
  if (!found && override) {
    source = { oracle_text: override.text, type_line: override.typeLine ?? "" };
    extraIssues.push({ code: "ORACLE_OVERRIDE", severity: "warning", message: `oracle text comes from the draft (review.oracleOverride, source: ${override.source}), not from data/cards.db` });
  }
  if (!source) {
    rows.push({ entry, oracle: "", typeLine: "", card: raw as Card, ok: false, issues: [{ code: "NO_ORACLE", severity: "error", message: "card not found in data/cards.db (add review.oracleOverride {text, source} to the draft to validate against known text)" }] });
    continue;
  }
  let card = raw as Card;
  try { card = computeImplementation(generatePrompts(card, entry.name)); } catch { /* schema-invalid draft: the validator reports it */ }
  if (PRUNE && card.review?.ignore?.length) {
    // drop review.ignore entries the validator no longer needs
    let keep = [...card.review.ignore];
    for (const ig of [...keep]) {
      const trial = keep.filter((i) => i !== ig);
      const t: Card = { ...card, review: { ...card.review, ignore: trial.length ? trial : undefined } };
      if (validateCard(t, source.oracle_text ?? "", entry.name).ok) keep = trial;
    }
    const review = { ...card.review, ignore: keep.length ? keep : undefined };
    if (!keep.length) delete review.ignore;
    card = { ...card, review } as Card;
  }
  const res = validateCard(card, source.oracle_text ?? "", entry.name);
  if (WRITE && res.ok) writeFileSync(file, JSON.stringify(card, null, 2) + "\n");
  rows.push({ entry, oracle: source.oracle_text ?? "", typeLine: source.type_line, card, ok: res.ok, issues: [...res.issues, ...extraIssues] });
}

let pass = 0;
for (const r of rows) {
  const errors = r.issues.filter((i) => i.severity === "error");
  const warns = r.issues.filter((i) => i.severity === "warning");
  if (r.ok) pass++;
  console.log(`${r.ok ? "ok  " : "FAIL"} ${r.entry.name}${warns.length ? `  (${warns.length} warning${warns.length > 1 ? "s" : ""})` : ""}`);
  for (const i of [...errors, ...warns]) console.log(`       ${i.severity === "error" ? "E" : "W"} ${i.code}${i.ability ? ` [${i.ability}]` : ""}: ${i.message}`);
}
for (const extra of onDisk) console.log(`note: ${extra}.json is in the folder but not in _index.json`);
const needed = rows.filter((r) => r.card.abilities.some((a) => a.implementation === "needed") || r.card.castOptions?.some((c) => c.implementation === "needed"));
console.log(`\n${pass}/${rows.length} cards pass; ${needed.length} cards have implementation "needed"`);

if (APPROVAL) {
  writeFileSync(path.join(dir, "APPROVAL.md"), buildApproval());
  console.log(`wrote ${path.join(dir, "APPROVAL.md")}`);
}
process.exit(pass === rows.length ? 0 : 1);

// ------------------------------------------------------------------ APPROVAL.md

function oneLine(a: Ability): string {
  const tm = new Map<string, TargetSpec>((a.targets ?? []).map((t) => [t.id, t]));
  const steps = (ss: Step[]) => ss.map((s) => (s.optional ? "you may " : "") + describeStep(s, tm)).join(", then ");
  const cost = a.costs?.length ? `${a.costs.map(describeCost).join(", ")}: ` : "";
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (a.kind === "keyword") return `Keyword ${a.keyword?.name}${a.keyword?.param !== undefined ? ` ${a.keyword.param}` : ""}`;
  if (a.kind === "mana" && a.mana) {
    const p = a.mana.produces.map(describeManaSpec).join(" and ");
    return `${cost}add ${p}`;
  }
  if (a.static) return describeStatic(a.static);
  if (a.replacement) return describeReplacement(a.replacement);
  const trig = a.trigger ? `${describeTrigger(a.trigger)}: ` : "";
  const tg = (a.targets ?? []).length ? `[targets: ${a.targets!.map(describeTarget).join("; ")}] ` : "";
  const eff = a.steps?.length ? cap(steps(a.steps)) : a.modes ? "Modal" : a.scripted ? `(scripted ${a.scripted.handler})` : "";
  const extra = [a.costReduction ? describeCostReduction(a.costReduction) : "", a.zone && a.zone !== "battlefield" ? `from ${a.zone}` : "", a.scripted && a.steps?.length ? `scripted ${a.scripted.handler}` : ""].filter(Boolean).join("; ");
  return `${trig}${cost}${tg}${eff}${extra ? ` (${extra})` : ""}`.trim();
}

function needsOf(c: Card): string[] {
  const out = new Set<string>();
  for (const a of c.abilities) for (const n of a.needs ?? []) out.add(n);
  for (const o of c.castOptions ?? []) for (const n of o.needs ?? []) out.add(n);
  return [...out];
}

function buildApproval(): string {
  const isComplex = (r: Row) => complexityOf(r.oracle).level === "complex" || r.card.abilities.some((a) => a.scripted) || (r.entry.questions?.length ?? 0) > 0;
  const simple = rows.filter((r) => !isComplex(r));
  const complex = rows.filter(isComplex);
  const L: string[] = [];
  L.push(`# Kernel draft approval: ${index.deck}`, "");
  L.push(`${rows.length} unique cards: ${simple.length} simple (A), ${complex.length} complex (B). Validator: ${pass}/${rows.length} pass. Cards with implementation "needed": ${needed.length}. All drafts are \`review.status: "draft"\`; nothing was written to the DB.`, "");
  L.push("Reading guide: each card below shows the oracle text and what the structured JSON says back in plain English. Approve if they match.", "");
  L.push("## (A) Simple cards: spot-check one line each", "");
  for (const r of simple) {
    setRenderCardName(r.entry.name);
    const parts = r.card.abilities.map(oneLine).join(" | ");
    const impl = r.card.abilities.some((a) => a.implementation === "needed") ? ` [needs: ${needsOf(r.card).join(", ")}]` : " [implemented]";
    L.push(`- **${r.entry.name}** (${r.typeLine}): ${parts}${impl}`);
  }
  L.push("", "## (B) Complex cards", "");
  for (const r of complex) {
    setRenderCardName(r.entry.name);
    L.push(`### ${r.entry.name}`, "", `Type: ${r.typeLine}`, "", "Oracle text:", "", ...r.oracle.split("\n").map((l) => `> ${l}`), "");
    L.push("Re-rendered plain English:", "", "```", renderForApproval(r.card, r.entry.name), "```", "");
    const prompts: string[] = [];
    const seen = new Set<string>();
    const add = (p?: { title: string; instruction: string }) => { if (p && !seen.has(p.title + p.instruction)) { seen.add(p.title + p.instruction); prompts.push(`${p.title}: ${p.instruction}`); } };
    for (const a of r.card.abilities) {
      a.targets?.forEach((t) => add(t.prompt));
      add(a.modes?.prompt); a.modes?.options.forEach((o) => o.targets?.forEach((t) => add(t.prompt)));
      add(a.prompt); add(a.xPrompt); a.costs?.forEach((c) => add(c.prompt));
      const rec = (s: Step) => { add(s.prompt); add(s.unlessPay?.prompt); for (const k of ["then", "else", "steps"] as const) s[k]?.forEach(rec); };
      a.steps?.forEach(rec); a.modes?.options.forEach((o) => o.steps.forEach(rec));
      if (a.replacement && "steps" in a.replacement.result) a.replacement.result.steps.forEach(rec);
      add(a.replacement?.prompt);
    }
    r.card.castOptions?.forEach((o) => add(o.prompt));
    L.push("Player prompts:", "", ...(prompts.length ? prompts.map((p) => `- ${p}`) : ["- (none: no decisions)"]), "");
    const n = needsOf(r.card);
    L.push(`Implementation: ${n.length ? `needed (${n.join(", ")})` : "implemented"}`, "");
    if (r.entry.questions?.length) L.push("Questions for you:", "", ...r.entry.questions.map((q) => `- ${q}`), "");
  }
  const table = new Map<string, string[]>();
  for (const r of rows) for (const n of needsOf(r.card)) table.set(n, [...(table.get(n) ?? []), r.entry.name]);
  L.push("## Kernel to-do: missing capabilities across this deck", "", "| capability | cards | needing it |", "|---|---|---|");
  for (const [n, cs] of [...table].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) L.push(`| \`${n}\` | ${cs.length} | ${cs.join("; ")} |`);
  L.push("");
  if (index.decisions?.length) L.push("## Decisions", "", ...index.decisions.map((d) => `- ${d}`), "");
  return L.join("\n");
}

