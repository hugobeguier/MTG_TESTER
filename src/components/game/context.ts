// GameContext: the shared state every AppFlow() sub-hook in this folder works from.
//
// useGameState() owns ALL of AppFlow's useState/useRef/derived values (moved here verbatim, in original order) and returns them grouped:
//   top level  session, setSession (runs state-based actions on every update), humanSeat, mode, activeSeatId, selection/inspect state, setup/deck/save state
//   stack      pendingAction, stackActions, stackStore (useStackState: the single owner of stack/pending/passes/prioritySeatId/activeSeatId; its ref.current is always current), priority passes/stops, stackFeed, resolve-beat and ability-resolver refs, cast re-entrancy guard
//   mana       manaPools, copyMana, manaContributions, restrictedManaBatches, manaChoice, lastCastManaContributors
//   choices    pendingRuleChoice, libraryLook, block/myriad/basic-land prompts, mulligan state, pendingOrderedTriggerResume, per-card "already asked" refs
//   agent      agentThinking/Reasoning, de-dupe refs, stated plans, rulesAdvisorPending
//   turn       per-turn refs (land plays, spells cast, ...), processed-batch refs for the trigger effects, token-art caches
// GameContext = that + `late`: an object AppFlow() fills with every sub-hook's returned handlers AFTER all hooks ran. A hook calls a handler that
// lives in another hook via lateFn(ctx, "name"): a thin forwarder resolved at call time, so cycles between hooks are fine and each call still lands
// on the functions of the render the caller closed over (hooks run every render, ctx is rebuilt every render).
import { type AgentReasoning, type CardImageUris, type GameSession, type ManaContribution, type ManaPool, type RestrictedManaBatch, type VisibleCard } from "@/lib/types";
import { MAX_SESSION_EVENTS, loadRuleWorkflowCacheOnce } from "@/lib/agentRuntime";
import { type PendingAction, type PendingRuleChoice } from "@/engine/types";
import { type StackFeedEntry } from "@/components/ThreeGameTable";
import { checkStateBasedActions } from "@/engine/stateBased";
import { payGenericSacrificeCost, payGenericTapCost } from "@/engine/abilities";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PriorityStopSettings, SeatStopSettings } from "@/lib/priorityStops";
import { useDeckLibrary } from "@/components/hooks/useDeckLibrary";
import { useStackState } from "@/components/hooks/useStackState";
import { useDecisionState } from "@/components/hooks/useDecisionState";
import { usePriorityStopSettings } from "@/components/hooks/usePriorityStopSettings";
import { useSavedGames } from "@/components/hooks/useSavedGames";
import type { useManaUi } from "./useManaUi";
import type { useGameSetup } from "./useGameSetup";
import type { useTurnFlow } from "./useTurnFlow";
import type { useCombatUi } from "./useCombatUi";
import type { useStackResolution } from "./useStackResolution";
import type { useTriggerResolution } from "./useTriggerResolution";
import type { useCasting } from "./useCasting";
import type { useAbilities } from "./useAbilities";
import type { useChoicePrompts } from "./useChoicePrompts";
import type { useAgentDriver } from "./useAgentDriver";
import type { useGameActions } from "./useGameActions";
import { hostHumanSeat } from "@/lib/multiplayer/seatMap";
import type { useRulesAdvisor } from "./useRulesAdvisor";
import type { useSpecialEffects } from "./useSpecialEffects";

export type FlowMode = "setup" | "game";
export type GameStage = "mulligan" | "playing";

export type HandlerApi = ReturnType<typeof useManaUi> &
  ReturnType<typeof useGameSetup> &
  ReturnType<typeof useTurnFlow> &
  ReturnType<typeof useCombatUi> &
  ReturnType<typeof useStackResolution> &
  ReturnType<typeof useTriggerResolution> &
  ReturnType<typeof useCasting> &
  ReturnType<typeof useAbilities> &
  ReturnType<typeof useChoicePrompts> &
  ReturnType<typeof useAgentDriver> &
  ReturnType<typeof useGameActions> &
  ReturnType<typeof useRulesAdvisor> &
  ReturnType<typeof useSpecialEffects>;
type GameState = ReturnType<typeof useGameState>;
export type GameContext = GameState & { late: HandlerApi };

/** Forwarder to a handler owned by another game/ hook (looked up on ctx.late when called, not when created). */
export function lateFn<K extends keyof HandlerApi>(ctx: GameContext, key: K): HandlerApi[K] {
  return ((...args: unknown[]) => (ctx.late[key] as (...a: unknown[]) => unknown)(...args)) as HandlerApi[K];
}

export function useGameState(initialSession: GameSession, options: { emptyNonHostSeats?: boolean } = {}) {
  // The original (4-seat) session's seats: a seat an earlier game left out ("Empty") is rebuilt from here when it is played again.
  const baseSeats = useRef(initialSession.seats).current;

  const [mode, setMode] = useState<FlowMode>("setup");
  const [session, rawSetSession] = useState(() => checkStateBasedActions(initialSession));
  // Every session update is routed through here so state-based actions (rule 704) are checked
  // after every single change, instead of relying on scattered call sites to remember to do it.
  const setSession = useCallback((update: GameSession | ((prev: GameSession) => GameSession)) => {
    rawSetSession((current) => {
      const next = checkStateBasedActions(typeof update === "function" ? update(current) : update);
      // The event log is prepended to on every action and never trimmed; copying/filtering an ever-growing array on each update gets
      // slower all game. Newest events come first, so dropping the tail only loses the oldest history.
      return next.events.length > MAX_SESSION_EVENTS ? { ...next, events: next.events.slice(0, MAX_SESSION_EVENTS) } : next;
    });
  }, []);
  // One-time load of whatever rule-workflow classifications persisted from earlier sessions —
  // localStorage isn't available during SSR, so this has to happen client-side on mount rather than
  // at module init time.
  useEffect(() => {
    loadRuleWorkflowCacheOnce();
  }, []);
  const stackStore = useStackState({ activeSeatId: initialSession.activePlayerId ?? initialSession.seats[1]?.id, prioritySeatId: initialSession.activePlayerId ?? initialSession.seats[1]?.id });
  const { setPending: setPendingAction, setPasses: setPriorityPasses, setPrioritySeatId, setActiveSeatId } = stackStore;
  const activeSeatId = stackStore.state.activeSeatId as string; // was useState<string>; keeps read sites' types
  // Stable identity for the table's session prop: a fresh `{ ...session }` on every render made everything inside the table that
  // depends on `props.session` recompute on unrelated re-renders (hover, thinking text, timers).
  const tableSession = useMemo(() => (session.activePlayerId === activeSeatId ? session : { ...session, activePlayerId: activeSeatId }), [session, activeSeatId]);
  const [selectedHandCardId, setSelectedHandCardId] = useState<string | undefined>();
  // Multiplayer: names of friends the game is waiting on because they are disconnected (set by useMpHost). While non-empty nothing advances on its own.
  const [mpPausedFor, setMpPausedFor] = useState<string[]>([]);
  const [inspectedCard, setInspectedCard] = useState<VisibleCard | undefined>();
  const [gameStage, setGameStage] = useState<GameStage>("mulligan");
  const [gameOverDismissed, setGameOverDismissed] = useState(false);
  const [mulligans, setMulligans] = useState<Record<string, number>>({});
  const [keptHands, setKeptHands] = useState<Record<string, boolean>>({});
  // Synchronous mirror of keptHands: a host click and a friend's queued intent can both run before the next render, and "am I the last to keep" must see both.
  const keptHandsRef = useRef(keptHands);
  keptHandsRef.current = keptHands;
  // Cards each human seat has picked to shuffle away while mulliganing (seat id -> card ids); a friend's seat has its own entry.
  const [mulliganReturnCardIds, setMulliganReturnCardIds] = useState<Record<string, string[]>>({});
  const [pendingRuleChoice, setPendingRuleChoice] = useState<PendingRuleChoice | undefined>();
  const decisions = useDecisionState(); // mana/block choices, library look, library searches, myriad tap live here (one decision per slot); old names/setters are adapters
  const { manaChoice, blockChoice, setManaChoice, setBlockChoice, libraryLook, setLibraryLook, manualLibrarySearch, setManualLibrarySearch, myriadSearch, setMyriadSearch, myriadTapChoice, setMyriadTapChoice, basicLandFetchSearch, setBasicLandFetchSearch } = decisions;
  const [selectedBlockerIds, setSelectedBlockerIds] = useState<string[]>([]);
  const stackActions = stackStore.state.stack;
  const pendingAction = stackStore.state.pending;
  const priorityPasses = stackStore.state.passes;
  const prioritySeatId = stackStore.state.prioritySeatId as string; // was useState<string> (always set); keeps read sites' types
  // Always-current views of state for the legality gate: an agent decision awaits an LLM call, so the render-time `session` captured by its closure can be
  // stale by the time the answer arrives. The gate re-validates the proposal against these, never against the stale closure.
  const latestSessionRef = useRef(session);
  latestSessionRef.current = session;
  const { priorityStopSettings: hostStopSettings, updatePriorityStopSettings } = usePriorityStopSettings();
  // Multiplayer: each remote friend's OWN stop settings (seat id -> settings; absent = the host's defaults, see lib/multiplayer/seatStops.ts). Merged into the
  // settings every priority decision reads (as `bySeat`), so a friend is asked by their own stops, never the host's. Not persisted.
  const [seatStops, setSeatStops] = useState<Record<string, SeatStopSettings>>({});
  const priorityStopSettings = useMemo<PriorityStopSettings>(() => (Object.keys(seatStops).length === 0 ? hostStopSettings : { ...hostStopSettings, bySeat: seatStops }), [hostStopSettings, seatStops]);
  // One-shot "stop me on the very next priority window" flag (the "Stop Next" button) — deliberately
  // session-only (not persisted): armed by a click, consumed the next time beginPendingAction or
  // resumeStackAction opens/reopens a window at all, regardless of whether that window ends up
  // actually including the human in requiredPasses.
  const [holdPriorityOnce, setHoldPriorityOnce] = useState(false);
  const [manaPools, setManaPools] = useState<Record<string, ManaPool>>({});
  // Sunken Palace: how many of a seat's floating {U} are "copy" mana (the spell they pay for is copied). Emptied with the pool.
  const [copyMana, setCopyMana] = useState<Record<string, number>>({});
  const [manaContributions, setManaContributions] = useState<Record<string, ManaContribution[]>>({});
  const [restrictedManaBatches, setRestrictedManaBatches] = useState<Record<string, RestrictedManaBatch[]>>({});
  // The human tucked the open choice box away ("Minimize") to look at the board. The choice itself stays pending; while this is set the
  // human's own game actions (cast, activate, pass) are refused with a message — see humanActionBlockedByChoice — except tapping lands.
  const [choiceMinimized, setChoiceMinimized] = useState(false);
  const [setupMessage, setSetupMessage] = useState<string | undefined>();
  const { configs, setConfigs, deckLibrary, defaultDecksApplied } = useDeckLibrary(initialSession.seats, options);
  const { savedGames, setSavedGames } = useSavedGames(mode);
  // startGame is async (it awaits an Ollama mulligan decision per agent seat, which can take
  // several seconds each) with nothing else gating re-entry — playBlockedByBuild only reflects
  // per-seat deck-build status, not "a game is currently being started." Without this, clicking
  // PLAY more than once before the first call resolves fired multiple full startGame() runs
  // concurrently, each eventually calling setSession with its own independently-drawn opening
  // hands; whichever resolved last silently clobbered the others' session state. Reported live as
  // a freshly started game's action log suddenly containing a second "Created a 4-player Commander
  // session..." entry and every hand changing out from under the player mid-mulligan.
  const [gameStarting, setGameStarting] = useState(false);
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
  // A one-shot relay baton for an agent's stated short-term plan (AgentAction.manaPlan, e.g. "holding
  // up 2 mana for a counterspell") — not UI-facing, so a ref like landPlaysThisTurn/spellsCastThisTurn
  // below rather than useState. requestAgentDecision reads and clears a seat's entry right before its
  // next real decision (surfacing it exactly once as context.previousStatedPlan), then re-populates it
  // from that decision's own manaPlan if the agent restates one — see requestAgentDecision for why a
  // forced single-legal-action step must not touch this.
  const agentStatedPlans = useRef<Record<string, string>>({});
  const landPlaysThisTurn = useRef<Set<string>>(new Set());
  // How many spells each seat has cast this turn (key: "${turn}:${seatId}") — feeds the "their
  // first spell each turn" condition cast-triggers can have (Mind's Dilation, ...); never cleaned
  // up between turns since old turns' keys are harmless clutter, same as landPlaysThisTurn.
  const spellsCastThisTurn = useRef<Map<string, number>>(new Map());
  const firstDrawThisTurn = useRef<Set<string>>(new Set());
  const loyaltyActivationsThisTurn = useRef<Set<string>>(new Set());
  // Ids of the permanents whose floating mana paid for the spell being cast right now (Path of Ancestry's scry needs to know).
  const lastCastManaContributors = useRef<string[]>([]);
  const phaseTriggersChecked = useRef<Set<string>>(new Set());
  const cleanupDiscardChecked = useRef<Set<string>>(new Set());
  // Klauth, Unrivaled Ancient's restricted mana batch is only ever created during its own seat's
  // combat, so the next time that same seat reaches ITS OWN cleanup step is always the end of the
  // exact turn it was created on — no need to track which turn a batch came from separately.
  const cleanupRestrictedManaChecked = useRef<Set<string>>(new Set());
  // Set by endTurn() when the "End Turn" shortcut finds the seat over its max hand size — that
  // shortcut jumps straight past the cleanup step (where the discard normally happens, via the
  // cleanupDiscardChecked effect below) to the next player's untap step, so without this the
  // discard requirement (rule 514.1) never gets a chance to fire and a human could keep an
  // unlimited hand just by always ending their turn early instead of stepping through phases.
  // Cleared once the discard resolves and the turn is actually allowed to end.
  const pendingEndTurnAfterDiscard = useRef<string | undefined>(undefined);
  // When resolveOrderedPhaseTriggers (multiple simultaneous phase triggers, ordered by the
  // controller) hits one that needs its own interactive choice — cumulative upkeep pay/sacrifice,
  // a real graveyard/battlefield target, or a scry/surveil window — it can only open ONE
  // pendingRuleChoice/libraryLook at a time, so it stops there and stashes whatever triggers were
  // still left in the chosen order here. Reproduced live as a seat with Debtors' Knell, Virtue of
  // Persistence, and Aminatou, Veil Piercer all triggering the same upkeep only ever getting asked
  // Aminatou's surveil choice — the two reanimation triggers were silently dropped (or auto-picked
  // by the deterministic heuristic with no prompt at all) the moment the loop hit the first
  // interactive one and returned. Every completion handler for those interactive choices calls
  // resumePendingOrderedTriggers() once it's done, which continues this queue instead of just
  // stopping after the first entry.
  const pendingOrderedTriggerResume = useRef<
    { seatId: string; triggers: Extract<PendingRuleChoice, { kind: "order_triggers" }>["triggers"]; stacked?: Array<Extract<PendingAction, { type: "trigger" }>> } | undefined
  >(undefined);
  // Reentrancy guard for playCard's non-land ("cast a spell") branch. playCard's own top-of-function
  // guard (`if (pendingAction) return`) reads pendingAction from React state, which two synchronous
  // calls to playCard in the same tick both see as whatever it was as of the LAST commit — neither
  // call can see the other's in-flight dispatch, since setPendingAction/pushStackAction's effects on
  // component state don't land until React actually re-renders. beginPendingAction, called from
  // inside playCard, both increments spellsCastThisTurn (a ref, so this second call sees a fresh
  // castOrdinal) and independently re-scans/re-queues every "whenever you cast..." trigger on the
  // board (findCastTriggers) — so a same-tick duplicate dispatch queues that scan twice, with two
  // real trigger actions landing on the stack from one actual cast. This ref is set the instant a
  // cast is dispatched and cleared on a fresh macrotask (after React has had a chance to commit and
  // make the real pendingAction guard effective again), closing that window without changing
  // behavior for any two casts that aren't literally dispatched in the same tick. Reproduced live as
  // Beast Whisperer and Guardian Project each drawing/triggering twice for a single creature cast.
  // Timestamp (not a plain boolean) so the guard below can self-heal if the macrotask reset is ever
  // dropped — e.g. a backgrounded/throttled tab delaying window.setTimeout(fn, 0) far longer than
  // intended. A boolean stuck true has no recovery path: every future playCard call silently no-ops
  // forever (the guard below returns before ever calling addEvent), which is indistinguishable from
  // "this card doesn't work" with zero diagnostic trail. Reported live as Kodama's Reach appearing to
  // do nothing when cast — traced to this exact guard, not anything about the card itself.
  const castDispatchInFlight = useRef<number | null>(null);
  const CAST_DISPATCH_STALE_MS = 500;
  const processedDeathBatchRef = useRef<GameSession["pendingDeaths"]>(undefined);
  const processedEntryBatchRef = useRef<GameSession["pendingEntries"]>(undefined);
  const processedLeaveBatchRef = useRef<GameSession["pendingLeaves"]>(undefined);
  const processedCombatDamageToPlayerBatchRef = useRef<GameSession["pendingCombatDamageToPlayer"]>(undefined);
  const processedGraveyardDepartureBatchRef = useRef<GameSession["pendingGraveyardDepartures"]>(undefined);
  // Card ids already offered (or auto-resolved) the "move to the command zone instead?" choice —
  // a commander that's declined the move (or an agent's auto-accepted one) stays in the graveyard
  // still flagged commander: true, so without this the detection effect below would re-offer the
  // exact same card every single render.
  const commanderZoneChoiceAsked = useRef<Set<string>>(new Set());
  // Aura card ids already offered (or that never qualified for) the post-resolution retarget
  // choice below — an Aura stays attached (attachedToId set) for its whole time on the battlefield,
  // so without this the detection effect would re-offer the same already-resolved Aura forever.
  const auraRetargetAsked = useRef<Set<string>>(new Set());
  // The resolving beat (see resolvePendingAction): ids already waiting out their beat (so a second trigger of the same resolution is a no-op),
  // the newest closure of the real resolver (the beat callback must not run a stale one), and the recent-resolutions feed the table shows.
  const resolveBeatIds = useRef<Set<string>>(new Set());
  const resolveNowRef = useRef<(action: PendingAction) => void>(() => undefined);
  // Activated abilities waiting on the stack: the effect closure per stack item (see putAbilityOnStack), and the newest closures of the
  // functions those effects call (so an effect that resolves later never runs against a stale view of the game).
  const abilityResolvers = useRef<Map<string, () => void>>(new Map());
  const abilityApiRef = useRef<{
    resolveSacrificeAbilityEffect: (seatId: string, paid: NonNullable<ReturnType<typeof payGenericSacrificeCost>>) => void;
    resolveTapAbilityEffect: (seatId: string, cardId: string, paid: NonNullable<ReturnType<typeof payGenericTapCost>>, chosenCardId?: string) => void;
  }>({ resolveSacrificeAbilityEffect: () => undefined, resolveTapAbilityEffect: () => undefined });
  const [stackFeed, setStackFeed] = useState<StackFeedEntry[]>([]);
  const humanSeat = hostHumanSeat(session.seats) ?? session.seats[0]; // the HOST's human seat (a remote friend's has remoteSlot)
  const selectedHandCard = selectedHandCardId ? humanSeat.board.hand.find((card) => card.id === selectedHandCardId) : undefined;

  // Emblem "whenever ... is put into your graveyard from the battlefield / dies, return it at the beginning of the next end step" (Daretti, Scrap
  // Savant; Liliana, Heretical Healer): watched by comparing each committed session with the previous one, so every way a permanent can reach a
  // graveyard (combat, destroy, sacrifice, state-based actions) is covered without touching each path. The trigger is one-shot and records the card.
  const emblemWatchPrevious = useRef(session);

  // Token art: Scryfall has real token cards. Ask the server (which asks Scryfall once per distinct token and caches it) and stamp the image on every matching token.
  const tokenArtCache = useRef<Map<string, CardImageUris | null>>(new Map());
  const tokenArtInFlight = useRef<Set<string>>(new Set());
  const [tokenArtVersion, setTokenArtVersion] = useState(0);

  // Monarch (rule 724): the monarch draws an extra card at the beginning of their own end step.
  const monarchDrawChecked = useRef<Set<string>>(new Set());

  // Dragonhawk, Fate's Tempest: at the beginning of its controller's end step, damage for every impulse-exiled card still in exile.
  const exileDamageChecked = useRef<Set<string>>(new Set());

  // Life gain has a dozen separate call sites that each just add to seat.life, so instead of hooking each one this watches every
  // seat's life total and treats any rise as "you gained life": applies Angel of Vitality's +1, then queues the
  // "whenever you gain life" triggers. (Manual +/- life edits count too — acceptable for a table that is also a sandbox.)
  const lifeWatchRef = useRef<{ sessionId: string; lives: Record<string, number>; gainTurns: Record<string, number> }>({ sessionId: "", lives: {}, gainTurns: {} });

  const processedBlockBatchRef = useRef<GameSession["pendingBlockDeclarations"]>(undefined);

  const processedAttackBatchRef = useRef<GameSession["pendingAttackDeclarations"]>(undefined);

  // An agent that keeps choosing the same cast without it ever happening is stuck (the cast is offered as payable but the real cast refuses):
  // after three identical picks in a row that action is dropped for the rest of the phase so the agent can do something else or pass.
  const agentCastAttempts = useRef<{ key: string; count: number }>({ key: "", count: 0 });
  const agentBannedCasts = useRef<Set<string>>(new Set());

  // The situation and scored options of each agent's latest decision (see requestAgentDecision), attached to its reasoning for the 🧠 chat.
  const agentDecisionInfo = useRef<Record<string, Pick<AgentReasoning, "situation" | "options" | "chosenId" | "turn" | "phase">>>({});
  return {
    mpPausedFor, setMpPausedFor, mode, setMode, session, setSession, activeSeatId, setActiveSeatId, prioritySeatId, setPrioritySeatId, tableSession, selectedHandCardId, setSelectedHandCardId, inspectedCard, setInspectedCard, gameStage, setGameStage, gameOverDismissed, setGameOverDismissed, latestSessionRef, setupMessage, setSetupMessage, configs, setConfigs, deckLibrary, defaultDecksApplied, savedGames, setSavedGames, gameStarting, setGameStarting, autoValidatedDefaultDeck, humanSeat, selectedHandCard, baseSeats,
    choices: { decisions, mulligans, setMulligans, keptHands, setKeptHands, keptHandsRef, mulliganReturnCardIds, setMulliganReturnCardIds, libraryLook, setLibraryLook, manualLibrarySearch, setManualLibrarySearch, pendingRuleChoice, setPendingRuleChoice, blockChoice, setBlockChoice, selectedBlockerIds, setSelectedBlockerIds, myriadSearch, setMyriadSearch, myriadTapChoice, setMyriadTapChoice, basicLandFetchSearch, setBasicLandFetchSearch, choiceMinimized, setChoiceMinimized, pendingOrderedTriggerResume, commanderZoneChoiceAsked, auraRetargetAsked },
    stack: { stackStore, pendingAction, setPendingAction, stackActions, priorityPasses, setPriorityPasses, priorityStopSettings, updatePriorityStopSettings, seatStops, setSeatStops, holdPriorityOnce, setHoldPriorityOnce, castDispatchInFlight, CAST_DISPATCH_STALE_MS, resolveBeatIds, resolveNowRef, abilityResolvers, abilityApiRef, stackFeed, setStackFeed },
    mana: { manaPools, setManaPools, copyMana, setCopyMana, manaContributions, setManaContributions, restrictedManaBatches, setRestrictedManaBatches, manaChoice, setManaChoice, lastCastManaContributors },
    agent: { rulesAdvisorPending, setRulesAdvisorPending, agentMainActions, agentDecisionRequests, agentThinking, setAgentThinking, agentReasoning, setAgentReasoning, agentStatedPlans, agentCastAttempts, agentBannedCasts, agentDecisionInfo },
    turn: { landPlaysThisTurn, spellsCastThisTurn, firstDrawThisTurn, loyaltyActivationsThisTurn, phaseTriggersChecked, cleanupDiscardChecked, cleanupRestrictedManaChecked, pendingEndTurnAfterDiscard, processedDeathBatchRef, processedEntryBatchRef, processedLeaveBatchRef, processedCombatDamageToPlayerBatchRef, processedGraveyardDepartureBatchRef, emblemWatchPrevious, tokenArtCache, tokenArtInFlight, tokenArtVersion, setTokenArtVersion, monarchDrawChecked, exileDamageChecked, lifeWatchRef, processedBlockBatchRef, processedAttackBatchRef },
  };
}
