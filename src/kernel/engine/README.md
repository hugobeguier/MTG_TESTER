# src/kernel/engine: deterministic rules core (kernel step 1)

Pure TypeScript, no UI, no I/O, not wired into the app. `resolve(state, action, ctx) -> { state, events, pending?, error? }`.
Card definitions come from kernel-schema JSON (`data/kernel-drafts/**`) through a lookup the HOST passes in (`ctx.cards`); the engine never reads files (only `testkit.ts` does).

| file | role |
|---|---|
| `types.ts` | state, actions, pending, events, errors (all plain JSON) |
| `core.ts` | working `Run`, RNG, zones (`moveObject` is the only zone change), `chars()` effective characteristics, errors |
| `query.ts` | object filters, quantities, predicates, player/object refs (unknown vocabulary throws `Unsupported`) |
| `mana.ts` | mana abilities, pool, payment, greedy auto-tap |
| `steps.ts` | step interpreter (resumable frames) + the step registry |
| `support.ts` | static "what can the engine run" check, same `kind:detail` naming as `needs` |
| `resolve.ts` | action dispatch, casting drafts, stack/priority, turn structure, SBA, triggers |
| `setup.ts` | `newGame`, `createEngine(lookup)`, `debugPlaceCard` (host/test only, not an action) |
| `testkit.ts` + `*.test.ts` | vitest (126 tests), real drafted cards + a few hand-authored ones |

## State shape (`GameState`)
`players[]` (life, `library/hand/graveyard/exile/command` as ordered id lists, `manaPool`, `landsPlayed`, `colorIdentity`, `hasLost`), `objects` (id -> `GameObject`: owner, controller, zone, `timestamp`, `controlledSince`, `tapped`, `counters`, `damage`, `token`), `battlefield[]`, `stack[]` (`StackItem`: spell / activated / triggered, chosen `parts` = modes with targets, `x`, `cast` info = phase/turn/caster when cast), `turn {number, active, phase}`, `priority`, `passes`, `effects[]` (timestamped continuous effects), `turnLog` (per-turn events for `count_this_turn`, `nth`), `triggerQueue`, `pending`, `gameOver`, `rngState`/`seed`, `config`.
Object ids are `#<n>`; player ids are host-chosen strings that must not start with `#`. Everything is JSON-serializable; `resolve` clones its input and returns the ORIGINAL state object on any error.

## Actions (every action carries `player`)
`castSpell {cardId, modes?, targets?, x?, payWith?, autoPay?}` · `activateAbility {sourceId, abilityId, targets?, x?, color?, payWith?, autoPay?}` · `playLand` · `passPriority {fastForward?}` · `answerDecision {decisionId, choice}` · `advancePhase`.
`modes/targets/x` inside an action are a shortcut: they are validated exactly like answers. `autoPay` defaults to true (tap sources greedily when the pool is short); `autoPay:false` pays from the pool only. Mana abilities (kind `mana`) resolve immediately and add to the pool; they are used through `activateAbility`.
`advancePhase` is "everyone passes with an empty stack" for the active player (adapter convenience). The real mechanism is `passPriority`: with an empty stack, all alive players passing in turn order ends the step; with a non-empty stack the top object resolves, then the active player gets priority. `fastForward` repeats that until the stack is empty or a decision is pending.
Rejections (`error.code`): `not_your_priority`, `decision_pending`, `not_your_decision`, `wrong_decision`, `no_decision`, `not_owner`, `not_in_zone`, `wrong_timing`, `land_limit`, `illegal_target`, `invalid_choice`, `cannot_pay`, `cannot_activate`, `unsupported` (+ `capability[]`), `unknown_card/object/ability`, `loop_detected`, `game_over`.

## Decision / pending protocol
Whenever a player must choose, `resolve` returns `pending` (also stored in `state.pending`, and while it is set only `answerDecision` is accepted):
`{ id, kind, player, prompt, options[{id,label}], min, max, repeatable?, numeric?, cancellable }`.
`kind`: `choose_modes`, `choose_targets`, `choose_x` (numeric answer), `choose_cards` (discard, sacrifice, scry/surveil, cleanup), `choose_yes_no` (optional/"may" steps), `choose_color`, `order_triggers`.
The prompt is the card JSON's (`prompt`, `xPrompt`, mode/target prompts), falling back to `prompts.ts` builders. Options are computed from the CURRENT zones when the question is asked and re-validated when it is answered: a spell being cast is on the stack (never a discard candidate), `choose_cards` for a discard lists only that player's hand, targets exclude the spell itself and hexproof/shroud objects, a mode with no legal target is not offered. Answer with `choice: {ids}` | `{number}` | `{yes}`; casts can be abandoned with `{cancel:true}` (card returns to its old hand slot, nothing was paid). A bad answer returns `error` and leaves the pending decision open.
Internally a resolving ability is an `Exec` (stack of step frames + env) stored inside the pending decision, so continuing is not a replay: `answerDecision` re-enters the interpreter at the step that asked. Steps never mutate before they ask.
Order of choices when casting: modes -> targets (per chosen mode, in order) -> X -> payment (last, so cancel is free). Triggers: APNAP; a player with several triggers gets `order_triggers` (first chosen goes on the stack first, resolves last); a trigger with targets asks for them when put on the stack; a trigger with no legal target is removed (`trigger_removed`).

## What is supported
- Zones/turn: untap, upkeep, draw (first player skips on turn 1 in 2-player), main phases, stubbed combat steps, end step, cleanup (hand-size discard decision), turn rotation, mana pool emptying, summoning sickness (`controlledSince` vs the controller's turn start).
- Casting: sorcery vs instant/flash timing, `timing.only` predicates, `limit` per turn/game, commander from the command zone (tax), X, modes (min/max/distinct/repeatable), targets (`count` min/max, filters, spell targets), pay from pool/auto-tap, LIFO resolution, fizzle (all targets illegal), partial fizzle (legal targets still resolve), counter_spell, permanent spells enter the battlefield.
- Abilities: mana abilities (fixed colors, any color, commander identity, with simple steps such as pain), activated abilities with costs `mana`, `{T}`, sacrifice self, life, counters on self; supported on the stack with LKI (`r.s.lki`) for "its power/controller".
- Triggers: `etb`, `dies` (subject self or filter, last-known info), `cast` (subject each_player/you/opponent/filter, `nth` per turn), `begin_step` (upkeep, draw, end_step, beginning_of_combat; yours/opponents/each), `interveningIf` checked on trigger and on resolution.
- State-based actions: 0 life, empty-library draw, lethal damage (indestructible), 0 toughness, last player standing / draw. Legend rule, planeswalker 0 loyalty, token cleanup beyond zone change: not yet.
- Steps (29): draw_cards, life_change, drain, damage_target, destroy_target, destroy_all, exile_target, bounce_target, mass_bounce, reanimate, mill, discard, tap_target, untap_target, pump_target, mass_pump, grant_effect (keyword grants, until end of turn), create_tokens (no predefined Treasure/Food/Clue), put_counters_on_self, add_counters, remove_counters, sacrifice_permanent, move_card_zone (target-based), counter_spell, shuffle, scry, surveil, connive, if_else. Plus `optional` ("may") on any step, `condition` (on_resolution/on_cast/on_trigger) with predicates: cast_during, cast_from, turn_is, phase_is, controls, life, zone_count, did_this_turn, nth_this_turn, compare, stat, matches, source_state, step_done, most_life.
- Quantities: numbers, math, X, count, stat, counters, life_total, count_this_turn, greatest, sum, event_amount, life_lost_this_way.

## What is NOT supported (returns `error.code = "unsupported"` with `capability[]`, never skipped)
Combat (attack/block/damage steps, `attack` triggers), replacement effects (`replacement:*`, enters-tapped lands), static abilities and layers (`static`), search_library, choose, look_top, reveal, copy, attach/equip, gain_control, permission_to_play, create_delayed_trigger, repeat_for_each, add_mana step, unless_pay, cast options (kicker/flashback/cycling/...), cost reduction, sacrificing OTHER permanents / discarding / loyalty as costs, hybrid/phyrexian mana, planeswalkers, triggers other than the four above, per-opponent targets, durations other than end of turn, predefined artifact tokens.
Strict by default: casting/playing a card refuses if ANY of its abilities is unsupported (so a Tome with an unsupported state trigger cannot enter play). `config.lenient: true` lets it in and emits an `unsupported_ignored` event per ability. Activating an ability only checks that ability. `debugPlaceCard` (host/tests) bypasses all of this and is not an action.
The loop guard: more than `config.maxEventsPerPass` (5000) events inside one `resolve` call (e.g. `fastForward` over a mandatory trigger loop) returns `error.code = "loop_detected"` and a state with `gameOver = {draw:true}` (rule 722.1). Optional loops (player names an iteration count) are not modelled yet.

## Layers/replacements are designed in, not built
`chars(r, id)` is the only place the rest of the engine reads power/toughness/types/keywords. It already applies timestamped `effects[]` (pump, keyword grants; an effect dies with the object's zone change) then counters. Static abilities and layers plug in here (collect static effects from battlefield objects, sort by layer then timestamp); replacement effects plug in at `moveObject`, `drawCards`, `dealDamage`, `changeLife` (the four choke points that emit events).

## Adapter from the legacy GameSession (later step)
1. Build a `CardLookup` from the DB: name -> `{manaCost, types, subtypes, power, toughness, kernel: <approved card JSON>}` (type line / mana cost / P-T are not in the kernel JSON, they come from the card DB).
2. `newGame` from the session's decks (or import a snapshot by mapping zones to ids), one kernel player per seat; commander cards go to `command` with `isCommander`.
3. Map UI intents to actions (castSpell/playLand/activateAbility/passPriority/advancePhase) with the acting seat's player id; render `pending` as the existing choice dialogs (the prompt text and options are ready to display; hidden-info filtering is the adapter's job: `options.label` of other players' hands should be masked for opponents).
4. Feed `events` to the log/animations; persist `state` (JSON) for save/load and multiplayer (`resolve` is the server-authoritative step: host runs it, sends state views).
5. Unsupported cards: show `error.capability` to the user and fall back to the legacy engine per card until the capability exists.

## ROADMAP (next kernel steps, by how many drafted decks need them)
Counts are cards among the 1033 draft files whose analysis reports the capability (one card can need several). 289 of 1033 drafts run fully today.
1. Static abilities + layers (197) and replacement effects (enters tapped 127, plus would_die/would_draw...): `chars()` layering and choke-point hooks. Biggest single unlock; enables tapped lands, anthems, Rhythm/Blood Moon style cards.
2. Search/choose/look_top/reveal (choose 60, search_library 52, look_top 25, reveal 14) and the richer `move_card_zone` forms (`what`, `who`, `filter`, `saveAs`, `moveCount`, `order`, about 150 uses): one "pick N cards from a zone" decision type covers most of them.
3. Combat (attack triggers 47, combat-damage triggers 23, `filter:attacking`, batch triggers 22, `alsoOn` 23): attackers/blockers decisions, damage assignment, the combat steps become real.
4. Costs: sacrifice other (52), discard (22), loyalty (9), hybrid/phyrexian (8); cost reduction (21); cast options kicker/flashback/escape/etc. (21); `unless_pay` (13); cycling/hand-zone abilities (20).
5. Mana: multiple-spec mana abilities (35, probably dual lands encoded as 2 abilities that need merging), add_mana step (17), conditional/restricted/chosen-color mana.
6. attach/equip (26, 24), copy (25), gain_control, permission_to_play (22), create_delayed_trigger (9), repeat_for_each (19), `life_change.lose` (26).
7. Triggers: leaves (10), becomes_target (11), counter_put (8), fromZone/toZone (9), `nth` beyond cast; state triggers ("unspecified", Mazemind Tome).
8. Rules hygiene: legend rule, planeswalker loyalty SBA, hexproof/protection details, optional-loop iteration count, mulligans, commander damage, partner/companion, dedicated turn-based action for "first player skips draw" in 3+ players.
