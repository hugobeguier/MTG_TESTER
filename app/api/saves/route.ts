import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SAVE_FORMAT_VERSION, type GameSnapshot } from "@/lib/saveGame";
import { listSavedGames, writeSavedGame } from "@/lib/saveStore";

export async function GET() {
  return NextResponse.json(listSavedGames());
}

// Only the handful of fields this route itself actually reads (formatVersion, the session's own
// turn/phase) are validated by name — GameSnapshot/GameSession gain fields regularly in this
// project, and mirroring their full shape here would need constant upkeep for no real benefit: this
// is a local single-user tool, not a public API taking untrusted input, and the format-version check
// below is what actually guards against loading a snapshot this build doesn't understand.
const SaveGameRequestSchema = z.object({
  name: z.string().min(1),
  snapshot: z
    .object({
      formatVersion: z.number(),
      session: z.object({ turn: z.number(), phase: z.string() }).passthrough()
    })
    .passthrough()
});

export async function POST(request: NextRequest) {
  const input = SaveGameRequestSchema.parse(await request.json());
  const snapshot = input.snapshot as unknown as GameSnapshot;
  if (snapshot.formatVersion !== SAVE_FORMAT_VERSION) {
    return NextResponse.json(
      { status: "error", error: `Save format ${snapshot.formatVersion} is incompatible with this build (expects ${SAVE_FORMAT_VERSION}).` },
      { status: 400 }
    );
  }
  const id = crypto.randomUUID();
  const savedAt = new Date().toISOString();
  const summary = `Turn ${snapshot.session.turn} — ${snapshot.session.phase}`;
  writeSavedGame({ id, name: input.name, turn: snapshot.session.turn, phase: snapshot.session.phase, summary, savedAt, snapshot });
  return NextResponse.json({ id, name: input.name, formatVersion: snapshot.formatVersion, turn: snapshot.session.turn, phase: snapshot.session.phase, summary, savedAt });
}
