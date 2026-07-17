import { describe, expect, it } from "vitest";
import { parseZoneEffect } from "./zoneEffects";

describe("parseZoneEffect — reanimate", () => {
  it("parses reanimation from any graveyard (Reanimate)", () => {
    expect(parseZoneEffect("Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to that card's mana value.")).toEqual({
      kind: "reanimate",
      anyGraveyard: true,
      targetType: "creature"
    });
  });

  it("parses reanimation restricted to your own graveyard (Persist)", () => {
    expect(parseZoneEffect("Return target nonlegendary creature card from your graveyard to the battlefield with a -1/-1 counter on it.")).toEqual({
      kind: "reanimate",
      anyGraveyard: false,
      targetType: "creature"
    });
  });

  it("parses reanimation restricted to a non-creature card type (Starfield of Nyx)", () => {
    expect(parseZoneEffect("At the beginning of your upkeep, you may return target enchantment card from your graveyard to the battlefield.")).toEqual({
      kind: "reanimate",
      anyGraveyard: false,
      targetType: "enchantment"
    });
  });

  it("declines Aura-based reanimation (Animate Dead)", () => {
    expect(
      parseZoneEffect(
        "Enchant creature card in a graveyard\nWhen this Aura enters, if it's on the battlefield, it loses \"enchant creature card in a graveyard\" and gains \"enchant creature put onto the battlefield with this Aura.\" Return enchanted creature card to the battlefield under your control and attach this Aura to it."
      )
    ).toBeUndefined();
  });
});

describe("parseZoneEffect — regrow", () => {
  it("parses a plain card regrow (Regrowth)", () => {
    expect(parseZoneEffect("Return target card from your graveyard to your hand.")).toEqual({ kind: "regrow", targetType: "card" });
  });

  it("parses a permanent-restricted regrow (Nature's Spiral)", () => {
    expect(parseZoneEffect("Return target permanent card from your graveyard to your hand.")).toEqual({ kind: "regrow", targetType: "permanent" });
  });
});

describe("parseZoneEffect — mill", () => {
  it("parses target-player mill (Ambassador Laquatus)", () => {
    expect(parseZoneEffect("{3}: Target player mills three cards.")).toEqual({ kind: "mill", amount: 3, scope: "target_player" });
  });

  it("parses each-opponent mill", () => {
    expect(parseZoneEffect("Whenever you draw a card, each opponent mills two cards.")).toEqual({ kind: "mill", amount: 2, scope: "each_opponent" });
  });

  it("declines fractional mill (Traumatize)", () => {
    expect(parseZoneEffect("Target player mills half their library, rounded down.")).toBeUndefined();
  });

  it("declines conditional reveal-based mill (Mind Grind)", () => {
    expect(
      parseZoneEffect(
        "Each opponent reveals cards from the top of their library until they reveal X land cards, then puts all cards revealed this way into their graveyard. X can't be 0."
      )
    ).toBeUndefined();
  });
});

describe("parseZoneEffect — graveyard to library", () => {
  it("parses shuffling your own graveyard into your library (Archangel's Light)", () => {
    expect(parseZoneEffect("You gain 2 life for each card in your graveyard, then shuffle your graveyard into your library.")).toEqual({
      kind: "graveyard_to_library",
      scope: "you"
    });
  });

  it("parses shuffling a target player's graveyard into their library (Clear the Mind)", () => {
    expect(parseZoneEffect("Target player shuffles their graveyard into their library.")).toEqual({
      kind: "graveyard_to_library",
      scope: "target_player"
    });
  });
});

describe("parseZoneEffect — gain control", () => {
  it("parses a temporary control change (Threaten)", () => {
    expect(parseZoneEffect("Untap target creature and gain control of it until end of turn. That creature gains haste until end of turn.")).toEqual({
      kind: "gain_control",
      untilEndOfTurn: true
    });
  });

  it("parses a permanent control change with no time limit", () => {
    expect(parseZoneEffect("Gain control of target creature.")).toEqual({ kind: "gain_control", untilEndOfTurn: false });
  });

  it("declines Aura-based ongoing control (Mind Control)", () => {
    expect(parseZoneEffect("Enchant creature\nYou control enchanted creature.")).toBeUndefined();
  });
});

describe("parseZoneEffect — impulse draw", () => {
  it("parses a multi-card exile-and-play with a this-turn window (Act on Impulse)", () => {
    expect(parseZoneEffect("Exile the top three cards of your library. Until end of turn, you may play those cards.")).toEqual({
      kind: "impulse_draw",
      amount: 3,
      untilEndOfNextTurn: false
    });
  });

  it("parses a single-card exile-and-play with an extended next-turn window (Alania's Pathmaker)", () => {
    expect(parseZoneEffect("When this creature enters, exile the top card of your library. Until the end of your next turn, you may play that card.")).toEqual({
      kind: "impulse_draw",
      amount: 1,
      untilEndOfNextTurn: true
    });
  });

  it("parses the 'this turn' trailing-clause phrasing (Asgardian Inspiration)", () => {
    expect(parseZoneEffect("Exile the top card of your library. You may play it this turn.")).toEqual({
      kind: "impulse_draw",
      amount: 1,
      untilEndOfNextTurn: false
    });
  });
});

describe("parseZoneEffect — steal and play", () => {
  it("parses Praetor's Grasp", () => {
    expect(
      parseZoneEffect(
        "Search target opponent's library for a card and exile it face down. Then that player shuffles. You may play that card for as long as it remains exiled."
      )
    ).toEqual({ kind: "steal_and_play" });
  });
});

describe("parseZoneEffect — draw X then put back", () => {
  it("parses draw X then put N cards from hand on top of library in any order (Brainsurge)", () => {
    expect(parseZoneEffect("Draw X cards, then put two cards from your hand on top of your library in any order.")).toEqual({
      kind: "draw_x_then_put_back",
      putBackAmount: 2
    });
  });
});

describe("parseZoneEffect — non-matches", () => {
  it("does not match unrelated text", () => {
    expect(parseZoneEffect("Flying, vigilance.")).toBeUndefined();
  });
});
