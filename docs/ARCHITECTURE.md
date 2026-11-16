# MTG-AI Architecture Guide

A reading guide for someone who knows code but has never opened this repo. It explains how this
particular codebase is laid out and where things live. Line numbers are approximate and drift as
`src/components/AppFlow.tsx` is edited; **function names are the stable handle** - search for them.

---

## 1. What this is, and how a turn flows

A browser-based **Magic: The Gathering Commander** game (4 players, 40 life) where you play one seat and
three AI "agents" (Veyra, Malik, Sable) play the others. It is a Next.js 15 / React 19 app with a
Three.js 3D table. The important design decision: **the rules engine is deterministic TypeScript**. An
LLM (local Ollama) is only used for (a) picking a move from a list of already-legal moves, and (b) as a
fallback translator for card text the hand-written parsers do not recognise. The LLM is never the referee.

Most of the engine lives, unusually, inside one 34,000-line React component file,
`src/components/AppFlow.tsx`. See sections 4 and 5 for how to navigate it and how to split it.

### One action, end to end

1. **Page load.** `app/page.tsx` calls `getOrCreateSession()` (`src/lib/sessionStore.ts`) and renders
   `<AppFlow initialSession=... />`.
2. **Setup.** `DeckSetupPanel` lets you pick decks; `startGame` / `startGameInner` build libraries
   (`buildDeck`, `applyDeckToSeat`, `makeShuffledLibrary`), then mulligans run
   (`resolveAgentMulligans`, `keepOpeningHand`).
3. **You act in the UI.** `ThreeGameTable.tsx` (3D board, prompts, stack HUD) calls handlers that
   AppFlow passes down as props: `playCard`, `declareAttack`, `activateGenericTapAbility`, `tapForMana`,
   `endTurn`, `passPriority`, ...
4. **Legality.** Humans and agents share one gate, `checkMoveLegal` (in AppFlow.tsx, wrapped by
   `src/lib/moveLegality.ts`). The list of things a seat may do is built by `legalMainPhaseActions`,
   `legalAttackActions`, `legalBlockActions`, `legalPriorityActions`, `legalActivatedAbilityActions`.
   Each returns `LegalAgentAction[]` (an id, a type, a card id, a label).
5. **Cost is paid, spell goes on the stack.** `playCard` computes the cost (`totalCastingCost`,
   `adjustedCastingCost`), picks mana sources (`chooseManaSourcesForCost`), and calls `beginPendingAction`,
   which makes a `PendingAction` (type `spell`, `trigger`, or `phase`) the thing everyone must pass
   priority on. Extra decisions (X value, modes, targets, alt costs) are asked first through
   `PendingRuleChoice` prompts (`openCastPrompt`, `completeCastX`, `completeSpellMode`, ...).
6. **Priority.** `passPriority` records who passed (`priorityPasses`); `nextPrioritySeatId` and
   `pendingActionRequiredPasses` (module-level) decide who must be asked. `src/lib/priorityStops.ts`
   holds the human's "when do I want to be interrupted" settings.
7. **Resolution.** When everyone passed, `resolvePendingAction` -> `resolvePendingActionNow` applies the
   effect. Which code applies it depends on the card text: dedicated parsers (`parseRemovalEffect`,
   `parseZoneEffect`, `parseSpellExtraEffects`, `parseCreateTokenSpecs`, ...) -> `applyRemovalEffect`,
   `applyZoneEffect`, `applySpellExtraEffect`, `createTokensForSeat`, ...; unknown text falls back to the
   LLM-backed `consultRulesAdvisor` / `consultPrimitiveActionPlanner`.
8. **State-based actions + triggers.** Every session update goes through the `setSession` wrapper inside
   AppFlow, which runs `checkStateBasedActions` (-> `runStateBasedActionsPass`) first. Pure functions
   that notice "a creature died / a permanent entered / combat damage hit a player" cannot queue
   triggers themselves, so they append to `session.pendingDeaths`, `pendingEntries`, `pendingLeaves`,
   `pendingCombatDamageToPlayer`, ... and a family of `useEffect` "drain" effects inside the component
   turn those into stack items (`queueCommonTriggers`, via `findCommonTriggersFor...` finders).
9. **AI turn.** Effects watch whose turn/priority it is and call `decideAgentTurnAction`,
   `decideAgentAttackers`, `decideAgentPriorityAction`, `decideAgentBlockAction`. Each builds a
   `LegalAgentAction[]` list and calls `requestAgentDecision`, which POSTs to `/api/agents/action`
   (`app/api/agents/action/route.ts`). That route scores the options deterministically
   (`src/lib/actionScoring.ts`, `playGuards.ts`, `strategy.ts`, `lookAhead.ts`), optionally asks Ollama
   (`src/lib/ollama.ts`), and falls back to the best-scored option. The result is validated again by
   `decideWithGate` / `validateProposal` (`moveLegality.ts`) and applied by `applyAgentTurnAction` /
   `applyAgentPriorityAction`, which call the very same engine functions a human click would.
10. **State updates**, React re-renders, the table shows the new board; events are appended to
    `session.events` (capped at `MAX_SESSION_EVENTS`).

---

## 2. Directory map

### Top level

| Path | Purpose |
|---|---|
| `app/` | Next.js App Router. `page.tsx` (the game), `decks/page.tsx` (deck library), `layout.tsx`, `globals.css`. |
| `app/api/agents/` | `action` (agent move decision), `chat` (talk to an agent about a decision), `lessons` (saved human lessons), `warmup` (preload the Ollama model). |
| `app/api/rules/` | LLM-backed rule helpers: `check` (Rules Advisor), `primitive-plan`, `static-effect`, `parse-card`, `override-card`, `advisor-log` (diagnostic sink). |
| `app/api/cards`, `decks`, `saves`, `session`, `ollama` | Card search/status/token art, deck build + library, save/load games, session bootstrap, Ollama health. |
| `src/components/` | The React UI **and** (in `AppFlow.tsx`) most of the game engine. Plus ~75 `AppFlow.*.test.ts` regression tests. |
| `src/lib/` | Parsers, AI scoring, persistence, and small rules helpers. Mostly pure functions. `src/lib/selfplay/` is the headless simulator. |
| `scripts/` | CLI tools (importers, audits, self-play). Run via `npm run ...` (see section 7). |
| `data/` | `cards.db` (SQLite: card catalog, `parsed_cards` cache, `xmage_cards`), `commander-cards.json`, `edhrec-ranks.json`, `token-art.json`, `agent-lessons.json`, `xmage-source/` (copy of XMage's Java card files), logs. |
| `decks/` | Deck lists as `.txt` (`foundations/` = the five Foundations precons, `custom/`). Decks live only here as `.txt` files; the app reads them through `/api/decks/library` (the setup screen fills the default seats from `foundations/` once that loads). |
| `docs/` | `agents/` (agent prompt contract `system.md`, `real-game-mistakes.md` log, committed mistake reports), `mtg/` (rules/heuristics read into agent prompts), `evals/`, `xmage-bridge.md`, `screenshots/`. |
| `bench/` | Generated reports: `coverage/` (backlog + choice audit), `mistakes/`, `selfplay-results/`, `agent-scenarios.mjs`. |
| `ollama/` | Modelfiles for the three agent personas (`veyra`, `malik`, `sable`). |
| root files | `mtg-commander-engine-spec.md` (the original design spec; phases are referenced in code comments), `HOW_TO_RUN.md`, `Bugs2.txt` and `Potential Features.txt` (notes), `advisor-log.jsonl` (what the advisor sink wrote), loose `.jpg` bug screenshots. |

### `src/components/`

| File | Purpose |
|---|---|
| `AppFlow.tsx` | The game controller + React state (the `AppFlow()` component), ~10.8k lines. Engine code is in `src/engine/` (see `src/engine/README.md`). Section 4. |
| `ThreeGameTable.tsx` (~5.2k) | Three.js 3D table, hand/stack HUD, all the card-picker prompts (discard, blink, scry, targets, mana choice). Receives everything as props from AppFlow. Exports `StackFeedEntry`. |
| `VisualCard.tsx` | Small 2D card renderer. |
| `DeckEditor.tsx` | Deck library editor used by `app/decks`. |
| `abilityAudit.ts` | Strict per-card audit: for each activated/granted ability, names the system that offers it or reports it "unmodelled". Imports `legalMainPhaseActions` and `manaChoicesForCard` from AppFlow. |
| `clauseCoverage.ts` | `recognises(line)`: does ANY deterministic parser claim this oracle-text line? Used by the backlog script and the deck coverage test. |
| `AppFlow.*.test.ts` | One test file per card/rule bug (e.g. `AppFlow.pestInfestation.test.ts`). They import engine functions straight from `./AppFlow`. |

### `src/lib/` (grouped)

**Types and data**

| File | Purpose |
|---|---|
| `types.ts` | `GameSession`, `PlayerSeat`, `VisibleCard`, mana types, `AgentAction`. Section 3. |
| `cardCatalog.ts`, `cardDb.ts`, `cardParser.ts` | Card catalog (JSON), SQLite store (`parsed_cards`, `xmage_cards`), offline LLM whole-card parser. |
| `deckParser.ts`, `deckRepair.ts`, `deckText.ts`, `bracketPolicy.ts`, `edhrec.ts` | Turning deck lists into `CommanderDeck`, fixing land counts, precon lists, Bracket 3 rules, EDHREC synergy data. |
| `sessionStore.ts`, `saveGame.ts`, `saveStore.ts`, `structuralShare.ts` | Initial session creation; save snapshot types/serialisation (client-safe); SQLite save store (server-only); `shareSessionSeats` keeps unchanged sub-objects referentially equal so React effects do not re-fire. |

**Rules text parsers ("deterministic-first" - regex/template readers returning structured data or `undefined`)**

| File | Purpose |
|---|---|
| `oracleClauses.ts` | Splits oracle text into clauses; isolates ETB / death / activated clauses; many small parsers (saga chapters, emblem grants, enters-with-counters, additional costs). |
| `activatedAbilities.ts` | "{cost}: effect" parsers: mana, sacrifice, tap, self-untap, manlands, library-search. |
| `removalSpells.ts`, `zoneEffects.ts`, `spellExtras.ts`, `targetedEffects.ts`, `counterSpells.ts`, `damagePrevention.ts` | Spell-effect parsers (destroy/exile/damage; reanimate/mill/steal; one-off shapes; "target X gets..."; counterspells; prevention shields). |
| `characteristics.ts`, `attachments.ts`, `typeGrants.ts`, `staticEffects.ts`, `counters.ts`, `keywords.ts`, `combatRestrictions.ts` | Static/continuous effects: CDAs, anthems, auras/equipment bonuses, granted types, +1/+1 counters (`effectivePower/Toughness`), keyword table, landwalk/bushido. |
| `phaseTriggers.ts`, `triggerWatchers.ts` | Phase-trigger registry ("at the beginning of ..."); who an "enters/dies" watcher watches. |
| `targeting.ts`, `targetSpecs.ts` | `legalTargets` / `targetsStillLegal` (the shared TargetSpec model). |
| `graveyardCasting.ts`, `graveyardAbilities.ts`, `libraryCasting.ts`, `altCosts.ts`, `cycling.ts`, `undercity.ts` | Cast-from-elsewhere permissions, alt costs, cycling, the Undercity dungeon for initiative. |
| `primitiveActionPlan.ts`, `rulesAdvisor.ts`, `xmageGrounding.ts`, `xmageBridge.ts` | LLM fallbacks (section 7) and the XMage lookup/bridge stubs. |

**AI decision-making**

| File | Purpose |
|---|---|
| `actionScoring.ts` | Scores every legal action; `scoreLegalActions`, `fallbackAction`, `resolveGuardedChoice`. Central to AI play. |
| `playGuards.ts`, `wipeSequencing.ts`, `freeAttack.ts`, `blockValuation.ts`, `strategy.ts`, `combatSim.ts`, `lookAhead.ts` | Deterministic "do not do the dumb thing" guards and valuations feeding score adjustments. |
| `mulliganHeuristics.ts`, `surveilScoring.ts` | Opening-hand and surveil decisions. |
| `moveLegality.ts` | The gate: `validateProposal`, `decideWithGate`, `createRejectionLedger` (pure) - the engine-aware half `checkMoveLegal` lives in AppFlow. |
| `ollama.ts`, `knowledge.ts`, `agentLessons.ts`, `agentLessonStore.ts` | LLM client, knowledge files fed to prompts, human "lessons" saved to `data/agent-lessons.json`. |
| `priorityStops.ts`, `stackDescription.ts`, `tokenArt.ts`, `cardPick.ts` | Human priority preferences; stack item descriptions for the HUD; Scryfall token art; picker helpers. |

**`src/lib/selfplay/`** (headless simulation): `orchestrator.ts` (sequencing only - calls real AppFlow
functions), `brains.ts` (`heuristicBrain`, `ollamaBrain`), `audit.ts` (rules-integrity checks after every
action), `anomalies.ts`, `mistakes.ts` + `mistakeScenarios.ts` (wasteful-play detector and fixtures from
`docs/agents/real-game-mistakes.md`), `rotation.ts` (deterministic deck/seat rotation).

### `scripts/`

| Script | `npm run` | Purpose |
|---|---|---|
| `import-commander-cards.mjs` | `cards:import` | Build `data/commander-cards.json` from Scryfall data. |
| `parse-cards.mjs`, `override-card.mjs` | `cards:parse`, `cards:override` | Bulk LLM card parse into `parsed_cards`; manual correction. Needs dev server. |
| `ingest-xmage-cards.mjs` | `xmage:ingest` | Index XMage Java card files into the `xmage_cards` table. |
| `self-play.ts` | `selfplay` | Headless games, rules-integrity audit after every action. |
| `agent-mistakes.ts` | `agent:mistakes` | Self-play + wasteful-play report to `bench/mistakes/`. |
| `ability-audit.ts` | `audit:abilities` | Runs `abilityAudit` over decks. |
| `card-backlog.ts`, `choice-audit.ts` | `backlog`, `choice-audit` | Reports to `bench/coverage/`: unrecognised rules-text templates; decisions the engine makes for a human. |
| `agent-bench.mjs`, `fetch-edhrec-ranks.mjs`, `dev-server.cmd` | `bench:agents` | Bench and one-off helpers. |

---

## 3. Core data model (`src/lib/types.ts`)

### `GameSession` - the whole game state

It is a plain serialisable object; engine functions take one and return a new one (pure
"session transformers"). Always-present fields: `id`, `status`, `phase` (a string such as "Precombat
Main"), `turn`, `activePlayerId`, `seats`, `events` (log, newest first), `winnerSeatId`.

What is **not** in `GameSession` (it lives in React state inside `AppFlow`): the **stack**
(`stackActions: PendingAction[]` plus the top item `pendingAction`), who has passed (`priorityPasses`),
the current prompt (`pendingRuleChoice`), the **mana pools** (`manaPools`, plus
`restrictedManaBatches`), library-look windows, block choices. Save/load (`buildSaveSnapshot` /
`applySnapshot`, `saveGame.ts`) therefore has to serialise those separately.

The non-obvious part is the family of **`pending*` queues** on `GameSession`. A pure function cannot
open a prompt or queue a trigger (it has no access to the component), so it records a request on the
session and a component `useEffect` drains it:

| Field | Written by | Drained into |
|---|---|---|
| `pendingDeaths` (with `attachedSourceIds`, `sacrificed`) | `destroyCreatures`, SBA | "whenever X dies" triggers (`findCommonTriggersForPermanentDied`, sacrifice/graveyard watchers) |
| `pendingEntries` | `moveCardAcrossSeats`, `moveLibraryCardToDestination`, `createTokensForSeat` | ETB triggers for non-cast entries (`findCommonTriggersForPermanentEntered`) |
| `pendingLeaves` | zone movers | "leaves the battlefield" watchers |
| `pendingCombatDamageToPlayer` | `applyCombatDamageToTarget` | "deals combat damage to a player" triggers |
| `pendingBlockDeclarations`, `pendingAttackDeclarations` | `assignBlockers`, `declareAttack` | block/attack triggers |
| `pendingGraveyardDepartures` | graveyard movers | "cards leave your graveyard" (batched per event) |
| `pendingPlayerChoices` | any resolver needing a human decision | generic prompt; resolved by `resolveDeferredChoice` (keyed by the `resolver` string) |
| `pendingDiscardChoices`, `pendingSacrificeChoices`, `pendingCounterChoices`, `pendingShockChoices`, `pendingDiscoverChoices`, `pendingFreeCastChoices`, `pendingPunisherChoices`, `pendingBraidsChoices`, `pendingVentureChoices/Rooms` | specific card effects | their own human prompts |
| `pendingUpkeepDraws`, `delayedPhaseTriggers` | resolved spells | next upkeep / next step (`resolvePendingUpkeepDraws`, `planOffTurnPhaseTriggers`) |

Per-turn bookkeeping uses **turn-stamped objects that self-expire** instead of a cleanup step, e.g.
`combatDamagePrevented: {turn}`, `damageThisTurn: {turn, bySeat}`, `triggerChainGuard: {turn, count}`
(a circuit breaker against infinite trigger loops), `attackPool`. Dedup of "once each turn" abilities
is `onceEachTurnEffectsUsed` (keys `turn:sourceId:kind`). Other game-wide fields: `initiativeSeatId`,
`monarchSeatId`, `undercityRooms`, `extraTurnsQueue`, `extraCombatsPending`,
`extraBeginningPhaseActive`, `damageShields`, `effectTimestampCounter` (orders continuous effects for
layer 7b "newest wins").

### `PlayerSeat`

`id`, `name`, `kind` (`"human"` | `"agent"`), `agentName` (Veyra/Malik/Sable), `life`,
`commanderDamage` (per attacker), `poison`, `experienceCounters`, `hasLost`/`lossReason`, `deck`,
`library` (array of `VisibleCard`), `zones` (counts only), `board: PlayerBoardState`, `emblems`.
`board` holds `hand`, `battlefield`, `graveyard`, `exile`, `commander` (the card in the command zone).
Emblems deliberately live outside `battlefield` (rule 111.7) in `seat.emblems`.
Plus lots of small turn flags (`createdTokenThisTurn`, `drawnThisTurn`, `lifeAtTurnStart`,
`nextSpellHasImprovise`, `noMaximumHandSize`, ...).

### `VisibleCard` - one card or token instance in any zone

A very wide object (~200 lines of optional fields). Core: `id`, `name`, `typeLine`, `oracleText`,
`manaCost`, `manaValue`, `colors`, `power`/`toughness`/`loyalty` (strings), `counters`
(`{kind,count}[]`), `zone`, `tapped`, `summoningSick`, `token`, `commander`, `ownerSeatId` (set when
controller != owner), `faces` / `unlockedFaceIndices` (double-faced, split, rooms).

The pattern to understand: **printed text is never mutated; derived state is stored in side fields
that a pass recomputes.** The "recompute every state-based-action pass" fields are `grantedKeywords`,
`grantedProtectionColors`, `grantedManaAbilityText`, `grantedAbilityText`, `grantedTypes`,
`abilitiesStripped`, `cdaPower/cdaToughness`, `attachmentPowerBonus/ToughnessBonus`. Do not write to
them from elsewhere; they will be overwritten. The "until end of turn" fields (`temporaryPowerBonus`,
`temporaryBasePower`, `temporaryAnimatedAsCreature`, `temporaryGrantedKeywords`, ...) are cleared by
`clearTemporaryBuffs`. Use the choke-point helpers rather than reading the raw field: `hasKeyword()`,
`effectivePower()/effectiveToughness()` (`counters.ts`), `hasCardType()` (`typeGrants.ts`),
`effectiveManaOracleText()`.

Other fields worth knowing: `attachedToId` / `attachedToSeatId` (equipment, auras, "enchant player"),
`attacking`, `attackTargetId`, `blocking`, `blockingTargetId`, `damage`, `enteredTurn`/`enteredFrom`,
`exiledPlayable*` (impulse draw permissions), `exiledUntilSourceLeaves`, `chosenCreatureType` /
`chosenColor` (ETB choices), `temporaryCopyOriginal` (to undo a temporary copy), `phasedOut`,
`battlefieldPosition` (3D table x/z).

### Stack, trigger and prompt structures (in `AppFlow.tsx`, not exported)

* **`PendingAction`** (~line 550): union of `phase` (waiting to advance a step), `spell`
  (`cardId`, `sourceZone`, `manaSourceIds`, `chosenX`, `castChoices`, `flashback`, `isCopy`) and
  `trigger` (`controllerSeatId`, `sourceCardId`, `effect: TriggerEffect`, `contextCardId`).
  Activated abilities on the stack are `trigger`-shaped too.
* **`TriggerEffect`** (~line 173-533): a long discriminated union describing every kind of triggered
  effect the engine knows how to carry out (draw, tokens, counters, search, modal ...). Produced by
  `commonTriggerEffect` and the `findXTriggers` family, consumed by `resolveTriggerEffect` /
  `resolveTriggerEffectOnce`. Has an `optional` flag meaning "you may" (human gets a prompt).
* **`PendingRuleChoice`** (~line 669-1297, ~600 lines): the union of every blocking prompt
  (`kind: "choose_cast_x"`, `"choose_cast_copy"`, `"discard_to_hand_size"`, mode picks, ...), each with
  `controllerSeatId` and a `resume` payload so the interrupted action is replayed after the answer.
  Held in `pendingRuleChoice`; completed by `completeRuleChoice` (humans) or `resolveAgentRuleChoice`
  (agents choose deterministically).
* **`TokenSpec`** (~line 536): `{count,name,colors,typeLine,power,toughness,oracleText,role,tapped?}`.
* **`LegalAgentAction`** (exported, ~line 1341): what an agent or the move gate sees: `id` (stable
  string like `play-land:<cardId>`), `actionType`, `cardId`, `abilityKind`, `targetIds`, `label`,
  `sourceZone`, `faceIndex`.
* **`AgentAction`** (`types.ts`): what the LLM/scorer answers with (`legalActionId` + reason).

---

## 4. Map of the code (formerly "Map of AppFlow.tsx")

`src/components/AppFlow.tsx` is now (~10.8k lines) essentially **one React function component, `AppFlow()`**, plus its imports, a few
UI state types and the re-exports of every moved symbol. Everything inside the component is a closure over React state
(`session`, `pendingAction`, `stackActions`, `manaPools`, ...): the human/agent *controller* (agent driver, game lifecycle, save/load, human
casting handlers, stack UI, choice prompts, JSX). The rules engine lives in `src/engine/*.ts`; see **`src/engine/README.md`** for the one-line-per-file map
and a "to change X open Y" cheat sheet. Locate things by function name, not line number.

| Concern | File |
|---|---|
| Component state, agent driver, lifecycle, save/load, handlers, JSX | `src/components/AppFlow.tsx` (inside `AppFlow()`) |
| Setup screen, deck config, `applyDeckToSeat` | `src/components/DeckSetup.tsx` |
| Dialog view-models (`ruleChoiceView`, `blockChoiceView`) | `src/components/viewModels.ts` |
| Agent timeouts, rule-workflow cache, prewarm | `src/lib/agentRuntime.ts` |
| Mana, costs, lands, tokens | `engine/mana.ts`, `costs.ts`, `lands.ts`, `tokens.ts` |
| Zone moves, entry, damage, state-based actions | `engine/zones.ts`, `entry.ts`, `damage.ts`, `stateBased.ts` |
| Trigger discovery / effects | `engine/triggerFinders.ts`, `triggers.ts` |
| Spell and one-shot effects, ETB, searches, sagas | `engine/effects.ts`, `oneShotEffects.ts`, `etb.ts` |
| Activated abilities | `engine/abilities.ts` |
| Casting and cast-time targeting | `engine/casting.ts`, `castTargets.ts` |
| Combat (restrictions, damage, legal attacks/blocks) | `engine/combat.ts` |
| Legal actions + move legality gate | `engine/legalActions.ts` |
| Priority, stack passes, agent decision context | `engine/priority.ts` |
| Turn structure, phase triggers, rotation | `engine/turnFlow.ts` |
| Opening hand, mulligans | `engine/mulligan.ts` |

Functions defined with 2-space indentation inside `AppFlow()` are controller code (they call setState / read refs; only 3 pure ones were liftable and were
moved: `restrictedBatchUsable`, `chooseReadAheadChapter`, `applyMetalcraftAttackDebuff`). The old "Region A..X" line-number map was removed because
those regions now are the engine files above.

### 4.1 The areas people ask about most

* **Mana**: `manaChoicesForCard` -> colors a permanent can currently produce (honours "activate only
  if", conditions, "chosen color", costly taps via `costlyTapManaColors`, granted mana abilities).
  `chooseManaSourcesForCost` -> which permanents to tap for a cost. `payCostFromPool` -> spend floating
  mana (plus restricted batches in the component: `spendRestrictedMana`). `spendManaSources` -> actually
  tap. `totalCastingCost` -> final cost after taxes/reductions. Region U.
* **Tokens**: `parseCreateTokenSpecs(text, ...)` reads "Create two 1/1 white Soldier creature tokens"
  into `TokenSpec[]` (`predefinedTokenSpec` knows Treasure/Food/Clue/etc.;
  `parseCreatureTokenDescription` handles the free-form shape). `createTokensForSeat(session, seatId,
  sourceCardId, specs, {queueEntries})` builds the cards (`createTokenCard`), puts them on the
  battlefield, applies `entersBattlefieldTapped` and enters-with-counters, then queues ETB triggers.
  Copy tokens: `createCopyTokenForSeat`. Token art is stamped later via `tokenArt.ts`.
* **Zone moves**: `moveCardAcrossSeats` (any seat to any seat, five zones) and
  `moveCardBetweenVisibleZones` (same seat, hand/graveyard/exile). Both call `resetForZoneChange`
  to wipe per-permanent state, and `withLeaveRecord` to record leaves. Entering the battlefield outside a
  cast goes through `applyEntryEffects`. A cast permanent's own entry happens inline in
  `resolvePendingActionNow`.
* **Triggers**: three families. (1) ETB/death/leave/etc. discovered by `findXTriggers` after a
  `pending*` queue is drained; (2) **phase triggers** from `src/lib/phaseTriggers.ts`
  (`collectPhaseTriggers`) + `applyDeterministicPhaseTrigger`; (3) cast/attack triggers found at the
  moment of the action (`findCastTriggers`, `checkCastTriggeredKeywords`, `findAttackTriggers`). All end
  up as `PendingAction` of type `trigger` via `queueCommonTriggers` / `makePhaseStackTrigger`.
* **Combat**: `declareAttack` (component), `assignBlockers`, `resolveCombatDamage`,
  `resolveBlockedCombatDamage`, `applyCombatDamageToTarget`, `cleanupCombat`, evasion in
  `attackerEvadesBlocker`; AI side in `src/lib/combatSim.ts`, `blockValuation.ts`, `freeAttack.ts`.

---

## 5. Proposed module split

Goal: shrink AppFlow.tsx without behaviour change. Suggested layout (`src/engine/`), with what moves:

| New module | Moves from AppFlow.tsx |
|---|---|
| `engine/keywords.ts` | `hasKeyword`, `hasFlying/Reach/Menace/Deathtouch/Trample/FirstStrike/DoubleStrike/Indestructible/Vigilance/Defender/Haste/Lifelink/Wither/Infect/Hexproof/Shroud/Ward`, `describeKeywords`, `playerHasHexproof`, `playerCantLose`, `isProtectedFrom`, `allProtectionColors` |
| `engine/cardTypes.ts` (tiny utils) | `isLandCard`, `isBasicLandCard`, `manaValueFromManaCost`, `numberWordToInt`, `capitalizeWord`, `possessive`, `seatVerb`, `shuffleCards`, `randomInt`, `isHistoricCard`, `isPlaneswalkerCard`, `findPermanentById`, `findCardAnywhere`, `rulesEvent` |
| `engine/mana.ts` | Mana pool (`emptyManaPool`, `addManaToPool`, `addPools`, `manaPoolTotal`, `payCostFromPool`, `formatManaPoolPayment`, `manaPoolDifference`), `chooseManaSourcesForCost`, `chooseManaSources`, `manaSourceMayPayFor`, `manaRequirementForCard`, `costlyTapManaColors`, `addedManaColors`, `conditionallyUnavailableColors`, `manaChoicesForCard(+Raw)`, `isBoardConditionMet`, `activateOnlyIfConditionMet`, `producibleColorsForLand`, `manaProducedBy`, `signetAbility`, `spendManaSources`, `tapVisibleCard`, `normalizeManaColors`, `isManaRock`, `scalingManaAmount`, `manaAmountFromAddClause`, `availableManaForSeat`, `summarizeAvailableMana` |
| `engine/costs.ts` | `adjustedCastingCost`, `totalCastingCost`, `staticCostReduction`, `selfConditionalCostReduction`, `selfScalingCostReduction`, `parseGrantedCostReduction`, `matchesCostReductionQualifier`, `miracleCostFor`, `targetingTax`, `totalAttackTax`, `maxAffordableX`, `xSymbolCount`, `genericCostShim` |
| `engine/lands.ts` | `entersBattlefieldTapped`, `shocklandPayLifeAmount`, `revealLandTypes`, `revealLandControlExempt`, `revealableLandCards`, `controlsLandType`, `landDropsAllowed`, `landPlaysMade`, `recordLandPlay`, `painlandDamageAmount`, basic-land fetch helpers |
| `engine/tokens.ts` | `parseCreateTokenSpecs`, `predefinedTokenSpec`, `parseCreatureTokenDescription`, `tokenColors`, `sentenceCaseAbilities`, `createTokensForSeat`, `createTokenCard`, `createCopyTokenForSeat`, `tokenCopyWorth`, `agentBestCopyCandidate`, `resolveCopyOneOfCandidates`; the `TokenSpec` type |
| `engine/counters.ts` | `applyCounterDelta`, `applyLoreCounterEtb`, loyalty helpers, the `entersWith*` family, `applyEntersWithCounterReplacements(+Core)`, `applyDevour`, `resolveProliferate` |
| `engine/zones.ts` | `resetForZoneChange`, `moveCardAcrossSeats(+Core)`, `moveCardBetweenVisibleZones(+Core)`, `applyEntryEffects`, `changeControlWithinBattlefield`, `withLeaveRecord`, `moveLibraryCard*`, `reorderTopLibraryCards`, commander-zone movers, `drawForSeat`, `drawMultipleForSeat` |
| `engine/damage.ts` | `applyCombatDamageToTarget(+Core)`, `applyDamagePrevention`, `addDamageShieldsFromSpec`, `dealDamageToCreature(+Core)`, `applyDealtDamageTriggers`, `markDamageOnCard`, `damageDoublingFactor` |
| `engine/combat.ts` | `canAttack`, `canBlock`, `attackerEvadesBlocker`, `creatureCantBlock`, `attackLockedOut`, `resolveAttackTarget`, `assignBlockers`, `resolveCombatDamage`, `cleanupCombat`, `simulate*BlockedCombat`, `resolveBlockedCombatDamage`, `legalAttackActions`, `legalBlockActions`, `forcedAttackers`, `applyExalted` |
| `engine/stateBased.ts` | `checkStateBasedActions`, `runStateBasedActionsPass`, `winTheGame`, `destroyCreatures(+Core)`, `findExileInsteadOfDying` |
| `engine/triggers.ts` | all `findXTriggers`, `makeCommonTrigger`, `enteredTriggerApplies`, `deathTriggerApplies`, `commonTriggerEffect`, `resolveTriggerEffect(+Once)`, the `TriggerEffect` type |
| `engine/phaseTriggers.ts` | `phaseTriggeredCards`, `applyDeterministicPhaseTrigger`, `makePhaseStackTrigger`, `planOffTurnPhaseTriggers`, `scheduleDelayedPhaseTrigger`, emblem functions, Undercity/initiative |
| `engine/abilities.ts` | Region M (`payGeneric*Cost`, `apply*Effect`, equip, manland, loyalty parse, transform, phase-out) |
| `engine/casting.ts` | face/split/MDFC helpers, `castStructure` and cast-time targeting, `hasResolvable*Target`, additional costs, ward, `canCastAtInstantSpeed`, `spellResolutionDestination`, `playCardFromZone` |
| `engine/spellEffects.ts` | `applySpellExtraEffect`, `applyRemovalEffect`, `applyZoneEffect`, mill/surveil/drain/discard/pump/mass-bounce, `applyPrimitiveAction(Plan)`, generic modal |
| `engine/legalActions.ts` | `legalMainPhaseActions`, `legalPriorityActions`, `legalActivatedAbilityActions`, `legalRoomUnlockActions`, `checkMoveLegal`, `fallbackLegalAction`, `LegalAgentAction` type |
| `engine/priority.ts` | `nextPrioritySeatId`, `pendingActionRequiredPasses`, `canReceivePriorityForPendingAction`, turn rotation |
| `engine/agentSnapshots.ts` | `pendingActionSummary`, `buildAgentDecisionContext`, `agentSeatSnapshot`, `agentCardSnapshot` |
| `components/AppFlow/*` (later) | The component half, split into custom hooks: `useAgentDriver` (Region C), `useDrainEffects` (B), `useSaveLoad` (D), `useCasting` (E,F,H) |

### Dependency order (extract leaves first)

I measured cross-region calls by scanning each region for calls to functions defined outside it:

1. **Leaves (safe first):** `keywords.ts` and `cardTypes.ts` utilities (nothing they call is
   interesting); then **`mana.ts` + `costs.ts` + `lands.ts`**. The mana/cost region calls out only to a
   handful of tiny helpers (`numberWordToInt`, `isLandCard`, `manaValueFromManaCost`, `capitalizeWord`,
   `basicLandTypes`, `hasHaste`, `resolveAttackTarget`, `emblemSourceCards`) - all movable into
   `cardTypes.ts`/`keywords.ts` first. It is called from everywhere (`chooseManaSourcesForCost` ~60
   call sites, `payCostFromPool` ~20), which is exactly why re-exporting matters.
2. **Next: `tokens.ts` and `counters.ts`.** Tokens calls out to `checkStateBasedActions`,
   `applyEntryEffects`, `findCommonTriggersForPermanentEntered`, `findPermanentById`, `rulesEvent`,
   `queuePlayerChoice`, `numberWordToInt`. Move the *parsing* half (`parseCreateTokenSpecs`,
   `predefinedTokenSpec`, `parseCreatureTokenDescription`) first - pure text, no dependencies - then the
   builder half after zones/triggers exist.
3. **Then `damage.ts`, `zones.ts`, `combat.ts`.** `zones` calls counters/entry replacements and
   `entersBattlefieldTapped` (fine once those are extracted).
4. **Tangled, go last:** `stateBased.ts`, `triggers.ts`, `phaseTriggers.ts`, `casting.ts`,
   `spellEffects.ts`, `abilities.ts`, `legalActions.ts`, and the entire component half.

### Circular-import risks actually observed

* **triggers <-> tokens**: `createTokensForSeat` calls `findCommonTriggersForPermanentEntered`; trigger
  effects (`commonTriggerEffect`, `resolveTriggerEffect`) call `predefinedTokenSpec` /
  `createTokensForSeat`. Break by keeping the token *parsers* in a leaf and having the token *builder*
  take the trigger finder as an argument or import it one-way.
* **stateBased <-> zones**: `runStateBasedActionsPass` and `destroyCreatures` move cards;
  `moveCardAcrossSeats` / `createTokensForSeat` call `checkStateBasedActions`. Extract SBA after zones and
  inject, or keep both in one module initially.
* **triggers <-> spellEffects <-> casting**: `resolveTriggerEffectOnce` calls the same `apply*Effect`
  functions spell resolution does, and `applySpellExtraEffect` / `applyRemovalEffect` call trigger finders
  after damage/death. Treat these as one cluster; split it only after the leaves are out.
* **legalActions <-> mana/casting**: `legalMainPhaseActions` calls mana, cost and target-resolvability
  functions; `checkMoveLegal` is called from the component. One-way if mana/costs/casting are already
  separate modules.
* **`src/lib` -> `AppFlow`**: `moveLegality.ts`, `selfplay/brains.ts`, `selfplay/orchestrator.ts`, and
  `src/components/abilityAudit.ts` / `clauseCoverage.ts` import from `AppFlow`. `moveLegality.ts` only
  imports the `LegalAgentAction` *type* (safe); the others import runtime functions, so after
  extraction they should import from `src/engine/*`, not AppFlow. `stackDescription.ts` already avoids
  importing AppFlow by using a structural type.
* **Component closures**: anything inside `AppFlow()` that is called by module-level code does not exist
  (module-level code cannot see it), which is why the engine half and component half are already
  separable. The reverse direction (component calls engine) is the only direction, so the engine is
  extractable without touching React. Note the engine records intents on `session.pending*` precisely
  because it cannot call back into the component; preserve that pattern.

### Migration mechanics

About **75-90 files** (mostly tests; the count you quoted, ~140, may include other import forms; I counted 74 test files plus `abilityAudit.ts`, `clauseCoverage.ts`, `moveLegality.ts`, selfplay, scripts,
`app/page.tsx`) import from `"./AppFlow"` / `"@/components/AppFlow"`. So for each move: put the function
in the new module, `export { fn } from "@/engine/..."` (or import and re-export) in `AppFlow.tsx`, run
`npx vitest run`, and only then consider updating importers. Do not combine a move with any logic change.

### Recommended order

1. `engine/cardTypes.ts` + `engine/keywords.ts` (tiny utilities and predicates).
2. `engine/mana.ts`, then `engine/costs.ts`, then `engine/lands.ts` (`entersBattlefieldTapped`).
3. `engine/tokens.ts`, parsing half first.
4. `engine/counters.ts`.
5. `engine/damage.ts`, `engine/zones.ts`.
6. `engine/combat.ts`.
7. `engine/legalActions.ts`, `engine/priority.ts`, `engine/agentSnapshots.ts`.
8. The tangled cluster: `stateBased`, `triggers`, `phaseTriggers`, `abilities`, `casting`, `spellEffects`.
9. Finally, split the component half into hooks.

---

## 6. Where do I look when...

| Symptom | Open first |
|---|---|
| A land enters tapped (or untapped) wrongly | `entersBattlefieldTapped` (Region U, ~31850). Shock/reveal/"unless you control" lands: `shocklandPayLifeAmount`, `revealLandTypes`, `revealLandControlExempt`; the human shock prompt is `session.pendingShockChoices`. Also check the land-play path in `playCard` / `playCardFromZone`. |
| A token count, type, or P/T is wrong | `parseCreateTokenSpecs` (the text -> `TokenSpec` parse), then `predefinedTokenSpec` (Treasure/Food/...), then `createTokensForSeat`. "Number of X" counts: `resolveDynamicAmount`, `resolveWhereXBoardCount`. Tests: `AppFlow.pestInfestation.test.ts`, `AppFlow.deckAudit.test.ts`. |
| A permanent offers/produces the wrong mana color (color leak) | `manaChoicesForCard` -> `manaChoicesForCardRaw`; costly taps: `costlyTapManaColors`; conditions: `conditionallyUnavailableColors`, `activateOnlyIfConditionMet`, `isBoardConditionMet`. Source selection: `chooseManaSourcesForCost`, `manaSourceMayPayFor`. |
| Wrong cost (tax, reduction, X, commander tax) | `totalCastingCost`, `adjustedCastingCost`, `staticCostReduction`; test `AppFlow.commanderTax.test.ts`, `AppFlow.costReductionColoredPipFloor.test.ts`. |
| An ETB trigger does not fire | `findCommonTriggersForPermanentEntered` + `enteredTriggerApplies` (and `src/lib/triggerWatchers.ts` for watchers); is the entry queued? Non-cast entries use `session.pendingEntries` drained by the `pendingEntries` effect in `AppFlow()`. Text -> effect: `commonTriggerEffect`; execution: `resolveTriggerEffectOnce`. |
| A death/leaves trigger does not fire | `destroyCreaturesCore` (does it push `pendingDeaths`?), the `pendingDeaths` drain effect, `findCommonTriggersForPermanentDied`, `deathTriggerApplies`. |
| An "at the beginning of..." trigger misses | `src/lib/phaseTriggers.ts` (`collectPhaseTriggers`), `phaseTriggeredCards`, `phaseTriggerTextMatches`, `applyDeterministicPhaseTrigger`, `runPhaseActions`. |
| Attack/combat damage trigger wrong | `findAttackTriggers` / `findCombatDamageToPlayerTriggers`, `declareAttack`, `session.pendingCombatDamageToPlayer`. |
| The AI makes a bad choice | Legal list: `legalMainPhaseActions` etc. (is the bad option even offered? should it be filtered?). Ranking: `src/lib/actionScoring.ts`, `playGuards.ts`, `strategy.ts`, `lookAhead.ts`. Prompt: `app/api/agents/action/route.ts`, `docs/agents/system.md`, `docs/mtg/gameplay-heuristics.md`. Non-main-phase choices (targets, sacrifices): `resolveAgentRuleChoice`, `choose*Target`. Then add a row to `docs/agents/real-game-mistakes.md`. |
| An agent made a move that should be illegal | `checkMoveLegal`, `src/lib/moveLegality.ts` (`decideWithGate`). |
| A card is not recognised / does nothing | Run `abilityAudit` (`npm run audit:abilities`); `src/components/clauseCoverage.ts` `recognises`; `bench/coverage/backlog.md`; which parser should own its text (`removalSpells`, `zoneEffects`, `spellExtras`, `activatedAbilities`, `oracleClauses`). If none, the LLM fallback runs: `consultRulesAdvisor` / `consultPrimitiveActionPlanner` (see `advisor-log.jsonl`). |
| A human is not asked about a choice | `bench/coverage/choice-audit.md`; the `pending*Choices` queues; `PendingRuleChoice` kinds; `resolveDeferredChoice`. |
| Stack/priority is stuck | `pendingAction`, `stackActions`, `priorityPasses`; `pendingActionRequiredPasses`, `nextPrioritySeatId`, `canReceivePriorityForPendingAction`; `src/lib/priorityStops.ts`. Drain effects wait on `!pendingAction`. |
| A static buff/keyword is not applying | `runStateBasedActionsPass` (recomputes the `granted*` fields), `src/lib/characteristics.ts`, `attachments.ts`, `typeGrants.ts`, `hasKeyword`. |
| A spell targets wrongly / cast-time targets | `spellTargetSlots`, `castStructure`, `nextCastPrompt`, `src/lib/targeting.ts`, `targetSpecs.ts`. |
| Damage not prevented / doubled | `applyDamagePrevention`, `src/lib/damagePrevention.ts`, `damageDoublingFactor`, `session.damageShields`, `combatDamagePrevented`. |
| A zone change leaves stale state | `resetForZoneChange`, `moveCardAcrossSeats`, `moveCardBetweenVisibleZones`. |
| Save/load loses something | `buildSaveSnapshot`, `applySnapshot`, `src/lib/saveGame.ts` (note mana pools and the stack are component state). |
| Mulligan / opening hand | `resolveAgentMulligans`, `src/lib/mulliganHeuristics.ts`, `keepOpeningHand`. |

---

## 7. Glossary (project-specific terms)

* **Deterministic-first**: house pattern. Every card-text shape has a hand-written parser that returns
  structured data or `undefined` ("decline rather than guess"). Only if all decline does the LLM get a
  turn.
* **Rules Advisor** (`src/lib/rulesAdvisor.ts`, `/api/rules/check`, `consultRulesAdvisor`): LLM
  translates an unrecognised card text + event into a `RuleWorkflow` (a short list of steps like draw,
  scry, search), which `applyRuleWorkflow` executes. Results are cached per card/event
  (`ruleWorkflowCacheKey`, localStorage `mtg-rule-workflow-cache-v3`, plus `prewarmRuleWorkflowCache`).
  `shouldConsultRulesAdvisor` is a keyword pre-gate; if it says no, the planner below is used instead.
* **Primitive action planner** (`src/lib/primitiveActionPlan.ts`, `consultPrimitiveActionPlanner`,
  `applyPrimitiveActionPlan`): last-resort LLM translator into primitive steps (draw, destroy, sacrifice,
  move zone). Broader than the Rules Advisor.
* **Static effect interpreter** (`/api/rules/static-effect`, `consultStaticEffectInterpreter`): LLM reads
  an unrecognised static ability (e.g. attack restrictions) and returns an `InterpretedEffect`.
* **XMage reference corpus**: `data/xmage-source/` holds the Java card implementations from the XMage
  project; `scripts/ingest-xmage-cards.mjs` indexes them into the `xmage_cards` table
  (`src/lib/cardDb.ts`); `src/lib/xmageGrounding.ts` looks up a card's XMage code so the LLM fallbacks are
  shown a reference implementation. Static reference only - nothing runs XMage. (`xmageBridge.ts` /
  `session.xmage` describe an optional external bridge, see `docs/xmage-bridge.md`; it is a stub.)
* **parsed_cards**: SQLite cache of offline LLM card parses (`scripts/parse-cards.mjs`,
  `cardParser.ts`); `override-card` writes protected `manual_override` rows.
* **abilityAudit** (`src/components/abilityAudit.ts`, `npm run audit:abilities`): strict per-card
  report of which engine subsystem handles each activated ability / granted ability / ward cost, flagging
  "unmodelled" ones. Triggered abilities are not yet covered.
* **clauseCoverage / deckCoverage baselines**: `recognises()` says whether any parser claims an oracle
  line. `AppFlow.deckCoverage.test.ts` runs it over every shipped deck and asserts that the count of
  unrecognised lines per deck stays **at or below a recorded baseline** (a ratchet: a new card or parser
  regression that raises the count fails). When you legitimately add cards, update the baseline numbers in
  `DECKS`; `UPDATE_COVERAGE=1` prints the offenders.
* **backlog / choice-audit** (`bench/coverage/`): generated work queues - unrecognised rules-text
  templates by frequency, and decisions the engine makes on a human's behalf, ranked by EDHREC popularity.
* **Self-play** (`src/lib/selfplay/`, `npm run selfplay`, `agent:mistakes`): headless games where seats are
  driven by a "brain" (`heuristicBrain`, or `ollamaBrain` with `--ollama`). The orchestrator only
  sequences; all rules effects use the real AppFlow exports. After every action `audit.ts` checks rules
  integrity; a win-rate from a run with violations is untrustworthy. `mistakes.ts` flags "wasteful play"
  (pointless sacrifices, wasted removal, suicide attacks).
* **Play guards** (`playGuards.ts`, `wipeSequencing.ts`, `freeAttack.ts`): deterministic penalties/vetoes
  on dumb-but-legal plays, applied as large score adjustments in `actionScoring`.
* **Legality gate** (`moveLegality.ts` + `checkMoveLegal`): agents only *propose*; every proposal is
  validated (not stale, not hallucinated, not previously rejected, legal now, will actually do something)
  and rejected proposals are fed back to the model; after `MAX_DECISION_REJECTIONS` a deterministic
  fallback takes over.
* **Pending choices / `pending*` queues**: see section 3 - requests a pure function leaves on the
  session for a component effect to turn into a prompt or trigger. Not to be confused with
  `pendingAction` (the live top-of-stack item) or `pendingRuleChoice` (the open prompt).
* **Choke point**: a single function every path must go through (e.g. `setSession` for SBA,
  `applyDamagePrevention` for damage, `hasKeyword` for keywords, `checkMoveLegal` for moves).
* **Hoisted**: a function that used to be nested in the component and was moved to module level so
  self-play could call it. Several remain nested because they need React state.
* **Agent lessons** (`agentLessons.ts`, `data/agent-lessons.json`): corrections you type to an agent via
  its chat; fed back into later prompts.
* **Priority stops** (`priorityStops.ts`): your per-phase preferences for when you get asked to respond.
* **Foundations precons** (`decks/foundations`): the five decks used as default pods, loaded via the deck library API
  (you: Reign of Dragons; agents: the others).
* **Bracket 3** (`bracketPolicy.ts`, `docs/mtg/bracket-3-policy.md`): the power level agents/deck-builder
  target; bans mass land destruction etc.
* **Spec** (`mtg-commander-engine-spec.md`): original design document; code comments like "Phase 3a"
  refer to its numbered phases. Not everything in it was built.

## 6. Extraction status

* **`src/engine/mana.ts` - DONE** (50 functions, ~1030 lines). Moved verbatim from Region U: mana pool
  (`emptyManaPool`, `addManaToPool`, `addPools`, `manaPoolTotal`, `payCostFromPool`, `spendGenericMana`,
  `manaPoolDifference`, `formatManaPoolPayment`, `attackTriggerManaHeuristicSplit`), source planning
  (`chooseManaSourcesForCost`, `chooseManaSources`, `manaSourceMayPayFor`, `manaSourceRestrictionMismatch`,
  `manaRequirementForCard`, `anyColorManaSpendingActive`, `isAvailableManaSource`, `summarizeAvailableMana`,
  `availableManaForSeat`, `cannotPayMessage`), what a permanent can produce (`manaChoicesForCard(+Raw)`,
  `costlyTapManaColors`, `splitManaClausesByCost`, `addedManaColors`, `chosenColorManaAbility`,
  `conditionallyUnavailableColors`, `isBoardConditionMet`, `isRecognizedBoardCondition`, `lifeGainedThisTurn`,
  `activateOnlyIfConditionMet`, `effectiveManaOracleText`, `stripReminderText`, `normalizeManaColors`,
  `producibleColorsForLand/FromLands`, `manaColorForBasicLand`, `isManaRock`, `scalingManaAmount`,
  `manaAmountFromAddClause`, `signetAbility`, `manaProducedBy`, `selectedManaTotal`, `isDragonMana`),
  and spending/tapping (`spendManaSources`, `tapVisibleCard`, `isSacrificeManaSource`,
  `manaAbilityCounterRemovalKind`, `depletionSacrificeCounterKind`, `painlandDamageAmount`).
* **`src/engine/shared.ts` - leaf helpers** the mana code needed: `hasKeyword`, `hasHaste`,
  `numberWordToInt`, `isLandCard`, `isBasicLandCard`, `basicLandTypes`, `COMMANDER_STARTING_LIFE`.
  (A subset of the proposed `cardTypes.ts`/`keywords.ts`; split them out later.)
* AppFlow.tsx imports these and re-exports every previously exported symbol, so test imports are unchanged.
* Not moved from the proposed mana list: `entersBattlefieldTapped`/`shocklandPayLifeAmount` (belong to `lands.ts`),
  cost computation (`costs.ts`). `parseGrantedCostReduction` (costs) still calls `isDragonMana` via import.

* **`src/engine/tokens.ts` - PARTIAL (parsing half + pure builders)**, ~276 lines, moved verbatim: `TokenSpec` type,
  `parseCreateTokenSpecs`, `predefinedTokenSpec`, `parseCreatureTokenDescription`, `tokenColors`,
  `sentenceCaseAbilities`, `createTokenCard`, `tokenCopyWorth`, `agentBestCopyCandidate`. `capitalizeWord` moved to `shared.ts`.
  Left in AppFlow.tsx (blocked by AppFlow-resident calls, to avoid a triggers<->tokens cycle): `createTokensForSeat`
  and `createCopyTokenForSeat` (call `applyEntryEffects`; the former also `checkStateBasedActions` and
  `findCommonTriggersForPermanentEntered`), `resolveCopyOneOfCandidates` (`findPermanentById`, `rulesEvent`,
  `queuePlayerChoice`). Move them after zones/triggers/SBA are extracted.

* **`src/engine/lands.ts` - DONE**, ~160 lines, moved verbatim: `entersBattlefieldTapped`, `shocklandPayLifeAmount`,
  `SHOCKLAND_MINIMUM_SAFE_LIFE`, `revealLandTypes`, `revealLandControlExempt`, `revealableLandCards`, `controlsLandType`,
  `knownEntersTappedCards`, and land-drop bookkeeping (`landDropsAllowed`, `landPlaysMade`, `recordLandPlay`, `landTurnKey`).
* **`src/engine/costs.ts` - DONE (cost computation)**, ~400 lines, moved verbatim: `manaValueFromManaCost`, `cardWithFaceManaCost`,
  `xSymbolCount`, `maxAffordableX`, `parseMultikickerCost`, `hasSingleKicker`, `adjustedCastingCost`, `totalCastingCost`,
  `staticCostReduction`, `parseGrantedCostReduction`, self-conditional/scaling/unlock reductions, Saheeli affinity helpers,
  free-cast / alt-cost permission checks (Omniscience, One with the Multiverse, Demon of Fate's Design), `miracleCostFor`,
  `parseMiracleCost`, `findMiracleGranter`, `isHistoricCard`. `emblemAsShimCard`/`emblemSourceCards` moved to `shared.ts`.
  Left in AppFlow.tsx: `spellFaceCostCard`/`castFaceOptions`/`castFaceDecision` (need `canCastAtInstantSpeed`, `hasResolvableTarget`,
  `isMainPhase`), the additional-cost payers (`payAdditionalDiscardCost`, `sacrificeForAdditionalCost`, ... mutate sessions), `genericCostShim`.

* **`src/engine/zones.ts` - PARTIAL (leaf half of the zone/entry layer)**, ~1,150 lines, 40 symbols moved verbatim: `findPermanentById`,
  `findExiledCardAnySeat`, `rulesEvent`, `queuePlayerChoice`, `resetForZoneChange`, `withLeaveRecord`, `moveCardBetweenVisibleZones(+Core)`,
  `moveCommanderToCommandZone`, `changeControlWithinBattlefield`, `destroyCreaturesCore`, `findExileInsteadOfDying`, `CrossSeatZone`,
  `moveLibraryCard`, `moveTopLibraryCardToHand`, `reorderTopLibraryCards`, `putLookedAtCardsInGraveyard`, `applyPutCardsOnLibrary`,
  `applyGraveyardToLibrary`, `applyGraveyardExile`, `GraveyardReturnOptions`, counter deltas (`applyCounterDelta(+AtSession)`, `applyLoreCounterEtb`,
  `loyaltyCounterCount`, `withInitialLoyaltyCounters`), enters-with-counters helpers (`applyEntersWithCounterKind`, `applyEntersWithXCounters`,
  `applyEntersWithCounterReplacementsCore`, `entersWithFixedCounterKind`, `entersWithCounterPerColorControlled`, `colorsAmongPermanentsControlled`),
  enter-as-copy (`parseEnterAsCopyEffect`, `enterAsCopyCandidates`, `findEnterAsCopyTarget`, `applyEnterAsCopyOnEntry`), plus helpers
  `isPlaneswalkerCard`, `possessive`, `shuffleCards`, `randomInt`.
  **Remaining cycle-blockers** (left in AppFlow.tsx). The one real cycle is
  `applyEntersWithCounterReplacements -> applyDevour -> finishDevour -> destroyCreatures -> createTokensForSeat -> {checkStateBasedActions,
  findCommonTriggersForPermanentEntered, applyEntryEffects -> applyEntersWithCounterReplacements}`. It pins: `applyEntersWithCounterReplacements`,
  `applyDevour`, `finishDevour`, `applyEntryEffects`, `moveCardAcrossSeats(+Core)`, `moveLibraryCardToDestination`, `returnLinkedExiles`,
  `applyGraveyardReturn(+Picked)` (they all reach `applyEntryEffects` via `moveCardAcrossSeats`) and `destroyCreatures` itself (its Kalitas
  exile-instead branch calls `createTokensForSeat`; `finishDevour` calls it). Breaking the cycle needs `createTokensForSeat` out of AppFlow, which
  needs `checkStateBasedActions` + `findCommonTriggersForPermanentEntered` (the SBA/trigger cluster: `runStateBasedActionsPass`, `enteredTriggerApplies`,
  `makeCommonTrigger`, trigger parsers), whose own closure runs through zones back to these. Cheapest next cut: move the SBA + trigger-finder
  cluster together with `createTokensForSeat`/`createCopyTokenForSeat`/`resolveCopyOneOfCandidates`/`destroyCreatures`/devour/`applyEntryEffects`
  /`moveCardAcrossSeats` as one module, or inject a token-creation callback into `destroyCreatures`.
  `createTokensForSeat`/`createCopyTokenForSeat`/`resolveCopyOneOfCandidates` therefore could NOT yet move to tokens.ts
  (`createTokensForSeat` needs SBA + triggers; `createCopyTokenForSeat` needs `applyEntryEffects`; the last needs `createCopyTokenForSeat`).

* **Resolution cluster - DONE (the "hard cut")**. Measured by computing strongly connected components over AppFlow's 611 top-level
  declarations: two real cycles exist, (a) the entry cycle `applyEntersWithCounterReplacements -> applyDevour -> finishDevour -> destroyCreatures
  -> createTokensForSeat -> checkStateBasedActions/runStateBasedActionsPass -> moveCardAcrossSeats(+Core) -> applyEntryEffects -> ...` (11 functions)
  and (b) the effect/trigger cycle `resolveTriggerEffect(+Once) <-> applyPrimitiveAction / applySpellExtraEffect / applyRemovalEffect /
  resolveDeferredChoice / applyDeterministicPhaseTrigger / dealDamageToCreature ...` (13 functions). The full downward closure of both (202
  declarations, ~9,500 lines) moved verbatim, split by theme:
  * `engine/types.ts` - `PendingAction`, `PendingRuleChoice`, `TriggerEffect`, `TriggerCondition`, `PendingTargetedEffect`, `CastChoices`, `LabeledSlot`,
    `LabeledContinuation`, `TurnPhase` (type-only, no runtime).
  * `engine/entry.ts` - `applyEntryEffects`, `moveCardAcrossSeats(+Core)`, `moveLibraryCardToDestination`, `returnLinkedExiles`, `applyGraveyardReturn(+Picked)`,
    `destroyCreatures`, devour / `applyEntersWithCounterReplacements`.
  * `engine/stateBased.ts` - `checkStateBasedActions`, `runStateBasedActionsPass`, `winTheGame`, Starfield of Nyx helpers.
  * `engine/damage.ts` - combat/noncombat damage, prevention shields, dealt-damage triggers, keyword predicates (`hasFlying` ...), protection.
  * `engine/tokens.ts` (extended) - `createTokensForSeat`, `createCopyTokenForSeat`, `resolveCopyOneOfCandidates`.
  * `engine/triggers.ts` - `findCommonTriggersFor*`, `makeCommonTrigger`, `commonTriggerEffect`, `resolveTriggerEffect(+Once)`, phase/delayed triggers, venture/initiative, Braids/Meren.
  * `engine/effects.ts` - spell/removal/zone/primitive/generic-modal effect appliers, target choosers, draw/library-look workflows, deferred choices.
  AppFlow.tsx imports what its component still uses and re-exports every previously exported moved symbol.
  **Cycle handling:** these modules import each other circularly (entry <-> stateBased <-> triggers <-> effects <-> damage <-> tokens). This is safe because
  every cross-module reference is a function declaration (hoisted, used only at call time); the only top-level values in these files are literal
  constants (`CEREMONIES_TOKEN_TEXT`, `PROTECTION_COLOR_CODE`, `ETB_WATCH_TYPE_WORDS`, `MAX_TRIGGER_RESOLUTIONS_PER_TURN`, `IMPRISONED_RE`,
  `BRAIDS_TYPE_FILTER`) that read no imports. Each module was verified to import cleanly as the first entry point. **Rule for future edits: never add a top-level
  statement in these files that calls an imported function or reads an imported value.** No callbacks were injected.
  **Left in AppFlow.tsx:** the `AppFlow()` component (React state/hooks) and everything only it uses (UI handlers, save/load, mulligan, stack UI, agent
  orchestration) - none of it is in either cycle. `AppFlow.humanAgentParity.test.ts` scans source text, so it now reads AppFlow.tsx plus `src/engine/*.ts`.

* **Module-level carve of AppFlow.tsx - DONE.** Everything at module level outside `AppFlow()` moved verbatim (scripted, by TypeScript AST) into
  `engine/{turnFlow,combat,legalActions,abilities,etb,oneShotEffects,triggerFinders,castTargets,casting,priority,mulligan,flowTypes}.ts`,
  `components/{DeckSetup.tsx,viewModels.ts}` and `lib/agentRuntime.ts`. AppFlow.tsx went from 20.8k to ~10.8k lines and now contains the component only.
  Same cycle rule as above: the new engine files import each other circularly through hoisted function declarations only; no top-level statement
  reads an imported binding (checked by script), and each file was verified to import cleanly as the first entry point.
  **Next carve:** split the `AppFlow()` component itself into hooks / sub-components (`useAgentDriver`, `useSaveLoad`, stack UI, choice-prompt handlers).
  Only 3 inner functions were free of React state; the rest need state passed in, so that is a design change, not a mechanical move.
* **Component split, step 1 - DONE (leaf pieces only).** `AppFlow()` measured: 40 `useState`, 42 `useRef`, 40 `useEffect`, 4 `useMemo`,
  194 inner functions (~8.4k lines; effects ~1.1k lines). Approx. lines by concern: stack/priority 2.1k, choice prompts 1.5k, cast/activate 1.1k,
  trigger/phase 1.0k, agent driver 0.5k, mana 0.5k, combat 0.4k, deck/setup 0.2k, save/load 0.15k. Extracted (verbatim, same call position so
  effect order is unchanged): `components/SetupScreen.tsx`, `components/GameOverDialog.tsx` (props-only JSX) and
  `components/hooks/{usePriorityStopSettings,useDeckLibrary,useSavedGames}.ts`. See `src/components/README.md`.
  **Remaining core in `AppFlow()` (~10.6k lines):** the stack/priority resolver, trigger/choice-prompt handlers, casting, combat and the agent
  turn-loop effects all read and write the same ~30 session-level states and ~20 refs (`session`, `pendingAction`, `stackActions`, `manaPools`,
  `pendingRuleChoice`, `priorityPasses`, the `*ThisTurn` refs, `stackActionsRef`...) and call each other freely (resolvePendingActionNow alone is
  1,000 lines). A hook split needs those handlers grouped behind a context object first; do it one cluster at a time (mana state, then combat UI).
* **Component split, step 2 - DONE: shared-context split of `AppFlow()`.** `AppFlow.tsx` is now ~370 lines (prop types, glue, a few JSX-only derived
  values, the JSX). All state moved into `components/game/context.ts` (`useGameState`) and every handler/effect moved verbatim into
  `components/game/use*.ts` hooks that take one `GameContext` (state + setters + refs grouped as `stack`/`mana`/`choices`/`agent`/`turn`, plus `late`).
  Handlers that live in another hook are reached through `lateFn(ctx, "name")` (call-time lookup on `ctx.late`, which `AppFlow()` fills with every hook's
  returned functions each render), so mutually-calling handlers did not have to be regrouped and each call still hits the same render's closures.
  All `useEffect` blocks (originally one contiguous run) sit in `game/useGameEffects.ts` in their original relative order and are called after every
  handler hook, before the one remaining effect in `AppFlow()`. Bodies are byte-identical to the original; only a destructuring preamble was added per
  hook. `AppFlow.humanAgentParity.test.ts` now scans `AppFlow.tsx` + `src/engine/*.ts` + `src/components/game/*.ts`. Hook map: `src/components/README.md`.
  Known leftovers: `useStackResolution.ts` (1.6k lines, contains `resolvePendingActionNow`, ~1k lines on its own) and the effects file (1.2k) are still
  large; splitting `resolvePendingActionNow` per action type is the next candidate, but needs real design (it is one function with shared locals).
