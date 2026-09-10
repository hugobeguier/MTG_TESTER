import { describe, expect, it } from "vitest";
import { applyChosenEachPlayerSacrifice, applyEachPlayerSacrificeEffect, parseEachPlayerSacrificeEffect } from "./AppFlow";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

// Real oracle text, verified via this codebase's local card database (Scryfall-sourced).
const PLAGUECRAFTER_ORACLE_TEXT =
  "When this creature enters, each player sacrifices a creature or planeswalker of their choice. Each player who can't discards a card.";

// Real oracle text, verified via this codebase's local card database (Scryfall-sourced) — no
// discard fallback at all, and restricted to nontoken creatures (no planeswalkers).
const ACCURSED_MARAUDER_ORACLE_TEXT = "When this creature enters, each player sacrifices a nontoken creature of their choice.";

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

  it("defers to an interactive choice for a human with more than one legal creature, instead of auto-picking (reported live)", () => {
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const wolf = card({ id: "wolf", name: "Runeclaw Wolf", typeLine: "Creature — Wolf" });
    const player = seat({ id: "p1", name: "Player", kind: "human", board: { hand: [], battlefield: [bear, wolf] } });
    const result = applyEachPlayerSacrificeEffect(session([player]), "Plaguecrafter", effect);
    const after = result.session.seats.find((item) => item.id === "p1")!;
    expect(result.humanSacrificeNeededSeatId).toBe("p1");
    expect(after.board.battlefield).toHaveLength(2); // untouched — nothing auto-picked
    expect(after.board.graveyard ?? []).toHaveLength(0);
  });

  it("still auto-picks for a human with only one legal creature (no real decision to make)", () => {
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const player = seat({ id: "p1", name: "Player", kind: "human", board: { hand: [], battlefield: [bear] } });
    const result = applyEachPlayerSacrificeEffect(session([player]), "Plaguecrafter", effect);
    const after = result.session.seats.find((item) => item.id === "p1")!;
    expect(result.humanSacrificeNeededSeatId).toBeUndefined();
    expect(after.board.battlefield).toHaveLength(0);
    expect(after.board.graveyard).toHaveLength(1);
  });

  it("still auto-picks for an agent seat even with multiple legal creatures (no LLM round-trip needed)", () => {
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const wolf = card({ id: "wolf", name: "Runeclaw Wolf", typeLine: "Creature — Wolf" });
    const agent = seat({ id: "a1", name: "Agent", kind: "agent", board: { hand: [], battlefield: [bear, wolf] } });
    const result = applyEachPlayerSacrificeEffect(session([agent]), "Plaguecrafter", effect);
    const after = result.session.seats.find((item) => item.id === "a1")!;
    expect(result.humanSacrificeNeededSeatId).toBeUndefined();
    expect(after.board.battlefield).toHaveLength(1);
    expect(after.board.graveyard).toHaveLength(1);
  });

  it("Accursed Marauder's real text parses with no discard fallback and a nontoken-creature filter", () => {
    const effect2 = parseEachPlayerSacrificeEffect(ACCURSED_MARAUDER_ORACLE_TEXT);
    expect(effect2).toEqual({ typeFilter: "nontoken creature", discardFallback: false });
  });
});

describe("applyChosenEachPlayerSacrifice", () => {
  it("applies the human's own pick and routes it through destroyCreatures so death triggers fire (Meren, Blood Artist, ...)", () => {
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const wolf = card({ id: "wolf", name: "Runeclaw Wolf", typeLine: "Creature — Wolf" });
    const player = seat({ id: "p1", name: "Player", kind: "human", board: { hand: [], battlefield: [bear, wolf] } });
    const result = applyChosenEachPlayerSacrifice(session([player]), "p1", "wolf", "Plaguecrafter");
    const after = result.seats.find((item) => item.id === "p1")!;
    expect(after.board.battlefield.map((c) => c.id)).toEqual(["bear"]);
    expect(after.board.graveyard?.map((c) => c.id)).toEqual(["wolf"]);
    // destroyCreatures (not a raw zone move) stamps pendingDeaths, which is what the death-trigger
    // scan (Meren's "whenever another creature you control dies", ...) actually watches.
    expect(result.pendingDeaths?.some((death) => death.card.id === "wolf")).toBe(true);
  });

  it("does nothing if the chosen card isn't actually on that seat's battlefield", () => {
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const player = seat({ id: "p1", name: "Player", kind: "human", board: { hand: [], battlefield: [bear] } });
    const before = session([player]);
    const result = applyChosenEachPlayerSacrifice(before, "p1", "nonexistent", "Plaguecrafter");
    expect(result).toBe(before);
  });
});
