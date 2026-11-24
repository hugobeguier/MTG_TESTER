// Stale-pack safeguard: the browser runs public/kernel-packs/*.json (generated, git-ignored), not data/kernel-drafts. A pack older than its drafts once made a fixed card
// (Archaeomancer's Map) keep misbehaving in a real game. Every pack and index.json record the draft hash; this fails when they differ.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { draftHash, stalePacks, STALE_MESSAGE } from "./draftHash";

const packsDir = path.resolve(process.cwd(), "public/kernel-packs");

describe("kernel packs vs card drafts", () => {
  it.skipIf(!fs.existsSync(path.join(packsDir, "index.json")))("public/kernel-packs is not older than data/kernel-drafts", () => {
    const stale = stalePacks(packsDir);
    expect(stale, `${STALE_MESSAGE} (${stale.map((s) => s.slug).join(", ")})`).toEqual([]);
  });
  it.skipIf(!fs.existsSync(path.join(packsDir, "index.json")))("each pack file carries the same hash as the index", () => {
    const index = JSON.parse(fs.readFileSync(path.join(packsDir, "index.json"), "utf8")) as { packs: Array<{ slug: string; draftHash?: string }> };
    for (const p of index.packs) expect(JSON.parse(fs.readFileSync(path.join(packsDir, `${p.slug}.json`), "utf8")).draftHash, p.slug).toBe(p.draftHash);
  });
  it("the hash changes with any draft edit and detects a stale index", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "drafts-"));
    fs.mkdirSync(path.join(tmp, "d"));
    fs.writeFileSync(path.join(tmp, "d", "a.json"), "{\"x\":1}\n");
    const h1 = draftHash("d", tmp);
    const packs = path.join(tmp, "packs"); fs.mkdirSync(packs);
    fs.writeFileSync(path.join(packs, "index.json"), JSON.stringify({ packs: [{ slug: "d", draftHash: h1 }] }));
    expect(stalePacks(packs, tmp)).toEqual([]);
    fs.writeFileSync(path.join(tmp, "d", "a.json"), "{\"x\":2}\n");
    expect(draftHash("d", tmp)).not.toBe(h1);
    expect(stalePacks(packs, tmp)).toMatchObject([{ slug: "d", packHash: h1 }]);
    fs.writeFileSync(path.join(packs, "index.json"), JSON.stringify({ packs: [{ slug: "d" }] })); // a pack from before hashes existed is stale too
    expect(stalePacks(packs, tmp)).toHaveLength(1);
  });
});
