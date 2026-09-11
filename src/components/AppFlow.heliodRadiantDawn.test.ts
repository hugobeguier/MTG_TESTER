import { describe, expect, it } from "vitest";
import { applyZoneEffect } from "./AppFlow";
import { parseZoneEffect } from "@/lib/zoneEffects";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "typeLine">): VisibleCard {
  return { oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "graveyard", ...overrides };
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

// Real oracle text (Heliod, the Radiant Dawn's front face), verified via this codebase's local card
// database.
const HELIOD_ETB_TEXT = "When Heliod enters, return target enchantment card that isn't a God from your graveyard to your hand.";

describe("parseZoneEffect — Heliod, the Radiant Dawn's regrow ETB", () => {
  it("parses as a regrow targeting enchantment, tolerating the 'that isn't a God' qualifier", () => {
    expect(parseZoneEffect(HELIOD_ETB_TEXT)).toEqual({ kind: "regrow", targetType: "enchantment" });
  });
});

describe("applyZoneEffect — regrow targeting enchantment/artifact/nonland_permanent (reported live: Heliod refused to cast with Mind's Dilation in the graveyard)", () => {
  it("returns an enchantment card from the graveyard to hand", () => {
    const mindsDilation = card({ id: "minds-dilation", name: "Mind's Dilation", typeLine: "Enchantment" });
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [], graveyard: [mindsDilation] } });
    const result = applyZoneEffect(session([player]), "p", "Heliod, the Radiant Dawn", { kind: "regrow", targetType: "enchantment" });
    const after = result.seats.find((s) => s.id === "p")!;
    expect(after.board.hand.map((c) => c.id)).toEqual(["minds-dilation"]);
    expect(after.board.graveyard).toHaveLength(0);
  });

  it("returns an artifact card from the graveyard to hand", () => {
    const solRing = card({ id: "sol-ring", name: "Sol Ring", typeLine: "Artifact" });
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [], graveyard: [solRing] } });
    const result = applyZoneEffect(session([player]), "p", "Test Artifact Regrow", { kind: "regrow", targetType: "artifact" });
    const after = result.seats.find((s) => s.id === "p")!;
    expect(after.board.hand.map((c) => c.id)).toEqual(["sol-ring"]);
  });

  it("returns a nonland_permanent card from the graveyard to hand, excluding lands", () => {
    const forest = card({ id: "forest", name: "Forest", typeLine: "Basic Land — Forest" });
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [], graveyard: [forest, bear] } });
    const result = applyZoneEffect(session([player]), "p", "Test Nonland Regrow", { kind: "regrow", targetType: "nonland_permanent" });
    const after = result.seats.find((s) => s.id === "p")!;
    expect(after.board.hand.map((c) => c.id)).toEqual(["bear"]);
  });

  it("still returns nothing (no legal target) when the graveyard genuinely has no matching card (regression guard)", () => {
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [], graveyard: [bear] } });
    const result = applyZoneEffect(session([player]), "p", "Heliod, the Radiant Dawn", { kind: "regrow", targetType: "enchantment" });
    const after = result.seats.find((s) => s.id === "p")!;
    expect(after.board.hand).toHaveLength(0);
    expect(after.board.graveyard?.map((c) => c.id)).toEqual(["bear"]);
  });

  it("still works for the pre-existing 'creature'/'land'/'permanent' target types (regression guard)", () => {
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [], graveyard: [bear] } });
    const result = applyZoneEffect(session([player]), "p", "Test Creature Regrow", { kind: "regrow", targetType: "creature" });
    const after = result.seats.find((s) => s.id === "p")!;
    expect(after.board.hand.map((c) => c.id)).toEqual(["bear"]);
  });
});
