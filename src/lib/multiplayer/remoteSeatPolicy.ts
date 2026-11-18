// Whether a remote friend's seat takes part in the game flow (holds priority, takes its own turn, answers prompts). The friend plays through intents
// (components/game/mpIntents.ts), so the host waits for them like it waits for its own human seat. Every "wait for the remote seat" decision goes
// through remoteSeatCanAct, so switching a seat back to "skipped" stays a one-line change.
import { stopKey, type PriorityStopSettings } from "../priorityStops";

export const remoteSeatsCanAct = true;

/** Can this seat act in the flow right now? Always true for the host's own seat and agents; for a remote seat it follows `remoteSeatsCanAct`. */
export function remoteSeatCanAct(seat: { remoteSlot?: string }, canAct: boolean = remoteSeatsCanAct): boolean {
  return seat.remoteSlot === undefined || canAct;
}

/** The friend has no stop-settings UI: they always get a priority window when they hold a legal response (full control). */
export function priorityStopsForSeat<T extends { remoteSlot?: string }>(seat: T, stops: PriorityStopSettings): PriorityStopSettings {
  return seat.remoteSlot === undefined || stops.fullControl ? stops : { ...stops, fullControl: true };
}

/**
 * Where a remote friend's OWN turn pauses for them (the host's grid is the host's own preference): both main phases and the declare attackers step on
 * their turn, and every opponent's turn is covered by the always-on response windows. `seatIndex` is the friend's index in the seat order.
 */
export function remoteTurnStopSettings(seatIndex: number): PriorityStopSettings {
  const phaseStops: Record<string, boolean> = {};
  for (const phase of ["precombat main phase", "declare attackers step", "postcombat main phase"] as const) phaseStops[stopKey(phase, seatIndex)] = true;
  return { phaseStops, stopOnStackResponse: true, stopOnAttacked: true, stopOnTargeted: true, stopOnChoicePrompt: true, fullControl: false };
}

