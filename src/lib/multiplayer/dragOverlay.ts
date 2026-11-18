// Optimistic card positions for a friend's table. Dragging a permanent must feel instant on the friend's screen, but the host owns the game: so the friend
// keeps a local "overlay" of positions (shown on top of the last snapshot), sends ONE intent when the card is dropped, and drops the overlay entry as soon
// as the host's snapshot is authoritative again (the card is where the friend put it, the host answered the drop's intent, or too long has passed).
// Whatever the snapshot then says is the truth: a refused drop simply snaps back (and the existing ack toast says why). Pure; used by RemoteTable.
import type { GameSession } from "../types";

export interface DragEntry {
  pos: { x: number; z: number };
  /** The card was dropped and its intent was sent (clientSeq of that intent, when known). Not dropped = still being dragged. */
  dropped: boolean;
  seq?: number;
  /** Epoch ms of the last change. */
  at: number;
}
export type DragOverlay = Record<string, DragEntry>;

/** An unanswered drop is forgotten after this long (lost POST, host paused, ...): the snapshot's position wins again. */
export const DRAG_OVERLAY_TTL_MS = 4000;

export const samePos = (a: { x: number; z: number } | undefined, b: { x: number; z: number }) => a !== undefined && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;

/** The session with the overlay's positions applied to the seat's battlefield (the same object when there is nothing to apply). */
export function applyDragOverlay(session: GameSession, seatId: string | undefined, overlay: DragOverlay): GameSession {
  const ids = Object.keys(overlay);
  if (!seatId || ids.length === 0) return session;
  return {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id !== seatId
        ? seat
        : { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (overlay[card.id] ? { ...card, battlefieldPosition: overlay[card.id].pos } : card)) } }
    )
  };
}

/**
 * Entries that are still needed. A card being dragged is kept (unless it left the battlefield); a dropped one is released when the snapshot already shows
 * that position, when the host answered an intent at or after the drop's (`ackSeq`), or when it timed out. Returns `overlay` itself when nothing changed.
 */
export function pruneDragOverlay(overlay: DragOverlay, session: GameSession, seatId: string | undefined, ackSeq: number | undefined, now: number, ttlMs = DRAG_OVERLAY_TTL_MS): DragOverlay {
  const battlefield = session.seats.find((seat) => seat.id === seatId)?.board.battlefield ?? [];
  const next: DragOverlay = {};
  for (const [cardId, entry] of Object.entries(overlay)) {
    const card = battlefield.find((item) => item.id === cardId);
    if (!card) continue;
    if (entry.dropped) {
      if (samePos(card.battlefieldPosition, entry.pos)) continue;
      if (entry.seq !== undefined && ackSeq !== undefined && ackSeq >= entry.seq) continue;
      if (now - entry.at > ttlMs) continue;
    }
    next[cardId] = entry;
  }
  return Object.keys(next).length === Object.keys(overlay).length ? overlay : next;
}

/** Records a drag move (not sent anywhere) or the drop. */
export function recordDrag(overlay: DragOverlay, cardId: string, pos: { x: number; z: number }, dropped: boolean, now: number, seq?: number): DragOverlay {
  return { ...overlay, [cardId]: { pos, dropped, seq, at: now } };
}
