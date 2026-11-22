# src/kernel/observer: the kernel runs beside the legacy engine and logs every disagreement

Off by default, read-only, never part of play. The legacy engine is untouched: the headless runner uses the orchestrator's existing
`onAction(prev, next, meta)` hook (`src/lib/selfplay/orchestrator.ts`), and nothing in `src/lib`, `src/engine` or `src/components` was changed.

| file | role |
|---|---|
| `draftLookup.ts` | Node-side card definitions: `data/kernel-drafts/**` JSON by name (double-faced names aliased), printed data from `data/cards.db` (read-only, the engine's test CardDb), STUB definitions (no abilities) for cards without a draft |
| `adapter.ts` | `toKernelState(session, {lookup}) -> {state, toKernel, toLegacy, gaps, noDraft}` and the `ADAPTER_COVERAGE` table |
| `actions.ts` | `mapObserverAction` (orchestrator meta), `mapIntent` (wire intents of `intentSpecs.ts`), `runMapped` (kernel execution + settle + default decision policy), `INTENT_COVERAGE` (all ~105 intents), `LEGACY_ACTION_COVERAGE` |
| `compare.ts` | `compareIntent(S0, S1, meta, opts)`: map, run, normalise, diff; `Diff` records |
| `observer.ts` | `KernelObserver`: attach `observer.onAction` to `playGame`; groups attacks / blocks; dedupes bookkeeping diffs; `finish()` |
| `hints.ts` | `legacyHint`: answers kernel target / card-selection / command-zone decisions by replaying what the legacy engine visibly did (read off S0 -> S1); the default policy is only the fallback |
| `report.ts` | aggregate counters + `report.md` |
| `recorder.ts` | flag-guarded JSONL recorder for a host that wants live observation (see "Live game") |
| `scripts/kernel-observer.ts`, `scripts/kernel-observe-replay.ts` | the two CLIs |

## How to run

```
npm run kernel:observe -- --games 20 --seed 100 --decks Meren,Saheeli,Aminatou
```
Options: `--games N`, `--seed S`, `--decks a,b[,c]` (deck names as in `decks/**`, fuzzy like the self-play runner; game i plays decks[i % n] vs decks[(i+1) % n]), `--first-seat 0|1`, `--timeout-ms` (per game, default 120000), `--max-diffs-per-game` (default 400), `--lenient` (kernel ignores unsupported abilities instead of refusing), `--out DIR`.
Output goes to `data/observer/<timestamp>/` (gitignored): `diffs.jsonl` (one `Diff` per line), `report.md`, `summary.json`.

**Reproducing a diff.** Game i of a batch uses seed `S + i` for the whole game (deck shuffles, mulligans, first seat roll, ids via `seedRuntime`; the heuristic brain has no randomness). Every diff line has `seed`, `decks`, `actionIndex` and a `repro` command that replays exactly that game: `npm run kernel:observe -- --games 1 --seed <seed> --decks <a>,<b> --first-seat <k>`; `actionIndex` is the n-th compared unit of that game. The kernel's own RNG is seeded from the same number.

## How it works

For each legacy action (S0 -> S1):
1. `toKernelState(S0)`, `toKernelState(S1)`; the action is mapped to a macro (`play_land`, `cast_spell` / `cast_commander` -> `castSpell` + pass priority until the stack is empty, a group of `attack`s -> one `declareAttackers`, a group of `block`s -> one `declareBlockers`, `phase:untap|draw|combat_damage` -> turn-based steps from the previous kernel step).
2. The kernel runs the macro on a clone of S0's kernel state. Decisions the kernel asks are answered first by `legacyHint` (target / selection / commander-zone: the option that visibly changed in the legacy result; listed in the diff as `hintedDecisions`), then by a default policy (`defaultAnswer`: first legal option, opponents' things first for targets, "yes" to may-effects, "no" to the commander zone replacement, lethal-first damage) because the legacy engine made those choices silently with its own heuristics. Diffs after such an answer carry `defaultedDecisions` and `choiceDependent: true`.
3. Legacy payment is mirrored: the sources the legacy engine tapped become `payWith` (artifacts that are not mana sources become the `improvise` list), the X is derived from the mana paid.
4. Normalised comparison (see the header of `compare.ts`): by card NAME per player, unordered zones as sorted multisets, the library by size only, ids/timestamps/priority ignored, effective P/T of creatures (kernel `chars()` vs legacy `effectivePower/Toughness`), tapped, counters, damage (combat damage steps only), combat (attackers, blockers), stack, life, hasLost, commander damage total, monarch, phase/turn, "a decision is open", game over.

### Diff categories
`kernel_rejected_legal_action` (legacy accepted, kernel refused: see `kernelError.code`), `kernel_accepted_illegal_action` (legacy refused / no-oped, kernel accepted: only with `legacyAccepted:false`, i.e. replay / live), `state_mismatch:<field>`, `unsupported_capability:<kind:detail>` (kernel refused with `unsupported`; same names as `needs` in the drafts and `npm run kernel:overview`), `no_draft` (an involved card has no draft: the step is skipped, once per card per game), `unmapped_action`, `adapter_gap` (legacy data the adapter cannot represent, once per kind per game), `observer_error` (the observer itself threw; never reaches the game).

### Reading `report.md`
- **Headline**: `compared` = actions that could be judged (not skipped); `agreement` = agree / compared.
- **Per deck "kernel readiness"**: same ratio per deck, plus `coverage` = compared / all actions (skips: no draft, legacy housekeeping, unmapped).
- **Top cards / top fields / capabilities / rejection codes**: where to look first. A card that tops both the capability list and the card list is a draft/kernel gap, not a rules disagreement.
- Mismatches that repeat every turn after the first one are usually a persisting difference (e.g. a wrong P/T stays wrong at every untap, draw and combat). Fix the first one.

## Fix workflow
For a diff, replay it (`repro`), then classify:
1. **adapter gap**: the legacy state had something the adapter did not map (check `adapter_gap` diffs, `ADAPTER_COVERAGE`), or mapped wrongly (names, face names, payment). Fix `adapter.ts` / `actions.ts` first: nothing else is trustworthy until the adapter is.
2. **draft bug**: the card JSON does not say what the card says (e.g. `colors: ["colorless"]` instead of `colored: false`). Fix the draft, re-run `npm run kernel:validate-drafts`.
3. **kernel bug / missing capability**: the draft is right and the kernel does the wrong thing (or refuses): add a kernel test, fix the engine.
4. **legacy bug**: the kernel follows the rules and the legacy engine does not (e.g. the legacy first player draws on turn 1; a card whose effect the legacy parser skips). Record it for the kernel-replaces-legacy plan: the diff is the regression test the kernel must keep winning.
5. **policy noise**: the diff is `choiceDependent` and the legacy choice was legal: refine `defaultAnswer`, do not touch either engine.

## Known gaps (also see `ADAPTER_COVERAGE` and `INTENT_COVERAGE` in code)
- The legacy self-play engine has **no stack and no priority**: a cast resolves instantly, so every legacy state is "stack empty, active player has priority". Response windows, counterspells and triggers ordering cannot be compared; the kernel result is compared after it resolves everything.
- Legacy `turnLog`-style data (damage this turn, creatures died this turn, once-each-turn keys) is not mapped; effects that read them differ.
- Legacy shows a double-faced card under its played face name; the adapter maps it to the full "A // B" draft name plus `face`.
- Legacy turn-based steps with no kernel twin (`phase:upkeep` pending draws, `phase:end_of_combat` flag clearing, `phase:end_step` Braids) are skipped, flagged `unmapped_action` only when they changed observed zones.
- Legacy hand-size discard at cleanup, mulligans, poison, experience counters, emblems, initiative, phasing, damage shields: not modelled on one side or the other.
- The CardDb test adapter does not read the loyalty of single-faced planeswalkers; the observer takes it from the legacy card.
- `decks/custom/Lathliss, Dragon Queen.txt` now has its `Commander:` line (round 1); `--decks` names with a comma ("Breena, the Demagogue") must be given by a comma-free fuzzy part ("Breena").
- **Settled comparison.** The legacy engine queues the enters-the-battlefield / cast triggers of a spell or land and drains them lazily, so a cast / land play is compared with the legacy state at the START of the next action (same turn, same active player; phase / turn are not compared then). Attack / block groups and phase actions are compared directly.
- **Board dump.** `kernel_rejected_legal_action` diffs (and `tapped` mismatches of a cast) carry `context.board`: the card, its cost, X, the sources the legacy engine tapped, every other source with the mana it can make, the pool and any attack-tax permanents. `state_mismatch` diffs carry `context.unsupportedOnBoard` (permanents with capabilities the kernel does not run: the kernel silently ignores those unless the card is involved).
- **Legacy over-tapping.** The legacy engine taps whole sources even when mana is wasted; the observer taps the same permanents in the kernel result so `tapped` only differs for real reasons. Hidden extra taps (Cabal Coffers / Crypt of Agadeem pay their {2} with lands the legacy payment never lists) still show as `tapped` diffs.

## Live game
The legacy `GameSession` lives in the browser (`AppFlow.tsx`, React state); the multiplayer host is also a browser tab, so a server-side hook would need new plumbing in the client (not done here: the brief was to leave legacy play untouched). What exists instead: `recorder.ts` (`recordStep(file, {s0, s1, intent|meta, accepted})`, a no-op unless `MTG_KERNEL_OBSERVER=1`, swallows its own errors) for a host handler to call once after each applied intent, and `npm run kernel:observe-replay -- steps.jsonl` which replays the file through `compareIntent` (using `mapIntent` for wire intent names, `legacyAccepted:false` for refused intents, which can produce `kernel_accepted_illegal_action`). Wiring `recordStep` into the intent handler (`components/game/mpIntents.ts`) is the one small flag-guarded edit still to make.
