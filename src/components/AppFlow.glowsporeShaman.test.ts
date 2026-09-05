import { describe, expect, it } from "vitest";
import { applyZoneEffect } from "./AppFlow";
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

function libraryCard(id: string, name: string, typeLine: string, overrides: Partial<VisibleCard> = {}): VisibleCard {
  return card({ id, name, typeLine, zone: "library", ...overrides });
}

describe("applyZoneEffect — mill with the land-to-library-top follow-up (Glowspore Shaman)", () => {
  it("puts a land among the milled cards on top of the library and out of the graveyard", () => {
    const library = [
      libraryCard("bear", "Grizzly Bears", "Creature — Bear"),
      libraryCard("forest", "Forest", "Basic Land — Forest"),
      libraryCard("bolt", "Lightning Bolt", "Instant")
    ];
    const player = seat({ id: "p", name: "You", kind: "human", library, zones: { library: 3, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 } });
    const result = applyZoneEffect(session([player]), "p", "Glowspore Shaman", {
      kind: "mill",
      amount: 3,
      scope: "you",
      then: { kind: "put_land_from_graveyard_on_top" }
    });
    const after = result.seats.find((s) => s.id === "p")!;
    expect(after.library?.[0].id).toBe("forest");
    expect(after.board.graveyard?.map((c) => c.id).sort()).toEqual(["bear", "bolt"]);
  });

  it("mills normally with no error when no land was milled", () => {
    const library = [libraryCard("bear", "Grizzly Bears", "Creature — Bear"), libraryCard("bolt", "Lightning Bolt", "Instant")];
    const player = seat({ id: "p", name: "You", kind: "human", library, zones: { library: 2, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 } });
    const result = applyZoneEffect(session([player]), "p", "Glowspore Shaman", {
      kind: "mill",
      amount: 2,
      scope: "you",
      then: { kind: "put_land_from_graveyard_on_top" }
    });
    const after = result.seats.find((s) => s.id === "p")!;
    expect(after.library ?? []).toHaveLength(0);
    expect(after.board.graveyard?.map((c) => c.id).sort()).toEqual(["bear", "bolt"]);
  });

  it("picks the higher-mana-value land when more than one was milled", () => {
    const library = [
      libraryCard("island", "Island", "Basic Land — Island", { manaValue: 0 }),
      libraryCard("tower", "Command Tower", "Land", { manaValue: 0 }),
      libraryCard("bolt", "Lightning Bolt", "Instant")
    ];
    // manaValue is 0 for both real lands in actual card data; give the "better" one a distinguishing
    // manaValue directly to exercise the tie-break deterministically.
    library[1].manaValue = 1;
    const player = seat({ id: "p", name: "You", kind: "human", library, zones: { library: 3, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 } });
    const result = applyZoneEffect(session([player]), "p", "Glowspore Shaman", {
      kind: "mill",
      amount: 3,
      scope: "you",
      then: { kind: "put_land_from_graveyard_on_top" }
    });
    const after = result.seats.find((s) => s.id === "p")!;
    expect(after.library?.[0].id).toBe("tower");
    expect(after.board.graveyard?.map((c) => c.id).sort()).toEqual(["bolt", "island"]);
  });

  it("does not apply the follow-up when there is none (plain mill unaffected)", () => {
    const library = [libraryCard("forest", "Forest", "Basic Land — Forest")];
    const player = seat({ id: "p", name: "You", kind: "human", library, zones: { library: 1, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 } });
    const result = applyZoneEffect(session([player]), "p", "Some Mill Spell", { kind: "mill", amount: 1, scope: "you" });
    const after = result.seats.find((s) => s.id === "p")!;
    expect(after.library ?? []).toHaveLength(0);
    expect(after.board.graveyard?.map((c) => c.id)).toEqual(["forest"]);
  });
});
