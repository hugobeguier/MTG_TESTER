// What the AI worker computes for one AI decision, as plain functions (no Worker, no DOM): the legal-action list of the seat and the action chosen from it.
// The browser runs this in kernelAiWorker.ts so the 0.5-20 s a big late-game board costs never blocks rendering; tests and the controller's fallback run the same code
// in-process. The result depends only on (state, seat, memory), never on the clock or on which thread ran it.
import { legalActions } from "@/kernel/engine/legal";
import type { Action, EngineContext, GameState, PlayerId } from "@/kernel/engine/types";
import { chooseAiAction, type AiMemory } from "./kernelAi";

/** AiMemory with its Sets as arrays (structured clone handles Sets too, but a plain shape is what a message log / test can compare) */
export type WireMemory = Omit<AiMemory, "banned" | "responded"> & { banned: string[]; responded?: string[] };

/** (script and usage are copied: the AI shifts / increments them, and an in-process runner must not touch the caller's) */
export function toWire(m: AiMemory): WireMemory { const { banned, responded, script, usage, ...rest } = m; return { ...rest, ...(script ? { script: structuredClone(script) } : {}), ...(usage ? { usage: { ...usage } } : {}), banned: [...banned], ...(responded ? { responded: [...responded] } : {}) }; }
export function fromWire(w: WireMemory): AiMemory { const { banned, responded, ...rest } = w; return { ...rest, banned: new Set(banned), ...(responded ? { responded: new Set(responded) } : {}) }; }
/** copy what the AI learned (script, usage, profiles, banned, responded) back into the caller's memory object, which other code holds */
export function adoptMemory(into: AiMemory, from: AiMemory): void {
  into.banned = from.banned; into.responded = from.responded; into.script = from.script; into.usage = from.usage; into.profiles = from.profiles;
}

export interface AiRequest { id: number; state: GameState; seat: PlayerId; memory: WireMemory }
export interface AiReply { id: number; action?: Action; memory: WireMemory; ms: number; error?: string }

export function runAiRequest(ctx: EngineContext, req: AiRequest): AiReply {
  const t = performance.now();
  const memory = fromWire(req.memory);
  try {
    const action = chooseAiAction(legalActions(req.state, req.seat, ctx), req.state, ctx, req.seat, memory);
    return { id: req.id, ...(action ? { action } : {}), memory: toWire(memory), ms: performance.now() - t };
  } catch (e) {
    return { id: req.id, memory: toWire(memory), ms: performance.now() - t, error: e instanceof Error ? e.message : String(e) };
  }
}

/** how the controller reaches the worker (injectable: tests pass an in-process one) */
export interface AiRunner { choose(req: Omit<AiRequest, "id">): Promise<AiReply>; dispose?(): void }

export function inProcessRunner(ctx: EngineContext): AiRunner {
  let n = 0;
  return { choose: (req) => Promise.resolve(runAiRequest(ctx, { ...req, id: ++n })) };
}
