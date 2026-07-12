import type { GameEvent, GameSession, PlayerSeat, VisibleCard } from "./types";
import { createSampleDeck } from "./sampleDecks";
import { getXMageStatus } from "./xmageBridge";

let currentSession: GameSession | undefined;

export async function getOrCreateSession() {
  if (!currentSession) {
    currentSession = await createSession();
  }
  return currentSession;
}

export async function createSession(): Promise<GameSession> {
  const xmage = await getXMageStatus();
  const seats: PlayerSeat[] = [
    emptySeat("seat-human", "You", "human"),
    emptySeat("seat-veyra", "Veyra", "agent", "Veyra"),
    emptySeat("seat-malik", "Malik", "agent", "Malik"),
    emptySeat("seat-sable", "Sable", "agent", "Sable")
  ];

  seats[1].deck = createSampleDeck("Veyra", "Shalai, Voice of Plenty", ["G", "W"]);
  seats[2].deck = createSampleDeck("Malik", "Kess, Dissident Mage", ["U", "B", "R"]);
  seats[3].deck = createSampleDeck("Sable", "Meren of Clan Nel Toth", ["B", "G"]);
  seedVisibleBoard(seats);

  currentSession = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "playing",
    activePlayerId: "seat-veyra",
    phase: "main phase 1",
    turn: 4,
    xmage,
    seats,
    events: [
      event("Created a 4-player Commander session for one human and three Ollama agents."),
      event("Generated starter Bracket 3 deck drafts for all three agents."),
      event(xmage.message)
    ]
  };
  return currentSession;
}

export function addEvent(message: string, detail?: string, seatId?: string): GameEvent {
  const next = event(message, detail, seatId);
  currentSession?.events.unshift(next);
  return next;
}

function emptySeat(id: string, name: string, kind: "human" | "agent", agentName?: PlayerSeat["agentName"]): PlayerSeat {
  return {
    id,
    name,
    kind,
    agentName,
    life: 40,
    commanderDamage: {},
    zones: {
      library: 91,
      hand: 7,
      battlefield: 0,
      graveyard: 1,
      exile: 0,
      command: 1
    },
    board: {
      hand: [],
      battlefield: []
    }
  };
}

function event(message: string, detail?: string, seatId?: string): GameEvent {
  return { id: crypto.randomUUID(), at: new Date().toISOString(), message, detail, seatId };
}

function seedVisibleBoard(seats: PlayerSeat[]) {
  const [human, veyra, malik, sable] = seats;

  human.life = 37;
  human.commanderDamage = { "seat-veyra": 2 };
  human.board.commander = card({
    id: "human-commander",
    name: "Atraxa, Praetors' Voice",
    typeLine: "Legendary Creature - Phyrexian Angel Horror",
    oracleText: "Flying, vigilance, deathtouch, lifelink. At the beginning of your end step, proliferate.",
    manaValue: 4,
    colors: ["W", "U", "B", "G"],
    role: "commander",
    zone: "command",
    commander: true,
    power: "4",
    toughness: "4"
  });
  human.board.hand = [
    card({
      id: "human-hand-1",
      name: "Swords to Plowshares",
      typeLine: "Instant",
      oracleText: "Exile target creature. Its controller gains life equal to its power.",
      manaValue: 1,
      colors: ["W"],
      role: "removal",
      zone: "hand"
    }),
    card({
      id: "human-hand-2",
      name: "Cultivate",
      typeLine: "Sorcery",
      oracleText: "Search your library for up to two basic land cards, put one onto the battlefield tapped and the other into your hand.",
      manaValue: 3,
      colors: ["G"],
      role: "ramp",
      zone: "hand"
    }),
    card({
      id: "human-hand-3",
      name: "Command Tower",
      typeLine: "Land",
      oracleText: "Tap: Add one mana of any color in your commander's color identity.",
      manaValue: 0,
      colors: [],
      role: "land",
      zone: "hand"
    })
  ];
  human.board.battlefield = [
    card({
      id: "human-land-1",
      name: "Command Tower",
      typeLine: "Land",
      oracleText: "Tap: Add one mana of any color in your commander's color identity.",
      manaValue: 0,
      colors: [],
      role: "land",
      zone: "battlefield",
      tapped: true
    }),
    card({
      id: "human-rock-1",
      name: "Arcane Signet",
      typeLine: "Artifact",
      oracleText: "Tap: Add one mana of any color in your commander's color identity.",
      manaValue: 2,
      colors: [],
      role: "ramp",
      zone: "battlefield",
      tapped: true
    }),
    card({
      id: "human-creature-1",
      name: "Evolution Sage",
      typeLine: "Creature - Elf Druid",
      oracleText: "Whenever a land enters the battlefield under your control, proliferate.",
      manaValue: 3,
      colors: ["G"],
      role: "engine",
      zone: "battlefield",
      power: "3",
      toughness: "2"
    })
  ];

  veyra.life = 40;
  veyra.commanderDamage = {};
  veyra.board.hand = [
    card({
      id: "veyra-hand-1",
      name: "Beast Whisperer",
      typeLine: "Creature - Elf Druid",
      oracleText: "Whenever you cast a creature spell, draw a card.",
      manaValue: 4,
      colors: ["G"],
      role: "draw",
      zone: "hand",
      power: "2",
      toughness: "3"
    }),
    card({
      id: "veyra-hand-2",
      name: "Swords to Plowshares",
      typeLine: "Instant",
      oracleText: "Exile target creature. Its controller gains life equal to its power.",
      manaValue: 1,
      colors: ["W"],
      role: "removal",
      zone: "hand"
    })
  ];
  veyra.board.commander = card({
    id: "veyra-commander",
    name: "Shalai, Voice of Plenty",
    typeLine: "Legendary Creature - Angel",
    oracleText: "Flying. You, planeswalkers you control, and other creatures you control have hexproof.",
    manaValue: 4,
    colors: ["G", "W"],
    role: "commander",
    zone: "battlefield",
    commander: true,
    summoningSick: true,
    power: "3",
    toughness: "4"
  });
  veyra.board.battlefield = [
    veyra.board.commander,
    card({
      id: "veyra-token-1",
      name: "Adeline Token",
      typeLine: "Creature Token - Human",
      oracleText: "A vigilant body pressuring the table while Shalai protects the board.",
      manaValue: 0,
      colors: ["W"],
      role: "attacker",
      zone: "battlefield",
      attacking: true,
      power: "1",
      toughness: "1",
      counters: [{ kind: "+1/+1", count: 1 }]
    }),
    card({
      id: "veyra-enchant-1",
      name: "Guardian Project",
      typeLine: "Enchantment",
      oracleText: "Whenever a nontoken creature enters under your control, draw a card if it has a unique name among your creatures and graveyard.",
      manaValue: 4,
      colors: ["G"],
      role: "draw",
      zone: "battlefield"
    }),
    card({
      id: "veyra-land-1",
      name: "Temple Garden",
      typeLine: "Land - Forest Plains",
      oracleText: "Tap: Add green or white mana.",
      manaValue: 0,
      colors: [],
      role: "land",
      zone: "battlefield",
      tapped: true
    })
  ];

  malik.life = 32;
  malik.commanderDamage = { "seat-sable": 5 };
  malik.board.hand = [
    card({
      id: "malik-hand-1",
      name: "Fact or Fiction",
      typeLine: "Instant",
      oracleText: "Reveal the top five cards of your library. An opponent separates them into two piles. Put one pile into your hand.",
      manaValue: 4,
      colors: ["U"],
      role: "draw",
      zone: "hand"
    }),
    card({
      id: "malik-hand-2",
      name: "Terminate",
      typeLine: "Instant",
      oracleText: "Destroy target creature. It can't be regenerated.",
      manaValue: 2,
      colors: ["B", "R"],
      role: "removal",
      zone: "hand"
    })
  ];
  malik.board.commander = card({
    id: "malik-commander",
    name: "Kess, Dissident Mage",
    typeLine: "Legendary Creature - Human Wizard",
    oracleText: "During each of your turns, you may cast an instant or sorcery from your graveyard.",
    manaValue: 4,
    colors: ["U", "B", "R"],
    role: "commander",
    zone: "command",
    commander: true,
    power: "3",
    toughness: "4"
  });
  malik.board.battlefield = [
    card({
      id: "malik-creature-1",
      name: "Ledger Shredder",
      typeLine: "Creature - Bird Advisor",
      oracleText: "Flying. Whenever a player casts their second spell each turn, Ledger Shredder connives.",
      manaValue: 2,
      colors: ["U"],
      role: "filter",
      zone: "battlefield",
      power: "1",
      toughness: "3",
      counters: [{ kind: "+1/+1", count: 2 }]
    }),
    card({
      id: "malik-rock-1",
      name: "Talisman of Dominance",
      typeLine: "Artifact",
      oracleText: "Tap: Add colorless. Tap: Add blue or black and deal 1 damage to you.",
      manaValue: 2,
      colors: [],
      role: "ramp",
      zone: "battlefield"
    }),
    card({
      id: "malik-land-1",
      name: "Watery Grave",
      typeLine: "Land - Island Swamp",
      oracleText: "Tap: Add blue or black mana.",
      manaValue: 0,
      colors: [],
      role: "land",
      zone: "battlefield",
      tapped: true
    })
  ];

  sable.life = 35;
  sable.commanderDamage = { "seat-human": 4 };
  sable.board.hand = [
    card({
      id: "sable-hand-1",
      name: "Victimize",
      typeLine: "Sorcery",
      oracleText: "Choose two target creature cards in your graveyard. Sacrifice a creature, then return the chosen cards tapped.",
      manaValue: 3,
      colors: ["B"],
      role: "recursion",
      zone: "hand"
    }),
    card({
      id: "sable-hand-2",
      name: "Reclamation Sage",
      typeLine: "Creature - Elf Shaman",
      oracleText: "When this creature enters, you may destroy target artifact or enchantment.",
      manaValue: 3,
      colors: ["G"],
      role: "removal",
      zone: "hand",
      power: "2",
      toughness: "1"
    })
  ];
  sable.board.commander = card({
    id: "sable-commander",
    name: "Meren of Clan Nel Toth",
    typeLine: "Legendary Creature - Human Shaman",
    oracleText: "Whenever another creature you control dies, you get an experience counter. At your end step, return a creature from graveyard to hand or battlefield.",
    manaValue: 4,
    colors: ["B", "G"],
    role: "commander",
    zone: "battlefield",
    commander: true,
    power: "3",
    toughness: "4",
    counters: [{ kind: "experience", count: 2 }]
  });
  sable.board.battlefield = [
    sable.board.commander,
    card({
      id: "sable-creature-1",
      name: "Sakura-Tribe Elder",
      typeLine: "Creature - Snake Shaman",
      oracleText: "Sacrifice Sakura-Tribe Elder: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.",
      manaValue: 2,
      colors: ["G"],
      role: "ramp",
      zone: "battlefield",
      power: "1",
      toughness: "1"
    }),
    card({
      id: "sable-artifact-1",
      name: "Skullclamp",
      typeLine: "Artifact - Equipment",
      oracleText: "Equipped creature gets +1/-1. Whenever equipped creature dies, draw two cards. Equip 1.",
      manaValue: 1,
      colors: [],
      role: "draw",
      zone: "battlefield"
    }),
    card({
      id: "sable-land-1",
      name: "Overgrown Tomb",
      typeLine: "Land - Swamp Forest",
      oracleText: "Tap: Add black or green mana.",
      manaValue: 0,
      colors: [],
      role: "land",
      zone: "battlefield"
    })
  ];

  for (const seat of seats) {
    seat.zones.battlefield = seat.board.battlefield.length;
    seat.zones.hand = seat.board.hand.length;
    seat.zones.command = seat.board.commander?.zone === "command" ? 1 : 0;
  }
}

function card(input: VisibleCard): VisibleCard {
  return input;
}
