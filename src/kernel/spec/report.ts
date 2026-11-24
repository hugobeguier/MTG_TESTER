// Console table, per-failure diff and the markdown summary (failures first, grouped by card).
import type { ScenarioResult, SpecStatus } from "./run";

const ORDER: Record<SpecStatus, number> = { FAIL: 0, SPEC_ERROR: 1, UNSUPPORTED: 2, PASS: 3 };
/** a known-failure scenario that still fails is "expected"; one that passes means the bug is fixed and the spec can be promoted */
export function effective(r: ScenarioResult): SpecStatus | "KNOWN_FAIL" | "FIXED" {
  if (r.knownFailure) return r.status === "FAIL" || r.status === "UNSUPPORTED" ? "KNOWN_FAIL" : r.status === "PASS" ? "FIXED" : r.status;
  return r.status;
}
export const isGreen = (r: ScenarioResult): boolean => { const e = effective(r); return e === "PASS" || e === "KNOWN_FAIL"; };

export function detail(r: ScenarioResult, full = true): string {
  const L: string[] = [];
  if (r.specError) L.push(`  SPEC ERROR: ${r.specError}`);
  for (const u of r.unsupported) L.push(`  UNSUPPORTED: ${u}`);
  for (const f of r.failures) {
    L.push(`  FAIL ${f.where} [${f.check}]`);
    if (f.why) L.push(`    why:      ${f.why}`);
    L.push(`    expected: ${f.expected}`, `    actual:   ${f.actual}`);
  }
  if (r.noDraft.length) L.push(`  note: no kernel draft for ${r.noDraft.join(", ")} (stub with no abilities)`);
  if (full && (r.failures.length || r.unsupported.length)) {
    if (r.actionLog.length) L.push("  actions:", ...r.actionLog.map((a) => `    ${a}`));
    if (r.stack.length) L.push(`  stack at the end (top first): ${r.stack.join(", ")}`);
    if (r.lastEvents.length) L.push("  last events:", ...r.lastEvents.slice(-15).map((e) => `    ${e}`));
  }
  return L.join("\n");
}

export function consoleReport(results: ScenarioResult[], verbose = false): string {
  const L: string[] = [];
  const w = Math.max(10, ...results.map((r) => r.card.length));
  const sorted = [...results].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.card.localeCompare(b.card));
  for (const r of sorted) {
    const e = effective(r);
    L.push(`${e.padEnd(11)} ${r.card.padEnd(w)}  ${r.scenario}  (${r.durationMs} ms)`);
    if (e !== "PASS" && (e !== "KNOWN_FAIL" || verbose)) { const d = detail(r, true); if (d) L.push(d); }
    if (r.knownFailure) L.push(`  known failure: ${r.knownFailure}`);
  }
  L.push("", summary(results));
  return L.join("\n");
}
export function summary(results: ScenarioResult[]): string {
  const c: Record<string, number> = {};
  for (const r of results) c[effective(r)] = (c[effective(r)] ?? 0) + 1;
  return `${results.length} scenario(s): ${Object.entries(c).map(([k, v]) => `${v} ${k}`).join(", ")}`;
}

export function markdown(results: ScenarioResult[], meta: { when: string; args: string[] }): string {
  const L: string[] = [`# Kernel spec run ${meta.when}`, "", `Arguments: \`${meta.args.join(" ") || "(none)"}\``, "", summary(results), ""];
  const byCard = new Map<string, ScenarioResult[]>();
  for (const r of results) { (byCard.get(r.card) ?? byCard.set(r.card, []).get(r.card)!).push(r); }
  const cards = [...byCard.entries()].sort((a, b) => Math.min(...a[1].map((r) => ORDER[r.status])) - Math.min(...b[1].map((r) => ORDER[r.status])) || a[0].localeCompare(b[0]));
  for (const [card, rs] of cards) {
    L.push(`## ${card}`, "");
    for (const r of [...rs].sort((a, b) => ORDER[a.status] - ORDER[b.status])) {
      L.push(`- **${effective(r)}** ${r.scenario}`);
      if (r.knownFailure) L.push(`  - known failure: ${r.knownFailure}`);
      if (r.status !== "PASS") for (const line of detail(r, true).split("\n")) L.push(`  ${line}`);
    }
    L.push("");
  }
  return L.join("\n");
}
