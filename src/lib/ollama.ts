import { z } from "zod";
import type { AgentAction, DeckCard } from "./types";

// Local inference on a small model can legitimately take a while, especially right after an agent
// switch forces Ollama to swap models — these need to be generous enough not to false-trigger on
// slow-but-working requests, while still bounded so a genuinely stalled request can't freeze a
// turn forever (see requestAgentAction's callers in AppFlow.tsx: without a timeout, a hung fetch
// skips the finally block that clears the "decision in flight" guard, permanently locking that
// phase — no error is ever thrown, so nothing else can recover it).
export const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 20000);
export const OLLAMA_DECK_TIMEOUT_MS = Number(process.env.OLLAMA_DECK_TIMEOUT_MS ?? 60000);
export const OLLAMA_PING_TIMEOUT_MS = Number(process.env.OLLAMA_PING_TIMEOUT_MS ?? 5000);

// AbortSignal.timeout(ms) makes the fetch reject with a normal DOMException("TimeoutError") on
// expiry — that's a regular thrown error, so it flows straight into whatever catch/fallback logic
// already handles a failed Ollama request (HTTP error, network error, invalid JSON, ...) rather
// than needing new handling of its own.
export function ollamaFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

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
  deliberation: z.string().optional(),
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
    const response = await ollamaFetch(`${baseUrl}/api/tags`, { cache: "no-store" }, OLLAMA_PING_TIMEOUT_MS);
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
  // Currently unused by the format schema below — kept as a documented parameter so callers stay
  // explicit about which purposes ask for deliberation (route.ts's system-prompt instruction is
  // what actually elicits it). "deliberation" is deliberately never added to the schema's own
  // `required` list, even when this is true: a required field forces Ollama's constrained-decoding
  // grammar to guarantee it, and a small local model asked to satisfy a new required field it isn't
  // confident about can stall generation altogether rather than just writing a short/empty value —
  // that's a strictly worse failure mode than an occasionally-missing deliberation, and it's what
  // produced a stuck-forever agent turn (same "Waiting for responses" symptom fixed earlier this
  // session for an unrelated scheduling race) the first time this was tried as a required field.
  requireDeliberation?: boolean;
}): Promise<AgentAction> {
  const baseUrl = input.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = input.model ?? process.env.OLLAMA_MODEL ?? "llama3.2";
  const response = await ollamaFetch(
    `${baseUrl}/api/chat`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: {
          type: "object",
          properties: {
            actionType: {
              type: "string",
              enum: ["keep_hand", "mulligan", "play_land", "cast_spell", "cast_commander", "activate_ability", "attack", "block", "pass_priority", "end_turn"]
            },
            legalActionId: { type: "string" },
            targetIds: { type: "array", items: { type: "string" } },
            cardId: { type: "string" },
            manaPlan: { type: "string" },
            reason: { type: "string" },
            deliberation: { type: "string" },
            fallbackAction: { type: "string", enum: ["pass_priority", "end_turn"] }
          },
          required: ["actionType", "targetIds", "reason", "fallbackAction"]
        },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.prompt }
        ]
      })
    },
    OLLAMA_TIMEOUT_MS
  );

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
  /** EDHREC's live top synergy picks for this exact commander, highest-synergy-first, if available. */
  synergyCardNames?: string[];
  /** Deckbuilding knowledge pack (system contract + commander rules + bracket policy + deckbuilding
   *  heuristics docs, loaded via knowledgeFilesForPurpose("deckbuilding")), prepended to the system
   *  message ahead of the hard, validation-critical requirements below. Optional so callers/tests that
   *  don't have a knowledge pack loaded (or the doc files) still get a fully-specified prompt. */
  knowledge?: string;
}): Promise<{ commander: string; colors: string[]; cards: DeckCard[]; notes?: string }> {
  const baseUrl = input.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = input.model ?? process.env.OLLAMA_MODEL ?? "llama3.2";
  const response = await ollamaFetch(`${baseUrl}/api/chat`, {
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
          content: [
            input.knowledge,
            // These stay explicit in the code-level prompt (rather than only in the docs) because
            // they're validation-critical: repairCommanderDeckCards/bracketPolicy enforce them
            // downstream regardless of what the knowledge pack says, so the model should never be
            // able to drift from them even if the docs are edited independently.
            "You build Magic: The Gathering Commander decks. Return JSON only. Build a Bracket 3 deck: exactly 100 cards including the commander, singleton except basic lands, no more than 3 Game Changer cards, balanced ramp/draw/removal/lands/synergy. Do not include mass land destruction/denial (e.g. Armageddon-style effects), fast/cheap two-card infinite combos that come together before the late game, or cards that chain/loop extra turns together (Nexus of Fate) — a single extra-turn spell on its own is fine. Use real Magic card names."
          ]
            .filter(Boolean)
            .join("\n\n---\n\n")
        },
        {
          role: "user",
          content: [
            `Agent: ${input.agentName}`,
            `Commander: ${input.commander}`,
            `Color identity: ${input.colors.join("") || "infer from commander"} (authoritative — the commander's real color identity, do not override it)`,
            input.synergyCardNames && input.synergyCardNames.length > 0
              ? `Cards EDHREC ranks as high-synergy with this exact commander (prefer these where they fit): ${input.synergyCardNames.join(", ")}`
              : undefined,
            "Return cards as an array of { name, count, role }.",
            "Use 35-38 lands, 10-14 ramp, 10-14 card draw, 8-12 interaction, 2-4 board wipes, protection, synergy, and win conditions.",
            "The commander must be one card in the 100."
          ]
            .filter((line): line is string => Boolean(line))
            .join("\n")
        }
      ]
    })
  }, OLLAMA_DECK_TIMEOUT_MS);

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
