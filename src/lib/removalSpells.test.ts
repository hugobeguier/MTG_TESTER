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
    expect(parseRemovalEffect("Destroy all creatures. They can't be regenerated.")).toEqual({ kind: "destroy_all" });
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
