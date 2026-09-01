import { describe, expect, it } from "vitest";
import { applyPunisherChoiceEffect, parsePunisherChoiceEffect, shouldConsultRulesAdvisor } from "./AppFlow";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

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
    phase: "precombat main phase",
    turn: 1,
    xmage: { enabled: false, status: "not_configured", message: "" },
    seats,
    events: []
  };
}

const TORMENT_OF_HAILFIRE_TEXT =
  "This spell can't be countered.\nRepeat the following process X times. Each opponent loses 3 life unless that player sacrifices a nonland permanent or discards a card.";

describe("shouldConsultRulesAdvisor — inflected 'sacrifice' wording", () => {
  it("recognizes 'sacrifices' (not just the bare infinitive 'sacrifice ')", () => {
    expect(shouldConsultRulesAdvisor("spell_resolved_to_graveyard", card({ id: "c", name: "Torment of Hailfire", typeLine: "Sorcery", oracleText: TORMENT_OF_HAILFIRE_TEXT }))).toBe(true);
  });

  it("still recognizes the bare infinitive 'sacrifice ' as before", () => {
    expect(
      shouldConsultRulesAdvisor("spell_resolved_to_graveyard", card({ id: "c", name: "Test", typeLine: "Sorcery", oracleText: "Each player may sacrifice a permanent." }))
    ).toBe(true);
  });
});

describe("parsePunisherChoiceEffect", () => {
  it("recognizes Torment of Hailfire's real oracle text and extracts the per-iteration life amount", () => {
    expect(parsePunisherChoiceEffect(TORMENT_OF_HAILFIRE_TEXT)).toEqual({ lifeAmount: 3 });
  });

  it("does not match unrelated sacrifice-shaped text", () => {
    expect(parsePunisherChoiceEffect("Sacrifice a creature: draw a card.")).toBeUndefined();
  });
});

describe("applyPunisherChoiceEffect — each opponent's heuristic choice", () => {
  it("never affects the caster's own seat", () => {
    const caster = seat({ id: "caster", name: "Caster", kind: "agent", life: 5, board: { hand: [], battlefield: [] } });
    const result = applyPunisherChoiceEffect(session([caster]), "caster", "Torment of Hailfire", { lifeAmount: 3 }, 5);
    expect(result.seats[0].life).toBe(5);
  });

  it("takes the life loss when it's not dangerous, leaving permanents and hand untouched", () => {
    const opponent = seat({ id: "opp", name: "Opponent", kind: "agent", life: 40, board: { hand: [card({ id: "h1", name: "Land", typeLine: "Land" })], battlefield: [] } });
    const casterSeat = seat({ id: "caster", name: "Caster", kind: "agent" });
    const result = applyPunisherChoiceEffect(session([casterSeat, opponent]), "caster", "Torment of Hailfire", { lifeAmount: 3 }, 1);
    const after = result.seats.find((s) => s.id === "opp")!;
    expect(after.life).toBe(37);
    expect(after.board.hand).toHaveLength(1);
  });

  it("sacrifices a token permanent before touching life or hand once life is in danger", () => {
    const token = card({ id: "tok", name: "Illusion Token", typeLine: "Creature — Illusion", token: true });
    const realPermanent = card({ id: "real", name: "Sol Ring", typeLine: "Artifact" });
    const opponent = seat({
      id: "opp",
      name: "Opponent",
      kind: "agent",
      life: 10,
      board: { hand: [card({ id: "h1", name: "Land", typeLine: "Land" })], battlefield: [token, realPermanent] }
    });
    const casterSeat = seat({ id: "caster", name: "Caster", kind: "agent" });
    const result = applyPunisherChoiceEffect(session([casterSeat, opponent]), "caster", "Torment of Hailfire", { lifeAmount: 3 }, 1);
    const after = result.seats.find((s) => s.id === "opp")!;
    expect(after.life).toBe(10);
    expect(after.board.hand).toHaveLength(1);
    expect(after.board.battlefield.map((c) => c.id)).toEqual(["real"]);
  });

  it("discards a hand card before sacrificing a real (non-token) permanent once life is in danger", () => {
    const realPermanent = card({ id: "real", name: "Sol Ring", typeLine: "Artifact" });
    const opponent = seat({
      id: "opp",
      name: "Opponent",
      kind: "agent",
      life: 10,
      board: { hand: [card({ id: "h1", name: "Land", typeLine: "Land" })], battlefield: [realPermanent] }
    });
    const casterSeat = seat({ id: "caster", name: "Caster", kind: "agent" });
    const result = applyPunisherChoiceEffect(session([casterSeat, opponent]), "caster", "Torment of Hailfire", { lifeAmount: 3 }, 1);
    const after = result.seats.find((s) => s.id === "opp")!;
    expect(after.life).toBe(10);
    expect(after.board.hand).toHaveLength(0);
    expect(after.board.battlefield).toHaveLength(1);
  });

  it("sacrifices a nonland permanent when life is in danger and hand is empty", () => {
    const realPermanent = card({ id: "real", name: "Sol Ring", typeLine: "Artifact" });
    const opponent = seat({ id: "opp", name: "Opponent", kind: "agent", life: 10, board: { hand: [], battlefield: [realPermanent] } });
    const casterSeat = seat({ id: "caster", name: "Caster", kind: "agent" });
    const result = applyPunisherChoiceEffect(session([casterSeat, opponent]), "caster", "Torment of Hailfire", { lifeAmount: 3 }, 1);
    const after = result.seats.find((s) => s.id === "opp")!;
    expect(after.life).toBe(10);
    expect(after.board.battlefield).toHaveLength(0);
  });

  it("takes the life loss as a last resort once nothing else is left to spend", () => {
    const opponent = seat({ id: "opp", name: "Opponent", kind: "agent", life: 10, board: { hand: [], battlefield: [] } });
    const casterSeat = seat({ id: "caster", name: "Caster", kind: "agent" });
    const result = applyPunisherChoiceEffect(session([casterSeat, opponent]), "caster", "Torment of Hailfire", { lifeAmount: 3 }, 1);
    const after = result.seats.find((s) => s.id === "opp")!;
    expect(after.life).toBe(7);
  });

  it("repeats the process the given number of times", () => {
    const opponent = seat({ id: "opp", name: "Opponent", kind: "agent", life: 40, board: { hand: [], battlefield: [] } });
    const casterSeat = seat({ id: "caster", name: "Caster", kind: "agent" });
    const result = applyPunisherChoiceEffect(session([casterSeat, opponent]), "caster", "Torment of Hailfire", { lifeAmount: 3 }, 4);
    const after = result.seats.find((s) => s.id === "opp")!;
    expect(after.life).toBe(28);
  });
});
