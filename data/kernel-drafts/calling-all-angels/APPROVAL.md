# Kernel draft approval: Calling All Angels

69 unique cards: 38 simple (A), 31 complex (B). Validator: 69/69 pass. Cards with implementation "needed": 60. All drafts are `review.status: "draft"`; nothing was written to the DB.

Reading guide: each card below shows the oracle text and what the structured JSON says back in plain English. Approve if they match.

## (A) Simple cards: spot-check one line each

- **Always Watching** (Enchantment): Nontoken creatures you control get +1/+1 and have vigilance [needs: static]
- **Angel of Finality** (Creature — Angel): Keyword flying | Whenever Angel of Finality enters: [targets: target player] Exile all cards from that player's graveyard [needs: field:move_card_zone.all, field:move_card_zone.from, field:move_card_zone.who]
- **Angelic Destiny** (Enchantment — Aura): [targets: target creature] | The enchanted creature gets +4/+4 and has flying and has first strike and is also an angel | Whenever the enchanted creature dies: Put Angelic Destiny into your hand [needs: keyword:enchant, static, static:addTypes, trigger:subject, field:move_card_zone.from]
- **Bishop of Wings** (Creature — Human Cleric): Whenever an Angel you control enters: Gain 4 life | Whenever an Angel you control dies: Create a 1/1 white Spirit creature token with flying [needs: trigger:subject, field:create_tokens.tokenKeywords]
- **Commander's Sphere** (Artifact): {T}: add one mana of any color in your commander's color identity | sacrifice Commander's Sphere: Draw a card [needs: mana:variable, cost:sacrifice]
- **Day of Judgment** (Sorcery): Destroy each creature [implemented]
- **Dazzling Angel** (Creature — Angel): Keyword flying | Whenever an another creature you control enters: Gain 1 life [needs: trigger:subject]
- **Exorcise** (Sorcery): [targets: target artifact, enchantment, or creature with power 4 or greater] Exile target artifact, enchantment, or creature with power 4 or greater [implemented]
- **Fateful Absence** (Instant): [targets: target creature or planeswalker] Destroy target creature or planeswalker, then investigate [needs: step:investigate]
- **Herald of Eternal Dawn** (Creature — Angel): Keyword flash | Keyword flying | You can't lose the game | Each opponent can't win the game [needs: static]
- **Herald of War** (Creature — Angel): Keyword flying | Whenever Herald of War attacks: Put a +1/+1 counter on Herald of War | Angel spells or Human spells you cast cost {X}, where X is the number of +1/+1 counters on self, less to cast [needs: step:add_counters, field:add_counters.on, static, static:costMod_quantity]
- **Inspiring Overseer** (Creature — Angel Cleric): Keyword flying | Whenever Inspiring Overseer enters: Gain 1 life, then draw a card [implemented]
- **Invoke the Divine** (Instant): [targets: target artifact or enchantment] Destroy target artifact or enchantment, then gain 4 life [implemented]
- **Lyra Dawnbringer** (Legendary Creature — Angel): Keyword flying | Keyword first strike | Keyword lifelink | Other Angels you control get +1/+1 and have lifelink [needs: static]
- **Marble Diamond** (Artifact): If Marble Diamond would enter, it enters tapped | {T}: add {W} [needs: replacement:would_enter]
- **Merchant of Truth** (Creature — Angel Detective): Keyword flying | Whenever a nontoken creature you control dies: Investigate | Clues you control have exalted [needs: trigger:subject, step:investigate, static]
- **Metropolis Reformer** (Creature — Angel Cleric): Keyword flying | Keyword vigilance | You have hexproof | Whenever Metropolis Reformer is dealt damage: Gain that many life [needs: static, trigger:dealt_damage, quantity:event_amount, field:life_change.amount]
- **Norn's Choirmaster** (Creature — Phyrexian Angel): Keyword flying | Keyword first strike | Whenever a commander permanent you control enters or attacks: Proliferate [needs: filter:isCommander, trigger:subject, trigger:multi_event, step:proliferate]
- **Plains** (Basic Land — Plains): {T}: add {W} [implemented]
- **Radiant Fountain** (Land): Whenever Radiant Fountain enters: Gain 2 life | {T}: add {C} [implemented]
- **Reya Dawnbringer** (Legendary Creature — Angel): Keyword flying | At the beginning of your upkeep: [targets: target creature card in your graveyard] You may return target creature card in your graveyard from the graveyard to the battlefield [implemented]
- **Search the Premises** (Enchantment): Whenever a creature an opponent controls attacks you or a planeswalker you control: Investigate [needs: trigger:subject, trigger:defender, step:investigate]
- **Secret Rendezvous** (Sorcery): [targets: target player] Draw 3 cards [needs: field:draw_cards.alsoWho]
- **Segovian Angel** (Creature — Angel): Keyword flying | Keyword vigilance [implemented]
- **Seraph Sanctuary** (Land): Whenever Seraph Sanctuary enters: Gain 1 life | Whenever an Angel you control enters: Gain 1 life | {T}: add {C} [needs: trigger:subject]
- **Serra Avenger** (Creature — Angel): Serra Avenger can't cast spells as long as it is one of your first three turns of the game | Keyword flying | Keyword vigilance [needs: static, zone:hand]
- **Starnheim Aspirant** (Creature — Human Cleric): Angel spells you cast cost {2} less to cast [needs: static]
- **Sunblast Angel** (Creature — Angel): Keyword flying | Whenever Sunblast Angel enters: Destroy each tapped creature [needs: field:destroy_all.filter]
- **Swiftfoot Boots** (Artifact — Equipment): The equipped creature has hexproof and has haste | {1}: [targets: target creature you control] Attach Swiftfoot Boots to target creature you control [needs: static, step:attach, field:attach.to, field:attach.what]
- **Swords to Plowshares** (Instant): [targets: target creature] Exile target creature, then its controller gains t1's power life [needs: quantity:stat, field:life_change.amount, field:life_change.who]
- **Thraben Watcher** (Creature — Angel): Keyword flying | Keyword vigilance | Nontoken other creatures you control get +1/+1 and have vigilance [needs: static]
- **Tome of Legends** (Artifact — Book): If Tome of Legends would enter, modify it: {"counters":{"page":1}} | Whenever a commander permanent you control enters or attacks: Put a page counter on Tome of Legends | {1}, {T}, remove a page counter from Tome of Legends: Draw a card [needs: replacement:would_enter, filter:isCommander, trigger:subject, trigger:multi_event, step:add_counters, field:add_counters.on, cost:counters]
- **Vanguard Seraph** (Creature — Angel Warrior): Keyword flying | Whenever you gain life for the first time each turn: Surveil 1 [needs: trigger:gain_life, trigger:nth, step:surveil]
- **Youthful Valkyrie** (Creature — Angel): Keyword flying | Whenever an another Angel you control enters: Put a +1/+1 counter on Youthful Valkyrie [needs: trigger:subject, step:add_counters, field:add_counters.on]
- **Arcane Signet** (Artifact): {T}: add one mana of any color in your commander's color identity [needs: mana:variable]
- **Mind Stone** (Artifact): {T}: add {C} | {1}, {T}, sacrifice Mind Stone: Draw a card [needs: cost:sacrifice]
- **Sol Ring** (Artifact): {T}: add {C}{C} [implemented]
- **War Room** (Land): {T}: add {C} | {3}, {T}, pay life equal to the number of colors in your commanders' color identity: Draw a card [needs: cost:life]

## (B) Complex cards

### Angel of Vitality

Type: Creature — Angel

Oracle text:

> Flying
> If you would gain life, you gain that much life plus 1 instead.
> This creature gets +2/+2 as long as you have 25 or more life.

Re-rendered plain English:

```
Angel of Vitality [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] replacement [needed: needs replacement:would_gain_life, quantity:math, field:life_change.amount]
    Oracle: If you would gain life, you gain that much life plus 1 instead.
    Replacement: If you would gain life, instead: gain that many + 1 life
  [a3] static [needed: needs static]
    Oracle: This creature gets +2/+2 as long as you have 25 or more life.
    Static: Angel of Vitality gets +2/+2 as long as your life total is 25 or greater
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_gain_life, quantity:math, field:life_change.amount, static)

### Angel of the Ruins

Type: Artifact Creature — Angel

Oracle text:

> Flying
> When this creature enters, exile up to two target artifacts and/or enchantments.
> Plainscycling {2} ({2}, Discard this card: Search your library for a Plains card, reveal it, put it into your hand, then shuffle.)

Re-rendered plain English:

```
Angel of the Ruins [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs targets:multi]
    Oracle: When this creature enters, exile up to two target artifacts and/or enchantments.
    Trigger: Whenever Angel of the Ruins enters
    Target t1: up to two target artifacts or enchantments  <- prompt: "Choose up to two target artifacts or enchantments."
    Effect: Exile up to two target artifacts or enchantments.
  [a3] activated (from hand) [needed: needs zone:hand, cost:discard, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.reveal, field:search_library.shuffle, field:search_library.to]
    Oracle: Plainscycling {2} ({2}, Discard this card: Search your library for a Plains card, reveal it, put it into your hand, then shuffle.)
    Cost: {2}, discard Angel of the Ruins
    Effect: Search your library for a Plains, put it onto your hand, then shuffle.
    Keyword: plainscycling 2
```

Player prompts:

- Angel of the Ruins: choose targets: Choose up to two target artifacts or enchantments.
- Angel of the Ruins: search: Choose a Plains from the library.

Implementation: needed (targets:multi, zone:hand, cost:discard, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.reveal, field:search_library.shuffle, field:search_library.to)

### Angelic Field Marshal

Type: Creature — Angel

Oracle text:

> Flying
> Lieutenant — As long as you control your commander, this creature gets +2/+2 and creatures you control have vigilance.

Re-rendered plain English:

```
Angelic Field Marshal [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] static [needed: needs static, filter:isCommander]
    Oracle: Lieutenant — As long as you control your commander, this creature gets +2/+2 and creatures you control have vigilance.
    Static: Angelic Field Marshal gets +2/+2 as long as you control a commander permanent
  [a3] static [needed: needs static, filter:isCommander]
    Oracle: Lieutenant — As long as you control your commander, this creature gets +2/+2 and creatures you control have vigilance.
    Static: Creatures you control have vigilance as long as you control a commander permanent
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, filter:isCommander)

### Angelic Sleuth

Type: Creature — Angel Advisor

Oracle text:

> Flying
> Whenever another permanent you control leaves the battlefield, if it had counters on it, investigate. (Create a Clue artifact token with "{2}, Sacrifice this token: Draw a card.")

Re-rendered plain English:

```
Angelic Sleuth [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:leaves, trigger:intervening_if, predicate:matches, trigger:subject, step:investigate]
    Oracle: Whenever another permanent you control leaves the battlefield, if it had counters on it, investigate. (Create a Clue artifact token with "{2}, Sacrifice this token: Draw a card.")
    Trigger: Whenever an another permanent you control leaves the battlefield, if that object is a permanent with a counter on it
    Effect: Investigate.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:leaves, trigger:intervening_if, predicate:matches, trigger:subject, step:investigate)

### Archangel of Tithes

Type: Creature — Angel

Oracle text:

> Flying
> As long as this creature is untapped, creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.
> As long as this creature is attacking, creatures can't block unless their controller pays {1} for each of those creatures.

Re-rendered plain English:

```
Archangel of Tithes [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] static [needed: needs static, static:attackTax]
    Oracle: As long as this creature is untapped, creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.
    Static: Creatures can't attack you or planeswalkers you control unless their controller pays {1} for each creature they control that's attacking a protected player or planeswalker unless Archangel of Tithes is tapped
  [a3] static [needed: needs static, static:blockTax]
    Oracle: As long as this creature is attacking, creatures can't block unless their controller pays {1} for each of those creatures.
    Static: Creatures can't block unless their controller pays {1} for each creature they control that's blocking as long as Archangel of Tithes is attacking
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, static:attackTax, static:blockTax)

### Austere Command

Type: Sorcery

Oracle text:

> Choose two —
> • Destroy all artifacts.
> • Destroy all enchantments.
> • Destroy all creatures with mana value 3 or less.
> • Destroy all creatures with mana value 4 or greater.

Re-rendered plain English:

```
Austere Command [draft]
  [a1] spell_effect [needed: needs modes, modes:multiple, field:destroy_all.filter]
    Oracle: Choose two — / • Destroy all artifacts. / • Destroy all enchantments. / • Destroy all creatures with mana value 3 or less. / • Destroy all creatures with mana value 4 or greater.
    Modes: choose 2  <- prompt: "Choose two modes (each different)."
      - Destroy each artifact.
      - Destroy each enchantment.
      - Destroy each creature with mana value 3 or less.
      - Destroy each creature with mana value 4 or greater.
```

Player prompts:

- Austere Command: choose modes: Choose two modes (each different).

Implementation: needed (modes, modes:multiple, field:destroy_all.filter)

### Bonders' Enclave

Type: Land

Oracle text:

> {T}: Add {C}.
> {3}, {T}: Draw a card. Activate only if you control a creature with power 4 or greater.

Re-rendered plain English:

```
Bonders' Enclave [draft]
  [a1] mana [implemented]
    Oracle: {T}: Add {C}.
    Cost: {T}
    Mana: add {C}
  [a2] activated [needed: needs timing]
    Oracle: {3}, {T}: Draw a card. Activate only if you control a creature with power 4 or greater.
    Cost: {3}, {T}
    Timing: you control a creature with power 4 or greater
    Effect: Draw a card.
```

Player prompts:

- (none: no decisions)

Implementation: needed (timing)

### Cleansing Nova

Type: Sorcery

Oracle text:

> Choose one —
> • Destroy all creatures.
> • Destroy all artifacts and enchantments.

Re-rendered plain English:

```
Cleansing Nova [draft]
  [a1] spell_effect [needed: needs modes, field:destroy_all.filter]
    Oracle: Choose one — / • Destroy all creatures. / • Destroy all artifacts and enchantments.
    Modes: choose 1  <- prompt: "Choose one mode."
      - Destroy each creature.
      - Destroy each artifact or enchantment.
```

Player prompts:

- Cleansing Nova: choose a mode: Choose one mode.

Implementation: needed (modes, field:destroy_all.filter)

### Court of Grace

Type: Enchantment

Oracle text:

> When this enchantment enters, you become the monarch.
> At the beginning of your upkeep, create a 1/1 white Spirit creature token with flying. If you're the monarch, create a 4/4 white Angel creature token with flying instead.

Re-rendered plain English:

```
Court of Grace [draft]
  [a1] triggered [needed: needs scripted:become_monarch]
    Oracle: When this enchantment enters, you become the monarch.
    Trigger: Whenever Court of Grace enters
    Scripted (engine-specific rule, not described by the fields above): become_monarch
  [a2] triggered [needed: needs step:if_else, field:if_else.else, field:if_else.if, field:if_else.then, predicate:stat, field:create_tokens.tokenKeywords]
    Oracle: At the beginning of your upkeep, create a 1/1 white Spirit creature token with flying. If you're the monarch, create a 4/4 white Angel creature token with flying instead.
    Trigger: At the beginning of your upkeep
    Effect: If the controller of Court of Grace is the monarch: create a 4/4 white Angel creature token with flying; otherwise create a 1/1 white Spirit creature token with flying.
```

Player prompts:

- (none: no decisions)

Implementation: needed (scripted:become_monarch, step:if_else, field:if_else.else, field:if_else.if, field:if_else.then, predicate:stat, field:create_tokens.tokenKeywords)

### Cut a Deal

Type: Sorcery

Oracle text:

> Each opponent draws a card, then you draw a card for each opponent who drew a card this way.

Re-rendered plain English:

```
Cut a Deal [draft]
  [a1] spell_effect [needed: needs field:draw_cards.who, quantity:event_amount]
    Oracle: Each opponent draws a card, then you draw a card for each opponent who drew a card this way.
    Effect: Each opponent draws a card. Then, draw that many cards.
```

Player prompts:

- (none: no decisions)

Implementation: needed (field:draw_cards.who, quantity:event_amount)

### Defy Death

Type: Sorcery

Oracle text:

> Return target creature card from your graveyard to the battlefield. If it's an Angel, put two +1/+1 counters on it.

Re-rendered plain English:

```
Defy Death [draft]
  [a1] spell_effect [needed: needs step:add_counters, field:add_counters.on, predicate:matches]
    Oracle: Return target creature card from your graveyard to the battlefield. If it's an Angel, put two +1/+1 counters on it.
    Target t1: target creature card in your graveyard  <- prompt: "Choose target creature card in your graveyard."
    Effect: Return target creature card in your graveyard from the graveyard to the battlefield. Then, IF t1 is an Angel: put 2 +1/+1 counters on target creature card in your graveyard.
```

Player prompts:

- Defy Death: choose a target: Choose target creature card in your graveyard.

Implementation: needed (step:add_counters, field:add_counters.on, predicate:matches)

### Destroy Evil

Type: Instant

Oracle text:

> Choose one —
> • Destroy target creature with toughness 4 or greater.
> • Destroy target enchantment.

Re-rendered plain English:

```
Destroy Evil [draft]
  [a1] spell_effect [needed: needs modes]
    Oracle: Choose one — / • Destroy target creature with toughness 4 or greater. / • Destroy target enchantment.
    Modes: choose 1  <- prompt: "Choose one mode."
      - Destroy target creature with toughness 4 or greater. (target: target creature with toughness 4 or greater)
      - Destroy target enchantment. (target: target enchantment)
```

Player prompts:

- Destroy Evil: choose a mode: Choose one mode.
- Destroy Evil: choose a target: Choose target creature with toughness 4 or greater.
- Destroy Evil: choose a target: Choose target enchantment.

Implementation: needed (modes)

### Emeria Shepherd

Type: Creature — Angel

Oracle text:

> Flying
> Landfall — Whenever a land you control enters, you may return target nonland permanent card from your graveyard to your hand. If that land is a Plains, you may return that nonland permanent card to the battlefield instead.

Re-rendered plain English:

```
Emeria Shepherd [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:subject, step:if_else, field:if_else.else, field:if_else.if, field:if_else.then, predicate:matches, field:move_card_zone.from, predicate:not, predicate:step_done]
    Oracle: Landfall — Whenever a land you control enters, you may return target nonland permanent card from your graveyard to your hand. If that land is a Plains, you may return that nonland permanent card to the battlefield instead.
    Trigger: Whenever a land you control enters
    Target t1: target artifact, creature, enchantment, planeswalker, or battle  <- prompt: "Choose target artifact, creature, enchantment, planeswalker, or battle."
    Effect: If that object is a Plains: put target artifact, creature, enchantment, planeswalker, or battle onto the battlefield, then put target artifact, creature, enchantment, planeswalker, or battle into your hand; otherwise put target artifact, creature, enchantment, planeswalker, or battle into your hand.
```

Player prompts:

- Emeria Shepherd: choose a target: Choose target artifact, creature, enchantment, planeswalker, or battle.
- Emeria Shepherd: optional: Do you want to put target artifact, creature, enchantment, planeswalker, or battle onto the battlefield?
- Emeria Shepherd: optional: Do you want to put target artifact, creature, enchantment, planeswalker, or battle into your hand?

Implementation: needed (trigger:subject, step:if_else, field:if_else.else, field:if_else.if, field:if_else.then, predicate:matches, field:move_card_zone.from, predicate:not, predicate:step_done)

### Endless Atlas

Type: Artifact

Oracle text:

> {2}, {T}: Draw a card. Activate only if you control three or more lands with the same name.

Re-rendered plain English:

```
Endless Atlas [draft]
  [a1] activated [needed: needs filter:sameName, timing]
    Oracle: {2}, {T}: Draw a card. Activate only if you control three or more lands with the same name.
    Cost: {2}, {T}
    Timing: you control three or more lands with the same name
    Effect: Draw a card.
```

Player prompts:

- (none: no decisions)

Implementation: needed (filter:sameName, timing)

### Exemplar of Light

Type: Creature — Angel

Oracle text:

> Flying
> Whenever you gain life, put a +1/+1 counter on this creature.
> Whenever you put one or more +1/+1 counters on this creature, draw a card. This ability triggers only once each turn.

Re-rendered plain English:

```
Exemplar of Light [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:gain_life, step:add_counters, field:add_counters.on]
    Oracle: Whenever you gain life, put a +1/+1 counter on this creature.
    Trigger: Whenever you gain life
    Effect: Put a +1/+1 counter on Exemplar of Light.
  [a3] triggered [needed: needs timing, trigger:counter_put, trigger:batch]
    Oracle: Whenever you put one or more +1/+1 counters on this creature, draw a card. This ability triggers only once each turn.
    Trigger: Whenever a counter is put on Exemplar of Light
    Timing: 1 per turn
    Effect: Draw a card.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:gain_life, step:add_counters, field:add_counters.on, timing, trigger:counter_put, trigger:batch)

### Firemane Commando

Type: Creature — Angel Soldier

Oracle text:

> Flying
> Whenever you attack with two or more creatures, draw a card.
> Whenever another player attacks with two or more creatures, they draw a card if none of those creatures attacked you.

Re-rendered plain English:

```
Firemane Commando [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:batch, trigger:min_count]
    Oracle: Whenever you attack with two or more creatures, draw a card.
    Trigger: Whenever you attack with two or more creatures
    Effect: Draw a card.
  [a3] triggered [needed: needs trigger:batch, trigger:intervening_if, predicate:attacked_defender, trigger:min_count, field:draw_cards.who]
    Oracle: Whenever another player attacks with two or more creatures, they draw a card if none of those creatures attacked you.
    Trigger: Whenever an opponent attacks with two or more creatures, if none of those creatures attacked you
    Effect: That player draws a card.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:batch, trigger:min_count, trigger:intervening_if, predicate:attacked_defender, field:draw_cards.who)

### Grasp of Fate

Type: Enchantment

Oracle text:

> When this enchantment enters, for each opponent, exile up to one target nonland permanent that player controls until this enchantment leaves the battlefield. (Those permanents return under their owners' control.)

Re-rendered plain English:

```
Grasp of Fate [draft]
  [a1] triggered [needed: needs targets:multi, targets:per_opponent, field:exile_target.who, duration:while_source_on_battlefield]
    Oracle: When this enchantment enters, for each opponent, exile up to one target nonland permanent that player controls until this enchantment leaves the battlefield. (Those permanents return under their owners' control.)
    Trigger: Whenever Grasp of Fate enters
    Target t1: up to one target nonland permanent an opponent controls (one choice for each opponent)  <- prompt: "Choose up to one target nonland permanent an opponent controls (one choice for each opponent)."
    Effect: Exile up to one target nonland permanent an opponent controls (one choice for each opponent).
```

Player prompts:

- Grasp of Fate: choose a target: Choose up to one target nonland permanent an opponent controls (one choice for each opponent).

Implementation: needed (targets:multi, targets:per_opponent, field:exile_target.who, duration:while_source_on_battlefield)

### Heraldic Banner

Type: Artifact

Oracle text:

> As this artifact enters, choose a color.
> Creatures you control of the chosen color get +1/+0.
> {T}: Add one mana of the chosen color.

Re-rendered plain English:

```
Heraldic Banner [draft]
  [a1] replacement [needed: needs replacement:would_enter, step:choose, field:choose.choice, field:choose.remember]
    Oracle: As this artifact enters, choose a color.
    Replacement: If Heraldic Banner would enter, also: choose a color
  [a2] static [needed: needs static, filter:chosenColor]
    Oracle: Creatures you control of the chosen color get +1/+0.
    Static: Of the chosen color creatures you control get +1/+0
  [a3] mana [needed: needs mana:variable, filter:chosenColor, mana:chosen_color]
    Oracle: {T}: Add one mana of the chosen color.
    Cost: {T}
    Mana: add one mana of the chosen color
```

Player prompts:

- Heraldic Banner: choose: Choose a color.

Implementation: needed (replacement:would_enter, step:choose, field:choose.choice, field:choose.remember, static, filter:chosenColor, mana:variable, mana:chosen_color)

### Linvala, the Preserver

Type: Legendary Creature — Angel

Oracle text:

> Flying
> When Linvala enters, if an opponent has more life than you, you gain 5 life.
> When Linvala enters, if an opponent controls more creatures than you, create a 3/3 white Angel creature token with flying.

Re-rendered plain English:

```
Linvala, the Preserver [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs quantity:life_total, trigger:intervening_if]
    Oracle: When Linvala enters, if an opponent has more life than you, you gain 5 life.
    Trigger: Whenever Linvala, the Preserver enters, if an opponent's life total is greater than your life total
    Effect: Gain 5 life.
  [a3] triggered [needed: needs trigger:intervening_if, field:create_tokens.tokenKeywords]
    Oracle: When Linvala enters, if an opponent controls more creatures than you, create a 3/3 white Angel creature token with flying.
    Trigger: Whenever Linvala, the Preserver enters, if you control greater than the number of creatures you control creatures an opponent controls
    Effect: Create a 3/3 white Angel creature token with flying.
```

Player prompts:

- (none: no decisions)

Implementation: needed (quantity:life_total, trigger:intervening_if, field:create_tokens.tokenKeywords)

### Metallic Mimic

Type: Artifact Creature — Shapeshifter

Oracle text:

> As this creature enters, choose a creature type.
> This creature is the chosen type in addition to its other types.
> Each other creature you control of the chosen type enters with an additional +1/+1 counter on it.

Re-rendered plain English:

```
Metallic Mimic [draft]
  [a1] replacement [needed: needs replacement:would_enter, step:choose, field:choose.choice, field:choose.remember]
    Oracle: As this creature enters, choose a creature type.
    Replacement: If Metallic Mimic would enter, also: choose a creature type
  [a2] static [needed: needs static, static:addChosenType]
    Oracle: This creature is the chosen type in addition to its other types.
    Static: Metallic Mimic is the chosen type in addition to its other types
  [a3] replacement [needed: needs replacement:would_enter, filter:chosenType]
    Oracle: Each other creature you control of the chosen type enters with an additional +1/+1 counter on it.
    Replacement: If an another creature of the chosen type you control would enter, modify it: {"additionalCounters":{"kind":"+1/+1","count":1}}
```

Player prompts:

- Metallic Mimic: choose: Choose a creature type.

Implementation: needed (replacement:would_enter, step:choose, field:choose.choice, field:choose.remember, static, static:addChosenType, filter:chosenType)

### Patchwork Banner

Type: Artifact

Oracle text:

> As this artifact enters, choose a creature type.
> Creatures you control of the chosen type get +1/+1.
> {T}: Add one mana of any color.

Re-rendered plain English:

```
Patchwork Banner [draft]
  [a1] replacement [needed: needs replacement:would_enter, step:choose, field:choose.choice, field:choose.remember]
    Oracle: As this artifact enters, choose a creature type.
    Replacement: If Patchwork Banner would enter, also: choose a creature type
  [a2] static [needed: needs static, filter:chosenType]
    Oracle: Creatures you control of the chosen type get +1/+1.
    Static: Creatures of the chosen type you control get +1/+1
  [a3] mana [needed: needs mana:variable]
    Oracle: {T}: Add one mana of any color.
    Cost: {T}
    Mana: add one mana of any color
```

Player prompts:

- Patchwork Banner: choose: Choose a creature type.

Implementation: needed (replacement:would_enter, step:choose, field:choose.choice, field:choose.remember, static, filter:chosenType, mana:variable)

### Righteous Valkyrie

Type: Creature — Angel Cleric

Oracle text:

> Flying
> Whenever another Angel or Cleric you control enters, you gain life equal to that creature's toughness.
> As long as you have at least 7 life more than your starting life total, creatures you control get +2/+2.

Re-rendered plain English:

```
Righteous Valkyrie [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:subject, quantity:stat, field:life_change.amount]
    Oracle: Whenever another Angel or Cleric you control enters, you gain life equal to that creature's toughness.
    Trigger: Whenever an Angel or Cleric you control enters
    Effect: Gain that object's toughness life.
  [a3] static [needed: needs static, quantity:starting_life]
    Oracle: As long as you have at least 7 life more than your starting life total, creatures you control get +2/+2.
    Static: Creatures you control get +2/+2 as long as your life total is greater than or equal to your starting life total + 7
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:subject, quantity:stat, field:life_change.amount, static, quantity:starting_life)

### Secluded Steppe

Type: Land

Oracle text:

> This land enters tapped.
> {T}: Add {W}.
> Cycling {W} ({W}, Discard this card: Draw a card.)

Re-rendered plain English:

```
Secluded Steppe [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped.
    Replacement: If Secluded Steppe would enter, it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {W}.
    Cost: {T}
    Mana: add {W}
  [a3] activated (from hand) [needed: needs zone:hand, cost:discard]
    Oracle: Cycling {W} ({W}, Discard this card: Draw a card.)
    Cost: {W}, discard Secluded Steppe
    Effect: Draw a card.
    Keyword: cycling
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter, zone:hand, cost:discard)

### Sephara, Sky's Blade

Type: Legendary Creature — Angel

Oracle text:

> You may pay {W} and tap four untapped creatures you control with flying rather than pay this spell's mana cost.
> Flying, lifelink
> Other creatures you control with flying have indestructible. (Damage and effects that say "destroy" don't destroy them.)

Re-rendered plain English:

```
Sephara, Sky's Blade [draft]
  Cast option c1: you may use alternative (from hand, cost {W}, tap 4 untapped untapped creatures with flying you control, replaces mana cost) [needed]
  [a1] cast_option [needed: needs cast_option]
    Oracle: You may pay {W} and tap four untapped creatures you control with flying rather than pay this spell's mana cost.
  [a2] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a3] keyword [implemented]
    Oracle: Lifelink
    Keyword: lifelink
  [a4] static [needed: needs static]
    Oracle: Other creatures you control with flying have indestructible. (Damage and effects that say "destroy" don't destroy them.)
    Static: Other creatures with flying you control have indestructible
```

Player prompts:

- Sephara, Sky's Blade: alternative option: Do you want to cast it using its alternative cost ({W}, tap 4 untapped untapped creatures with flying you control)?

Implementation: needed (cast_option, static, cast_option:alternative, cost:tapOther)

### Seraph of the Sword

Type: Creature — Angel

Oracle text:

> Flying
> Prevent all combat damage that would be dealt to this creature.

Re-rendered plain English:

```
Seraph of the Sword [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] replacement [needed: needs replacement:would_deal_damage, replacement:damage_qualifiers]
    Oracle: Prevent all combat damage that would be dealt to this creature.
    Replacement: If combat damage would be dealt to Seraph of the Sword, prevent it
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_deal_damage, replacement:damage_qualifiers)

### Speaker of the Heavens

Type: Creature — Human Cleric

Oracle text:

> Vigilance, lifelink (Attacking doesn't cause this creature to tap. Damage dealt by this creature also causes you to gain that much life.)
> {T}: Create a 4/4 white Angel creature token with flying. Activate only if you have at least 7 life more than your starting life total and only as a sorcery.

Re-rendered plain English:

```
Speaker of the Heavens [draft]
  [a1] keyword [implemented]
    Oracle: Vigilance
    Keyword: vigilance
  [a2] keyword [implemented]
    Oracle: Lifelink
    Keyword: lifelink
  [a3] activated [needed: needs quantity:starting_life, timing, field:create_tokens.tokenKeywords]
    Oracle: {T}: Create a 4/4 white Angel creature token with flying. Activate only if you have at least 7 life more than your starting life total and only as a sorcery.
    Cost: {T}
    Timing: sorcery; your life total is greater than or equal to your starting life total + 7
    Effect: Create a 4/4 white Angel creature token with flying.
```

Player prompts:

- (none: no decisions)

Implementation: needed (quantity:starting_life, timing, field:create_tokens.tokenKeywords)

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

### Valorous Stance

Type: Instant

Oracle text:

> Choose one —
> • Target creature gains indestructible until end of turn. (Damage and effects that say "destroy" don't destroy it.)
> • Destroy target creature with toughness 4 or greater.

Re-rendered plain English:

```
Valorous Stance [draft]
  [a1] spell_effect [needed: needs modes, step:grant_effect, field:grant_effect.modify]
    Oracle: Choose one — / • Target creature gains indestructible until end of turn. (Damage and effects that say "destroy" don't destroy it.) / • Destroy target creature with toughness 4 or greater.
    Modes: choose 1  <- prompt: "Choose one mode."
      - Target creature gains indestructible until end of turn. (target: target creature)
      - Destroy target creature with toughness 4 or greater. (target: target creature with toughness 4 or greater)
```

Player prompts:

- Valorous Stance: choose a mode: Choose one mode.
- Valorous Stance: choose a target: Choose target creature.
- Valorous Stance: choose a target: Choose target creature with toughness 4 or greater.

Implementation: needed (modes, step:grant_effect, field:grant_effect.modify)

### Vanquisher's Banner

Type: Artifact

Oracle text:

> As this artifact enters, choose a creature type.
> Creatures you control of the chosen type get +1/+1.
> Whenever you cast a creature spell of the chosen type, draw a card.

Re-rendered plain English:

```
Vanquisher's Banner [draft]
  [a1] replacement [needed: needs replacement:would_enter, step:choose, field:choose.choice, field:choose.remember]
    Oracle: As this artifact enters, choose a creature type.
    Replacement: If Vanquisher's Banner would enter, also: choose a creature type
  [a2] static [needed: needs static, filter:chosenType]
    Oracle: Creatures you control of the chosen type get +1/+1.
    Static: Creatures of the chosen type you control get +1/+1
  [a3] triggered [needed: needs filter:chosenType, trigger:subject]
    Oracle: Whenever you cast a creature spell of the chosen type, draw a card.
    Trigger: Whenever you cast a creature spell of the chosen type
    Effect: Draw a card.
```

Player prompts:

- Vanquisher's Banner: choose: Choose a creature type.

Implementation: needed (replacement:would_enter, step:choose, field:choose.choice, field:choose.remember, static, filter:chosenType, trigger:subject)

### Wojek Investigator

Type: Creature — Angel Detective

Oracle text:

> Flying, vigilance
> At the beginning of your upkeep, investigate once for each opponent who has more cards in hand than you. (To investigate, create a Clue token. It's an artifact with "{2}, Sacrifice this token: Draw a card.")

Re-rendered plain English:

```
Wojek Investigator [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] keyword [implemented]
    Oracle: Vigilance
    Keyword: vigilance
  [a3] triggered [needed: needs quantity:players_count, step:investigate]
    Oracle: At the beginning of your upkeep, investigate once for each opponent who has more cards in hand than you. (Create a Clue token. It's an artifact with "{2}, Sacrifice this token: Draw a card.")
    Trigger: At the beginning of your upkeep
    Effect: Investigate the number of opponents for which that player has greater than the number of cards in your hand cards in hand times.
```

Player prompts:

- (none: no decisions)

Implementation: needed (quantity:players_count, step:investigate)

### Giada, Font of Hope

Type: Legendary Creature — Angel

Oracle text:

> Flying, vigilance
> Each other Angel you control enters with an additional +1/+1 counter on it for each Angel you already control.
> {T}: Add {W}. Spend this mana only to cast an Angel spell.

Re-rendered plain English:

```
Giada, Font of Hope [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] keyword [implemented]
    Oracle: Vigilance
    Keyword: vigilance
  [a3] replacement [needed: needs replacement:would_enter]
    Oracle: Each other Angel you control enters with an additional +1/+1 counter on it for each Angel you already control.
    Replacement: If an another Angel you control would enter, modify it: {"additionalCounters":{"kind":"+1/+1","amount":1,"per":{"ref":"count","of":{"subtypes":["Angel"],"controller":"you"}}}}
  [a4] mana [needed: needs mana:restriction]
    Oracle: {T}: Add {W}. Spend this mana only to cast an Angel spell.
    Cost: {T}
    Mana: add {W} (spend only to cast an Angel spell)
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter, mana:restriction)

## Kernel to-do: missing capabilities across this deck

| capability | cards | needing it |
|---|---|---|
| `static` | 20 | Always Watching; Angel of Vitality; Angelic Destiny; Angelic Field Marshal; Archangel of Tithes; Herald of Eternal Dawn; Herald of War; Heraldic Banner; Lyra Dawnbringer; Merchant of Truth; Metallic Mimic; Metropolis Reformer; Patchwork Banner; Righteous Valkyrie; Sephara, Sky's Blade; Serra Avenger; Starnheim Aspirant; Swiftfoot Boots; Thraben Watcher; Vanquisher's Banner |
| `trigger:subject` | 13 | Angelic Destiny; Angelic Sleuth; Bishop of Wings; Dazzling Angel; Emeria Shepherd; Merchant of Truth; Norn's Choirmaster; Righteous Valkyrie; Search the Premises; Seraph Sanctuary; Tome of Legends; Vanquisher's Banner; Youthful Valkyrie |
| `replacement:would_enter` | 8 | Heraldic Banner; Marble Diamond; Metallic Mimic; Patchwork Banner; Secluded Steppe; Tome of Legends; Vanquisher's Banner; Giada, Font of Hope |
| `field:add_counters.on` | 5 | Defy Death; Exemplar of Light; Herald of War; Tome of Legends; Youthful Valkyrie |
| `step:add_counters` | 5 | Defy Death; Exemplar of Light; Herald of War; Tome of Legends; Youthful Valkyrie |
| `step:investigate` | 5 | Angelic Sleuth; Fateful Absence; Merchant of Truth; Search the Premises; Wojek Investigator |
| `timing` | 5 | Bonders' Enclave; Endless Atlas; Exemplar of Light; Speaker of the Heavens; Temple of the False God |
| `field:choose.choice` | 4 | Heraldic Banner; Metallic Mimic; Patchwork Banner; Vanquisher's Banner |
| `field:choose.remember` | 4 | Heraldic Banner; Metallic Mimic; Patchwork Banner; Vanquisher's Banner |
| `field:create_tokens.tokenKeywords` | 4 | Bishop of Wings; Court of Grace; Linvala, the Preserver; Speaker of the Heavens |
| `field:life_change.amount` | 4 | Angel of Vitality; Metropolis Reformer; Righteous Valkyrie; Swords to Plowshares |
| `mana:variable` | 4 | Commander's Sphere; Heraldic Banner; Patchwork Banner; Arcane Signet |
| `modes` | 4 | Austere Command; Cleansing Nova; Destroy Evil; Valorous Stance |
| `step:choose` | 4 | Heraldic Banner; Metallic Mimic; Patchwork Banner; Vanquisher's Banner |
| `field:destroy_all.filter` | 3 | Austere Command; Cleansing Nova; Sunblast Angel |
| `field:move_card_zone.from` | 3 | Angel of Finality; Angelic Destiny; Emeria Shepherd |
| `filter:chosenType` | 3 | Metallic Mimic; Patchwork Banner; Vanquisher's Banner |
| `filter:isCommander` | 3 | Angelic Field Marshal; Norn's Choirmaster; Tome of Legends |
| `predicate:matches` | 3 | Angelic Sleuth; Defy Death; Emeria Shepherd |
| `trigger:intervening_if` | 3 | Angelic Sleuth; Firemane Commando; Linvala, the Preserver |
| `zone:hand` | 3 | Angel of the Ruins; Secluded Steppe; Serra Avenger |
| `cost:discard` | 2 | Angel of the Ruins; Secluded Steppe |
| `cost:sacrifice` | 2 | Commander's Sphere; Mind Stone |
| `field:draw_cards.who` | 2 | Cut a Deal; Firemane Commando |
| `field:if_else.else` | 2 | Court of Grace; Emeria Shepherd |
| `field:if_else.if` | 2 | Court of Grace; Emeria Shepherd |
| `field:if_else.then` | 2 | Court of Grace; Emeria Shepherd |
| `quantity:event_amount` | 2 | Cut a Deal; Metropolis Reformer |
| `quantity:starting_life` | 2 | Righteous Valkyrie; Speaker of the Heavens |
| `quantity:stat` | 2 | Righteous Valkyrie; Swords to Plowshares |
| `step:if_else` | 2 | Court of Grace; Emeria Shepherd |
| `targets:multi` | 2 | Angel of the Ruins; Grasp of Fate |
| `trigger:batch` | 2 | Exemplar of Light; Firemane Commando |
| `trigger:gain_life` | 2 | Exemplar of Light; Vanguard Seraph |
| `trigger:multi_event` | 2 | Norn's Choirmaster; Tome of Legends |
| `cast_option` | 1 | Sephara, Sky's Blade |
| `cast_option:alternative` | 1 | Sephara, Sky's Blade |
| `cost:counters` | 1 | Tome of Legends |
| `cost:life` | 1 | War Room |
| `cost:tapOther` | 1 | Sephara, Sky's Blade |
| `duration:while_source_on_battlefield` | 1 | Grasp of Fate |
| `field:attach.to` | 1 | Swiftfoot Boots |
| `field:attach.what` | 1 | Swiftfoot Boots |
| `field:draw_cards.alsoWho` | 1 | Secret Rendezvous |
| `field:exile_target.who` | 1 | Grasp of Fate |
| `field:grant_effect.modify` | 1 | Valorous Stance |
| `field:life_change.who` | 1 | Swords to Plowshares |
| `field:move_card_zone.all` | 1 | Angel of Finality |
| `field:move_card_zone.who` | 1 | Angel of Finality |
| `field:search_library.count` | 1 | Angel of the Ruins |
| `field:search_library.filter` | 1 | Angel of the Ruins |
| `field:search_library.reveal` | 1 | Angel of the Ruins |
| `field:search_library.shuffle` | 1 | Angel of the Ruins |
| `field:search_library.to` | 1 | Angel of the Ruins |
| `filter:chosenColor` | 1 | Heraldic Banner |
| `filter:sameName` | 1 | Endless Atlas |
| `keyword:enchant` | 1 | Angelic Destiny |
| `mana:chosen_color` | 1 | Heraldic Banner |
| `mana:restriction` | 1 | Giada, Font of Hope |
| `modes:multiple` | 1 | Austere Command |
| `predicate:attacked_defender` | 1 | Firemane Commando |
| `predicate:not` | 1 | Emeria Shepherd |
| `predicate:stat` | 1 | Court of Grace |
| `predicate:step_done` | 1 | Emeria Shepherd |
| `quantity:life_total` | 1 | Linvala, the Preserver |
| `quantity:math` | 1 | Angel of Vitality |
| `quantity:players_count` | 1 | Wojek Investigator |
| `replacement:damage_qualifiers` | 1 | Seraph of the Sword |
| `replacement:would_deal_damage` | 1 | Seraph of the Sword |
| `replacement:would_gain_life` | 1 | Angel of Vitality |
| `scripted:become_monarch` | 1 | Court of Grace |
| `static:addChosenType` | 1 | Metallic Mimic |
| `static:addTypes` | 1 | Angelic Destiny |
| `static:attackTax` | 1 | Archangel of Tithes |
| `static:blockTax` | 1 | Archangel of Tithes |
| `static:costMod_quantity` | 1 | Herald of War |
| `step:attach` | 1 | Swiftfoot Boots |
| `step:grant_effect` | 1 | Valorous Stance |
| `step:proliferate` | 1 | Norn's Choirmaster |
| `step:search_library` | 1 | Angel of the Ruins |
| `step:surveil` | 1 | Vanguard Seraph |
| `targets:per_opponent` | 1 | Grasp of Fate |
| `trigger:counter_put` | 1 | Exemplar of Light |
| `trigger:dealt_damage` | 1 | Metropolis Reformer |
| `trigger:defender` | 1 | Search the Premises |
| `trigger:leaves` | 1 | Angelic Sleuth |
| `trigger:min_count` | 1 | Firemane Commando |
| `trigger:nth` | 1 | Vanguard Seraph |

## Decisions

- Consolidated schema pass: the workarounds reported by the five pilot decks (sentinels, review.ignore hacks, scripted stubs, placeholder refs) now use real fields; see src/kernel/SCHEMA_CHANGELOG.md.
- Monarch stays a scripted marker (become_monarch + the controller_is_monarch stat) by user decision; Crew, Improvise, Myriad, Storm, Read ahead, Manifest dread, Reselect attack target and tapped-for-{C} stay scripted markers (vocabulary listed in the changelog).
- Remaining genuine card-behaviour questions are collected in data/kernel-drafts/CONSOLIDATED_QUESTIONS.md, not per deck.
