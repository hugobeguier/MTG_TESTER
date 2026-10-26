import { NextRequest, NextResponse } from "next/server";
import { appendFile } from "node:fs/promises";
import path from "node:path";

// Diagnostic sink: every time a card ends up at the LLM rules advisor / primitive planner / manual
// review prompt, the client posts one record here so the cards the deterministic engine could not
// handle can be reviewed (and fixed) after a game. One JSON object per line.
const LOG_FILE = path.join(process.cwd(), "advisor-log.jsonl");

export async function POST(request: NextRequest) {
  try {
    const record = await request.json();
    await appendFile(LOG_FILE, `${JSON.stringify(record)}\n`, "utf8");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
