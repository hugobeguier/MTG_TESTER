// Kernel mode: Zur, Eternal Schemer's "{1}{W}: Target non-Aura enchantment you control becomes a creature..." through the controller path the human uses
// (the inspector's ability button, the target dialog / board pick, the manual payment banner).
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { chars } from "@/kernel/engine/core";
import { KernelGameController } from "./kernelController";

const charsOf = (ks: KernelSession, id: string) => chars({ s: structuredClone(ks.state), events: [], defs: ctx.cards, scanned: 0 } as never, id);
function game(n: number) {
  const ids = Array.from({ length: n }, (_, i) => `p${i + 1}`);
  const t = mini(ids, { phase: "precombat_main" });
  for (let i = 0; i < 4; i++) for (const p of ids) t.give(p, "Island", "library");
  const zur = t.give("p1", "Zur, Eternal Schemer", "battlefield");
  const ench = t.give("p1", "Sigil of the Empty Throne", "battlefield");
  const theirs = t.give("p2", "Sigil of the Empty Throne", "battlefield");
  const lands = [t.give("p1", "Plains", "battlefield"), t.give("p1", "Plains", "battlefield")];
  const ks = KernelSession.fromState(t.state, { ctx, display: (() => undefined) as never, seats: { p1: { kind: "human" }, ...Object.fromEntries(ids.slice(1).map((p) => [p, { kind: "agent" }])) } } as never);
  ks.state.config.manualPay = ["p1"];
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
  return { ks, c, zur, ench, theirs, lands };
}
describe("Zur, Eternal Schemer through the controller", () => {
  for (const n of [2, 4]) it(`${n} players: the card detail lists the ability; target, pay by hand, resolve`, () => {
    const { ks, c, zur, ench, theirs, lands } = game(n);
    expect(c.cardActions(zur).map((a) => a.label).join("|")).toContain("becomes a creature");
    c.activateAbility("p1", zur, 0);
    const pend = ks.state.pending as never as { kind: string; options: Array<{ id: string }>; id: string };
    expect(pend.kind).toBe("choose_targets");
    expect(pend.options.map((o) => o.id)).toEqual([ench]); // not the opponent's enchantment
    c.answer(pend.id, { ids: [ench] });
    expect(ks.state.pending?.kind).toBe("pay_mana");
    const pick = c.boardPick()!;
    for (const l of lands) pick.onToggleCard(l);
    expect(ks.state.pending).toBeNull();
    expect(ks.state.stack).toHaveLength(1);
    for (let i = 0; i < 10 && ks.state.stack.length && !ks.state.pending; i++) ks.dispatch(ks.state.priority!, { type: "passPriority", player: ks.state.priority!, fastForward: true } as never);
    const ch = charsOf(ks, ench);
    expect(ch.types).toEqual(expect.arrayContaining(["enchantment", "creature"]));
    expect([ch.power, ch.toughness]).toEqual([5, 5]);
    expect(charsOf(ks, theirs).types).not.toContain("creature");
    const shown = c.table().session.seats[0].board.battlefield.find((x: { id: string }) => x.id === ench) as { typeLine: string; power?: string; toughness?: string } | undefined; // what the board draws
    expect(shown?.typeLine).toContain("Creature");
    expect([shown?.power, shown?.toughness]).toEqual(["5", "5"]);
  });
});
