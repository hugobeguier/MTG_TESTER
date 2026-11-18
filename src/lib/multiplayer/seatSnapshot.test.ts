import { describe, expect, it } from "vitest";
import type { GameSession, PlayerSeat, VisibleCard } from "../types";
import { buildSnapshot, isMpSnapshot, type SnapshotInput } from "./snapshot";

function card(id: string, name: string, zone: VisibleCard["zone"]): VisibleCard {
  return { id, name, typeLine: `Type of ${name}`, oracleText: `Text of ${name}`, manaCost: "{3}", manaValue: 3, colors: ["U"], role: "x", zone };
}

const LETTERS = ["a", "b", "c", "d"];

function seat(letter: string): PlayerSeat {
  const id = `seat-${letter}`;
  const hand = Array.from({ length: 7 }, (_, i) => card(`${id}-h${i}`, `SecretHand-${letter}${i}`, "hand"));
  const library = Array.from({ length: 30 }, (_, i) => card(`${id}-l${i}`, `SecretLib-${letter}${i}`, "library"));
  const kind = letter === "d" ? "agent" : "human";
  const remoteSlot = letter === "b" ? "guest-1" : letter === "c" ? "guest-2" : undefined;
  return {
    id, name: `Player ${letter}`, kind, ...(remoteSlot ? { remoteSlot } : {}), life: 40, commanderDamage: {},
    zones: { library: library.length, hand: hand.length, battlefield: 1, graveyard: 1, exile: 0, command: 1 },
    library,
    deck: { id: `d-${letter}`, name: `SecretDeck-${letter}`, commander: `Cmdr-${letter}`, cards: [{ name: `DeckOnly-${letter}`, count: 1 }] } as unknown as PlayerSeat["deck"],
    board: {
      commander: card(`${id}-cmd`, `Cmdr-${letter}`, "command"),
      hand,
      battlefield: [card(`${id}-bf`, `Field-${letter}`, "battlefield")],
      graveyard: [card(`${id}-gy`, `Grave-${letter}`, "graveyard")],
      exile: []
    }
  } as PlayerSeat;
}

function makeInput(over: Partial<SnapshotInput> = {}): SnapshotInput {
  const seats = LETTERS.map(seat);
  const events = [{ id: "e1", at: "t", message: "Player a discards SecretHand-a2", seatId: "seat-a" }, { id: "e0", at: "t", message: "Player c reveals nothing" }];
  const session = {
    id: "s", createdAt: "now", status: "ready", phase: "opening hand", turn: 0, activePlayerId: "seat-a",
    xmage: { enabled: false, status: "offline", message: "" },
    seats, events,
    pendingDiscoverChoices: LETTERS.map((l) => ({ seatId: `seat-${l}`, cardId: `x-${l}`, cardName: `SecretPrompt-${l}`, sourceName: "s" }))
  } as unknown as GameSession;
  return {
    session, hostName: "Hugo", priorityPasses: [], stackActions: [], gameStage: "mulligan",
    mulligans: { "seat-a": 0, "seat-b": 2, "seat-c": 0 },
    keptHands: { "seat-a": true, "seat-d": true },
    mulliganReturnCardIds: { "seat-b": ["seat-b-h1"], "seat-c": ["seat-c-h4"] },
    manaPools: { "seat-b": { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 } },
    ...over
  };
}

const secretsOf = (letter: string) => [
  ...Array.from({ length: 7 }, (_, i) => [`seat-${letter}-h${i}`, `SecretHand-${letter}${i}`]).flat(),
  ...Array.from({ length: 30 }, (_, i) => [`seat-${letter}-l${i}`, `SecretLib-${letter}${i}`]).flat(),
  `SecretDeck-${letter}`, `DeckOnly-${letter}`, `SecretPrompt-${letter}`, `x-${letter}`
];

describe("buildSnapshot for a seated viewer", () => {
  it("leaks nothing private of any OTHER seat (hand, library, deck, prompts), whichever seat is the viewer", () => {
    for (const viewer of LETTERS) {
      const json = JSON.stringify(buildSnapshot(makeInput(), `seat-${viewer}`, 3));
      for (const other of LETTERS.filter((l) => l !== viewer)) {
        for (const secret of secretsOf(other)) expect(json, `viewer ${viewer} leaks ${secret}`).not.toContain(secret);
      }
      for (const l of LETTERS) expect(json).toContain(`Field-${l}`); // public things stay
    }
  });

  it("shows the viewer's own hand face-up as the only human; everyone else is an 'agent' with a hidden hand of the right size", () => {
    const snap = buildSnapshot(makeInput(), "seat-b", 1);
    expect(snap.viewer).toBe("seat-b");
    expect(snap.mySeatId).toBe("seat-b");
    expect(snap.hostSeatId).toBe("seat-a");
    expect(snap.session.seats.filter((s) => s.kind === "human").map((s) => s.id)).toEqual(["seat-b"]);
    const mine = snap.session.seats.find((s) => s.id === "seat-b")!;
    expect(mine.board.hand.map((c) => c.name)).toEqual(Array.from({ length: 7 }, (_, i) => `SecretHand-b${i}`));
    for (const s of snap.session.seats.filter((x) => x.id !== "seat-b")) {
      expect(s.board.hand).toHaveLength(7);
      expect(s.board.hand.every((c) => c.role === "hidden")).toBe(true);
    }
    expect(snap.myManaPool?.W).toBe(1);
    expect(isMpSnapshot(JSON.parse(JSON.stringify(snap)))).toBe(true);
  });

  it("carries only the viewer's own mulligan state, plus the public list of names still deciding", () => {
    const snap = buildSnapshot(makeInput(), "seat-b");
    expect(snap.mulligan).toEqual({ kept: false, returnCardIds: ["seat-b-h1"], returnRequired: 1 }); // 2 mulligans -> keep 6 of 7
    expect(snap.mulliganWaiting).toEqual(["Player b", "Player c"]);
    expect(buildSnapshot(makeInput({ keptHands: { "seat-d": true } }), "seat-b").mulliganWaiting).toEqual(["Hugo", "Player b", "Player c"]); // host seat is shown by its player name
    const other = buildSnapshot(makeInput(), "seat-c");
    expect(other.mulligan?.returnCardIds).toEqual(["seat-c-h4"]);
    expect(JSON.stringify(other)).not.toContain("seat-b-h1");
    const kept = buildSnapshot(makeInput({ keptHands: { "seat-a": true, "seat-b": true, "seat-d": true } }), "seat-b");
    expect(kept.mulligan).toMatchObject({ kept: true, returnRequired: 0 });
  });

  it("has no mulligan state outside the mulligan step or for a spectator", () => {
    expect(buildSnapshot(makeInput({ gameStage: "playing" }), "seat-b").mulligan).toBeUndefined();
    expect(buildSnapshot(makeInput({ gameStage: "playing" }), "seat-b").mulliganWaiting).toEqual([]);
    const spectator = buildSnapshot(makeInput(), "spectator");
    expect(spectator.mySeatId).toBeUndefined();
    expect(spectator.mulligan).toBeUndefined();
    expect(JSON.stringify(spectator)).not.toContain("seat-b-h1");
  });

  it("rejects an unknown seat", () => {
    expect(() => buildSnapshot(makeInput(), "seat-zzz")).toThrow();
  });
});
