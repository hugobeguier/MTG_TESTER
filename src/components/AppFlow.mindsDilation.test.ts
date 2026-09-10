import { describe, expect, it } from "vitest";
import { miracleCostFor, playCardFromZone, resolveTriggerEffect, staticCostReduction } from "./AppFlow";
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
    turn: 3,
    xmage: { enabled: false, status: "not_configured", message: "" },
    seats,
    events: []
  };
}

describe("impulse_cast_free trigger resolution (Mind's Dilation)", () => {
  it("exiles the opponent's top card into THEIR OWN exile, not the controller's, with no expiration turn", () => {
    const topCard = card({ id: "lib-1", name: "Some Nonland Card", typeLine: "Sorcery" });
    const opponent = seat({
      id: "opponent",
      name: "Opponent",
      kind: "human",
      library: [topCard],
      zones: { library: 1, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 }
    });
    const controller = seat({ id: "controller", name: "Controller", kind: "human" });

    const result = resolveTriggerEffect(session([opponent, controller]), {
      id: "trigger-1",
      type: "trigger",
      actorSeatId: "opponent",
      controllerSeatId: "controller",
      sourceCardId: "minds-dilation",
      sourceCardName: "Mind's Dilation",
      triggerKind: "common",
      effect: { kind: "impulse_cast_free", fromSeatId: "opponent" },
      message: ""
    });

    const afterOpponent = result.seats.find((s) => s.id === "opponent")!;
    const afterController = result.seats.find((s) => s.id === "controller")!;

    // Rule: an exiled card can never appear in another player's exile pile just because that
    // player has permission to cast it.
    expect(afterOpponent.board.exile?.map((c) => c.id)).toEqual(["lib-1"]);
    expect(afterController.board.exile ?? []).toHaveLength(0);

    const exiledCard = afterOpponent.board.exile?.[0];
    expect(exiledCard?.exiledPlayableBySeatId).toBe("controller");
    expect(exiledCard?.exiledPlayableFree).toBe(true);
    // No stated duration in the card's own text — the permission must not expire on its own.
    expect(exiledCard?.exiledPlayableUntilTurn).toBeUndefined();
  });

  it("lets the controller actually cast the exiled card later, even from a different turn, even though it physically sits in the opponent's exile", () => {
    const topCard = card({ id: "lib-1", name: "Some Nonland Card", typeLine: "Creature", manaValue: 3 });
    const opponent = seat({
      id: "opponent",
      name: "Opponent",
      kind: "human",
      library: [topCard],
      zones: { library: 1, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 }
    });
    const controller = seat({ id: "controller", name: "Controller", kind: "human" });
    const exiledSession = resolveTriggerEffect(session([opponent, controller]), {
      id: "trigger-1",
      type: "trigger",
      actorSeatId: "opponent",
      controllerSeatId: "controller",
      sourceCardId: "minds-dilation",
      sourceCardName: "Mind's Dilation",
      triggerKind: "common",
      effect: { kind: "impulse_cast_free", fromSeatId: "opponent" },
      message: ""
    });

    // Simulate time passing (the controller's own later turn) before they cast it.
    const laterSession = { ...exiledSession, turn: exiledSession.turn + 2 };
    const cast = playCardFromZone(laterSession, "controller", "lib-1", undefined, undefined, "battlefield", [], "exile");

    const afterController = cast.seats.find((s) => s.id === "controller")!;
    const afterOpponent = cast.seats.find((s) => s.id === "opponent")!;
    expect(afterController.board.battlefield.map((c) => c.id)).toContain("lib-1");
    expect(afterOpponent.board.exile ?? []).toHaveLength(0);
  });
});

describe("miracleCostFor — static cost reducers stack with a granted miracle cost", () => {
  it("combines a granted -4 miracle reduction with a static -1 reducer for a total of -5", () => {
    const inquisitiveGlimmer = card({
      id: "glimmer",
      name: "Inquisitive Glimmer",
      typeLine: "Enchantment",
      oracleText: "Enchantment spells you cast cost {1} less to cast.\nUnlock costs you pay cost {1} less."
    });
    const controller = seat({ id: "controller", name: "Controller", kind: "human", board: { hand: [], battlefield: [inquisitiveGlimmer] } });
    const mindsDilation = card({ id: "minds-dilation", name: "Mind's Dilation", typeLine: "Enchantment", manaValue: 6, colors: ["U"] });

    expect(staticCostReduction(controller, mindsDilation)).toBe(1);
    // manaValue 6, granted miracle -4, static -1 => 1 generic mana remaining.
    expect(miracleCostFor(controller, mindsDilation)).toBe(1);
  });
});
