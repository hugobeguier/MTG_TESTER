import { z } from "zod";
import type { AgentAction, DeckCard } from "./types";

const AgentActionSchema = z.object({
  actionType: z.enum([
    "keep_hand",
    "mulligan",
    "play_land",
    "cast_spell",
    "cast_commander",
    "activate_ability",
    "attack",
    "block",
    "pass_priority",
    "end_turn"
  ]),
  legalActionId: z.string().optional(),
  targetIds: z.array(z.string()).default([]),
  cardId: z.string().optional(),
  manaPlan: z.string().optional(),
  reason: z.string().min(1),
  fallbackAction: z
    .string()
    .default("pass_priority")
    .transform((value): "pass_priority" | "end_turn" => (value === "end_turn" ? "end_turn" : "pass_priority"))
});

const OllamaDeckCardSchema = z.object({
  name: z.string().min(1),
  count: z.number().int().min(1).max(99),
  role: z.string().min(1)
});

const OllamaDeckSchema = z.object({
  commander: z.string().min(1),
  colors: z.array(z.enum(["W", "U", "B", "R", "G"])).default([]),
  cards: z.array(OllamaDeckCardSchema).min(1),
  notes: z.string().optional()
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
  system: string;
  prompt: string;
  baseUrl?: string;
}): Promise<AgentAction> {
  const baseUrl = input.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = input.model ?? process.env.OLLAMA_MODEL ?? "llama3.2";
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: {
        type: "object",
        properties: {
          actionType: { type: "string" },
          legalActionId: { type: "string" },
          targetIds: { type: "array", items: { type: "string" } },
          cardId: { type: "string" },
          manaPlan: { type: "string" },
          reason: { type: "string" },
          fallbackAction: { type: "string" }
        },
        required: ["actionType", "targetIds", "reason", "fallbackAction"]
      },
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.prompt }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama action request failed with HTTP ${response.status}.`);
  }

  const body = await response.json();
  const content = body.message?.content;
  if (typeof content !== "string") {
    throw new Error("Ollama response did not include message.content.");
  }

  return AgentActionSchema.parse(JSON.parse(content));
}

export async function requestCommanderDeck(input: {
  agentName: string;
  commander: string;
  colors: string[];
  model?: string;
  baseUrl?: string;
}): Promise<{ commander: string; colors: string[]; cards: DeckCard[]; notes?: string }> {
  const baseUrl = input.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = input.model ?? process.env.OLLAMA_MODEL ?? "llama3.2";
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: {
        type: "object",
        properties: {
          commander: { type: "string" },
          colors: { type: "array", items: { type: "string", enum: ["W", "U", "B", "R", "G"] } },
          cards: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                count: { type: "number" },
                role: { type: "string" }
              },
              required: ["name", "count", "role"]
            }
          },
          notes: { type: "string" }
        },
        required: ["commander", "colors", "cards"]
      },
      messages: [
        {
          role: "system",
          content:
            "You build Magic: The Gathering Commander decks. Return JSON only. Build a Bracket 3 deck: exactly 100 cards including the commander, singleton except basic lands, no more than 3 Game Changer cards, balanced ramp/draw/removal/lands/synergy. Use real Magic card names."
        },
        {
          role: "user",
          content: [
            `Agent: ${input.agentName}`,
            `Commander: ${input.commander}`,
            `Color identity: ${input.colors.join("") || "infer from commander"}`,
            "Return cards as an array of { name, count, role }.",
            "Use 35-38 lands, 10-14 ramp, 10-14 card draw, 8-12 interaction, 2-4 board wipes, protection, synergy, and win conditions.",
            "The commander must be one card in the 100."
          ].join("\n")
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama deck request failed with HTTP ${response.status}.`);
  }

  const body = await response.json();
  const content = body.message?.content;
  if (typeof content !== "string") {
    throw new Error("Ollama response did not include message.content.");
  }

  const parsed = OllamaDeckSchema.parse(JSON.parse(content));
  return {
    commander: parsed.commander,
    colors: parsed.colors,
    cards: parsed.cards,
    notes: parsed.notes
  };
}
