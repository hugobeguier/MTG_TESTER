// The AI shortcuts that make the driver cheap on big boards must not change a single decision:
//   quickAiAction (no legal list for a plain pass / advance) and runAiRequest (the worker's code path) against chooseAiAction on whole games.
import { describe, expect, it } from "vitest";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { ctx, deckNames } from "@/kernel/integration/testgame";
import { freshMemory, chooseAiAction, quickAiAction, type AiMemory } from "./kernelAi";
import { fromWire, runAiRequest, toWire } from "./kernelAiWork";

function game(decks: string[], seed: number) {
  const players = decks.map((d, i) => { const { cards, commander } = deckNames(d); return { id: `p${i + 1}`, name: d, deck: cards, ...(commander ? { commander } : {}), kind: "agent" as const }; });
  return KernelSession.fromDecks({ ctx, decks: players, seed, startPhase: "precombat_main" });
}

describe("AI shortcuts are decision-identical", () => {
  it("quickAiAction and the worker path agree with chooseAiAction on a whole opening game", () => {
    const ks = game(["Wretched Ranks", "Meren"], 7);
    const mem: Record<string, AiMemory> = {}; let memTurn = -1, quick = 0, wire = 0, full = 0;
    for (let i = 0; i < 160 && !ks.gameOver; i++) {
      const s = ks.state; const actor = ks.actor; if (!actor) break;
      if (memTurn !== s.turn.number) { for (const k of Object.keys(mem)) mem[k] = freshMemory(mem[k]); memTurn = s.turn.number; }
      mem[actor] ??= { banned: new Set() };
      const acts = ks.legal(actor);
      // run the shortcut candidates on COPIES of the memory first (the memory is mutated by the choice)
      const copy = (): AiMemory => fromWire(structuredClone(toWire(mem[actor])));
      const q = quickAiAction(s, actor, copy());
      const w = runAiRequest(ctx, { id: 1, state: s, seat: actor, memory: toWire(mem[actor]) });
      const real = chooseAiAction(acts, s, ctx, actor, mem[actor]);
      if (q) { expect(q, `step ${i}`).toEqual(real); quick++; } else full++;
      expect(w.action, `step ${i}`).toEqual(real); wire++;
      expect(w.memory.banned).toEqual([...mem[actor].banned]); expect(w.memory.usage).toEqual(mem[actor].usage); expect(w.memory.script).toEqual(mem[actor].script);
      if (!real) break;
      const res = ks.dispatch(actor, real);
      if (!res.ok) { const pass = acts.find((a) => a.kind === "passPriority")?.action; if (!pass || ks.state.pending) break; ks.dispatch(actor, pass); }
    }
    expect(wire).toBeGreaterThan(100);
    expect(quick).toBeGreaterThan(20); // most steps of a game are plain passes
    expect(full).toBeGreaterThan(0);
  }, 120_000);
});
