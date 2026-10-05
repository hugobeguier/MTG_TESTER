// Anomaly review queue — the "other half" of the self-play plan alongside audit.ts's hard
// rules-integrity checks. audit.ts flags things a real game of Magic literally cannot do (that's
// what makes a violation there disqualify a win-rate number outright). This module is softer: it
// pattern-matches known BUG SHAPES that are legal-looking on their own but suspicious in context —
// e.g. a creature silently leaving the battlefield right after entering, with no log entry
// explaining why (the actual shape of a real historical bug: "Darksteel Juggernaut dying on ETB",
// fixed in commit 3a64654 well before this module existed). Findings here are a REVIEW QUEUE, not a
// verdict — expected to have false positives (a hexproof/protection target genuinely can have no
// legal target; a card can leave the battlefield through a phrasing this module doesn't recognize as
// naming it) — feeding a human reviewer's attention at real per-card frequency instead of replacing
// the review.
import type { GameSession } from "@/lib/types";
import type { AuditMeta } from "./audit";

export type AnomalyKind =
  // A permanent left the battlefield this step, but nothing in this step's new log entries mentions
  // it by name — no "destroyed by", "dies", "exiled", "sacrificed", "returned to hand", etc. Usually
  // means a state-based-action-driven death (0 toughness, or similar) that never got a describing
  // event, which is either a missing log line or a symptom of a continuous-effect miscomputation.
  | "silent_battlefield_departure"
  // Same as above, but the permanent had entered the battlefield only a few actions earlier — the
  // specific "dies right after ETB" shape that's shown up as a real bug before.
  | "silent_death_after_etb"
  // A "no legal target" event fired (a cast was refused, or a resolved spell/trigger fizzled) while
  // an opponent has at least one creature on the battlefield right now. Often legitimate
  // (hexproof/protection/shroud can make this a genuinely empty target set) but worth a human glance
  // when it recurs on cards that shouldn't be blanked that easily.
  | "no_legal_target_despite_creature_present";

export interface Anomaly {
  kind: AnomalyKind;
  seatId?: string;
  cardName?: string;
  turn: number;
  phase: string;
  precedingAction: string;
  message: string;
  snapshot: unknown;
}

interface EnteredRecord {
  name: string;
  enteredAtActionIndex: number;
}

export interface AnomalyState {
  anomalies: Anomaly[];
  actionIndex: number;
  enteredAt: Map<string, EnteredRecord>;
}

export function createAnomalyState(): AnomalyState {
  return { anomalies: [], actionIndex: 0, enteredAt: new Map() };
}

// How many afterAction steps count as "shortly after entering" for silent_death_after_etb. Loose on
// purpose — this only affects which of the two AnomalyKind labels a departure gets, not whether it's
// flagged at all (an unexplained departure is always flagged either way).
const RECENT_ETB_WINDOW = 4;

function battlefieldMap(session: GameSession): Map<string, { name: string; seatId: string }> {
  const map = new Map<string, { name: string; seatId: string }>();
  for (const seat of session.seats) {
    for (const card of seat.board.battlefield) {
      map.set(card.id, { name: card.name, seatId: seat.id });
    }
  }
  return map;
}

function snapshotFor(session: GameSession, seatId?: string) {
  return {
    turn: session.turn,
    phase: session.phase,
    seats: session.seats.map((seat) => ({ id: seat.id, name: seat.name, life: seat.life, battlefieldSize: seat.board.battlefield.length })),
    focusSeatId: seatId
  };
}

function pushAnomaly(state: AnomalyState, session: GameSession, meta: AuditMeta, kind: AnomalyKind, seatId: string | undefined, cardName: string | undefined, message: string) {
  state.anomalies.push({
    kind,
    seatId,
    cardName,
    turn: meta.turn,
    phase: meta.phase,
    precedingAction: meta.cardId ? `${meta.actionType}:${meta.cardId}` : meta.actionType,
    message,
    snapshot: snapshotFor(session, seatId)
  });
}

// The single entry point, mirroring audit.ts's auditAfterAction — called with the SAME (prev, next,
// meta) triple the orchestrator already captures around every individual action, so a departure or
// "no legal target" event here is attributable to exactly one action, not a whole phase's worth.
export function scanForAnomalies(state: AnomalyState, prev: GameSession, next: GameSession, meta: AuditMeta): Anomaly[] {
  const before = state.anomalies.length;
  state.actionIndex += 1;

  const prevBattlefield = battlefieldMap(prev);
  const nextBattlefield = battlefieldMap(next);

  // session.events is prepended (newest first — see orchestrator.ts's own `events: [newEvent,
  // ...working.events]`), so the entries added this step are exactly the leading slice by however
  // much longer next.events got.
  const addedEventCount = Math.max(0, next.events.length - prev.events.length);
  const newEvents = next.events.slice(0, addedEventCount);
  const newEventText = newEvents.map((event) => `${event.message} ${event.detail ?? ""}`).join(" \n ");

  for (const [cardId, info] of nextBattlefield) {
    if (!prevBattlefield.has(cardId)) {
      state.enteredAt.set(cardId, { name: info.name, enteredAtActionIndex: state.actionIndex });
    }
  }

  for (const [cardId, info] of prevBattlefield) {
    if (nextBattlefield.has(cardId)) continue;
    // A Treasure (or any sacrifice-for-mana source) spent to pay for the action leaves the battlefield
    // by design, with nothing logged by name — the action's own mana payment already accounts for it.
    if (meta.manaPayment?.sourceIds.includes(cardId)) continue;
    // Rule 800.4a: when a player loses, everything they control leaves with them — the one "X loses the
    // game" event explains all of it, so those departures aren't individually logged by name.
    if (next.seats.find((seat) => seat.id === info.seatId)?.hasLost) continue;
    // Lenient by design: matching the card's NAME anywhere in this step's new events (not a specific
    // verb) covers destroy/exile/bounce/sacrifice/control-change phrasing without hardcoding every
    // template AppFlow.tsx uses. Known false-negative: two same-named permanents where only one's
    // departure is actually logged would suppress a flag on the other — acceptable for a review-queue
    // heuristic, not a hard check.
    if (newEventText.includes(info.name)) continue;
    const entered = state.enteredAt.get(cardId);
    const actionsSinceEntry = entered ? state.actionIndex - entered.enteredAtActionIndex : undefined;
    const recentlyEntered = actionsSinceEntry !== undefined && actionsSinceEntry <= RECENT_ETB_WINDOW;
    pushAnomaly(
      state,
      next,
      meta,
      recentlyEntered ? "silent_death_after_etb" : "silent_battlefield_departure",
      info.seatId,
      info.name,
      `${info.name} left the battlefield during "${meta.actionType}" with no new event naming it this step` +
        (recentlyEntered ? ` — it had entered the battlefield only ${actionsSinceEntry} action(s) earlier.` : ".")
    );
  }

  if (/no legal target/i.test(newEventText)) {
    const actingSeatId = meta.seatId;
    const opponentHasCreature = next.seats.some(
      (seat) => seat.id !== actingSeatId && seat.board.battlefield.some((card) => card.typeLine.includes("Creature") || card.grantedTypes?.includes("Creature"))
    );
    if (opponentHasCreature) {
      const triggeringEvent = newEvents.find((event) => /no legal target/i.test(event.message));
      pushAnomaly(
        state,
        next,
        meta,
        "no_legal_target_despite_creature_present",
        actingSeatId,
        undefined,
        `"${triggeringEvent?.message ?? "(no legal target)"}" fired while an opponent has a creature on the battlefield — could be a legitimate hexproof/protection miss, worth a glance if it recurs.`
      );
    }
  }

  return state.anomalies.slice(before);
}
