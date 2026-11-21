# Kernel draft approval: Meren of Clan Nel Toth Built on my Own

87 unique cards: 47 simple (A), 40 complex (B). Validator: 87/87 pass. Cards with implementation "needed": 78. All drafts are `review.status: "draft"`; nothing was written to the DB.

Reading guide: each card below shows the oracle text and what the structured JSON says back in plain English. Approve if they match.

## (A) Simple cards: spot-check one line each

- **Arcane Signet** (Artifact): {T}: add one mana of any color in your commander's color identity [needs: mana:variable]
- **Beast Whisperer** (Creature — Elf Druid): Whenever you cast a creature spell: Draw a card [implemented]
- **Blood Artist** (Creature — Vampire): Whenever Blood Artist dies or an another creature dies: [targets: target player] Target player gains 1 life, then gain 1 life [needs: trigger:multi_event, trigger:subject, field:life_change.amount, field:life_change.lose, field:life_change.who]
- **Carrion Feeder** (Creature — Zombie): Carrion Feeder can't block | sacrifice a creature you control: Put a +1/+1 counter on Carrion Feeder [needs: static, cost:sacrifice, step:add_counters, field:add_counters.on]
- **Command Tower** (Land): {T}: add one mana of any color in your commander's color identity [needs: mana:variable]
- **Culling Ritual** (Sorcery): Destroy each nonland permanent with mana value 2 or less, then add {B} and {G} [needs: quantity:step_result, field:destroy_all.filter, step:add_mana, field:add_mana.produces]
- **Dark Ritual** (Instant): Add {B}{B}{B} [needs: step:add_mana, field:add_mana.produces]
- **Dina's Guidance** (Instant): Search your library for a creature, put it onto the revealed, then choose one of hand or graveyard, then if the chosen mode is hand: put a card into your hand; otherwise put a card into its owner's graveyard, then shuffle [needs: step:search_library, field:search_library.count, field:search_library.filter, field:search_library.reveal, field:search_library.saveAs, field:search_library.to, step:choose, field:choose.choice, field:choose.options, field:choose.remember, field:choose.saveAs, step:if_else, field:if_else.else, field:if_else.if, field:if_else.then, predicate:chosen_is, field:move_card_zone.what, step:shuffle]
- **Dryad Arbor** (Land Creature — Forest Dryad): {T}: add {G} [implemented]
- **Elvish Mystic** (Creature — Elf Druid): {T}: add {G} [implemented]
- **Eternal Witness** (Creature — Human Shaman): Whenever Eternal Witness enters: [targets: target card in your graveyard] You may put target card in your graveyard into your hand [needs: field:move_card_zone.from]
- **Evolving Wilds** (Land): {T}, sacrifice Evolving Wilds: Search your library for a basic land, put it onto the battlefield, then shuffle [needs: cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to]
- **Feed the Swarm** (Sorcery): [targets: target creature an opponent controls or enchantment an opponent controls] Destroy target creature an opponent controls or enchantment an opponent controls, then gain t1's mana value life [needs: quantity:stat, field:life_change.amount, field:life_change.lose]
- **Forest** (Basic Land — Forest): {T}: add {G} [implemented]
- **Glowspore Shaman** (Creature — Elf Shaman): Whenever Glowspore Shaman enters: Mill 3 cards, then you may choose a land card in your graveyard, then put the chosen object on the top of its owner's library [needs: step:choose, field:choose.count, field:choose.from, field:choose.saveAs, field:move_card_zone.from, field:move_card_zone.position, predicate:step_done]
- **Golgari Rot Farm** (Land): If Golgari Rot Farm would enter, it enters tapped | Whenever Golgari Rot Farm enters: Choose a land you control, then put the chosen object into your hand | {T}: add {B}{G} [needs: replacement:would_enter, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, field:move_card_zone.from]
- **Gorma, the Gullet** (Legendary Creature — Pest Frog): Keyword lifelink | Whenever an another creature you control dies: Put a +1/+1 counter on Gorma, the Gullet | If a nontoken creature you control would enter, modify it: {"counters":{"kind":"+1/+1","count":{"ref":"count_this_turn","event":"dies","filter":{"types":["creature"],"controller":"you"}}}} [needs: trigger:subject, step:add_counters, field:add_counters.on, replacement:would_enter, quantity:count_this_turn]
- **Grim Haruspex** (Creature — Human Wizard): Keyword morph {B} | Whenever a nontoken another creature you control dies: Draw a card [needs: trigger:subject]
- **Grisly Salvage** (Instant): Look at the top five cards of your library, then you may choose a creature or land from among the looked-at cards, then put the chosen object into your hand, then put the rest of the looked-at cards into your graveyard [needs: step:look_top, field:look_top.reveal, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, field:move_card_zone.what]
- **High Market** (Land): {T}: add {C} | {T}, sacrifice a creature you control: Gain 1 life [needs: cost:sacrifice, field:life_change.amount]
- **Insidious Roots** (Enchantment): Token creatures you control have an ability | Whenever one or more creature cards in your graveyard leave a graveyard: Create a 0/1 green Plant creature token, then put a +1/+1 counter on it [needs: static, trigger:leaves, trigger:batch, trigger:subject, trigger:zones, step:add_counters, field:add_counters.all, field:add_counters.filter]
- **Izoni, Thousand-Eyed** (Legendary Creature — Elf Shaman): Whenever Izoni, Thousand-Eyed enters: Create the number of creature cards in your graveyard 1/1 black and green Insect creature tokens | {B}{G}, sacrifice an another creature you control: Gain 1 life, then draw a card [needs: quantity:count, cost:sacrifice, field:life_change.amount]
- **Jungle Hollow** (Land): If Jungle Hollow would enter, it enters tapped | Whenever Jungle Hollow enters: Gain 1 life | {T}: add {B} and {G} [needs: replacement:would_enter, field:life_change.amount]
- **Khalni Garden** (Land): If Khalni Garden would enter, it enters tapped | Whenever Khalni Garden enters: Create a 0/1 green Plant creature token | {T}: add {G} [needs: replacement:would_enter]
- **Living Death** (Sorcery): Exile all cards from each player's graveyard, then each player sacrifices a creature, then put all cards from each player's exile into the battlefield [needs: field:move_card_zone.all, field:move_card_zone.filter, field:move_card_zone.from, field:move_card_zone.saveAs, field:move_card_zone.who, field:sacrifice_permanent.all, field:sacrifice_permanent.filter, field:sacrifice_permanent.who, field:move_card_zone.what]
- **Llanowar Elves** (Creature — Elf Druid): {T}: add {G} [implemented]
- **Llanowar Wastes** (Land): {T}: add {C} | {T}: add {B} and {G} [needs: field:damage_target.source]
- **Mazirek, Kraul Death Priest** (Legendary Creature — Insect Shaman): Keyword flying | Whenever a player sacrifices an another permanent: Put a +1/+1 counter on it [needs: trigger:sacrifice, trigger:subject, step:add_counters, field:add_counters.all, field:add_counters.filter]
- **Midnight Reaper** (Creature — Zombie Knight): Whenever a nontoken creature you control dies: Deal 1 damage to the target, then draw a card [needs: trigger:subject]
- **Mulch** (Sorcery): Look at the top four cards of your library, then put all cards from your library into your hand, then put the rest of the looked-at cards into your graveyard [needs: step:look_top, field:look_top.reveal, field:move_card_zone.all, field:move_card_zone.filter, field:move_card_zone.from, field:move_card_zone.what]
- **Phyrexian Reclamation** (Enchantment): {1}{B}, pay 2 life: [targets: target creature card in your graveyard] Put target creature card in your graveyard into your hand [needs: cost:life]
- **Plaguecrafter** (Creature — Human Shaman): Whenever Plaguecrafter enters: Each player sacrifices a creature or planeswalker, then each player discard a card [needs: field:sacrifice_permanent.filter, field:sacrifice_permanent.who, field:discard.who, predicate:not, predicate:step_done]
- **Reanimate** (Sorcery): [targets: target creature card in a graveyard] Return target creature card in a graveyard from the graveyard to the battlefield, then gain t1's mana value life [needs: quantity:stat, field:life_change.amount, field:life_change.lose]
- **Ribtruss Roaster** (Creature — Troll Druid): Keyword devour 1 | At the beginning of your end step: Create the number of +1/+1 counters on self 1/1 black and green Pest creature tokens and "When this token dies, you gain 1 life." [needs: quantity:counters, field:create_tokens.tokenAbilities]
- **Sakura-Tribe Elder** (Creature — Snake Shaman): sacrifice Sakura-Tribe Elder: Search your library for a basic land, put it onto the battlefield, then shuffle [needs: cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to]
- **Skull Prophet** (Creature — Human Druid): {T}: add {B} and {G} | {T}: Mill 2 cards [implemented]
- **Skullclamp** (Artifact — Equipment): The equipped creature gets +1/-1 | Whenever the equipped creature dies: Draw 2 cards | {1}: [targets: target creature you control] Attach Skullclamp to target creature you control [needs: static, trigger:subject, step:attach, field:attach.to, field:attach.what]
- **Sol Ring** (Artifact): {T}: add {C}{C} [implemented]
- **Squirming Emergence** (Sorcery): [targets: target nonland permanent card with mana value less than or equal to the number of permanent cards in your graveyard in your graveyard] Return target nonland permanent card with mana value less than or equal to the number of permanent cards in your graveyard in your graveyard from the graveyard to the battlefield [implemented]
- **Swamp** (Basic Land — Swamp): {T}: add {B} [implemented]
- **Swiftfoot Boots** (Artifact — Equipment): The equipped creature has hexproof and has haste | {1}: [targets: target creature you control] Attach Swiftfoot Boots to target creature you control [needs: static, step:attach, field:attach.to, field:attach.what]
- **Terramorphic Expanse** (Land): {T}, sacrifice Terramorphic Expanse: Search your library for a basic land, put it onto the battlefield, then shuffle [needs: cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to]
- **Underground Mortuary** (Land — Swamp Forest): {T}: add {B} and {G} | If Underground Mortuary would enter, it enters tapped | Whenever Underground Mortuary enters: Surveil 1 [needs: replacement:would_enter, step:surveil]
- **Viscera Seer** (Creature — Vampire Wizard): sacrifice a creature you control: Scry 1 [needs: cost:sacrifice, step:scry]
- **Wight of the Reliquary** (Creature — Zombie Knight): Keyword vigilance | Wight of the Reliquary gets +X/+X, where X is 1 x the number of creature cards in your graveyard | {T}, sacrifice an another creature you control: Search your library for a land, put it onto the battlefield, then shuffle [needs: static, cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to]
- **Willow Geist** (Creature — Treefolk Spirit): Keyword trample | Whenever one or more cards in your graveyard leave a graveyard: Put a +1/+1 counter on Willow Geist | Whenever Willow Geist dies: Gain Willow Geist's power life [needs: trigger:leaves, trigger:batch, trigger:subject, trigger:zones, step:add_counters, field:add_counters.on, quantity:stat, field:life_change.amount]
- **Ygra, Eater of All** (Legendary Creature — Elemental Cat): Whenever Ygra, Eater of All becomes the target of a spell or ability: Counter that object | Other creatures are artifacts, foods in addition to their other types and have an ability | Whenever a Food is put into a graveyard from the battlefield: Put 2 +1/+1 counters on Ygra, Eater of All [needs: trigger:becomes_target, step:counter_spell, step:unless_pay, static, static:addTypes, trigger:leaves, trigger:subject, trigger:zones, step:add_counters, field:add_counters.on]

## (B) Complex cards

### Meren of Clan Nel Toth

Type: Legendary Creature — Human Shaman

Oracle text:

> Whenever another creature you control dies, you get an experience counter.
> At the beginning of your end step, choose target creature card in your graveyard. If that card's mana value is less than or equal to the number of experience counters you have, return it to the battlefield. Otherwise, put it into your hand.

Re-rendered plain English:

```
Meren of Clan Nel Toth [draft]
  [a1] triggered [needed: needs trigger:subject, step:add_counters, field:add_counters.on]
    Oracle: Whenever another creature you control dies, you get an experience counter.
    Trigger: Whenever an another creature you control dies
    Effect: Put a experience counter on you.
  [a2] triggered [needed: needs step:if_else, field:if_else.else, field:if_else.if, field:if_else.srcs, field:if_else.then, predicate:stat, field:move_card_zone.from]
    Oracle: At the beginning of your end step, choose target creature card in your graveyard. If that card's mana value is less than or equal to the number of experience counters you have, return it to the battlefield. Otherwise, put it into your hand.
    Trigger: At the beginning of your end step
    Target t1: target creature card in your graveyard  <- prompt: "Choose target creature card in your graveyard."
    Effect: If t1's mana value is less than or equal to the number of experience counters on you: return target creature card in your graveyard from the graveyard to the battlefield; otherwise put target creature card in your graveyard into your hand.
```

Player prompts:

- Meren of Clan Nel Toth: choose a target: Choose target creature card in your graveyard.

Implementation: needed (trigger:subject, step:add_counters, field:add_counters.on, step:if_else, field:if_else.else, field:if_else.if, field:if_else.srcs, field:if_else.then, predicate:stat, field:move_card_zone.from)

### Arachnogenesis

Type: Instant

Oracle text:

> Create X 1/2 green Spider creature tokens with reach, where X is the number of creatures attacking you. Prevent all combat damage that would be dealt this turn by non-Spider creatures.

Re-rendered plain English:

```
Arachnogenesis [draft]
  [a1] spell_effect [needed: needs replacement:would_deal_damage, filter:notSubtypes, filter:attackingYou, replacement:duration, replacement:damage_qualifiers, quantity:count, field:create_tokens.tokenKeywords]
    Oracle: Create X 1/2 green Spider creature tokens with reach, where X is the number of creatures attacking you. Prevent all combat damage that would be dealt this turn by non-Spider creatures.
    Effect: Create the number of creatures attacking you 1/2 green Spider creature tokens with reach.
    Replacement: If combat damage by a non-Spider creature would be dealt until end of turn, prevent it
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_deal_damage, filter:notSubtypes, filter:attackingYou, replacement:duration, replacement:damage_qualifiers, quantity:count, field:create_tokens.tokenKeywords)

### Beledros Witherbloom

Type: Legendary Creature — Elder Dragon

Oracle text:

> Flying
> At the beginning of each upkeep, create a 1/1 black and green Pest creature token with "When this token dies, you gain 1 life."
> Pay 10 life: Untap all lands you control. Activate only once each turn.

Re-rendered plain English:

```
Beledros Witherbloom [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs field:create_tokens.tokenAbilities]
    Oracle: At the beginning of each upkeep, create a 1/1 black and green Pest creature token with "When this token dies, you gain 1 life."
    Trigger: At the beginning of each upkeep
    Effect: Create a 1/1 black and green Pest creature token and "When this token dies, you gain 1 life.".
  [a3] activated [needed: needs timing, cost:life, field:untap_target.all, field:untap_target.filter]
    Oracle: Pay 10 life: Untap all lands you control. Activate only once each turn.
    Cost: pay 10 life
    Timing: 1 per turn
    Effect: Untap the target.
```

Player prompts:

- (none: no decisions)

Implementation: needed (field:create_tokens.tokenAbilities, timing, cost:life, field:untap_target.all, field:untap_target.filter)

### Cankerbloom

Type: Creature — Phyrexian Fungus

Oracle text:

> {1}, Sacrifice this creature: Choose one —
> • Destroy target artifact.
> • Destroy target enchantment.
> • Proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)

Re-rendered plain English:

```
Cankerbloom [draft]
  [a1] activated [needed: needs modes, cost:sacrifice, step:proliferate]
    Oracle: {1}, Sacrifice this creature: Choose one — / • Destroy target artifact. / • Destroy target enchantment. / • Proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)
    Cost: {1}, sacrifice Cankerbloom
    Modes: choose 1  <- prompt: "Choose one mode."
      - Destroy target artifact. (target: target artifact)
      - Destroy target enchantment. (target: target enchantment)
      - Proliferate.
```

Player prompts:

- Cankerbloom: choose a mode: Choose one mode.
- Cankerbloom: choose a target: Choose target artifact.
- Cankerbloom: choose a target: Choose target enchantment.

Implementation: needed (modes, cost:sacrifice, step:proliferate)

### Cultivate

Type: Sorcery

Oracle text:

> Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.

Re-rendered plain English:

```
Cultivate [draft]
  [a1] spell_effect [needed: needs step:search_library, field:search_library.count, field:search_library.filter, field:search_library.reveal, field:search_library.saveAs, field:search_library.to, field:search_library.upTo, step:choose, field:choose.count, field:choose.from, field:choose.fromRevealed, field:choose.saveAs, field:move_card_zone.from, field:move_card_zone.tapped, field:move_card_zone.what, step:shuffle]
    Oracle: Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.
    Effect: Search your library for a basic land, put it onto the revealed. Then, choose a basic land. Then, put the chosen object onto the battlefield. Then, put a card into your hand. Then, shuffle.
```

Player prompts:

- Cultivate: search: Choose a basic land from the library.
- Cultivate: choose: Choose a basic land.

Implementation: needed (step:search_library, field:search_library.count, field:search_library.filter, field:search_library.reveal, field:search_library.saveAs, field:search_library.to, field:search_library.upTo, step:choose, field:choose.count, field:choose.from, field:choose.fromRevealed, field:choose.saveAs, field:move_card_zone.from, field:move_card_zone.tapped, field:move_card_zone.what, step:shuffle)

### Deadly Brew

Type: Sorcery

Oracle text:

> Each player sacrifices a creature or planeswalker of their choice. If you sacrificed a permanent this way, you may return another permanent card from your graveyard to your hand.

Re-rendered plain English:

```
Deadly Brew [draft]
  [a1] spell_effect [needed: needs field:sacrifice_permanent.filter, field:sacrifice_permanent.who, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, predicate:step_done, field:move_card_zone.from]
    Oracle: Each player sacrifices a creature or planeswalker of their choice. If you sacrificed a permanent this way, you may return another permanent card from your graveyard to your hand.
    Effect: Each player sacrifices a creature or planeswalker. Then, IF you did (s1): you may choose an another permanent card in your graveyard. Then, IF you did (s2): put the chosen object into your hand.
```

Player prompts:

- Deadly Brew: sacrifice: Choose a permanent to sacrifice.
- Deadly Brew: optional: Do you want to choose an another permanent card in your graveyard?

Implementation: needed (field:sacrifice_permanent.filter, field:sacrifice_permanent.who, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, predicate:step_done, field:move_card_zone.from)

### Deathbonnet Sprout // Deathbonnet Hulk

Type: Creature — Fungus // Creature — Fungus Horror

Oracle text:

> Deathbonnet Sprout: At the beginning of your upkeep, mill a card. Then if there are three or more creature cards in your graveyard, transform this creature. (To mill a card, put the top card of your library into your graveyard.)
> 
> Deathbonnet Hulk: At the beginning of your upkeep, you may exile a card from a graveyard. If a creature card was exiled this way, put a +1/+1 counter on this creature.

Re-rendered plain English:

```
Deathbonnet Sprout // Deathbonnet Hulk [draft]
  [a1] triggered [needed: needs face, step:transform]
    Oracle: Deathbonnet Sprout: At the beginning of your upkeep, mill a card. Then if there are three or more creature cards in your graveyard, transform this creature. (To mill a card, put the top card of your library into your graveyard.)
    Trigger: At the beginning of your upkeep
    Effect: Mill 1 cards. Then, IF you have 3 or greater creatures in graveyard: transform Deathbonnet Sprout // Deathbonnet Hulk.
  [a2] triggered [needed: needs face, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, field:move_card_zone.from, predicate:step_done, step:add_counters, field:add_counters.on, predicate:all, predicate:matches]
    Oracle: Deathbonnet Hulk: At the beginning of your upkeep, you may exile a card from a graveyard. If a creature card was exiled this way, put a +1/+1 counter on this creature.
    Trigger: At the beginning of your upkeep
    Effect: You may choose a card in a graveyard. Then, IF you did (s1): exile the chosen object. Then, IF you did (s2) and the chosen object is a creature: put a +1/+1 counter on Deathbonnet Sprout // Deathbonnet Hulk.
```

Player prompts:

- Deathbonnet Sprout // Deathbonnet Hulk: optional: Do you want to choose a card in a graveyard?

Implementation: needed (face, step:transform, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, field:move_card_zone.from, predicate:step_done, step:add_counters, field:add_counters.on, predicate:all, predicate:matches)

### Dina, Essence Brewer

Type: Legendary Creature — Dryad Druid

Oracle text:

> Whenever you sacrifice a creature, draw a card. This ability triggers only once each turn.
> {2}, {T}, Sacrifice another creature: You gain X life and put X +1/+1 counters on target creature you control, where X is the sacrificed creature's power.

Re-rendered plain English:

```
Dina, Essence Brewer [draft]
  [a1] triggered [needed: needs timing, trigger:sacrifice, trigger:subject]
    Oracle: Whenever you sacrifice a creature, draw a card. This ability triggers only once each turn.
    Trigger: Whenever a creature you control is sacrificed
    Timing: 1 per turn
    Effect: Draw a card.
  [a2] activated [needed: needs ref:sacrificed, cost:sacrifice, quantity:stat, field:life_change.amount, step:add_counters, field:add_counters.on]
    Oracle: {2}, {T}, Sacrifice another creature: You gain X life and put X +1/+1 counters on target creature you control, where X is the sacrificed creature's power.
    Cost: {2}, {T}, sacrifice an another creature you control
    Target t1: target creature you control  <- prompt: "Choose target creature you control."
    Effect: Gain the sacrificed permanent's power life. Then, put the sacrificed permanent's power +1/+1 counters on target creature you control.
```

Player prompts:

- Dina, Essence Brewer: choose a target: Choose target creature you control.
- Dina, Essence Brewer: choose what to sacrifice: Choose 1 another creature you control to sacrifice.

Implementation: needed (timing, trigger:sacrifice, trigger:subject, ref:sacrificed, cost:sacrifice, quantity:stat, field:life_change.amount, step:add_counters, field:add_counters.on)

### Eccentric Pestfinder // Turn Stones

Type: Creature — Troll Druid // Sorcery

Oracle text:

> Eccentric Pestfinder: Trample
> At the beginning of each end step, if you gained life this turn, this creature becomes prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)
> 
> Turn Stones: For each opponent, you create a 1/1 black and green Pest creature token with "When this token dies, you gain 1 life."

Re-rendered plain English:

```
Eccentric Pestfinder // Turn Stones [draft]
  [a1] keyword [needed: needs face]
    Oracle: Eccentric Pestfinder: Trample
    Keyword: trample
  [a2] triggered [needed: needs trigger:intervening_if, face, step:grant_effect, field:grant_effect.modify, field:grant_effect.prepared]
    Oracle: At the beginning of each end step, if you gained life this turn, this creature becomes prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)
    Trigger: At the beginning of each end step, if you gain life this turn
    Effect: Eccentric Pestfinder // Turn Stones gains prepared.
  [a3] spell_effect [needed: needs quantity:players_count, face, field:create_tokens.tokenAbilities]
    Oracle: Turn Stones: For each opponent, you create a 1/1 black and green Pest creature token with "When this token dies, you gain 1 life."
    Effect: Create the number of opponents for which it is not true that that player's life total is less than 0 1/1 black and green Pest creature tokens and "When this token dies, you gain 1 life.".
```

Player prompts:

- (none: no decisions)

Implementation: needed (face, trigger:intervening_if, step:grant_effect, field:grant_effect.modify, field:grant_effect.prepared, quantity:players_count, field:create_tokens.tokenAbilities)

Questions for you:

- Prepared: once prepared, may you cast Turn Stones (a copy of the sorcery) any time you could cast a sorcery, with preparing cleared when the copy is cast? Please confirm the kernel should treat prepared as a permanent flag.

### Eldritch Evolution

Type: Sorcery

Oracle text:

> As an additional cost to cast this spell, sacrifice a creature.
> Search your library for a creature card with mana value X or less, where X is 2 plus the sacrificed creature's mana value. Put that card onto the battlefield, then shuffle. Exile Eldritch Evolution.

Re-rendered plain English:

```
Eldritch Evolution [draft]
  [a1] cast_option [needed: needs cast_option, cost:sacrifice]
    Oracle: As an additional cost to cast this spell, sacrifice a creature.
    Cost: sacrifice a creature you control
  [a2] spell_effect [needed: needs ref:sacrificed, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.to]
    Oracle: Search your library for a creature card with mana value X or less, where X is 2 plus the sacrificed creature's mana value. Put that card onto the battlefield, then shuffle. Exile Eldritch Evolution.
    Effect: Search your library for a creature with mana value less than or equal to 2 + the sacrificed permanent's mana value, put it onto the battlefield, then shuffle. Then, exile Eldritch Evolution.
```

Player prompts:

- Eldritch Evolution: choose what to sacrifice: Choose 1 creature you control to sacrifice.
- Eldritch Evolution: search: Choose a creature with mana value less than or equal to 2 + the sacrificed permanent's mana value from the library.

Implementation: needed (cast_option, cost:sacrifice, ref:sacrificed, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.to)

### Fiend Artisan

Type: Creature — Nightmare

Oracle text:

> This creature gets +1/+1 for each creature card in your graveyard.
> {X}{B/G}, {T}, Sacrifice another creature: Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle. Activate only as a sorcery.

Re-rendered plain English:

```
Fiend Artisan [draft]
  [a1] static [needed: needs static]
    Oracle: This creature gets +1/+1 for each creature card in your graveyard.
    Static: Fiend Artisan gets +X/+X, where X is 1 x the number of creature cards in your graveyard
  [a2] activated [needed: needs cost:x, cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.to]
    Oracle: {X}{B/G}, {T}, Sacrifice another creature: Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle. Activate only as a sorcery.
    Cost: {X}{B/G}, {T}, sacrifice an another creature you control
    Timing: sorcery
    Effect: Search your library for a creature with mana value less than or equal to X, put it onto the battlefield, then shuffle.
    X prompt: "Choose a value for X (paid in mana)."
```

Player prompts:

- Fiend Artisan: choose X: Choose a value for X (paid in mana).
- Fiend Artisan: choose what to sacrifice: Choose 1 another creature you control to sacrifice.
- Fiend Artisan: search: Choose a creature with mana value less than or equal to X from the library.

Implementation: needed (static, cost:x, cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.to)

### Find // Finality

Type: Sorcery // Sorcery

Oracle text:

> Find: Return up to two target creature cards from your graveyard to your hand.
> 
> Finality: You may put two +1/+1 counters on a creature you control. Then all creatures get -4/-4 until end of turn.

Re-rendered plain English:

```
Find // Finality [draft]
  [a1] spell_effect [needed: needs targets:multi, face, field:move_card_zone.from]
    Oracle: Find: Return up to two target creature cards from your graveyard to your hand.
    Target t1: up to two target creature cards in your graveyard  <- prompt: "Choose up to two target creature cards in your graveyard."
    Effect: Put up to two target creature cards in your graveyard into your hand.
  [a2] spell_effect [needed: needs face, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, step:add_counters, field:add_counters.on, predicate:step_done, field:mass_pump.filter]
    Oracle: Finality: You may put two +1/+1 counters on a creature you control. Then all creatures get -4/-4 until end of turn.
    Effect: You may choose a creature you control. Then, IF you did (s1): put 2 +1/+1 counters on the chosen object. Then, all creatures get -4/-4 until end of turn.
```

Player prompts:

- Find // Finality: choose targets: Choose up to two target creature cards in your graveyard.
- Find // Finality: optional: Do you want to choose a creature you control?

Implementation: needed (targets:multi, face, field:move_card_zone.from, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, step:add_counters, field:add_counters.on, predicate:step_done, field:mass_pump.filter)

### Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun

Type: Legendary Enchantment // Legendary Land

Oracle text:

> Growing Rites of Itlimoc: When Growing Rites of Itlimoc enters, look at the top four cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in any order.
> At the beginning of your end step, if you control four or more creatures, transform Growing Rites of Itlimoc.
> 
> Itlimoc, Cradle of the Sun: (Transforms from Growing Rites of Itlimoc.)
> {T}: Add {G}.
> {T}: Add {G} for each creature you control.

Re-rendered plain English:

```
Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun [draft]
  [a1] triggered [needed: needs face, step:look_top, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, step:reveal, predicate:step_done, field:move_card_zone.ordered, field:move_card_zone.position, field:move_card_zone.what]
    Oracle: Growing Rites of Itlimoc: When Growing Rites of Itlimoc enters, look at the top four cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in any order.
    Trigger: Whenever Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun enters
    Effect: Look at the top four cards of your library. Then, you may choose a creature card from among the looked-at cards. Then, IF you did (s1): reveal the chosen object. Then, IF you did (s1): put the chosen object into your hand. Then, put the rest of the looked-at cards on the bottom of your library.
  [a2] triggered [needed: needs trigger:intervening_if, face, step:transform]
    Oracle: At the beginning of your end step, if you control four or more creatures, transform Growing Rites of Itlimoc.
    Trigger: At the beginning of your end step, if you control four or more creatures
    Effect: Transform Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun.
  [a3] keyword [needed: needs face]
    Oracle: Itlimoc, Cradle of the Sun: (Transforms from Growing Rites of Itlimoc.)
    Keyword: back_face
  [a4] mana [needed: needs face]
    Oracle: {T}: Add {G}.
    Cost: {T}
    Mana: add {G}
  [a5] mana [needed: needs mana:variable, face]
    Oracle: {T}: Add {G} for each creature you control.
    Cost: {T}
    Mana: add {{G}} for each creature you control
```

Player prompts:

- Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun: optional: Do you want to choose a creature card from among the looked-at cards?

Implementation: needed (face, step:look_top, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, step:reveal, predicate:step_done, field:move_card_zone.ordered, field:move_card_zone.position, field:move_card_zone.what, trigger:intervening_if, step:transform, mana:variable)

### Guardian Project

Type: Enchantment

Oracle text:

> Whenever a nontoken creature you control enters, if it doesn't have the same name as another creature you control or a creature card in your graveyard, draw a card.

Re-rendered plain English:

```
Guardian Project [draft]
  [a1] triggered [needed: needs trigger:intervening_if, predicate:not, predicate:name_matches, trigger:subject]
    Oracle: Whenever a nontoken creature you control enters, if it doesn't have the same name as another creature you control or a creature card in your graveyard, draw a card.
    Trigger: Whenever a nontoken creature you control enters, if it is not true that that object has the same name as an another creature you control or a creature card in your graveyard
    Effect: Draw a card.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:intervening_if, predicate:not, predicate:name_matches, trigger:subject)

Questions for you:

- Guardian Project compares the entering creature's name with creatures you control (other than it) and creature cards in your graveyard. Confirm that tokens never trigger it (only nontoken creatures) and that a changeling or name-copy is not special-cased.

### Gyome, Master Chef

Type: Legendary Creature — Troll Warlock

Oracle text:

> Trample
> At the beginning of your end step, create a number of Food tokens equal to the number of nontoken creatures you had enter the battlefield under your control this turn.
> {1}, Sacrifice a Food: Target creature gains indestructible until end of turn. Tap it.

Re-rendered plain English:

```
Gyome, Master Chef [draft]
  [a1] keyword [implemented]
    Oracle: Trample
    Keyword: trample
  [a2] triggered [needed: needs quantity:count_this_turn]
    Oracle: At the beginning of your end step, create a number of Food tokens equal to the number of nontoken creatures you had enter the battlefield under your control this turn.
    Trigger: At the beginning of your end step
    Effect: Create the number of nontoken creatures you control that etb this turn ?/? colorless Food artifact tokens.
  [a3] activated [needed: needs cost:sacrifice, step:grant_effect, field:grant_effect.modify]
    Oracle: {1}, Sacrifice a Food: Target creature gains indestructible until end of turn. Tap it.
    Cost: {1}, sacrifice a Food you control
    Target t1: target creature  <- prompt: "Choose target creature."
    Effect: Target creature gains indestructible until end of turn. Then, tap target creature.
```

Player prompts:

- Gyome, Master Chef: choose a target: Choose target creature.
- Gyome, Master Chef: choose what to sacrifice: Choose 1 Food you control to sacrifice.

Implementation: needed (quantity:count_this_turn, cost:sacrifice, step:grant_effect, field:grant_effect.modify)

### Harrow

Type: Instant

Oracle text:

> As an additional cost to cast this spell, sacrifice a land.
> Search your library for up to two basic land cards, put them onto the battlefield, then shuffle.

Re-rendered plain English:

```
Harrow [draft]
  [a1] cast_option [needed: needs cast_option, cost:sacrifice]
    Oracle: As an additional cost to cast this spell, sacrifice a land.
    Cost: sacrifice a land you control
  [a2] spell_effect [needed: needs step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.to, field:search_library.upTo]
    Oracle: Search your library for up to two basic land cards, put them onto the battlefield, then shuffle.
    Effect: Search your library for a basic land, put it onto the battlefield, then shuffle.
```

Player prompts:

- Harrow: choose what to sacrifice: Choose 1 land you control to sacrifice.
- Harrow: search: Choose a basic land from the library.

Implementation: needed (cast_option, cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.to, field:search_library.upTo)

### Immoral Bargain

Type: Sorcery

Oracle text:

> As an additional cost to cast this spell, sacrifice X creatures.
> Destroy X target nonland permanents.

Re-rendered plain English:

```
Immoral Bargain [draft]
  [a1] cast_option [needed: needs cast_option, cost:sacrifice]
    Oracle: As an additional cost to cast this spell, sacrifice X creatures.
    Cost: sacrifice X creatures you control
    X prompt: "Choose a value for X (the amount used in the cost)."
  [a2] spell_effect [needed: needs targets:variable_count, quantity:X, field:destroy_target.amount]
    Oracle: Destroy X target nonland permanents.
    Target t1: X target nonland permanents  <- prompt: "Choose up to 99 target nonland permanents."
    Effect: Destroy X target nonland permanents.
```

Player prompts:

- Immoral Bargain: choose X: Choose a value for X (the amount used in the cost).
- Immoral Bargain: choose what to sacrifice: Choose X creatures you control to sacrifice.
- Immoral Bargain: choose targets: Choose up to 99 target nonland permanents.

Implementation: needed (cast_option, cost:sacrifice, targets:variable_count, quantity:X, field:destroy_target.amount)

### Jarad, Golgari Lich Lord

Type: Legendary Creature — Zombie Elf

Oracle text:

> Jarad gets +1/+1 for each creature card in your graveyard.
> {1}{B}{G}, Sacrifice another creature: Each opponent loses life equal to the sacrificed creature's power.
> Sacrifice a Swamp and a Forest: Return this card from your graveyard to your hand.

Re-rendered plain English:

```
Jarad, Golgari Lich Lord [draft]
  [a1] static [needed: needs static]
    Oracle: Jarad gets +1/+1 for each creature card in your graveyard.
    Static: Jarad, Golgari Lich Lord gets +X/+X, where X is 1 x the number of creature cards in your graveyard
  [a2] activated [needed: needs ref:sacrificed, cost:sacrifice, quantity:stat, field:life_change.amount, field:life_change.lose, field:life_change.who]
    Oracle: {1}{B}{G}, Sacrifice another creature: Each opponent loses life equal to the sacrificed creature's power.
    Cost: {1}{B}{G}, sacrifice an another creature you control
    Effect: Each opponent gains the sacrificed permanent's power life.
  [a3] activated (from graveyard) [needed: needs zone:graveyard, cost:sacrifice, field:move_card_zone.from]
    Oracle: Sacrifice a Swamp and a Forest: Return this card from your graveyard to your hand.
    Cost: sacrifice a Swamp you control, sacrifice a Forest you control
    Effect: Put Jarad, Golgari Lich Lord into your hand.
```

Player prompts:

- Jarad, Golgari Lich Lord: choose what to sacrifice: Choose 1 another creature you control to sacrifice.
- Jarad, Golgari Lich Lord: choose what to sacrifice: Choose 1 Swamp you control to sacrifice.
- Jarad, Golgari Lich Lord: choose what to sacrifice: Choose 1 Forest you control to sacrifice.

Implementation: needed (static, ref:sacrificed, cost:sacrifice, quantity:stat, field:life_change.amount, field:life_change.lose, field:life_change.who, zone:graveyard, field:move_card_zone.from)

### Morbid Opportunist

Type: Creature — Human Rogue

Oracle text:

> Whenever one or more other creatures die, draw a card. This ability triggers only once each turn.

Re-rendered plain English:

```
Morbid Opportunist [draft]
  [a1] triggered [needed: needs timing, trigger:batch, trigger:subject]
    Oracle: Whenever one or more other creatures die, draw a card. This ability triggers only once each turn.
    Trigger: Whenever one or more other creatures die
    Timing: 1 per turn
    Effect: Draw a card.
```

Player prompts:

- (none: no decisions)

Implementation: needed (timing, trigger:batch, trigger:subject)

### Moseo, Vein's New Dean

Type: Legendary Creature — Bird Skeleton Warlock

Oracle text:

> Flying
> When Moseo enters, create a 1/1 black and green Pest creature token with "Whenever this token attacks, you gain 1 life."
> Infusion — At the beginning of your end step, if you gained life this turn, return up to one target creature card with mana value X or less from your graveyard to the battlefield, where X is the amount of life you gained this turn.

Re-rendered plain English:

```
Moseo, Vein's New Dean [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs field:create_tokens.tokenAbilities]
    Oracle: When Moseo enters, create a 1/1 black and green Pest creature token with "Whenever this token attacks, you gain 1 life."
    Trigger: Whenever Moseo, Vein's New Dean enters
    Effect: Create a 1/1 black and green Pest creature token and "Whenever this token attacks, you gain 1 life.".
  [a3] triggered [needed: needs quantity:life_gained_this_turn, trigger:intervening_if, targets:multi]
    Oracle: Infusion — At the beginning of your end step, if you gained life this turn, return up to one target creature card with mana value X or less from your graveyard to the battlefield, where X is the amount of life you gained this turn.
    Trigger: At the beginning of your end step, if you gain life this turn
    Target t1: up to one target creature card with mana value less than or equal to the amount of life you have gained this turn in your graveyard  <- prompt: "Choose up to one target creature card with mana value less than or equal to the number of things that gain life this turn in your graveyard."
    Effect: Return up to one target creature card with mana value less than or equal to the amount of life you have gained this turn in your graveyard from the graveyard to the battlefield.
```

Player prompts:

- Moseo, Vein's New Dean: choose a target: Choose up to one target creature card with mana value less than or equal to the number of things that gain life this turn in your graveyard.

Implementation: needed (field:create_tokens.tokenAbilities, quantity:life_gained_this_turn, trigger:intervening_if, targets:multi)

Questions for you:

- Infusion returns a creature card with mana value X or less, X = life gained this turn. The schema can only count gain EVENTS, so one 5-life gain reads as X = 1. Is that approximation acceptable until a life_gained_this_turn Quantity exists?

### Necroblossom Snarl

Type: Land

Oracle text:

> As this land enters, you may reveal a Swamp or Forest card from your hand. If you don't, this land enters tapped.
> {T}: Add {B} or {G}.

Re-rendered plain English:

```
Necroblossom Snarl [draft]
  [a1] replacement [needed: needs replacement:would_enter, step:reveal, field:reveal.filter, predicate:not, predicate:step_done]
    Oracle: As this land enters, you may reveal a Swamp or Forest card from your hand. If you don't, this land enters tapped.
    Replacement: If Necroblossom Snarl would enter, also: reveal the target, then tap Necroblossom Snarl
  [a2] mana [implemented]
    Oracle: {T}: Add {B} or {G}.
    Cost: {T}
    Mana: add {B} and {G}
```

Player prompts:

- Necroblossom Snarl: optional: Do you want to reveal the target?

Implementation: needed (replacement:would_enter, step:reveal, field:reveal.filter, predicate:not, predicate:step_done)

### Old Rutstein

Type: Legendary Creature — Human Peasant

Oracle text:

> When Old Rutstein enters and at the beginning of your upkeep, mill a card. If a land card is milled this way, create a Treasure token. If a creature card is milled this way, create a 1/1 green Insect creature token. If a noncreature, nonland card is milled this way, create a Blood token.

Re-rendered plain English:

```
Old Rutstein [draft]
  [a1] triggered [needed: needs trigger:multi_event, step:choose, field:choose.count, field:choose.from, field:choose.fromMilled, field:choose.saveAs, predicate:matches]
    Oracle: When Old Rutstein enters and at the beginning of your upkeep, mill a card. If a land card is milled this way, create a Treasure token. If a creature card is milled this way, create a 1/1 green Insect creature token. If a noncreature, nonland card is milled this way, create a Blood token.
    Trigger: Whenever Old Rutstein enters or At the beginning of your upkeep
    Effect: Mill 1 cards. Then, choose a card in your graveyard. Then, IF the chosen object is a land: create a ?/? colorless Treasure artifact token. Then, IF the chosen object is a creature: create a 1/1 green Insect creature token. Then, IF the chosen object is a noncreature nonland permanent: create a ?/? colorless Blood artifact token.
```

Player prompts:

- Old Rutstein: choose: Choose a card in your graveyard.

Implementation: needed (trigger:multi_event, step:choose, field:choose.count, field:choose.from, field:choose.fromMilled, field:choose.saveAs, predicate:matches)

Questions for you:

- Old Rutstein's three outcomes are by card type (land / creature / noncreature nonland). A land creature such as Dryad Arbor milled counts as both a land and a creature, so it makes a Treasure AND an Insect. Confirm that is intended.

### Old Stickfingers

Type: Legendary Creature — Horror

Oracle text:

> When you cast this spell, reveal cards from the top of your library until you reveal X creature cards. Put all creature cards revealed this way into your graveyard, then put the rest on the bottom of your library in a random order.
> Old Stickfingers's power and toughness are each equal to the number of creature cards in your graveyard.

Re-rendered plain English:

```
Old Stickfingers [draft]
  [a1] triggered (from stack) [needed: needs zone:stack, step:reveal, field:reveal.saveAs, field:reveal.until, field:move_card_zone.all, field:move_card_zone.filter, field:move_card_zone.what, field:move_card_zone.order, field:move_card_zone.position]
    Oracle: When you cast this spell, reveal cards from the top of your library until you reveal X creature cards. Put all creature cards revealed this way into your graveyard, then put the rest on the bottom of your library in a random order.
    Trigger: Whenever a player casts Old Stickfingers
    Effect: Reveal the target. Then, put all cards from your graveyard into its owner's graveyard. Then, put a card on the bottom of its owner's library.
  [a2] static [needed: needs static, static:setBasePT]
    Oracle: Old Stickfingers's power and toughness are each equal to the number of creature cards in your graveyard.
    Static: Old Stickfingers has power and toughness each equal to the number of creature cards in your graveyard
```

Player prompts:

- (none: no decisions)

Implementation: needed (zone:stack, step:reveal, field:reveal.saveAs, field:reveal.until, field:move_card_zone.all, field:move_card_zone.filter, field:move_card_zone.what, field:move_card_zone.order, field:move_card_zone.position, static, static:setBasePT)

### Overgrown Tomb

Type: Land — Swamp Forest

Oracle text:

> ({T}: Add {B} or {G}.)
> As this land enters, you may pay 2 life. If you don't, it enters tapped.

Re-rendered plain English:

```
Overgrown Tomb [draft]
  [a1] mana [implemented]
    Oracle: ({T}: Add {B} or {G}.)
    Cost: {T}
    Mana: add {B} and {G}
  [a2] replacement [needed: needs replacement:would_enter, predicate:not, predicate:step_done]
    Oracle: As this land enters, you may pay 2 life. If you don't, it enters tapped.
    Replacement: If Overgrown Tomb would enter, also: lose 2 life, then tap Overgrown Tomb
```

Player prompts:

- Overgrown Tomb: optional: Do you want to lose 2 life?

Implementation: needed (replacement:would_enter, predicate:not, predicate:step_done)

### Pest Infestation

Type: Sorcery

Oracle text:

> Destroy up to X target artifacts and/or enchantments. Create twice X 1/1 black and green Pest creature tokens with "When this token dies, you gain 1 life."

Re-rendered plain English:

```
Pest Infestation [draft]
  [a1] spell_effect [needed: needs targets:multi, targets:variable_count, quantity:X, field:destroy_target.amount, quantity:math, field:create_tokens.tokenAbilities]
    Oracle: Destroy up to X target artifacts and/or enchantments. Create twice X 1/1 black and green Pest creature tokens with "When this token dies, you gain 1 life."
    Target t1: up to X target artifacts or enchantments  <- prompt: "Choose up to 99 target artifacts or enchantments."
    Effect: Destroy up to X target artifacts or enchantments. Then, create 2 x X 1/1 black and green Pest creature tokens and "When this token dies, you gain 1 life.".
```

Player prompts:

- Pest Infestation: choose targets: Choose up to 99 target artifacts or enchantments.

Implementation: needed (targets:multi, targets:variable_count, quantity:X, field:destroy_target.amount, quantity:math, field:create_tokens.tokenAbilities)

### Priest of Forgotten Gods

Type: Creature — Human Cleric

Oracle text:

> {T}, Sacrifice two other creatures: Any number of target players each lose 2 life and sacrifice a creature of their choice. You add {B}{B} and draw a card.

Re-rendered plain English:

```
Priest of Forgotten Gods [draft]
  [a1] activated [needed: needs cost:sacrifice, targets:multi, targets:any_number, field:life_change.amount, field:life_change.lose, field:life_change.who, field:sacrifice_permanent.filter, field:sacrifice_permanent.who, step:add_mana, field:add_mana.produces]
    Oracle: {T}, Sacrifice two other creatures: Any number of target players each lose 2 life and sacrifice a creature of their choice. You add {B}{B} and draw a card.
    Cost: {T}, sacrifice 2 other creatures you control
    Target t1: any number of target players  <- prompt: "Choose up to 99 target players."
    Effect: Target player gains 2 life. Then, target player sacrifices a creature. Then, add {B}{B}. Then, draw a card.
```

Player prompts:

- Priest of Forgotten Gods: choose targets: Choose up to 99 target players.
- Priest of Forgotten Gods: choose what to sacrifice: Choose 2 other creatures you control to sacrifice.
- Priest of Forgotten Gods: sacrifice: Choose a permanent to sacrifice.

Implementation: needed (cost:sacrifice, targets:multi, targets:any_number, field:life_change.amount, field:life_change.lose, field:life_change.who, field:sacrifice_permanent.filter, field:sacrifice_permanent.who, step:add_mana, field:add_mana.produces)

### Savra, Queen of the Golgari

Type: Legendary Creature — Elf Shaman

Oracle text:

> Whenever you sacrifice a black creature, you may pay 2 life. If you do, each other player sacrifices a creature of their choice.
> Whenever you sacrifice a green creature, you may gain 2 life.

Re-rendered plain English:

```
Savra, Queen of the Golgari [draft]
  [a1] triggered [needed: needs trigger:sacrifice, trigger:subject, field:life_change.amount, field:life_change.lose, field:sacrifice_permanent.filter, field:sacrifice_permanent.who, predicate:step_done]
    Oracle: Whenever you sacrifice a black creature, you may pay 2 life. If you do, each other player sacrifices a creature of their choice.
    Trigger: Whenever a black creature you control is sacrificed
    Effect: You may gain 2 life. Then, IF you did (s1): each opponent sacrifices a creature.
  [a2] triggered [needed: needs trigger:sacrifice, trigger:subject, field:life_change.amount]
    Oracle: Whenever you sacrifice a green creature, you may gain 2 life.
    Trigger: Whenever a green creature you control is sacrificed
    Effect: You may gain 2 life.
```

Player prompts:

- Savra, Queen of the Golgari: optional: Do you want to gain 2 life?
- Savra, Queen of the Golgari: sacrifice: Choose a permanent to sacrifice.

Implementation: needed (trigger:sacrifice, trigger:subject, field:life_change.amount, field:life_change.lose, field:sacrifice_permanent.filter, field:sacrifice_permanent.who, predicate:step_done)

### Spore Frog

Type: Creature — Frog

Oracle text:

> Sacrifice this creature: Prevent all combat damage that would be dealt this turn.

Re-rendered plain English:

```
Spore Frog [draft]
  [a1] activated [needed: needs replacement:would_deal_damage, replacement:duration, replacement:damage_qualifiers, cost:sacrifice]
    Oracle: Sacrifice this creature: Prevent all combat damage that would be dealt this turn.
    Cost: sacrifice Spore Frog
    Replacement: If combat damage would be dealt until end of turn, prevent it
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_deal_damage, replacement:duration, replacement:damage_qualifiers, cost:sacrifice)

### Stensian Sanguinist // Exsanguinate

Type: Creature — Vampire Cleric // Sorcery

Oracle text:

> Stensian Sanguinist: Whenever you attack, target creature gains deathtouch until end of turn. Whenever that creature deals combat damage to a player this combat, this creature becomes prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)
> 
> Exsanguinate: Each opponent loses X life. You gain life equal to the life lost this way.

Re-rendered plain English:

```
Stensian Sanguinist // Exsanguinate [draft]
  [a1] triggered [needed: needs trigger:batch, face, step:grant_effect, field:grant_effect.modify, step:create_delayed_trigger, field:create_delayed_trigger.at, field:create_delayed_trigger.steps, field:create_delayed_trigger.trigger, field:grant_effect.prepared]
    Oracle: Stensian Sanguinist: Whenever you attack, target creature gains deathtouch until end of turn. Whenever that creature deals combat damage to a player this combat, this creature becomes prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)
    Trigger: Whenever you attack
    Target t1: target creature  <- prompt: "Choose target creature."
    Effect: Target creature gains deathtouch until end of turn. Then, create a delayed trigger.
  [a2] spell_effect [needed: needs face, quantity:X, field:life_change.amount, field:life_change.lose, field:life_change.who, quantity:life_lost_this_way]
    Oracle: Exsanguinate: Each opponent loses X life. You gain life equal to the life lost this way.
    Effect: Each opponent gains X life. Then, gain the life lost this way life.
```

Player prompts:

- Stensian Sanguinist // Exsanguinate: choose a target: Choose target creature.

Implementation: needed (trigger:batch, face, step:grant_effect, field:grant_effect.modify, step:create_delayed_trigger, field:create_delayed_trigger.at, field:create_delayed_trigger.steps, field:create_delayed_trigger.trigger, field:grant_effect.prepared, quantity:X, field:life_change.amount, field:life_change.lose, field:life_change.who, quantity:life_lost_this_way)

Questions for you:

- Stensian Sanguinist: the target creature may be any creature, not only yours. The prepared trigger only fires if THAT creature deals combat damage to a player this combat. Confirm.

### Tainted Wood

Type: Land

Oracle text:

> {T}: Add {C}.
> {T}: Add {B} or {G}. Activate only if you control a Swamp.

Re-rendered plain English:

```
Tainted Wood [draft]
  [a1] mana [implemented]
    Oracle: {T}: Add {C}.
    Cost: {T}
    Mana: add {C}
  [a2] mana [needed: needs timing]
    Oracle: {T}: Add {B} or {G}. Activate only if you control a Swamp.
    Cost: {T}
    Timing: you control a Swamp
    Mana: add {B} and {G}
```

Player prompts:

- (none: no decisions)

Implementation: needed (timing)

### Toski, Bearer of Secrets

Type: Legendary Creature — Squirrel

Oracle text:

> This spell can't be countered.
> Indestructible
> Toski attacks each combat if able.
> Whenever a creature you control deals combat damage to a player, draw a card.

Re-rendered plain English:

```
Toski, Bearer of Secrets [draft]
  [a1] static (from stack) [needed: needs static, zone:stack]
    Oracle: This spell can't be countered.
    Static: Toski, Bearer of Secrets can't be countered
  [a2] keyword [implemented]
    Oracle: Indestructible
    Keyword: indestructible
  [a3] static [needed: needs static, static:mustAttack]
    Oracle: Toski attacks each combat if able.
    Static: Toski, Bearer of Secrets attacks each combat if able
  [a4] triggered [needed: needs trigger:subject]
    Oracle: Whenever a creature you control deals combat damage to a player, draw a card.
    Trigger: Whenever a creature you control deals combat damage to a player
    Effect: Draw a card.
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, zone:stack, static:mustAttack, trigger:subject)

### Toxic Deluge

Type: Sorcery

Oracle text:

> As an additional cost to cast this spell, pay X life.
> All creatures get -X/-X until end of turn.

Re-rendered plain English:

```
Toxic Deluge [draft]
  Cast option c1: you may use additional (from hand, cost pay life equal to X) [needed]
  [a1] cast_option [needed: needs cast_option]
    Oracle: As an additional cost to cast this spell, pay X life.
  [a2] spell_effect [needed: needs quantity:math, field:mass_pump.amountLockedOn, field:mass_pump.filter]
    Oracle: All creatures get -X/-X until end of turn.
    Effect: All creatures get +-1 x X/+-1 x X until end of turn.
```

Player prompts:

- Toxic Deluge: additional cost: Choose how to pay the additional cost (pay life equal to X).

Implementation: needed (cast_option, quantity:math, field:mass_pump.amountLockedOn, field:mass_pump.filter, cast_option:additional, cast_option:mandatory, cost:life)

### Turbulent Fen

Type: Land — Swamp Forest

Oracle text:

> ({T}: Add {B} or {G}.)
> This land enters tapped unless your opponents control eight or more lands.

Re-rendered plain English:

```
Turbulent Fen [draft]
  [a1] mana [implemented]
    Oracle: ({T}: Add {B} or {G}.)
    Cost: {T}
    Mana: add {B} and {G}
  [a2] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped unless your opponents control eight or more lands.
    Replacement: If Turbulent Fen would enter (only if it is not true that you control eight or more lands an opponent controls), it enters tapped
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter)

### Twilight Diviner

Type: Creature — Elf Cleric

Oracle text:

> When this creature enters, surveil 2. (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
> Whenever one or more other creatures you control enter, if they entered or were cast from a graveyard, create a token that's a copy of one of them. This ability triggers only once each turn.

Re-rendered plain English:

```
Twilight Diviner [draft]
  [a1] triggered [needed: needs step:surveil]
    Oracle: When this creature enters, surveil 2. (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
    Trigger: Whenever Twilight Diviner enters
    Effect: Surveil 2.
  [a2] triggered [needed: needs timing, trigger:batch, trigger:subject, trigger:zones, step:copy, field:copy.chooseOne, field:copy.controller, field:copy.token, field:copy.what]
    Oracle: Whenever one or more other creatures you control enter, if they entered or were cast from a graveyard, create a token that's a copy of one of them. This ability triggers only once each turn.
    Trigger: Whenever one or more other creatures you control enter
    Timing: 1 per turn
    Effect: Copy the target.
```

Player prompts:

- (none: no decisions)

Implementation: needed (step:surveil, timing, trigger:batch, trigger:subject, trigger:zones, step:copy, field:copy.chooseOne, field:copy.controller, field:copy.token, field:copy.what)

### Vernal Fen

Type: Land — Swamp Forest

Oracle text:

> ({T}: Add {B} or {G}.)
> This land enters tapped unless you control two or more basic lands.

Re-rendered plain English:

```
Vernal Fen [draft]
  [a1] mana [implemented]
    Oracle: ({T}: Add {B} or {G}.)
    Cost: {T}
    Mana: add {B} and {G}
  [a2] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped unless you control two or more basic lands.
    Replacement: If Vernal Fen would enter (only if it is not true that you control two or more basic lands), it enters tapped
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter)

### Victimize

Type: Sorcery

Oracle text:

> Choose two target creature cards in your graveyard. Sacrifice a creature. If you do, return the chosen cards to the battlefield tapped.

Re-rendered plain English:

```
Victimize [draft]
  [a1] spell_effect [needed: needs targets:multi, field:sacrifice_permanent.filter, field:reanimate.tapped, predicate:step_done]
    Oracle: Choose two target creature cards in your graveyard. Sacrifice a creature. If you do, return the chosen cards to the battlefield tapped.
    Target t1: two target creature cards in your graveyard  <- prompt: "Choose two target creature cards in your graveyard."
    Effect: Sacrifice a creature. Then, IF you did (s1): return two target creature cards in your graveyard from the graveyard to the battlefield.
```

Player prompts:

- Victimize: choose targets: Choose two target creature cards in your graveyard.
- Victimize: sacrifice: Choose a permanent to sacrifice.

Implementation: needed (targets:multi, field:sacrifice_permanent.filter, field:reanimate.tapped, predicate:step_done)

### Village Rites

Type: Instant

Oracle text:

> As an additional cost to cast this spell, sacrifice a creature.
> Draw two cards.

Re-rendered plain English:

```
Village Rites [draft]
  [a1] cast_option [needed: needs cast_option, cost:sacrifice]
    Oracle: As an additional cost to cast this spell, sacrifice a creature.
    Cost: sacrifice a creature you control
  [a2] spell_effect [implemented]
    Oracle: Draw two cards.
    Effect: Draw 2 cards.
```

Player prompts:

- Village Rites: choose what to sacrifice: Choose 1 creature you control to sacrifice.

Implementation: needed (cast_option, cost:sacrifice)

### Witch of the Moors

Type: Creature — Human Warlock

Oracle text:

> Deathtouch
> At the beginning of your end step, if you gained life this turn, each opponent sacrifices a creature of their choice and you return up to one target creature card from your graveyard to your hand.

Re-rendered plain English:

```
Witch of the Moors [draft]
  [a1] keyword [implemented]
    Oracle: Deathtouch
    Keyword: deathtouch
  [a2] triggered [needed: needs trigger:intervening_if, targets:multi, field:sacrifice_permanent.filter, field:sacrifice_permanent.who, field:move_card_zone.from]
    Oracle: At the beginning of your end step, if you gained life this turn, each opponent sacrifices a creature of their choice and you return up to one target creature card from your graveyard to your hand.
    Trigger: At the beginning of your end step, if you gain life this turn
    Target t1: up to one target creature card in your graveyard  <- prompt: "Choose up to one target creature card in your graveyard."
    Effect: Each opponent sacrifices a creature. Then, put up to one target creature card in your graveyard into your hand.
```

Player prompts:

- Witch of the Moors: choose a target: Choose up to one target creature card in your graveyard.
- Witch of the Moors: sacrifice: Choose a permanent to sacrifice.

Implementation: needed (trigger:intervening_if, targets:multi, field:sacrifice_permanent.filter, field:sacrifice_permanent.who, field:move_card_zone.from)

### Woodland Cemetery

Type: Land

Oracle text:

> This land enters tapped unless you control a Swamp or a Forest.
> {T}: Add {B} or {G}.

Re-rendered plain English:

```
Woodland Cemetery [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped unless you control a Swamp or a Forest.
    Replacement: If Woodland Cemetery would enter (only if it is not true that you control a Swamp or Forest), it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {B} or {G}.
    Cost: {T}
    Mana: add {B} and {G}
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter)

### Zulaport Cutthroat

Type: Creature — Human Rogue Ally

Oracle text:

> Whenever this creature or another creature you control dies, each opponent loses 1 life and you gain 1 life.

Re-rendered plain English:

```
Zulaport Cutthroat [draft]
  [a1] triggered [needed: needs trigger:multi_event, trigger:subject, field:life_change.amount, field:life_change.lose, field:life_change.who]
    Oracle: Whenever this creature or another creature you control dies, each opponent loses 1 life and you gain 1 life.
    Trigger: Whenever Zulaport Cutthroat dies or an another creature you control dies
    Effect: Each opponent gains 1 life. Then, gain 1 life.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:multi_event, trigger:subject, field:life_change.amount, field:life_change.lose, field:life_change.who)

## Kernel to-do: missing capabilities across this deck

| capability | cards | needing it |
|---|---|---|
| `cost:sacrifice` | 19 | Cankerbloom; Carrion Feeder; Dina, Essence Brewer; Eldritch Evolution; Evolving Wilds; Fiend Artisan; Gyome, Master Chef; Harrow; High Market; Immoral Bargain; Izoni, Thousand-Eyed; Jarad, Golgari Lich Lord; Priest of Forgotten Gods; Sakura-Tribe Elder; Spore Frog; Terramorphic Expanse; Village Rites; Viscera Seer; Wight of the Reliquary |
| `trigger:subject` | 17 | Meren of Clan Nel Toth; Blood Artist; Dina, Essence Brewer; Gorma, the Gullet; Grim Haruspex; Guardian Project; Insidious Roots; Mazirek, Kraul Death Priest; Midnight Reaper; Morbid Opportunist; Savra, Queen of the Golgari; Skullclamp; Toski, Bearer of Secrets; Twilight Diviner; Willow Geist; Ygra, Eater of All; Zulaport Cutthroat |
| `field:life_change.amount` | 13 | Blood Artist; Dina, Essence Brewer; Feed the Swarm; High Market; Izoni, Thousand-Eyed; Jarad, Golgari Lich Lord; Jungle Hollow; Priest of Forgotten Gods; Reanimate; Savra, Queen of the Golgari; Stensian Sanguinist // Exsanguinate; Willow Geist; Zulaport Cutthroat |
| `field:move_card_zone.from` | 12 | Meren of Clan Nel Toth; Cultivate; Deadly Brew; Deathbonnet Sprout // Deathbonnet Hulk; Eternal Witness; Find // Finality; Glowspore Shaman; Golgari Rot Farm; Jarad, Golgari Lich Lord; Living Death; Mulch; Witch of the Moors |
| `field:choose.saveAs` | 10 | Cultivate; Deadly Brew; Deathbonnet Sprout // Deathbonnet Hulk; Dina's Guidance; Find // Finality; Glowspore Shaman; Golgari Rot Farm; Grisly Salvage; Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun; Old Rutstein |
| `predicate:step_done` | 10 | Deadly Brew; Deathbonnet Sprout // Deathbonnet Hulk; Find // Finality; Glowspore Shaman; Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun; Necroblossom Snarl; Overgrown Tomb; Plaguecrafter; Savra, Queen of the Golgari; Victimize |
| `replacement:would_enter` | 10 | Golgari Rot Farm; Gorma, the Gullet; Jungle Hollow; Khalni Garden; Necroblossom Snarl; Overgrown Tomb; Turbulent Fen; Underground Mortuary; Vernal Fen; Woodland Cemetery |
| `static` | 10 | Carrion Feeder; Fiend Artisan; Insidious Roots; Jarad, Golgari Lich Lord; Old Stickfingers; Skullclamp; Swiftfoot Boots; Toski, Bearer of Secrets; Wight of the Reliquary; Ygra, Eater of All |
| `step:add_counters` | 10 | Meren of Clan Nel Toth; Carrion Feeder; Deathbonnet Sprout // Deathbonnet Hulk; Dina, Essence Brewer; Find // Finality; Gorma, the Gullet; Insidious Roots; Mazirek, Kraul Death Priest; Willow Geist; Ygra, Eater of All |
| `step:choose` | 10 | Cultivate; Deadly Brew; Deathbonnet Sprout // Deathbonnet Hulk; Dina's Guidance; Find // Finality; Glowspore Shaman; Golgari Rot Farm; Grisly Salvage; Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun; Old Rutstein |
| `field:choose.count` | 9 | Cultivate; Deadly Brew; Deathbonnet Sprout // Deathbonnet Hulk; Find // Finality; Glowspore Shaman; Golgari Rot Farm; Grisly Salvage; Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun; Old Rutstein |
| `field:choose.from` | 9 | Cultivate; Deadly Brew; Deathbonnet Sprout // Deathbonnet Hulk; Find // Finality; Glowspore Shaman; Golgari Rot Farm; Grisly Salvage; Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun; Old Rutstein |
| `field:search_library.count` | 9 | Cultivate; Dina's Guidance; Eldritch Evolution; Evolving Wilds; Fiend Artisan; Harrow; Sakura-Tribe Elder; Terramorphic Expanse; Wight of the Reliquary |
| `field:search_library.filter` | 9 | Cultivate; Dina's Guidance; Eldritch Evolution; Evolving Wilds; Fiend Artisan; Harrow; Sakura-Tribe Elder; Terramorphic Expanse; Wight of the Reliquary |
| `field:search_library.to` | 9 | Cultivate; Dina's Guidance; Eldritch Evolution; Evolving Wilds; Fiend Artisan; Harrow; Sakura-Tribe Elder; Terramorphic Expanse; Wight of the Reliquary |
| `step:search_library` | 9 | Cultivate; Dina's Guidance; Eldritch Evolution; Evolving Wilds; Fiend Artisan; Harrow; Sakura-Tribe Elder; Terramorphic Expanse; Wight of the Reliquary |
| `field:add_counters.on` | 8 | Meren of Clan Nel Toth; Carrion Feeder; Deathbonnet Sprout // Deathbonnet Hulk; Dina, Essence Brewer; Find // Finality; Gorma, the Gullet; Willow Geist; Ygra, Eater of All |
| `field:life_change.lose` | 8 | Blood Artist; Feed the Swarm; Jarad, Golgari Lich Lord; Priest of Forgotten Gods; Reanimate; Savra, Queen of the Golgari; Stensian Sanguinist // Exsanguinate; Zulaport Cutthroat |
| `field:move_card_zone.what` | 7 | Cultivate; Dina's Guidance; Grisly Salvage; Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun; Living Death; Mulch; Old Stickfingers |
| `field:sacrifice_permanent.filter` | 7 | Deadly Brew; Living Death; Plaguecrafter; Priest of Forgotten Gods; Savra, Queen of the Golgari; Victimize; Witch of the Moors |
| `field:search_library.shuffle` | 7 | Eldritch Evolution; Evolving Wilds; Fiend Artisan; Harrow; Sakura-Tribe Elder; Terramorphic Expanse; Wight of the Reliquary |
| `field:sacrifice_permanent.who` | 6 | Deadly Brew; Living Death; Plaguecrafter; Priest of Forgotten Gods; Savra, Queen of the Golgari; Witch of the Moors |
| `targets:multi` | 6 | Find // Finality; Moseo, Vein's New Dean; Pest Infestation; Priest of Forgotten Gods; Victimize; Witch of the Moors |
| `cast_option` | 5 | Eldritch Evolution; Harrow; Immoral Bargain; Toxic Deluge; Village Rites |
| `face` | 5 | Deathbonnet Sprout // Deathbonnet Hulk; Eccentric Pestfinder // Turn Stones; Find // Finality; Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun; Stensian Sanguinist // Exsanguinate |
| `field:create_tokens.tokenAbilities` | 5 | Beledros Witherbloom; Eccentric Pestfinder // Turn Stones; Moseo, Vein's New Dean; Pest Infestation; Ribtruss Roaster |
| `field:life_change.who` | 5 | Blood Artist; Jarad, Golgari Lich Lord; Priest of Forgotten Gods; Stensian Sanguinist // Exsanguinate; Zulaport Cutthroat |
| `quantity:stat` | 5 | Dina, Essence Brewer; Feed the Swarm; Jarad, Golgari Lich Lord; Reanimate; Willow Geist |
| `timing` | 5 | Beledros Witherbloom; Dina, Essence Brewer; Morbid Opportunist; Tainted Wood; Twilight Diviner |
| `trigger:batch` | 5 | Insidious Roots; Morbid Opportunist; Stensian Sanguinist // Exsanguinate; Twilight Diviner; Willow Geist |
| `trigger:intervening_if` | 5 | Eccentric Pestfinder // Turn Stones; Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun; Guardian Project; Moseo, Vein's New Dean; Witch of the Moors |
| `field:search_library.tapped` | 4 | Evolving Wilds; Sakura-Tribe Elder; Terramorphic Expanse; Wight of the Reliquary |
| `predicate:not` | 4 | Guardian Project; Necroblossom Snarl; Overgrown Tomb; Plaguecrafter |
| `trigger:zones` | 4 | Insidious Roots; Twilight Diviner; Willow Geist; Ygra, Eater of All |
| `cost:life` | 3 | Beledros Witherbloom; Phyrexian Reclamation; Toxic Deluge |
| `field:add_mana.produces` | 3 | Culling Ritual; Dark Ritual; Priest of Forgotten Gods |
| `field:grant_effect.modify` | 3 | Eccentric Pestfinder // Turn Stones; Gyome, Master Chef; Stensian Sanguinist // Exsanguinate |
| `field:move_card_zone.all` | 3 | Living Death; Mulch; Old Stickfingers |
| `field:move_card_zone.filter` | 3 | Living Death; Mulch; Old Stickfingers |
| `field:move_card_zone.position` | 3 | Glowspore Shaman; Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun; Old Stickfingers |
| `mana:variable` | 3 | Arcane Signet; Command Tower; Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun |
| `quantity:X` | 3 | Immoral Bargain; Pest Infestation; Stensian Sanguinist // Exsanguinate |
| `ref:sacrificed` | 3 | Dina, Essence Brewer; Eldritch Evolution; Jarad, Golgari Lich Lord |
| `step:add_mana` | 3 | Culling Ritual; Dark Ritual; Priest of Forgotten Gods |
| `step:grant_effect` | 3 | Eccentric Pestfinder // Turn Stones; Gyome, Master Chef; Stensian Sanguinist // Exsanguinate |
| `step:look_top` | 3 | Grisly Salvage; Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun; Mulch |
| `step:reveal` | 3 | Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun; Necroblossom Snarl; Old Stickfingers |
| `trigger:leaves` | 3 | Insidious Roots; Willow Geist; Ygra, Eater of All |
| `trigger:multi_event` | 3 | Blood Artist; Old Rutstein; Zulaport Cutthroat |
| `trigger:sacrifice` | 3 | Dina, Essence Brewer; Mazirek, Kraul Death Priest; Savra, Queen of the Golgari |
| `field:add_counters.all` | 2 | Insidious Roots; Mazirek, Kraul Death Priest |
| `field:add_counters.filter` | 2 | Insidious Roots; Mazirek, Kraul Death Priest |
| `field:attach.to` | 2 | Skullclamp; Swiftfoot Boots |
| `field:attach.what` | 2 | Skullclamp; Swiftfoot Boots |
| `field:choose.fromLooked` | 2 | Grisly Salvage; Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun |
| `field:destroy_target.amount` | 2 | Immoral Bargain; Pest Infestation |
| `field:grant_effect.prepared` | 2 | Eccentric Pestfinder // Turn Stones; Stensian Sanguinist // Exsanguinate |
| `field:if_else.else` | 2 | Meren of Clan Nel Toth; Dina's Guidance |
| `field:if_else.if` | 2 | Meren of Clan Nel Toth; Dina's Guidance |
| `field:if_else.then` | 2 | Meren of Clan Nel Toth; Dina's Guidance |
| `field:look_top.reveal` | 2 | Grisly Salvage; Mulch |
| `field:mass_pump.filter` | 2 | Find // Finality; Toxic Deluge |
| `field:search_library.reveal` | 2 | Cultivate; Dina's Guidance |
| `field:search_library.saveAs` | 2 | Cultivate; Dina's Guidance |
| `field:search_library.upTo` | 2 | Cultivate; Harrow |
| `predicate:matches` | 2 | Deathbonnet Sprout // Deathbonnet Hulk; Old Rutstein |
| `quantity:count` | 2 | Arachnogenesis; Izoni, Thousand-Eyed |
| `quantity:count_this_turn` | 2 | Gorma, the Gullet; Gyome, Master Chef |
| `quantity:math` | 2 | Pest Infestation; Toxic Deluge |
| `replacement:damage_qualifiers` | 2 | Arachnogenesis; Spore Frog |
| `replacement:duration` | 2 | Arachnogenesis; Spore Frog |
| `replacement:would_deal_damage` | 2 | Arachnogenesis; Spore Frog |
| `step:attach` | 2 | Skullclamp; Swiftfoot Boots |
| `step:if_else` | 2 | Meren of Clan Nel Toth; Dina's Guidance |
| `step:shuffle` | 2 | Cultivate; Dina's Guidance |
| `step:surveil` | 2 | Twilight Diviner; Underground Mortuary |
| `step:transform` | 2 | Deathbonnet Sprout // Deathbonnet Hulk; Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun |
| `targets:variable_count` | 2 | Immoral Bargain; Pest Infestation |
| `zone:stack` | 2 | Old Stickfingers; Toski, Bearer of Secrets |
| `cast_option:additional` | 1 | Toxic Deluge |
| `cast_option:mandatory` | 1 | Toxic Deluge |
| `cost:x` | 1 | Fiend Artisan |
| `field:choose.choice` | 1 | Dina's Guidance |
| `field:choose.fromMilled` | 1 | Old Rutstein |
| `field:choose.fromRevealed` | 1 | Cultivate |
| `field:choose.options` | 1 | Dina's Guidance |
| `field:choose.remember` | 1 | Dina's Guidance |
| `field:copy.chooseOne` | 1 | Twilight Diviner |
| `field:copy.controller` | 1 | Twilight Diviner |
| `field:copy.token` | 1 | Twilight Diviner |
| `field:copy.what` | 1 | Twilight Diviner |
| `field:create_delayed_trigger.at` | 1 | Stensian Sanguinist // Exsanguinate |
| `field:create_delayed_trigger.steps` | 1 | Stensian Sanguinist // Exsanguinate |
| `field:create_delayed_trigger.trigger` | 1 | Stensian Sanguinist // Exsanguinate |
| `field:create_tokens.tokenKeywords` | 1 | Arachnogenesis |
| `field:damage_target.source` | 1 | Llanowar Wastes |
| `field:destroy_all.filter` | 1 | Culling Ritual |
| `field:discard.who` | 1 | Plaguecrafter |
| `field:if_else.srcs` | 1 | Meren of Clan Nel Toth |
| `field:mass_pump.amountLockedOn` | 1 | Toxic Deluge |
| `field:move_card_zone.order` | 1 | Old Stickfingers |
| `field:move_card_zone.ordered` | 1 | Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun |
| `field:move_card_zone.saveAs` | 1 | Living Death |
| `field:move_card_zone.tapped` | 1 | Cultivate |
| `field:move_card_zone.who` | 1 | Living Death |
| `field:reanimate.tapped` | 1 | Victimize |
| `field:reveal.filter` | 1 | Necroblossom Snarl |
| `field:reveal.saveAs` | 1 | Old Stickfingers |
| `field:reveal.until` | 1 | Old Stickfingers |
| `field:sacrifice_permanent.all` | 1 | Living Death |
| `field:untap_target.all` | 1 | Beledros Witherbloom |
| `field:untap_target.filter` | 1 | Beledros Witherbloom |
| `filter:attackingYou` | 1 | Arachnogenesis |
| `filter:notSubtypes` | 1 | Arachnogenesis |
| `modes` | 1 | Cankerbloom |
| `predicate:all` | 1 | Deathbonnet Sprout // Deathbonnet Hulk |
| `predicate:chosen_is` | 1 | Dina's Guidance |
| `predicate:name_matches` | 1 | Guardian Project |
| `predicate:stat` | 1 | Meren of Clan Nel Toth |
| `quantity:counters` | 1 | Ribtruss Roaster |
| `quantity:life_gained_this_turn` | 1 | Moseo, Vein's New Dean |
| `quantity:life_lost_this_way` | 1 | Stensian Sanguinist // Exsanguinate |
| `quantity:players_count` | 1 | Eccentric Pestfinder // Turn Stones |
| `quantity:step_result` | 1 | Culling Ritual |
| `static:addTypes` | 1 | Ygra, Eater of All |
| `static:mustAttack` | 1 | Toski, Bearer of Secrets |
| `static:setBasePT` | 1 | Old Stickfingers |
| `step:copy` | 1 | Twilight Diviner |
| `step:counter_spell` | 1 | Ygra, Eater of All |
| `step:create_delayed_trigger` | 1 | Stensian Sanguinist // Exsanguinate |
| `step:proliferate` | 1 | Cankerbloom |
| `step:scry` | 1 | Viscera Seer |
| `step:unless_pay` | 1 | Ygra, Eater of All |
| `targets:any_number` | 1 | Priest of Forgotten Gods |
| `trigger:becomes_target` | 1 | Ygra, Eater of All |
| `zone:graveyard` | 1 | Jarad, Golgari Lich Lord |

## Decisions

- SCHEMA QUESTION: the Prepared mechanic (Eccentric Pestfinder // Turn Stones, Stensian Sanguinist // Exsanguinate) has no state or rule: drafted as a grant_effect step with prepared:true / modify grant "prepared" on self (Stensian's second sentence is a create_delayed_trigger step, untyped at:"this_combat", trigger deals_combat_damage_to_player on t1). Wanted: a prepared flag on the permanent, a step to set/clear it, and the 'cast a copy of the back-face spell, then unprepare' permission as a kernel rule.
- SCHEMA QUESTION: double-faced cards (Deathbonnet Sprout // Hulk, Growing Rites of Itlimoc // Itlimoc, Eccentric Pestfinder // Turn Stones, Stensian Sanguinist // Exsanguinate, Find // Finality) again carry both faces in one abilities[] with a face-name prefix in each text, as in the Meren deck. Same wanted fix: ability.face or card.faces[].
- SCHEMA QUESTION: a search/reveal whose found cards go to DIFFERENT zones (Cultivate: one onto the battlefield tapped, the other to hand; Dina's Guidance: the found card to hand OR graveyard) has no vocabulary: drafted as search_library with to:"revealed" + saveAs, then a choose step (fromRevealed), move_card_zone steps (what rest_of_revealed_cards) and a separate shuffle; Dina's Guidance uses a choose choice:"mode" (hand/graveyard) read by an if_else. Wanted: search_library.split or a typed 'reveal then distribute' step.
- SCHEMA QUESTION: 'for each permanent destroyed this way' (Culling Ritual: add {B} or {G} for each) has no Quantity: drafted as add_mana with amount event_amount plus step field amountOf:"s1" (same workaround as Decree of Pain in the Squirreled Away deck). Wanted: Quantity ref step_count {step}. Also each mana is B or G chosen separately (produces lists the alternatives).
- SCHEMA QUESTION: Guardian Project's 'if it doesn't have the same name as another creature you control or a creature card in your graveyard' has no predicate (ObjectFilter.named is a fixed string, sameName is a group qualifier): drafted as a scripted handler unique_name_check (params list the two comparison pools) on a normal triggered ability with the draw step, plus review.ignore for if/another. Wanted: ObjectFilter.sameNameAs (ObjRef) or a Predicate nameMatches {obj, pools}. The handler is not in the known scripted-marker list.
- SCHEMA QUESTION: 'the amount of life you gained this turn' (Moseo, Infusion X) has no Quantity: drafted as count_this_turn gain_life actor you, which counts gain EVENTS, not life points. Wanted: Quantity ref life_gained_this_turn {who} (also a sum variant of count_this_turn).
- SCHEMA QUESTION: target count equal to a variable (Immoral Bargain 'destroy X target nonland permanents', Pest Infestation 'destroy up to X targets', Priest of Forgotten Gods 'any number of target players'): TargetSpec.count is two ints, so drafted as min 0 / max 99 (the 'any number' precedent) plus step amount X. Wanted: TargetSpec.count accepting Quantity (min/max), 'any number' as max:"any".
- SCHEMA QUESTION: add_counters on a whole group (Mazirek 'a +1/+1 counter on each creature you control', Insidious Roots 'on each Plant you control') has no typed field: drafted as add_counters with all:true and filter (untyped passthrough, flagged as needs). Wanted: add_counters.all + filter typed, or an `on` that accepts an ObjectFilter.
- SCHEMA QUESTION: 'if a land / creature / noncreature nonland card is milled this way' (Old Rutstein) has no ref to the cards a mill step moved: drafted as mill (s1) then a choose step with fromMilled and saveAs chosen (the single milled card), with matches conditions on `chosen`. Wanted: ObjRef milled (or step result ref) so no helper choose is needed; also an empty library mills nothing.
- SCHEMA QUESTION: 'reveal cards from the top of your library until you reveal X creature cards' (Old Stickfingers) uses the untyped reveal.until {count, filter}, with move_card_zone what revealed_cards / rest_of_revealed_cards (order random is typed). 'When you cast this spell' is a triggered ability with zone stack and trigger cast/self (Plumb the Forbidden precedent); the X is the spell's X (xPrompt). The static P/T uses setBasePT (characteristic-defining) with the graveyard count.
- SCHEMA QUESTION: replacement modify 'enters with an additional +1/+1 counter for each creature that died under your control this turn' (Gorma) is written as would_enter with subject filter and set.counters {kind, count: Quantity} (set is a loose record; the earlier escape-counters precedent). 'Additional' means on top of any counters it already enters with; the kernel must add, not overwrite.
- SCHEMA QUESTION: Ygra's Ward is a keyword+triggered ability with unlessPay cost sacrifice a Food (Roaming Throne precedent for ward costs; keyword param is the cost text). 'Other creatures are Food artifacts in addition to their other types and have "{2}, {T}, Sacrifice this permanent: You gain 3 life."' is a static with addTypes [Artifact, Food] and a loose grantAbility record; the type-change layer (a creature that is also a Food, so Gyome's/Ygra's Food filters match it) is a kernel rule. 'Whenever a Food is put into a graveyard from the battlefield' is event leaves with fromZone battlefield / toZone graveyard (there is no 'put into a graveyard' event name).
- SCHEMA QUESTION: Devour 1 (Ribtruss Roaster) is a bare keyword ability with param 1; the 'sacrifice any number of creatures as it enters, enters with that many counters' replacement is a kernel rule (not encoded per card), like Saga lore counters.
- SCHEMA QUESTION: Mazirek's 'a player sacrifices another permanent' uses trigger event sacrifice with subject controller:any, whose:each; the sacrifice event has no acting-player field in the schema (whose is the sacrificing player). Savra's 'each other player' is each_opponent (identical in a 2-player game; in multiplayer Commander it is every other player, which equals each opponent).
- SCHEMA QUESTION: per-player 'if you sacrificed a permanent this way' (Deadly Brew: the 'you' part of each_player) uses step_done on the shared sacrifice step, which cannot tell WHICH player sacrificed (same gap as Plaguecrafter/Braids in the Meren deck). Wanted: step_done.who or a per-player result.
