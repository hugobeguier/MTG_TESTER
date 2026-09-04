import { describe, expect, it } from "vitest";
import { applyMill, destroyCreatures, moveCardBetweenVisibleZones } from "./AppFlow";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const BLIGHTSTEEL_ORACLE_TEXT =
  "Trample, infect, indestructible\nIf Blightsteel Colossus would be put into a graveyard from anywhere, reveal Blightsteel Colossus and shuffle it into its owner's library instead.";

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

function blightsteel(overrides: Partial<VisibleCard> = {}): VisibleCard {
  return card({ id: "blightsteel", name: "Blightsteel Colossus", typeLine: "Legendary Creature — Phyrexian Golem", oracleText: BLIGHTSTEEL_ORACLE_TEXT, ...overrides });
}

describe("destroyCreatures — graveyard-shuffle replacement (rule 614)", () => {
  it("shuffles the destroyed card into its OWNER's library, not the controller's, and never adds it to the graveyard", () => {
    const owner = seat({ id: "owner", name: "Malik", kind: "agent", library: [], zones: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 } });
    const controller = seat({
      id: "controller",
      name: "You",
      kind: "human",
      board: { hand: [], battlefield: [blightsteel({ ownerSeatId: "owner" })] }
    });
    const result = destroyCreatures(session([owner, controller]), [
      { seatId: "controller", cardId: "blightsteel", message: "Blightsteel Colossus is destroyed." }
    ]);

    const ownerAfter = result.seats.find((s) => s.id === "owner")!;
    const controllerAfter = result.seats.find((s) => s.id === "controller")!;
    expect(controllerAfter.board.battlefield).toHaveLength(0);
    expect(controllerAfter.board.graveyard ?? []).toHaveLength(0);
    expect(ownerAfter.board.graveyard ?? []).toHaveLength(0);
    expect(ownerAfter.library?.map((c) => c.id)).toEqual(["blightsteel"]);
    expect(ownerAfter.library?.[0].zone).toBe("library");
    expect(result.events[0].message).toMatch(/revealed and shuffled into malik's library/i);
  });

  it("does not create a pendingDeaths entry for the redirected card (it never actually dies)", () => {
    const controller = seat({ id: "controller", name: "You", kind: "human", board: { hand: [], battlefield: [blightsteel()] } });
    const result = destroyCreatures(session([controller]), [{ seatId: "controller", cardId: "blightsteel", message: "Blightsteel Colossus is destroyed." }]);
    expect(result.pendingDeaths ?? []).toHaveLength(0);
  });

  it("leaves an ordinary card's destruction unaffected (regression check)", () => {
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const controller = seat({ id: "controller", name: "You", kind: "human", board: { hand: [], battlefield: [bear] } });
    const result = destroyCreatures(session([controller]), [{ seatId: "controller", cardId: "bear", message: "Grizzly Bears is destroyed." }]);
    const after = result.seats.find((s) => s.id === "controller")!;
    expect(after.board.graveyard).toHaveLength(1);
    expect(result.pendingDeaths).toHaveLength(1);
  });
});

describe("moveCardBetweenVisibleZones — graveyard-shuffle replacement + owner-vs-controller routing", () => {
  it("redirects a discard from the owner's own hand into their own library (the reported Malik case)", () => {
    const malik = seat({
      id: "malik",
      name: "Malik",
      kind: "agent",
      library: [],
      board: { hand: [blightsteel({ ownerSeatId: "malik" })], battlefield: [] }
    });
    const result = moveCardBetweenVisibleZones(session([malik]), "malik", "blightsteel", "graveyard");
    const after = result.seats.find((s) => s.id === "malik")!;
    expect(after.board.hand).toHaveLength(0);
    expect(after.board.graveyard ?? []).toHaveLength(0);
    expect(after.library?.map((c) => c.id)).toEqual(["blightsteel"]);
    expect(result.events[0].message).toMatch(/revealed and shuffled into malik's library/i);
  });

  it("routes a sacrificed stolen permanent into its OWNER's graveyard, not the controller's", () => {
    const owner = seat({ id: "owner", name: "Malik", kind: "agent" });
    const controller = seat({
      id: "controller",
      name: "You",
      kind: "human",
      board: { hand: [], battlefield: [card({ id: "stolen", name: "Some Creature", typeLine: "Creature — Bear", ownerSeatId: "owner" })] }
    });
    const result = moveCardBetweenVisibleZones(session([owner, controller]), "controller", "stolen", "graveyard");
    const ownerAfter = result.seats.find((s) => s.id === "owner")!;
    const controllerAfter = result.seats.find((s) => s.id === "controller")!;
    expect(controllerAfter.board.battlefield).toHaveLength(0);
    expect(controllerAfter.board.graveyard ?? []).toHaveLength(0);
    expect(ownerAfter.board.graveyard?.map((c) => c.id)).toEqual(["stolen"]);
  });
});

describe("applyMill — graveyard-shuffle replacement", () => {
  it("shuffles a milled Blightsteel-style card back into the library instead of the graveyard", () => {
    const player = seat({
      id: "player",
      name: "You",
      kind: "human",
      library: [blightsteel(), card({ id: "other", name: "Other Card", typeLine: "Creature — Bear", zone: "library" })],
      zones: { library: 2, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 }
    });
    const result = applyMill(session([player]), "player", "Some Mill Spell", 2);
    const after = result.seats.find((s) => s.id === "player")!;
    expect(after.board.graveyard?.map((c) => c.id)).toEqual(["other"]);
    expect(after.library?.map((c) => c.id)).toEqual(["blightsteel"]);
    expect(after.zones.library).toBe(1);
    expect(after.zones.graveyard).toBe(1);
    expect(result.events.some((e) => /revealed and shuffled into your library/i.test(e.message))).toBe(true);
  });
});
