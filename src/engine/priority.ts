// Priority-policy helpers, extracted from components/AppFlow.tsx (see docs/ARCHITECTURE.md section 5).
// Owns: who is required to pass on a pending action (rule 117.3b actor-first ordering), who receives priority next,
// whether resolving an action will prompt a human seat, and the stack-entry note for that.
// The "can this seat get a priority window" predicate (canReceivePriorityForPendingAction) still lives in AppFlow.tsx
// because it depends on the legal-actions cluster; it is injected as the `canReceivePriority` argument, and AppFlow.tsx keeps
// same-signature wrappers (pendingActionRequiredPasses / nextPrioritySeatId) so existing callers are unchanged.

import type { GameSession, PlayerSeat } from "@/lib/types";
import type { PendingAction } from "@/engine/types";

export type CanReceivePriority = (seat: PlayerSeat, action: PendingAction) => boolean;

export function findSpellSourceCard(session: GameSession, action: Extract<PendingAction, { type: "spell" }>) {
  const actor = session.seats.find((seat) => seat.id === action.actorSeatId);
  return action.sourceZone === "command"
    ? actor?.board.commander
    : action.sourceZone === "exile"
      ? actor?.board.exile?.find((card) => card.id === action.cardId)
      : action.sourceZone === "graveyard"
        ? actor?.board.graveyard?.find((card) => card.id === action.cardId)
        : action.sourceZone === "library"
          ? actor?.library?.find((card) => card.id === action.cardId)
          : actor?.board.hand.find((card) => card.id === action.cardId);
}

export function isStackAction(action: PendingAction): action is Extract<PendingAction, { type: "spell" | "trigger" }> {
  return action.type === "spell" || action.type === "trigger";
}

// Rule 117.3b: a player who casts a spell/activates an ability receives priority again
// immediately afterward, before anyone else does — they can hold priority to cast a second spell
// in response to their own first one (the actor used to be structurally excluded here, so the
// caster of a spell could never respond to it themselves; fixed by including them like anyone
// else who's able to act, with nextPrioritySeatId giving them first crack below).
export function pendingActionRequiredPasses(
  seats: PlayerSeat[],
  action: PendingAction,
  canReceivePriority: CanReceivePriority
) {
  if (action.type === "trigger") {
    // An agent's trigger always needs its controller's "pass" (that is how the engine drives it). A HUMAN's own trigger used to
    // demand a manual pass every time; now it asks only when the same stop policy used for spells says to (a real legal
    // response plus a matching stop, or full control / hold-once) and otherwise resolves on its own.
    // Rule 603.3 / 117.4: a trigger on the stack gives EVERY player priority, not just its controller, so every other seat
    // (the human included) is also required whenever the same gate used for spells finds a real legal response for it.
    // This used to return only the agent controller, so an agent's trigger never opened a window for the human. A seat
    // with no response is never added, so a batch of triggers still auto-resolves without a prompt per trigger.
    return seats
      .filter((seat) => {
        // A step's own "at the beginning of ..." trigger (phase_trigger) is the exception: a whole step can have many of them, so its agent
        // controller does not take a pass of its own; the window opens only for a seat with a real response (the fast path resolves the rest).
        if (seat.id === action.controllerSeatId && seat.kind === "agent" && !action.effect.fromPhaseStep) return true;
        return canReceivePriority(seat, action);
      })
      .map((seat) => seat.id);
  }
  return seats
    .filter((seat) => canReceivePriority(seat, action))
    .map((seat) => seat.id);
}

export function nextPrioritySeatId(
  seats: PlayerSeat[],
  actorSeatId: string,
  passes: string[],
  action: PendingAction,
  canReceivePriority: CanReceivePriority
) {
  const required = pendingActionRequiredPasses(seats, action, canReceivePriority);
  // The actor gets first crack at responding to their own action (rule 117.3b) — only once
  // they've passed does priority move on to the rest of the table in turn order.
  if (required.includes(actorSeatId) && !passes.includes(actorSeatId)) return actorSeatId;
  const startIndex = Math.max(0, seats.findIndex((seat) => seat.id === actorSeatId));
  for (let offset = 1; offset <= seats.length; offset += 1) {
    const seat = seats[(startIndex + offset) % seats.length];
    if (required.includes(seat.id) && !passes.includes(seat.id)) return seat.id;
  }
  return actorSeatId;
}

// Whether resolving `action` will open a choice prompt for this (human) seat — the "last chance to respond first" cases the stop policy
// should never skip: an edict-style sacrifice or a discard that names this seat, and the human's own optional / option-picking triggers.
// Deliberately narrow (text patterns for the common shapes, not every possible prompt); a false positive only opens a window the player
// can pass, and it is still gated by the seat having a real legal response.
const EDICT_OR_DISCARD_TEXT = /\b(?:each (?:player|opponent|other player)|target (?:player|opponent)|that player|defending player)\b[^.]*?\b(?:sacrifices?|discards?)\b/i;
export function pendingActionWillPromptSeat(seat: PlayerSeat, action: PendingAction, session: GameSession): boolean {
  if (seat.kind !== "human") return false;
  if (action.type === "spell") {
    const text = findSpellSourceCard(session, action)?.oracleText ?? "";
    if (!text) return false;
    if (EDICT_OR_DISCARD_TEXT.test(text)) return true;
    return action.actorSeatId === seat.id && /\byou sacrifice (?:a|an|one|two|x) /i.test(text);
  }
  if (action.type === "trigger" && action.controllerSeatId === seat.id) {
    return Boolean(action.effect.optional) || action.effect.kind === "put_any_from_hand" || action.effect.kind === "modal";
  }
  return false;
}

// The line shown on a stack entry when resolving it will make this (human) seat choose something, so the player knows this is the moment to
// respond (sacrifice things their own way, cast the instant) — the choice itself only appears once it resolves, and nothing can be done then.
export function resolutionPromptNote(seat: PlayerSeat, action: PendingAction, session: GameSession): string | undefined {
  if (!pendingActionWillPromptSeat(seat, action, session)) return undefined;
  if (action.type === "trigger") return "When this resolves you'll be asked whether to do it. Respond first if you want to.";
  const text = action.type === "spell" ? (findSpellSourceCard(session, action)?.oracleText ?? "") : "";
  if (/\bsacrifices? all\b/i.test(text)) return "When this resolves you sacrifice permanents with no choice. Respond first if you want to deal with them another way.";
  if (/\bsacrifices?\b/i.test(text)) return "When this resolves you must choose what to sacrifice. Respond first to sacrifice things your own way.";
  if (/\bdiscards?\b/i.test(text)) return "When this resolves you must choose what to discard. Respond first if you want to play or use cards.";
  return "When this resolves you'll be asked to choose. Respond first if you want to.";
}
