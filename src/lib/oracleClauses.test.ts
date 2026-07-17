import { describe, expect, it } from "vitest";
import { deathEffectText, etbEffectText, isActivatedAbilityClause, isNonEtbWheneverClause, mergeModalBulletClauses, oracleClauses, parseModalHeader } from "./oracleClauses";

describe("isActivatedAbilityClause", () => {
  it("recognizes mana-cost activated abilities", () => {
    expect(isActivatedAbilityClause("{1}, {T}: Add one mana of any color.")).toBe(true);
  });

  it("recognizes loyalty-cost activated abilities", () => {
    expect(isActivatedAbilityClause("+1: Create a 1/1 colorless Thopter artifact creature token with flying.")).toBe(true);
    expect(isActivatedAbilityClause("0: Draw a card. If you control three or more artifacts, draw two cards instead.")).toBe(true);
    expect(isActivatedAbilityClause('−9: You get an emblem with "At the beginning of your end step, you may cast target artifact card from your graveyard without paying its mana cost."')).toBe(true);
  });

  it("does not flag ordinary static or triggered text as activated", () => {
    expect(isActivatedAbilityClause("Artifact creatures you control get +1/+1.")).toBe(false);
    expect(isActivatedAbilityClause("At the beginning of your end step, draw a card.")).toBe(false);
  });
});

describe("phase-trigger clauses nested inside a loyalty ability", () => {
  const tezzeretOracleText = [
    "Artifact creatures you control get +1/+1.",
    "+1: Create a 1/1 colorless Thopter artifact creature token with flying.",
    "0: Draw a card. If you control three or more artifacts, draw two cards instead.",
    '−9: You get an emblem with "At the beginning of your end step, you may cast target artifact card from your graveyard without paying its mana cost."'
  ].join("\n");

  it("does not treat the quoted emblem text inside a loyalty ability as the card's own end-step trigger", () => {
    const clauses = oracleClauses(tezzeretOracleText).filter((clause) => !isActivatedAbilityClause(clause));
    expect(clauses.some((clause) => clause.toLowerCase().includes("at the beginning of your end step"))).toBe(false);
  });

  it("etbEffectText excludes loyalty-ability clauses the same way it excludes mana-cost ones", () => {
    expect(etbEffectText(tezzeretOracleText)).toBe("Artifact creatures you control get +1/+1.");
  });

  it("deathEffectText finds nothing since none of Tezzeret's clauses are death triggers", () => {
    expect(deathEffectText(tezzeretOracleText)).toBe("");
  });
});

describe("isNonEtbWheneverClause / etbEffectText — standing triggers keyed to a later event", () => {
  it("flags a 'whenever you cast' trigger as non-ETB (Shark Typhoon)", () => {
    expect(isNonEtbWheneverClause("Whenever you cast a noncreature spell, create an X/X blue Shark creature token with flying, where X is that spell's mana value.")).toBe(true);
  });

  it("flags a 'whenever ~ attacks' trigger as non-ETB (Soaring Lightbringer)", () => {
    expect(isNonEtbWheneverClause("Whenever Soaring Lightbringer attacks, create a 1/1 white Bird creature token with flying that's tapped and attacking.")).toBe(true);
  });

  it("does not flag a genuine ETB trigger (contains 'enters')", () => {
    expect(isNonEtbWheneverClause("When this creature enters, create a 1/1 white Bird creature token with flying.")).toBe(false);
    expect(isNonEtbWheneverClause("Whenever a creature enters the battlefield under your control, put a +1/+1 counter on this creature.")).toBe(false);
  });

  it("etbEffectText excludes Shark Typhoon's cast-trigger and cycle-trigger, leaving no ETB effect", () => {
    const sharkTyphoonText =
      "Whenever you cast a noncreature spell, create an X/X blue Shark creature token with flying, where X is that spell's mana value.\nWhen you cycle this card, create an X/X blue Shark creature token with flying.";
    expect(etbEffectText(sharkTyphoonText)).toBe("");
  });

  it("etbEffectText excludes Soaring Lightbringer's attack-trigger, leaving no ETB effect", () => {
    expect(
      etbEffectText("Flying, vigilance.\nWhenever Soaring Lightbringer attacks, create a 1/1 white Bird creature token with flying that's tapped and attacking.")
    ).toBe("Flying, vigilance.");
  });
});

describe("parseModalHeader", () => {
  it("splits a 'choose one' card into its bullet modes (Boros Charm)", () => {
    expect(
      parseModalHeader(
        "Choose one —\n• Boros Charm deals 4 damage to target player or planeswalker.\n• Target permanent you control gains indestructible until end of turn.\n• Permanents you control gain haste until end of turn."
      )
    ).toEqual({
      chooseCount: 1,
      modeTexts: [
        "Boros Charm deals 4 damage to target player or planeswalker.",
        "Target permanent you control gains indestructible until end of turn.",
        "Permanents you control gain haste until end of turn."
      ]
    });
  });

  it("recognizes 'choose two' (Austere Command)", () => {
    const header = parseModalHeader("Choose two —\n• Destroy all creatures with power 3 or less.\n• Destroy all creatures with power 4 or greater.");
    expect(header?.chooseCount).toBe(2);
    expect(header?.modeTexts).toHaveLength(2);
  });

  it("returns undefined for a card with no modal header", () => {
    expect(parseModalHeader("Destroy target creature.")).toBeUndefined();
  });

  it("returns undefined when the header matches but fewer than two bullets follow", () => {
    expect(parseModalHeader("Choose one — Destroy target creature.")).toBeUndefined();
  });
});

describe("mergeModalBulletClauses", () => {
  it("folds a recurring modal trigger's header and bullets back into one clause (Abiding Grace)", () => {
    const clauses = oracleClauses(
      "At the beginning of your end step, choose one —\n• You gain 1 life.\n• Return target creature card with mana value 1 from your graveyard to the battlefield."
    );
    expect(clauses).toHaveLength(3);
    const merged = mergeModalBulletClauses(clauses);
    expect(merged).toEqual([
      "At the beginning of your end step, choose one —\n• You gain 1 life.\n• Return target creature card with mana value 1 from your graveyard to the battlefield."
    ]);
  });

  it("leaves clauses with no modal header unchanged", () => {
    const clauses = oracleClauses("Flying, vigilance.\nWhenever this creature attacks, draw a card.");
    expect(mergeModalBulletClauses(clauses)).toEqual(clauses);
  });

  it("only absorbs bullets immediately following the header, not unrelated later clauses", () => {
    const clauses = oracleClauses("Choose one —\n• Gain 1 life.\n• Draw a card.\nFlying.");
    const merged = mergeModalBulletClauses(clauses);
    expect(merged).toEqual(["Choose one —\n• Gain 1 life.\n• Draw a card.", "Flying."]);
  });
});
