// Contaminated Aquifer (two mana abilities, {U} and {B}, each carrying the whole card text) and every other drafted multi-colour source: the colour button the
// player presses must produce exactly that colour, outside a payment (floating mana) and inside the payment banner.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { KernelGameController } from "./kernelController";

function game(battlefield: string[], commander = false) {
  const t = mini(["p1", "p2"], { phase: "precombat_main" });
  for (let i = 0; i < 4; i++) { t.give("p1", "Island", "library"); t.give("p2", "Island", "library"); }
  const src = battlefield.map((n) => t.give("p1", n, "battlefield"));
  if (commander) {
    const cmd = t.give("p1", "Aminatou, the Fateshifter", "battlefield");
    t.state.objects[cmd].isCommander = true; t.state.objects[cmd].zone = "command";
    t.state.battlefield = t.state.battlefield.filter((i) => i !== cmd); t.state.players[0].command.push(cmd); t.state.players[0].colorIdentity = ["W", "U", "B"] as never;
  }
  const ks = KernelSession.fromState(t.state, { ctx, display: (() => undefined) as never, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } } as never);
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
  return { ks, c, src, t };
}
const pool = (ks: KernelSession) => ks.state.players[0].manaPool as unknown as Record<string, number>;
const pooled = (ks: KernelSession) => Object.entries(pool(ks)).filter(([, n]) => n > 0).map(([k, n]) => `${k}${n}`).sort().join("");

describe("Contaminated Aquifer colour buttons", () => {
  for (const colour of ["U", "B"]) {
    it(`outside a payment: pressing ${colour} adds ${colour}`, () => {
      const { ks, c, src } = game(["Contaminated Aquifer"]);
      ks.state.objects[src[0]].tapped = false;
      c.tapForMana("p1", src[0]);
      const m = c.manaChoice();
      expect(m?.choices.slice().sort()).toEqual(["B", "U"]);
      c.chooseMana(colour);
      expect(pooled(ks)).toBe(`${colour}1`);
    });
  }
});

/** every drafted card that has a mana ability, with the colours its abilities can produce */
function drafted(): string[] {
  const out = new Set<string>();
  const root = "data/kernel-drafts";
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    const idx = `${root}/${d.name}/_index.json`;
    if (!d.isDirectory() || !fs.existsSync(idx)) continue;
    for (const c of JSON.parse(fs.readFileSync(idx, "utf8")).cards as Array<{ slug: string; name: string }>) {
      const f = `${root}/${d.name}/${c.slug}.json`;
      if (!fs.existsSync(f)) continue;
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      if ((j.abilities ?? []).some((a: { kind: string; costs?: unknown[] }) => a.kind === "mana" && JSON.stringify(a.costs ?? []).match(/tap/) && !JSON.stringify(a.costs ?? []).match(/mana|tapOther|sacrifice|counter/i))) out.add(c.name);
    }
  }
  return [...out].sort();
}

describe("sweep: each colour button of every drafted mana source produces exactly that colour", () => {
  const names = drafted();
  it("finds the sources", () => { expect(names).toContain("Contaminated Aquifer"); expect(names.length).toBeGreaterThan(20); });
  it.each(names)("%s", (name) => {
    if (!ctx.cards(name)) return;
    const probe = game([name]);
    probe.c.tapForMana("p1", probe.src[0]);
    const offered = probe.c.manaChoice();
    if (!offered) return; // one way only (or a decision of its own): nothing to pick between
    for (const key of offered.choices as string[]) {
      if (key === "Any") continue;
      const run = (extra: boolean) => {
        const g = game(extra ? [name, "Swamp"] : [name]);
        if (extra) g.c.tapForMana("p1", g.src[1]); // a filter land pays its own hybrid cost from floating mana: that Swamp's {B}
        g.c.tapForMana("p1", g.src[0]);
        g.c.chooseMana(key);
        return g;
      };
      let g = run(false);
      if (!pooled(g.ks)) g = run(true);
      if (g.ks.state.pending) continue; // the source asks something else of its own
      const want = key.split("").sort().join("");
      const got = Object.entries(pool(g.ks)).flatMap(([k, n]) => Array(n).fill(k) as string[]).sort().join("");
      expect(got, `${name}: button ${key}`).toBe(want);
    }
  });
});

describe("Contaminated Aquifer inside the payment banner", () => {
  for (const colour of ["U", "B"]) {
    it(`pressing ${colour} while paying taps for ${colour}`, () => {
      const { ks, c, src } = game(["Contaminated Aquifer", "Island", "Plains", "Swamp", "Island"], true);
      c.castCommander("p1");
      expect(ks.state.pending?.kind).toBe("pay_mana");
      c.tapForMana("p1", src[0]);
      expect(c.manaChoice()?.choices.slice().sort()).toEqual(["B", "U"]);
      c.chooseMana(colour);
      expect(ks.state.players[0].manaTaps?.find((x) => x.source === src[0])?.colors).toEqual([colour]);
    });
  }
});
