# src/components map

* `AppFlow.tsx` - the `AppFlow()` component: now only glue + JSX (state and handlers live in `game/`, see below). Also re-exports engine symbols that tests import.
* `SetupScreen.tsx` - setup-screen JSX (status tiles, PLAY, saved games list, per-seat deck panels). Props only.
* `GameOverDialog.tsx` - "Game over" modal. Props only.
* `DeckSetup.tsx` - `DeckSetupPanel`, `Topbar`, `Status`, `SeatConfig`/`SavedDeck`, deck validation and `applyDeckToSeat`.
* `ThreeGameTable.tsx`, `PlayerBoard.tsx`, `GameTable.tsx`, `VisualCard.tsx`, `ZoneSummary.tsx` - the in-game table UI.
* `viewModels.ts` - `ruleChoiceView` / `blockChoiceView` (what choice dialogs show).
* `hooks/usePriorityStopSettings.ts` - state: human priority-stop settings (persisted); returns `{priorityStopSettings, updatePriorityStopSettings}`.
* `hooks/useDeckLibrary.ts` - state: per-seat `configs`, `deckLibrary` (fetched from /api/decks/library), `defaultDecksApplied` ref.
* `hooks/useSavedGames.ts` - state: `savedGames` list (refetched from /api/saves when `mode === "setup"`).
* `hooks/useStackState.ts` - state: stack, pending action, priority passes, priority seat (pure transitions in `engine/stack.ts`); ref-synchronous setters.

Hooks must be called at the same position in `AppFlow()` they were extracted from (React effect order). Engine/rules code lives in `src/engine/`.

Stack/priority: `engine/stack.ts` (`StackState` + pure transitions: open window, pass, resolve top, snapshot/restore) and `engine/priority.ts` (who must pass) hold the logic; `hooks/useStackState.ts` wraps it as `stackStore` (`.state` for render, `.ref.current` for always-current reads in timers). `useGameState` (`game/context.ts`) calls `useStackState` once, at the position of the old `activeSeatId` useState, and derives `stackActions`/`pendingAction`/`priorityPasses`/`prioritySeatId`/`activeSeatId` from it; `ctx.stack.stackStore` is the handle game hooks use (`stackStore.ref.current.<field>` for always-current reads, `stackStore.snapshot()/restore()` for save/load). The old setter names (`setPendingAction`, `setPriorityPasses`, `setPrioritySeatId`, `setActiveSeatId`) are still on ctx; `replaceStackActions`/`pushStackAction`/`updateStackAction`/`removeStackAction` are aliases of the store methods in `game/useStackResolution.ts`. Modules own logic.

Decisions (prompts as serializable data): `engine/decisions.ts` defines `PendingDecision` ("awaiting a decision from seat X"; kinds so far `mana_color`, `declare_blockers`), `DecisionAnswer`, and pure `openDecision` (double-open guard), `validateAnswer`, `viewForSeat` (private payloads are redacted for other seats). `hooks/useDecisionState.ts` holds one decision per kind (a mana choice can be open during a block choice) with an always-current ref; `useGameState` calls it once and exposes `ctx.choices.decisions`, while `manaChoice`/`blockChoice`/`setManaChoice`/`setBlockChoice` remain as derived views and thin adapters (setter replaces, undefined clears). `decisions.hasOpen` feeds the save gate.

## game/ - the AppFlow() handlers, split by concern

`AppFlow()` itself is now glue + JSX. Its state and handlers live in `game/`; every hook takes the same `ctx: GameContext` and returns the functions other
code needs. Bodies were moved verbatim; each hook starts with a preamble that destructures what it uses from `ctx`.

* `game/context.ts` - `useGameState(initialSession)` (all useState/useRef/derived values, also the three `hooks/` calls and the first effect), `GameState`,
  `GameContext`, `HandlerApi`, `lateFn`.
* `game/useManaUi.ts` - mana pool bookkeeping, tap-for-mana, card inspect.  `game/useGameActions.ts` - addEvent, changeLife, zone moves, counters.
* `game/useGameSetup.ts` - buildDeck, startGame, mulligans, save/load.  `game/useTurnFlow.ts` - advanceTurn/endTurn/phase advance, sagas, cumulative upkeep.
* `game/useCombatUi.ts` - declareAttack, human blocks.  `game/useStackResolution.ts` - stack helpers, passPriority, beginPendingAction,
  respondWithCard, resolvePendingAction(+Now).  `game/useTriggerResolution.ts` - trigger prompts/resolution.
* `game/useCasting.ts` - playCard + cast prompts, loyalty, commander, graveyard/exile casting.  `game/useAbilities.ts` - activated abilities, equip.
* `game/useChoicePrompts.ts` - answers to every pendingRuleChoice kind, library-look windows.  `game/useSpecialEffects.ts` - Myriad Landscape, basic-land fetch, Lim-Dul's Vault.
* `game/useAgentDriver.ts` - requestAgentDecision, decide*/apply* for agent seats.  `game/useRulesAdvisor.ts` - Rules Advisor / static-effect interpreter bridges.
* `game/useGameEffects.ts` - ALL the useEffect blocks, original relative order (triggers, SBA detection, phase timers, agent scheduling).

GameContext shape: `{ session, setSession, humanSeat, mode, activeSeatId, ...(flat core); stack: {stackStore, pendingAction, stackActions, priority*, stackFeed, resolve/ability refs};
mana: {...}; choices: {...}; agent: {...}; turn: {...per-turn refs}; late: HandlerApi }`. To add a handler: put it in the hook of its concern; if another hook (or `AppFlow()`)
needs it, add it to that hook's `return { ... }` - the type flows into `HandlerApi` automatically; call foreign handlers with `const foo = lateFn(ctx, "foo")` in the preamble.
New state goes in `useGameState` (pick a group). Never call a `lateFn` handler while a hook is still running (render time) - only from events/effects/timers.
