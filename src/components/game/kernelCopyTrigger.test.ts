// Extravagant Replication end to end through the REAL controller (KernelGameController over a KernelSession with the Aminatou pack's display data):
// the upkeep trigger's stack-log text, the target prompt, the stack panel entry, the "enchant which player" question of an Aura copy, the resulting log
// line ("p1 creates a token copy of X") and no "No visible effect" / unresolved anywhere. The human is p1, the AI p2.
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { buildPack } from "@/kernel/integration/nodePack";
import { packKit } from "@/kernel/integration/cardPack";
import { KernelGameController } from "./kernelController";

const pack = JSON.parse(JSON.stringify(buildPack("aminatou", { catalog: false })));
const kit = packKit([pack]);

function game(board: string[], p2Board: string[] = ["Esper Sentinel"]) {
  const t = mini(["p1", "p2"], { phase: "precombat_main" });
  for (let i = 0; i < 12; i++) { t.give("p1", i % 2 ? "Island" : "Swamp", "library"); t.give("p2", "Swamp", "library"); }
  t.give("p1", "Extravagant Replication", "battlefield");
  t.give("p1", "Plains", "battlefield"); t.give("p1", "Island", "battlefield");
  const ids = board.map((n) => t.give("p1", n, "battlefield"));
  for (const n of p2Board) t.give("p2", n, "battlefield");
  t.state = { ...t.state, turn: { ...t.state.turn, active: "p2", phase: "end_step", number: 2 }, priority: "p2", passes: [] };
  const ks = KernelSession.fromState(t.state, { ctx, display: kit.display, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } });
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
  return { t, ks, c, ids };
}
const settle = (c: KernelGameController, max = 200): void => { for (let n = 0; n < max && c.needsStep() && c.step(); n++); };
const texts = (ks: KernelSession): string[] => ks.stackLog("p1").groups.flatMap((g) => g.lines.map((l) => l.text));

/** run until the human's first decision (the Extravagant Replication target) */
function toTargetPrompt(c: KernelGameController, ks: KernelSession) {
  for (let i = 0; i < 40; i++) {
    settle(c);
    const d = c.table().decision;
    if (d) return d;
    if (ks.state.priority === "p1" && !ks.state.pending) { c.passPriority(); continue; }
    if (!c.needsStep()) break;
  }
  return c.table().decision;
}

describe("Extravagant Replication through the real controller", () => {
  it("asks for 'another target nonland permanent you control', shows the trigger on the stack, and logs the copy", () => {
    const { ks, c, ids } = game(["Sol Ring", "Ledger Shredder"]);
    const d = toTargetPrompt(c, ks)!;
    expect(d, "no decision reached the human").toBeTruthy();
    expect(d.title).toBe("Extravagant Replication: choose a target");
    expect(d.instruction).toBe("Choose another target nonland permanent you control.");
    expect(d.options.map((o) => o.label).sort()).toEqual(["Ledger Shredder", "Sol Ring"]); // not itself, not lands, not the opponent's creature
    expect(c.answer(d.id, { ids: [ids[0]] })).toBe(true);
    // the trigger is on the stack (the stack panel entry) while the human holds priority
    const view = c.table();
    expect([view.pendingAction, ...view.stackActions].some((a) => /Extravagant Replication/.test(JSON.stringify(a)) && /Sol Ring/.test(JSON.stringify(a)))).toBe(true);
    for (let i = 0; i < 6 && ks.state.stack.length; i++) { settle(c); if (ks.state.priority === "p1" && !ks.state.pending) c.passPriority(); }
    const copies = ks.state.battlefield.filter((id) => ks.state.objects[id].token && ks.state.objects[id].controller === "p1" && ks.state.objects[id].cardName.length);
    expect(copies.length).toBeGreaterThan(0);
    const log = texts(ks);
    expect(log.some((t) => /Extravagant Replication: At the beginning of your upkeep.*targeting Sol Ring/.test(t)), log.join("\n")).toBe(true);
    expect(log.some((t) => /^Resolving .*Extravagant Replication/.test(t))).toBe(true);
    expect(log.some((t) => /p1 creates a token copy of Sol Ring/i.test(t) || /creates a token copy of Sol Ring/i.test(t)), log.join("\n")).toBe(true);
    expect(log.filter((t) => t.includes("No visible effect")), log.join("\n")).toEqual([]);
    expect(ks.state.battlefield.filter((id) => ks.state.objects[id].token)).toHaveLength(1);
    // the copy is a real, working Sol Ring
    const sol = ks.state.battlefield.find((id) => ks.state.objects[id].token)!;
    expect(ks.state.objects[sol].controller).toBe("p1");
  });

  it("copying Overwhelming Splendor (enchanting p2): the human is asked which player the copy enchants, and the copy's effects follow the answer", () => {
    const { t, ks, c, ids } = game(["Overwhelming Splendor", "Ledger Shredder"]);
    ks.state.objects[ids[0]].attachedPlayer = "p2";
    void t;
    const d = toTargetPrompt(c, ks)!;
    expect(d.options.map((o) => o.label).sort()).toEqual(["Ledger Shredder", "Overwhelming Splendor"]);
    expect(c.answer(d.id, { ids: [ids[0]] })).toBe(true);
    for (let i = 0; i < 10 && !c.table().decision && ks.state.stack.length; i++) { settle(c); if (ks.state.priority === "p1" && !ks.state.pending && !c.table().decision) c.passPriority(); }
    const q = c.table().decision!;
    expect(q, texts(ks).join("\n")).toBeTruthy();
    expect(q.title).toBe("Overwhelming Splendor: what does it enchant?");
    expect(q.options.map((o) => o.label)).toEqual(["p1", "p2"]);
    expect(c.answer(q.id, { ids: ["p1"] })).toBe(true);
    for (let i = 0; i < 10 && ks.state.stack.length; i++) { settle(c); if (ks.state.priority === "p1" && !ks.state.pending) c.passPriority(); }
    const copy = ks.state.battlefield.find((id) => ks.state.objects[id].token && ks.state.objects[id].cardName === "Overwhelming Splendor")!;
    expect(ks.state.objects[copy].attachedPlayer).toBe("p1");
    expect(ks.state.objects[ids[0]].attachedPlayer).toBe("p2");
    const log = texts(ks);
    expect(log.some((x) => /creates a token copy of Overwhelming Splendor/.test(x)), log.join("\n")).toBe(true);
    expect(log.filter((x) => x.includes("No visible effect"))).toEqual([]);
    expect(ks.state.battlefield.every((id) => ks.state.objects[id].zone === "battlefield")).toBe(true);
  });
});
