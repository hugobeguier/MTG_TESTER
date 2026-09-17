import { describe, expect, it } from "vitest";
import {
  applyDeterministicPhaseTrigger,
  isRecognizedBoardCondition,
  putLookedAtCardsInGraveyard,
  putLookedAtCardsOnBottom,
  resolveAgentLibraryLookWorkflow
} from "./AppFlow";
import type { CardFaceRecord, GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "typeLine">): VisibleCard {
  return { oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "battlefield", ...overrides };
}

function face(overrides: Partial<CardFaceRecord> & Pick<CardFaceRecord, "name" | "typeLine" | "oracleText">): CardFaceRecord {
  return { colors: [], ...overrides };
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
    phase: "end step",
    turn: 1,
    xmage: { enabled: false, status: "not_configured", message: "" },
    seats,
    events: []
  };
}

function bear(id: string): VisibleCard {
  return card({ id, name: "Grizzly Bears", typeLine: "Creature — Bear" });
}

const GROWING_RITES_ORACLE_TEXT =
  "When Growing Rites of Itlimoc enters, look at the top four cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in any order.\nAt the beginning of your end step, if you control four or more creatures, transform Growing Rites of Itlimoc.";

function growingRites(overrides: Partial<VisibleCard> = {}): VisibleCard {
  return card({
    id: "growing-rites",
    name: "Growing Rites of Itlimoc",
    typeLine: "Legendary Enchantment",
    oracleText: GROWING_RITES_ORACLE_TEXT,
    faces: [
      face({ name: "Growing Rites of Itlimoc", typeLine: "Legendary Enchantment", oracleText: GROWING_RITES_ORACLE_TEXT, manaCost: "{2}{G}" }),
      face({ name: "Itlimoc, Cradle of the Sun", typeLine: "Legendary Land", oracleText: "(Transforms from Growing Rites of Itlimoc.)\n{T}: Add {G}.\n{T}: Add {G} for each creature you control.", manaCost: "" })
    ],
    ...overrides
  });
}

describe("isRecognizedBoardCondition", () => {
  it("recognizes Growing Rites of Itlimoc's exact creature-count condition", () => {
    expect(isRecognizedBoardCondition("you control four or more creatures")).toBe(true);
  });

  it("does not falsely recognize an arbitrary unmodeled condition", () => {
    expect(isRecognizedBoardCondition("you have cast a spell this turn")).toBe(false);
  });
});

describe("applyDeterministicPhaseTrigger — Growing Rites of Itlimoc's conditional transform", () => {
  it("does not transform with fewer than four creatures (a real, checked no-op, not a decline)", () => {
    const player = seat({
      id: "p",
      name: "You",
      kind: "human",
      board: { hand: [], battlefield: [growingRites(), bear("b1"), bear("b2"), bear("b3")] }
    });
    const result = applyDeterministicPhaseTrigger(session([player]), "p", growingRites(), "end step");
    expect(result).toBeDefined();
    const after = result!.seats.find((s) => s.id === "p")!;
    expect(after.board.battlefield.find((c) => c.id === "growing-rites")?.name).toBe("Growing Rites of Itlimoc");
  });

  it("transforms once the controller has four or more creatures", () => {
    const player = seat({
      id: "p",
      name: "You",
      kind: "human",
      board: { hand: [], battlefield: [growingRites(), bear("b1"), bear("b2"), bear("b3"), bear("b4")] }
    });
    const result = applyDeterministicPhaseTrigger(session([player]), "p", growingRites(), "end step");
    expect(result).toBeDefined();
    const after = result!.seats.find((s) => s.id === "p")!;
    expect(after.board.battlefield.find((c) => c.id === "growing-rites")?.name).toBe("Itlimoc, Cradle of the Sun");
  });

  it("still declines (undefined) for an unrecognized 'if' condition, unchanged from before (regression guard)", () => {
    const weirdConditionCard = card({
      id: "weird",
      name: "Weird Trigger Card",
      typeLine: "Creature — Bear",
      oracleText: "At the beginning of your upkeep, if you have cast a spell this turn, draw a card."
    });
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [weirdConditionCard] } });
    expect(applyDeterministicPhaseTrigger(session([player]), "p", weirdConditionCard, "upkeep step")).toBeUndefined();
  });
});

describe("putLookedAtCardsOnBottom", () => {
  it("moves the given cards to the bottom of the library, preserving their relative order", () => {
    const remaining = [card({ id: "c1", name: "Card 1", typeLine: "Creature — Bear", zone: "library" }), card({ id: "c2", name: "Card 2", typeLine: "Instant", zone: "library" })];
    const alreadyThere = card({ id: "deep", name: "Deep Card", typeLine: "Sorcery", zone: "library" });
    const player = seat({ id: "p", name: "You", kind: "human", library: [alreadyThere] });
    const result = putLookedAtCardsOnBottom(session([player]), "p", remaining);
    const after = result.seats.find((s) => s.id === "p")!;
    expect(after.library?.map((c) => c.id)).toEqual(["deep", "c1", "c2"]);
  });
});

describe("resolveAgentLibraryLookWorkflow — look_at_top_cards_reveal_type_to_hand", () => {
  it("picks a creature over a land among the looked-at cards, and sends the rest to the bottom", () => {
    const forest = card({ id: "forest", name: "Forest", typeLine: "Basic Land — Forest", zone: "library" });
    const smallBear = card({ id: "small", name: "Small Bear", typeLine: "Creature — Bear", manaValue: 1, zone: "library" });
    const bigBear = card({ id: "big", name: "Big Bear", typeLine: "Creature — Bear", manaValue: 3, zone: "library" });
    const instant = card({ id: "bolt", name: "Lightning Bolt", typeLine: "Instant", zone: "library" });
    const player = seat({ id: "p", name: "You", kind: "agent", library: [forest, smallBear, bigBear, instant] });
    const result = resolveAgentLibraryLookWorkflow(session([player]), "p", "Growing Rites of Itlimoc", "look_at_top_cards_reveal_type_to_hand", 4, "creature");
    const after = result.seats.find((s) => s.id === "p")!;
    expect(after.board.hand.map((c) => c.id)).toEqual(["big"]);
    expect(after.library?.map((c) => c.id).sort()).toEqual(["bolt", "forest", "small"]);
  });

  it("sends everything to the bottom (nothing to hand) when no card matches the filter", () => {
    const forest = card({ id: "forest", name: "Forest", typeLine: "Basic Land — Forest", zone: "library" });
    const instant = card({ id: "bolt", name: "Lightning Bolt", typeLine: "Instant", zone: "library" });
    const player = seat({ id: "p", name: "You", kind: "agent", library: [forest, instant] });
    const result = resolveAgentLibraryLookWorkflow(session([player]), "p", "Growing Rites of Itlimoc", "look_at_top_cards_reveal_type_to_hand", 2, "creature");
    const after = result.seats.find((s) => s.id === "p")!;
    expect(after.board.hand).toHaveLength(0);
    expect(after.library?.map((c) => c.id).sort()).toEqual(["bolt", "forest"]);
  });

  // Reported live: Grisly Salvage "does not work as intended" — its real "creature or land" filter
  // was checked as one literal substring against typeLine (which never contains "creature or land"
  // verbatim), so no card ever matched, and its "rest into your graveyard" destination was never
  // modeled at all (only "to the bottom" was).
  it("honors an 'X or Y' filter (Grisly Salvage's 'creature or land') and sends the rest to the graveyard", () => {
    const forest = card({ id: "forest", name: "Forest", typeLine: "Basic Land — Forest", manaValue: 0, zone: "library" });
    const bigBear = card({ id: "big", name: "Big Bear", typeLine: "Creature — Bear", manaValue: 3, zone: "library" });
    const instant = card({ id: "bolt", name: "Lightning Bolt", typeLine: "Instant", manaValue: 1, zone: "library" });
    const player = seat({ id: "p", name: "You", kind: "agent", library: [forest, bigBear, instant] });
    const result = resolveAgentLibraryLookWorkflow(
      session([player]),
      "p",
      "Grisly Salvage",
      "look_at_top_cards_reveal_type_to_hand",
      3,
      "creature or land",
      undefined,
      "graveyard"
    );
    const after = result.seats.find((s) => s.id === "p")!;
    expect(after.board.hand.map((c) => c.id)).toEqual(["big"]);
    expect(after.board.graveyard?.map((c) => c.id).sort()).toEqual(["bolt", "forest"]);
    expect(after.library ?? []).toHaveLength(0);
  });
});

describe("putLookedAtCardsInGraveyard", () => {
  it("moves the given cards to the graveyard, preserving their relative order", () => {
    const rest = [card({ id: "c1", name: "Card 1", typeLine: "Instant", zone: "library" }), card({ id: "c2", name: "Card 2", typeLine: "Sorcery", zone: "library" })];
    const player = seat({ id: "p", name: "You", kind: "human", library: [...rest] });
    const result = putLookedAtCardsInGraveyard(session([player]), "p", rest);
    const after = result.seats.find((s) => s.id === "p")!;
    expect(after.board.graveyard?.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(after.library ?? []).toHaveLength(0);
  });

  it("redirects a Blightsteel-Colossus-style card back into the library instead of the graveyard", () => {
    const blightsteel = card({
      id: "bc",
      name: "Blightsteel Colossus",
      typeLine: "Artifact Creature — Golem",
      oracleText: "If Blightsteel Colossus would be put into a graveyard from anywhere, reveal Blightsteel Colossus and shuffle it into its owner's library instead.",
      zone: "library"
    });
    const other = card({ id: "other", name: "Other Card", typeLine: "Instant", zone: "library" });
    const player = seat({ id: "p", name: "You", kind: "human", library: [blightsteel, other] });
    const result = putLookedAtCardsInGraveyard(session([player]), "p", [blightsteel, other]);
    const after = result.seats.find((s) => s.id === "p")!;
    expect(after.board.graveyard?.map((c) => c.id)).toEqual(["other"]);
    expect(after.library?.map((c) => c.id)).toEqual(["bc"]);
  });
});
