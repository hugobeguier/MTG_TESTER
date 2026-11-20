# Schema / validator / renderer changelog (consolidated pass)

Tests: `src/kernel/consolidated.test.ts`. Everything new is reported as a `needs` entry by `capabilities.ts` (nothing new looks implemented).

## Schema additions (schema.ts)
**Events / phases / refs**
- EventName: `dealt_damage` ("is dealt damage"), `commit_crime`.
- Phases: `precombat_main`, `postcombat_main` ("your first main phase").
- ObjRef: `sacrificed` (object sacrificed as a cost), `created` (token made by the previous step, living weapon), `iterated` (current object of a `repeat_for_each`; replaces the old `event_object` convention in loops).
- Duration: `until_end_of_your_next_turn`, `until_your_next_end_step`.

**ObjectFilter**: `notSubtypes`, `without` (keyword negation), `isCommander`, `sameName` (group: all share a name), `sharesCreatureTypeWith` (ObjRef), `chosenType`, `chosenColor`, `attackingYou`, `controller: "defending_player"`.

**Quantity**: `life_total {who}`, `starting_life`, `count_this_turn {event, filter?, actor?}` ("creatures that died this turn"), `players_count {who, where}`, math ops `div_down` / `div_up`.

**Predicate**: `compare {left: Quantity, cmp}` (total power etc.), `turn_number {scope, cmp}`, `chosen_is {kind, value}`, `step_done {step}` ("if you do"), `most_life {who}`, `attacked_defender {defender, who: all|none|any}`.

**Chosen option**: `choose` step gains `choice` (color, creature_type, mode, ...), `options`, `remember: true`. Read back by `filter.chosenType/chosenColor`, `ManaSpec.chosenColor`, static `addChosenType`, predicate `chosen_is`.

**Steps**: new kinds `fight {a,b}`, `investigate {amount?}`, `proliferate`, `extra_combat`. Typed fields: `source`, `excessTo`, `divided`, `alsoWho`, `excludeWho`, `position`, `order`, `faceDown`, `amountLockedOn: "cast"`, `reflexive` (targets chosen when the "when you do" trigger happens).

**Triggers**: `alsoOn: [{event, subject?, step?, whose?, fromZone?, toZone?}]` (multi-event: "enters or attacks", "attacks or blocks", "enters or is put into a graveyard"), `minCount` (attacks with N or more), `defender` (you / you_or_your_planeswalkers / other_player), `chapters` (Saga chapter numbers).

**Costs**: cost atom `loyalty` (+N / -N / -X as `-1 * X`); `costReduction.amount` is a Quantity, `per` optional, new `condition`; `costMod.delta` is a Quantity (it is ADDED to the cost, so a reduction is negative or `-1 * Quantity`).

**Cast options**: kinds `gift`, `escalate`; `optional` is now boolean (false = mandatory additional cost); `condition`; `perExtraMode`; `gift`.

**Statics**: modifiers `blockTax`, `setColors`, `extraLandDrops`, `addChosenType`; `attackTax.protects`.

**Mana**: `restriction` / `abilitiesOf` (spend restrictions) on colors/anyColor/perCount; `chosenColor`; `conditional {if, then, else}`.

**Other**: `ReplacementSpec.recipient / damageType / damageSource / duration`; `TargetSpec.perOpponent`; `Modes.repeatRestriction: "this_turn"`; `scripted.params`; `review.oracleOverride {text, source, typeLine?}`.

## Validator (validator.ts, scripts/validate-kernel-drafts.ts)
- Number words up to twenty, thirty..fifty, hundred; "half"/"twice" count as 2; ordinals (second..tenth) may account for a JSON number but never demand one.
- `review.ignore` can suppress `LITERAL_MISMATCH`: lexeme `literal` (all) or `literal:<n>` / `literal:{X}`.
- A PURE scripted stub (scripted marker, no steps/modes/static/replacement/mana/keyword param) is exempt from the literal check for its own text; put numbers in `scripted.params` when a marker should carry them. `handler` strings are never scanned for mana symbols.
- Ability words ("Ferocious -") no longer demand a second condition when the clause already says if/unless/as long as.
- "another/other": not flagged for "its other types", "another player", "each other opponent", "this creature or another X".
- "each": not flagged for "power and toughness each equal", "both power and toughness", "each of up to N targets", "all abilities"; backed by perOpponent / alsoWho / alsoOn / static affects filters / replacement subject filters.
- Gift / Escalate cast words; `{X}` satisfied by a variable `costReduction.amount`.
- "+1/+1 for each X" needs no literal 1; counter kinds like `"+1/+1"` carry their numbers.
- `STRUCT_CHOSEN_UNDEFINED` is card-wide (choice may live in another ability), covers `chosenType/chosenColor/chosen_is`; new `STRUCT_STEP_REF` for `step_done`.
- Static abilities may consist of a `costReduction` alone.
- Script: `review.oracleOverride` replaces `NO_ORACLE` (a warning `ORACLE_OVERRIDE` records the source); `--prune` (with `--write`) drops `review.ignore` entries no longer needed.
- Duplicated "enters or attacks" abilities are gone (`alsoOn`), so literals are no longer double counted.

## Renderer (prompts.ts)
- Opponent filters read "an opponent controls" (was "you don't control"); `defending_player` reads "the defending player controls".
- The card's own name replaces "this permanent" (`withCardName`, `setRenderCardName`; generic wording outside a card).
- Plurals: last word only, irregulars (Elves, Wolves, Fish, mice, ...); number words to twenty.
- addTypes renders lower case ("an artifact creature"); new descriptions for every field above; `describeManaSpec`; mana abilities now show in the approval render.

## Capabilities (capabilities.ts)
New needs: `filter:<key>`, `quantity:<ref>`, `quantity:division`, `ref:sacrificed|created|iterated`, `trigger:multi_event|min_count|defender|chapters`, `static:<modifier>`, `static:costMod_quantity`, `cost_reduction:conditional|variable`, `mana:restriction|conditional|chosen_color`, `replacement:duration|damage_qualifiers`, `targets:per_opponent`, `modes:repeat_restriction`, `cast_option:mandatory|conditional|per_extra_mode`, `cost:loyalty`, `cast_option` (ability kind), plus per-kind step fields as before.

## Scripted marker vocabulary (still scripted; engine-specific)
`become_monarch` (user decision; with stat `controller_is_monarch` / `monarch_exists`), `crew`, `improvise`, `myriad`, `storm`, `read_ahead`, `manifest_dread`, `reselect_attack_target`, `tapped_for_colorless_mana`. Steps/ability fields without a closed vocabulary but accepted as passthrough: `reveal.until`, `choose.fromLooked/fromRevealed`, `move_card_zone.what: rest_of_looked_cards|rest_of_revealed_cards`, `linkExile`, `optionalCost`, `create_delayed_trigger.at`, `behold`, `upTo`.
Saga rules (lore counter on ETB and after draw, sacrifice after the last chapter) are kernel rules, not encoded per card.

## Migrated drafts
All five deck dirs (and, by the generic pass, any other dir under data/kernel-drafts at that moment) lost stale generated prompts/implementation and were regenerated with `--write`. `review.ignore` entries dropped from ~80 to a handful.

## Modes pass (generic modal spells) and pairing pass
- `modes.repeatable` (optional boolean): "You may choose the same mode more than once" (e.g. "Choose three. You may choose the same mode more than once."). Then `distinct` must be false. `modes.choose` was already min/max; the validator now parses every phrasing: "choose one" (1..1), "one or both" (1..2), "one or more" (1..options), "choose two/three/four/five", "choose up to N" (0..N), "any number" (0..options).
- Validator: `MODE_MISMATCH` compares oracle vs `choose` min/max and `repeatable`; a phrase only counts as a modal header when followed by a dash, period, comma or "that ..." ("Choose two target creature cards in your graveyard" is no longer read as modes, which fixed the Victimize false positive; "one or both" used to be read as exactly 1, which failed Saheeli's Artistry). The `may` lexeme is backed by `repeatable: true`.
- Renderer/prompts: "Choose one or both modes.", "Choose three modes. You may choose the same mode more than once."; approval render marks repeatable modes.
- Capabilities: new needs `modes:repeatable`, `modes:multiple` (choose.max > 1).
- New step kind `fight_pairs` (`fighters: "created"` = ALL tokens the previous create_tokens step made, `against: ObjectFilter` = pool, `pairing: "controller_chooses"`): each fighter fights a different object of the pool, pairing chosen by the controller, surplus fighters fight nothing. It is a decision step, so it gets a prompt ("Choose which creature each token fights..."), and a need `step:fight_pairs`. The "each" lexeme is backed by `fight_pairs`.
- Drafts: Mazemind Tome gates its life gain with `step_done` on the exile step; Ezuri's Predation uses create_tokens (count = creatures) then `fight_pairs`.

## Engine step (src/kernel/engine)
- No schema or capabilities.ts changes. The engine keeps its own support registry (`engine/support.ts`, derived from the step handlers in `engine/steps.ts`) because it runs more than the legacy `capabilities.ts` reports (modes, X, cast_during, counters as costs, scry...). `needs` in the card JSON still describes the LEGACY engine; the kernel engine's missing capabilities come from `cardUnsupported()`.
- Interpretation notes: `cast_during: main` = a main phase of the caster's own turn (Addendum reads "your main phase"); `distinct: false` modes are treated as repeatable; a step's `id` counts as done for `step_done` once the step ran (for expanded steps: once expanded).
