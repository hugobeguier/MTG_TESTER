// Card definitions + helpers shared by the layer / replacement tests: real drafts with the type-line facts the card JSON
// does not carry, plus small hand-authored cards for rules the drafts do not exercise.

import { generatePrompts } from "../prompts";
import type { Ability, Card, Step } from "../schema";
import type { Run } from "./core";
import { loadDraft, lookup, table, type Table } from "./testkit";
import type { CardDef, GameState } from "./types";

const one = { min: 1, max: 1 };
const draft = (name: string, slug: string, meta: Omit<CardDef, "name" | "kernel">): CardDef => ({ name, ...meta, kernel: loadDraft(slug) });
const hand = (name: string, meta: Omit<CardDef, "name" | "kernel">, abilities: Ability[]): CardDef => ({ name, ...meta, kernel: generatePrompts({ schemaVersion: 2, abilities } as Card, name) });

const spell = (steps: Step[], targets?: Ability["targets"]): Ability[] => [{ id: "a1", kind: "spell_effect", text: "Do the thing.", steps, ...(targets ? { targets } : {}) }];
const creatureTarget = [{ id: "t1", what: "object" as const, filter: { types: ["creature"] }, count: one }];
const rune = (name: string, keyword: string): CardDef => hand(name, { manaCost: "{G}", types: ["instant"] }, spell([{ kind: "grant_effect", target: "t1", modify: [{ grant: keyword }], duration: "until_end_of_turn" } as Step], creatureTarget));
const maker = (name: string, manaCost: string, step: Step): CardDef => hand(name, { manaCost, types: ["instant"] }, spell([step]));
const replacementCard = (name: string, text: string, replacement: NonNullable<Ability["replacement"]>): CardDef =>
  hand(name, { manaCost: "{1}", types: ["enchantment"] }, [{ id: "a1", kind: "replacement", text, replacement }]);

export const CARDS: Record<string, CardDef> = {
  // ---- real drafts (type lines / mana costs from the printed cards)
  "Ancient Copper Dragon": draft("Ancient Copper Dragon", "ancient-copper-dragon", { manaCost: "{4}{R}{R}", types: ["creature"], subtypes: ["Dragon"], power: 6, toughness: 5 }),
  "Utter Insignificance": draft("Utter Insignificance", "utter-insignificance", { manaCost: "{1}{U}", types: ["enchantment"], subtypes: ["Aura"] }),
  "Draconic Visitor": draft("Draconic Visitor", "draconic-visitor", { manaCost: "{3}{R}{R}", types: ["creature"], subtypes: ["Dragon"], power: 5, toughness: 5 }),
  "Mycosynth Lattice": draft("Mycosynth Lattice", "mycosynth-lattice", { manaCost: "{6}", types: ["artifact"] }),
  "Chatterfang, Squirrel General": draft("Chatterfang, Squirrel General", "chatterfang-squirrel-general", { manaCost: "{2}{G}", types: ["creature"], supertypes: ["legendary"], subtypes: ["Squirrel", "Warlock"], power: 3, toughness: 3 }),
  "Academy Manufactor": draft("Academy Manufactor", "academy-manufactor", { manaCost: "{3}", types: ["artifact", "creature"], subtypes: ["Assembly-Worker"], power: 1, toughness: 3 }),
  "Arcane Sanctum": draft("Arcane Sanctum", "arcane-sanctum", { types: ["land"] }),
  "Crucible of Fire": draft("Crucible of Fire", "crucible-of-fire", { manaCost: "{3}{R}{R}", types: ["enchantment"] }),
  "Dragonstorm Globe": draft("Dragonstorm Globe", "dragonstorm-globe", { manaCost: "{3}", types: ["artifact"] }),
  "Shivan Devastator": draft("Shivan Devastator", "shivan-devastator", { manaCost: "{X}{R}", types: ["creature"], subtypes: ["Dragon", "Hydra"], power: 0, toughness: 0 }),
  "Twinflame Tyrant": draft("Twinflame Tyrant", "twinflame-tyrant", { manaCost: "{3}{R}{R}", types: ["creature"], subtypes: ["Dragon"], power: 3, toughness: 5 }),
  "Seraph of the Sword": draft("Seraph of the Sword", "seraph-of-the-sword", { manaCost: "{2}{W}{W}", types: ["creature"], subtypes: ["Angel"], power: 3, toughness: 4 }),
  "Kalitas, Traitor of Ghet": draft("Kalitas, Traitor of Ghet", "kalitas-traitor-of-ghet", { manaCost: "{2}{B}{B}", types: ["creature"], supertypes: ["legendary"], subtypes: ["Vampire", "Noble"], power: 3, toughness: 4 }),
  "Angel of Vitality": draft("Angel of Vitality", "angel-of-vitality", { manaCost: "{2}{W}", types: ["creature"], subtypes: ["Angel"], power: 2, toughness: 2 }),
  "Inquisitive Glimmer": draft("Inquisitive Glimmer", "inquisitive-glimmer", { manaCost: "{1}{W}", types: ["enchantment", "creature"], subtypes: ["Elf", "Glimmer"], power: 2, toughness: 2 }),
  "Thought Monitor": draft("Thought Monitor", "thought-monitor", { manaCost: "{6}{U}", types: ["artifact", "creature"], subtypes: ["Construct"], power: 2, toughness: 2 }),
  "Urborg, Tomb of Yawgmoth": draft("Urborg, Tomb of Yawgmoth", "urborg-tomb-of-yawgmoth", { types: ["land"], supertypes: ["legendary"] }),
  "Carrion Feeder": draft("Carrion Feeder", "carrion-feeder", { manaCost: "{B}", types: ["creature"], subtypes: ["Zombie"], power: 1, toughness: 1 }),
  "Spymaster's Vault": draft("Spymaster's Vault", "spymaster-s-vault", { types: ["land"] }),
  "Vow of Malice": draft("Vow of Malice", "vow-of-malice", { manaCost: "{2}{B}", types: ["enchantment"], subtypes: ["Aura"] }),
  "Godless Shrine": draft("Godless Shrine", "godless-shrine", { types: ["land"], subtypes: ["Plains", "Swamp"] }),
  "Thriving Heath": draft("Thriving Heath", "thriving-heath", { types: ["land"] }),

  // ---- hand-authored
  "Trample Rune": rune("Trample Rune", "trample"),
  "Haste Rune": rune("Haste Rune", "haste"),
  "Treasure Maker": maker("Treasure Maker", "{1}", { kind: "create_tokens", tokenCount: 1, tokenName: "Treasure", tokenColors: ["colorless"], tokenTypeLine: "Artifact — Treasure" }),
  "Goblin Maker": maker("Goblin Maker", "{R}", { kind: "create_tokens", tokenCount: 1, tokenName: "Goblin", tokenPower: 1, tokenToughness: 1, tokenColors: ["red"], tokenTypeLine: "Creature — Goblin" }),
  Study: hand("Study", { manaCost: "{U}", types: ["instant"] }, spell([{ kind: "draw_cards", amount: 2, who: "you" }])),
  Gain3: hand("Gain3", { manaCost: "{W}", types: ["instant"] }, spell([{ kind: "life_change", lifeDelta: 3, who: "you" }])),
  Grow: hand("Grow", { manaCost: "{G}", types: ["instant"] }, spell([{ kind: "add_counters", on: "t1", counterKind: "+1/+1", amount: 2 } as Step], creatureTarget)),
  Disenchant: hand("Disenchant", { manaCost: "{W}", types: ["instant"] }, spell([{ kind: "destroy_target", target: "t1" }], [{ id: "t1", what: "object", filter: { types: ["enchantment"] }, count: one }])),
  Shrink: hand("Shrink", { manaCost: "{U}", types: ["instant"] }, spell([{ kind: "grant_effect", target: "t1", modify: [{ setBasePT: { power: 1, toughness: 1 } }], duration: "until_end_of_turn" } as Step], creatureTarget)),
  "Glorious Anthem": hand("Glorious Anthem", { manaCost: "{1}{W}{W}", types: ["enchantment"] }, [{ id: "a1", kind: "static", text: "Creatures you control get +1/+1.", static: { affects: { types: ["creature"], controller: "you" }, modify: [{ pt: { power: 1, toughness: 1 } }] } }]),
  "Whelp": hand("Whelp", { manaCost: "{1}{R}", types: ["creature"], subtypes: ["Dragon"], power: 2, toughness: 2 }, []),
  "Upkeep Pinger": hand("Upkeep Pinger", { manaCost: "{1}", types: ["creature"], subtypes: ["Spirit"], power: 1, toughness: 1 }, [{
    id: "a1", kind: "triggered", text: "At the beginning of your upkeep, you gain 1 life.", trigger: { event: "begin_step", step: "upkeep", whose: "yours" },
    steps: [{ kind: "life_change", lifeDelta: 1, who: "you" }]
  }]),
  "Graveyard Bard": hand("Graveyard Bard", { manaCost: "{B}", types: ["creature"], power: 1, toughness: 1 }, [{
    id: "a1", kind: "static", zone: "graveyard", text: "As long as this card is in your graveyard, creatures you control get +1/+1.", static: { affects: { types: ["creature"], controller: "you" }, modify: [{ pt: { power: 1, toughness: 1 } }] }
  }]),
  Explorer: hand("Explorer", { manaCost: "{1}{G}", types: ["creature"], power: 1, toughness: 1 }, [{ id: "a1", kind: "static", text: "You may play an additional land on each of your turns.", static: { affects: "you", modify: [{ extraLandDrops: 1 }] } }]),
  "Spirit Ward": replacementCard("Spirit Ward", "If you would draw a card, instead you gain 2 life.", { event: "would_draw", subject: "you", result: { mode: "instead", steps: [{ kind: "life_change", lifeDelta: 2, who: "you" }] } }),
  "Draw Ban": replacementCard("Draw Ban", "Players can't draw cards.", { event: "would_draw", subject: "each_player", result: { mode: "prevent" } }),
  "Hardened Scales": replacementCard("Hardened Scales", "If one or more +1/+1 counters would be put on a creature you control, that many plus one are put on it instead.", { event: "would_add_counters" as never, subject: { types: ["creature"], controller: "you" }, result: { mode: "modify", set: { amount: { add: 1 } } } }),
  "Frozen Lands": replacementCard("Frozen Lands", "Lands enter tapped.", { event: "would_enter", subject: { types: ["land"] }, result: { mode: "modify", set: { tapped: true } } }),
  "Doubling Season": replacementCard("Doubling Season", "If an effect would create one or more tokens under your control, it creates twice that many instead.", { event: "would_create_token", subject: "you", result: { mode: "modify", set: { count: { multiply: 2 } } } }),
  "Lotus Shield": replacementCard("Lotus Shield", "Prevent all damage that would be dealt to you.", { event: "would_deal_damage", recipient: "you" as never, result: { mode: "prevent" } }),
  "Optional Shield": replacementCard("Optional Shield", "You may have things happen.", { event: "would_enter", optional: true, result: { mode: "modify", set: { tapped: true } } }),
  "Trauma Ward": replacementCard("Trauma Ward", "Players can't discard cards.", { event: "would_discard", subject: "each_player", result: { mode: "prevent" } })
};

export type { Table };
export const defs = (n: string): CardDef | undefined => CARDS[n] ?? lookup(n);

/** A game table whose card lookup knows the cards above. */
export function game(opts: Parameters<typeof table>[1] = {}): Table {
  return table(["p1", "p2"], { ...opts, extra: { ...CARDS, ...(opts.extra ?? {}) } });
}

/** A read-only Run over a state, for calling chars() / abilitiesOf() and friends from tests. */
export function runOf(state: GameState): Run { return { s: structuredClone(state), events: [], defs, scanned: 0 }; }
