import { describe, expect, it } from "vitest";
import { applyEachPlayerSacrificeEffect, parseEachPlayerSacrificeEffect } from "./AppFlow";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const PLAGUECRAFTER_ORACLE_TEXT =
  "When Plaguecrafter enters the battlefield, each player sacrifices a creature or planeswalker of their choice. If a player can't, they discard a card instead.";

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

describe("parseEachPlayerSacrificeEffect — Plaguecrafter", () => {
  it("detects the discard fallback from Plaguecrafter's real printed text", () => {
    const effect = parseEachPlayerSacrificeEffect(PLAGUECRAFTER_ORACLE_TEXT);
    expect(effect).toEqual({ typeFilter: "creature or planeswalker", discardFallback: true });
  });
});

describe("applyEachPlayerSacrificeEffect", () => {
  const effect = { typeFilter: "creature or planeswalker", discardFallback: true };

  it("sacrifices a legal creature instead of discarding when one is available", () => {
    const creature = card({ id: "c1", name: "Some Creature", typeLine: "Creature" });
    const player = seat({ id: "p1", name: "Player", kind: "human", board: { hand: [], battlefield: [creature] } });
    const result = applyEachPlayerSacrificeEffect(session([player]), "Plaguecrafter", effect);
    const after = result.session.seats.find((item) => item.id === "p1")!;
    expect(after.board.battlefield).toHaveLength(0);
    expect(after.board.graveyard).toHaveLength(1);
    expect(result.humanDiscardNeededSeatId).toBeUndefined();
  });

  it("flags a human seat with nothing to sacrifice for an interactive discard choice, without touching their hand", () => {
    const handCard = card({ id: "h1", name: "Hand Card", typeLine: "Instant", zone: "hand" });
    const player = seat({ id: "p1", name: "Player", kind: "human", board: { hand: [handCard], battlefield: [] } });
    const result = applyEachPlayerSacrificeEffect(session([player]), "Plaguecrafter", effect);
    const after = result.session.seats.find((item) => item.id === "p1")!;
    expect(result.humanDiscardNeededSeatId).toBe("p1");
    expect(after.board.hand).toHaveLength(1);
    expect(after.board.graveyard ?? []).toHaveLength(0);
  });

  it("auto-discards for an agent seat with nothing to sacrifice", () => {
    const handCard = card({ id: "h1", name: "Hand Card", typeLine: "Instant", zone: "hand" });
    const agent = seat({ id: "a1", name: "Agent", kind: "agent", board: { hand: [handCard], battlefield: [] } });
    const result = applyEachPlayerSacrificeEffect(session([agent]), "Plaguecrafter", effect);
    const after = result.session.seats.find((item) => item.id === "a1")!;
    expect(result.humanDiscardNeededSeatId).toBeUndefined();
    expect(after.board.hand).toHaveLength(0);
    expect(after.board.graveyard).toHaveLength(1);
  });
});
