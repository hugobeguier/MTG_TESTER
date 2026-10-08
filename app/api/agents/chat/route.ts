import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentModelName, chatWithAgent } from "@/lib/ollama";
import { formatDecisionForChat, formatLessonsForPrompt } from "@/lib/agentLessons";
import { readLessons } from "@/lib/agentLessonStore";

const ChatRequest = z.object({
  agentName: z.string().min(1),
  seatName: z.string().min(1),
  decision: z.object({
    purpose: z.string(),
    turn: z.number().optional(),
    phase: z.string().optional(),
    situation: z.string(),
    options: z.array(z.object({ id: z.string(), label: z.string(), score: z.number(), reasons: z.array(z.string()).optional() })),
    chosenId: z.string().optional(),
    chosenLabel: z.string(),
    reason: z.string(),
    deliberation: z.string().optional()
  }),
  history: z.array(z.object({ turn: z.number().optional(), phase: z.string().optional(), purpose: z.string(), label: z.string(), reason: z.string() })).default([]),
  recentEvents: z.array(z.string()).default([]),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).min(1)
});

// Debug chat: the human asks an agent why it made a decision (and says what they would have done). The model sees the recorded decision, its own
// earlier decisions and the recent game log, so its answer is a reconstruction from the same information, not a memory of its own thinking.
export async function POST(request: NextRequest) {
  const input = ChatRequest.parse(await request.json());
  const lessons = formatLessonsForPrompt(await readLessons(), input.decision.purpose, 5);
  const historyText =
    input.history.length > 0
      ? "Your own earlier decisions this game (oldest first):\n" + input.history.map((entry) => `- turn ${entry.turn ?? "?"} ${entry.phase ?? ""}: ${entry.label} — ${entry.reason}`).join("\n")
      : "";
  const eventsText =
    input.recentEvents.length > 0 ? "The most recent game log (all players, oldest first):\n" + input.recentEvents.map((line) => "- " + line).join("\n") : "";
  const system = [
    `You are ${input.seatName}, an AI player in a Magic: The Gathering Commander game. The human watching is asking you about a decision you made.`,
    "Answer in English only, in 2-5 plain sentences. Be honest and specific: use only the facts below, and say so if you cannot tell.",
    "Do not invent card text. The heuristic scores are a rule-of-thumb ranking, not your own opinion; mention them when they explain the choice.",
    "If the human says what they would have done, agree or disagree briefly with a concrete reason, then restate their idea as one short rule you would follow next time.",
    formatDecisionForChat(input.decision),
    historyText,
    eventsText,
    "You are only one of the players. You know your own decisions above and what the game log shows. If the human asks about a card or play that is not yours (it was another player's, or you never had that card), say whose play it was according to the log instead of claiming it or denying the card exists.",
    lessons
  ]
    .filter(Boolean)
    .join("\n\n");
  try {
    const reply = await chatWithAgent({ model: agentModelName(input.agentName), system, messages: input.messages });
    return NextResponse.json({ reply });
  } catch (error) {
    return NextResponse.json({ reply: "", error: error instanceof Error ? error.message : "The agent model is unavailable." }, { status: 502 });
  }
}
