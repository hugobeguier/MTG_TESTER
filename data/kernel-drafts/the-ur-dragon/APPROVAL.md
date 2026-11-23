# Kernel draft approval: The Ur-Dragon

96 unique cards: 32 simple (A), 64 complex (B). Validator: 96/96 pass. Cards with implementation "needed": 90. All drafts are `review.status: "draft"`; nothing was written to the DB.

Reading guide: each card below shows the oracle text and what the structured JSON says back in plain English. Approve if they match.

## (A) Simple cards: spot-check one line each

- **Dragonlord Dromoka** (Legendary Creature — Elder Dragon): Dragonlord Dromoka can't be countered | Keyword flying | Keyword lifelink | Each opponent can't cast spells as long as it is your turn [needs: static, zone:stack]
- **Rhythm of the Wild** (Enchantment): Creature spells you control can't be countered | Nontoken creatures you control have riot [needs: static]
- **Temur Ascendancy** (Enchantment): Creatures you control have haste | Whenever a creature with power 4 or greater you control enters: You may draw a card [needs: static, trigger:subject]
- **Ureni of the Unwritten** (Legendary Creature — Spirit Dragon): Keyword flying | Keyword trample | Whenever Ureni of the Unwritten enters or attacks: Look at the top eight cards of your library, then you may choose a Dragon card from among the looked-at cards, then put the chosen object onto the battlefield, then put the rest of the looked-at cards on the bottom of your library in a random order [needs: trigger:multi_event, step:look_top, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, field:move_card_zone.order, field:move_card_zone.position, field:move_card_zone.what]
- **Two-Headed Hellkite** (Creature — Dragon): Keyword flying | Keyword menace | Keyword haste | Whenever Two-Headed Hellkite attacks: Draw 2 cards [implemented]
- **Wrathful Red Dragon** (Creature — Dragon): Keyword flying | Whenever a Dragon you control is dealt damage: [targets: target] That object deals that many damage to target [needs: filter:notSubtypes, trigger:dealt_damage, trigger:subject, quantity:event_amount, field:damage_target.source]
- **Farseek** (Sorcery): Search your library for a Plains, Island, Swamp, or Mountain, put it onto the battlefield, then shuffle [needs: step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to]
- **Yavimaya, Cradle of Growth** (Legendary Land): Lands are forests in addition to their other types [needs: static, static:addTypes]
- **Reliquary Tower** (Land): You have no maximum hand size | {T}: add {C} [needs: static]
- **Cascading Cataracts** (Land): Keyword indestructible | {T}: add {C} | {5}, {T}: add five mana of any one color [needs: mana:variable]
- **Command Tower** (Land): {T}: add one mana of any color in your commander's color identity [needs: mana:variable]
- **Evolving Wilds** (Land): {T}, sacrifice Evolving Wilds: Search your library for a basic land, put it onto the battlefield, then shuffle [needs: cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to]
- **Terramorphic Expanse** (Land): {T}, sacrifice Terramorphic Expanse: Search your library for a basic land, put it onto the battlefield, then shuffle [needs: cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to]
- **Caves of Koilos** (Land): {T}: add {C} | {T}: add {W} | {T}: add {B} [needs: field:damage_target.source]
- **Adarkar Wastes** (Land): {T}: add {C} | {T}: add {W} | {T}: add {U} [needs: field:damage_target.source]
- **Underground River** (Land): {T}: add {C} | {T}: add {U} | {T}: add {B} [needs: field:damage_target.source]
- **Temple of Deceit** (Land): If Temple of Deceit would enter, it enters tapped | Whenever Temple of Deceit enters: Scry 1 | {T}: add {U} | {T}: add {B} [needs: replacement:would_enter, step:scry]
- **Temple of Silence** (Land): If Temple of Silence would enter, it enters tapped | Whenever Temple of Silence enters: Scry 1 | {T}: add {W} | {T}: add {B} [needs: replacement:would_enter, step:scry]
- **Dragon's Hoard** (Artifact): Whenever a Dragon you control enters: Put a gold counter on Dragon's Hoard | {T}, remove a gold counter from Dragon's Hoard: Draw a card | {T}: add one mana of any color [needs: trigger:subject, step:add_counters, field:add_counters.on, cost:counters, mana:variable]
- **Dragonspeaker Shaman** (Creature — Human Barbarian Shaman): Dragon spells you cast cost {2} less to cast [needs: static]
- **Dragonlord's Servant** (Creature — Goblin Shaman): Dragon spells you cast cost {1} less to cast [needs: static]
- **Utvara Hellkite** (Creature — Dragon): Keyword flying | Whenever a Dragon you control attacks: Create a 6/6 red Dragon creature token with flying [needs: trigger:subject, field:create_tokens.tokenKeywords]
- **Dragonstorm Globe** (Artifact): If a Dragon you control would enter, also: put a +1/+1 counter on that object | {T}: add one mana of any color [needs: replacement:would_enter, step:add_counters, field:add_counters.on, mana:variable]
- **Sarkhan's Triumph** (Instant): Search your library for a Dragon, put it onto your hand, then shuffle [needs: step:search_library, field:search_library.count, field:search_library.filter, field:search_library.reveal, field:search_library.shuffle, field:search_library.to]
- **Bojuka Bog** (Land): If Bojuka Bog would enter, it enters tapped | Whenever Bojuka Bog enters: [targets: target player] Exile a card | {T}: add {B} [needs: replacement:would_enter, field:move_card_zone.what]
- **Rogue's Passage** (Land): {T}: add {C} | {4}, {T}: [targets: target creature] Target creature can't be blocked until end of turn [needs: step:grant_effect, field:grant_effect.modify]
- **War Room** (Land): {T}: add {C} | {3}, {T}, pay life equal to the number of colors in your commanders' color identity: Draw a card [needs: cost:life]
- **Swamp** (Basic Land — Swamp): {T}: add {B} [implemented]
- **Forest** (Basic Land — Forest): {T}: add {G} [implemented]
- **Mountain** (Basic Land — Mountain): {T}: add {R} [implemented]
- **Island** (Basic Land — Island): {T}: add {U} [implemented]
- **Plains** (Basic Land — Plains): {T}: add {W} [implemented]

## (B) Complex cards

### The Ur-Dragon

Type: Legendary Creature — Dragon Avatar

Oracle text:

> Eminence — As long as The Ur-Dragon is in the command zone or on the battlefield, other Dragon spells you cast cost {1} less to cast.
> Flying
> Whenever one or more Dragons you control attack, draw that many cards, then you may put a permanent card from your hand onto the battlefield.

Re-rendered plain English:

```
The Ur-Dragon [draft]
  [a1] static (from command) [needed: needs static, zone:command]
    Oracle: Eminence — As long as The Ur-Dragon is in the command zone or on the battlefield, other Dragon spells you cast cost {1} less to cast.
    Static: Other Dragon spells you cast cost {1} less to cast as long as The Ur-Dragon is on battlefield or you have 1 or greater permanents named The Ur-Dragon in command
  [a2] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a3] triggered [needed: needs trigger:batch, trigger:subject, quantity:event_amount, field:move_card_zone.filter, field:move_card_zone.from, field:move_card_zone.what]
    Oracle: Whenever one or more Dragons you control attack, draw that many cards, then you may put a permanent card from your hand onto the battlefield.
    Trigger: Whenever one or more Dragons you control attack
    Effect: Draw that many cards. Then, you may put a card onto the battlefield.
  [a4] static [needed: needs static]
    Oracle: Eminence — As long as The Ur-Dragon is in the command zone or on the battlefield, other Dragon spells you cast cost {1} less to cast.
    Static: Other Dragon spells you cast cost {1} less to cast as long as The Ur-Dragon is on battlefield
```

Player prompts:

- The Ur-Dragon: optional: Do you want to put a card onto the battlefield?

Implementation: needed (static, zone:command, trigger:batch, trigger:subject, quantity:event_amount, field:move_card_zone.filter, field:move_card_zone.from, field:move_card_zone.what)

Questions for you:

- Eminence: 'in the command zone or on the battlefield' is a static `while` of source_state on_battlefield OR a command-zone zone_count of the card itself. The schema has no way to say an ability works from two zones, so this is how the command-zone half is expressed.

### Mox Jasper

Type: Legendary Artifact

Oracle text:

> {T}: Add one mana of any color. Activate only if you control a Dragon.

Re-rendered plain English:

```
Mox Jasper [draft]
  [a1] mana [needed: needs mana:variable, timing]
    Oracle: {T}: Add one mana of any color. Activate only if you control a Dragon.
    Cost: {T}
    Timing: you control a Dragon
    Mana: add one mana of any color
```

Player prompts:

- (none: no decisions)

Implementation: needed (mana:variable, timing)

### Urza's Incubator

Type: Artifact

Oracle text:

> As this artifact enters, choose a creature type.
> Creature spells of the chosen type cost {2} less to cast.

Re-rendered plain English:

```
Urza's Incubator [draft]
  [a1] replacement [needed: needs replacement:would_enter, step:choose, field:choose.choice, field:choose.remember, field:choose.saveAs, field:choose.what]
    Oracle: As this artifact enters, choose a creature type.
    Replacement: If Urza's Incubator would enter, also: choose a creature type
  [a2] static [needed: needs static, filter:chosenType]
    Oracle: Creature spells of the chosen type cost {2} less to cast.
    Static: Creature spells of the chosen type you cast cost {2} less to cast
```

Player prompts:

- Urza's Incubator: choose: Choose a creature type.

Implementation: needed (replacement:would_enter, step:choose, field:choose.choice, field:choose.remember, field:choose.saveAs, field:choose.what, static, filter:chosenType)

### Savage Ventmaw

Type: Creature — Dragon

Oracle text:

> Flying
> Whenever this creature attacks, add {R}{R}{R}{G}{G}{G}. Until end of turn, you don't lose this mana as steps and phases end.

Re-rendered plain English:

```
Savage Ventmaw [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs step:add_mana, field:add_mana.produces]
    Oracle: Whenever this creature attacks, add {R}{R}{R}{G}{G}{G}. Until end of turn, you don't lose this mana as steps and phases end.
    Trigger: Whenever Savage Ventmaw attacks
    Effect: Add {R}{R}{R}{G}{G}{G}.
```

Player prompts:

- (none: no decisions)

Implementation: needed (step:add_mana, field:add_mana.produces)

### Dracogenesis

Type: Enchantment

Oracle text:

> You may cast Dragon spells without paying their mana costs.

Re-rendered plain English:

```
Dracogenesis [draft]
  [a1] scripted [needed: needs scripted:cast_without_paying_mana_cost]
    Oracle: You may cast Dragon spells without paying their mana costs.
    Scripted (engine-specific rule, not described by the fields above): cast_without_paying_mana_cost
    (optional: Do you want to use this ability?)
```

Player prompts:

- Dracogenesis: optional: Do you want to use this ability?

Implementation: needed (scripted:cast_without_paying_mana_cost)

Questions for you:

- 'Cast Dragon spells without paying their mana costs' is a scripted marker; the schema has no static modifier for a free-cast permission on other cards' spells (castOptions only describe the card's own casting).

### Goldspan Dragon

Type: Creature — Dragon

Oracle text:

> Flying, haste
> Whenever this creature attacks or becomes the target of a spell, create a Treasure token.
> Treasures you control have "{T}, Sacrifice this artifact: Add two mana of any one color."

Re-rendered plain English:

```
Goldspan Dragon [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] keyword [implemented]
    Oracle: Haste
    Keyword: haste
  [a3] triggered [needed: needs trigger:multi_event, trigger:becomes_target]
    Oracle: Whenever this creature attacks or becomes the target of a spell, create a Treasure token.
    Trigger: Whenever Goldspan Dragon attacks or becomes the target of a spell or ability
    Effect: Create a ?/? colorless Treasure artifact token.
  [a4] static [needed: needs static]
    Oracle: Treasures you control have "{T}, Sacrifice this artifact: Add two mana of any one color."
    Static: Treasures you control have an ability
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:multi_event, trigger:becomes_target, static)

Questions for you:

- 'Becomes the target of a spell' (not an ability) has no field on the becomes_target trigger; written as plain becomes_target self.
- 'Two mana of any one color' is written {anyColor:2} (any combination); the schema has no 'all the same color' flag on ManaSpec.

### Balefire Dragon

Type: Creature — Dragon

Oracle text:

> Flying
> Whenever this creature deals combat damage to a player, it deals that much damage to each creature that player controls.

Re-rendered plain English:

```
Balefire Dragon [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs quantity:event_amount, field:damage_target.all, field:damage_target.filter, field:damage_target.source, field:damage_target.who]
    Oracle: Whenever this creature deals combat damage to a player, it deals that much damage to each creature that player controls.
    Trigger: Whenever Balefire Dragon deals combat damage to a player
    Effect: Balefire Dragon deals that many damage to the target.
```

Player prompts:

- (none: no decisions)

Implementation: needed (quantity:event_amount, field:damage_target.all, field:damage_target.filter, field:damage_target.source, field:damage_target.who)

Questions for you:

- 'Each creature that player controls' is written as a damage_target all:true with who:'that_player' plus a creature filter (the filter has no 'controlled by that player' value).

### Ancient Copper Dragon

Type: Creature — Elder Dragon

Oracle text:

> Flying
> Whenever this creature deals combat damage to a player, roll a d20. You create a number of Treasure tokens equal to the result.

Re-rendered plain English:

```
Ancient Copper Dragon [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs scripted:roll_d20_result_is_X, quantity:X]
    Oracle: Whenever this creature deals combat damage to a player, roll a d20. You create a number of Treasure tokens equal to the result.
    Trigger: Whenever Ancient Copper Dragon deals combat damage to a player
    Effect: Create X ?/? colorless Treasure artifact tokens.
    Scripted (engine-specific rule, not described by the fields above): roll_d20_result_is_X
```

Player prompts:

- (none: no decisions)

Implementation: needed (scripted:roll_d20_result_is_X, quantity:X)

Questions for you:

- Rolling dice has no step kind or Quantity: the ability carries a scripted marker roll_d20_result_is_X and the roll result is bound to X (same on Ancient Silver/Gold/Brass Dragon).

### Call the Spirit Dragons

Type: Enchantment

Oracle text:

> Dragons you control have indestructible.
> At the beginning of your upkeep, for each color, put a +1/+1 counter on a Dragon you control of that color. If you put +1/+1 counters on five Dragons this way, you win the game.

Re-rendered plain English:

```
Call the Spirit Dragons [draft]
  [a1] static [needed: needs static]
    Oracle: Dragons you control have indestructible.
    Static: Dragons you control have indestructible
  [a2] triggered [needed: needs scripted:one_counter_per_color_on_distinct_dragons_win_if_five]
    Oracle: At the beginning of your upkeep, for each color, put a +1/+1 counter on a Dragon you control of that color. If you put +1/+1 counters on five Dragons this way, you win the game.
    Trigger: At the beginning of your upkeep
    Scripted (engine-specific rule, not described by the fields above): one_counter_per_color_on_distinct_dragons_win_if_five
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, scripted:one_counter_per_color_on_distinct_dragons_win_if_five)

Questions for you:

- 'For each color, put a counter on a Dragon of that color' and the 'if five Dragons, you win the game' clause have no vocabulary (no win_game step, no iterate-over-colors); a scripted marker carries the win threshold and the counter step is a simplified repeat_for_each.

### Klauth, Unrivaled Ancient

Type: Legendary Creature — Dragon

Oracle text:

> Flying, haste
> Whenever Klauth attacks, add X mana in any combination of colors, where X is the total power of attacking creatures. Spend this mana only to cast spells. Until end of turn, you don't lose this mana as steps and phases end.

Re-rendered plain English:

```
Klauth, Unrivaled Ancient [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] keyword [implemented]
    Oracle: Haste
    Keyword: haste
  [a3] triggered [needed: needs step:add_mana, quantity:sum, field:add_mana.produces]
    Oracle: Whenever Klauth attacks, add X mana in any combination of colors, where X is the total power of attacking creatures. Spend this mana only to cast spells. Until end of turn, you don't lose this mana as steps and phases end.
    Trigger: Whenever Klauth, Unrivaled Ancient attacks
    Effect: Add one mana of any color (spend only to cast a spell).
```

Player prompts:

- (none: no decisions)

Implementation: needed (step:add_mana, quantity:sum, field:add_mana.produces)

### Morophon, the Boundless

Type: Legendary Creature — Shapeshifter

Oracle text:

> Changeling (This card is every creature type.)
> As Morophon enters, choose a creature type.
> Spells of the chosen type you cast cost {W}{U}{B}{R}{G} less to cast. This effect reduces only the amount of colored mana you pay.
> Other creatures you control of the chosen type get +1/+1.

Re-rendered plain English:

```
Morophon, the Boundless [draft]
  [a1] keyword [implemented]
    Oracle: Changeling (This card is every creature type.)
    Keyword: changeling
  [a2] replacement [needed: needs replacement:would_enter, step:choose, field:choose.choice, field:choose.remember, field:choose.saveAs, field:choose.what]
    Oracle: As Morophon enters, choose a creature type.
    Replacement: If Morophon, the Boundless would enter, also: choose a creature type
  [a3] static [needed: needs scripted:cost_reduction_colored_mana_only, static, filter:chosenType, static:costMod_quantity]
    Oracle: Spells of the chosen type you cast cost {W}{U}{B}{R}{G} less to cast. This effect reduces only the amount of colored mana you pay.
    Scripted (engine-specific rule, not described by the fields above): cost_reduction_colored_mana_only
    Static: Spells of the chosen type you cast cost {X}, where X is the greater of -5, more to cast
  [a4] static [needed: needs static, filter:chosenType]
    Oracle: Other creatures you control of the chosen type get +1/+1.
    Static: Other creatures of the chosen type you control get +1/+1
```

Player prompts:

- Morophon, the Boundless: choose: Choose a creature type.

Implementation: needed (replacement:would_enter, step:choose, field:choose.choice, field:choose.remember, field:choose.saveAs, field:choose.what, scripted:cost_reduction_colored_mana_only, static, filter:chosenType, static:costMod_quantity)

Questions for you:

- {W}{U}{B}{R}{G} cost reduction affecting only colored mana: costMod.delta is a number, so the colored-only rule is a scripted marker (delta -5 is a stand-in).

### Tiamat

Type: Legendary Creature — Dragon God

Oracle text:

> Flying
> When Tiamat enters, if you cast it, search your library for up to five Dragon cards not named Tiamat that each have different names, reveal them, put them into your hand, then shuffle.

Re-rendered plain English:

```
Tiamat [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:intervening_if, predicate:stat, step:search_library, field:search_library.count, field:search_library.distinctNames, field:search_library.excludeNamed, field:search_library.filter, field:search_library.min, field:search_library.reveal, field:search_library.shuffle, field:search_library.to, field:search_library.upTo]
    Oracle: When Tiamat enters, if you cast it, search your library for up to five Dragon cards not named Tiamat that each have different names, reveal them, put them into your hand, then shuffle.
    Trigger: Whenever Tiamat enters, if Tiamat's was cast is 1
    Effect: Search your library for a Dragon, put it onto your hand, then shuffle.
```

Player prompts:

- Tiamat: search: Choose a Dragon from the library.

Implementation: needed (trigger:intervening_if, predicate:stat, step:search_library, field:search_library.count, field:search_library.distinctNames, field:search_library.excludeNamed, field:search_library.filter, field:search_library.min, field:search_library.reveal, field:search_library.shuffle, field:search_library.to, field:search_library.upTo)

Questions for you:

- 'If you cast it' is a stat predicate was_cast (no dedicated predicate). 'Not named Tiamat' and 'each have different names' are the step fields excludeNamed and distinctNames (ObjectFilter has no notNamed).

### Crux of Fate

Type: Sorcery

Oracle text:

> Choose one —
> • Destroy all Dragon creatures.
> • Destroy all non-Dragon creatures.

Re-rendered plain English:

```
Crux of Fate [draft]
  [a1] spell_effect [needed: needs modes, filter:notSubtypes, field:destroy_all.filter]
    Oracle: Choose one — / • Destroy all Dragon creatures. / • Destroy all non-Dragon creatures.
    Modes: choose 1  <- prompt: "Choose one mode."
      - Destroy each Dragon.
      - Destroy each non-Dragon creature.
```

Player prompts:

- Crux of Fate: choose a mode: Choose one mode.

Implementation: needed (modes, filter:notSubtypes, field:destroy_all.filter)

### Scion of Draco

Type: Artifact Creature — Dragon

Oracle text:

> Domain — This spell costs {2} less to cast for each basic land type among lands you control.
> Flying
> Each creature you control has vigilance if it's white, hexproof if it's blue, lifelink if it's black, first strike if it's red, and trample if it's green.

Re-rendered plain English:

```
Scion of Draco [draft]
  [a1] cast_option [needed: needs scripted:domain_count_distinct_basic_land_types, cast_option, cost_reduction, cost_reduction:variable]
    Oracle: Domain — This spell costs {2} less to cast for each basic land type among lands you control.
    Scripted (engine-specific rule, not described by the fields above): domain_count_distinct_basic_land_types
    Cost reduction: this ability costs {X}, where X is the greater of 2, less for each land with a basic land type you control
  [a2] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a3] static [needed: needs static]
    Oracle: Each creature you control has vigilance if it's white, hexproof if it's blue, lifelink if it's black, first strike if it's red, and trample if it's green.
    Static: Creatures you control have vigilance and have hexproof and have lifelink and have first strike and have trample
```

Player prompts:

- (none: no decisions)

Implementation: needed (scripted:domain_count_distinct_basic_land_types, cast_option, cost_reduction, cost_reduction:variable, static)

Questions for you:

- Domain (distinct basic land types) cannot be counted by a costReduction.per filter; the scripted marker domain_count_distinct_basic_land_types makes it count distinct types. Per-color keyword grants ('vigilance if white, hexproof if blue...') have no conditional grant: the five grants are listed without their color gates.

### Sarkhan, Soul Aflame

Type: Legendary Creature — Human Shaman

Oracle text:

> Dragon spells you cast cost {1} less to cast.
> Whenever a Dragon you control enters, you may have Sarkhan become a copy of it until end of turn, except its name is Sarkhan, Soul Aflame and it's legendary in addition to its other types.

Re-rendered plain English:

```
Sarkhan, Soul Aflame [draft]
  [a1] static [needed: needs static]
    Oracle: Dragon spells you cast cost {1} less to cast.
    Static: Dragon spells you cast cost {1} less to cast
  [a2] triggered [needed: needs trigger:subject, step:copy, field:copy.exceptAddTypes, field:copy.exceptName, field:copy.of]
    Oracle: Whenever a Dragon you control enters, you may have Sarkhan become a copy of it until end of turn, except its name is Sarkhan, Soul Aflame and it's legendary in addition to its other types.
    Trigger: Whenever a Dragon you control enters
    Effect: You may copy Sarkhan, Soul Aflame.
```

Player prompts:

- Sarkhan, Soul Aflame: optional: Do you want to Sarkhan, Soul Aflame is a copy of that object and becomes a legendary in addition to its other types until end of turn?

Implementation: needed (static, trigger:subject, step:copy, field:copy.exceptAddTypes, field:copy.exceptName, field:copy.of)

### Rivaz of the Claw

Type: Legendary Creature — Lizard Warlock

Oracle text:

> Menace
> {T}: Add two mana in any combination of colors. Spend this mana only to cast Dragon creature spells.
> Once during each of your turns, you may cast a Dragon creature spell from your graveyard.
> Whenever you cast a Dragon creature spell from your graveyard, it gains "When this creature dies, exile it."

Re-rendered plain English:

```
Rivaz of the Claw [draft]
  [a1] keyword [implemented]
    Oracle: Menace
    Keyword: menace
  [a2] mana [needed: needs mana:variable, mana:restriction]
    Oracle: {T}: Add two mana in any combination of colors. Spend this mana only to cast Dragon creature spells.
    Cost: {T}
    Mana: add two mana of any one color (spend only to cast a creature Dragon spell)
  [a3] scripted [needed: needs scripted:cast_from_graveyard_permission, timing, predicate:turn_is]
    Oracle: Once during each of your turns, you may cast a Dragon creature spell from your graveyard.
    Timing: 1 per turn; it is your turn
    Scripted (engine-specific rule, not described by the fields above): cast_from_graveyard_permission
    (optional: Do you want to use this ability?)
  [a4] triggered [needed: needs trigger:intervening_if, predicate:cast_from, step:grant_effect, field:grant_effect.modify]
    Oracle: Whenever you cast a Dragon creature spell from your graveyard, it gains "When this creature dies, exile it."
    Trigger: Whenever you cast a creature Dragon spell, if it was cast from graveyard
    Effect: That object gains an ability.
```

Player prompts:

- Rivaz of the Claw: optional: Do you want to use this ability?

Implementation: needed (mana:variable, mana:restriction, scripted:cast_from_graveyard_permission, timing, predicate:turn_is, trigger:intervening_if, predicate:cast_from, step:grant_effect, field:grant_effect.modify)

Questions for you:

- 'May cast a Dragon creature spell from your graveyard once each turn' is a scripted permission marker (castOptions only describe the card's own casting).

### Silumgar, the Drifting Death

Type: Legendary Creature — Dragon

Oracle text:

> Flying, hexproof
> Whenever a Dragon you control attacks, creatures defending player controls get -1/-1 until end of turn.

Re-rendered plain English:

```
Silumgar, the Drifting Death [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] keyword [implemented]
    Oracle: Hexproof
    Keyword: hexproof
  [a3] triggered [needed: needs trigger:subject, field:mass_pump.filter, field:mass_pump.who]
    Oracle: Whenever a Dragon you control attacks, creatures defending player controls get -1/-1 until end of turn.
    Trigger: Whenever a Dragon you control attacks
    Effect: All creatures get -1/-1 until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:subject, field:mass_pump.filter, field:mass_pump.who)

Questions for you:

- 'Creatures defending player controls' is written who:'that_player' (the defending player); PlayerRef has no defending_player value.

### Bladewing the Risen

Type: Legendary Creature — Zombie Dragon

Oracle text:

> Flying
> When Bladewing enters, you may return target Dragon permanent card from your graveyard to the battlefield.
> {B}{R}: Dragon creatures get +1/+1 until end of turn.

Re-rendered plain English:

```
Bladewing the Risen [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [implemented]
    Oracle: When Bladewing enters, you may return target Dragon permanent card from your graveyard to the battlefield.
    Trigger: Whenever Bladewing the Risen enters
    Target t1: target Dragon card in your graveyard  <- prompt: "Choose target Dragon card in your graveyard."
    Effect: You may return target Dragon card in your graveyard from the graveyard to the battlefield.
  [a3] activated [needed: needs field:mass_pump.filter]
    Oracle: {B}{R}: Dragon creatures get +1/+1 until end of turn.
    Cost: {B}{R}
    Effect: All creatures get +1/+1 until end of turn.
```

Player prompts:

- Bladewing the Risen: choose a target: Choose target Dragon card in your graveyard.
- Bladewing the Risen: optional: Do you want to return target Dragon card in your graveyard from the graveyard to the battlefield?

Implementation: needed (field:mass_pump.filter)

### Scalelord Reckoner

Type: Creature — Dragon

Oracle text:

> Flying
> Whenever a Dragon you control becomes the target of a spell or ability an opponent controls, destroy target nonland permanent that player controls.

Re-rendered plain English:

```
Scalelord Reckoner [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:becomes_target, trigger:subject]
    Oracle: Whenever a Dragon you control becomes the target of a spell or ability an opponent controls, destroy target nonland permanent that player controls.
    Trigger: Whenever a Dragon you control becomes the target of a spell or ability
    Target t1: target nonland permanent an opponent controls  <- prompt: "Choose target nonland permanent an opponent controls."
    Effect: Destroy target nonland permanent an opponent controls.
```

Player prompts:

- Scalelord Reckoner: choose a target: Choose target nonland permanent an opponent controls.

Implementation: needed (trigger:becomes_target, trigger:subject)

Questions for you:

- 'A spell or ability an opponent controls' is an interveningIf matches on event_object (the targeting source) controller=opponent; 'that player controls' is just controller:opponent.

### Old Gnawbone

Type: Legendary Creature — Dragon

Oracle text:

> Flying
> Whenever a creature you control deals combat damage to a player, create that many Treasure tokens.

Re-rendered plain English:

```
Old Gnawbone [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:subject, quantity:event_amount]
    Oracle: Whenever a creature you control deals combat damage to a player, create that many Treasure tokens.
    Trigger: Whenever a creature you control deals combat damage to a player
    Effect: Create that many ?/? colorless Treasure artifact tokens.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:subject, quantity:event_amount)

### Hellkite Courser

Type: Creature — Dragon

Oracle text:

> Flying
> When this creature enters, you may put a commander you own from the command zone onto the battlefield. It gains haste. Return it to the command zone at the beginning of the next end step.

Re-rendered plain English:

```
Hellkite Courser [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs filter:isCommander, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, step:grant_effect, field:grant_effect.modify, step:create_delayed_trigger, field:create_delayed_trigger.steps, field:create_delayed_trigger.trigger]
    Oracle: When this creature enters, you may put a commander you own from the command zone onto the battlefield. It gains haste. Return it to the command zone at the beginning of the next end step.
    Trigger: Whenever Hellkite Courser enters
    Effect: You may choose a commander card in your command. Then, put the chosen object onto the battlefield. Then, the chosen object gains haste. Then, create a delayed trigger.
```

Player prompts:

- Hellkite Courser: optional: Do you want to choose a commander card in your command?

Implementation: needed (filter:isCommander, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, step:grant_effect, field:grant_effect.modify, step:create_delayed_trigger, field:create_delayed_trigger.steps, field:create_delayed_trigger.trigger)

### Rith, Liberated Primeval

Type: Legendary Creature — Dragon

Oracle text:

> Flying, ward {2}
> Other Dragons you control have ward {2}.
> At the beginning of your end step, if a creature or planeswalker an opponent controlled was dealt excess damage this turn, create a 4/4 red Dragon creature token with flying.

Re-rendered plain English:

```
Rith, Liberated Primeval [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:becomes_target, step:counter_spell, step:unless_pay]
    Oracle: Ward {2}
    Trigger: Whenever Rith, Liberated Primeval becomes the target of a spell or ability
    Effect: Counter that object unless that player pays {2}.
    Keyword: ward 2
  [a3] static [needed: needs static]
    Oracle: Other Dragons you control have ward {2}.
    Static: Other Dragons you control have ward {2}
  [a4] triggered [needed: needs trigger:intervening_if, field:create_tokens.tokenKeywords]
    Oracle: At the beginning of your end step, if a creature or planeswalker an opponent controlled was dealt excess damage this turn, create a 4/4 red Dragon creature token with flying.
    Trigger: At the beginning of your end step, if an opponent excess damage this turn
    Effect: Create a 4/4 red Dragon creature token with flying.
```

Player prompts:

- Rith, Liberated Primeval: pay or not: Do you want to pay {2}? If you don't, counter that object.

Implementation: needed (trigger:becomes_target, step:counter_spell, step:unless_pay, static, trigger:intervening_if, field:create_tokens.tokenKeywords)

Questions for you:

- 'Was dealt excess damage this turn' (to an opponent's creature/planeswalker) has no predicate; interveningIf did_this_turn dealt_damage + the scripted marker excess_damage_dealt_to_opponent_creature_or_planeswalker.

### Ancient Silver Dragon

Type: Creature — Elder Dragon

Oracle text:

> Flying
> Whenever this creature deals combat damage to a player, roll a d20. Draw cards equal to the result. You have no maximum hand size for the rest of the game.

Re-rendered plain English:

```
Ancient Silver Dragon [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs scripted:roll_d20_result_is_X, quantity:X, step:grant_effect, field:grant_effect.modify, duration:until]
    Oracle: Whenever this creature deals combat damage to a player, roll a d20. Draw cards equal to the result. You have no maximum hand size for the rest of the game.
    Trigger: Whenever Ancient Silver Dragon deals combat damage to a player
    Effect: Draw X cards. Then, the target gains no maximum hand size for a duration.
    Scripted (engine-specific rule, not described by the fields above): roll_d20_result_is_X
```

Player prompts:

- (none: no decisions)

Implementation: needed (scripted:roll_d20_result_is_X, quantity:X, step:grant_effect, field:grant_effect.modify, duration:until)

Questions for you:

- 'For the rest of the game' has no Duration value; written as duration {until:'unspecified'} on a grant_effect with the player as the target.

### Terror of the Peaks

Type: Creature — Dragon

Oracle text:

> Flying
> Spells your opponents cast that target this creature cost an additional 3 life to cast.
> Whenever another creature you control enters, this creature deals damage equal to that creature's power to any target.

Re-rendered plain English:

```
Terror of the Peaks [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] scripted [needed: needs scripted:additional_cost_life_when_targeting_this]
    Oracle: Spells your opponents cast that target this creature cost an additional 3 life to cast.
    Scripted (engine-specific rule, not described by the fields above): additional_cost_life_when_targeting_this
  [a3] triggered [needed: needs trigger:subject, quantity:stat, field:damage_target.source]
    Oracle: Whenever another creature you control enters, this creature deals damage equal to that creature's power to any target.
    Trigger: Whenever an another creature you control enters
    Target t1: target  <- prompt: "Choose target."
    Effect: Terror of the Peaks deals that object's power damage to target.
```

Player prompts:

- Terror of the Peaks: choose a target: Choose target.

Implementation: needed (scripted:additional_cost_life_when_targeting_this, trigger:subject, quantity:stat, field:damage_target.source)

Questions for you:

- 'Cost an additional 3 life' for opponents' spells that target this creature is a scripted marker: costMod only changes mana, and no static modifier adds a life cost to other players' spells.

### Mox Opal

Type: Legendary Artifact

Oracle text:

> Metalcraft — {T}: Add one mana of any color. Activate only if you control three or more artifacts.

Re-rendered plain English:

```
Mox Opal [draft]
  [a1] mana [needed: needs mana:variable, timing]
    Oracle: Metalcraft — {T}: Add one mana of any color. Activate only if you control three or more artifacts.
    Cost: {T}
    Timing: you control three or more artifacts
    Mana: add one mana of any color
```

Player prompts:

- (none: no decisions)

Implementation: needed (mana:variable, timing)

### Miirym, Sentinel Wyrm

Type: Legendary Creature — Dragon Spirit

Oracle text:

> Flying, ward {2}
> Whenever another nontoken Dragon you control enters, create a token that's a copy of it, except the token isn't legendary.

Re-rendered plain English:

```
Miirym, Sentinel Wyrm [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:becomes_target, step:counter_spell, step:unless_pay]
    Oracle: Ward {2}
    Trigger: Whenever Miirym, Sentinel Wyrm becomes the target of a spell or ability
    Effect: Counter that object unless that player pays {2}.
    Keyword: ward 2
  [a3] triggered [needed: needs trigger:subject, step:copy, field:copy.notLegendary, field:copy.token]
    Oracle: Whenever another nontoken Dragon you control enters, create a token that's a copy of it, except the token isn't legendary.
    Trigger: Whenever a nontoken another Dragon you control enters
    Effect: Copy that object.
```

Player prompts:

- Miirym, Sentinel Wyrm: pay or not: Do you want to pay {2}? If you don't, counter that object.

Implementation: needed (trigger:becomes_target, step:counter_spell, step:unless_pay, trigger:subject, step:copy, field:copy.notLegendary, field:copy.token)

### Atarka, World Render

Type: Legendary Creature — Dragon

Oracle text:

> Flying, trample
> Whenever a Dragon you control attacks, it gains double strike until end of turn.

Re-rendered plain English:

```
Atarka, World Render [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] keyword [implemented]
    Oracle: Trample
    Keyword: trample
  [a3] triggered [needed: needs trigger:subject, step:grant_effect, field:grant_effect.modify]
    Oracle: Whenever a Dragon you control attacks, it gains double strike until end of turn.
    Trigger: Whenever a Dragon you control attacks
    Effect: That object gains double strike until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:subject, step:grant_effect, field:grant_effect.modify)

### Ancient Gold Dragon

Type: Creature — Elder Dragon

Oracle text:

> Flying
> Whenever this creature deals combat damage to a player, roll a d20. You create a number of 1/1 blue Faerie Dragon creature tokens with flying equal to the result.

Re-rendered plain English:

```
Ancient Gold Dragon [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs scripted:roll_d20_result_is_X, quantity:X, field:create_tokens.tokenKeywords]
    Oracle: Whenever this creature deals combat damage to a player, roll a d20. You create a number of 1/1 blue Faerie Dragon creature tokens with flying equal to the result.
    Trigger: Whenever Ancient Gold Dragon deals combat damage to a player
    Effect: Create X 1/1 blue Faerie Dragon creature tokens with flying.
    Scripted (engine-specific rule, not described by the fields above): roll_d20_result_is_X
```

Player prompts:

- (none: no decisions)

Implementation: needed (scripted:roll_d20_result_is_X, quantity:X, field:create_tokens.tokenKeywords)

### Twinflame Tyrant

Type: Creature — Dragon

Oracle text:

> Flying
> If a source you control would deal damage to an opponent or a permanent an opponent controls, it deals double that damage instead.

Re-rendered plain English:

```
Twinflame Tyrant [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] replacement [needed: needs replacement:would_deal_damage, replacement:damage_qualifiers]
    Oracle: If a source you control would deal damage to an opponent or a permanent an opponent controls, it deals double that damage instead.
    Replacement: If damage by a permanent you control would be dealt to a permanent an opponent controls, modify it: {"damageMultiplier":2}
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_deal_damage, replacement:damage_qualifiers)

Questions for you:

- Recipient 'an opponent or a permanent an opponent controls' is one filter controller:opponent; the recipient field cannot mix a player and a permanent filter.

### Scion of the Ur-Dragon

Type: Legendary Creature — Dragon Avatar

Oracle text:

> Flying
> {2}: Search your library for a Dragon permanent card and put it into your graveyard. If you do, Scion of the Ur-Dragon becomes a copy of that card until end of turn. Then shuffle.

Re-rendered plain English:

```
Scion of the Ur-Dragon [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] activated [needed: needs step:choose, field:choose.count, field:choose.from, field:choose.saveAs, step:grant_effect, field:grant_effect.modify, predicate:step_done, step:shuffle]
    Oracle: {2}: Search your library for a Dragon permanent card and put it into your graveyard. If you do, Scion of the Ur-Dragon becomes a copy of that card until end of turn. Then shuffle.
    Cost: {2}
    Effect: Choose a Dragon card in your library. Then, put the chosen object into its owner's graveyard. Then, IF you did (s1): Scion of the Ur-Dragon is a copy of the chosen object until end of turn. Then, shuffle.
```

Player prompts:

- Scion of the Ur-Dragon: choose: Choose a Dragon card in your library.

Implementation: needed (step:choose, field:choose.count, field:choose.from, field:choose.saveAs, step:grant_effect, field:grant_effect.modify, predicate:step_done, step:shuffle)

Questions for you:

- 'Dragon permanent card' written as subtypes Dragon + creature (Dragon is only a creature subtype); the copy target is the found card (ref 'chosen').

### Ramos, Dragon Engine

Type: Legendary Artifact Creature — Dragon

Oracle text:

> Flying
> Whenever you cast a spell, put a +1/+1 counter on Ramos for each of that spell's colors.
> Remove five +1/+1 counters from Ramos: Add {W}{W}{U}{U}{B}{B}{R}{R}{G}{G}. Activate only once each turn.

Re-rendered plain English:

```
Ramos, Dragon Engine [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs scripted:count_spell_colors, step:add_counters, quantity:event_amount, field:add_counters.on]
    Oracle: Whenever you cast a spell, put a +1/+1 counter on Ramos for each of that spell's colors.
    Trigger: Whenever you cast a spell
    Effect: Put that many +1/+1 counters on Ramos, Dragon Engine.
    Scripted (engine-specific rule, not described by the fields above): count_spell_colors
  [a3] mana [needed: needs timing, cost:counters]
    Oracle: Remove five +1/+1 counters from Ramos: Add {W}{W}{U}{U}{B}{B}{R}{R}{G}{G}. Activate only once each turn.
    Cost: remove 5 +1/+1 counters from Ramos, Dragon Engine
    Timing: 1 per turn
    Mana: add {W}{W}{U}{U}{B}{B}{R}{R}{G}{G}
```

Player prompts:

- (none: no decisions)

Implementation: needed (scripted:count_spell_colors, step:add_counters, quantity:event_amount, field:add_counters.on, timing, cost:counters)

Questions for you:

- 'For each of that spell's colors' has no Quantity; amount is event_amount with the scripted marker count_spell_colors.

### Herald's Horn

Type: Artifact

Oracle text:

> As this artifact enters, choose a creature type.
> Creature spells you cast of the chosen type cost {1} less to cast.
> At the beginning of your upkeep, look at the top card of your library. If it's a creature card of the chosen type, you may reveal it and put it into your hand.

Re-rendered plain English:

```
Herald's Horn [draft]
  [a1] replacement [needed: needs replacement:would_enter, step:choose, field:choose.choice, field:choose.remember, field:choose.saveAs, field:choose.what]
    Oracle: As this artifact enters, choose a creature type.
    Replacement: If Herald's Horn would enter, also: choose a creature type
  [a2] static [needed: needs static, filter:chosenType]
    Oracle: Creature spells you cast of the chosen type cost {1} less to cast.
    Static: Creature spells of the chosen type you cast cost {1} less to cast
  [a3] triggered [needed: needs filter:chosenType, step:look_top, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, step:reveal, predicate:matches]
    Oracle: At the beginning of your upkeep, look at the top card of your library. If it's a creature card of the chosen type, you may reveal it and put it into your hand.
    Trigger: At the beginning of your upkeep
    Effect: Look at the top card of your library. Then, choose a card from among the looked-at cards. Then, IF the chosen object is a creature of the chosen type: you may reveal the chosen object. Then, IF the chosen object is a creature of the chosen type: you may put the chosen object into your hand.
```

Player prompts:

- Herald's Horn: choose: Choose a creature type.
- Herald's Horn: choose: Choose a card from among the looked-at cards.
- Herald's Horn: optional: Do you want to reveal the chosen object?
- Herald's Horn: optional: Do you want to put the chosen object into your hand?

Implementation: needed (replacement:would_enter, step:choose, field:choose.choice, field:choose.remember, field:choose.saveAs, field:choose.what, static, filter:chosenType, step:look_top, field:choose.count, field:choose.from, field:choose.fromLooked, step:reveal, predicate:matches)

### Ancient Brass Dragon

Type: Creature — Elder Dragon

Oracle text:

> Flying
> Whenever this creature deals combat damage to a player, roll a d20. When you do, put any number of target creature cards with total mana value X or less from graveyards onto the battlefield under your control, where X is the result.

Re-rendered plain English:

```
Ancient Brass Dragon [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs scripted:roll_d20_result_is_X, targets:multi, quantity:X, field:reanimate.amount, field:reanimate.reflexive]
    Oracle: Whenever this creature deals combat damage to a player, roll a d20. When you do, put any number of target creature cards with total mana value X or less from graveyards onto the battlefield under your control, where X is the result.
    Trigger: Whenever Ancient Brass Dragon deals combat damage to a player
    Target t1: up to 99 target creature cards in a graveyard  <- prompt: "Choose up to 99 target creature cards in a graveyard."
    Effect: Return up to 99 target creature cards in a graveyard from the graveyard to the battlefield.
    Scripted (engine-specific rule, not described by the fields above): roll_d20_result_is_X
```

Player prompts:

- Ancient Brass Dragon: choose targets: Choose up to 99 target creature cards in a graveyard.

Implementation: needed (scripted:roll_d20_result_is_X, targets:multi, quantity:X, field:reanimate.amount, field:reanimate.reflexive)

Questions for you:

- 'Any number of target creature cards with total mana value X or less' is a target spec with count 0..99; the total-mana-value cap is not expressible (X is the roll via the scripted marker).

### Ganax, Astral Hunter

Type: Legendary Creature — Dragon

Oracle text:

> Flying
> Whenever Ganax or another Dragon you control enters, create a Treasure token. (It's an artifact with "{T}, Sacrifice this token: Add one mana of any color.")
> Choose a Background (You can have a Background as a second commander.)

Re-rendered plain English:

```
Ganax, Astral Hunter [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:subject]
    Oracle: Whenever Ganax or another Dragon you control enters, create a Treasure token. (It's an artifact with "{T}, Sacrifice this token: Add one mana of any color.")
    Trigger: Whenever a Dragon you control enters
    Effect: Create a ?/? colorless Treasure artifact token.
  [a3] keyword [needed: needs scripted:choose_a_background]
    Oracle: Choose a Background (You can have a Background as a second commander.)
    Scripted (engine-specific rule, not described by the fields above): choose_a_background
    Keyword: choose_a_background
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:subject, scripted:choose_a_background)

Questions for you:

- Choose a Background is a deck-building rule (second commander); written as a keyword with a scripted marker, no play effect.

### Thrakkus the Butcher

Type: Legendary Creature — Dragon Peasant

Oracle text:

> Trample
> Whenever Thrakkus attacks, double the power of each Dragon you control until end of turn.

Re-rendered plain English:

```
Thrakkus the Butcher [draft]
  [a1] keyword [implemented]
    Oracle: Trample
    Keyword: trample
  [a2] triggered [needed: needs step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, quantity:stat]
    Oracle: Whenever Thrakkus attacks, double the power of each Dragon you control until end of turn.
    Trigger: Whenever Thrakkus the Butcher attacks
    Effect: For each Dragon you control, that object gets +that object's power/+0 until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, quantity:stat)

Questions for you:

- 'Double the power of each Dragon' = repeat_for_each over Dragons you control with pump_target by its own power; event_object stands for the object currently iterated (no dedicated ObjRef for the loop variable).

### Korlessa, Scale Singer

Type: Legendary Creature — Dragon Bard

Oracle text:

> You may look at the top card of your library any time.
> You may cast Dragon spells from the top of your library.

Re-rendered plain English:

```
Korlessa, Scale Singer [draft]
  [a1] scripted [needed: needs scripted:look_at_top_card_any_time]
    Oracle: You may look at the top card of your library any time.
    Scripted (engine-specific rule, not described by the fields above): look_at_top_card_any_time
    (optional: Do you want to use this ability?)
  [a2] scripted [needed: needs scripted:cast_from_top_of_library_permission]
    Oracle: You may cast Dragon spells from the top of your library.
    Scripted (engine-specific rule, not described by the fields above): cast_from_top_of_library_permission
    (optional: Do you want to use this ability?)
```

Player prompts:

- Korlessa, Scale Singer: optional: Do you want to use this ability?

Implementation: needed (scripted:look_at_top_card_any_time, scripted:cast_from_top_of_library_permission)

### Hellkite Tyrant

Type: Creature — Dragon

Oracle text:

> Flying, trample
> Whenever this creature deals combat damage to a player, gain control of all artifacts that player controls.
> At the beginning of your upkeep, if you control twenty or more artifacts, you win the game.

Re-rendered plain English:

```
Hellkite Tyrant [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] keyword [implemented]
    Oracle: Trample
    Keyword: trample
  [a3] triggered [needed: needs step:gain_control, field:gain_control.all, field:gain_control.filter, field:gain_control.who]
    Oracle: Whenever this creature deals combat damage to a player, gain control of all artifacts that player controls.
    Trigger: Whenever Hellkite Tyrant deals combat damage to a player
    Effect: Gain control of the target.
  [a4] triggered [needed: needs scripted:win_the_game, trigger:intervening_if]
    Oracle: At the beginning of your upkeep, if you control twenty or more artifacts, you win the game.
    Trigger: At the beginning of your upkeep, if you control greater than or equal to the greater of 20 artifacts
    Scripted (engine-specific rule, not described by the fields above): win_the_game
```

Player prompts:

- (none: no decisions)

Implementation: needed (step:gain_control, field:gain_control.all, field:gain_control.filter, field:gain_control.who, scripted:win_the_game, trigger:intervening_if)

Questions for you:

- 'Twenty' (and 'win the game') cannot be plain numbers/steps: the win is a scripted marker win_the_game; the 20 is in the interveningIf count (the validator's number-word table may complain).

### Roaming Throne

Type: Artifact Creature — Golem

Oracle text:

> Ward {2}
> As this creature enters, choose a creature type.
> This creature is the chosen type in addition to its other types.
> If a triggered ability of another creature you control of the chosen type triggers, it triggers an additional time.

Re-rendered plain English:

```
Roaming Throne [draft]
  [a1] triggered [needed: needs trigger:becomes_target, step:counter_spell, step:unless_pay]
    Oracle: Ward {2}
    Trigger: Whenever Roaming Throne becomes the target of a spell or ability
    Effect: Counter that object unless that player pays {2}.
    Keyword: ward 2
  [a2] replacement [needed: needs replacement:would_enter, step:choose, field:choose.choice, field:choose.remember, field:choose.saveAs, field:choose.what]
    Oracle: As this creature enters, choose a creature type.
    Replacement: If Roaming Throne would enter, also: choose a creature type
  [a3] static [needed: needs static, static:addTypes]
    Oracle: This creature is the chosen type in addition to its other types.
    Static: Roaming Throne is also a chosen type
  [a4] scripted [needed: needs scripted:triggers_additional_time]
    Oracle: If a triggered ability of another creature you control of the chosen type triggers, it triggers an additional time.
    Scripted (engine-specific rule, not described by the fields above): triggers_additional_time
```

Player prompts:

- Roaming Throne: pay or not: Do you want to pay {2}? If you don't, counter that object.
- Roaming Throne: choose: Choose a creature type.

Implementation: needed (trigger:becomes_target, step:counter_spell, step:unless_pay, replacement:would_enter, step:choose, field:choose.choice, field:choose.remember, field:choose.saveAs, field:choose.what, static, static:addTypes, scripted:triggers_additional_time)

### Zurgo and Ojutai

Type: Legendary Creature — Orc Dragon

Oracle text:

> Flying, haste
> Zurgo and Ojutai has hexproof as long as it entered this turn.
> Whenever one or more Dragons you control deal combat damage to a player or battle, look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order. You may return one of those Dragons to its owner's hand.

Re-rendered plain English:

```
Zurgo and Ojutai [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] keyword [implemented]
    Oracle: Haste
    Keyword: haste
  [a3] static [needed: needs static]
    Oracle: Zurgo and Ojutai has hexproof as long as it entered this turn.
    Static: Zurgo and Ojutai has hexproof as long as the entered th of Zurgo and Ojutai is the turn
  [a4] triggered [needed: needs trigger:batch, trigger:subject, step:look_top, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, field:move_card_zone.order, field:move_card_zone.position, field:move_card_zone.what]
    Oracle: Whenever one or more Dragons you control deal combat damage to a player or battle, look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order. You may return one of those Dragons to its owner's hand.
    Trigger: Whenever one or more Dragons you control deal combat damage to a player
    Effect: Look at the top three cards of your library. Then, choose a card from among the looked-at cards. Then, put the chosen object into your hand. Then, put the rest of the looked-at cards on the bottom of your library. Then, you may return that object to its owner's hand.
```

Player prompts:

- Zurgo and Ojutai: choose: Choose a card from among the looked-at cards.
- Zurgo and Ojutai: optional: Do you want to return that object to its owner's hand?

Implementation: needed (static, trigger:batch, trigger:subject, step:look_top, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, field:move_card_zone.order, field:move_card_zone.position, field:move_card_zone.what)

Questions for you:

- 'Entered this turn' is a stat predicate entered_this_turn (no dedicated predicate). 'A player or battle' damage is written as the player-damage event only (no battle recipient).

### Sarkhan Unbroken

Type: Legendary Planeswalker — Sarkhan

Oracle text:

> +1: Draw a card, then add one mana of any color.
> −2: Create a 4/4 red Dragon creature token with flying.
> −8: Search your library for any number of Dragon creature cards, put them onto the battlefield, then shuffle.

Re-rendered plain English:

```
Sarkhan Unbroken [draft]
  [a1] activated [needed: needs timing, cost:loyalty, step:add_mana, field:add_mana.produces]
    Oracle: +1: Draw a card, then add one mana of any color.
    Cost: +1
    Timing: sorcery; 1 per turn
    Effect: Draw a card. Then, add one mana of any color.
  [a2] activated [needed: needs timing, cost:loyalty, field:create_tokens.tokenKeywords]
    Oracle: −2: Create a 4/4 red Dragon creature token with flying.
    Cost: −2
    Timing: sorcery; 1 per turn
    Effect: Create a 4/4 red Dragon creature token with flying.
  [a3] activated [needed: needs timing, cost:loyalty, step:search_library, field:search_library.anyNumber, field:search_library.filter, field:search_library.min, field:search_library.shuffle, field:search_library.to, field:search_library.upTo]
    Oracle: −8: Search your library for any number of Dragon creature cards, put them onto the battlefield, then shuffle.
    Cost: −8
    Timing: sorcery; 1 per turn
    Effect: Search your library for a Dragon, put it onto the battlefield, then shuffle.
```

Player prompts:

- Sarkhan Unbroken: search: Choose a Dragon from the library.

Implementation: needed (timing, cost:loyalty, step:add_mana, field:add_mana.produces, field:create_tokens.tokenKeywords, step:search_library, field:search_library.anyNumber, field:search_library.filter, field:search_library.min, field:search_library.shuffle, field:search_library.to, field:search_library.upTo)

### Scavenger Regent // Exude Toxin

Type: Creature — Dragon // Sorcery — Omen

Oracle text:

> Scavenger Regent: Flying
> Ward—Discard a card.
> 
> Exude Toxin: Each non-Dragon creature gets -X/-X until end of turn. (Then shuffle this card into its owner's library.)

Re-rendered plain English:

```
Scavenger Regent // Exude Toxin [draft]
  [a1] keyword [needed: needs face]
    Oracle: Scavenger Regent: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:becomes_target, face, step:counter_spell, step:unless_pay]
    Oracle: Ward—Discard a card.
    Trigger: Whenever Scavenger Regent // Exude Toxin becomes the target of a spell or ability
    Effect: Counter that object unless that player discard your hand.
    Keyword: ward Discard a card
  [a3] spell_effect (from hand) [needed: needs filter:notSubtypes, face, quantity:math, field:mass_pump.filter, step:shuffle]
    Oracle: Exude Toxin: Each non-Dragon creature gets -X/-X until end of turn. (Then shuffle this card into its owner's library.)
    Effect: All creatures get +-1 x X/+-1 x X until end of turn. Then, shuffle.
```

Player prompts:

- Scavenger Regent // Exude Toxin: pay or not: Do you want to discard your hand? If you don't, counter that object.

Implementation: needed (face, trigger:becomes_target, step:counter_spell, step:unless_pay, filter:notSubtypes, quantity:math, field:mass_pump.filter, step:shuffle)

Questions for you:

- Exude Toxin (Omen back half; its cost {X}{B}{B} comes from the card face, not the oracle text) is a spell_effect ability usable from hand; the 'shuffle this card into its owner's library' rider is a shuffle step targeting self. Omen has no dedicated cast-option kind.

### The Great Henge

Type: Legendary Artifact

Oracle text:

> This spell costs {X} less to cast, where X is the greatest power among creatures you control.
> {T}: Add {G}{G}. You gain 2 life.
> Whenever a nontoken creature you control enters, put a +1/+1 counter on it and draw a card.

Re-rendered plain English:

```
The Great Henge [draft]
  [a1] cast_option [needed: needs cast_option, cost_reduction, cost_reduction:variable]
    Oracle: This spell costs {X} less to cast, where X is the greatest power among creatures you control.
    Cost reduction: this ability costs {X}, where X is the greatest power among creatures you control, less
  [a2] mana [implemented]
    Oracle: {T}: Add {G}{G}. You gain 2 life.
    Cost: {T}
    Effect: Gain 2 life.
    Mana: add {G}{G}
  [a3] triggered [needed: needs trigger:subject, step:add_counters, field:add_counters.on]
    Oracle: Whenever a nontoken creature you control enters, put a +1/+1 counter on it and draw a card.
    Trigger: Whenever a nontoken creature you control enters
    Effect: Put a +1/+1 counter on that object. Then, draw a card.
```

Player prompts:

- (none: no decisions)

Implementation: needed (cast_option, cost_reduction, cost_reduction:variable, trigger:subject, step:add_counters, field:add_counters.on)

### Crucible of the Spirit Dragon

Type: Land

Oracle text:

> {T}: Add {C}.
> {1}, {T}: Put a storage counter on this land.
> {T}, Remove X storage counters from this land: Add X mana in any combination of colors. Spend this mana only to cast Dragon spells or activate abilities of Dragons.

Re-rendered plain English:

```
Crucible of the Spirit Dragon [draft]
  [a1] mana [implemented]
    Oracle: {T}: Add {C}.
    Cost: {T}
    Mana: add {C}
  [a2] activated [needed: needs step:add_counters, field:add_counters.on]
    Oracle: {1}, {T}: Put a storage counter on this land.
    Cost: {1}, {T}
    Effect: Put a storage counter on Crucible of the Spirit Dragon.
  [a3] activated [needed: needs cost:counters, step:add_mana, quantity:X, field:add_mana.produces]
    Oracle: {T}, Remove X storage counters from this land: Add X mana in any combination of colors. Spend this mana only to cast Dragon spells or activate abilities of Dragons.
    Cost: {T}, remove X storage counters from Crucible of the Spirit Dragon
    Effect: Add one mana of any color (spend only to cast a Dragon spell or activate abilities of Dragons).
    X prompt: "Choose a value for X (the amount used in the cost)."
```

Player prompts:

- Crucible of the Spirit Dragon: choose X: Choose a value for X (the amount used in the cost).

Implementation: needed (step:add_counters, field:add_counters.on, cost:counters, step:add_mana, quantity:X, field:add_mana.produces)

Questions for you:

- Crucible's X mana is an activated ability with an add_mana step (kind 'mana' cannot carry a variable amount); rules-wise it is a mana ability.

### Arena of Glory

Type: Land

Oracle text:

> This land enters tapped unless you control a Mountain.
> {T}: Add {R}.
> {R}, {T}, Exert this land: Add {R}{R}. If that mana is spent on a creature spell, it gains haste until end of turn. (An exerted permanent won't untap during your next untap step.)

Re-rendered plain English:

```
Arena of Glory [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped unless you control a Mountain.
    Replacement: If Arena of Glory would enter (only if it is not true that you control a Mountain), it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {R}.
    Cost: {T}
    Mana: add {R}
  [a3] mana [needed: needs scripted:exert_and_haste_if_spent_on_creature_spell, step:grant_effect, field:grant_effect.modify]
    Oracle: {R}, {T}, Exert this land: Add {R}{R}. If that mana is spent on a creature spell, it gains haste until end of turn.
    Cost: {R}, {T}
    Effect: That object gains haste until end of turn.
    Scripted (engine-specific rule, not described by the fields above): exert_and_haste_if_spent_on_creature_spell
    Mana: add {R}{R}
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter, scripted:exert_and_haste_if_spent_on_creature_spell, step:grant_effect, field:grant_effect.modify)

Questions for you:

- Exert is not a cost atom; it is carried by the scripted marker exert_and_haste_if_spent_on_creature_spell (which also holds the haste-on-creature-spell rider on the mana).

### Mistrise Village

Type: Land

Oracle text:

> This land enters tapped unless you control a Mountain or a Forest.
> {T}: Add {U}.
> {U}, {T}: The next spell you cast this turn can't be countered.

Re-rendered plain English:

```
Mistrise Village [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped unless you control a Mountain or a Forest.
    Replacement: If Mistrise Village would enter (only if it is not true that you control a Mountain or Forest), it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {U}.
    Cost: {T}
    Mana: add {U}
  [a3] activated [needed: needs scripted:next_spell_this_turn_cant_be_countered, step:grant_effect, field:grant_effect.appliesTo, field:grant_effect.modify]
    Oracle: {U}, {T}: The next spell you cast this turn can't be countered.
    Cost: {U}, {T}
    Effect: The target can't be countered until end of turn.
    Scripted (engine-specific rule, not described by the fields above): next_spell_this_turn_cant_be_countered
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter, scripted:next_spell_this_turn_cant_be_countered, step:grant_effect, field:grant_effect.appliesTo, field:grant_effect.modify)

Questions for you:

- 'The next spell you cast this turn can't be countered' is a grant_effect on the player with a scripted marker next_spell_this_turn_cant_be_countered (no 'next spell' ObjRef).

### Three Tree City

Type: Legendary Land

Oracle text:

> As Three Tree City enters, choose a creature type.
> {T}: Add {C}.
> {2}, {T}: Choose a color. Add an amount of mana of that color equal to the number of creatures you control of the chosen type.

Re-rendered plain English:

```
Three Tree City [draft]
  [a1] replacement [needed: needs replacement:would_enter, step:choose, field:choose.choice, field:choose.remember, field:choose.saveAs, field:choose.what]
    Oracle: As Three Tree City enters, choose a creature type.
    Replacement: If Three Tree City would enter, also: choose a creature type
  [a2] mana [implemented]
    Oracle: {T}: Add {C}.
    Cost: {T}
    Mana: add {C}
  [a3] activated [needed: needs filter:chosenType, filter:chosenColor, step:choose, field:choose.choice, field:choose.remember, step:add_mana, quantity:count, field:add_mana.produces]
    Oracle: {2}, {T}: Choose a color. Add an amount of mana of that color equal to the number of creatures you control of the chosen type.
    Cost: {2}, {T}
    Effect: Choose a color. Then, add one mana of the chosen color.
```

Player prompts:

- Three Tree City: choose: Choose a creature type.
- Three Tree City: choose: Choose a color.

Implementation: needed (replacement:would_enter, step:choose, field:choose.choice, field:choose.remember, field:choose.saveAs, field:choose.what, filter:chosenType, filter:chosenColor, step:add_mana, quantity:count, field:add_mana.produces)

### Boseiju, Who Endures

Type: Legendary Land

Oracle text:

> {T}: Add {G}.
> Channel — {1}{G}, Discard this card: Destroy target artifact, enchantment, or nonbasic land an opponent controls. That player may search their library for a land card with a basic land type, put it onto the battlefield, then shuffle. This ability costs {1} less to activate for each legendary creature you control.

Re-rendered plain English:

```
Boseiju, Who Endures [draft]
  [a1] mana [implemented]
    Oracle: {T}: Add {G}.
    Cost: {T}
    Mana: add {G}
  [a2] activated (from hand) [needed: needs zone:hand, cost_reduction, cost:discard, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.to, field:search_library.who]
    Oracle: Channel — {1}{G}, Discard this card: Destroy target artifact, enchantment, or nonbasic land an opponent controls. That player may search their library for a land card with a basic land type, put it onto the battlefield, then shuffle. This ability costs {1} less to activate for each legendary creature you control.
    Cost: {1}{G}, discard Boseiju, Who Endures
    Target t1: target artifact, enchantment, or nonbasic land an opponent controls  <- prompt: "Choose target artifact, enchantment, or nonbasic land an opponent controls."
    Effect: Destroy target artifact, enchantment, or nonbasic land an opponent controls. Then, you may its controller searches their library for a land with a basic land type, put it onto the battlefield, then shuffle.
    Cost reduction: this ability costs {1} less for each legendary creature you control
```

Player prompts:

- Boseiju, Who Endures: choose a target: Choose target artifact, enchantment, or nonbasic land an opponent controls.
- Boseiju, Who Endures: optional: Do you want to its controller searches their library for a land with a basic land type, put it onto the battlefield, then shuffle?

Implementation: needed (zone:hand, cost_reduction, cost:discard, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.to, field:search_library.who)

### Path of Ancestry

Type: Land

Oracle text:

> This land enters tapped.
> {T}: Add one mana of any color in your commander's color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1. (Look at the top card of your library. You may put that card on the bottom.)

Re-rendered plain English:

```
Path of Ancestry [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped.
    Replacement: If Path of Ancestry would enter, it enters tapped
  [a2] mana [needed: needs scripted:mana_spent_on_creature_sharing_type_with_commander, mana:variable, step:scry]
    Oracle: {T}: Add one mana of any color in your commander's color identity.
    Cost: {T}
    Effect: Scry 1.
    Scripted (engine-specific rule, not described by the fields above): mana_spent_on_creature_sharing_type_with_commander
    Mana: add one mana of any color in your commander's color identity
  [a3] triggered [needed: needs scripted:mana_rider_text, step:scry]
    Oracle: When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1. (Look at the top card of your library. You may put that card on the bottom.)
    Trigger: Whenever you cast a creature spell
    Effect: Scry 1.
    Scripted (engine-specific rule, not described by the fields above): mana_rider_text
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter, scripted:mana_spent_on_creature_sharing_type_with_commander, mana:variable, step:scry, scripted:mana_rider_text)

Questions for you:

- The 'when that mana is spent' trigger is a cast trigger plus a scripted marker (no way to link a trigger to the mana it came from, and no 'shares a creature type with your commander' filter value other than sharesCreatureTypeWith an ObjRef).

### Exotic Orchard

Type: Land

Oracle text:

> {T}: Add one mana of any color that a land an opponent controls could produce.

Re-rendered plain English:

```
Exotic Orchard [draft]
  [a1] mana [needed: needs scripted:colors_lands_opponents_control_could_produce, mana:variable]
    Oracle: {T}: Add one mana of any color that a land an opponent controls could produce.
    Cost: {T}
    Scripted (engine-specific rule, not described by the fields above): colors_lands_opponents_control_could_produce
    Mana: add one mana of any color
```

Player prompts:

- (none: no decisions)

Implementation: needed (scripted:colors_lands_opponents_control_could_produce, mana:variable)

Questions for you:

- 'Any color that a land an opponent controls could produce' (also Reflecting Pool) has no ManaSpec; written {anyColor:1} plus a scripted marker naming the restriction.

### Reflecting Pool

Type: Land

Oracle text:

> {T}: Add one mana of any type that a land you control could produce.

Re-rendered plain English:

```
Reflecting Pool [draft]
  [a1] mana [needed: needs scripted:types_lands_you_control_could_produce, mana:variable]
    Oracle: {T}: Add one mana of any type that a land you control could produce.
    Cost: {T}
    Scripted (engine-specific rule, not described by the fields above): types_lands_you_control_could_produce
    Mana: add one mana of any color
```

Player prompts:

- (none: no decisions)

Implementation: needed (scripted:types_lands_you_control_could_produce, mana:variable)

### Myriad Landscape

Type: Land

Oracle text:

> This land enters tapped.
> {T}: Add {C}.
> {2}, {T}, Sacrifice this land: Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.

Re-rendered plain English:

```
Myriad Landscape [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped.
    Replacement: If Myriad Landscape would enter, it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {C}.
    Cost: {T}
    Mana: add {C}
  [a3] activated [needed: needs cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.min, field:search_library.sharesLandType, field:search_library.shuffle, field:search_library.tapped, field:search_library.to, field:search_library.upTo]
    Oracle: {2}, {T}, Sacrifice this land: Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.
    Cost: {2}, {T}, sacrifice Myriad Landscape
    Effect: Search your library for a basic land, put it onto the battlefield, then shuffle.
```

Player prompts:

- Myriad Landscape: search: Choose a basic land from the library.

Implementation: needed (replacement:would_enter, cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.min, field:search_library.sharesLandType, field:search_library.shuffle, field:search_library.tapped, field:search_library.to, field:search_library.upTo)

Questions for you:

- 'Share a land type' between the two fetched basics is a scripted marker (cards_share_a_land_type); ObjectFilter.sameName is the only group qualifier.

### Prairie Stream

Type: Land — Plains Island

Oracle text:

> ({T}: Add {W} or {U}.)
> This land enters tapped unless you control two or more basic lands.

Re-rendered plain English:

```
Prairie Stream [draft]
  [a1] mana [implemented]
    Oracle: ({T}: Add {W} or {U}.)
    Cost: {T}
    Mana: add {W}
  [a2] mana [implemented]
    Oracle: ({T}: Add {W} or {U}.)
    Cost: {T}
    Mana: add {U}
  [a3] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped unless you control two or more basic lands.
    Replacement: If Prairie Stream would enter (only if it is not true that you control two or more basic lands), it enters tapped
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter)

### Drowned Catacomb

Type: Land

Oracle text:

> This land enters tapped unless you control an Island or a Swamp.
> {T}: Add {U} or {B}.

Re-rendered plain English:

```
Drowned Catacomb [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped unless you control an Island or a Swamp.
    Replacement: If Drowned Catacomb would enter (only if it is not true that you control an Island or Swamp), it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {U} or {B}.
    Cost: {T}
    Mana: add {U}
  [a3] mana [implemented]
    Oracle: {T}: Add {U} or {B}.
    Cost: {T}
    Mana: add {B}
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter)

### Glacial Fortress

Type: Land

Oracle text:

> This land enters tapped unless you control a Plains or an Island.
> {T}: Add {W} or {U}.

Re-rendered plain English:

```
Glacial Fortress [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped unless you control a Plains or an Island.
    Replacement: If Glacial Fortress would enter (only if it is not true that you control a Plains or Island), it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {W} or {U}.
    Cost: {T}
    Mana: add {W}
  [a3] mana [implemented]
    Oracle: {T}: Add {W} or {U}.
    Cost: {T}
    Mana: add {U}
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter)

### Isolated Chapel

Type: Land

Oracle text:

> This land enters tapped unless you control a Plains or a Swamp.
> {T}: Add {W} or {B}.

Re-rendered plain English:

```
Isolated Chapel [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped unless you control a Plains or a Swamp.
    Replacement: If Isolated Chapel would enter (only if it is not true that you control a Plains or Swamp), it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {W} or {B}.
    Cost: {T}
    Mana: add {W}
  [a3] mana [implemented]
    Oracle: {T}: Add {W} or {B}.
    Cost: {T}
    Mana: add {B}
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter)

### Dragon Tempest

Type: Enchantment

Oracle text:

> Whenever a creature you control with flying enters, it gains haste until end of turn.
> Whenever a Dragon you control enters, it deals X damage to any target, where X is the number of Dragons you control.

Re-rendered plain English:

```
Dragon Tempest [draft]
  [a1] triggered [needed: needs trigger:subject, step:grant_effect, field:grant_effect.modify]
    Oracle: Whenever a creature you control with flying enters, it gains haste until end of turn.
    Trigger: Whenever a creature with flying you control enters
    Effect: That object gains haste until end of turn.
  [a2] triggered [needed: needs trigger:subject, quantity:count, field:damage_target.source]
    Oracle: Whenever a Dragon you control enters, it deals X damage to any target, where X is the number of Dragons you control.
    Trigger: Whenever a Dragon you control enters
    Target t1: target  <- prompt: "Choose target."
    Effect: That object deals the number of Dragons you control damage to target.
```

Player prompts:

- Dragon Tempest: choose a target: Choose target.

Implementation: needed (trigger:subject, step:grant_effect, field:grant_effect.modify, quantity:count, field:damage_target.source)

### Scourge of Valkas

Type: Creature — Dragon

Oracle text:

> Flying
> Whenever this creature or another Dragon you control enters, it deals X damage to any target, where X is the number of Dragons you control.
> {R}: This creature gets +1/+0 until end of turn.

Re-rendered plain English:

```
Scourge of Valkas [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:subject, quantity:count, field:damage_target.source]
    Oracle: Whenever this creature or another Dragon you control enters, it deals X damage to any target, where X is the number of Dragons you control.
    Trigger: Whenever a Dragon you control enters
    Target t1: target  <- prompt: "Choose target."
    Effect: That object deals the number of Dragons you control damage to target.
  [a3] activated [implemented]
    Oracle: {R}: This creature gets +1/+0 until end of turn.
    Cost: {R}
    Effect: Scourge of Valkas gets +1/+0 until end of turn.
```

Player prompts:

- Scourge of Valkas: choose a target: Choose target.

Implementation: needed (trigger:subject, quantity:count, field:damage_target.source)

### Lathliss, Dragon Queen

Type: Legendary Creature — Dragon

Oracle text:

> Flying
> Whenever another nontoken Dragon you control enters, create a 5/5 red Dragon creature token with flying.
> {1}{R}: Dragons you control get +1/+0 until end of turn.

Re-rendered plain English:

```
Lathliss, Dragon Queen [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:subject, field:create_tokens.tokenKeywords]
    Oracle: Whenever another nontoken Dragon you control enters, create a 5/5 red Dragon creature token with flying.
    Trigger: Whenever a nontoken another Dragon you control enters
    Effect: Create a 5/5 red Dragon creature token with flying.
  [a3] activated [needed: needs field:mass_pump.filter]
    Oracle: {1}{R}: Dragons you control get +1/+0 until end of turn.
    Cost: {1}{R}
    Effect: All creatures get +1/+0 until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:subject, field:create_tokens.tokenKeywords, field:mass_pump.filter)

### Garruk's Uprising

Type: Enchantment

Oracle text:

> When this enchantment enters, if you control a creature with power 4 or greater, draw a card.
> Creatures you control have trample. (Each of those creatures can deal excess combat damage to the player or planeswalker it's attacking.)
> Whenever a creature you control with power 4 or greater enters, draw a card.

Re-rendered plain English:

```
Garruk's Uprising [draft]
  [a1] triggered [needed: needs trigger:intervening_if]
    Oracle: When this enchantment enters, if you control a creature with power 4 or greater, draw a card.
    Trigger: Whenever Garruk's Uprising enters, if you control a creature with power 4 or greater
    Effect: Draw a card.
  [a2] static [needed: needs static]
    Oracle: Creatures you control have trample. (Each of those creatures can deal excess combat damage to the player or planeswalker it's attacking.)
    Static: Creatures you control have trample
  [a3] triggered [needed: needs trigger:subject]
    Oracle: Whenever a creature you control with power 4 or greater enters, draw a card.
    Trigger: Whenever a creature with power 4 or greater you control enters
    Effect: Draw a card.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:intervening_if, static, trigger:subject)

### Orb of Dragonkind

Type: Artifact

Oracle text:

> {1}, {T}: Add two mana in any combination of colors. Spend this mana only to cast Dragon spells or activate abilities of Dragons.
> {R}, {T}, Sacrifice this artifact: Look at the top seven cards of your library. You may reveal a Dragon card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.

Re-rendered plain English:

```
Orb of Dragonkind [draft]
  [a1] mana [needed: needs mana:variable, mana:restriction]
    Oracle: {1}, {T}: Add two mana in any combination of colors. Spend this mana only to cast Dragon spells or activate abilities of Dragons.
    Cost: {1}, {T}
    Mana: add two mana of any one color (spend only to cast a Dragon spell or activate abilities of Dragons)
  [a2] activated [needed: needs cost:sacrifice, step:look_top, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, step:reveal, field:move_card_zone.order, field:move_card_zone.position, field:move_card_zone.what]
    Oracle: {R}, {T}, Sacrifice this artifact: Look at the top seven cards of your library. You may reveal a Dragon card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.
    Cost: {R}, {T}, sacrifice Orb of Dragonkind
    Effect: Look at the top seven cards of your library. Then, you may choose a Dragon card from among the looked-at cards. Then, reveal the chosen object. Then, put the chosen object into your hand. Then, put the rest of the looked-at cards on the bottom of your library in a random order.
```

Player prompts:

- Orb of Dragonkind: optional: Do you want to choose a Dragon card from among the looked-at cards?

Implementation: needed (mana:variable, mana:restriction, cost:sacrifice, step:look_top, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, step:reveal, field:move_card_zone.order, field:move_card_zone.position, field:move_card_zone.what)

Questions for you:

- Mana restriction 'Dragon spells or abilities of Dragons' is a filter {subtypes:['Dragon']} (no spell-or-ability distinction in ManaSpec.restriction). OK?

### Hellkite Charger

Type: Creature — Dragon

Oracle text:

> Flying, haste
> Whenever this creature attacks, you may pay {5}{R}{R}. If you do, untap all attacking creatures and after this phase, there is an additional combat phase.

Re-rendered plain English:

```
Hellkite Charger [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] keyword [implemented]
    Oracle: Haste
    Keyword: haste
  [a3] triggered [needed: needs field:untap_target.all, field:untap_target.filter, field:untap_target.optionalCost, step:extra_combat, predicate:step_done]
    Oracle: Whenever this creature attacks, you may pay {5}{R}{R}. If you do, untap all attacking creatures and after this phase, there is an additional combat phase.
    Trigger: Whenever Hellkite Charger attacks
    Effect: IF you control an attacking creature: you may untap the target. Then, IF you did (s1): there is an additional combat phase after this one.
```

Player prompts:

- Hellkite Charger: optional: Do you want to untap the target?

Implementation: needed (field:untap_target.all, field:untap_target.filter, field:untap_target.optionalCost, step:extra_combat, predicate:step_done)

Questions for you:

- SCHEMA QUESTION: no step kind for 'additional combat phase'; marked with scripted handler additional_combat_phase on the ability (same for Scourge of the Throne). Add a step kind?

### Carnelian Orb of Dragonkind

Type: Artifact

Oracle text:

> {T}: Add {R}. If that mana is spent on a Dragon creature spell, it gains haste until end of turn.

Re-rendered plain English:

```
Carnelian Orb of Dragonkind [draft]
  [a1] mana [needed: needs step:grant_effect, field:grant_effect.modify, predicate:matches]
    Oracle: {T}: Add {R}. If that mana is spent on a Dragon creature spell, it gains haste until end of turn.
    Cost: {T}
    Effect: IF that object is a creature Dragon spell: that object gains haste until end of turn.
    Mana: add {R}
```

Player prompts:

- (none: no decisions)

Implementation: needed (step:grant_effect, field:grant_effect.modify, predicate:matches)

Questions for you:

- A mana ability with a rider effect: 'it' is the Dragon spell the mana was spent on (event_object). The schema has no way to say 'mana was spent on X'; I used a matches predicate on the spell. OK?

### Scourge of the Throne

Type: Creature — Dragon

Oracle text:

> Flying
> Dethrone (Whenever this creature attacks the player with the most life or tied for most life, put a +1/+1 counter on it.)
> Whenever this creature attacks for the first time each turn, if it's attacking the player with the most life or tied for most life, untap all attacking creatures. After this phase, there is an additional combat phase.

Re-rendered plain English:

```
Scourge of the Throne [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:intervening_if, predicate:most_life, step:add_counters, field:add_counters.on]
    Oracle: Dethrone (Whenever this creature attacks the player with the most life or tied for most life, put a +1/+1 counter on it.)
    Trigger: Whenever Scourge of the Throne attacks, if that player has the most life or are tied for the most life
    Effect: Put a +1/+1 counter on Scourge of the Throne.
    Keyword: dethrone
  [a3] triggered [needed: needs trigger:nth, trigger:intervening_if, predicate:most_life, field:untap_target.all, field:untap_target.filter, step:extra_combat]
    Oracle: Whenever this creature attacks for the first time each turn, if it's attacking the player with the most life or tied for most life, untap all attacking creatures. After this phase, there is an additional combat phase.
    Trigger: Whenever Scourge of the Throne attacks for the first time each turn, if that player has the most life or are tied for the most life
    Effect: Untap the target. Then, there is an additional combat phase after this one.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:intervening_if, predicate:most_life, step:add_counters, field:add_counters.on, trigger:nth, field:untap_target.all, field:untap_target.filter, step:extra_combat)

Questions for you:

- SCHEMA QUESTION: 'the player with the most life or tied for most life' is written as life(that_player) >= greatest life of any player, using a pseudo-filter {types:['player']}. Needs a proper Quantity/Predicate. 'Additional combat phase' is a scripted marker (see Hellkite Charger).
- 'This creature attacks the player' = that_player (the defending player).

### Temple of the False God

Type: Land

Oracle text:

> {T}: Add {C}{C}. Activate only if you control five or more lands.

Re-rendered plain English:

```
Temple of the False God [draft]
  [a1] mana [needed: needs timing]
    Oracle: {T}: Add {C}{C}. Activate only if you control five or more lands.
    Cost: {T}
    Timing: you control five or more lands
    Mana: add {C}{C}
```

Player prompts:

- (none: no decisions)

Implementation: needed (timing)

## Kernel to-do: missing capabilities across this deck

| capability | cards | needing it |
|---|---|---|
| `static` | 19 | The Ur-Dragon; Urza's Incubator; Goldspan Dragon; Call the Spirit Dragons; Dragonlord Dromoka; Morophon, the Boundless; Scion of Draco; Sarkhan, Soul Aflame; Rhythm of the Wild; Temur Ascendancy; Rith, Liberated Primeval; Herald's Horn; Roaming Throne; Zurgo and Ojutai; Yavimaya, Cradle of Growth; Reliquary Tower; Garruk's Uprising; Dragonspeaker Shaman; Dragonlord's Servant |
| `trigger:subject` | 19 | The Ur-Dragon; Sarkhan, Soul Aflame; Temur Ascendancy; Silumgar, the Drifting Death; Scalelord Reckoner; Old Gnawbone; Terror of the Peaks; Miirym, Sentinel Wyrm; Atarka, World Render; Ganax, Astral Hunter; Wrathful Red Dragon; Zurgo and Ojutai; The Great Henge; Dragon Tempest; Scourge of Valkas; Lathliss, Dragon Queen; Dragon's Hoard; Garruk's Uprising; Utvara Hellkite |
| `replacement:would_enter` | 17 | Urza's Incubator; Morophon, the Boundless; Herald's Horn; Roaming Throne; Arena of Glory; Mistrise Village; Three Tree City; Path of Ancestry; Myriad Landscape; Prairie Stream; Drowned Catacomb; Glacial Fortress; Isolated Chapel; Temple of Deceit; Temple of Silence; Dragonstorm Globe; Bojuka Bog |
| `mana:variable` | 11 | Mox Jasper; Rivaz of the Claw; Mox Opal; Cascading Cataracts; Command Tower; Path of Ancestry; Exotic Orchard; Reflecting Pool; Dragon's Hoard; Dragonstorm Globe; Orb of Dragonkind |
| `field:choose.saveAs` | 10 | Urza's Incubator; Morophon, the Boundless; Ureni of the Unwritten; Hellkite Courser; Scion of the Ur-Dragon; Herald's Horn; Roaming Throne; Zurgo and Ojutai; Three Tree City; Orb of Dragonkind |
| `field:grant_effect.modify` | 10 | Rivaz of the Claw; Hellkite Courser; Ancient Silver Dragon; Atarka, World Render; Scion of the Ur-Dragon; Arena of Glory; Mistrise Village; Dragon Tempest; Carnelian Orb of Dragonkind; Rogue's Passage |
| `step:choose` | 10 | Urza's Incubator; Morophon, the Boundless; Ureni of the Unwritten; Hellkite Courser; Scion of the Ur-Dragon; Herald's Horn; Roaming Throne; Zurgo and Ojutai; Three Tree City; Orb of Dragonkind |
| `step:grant_effect` | 10 | Rivaz of the Claw; Hellkite Courser; Ancient Silver Dragon; Atarka, World Render; Scion of the Ur-Dragon; Arena of Glory; Mistrise Village; Dragon Tempest; Carnelian Orb of Dragonkind; Rogue's Passage |
| `field:damage_target.source` | 8 | Balefire Dragon; Terror of the Peaks; Wrathful Red Dragon; Caves of Koilos; Adarkar Wastes; Underground River; Dragon Tempest; Scourge of Valkas |
| `field:search_library.filter` | 8 | Tiamat; Sarkhan Unbroken; Farseek; Boseiju, Who Endures; Myriad Landscape; Evolving Wilds; Terramorphic Expanse; Sarkhan's Triumph |
| `field:search_library.shuffle` | 8 | Tiamat; Sarkhan Unbroken; Farseek; Boseiju, Who Endures; Myriad Landscape; Evolving Wilds; Terramorphic Expanse; Sarkhan's Triumph |
| `field:search_library.to` | 8 | Tiamat; Sarkhan Unbroken; Farseek; Boseiju, Who Endures; Myriad Landscape; Evolving Wilds; Terramorphic Expanse; Sarkhan's Triumph |
| `step:search_library` | 8 | Tiamat; Sarkhan Unbroken; Farseek; Boseiju, Who Endures; Myriad Landscape; Evolving Wilds; Terramorphic Expanse; Sarkhan's Triumph |
| `field:search_library.count` | 7 | Tiamat; Farseek; Boseiju, Who Endures; Myriad Landscape; Evolving Wilds; Terramorphic Expanse; Sarkhan's Triumph |
| `field:add_counters.on` | 6 | Ramos, Dragon Engine; The Great Henge; Crucible of the Spirit Dragon; Dragon's Hoard; Dragonstorm Globe; Scourge of the Throne |
| `field:choose.count` | 6 | Ureni of the Unwritten; Hellkite Courser; Scion of the Ur-Dragon; Herald's Horn; Zurgo and Ojutai; Orb of Dragonkind |
| `field:choose.from` | 6 | Ureni of the Unwritten; Hellkite Courser; Scion of the Ur-Dragon; Herald's Horn; Zurgo and Ojutai; Orb of Dragonkind |
| `step:add_counters` | 6 | Ramos, Dragon Engine; The Great Henge; Crucible of the Spirit Dragon; Dragon's Hoard; Dragonstorm Globe; Scourge of the Throne |
| `timing` | 6 | Mox Jasper; Rivaz of the Claw; Mox Opal; Ramos, Dragon Engine; Sarkhan Unbroken; Temple of the False God |
| `trigger:becomes_target` | 6 | Goldspan Dragon; Scalelord Reckoner; Rith, Liberated Primeval; Miirym, Sentinel Wyrm; Roaming Throne; Scavenger Regent // Exude Toxin |
| `trigger:intervening_if` | 6 | Tiamat; Rivaz of the Claw; Rith, Liberated Primeval; Hellkite Tyrant; Garruk's Uprising; Scourge of the Throne |
| `field:add_mana.produces` | 5 | Savage Ventmaw; Klauth, Unrivaled Ancient; Sarkhan Unbroken; Crucible of the Spirit Dragon; Three Tree City |
| `field:choose.choice` | 5 | Urza's Incubator; Morophon, the Boundless; Herald's Horn; Roaming Throne; Three Tree City |
| `field:choose.remember` | 5 | Urza's Incubator; Morophon, the Boundless; Herald's Horn; Roaming Throne; Three Tree City |
| `field:choose.what` | 5 | Urza's Incubator; Morophon, the Boundless; Herald's Horn; Roaming Throne; Three Tree City |
| `field:create_tokens.tokenKeywords` | 5 | Rith, Liberated Primeval; Ancient Gold Dragon; Sarkhan Unbroken; Lathliss, Dragon Queen; Utvara Hellkite |
| `field:move_card_zone.what` | 5 | The Ur-Dragon; Ureni of the Unwritten; Zurgo and Ojutai; Orb of Dragonkind; Bojuka Bog |
| `quantity:event_amount` | 5 | The Ur-Dragon; Balefire Dragon; Old Gnawbone; Ramos, Dragon Engine; Wrathful Red Dragon |
| `quantity:X` | 5 | Ancient Copper Dragon; Ancient Silver Dragon; Ancient Gold Dragon; Ancient Brass Dragon; Crucible of the Spirit Dragon |
| `step:add_mana` | 5 | Savage Ventmaw; Klauth, Unrivaled Ancient; Sarkhan Unbroken; Crucible of the Spirit Dragon; Three Tree City |
| `cost:sacrifice` | 4 | Myriad Landscape; Evolving Wilds; Terramorphic Expanse; Orb of Dragonkind |
| `field:choose.fromLooked` | 4 | Ureni of the Unwritten; Herald's Horn; Zurgo and Ojutai; Orb of Dragonkind |
| `field:mass_pump.filter` | 4 | Silumgar, the Drifting Death; Bladewing the Risen; Scavenger Regent // Exude Toxin; Lathliss, Dragon Queen |
| `field:search_library.tapped` | 4 | Farseek; Myriad Landscape; Evolving Wilds; Terramorphic Expanse |
| `filter:chosenType` | 4 | Urza's Incubator; Morophon, the Boundless; Herald's Horn; Three Tree City |
| `scripted:roll_d20_result_is_X` | 4 | Ancient Copper Dragon; Ancient Silver Dragon; Ancient Gold Dragon; Ancient Brass Dragon |
| `step:counter_spell` | 4 | Rith, Liberated Primeval; Miirym, Sentinel Wyrm; Roaming Throne; Scavenger Regent // Exude Toxin |
| `step:look_top` | 4 | Ureni of the Unwritten; Herald's Horn; Zurgo and Ojutai; Orb of Dragonkind |
| `step:unless_pay` | 4 | Rith, Liberated Primeval; Miirym, Sentinel Wyrm; Roaming Throne; Scavenger Regent // Exude Toxin |
| `cost_reduction` | 3 | Scion of Draco; The Great Henge; Boseiju, Who Endures |
| `cost:counters` | 3 | Ramos, Dragon Engine; Crucible of the Spirit Dragon; Dragon's Hoard |
| `field:move_card_zone.order` | 3 | Ureni of the Unwritten; Zurgo and Ojutai; Orb of Dragonkind |
| `field:move_card_zone.position` | 3 | Ureni of the Unwritten; Zurgo and Ojutai; Orb of Dragonkind |
| `field:search_library.min` | 3 | Tiamat; Sarkhan Unbroken; Myriad Landscape |
| `field:search_library.upTo` | 3 | Tiamat; Sarkhan Unbroken; Myriad Landscape |
| `filter:notSubtypes` | 3 | Crux of Fate; Wrathful Red Dragon; Scavenger Regent // Exude Toxin |
| `quantity:count` | 3 | Three Tree City; Dragon Tempest; Scourge of Valkas |
| `step:scry` | 3 | Path of Ancestry; Temple of Deceit; Temple of Silence |
| `cast_option` | 2 | Scion of Draco; The Great Henge |
| `cost_reduction:variable` | 2 | Scion of Draco; The Great Henge |
| `field:search_library.reveal` | 2 | Tiamat; Sarkhan's Triumph |
| `field:untap_target.all` | 2 | Hellkite Charger; Scourge of the Throne |
| `field:untap_target.filter` | 2 | Hellkite Charger; Scourge of the Throne |
| `mana:restriction` | 2 | Rivaz of the Claw; Orb of Dragonkind |
| `predicate:matches` | 2 | Herald's Horn; Carnelian Orb of Dragonkind |
| `predicate:step_done` | 2 | Scion of the Ur-Dragon; Hellkite Charger |
| `quantity:stat` | 2 | Terror of the Peaks; Thrakkus the Butcher |
| `static:addTypes` | 2 | Roaming Throne; Yavimaya, Cradle of Growth |
| `step:copy` | 2 | Sarkhan, Soul Aflame; Miirym, Sentinel Wyrm |
| `step:extra_combat` | 2 | Hellkite Charger; Scourge of the Throne |
| `step:reveal` | 2 | Herald's Horn; Orb of Dragonkind |
| `step:shuffle` | 2 | Scion of the Ur-Dragon; Scavenger Regent // Exude Toxin |
| `trigger:batch` | 2 | The Ur-Dragon; Zurgo and Ojutai |
| `trigger:multi_event` | 2 | Goldspan Dragon; Ureni of the Unwritten |
| `cost:discard` | 1 | Boseiju, Who Endures |
| `cost:life` | 1 | War Room |
| `cost:loyalty` | 1 | Sarkhan Unbroken |
| `duration:until` | 1 | Ancient Silver Dragon |
| `face` | 1 | Scavenger Regent // Exude Toxin |
| `field:copy.exceptAddTypes` | 1 | Sarkhan, Soul Aflame |
| `field:copy.exceptName` | 1 | Sarkhan, Soul Aflame |
| `field:copy.notLegendary` | 1 | Miirym, Sentinel Wyrm |
| `field:copy.of` | 1 | Sarkhan, Soul Aflame |
| `field:copy.token` | 1 | Miirym, Sentinel Wyrm |
| `field:create_delayed_trigger.steps` | 1 | Hellkite Courser |
| `field:create_delayed_trigger.trigger` | 1 | Hellkite Courser |
| `field:damage_target.all` | 1 | Balefire Dragon |
| `field:damage_target.filter` | 1 | Balefire Dragon |
| `field:damage_target.who` | 1 | Balefire Dragon |
| `field:destroy_all.filter` | 1 | Crux of Fate |
| `field:gain_control.all` | 1 | Hellkite Tyrant |
| `field:gain_control.filter` | 1 | Hellkite Tyrant |
| `field:gain_control.who` | 1 | Hellkite Tyrant |
| `field:grant_effect.appliesTo` | 1 | Mistrise Village |
| `field:mass_pump.who` | 1 | Silumgar, the Drifting Death |
| `field:move_card_zone.filter` | 1 | The Ur-Dragon |
| `field:move_card_zone.from` | 1 | The Ur-Dragon |
| `field:reanimate.amount` | 1 | Ancient Brass Dragon |
| `field:reanimate.reflexive` | 1 | Ancient Brass Dragon |
| `field:repeat_for_each.over` | 1 | Thrakkus the Butcher |
| `field:repeat_for_each.steps` | 1 | Thrakkus the Butcher |
| `field:search_library.anyNumber` | 1 | Sarkhan Unbroken |
| `field:search_library.distinctNames` | 1 | Tiamat |
| `field:search_library.excludeNamed` | 1 | Tiamat |
| `field:search_library.sharesLandType` | 1 | Myriad Landscape |
| `field:search_library.who` | 1 | Boseiju, Who Endures |
| `field:untap_target.optionalCost` | 1 | Hellkite Charger |
| `filter:chosenColor` | 1 | Three Tree City |
| `filter:isCommander` | 1 | Hellkite Courser |
| `modes` | 1 | Crux of Fate |
| `predicate:cast_from` | 1 | Rivaz of the Claw |
| `predicate:most_life` | 1 | Scourge of the Throne |
| `predicate:stat` | 1 | Tiamat |
| `predicate:turn_is` | 1 | Rivaz of the Claw |
| `quantity:math` | 1 | Scavenger Regent // Exude Toxin |
| `quantity:sum` | 1 | Klauth, Unrivaled Ancient |
| `replacement:damage_qualifiers` | 1 | Twinflame Tyrant |
| `replacement:would_deal_damage` | 1 | Twinflame Tyrant |
| `scripted:additional_cost_life_when_targeting_this` | 1 | Terror of the Peaks |
| `scripted:cast_from_graveyard_permission` | 1 | Rivaz of the Claw |
| `scripted:cast_from_top_of_library_permission` | 1 | Korlessa, Scale Singer |
| `scripted:cast_without_paying_mana_cost` | 1 | Dracogenesis |
| `scripted:choose_a_background` | 1 | Ganax, Astral Hunter |
| `scripted:colors_lands_opponents_control_could_produce` | 1 | Exotic Orchard |
| `scripted:cost_reduction_colored_mana_only` | 1 | Morophon, the Boundless |
| `scripted:count_spell_colors` | 1 | Ramos, Dragon Engine |
| `scripted:domain_count_distinct_basic_land_types` | 1 | Scion of Draco |
| `scripted:exert_and_haste_if_spent_on_creature_spell` | 1 | Arena of Glory |
| `scripted:look_at_top_card_any_time` | 1 | Korlessa, Scale Singer |
| `scripted:mana_rider_text` | 1 | Path of Ancestry |
| `scripted:mana_spent_on_creature_sharing_type_with_commander` | 1 | Path of Ancestry |
| `scripted:next_spell_this_turn_cant_be_countered` | 1 | Mistrise Village |
| `scripted:one_counter_per_color_on_distinct_dragons_win_if_five` | 1 | Call the Spirit Dragons |
| `scripted:triggers_additional_time` | 1 | Roaming Throne |
| `scripted:types_lands_you_control_could_produce` | 1 | Reflecting Pool |
| `scripted:win_the_game` | 1 | Hellkite Tyrant |
| `static:costMod_quantity` | 1 | Morophon, the Boundless |
| `step:create_delayed_trigger` | 1 | Hellkite Courser |
| `step:gain_control` | 1 | Hellkite Tyrant |
| `step:repeat_for_each` | 1 | Thrakkus the Butcher |
| `targets:multi` | 1 | Ancient Brass Dragon |
| `trigger:dealt_damage` | 1 | Wrathful Red Dragon |
| `trigger:nth` | 1 | Scourge of the Throne |
| `zone:command` | 1 | The Ur-Dragon |
| `zone:hand` | 1 | Boseiju, Who Endures |
| `zone:stack` | 1 | Dragonlord Dromoka |

## Decisions

- Copied unchanged from other decks' drafts (identical cards): Dragon Tempest (reign-of-dragons), Scourge of Valkas (reign-of-dragons), Lathliss, Dragon Queen (reign-of-dragons), Dragon's Hoard (reign-of-dragons), Garruk's Uprising (tramplesaurus-rex), Dragonspeaker Shaman (reign-of-dragons), Dragonlord's Servant (reign-of-dragons), Utvara Hellkite (reign-of-dragons), Dragonstorm Globe (reign-of-dragons), Orb of Dragonkind (reign-of-dragons), Hellkite Charger (reign-of-dragons), Sarkhan's Triumph (reign-of-dragons), Carnelian Orb of Dragonkind (reign-of-dragons), Scourge of the Throne (reign-of-dragons), Temple of the False God (calling-all-angels), Bojuka Bog (wretched-ranks), Rogue's Passage (tramplesaurus-rex), War Room (calling-all-angels), Swamp (wretched-ranks), Forest (tramplesaurus-rex), Mountain (reign-of-dragons), Island (keen-engineering), Plains (calling-all-angels).
- SCHEMA QUESTION: no Roll step or roll-result Quantity (Ancient Copper/Silver/Gold/Brass Dragon): scripted marker roll_d20_result_is_X with the result bound to X.
- SCHEMA QUESTION: no win_the_game step (Call the Spirit Dragons, Hellkite Tyrant): scripted marker.
- SCHEMA QUESTION: no way to express a dual-colour tap ability ("Add {W} or {U}"): written as two mana abilities with identical text (player picks one). ManaSpec has no one-of or all-same-colour (Goldspan Treasure) flag.
- SCHEMA QUESTION: no exert cost atom (Arena of Glory), no loop-variable ObjRef for repeat_for_each (Thrakkus), no was_cast / entered_this_turn / excess-damage predicates (Tiamat, Zurgo and Ojutai, Rith), no defending_player PlayerRef (Silumgar), no notNamed filter, no free-cast static modifier (Dracogenesis), no cast-other-cards-from-zone permission (Rivaz, Korlessa), no additional life cost on opponents spells (Terror of the Peaks), no colored-only cost reduction (Morophon), no domain count.
- VALIDATOR NOTE: number words (twenty, five-with-math) and digits in costMod/count need the {math:max} wrapper trick; mana symbols for a second card face (Exude Toxin {X}{B}{B}) are not in the oracle text, so no cast option is written for it.
