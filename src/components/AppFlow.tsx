"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentAction, AgentReasoning, CardFaceRecord, CommanderDeck, GameEvent, GameSession, InterpretedEffect, PlayerSeat, VisibleCard } from "@/lib/types";
import type { RuleWorkflow } from "@/lib/rulesAdvisor";
import { createDeckFromList } from "@/lib/deckParser";
import { evaluateOpeningHand } from "@/lib/mulliganHeuristics";
import { effectiveAttackTaxAmount, looksLikeAttackTaxCandidate } from "@/lib/staticEffects";
import { counterCount, effectivePower, effectiveToughness } from "@/lib/counters";
import {
  parseGenericManaAbilities,
  parseGenericSacrificeAbilities,
  parseGenericTapAbilities,
  parseSearchLibraryEffectText,
  parseSelfUntapAbilities,
  type SacrificeAbility,
  type GenericManaAbility,
  type GenericTapAbility,
  type GenericTapEffect,
  type SearchLibraryEffect,
  type SelfUntapAbility
} from "@/lib/activatedAbilities";
import { deathEffectText, etbEffectText, isActivatedAbilityClause, mergeModalBulletClauses, oracleClauses, parseModalHeader } from "@/lib/oracleClauses";
import {
  annihilatorAmount,
  hasKeyword as hasKeywordText,
  protectionColors as cardProtectionColors,
  wardAmount as cardWardAmount
} from "@/lib/keywords";
import {
  counterImmunityScopeMatches,
  counterSpellCanTarget,
  hasCantBeCountered,
  parseCounterImmunityGrant,
  parseCounterSpellAbility
} from "@/lib/counterSpells";
import {
  attachedBasePowerToughness,
  attachedPowerToughnessBonus,
  enchantRestriction,
  equipCost,
  grantedKeywords as attachmentGrantedKeywords,
  grantedProtectionColors as attachmentGrantedProtectionColors,
  isAura,
  isEquipment,
  isRemovalStyleAura
} from "@/lib/attachments";
import {
  computeDevotion,
  countMatchingPermanents,
  hasChooseCreatureTypeEtb,
  parseCharacteristicDefiningAbility,
  parseChooseColorEtb,
  parseDevotionCda,
  parseGroupAnthemBoost,
  parseGroupKeywordGrant,
  parseSelfAnthemBoost,
  permanentMatchesQualifier,
  pickChosenColor,
  pickChosenCreatureType,
  type ManaColorLetter
} from "@/lib/characteristics";
import { matchesTargetType, parseRemovalEffect, type RemovalEffect, type RemovalTargetType } from "@/lib/removalSpells";
import { hasCardType, parseTypeGrantEffects, typeGrantAppliesTo } from "@/lib/typeGrants";
import { parseZoneEffect, type RegrowTargetType, type ZoneEffect } from "@/lib/zoneEffects";
import { ThreeGameTable } from "./ThreeGameTable";

type FlowMode = "setup" | "game";
type DeckInputMode = "commander" | "decklist";
type DeckBuildStatus = "empty" | "building" | "ready" | "error";
type GameStage = "mulligan" | "playing";
type TurnPhase = (typeof TURN_PHASES)[number];
type LibraryLookMode = "scry" | "surveil" | "reorder" | "choose_one";
type ManaColor = "W" | "U" | "B" | "R" | "G" | "C";
type ColoredMana = Exclude<ManaColor, "C">;
type ManaPool = Record<ManaColor, number>;
// A shared `optional` field on every variant (via intersection, not repeated per-branch) — set
// when the source text says "you may" for this effect, so the resolution step can ask the
// controller (human via a real prompt, agent via a deterministic accept-by-default heuristic —
// see resolveAgentRuleChoice) instead of always doing it. Auto-resolving optional effects used to
// be this engine's default; that's wrong for a player who doesn't want to do something every time
// just because it's beneficial (and it's also how an unbounded self-copy loop, like Ondu
// Spiritdancer under Secret Arcade, used to happen with no way to stop it).
type TriggerEffect = (
  | { kind: "draw_cards"; amount: number }
  | { kind: "gain_life"; amount: number }
  | { kind: "lose_life"; amount: number }
  | { kind: "scry_cards"; amount: number }
  | { kind: "surveil_cards"; amount: number }
  | { kind: "create_tokens"; tokens: TokenSpec[] }
  | { kind: "add_counter"; counterKind: "+1/+1" | "-1/-1"; amount: number; scope: "self" | "context" | "target_creature" | "target_creature_you_control" }
  | { kind: "copy_token"; scope: "self" | "context" }
  | { kind: "draw_then_put_back"; drawAmount: number; putBackAmount: number }
  // Mind's Dilation-style "exile the top card of [that player]'s library. Until end of turn, you
  // may cast that card without paying its mana cost if it's a nonland card." — cross-seat (exiles
  // from fromSeatId's library, grants cast permission to the trigger's own controller) and waives
  // the mana cost, neither of which any other TriggerEffect kind models, so this gets its own kind
  // rather than being force-fit into an existing one.
  | { kind: "impulse_cast_free"; fromSeatId: string }
) & { optional?: boolean };

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
      cardTypeLine?: string;
      sourceZone?: "hand" | "command" | "exile";
      manaSourceIds: string[];
      position?: { x: number; z: number };
      triggersChecked?: boolean;
      faceIndex?: number;
      chosenX?: number;
      counterTargetId?: string;
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
      // The permanent "it"/"that creature" refers to for an ETB trigger like "put a +1/+1
      // counter on it" — only meaningful for the add_counter "context" scope; the entering
      // permanent isn't always the trigger source itself (e.g. Cathars' Crusade watches other
      // creatures enter).
      contextCardId?: string;
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
      destination: "hand" | "battlefield" | "graveyard";
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
    }
  | {
      id: string;
      kind: "optional_trigger";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      trigger: Extract<PendingAction, { type: "trigger" }>;
      remainingStack: PendingAction[];
    }
  | {
      id: string;
      kind: "discard_to_hand_size";
      controllerSeatId: string;
      prompt: string;
      requiredDiscards: number;
    }
  | {
      id: string;
      kind: "choose_creature_type";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
    }
  | {
      id: string;
      kind: "choose_color";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      excludedColor?: string;
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
  abilityKind?: "basic_land_fetch" | "unlock_room_door" | "generic_sacrifice" | "generic_tap" | "self_untap" | "generic_mana" | "myriad_landscape" | "equip" | "loyalty_ability";
  abilityIndex?: number;
  faceIndex?: number;
  loyaltyCost?: number;
  // Set only for a cast_spell action sourced from exile (impulse-draw/steal-and-play effects) —
  // absent means the normal "from hand" path.
  sourceZone?: "exile";
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

// Defense-in-depth: the server-side Ollama fetches (src/lib/ollama.ts, src/lib/rulesAdvisor.ts)
// already have their own shorter timeouts and fall back gracefully on expiry, so these client
// fetches should rarely fire — but if the route itself ever hangs (not just Ollama), this stops an
// unbounded `await fetch(...)` from skipping the calling function's `finally` block, which is what
// clears the "a decision is in flight" guard (agentDecisionRequests) that would otherwise lock a
// phase out of ever being retried.
const AGENT_REQUEST_TIMEOUT_MS = 25000;

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
  const [selectedBlockerIds, setSelectedBlockerIds] = useState<string[]>([]);
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
  // Count of consultRulesAdvisor calls currently awaiting their fetch (0 = none in flight). This is
  // the general fix for a whole class of "trigger sometimes silently does nothing" bugs: the phase-
  // advance timers below have always correctly waited on pendingAction/pendingRuleChoice/etc, but
  // consultRulesAdvisor is a fire-and-forget async call that doesn't set any of those while its fetch
  // is in flight — so a phase whose only trigger resolves purely through the Rules Advisor (rather
  // than opening a pendingRuleChoice, like order_triggers/manual_review do) had nothing stopping the
  // "nothing to do this phase, advance after 1100ms" timer from firing first and skipping straight
  // past it, win or lose depending on how fast that particular round trip happened to be. Scry/
  // surveil phase triggers were fixed by routing them around this fetch entirely (resolvePhaseScryOrSurveil),
  // but that only helps the shapes this engine's deterministic layer already recognizes — anything
  // that has to fall through to the Rules Advisor for a real answer is still exposed to this race.
  // Needs to be real state (not a ref) so clearing it triggers the re-render that lets the guarded
  // effects re-evaluate once the in-flight consult resolves.
  const [rulesAdvisorPending, setRulesAdvisorPending] = useState(0);
  const autoValidatedDefaultDeck = useRef(false);
  const agentMainActions = useRef<Set<string>>(new Set());
  const agentDecisionRequests = useRef<Set<string>>(new Set());
  // Render-visible counterparts to agentDecisionRequests (which is a ref and intentionally never
  // triggers a re-render, since it exists purely as a scheduling de-dupe guard). agentThinking
  // drives the "thinking" pulse on the HUD badge; agentReasoning holds each seat's most recent
  // decision so the badge stays clickable after the fact. Keyed by seat.id.
  const [agentThinking, setAgentThinking] = useState<Record<string, boolean>>({});
  const [agentReasoning, setAgentReasoning] = useState<Record<string, AgentReasoning>>({});
  const landPlaysThisTurn = useRef<Set<string>>(new Set());
  // How many spells each seat has cast this turn (key: "${turn}:${seatId}") — feeds the "their
  // first spell each turn" condition cast-triggers can have (Mind's Dilation, ...); never cleaned
  // up between turns since old turns' keys are harmless clutter, same as landPlaysThisTurn.
  const spellsCastThisTurn = useRef<Map<string, number>>(new Map());
  const firstDrawThisTurn = useRef<Set<string>>(new Set());
  const loyaltyActivationsThisTurn = useRef<Set<string>>(new Set());
  const phaseTriggersChecked = useRef<Set<string>>(new Set());
  const cleanupDiscardChecked = useRef<Set<string>>(new Set());
  // Set by endTurn() when the "End Turn" shortcut finds the seat over its max hand size — that
  // shortcut jumps straight past the cleanup step (where the discard normally happens, via the
  // cleanupDiscardChecked effect below) to the next player's untap step, so without this the
  // discard requirement (rule 514.1) never gets a chance to fire and a human could keep an
  // unlimited hand just by always ending their turn early instead of stepping through phases.
  // Cleared once the discard resolves and the turn is actually allowed to end.
  const pendingEndTurnAfterDiscard = useRef<string | undefined>(undefined);
  const processedDeathBatchRef = useRef<GameSession["pendingDeaths"]>(undefined);
  const stackActionsRef = useRef<PendingAction[]>([]);
  const humanSeat = session.seats.find((seat) => seat.kind === "human") ?? session.seats[0];
  const selectedHandCard = selectedHandCardId ? humanSeat.board.hand.find((card) => card.id === selectedHandCardId) : undefined;
  // A priority window is offered whenever untapped lands could cover the cost, not only once mana
  // is already floating (see canReceivePriorityForPendingAction) — this must accept the same
  // fallback, or the "Respond Selected" button stays disabled for a human who hasn't pre-tapped,
  // making instant-speed responses look broken during another player's turn.
  // A type-restricted counterspell ("counter target creature/noncreature/commander spell") in hand
  // used to look just as respondable as any other instant here, even against a stack action it
  // can't legally target — the button stayed enabled, and the human only found out it did nothing
  // useful after already spending the mana and the card (respondWithCard now refuses this too, but
  // this check is what actually surfaces it up front instead of after the fact).
  const selectedCardCanLegallyCounter = (() => {
    if (!selectedHandCard) return true;
    const counterAbility = parseCounterSpellAbility(selectedHandCard.oracleText);
    if (!counterAbility || !pendingAction || pendingAction.type !== "spell") return true;
    const counterTargetCard = findSpellSourceCard(session, pendingAction);
    return (
      counterTargetCard !== undefined &&
      !spellIsImmuneToCounters(session, counterTargetCard, pendingAction.actorSeatId) &&
      counterSpellCanTarget(counterAbility, counterTargetCard.typeLine, pendingAction.sourceZone === "command")
    );
  })();
  const selectedCardCanRespond = selectedHandCard
    ? canCastAtInstantSpeed(selectedHandCard) &&
      selectedCardCanLegallyCounter &&
      (payCostFromPool(poolForSeat(humanSeat.id), selectedHandCard, selectedHandCard.manaValue).ok ||
        chooseManaSourcesForCost(humanSeat, selectedHandCard, selectedHandCard.manaValue).ok)
    : false;
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
      window.setTimeout(() => resumeStackAction(nextAction), 0);
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

  // TEMP DEBUG (remove before finishing): tracking down a reported "Veyra's turn gets skipped
  // entirely" bug — logs every activeSeatId/session.activePlayerId change plus each seat's hasLost
  // state, so a live capture can show whether activePlayerId ever desyncs from activeSeatId or
  // whether Veyra's seat gets hasLost:true incorrectly.
  useEffect(() => {
    const w = window as unknown as { __mtgTurnTrace?: unknown[] };
    w.__mtgTurnTrace = w.__mtgTurnTrace ?? [];
    (w.__mtgTurnTrace as unknown[]).push({
      at: Date.now(),
      turn: session.turn,
      phase: session.phase,
      activeSeatId,
      sessionActivePlayerId: session.activePlayerId,
      seats: session.seats.map((seat) => ({ id: seat.id, name: seat.name, hasLost: Boolean(seat.hasLost), lossReason: seat.lossReason, life: seat.life }))
    });
  }, [activeSeatId, session.activePlayerId, session.turn, session.phase, session.seats]);

  useEffect(() => {
    if (autoValidatedDefaultDeck.current) return;
    const humanConfig = configs.find((config) => config.kind === "human" && config.mode === "decklist" && config.deckList.trim());
    if (!humanConfig || humanConfig.deck) return;
    autoValidatedDefaultDeck.current = true;
    void buildDeck(humanConfig);
  }, [configs]);

  // destroyCreatures() is a pure session transformer with no access to queueCommonTriggers (that
  // lives in this component's closure), so it stashes what died onto session.pendingDeaths instead
  // — this effect is the single place that drains it and queues "whenever a creature dies"
  // triggers, so every death path (combat, removal spells, sacrifice, state-based 0-toughness)
  // fires death triggers the same way instead of each call site having to remember to do it.
  useEffect(() => {
    // beginPendingAction (called by queueCommonTriggers below) unconditionally overwrites whatever
    // pendingAction is currently live, with no rescue for it — pushStackAction only preserves
    // "spell"/"trigger" actions, not "phase" actions (isStackAction excludes them), so a phase-
    // advance action waiting on priority passes (e.g. declare blockers step -> combat damage step)
    // gets silently orphaned if a death trigger interjects mid-resolution (a very real case: combat
    // damage itself can kill a creature the same instant it's waiting to advance past that step).
    // The result looks like agents "getting stuck" passing priority, or an attack that never applies
    // damage, because the real in-flight action was dropped with nothing left pointing at it. Defer
    // draining pendingDeaths until the stack is genuinely idle, mirroring the same `!pendingAction`
    // guard already used by the phase-trigger and block-declaration effects below.
    if (pendingAction) return;
    const deaths = session.pendingDeaths;
    if (!deaths || deaths.length === 0 || deaths === processedDeathBatchRef.current) return;
    processedDeathBatchRef.current = deaths;
    const deathTriggers = deaths.flatMap((death) => findCommonTriggersForPermanentDied(session, death.seatId, death.card, death.attachedSourceIds));
    setSession((current) => (current.pendingDeaths === deaths ? { ...current, pendingDeaths: undefined } : current));
    if (deathTriggers.length > 0) queueCommonTriggers(deathTriggers);
    // A death's own "when this dies" clause can also need a workflow the deterministic
    // common-trigger system doesn't cover (scry/surveil/search-on-death) — consult the rules
    // advisor for those, same as the human-only manual move-to-graveyard path already did, but now
    // for every real death (combat, removal, sacrifice, SBA) and for agent seats too. Skipped when
    // commonTriggerEffect already owns the clause, to avoid double-resolving it or risking an
    // Ollama hallucination for a card that's already fully handled.
    for (const death of deaths) {
      if (death.card.typeLine.includes("Creature") && commonTriggerEffect(death.card.oracleText, "died") === undefined) {
        void consultRulesAdvisor("card_moved_to_graveyard", death.seatId, death.card);
      }
    }
  }, [session.pendingDeaths, pendingAction]);

  useEffect(() => {
    if (mode !== "game" || gameStage !== "playing") return;
    const prioritySeat = session.seats.find((seat) => seat.id === prioritySeatId);
    if (!pendingAction || prioritySeat?.kind !== "agent") return;
    const requiredNow = pendingActionRequiredPasses(session.seats, pendingAction, activeSeatId, session, manaPools);
    if (!requiredNow.includes(prioritySeat.id)) {
      // If nobody actually needs to respond any more (e.g. the caster spent their last mana paying
      // for the very spell that opened this window, so a stale-session prioritySeatId assignment no
      // longer has any real responder behind it), nextPrioritySeatId's fallback returns the pending
      // action's own actor — which, when that actor is already the current prioritySeatId, is a
      // same-value setState that React silently no-ops. Nothing else ever revisits this window, so
      // the stack sits on "Waiting for responses" forever with an empty requiredPasses list and no
      // guard key ever set (this was the actual mechanism behind the "stuck after casting an instant
      // in response" reports — reproduced live via Playwright, not card-specific). Resolving directly
      // here mirrors beginPendingAction's own "requiredPasses.length === 0" fast path.
      if (requiredNow.length === 0) {
        // Cleanup matters here as much as it does for the decision timer below: without it, this
        // effect re-firing (session.seats gets a new array reference on nearly every render, so this
        // is routine, not rare) before the 0ms timeout pops schedules a second, third, ... resolve of
        // the exact same captured pendingAction, applying its effect multiple times over — a real
        // regression caught live (duplicate React keys from the duplicated effects) right after this
        // branch was first added.
        const resolveTimer = window.setTimeout(() => resolvePendingAction(pendingAction), 0);
        return () => window.clearTimeout(resolveTimer);
      }
      setPrioritySeatId(nextPrioritySeatId(session.seats, pendingAction.actorSeatId, priorityPasses, pendingAction, activeSeatId, session, manaPools));
      return;
    }
    const key = `priority:${pendingAction.id}:${prioritySeat.id}:${priorityPasses.join(",")}`;
    if (agentDecisionRequests.current.has(key)) return;
    // The guard is added inside the timer callback, not here — adding it eagerly used to mean an
    // unrelated setSession call (any of them; session.seats gets a new array reference every time)
    // firing within this 850ms window would re-run this effect, whose cleanup cancels the timer
    // below without ever calling decideAgentPriorityAction, so its finally (the only place that
    // deletes the key) never runs either. The key stayed in the set forever, permanently blocking
    // this exact decision — the seat's "thinking" indicator would spin indefinitely with no LLM
    // call ever made or retried, since every future run of this effect saw the same key and bailed
    // out at the check above. This is what produced Sarkhan's Triumph's caster getting stuck
    // "waiting for responses" forever (Stuck.jpg/Response.jpg) — a race, not a deterministic bug,
    // which is why it only happened sometimes.
    const timer = window.setTimeout(() => {
      agentDecisionRequests.current.add(key);
      markAgentThinking(prioritySeat.id, true);
      void decideAgentPriorityAction(prioritySeat, pendingAction, key);
    }, 850);
    return () => window.clearTimeout(timer);
  }, [mode, gameStage, pendingAction, priorityPasses, prioritySeatId, session.seats, session.turn, activeSeatId, manaPools]);


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
      const phase = session.phase as TurnPhase;
      const sourceCard = triggers[0];
      if (phase === "upkeep step" && isCumulativeUpkeepCard(sourceCard)) {
        openCumulativeUpkeepChoice(activeSeat.id, sourceCard);
        return;
      }
      if (resolvePhaseScryOrSurveil(activeSeat.id, sourceCard, phase)) return;
      // Decide synchronously against the current render's session (consistent with the same kind
      // of pre-check already used to skip the advisor for ETB triggers) — consultRulesAdvisor has
      // real side effects (fetch, later setSession calls), so it must never run from inside a
      // setSession updater, which React may in principle invoke more than once.
      if (applyDeterministicPhaseTrigger(session, activeSeat.id, sourceCard, phase) !== undefined) {
        setSession((current) => applyDeterministicPhaseTrigger(current, activeSeat.id, sourceCard, phase) ?? current);
      } else {
        void consultRulesAdvisor(phaseEventName(phase), activeSeat.id, sourceCard);
      }
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

  // Rule 514.1/514.2 (cleanup step): the active player discards down to their maximum hand size
  // (7, unless something on the board says otherwise). Modeled as a pendingRuleChoice, same as
  // every other "controller must decide something" moment (order_triggers, choose_card_from_library,
  // ...) — that reuses the existing guards elsewhere (the main agent-decision effect below already
  // bails out while pendingRuleChoice is set) instead of needing new plumbing. Scoped to the active
  // seat only: only the turn-taking player's hand realistically changes during their own turn in
  // this engine, so per-turn-a-cleanup-step-fires is enough coverage without queueing every seat.
  useEffect(() => {
    if (mode !== "game" || gameStage !== "playing" || pendingAction || pendingRuleChoice) return;
    if (session.phase !== "cleanup step") return;
    const activeSeat = session.seats.find((seat) => seat.id === activeSeatId);
    if (!activeSeat) return;
    const key = `${session.turn}:${activeSeat.id}`;
    if (cleanupDiscardChecked.current.has(key)) return;
    cleanupDiscardChecked.current.add(key);
    const maxHandSize = effectiveMaxHandSize(activeSeat);
    const requiredDiscards = activeSeat.board.hand.length - maxHandSize;
    if (requiredDiscards <= 0) return;
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "discard_to_hand_size",
      controllerSeatId: activeSeat.id,
      prompt: `${activeSeat.name} has ${activeSeat.board.hand.length} cards and must discard down to ${maxHandSize}.`,
      requiredDiscards
    });
  }, [mode, gameStage, pendingAction, pendingRuleChoice, session.phase, session.turn, activeSeatId, session.seats]);

  useEffect(() => {
    if (
      mode !== "game" ||
      gameStage !== "playing" ||
      pendingAction ||
      libraryLook ||
      pendingRuleChoice ||
      manualLibrarySearch ||
      blockChoice ||
      basicLandFetchSearch ||
      rulesAdvisorPending > 0
    )
      return;
    if (session.phase === "declare blockers step") {
      const choice = createCombatBlockChoice(session, activeSeatId);
      if (!choice) {
        const key = `no-blockers:${session.turn}:${activeSeatId}`;
        if (agentDecisionRequests.current.has(key)) return;
        // See the priority-response effect above for why the guard is added inside the timer
        // callback rather than here: an eagerly-added guard whose timer gets cancelled by an
        // unrelated re-render (cleanup fires, callback never does) orphans the key forever, since
        // nothing else ever deletes it — this exact spot used to leave combat permanently stuck
        // with no blockers ever declared and no way to advance.
        const timer = window.setTimeout(() => {
          agentDecisionRequests.current.add(key);
          advanceTurn();
        }, 700);
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
      const timer = window.setTimeout(() => {
        agentDecisionRequests.current.add(key);
        markAgentThinking(defender.id, true);
        void decideAgentBlockAction(defender, choice, key);
      }, 1100);
      return () => window.clearTimeout(timer);
    }
    const activeSeat = session.seats.find((seat) => seat.id === activeSeatId);
    if (activeSeat?.kind !== "agent") return;
    if (shouldAgentFastForwardToEndStep(activeSeat)) {
      const key = `fast-end:${session.turn}:${activeSeat.id}:${session.phase}`;
      if (agentDecisionRequests.current.has(key)) return;
      const timer = window.setTimeout(() => {
        agentDecisionRequests.current.add(key);
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
    const timer = window.setTimeout(() => {
      agentDecisionRequests.current.add(actionKey);
      markAgentThinking(activeSeat.id, true);
      if (session.phase === "declare attackers step") {
        void decideAgentAttackers(activeSeat, actionKey);
      } else {
        void decideAgentTurnAction(activeSeat, actionKey);
      }
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [mode, gameStage, pendingAction, libraryLook, pendingRuleChoice, manualLibrarySearch, blockChoice, basicLandFetchSearch, rulesAdvisorPending, activeSeatId, session.phase, session.turn, session.seats]);

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
      signal: AbortSignal.timeout(AGENT_REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        agentName: seat.agentName ?? seat.name,
        seatName: seat.name,
        context: buildAgentDecisionContext(activeSession, seat, {
          purpose,
          activeSeatId,
          prioritySeatId,
          phase: activeSession.phase,
          turn: activeSession.turn,
          pendingAction: pendingAction ? pendingActionSummary(activeSession, pendingAction) : undefined,
          stack: stackActions.map((item) => pendingActionSummary(activeSession, item)),
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
      const legalActions = legalMainPhaseActions(seat, hasPlayedLandThisTurn(seat.id, session.turn), activeSeatId, session.turn, loyaltyActivationsThisTurn.current, session);
      const action = await requestAgentDecision(seat, "main_phase", legalActions);
      const legal = legalActions.find((item) => item.id === action?.legalActionId) ?? fallbackLegalAction(legalActions);
      if (!legal) {
        advanceTurn();
        return;
      }
      addEvent(`${seat.name} chooses ${legal.label}. ${action?.reason ?? ""}`.trim(), seat.id, "Agent decision");
      recordAgentReasoning(seat.id, { label: legal.label, reason: action?.reason ?? "", deliberation: action?.deliberation, purpose: "main_phase", at: new Date().toISOString() });
      applyAgentTurnAction(seat, legal);
    } catch (error) {
      addEvent(`${seat.name} agent decision failed: ${error instanceof Error ? error.message : "unknown error"}.`, seat.id, "Agent decision");
      applyAgentTurnAction(
        seat,
        fallbackLegalAction(legalMainPhaseActions(seat, hasPlayedLandThisTurn(seat.id, session.turn), activeSeatId, session.turn, loyaltyActivationsThisTurn.current, session))
      );
    } finally {
      agentDecisionRequests.current.delete(requestKey);
      markAgentThinking(seat.id, false);
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
        recordAgentReasoning(seat.id, { label: legal.label, reason: action?.reason ?? "", purpose: "declare_attackers", at: new Date().toISOString() });
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
      markAgentThinking(seat.id, false);
    }
  }

  async function decideAgentPriorityAction(seat: PlayerSeat, actionOnStack: PendingAction, requestKey: string) {
    try {
      const legalActions = legalPriorityActions(seat, actionOnStack, activeSeatId, session);
      const action = await requestAgentDecision(seat, "priority_response", legalActions);
      const legal = legalActions.find((item) => item.id === action?.legalActionId) ?? fallbackLegalAction(legalActions);
      if (!legal) {
        passPriority();
        return;
      }
      addEvent(`${seat.name} chooses ${legal.label}. ${action?.reason ?? ""}`.trim(), seat.id, "Agent decision");
      recordAgentReasoning(seat.id, { label: legal.label, reason: action?.reason ?? "", deliberation: action?.deliberation, purpose: "priority_response", at: new Date().toISOString() });
      applyAgentPriorityAction(seat, legal, actionOnStack);
    } catch (error) {
      addEvent(`${seat.name} priority decision failed: ${error instanceof Error ? error.message : "unknown error"}.`, seat.id, "Agent decision");
      passPriority();
    } finally {
      agentDecisionRequests.current.delete(requestKey);
      markAgentThinking(seat.id, false);
    }
  }

  // Loops the same way decideAgentAttackers loops over multiple attack declarations: each pass
  // offers every not-yet-chosen eligible blocker for this one attacker plus "no more blockers",
  // so the agent can keep adding creatures to a gang-block before the attacker is finally marked
  // decided — mirroring the human toggle-then-confirm flow's "pick order = damage order" semantics.
  async function decideAgentBlockAction(seat: PlayerSeat, choice: BlockChoiceState, requestKey: string) {
    const chosenBlockerIds: string[] = [];
    try {
      let guard = 0;
      while (guard < 8) {
        guard += 1;
        const legalActions = legalBlockActions(session, choice).filter((item) => item.actionType !== "block" || !chosenBlockerIds.includes(item.cardId ?? ""));
        if (!legalActions.some((item) => item.actionType === "block")) break;
        const purpose = chosenBlockerIds.length > 0 ? "declare_blockers_additional" : "declare_blockers";
        const action = await requestAgentDecision(seat, purpose, legalActions);
        const legal = legalActions.find((item) => item.id === action?.legalActionId);
        if (!legal || legal.actionType !== "block" || !legal.cardId) break;
        chosenBlockerIds.push(legal.cardId);
        addEvent(`${seat.name} adds ${legal.label}. ${action?.reason ?? ""}`.trim(), seat.id, "Agent decision");
        recordAgentReasoning(seat.id, { label: legal.label, reason: action?.reason ?? "", purpose: "declare_blockers", at: new Date().toISOString() });
      }
      if (chosenBlockerIds.length === 0) {
        addEvent(`${seat.name} chooses no blocks.`, seat.id, "Agent decision");
      }
      setSession((current) => assignBlockers(current, choice, chosenBlockerIds));
    } catch (error) {
      addEvent(`${seat.name} block decision failed: ${error instanceof Error ? error.message : "unknown error"}.`, seat.id, "Agent decision");
      setSession((current) => assignBlockers(current, choice, chosenBlockerIds));
    } finally {
      agentDecisionRequests.current.delete(requestKey);
      markAgentThinking(seat.id, false);
    }
  }

  function applyAgentTurnAction(seat: PlayerSeat, action: LegalAgentAction | undefined) {
    if (action?.actionType === "end_turn") {
      // Same rule-514.1 check as the human's endTurn() — an agent choosing "end_turn" hits the
      // exact same shortcut that skips past the cleanup step, so it needs the same guard.
      const maxHandSize = effectiveMaxHandSize(seat);
      const requiredDiscards = seat.board.hand.length - maxHandSize;
      if (requiredDiscards > 0) {
        pendingEndTurnAfterDiscard.current = seat.id;
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "discard_to_hand_size",
          controllerSeatId: seat.id,
          prompt: `${seat.name} has ${seat.board.hand.length} cards and must discard down to ${maxHandSize} before ending the turn.`,
          requiredDiscards
        });
        return;
      }
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
      playCard(seat.id, action.cardId, undefined, action.actionType === "cast_commander" ? "command" : action.sourceZone === "exile" ? "exile" : "hand", action.faceIndex);
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
    if (action.actionType === "activate_ability" && action.cardId && action.abilityKind === "generic_sacrifice" && action.abilityIndex !== undefined) {
      activateGenericSacrificeAbility(seat.id, action.cardId, action.abilityIndex);
      return;
    }
    if (action.actionType === "activate_ability" && action.cardId && action.abilityKind === "generic_tap" && action.abilityIndex !== undefined) {
      activateGenericTapAbility(seat.id, action.cardId, action.abilityIndex);
      return;
    }
    if (action.actionType === "activate_ability" && action.cardId && action.abilityKind === "self_untap" && action.abilityIndex !== undefined) {
      activateSelfUntapAbility(seat.id, action.cardId, action.abilityIndex);
      return;
    }
    if (action.actionType === "activate_ability" && action.cardId && action.abilityKind === "generic_mana" && action.abilityIndex !== undefined) {
      activateGenericManaAbility(seat.id, action.cardId, action.abilityIndex);
      return;
    }
    if (action.actionType === "activate_ability" && action.cardId && action.abilityKind === "myriad_landscape") {
      activateMyriadLandscapeForAgent(seat.id, action.cardId);
      return;
    }
    if (action.actionType === "activate_ability" && action.cardId && action.abilityKind === "equip") {
      setSession((current) => resolveEquip(current, seat.id, action.cardId!));
      return;
    }
    if (action.actionType === "activate_ability" && action.cardId && action.abilityKind === "loyalty_ability" && action.loyaltyCost !== undefined) {
      activateLoyaltyAbility(seat.id, action.cardId, action.loyaltyCost, action.detail ?? "");
      return;
    }
    advanceTurn();
  }

  function shouldAgentFastForwardToEndStep(seat: PlayerSeat) {
    if (pendingAction || pendingRuleChoice || libraryLook || manualLibrarySearch || blockChoice || basicLandFetchSearch) return false;
    if (session.phase === "end step" || session.phase === "cleanup step") return false;
    if (!isMainPhase(session.phase) && session.phase !== "declare attackers step") return false;
    if (phaseTriggeredCards(seat, session.phase as TurnPhase).length > 0) return false;

    const hasMainAction = hasAgentMainPhaseAction(seat, hasPlayedLandThisTurn(seat.id, session.turn), activeSeatId, session.turn, loyaltyActivationsThisTurn.current, session);
    const hasAttack = seat.board.battlefield.some((card) => canAttack(card));

    if (session.phase === "precombat main phase") return !hasMainAction && !hasAttack;
    if (session.phase === "declare attackers step") return !hasAttack && !hasAgentMainPhaseAction(seat, true, activeSeatId, session.turn, loyaltyActivationsThisTurn.current, session);
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
      agentRespondWithCard(seat, legal.cardId, legal.sourceZone === "exile" ? "exile" : "hand");
      return;
    }
    if (legal.actionType === "activate_ability" && legal.cardId && legal.abilityKind === "basic_land_fetch") {
      const cardId = legal.cardId;
      setSession((current) => resolveBasicLandFetchSearch(current, seat.id, cardId));
      window.setTimeout(() => passPriority(), 0);
      return;
    }
    if (legal.actionType === "activate_ability" && legal.cardId && legal.abilityKind === "generic_sacrifice" && legal.abilityIndex !== undefined) {
      activateGenericSacrificeAbility(seat.id, legal.cardId, legal.abilityIndex);
      window.setTimeout(() => passPriority(), 0);
      return;
    }
    if (legal.actionType === "activate_ability" && legal.cardId && legal.abilityKind === "generic_tap" && legal.abilityIndex !== undefined) {
      activateGenericTapAbility(seat.id, legal.cardId, legal.abilityIndex);
      window.setTimeout(() => passPriority(), 0);
      return;
    }
    if (legal.actionType === "activate_ability" && legal.cardId && legal.abilityKind === "self_untap" && legal.abilityIndex !== undefined) {
      activateSelfUntapAbility(seat.id, legal.cardId, legal.abilityIndex);
      window.setTimeout(() => passPriority(), 0);
      return;
    }
    if (legal.actionType === "activate_ability" && legal.cardId && legal.abilityKind === "generic_mana" && legal.abilityIndex !== undefined) {
      activateGenericManaAbility(seat.id, legal.cardId, legal.abilityIndex);
      window.setTimeout(() => passPriority(), 0);
      return;
    }
    if (legal.actionType === "activate_ability" && legal.cardId && legal.abilityKind === "myriad_landscape") {
      activateMyriadLandscapeForAgent(seat.id, legal.cardId);
      window.setTimeout(() => passPriority(), 0);
      return;
    }
    passPriority();
  }

  function agentRespondWithCard(seat: PlayerSeat, cardId: string, sourceZone: "hand" | "exile" = "hand") {
    if (!pendingAction) return;
    const card = sourceZone === "exile" ? seat.board.exile?.find((item) => item.id === cardId) : seat.board.hand.find((item) => item.id === cardId);
    // canCastAtInstantSpeed applies identically regardless of source — an exiled sorcery still
    // can't be flashed in, only an exiled instant/flash card can.
    if (!card || !canCastAtInstantSpeed(card)) {
      passPriority();
      return;
    }
    const fixedCost = adjustedCastingCost(seat, card, card.manaValue, sourceZone === "exile" ? "exile" : "hand", activeSeatId);
    const chosenX = maxAffordableX(seat, card, fixedCost);
    const adjustedCost = totalCastingCost(seat, card, card.manaValue, chosenX);
    const payment = chooseManaSourcesForCost(seat, card, adjustedCost);
    if (!payment.ok) {
      addEvent(cannotPayMessage(seat, card, selectedManaTotal(seat, payment.sourceIds), adjustedCost, payment.reason), seat.id, "Mana");
      passPriority();
      return;
    }
    const counterAbility = parseCounterSpellAbility(card.oracleText);
    const counterTargetId = counterAbility && pendingAction.type === "spell" ? pendingAction.id : undefined;
    const action: PendingAction = {
      id: crypto.randomUUID(),
      type: "spell",
      actorSeatId: seat.id,
      cardId,
      cardName: card.name,
      cardTypeLine: card.typeLine,
      sourceZone: sourceZone === "exile" ? "exile" : undefined,
      manaSourceIds: payment.sourceIds,
      chosenX: chosenX > 0 ? chosenX : undefined,
      counterTargetId,
      message: `${seat.name} responds with ${card.name}${chosenX > 0 ? ` (X=${chosenX})` : ""}${sourceZone === "exile" ? " from exile" : ""} using ${selectedManaTotal(seat, payment.sourceIds)} mana.`
    };
    beginPendingAction(action, "Stack");
  }

  function resolveAgentPendingTrigger(trigger: Extract<PendingAction, { type: "trigger" }>) {
    setPendingAction(undefined);
    setPriorityPasses([]);
    const remainingStack = removeStackAction(trigger.id);
    beginTriggerResolution(trigger, remainingStack);
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
    // Every seat has now kept a hand (agents resolved their mulligans up front in startGame; the
    // human is the last to confirm) — this is the correct moment to roll for who plays first,
    // rather than defaulting to a fixed seat.
    const { winnerId: firstSeatId, rolls } = rollForStartingSeat(session.seats);
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
          message: `${current.seats
            .map((seat) => `${seat.name} rolls ${rolls[seat.id] ?? "?"}`)
            .join(", ")}. ${current.seats.find((seat) => seat.id === firstSeatId)?.name ?? "Player"} wins the roll and goes first.`,
          detail: "Starting player roll"
        },
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
    // Rule 514.1: discard down to the maximum hand size before the turn actually ends. The
    // shortcut this button takes skips straight past the cleanup step (where that normally
    // happens) to the next player's untap step, so it has to check for this itself instead of
    // relying on the cleanup-step effect ever getting a chance to run.
    const maxHandSize = effectiveMaxHandSize(activeSeat);
    const requiredDiscards = activeSeat.board.hand.length - maxHandSize;
    if (requiredDiscards > 0) {
      pendingEndTurnAfterDiscard.current = activeSeat.id;
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "discard_to_hand_size",
        controllerSeatId: activeSeat.id,
        prompt: `${activeSeat.name} has ${activeSeat.board.hand.length} cards and must discard down to ${maxHandSize} before ending the turn.`,
        requiredDiscards
      });
      return;
    }
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
      // nextInRotation (not a raw modulo step) so an eliminated player is skipped here the same
      // way resolveEndTurn already skips them — this is the only other place a turn changes hands.
      const nextSeat = nextInRotation(current.seats, activeIndex);
      setActiveSeatId(nextSeat.id);
      setPrioritySeatId(nextSeatId(current.seats, nextSeat.id));
      loyaltyActivationsThisTurn.current.clear();
      return runPhaseActions(
        clearTemporaryBuffs({
          ...current,
          activePlayerId: nextSeat.id,
          turn: current.turn + 1,
          phase: TURN_PHASES[0],
          events: [phaseEvent(nextSeat.id, `${nextSeat.name} starts turn ${current.turn + 1}: ${TURN_PHASES[0]}.`), ...current.events]
        }),
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
      clearTemporaryBuffs({
        ...cleaned,
        activePlayerId: nextSeat.id,
        turn: current.turn + 1,
        phase: TURN_PHASES[0],
        events: [phaseEvent(nextSeat.id, `${nextSeat.name} starts turn ${current.turn + 1}: ${TURN_PHASES[0]}.`), ...cleaned.events]
      }),
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
    const taxedAttacker = payment?.ok ? spendManaSources(attacker, payment.sourceIds) : attacker;

    const attackDeclaredSession: GameSession = {
      ...session,
      seats: session.seats.map((seat) =>
        seat.id === seatId
          ? {
              ...taxedAttacker,
              board: {
                ...taxedAttacker.board,
                battlefield: taxedAttacker.board.battlefield.map((card) =>
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

    const annihilatorN = annihilatorAmount(attackingCard.oracleText);
    if (!annihilatorN) return attackDeclaredSession;
    const sacrifices = chooseAnnihilatorSacrifices(target.seat, annihilatorN);
    if (sacrifices.length === 0) return attackDeclaredSession;
    return destroyCreatures(
      attackDeclaredSession,
      sacrifices.map((card) => ({
        seatId: target.seat.id,
        cardId: card.id,
        message: `${target.seat.name} sacrifices ${card.name} to ${attackingCard.name}'s annihilator ${annihilatorN}.`
      })),
      "Rules action"
    );
  }

  // Shared by both the human UI (toggle-then-confirm) and the agent decision loop (accumulate one
  // creature at a time, then finalize) — assigns every id in blockerCardIds as a blocker for this
  // attacker, in that order, which becomes the attacker's damage-assignment order (rule 509.2:
  // whoever declared the blocks chooses the order, so "the order you picked them in" is exactly
  // that choice). An empty array declares no blockers, same as before.
  function assignBlockers(session: GameSession, choice: BlockChoiceState, blockerCardIds: string[]): GameSession {
    const attacker = session.seats.find((seat) => seat.id === choice.attackerSeatId);
    const defender = session.seats.find((seat) => seat.id === choice.defenderSeatId);
    const attackingCard = attacker?.board.battlefield.find((card) => card.id === choice.attackerCardId && card.attacking);
    if (!attacker || !defender || !attackingCard) return session;
    const blockers = blockerCardIds
      .map((id) => defender.board.battlefield.find((card) => card.id === id && canBlock(card, attackingCard)))
      .filter((card): card is VisibleCard => Boolean(card));
    const decidedSession = markAttackDecided(session, attacker.id, attackingCard.id);
    if (blockers.length === 0) {
      return {
        ...decidedSession,
        events: [phaseEvent(defender.id, `${defender.name} declares no blockers for ${attackingCard.name}.`), ...decidedSession.events]
      };
    }

    const blockerIds = new Set(blockers.map((card) => card.id));
    return {
      ...decidedSession,
      seats: decidedSession.seats.map((seat) => {
        if (seat.id === defender.id) {
          return {
            ...seat,
            board: {
              ...seat.board,
              battlefield: seat.board.battlefield.map((card) => (blockerIds.has(card.id) ? { ...card, blocking: true, blockingTargetId: attackingCard.id } : card))
            }
          };
        }
        if (seat.id === attacker.id && blockers.length > 1) {
          return {
            ...seat,
            board: {
              ...seat.board,
              battlefield: seat.board.battlefield.map((card) =>
                card.id === attackingCard.id ? { ...card, damageAssignmentOrder: blockers.map((blocker) => blocker.id) } : card
              )
            }
          };
        }
        return seat;
      }),
      events: [
        phaseEvent(
          defender.id,
          `${defender.name} blocks ${attackingCard.name} with ${blockers.map((blocker) => blocker.name).join(" and ")}${blockers.length > 1 ? ` (damage order: ${blockers.map((blocker) => blocker.name).join(" then ")})` : ""}.`
        ),
        ...decidedSession.events
      ]
    };
  }

  function toggleHumanBlocker(blockerCardId: string) {
    setSelectedBlockerIds((current) => (current.includes(blockerCardId) ? current.filter((id) => id !== blockerCardId) : [...current, blockerCardId]));
  }

  function confirmHumanBlockers() {
    const choice = blockChoice;
    if (!choice) return;
    setBlockChoice(undefined);
    setSession((current) => assignBlockers(current, choice, selectedBlockerIds));
    setSelectedBlockerIds([]);
  }

  function passHumanBlocks() {
    const choice = blockChoice;
    if (!choice) return;
    setBlockChoice(undefined);
    setSelectedBlockerIds([]);
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

  // Cumulative upkeep (Mystic Remora, ...) has real payment mechanics (payCumulativeUpkeep,
  // sacrificeRuleChoiceSource, resolveAgentRuleChoice's manual_review branch) but, before this, no
  // deterministic path ever OPENED that choice — the phase-trigger scheduler only knew "deterministic
  // effect or consult the Rules Advisor," and a 3B model asked to classify "Cumulative upkeep {1}
  // (...)" text often just didn't recognize it, silently returning workflow "none" (which logs
  // nothing at all) instead of "manual_review." Opening this choice directly, deterministically,
  // whenever the trigger source has the keyword removes that guesswork entirely for this one
  // extremely well-defined shape.
  function openCumulativeUpkeepChoice(seatId: string, sourceCard: VisibleCard) {
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "manual_review",
      controllerSeatId: seatId,
      sourceCardId: sourceCard.id,
      sourceCardName: sourceCard.name,
      prompt: `Pay ${sourceCard.name}'s cumulative upkeep or sacrifice it.`
    });
  }

  // "At the beginning of your upkeep, scry/surveil N" (Aminatou, Veil Piercer's "surveil 2", ...) is
  // an extremely common, well-templated shape that the server-side Rules Advisor DOES already
  // recognize deterministically (deterministicRuleWorkflow, verified directly) — the actual bug was
  // never misclassification, it's that resolving it goes through consultRulesAdvisor's async fetch,
  // which races against the separate "no legal action this phase, advance after 1100ms" timer that
  // isn't blocked by anything while that fetch is still in flight (pendingRuleChoice stays unset the
  // whole time for scry/surveil, unlike order_triggers/manual_review). If advanceTurn() fires first,
  // the game moves on to the next phase and the surveil/scry window is effectively skipped — which is
  // exactly the intermittent "sometimes it just doesn't do anything" the trigger produced. Resolving
  // this synchronously here, like openCumulativeUpkeepChoice, removes the race entirely by never
  // going through the async round trip for this shape at all. Returns whether it matched.
  function resolvePhaseScryOrSurveil(seatId: string, sourceCard: VisibleCard, phase: TurnPhase): boolean {
    const clauseText = phaseEffectText(sourceCard.oracleText, phase);
    if (/^if\b/i.test(clauseText.replace(/^at the beginning of[^,]*,\s*/i, ""))) return false;
    const match = clauseText.match(/\b(scry|surveil)\s+(\d+|a|one|two|three|four|five)\b/i);
    if (!match) return false;
    const count = numberWordToInt(match[2]);
    if (!count) return false;
    const mode = match[1].toLowerCase() as "scry" | "surveil";
    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat) return false;
    if (seat.kind === "human") {
      startLibraryLook(mode, count);
    } else {
      setSession((current) => resolveAgentLibraryLookWorkflow(current, seatId, sourceCard.name, mode === "scry" ? "scry_cards" : "surveil_cards", count));
    }
    return true;
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
      const allBlockers = target.seat.board.battlefield.filter((card) => card.blocking && card.blockingTargetId === attackingCard.id);
      const orderedBlockers = attackingCard.damageAssignmentOrder
        ? attackingCard.damageAssignmentOrder.map((blockerId) => allBlockers.find((card) => card.id === blockerId)).filter((card): card is VisibleCard => Boolean(card))
        : allBlockers;
      result =
        orderedBlockers.length > 0
          ? resolveBlockedCombatDamage(result, attackerId, attackingCard, target, orderedBlockers)
          : applyCombatDamageToTarget(result, attackingCard.name, target, Math.max(0, effectivePower(attackingCard)), attackingCard, attackerId);
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
    const requiredPasses = pendingActionRequiredPasses(session.seats, pendingAction, activeSeatId, session, manaPools);
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
    setPrioritySeatId(nextPrioritySeatId(session.seats, pendingAction.actorSeatId, nextPasses, pendingAction, activeSeatId, session, manaPools));
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

      // Native Miracle (Temporal Mastery, Bonfire of the Damned, ...) was never checked here at
      // all — only Aminatou, Veil Piercer's granted-miracle case below was, and that's scoped to
      // Enchantment cards specifically (matching her own "Enchantment cards in your hand have
      // miracle" text), which no naturally-miracle card actually is. So a card with its own printed
      // "Miracle {cost}" line just went to hand at full cost with the miracle window never offered.
      const nativeMiracleCost = parseMiracleCost(firstDrawn);
      if (nativeMiracleCost !== undefined) {
        setPendingRuleChoice({
          id: crypto.randomUUID(),
          kind: "miracle_offer",
          controllerSeatId: nextSeat.id,
          sourceCardId: firstDrawn.id,
          sourceCardName: firstDrawn.name,
          prompt: `${firstDrawn.name} has miracle. Cast it for its miracle cost, or it stays in hand at full cost.`,
          miracleCost: nativeMiracleCost
        });
        return;
      }

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

  function playCard(seatId: string, cardId: string, position?: { x: number; z: number }, sourceZone: "hand" | "command" | "exile" = "hand", faceIndex?: number) {
    if (pendingAction) return;
    const seat = session.seats.find((item) => item.id === seatId);
    const card =
      sourceZone === "command"
        ? seat?.board.commander
        : sourceZone === "exile"
          ? seat?.board.exile?.find((item) => item.id === cardId)
          : seat?.board.hand.find((item) => item.id === cardId);
    if (!seat || !card) return;

    if (sourceZone === "command" && card.id !== cardId) return;
    // Defense-in-depth: this should already be true whenever this path is reachable (the legal
    // action offering it only exists under the same condition), but exile-play permission is
    // itself temporary/scoped, so re-check it here too.
    if (sourceZone === "exile" && (card.exiledPlayableBySeatId !== seatId || (card.exiledPlayableUntilTurn !== undefined && session.turn > card.exiledPlayableUntilTurn))) {
      return;
    }

    const dfcSplit = modalDoubleFacedLandSplit(card);
    const doors = roomDoorFaces(card);
    const playingAsLand = dfcSplit ? faceIndex === dfcSplit.landIndex : isLandCard(card);

    // Sorcery-speed timing (rule 305.3 for lands, 307.5/601.3a-adjacent for sorcery-speed spells):
    // lands and any card that isn't instant-speed can only be played on the caster's own turn,
    // during one of their main phases. This path (playCard) is the ONLY entry point for a human's
    // drag-and-drop main-phase play — the response-window path (respondWithCard) is separate and
    // already gates on canCastAtInstantSpeed. Without this check here, a drag that lands on the
    // battlefield during e.g. the draw step (or an opponent's turn) would silently succeed: the
    // card moves, and for lands it also burns the turn's one-land allowance with nothing to show
    // for it, leaving the player unable to play a land later in their real main phase.
    if ((playingAsLand || !canCastAtInstantSpeed(card)) && (activeSeatId !== seatId || !isMainPhase(session.phase))) {
      addEvent(
        `${seat.name} can only ${playingAsLand ? "play a land" : `cast ${card.name}`} during a main phase on their own turn.`,
        seatId,
        "Timing"
      );
      setSelectedHandCardId(undefined);
      return;
    }

    if (playingAsLand) {
      if (sourceZone !== "hand") return;
      if (hasPlayedLandThisTurn(seatId, session.turn)) {
        addEvent(`${seat.name} already played a land this turn.`, seatId, "Mana");
        return;
      }
      landPlaysThisTurn.current.add(landTurnKey(seatId, session.turn));
      const playedFaceCard = applyChosenFaceToCard(card, faceIndex);
      const playedName = playedFaceCard.name;
      // "As this land enters, choose a color[/creature type]" (the Thriving cycle, the Gate cycle,
      // Cavern of Souls, ...) — this whole block was previously only wired into the spell-resolution
      // path (see the matching comments below), which a land play never goes through (lands never
      // hit the stack), so a land with this clause entered with chosenColor/chosenCreatureType left
      // unset for BOTH agents and the human, silently limiting it to its base color forever. Mirrors
      // that path exactly: auto-pick immediately (needed for agents, and as the human's default),
      // then for the human specifically follow up with a real choice modal pre-loaded with that pick.
      const chooseColorEtb = parseChooseColorEtb(playedFaceCard.oracleText);
      const choosesCreatureType = hasChooseCreatureTypeEtb(playedFaceCard.oracleText);
      setSession((current) => {
        const playedSession = playCardFromZone(current, seatId, cardId, `${seat.name} plays ${playedName}.`, position, "battlefield", [], "hand", faceIndex);
        const chosenTypeSession = choosesCreatureType ? applyChosenCreatureType(playedSession, seatId, cardId) : playedSession;
        const nextSession = chooseColorEtb ? applyChosenColor(chosenTypeSession, seatId, cardId, chooseColorEtb.excludedColor) : chosenTypeSession;
        const triggers = findCommonTriggersForPermanentEntered(nextSession, seatId, card);
        if (triggers.length > 0) {
          window.setTimeout(() => queueCommonTriggers(triggers), 0);
        }
        return nextSession;
      });
      if (seat.kind === "human") {
        if (choosesCreatureType) {
          window.setTimeout(
            () =>
              setPendingRuleChoice({
                id: crypto.randomUUID(),
                kind: "choose_creature_type",
                controllerSeatId: seatId,
                sourceCardId: cardId,
                sourceCardName: playedName,
                prompt: `Choose a creature type for ${playedName}.`
              }),
            0
          );
        } else if (chooseColorEtb) {
          const excludedColor = chooseColorEtb.excludedColor;
          window.setTimeout(
            () =>
              setPendingRuleChoice({
                id: crypto.randomUUID(),
                kind: "choose_color",
                controllerSeatId: seatId,
                sourceCardId: cardId,
                sourceCardName: playedName,
                prompt: `Choose a color for ${playedName}${excludedColor ? ` (other than ${excludedColor})` : ""}.`,
                excludedColor
              }),
            0
          );
        }
      }
      void consultRulesAdvisor("land_played", seatId, card);
      void consultStaticEffectInterpreter(seatId, card);
      setSelectedHandCardId(undefined);
      return;
    }

    // Rule 601.2c: a spell with no legal target for a targeted effect (removal, reanimation, or an
    // Aura's own "Enchant X" line) can't legally be cast at all — this was previously only enforced
    // for agents (legalMainPhaseActions builds their action list from it); a human clicking "Play
    // Selected" went straight through to payment, so e.g. Animate Dead with nothing in any graveyard
    // would cast, resolve, and fizzle into the graveyard instead of never being castable.
    if (!hasResolvableTarget(session, seatId, card)) {
      addEvent(`${seat.name} cannot cast ${card.name}; there is no legal target.`, seatId, "Mana");
      setSelectedHandCardId(undefined);
      return;
    }

    const doorFace = doors && faceIndex !== undefined ? doors[faceIndex] : undefined;
    const costCard = doorFace ? cardWithFaceManaCost(card, doorFace.manaCost) : card;
    const baseCost = doorFace ? manaValueFromManaCost(doorFace.manaCost) : card.manaValue;
    const fixedCost = adjustedCastingCost(seat, costCard, baseCost, sourceZone, activeSeatId) + (sourceZone === "command" ? card.commanderTax ?? 0 : 0);
    const chosenX = doorFace ? 0 : maxAffordableX(seat, costCard, fixedCost, seat.kind === "human" ? poolForSeat(seatId) : undefined);
    const totalCost = totalCastingCost(seat, costCard, baseCost, chosenX) + (sourceZone === "command" ? card.commanderTax ?? 0 : 0);
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
    const castTypeLine = doorFace?.typeLine ?? (dfcSplit ? dfcSplit.spellFace.typeLine : card.typeLine);
    const spentManaText = seat.kind === "human" && payment.ok ? ` spending ${formatManaPoolPayment(payment.spent)}` : ` using ${availableMana} mana`;
    const xText = chosenX > 0 ? ` (X=${chosenX})` : "";
    const action: PendingAction = {
      id: crypto.randomUUID(),
      type: "spell",
      actorSeatId: seatId,
      cardId,
      cardName: castName,
      cardTypeLine: castTypeLine,
      sourceZone,
      manaSourceIds: payment.sourceIds,
      position,
      faceIndex: doorFace ? faceIndex : dfcSplit?.spellIndex,
      chosenX: chosenX > 0 ? chosenX : undefined,
      message: `${seat.name} casts ${castName}${xText}${sourceZone === "command" ? " from the command zone" : sourceZone === "exile" ? " from exile" : ""}${spentManaText}.`
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
        const spent = spendManaSources(item, payment.sourceIds);
        return {
          ...spent,
          board: {
            ...spent.board,
            battlefield: spent.board.battlefield.map((permanent) =>
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

  // A search_library effect needs the interactive library-search choice UI (pendingRuleChoice),
  // which the pure resolveGenericSacrificeAbility/applySacrificeEffect functions can't reach —
  // detected here first, cost paid synchronously against the current session (mirroring how
  // toggleTapCard already reads `session` directly for a same-tick decision), then the same
  // choose_card_from_library flow real tutor spells already use takes over: resolveAgentRuleChoice's
  // existing effect auto-resolves it for agent seats, and the human gets the normal search modal.
  function activateGenericSacrificeAbility(seatId: string, cardId: string, abilityIndex: number) {
    const card = session.seats.find((item) => item.id === seatId)?.board.battlefield.find((item) => item.id === cardId);
    const ability = card ? parseGenericSacrificeAbilities(card.oracleText)[abilityIndex] : undefined;
    if (card && ability?.effect.kind === "search_library") {
      const paid = payGenericSacrificeCost(session, seatId, cardId, abilityIndex);
      if (!paid) return;
      const searchEffect = ability.effect;
      setSession(() => paid.session);
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_card_from_library",
        controllerSeatId: seatId,
        sourceCardId: cardId,
        sourceCardName: card.name,
        prompt: `Search your library: ${ability.clause}`,
        destination: searchEffect.destination,
        tapped: searchEffect.tapped,
        maxChoices: 1,
        allowedCardFilter: searchEffect.cardTypeFilter
      });
      return;
    }
    setSession((current) => resolveGenericSacrificeAbility(current, seatId, cardId, abilityIndex));
  }

  function activateGenericTapAbility(seatId: string, cardId: string, abilityIndex: number) {
    const card = session.seats.find((item) => item.id === seatId)?.board.battlefield.find((item) => item.id === cardId);
    const ability = card ? parseGenericTapAbilities(card.oracleText)[abilityIndex] : undefined;
    if (card && ability?.effect.kind === "search_library") {
      const paid = payGenericTapCost(session, seatId, cardId, abilityIndex);
      if (!paid) return;
      const searchEffect = ability.effect;
      setSession(() => paid.session);
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_card_from_library",
        controllerSeatId: seatId,
        sourceCardId: cardId,
        sourceCardName: card.name,
        prompt: `Search your library: ${ability.clause}`,
        destination: searchEffect.destination,
        tapped: searchEffect.tapped,
        maxChoices: 1,
        allowedCardFilter: searchEffect.cardTypeFilter
      });
      return;
    }
    setSession((current) => resolveGenericTapAbility(current, seatId, cardId, abilityIndex));
  }

  function activateSelfUntapAbility(seatId: string, cardId: string, abilityIndex: number) {
    setSession((current) => resolveSelfUntapAbility(current, seatId, cardId, abilityIndex));
  }

  function activateGenericManaAbility(seatId: string, cardId: string, abilityIndex: number) {
    const card = session.seats.find((item) => item.id === seatId)?.board.battlefield.find((item) => item.id === cardId);
    const ability = card ? parseGenericManaAbilities(card.oracleText)[abilityIndex] : undefined;
    const effect = ability ? parseGenericAbilityEffect(ability.effectText) : undefined;
    if (card && ability && effect?.kind === "search_library") {
      const paid = payGenericManaCost(session, seatId, cardId, abilityIndex);
      if (!paid) return;
      const searchEffect = effect.effect;
      setSession(() => paid.session);
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_card_from_library",
        controllerSeatId: seatId,
        sourceCardId: cardId,
        sourceCardName: card.name,
        prompt: `Search your library: ${ability.clause}`,
        destination: searchEffect.destination,
        tapped: searchEffect.tapped,
        maxChoices: 1,
        allowedCardFilter: searchEffect.cardTypeFilter
      });
      return;
    }
    setSession((current) => resolveGenericManaAbility(current, seatId, cardId, abilityIndex));
  }

  function activateEquip(seatId: string, cardId: string) {
    setSession((current) => resolveEquip(current, seatId, cardId));
  }

  // Prowess and extort both trigger the instant a spell is cast (put on the stack), regardless of
  // whether it came from a main-phase cast or an instant-speed response — beginPendingAction is
  // the one choke point every spell cast passes through, so it's checked here rather than at each
  // of the three call sites that construct a "spell" PendingAction.
  function checkCastTriggeredKeywords(action: Extract<PendingAction, { type: "spell" }>) {
    const caster = session.seats.find((seat) => seat.id === action.actorSeatId);
    const sourceCard = findSpellSourceCard(session, action);
    if (!caster || !sourceCard) return;

    // "The next spell you cast this turn has affinity for artifacts" is used up by this cast
    // whether or not it actually reduced anything (e.g. zero artifacts controlled) — the cost
    // itself was already computed with the discount by adjustedCastingCost/maxAffordableX earlier
    // in playCard, before beginPendingAction (and this function) ever runs.
    if (caster.nextSpellHasArtifactAffinity) {
      setSession((current) => ({
        ...current,
        seats: current.seats.map((seat) => (seat.id === caster.id ? { ...seat, nextSpellHasArtifactAffinity: false } : seat))
      }));
    }

    if (!sourceCard.typeLine.includes("Creature")) {
      const prowessCreatureIds = caster.board.battlefield.filter((card) => hasKeyword(card, "prowess")).map((card) => card.id);
      if (prowessCreatureIds.length > 0) {
        setSession((current) => ({
          ...current,
          seats: current.seats.map((seat) =>
            seat.id === caster.id
              ? {
                  ...seat,
                  board: {
                    ...seat.board,
                    battlefield: seat.board.battlefield.map((card) =>
                      prowessCreatureIds.includes(card.id)
                        ? { ...card, temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + 1, temporaryToughnessBonus: (card.temporaryToughnessBonus ?? 0) + 1 }
                        : card
                    )
                  }
                }
              : seat
          ),
          events: [
            {
              id: crypto.randomUUID(),
              at: new Date().toISOString(),
              seatId: caster.id,
              message: `${caster.name}'s prowess creature${prowessCreatureIds.length === 1 ? "" : "s"} get +1/+1 until end of turn from casting ${sourceCard.name}.`,
              detail: "Rules action"
            },
            ...current.events
          ]
        }));
      }
    }

    const extortSources = caster.board.battlefield.filter((card) => hasKeyword(card, "extort"));
    for (const extortSource of extortSources) {
      const manaSource = caster.board.battlefield.find(
        (card) => isAvailableManaSource(card, caster) && !card.tapped && (manaChoicesForCard(card, caster).includes("W") || manaChoicesForCard(card, caster).includes("B"))
      );
      if (!manaSource) continue;
      const opponentIds = session.seats.filter((seat) => seat.id !== caster.id && !seat.hasLost).map((seat) => seat.id);
      if (opponentIds.length === 0) continue;
      setSession((current) => ({
        ...current,
        seats: current.seats.map((seat) => {
          if (seat.id === caster.id) return spendManaSources({ ...seat, life: seat.life + opponentIds.length }, [manaSource.id]);
          if (opponentIds.includes(seat.id)) return { ...seat, life: Math.max(0, seat.life - 1) };
          return seat;
        }),
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: caster.id,
            message: `${caster.name} extorts with ${extortSource.name}: each opponent loses 1 life, ${caster.name} gains ${opponentIds.length}.`,
            detail: "Rules action"
          },
          ...current.events
        ]
      }));
    }

    if (isHistoricCard(sourceCard)) {
      const historicTriggerSources = caster.board.battlefield.filter((card) => /whenever you cast a historic spell,\s*draw a card/i.test(card.oracleText));
      for (const source of historicTriggerSources) {
        setSession((current) => drawForSeat(current, caster.id, `${source.name} triggers: ${caster.name} draws a card from casting the historic spell ${sourceCard.name}.`));
      }
    }
  }

  // Reopens the priority window for an action that's already on the stack (used when priority
  // comes back around to it after whatever was on top of it resolved) — as opposed to
  // beginPendingAction, which is for a brand-new action that hasn't been logged or pushed yet.
  // Sharing beginPendingAction for both used to be exactly the bug: it unconditionally pushes a
  // fresh "casts X..." event (using the action's own fixed id) into session.events every time it
  // runs, with no de-dupe check the way pushStackAction itself already has one (`current.some(item
  // => item.id === action.id)`). An action resumed multiple times over a busy stack (several
  // responses each resolving in turn, handing priority back to the same still-pending spell between
  // each one) re-logged that same "casts X..." line — with its wording drifting between calls since
  // requiredPasses is recomputed fresh each time (whoever could still respond keeps shrinking as the
  // stack empties out) — every single time, which is what produced the repeated "Encountered two
  // children with the same key" React warnings for the same event id.
  function resumeStackAction(action: PendingAction) {
    const requiredPasses = pendingActionRequiredPasses(session.seats, action, activeSeatId, session, manaPools);
    if (requiredPasses.length === 0) {
      window.setTimeout(() => resolvePendingAction(action), 0);
      return;
    }
    setPendingAction(action);
    setPriorityPasses([]);
    setPrioritySeatId(nextPrioritySeatId(session.seats, action.actorSeatId, [], action, activeSeatId, session, manaPools));
  }

  function beginPendingAction(action: PendingAction, detail: string) {
    if (action.type === "spell") {
      checkCastTriggeredKeywords(action);
      const sourceCard = findSpellSourceCard(session, action);
      if (sourceCard) {
        const turnSeatKey = `${session.turn}:${action.actorSeatId}`;
        const priorSpellCount = spellsCastThisTurn.current.get(turnSeatKey) ?? 0;
        const isFirstSpellThisTurn = priorSpellCount === 0;
        spellsCastThisTurn.current.set(turnSeatKey, priorSpellCount + 1);
        const castTriggers = findCastTriggers(session, action.actorSeatId, sourceCard, isFirstSpellThisTurn);
        // Deferred, same reasoning as the land-ETB-trigger scheduling elsewhere in this file:
        // queueCommonTriggers itself calls beginPendingAction, so calling it synchronously here
        // (still inside this very call to beginPendingAction) would be reentrant.
        if (castTriggers.length > 0) {
          window.setTimeout(() => queueCommonTriggers(castTriggers), 0);
        }
      }
    }
    const requiredPasses = pendingActionRequiredPasses(session.seats, action, activeSeatId, session, manaPools);
    pushStackAction(action);
    setSession((current) => ({
      ...current,
      // Rule 601.2h: costs are paid as part of casting a spell, immediately — not deferred until
      // it resolves. This used to only happen in playCardFromZone at resolution time, so an
      // agent's chosen mana sources stayed marked untapped on the battlefield for the entire
      // window the spell sat on the stack: the same land/rock could be illegally re-selected to
      // pay for a second spell cast in response before the first one ever resolved. A human's own
      // `manaSourceIds` is empty when they paid from an already-floating pool (tapForMana already
      // tapped those sources at click time), but non-empty when respondWithCard fell back to
      // auto-tapping untapped sources for an instant-speed response — this immediate tap is what
      // stops that same land from being double-spent on a second response before this one resolves.
      // Tapping again at resolution is a no-op either way once a source is already tapped/sacrificed.
      seats:
        action.type === "spell" && action.manaSourceIds.length > 0
          ? current.seats.map((seat) => (seat.id === action.actorSeatId ? spendManaSources(seat, action.manaSourceIds) : seat))
          : current.seats,
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
    setPrioritySeatId(nextPrioritySeatId(session.seats, action.actorSeatId, [], action, activeSeatId, session, manaPools));
  }

  function respondWithSelectedCard() {
    if (!selectedHandCardId) return;
    respondWithCard(selectedHandCardId, "hand");
  }

  // Generalized so a human can respond with either a hand card (the normal "Play Selected during
  // a response window" flow) or an exiled card they currently have play permission for — gated by
  // the same canCastAtInstantSpeed check either way, so an exiled sorcery still isn't offered as a
  // response, only an exiled instant/flash card is.
  function respondWithCard(cardId: string, sourceZone: "hand" | "exile") {
    if (!pendingAction || prioritySeatId !== humanSeat.id) return;
    const card = sourceZone === "exile" ? humanSeat.board.exile?.find((item) => item.id === cardId) : humanSeat.board.hand.find((item) => item.id === cardId);
    if (!card) return;
    if (
      sourceZone === "exile" &&
      (card.exiledPlayableBySeatId !== humanSeat.id || (card.exiledPlayableUntilTurn !== undefined && session.turn > card.exiledPlayableUntilTurn))
    ) {
      return;
    }
    if (!canCastAtInstantSpeed(card)) {
      addEvent(`${humanSeat.name} cannot respond with ${card.name}; it is not playable at instant speed.`, humanSeat.id, "Mana");
      return;
    }
    if (!hasResolvableTarget(session, humanSeat.id, card)) {
      addEvent(`${humanSeat.name} cannot respond with ${card.name}; there is no legal target.`, humanSeat.id, "Mana");
      return;
    }
    const counterAbility = parseCounterSpellAbility(card.oracleText);
    // The agent path (legalPriorityActions) already refuses to even offer a type-restricted
    // counterspell ("counter target creature/noncreature/commander spell") against an illegal
    // target — this mirrors that same check for a human's own respond flow, which previously had
    // no such gate at all: selecting e.g. Essence Scatter (creature-only) against a noncreature
    // spell would spend the mana and card, then silently do nothing useful at resolution, with no
    // explanation of why. Checked before mana leaves the pool, same as the no-legal-target check
    // above, so a rejected response doesn't cost anything.
    if (counterAbility && pendingAction.type === "spell") {
      const counterTargetCard = findSpellSourceCard(session, pendingAction);
      const isCommanderSpell = pendingAction.sourceZone === "command";
      const legalCounterTarget =
        counterTargetCard &&
        !spellIsImmuneToCounters(session, counterTargetCard, pendingAction.actorSeatId) &&
        counterSpellCanTarget(counterAbility, counterTargetCard.typeLine, isCommanderSpell);
      if (!legalCounterTarget) {
        addEvent(`${humanSeat.name} cannot respond with ${card.name}; it can't legally counter ${pendingAction.cardName}.`, humanSeat.id, "Mana");
        return;
      }
    }
    const fixedCost = adjustedCastingCost(humanSeat, card, card.manaValue, sourceZone === "exile" ? "exile" : "hand", activeSeatId);
    const pool = poolForSeat(humanSeat.id);
    // canReceivePriorityForPendingAction already offers this priority window whenever untapped
    // lands could cover the cost, not only when mana is already floating — payment must accept the
    // same fallback (auto-tap, same as the agent path and acceptMiracleOffer), or a human who
    // hasn't manually pre-tapped can never actually resolve an instant-speed response even though
    // they were given the chance to try.
    const chosenX = manaPoolTotal(pool) > 0 ? maxAffordableX(humanSeat, card, fixedCost, pool) : maxAffordableX(humanSeat, card, fixedCost);
    const adjustedCost = totalCastingCost(humanSeat, card, card.manaValue, chosenX);
    const poolPayment = payCostFromPool(pool, card, adjustedCost);
    const payment = poolPayment.ok ? poolPayment : chooseManaSourcesForCost(humanSeat, card, adjustedCost);
    const availableMana = poolPayment.ok ? manaPoolTotal(pool) : selectedManaTotal(humanSeat, payment.sourceIds);
    if (!isLandCard(card) && !payment.ok) {
      addEvent(cannotPayMessage(humanSeat, card, availableMana, adjustedCost, payment.reason), humanSeat.id, "Mana");
      return;
    }
    const manaSourceIds = isLandCard(card) || poolPayment.ok ? [] : payment.sourceIds;
    if (!isLandCard(card) && poolPayment.ok) {
      setSeatManaPool(humanSeat.id, poolPayment.pool);
      clearManaContributions(humanSeat.id);
    }
    const counterTargetId = counterAbility && pendingAction.type === "spell" ? pendingAction.id : undefined;
    const action: PendingAction = {
      id: crypto.randomUUID(),
      type: "spell",
      actorSeatId: humanSeat.id,
      cardId,
      cardName: card.name,
      cardTypeLine: card.typeLine,
      sourceZone: sourceZone === "exile" ? "exile" : undefined,
      manaSourceIds,
      chosenX: chosenX > 0 ? chosenX : undefined,
      counterTargetId,
      message: `${humanSeat.name} responds with ${card.name}${chosenX > 0 ? ` (X=${chosenX})` : ""}${sourceZone === "exile" ? " from exile" : ""}.`
    };
    if (sourceZone === "hand") setSelectedHandCardId(undefined);
    beginPendingAction(action, "Stack");
  }

  // Single entry point for the "Cast from Exile" buttons (CardInspector, the exile pile viewer):
  // playCard() bails out silently whenever something is already on the stack awaiting responses
  // (main-phase casting only), which used to make those buttons a dead click during a response
  // window. Route through respondWithCard instead whenever one is open.
  function castFromExile(seatId: string, cardId: string) {
    if (pendingAction) {
      respondWithCard(cardId, "exile");
      return;
    }
    playCard(seatId, cardId, undefined, "exile");
  }

  function resolvePendingTrigger() {
    if (!pendingAction || pendingAction.type !== "trigger" || prioritySeatId !== pendingAction.controllerSeatId) return;
    const trigger = pendingAction;
    setPendingAction(undefined);
    setPriorityPasses([]);
    const remainingStack = removeStackAction(trigger.id);
    beginTriggerResolution(trigger, remainingStack);
  }

  // Single entry point for actually resolving a trigger once it's off the priority stack — gates
  // on effect.optional (a "you may" clause) by asking the controller first (a real prompt for a
  // human, a deterministic accept-by-default heuristic for an agent — see resolveAgentRuleChoice)
  // instead of always doing it. Mandatory effects skip straight to finishTriggerResolution.
  function beginTriggerResolution(trigger: Extract<PendingAction, { type: "trigger" }>, remainingStack: PendingAction[]) {
    if (trigger.effect.optional) {
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "optional_trigger",
        controllerSeatId: trigger.controllerSeatId,
        sourceCardId: trigger.sourceCardId,
        sourceCardName: trigger.sourceCardName,
        prompt: `${trigger.message} Do you want to?`,
        trigger,
        remainingStack
      });
      return;
    }
    finishTriggerResolution(trigger, remainingStack, true);
  }

  function finishTriggerResolution(trigger: Extract<PendingAction, { type: "trigger" }>, remainingStack: PendingAction[], accepted: boolean) {
    if (accepted) {
      setSession((current) => {
        const next = resolveTriggerEffect(current, trigger);
        checkMiracleAfterDraw(current, next);
        return next;
      });
    } else {
      addEvent(
        `${session.seats.find((seat) => seat.id === trigger.controllerSeatId)?.name ?? "Player"} declines ${trigger.sourceCardName}'s optional effect.`,
        trigger.controllerSeatId,
        "Rules action"
      );
    }
    if (trigger.parentAction) {
      window.setTimeout(() => beginPendingAction(trigger.parentAction!, "Stack"), 0);
    } else {
      resumeTopStackAction(remainingStack);
    }
  }

  function acceptOptionalTrigger() {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "optional_trigger") return;
    setPendingRuleChoice(undefined);
    finishTriggerResolution(choice.trigger, choice.remainingStack, true);
  }

  function declineOptionalTrigger() {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "optional_trigger") return;
    setPendingRuleChoice(undefined);
    finishTriggerResolution(choice.trigger, choice.remainingStack, false);
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
      beginTriggerResolution(action, remainingStack);
      return;
    }

    const trigger = action.triggersChecked ? undefined : findTriggeredAbilityForSpell(session, action);
    if (trigger) {
      const checkedAction = { ...action, triggersChecked: true };
      updateStackAction(checkedAction);
      beginPendingAction({ ...trigger, parentAction: checkedAction }, "Trigger");
      return;
    }

    if (action.counterTargetId) {
      const counterTargetAction = stackActionsRef.current.find((item) => item.id === action.counterTargetId);
      if (counterTargetAction && counterTargetAction.type === "spell") {
        const counterCardRaw = findSpellSourceCard(session, action);
        const counterAbility = counterCardRaw ? parseCounterSpellAbility(counterCardRaw.oracleText) : undefined;
        const targetSeat = session.seats.find((seat) => seat.id === counterTargetAction.actorSeatId);
        const taxPayment =
          counterAbility?.taxAmount !== undefined && targetSeat
            ? chooseManaSourcesForCost(targetSeat, genericCostShim(counterAbility.taxAmount), counterAbility.taxAmount)
            : undefined;
        const counterTargetCard = findSpellSourceCard(session, counterTargetAction);
        const immune = counterTargetCard ? spellIsImmuneToCounters(session, counterTargetCard, counterTargetAction.actorSeatId) : false;
        const isCountered = !immune && !(counterAbility?.taxAmount !== undefined && taxPayment?.ok);

        const remainingStackAfterCounterspell = removeStackAction(action.id);
        const stackAfterCounter = isCountered ? removeStackAction(counterTargetAction.id) : remainingStackAfterCounterspell;

        setSession((current) => {
          const rawSourceCard = findSpellSourceCard(current, action);
          const sourceCard = rawSourceCard ? applyChosenFaceToCard(rawSourceCard, action.faceIndex) : undefined;
          let next = playCardFromZone(
            current,
            action.actorSeatId,
            action.cardId,
            `${action.cardName} resolves.`,
            action.position,
            "graveyard",
            action.manaSourceIds,
            action.sourceZone ?? "hand",
            action.faceIndex
          );
          if (sourceCard) void consultRulesAdvisor("spell_resolved_to_graveyard", action.actorSeatId, sourceCard);

          if (isCountered) {
            const targetCurrentSeat = next.seats.find((seat) => seat.id === counterTargetAction.actorSeatId);
            const targetCard =
              counterTargetAction.sourceZone === "command"
                ? targetCurrentSeat?.board.commander
                : targetCurrentSeat?.board.hand.find((card) => card.id === counterTargetAction.cardId);
            if (targetCard) {
              next = moveCardBetweenVisibleZones(next, counterTargetAction.actorSeatId, targetCard.id, "graveyard");
            }
            next = {
              ...next,
              events: [
                {
                  id: crypto.randomUUID(),
                  at: new Date().toISOString(),
                  seatId: action.actorSeatId,
                  message: `${action.cardName} counters ${counterTargetAction.cardName}.`,
                  detail: "Rules action"
                },
                ...next.events
              ]
            };
          } else {
            next = {
              ...next,
              seats: next.seats.map((seat) => (taxPayment?.ok && seat.id === counterTargetAction.actorSeatId ? spendManaSources(seat, taxPayment.sourceIds) : seat)),
              events: [
                {
                  id: crypto.randomUUID(),
                  at: new Date().toISOString(),
                  seatId: counterTargetAction.actorSeatId,
                  message: `${counterTargetAction.cardName}'s controller pays {${counterAbility?.taxAmount}} to avoid being countered by ${action.cardName}.`,
                  detail: "Rules action"
                },
                ...next.events
              ]
            };
          }

          if (!resumeTopStackAction(stackAfterCounter)) {
            setPrioritySeatId(action.actorSeatId);
          }
          return next;
        });
        return;
      }
    }

    const remainingStack = removeStackAction(action.id);
    setSession((current) => {
      const baseDestination = spellResolutionDestination(current, action);
      const rawSourceCard = findSpellSourceCard(current, action);
      const sourceCard = rawSourceCard ? applyChosenFaceToCard(rawSourceCard, action.faceIndex) : undefined;
      // An Aura with a creature-restricted "Enchant" clause and no legal target on the battlefield
      // is put into its owner's graveyard instead of resolving (rule 608.2b); "Enchant player" is
      // targeted at a player seat instead (see attach_player below); other restrictions this
      // engine doesn't model targeting for (Enchant land/artifact) just enter without attaching
      // rather than being wrongly treated as having "no legal target."
      const auraAttach =
        sourceCard && baseDestination === "battlefield" && isAura(sourceCard)
          ? chooseAuraAttachTarget(current, action.actorSeatId, sourceCard.oracleText)
          : undefined;
      const destination = auraAttach?.kind === "no_target" ? "graveyard" : baseDestination;
      // Only the entering permanent's own ETB-effect text counts here — a "dies" trigger or an
      // activated ability elsewhere in the same oracle text (e.g. Hangarback Walker's death
      // trigger) must not be read as something that happens immediately on resolution.
      const tokenSpecs = sourceCard ? parseCreateTokenSpecs(etbEffectText(sourceCard.oracleText)) : [];
      const playedSession = playCardFromZone(
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
      const baseResolvedSession =
        auraAttach?.kind === "attach"
          ? applyAuraAttachment(playedSession, action.actorSeatId, sourceCard!.id, auraAttach.seatId, auraAttach.cardId)
          : auraAttach?.kind === "attach_player"
            ? applyAuraAttachToPlayer(playedSession, action.actorSeatId, sourceCard!.id, auraAttach.seatId)
            : playedSession;
      const tokenCreation = sourceCard && tokenSpecs.length > 0 ? createTokensForSeat(baseResolvedSession, action.actorSeatId, sourceCard.id, tokenSpecs) : undefined;
      const tokenResolvedSession = tokenCreation?.session ?? baseResolvedSession;
      const xCounterSession =
        sourceCard && destination === "battlefield" && action.chosenX && entersWithXCounters(sourceCard.oracleText)
          ? applyEntersWithXCounters(tokenResolvedSession, action.actorSeatId, sourceCard.id, action.chosenX)
          : tokenResolvedSession;
      // Multikicker's charge-counter cycle (Everflowing Chalice, ...) reuses chosenX for "times
      // kicked" (see parseMultikickerCost) — same shape as the +1/+1-counter case above, just a
      // different counter kind and not restricted to creatures.
      const multikickerCounterSession =
        sourceCard && destination === "battlefield" && action.chosenX && entersWithChargeCounterPerKick(sourceCard.oracleText)
          ? applyEntersWithCounterKind(xCounterSession, action.actorSeatId, sourceCard.id, "charge", action.chosenX)
          : xCounterSession;
      const exploreTimes = sourceCard && destination === "battlefield" ? exploreCount(sourceCard.oracleText) : undefined;
      const exploredSession = exploreTimes ? resolveExplore(multikickerCounterSession, action.actorSeatId, sourceCard!.id, exploreTimes) : multikickerCounterSession;
      // Generic destroy/exile/direct-damage spells (Murder, Lightning Bolt, ...) — applies
      // regardless of where the spell itself ends up, since instants/sorceries resolve to the
      // graveyard while their effect still needs to happen.
      const removalEffect = sourceCard ? parseRemovalEffect(etbEffectText(sourceCard.oracleText)) : undefined;
      const removalResolvedSession =
        removalEffect && sourceCard ? applyRemovalEffect(exploredSession, action.actorSeatId, sourceCard.name, sourceCard, removalEffect, action.chosenX) : exploredSession;
      // "Choose one/two —" cards are fully owned by removalEffect above (if a removal-shaped mode
      // exists) or genericModalEffect below (otherwise) — the whole-text zoneEffect scan a few
      // lines down has no awareness of modal headers at all and would otherwise misfire on any
      // card whose bullets include reanimate/mill/regrow/gain-control wording, applying that one
      // bullet's effect unconditionally regardless of which mode should actually have been chosen
      // (e.g. Profane Command's reanimate mode would always trigger even on a "choose one or both"
      // card, and even if a different mode was the one actually wanted).
      const isModalCard = Boolean(sourceCard && parseModalHeader(sourceCard.oracleText));
      // Reanimate/mill/regrow/steal-control spells (Reanimate, Regrowth, Threaten, ...) — same
      // "applies regardless of the spell's own destination" reasoning as removal effects above.
      const zoneEffect = sourceCard && !isModalCard ? parseZoneEffect(etbEffectText(sourceCard.oracleText)) : undefined;
      const zoneResolvedSession =
        zoneEffect && sourceCard ? applyZoneEffect(removalResolvedSession, action.actorSeatId, sourceCard.name, zoneEffect, action.chosenX) : removalResolvedSession;
      // "Target creature gets +N/+N or -N/-N until end of turn." (Giant Growth, Afflict, ...) — a
      // plain (non-modal) single-mode pump/debuff spell; X is substituted from the spell's own
      // chosenX first, same as every other X-aware effect here. Modal pump modes (Profane Command's
      // -X/-X) are handled inside genericModalEffect below instead.
      const pumpEffect =
        sourceCard && !isModalCard
          ? parseTargetedPump(action.chosenX !== undefined ? substituteX(etbEffectText(sourceCard.oracleText), action.chosenX) : etbEffectText(sourceCard.oracleText))
          : undefined;
      const pumpResolvedSession =
        pumpEffect && sourceCard ? applyTargetedPumpEffect(zoneResolvedSession, action.actorSeatId, sourceCard, pumpEffect) : zoneResolvedSession;
      const genericModalEffect = sourceCard && isModalCard && !removalEffect ? parseGenericModalEffect(sourceCard.oracleText, action.chosenX) : undefined;
      const preTriggerSession =
        genericModalEffect && sourceCard ? applyGenericModalEffect(pumpResolvedSession, action.actorSeatId, sourceCard, genericModalEffect) : pumpResolvedSession;
      // "As this enters, choose a creature type" (Cavern of Souls, Urza's Incubator, Morophon, ...)
      // — locked in immediately, before SBAs recompute anthems/cost reducers that read it back off
      // chosenCreatureType. Not routed through the trigger-queue/accept-decline UI: it's a
      // mandatory choice with no "when/whenever" wording, not an optional triggered ability.
      const chosenTypeSession =
        sourceCard && destination === "battlefield" && hasChooseCreatureTypeEtb(sourceCard.oracleText)
          ? applyChosenCreatureType(preTriggerSession, action.actorSeatId, sourceCard.id)
          : preTriggerSession;
      // "As this land enters, choose a color other than X" (the Thriving cycle, the Gate cycle,
      // ...) — same immediate, mandatory-choice reasoning as chosenCreatureType above, just for a
      // color instead of a creature type.
      const chooseColorEtb = sourceCard ? parseChooseColorEtb(sourceCard.oracleText) : undefined;
      const chosenColorSession =
        sourceCard && destination === "battlefield" && chooseColorEtb
          ? applyChosenColor(chosenTypeSession, action.actorSeatId, sourceCard.id, chooseColorEtb.excludedColor)
          : chosenTypeSession;
      // The auto-pick above already locked in a real (deterministic) choice — that's necessary for
      // agents, which have no UI to prompt, and is applied uniformly so the rest of this resolution
      // (SBA recompute, etc.) always has a real value to work with. For a HUMAN caster specifically,
      // immediately follow up with a real choice modal pre-loaded with that auto-pick as the
      // default, so they get an actual say instead of the engine silently deciding for them —
      // overriding it just updates the already-resolved permanent's field directly, no re-resolution
      // needed. Deferred to the next tick since this whole block runs inside a setSession updater.
      if (sourceCard && destination === "battlefield" && action.actorSeatId === humanSeat.id) {
        if (hasChooseCreatureTypeEtb(sourceCard.oracleText)) {
          const cardId = sourceCard.id;
          const cardName = sourceCard.name;
          window.setTimeout(
            () =>
              setPendingRuleChoice({
                id: crypto.randomUUID(),
                kind: "choose_creature_type",
                controllerSeatId: action.actorSeatId,
                sourceCardId: cardId,
                sourceCardName: cardName,
                prompt: `Choose a creature type for ${cardName}.`
              }),
            0
          );
        } else if (chooseColorEtb) {
          const cardId = sourceCard.id;
          const cardName = sourceCard.name;
          const excludedColor = chooseColorEtb.excludedColor;
          window.setTimeout(
            () =>
              setPendingRuleChoice({
                id: crypto.randomUUID(),
                kind: "choose_color",
                controllerSeatId: action.actorSeatId,
                sourceCardId: cardId,
                sourceCardName: cardName,
                prompt: `Choose a color for ${cardName}${excludedColor ? ` (other than ${excludedColor})` : ""}.`,
                excludedColor
              }),
            0
          );
        }
      }
      // Run state-based actions now, before checking ETB-trigger applicability, so grantedTypes
      // (Secret Arcade-style type grants) and the other SBA-computed fields are fresh — otherwise
      // a permanent that only becomes (e.g.) an enchantment via a separate static ability wouldn't
      // be recognized as one yet by "an enchantment enters" watchers, including its own, on the
      // very turn it enters. Safe to call early: checkStateBasedActions is pure and idempotent,
      // and the setSession wrapper still re-runs it on whatever this returns.
      const resolvedSession = destination === "battlefield" ? checkStateBasedActions(chosenColorSession) : chosenColorSession;
      const queuedTriggers = sourceCard && destination === "battlefield" ? findCommonTriggersForPermanentEntered(resolvedSession, action.actorSeatId, sourceCard) : [];
      if (sourceCard) {
        // If the deterministic common-trigger system already owns this card's own ETB clause
        // (draw/gain life/lose life/tokens/counters, queued above), don't also ask the rules
        // advisor about it — that would either double the effect (a second draw_cards workflow)
        // or, for effect kinds the advisor's workflow enum can't express, fall through to the
        // Ollama fallback and risk it hallucinating an unrelated workflow for a card that's
        // already fully handled (the same class of bug fixed for check lands). A "choose a
        // creature type" permanent is also fully owned deterministically now (choice + whatever
        // "of the chosen type" static clause references it), even though it has no
        // commonTriggerEffect match of its own. A modal card is fully owned the moment ANY mode
        // was recognized (removalEffect or genericModalEffect) regardless of destination — modal
        // spells are usually instants/sorceries (destination "graveyard"), so this can't rely on
        // the battlefield-only check above the way a permanent's own ETB clause can. A recognized
        // pump/debuff spell is the same story (also usually an instant/sorcery).
        const ownEtbAlreadyHandled =
          (destination === "battlefield" &&
            (commonTriggerEffect(sourceCard.oracleText, "entered") !== undefined ||
              hasChooseCreatureTypeEtb(sourceCard.oracleText) ||
              chooseColorEtb !== undefined)) ||
          (isModalCard && (removalEffect !== undefined || genericModalEffect !== undefined)) ||
          pumpEffect !== undefined;
        if (!ownEtbAlreadyHandled) {
          void consultRulesAdvisor(destination === "battlefield" ? "spell_resolved_to_battlefield" : "spell_resolved_to_graveyard", action.actorSeatId, sourceCard);
        }
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

  function markAgentThinking(seatId: string, thinking: boolean) {
    setAgentThinking((current) => ({ ...current, [seatId]: thinking }));
  }

  function recordAgentReasoning(seatId: string, reasoning: AgentReasoning) {
    setAgentReasoning((current) => ({ ...current, [seatId]: reasoning }));
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

    setRulesAdvisorPending((count) => count + 1);
    try {
      const response = await fetch("/api/rules/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(AGENT_REQUEST_TIMEOUT_MS),
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
    } finally {
      setRulesAdvisorPending((count) => Math.max(0, count - 1));
    }
  }

  function applyRuleWorkflow(seatId: string, sourceCard: VisibleCard, workflow: RuleWorkflow, source: "deterministic" | "ollama" | "fallback") {
    if (workflow.workflow === "none") return;

    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat) return;
    const isHuman = seat.kind === "human";
    addEvent(`Rules advisor (${source}): ${workflow.summary}`, seatId, "Rules advisor");

    if (workflow.workflow === "proliferate") {
      setSession((current) => resolveProliferate(current));
      return;
    }

    // Every other workflow below routes through pendingRuleChoice/setSession, which already have
    // agent-side auto-resolution (resolveAgentRuleChoice, resolveAgentLibraryLookWorkflow) — this
    // used to bail out for non-human seats entirely, silently skipping agent-cast draw/search/scry
    // spells' actual effects after only logging the rules-advisor event.
    if (workflow.workflow === "search_basic_lands_shared_type_to_battlefield_tapped") {
      if (isHuman) {
        setInspectedCard(undefined);
        setMyriadSearch({ seatId, sourceCardId: workflow.sourceCardId ?? sourceCard.id });
        return;
      }
      // myriadSearch has no agent auto-resolver; auto-search directly instead of leaving it stuck.
      const pair = chooseBestBasicLandPairForMyriad(seat);
      if (pair.length === 2) {
        setSession((current) => resolveMyriadLandscapeSearch(current, seatId, workflow.sourceCardId ?? sourceCard.id, pair.map((card) => card.id)));
      } else {
        addEvent(`${seat.name} has no valid basic land pair to find for ${sourceCard.name}.`, seatId, "Rules advisor");
      }
      return;
    }

    if (
      workflow.workflow === "search_library_to_hand" ||
      workflow.workflow === "search_library_to_battlefield" ||
      workflow.workflow === "search_library_to_graveyard"
    ) {
      const destination: "hand" | "battlefield" | "graveyard" =
        workflow.workflow === "search_library_to_battlefield"
          ? "battlefield"
          : workflow.workflow === "search_library_to_graveyard"
            ? "graveyard"
            : workflow.destination === "battlefield" || workflow.destination === "graveyard"
              ? workflow.destination
              : "hand";
      setPendingRuleChoice({
        id: crypto.randomUUID(),
        kind: "choose_card_from_library",
        controllerSeatId: seatId,
        sourceCardId: workflow.sourceCardId ?? sourceCard.id,
        sourceCardName: sourceCard.name,
        prompt: workflow.summary,
        destination,
        tapped: workflow.tapped,
        maxChoices: Math.max(1, workflow.maxChoices || 1),
        allowedCardFilter: workflow.allowedCardFilter
      });
      return;
    }

    if (workflow.workflow === "draw_cards") {
      const count = Math.max(1, workflow.maxChoices || 1);
      setSession((current) => {
        const next = drawMultipleForSeat(current, seatId, count, `${seat.name} draws ${count} from ${sourceCard.name}.`);
        checkMiracleAfterDraw(current, next);
        return next;
      });
      return;
    }

    if (workflow.workflow === "scry_cards" || workflow.workflow === "surveil_cards" || workflow.workflow === "look_at_top_cards" || workflow.workflow === "reorder_top_cards") {
      const count = Math.max(1, workflow.maxChoices || 1);
      const lookWorkflow = workflow.workflow;
      if (isHuman) {
        // "look_at_top_cards" (Diabolic Vision: "look at the top N, put one into hand and the rest
        // on top in any order") needs its own mode — it used to be folded into "scry", which only
        // ever loaded a single card and offered top/bottom choices, neither of which lets a card
        // actually reach hand. "reorder_top_cards" (Ponder-style: put them all back, no hand pick)
        // keeps using plain "reorder".
        const humanMode: LibraryLookMode =
          lookWorkflow === "surveil_cards"
            ? "surveil"
            : lookWorkflow === "reorder_top_cards"
              ? "reorder"
              : lookWorkflow === "look_at_top_cards"
                ? "choose_one"
                : "scry";
        startLibraryLook(humanMode, count);
        return;
      }
      setSession((current) => resolveAgentLibraryLookWorkflow(current, seatId, sourceCard.name, lookWorkflow, count));
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
        signal: AbortSignal.timeout(AGENT_REQUEST_TIMEOUT_MS),
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
    // See the matching guard in resolvePendingAction: skip the advisor when the deterministic
    // common-trigger system already owns this card's death clause, to avoid double-resolving it
    // (or, for effect kinds outside the advisor's workflow enum, risking an Ollama hallucination).
    if (card && card.zone === "battlefield" && commonTriggerEffect(card.oracleText, "died") === undefined) {
      void consultRulesAdvisor("card_moved_to_graveyard", seatId, card);
    }
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
    if (seat.id !== activeSeatId) {
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

    if (/costs? \{1\} less to cast for each artifact you control|has affinity for artifacts/i.test(abilityText)) {
      setSession((current) => ({
        ...current,
        seats: current.seats.map((item) => (item.id === seatId ? { ...item, nextSpellHasArtifactAffinity: true } : item)),
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId,
            message: `${seat.name}'s next spell this turn costs {1} less to cast for each artifact ${seat.name} controls.`,
            detail: "Loyalty"
          },
          ...current.events
        ]
      }));
      return;
    }

    const effect = commonTriggerEffect(abilityText, "clause");
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
    if (!seat || !card) return;
    if (card.tapped) {
      addEvent(`${card.name} is tapped and cannot activate its search ability.`, seatId, "Rules action");
      return;
    }
    const totalCost = 2;
    const payment = chooseManaSourcesForCost(seat, genericCostShim(totalCost), totalCost);
    if (!payment.ok) {
      addEvent(cannotPayMessage(seat, genericCostShim(totalCost), selectedManaTotal(seat, payment.sourceIds), totalCost, payment.reason), seatId, "Mana");
      return;
    }
    setSession((current) => ({
      ...current,
      seats: current.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item))
    }));
    setMyriadSearch({ seatId, sourceCardId: cardId });
  }

  // Agents have no interactive land-picker, so they auto-resolve the search the same way
  // basic-land fetches already do for them (chooseBestBasicLandPairForMyriad).
  function activateMyriadLandscapeForAgent(seatId: string, cardId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    if (!seat || !card || card.tapped) return;
    const totalCost = 2;
    const payment = chooseManaSourcesForCost(seat, genericCostShim(totalCost), totalCost);
    if (!payment.ok) return;
    const pair = chooseBestBasicLandPairForMyriad(seat);
    if (pair.length !== 2) return;
    setSession((current) => {
      const spentSeats = current.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item));
      return resolveMyriadLandscapeSearch({ ...current, seats: spentSeats }, seatId, cardId, pair.map((item) => item.id));
    });
  }

  function resolveBasicLandFetch(seatId: string, cardId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    setInspectedCard(undefined);
    if (!seat || !card || !isBasicLandFetchAbility(card)) return;
    if (basicLandFetchCostRequiresTap(card) && card.tapped) {
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

  // Overrides the deterministic auto-pick (pickChosenCreatureType/pickChosenColor already applied
  // it at resolution time, same as for an agent) with whatever the human actually picked — just
  // updates the already-resolved permanent's field directly, no re-resolution needed.
  function chooseCreatureTypeChoice(creatureType: string) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_creature_type") return;
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) =>
        seat.id === choice.controllerSeatId
          ? { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === choice.sourceCardId ? { ...card, chosenCreatureType: creatureType } : card)) } }
          : seat
      )
    }));
    addEvent(`${choice.sourceCardName}'s chosen creature type is ${creatureType}.`, choice.controllerSeatId, "Rules action");
    setPendingRuleChoice(undefined);
  }

  function chooseColorChoice(color: ManaColor) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_color") return;
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) =>
        seat.id === choice.controllerSeatId
          ? { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === choice.sourceCardId ? { ...card, chosenColor: color } : card)) } }
          : seat
      )
    }));
    addEvent(`${choice.sourceCardName}'s chosen color is ${color}.`, choice.controllerSeatId, "Rules action");
    setPendingRuleChoice(undefined);
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

    if (choice.kind === "discard_to_hand_size") {
      const seat = session.seats.find((item) => item.id === choice.controllerSeatId);
      const discardIds = cardIds.slice(0, choice.requiredDiscards);
      // If endTurn() opened this choice specifically to enforce the discard before its shortcut
      // skips the rest of the turn, finish that skip now that the discard is resolved — chained
      // inside the same setSession update so resolveEndTurn sees the post-discard hand, not stale
      // pre-discard state.
      const endTurnAfter = pendingEndTurnAfterDiscard.current === choice.controllerSeatId;
      pendingEndTurnAfterDiscard.current = undefined;
      setSession((current) => {
        const discarded = discardIds.reduce((next, cardId) => moveCardBetweenVisibleZones(next, choice.controllerSeatId, cardId, "graveyard"), current);
        return endTurnAfter ? resolveEndTurn(discarded, choice.controllerSeatId) : discarded;
      });
      addEvent(
        `${seat?.name ?? "Player"} discards ${discardIds.length} card${discardIds.length === 1 ? "" : "s"} to hand size.`,
        choice.controllerSeatId,
        "Rules action"
      );
      if (endTurnAfter) {
        setSelectedHandCardId(undefined);
        setPriorityPasses([]);
      }
      setPendingRuleChoice(undefined);
      return;
    }

    addEvent(`Rules choice reviewed for ${choice.sourceCardName}.`, choice.controllerSeatId, "Rules advisor");
    setPendingRuleChoice(undefined);
  }

  function completeDiscardChoice(cardIds: string[]) {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "discard_to_hand_size") return;
    completeRuleChoice(choice, cardIds);
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
    const phase = TURN_PHASES.includes(session.phase as TurnPhase) ? (session.phase as TurnPhase) : undefined;
    // Threaded sequentially so, e.g., two deterministically-resolved reanimation triggers in the
    // chosen order each see the board state left by the one before them — same "same class of
    // bug, single fix point" reasoning as applyDeterministicPhaseTrigger's own comment.
    let workingSession = session;
    for (const trigger of triggers) {
      const card = workingSession.seats.find((item) => item.id === seatId)?.board.battlefield.find((item) => item.id === trigger.sourceCardId);
      if (!card) continue;
      // Cumulative upkeep needs an actual pay-or-sacrifice decision (see openCumulativeUpkeepChoice)
      // rather than a deterministic session transform or an Ollama classification — only one
      // pendingRuleChoice can be open at a time, so this commits whatever's been resolved so far and
      // stops here; any remaining ordered triggers this same upkeep simply don't get a chance to fire
      // this pass (better than the previous behavior, where a cumulative-upkeep trigger anywhere in
      // the order silently never got a real decision at all).
      if (phase === "upkeep step" && isCumulativeUpkeepCard(card)) {
        if (workingSession !== session) setSession(workingSession);
        openCumulativeUpkeepChoice(seatId, card);
        return;
      }
      if (phase && resolvePhaseScryOrSurveil(seatId, card, phase)) {
        if (workingSession !== session) setSession(workingSession);
        return;
      }
      const resolved = phase ? applyDeterministicPhaseTrigger(workingSession, seatId, card, phase) : undefined;
      if (resolved) {
        workingSession = resolved;
      } else {
        void consultRulesAdvisor(phase ? phaseEventName(phase) : "phase_trigger", seatId, card);
      }
    }
    if (workingSession !== session) setSession(workingSession);
  }

  function cancelRuleChoice() {
    if (pendingRuleChoice) {
      addEvent(`No rule choice was made for ${ruleChoiceLabel(pendingRuleChoice)}.`, pendingRuleChoice.controllerSeatId, "Rules advisor");
      // Don't let a cancelled discard-to-hand-size choice leave a stale "end the turn once this
      // resolves" flag armed for whatever the NEXT discard_to_hand_size choice turns out to be
      // (e.g. a real cleanup-step one on a future turn).
      if (pendingRuleChoice.kind === "discard_to_hand_size" && pendingEndTurnAfterDiscard.current === pendingRuleChoice.controllerSeatId) {
        pendingEndTurnAfterDiscard.current = undefined;
      }
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
    if (choice.kind === "optional_trigger") {
      // Deterministic accept-by-default heuristic, matching how every other agent rule-choice
      // here is decided without an LLM round-trip — most "you may" effects are beneficial, and the
      // trigger-chain circuit breaker (see resolveTriggerEffect) is what actually protects against
      // an unbounded loop, not this choice. A more deliberate agent policy (e.g. stop after N
      // self-copies even though it still could) would need real judgment and is future work.
      addEvent(`${seat.name} chooses to do ${choice.sourceCardName}'s optional effect.`, seat.id, "Rules advisor");
      setPendingRuleChoice(undefined);
      finishTriggerResolution(choice.trigger, choice.remainingStack, true);
      return;
    }
    if (choice.kind === "discard_to_hand_size") {
      // Same "highest mana value first" heuristic chooseWorstHandCardToDiscard already uses for
      // discard-cost activated abilities, generalized to pick N cards instead of just one.
      let hand = seat.board.hand;
      const discardIds: string[] = [];
      for (let count = 0; count < choice.requiredDiscards && hand.length > 0; count += 1) {
        const worst = hand.reduce((current, card) => (card.manaValue > current.manaValue ? card : current));
        discardIds.push(worst.id);
        hand = hand.filter((card) => card.id !== worst.id);
      }
      completeRuleChoice(choice, discardIds);
      return;
    }
    if (choice.kind === "manual_review") {
      const source = seat.board.battlefield.find((card) => card.id === choice.sourceCardId);
      // Cumulative upkeep previously had no agent-specific handling at all — it fell all the way
      // through to "passes manual review" below, which neither pays the cost nor sacrifices the
      // permanent, just dismisses the choice and leaves the card sitting there with its upkeep
      // unpaid and unresolved. Mirrors the human's own payCumulativeUpkeep/sacrificeRuleChoiceSource
      // decision with a simple, deterministic "pay if affordable" heuristic, matching how every
      // other optional-cost decision in this file is made without needing an LLM judgment call.
      if (source && isCumulativeUpkeepCard(source)) {
        const cost = cumulativeUpkeepCost(source);
        const payment = chooseManaSourcesForCost(seat, genericCostShim(cost), cost);
        if (payment.ok) {
          setSession((current) => ({
            ...current,
            seats: current.seats.map((item) =>
              item.id === seat.id
                ? spendManaSources(
                    { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === source.id ? applyCounterDelta(card, "age", 1) : card)) } },
                    payment.sourceIds
                  )
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
        } else {
          addEvent(`${seat.name} can't pay ${source.name}'s cumulative upkeep and sacrifices it.`, seat.id, "Rules advisor");
          setSession((current) => moveCardBetweenVisibleZones(current, seat.id, source.id, "graveyard"));
        }
        setPendingRuleChoice(undefined);
        return;
      }
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

  // "choose_one" (Diabolic Vision-style "look at the top N, put one into hand, the rest on top in
  // any order") is a two-phase interaction: this handles phase one (send exactly one looked-at card
  // to hand), then hands off to the existing "reorder" mode/orderLibraryLookCardOnTop for phase two
  // (choosing what order the rest go back in) — reusing that flow rather than duplicating it.
  function sendLibraryLookCardToHand(cardId: string) {
    const activeLook = libraryLook;
    if (!activeLook || activeLook.mode !== "choose_one") return;
    const card = activeLook.cards.find((item) => item.id === cardId);
    if (!card) return;
    setSession((current) => moveLibraryCardToDestination(current, activeLook.seatId, cardId, "hand", false));
    const remainingCards = activeLook.cards.filter((item) => item.id !== cardId);
    if (remainingCards.length === 0) {
      setLibraryLook(undefined);
      return;
    }
    setLibraryLook({ seatId: activeLook.seatId, mode: "reorder", cards: remainingCards, remaining: remainingCards.length, orderedCards: [] });
  }

  // A permanent whose only function is producing mana (a land or a mana rock, not a creature and
  // not equipment) doesn't need the card inspector at all — tapping it for mana is the only thing
  // there is to decide, so a single click should just do it (or open the color-choice modal
  // toggleTapCard already shows for multi-color sources), instead of requiring the hidden hover +
  // "T" keyboard shortcut to discover that tapping is even possible.
  function isSimpleManaSourcePermanent(card: VisibleCard, seat: PlayerSeat) {
    return !card.typeLine.includes("Creature") && !isEquipment(card) && isAvailableManaSource(card, seat);
  }

  function handleInspectCard(card: VisibleCard) {
    const ownerSeat = session.seats.find((seat) => seat.board.battlefield.some((item) => item.id === card.id));
    if (ownerSeat?.id === humanSeat.id && isSimpleManaSourcePermanent(card, humanSeat)) {
      toggleTapCard(humanSeat.id, card.id, "battlefield");
      return;
    }
    setInspectedCard(card);
  }

  function toggleTapCard(seatId: string, cardId: string, location: "battlefield" | "command") {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = location === "command" ? seat?.board.commander : seat?.board.battlefield.find((item) => item.id === cardId);
    if (seat && card && !card.tapped && isAvailableManaSource(card, seat)) {
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
    if (!seat || !card || card.tapped || !isAvailableManaSource(card, seat)) return;
    setSession((current) => tapVisibleCard(current, seatId, cardId, location));
    const amount = manaProducedBy(card, seat);
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
        agentThinking={agentThinking}
        agentReasoning={agentReasoning}
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
        onInspectCard={handleInspectCard}
        onCloseInspectCard={() => setInspectedCard(undefined)}
        onPassPriority={passPriority}
        onPlayCard={playCard}
        onCastFromExile={castFromExile}
        onRespond={openResponseWindow}
        onRespondWithSelectedCard={respondWithSelectedCard}
        onResolvePendingTrigger={resolvePendingTrigger}
        onToggleBlocker={toggleHumanBlocker}
        selectedBlockerIds={selectedBlockerIds}
        onConfirmBlockers={confirmHumanBlockers}
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
        onActivateSacrificeAbility={activateGenericSacrificeAbility}
        onActivateTapAbility={activateGenericTapAbility}
        onActivateSelfUntap={activateSelfUntapAbility}
        onActivateGenericMana={activateGenericManaAbility}
        onActivateEquip={activateEquip}
        onChangeLife={changeLife}
        onScry={(count) => startLibraryLook("scry", count)}
        onSurveil={(count) => startLibraryLook("surveil", count)}
        libraryLook={libraryLook}
        ruleChoice={ruleChoiceView(pendingRuleChoice, humanSeat, manualLibrarySearch)}
        onAcceptMiracle={acceptMiracleOffer}
        onDeclineMiracle={declineMiracleOffer}
        onAcceptOptionalTrigger={acceptOptionalTrigger}
        onDeclineOptionalTrigger={declineOptionalTrigger}
        onCompleteDiscardChoice={completeDiscardChoice}
        onChooseCreatureType={chooseCreatureTypeChoice}
        onChooseColor={chooseColorChoice}
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
        onSendLibraryLookCardToHand={sendLibraryLookCardToHand}
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
  return card.typeLine.includes("Creature") && !card.tapped && (!card.summoningSick || hasHaste(card)) && !card.attacking && !hasDefender(card);
}

function canBlock(card: VisibleCard, attacker?: VisibleCard) {
  if (!card.typeLine.includes("Creature") || card.tapped || card.blocking) return false;
  if (attacker && hasFlying(attacker) && !hasFlying(card) && !hasReach(card)) return false;
  if (attacker && isProtectedFrom(attacker, card)) return false;
  // Rule 702.111b: menace requires the attacker be blocked by two or more creatures, assigned
  // simultaneously — this engine's block model (BlockChoiceState) only ever assigns one blocker
  // per attacker, with no way to commit a second one alongside it. Rather than let a single
  // creature illegally block a menace attacker alone, decline every single-block candidate for it,
  // matching this codebase's "decline rather than guess" handling of shapes it can't fully model.
  if (attacker && hasMenace(attacker)) return false;
  return true;
}

function hasKeyword(card: VisibleCard, keyword: string) {
  return hasKeywordText(card.oracleText, keyword) || Boolean(card.grantedKeywords?.includes(keyword));
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

function hasDefender(card: VisibleCard) {
  return hasKeyword(card, "defender");
}

function hasHaste(card: VisibleCard) {
  return hasKeyword(card, "haste");
}

function hasLifelink(card: VisibleCard) {
  return hasKeyword(card, "lifelink");
}

function hasWither(card: VisibleCard) {
  return hasKeyword(card, "wither");
}

function hasInfect(card: VisibleCard) {
  return hasKeyword(card, "infect");
}

function hasHexproof(card: VisibleCard) {
  return hasKeyword(card, "hexproof");
}

function hasShroud(card: VisibleCard) {
  return hasKeyword(card, "shroud");
}

function hasWard(card: VisibleCard) {
  return hasKeyword(card, "ward");
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
  if (hasDefender(card)) keywords.push("defender");
  if (hasHaste(card)) keywords.push("haste");
  if (hasLifelink(card)) keywords.push("lifelink");
  if (hasWither(card)) keywords.push("wither");
  if (hasInfect(card)) keywords.push("infect");
  if (hasHexproof(card)) keywords.push("hexproof");
  if (hasShroud(card)) keywords.push("shroud");
  const ward = cardWardAmount(card.oracleText);
  if (ward !== undefined) keywords.push(`ward {${ward}}`);
  else if (hasWard(card)) keywords.push("ward");
  const protection = allProtectionColors(card);
  if (protection.length > 0) keywords.push(`protection from ${protection.join(" and ")}`);
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

type AuraAttachResult =
  | { kind: "attach"; seatId: string; cardId: string }
  | { kind: "attach_player"; seatId: string }
  | { kind: "no_target" }
  | { kind: "unsupported" };

// No interactive targeting exists for Auras, so this picks a legal target deterministically:
// "Enchant creature you control" (or a positive/buff aura with an unrestricted "Enchant
// creature") targets the caster's own best creature; a removal-style aura (Pacifism, "can't
// attack or block") targets the best opposing creature instead.
function chooseAuraAttachTarget(session: GameSession, casterSeatId: string, oracleText: string): AuraAttachResult {
  const restriction = enchantRestriction(oracleText);
  if (restriction === "player") {
    // "Enchant player" (Overwhelming Splendor, the Curse cycle, ...) is overwhelmingly a hoser
    // aimed at an opponent rather than the caster's own player — no known printed example
    // benefits from being self-targeted — so pick the opponent who looks like the biggest threat
    // (highest life total), mirroring chooseRemovalTarget's "biggest threat" tie-break below.
    const opponents = session.seats.filter((seat) => seat.id !== casterSeatId && !seat.hasLost);
    if (opponents.length === 0) return { kind: "no_target" };
    const best = opponents.reduce((a, b) => (b.life > a.life ? b : a));
    return { kind: "attach_player", seatId: best.id };
  }
  if (restriction === undefined || restriction === "other" || restriction === "permanent") return { kind: "unsupported" };

  const targetOwn = restriction === "creature_you_control" || !isRemovalStyleAura(oracleText);
  const candidates: Array<{ seatId: string; card: VisibleCard }> = [];
  for (const seat of session.seats) {
    if (targetOwn ? seat.id !== casterSeatId : seat.id === casterSeatId) continue;
    for (const card of seat.board.battlefield) {
      if (card.typeLine.includes("Creature")) candidates.push({ seatId: seat.id, card });
    }
  }
  if (candidates.length === 0) return { kind: "no_target" };

  const best = candidates.reduce((a, b) =>
    effectivePower(b.card) + effectiveToughness(b.card) > effectivePower(a.card) + effectiveToughness(a.card) ? b : a
  );
  return { kind: "attach", seatId: best.seatId, cardId: best.card.id };
}

// Continuous effects (Aura attachments, Equip) are stamped with a monotonic counter, not
// wall-clock time, so layer 7b can deterministically pick "the newest one" when more than one
// "set base power/toughness" effect ends up on the same creature.
function nextTimestamp(session: GameSession): { timestamp: number; session: GameSession } {
  const timestamp = session.effectTimestampCounter ?? 0;
  return { timestamp, session: { ...session, effectTimestampCounter: timestamp + 1 } };
}

function applyAuraAttachment(session: GameSession, casterSeatId: string, auraCardId: string, targetSeatId: string, targetCardId: string): GameSession {
  const { timestamp, session: stampedSession } = nextTimestamp(session);
  return {
    ...stampedSession,
    seats: stampedSession.seats.map((seat) =>
      seat.id === casterSeatId
        ? {
            ...seat,
            board: {
              ...seat.board,
              battlefield: seat.board.battlefield.map((card) => (card.id === auraCardId ? { ...card, attachedToId: targetCardId, attachTimestamp: timestamp } : card))
            }
          }
        : seat
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: casterSeatId,
        message: `${session.seats.find((seat) => seat.id === casterSeatId)?.board.battlefield.find((card) => card.id === auraCardId)?.name ?? "Aura"} attaches to ${
          session.seats.find((seat) => seat.id === targetSeatId)?.board.battlefield.find((card) => card.id === targetCardId)?.name ?? "a creature"
        }.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

function applyAuraAttachToPlayer(session: GameSession, casterSeatId: string, auraCardId: string, targetSeatId: string): GameSession {
  const { timestamp, session: stampedSession } = nextTimestamp(session);
  return {
    ...stampedSession,
    seats: stampedSession.seats.map((seat) =>
      seat.id === casterSeatId
        ? {
            ...seat,
            board: {
              ...seat.board,
              battlefield: seat.board.battlefield.map((card) =>
                card.id === auraCardId ? { ...card, attachedToSeatId: targetSeatId, attachTimestamp: timestamp } : card
              )
            }
          }
        : seat
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: casterSeatId,
        message: `${session.seats.find((seat) => seat.id === casterSeatId)?.board.battlefield.find((card) => card.id === auraCardId)?.name ?? "Aura"} attaches to ${
          session.seats.find((seat) => seat.id === targetSeatId)?.name ?? "a player"
        }.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

function entersWithXCounters(oracleText: string): boolean {
  return /\benters?(?: the battlefield)? with x \+1\/\+1 counters? on (?:it|this (?:creature|artifact|permanent))\b/i.test(oracleText);
}

// "Multikicker {2} (You may pay an additional {2} any number of times as you cast this spell.)"
// (Everflowing Chalice, ...) — a separate additional-cost mechanic, not an {X} in the printed mana
// cost, but structurally identical once cast: "pay N more times, get N of something." Reusing the
// existing chosenX field/maxAffordableX/totalCastingCost machinery for it (see those functions) means
// this doesn't need its own parallel casting-cost pipeline — a card is never both an {X} spell and
// multikicker in this codebase's real-card sample, so treating "times kicked" as chosenX is safe.
function parseMultikickerCost(oracleText: string): number | undefined {
  const match = oracleText.match(/\bmultikicker\s+((?:\{[^}]+\})+)/i);
  return match ? manaValueFromManaCost(match[1]) : undefined;
}

// "This artifact enters with a charge counter on it for each time it was kicked." (Everflowing
// Chalice, and the rest of the multikicker-charge-counter cycle) — without this, a multikicker
// artifact that only ever tracks +1/+1 counters (entersWithXCounters, creature-only) never got its
// charge counters at all, so its own "add {C} for each charge counter" ability always produced
// nothing, kicked or not — the actual bug reported: an agent paid {0} (never kicked, since nothing
// ever offered a reason to) and the game never even understood a kicked cast would have done
// anything different.
function entersWithChargeCounterPerKick(oracleText: string): boolean {
  return /\benters? (?:the battlefield )?with a charge counter on it for each time it was kicked\b/i.test(oracleText);
}

function applyEntersWithCounterKind(session: GameSession, seatId: string, cardId: string, kind: string, count: number): GameSession {
  if (count <= 0) return session;
  return {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === seatId
        ? {
            ...seat,
            board: {
              ...seat.board,
              battlefield: seat.board.battlefield.map((card) =>
                card.id === cardId ? { ...card, counters: [...(card.counters ?? []).filter((counter) => counter.kind !== kind), { kind, count }] } : card
              )
            }
          }
        : seat
    )
  };
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

// The controller's full owned card pool for pickChosenCreatureType/pickChosenColor — prefers the
// deck list (so a tribal/mono-color-heavy deck picks its actual theme even before any copies have
// been drawn) and falls back to whatever visible zones exist when there's no deck record
// (synthetic/test sessions).
function controllerCardPool(seat: PlayerSeat): Array<{ typeLine: string; manaCost?: string }> {
  const deckCards = seat.deck?.cards.flatMap((entry) => (entry.card ? [entry.card] : [])) ?? [];
  if (deckCards.length > 0) return deckCards;
  return [...seat.board.hand, ...seat.board.battlefield, ...(seat.board.graveyard ?? []), ...(seat.library ?? [])];
}

function applyChosenCreatureType(session: GameSession, seatId: string, cardId: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const permanent = seat?.board.battlefield.find((card) => card.id === cardId);
  if (!seat || !permanent || permanent.chosenCreatureType) return session;
  const chosenType = pickChosenCreatureType(controllerCardPool(seat));
  if (!chosenType) return session;
  return {
    ...session,
    seats: session.seats.map((item) =>
      item.id === seatId
        ? { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === cardId ? { ...card, chosenCreatureType: chosenType } : card)) } }
        : item
    )
  };
}

function applyChosenColor(session: GameSession, seatId: string, cardId: string, excludedColor: ManaColorLetter | undefined): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const permanent = seat?.board.battlefield.find((card) => card.id === cardId);
  if (!seat || !permanent || permanent.chosenColor) return session;
  const chosenColor = pickChosenColor(controllerCardPool(seat), excludedColor);
  if (!chosenColor) return session;
  return {
    ...session,
    seats: session.seats.map((item) =>
      item.id === seatId
        ? { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === cardId ? { ...card, chosenColor } : card)) } }
        : item
    )
  };
}

// Only matches the self-referential "When this creature enters, it explores" phrasing (Jadelight
// Spelunker-style) — explore triggered by other conditions (combat, gaining life, ...) isn't
// covered, since this engine has no generic "whenever X, do Y" trigger-condition system yet.
function exploreCount(oracleText: string): number | undefined {
  const match = oracleText.toLowerCase().match(/when(?:ever)? this creature enters,?\s+(?:it\s+)?explores?(?:\s+(x|\d+|one|two|three)\s+times?)?/);
  if (!match) return undefined;
  return numberWordToInt(match[1]) ?? 1;
}

// "Reveal the top card of your library. Put that card into your hand if it's a land. Otherwise,
// put a +1/+1 counter on this creature, then put the card back or put it into your graveyard."
// With no choice UI, defaults to keeping a non-land card on top rather than milling it.
function resolveExplore(session: GameSession, seatId: string, cardId: string, times: number): GameSession {
  let next = session;
  for (let iteration = 0; iteration < times; iteration += 1) {
    const seat = next.seats.find((item) => item.id === seatId);
    const topCard = seat?.library?.[0];
    if (!seat || !topCard) break;
    const isLand = topCard.typeLine.includes("Land");
    next = {
      ...next,
      seats: next.seats.map((item) => {
        if (item.id !== seatId) return item;
        if (isLand) {
          return {
            ...item,
            library: (item.library ?? []).slice(1),
            board: { ...item.board, hand: [...item.board.hand, { ...topCard, zone: "hand" as const }] },
            zones: { ...item.zones, hand: item.zones.hand + 1, library: Math.max(0, item.zones.library - 1) }
          };
        }
        return {
          ...item,
          board: {
            ...item.board,
            battlefield: item.board.battlefield.map((card) => (card.id === cardId ? applyCounterDelta(card, "+1/+1", 1) : card))
          }
        };
      }),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: isLand
            ? `${seat.name} explores: reveals ${topCard.name}, a land, and puts it into hand.`
            : `${seat.name} explores: reveals ${topCard.name}, not a land, puts a +1/+1 counter on it, and keeps ${topCard.name} on top.`,
          detail: "Rules action"
        },
        ...next.events
      ]
    };
  }
  return next;
}

function isMainPhase(phase: string) {
  return phase === "precombat main phase" || phase === "postcombat main phase";
}

const DEFAULT_MAX_HAND_SIZE = 7;

// Rule 402.2: only the very common, consistently-worded "you have no maximum hand size" grant is
// recognized here (Spellbook, Thought Reflection, Reliquary Tower, ...) — matching this codebase's
// existing pattern of handling the standard real-card phrasing deterministically and declining
// rarer/looser shapes (a numeric override like "your maximum hand size is X" isn't modeled) rather
// than guessing at them.
function hasNoMaximumHandSize(seat: PlayerSeat): boolean {
  const permanents = [seat.board.commander, ...seat.board.battlefield].filter((card): card is VisibleCard => Boolean(card));
  return permanents.some((card) => /\bno maximum hand size\b/i.test(card.oracleText));
}

function effectiveMaxHandSize(seat: PlayerSeat): number {
  return hasNoMaximumHandSize(seat) ? Number.POSITIVE_INFINITY : DEFAULT_MAX_HAND_SIZE;
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

function legalMainPhaseActions(
  seat: PlayerSeat,
  hasPlayedLand: boolean,
  activeSeatId: string | undefined,
  turn: number,
  activatedLoyaltyKeys: Set<string>,
  session: GameSession
): LegalAgentAction[] {
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
      // hasResolvableTarget reads oracleText/typeLine off whatever card it's given — the top-level
      // VisibleCard fields describe the *primary* face, not necessarily this spell face (Malakir
      // Rebirth // Malakir Mire and the rest of the Zendikar Rising MDFC cycle put the spell face
      // first, so this happens to already line up for that cycle, but relying on that would silently
      // stop working for any MDFC printed the other way round). Building a shim from split.spellFace
      // keeps this correct regardless of face order, so a target-requiring spell face (e.g. "return
      // target creature card from your graveyard") with no legal target is never offered as castable.
      if (payment.ok && hasResolvableTarget(session, seat.id, { ...card, name: split.spellFace.name, typeLine: split.spellFace.typeLine, oracleText: split.spellFace.oracleText })) {
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
    const totalCost = totalCastingCost(seat, card, card.manaValue, chosenX);
    const payment = chooseManaSourcesForCost(seat, card, totalCost);
    if (!payment.ok) continue;
    if (!hasResolvableTarget(session, seat.id, card)) continue;
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
  // Cards exiled by an impulse-draw/steal-and-play effect (see zoneEffects.ts) that this seat is
  // currently permitted to cast — land-plays from exile aren't offered (a deliberate scope limit,
  // see playCard's playingAsLand branch, which only ever removes from hand).
  for (const card of seat.board.exile ?? []) {
    if (card.exiledPlayableBySeatId !== seat.id || isLandCard(card)) continue;
    if (card.exiledPlayableUntilTurn !== undefined && turn > card.exiledPlayableUntilTurn) continue;
    const fixedCost = adjustedCastingCost(seat, card, card.manaValue, "exile", activeSeatId);
    const chosenX = maxAffordableX(seat, card, fixedCost);
    const totalCost = totalCastingCost(seat, card, card.manaValue, chosenX);
    const payment = chooseManaSourcesForCost(seat, card, totalCost);
    if (!payment.ok) continue;
    if (!hasResolvableTarget(session, seat.id, card)) continue;
    actions.push({
      id: `cast-exile:${card.id}`,
      actionType: "cast_spell",
      cardId: card.id,
      sourceZone: "exile",
      targetIds: [],
      label: `cast ${card.name} from exile`,
      detail: `${card.manaCost ?? ""} ${card.typeLine}. ${card.oracleText} Payable with ${formatManaPoolPayment(payment.spent)}.`.trim(),
      role: card.role
    });
  }
  actions.push(...legalRoomUnlockActions(seat));
  const commander = seat.board.commander;
  if (commander) {
    const totalCost = adjustedCastingCost(seat, commander, commander.manaValue, "command", activeSeatId) + (commander.commanderTax ?? 0);
    const payment = chooseManaSourcesForCost(seat, commander, totalCost);
    if (payment.ok && hasResolvableTarget(session, seat.id, commander)) {
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
  actions.push(...legalActivatedAbilityActions(seat, true, turn, activatedLoyaltyKeys, session));
  actions.push({ id: "pass-phase", actionType: "pass_priority", targetIds: [], label: "pass this phase" });
  actions.push({ id: "end-turn", actionType: "end_turn", targetIds: [], label: "end turn and skip remaining phases" });
  return actions;
}

function hasAgentMainPhaseAction(seat: PlayerSeat, hasPlayedLand: boolean, activeSeatId: string | undefined, turn: number, activatedLoyaltyKeys: Set<string>, session: GameSession) {
  return legalMainPhaseActions(seat, hasPlayedLand, activeSeatId, turn, activatedLoyaltyKeys, session).some((action) =>
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

// "Choose any number of permanents and/or players that have a counter on them, then give each
// another counter of a kind already there." No choice UI exists for this yet, so it proliferates
// everything eligible (every permanent's existing counters, and poison, the only player-level
// counter this engine tracks).
function resolveProliferate(session: GameSession): GameSession {
  return {
    ...session,
    seats: session.seats.map((seat) => ({
      ...seat,
      poison: (seat.poison ?? 0) > 0 ? (seat.poison ?? 0) + 1 : seat.poison,
      board: {
        ...seat.board,
        battlefield: seat.board.battlefield.map((card) =>
          card.counters && card.counters.length > 0 ? { ...card, counters: card.counters.map((counter) => ({ ...counter, count: counter.count + 1 })) } : card
        )
      }
    })),
    events: [
      { id: crypto.randomUUID(), at: new Date().toISOString(), message: "Proliferate: every permanent and player with a counter gets one more of each kind already there.", detail: "Rules action" },
      ...session.events
    ]
  };
}

// "Until end of turn" effects (prowess, combat pumps, ...) expire when the turn ends.
function clearTemporaryBuffs(session: GameSession): GameSession {
  const withBuffsCleared: GameSession = {
    ...session,
    seats: session.seats.map((seat) => ({
      ...seat,
      // Safety net for "the next spell you cast this turn" if no spell was ever cast — the normal
      // consumption path is checkCastTriggeredKeywords, which only runs when a spell is cast.
      nextSpellHasArtifactAffinity: undefined,
      board: {
        ...seat.board,
        battlefield: seat.board.battlefield.map((card) =>
          card.temporaryPowerBonus || card.temporaryToughnessBonus ? { ...card, temporaryPowerBonus: undefined, temporaryToughnessBonus: undefined } : card
        )
      }
    }))
  };

  // Revert any "gain control...until end of turn" changes (Threaten-style) back to the true
  // owner's battlefield — same timing as the power/toughness buffs above.
  const reverting = withBuffsCleared.seats.flatMap((seat) =>
    seat.board.battlefield.filter((card) => card.temporaryControlChange).map((card) => ({ fromSeatId: seat.id, cardId: card.id, toSeatId: card.ownerSeatId ?? seat.id }))
  );
  const controlReverted = reverting.reduce(
    (next, entry) => (entry.fromSeatId === entry.toSeatId ? next : changeControlWithinBattlefield(next, entry.cardId, entry.fromSeatId, entry.toSeatId)),
    withBuffsCleared
  );

  // Time-limited exile-play permission (impulse draw's "until end of turn"/"until the end of your
  // next turn") that's expired — the card just stays exiled, it isn't destroyed or moved.
  // controlReverted.turn is already the NEW turn number by the time this runs (both call sites
  // update it before calling clearTemporaryBuffs).
  return {
    ...controlReverted,
    seats: controlReverted.seats.map((seat) => ({
      ...seat,
      board: {
        ...seat.board,
        exile: (seat.board.exile ?? []).map((card) =>
          card.exiledPlayableUntilTurn !== undefined && controlReverted.turn > card.exiledPlayableUntilTurn
            ? { ...card, exiledPlayableBySeatId: undefined, exiledPlayableUntilTurn: undefined }
            : card
        )
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

// "This spell can't be countered." (printed on the target itself) or "[Creature s]pells you
// [control/cast] can't be countered." (a static grant from a permanent the target's controller
// has) — checked wherever a counterspell's legality or resolution depends on being able to target
// the spell at all.
function spellIsImmuneToCounters(session: GameSession, targetCard: VisibleCard, targetControllerSeatId: string): boolean {
  if (hasCantBeCountered(targetCard.oracleText)) return true;
  const controller = session.seats.find((seat) => seat.id === targetControllerSeatId);
  if (!controller) return false;
  return controller.board.battlefield.some((source) => {
    const scope = parseCounterImmunityGrant(source.oracleText);
    return scope !== undefined && counterImmunityScopeMatches(scope, targetCard.typeLine);
  });
}

function legalPriorityActions(seat: PlayerSeat, pendingAction: PendingAction, activeSeatId: string | undefined, session: GameSession): LegalAgentAction[] {
  if (pendingAction.type === "trigger" && pendingAction.controllerSeatId === seat.id) {
    return [{ id: "resolve-trigger", actionType: "pass_priority", targetIds: [], label: `resolve ${pendingAction.sourceCardName} trigger` }];
  }
  const pendingSpellTarget = pendingAction.type === "spell" ? findSpellSourceCard(session, pendingAction) : undefined;
  // Instant-speed responses can come from hand OR from an exile pile the seat currently has play
  // permission for (impulse-draw/steal-and-play — see zoneEffects.ts) — gated by the exact same
  // canCastAtInstantSpeed check either way, so an exiled sorcery still isn't offered as a response,
  // only an exiled instant/flash card is.
  const respondableCards: Array<{ card: VisibleCard; sourceZone: "exile" | undefined }> = [
    ...seat.board.hand.map((card) => ({ card, sourceZone: undefined })),
    ...(seat.board.exile ?? [])
      .filter((card) => card.exiledPlayableBySeatId === seat.id && (card.exiledPlayableUntilTurn === undefined || session.turn <= card.exiledPlayableUntilTurn))
      .map((card) => ({ card, sourceZone: "exile" as const }))
  ];
  const actions: LegalAgentAction[] = respondableCards
    .filter(({ card }) => canCastAtInstantSpeed(card))
    .filter(({ card }) => {
      const counterAbility = parseCounterSpellAbility(card.oracleText);
      if (!counterAbility) return true;
      if (!pendingSpellTarget || pendingAction.type !== "spell") return false;
      if (spellIsImmuneToCounters(session, pendingSpellTarget, pendingAction.actorSeatId)) return false;
      return counterSpellCanTarget(counterAbility, pendingSpellTarget.typeLine, pendingAction.sourceZone === "command");
    })
    .filter(({ card }) => {
      const fixedCost = adjustedCastingCost(seat, card, card.manaValue, "hand", activeSeatId);
      const chosenX = maxAffordableX(seat, card, fixedCost);
      return chooseManaSourcesForCost(seat, card, totalCastingCost(seat, card, card.manaValue, chosenX)).ok;
    })
    .filter(({ card }) => hasResolvableTarget(session, seat.id, card))
    .map(({ card, sourceZone }) => ({
      id: sourceZone === "exile" ? `respond-exile:${card.id}` : `respond:${card.id}`,
      actionType: "cast_spell" as const,
      cardId: card.id,
      sourceZone,
      targetIds: [pendingAction.id],
      label: `respond with ${card.name}${sourceZone === "exile" ? " from exile" : ""}`,
      detail: `${card.manaCost ?? ""} ${card.typeLine}. ${card.oracleText}`.trim(),
      role: card.role
    }));
  // Loyalty/equip activation isn't legal at instant speed, so turn/activatedLoyaltyKeys are unused
  // here — sorcerySpeedAllowed=false skips that branch entirely.
  actions.push(...legalActivatedAbilityActions(seat, false, session.turn, EMPTY_LOYALTY_KEYS, session));
  actions.push({ id: "pass-priority", actionType: "pass_priority", targetIds: [pendingAction.id], label: "pass priority" });
  return actions;
}

const EMPTY_LOYALTY_KEYS = new Set<string>();

function legalActivatedAbilityActions(seat: PlayerSeat, sorcerySpeedAllowed: boolean, turn: number, activatedLoyaltyKeys: Set<string>, session: GameSession): LegalAgentAction[] {
  const actions: LegalAgentAction[] = seat.board.battlefield
    .filter((card) => {
      if (!isBasicLandFetchAbility(card)) return false;
      const requiresTap = basicLandFetchCostRequiresTap(card);
      // Rule 302.6: only applies when the cost actually includes {T} (Evolving Wilds) — Sakura-
      // Tribe Elder's plain sacrifice cost isn't restricted by being tapped or summoning sick.
      if (requiresTap && card.tapped) return false;
      if (requiresTap && card.typeLine.includes("Creature") && card.summoningSick && !hasHaste(card)) return false;
      return getBasicLandFetchOptions(seat.library ?? []).length > 0;
    })
    .map((card) => ({
      id: `activate-basic-fetch:${card.id}`,
      actionType: "activate_ability" as const,
      abilityKind: "basic_land_fetch" as const,
      cardId: card.id,
      targetIds: [],
      label: `activate ${card.name}`,
      detail: `Sacrifice ${card.name}: search your library for a basic land, put it onto the battlefield tapped, then shuffle.`
    }));

  for (const card of seat.board.battlefield) {
    parseGenericSacrificeAbilities(card.oracleText).forEach((ability, abilityIndex) => {
      if (!activateOnlyIfConditionMet(ability.clause, seat)) return;
      // Evolving Wilds/Terramorphic Expanse-style "search a basic land" abilities now also match
      // the general search_library shape below, but isBasicLandFetchAbility already owns them via
      // its own simpler auto-resolving system (basic_land_fetch) — without this, the same physical
      // ability would show up twice in the legal-actions list, once auto-picking a land and once
      // opening the interactive search UI for the exact same choice.
      if (ability.effect.kind === "search_library" && isBasicLandFetchAbility(card)) return;
      if (ability.costTap && card.tapped) return;
      // Rule 302.6: a creature with summoning sickness can't be tapped to pay an activated
      // ability's {T} cost (Viscera Seer, Carrion Feeder-style "{T}, Sacrifice a creature: ..."
      // are themselves creatures) unless it has haste. Non-creature permanents (Food/Clue tokens,
      // artifacts) have no such restriction.
      if (ability.costTap && card.typeLine.includes("Creature") && card.summoningSick && !hasHaste(card)) return;
      if (ability.costDiscard && seat.board.hand.length === 0) return;
      if (ability.sacrificeTarget === "creature" && !chooseSacrificeTargets(seat, ability.sacrificeTargetTypeFilter, ability.sacrificeCount)) return;
      if (ability.effect.kind === "search_library" && (seat.library?.length ?? 0) === 0) return;
      const affordable = ability.costMana === 0 || chooseManaSourcesForCost(seat, genericCostShim(ability.costMana), ability.costMana).ok;
      if (!affordable) return;
      const targetNames =
        ability.sacrificeTarget === "self"
          ? [card.name]
          : (chooseSacrificeTargets(seat, ability.sacrificeTargetTypeFilter, ability.sacrificeCount) ?? []).map((target) => target.name);
      actions.push({
        id: `activate-sacrifice:${card.id}:${abilityIndex}`,
        actionType: "activate_ability",
        abilityKind: "generic_sacrifice",
        abilityIndex,
        cardId: card.id,
        targetIds: [],
        label: `activate ${card.name} (sacrifice ${targetNames.join(", ") || "a creature"})`,
        detail: ability.clause
      });
    });
  }

  for (const card of seat.board.battlefield) {
    parseGenericTapAbilities(card.oracleText).forEach((ability, abilityIndex) => {
      if (!activateOnlyIfConditionMet(ability.clause, seat)) return;
      if (card.tapped) return;
      // Rule 302.6: same summoning-sickness gate as the sacrifice-ability loop above — a creature
      // can't be tapped to pay a {T} cost the turn it entered without haste.
      if (card.typeLine.includes("Creature") && card.summoningSick && !hasHaste(card)) return;
      if (ability.costDiscard && seat.board.hand.length === 0) return;
      const affordable = ability.costMana === 0 || chooseManaSourcesForCost(seat, genericCostShim(ability.costMana), ability.costMana).ok;
      if (!affordable) return;
      if (
        (ability.effect.kind === "counter_and_transform" || ability.effect.kind === "bounce_own") &&
        !chooseGenericTapTarget(seat, ability.effect.targetTypeFilter)
      ) {
        return;
      }
      if (ability.effect.kind === "search_library" && (seat.library?.length ?? 0) === 0) return;
      actions.push({
        id: `activate-generic-tap:${card.id}:${abilityIndex}`,
        actionType: "activate_ability",
        abilityKind: "generic_tap",
        abilityIndex,
        cardId: card.id,
        targetIds: [],
        label: `activate ${card.name}`,
        detail: ability.clause
      });
    });
  }

  // "{cost}: Untap ~." (Retrofitter Foundry's "{3}: Untap this artifact.") only ever does anything
  // useful while the permanent is actually tapped — no {T} in its own cost, so summoning sickness
  // (rule 302.6) doesn't apply here regardless of whether the source is a creature.
  for (const card of seat.board.battlefield.filter((item) => item.tapped)) {
    parseSelfUntapAbilities(card.oracleText).forEach((ability, abilityIndex) => {
      if (!activateOnlyIfConditionMet(ability.clause, seat)) return;
      const affordable = ability.costMana === 0 || chooseManaSourcesForCost(seat, genericCostShim(ability.costMana), ability.costMana).ok;
      if (!affordable) return;
      actions.push({
        id: `activate-self-untap:${card.id}:${abilityIndex}`,
        actionType: "activate_ability",
        abilityKind: "self_untap",
        abilityIndex,
        cardId: card.id,
        targetIds: [],
        label: `activate ${card.name} (untap)`,
        detail: ability.clause
      });
    });
  }

  for (const card of seat.board.battlefield) {
    parseGenericManaAbilities(card.oracleText).forEach((ability, abilityIndex) => {
      if (!activateOnlyIfConditionMet(ability.clause, seat)) return;
      if (ability.costDiscard && seat.board.hand.length === 0) return;
      if (hasOnceEachTurnLimiter(ability.clause) && session.onceEachTurnEffectsUsed?.includes(`${session.turn}:${card.id}:generic_mana:${abilityIndex}`)) return;
      const affordable = ability.costMana === 0 || chooseManaSourcesForCost(seat, genericCostShim(ability.costMana), ability.costMana).ok;
      if (!affordable) return;
      const effect = parseGenericAbilityEffect(ability.effectText);
      if (!effect) return;
      if (!genericAbilityEffectHasLegalTarget(session, seat.id, card, effect)) return;
      actions.push({
        id: `activate-generic-mana:${card.id}:${abilityIndex}`,
        actionType: "activate_ability",
        abilityKind: "generic_mana",
        abilityIndex,
        cardId: card.id,
        targetIds: [],
        label: `activate ${card.name}`,
        detail: ability.clause
      });
    });
  }

  for (const card of seat.board.battlefield.filter((item) => item.name === "Myriad Landscape" && !item.tapped)) {
    if (!chooseManaSourcesForCost(seat, genericCostShim(2), 2).ok) continue;
    if (chooseBestBasicLandPairForMyriad(seat).length !== 2) continue;
    actions.push({
      id: `activate-myriad:${card.id}`,
      actionType: "activate_ability",
      abilityKind: "myriad_landscape",
      cardId: card.id,
      targetIds: [],
      label: `activate ${card.name}`,
      detail: `{2}, {T}, Sacrifice ${card.name}: search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.`
    });
  }

  // Equip and loyalty abilities are both sorcery-speed only (rules 702.6e, 606.3): not offered
  // while responding during a priority window, only from the controller's own main phase.
  if (sorcerySpeedAllowed) {
    for (const card of seat.board.battlefield.filter((item) => isEquipment(item))) {
      const cost = equipCost(card.oracleText);
      if (cost === undefined) continue;
      if (cost > 0 && !chooseManaSourcesForCost(seat, genericCostShim(cost), cost).ok) continue;
      const target = chooseEquipTarget(seat, card);
      if (!target) continue;
      actions.push({
        id: `activate-equip:${card.id}`,
        actionType: "activate_ability",
        abilityKind: "equip",
        cardId: card.id,
        targetIds: [],
        label: `activate ${card.name} (equip ${target.name})`,
        detail: `Equip {${cost}}: Attach ${card.name} to ${target.name}. ${card.oracleText}`.trim()
      });
    }

    for (const card of seat.board.battlefield.filter((item) => isPlaneswalkerCard(item))) {
      if (activatedLoyaltyKeys.has(loyaltyTurnKey(seat.id, card.id, turn))) continue;
      parseLoyaltyAbilities(card.oracleText).forEach((ability, abilityIndex) => {
        if (ability.cost < 0 && loyaltyCounterCount(card) < Math.abs(ability.cost)) return;
        actions.push({
          id: `activate-loyalty:${card.id}:${abilityIndex}`,
          actionType: "activate_ability",
          abilityKind: "loyalty_ability",
          cardId: card.id,
          loyaltyCost: ability.cost,
          targetIds: [],
          label: `activate ${card.name} ${formatLoyaltyCost(ability.cost)}`,
          detail: ability.text
        });
      });
    }
  }

  return actions;
}

function parseLoyaltyAbilities(oracleText: string): Array<{ cost: number; text: string }> {
  return oracleText
    .split("\n")
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^([+−-]?\d+):\s*(.+)$/);
      if (!match) return undefined;
      return { cost: Number.parseInt(match[1].replace("−", "-"), 10), text: match[2] };
    })
    .filter((ability): ability is { cost: number; text: string } => Boolean(ability && Number.isFinite(ability.cost) && ability.text));
}

// No interactive targeting for equip either; prefers the creature the equipment would most
// improve (highest resulting combined power+toughness), excluding whatever it's already on.
function chooseEquipTarget(seat: PlayerSeat, equipment: VisibleCard): VisibleCard | undefined {
  const creatures = seat.board.battlefield.filter((card) => card.typeLine.includes("Creature") && card.id !== equipment.attachedToId);
  if (creatures.length === 0) return undefined;
  return creatures.reduce((best, card) =>
    effectivePower(card) + effectiveToughness(card) > effectivePower(best) + effectiveToughness(best) ? card : best
  );
}

function resolveEquip(session: GameSession, seatId: string, cardId: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const card = seat?.board.battlefield.find((item) => item.id === cardId);
  if (!seat || !card) return session;
  const cost = equipCost(card.oracleText);
  if (cost === undefined) return session;
  const target = chooseEquipTarget(seat, card);
  if (!target) return session;
  const payment = cost > 0 ? chooseManaSourcesForCost(seat, genericCostShim(cost), cost) : undefined;
  if (cost > 0 && !payment?.ok) return session;

  let next = session;
  if (payment?.ok) {
    next = { ...next, seats: next.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item)) };
  }
  const { timestamp, session: stampedNext } = nextTimestamp(next);
  next = stampedNext;

  return {
    ...next,
    seats: next.seats.map((item) =>
      item.id === seatId
        ? {
            ...item,
            board: {
              ...item.board,
              battlefield: item.board.battlefield.map((permanent) => (permanent.id === cardId ? { ...permanent, attachedToId: target.id, attachTimestamp: timestamp } : permanent))
            }
          }
        : item
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${seat.name} equips ${card.name} to ${target.name}.`,
        detail: "Rules action"
      },
      ...next.events
    ]
  };
}

// No dedicated "choose a permanent" UI exists yet (matching how Myriad Landscape/basic-land-fetch
// already auto-resolve their choices), so this deterministically picks the least costly creature
// to lose: prefer a token over a real card, then the lowest combined power+toughness.
function chooseSacrificeTarget(seat: PlayerSeat, typeFilter?: string): VisibleCard | undefined {
  const creatures = seat.board.battlefield.filter(
    (card) => card.typeLine.includes("Creature") && (!typeFilter || card.typeLine.toLowerCase().includes(typeFilter.toLowerCase()))
  );
  if (creatures.length === 0) return undefined;
  const tokens = creatures.filter((card) => card.token);
  const pool = tokens.length > 0 ? tokens : creatures;
  return pool.reduce((worst, card) =>
    effectivePower(card) + effectiveToughness(card) < effectivePower(worst) + effectiveToughness(worst) ? card : worst
  );
}

// Same deterministic "spend what you'd miss least" pattern as chooseSacrificeTarget, extended to a
// fixed-count sacrifice (Westvale Abbey's "Sacrifice five creatures") — spends tokens before real
// cards, lowest combined power+toughness first within each group, and returns undefined (not a
// legal activation) if there aren't enough creatures to pay the full count.
function chooseSacrificeTargets(seat: PlayerSeat, typeFilter: string | undefined, count: number): VisibleCard[] | undefined {
  const creatures = seat.board.battlefield.filter(
    (card) => card.typeLine.includes("Creature") && (!typeFilter || card.typeLine.toLowerCase().includes(typeFilter.toLowerCase()))
  );
  if (creatures.length < count) return undefined;
  const byValue = (card: VisibleCard) => effectivePower(card) + effectiveToughness(card);
  const tokens = [...creatures.filter((card) => card.token)].sort((a, b) => byValue(a) - byValue(b));
  const nonTokens = [...creatures.filter((card) => !card.token)].sort((a, b) => byValue(a) - byValue(b));
  return [...tokens, ...nonTokens].slice(0, count);
}

// Same "no choice UI, pick deterministically" pattern as chooseSacrificeTarget, for a generic tap
// ability's "target X you control" (a counter/upgrade or a bounce-to-hand) — every such target this
// engine's generic tap parser recognizes is always "you control", so this only ever searches the
// activating seat's own battlefield. Prefers the lowest combined power+toughness match, same
// reasoning as chooseSacrificeTarget: spend the least valuable eligible permanent when there's a
// choice, rather than guessing at which one the controller would actually want.
function chooseGenericTapTarget(seat: PlayerSeat, typeFilter: string | undefined): VisibleCard | undefined {
  const candidates = seat.board.battlefield.filter(
    (card) => card.typeLine.includes("Creature") && (!typeFilter || card.typeLine.toLowerCase().includes(typeFilter.toLowerCase()))
  );
  if (candidates.length === 0) return undefined;
  return candidates.reduce((worst, card) =>
    effectivePower(card) + effectiveToughness(card) < effectivePower(worst) + effectiveToughness(worst) ? card : worst
  );
}

// Annihilator lets the defending player choose which permanents to sacrifice; with no choice UI
// for this yet, deterministically picks the least costly ones to lose (tokens first, then lowest
// mana value), avoiding the commander unless nothing else is left.
function chooseAnnihilatorSacrifices(seat: PlayerSeat, count: number): VisibleCard[] {
  const nonCommanders = seat.board.battlefield.filter((card) => !card.commander);
  const pool = nonCommanders.length > 0 ? nonCommanders : seat.board.battlefield;
  const sorted = [...pool].sort((a, b) => {
    if (Boolean(a.token) !== Boolean(b.token)) return a.token ? -1 : 1;
    return a.manaValue - b.manaValue;
  });
  return sorted.slice(0, count);
}

function chooseWorstHandCardToDiscard(seat: PlayerSeat): VisibleCard | undefined {
  if (seat.board.hand.length === 0) return undefined;
  return seat.board.hand.reduce((worst, card) => (card.manaValue > worst.manaValue ? card : worst));
}

// Pays a generic sacrifice ability's cost (mana + discard + sacrifice) without resolving its
// effect — split out of resolveGenericSacrificeAbility so activateGenericSacrificeAbility's
// search_library branch can pay the cost via setSession and then open the interactive
// library-search choice itself (component state applySacrificeEffect, a pure module-level
// function, has no access to).
function payGenericSacrificeCost(
  session: GameSession,
  seatId: string,
  cardId: string,
  abilityIndex: number
): { session: GameSession; ability: SacrificeAbility; card: VisibleCard } | undefined {
  const seat = session.seats.find((item) => item.id === seatId);
  const card = seat?.board.battlefield.find((item) => item.id === cardId);
  if (!seat || !card) return undefined;
  const ability = parseGenericSacrificeAbilities(card.oracleText)[abilityIndex];
  if (!ability || (ability.costTap && card.tapped)) return undefined;
  if (ability.costTap && card.typeLine.includes("Creature") && card.summoningSick && !hasHaste(card)) return undefined;
  if (!activateOnlyIfConditionMet(ability.clause, seat)) return undefined;

  const discardCard = ability.costDiscard ? chooseWorstHandCardToDiscard(seat) : undefined;
  if (ability.costDiscard && !discardCard) return undefined;

  const payment = ability.costMana > 0 ? chooseManaSourcesForCost(seat, genericCostShim(ability.costMana), ability.costMana) : undefined;
  if (ability.costMana > 0 && !payment?.ok) return undefined;

  const sacrificeTargets =
    ability.sacrificeTarget === "self" ? [card] : chooseSacrificeTargets(seat, ability.sacrificeTargetTypeFilter, ability.sacrificeCount);
  if (!sacrificeTargets || sacrificeTargets.length === 0) return undefined;

  let next = session;
  if (payment?.ok) {
    next = {
      ...next,
      seats: next.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item))
    };
  }

  if (discardCard) {
    next = {
      ...next,
      seats: next.seats.map((item) =>
        item.id === seatId
          ? {
              ...item,
              board: {
                ...item.board,
                hand: item.board.hand.filter((handCard) => handCard.id !== discardCard.id),
                graveyard: [...(item.board.graveyard ?? []), { ...discardCard, zone: "graveyard" as const, counters: undefined, interpretedEffects: undefined }]
              }
            }
          : item
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} discards ${discardCard.name} to activate ${card.name}.`,
          detail: "Rules action"
        },
        ...next.events
      ]
    };
  }

  next = destroyCreatures(
    next,
    sacrificeTargets.map((target) => ({
      seatId,
      cardId: target.id,
      message:
        sacrificeTargets.length === 1
          ? `${seat.name} sacrifices ${target.name} to activate ${card.name}.`
          : `${seat.name} sacrifices ${target.name} (part of ${sacrificeTargets.length} creatures) to activate ${card.name}.`
    })),
    "Rules action"
  );

  return { session: next, ability, card };
}

function resolveGenericSacrificeAbility(session: GameSession, seatId: string, cardId: string, abilityIndex: number): GameSession {
  const paid = payGenericSacrificeCost(session, seatId, cardId, abilityIndex);
  if (!paid) return session;
  return applySacrificeEffect(paid.session, seatId, paid.card.id, paid.card.name, paid.ability.effect, paid.ability.clause);
}

function applySacrificeEffect(
  session: GameSession,
  seatId: string,
  sourceCardId: string,
  sourceCardName: string,
  effect: SacrificeAbility["effect"],
  clause: string
): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;

  // search_library never actually reaches this function: activateGenericSacrificeAbility detects
  // it before ever calling resolveGenericSacrificeAbility and opens the interactive library-search
  // choice instead (pendingRuleChoice is component state applySacrificeEffect can't reach). This
  // branch only exists to keep the switch exhaustive for the type checker.
  if (effect.kind === "search_library") return session;

  if (effect.kind === "create_tokens") {
    const specs = parseCreateTokenSpecs(clause);
    if (specs.length === 0) return session;
    const created = createTokensForSeat(session, seatId, sourceCardId, specs);
    const createdNames = created.createdTokens.map((token) => token.name);
    return {
      ...created.session,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} activates ${sourceCardName} and creates ${createdNames.join(", ")}.`,
          detail: "Rules action"
        },
        ...created.session.events
      ]
    };
  }

  if (effect.kind === "draw_cards") {
    return drawMultipleForSeat(session, seatId, effect.amount, `${seat.name} draws ${effect.amount} from ${sourceCardName}.`);
  }

  if (effect.kind === "gain_life" || effect.kind === "lose_life") {
    const delta = effect.kind === "gain_life" ? effect.amount : -effect.amount;
    return {
      ...session,
      seats: session.seats.map((item) => (item.id === seatId ? { ...item, life: Math.max(0, item.life + delta) } : item)),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} ${delta > 0 ? "gains" : "loses"} ${Math.abs(delta)} life from ${sourceCardName}.`
        },
        ...session.events
      ]
    };
  }

  if (effect.kind === "add_counter") {
    return {
      ...session,
      seats: session.seats.map((item) =>
        item.id === seatId
          ? {
              ...item,
              board: {
                ...item.board,
                battlefield: item.board.battlefield.map((card) => (card.id === sourceCardId ? applyCounterDelta(card, effect.counterKind, effect.amount) : card))
              }
            }
          : item
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} puts a ${effect.counterKind} counter on ${sourceCardName}.`
        },
        ...session.events
      ]
    };
  }

  if (effect.kind === "transform_self") {
    return transformPermanent(session, seatId, sourceCardId, sourceCardName, /\bthen untap it\b/i.test(clause));
  }

  // Scry/surveil auto-resolve deterministically for both agents and humans (no dedicated
  // interactive prompt wired up for this entry point yet, matching the auto-resolved mana/search
  // choices used elsewhere in this engine).
  return resolveAgentLibraryLookWorkflow(session, seatId, sourceCardName, effect.kind === "surveil" ? "surveil_cards" : "scry_cards", effect.amount);
}

// Flips a transform double-faced permanent to its other face (Westvale Abbey -> Ormendahl, Profane
// Prince). Rule 302.6/711.4c: transforming isn't leaving and re-entering the battlefield, so a
// permanent that's been under the same controller's control since the turn began is never
// summoning sick just because transforming made it a creature for the first time.
function transformPermanent(session: GameSession, seatId: string, cardId: string, sourceCardName: string, untapAfter: boolean): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const card = seat?.board.battlefield.find((item) => item.id === cardId);
  if (!seat || !card || !card.faces || card.faces.length !== 2) return session;
  const currentFaceIndex = card.unlockedFaceIndices?.[0] ?? 0;
  const nextFaceIndex = currentFaceIndex === 0 ? 1 : 0;
  const nextFace = card.faces[nextFaceIndex];
  const transformed: VisibleCard = {
    ...card,
    name: nextFace.name,
    typeLine: nextFace.typeLine,
    oracleText: nextFace.oracleText,
    manaCost: nextFace.manaCost,
    power: nextFace.power,
    toughness: nextFace.toughness,
    loyalty: nextFace.loyalty,
    imageUris: nextFace.imageUris ?? card.imageUris,
    unlockedFaceIndices: [nextFaceIndex],
    tapped: untapAfter ? false : card.tapped,
    summoningSick: false
  };
  return {
    ...session,
    seats: session.seats.map((item) =>
      item.id === seatId
        ? { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((c) => (c.id === cardId ? transformed : c)) } }
        : item
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${seat.name} transforms ${sourceCardName} into ${nextFace.name}.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

// Pays a generic tap ability's cost (mana + discard + tap) without resolving its effect — split
// out of resolveGenericTapAbility for the same reason payGenericSacrificeCost is split out of
// resolveGenericSacrificeAbility: activateGenericTapAbility's search_library branch needs to pay
// the cost via setSession and then open the interactive library-search choice itself.
function payGenericTapCost(
  session: GameSession,
  seatId: string,
  cardId: string,
  abilityIndex: number
): { session: GameSession; ability: GenericTapAbility; card: VisibleCard } | undefined {
  const seat = session.seats.find((item) => item.id === seatId);
  const card = seat?.board.battlefield.find((item) => item.id === cardId);
  if (!seat || !card || card.tapped) return undefined;
  if (card.typeLine.includes("Creature") && card.summoningSick && !hasHaste(card)) return undefined;
  const ability = parseGenericTapAbilities(card.oracleText)[abilityIndex];
  if (!ability) return undefined;
  if (!activateOnlyIfConditionMet(ability.clause, seat)) return undefined;

  const discardCard = ability.costDiscard ? chooseWorstHandCardToDiscard(seat) : undefined;
  if (ability.costDiscard && !discardCard) return undefined;

  const payment = ability.costMana > 0 ? chooseManaSourcesForCost(seat, genericCostShim(ability.costMana), ability.costMana) : undefined;
  if (ability.costMana > 0 && !payment?.ok) return undefined;

  let next = session;
  if (payment?.ok) {
    next = { ...next, seats: next.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item)) };
  }
  if (discardCard) {
    next = {
      ...next,
      seats: next.seats.map((item) =>
        item.id === seatId
          ? {
              ...item,
              board: {
                ...item.board,
                hand: item.board.hand.filter((handCard) => handCard.id !== discardCard.id),
                graveyard: [...(item.board.graveyard ?? []), { ...discardCard, zone: "graveyard" as const, counters: undefined, interpretedEffects: undefined }]
              }
            }
          : item
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} discards ${discardCard.name} to activate ${card.name}.`,
          detail: "Rules action"
        },
        ...next.events
      ]
    };
  }
  // Paying the {T} in the cost taps the source; an "Untap ~." effect (Retrofitter Foundry's 2nd/3rd
  // abilities) then immediately untaps it again as part of resolving — net result is it stays
  // untapped, and can be activated again the same turn if its cost can be paid again.
  next = {
    ...next,
    seats: next.seats.map((item) =>
      item.id === seatId
        ? { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((c) => (c.id === cardId ? { ...c, tapped: !ability.untapsSelf } : c)) } }
        : item
    )
  };

  return { session: next, ability, card };
}

function resolveGenericTapAbility(session: GameSession, seatId: string, cardId: string, abilityIndex: number): GameSession {
  const paid = payGenericTapCost(session, seatId, cardId, abilityIndex);
  if (!paid) return session;
  return applyGenericTapEffect(paid.session, seatId, cardId, paid.card.name, paid.ability.effect, paid.ability.clause);
}

// The effect half of a plain "{cost}: effect." activated ability (parseGenericManaAbilities'
// GenericManaAbility.effectText) — dispatched through the same removal/zone/common-trigger parsers
// already used for modal spells and recurring phase triggers, rather than re-narrowing the effect
// vocabulary a fourth time. Unlike parseGenericModalEffect's per-mode variant, this also tries
// removalEffect first: a single (non-modal) ability isn't already owned by removalSpells.ts's own
// modal system the way a modal bullet can be, so there's no overlap to guard against here.
type GenericAbilityEffect =
  | { kind: "removal"; effect: RemovalEffect }
  | { kind: "zone"; effect: ZoneEffect }
  | { kind: "pump"; effect: PumpEffect }
  | { kind: "search_library"; effect: SearchLibraryEffect }
  | { kind: "trigger"; effect: TriggerEffect };

// No chosenX exists for an activated ability (parseGenericManaAbilities already declines {X}-cost
// abilities outright), so unlike the modal/spell path this never substitutes X — a "target creature
// gets -X/-X" activated ability is simply declined, the same "no guessing" behavior it always had.
function parseGenericAbilityEffect(effectText: string): GenericAbilityEffect | undefined {
  const removal = parseRemovalEffect(effectText);
  if (removal) return { kind: "removal", effect: removal };
  const pump = parseTargetedPump(effectText);
  if (pump) return { kind: "pump", effect: pump };
  const searchLibrary = parseSearchLibraryEffectText(effectText);
  if (searchLibrary) return { kind: "search_library", effect: searchLibrary };
  const zone = parseZoneEffect(effectText);
  if (zone) return { kind: "zone", effect: zone };
  const trigger = commonTriggerEffect(effectText, "clause");
  if (trigger) return { kind: "trigger", effect: trigger };
  return undefined;
}

function genericAbilityEffectHasLegalTarget(session: GameSession, casterSeatId: string, sourceCard: VisibleCard, effect: GenericAbilityEffect): boolean {
  if (effect.kind === "removal") return removalEffectHasLegalTarget(session, casterSeatId, sourceCard, effect.effect);
  if (effect.kind === "zone") return zoneEffectHasLegalTarget(session, casterSeatId, effect.effect);
  if (effect.kind === "pump") return choosePumpTarget(session, casterSeatId, effect.effect) !== undefined;
  if (effect.kind === "search_library") {
    const seat = session.seats.find((item) => item.id === casterSeatId);
    return (seat?.library?.length ?? 0) > 0;
  }
  if (effect.effect.kind === "add_counter" && effect.effect.scope !== "self" && effect.effect.scope !== "context") {
    return chooseCounterTarget(session, casterSeatId, effect.effect.counterKind, effect.effect.scope === "target_creature_you_control") !== undefined;
  }
  return true;
}

function applyGenericAbilityEffect(session: GameSession, casterSeatId: string, sourceCard: VisibleCard, effect: GenericAbilityEffect): GameSession {
  if (effect.kind === "removal") return applyRemovalEffect(session, casterSeatId, sourceCard.name, sourceCard, effect.effect);
  if (effect.kind === "zone") return applyZoneEffect(session, casterSeatId, sourceCard.name, effect.effect);
  if (effect.kind === "pump") return applyTargetedPumpEffect(session, casterSeatId, sourceCard, effect.effect);
  // search_library never actually reaches this function: activateGenericManaAbility detects it
  // before ever calling resolveGenericManaAbility and opens the interactive library-search choice
  // instead (pendingRuleChoice is component state this pure function can't reach).
  if (effect.kind === "search_library") return session;
  const syntheticTrigger: Extract<PendingAction, { type: "trigger" }> = {
    id: crypto.randomUUID(),
    type: "trigger",
    actorSeatId: casterSeatId,
    controllerSeatId: casterSeatId,
    sourceCardId: sourceCard.id,
    sourceCardName: sourceCard.name,
    triggerKind: "common",
    effect: effect.effect,
    message: ""
  };
  return resolveTriggerEffect(session, syntheticTrigger);
}

// Pays a generic mana-cost ability's cost (mana + discard + once-each-turn marking) without
// resolving its effect — split out of resolveGenericManaAbility for the same reason
// payGenericSacrificeCost/payGenericTapCost are split out of their resolvers: a search_library
// effect needs to open the interactive library-search choice, which this pure function can't do.
function payGenericManaCost(
  session: GameSession,
  seatId: string,
  cardId: string,
  abilityIndex: number
): { session: GameSession; ability: GenericManaAbility; card: VisibleCard; effect: GenericAbilityEffect } | undefined {
  const seat = session.seats.find((item) => item.id === seatId);
  const card = seat?.board.battlefield.find((item) => item.id === cardId);
  if (!seat || !card) return undefined;
  const ability = parseGenericManaAbilities(card.oracleText)[abilityIndex];
  if (!ability) return undefined;
  if (!activateOnlyIfConditionMet(ability.clause, seat)) return undefined;

  const onceKey = `${session.turn}:${cardId}:generic_mana:${abilityIndex}`;
  const limitedOnceEachTurn = hasOnceEachTurnLimiter(ability.clause);
  if (limitedOnceEachTurn && session.onceEachTurnEffectsUsed?.includes(onceKey)) return undefined;

  const effect = parseGenericAbilityEffect(ability.effectText);
  if (!effect) return undefined;

  const discardCard = ability.costDiscard ? chooseWorstHandCardToDiscard(seat) : undefined;
  if (ability.costDiscard && !discardCard) return undefined;

  const payment = ability.costMana > 0 ? chooseManaSourcesForCost(seat, genericCostShim(ability.costMana), ability.costMana) : undefined;
  if (ability.costMana > 0 && !payment?.ok) return undefined;

  let next = session;
  if (limitedOnceEachTurn) {
    next = { ...next, onceEachTurnEffectsUsed: [...(next.onceEachTurnEffectsUsed ?? []), onceKey] };
  }
  if (payment?.ok) {
    next = { ...next, seats: next.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item)) };
  }
  if (discardCard) {
    next = {
      ...next,
      seats: next.seats.map((item) =>
        item.id === seatId
          ? {
              ...item,
              board: {
                ...item.board,
                hand: item.board.hand.filter((handCard) => handCard.id !== discardCard.id),
                graveyard: [...(item.board.graveyard ?? []), { ...discardCard, zone: "graveyard" as const, counters: undefined, interpretedEffects: undefined }]
              }
            }
          : item
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} discards ${discardCard.name} to activate ${card.name}.`,
          detail: "Rules action"
        },
        ...next.events
      ]
    };
  }

  return { session: next, ability, card, effect };
}

function resolveGenericManaAbility(session: GameSession, seatId: string, cardId: string, abilityIndex: number): GameSession {
  const paid = payGenericManaCost(session, seatId, cardId, abilityIndex);
  if (!paid) return session;
  return applyGenericAbilityEffect(paid.session, seatId, paid.card, paid.effect);
}

function resolveSelfUntapAbility(session: GameSession, seatId: string, cardId: string, abilityIndex: number): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const card = seat?.board.battlefield.find((item) => item.id === cardId);
  if (!seat || !card || !card.tapped) return session;
  const ability = parseSelfUntapAbilities(card.oracleText)[abilityIndex];
  if (!ability) return session;
  if (!activateOnlyIfConditionMet(ability.clause, seat)) return session;

  const payment = ability.costMana > 0 ? chooseManaSourcesForCost(seat, genericCostShim(ability.costMana), ability.costMana) : undefined;
  if (ability.costMana > 0 && !payment?.ok) return session;

  let next = session;
  if (payment?.ok) {
    next = { ...next, seats: next.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item)) };
  }
  return {
    ...next,
    seats: next.seats.map((item) =>
      item.id === seatId
        ? { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((c) => (c.id === cardId ? { ...c, tapped: false } : c)) } }
        : item
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${seat.name} activates ${card.name}: untaps it.`,
        detail: "Rules action"
      },
      ...next.events
    ]
  };
}

// Inserts a creature type into the subtype section (after the em dash) rather than just
// appending it to the end of the type line, so a "becomes a 4/4 Construct ... in addition to its
// other types" upgrade reads as "Artifact Creature — Construct Servo", not "Artifact Creature —
// Servo Construct" tacked on after the whole line.
function addCreatureTypeToTypeLine(typeLine: string, newType: string): string {
  if (typeLine.toLowerCase().includes(newType.toLowerCase())) return typeLine;
  const dashIndex = typeLine.indexOf("—");
  if (dashIndex === -1) return `${typeLine} — ${newType}`;
  const before = typeLine.slice(0, dashIndex).trim();
  const after = typeLine.slice(dashIndex + 1).trim();
  return `${before} — ${newType}${after ? ` ${after}` : ""}`;
}

function applyGenericTapEffect(
  session: GameSession,
  seatId: string,
  sourceCardId: string,
  sourceCardName: string,
  effect: GenericTapEffect,
  clause: string
): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;

  // search_library never actually reaches this function: activateGenericTapAbility detects it
  // before ever calling resolveGenericTapAbility and opens the interactive library-search choice
  // instead (pendingRuleChoice is component state applyGenericTapEffect can't reach). This branch
  // only exists to keep the switch exhaustive for the type checker.
  if (effect.kind === "search_library") return session;

  if (effect.kind === "create_tokens") {
    const specs = parseCreateTokenSpecs(clause);
    if (specs.length === 0) return session;
    const created = createTokensForSeat(session, seatId, sourceCardId, specs);
    const createdNames = created.createdTokens.map((token) => token.name);
    return {
      ...created.session,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} activates ${sourceCardName} and creates ${createdNames.join(", ")}.`,
          detail: "Rules action"
        },
        ...created.session.events
      ]
    };
  }

  if (effect.kind === "counter_and_transform") {
    const target = chooseGenericTapTarget(seat, effect.targetTypeFilter);
    if (!target) return session;
    const transforms = effect.power !== undefined && effect.toughness !== undefined;
    return {
      ...session,
      seats: session.seats.map((item) =>
        item.id === seatId
          ? {
              ...item,
              board: {
                ...item.board,
                battlefield: item.board.battlefield.map((permanent) => {
                  if (permanent.id !== target.id) return permanent;
                  const withCounter = applyCounterDelta(permanent, "+1/+1", 1);
                  if (!transforms) return withCounter;
                  return {
                    ...withCounter,
                    power: String(effect.power),
                    toughness: String(effect.toughness),
                    typeLine: effect.addedType ? addCreatureTypeToTypeLine(withCounter.typeLine, effect.addedType) : withCounter.typeLine
                  };
                })
              }
            }
          : item
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: transforms
            ? `${seat.name} activates ${sourceCardName}: ${target.name} gets a +1/+1 counter and becomes a ${effect.power}/${effect.toughness}${effect.addedType ? ` ${effect.addedType}` : ""}.`
            : `${seat.name} activates ${sourceCardName}: ${target.name} gets a +1/+1 counter.`,
          detail: "Rules action"
        },
        ...session.events
      ]
    };
  }

  // bounce_own
  const target = chooseGenericTapTarget(seat, effect.targetTypeFilter);
  if (!target) return session;
  const bounced = moveCardBetweenVisibleZones(session, seatId, target.id, "hand");
  return {
    ...bounced,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${seat.name} activates ${sourceCardName}: returns ${target.name} to hand.`,
        detail: "Rules action"
      },
      ...bounced.events
    ]
  };
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

function findPermanentById(session: GameSession, cardId: string): VisibleCard | undefined {
  for (const seat of session.seats) {
    const card = seat.board.battlefield.find((item) => item.id === cardId);
    if (card) return card;
  }
  return undefined;
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
      if (isAura(card)) {
        const attachedSeat = card.attachedToSeatId ? next.seats.find((item) => item.id === card.attachedToSeatId) : undefined;
        const legallyAttached = card.attachedToSeatId
          ? attachedSeat !== undefined && !attachedSeat.hasLost
          : card.attachedToId !== undefined && findPermanentById(next, card.attachedToId) !== undefined;
        if (!legallyAttached) {
          destructions.push({ seatId: seat.id, cardId: card.id, message: `${card.name} is put into ${seat.name}'s graveyard for not being attached to anything.` });
        }
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
    next = destroyCreatures(next, destructions, "State-based action");
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

  // Equipment attached to something that no longer exists (or isn't a creature anymore) becomes
  // unattached rather than destroyed (rule 704.5q); Auras in the same situation were already
  // destroyed above. Every creature's attachmentPowerBonus/attachmentToughnessBonus is then kept
  // in sync with whatever's currently legally attached to it, from any seat's battlefield (an
  // opponent's removal Aura lives in its controller's list, not the enchanted creature's).
  next = {
    ...next,
    seats: next.seats.map((seat) => ({
      ...seat,
      board: {
        ...seat.board,
        battlefield: seat.board.battlefield.map((card) => {
          if (!isEquipment(card) || !card.attachedToId) return card;
          const target = findPermanentById(next, card.attachedToId);
          if (target && target.typeLine.includes("Creature")) return card;
          changed = true;
          return { ...card, attachedToId: undefined };
        })
      }
    }))
  };

  const allAttachments = next.seats.flatMap((seat) =>
    seat.board.battlefield
      .filter((card) => (isAura(card) || isEquipment(card)) && card.attachedToId)
      .map((card) => ({ ...card, controllerSeatId: seat.id }))
  );
  const sameList = (a: string[] | undefined, b: string[] | undefined) => (a?.join(",") ?? "") === (b?.join(",") ?? "");
  next = {
    ...next,
    seats: next.seats.map((seat) => ({
      ...seat,
      board: {
        ...seat.board,
        battlefield: seat.board.battlefield.map((card) => {
          if (!card.typeLine.includes("Creature")) return card;

          // Layer 7a: characteristic-defining abilities establish this creature's own base P/T
          // from the current board (e.g. "power and toughness equal to the number of lands you
          // control"), evaluated against its own controller's battlefield.
          const cda = parseCharacteristicDefiningAbility(card.oracleText);
          let cdaPower: number | undefined;
          let cdaToughness: number | undefined;
          if (cda) {
            const count = countMatchingPermanents(seat.board.battlefield, cda.matcher);
            if (cda.stat === "both" || cda.stat === "power") cdaPower = count;
            if (cda.stat === "both" || cda.stat === "toughness") cdaToughness = count;
          }

          // Layer 7a, devotion variant: "~'s power is equal to your devotion to blue" (Callaphe,
          // the God cycle) — counts colored mana symbols across the battlefield instead of matching
          // permanents, so it's a separate CDA parser/count from the one just above.
          const devotionCda = parseDevotionCda(card.oracleText);
          if (devotionCda) {
            const devotion = computeDevotion(seat.board.battlefield, devotionCda.color);
            if (devotionCda.stat === "both" || devotionCda.stat === "power") cdaPower = devotion;
            if (devotionCda.stat === "both" || devotionCda.stat === "toughness") cdaToughness = devotion;
          }

          let power = 0;
          let toughness = 0;
          const keywordSet = new Set<string>();
          const protectionSet = new Set<string>();
          const setEffectCandidates: Array<{ timestamp: number; power: number; toughness: number }> = [];
          for (const attachment of allAttachments) {
            if (attachment.attachedToId !== card.id) continue;
            const bonus = attachedPowerToughnessBonus(attachment.oracleText);
            if (bonus) {
              power += bonus.power;
              toughness += bonus.toughness;
            }
            for (const keyword of attachmentGrantedKeywords(attachment.oracleText)) keywordSet.add(keyword);
            for (const color of attachmentGrantedProtectionColors(attachment.oracleText)) protectionSet.add(color);

            const override = attachedBasePowerToughness(attachment.oracleText);
            if (override) {
              const attachmentController = next.seats.find((item) => item.id === attachment.controllerSeatId);
              const resolved =
                override === "life_total"
                  ? { power: attachmentController?.life ?? 0, toughness: attachmentController?.life ?? 0 }
                  : override;
              setEffectCandidates.push({ timestamp: attachment.attachTimestamp ?? 0, ...resolved });
            }
          }

          // Layer 7d: a self-anthem ("~ gets +1/+1 for each creature card in your graveyard," Jarad,
          // Golgari Lich Lord-style) adds on top of whatever base layers 7a/7b left behind, evaluated
          // live off the controller's current battlefield/graveyard so it tracks board state instead
          // of being cached from whenever the creature entered. Reuses attachmentPowerBonus/
          // attachmentToughnessBonus (already a generic "additive P/T bonus from any source" field,
          // not literally attachment-only) rather than adding a parallel field for the same layer.
          const selfAnthem = parseSelfAnthemBoost(card.oracleText);
          if (selfAnthem) {
            const source = selfAnthem.zone === "graveyard" ? (seat.board.graveyard ?? []) : seat.board.battlefield;
            const count = countMatchingPermanents(source, selfAnthem.matcher);
            power += selfAnthem.power * count;
            toughness += selfAnthem.toughness * count;
          }

          // Layer 6: "[Other] [Qualifier] you control have Keyword[, ...]." (Soaring Lightbringer,
          // "Dragons you control have indestructible," "Enchantment creatures you control have
          // deathtouch, lifelink, and hexproof," ...) — scans every permanent this creature's
          // controller has (not just attachments) for a static keyword grant whose qualifier this
          // creature matches, distinct from parseSelfAnthemBoost (self-only P/T) and Aura/Equipment
          // grants (attached-target-only).
          for (const grantSource of seat.board.battlefield) {
            for (const grant of parseGroupKeywordGrant(grantSource.oracleText)) {
              if (grant.excludeSelf && grantSource.id === card.id) continue;
              if (!permanentMatchesQualifier(card, grant.matcher)) continue;
              for (const keyword of grant.keywords) keywordSet.add(keyword);
            }
          }

          // Layer 7d (group anthem): "[Other] [Qualifier] you control get +N/+N[ for each ...]."
          // (Boon of the Spirit Realm's blessing-counter anthem, plain flat group pumps, ...) — the
          // group counterpart to parseSelfAnthemBoost above, evaluated the same live-off-board way.
          for (const anthemSource of seat.board.battlefield) {
            for (const anthem of parseGroupAnthemBoost(anthemSource.oracleText)) {
              if (anthem.excludeSelf && anthemSource.id === card.id) continue;
              if (!permanentMatchesQualifier(card, anthem.matcher)) continue;
              if (anthem.requiresChosenType && (!anthemSource.chosenCreatureType || !card.typeLine.includes(anthemSource.chosenCreatureType))) continue;
              const multiplier = anthem.multiplier
                ? anthem.multiplier.kind === "counter"
                  ? counterCount(anthemSource, anthem.multiplier.counterKind)
                  : countMatchingPermanents(seat.board.battlefield, anthem.multiplier.countMatcher)
                : 1;
              power += anthem.power * multiplier;
              toughness += anthem.toughness * multiplier;
            }
          }

          // Layer 7b: "set base power/toughness" effects override the 7a/printed base outright —
          // when more than one applies (rare), the most recently attached one wins.
          const winningSetEffect = setEffectCandidates.sort((a, b) => b.timestamp - a.timestamp)[0];

          const nextPowerBonus = power || undefined;
          const nextToughnessBonus = toughness || undefined;
          const nextKeywords = keywordSet.size > 0 ? Array.from(keywordSet).sort() : undefined;
          const nextProtection = protectionSet.size > 0 ? Array.from(protectionSet).sort() : undefined;
          if (
            nextPowerBonus === card.attachmentPowerBonus &&
            nextToughnessBonus === card.attachmentToughnessBonus &&
            sameList(nextKeywords, card.grantedKeywords) &&
            sameList(nextProtection, card.grantedProtectionColors) &&
            cdaPower === card.cdaPower &&
            cdaToughness === card.cdaToughness &&
            winningSetEffect?.power === card.setPowerOverride &&
            winningSetEffect?.toughness === card.setToughnessOverride
          ) {
            return card;
          }
          changed = true;
          return {
            ...card,
            attachmentPowerBonus: nextPowerBonus,
            attachmentToughnessBonus: nextToughnessBonus,
            grantedKeywords: nextKeywords,
            grantedProtectionColors: nextProtection,
            cdaPower,
            cdaToughness,
            setPowerOverride: winningSetEffect?.power,
            setToughnessOverride: winningSetEffect?.toughness
          };
        })
      }
    }))
  };

  // Static "X you control are Y in addition to their other types" effects (Secret Arcade,
  // Biotransference, ...) — recomputed every SBA pass from current board state, same
  // recompute-fresh-every-pass pattern as the attachment/CDA block above, but scoped to ALL
  // permanent types (not creature-only), since a grant can make a non-creature permanent relevant
  // to creature-only downstream checks (e.g. a granted Enchantment type mattering to an "an
  // enchantment enters" trigger elsewhere).
  next = {
    ...next,
    seats: next.seats.map((seat) => {
      const grantSources = seat.board.battlefield.flatMap((card) => parseTypeGrantEffects(card.oracleText));
      return {
        ...seat,
        board: {
          ...seat.board,
          battlefield: seat.board.battlefield.map((card) => {
            const grantedSet = new Set<string>();
            for (const grant of grantSources) {
              if (typeGrantAppliesTo(grant.granteeFilter, card)) grantedSet.add(grant.grantedType);
            }
            const nextGrantedTypes = grantedSet.size > 0 ? Array.from(grantedSet).sort() : undefined;
            if (sameList(nextGrantedTypes, card.grantedTypes)) return card;
            changed = true;
            return { ...card, grantedTypes: nextGrantedTypes };
          })
        }
      };
    })
  };

  // Life <= 0 and 21+ combat damage from a single commander are both game losses.
  const previousLossState = new Map(next.seats.map((seat) => [seat.id, Boolean(seat.hasLost)]));
  const seatsAfterLossChecks = next.seats.map((seat) => {
    if (seat.hasLost) return seat;
    if (seat.life <= 0) return { ...seat, hasLost: true, lossReason: "life total reached 0" };
    if (Object.values(seat.commanderDamage).some((amount) => amount >= 21)) {
      return { ...seat, hasLost: true, lossReason: "took 21 or more combat damage from a single commander" };
    }
    if ((seat.poison ?? 0) >= 10) return { ...seat, hasLost: true, lossReason: "has 10 or more poison counters" };
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

// A "new object" once it leaves the battlefield (rule 400.7) — counters, cached interpreted
// effects, and attachment/typing state from its time on the battlefield don't carry over. Shared
// between destroyCreatures and moveCardAcrossSeats.
function resetForZoneChange<T extends VisibleCard>(card: T, zone: VisibleCard["zone"]): T {
  return {
    ...card,
    zone,
    tapped: false,
    attacking: false,
    attackTargetId: undefined,
    blockDecided: false,
    blocking: false,
    blockingTargetId: undefined,
    battlefieldPosition: undefined,
    counters: undefined,
    interpretedEffects: undefined,
    attachedToId: undefined,
    attachmentPowerBonus: undefined,
    attachmentToughnessBonus: undefined,
    grantedKeywords: undefined,
    grantedProtectionColors: undefined,
    grantedTypes: undefined,
    attachTimestamp: undefined,
    cdaPower: undefined,
    cdaToughness: undefined,
    setPowerOverride: undefined,
    setToughnessOverride: undefined,
    exiledPlayableBySeatId: undefined,
    exiledPlayableUntilTurn: undefined
  };
}

function destroyCreatures(
  session: GameSession,
  destructions: Array<{ seatId: string; cardId: string; message: string }>,
  detail: string = "Combat damage"
): GameSession {
  if (destructions.length === 0) return session;
  const events: GameEvent[] = [];
  const newDeaths: Array<{ seatId: string; card: VisibleCard; attachedSourceIds?: string[] }> = [];
  // Equipment/Aura attachedToId snapshot, taken from the pre-destruction battlefield before this
  // same state-based-action pass clears it once the creature it points at is actually gone — see
  // types.ts's pendingDeaths comment.
  const allBattlefieldCards = session.seats.flatMap((item) => item.board.battlefield);
  // Keyed by TRUE owner (card.ownerSeatId, falling back to whoever currently controls it if it
  // never changed hands) rather than by the controlling seat being processed — a reanimated or
  // stolen permanent must go to its owner's graveyard, not its controller's (rule 404.4), and
  // those can be different seats now that control-changing effects exist.
  const toGraveyardByOwnerSeatId = new Map<string, VisibleCard[]>();

  const seatsAfterRemoval = session.seats.map((seat) => {
    const toDestroy = destructions.filter((entry) => entry.seatId === seat.id);
    if (toDestroy.length === 0) return seat;
    const destroyIds = new Set(toDestroy.map((entry) => entry.cardId));
    const destroyedCards = seat.board.battlefield.filter((card) => destroyIds.has(card.id));
    for (const card of destroyedCards) {
      const attachedSourceIds = allBattlefieldCards.filter((permanent) => permanent.attachedToId === card.id).map((permanent) => permanent.id);
      newDeaths.push({ seatId: seat.id, card, attachedSourceIds: attachedSourceIds.length > 0 ? attachedSourceIds : undefined });
    }
    for (const entry of toDestroy) {
      events.push({ id: crypto.randomUUID(), at: new Date().toISOString(), seatId: seat.id, message: entry.message, detail });
    }

    // Tokens cease to exist rather than sitting in the graveyard (rule 704.5d); a destroyed
    // commander is redirected to its owner's command zone instead (the owner-choice replacement
    // effect is simplified to "always redirect").
    const toGraveyard = destroyedCards.filter((card) => !card.token && !card.commander);
    const dyingCommander = destroyedCards.find((card) => card.commander);
    let commanderReturn: VisibleCard | undefined;
    if (dyingCommander) {
      const commanderTax = (dyingCommander.commanderTax ?? 0) + 2;
      commanderReturn = { ...resetForZoneChange(dyingCommander, "command"), commanderTax };
      events.push({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: seat.id,
        message: `${dyingCommander.name} returns to the command zone. Commander tax is now +${commanderTax}.`,
        detail: "Rules action"
      });
    }

    for (const card of toGraveyard) {
      const ownerSeatId = card.ownerSeatId ?? seat.id;
      const bucket = toGraveyardByOwnerSeatId.get(ownerSeatId) ?? [];
      bucket.push(resetForZoneChange(card, "graveyard"));
      toGraveyardByOwnerSeatId.set(ownerSeatId, bucket);
    }

    return {
      ...seat,
      board: {
        ...seat.board,
        commander: commanderReturn ?? seat.board.commander,
        battlefield: seat.board.battlefield.filter((card) => !destroyIds.has(card.id))
      },
      zones: {
        ...seat.zones,
        battlefield: Math.max(0, seat.zones.battlefield - destroyedCards.length),
        command: seat.zones.command + (dyingCommander ? 1 : 0)
      }
    };
  });

  const seats = seatsAfterRemoval.map((seat) => {
    const additions = toGraveyardByOwnerSeatId.get(seat.id);
    if (!additions || additions.length === 0) return seat;
    return {
      ...seat,
      board: { ...seat.board, graveyard: [...(seat.board.graveyard ?? []), ...additions] },
      zones: { ...seat.zones, graveyard: seat.zones.graveyard + additions.length }
    };
  });

  return { ...session, seats, events: [...events, ...session.events], pendingDeaths: [...(session.pendingDeaths ?? []), ...newDeaths] };
}

type CrossSeatZone = "hand" | "battlefield" | "graveyard" | "exile" | "library";

// The generic zone-mover moveCardBetweenVisibleZones (further below) is hard-locked to a single
// seat — it can only shuffle a card between that SAME seat's own zones. Reanimation, mill,
// graveyard recursion, and steal-a-card-from-a-library effects all need to move a card from one
// player's zone into a DIFFERENT player's zone (or the same player's, which this also handles).
// Always a full "new object" reset (rule 400.7), since this is always an actual zone change —
// contrast with changeControlWithinBattlefield below, which is NOT a zone change and must NOT
// reset the object.
function moveCardAcrossSeats(
  session: GameSession,
  sourceSeatId: string,
  cardId: string,
  destinationSeatId: string,
  destinationZone: CrossSeatZone,
  options: { tapped?: boolean; libraryPosition?: "top" | "bottom" } = {}
): { session: GameSession; movedCard?: VisibleCard } {
  const sourceSeat = session.seats.find((seat) => seat.id === sourceSeatId);
  if (!sourceSeat) return { session };
  const handCard = sourceSeat.board.hand.find((card) => card.id === cardId);
  const battlefieldCard = sourceSeat.board.battlefield.find((card) => card.id === cardId);
  const graveyardCard = (sourceSeat.board.graveyard ?? []).find((card) => card.id === cardId);
  const exileCard = (sourceSeat.board.exile ?? []).find((card) => card.id === cardId);
  const libraryCard = (sourceSeat.library ?? []).find((card) => card.id === cardId);
  const card = handCard ?? battlefieldCard ?? graveyardCard ?? exileCard ?? libraryCard;
  if (!card) return { session };
  const sourceZone: CrossSeatZone = handCard ? "hand" : battlefieldCard ? "battlefield" : graveyardCard ? "graveyard" : exileCard ? "exile" : "library";

  // The card's true owner never changes just because it changes zones or controllers — preserve
  // whatever it already was (falling back to the seat it's currently leaving, for a card that's
  // never changed hands before).
  const ownerSeatId = card.ownerSeatId ?? sourceSeatId;
  const movedCard: VisibleCard = {
    ...resetForZoneChange(card, destinationZone),
    ownerSeatId,
    tapped: destinationZone === "battlefield" ? Boolean(options.tapped) : false,
    summoningSick: destinationZone === "battlefield" ? card.typeLine.includes("Creature") : undefined,
    counters: destinationZone === "battlefield" && isPlaneswalkerCard(card) ? withInitialLoyaltyCounters(card) : undefined
  };

  const seatsAfterRemoval = session.seats.map((seat) => {
    if (seat.id !== sourceSeatId) return seat;
    return {
      ...seat,
      board: {
        ...seat.board,
        hand: sourceZone === "hand" ? seat.board.hand.filter((c) => c.id !== cardId) : seat.board.hand,
        battlefield: sourceZone === "battlefield" ? seat.board.battlefield.filter((c) => c.id !== cardId) : seat.board.battlefield,
        graveyard: sourceZone === "graveyard" ? (seat.board.graveyard ?? []).filter((c) => c.id !== cardId) : seat.board.graveyard,
        exile: sourceZone === "exile" ? (seat.board.exile ?? []).filter((c) => c.id !== cardId) : seat.board.exile
      },
      library: sourceZone === "library" ? (seat.library ?? []).filter((c) => c.id !== cardId) : seat.library,
      zones: {
        ...seat.zones,
        hand: seat.zones.hand - (sourceZone === "hand" ? 1 : 0),
        battlefield: seat.zones.battlefield - (sourceZone === "battlefield" ? 1 : 0),
        graveyard: seat.zones.graveyard - (sourceZone === "graveyard" ? 1 : 0),
        exile: seat.zones.exile - (sourceZone === "exile" ? 1 : 0),
        library: seat.zones.library - (sourceZone === "library" ? 1 : 0)
      }
    };
  });

  const seats = seatsAfterRemoval.map((seat) => {
    if (seat.id !== destinationSeatId) return seat;
    return {
      ...seat,
      board: {
        ...seat.board,
        hand: destinationZone === "hand" ? [...seat.board.hand, movedCard] : seat.board.hand,
        battlefield: destinationZone === "battlefield" ? [...seat.board.battlefield, movedCard] : seat.board.battlefield,
        graveyard: destinationZone === "graveyard" ? [...(seat.board.graveyard ?? []), movedCard] : seat.board.graveyard,
        exile: destinationZone === "exile" ? [...(seat.board.exile ?? []), movedCard] : seat.board.exile
      },
      library:
        destinationZone === "library"
          ? options.libraryPosition === "bottom"
            ? [...(seat.library ?? []), movedCard]
            : [movedCard, ...(seat.library ?? [])]
          : seat.library,
      zones: {
        ...seat.zones,
        hand: seat.zones.hand + (destinationZone === "hand" ? 1 : 0),
        battlefield: seat.zones.battlefield + (destinationZone === "battlefield" ? 1 : 0),
        graveyard: seat.zones.graveyard + (destinationZone === "graveyard" ? 1 : 0),
        exile: seat.zones.exile + (destinationZone === "exile" ? 1 : 0),
        library: seat.zones.library + (destinationZone === "library" ? 1 : 0)
      }
    };
  });

  return { session: { ...session, seats }, movedCard };
}

// A control change (Threaten/Mind Control-style) is NOT a zone change (rule 400.7 only triggers on
// actually leaving/entering a zone) — the permanent stays the SAME object. Counters, attachments,
// and tapped status all carry over; only summoning sickness resets for the new controller (rule
// 302.6) and the true owner is preserved so it still dies into the right graveyard later.
function changeControlWithinBattlefield(session: GameSession, cardId: string, fromSeatId: string, toSeatId: string, temporary: boolean = false): GameSession {
  if (fromSeatId === toSeatId) return session;
  const fromSeat = session.seats.find((seat) => seat.id === fromSeatId);
  const card = fromSeat?.board.battlefield.find((item) => item.id === cardId);
  if (!card) return session;
  const ownerSeatId = card.ownerSeatId ?? fromSeatId;
  const movedCard: VisibleCard = {
    ...card,
    ownerSeatId,
    summoningSick: card.typeLine.includes("Creature") ? true : card.summoningSick,
    temporaryControlChange: temporary || undefined
  };

  return {
    ...session,
    seats: session.seats.map((seat) => {
      if (seat.id === fromSeatId) return { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.filter((item) => item.id !== cardId) }, zones: { ...seat.zones, battlefield: Math.max(0, seat.zones.battlefield - 1) } };
      if (seat.id === toSeatId) return { ...seat, board: { ...seat.board, battlefield: [...seat.board.battlefield, movedCard] }, zones: { ...seat.zones, battlefield: seat.zones.battlefield + 1 } };
      return seat;
    })
  };
}

function applyCombatDamageToTarget(
  session: GameSession,
  sourceName: string,
  target: { seat: PlayerSeat; planeswalker?: VisibleCard },
  amount: number,
  source?: VisibleCard,
  sourceControllerSeatId?: string,
  damageKind: "combat" | "noncombat" = "combat"
): GameSession {
  if (amount <= 0) return session;

  const base: GameSession =
    source && hasLifelink(source) && sourceControllerSeatId
      ? {
          ...session,
          seats: session.seats.map((seat) => (seat.id === sourceControllerSeatId ? { ...seat, life: seat.life + amount } : seat))
        }
      : session;

  if (target.planeswalker) {
    const planeswalkerId = target.planeswalker.id;
    return {
      ...base,
      seats: base.seats.map((seat) =>
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
          message: `${sourceName} deals ${amount} ${damageKind === "combat" ? "combat " : ""}damage to ${target.planeswalker.name}.`,
          detail: damageKind === "combat" ? "Combat damage" : "Rules action"
        },
        ...base.events
      ]
    };
  }

  const isInfect = Boolean(source && hasInfect(source));
  return {
    ...base,
    seats: base.seats.map((seat) =>
      seat.id === target.seat.id
        ? {
            ...seat,
            life: isInfect ? seat.life : Math.max(0, seat.life - amount),
            poison: isInfect ? (seat.poison ?? 0) + amount : seat.poison,
            commanderDamage:
              // Commander damage (the 21-damage loss condition) only tracks combat damage —
              // a spell/ability the commander happens to be the source of doesn't count.
              source?.commander && damageKind === "combat"
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
        message: `${sourceName} deals ${amount} ${isInfect ? "infect " : ""}${damageKind === "combat" ? "combat " : ""}damage to ${target.seat.name}${isInfect ? ` (${amount} poison)` : ""}.`,
        detail: damageKind === "combat" ? "Combat damage" : "Rules action"
      },
      ...base.events
    ]
  };
}

// Non-combat direct damage to a creature (e.g. Lightning Bolt, Bedevil) — reuses the same
// lifelink/wither/infect handling as combat damage, but resolves lethality against the current
// battlefield state directly rather than through simulateBlockedCombat. Like combat damage
// elsewhere in this engine, damage isn't tracked as a persistent marked-damage counter — a
// non-lethal hit simply doesn't destroy the creature, so it "heals" at end of turn implicitly.
function dealDamageToCreature(
  session: GameSession,
  sourceName: string,
  targetSeatId: string,
  targetCardId: string,
  amount: number,
  source?: VisibleCard,
  sourceControllerSeatId?: string
): GameSession {
  if (amount <= 0) return session;
  const targetSeat = session.seats.find((seat) => seat.id === targetSeatId);
  const target = targetSeat?.board.battlefield.find((card) => card.id === targetCardId);
  if (!targetSeat || !target) return session;

  const base: GameSession =
    source && hasLifelink(source) && sourceControllerSeatId
      ? {
          ...session,
          seats: session.seats.map((seat) => (seat.id === sourceControllerSeatId ? { ...seat, life: seat.life + amount } : seat))
        }
      : session;

  // Wither/infect sources mark the damage as -1/-1 counters instead of normal damage (rule 702.90/120.3c).
  if (source && (hasWither(source) || hasInfect(source))) {
    return {
      ...base,
      seats: base.seats.map((seat) =>
        seat.id === targetSeatId
          ? {
              ...seat,
              board: {
                ...seat.board,
                battlefield: seat.board.battlefield.map((card) => (card.id === targetCardId ? applyCounterDelta(card, "-1/-1", amount) : card))
              }
            }
          : seat
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: targetSeatId,
          message: `${sourceName} deals ${amount} damage to ${target.name} (-${amount}/-${amount} in -1/-1 counters).`,
          detail: "Rules action"
        },
        ...base.events
      ]
    };
  }

  const isLethal = !hasIndestructible(target) && (amount >= effectiveToughness(target) || Boolean(source && hasDeathtouch(source)));
  const withEvent: GameSession = {
    ...base,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: targetSeatId,
        message: `${sourceName} deals ${amount} damage to ${target.name}.`,
        detail: "Rules action"
      },
      ...base.events
    ]
  };

  if (!isLethal) return withEvent;

  return destroyCreatures(
    withEvent,
    [{ seatId: targetSeatId, cardId: targetCardId, message: `${target.name} is destroyed by ${amount} damage from ${sourceName}.` }],
    "Rules action"
  );
}

// This engine has no generic multi-target selection UI, so targeting for destroy/exile spells is
// resolved deterministically for both agents and humans — prefer an opponent's permanent over the
// caster's own, then the biggest threat by combined effective power+toughness (mirrors
// chooseAuraAttachTarget's heuristic).
function chooseRemovalTarget(
  session: GameSession,
  casterSeatId: string,
  targetType: RemovalTargetType,
  sourceCard: VisibleCard,
  excludedColors: string[] = [],
  artifactsExcluded: boolean = false
): { seatId: string; card: VisibleCard } | undefined {
  const excludedColorCodes = excludedColors.map((color) => PROTECTION_COLOR_CODE[color]).filter(Boolean);
  const candidates: Array<{ seatId: string; card: VisibleCard }> = [];
  for (const seat of session.seats) {
    for (const card of seat.board.battlefield) {
      if (!matchesTargetType(card, targetType)) continue;
      if (artifactsExcluded && card.typeLine.includes("Artifact")) continue;
      if (excludedColorCodes.length > 0 && card.colors.some((color) => excludedColorCodes.includes(color))) continue;
      // Rule 601.2c/702.11c/702.12b: hexproof/shroud/protection all make a permanent an illegal
      // target, not just a bad one — hexproof only blocks opponents, shroud and protection block
      // everyone (including the caster targeting their own thing, though that's rare in practice).
      if (hasShroud(card)) continue;
      if (hasHexproof(card) && seat.id !== casterSeatId) continue;
      if (isProtectedFrom(card, sourceCard)) continue;
      candidates.push({ seatId: seat.id, card });
    }
  }
  if (candidates.length === 0) return undefined;

  const opponentCandidates = candidates.filter((entry) => entry.seatId !== casterSeatId);
  const pool = opponentCandidates.length > 0 ? opponentCandidates : candidates;
  // Ward doesn't make a target illegal, just costly (see payWardIfNeeded) — prefer a ward-free
  // target when one is equally available, so the caster isn't paying a tax for no reason.
  const unwardedPool = pool.filter((entry) => cardWardAmount(entry.card.oracleText) === undefined);
  const finalPool = unwardedPool.length > 0 ? unwardedPool : pool;
  return finalPool.reduce((a, b) => (effectivePower(b.card) + effectiveToughness(b.card) > effectivePower(a.card) + effectiveToughness(a.card) ? b : a));
}

// Same deterministic-heuristic targeting as chooseRemovalTarget, applied to a triggered ability's
// "put a counter on target creature": +1/+1 counters reinforce a threat, so prefer the trigger
// controller's own biggest creature; -1/-1 counters are removal-adjacent, so prefer an opponent's
// biggest creature. Falls back to the full candidate pool if the preferred side has no creatures.
function chooseCounterTarget(
  session: GameSession,
  controllerSeatId: string,
  counterKind: "+1/+1" | "-1/-1",
  restrictToOwnCreatures: boolean
): { seatId: string; card: VisibleCard } | undefined {
  const candidates: Array<{ seatId: string; card: VisibleCard }> = [];
  for (const seat of session.seats) {
    if (restrictToOwnCreatures && seat.id !== controllerSeatId) continue;
    for (const card of seat.board.battlefield) {
      if (card.typeLine.includes("Creature")) candidates.push({ seatId: seat.id, card });
    }
  }
  if (candidates.length === 0) return undefined;

  const preferOwn = counterKind === "+1/+1";
  const preferredPool = restrictToOwnCreatures
    ? candidates
    : candidates.filter((entry) => (preferOwn ? entry.seatId === controllerSeatId : entry.seatId !== controllerSeatId));
  const pool = preferredPool.length > 0 ? preferredPool : candidates;
  return pool.reduce((a, b) => (effectivePower(b.card) + effectiveToughness(b.card) > effectivePower(a.card) + effectiveToughness(a.card) ? b : a));
}

type DamageTarget = { kind: "player"; seat: PlayerSeat } | { kind: "creature"; seatId: string; card: VisibleCard };

// Same "no target-selection UI" deterministic heuristic as chooseRemovalTarget: take a lethal kill
// on an opponent's creature when one's available, otherwise send "any target" damage to the
// lowest-life opponent, otherwise chip the biggest opposing creature (for creature-only damage),
// otherwise there's no legal target.
function chooseDamageTarget(session: GameSession, casterSeatId: string, amount: number, targetType: "any" | "creature" | "player", sourceCard: VisibleCard): DamageTarget | undefined {
  const opponents = session.seats.filter((seat) => seat.id !== casterSeatId && !seat.hasLost);

  // "target player or planeswalker" can never legally resolve against a creature — checked before
  // any of the creature-candidate logic below, unlike "any target" which prefers a lethal creature
  // kill when one's available.
  if (targetType === "player") {
    if (opponents.length === 0) return undefined;
    const lowestLife = opponents.reduce((a, b) => (b.life < a.life ? b : a));
    return { kind: "player", seat: lowestLife };
  }

  const creatureCandidates: Array<{ seatId: string; card: VisibleCard }> = [];
  for (const seat of opponents) {
    for (const card of seat.board.battlefield) {
      if (card.typeLine.includes("Creature") && !hasShroud(card) && !hasHexproof(card) && !isProtectedFrom(card, sourceCard)) {
        creatureCandidates.push({ seatId: seat.id, card });
      }
    }
  }

  const lethalCandidates = creatureCandidates.filter((entry) => !hasIndestructible(entry.card) && effectiveToughness(entry.card) <= amount);
  if (lethalCandidates.length > 0) {
    const best = lethalCandidates.reduce((a, b) =>
      effectivePower(b.card) + effectiveToughness(b.card) > effectivePower(a.card) + effectiveToughness(a.card) ? b : a
    );
    return { kind: "creature", seatId: best.seatId, card: best.card };
  }

  if (targetType === "any" && opponents.length > 0) {
    const lowestLife = opponents.reduce((a, b) => (b.life < a.life ? b : a));
    return { kind: "player", seat: lowestLife };
  }

  if (creatureCandidates.length > 0) {
    const biggest = creatureCandidates.reduce((a, b) =>
      effectivePower(b.card) + effectiveToughness(b.card) > effectivePower(a.card) + effectiveToughness(a.card) ? b : a
    );
    return { kind: "creature", seatId: biggest.seatId, card: biggest.card };
  }

  return undefined;
}

function noLegalTargetEvent(session: GameSession, seatId: string, sourceName: string): GameSession {
  return {
    ...session,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${sourceName} finds no legal target and has no effect.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

// Rule 117.6/702.13c: a spell whose only legal target(s) would be countered by ward, the caster
// can't pay for, or that's otherwise hexproof/protected/shrouded, effectively targets nothing —
// mirrors the same "no legal target = illegal to cast" check as hasResolvableRemovalTarget, one
// level deeper (per-mode, so a modal spell's still-viable modes are checked individually).
function removalEffectHasLegalTarget(session: GameSession, casterSeatId: string, sourceCard: VisibleCard, effect: RemovalEffect): boolean {
  switch (effect.kind) {
    case "destroy_all":
    case "destroy_all_conditional":
      return true;
    case "destroy":
      return chooseRemovalTarget(session, casterSeatId, effect.targetType, sourceCard, effect.excludedColors, effect.artifactsExcluded) !== undefined;
    case "exile":
    case "bounce":
      return chooseRemovalTarget(session, casterSeatId, effect.targetType, sourceCard) !== undefined;
    case "damage":
      return chooseDamageTarget(session, casterSeatId, effect.amount === "X" ? 0 : effect.amount, effect.targetType, sourceCard) !== undefined;
    case "modal":
      return effect.modes.some((mode) => removalEffectHasLegalTarget(session, casterSeatId, sourceCard, mode));
  }
}

// Top-level dispatcher for the generic destroy/exile/damage primitives parsed by
// src/lib/removalSpells.ts. Deliberately narrow, matching that module's scope: multi-target-divided
// damage and non-destroy/exile/damage follow-up effects (Chaos Warp's shuffle-and-reveal, Swords to
// Plowshares' life gain, Beast Within's token) aren't modeled here — parseRemovalEffect already
// declines to match those shapes, so this only ever runs for the plain "destroy/exile/damage a
// target" pattern (or a "choose N" spell built from those patterns) it recognizes.
// Rule 601.2c: a spell that requires a target can't legally be cast at all if no legal target
// exists for it. Without this, legalMainPhaseActions/legalPriorityActions would offer "cast" for a
// removal spell with nothing to destroy/exile/bounce/damage on the board, the agent (or a human)
// would go ahead and cast it, and it would resolve into noLegalTargetEvent's silent whiff at
// resolution time — mirrors the exact same removalEffectHasLegalTarget check applyRemovalEffect
// itself uses below, just run one step earlier, before mana and the card are spent on something
// that can never do anything.
function hasResolvableRemovalTarget(session: GameSession, casterSeatId: string, card: VisibleCard): boolean {
  const effect = parseRemovalEffect(etbEffectText(card.oracleText));
  if (!effect) return true;
  return removalEffectHasLegalTarget(session, casterSeatId, card, effect);
}

// Same "no legal target = illegal to cast" check as hasResolvableRemovalTarget, for the
// reanimate/regrow/gain_control zone effects that also need one — mill, graveyard_to_library,
// impulse_draw, and steal_and_play are always "legal" to cast even when they'd do little (milling
// an empty library, exiling from an empty-ish deck), so only the genuinely target-dependent kinds
// are checked here.
function hasResolvableZoneEffectTarget(session: GameSession, casterSeatId: string, card: VisibleCard): boolean {
  const effect = parseZoneEffect(etbEffectText(card.oracleText));
  if (!effect) return true;
  return zoneEffectHasLegalTarget(session, casterSeatId, effect);
}

function zoneEffectHasLegalTarget(session: GameSession, casterSeatId: string, effect: ZoneEffect): boolean {
  switch (effect.kind) {
    case "reanimate":
      return chooseReanimationTarget(session, casterSeatId, effect.anyGraveyard, effect.targetType) !== undefined;
    case "regrow":
      return chooseRegrowTarget(session, casterSeatId, effect.targetType) !== undefined;
    case "gain_control":
      return chooseControlTarget(session, casterSeatId) !== undefined;
    case "mill":
    case "graveyard_to_library":
    case "impulse_draw":
    case "steal_and_play":
    case "draw_x_then_put_back":
      return true;
  }
}

// Aura-based reanimation (Animate Dead, Necromancy, ...) is explicitly out of scope for
// parseZoneEffect (see zoneEffects.ts's file comment) — its ETB trigger text ("Return enchanted
// creature card to the battlefield...") doesn't match that parser's "target creature card"
// phrasing, since an Aura targets via its own "Enchant X" line rather than the spell itself. But an
// Aura's legality to cast still hinges on that Enchant line finding a legal object (rule 303.4c) —
// independent of whatever its ETB trigger does — so this checks that directly rather than needing
// the ETB effect itself to be understood.
function hasResolvableAuraEnchantTarget(session: GameSession, casterSeatId: string, card: VisibleCard): boolean {
  if (!card.typeLine.includes("Aura")) return true;
  const enchantLine = oracleClauses(card.oracleText).find((clause) => /^enchant\b/i.test(clause));
  if (!enchantLine) return true;
  const graveyardEnchant = enchantLine.match(/^enchant creature card in (a|your) graveyard\b/i);
  if (!graveyardEnchant) return true;
  return chooseReanimationTarget(session, casterSeatId, graveyardEnchant[1].toLowerCase() === "a") !== undefined;
}

function hasResolvableTarget(session: GameSession, casterSeatId: string, card: VisibleCard): boolean {
  return (
    hasResolvableRemovalTarget(session, casterSeatId, card) &&
    hasResolvableZoneEffectTarget(session, casterSeatId, card) &&
    hasResolvableAuraEnchantTarget(session, casterSeatId, card) &&
    hasResolvableGenericCreatureTarget(session, casterSeatId, card)
  );
}

// Fallback for "target creature" spells that aren't a destroy/exile/damage effect (removalSpells.ts)
// or a graveyard-return effect (zoneEffects.ts) — pump spells, protection, Malakir Rebirth-style
// death-ward grants, and the like. Without this, a spell whose entire effect hinges on "target
// creature" with zero creatures anywhere in play (a real turn-1 scenario) still got offered as
// castable, since none of the other three checks recognize this shape and all default to "legal."
// Deliberately narrow: only the plain "target creature[, you control|an opponent controls]" phrasing
// is understood; anything else (planeswalkers, "target creature or player", multiple targets) is left
// alone rather than risk declining a spell that actually does have a legal target.
function hasResolvableGenericCreatureTarget(session: GameSession, casterSeatId: string, card: VisibleCard): boolean {
  if (parseRemovalEffect(etbEffectText(card.oracleText))) return true;
  if (parseZoneEffect(etbEffectText(card.oracleText))) return true;
  if (card.typeLine.includes("Aura")) return true;
  // A modal spell might have a non-targeting mode that's still perfectly castable even when its
  // creature-targeting mode isn't — this checker has no mode-selection logic of its own (unlike
  // removalEffectHasLegalTarget's per-mode filtering), so declining here would risk hiding a
  // genuinely legal cast rather than just failing to catch an illegal one.
  if (parseModalHeader(card.oracleText)) return true;
  const clause = oracleClauses(card.oracleText).find(
    (item) => /\btarget creature\b/i.test(item) && !/\btarget creature (?:card|or )/i.test(item)
  );
  if (!clause) return true;
  const wantsOwn = /\btarget creature you control\b/i.test(clause);
  const wantsOpp = /\btarget creature (?:an opponent controls|you don't control)\b/i.test(clause);
  return session.seats.some((seat) => {
    if (wantsOwn && seat.id !== casterSeatId) return false;
    if (wantsOpp && seat.id === casterSeatId) return false;
    return seat.board.battlefield.some((permanent) => permanent.typeLine.includes("Creature"));
  });
}

// Rule 702.13c: a permanent with ward counters a spell/ability that targets it unless that spell's
// controller pays the ward cost. No interactive "do you want to pay" prompt exists anywhere else in
// this engine's deterministic targeting (every choice here is auto-resolved), so this mirrors that:
// auto-attempt payment from the caster's untapped mana, same as the existing counterspell-tax
// payment in resolvePendingAction's counterTargetId branch. Unpayable means the effect is countered.
function payWardIfNeeded(session: GameSession, casterSeatId: string, targetCard: VisibleCard, sourceName: string): { session: GameSession; countered: boolean } {
  const wardCost = cardWardAmount(targetCard.oracleText);
  if (wardCost === undefined || wardCost <= 0) return { session, countered: false };
  const casterSeat = session.seats.find((seat) => seat.id === casterSeatId);
  if (!casterSeat) return { session, countered: false };
  const payment = chooseManaSourcesForCost(casterSeat, genericCostShim(wardCost), wardCost);
  if (!payment.ok) {
    return {
      session: {
        ...session,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: casterSeatId,
            message: `${targetCard.name}'s ward counters ${sourceName}: ${casterSeat.name} can't pay {${wardCost}}.`,
            detail: "Rules action"
          },
          ...session.events
        ]
      },
      countered: true
    };
  }
  return {
    session: {
      ...session,
      seats: session.seats.map((seat) => (seat.id === casterSeatId ? spendManaSources(seat, payment.sourceIds) : seat)),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: casterSeatId,
          message: `${casterSeat.name} pays ${targetCard.name}'s ward {${wardCost}}.`,
          detail: "Rules action"
        },
        ...session.events
      ]
    },
    countered: false
  };
}

function applyRemovalEffect(session: GameSession, casterSeatId: string, sourceName: string, source: VisibleCard, effect: RemovalEffect, chosenX?: number): GameSession {
  switch (effect.kind) {
    case "destroy_all": {
      const destructions: Array<{ seatId: string; cardId: string; message: string }> = [];
      const typeMatches = (card: VisibleCard) =>
        effect.targetType === "creature" ? card.typeLine.includes("Creature") : effect.targetType === "artifact" ? card.typeLine.includes("Artifact") : card.typeLine.includes("Enchantment");
      for (const seat of session.seats) {
        for (const card of seat.board.battlefield) {
          if (typeMatches(card)) destructions.push({ seatId: seat.id, cardId: card.id, message: `${card.name} is destroyed by ${sourceName}.` });
        }
      }
      return destroyCreatures(session, destructions, "Rules action");
    }
    case "destroy_all_conditional": {
      const destructions: Array<{ seatId: string; cardId: string; message: string }> = [];
      for (const seat of session.seats) {
        for (const card of seat.board.battlefield) {
          if (!card.typeLine.includes("Creature")) continue;
          const meetsThreshold = effect.comparison === "or_less" ? card.manaValue <= effect.threshold : card.manaValue >= effect.threshold;
          if (meetsThreshold) destructions.push({ seatId: seat.id, cardId: card.id, message: `${card.name} is destroyed by ${sourceName}.` });
        }
      }
      return destroyCreatures(session, destructions, "Rules action");
    }
    case "modal": {
      // No target-selection UI exists here any more than elsewhere in this file's deterministic
      // targeting — skip modes with nothing to do (an empty-graveyard reanimate-shaped mode, a
      // damage mode with no target) rather than burning a "choose N" slot on a guaranteed no-op,
      // and take the first `chooseCount` modes that do have something to do.
      const viableModes = effect.modes.filter((mode) => removalEffectHasLegalTarget(session, casterSeatId, source, mode));
      const chosenModes = viableModes.slice(0, effect.chooseCount);
      if (chosenModes.length === 0) return noLegalTargetEvent(session, casterSeatId, sourceName);
      return chosenModes.reduce((current, mode) => applyRemovalEffect(current, casterSeatId, sourceName, source, mode, chosenX), session);
    }
    case "destroy": {
      const target = chooseRemovalTarget(session, casterSeatId, effect.targetType, source, effect.excludedColors, effect.artifactsExcluded);
      if (!target) return noLegalTargetEvent(session, casterSeatId, sourceName);
      const warded = payWardIfNeeded(session, casterSeatId, target.card, sourceName);
      if (warded.countered) return warded.session;
      return destroyCreatures(warded.session, [{ seatId: target.seatId, cardId: target.card.id, message: `${target.card.name} is destroyed by ${sourceName}.` }], "Rules action");
    }
    case "exile": {
      const target = chooseRemovalTarget(session, casterSeatId, effect.targetType, source);
      if (!target) return noLegalTargetEvent(session, casterSeatId, sourceName);
      const warded = payWardIfNeeded(session, casterSeatId, target.card, sourceName);
      if (warded.countered) return warded.session;
      return moveCardBetweenVisibleZones(warded.session, target.seatId, target.card.id, "exile");
    }
    case "damage": {
      const amount = effect.amount === "X" ? chosenX ?? 0 : effect.amount;
      if (amount <= 0) return noLegalTargetEvent(session, casterSeatId, sourceName);
      const target = chooseDamageTarget(session, casterSeatId, amount, effect.targetType, source);
      if (!target) return noLegalTargetEvent(session, casterSeatId, sourceName);
      if (target.kind === "creature") {
        const warded = payWardIfNeeded(session, casterSeatId, target.card, sourceName);
        if (warded.countered) return warded.session;
        return dealDamageToCreature(warded.session, sourceName, target.seatId, target.card.id, amount, source, casterSeatId);
      }
      return applyCombatDamageToTarget(session, sourceName, { seat: target.seat }, amount, source, casterSeatId, "noncombat");
    }
    case "bounce": {
      const target = chooseRemovalTarget(session, casterSeatId, effect.targetType, source);
      if (!target) return noLegalTargetEvent(session, casterSeatId, sourceName);
      const warded = payWardIfNeeded(session, casterSeatId, target.card, sourceName);
      if (warded.countered) return warded.session;
      // Goes to its OWNER's hand, not necessarily its current controller's (rule: bounce always
      // targets the owner) — relevant once a control-changing effect has already moved it.
      const ownerSeatId = target.card.ownerSeatId ?? target.seatId;
      const { session: bouncedSession } = moveCardAcrossSeats(warded.session, target.seatId, target.card.id, ownerSeatId, "hand");
      return {
        ...bouncedSession,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: casterSeatId,
            message: `${sourceName} returns ${target.card.name} to its owner's hand.`,
            detail: "Rules action"
          },
          ...bouncedSession.events
        ]
      };
    }
  }
}

function matchesReanimateTargetType(card: VisibleCard, targetType: RegrowTargetType): boolean {
  if (targetType === "enchantment") return card.typeLine.includes("Enchantment");
  if (targetType === "artifact") return card.typeLine.includes("Artifact");
  return card.typeLine.includes("Creature");
}

// Best available creature by combined effective power+toughness — mirrors chooseRemovalTarget's
// "biggest is the meaningful pick" convention, reused here for "biggest is worth reanimating." A
// non-creature targetType (Starfield of Nyx's "target enchantment card", ...) has no power/toughness
// to rank by, so mana value stands in as the "more impactful" proxy instead. Any graveyard is
// searched when anyGraveyard is true (Reanimate); otherwise only the caster's own. targetType
// defaults to "creature" so the Aura-reanimation call site (Animate Dead's "Enchant creature card in
// a graveyard") keeps its existing behavior unchanged.
function chooseReanimationTarget(
  session: GameSession,
  casterSeatId: string,
  anyGraveyard: boolean,
  targetType: RegrowTargetType = "creature"
): { seatId: string; card: VisibleCard } | undefined {
  const candidates: Array<{ seatId: string; card: VisibleCard }> = [];
  for (const seat of session.seats) {
    if (!anyGraveyard && seat.id !== casterSeatId) continue;
    for (const card of seat.board.graveyard ?? []) {
      if (matchesReanimateTargetType(card, targetType)) candidates.push({ seatId: seat.id, card });
    }
  }
  if (candidates.length === 0) return undefined;
  if (targetType !== "creature") {
    return candidates.reduce((a, b) => (b.card.manaValue > a.card.manaValue ? b : a));
  }
  return candidates.reduce((a, b) => (effectivePower(b.card) + effectiveToughness(b.card) > effectivePower(a.card) + effectiveToughness(a.card) ? b : a));
}

// Regrow effects in this codebase's real-card sample are all self-graveyard-only (Regrowth,
// Nature's Spiral) — no "any graveyard" variant found, so this deliberately doesn't take one.
function chooseRegrowTarget(session: GameSession, casterSeatId: string, targetType: RegrowTargetType): VisibleCard | undefined {
  const seat = session.seats.find((item) => item.id === casterSeatId);
  const candidates = (seat?.board.graveyard ?? []).filter((card) => {
    if (targetType === "card") return true;
    if (targetType === "permanent") return !card.typeLine.includes("Instant") && !card.typeLine.includes("Sorcery");
    if (targetType === "creature") return card.typeLine.includes("Creature");
    if (targetType === "land") return card.typeLine.includes("Land");
    return false;
  });
  if (candidates.length === 0) return undefined;
  return candidates.reduce((a, b) => (b.manaValue > a.manaValue ? b : a));
}

// -1/-1 counters and wither/infect don't apply to a mill/graveyard-recursion target the way they
// do to combat/removal — this just moves cards, so the "best" pick for a control-changing/
// reanimation-adjacent target is a stats-based heuristic, not a threat-assessment one; kept
// separate from chooseRemovalTarget since gaining control specifically prefers OPPONENTS' creatures
// (it's a form of removal-plus-upside), matching real deckbuilding intuition.
function chooseControlTarget(session: GameSession, casterSeatId: string): { seatId: string; card: VisibleCard } | undefined {
  const candidates: Array<{ seatId: string; card: VisibleCard }> = [];
  for (const seat of session.seats) {
    if (seat.id === casterSeatId) continue;
    for (const card of seat.board.battlefield) {
      if (card.typeLine.includes("Creature")) candidates.push({ seatId: seat.id, card });
    }
  }
  if (candidates.length === 0) return undefined;
  return candidates.reduce((a, b) => (effectivePower(b.card) + effectiveToughness(b.card) > effectivePower(a.card) + effectiveToughness(a.card) ? b : a));
}

function applyMill(session: GameSession, seatId: string, sourceName: string, amount: number): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  const library = seat.library ?? [];
  const milled = library.slice(0, amount).map((card) => resetForZoneChange(card, "graveyard" as const));
  if (milled.length === 0) return session;
  return {
    ...session,
    seats: session.seats.map((item) =>
      item.id === seatId
        ? {
            ...item,
            library: library.slice(amount),
            board: { ...item.board, graveyard: [...(item.board.graveyard ?? []), ...milled] },
            zones: { ...item.zones, library: Math.max(0, item.zones.library - milled.length), graveyard: item.zones.graveyard + milled.length }
          }
        : item
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${sourceName} mills ${seat.name} for ${milled.length} card${milled.length === 1 ? "" : "s"}.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

function applyGraveyardToLibrary(session: GameSession, seatId: string, sourceName: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const graveyard = seat?.board.graveyard ?? [];
  if (!seat || graveyard.length === 0) return session;
  const shuffled = shuffleCards([...(seat.library ?? []), ...graveyard.map((card) => resetForZoneChange(card, "library" as const))]);
  return {
    ...session,
    seats: session.seats.map((item) =>
      item.id === seatId
        ? { ...item, library: shuffled, board: { ...item.board, graveyard: [] }, zones: { ...item.zones, library: item.zones.library + graveyard.length, graveyard: 0 } }
        : item
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${sourceName} shuffles ${seat.name}'s graveyard into their library.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

// Top-level dispatcher for src/lib/zoneEffects.ts's parsed effects, mirroring applyRemovalEffect's
// shape and "no legal target = log and no-op" convention.
function applyZoneEffect(session: GameSession, casterSeatId: string, sourceName: string, effect: ZoneEffect, chosenX?: number): GameSession {
  switch (effect.kind) {
    case "reanimate": {
      const target = chooseReanimationTarget(session, casterSeatId, effect.anyGraveyard, effect.targetType);
      if (!target) return noLegalTargetEvent(session, casterSeatId, sourceName);
      const { session: reanimatedSession } = moveCardAcrossSeats(session, target.seatId, target.card.id, casterSeatId, "battlefield");
      return {
        ...reanimatedSession,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: casterSeatId,
            message: `${sourceName} returns ${target.card.name} from a graveyard to the battlefield under its new controller.`,
            detail: "Rules action"
          },
          ...reanimatedSession.events
        ]
      };
    }
    case "regrow": {
      const target = chooseRegrowTarget(session, casterSeatId, effect.targetType);
      if (!target) return noLegalTargetEvent(session, casterSeatId, sourceName);
      const { session: regrownSession } = moveCardAcrossSeats(session, casterSeatId, target.id, casterSeatId, "hand");
      return {
        ...regrownSession,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: casterSeatId,
            message: `${sourceName} returns ${target.name} from the graveyard to hand.`,
            detail: "Rules action"
          },
          ...regrownSession.events
        ]
      };
    }
    case "mill": {
      // "target player" has no strong heuristic preference among opponents (milling is a hazard,
      // not a benefit, so it's aimed at an opponent rather than the caster) — just picks the first.
      const seatIds =
        effect.scope === "you"
          ? [casterSeatId]
          : effect.scope === "target_player"
            ? [session.seats.find((seat) => seat.id !== casterSeatId)?.id ?? casterSeatId]
            : effect.scope === "each_opponent"
              ? session.seats.filter((seat) => seat.id !== casterSeatId).map((seat) => seat.id)
              : session.seats.map((seat) => seat.id);
      return seatIds.reduce((next, seatId) => applyMill(next, seatId, sourceName, effect.amount), session);
    }
    case "graveyard_to_library": {
      const seatId =
        effect.scope === "you" ? casterSeatId : session.seats.find((seat) => seat.id !== casterSeatId && (seat.board.graveyard ?? []).length > 0)?.id ?? casterSeatId;
      return applyGraveyardToLibrary(session, seatId, sourceName);
    }
    case "gain_control": {
      const target = chooseControlTarget(session, casterSeatId);
      if (!target) return noLegalTargetEvent(session, casterSeatId, sourceName);
      const controlledSession = changeControlWithinBattlefield(session, target.card.id, target.seatId, casterSeatId, effect.untilEndOfTurn);
      return {
        ...controlledSession,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: casterSeatId,
            message: `${sourceName} gains control of ${target.card.name}${effect.untilEndOfTurn ? " until end of turn" : ""}.`,
            detail: "Rules action"
          },
          ...controlledSession.events
        ]
      };
    }
    case "impulse_draw":
      return applyImpulseDraw(session, casterSeatId, sourceName, effect.amount, effect.untilEndOfNextTurn);
    case "steal_and_play":
      return applyStealAndPlay(session, casterSeatId, sourceName);
    case "draw_x_then_put_back":
      return applyDrawXThenPutBack(session, casterSeatId, sourceName, chosenX ?? 0, effect.putBackAmount);
  }
}

// Replaces the standalone word "X" with the caster's actual paid X, so a mode/effect written with
// a variable amount ("Target player loses X life," "Target creature gets -X/-X until end of
// turn") can be parsed by the same fixed-number parsers used everywhere else in this file (mill,
// draw, life, the pump parser below, ...) instead of every regex separately learning a symbolic
// "x". Resolving X in the text itself, once, up front, is simpler and safer than threading a
// dynamic value through every downstream effect kind — and it's exactly why several of those
// regexes already tolerate a literal "x" in their own alternation (harmless dead weight once this
// substitution runs, and the correct "decline, don't guess" behavior on the rare path where
// chosenX isn't available and "x" is left as-is).
function substituteX(text: string, chosenX: number): string {
  return text.replace(/\bx\b/gi, String(chosenX));
}

interface PumpEffect {
  power: number;
  toughness: number;
}

// "Target creature gets +N/+N or -N/-N until end of turn." (Giant Growth-style tricks, Afflict-
// style debuffs, Profane Command's -X/-X mode once substituteX has resolved X, ...) — one of the
// single most common instant/sorcery templates in the whole card pool, and previously entirely
// unmodeled (no TriggerEffect/ZoneEffect kind covers a temporary, targeted P/T change). Reuses the
// existing temporaryPowerBonus/temporaryToughnessBonus fields (already used for prowess) rather
// than adding a parallel mechanism.
function parseTargetedPump(text: string): PumpEffect | undefined {
  const match = text.match(/\btarget creature gets ([+-]\d+)\/([+-]\d+) until end of turn\b/i);
  if (!match) return undefined;
  return { power: Number.parseInt(match[1], 10), toughness: Number.parseInt(match[2], 10) };
}

// Reuses chooseCounterTarget's existing polarity-aware heuristic (a positive change prefers the
// caster's own best creature; a negative one prefers the biggest threat among opponents) rather
// than writing a parallel targeting heuristic — the "which creature" question is identical whether
// the +N/-N is being applied via counters or a temporary bonus.
function choosePumpTarget(session: GameSession, casterSeatId: string, effect: PumpEffect) {
  return chooseCounterTarget(session, casterSeatId, effect.power >= 0 ? "+1/+1" : "-1/-1", false);
}

function applyTargetedPumpEffect(session: GameSession, casterSeatId: string, sourceCard: VisibleCard, effect: PumpEffect): GameSession {
  const target = choosePumpTarget(session, casterSeatId, effect);
  if (!target) return noLegalTargetEvent(session, casterSeatId, sourceCard.name);
  const powerText = `${effect.power >= 0 ? "+" : ""}${effect.power}`;
  const toughnessText = `${effect.toughness >= 0 ? "+" : ""}${effect.toughness}`;
  return {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === target.seatId
        ? {
            ...seat,
            board: {
              ...seat.board,
              battlefield: seat.board.battlefield.map((card) =>
                card.id === target.card.id
                  ? { ...card, temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + effect.power, temporaryToughnessBonus: (card.temporaryToughnessBonus ?? 0) + effect.toughness }
                  : card
              )
            }
          }
        : seat
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: casterSeatId,
        message: `${sourceCard.name} gives ${target.card.name} ${powerText}/${toughnessText} until end of turn.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

type GenericModalMode = { kind: "trigger"; effect: TriggerEffect } | { kind: "zone"; effect: ZoneEffect } | { kind: "pump"; effect: PumpEffect };

interface GenericModalEffect {
  chooseCount: number;
  modes: GenericModalMode[];
}

// "Choose one/two/three —\n• mode.\n• mode. ..." (Profane Command, Behold the Beyond, ...) for the
// case removalSpells.ts's own modal handling doesn't own: every bullet is non-removal-shaped (if
// even one bullet were destroy/exile/damage-shaped, parseRemovalEffect would already return a
// modal effect for this card, and that system owns it instead — see the call site in
// resolvePendingAction). Each bullet's own isolated text (with X already substituted, when known)
// is matched against the same zone-effect/common-trigger/pump parsers already used for ordinary
// ETB/spell resolution elsewhere in this file, so a mode none of them recognize (a life-drain-and-
// gain pair, a multi-target "up to X creatures" grant, ...) is simply dropped — the same "decline
// rather than guess" behavior as every other unmatched shape in this codebase, and the same
// behavior removalSpells.ts's own modal parsing already has for modes it can't place.
function parseGenericModalEffect(oracleText: string, chosenX: number | undefined): GenericModalEffect | undefined {
  if (parseRemovalEffect(etbEffectText(oracleText))) return undefined;
  const header = parseModalHeader(oracleText);
  if (!header) return undefined;
  const modes: GenericModalMode[] = [];
  for (const rawModeText of header.modeTexts) {
    const modeText = chosenX !== undefined ? substituteX(rawModeText, chosenX) : rawModeText;
    const pump = parseTargetedPump(modeText);
    if (pump) {
      modes.push({ kind: "pump", effect: pump });
      continue;
    }
    const zone = parseZoneEffect(modeText);
    if (zone) {
      modes.push({ kind: "zone", effect: zone });
      continue;
    }
    const trigger = commonTriggerEffect(modeText, "clause");
    if (trigger) modes.push({ kind: "trigger", effect: trigger });
  }
  return modes.length > 0 ? { chooseCount: header.chooseCount, modes } : undefined;
}

function genericModalModeHasLegalTarget(session: GameSession, casterSeatId: string, mode: GenericModalMode): boolean {
  if (mode.kind === "zone") return zoneEffectHasLegalTarget(session, casterSeatId, mode.effect);
  if (mode.kind === "pump") return choosePumpTarget(session, casterSeatId, mode.effect) !== undefined;
  if (mode.effect.kind === "add_counter" && mode.effect.scope !== "self" && mode.effect.scope !== "context") {
    return chooseCounterTarget(session, casterSeatId, mode.effect.counterKind, mode.effect.scope === "target_creature_you_control") !== undefined;
  }
  return true;
}

// Same "take the first chooseCount viable modes, in printed order" heuristic removalSpells.ts's
// own modal application already uses (see the "modal" case in applyRemovalEffect) rather than
// scoring between modes — no target-selection UI exists here any more than elsewhere in this
// file's deterministic targeting. A "you may" mode is always taken as accepted: resolveTriggerEffect
// has no notion of declining (that only happens upstream, in the accept/decline UI a real triggered
// ability goes through before ever reaching it), and a synthetic trigger built here skips that step
// entirely, matching how cheaply this engine already treats "optional" ETB effects elsewhere.
function applyGenericModalEffect(session: GameSession, casterSeatId: string, sourceCard: VisibleCard, effect: GenericModalEffect): GameSession {
  const viableModes = effect.modes.filter((mode) => genericModalModeHasLegalTarget(session, casterSeatId, mode));
  const chosenModes = viableModes.slice(0, effect.chooseCount);
  if (chosenModes.length === 0) return noLegalTargetEvent(session, casterSeatId, sourceCard.name);
  return chosenModes.reduce((current, mode) => {
    if (mode.kind === "zone") return applyZoneEffect(current, casterSeatId, sourceCard.name, mode.effect);
    if (mode.kind === "pump") return applyTargetedPumpEffect(current, casterSeatId, sourceCard, mode.effect);
    const syntheticTrigger: Extract<PendingAction, { type: "trigger" }> = {
      id: crypto.randomUUID(),
      type: "trigger",
      actorSeatId: casterSeatId,
      controllerSeatId: casterSeatId,
      sourceCardId: sourceCard.id,
      sourceCardName: sourceCard.name,
      triggerKind: "common",
      effect: mode.effect,
      message: ""
    };
    return resolveTriggerEffect(current, syntheticTrigger);
  }, session);
}

interface CounterAccumulationEffect {
  counterKind: string;
  addAmount: number;
  threshold: number;
  payoff: TriggerEffect;
}

// "At the beginning of your upkeep, choose one — • Put a loyalty counter on Idol of Oblivion. • If
// Idol of Oblivion has three or more loyalty counters on it, remove all of them and create a 5/5
// colorless Avatar creature token." (Idol of Oblivion, and the same "charge up, then cash in" shape
// on similar permanents) — this doesn't fit the generic modal machinery above: mode two's threshold
// check references mode one's own counter kind, and "remove them and <payoff>" is a compound
// conditional no single-mode parser (pump/zone/trigger) represents on its own. Handled as its own
// dedicated shape, tried before the generic modal fallback in applyDeterministicPhaseTrigger, the
// same way this file already special-cases other common-but-not-generic patterns (Thopter
// Assembly's gated return-and-remake, Everflowing Chalice's kicker-scaled counters). Restricted to
// self-targeting (the counter always lands on the permanent with the ability) — every real card of
// this shape works that way; a "put a counter on target permanent, cash in on a different one" card
// doesn't exist and would need real per-mode targeting this engine doesn't have anyway.
function parseCounterAccumulationTrigger(oracleText: string, cardName: string): CounterAccumulationEffect | undefined {
  const header = parseModalHeader(oracleText);
  if (!header || header.modeTexts.length !== 2) return undefined;
  const [modeA, modeB] = header.modeTexts;
  const escapedName = cardName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const selfRef = `(?:this (?:artifact|creature|permanent|enchantment|land|planeswalker)|${escapedName})`;
  const addMatch = modeA.match(new RegExp(`^put (a|one|two|three|four|five|\\d+) ([a-z][a-z0-9+/\\- ]*?) counters? on ${selfRef}\\.?$`, "i"));
  if (!addMatch) return undefined;
  const addAmount = numberWordToInt(addMatch[1]);
  const counterKind = addMatch[2].trim().toLowerCase();
  if (!addAmount || !counterKind) return undefined;
  const escapedKind = counterKind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const thresholdMatch = modeB.match(
    new RegExp(`^if ${selfRef} has (a|one|two|three|four|five|\\d+) or more ${escapedKind} counters? on it,\\s*remove (?:all of )?them and (.+)$`, "i")
  );
  if (!thresholdMatch) return undefined;
  const threshold = numberWordToInt(thresholdMatch[1]);
  if (!threshold) return undefined;
  const tokenSpecs = parseCreateTokenSpecs(thresholdMatch[2]);
  if (tokenSpecs.length === 0) return undefined;
  return { counterKind, addAmount, threshold, payoff: { kind: "create_tokens", tokens: tokenSpecs } };
}

// Greedy "cash in the moment you're eligible" rather than this file's usual "first viable mode in
// printed order" modal heuristic (see applyGenericModalEffect's own comment on that default) —
// printed order here is always [add, cash-in], so the default heuristic would pick "add" forever
// and the payoff mode would never be reachable, which is worse than the usual heuristic's tradeoff
// since it makes the card's entire reason for being played inert.
function applyCounterAccumulationEffect(session: GameSession, seatId: string, sourceCard: VisibleCard, effect: CounterAccumulationEffect): GameSession {
  const currentCount = counterCount(sourceCard, effect.counterKind);
  const withCounterDelta = (delta: number): GameSession => ({
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === seatId
        ? {
            ...seat,
            board: {
              ...seat.board,
              battlefield: seat.board.battlefield.map((card) =>
                card.id === sourceCard.id ? applyCounterDelta(card, effect.counterKind, delta) : card
              )
            }
          }
        : seat
    )
  });
  if (currentCount >= effect.threshold) {
    const trigger: Extract<PendingAction, { type: "trigger" }> = {
      id: crypto.randomUUID(),
      type: "trigger",
      actorSeatId: seatId,
      controllerSeatId: seatId,
      sourceCardId: sourceCard.id,
      sourceCardName: sourceCard.name,
      triggerKind: "common",
      effect: effect.payoff,
      message: ""
    };
    return resolveTriggerEffect(withCounterDelta(-currentCount), trigger);
  }
  return {
    ...withCounterDelta(effect.addAmount),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${sourceCard.name} gets ${effect.addAmount === 1 ? "a" : effect.addAmount} ${effect.counterKind} counter${effect.addAmount === 1 ? "" : "s"}.`
      },
      ...session.events
    ]
  };
}

// Brainsurge-style: draw X (the spell's own paid X, supplied by the caller), then put a fixed
// number of cards from hand back on top of the library. No interactive "choose N cards" UI exists
// anywhere in this engine (every hand/library choice here is auto-resolved — see chooseAuraAttachTarget,
// chooseRemovalTarget, etc.), so this puts back the highest-mana-value cards currently in hand: the
// same "keep what's cheap and castable, cycle the rest" bias a player defaults to with no clearly
// worse specific card to name.
function applyDrawXThenPutBack(session: GameSession, seatId: string, sourceName: string, drawCount: number, putBackAmount: number): GameSession {
  const seatName = session.seats.find((seat) => seat.id === seatId)?.name ?? "Player";
  const drawnSession =
    drawCount > 0 ? drawMultipleForSeat(session, seatId, drawCount, `${seatName} draws ${drawCount} from ${sourceName}.`) : session;
  const seat = drawnSession.seats.find((item) => item.id === seatId);
  if (!seat) return drawnSession;
  const putBack = [...seat.board.hand].sort((a, b) => b.manaValue - a.manaValue).slice(0, Math.min(putBackAmount, seat.board.hand.length));
  if (putBack.length === 0) return drawnSession;
  const putBackIds = new Set(putBack.map((card) => card.id));
  return {
    ...drawnSession,
    seats: drawnSession.seats.map((item) =>
      item.id === seatId
        ? {
            ...item,
            board: { ...item.board, hand: item.board.hand.filter((card) => !putBackIds.has(card.id)) },
            library: [...putBack.map((card) => ({ ...card, zone: "library" as const })), ...(item.library ?? [])],
            zones: { ...item.zones, hand: Math.max(0, item.zones.hand - putBack.length), library: item.zones.library + putBack.length }
          }
        : item
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${seatName} puts ${putBack.length} card${putBack.length === 1 ? "" : "s"} from hand on top of their library.`,
        detail: "Rules action"
      },
      ...drawnSession.events
    ]
  };
}

function applyImpulseDraw(session: GameSession, seatId: string, sourceName: string, amount: number, untilEndOfNextTurn: boolean): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  const library = seat.library ?? [];
  const cards = library.slice(0, amount);
  if (cards.length === 0) return session;
  const exiledPlayableUntilTurn = untilEndOfNextTurn ? session.turn + 1 : session.turn;
  const exiled = cards.map((card) => ({
    ...resetForZoneChange(card, "exile" as const),
    ownerSeatId: card.ownerSeatId ?? seatId,
    exiledPlayableBySeatId: seatId,
    exiledPlayableUntilTurn
  }));
  return {
    ...session,
    seats: session.seats.map((item) =>
      item.id === seatId
        ? {
            ...item,
            library: library.slice(amount),
            board: { ...item.board, exile: [...(item.board.exile ?? []), ...exiled] },
            zones: { ...item.zones, library: Math.max(0, item.zones.library - exiled.length), exile: item.zones.exile + exiled.length }
          }
        : item
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${sourceName} exiles ${exiled.length} card${exiled.length === 1 ? "" : "s"} from the top of ${seat.name}'s library — playable ${untilEndOfNextTurn ? "until the end of next turn" : "this turn"}.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

// Same "no generic hidden-zone search UI" deterministic heuristic used everywhere else in this
// engine: highest mana value nonland card, across any opponent's library (this engine doesn't
// distinguish "target opponent" from "any opponent" for search-target selection elsewhere either —
// see chooseControlTarget/chooseRemovalTarget's similar cross-opponent pooling).
function chooseStealAndPlayTarget(session: GameSession, casterSeatId: string): { seatId: string; card: VisibleCard } | undefined {
  const candidates: Array<{ seatId: string; card: VisibleCard }> = [];
  for (const seat of session.seats) {
    if (seat.id === casterSeatId) continue;
    for (const card of seat.library ?? []) {
      if (!isLandCard(card)) candidates.push({ seatId: seat.id, card });
    }
  }
  if (candidates.length === 0) return undefined;
  return candidates.reduce((a, b) => (b.card.manaValue > a.card.manaValue ? b : a));
}

function applyStealAndPlay(session: GameSession, casterSeatId: string, sourceName: string): GameSession {
  const target = chooseStealAndPlayTarget(session, casterSeatId);
  if (!target) return noLegalTargetEvent(session, casterSeatId, sourceName);
  const { session: exiledSession } = moveCardAcrossSeats(session, target.seatId, target.card.id, casterSeatId, "exile");
  const withPlayPermission: GameSession = {
    ...exiledSession,
    seats: exiledSession.seats.map((seat) =>
      seat.id === casterSeatId
        ? {
            ...seat,
            board: {
              ...seat.board,
              exile: (seat.board.exile ?? []).map((card) =>
                card.id === target.card.id ? { ...card, exiledPlayableBySeatId: casterSeatId, exiledPlayableUntilTurn: undefined } : card
              )
            }
          }
        : seat
    )
  };
  return {
    ...withPlayPermission,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: casterSeatId,
        message: `${sourceName} searches an opponent's library and exiles ${target.card.name} — playable for as long as it remains exiled.`,
        detail: "Rules action"
      },
      ...withPlayPermission.events
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
  attackerLifegain: number;
  blockerLifegain: number;
  blockerMinusCounters: number;
  attackerMinusCounters: number;
}

interface MultiBlockedCombatOutcome {
  blockerResults: Array<{ blocker: VisibleCard; damageMarked: number; destroyed: boolean; lifegain: number; minusCounters: number }>;
  attackerDamageMarked: number;
  attackerDestroyed: boolean;
  trampleOverflow: number;
  attackerLifegain: number;
  attackerMinusCounters: number;
}

// Generalizes simulateBlockedCombat to two or more blockers on the same attacker (rule 509/510).
// The attacker's controller assigns damage among blockers in `blockers`' order — at least lethal
// (or, with deathtouch, 1) to one before any moves to the next; trample sends whatever's left after
// every blocker has lethal to the defending player/planeswalker, and without trample any leftover
// (the attacker has more power than total lethal needed) is simply dumped on the last blocker in
// order, since it has no other legal home and doesn't matter mechanically where it lands. Each
// blocker still deals its own full power to the attacker, same as a single block, just summed.
function simulateMultiBlockedCombat(attackingCard: VisibleCard, blockers: VisibleCard[]): MultiBlockedCombatOutcome {
  const attackerPower = Math.max(0, effectivePower(attackingCard));
  const attackerToughness = effectiveToughness(attackingCard);

  let attackerAlive = true;
  let attackerDamageMarked = 0;
  let trampleOverflow = 0;

  const states = blockers.map((card) => ({
    card,
    alive: true,
    damageMarked: 0,
    dealtToAttacker: 0,
    toughness: effectiveToughness(card),
    protectedFromAttacker: isProtectedFrom(card, attackingCard)
  }));

  for (const step of ["first", "regular"] as const) {
    const attackerActs = attackerAlive && dealsDamageInCombatStep(attackingCard, step);

    if (attackerActs) {
      const targets = states.filter((state) => state.alive && !state.protectedFromAttacker);
      if (targets.length > 0) {
        let remaining = attackerPower;
        for (const state of targets) {
          if (remaining <= 0) break;
          const lethalNeeded = hasDeathtouch(attackingCard) ? 1 : Math.max(1, state.toughness - state.damageMarked);
          const assign = Math.min(remaining, lethalNeeded);
          state.damageMarked += assign;
          remaining -= assign;
        }
        if (hasTrample(attackingCard)) trampleOverflow += remaining;
        else if (remaining > 0) targets[targets.length - 1].damageMarked += remaining;
      } else if (hasTrample(attackingCard)) {
        trampleOverflow += attackerPower;
      }
    }

    const dealtDamageThisStep = new Set<string>();
    for (const state of states) {
      if (!state.alive || !dealsDamageInCombatStep(state.card, step)) continue;
      if (isProtectedFrom(attackingCard, state.card)) continue;
      const dealt = Math.max(0, effectivePower(state.card));
      attackerDamageMarked += dealt;
      state.dealtToAttacker += dealt;
      dealtDamageThisStep.add(state.card.id);
    }

    for (const state of states) {
      if (
        state.alive &&
        !hasIndestructible(state.card) &&
        (state.damageMarked >= state.toughness || (hasDeathtouch(attackingCard) && attackerActs && !state.protectedFromAttacker && state.damageMarked > 0))
      ) {
        state.alive = false;
      }
    }
    if (attackerAlive && !hasIndestructible(attackingCard)) {
      const deathtouchHit = states.some((state) => hasDeathtouch(state.card) && dealtDamageThisStep.has(state.card.id));
      if (attackerDamageMarked >= attackerToughness || deathtouchHit) attackerAlive = false;
    }
  }

  const blockerResults = states.map((state) => ({
    blocker: state.card,
    damageMarked: state.damageMarked,
    destroyed: !state.alive,
    lifegain: hasLifelink(state.card) ? state.dealtToAttacker : 0,
    minusCounters: hasWither(attackingCard) || hasInfect(attackingCard) ? state.damageMarked : 0
  }));

  return {
    blockerResults,
    attackerDamageMarked,
    attackerDestroyed: !attackerAlive,
    trampleOverflow,
    attackerLifegain: hasLifelink(attackingCard) ? blockerResults.reduce((total, result) => total + result.damageMarked, 0) + trampleOverflow : 0,
    attackerMinusCounters: states.some((state) => hasWither(state.card) || hasInfect(state.card)) ? attackerDamageMarked : 0
  };
}

const PROTECTION_COLOR_CODE: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };

// A permanent's own printed protection plus whatever protection an attached Aura/Equipment
// grants it (e.g. Sword of Fire and Ice's "protection from red and from blue").
function allProtectionColors(card: VisibleCard): string[] {
  return Array.from(new Set([...cardProtectionColors(card.oracleText), ...(card.grantedProtectionColors ?? [])]));
}

function isProtectedFrom(protectedCard: VisibleCard, sourceCard: VisibleCard): boolean {
  const colors = allProtectionColors(protectedCard);
  if (colors.length === 0) return false;
  return colors.some((color) => sourceCard.colors.includes(PROTECTION_COLOR_CODE[color]));
}

function simulateBlockedCombat(attackingCard: VisibleCard, blocker: VisibleCard): BlockedCombatOutcome {
  const attackerPower = Math.max(0, effectivePower(attackingCard));
  const blockerPower = Math.max(0, effectivePower(blocker));
  const attackerToughness = effectiveToughness(attackingCard);
  const blockerToughness = effectiveToughness(blocker);
  const blockerProtected = isProtectedFrom(blocker, attackingCard);
  const attackerProtected = isProtectedFrom(attackingCard, blocker);

  let attackerAlive = true;
  let blockerAlive = true;
  let attackerDamageMarked = 0;
  let blockerDamageMarked = 0;
  let trampleOverflow = 0;

  for (const step of ["first", "regular"] as const) {
    const attackerActs = attackerAlive && dealsDamageInCombatStep(attackingCard, step);
    const blockerActs = blockerAlive && dealsDamageInCombatStep(blocker, step);

    if (attackerActs && !blockerProtected) {
      const lethalNeeded = hasDeathtouch(attackingCard) ? 1 : Math.max(1, blockerToughness - blockerDamageMarked);
      const assignedToBlocker = hasTrample(attackingCard) ? Math.min(attackerPower, lethalNeeded) : attackerPower;
      trampleOverflow += hasTrample(attackingCard) ? Math.max(0, attackerPower - assignedToBlocker) : 0;
      blockerDamageMarked += assignedToBlocker;
    } else if (attackerActs && hasTrample(attackingCard)) {
      // Protection prevents damage to the blocker, but a trampling attacker's damage still goes
      // through to the defending player/planeswalker for the full amount.
      trampleOverflow += attackerPower;
    }
    if (blockerActs && !attackerProtected) {
      attackerDamageMarked += blockerPower;
    }
    if (blockerAlive && !hasIndestructible(blocker) && (blockerDamageMarked >= blockerToughness || (hasDeathtouch(attackingCard) && attackerActs && !blockerProtected && blockerDamageMarked > 0))) {
      blockerAlive = false;
    }
    if (attackerAlive && !hasIndestructible(attackingCard) && (attackerDamageMarked >= attackerToughness || (hasDeathtouch(blocker) && blockerActs && !attackerProtected && attackerDamageMarked > 0))) {
      attackerAlive = false;
    }
  }

  return {
    blockerDamageMarked,
    attackerDamageMarked,
    blockerDestroyed: !blockerAlive,
    attackerDestroyed: !attackerAlive,
    trampleOverflow,
    attackerLifegain: hasLifelink(attackingCard) ? blockerDamageMarked + trampleOverflow : 0,
    blockerLifegain: hasLifelink(blocker) ? attackerDamageMarked : 0,
    blockerMinusCounters: hasWither(attackingCard) || hasInfect(attackingCard) ? blockerDamageMarked : 0,
    attackerMinusCounters: hasWither(blocker) || hasInfect(blocker) ? attackerDamageMarked : 0
  };
}

// blockers must all belong to target.seat and be ordered the way the attacker's controller wants
// damage assigned (attackingCard.damageAssignmentOrder, falling back to however they're passed in
// for the single-blocker case where order is moot).
function resolveBlockedCombatDamage(
  session: GameSession,
  attackerSeatId: string,
  attackingCard: VisibleCard,
  target: { seat: PlayerSeat; planeswalker?: VisibleCard },
  blockers: VisibleCard[]
): GameSession {
  const outcome = simulateMultiBlockedCombat(attackingCard, blockers);

  const destructions: Array<{ seatId: string; cardId: string; message: string }> = [];
  for (const result of outcome.blockerResults) {
    if (result.destroyed) {
      destructions.push({ seatId: target.seat.id, cardId: result.blocker.id, message: `${result.blocker.name} is destroyed by combat damage from ${attackingCard.name}.` });
    }
  }
  if (outcome.attackerDestroyed) {
    destructions.push({
      seatId: attackerSeatId,
      cardId: attackingCard.id,
      message: `${attackingCard.name} is destroyed by combat damage from ${blockers.map((blocker) => blocker.name).join(" and ")}.`
    });
  }

  const totalBlockerLifegain = outcome.blockerResults.reduce((total, result) => total + result.lifegain, 0);
  const tradeSummary = outcome.blockerResults.map((result) => `${result.damageMarked} to ${result.blocker.name}`).join(", ");

  let nextSession: GameSession = {
    ...session,
    seats: session.seats.map((seat) => {
      if (seat.id === attackerSeatId && outcome.attackerLifegain > 0) return { ...seat, life: seat.life + outcome.attackerLifegain };
      if (seat.id === target.seat.id && totalBlockerLifegain > 0) return { ...seat, life: seat.life + totalBlockerLifegain };
      return seat;
    }),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: attackerSeatId,
        message: `${attackingCard.name} trades combat damage with ${blockers.map((blocker) => blocker.name).join(" and ")} (${tradeSummary}, ${outcome.attackerDamageMarked} to ${attackingCard.name}).`,
        detail: "Combat damage"
      },
      ...session.events
    ]
  };

  for (const result of outcome.blockerResults) {
    if (result.minusCounters <= 0) continue;
    nextSession = {
      ...nextSession,
      seats: nextSession.seats.map((seat) =>
        seat.id === target.seat.id
          ? {
              ...seat,
              board: {
                ...seat.board,
                battlefield: seat.board.battlefield.map((card) => (card.id === result.blocker.id ? applyCounterDelta(card, "-1/-1", result.minusCounters) : card))
              }
            }
          : seat
      )
    };
  }
  if (outcome.attackerMinusCounters > 0) {
    nextSession = {
      ...nextSession,
      seats: nextSession.seats.map((seat) =>
        seat.id === attackerSeatId
          ? { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === attackingCard.id ? applyCounterDelta(card, "-1/-1", outcome.attackerMinusCounters) : card)) } }
          : seat
      )
    };
  }

  if (outcome.trampleOverflow > 0) {
    nextSession = applyCombatDamageToTarget(nextSession, attackingCard.name, target, outcome.trampleOverflow, attackingCard, attackerSeatId);
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

// Without a session, this used to only send the card's NAME for anything on the stack — meaning
// an agent deciding whether to counter/answer something had to recognize the card from training
// data instead of reading what it actually does, the exact hallucination risk this codebase avoids
// everywhere else (e.g. the Rules Advisor's system prompt explicitly forbids it). Looking up the
// actual source card (still sitting in hand/command for an unresolved spell, or on the battlefield
// for a trigger source) lets the real oracle text ride along instead.
function pendingActionSourceCard(session: GameSession, action: PendingAction): VisibleCard | undefined {
  if (action.type === "spell") {
    const seat = session.seats.find((item) => item.id === action.actorSeatId);
    return action.sourceZone === "command"
      ? seat?.board.commander
      : action.sourceZone === "exile"
        ? seat?.board.exile?.find((card) => card.id === action.cardId)
        : seat?.board.hand.find((card) => card.id === action.cardId);
  }
  if (action.type === "trigger") {
    const seat = session.seats.find((item) => item.id === action.controllerSeatId);
    return seat?.board.battlefield.find((card) => card.id === action.sourceCardId);
  }
  return undefined;
}

function pendingActionSummary(session: GameSession, action: PendingAction) {
  return {
    id: action.id,
    type: action.type,
    actorSeatId: action.actorSeatId,
    cardName: "cardName" in action ? action.cardName : "sourceCardName" in action ? action.sourceCardName : undefined,
    oracleText: pendingActionSourceCard(session, action)?.oracleText,
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
    poison: seat.poison ?? 0,
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
    role: card.role,
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
    interpretedEffects: card.interpretedEffects,
    attachedToId: card.attachedToId,
    grantedKeywords: card.grantedKeywords,
    grantedProtectionColors: card.grantedProtectionColors,
    grantedTypes: card.grantedTypes,
    commander: card.commander,
    commanderTax: card.commanderTax,
    token: card.token
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
      triggers.push(
        makeCommonTrigger(enteringSeatId, seat.id, source, effect, `${source.name} triggers because ${enteredPermanent.name} entered the battlefield.`, enteredPermanent.id)
      );
    }
  }

  return triggers;
}

function findCommonTriggersForPermanentDied(
  session: GameSession,
  deadSeatId: string,
  deadCard: VisibleCard,
  attachedSourceIds?: string[]
): Array<Extract<PendingAction, { type: "trigger" }>> {
  if (!hasCardType(deadCard, "Creature")) return [];
  const triggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];

  for (const seat of session.seats) {
    const sources = [...seat.board.battlefield, ...(seat.id === deadSeatId ? [deadCard] : [])];
    for (const source of sources) {
      const dynamicCounterCount = source.id === deadCard.id ? plusOneCounterCount(deadCard) : undefined;
      const effect = commonTriggerEffect(source.oracleText, "died", dynamicCounterCount);
      if (!effect || !deathTriggerApplies(source, seat.id, deadCard, deadSeatId, attachedSourceIds)) continue;
      triggers.push(makeCommonTrigger(deadSeatId, seat.id, source, effect, `${source.name} triggers because ${deadCard.name} died.`));
    }
  }

  return triggers;
}

interface CastTriggerCondition {
  // Relative to the permanent's own controller — "you" only fires when its controller is the
  // caster, "opponent" only fires when the caster is a different seat, mirroring how real oracle
  // text is always written relative to whoever controls the triggered ability, not any fixed seat.
  relativity: "you" | "opponent";
  firstSpellOnly: boolean;
  spellTypeFilter?: "noncreature" | "instant_or_sorcery";
  effectClause: string;
}

// "Whenever you cast a[n] [type] spell, ..." / "Whenever an opponent casts their first spell each
// turn, ..." (Shark Typhoon, Murmuring Mystic, Mind's Dilation, ...) — a whole category of
// triggered abilities keyed to a spell being cast, distinct from the phase-triggered and ETB/death
// triggers this engine already models. "you"/"an opponent" is read relative to whichever seat
// controls the permanent bearing this text (checked by the caller against the actual caster), not
// hardcoded to any fixed player.
const CAST_TRIGGER_PATTERN = /^whenever (you cast|an opponent casts) (a|an|your first|their first)\s*((?:noncreature|instant or sorcery)\s+)?spells?(?: each turn)?,\s*(.+)$/i;

function parseCastTriggerCondition(clause: string): CastTriggerCondition | undefined {
  const match = clause.match(CAST_TRIGGER_PATTERN);
  if (!match) return undefined;
  const relativity = /^you/i.test(match[1]) ? "you" : "opponent";
  const firstSpellOnly = /first/i.test(match[2]);
  const typeWord = match[3]?.trim().toLowerCase();
  const spellTypeFilter = typeWord === "noncreature" ? "noncreature" : typeWord === "instant or sorcery" ? "instant_or_sorcery" : undefined;
  return { relativity, firstSpellOnly, spellTypeFilter, effectClause: match[4].trim() };
}

function spellMatchesCastTriggerFilter(card: VisibleCard, filter: CastTriggerCondition["spellTypeFilter"]): boolean {
  if (filter === "noncreature") return !card.typeLine.includes("Creature");
  if (filter === "instant_or_sorcery") return card.typeLine.includes("Instant") || card.typeLine.includes("Sorcery");
  return true;
}

// "Exile the top card of [that player]'s library. Until end of turn, you may cast that card
// without paying its mana cost if it's a nonland card." (Mind's Dilation) — cross-seat and
// cost-waiving in a way no generic TriggerEffect models (see the "impulse_cast_free" kind's own
// comment), so it's detected as its own bespoke shape rather than folded into the generic parsers.
function isImpulseCastFreeEffectClause(clause: string): boolean {
  return /\bexile the top card of (their|your) library\b/i.test(clause) && /\bwithout paying its mana cost\b/i.test(clause) && /\bnonland\b/i.test(clause);
}

function findCastTriggers(
  session: GameSession,
  casterSeatId: string,
  castCard: VisibleCard,
  isFirstSpellThisTurnForCaster: boolean
): Array<Extract<PendingAction, { type: "trigger" }>> {
  const triggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];

  for (const seat of session.seats) {
    for (const source of seat.board.battlefield) {
      for (const clause of oracleClauses(source.oracleText)) {
        if (isActivatedAbilityClause(clause)) continue;
        const condition = parseCastTriggerCondition(clause);
        if (!condition) continue;
        if (condition.relativity === "you" && seat.id !== casterSeatId) continue;
        if (condition.relativity === "opponent" && seat.id === casterSeatId) continue;
        if (condition.firstSpellOnly && !isFirstSpellThisTurnForCaster) continue;
        if (!spellMatchesCastTriggerFilter(castCard, condition.spellTypeFilter)) continue;

        if (isImpulseCastFreeEffectClause(condition.effectClause)) {
          triggers.push(
            makeCommonTrigger(casterSeatId, seat.id, source, { kind: "impulse_cast_free", fromSeatId: casterSeatId }, `${source.name} triggers because ${castCard.name} was cast.`)
          );
          continue;
        }

        // "X" in the effect text (Shark Typhoon's "create an X/X ... token, where X is that
        // spell's mana value") means the just-cast spell's own mana value, resolved here since only
        // this scan actually knows which spell was cast — commonTriggerEffect's parsers have no
        // other way to learn it.
        const effect = commonTriggerEffect(substituteX(condition.effectClause, castCard.manaValue), "clause");
        if (!effect) continue;
        triggers.push(makeCommonTrigger(casterSeatId, seat.id, source, effect, `${source.name} triggers because ${castCard.name} was cast.`));
      }
    }
  }

  return triggers;
}

function makeCommonTrigger(
  actorSeatId: string,
  controllerSeatId: string,
  source: VisibleCard,
  effect: TriggerEffect,
  message: string,
  contextCardId?: string
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
    contextCardId,
    message
  };
}

// Every "watches other permanents enter" phrasing this engine recognizes, checked most-specific
// first (so "nonland permanent"/"artifact creature" don't fall through to the more generic
// "permanent"/"creature"/"artifact" substrings that would also technically match). Generic across
// type words rather than hardcoded to creatures, and grantedTypes-aware (see typeGrants.ts) — so a
// permanent that's only an enchantment because of a separate static ability (Secret Arcade-style)
// still satisfies "an enchantment enters."
const ETB_WATCH_TYPE_WORDS = ["nonland permanent", "artifact creature", "creature", "artifact", "enchantment", "land", "planeswalker", "battle", "permanent"];

function cardHasWatchedType(card: VisibleCard, typeWord: string): boolean {
  if (typeWord === "permanent") return true;
  if (typeWord === "nonland permanent") return !isLandCard(card);
  if (typeWord === "artifact creature") return hasCardType(card, "Artifact") && hasCardType(card, "Creature");
  return hasCardType(card, typeWord.charAt(0).toUpperCase() + typeWord.slice(1));
}

function enteredTriggerApplies(source: VisibleCard, sourceSeatId: string, enteredCard: VisibleCard, enteredSeatId: string) {
  const text = source.oracleText.toLowerCase();
  if (!text.includes("enter")) return false;
  const underYourControl = enteredSeatId === sourceSeatId;
  const isAnother = source.id !== enteredCard.id;
  const selfEntered = source.id === enteredCard.id;

  // A self-referential clause ("when this creature/artifact/land/... enters") only ever applies to
  // the source's own entry — checked first and exclusively, so it can't also misfire off some
  // other permanent entering just because the text happens to contain a shared substring like
  // "creature enters" (a real, separate bug from the generic loop below: "when this creature
  // enters, draw a card" would otherwise ALSO fire every time any other creature enters, since
  // that loop's "creature enters" check doesn't know the "this" refers only to itself). Modern
  // oracle text templating dropped "the battlefield" (it's just "enters" now, confirmed against
  // the full card catalog: virtually every ETB clause omits it), so this doesn't require that
  // suffix either — the old version requiring "enters the battlefield" silently missed almost
  // every real self-ETB trigger.
  if (/\b(when|whenever)\s+this\b.{0,30}\benters?\b/.test(text)) return selfEntered;

  // Generic "watches other permanents enter" — find which type word the clause uses, confirm the
  // entering permanent actually has that type (printed or granted), then apply the same
  // another/unqualified and you-control heuristics regardless of which type word matched. An
  // unrestricted "a creature enters" (no "another") does apply to the source's own entry too, per
  // the real rule — only "another X enters" explicitly excludes self.
  const controlQualified = text.includes("under your control") || text.includes("you control");
  for (const typeWord of ETB_WATCH_TYPE_WORDS) {
    if (!cardHasWatchedType(enteredCard, typeWord)) continue;
    // Require "when"/"whenever" to actually precede "<type> enters" within the same sentence (bounded
    // by not crossing a period), the same fix as the self-referential branch above and for the same
    // reason — a plain `.includes("land enters")` also matches non-trigger static/reminder text that
    // happens to contain that substring, e.g. Dakmor Salvage's "This land enters tapped." (an ETB
    // replacement effect, not a trigger) or a Dredge reminder line, which made it fire — and draw a
    // card off its "you may [...] draw a card" reminder text — every time *any* land entered, not
    // just itself.
    // "another" tolerates 0-2 qualifier words before the type word (a "nontoken"/color/creature-
    // type adjective, ...) — same fix and reason as deathTriggerApplies' own "another creature"
    // pattern above: without it, e.g. "another nontoken creature enters" would silently fall
    // through to the unqualified anyPattern below, which has no self-exclusion at all.
    const anotherPattern = new RegExp(`\\b(?:when|whenever)\\b(?:(?!\\.).){0,60}\\banother(?:\\s+[a-z]+){0,2}\\s+${typeWord}(?: you control)? enters\\b`);
    const anyPattern = new RegExp(`\\b(?:when|whenever)\\b(?:(?!\\.).){0,60}\\b${typeWord}(?: you control)? enters\\b`);
    if (anotherPattern.test(text)) {
      if (!isAnother) return false;
      return controlQualified ? underYourControl : true;
    }
    if (anyPattern.test(text)) {
      return controlQualified ? underYourControl : true;
    }
  }
  return false;
}

function deathTriggerApplies(source: VisibleCard, sourceSeatId: string, deadCard: VisibleCard, deadSeatId: string, attachedSourceIds?: string[]) {
  const text = source.oracleText.toLowerCase();
  if (!text.includes("dies")) return false;
  const underYourControl = deadSeatId === sourceSeatId;
  const isAnother = source.id !== deadCard.id;

  // Same self-referential-clause fix as enteredTriggerApplies, and for the same reason: "when this
  // creature dies, draw a card" must not also fire when a DIFFERENT creature dies just because the
  // text contains the substring "creature dies".
  if (/\b(when|whenever)\s+this\b.{0,30}\bdies\b/.test(text)) return source.id === deadCard.id;

  // "Whenever equipped/enchanted creature dies, ..." (Skullclamp, ...) refers to whichever specific
  // creature THIS Equipment/Aura was actually attached to — checked before the generic "creature ...
  // dies" fallback below, which would otherwise match the substring "creature dies" inside "equipped
  // creature dies" and fire for every death on the board regardless of whether that creature was ever
  // actually equipped/enchanted by this one. Uses the attachedSourceIds snapshot captured at the
  // moment of death (destroyCreatures), not the live attachedToId — by the time this runs, the same
  // state-based-action pass that recorded the death has already cleared attachedToId on any Equipment
  // whose target is no longer on the battlefield, so the live value is always already gone.
  if (/\b(?:when|whenever)\b(?:(?!\.).){0,30}\b(?:equipped|enchanted) creature dies\b/.test(text)) {
    return attachedSourceIds?.includes(source.id) ?? false;
  }

  // Same "when/whenever must actually precede the phrase" fix as enteredTriggerApplies, and for the
  // same reason: a plain `.includes("creature dies")` also matches non-trigger text that happens to
  // contain that substring anywhere on the card, not just inside an actual "whenever ... dies" clause.
  // "another" tolerates 0-2 qualifier words before "creature" (Grim Haruspex's real text is
  // "another NONTOKEN creature you control dies" — without this, the extra word broke the match
  // entirely, silently falling through to the unqualified "creature ... dies" branch below, which
  // has no self-exclusion at all and let Grim Haruspex's own death satisfy its own "another creature"
  // trigger — the exact bug this fixes).
  if (/\b(?:when|whenever)\b(?:(?!\.).){0,60}\banother(?:\s+[a-z]+){0,2}\s+creature(?: you control)? dies\b/.test(text)) {
    if (!isAnother) return false;
    return text.includes("you control") ? underYourControl : true;
  }
  if (/\b(?:when|whenever)\b(?:(?!\.).){0,60}\bcreature(?: you control)? dies\b/.test(text)) {
    return text.includes("you control") ? underYourControl : true;
  }
  return false;
}


// "entered"/"died" derive the relevant text themselves (deathEffectText/etbEffectText), for callers
// passing a permanent's raw, full oracle text and asking "what does this do on death/ETB." "clause"
// skips that derivation and uses the given text as-is, for callers that already isolated exactly
// the relevant clause through some other mechanism — a phase-trigger's own text (phaseEffectText,
// e.g. a "declare attackers step" or "declare blockers step" trigger), a single modal mode's text,
// a loyalty ability's own effect text, or a generic activated ability's effect text. Passing
// already-isolated non-ETB text (e.g. "whenever ~ attacks, create a token") through "entered" here
// used to be harmless before etbEffectText was tightened to reject non-"enters" whenever-clauses
// (see isNonEtbWheneverClause) — after that change it silently strips the clause a second time and
// the trigger stops firing at all, which is exactly what broke Soaring Lightbringer's real "whenever
// it attacks" trigger (and any modal mode/loyalty ability/generic ability effect shaped the same
// way) as a side effect of fixing its ETB misclassification.
function commonTriggerEffect(oracleText: string, mode: "entered" | "died" | "clause", dynamicCounterCount?: number): TriggerEffect | undefined {
  const relevantText = mode === "died" ? deathEffectText(oracleText) : mode === "clause" ? oracleText : etbEffectText(oracleText);
  const text = relevantText.toLowerCase();
  // A single text-wide "you may" check rather than per-match position tracking — good enough for
  // this engine's one-effect-per-clause parsing (see the module comment on TriggerEffect); a card
  // with multiple clauses where only one is optional would be mis-flagged, a declared simplification.
  const optional = /\byou may\b/.test(text) || undefined;
  const tokenSpecs = parseCreateTokenSpecs(relevantText, dynamicCounterCount);
  if (tokenSpecs.length > 0) return { kind: "create_tokens", tokens: tokenSpecs, optional };

  const gainLife = text.match(/\byou gain\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\b/);
  if (gainLife) {
    const amount = numberWordToInt(gainLife[1]);
    if (amount) return { kind: "gain_life", amount, optional };
  }

  const loseLife = text.match(/\byou lose\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\b/);
  if (loseLife) {
    const amount = numberWordToInt(loseLife[1]);
    if (amount) return { kind: "lose_life", amount, optional };
  }

  // Checked before the plain draw count below: "Draw a card, then put a card from your hand on top
  // of your library." (Aminatou, the Fateshifter's +1) is a compound effect — matching it as plain
  // draw_cards first (extractCommonDrawCount would happily match the "draw a card" prefix) silently
  // dropped the "put back" half, since commonTriggerEffect only ever returns one effect per clause.
  const drawThenPutBack = text.match(
    /\bdraw\s+(a|one|two|three|four|five|\d+)\s+cards?,?\s*then put\s+(a|one|two|three|four|five|\d+)\s+cards?\s+from your hand on top of your library\b/
  );
  if (drawThenPutBack) {
    const drawAmount = numberWordToInt(drawThenPutBack[1]);
    const putBackAmount = numberWordToInt(drawThenPutBack[2]);
    if (drawAmount && putBackAmount) return { kind: "draw_then_put_back", drawAmount, putBackAmount, optional };
  }

  const drawCount = extractCommonDrawCount(text);
  if (drawCount) return { kind: "draw_cards", amount: drawCount, optional };

  // "put a +1/+1 counter on this creature" (self) / "...on target creature (you control)?" — this
  // engine has no generic targeted-trigger choice UI, so "target creature" resolves through the
  // same deterministic heuristic used for removal-spell targeting (see chooseCounterTarget). In
  // "entered" mode only, "on it"/"on that creature" (Cathars' Crusade-style: "whenever a creature
  // enters the battlefield under your control, put a +1/+1 counter on it") refers to the entering
  // permanent, not the trigger source — that shape doesn't make sense for a death trigger, since
  // the dying creature is gone and can't receive a counter, so it's excluded there.
  const counterPattern =
    mode === "entered"
      ? /\bput (a|one|two|three|four|five|\d+) (\+1\/\+1|-1\/-1) counters? on (this creature|that creature|it|target creature(?: you control)?)\b/
      : /\bput (a|one|two|three|four|five|\d+) (\+1\/\+1|-1\/-1) counters? on (this creature|target creature(?: you control)?)\b/;
  const counterMatch = text.match(counterPattern);
  if (counterMatch) {
    const amount = numberWordToInt(counterMatch[1]);
    if (amount) {
      const counterKind = counterMatch[2] as "+1/+1" | "-1/-1";
      const rawScope = counterMatch[3];
      const scope =
        rawScope === "this creature"
          ? "self"
          : rawScope === "that creature" || rawScope === "it"
            ? "context"
            : rawScope.includes("you control")
              ? "target_creature_you_control"
              : "target_creature";
      return { kind: "add_counter", counterKind, amount, scope, optional };
    }
  }

  // "create a token that's a copy of it" (context — the permanent that triggered this, e.g. Ondu
  // Spiritdancer) / "...of this creature/artifact/enchantment/permanent/land/planeswalker" (self).
  // Deliberately narrow, matching this codebase's pattern elsewhere: a trailing "except it's also
  // X..." modifier (extremely common on copy effects) changes what gets copied in a way this
  // doesn't model, so it's declined rather than guessed at; likewise "of target X" (needs generic
  // targeting this engine doesn't have) and "of that card/permanent" referring to something
  // established in an earlier, separate clause.
  const copyMatch = text.match(/\bcreate a token that'?s a copy of (it|itself|this (?:creature|artifact|enchantment|permanent|land|planeswalker))\b(?!,?\s*except)/);
  if (copyMatch) {
    return { kind: "copy_token", scope: copyMatch[1] === "it" || copyMatch[1] === "itself" ? "context" : "self", optional };
  }

  return undefined;
}

// A trailing "Do this only once each turn."/"Activate only once each turn." sentence is a generic
// limiter this engine enforces via a per-source-per-turn dedup key, the same shape as the
// loyalty-ability-once-per-turn tracker.
function hasOnceEachTurnLimiter(oracleText: string): boolean {
  return /\b(?:do this|activate(?: this ability)?) only once (?:each|per) turn\b/i.test(oracleText);
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
  // Run state-based actions before checking ETB-trigger applicability for the same reason as the
  // spell-resolution pipeline: a created token that only becomes (e.g.) an enchantment via a
  // separate static ability needs grantedTypes computed before "an enchantment enters" watchers
  // (including the token's own) can recognize it.
  const sbaCheckedSession = checkStateBasedActions(nextSession);
  const triggers = createdTokens.flatMap((token) => findCommonTriggersForPermanentEntered(sbaCheckedSession, seatId, token));
  return { session: sbaCheckedSession, createdTokens, triggers };
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

// A token copy takes the source's copiable values (name, type line, oracle text, mana cost/value,
// colors, power/toughness) — not its current counters, attachments, or any other continuous-effect
// state (rule 707.2), so a fresh minimal object is correct here rather than spreading `source`.
// Types granted by a separate static ability (e.g. Secret Arcade) aren't copied either; they'll
// apply fresh to the token on its own if it also matches that effect's scope, via the same
// grantedTypes recompute every other permanent goes through.
function createCopyTokenForSeat(session: GameSession, seatId: string, source: VisibleCard): { session: GameSession; token: VisibleCard } {
  const token: VisibleCard = {
    id: `${seatId}-token-${crypto.randomUUID()}`,
    name: source.name,
    typeLine: source.typeLine,
    oracleText: source.oracleText,
    manaCost: source.manaCost,
    manaValue: source.manaValue,
    colors: source.colors,
    colorIdentity: source.colorIdentity,
    role: source.role,
    zone: "battlefield",
    token: true,
    tokenSourceCardId: source.id,
    ownerSeatId: seatId,
    power: source.power,
    toughness: source.toughness,
    summoningSick: source.typeLine.includes("Creature")
  };
  const nextSession: GameSession = {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === seatId
        ? { ...seat, board: { ...seat.board, battlefield: [...seat.board.battlefield, token] }, zones: { ...seat.zones, battlefield: seat.zones.battlefield + 1 } }
        : seat
    )
  };
  return { session: nextSession, token };
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
    // "For each 1 damage prevented this way, create a ... token" (Inkshield, ...) — a dynamic count
    // based on something this engine doesn't track (only the counters-on-source basis above is
    // modeled). The word captured right before "creature token(s)" in that shape is just the article
    // from "create a ... token," not the real count, so using it as a literal "1" silently created
    // exactly one token regardless of how much damage was actually prevented — and since there's no
    // damage-prevention-shield mechanic in this engine at all yet, no damage was ever prevented
    // either. Declining the token creation here (rather than confidently guessing "1") at least
    // avoids a misleadingly-partial resolution; the missing prevention effect itself is a real,
    // separate gap, not something this narrow parser can fix.
    const precedingText = normalized.slice(Math.max(0, (match.index ?? 0) - 80), match.index ?? 0);
    const hasUnmodeledDynamicCount = /\bfor each\b/i.test(precedingText) && !dynamicCounterCountPattern.test(precedingText) && !dynamicCounterCountPattern.test(description);
    if (hasUnmodeledDynamicCount) continue;
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

// Generic circuit breaker, not specific to any one card: a self-copying permanent whose "only
// once each turn" restriction is scoped to the specific object (not the player or card name) can
// genuinely recurse forever in real rules — each token copy is a fresh object that hasn't used its
// own restriction yet. This engine auto-resolves "you may" as yes with no player-facing loop-count
// prompt, so without a hard stop that would actually hang on an unbounded setTimeout chain rather
// than modeling "the player gets to choose when to stop." 400/turn is well above any realistic
// non-looping turn (checked against normal SBA/ETB-trigger volumes elsewhere in this engine) but
// low enough to stop fast. Same "guard counter" pattern as checkStateBasedActions' pass limit.
const MAX_TRIGGER_RESOLUTIONS_PER_TURN = 400;

function resolveTriggerEffect(session: GameSession, trigger: Extract<PendingAction, { type: "trigger" }>): GameSession {
  const chainCount = (session.triggerChainGuard?.turn === session.turn ? session.triggerChainGuard.count : 0) + 1;
  session = { ...session, triggerChainGuard: { turn: session.turn, count: chainCount } };
  if (chainCount > MAX_TRIGGER_RESOLUTIONS_PER_TURN) {
    return {
      ...session,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: trigger.controllerSeatId,
          message: `${trigger.sourceCardName}'s trigger is not resolved — over ${MAX_TRIGGER_RESOLUTIONS_PER_TURN} triggered abilities have already resolved this turn, which likely means an unbounded loop. Stopping here.`,
          detail: "Rules action"
        },
        ...session.events
      ]
    };
  }

  const seatName = session.seats.find((seat) => seat.id === trigger.controllerSeatId)?.name ?? "Player";
  if (trigger.effect.kind === "draw_cards") {
    return drawMultipleForSeat(session, trigger.controllerSeatId, trigger.effect.amount, `${trigger.sourceCardName} trigger resolves. ${seatName} draws ${trigger.effect.amount} card${trigger.effect.amount === 1 ? "" : "s"}.`);
  }
  if (trigger.effect.kind === "draw_then_put_back") {
    return applyDrawXThenPutBack(session, trigger.controllerSeatId, trigger.sourceCardName, trigger.effect.drawAmount, trigger.effect.putBackAmount);
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
  if (trigger.effect.kind === "add_counter") {
    const { counterKind, amount, scope } = trigger.effect;
    // "self" looks up the trigger source itself; "context" looks up the permanent "it"/"that
    // creature" referred to (the entering permanent — not always the source, e.g. Cathars'
    // Crusade watches OTHER creatures enter). Neither is a chosen target, so both search the
    // battlefield for that exact card rather than going through chooseCounterTarget's heuristic.
    let target: { seatId: string; card: VisibleCard } | undefined;
    if (scope === "self" || scope === "context") {
      const lookupId = scope === "self" ? trigger.sourceCardId : trigger.contextCardId;
      for (const seat of session.seats) {
        const card = lookupId ? seat.board.battlefield.find((item) => item.id === lookupId) : undefined;
        if (card) {
          target = { seatId: seat.id, card };
          break;
        }
      }
    } else {
      target = chooseCounterTarget(session, trigger.controllerSeatId, counterKind, scope === "target_creature_you_control");
    }
    if (!target) {
      return {
        ...session,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: trigger.controllerSeatId,
            message: `${trigger.sourceCardName} trigger finds no legal target and has no effect.`
          },
          ...session.events
        ]
      };
    }
    return {
      ...session,
      seats: session.seats.map((seat) =>
        seat.id === target.seatId
          ? { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === target.card.id ? applyCounterDelta(card, counterKind, amount) : card)) } }
          : seat
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: trigger.controllerSeatId,
          message: `${trigger.sourceCardName} trigger resolves. ${target.card.name} gets ${amount === 1 ? "a" : amount} ${counterKind} counter${amount === 1 ? "" : "s"}.`
        },
        ...session.events
      ]
    };
  }
  if (trigger.effect.kind === "copy_token") {
    const sourceCard = session.seats.find((seat) => seat.id === trigger.controllerSeatId)?.board.battlefield.find((card) => card.id === trigger.sourceCardId);
    const onceKey = `${session.turn}:${trigger.sourceCardId}:copy_token`;
    if (sourceCard && hasOnceEachTurnLimiter(sourceCard.oracleText) && session.onceEachTurnEffectsUsed?.includes(onceKey)) {
      return {
        ...session,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: trigger.controllerSeatId,
            message: `${trigger.sourceCardName} has already done this once this turn.`
          },
          ...session.events
        ]
      };
    }

    const lookupId = trigger.effect.scope === "self" ? trigger.sourceCardId : trigger.contextCardId;
    let copySource: { seatId: string; card: VisibleCard } | undefined;
    for (const seat of session.seats) {
      const card = lookupId ? seat.board.battlefield.find((item) => item.id === lookupId) : undefined;
      if (card) {
        copySource = { seatId: seat.id, card };
        break;
      }
    }
    if (!copySource) {
      return {
        ...session,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: trigger.controllerSeatId,
            message: `${trigger.sourceCardName} trigger finds nothing to copy and has no effect.`
          },
          ...session.events
        ]
      };
    }

    const markedSession =
      sourceCard && hasOnceEachTurnLimiter(sourceCard.oracleText)
        ? { ...session, onceEachTurnEffectsUsed: [...(session.onceEachTurnEffectsUsed ?? []), onceKey] }
        : session;
    const { session: copiedSession } = createCopyTokenForSeat(markedSession, trigger.controllerSeatId, copySource.card);
    return {
      ...copiedSession,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: trigger.controllerSeatId,
          message: `${trigger.sourceCardName} trigger resolves. ${seatName} creates a token that's a copy of ${copySource.card.name}.`,
          detail: "Rules action"
        },
        ...copiedSession.events
      ]
    };
  }
  if (trigger.effect.kind === "impulse_cast_free") {
    const impulseEffect = trigger.effect;
    const fromSeat = session.seats.find((seat) => seat.id === impulseEffect.fromSeatId);
    const library = fromSeat?.library ?? [];
    if (!fromSeat || library.length === 0) {
      return {
        ...session,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: trigger.controllerSeatId,
            message: `${trigger.sourceCardName} triggers, but ${fromSeat?.name ?? "that player"} has no cards left in their library to exile.`
          },
          ...session.events
        ]
      };
    }
    const [topCard, ...restLibrary] = library;
    const isLand = isLandCard(topCard);
    const exiledCard: VisibleCard = {
      ...resetForZoneChange(topCard, "exile"),
      ownerSeatId: topCard.ownerSeatId ?? fromSeat.id,
      exiledPlayableBySeatId: isLand ? undefined : trigger.controllerSeatId,
      exiledPlayableUntilTurn: session.turn,
      exiledPlayableFree: !isLand
    };
    return {
      ...session,
      seats: session.seats.map((seat) => {
        const isFromSeat = seat.id === fromSeat.id;
        const isControllerSeat = seat.id === trigger.controllerSeatId;
        if (!isFromSeat && !isControllerSeat) return seat;
        let next = seat;
        if (isFromSeat) {
          next = { ...next, library: restLibrary, zones: { ...next.zones, library: Math.max(0, next.zones.library - 1) } };
        }
        if (isControllerSeat) {
          next = { ...next, board: { ...next.board, exile: [...(next.board.exile ?? []), exiledCard] }, zones: { ...next.zones, exile: next.zones.exile + 1 } };
        }
        return next;
      }),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: trigger.controllerSeatId,
          message: `${trigger.sourceCardName} exiles ${exiledCard.name} from ${fromSeat.name}'s library.${isLand ? "" : " Playable this turn without paying its mana cost."}`
        },
        ...session.events
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
  return action.sourceZone === "command"
    ? actor?.board.commander
    : action.sourceZone === "exile"
      ? actor?.board.exile?.find((card) => card.id === action.cardId)
      : actor?.board.hand.find((card) => card.id === action.cardId);
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
    if (choice.kind === "optional_trigger") {
      return {
        kind: "optional_trigger" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt
      };
    }
    if (choice.kind === "discard_to_hand_size") {
      return {
        kind: "discard_to_hand_size" as const,
        prompt: choice.prompt,
        hand: humanSeat.board.hand,
        requiredDiscards: choice.requiredDiscards
      };
    }
    if (choice.kind === "choose_creature_type") {
      return {
        kind: "choose_creature_type" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        currentChoice: humanSeat.board.battlefield.find((card) => card.id === choice.sourceCardId)?.chosenCreatureType
      };
    }
    if (choice.kind === "choose_color") {
      return {
        kind: "choose_color" as const,
        sourceCardName: choice.sourceCardName,
        prompt: choice.prompt,
        excludedColor: choice.excludedColor,
        currentChoice: humanSeat.board.battlefield.find((card) => card.id === choice.sourceCardId)?.chosenColor
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

// Shallow-copies power/toughness onto their current effective values (counters, static buffs, ...)
// so a view built from this reads the same numbers combat math will actually use — the raw
// card.power/toughness strings are what's printed on the card, not what's currently true.
function withEffectiveStats(card: VisibleCard): VisibleCard {
  return {
    ...card,
    power: card.power !== undefined ? String(effectivePower(card)) : card.power,
    toughness: card.toughness !== undefined ? String(effectiveToughness(card)) : card.toughness
  };
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
    attackingCard: withEffectiveStats(attackingCard),
    blockers: defender.board.battlefield.filter((card) => canBlock(card, attackingCard)).map(withEffectiveStats)
  };
}

function ruleChoiceLabel(choice: PendingRuleChoice) {
  if (choice.kind === "order_triggers") return "phase triggers";
  if (choice.kind === "discard_to_hand_size") return "discarding to hand size";
  return choice.sourceCardName;
}

function chooseAgentLibraryCardForRuleChoice(seat: PlayerSeat, choice: Extract<PendingRuleChoice, { kind: "choose_card_from_library" }>) {
  const library = seat.library ?? [];
  if (library.length === 0) return undefined;
  const filter = choice.allowedCardFilter?.toLowerCase() ?? "";
  if (filter.includes("basic land")) {
    return library.find((card) => isBasicLandCard(card)) ?? library[0];
  }
  // A search restricted to a specific card type (Fauna Shaman's "creature card," an activated
  // ability's SearchLibraryEffect.cardTypeFilter, ...) — prefer a matching card over the generic
  // destination-based fallback below. The spell-level Rules Advisor's own allowedCardFilter is a
  // free-text phrase ("cards matching the source effect"), not a type word, so this simply never
  // matches for that path and falls through unchanged.
  if (filter && !/^cards?$/.test(filter)) {
    const typeMatch = library.find((card) => card.typeLine.toLowerCase().includes(filter));
    if (typeMatch) return typeMatch;
  }
  // A graveyard-bound tutor (Entomb, Buried Alive, ...) is almost always paired with reanimation,
  // so it gets the same "prefer a creature" bias as a battlefield-bound one rather than the generic
  // hand-tutor fallback below.
  if (choice.destination === "battlefield" || choice.destination === "graveyard") {
    return library.find((card) => card.typeLine.includes("Creature")) ?? library.find((card) => !card.typeLine.includes("Instant") && !card.typeLine.includes("Sorcery")) ?? library[0];
  }
  return library.find((card) => !isLandCard(card)) ?? library[0];
}

function shouldConsultRulesAdvisor(event: string, card: VisibleCard) {
  if (event === "activated_ability") return true;
  // Scope the pattern match to the card's own standing/triggered text, not text describing what an
  // OPTIONAL activated ability's cost or effect does — e.g. Phyrexian Tower's "{T}, Sacrifice a
  // creature: Add {B}{B}." contains "sacrifice", but that's a cost the controller chooses to pay,
  // not something that happens on its own. Without this, playing the land at all (event
  // "land_played") would consult the advisor purely because that word appears somewhere on the
  // card, with nothing relevant for the advisor to actually resolve — and an LLM asked "what should
  // happen" about a card whose only matching text is a sacrifice cost can hallucinate an actual
  // sacrifice.
  const text = oracleClauses(card.oracleText)
    .filter((clause) => !isActivatedAbilityClause(clause))
    .join(" ")
    .toLowerCase();
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

function phaseTriggerTextMatches(text: string, phase: TurnPhase) {
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

function hasPhaseTrigger(card: VisibleCard, phase: TurnPhase) {
  return mergeModalBulletClauses(oracleClauses(card.oracleText)).some(
    (clause) => !isActivatedAbilityClause(clause) && phaseTriggerTextMatches(clause.toLowerCase(), phase)
  );
}

// Isolates just the clause(s) that actually match this phase's trigger condition, so the
// deterministic parsers below don't misread some unrelated ability on the same card — same
// "clause, not whole card" discipline as etbEffectText/deathEffectText. mergeModalBulletClauses
// runs first so a recurring modal trigger's header ("At the beginning of your end step, choose
// one —") and its bullet modes survive together as one clause (see its own doc comment) — without
// it, the header alone contains the phase-trigger wording this filter matches on, and the bullets
// alone contain the actual effect text, so a plain per-line filter would keep one and drop the
// other, losing Abiding Grace-style recurring choices entirely.
function phaseEffectText(oracleText: string, phase: TurnPhase): string {
  return mergeModalBulletClauses(oracleClauses(oracleText))
    .filter((clause) => !isActivatedAbilityClause(clause) && phaseTriggerTextMatches(clause.toLowerCase(), phase))
    .join(" ");
}

function phaseEventName(phase: TurnPhase) {
  return `${phase.replace(/ /g, "_")}_trigger`;
}

// Phase-triggered permanent abilities (upkeep, draw step, combat, ...) already resolve immediately
// in this engine, with no stack/priority window — a pre-existing simplification, not something new
// here. This just extends that same immediate-resolution model to check the deterministic zone-
// effect/removal/common-trigger parsers first, so a card like Virtue of Persistence ("At the
// beginning of your upkeep, put target creature card from a graveyard onto the battlefield under
// your control") is handled correctly instead of only ever reaching the Rules Advisor's narrow
// search/scry/draw workflow classifier — which has no concept of reanimation at all. An optional
// ("you may") phase trigger resolves as yes here rather than getting a real prompt, matching phase
// triggers' existing no-stack model (they had no chance to decline before this change either).
function applyDeterministicPhaseTrigger(session: GameSession, seatId: string, sourceCard: VisibleCard, phase: TurnPhase): GameSession | undefined {
  const clauseText = phaseEffectText(sourceCard.oracleText, phase);
  if (!clauseText.trim()) return undefined;

  // "At the beginning of your upkeep, if you control no Thopters other than this creature, return
  // this creature to its owner's hand and create five ... tokens" (Thopter Assembly, ...) — none of
  // the parsers below understand a leading "if ~," condition gating the whole effect, so without
  // this guard they'd confidently apply the effect (here: create the tokens) every single time the
  // phase comes around regardless of whether the condition is actually met. Declining routes it to
  // the Rules Advisor instead, which can actually read and evaluate the condition, rather than
  // silently doing a partially-wrong deterministic thing. "You may" isn't caught by this — it's
  // already handled as an optional trigger, not a gating condition.
  if (/^if\b/i.test(clauseText.replace(/^at the beginning of[^,]*,\s*/i, ""))) return undefined;

  const removalEffect = parseRemovalEffect(clauseText);
  if (removalEffect) return applyRemovalEffect(session, seatId, sourceCard.name, sourceCard, removalEffect);

  // Checked before the generic modal fallback below: a "put a counter on self / cash in once you
  // have enough of them" choose-one (Idol of Oblivion, ...) parses as zero generic modes (see
  // parseCounterAccumulationTrigger's own comment on why), which would otherwise fall all the way
  // through to the Rules Advisor's fixed workflow enum — which has no "add a counter" or
  // "conditional payoff" shape either, so the trigger silently no-ops as manual_review forever.
  const counterAccumulation = parseCounterAccumulationTrigger(clauseText, sourceCard.name);
  if (counterAccumulation) return applyCounterAccumulationEffect(session, seatId, sourceCard, counterAccumulation);

  // "At the beginning of your end step, choose one — ..." (Abiding Grace, ...) — a recurring modal
  // trigger, same non-removal-shaped-modes handling as the one-shot spell/ETB case in
  // resolvePendingAction, just re-evaluated fresh every time this phase comes around (chosen mode
  // isn't "locked in" the way chosenCreatureType is — nothing here suggests it should be). No
  // chosenX exists for a recurring phase trigger (it isn't a spell being cast), so X-based modes
  // are declined here the same way they always were before X support existed.
  const genericModalEffect = !removalEffect ? parseGenericModalEffect(clauseText, undefined) : undefined;
  if (genericModalEffect) return applyGenericModalEffect(session, seatId, sourceCard, genericModalEffect);

  const pumpEffect = parseTargetedPump(clauseText);
  if (pumpEffect) return applyTargetedPumpEffect(session, seatId, sourceCard, pumpEffect);

  const zoneEffect = parseZoneEffect(clauseText);
  if (zoneEffect) return applyZoneEffect(session, seatId, sourceCard.name, zoneEffect);

  const commonEffect = commonTriggerEffect(clauseText, "clause");
  if (commonEffect) {
    const trigger = makeCommonTrigger(seatId, seatId, sourceCard, commonEffect, `${sourceCard.name}'s ${phase} trigger resolves.`);
    return resolveTriggerEffect(session, trigger);
  }

  return undefined;
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
  const card =
    action.sourceZone === "command"
      ? actor?.board.commander
      : action.sourceZone === "exile"
        ? actor?.board.exile?.find((item) => item.id === action.cardId)
        : actor?.board.hand.find((item) => item.id === action.cardId);
  if (!card) return "graveyard";
  return card.typeLine.includes("Instant") || card.typeLine.includes("Sorcery") ? "graveyard" : "battlefield";
}

function isLandCard(card: VisibleCard) {
  return card.typeLine.includes("Land") || card.role === "land";
}

// Rule 205.2j: an object is historic if it's an artifact, a Saga (or other subtype with the same
// carve-out), or has the legendary supertype — legendary creatures/enchantments/planeswalkers all
// qualify via "Legendary" appearing in the type line, not just legendary artifacts.
function isHistoricCard(card: VisibleCard) {
  return card.typeLine.includes("Artifact") || card.typeLine.includes("Legendary") || card.typeLine.includes("Saga");
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
  // A transform card's back face (Westvale Abbey -> Ormendahl, Profane Prince; any other
  // permanent that flips into something else via an in-play ability) is never castable from hand
  // — Scryfall represents that by leaving its manaCost empty, unlike a genuine modal DFC land
  // (Zendikar Rising-style "land // spell") whose spell face always carries a real printed cost.
  // Without this check, a transform land's non-land back face was indistinguishable from a real
  // "play this land, or cast this spell instead" choice and got offered as castable for {0}.
  if (!first.typeLine.includes("Land") && second.typeLine.includes("Land") && first.manaCost) {
    return { spellFace: first, spellIndex: 0, landFace: second, landIndex: 1 };
  }
  if (first.typeLine.includes("Land") && !second.typeLine.includes("Land") && second.manaCost) {
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
  return seat.board.battlefield.filter((card) => isAvailableManaSource(card, seat)).reduce((total, source) => total + manaProducedBy(source, seat), 0);
}

// This app has no interactive "choose X" prompt, so both agents and humans default to the
// largest X they can currently afford — the alternative (no default) is what caused the reported
// bug: X-cost cards carry manaValue 0 (the Scryfall off-stack convention), so with no X selection
// at all they were always "free" to cast regardless of available mana.
// Multikicker's per-kick cost stands in for xCount when the card has no {X} of its own — see
// parseMultikickerCost's comment for why reusing chosenX for "times kicked" is safe here.
function xOrMultikickerUnitCost(card: VisibleCard): number {
  const xCount = xSymbolCount(card.manaCost);
  return xCount > 0 ? xCount : (parseMultikickerCost(card.oracleText) ?? 0);
}

function maxAffordableX(seat: PlayerSeat, card: VisibleCard, fixedCost: number, pool?: ManaPool): number {
  const unitCost = xOrMultikickerUnitCost(card);
  if (unitCost === 0) return 0;
  // fixedCost already had up to card.manaValue worth of any pending cost reduction subtracted
  // (adjustedCastingCost, called by every caller before this). A reduction bigger than the card's
  // non-X cost has leftover value that a flat-cost card would simply waste — for an X spell that
  // leftover instead buys extra X, since {X} contributes to the same generic total a reduction
  // discounts (e.g. Crackle with Power at {X}{R}{R}{R}: 10 artifacts discounts the 3 fixed RRR down
  // to paying just RRR, then the remaining 7 becomes 7 more X the player didn't have to tap for).
  const leftoverReduction = Math.max(0, pendingArtifactAffinityReduction(seat) - card.manaValue);
  const budget = availableManaForSeat(seat, pool) - fixedCost + leftoverReduction;
  return budget > 0 ? Math.floor(budget / unitCost) : 0;
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
  const sources = seat.board.battlefield.filter((source) => isAvailableManaSource(source, seat));
  const chosen = new Set<string>();
  const pool = emptyManaPool();

  for (const color of ["W", "U", "B", "R", "G"] as ColoredMana[]) {
    for (let needed = requirement.colors[color]; needed > 0; needed -= 1) {
      const source = sources.find((candidate) => !chosen.has(candidate.id) && manaChoicesForCard(candidate, seat).includes(color));
      if (!source) return { ok: false as const, sourceIds: [...chosen], reason: `missing ${color} mana` };
      chosen.add(source.id);
      pool[color] += manaProducedBy(source, seat);
    }
  }

  while (manaPoolTotal(pool) < totalCost) {
    const source = sources.find((candidate) => !chosen.has(candidate.id));
    if (!source) return { ok: false as const, sourceIds: [...chosen], reason: `missing ${totalCost - manaPoolTotal(pool)} generic mana` };
    chosen.add(source.id);
    const choices = manaChoicesForCard(source, seat);
    const color = choices.includes("C") ? "C" : choices[0] ?? "C";
    pool[color] += manaProducedBy(source, seat);
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
  // When manaCost is absent (older card catalogs didn't store it), approximate pips from the
  // card's own cast colors ONLY — never colorIdentity, which also counts ability/back-face colors
  // and turned {2} artifacts like Talisman of Progress into a fake {W}{U} requirement.
  if (symbols.length === 0 && totalCost > 0 && card.colors && card.colors.length > 0) {
    for (const color of normalizeManaColors(card.colors)) {
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

// Aminatou, Veil Piercer does not discount normal casting from hand — she grants miracle instead,
// handled by the miracle-offer flow. sourceZone/activeSeatId are currently unused by either cost
// reduction this applies (Saheeli's one-turn artifact affinity grant, staticCostReduction's
// permanent-granted discounts) but kept in the signature for future zone- or turn-scoped reductions.
function adjustedCastingCost(seat: PlayerSeat, card: VisibleCard, baseCost: number, sourceZone: "hand" | "command" | "exile", activeSeatId: string | undefined) {
  // Mind's Dilation-style "you may cast that card without paying its mana cost" — the exile-play
  // permission itself already gates which zone/seat may cast it (see playCard's existing exile
  // checks); this only waives the cost on top of that, and only while actually casting from exile.
  if (sourceZone === "exile" && card.exiledPlayableFree) return 0;
  return Math.max(0, baseCost - pendingArtifactAffinityReduction(seat) - staticCostReduction(seat, card));
}

function artifactCount(seat: PlayerSeat) {
  return seat.board.battlefield.filter((card) => card.typeLine.includes("Artifact")).length;
}

// "[Qualifier] spells you cast cost {N} less to cast." (Goblin Anarchomancer, Herald's Horn,
// Urza's Incubator, ...) — a static discount granted by a permanent on the caster's own
// battlefield, stacking across every matching source the same way real Magic cost reducers do.
// Before this, the only cost reduction this engine modeled at all was Saheeli's one-turn artifact
// affinity grant (pendingArtifactAffinityReduction) — every always-on reducer from a permanent was
// silently ignored, so those cards did nothing. Deliberately narrow, matching this codebase's other
// deterministic parsers: only a flat generic discount is recognized (not "costs {1} less to cast
// for each artifact you control"-style text printed on the spell itself, which needs to read the
// spell's own oracle text rather than a granting permanent's, and not effects that reduce colored
// mana symbols specifically — rule 601.2f, generic-only, matches the existing Saheeli handling).
// Eminence (The Ur-Dragon, Kaseto, ...) is specifically the ability keyword for "this static effect
// works from the command zone too, not just the battlefield" — the commander sits in
// seat.board.commander until actually cast, at which point it moves to the battlefield and this
// check naturally picks it up from there instead (never both at once), so this can't double-count.
function staticCostReduction(seat: PlayerSeat, card: VisibleCard): number {
  const commander = seat.board.commander;
  const commanderReduction = commander && /\beminence\b/i.test(commander.oracleText) ? parseGrantedCostReduction(commander, card) : 0;
  return commanderReduction + seat.board.battlefield.reduce((total, source) => total + parseGrantedCostReduction(source, card), 0);
}

// "[Qualifier] spells [you cast ]cost {N} less to cast." and its "of the chosen type" tribal
// variant (Urza's Incubator: "Creature spells of the chosen type cost {2} less to cast."; Herald's
// Horn: "Creature spells you cast of the chosen type cost {1} less to cast.") — the latter only
// applies once the source has locked in a chosenCreatureType (see pickChosenCreatureType) and the
// cast card's type line includes that type. Morophon's colored-pip reduction ("cost {W}{U}{B}{R}{G}
// less to cast") isn't a flat generic amount and is deliberately left unparsed, same "narrow,
// well-templated shapes only" boundary as the rest of this codebase's cost-reduction parsing.
// Eminence-keyworded commanders (The Ur-Dragon, Kaseto, ...) print this same reduction with a
// leading "Eminence — As long as ~ is in the command zone or on the battlefield, other" preamble —
// matched via the "start of clause OR right after a comma" alternation below, with a leading
// "other" stripped from the qualifier itself, rather than requiring the whole clause to be nothing
// but the reduction sentence. Without this, an Eminence card's reduction never matched at all (not
// a colored-vs-generic-mana issue — rule 601.2f generic-only scope is still correct and unchanged,
// the clause was silently declined outright regardless of the cast card's cost).
function parseGrantedCostReduction(source: VisibleCard, castCard: VisibleCard): number {
  const clauses = source.oracleText.split("\n").map((line) => line.trim()).filter(Boolean);
  let total = 0;
  for (const clause of clauses) {
    const match = clause.match(/(?:^|,\s*)(?:other\s+)?(?:([a-z][a-z ]*?)\s+)?spells(?:\s+you cast)?(?:\s+of the chosen type)?(?:\s+you cast)? cost \{(\d+)\} less to cast\.?$/i);
    if (!match) continue;
    const qualifier = (match[1] ?? "").toLowerCase().trim();
    const amount = Number.parseInt(match[2], 10);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (/\bof the chosen type\b/i.test(clause)) {
      if (!source.chosenCreatureType || !castCard.typeLine.includes(source.chosenCreatureType)) continue;
    }
    if (qualifier === "" || matchesCostReductionQualifier(qualifier, castCard)) total += amount;
  }
  return total;
}

function matchesCostReductionQualifier(qualifier: string, card: VisibleCard): boolean {
  if (qualifier === "creature") return card.typeLine.includes("Creature");
  if (qualifier === "noncreature") return !card.typeLine.includes("Creature");
  if (qualifier === "instant and sorcery" || qualifier === "instant or sorcery") return card.typeLine.includes("Instant") || card.typeLine.includes("Sorcery");
  if (qualifier === "artifact") return card.typeLine.includes("Artifact");
  if (qualifier === "enchantment") return card.typeLine.includes("Enchantment");
  if (qualifier === "planeswalker") return card.typeLine.includes("Planeswalker");
  if (qualifier === "legendary") return card.typeLine.includes("Legendary");
  if (qualifier === "historic") return isHistoricCard(card);
  // Tribal cost reducers (Urza's Incubator's chosen creature type, Herald's Horn's chosen type,
  // ...) — match the qualifier word against the type line's own text (creature subtypes live after
  // the em dash).
  return card.typeLine.toLowerCase().includes(qualifier);
}

// The fixedCost passed to maxAffordableX already had the pending reduction subtracted (capped at
// baseCost) so it could size how much extra X headroom a leftover reduction buys — but that alone
// isn't the actual bill once X is chosen: {X} symbols contribute X to the total per copy
// (xSymbolCount of them), and a "costs {N} less" effect discounts that whole total, not just the
// non-X portion. Re-deriving the total from baseCost + xCount*chosenX and applying the reduction
// once here (instead of adding xCount*chosenX on top of the already-discounted fixedCost) is what
// keeps a leftover reduction from being counted twice: once to justify affording a higher X, and
// then never actually subtracted from what's paid.
function totalCastingCost(seat: PlayerSeat, card: VisibleCard, baseCost: number, chosenX: number) {
  const unitCost = xOrMultikickerUnitCost(card);
  return Math.max(0, baseCost + unitCost * chosenX - pendingArtifactAffinityReduction(seat) - staticCostReduction(seat, card));
}

// Saheeli, the Gifted's second +1: "The next spell you cast this turn has affinity for artifacts.
// (It costs {1} less to cast for each artifact you control as you cast it.)" — evaluated against
// artifacts controlled at cast time, not when the loyalty ability was activated.
function pendingArtifactAffinityReduction(seat: PlayerSeat) {
  return seat.nextSpellHasArtifactAffinity ? artifactCount(seat) : 0;
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

// A card's own printed "Miracle {cost}" line (Temporal Mastery: "Miracle {1}{U}"), as opposed to
// miracleCostFor's estimate — used for a granted-miracle card (Aminatou, Veil Piercer's enchantments)
// that has no real miracle cost printed on it at all.
function parseMiracleCost(card: VisibleCard): number | undefined {
  const match = card.oracleText.match(/\bmiracle\s+((?:\{[^}]+\})+)/i);
  return match ? manaValueFromManaCost(match[1]) : undefined;
}

function chooseManaSources(seat: PlayerSeat, requiredMana: number) {
  if (requiredMana <= 0) return [];
  const sources = seat.board.battlefield.filter((card) => isAvailableManaSource(card, seat));
  const chosen: string[] = [];
  let mana = 0;
  for (const source of sources) {
    chosen.push(source.id);
    mana += manaProducedBy(source, seat);
    if (mana >= requiredMana) break;
  }
  return chosen;
}

// Being a land is not evidence of a mana ability — Evolving Wilds, Terramorphic Expanse, and every
// other sacrifice-for-a-basic-land fetch land have no "{T}: Add..." line at all, only a
// "{T}, Sacrifice this land: search..." ability. This used to just check isLandCard(card), which
// treated every untapped land as a free colorless source regardless of whether it actually had one
// — tapping a fetch land "for mana" left it tapped and produced nothing, without ever sacrificing
// it or searching. Delegating to manaChoicesForCard (which only returns colors it can actually find
// real evidence for) makes this the same single source of truth instead of two independently
// drifting "is this a mana source" checks.
function isAvailableManaSource(card: VisibleCard, seat: PlayerSeat) {
  return !card.tapped && manaChoicesForCard(card, seat).length > 0;
}

function summarizeAvailableMana(seat: PlayerSeat) {
  const sources = seat.board.battlefield.filter((card) => isAvailableManaSource(card, seat));
  const byColor = emptyManaPool();
  let total = 0;
  for (const source of sources) {
    const produced = manaProducedBy(source, seat);
    total += produced;
    const choices = manaChoicesForCard(source, seat);
    const color = choices.includes("C") ? "C" : choices[0];
    if (color) byColor[color] += produced;
  }
  return { total, untappedSources: sources.length, byColor };
}

// Colors that can only be produced by paying a cost beyond a plain {T} (Sacrifice a creature, pay
// life, an additional mana cost, ...) — Phyrexian Tower's "{T}, Sacrifice a creature: Add {B}{B}."
// (alongside its own separate, genuinely free "{T}: Add {C}.") is the motivating case. Scryfall's
// aggregate producedMana field lists every color a card can ever produce with no regard for what
// it costs, so trusting it directly let a single click ("tap for mana," this engine's only tapping
// gesture) hand out mana nothing was actually paid for. Only clauses whose own cost segment (before
// the colon) is exactly {T} plus this extra-cost language are excluded; a plain "{T}: Add {X}."
// clause for the same card still contributes its color normally.
// Any mana ability whose cost is more than "just tap it" — sacrifice/pay/discard/an extra mana
// symbol — regardless of whether {T} is ALSO part of that cost. This used to require {T} to be
// present (hasTap), written narrowly around Phyrexian Tower's "{T}, Sacrifice a creature: Add
// {B}{B}." shape — but that missed Ashnod's Altar's real cost, "Sacrifice a creature: Add {C}{C}."
// with no {T} at all, which was being treated as a free colorless source exactly like Phyrexian
// Tower's own bug (sacrifice a creature for mana without ever actually sacrificing anything).
function costlyTapManaColors(oracleText: string): Set<string> {
  const clauses = oracleText.split("\n").map((line) => line.trim()).filter(Boolean);
  const costly = new Set<string>();
  const free = new Set<string>();
  for (const clause of clauses) {
    const costMatch = clause.match(/^([^:]+):/);
    if (!costMatch) continue;
    const costText = costMatch[1].toLowerCase();
    const hasExtraCost = /\bsacrifice\b|\bpay\b|\bdiscard\b|\{[0-9wubrgc]+\}/.test(costText.replace(/\{t\}/g, ""));
    const target = hasExtraCost ? costly : free;
    for (const match of clause.matchAll(/add \{([wubrgc])\}/gi)) target.add(match[1].toUpperCase());
  }
  // A color is only actually unavailable "for free" if EVERY clause that produces it carries an
  // extra cost. Sunken Palace has both a plain "{T}: Add {U}." and a separate, genuinely costly
  // "{1}{U}, {T}, Exile seven cards from your graveyard: Add {U}. ..." alternative — before this,
  // finding blue in the costly clause blacklisted blue entirely, silencing the land's ordinary free
  // tap ability along with the real exploit this function exists to close.
  for (const color of free) costly.delete(color);
  return costly;
}

// "{T}: Add {X} or one mana of the chosen color." (the Thriving cycle, the Gate cycle) or the
// plain "{T}: Add one mana of the chosen color." with no fixed second color (Crossroads Village,
// Edgewall Inn, Uncharted Haven, and the rest of that wider "choose a color" land family) —
// checked before the producedMana branch below, which would otherwise offer every color the land
// could ever have chosen (Scryfall's producedMana is the union across every possible choice, not
// what THIS copy actually locked in) instead of just its fixed home color (if any) plus the one
// real chosenColor from ETB. Doesn't match the "choose a color" AGAIN at activation-time family
// (Meteor Crater, Nykthos, Rhystic Cave, Three Tree City's own mana ability) — those pick a color
// fresh every tap rather than locking one in at ETB, so producedMana's "any color" answer is
// already roughly correct for them rather than the bug this fixes.
function chosenColorManaAbility(oracleText: string): { fixedColor?: ManaColor } | undefined {
  const fixedMatch = oracleText.match(/add \{([wubrgc])\} or one mana of the chosen color/i);
  if (fixedMatch) return { fixedColor: fixedMatch[1].toUpperCase() as ManaColor };
  if (/\{t\}:\s*add one mana of the chosen color\b/i.test(oracleText)) return {};
  return undefined;
}

// "{cost}: [effect]. Activate only if [condition]." (Temple of the False God's "control five or
// more lands," the Verge cycle's "control a Forest or a Plains," Mox Opal's "control three or more
// artifacts," Mox Jasper's "control a Dragon," Loyal Apprentice's "you control a commander," ...) —
// narrow, well-templated condition shapes only, shared by every generic activated-ability path
// (mana, sacrifice, tap, self-untap — see their own legal-action and payment call sites) rather than
// re-implemented per ability shape. An UNRECOGNIZED condition deliberately evaluates to "not met"
// rather than "met": the bug this fixes (Temple of the False God usable with any number of lands,
// Loyal Apprentice's sacrifice ability usable with no commander on the battlefield at all) is the
// "wrongly always available" direction, the same class as the Ashnod's Altar/Phyrexian Tower free-
// mana bugs, so declining toward unavailable is the safe default rather than guessing the condition
// is satisfied.
function activateOnlyIfConditionMet(clause: string, seat: PlayerSeat): boolean {
  const conditionMatch = clause.match(/\bactivate (?:this ability )?only if (.+?)\.?\s*$/i);
  if (!conditionMatch) return true;
  const condition = conditionMatch[1].toLowerCase().trim();

  // "You control a commander" means on the battlefield specifically — a commander still sitting in
  // the command zone (seat.board.commander, not yet cast) doesn't count as controlled, only an
  // actual permanent on the battlefield does (rule 903.9, and consistent with how Eminence already
  // treats seat.board.commander as "not yet on the battlefield" elsewhere in this file).
  if (condition === "you control a commander" || condition === "you control your commander") {
    return seat.board.battlefield.some((card) => card.commander);
  }

  const landCountMatch = condition.match(/^you control (\d+|two|three|four|five|six|seven|eight|nine|ten) or more lands$/);
  if (landCountMatch) return countMatchingPermanents(seat.board.battlefield, "lands") >= (numberWordToInt(landCountMatch[1]) ?? Infinity);

  const genericCountMatch = condition.match(/^you control (\d+|two|three|four|five|six|seven|eight|nine|ten) or more ([a-z]+)$/);
  if (genericCountMatch) return countMatchingPermanents(seat.board.battlefield, genericCountMatch[2]) >= (numberWordToInt(genericCountMatch[1]) ?? Infinity);

  const pairMatch = condition.match(/^you control an? ([a-z]+) or an? ([a-z]+)$/);
  if (pairMatch) return countMatchingPermanents(seat.board.battlefield, pairMatch[1]) > 0 || countMatchingPermanents(seat.board.battlefield, pairMatch[2]) > 0;

  // "this land entered this turn or if you control a basic land" (the MKM surveil-land cycle) —
  // "entered this turn" isn't tracked by this engine (no per-permanent ETB-turn timestamp), so this
  // only checks the "or you control a basic land" half — the common case regardless, and a false
  // "not met" here (declining rather than guessing on the untracked half) still errs toward the
  // safe direction.
  if (condition === "this land entered this turn or if you control a basic land") {
    return seat.board.battlefield.some((c) => isBasicLandCard(c));
  }

  const singleMatch = condition.match(/^you control an? ([a-z]+)$/);
  if (singleMatch) return countMatchingPermanents(seat.board.battlefield, singleMatch[1]) > 0;

  return false;
}

// Colors a mana ability could otherwise produce, but whose ONLY producing clause(s) carry an
// "Activate only if" condition that isn't currently met — checked as a final filter over whatever
// manaChoicesForCardRaw already found, rather than threading condition-awareness through every one
// of its branches (producedMana, hardcoded names, the generic "add {X}" regex, ...).
function conditionallyUnavailableColors(oracleText: string, seat: PlayerSeat): Set<string> {
  const colors = new Set<string>();
  const clauses = oracleText.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const clause of clauses) {
    if (!/\bactivate (?:this ability )?only if\b/i.test(clause)) continue;
    if (activateOnlyIfConditionMet(clause, seat)) continue;
    for (const match of clause.matchAll(/add \{([wubrgc])\}/gi)) colors.add(match[1].toUpperCase());
    // "Add one/two/three mana of any [one] color" gated by a condition (Mox Opal, Mox Jasper,
    // Flywheel Racer) — if the condition isn't met, every color is blocked, not just one.
    if (/add (?:one|two|three) mana of any (?:one )?color/i.test(clause)) {
      for (const color of ["W", "U", "B", "R", "G", "C"]) colors.add(color);
    }
  }
  return colors;
}

function manaChoicesForCard(card: VisibleCard, seat: PlayerSeat): ManaColor[] {
  const raw = manaChoicesForCardRaw(card, seat);
  const blocked = conditionallyUnavailableColors(card.oracleText, seat);
  return blocked.size > 0 ? raw.filter((color) => !blocked.has(color)) : raw;
}

function manaChoicesForCardRaw(card: VisibleCard, seat: PlayerSeat): ManaColor[] {
  const chosenColorAbility = chosenColorManaAbility(card.oracleText);
  if (chosenColorAbility) {
    const colors: ManaColor[] = [];
    if (chosenColorAbility.fixedColor) colors.push(chosenColorAbility.fixedColor);
    if (card.chosenColor) colors.push(card.chosenColor as ManaColor);
    return normalizeManaColors(colors);
  }

  const costly = costlyTapManaColors(card.oracleText);
  const produced = normalizeManaColors(card.producedMana ?? []).filter((color) => !costly.has(color));
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

  const addedColors = [...text.matchAll(/add \{([wubrgc])\}/gi)].map((match) => match[1].toUpperCase()).filter((color) => !costly.has(color));
  if (addedColors.length > 0) return normalizeManaColors(addedColors);

  // isManaRock only (not isLandCard): a mana rock's own regex requires actual "{T}: ... add ..."
  // text as positive evidence, but plenty of real lands (Evolving Wilds, Terramorphic Expanse, Maze
  // of Ith, ...) have no mana ability at all and must not default to colorless just for being a
  // land — see isAvailableManaSource's comment for the bug this used to cause.
  if (isManaRock(card)) return ["C"];
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

// Deliberately does NOT check `card.role === "ramp"` or a loose text.includes("add ") — "ramp" also
// tags land-fetch/land-ramp artifacts with no mana ability at all (Wayfarer's Bauble, Expedition
// Map: sacrifice to search for a land CARD, not mana), and "add " matches any unrelated sentence
// containing that word (e.g. "add a +1/+1 counter"). Both used to make isAvailableManaSource treat
// those as always-tappable mana sources. Require the real templating instead: a repeatable "{T}
// [, additional costs]: Add ..." ability in the same clause, which is what every actual mana rock's
// oracle text uses.
function isManaRock(card: VisibleCard) {
  if (!card.typeLine.includes("Artifact")) return false;
  const name = card.name.toLowerCase();
  if (name === "sol ring" || name.includes("signet") || name.includes("talisman")) return true;
  return /\{t\}[^.\n]*?:\s*add\b/i.test(card.oracleText);
}

// "Add {X} for each [Type] you control" scaling mana sources (Cabal Coffers, Gaea's Cradle, ...) —
// without this, every mana source produced a flat 1 (or 2 for Sol Ring), so Cabal Coffers tapped
// for a single black mana regardless of how many Swamps were actually in play.
function scalingManaAmount(card: VisibleCard, seat: PlayerSeat): number | undefined {
  const perControlled = card.oracleText.match(/\badd \{[wubrgc]\} for each ([a-z]+) you control\b/i);
  if (perControlled) {
    const noun = perControlled[1].toLowerCase();
    return seat.board.battlefield.filter((permanent) => permanent.typeLine.toLowerCase().includes(noun)).length;
  }
  // "{T}: Add {C} for each charge counter on this artifact." (Everflowing Chalice, ...) — a card with
  // zero charge counters (never multikicked) correctly produces 0 here, matching the fix that now
  // actually places those counters on ETB; previously this always fell through to the flat "produces
  // 1 mana" default regardless of how many times (if ever) it was kicked.
  const perCounter = card.oracleText.match(/\badd \{[wubrgc]\} for each ([a-z]+) counter on (?:this artifact|this permanent|this creature|it)\b/i);
  if (perCounter) {
    const counterKind = perCounter[1].toLowerCase();
    return card.counters?.find((counter) => counter.kind.toLowerCase() === counterKind)?.count ?? 0;
  }
  return undefined;
}

function manaProducedBy(card: VisibleCard, seat: PlayerSeat) {
  if (card.name === "Sol Ring") return 2;
  const scaling = scalingManaAmount(card, seat);
  if (scaling !== undefined) return scaling;
  return 1;
}

function selectedManaTotal(seat: PlayerSeat, sourceIds: string[]) {
  const sourceSet = new Set(sourceIds);
  return seat.board.battlefield.reduce((total, card) => (sourceSet.has(card.id) ? total + manaProducedBy(card, seat) : total), 0);
}

function cannotPayMessage(seat: PlayerSeat, card: VisibleCard, availableMana: number, totalCost = card.manaValue, reason?: string) {
  const sourceCount = seat.board.battlefield.filter((item) => isAvailableManaSource(item, seat)).length;
  const suffix = reason ? ` (${reason})` : "";
  if (sourceCount === 0) {
    return `${seat.name} cannot cast ${card.name}; it costs ${totalCost} mana and there are no untapped mana sources${suffix}.`;
  }
  return `${seat.name} cannot cast ${card.name}; it costs ${totalCost} mana and only ${availableMana} is available${suffix}.`;
}

// Treasure/Powerstone-style mana sources are consumed on use ("{T}, Sacrifice this artifact: Add
// ..."), not just tapped — without this they'd behave like a permanent extra land forever. Requires
// "sacrifice" to be part of the SAME mana ability's cost (between {T} and its colon), not just
// present anywhere in the card's text — Mind Stone has an unrelated "{1}, {T}, Sacrifice this
// artifact: Draw a card." ability alongside its plain "{T}: Add {C}."; the old text.includes(...)
// check matched on that unrelated sentence and sacrificed Mind Stone the moment it was tapped for
// ordinary mana, even via its non-sacrifice ability.
function isSacrificeManaSource(card: VisibleCard): boolean {
  return /\{t\}[^.\n]*?sacrifice[^.\n]*?:\s*add\b/i.test(card.oracleText);
}

// Spends the chosen mana sources: taps ordinary sources, and sacrifices ones whose mana ability
// requires it (tokens cease to exist; real cards go to the graveyard as a "new object" per the
// zone-change rule, same as destroyCreatures/moveCardBetweenVisibleZones).
function spendManaSources(seat: PlayerSeat, sourceIds: string[]): PlayerSeat {
  if (sourceIds.length === 0) return seat;
  const sourceSet = new Set(sourceIds);
  const kept: VisibleCard[] = [];
  const sacrificed: VisibleCard[] = [];
  for (const card of seat.board.battlefield) {
    if (!sourceSet.has(card.id)) {
      kept.push(card);
      continue;
    }
    if (isSacrificeManaSource(card)) {
      sacrificed.push(card);
    } else {
      kept.push({ ...card, tapped: true });
    }
  }
  if (sacrificed.length === 0) {
    return { ...seat, board: { ...seat.board, battlefield: kept } };
  }
  const toGraveyard = sacrificed.filter((card) => !card.token);
  return {
    ...seat,
    board: {
      ...seat.board,
      battlefield: kept,
      graveyard: [
        ...(seat.board.graveyard ?? []),
        ...toGraveyard.map((card) => ({
          ...card,
          zone: "graveyard" as const,
          tapped: false,
          battlefieldPosition: undefined,
          counters: undefined,
          interpretedEffects: undefined
        }))
      ]
    },
    zones: {
      ...seat.zones,
      battlefield: Math.max(0, seat.zones.battlefield - sacrificed.length),
      graveyard: seat.zones.graveyard + toGraveyard.length
    }
  };
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

// This table's house rule: the first mulligan is a free "friendly mulligan" (fresh 7, no cards
// bottomed), and the standard London mulligan (rule 103.5, bottom one card per mulligan) only kicks
// in from the second mulligan onward — so 0 or 1 mulligans both keep 7, 2 keeps 6, 3 keeps 5, etc.
// (Not the plain Comprehensive Rules London mulligan, which would bottom a card on the very first
// mulligan too — deliberately different here, confirmed by the user after a wrong "fix" attempt.)
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
  workflow: "scry_cards" | "surveil_cards" | "look_at_top_cards" | "reorder_top_cards",
  count: number
): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const seatName = seat?.name ?? "Agent";

  // scry/surveil/reorder have no modeled agent choice, so leaving the top of the library exactly
  // as it is is already a legal resolution (choosing to keep every card on top, in the same order,
  // is one of the real options each of those effects offers) — a no-op here isn't a missed effect,
  // just a suboptimal-but-valid one. "look_at_top_cards" (Diabolic Vision: look at N, put one into
  // hand, the rest back on top) is different: no card ever reaching hand is not a legal resolution
  // of that text, so it needs an actual implementation rather than this same no-op.
  if (workflow === "look_at_top_cards") {
    const cards = (seat?.library ?? []).slice(0, count);
    if (cards.length === 0) {
      return {
        ...session,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId,
            message: `${seatName} resolves ${sourceCardName}, but the library is empty.`
          },
          ...session.events
        ]
      };
    }
    // No modeled "which card is actually best" evaluation — default to the highest mana value as a
    // rough "probably the most impactful" proxy, the same kind of no-choice-UI default used
    // elsewhere in this engine (chooseSacrificeTarget's opposite "least valuable" bias).
    const chosen = cards.reduce((best, card) => (card.manaValue > best.manaValue ? card : best));
    const rest = cards.filter((card) => card.id !== chosen.id);
    const withChosenInHand = moveLibraryCardToDestination(session, seatId, chosen.id, "hand", false);
    const finalSession = reorderTopLibraryCards(withChosenInHand, seatId, rest);
    return {
      ...finalSession,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seatName} resolves ${sourceCardName}: looks at the top ${cards.length}, puts ${chosen.name} into hand, and returns the rest to the top.`
        },
        ...finalSession.events
      ]
    };
  }

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
  sourceZone: "hand" | "command" | "exile" = "hand",
  faceIndex?: number
): GameSession {
  let playedName = "";
  let enteredTapped = false;
  const seats = session.seats.map((seat) => {
    if (seat.id !== seatId) return seat;
    const sourceCard =
      sourceZone === "command"
        ? seat.board.commander
        : sourceZone === "exile"
          ? seat.board.exile?.find((item) => item.id === cardId)
          : seat.board.hand.find((item) => item.id === cardId);
    if (!sourceCard) return seat;
    const card = applyChosenFaceToCard(sourceCard, faceIndex);
    playedName = card.name;
    const entersTapped = destination === "battlefield" && entersBattlefieldTapped(card, seat);
    enteredTapped = entersTapped;
    const played: VisibleCard = {
      ...card,
      zone: destination,
      tapped: entersTapped ? true : card.tapped,
      battlefieldPosition: destination === "battlefield" ? position : undefined,
      summoningSick: destination === "battlefield" && card.typeLine.includes("Creature") ? true : card.summoningSick,
      counters: destination === "battlefield" && isPlaneswalkerCard(card) ? withInitialLoyaltyCounters(card) : card.counters,
      exiledPlayableBySeatId: undefined,
      exiledPlayableUntilTurn: undefined
    };
    const spentSeat = spendManaSources(seat, manaSourceIds);
    const graveyard = spentSeat.board.graveyard ?? [];
    const commanderLeavesCommand = sourceZone === "command" && seat.board.commander?.id === cardId;
    return {
      ...spentSeat,
      board: {
        ...spentSeat.board,
        commander: commanderLeavesCommand ? undefined : spentSeat.board.commander,
        hand: sourceZone === "hand" ? spentSeat.board.hand.filter((item) => item.id !== cardId) : spentSeat.board.hand,
        exile: sourceZone === "exile" ? (spentSeat.board.exile ?? []).filter((item) => item.id !== cardId) : spentSeat.board.exile,
        battlefield: destination === "battlefield" ? [...spentSeat.board.battlefield, played] : spentSeat.board.battlefield,
        graveyard: destination === "graveyard" ? [...graveyard, played] : graveyard
      },
      zones: {
        ...spentSeat.zones,
        battlefield: spentSeat.zones.battlefield + (destination === "battlefield" ? 1 : 0),
        command: Math.max(0, spentSeat.zones.command - (commanderLeavesCommand ? 1 : 0)),
        graveyard: spentSeat.zones.graveyard + (destination === "graveyard" ? 1 : 0),
        hand: sourceZone === "hand" ? Math.max(0, spentSeat.zones.hand - 1) : spentSeat.zones.hand,
        exile: sourceZone === "exile" ? Math.max(0, spentSeat.zones.exile - 1) : spentSeat.zones.exile
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

function rollD20() {
  return 1 + Math.floor(Math.random() * 20);
}

// Rule 103.2: before the game, each player rolls a die (traditionally a d20); the highest roll
// chooses who plays first. Ties are broken by having only the tied players re-roll against each
// other, not by falling back to seat/array order.
function rollForStartingSeat(seats: PlayerSeat[]): { winnerId: string; rolls: Record<string, number> } {
  const allRolls: Record<string, number> = {};
  let contenders = seats;
  let guard = 0;
  while (guard < 20) {
    guard += 1;
    const roundRolls: Record<string, number> = {};
    for (const seat of contenders) roundRolls[seat.id] = rollD20();
    Object.assign(allRolls, roundRolls);
    const highest = Math.max(...contenders.map((seat) => roundRolls[seat.id]));
    const tiedForHighest = contenders.filter((seat) => roundRolls[seat.id] === highest);
    if (tiedForHighest.length === 1) return { winnerId: tiedForHighest[0].id, rolls: allRolls };
    contenders = tiedForHighest;
  }
  return { winnerId: contenders[0]?.id ?? seats[0].id, rolls: allRolls };
}

// Rule 117.3b: a player who casts a spell/activates an ability receives priority again
// immediately afterward, before anyone else does — they can hold priority to cast a second spell
// in response to their own first one (the actor used to be structurally excluded here, so the
// caster of a spell could never respond to it themselves; fixed by including them like anyone
// else who's able to act, with nextPrioritySeatId giving them first crack below).
function pendingActionRequiredPasses(
  seats: PlayerSeat[],
  action: PendingAction,
  activeSeatId: string | undefined,
  session: GameSession,
  manaPools: Record<string, ManaPool>
) {
  if (action.type === "trigger") return [action.controllerSeatId];
  return seats.filter((seat) => canReceivePriorityForPendingAction(seat, action, activeSeatId, session, manaPools)).map((seat) => seat.id);
}

function nextPrioritySeatId(
  seats: PlayerSeat[],
  actorSeatId: string,
  passes: string[],
  action: PendingAction,
  activeSeatId: string | undefined,
  session: GameSession,
  manaPools: Record<string, ManaPool>
) {
  const required = pendingActionRequiredPasses(seats, action, activeSeatId, session, manaPools);
  // The actor gets first crack at responding to their own action (rule 117.3b) — only once
  // they've passed does priority move on to the rest of the table in turn order.
  if (required.includes(actorSeatId) && !passes.includes(actorSeatId)) return actorSeatId;
  const startIndex = Math.max(0, seats.findIndex((seat) => seat.id === actorSeatId));
  for (let offset = 1; offset <= seats.length; offset += 1) {
    const seat = seats[(startIndex + offset) % seats.length];
    if (required.includes(seat.id) && !passes.includes(seat.id)) return seat.id;
  }
  return actorSeatId;
}

function canReceivePriorityForPendingAction(
  seat: PlayerSeat,
  action: PendingAction,
  activeSeatId: string | undefined,
  session: GameSession,
  manaPools: Record<string, ManaPool>
) {
  if (seat.hasLost) return false;
  if (seat.kind === "agent") {
    // Used to unconditionally return true here, meaning every agent seat — even ones holding zero
    // instant-speed cards or usable abilities — had to individually "confirm" passing on every
    // single phase transition, each needing its own decision-timer delay and (with a real model
    // configured) LLM round trip. That's what makes turns crawl in real play: three idle agents
    // each getting asked whether they want to do something during untap/upkeep/draw/combat
    // damage/cleanup, phases where a response was never actually possible for them. Mirrors the
    // human check below: only require a pass when there's a genuine response available.
    return legalPriorityActions(seat, action, activeSeatId, session).some((item) => item.actionType !== "pass_priority");
  }
  const pool = manaPools[seat.id] ?? emptyManaPool();
  const pendingSpellTarget = action.type === "spell" ? findSpellSourceCard(session, action) : undefined;
  return seat.board.hand.some((card) => {
    if (!canCastAtInstantSpeed(card)) return false;
    // A type-restricted counterspell ("counter target creature/noncreature/commander spell") isn't
    // a real response option if it can't legally target what's actually on the stack — without this,
    // a human whose only instant-speed card was e.g. Negate got offered a priority window (and the
    // "Respond"/"Pass Priority" choice) against a creature spell it can never legally counter, when
    // the window should never have opened at all — same gap already closed in respondWithCard and
    // selectedCardCanRespond, just missing from the check that decides whether to open the window
    // in the first place.
    const counterAbility = parseCounterSpellAbility(card.oracleText);
    if (counterAbility && action.type === "spell") {
      const legalCounterTarget =
        pendingSpellTarget &&
        !spellIsImmuneToCounters(session, pendingSpellTarget, action.actorSeatId) &&
        counterSpellCanTarget(counterAbility, pendingSpellTarget.typeLine, action.sourceZone === "command");
      if (!legalCounterTarget) return false;
    }
    const fixedCost = adjustedCastingCost(seat, card, card.manaValue, "hand", activeSeatId);
    const chosenX = maxAffordableX(seat, card, fixedCost);
    const totalCost = totalCastingCost(seat, card, card.manaValue, chosenX);
    // A human hasn't necessarily tapped anything into their mana pool yet at this point — that
    // normally happens once they actually get priority and choose to respond. Checking only
    // payCostFromPool's already-tapped pool here meant a human with untapped lands and a castable
    // instant was never even offered a priority window: they needed priority to tap mana, but only
    // got priority if mana was already tapped. chooseManaSourcesForCost simulates tapping directly
    // from the battlefield (same color-aware logic already used for agents), so check that too.
    return payCostFromPool(pool, card, totalCost).ok || chooseManaSourcesForCost(seat, card, totalCost).ok;
  });
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
      interpretedEffects: undefined,
      attachedToId: undefined,
      attachmentPowerBonus: undefined,
      attachmentToughnessBonus: undefined,
      grantedKeywords: undefined,
      grantedProtectionColors: undefined,
      grantedTypes: undefined,
      attachTimestamp: undefined,
      cdaPower: undefined,
      cdaToughness: undefined,
      setPowerOverride: undefined,
      setToughnessOverride: undefined
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
    if (!source || !isBasicLandFetchAbility(source)) return seat;
    const requiresTap = basicLandFetchCostRequiresTap(source);
    if (requiresTap && source.tapped) return seat;
    if (requiresTap && source.typeLine.includes("Creature") && source.summoningSick && !hasHaste(source)) return seat;

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
    (text.includes("put it onto the battlefield tapped") || text.includes("put that card onto the battlefield tapped")) &&
    text.includes("sacrifice")
  );
}

// Not every basic-land-fetch ability actually costs {T} — Sakura-Tribe Elder's is plain "Sacrifice
// this creature:" with no tap at all (that's the whole point of the card: block, then still get
// its ramp the same turn), unlike Evolving Wilds' "{T}, Sacrifice this land:". Gating on
// card.tapped/summoning sickness unconditionally for every basic-land-fetch source — as if they all
// cost {T} — wrongly blocked Sakura-Tribe Elder's ability the instant it was already tapped (e.g.
// from blocking) or still summoning sick, neither of which rule 302.6 actually restricts when the
// cost has no {T}/{Q} in it.
function basicLandFetchCostRequiresTap(card: VisibleCard): boolean {
  const clause = card.oracleText.split("\n").find((line) => /search your library for a basic land card/i.test(line));
  const costPortion = clause?.split(":")[0] ?? "";
  return /\{t\}/i.test(costPortion);
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

function chooseBestBasicLandPairForMyriad(seat: PlayerSeat): VisibleCard[] {
  const options = getMyriadLandscapeOptions(seat.library ?? []);
  for (let i = 0; i < options.length; i += 1) {
    for (let j = i + 1; j < options.length; j += 1) {
      if (sharedBasicLandTypes([options[i], options[j]]).length > 0) return [options[i], options[j]];
    }
  }
  return [];
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
  destination: "hand" | "battlefield" | "graveyard",
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
        battlefield: destination === "battlefield" ? [...seat.board.battlefield, movedCard] : seat.board.battlefield,
        graveyard: destination === "graveyard" ? [...(seat.board.graveyard ?? []), movedCard] : seat.board.graveyard
      },
      zones: {
        ...seat.zones,
        hand: seat.zones.hand + (destination === "hand" ? 1 : 0),
        battlefield: seat.zones.battlefield + (destination === "battlefield" ? 1 : 0),
        graveyard: seat.zones.graveyard + (destination === "graveyard" ? 1 : 0),
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
        message: `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} searches their library for ${movedName} and puts it ${destination === "graveyard" ? "into" : "onto"} the ${destination}.`
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
