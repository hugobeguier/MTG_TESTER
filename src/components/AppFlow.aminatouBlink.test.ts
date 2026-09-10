import { describe, expect, it } from "vitest";
import { commonTriggerEffect, findCommonTriggersForPermanentEntered, moveCardAcrossSeats } from "./AppFlow";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const AMINATOU_MINUS_ONE_TEXT = "Exile another target permanent you own, then return it to the battlefield under your control.";

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

describe("commonTriggerEffect — Aminatou, the Fateshifter's -1", () => {
  it("recognizes the self-blink template", () => {
    expect(commonTriggerEffect(AMINATOU_MINUS_ONE_TEXT, "clause")).toEqual({ kind: "blink" });
  });
});

describe("moveCardAcrossSeats — battlefield-to-battlefield blink gives the permanent a fresh object identity", () => {
  it("clears counters, untaps, and resets summoning sickness on a blinked creature", () => {
    const creature = card({
      id: "c1",
      name: "Some Creature",
      typeLine: "Creature",
      power: "2",
      toughness: "2",
      tapped: true,
      summoningSick: false,
      counters: [{ kind: "+1/+1", count: 3 }],
      oracleText: "When this creature enters, draw a card."
    });
    const owner = seat({ id: "owner", name: "Owner", kind: "human", board: { hand: [], battlefield: [creature] } });

    const { session: blinkedSession, movedCard } = moveCardAcrossSeats(session([owner]), "owner", "c1", "owner", "battlefield");

    expect(movedCard).toBeDefined();
    expect(movedCard?.tapped).toBe(false);
    expect(movedCard?.summoningSick).toBe(true);
    expect(movedCard?.counters ?? []).toHaveLength(0);

    const afterOwner = blinkedSession.seats.find((s) => s.id === "owner")!;
    expect(afterOwner.board.battlefield).toHaveLength(1);
    expect(afterOwner.board.battlefield[0].id).toBe("c1");
    expect(afterOwner.board.battlefield[0].tapped).toBe(false);
  });

  it("lets the blinked permanent's own ETB ability fire again", () => {
    const creature = card({
      id: "c1",
      name: "Some Creature",
      typeLine: "Creature",
      power: "2",
      toughness: "2",
      oracleText: "When this creature enters, draw a card."
    });
    const owner = seat({ id: "owner", name: "Owner", kind: "human", board: { hand: [], battlefield: [creature] } });

    const { session: blinkedSession, movedCard } = moveCardAcrossSeats(session([owner]), "owner", "c1", "owner", "battlefield");
    expect(movedCard).toBeDefined();

    const triggers = findCommonTriggersForPermanentEntered(blinkedSession, "owner", movedCard!);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].effect).toEqual({ kind: "draw_cards", amount: 1 });
  });
});
