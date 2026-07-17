import { describe, expect, it } from "vitest";
import {
  computeDevotion,
  countMatchingPermanents,
  hasChooseCreatureTypeEtb,
  parseCharacteristicDefiningAbility,
  parseChooseColorEtb,
  parseDevotionCda,
  parseGroupAnthemBoost,
  parseGroupKeywordGrant,
  parseSelfAnthemBoost,
  permanentMatchesQualifier,
  pickChosenColor,
  pickChosenCreatureType
} from "./characteristics";

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

describe("parseSelfAnthemBoost", () => {
  it("parses a graveyard-count anthem (Jarad, Golgari Lich Lord)", () => {
    expect(parseSelfAnthemBoost("Jarad gets +1/+1 for each creature card in your graveyard.")).toEqual({
      power: 1,
      toughness: 1,
      matcher: "creature",
      zone: "graveyard"
    });
  });

  it("parses a battlefield-count anthem", () => {
    expect(parseSelfAnthemBoost("~ gets +1/+1 for each Zombie you control.")).toEqual({
      power: 1,
      toughness: 1,
      matcher: "zombie",
      zone: "battlefield"
    });
  });

  it("returns undefined for a card with no self-anthem text", () => {
    expect(parseSelfAnthemBoost("Flying, vigilance.")).toBeUndefined();
  });
});

describe("parseGroupKeywordGrant", () => {
  it("parses a single-keyword grant to a creature type (Dragons you control have indestructible)", () => {
    expect(parseGroupKeywordGrant("Dragons you control have indestructible.")).toEqual([
      { matcher: "dragons", excludeSelf: false, keywords: ["indestructible"] }
    ]);
  });

  it("parses a multi-keyword grant to a compound qualifier (enchantment creatures)", () => {
    expect(parseGroupKeywordGrant("Enchantment creatures you control have deathtouch, lifelink, and hexproof.")).toEqual([
      { matcher: "enchantment creatures", excludeSelf: false, keywords: ["deathtouch", "lifelink", "hexproof"] }
    ]);
  });

  it("parses 'other' as excluding the source itself (Soaring Lightbringer)", () => {
    expect(parseGroupKeywordGrant("Other enchantment creatures you control have flying.")).toEqual([
      { matcher: "enchantment creatures", excludeSelf: true, keywords: ["flying"] }
    ]);
  });

  it("returns an empty array for a card with no group keyword grant", () => {
    expect(parseGroupKeywordGrant("Flying, vigilance.\nWhenever this creature attacks, draw a card.")).toEqual([]);
  });
});

describe("parseDevotionCda", () => {
  it("parses a power-only devotion CDA (Callaphe, Beloved of the Sea)", () => {
    expect(parseDevotionCda("Callaphe's power is equal to your devotion to blue.")).toEqual({ stat: "power", color: "U" });
  });

  it("parses a power-and-toughness devotion CDA", () => {
    expect(parseDevotionCda("Fanatic of Mogis's power and toughness are each equal to your devotion to red.")).toEqual({
      stat: "both",
      color: "R"
    });
  });

  it("returns undefined for a card with no devotion CDA", () => {
    expect(parseDevotionCda("Flying, vigilance.")).toBeUndefined();
  });
});

describe("computeDevotion", () => {
  it("counts colored mana symbols across permanents you control", () => {
    const battlefield = [{ manaCost: "{1}{U}{U}" }, { manaCost: "{U}" }, { manaCost: "{2}{B}" }];
    expect(computeDevotion(battlefield, "U")).toBe(3);
    expect(computeDevotion(battlefield, "B")).toBe(1);
  });

  it("counts hybrid and Phyrexian symbols toward every color they include", () => {
    const battlefield = [{ manaCost: "{B/G}{B/G}" }, { manaCost: "{U/P}" }];
    expect(computeDevotion(battlefield, "B")).toBe(2);
    expect(computeDevotion(battlefield, "G")).toBe(2);
    expect(computeDevotion(battlefield, "U")).toBe(1);
  });
});

describe("hasChooseCreatureTypeEtb", () => {
  it("recognizes the 'as this land enters, choose a creature type' template (Cavern of Souls)", () => {
    expect(
      hasChooseCreatureTypeEtb("As this land enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color.")
    ).toBe(true);
  });

  it("recognizes the template with the source's real name (Morophon, the Boundless)", () => {
    expect(hasChooseCreatureTypeEtb("Changeling\nAs Morophon enters, choose a creature type.")).toBe(true);
  });

  it("returns false for a card with no such clause", () => {
    expect(hasChooseCreatureTypeEtb("Flying, vigilance.")).toBe(false);
  });
});

describe("pickChosenCreatureType", () => {
  it("picks the most represented creature type in the pool", () => {
    const pool = [
      { typeLine: "Creature — Zombie" },
      { typeLine: "Creature — Zombie Wizard" },
      { typeLine: "Creature — Goblin" },
      { typeLine: "Land" }
    ];
    expect(pickChosenCreatureType(pool)).toBe("Zombie");
  });

  it("breaks ties alphabetically", () => {
    const pool = [{ typeLine: "Creature — Zombie" }, { typeLine: "Creature — Elf" }];
    expect(pickChosenCreatureType(pool)).toBe("Elf");
  });

  it("returns undefined when the pool has no creature types", () => {
    expect(pickChosenCreatureType([{ typeLine: "Land" }, { typeLine: "Artifact" }])).toBeUndefined();
  });
});

describe("parseChooseColorEtb", () => {
  it("recognizes the Thriving-cycle template with a leading 'enters tapped' sentence on the same line", () => {
    expect(parseChooseColorEtb("This land enters tapped. As it enters, choose a color other than black.\n{T}: Add {B} or one mana of the chosen color.")).toEqual(
      { excludedColor: "B" }
    );
  });

  it("recognizes the Gate-cycle template with 'enters tapped' on its own separate line", () => {
    expect(
      parseChooseColorEtb("This land enters tapped.\nAs this land enters, choose a color other than white.\n{T}: Add {W} or one mana of the chosen color.")
    ).toEqual({ excludedColor: "W" });
  });

  it("recognizes a plain unrestricted choice with no 'other than' clause", () => {
    expect(parseChooseColorEtb("As this creature enters, choose a color.")).toEqual({ excludedColor: undefined });
  });

  it("declines a compound choice this doesn't model (choose a color and a creature type)", () => {
    expect(parseChooseColorEtb("As this artifact enters, choose a color and a creature type.")).toBeUndefined();
  });

  it("declines an unrelated 'choose a color word' mechanic", () => {
    expect(parseChooseColorEtb("As this enchantment enters, choose a color word.")).toBeUndefined();
  });

  it("returns undefined for a card with no such clause", () => {
    expect(parseChooseColorEtb("Flying, vigilance.")).toBeUndefined();
  });
});

describe("pickChosenColor", () => {
  it("picks the most represented color in the pool, excluding the restricted color", () => {
    const pool = [{ manaCost: "{1}{U}{U}" }, { manaCost: "{B}" }, { manaCost: "{B}{B}" }];
    expect(pickChosenColor(pool, "B")).toBe("U");
  });

  it("breaks ties alphabetically", () => {
    const pool = [{ manaCost: "{U}" }, { manaCost: "{G}" }];
    expect(pickChosenColor(pool)).toBe("G");
  });
});

describe("parseGroupAnthemBoost", () => {
  it("parses a counter-scaled group anthem (Boon of the Spirit Realm)", () => {
    expect(parseGroupAnthemBoost("Creatures you control get +1/+1 for each blessing counter on this enchantment.")).toEqual([
      { matcher: "creatures", excludeSelf: false, power: 1, toughness: 1, multiplier: { kind: "counter", counterKind: "blessing" } }
    ]);
  });

  it("parses a flat group anthem with no multiplier", () => {
    expect(parseGroupAnthemBoost("Creatures you control get +1/+1.")).toEqual([
      { matcher: "creatures", excludeSelf: false, power: 1, toughness: 1, multiplier: undefined }
    ]);
  });

  it("parses a permanent-count-scaled group anthem with 'other'", () => {
    expect(parseGroupAnthemBoost("Other creatures you control get +1/+1 for each Zombie you control.")).toEqual([
      { matcher: "creatures", excludeSelf: true, power: 1, toughness: 1, multiplier: { kind: "permanent_count", countMatcher: "zombie" } }
    ]);
  });

  it("returns an empty array for a card with no group anthem", () => {
    expect(parseGroupAnthemBoost("Flying, vigilance.")).toEqual([]);
  });

  it("parses a chosen-type-restricted group anthem (Morophon, the Boundless)", () => {
    expect(parseGroupAnthemBoost("Other creatures you control of the chosen type get +1/+1.")).toEqual([
      { matcher: "creatures", excludeSelf: true, requiresChosenType: true, power: 1, toughness: 1, multiplier: undefined }
    ]);
  });
});

describe("permanentMatchesQualifier", () => {
  it("matches a compound qualifier requiring every word (artifact creatures)", () => {
    expect(permanentMatchesQualifier({ typeLine: "Artifact Creature — Golem" }, "artifact creatures")).toBe(true);
    expect(permanentMatchesQualifier({ typeLine: "Artifact" }, "artifact creatures")).toBe(false);
    expect(permanentMatchesQualifier({ typeLine: "Creature — Golem" }, "artifact creatures")).toBe(false);
  });

  it("matches a token qualifier", () => {
    expect(permanentMatchesQualifier({ typeLine: "Creature — Zombie", token: true }, "creature tokens")).toBe(true);
    expect(permanentMatchesQualifier({ typeLine: "Creature — Zombie", token: false }, "creature tokens")).toBe(false);
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
