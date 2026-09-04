// Fixed regression scenarios for grading agent decision quality — see scripts/agent-bench.mjs for
// the runner. Each scenario is a real (or near-real) board state, shaped exactly like what
// buildAgentDecisionContext/agentSeatSnapshot (src/components/AppFlow.tsx) sends to
// POST /api/agents/action, paired with which legalActions.id is the correct call and why.
//
// Keep these few and deliberately hard: the point isn't coverage of every mechanic (actionScoring.ts's
// own heuristic already gets easy cases right on its own), it's catching regressions in judgment
// calls a model/prompt/quant change could silently make worse — overextending into open mana,
// picking the wrong attack target in multiplayer, lethal-prevention blocks, 2-for-1 value, and
// protecting the commander. Add a new scenario whenever a live playtest surfaces a bad call that
// wasn't obviously wrong from the heuristic score alone (i.e. judgment, not a rules bug).

function card(overrides) {
  return {
    id: overrides.id,
    name: overrides.name,
    typeLine: overrides.typeLine ?? "Creature",
    oracleText: overrides.oracleText ?? "",
    manaCost: overrides.manaCost,
    manaValue: overrides.manaValue ?? 0,
    power: overrides.power,
    toughness: overrides.toughness,
    tapped: overrides.tapped ?? false,
    ...overrides
  };
}

export const scenarios = [
  {
    id: "always-play-the-land",
    category: "tempo",
    description:
      "Reported live: Veyra passed on turn start reasoning \"no immediate threats or opportunities justify spending a turn playing a land.\" A land drop is free (no mana, no card, no tempo cost) and should be taken on essentially every turn regardless of whether anything else is happening.",
    agentName: "Veyra",
    seatName: "Veyra",
    context: {
      purpose: "main_phase",
      turn: 3,
      you: {
        life: 40,
        availableMana: { total: 2 },
        battlefield: [card({ id: "y1", name: "Forest", typeLine: "Land", manaValue: 0 }), card({ id: "y2", name: "Plains", typeLine: "Land", manaValue: 0 })],
        hand: [card({ id: "h1", name: "Island", typeLine: "Land", manaValue: 0 })]
      },
      opponents: [{ id: "opp1", name: "Rival", life: 40, battlefield: [] }]
    },
    legalActions: [
      { id: "a1", actionType: "play_land", cardId: "h1", targetIds: [], label: "Play Island" },
      { id: "a2", actionType: "pass_priority", targetIds: [], label: "Pass this phase" }
    ],
    acceptableLegalActionIds: ["a1"]
  },
  {
    id: "hold-into-open-mana",
    category: "threat-assessment",
    description:
      "Opponent has an empty board with 4 untapped mana on turn 6 and hasn't cast a spell in 3 turns (sweeper tell) — playing a 3rd creature risks a 3-for-1 blowout for no reason.",
    agentName: "Veyra",
    seatName: "Veyra",
    context: {
      purpose: "main_phase",
      turn: 6,
      you: {
        life: 38,
        availableMana: { total: 4 },
        battlefield: [
          card({ id: "y1", name: "Elite Vanguard", power: "2", toughness: "1" }),
          card({ id: "y2", name: "Watchwolf", power: "3", toughness: "3" })
        ],
        hand: [
          card({ id: "h1", name: "Silverback Elder", manaValue: 3, power: "3", toughness: "4" }),
          card({ id: "h2", name: "Growth-Chamber Guardian", manaValue: 2, power: "1", toughness: "1" })
        ]
      },
      opponents: [{ id: "opp1", name: "Vex", life: 35, availableMana: { total: 4 }, battlefield: [] }]
    },
    legalActions: [
      {
        id: "a1",
        actionType: "cast_spell",
        cardId: "h1",
        targetIds: [],
        label: "Cast Silverback Elder",
        detail: "Creature 3/4",
        role: "creature"
      },
      { id: "a2", actionType: "pass_priority", targetIds: [], label: "Hold remaining hand" }
    ],
    acceptableLegalActionIds: ["a2"]
  },
  {
    id: "safe-to-extend-tapped-out",
    category: "threat-assessment",
    description:
      "Negative control for the scenario above: the same choice, but the opponent is fully tapped out — extending the board is correct here, not a blowout risk.",
    agentName: "Veyra",
    seatName: "Veyra",
    context: {
      purpose: "main_phase",
      turn: 6,
      you: {
        life: 38,
        availableMana: { total: 4 },
        battlefield: [
          card({ id: "y1", name: "Elite Vanguard", power: "2", toughness: "1" }),
          card({ id: "y2", name: "Watchwolf", power: "3", toughness: "3" })
        ],
        hand: [card({ id: "h1", name: "Silverback Elder", manaValue: 3, power: "3", toughness: "4" })]
      },
      opponents: [{ id: "opp1", name: "Vex", life: 35, availableMana: { total: 0 }, battlefield: [] }]
    },
    legalActions: [
      {
        id: "a1",
        actionType: "cast_spell",
        cardId: "h1",
        targetIds: [],
        label: "Cast Silverback Elder",
        detail: "Creature 3/4",
        role: "creature"
      },
      { id: "a2", actionType: "pass_priority", targetIds: [], label: "Hold remaining hand" }
    ],
    acceptableLegalActionIds: ["a1"]
  },
  {
    id: "take-the-lethal-attack",
    category: "attack-targeting",
    description:
      "Multiplayer attack targeting: one opponent is at 3 life and this attack is lethal to them; another opponent has a much bigger board but isn't in immediate danger. Take the win.",
    agentName: "Malik",
    seatName: "Malik",
    context: {
      purpose: "declare_attackers",
      turn: 9,
      you: {
        life: 30,
        battlefield: [card({ id: "atk1", name: "Shivan Dragon", power: "5", toughness: "5" })]
      },
      opponents: [
        { id: "low", name: "Priest of Low Life", life: 3, battlefield: [] },
        {
          id: "big",
          name: "Board Baron",
          life: 30,
          battlefield: [
            card({ id: "b1", name: "Craterhoof Behemoth", power: "7", toughness: "7" }),
            card({ id: "b2", name: "Avenger of Zendikar", power: "5", toughness: "5" })
          ]
        }
      ]
    },
    legalActions: [
      { id: "a1", actionType: "attack", cardId: "atk1", targetIds: ["low"], label: "Attack Priest of Low Life" },
      { id: "a2", actionType: "attack", cardId: "atk1", targetIds: ["big"], label: "Attack Board Baron" },
      { id: "a3", actionType: "pass_priority", targetIds: [], label: "Declare no attackers" }
    ],
    acceptableLegalActionIds: ["a1"]
  },
  {
    id: "chump-block-to-avoid-lethal",
    category: "block-math",
    description:
      "You're at 5 life; an unblocked 6-power attacker is lethal. Your only blocker dies to it but prevents lethal damage — block even though it's a bad trade on stats alone.",
    agentName: "Sable",
    seatName: "Sable",
    context: {
      purpose: "declare_blockers",
      turn: 12,
      you: {
        life: 5,
        battlefield: [card({ id: "blk1", name: "Llanowar Elves", power: "1", toughness: "1" })]
      },
      opponents: [
        {
          id: "opp1",
          name: "Attacker",
          life: 25,
          battlefield: [card({ id: "atk1", name: "Colossal Brute", power: "6", toughness: "6" })]
        }
      ]
    },
    legalActions: [
      { id: "a1", actionType: "block", cardId: "blk1", targetIds: ["atk1"], label: "Block with Llanowar Elves" },
      { id: "a2", actionType: "pass_priority", targetIds: [], label: "Declare no blocks" }
    ],
    acceptableLegalActionIds: ["a1"]
  },
  {
    id: "prefer-the-cantrip-removal",
    category: "value",
    description:
      "Two removal spells in hand answer the exact same threat equally well; one also draws a card. Take the strict 2-for-1 upgrade.",
    agentName: "Malik",
    seatName: "Malik",
    context: {
      purpose: "main_phase",
      turn: 5,
      you: {
        life: 32,
        availableMana: { total: 3 },
        battlefield: [],
        hand: [
          card({
            id: "plain",
            name: "Doom Blade",
            manaValue: 2,
            typeLine: "Instant",
            oracleText: "Destroy target nonblack creature."
          }),
          card({
            id: "cantrip",
            name: "Eliminate and Reload",
            manaValue: 3,
            typeLine: "Instant",
            // Deliberately unambiguous "destroy, then draw" as a single mode of casting the spell —
            // a real card's Cycling (Eliminate's actual printed text) is an ALTERNATE way to use the
            // card instead of casting it as removal, not a bonus attached to casting it, so using
            // real Eliminate text here made the model's "cycling isn't relevant once you're casting
            // this as removal" reasoning correct, not a benchmark failure — this fixture needs a
            // card whose removal mode itself draws a card, with no second reading possible.
            oracleText: "Destroy target creature or planeswalker. Draw a card."
          })
        ]
      },
      opponents: [
        { id: "opp1", name: "Rival", life: 30, battlefield: [card({ id: "threat1", name: "Grave Titan", power: "6", toughness: "6" })] }
      ]
    },
    legalActions: [
      {
        id: "a1",
        actionType: "cast_spell",
        cardId: "plain",
        targetIds: ["threat1"],
        label: "Cast Doom Blade on Grave Titan",
        role: "removal"
      },
      {
        id: "a2",
        actionType: "cast_spell",
        cardId: "cantrip",
        targetIds: ["threat1"],
        label: "Cast Eliminate and Reload on Grave Titan",
        role: "removal"
      }
    ],
    acceptableLegalActionIds: ["a2"]
  },
  {
    id: "protect-the-commander",
    category: "commander-protection",
    description:
      "The only blocker (0/5) survives the hit, so the attack deals no face damage and kills nothing — it accomplishes literally nothing while needlessly exposing the tapped-out commander to whatever the opponent's 3 untapped mana could be holding up. Hold it back.",
    agentName: "Malik",
    seatName: "Malik",
    context: {
      purpose: "declare_attackers",
      turn: 7,
      you: {
        life: 34,
        commander: card({ id: "cmdr", name: "Malik, Grixis Commander", power: "4", toughness: "4", commander: true }),
        battlefield: [card({ id: "cmdr", name: "Malik, Grixis Commander", power: "4", toughness: "4", commander: true })]
      },
      opponents: [
        {
          id: "opp1",
          name: "Rival",
          life: 34,
          availableMana: { total: 3 },
          battlefield: [card({ id: "wall1", name: "Stalwart Bastion", power: "0", toughness: "5", typeLine: "Creature — Wall" })]
        }
      ]
    },
    legalActions: [
      { id: "a1", actionType: "attack", cardId: "cmdr", targetIds: ["opp1"], label: "Attack with Malik" },
      { id: "a2", actionType: "pass_priority", targetIds: [], label: "Declare no attackers" }
    ],
    acceptableLegalActionIds: ["a2"]
  }
];
