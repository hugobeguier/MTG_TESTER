// Kernel mode, paying by hand: the banner total / suggestion / auto-pay for a MIRACLE cast must be the miracle cost the engine charges (Aminatou, Veil Piercer's
// reduced cost, printed miracle costs), and for the other cost-changing paths (tax, reductions, X).
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { KernelGameController } from "./kernelController";

function game(cardInLib: string, handLands: string[], extra: (t: ReturnType<typeof mini>) => void = () => undefined) {
  const t = mini(["p1", "p2"], { phase: "precombat_main" });
  for (let i = 0; i < 4; i++) { t.give("p1", "Island", "library"); t.give("p2", "Island", "library"); }
  extra(t);
  const card = t.give("p1", cardInLib, "library", { top: true });
  const lands = handLands.map((n) => t.give("p1", n, "battlefield"));
  const bs = t.give("p1", "Brainstorm", "hand");
  const ks = KernelSession.fromState(t.state, { ctx, display: (() => undefined) as never, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } } as never);
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
  return { ks, c, card, lands, bs };
}

/** cast Brainstorm (paying its {U} by hand), resolve it, answer the miracle offer yes: the payment banner for the miracle cast is open */
function toMiraclePayment(g: ReturnType<typeof game>, brainstormLand: string): void {
  g.c.tapForMana("p1", brainstormLand);
  const r0 = g.ks.dispatch("p1", { type: "castSpell", player: "p1", cardId: g.bs } as never); void r0;
  for (let i = 0; i < 12 && g.ks.state.pending?.kind !== "choose_yes_no" && g.ks.state.pending?.kind !== "pay_mana" && (g.ks.state.stack.length || g.ks.state.pending); i++) {
    const pd = g.ks.state.pending;
    if (pd) g.c.answer(pd.id, { ids: pd.options.filter((o) => o.id !== g.card && !/Sigil|Temporal/.test(o.label)).slice(0, pd.min).map((o) => o.id) } as never); // Brainstorm's put-back
    else g.ks.dispatch(g.ks.state.priority!, { type: "passPriority", player: g.ks.state.priority!, fastForward: true } as never);
  }
}

describe("miracle payment banner", () => {
  it("Aminatou, Veil Piercer: banner total, suggestion and auto-pay use the reduced miracle cost", () => {
    const g = game("Sigil of the Empty Throne", ["Island", "Plains", "Plains", "Plains", "Plains", "Plains"], (t) => { t.give("p1", "Aminatou, Veil Piercer", "battlefield"); });
    toMiraclePayment(g, g.lands[0]);
    expect(g.ks.state.pending?.kind).toBe("choose_yes_no");
    g.c.answer(g.ks.state.pending!.id, { yes: true });
    const p = g.ks.state.pending!;
    expect(p.kind).toBe("pay_mana");
    const total = p.pay!.cost;
    const pick = g.c.boardPick()!;
    expect(pick.instruction).toContain(`Total ${total}`);
    pick.onConfirm();
    const sug = g.c.boardPick()!.selectedCardIds;
    // the suggestion covers exactly the engine's due cost (mana value of the due cost), no more
    const n = (total.match(/\{(\d+)\}/g) ?? []).reduce((a, s) => a + Number(s.slice(1, -1)), 0) + (total.match(/\{[WUBRGC]\}/g) ?? []).length;
    expect(sug.length).toBe(n);
    g.c.boardPick()!.onConfirm(); // taps exactly the suggestion; the miracle cast completes
    expect(g.ks.state.pending).toBeNull();
    expect(g.ks.state.objects[g.card].zone).toBe("stack");
    expect(g.lands.filter((l) => g.ks.state.objects[l].tapped)).toHaveLength(1 + n); // Brainstorm's {U} + the miracle cost
  });
  it("Aminatou: mana already floating in the pool is subtracted from the suggestion", () => {
    const g = game("Sigil of the Empty Throne", ["Island", "Plains", "Plains", "Plains", "Plains", "Plains"], (t) => { t.give("p1", "Aminatou, Veil Piercer", "battlefield"); });
    toMiraclePayment(g, g.lands[0]);
    g.c.answer(g.ks.state.pending!.id, { yes: true });
    g.c.boardPick()!.onToggleCard(g.lands[1]); // one {W} by hand
    expect(g.ks.state.pending!.pay).toMatchObject({ cost: "{W}{W}", remaining: "{W}" });
    g.c.boardPick()!.onConfirm();
    expect(g.c.boardPick()!.selectedCardIds).toHaveLength(1);
  });
  it("printed miracle (Temporal Mastery {1}{U}): banner total and suggestion", () => {
    const g = game("Temporal Mastery", ["Island", "Island", "Island", "Island", "Island", "Island", "Island"]);
    toMiraclePayment(g, g.lands[0]);
    g.c.answer(g.ks.state.pending!.id, { yes: true });
    expect(g.ks.state.pending!.kind).toBe("pay_mana");
    expect(g.ks.state.pending!.pay!.cost).toBe("{1}{U}");
    g.c.boardPick()!.onConfirm();
    expect(g.c.boardPick()!.selectedCardIds).toHaveLength(2);
  });
  it("printed miracle: the total stays the miracle cost after a tap", () => {
    const g = game("Temporal Mastery", ["Island", "Island", "Island", "Island", "Island"]);
    toMiraclePayment(g, g.lands[0]);
    g.c.answer(g.ks.state.pending!.id, { yes: true });
    g.c.boardPick()!.onToggleCard(g.lands[1]);
    expect(g.ks.state.pending!.pay).toMatchObject({ cost: "{1}{U}", remaining: "{1}" });
  });
});
