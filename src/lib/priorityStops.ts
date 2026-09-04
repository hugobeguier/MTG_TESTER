// Spec Phase 5a §2 (mtg-commander-engine-spec.md) — the per-player "when do I actually want to be
// interrupted" preference object. AppFlow.tsx's canReceivePriorityForPendingAction already answers
// "could this seat respond at all" (affordability-aware: instants/flash in hand, free or paid
// activated abilities, simulated mana-tapping); this module is layered on top of that and only ever
// REMOVES a stop that would otherwise fire — it never invents a response that isn't legal. Kept
// pure and GameSession-free (booleans only) so it can't drift into duplicating rules logic that
// already lives in AppFlow.tsx, and so it's trivially unit-testable.

// The 12 canonical turn steps (rule 500.1) — single source of truth shared by AppFlow.tsx's own
// phase-advance logic and ThreeGameTable's PriorityStopsModal grid, so the two can't drift apart the
// way two independently-maintained copies eventually would. Lives here (a lib module) rather than in
// either component file specifically to avoid a circular import: AppFlow.tsx imports ThreeGameTable,
// so ThreeGameTable importing anything back from AppFlow.tsx would be circular.
export const TURN_PHASES = [
  "untap step",
  "upkeep step",
  "draw step",
  "precombat main phase",
  "beginning of combat step",
  "declare attackers step",
  "declare blockers step",
  "combat damage step",
  "end of combat step",
  "postcombat main phase",
  "end step",
  "cleanup step"
] as const;

export type StopReason = "phase_stop" | "full_control" | "hold_once" | "stack_response" | "attacked" | "targeted";

export interface PriorityStopSettings {
  // Keyed by stopKey(phase, turnOwnerSeatIndex) -> true. Seat INDEX, not seat id — ids are
  // regenerated every new game, so id-keyed settings wouldn't survive starting a fresh session.
  phaseStops: Record<string, boolean>;
  // Something is on the stack (a spell/trigger, not a bare phase-pass) that isn't my own action.
  stopOnStackResponse: boolean;
  // I'm the defending player this combat.
  stopOnAttacked: boolean;
  // The pending action targets/affects me or my permanents.
  stopOnTargeted: boolean;
  // Suspend all auto-passing — every window opens, exactly like today's behavior.
  fullControl: boolean;
}

export function stopKey(phase: string, turnOwnerSeatIndex: number): string {
  return `${turnOwnerSeatIndex}:${phase}`;
}

// This app is always exactly one human seat (index 0) plus three agent seats (indices 1-3) — see
// the setup screen's own "One human plus three AI seats" copy — so the default grid can hardcode
// "every agent seat" as indices 1-3 rather than needing the actual seat list at settings-creation
// time (DEFAULT_STOP_SETTINGS is a plain module-level constant, computed before any session exists).
const AGENT_SEAT_INDICES = [1, 2, 3];

// Play-focused default (per user preference): stops where a decision almost always exists, nothing
// else. The smart-pass rules below (stopOnStackResponse/stopOnAttacked/stopOnTargeted) still catch
// anything urgent on the untouched phases/turns.
function defaultPhaseStops(): Record<string, boolean> {
  const stops: Record<string, boolean> = {
    [stopKey("precombat main phase", 0)]: true,
    [stopKey("declare attackers step", 0)]: true,
    [stopKey("postcombat main phase", 0)]: true
  };
  for (const seatIndex of AGENT_SEAT_INDICES) {
    stops[stopKey("declare blockers step", seatIndex)] = true;
    stops[stopKey("end step", seatIndex)] = true;
  }
  return stops;
}

export const DEFAULT_STOP_SETTINGS: PriorityStopSettings = {
  phaseStops: defaultPhaseStops(),
  stopOnStackResponse: true,
  stopOnAttacked: true,
  stopOnTargeted: true,
  fullControl: false
};

export interface ShouldStopInput {
  settings: PriorityStopSettings;
  phase: string;
  // Seat index of whoever's turn this is (the active player), not the seat being asked.
  turnOwnerSeatIndex: number;
  actionType: "phase" | "spell" | "trigger";
  // True when the pending action's own actor/controller is the seat being asked (rule 117.3b: you
  // get first crack at your own action, but that's not itself a reason to force a stop).
  actionIsMine: boolean;
  // Whether canReceivePriorityForPendingAction's existing affordability check found a real response
  // (an instant/flash card the seat can pay for, or a usable activated ability, free or paid).
  hasLegalResponse: boolean;
  isDefendingPlayer: boolean;
  actionAffectsMe: boolean;
  // One-shot "stop me on the very next window" flag — cleared by the caller after use.
  holdOnce: boolean;
}

// The single source of truth for "does this priority window actually interrupt the player". Returns
// undefined when it should auto-pass instead.
export function shouldStopForPriority(input: ShouldStopInput): StopReason | undefined {
  // Never stop for a response that doesn't exist — this policy only ever removes stops that
  // canReceivePriorityForPendingAction's own affordability check would otherwise have opened.
  if (!input.hasLegalResponse) return undefined;
  if (input.settings.fullControl) return "full_control";
  if (input.holdOnce) return "hold_once";
  // Checked BEFORE the "my own phase-pass" exemption below: entering a ticked phase (e.g. your own
  // precombat main phase) IS a bare phase-pass action of your own — if the exemption ran first it
  // would swallow every phase stop on your own turn and the grid would do nothing at all.
  if (input.settings.phaseStops[stopKey(input.phase, input.turnOwnerSeatIndex)]) return "phase_stop";
  // A bare phase-pass action of your own, into an UNticked phase (you just clicked Advance Phase /
  // your turn auto-advanced to it) handing priority straight back to you isn't a real decision point
  // on its own.
  if (input.actionType === "phase" && input.actionIsMine) return undefined;
  if (input.settings.stopOnStackResponse && input.actionType !== "phase" && !input.actionIsMine) return "stack_response";
  if (input.settings.stopOnAttacked && input.isDefendingPlayer) return "attacked";
  if (input.settings.stopOnTargeted && input.actionAffectsMe) return "targeted";
  return undefined;
}
