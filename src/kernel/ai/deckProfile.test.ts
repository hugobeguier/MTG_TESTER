// The deck profile (kernel/ai/profile.ts) read from the real drafted decks (data/kernel-drafts/<deck>/_index.json -> decks/**.txt): every deck is profiled
// without errors, deterministically, and the decks whose identity is known produce the matching profile. The profile reads structured card JSON only.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { ctx, deckNames } from "../integration/testgame";
import { deckProfile } from "./profile";

const root = "data/kernel-drafts";
const decks = fs.readdirSync(root).filter((d) => fs.existsSync(`${root}/${d}/_index.json`)).map((dir) => ({ dir, name: (JSON.parse(fs.readFileSync(`${root}/${dir}/_index.json`, "utf8")) as { deck: string }).deck }));
const profiles = new Map(decks.map(({ dir, name }) => { const d = deckNames(name); return [dir, { d, p: deckProfile(d.cards, d.commander, ctx) }] as const; }));
const prof = (dir: string) => profiles.get(dir)!.p;

describe("deck profile over all drafted decks", () => {
  it("covers all 13 decks, each with a commander profile and engine pieces", () => {
    expect(decks.length).toBe(13);
    for (const [dir, { d, p }] of profiles) {
      expect(p.size, dir).toBeGreaterThan(30);
      expect(p.commander?.name, dir).toBe(d.commander);
      expect(p.engines.length, dir).toBeGreaterThan(0);
      expect(p.tokenMakers.length + p.drawEngines.length + p.etbPayoffs.length, dir).toBeGreaterThan(0);
    }
  });
  it("is deterministic (same deck, same profile; card order does not matter)", () => {
    for (const [dir, { d, p }] of profiles) {
      expect(deckProfile([...d.cards].reverse(), d.commander, ctx), dir).toEqual(p);
    }
  });
  it("Meren: sacrifice outlets, recursion, experience counters, an end-step commander", () => {
    for (const dir of ["meren", "meren-built-on-my-own"]) {
      const p = prof(dir);
      expect(p.sacOutlets.length, dir).toBeGreaterThanOrEqual(5);
      expect(p.recursion.length, dir).toBeGreaterThanOrEqual(5);
      expect(p.recursionEngines, dir).toContain("Meren of Clan Nel Toth");
      expect(p.deathPayoffs, dir).toContain("Meren of Clan Nel Toth");
      expect(p.playerCounterKinds.experience, dir).toBeGreaterThan(0);
      expect(p.playerCounterBoost.experience, dir).toBeGreaterThan(0.3);
      expect(p.commander).toMatchObject({ recursion: true, endStepEffect: true, deathPayoff: true });
      expect(p.commander!.playerCounterKinds).toContain("experience");
      expect(p.hasEndStepPayoff && p.graveyardCredit > 0.1, dir).toBe(true);
    }
  });
  it("only the Meren decks care about experience counters", () => {
    for (const [dir, { p }] of profiles) if (!dir.startsWith("meren")) expect(p.playerCounterKinds.experience, dir).toBeUndefined();
  });
  it("token decks have token makers; Wretched Ranks / Squirreled Away have outlets and death payoffs; Tramplesaurus has neither", () => {
    for (const dir of ["lathliss", "reign-of-dragons", "saheeli", "squirreled-away", "wretched-ranks"]) expect(prof(dir).tokenMakers.length, dir).toBeGreaterThanOrEqual(5);
    for (const dir of ["wretched-ranks", "squirreled-away"]) { expect(prof(dir).sacOutlets.length, dir).toBeGreaterThanOrEqual(3); expect(prof(dir).deathPayoffs.length, dir).toBeGreaterThanOrEqual(3); }
    expect(prof("tramplesaurus-rex").sacOutlets.length).toBe(0);
    expect(prof("tramplesaurus-rex").recursion.length).toBe(0);
    expect(prof("tramplesaurus-rex").graveyardCredit).toBe(0);
  });
  it("commander triggers are read from the JSON (Sai: cast trigger that makes tokens; Hazel: end-step trigger)", () => {
    expect(prof("keen-engineering").commander).toMatchObject({ events: ["cast"], produces: ["create_tokens"] });
    expect(prof("squirreled-away").commander!.endStepEffect).toBe(true);
  });
}, 120000);
