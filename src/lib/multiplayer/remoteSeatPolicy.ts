// Whether a remote friend's seat can take part in the game flow yet (hold priority, take its own turn). Stage 3 only gives friends mulligan intents:
// they have no way to pass priority, advance a phase or end a turn, so until those intents exist the host must not wait for them.
// The next stage flips this to true; every "wait for the remote seat" decision goes through remoteSeatCanAct so it is a one-line change.
export const remoteSeatsCanAct = false;

/** Can this seat act in the flow right now? Always true for the host's own seat and agents; for a remote seat it follows `remoteSeatsCanAct`. */
export function remoteSeatCanAct(seat: { remoteSlot?: string }, canAct: boolean = remoteSeatsCanAct): boolean {
  return seat.remoteSlot === undefined || canAct;
}
