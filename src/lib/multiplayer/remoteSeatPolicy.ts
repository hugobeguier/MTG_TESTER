// Whether a remote friend's seat takes part in the game flow (holds priority, takes its own turn, answers prompts). The friend plays through intents
// (components/game/mpIntents.ts), so the host waits for them like it waits for its own human seat. Every "wait for the remote seat" decision goes
// through remoteSeatCanAct, so switching a seat back to "skipped" stays a one-line change.
import type { PriorityStopSettings, SeatStopSettings } from "../priorityStops";
import { seatStopSettingsOf } from "./seatStops";

export const remoteSeatsCanAct = true;

/** Can this seat act in the flow right now? Always true for the host's own seat and agents; for a remote seat it follows `remoteSeatsCanAct`. */
export function remoteSeatCanAct(seat: { remoteSlot?: string }, canAct: boolean = remoteSeatsCanAct): boolean {
  return seat.remoteSlot === undefined || canAct;
}

/**
 * The stop settings that decide whether `seat` is interrupted: the host's seat (and agents, which ignore stops) use the host's `stops`; a remote friend uses
 * THEIR OWN (`stops.bySeat`, defaulting to the same defaults the host has). They are asked exactly when the host's rules would ask the host.
 */
export function priorityStopsForSeat(seat: { id: string; remoteSlot?: string }, stops: PriorityStopSettings, seatIndex: number, seatCount: number): PriorityStopSettings | SeatStopSettings {
  return seat.remoteSlot === undefined ? stops : seatStopSettingsOf(stops, seat.id, seatIndex, seatCount);
}
