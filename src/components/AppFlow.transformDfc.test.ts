import { describe, expect, it } from "vitest";
import { modalDoubleFacedLandSplit } from "./AppFlow";
import type { CardFaceRecord, VisibleCard } from "@/lib/types";

function face(overrides: Partial<CardFaceRecord> & Pick<CardFaceRecord, "name" | "typeLine" | "oracleText">): CardFaceRecord {
  return { colors: [], ...overrides };
}

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "typeLine" | "oracleText" | "faces">): VisibleCard {
  return { manaValue: 0, colors: [], role: "spell", zone: "hand", ...overrides };
}

describe("modalDoubleFacedLandSplit", () => {
  it("recognizes a genuine modal DFC land (Bala Ged Recovery // Bala Ged Sanctuary)", () => {
    const bala = card({
      id: "bala",
      name: "Bala Ged Recovery // Bala Ged Sanctuary",
      typeLine: "Sorcery",
      oracleText: "Return target card from your graveyard to your hand.",
      faces: [
        face({ name: "Bala Ged Recovery", typeLine: "Sorcery", oracleText: "Return target card from your graveyard to your hand.", manaCost: "{2}{G}" }),
        face({ name: "Bala Ged Sanctuary", typeLine: "Land", oracleText: "This land enters tapped.\n{T}: Add {G}.", manaCost: "" })
      ]
    });
    const split = modalDoubleFacedLandSplit(bala);
    expect(split?.spellFace.name).toBe("Bala Ged Recovery");
    expect(split?.landFace.name).toBe("Bala Ged Sanctuary");
  });

  it("does NOT treat a transform card's land back face as independently castable (Storm the Vault // Vault of Catlacan)", () => {
    // Reported live: the game offered to "play the land side" of a transforming DFC whose back
    // face can only ever be reached by the front permanent transforming, never cast from hand.
    const stormTheVault = card({
      id: "storm-the-vault",
      name: "Storm the Vault // Vault of Catlacan",
      typeLine: "Legendary Enchantment",
      oracleText:
        "Whenever one or more creatures you control deal combat damage to a player, create a Treasure token.\nAt the beginning of your end step, if you control five or more artifacts, transform Storm the Vault.",
      faces: [
        face({
          name: "Storm the Vault",
          typeLine: "Legendary Enchantment",
          oracleText:
            "Whenever one or more creatures you control deal combat damage to a player, create a Treasure token.\nAt the beginning of your end step, if you control five or more artifacts, transform Storm the Vault.",
          manaCost: "{2}{U}{R}"
        }),
        face({
          name: "Vault of Catlacan",
          typeLine: "Legendary Land",
          oracleText: "(Transforms from Storm the Vault.)\n{T}: Add one mana of any color.\n{T}: Add {U} for each artifact you control.",
          manaCost: ""
        })
      ]
    });
    expect(modalDoubleFacedLandSplit(stormTheVault)).toBeUndefined();
  });

  it("still declines a transform card whose back face is the non-land side (Westvale Abbey // Ormendahl, Profane Prince)", () => {
    const westvaleAbbey = card({
      id: "westvale-abbey",
      name: "Westvale Abbey // Ormendahl, Profane Prince",
      typeLine: "Land",
      oracleText: "{T}: Add {C}.\n{5}, {T}, Sacrifice five creatures: Transform Westvale Abbey.",
      faces: [
        face({ name: "Westvale Abbey", typeLine: "Land", oracleText: "{T}: Add {C}.\n{5}, {T}, Sacrifice five creatures: Transform Westvale Abbey.", manaCost: "" }),
        face({ name: "Ormendahl, Profane Prince", typeLine: "Legendary Creature — Demon", oracleText: "(Transforms from Westvale Abbey.)\nFlying, lifelink, indestructible", manaCost: "" })
      ]
    });
    expect(modalDoubleFacedLandSplit(westvaleAbbey)).toBeUndefined();
  });
});
