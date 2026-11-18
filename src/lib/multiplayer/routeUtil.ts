import { z } from "zod";
import { getHub, type MultiplayerHub } from "./hub";
import { HEARTBEAT_INTERVAL_MS, HubError, MAX_PUBLISH_BYTES, SSE_PADDING_BYTES, type StreamEvent } from "./protocol";

// Shared glue for the thin /api/mp route handlers. Tokens are never logged.

export function bearerToken(req: Request): string {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  return m ? m[1] : "";
}

export function hub(): MultiplayerHub {
  const h = getHub();
  h.sweep();
  return h;
}

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

/** Run a handler body, mapping HubError / zod errors to JSON error responses. */
export async function respond(fn: () => Promise<unknown> | unknown): Promise<Response> {
  try {
    return Response.json((await fn()) ?? { ok: true });
  } catch (e) {
    if (e instanceof HubError) return jsonError(e.status, e.message);
    if (e instanceof z.ZodError) return jsonError(400, "Invalid request body");
    return jsonError(400, "Bad request");
  }
}

export async function parseBody<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<z.infer<T>> {
  const text = await req.text();
  if (text.length > MAX_PUBLISH_BYTES + 4096) throw new HubError(413, "Body too large");
  return schema.parse(JSON.parse(text || "{}"));
}

export const sseFormat = (msg: StreamEvent) => `data: ${JSON.stringify(msg)}\n\n`;
/** Comment frame of ~2 KB that makes buffering intermediaries flush the response. */
export const ssePadding = () => `: ${".".repeat(SSE_PADDING_BYTES)}\n\n`;
export const sseHeartbeat = () => `: hb\n\n`;

/** Build an SSE response bound to a hub token; unsubscribes on cancel or request abort. */
export function sseResponse(req: Request, token: string): Response {
  const h = hub();
  if (!h.identify(token)) return jsonError(401, "Invalid token");
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: () => void = () => {};
      const timer = setInterval(() => safe(sseHeartbeat()), HEARTBEAT_INTERVAL_MS);
      const safe = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      unsubscribe = h.subscribe(token, (msg) => {
        safe(sseFormat(msg));
        if (msg.type === "room_closed" || (msg.type === "error" && !closed)) queueMicrotask(cleanup);
      });
      safe(`retry: 3000\n\n`);
      safe(ssePadding());
      req.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    }
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
