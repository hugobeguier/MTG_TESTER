import { describe, expect, it } from "vitest";
import { parseGenericSacrificeAbilities } from "./activatedAbilities";

describe("parseGenericSacrificeAbilities", () => {
  it("parses Viscera Seer's sacrifice-a-creature-for-scry ability, ignoring trailing reminder text", () => {
    const abilities = parseGenericSacrificeAbilities(
      "Sacrifice a creature: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)"
    );
    expect(abilities).toHaveLength(1);
    expect(abilities[0]).toMatchObject({ costMana: 0, costTap: false, sacrificeTarget: "creature", effect: { kind: "scry", amount: 1 } });
  });

  it("parses Carrion Feeder's self-buff sacrifice ability from its second oracle-text line", () => {
    const abilities = parseGenericSacrificeAbilities("This creature can't block.\nSacrifice a creature: Put a +1/+1 counter on this creature.");
    expect(abilities).toHaveLength(1);
    expect(abilities[0].effect).toEqual({ kind: "add_counter", counterKind: "+1/+1", amount: 1 });
  });

  it("recognizes Ashnod's Altar as sacrifice-shaped but returns no ability since mana-producing effects aren't executable yet", () => {
    expect(parseGenericSacrificeAbilities("Sacrifice a creature: Add {C}{C}.")).toHaveLength(0);
  });

  it("recognizes Nantuko Husk as sacrifice-shaped but returns no ability since temporary pump effects aren't executable yet", () => {
    expect(parseGenericSacrificeAbilities("Sacrifice a creature: This creature gets +2/+2 until end of turn.")).toHaveLength(0);
  });

  it("parses Food token's mana+tap cost prefix and gain-life effect (self-sacrifice)", () => {
    const abilities = parseGenericSacrificeAbilities("{2}, {T}, Sacrifice this artifact: You gain 3 life.");
    expect(abilities).toEqual([
      { costMana: 2, costTap: true, costDiscard: false, sacrificeTarget: "self", effect: { kind: "gain_life", amount: 3 }, clause: "{2}, {T}, Sacrifice this artifact: You gain 3 life." }
    ]);
  });

  it("parses Clue token's mana-only cost prefix and draw effect (self-sacrifice)", () => {
    const abilities = parseGenericSacrificeAbilities("{2}, Sacrifice this artifact: Draw a card.");
    expect(abilities[0]).toMatchObject({ costMana: 2, costTap: false, costDiscard: false, sacrificeTarget: "self", effect: { kind: "draw_cards", amount: 1 } });
  });

  it("returns nothing for oracle text with no sacrifice ability", () => {
    expect(parseGenericSacrificeAbilities("Flying, vigilance.\nWhenever this creature attacks, draw a card.")).toHaveLength(0);
  });

  it("parses Blood token's discard-as-a-cost ability alongside its mana/tap cost", () => {
    const abilities = parseGenericSacrificeAbilities("{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.");
    expect(abilities[0]).toMatchObject({ costMana: 1, costTap: true, costDiscard: true, sacrificeTarget: "self", effect: { kind: "draw_cards", amount: 1 } });
  });
});
