# Real-game mistake log

Append a row whenever you see an agent do something dumb in a real game. The table is read by `src/lib/selfplay/mistakeScenarios.test.ts`, so keep the 7 columns and the `|` separators.

How to use it:

1. Add a row at the bottom of the table. Fill in the date, what happened, what the agent should have done, and a status (`open`, or `fixed: <where>`).
2. Pick a **category tag** from the list below (the same tags the detector `npm run agent:mistakes` reports). If nothing fits, write `other` and describe it; Claude will add a tag.
3. Optional but best: ask Claude to add a **fixture** (a small decision-point snapshot in `src/lib/selfplay/mistakeScenarios.ts`) and put its name in the last column. A row with a fixture is checked on every `npx vitest run`: the detector must flag the bad action, and once the status is `fixed...` the agent must no longer choose it. That is the regression test for the mistake.

Category tags: `pointless_sacrifice`, `removal_on_low_threat`, `idle_protection_spell`, `combat_spell_outside_combat`, `declined_free_attack`, `unused_mana_castable_left`, `missed_land_drop`, `spell_no_target_or_effect`, `own_wipe_while_ahead`, `self_inflicted_loss`, `tapped_out_into_lethal`, `repeated_activation`, `suicide_attack`, `pointless_block`, `self_lethal_life_cost`.

| Date | Category tag | Card / situation | What the agent did | What it should do | Status | Fixture |
|---|---|---|---|---|---|---|
| (earlier) | pointless_sacrifice | Viscera Seer | Sacrificed creatures over and over just to scry | Keep the board; sacrifice only fodder, doomed creatures or for a real payoff | fixed: sacrificeGuard (playGuards.ts) | viscera-seer-scry-loop |
| (earlier) | removal_on_low_threat | Instant removal and removal Auras (Swords to Plowshares, Pacifism) | Spent them on non-threatening creatures | Hold removal for a creature that is actually a threat | fixed: removalGuard (playGuards.ts) | swords-on-grizzly-bears |
| (earlier) | idle_protection_spell | Tamiyo's Safekeeping | Cast it with nothing threatening any permanent | Keep it until a removal spell or damage is aimed at something | fixed: protectionGuard (playGuards.ts) | tamiyos-safekeeping-idle |
| (earlier) | declined_free_attack | Speaker of the Heavens against empty boards | Did not attack although no defender had a creature | Attack: free damage, nothing forfeited | fixed: freeAttack.ts | speaker-empty-board |
| (earlier) | combat_spell_outside_combat | Malik casting Arachnogenesis | Cast the fog in the precombat main phase | Hold it for an opponent's attack | fixed: situationalTimingGuard (playGuards.ts) | arachnogenesis-precombat |
| 2026-10-18 | spell_no_target_or_effect | Swords to Plowshares, Go for the Throat, Kenrith's Transformation (found by the self-play detector) | Cast creature removal while the opponents had no creature, so it could only hit the caster's own creature | Hold it | fixed: removalGuard now holds removal with no opposing creature | swords-no-opposing-creature |
| 2026-10-18 | spell_no_target_or_effect | Negate, Counterspell, Arcane Denial (found by the self-play detector) | Cast a counterspell in its own main phase with an empty stack | Keep it for an opponent's spell | fixed: wastedSpellGuard (playGuards.ts) | counterspell-empty-stack |
| 2026-10-18 | self_lethal_life_cost | Ambition's Cost (found by the self-play detector) | Cast draw-three-lose-three at 3 life and died | Never cast a spell that costs as much life as you have | fixed: wastedSpellGuard (playGuards.ts) | ambitions-cost-at-3-life |
| 2026-10-18 | pointless_block | Thraben Watcher, Giada (found by the self-play detector) | Added a second blocker that simply died, every combat (additional blockers scored at the +2 baseline) | Add another blocker only when it survives the attacker | fixed: scoreBlockDecision handles declare_blockers_additional | additional-blocker-dies |
