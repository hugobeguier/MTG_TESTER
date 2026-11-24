// NODE ONLY (fs): a content hash of one deck's card drafts (every .json under data/kernel-drafts/<slug>), recorded in each card pack and in public/kernel-packs/index.json
// so a pack that is older than the drafts can be detected (tests, `npm run dev`, the dev-only /api/dev/kernel-packs route, the kernel hand-off gate).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DRAFTS_ROOT = (): string => path.resolve(process.cwd(), "data/kernel-drafts");

export function draftHash(slug: string, root = DRAFTS_ROOT()): string {
  const dir = path.join(root, slug);
  const h = crypto.createHash("sha1");
  for (const f of fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".json")).sort()) {
    h.update(f); h.update("\0");
    h.update(fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n")); h.update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

export interface PackStaleness { slug: string; packHash: string | undefined; draftHash: string }

/** Decks whose pack in `packsDir` (read from its index.json) is missing a hash or differs from the current drafts. Empty when the packs are absent (nothing to compare). */
export function stalePacks(packsDir = path.resolve(process.cwd(), "public/kernel-packs"), root = DRAFTS_ROOT()): PackStaleness[] {
  const indexFile = path.join(packsDir, "index.json");
  if (!fs.existsSync(indexFile)) return [];
  const index = JSON.parse(fs.readFileSync(indexFile, "utf8")) as { packs?: Array<{ slug: string; draftHash?: string }> };
  const out: PackStaleness[] = [];
  for (const p of index.packs ?? []) {
    if (!fs.existsSync(path.join(root, p.slug))) continue;
    const cur = draftHash(p.slug, root);
    if (p.draftHash !== cur) out.push({ slug: p.slug, packHash: p.draftHash, draftHash: cur });
  }
  return out;
}

export const STALE_MESSAGE = "Kernel packs are older than the card drafts: run npm run kernel:bundle-drafts";
