// Stand-in cards for specs ("what does the opponent have"): known, simple text, so a spec writer never needs a real draft. Documented in docs/card-spec-format.md.
// They take priority over real card names of the same name. All are colorless unless stated; none has any ability beyond what its name says.
import type { Card } from "../schema";
import type { CardDef } from "../engine/types";

const none: Card = { schemaVersion: 2, abilities: [] };
const kw = (name: string, text: string): Card => ({ schemaVersion: 2, abilities: [{ id: "a1", kind: "keyword", text, keyword: { name } }] });
const creature = (name: string, manaCost: string, p: number, t: number, kernel: Card = none, extra: Partial<CardDef> = {}): CardDef => ({ name, manaCost, types: ["creature"], power: p, toughness: t, kernel, ...extra });

export interface CatalogEntry { def: CardDef; text: string }
const E = (def: CardDef, text: string): [string, CatalogEntry] => [def.name, { def, text }];

export const CATALOG: ReadonlyMap<string, CatalogEntry> = new Map<string, CatalogEntry>([
  E(creature("Vanilla 1/1", "{1}", 1, 1), "Creature 1/1, mana cost {1}, no abilities."),
  E(creature("Vanilla 2/2", "{2}", 2, 2), "Creature 2/2, mana cost {2}, no abilities."),
  E(creature("Vanilla 3/3", "{3}", 3, 3), "Creature 3/3, mana cost {3}, no abilities."),
  E(creature("Vanilla 5/5", "{5}", 5, 5), "Creature 5/5, mana cost {5}, no abilities."),
  E(creature("Vanilla 2/2 Flyer", "{3}", 2, 2, kw("flying", "Flying")), "Creature 2/2, mana cost {3}, Flying."),
  E(creature("Vanilla 5/5 Flyer", "{6}", 5, 5, kw("flying", "Flying")), "Creature 5/5, mana cost {6}, Flying."),
  E(creature("Vanilla 2/2 Haste", "{3}", 2, 2, kw("haste", "Haste")), "Creature 2/2, mana cost {3}, Haste."),
  E(creature("Vanilla 2/2 First Strike", "{3}", 2, 2, kw("first_strike", "First strike")), "Creature 2/2, mana cost {3}, First strike."),
  E(creature("Vanilla 2/2 Deathtouch", "{3}", 2, 2, kw("deathtouch", "Deathtouch")), "Creature 2/2, mana cost {3}, Deathtouch."),
  E(creature("Vanilla 1/1 Hexproof", "{2}", 1, 1, kw("hexproof", "Hexproof")), "Creature 1/1, mana cost {2}, Hexproof."),
  E(creature("Grizzly Bears", "{1}{G}", 2, 2, none, { subtypes: ["Bear"] }), "Green Creature - Bear 2/2, mana cost {1}{G}, no abilities."),
  E(creature("Vanilla Artifact Creature", "{3}", 2, 2, none, { types: ["artifact", "creature"], subtypes: ["Golem"] }), "Artifact Creature - Golem 2/2, mana cost {3}, no abilities."),
  E({ name: "Vanilla Artifact", manaCost: "{2}", types: ["artifact"], kernel: none }, "Artifact, mana cost {2}, no abilities."),
  E({ name: "Vanilla Enchantment", manaCost: "{2}", types: ["enchantment"], kernel: none }, "Enchantment, mana cost {2}, no abilities."),
  E({ name: "Vanilla Instant", manaCost: "{1}", types: ["instant"], kernel: none }, "Instant, mana cost {1}, does nothing when it resolves."),
  E({ name: "Vanilla Sorcery", manaCost: "{1}", types: ["sorcery"], kernel: none }, "Sorcery, mana cost {1}, does nothing when it resolves."),
  E({ name: "Vanilla Land", types: ["land"], kernel: none }, "Land with no abilities (taps for nothing)."),
  E({
    name: "Token Maker", manaCost: "{2}", types: ["sorcery"],
    kernel: { schemaVersion: 2, abilities: [{ id: "a1", kind: "spell_effect", text: "Create a 1/1 white Soldier creature token.", steps: [{ kind: "create_tokens", tokenCount: 1, tokenName: "Soldier", tokenPower: 1, tokenToughness: 1, tokenColors: ["white"], tokenTypeLine: "Creature — Soldier" }] }] }
  }, "Sorcery, mana cost {2}: Create a 1/1 white Soldier creature token."),
  E({
    name: "Life Gainer", manaCost: "{1}", types: ["instant"],
    kernel: { schemaVersion: 2, abilities: [{ id: "a1", kind: "spell_effect", text: "You gain 3 life.", steps: [{ kind: "life_change", lifeDelta: 3, who: "you" }] }] }
  }, "Instant, mana cost {1}: You gain 3 life."),
  E({
    name: "Card Drawer", manaCost: "{2}", types: ["sorcery"],
    kernel: { schemaVersion: 2, abilities: [{ id: "a1", kind: "spell_effect", text: "Draw a card.", steps: [{ kind: "draw_cards", amount: 1, who: "you" }] }] }
  }, "Sorcery, mana cost {2}: You draw a card.")
]);

/** "Lightning Bolt", "Counterspell", "Island", "Swords to Plowshares"... are REAL cards by name (drafted in data/kernel-drafts; basic lands need no draft). */
export const catalogLookup = (name: string): CardDef | undefined => CATALOG.get(name)?.def;
