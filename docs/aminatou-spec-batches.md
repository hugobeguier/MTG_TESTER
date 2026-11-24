# Aminatou deck: spec-writing batches

Generated from the oracle text in data/cards.db (not from memory) by a keyword classifier; 87 cards. Score = sum of the weights of the tags that match the oracle text (higher = more rule surface, more ways to be wrong). **Batch 1 is the riskiest**: write those specs first; the last batches are lands and mana rocks that mostly need one or two scenarios.

Tags: `room` = Room (CR 709): doors, unlocking, per-door characteristics (weight 6); `copy` = copy effects (weight 5); `replacement` = replacement effects / as-enters choices (weight 5); `layers` = statics / layers / restrictions / cost changes (weight 4); `trigger-scope` = triggers with a scope (whose / which object / how many times) (weight 4); `delayed` = delayed triggers / durations (weight 3); `xmodes` = X / modes / alternative or additional costs / timing restrictions (weight 4); `library` = library manipulation / search / reveal (weight 3); `activated` = activated abilities with costs / targets (weight 3); `targets` = targeting (legal / illegal targets, fizzling) (weight 2); `multiplayer` = multiplayer scope (2 vs 4 players) (weight 2); `tokens` = tokens (weight 2); `counters` = counters (weight 2); `mana` = mana production (weight 1).

Cards that already have an accepted example spec are marked with `[spec]` (see data/kernel-specs).

## Batch 1 (highest risk)

| Card | Type | Score | Tags | Oracle text (abridged) |
|---|---|---|---|---|
| Secret Arcade [spec] | Enchantment — Room // Enchantment — Room | 18 | room, layers, trigger-scope, targets, counters | Secret Arcade: Nonland permanents you control and permanent spells you control are enchantments in addition to their other types. / / / Dusty Parlor: Whenever you cast an enchantment spell, put a number of +1/+1 counters equal ... |
| Sunken Palace | Land — Cave | 18 | copy, replacement, layers, activated, mana | This land enters tapped. / {T}: Add {U}. / {1}{U}, {T}, Exile seven cards from your graveyard: Add {U}. When you spend this mana to cast a spell or activate an ability, copy that spell or ability. You may choose new targets for... |
| Fear of Sleep Paralysis | Enchantment Creature — Nightmare | 16 | room, layers, targets, multiplayer, counters | Flying / Eerie — Whenever this creature or another enchantment you control enters and whenever you fully unlock a Room, tap up to one target creature and put a stun counter on it. / Stun counters can't be removed from permanent... |
| Halimar Depths | Land | 16 | replacement, trigger-scope, library, activated, mana | This land enters tapped. / When this land enters, look at the top three cards of your library, then put them back in any order. / {T}: Add {U}. |
| Heliod, the Radiant Dawn | Legendary Enchantment Creature — God // Legendary Enchantment Creature — Phyrexian God | 16 | layers, trigger-scope, delayed, activated, targets | Heliod, the Radiant Dawn: When Heliod enters, return target enchantment card that isn't a God from your graveyard to your hand. / {3}{U/P}: Transform Heliod. Activate only as a sorcery. / / Heliod, the Warped Eclipse: You may c... |
| Temple of Deceit | Land | 16 | replacement, trigger-scope, library, activated, mana | This land enters tapped. / When this land enters, scry 1. / {T}: Add {U} or {B}. |
| Temple of Silence | Land | 16 | replacement, trigger-scope, library, activated, mana | This land enters tapped. / When this land enters, scry 1. / {T}: Add {W} or {B}. |
| Mind's Dilation | Enchantment | 13 | layers, trigger-scope, library, multiplayer | Whenever an opponent casts their first spell each turn, that player exiles the top card of their library. If it's a nonland card, you may cast it without paying its mana cost. |
| Shark Typhoon | Enchantment | 13 | trigger-scope, xmodes, activated, tokens | Whenever you cast a noncreature spell, create an X/X blue Shark creature token with flying, where X is that spell's mana value. / Cycling {X}{1}{U} / When you cycle this card, create an X/X blue Shark creature token with flying. |
| Athreos, Shroud-Veiled | Legendary Enchantment Creature — God | 12 | layers, trigger-scope, targets, counters | Indestructible / As long as your devotion to white and black is less than seven, Athreos isn't a creature. / At the beginning of your end step, put a coin counter on another target creature. / Whenever a creature with a coin co... |
| Myriad Landscape | Land | 12 | replacement, library, activated, mana | This land enters tapped. / {T}: Add {C}. / {2}, {T}, Sacrifice this land: Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle. |
| Aminatou, Veil Piercer | Legendary Creature — Human Wizard | 10 | delayed, xmodes, library | At the beginning of your upkeep, surveil 2. / Each enchantment card in your hand has miracle. Its miracle cost is equal to its mana cost reduced by {4}. |
| Demon of Fate's Design | Enchantment Creature — Demon | 10 | delayed, xmodes, activated | Flying, trample / Once during each of your turns, you may cast an enchantment spell by paying life equal to its mana value rather than paying its mana cost. / {2}{B}, Sacrifice another enchantment: This creature gets +X/+0 unti... |
| Esper Sentinel | Artifact Creature — Human Soldier | 10 | trigger-scope, xmodes, multiplayer | Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is this creature's power. |
| Inkshield | Instant | 10 | replacement, delayed, tokens | Prevent all combat damage that would be dealt to you this turn. For each 1 damage prevented this way, create a 2/1 white and black Inkling creature token with flying. |

## Batch 2 (risk 10 down to 8)

| Card | Type | Score | Tags | Oracle text (abridged) |
|---|---|---|---|---|
| Portent | Sorcery | 10 | delayed, library, targets, multiplayer | Look at the top three cards of target player's library, then put them back in any order. You may have that player shuffle. / Draw a card at the beginning of the next turn's upkeep. |
| Arcane Sanctum | Land | 9 | replacement, activated, mana | This land enters tapped. / {T}: Add {W}, {U}, or {B}. |
| Archaeomancer's Map [spec] | Artifact | 9 | trigger-scope, library, multiplayer | When this artifact enters, search your library for up to two basic Plains cards, reveal them, put them into your hand, then shuffle. / Whenever a land an opponent controls enters, if that player controls more lands than you, yo... |
| Contaminated Aquifer | Land — Island Swamp | 9 | replacement, activated, mana | / This land enters tapped. |
| Drowned Catacomb | Land | 9 | replacement, activated, mana | This land enters tapped unless you control an Island or a Swamp. / {T}: Add {U} or {B}. |
| Extravagant Replication | Enchantment | 9 | copy, targets, tokens | At the beginning of your upkeep, create a token that's a copy of another target nonland permanent you control. |
| Glacial Fortress | Land | 9 | replacement, activated, mana | This land enters tapped unless you control a Plains or an Island. / {T}: Add {W} or {U}. |
| Isolated Chapel | Land | 9 | replacement, activated, mana | This land enters tapped unless you control a Plains or a Swamp. / {T}: Add {W} or {B}. |
| Prairie Stream | Land — Plains Island | 9 | replacement, activated, mana | / This land enters tapped unless you control two or more basic lands. |
| Thriving Heath | Land | 9 | replacement, activated, mana | This land enters tapped. As it enters, choose a color other than white. / {T}: Add {W} or one mana of the chosen color. |
| Thriving Isle [spec] | Land | 9 | replacement, activated, mana | This land enters tapped. As it enters, choose a color other than blue. / {T}: Add {U} or one mana of the chosen color. |
| Thriving Moor | Land | 9 | replacement, activated, mana | This land enters tapped. As it enters, choose a color other than black. / {T}: Add {B} or one mana of the chosen color. |
| Zur, Eternal Schemer | Legendary Creature — Human Wizard | 9 | layers, activated, targets | Flying / Enchantment creatures you control have deathtouch, lifelink, and hexproof. / {1}{W}: Target non-Aura enchantment you control becomes a creature in addition to its other types and has base power and base toughness each ... |
| Monologue Tax | Enchantment | 8 | trigger-scope, multiplayer, tokens | Whenever an opponent casts their second spell each turn, you create a Treasure token. |
| Mystic Remora [spec] | Enchantment | 8 | trigger-scope, multiplayer, counters | Cumulative upkeep {1} / Whenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}. |

## Batch 3 (risk 8 down to 6)

| Card | Type | Score | Tags | Oracle text (abridged) |
|---|---|---|---|---|
| Sphere of Safety | Enchantment | 8 | layers, xmodes | Creatures can't attack you or planeswalkers you control unless their controller pays {X} for each of those creatures, where X is the number of enchantments you control. |
| Aminatou, the Fateshifter | Legendary Planeswalker — Aminatou | 7 | library, targets, multiplayer | +1: Draw a card, then put a card from your hand on top of your library. / −1: Exile another target permanent you own, then return it to the battlefield under your control. / −6: Choose left or right. Each player gains control o... |
| Devastation Tide | Sorcery | 7 | delayed, xmodes | Return all nonland permanents to their owners' hands. / Miracle {1}{U} |
| Moon-Blessed Cleric | Creature — Human Elf Cleric | 7 | trigger-scope, library | Divine Intervention — When this creature enters, you may search your library for an enchantment card, reveal it, then shuffle and put that card on top. |
| Obscura Storefront | Land | 7 | trigger-scope, library | When this land enters, sacrifice it. When you do, search your library for a basic Plains, Island, or Swamp card, put it onto the battlefield tapped, then shuffle and you gain 1 life. |
| One with the Multiverse | Enchantment | 7 | layers, library | You may look at the top card of your library any time. / You may play lands and cast spells from the top of your library. / Once during each of your turns, you may cast a spell from your hand or the top of your library without ... |
| Otherworldly Gaze | Instant | 7 | xmodes, library | Surveil 3. / Flashback {1}{U} |
| Redress Fate | Sorcery | 7 | delayed, xmodes | Return all artifact and enchantment cards from your graveyard to the battlefield. / Miracle {3}{W} |
| Temporal Mastery | Sorcery | 7 | delayed, xmodes | Take an extra turn after this one. Exile Temporal Mastery. / Miracle {1}{U} |
| Utter Insignificance | Enchantment — Aura | 7 | layers, activated | Flash / Enchant creature / Enchanted creature loses all abilities and has base power and toughness 1/1. / {2}{C}: Exile enchanted creature. |
| Archon of Sun's Grace | Creature — Archon | 6 | trigger-scope, tokens | Flying / Lifelink / Pegasus creatures you control have lifelink. / Constellation — Whenever an enchantment you control enters, create a 2/2 white Pegasus creature token with flying. |
| Callaphe, Beloved of the Sea | Legendary Enchantment Creature — Demigod | 6 | layers, targets | Callaphe's power is equal to your devotion to blue. / Creatures and enchantments you control have "Spells your opponents cast that target this permanent cost {1} more to cast." |
| Enhanced Surveillance | Enchantment | 6 | library, activated | You may look at an additional two cards each time you surveil. / Exile this enchantment: Shuffle your graveyard into your library. |
| Evolving Wilds | Land | 6 | library, activated | {T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. |
| Ledger Shredder | Creature — Bird Advisor | 6 | trigger-scope, counters | Flying / Whenever a player casts their second spell each turn, this creature connives. |

## Batch 4 (risk 6 down to 4)

| Card | Type | Score | Tags | Oracle text (abridged) |
|---|---|---|---|---|
| Overwhelming Splendor | Enchantment — Aura Curse | 6 | layers, counters | Enchant player / Creatures enchanted player controls lose all abilities and have base power and toughness 1/1. / Enchanted player can't activate abilities that aren't mana abilities or loyalty abilities. |
| Sigil of the Empty Throne | Enchantment | 6 | trigger-scope, tokens | Whenever you cast an enchantment spell, create a 4/4 white Angel creature token with flying. |
| Soaring Lightbringer | Enchantment Creature — Bird Glimmer | 6 | layers, tokens | Flying / Other enchantment creatures you control have flying. / Whenever you attack a player, create a 1/1 white Glimmer enchantment creature token that's tapped and attacking that player. |
| Starfield of Nyx | Enchantment | 6 | layers, targets | At the beginning of your upkeep, you may return target enchantment card from your graveyard to the battlefield. / As long as you control five or more enchantments, each other non-Aura enchantment you control is a creature in ad... |
| Void Rend | Instant | 6 | layers, targets | This spell can't be countered. / Destroy target nonland permanent. |
| Wayfarer's Bauble | Artifact | 6 | library, activated | {2}, {T}, Sacrifice this artifact: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle. |
| Arcane Denial | Instant | 5 | delayed, targets | Counter target spell. Its controller may draw up to two cards at the beginning of the next turn's upkeep. / You draw a card at the beginning of the next turn's upkeep. |
| Doomwake Giant | Enchantment Creature — Giant | 5 | delayed, multiplayer | Constellation — Whenever this creature or another enchantment you control enters, creatures your opponents control get -1/-1 until end of turn. |
| Estrid's Invocation | Enchantment | 5 | copy | You may have this enchantment enter as a copy of an enchantment you control, except it has "At the beginning of your upkeep, you may exile this enchantment. If you do, return it to the battlefield under its owner's control." |
| Virtue of Persistence | Enchantment // Sorcery — Adventure | 5 | delayed, targets | Virtue of Persistence: At the beginning of your upkeep, put target creature card from a graveyard onto the battlefield under your control. / / Locthwain Scorn: Target creature gets -3/-3 until end of turn. You gain 2 life. |
| Adarkar Wastes | Land | 4 | activated, mana | {T}: Add {C}. / {T}: Add {W} or {U}. This land deals 1 damage to you. |
| Arcane Signet | Artifact | 4 | activated, mana | {T}: Add one mana of any color in your commander's color identity. |
| Caves of Koilos | Land | 4 | activated, mana | {T}: Add {C}. / {T}: Add {W} or {B}. This land deals 1 damage to you. |
| Command Tower | Land | 4 | activated, mana | {T}: Add one mana of any color in your commander's color identity. |
| Inquisitive Glimmer | Enchantment Creature — Fox Glimmer | 4 | layers | Enchantment spells you cast cost {1} less to cast. / Unlock costs you pay cost {1} less. |

## Batch 5 (risk 4 down to 3)

| Card | Type | Score | Tags | Oracle text (abridged) |
|---|---|---|---|---|
| Omniscience [spec] | Enchantment | 4 | layers | You may cast spells from your hand without paying their mana costs. |
| Propaganda | Enchantment | 4 | layers | Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you. |
| Sol Ring | Artifact | 4 | activated, mana | {T}: Add {C}{C}. |
| Tainted Field | Land | 4 | activated, mana | {T}: Add {C}. / {T}: Add {W} or {B}. Activate only if you control a Swamp. |
| Talisman of Dominance | Artifact | 4 | activated, mana | {T}: Add {C}. / {T}: Add {U} or {B}. This artifact deals 1 damage to you. |
| Talisman of Hierarchy | Artifact | 4 | activated, mana | {T}: Add {C}. / {T}: Add {W} or {B}. This artifact deals 1 damage to you. |
| Talisman of Progress | Artifact | 4 | activated, mana | {T}: Add {C}. / {T}: Add {W} or {U}. This artifact deals 1 damage to you. |
| Underground River | Land | 4 | activated, mana | {T}: Add {C}. / {T}: Add {U} or {B}. This land deals 1 damage to you. |
| Brainstorm | Instant | 3 | library | Draw three cards, then put two cards from your hand on top of your library in any order. |
| Brainsurge | Instant | 3 | library | Draw four cards, then put two cards from your hand on top of your library in any order. |
| Diabolic Vision | Sorcery | 3 | library | Look at the top five cards of your library. Put one of them into your hand and the rest on top of your library in any order. |
| Greed | Enchantment | 3 | activated | {B}, Pay 2 life: Draw a card. |
| Lim-Dûl's Vault | Instant | 3 | library | Look at the top five cards of your library. As many times as you choose, you may pay 1 life, put those cards on the bottom of your library in any order, then look at the top five cards of your library. Then shuffle and put the ... |
| Ponder | Sorcery | 3 | library | Look at the top three cards of your library, then put them back in any order. You may shuffle. / Draw a card. |
| Shadow of the Second Sun | Enchantment — Aura | 3 | delayed | Enchant player / At the beginning of each of enchanted player's postcombat main phases, there is an additional beginning phase after this phase. |

## Batch 6 (lowest risk)

| Card | Type | Score | Tags | Oracle text (abridged) |
|---|---|---|---|---|
| Vanishing | Enchantment — Aura | 3 | activated | Enchant creature / {U}{U}: Enchanted creature phases out. |
| Blasphemous Edict | Sorcery | 2 | multiplayer | You may pay {B} rather than pay this spell's mana cost if there are thirteen or more creatures on the battlefield. / Each player sacrifices thirteen creatures of their choice. |
| Boon of the Spirit Realm | Enchantment | 2 | counters | Constellation — Whenever this enchantment or another enchantment you control enters, put a blessing counter on this enchantment. / Creatures you control get +1/+1 for each blessing counter on this enchantment. |
| Counterspell | Instant | 2 | targets | Counter target spell. |
| Debtors' Knell | Enchantment | 2 | targets | / At the beginning of your upkeep, put target creature card from a graveyard onto the battlefield under your control. |
| Negate | Instant | 2 | targets | Counter target noncreature spell. |
| Swords to Plowshares | Instant | 2 | targets | Exile target creature. Its controller gains life equal to its power. |
| Utter End | Instant | 2 | targets | Exile target nonland permanent. |
| Island | Basic Land — Island | 0 | activated, mana |  |
| Plains | Basic Land — Plains | 0 | activated, mana |  |
| Swamp | Basic Land — Swamp | 0 | activated, mana |  |
| Timely Ward | Enchantment — Aura | 0 | - | You may cast this spell as though it had flash if it targets a commander. / Enchant creature / Enchanted creature has indestructible. |

## Notes on the classification

- The classifier is keyword based (regexes over the oracle text in data/cards.db); it over-rates scry lands (enters tapped + trigger + library) and under-rates plain-looking cards with a subtle scope ("an opponent", "first spell each turn"). Treat the order as a starting point and move a card up when its text has a rule that has already been wrong in play (opponent-scoped triggers, "unless pays", Aura / loses-all-abilities interactions, Rooms, free casts, token replacement, chosen colours, manual payment).
- Cards already covered by an example spec: Mystic Remora, Archaeomancer's Map, Omniscience, Secret Arcade, Thriving Isle (Heath / Moor are the same pattern: copy the file, change the colours), and Lightning Bolt / Chatterfang / Utter Insignificance / Plaguecrafter (not in the deck's list or shown for the format only).
- Spec each batch with `docs/card-spec-writer-brief.md`, run `npm run kernel:spec -- --deck Aminatou`, triage with `docs/card-spec-triage.md`.
