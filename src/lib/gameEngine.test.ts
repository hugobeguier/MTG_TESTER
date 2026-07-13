import { describe, expect, it } from "vitest";
import {
  availableMana,
  libraryTopToBottom,
  millTop,
  takeFromLibrary,
  bottomExcess,
  castCommander,
  chooseAgentPlays,
  commanderCost,
  drawCards,
  freshSeatForGame,
  mulliganHand,
  openingHandKeepSize,
  playFromHand,
  removeFromBattlefield,
  shuffle,
  startOfTurn,
  transformCard
} from "./gameEngine";
import { createSampleDeck } from "./sampleDecks";
import type { PlayerSeat } from "./types";

function makeSeat(): PlayerSeat {
  const seat: PlayerSeat = {
    id: "seat-test",
    name: "Tester",
    kind: "agent",
    agentName: "Sable",
    life: 40,
    commanderDamage: {},
    zones: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 1 },
    board: { hand: [], battlefield: [], library: [], graveyard: [] }
  };
  return freshSeatForGame(seat, createSampleDeck("Sable", "Meren of Clan Nel Toth", ["B", "G"]));
}

describe("gameEngine", () => {
  it("shuffle preserves the multiset of cards", () => {
    const items = [1, 2, 3, 4, 5, 5];
    expect([...shuffle(items)].sort()).toEqual([...items].sort());
  });

  it("fresh seat starts at 40 life with a 99-card library and commander in the command zone", () => {
    const seat = makeSeat();
    expect(seat.life).toBe(40);
    expect(seat.board.library.length).toBe(99);
    expect(seat.board.battlefield).toEqual([]);
    expect(seat.board.commander?.zone).toBe("command");
    expect(seat.zones.library).toBe(99);
    expect(seat.zones.graveyard).toBe(0);
  });

  it("drawing moves cards from library to hand and keeps counts in sync", () => {
    const { seat, drawn, failed } = drawCards(makeSeat(), 7);
    expect(drawn.length).toBe(7);
    expect(failed).toBe(0);
    expect(seat.board.hand.length).toBe(7);
    expect(seat.board.library.length).toBe(92);
    expect(seat.zones.hand).toBe(7);
    expect(seat.zones.library).toBe(92);
  });

  it("mulligan reshuffles the hand and redraws 7 without losing cards", () => {
    const drawnSeat = drawCards(makeSeat(), 7).seat;
    const mulled = mulliganHand(drawnSeat);
    expect(mulled.board.hand.length).toBe(7);
    expect(mulled.board.hand.length + mulled.board.library.length).toBe(99);
  });

  it("bottoming keeps N cards and returns the rest to the library bottom", () => {
    const drawnSeat = drawCards(makeSeat(), 7).seat;
    const kept = bottomExcess(drawnSeat, 5);
    expect(kept.board.hand.length).toBe(5);
    expect(kept.board.library.length).toBe(94);
  });

  it("keep size: first mulligan is free, then one fewer each time", () => {
    expect(openingHandKeepSize(0)).toBe(7);
    expect(openingHandKeepSize(1)).toBe(7);
    expect(openingHandKeepSize(2)).toBe(6);
    expect(openingHandKeepSize(3)).toBe(5);
  });

  it("enforces one land per turn and sends instants to the graveyard", () => {
    let seat = drawCards(makeSeat(), 30).seat;
    const lands = seat.board.hand.filter((card) => card.typeLine.includes("Land"));
    const instant = seat.board.hand.find((card) => card.typeLine.includes("Instant"));
    expect(lands.length).toBeGreaterThanOrEqual(2);
    expect(instant).toBeDefined();

    const first = playFromHand(seat, lands[0].id);
    expect(first.destination).toBe("battlefield");
    seat = first.seat;

    const second = playFromHand(seat, lands[1].id);
    expect(second.error).toBeTruthy();

    const cast = playFromHand(seat, instant!.id);
    expect(cast.destination).toBe("graveyard");
    expect(cast.seat.zones.graveyard).toBe(1);
    expect(cast.seat.board.battlefield.some((card) => card.id === instant!.id)).toBe(false);

    // keepNonPermanents (human plays): instant stays on the battlefield until manually removed
    const kept = playFromHand(seat, instant!.id, undefined, { keepNonPermanents: true });
    expect(kept.destination).toBe("battlefield");
    expect(kept.seat.zones.graveyard).toBe(0);
    expect(kept.seat.board.battlefield.some((card) => card.id === instant!.id)).toBe(true);
  });

  it("start of turn untaps and clears summoning sickness and the land drop", () => {
    let seat = drawCards(makeSeat(), 20).seat;
    const land = seat.board.hand.find((card) => card.typeLine.includes("Land"))!;
    seat = playFromHand(seat, land.id).seat;
    seat = {
      ...seat,
      board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => ({ ...card, tapped: true })) }
    };
    const fresh = startOfTurn(seat);
    expect(fresh.landsPlayed).toBe(0);
    expect(fresh.board.battlefield.every((card) => !card.tapped && !card.summoningSick)).toBe(true);
  });

  it("commander tax rises by 2 per cast and the commander returns to the command zone", () => {
    let seat = makeSeat();
    expect(commanderCost(seat)).toBe(seat.board.commander!.manaValue);
    const cast = castCommander(seat);
    expect(cast.error).toBeUndefined();
    seat = cast.seat;
    expect(seat.board.commander?.zone).toBe("battlefield");
    expect(commanderCost(seat)).toBe(seat.board.commander!.manaValue + 2);

    const removed = removeFromBattlefield(seat, seat.board.commander!.id);
    expect(removed.toCommandZone).toBe(true);
    expect(removed.seat.board.commander?.zone).toBe("command");
    expect(removed.seat.zones.graveyard).toBe(0);
  });

  it("mill moves the top card to the graveyard", () => {
    const seat = makeSeat();
    const top = seat.board.library[0];
    const { seat: milled, milled: card } = millTop(seat);
    expect(card?.id).toBe(top.id);
    expect(milled.board.library.length).toBe(98);
    expect(milled.zones.graveyard).toBe(1);
    expect(milled.board.graveyard[0]?.id).toBe(top.id);
    expect(millTop({ ...milled, board: { ...milled.board, library: [] } }).milled).toBeUndefined();
  });

  it("scry-to-bottom keeps library size and moves the top card to the bottom", () => {
    const seat = makeSeat();
    const top = seat.board.library[0];
    const { seat: next } = libraryTopToBottom(seat);
    expect(next.board.library.length).toBe(99);
    expect(next.board.library[98].id).toBe(top.id);
    expect(next.board.library[0].id).not.toBe(top.id);
  });

  it("tutoring puts the card in hand and shuffles the rest of the library", () => {
    const seat = makeSeat();
    const wanted = seat.board.library[42];
    const { seat: next, taken } = takeFromLibrary(seat, wanted.id);
    expect(taken?.id).toBe(wanted.id);
    expect(next.board.hand.some((card) => card.id === wanted.id)).toBe(true);
    expect(next.board.library.length).toBe(98);
    expect(next.board.library.some((card) => card.id === wanted.id)).toBe(false);
    expect(takeFromLibrary(seat, "missing-id").taken).toBeUndefined();
  });

  it("transform swaps to the other face and back", () => {
    const dfc = {
      id: "t1",
      name: "Journey to Eternity",
      typeLine: "Legendary Enchantment — Aura",
      oracleText: "Enchant creature you control...",
      manaValue: 3,
      colors: ["B", "G"],
      role: "spell",
      zone: "battlefield" as const,
      faces: [
        { name: "Journey to Eternity", typeLine: "Legendary Enchantment — Aura", oracleText: "Enchant creature you control...", colors: ["B", "G"] },
        { name: "Atzal, Cave of Eternity", typeLine: "Legendary Land", oracleText: "{T}: Add one mana of any color.", colors: [] }
      ]
    };
    const back = transformCard(dfc);
    expect(back.name).toBe("Atzal, Cave of Eternity");
    expect(back.typeLine).toBe("Legendary Land");
    expect(back.faceIndex).toBe(1);
    const front = transformCard(back);
    expect(front.name).toBe("Journey to Eternity");
    expect(front.faceIndex).toBe(0);
    // single-faced cards are untouched
    const plain = { ...dfc, faces: undefined };
    expect(transformCard(plain)).toBe(plain);
  });

  it("agent picks a land and an affordable spell", () => {
    let seat = drawCards(makeSeat(), 15).seat;
    for (let i = 0; i < 3; i += 1) {
      const land = seat.board.hand.find((card) => card.typeLine.includes("Land"));
      if (land) seat = { ...playFromHand(seat, land.id).seat, landsPlayed: 0 };
    }
    const plays = chooseAgentPlays(seat);
    const mana = availableMana(seat) + (plays.landId ? 1 : 0);
    if (plays.spellId) {
      const spell = seat.board.hand.find((card) => card.id === plays.spellId)!;
      expect(spell.manaValue).toBeLessThanOrEqual(mana);
      expect(spell.typeLine.includes("Land")).toBe(false);
    }
    if (plays.castCommander) {
      expect(commanderCost(seat)).toBeLessThanOrEqual(mana);
    }
  });
});
