# Kernel draft approval: Aminatou

87 unique cards: 38 simple (A), 49 complex (B). Validator: 87/87 pass. Cards with implementation "needed": 80. All drafts are `review.status: "draft"`; nothing was written to the DB.

Reading guide: each card below shows the oracle text and what the structured JSON says back in plain English. Approve if they match.

## (A) Simple cards: spot-check one line each

- **Adarkar Wastes** (Land): {T}: add {C} | {T}: add {W} | {T}: add {U} [needs: field:damage_target.source]
- **Arcane Sanctum** (Land): If Arcane Sanctum would enter, it enters tapped | {T}: add {W} | {T}: add {U} | {T}: add {B} [needs: replacement:would_enter]
- **Arcane Signet** (Artifact): {T}: add one mana of any color in your commander's color identity [needs: mana:variable]
- **Archon of Sun's Grace** (Creature — Archon): Keyword flying | Keyword lifelink | Pegasuses you control have lifelink | Whenever an enchantment you control enters: Create a 2/2 white Pegasus creature token with flying [needs: static, trigger:subject, field:create_tokens.tokenKeywords]
- **Boon of the Spirit Realm** (Enchantment): Whenever Boon of the Spirit Realm enters or an another enchantment you control enters: Put a blessing counter on Boon of the Spirit Realm | Creatures you control get +X/+X, where X is the number of blessing counters on self [needs: trigger:multi_event, trigger:subject, step:add_counters, field:add_counters.on, static]
- **Brainstorm** (Instant): Draw 3 cards, then choose 2 cards in your hand, then put a card on the top of its owner's library [needs: step:choose, field:choose.count, field:choose.from, field:choose.saveAs, field:move_card_zone.ordered, field:move_card_zone.position, field:move_card_zone.what]
- **Brainsurge** (Instant): Draw 4 cards, then choose 2 cards in your hand, then put a card on the top of its owner's library [needs: step:choose, field:choose.count, field:choose.from, field:choose.saveAs, field:move_card_zone.ordered, field:move_card_zone.position, field:move_card_zone.what]
- **Caves of Koilos** (Land): {T}: add {C} | {T}: add {W} | {T}: add {B} [needs: field:damage_target.source]
- **Command Tower** (Land): {T}: add one mana of any color in your commander's color identity [needs: mana:variable]
- **Contaminated Aquifer** (Land — Island Swamp): {T}: add {U} | {T}: add {B} | If Contaminated Aquifer would enter, it enters tapped [needs: replacement:would_enter]
- **Counterspell** (Instant): [targets: target spell] Counter target spell [needs: step:counter_spell]
- **Debtors' Knell** (Enchantment): At the beginning of your upkeep: [targets: target creature card in a graveyard] Return target creature card in a graveyard from the graveyard to the battlefield [implemented]
- **Diabolic Vision** (Sorcery): Look at the top five cards of your library, then choose a card from among the looked-at cards, then put a card into your hand, then put the rest of the looked-at cards on the top of your library [needs: step:look_top, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, field:move_card_zone.what, field:move_card_zone.ordered, field:move_card_zone.position]
- **Evolving Wilds** (Land): {T}, sacrifice Evolving Wilds: Search your library for a basic land, put it onto the battlefield, then shuffle [needs: cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to]
- **Greed** (Enchantment): {B}, pay 2 life: Draw a card [needs: cost:life]
- **Halimar Depths** (Land): If Halimar Depths would enter, it enters tapped | Whenever Halimar Depths enters: Look at the top three cards of your library, then put the rest of the looked-at cards on the top of your library | {T}: add {U} [needs: replacement:would_enter, step:look_top, field:move_card_zone.ordered, field:move_card_zone.position, field:move_card_zone.what]
- **Island** (Basic Land — Island): {T}: add {U} [implemented]
- **Ledger Shredder** (Creature — Bird Advisor): Keyword flying | Whenever a player casts their second spell each turn: Self connives (draw, discard, +1/+1 counter if the discarded card is nonland) [needs: trigger:nth, trigger:subject, step:connive, field:connive.on]
- **Monologue Tax** (Enchantment): Whenever an opponent casts their second spell each turn: Create a ?/? colorless Treasure artifact token [needs: trigger:nth]
- **Moon-Blessed Cleric** (Creature — Human Elf Cleric): Whenever Moon-Blessed Cleric enters: You may search your library for a enchantment, put it onto the library, then shuffle [needs: step:search_library, field:search_library.count, field:search_library.filter, field:search_library.position, field:search_library.reveal, field:search_library.shuffle, field:search_library.to]
- **Negate** (Instant): [targets: target noncreature spell] Counter target noncreature spell [needs: step:counter_spell]
- **Obscura Storefront** (Land): Whenever Obscura Storefront enters: Sacrifice a permanent, then search your library for a Plains, Island, or Swamp, put it onto the battlefield, then shuffle, then gain 1 life [needs: step:search_library, field:search_library.count, field:search_library.filter, field:search_library.reflexive, field:search_library.shuffle, field:search_library.tapped, field:search_library.to, predicate:step_done]
- **Plains** (Basic Land — Plains): {T}: add {W} [implemented]
- **Ponder** (Sorcery): Look at the top three cards of your library, then put the rest of the looked-at cards on the top of your library, then you may shuffle, then draw a card [needs: step:look_top, field:move_card_zone.ordered, field:move_card_zone.position, field:move_card_zone.what, step:shuffle]
- **Sigil of the Empty Throne** (Enchantment): Whenever you cast an enchantment spell: Create a 4/4 white Angel creature token with flying [needs: field:create_tokens.tokenKeywords]
- **Sol Ring** (Artifact): {T}: add {C}{C} [implemented]
- **Swamp** (Basic Land — Swamp): {T}: add {B} [implemented]
- **Swords to Plowshares** (Instant): [targets: target creature] Exile target creature, then its controller gains t1's power life [needs: quantity:stat, field:life_change.amount, field:life_change.who]
- **Talisman of Dominance** (Artifact): {T}: add {C} | {T}: add {U} and {B} [needs: field:damage_target.source]
- **Talisman of Hierarchy** (Artifact): {T}: add {C} | {T}: add {W} and {B} [needs: field:damage_target.source]
- **Talisman of Progress** (Artifact): {T}: add {C} | {T}: add {W} and {U} [needs: field:damage_target.source]
- **Temple of Deceit** (Land): If Temple of Deceit would enter, it enters tapped | Whenever Temple of Deceit enters: Scry 1 | {T}: add {U} | {T}: add {B} [needs: replacement:would_enter, step:scry]
- **Temple of Silence** (Land): If Temple of Silence would enter, it enters tapped | Whenever Temple of Silence enters: Scry 1 | {T}: add {W} | {T}: add {B} [needs: replacement:would_enter, step:scry]
- **Underground River** (Land): {T}: add {C} | {T}: add {U} | {T}: add {B} [needs: field:damage_target.source]
- **Utter End** (Instant): [targets: target nonland permanent] Exile target nonland permanent [implemented]
- **Utter Insignificance** (Enchantment — Aura): Keyword flash | [targets: target creature] | The enchanted creature loses all abilities and has base power and toughness 1/1 | {2}{C}: Exile the enchanted creature [needs: keyword:enchant, static, static:setBasePT]
- **Void Rend** (Instant): Void Rend can't be countered | [targets: target nonland permanent] Destroy target nonland permanent [needs: static, zone:stack]
- **Wayfarer's Bauble** (Artifact): {2}, {T}, sacrifice Wayfarer's Bauble: Search your library for a basic land, put it onto the battlefield, then shuffle [needs: cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to]

## (B) Complex cards

### Aminatou, Veil Piercer

Type: Legendary Creature — Human Wizard

Oracle text:

> At the beginning of your upkeep, surveil 2. (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
> Each enchantment card in your hand has miracle. Its miracle cost is equal to its mana cost reduced by {4}. (You may cast a card for its miracle cost when you draw it if it's the first card you drew this turn.)

Re-rendered plain English:

```
Aminatou, Veil Piercer [draft]
  [a1] triggered [needed: needs step:surveil]
    Oracle: At the beginning of your upkeep, surveil 2. (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
    Trigger: At the beginning of your upkeep
    Effect: Surveil 2.
  [a2] static [needed: needs static]
    Oracle: Each enchantment card in your hand has miracle. Its miracle cost is equal to its mana cost reduced by {4}. (You may cast a card for its miracle cost when you draw it if it's the first card you drew this turn.)
    Static: Enchantment cards in your hand have an ability
```

Player prompts:

- (none: no decisions)

Implementation: needed (step:surveil, static)

Questions for you:

- Miracle granted by a static ability has no schema field: it is a grantAbility record {kind:"cast_option",keyword:"miracle",reduceBy:"{4}"} on enchantment cards in hand. The kernel needs a "grants miracle with cost = mana cost reduced by N" capability.

### Aminatou, the Fateshifter

Type: Legendary Planeswalker — Aminatou

Oracle text:

> +1: Draw a card, then put a card from your hand on top of your library.
> −1: Exile another target permanent you own, then return it to the battlefield under your control.
> −6: Choose left or right. Each player gains control of all nonland permanents other than Aminatou controlled by the next player in the chosen direction.
> Aminatou, the Fateshifter can be your commander.

Re-rendered plain English:

```
Aminatou, the Fateshifter [draft]
  [a1] activated [needed: needs timing, cost:loyalty, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, field:move_card_zone.position, field:move_card_zone.what]
    Oracle: +1: Draw a card, then put a card from your hand on top of your library.
    Cost: +1
    Timing: sorcery; 1 per turn
    Effect: Draw a card. Then, choose a card in your hand. Then, put a card on the top of its owner's library.
  [a2] activated [needed: needs timing, cost:loyalty, field:move_card_zone.from]
    Oracle: −1: Exile another target permanent you own, then return it to the battlefield under your control.
    Cost: −1
    Timing: sorcery; 1 per turn
    Target t1: another target permanent  <- prompt: "Choose another target permanent."
    Effect: Exile another target permanent. Then, put another target permanent onto the battlefield.
  [a3] activated [needed: needs timing, cost:loyalty, step:choose, field:choose.choice, field:choose.options, field:choose.remember, step:gain_control, field:gain_control.excludeSelf, field:gain_control.filter, field:gain_control.rotate, field:gain_control.who]
    Oracle: −6: Choose left or right. Each player gains control of all nonland permanents other than Aminatou controlled by the next player in the chosen direction.
    Cost: −6
    Timing: sorcery; 1 per turn
    Effect: Choose one of left or right. Then, gain control of the target.
  [a4] scripted [needed: needs scripted:can_be_your_commander]
    Oracle: Aminatou, the Fateshifter can be your commander.
    Scripted (engine-specific rule, not described by the fields above): can_be_your_commander
```

Player prompts:

- Aminatou, the Fateshifter: choose: Choose a card in your hand.
- Aminatou, the Fateshifter: choose a target: Choose another target permanent.
- Aminatou, the Fateshifter: choose: Choose one of left or right.

Implementation: needed (timing, cost:loyalty, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, field:move_card_zone.position, field:move_card_zone.what, field:move_card_zone.from, field:choose.choice, field:choose.options, field:choose.remember, step:gain_control, field:gain_control.excludeSelf, field:gain_control.filter, field:gain_control.rotate, field:gain_control.who, scripted:can_be_your_commander)

Questions for you:

- The -6 ("each player gains control of all nonland permanents other than Aminatou controlled by the next player in the chosen direction") is a simultaneous rotation of control around the table. gain_control has no rotate/direction fields; written as gain_control with passthrough fields rotate + excludeSelf. Needs a kernel-defined rotate_control step.
- -1: "Exile another target permanent you own" - the permanent returns as a NEW object (loses counters, summoning sick); expressed as exile then move_card_zone from exile to battlefield.

### Arcane Denial

Type: Instant

Oracle text:

> Counter target spell. Its controller may draw up to two cards at the beginning of the next turn's upkeep.
> You draw a card at the beginning of the next turn's upkeep.

Re-rendered plain English:

```
Arcane Denial [draft]
  [a1] spell_effect [needed: needs quantity:step_result, step:counter_spell, step:create_delayed_trigger, field:create_delayed_trigger.at, field:create_delayed_trigger.steps, step:choose, field:choose.choice, field:choose.max, field:choose.min, field:choose.who, field:draw_cards.who]
    Oracle: Counter target spell. Its controller may draw up to two cards at the beginning of the next turn's upkeep. / You draw a card at the beginning of the next turn's upkeep.
    Target t1: target spell  <- prompt: "Choose target spell."
    Effect: Counter target spell. Then, create a delayed trigger. Then, create a delayed trigger.
```

Player prompts:

- Arcane Denial: choose a target: Choose target spell.
- Arcane Denial: choose: Choose a number.

Implementation: needed (quantity:step_result, step:counter_spell, step:create_delayed_trigger, field:create_delayed_trigger.at, field:create_delayed_trigger.steps, step:choose, field:choose.choice, field:choose.max, field:choose.min, field:choose.who, field:draw_cards.who)

Questions for you:

- "Its controller may draw up to two cards": modelled as a delayed trigger whose draw step is who:controller_of_target, optional, upTo:true (number chosen by that player, 0-2). OK?

### Archaeomancer's Map

Type: Artifact

Oracle text:

> When this artifact enters, search your library for up to two basic Plains cards, reveal them, put them into your hand, then shuffle.
> Whenever a land an opponent controls enters, if that player controls more lands than you, you may put a land card from your hand onto the battlefield.

Re-rendered plain English:

```
Archaeomancer's Map [draft]
  [a1] triggered [needed: needs step:search_library, field:search_library.count, field:search_library.filter, field:search_library.reveal, field:search_library.shuffle, field:search_library.to, field:search_library.upTo]
    Oracle: When this artifact enters, search your library for up to two basic Plains cards, reveal them, put them into your hand, then shuffle.
    Trigger: Whenever Archaeomancer's Map enters
    Effect: Search your library for a basic Plains, put it onto your hand, then shuffle.
  [a2] triggered [needed: needs trigger:intervening_if, predicate:compare, trigger:subject, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, field:move_card_zone.from, field:move_card_zone.what]
    Oracle: Whenever a land an opponent controls enters, if that player controls more lands than you, you may put a land card from your hand onto the battlefield.
    Trigger: Whenever a land an opponent controls enters, if the number of lands that player controls is greater than the number of lands you control
    Effect: You may choose a land card in your hand. Then, put a card onto the battlefield.
```

Player prompts:

- Archaeomancer's Map: search: Choose a basic Plains from the library.
- Archaeomancer's Map: optional: Do you want to put a land card from your hand onto the battlefield?

Implementation: needed (step:search_library, field:search_library.count, field:search_library.filter, field:search_library.reveal, field:search_library.shuffle, field:search_library.to, field:search_library.upTo, trigger:intervening_if, predicate:compare, trigger:subject, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, field:move_card_zone.from, field:move_card_zone.what)

Questions for you:

- "if that player controls more lands than you": the comparison uses the count of lands controlled by ANY opponent; with several opponents it should compare the specific player whose land entered. The schema has no event-player-scoped count; written with controller:"opponent".

### Athreos, Shroud-Veiled

Type: Legendary Enchantment Creature — God

Oracle text:

> Indestructible
> As long as your devotion to white and black is less than seven, Athreos isn't a creature.
> At the beginning of your end step, put a coin counter on another target creature.
> Whenever a creature with a coin counter on it dies or is put into exile, return that card to the battlefield under your control.

Re-rendered plain English:

```
Athreos, Shroud-Veiled [draft]
  [a1] keyword [implemented]
    Oracle: Indestructible
    Keyword: indestructible
  [a2] static [needed: needs static, quantity:devotion_multi]
    Oracle: As long as your devotion to white and black is less than seven, Athreos isn't a creature.
    Static: Athreos, Shroud-Veiled loses creature as long as your devotion to W and B (one count of symbols of W or B; a hybrid symbol counts once) is less than 7
  [a3] triggered [needed: needs step:add_counters, field:add_counters.on]
    Oracle: At the beginning of your end step, put a coin counter on another target creature.
    Trigger: At the beginning of your end step
    Target t1: another target creature  <- prompt: "Choose another target creature."
    Effect: Put a coin counter on another target creature.
  [a4] triggered [needed: needs trigger:subject, trigger:multi_event, trigger:leaves, trigger:zones]
    Oracle: Whenever a creature with a coin counter on it dies or is put into exile, return that card to the battlefield under your control.
    Trigger: Whenever a creature with a coin counter on it dies or is put into exile
    Effect: Return that object from the graveyard to the battlefield.
```

Player prompts:

- Athreos, Shroud-Veiled: choose a target: Choose another target creature.

Implementation: needed (static, quantity:devotion_multi, step:add_counters, field:add_counters.on, trigger:subject, trigger:multi_event, trigger:leaves, trigger:zones)

Questions for you:

- Devotion to "white and black" is written as the sum of devotion to W and devotion to B (hybrid symbols count once per symbol per the rules, which this sum matches only if the kernel counts a W/B hybrid once). OK?

### Blasphemous Edict

Type: Sorcery

Oracle text:

> You may pay {B} rather than pay this spell's mana cost if there are thirteen or more creatures on the battlefield.
> Each player sacrifices thirteen creatures of their choice.

Re-rendered plain English:

```
Blasphemous Edict [draft]
  Cast option c1: you may use alternative (from hand, cost {B}, replaces mana cost) [needed]
  [a1] spell_effect [needed: needs field:sacrifice_permanent.amount, field:sacrifice_permanent.filter, field:sacrifice_permanent.who]
    Oracle: Each player sacrifices thirteen creatures of their choice.
    Effect: Each player sacrifices a creature.
  [a2] cast_option [needed: needs cast_option]
    Oracle: You may pay {B} rather than pay this spell's mana cost if there are thirteen or more creatures on the battlefield.
```

Player prompts:

- Blasphemous Edict: sacrifice: Choose a permanent to sacrifice.
- Blasphemous Edict: alternative option: Do you want to cast it using its alternative cost ({B})?

Implementation: needed (field:sacrifice_permanent.amount, field:sacrifice_permanent.filter, field:sacrifice_permanent.who, cast_option, cast_option:alternative, cast_option:conditional, predicate:compare)

### Callaphe, Beloved of the Sea

Type: Legendary Enchantment Creature — Demigod

Oracle text:

> Callaphe's power is equal to your devotion to blue. (Each {U} in the mana costs of permanents you control counts toward your devotion to blue.)
> Creatures and enchantments you control have "Spells your opponents cast that target this permanent cost {1} more to cast."

Re-rendered plain English:

```
Callaphe, Beloved of the Sea [draft]
  [a1] static [needed: needs static, static:setBasePT]
    Oracle: Callaphe's power is equal to your devotion to blue. (Each {U} in the mana costs of permanents you control counts toward your devotion to blue.)
    Static: Callaphe, Beloved of the Sea has base power and toughness your devotion to U/Callaphe, Beloved of the Sea's toughness
  [a2] static [needed: needs static]
    Oracle: Creatures and enchantments you control have "Spells your opponents cast that target this permanent cost {1} more to cast."
    Static: Creatures you control or enchantments you control have an ability
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, static:setBasePT)

Questions for you:

- Characteristic-defining "power is equal to devotion" has no dedicated modifier: written as setBasePT with toughness = its own current toughness (3 printed). The schema needs a power-only CDA modifier.
- The granted tax only applies to spells that TARGET the permanent: grantAbility record carries onlyIfTargets:"self" (loose record, not validated).

### Demon of Fate's Design

Type: Enchantment Creature — Demon

Oracle text:

> Flying, trample
> Once during each of your turns, you may cast an enchantment spell by paying life equal to its mana value rather than paying its mana cost.
> {2}{B}, Sacrifice another enchantment: This creature gets +X/+0 until end of turn, where X is the sacrificed enchantment's mana value.

Re-rendered plain English:

```
Demon of Fate's Design [draft]
  [a1] keyword [implemented]
    Oracle: Flying, trample
    Keyword: flying
  [a2] keyword [implemented]
    Oracle: Flying, trample
    Keyword: trample
  [a3] scripted [needed: needs scripted:cast_enchantment_paying_life, timing]
    Oracle: Once during each of your turns, you may cast an enchantment spell by paying life equal to its mana value rather than paying its mana cost.
    Timing: 1 per turn
    Scripted (engine-specific rule, not described by the fields above): cast_enchantment_paying_life
    (optional: Do you want to use this ability?)
  [a4] activated [needed: needs ref:sacrificed, cost:sacrifice, quantity:stat]
    Oracle: {2}{B}, Sacrifice another enchantment: This creature gets +X/+0 until end of turn, where X is the sacrificed enchantment's mana value.
    Cost: {2}{B}, sacrifice an another enchantment you control
    Effect: Demon of Fate's Design gets +the sacrificed permanent's mana value/+0 until end of turn.
```

Player prompts:

- Demon of Fate's Design: optional: Do you want to use this ability?
- Demon of Fate's Design: choose what to sacrifice: Choose 1 another enchantment you control to sacrifice.

Implementation: needed (scripted:cast_enchantment_paying_life, timing, ref:sacrificed, cost:sacrifice, quantity:stat)

Questions for you:

- "Cast an enchantment spell by paying life equal to its mana value rather than paying its mana cost" (once each of your turns) is an alternative-cost permission granted to OTHER cards by a static ability. castOptions only describe the card's own casting, so it is a scripted marker cast_enchantment_paying_life.

### Devastation Tide

Type: Sorcery

Oracle text:

> Return all nonland permanents to their owners' hands.
> Miracle {1}{U} (You may cast this card for its miracle cost when you draw it if it's the first card you drew this turn.)

Re-rendered plain English:

```
Devastation Tide [draft]
  Cast option c1: you may use miracle (from hand, cost {1}{U}, replaces mana cost) [needed]
  [a1] spell_effect [needed: needs field:mass_bounce.filter]
    Oracle: Return all nonland permanents to their owners' hands.
    Effect: Return all nonland permanents to their owners' hands.
```

Player prompts:

- Devastation Tide: miracle option: Do you want to cast it using its miracle cost ({1}{U})?

Implementation: needed (field:mass_bounce.filter, cast_option:miracle)

### Doomwake Giant

Type: Enchantment Creature — Giant

Oracle text:

> Constellation — Whenever this creature or another enchantment you control enters, creatures your opponents control get -1/-1 until end of turn.

Re-rendered plain English:

```
Doomwake Giant [draft]
  [a1] triggered [needed: needs trigger:multi_event, trigger:subject, field:mass_pump.filter]
    Oracle: Constellation — Whenever this creature or another enchantment you control enters, creatures your opponents control get -1/-1 until end of turn.
    Trigger: Whenever Doomwake Giant enters or an another enchantment you control enters
    Effect: All creatures get -1/-1 until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:multi_event, trigger:subject, field:mass_pump.filter)

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

### Enhanced Surveillance

Type: Enchantment

Oracle text:

> You may look at an additional two cards each time you surveil.
> Exile this enchantment: Shuffle your graveyard into your library.

Re-rendered plain English:

```
Enhanced Surveillance [draft]
  [a1] scripted [needed: needs scripted:surveil_additional_cards]
    Oracle: You may look at an additional two cards each time you surveil.
    Scripted (engine-specific rule, not described by the fields above): surveil_additional_cards
    (optional: Do you want to use this ability?)
  [a2] activated [needed: needs cost:exileFrom, field:move_card_zone.filter, field:move_card_zone.from, field:move_card_zone.what, step:shuffle]
    Oracle: Exile this enchantment: Shuffle your graveyard into your library.
    Cost: exile Enhanced Surveillance from battlefield
    Effect: Put a card into its owner's library. Then, shuffle.
```

Player prompts:

- Enhanced Surveillance: optional: Do you want to use this ability?

Implementation: needed (scripted:surveil_additional_cards, cost:exileFrom, field:move_card_zone.filter, field:move_card_zone.from, field:move_card_zone.what, step:shuffle)

Questions for you:

- "Look at an additional two cards each time you surveil" modifies the surveil step (look at 2 more cards before choosing). There is no static modifier for changing another step's amount, so it is a scripted marker surveil_additional_cards {extra:2}; the surveil step needs to read it.

### Esper Sentinel

Type: Artifact Creature — Human Soldier

Oracle text:

> Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is this creature's power.

Re-rendered plain English:

```
Esper Sentinel [draft]
  [a1] triggered [needed: needs trigger:nth, step:unless_pay]
    Oracle: Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is this creature's power.
    Trigger: Whenever an opponent casts their first spell each turn
    Effect: Draw a card unless that player pays {X} (X = Esper Sentinel's power).
```

Player prompts:

- Esper Sentinel: pay or not: Do you want to pay {X}? If you don't, draw a card.

Implementation: needed (trigger:nth, step:unless_pay)

### Estrid's Invocation

Type: Enchantment

Oracle text:

> You may have this enchantment enter as a copy of an enchantment you control, except it has "At the beginning of your upkeep, you may exile this enchantment. If you do, return it to the battlefield under its owner's control."

Re-rendered plain English:

```
Estrid's Invocation [draft]
  [a1] replacement [needed: needs replacement:would_enter, step:copy, field:copy.addAbility, field:copy.asEnters, field:copy.what]
    Oracle: You may have this enchantment enter as a copy of an enchantment you control, except it has "At the beginning of your upkeep, you may exile this enchantment. If you do, return it to the battlefield under its owner's control."
    Replacement: If you would enter, instead: copy the target
    (optional: Do you want to use this ability?)
```

Player prompts:

- Estrid's Invocation: optional: Do you want to use this ability?
- Estrid's Invocation: optional: Do you want to apply this replacement?

Implementation: needed (replacement:would_enter, step:copy, field:copy.addAbility, field:copy.asEnters, field:copy.what)

Questions for you:

- A clone-as-enters replacement with an extra granted triggered ability: the copy step carries addAbility (loose passthrough record, not validated). The kernel needs a copy-with-exceptions capability.

### Extravagant Replication

Type: Enchantment

Oracle text:

> At the beginning of your upkeep, create a token that's a copy of another target nonland permanent you control.

Re-rendered plain English:

```
Extravagant Replication [draft]
  [a1] triggered [needed: needs step:copy, field:copy.controller, field:copy.token, field:copy.what]
    Oracle: At the beginning of your upkeep, create a token that's a copy of another target nonland permanent you control.
    Trigger: At the beginning of your upkeep
    Target t1: another target nonland permanent you control  <- prompt: "Choose another target nonland permanent you control."
    Effect: Copy the target.
```

Player prompts:

- Extravagant Replication: choose a target: Choose another target nonland permanent you control.

Implementation: needed (step:copy, field:copy.controller, field:copy.token, field:copy.what)

### Fear of Sleep Paralysis

Type: Enchantment Creature — Nightmare

Oracle text:

> Flying
> Eerie — Whenever this creature or another enchantment you control enters and whenever you fully unlock a Room, tap up to one target creature and put a stun counter on it.
> Stun counters can't be removed from permanents your opponents control. (They won't untap if they have stun counters.)

Re-rendered plain English:

```
Fear of Sleep Paralysis [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:multi_event, trigger:subject, trigger:unlock_door, targets:multi, step:add_counters, field:add_counters.on]
    Oracle: Eerie — Whenever this creature or another enchantment you control enters and whenever you fully unlock a Room, tap up to one target creature and put a stun counter on it.
    Trigger: Whenever Fear of Sleep Paralysis enters or an another enchantment you control enters or you unlock door
    Target t1: up to one target creature  <- prompt: "Choose up to one target creature."
    Effect: Tap up to one target creature. Then, put a stun counter on up to one target creature.
  [a3] scripted [needed: needs scripted:stun_counters_cant_be_removed_from_opponent_permanents]
    Oracle: Stun counters can't be removed from permanents your opponents control. (They won't untap if they have stun counters.)
    Scripted (engine-specific rule, not described by the fields above): stun_counters_cant_be_removed_from_opponent_permanents
```

Player prompts:

- Fear of Sleep Paralysis: choose a target: Choose up to one target creature.

Implementation: needed (trigger:multi_event, trigger:subject, trigger:unlock_door, targets:multi, step:add_counters, field:add_counters.on, scripted:stun_counters_cant_be_removed_from_opponent_permanents)

Questions for you:

- "Whenever you fully unlock a Room" has no event: written as an alsoOn alternative with event "unspecified" subject "you". The schema needs an event such as unlock_room (and "fully unlock").
- "Stun counters can't be removed from permanents your opponents control" is a restriction on counter removal; no static modifier exists, so it is a scripted marker.

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

### Heliod, the Radiant Dawn

Type: Legendary Enchantment Creature — God // Legendary Enchantment Creature — Phyrexian God

Oracle text:

> Heliod, the Radiant Dawn: When Heliod enters, return target enchantment card that isn't a God from your graveyard to your hand.
> {3}{U/P}: Transform Heliod. Activate only as a sorcery. ({U/P} can be paid with either {U} or 2 life.)
> 
> Heliod, the Warped Eclipse: You may cast spells as though they had flash.
> Spells you cast cost {1} less to cast for each card your opponents have drawn this turn.

Re-rendered plain English:

```
Heliod, the Radiant Dawn [draft]
  [a1] triggered [needed: needs filter:notSubtypes, field:move_card_zone.from]
    Oracle: Heliod, the Radiant Dawn: When Heliod enters, return target enchantment card that isn't a God from your graveyard to your hand.
    Trigger: Whenever Heliod, the Radiant Dawn enters
    Target t1: target non-God enchantment card in your graveyard  <- prompt: "Choose target non-God enchantment card in your graveyard."
    Effect: Put target non-God enchantment card in your graveyard into your hand.
  [a2] activated [needed: needs step:transform]
    Oracle: {3}{U/P}: Transform Heliod. Activate only as a sorcery. ({U/P} can be paid with either {U} or 2 life.)
    Cost: {3}{U/P}
    Timing: sorcery
    Effect: Transform Heliod, the Radiant Dawn.
  [a3] scripted [needed: needs scripted:cast_spells_as_though_flash]
    Oracle: Heliod, the Warped Eclipse: You may cast spells as though they had flash.
    Scripted (engine-specific rule, not described by the fields above): cast_spells_as_though_flash
    (optional: Do you want to use this ability?)
  [a4] static [needed: needs static, quantity:count_this_turn, static:costMod_quantity]
    Oracle: Spells you cast cost {1} less to cast for each card your opponents have drawn this turn.
    Static: Spells you control you cast cost {X}, where X is the number of things that draw this turn, less to cast
```

Player prompts:

- Heliod, the Radiant Dawn: choose a target: Choose target non-God enchantment card in your graveyard.
- Heliod, the Radiant Dawn: optional: Do you want to use this ability?

Implementation: needed (filter:notSubtypes, field:move_card_zone.from, step:transform, scripted:cast_spells_as_though_flash, static, quantity:count_this_turn, static:costMod_quantity)

Questions for you:

- Double-faced card: both faces live in one JSON (ability text prefixed with the face name as in the oracle text). The schema has no per-ability face field; the kernel needs to know that abilities a3-a4 belong to the back face (Heliod, the Warped Eclipse). The back-face flash permission is a scripted marker.

### Inkshield

Type: Instant

Oracle text:

> Prevent all combat damage that would be dealt to you this turn. For each 1 damage prevented this way, create a 2/1 white and black Inkling creature token with flying.

Re-rendered plain English:

```
Inkshield [draft]
  [a1] spell_effect [needed: needs step:grant_effect, field:grant_effect.replacement]
    Oracle: Prevent all combat damage that would be dealt to you this turn. For each 1 damage prevented this way, create a 2/1 white and black Inkling creature token with flying.
    Effect: The target gains an effect until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (step:grant_effect, field:grant_effect.replacement)

Questions for you:

- The shield (prevent all combat damage to you this turn) creates one Inkling per 1 damage prevented. Written as a grant_effect step carrying a replacement record (instead: create tokens with count = damage prevented). The schema cannot attach a replacement to a spell's resolution; kernel needs a prevention-shield-with-rider capability.

### Inquisitive Glimmer

Type: Enchantment Creature — Fox Glimmer

Oracle text:

> Enchantment spells you cast cost {1} less to cast.
> Unlock costs you pay cost {1} less.

Re-rendered plain English:

```
Inquisitive Glimmer [draft]
  [a1] static [needed: needs static]
    Oracle: Enchantment spells you cast cost {1} less to cast.
    Static: Enchantment spells you control you cast cost {1} less to cast
  [a2] scripted [needed: needs scripted:unlock_cost_reduction]
    Oracle: Unlock costs you pay cost {1} less.
    Scripted (engine-specific rule, not described by the fields above): unlock_cost_reduction
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, scripted:unlock_cost_reduction)

Questions for you:

- "Unlock costs you pay cost {1} less" (Room unlocking) has no cost-modification target: scripted marker unlock_cost_reduction.

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

### Lim-Dûl's Vault

Type: Instant

Oracle text:

> Look at the top five cards of your library. As many times as you choose, you may pay 1 life, put those cards on the bottom of your library in any order, then look at the top five cards of your library. Then shuffle and put the last cards you looked at this way on top in any order.

Re-rendered plain English:

```
Lim-Dûl's Vault [draft]
  [a1] spell_effect [needed: needs step:look_top, step:repeat_for_each, field:repeat_for_each.repeatCount, field:repeat_for_each.steps, field:move_card_zone.ordered, field:move_card_zone.position, field:move_card_zone.what, step:shuffle, field:shuffle.exceptLooked]
    Oracle: Look at the top five cards of your library. As many times as you choose, you may pay 1 life, put those cards on the bottom of your library in any order, then look at the top five cards of your library. Then shuffle and put the last cards you looked at this way on top in any order.
    Effect: Look at the top five cards of your library. Then, you may repeat for each matching object. Then, shuffle. Then, put the rest of the looked-at cards on the top of your library.
```

Player prompts:

- Lim-Dûl's Vault: Pay 1 life, put these cards on the bottom of your library in any order, and look at the top five cards again?

Implementation: needed (step:look_top, step:repeat_for_each, field:repeat_for_each.repeatCount, field:repeat_for_each.steps, field:move_card_zone.ordered, field:move_card_zone.position, field:move_card_zone.what, step:shuffle, field:shuffle.exceptLooked)

Questions for you:

- "As many times as you choose, you may pay 1 life ... then look at the top five again" is an optional loop chosen by the player. repeat_for_each has no "repeat while the player says yes" form; written as repeat_for_each with repeatCount "as_many_as_you_choose" (passthrough). Needs a loop-with-prompt step. The kernel loop guard (player names an iteration count) fits.

### Mind's Dilation

Type: Enchantment

Oracle text:

> Whenever an opponent casts their first spell each turn, that player exiles the top card of their library. If it's a nonland card, you may cast it without paying its mana cost.

Re-rendered plain English:

```
Mind's Dilation [draft]
  [a1] triggered [needed: needs ref:linked_exile, trigger:nth, field:move_card_zone.linkExile, field:move_card_zone.what, field:move_card_zone.who, step:permission_to_play, field:permission_to_play.what, field:permission_to_play.withoutPaying, field:permission_to_play.zone, predicate:matches]
    Oracle: Whenever an opponent casts their first spell each turn, that player exiles the top card of their library. If it's a nonland card, you may cast it without paying its mana cost.
    Trigger: Whenever an opponent casts their first spell each turn
    Effect: Exile a card. Then, IF the card exiled with Mind's Dilation is a nonland permanent: you may cast or play the card exiled with Mind's Dilation without paying its mana cost.
```

Player prompts:

- Mind's Dilation: optional: Do you want to cast or play the card exiled with Mind's Dilation without paying its mana cost?

Implementation: needed (ref:linked_exile, trigger:nth, field:move_card_zone.linkExile, field:move_card_zone.what, field:move_card_zone.who, step:permission_to_play, field:permission_to_play.what, field:permission_to_play.withoutPaying, field:permission_to_play.zone, predicate:matches)

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

### Mystic Remora

Type: Enchantment

Oracle text:

> Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)
> Whenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.

Re-rendered plain English:

```
Mystic Remora [draft]
  [a1] triggered [needed: needs step:add_counters, field:add_counters.on, field:sacrifice_permanent.costPerCounter, step:unless_pay]
    Oracle: Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)
    Trigger: At the beginning of your upkeep
    Effect: Put a age counter on Mystic Remora. Then, sacrifice a permanent unless you pay {1}.
    Keyword: cumulative_upkeep {1}
  [a2] triggered [needed: needs step:unless_pay]
    Oracle: Whenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.
    Trigger: Whenever an opponent casts a noncreature spell
    Effect: You may draw a card unless that player pays {4}.
    (optional: Do you want to draw a card?)
```

Player prompts:

- Mystic Remora: sacrifice: Choose a permanent to sacrifice.
- Mystic Remora: pay or not: Do you want to pay {1}? If you don't, sacrifice a permanent.
- Mystic Remora: optional: Do you want to draw a card?
- Mystic Remora: pay or not: Do you want to pay {4}? If you don't, draw a card.

Implementation: needed (step:add_counters, field:add_counters.on, field:sacrifice_permanent.costPerCounter, step:unless_pay)

Questions for you:

- Cumulative upkeep: the unlessPay cost is {1} PER age counter; unlessPay has no multiplier, so the step carries a passthrough field costPerCounter:"age". Needs a Quantity-scaled payment.

### Omniscience

Type: Enchantment

Oracle text:

> You may cast spells from your hand without paying their mana costs.

Re-rendered plain English:

```
Omniscience [draft]
  [a1] scripted [needed: needs scripted:free_cast_from_hand]
    Oracle: You may cast spells from your hand without paying their mana costs.
    Scripted (engine-specific rule, not described by the fields above): free_cast_from_hand
    (optional: Do you want to use this ability?)
```

Player prompts:

- Omniscience: optional: Do you want to use this ability?

Implementation: needed (scripted:free_cast_from_hand)

Questions for you:

- A static permission to cast other cards for free has no schema form (same gap as Dracogenesis): scripted marker free_cast_from_hand.

### One with the Multiverse

Type: Enchantment

Oracle text:

> You may look at the top card of your library any time.
> You may play lands and cast spells from the top of your library.
> Once during each of your turns, you may cast a spell from your hand or the top of your library without paying its mana cost.

Re-rendered plain English:

```
One with the Multiverse [draft]
  [a1] scripted [needed: needs scripted:look_at_top_card_any_time]
    Oracle: You may look at the top card of your library any time.
    Scripted (engine-specific rule, not described by the fields above): look_at_top_card_any_time
    (optional: Do you want to use this ability?)
  [a2] scripted [needed: needs scripted:play_from_top_of_library]
    Oracle: You may play lands and cast spells from the top of your library.
    Scripted (engine-specific rule, not described by the fields above): play_from_top_of_library
    (optional: Do you want to use this ability?)
  [a3] scripted [needed: needs scripted:free_cast_once_per_turn, timing]
    Oracle: Once during each of your turns, you may cast a spell from your hand or the top of your library without paying its mana cost.
    Timing: 1 per turn
    Scripted (engine-specific rule, not described by the fields above): free_cast_once_per_turn
    (optional: Do you want to use this ability?)
```

Player prompts:

- One with the Multiverse: optional: Do you want to use this ability?

Implementation: needed (scripted:look_at_top_card_any_time, scripted:play_from_top_of_library, scripted:free_cast_once_per_turn, timing)

Questions for you:

- Three scripted permission markers (look at top card any time, play from top of library, once-per-turn free cast): the schema has no zone-permission static modifier.

### Otherworldly Gaze

Type: Instant

Oracle text:

> Surveil 3. (Look at the top three cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
> Flashback {1}{U} (You may cast this card from your graveyard for its flashback cost. Then exile it.)

Re-rendered plain English:

```
Otherworldly Gaze [draft]
  Cast option c1: you may use flashback (from graveyard, cost {1}{U}, replaces mana cost) [needed]
  [a1] spell_effect [needed: needs step:surveil]
    Oracle: Surveil 3. (Look at the top three cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
    Effect: Surveil 3.
```

Player prompts:

- Otherworldly Gaze: flashback option: Do you want to cast it using its flashback cost ({1}{U})?

Implementation: needed (step:surveil, cast_option:flashback)

### Overwhelming Splendor

Type: Enchantment — Aura Curse

Oracle text:

> Enchant player
> Creatures enchanted player controls lose all abilities and have base power and toughness 1/1.
> Enchanted player can't activate abilities that aren't mana abilities or loyalty abilities.

Re-rendered plain English:

```
Overwhelming Splendor [draft]
  [a1] spell_effect [needed: needs keyword:enchant]
    Oracle: Enchant player
    Target t1: target player  <- prompt: "Choose target player."
    Keyword: enchant
  [a2] static [needed: needs static, static:setBasePT]
    Oracle: Creatures enchanted player controls lose all abilities and have base power and toughness 1/1.
    Static: Creatures the enchanted player controls lose all abilities and have base power and toughness 1/1
  [a3] scripted [needed: needs scripted:enchanted_player_cant_activate_nonmana_nonloyalty_abilities]
    Oracle: Enchanted player can't activate abilities that aren't mana abilities or loyalty abilities.
    Scripted (engine-specific rule, not described by the fields above): enchanted_player_cant_activate_nonmana_nonloyalty_abilities
```

Player prompts:

- Overwhelming Splendor: choose a target: Choose target player.

Implementation: needed (keyword:enchant, static, static:setBasePT, scripted:enchanted_player_cant_activate_nonmana_nonloyalty_abilities)

Questions for you:

- No way to refer to "the enchanted player" or "creatures enchanted player controls" in an ObjectFilter (controller has only you/opponent/any/defending_player). Written with controller:"opponent", which is only right in a 2-player game; the kernel must resolve it to the enchanted player. Needs controller:"enchanted_player".
- "Enchanted player can't activate abilities..." is a restriction on a player: scripted marker (cant has no "activate" value).

### Portent

Type: Sorcery

Oracle text:

> Look at the top three cards of target player's library, then put them back in any order. You may have that player shuffle.
> Draw a card at the beginning of the next turn's upkeep.

Re-rendered plain English:

```
Portent [draft]
  [a1] spell_effect [needed: needs step:look_top, field:look_top.who, field:move_card_zone.ordered, field:move_card_zone.position, field:move_card_zone.what, step:shuffle, field:shuffle.who, step:create_delayed_trigger, field:create_delayed_trigger.at, field:create_delayed_trigger.steps]
    Oracle: Look at the top three cards of target player's library, then put them back in any order. You may have that player shuffle. / Draw a card at the beginning of the next turn's upkeep.
    Target t1: target player  <- prompt: "Choose target player."
    Effect: Look at the top three cards of your library. Then, put the rest of the looked-at cards on the top of your library. Then, you may shuffle. Then, create a delayed trigger.
```

Player prompts:

- Portent: choose a target: Choose target player.
- Portent: optional: Do you want to shuffle?

Implementation: needed (step:look_top, field:look_top.who, field:move_card_zone.ordered, field:move_card_zone.position, field:move_card_zone.what, step:shuffle, field:shuffle.who, step:create_delayed_trigger, field:create_delayed_trigger.at, field:create_delayed_trigger.steps)

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

### Propaganda

Type: Enchantment

Oracle text:

> Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.

Re-rendered plain English:

```
Propaganda [approved]
  [a1] static [needed: needs static, static:attackTax]
    Oracle: Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.
    Static: Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, static:attackTax)

### Redress Fate

Type: Sorcery

Oracle text:

> Return all artifact and enchantment cards from your graveyard to the battlefield.
> Miracle {3}{W} (You may cast this card for its miracle cost when you draw it if it's the first card you drew this turn.)

Re-rendered plain English:

```
Redress Fate [draft]
  Cast option c1: you may use miracle (from hand, cost {3}{W}, replaces mana cost) [needed]
  [a1] spell_effect [needed: needs field:reanimate.all, field:reanimate.filter]
    Oracle: Return all artifact and enchantment cards from your graveyard to the battlefield.
    Effect: Return a card from the graveyard to the battlefield.
```

Player prompts:

- Redress Fate: miracle option: Do you want to cast it using its miracle cost ({3}{W})?

Implementation: needed (field:reanimate.all, field:reanimate.filter, cast_option:miracle)

### Secret Arcade

Type: Enchantment — Room // Enchantment — Room

Oracle text:

> Secret Arcade: Nonland permanents you control and permanent spells you control are enchantments in addition to their other types.
> (You may cast either half. That door unlocks on the battlefield. As a sorcery, you may pay the mana cost of a locked door to unlock it.)
> 
> Dusty Parlor: Whenever you cast an enchantment spell, put a number of +1/+1 counters equal to that spell's mana value on up to one target creature.
> (You may cast either half. That door unlocks on the battlefield. As a sorcery, you may pay the mana cost of a locked door to unlock it.)

Re-rendered plain English:

```
Secret Arcade [draft]
  [a1] static [needed: needs static, static:addTypes, face]
    Oracle: Secret Arcade: Nonland permanents you control and permanent spells you control are enchantments in addition to their other types.
    Static: Nonland permanents you control or permanent spells you control are enchantments in addition to their other types
  [a2] triggered [needed: needs targets:multi, face, step:add_counters, quantity:stat, field:add_counters.on]
    Oracle: Dusty Parlor: Whenever you cast an enchantment spell, put a number of +1/+1 counters equal to that spell's mana value on up to one target creature.
    Trigger: Whenever you cast an enchantment spell
    Target t1: up to one target creature  <- prompt: "Choose up to one target creature."
    Effect: Put that object's mana value +1/+1 counters on up to one target creature.
```

Player prompts:

- Secret Arcade: choose a target: Choose up to one target creature.

Implementation: needed (static, static:addTypes, face, targets:multi, step:add_counters, quantity:stat, field:add_counters.on)

Questions for you:

- Room: two doors in one JSON (ability text prefixed by the door name as in the oracle text). The schema has no door/unlock state: the kernel must know a3-a4 only apply while that door is unlocked, and "permanent spells you control are enchantments" also applies on the stack. The reminder lines about casting/unlocking a Room are kernel rules.

### Shadow of the Second Sun

Type: Enchantment — Aura

Oracle text:

> Enchant player
> At the beginning of each of enchanted player's postcombat main phases, there is an additional beginning phase after this phase. (The end step happens after the added untap, upkeep, and draw steps.)

Re-rendered plain English:

```
Shadow of the Second Sun [draft]
  [a1] spell_effect [needed: needs keyword:enchant]
    Oracle: Enchant player
    Target t1: target player  <- prompt: "Choose target player."
    Keyword: enchant
  [a2] triggered [needed: needs scripted:additional_beginning_phase, trigger:begin_step:postcombat_main, trigger:subject]
    Oracle: At the beginning of each of enchanted player's postcombat main phases, there is an additional beginning phase after this phase. (The end step happens after the added untap, upkeep, and draw steps.)
    Trigger: At the beginning of each second main phase
    Scripted (engine-specific rule, not described by the fields above): additional_beginning_phase
```

Player prompts:

- Shadow of the Second Sun: choose a target: Choose target player.

Implementation: needed (keyword:enchant, scripted:additional_beginning_phase, trigger:begin_step:postcombat_main, trigger:subject)

Questions for you:

- "An additional beginning phase after this phase" (untap, upkeep, draw again) has no step kind (extra_combat exists, nothing for other phases): scripted marker additional_beginning_phase on the trigger. The trigger is "at the beginning of each of the ENCHANTED PLAYER's postcombat main phases"; encoded with subject:"enchanted".

### Shark Typhoon

Type: Enchantment

Oracle text:

> Whenever you cast a noncreature spell, create an X/X blue Shark creature token with flying, where X is that spell's mana value.
> Cycling {X}{1}{U} ({X}{1}{U}, Discard this card: Draw a card.)
> When you cycle this card, create an X/X blue Shark creature token with flying.

Re-rendered plain English:

```
Shark Typhoon [draft]
  [a1] triggered [needed: needs quantity:stat, field:create_tokens.tokenKeywords]
    Oracle: Whenever you cast a noncreature spell, create an X/X blue Shark creature token with flying, where X is that spell's mana value.
    Trigger: Whenever you cast a noncreature spell
    Effect: Create a that object's mana value/that object's mana value blue Shark creature token with flying.
  [a2] activated (from hand) [needed: needs zone:hand, cost:x, cost:discard]
    Oracle: Cycling {X}{1}{U} ({X}{1}{U}, Discard this card: Draw a card.)
    Cost: {X}{1}{U}, discard Shark Typhoon
    Effect: Draw a card.
    Keyword: cycling {X}{1}{U}
    X prompt: "Choose a value for X (paid in mana)."
  [a3] triggered (from hand) [needed: needs zone:hand, trigger:cycle, quantity:X, field:create_tokens.tokenKeywords]
    Oracle: When you cycle this card, create an X/X blue Shark creature token with flying.
    Trigger: Whenever a player cycles Shark Typhoon
    Effect: Create a X/X blue Shark creature token with flying.
```

Player prompts:

- Shark Typhoon: choose X: Choose a value for X (paid in mana).

Implementation: needed (quantity:stat, field:create_tokens.tokenKeywords, zone:hand, cost:x, cost:discard, trigger:cycle, quantity:X)

Questions for you:

- The X of the cycling trigger is the X paid for the cycling cost (linked ability payload, spec gap 4); written as {ref:"X"} and the kernel must carry X from the cycling activation to its trigger.

### Soaring Lightbringer

Type: Enchantment Creature — Bird Glimmer

Oracle text:

> Flying
> Other enchantment creatures you control have flying.
> Whenever you attack a player, create a 1/1 white Glimmer enchantment creature token that's tapped and attacking that player.

Re-rendered plain English:

```
Soaring Lightbringer [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] static [needed: needs static]
    Oracle: Other enchantment creatures you control have flying.
    Static: Other enchantment creatures you control have flying
  [a3] triggered [needed: needs trigger:batch, field:create_tokens.attackTarget, field:create_tokens.tokenAttacking, field:create_tokens.tokenTapped]
    Oracle: Whenever you attack a player, create a 1/1 white Glimmer enchantment creature token that's tapped and attacking that player.
    Trigger: Whenever you attack
    Effect: Create a 1/1 white Glimmer enchantment creature token tapped and attacking.
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, trigger:batch, field:create_tokens.attackTarget, field:create_tokens.tokenAttacking, field:create_tokens.tokenTapped)

Questions for you:

- "Whenever you attack a player" fires once per player attacked (not per attacker) and needs that player for the token to attack: encoded as an attack trigger with batch:true and token field attackTarget:"that_player". The schema has no "attacks a player" event payload.

### Sphere of Safety

Type: Enchantment

Oracle text:

> Creatures can't attack you or planeswalkers you control unless their controller pays {X} for each of those creatures, where X is the number of enchantments you control.

Re-rendered plain English:

```
Sphere of Safety [draft]
  [a1] static [needed: needs scripted:attack_tax_per_enchantment, static, static:attackTax]
    Oracle: Creatures can't attack you or planeswalkers you control unless their controller pays {X} for each of those creatures, where X is the number of enchantments you control.
    Scripted (engine-specific rule, not described by the fields above): attack_tax_per_enchantment
    Static: Creatures can't attack you or planeswalkers you control unless their controller pays {X} for each creature they control that's attacking a protected player or planeswalker
```

Player prompts:

- (none: no decisions)

Implementation: needed (scripted:attack_tax_per_enchantment, static, static:attackTax)

Questions for you:

- attackTax.cost is a string, so the variable X (number of enchantments you control) is carried in scripted.params.x on the ability. Needs attackTax.cost as a Quantity-scaled cost.

### Starfield of Nyx

Type: Enchantment

Oracle text:

> At the beginning of your upkeep, you may return target enchantment card from your graveyard to the battlefield.
> As long as you control five or more enchantments, each other non-Aura enchantment you control is a creature in addition to its other types and has base power and base toughness each equal to its mana value.

Re-rendered plain English:

```
Starfield of Nyx [draft]
  [a1] triggered [implemented]
    Oracle: At the beginning of your upkeep, you may return target enchantment card from your graveyard to the battlefield.
    Trigger: At the beginning of your upkeep
    Target t1: target enchantment card in your graveyard  <- prompt: "Choose target enchantment card in your graveyard."
    Effect: You may return target enchantment card in your graveyard from the graveyard to the battlefield.
    (optional: Do you want to return target enchantment card in your graveyard from the graveyard to the battlefield?)
  [a2] static [needed: needs static, ref:iterated, filter:notSubtypes, static:addTypes, static:setBasePT]
    Oracle: As long as you control five or more enchantments, each other non-Aura enchantment you control is a creature in addition to its other types and has base power and base toughness each equal to its mana value.
    Static: Other non-Aura enchantments you control are creatures in addition to their other types and have the power and toughness of that object as long as you control five or more enchantments
```

Player prompts:

- Starfield of Nyx: choose a target: Choose target enchantment card in your graveyard.
- Starfield of Nyx: optional: Do you want to return target enchantment card in your graveyard from the graveyard to the battlefield?

Implementation: needed (static, ref:iterated, filter:notSubtypes, static:addTypes, static:setBasePT)

Questions for you:

- "Base power and toughness each equal to ITS mana value": the quantity refers to each affected permanent, not the source. Written with ObjRef "iterated" (normally the repeat_for_each object); the schema has no "the affected object" ref for static modifiers.

### Sunken Palace

Type: Land — Cave

Oracle text:

> This land enters tapped.
> {T}: Add {U}.
> {1}{U}, {T}, Exile seven cards from your graveyard: Add {U}. When you spend this mana to cast a spell or activate an ability, copy that spell or ability. You may choose new targets for the copy. (Mana abilities can't be copied.)

Re-rendered plain English:

```
Sunken Palace [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped.
    Replacement: If Sunken Palace would enter, it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {U}.
    Cost: {T}
    Mana: add {U}
  [a3] mana [needed: needs scripted:copy_spell_or_ability_when_mana_spent, cost:exileFrom, step:copy, field:copy.chooseNewTargets]
    Oracle: {1}{U}, {T}, Exile seven cards from your graveyard: Add {U}. When you spend this mana to cast a spell or activate an ability, copy that spell or ability. You may choose new targets for the copy. (Mana abilities can't be copied.)
    Cost: {1}{U}, {T}, exile 7 cards in your graveyard
    Effect: You may copy that object.
    Scripted (engine-specific rule, not described by the fields above): copy_spell_or_ability_when_mana_spent
    Mana: add {U}
```

Player prompts:

- Sunken Palace: choose what to exile: Choose 7 cards in your graveyard to exile.
- Sunken Palace: optional: Do you want to copy that object?

Implementation: needed (replacement:would_enter, scripted:copy_spell_or_ability_when_mana_spent, cost:exileFrom, step:copy, field:copy.chooseNewTargets)

### Tainted Field

Type: Land

Oracle text:

> {T}: Add {C}.
> {T}: Add {W} or {B}. Activate only if you control a Swamp.

Re-rendered plain English:

```
Tainted Field [draft]
  [a1] mana [implemented]
    Oracle: {T}: Add {C}.
    Cost: {T}
    Mana: add {C}
  [a2] mana [needed: needs timing]
    Oracle: {T}: Add {W} or {B}. Activate only if you control a Swamp.
    Cost: {T}
    Timing: you control a Swamp
    Mana: add {W}
  [a3] mana [needed: needs timing]
    Oracle: {T}: Add {W} or {B}. Activate only if you control a Swamp.
    Cost: {T}
    Timing: you control a Swamp
    Mana: add {B}
```

Player prompts:

- (none: no decisions)

Implementation: needed (timing)

### Temporal Mastery

Type: Sorcery

Oracle text:

> Take an extra turn after this one. Exile Temporal Mastery.
> Miracle {1}{U} (You may cast this card for its miracle cost when you draw it if it's the first card you drew this turn.)

Re-rendered plain English:

```
Temporal Mastery [draft]
  Cast option c1: you may use miracle (from hand, cost {1}{U}, replaces mana cost) [needed]
  [a1] spell_effect [needed: needs step:extra_turn]
    Oracle: Take an extra turn after this one. Exile Temporal Mastery.
    Effect: Take an extra turn after this one. Then, exile Temporal Mastery.
```

Player prompts:

- Temporal Mastery: miracle option: Do you want to cast it using its miracle cost ({1}{U})?

Implementation: needed (step:extra_turn, cast_option:miracle)

### Thriving Heath

Type: Land

Oracle text:

> This land enters tapped. As it enters, choose a color other than white.
> {T}: Add {W} or one mana of the chosen color.

Re-rendered plain English:

```
Thriving Heath [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped. As it enters, choose a color other than white.
    Replacement: If Thriving Heath would enter, it enters tapped
  [a2] replacement [needed: needs replacement:would_enter, step:choose, field:choose.choice, field:choose.exclude, field:choose.remember]
    Oracle: This land enters tapped. As it enters, choose a color other than white.
    Replacement: If Thriving Heath would enter, also: choose a color
  [a3] mana [implemented]
    Oracle: {T}: Add {W} or one mana of the chosen color.
    Cost: {T}
    Mana: add {W}
  [a4] mana [needed: needs mana:variable, filter:chosenColor, mana:chosen_color]
    Oracle: {T}: Add {W} or one mana of the chosen color.
    Cost: {T}
    Mana: add one mana of the chosen color
```

Player prompts:

- Thriving Heath: choose: Choose a color.

Implementation: needed (replacement:would_enter, step:choose, field:choose.choice, field:choose.exclude, field:choose.remember, mana:variable, filter:chosenColor, mana:chosen_color)

### Thriving Isle

Type: Land

Oracle text:

> This land enters tapped. As it enters, choose a color other than blue.
> {T}: Add {U} or one mana of the chosen color.

Re-rendered plain English:

```
Thriving Isle [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped. As it enters, choose a color other than blue.
    Replacement: If Thriving Isle would enter, it enters tapped
  [a2] replacement [needed: needs replacement:would_enter, step:choose, field:choose.choice, field:choose.exclude, field:choose.remember]
    Oracle: This land enters tapped. As it enters, choose a color other than blue.
    Replacement: If Thriving Isle would enter, also: choose a color
  [a3] mana [implemented]
    Oracle: {T}: Add {U} or one mana of the chosen color.
    Cost: {T}
    Mana: add {U}
  [a4] mana [needed: needs mana:variable, filter:chosenColor, mana:chosen_color]
    Oracle: {T}: Add {U} or one mana of the chosen color.
    Cost: {T}
    Mana: add one mana of the chosen color
```

Player prompts:

- Thriving Isle: choose: Choose a color.

Implementation: needed (replacement:would_enter, step:choose, field:choose.choice, field:choose.exclude, field:choose.remember, mana:variable, filter:chosenColor, mana:chosen_color)

### Thriving Moor

Type: Land

Oracle text:

> This land enters tapped. As it enters, choose a color other than black.
> {T}: Add {B} or one mana of the chosen color.

Re-rendered plain English:

```
Thriving Moor [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped. As it enters, choose a color other than black.
    Replacement: If Thriving Moor would enter, it enters tapped
  [a2] replacement [needed: needs replacement:would_enter, step:choose, field:choose.choice, field:choose.exclude, field:choose.remember]
    Oracle: This land enters tapped. As it enters, choose a color other than black.
    Replacement: If Thriving Moor would enter, also: choose a color
  [a3] mana [implemented]
    Oracle: {T}: Add {B} or one mana of the chosen color.
    Cost: {T}
    Mana: add {B}
  [a4] mana [needed: needs mana:variable, filter:chosenColor, mana:chosen_color]
    Oracle: {T}: Add {B} or one mana of the chosen color.
    Cost: {T}
    Mana: add one mana of the chosen color
```

Player prompts:

- Thriving Moor: choose: Choose a color.

Implementation: needed (replacement:would_enter, step:choose, field:choose.choice, field:choose.exclude, field:choose.remember, mana:variable, filter:chosenColor, mana:chosen_color)

### Timely Ward

Type: Enchantment — Aura

Oracle text:

> You may cast this spell as though it had flash if it targets a commander.
> Enchant creature
> Enchanted creature has indestructible.

Re-rendered plain English:

```
Timely Ward [draft]
  [a1] scripted (from hand) [needed: needs scripted:flash_if_targets_commander, zone:hand]
    Oracle: You may cast this spell as though it had flash if it targets a commander.
    Timing: flash
    Scripted (engine-specific rule, not described by the fields above): flash_if_targets_commander
    (optional: Do you want to use this ability?)
  [a2] spell_effect [needed: needs keyword:enchant]
    Oracle: Enchant creature
    Target t1: target creature  <- prompt: "Choose target creature."
    Keyword: enchant
  [a3] static [needed: needs static]
    Oracle: Enchanted creature has indestructible.
    Static: The enchanted creature has indestructible
```

Player prompts:

- Timely Ward: optional: Do you want to use this ability?
- Timely Ward: choose a target: Choose target creature.

Implementation: needed (scripted:flash_if_targets_commander, zone:hand, keyword:enchant, static)

Questions for you:

- Conditional flash ("as though it had flash if it targets a commander") is a casting-timing condition on a target; encoded as a scripted marker flash_if_targets_commander. castOptions/timing have no "if it targets" predicate.

### Vanishing

Type: Enchantment — Aura

Oracle text:

> Enchant creature
> {U}{U}: Enchanted creature phases out. (While it's phased out, it's treated as though it doesn't exist. It phases in before its controller untaps during their next untap step.)

Re-rendered plain English:

```
Vanishing [draft]
  [a1] spell_effect [needed: needs keyword:enchant]
    Oracle: Enchant creature
    Target t1: target creature  <- prompt: "Choose target creature."
    Keyword: enchant
  [a2] activated [needed: needs step:grant_effect, field:grant_effect.modify, field:grant_effect.phaseOut]
    Oracle: {U}{U}: Enchanted creature phases out. (While it's phased out, it's treated as though it doesn't exist. It phases in before its controller untaps during their next untap step.)
    Cost: {U}{U}
    Effect: The enchanted creature gains phased out.
```

Player prompts:

- Vanishing: choose a target: Choose target creature.

Implementation: needed (keyword:enchant, step:grant_effect, field:grant_effect.modify, field:grant_effect.phaseOut)

Questions for you:

- No phase_out step kind (or phased-out state): written as grant_effect with phaseOut:true; it phases in during its controller's next untap step. The kernel needs phasing.

### Virtue of Persistence

Type: Enchantment // Sorcery — Adventure

Oracle text:

> Virtue of Persistence: At the beginning of your upkeep, put target creature card from a graveyard onto the battlefield under your control.
> 
> Locthwain Scorn: Target creature gets -3/-3 until end of turn. You gain 2 life.

Re-rendered plain English:

```
Virtue of Persistence [draft]
  [a1] triggered [implemented]
    Oracle: Virtue of Persistence: At the beginning of your upkeep, put target creature card from a graveyard onto the battlefield under your control.
    Trigger: At the beginning of your upkeep
    Target t1: target creature card in a graveyard  <- prompt: "Choose target creature card in a graveyard."
    Effect: Return target creature card in a graveyard from the graveyard to the battlefield.
  [a2] spell_effect [implemented]
    Oracle: Locthwain Scorn: Target creature gets -3/-3 until end of turn. You gain 2 life.
    Target t2: target creature  <- prompt: "Choose target creature."
    Effect: Target creature gets -3/-3 until end of turn. Then, gain 2 life.
```

Player prompts:

- Virtue of Persistence: choose a target: Choose target creature card in a graveyard.
- Virtue of Persistence: choose a target: Choose target creature.

Implementation: implemented

Questions for you:

- Adventure card: the Adventure half (Locthwain Scorn) is a second spell_effect on the same card. Its mana cost ({1}{B}) is NOT in data/cards.db oracle text, so no cast option is written (validator would reject the mana symbols); there is no adventure cast option kind (cast Locthwain Scorn from hand, exile it, later cast the enchantment from exile). Needs an "adventure" cast option.

### Zur, Eternal Schemer

Type: Legendary Creature — Human Wizard

Oracle text:

> Flying
> Enchantment creatures you control have deathtouch, lifelink, and hexproof.
> {1}{W}: Target non-Aura enchantment you control becomes a creature in addition to its other types and has base power and base toughness each equal to its mana value.

Re-rendered plain English:

```
Zur, Eternal Schemer [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] static [needed: needs static]
    Oracle: Enchantment creatures you control have deathtouch, lifelink, and hexproof.
    Static: Enchantment creatures you control have deathtouch and have lifelink and have hexproof
  [a3] activated [needed: needs filter:notSubtypes, step:grant_effect, field:grant_effect.modify]
    Oracle: {1}{W}: Target non-Aura enchantment you control becomes a creature in addition to its other types and has base power and base toughness each equal to its mana value.
    Cost: {1}{W}
    Target t1: target non-Aura enchantment you control  <- prompt: "Choose target non-Aura enchantment you control."
    Effect: Target non-Aura enchantment you control becomes a creature in addition to its other types and has the power and toughness of t1.
```

Player prompts:

- Zur, Eternal Schemer: choose a target: Choose target non-Aura enchantment you control.

Implementation: needed (static, filter:notSubtypes, step:grant_effect, field:grant_effect.modify)

Questions for you:

- Zur's activated ability has no duration in the oracle text (the enchantment stays a creature permanently, until it leaves the battlefield). duration is therefore omitted; the schema has no explicit "indefinite" duration value, so the omission has to mean permanent. Needs duration "indefinite".

## Kernel to-do: missing capabilities across this deck

| capability | cards | needing it |
|---|---|---|
| `static` | 17 | Aminatou, Veil Piercer; Archon of Sun's Grace; Athreos, Shroud-Veiled; Boon of the Spirit Realm; Callaphe, Beloved of the Sea; Heliod, the Radiant Dawn; Inquisitive Glimmer; Overwhelming Splendor; Propaganda; Secret Arcade; Soaring Lightbringer; Sphere of Safety; Starfield of Nyx; Timely Ward; Utter Insignificance; Void Rend; Zur, Eternal Schemer |
| `replacement:would_enter` | 15 | Arcane Sanctum; Contaminated Aquifer; Drowned Catacomb; Estrid's Invocation; Glacial Fortress; Halimar Depths; Isolated Chapel; Myriad Landscape; Prairie Stream; Sunken Palace; Temple of Deceit; Temple of Silence; Thriving Heath; Thriving Isle; Thriving Moor |
| `field:move_card_zone.what` | 11 | Aminatou, the Fateshifter; Archaeomancer's Map; Brainstorm; Brainsurge; Diabolic Vision; Enhanced Surveillance; Halimar Depths; Lim-Dûl's Vault; Mind's Dilation; Ponder; Portent |
| `step:choose` | 9 | Aminatou, the Fateshifter; Arcane Denial; Archaeomancer's Map; Brainstorm; Brainsurge; Diabolic Vision; Thriving Heath; Thriving Isle; Thriving Moor |
| `field:move_card_zone.position` | 8 | Aminatou, the Fateshifter; Brainstorm; Brainsurge; Diabolic Vision; Halimar Depths; Lim-Dûl's Vault; Ponder; Portent |
| `trigger:subject` | 8 | Archaeomancer's Map; Archon of Sun's Grace; Athreos, Shroud-Veiled; Boon of the Spirit Realm; Doomwake Giant; Fear of Sleep Paralysis; Ledger Shredder; Shadow of the Second Sun |
| `field:move_card_zone.ordered` | 7 | Brainstorm; Brainsurge; Diabolic Vision; Halimar Depths; Lim-Dûl's Vault; Ponder; Portent |
| `field:damage_target.source` | 6 | Adarkar Wastes; Caves of Koilos; Talisman of Dominance; Talisman of Hierarchy; Talisman of Progress; Underground River |
| `field:search_library.count` | 6 | Archaeomancer's Map; Evolving Wilds; Moon-Blessed Cleric; Myriad Landscape; Obscura Storefront; Wayfarer's Bauble |
| `field:search_library.filter` | 6 | Archaeomancer's Map; Evolving Wilds; Moon-Blessed Cleric; Myriad Landscape; Obscura Storefront; Wayfarer's Bauble |
| `field:search_library.shuffle` | 6 | Archaeomancer's Map; Evolving Wilds; Moon-Blessed Cleric; Myriad Landscape; Obscura Storefront; Wayfarer's Bauble |
| `field:search_library.to` | 6 | Archaeomancer's Map; Evolving Wilds; Moon-Blessed Cleric; Myriad Landscape; Obscura Storefront; Wayfarer's Bauble |
| `step:search_library` | 6 | Archaeomancer's Map; Evolving Wilds; Moon-Blessed Cleric; Myriad Landscape; Obscura Storefront; Wayfarer's Bauble |
| `field:add_counters.on` | 5 | Athreos, Shroud-Veiled; Boon of the Spirit Realm; Fear of Sleep Paralysis; Mystic Remora; Secret Arcade |
| `field:choose.choice` | 5 | Aminatou, the Fateshifter; Arcane Denial; Thriving Heath; Thriving Isle; Thriving Moor |
| `field:choose.count` | 5 | Aminatou, the Fateshifter; Archaeomancer's Map; Brainstorm; Brainsurge; Diabolic Vision |
| `field:choose.from` | 5 | Aminatou, the Fateshifter; Archaeomancer's Map; Brainstorm; Brainsurge; Diabolic Vision |
| `field:choose.saveAs` | 5 | Aminatou, the Fateshifter; Archaeomancer's Map; Brainstorm; Brainsurge; Diabolic Vision |
| `keyword:enchant` | 5 | Overwhelming Splendor; Shadow of the Second Sun; Timely Ward; Utter Insignificance; Vanishing |
| `mana:variable` | 5 | Arcane Signet; Command Tower; Thriving Heath; Thriving Isle; Thriving Moor |
| `step:add_counters` | 5 | Athreos, Shroud-Veiled; Boon of the Spirit Realm; Fear of Sleep Paralysis; Mystic Remora; Secret Arcade |
| `step:look_top` | 5 | Diabolic Vision; Halimar Depths; Lim-Dûl's Vault; Ponder; Portent |
| `cost:sacrifice` | 4 | Demon of Fate's Design; Evolving Wilds; Myriad Landscape; Wayfarer's Bauble |
| `field:choose.remember` | 4 | Aminatou, the Fateshifter; Thriving Heath; Thriving Isle; Thriving Moor |
| `field:move_card_zone.from` | 4 | Aminatou, the Fateshifter; Archaeomancer's Map; Enhanced Surveillance; Heliod, the Radiant Dawn |
| `field:search_library.tapped` | 4 | Evolving Wilds; Myriad Landscape; Obscura Storefront; Wayfarer's Bauble |
| `quantity:stat` | 4 | Demon of Fate's Design; Secret Arcade; Shark Typhoon; Swords to Plowshares |
| `static:setBasePT` | 4 | Callaphe, Beloved of the Sea; Overwhelming Splendor; Starfield of Nyx; Utter Insignificance |
| `step:shuffle` | 4 | Enhanced Surveillance; Lim-Dûl's Vault; Ponder; Portent |
| `timing` | 4 | Aminatou, the Fateshifter; Demon of Fate's Design; One with the Multiverse; Tainted Field |
| `trigger:multi_event` | 4 | Athreos, Shroud-Veiled; Boon of the Spirit Realm; Doomwake Giant; Fear of Sleep Paralysis |
| `trigger:nth` | 4 | Esper Sentinel; Ledger Shredder; Mind's Dilation; Monologue Tax |
| `cast_option:miracle` | 3 | Devastation Tide; Redress Fate; Temporal Mastery |
| `field:choose.exclude` | 3 | Thriving Heath; Thriving Isle; Thriving Moor |
| `field:create_tokens.tokenKeywords` | 3 | Archon of Sun's Grace; Shark Typhoon; Sigil of the Empty Throne |
| `filter:chosenColor` | 3 | Thriving Heath; Thriving Isle; Thriving Moor |
| `filter:notSubtypes` | 3 | Heliod, the Radiant Dawn; Starfield of Nyx; Zur, Eternal Schemer |
| `mana:chosen_color` | 3 | Thriving Heath; Thriving Isle; Thriving Moor |
| `step:copy` | 3 | Estrid's Invocation; Extravagant Replication; Sunken Palace |
| `step:counter_spell` | 3 | Arcane Denial; Counterspell; Negate |
| `step:grant_effect` | 3 | Inkshield; Vanishing; Zur, Eternal Schemer |
| `cost:exileFrom` | 2 | Enhanced Surveillance; Sunken Palace |
| `field:copy.what` | 2 | Estrid's Invocation; Extravagant Replication |
| `field:create_delayed_trigger.at` | 2 | Arcane Denial; Portent |
| `field:create_delayed_trigger.steps` | 2 | Arcane Denial; Portent |
| `field:grant_effect.modify` | 2 | Vanishing; Zur, Eternal Schemer |
| `field:search_library.reveal` | 2 | Archaeomancer's Map; Moon-Blessed Cleric |
| `field:search_library.upTo` | 2 | Archaeomancer's Map; Myriad Landscape |
| `predicate:compare` | 2 | Archaeomancer's Map; Blasphemous Edict |
| `static:addTypes` | 2 | Secret Arcade; Starfield of Nyx |
| `static:attackTax` | 2 | Propaganda; Sphere of Safety |
| `step:create_delayed_trigger` | 2 | Arcane Denial; Portent |
| `step:scry` | 2 | Temple of Deceit; Temple of Silence |
| `step:surveil` | 2 | Aminatou, Veil Piercer; Otherworldly Gaze |
| `step:unless_pay` | 2 | Esper Sentinel; Mystic Remora |
| `targets:multi` | 2 | Fear of Sleep Paralysis; Secret Arcade |
| `zone:hand` | 2 | Shark Typhoon; Timely Ward |
| `cast_option` | 1 | Blasphemous Edict |
| `cast_option:alternative` | 1 | Blasphemous Edict |
| `cast_option:conditional` | 1 | Blasphemous Edict |
| `cast_option:flashback` | 1 | Otherworldly Gaze |
| `cost:discard` | 1 | Shark Typhoon |
| `cost:life` | 1 | Greed |
| `cost:loyalty` | 1 | Aminatou, the Fateshifter |
| `cost:x` | 1 | Shark Typhoon |
| `face` | 1 | Secret Arcade |
| `field:choose.fromLooked` | 1 | Diabolic Vision |
| `field:choose.max` | 1 | Arcane Denial |
| `field:choose.min` | 1 | Arcane Denial |
| `field:choose.options` | 1 | Aminatou, the Fateshifter |
| `field:choose.who` | 1 | Arcane Denial |
| `field:connive.on` | 1 | Ledger Shredder |
| `field:copy.addAbility` | 1 | Estrid's Invocation |
| `field:copy.asEnters` | 1 | Estrid's Invocation |
| `field:copy.chooseNewTargets` | 1 | Sunken Palace |
| `field:copy.controller` | 1 | Extravagant Replication |
| `field:copy.token` | 1 | Extravagant Replication |
| `field:create_tokens.attackTarget` | 1 | Soaring Lightbringer |
| `field:create_tokens.tokenAttacking` | 1 | Soaring Lightbringer |
| `field:create_tokens.tokenTapped` | 1 | Soaring Lightbringer |
| `field:draw_cards.who` | 1 | Arcane Denial |
| `field:gain_control.excludeSelf` | 1 | Aminatou, the Fateshifter |
| `field:gain_control.filter` | 1 | Aminatou, the Fateshifter |
| `field:gain_control.rotate` | 1 | Aminatou, the Fateshifter |
| `field:gain_control.who` | 1 | Aminatou, the Fateshifter |
| `field:grant_effect.phaseOut` | 1 | Vanishing |
| `field:grant_effect.replacement` | 1 | Inkshield |
| `field:life_change.amount` | 1 | Swords to Plowshares |
| `field:life_change.who` | 1 | Swords to Plowshares |
| `field:look_top.who` | 1 | Portent |
| `field:mass_bounce.filter` | 1 | Devastation Tide |
| `field:mass_pump.filter` | 1 | Doomwake Giant |
| `field:move_card_zone.filter` | 1 | Enhanced Surveillance |
| `field:move_card_zone.linkExile` | 1 | Mind's Dilation |
| `field:move_card_zone.who` | 1 | Mind's Dilation |
| `field:permission_to_play.what` | 1 | Mind's Dilation |
| `field:permission_to_play.withoutPaying` | 1 | Mind's Dilation |
| `field:permission_to_play.zone` | 1 | Mind's Dilation |
| `field:reanimate.all` | 1 | Redress Fate |
| `field:reanimate.filter` | 1 | Redress Fate |
| `field:repeat_for_each.repeatCount` | 1 | Lim-Dûl's Vault |
| `field:repeat_for_each.steps` | 1 | Lim-Dûl's Vault |
| `field:sacrifice_permanent.amount` | 1 | Blasphemous Edict |
| `field:sacrifice_permanent.costPerCounter` | 1 | Mystic Remora |
| `field:sacrifice_permanent.filter` | 1 | Blasphemous Edict |
| `field:sacrifice_permanent.who` | 1 | Blasphemous Edict |
| `field:search_library.min` | 1 | Myriad Landscape |
| `field:search_library.position` | 1 | Moon-Blessed Cleric |
| `field:search_library.reflexive` | 1 | Obscura Storefront |
| `field:search_library.sharesLandType` | 1 | Myriad Landscape |
| `field:shuffle.exceptLooked` | 1 | Lim-Dûl's Vault |
| `field:shuffle.who` | 1 | Portent |
| `predicate:matches` | 1 | Mind's Dilation |
| `predicate:step_done` | 1 | Obscura Storefront |
| `quantity:count_this_turn` | 1 | Heliod, the Radiant Dawn |
| `quantity:devotion_multi` | 1 | Athreos, Shroud-Veiled |
| `quantity:step_result` | 1 | Arcane Denial |
| `quantity:X` | 1 | Shark Typhoon |
| `ref:iterated` | 1 | Starfield of Nyx |
| `ref:linked_exile` | 1 | Mind's Dilation |
| `ref:sacrificed` | 1 | Demon of Fate's Design |
| `scripted:additional_beginning_phase` | 1 | Shadow of the Second Sun |
| `scripted:attack_tax_per_enchantment` | 1 | Sphere of Safety |
| `scripted:can_be_your_commander` | 1 | Aminatou, the Fateshifter |
| `scripted:cast_enchantment_paying_life` | 1 | Demon of Fate's Design |
| `scripted:cast_spells_as_though_flash` | 1 | Heliod, the Radiant Dawn |
| `scripted:copy_spell_or_ability_when_mana_spent` | 1 | Sunken Palace |
| `scripted:enchanted_player_cant_activate_nonmana_nonloyalty_abilities` | 1 | Overwhelming Splendor |
| `scripted:flash_if_targets_commander` | 1 | Timely Ward |
| `scripted:free_cast_from_hand` | 1 | Omniscience |
| `scripted:free_cast_once_per_turn` | 1 | One with the Multiverse |
| `scripted:look_at_top_card_any_time` | 1 | One with the Multiverse |
| `scripted:play_from_top_of_library` | 1 | One with the Multiverse |
| `scripted:stun_counters_cant_be_removed_from_opponent_permanents` | 1 | Fear of Sleep Paralysis |
| `scripted:surveil_additional_cards` | 1 | Enhanced Surveillance |
| `scripted:unlock_cost_reduction` | 1 | Inquisitive Glimmer |
| `static:costMod_quantity` | 1 | Heliod, the Radiant Dawn |
| `step:connive` | 1 | Ledger Shredder |
| `step:extra_turn` | 1 | Temporal Mastery |
| `step:gain_control` | 1 | Aminatou, the Fateshifter |
| `step:permission_to_play` | 1 | Mind's Dilation |
| `step:repeat_for_each` | 1 | Lim-Dûl's Vault |
| `step:transform` | 1 | Heliod, the Radiant Dawn |
| `trigger:batch` | 1 | Soaring Lightbringer |
| `trigger:begin_step:postcombat_main` | 1 | Shadow of the Second Sun |
| `trigger:cycle` | 1 | Shark Typhoon |
| `trigger:intervening_if` | 1 | Archaeomancer's Map |
| `trigger:leaves` | 1 | Athreos, Shroud-Veiled |
| `trigger:unlock_door` | 1 | Fear of Sleep Paralysis |
| `trigger:zones` | 1 | Athreos, Shroud-Veiled |
| `zone:stack` | 1 | Void Rend |

## Decisions

- Copied unchanged from other decks' drafts (identical cards): Adarkar Wastes (the-ur-dragon), Arcane Signet (calling-all-angels), Caves of Koilos (the-ur-dragon), Command Tower (saheeli), Counterspell (keen-engineering), Drowned Catacomb (the-ur-dragon), Evolving Wilds (the-ur-dragon), Glacial Fortress (the-ur-dragon), Island (keen-engineering), Isolated Chapel (the-ur-dragon), Myriad Landscape (the-ur-dragon), Negate (keen-engineering), Plains (calling-all-angels), Prairie Stream (the-ur-dragon), Propaganda (keen-engineering), Sol Ring (calling-all-angels), Sunken Palace (saheeli), Swamp (the-ur-dragon), Swords to Plowshares (calling-all-angels), Temple of Deceit (the-ur-dragon), Temple of Silence (the-ur-dragon), Underground River (the-ur-dragon).
- All 87 cards were found in data/cards.db; no oracleOverride was needed. Heliod, Secret Arcade and Virtue of Persistence are double-faced / Room / Adventure cards: each is one JSON with the face-prefixed oracle lines.
- VALIDATOR BUG: move_card_zone / step field order:"chosen" (put cards back in any order) is read as the ObjRef "chosen" and raises STRUCT_CHOSEN_UNDEFINED when no choose step saves it (Ponder, Halimar Depths, Portent). Workaround: passthrough field ordered:"any_order".
- VALIDATOR BUG: the lexeme "another/other" fires on "choose a color other than white" (Thriving lands). Workaround: review.ignore on 'another'.
- VALIDATOR NOTE: a mana ability line with "Add {W} or {B}" plus an extra sentence passes with ONE ability listing both colors in mana.produces and srcs:[0] (Talisman of Creativity pattern), but two separate mana abilities with identical text fail CLAUSE_UNCOVERED when a following sentence is present; plain dual lands with the two-ability pattern (copied drafts) still pass.
- SCHEMA QUESTION: no "enchanted player" filter/controller (Overwhelming Splendor, Shadow of the Second Sun): written with controller:"opponent" / subject:"enchanted".
- SCHEMA QUESTION: no field for characteristic-defining power (Callaphe: power = devotion to blue); written as setBasePT with the current toughness.
- SCHEMA QUESTION: no way to grant miracle with a derived cost (Aminatou, Veil Piercer), no static free-cast / cast-from-top / alternative-cost-for-other-cards permissions (Omniscience, One with the Multiverse, Demon of Fate's Design): scripted markers.
- SCHEMA QUESTION: no unlock_room event, no door state (Fear of Sleep Paralysis, Secret Arcade/Dusty Parlor), no adventure cast option (Virtue of Persistence), no phase_out step (Vanishing), no additional-phase step (Shadow of the Second Sun), no indefinite duration (Zur), no copy-with-exceptions/addAbility (Estrid's Invocation), no loop-while-player-chooses step (Lim-Dul's Vault), no rotate-control step (Aminatou, the Fateshifter -6), no Quantity-scaled attackTax cost (Sphere of Safety) or unlessPay multiplier (Mystic Remora cumulative upkeep).
- SCHEMA QUESTION: no cumulative_upkeep marker in the known scripted list; written as a triggered ability with keyword cumulative_upkeep plus add_counters and sacrifice unlessPay (costPerCounter passthrough).
- SCHEMA QUESTION: step field exclude (choose a color other than X) and token fields tokenAttacking / attackTarget are untyped passthrough.
