"use client";

import { useMemo, useState } from "react";
import type { CommanderDeck, GameEvent, GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import { createDeckFromList } from "@/lib/deckParser";
import { ThreeGameTable } from "./ThreeGameTable";

type FlowMode = "setup" | "game";
type DeckInputMode = "commander" | "decklist";
type DeckBuildStatus = "empty" | "building" | "ready" | "error";
type GameStage = "mulligan" | "playing";

interface OllamaStatus {
  ok: boolean;
  message: string;
  models?: string[];
}

interface SeatConfig {
  seatId: string;
  name: string;
  kind: PlayerSeat["kind"];
  mode: DeckInputMode;
  commander: string;
  deckList: string;
  deck?: CommanderDeck;
  status: DeckBuildStatus;
  message: string;
}

const COMMANDER_COLOR_HINTS: Record<string, string[]> = {
  shalai: ["G", "W"],
  kess: ["U", "B", "R"],
  meren: ["B", "G"],
  atraxa: ["W", "U", "B", "G"],
  prosper: ["B", "R"],
  yuriko: ["U", "B"],
  miirym: ["G", "U", "R"]
};

const DEFAULT_PLAYER_COMMANDER = "Atraxa, Praetors' Voice";
const DEFAULT_PLAYER_DECKLIST = "Commander: Atraxa, Praetors' Voice\n1 Sol Ring\n1 Arcane Signet\n1 Command Tower\n96 Forest";

export function AppFlow({ initialSession, ollama }: { initialSession: GameSession; ollama: OllamaStatus }) {
  const [mode, setMode] = useState<FlowMode>("setup");
  const [session, setSession] = useState(initialSession);
  const [activeSeatId, setActiveSeatId] = useState(initialSession.activePlayerId ?? initialSession.seats[1]?.id);
  const [prioritySeatId, setPrioritySeatId] = useState(initialSession.activePlayerId ?? initialSession.seats[1]?.id);
  const [selectedHandCardId, setSelectedHandCardId] = useState<string | undefined>();
  const [inspectedCard, setInspectedCard] = useState<VisibleCard | undefined>();
  const [gameStage, setGameStage] = useState<GameStage>("mulligan");
  const [mulligans, setMulligans] = useState<Record<string, number>>({});
  const [keptHands, setKeptHands] = useState<Record<string, boolean>>({});
  const [configs, setConfigs] = useState<SeatConfig[]>(() => createInitialConfigs(initialSession.seats));
  const humanSeat = session.seats.find((seat) => seat.kind === "human") ?? session.seats[0];
  const playReady = configs.every((config) => config.status !== "building" && config.deck?.validation.legal);

  const setupSummary = useMemo(() => {
    const ready = configs.filter((config) => config.deck?.validation.legal).length;
    return `${ready}/${configs.length} decks ready`;
  }, [configs]);

  function updateConfig(seatId: string, patch: Partial<SeatConfig>) {
    setConfigs((current) => current.map((config) => (config.seatId === seatId ? { ...config, ...patch } : config)));
  }

  async function buildDeck(config: SeatConfig) {
    const commander = config.commander.trim() || fallbackCommander(config.name);
    const colors = inferColors(commander);
    updateConfig(config.seatId, {
      commander,
      status: "building",
      message: config.mode === "decklist" ? "Validating deck list..." : "Asking Ollama to build this deck..."
    });

    if (config.mode === "decklist" && config.deckList.trim()) {
      const deck = createDeckFromList({ owner: config.name, commander, deckList: config.deckList, colors });
      updateConfig(config.seatId, {
        commander,
        deck,
        status: deck.validation.legal ? "ready" : "error",
        message: deck.validation.legal ? "Deck list is ready for play." : deck.validation.errors[0] ?? "Deck needs fixes."
      });
      return;
    }

    const response = await fetch("/api/decks/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentName: config.name, commander, colors })
    });
    const result = (await response.json()) as {
      source: "ollama" | "ollama-invalid" | "fallback";
      message: string;
      deck: CommanderDeck;
    };
    const deck = result.deck;

    updateConfig(config.seatId, {
      commander,
      deck,
      status: deck.validation.legal ? "ready" : "error",
      message:
        result.source === "ollama"
          ? "Ollama built and validated this deck."
          : result.source === "fallback"
            ? result.message
            : deck.validation.errors[0] ?? result.message
    });
  }

  function startGame() {
    const deckedSeats = session.seats.map((seat) => {
      const config = configs.find((item) => item.seatId === seat.id);
      if (!config?.deck) return seat;
      return applyDeckToSeat(seat, config.deck);
    });
    const openingSeats = deckedSeats.map((seat) => withOpeningHand(seat, 7, 0));
    const agentResolved = resolveAgentMulligans(openingSeats);
    const nextSession: GameSession = {
      ...session,
      status: "ready",
      activePlayerId: activeSeatId,
      phase: "opening hand",
      turn: 0,
      seats: agentResolved.seats,
      events: [
        ...agentResolved.events,
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          message: "Opening hands drawn. Agents resolved mulligans."
        },
        ...session.events
      ]
    };
    setSession(nextSession);
    setMulligans(agentResolved.mulligans);
    setKeptHands(agentResolved.keptHands);
    setGameStage("mulligan");
    setMode("game");
  }

  function keepOpeningHand() {
    const keepSize = openingHandKeepSize(mulligans[humanSeat.id] ?? 0);
    setKeptHands((current) => ({ ...current, [humanSeat.id]: true }));
    setGameStage("playing");
    setActiveSeatId(session.seats[1]?.id ?? humanSeat.id);
    setPrioritySeatId(session.seats[1]?.id ?? humanSeat.id);
    setSession((current) => ({
      ...current,
      status: "playing",
      activePlayerId: current.seats[1]?.id ?? humanSeat.id,
      phase: "main phase 1",
      turn: 1,
      seats: current.seats.map((seat) => (seat.id === humanSeat.id ? keepOpeningHandSize(seat, keepSize) : seat)),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: humanSeat.id,
          message: keepSize === 7 ? "You kept 7. The game begins." : `You kept ${keepSize} and bottomed ${7 - keepSize}. The game begins.`
        },
        ...current.events
      ]
    }));
  }

  function mulliganOpeningHand() {
    const currentCount = mulligans[humanSeat.id] ?? 0;
    const nextCount = currentCount + 1;
    const nextKeepSize = openingHandKeepSize(nextCount);
    setMulligans((current) => ({ ...current, [humanSeat.id]: nextCount }));
    setSelectedHandCardId(undefined);
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) => (seat.id === humanSeat.id ? withOpeningHand(seat, 7, nextCount) : seat)),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: humanSeat.id,
          message: nextCount === 1 ? "You took a free mulligan. You can still keep 7." : `You mulliganed. You draw 7 and will keep ${nextKeepSize}.`
        },
        ...current.events
      ]
    }));
  }

  function advanceTurn() {
    setSession((current) => {
      const index = current.seats.findIndex((seat) => seat.id === activeSeatId);
      const nextSeat = current.seats[(index + 1) % current.seats.length];
      setActiveSeatId(nextSeat.id);
      setPrioritySeatId(nextSeat.id);
      setSelectedHandCardId(undefined);

      let nextSession: GameSession = {
        ...current,
        activePlayerId: nextSeat.id,
        turn: current.turn + 1,
        phase: "beginning phase",
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: nextSeat.id,
            message: `${nextSeat.name} starts their turn.`
          },
          ...current.events
        ]
      };

      if (nextSeat.kind === "agent") {
        nextSession = drawForSeat(nextSession, nextSeat.id, `${nextSeat.name} draws for turn.`);
        nextSession = playFirstHandCard(nextSession, nextSeat.id);
      }

      return nextSession;
    });
  }

  function passPriority() {
    const index = session.seats.findIndex((seat) => seat.id === prioritySeatId);
    const nextSeat = session.seats[(index + 1) % session.seats.length];
    setPrioritySeatId(nextSeat.id);
    setSession((current) => ({
      ...current,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: prioritySeatId,
          message: `${current.seats.find((seat) => seat.id === prioritySeatId)?.name ?? "Player"} passed priority.`
        },
        ...current.events
      ]
    }));
  }

  function openResponseWindow() {
    setPrioritySeatId(humanSeat.id);
    setSession((current) => ({
      ...current,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: humanSeat.id,
          message: "Response window opened for the player.",
          detail: "Mock interaction mode: choose Pass Priority after reviewing the board."
        },
        ...current.events
      ]
    }));
  }

  function drawCard(seatId: string) {
    setSession((current) => drawForSeat(current, seatId, `${current.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} draws a card.`));
  }

  function playCard(seatId: string, cardId: string) {
    setSession((current) => playCardFromHand(current, seatId, cardId));
    setSelectedHandCardId(undefined);
  }

  if (mode === "setup") {
    return (
      <main className="app-shell">
        <Topbar setupSummary={setupSummary} />
        <section className="status-grid" aria-label="Runtime status">
          <Status label="Ollama" value={ollama.ok ? "Ready" : "Offline"} detail={ollama.message} />
          <Status label="XMage" value={session.xmage.status.replace("_", " ")} detail={session.xmage.message} />
          <Status label="Format" value="Commander" detail="One human plus three AI seats, 40 life, Bracket 3 target." />
          <Status label="Setup" value={setupSummary} detail="Build AI decks from commanders or validate pasted deck lists." />
        </section>
        <section className="setup-board">
          <div className="setup-heading">
            <div>
              <p className="eyebrow">Page 1</p>
              <h2>Deck Building</h2>
            </div>
            <button className="play-button" disabled={!playReady} type="button" onClick={startGame}>
              PLAY
            </button>
          </div>
          <div className="setup-grid">
            {configs.map((config) => (
              <DeckSetupPanel config={config} key={config.seatId} onBuild={buildDeck} onUpdate={updateConfig} />
            ))}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <Topbar setupSummary="Game board" onBack={() => setMode("setup")} />
      <section className="status-grid" aria-label="Runtime status">
        <Status label="Priority" value={session.seats.find((seat) => seat.id === prioritySeatId)?.name ?? "None"} detail="Priority moves clockwise when passed." />
        <Status label="Active" value={session.seats.find((seat) => seat.id === activeSeatId)?.name ?? "None"} detail={`${session.phase}, turn ${session.turn}`} />
        <Status label="Ollama" value={ollama.ok ? "Ready" : "Offline"} detail={ollama.message} />
        <Status label="XMage" value={session.xmage.status.replace("_", " ")} detail={session.xmage.message} />
      </section>
      <ThreeGameTable
        gameStage={gameStage}
        humanMulligans={mulligans[humanSeat.id] ?? 0}
        session={{ ...session, activePlayerId: activeSeatId }}
        prioritySeatId={prioritySeatId}
        onKeepHand={keepOpeningHand}
        onMulligan={mulliganOpeningHand}
        onAdvanceTurn={advanceTurn}
        onDrawCard={drawCard}
        onInspectCard={setInspectedCard}
        onPassPriority={passPriority}
        onPlayCard={playCard}
        onRespond={openResponseWindow}
        onSelectHandCard={(card) => setSelectedHandCardId((current) => (current === card.id ? undefined : card.id))}
        inspectedCard={inspectedCard}
        selectedCardId={selectedHandCardId}
      />
    </main>
  );
}

function DeckSetupPanel({
  config,
  onBuild,
  onUpdate
}: {
  config: SeatConfig;
  onBuild: (config: SeatConfig) => void | Promise<void>;
  onUpdate: (seatId: string, patch: Partial<SeatConfig>) => void;
}) {
  return (
    <article className={`setup-card ${config.status}`}>
      <header>
        <div>
          <p className="eyebrow">{config.kind === "human" ? "Player" : "Agent seat"}</p>
          <h3>{config.name}</h3>
        </div>
        <strong>{config.status === "building" ? "Building" : config.deck?.validation.legal ? "Ready" : "Draft"}</strong>
      </header>
      <div className="mode-switch" role="group" aria-label={`${config.name} deck input mode`}>
        <button className={config.mode === "commander" ? "selected" : ""} type="button" onClick={() => onUpdate(config.seatId, { mode: "commander" })}>
          Commander
        </button>
        <button className={config.mode === "decklist" ? "selected" : ""} type="button" onClick={() => onUpdate(config.seatId, { mode: "decklist" })}>
          Deck list
        </button>
      </div>
      <label>
        Commander
        <input
          value={config.commander}
          onChange={(event) => onUpdate(config.seatId, { commander: event.target.value, deck: undefined, status: "empty" })}
          placeholder="Meren of Clan Nel Toth"
        />
      </label>
      {config.mode === "decklist" ? (
        <label>
          Deck list
          <textarea
            value={config.deckList}
            onChange={(event) => onUpdate(config.seatId, { deck: undefined, deckList: event.target.value, status: "empty" })}
            placeholder={"Commander: Atraxa, Praetors' Voice\n1 Sol Ring\n1 Arcane Signet\n1 Command Tower\n1 Swords to Plowshares\n1 Beast Within\n...continue to 100 cards"}
          />
        </label>
      ) : null}
      <button type="button" disabled={config.status === "building"} onClick={() => onBuild(config)}>
        {config.status === "building" ? "Building..." : config.kind === "agent" ? "Build AI Deck" : "Validate Deck"}
      </button>
      <div className="setup-result">
        <span>{config.message}</span>
        {config.deck ? (
          <dl>
            <div>
              <dt>Cards</dt>
              <dd>{config.deck.validation.cardCount}</dd>
            </div>
            <div>
              <dt>Score</dt>
              <dd>{config.deck.score.total}</dd>
            </div>
            <div>
              <dt>Game Changers</dt>
              <dd>{config.deck.validation.gameChangerCount}</dd>
            </div>
          </dl>
        ) : null}
      </div>
    </article>
  );
}

function Topbar({ setupSummary, onBack }: { setupSummary: string; onBack?: () => void }) {
  return (
    <section className="topbar">
      <div>
        <p className="eyebrow">Commander session</p>
        <h1>MTG-AI Commander Lab</h1>
        <p className="topbar-subtitle">{setupSummary}</p>
      </div>
      {onBack ? (
        <button type="button" onClick={onBack}>
          Back To Setup
        </button>
      ) : null}
    </section>
  );
}

function Status(props: { label: string; value: string; detail: string }) {
  return (
    <article className="status">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <p>{props.detail}</p>
    </article>
  );
}

function createInitialConfigs(seats: PlayerSeat[]): SeatConfig[] {
  return seats.map((seat) => ({
    seatId: seat.id,
    name: seat.name,
    kind: seat.kind,
    mode: seat.kind === "human" ? "decklist" : "commander",
    commander: seat.deck?.commander ?? (seat.kind === "human" ? DEFAULT_PLAYER_COMMANDER : ""),
    deckList: seat.kind === "human" ? DEFAULT_PLAYER_DECKLIST : "",
    deck: seat.deck ?? (seat.kind === "human" ? createDeckFromList({ owner: seat.name, commander: DEFAULT_PLAYER_COMMANDER, deckList: DEFAULT_PLAYER_DECKLIST, colors: ["W", "U", "B", "G"] }) : undefined),
    status: seat.deck?.validation.legal || seat.kind === "human" ? "ready" : "empty",
    message: seat.deck?.validation.legal || seat.kind === "human" ? "Deck is ready for play." : "Choose a commander or paste a deck list."
  }));
}

function applyDeckToSeat(seat: PlayerSeat, deck: CommanderDeck): PlayerSeat {
  const commander = createCommanderCard(deck.commander, deck.colors, seat.board.commander);
  const battlefield = seat.board.battlefield.map((card) => (card.commander ? commander : card));
  return {
    ...seat,
    deck,
    board: {
      ...seat.board,
      commander,
      hand: [],
      battlefield: battlefield.some((card) => card.commander) ? battlefield : [commander, ...battlefield]
    },
    zones: {
      ...seat.zones,
      battlefield: battlefield.some((card) => card.commander) ? battlefield.length : battlefield.length + 1,
      hand: 0,
      command: commander.zone === "command" ? 1 : 0
    }
  };
}

function createCommanderCard(commander: string, colors: string[], existing?: VisibleCard): VisibleCard {
  return {
    id: existing?.id ?? crypto.randomUUID(),
    name: commander,
    typeLine: existing?.typeLine ?? "Legendary Creature - Commander",
    oracleText: existing?.oracleText ?? "AI-selected commander. Full card text will come from card data lookup in the next integration pass.",
    manaValue: existing?.manaValue ?? 4,
    colors,
    role: "commander",
    zone: existing?.zone ?? "battlefield",
    commander: true,
    power: existing?.power ?? "3",
    toughness: existing?.toughness ?? "4",
    tapped: existing?.tapped,
    summoningSick: existing?.summoningSick,
    counters: existing?.counters
  };
}

function inferColors(commander: string) {
  const lower = commander.toLowerCase();
  const matched = Object.entries(COMMANDER_COLOR_HINTS).find(([hint]) => lower.includes(hint));
  return matched?.[1] ?? ["G", "W"];
}

function fallbackCommander(name: string) {
  if (name.includes("Malik")) return "Kess, Dissident Mage";
  if (name.includes("Sable")) return "Meren of Clan Nel Toth";
  if (name.includes("Veyra")) return "Shalai, Voice of Plenty";
  return "Atraxa, Praetors' Voice";
}

function resolveAgentMulligans(seats: PlayerSeat[]) {
  const mulligans: Record<string, number> = {};
  const keptHands: Record<string, boolean> = {};
  const events: GameEvent[] = [];

  const resolvedSeats = seats.map((seat) => {
    if (seat.kind !== "agent") return seat;
    let nextSeat = seat;
    let count = 0;
    while (!agentKeepsHand(nextSeat) && count < 3) {
      count += 1;
      nextSeat = withOpeningHand(nextSeat, 7, count);
    }
    mulligans[seat.id] = count;
    keptHands[seat.id] = true;
    nextSeat = keepOpeningHandSize(nextSeat, openingHandKeepSize(count));
    events.push({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      seatId: seat.id,
      message: count === 0 ? `${seat.name} kept 7.` : `${seat.name} mulliganed and kept ${openingHandKeepSize(count)}.`
    });
    return nextSeat;
  });

  return { seats: resolvedSeats, mulligans, keptHands, events };
}

function agentKeepsHand(seat: PlayerSeat) {
  const lands = seat.board.hand.filter((card) => card.role === "land" || card.typeLine === "Land").length;
  const ramp = seat.board.hand.filter((card) => card.role === "ramp").length;
  return lands >= 2 && lands <= 5 && lands + ramp >= 3;
}

function openingHandKeepSize(mulliganCount: number) {
  if (mulliganCount <= 1) return 7;
  return Math.max(1, 8 - mulliganCount);
}

function keepOpeningHandSize(seat: PlayerSeat, keepSize: number): PlayerSeat {
  const hand = seat.board.hand.slice(0, keepSize);
  const bottomed = Math.max(0, seat.board.hand.length - hand.length);
  return {
    ...seat,
    board: {
      ...seat.board,
      hand
    },
    zones: {
      ...seat.zones,
      hand: hand.length,
      library: seat.zones.library + bottomed
    }
  };
}

function withOpeningHand(seat: PlayerSeat, size: number, mulliganCount: number): PlayerSeat {
  const hand = makeOpeningHand(seat, size, mulliganCount);
  return {
    ...seat,
    board: {
      ...seat.board,
      hand
    },
    zones: {
      ...seat.zones,
      hand: hand.length,
      library: Math.max(0, 99 - hand.length - seat.board.battlefield.filter((card) => !card.commander).length)
    }
  };
}

function makeOpeningHand(seat: PlayerSeat, size: number, mulliganCount: number) {
  const deckCards = expandDeckCards(seat);
  if (deckCards.length === 0) {
    return Array.from({ length: size }, (_, index) =>
      createVisibleFromDeckCard("Wastes", "land", [], `${seat.id}-fallback-opening-${mulliganCount}-${index}`, "hand")
    );
  }
  const offset = (mulliganCount * 11 + seat.id.length) % Math.max(1, deckCards.length);
  return Array.from({ length: size }, (_, index) => {
    const card = deckCards[(offset + index) % deckCards.length];
    return createVisibleFromDeckCard(card.name, card.role ?? "spell", seat.deck?.colors ?? [], `${seat.id}-opening-${mulliganCount}-${index}`, "hand");
  });
}

function expandDeckCards(seat: PlayerSeat) {
  const cards = seat.deck?.cards.filter((card) => card.role !== "commander") ?? [];
  return cards.flatMap((card) => Array.from({ length: card.count }, () => card));
}

function drawForSeat(session: GameSession, seatId: string, message: string): GameSession {
  const seats = session.seats.map((seat) => {
    if (seat.id !== seatId || seat.zones.library <= 0) return seat;
    const drawn = nextLibraryCard(seat);
    return {
      ...seat,
      board: {
        ...seat.board,
        hand: [...seat.board.hand, drawn]
      },
      zones: {
        ...seat.zones,
        hand: seat.zones.hand + 1,
        library: Math.max(0, seat.zones.library - 1)
      }
    };
  });

  return {
    ...session,
    seats,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message
      },
      ...session.events
    ]
  };
}

function playFirstHandCard(session: GameSession, seatId: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const card = seat?.board.hand[0];
  return card ? playCardFromHand(session, seatId, card.id, `${seat?.name ?? "Agent"} plays ${card.name}.`) : session;
}

function playCardFromHand(session: GameSession, seatId: string, cardId: string, message?: string): GameSession {
  let playedName = "";
  const seats = session.seats.map((seat) => {
    if (seat.id !== seatId) return seat;
    const card = seat.board.hand.find((item) => item.id === cardId);
    if (!card) return seat;
    playedName = card.name;
    const played: VisibleCard = {
      ...card,
      zone: "battlefield",
      summoningSick: card.typeLine.includes("Creature") ? true : card.summoningSick
    };
    return {
      ...seat,
      board: {
        ...seat.board,
        hand: seat.board.hand.filter((item) => item.id !== cardId),
        battlefield: [...seat.board.battlefield, played]
      },
      zones: {
        ...seat.zones,
        battlefield: seat.zones.battlefield + 1,
        hand: Math.max(0, seat.zones.hand - 1)
      }
    };
  });

  if (!playedName) return session;

  return {
    ...session,
    seats,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: message ?? `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} plays ${playedName}.`
      },
      ...session.events
    ]
  };
}

function nextLibraryCard(seat: PlayerSeat): VisibleCard {
  const cards = seat.deck?.cards.filter((card) => card.role !== "commander") ?? [];
  const card = cards[(seat.board.hand.length + seat.board.battlefield.length) % Math.max(1, cards.length)];
  return createVisibleFromDeckCard(card?.name ?? "Mystery Card", card?.role ?? "spell", seat.deck?.colors ?? [], `${seat.id}-draw-${crypto.randomUUID()}`, "hand");
}

function createVisibleFromDeckCard(name: string, role: string, colors: string[], id: string, zone: VisibleCard["zone"]): VisibleCard {
  const isLand = role === "land" || ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"].includes(name);
  const isCreature = ["creature", "synergy", "wincon", "ramp", "draw"].includes(role) && !isLand;
  return {
    id,
    name,
    typeLine: isLand ? "Land" : isCreature ? "Creature - Spell" : role === "removal" ? "Instant" : "Spell",
    oracleText: isLand ? "Tap: Add mana." : `Mock ${role} card. Full rules text will come from card data lookup.`,
    manaValue: isLand ? 0 : role === "ramp" ? 2 : role === "removal" ? 2 : 4,
    colors: isLand ? [] : colors.slice(0, 1),
    role,
    zone,
    power: isCreature ? "2" : undefined,
    toughness: isCreature ? "2" : undefined
  };
}
