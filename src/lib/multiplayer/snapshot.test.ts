import { describe, expect, it } from "vitest";
import type { GameSession, PlayerSeat, VisibleCard } from "../types";
import { SNAPSHOT_MAX_EVENTS, buildSnapshot, isMpSnapshot, snapshotFingerprint, type SnapshotInput } from "./snapshot";
import { SPECTATOR_VIEWER, filterForSeat, relabelForGuest } from "./view";

function card(id: string, name: string, zone: VisibleCard["zone"], extra: Partial<VisibleCard> = {}): VisibleCard {
  return { id, name, typeLine: `Type of ${name}`, oracleText: `Text of ${name}`, manaCost: "{3}", manaValue: 3, colors: ["U"], role: "x", zone, ...extra };
}

const LETTERS = ["a", "b", "c", "d"];

function seat(letter: string, kind: "human" | "agent"): PlayerSeat {
  const id = `seat-${letter}`;
  const hand = Array.from({ length: 7 }, (_, i) => card(`${id}-h${i}`, `SecretHand-${letter}${i}`, "hand"));
  const library = Array.from({ length: 92 }, (_, i) => card(`${id}-l${i}`, `SecretLib-${letter}${i}`, "library"));
  return {
    id, name: `Player ${letter}`, kind, life: 40, commanderDamage: {},
    zones: { library: library.length, hand: hand.length, battlefield: 1, graveyard: 1, exile: 0, command: 1 },
    library,
    deck: { id: `d-${letter}`, name: `SecretDeck-${letter}`, commander: `Cmdr-${letter}`, cards: [{ name: `DeckOnly-${letter}`, count: 1 }] } as unknown as PlayerSeat["deck"],
    board: {
      commander: card(`${id}-cmd`, `Cmdr-${letter}`, "command", { commander: true }),
      hand,
      battlefield: [card(`${id}-bf`, `Field-${letter}`, "battlefield")],
      graveyard: [card(`${id}-gy`, `Grave-${letter}`, "graveyard")],
      exile: []
    }
  };
}

function makeInput(): SnapshotInput {
  const seats = LETTERS.map((l, i) => seat(l, i === 0 ? "human" : "agent"));
  // newest first, like the real log
  const events = Array.from({ length: 300 }, (_, i) => ({ id: `e${299 - i}`, at: "t", message: `event ${299 - i}` }));
  events.unshift({ id: "leak", at: "t", message: "Player b discards SecretHand-b2", seatId: "seat-b" } as never);
  const session = {
    id: "s", createdAt: "now", status: "playing", phase: "main", turn: 3, activePlayerId: "seat-a",
    xmage: { enabled: false, status: "offline", message: "" },
    seats, events,
    pendingDiscoverChoices: [{ seatId: "seat-a", cardId: "x", cardName: "SecretPrompt", sourceName: "s" }]
  } as unknown as GameSession;
  return {
    session, hostName: "Hugo", activeSeatId: "seat-b", prioritySeatId: "seat-c", priorityPasses: ["seat-a"], requiredPasses: ["seat-c"],
    stackActions: [{ id: "st1", type: "phase", actorSeatId: "seat-b", message: "Phase change" }], gameStage: "playing", mulligans: { "seat-a": 1 }
  };
}

describe("buildSnapshot (spectator)", () => {
  it("leaks no hidden card name, deck or prompt anywhere in the JSON", () => {
    const input = makeInput();
    const json = JSON.stringify(buildSnapshot(input, SPECTATOR_VIEWER, 5));
    for (const l of LETTERS) {
      for (let i = 0; i < 7; i += 1) expect(json).not.toContain(`SecretHand-${l}${i}`);
      for (let i = 0; i < 92; i += 1) expect(json).not.toContain(`SecretLib-${l}${i}`);
      expect(json).not.toContain(`SecretDeck-${l}`);
      expect(json).not.toContain(`DeckOnly-${l}`);
    }
    expect(json).not.toContain("SecretPrompt");
    // public things stay
    expect(json).toContain("Field-b");
    expect(json).toContain("Grave-c");
    expect(json).toContain("Cmdr-d");
  });

  it("shows exactly one human (the host seat) with a hidden hand of the right size", () => {
    const snap = buildSnapshot(makeInput(), SPECTATOR_VIEWER, 1);
    expect(snap.session.seats.filter((s) => s.kind === "human").map((s) => s.id)).toEqual(["seat-a"]);
    expect(snap.hostSeatId).toBe("seat-a");
    for (const s of snap.session.seats) {
      expect(s.board.hand).toHaveLength(7);
      expect(s.board.hand.every((c) => c.role === "hidden")).toBe(true);
    }
  });

  it("trims events to the newest ones, aligns activePlayerId and carries the public stack info", () => {
    const snap = buildSnapshot(makeInput(), SPECTATOR_VIEWER);
    expect(snap.session.events).toHaveLength(SNAPSHOT_MAX_EVENTS);
    expect(snap.session.events.some((e) => e.id === "e299")).toBe(true);
    expect(snap.session.events.some((e) => e.id === "e0")).toBe(false);
    expect(snap.session.events[0].message).toBe("Player b discards a card");
    expect(snap.session.activePlayerId).toBe("seat-b");
    expect(snap.stackActions).toHaveLength(1);
    expect(snap.requiredPasses).toEqual(["seat-c"]);
    expect(snap.mulligans).toEqual({ "seat-a": 1 });
  });

  it("is deterministic, does not mutate its input and stays small", () => {
    const input = makeInput();
    const before = JSON.stringify(input);
    const a = JSON.stringify(buildSnapshot(input, SPECTATOR_VIEWER, 2));
    const b = JSON.stringify(buildSnapshot(input, SPECTATOR_VIEWER, 2));
    expect(a).toBe(b);
    expect(JSON.stringify(input)).toBe(before);
    expect(a.length).toBeLessThan(500_000);
    expect(isMpSnapshot(JSON.parse(a))).toBe(true);
  });

  it("fingerprint ignores rev but notices real changes", () => {
    const input = makeInput();
    expect(snapshotFingerprint(buildSnapshot(input, SPECTATOR_VIEWER, 1))).toBe(snapshotFingerprint(buildSnapshot(input, SPECTATOR_VIEWER, 9)));
    expect(snapshotFingerprint(buildSnapshot({ ...input, prioritySeatId: "seat-d" }, SPECTATOR_VIEWER, 1))).not.toBe(snapshotFingerprint(buildSnapshot(input, SPECTATOR_VIEWER, 1)));
  });
});

describe("spectator mode in view.ts", () => {
  it("filterForSeat(SPECTATOR_VIEWER) stubs every hand and drops every seat prompt and deck", () => {
    const { session } = makeInput();
    const view = filterForSeat(session, SPECTATOR_VIEWER);
    for (const s of view.seats) {
      expect(s.board.hand.every((c) => c.role === "hidden")).toBe(true);
      expect(s.deck).toBeUndefined();
    }
    expect(view.pendingDiscoverChoices).toEqual([]);
  });

  it("still rejects an unknown seat id and relabels the first human as the only human", () => {
    const { session } = makeInput();
    expect(() => filterForSeat(session, "nobody")).toThrow();
    const relabelled = relabelForGuest(session, SPECTATOR_VIEWER);
    expect(relabelled.seats.map((s) => s.kind)).toEqual(["human", "agent", "agent", "agent"]);
  });
});
