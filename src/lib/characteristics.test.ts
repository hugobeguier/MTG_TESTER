import { describe, expect, it } from "vitest";
import { countMatchingPermanents, parseCharacteristicDefiningAbility } from "./characteristics";

describe("parseCharacteristicDefiningAbility", () => {
  it("parses a power-and-toughness CDA (Abominable Treefolk)", () => {
    expect(
      parseCharacteristicDefiningAbility(
        "Trample\nAbominable Treefolk's power and toughness are each equal to the number of snow permanents you control."
      )
    ).toEqual({ stat: "both", matcher: "snow permanents" });
  });

  it("parses a power-only CDA (Adeline, Resplendent Cathar)", () => {
    expect(parseCharacteristicDefiningAbility("Vigilance\nAdeline's power is equal to the number of creatures you control.")).toEqual({
      stat: "power",
      matcher: "creatures"
    });
  });

  it("returns undefined for a compound condition it doesn't model (Allosaurus Rider's 'plus')", () => {
    expect(
      parseCharacteristicDefiningAbility("Allosaurus Rider's power and toughness are each equal to 1 plus the number of lands you control.")
    ).toBeUndefined();
  });

  it("returns undefined for a card with no CDA", () => {
    expect(parseCharacteristicDefiningAbility("Flying, vigilance.")).toBeUndefined();
  });
});

describe("countMatchingPermanents", () => {
  const battlefield = [
    { typeLine: "Land" },
    { typeLine: "Land" },
    { typeLine: "Creature — Elf Warrior" },
    { typeLine: "Creature — Elf Druid" },
    { typeLine: "Creature — Human Soldier" },
    { typeLine: "Artifact" }
  ];

  it("counts a broad category (lands, creatures)", () => {
    expect(countMatchingPermanents(battlefield, "lands")).toBe(2);
    expect(countMatchingPermanents(battlefield, "creatures")).toBe(3);
  });

  it("counts a creature subtype (Elves)", () => {
    expect(countMatchingPermanents(battlefield, "Elves")).toBe(2);
  });

  it("returns 0 for a subtype that isn't present", () => {
    expect(countMatchingPermanents(battlefield, "Zombies")).toBe(0);
  });
});
