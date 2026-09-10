import { describe, expect, it } from "vitest";
import { applyRemovalEffect } from "./AppFlow";
import { parseRemovalEffect } from "@/lib/removalSpells";
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
    phase: "main1",
    turn: 1,
    xmage: { enabled: false, status: "not_configured", message: "" },
    seats,
    events: []
  };
}

// Real oracle text, verified via local card DB.
const SWORDS_TEXT = "Exile target creature. Its controller gains life equal to its power.";

describe("Swords to Plowshares — life gain", () => {
  it("parses the life-gain follow-up as its own flag", () => {
    expect(parseRemovalEffect(SWORDS_TEXT)).toEqual({ kind: "exile", targetType: "creature", lifeGainToControllerEqualToPower: true });
  });

  it("exiles the target and gives its controller life equal to its power", () => {
    const target = card({ id: "target", name: "Grizzly Bears", typeLine: "Creature — Bear", power: "2", toughness: "2" });
    const targetController = seat({ id: "victim", name: "Victim", kind: "agent", life: 40, board: { hand: [], battlefield: [target] } });
    const caster = seat({ id: "caster", name: "Caster", kind: "agent" });
    const swords = card({ id: "swords", name: "Swords to Plowshares", typeLine: "Instant", oracleText: SWORDS_TEXT });

    const effect = parseRemovalEffect(SWORDS_TEXT)!;
    const result = applyRemovalEffect(session([caster, targetController]), "caster", "Swords to Plowshares", swords, effect, undefined, {
      kind: "card",
      seatId: "victim",
      cardId: "target"
    });

    const victimAfter = result.seats.find((s) => s.id === "victim")!;
    expect(victimAfter.life).toBe(42);
    expect(victimAfter.board.battlefield.find((c) => c.id === "target")).toBeUndefined();
    expect(victimAfter.board.exile?.some((c) => c.id === "target")).toBe(true);
  });

  it("counts +1/+1 counters toward the life gained (power at time of exile, not base power)", () => {
    const target = card({
      id: "target",
      name: "Grizzly Bears",
      typeLine: "Creature — Bear",
      power: "2",
      toughness: "2",
      counters: [{ kind: "+1/+1", count: 3 }]
    });
    const targetController = seat({ id: "victim", name: "Victim", kind: "agent", life: 40, board: { hand: [], battlefield: [target] } });
    const caster = seat({ id: "caster", name: "Caster", kind: "agent" });
    const swords = card({ id: "swords", name: "Swords to Plowshares", typeLine: "Instant", oracleText: SWORDS_TEXT });

    const effect = parseRemovalEffect(SWORDS_TEXT)!;
    const result = applyRemovalEffect(session([caster, targetController]), "caster", "Swords to Plowshares", swords, effect, undefined, {
      kind: "card",
      seatId: "victim",
      cardId: "target"
    });

    expect(result.seats.find((s) => s.id === "victim")!.life).toBe(45); // 40 + (2 base + 3 counters)
  });

  it("a plain exile spell with no life-gain clause still grants none (regression guard)", () => {
    const target = card({ id: "target", name: "Grizzly Bears", typeLine: "Creature — Bear", power: "2", toughness: "2" });
    const targetController = seat({ id: "victim", name: "Victim", kind: "agent", life: 40, board: { hand: [], battlefield: [target] } });
    const caster = seat({ id: "caster", name: "Caster", kind: "agent" });
    const utterEnd = card({ id: "utter-end", name: "Utter End", typeLine: "Instant", oracleText: "Exile target nonland permanent." });

    const effect = parseRemovalEffect(utterEnd.oracleText)!;
    const result = applyRemovalEffect(session([caster, targetController]), "caster", "Utter End", utterEnd, effect, undefined, {
      kind: "card",
      seatId: "victim",
      cardId: "target"
    });

    expect(result.seats.find((s) => s.id === "victim")!.life).toBe(40);
  });
});
