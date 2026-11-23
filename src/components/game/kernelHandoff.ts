// The opening position the legacy flow hands to the kernel at the end of the mulligans: the legacy session as keepOpeningHand would have started it
// (this seat's hand trimmed, the roll winner on turn 1 in the untap step), without the legacy bookkeeping (log lines, leyline auto-plays: kernel mode starts clean).
import type { GameSession } from "@/lib/types";
import { keepOpeningHandSize } from "@/engine/mulligan";

export function kernelHandoffSession(session: GameSession, seatId: string, keepSize: number, returnIds: string[], firstSeatId: string): GameSession {
  return {
    ...session,
    status: "playing",
    activePlayerId: firstSeatId,
    phase: "untap step",
    turn: 1,
    seats: session.seats.map((item) => (item.id === seatId ? keepOpeningHandSize(item, keepSize, returnIds, true) : item))
  };
}
