// AI attack-target choice in a multiplayer game: no seat-order bias (the first opponent in the list used to win every tie, so seat 0 was always attacked).
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { attackTargetScores } from "./kernelAi";


describe("AI attack targeting", () => {
  it("scores lower-life, weaker-defended opponents higher", () => {
    const t = mini(["p1", "p2", "p3"], { phase: "precombat_main" });
    t.give("p3", "Grizzly Bears", "battlefield");
    t.state = { ...t.state, players: t.state.players.map((p) => p.id === "p2" ? { ...p, life: 20 } : p) };
    const s = attackTargetScores(t.state, ctx, "p1");
    expect(s.p2).toBeGreaterThan(s.p3);
  });

  it("exact ties are not always resolved toward the same seat", () => {
    const winners = new Set<string>();
    for (let turn = 1; turn <= 12; turn++) {
      const t = mini(["p1", "p2", "p3"], { phase: "precombat_main" });
      t.state = { ...t.state, turn: { ...t.state.turn, number: turn } };
      const s = attackTargetScores(t.state, ctx, "p1");
      winners.add(s.p2 > s.p3 ? "p2" : "p3");
    }
    expect(winners.size).toBe(2);
  });

  it("the same opponents get attacked whichever seat they sit in (seat 0 is not favoured)", () => {
    let atSeat0 = 0, atOther = 0;
    for (let turn = 1; turn <= 20; turn++) {
      const t = mini(["p1", "p2", "p3", "p4"], { phase: "precombat_main" });
      t.state = { ...t.state, turn: { ...t.state.turn, number: turn } };
      const sc = attackTargetScores(t.state, ctx, "p4");
      const best = ["p1", "p2", "p3"].sort((a, b) => sc[b] - sc[a])[0];
      if (best === "p1") atSeat0++; else atOther++;
    }
    expect(atSeat0).toBeLessThan(20);
    expect(atOther).toBeGreaterThan(0);
  });
});
