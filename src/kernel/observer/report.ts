// Aggregation + markdown report of an observer run. Memory-bounded: counters and a few examples per category, never the whole diff list.
import type { Diff, StepOutcome } from "./types";

export interface DeckStats { agree: number; disagree: number; skipped: number; skipReasons: Record<string, number> }

export class Aggregate {
  games = 0;
  actions = 0;
  readonly byCategory: Record<string, number> = {};
  readonly byCard = new Map<string, number>();
  readonly byField: Record<string, number> = {};
  readonly byIntent: Record<string, { agree: number; disagree: number; skipped: number }> = {};
  readonly byDeck: Record<string, DeckStats> = {};
  readonly byCapability: Record<string, number> = {};
  readonly examples: Record<string, Diff[]> = {};
  readonly byRejectCode: Record<string, number> = {};
  choiceDependent = 0;
  observerErrors = 0;

  addOutcome(o: StepOutcome): void {
    this.actions += 1;
    const i = (this.byIntent[o.intentType] ??= { agree: 0, disagree: 0, skipped: 0 });
    i[o.kind] += 1;
    const d = (this.byDeck[o.deck ?? "?"] ??= { agree: 0, disagree: 0, skipped: 0, skipReasons: {} });
    d[o.kind] += 1;
    if (o.kind === "skipped" && o.reason) d.skipReasons[o.reason] = (d.skipReasons[o.reason] ?? 0) + 1;
  }

  addDiff(diff: Diff): void {
    const cat = diff.category;
    this.byCategory[cat] = (this.byCategory[cat] ?? 0) + 1;
    if (diff.category === "observer_error") this.observerErrors += 1;
    if (diff.category.startsWith("state_mismatch:") && diff.field) this.byField[diff.field] = (this.byField[diff.field] ?? 0) + 1;
    if (diff.category.startsWith("unsupported_capability:")) { const c = diff.category.slice("unsupported_capability:".length); this.byCapability[c] = (this.byCapability[c] ?? 0) + 1; }
    if (diff.kernelError && diff.category === "kernel_rejected_legal_action") this.byRejectCode[diff.kernelError.code] = (this.byRejectCode[diff.kernelError.code] ?? 0) + 1;
    if (diff.choiceDependent) this.choiceDependent += 1;
    // card counts: only real findings, not once-per-game bookkeeping
    if (diff.category !== "adapter_gap") for (const c of new Set(diff.cards)) this.byCard.set(c, (this.byCard.get(c) ?? 0) + 1);
    const ex = (this.examples[cat.startsWith("state_mismatch:") ? "state_mismatch" : cat.startsWith("unsupported_capability:") ? "unsupported_capability" : cat] ??= []);
    if (ex.length < 5) ex.push(diff);
  }
}

const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`);
const sortDesc = (o: Record<string, number>): Array<[string, number]> => Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const table = (head: string[], rows: Array<Array<string | number>>): string => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

export interface ReportMeta { startedAt: string; games: number; seed?: number; decks: string[]; wallClockMs: number; terminations: Record<string, number>; crashed: number; command?: string }

export function renderReport(agg: Aggregate, meta: ReportMeta): string {
  const out: string[] = [];
  out.push(`# Kernel observer report`, "", `- started: ${meta.startedAt}`, `- games: ${meta.games} (base seed ${meta.seed ?? "none"}), decks: ${meta.decks.join(", ")}`, `- wall clock: ${(meta.wallClockMs / 1000).toFixed(1)}s, observed legacy actions: ${agg.actions}`, `- game terminations: ${Object.entries(meta.terminations).map(([k, v]) => `${k}=${v}`).join(", ") || "n/a"}${meta.crashed ? ` (crashed: ${meta.crashed})` : ""}`);
  if (meta.command) out.push(`- reproduce: \`${meta.command}\``);
  const all = Object.values(agg.byDeck).reduce((a, d) => ({ agree: a.agree + d.agree, disagree: a.disagree + d.disagree, skipped: a.skipped + d.skipped }), { agree: 0, disagree: 0, skipped: 0 });
  const compared = all.agree + all.disagree;
  out.push("", "## Headline", "", `- compared actions: ${compared} of ${agg.actions} (${pct(compared, agg.actions)}); skipped: ${all.skipped}`, `- kernel agrees with legacy on ${all.agree} of ${compared} compared actions: **${pct(all.agree, compared)} agreement**`, `- diffs written: ${Object.values(agg.byCategory).reduce((a, b) => a + b, 0)}; of the state mismatches / rejections, ${agg.choiceDependent} depend on a kernel decision answered by the default policy`);
  out.push("", "## Diffs by category", "", table(["category", "count"], sortDesc(agg.byCategory).map(([k, v]) => [k, v])));
  out.push("", "## Per intent", "", table(["legacy action", "agree", "disagree", "skipped", "agreement"], Object.entries(agg.byIntent).sort((a, b) => (b[1].agree + b[1].disagree) - (a[1].agree + a[1].disagree)).map(([k, v]) => [k, v.agree, v.disagree, v.skipped, pct(v.agree, v.agree + v.disagree)])));
  out.push("", "## Per deck: kernel readiness", "", "readiness = actions where kernel and legacy agree / actions that could be compared (skipped ones excluded; `coverage` = compared / all).", "", table(["deck", "agree", "disagree", "skipped", "readiness", "coverage", "top skip reasons"], Object.entries(agg.byDeck).map(([k, v]) => [k, v.agree, v.disagree, v.skipped, pct(v.agree, v.agree + v.disagree), pct(v.agree + v.disagree, v.agree + v.disagree + v.skipped), sortDesc(v.skipReasons).slice(0, 3).map(([r, n]) => `${r} (${n})`).join("; ")])));
  out.push("", "## Top 20 cards involved in diffs", "", table(["card", "diffs"], [...agg.byCard.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20).map(([k, v]) => [k, v])));
  out.push("", "## Top mismatched fields", "", table(["field", "count"], sortDesc(agg.byField).slice(0, 20).map(([k, v]) => [k, v])));
  if (Object.keys(agg.byCapability).length) out.push("", "## Unsupported capabilities (kernel refused)", "", table(["capability", "count"], sortDesc(agg.byCapability).slice(0, 20).map(([k, v]) => [k, v])));
  if (Object.keys(agg.byRejectCode).length) out.push("", "## Kernel rejection codes", "", table(["error.code", "count"], sortDesc(agg.byRejectCode).map(([k, v]) => [k, v])));
  out.push("", "## Examples (first few per category)", "");
  for (const [cat, list] of Object.entries(agg.examples)) {
    out.push(`### ${cat}`, "");
    for (const d of list) out.push(`- game ${d.game} seed ${d.seed ?? "-"} action #${d.actionIndex} turn ${d.turn} ${d.phase} (${d.seat}): ${d.intent.type}${d.intent.card ? ` ${d.intent.card}` : ""}: ${d.message.split("\n")[0]}${d.cards.length ? ` [${d.cards.slice(0, 4).join(", ")}]` : ""}${d.kernelError ? ` (${d.kernelError.code})` : ""}`);
    out.push("");
  }
  return out.join("\n");
}
