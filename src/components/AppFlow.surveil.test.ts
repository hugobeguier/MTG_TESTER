// Surveil N ("Otherworldly Gaze", and the rest of the Ikoria-onward surveil family) was previously
// routed live through the LLM-backed Rules Advisor and not recognized by self-play's bare-spell
// resolver at all. Folded into ZoneEffect so both consumers pick it up through the shared
// parseZoneEffect/applyZoneEffect call sites with no separate wiring.
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

describe("parseZoneEffect — surveil", () => {
  it("parses a bare-digit surveil clause (Otherworldly Gaze)", () => {
    expect(
      parseZoneEffect(
        "Surveil 3. (Look at the top three cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)"
      )
    ).toEqual({ kind: "surveil", amount: 3 });
  });

  it("does not match a spelled-out count (real templating always uses a digit)", () => {
    expect(parseZoneEffect("Surveil three.")).toBeUndefined();
  });
});

describe("applyZoneEffect — surveil", () => {
  it("bins any land among the looked-at cards into the graveyard and keeps the rest on top", () => {
    const library = [
      card({ id: "1", name: "Forest", typeLine: "Basic Land — Forest" }),
      card({ id: "2", name: "Bear", typeLine: "Creature — Bear" }),
      card({ id: "3", name: "Island", typeLine: "Basic Land — Island" }),
      card({ id: "4", name: "Wolf", typeLine: "Creature — Wolf" })
    ];
    const player = seat({ id: "p", name: "You", kind: "human", library, board: { hand: [], battlefield: [] } });
    const result = applyZoneEffect(session([player]), "p", "Otherworldly Gaze", { kind: "surveil", amount: 3 });
    const seatAfter = result.seats[0];

    expect(seatAfter.board.graveyard?.map((c) => c.name)).toEqual(["Forest", "Island"]);
    expect(seatAfter.library?.map((c) => c.name)).toEqual(["Bear", "Wolf"]);
    expect(result.events[0].message).toContain("Forest, Island");
  });

  it("keeps everything on top and logs a no-op when nothing looked at is a land", () => {
    const library = [card({ id: "1", name: "Bear", typeLine: "Creature — Bear" })];
    const player = seat({ id: "p", name: "You", kind: "human", library, board: { hand: [], battlefield: [] } });
    const result = applyZoneEffect(session([player]), "p", "Otherworldly Gaze", { kind: "surveil", amount: 1 });
    const seatAfter = result.seats[0];

    expect(seatAfter.board.graveyard ?? []).toHaveLength(0);
    expect(seatAfter.library?.map((c) => c.id)).toEqual(["1"]);
    expect(result.events[0].message).toContain("keeps everything on top");
  });
});
