import { z } from "zod";
import type { AgentAction } from "./types";

const AgentActionSchema = z.object({
  actionType: z.enum([
    "keep_hand",
    "mulligan",
    "play_land",
    "cast_spell",
    "activate_ability",
    "attack",
    "block",
    "pass_priority",
    "end_turn"
  ]),
  // Small local models often emit null/missing for optional fields; only actionType must be valid.
  targetIds: z.array(z.string()).catch([]).default([]),
  cardId: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
  manaPlan: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
  reason: z.string().catch("").default(""),
  fallbackAction: z.enum(["pass_priority", "end_turn"]).catch("pass_priority").default("pass_priority")
});

export async function checkOllama(baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434") {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { cache: "no-store" });
    if (!response.ok) {
      return { ok: false, message: `Ollama responded with HTTP ${response.status}.` };
    }
    const body = await response.json();
    return {
      ok: true,
      message: "Ollama is reachable.",
      models: Array.isArray(body.models) ? body.models.map((model: { name: string }) => model.name) : []
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `${error.message}. Install Ollama, run "ollama serve", then pull/create the MTG agent models.`
          : "Ollama is not reachable. Install Ollama, run \"ollama serve\", then pull/create the MTG agent models."
    };
  }
}

export async function requestAgentAction(input: {
  model?: string;
  system?: string;
  prompt: string;
  baseUrl?: string;
  onContent?: (content: string) => void;
}): Promise<AgentAction> {
  const baseUrl = input.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = input.model ?? process.env.OLLAMA_MODEL ?? "llama3.2";
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      format: {
        type: "object",
        // reason first: grammar-constrained generation follows property order, so the
        // reasoning streams out before the mechanical fields.
        properties: {
          reason: { type: "string" },
          actionType: { type: "string" },
          cardId: { type: "string" },
          targetIds: { type: "array", items: { type: "string" } },
          manaPlan: { type: "string" },
          fallbackAction: { type: "string" }
        },
        required: ["reason", "actionType", "cardId", "targetIds", "fallbackAction"]
      },
      // Omitting the system message lets the persona baked into each agent Modelfile apply.
      messages: [
        ...(input.system ? [{ role: "system", content: input.system }] : []),
        { role: "user", content: input.prompt }
      ]
    })
  });

  if (!response.ok || !response.body) {
    throw new Error(`Ollama action request failed with HTTP ${response.status}.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let content = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const chunk = JSON.parse(line) as { message?: { content?: string } };
      if (chunk.message?.content) {
        content += chunk.message.content;
        input.onContent?.(content);
      }
    }
  }

  if (!content) {
    throw new Error("Ollama response did not include message content.");
  }

  return AgentActionSchema.parse(JSON.parse(content));
}
