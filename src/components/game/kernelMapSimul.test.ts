// Archaeomancer's Map + Myriad Landscape (two lands enter at once): what the stack log and the action log say for EACH trigger.
import { describe, expect, it } from "vitest";
import "@/kernel/engine/resolve";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";

/** answer every decision (yes to yes/no) and pass priority until the stack is empty */
const asked: string[] = [];
function drive(ks: KernelSession, yes = true): void {
  asked.length = 0;
  for (let i = 0; i < 80; i++) {
    const s = ks.state, p = s.pending;
    if (p) {
      asked.push(p.kind);
      const choice = p.numeric ? { number: p.min } : p.kind === "choose_yes_no" ? { yes } : { ids: p.options.slice(0, Math.max(p.min, 1)).map((o) => o.id) };
      const r = ks.dispatch(p.player, { type: "answerDecision", player: p.player, decisionId: p.id, choice });
      if (!r.ok) throw new Error(JSON.stringify(r.error));
    } else if (s.stack.length && s.priority) {
      const r = ks.dispatch(s.priority, { type: "passPriority", player: s.priority });
      if (!r.ok) throw new Error(JSON.stringify(r.error));
    } else break;
  }
}
function game(p1lands: number, hand: string[]) {
  const m = mini();
  m.give("p1", "Archaeomancer's Map", "battlefield");
  for (let i = 0; i < p1lands; i++) m.give("p1", "Plains", "battlefield");
  for (const h of hand) m.give("p1", h, "hand");
  m.give("p2", "Island", "battlefield"); m.give("p2", "Island", "battlefield");
  const land = m.give("p2", "Myriad Landscape", "battlefield");
  for (let i = 0; i < 4; i++) m.give("p2", "Island", "library");
  m.state.turn.active = "p2"; m.state.priority = "p2";
  const ks = KernelSession.fromState(m.state, { ctx });
  const r = ks.dispatch("p2", { type: "activateAbility", player: "p2", sourceId: land, abilityId: "a3", autoPay: true } as never);
  expect(r.ok, JSON.stringify(r.error)).toBe(true);
  return ks;
}
const lines = (ks: KernelSession, viewer = "p1"): string[] => ks.stackLog(viewer).groups.flatMap((g) => g.lines.map((l) => l.text));
const resolutions = (ks: KernelSession): string[] => { const t = lines(ks); return t.slice(Math.max(0, t.findIndex((x) => x.startsWith("Resolving 1. Archaeomancer")))); };
const actionLog = (ks: KernelSession): string[] => ks.log("p1").map((l) => l.message);

describe("Archaeomancer's Map with Myriad Landscape: two lands enter at once", () => {
  it("both lands count when the triggers are checked: two triggers; the second is removed after the first resolves, and the log says so", () => {
    const ks = game(3, ["Forest", "Forest"]);
    drive(ks);
    const t = lines(ks);
    expect(t.filter((x) => x.startsWith("2 triggers put on the stack"))).toHaveLength(1);
    const tail = resolutions(ks);
    expect(tail[1]).toBe("Forest enters the battlefield.");
    expect(tail[tail.length - 1]).toBe("Archaeomancer's Map (because Island entered the battlefield): condition no longer true on resolution (p2 controls 4 lands, p1 controls 4 lands): no effect.");
    expect(actionLog(ks).some((x) => x.includes("condition no longer true on resolution (p2 controls 4 lands"))).toBe(true);
    expect(ks.state.stack).toHaveLength(0);
  });

  it("you control 2 lands: after the first land you put down the condition is still true, so both resolve", () => {
    const ks = game(2, ["Forest", "Forest"]);
    drive(ks);
    expect(resolutions(ks).filter((x) => x === "Forest enters the battlefield.")).toHaveLength(2);
    expect(lines(ks).some((x) => x.includes("condition no longer true"))).toBe(false);
  });

  it("you control 4 lands: the condition is false when the lands enter, so nothing triggers and nothing is logged", () => {
    const ks = game(4, ["Forest"]);
    drive(ks);
    expect(lines(ks).some((x) => /Archaeomancer|trigger/i.test(x))).toBe(false);
    expect(actionLog(ks).some((x) => /Archaeomancer|condition/i.test(x))).toBe(false);
  });

  it("no land card in hand: no question, and the log says nothing happens", () => {
    const ks = game(3, []);
    drive(ks);
    expect(asked).not.toContain("choose_yes_no");
    expect(lines(ks)).toContain("p1 has no card in their hand to choose: nothing happens.");
  });

  it("declining the 'you may' is logged", () => {
    const ks = game(3, ["Forest"]);
    drive(ks, false);
    expect(lines(ks)).toContain("p1 chooses not to (Archaeomancer's Map): nothing happens.");
  });
});
