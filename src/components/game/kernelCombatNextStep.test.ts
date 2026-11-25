// Regression: from the human's combat the "next step" control must reach the postcombat main phase (never jump straight to the end step); only "End turn" skips it.
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { buildPack } from "@/kernel/integration/nodePack";
import { packKit } from "@/kernel/integration/cardPack";
import { KernelGameController } from "./kernelController";

const pack = JSON.parse(JSON.stringify(buildPack("wretched-ranks", { catalog: false })));
const kit = packKit([pack]);

function setup(withAttacker: boolean) {
  const t = mini(["p1", "p2"], { phase: "precombat_main" });
  for (let i = 0; i < 8; i++) { t.give("p1", "Swamp", "library"); t.give("p2", "Swamp", "library"); }
  t.give("p1", "Swamp", "battlefield");
  if (withAttacker) t.give("p1", "Gravecrawler", "battlefield");
  const ks = KernelSession.fromState(t.state, { ctx, display: kit.display, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } });
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
  return { ks, c };
}
function settle(c: KernelGameController, max = 60): void { for (let n = 0; n < max && c.needsStep() && c.step(); n++); }
const phases = (c: KernelGameController, presses: number, trace: string[] = []): string[] => {
  for (let i = 0; i < presses; i++) {
    c.advanceTurn(); settle(c); trace.push(c.ks.state.turn.phase);
    if (c.ks.state.turn.active !== "p1") break;
  }
  return trace;
};

describe("combat -> postcombat main", () => {
  it("no possible attackers: Pass to next step walks combat and lands in main 2 with the human holding priority", () => {
    const { ks, c } = setup(false);
    const trace = phases(c, 4);
    console.log("no attackers trace", trace);
    expect(trace).toContain("postcombat_main");
    expect(trace.indexOf("postcombat_main")).toBeLessThan(trace.indexOf("end_step") === -1 ? 99 : trace.indexOf("end_step"));
    void ks;
  });
  it("human declares zero attackers explicitly: next press is main 2", () => {
    const { ks, c } = setup(true);
    const trace: string[] = [];
    for (let i = 0; i < 6 && !c.declaration(); i++) { c.advanceTurn(); settle(c); trace.push(ks.state.turn.phase); }
    expect(c.declaration()?.kind).toBe("attackers");
    expect(c.noAttack()).toBe(true);
    settle(c); trace.push(ks.state.turn.phase);
    console.log("zero attackers trace", trace, ks.state.priority);
    expect(ks.state.turn.phase).toBe("postcombat_main");
    expect(ks.state.priority).toBe("p1");
  });
  it("declaring attackers: the table reports the human as the declarer (enables Pass to next step) and the control sends no attack, then main 2", () => {
    const { ks, c } = setup(true);
    for (let i = 0; i < 6 && !c.declaration(); i++) { c.advanceTurn(); settle(c); }
    expect(ks.state.priority).toBeNull(); // nobody holds priority during a declaration: the table must not rely on prioritySeatId
    expect(c.table().prioritySeatId).toBeUndefined();
    expect(c.table().declaring).toMatchObject({ kind: "attackers", players: ["p1"] });
    c.advanceTurn(); settle(c);
    expect(ks.state.turn.phase).toBe("postcombat_main");
    expect(ks.state.priority).toBe("p1");
  });
  it("attackers declared: combat steps run, then main 2", () => {
    const { ks, c } = setup(true);
    for (let i = 0; i < 6 && !c.declaration(); i++) { c.advanceTurn(); settle(c); }
    c.attackWithAll(); c.advanceTurn(); settle(c);
    for (let i = 0; i < 8 && ks.state.turn.phase !== "postcombat_main" && ks.state.turn.active === "p1"; i++) { if (c.declaration()) c.passBlocks(); else c.advanceTurn(); settle(c); }
    expect(ks.state.turn.phase).toBe("postcombat_main");
    expect(ks.state.turn.active).toBe("p1");
  });
  it("the AI reaches its postcombat main", () => {
    const { ks, c } = setup(true);
    const seen = new Set<string>();
    c.endTurn();
    for (let i = 0; i < 600 && ks.state.turn.number < 3; i++) {
      if (c.declaration()) c.noAttack();
      if (c.needsStep()) c.step(); else if (ks.state.turn.active === "p1") c.endTurn(); else break;
      if (ks.state.turn.active === "p2") seen.add(ks.state.turn.phase);
    }
    expect(seen.has("postcombat_main")).toBe(true);
  });
  it("End turn still jumps past main 2", () => {
    const { ks, c } = setup(false);
    c.endTurn();
    expect(ks.state.turn.phase === "postcombat_main" && ks.state.turn.active === "p1").toBe(false);
  });
});
