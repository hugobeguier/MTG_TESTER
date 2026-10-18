import { describe, expect, it } from "vitest";
import { buildCatalog, lookupCard } from "./cardCatalog";
import type { CardLike, ScorableAction, ScoringContext } from "./actionScoring";
import { evaluatePlayGuards, immediateLifeLoss, removalGuard, wastedSpellGuard } from "./playGuards";
import type { CardRecord } from "./types";

// Real Oracle text through the same catalog helpers the app uses (guards found by the self-play mistake detector).
function record(name: string, typeLine: string, manaValue: number, oracleText: string): CardRecord {
  return { id: `test-${name}`, name, typeLine, oracleText, manaValue, colors: [], colorIdentity: [] };
}
const catalog = buildCatalog(
  [
    record("Swords to Plowshares", "Instant", 1, "Exile target creature. Its controller gains life equal to its power."),
    record("Go for the Throat", "Instant", 2, "Destroy target nonartifact creature."),
    record("Pacifism", "Enchantment — Aura", 2, "Enchant creature\nEnchanted creature can't attack or block."),
    record("Counterspell", "Instant", 2, "Counter target spell."),
    record("Negate", "Instant", 2, "Counter target noncreature spell."),
    record("Cryptic Command", "Instant", 4, "Choose two —\n• Counter target spell.\n• Return target permanent to its owner's hand.\n• Tap all creatures your opponents control.\n• Draw a card."),
    record("Ambition's Cost", "Sorcery", 4, "You draw three cards and you lose 3 life."),
    record("Vampiric Tutor", "Instant", 1, "Search your library for a card, then shuffle and put that card on top. You lose 2 life."),
    record("Phyrexian Arena", "Enchantment", 3, "At the beginning of your upkeep, you draw a card and you lose 1 life."),
    record("Zul Ashur, Lich Lord", "Legendary Creature — Zombie Wizard", 3, "Ward—Pay 2 life.\n{T}: You may cast target Zombie creature card from your graveyard this turn."),
    record("Grizzly Bears", "Creature — Bear", 2, ""),
    record("Hill Giant", "Creature — Giant", 4, ""),
    record("Dark Confidant", "Creature — Human Wizard", 2, "At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.")
  ],
  undefined,
  "builtin"
);
const card = (name: string) => lookupCard(catalog, name)!;

function castAction(name: string): ScorableAction {
  const rec = card(name);
  return { id: `cast:hand-${name}`, actionType: "cast_spell", cardId: `hand-${name}`, targetIds: [], label: `cast ${name}`, detail: `{${rec.manaValue}} ${rec.typeLine}. ${rec.oracleText} Payable with lands.` };
}
function creature(name: string, power: string, toughness: string, id: string): CardLike {
  const rec = card(name);
  return { id, name, typeLine: rec.typeLine, oracleText: rec.oracleText, manaValue: rec.manaValue, power, toughness };
}
function ctx(overrides: Partial<ScoringContext> & { mine?: CardLike[]; theirs?: CardLike[]; life?: number } = {}): ScoringContext {
  const { mine = [], theirs = [], life = 40, ...rest } = overrides;
  return { purpose: "main_phase", turn: 6, you: { id: "me", life, battlefield: mine, hand: [] }, opponents: [{ id: "opp", life: 40, battlefield: theirs }], ...rest };
}

describe("removal with no opposing creature (self-play detector: removal can only hit my own)", () => {
  const mine = [creature("Grizzly Bears", "2", "2", "my-bears")];
  for (const name of ["Swords to Plowshares", "Go for the Throat", "Pacifism"]) {
    it(`holds ${name} when the opponents control no creature`, () => {
      const verdict = removalGuard(castAction(name), ctx({ mine }));
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toMatch(/no opposing creature/);
    });
  }

  it("still judges by threat once an opposing creature exists (a real threat is allowed)", () => {
    expect(removalGuard(castAction("Swords to Plowshares"), ctx({ mine, theirs: [creature("Hill Giant", "3", "3", "giant")] })).allowed).toBe(true);
  });

  it("is part of evaluatePlayGuards so the scorer vetoes it", () => {
    expect(evaluatePlayGuards(castAction("Swords to Plowshares"), ctx({ mine })).vetoed).toBe(true);
  });
});

describe("counterspells with nothing to counter", () => {
  it("vetoes Counterspell on an empty stack", () => {
    expect(wastedSpellGuard(castAction("Counterspell"), ctx()).allowed).toBe(false);
    expect(wastedSpellGuard(castAction("Negate"), ctx()).allowed).toBe(false);
  });

  it("allows it in response to an opponent's spell", () => {
    const pending = { id: "s1", cardName: "Hill Giant", oracleText: "", actorSeatId: "opp" };
    expect(wastedSpellGuard(castAction("Counterspell"), ctx({ purpose: "priority_response", stack: [pending], pendingAction: pending })).allowed).toBe(true);
  });

  it("vetoes countering my own spell (only my spell on the stack)", () => {
    const mineOnStack = { id: "s1", cardName: "Hill Giant", oracleText: "", actorSeatId: "me" };
    expect(wastedSpellGuard(castAction("Counterspell"), ctx({ stack: [mineOnStack] })).allowed).toBe(false);
  });

  it("leaves modal spells with a counter mode alone (Cryptic Command can still draw)", () => {
    expect(wastedSpellGuard(castAction("Cryptic Command"), ctx()).allowed).toBe(true);
  });
});

describe("spells that cost the caster their last life", () => {
  it("reads the immediate life loss only", () => {
    expect(immediateLifeLoss(castAction("Ambition's Cost"))).toBe(3);
    expect(immediateLifeLoss(castAction("Vampiric Tutor"))).toBe(2);
    expect(immediateLifeLoss(castAction("Phyrexian Arena"))).toBe(0); // upkeep trigger, not part of casting
    expect(immediateLifeLoss(castAction("Zul Ashur, Lich Lord"))).toBe(0); // ward cost
    expect(immediateLifeLoss(castAction("Dark Confidant"))).toBe(0);
  });

  it("vetoes Ambition's Cost at 3 life and allows it at 4", () => {
    expect(wastedSpellGuard(castAction("Ambition's Cost"), ctx({ life: 3 })).allowed).toBe(false);
    expect(wastedSpellGuard(castAction("Ambition's Cost"), ctx({ life: 4 })).allowed).toBe(true);
  });

  it("vetoes Vampiric Tutor at 2 life", () => {
    expect(wastedSpellGuard(castAction("Vampiric Tutor"), ctx({ life: 2 })).allowed).toBe(false);
  });

  it("does not veto a creature whose ward costs life", () => {
    expect(wastedSpellGuard(castAction("Zul Ashur, Lich Lord"), ctx({ life: 2 })).allowed).toBe(true);
  });
});
