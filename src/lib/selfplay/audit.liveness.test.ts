// Regression coverage for the false-positive fixed alongside this file: auditLiveness's fingerprint
// didn't include blockDecided, so a defender legitimately resolving "no blockers" one attacker at a
// time in a wide combat (more attackers than the repeat threshold) looked identical every time and
// tripped a false "stall" — see auditLiveness's own comment for the live repro this came from.
import { describe, expect, it } from "vitest";
import { auditAfterAction, createAuditState, type AuditMeta } from "./audit";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

function attacker(id: string, blockDecided: boolean): VisibleCard {
  return {
    id,
    name: id,
    typeLine: "Creature — Bear",
    oracleText: "",
    manaValue: 0,
    colors: [],
    role: "permanent",
    zone: "battlefield",
    tapped: true,
    attacking: true,
    blocking: false,
    blockDecided
  };
}

function seat(id: string, battlefield: VisibleCard[]): PlayerSeat {
  return {
    id,
    name: id,
    kind: "agent",
    life: 40,
    commanderDamage: {},
    zones: { library: 0, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield }
  };
}

function sessionWithDecidedCount(decidedCount: number, totalAttackers: number): GameSession {
  const attackers = Array.from({ length: totalAttackers }, (_, index) => attacker(`attacker-${index}`, index < decidedCount));
  return {
    id: "test",
    createdAt: "",
    status: "playing",
    phase: "declare blockers step",
    turn: 15,
    xmage: { enabled: false, status: "not_configured", message: "" },
    seats: [seat("attacker-seat", attackers), seat("defender-seat", [])],
    events: []
  };
}

const meta: AuditMeta = { seatId: "defender-seat", turn: 15, phase: "declare blockers step", actionType: "block" };

describe("auditLiveness — blockDecided must be part of the fingerprint", () => {
  it("does not flag a wide combat where each attacker legitimately resolves to no-blockers in turn", () => {
    const state = createAuditState(sessionWithDecidedCount(0, 6));
    let violations = 0;
    // Each call is a DIFFERENT attacker's real resolution — tapped/attacking/blocking never change
    // for a "no blockers" decision, only blockDecided, one more card at a time.
    for (let decided = 1; decided <= 6; decided += 1) {
      const session = sessionWithDecidedCount(decided, 6);
      violations += auditAfterAction(state, session, meta).length;
    }
    expect(violations).toBe(0);
  });

  it("still flags a genuine stall where the session truly never changes", () => {
    const session = sessionWithDecidedCount(2, 6);
    const state = createAuditState(session);
    let violations = 0;
    // The first call only establishes the baseline fingerprint (no repeat yet); the violation fires
    // once repeats reaches 5, i.e. on the 6th identical call.
    for (let i = 0; i < 6; i += 1) {
      violations += auditAfterAction(state, session, meta).length;
    }
    expect(violations).toBe(1);
  });
});
