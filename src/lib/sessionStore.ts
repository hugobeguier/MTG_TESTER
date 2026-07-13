import type { GameEvent, GameSession, PlayerSeat } from "./types";
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

  currentSession = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "lobby",
    phase: "setup",
    turn: 0,
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
    landsPlayed: 0,
    commanderCasts: 0,
    zones: {
      library: 99,
      hand: 0,
      battlefield: 0,
      graveyard: 0,
      exile: 0,
      command: 1
    },
    board: {
      hand: [],
      battlefield: [],
      library: [],
      graveyard: []
    }
  };
}

function event(message: string, detail?: string, seatId?: string): GameEvent {
  return { id: crypto.randomUUID(), at: new Date().toISOString(), message, detail, seatId };
}
