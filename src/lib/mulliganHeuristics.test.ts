import { describe, expect, it } from "vitest";
import { evaluateOpeningHand } from "./mulliganHeuristics";
import type { CommanderDeck, DeckArchetype, PlayerSeat, VisibleCard } from "./types";

let cardCounter = 0;

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "name" | "role">): VisibleCard {
  cardCounter += 1;
  return {
    id: `card-${cardCounter}`,
    typeLine: "Sorcery",
    oracleText: "",
    manaValue: 2,
    colors: [],
    zone: "hand",
    ...overrides
  };
}

function land(name: string, producedMana: string[] = []): VisibleCard {
  return card({ name, role: "land", typeLine: "Basic Land", manaValue: 0, producedMana });
}

function seatWithHand(hand: VisibleCard[], commanderColorIdentity?: string[], archetype?: DeckArchetype): PlayerSeat {
  return {
    id: "seat-1",
    name: "Test Agent",
    kind: "agent",
    life: 40,
    commanderDamage: {},
    zones: { library: 0, hand: hand.length, battlefield: 0, graveyard: 0, exile: 0, command: commanderColorIdentity ? 1 : 0 },
    deck: archetype ? ({ archetype } as CommanderDeck) : undefined,
    board: {
      hand,
      battlefield: [],
      commander: commanderColorIdentity
        ? card({
            name: "Test Commander",
            role: "commander",
            typeLine: "Legendary Creature",
            manaValue: 4,
            colorIdentity: commanderColorIdentity,
            zone: "command"
          })
        : undefined
    }
  };
}

describe("evaluateOpeningHand", () => {
  it("keeps a hand with a good land count, cheap ramp, and early plays", () => {
    const hand = [
      land("Forest", ["G"]),
      land("Forest", ["G"]),
      land("Forest", ["G"]),
      card({ name: "Llanowar Elves", role: "ramp", manaValue: 1 }),
      card({ name: "Early Play A", role: "creature", manaValue: 2 }),
      card({ name: "Early Play B", role: "creature", manaValue: 3 })
    ];
    const result = evaluateOpeningHand(seatWithHand(hand, ["G"]));
    expect(result.keep).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it("mulligans a hand with too few lands", () => {
    const hand = [
      card({ name: "Spell A", role: "creature", manaValue: 2 }),
      card({ name: "Spell B", role: "creature", manaValue: 3 }),
      card({ name: "Spell C", role: "removal", manaValue: 1 })
    ];
    const result = evaluateOpeningHand(seatWithHand(hand));
    expect(result.keep).toBe(false);
  });

  it("mulligans a flood-prone hand with too many lands", () => {
    const hand = [
      land("Forest"),
      land("Forest"),
      land("Forest"),
      land("Forest"),
      land("Forest"),
      land("Forest"),
      card({ name: "Only Spell", role: "creature", manaValue: 3 })
    ];
    const result = evaluateOpeningHand(seatWithHand(hand));
    expect(result.keep).toBe(false);
  });

  it("downgrades a hand that cannot produce the commander's colors", () => {
    const correctColorHand = [
      land("Island", ["U"]),
      land("Island", ["U"]),
      land("Swamp", ["B"]),
      card({ name: "Early Play", role: "creature", manaValue: 2 })
    ];
    const wrongColorHand = [
      land("Forest", ["G"]),
      land("Forest", ["G"]),
      land("Forest", ["G"]),
      card({ name: "Early Play", role: "creature", manaValue: 2 })
    ];
    const correct = evaluateOpeningHand(seatWithHand(correctColorHand, ["U", "B"]));
    const wrong = evaluateOpeningHand(seatWithHand(wrongColorHand, ["U", "B"]));
    expect(wrong.score).toBeLessThan(correct.score);
    expect(wrong.reasons.join(" ")).toContain("missing a mana source");
  });

  it("scores cheap ramp higher than expensive ramp", () => {
    const cheapRampHand = [
      land("Forest"),
      land("Forest"),
      land("Forest"),
      card({ name: "Sol Ring", role: "ramp", manaValue: 1 }),
      card({ name: "Early Play", role: "creature", manaValue: 2 })
    ];
    const expensiveRampHand = [
      land("Forest"),
      land("Forest"),
      land("Forest"),
      card({ name: "Big Ramp Spell", role: "ramp", manaValue: 5 }),
      card({ name: "Early Play", role: "creature", manaValue: 2 })
    ];
    const cheap = evaluateOpeningHand(seatWithHand(cheapRampHand));
    const expensive = evaluateOpeningHand(seatWithHand(expensiveRampHand));
    expect(cheap.score).toBeGreaterThan(expensive.score);
  });

  it("mulligans a hand with an acceptable land count but no plays through turn 4", () => {
    const hand = [
      land("Forest"),
      land("Forest"),
      card({ name: "Big Spell A", role: "creature", manaValue: 6 }),
      card({ name: "Big Spell B", role: "creature", manaValue: 7 }),
      card({ name: "Big Spell C", role: "creature", manaValue: 8 })
    ];
    const result = evaluateOpeningHand(seatWithHand(hand));
    expect(result.keep).toBe(false);
    expect(result.reasons.join(" ")).toContain("no plays on curve");
  });

  it("weighs card draw above pure removal/counterspell interaction", () => {
    const manaBase = [land("Forest"), land("Forest"), land("Forest"), card({ name: "Ramp", role: "ramp", manaValue: 1 })];
    const drawHand = [...manaBase, card({ name: "Draw A", role: "draw", manaValue: 2 }), card({ name: "Draw B", role: "draw", manaValue: 2 })];
    const removalHand = [...manaBase, card({ name: "Removal A", role: "removal", manaValue: 2 }), card({ name: "Removal B", role: "removal", manaValue: 2 })];
    const draw = evaluateOpeningHand(seatWithHand(drawHand));
    const removal = evaluateOpeningHand(seatWithHand(removalHand));
    expect(draw.score).toBeGreaterThan(removal.score);
  });

  it("forces a mulligan on zero lands even when the rest of the hand is stacked with bonuses", () => {
    const hand = [
      card({ name: "Ramp A", role: "ramp", manaValue: 1 }),
      card({ name: "Ramp B", role: "ramp", manaValue: 1 }),
      card({ name: "Draw A", role: "draw", manaValue: 1 }),
      card({ name: "Draw B", role: "draw", manaValue: 1 }),
      card({ name: "Removal A", role: "removal", manaValue: 1 }),
      card({ name: "Removal B", role: "removal", manaValue: 1 }),
      card({ name: "Removal C", role: "removal", manaValue: 1 })
    ];
    const result = evaluateOpeningHand(seatWithHand(hand));
    expect(result.keep).toBe(false);
  });

  it("forces a mulligan on an all-land seven-card hand", () => {
    const hand = [land("Forest"), land("Forest"), land("Forest"), land("Forest"), land("Forest"), land("Forest"), land("Forest")];
    const result = evaluateOpeningHand(seatWithHand(hand));
    expect(result.keep).toBe(false);
  });

  it("scores interaction higher for a control deck than the unweighted default", () => {
    const hand = [
      land("Forest"),
      land("Forest"),
      land("Forest"),
      card({ name: "Ramp", role: "ramp", manaValue: 1 }),
      card({ name: "Removal A", role: "removal", manaValue: 2 }),
      card({ name: "Removal B", role: "removal", manaValue: 2 })
    ];
    const midrange = evaluateOpeningHand(seatWithHand(hand, undefined, "midrange"));
    const control = evaluateOpeningHand(seatWithHand(hand, undefined, "control"));
    expect(control.score).toBeGreaterThan(midrange.score);
  });

  it("scores card draw higher for a combo deck than the unweighted default", () => {
    const hand = [
      land("Forest"),
      land("Forest"),
      land("Forest"),
      land("Forest"),
      card({ name: "Draw A", role: "draw", manaValue: 4 }),
      card({ name: "Draw B", role: "draw", manaValue: 4 })
    ];
    const midrange = evaluateOpeningHand(seatWithHand(hand, undefined, "midrange"));
    const combo = evaluateOpeningHand(seatWithHand(hand, undefined, "combo"));
    expect(combo.score).toBeGreaterThan(midrange.score);
  });
});
