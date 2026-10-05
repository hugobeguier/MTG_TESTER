// "Look/reveal the top N, put one into hand, dispose of the rest" (Grisly Salvage, Diabolic Vision)
// was previously routed live through the LLM-backed Rules Advisor — imprecisely for Diabolic Vision,
// which fell into the generic look_at_top_cards fallback with no real destination for the rest (see
// rulesAdvisor.ts's own comment) — and not recognized by self-play's bare-spell resolver at all.
import { describe, expect, it } from "vitest";
import { applyZoneEffect } from "./AppFlow";
import { parseZoneEffect } from "@/lib/zoneEffects";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "typeLine">): VisibleCard {
  return { oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "library", ...overrides };
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

describe("applyZoneEffect — look_dig (Grisly Salvage-shaped, typed, rest to graveyard)", () => {
  it("puts the first matching card into hand and bins the rest", () => {
    const library = [
      card({ id: "1", name: "Bolt", typeLine: "Instant" }),
      card({ id: "2", name: "Forest", typeLine: "Basic Land — Forest" }),
      card({ id: "3", name: "Bear", typeLine: "Creature — Bear" }),
      card({ id: "4", name: "Island", typeLine: "Basic Land — Island" }),
      card({ id: "5", name: "Wolf", typeLine: "Creature — Wolf" })
    ];
    const player = seat({ id: "p", name: "You", kind: "human", library, board: { hand: [], battlefield: [] } });
    const result = applyZoneEffect(session([player]), "p", "Grisly Salvage", { kind: "look_dig", amount: 5, cardTypeFilter: "creature or land", restDestination: "graveyard" });
    const seatAfter = result.seats[0];

    expect(seatAfter.board.hand.map((c) => c.name)).toEqual(["Forest"]);
    expect(seatAfter.board.graveyard?.map((c) => c.name)).toEqual(["Bolt", "Bear", "Island", "Wolf"]);
    expect(seatAfter.library).toEqual([]);
    expect(result.events[0].message).toContain("Forest");
  });

  it("bins everything when nothing matches", () => {
    const library = [card({ id: "1", name: "Bolt", typeLine: "Instant" })];
    const player = seat({ id: "p", name: "You", kind: "human", library, board: { hand: [], battlefield: [] } });
    const result = applyZoneEffect(session([player]), "p", "Grisly Salvage", { kind: "look_dig", amount: 1, cardTypeFilter: "creature or land", restDestination: "graveyard" });
    const seatAfter = result.seats[0];

    expect(seatAfter.board.hand).toHaveLength(0);
    expect(seatAfter.board.graveyard?.map((c) => c.name)).toEqual(["Bolt"]);
  });
});

describe("applyZoneEffect — look_dig (Diabolic Vision-shaped, untyped, rest back on top)", () => {
  it("puts the first looked-at card into hand and keeps the rest on top in order", () => {
    const library = [
      card({ id: "1", name: "Bolt", typeLine: "Instant" }),
      card({ id: "2", name: "Forest", typeLine: "Basic Land — Forest" }),
      card({ id: "3", name: "Bear", typeLine: "Creature — Bear" }),
      card({ id: "4", name: "Reserve", typeLine: "Instant" })
    ];
    const player = seat({ id: "p", name: "You", kind: "human", library, board: { hand: [], battlefield: [] } });
    const result = applyZoneEffect(session([player]), "p", "Diabolic Vision", { kind: "look_dig", amount: 3, cardTypeFilter: undefined, restDestination: "library_top" });
    const seatAfter = result.seats[0];

    expect(seatAfter.board.hand.map((c) => c.name)).toEqual(["Bolt"]);
    expect(seatAfter.library?.map((c) => c.name)).toEqual(["Forest", "Bear", "Reserve"]);
    expect(seatAfter.board.graveyard ?? []).toHaveLength(0);
  });
});
