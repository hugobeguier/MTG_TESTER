import { describe, expect, it } from "vitest";
import { matchesTargetType, parseRemovalEffect } from "./removalSpells";

describe("parseRemovalEffect — destroy", () => {
  it("parses a plain destroy (Murder)", () => {
    expect(parseRemovalEffect("Destroy target creature.")).toEqual({
      kind: "destroy",
      targetType: "creature",
      excludedColors: [],
      artifactsExcluded: false
    });
  });

  it("parses a single color restriction (Doom Blade)", () => {
    expect(parseRemovalEffect("Destroy target nonblack creature.")).toEqual({
      kind: "destroy",
      targetType: "creature",
      excludedColors: ["black"],
      artifactsExcluded: false
    });
  });

  it("parses a compound restriction and ignores the trailing regeneration clause (Terror)", () => {
    expect(parseRemovalEffect("Destroy target nonartifact, nonblack creature. It can't be regenerated.")).toEqual({
      kind: "destroy",
      targetType: "creature",
      excludedColors: ["black"],
      artifactsExcluded: true
    });
  });

  it("parses a multi-type target (Bedevil)", () => {
    expect(parseRemovalEffect("Destroy target artifact, creature, or planeswalker.")).toMatchObject({
      kind: "destroy",
      targetType: "artifact_creature_or_planeswalker"
    });
  });

  it("parses destroy target permanent, ignoring a token-creation follow-up (Beast Within)", () => {
    expect(parseRemovalEffect("Destroy target permanent. Its controller creates a 3/3 green Beast creature token.")).toMatchObject({
      kind: "destroy",
      targetType: "permanent"
    });
  });

  it("parses a board wipe (Wrath of God, Damnation)", () => {
    expect(parseRemovalEffect("Destroy all creatures. They can't be regenerated.")).toEqual({ kind: "destroy_all", targetType: "creature" });
  });

  it("does not treat a conditional wipe's substring match as an unconditional wipe (Austere Command's creature mode)", () => {
    expect(parseRemovalEffect("Destroy all creatures with mana value 3 or less.")).toEqual({
      kind: "destroy_all_conditional",
      threshold: 3,
      comparison: "or_less"
    });
    expect(parseRemovalEffect("Destroy all creatures with mana value 4 or greater.")).toEqual({
      kind: "destroy_all_conditional",
      threshold: 4,
      comparison: "or_greater"
    });
  });

  it("parses an all-artifacts and all-enchantments wipe", () => {
    expect(parseRemovalEffect("Destroy all artifacts.")).toEqual({ kind: "destroy_all", targetType: "artifact" });
    expect(parseRemovalEffect("Destroy all enchantments.")).toEqual({ kind: "destroy_all", targetType: "enchantment" });
  });
});

describe("parseRemovalEffect — modal", () => {
  it("parses a 'choose one' spell, keeping only the removal-shaped mode (Boros Charm)", () => {
    expect(
      parseRemovalEffect(
        "Choose one —\n• Boros Charm deals 4 damage to target player or planeswalker.\n• Permanents you control gain indestructible until end of turn.\n• Target creature gains double strike until end of turn."
      )
    ).toEqual({
      kind: "modal",
      chooseCount: 1,
      modes: [{ kind: "damage", amount: 4, targetType: "player" }]
    });
  });

  it("parses a 'choose two' spell into all four destroy modes (Austere Command)", () => {
    const result = parseRemovalEffect(
      "Choose two —\n• Destroy all artifacts.\n• Destroy all enchantments.\n• Destroy all creatures with mana value 3 or less.\n• Destroy all creatures with mana value 4 or greater."
    );
    expect(result).toEqual({
      kind: "modal",
      chooseCount: 2,
      modes: [
        { kind: "destroy_all", targetType: "artifact" },
        { kind: "destroy_all", targetType: "enchantment" },
        { kind: "destroy_all_conditional", threshold: 3, comparison: "or_less" },
        { kind: "destroy_all_conditional", threshold: 4, comparison: "or_greater" }
      ]
    });
  });

  it("declines a modal spell where no mode is removal-shaped (Return of the Wildspeaker)", () => {
    expect(
      parseRemovalEffect(
        "Choose one —\n• Draw cards equal to the greatest power among non-Human creatures you control.\n• Non-Human creatures you control get +3/+3 until end of turn."
      )
    ).toBeUndefined();
  });
});

describe("parseRemovalEffect — variable (X) damage", () => {
  it("parses 'deals X damage to any target' (a Fireball-shaped X spell with a single target)", () => {
    expect(parseRemovalEffect("This spell deals X damage to any target.")).toEqual({ kind: "damage", amount: "X", targetType: "any" });
  });

  it("parses the split target-then-damage phrasing (Comet Storm), modeling only the base single-target case", () => {
    expect(
      parseRemovalEffect(
        "Multikicker {1} (You may pay an additional {1} any number of times as you cast this spell.)\nChoose any target, then choose another target for each time this spell was kicked. Comet Storm deals X damage to each of them."
      )
    ).toEqual({ kind: "damage", amount: "X", targetType: "any" });
  });
});

describe("parseRemovalEffect — exile", () => {
  it("parses exile target creature, ignoring a life-gain follow-up it can't compute (Swords to Plowshares)", () => {
    expect(parseRemovalEffect("Exile target creature. Its controller gains life equal to its power.")).toEqual({
      kind: "exile",
      targetType: "creature"
    });
  });

  it("parses exile target nonland permanent (Utter End)", () => {
    expect(parseRemovalEffect("Exile target nonland permanent.")).toEqual({ kind: "exile", targetType: "nonland_permanent" });
  });

  it("parses 'exile another target' (Aetherjacket)", () => {
    expect(parseRemovalEffect("Destroy another target artifact.")).toEqual({
      kind: "destroy",
      targetType: "artifact",
      excludedColors: [],
      artifactsExcluded: false
    });
    expect(parseRemovalEffect("Exile another target creature.")).toEqual({ kind: "exile", targetType: "creature" });
  });

  it("declines a temporary exile (flicker) instead of misreading it as permanent removal (Touch the Spirit Realm)", () => {
    expect(parseRemovalEffect("Exile target artifact or creature. Return it to the battlefield under its owner's control at the beginning of the next end step.")).toBeUndefined();
  });

  it("declines a temporary exile even when the target uses 'another' (Angel of Condemnation)", () => {
    expect(
      parseRemovalEffect("Exile another target creature. Return that card to the battlefield under its owner's control at the beginning of the next end step.")
    ).toBeUndefined();
  });
});

describe("parseRemovalEffect — damage", () => {
  it("parses 'deals N damage to any target' (Lightning Bolt, Shock)", () => {
    expect(parseRemovalEffect("Lightning Bolt deals 3 damage to any target.")).toEqual({ kind: "damage", amount: 3, targetType: "any" });
    expect(parseRemovalEffect("Shock deals 2 damage to any target.")).toEqual({ kind: "damage", amount: 2, targetType: "any" });
  });

  it("does not match a variable-X damage spell (Fireball)", () => {
    expect(parseRemovalEffect("Fireball deals X damage divided evenly, rounded down, among any number of targets.")).toBeUndefined();
  });
});

describe("parseRemovalEffect — bounce", () => {
  it("parses a plain creature bounce (Unsummon)", () => {
    expect(parseRemovalEffect("Return target creature to its owner's hand.")).toEqual({ kind: "bounce", targetType: "creature" });
  });

  it("parses a qualified nonland-permanent bounce, ignoring the 'you don't control' clause (Cyclonic Rift)", () => {
    expect(parseRemovalEffect("Return target nonland permanent you don't control to its owner's hand.")).toMatchObject({
      kind: "bounce",
      targetType: "nonland_permanent"
    });
  });

  it("parses a creature bounce with a life-loss follow-up it can't compute (Vapor Snag)", () => {
    expect(parseRemovalEffect("Return target creature to its owner's hand. Its controller loses 1 life.")).toEqual({
      kind: "bounce",
      targetType: "creature"
    });
  });

  it("parses 'return another target ... to its owner's hand' (Aegis Automaton)", () => {
    expect(parseRemovalEffect("Return another target creature you control to its owner's hand.")).toEqual({ kind: "bounce", targetType: "creature" });
  });
});

describe("parseRemovalEffect — non-matches", () => {
  it("does not match a card with no removal/damage effect", () => {
    expect(parseRemovalEffect("Flying, vigilance.")).toBeUndefined();
  });

  it("does not match an effect it doesn't model (Chaos Warp)", () => {
    expect(
      parseRemovalEffect(
        "The owner of target permanent shuffles it into their library, then reveals the top card of their library. If it's a permanent card, they put it onto the battlefield."
      )
    ).toBeUndefined();
  });
});

describe("matchesTargetType", () => {
  it("matches broad and narrow target types correctly", () => {
    expect(matchesTargetType({ typeLine: "Creature — Bear" }, "creature")).toBe(true);
    expect(matchesTargetType({ typeLine: "Land" }, "creature")).toBe(false);
    expect(matchesTargetType({ typeLine: "Land" }, "nonland_permanent")).toBe(false);
    expect(matchesTargetType({ typeLine: "Artifact" }, "nonland_permanent")).toBe(true);
    expect(matchesTargetType({ typeLine: "Planeswalker" }, "creature_or_planeswalker")).toBe(true);
  });
});
