# Kernel draft approval: Reign Of Dragons

68 unique cards: 25 simple (A), 43 complex (B). Validator: 68/68 pass. Cards with implementation "needed": 64. All drafts are `review.status: "draft"`; nothing was written to the DB.

Reading guide: each card below shows the oracle text and what the structured JSON says back in plain English. Approve if they match.

## (A) Simple cards: spot-check one line each

- **Arcane Signet** (Artifact): {T}: add one mana of any color in your commander's color identity [needs: mana:variable]
- **Basilisk Collar** (Artifact — Equipment): The equipped creature has deathtouch and has lifelink | {2}: [targets: target creature you control] Attach Basilisk Collar to target creature you control [needs: static, step:attach, field:attach.to, field:attach.what]
- **Blasphemous Act** (Sorcery): (costs {1} less for each creature) | Deal 13 damage to the target [needs: cast_option, cost_reduction, field:damage_target.all, field:damage_target.filter]
- **Breath Weapon** (Instant): Deal 2 damage to the target [needs: filter:notSubtypes, field:damage_target.all, field:damage_target.filter]
- **Commander's Sphere** (Artifact): {T}: add one mana of any color in your commander's color identity | sacrifice Commander's Sphere: Draw a card [needs: mana:variable, cost:sacrifice]
- **Count on Luck** (Enchantment): At the beginning of your upkeep: Exile a card, then you may you may play exiled until end of turn [needs: field:move_card_zone.position, field:move_card_zone.saveAs, step:permission_to_play, field:permission_to_play.what]
- **Crucible of Fire** (Enchantment): Dragons you control get +3/+3 [needs: static]
- **Dragon's Hoard** (Artifact): Whenever a Dragon you control enters: Put a gold counter on Dragon's Hoard | {T}, remove a gold counter from Dragon's Hoard: Draw a card | {T}: add one mana of any color [needs: trigger:subject, step:add_counters, field:add_counters.on, cost:counters, mana:variable]
- **Dragonlord's Servant** (Creature — Goblin Shaman): Dragon spells you cast cost {1} less to cast [needs: static]
- **Dragonspeaker Shaman** (Creature — Human Barbarian Shaman): Dragon spells you cast cost {2} less to cast [needs: static]
- **Dragonstorm Globe** (Artifact): If a Dragon you control would enter, also: put a +1/+1 counter on that object | {T}: add one mana of any color [needs: replacement:would_enter, step:add_counters, field:add_counters.on, mana:variable]
- **Fire Diamond** (Artifact): If Fire Diamond would enter, it enters tapped | {T}: add {R} [needs: replacement:would_enter]
- **Leyline Tyrant** (Creature — Dragon): Keyword flying | You have keep_unspent_red_mana_between_steps_and_phases | Whenever Leyline Tyrant dies: [targets: target] You may Leyline Tyrant deals X damage to target [needs: static, quantity:X, field:damage_target.optionalCost, field:damage_target.source, predicate:paid_additional_cost]
- **Lightning Bolt** (Instant): [targets: target] Deal 3 damage to target [implemented]
- **Mana Geyser** (Sorcery): Add {R} [needs: step:add_mana, quantity:count, field:add_mana.produces]
- **Mountain** (Basic Land — Mountain): {T}: add {R} [implemented]
- **Rapacious Dragon** (Creature — Dragon): Keyword flying | Whenever Rapacious Dragon enters: Create two ?/? colorless Treasure artifact tokens [implemented]
- **Sarkhan's Triumph** (Instant): Search your library for a Dragon, put it onto your hand, then shuffle [needs: step:search_library, field:search_library.count, field:search_library.filter, field:search_library.reveal, field:search_library.shuffle, field:search_library.to]
- **Sol Ring** (Artifact): {T}: add {C}{C} [implemented]
- **Swiftfoot Boots** (Artifact — Equipment): The equipped creature has hexproof and has haste | {1}: [targets: target creature you control] Attach Swiftfoot Boots to target creature you control [needs: static, step:attach, field:attach.to, field:attach.what]
- **Taurean Mauler** (Creature — Shapeshifter): Keyword changeling | Whenever an opponent casts a spell: You may put a +1/+1 counter on Taurean Mauler [needs: step:add_counters, field:add_counters.on]
- **Thunderbreak Regent** (Creature — Dragon): Keyword flying | Whenever a Dragon you control becomes the target of a spell or ability: Thunderbreak Regent deals 3 damage to the target [needs: trigger:becomes_target, trigger:subject, field:damage_target.source, field:damage_target.who]
- **Utvara Hellkite** (Creature — Dragon): Keyword flying | Whenever a Dragon you control attacks: Create a 6/6 red Dragon creature token with flying [needs: trigger:subject, field:create_tokens.tokenKeywords]
- **War Room** (Land): {T}: add {C} | {3}, {T}, pay life equal to the number of colors in your commanders' color identity: Draw a card [needs: cost:life]
- **Warstorm Surge** (Enchantment): Whenever a creature you control enters: [targets: target] That object deals that object's power damage to target [needs: trigger:subject, quantity:stat, field:damage_target.source]

## (B) Complex cards

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

### Abrade

Type: Instant

Oracle text:

> Choose one —
> • Abrade deals 3 damage to target creature.
> • Destroy target artifact.

Re-rendered plain English:

```
Abrade [draft]
  [a1] spell_effect [needed: needs modes]
    Oracle: Choose one — / • Abrade deals 3 damage to target creature. / • Destroy target artifact.
    Modes: choose 1  <- prompt: "Choose one mode."
      - Deal 3 damage to target creature. (target: target creature)
      - Destroy target artifact. (target: target artifact)
```

Player prompts:

- Abrade: choose a mode: Choose one mode.
- Abrade: choose a target: Choose target creature.
- Abrade: choose a target: Choose target artifact.

Implementation: needed (modes)

### Atsushi, the Blazing Sky

Type: Legendary Creature — Dragon Spirit

Oracle text:

> Flying, trample
> When Atsushi dies, choose one —
> • Exile the top two cards of your library. Until the end of your next turn, you may play those cards.
> • Create three Treasure tokens.

Re-rendered plain English:

```
Atsushi, the Blazing Sky [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] keyword [implemented]
    Oracle: Trample
    Keyword: trample
  [a3] triggered [needed: needs modes, field:move_card_zone.position, field:move_card_zone.saveAs, step:permission_to_play, field:permission_to_play.what, duration:until_end_of_your_next_turn]
    Oracle: When Atsushi dies, choose one — / • Exile the top two cards of your library. Until the end of your next turn, you may play those cards. / • Create three Treasure tokens.
    Trigger: Whenever Atsushi, the Blazing Sky dies
    Modes: choose 1  <- prompt: "Choose one mode."
      - Exile a card. Then, you may you may play exiled until end of your next turn.
      - Create three ?/? colorless Treasure artifact tokens.
```

Player prompts:

- Atsushi, the Blazing Sky: choose a mode: Choose one mode.
- Atsushi, the Blazing Sky: optional: Do you want to you may play exiled until end of your next turn?

Implementation: needed (modes, field:move_card_zone.position, field:move_card_zone.saveAs, step:permission_to_play, field:permission_to_play.what, duration:until_end_of_your_next_turn)

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

### Breaching Dragonstorm

Type: Enchantment

Oracle text:

> When this enchantment enters, exile cards from the top of your library until you exile a nonland card. You may cast it without paying its mana cost if that spell's mana value is 8 or less. If you don't, put that card into your hand.
> When a Dragon you control enters, return this enchantment to its owner's hand.

Re-rendered plain English:

```
Breaching Dragonstorm [draft]
  [a1] triggered [needed: needs field:move_card_zone.position, field:move_card_zone.saveAs, field:move_card_zone.until, step:permission_to_play, field:permission_to_play.what, field:permission_to_play.withoutPaying, predicate:matches]
    Oracle: When this enchantment enters, exile cards from the top of your library until you exile a nonland card. You may cast it without paying its mana cost if that spell's mana value is 8 or less. If you don't, put that card into your hand.
    Trigger: Whenever Breaching Dragonstorm enters
    Effect: Exile a card. Then, IF that object is a permanent with mana value 8 or less: you may you may play event_object without paying its mana cost. Then, IF that object is a card in exile: put that object into your hand.
  [a2] triggered [needed: needs trigger:subject]
    Oracle: When a Dragon you control enters, return this enchantment to its owner's hand.
    Trigger: Whenever a Dragon you control enters
    Effect: Return Breaching Dragonstorm to its owner's hand.
```

Player prompts:

- Breaching Dragonstorm: optional: Do you want to you may play event_object without paying its mana cost?

Implementation: needed (field:move_card_zone.position, field:move_card_zone.saveAs, field:move_card_zone.until, step:permission_to_play, field:permission_to_play.what, field:permission_to_play.withoutPaying, predicate:matches, trigger:subject)

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

### Chandra's Ignition

Type: Sorcery

Oracle text:

> Target creature you control deals damage equal to its power to each other creature and each opponent.

Re-rendered plain English:

```
Chandra's Ignition [draft]
  [a1] spell_effect [needed: needs quantity:stat, field:damage_target.all, field:damage_target.filter, field:damage_target.source, field:damage_target.who]
    Oracle: Target creature you control deals damage equal to its power to each other creature and each opponent.
    Target t1: target creature you control  <- prompt: "Choose target creature you control."
    Effect: Target creature you control deals t1's power damage to the target. Then, target creature you control deals t1's power damage to the target.
```

Player prompts:

- Chandra's Ignition: choose a target: Choose target creature you control.

Implementation: needed (quantity:stat, field:damage_target.all, field:damage_target.filter, field:damage_target.source, field:damage_target.who)

### Chaos Warp

Type: Instant

Oracle text:

> The owner of target permanent shuffles it into their library, then reveals the top card of their library. If it's a permanent card, they put it onto the battlefield.

Re-rendered plain English:

```
Chaos Warp [draft]
  [a1] spell_effect [needed: needs field:move_card_zone.shuffle, field:move_card_zone.who, step:reveal, field:reveal.saveAs, field:reveal.what, field:reveal.who, step:if_else, field:if_else.if, field:if_else.then, predicate:matches]
    Oracle: The owner of target permanent shuffles it into their library, then reveals the top card of their library. If it's a permanent card, they put it onto the battlefield.
    Target t1: target permanent  <- prompt: "Choose target permanent."
    Effect: Put target permanent into its owner's library. Then, reveal the target. Then, if that object is a permanent: put that object onto the battlefield.
```

Player prompts:

- Chaos Warp: choose a target: Choose target permanent.

Implementation: needed (field:move_card_zone.shuffle, field:move_card_zone.who, step:reveal, field:reveal.saveAs, field:reveal.what, field:reveal.who, step:if_else, field:if_else.if, field:if_else.then, predicate:matches)

### Cursed Mirror

Type: Artifact

Oracle text:

> {T}: Add {R}.
> As this artifact enters, you may have it become a copy of any creature on the battlefield until end of turn, except it has haste.

Re-rendered plain English:

```
Cursed Mirror [draft]
  [a1] mana [implemented]
    Oracle: {T}: Add {R}.
    Cost: {T}
    Mana: add {R}
  [a2] replacement [needed: needs replacement:would_enter, step:copy, field:copy.exceptGrant, field:copy.of]
    Oracle: As this artifact enters, you may have it become a copy of any creature on the battlefield until end of turn, except it has haste.
    Replacement: If Cursed Mirror would enter, also: copy Cursed Mirror
    (optional: Do you want to use this ability?)
```

Player prompts:

- Cursed Mirror: optional: Do you want to use this ability?
- Cursed Mirror: optional: Do you want to copy Cursed Mirror?
- Cursed Mirror: optional: Do you want to apply this replacement?

Implementation: needed (replacement:would_enter, step:copy, field:copy.exceptGrant, field:copy.of)

### Desolation of Smaug

Type: Sorcery

Oracle text:

> Desolation of Smaug deals 3 damage to each non-Dragon creature.
> Add four mana in any combination of colors. Spend this mana only to cast Dragon spells.

Re-rendered plain English:

```
Desolation of Smaug [draft]
  [a1] spell_effect [needed: needs filter:notSubtypes, field:damage_target.all, field:damage_target.filter, step:add_mana, field:add_mana.produces, field:add_mana.srcs]
    Oracle: Desolation of Smaug deals 3 damage to each non-Dragon creature. / Add four mana in any combination of colors. Spend this mana only to cast Dragon spells.
    Effect: Deal 3 damage to the target. Then, add 4 mana in any combination of colors (spend only to cast a Dragon spell).
```

Player prompts:

- (none: no decisions)

Implementation: needed (filter:notSubtypes, field:damage_target.all, field:damage_target.filter, step:add_mana, field:add_mana.produces, field:add_mana.srcs)

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

### Dragonhawk, Fate's Tempest

Type: Legendary Creature — Bird Dragon

Oracle text:

> Flying
> Whenever Dragonhawk enters or attacks, exile the top X cards of your library, where X is the number of creatures you control with power 4 or greater. You may play those cards until your next end step. At the beginning of your next end step, Dragonhawk deals 2 damage to each opponent for each of those cards that are still exiled.

Re-rendered plain English:

```
Dragonhawk, Fate's Tempest [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:multi_event, field:move_card_zone.position, field:move_card_zone.saveAs, step:permission_to_play, field:permission_to_play.what, duration:until_your_next_end_step, step:create_delayed_trigger, field:create_delayed_trigger.at, field:create_delayed_trigger.steps, quantity:math, field:damage_target.from, field:damage_target.source, field:damage_target.who]
    Oracle: Whenever Dragonhawk enters or attacks, exile the top X cards of your library, where X is the number of creatures you control with power 4 or greater. You may play those cards until your next end step. At the beginning of your next end step, Dragonhawk deals 2 damage to each opponent for each of those cards that are still exiled.
    Trigger: Whenever Dragonhawk, Fate's Tempest enters or attacks
    Effect: Exile a card. Then, you may you may play exiled until your next end step. Then, create a delayed trigger.
```

Player prompts:

- Dragonhawk, Fate's Tempest: optional: Do you want to you may play exiled until your next end step?

Implementation: needed (trigger:multi_event, field:move_card_zone.position, field:move_card_zone.saveAs, step:permission_to_play, field:permission_to_play.what, duration:until_your_next_end_step, step:create_delayed_trigger, field:create_delayed_trigger.at, field:create_delayed_trigger.steps, quantity:math, field:damage_target.from, field:damage_target.source, field:damage_target.who)

### Dragonmaster Outcast

Type: Creature — Human Shaman

Oracle text:

> At the beginning of your upkeep, if you control six or more lands, create a 5/5 red Dragon creature token with flying.

Re-rendered plain English:

```
Dragonmaster Outcast [draft]
  [a1] triggered [needed: needs trigger:intervening_if, field:create_tokens.tokenKeywords]
    Oracle: At the beginning of your upkeep, if you control six or more lands, create a 5/5 red Dragon creature token with flying.
    Trigger: At the beginning of your upkeep, if you control six or more lands
    Effect: Create a 5/5 red Dragon creature token with flying.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:intervening_if, field:create_tokens.tokenKeywords)

### Drakuseth, Maw of Flames

Type: Legendary Creature — Dragon

Oracle text:

> Flying
> Whenever Drakuseth attacks, it deals 4 damage to any target and 3 damage to each of up to two other targets.

Re-rendered plain English:

```
Drakuseth, Maw of Flames [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs targets:multi, field:damage_target.source]
    Oracle: Whenever Drakuseth attacks, it deals 4 damage to any target and 3 damage to each of up to two other targets.
    Trigger: Whenever Drakuseth, Maw of Flames attacks
    Target t1: target  <- prompt: "Choose target."
    Target t2: up to two other targets  <- prompt: "Choose up to two other targets."
    Effect: Drakuseth, Maw of Flames deals 4 damage to target. Then, Drakuseth, Maw of Flames deals 3 damage to up to two other targets.
```

Player prompts:

- Drakuseth, Maw of Flames: choose a target: Choose target.
- Drakuseth, Maw of Flames: choose targets: Choose up to two other targets.

Implementation: needed (targets:multi, field:damage_target.source)

### Firespitter Whelp

Type: Creature — Dragon

Oracle text:

> Flying
> Whenever you cast a noncreature or Dragon spell, this creature deals 1 damage to each opponent.

Re-rendered plain English:

```
Firespitter Whelp [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:subject, field:damage_target.source, field:damage_target.who]
    Oracle: Whenever you cast a noncreature or Dragon spell, this creature deals 1 damage to each opponent.
    Trigger: Whenever you cast a noncreature spell or Dragon spell
    Effect: Firespitter Whelp deals 1 damage to the target.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:subject, field:damage_target.source, field:damage_target.who)

### Forgotten Cave

Type: Land

Oracle text:

> This land enters tapped.
> {T}: Add {R}.
> Cycling {R} ({R}, Discard this card: Draw a card.)

Re-rendered plain English:

```
Forgotten Cave [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped.
    Replacement: If Forgotten Cave would enter, it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {R}.
    Cost: {T}
    Mana: add {R}
  [a3] activated (from hand) [needed: needs zone:hand, cost:discard]
    Oracle: Cycling {R} ({R}, Discard this card: Draw a card.)
    Cost: {R}, discard Forgotten Cave
    Effect: Draw a card.
    Keyword: cycling
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter, zone:hand, cost:discard)

### Gadrak, the Crown-Scourge

Type: Legendary Creature — Dragon

Oracle text:

> Flying
> Gadrak can't attack unless you control four or more artifacts.
> At the beginning of your end step, create a Treasure token for each nontoken creature that died this turn. (It's an artifact with "{T}, Sacrifice this token: Add one mana of any color.")

Re-rendered plain English:

```
Gadrak, the Crown-Scourge [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] static [needed: needs static]
    Oracle: Gadrak can't attack unless you control four or more artifacts.
    Static: Gadrak, the Crown-Scourge can't attack unless you control four or more artifacts
  [a3] triggered [needed: needs quantity:count_this_turn]
    Oracle: At the beginning of your end step, create a Treasure token for each nontoken creature that died this turn.
    Trigger: At the beginning of your end step
    Effect: Create the number of nontoken creatures that dies this turn ?/? colorless Treasure artifact tokens.
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, quantity:count_this_turn)

### Goldlust Triad

Type: Creature — Dragon

Oracle text:

> Flying
> Myriad (Whenever this creature attacks, for each opponent other than defending player, you may create a token copy that's tapped and attacking that player or a planeswalker they control. Exile the tokens at end of combat.)
> Whenever this creature deals combat damage to a player, create a Treasure token.

Re-rendered plain English:

```
Goldlust Triad [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs scripted:myriad, step:copy, field:copy.attacking, field:copy.exileAt, field:copy.forEach, field:copy.tapped, field:copy.token]
    Oracle: Myriad (Whenever this creature attacks, for each opponent other than defending player, you may create a token copy that's tapped and attacking that player or a planeswalker they control. Exile the tokens at end of combat.)
    Trigger: Whenever Goldlust Triad attacks
    Effect: You may copy Goldlust Triad.
    Scripted (engine-specific rule, not described by the fields above): myriad
    Keyword: myriad
  [a3] triggered [implemented]
    Oracle: Whenever this creature deals combat damage to a player, create a Treasure token.
    Trigger: Whenever Goldlust Triad deals combat damage to a player
    Effect: Create a ?/? colorless Treasure artifact token.
```

Player prompts:

- Goldlust Triad: optional: Do you want to copy Goldlust Triad?

Implementation: needed (scripted:myriad, step:copy, field:copy.attacking, field:copy.exileAt, field:copy.forEach, field:copy.tapped, field:copy.token)

### Haven of the Spirit Dragon

Type: Land

Oracle text:

> {T}: Add {C}.
> {T}: Add one mana of any color. Spend this mana only to cast a Dragon creature spell.
> {2}, {T}, Sacrifice this land: Return target Dragon creature card or Ugin planeswalker card from your graveyard to your hand.

Re-rendered plain English:

```
Haven of the Spirit Dragon [draft]
  [a1] mana [implemented]
    Oracle: {T}: Add {C}.
    Cost: {T}
    Mana: add {C}
  [a2] mana [needed: needs mana:variable, mana:restriction]
    Oracle: {T}: Add one mana of any color. Spend this mana only to cast a Dragon creature spell.
    Cost: {T}
    Mana: add one mana of any color (spend only to cast a creature Dragon spell)
  [a3] activated [needed: needs cost:sacrifice]
    Oracle: {2}, {T}, Sacrifice this land: Return target Dragon creature card or Ugin planeswalker card from your graveyard to your hand.
    Cost: {2}, {T}, sacrifice Haven of the Spirit Dragon
    Target t1: target Dragon or Ugin  <- prompt: "Choose target Dragon or Ugin."
    Effect: Put target Dragon or Ugin into your hand.
```

Player prompts:

- Haven of the Spirit Dragon: choose a target: Choose target Dragon or Ugin.

Implementation: needed (mana:variable, mana:restriction, cost:sacrifice)

### Hazoret's Monument

Type: Legendary Artifact

Oracle text:

> Red creature spells you cast cost {1} less to cast.
> Whenever you cast a creature spell, you may discard a card. If you do, draw a card.

Re-rendered plain English:

```
Hazoret's Monument [draft]
  [a1] static [needed: needs static]
    Oracle: Red creature spells you cast cost {1} less to cast.
    Static: Red creature spells you cast cost {1} less to cast
  [a2] triggered [needed: needs predicate:paid_additional_cost]
    Oracle: Whenever you cast a creature spell, you may discard a card. If you do, draw a card.
    Trigger: Whenever you cast a creature spell
    Effect: You may discard a card. Then, IF the additional cost (discard a card) was paid: draw a card.
```

Player prompts:

- Hazoret's Monument: optional: Do you want to discard a card?

Implementation: needed (static, predicate:paid_additional_cost)

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
  [a3] triggered [needed: needs field:untap_target.all, field:untap_target.filter, field:untap_target.optionalCost, predicate:paid_additional_cost, step:extra_combat]
    Oracle: Whenever this creature attacks, you may pay {5}{R}{R}. If you do, untap all attacking creatures and after this phase, there is an additional combat phase.
    Trigger: Whenever Hellkite Charger attacks
    Effect: IF {5}{R}{R} was paid: you may untap the target. Then, IF {5}{R}{R} was paid: there is an additional combat phase after this one.
```

Player prompts:

- Hellkite Charger: optional: Do you want to untap the target?

Implementation: needed (field:untap_target.all, field:untap_target.filter, field:untap_target.optionalCost, predicate:paid_additional_cost, step:extra_combat)

### Magda, the Hoardmaster

Type: Legendary Creature — Dwarf Berserker

Oracle text:

> Whenever you commit a crime, create a tapped Treasure token. This ability triggers only once each turn. (Targeting opponents, anything they control, and/or cards in their graveyards is a crime.)
> Sacrifice three Treasures: Create a 4/4 red Scorpion Dragon creature token with flying and haste. Activate only as a sorcery.

Re-rendered plain English:

```
Magda, the Hoardmaster [draft]
  [a1] triggered [needed: needs trigger:commit_crime, trigger:nth, field:create_tokens.tokenTapped]
    Oracle: Whenever you commit a crime, create a tapped Treasure token. This ability triggers only once each turn. (Targeting opponents, anything they control, and/or cards in their graveyards is a crime.)
    Trigger: Whenever you commit a crime for the first time each turn
    Effect: Create a ?/? colorless Treasure artifact token tapped.
  [a2] activated [needed: needs cost:sacrifice, field:create_tokens.tokenKeywords]
    Oracle: Sacrifice three Treasures: Create a 4/4 red Scorpion Dragon creature token with flying and haste. Activate only as a sorcery.
    Cost: sacrifice 3 Treasures you control
    Timing: sorcery
    Effect: Create a 4/4 red Scorpion Dragon creature token with flying and haste.
```

Player prompts:

- Magda, the Hoardmaster: choose what to sacrifice: Choose 3 Treasures you control to sacrifice.

Implementation: needed (trigger:commit_crime, trigger:nth, field:create_tokens.tokenTapped, cost:sacrifice, field:create_tokens.tokenKeywords)

### Magmaquake

Type: Instant

Oracle text:

> Magmaquake deals X damage to each creature without flying and each planeswalker.

Re-rendered plain English:

```
Magmaquake [draft]
  [a1] spell_effect [needed: needs filter:without, quantity:X, field:damage_target.all, field:damage_target.filter]
    Oracle: Magmaquake deals X damage to each creature without flying and each planeswalker.
    Effect: Deal X damage to the target. Then, deal X damage to the target.
```

Player prompts:

- (none: no decisions)

Implementation: needed (filter:without, quantity:X, field:damage_target.all, field:damage_target.filter)

### Nogi, Draco-Zealot

Type: Legendary Creature — Kobold Shaman

Oracle text:

> Dragon spells you cast cost {1} less to cast.
> Whenever Nogi attacks, if you control three or more Dragons, until end of turn, Nogi becomes a Dragon with base power and toughness 5/5 and gains flying.

Re-rendered plain English:

```
Nogi, Draco-Zealot [draft]
  [a1] static [needed: needs static]
    Oracle: Dragon spells you cast cost {1} less to cast.
    Static: Dragon spells you cast cost {1} less to cast
  [a2] triggered [needed: needs trigger:intervening_if, step:grant_effect, field:grant_effect.modify]
    Oracle: Whenever Nogi attacks, if you control three or more Dragons, until end of turn, Nogi becomes a Dragon with base power and toughness 5/5 and gains flying.
    Trigger: Whenever Nogi, Draco-Zealot attacks, if you control three or more Dragons
    Effect: Nogi, Draco-Zealot is Dragon and has base power and toughness 5/5 and gains flying until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, trigger:intervening_if, step:grant_effect, field:grant_effect.modify)

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

### Outpost Siege

Type: Enchantment

Oracle text:

> As this enchantment enters, choose Khans or Dragons.
> • Khans — At the beginning of your upkeep, exile the top card of your library. Until end of turn, you may play that card.
> • Dragons — Whenever a creature you control leaves the battlefield, this enchantment deals 1 damage to any target.

Re-rendered plain English:

```
Outpost Siege [draft]
  [a1] replacement [needed: needs replacement:would_enter, step:choose, field:choose.choice, field:choose.options, field:choose.remember]
    Oracle: As this enchantment enters, choose Khans or Dragons.
    Replacement: If Outpost Siege would enter, also: choose one of Khans or Dragons
  [a2] triggered [needed: needs trigger:intervening_if, predicate:chosen_is, field:move_card_zone.position, field:move_card_zone.saveAs, step:permission_to_play, field:permission_to_play.what]
    Oracle: • Khans — At the beginning of your upkeep, exile the top card of your library. Until end of turn, you may play that card.
    Trigger: At the beginning of your upkeep, if the chosen mode is Khans
    Effect: Exile a card. Then, you may you may play exiled until end of turn.
  [a3] triggered [needed: needs trigger:leaves, trigger:intervening_if, predicate:chosen_is, trigger:subject, field:damage_target.source]
    Oracle: • Dragons — Whenever a creature you control leaves the battlefield, this enchantment deals 1 damage to any target.
    Trigger: Whenever a creature you control leaves the battlefield, if the chosen mode is Dragons
    Target t1: target  <- prompt: "Choose target."
    Effect: Outpost Siege deals 1 damage to target.
```

Player prompts:

- Outpost Siege: choose: Choose one of Khans or Dragons.
- Outpost Siege: optional: Do you want to you may play exiled until end of turn?
- Outpost Siege: choose a target: Choose target.

Implementation: needed (replacement:would_enter, step:choose, field:choose.choice, field:choose.options, field:choose.remember, trigger:intervening_if, predicate:chosen_is, field:move_card_zone.position, field:move_card_zone.saveAs, step:permission_to_play, field:permission_to_play.what, trigger:leaves, trigger:subject, field:damage_target.source)

### Parapet Thrasher

Type: Creature — Dragon

Oracle text:

> Flying
> Whenever one or more Dragons you control deal combat damage to an opponent, choose one that hasn't been chosen this turn —
> • Destroy target artifact that opponent controls.
> • This creature deals 4 damage to each other opponent.
> • Exile the top card of your library. You may play it this turn.

Re-rendered plain English:

```
Parapet Thrasher [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs modes, modes:repeat_restriction, trigger:batch, trigger:subject, field:damage_target.excludeWho, field:damage_target.source, field:damage_target.who, field:move_card_zone.position, field:move_card_zone.saveAs, step:permission_to_play, field:permission_to_play.what]
    Oracle: Whenever one or more Dragons you control deal combat damage to an opponent, choose one that hasn't been chosen this turn — / • Destroy target artifact that opponent controls. / • This creature deals 4 damage to each other opponent. / • Exile the top card of your library. You may play it this turn.
    Trigger: Whenever one or more Dragons you control deal combat damage to a player
    Modes: choose 1  <- prompt: "Choose one mode."
      - Destroy target artifact an opponent controls. (target: target artifact an opponent controls)
      - Parapet Thrasher deals 4 damage to the target.
      - Exile a card. Then, you may you may play exiled until end of turn.
```

Player prompts:

- Parapet Thrasher: choose a mode: Choose one mode.
- Parapet Thrasher: choose a target: Choose target artifact an opponent controls.
- Parapet Thrasher: optional: Do you want to you may play exiled until end of turn?

Implementation: needed (modes, modes:repeat_restriction, trigger:batch, trigger:subject, field:damage_target.excludeWho, field:damage_target.source, field:damage_target.who, field:move_card_zone.position, field:move_card_zone.saveAs, step:permission_to_play, field:permission_to_play.what)

### Sarkhan the Masterless

Type: Legendary Planeswalker — Sarkhan

Oracle text:

> Whenever a creature attacks you or a planeswalker you control, each Dragon you control deals 1 damage to that creature.
> +1: Until end of turn, each planeswalker you control becomes a 4/4 red Dragon creature and gains flying.
> −3: Create a 4/4 red Dragon creature token with flying.

Re-rendered plain English:

```
Sarkhan the Masterless [draft]
  [a1] triggered [needed: needs ref:iterated, trigger:subject, trigger:defender, step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, field:damage_target.source]
    Oracle: Whenever a creature attacks you or a planeswalker you control, each Dragon you control deals 1 damage to that creature.
    Trigger: Whenever a creature an opponent controls attacks you or a planeswalker you control
    Effect: For each Dragon you control, that object deals 1 damage to that object.
  [a2] activated [needed: needs timing, cost:loyalty, step:grant_effect, field:grant_effect.all, field:grant_effect.filter, field:grant_effect.modify]
    Oracle: +1: Until end of turn, each planeswalker you control becomes a 4/4 red Dragon creature and gains flying.
    Cost: +1
    Timing: sorcery; 1 per turn
    Effect: The target becomes a creature dragon in addition to its other types and is red and has base power and toughness 4/4 and gains flying until end of turn.
  [a3] activated [needed: needs timing, cost:loyalty, field:create_tokens.tokenKeywords]
    Oracle: −3: Create a 4/4 red Dragon creature token with flying.
    Cost: −3
    Timing: sorcery; 1 per turn
    Effect: Create a 4/4 red Dragon creature token with flying.
```

Player prompts:

- (none: no decisions)

Implementation: needed (ref:iterated, trigger:subject, trigger:defender, step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, field:damage_target.source, timing, cost:loyalty, step:grant_effect, field:grant_effect.all, field:grant_effect.filter, field:grant_effect.modify, field:create_tokens.tokenKeywords)

### Sarkhan, Dragon Ascendant

Type: Legendary Creature — Human Druid

Oracle text:

> When Sarkhan enters, you may behold a Dragon. If you do, create a Treasure token. (To behold a Dragon, choose a Dragon you control or reveal a Dragon card from your hand.)
> Whenever a Dragon you control enters, put a +1/+1 counter on Sarkhan. Until end of turn, Sarkhan becomes a Dragon in addition to its other types and gains flying.

Re-rendered plain English:

```
Sarkhan, Dragon Ascendant [draft]
  [a1] triggered [needed: needs step:choose, field:choose.behold, field:choose.count, field:choose.from, field:choose.saveAs, predicate:paid_additional_cost]
    Oracle: When Sarkhan enters, you may behold a Dragon. If you do, create a Treasure token. (To behold a Dragon, choose a Dragon you control or reveal a Dragon card from your hand.)
    Trigger: Whenever Sarkhan, Dragon Ascendant enters
    Effect: You may choose a Dragon you control or Dragon card in your hand. Then, IF the additional cost (behold a Dragon) was paid: create a ?/? colorless Treasure artifact token.
  [a2] triggered [needed: needs trigger:subject, step:add_counters, field:add_counters.on, step:grant_effect, field:grant_effect.modify]
    Oracle: Whenever a Dragon you control enters, put a +1/+1 counter on Sarkhan. Until end of turn, Sarkhan becomes a Dragon in addition to its other types and gains flying.
    Trigger: Whenever a Dragon you control enters
    Effect: Put a +1/+1 counter on Sarkhan, Dragon Ascendant. Then, Sarkhan, Dragon Ascendant becomes a dragon in addition to its other types and gains flying until end of turn.
```

Player prompts:

- Sarkhan, Dragon Ascendant: optional: Do you want to choose a Dragon you control or Dragon card in your hand?

Implementation: needed (step:choose, field:choose.behold, field:choose.count, field:choose.from, field:choose.saveAs, predicate:paid_additional_cost, trigger:subject, step:add_counters, field:add_counters.on, step:grant_effect, field:grant_effect.modify)

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

### Shivan Devastator

Type: Creature — Dragon Hydra

Oracle text:

> Flying, haste
> This creature enters with X +1/+1 counters on it.

Re-rendered plain English:

```
Shivan Devastator [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] keyword [implemented]
    Oracle: Haste
    Keyword: haste
  [a3] replacement [needed: needs replacement:would_enter, step:add_counters, quantity:X, field:add_counters.counterPT, field:add_counters.on]
    Oracle: This creature enters with X +1/+1 counters on it.
    Replacement: If Shivan Devastator would enter, also: put X +1/+1 counters on Shivan Devastator
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter, step:add_counters, quantity:X, field:add_counters.counterPT, field:add_counters.on)

### Skyline Despot

Type: Creature — Dragon

Oracle text:

> Flying
> When this creature enters, you become the monarch.
> At the beginning of your upkeep, if you're the monarch, create a 5/5 red Dragon creature token with flying.

Re-rendered plain English:

```
Skyline Despot [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs scripted:become_monarch]
    Oracle: When this creature enters, you become the monarch.
    Trigger: Whenever Skyline Despot enters
    Scripted (engine-specific rule, not described by the fields above): become_monarch
  [a3] triggered [needed: needs trigger:intervening_if, predicate:stat, field:create_tokens.tokenKeywords]
    Oracle: At the beginning of your upkeep, if you're the monarch, create a 5/5 red Dragon creature token with flying.
    Trigger: At the beginning of your upkeep, if the controller of Skyline Despot is the monarch
    Effect: Create a 5/5 red Dragon creature token with flying.
```

Player prompts:

- (none: no decisions)

Implementation: needed (scripted:become_monarch, trigger:intervening_if, predicate:stat, field:create_tokens.tokenKeywords)

### Spinerock Knoll

Type: Land

Oracle text:

> Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
> This land enters tapped.
> {T}: Add {R}.
> {R}, {T}: You may play the exiled card without paying its mana cost if an opponent was dealt 7 or more damage this turn.

Re-rendered plain English:

```
Spinerock Knoll [draft]
  [a1] triggered [needed: needs step:look_top, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, field:move_card_zone.faceDown, field:move_card_zone.linkExile, field:move_card_zone.order, field:move_card_zone.position, field:move_card_zone.what]
    Oracle: Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
    Trigger: Whenever Spinerock Knoll enters
    Effect: Look at the top four cards of your library. Then, choose a card from among the looked-at cards. Then, exile the chosen object face down. Then, put the rest of the looked-at cards on the bottom of your library in a random order.
    Keyword: hideaway 4
  [a2] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped.
    Replacement: If Spinerock Knoll would enter, it enters tapped
  [a3] mana [implemented]
    Oracle: {T}: Add {R}.
    Cost: {T}
    Mana: add {R}
  [a4] activated [needed: needs ref:linked_exile, step:permission_to_play, field:permission_to_play.what, field:permission_to_play.withoutPaying]
    Oracle: {R}, {T}: You may play the exiled card without paying its mana cost if an opponent was dealt 7 or more damage this turn.
    Cost: {R}, {T}
    Effect: IF an opponent deals damage this turn: you may you may play linked_exile without paying its mana cost.
```

Player prompts:

- Spinerock Knoll: choose: Choose a card from among the looked-at cards.
- Spinerock Knoll: optional: Do you want to you may play linked_exile without paying its mana cost?

Implementation: needed (step:look_top, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, field:move_card_zone.faceDown, field:move_card_zone.linkExile, field:move_card_zone.order, field:move_card_zone.position, field:move_card_zone.what, replacement:would_enter, ref:linked_exile, step:permission_to_play, field:permission_to_play.what, field:permission_to_play.withoutPaying)

### Stormscale Scion

Type: Creature — Dragon

Oracle text:

> Flying
> Other Dragons you control get +1/+1.
> Storm (When you cast this spell, copy it for each spell cast before it this turn. Copies become tokens.)

Re-rendered plain English:

```
Stormscale Scion [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] static [needed: needs static]
    Oracle: Other Dragons you control get +1/+1.
    Static: Other Dragons you control get +1/+1
  [a3] triggered (from stack) [needed: needs scripted:storm, zone:stack, step:copy, field:copy.count, field:copy.token]
    Oracle: Storm (When you cast this spell, copy it for each spell cast before it this turn. Copies become tokens.)
    Trigger: Whenever a player casts Stormscale Scion
    Effect: Copy Stormscale Scion.
    Scripted (engine-specific rule, not described by the fields above): storm
    Keyword: storm
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, scripted:storm, zone:stack, step:copy, field:copy.count, field:copy.token)

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

### Terror of Mount Velus

Type: Creature — Dragon

Oracle text:

> Flying
> Double strike (This creature deals both first-strike and regular combat damage.)
> When this creature enters, creatures you control gain double strike until end of turn.

Re-rendered plain English:

```
Terror of Mount Velus [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] keyword [implemented]
    Oracle: Double strike
    Keyword: double_strike
  [a3] triggered [needed: needs step:grant_effect, field:grant_effect.all, field:grant_effect.filter, field:grant_effect.modify]
    Oracle: When this creature enters, creatures you control gain double strike until end of turn.
    Trigger: Whenever Terror of Mount Velus enters
    Effect: The target gains double strike until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (step:grant_effect, field:grant_effect.all, field:grant_effect.filter, field:grant_effect.modify)

### The Elder Dragon War

Type: Enchantment — Saga

Oracle text:

> Read ahead (Choose a chapter and start with that many lore counters. Add one after your draw step. Skipped chapters don't trigger. Sacrifice after III.)
> I — This Saga deals 2 damage to each creature and each opponent.
> II — Discard any number of cards, then draw that many cards.
> III — Create a 4/4 red Dragon creature token with flying.

Re-rendered plain English:

```
The Elder Dragon War [draft]
  [a1] keyword [needed: needs scripted:read_ahead]
    Oracle: Read ahead
    Scripted (engine-specific rule, not described by the fields above): read_ahead
    Keyword: read_ahead
  [a2] triggered [needed: needs trigger:counter_put, trigger:chapters, field:damage_target.all, field:damage_target.alsoWho, field:damage_target.filter, field:damage_target.source]
    Oracle: I — This Saga deals 2 damage to each creature and each opponent.
    Trigger: Chapter I
    Effect: The Elder Dragon War deals 2 damage to the target.
  [a3] triggered [needed: needs trigger:counter_put, trigger:chapters, quantity:X, field:discard.min, field:discard.saveAs, field:discard.upTo]
    Oracle: II — Discard any number of cards, then draw that many cards.
    Trigger: Chapter II
    Effect: Discard X cards. Then, draw X cards.
  [a4] triggered [needed: needs trigger:counter_put, trigger:chapters, field:create_tokens.tokenKeywords]
    Oracle: III — Create a 4/4 red Dragon creature token with flying.
    Trigger: Chapter III
    Effect: Create a 4/4 red Dragon creature token with flying.
```

Player prompts:

- The Elder Dragon War: discard: Choose X cards to discard.

Implementation: needed (scripted:read_ahead, trigger:counter_put, trigger:chapters, field:damage_target.all, field:damage_target.alsoWho, field:damage_target.filter, field:damage_target.source, quantity:X, field:discard.min, field:discard.saveAs, field:discard.upTo, field:create_tokens.tokenKeywords)

### The Misty Mountains Cold

Type: Enchantment — Saga

Oracle text:

> (As this Saga enters and after your draw step, add a lore counter. Sacrifice after IV.)
> I, II, III, IV — Create a Treasure token. Then if you control four or more Treasures, sacrifice this Saga. If you do, create a 6/6 red Dragon creature token with flying.

Re-rendered plain English:

```
The Misty Mountains Cold [draft]
  [a1] triggered [needed: needs trigger:counter_put, trigger:chapters, field:create_tokens.tokenKeywords, predicate:step_done]
    Oracle: I, II, III, IV — Create a Treasure token. Then if you control four or more Treasures, sacrifice this Saga. If you do, create a 6/6 red Dragon creature token with flying.
    Trigger: Chapter I, II, III, IV
    Effect: Create a ?/? colorless Treasure artifact token. Then, IF you control four or more Treasures: sacrifice a permanent. Then, IF you did (sac): create a 6/6 red Dragon creature token with flying.
```

Player prompts:

- The Misty Mountains Cold: sacrifice: Choose a permanent to sacrifice.

Implementation: needed (trigger:counter_put, trigger:chapters, field:create_tokens.tokenKeywords, predicate:step_done)

### Thundermane Dragon

Type: Creature — Dragon

Oracle text:

> Flying
> You may look at the top card of your library any time.
> You may cast creature spells with power 4 or greater from the top of your library. If you cast a creature spell this way, it gains haste until end of turn.

Re-rendered plain English:

```
Thundermane Dragon [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] static [needed: needs static]
    Oracle: You may look at the top card of your library any time.
    Static: You have look_at_top_card_of_library_any_time
    (optional: Do you want to use this ability?)
  [a3] static [needed: needs static, step:grant_effect, field:grant_effect.modify, predicate:all, predicate:cast_from, predicate:matches]
    Oracle: You may cast creature spells with power 4 or greater from the top of your library. If you cast a creature spell this way, it gains haste until end of turn.
    Effect: IF it was cast from library and that object is a creature with power 4 or greater: that object gains haste until end of turn.
    Static: You have cast_creature_spells_with_power_4_or_greater_from_top_of_library
    (optional: Do you want to that object gains haste until end of turn?)
```

Player prompts:

- Thundermane Dragon: optional: Do you want to use this ability?
- Thundermane Dragon: optional: Do you want to that object gains haste until end of turn?

Implementation: needed (static, step:grant_effect, field:grant_effect.modify, predicate:all, predicate:cast_from, predicate:matches)

### Tyrant's Familiar

Type: Creature — Dragon

Oracle text:

> Flying, haste
> Lieutenant — As long as you control your commander, this creature gets +2/+2 and has "Whenever this creature attacks, it deals 7 damage to target creature defending player controls."

Re-rendered plain English:

```
Tyrant's Familiar [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] keyword [implemented]
    Oracle: Haste
    Keyword: haste
  [a3] static [needed: needs static, filter:defending_player, filter:isCommander]
    Oracle: Lieutenant — As long as you control your commander, this creature gets +2/+2 and has "Whenever this creature attacks, it deals 7 damage to target creature defending player controls."
    Static: Tyrant's Familiar gets +2/+2 and has an ability as long as you control a commander permanent
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, filter:defending_player, filter:isCommander)

### Unexpected Windfall

Type: Instant

Oracle text:

> As an additional cost to cast this spell, discard a card.
> Draw two cards and create two Treasure tokens. (They're artifacts with "{T}, Sacrifice this token: Add one mana of any color.")

Re-rendered plain English:

```
Unexpected Windfall [draft]
  Cast option c1: you may use additional (from hand, cost discard a card in your hand) [needed]
  [a1] cast_option [needed: needs cast_option]
    Oracle: As an additional cost to cast this spell, discard a card.
  [a2] spell_effect [implemented]
    Oracle: Draw two cards and create two Treasure tokens.
    Effect: Draw 2 cards. Then, create two ?/? colorless Treasure artifact tokens.
```

Player prompts:

- Unexpected Windfall: additional cost: Choose how to pay the additional cost (discard a card in your hand).

Implementation: needed (cast_option, cast_option:additional, cast_option:mandatory, cost:discard)

### Draconic Visitor

Type: Creature — Dragon

Oracle text:

> Flying
> If one or more artifact tokens would be created under your control, that many 5/5 red Dragon creature tokens with flying are created instead.

Re-rendered plain English:

```
Draconic Visitor [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] replacement [needed: needs replacement:would_create_token, quantity:event_amount, field:create_tokens.tokenKeywords]
    Oracle: If one or more artifact tokens would be created under your control, that many 5/5 red Dragon creature tokens with flying are created instead.
    Replacement: If a token artifact you control would create token, instead: create that many 5/5 red Dragon creature tokens with flying
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_create_token, quantity:event_amount, field:create_tokens.tokenKeywords)

## Kernel to-do: missing capabilities across this deck

| capability | cards | needing it |
|---|---|---|
| `field:damage_target.source` | 13 | Chandra's Ignition; Dragon Tempest; Dragonhawk, Fate's Tempest; Drakuseth, Maw of Flames; Firespitter Whelp; Leyline Tyrant; Outpost Siege; Parapet Thrasher; Sarkhan the Masterless; Scourge of Valkas; The Elder Dragon War; Thunderbreak Regent; Warstorm Surge |
| `trigger:subject` | 13 | Lathliss, Dragon Queen; Breaching Dragonstorm; Dragon Tempest; Dragon's Hoard; Firespitter Whelp; Outpost Siege; Parapet Thrasher; Sarkhan the Masterless; Sarkhan, Dragon Ascendant; Scourge of Valkas; Thunderbreak Regent; Utvara Hellkite; Warstorm Surge |
| `static` | 12 | Basilisk Collar; Crucible of Fire; Dragonlord's Servant; Dragonspeaker Shaman; Gadrak, the Crown-Scourge; Hazoret's Monument; Leyline Tyrant; Nogi, Draco-Zealot; Stormscale Scion; Swiftfoot Boots; Thundermane Dragon; Tyrant's Familiar |
| `field:create_tokens.tokenKeywords` | 9 | Lathliss, Dragon Queen; Dragonmaster Outcast; Magda, the Hoardmaster; Sarkhan the Masterless; Skyline Despot; The Elder Dragon War; The Misty Mountains Cold; Utvara Hellkite; Draconic Visitor |
| `field:move_card_zone.position` | 8 | Atsushi, the Blazing Sky; Breaching Dragonstorm; Count on Luck; Dragonhawk, Fate's Tempest; Orb of Dragonkind; Outpost Siege; Parapet Thrasher; Spinerock Knoll |
| `field:grant_effect.modify` | 7 | Carnelian Orb of Dragonkind; Dragon Tempest; Nogi, Draco-Zealot; Sarkhan the Masterless; Sarkhan, Dragon Ascendant; Terror of Mount Velus; Thundermane Dragon |
| `field:permission_to_play.what` | 7 | Atsushi, the Blazing Sky; Breaching Dragonstorm; Count on Luck; Dragonhawk, Fate's Tempest; Outpost Siege; Parapet Thrasher; Spinerock Knoll |
| `replacement:would_enter` | 7 | Cursed Mirror; Dragonstorm Globe; Fire Diamond; Forgotten Cave; Outpost Siege; Shivan Devastator; Spinerock Knoll |
| `step:grant_effect` | 7 | Carnelian Orb of Dragonkind; Dragon Tempest; Nogi, Draco-Zealot; Sarkhan the Masterless; Sarkhan, Dragon Ascendant; Terror of Mount Velus; Thundermane Dragon |
| `step:permission_to_play` | 7 | Atsushi, the Blazing Sky; Breaching Dragonstorm; Count on Luck; Dragonhawk, Fate's Tempest; Outpost Siege; Parapet Thrasher; Spinerock Knoll |
| `field:add_counters.on` | 6 | Dragon's Hoard; Dragonstorm Globe; Sarkhan, Dragon Ascendant; Scourge of the Throne; Shivan Devastator; Taurean Mauler |
| `field:damage_target.all` | 6 | Blasphemous Act; Breath Weapon; Chandra's Ignition; Desolation of Smaug; Magmaquake; The Elder Dragon War |
| `field:damage_target.filter` | 6 | Blasphemous Act; Breath Weapon; Chandra's Ignition; Desolation of Smaug; Magmaquake; The Elder Dragon War |
| `field:move_card_zone.saveAs` | 6 | Atsushi, the Blazing Sky; Breaching Dragonstorm; Count on Luck; Dragonhawk, Fate's Tempest; Outpost Siege; Parapet Thrasher |
| `mana:variable` | 6 | Arcane Signet; Commander's Sphere; Dragon's Hoard; Dragonstorm Globe; Haven of the Spirit Dragon; Orb of Dragonkind |
| `step:add_counters` | 6 | Dragon's Hoard; Dragonstorm Globe; Sarkhan, Dragon Ascendant; Scourge of the Throne; Shivan Devastator; Taurean Mauler |
| `field:damage_target.who` | 5 | Chandra's Ignition; Dragonhawk, Fate's Tempest; Firespitter Whelp; Parapet Thrasher; Thunderbreak Regent |
| `trigger:intervening_if` | 5 | Dragonmaster Outcast; Nogi, Draco-Zealot; Outpost Siege; Scourge of the Throne; Skyline Despot |
| `cost:sacrifice` | 4 | Commander's Sphere; Haven of the Spirit Dragon; Magda, the Hoardmaster; Orb of Dragonkind |
| `predicate:matches` | 4 | Breaching Dragonstorm; Carnelian Orb of Dragonkind; Chaos Warp; Thundermane Dragon |
| `predicate:paid_additional_cost` | 4 | Hazoret's Monument; Hellkite Charger; Leyline Tyrant; Sarkhan, Dragon Ascendant |
| `quantity:X` | 4 | Leyline Tyrant; Magmaquake; Shivan Devastator; The Elder Dragon War |
| `step:choose` | 4 | Orb of Dragonkind; Outpost Siege; Sarkhan, Dragon Ascendant; Spinerock Knoll |
| `field:choose.count` | 3 | Orb of Dragonkind; Sarkhan, Dragon Ascendant; Spinerock Knoll |
| `field:choose.from` | 3 | Orb of Dragonkind; Sarkhan, Dragon Ascendant; Spinerock Knoll |
| `field:choose.saveAs` | 3 | Orb of Dragonkind; Sarkhan, Dragon Ascendant; Spinerock Knoll |
| `modes` | 3 | Abrade; Atsushi, the Blazing Sky; Parapet Thrasher |
| `quantity:count` | 3 | Dragon Tempest; Mana Geyser; Scourge of Valkas |
| `step:copy` | 3 | Cursed Mirror; Goldlust Triad; Stormscale Scion |
| `timing` | 3 | Bonders' Enclave; Sarkhan the Masterless; Temple of the False God |
| `cast_option` | 2 | Blasphemous Act; Unexpected Windfall |
| `cost:discard` | 2 | Forgotten Cave; Unexpected Windfall |
| `field:add_mana.produces` | 2 | Desolation of Smaug; Mana Geyser |
| `field:attach.to` | 2 | Basilisk Collar; Swiftfoot Boots |
| `field:attach.what` | 2 | Basilisk Collar; Swiftfoot Boots |
| `field:choose.fromLooked` | 2 | Orb of Dragonkind; Spinerock Knoll |
| `field:copy.token` | 2 | Goldlust Triad; Stormscale Scion |
| `field:grant_effect.all` | 2 | Sarkhan the Masterless; Terror of Mount Velus |
| `field:grant_effect.filter` | 2 | Sarkhan the Masterless; Terror of Mount Velus |
| `field:move_card_zone.order` | 2 | Orb of Dragonkind; Spinerock Knoll |
| `field:move_card_zone.what` | 2 | Orb of Dragonkind; Spinerock Knoll |
| `field:permission_to_play.withoutPaying` | 2 | Breaching Dragonstorm; Spinerock Knoll |
| `field:untap_target.all` | 2 | Hellkite Charger; Scourge of the Throne |
| `field:untap_target.filter` | 2 | Hellkite Charger; Scourge of the Throne |
| `filter:notSubtypes` | 2 | Breath Weapon; Desolation of Smaug |
| `mana:restriction` | 2 | Haven of the Spirit Dragon; Orb of Dragonkind |
| `quantity:stat` | 2 | Chandra's Ignition; Warstorm Surge |
| `step:add_mana` | 2 | Desolation of Smaug; Mana Geyser |
| `step:attach` | 2 | Basilisk Collar; Swiftfoot Boots |
| `step:extra_combat` | 2 | Hellkite Charger; Scourge of the Throne |
| `step:look_top` | 2 | Orb of Dragonkind; Spinerock Knoll |
| `step:reveal` | 2 | Chaos Warp; Orb of Dragonkind |
| `trigger:chapters` | 2 | The Elder Dragon War; The Misty Mountains Cold |
| `trigger:counter_put` | 2 | The Elder Dragon War; The Misty Mountains Cold |
| `trigger:nth` | 2 | Magda, the Hoardmaster; Scourge of the Throne |
| `cast_option:additional` | 1 | Unexpected Windfall |
| `cast_option:mandatory` | 1 | Unexpected Windfall |
| `cost_reduction` | 1 | Blasphemous Act |
| `cost:counters` | 1 | Dragon's Hoard |
| `cost:life` | 1 | War Room |
| `cost:loyalty` | 1 | Sarkhan the Masterless |
| `duration:until_end_of_your_next_turn` | 1 | Atsushi, the Blazing Sky |
| `duration:until_your_next_end_step` | 1 | Dragonhawk, Fate's Tempest |
| `field:add_counters.counterPT` | 1 | Shivan Devastator |
| `field:add_mana.srcs` | 1 | Desolation of Smaug |
| `field:choose.behold` | 1 | Sarkhan, Dragon Ascendant |
| `field:choose.choice` | 1 | Outpost Siege |
| `field:choose.options` | 1 | Outpost Siege |
| `field:choose.remember` | 1 | Outpost Siege |
| `field:copy.attacking` | 1 | Goldlust Triad |
| `field:copy.count` | 1 | Stormscale Scion |
| `field:copy.exceptGrant` | 1 | Cursed Mirror |
| `field:copy.exileAt` | 1 | Goldlust Triad |
| `field:copy.forEach` | 1 | Goldlust Triad |
| `field:copy.of` | 1 | Cursed Mirror |
| `field:copy.tapped` | 1 | Goldlust Triad |
| `field:create_delayed_trigger.at` | 1 | Dragonhawk, Fate's Tempest |
| `field:create_delayed_trigger.steps` | 1 | Dragonhawk, Fate's Tempest |
| `field:create_tokens.tokenTapped` | 1 | Magda, the Hoardmaster |
| `field:damage_target.alsoWho` | 1 | The Elder Dragon War |
| `field:damage_target.excludeWho` | 1 | Parapet Thrasher |
| `field:damage_target.from` | 1 | Dragonhawk, Fate's Tempest |
| `field:damage_target.optionalCost` | 1 | Leyline Tyrant |
| `field:discard.min` | 1 | The Elder Dragon War |
| `field:discard.saveAs` | 1 | The Elder Dragon War |
| `field:discard.upTo` | 1 | The Elder Dragon War |
| `field:if_else.if` | 1 | Chaos Warp |
| `field:if_else.then` | 1 | Chaos Warp |
| `field:mass_pump.filter` | 1 | Lathliss, Dragon Queen |
| `field:move_card_zone.faceDown` | 1 | Spinerock Knoll |
| `field:move_card_zone.linkExile` | 1 | Spinerock Knoll |
| `field:move_card_zone.shuffle` | 1 | Chaos Warp |
| `field:move_card_zone.until` | 1 | Breaching Dragonstorm |
| `field:move_card_zone.who` | 1 | Chaos Warp |
| `field:repeat_for_each.over` | 1 | Sarkhan the Masterless |
| `field:repeat_for_each.steps` | 1 | Sarkhan the Masterless |
| `field:reveal.saveAs` | 1 | Chaos Warp |
| `field:reveal.what` | 1 | Chaos Warp |
| `field:reveal.who` | 1 | Chaos Warp |
| `field:search_library.count` | 1 | Sarkhan's Triumph |
| `field:search_library.filter` | 1 | Sarkhan's Triumph |
| `field:search_library.reveal` | 1 | Sarkhan's Triumph |
| `field:search_library.shuffle` | 1 | Sarkhan's Triumph |
| `field:search_library.to` | 1 | Sarkhan's Triumph |
| `field:untap_target.optionalCost` | 1 | Hellkite Charger |
| `filter:defending_player` | 1 | Tyrant's Familiar |
| `filter:isCommander` | 1 | Tyrant's Familiar |
| `filter:without` | 1 | Magmaquake |
| `modes:repeat_restriction` | 1 | Parapet Thrasher |
| `predicate:all` | 1 | Thundermane Dragon |
| `predicate:cast_from` | 1 | Thundermane Dragon |
| `predicate:chosen_is` | 1 | Outpost Siege |
| `predicate:most_life` | 1 | Scourge of the Throne |
| `predicate:stat` | 1 | Skyline Despot |
| `predicate:step_done` | 1 | The Misty Mountains Cold |
| `quantity:count_this_turn` | 1 | Gadrak, the Crown-Scourge |
| `quantity:event_amount` | 1 | Draconic Visitor |
| `quantity:math` | 1 | Dragonhawk, Fate's Tempest |
| `ref:iterated` | 1 | Sarkhan the Masterless |
| `ref:linked_exile` | 1 | Spinerock Knoll |
| `replacement:would_create_token` | 1 | Draconic Visitor |
| `scripted:become_monarch` | 1 | Skyline Despot |
| `scripted:myriad` | 1 | Goldlust Triad |
| `scripted:read_ahead` | 1 | The Elder Dragon War |
| `scripted:storm` | 1 | Stormscale Scion |
| `step:create_delayed_trigger` | 1 | Dragonhawk, Fate's Tempest |
| `step:if_else` | 1 | Chaos Warp |
| `step:repeat_for_each` | 1 | Sarkhan the Masterless |
| `step:search_library` | 1 | Sarkhan's Triumph |
| `targets:multi` | 1 | Drakuseth, Maw of Flames |
| `trigger:batch` | 1 | Parapet Thrasher |
| `trigger:becomes_target` | 1 | Thunderbreak Regent |
| `trigger:commit_crime` | 1 | Magda, the Hoardmaster |
| `trigger:defender` | 1 | Sarkhan the Masterless |
| `trigger:leaves` | 1 | Outpost Siege |
| `trigger:multi_event` | 1 | Dragonhawk, Fate's Tempest |
| `zone:hand` | 1 | Forgotten Cave |
| `zone:stack` | 1 | Stormscale Scion |

## Decisions

- Consolidated schema pass: the workarounds reported by the five pilot decks (sentinels, review.ignore hacks, scripted stubs, placeholder refs) now use real fields; see src/kernel/SCHEMA_CHANGELOG.md.
- Monarch stays a scripted marker (become_monarch + the controller_is_monarch stat) by user decision; Crew, Improvise, Myriad, Storm, Read ahead, Manifest dread, Reselect attack target and tapped-for-{C} stay scripted markers (vocabulary listed in the changelog).
- Remaining genuine card-behaviour questions are collected in data/kernel-drafts/CONSOLIDATED_QUESTIONS.md, not per deck.
