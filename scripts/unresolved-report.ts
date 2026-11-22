// npm run unresolved:report [-- <extra .jsonl or observer run directory> ...]: table of every "Couldn't resolve" record (data/observer/live-unresolved.jsonl plus any extra files,
// e.g. observer legacy-unresolved.jsonl), sorted by frequency, with whether the kernel drafts mark the card runnable. Writes data/observer/UNRESOLVED.md.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cardUnsupported } from "../src/kernel/engine/support";
import { aggregateUnresolved, parseUnresolvedJsonl, renderUnresolvedMarkdown } from "../src/lib/unresolvedReport";
import { UNRESOLVED_LOG_RELATIVE_PATH } from "../src/lib/unresolvedLog";

// an observer run directory contributes its legacy-unresolved.jsonl and kernel-unresolved.jsonl (both in the live sink format; the engine column tells them apart)
const expand = (a: string): string[] => (existsSync(a) && statSync(a).isDirectory() ? ["legacy-unresolved.jsonl", "kernel-unresolved.jsonl"].map((n) => path.join(a, n)) : [a]);
const files = [UNRESOLVED_LOG_RELATIVE_PATH, ...process.argv.slice(2).filter((a) => !a.startsWith("--")).flatMap(expand)];
const records = files.filter((f) => existsSync(f)).flatMap((f) => parseUnresolvedJsonl(readFileSync(f, "utf8")));

// card name (lower-case) -> kernel runnable, from the kernel drafts (same support check as npm run kernel:overview).
const runnable = new Map<string, boolean>();
const root = path.join("data", "kernel-drafts");
if (existsSync(root)) {
  for (const deck of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const indexPath = path.join(root, deck.name, "_index.json");
    if (!existsSync(indexPath)) continue;
    const ix = JSON.parse(readFileSync(indexPath, "utf8")) as { cards: Array<{ slug: string; name: string }> };
    for (const e of ix.cards) {
      try {
        const card = JSON.parse(readFileSync(path.join(root, deck.name, `${e.slug}.json`), "utf8"));
        const ok = cardUnsupported({ name: e.name, types: [], kernel: card }).ok;
        runnable.set(e.name.toLowerCase(), (runnable.get(e.name.toLowerCase()) ?? true) && ok);
      } catch { /* a missing or malformed draft is "unknown" */ }
    }
  }
}
const rows = aggregateUnresolved(records, (name) => (runnable.has(name.toLowerCase()) ? (runnable.get(name.toLowerCase()) ? "yes" : "no") : "unknown"));
mkdirSync(path.join("data", "observer"), { recursive: true });
writeFileSync(path.join("data", "observer", "UNRESOLVED.md"), renderUnresolvedMarkdown(rows));
console.table(rows.map((r) => ({ card: r.cardName, engine: r.engines.join("+"), capability: r.capabilities.join(", "), clause: r.clause.slice(0, 70), times: r.times, first: r.firstSeen, last: r.lastSeen, decks: r.decks.join(", "), kernel: r.kernelRunnable })));
console.log(`${rows.length} distinct, ${records.length} records -> data/observer/UNRESOLVED.md`);
