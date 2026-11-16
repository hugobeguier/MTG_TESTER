# src/engine - map for agents

Pure rules code: `(session, ...) -> session` transformers and predicates. No React, no AppFlow import.
`src/components/AppFlow.tsx` imports from here and re-exports every previously public symbol, so tests keep
importing from `./AppFlow`. Each file starts with a header comment saying what it owns. Function names are the stable handle - grep for them.

## Files

| File | Owns (key exports) |
|---|---|
| `types.ts` | Engine-wide types: `PendingAction`, `CastChoices`, `TriggerEffect`, `TurnPhase`, `LabeledSlot` ... |
| `flowTypes.ts` | Choice-state types shared with the UI: `BlockChoiceState`, `LegalAgentAction`, library-look / search states |
| `shared.ts` | Leaf helpers: `hasKeyword`, `isLandCard`, `numberWordToInt`, `emblemAsShimCard` |
| `mana.ts` | Mana pools, `manaChoicesForCard`, `chooseManaSourcesForCost`, `payCostFromPool`, `spendManaSources` |
| `costs.ts` | `totalCastingCost`, `adjustedCastingCost`, `staticCostReduction`, X / miracle / alt-cost helpers |
| `lands.ts` | Land drops, `entersBattlefieldTapped`, reveal-lands, shocklands |
| `tokens.ts` | `parseCreateTokenSpecs`, `createTokensForSeat`, `createCopyTokenForSeat` |
| `zones.ts` | Moving cards between visible zones, counters, enter-as-copy, `moveCardBetweenVisibleZones` |
| `entry.ts` | `moveCardAcrossSeats`, `destroyCreatures`, devour, graveyard returns, enters-with-counter replacements |
| `damage.ts` | `applyCombatDamageToTarget`, damage prevention/shields, keyword predicates (`hasFlying`, `hasDeathtouch`...) |
| `stateBased.ts` | `checkStateBasedActions`, `runStateBasedActionsPass`, `winTheGame` |
| `triggers.ts` | Trigger effects: `resolveTriggerEffect`, `commonTriggerEffect`, phase triggers, Undercity/initiative, Braids/Meren |
| `triggerFinders.ts` | `findAttackTriggers`, `findCastTriggers`, death / sacrifice / leaves / life-gain / combat-damage finders, `agentTriggerTarget` |
| `effects.ts` | Spell effect appliers (`applyRemovalEffect`, `applyZoneEffect`, `applyPrimitiveAction`...), target choosers, library-look workflows |
| `oneShotEffects.ts` | One-shot parsers (`parseSimpleLifeChange`, `parseMassPump`...), primitive-plan mapping, emblems, each-player-sacrifice, punisher, Living Death |
| `etb.ts` | Aura attach, chosen type/color, explore, sagas, Myriad / basic-land-fetch searches |
| `abilities.ts` | Activated abilities: `payGenericSacrificeCost`, `payGenericTapCost`, `payGenericManaCost`, `applyGenericTapEffect`, `applyGenericAbilityEffect`, `resolveEquip`, cycling |
| `casting.ts` | `playCardFromZone`, additional costs, MDFC/split/room face options, flash, `spellResolutionDestination` |
| `castTargets.ts` | `spellTargetSlots`, `nextCastPrompt`, `castStructure`, agent target choosers, `hasResolvableTarget` |
| `combat.ts` | `canAttack`, `canBlock`, `resolveCombatDamage`, `assignBlockers`, `legalAttackActions`, `legalBlockActions`, combat simulation, attack tax |
| `legalActions.ts` | `legalMainPhaseActions`, `legalPriorityActions`, `legalActivatedAbilityActions`, `checkMoveLegal` |
| `priority.ts` | `pendingActionRequiredPasses`, `canReceivePriorityForPendingAction`, agent decision context / snapshots |
| `turnFlow.ts` | `untapForSeat`, upkeep draws, end step, phase-trigger planning, seat rotation, `rollForStartingSeat` |
| `mulligan.ts` | Agent mulligans, `withOpeningHand`, `makeShuffledLibrary`, deck-card -> `VisibleCard` |

UI-only code that used to live in AppFlow.tsx is NOT here: `components/DeckSetup.tsx` (setup panel, `applyDeckToSeat`),
`components/viewModels.ts` (`ruleChoiceView`, `blockChoiceView`), `lib/agentRuntime.ts` (agent timeouts, rule-workflow cache, prewarm).

## Import rules

1. Engine files must not import from `@/components/AppFlow` (or any component).
2. Engine files import each other circularly (e.g. abilities <-> casting <-> castTargets <-> legalActions <-> triggerFinders). This is safe only because
   every cross-reference is a hoisted `function` declaration used at call time. Never add a top-level statement that calls or reads an
   imported binding (no `const X = importedFn()`, no `new Set(importedList)`); literal-only constants are fine.
3. Every file must still load as the first entry point of a fresh module graph (an import smoke test per file is a good check).
4. Unexported helpers needed from another file get `export`; AppFlow.tsx re-exports anything tests import.

## To change X, open Y

| To change | Open |
|---|---|
| What an agent may do in main phase / with priority | `legalActions.ts` |
| Whether a proposed move is legal (human and agent gate) | `legalActions.ts` (`checkMoveLegal`) |
| Attack/block rules, combat damage, evasion | `combat.ts`, `damage.ts` |
| Casting: costs, faces, flash, from graveyard/exile | `casting.ts`, `costs.ts` |
| Cast-time targets and prompts | `castTargets.ts` |
| An activated ability (sacrifice/tap/mana/equip/loyalty) | `abilities.ts` |
| A triggered ability fires / is missed | `triggerFinders.ts` (discovery), `triggers.ts` (effect) |
| What a spell does on resolution | `effects.ts`, `oneShotEffects.ts` |
| Tokens / mana / zone moves | `tokens.ts` / `mana.ts` / `zones.ts`, `entry.ts` |
| Turn / phase structure, untap, end step | `turnFlow.ts` |
| Who gets priority, stack passes | `priority.ts` |
| Opening hand and mulligans | `mulligan.ts` |
| Dialog content for rule choices | `components/viewModels.ts` |
| Setup screen and deck import | `components/DeckSetup.tsx` |
| Anything touching React state, handlers, JSX | `components/AppFlow.tsx` (the `AppFlow()` component) |
