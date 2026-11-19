import { describe, expect, it } from "vitest";
import { miracleCostForCard, takeMiracleOffer } from "./costs";
import { drawForSeat, drawMultipleForSeat } from "./effects";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const AMINATOU = "At the beginning of your upkeep, surveil 2. (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)\nEach enchantment card in your hand has miracle. Its miracle cost is equal to its mana cost reduced by {4}. (You may cast this card for its miracle cost when you draw it if it's the first card you drew this turn.)\n";

function card(o: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "typeLine">): VisibleCard {
  return { oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "battlefield", ...o };
}
const aminatou = card({ id: "am", name: "Aminatou, Veil Piercer", typeLine: "Legendary Creature — Human Wizard", oracleText: AMINATOU, manaValue: 4, manaCost: "{2}{W}{U}" });
const enchantment = (id: string, mc = "{4}{W}{W}", mv = 6) => card({ id, name: `Ench ${id}`, typeLine: "Enchantment", manaCost: mc, manaValue: mv, zone: "library" });
const filler = (id: string) => card({ id, name: `Filler ${id}`, typeLine: "Creature — Bear", manaCost: "{1}{G}", manaValue: 2, zone: "library" });
const brainstorm = card({ id: "bs", name: "Brainstorm", typeLine: "Instant", manaCost: "{U}", manaValue: 1, oracleText: "Draw three cards, then put two cards from your hand on top of your library in any order.", zone: "hand" });

function seat(id: string, library: VisibleCard[], battlefield: VisibleCard[] = []): PlayerSeat {
  return { id, name: id, kind: "human", life: 40, commanderDamage: {}, zones: { library: library.length, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 }, library, board: { hand: [], battlefield } };
}
// Opponent's turn: p1 is the opponent (active), p2 holds Aminatou.
function game(p2: PlayerSeat, extra: Partial<GameSession> = {}): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 4, activePlayerId: "p1", xmage: { enabled: false, status: "not_configured", message: "" }, seats: [seat("p1", []), p2], events: [], ...extra } as GameSession;
}
const hand = (s: GameSession, id: string) => s.seats.find((x) => x.id === id)!.board.hand;

describe("miracle: first card drawn this turn, any player's turn (CR 702.94)", () => {
  it("Brainstorm on the opponent's turn with Aminatou: the first drawn enchantment is offered after the whole effect, at cost minus {4}", () => {
    const e = enchantment("e1");
    let s = game(seat("p2", [e, filler("f1"), filler("f2"), filler("f3")], [aminatou]));
    s = drawMultipleForSeat(s, "p2", 3, "Brainstorm draws 3");
    // Candidate is recorded by the draw itself; it survives the later draws of the same effect.
    expect(s.seats[1].drawnThisTurn).toMatchObject({ count: 3, miracleCandidateId: "e1" });
    const taken = takeMiracleOffer(s)!;
    expect(taken.offer).toMatchObject({ seatId: "p2", cost: 2, granterName: "Aminatou, Veil Piercer" });
    expect(taken.offer!.card.id).toBe("e1");
    // Consumed exactly once.
    expect(takeMiracleOffer(taken.session)).toBeUndefined();
    void brainstorm;
  });

  it("putting the miracle card back with Brainstorm cancels the offer (it must still be in hand)", () => {
    const e = enchantment("e1");
    let s = game(seat("p2", [e, filler("f1"), filler("f2")], [aminatou]));
    s = drawMultipleForSeat(s, "p2", 3, "Brainstorm draws 3");
    const putBack = hand(s, "p2").filter((c) => c.id !== "f2");
    s = { ...s, seats: s.seats.map((x) => (x.id === "p2" ? { ...x, board: { ...x.board, hand: hand(s, "p2").filter((c) => c.id === "f2") }, library: putBack } : x)) };
    const taken = takeMiracleOffer(s)!;
    expect(taken.offer).toBeUndefined();
    expect(takeMiracleOffer(taken.session)).toBeUndefined();
  });

  it("only the FIRST card drawn counts: a later enchantment draw, or an earlier draw this turn, gives nothing", () => {
    let s = game(seat("p2", [filler("f1"), enchantment("e1")], [aminatou]));
    s = drawMultipleForSeat(s, "p2", 2, "draw 2");
    expect(takeMiracleOffer(s)!.offer).toBeUndefined();
    // Already drew this turn, then draws an enchantment: still not eligible.
    let t = game(seat("p2", [filler("f1"), enchantment("e2")], [aminatou]));
    t = drawForSeat(t, "p2", "d1");
    t = takeMiracleOffer(t)!.session;
    t = drawForSeat(t, "p2", "d2");
    expect(takeMiracleOffer(t)).toBeUndefined();
  });

  it("a new turn resets: the first draw of the next turn is a candidate again; a stale candidate from another turn is dropped", () => {
    let s = game(seat("p2", [enchantment("e1")], [aminatou]));
    s = drawForSeat(s, "p2", "d");
    const stale = takeMiracleOffer({ ...s, turn: 5 })!;
    expect(stale.offer).toBeUndefined();
  });

  it("works with the player's own draw step too (first draw of their own turn)", () => {
    let s = game(seat("p2", [enchantment("e1")], [aminatou]), { activePlayerId: "p2" });
    s = drawForSeat(s, "p2", "draws for turn");
    expect(takeMiracleOffer(s)!.offer?.card.id).toBe("e1");
  });

  it("no Aminatou and no native miracle: nothing is offered; non-enchantments get no granted miracle", () => {
    let s = game(seat("p2", [enchantment("e1")]));
    s = drawForSeat(s, "p2", "d");
    expect(takeMiracleOffer(s)!.offer).toBeUndefined();
    let t = game(seat("p2", [filler("f1")], [aminatou]));
    t = drawForSeat(t, "p2", "d");
    expect(takeMiracleOffer(t)!.offer).toBeUndefined();
  });

  it("natural miracle (Temporal Mastery) uses its own cost, without any granter", () => {
    const tm = card({ id: "tm", name: "Temporal Mastery", typeLine: "Sorcery", manaCost: "{5}{U}{U}", manaValue: 7, zone: "library", oracleText: "Take an extra turn after this one. Exile Temporal Mastery.\nMiracle {1}{U}" });
    let s = game(seat("p2", [tm]));
    s = drawForSeat(s, "p2", "d");
    const offer = takeMiracleOffer(s)!.offer;
    expect(offer?.cost).toBe(2);
    expect(offer?.granterName).toBeUndefined();
  });

  it("a card that is not drawn (put into hand another way) is never a candidate", () => {
    const e = enchantment("e1");
    let s = game(seat("p2", [], [aminatou]));
    s = { ...s, seats: s.seats.map((x) => (x.id === "p2" ? { ...x, board: { ...x.board, hand: [{ ...e, zone: "hand" as const }] } } : x)) };
    expect(takeMiracleOffer(s)).toBeUndefined();
  });
});

describe("miracleCostForCard math: mana cost minus {4} generic only, floored at the coloured pips", () => {
  const p2 = seat("p2", [], [aminatou]);
  it("{4}{W}{W} -> {W}{W} (2); {3}{W}{W} -> floor at the two pips (2); {2}{W} -> floor 1; {5}{W} -> 2", () => {
    expect(miracleCostForCard(p2, enchantment("a", "{4}{W}{W}", 6))?.cost).toBe(2);
    expect(miracleCostForCard(p2, enchantment("b", "{3}{W}{W}", 5))?.cost).toBe(2);
    expect(miracleCostForCard(p2, enchantment("c", "{2}{W}", 3))?.cost).toBe(1);
    expect(miracleCostForCard(p2, enchantment("d", "{5}{W}", 6))?.cost).toBe(2);
  });
});
