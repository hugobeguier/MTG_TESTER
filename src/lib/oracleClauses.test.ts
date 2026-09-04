import { describe, expect, it } from "vitest";
import {
  basicLandFetchCostRequiresTap,
  basicLandFetchManaCost,
  combatDamageToPlayerEffectText,
  deathEffectText,
  etbEffectText,
  hasGraveyardShuffleReplacement,
  isActivatedAbilityClause,
  isAttackTriggerAddManaClause,
  isBasicLandFetchAbility,
  isCombatDamageToPlayerClause,
  isNonEtbWheneverClause,
  mergeModalBulletClauses,
  oracleClauses,
  parseAdditionalSacrificeCost,
  parseEmblemGrant,
  parseModalHeader
} from "./oracleClauses";

describe("hasGraveyardShuffleReplacement", () => {
  it("recognizes Blightsteel Colossus's real oracle text", () => {
    expect(
      hasGraveyardShuffleReplacement(
        "Trample, infect, indestructible\nIf Blightsteel Colossus would be put into a graveyard from anywhere, reveal Blightsteel Colossus and shuffle it into its owner's library instead."
      )
    ).toBe(true);
  });

  it("recognizes Darksteel Colossus and Progenitus (same template, different names)", () => {
    expect(
      hasGraveyardShuffleReplacement(
        "Trample\nIndestructible\nIf Darksteel Colossus would be put into a graveyard from anywhere, reveal Darksteel Colossus and shuffle it into its owner's library instead."
      )
    ).toBe(true);
    expect(
      hasGraveyardShuffleReplacement(
        "Protection from everything\nIf Progenitus would be put into a graveyard from anywhere, reveal Progenitus and shuffle it into its owner's library instead."
      )
    ).toBe(true);
  });

  it("does not match Emrakul, the Aeons Torn's differently-worded graveyard trigger", () => {
    // Emrakul is a triggered ability that shuffles its owner's whole graveyard into their library,
    // not a replacement effect that shuffles just itself — a real, different template.
    expect(
      hasGraveyardShuffleReplacement(
        "This spell can't be countered. When you cast this spell, take an extra turn after this one. Flying, protection from spells that are one or more colors, annihilator 6. When Emrakul is put into a graveyard from anywhere, its owner shuffles their graveyard into their library."
      )
    ).toBe(false);
  });

  it("does not match an unrelated card", () => {
    expect(hasGraveyardShuffleReplacement("Flying\nWhen this creature dies, draw a card.")).toBe(false);
  });
});

describe("isAttackTriggerAddManaClause", () => {
  it("recognizes Klauth, Unrivaled Ancient's real oracle text", () => {
    expect(
      isAttackTriggerAddManaClause(
        "Flying, haste\nWhenever Klauth attacks, add X mana in any combination of colors, where X is the total power of attacking creatures. Spend this mana only to cast spells. Until end of turn, you don't lose this mana as steps and phases end."
      )
    ).toBe(true);
  });

  it("does not match a plain tap-for-mana ability", () => {
    expect(isAttackTriggerAddManaClause("{T}: Add one mana of any color.")).toBe(false);
  });

  it("does not match a differently-worded attack trigger", () => {
    expect(isAttackTriggerAddManaClause("Whenever this creature attacks, create a 1/1 white Bird creature token with flying.")).toBe(false);
  });
});

describe("isBasicLandFetchAbility / basicLandFetchCostRequiresTap / basicLandFetchManaCost", () => {
  it("recognizes Wayfarer's Bauble, including its 'put that card' phrasing and its {2} generic mana cost", () => {
    const bauble = { oracleText: "{2}, {T}, Sacrifice this artifact: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle." };
    expect(isBasicLandFetchAbility(bauble)).toBe(true);
    expect(basicLandFetchCostRequiresTap(bauble)).toBe(true);
    expect(basicLandFetchManaCost(bauble)).toBe(2);
  });

  it("recognizes Evolving Wilds' 'put it' phrasing with no generic mana cost", () => {
    const evolvingWilds = { oracleText: "{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle." };
    expect(isBasicLandFetchAbility(evolvingWilds)).toBe(true);
    expect(basicLandFetchCostRequiresTap(evolvingWilds)).toBe(true);
    expect(basicLandFetchManaCost(evolvingWilds)).toBe(0);
  });

  it("recognizes Sakura-Tribe Elder's tap-free, mana-free sacrifice cost", () => {
    const elder = { oracleText: "Sacrifice Sakura-Tribe Elder: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle." };
    expect(isBasicLandFetchAbility(elder)).toBe(true);
    expect(basicLandFetchCostRequiresTap(elder)).toBe(false);
    expect(basicLandFetchManaCost(elder)).toBe(0);
  });
});

describe("parseEmblemGrant", () => {
  it("captures the quoted rules text from a loyalty ultimate's emblem grant (Tezzeret, Artifice Master's -9)", () => {
    expect(
      parseEmblemGrant(
        '−9: You get an emblem with "At the beginning of your end step, you may cast target artifact card from your graveyard without paying its mana cost."'
      )
    ).toEqual({
      text: "At the beginning of your end step, you may cast target artifact card from your graveyard without paying its mana cost."
    });
  });

  it("returns undefined for text with no emblem grant", () => {
    expect(parseEmblemGrant("+1: Create a 1/1 colorless Thopter artifact creature token with flying.")).toBeUndefined();
  });
});

describe("parseAdditionalSacrificeCost", () => {
  it("recognizes Village Rites' single-creature additional cost", () => {
    expect(parseAdditionalSacrificeCost("As an additional cost to cast this spell, sacrifice a creature.\nDraw two cards.")).toEqual({ count: 1 });
  });

  it("recognizes a two-creature additional cost", () => {
    expect(parseAdditionalSacrificeCost("As an additional cost to cast this spell, sacrifice two creatures.")).toEqual({ count: 2 });
  });

  it("does not match a plain resolution-effect sacrifice (not an additional cost)", () => {
    expect(parseAdditionalSacrificeCost("Target player sacrifices a creature.")).toBeUndefined();
  });

  it("does not match an activated ability's sacrifice cost", () => {
    expect(parseAdditionalSacrificeCost("{T}, Sacrifice a creature: Add {B}{B}.")).toBeUndefined();
  });
});

describe("isActivatedAbilityClause", () => {
  it("recognizes mana-cost activated abilities", () => {
    expect(isActivatedAbilityClause("{1}, {T}: Add one mana of any color.")).toBe(true);
  });

  it("recognizes loyalty-cost activated abilities", () => {
    expect(isActivatedAbilityClause("+1: Create a 1/1 colorless Thopter artifact creature token with flying.")).toBe(true);
    expect(isActivatedAbilityClause("0: Draw a card. If you control three or more artifacts, draw two cards instead.")).toBe(true);
    expect(isActivatedAbilityClause('−9: You get an emblem with "At the beginning of your end step, you may cast target artifact card from your graveyard without paying its mana cost."')).toBe(true);
  });

  it("recognizes a plain-English-cost activated ability with no leading mana/tap symbol (Sakura-Tribe Elder)", () => {
    // Reproduced live: this clause leaked into etbEffectText and let an agent get its
    // (separately, correctly costed) search-a-basic-land ability a second time, for free and
    // unrestricted, the instant the creature resolved — see Sakura-Tribe Elder's Comprehensive
    // Rules-templated "Sacrifice Sakura-Tribe Elder: Search your library for a basic land card,
    // put it onto the battlefield tapped, then shuffle."
    expect(isActivatedAbilityClause("Sacrifice Sakura-Tribe Elder: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.")).toBe(
      true
    );
    expect(isActivatedAbilityClause("Sacrifice a land: Add one mana of any color.")).toBe(true);
  });

  it("does not flag ordinary static or triggered text as activated", () => {
    expect(isActivatedAbilityClause("Artifact creatures you control get +1/+1.")).toBe(false);
    expect(isActivatedAbilityClause("At the beginning of your end step, draw a card.")).toBe(false);
  });

  it("does not mistake a Room door's own name-prefix for a cost divider (Secret Arcade // Dusty Parlor)", () => {
    // Reproduced live: Dusty Parlor's cast trigger never fired even fully unlocked, because
    // "Dusty Parlor: Whenever you cast an enchantment spell, ..." has no when/whenever before its
    // own colon (the door name doesn't contain one), so it read exactly like an activated
    // ability's "cost: effect" divider and got excluded from cast-trigger scanning entirely.
    expect(
      isActivatedAbilityClause("Dusty Parlor: Whenever you cast an enchantment spell, put a number of +1/+1 counters equal to that spell's mana value on up to one target creature.")
    ).toBe(false);
    expect(
      isActivatedAbilityClause("Secret Arcade: Nonland permanents you control and permanent spells you control are enchantments in addition to their other types.")
    ).toBe(false);
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

describe("isCombatDamageToPlayerClause / combatDamageToPlayerEffectText", () => {
  const toskiOracleText = [
    "This spell can't be countered.",
    "Indestructible",
    "Toski attacks each combat if able.",
    "Whenever a creature you control deals combat damage to a player, draw a card."
  ].join("\n");

  it("isolates Toski's combat-damage clause from its other keyword lines", () => {
    expect(combatDamageToPlayerEffectText(toskiOracleText)).toBe("Whenever a creature you control deals combat damage to a player, draw a card.");
  });

  it("does not treat Indestructible or the attack-each-combat clause as a combat-damage trigger", () => {
    expect(isCombatDamageToPlayerClause("Indestructible")).toBe(false);
    expect(isCombatDamageToPlayerClause("Toski attacks each combat if able.")).toBe(false);
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
