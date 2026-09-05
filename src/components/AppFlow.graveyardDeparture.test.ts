import { describe, expect, it } from "vitest";
import {
  applyGraveyardExile,
  commonTriggerEffect,
  findCardsLeftGraveyardTriggers,
  moveCardAcrossSeats,
  resolveTriggerEffect
} from "./AppFlow";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const WILLOW_GEIST_ORACLE_TEXT =
  "Trample\nWhenever one or more cards leave your graveyard, put a +1/+1 counter on this creature.\nWhen this creature dies, you gain life equal to its power.";
const INSIDIOUS_ROOTS_ORACLE_TEXT =
  'Creature tokens you control have "{T}: Add one mana of any color."\nWhenever one or more creature cards leave your graveyard, create a 0/1 green Plant creature token, then put a +1/+1 counter on each Plant you control.';

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

function willowGeist(overrides: Partial<VisibleCard> = {}): VisibleCard {
  return card({ id: "willow-geist", name: "Willow Geist", typeLine: "Creature — Treefolk Spirit", oracleText: WILLOW_GEIST_ORACLE_TEXT, power: "1", toughness: "1", ...overrides });
}

function insidiousRoots(overrides: Partial<VisibleCard> = {}): VisibleCard {
  return card({ id: "insidious-roots", name: "Insidious Roots", typeLine: "Enchantment", oracleText: INSIDIOUS_ROOTS_ORACLE_TEXT, ...overrides });
}

function plantToken(id: string, overrides: Partial<VisibleCard> = {}): VisibleCard {
  return card({ id, name: "Plant Token", typeLine: "Token Creature - Plant", token: true, power: "0", toughness: "1", colors: ["G"], ...overrides });
}

describe("moveCardAcrossSeats — records a graveyard departure", () => {
  it("attributes the departure to the graveyard's OWNER, not the reanimator", () => {
    const owner = seat({
      id: "owner",
      name: "Malik",
      kind: "agent",
      board: { hand: [], battlefield: [], graveyard: [card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" })] }
    });
    const reanimator = seat({ id: "reanimator", name: "You", kind: "human" });
    const { session: result } = moveCardAcrossSeats(session([owner, reanimator]), "owner", "bear", "reanimator", "battlefield");

    expect(result.pendingGraveyardDepartures).toHaveLength(1);
    expect(result.pendingGraveyardDepartures?.[0]).toMatchObject({ seatId: "owner" });
    expect(result.pendingGraveyardDepartures?.[0].cards.map((c) => c.id)).toEqual(["bear"]);
  });

  it("records nothing when the source zone isn't a graveyard", () => {
    const owner = seat({ id: "owner", name: "Malik", kind: "agent", library: [card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear", zone: "library" })] });
    const reanimator = seat({ id: "reanimator", name: "You", kind: "human" });
    const { session: result } = moveCardAcrossSeats(session([owner, reanimator]), "owner", "bear", "reanimator", "battlefield");
    expect(result.pendingGraveyardDepartures ?? []).toHaveLength(0);
  });
});

describe("applyGraveyardExile — batches an emptied graveyard into ONE departure event", () => {
  it("records one entry holding every card, not one entry per card", () => {
    const graveyard = Array.from({ length: 5 }, (_, i) => card({ id: `card-${i}`, name: `Card ${i}`, typeLine: "Creature — Bear" }));
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [], graveyard } });
    const result = applyGraveyardExile(session([player]), "p", "Bojuka Bog");

    expect(result.pendingGraveyardDepartures).toHaveLength(1);
    expect(result.pendingGraveyardDepartures?.[0].seatId).toBe("p");
    expect(result.pendingGraveyardDepartures?.[0].cards).toHaveLength(5);
  });

  it("records nothing for an already-empty graveyard", () => {
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [], graveyard: [] } });
    const result = applyGraveyardExile(session([player]), "p", "Bojuka Bog");
    expect(result.pendingGraveyardDepartures ?? []).toHaveLength(0);
  });
});

describe("findCardsLeftGraveyardTriggers", () => {
  it("returns one trigger for the graveyard owner's Willow Geist and Insidious Roots, none for an opponent's copy", () => {
    const owner = seat({ id: "owner", name: "You", kind: "human", board: { hand: [], battlefield: [willowGeist(), insidiousRoots()] } });
    const opponent = seat({ id: "opponent", name: "Malik", kind: "agent", board: { hand: [], battlefield: [willowGeist({ id: "opponent-willow" })] } });
    const triggers = findCardsLeftGraveyardTriggers(session([owner, opponent]), "owner");

    expect(triggers).toHaveLength(2);
    expect(triggers.map((t) => t.sourceCardId).sort()).toEqual(["insidious-roots", "willow-geist"]);
    expect(triggers.every((t) => t.controllerSeatId === "owner")).toBe(true);
  });

  it("returns nothing for a seat with no matching permanents", () => {
    const owner = seat({ id: "owner", name: "You", kind: "human", board: { hand: [], battlefield: [] } });
    expect(findCardsLeftGraveyardTriggers(session([owner]), "owner")).toHaveLength(0);
  });
});

describe("commonTriggerEffect(..., \"cards_left_graveyard\")", () => {
  it("parses Willow Geist's clause into a self +1/+1 counter", () => {
    const effect = commonTriggerEffect(WILLOW_GEIST_ORACLE_TEXT, "cards_left_graveyard");
    expect(effect).toEqual({ kind: "add_counter", counterKind: "+1/+1", amount: 1, scope: "self" });
  });

  it("parses Insidious Roots' clause into create_tokens with a chained each-Plant-you-control counter", () => {
    const effect = commonTriggerEffect(INSIDIOUS_ROOTS_ORACLE_TEXT, "cards_left_graveyard");
    expect(effect?.kind).toBe("create_tokens");
    expect(effect?.then).toEqual({ kind: "add_counter", counterKind: "+1/+1", amount: 1, scope: "each_matching_you_control", matcher: "plant" });
  });
});

describe("resolveTriggerEffect — Insidious Roots' compound create-then-counter effect", () => {
  it("creates a new Plant token AND puts a +1/+1 counter on every Plant you control, not just the new one", () => {
    const player = seat({
      id: "p",
      name: "You",
      kind: "human",
      board: { hand: [], battlefield: [insidiousRoots(), plantToken("plant-1"), plantToken("plant-2")] }
    });
    const effect = commonTriggerEffect(INSIDIOUS_ROOTS_ORACLE_TEXT, "cards_left_graveyard");
    expect(effect).toBeDefined();

    const result = resolveTriggerEffect(session([player]), {
      id: "trigger-1",
      type: "trigger",
      actorSeatId: "p",
      controllerSeatId: "p",
      sourceCardId: "insidious-roots",
      sourceCardName: "Insidious Roots",
      triggerKind: "common",
      effect: effect!,
      message: ""
    });

    const after = result.seats.find((s) => s.id === "p")!;
    const plants = after.board.battlefield.filter((c) => c.typeLine.includes("Plant"));
    expect(plants).toHaveLength(3);
    for (const plant of plants) {
      expect(plant.counters?.find((counter) => counter.kind === "+1/+1")?.count).toBe(1);
    }
  });
});
