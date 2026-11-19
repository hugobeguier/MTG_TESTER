// "Yield until end of turn" (Arena/MTGO style): a human seat that has yielded is treated as passing every priority window (its own turn and the opponents')
// until the end step of the turn it was started in, so it is not asked to pass "no responses" over and over. Pure and GameSession-free: priority.ts feeds it
// plain facts per window (canReceivePriorityForPendingAction) and the yield effect (components/game/useSeatYield.ts) feeds it the same facts to clear the
// state, so the two can never disagree. It only ever REMOVES prompts: a choice prompt (targets, discards, blocks ...) is not a priority window and is never
// touched by it. Per seat, never persisted, never sent to anyone else: a friend's yield reaches only that friend's snapshot (as `myYield`).

/** One seat's active yield: the turn (number + whose turn) it was started in. */
export interface SeatYield {
  turn: number;
  activeSeatId?: string;
}

/** Seat id -> yield, for the seats currently yielding. Host side only (like `PriorityStopSettings.bySeat`). */
export type YieldMap = Record<string, SeatYield>;

/** From these steps on, the turn is over for a yielding seat (it is asked again for the end step and cleanup). */
const YIELD_ENDING_PHASES = ["end step", "cleanup step"];

/** The facts about one priority window (or just the current game moment) that decide whether a yield still holds for `seatId`. */
export interface YieldMoment {
  seatId: string;
  turn: number;
  phase: string;
  activeSeatId?: string;
  /** Attackers are declared against this seat or its planeswalkers/battles. */
  beingAttacked: boolean;
  /** Full Control or a one-shot "Stop Next" is set for this seat: the player asked to be stopped. */
  fullControl: boolean;
  holdOnce: boolean;
  /** The newest spell/ability on the stack, when there is one: who controls it and which seats it targets (the seat itself, its permanents or cards). */
  pending?: { controllerSeatId: string; targetSeatIds: string[]; sourceName?: string };
}

/** Why the yield no longer applies right now (shown in the log as "Yield ended: ..."), or undefined while it still holds. */
export function yieldCancelReason(seatYield: SeatYield, moment: YieldMoment): string | undefined {
  if (seatYield.turn !== moment.turn || (seatYield.activeSeatId !== undefined && moment.activeSeatId !== undefined && seatYield.activeSeatId !== moment.activeSeatId)) return "the turn ended";
  if (YIELD_ENDING_PHASES.includes(moment.phase)) return "the end step began";
  if (moment.fullControl) return "Full Control is on";
  if (moment.holdOnce) return "Stop Next was pressed";
  if (moment.beingAttacked) return "you are being attacked";
  const pending = moment.pending;
  if (pending && pending.controllerSeatId !== moment.seatId && pending.targetSeatIds.includes(moment.seatId)) return `${pending.sourceName ?? "an opponent's spell or ability"} targets you`;
  return undefined;
}

/** True when this window is passed on the seat's behalf (the yield holds). */
export function yieldAutoPasses(seatYield: SeatYield | undefined, moment: YieldMoment): boolean {
  return seatYield !== undefined && yieldCancelReason(seatYield, moment) === undefined;
}

/** Click on the button: starts a yield for the current turn, or cancels the running one. Returns `yields` unchanged-by-reference never; always a new map. */
export function toggleYield(yields: YieldMap, seatId: string, turn: number, activeSeatId: string | undefined): YieldMap {
  if (yields[seatId]) {
    const { [seatId]: _removed, ...rest } = yields;
    return rest;
  }
  return { ...yields, [seatId]: { turn, activeSeatId } };
}

/** Drops the given seats' yields. Returns `yields` itself when none of them is in it (so a state update can bail out). */
export function withoutYields(yields: YieldMap, seatIds: string[]): YieldMap {
  if (!seatIds.some((id) => yields[id])) return yields;
  return Object.fromEntries(Object.entries(yields).filter(([id]) => !seatIds.includes(id)));
}
