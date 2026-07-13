"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CommanderDeck, GameEvent, GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import type { RuleWorkflow } from "@/lib/rulesAdvisor";
import { createDeckFromList } from "@/lib/deckParser";
import { ThreeGameTable } from "./ThreeGameTable";

type FlowMode = "setup" | "game";
type DeckInputMode = "commander" | "decklist";
type DeckBuildStatus = "empty" | "building" | "ready" | "error";
type GameStage = "mulligan" | "playing";
type TurnPhase = (typeof TURN_PHASES)[number];
type LibraryLookMode = "scry" | "surveil" | "reorder";
type ManaColor = "W" | "U" | "B" | "R" | "G" | "C";
type ColoredMana = Exclude<ManaColor, "C">;
type ManaPool = Record<ManaColor, number>;
type PendingAction =
  | {
      id: string;
      type: "phase";
      actorSeatId: string;
      message: string;
    }
  | {
      id: string;
      type: "spell";
      actorSeatId: string;
      cardId: string;
      cardName: string;
      sourceZone?: "hand" | "command";
      manaSourceIds: string[];
      position?: { x: number; z: number };
      triggersChecked?: boolean;
      message: string;
    }
  | {
      id: string;
      type: "trigger";
      actorSeatId: string;
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      triggerKind: "draw";
      parentAction?: PendingAction;
      message: string;
    };

interface LibraryLookState {
  seatId: string;
  mode: LibraryLookMode;
  cards: VisibleCard[];
  remaining: number;
  orderedCards?: VisibleCard[];
}

interface MyriadSearchState {
  seatId: string;
  sourceCardId: string;
}

type PendingRuleChoice =
  | {
      id: string;
      kind: "choose_card_from_library";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      destination: "hand" | "battlefield";
      tapped?: boolean;
      maxChoices: number;
      allowedCardFilter?: string;
    }
  | {
      id: string;
      kind: "manual_review";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
    }
  | {
      id: string;
      kind: "order_triggers";
      controllerSeatId: string;
      prompt: string;
      triggers: Array<{
        sourceCardId: string;
        sourceCardName: string;
        text: string;
      }>;
      orderedTriggers: Array<{
        sourceCardId: string;
        sourceCardName: string;
        text: string;
      }>;
    };

interface ManualLibrarySearchState {
  seatId: string;
  destination: "hand";
  tapped?: boolean;
}

interface BlockChoiceState {
  attackerSeatId: string;
  defenderSeatId: string;
  attackerCardId: string;
}

interface ManaChoiceState {
  seatId: string;
  cardId: string;
  cardName: string;
  location: "battlefield" | "command";
  choices: ManaColor[];
}

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
  activity: string[];
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

const DEFAULT_PLAYER_COMMANDER = "Aminatou, Veil Piercer";
const DEFAULT_PLAYER_DECKLIST = `Commander: Aminatou, Veil Piercer
1 Adarkar Wastes (DSC) 258
1 Aminatou, the Fateshifter (C18) 37 *F*
1 Arcane Denial (DSC) 110
1 Arcane Sanctum (DSC) 259
1 Arcane Signet (DSC) 92
1 Archaeomancer's Map (FIC) 230
1 Archon of Sun's Grace (J22) 151
1 Athreos, Shroud-Veiled (DSC) 212
1 Blasphemous Edict (FDN) 57
1 Boon of the Spirit Realm (CMM) 720
1 Brainstorm (DSC) 113
1 Brainsurge (MH3) 53
1 Callaphe, Beloved of the Sea (THB) 260
1 Caves of Koilos (DSC) 268
1 Command Tower (DSC) 96
1 Contaminated Aquifer (DMU) 245
1 Counterspell (A25) 50
1 Debtors' Knell (GK2) 39
1 Demon of Fate's Design (DSC) 137
1 Devastation Tide (LTC) 189
1 Diabolic Vision (DSC) 87
1 Doomwake Giant (DSC) 138
1 Drowned Catacomb (M13) 223
1 Enhanced Surveillance (MKC) 102
1 Esper Sentinel (MH2) 12
1 Estrid's Invocation (MH3) 269
1 Evolving Wilds (DSC) 274
1 Extravagant Replication (DSC) 117
1 Fear of Sleep Paralysis (DSC) 12
1 Glacial Fortress (PIP) 266
1 Greed (MH2) 274
1 Halimar Depths (DSC) 282
1 Heliod, the Radiant Dawn / Heliod, the Warped Eclipse (MOM) 293
1 Inkshield (DSC) 221
1 Inquisitive Glimmer (DSK) 217
6 Island (DSK) 280
1 Isolated Chapel (LCC) 337
1 Ledger Shredder (SNC) 46
1 Lim-D\u00fbl's Vault (MB2) 87
1 Mind's Dilation (EMN) 70
1 Monologue Tax (SLD) 1838
1 Moon-Blessed Cleric (DSC) 69
1 Myriad Landscape (PIP) 274
1 Mystic Remora (ICE) 87
1 Negate (M12) 69
1 Obscura Storefront (DSC) 291
1 Omniscience (M13) 63
1 One with the Multiverse (DSC) 121
1 Otherworldly Gaze (DSC) 122
1 Overwhelming Splendor (HOU) 19
6 Plains (DSK) 278
1 Ponder (DSC) 73
1 Portent (DSC) 74
1 Prairie Stream (C20) 299
1 Propaganda (WHO) 219
1 Redress Fate (DSC) 9
1 Secret Arcade / Dusty Parlor (DSC) 10
1 Shadow of the Second Sun (MH3) 402
1 Shark Typhoon (DSC) 127
1 Sigil of the Empty Throne (DSC) 103
1 Soaring Lightbringer (DSC) 11
1 Sol Ring (DSC) 94
1 Sphere of Safety (DSC) 104
1 Starfield of Nyx (CMM) 840
1 Sunken Palace (M3C) 133
4 Swamp (DSK) 282
1 Swords to Plowshares (PIP) 173
1 Tainted Field (LCC) 356
1 Talisman of Dominance (WHO) 250
1 Talisman of Hierarchy (CLB) 878
1 Talisman of Progress (MKC) 243
1 Temple of Deceit (OTC) 328
1 Temple of Silence (DSC) 312
1 Temporal Mastery (INR) 90
1 Thriving Heath (DSC) 315
1 Thriving Isle (DSC) 316
1 Thriving Moor (DSC) 317
1 Timely Ward (DSC) 107
1 Underground River (DSC) 321
1 Utter End (DSC) 91
1 Utter Insignificance (MH3) 78
1 Vanishing (VIS) 48
1 Virtue of Persistence / Locthwain Scorn (WOE) 281
1 Void Rend (FIC) 331
1 Wayfarer's Bauble (PIP) 252
1 Zur, Eternal Schemer (PDMU) 228p`;
const TURN_PHASES = [
  "untap step",
  "upkeep step",
  "draw step",
  "precombat main phase",
  "beginning of combat step",
  "declare attackers step",
  "declare blockers step",
  "combat damage step",
  "end of combat step",
  "postcombat main phase",
  "end step",
  "cleanup step"
] as const;

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
  const [mulliganReturnCardIds, setMulliganReturnCardIds] = useState<string[]>([]);
  const [libraryLook, setLibraryLook] = useState<LibraryLookState | undefined>();
  const [manualLibrarySearch, setManualLibrarySearch] = useState<ManualLibrarySearchState | undefined>();
  const [pendingRuleChoice, setPendingRuleChoice] = useState<PendingRuleChoice | undefined>();
  const [blockChoice, setBlockChoice] = useState<BlockChoiceState | undefined>();
  const [myriadSearch, setMyriadSearch] = useState<MyriadSearchState | undefined>();
  const [pendingAction, setPendingAction] = useState<PendingAction | undefined>();
  const [stackActions, setStackActions] = useState<PendingAction[]>([]);
  const [priorityPasses, setPriorityPasses] = useState<string[]>([]);
  const [manaPools, setManaPools] = useState<Record<string, ManaPool>>({});
  const [manaChoice, setManaChoice] = useState<ManaChoiceState | undefined>();
  const [setupMessage, setSetupMessage] = useState<string | undefined>();
  const [configs, setConfigs] = useState<SeatConfig[]>(() => createInitialConfigs(initialSession.seats));
  const autoValidatedDefaultDeck = useRef(false);
  const agentMainActions = useRef<Set<string>>(new Set());
  const landPlaysThisTurn = useRef<Set<string>>(new Set());
  const phaseTriggersChecked = useRef<Set<string>>(new Set());
  const stackActionsRef = useRef<PendingAction[]>([]);
  const humanSeat = session.seats.find((seat) => seat.kind === "human") ?? session.seats[0];
  const selectedHandCard = selectedHandCardId ? humanSeat.board.hand.find((card) => card.id === selectedHandCardId) : undefined;
  const selectedCardCanRespond = selectedHandCard ? canCastAtInstantSpeed(selectedHandCard) && payCostFromPool(poolForSeat(humanSeat.id), selectedHandCard, selectedHandCard.manaValue).ok : false;
  const playBlockedByBuild = configs.some((config) => config.status === "building");

  const setupSummary = useMemo(() => {
    const ready = configs.filter((config) => config.deck?.validation.legal).length;
    return `${ready}/${configs.length} decks ready`;
  }, [configs]);

  function updateConfig(seatId: string, patch: Partial<SeatConfig>) {
    setConfigs((current) => current.map((config) => (config.seatId === seatId ? { ...config, ...patch } : config)));
  }

  function replaceStackActions(next: PendingAction[]) {
    stackActionsRef.current = next;
    setStackActions(next);
  }

  function pushStackAction(action: PendingAction) {
    if (!isStackAction(action)) return;
    const current = stackActionsRef.current;
    if (current.some((item) => item.id === action.id)) return;
    replaceStackActions([...current, action]);
  }

  function updateStackAction(action: PendingAction) {
    replaceStackActions(stackActionsRef.current.map((item) => (item.id === action.id ? action : item)));
  }

  function removeStackAction(actionId: string) {
    const next = stackActionsRef.current.filter((item) => item.id !== actionId);
    replaceStackActions(next);
    return next;
  }

  function resumeTopStackAction(stack: PendingAction[]) {
    const nextAction = stack[stack.length - 1];
    if (nextAction) {
      window.setTimeout(() => beginPendingAction(nextAction, nextAction.type === "trigger" ? "Trigger" : "Stack"), 0);
      return true;
    }
    return false;
  }

  function poolForSeat(seatId: string) {
    return manaPools[seatId] ?? emptyManaPool();
  }

  function setSeatManaPool(seatId: string, pool: ManaPool) {
    setManaPools((current) => ({ ...current, [seatId]: pool }));
  }

  function clearManaPool(seatId: string) {
    setSeatManaPool(seatId, emptyManaPool());
  }

  function addFloatingMana(seatId: string, color: ManaColor) {
    const seat = session.seats.find((item) => item.id === seatId);
    setSeatManaPool(seatId, addManaToPool(poolForSeat(seatId), color, color === "C" ? 1 : 1));
    addEvent(`${seat?.name ?? "Player"} adds ${color} to their mana pool.`, seatId, "Mana");
  }

  useEffect(() => {
    if (autoValidatedDefaultDeck.current) return;
    const humanConfig = configs.find((config) => config.kind === "human" && config.mode === "decklist" && config.deckList.trim());
    if (!humanConfig || humanConfig.deck) return;
    autoValidatedDefaultDeck.current = true;
    void buildDeck(humanConfig);
  }, [configs]);

  useEffect(() => {
    if (mode !== "game" || gameStage !== "playing") return;
    const prioritySeat = session.seats.find((seat) => seat.id === prioritySeatId);
    if (!pendingAction || prioritySeat?.kind !== "agent") return;
    if (!pendingActionRequiredPasses(session.seats, pendingAction, manaPools).includes(prioritySeat.id)) {
      setPrioritySeatId(nextPrioritySeatId(session.seats, pendingAction.actorSeatId, priorityPasses, pendingAction, manaPools));
      return;
    }
    const timer = window.setTimeout(() => passPriority(), 850);
    return () => window.clearTimeout(timer);
  }, [mode, gameStage, pendingAction, priorityPasses, prioritySeatId, session.seats, manaPools]);

  useEffect(() => {
    if (mode !== "game" || gameStage !== "playing" || pendingAction || libraryLook || pendingRuleChoice) return;
    if (!TURN_PHASES.includes(session.phase as TurnPhase)) return;
    const activeSeat = session.seats.find((seat) => seat.id === activeSeatId);
    if (!activeSeat) return;
    const key = `${session.turn}:${activeSeat.id}:${session.phase}`;
    if (phaseTriggersChecked.current.has(key)) return;
    phaseTriggersChecked.current.add(key);
    const triggers = phaseTriggeredCards(activeSeat, session.phase as TurnPhase);
    if (triggers.length === 0) return;
    if (triggers.length === 1) {
      void consultRulesAdvisor(phaseEventName(session.phase as TurnPhase), activeSeat.id, triggers[0]);
      return;
    }
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "order_triggers",
      controllerSeatId: activeSeat.id,
      prompt: `${activeSeat.name} has ${triggers.length} ${session.phase} triggers. Choose the order they resolve.`,
      triggers: triggers.map((card) => ({
        sourceCardId: card.id,
        sourceCardName: card.name,
        text: card.oracleText
      })),
      orderedTriggers: []
    });
  }, [mode, gameStage, pendingAction, libraryLook, pendingRuleChoice, session.phase, session.turn, session.seats, activeSeatId]);

  useEffect(() => {
        if (mode !== "game" || gameStage !== "playing" || pendingAction || libraryLook || pendingRuleChoice || manualLibrarySearch || blockChoice) return;
    const activeSeat = session.seats.find((seat) => seat.id === activeSeatId);
    if (activeSeat?.kind !== "agent") return;
    const actionKey = `${session.turn}:${activeSeat.id}:${session.phase}`;
    const shouldPlayMainCard = session.phase === "precombat main phase" && !agentMainActions.current.has(actionKey) && activeSeat.board.hand.length > 0;
    const timer = window.setTimeout(() => {
      if (shouldPlayMainCard) {
        const card = chooseAgentMainPhaseCard(activeSeat, hasPlayedLandThisTurn(activeSeat.id, session.turn));
        if (card) {
          if (!isLandCard(card)) {
            agentMainActions.current.add(actionKey);
          }
          playCard(activeSeat.id, card.id);
          return;
        }
        agentMainActions.current.add(actionKey);
        advanceTurn();
        return;
      }
      advanceTurn();
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [mode, gameStage, pendingAction, libraryLook, pendingRuleChoice, manualLibrarySearch, blockChoice, activeSeatId, session.phase, session.turn, session.seats]);

  useEffect(() => {
    if (mode !== "game" || gameStage !== "playing" || !pendingRuleChoice) return;
    const controller = session.seats.find((seat) => seat.id === pendingRuleChoice.controllerSeatId);
    if (controller?.kind !== "agent") return;
    const timer = window.setTimeout(() => resolveAgentRuleChoice(pendingRuleChoice), 900);
    return () => window.clearTimeout(timer);
  }, [mode, gameStage, pendingRuleChoice, session.seats]);

  async function buildDeck(config: SeatConfig) {
    const commander = config.commander.trim() || fallbackCommander(config.name);
    const colors = inferColors(commander);
    updateConfig(config.seatId, {
      commander,
      status: "building",
      message: config.mode === "decklist" ? "Validating deck list..." : "Asking Ollama to build this deck..."
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
      source: "decklist" | "ollama" | "ollama-invalid" | "fallback";
      message: string;
      notes?: string;
      deck: CommanderDeck;
    };
    const deck = result.deck;
    const activity = [
      result.source === "ollama"
        ? `${config.name} received an Ollama deck draft and the app repaired/validated it against the card catalog.`
        : result.source === "fallback"
          ? `${config.name} used the local fallback builder because Ollama was unavailable.`
          : result.source === "ollama-invalid"
            ? `${config.name} received an Ollama deck draft, but it still failed validation.`
            : `${config.name} validated the pasted deck list.`,
      result.notes ? `Agent notes: ${result.notes}` : undefined,
      `Deck score ${deck.score.total}. ${deck.validation.cardCount} cards. ${deck.validation.gameChangerCount} Game Changers.`,
      ...deck.score.notes
    ].filter((item): item is string => Boolean(item));

    updateConfig(config.seatId, {
      commander,
      deck,
      deckList: formatDeckList(deck),
      status: deck.validation.legal ? "ready" : "error",
      message:
        result.source === "decklist"
          ? result.message
          : result.source === "ollama"
          ? "Ollama built and validated this deck."
          : result.source === "fallback"
            ? result.message
            : deck.validation.errors[0] ?? result.message,
      activity
    });
  }

  function startGame() {
    setSetupMessage(undefined);
    const validated = validateConfigsForPlay(configs);
    if (!validated.ready) {
      setConfigs(validated.configs);
      const blockers = validated.configs.filter((config) => config.status === "error").map((config) => `${config.name}: ${config.message}`);
      setSetupMessage(`Cannot start yet. ${blockers.join(" ")}`);
      return;
    }

    const deckedSeats = session.seats.map((seat) => {
      const config = validated.configs.find((item) => item.seatId === seat.id);
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
          message: "Opening hands drawn. Choose whether to keep or mulligan."
        },
        ...session.events
      ]
    };
    setSession(nextSession);
    setMulligans(agentResolved.mulligans);
    setKeptHands(agentResolved.keptHands);
    setMulliganReturnCardIds([]);
    setPendingAction(undefined);
    replaceStackActions([]);
    setPriorityPasses([]);
    setManaPools({});
    setManaChoice(undefined);
    setManualLibrarySearch(undefined);
    setPendingRuleChoice(undefined);
    setBlockChoice(undefined);
    setSetupMessage(undefined);
    setGameStage("mulligan");
    setMode("game");
  }

  function keepOpeningHand() {
    const keepSize = openingHandKeepSize(mulligans[humanSeat.id] ?? 0);
    const returnCount = Math.max(0, humanSeat.board.hand.length - keepSize);
    if (mulliganReturnCardIds.length !== returnCount) {
      addEvent(`Choose ${returnCount} card${returnCount === 1 ? "" : "s"} to shuffle into your library before keeping.`, humanSeat.id, "Mulligan");
      return;
    }
    const firstSeatId = session.seats[1]?.id ?? humanSeat.id;
    setKeptHands((current) => ({ ...current, [humanSeat.id]: true }));
    setMulliganReturnCardIds([]);
    setGameStage("playing");
    setActiveSeatId(firstSeatId);
    setPrioritySeatId(nextSeatId(session.seats, firstSeatId));
    setSession((current) => ({
      ...current,
      status: "playing",
      activePlayerId: firstSeatId,
      phase: "untap step",
      turn: 1,
      seats: current.seats.map((seat) => (seat.id === humanSeat.id ? keepOpeningHandSize(seat, keepSize, mulliganReturnCardIds, true) : seat)),
      events: [
        phaseEvent(firstSeatId, `${current.seats.find((seat) => seat.id === firstSeatId)?.name ?? "Player"} starts turn 1: untap step.`),
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: humanSeat.id,
          message: keepSize === 7 ? "You kept 7. The game begins." : `You kept ${keepSize} and shuffled ${7 - keepSize} card${7 - keepSize === 1 ? "" : "s"} into your library. The game begins.`
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
    setMulliganReturnCardIds([]);
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) => (seat.id === humanSeat.id ? withOpeningHand(seat, 7, nextCount) : seat)),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: humanSeat.id,
          message: nextCount === 1 ? "You shuffled your hand into your library and drew 7. First mulligan is free; you can still keep 7." : `You shuffled your hand into your library and drew 7. Choose ${7 - nextKeepSize} card${7 - nextKeepSize === 1 ? "" : "s"} not to keep.`
        },
        ...current.events
      ]
    }));
  }

  function toggleMulliganReturnCard(card: VisibleCard) {
    const keepSize = openingHandKeepSize(mulligans[humanSeat.id] ?? 0);
    const required = Math.max(0, humanSeat.board.hand.length - keepSize);
    if (required === 0) return;
    setMulliganReturnCardIds((current) => {
      if (current.includes(card.id)) return current.filter((id) => id !== card.id);
      if (current.length >= required) return current;
      return [...current, card.id];
    });
  }

  function advanceTurn() {
    if (pendingAction) return;
    const activeSeat = session.seats.find((seat) => seat.id === activeSeatId);
    if (!activeSeat) return;
    const action: PendingAction = {
      id: crypto.randomUUID(),
      type: "phase",
      actorSeatId: activeSeat.id,
      message: `${activeSeat.name} wants to pass ${session.phase}.`
    };
    setSelectedHandCardId(undefined);
    beginPendingAction(action, "Priority window");
  }

  function endTurn() {
    if (pendingAction) return;
    const activeSeat = session.seats.find((seat) => seat.id === activeSeatId);
    if (!activeSeat || activeSeat.id !== humanSeat.id) return;
    setSelectedHandCardId(undefined);
    setPriorityPasses([]);
    setSession((current) => resolveEndTurn(current, activeSeat.id));
  }

  function phaseEvent(seatId: string, message: string): GameEvent {
    return {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      seatId,
      message,
      detail: "Phase change"
    };
  }

  function resolvePhaseAdvance(current: GameSession) {
    const activeId = current.activePlayerId ?? activeSeatId;
    const activeIndex = Math.max(0, current.seats.findIndex((seat) => seat.id === activeId));
    const activeSeat = current.seats[activeIndex];
    const phaseIndex = TURN_PHASES.indexOf(current.phase as TurnPhase);
    const nextPhase = phaseIndex >= 0 ? TURN_PHASES[phaseIndex + 1] : TURN_PHASES[0];
    clearManaPool(activeId);

    if (!nextPhase) {
      const nextSeat = current.seats[(activeIndex + 1) % current.seats.length];
      setActiveSeatId(nextSeat.id);
      setPrioritySeatId(nextSeatId(current.seats, nextSeat.id));
      return runPhaseActions(
        {
          ...current,
          activePlayerId: nextSeat.id,
          turn: current.turn + 1,
          phase: TURN_PHASES[0],
          events: [phaseEvent(nextSeat.id, `${nextSeat.name} starts turn ${current.turn + 1}: ${TURN_PHASES[0]}.`), ...current.events]
        },
        nextSeat.id,
        TURN_PHASES[0]
      );
    }

    setPrioritySeatId(nextSeatId(current.seats, activeSeat.id));
    return runPhaseActions(
      {
        ...current,
        phase: nextPhase,
        events: [phaseEvent(activeSeat.id, `${activeSeat.name} passes to ${nextPhase}.`), ...current.events]
      },
      activeSeat.id,
      nextPhase
    );
  }

  function resolveEndTurn(current: GameSession, seatId: string) {
    const activeIndex = Math.max(0, current.seats.findIndex((seat) => seat.id === seatId));
    const activeSeat = current.seats[activeIndex];
    if (!activeSeat) return current;

    const nextSeat = current.seats[(activeIndex + 1) % current.seats.length];
    clearManaPool(seatId);
    setActiveSeatId(nextSeat.id);
    setPrioritySeatId(nextSeatId(current.seats, nextSeat.id));

    const cleaned = cleanupCombat(
      {
        ...current,
        events: [phaseEvent(activeSeat.id, `${activeSeat.name} ends their turn and skips the remaining phases.`), ...current.events]
      },
      activeSeat.id
    );

    return runPhaseActions(
      {
        ...cleaned,
        activePlayerId: nextSeat.id,
        turn: current.turn + 1,
        phase: TURN_PHASES[0],
        events: [phaseEvent(nextSeat.id, `${nextSeat.name} starts turn ${current.turn + 1}: ${TURN_PHASES[0]}.`), ...cleaned.events]
      },
      nextSeat.id,
      TURN_PHASES[0]
    );
  }

  function runPhaseActions(session: GameSession, seatId: string, phase: TurnPhase): GameSession {
    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat) return session;

    if (phase === "untap step") {
      return untapForSeat(session, seatId);
    }

    if (phase === "draw step") {
      return drawForSeat(session, seatId, `${seat.name} draws for turn.`);
    }

    if (phase === "declare attackers step" && seat.kind === "agent") {
      return declareAgentAttack(session, seatId);
    }

    if (phase === "declare blockers step") {
      const blockChoiceState = createHumanBlockChoice(session, seatId);
      if (blockChoiceState) {
        setBlockChoice(blockChoiceState);
        return {
          ...session,
          events: [phaseEvent(blockChoiceState.defenderSeatId, `${session.seats.find((item) => item.id === blockChoiceState.defenderSeatId)?.name ?? "Defender"} chooses blockers.`), ...session.events]
        };
      }
      if (seat.kind === "agent") return resolveAgentBlocks(session, seatId);
    }

    if (phase === "combat damage step") {
      return resolveCombatDamage(session, seatId);
    }

    if (phase === "end of combat step") {
      return cleanupCombat(session, seatId);
    }

    return session;
  }

  function untapForSeat(session: GameSession, seatId: string): GameSession {
    const seat = session.seats.find((item) => item.id === seatId);
    return {
      ...session,
      seats: session.seats.map((item) =>
        item.id === seatId
          ? {
              ...item,
              board: {
                ...item.board,
                commander: item.board.commander ? { ...item.board.commander, tapped: false, summoningSick: false, attacking: false, blocking: false } : undefined,
                battlefield: item.board.battlefield.map((card) => ({ ...card, tapped: false, summoningSick: false, attacking: false, blocking: false }))
              }
            }
          : item
      ),
      events: [phaseEvent(seatId, `${seat?.name ?? "Player"} untaps their permanents.`), ...session.events]
    };
  }

  function declareAgentAttack(session: GameSession, seatId: string): GameSession {
    const attacker = session.seats.find((seat) => seat.id === seatId);
    if (!attacker) return session;
    const attackerIndex = session.seats.findIndex((seat) => seat.id === seatId);
    const defender = session.seats[(attackerIndex + 1) % session.seats.length];
    const attackingCard = attacker.board.battlefield.find((card) => canAttack(card));

    if (!attackingCard) {
      return {
        ...session,
        events: [phaseEvent(seatId, `${attacker.name} has no creatures that can attack.`), ...session.events]
      };
    }

    return {
      ...session,
      seats: session.seats.map((seat) =>
        seat.id === seatId
          ? {
              ...seat,
              board: {
                ...seat.board,
                battlefield: seat.board.battlefield.map((card) => (card.id === attackingCard.id ? { ...card, attacking: true, tapped: true } : card))
              }
            }
          : seat
      ),
      events: [phaseEvent(seatId, `${attacker.name} attacks ${defender.name} with ${attackingCard.name}.`), ...session.events]
    };
  }

  function resolveAgentBlocks(session: GameSession, attackerId: string): GameSession {
    const attackerIndex = session.seats.findIndex((seat) => seat.id === attackerId);
    const attacker = session.seats[attackerIndex];
    const defender = session.seats[(attackerIndex + 1) % session.seats.length];
    if (!attacker || !defender) return session;

    const attackingCard = attacker.board.battlefield.find((card) => card.attacking);
    if (!attackingCard) {
      return {
        ...session,
        events: [phaseEvent(attackerId, "No attackers were declared, so blockers are skipped."), ...session.events]
      };
    }

    const blocker = defender.board.battlefield.find((card) => canBlock(card));
    if (blocker) {
      return {
        ...session,
        seats: session.seats.map((seat) =>
          seat.id === defender.id
            ? {
                ...seat,
                board: {
                  ...seat.board,
                  battlefield: seat.board.battlefield.map((card) => (card.id === blocker.id ? { ...card, blocking: true } : card))
                }
              }
            : seat
        ),
        events: [phaseEvent(defender.id, `${defender.name} blocks ${attackingCard.name} with ${blocker.name}.`), ...session.events]
      };
    }

    return {
      ...session,
      events: [phaseEvent(defender.id, `${defender.name} declares no blockers for ${attackingCard.name}.`), ...session.events]
    };
  }

  function chooseHumanBlocker(blockerCardId: string) {
    const choice = blockChoice;
    if (!choice) return;
    setBlockChoice(undefined);
    setSession((current) => resolveHumanBlock(current, choice, blockerCardId));
  }

  function passHumanBlocks() {
    const choice = blockChoice;
    if (!choice) return;
    setBlockChoice(undefined);
    setSession((current) => resolveHumanUnblockedDamage(current, choice));
  }

  function payCumulativeUpkeep() {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "manual_review") return;
    const seat = session.seats.find((item) => item.id === choice.controllerSeatId);
    const source = seat?.board.battlefield.find((card) => card.id === choice.sourceCardId);
    if (!seat || !source || !isCumulativeUpkeepCard(source)) return;
    const cost = cumulativeUpkeepCost(source);
    const pool = poolForSeat(seat.id);
    if (manaPoolTotal(pool) < cost) {
      addEvent(`${seat.name} cannot pay ${source.name}'s cumulative upkeep; ${cost} generic mana is required.`, seat.id, "Rules advisor");
      return;
    }
    setSeatManaPool(seat.id, spendGenericMana(pool, cost));
    setSession((current) => ({
      ...current,
      seats: current.seats.map((item) =>
        item.id === seat.id
          ? {
              ...item,
              board: {
                ...item.board,
                battlefield: item.board.battlefield.map((card) => (card.id === source.id ? applyCounterDelta(card, "age", 1) : card))
              }
            }
          : item
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: seat.id,
          message: `${seat.name} pays ${source.name}'s cumulative upkeep for ${cost} mana and adds an age counter.`,
          detail: "Rules advisor"
        },
        ...current.events
      ]
    }));
    setPendingRuleChoice(undefined);
  }

  function sacrificeRuleChoiceSource() {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "manual_review") return;
    setPendingRuleChoice(undefined);
    setSession((current) => moveCardBetweenVisibleZones(current, choice.controllerSeatId, choice.sourceCardId, "graveyard"));
  }

  function resolveCombatDamage(session: GameSession, attackerId: string): GameSession {
    const attackerIndex = session.seats.findIndex((seat) => seat.id === attackerId);
    const attacker = session.seats[attackerIndex];
    const defender = session.seats[(attackerIndex + 1) % session.seats.length];
    if (!attacker || !defender) return session;
    const attackingCards = attacker.board.battlefield.filter((card) => card.attacking);
    if (attackingCards.length === 0) {
      return {
        ...session,
        events: [phaseEvent(attackerId, "No attacking creatures assign combat damage."), ...session.events]
      };
    }
    const hasBlockers = defender.board.battlefield.some((card) => card.blocking);
    if (hasBlockers) {
      return {
        ...session,
        events: [phaseEvent(attackerId, "Blocked creatures deal combat damage. Combat damage to creatures is pending manual handling."), ...session.events]
      };
    }
    const damage = attackingCards.reduce((total, card) => total + parsePower(card.power), 0);
    return {
      ...session,
      seats: session.seats.map((seat) => (seat.id === defender.id ? { ...seat, life: Math.max(0, seat.life - damage) } : seat)),
      events: [phaseEvent(attackerId, `${attackingCards.map((card) => card.name).join(", ")} deal ${damage} combat damage to ${defender.name}.`), ...session.events]
    };
  }

  function cleanupCombat(session: GameSession, seatId: string): GameSession {
    const seat = session.seats.find((item) => item.id === seatId);
    return {
      ...session,
      seats: session.seats.map((item) => ({
        ...item,
        board: {
          ...item.board,
          battlefield: item.board.battlefield.map((card) => ({ ...card, attacking: false, blocking: false }))
        }
      })),
      events: [phaseEvent(seatId, `${seat?.name ?? "Player"} clears combat at end of combat.`), ...session.events]
    };
  }

  function passPriority() {
    if (!pendingAction) {
      const nextSeat = session.seats[(Math.max(0, session.seats.findIndex((seat) => seat.id === prioritySeatId)) + 1) % session.seats.length];
      setPrioritySeatId(nextSeat.id);
      return;
    }

    const passingSeatId = prioritySeatId;
    const requiredPasses = pendingActionRequiredPasses(session.seats, pendingAction, manaPools);
    const nextPasses = Array.from(new Set([...priorityPasses, passingSeatId]));
    const passedByEveryone = requiredPasses.every((seatId) => nextPasses.includes(seatId));

    setSession((current) => ({
      ...current,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: passingSeatId,
          message: `${current.seats.find((seat) => seat.id === passingSeatId)?.name ?? "Player"} passed priority.`
        },
        ...current.events
      ]
    }));

    if (passedByEveryone) {
      resolvePendingAction(pendingAction);
      return;
    }

    setPriorityPasses(nextPasses);
    setPrioritySeatId(nextPrioritySeatId(session.seats, pendingAction.actorSeatId, nextPasses, pendingAction, manaPools));
  }

  function openResponseWindow() {
    if (!pendingAction) return;
    setSession((current) => ({
      ...current,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: humanSeat.id,
          message: `${humanSeat.name} is reviewing the pending ${pendingAction.type}.`,
          detail: "Priority window"
        },
        ...current.events
      ]
    }));
  }

  function drawCard(seatId: string) {
    setSession((current) => drawForSeat(current, seatId, `${current.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} draws a card.`));
  }

  function shuffleLibrary(seatId: string) {
    setLibraryLook(undefined);
    setSession((current) => {
      const seat = current.seats.find((item) => item.id === seatId);
      return {
        ...current,
        seats: current.seats.map((item) =>
          item.id === seatId
            ? {
                ...item,
                library: shuffleCards(item.library ?? [])
              }
            : item
        ),
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId,
            message: `${seat?.name ?? "Player"} shuffles their library.`
          },
          ...current.events
        ]
      };
    });
  }

  function playCard(seatId: string, cardId: string, position?: { x: number; z: number }, sourceZone: "hand" | "command" = "hand") {
    if (pendingAction) return;
    const seat = session.seats.find((item) => item.id === seatId);
    const card = sourceZone === "command" ? seat?.board.commander : seat?.board.hand.find((item) => item.id === cardId);
    if (!seat || !card) return;

    if (sourceZone === "command" && card.id !== cardId) return;

    if (isLandCard(card)) {
      if (sourceZone !== "hand") return;
      if (hasPlayedLandThisTurn(seatId, session.turn)) {
        addEvent(`${seat.name} already played a land this turn.`, seatId, "Mana");
        return;
      }
      landPlaysThisTurn.current.add(landTurnKey(seatId, session.turn));
      setSession((current) => playCardFromZone(current, seatId, cardId, `${seat.name} plays ${card.name}.`, position));
      void consultRulesAdvisor("land_played", seatId, card);
      setSelectedHandCardId(undefined);
      return;
    }

    const totalCost = adjustedCastingCost(seat, card, card.manaValue, sourceZone, activeSeatId) + (sourceZone === "command" ? card.commanderTax ?? 0 : 0);
    const payment = seat.kind === "human" ? payCostFromPool(poolForSeat(seatId), card, totalCost) : chooseManaSourcesForCost(seat, card, totalCost);
    const availableMana = seat.kind === "human" ? manaPoolTotal(poolForSeat(seatId)) : selectedManaTotal(seat, payment.sourceIds);
    if (!payment.ok) {
      addEvent(cannotPayMessage(seat, card, availableMana, totalCost, payment.reason), seatId, "Mana");
      setSelectedHandCardId(undefined);
      return;
    }

    if (seat.kind === "human") {
      setSeatManaPool(seatId, payment.pool);
    }

    const spentManaText = seat.kind === "human" && payment.ok ? ` spending ${formatManaPoolPayment(payment.spent)}` : ` using ${availableMana} mana`;
    const action: PendingAction = {
      id: crypto.randomUUID(),
      type: "spell",
      actorSeatId: seatId,
      cardId,
      cardName: card.name,
      sourceZone,
      manaSourceIds: payment.sourceIds,
      position,
      message: `${seat.name} casts ${card.name}${sourceZone === "command" ? " from the command zone" : ""}${spentManaText}.`
    };
    beginPendingAction(action, "Stack");
    setSelectedHandCardId(undefined);
  }

  function beginPendingAction(action: PendingAction, detail: string) {
    const requiredPasses = pendingActionRequiredPasses(session.seats, action, manaPools);
    pushStackAction(action);
    setSession((current) => ({
      ...current,
      events: [
        {
          id: action.id,
          at: new Date().toISOString(),
          seatId: action.actorSeatId,
          message:
            detail === "Stack" && action.type === "spell"
              ? `${action.message} ${requiredPasses.length > 0 ? "Waiting for responses." : "No available responses."}`
              : `${action.message}${requiredPasses.length > 0 ? "" : " No available responses."}`,
          detail
        },
        ...current.events
      ]
    }));

    if (requiredPasses.length === 0) {
      window.setTimeout(() => resolvePendingAction(action), 0);
      return;
    }

    setPendingAction(action);
    setPriorityPasses([]);
    setPrioritySeatId(nextPrioritySeatId(session.seats, action.actorSeatId, [], action, manaPools));
  }

  function respondWithSelectedCard() {
    if (!pendingAction || prioritySeatId !== humanSeat.id || !selectedHandCardId) return;
    const card = humanSeat.board.hand.find((item) => item.id === selectedHandCardId);
    if (!card) return;
    if (!canCastAtInstantSpeed(card)) {
      addEvent(`${humanSeat.name} cannot respond with ${card.name}; it is not playable at instant speed.`, humanSeat.id, "Mana");
      return;
    }
    const manaSourceIds: string[] = [];
    const adjustedCost = adjustedCastingCost(humanSeat, card, card.manaValue, "hand", activeSeatId);
    const payment = payCostFromPool(poolForSeat(humanSeat.id), card, adjustedCost);
    const availableMana = manaPoolTotal(poolForSeat(humanSeat.id));
    if (!isLandCard(card) && !payment.ok) {
      addEvent(cannotPayMessage(humanSeat, card, availableMana, adjustedCost, payment.reason), humanSeat.id, "Mana");
      return;
    }
    if (!isLandCard(card)) {
      setSeatManaPool(humanSeat.id, payment.pool);
    }
    const action: PendingAction = {
      id: crypto.randomUUID(),
      type: "spell",
      actorSeatId: humanSeat.id,
      cardId: selectedHandCardId,
      cardName: card.name,
      manaSourceIds,
      message: `${humanSeat.name} responds with ${card.name}.`
    };
    setSelectedHandCardId(undefined);
    beginPendingAction(action, "Stack");
  }

  function resolvePendingTrigger() {
    if (!pendingAction || pendingAction.type !== "trigger" || prioritySeatId !== pendingAction.controllerSeatId) return;
    const trigger = pendingAction;
    setPendingAction(undefined);
    setPriorityPasses([]);
    const remainingStack = removeStackAction(trigger.id);
    setSession((current) => drawForSeat(current, trigger.controllerSeatId, `${trigger.sourceCardName} trigger resolves. ${current.seats.find((seat) => seat.id === trigger.controllerSeatId)?.name ?? "Player"} draws a card.`));
    if (trigger.parentAction) {
      window.setTimeout(() => beginPendingAction(trigger.parentAction!, "Stack"), 0);
    } else {
      resumeTopStackAction(remainingStack);
    }
  }

  function resolvePendingAction(action: PendingAction) {
    setPendingAction(undefined);
    setPriorityPasses([]);
    if (action.type === "phase") {
      setSession((current) => resolvePhaseAdvance(current));
      return;
    }

    if (action.type === "trigger") {
      const remainingStack = removeStackAction(action.id);
      if (action.parentAction) {
        beginPendingAction(action.parentAction, "Stack");
      } else {
        resumeTopStackAction(remainingStack);
      }
      return;
    }

    const trigger = action.triggersChecked ? undefined : findTriggeredAbilityForSpell(session, action);
    if (trigger) {
      const checkedAction = { ...action, triggersChecked: true };
      updateStackAction(checkedAction);
      beginPendingAction({ ...trigger, parentAction: checkedAction }, "Trigger");
      return;
    }

    const remainingStack = removeStackAction(action.id);
    const destination = spellResolutionDestination(session, action);
    const sourceCard = findSpellSourceCard(session, action);
    setSession((current) =>
      playCardFromZone(current, action.actorSeatId, action.cardId, `${action.cardName} resolves.`, action.position, destination, action.manaSourceIds, action.sourceZone ?? "hand")
    );
    if (sourceCard) {
      void consultRulesAdvisor(destination === "battlefield" ? "spell_resolved_to_battlefield" : "spell_resolved_to_graveyard", action.actorSeatId, sourceCard);
    }
    if (!resumeTopStackAction(remainingStack)) {
      setPrioritySeatId(action.actorSeatId);
    }
  }

  function addEvent(message: string, seatId?: string, detail?: string) {
    setSession((current) => ({
      ...current,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message,
          detail
        },
        ...current.events
      ]
    }));
  }

  async function consultRulesAdvisor(event: string, seatId: string, sourceCard: VisibleCard) {
    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat || !shouldConsultRulesAdvisor(event, sourceCard)) return;

    try {
      const response = await fetch("/api/rules/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event,
          actorName: seat.name,
          sourceCard,
          battlefield: seat.board.battlefield,
          hand: seat.board.hand,
          graveyard: seat.board.graveyard ?? [],
          exile: seat.board.exile ?? [],
          libraryPreview: (seat.library ?? []).slice(0, 12).map((card) => ({
            id: card.id,
            name: card.name,
            typeLine: card.typeLine,
            oracleText: card.oracleText
          }))
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = (await response.json()) as { source: "deterministic" | "ollama" | "fallback"; workflow: RuleWorkflow };
      applyRuleWorkflow(seatId, sourceCard, result.workflow, result.source);
    } catch (error) {
      addEvent(
        `Rules advisor could not check ${sourceCard.name}: ${error instanceof Error ? error.message : "unknown error"}.`,
        seatId,
        "Rules advisor"
      );
    }
  }

  function applyRuleWorkflow(seatId: string, sourceCard: VisibleCard, workflow: RuleWorkflow, source: "deterministic" | "ollama" | "fallback") {
    if (workflow.workflow === "none") return;

    const seat = session.seats.find((item) => item.id === seatId);
    const isHuman = seat?.kind === "human";
    addEvent(`Rules advisor (${source}): ${workflow.summary}`, seatId, "Rules advisor");

    if (!isHuman) return;

    if (workflow.workflow === "search_basic_lands_shared_type_to_battlefield_tapped") {
      setInspectedCard(undefined);
      setMyriadSearch({ seatId, sourceCardId: workflow.sourceCardId ?? sourceCard.id });
      return;
    }

    if (workflow.workflow === "search_library_to_hand" || workflow.workflow === "search_library_to_battlefield") {
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_card_from_library",
        controllerSeatId: seatId,
        sourceCardId: workflow.sourceCardId ?? sourceCard.id,
        sourceCardName: sourceCard.name,
        prompt: workflow.summary,
        destination: workflow.destination === "battlefield" || workflow.workflow === "search_library_to_battlefield" ? "battlefield" : "hand",
        tapped: workflow.tapped,
        maxChoices: Math.max(1, workflow.maxChoices || 1),
        allowedCardFilter: workflow.allowedCardFilter
      });
      return;
    }

    if (workflow.workflow === "draw_cards") {
      const count = Math.max(1, workflow.maxChoices || 1);
      setSession((current) => drawMultipleForSeat(current, seatId, count, `${seat?.name ?? "Player"} draws ${count} from ${sourceCard.name}.`));
      return;
    }

    if (workflow.workflow === "scry_cards" || workflow.workflow === "surveil_cards" || workflow.workflow === "look_at_top_cards" || workflow.workflow === "reorder_top_cards") {
      const count = Math.max(1, workflow.maxChoices || 1);
      const lookWorkflow = workflow.workflow;
      if (isHuman) {
        startLibraryLook(lookWorkflow === "surveil_cards" ? "surveil" : lookWorkflow === "reorder_top_cards" ? "reorder" : "scry", count);
        return;
      }
      setSession((current) => resolveAgentLibraryLookWorkflow(current, seatId, sourceCard.name, lookWorkflow === "reorder_top_cards" ? "look_at_top_cards" : lookWorkflow, count));
      return;
    }

    if (workflow.workflow === "manual_review") {
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "manual_review",
        controllerSeatId: seatId,
        sourceCardId: workflow.sourceCardId ?? sourceCard.id,
        sourceCardName: sourceCard.name,
        prompt: workflow.summary
      });
    }
  }

  function hasPlayedLandThisTurn(seatId: string, turn: number) {
    return landPlaysThisTurn.current.has(landTurnKey(seatId, turn));
  }

  function changeLife(seatId: string, delta: number) {
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) => (seat.id === seatId ? { ...seat, life: Math.max(0, seat.life + delta) } : seat)),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${current.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} ${delta > 0 ? "gains" : "loses"} ${Math.abs(delta)} life.`
        },
        ...current.events
      ]
    }));
  }

  function moveCardToGraveyard(seatId: string, cardId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.hand.find((item) => item.id === cardId) ?? seat?.board.battlefield.find((item) => item.id === cardId) ?? seat?.board.exile?.find((item) => item.id === cardId);
    setSelectedHandCardId(undefined);
    setInspectedCard(undefined);
    setSession((current) => moveCardBetweenVisibleZones(current, seatId, cardId, "graveyard"));
    if (card) void consultRulesAdvisor("card_moved_to_graveyard", seatId, card);
  }

  function moveCardToExile(seatId: string, cardId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card =
      seat?.board.hand.find((item) => item.id === cardId) ??
      seat?.board.battlefield.find((item) => item.id === cardId) ??
      seat?.board.graveyard?.find((item) => item.id === cardId);
    setSelectedHandCardId(undefined);
    setInspectedCard(undefined);
    setSession((current) => moveCardBetweenVisibleZones(current, seatId, cardId, "exile"));
    if (card) void consultRulesAdvisor("card_moved_to_exile", seatId, card);
  }

  function moveCardToHand(seatId: string, cardId: string) {
    setSession((current) => moveCardBetweenVisibleZones(current, seatId, cardId, "hand"));
  }

  function moveBattlefieldCard(seatId: string, cardId: string, position: { x: number; z: number }) {
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) =>
        seat.id === seatId
          ? {
              ...seat,
              board: {
                ...seat.board,
                battlefield: seat.board.battlefield.map((card) => (card.id === cardId ? { ...card, battlefieldPosition: position } : card))
              }
            }
          : seat
      )
    }));
  }

  function changeCounter(seatId: string, cardId: string, kind: string, delta: number) {
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) =>
        seat.id === seatId
          ? {
              ...seat,
              board: {
                ...seat.board,
                battlefield: seat.board.battlefield.map((card) => (card.id === cardId ? applyCounterDelta(card, kind, delta) : card))
              }
            }
          : seat
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${current.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} ${delta > 0 ? "adds" : "removes"} a ${kind} counter ${delta > 0 ? "to" : "from"} ${
            current.seats.find((seat) => seat.id === seatId)?.board.battlefield.find((card) => card.id === cardId)?.name ?? "a creature"
          }.`
        },
        ...current.events
      ]
    }));
  }

  function castCommander(seatId: string, position?: { x: number; z: number }) {
    const seat = session.seats.find((item) => item.id === seatId);
    const commander = seat?.board.commander;
    if (!seat || !commander) return;
    playCard(seatId, commander.id, position, "command");
  }

  function resolveMyriadLandscape(seatId: string, cardId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    setInspectedCard(undefined);
    if (card) {
      void consultRulesAdvisor("activated_ability", seatId, card);
      return;
    }
    setMyriadSearch({ seatId, sourceCardId: cardId });
  }

  function completeMyriadLandscape(cardIds: string[]) {
    const activeSearch = myriadSearch;
    if (!activeSearch) return;
    setSession((current) => resolveMyriadLandscapeSearch(current, activeSearch.seatId, activeSearch.sourceCardId, cardIds));
    setMyriadSearch(undefined);
  }

  function startLibraryLook(mode: LibraryLookMode, count: number) {
    setSession((current) => {
      const seat = current.seats.find((item) => item.id === humanSeat.id);
      const cards = (seat?.library ?? []).slice(0, mode === "scry" ? 1 : count);
      setLibraryLook({ seatId: humanSeat.id, mode, cards, remaining: count, orderedCards: mode === "reorder" ? [] : undefined });
      return {
        ...current,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: humanSeat.id,
            message:
              mode === "scry"
                ? `${humanSeat.name} starts scry ${count}.`
                : mode === "reorder"
                  ? `${humanSeat.name} looks at the top ${cards.length} card${cards.length === 1 ? "" : "s"} and will put them back in any order.`
                  : `${humanSeat.name} looks at the top ${cards.length} card${cards.length === 1 ? "" : "s"} to ${mode}.`
          },
          ...current.events
        ]
      };
    });
  }

  function chooseRuleLibraryCard(cardId: string) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_card_from_library") return;
    completeRuleChoice(choice, [cardId]);
  }

  function completeRuleChoice(choice: PendingRuleChoice, cardIds: string[]) {
    if (choice.kind === "choose_card_from_library") {
      const selectedIds = cardIds.slice(0, choice.maxChoices);
      setSession((current) => selectedIds.reduce((next, cardId) => moveLibraryCardToDestination(next, choice.controllerSeatId, cardId, choice.destination, Boolean(choice.tapped)), current));
      setPendingRuleChoice(undefined);
      return;
    }

    if (choice.kind === "order_triggers") {
      resolveOrderedPhaseTriggers(choice.controllerSeatId, [...choice.orderedTriggers, ...choice.triggers]);
      setPendingRuleChoice(undefined);
      return;
    }

    addEvent(`Rules choice reviewed for ${choice.sourceCardName}.`, choice.controllerSeatId, "Rules advisor");
    setPendingRuleChoice(undefined);
  }

  function chooseNextUpkeepTrigger(sourceCardId: string) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "order_triggers") return;
    const trigger = choice.triggers.find((item) => item.sourceCardId === sourceCardId);
    if (!trigger) return;
    const remaining = choice.triggers.filter((item) => item.sourceCardId !== sourceCardId);
    const orderedTriggers = [...choice.orderedTriggers, trigger];
    if (remaining.length > 0) {
      setPendingRuleChoice({ ...choice, triggers: remaining, orderedTriggers });
      return;
    }
    setPendingRuleChoice(undefined);
    resolveOrderedPhaseTriggers(choice.controllerSeatId, orderedTriggers);
  }

  function resolveOrderedPhaseTriggers(seatId: string, triggers: Array<{ sourceCardId: string; sourceCardName: string; text: string }>) {
    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat) return;
    addEvent(`${seat.name} orders ${session.phase} triggers: ${triggers.map((trigger) => trigger.sourceCardName).join(" -> ")}.`, seatId, "Rules advisor");
    for (const trigger of triggers) {
      const card = seat.board.battlefield.find((item) => item.id === trigger.sourceCardId);
      if (card) void consultRulesAdvisor(TURN_PHASES.includes(session.phase as TurnPhase) ? phaseEventName(session.phase as TurnPhase) : "phase_trigger", seatId, card);
    }
  }

  function cancelRuleChoice() {
    if (pendingRuleChoice) {
      addEvent(`No rule choice was made for ${ruleChoiceLabel(pendingRuleChoice)}.`, pendingRuleChoice.controllerSeatId, "Rules advisor");
    }
    setPendingRuleChoice(undefined);
  }

  function resolveAgentRuleChoice(choice: PendingRuleChoice) {
    const seat = session.seats.find((item) => item.id === choice.controllerSeatId);
    if (!seat) return;
    if (choice.kind === "choose_card_from_library") {
      const card = chooseAgentLibraryCardForRuleChoice(seat, choice);
      if (!card) {
        addEvent(`${seat.name} has no available library choice for ${choice.sourceCardName}.`, seat.id, "Rules advisor");
        setPendingRuleChoice(undefined);
        return;
      }
      addEvent(`${seat.name} chooses ${card.name} for ${choice.sourceCardName}.`, seat.id, "Rules advisor");
      completeRuleChoice(choice, [card.id]);
      return;
    }
    if (choice.kind === "order_triggers") {
      const ordered = [...choice.orderedTriggers, ...choice.triggers];
      setPendingRuleChoice(undefined);
      resolveOrderedPhaseTriggers(choice.controllerSeatId, ordered);
      return;
    }
    addEvent(`${seat.name} passes manual review for ${choice.sourceCardName}.`, seat.id, "Rules advisor");
    setPendingRuleChoice(undefined);
  }

  function searchLibraryCardToHand(cardId: string) {
    setSession((current) => {
      const seat = current.seats.find((item) => item.id === humanSeat.id);
      const card = seat?.library?.find((item) => item.id === cardId);
      if (!seat || !card) return current;
      return {
        ...current,
        seats: current.seats.map((item) =>
          item.id === humanSeat.id
            ? {
                ...item,
                library: (item.library ?? []).filter((libraryCard) => libraryCard.id !== cardId),
                board: {
                  ...item.board,
                  hand: [...item.board.hand, { ...card, zone: "hand" as const }]
                },
                zones: {
                  ...item.zones,
                  hand: item.zones.hand + 1,
                  library: Math.max(0, item.zones.library - 1)
                }
              }
            : item
        ),
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: humanSeat.id,
            message: `${humanSeat.name} searches their library for ${card.name} and puts it into hand.`
          },
          ...current.events
        ]
      };
    });
    setManualLibrarySearch(undefined);
  }

  function keepLibraryLookCardOnTop(cardId: string) {
    const activeLook = libraryLook;
    if (!activeLook) return;
    if (activeLook.mode === "scry") {
      setSession((current) => addLibraryLookEvent(current, activeLook.seatId, `${current.seats.find((seat) => seat.id === activeLook.seatId)?.name ?? "Player"} keeps ${activeLook.cards.find((card) => card.id === cardId)?.name ?? "that card"} on top and finishes scrying.`));
      setLibraryLook(undefined);
      return;
    }

    setSession((current) => moveLibraryCard(current, activeLook.seatId, cardId, "top"));
    setLibraryLook((current) => {
      if (!current) return current;
      const cards = current.cards.filter((card) => card.id !== cardId);
      return cards.length > 0 ? { ...current, cards } : undefined;
    });
  }

  function putLibraryLookCardOnBottom(cardId: string) {
    const activeLook = libraryLook;
    if (!activeLook) return;
    if (activeLook.mode === "scry") {
      const nextRemaining = Math.max(0, activeLook.remaining - 1);
      setSession((current) => {
        const moved = moveLibraryCard(current, activeLook.seatId, cardId, "bottom");
        const seat = moved.seats.find((item) => item.id === activeLook.seatId);
        const nextCard = nextRemaining > 0 ? (seat?.library ?? [])[0] : undefined;
        setLibraryLook(nextCard ? { seatId: activeLook.seatId, mode: "scry", cards: [nextCard], remaining: nextRemaining } : undefined);
        return moved;
      });
      return;
    }

    setLibraryLook((current) => {
      if (!current) return current;
      const cards = current.cards.filter((card) => card.id !== cardId);
      return cards.length > 0 ? { ...current, cards } : undefined;
    });
  }

  function putLibraryLookCardInGraveyard(cardId: string) {
    const activeLook = libraryLook;
    if (!activeLook || activeLook.mode !== "surveil") return;
    setSession((current) => moveLibraryCard(current, activeLook.seatId, cardId, "graveyard"));
    setLibraryLook((current) => {
      if (!current) return current;
      const cards = current.cards.filter((card) => card.id !== cardId);
      return cards.length > 0 ? { ...current, cards } : undefined;
    });
  }

  function orderLibraryLookCardOnTop(cardId: string) {
    const activeLook = libraryLook;
    if (!activeLook || activeLook.mode !== "reorder") return;
    const card = activeLook.cards.find((item) => item.id === cardId);
    if (!card) return;
    const orderedCards = [...(activeLook.orderedCards ?? []), card];
    const remainingCards = activeLook.cards.filter((item) => item.id !== cardId);
    if (remainingCards.length > 0) {
      setLibraryLook({ ...activeLook, cards: remainingCards, orderedCards });
      return;
    }
    setSession((current) => reorderTopLibraryCards(current, activeLook.seatId, orderedCards));
    setLibraryLook(undefined);
  }

  function toggleTapCard(seatId: string, cardId: string, location: "battlefield" | "command") {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = location === "command" ? seat?.board.commander : seat?.board.battlefield.find((item) => item.id === cardId);
    if (seat && card && !card.tapped && isAvailableManaSource(card)) {
      const choices = manaChoicesForCard(card, seat);
      if (choices.length > 1) {
        setManaChoice({ seatId, cardId, cardName: card.name, location, choices });
        return;
      }
      tapForMana(seatId, cardId, location, choices[0] ?? "C");
      return;
    }

    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) => {
        if (seat.id !== seatId) return seat;
        const nextCommander =
          location === "command" && seat.board.commander?.id === cardId
            ? { ...seat.board.commander, tapped: !seat.board.commander.tapped }
            : seat.board.commander;
        const nextBattlefield =
          location === "battlefield"
            ? seat.board.battlefield.map((card) => (card.id === cardId ? { ...card, tapped: !card.tapped } : card))
            : seat.board.battlefield;

        return {
          ...seat,
          board: {
            ...seat.board,
            commander: nextCommander,
            battlefield: nextBattlefield
          }
        };
      })
    }));
    setInspectedCard((current) => (current?.id === cardId ? { ...current, tapped: !current.tapped } : current));
  }

  function tapForMana(seatId: string, cardId: string, location: "battlefield" | "command", color: ManaColor) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = location === "command" ? seat?.board.commander : seat?.board.battlefield.find((item) => item.id === cardId);
    if (!seat || !card || card.tapped || !isAvailableManaSource(card)) return;
    setSession((current) => tapVisibleCard(current, seatId, cardId, location));
    const amount = manaProducedBy(card);
    setManaPools((current) => {
      const pool = current[seatId] ?? emptyManaPool();
      return { ...current, [seatId]: addManaToPool(pool, color, amount) };
    });
    addEvent(`${seat.name} taps ${card.name} for ${amount > 1 ? amount : ""}${color}.`, seatId, "Mana");
    setInspectedCard((current) => (current?.id === cardId ? { ...current, tapped: true } : current));
    setManaChoice(undefined);
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
              {setupMessage ? <p className="setup-play-message">{setupMessage}</p> : null}
            </div>
            <button className="play-button" disabled={playBlockedByBuild} type="button" onClick={startGame}>
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
        mulliganReturnCardIds={mulliganReturnCardIds}
        mulliganReturnRequired={Math.max(0, humanSeat.board.hand.length - openingHandKeepSize(mulligans[humanSeat.id] ?? 0))}
        session={{ ...session, activePlayerId: activeSeatId }}
        prioritySeatId={prioritySeatId}
        pendingAction={pendingAction}
        stackActions={stackActions}
        manaPool={poolForSeat(humanSeat.id)}
        manaChoice={manaChoice?.seatId === humanSeat.id ? manaChoice : undefined}
        blockChoice={blockChoiceView(session, blockChoice)}
        selectedCardCanRespond={selectedCardCanRespond}
        onKeepHand={keepOpeningHand}
        onMulligan={mulliganOpeningHand}
        onToggleMulliganReturnCard={toggleMulliganReturnCard}
        onAdvanceTurn={advanceTurn}
        onEndTurn={endTurn}
        onDrawCard={drawCard}
        onInspectCard={setInspectedCard}
        onCloseInspectCard={() => setInspectedCard(undefined)}
        onPassPriority={passPriority}
        onPlayCard={playCard}
        onRespond={openResponseWindow}
        onRespondWithSelectedCard={respondWithSelectedCard}
        onResolvePendingTrigger={resolvePendingTrigger}
        onChooseBlocker={chooseHumanBlocker}
        onPassBlocks={passHumanBlocks}
        onPayCumulativeUpkeep={payCumulativeUpkeep}
        onSacrificeRuleSource={sacrificeRuleChoiceSource}
        onShuffleLibrary={shuffleLibrary}
        onOpenLibrarySearch={() => setManualLibrarySearch({ seatId: humanSeat.id, destination: "hand" })}
        onMoveCardToGraveyard={moveCardToGraveyard}
        onMoveCardToExile={moveCardToExile}
        onMoveCardToHand={moveCardToHand}
        onMoveBattlefieldCard={moveBattlefieldCard}
        onChangeCounter={changeCounter}
        onCastCommander={castCommander}
        onResolveMyriadLandscape={resolveMyriadLandscape}
        onChangeLife={changeLife}
        onScry={(count) => startLibraryLook("scry", count)}
        onSurveil={(count) => startLibraryLook("surveil", count)}
        libraryLook={libraryLook}
        ruleChoice={ruleChoiceView(pendingRuleChoice, humanSeat, manualLibrarySearch)}
        myriadSearchCards={myriadSearch ? getMyriadLandscapeOptions(humanSeat.library ?? []) : undefined}
        onCloseLibrarySearch={() => {
          setManualLibrarySearch(undefined);
          if (pendingRuleChoice?.controllerSeatId === humanSeat.id) cancelRuleChoice();
        }}
        onChooseNextTrigger={chooseNextUpkeepTrigger}
        onSearchLibraryCardToHand={(cardId) => {
          if (pendingRuleChoice?.controllerSeatId === humanSeat.id) {
            chooseRuleLibraryCard(cardId);
            return;
          }
          searchLibraryCardToHand(cardId);
        }}
        onCloseMyriadSearch={() => setMyriadSearch(undefined)}
        onCompleteMyriadSearch={completeMyriadLandscape}
        onKeepLibraryLookCardOnTop={keepLibraryLookCardOnTop}
        onOrderLibraryLookCardOnTop={orderLibraryLookCardOnTop}
        onPutLibraryLookCardOnBottom={putLibraryLookCardOnBottom}
        onPutLibraryLookCardInGraveyard={putLibraryLookCardInGraveyard}
        onCloseLibraryLook={() => setLibraryLook(undefined)}
        onSelectHandCard={(card) => setSelectedHandCardId((current) => (current === card.id ? undefined : card.id))}
        onToggleTapCard={toggleTapCard}
        onChooseMana={(color) => manaChoice && tapForMana(manaChoice.seatId, manaChoice.cardId, manaChoice.location, color)}
        onCancelManaChoice={() => setManaChoice(undefined)}
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
      <label>
        Deck list
        <textarea
          className="decklist-input"
          value={config.deckList}
          onChange={(event) => onUpdate(config.seatId, { deck: undefined, deckList: event.target.value, mode: "decklist", status: "empty" })}
          placeholder={"Commander: Atraxa, Praetors' Voice\n1 Sol Ring\n1 Arcane Signet\n1 Command Tower\n1 Swords to Plowshares\n1 Beast Within\n...continue to 100 cards"}
        />
      </label>
      <button type="button" disabled={config.status === "building"} onClick={() => onBuild(config)}>
        {config.status === "building" ? "Building..." : config.kind === "agent" ? "Build AI Deck" : "Validate Deck"}
      </button>
      <div className="setup-result">
        <span>{config.message}</span>
        {config.deck ? (
          <>
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
            {config.deck.validation.errors.length > 0 ? (
              <ul className="setup-errors" aria-label={`${config.name} deck validation errors`}>
                {config.deck.validation.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            ) : null}
            {config.activity.length > 0 ? (
              <ul className="agent-activity" aria-label={`${config.name} agent activity`}>
                {config.activity.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </>
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
    deck: seat.deck,
    status: seat.deck?.validation.legal ? "ready" : "empty",
    message: seat.deck?.validation.legal ? "Deck is ready for play." : seat.kind === "human" ? "Default deck will validate automatically." : "Choose a commander or paste a deck list.",
    activity: []
  }));
}

function formatDeckList(deck: CommanderDeck) {
  const commander = deck.cards.find((card) => card.role === "commander")?.name ?? deck.commander;
  const cards = deck.cards.filter((card) => card.role !== "commander");
  return [`Commander: ${commander}`, ...cards.map((card) => `${card.count} ${card.name}`)].join("\n");
}

function validateConfigsForPlay(configs: SeatConfig[]) {
  let ready = true;
  const nextConfigs = configs.map((config) => {
    const deck =
      config.deck ??
      (config.mode === "decklist"
        ? createDeckFromList({
            owner: config.name,
            commander: config.commander,
            deckList: config.deckList,
            colors: inferColors(config.commander)
          })
        : undefined);
    const errors = deck?.validation.errors ?? ["Build or validate this deck before pressing Play."];

    if (!deck || errors.length > 0 || !deck.validation.legal) {
      ready = false;
      return {
        ...config,
        deck: deck ?? config.deck,
        status: "error" as DeckBuildStatus,
        message: errors[0] ?? "Deck is not legal for Commander."
      };
    }

    return {
      ...config,
      deck: config.deck ?? deck,
      status: "ready" as DeckBuildStatus,
      message: "Deck passed Commander validation."
    };
  });

  return { ready, configs: nextConfigs };
}

function applyDeckToSeat(seat: PlayerSeat, deck: CommanderDeck): PlayerSeat {
  const commander = createCommanderCard(deck, seat.board.commander);
  return {
    ...seat,
    deck,
    life: 40,
    commanderDamage: {},
    library: [],
    board: {
      ...seat.board,
      commander,
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: []
    },
    zones: {
      ...seat.zones,
      battlefield: 0,
      graveyard: 0,
      hand: 0,
      exile: 0,
      command: 1
    }
  };
}

function createCommanderCard(deck: CommanderDeck, existing?: VisibleCard): VisibleCard {
  const card = deck.commanderCard;
  return {
    id: existing?.id ?? crypto.randomUUID(),
    name: card?.name ?? deck.commander,
    typeLine: card?.typeLine ?? existing?.typeLine ?? "Legendary Creature - Commander",
    oracleText: card?.oracleText ?? existing?.oracleText ?? "AI-selected commander. Full card text will come from card data lookup in the next integration pass.",
    manaCost: card?.manaCost ?? existing?.manaCost,
    manaValue: card?.manaValue ?? existing?.manaValue ?? 4,
    colors: card?.colors ?? deck.colors,
    colorIdentity: card?.colorIdentity ?? deck.colors,
    producedMana: card?.producedMana ?? existing?.producedMana,
    imageUris: card?.imageUris,
    faces: card?.faces,
    role: "commander",
    zone: "command",
    commander: true,
    commanderTax: existing?.commanderTax ?? 0,
    power: card?.power ?? existing?.power ?? "3",
    toughness: card?.toughness ?? existing?.toughness ?? "4",
    tapped: existing?.tapped,
    summoningSick: existing?.summoningSick,
    counters: existing?.counters
  };
}

function canAttack(card: VisibleCard) {
  return card.typeLine.includes("Creature") && !card.tapped && !card.summoningSick;
}

function canBlock(card: VisibleCard) {
  return card.typeLine.includes("Creature") && !card.tapped;
}

function applyCounterDelta(card: VisibleCard, kind: string, delta: number): VisibleCard {
  const counters = card.counters ?? [];
  const existing = counters.find((counter) => counter.kind === kind);
  const nextCount = Math.max(0, (existing?.count ?? 0) + delta);
  const nextCounters =
    nextCount === 0
      ? counters.filter((counter) => counter.kind !== kind)
      : existing
        ? counters.map((counter) => (counter.kind === kind ? { ...counter, count: nextCount } : counter))
        : [...counters, { kind, count: nextCount }];
  return { ...card, counters: nextCounters };
}

function isCumulativeUpkeepCard(card: VisibleCard) {
  return /\bcumulative upkeep\b/i.test(card.oracleText);
}

function cumulativeUpkeepCost(card: VisibleCard) {
  const ageCounters = card.counters?.find((counter) => counter.kind === "age")?.count ?? 0;
  const text = card.oracleText.toLowerCase();
  const genericMatch = text.match(/cumulative upkeep\s*\{(\d+)\}/);
  const base = genericMatch ? Number.parseInt(genericMatch[1], 10) : 1;
  return Math.max(1, base) * (ageCounters + 1);
}

function createHumanBlockChoice(session: GameSession, attackerSeatId: string): BlockChoiceState | undefined {
  const attackerIndex = session.seats.findIndex((seat) => seat.id === attackerSeatId);
  const attacker = session.seats[attackerIndex];
  const defender = session.seats[(attackerIndex + 1) % session.seats.length];
  const attackingCard = attacker?.board.battlefield.find((card) => card.attacking);
  if (!attacker || !defender || defender.kind !== "human" || !attackingCard) return undefined;
  return {
    attackerSeatId: attacker.id,
    defenderSeatId: defender.id,
    attackerCardId: attackingCard.id
  };
}

function resolveHumanBlock(session: GameSession, choice: BlockChoiceState, blockerCardId: string): GameSession {
  const attacker = session.seats.find((seat) => seat.id === choice.attackerSeatId);
  const defender = session.seats.find((seat) => seat.id === choice.defenderSeatId);
  const attackingCard = attacker?.board.battlefield.find((card) => card.id === choice.attackerCardId && card.attacking);
  const blocker = defender?.board.battlefield.find((card) => card.id === blockerCardId && canBlock(card));
  if (!attacker || !defender || !attackingCard || !blocker) return resolveHumanUnblockedDamage(session, choice);

  return {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === defender.id
        ? {
            ...seat,
            board: {
              ...seat.board,
              battlefield: seat.board.battlefield.map((card) => (card.id === blocker.id ? { ...card, blocking: true } : card))
            }
          }
        : seat
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: defender.id,
        message: `${defender.name} blocks ${attackingCard.name} with ${blocker.name}.`,
        detail: "Phase change"
      },
      ...session.events
    ]
  };
}

function resolveHumanUnblockedDamage(session: GameSession, choice: BlockChoiceState): GameSession {
  const attacker = session.seats.find((seat) => seat.id === choice.attackerSeatId);
  const defender = session.seats.find((seat) => seat.id === choice.defenderSeatId);
  const attackingCard = attacker?.board.battlefield.find((card) => card.id === choice.attackerCardId && card.attacking);
  if (!attacker || !defender || !attackingCard) return session;
  return {
    ...session,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: attacker.id,
        message: `${defender.name} declares no blockers for ${attackingCard.name}.`,
        detail: "Phase change"
      },
      ...session.events
    ]
  };
}

function findTriggeredAbilityForSpell(session: GameSession, action: Extract<PendingAction, { type: "spell" }>): Extract<PendingAction, { type: "trigger" }> | undefined {
  const actor = session.seats.find((seat) => seat.id === action.actorSeatId);
  const spell = actor?.board.hand.find((card) => card.id === action.cardId);
  if (!actor || !spell || spell.typeLine.includes("Creature")) return undefined;

  for (const seat of session.seats) {
    if (seat.id === action.actorSeatId) continue;
    const source = seat.board.battlefield.find((card) => isMysticRemoraLike(card));
    if (!source) continue;
    return {
      id: crypto.randomUUID(),
      type: "trigger",
      actorSeatId: action.actorSeatId,
      controllerSeatId: seat.id,
      sourceCardId: source.id,
      sourceCardName: source.name,
      triggerKind: "draw",
      parentAction: { ...action, triggersChecked: true },
      message: `${source.name} triggers because ${actor.name} cast noncreature spell ${spell.name}.`
    };
  }

  return undefined;
}

function findSpellSourceCard(session: GameSession, action: Extract<PendingAction, { type: "spell" }>) {
  const actor = session.seats.find((seat) => seat.id === action.actorSeatId);
  return action.sourceZone === "command" ? actor?.board.commander : actor?.board.hand.find((card) => card.id === action.cardId);
}

function ruleChoiceView(choice: PendingRuleChoice | undefined, humanSeat: PlayerSeat, manualSearch: ManualLibrarySearchState | undefined) {
  if (choice?.controllerSeatId === humanSeat.id) {
    if (choice.kind === "choose_card_from_library") {
      return {
        kind: "choose_card_from_library" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        cards: humanSeat.library ?? [],
        destination: choice.destination,
        allowedCardFilter: choice.allowedCardFilter
      };
    }
    if (choice.kind === "order_triggers") {
      return {
        kind: "order_triggers" as const,
        prompt: choice.prompt,
        triggers: choice.triggers,
        orderedTriggers: choice.orderedTriggers
      };
    }
    const source = humanSeat.board.battlefield.find((card) => card.id === choice.sourceCardId);
    return {
      kind: "manual_review" as const,
      sourceCardId: choice.sourceCardId,
      sourceCardName: choice.sourceCardName,
      prompt: choice.prompt,
      isCumulativeUpkeep: source ? isCumulativeUpkeepCard(source) : false,
      cumulativeUpkeepCost: source && isCumulativeUpkeepCard(source) ? cumulativeUpkeepCost(source) : undefined
    };
  }

  if (manualSearch?.seatId === humanSeat.id) {
    return {
      kind: "choose_card_from_library" as const,
      sourceCardName: "Manual Search",
      prompt: "Choose a card from your library.",
      cards: humanSeat.library ?? [],
      destination: manualSearch.destination
    };
  }

  return undefined;
}

function blockChoiceView(session: GameSession, choice: BlockChoiceState | undefined) {
  if (!choice) return undefined;
  const attacker = session.seats.find((seat) => seat.id === choice.attackerSeatId);
  const defender = session.seats.find((seat) => seat.id === choice.defenderSeatId);
  const attackingCard = attacker?.board.battlefield.find((card) => card.id === choice.attackerCardId && card.attacking);
  if (!attacker || !defender || !attackingCard) return undefined;
  return {
    attackerName: attacker.name,
    defenderName: defender.name,
    attackingCard,
    blockers: defender.board.battlefield.filter((card) => canBlock(card))
  };
}

function ruleChoiceLabel(choice: PendingRuleChoice) {
  if (choice.kind === "order_triggers") return "phase triggers";
  return choice.sourceCardName;
}

function chooseAgentLibraryCardForRuleChoice(seat: PlayerSeat, choice: Extract<PendingRuleChoice, { kind: "choose_card_from_library" }>) {
  const library = seat.library ?? [];
  if (library.length === 0) return undefined;
  const filter = choice.allowedCardFilter?.toLowerCase() ?? "";
  if (filter.includes("basic land")) {
    return library.find((card) => isBasicLandCard(card)) ?? library[0];
  }
  if (choice.destination === "battlefield") {
    return library.find((card) => card.typeLine.includes("Creature")) ?? library.find((card) => !card.typeLine.includes("Instant") && !card.typeLine.includes("Sorcery")) ?? library[0];
  }
  return library.find((card) => !isLandCard(card)) ?? library[0];
}

function shouldConsultRulesAdvisor(event: string, card: VisibleCard) {
  if (event === "activated_ability") return true;
  const text = card.oracleText.toLowerCase();
  if (!text.trim()) return false;
  return [
    "when ",
    "whenever ",
    "at the beginning",
    "enters",
    "dies",
    "search your library",
    "draw a card",
    "draw cards",
    "create ",
    "return ",
    "exile ",
    "sacrifice ",
    "surveil",
    "scry"
  ].some((pattern) => text.includes(pattern));
}

function phaseTriggeredCards(seat: PlayerSeat, phase: TurnPhase) {
  return seat.board.battlefield.filter((card) => hasPhaseTrigger(card, phase));
}

function hasPhaseTrigger(card: VisibleCard, phase: TurnPhase) {
  const text = card.oracleText.toLowerCase();
  if (phase === "untap step") return text.includes("at the beginning of your untap") || text.includes("during your untap") || text.includes("phasing");
  if (phase === "upkeep step") return text.includes("at the beginning of your upkeep") || text.includes("at the beginning of each upkeep") || text.includes("cumulative upkeep");
  if (phase === "draw step") return text.includes("at the beginning of your draw step");
  if (phase === "precombat main phase") return text.includes("at the beginning of your precombat main phase") || text.includes("first main phase");
  if (phase === "beginning of combat step") return text.includes("at the beginning of combat") || text.includes("beginning of combat on your turn");
  if (phase === "declare attackers step") return text.includes("whenever") && (text.includes(" attacks") || text.includes("a creature attacks"));
  if (phase === "declare blockers step") return text.includes("whenever") && (text.includes(" blocks") || text.includes("becomes blocked"));
  if (phase === "combat damage step") return text.includes("combat damage") || text.includes("whenever a creature dies") || text.includes("whenever another creature dies");
  if (phase === "end of combat step") return text.includes("at end of combat") || text.includes("at the end of combat") || text.includes("until end of combat");
  if (phase === "postcombat main phase") return text.includes("at the beginning of your postcombat main phase") || text.includes("second main phase");
  if (phase === "end step") return text.includes("at the beginning of your end step") || text.includes("at the beginning of each end step");
  if (phase === "cleanup step") return text.includes("at the beginning of your cleanup step") || text.includes("cleanup step");
  return false;
}

function phaseEventName(phase: TurnPhase) {
  return `${phase.replace(/ /g, "_")}_trigger`;
}

function isMysticRemoraLike(card: VisibleCard) {
  const text = card.oracleText.toLowerCase();
  return (
    card.name === "Mystic Remora" ||
    (text.includes("opponent casts a noncreature spell") && text.includes("draw a card"))
  );
}

function isStackAction(action: PendingAction): action is Extract<PendingAction, { type: "spell" | "trigger" }> {
  return action.type === "spell" || action.type === "trigger";
}

function spellResolutionDestination(session: GameSession, action: Extract<PendingAction, { type: "spell" }>): "battlefield" | "graveyard" {
  const actor = session.seats.find((seat) => seat.id === action.actorSeatId);
  const card = action.sourceZone === "command" ? actor?.board.commander : actor?.board.hand.find((item) => item.id === action.cardId);
  if (!card) return "graveyard";
  return card.typeLine.includes("Instant") || card.typeLine.includes("Sorcery") ? "graveyard" : "battlefield";
}

function isLandCard(card: VisibleCard) {
  return card.typeLine.includes("Land") || card.role === "land";
}

function canCastAtInstantSpeed(card: VisibleCard) {
  return card.typeLine.includes("Instant") || /\bflash\b/i.test(card.oracleText);
}

function canPayForCard(seat: PlayerSeat, card: VisibleCard) {
  return chooseManaSourcesForCost(seat, card, card.manaValue).ok;
}

function emptyManaPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

function addManaToPool(pool: ManaPool, color: ManaColor, amount: number) {
  return { ...pool, [color]: pool[color] + amount };
}

function manaPoolTotal(pool: ManaPool) {
  return Object.values(pool).reduce((total, value) => total + value, 0);
}

function spendGenericMana(pool: ManaPool, amount: number) {
  const next = { ...pool };
  let remaining = amount;
  for (const color of ["C", "W", "U", "B", "R", "G"] as ManaColor[]) {
    const spent = Math.min(next[color], remaining);
    next[color] -= spent;
    remaining -= spent;
    if (remaining === 0) break;
  }
  return next;
}

function payCostFromPool(pool: ManaPool, card: VisibleCard, totalCost: number) {
  const requirement = manaRequirementForCard(card, totalCost);
  const next = { ...pool };
  for (const color of ["W", "U", "B", "R", "G"] as ColoredMana[]) {
    if (next[color] < requirement.colors[color]) {
      return { ok: false as const, sourceIds: [], pool, reason: `missing ${color} mana` };
    }
    next[color] -= requirement.colors[color];
  }
  if (manaPoolTotal(next) < requirement.generic) {
    return { ok: false as const, sourceIds: [], pool, reason: `missing ${requirement.generic - manaPoolTotal(next)} generic mana` };
  }
  const genericPool = spendGenericMana(next, requirement.generic);
  return { ok: true as const, sourceIds: [], pool: genericPool, spent: manaPoolDifference(pool, genericPool) };
}

function chooseManaSourcesForCost(seat: PlayerSeat, card: VisibleCard, totalCost: number) {
  const requirement = manaRequirementForCard(card, totalCost);
  const sources = seat.board.battlefield.filter((source) => isAvailableManaSource(source));
  const chosen = new Set<string>();
  const pool = emptyManaPool();

  for (const color of ["W", "U", "B", "R", "G"] as ColoredMana[]) {
    for (let needed = requirement.colors[color]; needed > 0; needed -= 1) {
      const source = sources.find((candidate) => !chosen.has(candidate.id) && manaChoicesForCard(candidate, seat).includes(color));
      if (!source) return { ok: false as const, sourceIds: [...chosen], reason: `missing ${color} mana` };
      chosen.add(source.id);
      pool[color] += manaProducedBy(source);
    }
  }

  while (manaPoolTotal(pool) < totalCost) {
    const source = sources.find((candidate) => !chosen.has(candidate.id));
    if (!source) return { ok: false as const, sourceIds: [...chosen], reason: `missing ${totalCost - manaPoolTotal(pool)} generic mana` };
    chosen.add(source.id);
    const choices = manaChoicesForCard(source, seat);
    const color = choices.includes("C") ? "C" : choices[0] ?? "C";
    pool[color] += manaProducedBy(source);
  }

  return { ok: true as const, sourceIds: [...chosen], pool, spent: pool };
}

function manaRequirementForCard(card: VisibleCard, totalCost: number) {
  const colors: Record<ColoredMana, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const symbols = card.manaCost?.match(/\{[^}]+\}/g) ?? [];
  for (const symbol of symbols) {
    const value = symbol.replace(/[{}]/g, "").toUpperCase();
    if (value in colors) {
      colors[value as ColoredMana] += 1;
    }
  }
  if (symbols.length === 0 && totalCost > 0) {
    const fallbackColors = card.colors && card.colors.length > 0 ? card.colors : (card.colorIdentity ?? []);
    for (const color of normalizeManaColors(fallbackColors)) {
      if (color !== "C") colors[color] += 1;
    }
  }
  const coloredTotal = Object.values(colors).reduce((total, value) => total + value, 0);
  const generic = Math.max(0, totalCost - coloredTotal);
  return { colors, generic };
}

function manaPoolDifference(before: ManaPool, after: ManaPool) {
  return {
    W: Math.max(0, before.W - after.W),
    U: Math.max(0, before.U - after.U),
    B: Math.max(0, before.B - after.B),
    R: Math.max(0, before.R - after.R),
    G: Math.max(0, before.G - after.G),
    C: Math.max(0, before.C - after.C)
  };
}

function formatManaPoolPayment(pool: ManaPool) {
  const parts = (["W", "U", "B", "R", "G", "C"] as ManaColor[]).flatMap((color) => Array.from({ length: pool[color] }, () => color));
  return parts.length > 0 ? parts.join(" ") : "no mana";
}

function adjustedCastingCost(seat: PlayerSeat, card: VisibleCard, baseCost: number, sourceZone: "hand" | "command", activeSeatId: string | undefined) {
  if (sourceZone !== "hand") return baseCost;
  if (seat.id !== activeSeatId) return baseCost;
  const reduction = aminatouEnchantmentCostReduction(seat, card);
  if (reduction <= 0) return baseCost;
  const coloredPips = coloredPipCount(card);
  return Math.max(coloredPips, baseCost - reduction);
}

function aminatouEnchantmentCostReduction(seat: PlayerSeat, card: VisibleCard) {
  if (!card.typeLine.includes("Enchantment")) return 0;
  const hasAminatou = seat.board.battlefield.some((permanent) => permanent.name === "Aminatou, Veil Piercer");
  return hasAminatou ? 4 : 0;
}

function coloredPipCount(card: VisibleCard) {
  return (card.manaCost?.match(/\{[WUBRG]\}/gi) ?? []).length;
}

function chooseManaSources(seat: PlayerSeat, requiredMana: number) {
  if (requiredMana <= 0) return [];
  const sources = seat.board.battlefield.filter((card) => isAvailableManaSource(card));
  const chosen: string[] = [];
  let mana = 0;
  for (const source of sources) {
    chosen.push(source.id);
    mana += manaProducedBy(source);
    if (mana >= requiredMana) break;
  }
  return chosen;
}

function isAvailableManaSource(card: VisibleCard) {
  return !card.tapped && (isLandCard(card) || isManaRock(card));
}

function manaChoicesForCard(card: VisibleCard, seat: PlayerSeat): ManaColor[] {
  const produced = normalizeManaColors(card.producedMana ?? []);
  if (produced.length > 0) return produced;

  const basicTypes = basicLandTypes(card);
  if (basicTypes.length > 0) return basicTypes.map(manaColorForBasicLand).filter((color): color is ManaColor => Boolean(color));

  const text = card.oracleText.toLowerCase();
  const name = card.name.toLowerCase();
  if (name === "command tower" || text.includes("mana of any color in your commander's color identity") || text.includes("one mana of any color")) {
    return normalizeManaColors(seat.deck?.colors ?? seat.board.commander?.colorIdentity ?? ["C"]);
  }
  if (name === "arcane sanctum") return ["W", "U", "B"];
  if (name === "arcane signet") return normalizeManaColors(seat.deck?.colors ?? seat.board.commander?.colorIdentity ?? ["C"]);
  if (name.includes("talisman of dominance")) return ["C", "U", "B"];
  if (name.includes("talisman of hierarchy")) return ["C", "W", "B"];
  if (name.includes("talisman of progress")) return ["C", "W", "U"];
  if (name.includes("signet")) return normalizeManaColors(seat.deck?.colors ?? seat.board.commander?.colorIdentity ?? ["C"]);
  if (name === "sol ring") return ["C"];
  if (isLandCard(card) || isManaRock(card)) return ["C"];
  return [];
}

function normalizeManaColors(colors: string[]) {
  const valid = new Set<ManaColor>(["W", "U", "B", "R", "G", "C"]);
  return Array.from(new Set(colors.map((color) => (color === "colorless" ? "C" : color.toUpperCase())).filter((color): color is ManaColor => valid.has(color as ManaColor))));
}

function manaColorForBasicLand(type: string): ManaColor | undefined {
  if (type === "Plains") return "W";
  if (type === "Island") return "U";
  if (type === "Swamp") return "B";
  if (type === "Mountain") return "R";
  if (type === "Forest") return "G";
  if (type === "Wastes") return "C";
  return undefined;
}

function entersBattlefieldTapped(card: VisibleCard) {
  const text = card.oracleText.toLowerCase();
  return (
    /\benters tapped\b/.test(text) ||
    /\benters the battlefield tapped\b/.test(text) ||
    /\benters the battlefield tapped unless\b/.test(text) ||
    knownEntersTappedCards.has(card.name)
  );
}

const knownEntersTappedCards = new Set([
  "Bojuka Bog",
  "Arcane Sanctum",
  "Contaminated Aquifer",
  "Halimar Depths",
  "Myriad Landscape",
  "Prairie Stream",
  "Temple of Deceit",
  "Temple of Silence",
  "Thriving Heath",
  "Thriving Isle",
  "Thriving Moor"
]);

function isManaRock(card: VisibleCard) {
  const name = card.name.toLowerCase();
  const text = card.oracleText.toLowerCase();
  return (
    card.typeLine.includes("Artifact") &&
    (card.role === "ramp" ||
      name.includes("signet") ||
      name.includes("talisman") ||
      name === "sol ring" ||
      text.includes("add ") ||
      text.includes("add {"))
  );
}

function manaProducedBy(card: VisibleCard) {
  return card.name === "Sol Ring" ? 2 : 1;
}

function selectedManaTotal(seat: PlayerSeat, sourceIds: string[]) {
  const sourceSet = new Set(sourceIds);
  return seat.board.battlefield.reduce((total, card) => (sourceSet.has(card.id) ? total + manaProducedBy(card) : total), 0);
}

function cannotPayMessage(seat: PlayerSeat, card: VisibleCard, availableMana: number, totalCost = card.manaValue, reason?: string) {
  const sourceCount = seat.board.battlefield.filter((item) => isAvailableManaSource(item)).length;
  const suffix = reason ? ` (${reason})` : "";
  if (sourceCount === 0) {
    return `${seat.name} cannot cast ${card.name}; it costs ${totalCost} mana and there are no untapped mana sources${suffix}.`;
  }
  return `${seat.name} cannot cast ${card.name}; it costs ${totalCost} mana and only ${availableMana} is available${suffix}.`;
}

function tapManaSources(cards: VisibleCard[], sourceIds: string[]) {
  if (sourceIds.length === 0) return cards;
  const sourceSet = new Set(sourceIds);
  return cards.map((card) => (sourceSet.has(card.id) ? { ...card, tapped: true } : card));
}

function tapVisibleCard(session: GameSession, seatId: string, cardId: string, location: "battlefield" | "command"): GameSession {
  return {
    ...session,
    seats: session.seats.map((seat) => {
      if (seat.id !== seatId) return seat;
      return {
        ...seat,
        board: {
          ...seat.board,
          commander: location === "command" && seat.board.commander?.id === cardId ? { ...seat.board.commander, tapped: true } : seat.board.commander,
          battlefield:
            location === "battlefield"
              ? seat.board.battlefield.map((card) => (card.id === cardId ? { ...card, tapped: true } : card))
              : seat.board.battlefield
        }
      };
    })
  };
}

function landTurnKey(seatId: string, turn: number) {
  return `${turn}:${seatId}`;
}

function chooseAgentMainPhaseCard(seat: PlayerSeat, hasPlayedLand: boolean) {
  const unplayedLand = seat.board.hand.find((card) => isLandCard(card));
  if (unplayedLand && !hasPlayedLand) return unplayedLand;

  const playableSpells = seat.board.hand
    .filter((card) => !isLandCard(card))
    .filter((card) => chooseManaSourcesForCost(seat, card, adjustedCastingCost(seat, card, card.manaValue, "hand", seat.id)).ok)
    .sort((left, right) => right.manaValue - left.manaValue);
  return playableSpells[0];
}

function parsePower(power?: string) {
  const parsed = Number.parseInt(power ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
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

function keepOpeningHandSize(seat: PlayerSeat, keepSize: number, returnCardIds: string[] = [], shuffleReturned = false): PlayerSeat {
  const returnSet = new Set(returnCardIds);
  const chosenReturns = returnCardIds.length > 0 ? seat.board.hand.filter((card) => returnSet.has(card.id)) : seat.board.hand.slice(keepSize);
  const hand = returnCardIds.length > 0 ? seat.board.hand.filter((card) => !returnSet.has(card.id)) : seat.board.hand.slice(0, keepSize);
  const returnedLibraryCards = chosenReturns.map((card) => ({ ...card, zone: "library" as const }));
  const library = [...(seat.library ?? []), ...returnedLibraryCards];
  return {
    ...seat,
    library: shuffleReturned ? shuffleCards(library) : library,
    board: {
      ...seat.board,
      hand
    },
    zones: {
      ...seat.zones,
      hand: hand.length,
      library: (seat.library?.length ?? seat.zones.library) + returnedLibraryCards.length
    }
  };
}

function withOpeningHand(seat: PlayerSeat, size: number, mulliganCount: number): PlayerSeat {
  const library = makeShuffledLibrary(seat, mulliganCount);
  const hand = library.slice(0, size).map((card) => ({ ...card, zone: "hand" as const }));
  const remainingLibrary = library.slice(size);
  return {
    ...seat,
    library: remainingLibrary,
    board: {
      ...seat.board,
      hand
    },
    zones: {
      ...seat.zones,
      hand: hand.length,
      library: remainingLibrary.length
    }
  };
}

function makeShuffledLibrary(seat: PlayerSeat, shuffleCount: number) {
  const deckCards = expandDeckCards(seat);
  if (deckCards.length === 0) {
    return Array.from({ length: 99 }, (_, index) =>
      createVisibleFromDeckCard({ name: "Wastes", role: "land" }, [], `${seat.id}-fallback-library-${shuffleCount}-${index}`, "library")
    );
  }
  return shuffleCards(
    deckCards.map((card, index) => createVisibleFromDeckCard(card, seat.deck?.colors ?? [], `${seat.id}-library-${shuffleCount}-${index}-${crypto.randomUUID()}`, "library"))
  );
}

function expandDeckCards(seat: PlayerSeat) {
  const cards = seat.deck?.cards.filter((card) => card.role !== "commander") ?? [];
  return cards.flatMap((card) => Array.from({ length: card.count }, () => card));
}

function drawForSeat(session: GameSession, seatId: string, message: string): GameSession {
  const seats = session.seats.map((seat) => {
    if (seat.id !== seatId || seat.zones.library <= 0) return seat;
    const [drawn, ...library] = seat.library ?? [];
    if (!drawn) return seat;
    return {
      ...seat,
      library,
      board: {
        ...seat.board,
        hand: [...seat.board.hand, { ...drawn, zone: "hand" as const }]
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

function drawMultipleForSeat(session: GameSession, seatId: string, count: number, message: string): GameSession {
  let next = session;
  for (let index = 0; index < count; index += 1) {
    next = drawForSeat(next, seatId, index === 0 ? message : `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} draws a card.`);
  }
  return next;
}

function addLibraryLookEvent(session: GameSession, seatId: string, message: string): GameSession {
  return {
    ...session,
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

function resolveAgentLibraryLookWorkflow(
  session: GameSession,
  seatId: string,
  sourceCardName: string,
  workflow: "scry_cards" | "surveil_cards" | "look_at_top_cards",
  count: number
): GameSession {
  const seatName = session.seats.find((seat) => seat.id === seatId)?.name ?? "Agent";
  return {
    ...session,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${seatName} resolves ${sourceCardName}: ${workflow.replaceAll("_", " ")} ${count}.`
      },
      ...session.events
    ]
  };
}

function playCardFromZone(
  session: GameSession,
  seatId: string,
  cardId: string,
  message?: string,
  position?: { x: number; z: number },
  destination: "battlefield" | "graveyard" = "battlefield",
  manaSourceIds: string[] = [],
  sourceZone: "hand" | "command" = "hand"
): GameSession {
  let playedName = "";
  let enteredTapped = false;
  const seats = session.seats.map((seat) => {
    if (seat.id !== seatId) return seat;
    const card = sourceZone === "command" ? seat.board.commander : seat.board.hand.find((item) => item.id === cardId);
    if (!card) return seat;
    playedName = card.name;
    const entersTapped = destination === "battlefield" && entersBattlefieldTapped(card);
    enteredTapped = entersTapped;
    const played: VisibleCard = {
      ...card,
      zone: destination,
      tapped: entersTapped ? true : card.tapped,
      battlefieldPosition: destination === "battlefield" ? position : undefined,
      summoningSick: destination === "battlefield" && card.typeLine.includes("Creature") ? true : card.summoningSick
    };
    const graveyard = seat.board.graveyard ?? [];
    const commanderLeavesCommand = sourceZone === "command" && seat.board.commander?.id === cardId;
    return {
      ...seat,
      board: {
        ...seat.board,
        commander: commanderLeavesCommand ? undefined : seat.board.commander,
        hand: sourceZone === "hand" ? seat.board.hand.filter((item) => item.id !== cardId) : seat.board.hand,
        battlefield:
          destination === "battlefield"
            ? [...tapManaSources(seat.board.battlefield, manaSourceIds), played]
            : tapManaSources(seat.board.battlefield, manaSourceIds),
        graveyard: destination === "graveyard" ? [...graveyard, played] : graveyard
      },
      zones: {
        ...seat.zones,
        battlefield: seat.zones.battlefield + (destination === "battlefield" ? 1 : 0),
        command: Math.max(0, seat.zones.command - (commanderLeavesCommand ? 1 : 0)),
        graveyard: seat.zones.graveyard + (destination === "graveyard" ? 1 : 0),
        hand: sourceZone === "hand" ? Math.max(0, seat.zones.hand - 1) : seat.zones.hand
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
        message: `${message ?? `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} plays ${playedName}.`}${enteredTapped ? " It enters tapped." : ""}`,
        detail: destination === "graveyard" ? "Response" : undefined
      },
      ...session.events
    ]
  };
}

function nextSeatId(seats: PlayerSeat[], seatId: string) {
  const index = Math.max(0, seats.findIndex((seat) => seat.id === seatId));
  return seats[(index + 1) % seats.length]?.id ?? seatId;
}

function pendingActionRequiredPasses(seats: PlayerSeat[], action: PendingAction, manaPools: Record<string, ManaPool>) {
  if (action.type === "trigger") return [action.controllerSeatId];
  return seats.filter((seat) => seat.id !== action.actorSeatId && canReceivePriorityForPendingAction(seat, manaPools)).map((seat) => seat.id);
}

function nextPrioritySeatId(seats: PlayerSeat[], actorSeatId: string, passes: string[], action: PendingAction, manaPools: Record<string, ManaPool>) {
  const required = pendingActionRequiredPasses(seats, action, manaPools);
  const startIndex = Math.max(0, seats.findIndex((seat) => seat.id === actorSeatId));
  for (let offset = 1; offset <= seats.length; offset += 1) {
    const seat = seats[(startIndex + offset) % seats.length];
    if (required.includes(seat.id) && !passes.includes(seat.id)) return seat.id;
  }
  return actorSeatId;
}

function canReceivePriorityForPendingAction(seat: PlayerSeat, manaPools: Record<string, ManaPool>) {
  if (seat.kind === "agent") return true;
  const pool = manaPools[seat.id] ?? emptyManaPool();
  return seat.board.hand.some((card) => canCastAtInstantSpeed(card) && payCostFromPool(pool, card, card.manaValue).ok);
}

function moveCardBetweenVisibleZones(session: GameSession, seatId: string, cardId: string, destination: "hand" | "graveyard" | "exile"): GameSession {
  let movedName = "";
  let source: "hand" | "battlefield" | "graveyard" | "exile" | undefined;
  let commanderTax: number | undefined;

  const seats = session.seats.map((seat) => {
    if (seat.id !== seatId) return seat;
    const graveyard = seat.board.graveyard ?? [];
    const exile = seat.board.exile ?? [];
    const handCard = seat.board.hand.find((card) => card.id === cardId);
    const battlefieldCard = seat.board.battlefield.find((card) => card.id === cardId);
    const graveyardCard = graveyard.find((card) => card.id === cardId);
    const exileCard = exile.find((card) => card.id === cardId);
    const card = handCard ?? battlefieldCard ?? graveyardCard ?? exileCard;
    if (!card) return seat;

    source = handCard ? "hand" : battlefieldCard ? "battlefield" : graveyardCard ? "graveyard" : "exile";
    if (source === destination) return seat;

    movedName = card.name;
    if (card.commander && source === "battlefield" && (destination === "graveyard" || destination === "exile")) {
      commanderTax = (card.commanderTax ?? 0) + 2;
      return {
        ...seat,
        board: {
          ...seat.board,
          commander: {
            ...card,
            zone: "command" as const,
            tapped: false,
            attacking: false,
            blocking: false,
            battlefieldPosition: undefined,
            commanderTax
          },
          battlefield: seat.board.battlefield.filter((item) => item.id !== cardId),
          graveyard,
          exile
        },
        zones: {
          ...seat.zones,
          battlefield: Math.max(0, seat.zones.battlefield - 1),
          command: seat.zones.command + 1
        }
      };
    }

    const movedCard: VisibleCard = {
      ...card,
      zone: destination,
      tapped: destination === "graveyard" || destination === "exile" ? false : card.tapped,
      attacking: false,
      blocking: false,
      battlefieldPosition: destination === "graveyard" || destination === "exile" ? undefined : card.battlefieldPosition
    };

    return {
      ...seat,
      board: {
        ...seat.board,
        hand: source === "hand" ? seat.board.hand.filter((item) => item.id !== cardId) : destination === "hand" ? [...seat.board.hand, movedCard] : seat.board.hand,
        battlefield: source === "battlefield" ? seat.board.battlefield.filter((item) => item.id !== cardId) : seat.board.battlefield,
        graveyard:
          source === "graveyard"
            ? graveyard.filter((item) => item.id !== cardId)
            : destination === "graveyard"
              ? [...graveyard, movedCard]
              : graveyard,
        exile:
          source === "exile"
            ? exile.filter((item) => item.id !== cardId)
            : destination === "exile"
              ? [...exile, movedCard]
              : exile
      },
      zones: {
        ...seat.zones,
        hand: seat.zones.hand + (destination === "hand" ? 1 : 0) - (source === "hand" ? 1 : 0),
        battlefield: seat.zones.battlefield - (source === "battlefield" ? 1 : 0),
        graveyard: seat.zones.graveyard + (destination === "graveyard" ? 1 : 0) - (source === "graveyard" ? 1 : 0),
        exile: seat.zones.exile + (destination === "exile" ? 1 : 0) - (source === "exile" ? 1 : 0)
      }
    };
  });

  if (!movedName || !source) return session;

  return {
    ...session,
    seats,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message:
          commanderTax !== undefined
            ? `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} returns ${movedName} to the command zone. Commander tax is now +${commanderTax}.`
            : `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} moves ${movedName} from ${source} to ${destination}.`
      },
      ...session.events
    ]
  };
}

function resolveMyriadLandscapeSearch(session: GameSession, seatId: string, cardId: string, chosenCardIds: string[]): GameSession {
  let sourceName = "";
  let foundNames: string[] = [];

  const seats = session.seats.map((seat) => {
    if (seat.id !== seatId) return seat;
    const source = seat.board.battlefield.find((card) => card.id === cardId);
    if (!source || source.name !== "Myriad Landscape") return seat;

    sourceName = source.name;
    const library = seat.library ?? [];
    const chosenIdSet = new Set(chosenCardIds.slice(0, 2));
    const chosen = library.filter((card) => chosenIdSet.has(card.id) && isBasicLandCard(card));
    const sharedTypes = sharedBasicLandTypes(chosen);
    const found = chosen.length > 0 && sharedTypes.length > 0 ? chosen.slice(0, 2) : [];
    foundNames = found.map((card) => card.name);
    const foundIds = new Set(found.map((card) => card.id));
    const graveyard = seat.board.graveyard ?? [];

    return {
      ...seat,
      library: library.filter((card) => !foundIds.has(card.id)),
      board: {
        ...seat.board,
        battlefield: [
          ...seat.board.battlefield.filter((card) => card.id !== cardId),
          ...found.map((card) => ({
            ...card,
            zone: "battlefield" as const,
            tapped: true,
            battlefieldPosition: undefined
          }))
        ],
        graveyard: [
          ...graveyard,
          {
            ...source,
            zone: "graveyard" as const,
            tapped: false,
            battlefieldPosition: undefined
          }
        ]
      },
      zones: {
        ...seat.zones,
        battlefield: seat.zones.battlefield - 1 + found.length,
        graveyard: seat.zones.graveyard + 1,
        library: Math.max(0, seat.zones.library - found.length)
      }
    };
  });

  if (!sourceName) return session;

  const seatName = session.seats.find((seat) => seat.id === seatId)?.name ?? "Player";
  const detail = foundNames.length > 0 ? ` Finds ${foundNames.join(", ")}. They enter tapped.` : " No basic lands were found.";
  return {
    ...session,
    seats,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${seatName} sacrifices ${sourceName} and searches for up to two basic lands.${detail}`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

function isBasicLandCard(card: VisibleCard) {
  return card.typeLine.includes("Basic Land") || ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"].includes(card.name);
}

function basicLandTypes(card: VisibleCard) {
  return ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"].filter((type) => card.name === type || card.typeLine.includes(type));
}

function sharedBasicLandTypes(cards: VisibleCard[]) {
  if (cards.length === 0) return [];
  return basicLandTypes(cards[0]).filter((type) => cards.every((card) => basicLandTypes(card).includes(type)));
}

function getMyriadLandscapeOptions(library: VisibleCard[]) {
  return library.filter((card) => isBasicLandCard(card) && basicLandTypes(card).length > 0);
}

function moveLibraryCard(session: GameSession, seatId: string, cardId: string, destination: "top" | "bottom" | "graveyard"): GameSession {
  let movedName = "";
  const seats = session.seats.map((seat) => {
    if (seat.id !== seatId) return seat;
    const library = seat.library ?? [];
    const card = library.find((item) => item.id === cardId);
    if (!card) return seat;
    movedName = card.name;
    const remainingLibrary = library.filter((item) => item.id !== cardId);
    const graveyard = seat.board.graveyard ?? [];

    if (destination === "top") {
      return {
        ...seat,
        library: [{ ...card, zone: "library" as const }, ...remainingLibrary]
      };
    }

    if (destination === "bottom") {
      return {
        ...seat,
        library: [...remainingLibrary, { ...card, zone: "library" as const }]
      };
    }

    return {
      ...seat,
      library: remainingLibrary,
      board: {
        ...seat.board,
        graveyard: [...graveyard, { ...card, zone: "graveyard" as const }]
      },
      zones: {
        ...seat.zones,
        graveyard: seat.zones.graveyard + 1,
        library: Math.max(0, seat.zones.library - 1)
      }
    };
  });

  if (!movedName) return session;

  return {
    ...session,
    seats,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message:
          destination === "top"
            ? `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} keeps ${movedName} on top of their library.`
            : destination === "bottom"
            ? `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} puts ${movedName} on the bottom of their library.`
            : `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} surveils ${movedName} into their graveyard.`
      },
      ...session.events
    ]
  };
}

function reorderTopLibraryCards(session: GameSession, seatId: string, orderedCards: VisibleCard[]): GameSession {
  const orderedIds = new Set(orderedCards.map((card) => card.id));
  const seatName = session.seats.find((seat) => seat.id === seatId)?.name ?? "Player";
  return {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === seatId
        ? {
            ...seat,
            library: [
              ...orderedCards.map((card) => ({ ...card, zone: "library" as const })),
              ...(seat.library ?? []).filter((card) => !orderedIds.has(card.id))
            ]
          }
        : seat
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${seatName} put ${orderedCards.length} looked-at card${orderedCards.length === 1 ? "" : "s"} back on top in a chosen order.`
      },
      ...session.events
    ]
  };
}

function moveLibraryCardToDestination(
  session: GameSession,
  seatId: string,
  cardId: string,
  destination: "hand" | "battlefield",
  tapped: boolean
): GameSession {
  let movedName = "";
  const seats = session.seats.map((seat) => {
    if (seat.id !== seatId) return seat;
    const library = seat.library ?? [];
    const card = library.find((item) => item.id === cardId);
    if (!card) return seat;
    movedName = card.name;
    const remainingLibrary = library.filter((item) => item.id !== cardId);
    const movedCard: VisibleCard = {
      ...card,
      zone: destination,
      tapped: destination === "battlefield" ? tapped || entersBattlefieldTapped(card) : card.tapped,
      summoningSick: destination === "battlefield" && card.typeLine.includes("Creature") ? true : card.summoningSick
    };

    return {
      ...seat,
      library: remainingLibrary,
      board: {
        ...seat.board,
        hand: destination === "hand" ? [...seat.board.hand, movedCard] : seat.board.hand,
        battlefield: destination === "battlefield" ? [...seat.board.battlefield, movedCard] : seat.board.battlefield
      },
      zones: {
        ...seat.zones,
        hand: seat.zones.hand + (destination === "hand" ? 1 : 0),
        battlefield: seat.zones.battlefield + (destination === "battlefield" ? 1 : 0),
        library: Math.max(0, seat.zones.library - 1)
      }
    };
  });

  if (!movedName) return session;
  return {
    ...session,
    seats,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} searches their library for ${movedName} and puts it onto the ${destination}.`
      },
      ...session.events
    ]
  };
}

function createVisibleFromDeckCard(deckCard: { name: string; role?: string; card?: CommanderDeck["cards"][number]["card"] }, colors: string[], id: string, zone: VisibleCard["zone"]): VisibleCard {
  const name = deckCard.card?.name ?? deckCard.name;
  const role = deckCard.role ?? "spell";
  const isLand = role === "land" || ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"].includes(name);
  const typeLine = deckCard.card?.typeLine;
  const fallbackTypeLine = fallbackTypeLineForCard(name, role, isLand);
  const isCreature = typeLine?.includes("Creature") ?? fallbackTypeLine.includes("Creature");
  return {
    id,
    name,
    typeLine: typeLine ?? fallbackTypeLine,
    oracleText: deckCard.card?.oracleText ?? (isLand ? "Tap: Add mana." : `Mock ${role} card. Full rules text will come from card data lookup.`),
    manaCost: deckCard.card?.manaCost,
    manaValue: deckCard.card?.manaValue ?? fallbackManaValueForCard(name, role, isLand),
    colors: deckCard.card?.colors ?? (isLand ? [] : colors.slice(0, 1)),
    colorIdentity: deckCard.card?.colorIdentity ?? colors,
    producedMana: deckCard.card?.producedMana,
    imageUris: deckCard.card?.imageUris,
    faces: deckCard.card?.faces,
    role,
    zone,
    power: deckCard.card?.power ?? (isCreature ? "2" : undefined),
    toughness: deckCard.card?.toughness ?? (isCreature ? "2" : undefined)
  };
}

function fallbackTypeLineForCard(name: string, role: string, isLand: boolean) {
  if (isLand) return "Land";
  if (isKnownManaArtifact(name)) return "Artifact";
  if (role === "removal") return "Instant";
  if (["creature", "synergy", "wincon", "draw"].includes(role)) return "Creature - Spell";
  return "Spell";
}

function fallbackManaValueForCard(name: string, role: string, isLand: boolean) {
  if (isLand) return 0;
  if (name === "Sol Ring" || name === "Wayfarer's Bauble") return 1;
  if (isKnownManaArtifact(name)) return 2;
  if (role === "removal") return 2;
  if (role === "ramp") return 2;
  return 4;
}

function isKnownManaArtifact(name: string) {
  const lower = name.toLowerCase();
  return lower === "sol ring" || lower.includes("signet") || lower.includes("talisman") || lower === "wayfarer's bauble";
}

function shuffleCards(cards: VisibleCard[]) {
  const shuffled = cards.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function randomInt(maxExclusive: number) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % maxExclusive;
}
