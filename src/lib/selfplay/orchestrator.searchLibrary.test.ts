// applySearchLibraryEffect is self-play's own auto-pick for the tutor family the bare-spell resolver
// previously left completely unmatched (Fabricate, Entomb, Buried Alive, Diabolic Intent, ...) — see
// resolveBareSpellEffect's own header comment for why this deliberately isn't the live game's agent
// heuristic. These tests exercise the executor directly against a minimal session rather than through
// a full playGame, mirroring smoke.test.ts's style.
import { describe, expect, it } from "vitest";
import { applySearchLibraryEffect } from "./orchestrator";
import type { SearchLibraryEffect } from "@/lib/activatedAbilities";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

function libraryCard(id: string, name: string, typeLine: string): VisibleCard {
  return { id, name, typeLine, oracleText: "", manaValue: 0, colors: [], role: "spell", zone: "library" };
}

function seatWithLibrary(library: VisibleCard[]): PlayerSeat {
  return {
    id: "p",
    name: "You",
    kind: "human",
    life: 40,
    commanderDamage: {},
    zones: { library: library.length, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield: [] },
    library
  };
}

function session(seat: PlayerSeat): GameSession {
  return {
    id: "test",
    createdAt: "",
    status: "playing",
    phase: "precombat main phase",
    turn: 1,
    xmage: { enabled: false, status: "not_configured", message: "" },
    seats: [seat],
    events: []
  };
}

describe("applySearchLibraryEffect", () => {
  it("finds a typed card and puts it into hand (Fabricate-shaped)", () => {
    const library = [libraryCard("1", "Forest", "Basic Land — Forest"), libraryCard("2", "Sol Ring", "Artifact"), libraryCard("3", "Bear", "Creature — Bear")];
    const effect: SearchLibraryEffect = { kind: "search_library", destination: "hand", tapped: false, cardTypeFilter: "artifact", count: 1 };
    const result = applySearchLibraryEffect(session(seatWithLibrary(library)), "p", "Fabricate", effect);
    const seat = result.seats[0];

    expect(seat.board.hand.map((c) => c.name)).toEqual(["Sol Ring"]);
    expect(seat.board.hand[0].zone).toBe("hand");
    expect(seat.library?.map((c) => c.id).sort()).toEqual(["1", "3"]);
    expect(seat.zones.library).toBe(2);
    expect(seat.zones.hand).toBe(1);
    expect(result.events[0].message).toContain("Sol Ring");
    expect(result.events[0].message).toContain("hand");
  });

  it("finds up to N typed cards and puts them into the graveyard (Buried Alive-shaped)", () => {
    const library = [
      libraryCard("1", "Bear", "Creature — Bear"),
      libraryCard("2", "Forest", "Basic Land — Forest"),
      libraryCard("3", "Wolf", "Creature — Wolf"),
      libraryCard("4", "Elf", "Creature — Elf")
    ];
    const effect: SearchLibraryEffect = { kind: "search_library", destination: "graveyard", tapped: false, cardTypeFilter: "creature", count: 3 };
    const result = applySearchLibraryEffect(session(seatWithLibrary(library)), "p", "Buried Alive", effect);
    const seat = result.seats[0];

    expect(seat.board.graveyard?.map((c) => c.name).sort()).toEqual(["Bear", "Elf", "Wolf"]);
    expect(seat.board.graveyard?.every((c) => c.zone === "graveyard")).toBe(true);
    expect(seat.library?.map((c) => c.id)).toEqual(["2"]);
    expect(seat.zones.graveyard).toBe(3);
    expect(seat.board.hand).toHaveLength(0);
  });

  it("finds an untyped card and puts it into the graveyard (Entomb-shaped)", () => {
    const library = [libraryCard("1", "Anything", "Instant")];
    const effect: SearchLibraryEffect = { kind: "search_library", destination: "graveyard", tapped: false, cardTypeFilter: undefined, count: 1 };
    const result = applySearchLibraryEffect(session(seatWithLibrary(library)), "p", "Entomb", effect);
    const seat = result.seats[0];

    expect(seat.board.graveyard?.map((c) => c.name)).toEqual(["Anything"]);
    expect(seat.library).toEqual([]);
  });

  it("shuffles and logs a failed search when nothing matches", () => {
    const library = [libraryCard("1", "Forest", "Basic Land — Forest")];
    const effect: SearchLibraryEffect = { kind: "search_library", destination: "hand", tapped: false, cardTypeFilter: "creature", count: 1 };
    const result = applySearchLibraryEffect(session(seatWithLibrary(library)), "p", "Diabolic Intent", effect);
    const seat = result.seats[0];

    expect(seat.board.hand).toHaveLength(0);
    expect(seat.library?.map((c) => c.id)).toEqual(["1"]);
    expect(result.events[0].message).toContain("no creature card");
  });

  it("puts a comma-filtered land onto the battlefield tapped and shuffles the rest (Farseek-shaped)", () => {
    const library = [
      libraryCard("1", "Forest", "Basic Land — Forest"),
      libraryCard("2", "Mountain", "Basic Land — Mountain"),
      libraryCard("3", "Bear", "Creature — Bear")
    ];
    const effect: SearchLibraryEffect = {
      kind: "search_library",
      destination: "battlefield",
      tapped: true,
      cardTypeFilter: "Plains, Island, Swamp, or Mountain",
      count: 1
    };
    const result = applySearchLibraryEffect(session(seatWithLibrary(library)), "p", "Farseek", effect);
    const seat = result.seats[0];

    expect(seat.board.battlefield.map((c) => c.name)).toEqual(["Mountain"]);
    expect(seat.board.battlefield[0].tapped).toBe(true);
    expect(seat.library?.map((c) => c.id).sort()).toEqual(["1", "3"]);
    expect(result.events[0].message).toContain("Mountain");
    expect(result.events[0].message).toContain("tapped");
  });
});
