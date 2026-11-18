// Pure seat <-> guest-slot mapping for multiplayer. A remote friend's seat stays `kind: "human"` and carries `remoteSlot` (a hub slot id such as
// "guest-1"). On the setup screen a remote seat is first marked REMOTE_UNASSIGNED; assignSlots() gives it a real slot when the game starts.
import type { GameSession, PlayerSeat } from "../types";
import type { GuestInfo, SlotId } from "./protocol";

/** Marker used on a setup-time remote seat that has no guest slot yet. */
export const REMOTE_UNASSIGNED: SlotId = "unassigned";

interface SeatLike {
  seatId: string;
  remoteSlot?: string;
  /** Setup-time: nobody sits here, the seat is not part of the game. */
  empty?: boolean;
}

/** A setup seat nobody plays (multiplayer host chose "Empty"): left out of the game, the lobby and every readiness check. */
export const isEmptySeat = (seat: { empty?: boolean }): boolean => seat.empty === true;

/** The setup seats that actually play, in seat order. */
export const activeSeats = <T extends { empty?: boolean }>(seats: T[]): T[] => seats.filter((seat) => !isEmptySeat(seat));

export const isRemoteSeat = (seat: { remoteSlot?: string }): boolean => seat.remoteSlot !== undefined;

/** The host's own human seat: the first human seat that is not a remote friend's (falls back to any human, then the first seat). */
export function hostHumanSeat<T extends Pick<PlayerSeat, "kind" | "remoteSlot">>(seats: T[]): T | undefined {
  return seats.find((seat) => seat.kind === "human" && !isRemoteSeat(seat)) ?? seats.find((seat) => seat.kind === "human");
}

function slotOrder(a: SlotId, b: SlotId): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * slot -> seatId for the remote seats, in seat order, using only connected guests (ordered by slot). A seat that already holds a real slot
 * whose guest is still connected keeps it (stable); the rest are filled from the remaining guests. Extra guests stay unassigned (spectators);
 * seats without a guest get no entry.
 */
export function assignSlots(seats: SeatLike[], guests: GuestInfo[]): Record<SlotId, string> {
  const free = guests.filter((g) => g.connected).map((g) => g.seatId).sort(slotOrder);
  const result: Record<SlotId, string> = {};
  const remote = activeSeats(seats).filter(isRemoteSeat);
  const pending: SeatLike[] = [];
  for (const seat of remote) {
    const keep = seat.remoteSlot !== undefined && free.includes(seat.remoteSlot) && !(seat.remoteSlot in result);
    if (keep) result[seat.remoteSlot as SlotId] = seat.seatId;
    else pending.push(seat);
  }
  const available = free.filter((slot) => !(slot in result));
  pending.forEach((seat, i) => {
    if (i < available.length) result[available[i]] = seat.seatId;
  });
  return result;
}

/** Seat ids of the session's remote seats. */
export function remoteSeatIds(session: Pick<GameSession, "seats">): string[] {
  return session.seats.filter(isRemoteSeat).map((seat) => seat.id);
}

export function slotForSeat(session: Pick<GameSession, "seats">, seatId: string): SlotId | undefined {
  return session.seats.find((seat) => seat.id === seatId)?.remoteSlot;
}

export function seatForSlot(session: Pick<GameSession, "seats">, slot: SlotId): string | undefined {
  return session.seats.find((seat) => seat.remoteSlot === slot)?.id;
}

/** Remote seats (setup configs) that have no connected guest to fill them. */
export function missingGuests(seats: SeatLike[], guests: GuestInfo[]): string[] {
  const assigned = new Set(Object.values(assignSlots(seats, guests)));
  return activeSeats(seats).filter((seat) => isRemoteSeat(seat) && !assigned.has(seat.seatId)).map((seat) => seat.seatId);
}
