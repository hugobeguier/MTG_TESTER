import { describe, expect, it } from "vitest";
import { applyRemovalEffect } from "./AppFlow";
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

const GENEROUS_GIFT = card({ id: "gift", name: "Generous Gift", typeLine: "Sorcery" });

describe("applyRemovalEffect — indestructible survives 'destroy' (rule 702.12b/704.5g)", () => {
  it("single-target destroy leaves an indestructible permanent on the battlefield", () => {
    const toski = card({ id: "toski", name: "Toski, Bearer of Secrets", typeLine: "Legendary Creature — Squirrel God", oracleText: "Indestructible" });
    const caster = seat({ id: "caster", name: "Caster", kind: "agent", board: { hand: [], battlefield: [] } });
    const opponent = seat({ id: "opp", name: "Opponent", kind: "agent", board: { hand: [], battlefield: [toski] } });
    const result = applyRemovalEffect(session([caster, opponent]), "caster", "Generous Gift", GENEROUS_GIFT, {
      kind: "destroy",
      targetType: "permanent",
      excludedColors: [],
      artifactsExcluded: false,
      basicsExcluded: false
    });
    const after = result.seats.find((s) => s.id === "opp")!;
    expect(after.board.battlefield.map((c) => c.id)).toEqual(["toski"]);
    expect(result.events[0].message).toMatch(/indestructible.*fails to destroy/i);
  });

  it("still destroys a non-indestructible permanent as before", () => {
    const solRing = card({ id: "ring", name: "Sol Ring", typeLine: "Artifact" });
    const caster = seat({ id: "caster", name: "Caster", kind: "agent", board: { hand: [], battlefield: [] } });
    const opponent = seat({ id: "opp", name: "Opponent", kind: "agent", board: { hand: [], battlefield: [solRing] } });
    const result = applyRemovalEffect(session([caster, opponent]), "caster", "Generous Gift", GENEROUS_GIFT, {
      kind: "destroy",
      targetType: "permanent",
      excludedColors: [],
      artifactsExcluded: false,
      basicsExcluded: false
    });
    const after = result.seats.find((s) => s.id === "opp")!;
    expect(after.board.battlefield).toHaveLength(0);
    expect(after.board.graveyard).toHaveLength(1);
  });

  it("destroy_all leaves indestructible creatures standing while destroying the rest", () => {
    const toski = card({ id: "toski", name: "Toski, Bearer of Secrets", typeLine: "Legendary Creature — Squirrel God", oracleText: "Indestructible" });
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const opponent = seat({ id: "opp", name: "Opponent", kind: "agent", board: { hand: [], battlefield: [toski, bear] } });
    const caster = seat({ id: "caster", name: "Caster", kind: "agent", board: { hand: [], battlefield: [] } });
    const result = applyRemovalEffect(session([caster, opponent]), "caster", "Wrath of God", card({ id: "wrath", name: "Wrath of God", typeLine: "Sorcery" }), {
      kind: "destroy_all",
      targetType: "creature",
      excludedColors: []
    });
    const after = result.seats.find((s) => s.id === "opp")!;
    expect(after.board.battlefield.map((c) => c.id)).toEqual(["toski"]);
    expect(after.board.graveyard).toHaveLength(1);
  });

  it("destroy_all_conditional leaves indestructible creatures standing", () => {
    const toski = card({ id: "toski", name: "Toski, Bearer of Secrets", typeLine: "Legendary Creature — Squirrel God", oracleText: "Indestructible", manaValue: 5 });
    const bigCreature = card({ id: "big", name: "Big Guy", typeLine: "Creature — Giant", manaValue: 6 });
    const opponent = seat({ id: "opp", name: "Opponent", kind: "agent", board: { hand: [], battlefield: [toski, bigCreature] } });
    const caster = seat({ id: "caster", name: "Caster", kind: "agent", board: { hand: [], battlefield: [] } });
    const result = applyRemovalEffect(
      session([caster, opponent]),
      "caster",
      "Bontu's Last Reckoning",
      card({ id: "bontu", name: "Bontu's Last Reckoning", typeLine: "Sorcery" }),
      { kind: "destroy_all_conditional", threshold: 4, comparison: "or_greater" }
    );
    const after = result.seats.find((s) => s.id === "opp")!;
    expect(after.board.battlefield.map((c) => c.id)).toEqual(["toski"]);
    expect(after.board.graveyard).toHaveLength(1);
  });
});
