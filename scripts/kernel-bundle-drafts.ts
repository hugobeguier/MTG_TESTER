// Writes the card packs the browser needs to run the kernel: public/kernel-packs/<deck-slug>.json (+ index.json).
//   npm run kernel:bundle-drafts                      every deck that is READY (every card of the deck is fully runnable by the kernel)
//   npm run kernel:bundle-drafts -- --decks wretched-ranks,keen-engineering
//   npm run kernel:bundle-drafts -- --all             every deck with a draft folder, ready or not (unsupported cards are listed in the pack)
//   npm run kernel:bundle-drafts -- --out some/dir
// The output is generated data (about 0.4 MB per deck) and is git-ignored; the browser fetches it from /kernel-packs/<slug>.json (see src/kernel/integration/README.md).
import fs from "node:fs";
import path from "node:path";
import { buildPack, draftSlugs } from "../src/kernel/integration/nodePack";
import { loadDraftLookup } from "../src/kernel/observer/draftLookup";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const out = path.resolve(process.cwd(), opt("out") ?? "public/kernel-packs");
const all = draftSlugs();
const wanted = opt("decks")?.split(",").map((s) => s.trim()).filter(Boolean);
const slugs = wanted ? wanted.map((w) => all.find((s) => s === w || s.replace(/-/g, "") === w.toLowerCase().replace(/[^a-z0-9]/g, "")) ?? w) : all;
fs.mkdirSync(out, { recursive: true });
const dl = loadDraftLookup();
const index: Array<{ slug: string; deck: string; cards: number; unsupported: number; ready: boolean; bytes: number }> = [];
for (const slug of slugs) {
  if (!all.includes(slug)) { console.error(`no draft folder "${slug}" (have: ${all.join(", ")})`); process.exitCode = 1; continue; }
  const pack = buildPack(slug, { dl });
  const ready = pack.unsupported.length === 0;
  if (!ready && !flag("all") && !wanted) { console.log(`skip ${slug}: ${pack.unsupported.length} card(s) the kernel cannot run fully (use --all or --decks to bundle anyway)`); continue; }
  const json = JSON.stringify(pack);
  fs.writeFileSync(path.join(out, `${slug}.json`), json);
  index.push({ slug, deck: pack.deck, cards: Object.keys(pack.cards).length, unsupported: pack.unsupported.length, ready, bytes: json.length });
  console.log(`wrote ${slug}.json: ${Object.keys(pack.cards).length} cards, ${pack.unsupported.length} unsupported, ${(json.length / 1024).toFixed(0)} KB`);
}
fs.writeFileSync(path.join(out, "index.json"), JSON.stringify({ generatedAt: new Date().toISOString(), packs: index }, null, 1));
