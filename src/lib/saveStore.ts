// SQLite-backed store for saved-game snapshots (src/lib/saveGame.ts's GameSnapshot), mirroring
// cardDb.ts's parsed_cards store: prepared statements, an ON CONFLICT upsert for the write path, and
// a thin row<->domain-object mapping. This module owns only the DB access — snapshot validation
// (format version, clean-stop gating) lives in saveGame.ts/AppFlow.tsx, not here.
import { getCardDb } from "./cardDb";
import type { GameSnapshot, SavedGameSummary } from "./saveGame";

export function listSavedGames(): SavedGameSummary[] {
  const rows = getCardDb()
    .prepare("SELECT id, name, format_version, turn, phase, summary, saved_at FROM saved_games ORDER BY saved_at DESC")
    .all() as Array<{
    id: string;
    name: string;
    format_version: number;
    turn: number;
    phase: string;
    summary: string;
    saved_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    formatVersion: row.format_version,
    turn: row.turn,
    phase: row.phase,
    summary: row.summary,
    savedAt: row.saved_at
  }));
}

export function getSavedGame(id: string): GameSnapshot | undefined {
  const row = getCardDb().prepare("SELECT state FROM saved_games WHERE id = ?").get(id) as { state: string } | undefined;
  return row ? (JSON.parse(row.state) as GameSnapshot) : undefined;
}

export interface WriteSavedGameInput {
  id: string;
  name: string;
  turn: number;
  phase: string;
  summary: string;
  savedAt: string;
  snapshot: GameSnapshot;
}

// Upsert by id — saving again under the same id (e.g. overwriting an existing named slot) replaces
// it in place rather than duplicating, same "ON CONFLICT DO UPDATE" pattern cardDb.ts's own
// saveParsedCard already uses.
export function writeSavedGame(input: WriteSavedGameInput): void {
  getCardDb()
    .prepare(`
      INSERT INTO saved_games (id, name, format_version, turn, phase, summary, saved_at, state)
      VALUES (@id, @name, @formatVersion, @turn, @phase, @summary, @savedAt, @state)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, format_version = excluded.format_version, turn = excluded.turn,
        phase = excluded.phase, summary = excluded.summary, saved_at = excluded.saved_at, state = excluded.state
    `)
    .run({
      id: input.id,
      name: input.name,
      formatVersion: input.snapshot.formatVersion,
      turn: input.turn,
      phase: input.phase,
      summary: input.summary,
      savedAt: input.savedAt,
      state: JSON.stringify(input.snapshot)
    });
}

export function deleteSavedGame(id: string): void {
  getCardDb().prepare("DELETE FROM saved_games WHERE id = ?").run(id);
}
