import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentModelName, chatWithAgent } from "@/lib/ollama";
import { buildAgentChatSystemPrompt, cardTextsMentioned, formatDecisionForChat, formatLessonsForPrompt, lessonsForAgent } from "@/lib/agentLessons";
import { readLessons } from "@/lib/agentLessonStore";
import { loadCardCatalog } from "@/lib/cardCatalog";

const ChatRequest = z.object({
  agentName: z.string().min(1),
  seatName: z.string().min(1),
  // The other players at the table, so the prompt can pin the conversation to the selected seat only.
  otherSeatNames: z.array(z.string()).default([]),
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
// Only the selected agent's persona, decision, history and lessons are used (see buildAgentChatSystemPrompt); log lines are tagged by player.
export async function POST(request: NextRequest) {
  const input = ChatRequest.parse(await request.json());
  const lessons = formatLessonsForPrompt(lessonsForAgent(await readLessons(), input.agentName), input.decision.purpose, 5);
  const historyText =
    input.history.length > 0
      ? "Your own earlier decisions this game (oldest first):\n" + input.history.map((entry) => `- turn ${entry.turn ?? "?"} ${entry.phase ?? ""}: ${entry.label} — ${entry.reason}`).join("\n")
      : "";
  const eventsText =
    input.recentEvents.length > 0 ? "The most recent game log (all players, each line tagged [Player] with whose it is, oldest first):\n" + input.recentEvents.map((line) => "- " + line).join("\n") : "";
  const cardTexts = cardTextsMentioned(
    [input.decision.situation, input.decision.chosenLabel, input.decision.reason, ...input.decision.options.map((option) => option.label), ...input.history.map((entry) => entry.label), ...input.recentEvents, ...input.messages.map((message) => message.content)].join("\n"),
    loadCardCatalog().cards
  );
  const system = buildAgentChatSystemPrompt({
    seatName: input.seatName,
    otherSeatNames: input.otherSeatNames,
    decisionText: formatDecisionForChat(input.decision),
    cardTexts,
    historyText,
    eventsText,
    lessonsText: lessons,
    humanMessages: input.messages.filter((message) => message.role === "user").map((message) => message.content)
  });
  try {
    const reply = await chatWithAgent({ model: agentModelName(input.agentName), system, messages: input.messages });
    return NextResponse.json({ reply });
  } catch (error) {
    return NextResponse.json({ reply: "", error: error instanceof Error ? error.message : "The agent model is unavailable." }, { status: 502 });
  }
}
