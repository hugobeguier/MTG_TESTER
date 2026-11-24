// Thriving lands (real drafts): the chosen colour survives land-type-changing effects, and the human is offered every colour.
import { describe, expect, it } from "vitest";
import { realDef } from "./testdb";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { KernelGameController } from "@/components/game/kernelController";

const LANDS: Array<[string, string, string]> = [["Thriving Isle", "U", "W"], ["Thriving Heath", "W", "G"], ["Thriving Moor", "B", "R"]];

function setup(land: string, chosen: string, n = 2, effect?: { card: string; owner: string }) {
  const ids = Array.from({ length: n }, (_, i) => `p${i + 1}`);
  const t = mini(ids, { phase: "precombat_main" });
  const id = t.give("p1", land, "hand");
  const res = t.ok({ type: "playLand", player: "p1", cardId: id });
  t.answer({ ids: [chosen] }) ;
  void res;
  t.state.objects[id].tapped = false;
  if (effect) t.give(effect.owner, effect.card, "battlefield");
  for (let i = 0; i < 4; i++) for (const p of ids) t.give(p, "Island", "library");
  const ks = KernelSession.fromState(t.state, { ctx, display: (() => undefined) as never, seats: { p1: { kind: "human" }, ...Object.fromEntries(ids.slice(1).map((p) => [p, { kind: "agent" }])) } } as never);
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
  return { ks, c, id };
}
const keys = (c: KernelGameController, id: string) => { c.tapForMana("p1", id); return [...(c.manaChoice()?.choices ?? [])].sort(); };

describe("Thriving lands", () => {
  for (const [land, base, chosen] of LANDS) for (const [n, effect] of [[2, undefined], [2, { card: "Yavimaya, Cradle of Growth", owner: "p1" }], [4, { card: "Yavimaya, Cradle of Growth", owner: "p3" }], [2, { card: "Urborg, Tomb of Yawgmoth", owner: "p2" }]] as Array<[number, { card: string; owner: string } | undefined]>) {
    it(`${land} (chose ${chosen}) ${effect ? `with ${effect.card} of ${effect.owner}` : "alone"}, ${n} players`, () => {
      const { c, id } = setup(land, chosen, n, effect);
      const want = new Set([base, chosen]);
      if (effect?.card.startsWith("Yavimaya")) want.add("G");
      if (effect?.card.startsWith("Urborg")) want.add("B");
      expect(keys(c, id)).toEqual([...want].sort());
    });
  }
});

describe("chosen-colour mana through auto-pay and other chosen-colour sources", () => {
  it("Thriving Isle (chose W) pays for a {W} spell by itself, with Yavimaya in play", () => {
    const t = mini(["p1", "p2"], { phase: "precombat_main" });
    const id = t.give("p1", "Thriving Isle", "hand");
    t.ok({ type: "playLand", player: "p1", cardId: id }); t.answer({ ids: ["W"] }); t.state.objects[id].tapped = false;
    t.give("p2", "Yavimaya, Cradle of Growth", "battlefield"); t.give("p2", "Llanowar Elves", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Swords to Plowshares", "hand") });
    t.answer({ ids: ["#3"] });
    expect(t.state.objects[id].tapped).toBe(true);
  });
  it("Heraldic Banner produces their remembered colour", () => {
    for (const [name, key, col] of [["Heraldic Banner", "R", "red"]]) {
      const t = mini(["p1", "p2"], { phase: "precombat_main" });
      const id = t.give("p1", name, "battlefield"); t.state.objects[id].chosen = { color: col, type: "Elf" }; t.state.objects[id].tapped = false;
      const ab = realDef(name)!.kernel.abilities.filter((a) => a.kind === "mana" && JSON.stringify(a).includes("chosenColor"))[0];
      t.ok({ type: "activateAbility", player: "p1", sourceId: id, abilityId: ab.id } as never);
      expect(t.state.players[0].manaPool[key as "R"], name).toBeGreaterThan(0);
    }
  });
});
