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
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).min(1)
});

// Debug chat: the human asks an agent why it made a decision (and says what they would have done). The model sees the recorded decision, so
// its answer is a reconstruction from the same information it had, not a memory of its own thinking.
export async function POST(request: NextRequest) {
  const input = ChatRequest.parse(await request.json());
  const lessons = formatLessonsForPrompt(await readLessons(), input.decision.purpose, 5);
  const system = [
    `You are ${input.seatName}, an AI player in a Magic: The Gathering Commander game. The human watching is asking you about a decision you made.`,
    "Answer in English only, in 2-5 plain sentences. Be honest and specific: use only the facts in the decision record below, and say so if you cannot tell.",
    "Do not invent card text. The heuristic scores are a rule-of-thumb ranking, not your own opinion; mention them when they explain the choice.",
    "If the human says what they would have done, agree or disagree briefly with a concrete reason, then restate their idea as one short rule you would follow next time.",
    formatDecisionForChat(input.decision),
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
