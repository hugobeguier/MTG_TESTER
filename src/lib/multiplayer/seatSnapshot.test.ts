import { describe, expect, it } from "vitest";
import type { GameSession, PlayerSeat, VisibleCard } from "../types";
import { buildSnapshot, isMpSnapshot, type SnapshotInput } from "./snapshot";
import { defaultSeatStopSettings } from "./seatStops";

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

describe("per-seat prompts (seatPrompts.ts) in a seated snapshot", () => {
  const promptInput = (): SnapshotInput => {
    const base = makeInput();
    const session = { ...base.session, seats: base.session.seats.map((s) => (s.id === "seat-a" ? { ...s, board: { ...s.board, battlefield: s.board.battlefield.map((c) => ({ ...c, attacking: true })) } } : s)) };
    return withPrompts({ ...base, session });
  };
  const withPrompts = (base: SnapshotInput): SnapshotInput =>
    ({
      ...base,
      gameStage: "playing",
      activeSeatId: "seat-c",
      prompts: {
        pendingRuleChoice: { id: "r1", kind: "choose_card_from_library", controllerSeatId: "seat-c", sourceCardId: "x", sourceCardName: "SecretSource-c", prompt: "Search", destination: "hand", maxChoices: 1 } as never,
        libraryLook: { seatId: "seat-b", mode: "scry", cards: [card("seat-b-l0", "SecretLib-b0", "library")], remaining: 1 },
        manaChoice: { seatId: "seat-c", cardId: "seat-c-bf", cardName: "SecretMana-c", location: "battlefield", choices: ["G", "U"] },
        blockChoice: { attackerSeatId: "seat-a", defenderSeatId: "seat-c", attackerCardId: "seat-a-bf", targetId: "seat-c" }
      },
      landPlayed: { "seat-b": true }
    });

  it("gives each seat only the prompts addressed to it, and never puts another seat's prompt content on the wire", () => {
    const b = buildSnapshot(promptInput(), "seat-b");
    const c = buildSnapshot(promptInput(), "seat-c");
    const a = buildSnapshot(promptInput(), "seat-a");
    expect(b.prompts?.libraryLook?.cards.map((x) => x.name)).toEqual(["SecretLib-b0"]);
    expect(b.prompts?.ruleChoice).toBeUndefined();
    expect(b.prompts?.manaChoice).toBeUndefined();
    expect(b.prompts?.blockChoice).toBeUndefined();
    expect(c.prompts?.manaChoice).toEqual({ cardName: "SecretMana-c", choices: ["G", "U"] });
    expect(c.prompts?.blockChoice).toBeDefined();
    expect(c.prompts?.libraryLook).toBeUndefined();
    expect(a.prompts?.libraryLook).toBeUndefined();
    const bJson = JSON.stringify(b);
    const cJson = JSON.stringify(c);
    for (const secret of ["SecretMana-c", "SecretSource-c", ...secretsOf("c")]) expect(bJson, secret).not.toContain(secret);
    for (const secret of ["SecretLib-b0", ...secretsOf("b")]) expect(cJson, secret).not.toContain(secret);
    // a spectator gets no prompts at all
    expect(buildSnapshot(promptInput(), "spectator").prompts).toBeUndefined();
    expect(JSON.stringify(buildSnapshot(promptInput(), "spectator"))).not.toContain("SecretMana-c");
  });

  it("carries the viewer's own ack, the pause names, and renames the host seat 'You' for guests", () => {
    const input = promptInput();
    input.session = { ...input.session, seats: input.session.seats.map((s) => (s.id === "seat-a" ? { ...s, name: "You" } : s)), events: [{ id: "e9", at: "t", seatId: "seat-a", message: "You pass to main phase." }, ...input.session.events] };
    const snap = buildSnapshot({ ...input, ack: { seq: 7, error: "it is not your turn" }, pausedFor: ["Player c"] }, "seat-b");
    expect(snap.ack).toEqual({ seq: 7, error: "it is not your turn" });
    expect(snap.pausedFor).toEqual(["Player c"]);
    expect(snap.session.seats.find((s) => s.id === "seat-a")?.name).toBe("Hugo");
    expect(snap.session.events[0].message).toBe("Hugo passes to main phase.");
    expect(buildSnapshot(input, "spectator").ack).toBeUndefined();
  });
});

describe("friend stop settings in the snapshot", () => {
  it("a seated viewer gets only their OWN settings (defaults when none were set); a spectator gets none", () => {
    const own = { ...defaultSeatStopSettings(2, 4), fullControl: true, holdOnce: true };
    const other = { ...defaultSeatStopSettings(1, 4), stopOnAttacked: false };
    const input = makeInput({ seatStops: { "seat-c": own, "seat-b": other } });
    expect(buildSnapshot(input, "seat-c").myStops).toEqual(own);
    expect(JSON.stringify(buildSnapshot(input, "seat-c")).includes('"stopOnAttacked":false')).toBe(false); // seat-b's choice stays on the host
    expect(buildSnapshot(makeInput(), "seat-b").myStops).toEqual(defaultSeatStopSettings(1, 4));
    expect(buildSnapshot(input, "spectator").myStops).toBeUndefined();
  });
});

describe("snapshot size", () => {
  it("carries no seat's deck list (the biggest part of a snapshot, never read by the table), not even the viewer's own", () => {
    for (const viewer of [...LETTERS.map((l) => `seat-${l}`), "spectator"]) {
      const snap = buildSnapshot(makeInput(), viewer);
      for (const s of snap.session.seats) expect((s as { deck?: unknown }).deck, viewer).toBeUndefined();
      expect(JSON.stringify(snap)).not.toContain("DeckOnly");
    }
  });
});

describe("friend yield in the snapshot", () => {
  it("a seated viewer learns only whether THEY are yielding; the others' yields never reach them", () => {
    const input = makeInput({ yieldingSeatIds: ["seat-c"] });
    expect(buildSnapshot(input, "seat-c").myYield).toBe(true);
    expect(buildSnapshot(input, "seat-b").myYield).toBe(false);
    expect(buildSnapshot(input, "spectator").myYield).toBeUndefined();
    expect(JSON.stringify(buildSnapshot(input, "seat-b")).includes("seat-c\"]")).toBe(false);
  });
});
