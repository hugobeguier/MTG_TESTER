// Milestone 1 plumbing smoke test (see the self-play plan) — proves a full headless game can now
// run end-to-end using the exports/hoists made in AppFlow.tsx, without crashing. It is deliberately
// NOT a real self-play engine: the main-phase decision point always just passes/ends turn (never
// actually casts a card), there is no ollamaBrain, no audit layer, and no CLI. Those are later
// milestones. A game reaching the internal-turn cap without throwing is an acceptable pass; an
// actual winner is a bonus, not a requirement (see the loop's assertions below).
//
// Note on runPhaseActions: AppFlow.tsx's own nested runPhaseActions could NOT be hoisted as-is for
// this test to call directly — it transitively calls advanceSagaLoreCounters, which (via
// triggerSagaChapter) can schedule window.setTimeout callbacks into component-scoped
// queueCommonTriggers/consultRulesAdvisor closures that touch React state. See the milestone 1
// report for the full explanation. applyPhaseActions below is a thin, test-local mirror of
// runPhaseActions' per-phase dispatch built only from the primitives that WERE safely hoisted and
// exported (untapForSeat, resolvePendingUpkeepDraws, drawForSeat, resolveCombatDamage,
// cleanupCombat); it intentionally omits the Saga-lore-counter step, which is fine here since none
// of these decklists' cards resolve to a real "Saga" typeLine without the real Scryfall-backed card
// catalog (data/commander-cards.json is not checked into the repo; loadCardCatalog() falls back to
// a small builtin set with no Sagas in it, and unmatched card names get a generic mock typeLine —
// see createVisibleFromDeckCard/fallbackTypeLineForCard in AppFlow.tsx).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyDeckToSeat,
  cleanupCombat,
  drawForSeat,
  legalMainPhaseActions,
  resolveAgentMulligans,
  resolveCombatDamage,
  resolvePendingUpkeepDraws,
  rollForStartingSeat,
  runStateBasedActionsPass,
  untapForSeat,
  withOpeningHand
} from "@/components/AppFlow";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import { createDeckFromList } from "@/lib/deckParser";
import { TURN_PHASES } from "@/lib/priorityStops";
import type { GameSession, PlayerSeat } from "@/lib/types";

type TurnPhase = (typeof TURN_PHASES)[number];

function readRootDeckList(fileName: string): string {
  return readFileSync(path.join(process.cwd(), fileName), "utf8");
}

function buildBareSeat(id: string, name: string): PlayerSeat {
  return {
    id,
    name,
    kind: "agent",
    life: 40,
    commanderDamage: {},
    zones: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield: [] }
  };
}

// Mirrors AppFlow.tsx's nested runPhaseActions' per-phase dispatch, but built only from the
// primitives this milestone was actually able to hoist and export — see the file header comment for
// why runPhaseActions itself and advanceSagaLoreCounters were left in place instead.
function applyPhaseActions(session: GameSession, seatId: string, phase: TurnPhase): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  if (phase === "untap step") return untapForSeat(session, seatId);
  if (phase === "upkeep step") return resolvePendingUpkeepDraws(session);
  if (phase === "draw step") return drawForSeat(session, seatId, `${seat.name} draws for turn.`);
  if (phase === "combat damage step") return resolveCombatDamage(session, seatId);
  if (phase === "end of combat step") return cleanupCombat(session, seatId);
  return session;
}

describe("selfplay smoke test (milestone 1 plumbing)", () => {
  it("runs a heuristic-vs-heuristic game to a winner or a turn cap, without crashing", () => {
    // deckParser's createDeckFromList wants a DeckCardLookup ({ lookup(name) }), not the raw
    // CardCatalog shape cardCatalog.ts's loadCardCatalog() returns (a { byName: Map } object plus
    // the standalone lookupCard(catalog, name) helper) — same adapter app/api/decks/build/route.ts
    // uses.
    const rawCatalog = loadCardCatalog();
    const catalog = { lookup: (name: string) => lookupCard(rawCatalog, name) };

    const deckA = createDeckFromList({ owner: "seat-a", deckList: readRootDeckList("Meren.txt"), catalog });
    const deckB = createDeckFromList({ owner: "seat-b", deckList: readRootDeckList("UrDragon.txt"), catalog });

    const seatA = applyDeckToSeat(buildBareSeat("seat-a", "Meren Player"), deckA);
    const seatB = applyDeckToSeat(buildBareSeat("seat-b", "Ur-Dragon Player"), deckB);

    const openingSeats = [seatA, seatB].map((seat) => withOpeningHand(seat, 7, 0));
    const { seats: mulliganedSeats } = resolveAgentMulligans(openingSeats);
    const { winnerId: firstSeatId } = rollForStartingSeat(mulliganedSeats);

    let session: GameSession = {
      id: "selfplay-smoke-test",
      createdAt: new Date().toISOString(),
      status: "playing",
      activePlayerId: firstSeatId,
      phase: TURN_PHASES[0],
      turn: 1,
      xmage: { enabled: false, status: "not_configured", message: "" },
      seats: mulliganedSeats,
      events: []
    };

    // A "real turn" here is one lap through TURN_PHASES for ONE seat (matches GameSession.turn's own
    // internal per-seat counting, documented on resolvePhaseAdvance in AppFlow.tsx) — 50 real turns
    // for 2 seats is 100 internal turns; comfortably over-provisioned so a plumbing hang shows up as
    // an assertion failure well before any real timeout.
    const REAL_TURN_CAP_PER_SEAT = 50;
    const INTERNAL_TURN_CAP = REAL_TURN_CAP_PER_SEAT * session.seats.length;

    let internalTurns = 0;
    let phaseIndex = 0;
    let activeIndex = Math.max(0, session.seats.findIndex((seat) => seat.id === firstSeatId));

    while (session.status !== "complete" && internalTurns < INTERNAL_TURN_CAP) {
      const phase = TURN_PHASES[phaseIndex];
      const activeSeat = session.seats[activeIndex];
      session = { ...session, phase, activePlayerId: activeSeat.id };

      session = applyPhaseActions(session, activeSeat.id, phase);
      session = runStateBasedActionsPass(session).session;
      if (session.status === "complete") break;

      if (phase === "precombat main phase" || phase === "postcombat main phase") {
        const currentActiveSeat = session.seats.find((seat) => seat.id === activeSeat.id);
        expect(currentActiveSeat).toBeDefined();
        // Milestone 1 only needs to prove the enumerator + loop plumbing works end-to-end — no real
        // play logic yet (that's the orchestrator's job in a later milestone). Always "pass"/"end
        // turn": legalMainPhaseActions unconditionally appends both, so this never throws.
        const actions = legalMainPhaseActions(currentActiveSeat!, false, activeSeat.id, session.turn, new Set(), session);
        expect(actions.some((action) => action.actionType === "pass_priority" || action.actionType === "end_turn")).toBe(true);
      }

      phaseIndex += 1;
      if (phaseIndex >= TURN_PHASES.length) {
        phaseIndex = 0;
        activeIndex = (activeIndex + 1) % session.seats.length;
        session = { ...session, turn: session.turn + 1 };
        internalTurns += 1;
      }
    }

    // The actual smoke-test assertion: the loop terminated one of two legitimate ways, and never
    // threw. A real winner is a bonus (asserted below when it happens); hitting the cap cleanly is
    // an acceptable pass on its own, per the milestone 1 plan (this test's decision loop never
    // attacks or casts spells, so in practice it always reaches the cap rather than a winner —
    // expected until a later milestone's orchestrator drives real play).
    expect(["complete", "playing"]).toContain(session.status);
    if (session.status === "complete") {
      expect(session.winnerSeatId).toBeDefined();
      expect(session.seats.some((seat) => seat.id === session.winnerSeatId)).toBe(true);
    } else {
      expect(internalTurns).toBeGreaterThanOrEqual(INTERNAL_TURN_CAP);
    }
  }, 30000);
});
