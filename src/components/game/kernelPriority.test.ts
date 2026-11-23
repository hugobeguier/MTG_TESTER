// Phase 6: the human's priority windows on the kernel (stops, yield, full control, stop next), responding to an AI spell, the AI's counterspell response,
// and loop guards. All headless on real cards (Go for the Throat, Undead Augur, Counterspell ...).
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import type { PlayerId } from "@/kernel/engine/types";
import { KernelGameController, MAX_AUTO_ACTIONS_PER_TURN } from "./kernelController";
import { DEFAULT_STOP_SETTINGS } from "@/lib/priorityStops";

function settle(c: KernelGameController, max = 200): number {
  let n = 0;
  while (n < max && c.needsStep() && c.step()) n++;
  return n;
}

interface Setup { phase?: "upkeep" | "precombat_main"; active?: PlayerId; humanHand?: string[]; aiHand?: string[]; humanBoard?: string[]; aiBoard?: string[]; humanLands?: string[]; aiLands?: string[] }
function game(o: Setup = {}) {
  const t = mini(["p1", "p2"], { phase: o.phase ?? "precombat_main" });
  for (let i = 0; i < 10; i++) { t.give("p1", "Swamp", "library"); t.give("p2", "Swamp", "library"); }
  for (const n of o.humanLands ?? ["Swamp", "Swamp", "Swamp"]) t.give("p1", n, "battlefield");
  for (const n of o.aiLands ?? ["Swamp", "Swamp", "Swamp"]) t.give("p2", n, "battlefield");
  for (const n of o.humanHand ?? []) t.give("p1", n, "hand");
  for (const n of o.aiHand ?? []) t.give("p2", n, "hand");
  for (const n of o.humanBoard ?? []) t.give("p1", n, "battlefield");
  for (const n of o.aiBoard ?? []) t.give("p2", n, "battlefield");
  if (o.active === "p2") t.state = { ...t.state, turn: { ...t.state.turn, active: "p2", number: 2 }, priority: "p2", passes: [] };
  const ks = KernelSession.fromState(t.state, { ctx, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } });
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0, stops: DEFAULT_STOP_SETTINGS });
  const inHand = (who: 0 | 1, name: string) => ks.state.players[who].hand.find((id) => ks.state.objects[id].cardName === name)!;
  return { ks, c, inHand };
}

/** the AI (p2) casts a 3-mana creature on its turn; the human holds an instant */
const aiCastsCreature = (extra: Setup = {}) => game({ active: "p2", aiHand: ["Undead Augur"], humanHand: ["Go for the Throat"], humanBoard: ["Gravecrawler"], ...extra });

describe("human priority windows on an opponent's turn", () => {
  it("the human stops after the AI casts a spell, sees it on the stack, responds with an instant, then passes", () => {
    const { ks, c, inHand } = aiCastsCreature();
    // drive the AI until it has cast and the human is asked
    let n = 0;
    while (n++ < 40 && c.needsStep() && !ks.state.stack.length) c.step();
    while (n++ < 40 && c.needsStep()) c.step();
    expect(ks.state.stack).toHaveLength(1);
    expect(ks.state.priority).toBe("p1");
    expect(c.needsStep()).toBe(false); // waiting for the human
    expect(c.stopReason()).toBe("stack_response");
    expect(c.table().pendingAction).toBeTruthy();
    const opts = c.options();
    const gftt = opts.find((a) => a.kind === "castSpell" && a.objectId === inHand(0, "Go for the Throat"));
    expect(gftt).toBeTruthy();
    expect(c.playableCardIds().has(inHand(0, "Go for the Throat"))).toBe(true);
    // respond: kill nothing yet (the creature is still a spell) -> the instant has no target, so the kernel lists no cast; pass instead
    c.passPriority();
    settle(c);
    expect(ks.state.stack).toHaveLength(0);
    expect(ks.state.battlefield.some((id) => ks.state.objects[id].cardName === "Undead Augur")).toBe(true);
  });

  it("responds to an AI removal spell that targets the human (stops even with nothing to respond with), and the response resolves first", () => {
    const { ks, c, inHand } = game({ active: "p2", aiHand: ["Go for the Throat"], aiBoard: ["Undead Augur"], humanHand: ["Go for the Throat"], humanBoard: ["Gravecrawler"] });
    let n = 0;
    while (n++ < 60 && c.needsStep()) c.step();
    expect(ks.state.stack).toHaveLength(1);
    expect(c.stopReason()).toBe("targeted_me");
    // respond: kill the AI's creature with our own instant
    const cast = c.options().find((a) => a.kind === "castSpell" && a.objectId === inHand(0, "Go for the Throat"))!;
    expect(cast).toBeTruthy();
    expect(c.doOption(cast.id)).toBe(true);
    const d = c.table().decision!;
    expect(d.kind).toBe("choose_targets");
    const augur = ks.state.battlefield.find((id) => ks.state.objects[id].cardName === "Undead Augur")!;
    expect(c.answer(d.id, { ids: [augur] })).toBe(true);
    expect(ks.state.stack).toHaveLength(2);
    // our spell is on top: resolve everything (we stop again on the new stack item only if the window rules say so; pass until empty)
    for (let i = 0; i < 12 && ks.state.stack.length; i++) { if (c.needsStep()) c.step(); else c.passPriority(); }
    expect(ks.state.players[1].graveyard.some((id) => ks.state.objects[id].cardName === "Undead Augur")).toBe(true);
    expect(ks.state.players[0].graveyard.some((id) => ks.state.objects[id].cardName === "Gravecrawler")).toBe(true);
    expect(ks.degraded).toBeUndefined();
  });

  it("with no instant in hand the human is not asked about an opponent's creature spell (auto-pass), but is on their own turn mains", () => {
    const { ks, c } = game({ active: "p2", aiHand: ["Undead Augur"], humanHand: [], humanBoard: ["Gravecrawler"] });
    let n = 0;
    while (n++ < 120 && c.needsStep()) c.step();
    expect(ks.state.battlefield.some((id) => ks.state.objects[id].cardName === "Undead Augur")).toBe(true);
    // the turn went on to the human's turn and stopped at their precombat main (a default stop)
    expect(ks.state.turn.active).toBe("p1");
    expect(c.stopReason()).toBe("own_turn");
  });

  it("is never asked on an opponent's step without a response, even with Full Control; with a response Full Control opens every step", () => {
    const a = game({ phase: "upkeep", active: "p2", humanHand: [] });
    a.c.toggleFullControl();
    expect(a.c.stopReason()).toBeUndefined();
    expect(a.c.needsStep()).toBe(true);
    const b = game({ phase: "upkeep", active: "p2", humanHand: ["Go for the Throat"], aiBoard: ["Undead Augur"] });
    // default: the upkeep is not a stop on the AI's turn -> auto pass
    let n = 0;
    while (n++ < 5 && b.c.needsStep() && b.ks.state.turn.phase === "upkeep") b.c.step();
    expect(b.ks.state.turn.phase).not.toBe("upkeep");
    const c2 = game({ phase: "upkeep", active: "p2", humanHand: ["Go for the Throat"], aiBoard: ["Undead Augur"] });
    c2.c.toggleFullControl();
    settle(c2.c, 5);
    // the AI (active) acts first in its upkeep; the human gets a window as soon as it has priority
    expect(c2.c.stopReason()).toBe("full_control");
    expect(c2.c.needsStep()).toBe(false);
    c2.c.passPriority();
    settle(c2.c, 8);
    expect(c2.c.stopReason()).toBe("full_control"); // the next step opens too
  });
});

describe("yield, full control, stop next, settings", () => {
  it("Yield to end of turn passes a stack-response window, and ends when the turn changes, with a log note", () => {
    const { ks, c } = aiCastsCreature();
    let n = 0;
    while (n++ < 40 && c.needsStep() && !(ks.state.stack.length && ks.state.priority === "p1")) c.step();
    expect(c.stopReason()).toBe("stack_response");
    c.toggleYieldIntent();
    expect(c.isYielding()).toBe(true);
    expect(c.stopReason()).toBeUndefined();
    expect(c.needsStep()).toBe(true);
    settle(c, 300);
    // yield held through the AI's turn until its end step, then ended
    expect(c.isYielding()).toBe(false);
    expect(c.table().session.events.some((e) => /Yield ended/.test(e.message))).toBe(true);
    expect(ks.degraded).toBeUndefined();
  });

  it("a spell that targets the human cancels a yield", () => {
    const { ks, c } = game({ active: "p2", aiHand: ["Go for the Throat"], humanBoard: ["Gravecrawler"], humanHand: [] });
    c.toggleYieldIntent();
    let n = 0;
    while (n++ < 60 && c.needsStep()) c.step();
    expect(ks.state.stack).toHaveLength(1);
    expect(c.stopReason()).toBe("targeted_me");
    expect(c.isYielding()).toBe(false);
  });

  it("Full Control on the human's own turn opens every step; off, the upkeep is skipped", () => {
    const off = game({ phase: "upkeep" });
    expect(off.c.needsStep()).toBe(true);
    const on = game({ phase: "upkeep" });
    on.c.toggleFullControl();
    expect(on.c.needsStep()).toBe(false);
    expect(on.c.stopReason()).toBe("full_control");
    on.c.passPriority();
    settle(on.c, 6);
    expect(on.c.stopReason()).toBe("full_control");
    expect(on.ks.state.turn.phase).not.toBe("upkeep");
    on.c.toggleFullControl();
    expect(on.c.stops().fullControl).toBe(false);
  });

  it("Stop Next opens the very next window even where nothing is ticked, then goes away", () => {
    const { ks, c } = game({ phase: "upkeep" });
    expect(c.needsStep()).toBe(true); // upkeep: auto
    c.stopNext();
    expect(c.isHoldArmed()).toBe(true);
    expect(c.needsStep()).toBe(true); // armed now; the window that is open already does not count
    c.step();
    expect(ks.state.turn.phase).toBe("draw");
    expect(c.stopReason()).toBe("hold_once");
    expect(c.needsStep()).toBe(false);
    c.passPriority(); // acting consumes it
    expect(c.isHoldArmed()).toBe(false);
    settle(c, 5);
    expect(c.stopReason() === "hold_once").toBe(false);
  });

  it("the default stops are the legacy defaults and the toggles change and save them", () => {
    const saved: unknown[] = [];
    const t = game();
    const c = new KernelGameController(t.ks, { human: "p1", pace: () => 0, saveStops: (s) => saved.push(s) });
    expect(c.stops().phaseStops).toEqual(DEFAULT_STOP_SETTINGS.phaseStops);
    c.togglePhaseStop("upkeep step", 0);
    expect(c.stops().phaseStops["0:upkeep step"]).toBe(true);
    c.togglePhaseStop("upkeep step", 0);
    expect(c.stops().phaseStops["0:upkeep step"]).toBeUndefined();
    c.toggleStopOnTargeted();
    expect(c.stops().stopOnTargeted).toBe(false);
    expect(saved).toHaveLength(3);
    const props = c.tableProps() as Record<string, unknown>;
    expect(props.onToggleFullControl).toBe(c.toggleFullControl);
    expect(props.onToggleYield).toBe(c.toggleYieldIntent);
  });

  it("a ticked step on an opponent's turn stops the human only when they have a response", () => {
    const a = game({ phase: "upkeep", active: "p2", humanHand: ["Go for the Throat"], aiBoard: ["Undead Augur"] });
    a.c.togglePhaseStop("upkeep step", 1);
    settle(a.c, 5);
    expect(a.c.stopReason()).toBe("phase_stop");
    const b = game({ phase: "upkeep", active: "p2", humanHand: [] });
    b.c.togglePhaseStop("upkeep step", 1);
    settle(b.c, 3);
    expect(b.c.stopReason()).toBeUndefined();
  });
});

describe("default stops on an opponent's turn", () => {
  it("the human holding an instant is stopped at the opponent's end step (a default stop), and the AI is not skipping the window", () => {
    const { ks, c } = game({ active: "p2", humanHand: ["Go for the Throat"], aiBoard: ["Undead Augur"] });
    let n = 0;
    while (n++ < 300) {
      if (c.needsStep()) c.step();
      else if (c.declaration()) c.passBlocks();
      else if (ks.state.turn.phase !== "end_step" && c.stopReason()) c.passPriority();
      else break;
    }
    expect(ks.state.turn.active).toBe("p2");
    expect(c.stopReason()).toBe("phase_stop");
    expect(ks.state.turn.phase).toBe("end_step");
    c.passPriority();
    settle(c, 200);
    expect(ks.state.turn.active).toBe("p1");
  });
});

describe("AI responses", () => {
  it("the AI counters the human's spell with a counterspell it can pay for, once", () => {
    const { ks, c, inHand } = game({ humanHand: ["Undead Augur"], aiHand: ["Counterspell"], aiLands: ["Island", "Island"] });
    // Counterspell costs UU: the AI has two Islands
    c.playCard("p1", inHand(0, "Undead Augur"));
    expect(ks.state.stack).toHaveLength(1);
    // the human auto-passes (nothing to respond with), the AI answers
    settle(c, 20);
    expect(ks.state.players[1].graveyard.some((id) => ks.state.objects[id].cardName === "Counterspell")).toBe(true);
    expect(ks.state.players[0].graveyard.some((id) => ks.state.objects[id].cardName === "Undead Augur")).toBe(true);
    expect(ks.state.battlefield.some((id) => ks.state.objects[id].cardName === "Undead Augur")).toBe(false);
    expect(ks.degraded).toBeUndefined();
  });

  it("the AI without the mana (or without a counterspell) just passes and the spell resolves", () => {
    const { ks, c, inHand } = game({ humanHand: ["Undead Augur"], aiHand: ["Counterspell"], aiLands: ["Island"] });
    c.playCard("p1", inHand(0, "Undead Augur"));
    settle(c, 20);
    expect(ks.state.battlefield.some((id) => ks.state.objects[id].cardName === "Undead Augur")).toBe(true);
  });
});

describe("loop guards", () => {
  it("a whole scripted game with no human response completes turns without a stall, bounded per turn", () => {
    const { ks, c } = game({ phase: "upkeep", humanHand: [], aiHand: [], humanBoard: ["Gravecrawler"] });
    const start = ks.state.turn.number;
    let total = 0;
    for (let i = 0; i < 60 && ks.state.turn.number < start + 3; i++) {
      if (c.declaration()) c.noAttack();
      total += settle(c, MAX_AUTO_ACTIONS_PER_TURN * 2);
      if (ks.state.turn.number >= start + 3) break;
      if (c.needsStep() === false && !ks.state.gameOver) {
        if (ks.state.turn.active === "p1" && !ks.state.pending) c.endTurn(); else c.passPriority();
      }
    }
    expect(ks.state.turn.number).toBeGreaterThanOrEqual(start + 3);
    expect(total).toBeLessThan(MAX_AUTO_ACTIONS_PER_TURN * 8);
    expect(c.table().session.events.some((e) => /kernel game is waiting/i.test(e.message))).toBe(false);
    expect(ks.degraded).toBeUndefined();
  });

  it("a stale option id and a stale decision answer are quiet no-ops", () => {
    const { ks, c } = game();
    const v = ks.version;
    expect(c.doOption("castSpell:#nope")).toBe(false);
    expect(c.answer("d-old", { ids: [] })).toBe(false);
    expect(ks.version).toBe(v);
  });
});
