// View model of the turn / phase / priority indicator on the table. Pure: inputs are ids and counts from either engine (legacy GameSession + props, or the
// kernel TableState), output is exactly what TurnIndicator renders, so the rules about "who is waiting for whom" are testable without React.
import { TURN_PHASES } from "@/lib/priorityStops";

export interface IndicatorSeat { id: string; name: string; kind?: string; hasLost?: boolean; life?: number }
export interface IndicatorInput {
  seats: IndicatorSeat[];
  humanSeatId?: string;
  activeSeatId?: string;
  prioritySeatId?: string;
  /** legacy phase string ("combat damage step") or a kernel phase id ("first_strike_damage") */
  phase: string;
  /** the number players see (round-style, see lib/turnNumber.ts) */
  turnNumber: number;
  /** the engine's own count of every player's turn, shown only as a tooltip */
  globalTurn?: number;
  stackSize: number;
  /** a seat that owes a decision (a choice or an attack / block declaration) */
  pendingDecisionSeatId?: string;
  pendingKind?: "choice" | "attackers" | "blockers";
  gameOver?: boolean;
}

export type SeatMarker = "active" | "priority" | "both" | "none";
export interface SeatChip { id: string; name: string; isHuman: boolean; eliminated: boolean; marker: SeatMarker; active: boolean; priority: boolean; label: string }
export interface PhaseCell { id: string; label: string; state: "past" | "current" | "future" }
export interface IndicatorView {
  banner: string;
  /** tooltip / aria detail for the banner (the engine's global turn count), when known */
  bannerTitle?: string;
  bannerSeatId?: string;
  seats: SeatChip[];
  phases: PhaseCell[];
  phaseLabel: string;
  /** the one-line status; `tone` drives colour and the pulse (humanPriority) */
  status: string;
  stackLine?: string;
  humanPriority: boolean;
  /** polite live-region text: only changes when somebody else's turn / priority / decision changes */
  announcement: string;
}

const LABEL: Record<string, string> = {
  "untap step": "Untap", "upkeep step": "Upkeep", "draw step": "Draw", "precombat main phase": "Main 1", "beginning of combat step": "Begin Combat",
  "declare attackers step": "Attackers", "declare blockers step": "Blockers", "first strike damage step": "First Strike", "combat damage step": "Damage",
  "end of combat step": "End Combat", "postcombat main phase": "Main 2", "end step": "End", "cleanup step": "Cleanup"
};
const FULL: Record<string, string> = {
  "untap step": "Untap step", "upkeep step": "Upkeep step", "draw step": "Draw step", "precombat main phase": "First main phase", "beginning of combat step": "Beginning of combat",
  "declare attackers step": "Declare attackers", "declare blockers step": "Declare blockers", "first strike damage step": "First-strike damage", "combat damage step": "Combat damage",
  "end of combat step": "End of combat", "postcombat main phase": "Second main phase", "end step": "End step", "cleanup step": "Cleanup step"
};
const KERNEL_TO_LEGACY: Record<string, string> = {
  untap: "untap step", upkeep: "upkeep step", draw: "draw step", main: "precombat main phase", precombat_main: "precombat main phase", beginning_of_combat: "beginning of combat step",
  combat: "beginning of combat step", declare_attackers: "declare attackers step", declare_blockers: "declare blockers step", first_strike_damage: "first strike damage step",
  combat_damage: "combat damage step", end_of_combat: "end of combat step", postcombat_main: "postcombat main phase", end_step: "end step", cleanup: "cleanup step"
};

/** any phase spelling -> the canonical id used by the track ("first strike damage step" is the one id the legacy list lacks) */
export function normalizePhase(phase: string): string {
  const p = phase.trim().toLowerCase();
  return KERNEL_TO_LEGACY[p] ?? p;
}

/** the track: the 12 steps, with the first-strike step slotted before combat damage only while it is the current step */
export function phaseTrack(phase: string): PhaseCell[] {
  const cur = normalizePhase(phase);
  const ids: string[] = TURN_PHASES.flatMap((p) => (p === "combat damage step" && cur === "first strike damage step" ? ["first strike damage step", p] : [p]));
  const at = ids.indexOf(cur);
  return ids.map((id, i) => ({ id, label: LABEL[id] ?? id, state: at < 0 ? "future" : i < at ? "past" : i === at ? "current" : "future" }));
}

export function buildIndicatorView(i: IndicatorInput): IndicatorView {
  const nameOf = (id?: string) => i.seats.find((s) => s.id === id)?.name ?? "Someone";
  const mine = (id?: string) => id !== undefined && id === i.humanSeatId;
  const who = (id?: string) => (mine(id) ? "You" : nameOf(id));
  const seats: SeatChip[] = i.seats.map((s) => {
    const active = s.id === i.activeSeatId;
    const priority = s.id === i.prioritySeatId;
    const marker: SeatMarker = active && priority ? "both" : active ? "active" : priority ? "priority" : "none";
    const eliminated = !!s.hasLost || (s.life !== undefined && s.life <= 0);
    const label = `${s.name}${mine(s.id) ? " (you)" : ""}${eliminated ? ", eliminated" : ""}${active ? ", active player" : ""}${priority ? ", has priority" : ""}`;
    return { id: s.id, name: s.name, isHuman: mine(s.id), eliminated, marker, active, priority, label };
  });
  const phaseId = normalizePhase(i.phase);
  const phaseLabel = FULL[phaseId] ?? i.phase;
  const banner = i.activeSeatId ? `Turn ${i.turnNumber} - ${mine(i.activeSeatId) ? "Your turn" : `${nameOf(i.activeSeatId)}'s turn`}` : `Turn ${i.turnNumber}`;
  const humanPriority = !i.gameOver && !i.pendingDecisionSeatId && mine(i.prioritySeatId);
  let status: string;
  if (i.gameOver) status = "Game over";
  else if (i.pendingDecisionSeatId) {
    const verb = i.pendingKind === "attackers" ? "declare attackers" : i.pendingKind === "blockers" ? "declare blockers" : "choose";
    status = mine(i.pendingDecisionSeatId) ? `Your choice: ${verb}` : `Waiting for ${nameOf(i.pendingDecisionSeatId)} to ${verb}`;
  } else if (i.prioritySeatId === undefined) status = "Resolving...";
  else status = mine(i.prioritySeatId) ? "Your priority" : `Waiting for ${nameOf(i.prioritySeatId)} (priority)`;
  const stackLine = i.stackSize > 0
    ? `Stack: ${i.stackSize} item${i.stackSize === 1 ? "" : "s"}${i.prioritySeatId && !i.pendingDecisionSeatId ? ` - ${who(i.prioritySeatId)} must respond or pass` : ""}`
    : undefined;
  return {
    banner, ...(i.globalTurn !== undefined ? { bannerTitle: `Round ${i.turnNumber}; ${i.globalTurn} player turn${i.globalTurn === 1 ? "" : "s"} played so far (every player's turn counts once)` } : {}), bannerSeatId:i.activeSeatId, seats, phases: phaseTrack(i.phase), phaseLabel, status, stackLine, humanPriority,
    announcement: i.gameOver ? "Game over" : `${banner}. ${phaseLabel}. ${status}.${stackLine ? ` ${stackLine}.` : ""}`
  };
}
