# src/kernel/integration: foundations for running the kernel engine behind the existing table

Status: groups 1, 2 and 3a of `docs/kernel-integration-plan.md` (kernel read API, card packs + `KernelSession`, reverse adapter). Nothing here is wired into
the UI yet (`AppFlow`, `ThreeGameTable` and the legacy engine are untouched). Pure TypeScript: no React, no DOM, no fs, except the three files marked Node.

| file | role |
|---|---|
| `../engine/legal.ts` | `legalActions(state, player, ctx)`, `canRespond`, `effectiveView(s)` (exported from `src/kernel/engine/index.ts`) |
| `toSession.ts` | `toSession(state, viewer, env, previous?) -> GameSession`; `cardForObject`, `manaPoolsOf`, `legacyPhase` |
| `tableState.ts` | `toTableState(state, viewer, env, previous?)`: session + priority + stack panel + decision + declaring; `stackViews`, `decisionView` |
| `eventLog.ts` | kernel events -> legacy log lines (`formatEvent(s)`), viewer-safe names |
| `kernelSession.ts` | `KernelSession`: the host object (dispatch, decide, view, log, save / restore, hand-off from a legacy session) |
| `cardPack.ts` | `CardPack` JSON type, `packKit(packs)` (lookup + CardDb + display), `fetchPacks`, `displayFromDef` (browser-safe) |
| `packLookup.ts` | `packDraftLookup(kit)`: a browser-safe `DraftLookup` for the forward adapter (hand-off) |
| `nodePack.ts` (Node) | `buildPack(slug)`: builds a pack from `data/kernel-drafts`, `data/cards.db`, the legacy card catalog and `decks/**.txt` |
| `testgame.ts`, `randomPlay.ts` (tests) | real Wretched Ranks games (`realGame`, `mini`) and a seeded random player over `legalActions` |
| `../../../scripts/kernel-bundle-drafts.ts` (Node) | `npm run kernel:bundle-drafts`: writes `public/kernel-packs/<deck>.json` |

## 1. legalActions and effectiveView (src/kernel/engine/legal.ts)

```ts
legalActions(state, player, ctx, opts?: { mana?: boolean }): LegalAction[]
canRespond(state, player, ctx): boolean               // any non-mana action besides passing
effectiveView(state, objectId, ctx): ObjectView        // the object after layers, for display
effectiveViews(state, ctx, ids): Record<ObjId, ObjectView>
```
What is listed (all for the asking player only):

| situation | entries |
|---|---|
| a decision is open | none for anybody but its owner; for the owner ONE `answerDecision` entry with the full `pending` (options) and ready `choices` (single picks, yes / no, `[]` when min 0, cancel) |
| a declaration is awaited (`combat.expect`) | `declareAttackers` (candidates with their legal defenders, `mustAttack`, a minimal legal declaration in `action`) for the attacker, `declareBlockers` (candidates with the attackers each may block) for each defender that owes one |
| the player holds priority | `playLand` (per face for modal double-faced cards, also from exile / top of library by permission), `castSpell` (per face and per way of casting: normal / flashback / escape / alternative; from hand, command zone, graveyard, exile, library top when a cast option or permission allows), `activateAbility` (every activated and mana ability whose zone matches), `passPriority` |
| anything else | `[]` |

Consistency with `resolve` is by construction: each `playLand` / `castSpell` / `activateAbility` candidate is run through `resolve` (which clones the state; the
input is never touched) and only listed when accepted. A cast or activation that asks questions is followed with least-committal answers to check that it can
be PAID; one that ends in `cannot_pay` is not listed (the kernel asks for payment last, so otherwise the player would only find out after answering everything).
Each entry carries `asks` (first question: `choose_targets`, `choose_modes`, `choose_x`, ...) and, for targets, `targetOptions`. In continue mode an ability the
kernel would only report as `unresolved` (nothing performed) is not listed. The property test (`legal.test.ts`) plays seeded random Wretched Ranks games through
`legalActions` and re-checks every listed action, every answer choice and a sample of declarations against `resolve` (4 games x 160 positions).
Cost: about 10-15 ms per position on a real Commander board (one `resolve` per candidate); `canRespond` / `{mana:false}` skip the mana abilities.
Known limits: attack / block taxes are not pre-checked (a declaration can still be refused `cannot_pay`); no target combinations are enumerated (only the first question).

`effectiveView` fields: name, types, subtypes, supertypes, colors, manaValue, power / toughness (after layers and counters), printedPower / printedToughness,
keywords, abilities (effective, with text), `grantedAbilities`, `abilitiesStripped`, `lostKeywords`, owner, controller, zone, tapped, `summoningSick` (the kernel's
own predicate: controlled since before the controller's turn began, haste exempt), damage, counters, `attachedTo` / `attachments`, token, isCommander, faceDown,
face, attacking / `attackTarget`, blocking / `blockedAttackers`, `cantAttack`, `cantBlock`, loyalty.

## 2. toSession: the legacy GameSession from kernel state

`toSession(state, viewer, env, previous?)` takes the FULL state and the viewer (a player id or `SPECTATOR`), applies `viewFor` first, and builds the session only
from what the viewer may see. Effective characteristics come from `effectiveViews` (layers), display data from `env.display(cardName)` (the pack), with the card
definition as fallback. `previous` (the last result) makes every unchanged card / seat / board array / the session itself the SAME object.

`env = { ctx, display?, seats?, log?, legacyIds?, id?, createdAt? }`: `seats` = per player `{kind, agentName, remoteSlot}` (default: the viewer is the only human);
`log` = this viewer's log lines (newest first, `KernelSession` keeps them); `legacyIds` = kernel id -> legacy card id after a hand-off.

Card ids are the kernel ids (`#12`); stubs are `hidden:<seat>:<zone>:<i>` like `multiplayer/view.ts`. Use `toTableState` for the rest of what the table is given
(`prioritySeatId`, `priorityPasses`, `requiredPasses`, `manaPools`, `pendingAction` = top of the stack, `stackActions` = the rest, `decision`, `waitingFor`, `declaring`).

### Coverage table (legacy field -> what toSession does)

Filled = copied / derived from kernel state; Default = left unset (the renderer treats it as "no badge / no bonus"); Gap = kernel cannot say.

**GameSession**

| field | status |
|---|---|
| `id`, `createdAt` | filled from `env` (defaults: `kernel-session`, `""`) |
| `status` | derived (`playing`, or `complete` when `gameOver`) |
| `winnerSeatId` | filled from `gameOver.winner` |
| `activePlayerId`, `turn` | filled (`turn.active`, `turn.number`; same counting as the legacy engine) |
| `phase` | derived: kernel phase -> legacy phase name (`first_strike_damage` -> "combat damage step") |
| `xmage` | default (`not_configured`) |
| `seats` | filled (below) |
| `events` | filled from `env.log` (`KernelSession.log(viewer)`: viewer-filtered kernel events as text, `unresolved` lines carry `detail: "Unresolved"`) |
| `monarchSeatId` | filled from `state.monarch` |
| `stackSpellCardIds` | derived (spell objects on the stack) |
| `initiativeSeatId`, `undercityRooms` | Gap (kernel has no initiative / Undercity) |
| every `pending*` queue, `unresolvedEffects`, `damageShields`, `delayedPhaseTriggers`, `extraTurnsQueue`, `attackPool`, turn counters (`damageThisTurn`, ...) | Default: legacy engine bookkeeping with no meaning in kernel mode (kernel decisions come through `TableState.decision`) |

**PlayerSeat**

| field | status |
|---|---|
| `id`, `name`, `life`, `hasLost` | filled |
| `kind`, `agentName`, `remoteSlot` | filled from `env.seats` (viewer = human by default) |
| `commanderDamage` | filled (kernel `commanderDamage[victim]`, keys mapped to card ids) |
| `poison`, `experienceCounters` | filled from player counters |
| `emblems` | filled from emblem objects in the command zone |
| `floatingMana` | filled (plain pool; restricted `manaUnits` are a Gap) |
| `library` | stubs of the right length (the top card is real when its owner may look at it); `zones.*` counts filled |
| `board.hand` | the viewer's cards; stubs (right count) for everybody else |
| `board.battlefield` | permanents controlled by the seat; `board.graveyard`, `board.exile` (another player's face-down exile = stub), `board.commander` (the commander card while in the command zone) |
| `deck`, `drawnThisTurn`, `createdTokenThisTurn`, `lifeAtTurnStart`, `nextSpellHas*`, `noMaximumHandSize`, `creatureAttackBans`, `lockedUntilSeatTurn`, `lossReason` | Default |

**VisibleCard** (only fields the renderer or the shared predicates read are listed; everything else is Default)

| field | status |
|---|---|
| `id`, `name`, `typeLine`, `oracleText`, `manaCost`, `manaValue`, `colors`, `colorIdentity`, `producedMana`, `imageUris`, `faces`, `role`, `zone` | filled (pack display data; `typeLine` is the effective one on the battlefield when layers changed the types; tokens: "Token ..." line, keywords + ability text as oracle text; DFCs: face name / face text, `unlockedFaceIndices`) |
| `power`, `toughness`, `setPowerOverride`, `setToughnessOverride` | derived so that `effectivePower` / `effectiveToughness` return exactly the kernel's number: printed strings, plus an override (= effective minus the +1/+1 / -1/-1 counter bonus) only when they differ |
| `loyalty` | filled from the loyalty counter (which is then not listed in `counters`) |
| `counters` | filled |
| `tapped`, `damage` | filled |
| `summoningSick` | derived from the kernel predicate (creature, no haste, controlled since after its controller's turn began): `isSummoningSick(card)` of `src/lib/summoningSickness.ts` agrees |
| `attacking`, `attackTargetId`, `blocking`, `blockingTargetId`, `extraBlockingTargetId` | filled from `combat` |
| `attachedToId` | filled (valid hosts only) |
| `abilitiesStripped`, `lostKeywords` | derived from layer 6 (all printed abilities gone / printed keywords no longer present) |
| `grantedKeywords` | derived (effective keywords that the printed text does not have), `grantedManaAbilityText` / `grantedAbilityText` from granted abilities |
| `chosenColor`, `chosenCreatureType`, `chosenMode` | filled from `GameObject.chosen` |
| `commander`, `commanderTax` | filled (`commanderCasts * 2`) |
| `token`, `ownerSeatId` (owner != controller), `spellCopy`, `kicked` | filled |
| `faceDownCardName` | filled for the face-down card's own controller / owner; others see "Face-down card" with 2/2 |
| `exiledPlayableBySeatId`, `exiledPlayableUntilTurn`, `exiledPlayableFree` | filled from `permission_to_play` durable effects (exile pile cast button) |
| `permanentTimestamp` | filled (kernel timestamp) |
| `phasedOut` | Gap (no phasing in the kernel) |
| `enteredTurn`, `enteredFrom` | Gap (the kernel does not record them: agents that read "cast this turn" need a new field) |
| `imprintedOnId`, `hideawaySourceId`, `exiledUntilSourceLeaves`, `goaded`, `tapUsed`, `justTappedForMana`, `renowned`, `echoResolved`, `temporaryControlChange`, `copyOriginal`, `temporaryCopyOriginal`, `imprisonedOriginal`, `attachmentPowerBonus`, `grantedTypes`, `cdaPower`, `interpretedEffects`, `chosenCopyTargetId`, `chosenCastX`, ... | Default: legacy engine bookkeeping. A copy shows the copy's characteristics; the original is not exposed |
| token art | Gap: tokens get no `imageUris`; the client's existing token-art stamping (`needsTokenArt`) applies |

**Not in the session by design:** the stack (see `TableState.pendingAction` / `stackActions`), the open decision (`TableState.decision`; the legacy `PendingRuleChoice` queues are
not produced: the kernel's decisions are uniform and phase 5 renders them with one generic dialog), priority (`prioritySeatId`), mana pools (`manaPools`).

Tests: `toSession.test.ts` (46): fields, redaction (names of hidden cards never appear in the JSON), effective P/T for random positions, summoning sickness through the legacy
predicate, keyword grants through `hasKeyword`, identity stability, purity / determinism, round trip `toKernelState(toSession(k))` vs `k` with the observer's
normalised comparison on 7 real Wretched Ranks positions for both players (opponent hand and libraries excluded: they are stubs by design).

## 3. KernelSession

```ts
KernelSession.fromDecks({ ctx, display, decks: [{id, name, deck: string[], commander, kind}], seed, startPhase?, startingLife?, sink?, gameId?, now? })
KernelSession.fromState(state, opts)            // tests, saves
KernelSession.fromLegacyHandoff(legacySession, { ctx, lookup: DraftLookup | PackKit, ... })   // end of the legacy mulligans
KernelSession.restore(json, opts) / session.toJSON()

session.dispatch(player, action): DispatchResult  { ok, error?, stale?, events, pending?, version }
session.decide(player, decisionId, choice)       // answerDecision; a late answer to an old decision -> { ok:false, stale:true }
session.view(player): GameSession                // memoised per version, stable identity
session.tableState(player): TableState
session.legal(player): LegalAction[]
session.eventsFor(player, events) / viewFor(player) / pendingFor(player)   // what a remote client may be sent
session.log(player): LogLine[]                   // newest first, per viewer
session.actor                                    // who the engine waits for (decision owner, declaring player, priority holder)
session.state / version / degraded / gameOver
```
* **dispatch never throws.** A refusal changes nothing (the engine returns the original state); a thrown exception marks the session `degraded` and keeps the state before the action.
  The action's `player` must equal the sender (a client can never act for somebody else).
* **Unresolved bridge.** With `sink`, every call's FULL events go through `UnresolvedBridge` (deduped per game + card + clause + capability). Live games run `onUnsupported: "continue"` (`fromDecks`
  and `fromLegacyHandoff` set it). The viewer-filtered `unresolved` event is also a log line with `detail: "Unresolved"`.
* **Per-player logs** are formatted at dispatch time from the viewer-filtered events (a hidden draw is "draws a card"); the log keeps 300 lines per viewer.
* **Determinism.** Same decks + seed + (player, action) sequence = same states, events and logs (no `Date`, no `Math.random`; `now` is injectable, default `""`).
* **Hand-off.** `fromLegacyHandoff` runs the forward adapter at the end of the mulligans (strict hooks: cast / attack triggers are live), keeps legacy card ids on the derived session, uses the
  legacy cards' art and text, then advances out of the untap step (`advanceToPriority`). The browser has no card lookup of its own: pass `packKit(packs)` as `lookup`.

## 4. Card data in the browser: packs, not an API route

Decision: **generated per-deck JSON packs in `public/kernel-packs/`**, fetched by the browser (`fetchPacks(["wretched-ranks"])`), produced by `npm run kernel:bundle-drafts`.
* The drafts are 5.2 MB for 13 decks, but only decks that are READY (every card fully runnable: today Wretched Ranks, Tramplesaurus Rex, Keen Engineering) are bundled by default: about 150 KB per deck.
  They stay OUT of the JS bundle (lazy fetch when a kernel game starts) and out of git (`public/kernel-packs/` is git-ignored; generated from `data/kernel-drafts`, `data/cards.db` and the card catalog).
* No server route, no sqlite in the app, works with any static hosting and in a future server-authoritative host (the same pack is read from disk there). An API route would add a runtime
  dependency on `data/cards.db` for every game start and an extra failure mode for no benefit; importing the JSON as a module would put megabytes into the main bundle.
* A pack holds: engine `CardDef`s (kernel JSON + printed characteristics, including basic lands and the commander), the CardDb data (`info`, creature types), display data for the legacy table
  (art, oracle text, faces), the deck list, and `unsupported` (empty = ready). `npm run kernel:bundle-drafts -- --all` also bundles decks with unsupported cards, `--decks a,b` picks decks.
* If a pack is missing the loader fails with "run npm run kernel:bundle-drafts". Packs are regenerated whenever a draft changes (the pack carries `generatedAt`).

## 5. What the renderer needs that kernel state cannot give (gaps)

`enteredTurn` / `enteredFrom` (agent "cast this turn" heuristics), `phasedOut`, `initiativeSeatId`, token art, restricted mana (`manaUnits`) in the mana pool display, the legacy
`PendingRuleChoice` prompt shapes (replaced by `TableState.decision`), the per-card `playable` flags that phase 4 adds (`legalActions` has the data), and hover data derived from
the legacy oracle-text parsers for activated abilities of cards the PACK does not know (they fall back to `displayFromDef`: ability texts joined).
