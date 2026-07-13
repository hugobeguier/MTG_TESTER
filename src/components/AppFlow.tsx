"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentAction, CommanderDeck, GameEvent, GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import { createDeckFromList } from "@/lib/deckParser";
import {
  agentKeepsHand,
  availableMana,
  bottomExcess,
  castCommander,
  chooseAgentPlays,
  commanderCost,
  drawCards,
  freshSeatForGame,
  isLand,
  libraryTopToBottom,
  millTop,
  mulliganHand,
  openingHandKeepSize,
  playFromHand,
  removeFromBattlefield,
  startOfTurn,
  takeFromLibrary,
  toggleTap,
  transformCard,
  type AgentPlays
} from "@/lib/gameEngine";
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
const AGENT_ACTION_TIMEOUT_MS = 30000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeEvent(message: string, seatId?: string, detail?: string): GameEvent {
  return { id: crypto.randomUUID(), at: new Date().toISOString(), message, detail, seatId };
}

export function AppFlow({ initialSession, ollama }: { initialSession: GameSession; ollama: OllamaStatus }) {
  const [mode, setMode] = useState<FlowMode>("setup");
  const [session, setSession] = useState(initialSession);
  const [activeSeatId, setActiveSeatId] = useState(initialSession.activePlayerId ?? initialSession.seats[0]?.id);
  const [prioritySeatId, setPrioritySeatId] = useState(initialSession.activePlayerId ?? initialSession.seats[0]?.id);
  const [selectedHandCardId, setSelectedHandCardId] = useState<string | undefined>();
  const [inspectedCard, setInspectedCard] = useState<VisibleCard | undefined>();
  const [gameStage, setGameStage] = useState<GameStage>("mulligan");
  const [firstSeatId, setFirstSeatId] = useState<string | undefined>();
  const [thinkingSeatId, setThinkingSeatId] = useState<string | undefined>();
  const [mulligans, setMulligans] = useState<Record<string, number>>({});
  const [configs, setConfigs] = useState<SeatConfig[]>(() => createInitialConfigs(initialSession.seats));
  const processedAgentTurns = useRef(new Set<string>());
  const sessionRef = useRef(session);
  const enrichedRef = useRef(false);
  const humanSeat = session.seats.find((seat) => seat.kind === "human") ?? session.seats[0];
  const playReady = configs.every((config) => config.status !== "building" && config.deck?.validation.legal);

  sessionRef.current = session;

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
      message: config.mode === "decklist" ? "Validating deck list..." : "Fetching the EDHREC average deck..."
    });

    const response = await fetch("/api/decks/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentName: config.name,
        commander,
        colors,
        deckList: config.mode === "decklist" ? config.deckList : undefined
      })
    });
    const result = (await response.json()) as {
      source: "decklist" | "edhrec" | "fallback";
      message: string;
      deck: CommanderDeck;
    };
    const deck = result.deck;

    updateConfig(config.seatId, {
      commander,
      deck,
      status: deck.validation.legal ? "ready" : "error",
      message: deck.validation.legal ? result.message : deck.validation.errors[0] ?? result.message
    });
  }

  // Enrich the default human deck with real card data once, so the table shows real cards/images.
  useEffect(() => {
    if (enrichedRef.current) return;
    enrichedRef.current = true;
    const human = configs.find((config) => config.kind === "human");
    if (human?.deck && !human.deck.commanderCard) {
      void buildDeck(human);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startGame() {
    const events: GameEvent[] = [];
    const nextMulligans: Record<string, number> = {};

    const seats = session.seats.map((seat) => {
      const config = configs.find((item) => item.seatId === seat.id);
      let next = freshSeatForGame(seat, config?.deck ?? seat.deck);
      next = drawCards(next, 7).seat;
      if (seat.kind === "agent") {
        let count = 0;
        while (!agentKeepsHand(next) && count < 3) {
          count += 1;
          next = mulliganHand(next);
        }
        next = bottomExcess(next, openingHandKeepSize(count));
        nextMulligans[seat.id] = count;
        events.unshift(
          makeEvent(count === 0 ? `${seat.name} kept 7.` : `${seat.name} mulliganed ${count === 1 ? "once" : `${count} times`} and kept ${openingHandKeepSize(count)}.`, seat.id)
        );
      } else {
        nextMulligans[seat.id] = 0;
      }
      return next;
    });

    const first = seats[Math.floor(Math.random() * seats.length)];
    events.unshift(makeEvent(`${first.name} won the roll and will go first.`));

    processedAgentTurns.current.clear();
    setFirstSeatId(first.id);
    setMulligans(nextMulligans);
    setSelectedHandCardId(undefined);
    setInspectedCard(undefined);
    setActiveSeatId(first.id);
    setPrioritySeatId(first.id);
    setGameStage("mulligan");
    setMode("game");
    setSession({
      ...session,
      status: "ready",
      activePlayerId: first.id,
      phase: "opening hand",
      turn: 0,
      seats,
      events: [...events, makeEvent("Fresh Commander game: 40 life, commanders in the command zone."), ...session.events]
    });
  }

  function beginTurnForSeats(seats: PlayerSeat[], seatId: string): { seats: PlayerSeat[]; events: GameEvent[] } {
    const events: GameEvent[] = [];
    const nextSeats = seats.map((seat) => {
      if (seat.id !== seatId) return seat;
      const untapped = startOfTurn(seat);
      const { seat: drawnSeat, drawn, failed } = drawCards(untapped, 1);
      events.push(makeEvent(seat.kind === "human" ? "You start your turn." : `${seat.name} starts their turn.`, seat.id));
      if (failed > 0) {
        events.unshift(makeEvent(`${seat.name} cannot draw from an empty library. In a real game they would lose.`, seat.id));
      } else if (seat.kind === "human" && drawn[0]) {
        events.unshift(makeEvent(`You draw ${drawn[0].name}.`, seat.id));
      } else {
        events.unshift(makeEvent(`${seat.name} draws for turn.`, seat.id));
      }
      return drawnSeat;
    });
    return { seats: nextSeats, events };
  }

  function keepOpeningHand() {
    if (!firstSeatId) return;
    const keepSize = openingHandKeepSize(mulligans[humanSeat.id] ?? 0);
    setGameStage("playing");
    setActiveSeatId(firstSeatId);
    setPrioritySeatId(firstSeatId);
    setSession((current) => {
      const kept = current.seats.map((seat) => (seat.id === humanSeat.id ? bottomExcess(seat, keepSize) : seat));
      const { seats, events } = beginTurnForSeats(kept, firstSeatId);
      return {
        ...current,
        status: "playing",
        activePlayerId: firstSeatId,
        phase: "main phase",
        turn: 1,
        seats,
        events: [
          ...events,
          makeEvent(keepSize === 7 ? "You kept 7. The game begins." : `You kept ${keepSize} and bottomed ${7 - keepSize}. The game begins.`, humanSeat.id),
          ...current.events
        ]
      };
    });
  }

  function mulliganOpeningHand() {
    const nextCount = (mulligans[humanSeat.id] ?? 0) + 1;
    setMulligans((current) => ({ ...current, [humanSeat.id]: nextCount }));
    setSelectedHandCardId(undefined);
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) => (seat.id === humanSeat.id ? mulliganHand(seat) : seat)),
      events: [
        makeEvent(
          nextCount === 1 ? "You took a free mulligan. You can still keep 7." : `You mulliganed. You draw 7 and will keep ${openingHandKeepSize(nextCount)}.`,
          humanSeat.id
        ),
        ...current.events
      ]
    }));
  }

  function advanceToNextSeat() {
    const current = sessionRef.current;
    const index = current.seats.findIndex((seat) => seat.id === current.activePlayerId);
    const next = current.seats[(index + 1) % current.seats.length];
    setActiveSeatId(next.id);
    setPrioritySeatId(next.id);
    setSelectedHandCardId(undefined);
    setSession((latest) => {
      const { seats, events } = beginTurnForSeats(latest.seats, next.id);
      return {
        ...latest,
        activePlayerId: next.id,
        phase: "main phase",
        turn: latest.turn + 1,
        seats,
        events: [...events, ...latest.events]
      };
    });
  }

  // Agent turns run automatically: pause, decide (Ollama with heuristic fallback), play, pass.
  useEffect(() => {
    if (mode !== "game" || gameStage !== "playing") return;
    const seat = session.seats.find((item) => item.id === activeSeatId);
    if (!seat || seat.kind !== "agent") return;
    const key = `${session.turn}:${seat.id}`;
    if (processedAgentTurns.current.has(key)) return;
    processedAgentTurns.current.add(key);

    let cancelled = false;
    let acted = false;
    (async () => {
      await delay(900);
      if (cancelled) return;
      acted = true;
      await runAgentTurn(seat.id);
      if (cancelled) return;
      await delay(900);
      if (!cancelled) advanceToNextSeat();
    })();
    return () => {
      cancelled = true;
      if (!acted) processedAgentTurns.current.delete(key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, gameStage, activeSeatId, session.turn]);

  async function runAgentTurn(seatId: string) {
    const seat = sessionRef.current.seats.find((item) => item.id === seatId);
    if (!seat) return;
    const plays = chooseAgentPlays(seat);
    setThinkingSeatId(seat.id);
    updateThought(seat.id, "");
    const decision = await requestOllamaDecision(seat, sessionRef.current, plays);
    setThinkingSeatId(undefined);
    applyAgentPlays(seatId, plays, decision);
  }

  function updateThought(seatId: string, thought: string) {
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) => (seat.id === seatId ? { ...seat, lastThought: thought || undefined } : seat))
    }));
  }

  async function requestOllamaDecision(seat: PlayerSeat, current: GameSession, plays: AgentPlays) {
    if (!seat.agentName) return undefined;
    try {
      const response = await fetch("/api/agent/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentName: seat.agentName, prompt: buildAgentPrompt(seat, current, plays) }),
        signal: AbortSignal.timeout(AGENT_ACTION_TIMEOUT_MS)
      });
      if (!response.ok || !response.body) return undefined;

      // NDJSON stream: live "content" partials (reasoning streams first), then the final action.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      let action: AgentAction | undefined;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line) as { type: string; content?: string; action?: AgentAction };
          if (message.type === "content" && message.content) {
            const partial = extractPartialReason(message.content);
            if (partial) updateThought(seat.id, partial.slice(0, 300));
          } else if (message.type === "action") {
            action = message.action;
          }
        }
      }
      return action;
    } catch {
      return undefined;
    }
  }

  function applyAgentPlays(seatId: string, plays: AgentPlays, decision?: AgentAction) {
    setSession((current) => {
      const events: GameEvent[] = [];
      const seats = current.seats.map((seat) => {
        if (seat.id !== seatId) return seat;
        let next = decision?.reason ? { ...seat, lastThought: decision.reason.slice(0, 300) } : seat;

        if (plays.landId) {
          const result = playFromHand(next, plays.landId);
          if (result.played) {
            next = result.seat;
            events.unshift(makeEvent(`${seat.name} plays ${result.played.name}.`, seat.id));
          }
        }

        const mana = availableMana(next);
        if (plays.castCommander && next.board.commander?.zone === "command" && commanderCost(next) <= mana) {
          const result = castCommander(next);
          if (!result.error) {
            next = result.seat;
            events.unshift(makeEvent(`${seat.name} casts their commander, ${next.board.commander?.name}.`, seat.id));
          }
        } else {
          const chosen = resolveAgentSpell(next, plays, decision, mana);
          if (chosen) {
            const result = playFromHand(next, chosen.id);
            if (result.played) {
              next = result.seat;
              events.unshift(
                makeEvent(
                  `${seat.name} casts ${result.played.name}${result.destination === "graveyard" ? ", which goes to the graveyard" : ""}.`,
                  seat.id,
                  decision?.reason ? `${seat.name}: ${decision.reason.slice(0, 200)}` : undefined
                )
              );
            }
          } else if (decision?.actionType === "pass_priority" && decision.reason) {
            events.unshift(makeEvent(`${seat.name} holds up mana.`, seat.id, `${seat.name}: ${decision.reason.slice(0, 200)}`));
          }
        }
        return next;
      });
      return { ...current, seats, events: [...events, ...current.events] };
    });
  }

  function resolveAgentSpell(seat: PlayerSeat, plays: AgentPlays, decision: AgentAction | undefined, mana: number): VisibleCard | undefined {
    if (decision?.actionType === "pass_priority") return undefined;
    const wanted = decision?.cardId?.replace(/[[\]]/g, "").trim().toLowerCase();
    if (wanted) {
      const match = seat.board.hand.find((card) => card.id.toLowerCase() === wanted || card.name.toLowerCase() === wanted);
      if (match && !isLand(match) && match.manaValue <= mana) return match;
    }
    return plays.spellId ? seat.board.hand.find((card) => card.id === plays.spellId) : undefined;
  }

  function passPriority() {
    setPrioritySeatId(activeSeatId);
    setSession((current) => ({
      ...current,
      events: [makeEvent("You pass priority. The table passes and the stack resolves.", humanSeat.id), ...current.events]
    }));
  }

  function openResponseWindow() {
    setPrioritySeatId(humanSeat.id);
    setSession((current) => ({
      ...current,
      events: [
        makeEvent("Response window opened for the player.", humanSeat.id, "Cast instants from hand, then pass priority."),
        ...current.events
      ]
    }));
  }

  function drawCard(seatId: string) {
    setSession((current) => {
      const events: GameEvent[] = [];
      const seats = current.seats.map((seat) => {
        if (seat.id !== seatId) return seat;
        const { seat: next, drawn, failed } = drawCards(seat, 1);
        events.unshift(
          failed > 0
            ? makeEvent(`${seat.name} cannot draw from an empty library.`, seat.id)
            : makeEvent(`${seat.name} draws ${seat.kind === "human" ? (drawn[0]?.name ?? "a card") : "a card"}.`, seat.id)
        );
        return next;
      });
      return { ...current, seats, events: [...events, ...current.events] };
    });
  }

  function playCard(seatId: string, cardId: string, position?: { x: number; z: number }) {
    setSession((current) => {
      const events: GameEvent[] = [];
      const seats = current.seats.map((seat) => {
        if (seat.id !== seatId) return seat;
        const card = seat.board.hand.find((item) => item.id === cardId);
        if (card && isLand(card) && current.activePlayerId !== seatId) {
          events.unshift(makeEvent("You can only play lands on your own turn.", seat.id));
          return seat;
        }
        const result = playFromHand(seat, cardId, position, { keepNonPermanents: true });
        if (result.error) {
          events.unshift(makeEvent(result.error, seat.id));
          return seat;
        }
        if (result.played) {
          const verb = isLand(result.played) ? "play" : "cast";
          events.unshift(
            makeEvent(`${seat.kind === "human" ? `You ${verb}` : `${seat.name} ${verb}s`} ${result.played.name}.`, seat.id)
          );
        }
        return result.seat;
      });
      return { ...current, seats, events: [...events, ...current.events] };
    });
    setSelectedHandCardId(undefined);
  }

  function millCard() {
    setSession((current) => {
      const events: GameEvent[] = [];
      const seats = current.seats.map((seat) => {
        if (seat.id !== humanSeat.id) return seat;
        const result = millTop(seat);
        events.unshift(result.milled ? makeEvent(`You mill ${result.milled.name}.`, seat.id) : makeEvent("Your library is empty.", seat.id));
        return result.seat;
      });
      return { ...current, seats, events: [...events, ...current.events] };
    });
  }

  function scryToBottom() {
    setSession((current) => {
      const events: GameEvent[] = [];
      const seats = current.seats.map((seat) => {
        if (seat.id !== humanSeat.id) return seat;
        const result = libraryTopToBottom(seat);
        events.unshift(
          result.moved
            ? makeEvent("You put the top card of your library on the bottom.", seat.id)
            : makeEvent("Your library is empty.", seat.id)
        );
        return result.seat;
      });
      return { ...current, seats, events: [...events, ...current.events] };
    });
  }

  function tutorCard(cardId: string) {
    setSession((current) => {
      const events: GameEvent[] = [];
      const seats = current.seats.map((seat) => {
        if (seat.id !== humanSeat.id) return seat;
        const result = takeFromLibrary(seat, cardId);
        if (result.taken) {
          events.unshift(makeEvent(`You search your library for ${result.taken.name} and shuffle.`, seat.id));
        }
        return result.seat;
      });
      return { ...current, seats, events: [...events, ...current.events] };
    });
  }

  function moveCard(seatId: string, cardId: string, position: { x: number; z: number }) {
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) =>
        seat.id !== seatId
          ? seat
          : {
              ...seat,
              board: {
                ...seat.board,
                battlefield: seat.board.battlefield.map((card) =>
                  card.id === cardId ? { ...card, battlefieldPosition: position } : card
                )
              }
            }
      )
    }));
  }

  function castHumanCommander() {
    setSession((current) => {
      const events: GameEvent[] = [];
      const seats = current.seats.map((seat) => {
        if (seat.id !== humanSeat.id) return seat;
        const tax = 2 * (seat.commanderCasts ?? 0);
        const result = castCommander(seat);
        if (result.error) {
          events.unshift(makeEvent(result.error, seat.id));
          return seat;
        }
        events.unshift(
          makeEvent(`You cast your commander, ${result.seat.board.commander?.name}.${tax > 0 ? ` Commander tax: +${tax}.` : ""}`, seat.id)
        );
        return result.seat;
      });
      return { ...current, seats, events: [...events, ...current.events] };
    });
  }

  function adjustLife(seatId: string, delta: number) {
    setSession((current) => {
      const events: GameEvent[] = [];
      const seats = current.seats.map((seat) => {
        if (seat.id !== seatId) return seat;
        const life = seat.life + delta;
        if (life <= 0 && seat.life > 0) {
          events.unshift(makeEvent(`${seat.name} is at ${life} life and is eliminated.`, seat.id));
        }
        return { ...seat, life };
      });
      return { ...current, seats, events: [...events, ...current.events] };
    });
  }

  function toggleTapCard(cardId: string) {
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) =>
        seat.board.battlefield.some((card) => card.id === cardId) ? toggleTap(seat, cardId) : seat
      )
    }));
    setInspectedCard((current) => (current?.id === cardId ? { ...current, tapped: !current.tapped } : current));
  }

  function transformBattlefieldCard(cardId: string) {
    const owner = sessionRef.current.seats.find((seat) => seat.board.battlefield.some((card) => card.id === cardId));
    const card = owner?.board.battlefield.find((item) => item.id === cardId);
    if (!owner || !card) return;
    const next = transformCard(card);
    if (next === card) return;
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) =>
        seat.id !== owner.id
          ? seat
          : {
              ...seat,
              board: {
                ...seat.board,
                battlefield: seat.board.battlefield.map((item) => (item.id === cardId ? next : item)),
                commander: seat.board.commander?.id === cardId ? next : seat.board.commander
              }
            }
      ),
      events: [makeEvent(`${card.name} transforms into ${next.name}.`, owner.id), ...current.events]
    }));
    setInspectedCard(next);
  }

  function destroyCard(cardId: string) {
    setSession((current) => {
      const events: GameEvent[] = [];
      const seats = current.seats.map((seat) => {
        if (!seat.board.battlefield.some((card) => card.id === cardId)) return seat;
        const result = removeFromBattlefield(seat, cardId);
        if (result.removed) {
          events.unshift(
            makeEvent(
              result.toCommandZone
                ? `${result.removed.name} returns to ${seat.name}'s command zone.`
                : `${result.removed.name} goes to ${seat.name}'s graveyard.`,
              seat.id
            )
          );
        }
        return result.seat;
      });
      return { ...current, seats, events: [...events, ...current.events] };
    });
    setInspectedCard((current) => (current?.id === cardId ? undefined : current));
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
    <main className="app-shell game-shell">
      <button className="game-back-button" type="button" onClick={() => setMode("setup")} aria-label="Back to setup">
        ×
      </button>
      <ThreeGameTable
        gameStage={gameStage}
        humanMulligans={mulligans[humanSeat.id] ?? 0}
        session={{ ...session, activePlayerId: activeSeatId }}
        prioritySeatId={prioritySeatId}
        thinkingSeatId={thinkingSeatId}
        onKeepHand={keepOpeningHand}
        onMulligan={mulliganOpeningHand}
        onAdvanceTurn={advanceToNextSeat}
        onDrawCard={drawCard}
        onInspectCard={setInspectedCard}
        onPassPriority={passPriority}
        onPlayCard={playCard}
        onMoveCard={moveCard}
        onRespond={openResponseWindow}
        onCastCommander={castHumanCommander}
        onMill={millCard}
        onScryBottom={scryToBottom}
        onTutor={tutorCard}
        onAdjustLife={adjustLife}
        onToggleTap={toggleTapCard}
        onTransform={transformBattlefieldCard}
        onDestroyCard={destroyCard}
        onSelectHandCard={(card) => setSelectedHandCardId((current) => (current === card.id ? undefined : card.id))}
        inspectedCard={inspectedCard}
        selectedCardId={selectedHandCardId}
      />
    </main>
  );
}

// Pull the (possibly still-growing) reason string out of partially generated JSON.
function extractPartialReason(content: string) {
  const match = content.match(/"reason"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (!match) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1].replace(/\\"/g, '"').replace(/\\n/g, " ");
  }
}

function buildAgentPrompt(seat: PlayerSeat, session: GameSession, plays: AgentPlays): string {
  const mana = availableMana(seat) + (plays.landId ? 1 : 0);
  const opponents = session.seats
    .filter((other) => other.id !== seat.id)
    .map((other) => `${other.name}: ${other.life} life, ${other.zones.battlefield} permanents`)
    .join("; ");
  const battlefield = seat.board.battlefield.map((card) => card.name).join(", ") || "empty";
  const hand = seat.board.hand
    .map((card) => `[${card.id}] ${card.name} (cost ${card.manaValue}, ${card.typeLine})`)
    .join("; ");
  return [
    `Turn ${session.turn}. You are ${seat.name}, playing a ${seat.deck?.commander ?? "Commander"} deck with ${seat.life} life.`,
    `Opponents: ${opponents}.`,
    `Your battlefield: ${battlefield}.`,
    `Mana available this turn: ${mana}.`,
    `Your hand: ${hand || "empty"}.`,
    `Choose ONE spell to cast this main phase. Respond with actionType "cast_spell" and set cardId to the id in [brackets]. Only pick a non-Land card with cost <= ${mana}. If nothing is worth casting, respond with actionType "pass_priority". Give a short reason.`
  ].join("\n");
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
