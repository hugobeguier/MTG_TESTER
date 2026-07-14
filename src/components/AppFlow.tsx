"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentAction, CardFaceRecord, CommanderDeck, GameEvent, GameSession, InterpretedEffect, PlayerSeat, VisibleCard } from "@/lib/types";
import type { RuleWorkflow } from "@/lib/rulesAdvisor";
import { createDeckFromList } from "@/lib/deckParser";
import { evaluateOpeningHand } from "@/lib/mulliganHeuristics";
import { effectiveAttackTaxAmount, looksLikeAttackTaxCandidate } from "@/lib/staticEffects";
import { counterCount, effectivePower, effectiveToughness } from "@/lib/counters";
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
type TriggerEffect =
  | { kind: "draw_cards"; amount: number }
  | { kind: "gain_life"; amount: number }
  | { kind: "lose_life"; amount: number }
  | { kind: "scry_cards"; amount: number }
  | { kind: "surveil_cards"; amount: number }
  | { kind: "create_tokens"; tokens: TokenSpec[] };

interface TokenSpec {
  count: number;
  name: string;
  colors: string[];
  typeLine: string;
  power?: string;
  toughness?: string;
  oracleText: string;
  role: string;
}
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
      faceIndex?: number;
      chosenX?: number;
      message: string;
    }
  | {
      id: string;
      type: "trigger";
      actorSeatId: string;
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      triggerKind: "common";
      effect: TriggerEffect;
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

interface BasicLandFetchSearchState {
  seatId: string;
  sourceCardId: string;
  sourceCardName: string;
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
    }
  | {
      id: string;
      kind: "miracle_offer";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      miracleCost: number;
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
  targetId: string;
}

interface ManaChoiceState {
  seatId: string;
  cardId: string;
  cardName: string;
  location: "battlefield" | "command";
  choices: ManaColor[];
}

interface ManaContribution {
  cardId: string;
  color: ManaColor;
  amount: number;
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

interface LegalAgentAction {
  id: string;
  actionType: AgentAction["actionType"];
  cardId?: string;
  abilityKind?: "basic_land_fetch" | "unlock_room_door";
  faceIndex?: number;
  targetIds: string[];
  label: string;
  detail?: string;
  role?: string;
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
  const [session, rawSetSession] = useState(() => checkStateBasedActions(initialSession));
  // Every session update is routed through here so state-based actions (rule 704) are checked
  // after every single change, instead of relying on scattered call sites to remember to do it.
  const setSession = useCallback((update: GameSession | ((prev: GameSession) => GameSession)) => {
    rawSetSession((current) => checkStateBasedActions(typeof update === "function" ? update(current) : update));
  }, []);
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
  const [basicLandFetchSearch, setBasicLandFetchSearch] = useState<BasicLandFetchSearchState | undefined>();
  const [pendingAction, setPendingAction] = useState<PendingAction | undefined>();
  const [stackActions, setStackActions] = useState<PendingAction[]>([]);
  const [priorityPasses, setPriorityPasses] = useState<string[]>([]);
  const [manaPools, setManaPools] = useState<Record<string, ManaPool>>({});
  const [manaContributions, setManaContributions] = useState<Record<string, ManaContribution[]>>({});
  const [manaChoice, setManaChoice] = useState<ManaChoiceState | undefined>();
  const [setupMessage, setSetupMessage] = useState<string | undefined>();
  const [configs, setConfigs] = useState<SeatConfig[]>(() => createInitialConfigs(initialSession.seats));
  const autoValidatedDefaultDeck = useRef(false);
  const agentMainActions = useRef<Set<string>>(new Set());
  const agentDecisionRequests = useRef<Set<string>>(new Set());
  const landPlaysThisTurn = useRef<Set<string>>(new Set());
  const firstDrawThisTurn = useRef<Set<string>>(new Set());
  const loyaltyActivationsThisTurn = useRef<Set<string>>(new Set());
  const phaseTriggersChecked = useRef<Set<string>>(new Set());
  const stackActionsRef = useRef<PendingAction[]>([]);
  const humanSeat = session.seats.find((seat) => seat.kind === "human") ?? session.seats[0];
  const selectedHandCard = selectedHandCardId ? humanSeat.board.hand.find((card) => card.id === selectedHandCardId) : undefined;
  const selectedCardCanRespond = selectedHandCard ? canCastAtInstantSpeed(selectedHandCard) && payCostFromPool(poolForSeat(humanSeat.id), selectedHandCard, selectedHandCard.manaValue).ok : false;
  const selectedCardFaceOptions = selectedHandCard
    ? handCardFaceOptions(humanSeat, selectedHandCard, hasPlayedLandThisTurn(humanSeat.id, session.turn), activeSeatId, poolForSeat(humanSeat.id))
    : undefined;
  const inspectedRoomLockedFaceIndex = (() => {
    if (!inspectedCard) return undefined;
    const doors = roomDoorFaces(inspectedCard);
    const unlocked = inspectedCard.unlockedFaceIndices ?? [];
    if (!doors || unlocked.length !== 1) return undefined;
    return unlocked[0] === 0 ? 1 : 0;
  })();
  const humanAttackTargets = (() => {
    if (!inspectedCard) return undefined;
    if (activeSeatId !== humanSeat.id || session.phase !== "declare attackers step") return undefined;
    const isOwnBattlefieldCreature = humanSeat.board.battlefield.some((card) => card.id === inspectedCard.id);
    if (!isOwnBattlefieldCreature || !canAttack(inspectedCard)) return undefined;
    const targets: Array<{ targetId: string; label: string }> = [];
    for (const opponent of session.seats.filter((seat) => seat.id !== humanSeat.id && !seat.hasLost)) {
      targets.push({ targetId: opponent.id, label: `Attack ${opponent.name}` });
      for (const planeswalker of opponent.board.battlefield.filter(isPlaneswalkerCard)) {
        targets.push({ targetId: planeswalker.id, label: `Attack ${planeswalker.name} (${opponent.name}, ${loyaltyCounterCount(planeswalker)} loyalty)` });
      }
    }
    return targets;
  })();
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
    setManaContributions((current) => ({ ...current, [seatId]: [] }));
  }

  function clearManaContributions(seatId: string) {
    setManaContributions((current) => ({ ...current, [seatId]: [] }));
  }

  function addManaContribution(seatId: string, cardId: string, color: ManaColor, amount: number) {
    setManaContributions((current) => ({
      ...current,
      [seatId]: [...(current[seatId] ?? []).filter((item) => item.cardId !== cardId), { cardId, color, amount }]
    }));
  }

  function removeManaContribution(seatId: string, cardId: string) {
    const contribution = manaContributions[seatId]?.find((item) => item.cardId === cardId);
    if (!contribution) return;
    setManaPools((current) => {
      const pool = current[seatId] ?? emptyManaPool();
      return {
        ...current,
        [seatId]: {
          ...pool,
          [contribution.color]: Math.max(0, pool[contribution.color] - contribution.amount)
        }
      };
    });
    setManaContributions((current) => ({ ...current, [seatId]: (current[seatId] ?? []).filter((item) => item.cardId !== cardId) }));
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
    const key = `priority:${pendingAction.id}:${prioritySeat.id}:${priorityPasses.join(",")}`;
    if (agentDecisionRequests.current.has(key)) return;
    agentDecisionRequests.current.add(key);
    const timer = window.setTimeout(() => {
      void decideAgentPriorityAction(prioritySeat, pendingAction, key);
    }, 850);
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
    if (mode !== "game" || gameStage !== "playing" || pendingAction || libraryLook || pendingRuleChoice || manualLibrarySearch || blockChoice || basicLandFetchSearch) return;
    if (session.phase === "declare blockers step") {
      const choice = createCombatBlockChoice(session, activeSeatId);
      if (!choice) {
        const key = `no-blockers:${session.turn}:${activeSeatId}`;
        if (agentDecisionRequests.current.has(key)) return;
        agentDecisionRequests.current.add(key);
        const timer = window.setTimeout(() => advanceTurn(), 700);
        return () => window.clearTimeout(timer);
      }
      const defender = session.seats.find((seat) => seat.id === choice.defenderSeatId);
      if (!defender) return;
      if (defender.kind === "human") {
        const key = `human-block:${session.turn}:${choice.attackerSeatId}:${choice.defenderSeatId}:${choice.attackerCardId}`;
        if (agentDecisionRequests.current.has(key)) return;
        agentDecisionRequests.current.add(key);
        setBlockChoice(choice);
        addEvent(`${defender.name} chooses blockers.`, defender.id, "Phase change");
        return;
      }
      const key = `block:${session.turn}:${activeSeatId}:${choice.defenderSeatId}:${choice.attackerCardId}`;
      if (agentDecisionRequests.current.has(key)) return;
      agentDecisionRequests.current.add(key);
      const timer = window.setTimeout(() => {
        void decideAgentBlockAction(defender, choice, key);
      }, 1100);
      return () => window.clearTimeout(timer);
    }
    const activeSeat = session.seats.find((seat) => seat.id === activeSeatId);
    if (activeSeat?.kind !== "agent") return;
    if (shouldAgentFastForwardToEndStep(activeSeat)) {
      const key = `fast-end:${session.turn}:${activeSeat.id}:${session.phase}`;
      if (agentDecisionRequests.current.has(key)) return;
      agentDecisionRequests.current.add(key);
      const timer = window.setTimeout(() => {
        fastForwardAgentToEndStep(activeSeat.id);
        agentDecisionRequests.current.delete(key);
      }, 500);
      return () => window.clearTimeout(timer);
    }
    const actionKey = `${session.turn}:${activeSeat.id}:${session.phase}`;
    if (agentDecisionRequests.current.has(actionKey)) return;
    const shouldAskAgent =
      session.phase === "precombat main phase" ||
      session.phase === "postcombat main phase" ||
      session.phase === "declare attackers step";
    if (!shouldAskAgent) {
      const timer = window.setTimeout(() => advanceTurn(), 1100);
      return () => window.clearTimeout(timer);
    }
    agentDecisionRequests.current.add(actionKey);
    const timer = window.setTimeout(() => {
      if (session.phase === "declare attackers step") {
        void decideAgentAttackers(activeSeat, actionKey);
      } else {
        void decideAgentTurnAction(activeSeat, actionKey);
      }
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [mode, gameStage, pendingAction, libraryLook, pendingRuleChoice, manualLibrarySearch, blockChoice, basicLandFetchSearch, activeSeatId, session.phase, session.turn, session.seats]);

  useEffect(() => {
    if (mode !== "game" || gameStage !== "playing" || !pendingRuleChoice) return;
    const controller = session.seats.find((seat) => seat.id === pendingRuleChoice.controllerSeatId);
    if (controller?.kind !== "agent") return;
    const timer = window.setTimeout(() => resolveAgentRuleChoice(pendingRuleChoice), 900);
    return () => window.clearTimeout(timer);
  }, [mode, gameStage, pendingRuleChoice, session.seats]);

  async function requestAgentDecision(seat: PlayerSeat, purpose: string, legalActions: LegalAgentAction[], sessionOverride?: GameSession) {
    if (legalActions.length === 0) return undefined;
    const activeSession = sessionOverride ?? session;
    const response = await fetch("/api/agents/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentName: seat.agentName ?? seat.name,
        seatName: seat.name,
        context: buildAgentDecisionContext(activeSession, seat, {
          purpose,
          activeSeatId,
          prioritySeatId,
          phase: activeSession.phase,
          turn: activeSession.turn,
          pendingAction: pendingAction ? pendingActionSummary(pendingAction) : undefined,
          stack: stackActions.map(pendingActionSummary),
          heuristicHint: purpose === "opening_hand_mulligan" ? evaluateOpeningHand(seat) : undefined
        }),
        legalActions
      })
    });
    const result = (await response.json()) as {
      source: "ollama" | "fallback" | "invalid";
      message?: string;
      action?: AgentAction;
    };
    if (result.message && result.source !== "ollama") {
      addEvent(`${seat.name} agent decision fallback: ${result.message}`, seat.id, "Agent decision");
    }
    return result.action;
  }

  async function decideAgentTurnAction(seat: PlayerSeat, requestKey: string) {
    try {
      const legalActions = legalMainPhaseActions(seat, hasPlayedLandThisTurn(seat.id, session.turn), activeSeatId);
      const action = await requestAgentDecision(seat, "main_phase", legalActions);
      const legal = legalActions.find((item) => item.id === action?.legalActionId) ?? fallbackLegalAction(legalActions);
      if (!legal) {
        advanceTurn();
        return;
      }
      addEvent(`${seat.name} chooses ${legal.label}. ${action?.reason ?? ""}`.trim(), seat.id, "Agent decision");
      applyAgentTurnAction(seat, legal);
    } catch (error) {
      addEvent(`${seat.name} agent decision failed: ${error instanceof Error ? error.message : "unknown error"}.`, seat.id, "Agent decision");
      applyAgentTurnAction(seat, fallbackLegalAction(legalMainPhaseActions(seat, hasPlayedLandThisTurn(seat.id, session.turn), activeSeatId)));
    } finally {
      agentDecisionRequests.current.delete(requestKey);
    }
  }

  async function decideAgentAttackers(seat: PlayerSeat, requestKey: string) {
    let workingSession = session;
    try {
      let guard = 0;
      while (guard < 20) {
        guard += 1;
        const currentSeat = workingSession.seats.find((item) => item.id === seat.id);
        if (!currentSeat) break;
        const opponents = workingSession.seats.filter((item) => item.id !== seat.id && !item.hasLost);
        const legalActions = legalAttackActions(currentSeat, opponents);
        if (!legalActions.some((item) => item.actionType === "attack")) break;
        const action = await requestAgentDecision(currentSeat, "declare_attackers", legalActions, workingSession);
        const legal = legalActions.find((item) => item.id === action?.legalActionId);
        if (!legal || legal.actionType !== "attack" || !legal.cardId) break;
        workingSession = declareAttack(workingSession, seat.id, legal.cardId, legal.targetIds[0]);
        workingSession = {
          ...workingSession,
          events: [
            {
              id: crypto.randomUUID(),
              at: new Date().toISOString(),
              seatId: seat.id,
              message: `${seat.name} declares an attacker: ${legal.label}. ${action?.reason ?? ""}`.trim(),
              detail: "Agent decision"
            },
            ...workingSession.events
          ]
        };
      }
    } catch (error) {
      workingSession = {
        ...workingSession,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: seat.id,
            message: `${seat.name} attacker declaration failed: ${error instanceof Error ? error.message : "unknown error"}.`,
            detail: "Agent decision"
          },
          ...workingSession.events
        ]
      };
    } finally {
      setSession(workingSession);
      window.setTimeout(() => advanceTurn(), 0);
      agentDecisionRequests.current.delete(requestKey);
    }
  }

  async function decideAgentPriorityAction(seat: PlayerSeat, actionOnStack: PendingAction, requestKey: string) {
    try {
      const legalActions = legalPriorityActions(seat, actionOnStack, activeSeatId);
      const action = await requestAgentDecision(seat, "priority_response", legalActions);
      const legal = legalActions.find((item) => item.id === action?.legalActionId) ?? fallbackLegalAction(legalActions);
      if (!legal) {
        passPriority();
        return;
      }
      addEvent(`${seat.name} chooses ${legal.label}. ${action?.reason ?? ""}`.trim(), seat.id, "Agent decision");
      applyAgentPriorityAction(seat, legal, actionOnStack);
    } catch (error) {
      addEvent(`${seat.name} priority decision failed: ${error instanceof Error ? error.message : "unknown error"}.`, seat.id, "Agent decision");
      passPriority();
    } finally {
      agentDecisionRequests.current.delete(requestKey);
    }
  }

  async function decideAgentBlockAction(seat: PlayerSeat, choice: BlockChoiceState, requestKey: string) {
    try {
      const legalActions = legalBlockActions(session, choice);
      const action = await requestAgentDecision(seat, "declare_blockers", legalActions);
      const legal = legalActions.find((item) => item.id === action?.legalActionId) ?? fallbackLegalAction(legalActions);
      addEvent(`${seat.name} chooses ${legal?.label ?? "no blocks"}. ${action?.reason ?? ""}`.trim(), seat.id, "Agent decision");
      setSession((current) => resolveAgentBlockChoice(current, choice, legal?.cardId));
    } catch (error) {
      addEvent(`${seat.name} block decision failed: ${error instanceof Error ? error.message : "unknown error"}.`, seat.id, "Agent decision");
      setSession((current) => resolveAgentBlockChoice(current, choice, undefined));
    } finally {
      agentDecisionRequests.current.delete(requestKey);
    }
  }

  function applyAgentTurnAction(seat: PlayerSeat, action: LegalAgentAction | undefined) {
    if (action?.actionType === "end_turn") {
      setSelectedHandCardId(undefined);
      setPriorityPasses([]);
      setSession((current) => resolveEndTurn(current, seat.id));
      return;
    }
    if (!action || action.actionType === "pass_priority") {
      advanceTurn();
      return;
    }
    if (action.actionType === "play_land" && action.cardId) {
      playCard(seat.id, action.cardId, undefined, "hand", action.faceIndex);
      return;
    }
    if ((action.actionType === "cast_spell" || action.actionType === "cast_commander") && action.cardId) {
      agentMainActions.current.add(`${session.turn}:${seat.id}:${session.phase}`);
      playCard(seat.id, action.cardId, undefined, action.actionType === "cast_commander" ? "command" : "hand", action.faceIndex);
      return;
    }
    if (action.actionType === "activate_ability" && action.cardId && action.abilityKind === "basic_land_fetch") {
      const cardId = action.cardId;
      setSession((current) => resolveBasicLandFetchSearch(current, seat.id, cardId));
      return;
    }
    if (action.actionType === "activate_ability" && action.cardId && action.abilityKind === "unlock_room_door" && action.faceIndex !== undefined) {
      unlockRoomDoor(seat.id, action.cardId, action.faceIndex);
      return;
    }
    advanceTurn();
  }

  function shouldAgentFastForwardToEndStep(seat: PlayerSeat) {
    if (pendingAction || pendingRuleChoice || libraryLook || manualLibrarySearch || blockChoice || basicLandFetchSearch) return false;
    if (session.phase === "end step" || session.phase === "cleanup step") return false;
    if (!isMainPhase(session.phase) && session.phase !== "declare attackers step") return false;
    if (phaseTriggeredCards(seat, session.phase as TurnPhase).length > 0) return false;

    const hasMainAction = hasAgentMainPhaseAction(seat, hasPlayedLandThisTurn(seat.id, session.turn), activeSeatId);
    const hasAttack = seat.board.battlefield.some((card) => canAttack(card));

    if (session.phase === "precombat main phase") return !hasMainAction && !hasAttack;
    if (session.phase === "declare attackers step") return !hasAttack && !hasAgentMainPhaseAction(seat, true, activeSeatId);
    if (session.phase === "postcombat main phase") return !hasMainAction;
    return false;
  }

  function fastForwardAgentToEndStep(seatId: string) {
    setSession((current) => {
      const active = current.seats.find((seat) => seat.id === seatId);
      if (!active || current.activePlayerId !== seatId || current.phase === "end step" || current.phase === "cleanup step") return current;
      clearManaPool(seatId);
      setPrioritySeatId(nextSeatId(current.seats, seatId));
      return clearCombatState({
        ...current,
        phase: "end step",
        events: [
          phaseEvent(seatId, `${active.name} has no profitable actions and moves to the end step.`),
          ...current.events
        ]
      });
    });
  }

  function applyAgentPriorityAction(seat: PlayerSeat, legal: LegalAgentAction, actionOnStack: PendingAction) {
    if (actionOnStack.type === "trigger" && actionOnStack.controllerSeatId === seat.id && legal.id === "resolve-trigger") {
      resolveAgentPendingTrigger(actionOnStack);
      return;
    }
    if (legal.actionType === "cast_spell" && legal.cardId) {
      agentRespondWithCard(seat, legal.cardId);
      return;
    }
    if (legal.actionType === "activate_ability" && legal.cardId && legal.abilityKind === "basic_land_fetch") {
      const cardId = legal.cardId;
      setSession((current) => resolveBasicLandFetchSearch(current, seat.id, cardId));
      window.setTimeout(() => passPriority(), 0);
      return;
    }
    passPriority();
  }

  function agentRespondWithCard(seat: PlayerSeat, cardId: string) {
    if (!pendingAction) return;
    const card = seat.board.hand.find((item) => item.id === cardId);
    if (!card || !canCastAtInstantSpeed(card)) {
      passPriority();
      return;
    }
    const fixedCost = adjustedCastingCost(seat, card, card.manaValue, "hand", activeSeatId);
    const chosenX = maxAffordableX(seat, card, fixedCost);
    const adjustedCost = fixedCost + xSymbolCount(card.manaCost) * chosenX;
    const payment = chooseManaSourcesForCost(seat, card, adjustedCost);
    if (!payment.ok) {
      addEvent(cannotPayMessage(seat, card, selectedManaTotal(seat, payment.sourceIds), adjustedCost, payment.reason), seat.id, "Mana");
      passPriority();
      return;
    }
    const action: PendingAction = {
      id: crypto.randomUUID(),
      type: "spell",
      actorSeatId: seat.id,
      cardId,
      cardName: card.name,
      manaSourceIds: payment.sourceIds,
      chosenX: chosenX > 0 ? chosenX : undefined,
      message: `${seat.name} responds with ${card.name}${chosenX > 0 ? ` (X=${chosenX})` : ""} using ${selectedManaTotal(seat, payment.sourceIds)} mana.`
    };
    beginPendingAction(action, "Stack");
  }

  function resolveAgentPendingTrigger(trigger: Extract<PendingAction, { type: "trigger" }>) {
    setPendingAction(undefined);
    setPriorityPasses([]);
    const remainingStack = removeStackAction(trigger.id);
    setSession((current) => resolveTriggerEffect(current, trigger));
    if (trigger.parentAction) {
      window.setTimeout(() => beginPendingAction(trigger.parentAction!, "Stack"), 0);
    } else {
      resumeTopStackAction(remainingStack);
    }
  }

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

  async function startGame() {
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
    const agentResolved = await resolveAgentMulligansWithLLM(openingSeats);
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
    setManaContributions({});
    setManaChoice(undefined);
    setManualLibrarySearch(undefined);
    setPendingRuleChoice(undefined);
    setBlockChoice(undefined);
    setSetupMessage(undefined);
    setGameStage("mulligan");
    setMode("game");
  }

  async function resolveAgentMulligansWithLLM(seats: PlayerSeat[]) {
    const mulliganCounts: Record<string, number> = {};
    const kept: Record<string, boolean> = {};
    const events: GameEvent[] = [];
    const resolvedSeats: PlayerSeat[] = [];

    for (const seat of seats) {
      if (seat.kind !== "agent") {
        resolvedSeats.push(seat);
        continue;
      }

      let nextSeat = seat;
      let count = 0;
      while (count < 3) {
        const actions: LegalAgentAction[] = [
          { id: "keep-hand", actionType: "keep_hand", targetIds: [], label: `keep ${openingHandKeepSize(count)}` },
          { id: "mulligan", actionType: "mulligan", targetIds: [], label: "take a mulligan" }
        ];
        let chosen: AgentAction | undefined;
        try {
          chosen = await requestAgentDecision(nextSeat, "opening_hand_mulligan", actions);
        } catch {
          chosen = undefined;
        }
        const chosenId = chosen?.legalActionId ?? (agentKeepsHand(nextSeat) ? "keep-hand" : "mulligan");
        if (chosenId === "keep-hand") break;
        count += 1;
        nextSeat = withOpeningHand(nextSeat, 7, count);
      }

      mulliganCounts[seat.id] = count;
      kept[seat.id] = true;
      nextSeat = keepOpeningHandSize(nextSeat, openingHandKeepSize(count));
      events.push({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: seat.id,
        message: count === 0 ? `${seat.name} kept 7.` : `${seat.name} mulliganed and kept ${openingHandKeepSize(count)}.`,
        detail: "Agent decision"
      });
      resolvedSeats.push(nextSeat);
    }

    return { seats: resolvedSeats, mulligans: mulliganCounts, keptHands: kept, events };
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
      loyaltyActivationsThisTurn.current.clear();
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

    const nextSeat = nextInRotation(current.seats, activeIndex);
    clearManaPool(seatId);
    setActiveSeatId(nextSeat.id);
    setPrioritySeatId(nextSeatId(current.seats, nextSeat.id));
    loyaltyActivationsThisTurn.current.clear();

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

  function declareAttack(session: GameSession, seatId: string, cardId: string | undefined, targetId: string | undefined): GameSession {
    const attacker = session.seats.find((seat) => seat.id === seatId);
    if (!attacker) return session;
    const attackingCard = attacker.board.battlefield.find((card) => card.id === cardId && canAttack(card));
    const target = resolveAttackTarget(session, targetId);

    if (!attackingCard || !target) {
      return {
        ...session,
        events: [phaseEvent(seatId, `${attacker.name} declares no attackers.`), ...session.events]
      };
    }

    const targetLabel = target.planeswalker ? `${target.planeswalker.name} (${target.seat.name})` : target.seat.name;
    const tax = totalAttackTax(target.seat, Boolean(target.planeswalker));
    const payment = tax > 0 ? chooseManaSourcesForCost(attacker, genericCostShim(tax), tax) : undefined;
    if (tax > 0 && !payment?.ok) {
      return {
        ...session,
        events: [
          phaseEvent(seatId, `${attacker.name} cannot attack ${targetLabel} with ${attackingCard.name}: unable to pay the {${tax}} attack tax.`),
          ...session.events
        ]
      };
    }

    const staysUntapped = hasVigilance(attackingCard);
    const taxedBattlefield = payment?.ok ? tapManaSources(attacker.board.battlefield, payment.sourceIds) : attacker.board.battlefield;

    return {
      ...session,
      seats: session.seats.map((seat) =>
        seat.id === seatId
          ? {
              ...seat,
              board: {
                ...seat.board,
                battlefield: taxedBattlefield.map((card) =>
                  card.id === attackingCard.id
                    ? { ...card, attacking: true, tapped: staysUntapped ? card.tapped : true, attackTargetId: target.planeswalker?.id ?? target.seat.id }
                    : card
                )
              }
            }
          : seat
      ),
      events: [
        phaseEvent(
          seatId,
          `${attacker.name} attacks ${targetLabel} with ${attackingCard.name}${tax > 0 ? ` after paying {${tax}} for the attack tax` : ""}.`
        ),
        ...session.events
      ]
    };
  }

  function resolveAgentBlockChoice(session: GameSession, choice: BlockChoiceState, blockerCardId: string | undefined): GameSession {
    const attacker = session.seats.find((seat) => seat.id === choice.attackerSeatId);
    const defender = session.seats.find((seat) => seat.id === choice.defenderSeatId);
    const attackingCard = attacker?.board.battlefield.find((card) => card.id === choice.attackerCardId && card.attacking);
    const blocker = defender?.board.battlefield.find((card) => card.id === blockerCardId && canBlock(card, attackingCard));
    if (!attacker || !defender || !attackingCard) return session;
    const decidedSession = markAttackDecided(session, attacker.id, attackingCard.id);
    if (!blocker) {
      return {
        ...decidedSession,
        events: [phaseEvent(defender.id, `${defender.name} declares no blockers for ${attackingCard.name}.`), ...decidedSession.events]
      };
    }

    return {
      ...decidedSession,
      seats: decidedSession.seats.map((seat) =>
        seat.id === defender.id
          ? {
              ...seat,
              board: {
                ...seat.board,
                battlefield: seat.board.battlefield.map((card) =>
                  card.id === blocker.id ? { ...card, blocking: true, blockingTargetId: attackingCard.id } : card
                )
              }
            }
          : seat
      ),
      events: [phaseEvent(defender.id, `${defender.name} blocks ${attackingCard.name} with ${blocker.name}.`), ...decidedSession.events]
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
    clearManaContributions(seat.id);
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
    const attacker = session.seats.find((seat) => seat.id === attackerId);
    if (!attacker) return session;
    const attackingCardIds = attacker.board.battlefield.filter((card) => card.attacking).map((card) => card.id);
    if (attackingCardIds.length === 0) {
      return {
        ...session,
        events: [phaseEvent(attackerId, "No attacking creatures assign combat damage."), ...session.events]
      };
    }

    let result = session;
    for (const cardId of attackingCardIds) {
      const currentAttacker = result.seats.find((seat) => seat.id === attackerId);
      const attackingCard = currentAttacker?.board.battlefield.find((card) => card.id === cardId);
      if (!attackingCard) continue;
      const target = resolveAttackTarget(result, attackingCard.attackTargetId);
      if (!target) continue;
      const blocker = target.seat.board.battlefield.find((card) => card.blocking && card.blockingTargetId === attackingCard.id);
      result = blocker
        ? resolveBlockedCombatDamage(result, attackerId, attackingCard, target, blocker)
        : applyCombatDamageToTarget(result, attackingCard.name, target, Math.max(0, effectivePower(attackingCard)), attackingCard);
    }
    return result;
  }

  function cleanupCombat(session: GameSession, seatId: string): GameSession {
    const seat = session.seats.find((item) => item.id === seatId);
    return {
      ...clearCombatState(session),
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
    const next = drawForSeat(session, seatId, `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} draws a card.`);
    setSession(next);
    checkMiracleAfterDraw(session, next);
  }

  function checkMiracleAfterDraw(priorSession: GameSession, nextSession: GameSession) {
    for (const nextSeat of nextSession.seats) {
      const priorHand = priorSession.seats.find((seat) => seat.id === nextSeat.id)?.board.hand ?? [];
      const nextHand = nextSeat.board.hand;
      if (nextHand.length <= priorHand.length) continue;

      const turnKey = `${nextSession.turn}:${nextSeat.id}`;
      if (firstDrawThisTurn.current.has(turnKey)) continue;
      firstDrawThisTurn.current.add(turnKey);

      const priorIds = new Set(priorHand.map((card) => card.id));
      const firstDrawn = nextHand.find((card) => !priorIds.has(card.id));
      if (!firstDrawn) continue;

      const granter = findMiracleGranter(nextSeat);
      if (!granter || !firstDrawn.typeLine.includes("Enchantment")) continue;

      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "miracle_offer",
        controllerSeatId: nextSeat.id,
        sourceCardId: firstDrawn.id,
        sourceCardName: firstDrawn.name,
        prompt: `${granter.name} grants miracle. Cast ${firstDrawn.name} for its miracle cost, or it stays in hand at full cost.`,
        miracleCost: miracleCostFor(firstDrawn)
      });
      return;
    }
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

  function playCard(seatId: string, cardId: string, position?: { x: number; z: number }, sourceZone: "hand" | "command" = "hand", faceIndex?: number) {
    if (pendingAction) return;
    const seat = session.seats.find((item) => item.id === seatId);
    const card = sourceZone === "command" ? seat?.board.commander : seat?.board.hand.find((item) => item.id === cardId);
    if (!seat || !card) return;

    if (sourceZone === "command" && card.id !== cardId) return;

    const dfcSplit = modalDoubleFacedLandSplit(card);
    const doors = roomDoorFaces(card);
    const playingAsLand = dfcSplit ? faceIndex === dfcSplit.landIndex : isLandCard(card);

    if (playingAsLand) {
      if (sourceZone !== "hand") return;
      if (hasPlayedLandThisTurn(seatId, session.turn)) {
        addEvent(`${seat.name} already played a land this turn.`, seatId, "Mana");
        return;
      }
      landPlaysThisTurn.current.add(landTurnKey(seatId, session.turn));
      const playedName = faceIndex !== undefined ? card.faces?.[faceIndex]?.name ?? card.name : card.name;
      setSession((current) => {
        const nextSession = playCardFromZone(current, seatId, cardId, `${seat.name} plays ${playedName}.`, position, "battlefield", [], "hand", faceIndex);
        const triggers = findCommonTriggersForPermanentEntered(nextSession, seatId, card);
        if (triggers.length > 0) {
          window.setTimeout(() => queueCommonTriggers(triggers), 0);
        }
        return nextSession;
      });
      void consultRulesAdvisor("land_played", seatId, card);
      void consultStaticEffectInterpreter(seatId, card);
      setSelectedHandCardId(undefined);
      return;
    }

    const doorFace = doors && faceIndex !== undefined ? doors[faceIndex] : undefined;
    const costCard = doorFace ? cardWithFaceManaCost(card, doorFace.manaCost) : card;
    const baseCost = doorFace ? manaValueFromManaCost(doorFace.manaCost) : card.manaValue;
    const fixedCost = adjustedCastingCost(seat, costCard, baseCost, sourceZone, activeSeatId) + (sourceZone === "command" ? card.commanderTax ?? 0 : 0);
    const chosenX = doorFace ? 0 : maxAffordableX(seat, costCard, fixedCost, seat.kind === "human" ? poolForSeat(seatId) : undefined);
    const totalCost = fixedCost + xSymbolCount(costCard.manaCost) * chosenX;
    const payment = seat.kind === "human" ? payCostFromPool(poolForSeat(seatId), costCard, totalCost) : chooseManaSourcesForCost(seat, costCard, totalCost);
    const availableMana = seat.kind === "human" ? manaPoolTotal(poolForSeat(seatId)) : selectedManaTotal(seat, payment.sourceIds);
    if (!payment.ok) {
      addEvent(cannotPayMessage(seat, costCard, availableMana, totalCost, payment.reason), seatId, "Mana");
      setSelectedHandCardId(undefined);
      return;
    }

    if (seat.kind === "human") {
      setSeatManaPool(seatId, payment.pool);
      clearManaContributions(seatId);
    }

    const castName = doorFace?.name ?? (dfcSplit ? dfcSplit.spellFace.name : card.name);
    const spentManaText = seat.kind === "human" && payment.ok ? ` spending ${formatManaPoolPayment(payment.spent)}` : ` using ${availableMana} mana`;
    const xText = chosenX > 0 ? ` (X=${chosenX})` : "";
    const action: PendingAction = {
      id: crypto.randomUUID(),
      type: "spell",
      actorSeatId: seatId,
      cardId,
      cardName: castName,
      sourceZone,
      manaSourceIds: payment.sourceIds,
      position,
      faceIndex: doorFace ? faceIndex : dfcSplit?.spellIndex,
      chosenX: chosenX > 0 ? chosenX : undefined,
      message: `${seat.name} casts ${castName}${xText}${sourceZone === "command" ? " from the command zone" : ""}${spentManaText}.`
    };
    beginPendingAction(action, "Stack");
    setSelectedHandCardId(undefined);
  }

  function declareHumanAttack(cardId: string, targetId: string) {
    if (pendingAction || activeSeatId !== humanSeat.id) return;
    setSession((current) => declareAttack(current, humanSeat.id, cardId, targetId));
    setInspectedCard(undefined);
  }

  function unlockRoomDoor(seatId: string, cardId: string, faceIndex: number) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    const doors = card ? roomDoorFaces(card) : undefined;
    if (!seat || !card || !doors) return;
    const lockedDoor = doors[faceIndex];
    const shim = cardWithFaceManaCost(card, lockedDoor.manaCost);
    const totalCost = manaValueFromManaCost(lockedDoor.manaCost);
    // Unlocking is paid for on the spot rather than through the normal pre-tap-then-cast flow, so
    // auto-select untapped battlefield sources for both humans and agents (mirrors acceptMiracleOffer).
    const payment = chooseManaSourcesForCost(seat, shim, totalCost);
    if (!payment.ok) {
      addEvent(cannotPayMessage(seat, shim, selectedManaTotal(seat, payment.sourceIds), totalCost, payment.reason), seatId, "Mana");
      return;
    }
    setSession((current) => ({
      ...current,
      seats: current.seats.map((item) => {
        if (item.id !== seatId) return item;
        return {
          ...item,
          board: {
            ...item.board,
            battlefield: tapManaSources(item.board.battlefield, payment.sourceIds).map((permanent) =>
              permanent.id === cardId ? unlockSecondRoomDoor(permanent, faceIndex) : permanent
            )
          }
        };
      }),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} unlocks ${lockedDoor.name} on ${card.name} using ${formatManaPoolPayment(payment.spent)}.`
        },
        ...current.events
      ]
    }));
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
    const fixedCost = adjustedCastingCost(humanSeat, card, card.manaValue, "hand", activeSeatId);
    const chosenX = maxAffordableX(humanSeat, card, fixedCost, poolForSeat(humanSeat.id));
    const adjustedCost = fixedCost + xSymbolCount(card.manaCost) * chosenX;
    const payment = payCostFromPool(poolForSeat(humanSeat.id), card, adjustedCost);
    const availableMana = manaPoolTotal(poolForSeat(humanSeat.id));
    if (!isLandCard(card) && !payment.ok) {
      addEvent(cannotPayMessage(humanSeat, card, availableMana, adjustedCost, payment.reason), humanSeat.id, "Mana");
      return;
    }
    if (!isLandCard(card)) {
      setSeatManaPool(humanSeat.id, payment.pool);
      clearManaContributions(humanSeat.id);
    }
    const action: PendingAction = {
      id: crypto.randomUUID(),
      type: "spell",
      actorSeatId: humanSeat.id,
      cardId: selectedHandCardId,
      cardName: card.name,
      manaSourceIds,
      chosenX: chosenX > 0 ? chosenX : undefined,
      message: `${humanSeat.name} responds with ${card.name}${chosenX > 0 ? ` (X=${chosenX})` : ""}.`
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
    setSession((current) => resolveTriggerEffect(current, trigger));
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
      setSession((current) => {
        const next = resolvePhaseAdvance(current);
        checkMiracleAfterDraw(current, next);
        return next;
      });
      return;
    }

    if (action.type === "trigger") {
      const remainingStack = removeStackAction(action.id);
      setSession((current) => {
        const next = resolveTriggerEffect(current, action);
        checkMiracleAfterDraw(current, next);
        return next;
      });
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
    setSession((current) => {
      const destination = spellResolutionDestination(current, action);
      const rawSourceCard = findSpellSourceCard(current, action);
      const sourceCard = rawSourceCard ? applyChosenFaceToCard(rawSourceCard, action.faceIndex) : undefined;
      // Only the entering permanent's own ETB-effect text counts here — a "dies" trigger or an
      // activated ability elsewhere in the same oracle text (e.g. Hangarback Walker's death
      // trigger) must not be read as something that happens immediately on resolution.
      const tokenSpecs = sourceCard ? parseCreateTokenSpecs(etbEffectText(sourceCard.oracleText)) : [];
      const baseResolvedSession = playCardFromZone(
        current,
        action.actorSeatId,
        action.cardId,
        `${action.cardName} resolves.`,
        action.position,
        destination,
        action.manaSourceIds,
        action.sourceZone ?? "hand",
        action.faceIndex
      );
      const tokenCreation = sourceCard && tokenSpecs.length > 0 ? createTokensForSeat(baseResolvedSession, action.actorSeatId, sourceCard.id, tokenSpecs) : undefined;
      const tokenResolvedSession = tokenCreation?.session ?? baseResolvedSession;
      const resolvedSession =
        sourceCard && destination === "battlefield" && action.chosenX && entersWithXCounters(sourceCard.oracleText)
          ? applyEntersWithXCounters(tokenResolvedSession, action.actorSeatId, sourceCard.id, action.chosenX)
          : tokenResolvedSession;
      const queuedTriggers = sourceCard && destination === "battlefield" ? findCommonTriggersForPermanentEntered(resolvedSession, action.actorSeatId, sourceCard) : [];
      if (sourceCard) {
        void consultRulesAdvisor(destination === "battlefield" ? "spell_resolved_to_battlefield" : "spell_resolved_to_graveyard", action.actorSeatId, sourceCard);
        if (destination === "battlefield") {
          void consultStaticEffectInterpreter(action.actorSeatId, sourceCard);
        }
      }
      const allQueuedTriggers = [...queuedTriggers, ...(tokenCreation?.triggers ?? [])];
      if (allQueuedTriggers.length > 0) {
        window.setTimeout(() => queueCommonTriggers(allQueuedTriggers), 0);
      } else if (!resumeTopStackAction(remainingStack)) {
        setPrioritySeatId(action.actorSeatId);
      }
      return resolvedSession;
    });
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

  function queueCommonTriggers(triggers: Array<Extract<PendingAction, { type: "trigger" }>>) {
    if (triggers.length === 0) return;
    const [firstTrigger, ...laterTriggers] = triggers;
    if (laterTriggers.length > 0) {
      replaceStackActions([...stackActionsRef.current, ...laterTriggers]);
      addEvent(`${triggers.length} triggered abilities were put onto the stack.`, firstTrigger.controllerSeatId, "Trigger");
    }
    beginPendingAction(firstTrigger, "Trigger");
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
      setSession((current) => {
        const next = drawMultipleForSeat(current, seatId, count, `${seat?.name ?? "Player"} draws ${count} from ${sourceCard.name}.`);
        checkMiracleAfterDraw(current, next);
        return next;
      });
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

  // Runs once when a permanent enters the battlefield: interprets static abilities that tax
  // attacking (Propaganda-style effects) so the result can be cached on the card and enforced
  // deterministically thereafter, instead of re-parsing oracle text every combat.
  async function consultStaticEffectInterpreter(seatId: string, card: VisibleCard) {
    if (!looksLikeAttackTaxCandidate(card.oracleText)) return;
    try {
      const response = await fetch("/api/rules/static-effect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceCardId: card.id, sourceCardName: card.name, oracleText: card.oracleText })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = (await response.json()) as { source: "deterministic" | "ollama" | "fallback"; effect?: InterpretedEffect };
      if (result.effect) applyInterpretedEffect(seatId, card.id, result.effect);
    } catch (error) {
      addEvent(
        `Static-effect interpreter could not evaluate ${card.name}: ${error instanceof Error ? error.message : "unknown error"}.`,
        seatId,
        "Rules advisor"
      );
    }
  }

  function applyInterpretedEffect(seatId: string, cardId: string, effect: InterpretedEffect) {
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) =>
        seat.id === seatId
          ? {
              ...seat,
              board: {
                ...seat.board,
                battlefield: seat.board.battlefield.map((card) =>
                  card.id === cardId ? { ...card, interpretedEffects: [...(card.interpretedEffects ?? []), effect] } : card
                )
              }
            }
          : seat
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `Static-effect interpreter (${effect.interpretedBy}): ${effect.sourceCardName} taxes attackers ${
            effect.formula === "enchantment_count" ? "{1} per enchantment its controller controls" : `{${effect.amountPerAttacker}}`
          } per attacking creature.`,
          detail: "Rules advisor"
        },
        ...current.events
      ]
    }));
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
    const nextSession = moveCardBetweenVisibleZones(session, seatId, cardId, "graveyard");
    const triggers = card && card.zone === "battlefield" ? findCommonTriggersForPermanentDied(nextSession, seatId, card) : [];
    setSession(nextSession);
    if (card) void consultRulesAdvisor("card_moved_to_graveyard", seatId, card);
    if (triggers.length > 0) {
      window.setTimeout(() => queueCommonTriggers(triggers), 0);
    }
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
    setSession((current) => {
      const next = {
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
              current.seats.find((seat) => seat.id === seatId)?.board.battlefield.find((card) => card.id === cardId)?.name ?? "a permanent"
            }.`
          },
          ...current.events
        ]
      };
      return next;
    });
  }

  function activateLoyaltyAbility(seatId: string, cardId: string, loyaltyCost: number, abilityText: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    if (!seat || !card || !isPlaneswalkerCard(card)) return;
    if (seat.id !== activeSeatId || seat.kind !== "human") {
      addEvent(`${seat.name} can activate loyalty abilities only during their own turn.`, seat.id, "Loyalty");
      return;
    }
    if (pendingAction || !isMainPhase(session.phase)) {
      addEvent(`${card.name}'s loyalty ability can be activated only during a main phase while the stack is empty.`, seat.id, "Loyalty");
      return;
    }
    const key = loyaltyTurnKey(seat.id, card.id, session.turn);
    if (loyaltyActivationsThisTurn.current.has(key)) {
      addEvent(`${card.name} already activated a loyalty ability this turn.`, seat.id, "Loyalty");
      return;
    }
    if (loyaltyCost < 0 && loyaltyCounterCount(card) < Math.abs(loyaltyCost)) {
      addEvent(`${card.name} does not have enough loyalty counters for ${formatLoyaltyCost(loyaltyCost)}.`, seat.id, "Loyalty");
      return;
    }

    loyaltyActivationsThisTurn.current.add(key);
    setSession((current) => ({
      ...current,
      seats: current.seats.map((item) =>
        item.id === seatId
          ? {
              ...item,
              board: {
                ...item.board,
                battlefield: item.board.battlefield.map((permanent) => (permanent.id === cardId ? applyCounterDelta(permanent, "loyalty", loyaltyCost) : permanent))
              }
            }
          : item
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} activates ${card.name} ${formatLoyaltyCost(loyaltyCost)}: ${abilityText}`,
          detail: "Loyalty"
        },
        ...current.events
      ]
    }));

    const effect = commonTriggerEffect(abilityText, "entered");
    if (effect) {
      const trigger: Extract<PendingAction, { type: "trigger" }> = {
        id: crypto.randomUUID(),
        type: "trigger",
        actorSeatId: seatId,
        controllerSeatId: seatId,
        sourceCardId: card.id,
        sourceCardName: card.name,
        triggerKind: "common",
        effect,
        message: `${card.name}'s loyalty ability is on the stack.`
      };
      window.setTimeout(() => queueCommonTriggers([trigger]), 0);
      return;
    }

    void consultRulesAdvisor("loyalty_ability", seatId, { ...card, oracleText: abilityText });
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

  function resolveBasicLandFetch(seatId: string, cardId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    setInspectedCard(undefined);
    if (!seat || !card || !isBasicLandFetchAbility(card)) return;
    if (card.tapped) {
      addEvent(`${card.name} is tapped and cannot activate its fetch ability.`, seatId, "Rules action");
      return;
    }
    const options = getBasicLandFetchOptions(seat.library ?? []);
    if (options.length === 0) {
      addEvent(`${seat.name} has no basic lands to find with ${card.name}.`, seatId, "Rules action");
      return;
    }
    setBasicLandFetchSearch({ seatId, sourceCardId: cardId, sourceCardName: card.name });
  }

  function completeBasicLandFetch(cardId: string) {
    const activeSearch = basicLandFetchSearch;
    if (!activeSearch) return;
    setSession((current) => resolveBasicLandFetchSearch(current, activeSearch.seatId, activeSearch.sourceCardId, cardId));
    setBasicLandFetchSearch(undefined);
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

  function acceptMiracleOffer() {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "miracle_offer") return;
    const seat = session.seats.find((item) => item.id === choice.controllerSeatId);
    const card = seat?.board.hand.find((item) => item.id === choice.sourceCardId);
    if (!seat || !card) {
      setPendingRuleChoice(undefined);
      return;
    }

    // Miracle is an interrupt that fires the instant a card is drawn, so a human never gets a
    // chance to pre-tap lands into their floating pool the way normal casting requires. Auto-select
    // untapped battlefield sources instead, same as the agent path, and tap them on resolution.
    const payment = chooseManaSourcesForCost(seat, card, choice.miracleCost);
    if (!payment.ok) {
      addEvent(cannotPayMessage(seat, card, selectedManaTotal(seat, payment.sourceIds), choice.miracleCost, payment.reason), seat.id, "Rules advisor");
      setPendingRuleChoice(undefined);
      return;
    }

    setPendingRuleChoice(undefined);
    beginPendingAction(
      {
        id: crypto.randomUUID(),
        type: "spell",
        actorSeatId: seat.id,
        cardId: card.id,
        cardName: card.name,
        sourceZone: "hand",
        manaSourceIds: payment.sourceIds,
        message: `${seat.name} casts ${card.name} for its miracle cost (${choice.miracleCost}) using ${formatManaPoolPayment(payment.spent)}.`
      },
      "Stack"
    );
  }

  function declineMiracleOffer() {
    const choice = pendingRuleChoice;
    if (choice?.kind === "miracle_offer") {
      addEvent(`${session.seats.find((seat) => seat.id === choice.controllerSeatId)?.name ?? "Player"} declines to cast ${choice.sourceCardName} for its miracle cost.`, choice.controllerSeatId, "Rules advisor");
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
    if (choice.kind === "miracle_offer") {
      const card = seat.board.hand.find((item) => item.id === choice.sourceCardId);
      const payment = card ? chooseManaSourcesForCost(seat, card, choice.miracleCost) : undefined;
      if (card && payment?.ok) {
        acceptMiracleOffer();
        return;
      }
      declineMiracleOffer();
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

    if (card?.tapped) {
      removeManaContribution(seatId, cardId);
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
    addManaContribution(seatId, cardId, color, amount);
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
        selectedCardFaceOptions={selectedCardFaceOptions}
        onPlayCardFace={(seatId, cardId, faceIndex) => playCard(seatId, cardId, undefined, "hand", faceIndex)}
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
        onActivateLoyalty={activateLoyaltyAbility}
        onCastCommander={castCommander}
        onResolveMyriadLandscape={resolveMyriadLandscape}
        onResolveBasicLandFetch={resolveBasicLandFetch}
        onChangeLife={changeLife}
        onScry={(count) => startLibraryLook("scry", count)}
        onSurveil={(count) => startLibraryLook("surveil", count)}
        libraryLook={libraryLook}
        ruleChoice={ruleChoiceView(pendingRuleChoice, humanSeat, manualLibrarySearch)}
        onAcceptMiracle={acceptMiracleOffer}
        onDeclineMiracle={declineMiracleOffer}
        myriadSearchCards={myriadSearch ? getMyriadLandscapeOptions(humanSeat.library ?? []) : undefined}
        basicLandFetchSearch={
          basicLandFetchSearch
            ? {
                sourceCardName: basicLandFetchSearch.sourceCardName,
                cards: getBasicLandFetchOptions(humanSeat.library ?? [])
              }
            : undefined
        }
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
        onCloseBasicLandFetchSearch={() => setBasicLandFetchSearch(undefined)}
        onCompleteBasicLandFetchSearch={completeBasicLandFetch}
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
        lockedRoomDoorFaceIndex={inspectedRoomLockedFaceIndex}
        onUnlockRoomDoor={unlockRoomDoor}
        humanAttackTargets={humanAttackTargets}
        onDeclareAttack={declareHumanAttack}
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
    loyalty: card?.loyalty ?? existing?.loyalty,
    tapped: existing?.tapped,
    summoningSick: existing?.summoningSick,
    counters: existing?.counters
  };
}

function canAttack(card: VisibleCard) {
  return card.typeLine.includes("Creature") && !card.tapped && !card.summoningSick && !card.attacking;
}

function canBlock(card: VisibleCard, attacker?: VisibleCard) {
  if (!card.typeLine.includes("Creature") || card.tapped || card.blocking) return false;
  if (attacker && hasFlying(attacker) && !hasFlying(card) && !hasReach(card)) return false;
  return true;
}

function hasKeyword(card: VisibleCard, keyword: string) {
  return new RegExp(`\\b${keyword}\\b`, "i").test(card.oracleText);
}

function hasFlying(card: VisibleCard) {
  return hasKeyword(card, "flying");
}

function hasReach(card: VisibleCard) {
  return hasKeyword(card, "reach");
}

function hasMenace(card: VisibleCard) {
  return hasKeyword(card, "menace");
}

function hasDeathtouch(card: VisibleCard) {
  return hasKeyword(card, "deathtouch");
}

function hasTrample(card: VisibleCard) {
  return hasKeyword(card, "trample");
}

function hasFirstStrike(card: VisibleCard) {
  return hasKeyword(card, "first strike");
}

function hasDoubleStrike(card: VisibleCard) {
  return hasKeyword(card, "double strike");
}

function hasIndestructible(card: VisibleCard) {
  return hasKeyword(card, "indestructible");
}

function hasVigilance(card: VisibleCard) {
  return hasKeyword(card, "vigilance");
}

function describeKeywords(card: VisibleCard): string[] {
  const keywords: string[] = [];
  if (hasFlying(card)) keywords.push("flying");
  if (hasReach(card)) keywords.push("reach");
  if (hasMenace(card)) keywords.push("menace");
  if (hasDeathtouch(card)) keywords.push("deathtouch");
  if (hasTrample(card)) keywords.push("trample");
  if (hasDoubleStrike(card)) keywords.push("double strike");
  else if (hasFirstStrike(card)) keywords.push("first strike");
  if (hasIndestructible(card)) keywords.push("indestructible");
  if (hasVigilance(card)) keywords.push("vigilance");
  return keywords;
}

function resolveAttackTarget(session: GameSession, targetId: string | undefined): { seat: PlayerSeat; planeswalker?: VisibleCard } | undefined {
  if (!targetId) return undefined;
  const seat = session.seats.find((item) => item.id === targetId);
  if (seat) return { seat };
  for (const candidate of session.seats) {
    const planeswalker = candidate.board.battlefield.find((card) => card.id === targetId && isPlaneswalkerCard(card));
    if (planeswalker) return { seat: candidate, planeswalker };
  }
  return undefined;
}

function markAttackDecided(session: GameSession, seatId: string, cardId: string): GameSession {
  return {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === seatId
        ? {
            ...seat,
            board: {
              ...seat.board,
              battlefield: seat.board.battlefield.map((card) => (card.id === cardId ? { ...card, blockDecided: true } : card))
            }
          }
        : seat
    )
  };
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

function isPlaneswalkerCard(card: VisibleCard) {
  return card.typeLine.includes("Planeswalker");
}

function loyaltyCounterCount(card: VisibleCard) {
  return card.counters?.find((counter) => counter.kind === "loyalty")?.count ?? 0;
}

function withInitialLoyaltyCounters(card: VisibleCard) {
  if (loyaltyCounterCount(card) > 0) return card.counters;
  const printed = Number.parseInt(card.loyalty ?? "", 10);
  if (!Number.isFinite(printed) || printed <= 0) return card.counters;
  return [...(card.counters ?? []), { kind: "loyalty", count: printed }];
}

// Reuses the same "+1/+1" counter kind the manual inspector +/- controls already write, so
// counters gained either way stay consistent.
function plusOneCounterCount(card: VisibleCard) {
  return card.counters?.find((counter) => counter.kind === "+1/+1")?.count ?? 0;
}

function entersWithXCounters(oracleText: string): boolean {
  return /\benters?(?: the battlefield)? with x \+1\/\+1 counters? on (?:it|this (?:creature|artifact|permanent))\b/i.test(oracleText);
}

// Hangarback Walker/Walking Ballista-style permanents print base power/toughness "0/0" and rely
// entirely on their enters-with-X-counters clause. Counters are the single source of truth for
// +1/+1 bonuses (see src/lib/counters.ts's effectivePower/effectiveToughness) — every read site
// computes the bonus from here rather than having it baked into the printed power/toughness.
function applyEntersWithXCounters(session: GameSession, seatId: string, cardId: string, x: number): GameSession {
  if (x <= 0) return session;
  return {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === seatId
        ? {
            ...seat,
            board: {
              ...seat.board,
              battlefield: seat.board.battlefield.map((card) =>
                card.id === cardId
                  ? {
                      ...card,
                      counters: [...(card.counters ?? []).filter((counter) => counter.kind !== "+1/+1"), { kind: "+1/+1", count: x }]
                    }
                  : card
              )
            }
          }
        : seat
    )
  };
}

function isMainPhase(phase: string) {
  return phase === "precombat main phase" || phase === "postcombat main phase";
}

function loyaltyTurnKey(seatId: string, cardId: string, turn: number) {
  return `${turn}:${seatId}:${cardId}`;
}

function formatLoyaltyCost(cost: number) {
  return cost > 0 ? `+${cost}` : `${cost}`;
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

function legalMainPhaseActions(seat: PlayerSeat, hasPlayedLand: boolean, activeSeatId: string | undefined): LegalAgentAction[] {
  const actions: LegalAgentAction[] = [];
  if (!hasPlayedLand) {
    for (const card of seat.board.hand) {
      const split = modalDoubleFacedLandSplit(card);
      if (split) {
        actions.push({
          id: `play-land:${card.id}:face${split.landIndex}`,
          actionType: "play_land",
          cardId: card.id,
          faceIndex: split.landIndex,
          targetIds: [],
          label: `play ${split.landFace.name} (land side of ${card.name})`,
          detail: `${split.landFace.oracleText} (land drop available this turn)`.trim(),
          role: card.role
        });
        continue;
      }
      if (isLandCard(card)) {
        actions.push({
          id: `play-land:${card.id}`,
          actionType: "play_land",
          cardId: card.id,
          targetIds: [],
          label: `play land ${card.name}`,
          detail: `${card.oracleText} (land drop available this turn)`.trim(),
          role: card.role
        });
      }
    }
  }
  for (const card of seat.board.hand) {
    const split = modalDoubleFacedLandSplit(card);
    if (split) {
      const totalCost = adjustedCastingCost(seat, card, card.manaValue, "hand", activeSeatId);
      const payment = chooseManaSourcesForCost(seat, card, totalCost);
      if (payment.ok) {
        actions.push({
          id: `cast:${card.id}:face${split.spellIndex}`,
          actionType: "cast_spell",
          cardId: card.id,
          faceIndex: split.spellIndex,
          targetIds: [],
          label: `cast ${split.spellFace.name}`,
          detail: `${split.spellFace.manaCost ?? ""} ${split.spellFace.typeLine}. ${split.spellFace.oracleText} Payable with ${formatManaPoolPayment(payment.spent)}.`.trim(),
          role: card.role
        });
      }
      continue;
    }

    const doors = roomDoorFaces(card);
    if (doors) {
      doors.forEach((door, index) => {
        const shim = cardWithFaceManaCost(card, door.manaCost);
        const totalCost = adjustedCastingCost(seat, shim, manaValueFromManaCost(door.manaCost), "hand", activeSeatId);
        const payment = chooseManaSourcesForCost(seat, shim, totalCost);
        if (!payment.ok) return;
        actions.push({
          id: `cast:${card.id}:face${index}`,
          actionType: "cast_spell",
          cardId: card.id,
          faceIndex: index,
          targetIds: [],
          label: `cast ${door.name} (unlock this door)`,
          detail: `${door.manaCost ?? ""} ${door.typeLine}. ${door.oracleText} Payable with ${formatManaPoolPayment(payment.spent)}.`.trim(),
          role: card.role
        });
      });
      continue;
    }

    if (isLandCard(card)) continue;

    const fixedCost = adjustedCastingCost(seat, card, card.manaValue, "hand", activeSeatId);
    const chosenX = maxAffordableX(seat, card, fixedCost);
    const totalCost = fixedCost + xSymbolCount(card.manaCost) * chosenX;
    const payment = chooseManaSourcesForCost(seat, card, totalCost);
    if (!payment.ok) continue;
    const xNote = chosenX > 0 ? ` Casting for X=${chosenX}.` : "";
    actions.push({
      id: `cast:${card.id}`,
      actionType: "cast_spell",
      cardId: card.id,
      targetIds: [],
      label: chosenX > 0 ? `cast ${card.name} (X=${chosenX})` : `cast ${card.name}`,
      detail: `${card.manaCost ?? ""} ${card.typeLine}. ${card.oracleText} Payable with ${formatManaPoolPayment(payment.spent)}.${xNote}`.trim(),
      role: card.role
    });
  }
  actions.push(...legalRoomUnlockActions(seat));
  const commander = seat.board.commander;
  if (commander) {
    const totalCost = adjustedCastingCost(seat, commander, commander.manaValue, "command", activeSeatId) + (commander.commanderTax ?? 0);
    const payment = chooseManaSourcesForCost(seat, commander, totalCost);
    if (payment.ok) {
      actions.push({
        id: `cast-commander:${commander.id}`,
        actionType: "cast_commander",
        cardId: commander.id,
        targetIds: [],
        label: `cast commander ${commander.name}`,
        detail: `${commander.manaCost ?? ""} commander tax ${commander.commanderTax ?? 0}. ${commander.oracleText} Payable with ${formatManaPoolPayment(payment.spent)}.`.trim(),
        role: commander.role
      });
    }
  }
  actions.push(...legalActivatedAbilityActions(seat));
  actions.push({ id: "pass-phase", actionType: "pass_priority", targetIds: [], label: "pass this phase" });
  actions.push({ id: "end-turn", actionType: "end_turn", targetIds: [], label: "end turn and skip remaining phases" });
  return actions;
}

function hasAgentMainPhaseAction(seat: PlayerSeat, hasPlayedLand: boolean, activeSeatId: string | undefined) {
  return legalMainPhaseActions(seat, hasPlayedLand, activeSeatId).some((action) =>
    action.actionType === "play_land" || action.actionType === "cast_spell" || action.actionType === "cast_commander" || action.actionType === "activate_ability"
  );
}

function clearCombatState(session: GameSession): GameSession {
  return {
    ...session,
    seats: session.seats.map((seat) => ({
      ...seat,
      board: {
        ...seat.board,
        battlefield: seat.board.battlefield.map((card) => ({
          ...card,
          attacking: false,
          attackTargetId: undefined,
          blockDecided: false,
          blocking: false,
          blockingTargetId: undefined
        }))
      }
    }))
  };
}

function describeAttackOption(card: VisibleCard, legalBlockers: VisibleCard[], tax: number): string {
  const keywords = describeKeywords(card);
  const keywordText = keywords.length > 0 ? ` (${keywords.join(", ")})` : "";
  const taxText = tax > 0 ? ` Attacking here costs an additional {${tax}} generic mana due to a static effect.` : "";
  return `${effectivePower(card)}/${effectiveToughness(card)}${keywordText} ${card.oracleText} (${legalBlockers.length} untapped creature${legalBlockers.length === 1 ? "" : "s"} there could legally block).${taxText}`.trim();
}

function legalAttackActions(seat: PlayerSeat, opponents: PlayerSeat[] = []): LegalAgentAction[] {
  const attackers = seat.board.battlefield.filter(canAttack);
  const actions: LegalAgentAction[] = [];
  for (const card of attackers) {
    for (const opponent of opponents) {
      const legalBlockers = opponent.board.battlefield.filter((blocker) => canBlock(blocker, card));
      const tax = totalAttackTax(opponent, false);
      if (tax === 0 || chooseManaSourcesForCost(seat, genericCostShim(tax), tax).ok) {
        actions.push({
          id: `attack:${card.id}:${opponent.id}`,
          actionType: "attack",
          cardId: card.id,
          targetIds: [opponent.id],
          label: `attack ${opponent.name} with ${card.name}`,
          detail: describeAttackOption(card, legalBlockers, tax),
          role: card.role
        });
      }
      for (const planeswalker of opponent.board.battlefield.filter(isPlaneswalkerCard)) {
        const planeswalkerTax = totalAttackTax(opponent, true);
        if (planeswalkerTax > 0 && !chooseManaSourcesForCost(seat, genericCostShim(planeswalkerTax), planeswalkerTax).ok) continue;
        actions.push({
          id: `attack:${card.id}:${planeswalker.id}`,
          actionType: "attack",
          cardId: card.id,
          targetIds: [planeswalker.id],
          label: `attack ${planeswalker.name} (${opponent.name}'s planeswalker, ${loyaltyCounterCount(planeswalker)} loyalty) with ${card.name}`,
          detail: describeAttackOption(card, legalBlockers, planeswalkerTax),
          role: card.role
        });
      }
    }
  }
  actions.push({ id: "no-attacks", actionType: "pass_priority", targetIds: [], label: "declare no attackers" });
  return actions;
}

function legalPriorityActions(seat: PlayerSeat, pendingAction: PendingAction, activeSeatId: string | undefined): LegalAgentAction[] {
  if (pendingAction.type === "trigger" && pendingAction.controllerSeatId === seat.id) {
    return [{ id: "resolve-trigger", actionType: "pass_priority", targetIds: [], label: `resolve ${pendingAction.sourceCardName} trigger` }];
  }
  const actions: LegalAgentAction[] = seat.board.hand
    .filter((card) => canCastAtInstantSpeed(card))
    .filter((card) => {
      const fixedCost = adjustedCastingCost(seat, card, card.manaValue, "hand", activeSeatId);
      const chosenX = maxAffordableX(seat, card, fixedCost);
      return chooseManaSourcesForCost(seat, card, fixedCost + xSymbolCount(card.manaCost) * chosenX).ok;
    })
    .map((card) => ({
      id: `respond:${card.id}`,
      actionType: "cast_spell" as const,
      cardId: card.id,
      targetIds: [pendingAction.id],
      label: `respond with ${card.name}`,
      detail: `${card.manaCost ?? ""} ${card.typeLine}. ${card.oracleText}`.trim(),
      role: card.role
    }));
  actions.push(...legalActivatedAbilityActions(seat));
  actions.push({ id: "pass-priority", actionType: "pass_priority", targetIds: [pendingAction.id], label: "pass priority" });
  return actions;
}

function legalActivatedAbilityActions(seat: PlayerSeat): LegalAgentAction[] {
  return seat.board.battlefield
    .filter((card) => isBasicLandFetchAbility(card) && !card.tapped && getBasicLandFetchOptions(seat.library ?? []).length > 0)
    .map((card) => ({
      id: `activate-basic-fetch:${card.id}`,
      actionType: "activate_ability" as const,
      abilityKind: "basic_land_fetch" as const,
      cardId: card.id,
      targetIds: [],
      label: `activate ${card.name}`,
      detail: `Sacrifice ${card.name}: search your library for a basic land, put it onto the battlefield tapped, then shuffle.`
    }));
}

function legalRoomUnlockActions(seat: PlayerSeat): LegalAgentAction[] {
  const actions: LegalAgentAction[] = [];
  for (const card of seat.board.battlefield) {
    const doors = roomDoorFaces(card);
    if (!doors) continue;
    const unlocked = card.unlockedFaceIndices ?? [];
    if (unlocked.length !== 1) continue;
    const lockedIndex = unlocked[0] === 0 ? 1 : 0;
    const lockedDoor = doors[lockedIndex];
    const shim = cardWithFaceManaCost(card, lockedDoor.manaCost);
    const totalCost = manaValueFromManaCost(lockedDoor.manaCost);
    const payment = chooseManaSourcesForCost(seat, shim, totalCost);
    if (!payment.ok) continue;
    actions.push({
      id: `unlock-door:${card.id}`,
      actionType: "activate_ability",
      abilityKind: "unlock_room_door",
      faceIndex: lockedIndex,
      cardId: card.id,
      targetIds: [],
      label: `unlock ${lockedDoor.name} on ${card.name}`,
      detail: `${lockedDoor.manaCost ?? ""} ${lockedDoor.oracleText} Payable with ${formatManaPoolPayment(payment.spent)}.`.trim(),
      role: card.role
    });
  }
  return actions;
}

function createCombatBlockChoice(session: GameSession, attackerSeatId: string | undefined): BlockChoiceState | undefined {
  if (!attackerSeatId) return undefined;
  const attacker = session.seats.find((seat) => seat.id === attackerSeatId);
  const attackingCard = attacker?.board.battlefield.find((card) => card.attacking && !card.blockDecided);
  const target = attackingCard ? resolveAttackTarget(session, attackingCard.attackTargetId) : undefined;
  if (!attacker || !attackingCard || !target) return undefined;
  return {
    attackerSeatId: attacker.id,
    defenderSeatId: target.seat.id,
    attackerCardId: attackingCard.id,
    targetId: attackingCard.attackTargetId ?? target.seat.id
  };
}

// Runs after every session update (see the setSession wrapper below) so state-based actions are
// checked continuously rather than at scattered call sites, matching rule 704's "checked
// whenever a player would receive priority, all performed simultaneously, repeat until none
// remain" model as closely as this turn-driven engine reasonably can.
function checkStateBasedActions(session: GameSession): GameSession {
  let current = session;
  for (let guard = 0; guard < 10; guard += 1) {
    const result = runStateBasedActionsPass(current);
    current = result.session;
    if (!result.changed) break;
  }
  return current;
}

function runStateBasedActionsPass(session: GameSession): { session: GameSession; changed: boolean } {
  let changed = false;
  let next = session;

  // Toughness <= 0, no loyalty counters, and the legendary rule all destroy permanents.
  const destructions: Array<{ seatId: string; cardId: string; message: string }> = [];
  for (const seat of next.seats) {
    for (const card of seat.board.battlefield) {
      if (card.typeLine.includes("Creature") && effectiveToughness(card) <= 0) {
        destructions.push({ seatId: seat.id, cardId: card.id, message: `${card.name} is put into ${seat.name}'s graveyard for having toughness 0 or less.` });
        continue;
      }
      if (isPlaneswalkerCard(card) && loyaltyCounterCount(card) <= 0) {
        destructions.push({ seatId: seat.id, cardId: card.id, message: `${card.name} is put into ${seat.name}'s graveyard for having no loyalty counters.` });
      }
    }

    const legendaryByName = new Map<string, VisibleCard[]>();
    for (const card of seat.board.battlefield) {
      if (!card.typeLine.includes("Legendary")) continue;
      legendaryByName.set(card.name, [...(legendaryByName.get(card.name) ?? []), card]);
    }
    for (const group of legendaryByName.values()) {
      if (group.length < 2) continue;
      // Controller normally chooses which copy to keep; this engine has no such prompt, so it
      // deterministically keeps the most recently entered copy (last in the battlefield array).
      for (const card of group.slice(0, -1)) {
        destructions.push({ seatId: seat.id, cardId: card.id, message: `${card.name} is put into ${seat.name}'s graveyard due to the legendary rule.` });
      }
    }
  }
  if (destructions.length > 0) {
    next = destroyCreatures(next, destructions);
    changed = true;
  }

  // +1/+1 and -1/-1 counters annihilate in matched pairs.
  next = {
    ...next,
    seats: next.seats.map((seat) => ({
      ...seat,
      board: {
        ...seat.board,
        battlefield: seat.board.battlefield.map((card) => {
          const plus = counterCount(card, "+1/+1");
          const minus = counterCount(card, "-1/-1");
          if (plus === 0 || minus === 0) return card;
          const removed = Math.min(plus, minus);
          changed = true;
          return {
            ...card,
            counters: (card.counters ?? [])
              .map((counter) => {
                if (counter.kind === "+1/+1") return { ...counter, count: plus - removed };
                if (counter.kind === "-1/-1") return { ...counter, count: minus - removed };
                return counter;
              })
              .filter((counter) => counter.count > 0)
          };
        })
      }
    }))
  };

  // Life <= 0 and 21+ combat damage from a single commander are both game losses.
  const previousLossState = new Map(next.seats.map((seat) => [seat.id, Boolean(seat.hasLost)]));
  const seatsAfterLossChecks = next.seats.map((seat) => {
    if (seat.hasLost) return seat;
    if (seat.life <= 0) return { ...seat, hasLost: true, lossReason: "life total reached 0" };
    if (Object.values(seat.commanderDamage).some((amount) => amount >= 21)) {
      return { ...seat, hasLost: true, lossReason: "took 21 or more combat damage from a single commander" };
    }
    return seat;
  });
  const lossEvents: GameEvent[] = seatsAfterLossChecks
    .filter((seat) => seat.hasLost && !previousLossState.get(seat.id))
    .map((seat) => ({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      seatId: seat.id,
      message: `${seat.name} loses the game (${seat.lossReason}).`,
      detail: "State-based action"
    }));
  if (lossEvents.length > 0) changed = true;
  next = { ...next, seats: seatsAfterLossChecks, events: [...lossEvents, ...next.events] };

  // Free-for-all: the game ends once at most one player remains standing.
  if (next.status === "playing") {
    const remaining = next.seats.filter((seat) => !seat.hasLost);
    if (remaining.length <= 1) {
      changed = true;
      next = {
        ...next,
        status: "complete",
        winnerSeatId: remaining[0]?.id,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: remaining[0]?.id,
            message: remaining[0] ? `${remaining[0].name} wins the game!` : "The game ends with no winner.",
            detail: "State-based action"
          },
          ...next.events
        ]
      };
    }
  }

  return { session: next, changed };
}

function destroyCreatures(session: GameSession, destructions: Array<{ seatId: string; cardId: string; message: string }>): GameSession {
  if (destructions.length === 0) return session;
  const events: GameEvent[] = [];
  const seats = session.seats.map((seat) => {
    const toDestroy = destructions.filter((entry) => entry.seatId === seat.id);
    if (toDestroy.length === 0) return seat;
    const destroyIds = new Set(toDestroy.map((entry) => entry.cardId));
    const destroyedCards = seat.board.battlefield.filter((card) => destroyIds.has(card.id));
    for (const entry of toDestroy) {
      events.push({ id: crypto.randomUUID(), at: new Date().toISOString(), seatId: seat.id, message: entry.message, detail: "Combat damage" });
    }

    // Tokens cease to exist rather than sitting in the graveyard (rule 704.5d); a destroyed
    // commander is redirected to the command zone instead (the owner-choice replacement effect
    // is simplified to "always redirect," matching how moveCardBetweenVisibleZones already
    // handles it elsewhere). Everything else is a "new object" once it leaves the battlefield,
    // so counters/interpreted-effect caches from its time on the battlefield don't carry over.
    const toGraveyard = destroyedCards.filter((card) => !card.token && !card.commander);
    const dyingCommander = destroyedCards.find((card) => card.commander);
    let commanderReturn: VisibleCard | undefined;
    if (dyingCommander) {
      const commanderTax = (dyingCommander.commanderTax ?? 0) + 2;
      commanderReturn = {
        ...dyingCommander,
        zone: "command" as const,
        tapped: false,
        attacking: false,
        attackTargetId: undefined,
        blockDecided: false,
        blocking: false,
        blockingTargetId: undefined,
        battlefieldPosition: undefined,
        counters: undefined,
        interpretedEffects: undefined,
        commanderTax
      };
      events.push({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: seat.id,
        message: `${dyingCommander.name} returns to the command zone. Commander tax is now +${commanderTax}.`,
        detail: "Rules action"
      });
    }

    return {
      ...seat,
      board: {
        ...seat.board,
        commander: commanderReturn ?? seat.board.commander,
        battlefield: seat.board.battlefield.filter((card) => !destroyIds.has(card.id)),
        graveyard: [
          ...(seat.board.graveyard ?? []),
          ...toGraveyard.map((card) => ({
            ...card,
            zone: "graveyard" as const,
            tapped: false,
            attacking: false,
            attackTargetId: undefined,
            blockDecided: false,
            blocking: false,
            blockingTargetId: undefined,
            battlefieldPosition: undefined,
            counters: undefined,
            interpretedEffects: undefined
          }))
        ]
      },
      zones: {
        ...seat.zones,
        battlefield: Math.max(0, seat.zones.battlefield - destroyedCards.length),
        graveyard: seat.zones.graveyard + toGraveyard.length,
        command: seat.zones.command + (dyingCommander ? 1 : 0)
      }
    };
  });
  return { ...session, seats, events: [...events, ...session.events] };
}

function applyCombatDamageToTarget(
  session: GameSession,
  sourceName: string,
  target: { seat: PlayerSeat; planeswalker?: VisibleCard },
  amount: number,
  source?: VisibleCard
): GameSession {
  if (amount <= 0) return session;
  if (target.planeswalker) {
    const planeswalkerId = target.planeswalker.id;
    return {
      ...session,
      seats: session.seats.map((seat) =>
        seat.id === target.seat.id
          ? {
              ...seat,
              board: {
                ...seat.board,
                battlefield: seat.board.battlefield.map((card) => (card.id === planeswalkerId ? applyCounterDelta(card, "loyalty", -amount) : card))
              }
            }
          : seat
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: target.seat.id,
          message: `${sourceName} deals ${amount} combat damage to ${target.planeswalker.name}.`,
          detail: "Combat damage"
        },
        ...session.events
      ]
    };
  }
  return {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === target.seat.id
        ? {
            ...seat,
            life: Math.max(0, seat.life - amount),
            commanderDamage:
              source?.commander
                ? { ...seat.commanderDamage, [source.id]: (seat.commanderDamage[source.id] ?? 0) + amount }
                : seat.commanderDamage
          }
        : seat
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: target.seat.id,
        message: `${sourceName} deals ${amount} combat damage to ${target.seat.name}.`,
        detail: "Combat damage"
      },
      ...session.events
    ]
  };
}

function dealsDamageInCombatStep(card: VisibleCard, step: "first" | "regular") {
  if (hasDoubleStrike(card)) return true;
  if (hasFirstStrike(card)) return step === "first";
  return step === "regular";
}

interface BlockedCombatOutcome {
  blockerDamageMarked: number;
  attackerDamageMarked: number;
  blockerDestroyed: boolean;
  attackerDestroyed: boolean;
  trampleOverflow: number;
}

function simulateBlockedCombat(attackingCard: VisibleCard, blocker: VisibleCard): BlockedCombatOutcome {
  const attackerPower = Math.max(0, effectivePower(attackingCard));
  const blockerPower = Math.max(0, effectivePower(blocker));
  const attackerToughness = effectiveToughness(attackingCard);
  const blockerToughness = effectiveToughness(blocker);

  let attackerAlive = true;
  let blockerAlive = true;
  let attackerDamageMarked = 0;
  let blockerDamageMarked = 0;
  let trampleOverflow = 0;

  for (const step of ["first", "regular"] as const) {
    const attackerActs = attackerAlive && dealsDamageInCombatStep(attackingCard, step);
    const blockerActs = blockerAlive && dealsDamageInCombatStep(blocker, step);

    if (attackerActs) {
      const lethalNeeded = hasDeathtouch(attackingCard) ? 1 : Math.max(1, blockerToughness - blockerDamageMarked);
      const assignedToBlocker = hasTrample(attackingCard) ? Math.min(attackerPower, lethalNeeded) : attackerPower;
      trampleOverflow += hasTrample(attackingCard) ? Math.max(0, attackerPower - assignedToBlocker) : 0;
      blockerDamageMarked += assignedToBlocker;
    }
    if (blockerActs) {
      attackerDamageMarked += blockerPower;
    }
    if (blockerAlive && !hasIndestructible(blocker) && (blockerDamageMarked >= blockerToughness || (hasDeathtouch(attackingCard) && attackerActs && blockerDamageMarked > 0))) {
      blockerAlive = false;
    }
    if (attackerAlive && !hasIndestructible(attackingCard) && (attackerDamageMarked >= attackerToughness || (hasDeathtouch(blocker) && blockerActs && attackerDamageMarked > 0))) {
      attackerAlive = false;
    }
  }

  return {
    blockerDamageMarked,
    attackerDamageMarked,
    blockerDestroyed: !blockerAlive,
    attackerDestroyed: !attackerAlive,
    trampleOverflow
  };
}

function resolveBlockedCombatDamage(
  session: GameSession,
  attackerSeatId: string,
  attackingCard: VisibleCard,
  target: { seat: PlayerSeat; planeswalker?: VisibleCard },
  blocker: VisibleCard
): GameSession {
  const outcome = simulateBlockedCombat(attackingCard, blocker);

  const destructions: Array<{ seatId: string; cardId: string; message: string }> = [];
  if (outcome.blockerDestroyed) {
    destructions.push({ seatId: target.seat.id, cardId: blocker.id, message: `${blocker.name} is destroyed by combat damage from ${attackingCard.name}.` });
  }
  if (outcome.attackerDestroyed) {
    destructions.push({ seatId: attackerSeatId, cardId: attackingCard.id, message: `${attackingCard.name} is destroyed by combat damage from ${blocker.name}.` });
  }

  let nextSession: GameSession = {
    ...session,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: attackerSeatId,
        message: `${attackingCard.name} and ${blocker.name} trade combat damage (${outcome.blockerDamageMarked} to ${blocker.name}, ${outcome.attackerDamageMarked} to ${attackingCard.name}).`,
        detail: "Combat damage"
      },
      ...session.events
    ]
  };

  if (outcome.trampleOverflow > 0) {
    nextSession = applyCombatDamageToTarget(nextSession, attackingCard.name, target, outcome.trampleOverflow, attackingCard);
  }

  return destroyCreatures(nextSession, destructions);
}

function describeBlockTrade(attacker: VisibleCard | undefined, blocker: VisibleCard): string {
  if (!attacker) return "(trade outcome unclear from power/toughness alone).";
  const attackerPower = Number.parseInt(attacker.power ?? "", 10);
  const attackerToughness = Number.parseInt(attacker.toughness ?? "", 10);
  const blockerPower = Number.parseInt(blocker.power ?? "", 10);
  const blockerToughness = Number.parseInt(blocker.toughness ?? "", 10);
  if ([attackerPower, attackerToughness, blockerPower, blockerToughness].some((value) => Number.isNaN(value))) {
    return "(trade outcome unclear from power/toughness alone).";
  }

  const outcome = simulateBlockedCombat(attacker, blocker);
  const keywordNotes = Array.from(new Set([...describeKeywords(attacker), ...describeKeywords(blocker)]));
  const noteSuffix = keywordNotes.length > 0 ? ` [${keywordNotes.join(", ")}]` : "";
  const trampleNote = outcome.trampleOverflow > 0 ? `, ${outcome.trampleOverflow} tramples over` : "";

  if (outcome.blockerDestroyed && outcome.attackerDestroyed) return `(would trade: both creatures die${trampleNote}${noteSuffix}).`;
  if (outcome.blockerDestroyed && !outcome.attackerDestroyed) return `(blocker dies, attacker survives${trampleNote}${noteSuffix}).`;
  if (!outcome.blockerDestroyed && outcome.attackerDestroyed) return `(attacker dies, blocker survives${noteSuffix}).`;
  return `(neither creature dies${trampleNote}${noteSuffix}).`;
}

function legalBlockActions(session: GameSession, choice: BlockChoiceState): LegalAgentAction[] {
  const defender = session.seats.find((seat) => seat.id === choice.defenderSeatId);
  const attacker = session.seats.find((seat) => seat.id === choice.attackerSeatId);
  const attackingCard = attacker?.board.battlefield.find((card) => card.id === choice.attackerCardId);
  const actions: LegalAgentAction[] =
    defender?.board.battlefield.filter((card) => canBlock(card, attackingCard)).map((card) => ({
      id: `block:${card.id}`,
      actionType: "block" as const,
      cardId: card.id,
      targetIds: [choice.attackerCardId],
      label: `block ${attackingCard?.name ?? "attacker"} with ${card.name}`,
      detail: `${effectivePower(card)}/${effectiveToughness(card)} ${card.oracleText} ${describeBlockTrade(attackingCard, card)}`.trim(),
      role: card.role
    })) ?? [];
  actions.push({ id: "no-blocks", actionType: "pass_priority", targetIds: [choice.attackerCardId], label: "declare no blockers" });
  return actions;
}

function fallbackLegalAction(actions: LegalAgentAction[]) {
  return (
    actions.find((action) => action.actionType === "cast_spell") ??
    actions.find((action) => action.actionType === "cast_commander") ??
    actions.find((action) => action.actionType === "play_land") ??
    actions.find((action) => action.actionType === "activate_ability") ??
    actions.find((action) => action.actionType === "attack") ??
    actions.find((action) => action.actionType === "block") ??
    actions.find((action) => action.actionType === "pass_priority") ??
    actions[0]
  );
}

function pendingActionSummary(action: PendingAction) {
  return {
    id: action.id,
    type: action.type,
    actorSeatId: action.actorSeatId,
    cardName: "cardName" in action ? action.cardName : "sourceCardName" in action ? action.sourceCardName : undefined,
    message: action.message
  };
}

function buildAgentDecisionContext(
  session: GameSession,
  seat: PlayerSeat,
  extra: Record<string, unknown>
) {
  return {
    ...extra,
    you: agentSeatSnapshot(seat, true),
    opponents: session.seats.filter((item) => item.id !== seat.id && !item.hasLost).map((item) => agentSeatSnapshot(item, false))
  };
}

function agentSeatSnapshot(seat: PlayerSeat, includeHand: boolean) {
  return {
    id: seat.id,
    name: seat.name,
    life: seat.life,
    commanderDamage: seat.commanderDamage,
    availableMana: summarizeAvailableMana(seat),
    commander: seat.board.commander ? agentCardSnapshot(seat.board.commander) : undefined,
    hand: includeHand ? seat.board.hand.map(agentCardSnapshot) : { count: seat.board.hand.length },
    battlefield: seat.board.battlefield.map(agentCardSnapshot),
    graveyard: (seat.board.graveyard ?? []).slice(-8).map(agentCardSnapshot),
    exile: (seat.board.exile ?? []).slice(-8).map(agentCardSnapshot),
    libraryCount: seat.library?.length ?? seat.zones.library
  };
}

function agentCardSnapshot(card: VisibleCard) {
  return {
    id: card.id,
    name: card.name,
    typeLine: card.typeLine,
    manaCost: card.manaCost,
    manaValue: card.manaValue,
    power: card.power !== undefined ? String(effectivePower(card)) : card.power,
    toughness: card.toughness !== undefined ? String(effectiveToughness(card)) : card.toughness,
    loyalty: card.loyalty,
    tapped: card.tapped,
    summoningSick: card.summoningSick,
    attacking: card.attacking,
    blocking: card.blocking,
    counters: card.counters,
    oracleText: card.oracleText,
    faces: card.faces?.map((face) => ({ name: face.name, typeLine: face.typeLine, manaCost: face.manaCost, oracleText: face.oracleText })),
    unlockedFaceIndices: card.unlockedFaceIndices,
    interpretedEffects: card.interpretedEffects
  };
}

function resolveHumanBlock(session: GameSession, choice: BlockChoiceState, blockerCardId: string): GameSession {
  const attacker = session.seats.find((seat) => seat.id === choice.attackerSeatId);
  const defender = session.seats.find((seat) => seat.id === choice.defenderSeatId);
  const attackingCard = attacker?.board.battlefield.find((card) => card.id === choice.attackerCardId && card.attacking);
  const blocker = defender?.board.battlefield.find((card) => card.id === blockerCardId && canBlock(card, attackingCard));
  if (!attacker || !defender || !attackingCard || !blocker) return resolveHumanUnblockedDamage(session, choice);

  const decidedSession = markAttackDecided(session, attacker.id, attackingCard.id);
  return {
    ...decidedSession,
    seats: decidedSession.seats.map((seat) =>
      seat.id === defender.id
        ? {
            ...seat,
            board: {
              ...seat.board,
              battlefield: seat.board.battlefield.map((card) =>
                card.id === blocker.id ? { ...card, blocking: true, blockingTargetId: attackingCard.id } : card
              )
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
      ...decidedSession.events
    ]
  };
}

function resolveHumanUnblockedDamage(session: GameSession, choice: BlockChoiceState): GameSession {
  const attacker = session.seats.find((seat) => seat.id === choice.attackerSeatId);
  const defender = session.seats.find((seat) => seat.id === choice.defenderSeatId);
  const attackingCard = attacker?.board.battlefield.find((card) => card.id === choice.attackerCardId && card.attacking);
  if (!attacker || !defender || !attackingCard) return session;
  const decidedSession = markAttackDecided(session, attacker.id, attackingCard.id);
  return {
    ...decidedSession,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: attacker.id,
        message: `${defender.name} declares no blockers for ${attackingCard.name}.`,
        detail: "Phase change"
      },
      ...decidedSession.events
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
      triggerKind: "common",
      effect: { kind: "draw_cards", amount: 1 },
      parentAction: { ...action, triggersChecked: true },
      message: `${source.name} triggers because ${actor.name} cast noncreature spell ${spell.name}.`
    };
  }

  return undefined;
}

function findCommonTriggersForPermanentEntered(session: GameSession, enteringSeatId: string, enteringCard: VisibleCard): Array<Extract<PendingAction, { type: "trigger" }>> {
  const enteringSeat = session.seats.find((seat) => seat.id === enteringSeatId);
  if (!enteringSeat) return [];
  const enteredPermanent = enteringSeat.board.battlefield.find((card) => card.id === enteringCard.id) ?? enteringCard;
  const triggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];

  for (const seat of session.seats) {
    for (const source of seat.board.battlefield) {
      const effect = commonTriggerEffect(source.oracleText, "entered");
      if (!effect || !enteredTriggerApplies(source, seat.id, enteredPermanent, enteringSeatId)) continue;
      triggers.push(makeCommonTrigger(enteringSeatId, seat.id, source, effect, `${source.name} triggers because ${enteredPermanent.name} entered the battlefield.`));
    }
  }

  return triggers;
}

function findCommonTriggersForPermanentDied(session: GameSession, deadSeatId: string, deadCard: VisibleCard): Array<Extract<PendingAction, { type: "trigger" }>> {
  if (!deadCard.typeLine.includes("Creature")) return [];
  const triggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];

  for (const seat of session.seats) {
    const sources = [...seat.board.battlefield, ...(seat.id === deadSeatId ? [deadCard] : [])];
    for (const source of sources) {
      const dynamicCounterCount = source.id === deadCard.id ? plusOneCounterCount(deadCard) : undefined;
      const effect = commonTriggerEffect(source.oracleText, "died", dynamicCounterCount);
      if (!effect || !deathTriggerApplies(source, seat.id, deadCard, deadSeatId)) continue;
      triggers.push(makeCommonTrigger(deadSeatId, seat.id, source, effect, `${source.name} triggers because ${deadCard.name} died.`));
    }
  }

  return triggers;
}

function makeCommonTrigger(
  actorSeatId: string,
  controllerSeatId: string,
  source: VisibleCard,
  effect: TriggerEffect,
  message: string
): Extract<PendingAction, { type: "trigger" }> {
  return {
    id: crypto.randomUUID(),
    type: "trigger",
    actorSeatId,
    controllerSeatId,
    sourceCardId: source.id,
    sourceCardName: source.name,
    triggerKind: "common",
    effect,
    message
  };
}

function enteredTriggerApplies(source: VisibleCard, sourceSeatId: string, enteredCard: VisibleCard, enteredSeatId: string) {
  const text = source.oracleText.toLowerCase();
  if (!text.includes("enter")) return false;
  const enteredIsCreature = enteredCard.typeLine.includes("Creature");
  const enteredIsLand = isLandCard(enteredCard);
  const underYourControl = enteredSeatId === sourceSeatId;
  const isAnother = source.id !== enteredCard.id;
  const selfEntered = source.id === enteredCard.id;

  if (selfEntered && /\b(when|whenever).{0,80}\b(enters|enter) the battlefield\b/.test(text)) return true;
  if (enteredIsLand && underYourControl && /\bland enters\b/.test(text) && text.includes("under your control")) return true;
  if (!enteredIsCreature) return false;
  if (text.includes("another creature enters") || text.includes("another creature you control enters")) {
    if (!isAnother) return false;
    return text.includes("under your control") || text.includes("you control") ? underYourControl : true;
  }
  if (text.includes("creature enters") || text.includes("creature you control enters")) {
    return text.includes("under your control") || text.includes("you control") ? underYourControl : true;
  }
  return false;
}

function deathTriggerApplies(source: VisibleCard, sourceSeatId: string, deadCard: VisibleCard, deadSeatId: string) {
  const text = source.oracleText.toLowerCase();
  if (!text.includes("dies")) return false;
  const underYourControl = deadSeatId === sourceSeatId;
  const isAnother = source.id !== deadCard.id;

  if (source.id === deadCard.id && /\b(when|whenever).{0,80}\bdies\b/.test(text)) return true;
  if (text.includes("another creature dies") || text.includes("another creature you control dies")) {
    if (!isAnother) return false;
    return text.includes("you control") ? underYourControl : true;
  }
  if (text.includes("creature dies") || text.includes("creature you control dies")) {
    return text.includes("you control") ? underYourControl : true;
  }
  return false;
}

function oracleClauses(oracleText: string): string[] {
  return oracleText.split("\n").map((line) => line.trim()).filter(Boolean);
}

function isActivatedAbilityClause(clause: string): boolean {
  return /^\{[^}]+\}/.test(clause) && clause.includes(":");
}

function isDeathTriggerClause(clause: string): boolean {
  return /\b(when|whenever)\b[^.]{0,80}\bdies\b/i.test(clause);
}

// Oracle text with activated-ability and "dies"-triggered clauses stripped out, so ETB-time
// parsing (token creation, life/card-draw effects) can't misfire on abilities that are actually
// gated behind a later death trigger or a separate activated cost (e.g. Hangarback Walker's
// "When this creature dies, create..." clause must not resolve the moment it enters).
function etbEffectText(oracleText: string): string {
  return oracleClauses(oracleText)
    .filter((clause) => !isActivatedAbilityClause(clause) && !isDeathTriggerClause(clause))
    .join(" ");
}

// The inverse: isolates just the "dies"-triggered clause(s), so a permanent's death effect
// (e.g. "create a token for each +1/+1 counter on this creature") is parsed from the right
// sentence instead of the whole card.
function deathEffectText(oracleText: string): string {
  return oracleClauses(oracleText)
    .filter((clause) => isDeathTriggerClause(clause))
    .join(" ");
}

function commonTriggerEffect(oracleText: string, mode: "entered" | "died", dynamicCounterCount?: number): TriggerEffect | undefined {
  const relevantText = mode === "died" ? deathEffectText(oracleText) : etbEffectText(oracleText);
  const text = relevantText.toLowerCase();
  const tokenSpecs = parseCreateTokenSpecs(relevantText, dynamicCounterCount);
  if (tokenSpecs.length > 0) return { kind: "create_tokens", tokens: tokenSpecs };

  const gainLife = text.match(/\byou gain\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\b/);
  if (gainLife) {
    const amount = numberWordToInt(gainLife[1]);
    if (amount) return { kind: "gain_life", amount };
  }

  const loseLife = text.match(/\byou lose\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\b/);
  if (loseLife) {
    const amount = numberWordToInt(loseLife[1]);
    if (amount) return { kind: "lose_life", amount };
  }

  const drawCount = extractCommonDrawCount(text);
  if (drawCount) return { kind: "draw_cards", amount: drawCount };

  return undefined;
}

function createTokensForSeat(session: GameSession, seatId: string, sourceCardId: string, specs: TokenSpec[]) {
  const createdTokens = specs.flatMap((spec) =>
    Array.from({ length: spec.count }, () => createTokenCard(seatId, sourceCardId, spec))
  );
  const nextSession: GameSession = {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === seatId
        ? {
            ...seat,
            board: {
              ...seat.board,
              battlefield: [...seat.board.battlefield, ...createdTokens]
            },
            zones: {
              ...seat.zones,
              battlefield: seat.zones.battlefield + createdTokens.length
            }
          }
        : seat
    )
  };
  const triggers = createdTokens.flatMap((token) => findCommonTriggersForPermanentEntered(nextSession, seatId, token));
  return { session: nextSession, createdTokens, triggers };
}

function createTokenCard(seatId: string, sourceCardId: string, spec: TokenSpec): VisibleCard {
  return {
    id: `${seatId}-token-${crypto.randomUUID()}`,
    name: spec.name,
    typeLine: spec.typeLine,
    oracleText: spec.oracleText,
    manaValue: 0,
    colors: spec.colors,
    colorIdentity: spec.colors,
    role: spec.role,
    zone: "battlefield",
    token: true,
    tokenSourceCardId: sourceCardId,
    ownerSeatId: seatId,
    power: spec.power,
    toughness: spec.toughness,
    summoningSick: spec.typeLine.includes("Creature")
  };
}

function parseCreateTokenSpecs(oracleText: string, dynamicCounterCount?: number): TokenSpec[] {
  const specs: TokenSpec[] = [];
  const normalized = oracleText.replace(/\s+/g, " ");
  const predefined = [
    { name: "Treasure", spec: predefinedTokenSpec("Treasure") },
    { name: "Food", spec: predefinedTokenSpec("Food") },
    { name: "Clue", spec: predefinedTokenSpec("Clue") },
    { name: "Blood", spec: predefinedTokenSpec("Blood") },
    { name: "Powerstone", spec: predefinedTokenSpec("Powerstone") }
  ];

  for (const item of predefined) {
    const match = normalized.match(new RegExp(`create\\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)\\s+${item.name}\\s+tokens?`, "i"));
    if (match && item.spec) {
      specs.push({ ...item.spec, count: numberWordToInt(match[1]) ?? 1 });
    }
  }

  const creaturePattern =
    /create\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+((?:\d+\/\d+\s+)?(?:(?:white|blue|black|red|green|colorless|multicolored)\s+)*(?:[A-Z][a-zA-Z'-]*\s+){0,4}creature tokens?(?: with [^.]+)?)/gi;
  const dynamicCounterCountPattern = /for each\s+(?:\+1\/\+1\s+)?counter\s+on\s+(?:this creature|it|this permanent|this artifact)\b/i;
  for (const match of normalized.matchAll(creaturePattern)) {
    const description = match[2].trim();
    const count =
      dynamicCounterCount !== undefined && dynamicCounterCountPattern.test(description) ? dynamicCounterCount : (numberWordToInt(match[1]) ?? 1);
    const spec = parseCreatureTokenDescription(description);
    if (spec) specs.push({ ...spec, count });
  }

  return specs;
}

function predefinedTokenSpec(name: "Treasure" | "Food" | "Clue" | "Blood" | "Powerstone"): TokenSpec {
  if (name === "Treasure") {
    return {
      count: 1,
      name: "Treasure",
      colors: [],
      typeLine: "Token Artifact - Treasure",
      oracleText: "{T}, Sacrifice this artifact: Add one mana of any color.",
      role: "token"
    };
  }
  if (name === "Food") {
    return {
      count: 1,
      name: "Food",
      colors: [],
      typeLine: "Token Artifact - Food",
      oracleText: "{2}, {T}, Sacrifice this artifact: You gain 3 life.",
      role: "token"
    };
  }
  if (name === "Clue") {
    return {
      count: 1,
      name: "Clue",
      colors: [],
      typeLine: "Token Artifact - Clue",
      oracleText: "{2}, Sacrifice this artifact: Draw a card.",
      role: "token"
    };
  }
  if (name === "Blood") {
    return {
      count: 1,
      name: "Blood",
      colors: [],
      typeLine: "Token Artifact - Blood",
      oracleText: "{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.",
      role: "token"
    };
  }
  return {
    count: 1,
    name: "Powerstone",
    colors: [],
    typeLine: "Token Artifact - Powerstone",
    oracleText: "{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.",
    role: "token"
  };
}

function parseCreatureTokenDescription(description: string): TokenSpec | undefined {
  const pt = description.match(/\b(\d+)\/(\d+)\b/);
  const colors = tokenColors(description);
  const abilities = description.match(/\bwith\s+(.+)$/i)?.[1]?.trim();
  const beforeCreature = description
    .replace(/\b\d+\/\d+\b/i, "")
    .replace(/\b(white|blue|black|red|green|colorless|multicolored)\b/gi, "")
    .replace(/\bwith\s+.+$/i, "")
    .replace(/\bcreature tokens?\b/i, "")
    .replace(/\band\b/gi, " ")
    .trim();
  const subtypes = beforeCreature || "Creature";
  return {
    count: 1,
    name: `${subtypes} Token`,
    colors,
    typeLine: `Token Creature - ${subtypes}`,
    power: pt?.[1] ?? "1",
    toughness: pt?.[2] ?? "1",
    oracleText: abilities ? sentenceCaseAbilities(abilities) : "",
    role: "creature"
  };
}

function tokenColors(description: string) {
  const colors: string[] = [];
  const colorMap: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
  for (const [word, symbol] of Object.entries(colorMap)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(description)) colors.push(symbol);
  }
  return colors;
}

function sentenceCaseAbilities(abilities: string) {
  return abilities
    .split(/\s+and\s+/i)
    .map((ability) => ability.trim())
    .filter(Boolean)
    .map((ability) => ability.charAt(0).toUpperCase() + ability.slice(1))
    .join(", ");
}

function extractCommonDrawCount(text: string) {
  const match = text.match(/\bdraw\s+(a|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\b/);
  if (!match) return undefined;
  return numberWordToInt(match[1]);
}

function numberWordToInt(value?: string) {
  if (!value || value === "x") return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) return parsed;
  return (
    {
      a: 1,
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10
    } as Record<string, number>
  )[value];
}

function resolveTriggerEffect(session: GameSession, trigger: Extract<PendingAction, { type: "trigger" }>): GameSession {
  const seatName = session.seats.find((seat) => seat.id === trigger.controllerSeatId)?.name ?? "Player";
  if (trigger.effect.kind === "draw_cards") {
    return drawMultipleForSeat(session, trigger.controllerSeatId, trigger.effect.amount, `${trigger.sourceCardName} trigger resolves. ${seatName} draws ${trigger.effect.amount} card${trigger.effect.amount === 1 ? "" : "s"}.`);
  }
  if (trigger.effect.kind === "gain_life" || trigger.effect.kind === "lose_life") {
    const delta = trigger.effect.kind === "gain_life" ? trigger.effect.amount : -trigger.effect.amount;
    return {
      ...session,
      seats: session.seats.map((seat) => (seat.id === trigger.controllerSeatId ? { ...seat, life: Math.max(0, seat.life + delta) } : seat)),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: trigger.controllerSeatId,
          message: `${trigger.sourceCardName} trigger resolves. ${seatName} ${delta > 0 ? "gains" : "loses"} ${Math.abs(delta)} life.`
        },
        ...session.events
      ]
    };
  }
  if (trigger.effect.kind === "create_tokens") {
    const created = createTokensForSeat(session, trigger.controllerSeatId, trigger.sourceCardId, trigger.effect.tokens);
    const createdNames = created.createdTokens.map((token) => token.name);
    return {
      ...created.session,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: trigger.controllerSeatId,
          message: `${trigger.sourceCardName} trigger resolves. ${seatName} creates ${createdNames.join(", ")}.`
        },
        ...created.session.events
      ]
    };
  }
  return {
    ...session,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: trigger.controllerSeatId,
        message: `${trigger.sourceCardName} trigger resolves.`
      },
      ...session.events
    ]
  };
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
    if (choice.kind === "miracle_offer") {
      return {
        kind: "miracle_offer" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        miracleCost: choice.miracleCost
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
    blockers: defender.board.battlefield.filter((card) => canBlock(card, attackingCard))
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

function manaValueFromManaCost(manaCost: string | undefined): number {
  if (!manaCost) return 0;
  const symbols = manaCost.match(/\{[^}]+\}/g) ?? [];
  let total = 0;
  for (const raw of symbols) {
    const value = raw.slice(1, -1);
    const numeric = Number.parseInt(value, 10);
    if (!Number.isNaN(numeric)) {
      total += numeric;
      continue;
    }
    if (value === "X" || value === "Y" || value === "Z") continue;
    total += 1;
  }
  return total;
}

function twoSidedFaces(card: VisibleCard): [CardFaceRecord, CardFaceRecord] | undefined {
  if (!card.faces || card.faces.length !== 2) return undefined;
  return [card.faces[0], card.faces[1]];
}

function modalDoubleFacedLandSplit(card: VisibleCard): { spellFace: CardFaceRecord; spellIndex: number; landFace: CardFaceRecord; landIndex: number } | undefined {
  const faces = twoSidedFaces(card);
  if (!faces) return undefined;
  const [first, second] = faces;
  if (!first.typeLine.includes("Land") && second.typeLine.includes("Land")) {
    return { spellFace: first, spellIndex: 0, landFace: second, landIndex: 1 };
  }
  if (first.typeLine.includes("Land") && !second.typeLine.includes("Land")) {
    return { spellFace: second, spellIndex: 1, landFace: first, landIndex: 0 };
  }
  return undefined;
}

function roomDoorFaces(card: VisibleCard): [CardFaceRecord, CardFaceRecord] | undefined {
  const faces = twoSidedFaces(card);
  if (!faces) return undefined;
  return faces.every((face) => face.typeLine.includes("Room")) ? faces : undefined;
}

function cardWithFaceManaCost(card: VisibleCard, manaCost: string | undefined): VisibleCard {
  return { ...card, manaCost };
}

function xSymbolCount(manaCost: string | undefined): number {
  const symbols = manaCost?.match(/\{[^}]+\}/g) ?? [];
  return symbols.filter((symbol) => symbol.toUpperCase() === "{X}").length;
}

function availableManaForSeat(seat: PlayerSeat, pool?: ManaPool): number {
  if (seat.kind === "human" && pool) return manaPoolTotal(pool);
  return seat.board.battlefield.filter((card) => isAvailableManaSource(card)).reduce((total, source) => total + manaProducedBy(source), 0);
}

// This app has no interactive "choose X" prompt, so both agents and humans default to the
// largest X they can currently afford — the alternative (no default) is what caused the reported
// bug: X-cost cards carry manaValue 0 (the Scryfall off-stack convention), so with no X selection
// at all they were always "free" to cast regardless of available mana.
function maxAffordableX(seat: PlayerSeat, card: VisibleCard, fixedCost: number, pool?: ManaPool): number {
  const xCount = xSymbolCount(card.manaCost);
  if (xCount === 0) return 0;
  const budget = availableManaForSeat(seat, pool) - fixedCost;
  return budget > 0 ? Math.floor(budget / xCount) : 0;
}

// A purely-generic fake card, used to reuse chooseManaSourcesForCost for costs that don't come
// from an actual card's mana cost (e.g. paying an attack tax on declaration).
function genericCostShim(amount: number): VisibleCard {
  return {
    id: "attack-tax-shim",
    name: "Attack Tax",
    typeLine: "",
    oracleText: "",
    manaValue: amount,
    colors: [],
    colorIdentity: [],
    role: "effect",
    zone: "battlefield"
  };
}

function attackTaxEffectsFor(defender: PlayerSeat, targetIsPlaneswalker: boolean): InterpretedEffect[] {
  return defender.board.battlefield
    .flatMap((card) => card.interpretedEffects ?? [])
    .filter((effect) => {
      if (effect.kind !== "attack_tax") return false;
      return targetIsPlaneswalker ? effect.appliesTo !== "controller" : effect.appliesTo !== "planeswalkers";
    });
}

// Sum of all attack-tax effects the defending seat has in play, evaluated against their current
// board state (e.g. Sphere of Safety's per-enchantment amount can change turn to turn).
function totalAttackTax(defender: PlayerSeat, targetIsPlaneswalker: boolean): number {
  const enchantmentCount = defender.board.battlefield.filter((card) => card.typeLine.includes("Enchantment")).length;
  return attackTaxEffectsFor(defender, targetIsPlaneswalker).reduce(
    (total, effect) => total + effectiveAttackTaxAmount(effect, enchantmentCount),
    0
  );
}

function applyChosenFaceToCard(card: VisibleCard, faceIndex: number | undefined): VisibleCard {
  const face = faceIndex !== undefined ? card.faces?.[faceIndex] : undefined;
  if (!face) return card;
  return {
    ...card,
    name: face.name,
    typeLine: face.typeLine,
    oracleText: face.oracleText,
    manaCost: face.manaCost,
    power: face.power,
    toughness: face.toughness,
    loyalty: face.loyalty,
    imageUris: face.imageUris ?? card.imageUris,
    unlockedFaceIndices: [faceIndex as number]
  };
}

function unlockSecondRoomDoor(card: VisibleCard, newFaceIndex: number): VisibleCard {
  const doors = roomDoorFaces(card);
  if (!doors) return card;
  const [firstDoor, secondDoor] = doors;
  const alreadyUnlocked = card.unlockedFaceIndices ?? [];
  const nextUnlocked = Array.from(new Set([...alreadyUnlocked, newFaceIndex])).sort();
  return {
    ...card,
    name: `${firstDoor.name} // ${secondDoor.name}`,
    typeLine: "Enchantment — Room",
    oracleText: `${firstDoor.name}: ${firstDoor.oracleText}\n\n${secondDoor.name}: ${secondDoor.oracleText}`,
    unlockedFaceIndices: nextUnlocked
  };
}

interface HandCardFaceOption {
  faceIndex: number;
  actionKind: "play_land" | "cast_spell";
  label: string;
  payable: boolean;
}

function handCardFaceOptions(seat: PlayerSeat, card: VisibleCard, hasPlayedLand: boolean, activeSeatId: string | undefined, manaPool: ManaPool): HandCardFaceOption[] | undefined {
  const split = modalDoubleFacedLandSplit(card);
  if (split) {
    const spellCost = adjustedCastingCost(seat, card, card.manaValue, "hand", activeSeatId);
    const spellPayment = payCostFromPool(manaPool, card, spellCost);
    return [
      {
        faceIndex: split.landIndex,
        actionKind: "play_land",
        label: `Play ${split.landFace.name} (land)`,
        payable: !hasPlayedLand
      },
      {
        faceIndex: split.spellIndex,
        actionKind: "cast_spell",
        label: `Cast ${split.spellFace.name} (${split.spellFace.manaCost ?? "no cost"})`,
        payable: spellPayment.ok
      }
    ];
  }

  const doors = roomDoorFaces(card);
  if (doors) {
    return doors.map((door, index) => {
      const shim = cardWithFaceManaCost(card, door.manaCost);
      const totalCost = adjustedCastingCost(seat, shim, manaValueFromManaCost(door.manaCost), "hand", activeSeatId);
      const payment = payCostFromPool(manaPool, shim, totalCost);
      return {
        faceIndex: index,
        actionKind: "cast_spell" as const,
        label: `Cast ${door.name} (${door.manaCost ?? "no cost"})`,
        payable: payment.ok
      };
    });
  }

  return undefined;
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

// Placeholder hook for future per-card cost-reduction effects. Aminatou, Veil Piercer does not
// discount normal casting from hand — she grants miracle instead, handled by the miracle-offer flow.
function adjustedCastingCost(seat: PlayerSeat, card: VisibleCard, baseCost: number, sourceZone: "hand" | "command", activeSeatId: string | undefined) {
  return baseCost;
}

function coloredPipCount(card: VisibleCard) {
  return (card.manaCost?.match(/\{[WUBRG]\}/gi) ?? []).length;
}

function findMiracleGranter(seat: PlayerSeat): VisibleCard | undefined {
  return seat.board.battlefield.find(
    (card) => card.name === "Aminatou, Veil Piercer" || /enchantment cards? in your hand (has|have) miracle/i.test(card.oracleText)
  );
}

function miracleCostFor(card: VisibleCard) {
  return Math.max(coloredPipCount(card), card.manaValue - 4);
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

function summarizeAvailableMana(seat: PlayerSeat) {
  const sources = seat.board.battlefield.filter((card) => isAvailableManaSource(card));
  const byColor = emptyManaPool();
  let total = 0;
  for (const source of sources) {
    const produced = manaProducedBy(source);
    total += produced;
    const choices = manaChoicesForCard(source, seat);
    const color = choices.includes("C") ? "C" : choices[0];
    if (color) byColor[color] += produced;
  }
  return { total, untappedSources: sources.length, byColor };
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

  const addedColors = [...text.matchAll(/add \{([wubrgc])\}/gi)].map((match) => match[1].toUpperCase());
  if (addedColors.length > 0) return normalizeManaColors(addedColors);

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

function entersBattlefieldTapped(card: VisibleCard, controller?: PlayerSeat) {
  const text = card.oracleText.toLowerCase();
  const checkLandMatch = text.match(/enters (?:the battlefield )?tapped unless you control an? ([a-z]+) or an? ([a-z]+)/);
  if (checkLandMatch) {
    const types = [checkLandMatch[1], checkLandMatch[2]].map(capitalizeWord);
    return !controller || !controlsLandType(controller, types);
  }
  if (text.includes("enters tapped unless you control two or more basic lands")) {
    return !controller || controller.board.battlefield.filter((permanent) => basicLandTypes(permanent).length > 0).length < 2;
  }
  return (
    /\benters tapped\b/.test(text) ||
    /\benters the battlefield tapped\b/.test(text) ||
    /\benters the battlefield tapped unless\b/.test(text) ||
    knownEntersTappedCards.has(card.name)
  );
}

function capitalizeWord(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function controlsLandType(seat: PlayerSeat, types: string[]) {
  return seat.board.battlefield.some((permanent) => basicLandTypes(permanent).some((type) => types.includes(type)));
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
  return evaluateOpeningHand(seat).keep;
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
  const seat = session.seats.find((item) => item.id === seatId);
  if (seat && !seat.hasLost && !seat.library?.[0]) {
    return {
      ...session,
      seats: session.seats.map((item) => (item.id === seatId ? { ...item, hasLost: true, lossReason: "drew from an empty library" } : item)),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} attempted to draw from an empty library and loses the game.`,
          detail: "State-based action"
        },
        ...session.events
      ]
    };
  }

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
  sourceZone: "hand" | "command" = "hand",
  faceIndex?: number
): GameSession {
  let playedName = "";
  let enteredTapped = false;
  const seats = session.seats.map((seat) => {
    if (seat.id !== seatId) return seat;
    const handCard = sourceZone === "command" ? seat.board.commander : seat.board.hand.find((item) => item.id === cardId);
    if (!handCard) return seat;
    const card = applyChosenFaceToCard(handCard, faceIndex);
    playedName = card.name;
    const entersTapped = destination === "battlefield" && entersBattlefieldTapped(card, seat);
    enteredTapped = entersTapped;
    const played: VisibleCard = {
      ...card,
      zone: destination,
      tapped: entersTapped ? true : card.tapped,
      battlefieldPosition: destination === "battlefield" ? position : undefined,
      summoningSick: destination === "battlefield" && card.typeLine.includes("Creature") ? true : card.summoningSick,
      counters: destination === "battlefield" && isPlaneswalkerCard(card) ? withInitialLoyaltyCounters(card) : card.counters
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

// Free-for-all Commander games continue while 2+ players remain — eliminated seats stay in the
// array (for history/log purposes) but are skipped when finding whose turn/priority is next.
function nextInRotation(seats: PlayerSeat[], fromIndex: number): PlayerSeat {
  for (let offset = 1; offset <= seats.length; offset += 1) {
    const candidate = seats[(fromIndex + offset) % seats.length];
    if (!candidate.hasLost) return candidate;
  }
  return seats[fromIndex];
}

function nextSeatId(seats: PlayerSeat[], seatId: string) {
  const index = Math.max(0, seats.findIndex((seat) => seat.id === seatId));
  return nextInRotation(seats, index).id;
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
  if (seat.hasLost) return false;
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

    if (card.token && source === "battlefield") {
      const destinationCount = destination === "graveyard" ? "graveyard" : destination === "exile" ? "exile" : "hand";
      return {
        ...seat,
        board: {
          ...seat.board,
          battlefield: seat.board.battlefield.filter((item) => item.id !== cardId),
          graveyard,
          exile
        },
        zones: {
          ...seat.zones,
          battlefield: Math.max(0, seat.zones.battlefield - 1),
          [destinationCount]: seat.zones[destinationCount]
        }
      };
    }

    // A card is a "new object" once it changes zones — counters, cached interpreted effects, and
    // attack/block linkage from its time on the battlefield don't carry over.
    const movedCard: VisibleCard = {
      ...card,
      zone: destination,
      tapped: destination === "graveyard" || destination === "exile" ? false : card.tapped,
      attacking: false,
      attackTargetId: undefined,
      blockDecided: false,
      blocking: false,
      blockingTargetId: undefined,
      battlefieldPosition: destination === "graveyard" || destination === "exile" ? undefined : card.battlefieldPosition,
      counters: undefined,
      interpretedEffects: undefined
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

function resolveBasicLandFetchSearch(session: GameSession, seatId: string, cardId: string, chosenCardId?: string): GameSession {
  let sourceName = "";
  let foundName = "";

  const seats = session.seats.map((seat) => {
    if (seat.id !== seatId) return seat;
    const source = seat.board.battlefield.find((card) => card.id === cardId);
    if (!source || !isBasicLandFetchAbility(source) || source.tapped) return seat;

    sourceName = source.name;
    const library = seat.library ?? [];
    const chosen =
      (chosenCardId ? library.find((card) => card.id === chosenCardId && isBasicLandCard(card)) : undefined) ??
      chooseBestBasicLandForFetch(seat);
    const graveyard = seat.board.graveyard ?? [];
    const sacrificedSource = {
      ...source,
      zone: "graveyard" as const,
      tapped: false,
      battlefieldPosition: undefined
    };

    if (!chosen) {
      return {
        ...seat,
        board: {
          ...seat.board,
          battlefield: seat.board.battlefield.filter((card) => card.id !== cardId),
          graveyard: [...graveyard, sacrificedSource]
        },
        zones: {
          ...seat.zones,
          battlefield: Math.max(0, seat.zones.battlefield - 1),
          graveyard: seat.zones.graveyard + 1
        }
      };
    }

    foundName = chosen.name;
    return {
      ...seat,
      library: shuffleCards(library.filter((card) => card.id !== chosen.id)),
      board: {
        ...seat.board,
        battlefield: [
          ...seat.board.battlefield.filter((card) => card.id !== cardId),
          {
            ...chosen,
            zone: "battlefield" as const,
            tapped: true,
            battlefieldPosition: undefined
          }
        ],
        graveyard: [...graveyard, sacrificedSource]
      },
      zones: {
        ...seat.zones,
        battlefield: seat.zones.battlefield,
        graveyard: seat.zones.graveyard + 1,
        library: Math.max(0, seat.zones.library - 1)
      }
    };
  });

  if (!sourceName) return session;

  const seatName = session.seats.find((seat) => seat.id === seatId)?.name ?? "Player";
  const detail = foundName ? ` Finds ${foundName}, puts it onto the battlefield tapped, then shuffles.` : " No basic land was found.";
  return {
    ...session,
    seats,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${seatName} sacrifices ${sourceName} and searches for a basic land.${detail}`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

function isBasicLandCard(card: VisibleCard) {
  return card.typeLine.includes("Basic Land") || ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"].includes(card.name);
}

function isBasicLandFetchAbility(card: VisibleCard) {
  const text = card.oracleText.toLowerCase();
  return (
    text.includes("search your library for a basic land card") &&
    text.includes("put it onto the battlefield tapped") &&
    text.includes("sacrifice") &&
    (text.includes("{t}") || text.includes("{tap}") || text.includes("tap,"))
  );
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

function getBasicLandFetchOptions(library: VisibleCard[]) {
  return library.filter(isBasicLandCard);
}

function chooseBestBasicLandForFetch(seat: PlayerSeat) {
  const basics = getBasicLandFetchOptions(seat.library ?? []);
  if (basics.length === 0) return undefined;
  const preferredNames = (seat.deck?.colors ?? seat.board.commander?.colorIdentity ?? [])
    .map((color) => basicLandForColor(color))
    .filter((name): name is string => Boolean(name));
  return basics.find((card) => preferredNames.includes(card.name)) ?? basics[0];
}

function basicLandForColor(color: string): string | undefined {
  if (color === "W") return "Plains";
  if (color === "U") return "Island";
  if (color === "B") return "Swamp";
  if (color === "R") return "Mountain";
  if (color === "G") return "Forest";
  return undefined;
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
      tapped: destination === "battlefield" ? tapped || entersBattlefieldTapped(card, seat) : card.tapped,
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
    toughness: deckCard.card?.toughness ?? (isCreature ? "2" : undefined),
    loyalty: deckCard.card?.loyalty
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
