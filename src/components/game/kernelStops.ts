// Priority stops for a kernel game (plan phase 6): "does THIS priority window interrupt the human, or is it passed for them?"
// Reuses the legacy pure policy (src/lib/priorityStops.ts shouldStopForPriority, src/engine/yieldPolicy.ts) so the settings, the defaults and the stop UI mean the
// same thing in both engines. Pure: reads kernel state + the human's legal actions, never mutates (the controller owns the yield / stop-next flags).
import type { LegalAction } from "@/kernel/engine/legal";
import type { GameState, PlayerId } from "@/kernel/engine/types";
import { legacyPhase } from "@/kernel/integration/toSession";
import { shouldStopForPriority, stopKey, type PriorityStopSettings, type StopReason } from "@/lib/priorityStops";
import { yieldCancelReason, type SeatYield, type YieldMoment } from "@/engine/yieldPolicy";

export type WindowStop = StopReason | "own_turn" | "targeted_me";

export interface WindowVerdict {
  /** true = wait for the human, false = pass / advance for them */
  stop: boolean;
  reason?: WindowStop;
  /** the yield no longer holds (the controller clears it and logs "Yield ended: ...") */
  yieldEnded?: string;
}

const RESPONSE_KINDS = new Set<LegalAction["kind"]>(["castSpell", "activateAbility", "turnFaceUp", "castPrepared"]);

/** does the human have anything to do besides passing and tapping for mana? (a land drop only counts on their own empty-stack turn) */
export function hasResponse(legal: LegalAction[], ownEmptyStack: boolean): boolean {
  return legal.some((a) => (RESPONSE_KINDS.has(a.kind) && !a.isMana) || (ownEmptyStack && a.kind === "playLand"));
}

function targetsMe(s: GameState, human: PlayerId, item: GameState["stack"][number]): boolean {
  for (const part of item.parts) for (const ids of Object.values(part.targets)) for (const id of ids) {
    if (id === human) return true;
    if (id.startsWith("#") && s.objects[id]?.controller === human && s.objects[id]?.zone === "battlefield") return true;
  }
  return false;
}

function beingAttacked(s: GameState, human: PlayerId): boolean {
  return !!s.combat?.attackers.some((a) => a.defender === human || s.objects[a.defender]?.controller === human);
}

export interface WindowInput {
  state: GameState;
  human: PlayerId;
  legal: LegalAction[];
  settings: PriorityStopSettings;
  yielding?: SeatYield;
  /** "Stop Next" is armed and a window has opened since */
  holdOnce: boolean;
}

/** The verdict for the human's current priority window (the caller has already checked that the human holds priority and no decision / declaration is open). */
export function evaluateWindow(i: WindowInput): WindowVerdict {
  const { state: s, human, settings } = i;
  const top = s.stack[s.stack.length - 1];
  const own = s.turn.active === human;
  const seatIndex = s.players.findIndex((p) => p.id === s.turn.active);
  const phase = legacyPhase(s.turn.phase);
  const attacked = beingAttacked(s, human);
  const targeted = !!top && top.controller !== human && targetsMe(s, human, top);

  const moment: YieldMoment = {
    seatId: human, turn: s.turn.number, phase, activeSeatId: s.turn.active, beingAttacked: attacked, fullControl: settings.fullControl, holdOnce: i.holdOnce,
    ...(top ? { pending: { controllerSeatId: top.controller, targetSeatIds: targeted ? [human] : [], sourceName: s.objects[top.sourceId]?.cardName } } : {})
  };
  let yieldEnded: string | undefined;
  if (i.yielding) {
    yieldEnded = yieldCancelReason(i.yielding, moment);
    if (!yieldEnded) return { stop: false };
  }
  const ended = yieldEnded ? { yieldEnded } : {};

  // the human is the target of an opponent's spell / ability: always worth a look (even with nothing to respond with), unless they turned the rule off
  if (targeted && settings.stopOnTargeted) return { stop: true, reason: "targeted_me", ...ended };

  if (i.holdOnce) return { stop: true, reason: "hold_once", ...ended }; // "Stop Next": the very next window opens, response or not
  const ownEmpty = own && !top;
  const response = hasResponse(i.legal, ownEmpty);
  if (ownEmpty) {
    // the human's own steps with nothing on the stack: Full Control and Stop Next always open the window, otherwise the ticked steps (default: both main phases, declare attackers)
    if (settings.fullControl) return { stop: true, reason: "full_control", ...ended };
    if (settings.phaseStops[stopKey(phase, seatIndex)]) return { stop: true, reason: "own_turn", ...ended };
    return { stop: false, ...ended };
  }
  const reason = shouldStopForPriority({
    settings, phase, turnOwnerSeatIndex: seatIndex, actionType: top ? (top.kind === "spell" ? "spell" : "trigger") : "phase",
    actionIsMine: top ? top.controller === human : own, hasLegalResponse: response, isDefendingPlayer: attacked, actionAffectsMe: targeted, holdOnce: i.holdOnce
  });
  return reason ? { stop: true, reason, ...ended } : { stop: false, ...ended };
}
