// Shared type definitions for the resolution engine (pending actions, trigger effects, rule choices), moved verbatim from
// components/AppFlow.tsx. Type-only: nothing here exists at runtime, so importing it can never create a module-init cycle.

import type { GenericModalEffect, GenericModalMode, PumpEffect } from "@/engine/effects";
import type { TokenSpec } from "@/engine/tokens";
import type { ManaColorLetter } from "@/lib/characteristics";
import type { DamagePreventionSpec } from "@/lib/damagePrevention";
import type { AdditionalSacrificeType } from "@/lib/oracleClauses";
import type { DelayedReturnCard } from "@/lib/phaseTriggers";
import type { PrimitiveActionStep } from "@/lib/primitiveActionPlan";
import { TURN_PHASES } from "@/lib/priorityStops";
import type { RemovalEffect } from "@/lib/removalSpells";
import type { SpellExtraEffect } from "@/lib/spellExtras";
import type { TargetedEffect } from "@/lib/targetedEffects";
import type { ChosenTarget, TargetSpec } from "@/lib/targeting";
import type { VisibleCard } from "@/lib/types";
import type { ZoneEffect } from "@/lib/zoneEffects";

export type TurnPhase = (typeof TURN_PHASES)[number];

// ManaColor/ColoredMana/ManaPool/ManaContribution/RestrictedManaBatch moved to src/lib/types.ts so a
// saved-game snapshot (src/lib/saveGame.ts) can reference them without a component -> lib import.
// A shared `optional` field on every variant (via intersection, not repeated per-branch) — set
// when the source text says "you may" for this effect, so the resolution step can ask the
// controller (human via a real prompt, agent via a deterministic accept-by-default heuristic —
// see resolveAgentRuleChoice) instead of always doing it. Auto-resolving optional effects used to
// be this engine's default; that's wrong for a player who doesn't want to do something every time
// just because it's beneficial (and it's also how an unbounded self-copy loop, like Ondu
// Spiritdancer under Secret Arcade, used to happen with no way to stop it).
export type TriggerEffect = (
  // A "choose one —" triggered ability (Elder Gargaroth): the parsed modes, resolved through applyGenericModalEffect.
  // pickedModes: the modes a human has chosen so far in a "choose two / one or more" trigger (picked one prompt at a time).
  | { kind: "modal"; modal: GenericModalEffect; pickedModes?: number[] }
  // moreIf: "Draw a card. If you control three or more artifacts, draw two cards instead." (Tezzeret, Artifice Master's 0)
  | { kind: "draw_cards"; amount: number; moreIf?: { type: string; atLeast: number; amount: number } }
  | { kind: "gain_life"; amount: number }
  // Willow Geist: gain life equal to the dying creature's power; turned into a gain_life with the real amount when the trigger is made.
  | { kind: "gain_life_equal_power" }
  // "Mill a card. If a land card is milled this way, create a Treasure token. If a creature card ..., a 1/1 Insect. If a noncreature, nonland card ..., a Blood token." (Old Rutstein)
  | { kind: "mill_with_rewards" }
  | { kind: "lose_life"; amount: number }
  | { kind: "scry_cards"; amount: number }
  | { kind: "surveil_cards"; amount: number }
  | {
      kind: "create_tokens";
      tokens: TokenSpec[];
      // "Create a Treasure token. Then if you control four or more Treasures, sacrifice this Saga. If you do, create a 6/6 ... Dragon" (The
      // Misty Mountains Cold): the extra tokens (and the Saga's sacrifice) only happen when the Treasure count reaches the threshold.
      ifTreasures?: { threshold: number; sacrificeSelf: boolean; tokens: TokenSpec[] };
    }
  // counterKind isn't restricted to "+1/+1"/"-1/-1" — plenty of real triggered abilities put an
  // arbitrary-named counter on a target creature (Athreos, Shroud-Veiled's "put a coin counter on
  // target creature or planeswalker", stun/shield counters elsewhere, ...); applyCounterDelta already
  // takes any string kind, this type just used to be narrower than what it actually resolves to.
  // alsoTap: "tap up to one target creature and put a stun counter on it" (Fear of Sleep
  // Paralysis's Eerie ability) — a compound tap-and-counter shape, not just a counter.
  // "each_matching_you_control": "... put a +1/+1 counter on each Plant you control." (Insidious
  // Roots, following its own "create a 0/1 green Plant creature token" — see the shared `then` field
  // below) — a board-wide counter, unlike the single-permanent target_creature(_you_control) scopes,
  // resolved via the same permanentMatchesQualifier every static group-grant already uses (matcher
  // e.g. "plant"), against the trigger's own controller's battlefield.
  | {
      kind: "add_counter";
      counterKind: string;
      amount: number;
      scope: "self" | "context" | "target_creature" | "target_creature_you_control" | "each_matching_you_control";
      alsoTap?: boolean;
      matcher?: string;
    }
  // scope "one_of_candidates": "create a token that's a copy of one of them" (Twilight Diviner) - candidateIds are the permanents that entered together
  // (a human picks when there is more than one; an agent takes the best).
  | { kind: "copy_token"; scope: "self" | "context" | "one_of_candidates"; notLegendary?: boolean; payCostText?: string; candidateIds?: string[] }
  // "For each artifact you control, create a token that's a copy of it. Those tokens gain haste. Exile those tokens at the beginning of the next end step." (Saheeli, the Gifted)
  | { kind: "copy_each_artifact_temp" }
  // "Prevent all damage that would be dealt to you this turn." / "... the next N damage ..." (Selfless Squire's enters trigger): a damage shield, no target.
  | { kind: "prevent_damage"; spec: DamagePreventionSpec }
  // Memnarch: "Target permanent becomes an artifact in addition to its other types." / "Gain control of target artifact."
  | { kind: "become_artifact_target" }
  | { kind: "gain_control_target_artifact" }
  // Hellkite Igniter: "This creature gets +X/+0 until end of turn, where X is the number of artifacts you control."
  | { kind: "self_pump_per_permanent"; matcher: string }
  // "You may destroy target creature if it's tapped." (Deathbringer Liege's black-spell trigger)
  | { kind: "destroy_tapped_creature" }
  // "Whenever enchanted creature attacks, each other creature that's attacking one of your opponents gets +1/+1 until end of turn." (Martial Impetus)
  | { kind: "pump_other_attackers"; power: number; toughness: number }
  // "Target artifact you control becomes a copy of another target artifact or creature you control until end of turn, except it's an artifact in addition to its other types." (Saheeli, Sublime Artificer -2)
  | { kind: "artifact_becomes_copy_eot" }
  // The answer to a pendingPlayerChoices prompt; chosenOption indexes the stored options (see resolveDeferredChoice).
  | { kind: "deferred_choice"; resolver: string; data: Record<string, unknown>; values: string[] }
  // An activated ability whose cost has been paid and whose effect waits on the stack (rule 602.2); resolverId keys the closure that applies it.
  | { kind: "deferred_ability"; resolverId: string }
  // "When this artifact enters, exile target card from a graveyard." (Soul-Guide Lantern): an opponent's best card, else any.
  | { kind: "exile_card_from_graveyard" }
  // "Manifest dread, then attach this Equipment to that creature." (Dissection Tools): look at the top two, manifest one face down as a 2/2, the other to the graveyard.
  | { kind: "manifest_dread_attach" }
  // "Each opponent discards three cards, then mills three cards." (The True Scriptures II)
  | { kind: "each_opponent_discard_then_mill"; discard: number; mill: number }
  // "For each opponent, destroy up to one target creature or planeswalker that player controls." (The True Scriptures I)
  | { kind: "destroy_one_per_opponent" }
  // "Put all creature cards from all graveyards onto the battlefield under your control. Exile this Saga, then return it to the battlefield transformed." (The True Scriptures III)
  | { kind: "reanimate_all_graveyards_and_flip_saga" }
  // "You may exchange life totals with target opponent. If you lost life this way, draw that many cards." (Mister Negative)
  | { kind: "exchange_life_draw_lost" }
  // "Whenever this creature attacks, you may tap X untapped Myr you control. If you do, this creature gets +X/+0 until end of turn and deals X damage to the player or planeswalker it's attacking." (Myr Battlesphere)
  | { kind: "tap_subtype_pump_damage"; subtype: string }
  // "Imprint — Whenever a nontoken creature dies, you may exile that card. If you do, return each other card exiled with this artifact to its owner's graveyard." (Mimic Vat)
  | { kind: "imprint_dying_creature" }
  | { kind: "draw_then_put_back"; drawAmount: number; putBackAmount: number }
  // Board-wide temporary pump/debuff off a triggered ability (Doomwake Giant's Constellation
  // "creatures your opponents control get -1/-1 until end of turn") — shares its shape with
  // spell-cast MassPumpEffect (see parseMassPump/applyMassPumpEffect) so the same application
  // logic is reused rather than duplicated.
  | { kind: "mass_pump"; power: number; toughness: number; excludeType?: string; scope: "all" | "controlled" | "opponents"; matcher?: string; minPower?: number; grantsKeyword?: string; xFromCreatureCount?: boolean }
  // "This creature gets +1/+0 until end of turn." (Scourge of Valkas) — only the source itself.
  | { kind: "self_pump"; power: number; toughness: number }
  // Mind's Dilation-style "exile the top card of [that player]'s library. Until end of turn, you
  // may cast that card without paying its mana cost if it's a nonland card." — cross-seat (exiles
  // from fromSeatId's library, grants cast permission to the trigger's own controller) and waives
  // the mana cost, neither of which any other TriggerEffect kind models, so this gets its own kind
  // rather than being force-fit into an existing one.
  | { kind: "impulse_cast_free"; fromSeatId: string }
  // "You get an experience counter." (Meren of Clan Nel Toth, and the same reward-counter shape on
  // several other commanders) — a PLAYER-level counter (PlayerSeat.experienceCounters), not a
  // permanent-level one like add_counter above, so it gets its own kind rather than being force-fit
  // into that one's target-scoped shape.
  | { kind: "get_experience_counter"; amount: number }
  // "You may put a land card from your hand onto the battlefield." (Archaeomancer's Map's
  // opponent-land-raid trigger — real text has no cost and doesn't enter tapped, despite this
  // codebase having assumed both for a while; see isArchaeomancersMapLandRaidTrigger) — auto-
  // resolved deterministically (put one down if there's a land in hand) rather than routed through
  // the standard optional_trigger pendingRuleChoice, since accepting is essentially always correct.
  | { kind: "put_land_from_hand" }
  // Sarkhan the Masterless: "Whenever a creature attacks you or a planeswalker you control, each Dragon you control deals 1 damage to that creature."
  | { kind: "dragons_ping_attacker" }
  // Sarkhan the Masterless +1: "Until end of turn, each planeswalker you control becomes a 4/4 red Dragon creature and gains flying."
  | { kind: "planeswalkers_become_dragons" }
  // "Choose left or right. Each player gains control of all nonland permanents other than Aminatou controlled by the next player in the chosen
  // direction." (Aminatou, the Fateshifter's -6): chosenOption "0" is left, "1" right.
  | { kind: "rotate_control" }
  // "You may have that player shuffle." (Portent): chosenOption "0" shuffles.
  | { kind: "shuffle_library"; seatId: string }
  // "When this land enters, sacrifice it. When you do, search your library for a basic Plains, Island, or Swamp card, put it onto the
  // battlefield tapped, then shuffle and you gain 1 life." (Obscura Storefront and the other Streets/Storefront cycle)
  | { kind: "sacrifice_self_then_search"; filter: string; lifeGain: number }
  // "Put any number of creature cards from your hand onto the battlefield." (Ghalta, Stampede Tyrant) / "...land cards ... tapped" (Wrenn and Seven):
  // a human picks cards one at a time (pickedIds), an agent puts them all.
  | { kind: "put_any_from_hand"; filter: "creature" | "land" | "artifact" | "permanent"; tapped?: boolean; pickedIds?: string[] }
  // The Ur-Dragon: "draw that many cards, then you may put a permanent card from your hand onto the battlefield."
  | { kind: "draw_then_permanent"; amount: number }
  | { kind: "put_permanent_from_hand" }
  // "Draw a card, then you may put a land card from your hand onto the battlefield." (Gretchen Titchwillow, Pendant of Prosperity).
  // ownerToo: "This artifact's owner draws a card, then that player may put a land card..." (the owner is an agent's auto pick).
  | { kind: "draw_then_land"; amount: number; ownerToo?: boolean }
  // "Connives" (Ledger Shredder, and the same Streets of New Capenna keyword action on plenty of
  // other cards) — "Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1
  // counter on this creature." amount is how many times (almost always 1; "connives twice" is the
  // one real exception), each resolved as its own independent draw-then-discard-then-maybe-counter.
  | { kind: "connive"; amount: number }
  // "Target player loses N life and you gain N life." (Blood Artist) / "Each opponent loses N life
  // and you gain N life." (Zulaport Cutthroat, Cruel Celebrant) — the aristocrats-archetype drain
  // shape. Distinct from the plain gain_life/lose_life kinds above, which only ever move life for
  // the trigger's own controller; this one always moves life for BOTH the controller (gain) and
  // some other player or players (loss) in the same resolution, which those can't express.
  // devotionColor: "each opponent loses life equal to your devotion to <color>. You gain life equal
  // to the life lost this way." (Gray Merchant of Asphodel, and the rest of the "Gary"/devotion-drain
  // cycle) — amount is board-state-dependent, so it's recomputed at resolution time from the
  // controller's own battlefield (computeDevotion) rather than parsed once as a fixed number; amount
  // is unused/0 when this is set. Also changes the gain side: "the life lost this way" is the SUM
  // across every opponent (devotion × opponent count), not the flat per-trigger amount Zulaport
  // Cutthroat's wording uses — see applyDrainEffect's gainEqualsTotalLoss parameter.
  | { kind: "drain"; amount: number; scope: "target_player" | "each_opponent"; devotionColor?: ManaColorLetter; noGain?: boolean }
  // "Return a land you control to its owner's hand." (Simic Growth Chamber and the rest of the
  // karoo/bounce-land cycle: "This land enters tapped. When this land enters, return a land you
  // control to its owner's hand.") — mandatory, and WHICH land is a real choice (routed through
  // pendingRuleChoice the same way connive's discard and draw_then_put_back's put-back are), not
  // something resolveTriggerEffect's pure-function path can decide on its own.
  | { kind: "return_land_to_hand" }
  // "Exile another target permanent you own, then return it to the battlefield under your
  // control." (Aminatou, the Fateshifter's -1) — WHICH permanent is a real choice, same
  // pendingRuleChoice detour as return_land_to_hand just above; resolution (moveCardAcrossSeats
  // battlefield-to-battlefield, same seat) is what actually gives the permanent a fresh object
  // identity (rule 400.7) — summoning sickness resets, counters/attachments fall off — and lets any
  // "when this enters" ability on it fire again, the same as any other permanent entering.
  | { kind: "blink" }
  // "Whenever a creature deals combat damage to one of your opponents, its controller may pay 1
  // life. If they do, they draw a card." (Gix, Yawgmoth Praetor) — the one kind here that resolves
  // against the trigger's actorSeatId (the ATTACKING creature's controller) rather than its
  // controllerSeatId (Gix's own controller, everywhere else in this union): "its controller" refers
  // back to "a creature," not to whoever controls Gix. Deliberately NOT modeled via the shared
  // `optional` flag below — beginTriggerResolution's optional_trigger prompt always asks
  // controllerSeatId "do you want to?", which would incorrectly ask Gix's controller instead of the
  // attacker. Resolved deterministically instead (pay if it wouldn't be life-total-fatal to do so),
  // documented on its resolveTriggerEffectOnce branch. Reported live as Gix simply never triggering
  // at all — findCombatDamageToPlayerTriggers only ever scans the DEALING creature's own
  // controller's battlefield, so a third-seat's Gix (watching combat damage symmetrically,
  // regardless of who controls the attacker) was structurally invisible to it.
  | { kind: "actor_may_pay_life_to_draw"; lifeCost: number; drawAmount: number }
  // "Whenever a player attacks one of your opponents, if that opponent has more life than another
  // of your opponents, that attacking player draws a card and you put two +1/+1 counters on a
  // creature you control." (Breena, the Demagogue) — the draw half resolves against actorSeatId
  // (the ATTACKING player, "that attacking player"), same actor-relative shape as
  // actor_may_pay_life_to_draw above, but unconditional (no "may," no cost). The counter half is a
  // SEPARATE effect for a SEPARATE seat (Breena's own controllerSeatId, "you put..."), chained via
  // the shared `then` field below — `then`'s resolution reuses the same trigger object (same
  // actorSeatId/controllerSeatId, see resolveTriggerEffect), so a `then: { kind: "add_counter", ...,
  // scope: "target_creature_you_control" }` here resolves against controllerSeatId exactly as
  // real Magic requires, with zero new counter-placement logic needed.
  | { kind: "actor_draws_cards"; amount: number }
  // "...that creature's controller loses 1 life." (Marchesa's Decree) — resolves against actorSeatId, the
  // attacking creature's controller, not the watcher's.
  | { kind: "actor_loses_life"; amount: number }
  // "...that player discards a card" (Liliana's Reaver) — the damaged player, filled in when the combat-damage
  // trigger is created; the card is chosen by the usual discard heuristic.
  | { kind: "seat_discards"; amount: number; seatId?: string }
  // "You may pay {2}{B}. If you do, return target creature card from your graveyard to your hand." (Eternal
  // Taskmaster) — always optional; accepting pays the mana (auto-tapped) and then applies the zone effect.
  | { kind: "pay_then_zone"; costText: string; zoneEffect: ZoneEffect }
  // "You become the monarch." (Court of Grace, Skyline Despot, Marchesa's Decree)
  | { kind: "become_monarch" }
  // A triggered "deals N / X damage to any target / each creature" (Scourge of Valkas, Dragon Tempest, Drakuseth,
  // Tyrant's Familiar) — the same RemovalEffect a damage spell uses, resolved with the trigger's source.
  | { kind: "damage_effect"; effect: RemovalEffect }
  // "Whenever a creature you control enters, it deals damage equal to its power to any target." (Warstorm Surge)
  | { kind: "context_power_damage" }
  // "You gain life equal to that creature's toughness." (Verdant Sun's Avatar, Righteous Valkyrie) — the entering creature.
  | { kind: "gain_life_context_toughness" }
  // "Creatures you control gain double strike until end of turn." (Terror of Mount Velus)
  | { kind: "creatures_gain_keywords"; keywords: string[] }
  // "Investigate once for each opponent who has more cards in hand than you." (Wojek Investigator)
  | { kind: "investigate_per_opponent_with_more_cards" }
  // "Put X +1/+1 counters on target creature, where X is that creature's power." (Thickest in the Thicket) — your strongest creature.
  | { kind: "double_power_counters" }
  // "Put a +1/+1 counter on each of up to two target creatures." (Rishkar, Peema Renegade) — your strongest creatures.
  | { kind: "counters_on_up_to_creatures"; counterKind: string; amount: number; count: number }
  // Living weapon (Tangleweave Armor): "When this Equipment enters, create a 0/0 black Phyrexian Germ creature token, then attach this to it."
  | { kind: "living_weapon" }
  // "You may discard a card. If you do, draw a card / two cards." (Bitter Reunion, Hazoret's Monument) — only draws if a card was discarded.
  | { kind: "discard_then_draw"; draw: number }
  // "Double the power and toughness of each creature you control until end of turn." (Unnatural Growth)
  | { kind: "double_power_toughness" }
  // "Target creature you control gains haste until end of turn." (Surrak, the Hunt Caller) — the creature that benefits most.
  | { kind: "target_creature_gains_keyword"; keywords: string[] }
  // "Untap all attacking creatures. After this phase, there is an additional combat phase." (Scourge of the Throne; Hellkite
  // Charger with payCostText: "you may pay {5}{R}{R}. If you do, ...").
  | { kind: "additional_combat"; payCostText?: string }
  // "When enchanted creature dies, return this card to its owner's hand." (Angelic Destiny) — the Aura is already in the graveyard.
  | { kind: "return_self_to_hand" }
  // "This creature deals 4 damage to each other opponent." (Parapet Thrasher) — every opponent except the one named by actorSeatId
  // (the player the Dragon just hit).
  | { kind: "damage_each_other_opponent"; amount: number }
  // "Exile all graveyards." (Farewell's last mode)
  | { kind: "exile_all_graveyards" }
  // "Roll a d20. You create a number of Treasure tokens equal to the result." (the Ancient Dragons): the roll is made when it resolves.
  | { kind: "d20_roll"; payoff: "treasures" | "draw" | "faerie_dragons" }
  // Animate Dead and friends: "Return enchanted creature card to the battlefield under your control and attach this Aura to it."
  // The creature card is chosen from any graveyard when the Aura enters (the engine has no "enchant a card in a graveyard" attachment).
  | { kind: "aura_reanimate" }
  // Undying / persist: "When this creature dies, if it had no +1/+1 (-1/-1) counters on it, return it to the battlefield with one."
  | { kind: "undying_return"; counterKind: "+1/+1" | "-1/-1" }
  // "Whenever a creature with a coin counter on it dies or is put into exile, return that card to the battlefield under your control."
  // (Athreos, Shroud-Veiled): the card (trigger.contextCardId) is found in whichever graveyard/exile it landed in.
  | { kind: "return_marked_to_battlefield" }
  // "Each opponent sacrifices a creature of their choice." (Butcher of Malakir, Dictate of Erebos, Grave Pact, Sheoldred): a human victim
  // picks; includeSelf is "Each player sacrifices ..." (Accursed Marauder).
  | { kind: "each_opponent_sacrifices"; filter: string; includeSelf?: boolean; onlySeatId?: string }
  // "Each player discards a card." / "Each player loses 1 life and draws a card." (Rankle)
  | { kind: "each_player_basics"; discard?: number; loseLife?: number; draw?: number }
  // "Reveal cards from the top of your library until you reveal a land card. Put that card onto the battlefield tapped and the rest
  // on the bottom of your library in a random order." (Clifftop Lookout)
  | { kind: "reveal_until_land_to_battlefield" }
  // Gift a card (Scrapshooter): promised whenever there is something worth destroying; the opponent whose permanent is destroyed draws.
  | { kind: "gift_destroy_artifact_or_enchantment" }
  // "Until end of turn, Sarkhan ... gains flying." (Sarkhan, Dragon Ascendant) — the source itself gains keywords until end of turn.
  | { kind: "self_gains_keywords"; keywords: string[] }
  // "You may pay any amount of {R}. When you do, it deals that much damage to any target." (Leyline Tyrant) — pays every red it can.
  | { kind: "pay_red_for_damage" }
  // "Exile cards from the top of your library until you exile a nonland card. You may cast it without paying its mana cost if that
  // spell's mana value is 8 or less. If you don't, put that card into your hand." (Breaching Dragonstorm) — always takes the hand
  // option, which is a legal choice and avoids casting without a stack.
  | { kind: "dig_nonland_to_hand" }
  // A plain zone effect as a trigger's whole effect ("mill three cards", Undead Butler's enters trigger).
  | { kind: "zone_effect"; effect: ZoneEffect }
  // "When this creature dies, you may exile it. When you do, return target creature card from your graveyard to your hand." (Undead Butler)
  | { kind: "exile_self_return_creature_to_hand" }
  // Battle cry: "Whenever this creature attacks, each other attacking creature gets +1/+0 until end of turn."
  // Renown N: "When this creature deals combat damage to a player, if it isn't renowned, put N +1/+1 counters on it and it becomes renowned."
  | { kind: "renown"; amount: number }
  // The human's echo decision (pay it, or sacrifice the permanent).
  | { kind: "echo_choice"; costText: string }
  // A single verb on a target you choose: "put a +1/+1 counter on target creature you control", "target player loses 1 life and you gain 1 life".
  | { kind: "targeted_effect"; effect: TargetedEffect }
  // "Whenever a creature you control with flying enters, it gains haste until end of turn." (Dragon Tempest): the creature that entered gains them.
  | { kind: "context_gains_keywords"; keywords: string[] }
  // "Destroy all creatures with flying. Put a +1/+1 counter on this creature for each creature destroyed this way." (Whiptongue Hydra)
  | { kind: "destroy_fliers_then_counters" }
  // A creature that must attack, and the choice of whom.
  | { kind: "forced_attack"; cardId: string; targetIds: string[] }
  // Initiative: "you take the initiative" (the holder ventures into the Undercity), the room effect that was entered, and the human's branch choice.
  | { kind: "take_initiative" }
  | { kind: "venture_room"; room: string }
  | { kind: "venture_choice"; options: string[] }
  // One repetition of a punisher effect for a human victim.
  | { kind: "punisher_prompt"; lifeAmount: number; remaining: number }
  // Discover: cast the found card for free, or put it into hand.
  | { kind: "discover_choice"; cardName: string }
  // Rishkar's Expertise: which hand card (by id, in option order) to cast without paying its mana cost.
  | { kind: "free_cast_choice"; cardIds: string[] }
  // "If this card is in your opening hand, you may begin the game with it on the battlefield." (the Leylines): the human's yes/no; the other
  // such cards still to ask about ride along.
  | { kind: "opening_hand_battlefield"; remainingIds: string[] }
  | { kind: "battle_cry" }
  // Melee: "Whenever this creature attacks, it gets +1/+1 until end of turn for each opponent you attacked this combat."
  | { kind: "melee" }
  // "Discard any number of cards, then draw that many cards." (The Elder Dragon War, chapter II). discardIds accumulates the human's picks.
  // plusOne: "...then draw that many cards plus one." (Brass's Tunnel-Grinder); toLibraryBottom: "Put any number of cards from your hand on the
  // bottom of your library, then draw that many cards plus one." (Valakut Awakening)
  | { kind: "discard_any_then_draw"; discardIds?: string[]; plusOne?: boolean; toLibraryBottom?: boolean; max?: number }
  // "Read ahead" (The Elder Dragon War): the controller picks the chapter a Saga starts on as it enters.
  | { kind: "read_ahead"; chapterCount: number }
  // "Exile the top X cards of your library, where X is the number of creatures you control with power 4 or greater. You may play those cards
  // until your next end step. At the beginning of your next end step, [it] deals 2 damage to each opponent for each of those cards that are
  // still exiled." (Dragonhawk, Fate's Tempest)
  | { kind: "exile_top_by_power_then_damage"; minPower: number; damagePerCard: number }
  // A human's yes/no on an optional upkeep/end-step trigger that otherwise resolves deterministically (Cemetery Tampering's "you may mill three").
  | { kind: "phase_optional"; phase: TurnPhase }
  // A standing "at the beginning of <step>" ability on the stack (see src/lib/phaseTriggers.ts and makePhaseStackTrigger): resolves through
  // applyDeterministicPhaseTrigger from the source as it is now, or from sourceSnapshot (last-known information) when the source has left the
  // battlefield. viaEffect: the parsed effect to resolve instead (an agent's aimed trigger carries its recorded target in chosenOption).
  // delayedEffectText: a one-shot delayed trigger created by a resolved effect (no source permanent text to read).
  | { kind: "phase_trigger"; phase: TurnPhase; sourceSnapshot?: VisibleCard; viaEffect?: TriggerEffect; delayedEffectText?: string; delayedReturn?: DelayedReturnCard }
  // "Search your library for a permanent card, put it onto the battlefield, then shuffle." (Tezzeret, Artifice Master's emblem; Garruk,
  // Unleashed's emblem with "you may" -> the generic optional flag). filter is the searched type word ("permanent", "creature", ...). A human is
  // given the library picker (finishTriggerResolution); an agent's pick is made deterministically by resolveSearchLibraryPut.
  | { kind: "search_library_put"; filter: string; tapped?: boolean }
  // A human's answer to "you may pay N life; if you don't, this land enters tapped" (Godless Shrine and the pay-life MDFC lands): the land is already in play tapped.
  | { kind: "shock_pay"; life: number }
  // A human's answer to a checkland-style "you may reveal a Mountain or Island card from your hand. If you don't, this land enters tapped" (the Snarls): chosenOption indexes cardIds (reveal that card, the land untaps); past the end = don't reveal.
  | { kind: "reveal_land_untap"; cardIds: string[] }
  // Myriad (Goldlust Triad): a token copy tapped and attacking each opponent other than the defending player, exiled at end of combat.
  | { kind: "myriad"; defendingSeatId: string }
  // "Until end of turn, Nogi becomes a Dragon with base power and toughness 5/5 and gains flying." (Nogi, Draco-Zealot)
  | { kind: "self_becomes_dragon"; power: number; toughness: number; keywords: string[] }
  // "...you may put a Dragon creature card from your hand onto the battlefield tapped and attacking." (Minion of the Mighty)
  | { kind: "dragon_from_hand_attacking"; subtype: string }
  // "Landfall — Whenever a land you control enters, you may return target nonland permanent card from your graveyard to your hand. If that
  // land is a Plains, you may return that card to the battlefield instead." (Emeria Shepherd)
  | { kind: "landfall_return_nonland_permanent"; plainsToBattlefield: boolean; toHand?: boolean }
  // "...you may put her into her owner's library third from the top." (God-Eternal Bontu) — from the graveyard or exile.
  | { kind: "self_to_library_third" }
  // "When this land enters untapped, you may put target creature card from your graveyard on top of your library." (Witch's Cottage)
  | { kind: "graveyard_creature_to_library_top" }
  // "Sacrifice any number of other permanents, then draw that many cards." (God-Eternal Bontu) — sacrifices only lands beyond the seventh.
  | { kind: "sacrifice_surplus_then_draw"; sacrificeIds?: string[] }
  // Hideaway N (Mosswort Bridge, Spinerock Knoll): look at the top N cards, exile one face down, the rest to the bottom in a random order.
  | { kind: "hideaway"; count: number }
  // "As this enchantment enters, choose Khans or Dragons." (Outpost Siege) — records the label on the permanent (chosenOption picks it).
  | { kind: "choose_named_mode"; options: string[] }
  // "This creature deals 1 damage to each opponent." (Firespitter Whelp)
  | { kind: "damage_each_opponent"; amount: number }
  // "Whenever a Dragon you control enters, you may pay {R}. If you do, return this card from your graveyard to your hand." (Spit Flame)
  | { kind: "pay_red_return_self_from_graveyard" }
  // "When this creature enters, exile up to two target artifacts and/or enchantments." (Angel of the Ruins)
  | { kind: "exile_up_to_artifacts_enchantments"; count: number }
  // "When this enchantment enters, for each opponent, exile up to one target nonland permanent that player controls until this enchantment
  // leaves the battlefield." (Grasp of Fate)
  | { kind: "exile_until_leaves_each_opponent" }
  // "Target creature you control gets +2/+2 and gains trample until end of turn." (Rhonas's Monument)
  | { kind: "pump_target_creature"; power: number; toughness: number; keywords: string[] }
  // "Proliferate." (Norn's Choirmaster) — every eligible permanent and player, same as the blanket resolveProliferate.
  | { kind: "proliferate" }
) & {
  optional?: boolean;
  // Rule 603.4: the clause (with its intervening "if") of a phase trigger, rechecked when the trigger resolves; if the condition has become false the
  // ability does nothing.
  recheckClause?: string;
  // Put on the stack by the phase-trigger registry when a step began: its agent controller takes no pass of its own (see pendingActionRequiredPasses).
  fromPhaseStep?: boolean;
  // "This ability triggers only once each turn." (Dina, Essence Brewer; Morbid Opportunist): checked and recorded in
  // session.onceEachTurnEffectsUsed when the trigger resolves, so a second event the same turn does nothing.
  oncePerTurn?: boolean;
  // The human's pick when a trigger's effect needs a choice (modal trigger: the mode index; Bontu: how many lands to sacrifice).
  chosenOption?: string;
  // Only resolves if this holds when the trigger resolves ("...if you control the creature with the greatest power").
  condition?: TriggerCondition;
  // "Create a 0/1 green Plant creature token, then put a +1/+1 counter on each Plant you control."
  // (Insidious Roots) — a narrow, single compound field rather than a general sequence/list of
  // effects, matching how add_counter's own alsoTap flag already models a compound tap-and-counter
  // shape instead of introducing a whole second effect-chaining concept. Applied by one recursive
  // call at the end of resolveTriggerEffect once the primary effect has resolved.
  then?: TriggerEffect;
};

export type TriggerCondition = { kind: "controls_greatest_power" } | { kind: "source_untapped" } | { kind: "behold"; subtype: string } | { kind: "total_power_at_least"; amount: number } | { kind: "controls_no_other"; subtype: string } | { kind: "controls_subtype_count"; subtype: string; amount: number } | { kind: "attacking_power_at_least"; amount: number };

export type PendingAction =
  | {
      id: string;
      type: "phase";
      actorSeatId: string;
      message: string;
    }
  | {
      id: string;
      type: "spell";
      actorSeatId: string;
      cardId: string;
      cardName: string;
      cardTypeLine?: string;
      sourceZone?: "hand" | "command" | "exile" | "graveyard" | "library";
      // Cast from the graveyard via flashback: the spell is exiled instead of returning to the graveyard.
      flashback?: boolean;
      // A copy made by Sunken Palace's mana: nothing is paid, no cast triggers, and the copy ceases to exist after resolving.
      isCopy?: boolean;
      manaSourceIds: string[];
      // Colors of mana actually spent to cast it ("if {W} was spent to cast this spell": Batwing Brume).
      manaSpentColors?: string[];
      position?: { x: number; z: number };
      faceIndex?: number;
      chosenX?: number;
      counterTargetId?: string;
      // Modes and targets the caster chose as the spell was cast (rule 601.2c).
      castChoices?: CastChoices;
      message: string;
    }
  | {
      id: string;
      type: "trigger";
      actorSeatId: string;
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      triggerKind: "common";
      effect: TriggerEffect;
      // The permanent "it"/"that creature" refers to for an ETB trigger like "put a +1/+1
      // counter on it" — only meaningful for the add_counter "context" scope; the entering
      // permanent isn't always the trigger source itself (e.g. Cathars' Crusade watches other
      // creatures enter).
      contextCardId?: string;
      parentAction?: PendingAction;
      message: string;
    };

// The continuation choose_effect_target resolves into once a human picks a target — names which
// pure applier owns re-entry (applyRemovalEffect/applyZoneEffect), carrying exactly what that
// applier needs besides the target itself (chosenX for a variable-damage spell's already-paid X).
export type PendingTargetedEffect =
  | { kind: "targeted"; effect: TargetedEffect }
  | { kind: "removal"; effect: RemovalEffect; chosenX?: number }
  | { kind: "zone"; effect: ZoneEffect; chosenX?: number }
  // "Another target creature gets +2/+0 and gains trample until end of turn." (Rhonas the Indomitable): the human aims the pump.
  | { kind: "pump"; effect: PumpEffect }
  // "Target non-Aura enchantment you control becomes a creature ..." (Zur, Eternal Schemer): the human picks the enchantment.
  | { kind: "animate_enchantment" }
  // "Look at the top three cards of target player's library, then put them back in any order. You may have that player shuffle." (Portent)
  | { kind: "library_look"; count: number; offerShuffle: boolean };

// The human's answers to a spell's cast-time choices: which modes (indices into the card's own mode list) and which targets, in the
// order the spell's effects consume them. Attached to the spell on the stack so resolution uses exactly what the opponents saw.
export interface CastChoices {
  modes?: number[];
  // "Choose one or more / one or both": the player pressed "Done choosing" after at least one mode.
  modesDone?: boolean;
  targets: ChosenTarget[];
}

// One "pick a target from this list" step of a labeled target choice, with the picks already resolved to ChosenTargets.
export interface LabeledSlot {
  prompt: string;
  options: Array<{ label: string; target: ChosenTarget }>;
}

// What happens once every slot of a labeled target choice has been answered.
export type LabeledContinuation =
  | { kind: "damage"; effect: RemovalEffect; chosenX?: number }
  | { kind: "extra"; effect: SpellExtraEffect; lifeAmount?: number };

export type PendingRuleChoice =
  // "You may pay {W} and tap four untapped creatures you control with flying rather than pay this spell's mana cost." (Sephara): the human
  // chooses between the alternative and the normal cost before anything is paid; the cast is then replayed with that choice.
  // "You may have this enter as a copy of ..." (Cursed Mirror, Mirrormade): the human picks what to copy (or declines) before the cast is replayed.
  | {
      id: string;
      kind: "choose_cast_copy";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      options: Array<{ cardId: string; label: string }>;
      resume: { seatId: string; cardId: string; position?: { x: number; z: number }; sourceZone: "hand" | "command" | "exile" | "graveyard" | "library"; faceIndex?: number; sacrificeTargets?: VisibleCard[] };
    }
  // X spells, kicker and multikicker: the human chooses X (or kicked / not kicked) before the cast is replayed.
  | {
      id: string;
      kind: "choose_cast_x";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      options: Array<{ value: number; label: string }>;
      resume: { seatId: string; cardId: string; position?: { x: number; z: number }; sourceZone: "hand" | "command" | "exile" | "graveyard" | "library"; faceIndex?: number; sacrificeTargets?: VisibleCard[] };
    }
  // A split / Adventure card with more than one castable half: the caster picks which half to cast (and pays only that half's cost) before anything is paid.
  | {
      id: string;
      kind: "choose_cast_face";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      options: Array<{ faceIndex: number; label: string }>;
      resume:
        | { via: "playCard"; seatId: string; cardId: string; position?: { x: number; z: number }; sourceZone: "hand" | "command" | "exile" | "graveyard" | "library"; sacrificeTargets?: VisibleCard[] }
        | { via: "respondWithCard"; cardId: string; sourceZone: "hand" | "exile" };
    }
  | {
      id: string;
      kind: "choose_cast_alt";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      altLabel: string;
      resume: { seatId: string; cardId: string; position?: { x: number; z: number }; sourceZone: "hand" | "command" | "exile" | "graveyard" | "library"; faceIndex?: number; sacrificeTargets?: VisibleCard[] };
    }
  // The cast-time questions of a spell (modes, then targets): answered one at a time BEFORE the cost is paid; then the cast is replayed
  // with the answers attached (see playCard / respondWithCard's castChoices parameter).
  | {
      id: string;
      kind: "choose_cast_targets";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      planCard: VisibleCard;
      chosenX?: number;
      prompt: string;
      promptKind: "modes" | "target";
      options: Array<{ label: string; mode?: number; target?: ChosenTarget }>;
      answers: CastChoices;
      resume:
        | { via: "playCard"; seatId: string; cardId: string; position?: { x: number; z: number }; sourceZone: "hand" | "command" | "exile" | "graveyard" | "library"; faceIndex?: number; sacrificeTargets?: VisibleCard[]; altChoice?: "alt" | "normal" }
        | { via: "respondWithCard"; cardId: string; sourceZone: "hand" | "exile"; faceIndex?: number; sacrificeTargets?: VisibleCard[] };
    }
  // A cast "choose one / choose two" spell (Austere Command, Valorous Stance, Collective Resistance, Profane Command): the human picks
  // the modes one at a time, then they all apply together (their targets are chosen automatically when more than one mode is picked).
  | {
      id: string;
      kind: "choose_spell_modes";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      sourceCard: VisibleCard;
      chooseCount: number;
      chosenX?: number;
      // Index-aligned with `labels`; exactly one of the two mode lists is set.
      removalModes?: Array<Exclude<RemovalEffect, { kind: "modal" }>>;
      genericModes?: GenericModalMode[];
      distinctPerTurn?: boolean;
      labels: string[];
      picked: number[];
    }
  // "Look at the top N cards... you may reveal a <type> card and put it into your hand" (Orb of Dragonkind): the human sees the cards
  // and picks which qualifying one to take (or none) after paying the cost.
  | {
      id: string;
      kind: "choose_dig_card";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      count: number;
      typeWord: string;
      // Loot: the pick enters the battlefield, capped at this mana value, instead of going to hand.
      toBattlefieldMaxManaValue?: number;
      // Throne of the Dead Three: the creature also gets three +1/+1 counters and hexproof.
      throneBonus?: boolean;
      options: Array<{ index: number; label: string; cardId: string }>;
    }
  // Targets that don't fit the board-click / graveyard pickers (a creature OR a player, two different targets in a row): a plain
  // list of labeled options, one slot at a time — Ram Through (your creature, then theirs), Lightning Bolt-style "any target".
  | {
      id: string;
      kind: "choose_labeled_target";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      sourceCard: VisibleCard;
      slots: LabeledSlot[];
      slotIndex: number;
      picks: ChosenTarget[];
      continuation: LabeledContinuation;
    }
  | {
      id: string;
      kind: "choose_card_from_library";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      destination: "hand" | "battlefield" | "graveyard" | "library";
      tapped?: boolean;
      maxChoices: number;
      allowedCardFilter?: string;
      // The source text says "reveal it": the found card is shown to everyone (logged by name).
      reveal?: boolean;
      // A mana-value restriction alongside allowedCardFilter's own type restriction (Urza's Saga
      // chapter III's "an artifact card with mana cost {0} or {1}," any real "search for a card with
      // mana value N or less" tutor) — see RuleWorkflow's own manaValueRestriction field. Optional and
      // left unset by every construction site other than the rulesAdvisor-driven search dispatch, so
      // nothing else is affected.
      manaValueRestriction?: { op: "lte" | "eq" | "gte"; value: number };
      // "any number of creature cards with total mana value 6 or less" (Protean Hulk): the picks' mana values
      // must add up to at most this — see chooseRuleLibraryCard / searchableLibraryCards.
      totalManaValueLimit?: number;
      // Accumulates across multiple picks for an "up to N"/"N" search (Archaeomancer's Map's "up to
      // two basic Plains cards," ...) — chooseRuleLibraryCard appends to this and keeps the choice
      // open until maxChoices is reached (or the player clicks Done early, since "up to N" doesn't
      // require finding the full count) instead of finalizing after the very first pick regardless
      // of maxChoices, which silently capped every multi-card search at exactly one card.
      chosenCardIds?: string[];
      // "... put one onto the battlefield tapped and the other into your hand, ..." (Kodama's Reach,
      // Cultivate, ...) — this whole choice shape otherwise assumes every picked card goes to the
      // same `destination`, which can't express a split. When set, completeRuleChoice routes only
      // the FIRST picked card to `destination` (tapped) and every remaining pick here instead
      // (untapped) — a declared simplification of the real rule (a lone find, from searching for
      // "up to two," lets the controller choose either destination for it; this always sends a
      // single find to `destination`) rather than a whole second interactive sub-choice.
      splitDestination?: "hand";
      // "... put it into your hand or graveyard, then shuffle." (Dina's Guidance) — unlike
      // splitDestination above (which routes different PICKS to different zones), this is a real
      // per-pick CHOICE of zone: the same card can go to either. When set, the picker offers both
      // actions per card and chooseRuleLibraryCard/completeRuleChoice route to whichever the
      // controller actually chose instead of always using `destination`.
      destinationChoices?: Array<"hand" | "graveyard" | "battlefield">;
      // Keyed by cardId — the actual per-pick zone the controller chose via destinationChoices
      // above, for however many cards have already been picked in this (possibly multi-pick)
      // search. Consulted before splitDestination/destination in completeRuleChoice.
      chosenDestinations?: Record<string, "hand" | "graveyard" | "battlefield">;
    }
  // "Put target creature card from A GRAVEYARD onto the battlefield under your control." (Virtue of
  // Persistence) — a real target choice across every player's graveyard, not just the controller's
  // own, so it can't reuse choose_card_from_library (which always sources from controllerSeatId's
  // own library). The pool itself isn't stored here — ruleChoiceView derives it live from the
  // current session the same way choose_card_from_library derives its own cards live from
  // humanSeat.library, so it always reflects the board as of the moment the player actually picks.
  | {
      id: string;
      kind: "choose_creature_from_graveyards";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      // Meren of Clan Nel Toth's end-step ability: "...If that card's mana value is less than or
      // equal to the number of experience counters you have, return it to the battlefield.
      // Otherwise, put it into your hand." Set only for that shape (to the controller's current
      // experienceCounters) — every other consumer of this choice (Reanimate, Virtue of Persistence)
      // always sends the chosen card straight to the battlefield, so it stays undefined for those.
      manaValueCeiling?: number;
      // Reanimate: "You lose life equal to that card's mana value." — applied when the chosen card returns.
      loseLifeEqualToManaValue?: boolean;
      // Meren's real text is "in your graveyard" (its own controller's only) — Virtue of Persistence
      // is the only existing consumer of this choice, and its pool genuinely spans every player's
      // graveyard, so this defaults to false/undefined (unrestricted) to leave that unchanged.
      restrictToYourGraveyard?: boolean;
    }
  // "{T}, Sacrifice a creature: Scry 1." (Viscera Seer, and any other "sacrifice a[n] [type]
  // creature" activated ability) — payGenericSacrificeCost always called chooseSacrificeTargets (a
  // "sacrifice the least valuable creature, tokens first" heuristic) for a non-self sacrifice
  // target, with no way for a human controller to pick which creature. Deliberately its own kind
  // rather than reusing choose_creature_on_battlefield (Athreos's counter-placement) — the pool
  // filter (creature, optionally by type, always restricted to the controller's own board) and the
  // purpose (paying an activation cost, not resolving a targeted effect) are both different enough
  // that folding them into one shared shape would risk the counter-only fields leaking in. Reported
  // live as "Viscera Seer does not let me choose a creature, it just sacrifices itself."
  | {
      id: string;
      kind: "choose_creature_to_sacrifice";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      abilityIndex: number;
      // Retrofitter Foundry's "Sacrifice a Servo"/"Sacrifice a Thopter" — mirrors
      // SacrificeAbility.sacrificeTargetTypeFilter (activatedAbilities.ts) exactly.
      typeFilter?: string;
      // "Sacrifice ANOTHER creature" — the source can't be offered as its own sacrifice.
      excludeCardId?: string;
      // How many creatures must be sacrificed — almost always 1; carried through so multi-select
      // (Westvale Abbey's "Sacrifice five creatures") isn't silently capped at one pick.
      count: number;
      // Picks so far when count > 1.
      pickedIds?: string[];
      // Set when this picks creatures to TAP as a cost ("Tap three untapped Zombies you control"): the qualifier they must match.
      tapSubtype?: string;
      // Sephara's alternative cost: only these creatures may be picked, and the cast is replayed (with the alternative chosen) afterwards.
      eligibleIds?: string[];
      // A non-creature sacrifice cost ("Sacrifice an artifact"): any permanent matching typeFilter.
      anyPermanent?: boolean;
      castResume?: { seatId: string; cardId: string; position?: { x: number; z: number }; sourceZone: "hand" | "command" | "exile" | "graveyard" | "library"; faceIndex?: number };
    }
  // "Each player sacrifices a creature or planeswalker of their choice." (Plaguecrafter, Accursed
  // Marauder, ...) — every OTHER seat's sacrifice is already resolved deterministically by
  // applyEachPlayerSacrificeEffect by the time this opens (see its own humanSacrificeNeededSeatId);
  // this is only the human controller's OWN pick. Deliberately separate from
  // choose_creature_to_sacrifice just above: this is an ETB effect's own mandatory choice, not an
  // activated ability's cost, so there's no abilityIndex/payGenericSacrificeCost to resume through —
  // applyChosenEachPlayerSacrifice below applies the pick directly. Reported live as "Plaguecrafter
  // did not let me choose target creature to sacrifice, it auto picked which I dont like."
  | {
      id: string;
      kind: "choose_each_player_sacrifice";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      typeFilter: string;
      // "Each player sacrifices six creatures" (Necrotic Hex): how many are still to be chosen, and tokens this spell made are not eligible.
      remaining?: number;
      excludeTokensFromSourceId?: string;
      // Braids, Arisen Nightmare's "you may" picks: closing the picker declines. "controller" is Braids' controller choosing what to
      // sacrifice; "opponent" is an opponent who may sacrifice a permanent sharing a type (declining costs them 2 life and gives Braids'
      // controller a card), with the opponents still to answer after them.
      braids?: { stage: "controller" | "opponent"; braidsSeatId: string; remainingOpponentIds?: string[] };
    }
  // "As an additional cost to cast this spell, sacrifice a creature." (Village Rites, Altar's Reap,
  // ...) — the human controller's own pick of WHICH creature to sacrifice to pay this cost, opened
  // BEFORE playCard/respondWithCard actually commits to casting: rule 601.2h pays this cost as part
  // of casting the spell, so (unlike most other interactive choices in this file, which resolve an
  // already-on-the-stack spell's effect) this has to be answered before the spell is even put on the
  // stack. resumeVia records which of the two cast entry points originally opened this — playCard
  // and respondWithCard have opposite guards (no pendingAction vs. an active one), so the resolution
  // handler has to re-enter the matching one, not just always call one or the other. Scoped to a
  // single-creature sacrifice (parseAdditionalSacrificeCost's count === 1, this shape's overwhelming
  // majority), same precedent as choose_creature_to_sacrifice's own count-1 scope limit. Reported
  // live as "Village Rites did not give the choice to choose a creature to sacrifice."
  | {
      id: string;
      kind: "choose_creature_to_sacrifice_for_cast";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      // Which kind of permanent may pay the cost ("creature" when omitted; "land" for Harrow). Drives the candidate list the picker shows.
      sacrificeType?: AdditionalSacrificeType;
      resumeVia: "playCard" | "respondWithCard";
      sourceZone: "hand" | "command" | "exile" | "graveyard" | "library";
      faceIndex?: number;
      position?: { x: number; z: number };
    }
  // "Choose one — mode. mode. mode." (Cankerbloom, and any other modal removal-shaped ability) —
  // applyRemovalEffect's own "modal" case always auto-picked the first `chooseCount` viable modes
  // for EVERY card, human or agent, with no choice UI of any kind. options are pre-filtered to modes
  // that currently have a legal target (removalEffectHasLegalTarget) so an unreachable mode (e.g.
  // "destroy target artifact" with no artifacts on board) is never offered at all. Only chooseCount
  // 1 ("Choose one") is interactive for now — "Choose two" would need a real multi-select UI this
  // doesn't build yet, so those stay on the deterministic auto-pick unchanged. Reported live as
  // Cankerbloom always destroying an artifact with no way to pick Destroy Enchantment or Proliferate.
  | {
      id: string;
      kind: "choose_modal_option";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      options: Array<{ index: number; label: string }>;
      // The already-cost-paid session's viable modes, in the SAME order as `options` (index-aligned)
      // — kept off the choice itself only as far as the modes' own structured shape; resolution reads
      // this to apply whichever one the human picked via applyRemovalEffect, or (for proliferate)
      // to open choose_proliferate_targets next instead.
      modes: Exclude<RemovalEffect, { kind: "modal" }>[];
      // A snapshot of the source card as it was just before its cost was paid (which may already
      // have sacrificed it) — applyRemovalEffect/chooseRemovalTarget still need it for self-
      // exclusion and protection-color checks even though it may no longer be on the battlefield by
      // the time the human actually picks a mode, same as applySacrificeEffect's own sourceCard
      // parameter (payGenericSacrificeCost's returned `card`).
      sourceCard: VisibleCard;
    }
  // "Choose any number of permanents and/or players, then give each another counter of each kind
  // already there." (rule 121.9, reached via Cankerbloom's Proliferate mode above) — the blanket
  // resolveProliferate (AppFlow.tsx) proliferates literally everything eligible with no choice at
  // all; this is the real interactive version for a human controller. The eligible pool (any
  // permanent with at least one counter, any player with poison/experience counters) is derived live
  // from the session the same way every other choice's pool is, not stored here.
  | {
      id: string;
      kind: "choose_proliferate_targets";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
    }
  // The general "this effect says target and you control it" choice — covers any single-target
  // removal effect (destroy/exile/bounce/damage, cast directly OR chosen out of
  // choose_modal_option's mode picker) and any single-target zone effect (currently just regrow —
  // Eternal Witness's "return target card from your graveyard to your hand") that isn't already
  // covered by one of the more specific kinds above (choose_creature_from_graveyards already
  // handles reanimate; choose_creature_to_sacrifice already handles sacrifice costs). Reported live
  // repeatedly: a plain destroy/exile/bounce/damage spell always auto-picked via chooseRemovalTarget/
  // chooseDamageTarget with no way for a human controller to choose, and Eternal Witness returned
  // "some card" via chooseRegrowTarget with no say either. spec/pending carry everything the
  // resolver needs to re-enter applyRemovalEffect/applyZoneEffect with the human's own pick instead
  // of the heuristic — see maybeRequestTarget's own doc comment for the "only ask when there's a
  // real decision" gate (auto-picks when 0 or 1 legal target exists, same as before this existed).
  | {
      id: string;
      kind: "choose_effect_target";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      // Same snapshot reasoning as choose_modal_option.sourceCard above — the source may already
      // have been sacrificed (an activated ability's cost) or moved to the graveyard (a resolving
      // instant/sorcery) by the time the human actually picks.
      sourceCard: VisibleCard;
      prompt: string;
      spec: TargetSpec;
      // "You MAY return target card..." (Eternal Witness) vs. a plain "Destroy target creature."
      // (Murder) — an optional effect gets a Decline affordance instead of being forced to pick.
      optional: boolean;
      pending: PendingTargetedEffect;
    }
  // "Put a coin counter on another target creature." (Athreos, Shroud-Veiled's end step trigger,
  // and the same battlefield-target counter shape on other cards) — this engine otherwise has no
  // interactive targeting for a permanent already on the battlefield (every other targeted effect
  // auto-picks via a heuristic like chooseCounterTarget), so a human controller gets a real choice
  // here instead of having a pick made for them.
  | {
      id: string;
      kind: "choose_creature_on_battlefield";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      counterKind: string;
      amount: number;
      restrictToYourControl: boolean;
    }
  // "No interactive targeting exists for Auras" (see chooseAuraAttachTarget's own doc comment) —
  // every Aura currently auto-attaches to a heuristic-picked creature (best power+toughness for a
  // beneficial one, worst for a removal-style one) the instant it resolves. Rather than rework that
  // whole resolution path (deep inside a single giant setSession updater with no access to
  // setPendingRuleChoice), this offers a human controller a chance to redirect it to their own
  // choice right after — sourceCardId is the Aura, already attached to whatever the heuristic
  // picked; declining (closing the choice) just leaves that pick in place. Reported live as Timely
  // Ward never letting its caster choose which creature to protect.
  | {
      id: string;
      kind: "choose_aura_attach_target";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      restrictToYourControl: boolean;
    }
  // Equip's own reminder text is "Attach to target creature you control" — a real target choice,
  // unlike an Aura's auto-attach-then-redirect shape above. Opened BEFORE paying the cost (mirrors
  // choose_creature_to_sacrifice's "open the choice, pay once picked" order, not
  // chooseEquipTarget/resolveEquip's auto-pick-then-apply order) so a human can freely cancel
  // without having already spent mana. No exclusions on the pool — re-equipping to the same
  // creature it's already attached to is a legal, if pointless, choice (real Magic allows it), so
  // every creature the controller controls is offered, board-ring UI same as choose_aura_attach_target.
  | {
      id: string;
      kind: "choose_equip_target";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      cost: number;
    }
  // Rule 903.9a: a commander that would go to the graveyard may be put into the command zone
  // instead — owner's choice, not automatic (exile still always redirects; see
  // moveCardBetweenVisibleZones). sourceCardId is the commander card currently sitting in
  // controllerSeatId's own graveyard.
  | {
      id: string;
      kind: "commander_zone_choice";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      // Where the commander is sitting now (Grasp of Fate / Swords / O-Ring exile it; death puts it in the graveyard).
      fromZone?: "graveyard" | "exile";
    }
  | {
      id: string;
      kind: "manual_review";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
    }
  | {
      id: string;
      kind: "order_triggers";
      controllerSeatId: string;
      prompt: string;
      triggers: Array<{
        sourceCardId: string;
        sourceCardName: string;
        text: string;
      }>;
      orderedTriggers: Array<{
        sourceCardId: string;
        sourceCardName: string;
        text: string;
      }>;
    }
  | {
      id: string;
      kind: "miracle_offer";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      miracleCost: number;
    }
  | {
      id: string;
      kind: "optional_trigger";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      trigger: Extract<PendingAction, { type: "trigger" }>;
      remainingStack: PendingAction[];
    }
  // The same "you may" concept as optional_trigger above, for a plan produced by the primitive-
  // action fallback (consultPrimitiveActionPlanner) instead of the deterministic trigger queue —
  // that path resolves synchronously with no PendingAction/trigger wrapping, so it can't reuse
  // optional_trigger's trigger/remainingStack fields; it stores the steps to apply on accept
  // directly instead. sourceCard is a plain snapshot (not re-looked-up live) since
  // applyPrimitiveActionPlan only ever reads sourceCard.name and the choice is resolved within the
  // same turn it was created, same as every other rule choice's use of an already-in-scope card.
  | {
      id: string;
      kind: "optional_primitive_plan";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      sourceCard: VisibleCard;
      steps: PrimitiveActionStep[];
    }
  | {
      id: string;
      kind: "discard_to_hand_size";
      controllerSeatId: string;
      prompt: string;
      requiredDiscards: number;
      // Cards the controller draws once the discard is done ("discard a card, then draw a card").
      thenDraw?: number;
      // The discard is an additional COST of casting this card: the picks go onto it and the cast is replayed (Thrill of Possibility).
      castResume?: { seatId: string; cardId: string; position?: { x: number; z: number }; sourceZone: "hand" | "command" | "exile" | "graveyard" | "library"; faceIndex?: number };
      // Set when this same "choose N cards to discard" picker is reused for a trigger other than
      // the real cleanup-step hand-size rule (e.g. Plaguecrafter's "if a player can't, they discard
      // a card instead") — lets the modal header and event-log message name the actual source
      // instead of defaulting to "hand size" wording that would be wrong for those cases.
      sourceCardName?: string;
      // Set when the discard is the human's own choice for an activated ability's "Discard a card"
      // cost (Cryptbreaker) — on completion the activation is re-run with the picked card instead
      // of discarding it here, so the mana, tap and discard are all paid together.
      // discardType limits the pickable hand cards to that card type ("Creature" for Fauna Shaman).
      activation?: { cardId: string; abilityIndex: number; discardType?: string };
    }
  // A triggered ability that needs the human to pick one of several options before it resolves — a modal trigger's mode (Elder
  // Gargaroth, Atsushi, Parapet Thrasher) or how many lands God-Eternal Bontu sacrifices. The pick goes back onto the trigger as
  // effect.chosenOption and the trigger resolves normally.
  | {
      id: string;
      kind: "choose_trigger_option";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      options: Array<{ index: number; label: string; cardId?: string }>;
      trigger: Extract<PendingAction, { type: "trigger" }>;
      remainingStack: PendingAction[];
      // Set when the question is asked as the trigger goes onto the stack (modes and targets are chosen then, rule 603.3c): the whole
      // batch being queued, so the answer can be attached and queueing can continue.
      queueing?: Array<Extract<PendingAction, { type: "trigger" }>>;
    }
  // "Target creature gains hexproof and indestructible until end of turn." (Valorous Stance, Collective Resistance) / "can't be
  // blocked this turn" (Rogue's Passage): the human picks which of their creatures gets the keywords.
  | {
      id: string;
      kind: "choose_creature_for_grant";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      keywords: string[];
    }
  // A triggered ability that targets cards (a creature to grow, a graveyard card to return, a permanent to destroy): the human clicks
  // them one at a time (picksNeeded > 1 for "up to two"), and the ids go back onto the trigger as effect.chosenOption.
  | {
      id: string;
      kind: "choose_trigger_card";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      zone: "battlefield" | "graveyard";
      cards: Array<{ seatId: string; cardId: string }>;
      picksNeeded: number;
      picked: string[];
      trigger: Extract<PendingAction, { type: "trigger" }>;
      remainingStack: PendingAction[];
      queueing?: Array<Extract<PendingAction, { type: "trigger" }>>;
    }
  // "Exile target card from a graveyard" (Scavenging Ooze) — the human picks the card BEFORE paying, then the activation re-runs with
  // that card as its target.
  | {
      id: string;
      kind: "choose_ability_card_target";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      cards: Array<{ seatId: string; cardId: string }>;
      activation: { cardId: string; abilityIndex: number; via?: "mana" | "tap" };
    }
  | {
      id: string;
      kind: "put_cards_on_library";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      requiredCount: number;
      // Present only when this choice grew out of resolving a triggered ability (finishTriggerResolution's
      // draw_then_put_back branch) — there's a real stack/parent action to resume once the choice is
      // made. A plain cast spell's own "draw N, then put M back" (Brainstorm, ...) reaches this same
      // choice via applyRuleWorkflow instead, well after the spell itself already finished resolving
      // and priority already moved on, so it has neither of these and nothing left to resume.
      trigger?: Extract<PendingAction, { type: "trigger" }>;
      remainingStack?: PendingAction[];
    }
  | {
      id: string;
      kind: "connive_discard";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      // "Connives twice" (rare, but real) resolves as two separate draw-then-discard iterations,
      // not one discard of two cards — this counts how many MORE iterations follow the one this
      // choice is currently resolving, so completeConniveDiscard knows whether to loop back into
      // another draw + discard choice or resume the stack.
      remainingAmount: number;
      trigger?: Extract<PendingAction, { type: "trigger" }>;
      remainingStack?: PendingAction[];
    }
  | {
      id: string;
      kind: "return_land_to_hand";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      trigger?: Extract<PendingAction, { type: "trigger" }>;
      remainingStack?: PendingAction[];
    }
  | {
      id: string;
      kind: "choose_permanent_to_blink";
      controllerSeatId: string;
      // Excluded from its own target list — "ANOTHER target permanent you own."
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      trigger?: Extract<PendingAction, { type: "trigger" }>;
      remainingStack?: PendingAction[];
    }
  | {
      id: string;
      kind: "choose_creature_type";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
    }
  | {
      id: string;
      kind: "choose_color";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      excludedColor?: string;
    }
  // Klauth, Unrivaled Ancient's attack trigger: "add X mana in any combination of colors" — a real
  // choice for a human controller (how much of each of the 5 colors), amount is the fixed X already
  // computed (total power of attacking creatures) at the moment the trigger fired. An agent skips
  // this choice entirely — see the heuristic split applied directly in declareAttack.
  | {
      id: string;
      kind: "distribute_attack_trigger_mana";
      controllerSeatId: string;
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      amount: number;
      spellType?: string;
    };
