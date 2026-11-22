# Kernel integration plan: putting `src/kernel/engine` into the real game behind a per-deck flag

Status: design only (2026-11-22). No code, tests, drafts or data were changed to write this.
Branch: `multiplayer`. Audience: the user (has not read the source) and the subagents that will build it.

Read this first, in 10 lines:

* The kernel is a complete, pure rules server (`resolve(state, action, ctx)`), but it is only used by the headless observer. The live game
  (`AppFlow` + 14 hooks in `src/components/game/` + `src/engine/*`) still runs 100% on the legacy engine and its `GameSession`.
* Recommended architecture: **host-authoritative kernel state, a read-only derived `GameSession` for the existing table, and a second
  implementation of the same intent API** (the `on*` callbacks that `ThreeGameTable` and the multiplayer `INTENT_SPECS` already use).
  The renderer is NOT rewritten (ThreeGameTable is 5,616 lines).
* The flag is per deck; a game runs on the kernel only if EVERY played seat's deck is kernel-ready (the kernel is one engine per game).
* The legacy path stays untouched and is the default. A shadow recorder on the legacy path measures agreement per deck.
* First slice: solo game, one deck, one turn untap -> end step (land, targeted spell, attack, pass). About 14 files, 9 of them new.
* 11 phases, 4 of them can run in parallel pairs. See section 8.

---------------------------------------------------------------------------------------------------

## 0. What exists today (facts the plan relies on)

| Piece | Where | Fact |
|---|---|---|
| Kernel actions | `src/kernel/engine/types.ts` (`Action`) | `castSpell`, `activateAbility`, `playLand`, `passPriority{fastForward}`, `answerDecision{decisionId, choice}`, `advancePhase`, `declareAttackers`, `declareBlockers`. Every action carries `player`. |
| Errors | `ResolveResult.error.code` | includes `unsupported` + `capability[]`. On ANY error `resolve` returns the ORIGINAL state object (atomic, nothing half-done). |
| Pending decisions | `state.pending` / `ResolveResult.pending` (`PendingView`) | 16 kinds, each with `id` (monotonic via `state.decisionSeq`), `player`, `prompt`, `options[{id,label}]`, `min`, `max`, `cancellable`. While set, only `answerDecision` is accepted. |
| Hidden info | `src/kernel/engine/view.ts` | `viewFor(state, viewer)`, `eventsFor`, `pendingFor`, `viewResult`. Accepts any viewer id (a non-player id = spectator view: no hands). |
| Legacy -> kernel adapter | `src/kernel/observer/adapter.ts` | `toKernelState(session, {lookup}) -> {state, toKernel, toLegacy, gaps, noDraft}`. Mulligans are NOT in the kernel; `newGame` deals the opening hand. |
| Intent mapping | `src/kernel/observer/actions.ts` | `mapIntent(name, args, seat, s0)`, `INTENT_COVERAGE` for all ~105 wire intents (about 22 `mapped`, ~50 `partial`, ~33 `unmapped`, many of the unmapped are UI settings), `defaultAnswer(pending, state, actor)`, `runMapped`. |
| Card source | `src/kernel/observer/draftLookup.ts` | **Node only** (reads `data/kernel-drafts/**` + `data/cards.db` via sqlite). The browser has no kernel card lookup yet. Drafts are 5.2 MB total for 766 cards (13 decks). |
| What is missing in the kernel | grep for `legalActions` in `src/kernel` = no hits | **No legal-action query**, no public "effective characteristics of every object" view, no event-to-text log formatter (events are `{type: string, ...}`), no timer, no mulligan. |
| Legacy driver | `src/components/game/useGameEffects.ts` (1,258 lines, ~40 timers), `useAgentDriver.ts` (772), `useTurnFlow.ts` (607) | The legacy game is driven by React effects reacting to `session`. Kernel mode needs its own driver. |
| Legacy has a stack in the UI path | `useStackState`, `useStackResolution`, `engine/priority.ts` | The self-play engine does not (the observer README notes this), the interactive game does. |
| Readiness numbers (OVERVIEW.md) | `data/kernel-drafts/OVERVIEW.md` | unsupported-card count per deck ("needed"): Wretched Ranks 3, Tramplesaurus Rex 5, Keen Engineering 7, Calling All Angels 7, **Saheeli 9**, Reign of Dragons 13, Squirreled Away 11, Meren 17, Aminatou 22, Ur-Dragon 25. |

Note on the Saheeli scope request: the coordinator asked (mid-task) to add Saheeli (9 unsupported, 93.3% agreement) to a "round 2 with
READINESS.md" job. That job is not part of this planning task (and this task must not touch drafts/data), so it is only reflected here:
Saheeli is listed as a priority readiness target in section 5 and as pilot deck B in section 6. The three-decks-then-Saheeli ordering is
kept (Wretched Ranks, Tramplesaurus Rex, Keen Engineering, then Saheeli).

---------------------------------------------------------------------------------------------------

## 1. INVENTORY: every call into legacy rule logic, and its kernel replacement

Counting method: identifier occurrences of symbols imported from `@/engine/*` (scripted count, approximate; excludes tests).
Test blast radius: 86 `src/components/AppFlow.*.test.ts` files test the legacy path through AppFlow re-exports; they stay as the legacy
regression suite and are NOT migrated (the kernel has its own ~350 tests).

Who imports `@/engine/*` (files with direct imports): `AppFlow.tsx` (32 import lines, mostly re-exports for tests), `useStackResolution` 21,
`useGameEffects` 18, `useCasting` 17, `useChoicePrompts` 16, `useAgentDriver` 15, `useTriggerResolution` 14, `useTurnFlow` 12,
`useAbilities` 12, `seatPrompts.ts` 9, `useCombatUi` 9, `useSpecialEffects` 6, `useRulesAdvisor` 6, `useGameSetup` 6, `useManaUi` 4,
`useGameActions` 4, `context.ts` 4, `agentRuntime.ts` 3, `mpIntents.ts` 3, `selfplay/orchestrator.ts` 2, `hooks/useStackState.ts` 2,
`hooks/useDecisionState.ts` 2, `useSeatYield` 2, and singles in `summoningSickness`, `stackedCards`, `priorityStops`, `mulliganGate`,
`answerGuard`, `useMpHost`.

### 1.1 Table of subsystems

Counts are occurrences in `src/components/game/*` / (AppFlow, viewModels, hooks) / `src/lib/multiplayer` / other `src/lib`.

| # | Subsystem | Legacy functions called (files) | Count (game hooks / flow+hooks / mp / lib) | Kernel replacement |
|---|---|---|---|---|
| A | **Mana & payment** | `engine/mana.ts` (`chooseManaSourcesForCost`, `payCostFromPool`, `spendManaSources`, `manaChoicesForCard`, `isAvailableManaSource`), `simpleManaSource.ts`, `tapUsed.ts`; hooks `useManaUi`, `useCasting`, `useAbilities`; `AppFlow.tsx` (selectedCardCanRespond) | 125+5+2 / 3 / 3 / 0 | `castSpell{payWith?, autoPay}`, `activateAbility` (mana abilities add to `manaPool`), decisions `choose_color`, `assign_mana`, per-unit pool (`manapool.ts`). Manual tapping = `activateAbility` on the mana ability. "Can I afford it" = new `legalActions` query (4.2). |
| B | **Triggers** (ETB, cast, attack, death, phase, batch, scripted) | `engine/triggers.ts` (3,739 lines), `triggerFinders.ts`, `cardScripts.ts`, `triggerPrompts.ts`, `phaseTriggers.ts` (lib); hooks `useTriggerResolution` (981 lines), `useSpecialEffects`, `useGameEffects` | 116+28+4+4 / 0 / 0 / small | Kernel puts triggers on the stack itself (`triggerQueue`, `order_triggers` decision). The whole `useTriggerResolution` hook and the "processed batch" refs in `context.ts` are not called in kernel mode. |
| C | **Spell/effect resolution** | `engine/effects.ts` (3,962 lines), `oneShotEffects.ts`, `entry.ts`, `etb.ts`, `tokens.ts`, `zones.ts`, `abilities.ts`, `cardAbilities.ts` | 91+48+9+35+7+73+61+6 / 4+2+2+2 / 2+2+2 / 0 | `resolve` with `passPriority` (resolves the top stack item). Rules Advisor (`useRulesAdvisor`, `/api/rules/*`) is not called: kernel cards are data. |
| D | **Casting & targeting** | `casting.ts`, `castTargets.ts`, `costs.ts`, `legalActions.ts` (`checkMoveLegal`), `lib/moveLegality.ts`, `lib/targeting.ts`; hooks `useCasting` (1,389), `useAbilities` (765) | 67+40+40+27 / 9+4+4+5 / 4+1 / 0 | `castSpell{modes,targets,x}` and the decisions `choose_modes`, `choose_targets`, `choose_x`, `choose_cast_option`, `cast_target_player`, `choose_cards` (cost choices). Legality = the kernel's own errors (`wrong_timing`, `illegal_target`, `cannot_pay`) + the `legalActions` query. `checkMoveLegal` and `moveLegality.ts` are bypassed for kernel decks (the kernel is the referee). |
| E | **Stack & priority** | `engine/priority.ts` (`pendingActionRequiredPasses`, `canReceivePriorityForPendingAction`, `resolutionPromptNote`, `withPendingActionSourceCard`), `stack.ts`, `yieldPolicy.ts`, `lib/priorityStops.ts`; hooks `useStackResolution` (1,603), `useSeatYield`, `hooks/useStackState`, `AppFlow.tsx` (stack panels) | 30+6 / 14+6 / 1 / 1 | `state.stack`, `state.priority`, `state.passes`, `passPriority`. Priority STOPS (when a human is actually asked) stay a host-side policy: `lib/priorityStops.ts` + `yieldPolicy.ts` are pure settings and are reused, but "does this seat have a legal response" comes from `legalActions(state, seat, {instantSpeed:true})`. Required-pass pips = `state.passes` vs alive players. |
| F | **Combat** | `engine/combat.ts` (`canAttack`, `legalAttackActions`, `legalBlockActions`, `assignBlockers`, `resolveCombatDamage`, `cleanupCombat`, `attackLockedOut`), `damage.ts`, `lockdownEffects.ts`, `lib/combatSim.ts`; hooks `useCombatUi` (307), parts of `useTurnFlow`; `AppFlow.tsx` (humanAttackTargets), `seatPrompts.ts`, `mpIntents.ts` | 30+1 / 4 / 2+2 / 0 | `declareAttackers{attackers:[{id,defender}]}`, `declareBlockers{blocks}`, decision `assign_damage`. Legal attackers/defenders/blocks: `combat.ts` exports `legalAttackers`, `defenderOptions`, `attackProblem`, `blockProblem` (internal `Run`-based; need a public wrapper, see 4.2). `combat.expect` says who must declare. |
| G | **Turn structure** | `engine/turnFlow.ts` (`untapForSeat`, upkeep draws, end step, seat rotation, `rollForStartingSeat`), `stateBased.ts` (`checkStateBasedActions`, called on EVERY `setSession` in `context.ts`), `mulligan.ts`; hooks `useTurnFlow`, `useGameEffects` | 43+4+23 / 0 / 1 / 0 | `advancePhase`, `passPriority`, kernel turn steps, SBA inside `resolve`. `setSession`'s SBA wrapper is irrelevant in kernel mode (the derived session is never mutated). Mulligan stays on the legacy path (see 2.4). |
| H | **Library / look / search** | `etb.ts` (myriad, basic land fetch), `oneShotEffects.ts` (`searchableLibraryCards`), `effects.ts` library-look workflows; hooks `useChoicePrompts` (1,210), `useSpecialEffects` | in B/C counts | `search_library`, `look_top`, `reveal` steps -> decisions `choose_cards` / `choose_option`. |
| I | **Choice prompts** (rule choices, optional triggers, discard, color/type) | `PendingRuleChoice` (src/engine/types.ts:482, ~30 kinds), `hooks/useDecisionState`, `useChoicePrompts` (16 `on*Complete*` handlers), `lib/multiplayer/seatPrompts.ts`, `answerGuard.ts` | n/a | `state.pending` + `answerDecision`. Details in section 3. |
| J | **AI decisions** | `useAgentDriver` (772), `lib/actionScoring.ts`, `lib/playGuards.ts`, `lib/moveLegality.ts` (`decideWithGate`), `lib/selfplay/brains.ts`, `/api/agents/action` | 15 / 0 / 0 / 3 (`agentRuntime`) | New `kernelLegalActions` + `mapAgentAction`. Details in section 4. |
| K | **Setup / save / multiplayer plumbing** | `useGameSetup` (612: `startGame`, mulligans), `saveGame.ts`, `sessionStore.ts`, `useMpHost.ts` (`readSnapshotInput`), `snapshot.ts`, `view.ts`, `seatPrompts.ts`, `mpIntents.ts`, `intentSpecs.ts` | 6 / 0 / 9+3 / 0 | New `KernelSession` object + `KernelHostBridge`. Details in section 2. |
| L | **Self-play / observer** | `lib/selfplay/orchestrator.ts` (1,263 lines, calls many exported AppFlow functions), `scripts/kernel-observer.ts` | 2 | Stays legacy for now (it IS the regression harness). A kernel self-play runner is phase 10. |
| M | **Display-only helpers reading legacy fields** (no rules, but they read `VisibleCard` fields the kernel does not have) | `lib/counters.ts` (`effectivePower`), `summoningSickness.ts`, `activatedAbilities.ts`, `attachments.ts`, `cycling.ts`, `graveyardCasting.ts`, `libraryCasting.ts`, `typeGrants.ts` used by `ThreeGameTable.tsx` lines 17-49 | n/a | Fed by the reverse adapter (2.3): it fills the same fields (`tapped`, `counters`, `summoningSick`, P/T bonuses, `attachedToId`, ...). The table's own "can I cast it" button logic (`handCardFaceOptions`, `canCastAtInstantSpeed`) is replaced by `legalActions` flags on the derived card (`playable: {cast, land, face[]}`). |

### 1.2 Table-facing API (the seam that makes this feasible)

`ThreeGameTable` takes about 130 props, almost all `on*` callbacks whose names are exactly the wire intents in
`src/lib/multiplayer/intentSpecs.ts` (`INTENT_SPECS`). `AppFlow` fills them from the hooks (`late` = `HandlerApi`). So:

> The kernel path = a second `HandlerApi` provider (`useKernelHandlers`) with the same callback names and signatures, plus a derived
> `GameSession`. ThreeGameTable, `RemoteTable`, the intent whitelist, zod specs and `IntentQueue` stay as they are.

Callback -> kernel action (the table already exists in `INTENT_COVERAGE`; the new work is to turn `partial` rows into real code):
`onPlayCard` -> `playLand | castSpell` (type line decides), `onCastCommander` -> `castSpell` from `command`, `onTapForMana`/`onClickPermanent` ->
`activateAbility` (mana ability), `onActivate*Ability` -> `activateAbility` (ability id found by `abilityIdFor(card, legacyIndex)`, see 4.2),
`onPassPriority` -> `passPriority`, `onAdvanceTurn` -> `advancePhase`, `onEndTurn` -> repeated `passPriority{fastForward}` until the
next turn of that seat or a decision, `onDeclareAttack`/`onConfirmBlockers`/`onPassBlocks` -> `declareAttackers`/`declareBlockers`,
all `onChoose*`/`onComplete*`/`onAccept*`/`onDecline*` -> `answerDecision` (section 3).
UI-only intents (`onToggleFullControl`, `onTogglePhaseStop`, `onStopNext`, `onToggleYield`, `onMoveBattlefieldCard`, ...) are untouched:
they stay host-side settings (`priorityStopSettings`, `seatYields`).
Sandbox/test tools (`onDrawCard`, `onMoveCardTo*`, `onChangeLife`, `onChangeCounter`, `onOpenLibrarySearch`): hidden in kernel mode in slice 1;
later re-implemented on top of a host-only `kernelDebug.*` helper that wraps `debugPlaceCard`-style state edits (never an action, never from a guest).
Legacy-specific prompts with no kernel twin (`onResolveMyriadLandscape`, `onResolveBasicLandFetch`, `onChooseMyriadTap*`, vault look,
`onSacrificeRuleSource`/`onPayCumulativeUpkeep`, `onUnlockRoomDoor`): not offered in kernel mode; cards using them must be `unsupported`
until the kernel has the mechanic, which the readiness gate guarantees (cumulative upkeep, rooms, myriad are on the OVERVIEW "still not done" list).

---------------------------------------------------------------------------------------------------

## 2. STATE OWNERSHIP

### 2.1 Where the authoritative state lives

| Mode | Owner | Notes |
|---|---|---|
| Solo (flagged deck) | A `KernelSession` object in the browser (a ref inside `useKernelGame`, with a React `version` counter to re-render). | Pure JSON state; also persisted in the save file. |
| Multiplayer, host-browser model (today) | Same object in the HOST's browser. Guests never get the full state. | Matches the current "host-browser-authoritative, server only relays" architecture (`src/lib/multiplayer/README.md`). |
| Multiplayer later (server-authoritative) | Same `KernelSession` class moved to the server (Node can run it, it is pure) behind WebSocket. | The design keeps it movable: `KernelSession` has no React/DOM imports; its API is `dispatch(seat, action) -> {events, error}` and `viewFor(seat)`. The legacy intents are translated at the edge, not inside it. |

`KernelSession` (new, `src/kernel/play/session.ts`, pure):
```
class KernelSession {
  state: GameState;                      // the ONLY truth in kernel mode
  ctx: EngineContext;                    // cards lookup + db (from the card pack, 2.5)
  idMap: { toLegacy(id), toKernel(id) }; // kernel `#n` <-> legacy VisibleCard.id, from the adapter; tokens get synthetic entries
  templates: Map<ObjId, VisibleCard>;    // display data (image URIs, oracle text) keyed by kernel id
  log: LogEntry[];                       // formatted events (newest first, same shape as GameSession.events)
  dispatch(action): ResolveResult        // calls resolve(), appends log, rejects stale decision ids, never throws
  view(seat): PlayerView                 // viewFor
}
```
Rule: every state change in kernel mode goes through `dispatch`. No hook calls `setSession` on a kernel game.

### 2.2 GameSession vs kernel state: RECOMMENDATION

Two options were asked about:

**Option A (recommended): GameSession becomes a derived, read-only projection built by a reverse adapter**
(`src/kernel/play/toSession.ts`: `toSession(session: KernelSession, forSeat) -> GameSession`), memoised on `state.clock` + `decisionSeq`.

**Option B: move the renderer to the kernel `PlayerView`.**

Why A:
1. `ThreeGameTable.tsx` is 5,616 lines, reads `VisibleCard` fields all over (`effectivePower`, `isSummoningSick`, `attachedToId`, `grantedKeywords`,
   counters, face data) plus ~15 `@/lib` helpers that parse oracle text. Rewriting it is the single biggest cost in the project and produces
   nothing the player can see.
2. The whole multiplayer snapshot stack (`snapshot.ts`, `view.ts` `buildGuestSession`, `seatPrompts.ts`, `RemoteTable`, leak tests
   `seatSnapshot.test.ts`) is typed on `GameSession`. With A it keeps working unchanged and gets the kernel's redaction as a first filter.
3. A can be done incrementally: fields the adapter does not fill simply render as "no bonus / no badge". The adapter already exists in the other
   direction (`toKernelState`, `ADAPTER_COVERAGE` lists the mapping), so the field list is known.
4. A keeps a clean exit: when the legacy path is deleted later, Option B can be done as a pure UI refactor without touching rules.

The honest costs of A: (a) derived fields must be computed from the kernel (effective P/T, keywords, summoning sickness, "cannot attack")
-> the kernel must export a public characteristics view (4.2, `objectViews`); (b) cards in the kernel's `GameObject` carry only `cardName`, so
display data (images, oracle text) comes from per-game `templates` made at game start from the same legacy deck -> `VisibleCard` builder
(`engine/mulligan.ts` `makeShuffledLibrary`); tokens get a template made from `token` + `TokenDef` (`tokenArt.ts` already makes token art).
(c) A is one-way; nothing ever writes the derived session back. If a guard test finds a code path that does, it fails (test in phase 2).

### 2.3 Reverse adapter contract (`toSession`)

Input: `KernelSession` + viewer seat (or `SPECTATOR`). It first applies `viewFor(state, viewer)` so hidden zones are already redacted, then maps:

| Kernel | `GameSession` field |
|---|---|
| `players[].life/hasLost/id/name` | `seats[].life/hasLost/id/name`; `kind` / `deck` / `commander` taken from the original setup seats (not kernel data) |
| `players[].hand` (viewer only), `handCount` | `board.hand` (real cards for viewer; stub cards `{id:"hidden-n"}` for others: same stubs `view.ts` already makes) |
| `battlefield`, `objects[].tapped/counters/damage/attachedTo/controller` | `board.battlefield[]` `VisibleCard` with `tapped`, `counters`, `damage`, `attachedToId`, `ownerSeatId` (controller grouping) |
| `chars(id)` via `objectViews` | `typeLine`, `power`/`toughness` plus a computed `temporaryPowerBonus`-style delta so `effectivePower` returns the kernel number, `grantedKeywords`, `summoningSick` |
| `graveyard`, `exile`, `command` | same-named board arrays (public) |
| `stack[]` | `pendingAction` / `stackActions` (`PendingActionView`) for the existing stack panel; `StackItem.parts` give the target text |
| `turn`, `priority`, `passes` | `turn`, `phase` (via inverse of `LEGACY_TO_KERNEL_PHASE`), `activePlayerId`, `prioritySeatId`, `priorityPasses` |
| `combat` | `attacking`/`attackTargetId`/`blocking`/`blockingTargetId` on cards |
| `monarch`, `commanderDamage`, `manaPool` | `monarchSeatId`, `seat.commanderDamage`, `manaPools[seat]` (also published as `myManaPool`) |
| `pending` (viewer's own) | prompt slots (section 3), NOT a session field |
| `log` | `events[]` (strings; viewer text rewrite stays in `viewerText.ts`) |

Test: a round-trip fixture suite `toKernelState(toSession(k))` ~ `k` (the observer's `compare` normaliser already defines "equal").

### 2.4 Game start and mulligans (reuse, do not remodel)

1. Setup, deck build, `startGame`, opening hands, **London mulligan UI and agent mulligans run exactly as today on the legacy session**
   (`useGameSetup`, `mulliganGate.ts`; the kernel has no mulligan and the observer README lists it as a known gap).
2. When the last human keeps (`gameStage` flips to `"playing"`, the same moment `useMpHost` already detects), `startKernelGame(session)` calls
   `toKernelState(session, {lookup: packLookup})`, builds `templates` from the session's `VisibleCard`s (so images and oracle text match what the
   players saw during the mulligan), creates the `KernelSession`, and from then on kernel mode owns the game. The legacy `session` is frozen.
3. The first-draw rule (2-player first seat skips draw) is already the kernel default (`skipFirstDraw: players.length === 2`).
   Legacy had a bug here (fixed in the latest commit); not an issue for kernel games.

### 2.5 Card data in the browser

`draftLookup.ts` reads files and sqlite, so it cannot ship to the browser. New route `app/api/kernel/pack?deck=<name>` (server side, reuses
`draftLookup` internals) returns a JSON "card pack": every draft CardDef of that deck + printed `CardInfo` (types, cost, P/T, faces) +
creature-type list. Size per deck is well under 1 MB (all 13 decks = 5.2 MB). The browser builds `CardLookup`/`CardDb` from the pack
(`src/kernel/play/pack.ts`, pure). For a multi-deck game the packs are merged by card name. Tokens and copies are defined by the cards that make
them, so no extra data. The pack also carries `READY.json` status (5.1) so the client can show why a deck is "legacy only".

### 2.6 How guests receive snapshots

Unchanged transport (SSE `stream` + POST `publish`, `PublishGate`, per-slot snapshots every 40-120 ms). Changes, all in new code:

* `readSnapshotInput(ctx, hostName)` in `useMpHost.ts` gets a kernel branch (extract to `src/components/game/kernelSnapshotInput.ts`, keeping AppFlow/useMpHost thin):
  `session = toSession(kernelSession, viewerSeat)` per viewer (the existing `buildSnapshot(input, viewer, rev)` is called per viewer already, so the
  input becomes a function of the viewer), `prompts` from the viewer's own pending decision only (section 3), `requiredPasses` from `state.passes`.
* The kernel `viewFor` redaction happens BEFORE `toSession`, so even a bug in `buildGuestSession` cannot leak a hand or library. `seatSnapshot.test.ts`
  gets a kernel twin (build 4 views, assert no foreign card name appears anywhere in the JSON).
* `MpSnapshot` v3 adds `decision?: { id, kind, deadlineAt, serverNow }` for the viewer's own decision and `turnClock` (3.5). Guest keeps rendering
  with the same `RemoteTable`.
* Events: kernel events are filtered with `eventsFor` and formatted by the new `formatEvent(event, viewer)` (`src/kernel/play/log.ts`) into the same
  text lines `viewerText.ts` expects. Reveals (public) vs looks (private) follow the 2026-11-16 visibility decision: `reveal` events are shown to all,
  `looked_at` only to the looker, graveyards and exile (face up) are public, hands/libraries private. This also fixes the "reveal not shown yet"
  gap listed in the multiplayer memory notes, because the kernel already emits structured `reveal` events.
* Intents: guest -> host unchanged (`INTENT_SPECS`, zod, `seatArgs`, `IntentQueue`). New whitelist entry `onAnswerDecision(decisionId, choice)` (3.4).
  Because kernel actions are applied synchronously by `KernelSession.dispatch` (no React closure), the "one intent per React commit" queue is no longer
  needed in kernel mode, but it is kept (harmless, same code path for both engines).

---------------------------------------------------------------------------------------------------

## 3. DECISION UI

### 3.1 Principle

Legacy prompts are bespoke per `PendingRuleChoice.kind` (about 30 kinds, each with its own callbacks, none carrying a prompt id: `answerGuard.ts`
says "the wire carries no prompt id"). Kernel decisions are uniform (`kind`, `options[{id,label}]`, `min/max`, `cancellable`, `id`).
Strategy: one **`KernelDecisionHost`** (new component, `src/components/KernelDecisionDialog.tsx`) renders from the viewer's `PendingView`. For the 5 kinds
where an existing modal fits exactly, the same modal is reused through a small view-model shim; everything else uses one generic
"pick N of these cards/options" dialog (it can reuse `cardHoverHandlers` and `VisualCard` for the card previews, since options of kind
`choose_cards`/`choose_targets` are object ids that resolve to derived `VisibleCard`s).

### 3.2 Mapping of the 16 kernel kinds

| Kernel `kind` | Meaning | Existing component to reuse | Gap |
|---|---|---|---|
| `choose_modes` | modes of a modal spell (min/max, `repeatable`) | `ModalSetModal` (multi) / `ModalOptionModal` (single) in `ThreeGameTable.tsx` (ModalSet takes positions into the options list: the shim maps position <-> option id) | none |
| `choose_targets` | targets for a spell/ability, or search/selection targets | Board-click targeting (`chooseEffectTarget`, `onChooseBattlefieldCreatureTarget`) + `TargetPickerModal` (graveyard/zone targets) + `PlayerTargetModal` | Mixed zones in one decision (a player + creatures + a card in a graveyard) need the generic dialog; it groups options by zone/owner |
| `cast_target_player` | pick a player for "target player" at cast | `PlayerTargetModal` | none |
| `choose_x` | numeric X for a spell/ability | none good (legacy `choose_cast_x` is a list of options) | **NEW** `NumberPromptModal` (min/max, stepper, shows affordable max) |
| `choose_number` | other numeric answers | same | NEW (same component) |
| `choose_cards` | discard, sacrifice, scry/surveil picks, cleanup discard, cost choices | `DiscardToHandSizeModal`, `PutCardsOnLibraryModal`, `ConniveDiscardModal`, `ReturnLandToHandModal`, `ChoosePermanentToBlinkModal` (all are "select k cards, confirm") + `LibrarySearchModal` for `search_library` | One generic `CardPickModal` replaces the five; scry/surveil has top/bottom/graveyard buttons in `LibraryLookModal` (kernel models it as `choose_cards` or `choose_option` per step: confirm in phase 5 which) |
| `choose_yes_no` | "may" steps, commander zone replacement, miracle | `OptionalTriggerModal`, `CommanderZoneChoiceModal`, `MiracleOfferModal` | none (shim picks by prompt title) |
| `pay_unless` | "unless you pay" | `OptionalTriggerModal` with a cost line | shows cost text from `prompt` |
| `choose_color` | color choice | `ChooseColorModal` | none |
| `choose_option` | creature type, Phyrexian mana/life, named options | `ChooseCreatureTypeModal` when options are types; generic list otherwise | NEW `OptionListModal` (can be the generic dialog) |
| `choose_cast_option` | alternative cost / face / flashback choice | `ModalOptionModal` (legacy `choose_cast_alt`, `choose_cast_face`) | none |
| `order_triggers` | order simultaneous triggers | `OrderTriggersModal` | none |
| `order_replacements` | order replacement effects | `OrderTriggersModal` (same shape: pick the first to apply) | none (title text differs) |
| `assign_damage` | divide combat damage among blockers (answer `{assign: {id: n}}`) | none (`BlockChoiceModal` is the DEFENDER's block UI) | **NEW** `AssignAmountsModal` (total, lethal per recipient, trample) |
| `assign_mana` | split N mana between colors | `DistributeManaModal` | none |
| `assign_counters` | split counters | none | **NEW**, same `AssignAmountsModal` |

Prompt types with NO UI yet: `choose_x`/`choose_number` (numeric), `assign_damage`, `assign_counters`, and the generic mixed-zone target list. That is
three new small components (`NumberPromptModal`, `AssignAmountsModal`, `CardPickModal`/`OptionListModal`; the last two can be one file).
Also not a decision but needed: **declare attackers / declare blockers are turn-based actions, not decisions**: `combat.expect` says who must declare.
Attack UI exists (`onDeclareAttack`, `humanAttackTargets`, one attacker per intent): kernel mode collects the picks locally and sends ONE
`declareAttackers` on "Done" (adds a Done button; today each attacker is its own intent). Blocks reuse `BlockChoiceModal` and send one `declareBlockers`.

### 3.3 Who sees what

`pendingFor(pending, viewer)` already hides options of other players' decisions (`hidden: true`, `optionCount`). The snapshot carries the viewer's own
`PendingView` only (plus a public "Waiting for <name> (kind)" line for others, from the hidden view: kind, prompt title). The legacy
`promptSlotsForSeat`/`seatPrompts.ts` gate is bypassed in kernel mode, replaced by `pendingFor`. The AppFlow table receives the host's decision
only when `pending.player === hostSeat`.

### 3.4 Stale / duplicate answer protection

* Every answer carries `decisionId` (`state.pending.id`; the kernel rejects a wrong one with `wrong_decision`, a non-owner with `not_your_decision`,
  none open with `no_decision`).
* The dialog is rendered FOR a specific id; its callbacks are created per id (`makeAnswer(pending.id)`), so a late click on an old dialog cannot
  answer a newer decision. Host `KernelSession.dispatch` turns those kernel errors into a quiet "that choice is no longer open" toast, not an error.
* New wire intent `onAnswerDecision(decisionId: string, choice)` in `intentSpecs.ts` with `when: "answerDecision"` (the sender's seat must own
  `state.pending.player`); the zod `choice` schema mirrors kernel `Choice` (ids list <= 200, number, yes, assign record, cancel). `answerGuard.ts` is not
  used for it: the kernel's `invalid_choice` already validates options against current zones. `INTENT_COVERAGE` and its coverage test gain the new name.
* Duplicate delivery: `IntentQueue` drops old `clientSeq` already; in addition the decision id makes a re-POST idempotent (second answer = `wrong_decision` / `no_decision`).
* Priority windows have no decision id. They get a synthetic window key `turn:phase:stack.length:priority:clock`; the timer (3.5) and the pass intent
  `onPassPriority` carry/check it (`onPassPriority(windowKey?)`; a mismatch is ignored so a double click on Pass cannot pass TWO windows).

### 3.5 Timer behaviour (user decision, 2026-11-16: Hearthstone style, authoritative, no AI takeover, no indefinite wait)

Where: host-side `DecisionClock` (pure module `src/lib/multiplayer/decisionClock.ts`, injected `now()`), driven by one `setInterval(250)` in
`useKernelDriver`. Absolute `deadlineAt` + `serverNow` go in the snapshot so guests render the countdown without clock skew. Later moves with
`KernelSession` to the server unchanged.

* Scope (decision needed, see section 7): the clock runs for REMOTE (friend) seats only by default. The host's own seat and solo play have no clock
  (setting `hostClock: off`); AI seats act on their own pace.
* Budget: one window per "thing the seat owes": an open decision, a priority window the seat is actually stopped on (per `priorityStops`), declare
  attackers/blockers. Total 3:00 per window; at 2:30 elapsed the final **30 s warning** starts (visual effect + sound, `decision.warning = true`);
  at 3:00 the engine auto-advances. (The memory note says "about 3 minutes; once 2 minutes have passed a final 30 s countdown", which does not add up
  to 3:00; this plan uses 2:30 + 0:30. Open question Q3.)
* Timing is paused while the game is paused (`mpPausedFor`, a disconnected friend), and a fresh window restarts the clock.
* **Auto-advance defaults per kind** (the engine never decides FOR the player beyond the least-committal legal move; no AI takeover; the log says "X ran out of time"):

| Window / kind | Default on timeout |
|---|---|
| Priority window (own stop) | `passPriority` |
| Declare attackers | `declareAttackers {attackers: []}` (no attack) |
| Declare blockers | `declareBlockers {blocks: []}` |
| Any `cancellable` decision (spell being cast: modes, targets, X, cost choice, cast option) | cancel (the kernel makes cancel free: it is asked before payment) |
| `choose_yes_no` | the safe side: "no" for may-effects and for "pay unless", **"no" for commander zone replacement is wrong for a commander**, so `yes` for the commander zone question (matches the legacy default and what `defaultAnswer` says is "no", Q: confirm). Miracle: no. |
| `choose_targets` for a TRIGGERED ability (mandatory) | first legal target preferring opponent-controlled objects/players (observer `defaultAnswer`), i.e. do not auto-target your own stuff |
| `choose_cards` mandatory (discard/sacrifice) | `defaultAnswer` = first `min` options, but for discard the worst-by-mana-value card (reuse `chooseWorstHandCardToDiscard`) |
| `choose_x`/`choose_number` | `min` |
| `choose_color`, `choose_option` | first option |
| `order_triggers`, `order_replacements` | listed order |
| `assign_damage` | lethal-first (existing `defaultAnswer`) |
| `assign_mana`/`assign_counters` | first split that satisfies min (observer returns `undefined` today: needs an implementation) |
| `pay_unless` | no (do not pay) |
| Mulligan decision | keep |
| Cleanup hand-size discard | worst cards |

`defaultAnswer` currently lives in `src/kernel/observer/actions.ts`. It must be moved/re-exported into a neutral module (`src/kernel/play/defaults.ts`)
so production code does not import the observer. This is the one place that needs a kernel-side agent to hand over the file (the kernel agent is
editing `src/kernel/**` now; schedule this after they finish, phase 1).

---------------------------------------------------------------------------------------------------

## 4. AI PLAYERS

### 4.1 Today
`useAgentDriver` builds `LegalAgentAction[]` with `legalMainPhaseActions` / `legalPriorityActions` / `legalAttackActions` / `legalBlockActions`
(`engine/legalActions.ts`, 1,058 lines + `combat.ts`), asks a brain (`heuristicBrain` = `scoreLegalActions`, or `/api/agents/action` -> Ollama), validates
with `decideWithGate` + `checkMoveLegal`, then calls the legacy handlers. The brain interface is `BrainRequest {seatId, purpose, legalActions, context}`.

### 4.2 What the kernel must expose (nothing of this exists; grep for `legalActions` in `src/kernel` has no hits)

New file `src/kernel/engine/legal.ts` (kernel-agent task, phase 1), pure and read-only:

```
legalActions(state, ctx, player): KernelLegalAction[]
  { id, kind: "playLand"|"castSpell"|"activateAbility"|"attack"|"block"|"pass", objectId, abilityId?, castOption?, face?,
    needsTargets: TargetSlotInfo[] | null, needsX: boolean, affordable: boolean, label, timing: "sorcery"|"instant" }
canRespond(state, ctx, player): boolean                 // any non-mana legal action at instant speed (drives priority stops)
legalAttackers(state, ctx, player): { id, defenders: string[] }[]
legalBlocks(state, ctx, player): { blocker, attackers: string[] }[]
targetOptions(state, ctx, action): { slot, options: string[] }[]   // wraps targetCandidates()
objectViews(state, ctx): Record<ObjId, {name, typeLine, types, subtypes, power, toughness, keywords, abilityTexts, summoningSick,
                                         cantAttack, cantBlock, playableFrom?: Zone}>      // wraps chars()/abilitiesOf()
unsupportedFor(state, ctx, player): { objectId, capability[] }[]   // cards in hand/command the kernel would refuse
```
Implementation order: (1) a **probe** implementation in `src/kernel/play/probe.ts` that clones the state and tries `resolve` for each candidate
(`castSpell` with `autoPay` for every hand/command card, `playLand`, mana/other abilities, attackers) and keeps the ones without `error`
(`unsupported`/`cannot_pay`/`wrong_timing` are filtered, targets enumerated through the pending `choose_targets` options). It needs no kernel change
and is good enough for the vertical slice and for AI at human speed (a turn has <= 30 candidates; clone cost is the only worry, measure in phase 3).
(2) The proper `legal.ts` reusing `targetCandidates`, `legalAttackers`, `defenderOptions`, `attackProblem`, `blockProblem`, `manaAbilityActivatable`,
`landDrops`, `playerCantCast`, `spellCostDelta`, `totalPotentialMana` (all exist, but are `Run`-based and not exported through `index.ts`).

### 4.3 Agent driver for kernel games (`useKernelDriver`, new)

* Converts `KernelLegalAction[]` to the existing `LegalAgentAction[]` (same `id`, `actionType` (`play_land`, `cast_spell`, `cast_commander`, `activate_ability`,
  `attack`, `block`, `pass_priority`, `end_turn`), `cardId` = legacy id via `idMap`, `targetIds`, `label`). So `scoreLegalActions`, `playGuards`,
  `decideWithGate`, `heuristicBrain`, the Ollama route, agent lessons and reasoning badges keep working unmodified. The `ScoringContext` /
  `buildAgentDecisionContext(session, ...)` is built from the derived `GameSession` (hands of other seats are stubs, exactly as for friends).
* `mapAgentAction(AgentAction, legal) -> kernel Action` (the inverse), then `session.dispatch`. A rejected action goes to the existing rejection ledger
  (`createRejectionLedger`) with the kernel's `error.message` as the reason; after 3 rejections: `passPriority`.
* **Agent decisions** (`pending.player` is an AI seat): `agentDecide(pending, state)` = improved `defaultAnswer` using existing evaluators
  (`evaluateTargetWorth` for targets, `chooseWorstHandCardToDiscard`, `agentSurveilDecision`/`scoreSurveil` for look-top choices), same as legacy
  parity rules in `docs/agents/system.md` ("every human choice needs a deterministic agent choice"). LLM involvement for decisions is NOT in v1.
* **AI priority**: an AI seat is asked at every window (not only stops); with an empty `legalActions` response set it passes immediately
  (`fastForward` while nobody can respond). Pace: reuse `agentPaceMs` (the legacy 900-1100 ms beats) so the human can follow.
* **Human priority stops**: `priorityStops.ts` settings unchanged; the question "does a window apply to this human" = `canRespond()` plus the stop
  settings (`stopOnStackResponse`, phase stops, yields). `yieldPolicy.ts` is pure and reused.
* Unsupported cards in an AI hand: in continue mode a cast of one succeeds (the unsupported parts are reported and skipped), so the probe no longer filters `unsupported`; an AI may still prefer fully supported plays (`cardUnsupported(def).ok`) as a tie-break, but never needs to avoid the rest.

---------------------------------------------------------------------------------------------------

## 5. THE FLAG AND ROLLOUT

### 5.1 The flag

* **Per deck**: a deck "may run on the kernel" when `data/kernel-drafts/<deck>/READY.json` exists (written by a script, see gates) AND the deck's
  `engine` preference is `kernel`. `SeatConfig` (`src/components/DeckSetup.tsx`) gains `engine?: "legacy" | "kernel"` (default `legacy`), persisted
  with deck prefs, shown as a toggle next to the deck name only when READY.json exists (otherwise a greyed chip "legacy: 9 cards unsupported").
* **Per game**: the kernel is ONE engine for the whole table, so `kernelEligible(configs) = every played (non-empty) seat's deck has engine: kernel and
  READY`. Mixed tables run on legacy and show why. A developer override `?engine=kernel|legacy` (URL param) and env `NEXT_PUBLIC_KERNEL_ENGINE=off` exist
  for debugging; off = kill switch that makes `kernelEligible` always false (rollback, 5.4).
* Where it branches: ONE place, `startGameInner` end (after mulligans): kernel branch calls `startKernelGame`, else legacy continues. AppFlow stays thin:
  `AppFlow` renders `<KernelTableHost>` instead of its own table when `ctx.kernel` is set; all new logic is in `src/components/game/useKernelGame.ts`,
  `useKernelDriver.ts`, `kernelSnapshotInput.ts` and `src/kernel/play/*`.

### 5.2 Readiness gates (per deck; `npm run kernel:readiness -- --deck X` writes READY.json or a blocking report)

1. **Few unsupported cards**: `cardUnsupported(def).ok` for the cards of the deck (support.ts), AND for every token/copy the deck's cards can make
   (continue mode plays an unsupported card but skips the unsupported part, which weakens the deck; the gate keeps that rare, and `npm run unresolved:report` ranks what is missing). Today: Wretched Ranks 3, Tramplesaurus Rex 5,
   Keen Engineering 7, Calling All Angels 7, Saheeli 9 (user's main deck: priority, after the first three), then the rest.
2. **Observer agreement >= 98%** on >= 200 games of that deck (`npm run kernel:observe`, per-deck "kernel readiness" ratio in `report.md`), with 0
   `kernel_rejected_legal_action` diffs whose cause is a kernel bug (adapter gaps and legacy bugs are triaged out by the README's workflow).
   Saheeli is at 93.3% in the last batch; it needs to be fixed before it can be flagged.
3. **User-approved drafts**: every card draft has `review.status: "approved"` (today all are `draft`); `APPROVAL.md` per deck is the review sheet.
   The script refuses if any card is still `draft`.
4. **Live shadow evidence** (5.3): >= 20 legacy games of the deck recorded by the human player with agreement >= 98% on the recorded steps.
5. Kernel `npm test` green and `kernel:validate-drafts` green at the commit that writes READY.json (the file stores the git SHA and the numbers).

### 5.3 Shadow mode (legacy plays, kernel watches)

The observer today needs Node (draftLookup). The live game is in the browser, and `recorder.ts` already exists for exactly this
("`recordStep(file, {s0, s1, intent|meta, accepted})`, a no-op unless `MTG_KERNEL_OBSERVER=1`"). Plan: a host hook `useKernelShadow` (new, only for flagged decks and
only when the shadow env/toggle is on) posts `{s0, s1, intent, accepted}` after each applied intent to `app/api/kernel/record` (new route, loopback only, same guard as
`/api/mp/*`), which appends to `data/observer/live/<deck>/<date>.jsonl`; `npm run kernel:observe-replay` already consumes such files. No kernel code is
loaded in the browser in shadow mode, the game never waits on it, failures are swallowed. Because the legacy UI path HAS a stack (unlike self-play) the
comparison is "settled" (compare at the next player action), which `compare.ts` already does for casts.

### 5.4 When the kernel meets something it cannot run mid-game (never crashes, refuses or freezes the game: continue mode)

Facts: `resolve` returns the original state on any error, and strict mode refuses a cast/land play of a card with any unsupported ability, so the
common case happens BEFORE anything changes. Policy by case:

| Case | What happens |
|---|---|
| Player/AI tries to cast, play or activate something the kernel cannot run | **Nothing is refused and the game never stops** (policy 2026-11-22, engine README "Unsupported things mid-game"). Live games run the kernel with `config.onUnsupported = "continue"`. The kernel emits an `unresolved` event naming the CARD, the ability / clause text and the missing capability, skips only the unsupported step / clause (the rest of the card resolves), and keeps playing. An unsupported COST is never silently free: that ability / cast option is not performed (nothing paid, nothing on the stack, the player keeps priority) and the event says so. Unsupported statics / triggers / replacements / keywords are ignored and reported once when the permanent enters. |
| The gate guaranteed 0 unsupported in the deck, but a card arrives from outside the deck (stolen, copied, cascade/exile-cast, token made by an unsupported source) | Same as above: continue mode reports and skips, no special case. |
| `unsupported` raised deep inside an action despite the per-step handling | Last resort inside `resolve`: the action changes nothing and the result carries one `unresolved` event (`effect: "not_performed"`). No error, no stuck game from the step / trigger / static paths. |
| The log | The host passes each `resolve` result's FULL events to `UnresolvedBridge` (`src/kernel/unresolvedBridge.ts`), which writes `{card, clause, capability, engine: "kernel", turn, phase, seat}` to `data/observer/live-unresolved.jsonl` through the shared sink `src/lib/unresolvedLog.ts` (deduped per game + card + clause + capability). Players see the `unresolved` event's `message` in the game log (`eventsFor` keeps it public, and strips the card name only when the card sat in another player's hand / library). `npm run unresolved:report` lists kernel and legacy occurrences together with an engine column. |
| `loop_detected`, any thrown exception inside `dispatch` | `dispatch` catches, keeps the previous state (it is immutable), marks the game degraded, shows the banner with "Retry / Skip this object". Never an uncaught exception into React. There is no switch to the legacy engine mid-game (one engine decides per game); a degraded game is retried or abandoned. |

### 5.5 Rollout stages and rollback

1. Dev only: `?engine=kernel` on one deck (Wretched Ranks), solo vs AI.
2. Shadow mode on for all flagged decks (no behaviour change), collect agreement.
3. Opt-in toggle per deck, solo games.
4. Opt-in in multiplayer (host with kernel decks; guests get `viewFor` snapshots).
5. Default for decks that passed the gates; legacy remains available via the toggle for >= 1 month.
6. Only then consider deleting legacy rule code (not part of this plan).

Rollback: (a) the env kill switch makes every game legacy at next start, (b) the per-deck toggle, (c) removing READY.json, (d) the legacy path is
never modified by this work (all new code is additive; the only edits to existing files are the one branch in `startGameInner`, the render switch in
`AppFlow`, `SeatConfig.engine`, and the intent whitelist addition). Saves: a kernel save is `{engine:"kernel", state, idMap, templates, log, configs}`
under a new `version`; loading it on a build with the kill switch shows "this save needs the kernel engine" instead of corrupting it (saves from the
legacy path are untouched).

---------------------------------------------------------------------------------------------------

## 6. FIRST THIN VERTICAL SLICE

**Scope**: solo game (host only, three AI seats default or one AI), one flagged deck (Wretched Ranks: fewest unsupported cards; the slice can
ignore the 3 gap cards by playing them as "unplayable", the 0-unsupported gate is for rollout, not for the slice), dev flag `?engine=kernel`.
One human turn from untap to end step:

1. Setup + mulligan on legacy -> `startKernelGame` (toKernelState).
2. Untap/upkeep/draw happen via `advancePhase` / `passPriority`; derived session renders the table; hand shows playable cards from `probeLegalActions`.
3. Play a land (`onPlayCard` -> `playLand`).
4. Cast a spell with a target prompt (`onPlayCard` -> `castSpell` -> pending `choose_targets` -> generic target dialog -> `onAnswerDecision` ->
   stack item -> AI passes -> `passPriority` resolves it).
5. Attack: pick attackers + "Done" -> one `declareAttackers`; AI declares blockers (`declareBlockers` from heuristic); damage; end step; pass.
6. The AI seats play their turns with `useKernelDriver` using `probe` legal actions and `defaultAnswer` decisions.
Not in the slice: multiplayer, timers, save/load, sandbox tools, response windows for the human (the human auto-passes priority), activated
abilities other than mana, planeswalkers, mulligan inside the kernel, event log polish.

**Files touched (about 14: 9 new, 5 edited)**

New:
1. `app/api/kernel/pack/route.ts` (card pack, server)
2. `src/kernel/play/pack.ts` (pack -> `CardLookup`/`CardDb`)
3. `src/kernel/play/session.ts` (`KernelSession`: dispatch, idMap, templates, log)
4. `src/kernel/play/toSession.ts` (reverse adapter)
5. `src/kernel/play/probe.ts` (legal-action probe + `mapAgentAction`)
6. `src/kernel/play/defaults.ts` (moved/copy of `defaultAnswer` for production)
7. `src/components/game/useKernelGame.ts` (handlers = the intent API subset used by the slice, plus start)
8. `src/components/game/useKernelDriver.ts` (turn pump, AI driver)
9. `src/components/KernelDecisionDialog.tsx` (generic dialog for `choose_targets`/`choose_cards`/`choose_yes_no`)

Edited (thin):
10. `src/components/game/useGameSetup.ts` (one branch at the end of `startGameInner`)
11. `src/components/AppFlow.tsx` (render switch / pass kernel handlers; stays thin)
12. `src/components/DeckSetup.tsx` (`SeatConfig.engine`, only the dev flag in slice 1)
13. `src/components/game/context.ts` (a `kernel` slot in the context)
14. `src/components/ThreeGameTable.tsx` (3 additions: a `kernelDecision` slot, a Done button for attackers, `playable` flags on cards)

Tests with it: `toSession.test.ts` (fixtures from observer), `session.test.ts` (stale decision id, unsupported refusal returns same state), and a
Playwright-free scripted smoke (`kernelSlice.test.ts`) that plays one turn headlessly through `useKernelGame`'s pure core.
Estimate: 1 subagent run of about 1 hour for the pure core (files 2-6), one for the hooks and UI (7-14). Success check: the user plays that
one turn in the browser and the observer comparison (`compareIntent` on the recorded steps) stays green.

---------------------------------------------------------------------------------------------------

## 7. RISKS AND OPEN QUESTIONS (max 8)

| # | Question / risk | Recommendation |
|---|---|---|
| Q1 | **Mixed tables.** The kernel is one engine per game. If one seat's deck is not ready the whole game falls back to legacy. | Accept for now. Show the reason in the setup screen. Do not try to run two engines in one game. |
| Q2 | **The reverse adapter is the main hidden cost** (about 50 `VisibleCard` fields the table reads, derived P/T and keywords, tokens, faces, attachments). Gaps render wrong badges, not wrong rules. | Build it incrementally behind the round-trip test; accept visual gaps in slice 1; budget a full phase (phase 3). Re-evaluate moving the renderer to `PlayerView` only after the legacy path is gone. |
| Q3 | **Timer numbers and scope**: memory says "~3 min, final 30 s after 2 min" (inconsistent), and per decision vs per turn was left open. | Per window, 3:00 total with the 30 s warning at 2:30, remote friend seats only, off for solo and the host seat. Please confirm; also confirm the defaults table in 3.5 (especially commander-zone "yes"). |
| Q4 | **No `legalActions` in the kernel, and the probe clones state per candidate.** Performance with a large board and 4 seats is unknown. | Start with the probe (no kernel change); measure in phase 3; promote to `legal.ts` only if a turn costs > 100 ms. Ask the kernel agent to prioritise `legal.ts` and `objectViews` after their current work. |
| Q5 | **Mid-game fallback**: DECIDED 2026-11-22: no switch to legacy and no ending the game. The kernel runs in continue mode (`config.onUnsupported = "continue"`): it logs what it could not resolve (event + `data/observer/live-unresolved.jsonl`) and keeps playing. | Implemented in the engine (see 5.4 table and the engine README); the host only has to feed `UnresolvedBridge`. |
| Q6 | **Legacy features the kernel does not have**: mulligans, poison, emblems, initiative (kernel has it per memory notes? the adapter README says unmapped), phasing, Rooms, cumulative upkeep, sandbox/manual move tools, human manual tap/untap (`toggleTapManually`). | Gate by deck (cards needing them are `unsupported`); keep mulligans on legacy; sandbox tools come back later as host-only kernel debug tools; `onToggleTapCard` is not supported in kernel mode (taps only via mana abilities). Confirm the manual untap loss is fine. |
| Q7 | **The 98% observer agreement gate measures the legacy engine too**: legacy bugs show up as kernel "disagreements" (e.g. the first-draw bug), and the stack-less self-play engine cannot test responses/counterspells. | Triage with the README categories (legacy bug is not a kernel failure); require the live shadow evidence (gate 4) from real stack-using games; keep a hand-written regression scenario list for counterspells/priority (`mistakeScenarios.ts` style). |
| Q8 | **Parallel edits and ownership**: another agent edits `src/kernel/**` and legacy files now; this plan needs 3 kernel exports (`legal.ts`, `objectViews`, `defaults`) and moving `defaultAnswer` out of `observer/`. | Do not start phases 1 and 4 until the kernel agent's current batch is committed; define the export surface in one small contract PR first (types only). Keep every new production file under `src/kernel/play/` and `src/components/game/useKernel*` so there are no merge conflicts with legacy files. |

Also noted, not a question: Saheeli (user's own deck) is at 9 unsupported cards and 93.3% agreement; it is the first non-trivial candidate after
Wretched Ranks, Tramplesaurus Rex and Keen Engineering, because the user cares most about it. Its first-turn behaviours (token/copy makers) are also
the best test of the reverse adapter's token path.

---------------------------------------------------------------------------------------------------

## 8. PHASED TASK LIST (each sized for one subagent run, <= ~1 hour)

Dependency order. "||" means can run in parallel with the item named. Each phase ends with its own tests green and nothing in legacy behaviour changed.

| Phase | Task | Depends on | Parallel with | Output (key files) |
|---|---|---|---|---|
| 0 | **Contract**: types-only module `src/kernel/play/types.ts` defining `KernelLegalAction`, `ObjectView`, `DecisionClock` types, `KernelSession` interface, `PendingView` re-exports; agree the 3 kernel exports with the kernel agent | none | - | `src/kernel/play/types.ts`, short note appended to kernel README |
| 1 | **Kernel read API** (kernel agent): `legal.ts` (`legalActions`, `canRespond`, `legalAttackers`, `legalBlocks`, `targetOptions`), `objectViews`, `unsupportedFor`, export `defaultAnswer`; each with tests | 0 | 2, 3a | `src/kernel/engine/legal.ts`, `view.ts`/`index.ts` exports |
| 2 | **Card pack + play core**: `app/api/kernel/pack`, `pack.ts`, `KernelSession` (dispatch, idMap, templates, log, stale-id rejection, lenient retry, never-throw), `formatEvent` log | 0 | 1, 3a | `src/kernel/play/{pack,session,log}.ts`, route |
| 3a | **Reverse adapter v1** (`toSession`): zones, tapped, counters, P/T via `chars`, stack, combat, turn; round-trip fixtures from observer | 0 (uses probe-free data; `objectViews` stub until 1 lands) | 1, 2 | `src/kernel/play/toSession.ts` + tests |
| 3b | **Probe legal actions** + `mapAgentAction`; benchmark | 2 | 3a | `src/kernel/play/probe.ts` |
| 4 | **Slice hooks and UI** (section 6): `useKernelGame`, `useKernelDriver`, `KernelDecisionDialog`, branch in `startGameInner`, AppFlow render switch, dev flag | 2, 3a, 3b | - | files 7-14 of section 6 |
| 5 | **Decision UI complete**: `NumberPromptModal`, `AssignAmountsModal`, shims to the existing modals for all 16 kinds, attack/block Done flow, scry/surveil mapping, tests per kind (table 3.2) | 4 | 6, 7 | `KernelDecisionDialog.tsx`, 2 modals, ThreeGameTable additions |
| 6 | **Human priority + stops + AI driver completeness**: `canRespond`-driven stops with `priorityStops`/`yieldPolicy`, window keys, agent decisions (`agentDecide`), pacing | 4, 1 | 5, 7 | `useKernelDriver.ts`, `agentDecide.ts` |
| 7 | **Flag + gates**: `SeatConfig.engine`, `kernelEligible`, `npm run kernel:readiness` (writes READY.json), setup UI chips, kill switch, degraded-game banner and "switch to legacy" | 4 | 5, 6 | `scripts/kernel-readiness.ts`, `DeckSetup.tsx`, `src/kernel/play/eligibility.ts` |
| 8 | **Shadow recorder**: `useKernelShadow`, `app/api/kernel/record`, replay report per deck, unsupported log | 7 | 9 | hook + route |
| 9 | **Multiplayer**: kernel branch of `readSnapshotInput`, per-viewer `toSession(viewFor)`, `onAnswerDecision` intent + spec + coverage, snapshot v3 (`decision`, `turnClock`), kernel leak test | 4, 5 | 8 | `kernelSnapshotInput.ts`, `intentSpecs.ts`, `snapshot.ts` |
| 10 | **Decision clock**: `DecisionClock`, defaults table, timer UI on both sides, pause handling | 9, 6 | 11 | `decisionClock.ts`, UI countdown |
| 11 | **Save/load + kernel self-play runner + first deck readiness runs** (Wretched Ranks, Tramplesaurus Rex, Keen Engineering, then Saheeli): `kernel:selfplay` using brains + `probe`/`legal`, save version, a triage list per deck | 7, 10 | - | `scripts/kernel-selfplay.ts`, `saveGame.ts` extension, readiness reports |

Parallel groups: {1, 2, 3a} after 0; {5, 6, 7} after 4; {8, 9} after 7/5; {10, 11} after 9. Critical path: 0 -> 2 -> 3b -> 4 -> 9 -> 10 -> 11
(about 7 sequential agent-hours; with parallel groups the wall-clock is about 6 rounds).

Success definition for "kernel is in the game": a flagged deck plays a full solo 4-seat game and a 2-human + 2-AI hosted game on the kernel with
zero uncaught errors, the observer shadow numbers >= 98% on the same deck's legacy games, and the kill switch returns to legacy with no code change.

## User decisions (2026-11-22)
- Unsupported card mid-game: do not crash or end the game. Write a log entry describing exactly what the kernel could not resolve (card, ability, missing capability, turn/phase) and keep playing; the user reviews the log later and the missing features get added. (Replaces the 'lossy switch to legacy' fallback.) IMPLEMENTED (kernel `config.onUnsupported = "continue"`, `unresolved` events, `UnresolvedBridge`, 5.4): the unresolved part is skipped and shown in the game log to all players (the card name is withheld only for a card in another player's hand or library); the same occurrence is written to data/observer/live-unresolved.jsonl.
- Timer: 3:00 per phase. At 2:30 (30 s left) a 30-second burning-rope animation (Hearthstone style) starts; on expiry it auto-passes to the next phase and the timer restarts. +15 s is added each time a spell is played or an effect is activated. Open: all human seats vs only remote friend seats; rope behaviour when +15 s pushes remaining time above 30 s (assumed: rope stops, restarts at 30 s left); per-decision auto defaults.
- Only one engine decides per game (kernel or legacy), never both; the Rules Advisor AI is to be removed (pending a measurement of whether it ever changes a game).
- Timer scope (user, 2026-11-22): the timer is shown only to the player whose turn it is, and it counts down ONLY while that player holds priority. While an opponent holds priority (thinking about a response) the timer is paused. It restarts per phase, +15 s per spell played or effect activated, rope animation in the last 30 s. Open: whether an opponent's response window has its own (longer) cap so nobody can stall indefinitely; AI seats have no timer.
- Timer visibility (user, 2026-11-22): the rope/countdown is visible to EVERYONE at the table (so all players see how much time is left), even though only the active player's clock is counting; it shows as paused while an opponent holds priority. The timer state therefore must be part of every player's snapshot (public information), server-authoritative.
