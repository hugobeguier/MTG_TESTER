// Kernel mode: free-cast permissions (Omniscience) through the controller path the human uses (the hand card's cast button), and the AI.
// The user's bug: Omniscience out, casting Timely Ward in the post-combat main phase still opened the "Pay {cost}" banner.
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { planMain } from "@/kernel/ai/plan";
import { KernelGameController } from "./kernelController";

function game(opts: { phase?: string; hand: string[]; board?: string[]; lands?: string[]; p2board?: string[] }) {
  const t = mini(["p1", "p2"], { phase: (opts.phase ?? "postcombat_main") as never });
  for (let i = 0; i < 4; i++) { t.give("p1", "Island", "library"); t.give("p2", "Island", "library"); }
  for (const n of opts.board ?? []) t.give("p1", n, "battlefield");
  for (const n of opts.p2board ?? []) t.give("p2", n, "battlefield");
  for (const n of opts.lands ?? ["Plains", "Plains", "Plains", "Island", "Island", "Island", "Swamp", "Swamp"]) t.give("p1", n, "battlefield");
  const hand = opts.hand.map((n) => t.give("p1", n, "hand"));
  const ks = KernelSession.fromState(t.state, { ctx, display: (() => undefined) as never, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } } as never);
  ks.state.config.manualPay = ["p1"];
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
  return { ks, c, hand };
}
const answerFirst = (ks: KernelSession, c: KernelGameController) => { const p = ks.state.pending as never as { id: string; options: Array<{ id: string }> }; c.answer(p.id, { ids: [p.options[0].id] }); };

describe("Omniscience: the cast button defaults to the free way", () => {
  for (const phase of ["precombat_main", "postcombat_main"]) {
    for (const name of ["Timely Ward", "Esper Sentinel", "Blasphemous Edict", "Swords to Plowshares"]) {
      it(`${name} (${phase}): no pay banner, nothing tapped`, () => {
        const { ks, c, hand } = game({ phase, hand: [name], board: ["Omniscience"], p2board: ["Ledger Shredder"] });
        c.playCard("p1", hand[0]);
        while (ks.state.pending?.kind === "choose_targets") answerFirst(ks, c);
        expect(ks.state.pending?.kind).not.toBe("pay_mana");
        expect(c.paying()).toBe(false);
        expect(ks.state.stack).toHaveLength(1);
        expect(ks.state.battlefield.filter((id) => ks.state.objects[id].tapped)).toEqual([]);
      });
    }
  }
  it("the card's actions list both ways; 'Pay its mana cost' still asks for the cost", () => {
    const { ks, c, hand } = game({ hand: ["Timely Ward"], board: ["Omniscience"], p2board: ["Ledger Shredder"] });
    const acts = c.cardActions(hand[0]);
    expect(acts.map((a) => a.label)).toContain("Cast Timely Ward without paying its mana cost (Omniscience)");
    const paid = ks.legal("p1").find((a) => a.kind === "castSpell" && a.objectId === hand[0] && !a.free)!;
    ks.dispatch("p1", paid.action!);
    while (ks.state.pending?.kind === "choose_targets") answerFirst(ks, c);
    expect(ks.state.pending?.kind).toBe("pay_mana"); // paying normally by choice: the full cost is asked
    expect(c.paying()).toBe(true);
  });
});

describe("the AI uses a free cast when it has the permission", () => {
  it("planMain never picks the paid way of a card that has a free way", () => {
    const { ks } = game({ hand: ["Esper Sentinel"], board: ["Omniscience"] });
    ks.state.priority = "p1";
    const acts = ks.legal("p1");
    expect(acts.some((a) => a.kind === "castSpell" && a.free)).toBe(true);
    const plan = planMain(acts, ks.state, ctx, "p1", new Set(), {});
    expect(plan?.id).toContain("free-hand:");
  });
});
