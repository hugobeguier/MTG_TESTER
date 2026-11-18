// Pure rules for the parallel opening-hand step in multiplayer: every HUMAN seat (the host's and each friend's) decides keep/mulligan; AI seats were
// resolved when the game started (keptHands true). The game only goes to "playing" once no human seat is still deciding.
import { openingHandKeepSize } from "@/engine/mulligan";

interface MulliganSeat {
  id: string;
  name: string;
  kind: "human" | "agent";
  board: { hand: unknown[] };
}

/** Human seats (host + friends) that have not kept yet, in seat order. */
export function undecidedSeats<T extends Pick<MulliganSeat, "id" | "kind">>(seats: T[], keptHands: Record<string, boolean>): T[] {
  return seats.filter((seat) => seat.kind === "human" && !keptHands[seat.id]);
}

/** True when keeping `keepingSeatId` now leaves no human seat undecided (that keep is the one that starts the game). */
export function isLastToKeep(seats: Pick<MulliganSeat, "id" | "kind">[], keptHands: Record<string, boolean>, keepingSeatId: string): boolean {
  return undecidedSeats(seats, keptHands).every((seat) => seat.id === keepingSeatId);
}

/** Cards a seat must still shuffle into its library before keeping (London mulligan): hand size minus what its mulligan count allows. */
export function mulliganReturnRequired(hand: unknown[], mulligansTaken: number): number {
  return Math.max(0, hand.length - openingHandKeepSize(mulligansTaken));
}

/** Display names of the seats still deciding, for the "Waiting for ... to decide" hint. */
export function waitingForNames(seats: MulliganSeat[], keptHands: Record<string, boolean>): string[] {
  return undecidedSeats(seats, keptHands).map((seat) => seat.name);
}
