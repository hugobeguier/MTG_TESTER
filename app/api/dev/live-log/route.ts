// POST-only dev sink for the kernel "Save game log" button: writes data/observer/live-logs/<timestamp>.json (decks, seed, every action, stack log, final state).
// Local file only, never forwarded anywhere. Refused in production, when MTG_LIVE_LOG=0, and for any host that is not this machine. The payload is validated field by field.
import { NextResponse } from "next/server";
import { MAX_REPLAY_BYTES } from "@/kernel/integration/replayFile";
import { saveReplayFile } from "@/kernel/integration/replayStore";

export const runtime = "nodejs";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export async function POST(request: Request) {
  try {
    if (process.env.NODE_ENV === "production" || process.env.MTG_LIVE_LOG === "0") return NextResponse.json({ ok: false, reason: "disabled" }, { status: 403 });
    if (!LOCAL_HOST.test(request.headers.get("host") ?? "")) return NextResponse.json({ ok: false, reason: "local only" }, { status: 403 });
    const text = await request.text();
    if (text.length > MAX_REPLAY_BYTES) return NextResponse.json({ ok: false, reason: "too_large" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(text); } catch { return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 }); }
    const file = saveReplayFile(body);
    return file ? NextResponse.json({ ok: true, file }) : NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 });
  } catch {
    return NextResponse.json({ ok: false, reason: "error" }, { status: 500 });
  }
}
