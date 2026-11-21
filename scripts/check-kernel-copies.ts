// Fails when the same card (by slug) has different JSON in different deck dirs under data/kernel-drafts.
//   npm run kernel:check-copies [-- --fix]
//   --fix  overwrite differing copies with the best variant: fewest review.ignore entries, then most review.notes, then most decks
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.join("data", "kernel-drafts");
const FIX = process.argv.includes("--fix");
const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
const bySlug = new Map<string, Map<string, string[]>>(); // slug -> canonical json -> dirs
for (const d of readdirSync(root)) {
  const dir = path.join(root, d);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    const key = JSON.stringify(canon(JSON.parse(readFileSync(path.join(dir, f), "utf8"))));
    const slug = f.replace(/\.json$/, "");
    const m = bySlug.get(slug) ?? new Map<string, string[]>();
    m.set(key, [...(m.get(key) ?? []), d]);
    bySlug.set(slug, m);
  }
}

function fixSlug(slug: string, variants: Map<string, string[]>): void {
  const score = (k: string, ds: string[]) => {
    const r = (JSON.parse(k) as { review?: { ignore?: unknown[]; notes?: unknown[] } }).review;
    return [-(r?.ignore?.length ?? 0), r?.notes?.length ?? 0, ds.length];
  };
  const ranked = [...variants.entries()].sort((a, b) => {
    const x = score(a[0], a[1]), y = score(b[0], b[1]);
    return (y[0] - x[0]) || (y[1] - x[1]) || (y[2] - x[2]);
  });
  const best = ranked[0];
  const text = JSON.stringify(JSON.parse(readFileSync(path.join(root, best[1][0], `${slug}.json`), "utf8")), null, 2) + "\n";
  for (const [, ds] of ranked.slice(1)) for (const d of ds) {
    writeFileSync(path.join(root, d, `${slug}.json`), text);
    console.log(`fixed ${slug} in ${d} (copied from ${best[1].join(",")})`);
  }
}

let bad = 0;
for (const [slug, variants] of bySlug) {
  if (variants.size <= 1) continue;
  if (FIX) { fixSlug(slug, variants); continue; }
  bad++;
  console.log(`DIFFERS ${slug}: ${[...variants.values()].map((ds) => `[${ds.join(", ")}]`).join(" vs ")}`);
}
console.log(bad ? `\n${bad} card(s) have differing copies` : `all ${bySlug.size} cards are identical across decks`);
process.exit(bad ? 1 : 0);
