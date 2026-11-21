// The 16 worked examples from docs/card-schema-spec.md section 3, as fixtures. Written WITHOUT
// prompts/implementation: tests run generatePrompts + computeImplementation first (that is the
// real pipeline). Oracle text is the printed text; where the spec JSON was sloppy it is tightened
// here (see src/kernel/README.md "Deviations").

import type { Card } from "../schema";

export interface Fixture { name: string; oracle: string; card: Card; expectNeeds?: string[] }

const one = { min: 1, max: 1 };

export const SPHINX_ORACLE = "Draw two cards.\nAddendum — If you cast this spell during your main phase, you gain 2 life.";

export const sphinx: Fixture = {
  name: "Sphinx's Insight",
  oracle: SPHINX_ORACLE,
  card: {
    schemaVersion: 2,
    abilities: [{
      id: "a1", kind: "spell_effect", text: SPHINX_ORACLE,
      steps: [
        { kind: "draw_cards", amount: 2, who: "you", src: 0 },
        { kind: "life_change", lifeDelta: 2, who: "you", src: 1, condition: { when: "on_resolution", if: { check: "cast_during", phase: "your_main" }, src: 1 } }
      ]
    }]
  },
  expectNeeds: ["predicate:cast_during"]
};

const valorousOracle = "Choose one —\n• Target creature gains indestructible until end of turn.\n• Destroy target creature with toughness 4 or greater.";
export const valorous: Fixture = {
  name: "Valorous Stance",
  oracle: valorousOracle,
  card: {
    schemaVersion: 2,
    abilities: [{
      id: "a1", kind: "spell_effect", text: valorousOracle,
      modes: {
        choose: one, distinct: true,
        options: [
          { id: "m1", text: "Target creature gains indestructible until end of turn.",
            targets: [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: one }],
            steps: [{ kind: "grant_effect", target: "t1", modify: [{ grant: "indestructible" }], duration: "until_end_of_turn" }] },
          { id: "m2", text: "Destroy target creature with toughness 4 or greater.",
            targets: [{ id: "t1", what: "object", filter: { types: ["creature"], toughness: { op: ">=", value: 4 } }, count: one }],
            steps: [{ kind: "destroy_target", target: "t1" }] }
        ]
      }
    }]
  }
};

const casualtiesOracle = "Choose one or more —\n• Destroy target artifact.\n• Destroy target creature.\n• Destroy target enchantment.\n• Destroy target land.\n• Destroy target planeswalker.";
export const casualties: Fixture = {
  name: "Casualties of War",
  oracle: casualtiesOracle,
  card: {
    schemaVersion: 2,
    abilities: [{
      id: "a1", kind: "spell_effect", text: casualtiesOracle,
      modes: {
        choose: { min: 1, max: 5 }, distinct: true,
        options: ["artifact", "creature", "enchantment", "land", "planeswalker"].map((type, i) => ({
          id: `m${i + 1}`, text: `Destroy target ${type}.`,
          targets: [{ id: "t1", what: "object" as const, filter: { types: [type] }, count: one }],
          steps: [{ kind: "destroy_target" as const, target: "t1" }]
        }))
      }
    }]
  }
};

const boseijuLine2 = "Channel — {1}{G}, Discard Boseiju, Who Endures: Destroy target artifact, enchantment, or nonbasic land an opponent controls. That player may search their library for a land card with a basic land type, put it onto the battlefield, then shuffle. This ability costs {1} less to activate for each legendary creature you control.";
export const boseiju: Fixture = {
  name: "Boseiju, Who Endures",
  oracle: `{T}: Add {G}.\n${boseijuLine2}`,
  card: {
    schemaVersion: 2,
    abilities: [
      { id: "a1", kind: "mana", text: "{T}: Add {G}.", costs: [{ tap: "self" }], mana: { produces: [{ colors: "{G}" }] } },
      {
        id: "a2", kind: "activated", zone: "hand", text: boseijuLine2,
        costs: [{ mana: "{1}{G}" }, { discard: "self", count: 1 }],
        costReduction: { per: { types: ["creature"], supertypes: ["legendary"], controller: "you" }, amount: 1, applies: "generic", src: 2 },
        targets: [{
          id: "t1", what: "object", count: one,
          filter: { controller: "opponent", anyOf: [{ types: ["artifact"] }, { types: ["enchantment"] }, { types: ["land"], notSupertypes: ["basic"] }] }
        }],
        steps: [
          { kind: "destroy_target", target: "t1", src: 0 },
          { kind: "search_library", who: "controller_of_target", optional: true, filter: { types: ["land"], hasBasicLandType: true }, count: 1, to: "battlefield", shuffle: true, src: 1 }
        ]
      }
    ]
  }
};

const temporalOracle = "Take an extra turn after this one. Exile Temporal Mastery.\nMiracle {1}{U} (You may cast this card for its miracle cost when you draw it if it's the first card you drew this turn.)";
export const temporal: Fixture = {
  name: "Temporal Mastery",
  oracle: temporalOracle,
  card: {
    schemaVersion: 2,
    abilities: [{
      id: "a1", kind: "spell_effect", text: "Take an extra turn after this one. Exile Temporal Mastery.",
      steps: [{ kind: "extra_turn", who: "you", src: 0 }, { kind: "move_card_zone", target: "self", moveTo: "exile", src: 1 }]
    }],
    castOptions: [{ id: "c1", kind: "miracle", from: "hand", cost: [{ mana: "{1}{U}" }], replacesManaCost: true, when: { event: "drawn", firstThisTurn: true }, optional: true }]
  }
};

const sidisiOracle = "Deathtouch\nExploit (When this creature enters, you may sacrifice a creature.)\nWhen Sidisi exploits a creature, you may search your library for a card, put that card into your hand, then shuffle.";
export const sidisi: Fixture = {
  name: "Sidisi, Undead Vizier",
  oracle: sidisiOracle,
  card: {
    schemaVersion: 2,
    abilities: [
      { id: "a1", kind: "keyword", text: "Deathtouch", keyword: { name: "deathtouch" } },
      { id: "a2", kind: "triggered", text: "Exploit (When this creature enters, you may sacrifice a creature.)", keyword: { name: "exploit" }, trigger: { event: "etb", subject: "self" }, optional: true, steps: [{ kind: "exploit", optional: true, amount: 1 }] },
      {
        id: "a3", kind: "triggered", text: "When Sidisi exploits a creature, you may search your library for a card, put that card into your hand, then shuffle.",
        trigger: { event: "exploit", subject: "self" }, optional: true,
        steps: [{ kind: "search_library", who: "you", filter: {}, count: 1, to: "hand", shuffle: true }]
      }
    ]
  }
};

const ledgerOracle = "Flying\nWhenever a player casts their second spell each turn, Ledger Shredder connives. (Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on this creature.)";
export const ledger: Fixture = {
  name: "Ledger Shredder",
  oracle: ledgerOracle,
  card: {
    schemaVersion: 2,
    abilities: [
      { id: "a1", kind: "keyword", text: "Flying", keyword: { name: "flying" } },
      { id: "a2", kind: "triggered", text: "Whenever a player casts their second spell each turn, Ledger Shredder connives.", trigger: { event: "cast", subject: "each_player", nth: { n: 2, per: "turn" } }, steps: [{ kind: "connive", on: "self" }] }
    ]
  }
};

const sharkOracle = "Whenever you cast a noncreature spell, create an X/X blue Shark creature token with flying, where X is that spell's mana value.\nCycling {X}{1}{U} ({X}{1}{U}, Discard this card: Draw a card.)\nWhen you cycle Shark Typhoon, create an X/X blue Shark creature token with flying.";
export const shark: Fixture = {
  name: "Shark Typhoon",
  oracle: sharkOracle,
  card: {
    schemaVersion: 2,
    abilities: [
      {
        id: "a1", kind: "triggered", text: "Whenever you cast a noncreature spell, create an X/X blue Shark creature token with flying, where X is that spell's mana value.",
        trigger: { event: "cast", subject: { notTypes: ["creature"] }, whose: "yours" },
        steps: [{ kind: "create_tokens", tokenCount: 1, tokenName: "Shark", tokenPower: { ref: "stat", of: "event_object", stat: "mana_value" }, tokenToughness: { ref: "stat", of: "event_object", stat: "mana_value" }, tokenColors: ["blue"], tokenTypeLine: "Creature — Shark", tokenKeywords: ["flying"] }]
      },
      {
        id: "a2", kind: "activated", zone: "hand", keyword: { name: "cycling" }, text: "Cycling {X}{1}{U}",
        costs: [{ mana: "{X}{1}{U}" }, { discard: "self", count: 1 }], steps: [{ kind: "draw_cards", amount: 1, who: "you" }]
      },
      {
        id: "a3", kind: "triggered", zone: "hand", text: "When you cycle Shark Typhoon, create an X/X blue Shark creature token with flying.",
        trigger: { event: "cycle", subject: "self" },
        steps: [{ kind: "create_tokens", tokenCount: 1, tokenName: "Shark", tokenPower: { ref: "X" }, tokenToughness: { ref: "X" }, tokenColors: ["blue"], tokenTypeLine: "Creature — Shark", tokenKeywords: ["flying"] }]
      }
    ]
  }
};

const chatterOracle = "Forestwalk\nIf one or more tokens would be created under your control, those tokens plus that many 1/1 green Squirrel creature tokens are created instead.\n{B}, Sacrifice X Squirrels: Target creature gets +X/-X until end of turn.";
export const chatterfang: Fixture = {
  name: "Chatterfang, Squirrel General",
  oracle: chatterOracle,
  card: {
    schemaVersion: 2,
    abilities: [
      { id: "a1", kind: "keyword", text: "Forestwalk", keyword: { name: "landwalk", param: "Forest" } },
      {
        id: "a2", kind: "replacement", text: "If one or more tokens would be created under your control, those tokens plus that many 1/1 green Squirrel creature tokens are created instead.",
        replacement: { event: "would_create_token", subject: "you", result: { mode: "also", steps: [{ kind: "create_tokens", tokenCount: { ref: "event_amount" }, tokenName: "Squirrel", tokenPower: 1, tokenToughness: 1, tokenColors: ["green"], tokenTypeLine: "Creature — Squirrel" }] } }
      },
      {
        id: "a3", kind: "activated", text: "{B}, Sacrifice X Squirrels: Target creature gets +X/-X until end of turn.",
        costs: [{ mana: "{B}" }, { sacrifice: { subtypes: ["Squirrel"], controller: "you" }, count: { ref: "X" } }],
        targets: [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: one }],
        steps: [{ kind: "pump_target", target: "t1", power: { ref: "X" }, toughness: { math: "*", args: [-1, { ref: "X" }] }, duration: "until_end_of_turn" }]
      }
    ]
  }
};

const dauthiOracle = "Shadow (This creature can block or be blocked by only creatures with shadow.)\nIf a card would be put into an opponent's graveyard from anywhere, instead exile it with a void counter on it.\n{T}, Sacrifice Dauthi Voidwalker: Choose an exiled card an opponent owns with a void counter on it. You may play it this turn without paying its mana cost.";
export const dauthi: Fixture = {
  name: "Dauthi Voidwalker",
  oracle: dauthiOracle,
  card: {
    schemaVersion: 2,
    abilities: [
      { id: "a1", kind: "keyword", text: "Shadow", keyword: { name: "shadow" } },
      {
        id: "a2", kind: "replacement", text: "If a card would be put into an opponent's graveyard from anywhere, instead exile it with a void counter on it.",
        replacement: { event: "would_be_put_into_zone", subject: { zone: "any", owner: "opponent" }, toZone: "graveyard", result: { mode: "instead", steps: [{ kind: "move_card_zone", target: "event_object", moveTo: "exile" }, { kind: "add_counters", on: "event_object", counterKind: "void", amount: 1 }] } }
      },
      {
        id: "a3", kind: "activated", text: "{T}, Sacrifice Dauthi Voidwalker: Choose an exiled card an opponent owns with a void counter on it. You may play it this turn without paying its mana cost.",
        costs: [{ tap: "self" }, { sacrifice: "self", count: 1 }],
        steps: [
          { kind: "choose", from: { zone: "exile", owner: "opponent", hasCounter: "void" }, count: 1, saveAs: "chosen" },
          { kind: "permission_to_play", what: "chosen", withoutPaying: true, duration: "until_end_of_turn", optional: true }
        ]
      }
    ]
  }
};

const skullclampOracle = "Equipped creature gets +1/-1.\nWhenever equipped creature dies, draw two cards.\nEquip {1}";
export const skullclamp: Fixture = {
  name: "Skullclamp",
  oracle: skullclampOracle,
  card: {
    schemaVersion: 2,
    abilities: [
      { id: "a1", kind: "static", text: "Equipped creature gets +1/-1.", static: { affects: "equipped", modify: [{ pt: { power: 1, toughness: -1 } }] } },
      { id: "a2", kind: "triggered", text: "Whenever equipped creature dies, draw two cards.", trigger: { event: "dies", subject: "equipped" }, steps: [{ kind: "draw_cards", amount: 2, who: "you" }] },
      {
        id: "a3", kind: "activated", text: "Equip {1}", keyword: { name: "equip" }, timing: { speed: "sorcery" }, costs: [{ mana: "{1}" }],
        targets: [{ id: "t1", what: "object", filter: { types: ["creature"], controller: "you" }, count: one }],
        steps: [{ kind: "attach", what: "self", to: "t1" }]
      }
    ]
  }
};

const animateOracle = "Enchant creature card in a graveyard\nWhen Animate Dead enters the battlefield, if it's on the battlefield, it loses \"enchant creature card in a graveyard\" and gains \"enchant creature put onto the battlefield with Animate Dead.\" Return enchanted creature card to the battlefield under your control and attach Animate Dead to it. When Animate Dead leaves the battlefield, that creature's controller sacrifices it.\nEnchanted creature gets -1/-0.";
export const animateDead: Fixture = {
  name: "Animate Dead",
  oracle: animateOracle,
  card: {
    schemaVersion: 2,
    abilities: [
      { id: "a1", kind: "spell_effect", text: "Enchant creature card in a graveyard", keyword: { name: "enchant" }, targets: [{ id: "t1", what: "object", filter: { types: ["creature"], zone: "graveyard" }, count: one }] },
      {
        id: "a2", kind: "triggered",
        text: "When Animate Dead enters the battlefield, if it's on the battlefield, it loses \"enchant creature card in a graveyard\" and gains \"enchant creature put onto the battlefield with Animate Dead.\" Return enchanted creature card to the battlefield under your control and attach Animate Dead to it. When Animate Dead leaves the battlefield, that creature's controller sacrifices it.",
        trigger: { event: "etb", subject: "self", interveningIf: { check: "source_state", state: "on_battlefield" } },
        steps: [
          { kind: "rewrite_enchant" },
          { kind: "reanimate", target: "enchanted", who: "you" },
          { kind: "attach", what: "self", to: "event_object" },
          { kind: "create_delayed_trigger", trigger: { event: "leaves", subject: "self" }, steps: [{ kind: "sacrifice_permanent", target: "enchanted", who: "controller_of_target" }] }
        ]
      },
      { id: "a3", kind: "static", text: "Enchanted creature gets -1/-0.", static: { affects: "enchanted", modify: [{ pt: { power: -1, toughness: 0 } }] } }
    ]
  }
};

const merenOracle = "Whenever another creature you control dies, you get an experience counter.\nAt the beginning of your end step, choose target creature card in your graveyard. If that card's mana value is less than or equal to the number of experience counters you have, return it to the battlefield. Otherwise, put it into your hand.";
export const meren: Fixture = {
  name: "Meren of Clan Nel Toth",
  oracle: merenOracle,
  card: {
    schemaVersion: 2,
    abilities: [
      {
        id: "a1", kind: "triggered", text: "Whenever another creature you control dies, you get an experience counter.",
        trigger: { event: "dies", subject: { types: ["creature"], controller: "you", another: true } },
        steps: [{ kind: "add_counters", on: "you", counterKind: "experience", amount: 1 }]
      },
      {
        id: "a2", kind: "triggered", srcs: [0],
        text: "At the beginning of your end step, choose target creature card in your graveyard. If that card's mana value is less than or equal to the number of experience counters you have, return it to the battlefield. Otherwise, put it into your hand.",
        trigger: { event: "begin_step", step: "end_step", whose: "yours" },
        targets: [{ id: "t1", what: "object", filter: { types: ["creature"], zone: "graveyard", owner: "you" }, count: one }],
        steps: [{
          kind: "if_else", srcs: [1, 2],
          if: { check: "stat", of: "t1", stat: "mana_value", cmp: { op: "<=", value: { ref: "counters", kind: "experience", on: "you" } } },
          then: [{ kind: "reanimate", target: "t1", who: "you" }],
          else: [{ kind: "move_card_zone", target: "t1", moveTo: "hand" }]
        }]
      }
    ]
  }
};

export const viridescent: Fixture = {
  name: "Viridescent Bog",
  oracle: "{T}: Add {C}.\n{1}, {T}: Add {B}{G}.",
  card: {
    schemaVersion: 2,
    abilities: [
      { id: "a1", kind: "mana", text: "{T}: Add {C}.", costs: [{ tap: "self" }], mana: { produces: [{ colors: "{C}" }] } },
      { id: "a2", kind: "mana", text: "{1}, {T}: Add {B}{G}.", costs: [{ mana: "{1}" }, { tap: "self" }], mana: { produces: [{ colors: "{B}{G}" }] } }
    ]
  }
};

export const esper: Fixture = {
  name: "Esper Sentinel",
  oracle: "Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is Esper Sentinel's power.",
  card: {
    schemaVersion: 2,
    abilities: [{
      id: "a1", kind: "triggered", text: "Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is Esper Sentinel's power.",
      trigger: { event: "cast", subject: { notTypes: ["creature"] }, whose: "opponents", nth: { n: 1, per: "turn" } },
      steps: [{ kind: "draw_cards", amount: 1, who: "you", unlessPay: { payer: "that_player", cost: [{ mana: "{X}" }], x: { ref: "stat", of: "self", stat: "power" } } }]
    }]
  }
};

const hellkiteOracle = "Flying\n{2}: Steel Hellkite gets +1/+0 until end of turn.\n{X}: Destroy each nonland permanent with mana value X whose controller was dealt combat damage by Steel Hellkite this turn. Activate only once each turn.";
export const hellkite: Fixture = {
  name: "Steel Hellkite",
  oracle: hellkiteOracle,
  card: {
    schemaVersion: 2,
    abilities: [
      { id: "a1", kind: "keyword", text: "Flying", keyword: { name: "flying" } },
      { id: "a2", kind: "activated", text: "{2}: Steel Hellkite gets +1/+0 until end of turn.", costs: [{ mana: "{2}" }], steps: [{ kind: "pump_target", target: "self", power: 1, toughness: 0, duration: "until_end_of_turn" }] },
      {
        id: "a3", kind: "activated",
        text: "{X}: Destroy each nonland permanent with mana value X whose controller was dealt combat damage by Steel Hellkite this turn. Activate only once each turn.",
        costs: [{ mana: "{X}" }], timing: { limit: { count: 1, per: "turn" } },
        steps: [{ kind: "destroy_all", filter: { notTypes: ["land"], mv: { op: "=", value: { ref: "X" } }, controllerDealtDamageBy: "self" } }]
      }
    ]
  }
};

export const FIXTURES: Fixture[] = [
  sphinx, valorous, casualties, boseiju, temporal, sidisi, ledger, shark, chatterfang, dauthi, skullclamp,
  animateDead, meren, viridescent, esper, hellkite
];
