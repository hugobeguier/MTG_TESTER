import { describe, expect, it } from "vitest";
import type { GameSession, PlayerSeat, VisibleCard } from "../types";
import { SPECTATOR_VIEWER, buildGuestSession, filterForSeat, relabelForGuest } from "./view";

function card(id: string, name: string, zone: VisibleCard["zone"], extra: Partial<VisibleCard> = {}): VisibleCard {
  return { id, name, typeLine: `Secret Type of ${name}`, oracleText: `Secret text of ${name}`, manaCost: "{9}", manaValue: 9, colors: ["R"], role: "x", zone, ...extra };
}

const IDS = ["a", "b", "c", "d"];

function seat(letter: string, kind: "human" | "agent"): PlayerSeat {
  const id = `seat-${letter}`;
  const hand = [0, 1, 2].map((i) => card(`${id}-h${i}`, `HandCard-${letter}${i}`, "hand"));
  const library = [0, 1, 2, 3].map((i) => card(`${id}-l${i}`, `LibCard-${letter}${i}`, "library"));
  return {
    id,
    name: `Player ${letter}`,
    kind,
    life: 40,
    commanderDamage: {},
    zones: { library: library.length, hand: hand.length, battlefield: 1, graveyard: 1, exile: 0, command: 1 },
    library,
    deck: { id: `deck-${letter}`, name: `SecretDeck-${letter}`, commander: `Cmdr-${letter}`, cards: [{ name: `DeckOnly-${letter}`, count: 1 }] } as unknown as PlayerSeat["deck"],
    board: {
      commander: card(`${id}-cmd`, `Cmdr-${letter}`, "command", { commander: true }),
      hand,
      battlefield: [card(`${id}-bf`, `Field-${letter}`, "battlefield")],
      graveyard: [card(`${id}-gy`, `Grave-${letter}`, "graveyard")],
      exile: []
    }
  };
}

function makeSession(): GameSession {
  const seats = IDS.map((l, i) => seat(l, i === 0 ? "human" : "agent"));
  const events = Array.from({ length: 150 }, (_, i) => ({ id: `e${i}`, at: "t", message: `event ${i}` }));
  events.push({ id: "leak", at: "t", message: "Player b draws HandCard-b1 and plays Field-b", seatId: "seat-b" } as never);
  events.push({ id: "own", at: "t", message: "Player a casts HandCard-a0", seatId: "seat-a" } as never);
  return {
    id: "s1", createdAt: "now", status: "playing", phase: "main", turn: 3,
    xmage: { enabled: false, status: "offline", message: "" },
    seats, events,
    pendingDiscoverChoices: [{ seatId: "seat-b", cardId: "x", cardName: "DiscoverSecret", sourceName: "s" }, { seatId: "seat-a", cardId: "y", cardName: "MineDiscover", sourceName: "s" }]
  };
}

const hiddenNamesOf = (s: GameSession, notSeat: string) =>
  s.seats.filter((x) => x.id !== notSeat).flatMap((x) => [...x.board.hand, ...(x.library ?? [])].map((c) => c.name));

describe("filterForSeat", () => {
  for (const viewer of IDS.map((l) => `seat-${l}`)) {
    it(`hides private info from ${viewer} (leak test)`, () => {
      const session = makeSession();
      const before = JSON.stringify(session);
      const view = filterForSeat(session, viewer);
      expect(JSON.stringify(session)).toBe(before); // input untouched
      const json = JSON.stringify(view);
      for (const name of hiddenNamesOf(session, viewer)) expect(json).not.toContain(name);
      for (const l of IDS) {
        if (`seat-${l}` !== viewer) {
          expect(json).not.toContain(`SecretDeck-${l}`);
          expect(json).not.toContain(`DeckOnly-${l}`);
        }
      }

      for (const s of view.seats) {
        const orig = session.seats.find((x) => x.id === s.id)!;
        expect(s.board.hand).toHaveLength(orig.board.hand.length);
        expect(s.library).toHaveLength(orig.library!.length);
        expect(s.zones.library).toBe(orig.zones.library);
        expect(s.board.graveyard).toEqual(orig.board.graveyard);
        expect(s.board.battlefield).toEqual(orig.board.battlefield);
        expect(s.board.commander).toEqual(orig.board.commander);
        if (s.id === viewer) expect(s.board.hand).toEqual(orig.board.hand);
        else {
          expect(s.board.hand.every((c) => c.name === "Hidden card" && c.oracleText === "")).toBe(true);
          expect(s.deck).toBeUndefined();
        }
        expect(s.library!.every((c) => c.name === "Hidden card")).toBe(true);
      }
    });
  }

  it("trims events and redacts hidden names in them", () => {
    const view = filterForSeat(makeSession(), "seat-a", { maxEvents: 10 });
    expect(view.events).toHaveLength(10);
    const leak = view.events.find((e) => e.id === "leak")!;
    expect(leak.message).toBe("Player b draws a card and plays Field-b"); // Field-b is public
    expect(view.events.find((e) => e.id === "own")!.message).toContain("HandCard-a0");
    expect(filterForSeat(makeSession(), "seat-a").events).toHaveLength(100);
  });

  it("keeps only the viewer's pending prompts", () => {
    const view = filterForSeat(makeSession(), "seat-a");
    expect(view.pendingDiscoverChoices?.map((c) => c.seatId)).toEqual(["seat-a"]);
  });

  it("stubs face-down identities of other seats only", () => {
    const session = makeSession();
    session.seats[1].board.battlefield.push(card("fd", "Manifested Creature", "battlefield", { faceDownCardName: "RealManifest" }));
    session.seats[0].board.battlefield.push(card("fd0", "Manifested Creature", "battlefield", { faceDownCardName: "MyManifest" }));
    expect(JSON.stringify(filterForSeat(session, "seat-a"))).not.toContain("RealManifest");
    expect(JSON.stringify(filterForSeat(session, "seat-a"))).toContain("MyManifest");
    expect(JSON.stringify(filterForSeat(session, "seat-b"))).toContain("RealManifest");
  });

  it("honours revealedCardIds (extension point) and is deterministic", () => {
    const session = makeSession();
    const revealed = new Set(["seat-b-h1", "seat-c-l2"]);
    const view = filterForSeat(session, "seat-a", { revealedCardIds: revealed });
    expect(view.seats[1].board.hand[1].name).toBe("HandCard-b1");
    expect(view.seats[1].board.hand[0].name).toBe("Hidden card");
    expect(view.seats[2].library![2].name).toBe("LibCard-c2");
    expect(view.events.find((e) => e.id === "leak")!.message).toContain("HandCard-b1");
    expect(JSON.stringify(filterForSeat(session, "seat-a", { revealedCardIds: revealed }))).toBe(JSON.stringify(view));
    expect(JSON.stringify(filterForSeat(session, "seat-a"))).toBe(JSON.stringify(filterForSeat(session, "seat-a")));
  });

  it("throws for an unknown seat", () => {
    expect(() => filterForSeat(makeSession(), "nope")).toThrow();
  });
});

describe("relabelForGuest / buildGuestSession", () => {
  it("makes exactly the viewer human, for every viewer, without mutating", () => {
    const session = makeSession();
    const before = JSON.stringify(session);
    for (const l of IDS) {
      const id = `seat-${l}`;
      const guest = relabelForGuest(session, id);
      expect(guest.seats.filter((s) => s.kind === "human").map((s) => s.id)).toEqual([id]);
      expect(guest.seats.every((s) => s.kind === "agent" || s.id === id)).toBe(true);
      expect(guest.seats.map((s) => s.name)).toEqual(session.seats.map((s) => s.name));
      const full = buildGuestSession(session, id);
      expect(full.seats.filter((s) => s.kind === "human")).toHaveLength(1);
      expect(JSON.stringify(full)).not.toContain("HandCard-" + (l === "a" ? "b" : "a"));
    }
    expect(JSON.stringify(session)).toBe(before);
  });
});

describe("relabelForGuest with a remote human seat", () => {
  it("spectator view is anchored on the host's human seat, not the remote friend's", () => {
    const session = makeSession();
    session.seats[0].kind = "agent"; // seat-a: AI listed first
    session.seats[1].kind = "human";
    session.seats[1].remoteSlot = "guest-1"; // seat-b: remote friend
    session.seats[2].kind = "human"; // seat-c: the host
    const spectator = relabelForGuest(session, SPECTATOR_VIEWER);
    expect(spectator.seats.filter((s) => s.kind === "human").map((s) => s.id)).toEqual(["seat-c"]);
    expect(relabelForGuest(session, "seat-b").seats.filter((s) => s.kind === "human").map((s) => s.id)).toEqual(["seat-b"]);
  });
});
