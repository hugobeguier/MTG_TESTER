import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentModelName, warmUpOllamaModel } from "@/lib/ollama";

const WarmupRequestSchema = z.object({
  agentName: z.string().min(1)
});

// Best-effort model preload — see warmUpOllamaModel's own comment for why this exists. Always
// resolves ok regardless of whether the warm-up itself succeeded; callers are meant to fire this and
// move on, not branch on the result.
export async function POST(request: NextRequest) {
  const input = WarmupRequestSchema.parse(await request.json());
  await warmUpOllamaModel(agentModelName(input.agentName));
  return NextResponse.json({ ok: true });
}
