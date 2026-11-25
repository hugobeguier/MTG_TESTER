// Web Worker entry: the kernel AI's thinking (legal actions + lookahead) off the main thread. Messages: { type: "init", slugs, base } once, then { type: "choose", req }.
// Loads the same card packs the page uses (fetch is available in a worker) and answers { type: "ready" } / { type: "reply", reply }.
import "@/kernel/engine/resolve"; // FIRST: the engine modules import each other in a cycle that only initialises when resolve.ts is entered first
import { fetchPacks, packKit } from "@/kernel/integration/cardPack";
import type { EngineContext } from "@/kernel/engine/types";
import { runAiRequest, type AiRequest } from "./kernelAiWork";

let ctx: EngineContext | undefined;
const scope = self as unknown as { postMessage(m: unknown): void; onmessage: ((e: MessageEvent) => void) | null };

scope.onmessage = async (e: MessageEvent) => {
  const m = e.data as { type: "init"; slugs: string[]; base?: string } | { type: "choose"; req: AiRequest };
  try {
    if (m.type === "init") {
      const kit = packKit(await fetchPacks(m.slugs, m.base));
      ctx = { cards: kit.lookup, db: kit.db };
      scope.postMessage({ type: "ready" });
    } else if (m.type === "choose") {
      if (!ctx) throw new Error("worker not initialised");
      scope.postMessage({ type: "reply", reply: runAiRequest(ctx, m.req) });
    }
  } catch (err) {
    scope.postMessage({ type: "failed", id: m.type === "choose" ? m.req.id : undefined, error: err instanceof Error ? err.message : String(err) });
  }
};
