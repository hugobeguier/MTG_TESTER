// The "never a no-op" harness: for EVERY nonland card of the drafted decks, put it in the AI's hand on a small shared board (lands of every color, a few creatures
// on both sides, 2 players) and let the AI play one decision. Whatever it casts or activates must change the position (the card itself moving does not count).
// A spell the kernel cannot do yet is a no-op by definition: the lookahead sees that and the AI simply does not cast it.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ctx } from "../integration/testgame";
import { draftSlugs } from "../integration/nodePack";
import { debugPlaceCard } from "../engine/setup";
import { evaluate } from "./evaluate";
import { board, playOne } from "./kernelAiKit";
import { mini } from "../integration/testgame";
import type { GameState } from "../engine/types";

const root = path.resolve(process.cwd(), "data/kernel-drafts");
const names = [...new Set(draftSlugs(root).flatMap((s) => (JSON.parse(fs.readFileSync(path.join(root, s, "_index.json"), "utf8")) as { cards: Array<{ name: string }> }).cards.map((c) => c.name)))].sort();

describe("no-op harness over every drafted card", () => {
  const { t: base } = board({
    p1: { lands: { Plains: 2, Island: 2, Swamp: 2, Mountain: 2, Forest: 2 }, field: ["Elvish Mystic", "Segovian Angel"] },
    p2: { lands: { Plains: 1, Island: 1 }, field: ["Palladium Myr", "Llanowar Elves", "Gigantosaurus"] }
  }, { library: 12 });
  const start: GameState = base.state;

  const CHUNKS = 8;
  const tally = { tried: 0, cast: 0 };
  for (let c = 0; c < CHUNKS; c++) it(`part ${c + 1}/${CHUNKS}: the AI never casts / activates something that changes nothing`, () => {
    const noops: string[] = [], errors: string[] = [];
    let tried = 0, cast = 0;
    for (const name of names.filter((_, i) => i % CHUNKS === c)) {
      const def = ctx.cards(name);
      if (!def || def.types.includes("land") && def.types.length === 1) continue;
      let s: GameState;
      let id: string;
      try { const r = debugPlaceCard(structuredClone(start), ctx.cards, "p1", name, "hand"); s = r.state; id = r.id; } catch { continue; }
      const t = mini(["p1", "p2"]);
      t.state = s;
      tried++;
      try {
        const before = evaluate(s, ctx, "p1", id).sig;
        const r = playOne(t, "p1");
        if (!r.label) continue;
        cast++;
        const after = evaluate(t.state, ctx, "p1", id).sig;
        if (after === before) noops.push(`${name}: ${r.label}`);
      } catch (e) { errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    tally.tried += tried; tally.cast += cast;
    expect(noops).toEqual([]);
    expect(errors).toEqual([]);
    expect(tried).toBeGreaterThan(50);
  }, 300_000);
  it("covered most of the drafted cards", () => { expect(tally.tried).toBeGreaterThan(500); expect(tally.cast).toBeGreaterThan(300); });
});
