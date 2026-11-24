// The three separate controls of the kernel table: "Pass priority" (passes ONCE), "Pass to next step" (one pass that opens the very next window) and "End turn"
// (hurries through the rest of the human's turn). User report: Pass priority and "next turn" were one button, so a plain pass could end the turn.
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { KernelGameController } from "./kernelController";
import { DEFAULT_STOP_SETTINGS } from "@/lib/priorityStops";
import { payIfAsked } from "./kernelPaymentKit";

function game(o: { hand?: string[]; board?: string[]; aiBoard?: string[] } = {}) {
  const t = mini(["p1", "p2"], { phase: "precombat_main" });
  for (let i = 0; i < 12; i++) { t.give("p1", "Swamp", "library"); t.give("p2", "Swamp", "library"); }
  for (const n of ["Swamp", "Swamp", "Swamp"]) t.give("p1", n, "battlefield");
  for (const n of o.hand ?? []) t.give("p1", n, "hand");
  for (const n of o.board ?? []) t.give("p1", n, "battlefield");
  for (const n of o.aiBoard ?? []) t.give("p2", n, "battlefield");
  const ks = KernelSession.fromState(t.state, { ctx, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } });
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0, stops: DEFAULT_STOP_SETTINGS });
  return { ks, c };
}
const settle = (c: KernelGameController, max = 200): number => { let n = 0; while (n < max && c.needsStep() && c.step()) n++; return n; };
const where = (ks: KernelSession) => `${ks.state.turn.number}:${ks.state.turn.active}:${ks.state.turn.phase}`;

describe("Pass priority passes once", () => {
  it("stack not empty: one pass resolves only the top item (the spell below stays)", () => {
    const { ks, c } = game({ hand: ["Go for the Throat"], aiBoard: ["Undead Augur"], board: ["Gravecrawler"] });
    const hand = (n: string) => ks.state.players[0].hand.find((id) => ks.state.objects[id].cardName === n)!;
    const augur = ks.state.battlefield.find((id) => ks.state.objects[id].cardName === "Undead Augur")!;
    c.playCard("p1", hand("Go for the Throat"));
    const d = c.table().decision; if (d) c.answer(d.id, { ids: [augur] });
    payIfAsked(c);
    expect(ks.state.stack).toHaveLength(1);
    c.passPriority();
    settle(c);
    expect(ks.state.stack).toHaveLength(0);
    expect(where(ks)).toBe("1:p1:precombat_main"); // resolving it did not move the game on or end the turn
    expect(c.needsStep()).toBe(false); // the human is asked again in their own main phase
  });

  it("stack empty on my turn: Pass priority passes once; it never runs through the rest of the turn or the opponent's turn", () => {
    const { ks, c } = game();
    expect(ks.state.stack).toHaveLength(0);
    const before = where(ks);
    c.passPriority();
    settle(c);
    expect(ks.state.turn.number).toBe(1); // still my turn
    expect(where(ks)).not.toBe(before);
    expect(ks.state.turn.active).toBe("p1");
  });
});

describe("Pass to next step: one step per press", () => {
  it("each press moves exactly one step and the window opens again, even where no stop is ticked", () => {
    const { ks, c } = game();
    const seen: string[] = [where(ks)];
    for (let i = 0; i < 3; i++) { c.advanceTurn(); settle(c); seen.push(where(ks)); expect(c.needsStep()).toBe(false); }
    expect(seen[1]).toBe("1:p1:beginning_of_combat");
    expect(new Set(seen).size).toBe(seen.length); // a new step every time
    expect(ks.state.turn.number).toBe(1);
  });
  it("a refused press leaves nothing armed", () => {
    const { ks, c } = game();
    c.passPriority();
    // not the human's priority any more (AI turn pending): the button only logs
    ks.state.priority = "p2";
    c.advanceTurn();
    expect(c.isHoldArmed()).toBe(false);
  });
});

describe("End turn", () => {
  it("hurries through the end step and hands the turn to the opponent, who then plays its own turn under the usual stops", () => {
    const { ks, c } = game();
    c.endTurn();
    expect(ks.state.turn.active).toBe("p2");
    expect(ks.state.turn.number).toBe(2);
    settle(c, 400);
    expect(ks.degraded).toBeUndefined();
    expect(ks.state.turn.number).toBeGreaterThanOrEqual(2);
  });
});

describe("Yield", () => {
  it("yielding until end of turn lets one pass go through the rest of my turn (no stops), then the stops apply again", () => {
    const { ks, c } = game();
    c.toggleYieldIntent();
    expect(c.isYielding()).toBe(true);
    c.passPriority();
    settle(c, 400);
    expect(ks.state.turn.number).toBeGreaterThanOrEqual(1);
    expect(c.isYielding() && ks.state.turn.active === "p1" && ks.state.turn.number === 1 && ks.state.turn.phase === "precombat_main").toBe(false);
  });
});
