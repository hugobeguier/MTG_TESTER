// POST-only dev sink for "Couldn't resolve" records (see src/lib/unresolvedLog.ts). Off in production and when MTG_UNRESOLVED_LOG=0. Never errors into the game.
import { NextResponse } from "next/server";
import { unresolvedLoggingEnabled, validateUnresolvedPayload } from "@/lib/unresolvedLog";
import { appendUnresolvedRecord } from "@/lib/unresolvedLogFile";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: Request) {
  try {
    if (!unresolvedLoggingEnabled(process.env)) return NextResponse.json({ ok: false, reason: "disabled" });
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false, reason: "too_large" });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ ok: false, reason: "invalid" });
    }
    const record = validateUnresolvedPayload(body);
    if (!record) return NextResponse.json({ ok: false, reason: "invalid" });
    return NextResponse.json({ ok: true, result: appendUnresolvedRecord(record) });
  } catch {
    return NextResponse.json({ ok: false, reason: "error" });
  }
}
