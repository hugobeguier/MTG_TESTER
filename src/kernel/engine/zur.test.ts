// Zur, Eternal Schemer (real draft): "{1}{W}: Target non-Aura enchantment you control becomes a creature in addition to its other types and has base power and base toughness each equal to its mana value."
import { describe, expect, it } from "vitest";
import { legalActions } from "./legal";
import { chars } from "./core";
import { ctx, mini } from "@/kernel/integration/testgame";

const charsOf = (s: never, id: string) => chars({ s: structuredClone(s), events: [], defs: ctx.cards, scanned: 0 } as never, id);
describe("Zur, Eternal Schemer activation", () => {
  for (const n of [2, 4]) it(`${n} players: lists the ability with the enchantment as a target and animates it`, () => {
    const t = mini(Array.from({ length: n }, (_, i) => `p${i + 1}`), { phase: "precombat_main" });
    const zur = t.give("p1", "Zur, Eternal Schemer", "battlefield");
    const ench = t.give("p1", "Sigil of the Empty Throne", "battlefield"); // MV 5
    const other = t.give("p2", "Sigil of the Empty Throne", "battlefield");
    for (let i = 0; i < 2; i++) t.give("p1", "Plains", "battlefield");
    const acts = legalActions(t.state, "p1", ctx).filter((a) => a.kind === "activateAbility" && a.objectId === zur && !a.isMana);
    console.log(JSON.stringify(acts.map((a) => ({ id: a.id, asks: a.asks, targetOptions: a.targetOptions }))));
    expect(acts.length).toBe(1);
    const r = t.ok({ type: "activateAbility", player: "p1", sourceId: zur, abilityId: "a3" } as never);
    console.log("after activate", JSON.stringify(r.pending));
    if (t.state.pending) t.answer({ ids: [ench] } as never);
    if (t.state.pending) t.answer({ ids: ["#1"] } as never);
    t.settle();
    const c = charsOf(t.state as never, ench);
    console.log(JSON.stringify({ types: c.types, p: c.power, t: c.toughness, pend: t.state.pending }));
    expect(c.types).toContain("creature"); expect(c.power).toBe(5);
    expect(charsOf(t.state as never, other).types).not.toContain("creature");
  });
});

function animated(opts: { fresh?: boolean } = {}) {
  const t = mini(["p1", "p2"], { phase: "precombat_main" });
  const zur = t.give("p1", "Zur, Eternal Schemer", "battlefield");
  const ench = t.give("p1", "Sigil of the Empty Throne", "battlefield", { fresh: opts.fresh });
  for (let i = 0; i < 2; i++) t.give("p1", "Plains", "battlefield");
  t.give("p2", "Island", "library");
  t.ok({ type: "activateAbility", player: "p1", sourceId: zur, abilityId: "a3" } as never);
  t.answer({ ids: [ench] } as never);
  t.settle();
  return { t, zur, ench };
}
describe("an animated enchantment is a real creature (CR 302.6, 613.1d, 613.4b)", () => {
  it("it can attack when it was controlled since the turn began, and deals 5 combat damage", () => {
    const { t, ench } = animated();
    for (let i = 0; i < 4 && t.state.turn.phase !== "declare_attackers"; i++) t.ok({ type: "advancePhase", player: "p1" });
    t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: ench, defender: "p2" }] } as never);
    for (let i = 0; i < 12 && t.state.turn.phase !== "end_of_combat" && !t.state.pending; i++) t.ok({ type: "advancePhase", player: t.state.turn.active });
    expect(t.state.players.find((p) => p.id === "p2")!.life).toBe(35);
  });
  it("summoning sickness applies to an enchantment that came under its controller's control this turn", () => {
    const { t, ench } = animated({ fresh: true });
    for (let i = 0; i < 4 && t.state.turn.phase !== "declare_attackers"; i++) t.ok({ type: "advancePhase", player: "p1" });
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [{ id: ench, defender: "p2" }] } as never).error?.code).toBe("illegal_attack");
  });
  it("the text has no duration: it is still a 5/5 creature after the end of the turn and on the next turn", () => {
    const { t, ench } = animated();
    const turn = t.state.turn.number;
    for (let i = 0; i < 40 && t.state.turn.number < turn + 2 && !t.state.pending; i++) t.ok({ type: "advancePhase", player: t.state.turn.active } as never);
    expect(t.state.turn.number).toBeGreaterThan(turn);
    const c = charsOf(t.state as never, ench);
    expect(c.types).toContain("creature"); expect([c.power, c.toughness]).toEqual([5, 5]);
  });
});

describe("every drafted non-Aura enchantment can be animated by Zur", () => {
  it("is offered as a target and becomes a creature with at least its mana value as P/T (anthems such as Bad Moon add on top; Rooms are skipped)", () => {
    const { readFileSync, readdirSync, statSync, existsSync } = require("node:fs") as typeof import("node:fs");
    const names = new Set<string>();
    for (const d of readdirSync("data/kernel-drafts").filter((x: string) => statSync(`data/kernel-drafts/${x}`).isDirectory() && existsSync(`data/kernel-drafts/${x}/_index.json`)))
      for (const e of (JSON.parse(readFileSync(`data/kernel-drafts/${d}/_index.json`, "utf8")) as { cards: Array<{ name: string }> }).cards) names.add(e.name);
    const bad: string[] = [];
    for (const n of names) {
      const def = ctx.cards(n); if (!def || !def.types.includes("enchantment") || def.subtypes?.includes("Aura") || def.types.includes("creature") || def.subtypes?.includes("Room") || def.name !== n) continue;
      const t = mini(["p1", "p2"], { phase: "precombat_main" });
      const zur = t.give("p1", "Zur, Eternal Schemer", "battlefield"); const e = t.give("p1", n, "battlefield");
      for (let i = 0; i < 2; i++) t.give("p1", "Plains", "battlefield"); t.give("p2", "Island", "library");
      const la = legalActions(t.state, "p1", ctx).find((a) => a.kind === "activateAbility" && a.objectId === zur && a.abilityId === "a3");
      if (!la?.targetOptions?.includes(e)) { bad.push(`${n}: not a listed target`); continue; }
      try {
        const res = t.do({ type: "activateAbility", player: "p1", sourceId: zur, abilityId: "a3" } as never);
        if (res.error) { bad.push(`${n}: ${res.error.message}`); continue; }
        if (t.state.pending) t.answer({ ids: [e] } as never);
        if (t.state.pending) t.answer({ ids: ["#1"] } as never);
        t.settle();
        const c = charsOf(t.state as never, e);
        const mv = ctx.db?.card(n)?.manaCost ? (ctx.db.card(n)!.manaCost!.match(/\{[^}]*\}/g) ?? []).reduce((s, x) => s + (/^\{(\d+)\}$/.test(x) ? Number(x.slice(1, -1)) : /X/.test(x) ? 0 : 1), 0) : 0;
        const alive = t.state.battlefield.includes(e);
        if (mv > 0 && (!alive || !c.types.includes("creature") || (c.power ?? 0) < mv || (c.toughness ?? 0) < mv)) bad.push(`${n}: types ${c.types} ${c.power}/${c.toughness} want ${mv}`);
      } catch (err) { bad.push(`${n}: threw ${(err as Error).message.slice(0, 100)}`); }
    }
    expect(bad).toEqual([]);
  }, 300000);
});
