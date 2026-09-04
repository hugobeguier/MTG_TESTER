import { describe, expect, it } from "vitest";
import { adjustedCastingCost, totalCastingCost } from "./AppFlow";
import type { PlayerSeat, VisibleCard } from "@/lib/types";

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

// Real oracle text, verified via Scryfall: Korlessa costs {G}{U} — zero generic mana at all.
const KORLESSA = card({
  id: "korlessa",
  name: "Korlessa, Scale Singer",
  typeLine: "Legendary Creature — Elf Dragon Shaman",
  manaCost: "{G}{U}",
  manaValue: 2
});

// The Ur-Dragon's Eminence ability grants {1} off Dragon spells even from the command zone.
const UR_DRAGON = card({
  id: "ur-dragon",
  name: "The Ur-Dragon",
  typeLine: "Legendary Creature — Dragon",
  oracleText: "Eminence — As long as The Ur-Dragon is on the battlefield or in the command zone, whenever you cast a Dragon spell, ...\nDragon spells you cast cost {1} less to cast."
});

const DRAGONSPEAKER_SHAMAN = card({
  id: "shaman",
  name: "Dragonspeaker Shaman",
  typeLine: "Creature — Goblin Shaman",
  oracleText: "Dragon spells you cast cost {2} less to cast.\n{T}: Dragon creatures you control get +1/+0 until end of turn."
});

describe("adjustedCastingCost — rule 601.2f colored-pip floor", () => {
  it("a card with no generic component at all is unaffected by {3} of stacked generic-only reduction", () => {
    const seatState = seat({ id: "caster", name: "Caster", kind: "agent", board: { hand: [], battlefield: [DRAGONSPEAKER_SHAMAN], commander: UR_DRAGON } });
    const cost = adjustedCastingCost(seatState, KORLESSA, KORLESSA.manaValue, "hand", "caster", [seatState]);
    expect(cost).toBe(2); // still {G}{U} — 2 colored pips, never reduced below them
  });

  it("a card WITH a generic component is still discounted, down to (but not below) its own colored pips", () => {
    // A 5-mana Dragon spell costing {3}{R}{R} (2 colored pips, 3 generic) — {3} of stacked reduction
    // should zero out exactly the generic portion and stop there.
    const dragonSpell = card({ id: "dragon-spell", name: "Test Dragon", typeLine: "Creature — Dragon", manaCost: "{3}{R}{R}", manaValue: 5 });
    const seatState = seat({ id: "caster", name: "Caster", kind: "agent", board: { hand: [], battlefield: [DRAGONSPEAKER_SHAMAN], commander: UR_DRAGON } });
    const cost = adjustedCastingCost(seatState, dragonSpell, dragonSpell.manaValue, "hand", "caster", [seatState]);
    expect(cost).toBe(2); // floored at the 2 colored pips, not 5 - 3 = 2 coincidentally same here
  });

  it("a card with MORE generic than the stacked reduction is discounted normally (regression check)", () => {
    const dragonSpell = card({ id: "dragon-spell-2", name: "Test Dragon 2", typeLine: "Creature — Dragon", manaCost: "{6}{R}{R}", manaValue: 8 });
    const seatState = seat({ id: "caster", name: "Caster", kind: "agent", board: { hand: [], battlefield: [DRAGONSPEAKER_SHAMAN], commander: UR_DRAGON } });
    const cost = adjustedCastingCost(seatState, dragonSpell, dragonSpell.manaValue, "hand", "caster", [seatState]);
    expect(cost).toBe(5); // 8 - 3 = 5, still above the 2-colored-pip floor
  });
});

describe("totalCastingCost — rule 601.2f colored-pip floor", () => {
  it("floors an X-spell's reduced cost at its own colored pips too", () => {
    const xSpell = card({ id: "x-spell", name: "Test X Dragon", typeLine: "Sorcery — Dragon", manaCost: "{X}{G}{G}", manaValue: 0 });
    const seatState = seat({ id: "caster", name: "Caster", kind: "agent", board: { hand: [], battlefield: [DRAGONSPEAKER_SHAMAN], commander: UR_DRAGON } });
    // baseCost 0 (X chosen as 0), chosenX 0 — the {3} stacked reduction has nothing generic to eat
    // into, so this should floor at 2 colored pips rather than going negative-then-clamped-to-0.
    const cost = totalCastingCost(seatState, xSpell, 0, 0);
    expect(cost).toBe(2);
  });
});
