// Kernel step 10: scripted markers implemented for the Aminatou / Ur-Dragon / Meren decks (the hooks live where each rule is read).
/**
 * Call the Spirit Dragons: "for each color, put a +1/+1 counter on a Dragon you control of that color. If you put +1/+1 counters on five Dragons this way, you win the game."
 * Expanded when the trigger resolves: per color the controller chooses one of their Dragons of that color (nothing when they have none), a counter goes on it,
 * and the distinct Dragons that got one are counted by the two internal steps (steps7 __spirit_note / __spirit_win).
 */
export function callTheSpiritDragonsSteps(): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const c of ["W", "U", "B", "R", "G"]) out.push(
    { kind: "choose", who: "you", from: { types: ["creature"], subtypes: ["Dragon"], controller: "you", colors: [c] }, count: 1, saveAs: "chosen", prompt: { title: "Call the Spirit Dragons", instruction: `Choose a Dragon you control of color ${c} to put a +1/+1 counter on.` } },
    { kind: "add_counters", on: "chosen", counterKind: "+1/+1", amount: 1 },
    { kind: "__spirit_note" });
  out.push({ kind: "__spirit_win" });
  return out;
}

export const STEP10_HANDLERS: readonly string[] = [
  "domain_count_distinct_basic_land_types", // layers.spellCostDelta
  "count_spell_colors", // resolve.ts cast trigger amount
  "additional_cost_life_when_targeting_this", // layers.targetCostExtras
  "cast_enchantment_paying_life", "cast_from_graveyard_permission", // castopts.grantedFree
  "flash_if_targets_commander", // resolve.checkSpellTiming / commitDraft
  "stun_counters_cant_be_removed_from_opponent_permanents", // core.stunLocked / untapObject
  "unlock_cost_reduction", // resolve.unlockDoor: generic part of an unlock cost
  "enchanted_player_cant_activate_nonmana_nonloyalty_abilities", "additional_beginning_phase", // resolve.ts (Auras on players)
  "one_counter_per_color_on_distinct_dragons_win_if_five", // callTheSpiritDragonsSteps
  "cost_reduction_colored_mana_only", // layers.spellColoredReduction
  "triggers_additional_time", "choose_a_background", // resolve.queueTrigger / deck-building marker (a Background is not modelled: no Background card in the pool)
  "exert_and_haste_if_spent_on_creature_spell", // resolve.activateMana (exert) + mana.RIDER_HANDLERS (haste)
  "station", // keywords8.station synthesises the ability
];
