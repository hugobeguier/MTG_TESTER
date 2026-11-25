// AI counterspell policy: not every spell is worth a counter, and "unless its controller pays" is only cast when the caster cannot pay.
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { legalActions } from "@/kernel/engine/legal";
import { chooseAiAction } from "./kernelAi";

/** p2 (active) casts `spell` after paying from `p2Lands` Plains; p1 holds `counter` with two untapped lands, and gets priority. */
function setup(spell: string, counter: string, p2Lands: number, p2Spare: number) {
  const t = mini(["p1", "p2"], { phase: "precombat_main" });
  t.give("p1", "Plains", "battlefield"); t.give("p1", "Island", "battlefield"); t.give("p1", "Island", "battlefield");
  for (let i = 0; i < p2Lands; i++) t.give("p2", "Plains", "battlefield");
  t.state = { ...t.state, turn: { ...t.state.turn, active: "p2" }, priority: "p2" };
  const sp = t.give("p2", spell, "hand");
  t.ok({ type: "castSpell", player: "p2", cardId: sp, autoPay: true });
  // leave exactly p2Spare untapped islands (tap the rest)
  const untapped = t.state.battlefield.filter((id) => t.state.objects[id].controller === "p2" && !t.state.objects[id].tapped);
  untapped.slice(p2Spare).forEach((id) => { t.state = { ...t.state, objects: { ...t.state.objects, [id]: { ...t.state.objects[id], tapped: true } } }; });
  t.give("p1", counter, "hand");
  t.state = { ...t.state, priority: "p1", passes: [] };
  return { t, sp };
}
const responds = (t: ReturnType<typeof mini>) => {
  const a = chooseAiAction(legalActions(t.state, "p1", ctx), t.state, ctx, "p1");
  return a?.type === "castSpell";
};

describe("AI counterspell policy", () => {
  it("Mana Tithe is not spent on a 2-mana mana rock, even when the caster is tapped out", () => {
    const { t } = setup("Talisman of Progress", "Mana Tithe", 2, 0);
    expect(responds(t)).toBe(false);
  });
  it("Mana Tithe on a real threat only when the caster cannot pay", () => {
    expect(responds(setup("Serra Angel", "Mana Tithe", 5, 0).t)).toBe(true);
    expect(responds(setup("Serra Angel", "Mana Tithe", 6, 1).t)).toBe(false);
  });
  it("a hard counter still hits a bomb even when the caster has mana open, but not a cheap rock", () => {
    expect(responds(setup("Serra Angel", "Counterspell", 6, 1).t)).toBe(true);
    expect(responds(setup("Talisman of Progress", "Counterspell", 3, 1).t)).toBe(false);
  });
  it("a sweeper is worth a counter", () => {
    expect(responds(setup("Day of Judgment", "Counterspell", 4, 0).t)).toBe(true);
  });
});
