import { describe, expect, it } from "vitest";
import { isAvailableManaSource, manaChoicesForCard, manaProducedBy, runStateBasedActionsPass } from "./AppFlow";
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

const INSIDIOUS_ROOTS_ORACLE_TEXT =
  'Creature tokens you control have "{T}: Add one mana of any color."\nWhenever one or more creature cards leave your graveyard, create a 0/1 green Plant creature token, then put a +1/+1 counter on each Plant you control.';

function insidiousRoots(overrides: Partial<VisibleCard> = {}): VisibleCard {
  return card({ id: "insidious-roots", name: "Insidious Roots", typeLine: "Enchantment", oracleText: INSIDIOUS_ROOTS_ORACLE_TEXT, ...overrides });
}

function plantToken(id: string, overrides: Partial<VisibleCard> = {}): VisibleCard {
  return card({ id, name: "Plant Token", typeLine: "Token Creature - Plant", token: true, power: "0", toughness: "1", colors: ["G"], ...overrides });
}

describe("Insidious Roots — grants creature tokens a real mana ability", () => {
  it("makes a Plant token a valid mana source that can add one mana of any color", () => {
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [insidiousRoots(), plantToken("plant-1")] } });
    const result = runStateBasedActionsPass(session([player])).session;
    const after = result.seats[0];
    const plant = after.board.battlefield.find((c) => c.id === "plant-1")!;

    expect(plant.grantedManaAbilityText).toBe("{T}: Add one mana of any color.");
    expect(isAvailableManaSource(plant, after)).toBe(true);
    expect(manaChoicesForCard(plant, after)).toEqual(expect.arrayContaining(["W", "U", "B", "R", "G"]));
    expect(manaProducedBy(plant, after)).toBe(1);
  });

  it("does not grant the ability to a token on a DIFFERENT seat's battlefield", () => {
    const owner = seat({ id: "owner", name: "You", kind: "human", board: { hand: [], battlefield: [insidiousRoots()] } });
    const opponent = seat({ id: "opponent", name: "Malik", kind: "agent", board: { hand: [], battlefield: [plantToken("opponent-plant")] } });
    const result = runStateBasedActionsPass(session([owner, opponent])).session;
    const opponentAfter = result.seats.find((s) => s.id === "opponent")!;
    const plant = opponentAfter.board.battlefield.find((c) => c.id === "opponent-plant")!;

    expect(plant.grantedManaAbilityText).toBeUndefined();
    expect(isAvailableManaSource(plant, opponentAfter)).toBe(false);
  });

  it("clears the granted ability once Insidious Roots leaves the battlefield", () => {
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [insidiousRoots(), plantToken("plant-1")] } });
    const withRoots = runStateBasedActionsPass(session([player])).session;
    const withoutRoots = {
      ...withRoots,
      seats: withRoots.seats.map((s) => ({ ...s, board: { ...s.board, battlefield: s.board.battlefield.filter((c) => c.id !== "insidious-roots") } }))
    };
    const result = runStateBasedActionsPass(withoutRoots).session;
    const plant = result.seats[0].board.battlefield.find((c) => c.id === "plant-1")!;

    expect(plant.grantedManaAbilityText).toBeUndefined();
    expect(isAvailableManaSource(plant, result.seats[0])).toBe(false);
  });
});
