import { describe, expect, it } from "vitest";
import { findLandRaidTriggers, isArchaeomancersMapLandRaidTrigger } from "./AppFlow";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const MAP_ORACLE_TEXT =
  "When this artifact enters, search your library for up to two basic Plains cards, reveal them, put them into your hand, then shuffle.\n" +
  "Whenever a land an opponent controls enters, if that player controls more lands than you, you may put a land card from your hand onto the battlefield.";

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

describe("isArchaeomancersMapLandRaidTrigger", () => {
  it("matches the real oracle text's second (landfall) ability", () => {
    expect(isArchaeomancersMapLandRaidTrigger(MAP_ORACLE_TEXT)).toBe(true);
  });
});

describe("findLandRaidTriggers", () => {
  it("fires when an opponent's land entering gives them more lands than the Map's controller", () => {
    const evolvingWilds = card({ id: "land-1", name: "Evolving Wilds", typeLine: "Land" });
    const map = card({ id: "map-1", name: "Archaeomancer's Map", typeLine: "Artifact", oracleText: MAP_ORACLE_TEXT });

    const opponent = seat({ id: "seat-opponent", name: "Opponent", kind: "agent", board: { hand: [], battlefield: [evolvingWilds] } });
    const controller = seat({ id: "seat-human", name: "You", kind: "human", board: { hand: [], battlefield: [map] } });

    const result = findLandRaidTriggers(session([opponent, controller]), "seat-opponent", evolvingWilds);

    expect(result).toHaveLength(1);
    expect(result[0].sourceCardName).toBe("Archaeomancer's Map");
    expect(result[0].controllerSeatId).toBe("seat-human");
  });

  it("does not fire when the entering player does not have more lands than the Map's controller", () => {
    const evolvingWilds = card({ id: "land-1", name: "Evolving Wilds", typeLine: "Land" });
    const alreadyOwnedLand = card({ id: "land-0", name: "Forest", typeLine: "Basic Land — Forest" });
    const map = card({ id: "map-1", name: "Archaeomancer's Map", typeLine: "Artifact", oracleText: MAP_ORACLE_TEXT });

    const opponent = seat({ id: "seat-opponent", name: "Opponent", kind: "agent", board: { hand: [], battlefield: [evolvingWilds] } });
    // Map's controller already has 1 land themselves — opponent's 1 land (after entering) is not MORE than that.
    const controller = seat({ id: "seat-human", name: "You", kind: "human", board: { hand: [], battlefield: [map, alreadyOwnedLand] } });

    const result = findLandRaidTriggers(session([opponent, controller]), "seat-opponent", evolvingWilds);

    expect(result).toHaveLength(0);
  });

  it("does not fire for a nonland permanent entering", () => {
    const nonland = card({ id: "creature-1", name: "Some Creature", typeLine: "Creature" });
    const map = card({ id: "map-1", name: "Archaeomancer's Map", typeLine: "Artifact", oracleText: MAP_ORACLE_TEXT });

    const opponent = seat({ id: "seat-opponent", name: "Opponent", kind: "agent", board: { hand: [], battlefield: [nonland] } });
    const controller = seat({ id: "seat-human", name: "You", kind: "human", board: { hand: [], battlefield: [map] } });

    const result = findLandRaidTriggers(session([opponent, controller]), "seat-opponent", nonland);

    expect(result).toHaveLength(0);
  });
});
