import { describe, expect, it } from "vitest";
import { findCastTriggers } from "./AppFlow";
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

// Real oracle text, verified via this codebase's local card database.
const ESPER_SENTINEL_TEXT = "Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is this creature's power.";

function esperSentinel(): VisibleCard {
  return card({ id: "esper-sentinel", name: "Esper Sentinel", typeLine: "Artifact Creature — Human Soldier", oracleText: ESPER_SENTINEL_TEXT });
}

function gravePact(): VisibleCard {
  return card({ id: "grave-pact", name: "Grave Pact", typeLine: "Enchantment", manaValue: 4 });
}

// Reported live: "Sable casts Grave Pact which triggers my Esper Sentinel, but when I then used a
// Counterspell on that spell my Esper Sentinel did not trigger afterwards." Esper Sentinel's "unless
// that player pays" cast trigger used to be found and queued at the triggering SPELL'S OWN
// RESOLUTION time, not when it was cast — a countered spell's own resolution is never reached at
// all (it's removed from the stack inside the countering spell's own resolution instead), so the
// trigger silently never fired. It's now found by this same function (findCastTriggers) every other
// cast trigger already goes through, queued the instant the spell is CAST — see beginPendingAction's
// own call site, which fires this well before anyone could possibly respond with a counterspell, so
// the trigger is already an independent stack object by the time Grave Pact could ever be countered.
describe("findCastTriggers — Esper Sentinel's 'unless that player pays' cast trigger", () => {
  it("fires the instant the opponent's first noncreature spell is CAST, independent of whether it later resolves or gets countered", () => {
    const human = seat({ id: "human", name: "Human", kind: "human", board: { hand: [], battlefield: [esperSentinel()] } });
    const sable = seat({ id: "sable", name: "Sable", kind: "agent", board: { hand: [], battlefield: [] } });
    const triggers = findCastTriggers(session([human, sable]), "sable", gravePact(), 1);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({
      controllerSeatId: "human",
      actorSeatId: "sable",
      sourceCardId: "esper-sentinel",
      effect: { kind: "draw_cards", amount: 1 }
    });
  });

  it("does not fire for the Esper Sentinel controller's own noncreature spell", () => {
    const human = seat({ id: "human", name: "Human", kind: "human", board: { hand: [], battlefield: [esperSentinel()] } });
    const triggers = findCastTriggers(session([human]), "human", gravePact(), 1);
    expect(triggers).toHaveLength(0);
  });

  it("does not fire for the opponent's SECOND noncreature spell that turn ('first' ordinal restriction)", () => {
    const human = seat({ id: "human", name: "Human", kind: "human", board: { hand: [], battlefield: [esperSentinel()] } });
    const sable = seat({ id: "sable", name: "Sable", kind: "agent", board: { hand: [], battlefield: [] } });
    const triggers = findCastTriggers(session([human, sable]), "sable", gravePact(), 2);
    expect(triggers).toHaveLength(0);
  });

  it("does not fire for a creature spell (noncreature restriction)", () => {
    const human = seat({ id: "human", name: "Human", kind: "human", board: { hand: [], battlefield: [esperSentinel()] } });
    const sable = seat({ id: "sable", name: "Sable", kind: "agent", board: { hand: [], battlefield: [] } });
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear", manaValue: 2 });
    const triggers = findCastTriggers(session([human, sable]), "sable", bear, 1);
    expect(triggers).toHaveLength(0);
  });
});
