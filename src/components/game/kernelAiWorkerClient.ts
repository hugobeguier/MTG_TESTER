// Main-thread side of the AI worker (kernelAiWorker.ts): an AiRunner that posts a decision request and resolves with the reply. Any failure (no Worker support, the
// worker's script failing to load, a malformed reply) rejects, and the controller falls back to thinking in-process, so a broken worker never stalls a game.
import type { AiReply, AiRequest, AiRunner } from "./kernelAiWork";

export function createAiWorkerRunner(slugs: string[], base = "/kernel-packs"): AiRunner | undefined {
  if (typeof Worker === "undefined" || typeof location === "undefined") return undefined;
  base = new URL(base, location.origin).href.replace(/\/$/, ""); // a worker has no page URL to resolve a relative fetch against
  let worker: Worker;
  try { worker = new Worker(new URL("./kernelAiWorker.ts", import.meta.url), { type: "module" }); } catch { return undefined; }
  let n = 0;
  const waiting = new Map<number, { ok: (r: AiReply) => void; fail: (e: Error) => void }>();
  let ready: Promise<void> | undefined;
  const failAll = (why: string) => { for (const w of waiting.values()) w.fail(new Error(why)); waiting.clear(); };
  worker.onerror = (e) => failAll(`AI worker error: ${e.message}`);
  worker.onmessageerror = () => failAll("AI worker message error");
  ready = new Promise<void>((ok, fail) => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data as { type: string; reply?: AiReply; id?: number; error?: string };
      if (m.type === "ready") { ok(); return; }
      if (m.type === "reply" && m.reply) { const w = waiting.get(m.reply.id); waiting.delete(m.reply.id); w?.ok(m.reply); return; }
      if (m.type === "failed") { const err = new Error(m.error ?? "AI worker failed"); if (m.id !== undefined) { const w = waiting.get(m.id); waiting.delete(m.id); w?.fail(err); } else fail(err); }
    };
    worker.onmessage = onMsg;
    worker.postMessage({ type: "init", slugs, base });
  });
  ready.catch(() => undefined); // a failed init surfaces through choose()
  return {
    async choose(req: Omit<AiRequest, "id">): Promise<AiReply> {
      await ready;
      const id = ++n;
      return new Promise<AiReply>((ok, fail) => { waiting.set(id, { ok, fail }); worker.postMessage({ type: "choose", req: { ...req, id } }); });
    },
    dispose() { failAll("AI worker disposed"); worker.terminate(); }
  };
}
