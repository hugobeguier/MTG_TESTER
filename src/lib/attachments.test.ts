import { describe, expect, it } from "vitest";
import {
  attachedBasePowerToughness,
  attachedPowerToughnessBonus,
  attachmentGrantsExtraBeginningPhase,
  attachmentStripsAllAbilities,
  enchantRestriction,
  equipCost,
  grantedKeywords,
  grantedProtectionColors,
  isAura,
  isEquipment,
  isRemovalStyleAura,
  playerCreatureLockEffect,
  restrictsNonManaNonLoyaltyAbilities
} from "./attachments";

describe("isAura / isEquipment", () => {
  it("detects Auras and Equipment by type line", () => {
    expect(isAura({ typeLine: "Enchantment — Aura" })).toBe(true);
    expect(isAura({ typeLine: "Enchantment" })).toBe(false);
    expect(isEquipment({ typeLine: "Artifact — Equipment" })).toBe(true);
    expect(isEquipment({ typeLine: "Artifact" })).toBe(false);
  });
});

describe("enchantRestriction", () => {
  it("parses a plain creature restriction (Pacifism, Rancor)", () => {
    expect(enchantRestriction("Enchant creature\nEnchanted creature can't attack or block.")).toBe("creature");
  });

  it("parses a creature-you-control restriction (Cartouche of Strength)", () => {
    expect(enchantRestriction("Enchant creature you control\nEnchanted creature gets +1/+1 and has trample.")).toBe("creature_you_control");
  });

  it("parses a player restriction (Overwhelming Splendor, the Curse cycle)", () => {
    expect(enchantRestriction("Enchant player\nEnchanted player can't cast spells with the same name as a permanent you control.")).toBe("player");
    expect(enchantRestriction("Enchant opponent\nWhenever a creature enters the battlefield under your control, that creature deals 1 damage to enchanted player.")).toBe(
      "player"
    );
  });
});

describe("equipCost", () => {
  it("parses a numeric equip cost (Bonesplitter, Sword of Fire and Ice)", () => {
    expect(equipCost("Equipped creature gets +2/+0.\nEquip {1}")).toBe(1);
    expect(equipCost("Equipped creature gets +2/+2 and has protection from red and from blue.\nEquip {2}")).toBe(2);
  });

  it("parses Equip {0} (Lightning Greaves)", () => {
    expect(equipCost("Equipped creature has haste and shroud.\nEquip {0}")).toBe(0);
  });
});

describe("attachedPowerToughnessBonus", () => {
  it("parses a fixed bonus (Rancor)", () => {
    expect(attachedPowerToughnessBonus("Enchanted creature gets +2/+0 and has trample.")).toEqual({ power: 2, toughness: 0 });
  });

  it("parses a fixed bonus for Equipment (Bonesplitter)", () => {
    expect(attachedPowerToughnessBonus("Equipped creature gets +2/+0.")).toEqual({ power: 2, toughness: 0 });
  });

  it("does not extract a dynamic per-enchantment bonus as if it were fixed (Ethereal Armor)", () => {
    expect(attachedPowerToughnessBonus("Enchanted creature gets +1/+1 for each enchantment you control and has first strike.")).toBeUndefined();
  });

  it("returns undefined when there's no power/toughness bonus at all (Pacifism, Lightning Greaves)", () => {
    expect(attachedPowerToughnessBonus("Enchanted creature can't attack or block.")).toBeUndefined();
    expect(attachedPowerToughnessBonus("Equipped creature has haste and shroud.")).toBeUndefined();
  });
});

describe("attachedBasePowerToughness", () => {
  it("parses a fixed base P/T override (Almost Perfect)", () => {
    expect(attachedBasePowerToughness("Enchant creature\nEnchanted creature has base power and toughness 9/10 and has indestructible.")).toEqual({
      power: 9,
      toughness: 10
    });
  });

  it("parses a life-total-based base P/T override (Aettir and Priwen)", () => {
    expect(attachedBasePowerToughness("Equipped creature has base power and toughness X/X, where X is your life total.\nEquip {5}")).toBe("life_total");
  });

  it("returns undefined for a plain +N/+N pump (Rancor)", () => {
    expect(attachedBasePowerToughness("Enchanted creature gets +2/+0 and has trample.")).toBeUndefined();
  });

  it("parses a base P/T override sharing a sentence with an ability-loss clause (Utter Insignificance)", () => {
    expect(attachedBasePowerToughness("Flash\nEnchant creature\nEnchanted creature loses all abilities and has base power and toughness 1/1.\n{2}{C}: Exile enchanted creature.")).toEqual(
      { power: 1, toughness: 1 }
    );
  });
});

describe("attachmentStripsAllAbilities", () => {
  it("flags an enchanted-creature ability-loss clause (Utter Insignificance)", () => {
    expect(attachmentStripsAllAbilities("Enchanted creature loses all abilities and has base power and toughness 1/1.")).toBe(true);
  });

  it("does not flag an ordinary buff or removal aura (Rancor, Pacifism)", () => {
    expect(attachmentStripsAllAbilities("Enchanted creature gets +2/+0 and has trample.")).toBe(false);
    expect(attachmentStripsAllAbilities("Enchanted creature can't attack or block.")).toBe(false);
  });
});

describe("playerCreatureLockEffect", () => {
  it("parses the board-wide creature lock (Overwhelming Splendor)", () => {
    expect(
      playerCreatureLockEffect(
        "Enchant player\nCreatures enchanted player controls lose all abilities and have base power and toughness 1/1.\nEnchanted player can't activate abilities that aren't mana abilities or loyalty abilities."
      )
    ).toEqual({ power: 1, toughness: 1 });
  });

  it("returns undefined for a single-creature ability-loss aura (Utter Insignificance)", () => {
    expect(playerCreatureLockEffect("Enchanted creature loses all abilities and has base power and toughness 1/1.")).toBeUndefined();
  });
});

describe("restrictsNonManaNonLoyaltyAbilities", () => {
  it("flags Overwhelming Splendor's activation lock", () => {
    expect(restrictsNonManaNonLoyaltyAbilities("Enchanted player can't activate abilities that aren't mana abilities or loyalty abilities.")).toBe(true);
  });

  it("does not flag an unrelated aura", () => {
    expect(restrictsNonManaNonLoyaltyAbilities("Enchanted creature can't attack or block.")).toBe(false);
  });
});

describe("attachmentGrantsExtraBeginningPhase", () => {
  it("flags Shadow of the Second Sun's extra-phase trigger", () => {
    expect(
      attachmentGrantsExtraBeginningPhase(
        "Enchant player\nAt the beginning of each of enchanted player's postcombat main phases, there is an additional beginning phase after this phase."
      )
    ).toBe(true);
  });

  it("does not flag an unrelated player-enchanting aura", () => {
    expect(restrictsNonManaNonLoyaltyAbilities("Enchant player\nEnchanted player can't cast spells with the same name as a permanent you control.")).toBe(false);
  });
});

describe("grantedKeywords", () => {
  it("parses a single granted keyword alongside a P/T bonus (Rancor)", () => {
    expect(grantedKeywords("Enchanted creature gets +2/+0 and has trample.")).toEqual(["trample"]);
  });

  it("parses multiple granted keywords with no P/T bonus (Lightning Greaves)", () => {
    expect(grantedKeywords("Equipped creature has haste and shroud.")).toEqual(["shroud", "haste"]);
  });

  it("does not extract keywords from the equipment/aura's own unrelated text", () => {
    expect(grantedKeywords("Enchant creature\nEnchanted creature can't attack or block.")).toEqual([]);
  });

  it("does not treat granted protection as a plain keyword (Sword of Fire and Ice)", () => {
    expect(grantedKeywords("Equipped creature gets +2/+2 and has protection from red and from blue.")).toEqual([]);
  });
});

describe("grantedProtectionColors", () => {
  it("parses granted protection colors (Sword of Fire and Ice)", () => {
    expect(new Set(grantedProtectionColors("Equipped creature gets +2/+2 and has protection from red and from blue."))).toEqual(new Set(["red", "blue"]));
  });

  it("returns an empty list when nothing is granted", () => {
    expect(grantedProtectionColors("Equipped creature gets +2/+0.")).toEqual([]);
  });
});

describe("isRemovalStyleAura", () => {
  it("flags a can't-attack-or-block aura as removal-style (Pacifism)", () => {
    expect(isRemovalStyleAura("Enchant creature\nEnchanted creature can't attack or block.")).toBe(true);
  });

  it("does not flag a positive buff aura (Rancor)", () => {
    expect(isRemovalStyleAura("Enchant creature\nEnchanted creature gets +2/+0 and has trample.")).toBe(false);
  });
});
