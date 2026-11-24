// Sweep over EVERY drafted card (data/kernel-drafts/**): each non-mana activated ability whose cost is payable and whose targets exist must be listed by
// legalActions, and running it (targets chosen by the first option, costs auto-paid, everything resolved) must neither be refused nor leave an `unresolved`
// event (a step the engine silently skipped in continue mode). This is the class of bug behind "I cannot use Zur's ability": a draft marked "needed"
// whose ability the engine could (or could not) run is only seen by actually running it.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { legalActions } from "./legal";
import { ctx, mini } from "@/kernel/integration/testgame";
import type { Ability, Card } from "../schema";
import type { Choice } from "./types";
import { PREDEFINED_TOKEN_ABILITIES } from "./steps";

const root = path.join("data", "kernel-drafts");
function allCards(): Map<string, { name: string; card: Card }> {
  const out = new Map<string, { name: string; card: Card }>();
  for (const d of readdirSync(root).filter((x) => statSync(path.join(root, x)).isDirectory() && existsSync(path.join(root, x, "_index.json")))) {
    for (const e of (JSON.parse(readFileSync(path.join(root, d, "_index.json"), "utf8")) as { cards: Array<{ slug: string; name: string }> }).cards)
      if (!out.has(e.name)) out.set(e.name, { name: e.name, card: JSON.parse(readFileSync(path.join(root, d, `${e.slug}.json`), "utf8")) as Card });
  }
  return out;
}

/** a crowded table: the source, mana of every colour, creatures / enchantment / artifact / planeswalker for both players, cards in every zone */
function board(name: string, zone: string) {
  const t = mini(["p1", "p2"], { phase: "precombat_main" });
  for (const p of ["p1", "p2"]) {
    for (let i = 0; i < 6; i++) t.give(p, "Island", "library");
    for (let i = 0; i < 3; i++) t.give(p, "Ledger Shredder", "battlefield");
    t.give(p, "Sigil of the Empty Throne", "battlefield"); t.give(p, "Sol Ring", "battlefield"); t.give(p, "Aminatou, the Fateshifter", "battlefield");
    t.give(p, "Zur, Eternal Schemer", "battlefield");
    t.give(p, "Ledger Shredder", "graveyard"); t.give(p, "Counterspell", "graveyard"); t.give(p, "Plains", "graveyard");
    t.give(p, "Brainstorm", "hand"); t.give(p, "Ponder", "hand"); t.give(p, "Ledger Shredder", "hand"); t.give(p, "Sigil of the Empty Throne", "graveyard"); t.give(p, "Sol Ring", "graveyard");
    for (const pw of t.state.battlefield) if (t.state.objects[pw].controller === p && t.state.objects[pw].cardName === "Aminatou, the Fateshifter") t.state.objects[pw].counters = { loyalty: 10 };
  }
  for (const l of ["Plains", "Island", "Swamp", "Mountain", "Forest"]) for (let i = 0; i < 4; i++) t.give("p1", l, "battlefield");
  // the extra material some abilities ask for: artifacts, Zombies, Insects/Squirrels, a Dragon, tokens (Treasure, Food), counters, a commander, a life lead
  for (let i = 0; i < 3; i++) t.give("p1", "Sol Ring", "battlefield");
  for (let i = 0; i < 5; i++) t.give("p1", "Cryptbreaker", "battlefield");
  t.give("p1", "Cryptbreaker", "graveyard"); t.give("p1", "The Ur-Dragon", "battlefield"); t.give("p1", "The Ur-Dragon", "graveyard"); t.give("p1", "Ravenous Squirrel", "battlefield");
  t.state.players[0].life = 50; for (let i = 0; i < 9; i++) t.give("p2", "Plains", "graveyard");
  for (const [tok, sub] of [["Treasure", "Treasure"], ["Treasure", "Treasure"], ["Treasure", "Treasure"], ["Food", "Food"]] as const) {
    const id = t.give("p1", "Sol Ring", "battlefield");
    t.state.objects[id].token = { name: tok, types: ["artifact"], subtypes: [sub], colors: [], keywords: [], abilities: [PREDEFINED_TOKEN_ABILITIES[tok as "Treasure"]] } as never;
  }
  for (const id of t.state.battlefield) { const o = t.state.objects[id]; if (o.controller === "p1" && o.cardName === "Ledger Shredder") o.counters = { "+1/+1": 3 }; if (o.cardName === "Cryptbreaker" && !o.isCommander) o.isCommander = true; }
  t.state.players[1].life = 20;
  const src = t.give("p1", name, zone as never);
  { const o = t.state.objects[src]; o.counters = { ...(o.counters ?? {}), loyalty: 12, page: 3, gold: 3 }; }
  return { t, src };
}
const DONE_KINDS = new Set(["unresolved"]);

export function sweep(only?: string[]): { listed: number; missing: Array<{ card: string; ability: string; text: string }>; refused: string[]; unresolved: string[] } {
  const missing: Array<{ card: string; ability: string; text: string }> = [], refused: string[] = [], unresolved: string[] = [];
  let listed = 0;
  for (const { name, card } of allCards().values()) {
    if (only && !only.includes(name)) continue;
    const acts = card.abilities.filter((a: Ability) => a.kind === "activated" && a.steps?.length);
    for (const ab of acts) {
      let b;
      try { b = board(name, ab.zone ?? "battlefield"); } catch (e) { missing.push({ card: name, ability: ab.id, text: `setup failed: ${(e as Error).message}` }); continue; }
      const { t, src } = b;
      const list = legalActions(t.state, "p1", ctx).filter((a) => a.kind === "activateAbility" && a.objectId === src && a.abilityId === ab.id);
      if (!list.length) { missing.push({ card: name, ability: ab.id, text: ab.text ?? "" }); continue; }
      listed++;
      try { runOne(); } catch (e) { const st = ((e as Error).stack ?? "").split(String.fromCharCode(10)); refused.push(`${name} ${ab.id}: threw ${(e as Error).message.slice(0, 120)} @ ${st[1]?.trim()} | ${st[2]?.trim()} pending=${t.state.pending?.kind}`); }
      function runOne(): void {
      const res = t.do({ type: "activateAbility", player: "p1", sourceId: src, abilityId: ab.id, autoPay: true } as never);
      if (res.error) { refused.push(`${name} ${ab.id}: ${res.error.code} ${res.error.message}`); return; }
      const evs = [...res.events];
      for (let i = 0; i < 12 && (t.state.pending || t.state.stack.length); i++) {
        const p = t.state.pending;
        let r;
        if (p) {
          const ids = p.options.slice(0, Math.max(p.min, Math.min(1, p.max))).map((o) => o.id);
          const pc = (p as unknown as { counters?: { min: number; available: Record<string, number> } }).counters; const pm = (p as unknown as { mana?: { total: number; colors: string[] } }).mana;
          const choice: Choice = pc ? { assign: (() => { let left = pc.min; const o: Record<string, number> = {}; for (const [k, v] of Object.entries(pc.available)) { const n = Math.min(v, left); if (n) o[k] = n; left -= n; } return o; })() } : pm ? { assign: { [pm.colors[0]]: pm.total } } : p.numeric ? ({ number: p.min } as never) : { ids };
          r = t.do({ type: "answerDecision", player: p.player, decisionId: p.id, choice });
          if (r.error) r = t.do({ type: "answerDecision", player: p.player, decisionId: p.id, choice: { ids: [] } });
          if (r.error) r = t.do({ type: "answerDecision", player: p.player, decisionId: p.id, choice: { yes: true } as never });
        } else r = t.do({ type: "passPriority", player: t.state.priority!, fastForward: true });
        if (r.error) { refused.push(`${name} ${ab.id} (resolving): ${r.error.code} ${r.error.message}`); break; }
        evs.push(...r.events);
      }
      for (const e of evs) if (DONE_KINDS.has(e.type) && (e as { card?: string }).card === name) unresolved.push(`${name} ${ab.id}: ${JSON.stringify(e).slice(0, 200)}`);
      }
    }
  }
  return { listed, missing, refused, unresolved };
}

// Abilities the generic board cannot enable (each has its own test elsewhere or needs combat / a level / this-turn history):
const NEEDS_SPECIAL_SETUP: Record<string, string> = {
  "Eiganjo, Seat of the Empire": "channel: needs an attacking or blocking creature",
  "Journey to Eternity // Atzal, Cave of Eternity": "a5 belongs to the back face",
  "Susur Secundi, Void Altar": "level-up class ability: needs level counters",
  "Idol of Oblivion": "needs a token created this turn"
};
describe("activated-ability sweep over all drafts", () => {
  it("every payable activated ability is listed, runs without refusal and without an unresolved step", () => {
    const r = sweep();
    if (process.env.SWEEP_OUT) writeFileSync(process.env.SWEEP_OUT, JSON.stringify(r, null, 1));
    expect(r.listed).toBeGreaterThan(150);
    expect(r.missing.filter((m) => !NEEDS_SPECIAL_SETUP[m.card])).toEqual([]);
    expect(r.refused).toEqual([]);
    expect(r.unresolved).toEqual([]);
  }, 600000);
});
