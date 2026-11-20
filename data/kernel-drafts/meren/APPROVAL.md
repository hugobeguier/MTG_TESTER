# Kernel draft approval: Meren

100 unique cards: 54 simple (A), 46 complex (B). Validator: 100/100 pass. Cards with implementation "needed": 96. All drafts are `review.status: "draft"`; nothing was written to the DB.

Reading guide: each card below shows the oracle text and what the structured JSON says back in plain English. Approve if they match.

## (A) Simple cards: spot-check one line each

- **Plaguecrafter** (Creature — Human Shaman): Whenever Plaguecrafter enters: Each player sacrifices a creature or planeswalker, then each player discard a card [needs: field:sacrifice_permanent.filter, field:sacrifice_permanent.who, field:discard.who, predicate:not, predicate:step_done]
- **Sakura-Tribe Elder** (Creature — Snake Shaman): sacrifice Sakura-Tribe Elder: Search your library for a basic land, put it onto the battlefield, then shuffle [needs: cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to]
- **Eternal Witness** (Creature — Human Shaman): Whenever Eternal Witness enters: [targets: target card in your graveyard] You may put target card in your graveyard into your hand [needs: field:move_card_zone.from]
- **Viscera Seer** (Creature — Vampire Wizard): sacrifice a creature you control: Scry 1 [needs: cost:sacrifice, step:scry]
- **Accursed Marauder** (Creature — Zombie Warrior): Whenever Accursed Marauder enters: Each player sacrifices a nontoken creature [needs: field:sacrifice_permanent.filter, field:sacrifice_permanent.who]
- **Grim Haruspex** (Creature — Human Wizard): Keyword morph {B} | Whenever a nontoken another creature you control dies: Draw a card [needs: trigger:subject]
- **Carrion Feeder** (Creature — Zombie): Carrion Feeder can't block | sacrifice a creature you control: Put a +1/+1 counter on Carrion Feeder [needs: static, cost:sacrifice, step:add_counters, field:add_counters.on]
- **Fleshbag Marauder** (Creature — Zombie Warrior): Whenever Fleshbag Marauder enters: Each player sacrifices a creature [needs: field:sacrifice_permanent.filter, field:sacrifice_permanent.who]
- **Ravenous Chupacabra** (Creature — Beast Horror): Whenever Ravenous Chupacabra enters: [targets: target creature an opponent controls] Destroy target creature an opponent controls [implemented]
- **High Market** (Land): {T}: add {C} | {T}, sacrifice a creature you control: Gain 1 life [needs: cost:sacrifice, field:life_change.amount]
- **Entomb** (Instant): Search your library for a permanent, put it onto the graveyard, then shuffle [needs: step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.to]
- **Blood Artist** (Creature — Vampire): Whenever Blood Artist dies or an another creature dies: [targets: target player] Target player gains 1 life, then gain 1 life [needs: trigger:multi_event, trigger:subject, field:life_change.amount, field:life_change.lose, field:life_change.who]
- **Mikaeus, the Unhallowed** (Legendary Creature — Zombie Cleric): Keyword intimidate | Whenever a creature is dealt damage, if that object is a Human: Destroy that object | Other non-Human creatures you control get +1/+1 and have undying [needs: trigger:dealt_damage, trigger:intervening_if, predicate:matches, trigger:subject, static, filter:notSubtypes]
- **Ashnod's Altar** (Artifact): sacrifice a creature you control: add {C}{C} [needs: cost:sacrifice]
- **Haywire Mite** (Artifact Creature — Insect): Whenever Haywire Mite dies: Gain 2 life | {G}, sacrifice Haywire Mite: [targets: target noncreature artifact or noncreature enchantment] Exile target noncreature artifact or noncreature enchantment [needs: field:life_change.amount, cost:sacrifice]
- **Living Death** (Sorcery): Exile all cards from each player's graveyard, then each player sacrifices a creature, then put all cards from each player's exile into the battlefield [needs: field:move_card_zone.all, field:move_card_zone.filter, field:move_card_zone.from, field:move_card_zone.saveAs, field:move_card_zone.who, field:sacrifice_permanent.all, field:sacrifice_permanent.filter, field:sacrifice_permanent.who, field:move_card_zone.what]
- **Solemn Simulacrum** (Artifact Creature — Golem): Whenever Solemn Simulacrum enters: You may search your library for a basic land, put it onto the battlefield, then shuffle | Whenever Solemn Simulacrum dies: You may draw a card [needs: step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to]
- **Skullclamp** (Artifact — Equipment): The equipped creature gets +1/-1 | Whenever the equipped creature dies: Draw 2 cards | {1}: [targets: target creature you control] Attach Skullclamp to target creature you control [needs: static, trigger:subject, step:attach, field:attach.to, field:attach.what]
- **Wood Elves** (Creature — Elf Scout): Whenever Wood Elves enters: Search your library for a Forest, put it onto the battlefield, then shuffle [needs: step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.to]
- **Reclamation Sage** (Creature — Elf Shaman): Whenever Reclamation Sage enters: [targets: target artifact or enchantment] You may destroy target artifact or enchantment [implemented]
- **Phyrexian Tower** (Legendary Land): {T}: add {C} | {T}, sacrifice a creature you control: add {B}{B} [needs: cost:sacrifice]
- **Grave Pact** (Enchantment): Whenever a creature you control dies: Each opponent sacrifices a creature [needs: trigger:subject, field:sacrifice_permanent.filter, field:sacrifice_permanent.who]
- **Wight of the Reliquary** (Creature — Zombie Knight): Keyword vigilance | Wight of the Reliquary gets +X/+X, where X is 1 x the number of creature cards in your graveyard | {T}, sacrifice an another creature you control: Search your library for a land, put it onto the battlefield, then shuffle [needs: static, cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to]
- **Reanimate** (Sorcery): [targets: target creature card in a graveyard] Return target creature card in a graveyard from the graveyard to the battlefield, then gain t1's mana value life [needs: quantity:stat, field:life_change.amount, field:life_change.lose]
- **Satyr Wayfinder** (Creature — Satyr): Whenever Satyr Wayfinder enters: Look at the top four cards of your library, then you may choose a land card from among the looked-at cards, then put the chosen object into your hand, then put the rest of the looked-at cards into your graveyard [needs: step:look_top, field:look_top.reveal, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, field:move_card_zone.what]
- **Caustic Caterpillar** (Creature — Insect): {1}{G}, sacrifice Caustic Caterpillar: [targets: target artifact or enchantment] Destroy target artifact or enchantment [needs: cost:sacrifice]
- **Midnight Reaper** (Creature — Zombie Knight): Whenever a nontoken creature you control dies: Deal 1 damage to the target, then draw a card [needs: trigger:subject]
- **Altar of Dementia** (Artifact): sacrifice a creature you control: [targets: target player] Target player mill the sacrificed permanent's power cards [needs: ref:sacrificed, cost:sacrifice, quantity:stat, field:mill.who]
- **Demon's Disciple** (Creature — Human Cleric): Whenever Demon's Disciple enters: Each player sacrifices a creature or planeswalker [needs: field:sacrifice_permanent.filter, field:sacrifice_permanent.who]
- **Merciless Executioner** (Creature — Orc Warrior): Whenever Merciless Executioner enters: Each player sacrifices a creature [needs: field:sacrifice_permanent.filter, field:sacrifice_permanent.who]
- **Fauna Shaman** (Creature — Elf Shaman): {G}, {T}, discard a creature card in your hand: Search your library for a creature, put it onto your hand, then shuffle [needs: cost:discard, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.reveal, field:search_library.shuffle, field:search_library.to]
- **Warren Soultrader** (Creature — Zombie Goblin Wizard): pay 1 life, sacrifice an another creature you control: Create a ?/? colorless Treasure artifact token [needs: cost:life, cost:sacrifice]
- **Phyrexian Altar** (Artifact): sacrifice a creature you control: add one mana of any color [needs: mana:variable, cost:sacrifice]
- **Acidic Slime** (Creature — Ooze): Keyword deathtouch | Whenever Acidic Slime enters: [targets: target artifact, enchantment, or land] Destroy target artifact, enchantment, or land [implemented]
- **Grisly Salvage** (Instant): Look at the top five cards of your library, then you may choose a creature or land from among the looked-at cards, then put the chosen object into your hand, then put the rest of the looked-at cards into your graveyard [needs: step:look_top, field:look_top.reveal, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, field:move_card_zone.what]
- **Umbral Collar Zealot** (Creature — Human Cleric): sacrifice a creature or artifact you control: Surveil 1 [needs: cost:sacrifice, step:surveil]
- **Grim Backwoods** (Land): {T}: add {C} | {2}{B}{G}, {T}, sacrifice a creature you control: Draw a card [needs: cost:sacrifice]
- **Journey to Eternity // Atzal, Cave of Eternity** (Legendary Enchantment — Aura // Legendary Land): [targets: target creature you control] | Whenever the enchanted creature dies: Return that object from the graveyard to the battlefield, then put Journey to Eternity // Atzal, Cave of Eternity onto the battlefield | Keyword back_face Atzal, Cave of Eternity | {T}: add one mana of any color | {3}{B}{G}, {T}: [targets: target creature card in your graveyard] Return target creature card in your graveyard from the graveyard to the battlefield [needs: keyword:enchant, trigger:subject, field:move_card_zone.transformed, mana:variable]
- **Urborg, Tomb of Yawgmoth** (Legendary Land): Lands are swamps in addition to their other types [needs: static, static:addTypes]
- **Cabal Coffers** (Land): {2}, {T}: add {{B}} for each Swamp you control [needs: mana:variable]
- **Crypt of Agadeem** (Land): If Crypt of Agadeem would enter, it enters tapped | {T}: add {B} | {2}, {T}: add {{B}} for each black creature card in your graveyard [needs: replacement:would_enter, mana:variable]
- **Dryad Arbor** (Land Creature — Forest Dryad): {T}: add {G} [implemented]
- **Westvale Abbey // Ormendahl, Profane Prince** (Land // Legendary Creature — Demon): {T}: add {C} | {5}, {T}, pay 1 life: Create a 1/1 white and black Human Cleric creature token | {5}, {T}, sacrifice 5 creatures you control: Transform Westvale Abbey // Ormendahl, Profane Prince, then untap Westvale Abbey // Ormendahl, Profane Prince | Keyword flying | Keyword lifelink | Keyword indestructible | Keyword haste [needs: cost:life, cost:sacrifice, step:transform]
- **Command Beacon** (Land): {T}: add {C} | {T}, sacrifice Command Beacon: Put a card into your hand [needs: filter:isCommander, cost:sacrifice, field:move_card_zone.filter, field:move_card_zone.from]
- **Bojuka Bog** (Land): If Bojuka Bog would enter, it enters tapped | Whenever Bojuka Bog enters: [targets: target player] Exile a card | {T}: add {B} [needs: replacement:would_enter, field:move_card_zone.what]
- **Khalni Garden** (Land): If Khalni Garden would enter, it enters tapped | Whenever Khalni Garden enters: Create a 0/1 green Plant creature token | {T}: add {G} [needs: replacement:would_enter]
- **Dakmor Salvage** (Land): If Dakmor Salvage would enter, it enters tapped | {T}: add {B} | Keyword dredge 2 [needs: replacement:would_enter]
- **Bala Ged Recovery // Bala Ged Sanctuary** (Sorcery // Land): [targets: target card in your graveyard] Put target card in your graveyard into your hand | If Bala Ged Recovery // Bala Ged Sanctuary would enter, it enters tapped | {T}: add {G} [needs: field:move_card_zone.from, replacement:would_enter]
- **Yavimaya, Cradle of Growth** (Legendary Land): Lands are forests in addition to their other types [needs: static, static:addTypes]
- **Reliquary Tower** (Land): You have no maximum hand size | {T}: add {C} [needs: static]
- **Rogue's Passage** (Land): {T}: add {C} | {4}, {T}: [targets: target creature] Target creature can't be blocked until end of turn [needs: step:grant_effect, field:grant_effect.modify]
- **Command Tower** (Land): {T}: add one mana of any color in your commander's color identity [needs: mana:variable]
- **War Room** (Land): {T}: add {C} | {3}, {T}, pay life equal to the number of colors in your commanders' color identity: Draw a card [needs: cost:life]
- **Evolving Wilds** (Land): {T}, sacrifice Evolving Wilds: Search your library for a basic land, put it onto the battlefield, then shuffle [needs: cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to]

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

### Gray Merchant of Asphodel

Type: Creature — Zombie

Oracle text:

> When this creature enters, each opponent loses X life, where X is your devotion to black. You gain life equal to the life lost this way. (Each {B} in the mana costs of permanents you control counts toward your devotion to black.)

Re-rendered plain English:

```
Gray Merchant of Asphodel [draft]
  [a1] triggered [needed: needs quantity:devotion, field:life_change.amount, field:life_change.lose, field:life_change.who, quantity:life_lost_this_way]
    Oracle: When this creature enters, each opponent loses X life, where X is your devotion to black. You gain life equal to the life lost this way. (Each {B} in the mana costs of permanents you control counts toward your devotion to black.)
    Trigger: Whenever Gray Merchant of Asphodel enters
    Effect: Each opponent gains your devotion to B life. Then, gain the life lost this way life.
```

Player prompts:

- (none: no decisions)

Implementation: needed (quantity:devotion, field:life_change.amount, field:life_change.lose, field:life_change.who, quantity:life_lost_this_way)

### Buried Alive

Type: Sorcery

Oracle text:

> Search your library for up to three creature cards, put them into your graveyard, then shuffle.

Re-rendered plain English:

```
Buried Alive [draft]
  [a1] spell_effect [needed: needs step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.to, field:search_library.upTo]
    Oracle: Search your library for up to three creature cards, put them into your graveyard, then shuffle.
    Effect: Search your library for a creature, put it onto the graveyard, then shuffle.
```

Player prompts:

- Buried Alive: search: Choose a creature from the library.

Implementation: needed (step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.to, field:search_library.upTo)

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

### Protean Hulk

Type: Creature — Beast

Oracle text:

> When this creature dies, search your library for any number of creature cards with total mana value 6 or less, put them onto the battlefield, then shuffle.

Re-rendered plain English:

```
Protean Hulk [draft]
  [a1] triggered [needed: needs step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.to, field:search_library.totalManaValueAtMost, field:search_library.upTo]
    Oracle: When this creature dies, search your library for any number of creature cards with total mana value 6 or less, put them onto the battlefield, then shuffle.
    Trigger: Whenever Protean Hulk dies
    Effect: Search your library for a creature, put it onto the battlefield, then shuffle.
```

Player prompts:

- Protean Hulk: search: Choose a creature from the library.

Implementation: needed (step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.to, field:search_library.totalManaValueAtMost, field:search_library.upTo)

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

### Massacre Wurm

Type: Creature — Phyrexian Wurm

Oracle text:

> When this creature enters, creatures your opponents control get -2/-2 until end of turn.
> Whenever a creature an opponent controls dies, that player loses 2 life.

Re-rendered plain English:

```
Massacre Wurm [draft]
  [a1] triggered [needed: needs field:mass_pump.filter]
    Oracle: When this creature enters, creatures your opponents control get -2/-2 until end of turn.
    Trigger: Whenever Massacre Wurm enters
    Effect: All creatures get -2/-2 until end of turn.
  [a2] triggered [needed: needs trigger:subject, field:life_change.amount, field:life_change.lose, field:life_change.who]
    Oracle: Whenever a creature an opponent controls dies, that player loses 2 life.
    Trigger: Whenever a creature an opponent controls dies
    Effect: That player gains 2 life.
```

Player prompts:

- (none: no decisions)

Implementation: needed (field:mass_pump.filter, trigger:subject, field:life_change.amount, field:life_change.lose, field:life_change.who)

### Syr Konrad, the Grim

Type: Legendary Creature — Human Knight

Oracle text:

> Whenever another creature dies, or a creature card is put into a graveyard from anywhere other than the battlefield, or a creature card leaves your graveyard, Syr Konrad deals 1 damage to each opponent.
> {1}{B}: Each player mills a card. (They each put the top card of their library into their graveyard.)

Re-rendered plain English:

```
Syr Konrad, the Grim [draft]
  [a1] triggered [needed: needs trigger:subject, trigger:multi_event, trigger:unspecified, trigger:zones, trigger:leaves, field:damage_target.source, field:damage_target.who]
    Oracle: Whenever another creature dies, or a creature card is put into a graveyard from anywhere other than the battlefield, or a creature card leaves your graveyard, Syr Konrad deals 1 damage to each opponent.
    Trigger: Whenever an another creature dies or a creature unspecified or a creature unspecified or a creature unspecified or a creature unspecified or a creature card in your graveyard leaves a graveyard
    Effect: Syr Konrad, the Grim deals 1 damage to the target.
  [a2] activated [needed: needs field:mill.who]
    Oracle: {1}{B}: Each player mills a card. (They each put the top card of their library into their graveyard.)
    Cost: {1}{B}
    Effect: Each player mill 1 cards.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:subject, trigger:multi_event, trigger:unspecified, trigger:zones, trigger:leaves, field:damage_target.source, field:damage_target.who, field:mill.who)

### Shriekmaw

Type: Creature — Elemental

Oracle text:

> Fear (This creature can't be blocked except by artifact creatures and/or black creatures.)
> When this creature enters, destroy target nonartifact, nonblack creature.
> Evoke {1}{B} (You may cast this spell for its evoke cost. If you do, it's sacrificed when it enters.)

Re-rendered plain English:

```
Shriekmaw [draft]
  Cast option c1: you may use evoke (from hand, cost {1}{B}, replaces mana cost) [needed]
  [a1] keyword [implemented]
    Oracle: Fear (This creature can't be blocked except by artifact creatures and/or black creatures.)
    Keyword: fear
  [a2] triggered [implemented]
    Oracle: When this creature enters, destroy target nonartifact, nonblack creature.
    Trigger: Whenever Shriekmaw enters
    Target t1: target nonartifact nonblack creature  <- prompt: "Choose target nonartifact nonblack creature."
    Effect: Destroy target nonartifact nonblack creature.
```

Player prompts:

- Shriekmaw: choose a target: Choose target nonartifact nonblack creature.
- Shriekmaw: evoke option: Do you want to cast it using its evoke cost ({1}{B})?

Implementation: needed (cast_option:evoke)

### Sheoldred // The True Scriptures

Type: Legendary Creature — Phyrexian Praetor // Enchantment — Saga

Oracle text:

> Sheoldred: Menace
> When Sheoldred enters, each opponent sacrifices a nontoken creature or planeswalker of their choice.
> {4}{B}: Exile Sheoldred, then return it to the battlefield transformed under its owner's control. Activate only as a sorcery and only if an opponent has eight or more cards in their graveyard.
> 
> The True Scriptures: (As this Saga enters and after your draw step, add a lore counter.)
> I — For each opponent, destroy up to one target creature or planeswalker that player controls.
> II — Each opponent discards three cards, then mills three cards.
> III — Put all creature cards from all graveyards onto the battlefield under your control. Exile this Saga, then return it to the battlefield (front face up).

Re-rendered plain English:

```
Sheoldred // The True Scriptures [draft]
  [a1] keyword [implemented]
    Oracle: Sheoldred: Menace
    Keyword: menace
  [a2] triggered [needed: needs field:sacrifice_permanent.filter, field:sacrifice_permanent.who]
    Oracle: When Sheoldred enters, each opponent sacrifices a nontoken creature or planeswalker of their choice.
    Trigger: Whenever Sheoldred // The True Scriptures enters
    Effect: Each opponent sacrifices a creature or planeswalker.
  [a3] activated [needed: needs timing, field:move_card_zone.from, field:move_card_zone.transformed, field:move_card_zone.who]
    Oracle: {4}{B}: Exile Sheoldred, then return it to the battlefield transformed under its owner's control. Activate only as a sorcery and only if an opponent has eight or more cards in their graveyard.
    Cost: {4}{B}
    Timing: sorcery; an opponent has 8 or greater cards in graveyard
    Effect: Exile Sheoldred // The True Scriptures. Then, put Sheoldred // The True Scriptures onto the battlefield.
  [a4] keyword [implemented]
    Oracle: The True Scriptures: (As this Saga enters and after your draw step, add a lore counter.)
    Keyword: saga
  [a5] triggered [needed: needs trigger:counter_put, trigger:chapters, targets:multi, targets:per_opponent]
    Oracle: I — For each opponent, destroy up to one target creature or planeswalker that player controls.
    Trigger: Chapter I
    Target t1: up to one target creature or planeswalker an opponent controls (one choice for each opponent)  <- prompt: "Choose up to one target creature or planeswalker an opponent controls (one choice for each opponent)."
    Effect: Destroy up to one target creature or planeswalker an opponent controls (one choice for each opponent).
  [a6] triggered [needed: needs trigger:counter_put, trigger:chapters, field:discard.who, field:mill.who]
    Oracle: II — Each opponent discards three cards, then mills three cards.
    Trigger: Chapter II
    Effect: Each opponent discard 3 cards. Then, each opponent mill 3 cards.
  [a7] triggered [needed: needs trigger:counter_put, trigger:chapters, field:move_card_zone.all, field:move_card_zone.filter, field:move_card_zone.from, field:move_card_zone.faceUp]
    Oracle: III — Put all creature cards from all graveyards onto the battlefield under your control. Exile this Saga, then return it to the battlefield (front face up).
    Trigger: Chapter III
    Effect: Put all cards from your graveyard into the battlefield. Then, exile Sheoldred // The True Scriptures. Then, put Sheoldred // The True Scriptures onto the battlefield.
```

Player prompts:

- Sheoldred // The True Scriptures: sacrifice: Choose a permanent to sacrifice.
- Sheoldred // The True Scriptures: choose a target: Choose up to one target creature or planeswalker an opponent controls (one choice for each opponent).
- Sheoldred // The True Scriptures: discard: Choose 3 cards to discard.

Implementation: needed (field:sacrifice_permanent.filter, field:sacrifice_permanent.who, timing, field:move_card_zone.from, field:move_card_zone.transformed, field:move_card_zone.who, trigger:counter_put, trigger:chapters, targets:multi, targets:per_opponent, field:discard.who, field:mill.who, field:move_card_zone.all, field:move_card_zone.filter, field:move_card_zone.faceUp)

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

### Butcher of Malakir

Type: Creature — Vampire Warrior

Oracle text:

> Flying
> Whenever this creature or another creature you control dies, each opponent sacrifices a creature of their choice.

Re-rendered plain English:

```
Butcher of Malakir [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:multi_event, trigger:subject, field:sacrifice_permanent.filter, field:sacrifice_permanent.who]
    Oracle: Whenever this creature or another creature you control dies, each opponent sacrifices a creature of their choice.
    Trigger: Whenever Butcher of Malakir dies or an another creature you control dies
    Effect: Each opponent sacrifices a creature.
```

Player prompts:

- Butcher of Malakir: sacrifice: Choose a permanent to sacrifice.

Implementation: needed (trigger:multi_event, trigger:subject, field:sacrifice_permanent.filter, field:sacrifice_permanent.who)

### Birthing Pod

Type: Artifact

Oracle text:

> ({G/P} can be paid with either {G} or 2 life.)
> {1}{G/P}, {T}, Sacrifice a creature: Search your library for a creature card with mana value equal to 1 plus the sacrificed creature's mana value, put that card onto the battlefield, then shuffle. Activate only as a sorcery.

Re-rendered plain English:

```
Birthing Pod [draft]
  [a1] activated [needed: needs ref:sacrificed, cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.to]
    Oracle: {1}{G/P}, {T}, Sacrifice a creature: Search your library for a creature card with mana value equal to 1 plus the sacrificed creature's mana value, put that card onto the battlefield, then shuffle. Activate only as a sorcery.
    Cost: {1}{G/P}, {T}, sacrifice a creature you control
    Timing: sorcery
    Effect: Search your library for a creature with mana value 1 + the sacrificed permanent's mana value, put it onto the battlefield, then shuffle.
```

Player prompts:

- Birthing Pod: choose what to sacrifice: Choose 1 creature you control to sacrifice.
- Birthing Pod: search: Choose a creature with mana value 1 + the sacrificed permanent's mana value from the library.

Implementation: needed (ref:sacrificed, cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.to)

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

### Animate Dead

Type: Enchantment — Aura

Oracle text:

> Enchant creature card in a graveyard
> When this Aura enters, if it's on the battlefield, it loses "enchant creature card in a graveyard" and gains "enchant creature put onto the battlefield with this Aura." Return enchanted creature card to the battlefield under your control and attach this Aura to it. When this Aura leaves the battlefield, that creature's controller sacrifices it.
> Enchanted creature gets -1/-0.

Re-rendered plain English:

```
Animate Dead [draft]
  [a1] spell_effect [needed: needs keyword:enchant]
    Oracle: Enchant creature card in a graveyard
    Target t1: target creature card in a graveyard  <- prompt: "Choose target creature card in a graveyard."
    Keyword: enchant
  [a2] triggered [needed: needs trigger:intervening_if, predicate:source_state, step:rewrite_enchant, step:attach, field:attach.to, field:attach.what, step:create_delayed_trigger, field:create_delayed_trigger.steps, field:create_delayed_trigger.trigger, field:sacrifice_permanent.who]
    Oracle: When this Aura enters, if it's on the battlefield, it loses "enchant creature card in a graveyard" and gains "enchant creature put onto the battlefield with this Aura." Return enchanted creature card to the battlefield under your control and attach this Aura to it. When this Aura leaves the battlefield, that creature's controller sacrifices it.
    Trigger: Whenever Animate Dead enters, if Animate Dead is on battlefield
    Effect: Rewrite this Aura's enchant restriction. Then, return the enchanted creature from the graveyard to the battlefield. Then, attach Animate Dead to that object. Then, create a delayed trigger.
  [a3] static [needed: needs static]
    Oracle: Enchanted creature gets -1/-0.
    Static: The enchanted creature gets -1/+0
```

Player prompts:

- Animate Dead: choose a target: Choose target creature card in a graveyard.
- Animate Dead: sacrifice: Choose a permanent to sacrifice.

Implementation: needed (keyword:enchant, trigger:intervening_if, predicate:source_state, step:rewrite_enchant, step:attach, field:attach.to, field:attach.what, step:create_delayed_trigger, field:create_delayed_trigger.steps, field:create_delayed_trigger.trigger, field:sacrifice_permanent.who, static)

### Braids, Arisen Nightmare

Type: Legendary Creature — Nightmare

Oracle text:

> At the beginning of your end step, you may sacrifice an artifact, creature, enchantment, land, or planeswalker. If you do, each opponent may sacrifice a permanent of their choice that shares a card type with it. For each opponent who doesn't, that player loses 2 life and you draw a card.

Re-rendered plain English:

```
Braids, Arisen Nightmare [draft]
  [a1] triggered [needed: needs ref:sacrificed, quantity:players_count, field:sacrifice_permanent.filter, field:sacrifice_permanent.sharesCardTypeWith, field:sacrifice_permanent.who, predicate:step_done, field:life_change.amount, field:life_change.lose, field:life_change.onlyForPlayersWhoDidNot, field:life_change.who, predicate:all, predicate:not]
    Oracle: At the beginning of your end step, you may sacrifice an artifact, creature, enchantment, land, or planeswalker. If you do, each opponent may sacrifice a permanent of their choice that shares a card type with it. For each opponent who doesn't, that player loses 2 life and you draw a card.
    Trigger: At the beginning of your end step
    Effect: You may sacrifice an artifact, creature, enchantment, land, or planeswalker you control. Then, IF you did (s1): you may each opponent sacrifices a permanent. Then, IF you did (s1) and it is not true that you did (s2): each opponent gains 2 life. Then, IF you did (s1): draw the number of opponents for which it is not true that you did (s2) cards.
```

Player prompts:

- Braids, Arisen Nightmare: optional: Do you want to sacrifice an artifact, creature, enchantment, land, or planeswalker you control?
- Braids, Arisen Nightmare: optional: Do you want to each opponent sacrifices a permanent?

Implementation: needed (ref:sacrificed, quantity:players_count, field:sacrifice_permanent.filter, field:sacrifice_permanent.sharesCardTypeWith, field:sacrifice_permanent.who, predicate:step_done, field:life_change.amount, field:life_change.lose, field:life_change.onlyForPlayersWhoDidNot, field:life_change.who, predicate:all, predicate:not)

### Sheoldred, Whispering One

Type: Legendary Creature — Phyrexian Praetor

Oracle text:

> Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)
> At the beginning of your upkeep, return target creature card from your graveyard to the battlefield.
> At the beginning of each opponent's upkeep, that player sacrifices a creature of their choice.

Re-rendered plain English:

```
Sheoldred, Whispering One [draft]
  [a1] keyword [needed: needs keyword:landwalk]
    Oracle: Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)
    Keyword: landwalk Swamp
  [a2] triggered [implemented]
    Oracle: At the beginning of your upkeep, return target creature card from your graveyard to the battlefield.
    Trigger: At the beginning of your upkeep
    Target t1: target creature card in your graveyard  <- prompt: "Choose target creature card in your graveyard."
    Effect: Return target creature card in your graveyard from the graveyard to the battlefield.
  [a3] triggered [needed: needs field:sacrifice_permanent.filter, field:sacrifice_permanent.who]
    Oracle: At the beginning of each opponent's upkeep, that player sacrifices a creature of their choice.
    Trigger: At the beginning of each opponent's upkeep
    Effect: That player sacrifices a creature.
```

Player prompts:

- Sheoldred, Whispering One: choose a target: Choose target creature card in your graveyard.
- Sheoldred, Whispering One: sacrifice: Choose a permanent to sacrifice.

Implementation: needed (keyword:landwalk, field:sacrifice_permanent.filter, field:sacrifice_permanent.who)

### Yawgmoth, Thran Physician

Type: Legendary Creature — Human Cleric

Oracle text:

> Protection from Humans
> Pay 1 life, Sacrifice another creature: Put a -1/-1 counter on up to one target creature and draw a card.
> {B}{B}, Discard a card: Proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)

Re-rendered plain English:

```
Yawgmoth, Thran Physician [draft]
  [a1] keyword [implemented]
    Oracle: Protection from Humans
    Keyword: protection Humans
  [a2] activated [needed: needs cost:life, cost:sacrifice, targets:multi, step:add_counters, field:add_counters.on]
    Oracle: Pay 1 life, Sacrifice another creature: Put a -1/-1 counter on up to one target creature and draw a card.
    Cost: pay 1 life, sacrifice an another creature you control
    Target t1: up to one target creature  <- prompt: "Choose up to one target creature."
    Effect: Put a -1/-1 counter on up to one target creature. Then, draw a card.
  [a3] activated [needed: needs cost:discard, step:proliferate]
    Oracle: {B}{B}, Discard a card: Proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)
    Cost: {B}{B}, discard a card in your hand
    Effect: Proliferate.
```

Player prompts:

- Yawgmoth, Thran Physician: choose a target: Choose up to one target creature.
- Yawgmoth, Thran Physician: choose what to sacrifice: Choose 1 another creature you control to sacrifice.
- Yawgmoth, Thran Physician: choose what to discard: Choose 1 card in your hand to discard.

Implementation: needed (cost:life, cost:sacrifice, targets:multi, step:add_counters, field:add_counters.on, cost:discard, step:proliferate)

### Kokusho, the Evening Star

Type: Legendary Creature — Dragon Spirit

Oracle text:

> Flying
> When Kokusho dies, each opponent loses 5 life. You gain life equal to the life lost this way.

Re-rendered plain English:

```
Kokusho, the Evening Star [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs field:life_change.amount, field:life_change.lose, field:life_change.who, quantity:life_lost_this_way]
    Oracle: When Kokusho dies, each opponent loses 5 life. You gain life equal to the life lost this way.
    Trigger: Whenever Kokusho, the Evening Star dies
    Effect: Each opponent gains 5 life. Then, gain the life lost this way life.
```

Player prompts:

- (none: no decisions)

Implementation: needed (field:life_change.amount, field:life_change.lose, field:life_change.who, quantity:life_lost_this_way)

### Junji, the Midnight Sky

Type: Legendary Creature — Dragon Spirit

Oracle text:

> Flying, menace
> When Junji dies, choose one —
> • Each opponent discards two cards and loses 2 life.
> • Put target non-Dragon creature card from a graveyard onto the battlefield under your control. You lose 2 life.

Re-rendered plain English:

```
Junji, the Midnight Sky [draft]
  [a1] keyword [implemented]
    Oracle: Flying, menace
    Keyword: flying
  [a2] triggered [needed: needs modes, filter:notSubtypes, field:discard.who, field:life_change.amount, field:life_change.lose, field:life_change.who]
    Oracle: When Junji dies, choose one — / • Each opponent discards two cards and loses 2 life. / • Put target non-Dragon creature card from a graveyard onto the battlefield under your control. You lose 2 life.
    Trigger: Whenever Junji, the Midnight Sky dies
    Modes: choose 1  <- prompt: "Choose one mode."
      - Each opponent discard 2 cards. Then, each opponent gains 2 life.
      - Return target non-Dragon creature card in a graveyard from the graveyard to the battlefield. Then, gain 2 life. (target: target non-Dragon creature card in a graveyard)
```

Player prompts:

- Junji, the Midnight Sky: choose a mode: Choose one mode.
- Junji, the Midnight Sky: choose a target: Choose target non-Dragon creature card in a graveyard.
- Junji, the Midnight Sky: discard: Choose 2 cards to discard.

Implementation: needed (modes, filter:notSubtypes, field:discard.who, field:life_change.amount, field:life_change.lose, field:life_change.who)

### Dictate of Erebos

Type: Enchantment

Oracle text:

> Flash
> Whenever a creature you control dies, each opponent sacrifices a creature of their choice.

Re-rendered plain English:

```
Dictate of Erebos [draft]
  [a1] keyword [implemented]
    Oracle: Flash
    Keyword: flash
  [a2] triggered [needed: needs trigger:subject, field:sacrifice_permanent.filter, field:sacrifice_permanent.who]
    Oracle: Whenever a creature you control dies, each opponent sacrifices a creature of their choice.
    Trigger: Whenever a creature you control dies
    Effect: Each opponent sacrifices a creature.
```

Player prompts:

- Dictate of Erebos: sacrifice: Choose a permanent to sacrifice.

Implementation: needed (trigger:subject, field:sacrifice_permanent.filter, field:sacrifice_permanent.who)

### Sidisi, Undead Vizier

Type: Legendary Creature — Zombie Snake

Oracle text:

> Deathtouch
> Exploit (When this creature enters, you may sacrifice a creature.)
> When Sidisi exploits a creature, you may search your library for a card, put it into your hand, then shuffle.

Re-rendered plain English:

```
Sidisi, Undead Vizier [draft]
  [a1] keyword [implemented]
    Oracle: Deathtouch
    Keyword: deathtouch
  [a2] triggered [needed: needs keyword:exploit, step:exploit]
    Oracle: Exploit (When this creature enters, you may sacrifice a creature.)
    Trigger: Whenever Sidisi, Undead Vizier enters
    Effect: You may you may sacrifice a creature (exploit).
    Keyword: exploit
    (optional: Do you want to you may sacrifice a creature (exploit)?)
  [a3] triggered [needed: needs trigger:exploit, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.to]
    Oracle: When Sidisi exploits a creature, you may search your library for a card, put it into your hand, then shuffle.
    Trigger: Whenever Sidisi, Undead Vizier exploits a creature
    Effect: Search your library for a permanent, put it onto your hand, then shuffle.
    (optional: Do you want to search your library for a permanent, put it onto your hand, then shuffle?)
```

Player prompts:

- Sidisi, Undead Vizier: optional: Do you want to you may sacrifice a creature (exploit)?
- Sidisi, Undead Vizier: optional: Do you want to search your library for a permanent, put it onto your hand, then shuffle?
- Sidisi, Undead Vizier: search: Choose a permanent from the library.

Implementation: needed (keyword:exploit, step:exploit, trigger:exploit, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.to)

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

### Insidious Fungus

Type: Creature — Fungus

Oracle text:

> {2}, Sacrifice this creature: Choose one —
> • Destroy target artifact.
> • Destroy target enchantment.
> • Draw a card. Then you may put a land card from your hand onto the battlefield tapped.

Re-rendered plain English:

```
Insidious Fungus [draft]
  [a1] activated [needed: needs modes, cost:sacrifice, field:move_card_zone.filter, field:move_card_zone.from, field:move_card_zone.tapped, field:move_card_zone.what]
    Oracle: {2}, Sacrifice this creature: Choose one — / • Destroy target artifact. / • Destroy target enchantment. / • Draw a card. Then you may put a land card from your hand onto the battlefield tapped.
    Cost: {2}, sacrifice Insidious Fungus
    Modes: choose 1  <- prompt: "Choose one mode."
      - Destroy target artifact. (target: target artifact)
      - Destroy target enchantment. (target: target enchantment)
      - Draw a card. Then, you may put a card onto the battlefield.
```

Player prompts:

- Insidious Fungus: choose a mode: Choose one mode.
- Insidious Fungus: choose a target: Choose target artifact.
- Insidious Fungus: choose a target: Choose target enchantment.
- Insidious Fungus: optional: Do you want to put a card onto the battlefield?

Implementation: needed (modes, cost:sacrifice, field:move_card_zone.filter, field:move_card_zone.from, field:move_card_zone.tapped, field:move_card_zone.what)

### Dauthi Voidwalker

Type: Creature — Dauthi Rogue

Oracle text:

> Shadow (This creature can block or be blocked by only creatures with shadow.)
> If a card would be put into an opponent's graveyard from anywhere, instead exile it with a void counter on it.
> {T}, Sacrifice this creature: Choose an exiled card an opponent owns with a void counter on it. You may play it this turn without paying its mana cost.

Re-rendered plain English:

```
Dauthi Voidwalker [draft]
  [a1] keyword [implemented]
    Oracle: Shadow (This creature can block or be blocked by only creatures with shadow.)
    Keyword: shadow
  [a2] replacement [needed: needs replacement:would_be_put_into_zone, step:add_counters, field:add_counters.on]
    Oracle: If a card would be put into an opponent's graveyard from anywhere, instead exile it with a void counter on it.
    Replacement: If a card an opponent owns would be put into zone, instead: exile that object, then put a void counter on that object
  [a3] activated [needed: needs cost:sacrifice, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, step:permission_to_play, field:permission_to_play.what, field:permission_to_play.withoutPaying]
    Oracle: {T}, Sacrifice this creature: Choose an exiled card an opponent owns with a void counter on it. You may play it this turn without paying its mana cost.
    Cost: {T}, sacrifice Dauthi Voidwalker
    Effect: Choose a card with a void counter on it an opponent owns in exile. Then, you may you may play chosen without paying its mana cost until end of turn.
```

Player prompts:

- Dauthi Voidwalker: choose: Choose a card with a void counter on it an opponent owns in exile.
- Dauthi Voidwalker: optional: Do you want to you may play chosen without paying its mana cost until end of turn?

Implementation: needed (replacement:would_be_put_into_zone, step:add_counters, field:add_counters.on, cost:sacrifice, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, step:permission_to_play, field:permission_to_play.what, field:permission_to_play.withoutPaying)

### Diabolic Intent

Type: Sorcery

Oracle text:

> As an additional cost to cast this spell, sacrifice a creature.
> Search your library for a card, put that card into your hand, then shuffle.

Re-rendered plain English:

```
Diabolic Intent [draft]
  [a1] cast_option [needed: needs cast_option, cost:sacrifice]
    Oracle: As an additional cost to cast this spell, sacrifice a creature.
    Cost: sacrifice a creature you control
  [a2] spell_effect [needed: needs step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.to]
    Oracle: Search your library for a card, put that card into your hand, then shuffle.
    Effect: Search your library for a permanent, put it onto your hand, then shuffle.
```

Player prompts:

- Diabolic Intent: choose what to sacrifice: Choose 1 creature you control to sacrifice.
- Diabolic Intent: search: Choose a permanent from the library.

Implementation: needed (cast_option, cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.to)

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

### Takenuma, Abandoned Mire

Type: Legendary Land

Oracle text:

> {T}: Add {B}.
> Channel — {3}{B}, Discard this card: Mill three cards, then return a creature or planeswalker card from your graveyard to your hand. This ability costs {1} less to activate for each legendary creature you control.

Re-rendered plain English:

```
Takenuma, Abandoned Mire [draft]
  [a1] mana [implemented]
    Oracle: {T}: Add {B}.
    Cost: {T}
    Mana: add {B}
  [a2] activated (from hand) [needed: needs zone:hand, cost_reduction, cost:discard, field:move_card_zone.filter, field:move_card_zone.from, field:move_card_zone.what]
    Oracle: Channel — {3}{B}, Discard this card: Mill three cards, then return a creature or planeswalker card from your graveyard to your hand. This ability costs {1} less to activate for each legendary creature you control.
    Cost: {3}{B}, discard Takenuma, Abandoned Mire
    Effect: Mill 3 cards. Then, put a card into your hand.
    Cost reduction: this ability costs {1} less for each legendary creature you control
    Keyword: channel
```

Player prompts:

- (none: no decisions)

Implementation: needed (zone:hand, cost_reduction, cost:discard, field:move_card_zone.filter, field:move_card_zone.from, field:move_card_zone.what)

### Agadeem's Awakening // Agadeem, the Undercrypt

Type: Sorcery // Land

Oracle text:

> Agadeem's Awakening: Return from your graveyard to the battlefield any number of target creature cards that each have a different mana value X or less.
> 
> Agadeem, the Undercrypt: As this land enters, you may pay 3 life. If you don't, it enters tapped.
> {T}: Add {B}.

Re-rendered plain English:

```
Agadeem's Awakening // Agadeem, the Undercrypt [draft]
  [a1] spell_effect [needed: needs targets:multi, field:reanimate.differentManaValues]
    Oracle: Agadeem's Awakening: Return from your graveyard to the battlefield any number of target creature cards that each have a different mana value X or less.
    Target t1: up to 99 target creature cards with mana value less than or equal to X in your graveyard  <- prompt: "Choose up to 99 target creature cards with mana value less than or equal to X in your graveyard."
    Effect: Return up to 99 target creature cards with mana value less than or equal to X in your graveyard from the graveyard to the battlefield.
  [a2] replacement [needed: needs replacement:would_enter]
    Oracle: Agadeem, the Undercrypt: As this land enters, you may pay 3 life. If you don't, it enters tapped.
    Replacement: If Agadeem's Awakening // Agadeem, the Undercrypt would enter, modify it: {"tapped":true,"unlessPay":{"life":3}}
    (optional: Do you want to use this ability?)
  [a3] mana [implemented]
    Oracle: {T}: Add {B}.
    Cost: {T}
    Mana: add {B}
```

Player prompts:

- Agadeem's Awakening // Agadeem, the Undercrypt: choose targets: Choose up to 99 target creature cards with mana value less than or equal to X in your graveyard.
- Agadeem's Awakening // Agadeem, the Undercrypt: optional: Do you want to use this ability?
- Agadeem's Awakening // Agadeem, the Undercrypt: optional: Do you want to apply this replacement?

Implementation: needed (targets:multi, field:reanimate.differentManaValues, replacement:would_enter)

### Disciple of Freyalise // Garden of Freyalise

Type: Creature — Elf Druid // Land

Oracle text:

> Disciple of Freyalise: When this creature enters, you may sacrifice another creature. If you do, you gain X life and draw X cards, where X is that creature's power.
> 
> Garden of Freyalise: As this land enters, you may pay 3 life. If you don't, it enters tapped.
> {T}: Add {G}.

Re-rendered plain English:

```
Disciple of Freyalise // Garden of Freyalise [draft]
  [a1] triggered [needed: needs ref:sacrificed, field:sacrifice_permanent.filter, quantity:stat, field:life_change.amount, predicate:step_done]
    Oracle: Disciple of Freyalise: When this creature enters, you may sacrifice another creature. If you do, you gain X life and draw X cards, where X is that creature's power.
    Trigger: Whenever Disciple of Freyalise // Garden of Freyalise enters
    Effect: You may sacrifice an another creature you control. Then, IF you did (s1): gain the sacrificed permanent's power life. Then, IF you did (s1): draw the sacrificed permanent's power cards.
  [a2] replacement [needed: needs replacement:would_enter]
    Oracle: Garden of Freyalise: As this land enters, you may pay 3 life. If you don't, it enters tapped.
    Replacement: If Disciple of Freyalise // Garden of Freyalise would enter, modify it: {"tapped":true,"unlessPay":{"life":3}}
    (optional: Do you want to use this ability?)
  [a3] mana [implemented]
    Oracle: {T}: Add {G}.
    Cost: {T}
    Mana: add {G}
```

Player prompts:

- Disciple of Freyalise // Garden of Freyalise: optional: Do you want to sacrifice an another creature you control?
- Disciple of Freyalise // Garden of Freyalise: optional: Do you want to use this ability?
- Disciple of Freyalise // Garden of Freyalise: optional: Do you want to apply this replacement?

Implementation: needed (ref:sacrificed, field:sacrifice_permanent.filter, quantity:stat, field:life_change.amount, predicate:step_done, replacement:would_enter)

### Spymaster's Vault

Type: Land

Oracle text:

> This land enters tapped unless you control a Swamp.
> {T}: Add {B}.
> {B}, {T}: Target creature you control connives X, where X is the number of creatures that died this turn. (Draw X cards, then discard X cards. Put a +1/+1 counter on that creature for each nonland card discarded this way.)

Re-rendered plain English:

```
Spymaster's Vault [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped unless you control a Swamp.
    Replacement: If Spymaster's Vault would enter (only if it is not true that you control a Swamp), it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {B}.
    Cost: {T}
    Mana: add {B}
  [a3] activated [needed: needs quantity:count_this_turn, step:connive, field:connive.on]
    Oracle: {B}, {T}: Target creature you control connives X, where X is the number of creatures that died this turn. (Draw X cards, then discard X cards. Put a +1/+1 counter on that creature for each nonland card discarded this way.)
    Cost: {B}, {T}
    Target t1: target creature you control  <- prompt: "Choose target creature you control."
    Effect: T1 connives (draw, discard, +1/+1 counter if the discarded card is nonland).
```

Player prompts:

- Spymaster's Vault: choose a target: Choose target creature you control.
- Spymaster's Vault: connive: Choose a card to discard after drawing (connive).

Implementation: needed (replacement:would_enter, quantity:count_this_turn, step:connive, field:connive.on)

### Shifting Woodland

Type: Land

Oracle text:

> This land enters tapped unless you control a Forest.
> {T}: Add {G}.
> Delirium — {2}{G}{G}: This land becomes a copy of target permanent card in your graveyard until end of turn. Activate only if there are four or more card types among cards in your graveyard.

Re-rendered plain English:

```
Shifting Woodland [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped unless you control a Forest.
    Replacement: If Shifting Woodland would enter (only if it is not true that you control a Forest), it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {G}.
    Cost: {T}
    Mana: add {G}
  [a3] activated [needed: needs timing, predicate:stat, step:copy, field:copy.of]
    Oracle: Delirium — {2}{G}{G}: This land becomes a copy of target permanent card in your graveyard until end of turn. Activate only if there are four or more card types among cards in your graveyard.
    Cost: {2}{G}{G}
    Timing: Shifting Woodland's card types in your graveyard is 4 or greater
    Target t1: target permanent card in your graveyard  <- prompt: "Choose target permanent card in your graveyard."
    Effect: Copy Shifting Woodland.
```

Player prompts:

- Shifting Woodland: choose a target: Choose target permanent card in your graveyard.

Implementation: needed (replacement:would_enter, timing, predicate:stat, step:copy, field:copy.of)

### Malakir Rebirth // Malakir Mire

Type: Instant // Land

Oracle text:

> Malakir Rebirth: Choose target creature. You lose 2 life. Until end of turn, that creature gains "When this creature dies, return it to the battlefield tapped under its owner's control."
> 
> Malakir Mire: This land enters tapped.
> {T}: Add {B}.

Re-rendered plain English:

```
Malakir Rebirth // Malakir Mire [draft]
  [a1] spell_effect [needed: needs field:life_change.amount, field:life_change.lose, step:grant_effect, field:grant_effect.modify]
    Oracle: Malakir Rebirth: Choose target creature. You lose 2 life. Until end of turn, that creature gains "When this creature dies, return it to the battlefield tapped under its owner's control."
    Target t1: target creature  <- prompt: "Choose target creature."
    Effect: Gain 2 life. Then, target creature gains an ability until end of turn.
  [a2] replacement [needed: needs replacement:would_enter]
    Oracle: Malakir Mire: This land enters tapped.
    Replacement: If Malakir Rebirth // Malakir Mire would enter, it enters tapped
  [a3] mana [implemented]
    Oracle: {T}: Add {B}.
    Cost: {T}
    Mana: add {B}
```

Player prompts:

- Malakir Rebirth // Malakir Mire: choose a target: Choose target creature.

Implementation: needed (field:life_change.amount, field:life_change.lose, step:grant_effect, field:grant_effect.modify, replacement:would_enter)

### Susur Secundi, Void Altar

Type: Land — Planet

Oracle text:

> This land enters tapped.
> {T}: Add {B}.
> Station (Tap another creature you control: Put charge counters equal to its power on this Planet. Station only as a sorcery.)
> 12+ | {1}{B}, {T}, Pay 2 life, Sacrifice a creature: Draw cards equal to the sacrificed creature's power. Activate only as a sorcery.

Re-rendered plain English:

```
Susur Secundi, Void Altar [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped.
    Replacement: If Susur Secundi, Void Altar would enter, it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {B}.
    Cost: {T}
    Mana: add {B}
  [a3] keyword [needed: needs scripted:station]
    Oracle: Station (Tap another creature you control: Put charge counters equal to its power on this Planet. Station only as a sorcery.)
    Scripted (engine-specific rule, not described by the fields above): station
    Keyword: station
  [a4] activated [needed: needs ref:sacrificed, timing, predicate:compare, cost:life, cost:sacrifice, quantity:stat]
    Oracle: 12+ | {1}{B}, {T}, Pay 2 life, Sacrifice a creature: Draw cards equal to the sacrificed creature's power. Activate only as a sorcery.
    Cost: {1}{B}, {T}, pay 2 life, sacrifice a creature you control
    Timing: sorcery; the number of charge counters on self is 12 or greater
    Effect: Draw the sacrificed permanent's power cards.
```

Player prompts:

- Susur Secundi, Void Altar: choose what to sacrifice: Choose 1 creature you control to sacrifice.

Implementation: needed (replacement:would_enter, scripted:station, ref:sacrificed, timing, predicate:compare, cost:life, cost:sacrifice, quantity:stat)

### Hissing Quagmire

Type: Land

Oracle text:

> This land enters tapped.
> {T}: Add {B} or {G}.
> {1}{B}{G}: Until end of turn, this land becomes a 2/2 black and green Elemental creature with deathtouch. It's still a land.

Re-rendered plain English:

```
Hissing Quagmire [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped.
    Replacement: If Hissing Quagmire would enter, it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {B} or {G}.
    Cost: {T}
    Mana: add {B}
  [a3] mana [implemented]
    Oracle: {T}: Add {B} or {G}.
    Cost: {T}
    Mana: add {G}
  [a4] activated [needed: needs step:grant_effect, field:grant_effect.modify]
    Oracle: {1}{B}{G}: Until end of turn, this land becomes a 2/2 black and green Elemental creature with deathtouch. It's still a land.
    Cost: {1}{B}{G}
    Effect: Hissing Quagmire becomes a creature elemental in addition to its other types and has base power and toughness 2/2 and is black and green and gains deathtouch until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter, step:grant_effect, field:grant_effect.modify)

### Midgar, City of Mako // Reactor Raid

Type: Land — Town // Sorcery — Adventure

Oracle text:

> Midgar, City of Mako: This land enters tapped.
> {T}: Add {B}.
> 
> Reactor Raid: You may sacrifice an artifact or creature. If you do, draw two cards. (Then exile this card. You may play the land later from exile.)

Re-rendered plain English:

```
Midgar, City of Mako // Reactor Raid [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: Midgar, City of Mako: This land enters tapped.
    Replacement: If Midgar, City of Mako // Reactor Raid would enter, it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {B}.
    Cost: {T}
    Mana: add {B}
  [a3] spell_effect [needed: needs field:sacrifice_permanent.filter, predicate:step_done]
    Oracle: Reactor Raid: You may sacrifice an artifact or creature. If you do, draw two cards. (Then exile this card. You may play the land later from exile.)
    Effect: You may sacrifice an artifact or creature you control. Then, IF you did (s1): draw 2 cards.
```

Player prompts:

- Midgar, City of Mako // Reactor Raid: optional: Do you want to sacrifice an artifact or creature you control?

Implementation: needed (replacement:would_enter, field:sacrifice_permanent.filter, predicate:step_done)

### Fell the Profane // Fell Mire

Type: Instant // Land

Oracle text:

> Fell the Profane: Destroy target creature or planeswalker.
> 
> Fell Mire: As this land enters, you may pay 3 life. If you don't, it enters tapped.
> {T}: Add {B}.

Re-rendered plain English:

```
Fell the Profane // Fell Mire [draft]
  [a1] spell_effect [implemented]
    Oracle: Fell the Profane: Destroy target creature or planeswalker.
    Target t1: target creature or planeswalker  <- prompt: "Choose target creature or planeswalker."
    Effect: Destroy target creature or planeswalker.
  [a2] replacement [needed: needs replacement:would_enter]
    Oracle: Fell Mire: As this land enters, you may pay 3 life. If you don't, it enters tapped.
    Replacement: If Fell the Profane // Fell Mire would enter, modify it: {"tapped":true,"unlessPay":{"life":3}}
    (optional: Do you want to use this ability?)
  [a3] mana [implemented]
    Oracle: {T}: Add {B}.
    Cost: {T}
    Mana: add {B}
```

Player prompts:

- Fell the Profane // Fell Mire: choose a target: Choose target creature or planeswalker.
- Fell the Profane // Fell Mire: optional: Do you want to use this ability?
- Fell the Profane // Fell Mire: optional: Do you want to apply this replacement?

Implementation: needed (replacement:would_enter)

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

### Revitalizing Repast // Old-Growth Grove

Type: Instant // Land

Oracle text:

> Revitalizing Repast: Put a +1/+1 counter on target creature. It gains indestructible until end of turn.
> 
> Old-Growth Grove: This land enters tapped.
> {T}: Add {B} or {G}.

Re-rendered plain English:

```
Revitalizing Repast // Old-Growth Grove [draft]
  [a1] spell_effect [needed: needs step:add_counters, field:add_counters.on, step:grant_effect, field:grant_effect.modify]
    Oracle: Revitalizing Repast: Put a +1/+1 counter on target creature. It gains indestructible until end of turn.
    Target t1: target creature  <- prompt: "Choose target creature."
    Effect: Put a +1/+1 counter on target creature. Then, target creature gains indestructible until end of turn.
  [a2] replacement [needed: needs replacement:would_enter]
    Oracle: Old-Growth Grove: This land enters tapped.
    Replacement: If Revitalizing Repast // Old-Growth Grove would enter, it enters tapped
  [a3] mana [implemented]
    Oracle: {T}: Add {B} or {G}.
    Cost: {T}
    Mana: add {B}
  [a4] mana [implemented]
    Oracle: {T}: Add {B} or {G}.
    Cost: {T}
    Mana: add {G}
```

Player prompts:

- Revitalizing Repast // Old-Growth Grove: choose a target: Choose target creature.

Implementation: needed (step:add_counters, field:add_counters.on, step:grant_effect, field:grant_effect.modify, replacement:would_enter)

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
  [a2] mana [needed: needs mana:variable]
    Oracle: {T}: Add one mana of any color in your commander's color identity.
    Cost: {T}
    Mana: add one mana of any color in your commander's color identity
  [a3] triggered [needed: needs scripted:mana_from_this_land_spent_on_creature_sharing_type_with_commander, step:scry]
    Oracle: When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1. (Look at the top card of your library. You may put that card on the bottom.)
    Trigger: Whenever you cast a creature spell
    Effect: Scry 1.
    Scripted (engine-specific rule, not described by the fields above): mana_from_this_land_spent_on_creature_sharing_type_with_commander
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter, mana:variable, scripted:mana_from_this_land_spent_on_creature_sharing_type_with_commander, step:scry)

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
  [a3] activated [needed: needs scripted:cards_share_a_land_type, cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.min, field:search_library.shuffle, field:search_library.tapped, field:search_library.to, field:search_library.upTo]
    Oracle: {2}, {T}, Sacrifice this land: Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.
    Cost: {2}, {T}, sacrifice Myriad Landscape
    Effect: Search your library for a basic land, put it onto the battlefield, then shuffle.
    Scripted (engine-specific rule, not described by the fields above): cards_share_a_land_type
```

Player prompts:

- Myriad Landscape: search: Choose a basic land from the library.

Implementation: needed (replacement:would_enter, scripted:cards_share_a_land_type, cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.min, field:search_library.shuffle, field:search_library.tapped, field:search_library.to, field:search_library.upTo)

## Kernel to-do: missing capabilities across this deck

| capability | cards | needing it |
|---|---|---|
| `cost:sacrifice` | 29 | Spore Frog; Sakura-Tribe Elder; Viscera Seer; Carrion Feeder; Cankerbloom; High Market; Ashnod's Altar; Haywire Mite; Birthing Pod; Phyrexian Tower; Wight of the Reliquary; Yawgmoth, Thran Physician; Caustic Caterpillar; Altar of Dementia; Fiend Artisan; Insidious Fungus; Dauthi Voidwalker; Diabolic Intent; Village Rites; Warren Soultrader; Phyrexian Altar; Jarad, Golgari Lich Lord; Umbral Collar Zealot; Grim Backwoods; Westvale Abbey // Ormendahl, Profane Prince; Command Beacon; Susur Secundi, Void Altar; Myriad Landscape; Evolving Wilds |
| `replacement:would_enter` | 17 | Crypt of Agadeem; Agadeem's Awakening // Agadeem, the Undercrypt; Disciple of Freyalise // Garden of Freyalise; Spymaster's Vault; Shifting Woodland; Malakir Rebirth // Malakir Mire; Susur Secundi, Void Altar; Hissing Quagmire; Midgar, City of Mako // Reactor Raid; Bojuka Bog; Khalni Garden; Fell the Profane // Fell Mire; Dakmor Salvage; Bala Ged Recovery // Bala Ged Sanctuary; Revitalizing Repast // Old-Growth Grove; Path of Ancestry; Myriad Landscape |
| `field:sacrifice_permanent.filter` | 15 | Plaguecrafter; Victimize; Accursed Marauder; Fleshbag Marauder; Sheoldred // The True Scriptures; Living Death; Butcher of Malakir; Grave Pact; Braids, Arisen Nightmare; Sheoldred, Whispering One; Demon's Disciple; Merciless Executioner; Dictate of Erebos; Disciple of Freyalise // Garden of Freyalise; Midgar, City of Mako // Reactor Raid |
| `field:search_library.count` | 15 | Sakura-Tribe Elder; Buried Alive; Protean Hulk; Entomb; Solemn Simulacrum; Birthing Pod; Wood Elves; Wight of the Reliquary; Fauna Shaman; Sidisi, Undead Vizier; Fiend Artisan; Diabolic Intent; Boseiju, Who Endures; Myriad Landscape; Evolving Wilds |
| `field:search_library.filter` | 15 | Sakura-Tribe Elder; Buried Alive; Protean Hulk; Entomb; Solemn Simulacrum; Birthing Pod; Wood Elves; Wight of the Reliquary; Fauna Shaman; Sidisi, Undead Vizier; Fiend Artisan; Diabolic Intent; Boseiju, Who Endures; Myriad Landscape; Evolving Wilds |
| `field:search_library.shuffle` | 15 | Sakura-Tribe Elder; Buried Alive; Protean Hulk; Entomb; Solemn Simulacrum; Birthing Pod; Wood Elves; Wight of the Reliquary; Fauna Shaman; Sidisi, Undead Vizier; Fiend Artisan; Diabolic Intent; Boseiju, Who Endures; Myriad Landscape; Evolving Wilds |
| `field:search_library.to` | 15 | Sakura-Tribe Elder; Buried Alive; Protean Hulk; Entomb; Solemn Simulacrum; Birthing Pod; Wood Elves; Wight of the Reliquary; Fauna Shaman; Sidisi, Undead Vizier; Fiend Artisan; Diabolic Intent; Boseiju, Who Endures; Myriad Landscape; Evolving Wilds |
| `step:search_library` | 15 | Sakura-Tribe Elder; Buried Alive; Protean Hulk; Entomb; Solemn Simulacrum; Birthing Pod; Wood Elves; Wight of the Reliquary; Fauna Shaman; Sidisi, Undead Vizier; Fiend Artisan; Diabolic Intent; Boseiju, Who Endures; Myriad Landscape; Evolving Wilds |
| `trigger:subject` | 14 | Meren of Clan Nel Toth; Grim Haruspex; Blood Artist; Massacre Wurm; Syr Konrad, the Grim; Mikaeus, the Unhallowed; Zulaport Cutthroat; Butcher of Malakir; Skullclamp; Twilight Diviner; Grave Pact; Midnight Reaper; Dictate of Erebos; Journey to Eternity // Atzal, Cave of Eternity |
| `field:life_change.amount` | 13 | Gray Merchant of Asphodel; High Market; Blood Artist; Massacre Wurm; Haywire Mite; Zulaport Cutthroat; Braids, Arisen Nightmare; Reanimate; Kokusho, the Evening Star; Junji, the Midnight Sky; Jarad, Golgari Lich Lord; Disciple of Freyalise // Garden of Freyalise; Malakir Rebirth // Malakir Mire |
| `field:sacrifice_permanent.who` | 13 | Plaguecrafter; Accursed Marauder; Fleshbag Marauder; Sheoldred // The True Scriptures; Living Death; Butcher of Malakir; Animate Dead; Grave Pact; Braids, Arisen Nightmare; Sheoldred, Whispering One; Demon's Disciple; Merciless Executioner; Dictate of Erebos |
| `field:life_change.lose` | 10 | Gray Merchant of Asphodel; Blood Artist; Massacre Wurm; Zulaport Cutthroat; Braids, Arisen Nightmare; Reanimate; Kokusho, the Evening Star; Junji, the Midnight Sky; Jarad, Golgari Lich Lord; Malakir Rebirth // Malakir Mire |
| `static` | 10 | Carrion Feeder; Mikaeus, the Unhallowed; Skullclamp; Animate Dead; Wight of the Reliquary; Fiend Artisan; Jarad, Golgari Lich Lord; Urborg, Tomb of Yawgmoth; Yavimaya, Cradle of Growth; Reliquary Tower |
| `field:move_card_zone.from` | 9 | Meren of Clan Nel Toth; Eternal Witness; Sheoldred // The True Scriptures; Living Death; Insidious Fungus; Jarad, Golgari Lich Lord; Takenuma, Abandoned Mire; Command Beacon; Bala Ged Recovery // Bala Ged Sanctuary |
| `field:life_change.who` | 8 | Gray Merchant of Asphodel; Blood Artist; Massacre Wurm; Zulaport Cutthroat; Braids, Arisen Nightmare; Kokusho, the Evening Star; Junji, the Midnight Sky; Jarad, Golgari Lich Lord |
| `mana:variable` | 8 | Phyrexian Altar; Journey to Eternity // Atzal, Cave of Eternity; Cabal Coffers; Crypt of Agadeem; Command Tower; Path of Ancestry; Exotic Orchard; Reflecting Pool |
| `field:move_card_zone.what` | 6 | Living Death; Satyr Wayfinder; Insidious Fungus; Grisly Salvage; Takenuma, Abandoned Mire; Bojuka Bog |
| `ref:sacrificed` | 6 | Birthing Pod; Braids, Arisen Nightmare; Altar of Dementia; Jarad, Golgari Lich Lord; Disciple of Freyalise // Garden of Freyalise; Susur Secundi, Void Altar |
| `cost:life` | 5 | Yawgmoth, Thran Physician; Warren Soultrader; Westvale Abbey // Ormendahl, Profane Prince; Susur Secundi, Void Altar; War Room |
| `field:add_counters.on` | 5 | Meren of Clan Nel Toth; Carrion Feeder; Yawgmoth, Thran Physician; Dauthi Voidwalker; Revitalizing Repast // Old-Growth Grove |
| `field:move_card_zone.filter` | 5 | Sheoldred // The True Scriptures; Living Death; Insidious Fungus; Takenuma, Abandoned Mire; Command Beacon |
| `field:search_library.tapped` | 5 | Sakura-Tribe Elder; Solemn Simulacrum; Wight of the Reliquary; Myriad Landscape; Evolving Wilds |
| `predicate:step_done` | 5 | Plaguecrafter; Victimize; Braids, Arisen Nightmare; Disciple of Freyalise // Garden of Freyalise; Midgar, City of Mako // Reactor Raid |
| `quantity:stat` | 5 | Reanimate; Altar of Dementia; Jarad, Golgari Lich Lord; Disciple of Freyalise // Garden of Freyalise; Susur Secundi, Void Altar |
| `step:add_counters` | 5 | Meren of Clan Nel Toth; Carrion Feeder; Yawgmoth, Thran Physician; Dauthi Voidwalker; Revitalizing Repast // Old-Growth Grove |
| `timing` | 5 | Sheoldred // The True Scriptures; Twilight Diviner; Shifting Woodland; Susur Secundi, Void Altar; Temple of the False God |
| `cost:discard` | 4 | Yawgmoth, Thran Physician; Fauna Shaman; Takenuma, Abandoned Mire; Boseiju, Who Endures |
| `field:grant_effect.modify` | 4 | Malakir Rebirth // Malakir Mire; Hissing Quagmire; Revitalizing Repast // Old-Growth Grove; Rogue's Passage |
| `step:grant_effect` | 4 | Malakir Rebirth // Malakir Mire; Hissing Quagmire; Revitalizing Repast // Old-Growth Grove; Rogue's Passage |
| `targets:multi` | 4 | Victimize; Sheoldred // The True Scriptures; Yawgmoth, Thran Physician; Agadeem's Awakening // Agadeem, the Undercrypt |
| `trigger:multi_event` | 4 | Blood Artist; Syr Konrad, the Grim; Zulaport Cutthroat; Butcher of Malakir |
| `field:choose.count` | 3 | Satyr Wayfinder; Dauthi Voidwalker; Grisly Salvage |
| `field:choose.from` | 3 | Satyr Wayfinder; Dauthi Voidwalker; Grisly Salvage |
| `field:choose.saveAs` | 3 | Satyr Wayfinder; Dauthi Voidwalker; Grisly Salvage |
| `field:discard.who` | 3 | Plaguecrafter; Sheoldred // The True Scriptures; Junji, the Midnight Sky |
| `field:mill.who` | 3 | Syr Konrad, the Grim; Sheoldred // The True Scriptures; Altar of Dementia |
| `field:search_library.upTo` | 3 | Buried Alive; Protean Hulk; Myriad Landscape |
| `modes` | 3 | Cankerbloom; Junji, the Midnight Sky; Insidious Fungus |
| `step:choose` | 3 | Satyr Wayfinder; Dauthi Voidwalker; Grisly Salvage |
| `cast_option` | 2 | Diabolic Intent; Village Rites |
| `cost_reduction` | 2 | Takenuma, Abandoned Mire; Boseiju, Who Endures |
| `field:attach.to` | 2 | Skullclamp; Animate Dead |
| `field:attach.what` | 2 | Skullclamp; Animate Dead |
| `field:choose.fromLooked` | 2 | Satyr Wayfinder; Grisly Salvage |
| `field:look_top.reveal` | 2 | Satyr Wayfinder; Grisly Salvage |
| `field:move_card_zone.all` | 2 | Sheoldred // The True Scriptures; Living Death |
| `field:move_card_zone.transformed` | 2 | Sheoldred // The True Scriptures; Journey to Eternity // Atzal, Cave of Eternity |
| `field:move_card_zone.who` | 2 | Sheoldred // The True Scriptures; Living Death |
| `filter:notSubtypes` | 2 | Mikaeus, the Unhallowed; Junji, the Midnight Sky |
| `keyword:enchant` | 2 | Animate Dead; Journey to Eternity // Atzal, Cave of Eternity |
| `predicate:not` | 2 | Plaguecrafter; Braids, Arisen Nightmare |
| `predicate:stat` | 2 | Meren of Clan Nel Toth; Shifting Woodland |
| `quantity:life_lost_this_way` | 2 | Gray Merchant of Asphodel; Kokusho, the Evening Star |
| `static:addTypes` | 2 | Urborg, Tomb of Yawgmoth; Yavimaya, Cradle of Growth |
| `step:attach` | 2 | Skullclamp; Animate Dead |
| `step:copy` | 2 | Twilight Diviner; Shifting Woodland |
| `step:look_top` | 2 | Satyr Wayfinder; Grisly Salvage |
| `step:proliferate` | 2 | Cankerbloom; Yawgmoth, Thran Physician |
| `step:scry` | 2 | Viscera Seer; Path of Ancestry |
| `step:surveil` | 2 | Twilight Diviner; Umbral Collar Zealot |
| `trigger:intervening_if` | 2 | Mikaeus, the Unhallowed; Animate Dead |
| `trigger:zones` | 2 | Syr Konrad, the Grim; Twilight Diviner |
| `zone:hand` | 2 | Takenuma, Abandoned Mire; Boseiju, Who Endures |
| `cast_option:evoke` | 1 | Shriekmaw |
| `cost:x` | 1 | Fiend Artisan |
| `field:connive.on` | 1 | Spymaster's Vault |
| `field:copy.chooseOne` | 1 | Twilight Diviner |
| `field:copy.controller` | 1 | Twilight Diviner |
| `field:copy.of` | 1 | Shifting Woodland |
| `field:copy.token` | 1 | Twilight Diviner |
| `field:copy.what` | 1 | Twilight Diviner |
| `field:create_delayed_trigger.steps` | 1 | Animate Dead |
| `field:create_delayed_trigger.trigger` | 1 | Animate Dead |
| `field:damage_target.source` | 1 | Syr Konrad, the Grim |
| `field:damage_target.who` | 1 | Syr Konrad, the Grim |
| `field:if_else.else` | 1 | Meren of Clan Nel Toth |
| `field:if_else.if` | 1 | Meren of Clan Nel Toth |
| `field:if_else.srcs` | 1 | Meren of Clan Nel Toth |
| `field:if_else.then` | 1 | Meren of Clan Nel Toth |
| `field:life_change.onlyForPlayersWhoDidNot` | 1 | Braids, Arisen Nightmare |
| `field:mass_pump.filter` | 1 | Massacre Wurm |
| `field:move_card_zone.faceUp` | 1 | Sheoldred // The True Scriptures |
| `field:move_card_zone.saveAs` | 1 | Living Death |
| `field:move_card_zone.tapped` | 1 | Insidious Fungus |
| `field:permission_to_play.what` | 1 | Dauthi Voidwalker |
| `field:permission_to_play.withoutPaying` | 1 | Dauthi Voidwalker |
| `field:reanimate.differentManaValues` | 1 | Agadeem's Awakening // Agadeem, the Undercrypt |
| `field:reanimate.tapped` | 1 | Victimize |
| `field:sacrifice_permanent.all` | 1 | Living Death |
| `field:sacrifice_permanent.sharesCardTypeWith` | 1 | Braids, Arisen Nightmare |
| `field:search_library.min` | 1 | Myriad Landscape |
| `field:search_library.reveal` | 1 | Fauna Shaman |
| `field:search_library.totalManaValueAtMost` | 1 | Protean Hulk |
| `field:search_library.who` | 1 | Boseiju, Who Endures |
| `filter:isCommander` | 1 | Command Beacon |
| `keyword:exploit` | 1 | Sidisi, Undead Vizier |
| `keyword:landwalk` | 1 | Sheoldred, Whispering One |
| `predicate:all` | 1 | Braids, Arisen Nightmare |
| `predicate:compare` | 1 | Susur Secundi, Void Altar |
| `predicate:matches` | 1 | Mikaeus, the Unhallowed |
| `predicate:source_state` | 1 | Animate Dead |
| `quantity:count_this_turn` | 1 | Spymaster's Vault |
| `quantity:devotion` | 1 | Gray Merchant of Asphodel |
| `quantity:players_count` | 1 | Braids, Arisen Nightmare |
| `replacement:damage_qualifiers` | 1 | Spore Frog |
| `replacement:duration` | 1 | Spore Frog |
| `replacement:would_be_put_into_zone` | 1 | Dauthi Voidwalker |
| `replacement:would_deal_damage` | 1 | Spore Frog |
| `scripted:cards_share_a_land_type` | 1 | Myriad Landscape |
| `scripted:colors_lands_opponents_control_could_produce` | 1 | Exotic Orchard |
| `scripted:mana_from_this_land_spent_on_creature_sharing_type_with_commander` | 1 | Path of Ancestry |
| `scripted:station` | 1 | Susur Secundi, Void Altar |
| `scripted:types_lands_you_control_could_produce` | 1 | Reflecting Pool |
| `step:connive` | 1 | Spymaster's Vault |
| `step:create_delayed_trigger` | 1 | Animate Dead |
| `step:exploit` | 1 | Sidisi, Undead Vizier |
| `step:if_else` | 1 | Meren of Clan Nel Toth |
| `step:permission_to_play` | 1 | Dauthi Voidwalker |
| `step:rewrite_enchant` | 1 | Animate Dead |
| `step:transform` | 1 | Westvale Abbey // Ormendahl, Profane Prince |
| `targets:per_opponent` | 1 | Sheoldred // The True Scriptures |
| `trigger:batch` | 1 | Twilight Diviner |
| `trigger:chapters` | 1 | Sheoldred // The True Scriptures |
| `trigger:counter_put` | 1 | Sheoldred // The True Scriptures |
| `trigger:dealt_damage` | 1 | Mikaeus, the Unhallowed |
| `trigger:exploit` | 1 | Sidisi, Undead Vizier |
| `trigger:leaves` | 1 | Syr Konrad, the Grim |
| `trigger:unspecified` | 1 | Syr Konrad, the Grim |
| `zone:graveyard` | 1 | Jarad, Golgari Lich Lord |

## Decisions

- SCHEMA QUESTION: double-faced / modal-double-faced cards (Sheoldred // The True Scriptures, Journey to Eternity // Atzal, Westvale Abbey // Ormendahl, and the six spell//land MDFCs) have no face marker; both faces' abilities sit in one abilities[] and each text carries its face-name prefix exactly as in the oracle line. Reminder-only face headers ("Atzal, Cave of Eternity: (Transforms from ...)", "The True Scriptures: (As this Saga enters ...)") are keyword abilities (back_face, saga) just to claim the line. Wanted: ability.face or card.faces[].
- SCHEMA QUESTION: a Saga chapter ability uses trigger.chapters (new field); the lore-counter rules are kernel rules (see changelog).
- SCHEMA QUESTION: 'each player who can't' / 'for each opponent who doesn't' (Plaguecrafter, Braids) are written with step_done on an earlier sacrifice step plus players_count; step_done has no per-player meaning. Braids' 'shares a card type with it' is the step field sharesCardTypeWith:'sacrificed' (no ObjectFilter field for it).
- SCHEMA QUESTION: Syr Konrad's 'creature card is put into a graveyard from anywhere other than the battlefield' is four alsoOn entries (hand, library, exile, stack) because fromZone cannot be negated; event 'unspecified' is used for them.
- SCHEMA QUESTION: Mikaeus 'Whenever a Human deals damage to you' = event dealt_damage, subject you, interveningIf matches(event_object, Human) (event_object = the damage source). No TriggerSpec field for the damage source.
- SCHEMA QUESTION: Twilight Diviner 'if they entered or were cast from a graveyard' is written as trigger.fromZone:'graveyard' only (cast-from-graveyard is not covered). No 'entered_from' / OR with cast_from. The 'if' lexeme is backed by timing.limit by accident.
- SCHEMA QUESTION: no Quantity for 'card types among cards in your graveyard' (Shifting Woodland, delirium): stat predicate card_types_in_your_graveyard >= 4 (boolean-style stat like controller_is_monarch). No target-count 'any number' (Agadeem's Awakening: count max 99, step flag differentManaValues). Protean Hulk 'total mana value 6 or less' is step field totalManaValueAtMost with count 'any'.
- SCHEMA QUESTION: shock lands ('you may pay 3 life, otherwise enters tapped') are a would_enter modify set {tapped:true, unlessPay:{life:3}} with optional:true; the 'set' record is free-form. Hissing Quagmire / Old-Growth Grove 'Add {B} or {G}' follow the two-mana-abilities convention. Station is a scripted marker (like Crew) and its charge threshold is a counters compare predicate.
- Monarch/crew-style scripted markers: only Station (Susur Secundi) was needed. Evoke is a castOptions entry (sacrifice when it enters) for Shriekmaw.
- Identical cards copied from other decks (latest copy): Gray Merchant, Carrion Feeder, Fleshbag Marauder, Midnight Reaper, Umbral Collar Zealot, Skullclamp, Bojuka Bog, Temple of the False God, Boseiju, Yavimaya, Reliquary Tower, Rogue's Passage, Command Tower, Path of Ancestry, Exotic Orchard, Reflecting Pool, Myriad Landscape, War Room, Evolving Wilds.
- BEHAVIOUR QUESTION: Living Death is drafted as 'each player does step 1, then everyone does step 2, then step 3' (three sequential all-player steps), matching the oracle's 'then'. Confirm.
