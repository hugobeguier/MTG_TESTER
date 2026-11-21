// Extra card metadata for the step-5 tests (type line / mana cost / P-T are not part of the kernel JSON; they come from the card DB in real use).
import type { CardDef } from "./types";

type Meta = Omit<CardDef, "kernel" | "name"> & { slug: string };
export const META5: Record<string, Meta> = {
  "Tear Asunder": { slug: "tear-asunder", manaCost: "{1}{G}", types: ["sorcery"] },
  "Otherworldly Gaze": { slug: "otherworldly-gaze", manaCost: "{U}", types: ["sorcery"] },
  "Woe Strider": { slug: "woe-strider", manaCost: "{2}{B}", types: ["creature"], subtypes: ["Horror"], power: 3, toughness: 2 },
  Gravecrawler: { slug: "gravecrawler", manaCost: "{B}", types: ["creature"], subtypes: ["Zombie"], power: 2, toughness: 1 },
  "Toxic Deluge": { slug: "toxic-deluge", manaCost: "{2}{B}", types: ["sorcery"] },
  "Unexpected Windfall": { slug: "unexpected-windfall", manaCost: "{3}{R}", types: ["sorcery"] },
  "Deadly Dispute": { slug: "deadly-dispute", manaCost: "{1}{B}", types: ["instant"] },
  "Plumb the Forbidden": { slug: "plumb-the-forbidden", manaCost: "{1}{B}", types: ["instant"] },
  "Collective Resistance": { slug: "collective-resistance", manaCost: "{1}{G}", types: ["instant"] },
  "Parting Gust": { slug: "parting-gust", manaCost: "{W}", types: ["instant"] },
  "Blasphemous Edict": { slug: "blasphemous-edict", manaCost: "{3}{B}{B}", types: ["sorcery"] },
  "Flawless Maneuver": { slug: "flawless-maneuver", manaCost: "{2}{W}", types: ["instant"] },
  "Army of the Damned": { slug: "army-of-the-damned", manaCost: "{5}{B}{B}{B}", types: ["sorcery"] },
  "Sephara, Sky's Blade": { slug: "sephara-sky-s-blade", manaCost: "{4}{W}{W}", types: ["creature"], subtypes: ["Angel"], supertypes: ["legendary"], power: 7, toughness: 7 },
  "Secluded Steppe": { slug: "secluded-steppe", types: ["land"] },
  "Shark Typhoon": { slug: "shark-typhoon", manaCost: "{5}{U}", types: ["enchantment"] },
  "Eiganjo, Seat of the Empire": { slug: "eiganjo-seat-of-the-empire", types: ["land"], supertypes: ["legendary"] },
  "Void Rend": { slug: "void-rend", manaCost: "{W}{U}{B}", types: ["instant"] },
  "Carnage Tyrant": { slug: "carnage-tyrant", manaCost: "{4}{G}{G}", types: ["creature"], subtypes: ["Dinosaur"], power: 7, toughness: 6 },
  "Lightning Greaves": { slug: "lightning-greaves", manaCost: "{2}", types: ["artifact"], subtypes: ["Equipment"] },
  "Shadowspear": { slug: "shadowspear", manaCost: "{1}", types: ["artifact"], subtypes: ["Equipment"], supertypes: ["legendary"] },
  "Bloodthirsty Blade": { slug: "bloodthirsty-blade", manaCost: "{1}", types: ["artifact"], subtypes: ["Equipment"] },
  "Arcane Denial": { slug: "arcane-denial", manaCost: "{1}{U}", types: ["instant"] },
  Bonehoard: { slug: "bonehoard", manaCost: "{4}", types: ["artifact"], subtypes: ["Equipment"] },
  "Basilisk Collar": { slug: "basilisk-collar", manaCost: "{1}", types: ["artifact"], subtypes: ["Equipment"] },
  "Swiftfoot Boots": { slug: "swiftfoot-boots", manaCost: "{2}", types: ["artifact"], subtypes: ["Equipment"] },
  Chatterstorm: { slug: "chatterstorm", manaCost: "{1}{G}", types: ["sorcery"] },
  "Stormscale Scion": { slug: "stormscale-scion", manaCost: "{4}{R}{R}", types: ["creature"], subtypes: ["Dragon"], power: 4, toughness: 4 },
  "Extravagant Replication": { slug: "extravagant-replication", manaCost: "{2}{U}{U}", types: ["enchantment"] },
  "Saheeli's Artistry": { slug: "saheeli-s-artistry", manaCost: "{3}{U}", types: ["sorcery"] },
  "Second Harvest": { slug: "second-harvest", manaCost: "{2}{G}{G}", types: ["instant"] },
  "Kappa Cannoneer": { slug: "kappa-cannoneer", manaCost: "{5}{U}", types: ["artifact", "creature"], subtypes: ["Turtle", "Warrior"], power: 4, toughness: 4 },
  "Ygra, Eater of All": { slug: "ygra-eater-of-all", manaCost: "{3}{B}{G}", types: ["creature"], subtypes: ["Cat", "Elemental"], supertypes: ["legendary"], power: 6, toughness: 6 },
  "Urza's Incubator": { slug: "urza-s-incubator", manaCost: "{3}", types: ["artifact"] },
  "Herald's Horn": { slug: "herald-s-horn", manaCost: "{3}", types: ["artifact"] },
  "Patchwork Banner": { slug: "patchwork-banner", manaCost: "{3}", types: ["artifact"] },
  "Metallic Mimic": { slug: "metallic-mimic", manaCost: "{2}", types: ["artifact", "creature"], subtypes: ["Shapeshifter"], power: 2, toughness: 1 },
  "Westvale Abbey": {
    slug: "westvale-abbey-ormendahl-profane-prince", types: ["land"], layout: "transform",
    faces: { "Ormendahl, Profane Prince": { types: ["creature"], subtypes: ["Demon"], supertypes: ["legendary"], colors: ["B"], power: 9, toughness: 7 } }
  },
  "Deathbonnet Sprout": {
    slug: "deathbonnet-sprout-deathbonnet-hulk", manaCost: "{1}{B}", types: ["creature"], subtypes: ["Plant"], power: 1, toughness: 3,
    faces: { "Deathbonnet Hulk": { types: ["creature"], subtypes: ["Plant", "Horror"], power: 3, toughness: 5 } }
  },
  Portent: { slug: "portent", manaCost: "{U}", types: ["sorcery"] },
  Inkshield: { slug: "inkshield", manaCost: "{2}{W}{B}", types: ["instant"] },
  "Emry, Lurker of the Loch": { slug: "emry-lurker-of-the-loch", manaCost: "{2}{U}", types: ["creature"], subtypes: ["Merfolk", "Wizard"], supertypes: ["legendary"], power: 1, toughness: 2 },
  "Count on Luck": { slug: "count-on-luck", manaCost: "{2}{R}", types: ["enchantment"] },
  "Together Forever": { slug: "together-forever", manaCost: "{1}{W}", types: ["enchantment"] },
  "Aminatou, the Fateshifter": { slug: "aminatou-the-fateshifter", manaCost: "{1}{W}{U}{B}", types: ["planeswalker"], subtypes: ["Aminatou"], supertypes: ["legendary"], loyalty: 3 }
};
