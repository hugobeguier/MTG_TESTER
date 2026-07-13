import { NextRequest } from "next/server";
import { z } from "zod";
import { requestAgentAction } from "@/lib/ollama";

const AgentActionRequestSchema = z.object({
  agentName: z.string().min(1),
  prompt: z.string().min(1)
});

export async function POST(request: NextRequest) {
  const input = AgentActionRequestSchema.parse(await request.json());
  const encoder = new TextEncoder();

  // NDJSON stream: {type:"content"} partials while the model generates, then a final
  // {type:"action"} or {type:"error"} line.
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      try {
        const action = await requestAgentAction({
          model: input.agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          prompt: input.prompt,
          onContent: (content) => send({ type: "content", content })
        });
        send({ type: "action", action });
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "Agent action request failed." });
      }
      controller.close();
    }
  });

  return new Response(stream, { headers: { "content-type": "application/x-ndjson" } });
}
