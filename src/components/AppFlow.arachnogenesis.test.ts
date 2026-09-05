import { describe, expect, it } from "vitest";
import { countCreaturesAttackingSeat, parseCreateTokenSpecs } from "./AppFlow";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const ARACHNOGENESIS_ORACLE_TEXT =
  "Create X 1/2 green Spider creature tokens with reach, where X is the number of creatures attacking you. Prevent all combat damage that would be dealt this turn by non-Spider creatures.";

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "typeLine">): VisibleCard {
  return { oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "battlefield", ...overrides };
}

function seat(overrides: Partial<PlayerSeat> & Pick<PlayerSeat, "id" | "name" | "kind">): PlayerSeat {
  return {
    life: 40,
    commanderDamage: {},
    zones: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield: [] },
    ...overrides
  };
}

function session(seats: PlayerSeat[]): GameSession {
  return {
    id: "test",
    createdAt: "",
    status: "playing",
    phase: "declare attackers step",
    turn: 1,
    xmage: { enabled: false, status: "not_configured", message: "" },
    seats,
    events: []
  };
}

describe("parseCreateTokenSpecs — Arachnogenesis's \"where X is the number of creatures attacking you\"", () => {
  it("yields a spec sized by attackersTargetingCount, with clean oracle text (no 'where X is...' leak)", () => {
    const specs = parseCreateTokenSpecs(ARACHNOGENESIS_ORACLE_TEXT, undefined, undefined, undefined, 3);
    expect(specs).toHaveLength(1);
    expect(specs[0].count).toBe(3);
    expect(specs[0].oracleText.toLowerCase()).not.toContain("where x is");
    expect(specs[0].oracleText.toLowerCase()).toContain("reach");
  });

  it("declines (rather than guesses) with no attackersTargetingCount available", () => {
    expect(parseCreateTokenSpecs(ARACHNOGENESIS_ORACLE_TEXT)).toEqual([]);
  });
});

describe("countCreaturesAttackingSeat", () => {
  it("counts only attackers whose target is the named seat itself", () => {
    const defender = seat({ id: "defender", name: "You", kind: "human" });
    const attacker1 = card({ id: "a1", name: "Attacker 1", typeLine: "Creature — Bear", attacking: true, attackTargetId: "defender" });
    const attacker2 = card({ id: "a2", name: "Attacker 2", typeLine: "Creature — Bear", attacking: true, attackTargetId: "defender" });
    const nonAttacker = card({ id: "a3", name: "Non-attacker", typeLine: "Creature — Bear", attacking: false });
    const attackingSeat = seat({ id: "attacker-seat", name: "Malik", kind: "agent", board: { hand: [], battlefield: [attacker1, attacker2, nonAttacker] } });
    expect(countCreaturesAttackingSeat(session([defender, attackingSeat]), "defender")).toBe(2);
  });

  it("does not count an attacker targeting a planeswalker the seat controls", () => {
    const defender = seat({ id: "defender", name: "You", kind: "human", board: { hand: [], battlefield: [card({ id: "pw", name: "Some Planeswalker", typeLine: "Planeswalker", loyalty: "5" })] } });
    const attacker = card({ id: "a1", name: "Attacker", typeLine: "Creature — Bear", attacking: true, attackTargetId: "pw" });
    const attackingSeat = seat({ id: "attacker-seat", name: "Malik", kind: "agent", board: { hand: [], battlefield: [attacker] } });
    expect(countCreaturesAttackingSeat(session([defender, attackingSeat]), "defender")).toBe(0);
  });

  it("does not count attackers targeting a different seat", () => {
    const defender = seat({ id: "defender", name: "You", kind: "human" });
    const otherSeat = seat({ id: "other", name: "Sable", kind: "agent" });
    const attacker = card({ id: "a1", name: "Attacker", typeLine: "Creature — Bear", attacking: true, attackTargetId: "other" });
    const attackingSeat = seat({ id: "attacker-seat", name: "Malik", kind: "agent", board: { hand: [], battlefield: [attacker] } });
    expect(countCreaturesAttackingSeat(session([defender, otherSeat, attackingSeat]), "defender")).toBe(0);
  });
});
