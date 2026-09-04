import { describe, expect, it } from "vitest";
import { payGenericSacrificeCost, payGenericTapCost } from "./AppFlow";
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

// A deliberately fictional artifact (not "Mind Stone" by name) shaped like it: a plain "{T}: Add
// {C}." mana ability alongside its own separate "{1}, {T}, Sacrifice...: ..." ability — proves the
// fix is driven by the oracle-text parser (parseGenericSacrificeAbilities/chooseManaSourcesForCost),
// not a card-name special case, so it protects every card shaped this way, not just Mind Stone.
const ROCK_ORACLE_TEXT = "{T}: Add {C}.\n{1}, {T}, Sacrifice this artifact: Draw a card.";

describe("payGenericSacrificeCost — self-tap exclusion", () => {
  it("refuses to activate a sacrifice ability whose own generic cost can only be paid by tapping itself", () => {
    const rock = card({ id: "rock", name: "Rock of Testing", typeLine: "Artifact", oracleText: ROCK_ORACLE_TEXT });
    const s = session([seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [rock] } })]);
    expect(payGenericSacrificeCost(s, "caster", "rock", 0)).toBeUndefined();
  });

  it("succeeds once a second, unrelated mana source can cover the generic cost instead", () => {
    const rock = card({ id: "rock", name: "Rock of Testing", typeLine: "Artifact", oracleText: ROCK_ORACLE_TEXT });
    const forest = card({ id: "forest", name: "Forest", typeLine: "Basic Land — Forest" });
    const s = session([seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [rock, forest] } })]);
    const result = payGenericSacrificeCost(s, "caster", "rock", 0);
    expect(result).toBeDefined();
    const forestAfter = result!.session.seats[0].board.battlefield.find((c) => c.id === "forest");
    expect(forestAfter?.tapped).toBe(true);
  });

  it("still refuses once the rock is already tapped, regardless of other mana available", () => {
    const rock = card({ id: "rock", name: "Rock of Testing", typeLine: "Artifact", oracleText: ROCK_ORACLE_TEXT, tapped: true });
    const forest = card({ id: "forest", name: "Forest", typeLine: "Basic Land — Forest" });
    const s = session([seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [rock, forest] } })]);
    expect(payGenericSacrificeCost(s, "caster", "rock", 0)).toBeUndefined();
  });
});

describe("payGenericSacrificeCost — taps the source (High Market/Viscera Seer's own {T} cost)", () => {
  const HIGH_MARKET_ORACLE_TEXT = "{T}, Sacrifice a creature: You gain 1 life.";

  it("taps the source when its cost includes {T}, alongside the sacrifice", () => {
    const market = card({ id: "market", name: "High Market", typeLine: "Land", oracleText: HIGH_MARKET_ORACLE_TEXT });
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const s = session([seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [market, bear] } })]);
    const result = payGenericSacrificeCost(s, "caster", "market", 0);
    expect(result).toBeDefined();
    const marketAfter = result!.session.seats[0].board.battlefield.find((c) => c.id === "market");
    expect(marketAfter?.tapped).toBe(true);
  });

  it("does not tap the source when its cost has no {T} at all (e.g. a plain 'Sacrifice a creature: ...')", () => {
    const altar = card({ id: "altar", name: "Untapped Sacrifice Outlet", typeLine: "Artifact", oracleText: "Sacrifice a creature: Draw a card." });
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const s = session([seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [altar, bear] } })]);
    const result = payGenericSacrificeCost(s, "caster", "altar", 0);
    expect(result).toBeDefined();
    const altarAfter = result!.session.seats[0].board.battlefield.find((c) => c.id === "altar");
    expect(altarAfter?.tapped).toBeFalsy();
  });
});

describe("payGenericTapCost — self-tap exclusion", () => {
  const TAP_ABILITY_ORACLE_TEXT = "{T}: Add {C}.\n{1}, {T}: Create a 1/1 white Soldier creature token.";

  it("refuses to activate a costed tap ability whose own generic cost can only be paid by tapping itself", () => {
    const permanent = card({ id: "perm", name: "Token Maker of Testing", typeLine: "Artifact", oracleText: TAP_ABILITY_ORACLE_TEXT });
    const s = session([seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [permanent] } })]);
    expect(payGenericTapCost(s, "caster", "perm", 0)).toBeUndefined();
  });

  it("succeeds once a second, unrelated mana source can cover the generic cost instead", () => {
    const permanent = card({ id: "perm", name: "Token Maker of Testing", typeLine: "Artifact", oracleText: TAP_ABILITY_ORACLE_TEXT });
    const forest = card({ id: "forest", name: "Forest", typeLine: "Basic Land — Forest" });
    const s = session([seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [permanent, forest] } })]);
    const result = payGenericTapCost(s, "caster", "perm", 0);
    expect(result).toBeDefined();
    expect(result!.session.seats[0].board.battlefield.find((c) => c.id === "perm")?.tapped).toBe(true);
  });
});
