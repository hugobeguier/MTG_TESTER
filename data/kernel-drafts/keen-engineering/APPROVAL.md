# Kernel draft approval: Keen Engineering

67 unique cards: 43 simple (A), 24 complex (B). Validator: 67/67 pass. Cards with implementation "needed": 59. All drafts are `review.status: "draft"`; nothing was written to the DB.

Reading guide: each card below shows the oracle text and what the structured JSON says back in plain English. Approve if they match.

## (A) Simple cards: spot-check one line each

- **Sai, Master Thopterist** (Legendary Creature — Human Artificer): Whenever you cast an artifact spell: Create a 1/1 colorless Thopter artifact creature token with flying | {1}{U}, sacrifice 2 artifacts you control: Draw a card [needs: field:create_tokens.tokenKeywords, cost:sacrifice]
- **All Is Dust** (Kindred Sorcery — Eldrazi): Each player sacrifices a colored permanent [needs: filter:colored, field:sacrifice_permanent.all, field:sacrifice_permanent.filter, field:sacrifice_permanent.who]
- **Broodstar** (Creature — Beast): Keyword affinity artifacts | Keyword flying | Broodstar has power and toughness each equal to the number of artifacts you control [needs: cost_reduction, static, static:setBasePT]
- **Master of Etherium** (Artifact Creature — Vedalken Wizard): Master of Etherium has power and toughness each equal to the number of artifacts you control | Other artifact creatures you control get +1/+1 [needs: static, static:setBasePT]
- **Master Transmuter** (Artifact Creature — Human Artificer): {U}, {T}, return an artifact you control to its owner's hand: You may choose an artifact card in your hand, then put the chosen object onto the battlefield [needs: cost:returnToHand, step:choose, field:choose.count, field:choose.from, field:choose.saveAs]
- **Misleading Signpost** (Artifact): Keyword flash | Whenever Misleading Signpost enters, if it is the declare attackers step: [targets: target attacking creature] Reselect attack target | {T}: add {U} [needs: trigger:intervening_if, predicate:phase_is, step:reselect_attack_target]
- **Research Thief** (Artifact Creature — Moonfolk Wizard): Keyword flash | Keyword flying | Whenever an artifact creature you control deals combat damage to a player: Draw a card [needs: trigger:subject]
- **Thought Monitor** (Artifact Creature — Construct): Keyword affinity artifacts | Keyword flying | Whenever Thought Monitor enters: Draw 2 cards [needs: cost_reduction]
- **Vedalken Archmage** (Creature — Vedalken Wizard): Whenever you cast an artifact spell: Draw a card [implemented]
- **Adaptive Omnitool** (Artifact — Equipment): The equipped creature gets +X/+X, where X is the number of artifacts you control | Whenever the equipped creature attacks: Look at the top six cards of your library, then you may choose an artifact card from among the looked-at cards, then reveal the chosen object, then put the chosen object into your hand, then put the rest of the looked-at cards on the bottom of your library in a random order | {3}: [targets: target creature you control] Attach Adaptive Omnitool to target creature you control [needs: static, trigger:subject, step:look_top, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, step:reveal, field:move_card_zone.order, field:move_card_zone.position, field:move_card_zone.what, step:attach, field:attach.to, field:attach.what]
- **Nettlecyst** (Artifact — Equipment): Whenever Nettlecyst enters: Create a 0/0 black Phyrexian Germ creature token, then attach Nettlecyst to the token just created | The equipped creature gets +X/+X, where X is the number of artifacts or enchantments you control | {2}: [targets: target creature you control] Attach Nettlecyst to target creature you control [needs: ref:created, step:attach, field:attach.to, field:attach.what, static]
- **Nevinyrral's Disk** (Artifact): If Nevinyrral's Disk would enter, it enters tapped | {1}, {T}: Destroy each artifact, creature, or enchantment [needs: replacement:would_enter, field:destroy_all.filter]
- **Scrawling Crawler** (Artifact Creature — Phyrexian Construct): At the beginning of your upkeep: Each player draws a card | Whenever an opponent draws a card: That player loses 1 life [needs: field:draw_cards.who, trigger:draw, field:life_change.who]
- **Steel Overseer** (Artifact Creature — Construct): {T}: For each artifact creature you control, put a +1/+1 counter on that object [needs: ref:iterated, step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, step:add_counters, field:add_counters.on]
- **War Room** (Land): {T}: add {C} | {3}, {T}, pay life equal to the number of colors in your commanders' color identity: Draw a card [needs: cost:life]
- **Aetherize** (Instant): Return all attacking creatures to their owners' hands [needs: field:mass_bounce.filter]
- **Counterspell** (Instant): [targets: target spell] Counter target spell [needs: step:counter_spell]
- **Etherium Sculptor** (Artifact Creature — Vedalken Artificer): Artifact spells you cast cost {1} less to cast [needs: static]
- **Launch Mishap** (Instant): [targets: target creature spell or planeswalker spell] Counter target creature spell or planeswalker spell, then create a 1/1 colorless Thopter artifact creature token with flying [needs: step:counter_spell, field:create_tokens.tokenKeywords]
- **Memory Guardian** (Artifact Creature — Robot Artificer): Keyword affinity artifacts | Keyword flying [needs: cost_reduction]
- **Negate** (Instant): [targets: target noncreature spell] Counter target noncreature spell [needs: step:counter_spell]
- **Tamiyo's Logbook** (Artifact — Book): {5}{U}, {T}: Draw a card (costs {1} less for each other artifact you control) [needs: cost_reduction]
- **Thoughtcast** (Sorcery): Keyword affinity artifacts | Draw 2 cards [needs: cost_reduction]
- **Whirler Rogue** (Creature — Human Rogue Artificer): Whenever Whirler Rogue enters: Create two 1/1 colorless Thopter artifact creature tokens with flying | tap 2 untapped artifacts you control: [targets: target creature] Target creature can't be blocked until end of turn [needs: field:create_tokens.tokenKeywords, cost:tapOther, step:grant_effect, field:grant_effect.modify]
- **Aether Spellbomb** (Artifact): {U}, sacrifice Aether Spellbomb: [targets: target creature] Return target creature to its owner's hand | {1}, sacrifice Aether Spellbomb: Draw a card [needs: cost:sacrifice]
- **Arcane Signet** (Artifact): {T}: add one mana of any color in your commander's color identity [needs: mana:variable]
- **Chief of the Foundry** (Artifact Creature — Construct): Other artifact creatures you control get +1/+1 [needs: static]
- **Foundry Inspector** (Artifact Creature — Construct): Artifact spells you cast cost {1} less to cast [needs: static]
- **Hedron Archive** (Artifact): {T}: add {C}{C} | {2}, {T}, sacrifice Hedron Archive: Draw 2 cards [needs: cost:sacrifice]
- **Ichor Wellspring** (Artifact): Whenever Ichor Wellspring enters or is put into a graveyard from the battlefield: Draw a card [needs: trigger:multi_event, trigger:leaves, trigger:zones]
- **Meteor Golem** (Artifact Creature — Golem): Whenever Meteor Golem enters: [targets: target nonland permanent an opponent controls] Destroy target nonland permanent an opponent controls [implemented]
- **Mind Stone** (Artifact): {T}: add {C} | {1}, {T}, sacrifice Mind Stone: Draw a card [needs: cost:sacrifice]
- **Ornithopter of Paradise** (Artifact Creature — Thopter): Keyword flying | {T}: add one mana of any color [needs: mana:variable]
- **Palladium Myr** (Artifact Creature — Myr): {T}: add {C}{C} [implemented]
- **Shimmer Myr** (Artifact Creature — Myr): Keyword flash | You cast artifact spells as though they had flash [needs: static]
- **Silver Myr** (Artifact Creature — Myr): {T}: add {U} [implemented]
- **Sol Ring** (Artifact): {T}: add {C}{C} [implemented]
- **Spire Golem** (Artifact Creature — Golem): Keyword affinity Islands | Keyword flying [needs: cost_reduction]
- **Thought Vessel** (Artifact): You have no maximum hand size | {T}: add {C} [needs: static]
- **Buried Ruin** (Land): {T}: add {C} | {2}, {T}, sacrifice Buried Ruin: [targets: target artifact card in your graveyard] Put target artifact card in your graveyard into your hand [needs: cost:sacrifice]
- **Darksteel Citadel** (Artifact Land): Keyword indestructible | {T}: add {C} [implemented]
- **Foundry of the Consuls** (Land): {T}: add {C} | {5}, {T}, sacrifice Foundry of the Consuls: Create two 1/1 colorless Thopter artifact creature tokens with flying [needs: cost:sacrifice, field:create_tokens.tokenKeywords]
- **Island** (Basic Land — Island): {T}: add {U} [implemented]

## (B) Complex cards

### Kappa Cannoneer

Type: Artifact Creature — Turtle Warrior

Oracle text:

> Improvise (Your artifacts can help cast this spell. Each artifact you tap after you're done activating mana abilities pays for {1}.)
> Ward {4}
> Whenever this creature or another artifact you control enters, put a +1/+1 counter on this creature. It can't be blocked this turn.

Re-rendered plain English:

```
Kappa Cannoneer [draft]
  [a1] keyword [needed: needs scripted:improvise, keyword:improvise]
    Oracle: Improvise (Your artifacts can help cast this spell. Each artifact you tap after you're done activating mana abilities pays for {1}.)
    Scripted (engine-specific rule, not described by the fields above): improvise
    Keyword: improvise
  [a2] triggered [needed: needs trigger:becomes_target, step:counter_spell, step:unless_pay]
    Oracle: Ward {4}
    Trigger: Whenever Kappa Cannoneer becomes the target of a spell or ability
    Effect: Counter that object unless that player pays {4}.
    Keyword: ward 4
  [a3] triggered [needed: needs trigger:subject, step:add_counters, field:add_counters.on, step:grant_effect, field:grant_effect.modify]
    Oracle: Whenever this creature or another artifact you control enters, put a +1/+1 counter on this creature. It can't be blocked this turn.
    Trigger: Whenever an artifact you control enters
    Effect: Put a +1/+1 counter on Kappa Cannoneer. Then, Kappa Cannoneer can't be blocked until end of turn.
```

Player prompts:

- Kappa Cannoneer: pay or not: Do you want to pay {4}? If you don't, counter that object.

Implementation: needed (scripted:improvise, keyword:improvise, trigger:becomes_target, step:counter_spell, step:unless_pay, trigger:subject, step:add_counters, field:add_counters.on, step:grant_effect, field:grant_effect.modify)

### Pull from Tomorrow

Type: Instant

Oracle text:

> Draw X cards, then discard a card.

Re-rendered plain English:

```
Pull from Tomorrow [draft]
  [a1] spell_effect [needed: needs quantity:X]
    Oracle: Draw X cards, then discard a card.
    Effect: Draw X cards. Then, discard a card.
```

Player prompts:

- Pull from Tomorrow: discard: Choose a card to discard.

Implementation: needed (quantity:X)

### Shimmer Dragon

Type: Creature — Dragon

Oracle text:

> Flying
> As long as you control four or more artifacts, this creature has hexproof. (It can't be the target of spells or abilities your opponents control.)
> Tap two untapped artifacts you control: Draw a card.

Re-rendered plain English:

```
Shimmer Dragon [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] static [needed: needs static]
    Oracle: As long as you control four or more artifacts, this creature has hexproof. (It can't be the target of spells or abilities your opponents control.)
    Static: Shimmer Dragon has hexproof as long as you control four or more artifacts
  [a3] activated [needed: needs cost:tapOther]
    Oracle: Tap two untapped artifacts you control: Draw a card.
    Cost: tap 2 untapped artifacts you control
    Effect: Draw a card.
```

Player prompts:

- Shimmer Dragon: choose what to tap: Choose 2 untapped artifacts you control to tap.

Implementation: needed (static, cost:tapOther)

### Thopter Fabricator

Type: Artifact — Vehicle

Oracle text:

> Flying
> Whenever you draw your second card each turn, create a 1/1 colorless Thopter artifact creature token with flying.
> Crew 2

Re-rendered plain English:

```
Thopter Fabricator [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:draw, trigger:nth, field:create_tokens.tokenKeywords]
    Oracle: Whenever you draw your second card each turn, create a 1/1 colorless Thopter artifact creature token with flying.
    Trigger: Whenever you draw your second card each turn
    Effect: Create a 1/1 colorless Thopter artifact creature token with flying.
  [a3] activated [needed: needs scripted:crew, keyword:crew, step:grant_effect, field:grant_effect.modify]
    Oracle: Crew 2
    Effect: Thopter Fabricator becomes an artifact creature in addition to its other types until end of turn.
    Scripted (engine-specific rule, not described by the fields above): crew
    Keyword: crew 2
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:draw, trigger:nth, field:create_tokens.tokenKeywords, scripted:crew, keyword:crew, step:grant_effect, field:grant_effect.modify)

### Thopter Spy Network

Type: Enchantment

Oracle text:

> At the beginning of your upkeep, if you control an artifact, create a 1/1 colorless Thopter artifact creature token with flying.
> Whenever one or more artifact creatures you control deal combat damage to a player, draw a card.

Re-rendered plain English:

```
Thopter Spy Network [draft]
  [a1] triggered [needed: needs trigger:intervening_if, field:create_tokens.tokenKeywords]
    Oracle: At the beginning of your upkeep, if you control an artifact, create a 1/1 colorless Thopter artifact creature token with flying.
    Trigger: At the beginning of your upkeep, if you control an artifact
    Effect: Create a 1/1 colorless Thopter artifact creature token with flying.
  [a2] triggered [needed: needs trigger:batch, trigger:subject]
    Oracle: Whenever one or more artifact creatures you control deal combat damage to a player, draw a card.
    Trigger: Whenever one or more artifact creatures you control deal combat damage to a player
    Effect: Draw a card.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:intervening_if, field:create_tokens.tokenKeywords, trigger:batch, trigger:subject)

### Cultivator's Caravan

Type: Artifact — Vehicle

Oracle text:

> {T}: Add one mana of any color.
> Crew 3 (Tap any number of creatures you control with total power 3 or more: This Vehicle becomes an artifact creature until end of turn.)

Re-rendered plain English:

```
Cultivator's Caravan [draft]
  [a1] mana [needed: needs mana:variable]
    Oracle: {T}: Add one mana of any color.
    Cost: {T}
    Mana: add one mana of any color
  [a2] activated [needed: needs scripted:crew, keyword:crew, step:grant_effect, field:grant_effect.modify]
    Oracle: Crew 3 (Tap any number of creatures you control with total power 3 or more: This Vehicle becomes an artifact creature until end of turn.)
    Effect: Cultivator's Caravan becomes an artifact creature in addition to its other types until end of turn.
    Scripted (engine-specific rule, not described by the fields above): crew
    Keyword: crew 3
```

Player prompts:

- (none: no decisions)

Implementation: needed (mana:variable, scripted:crew, keyword:crew, step:grant_effect, field:grant_effect.modify)

### Darksteel Juggernaut

Type: Artifact Creature — Juggernaut

Oracle text:

> Indestructible
> Darksteel Juggernaut's power and toughness are each equal to the number of artifacts you control.
> This creature attacks each combat if able.

Re-rendered plain English:

```
Darksteel Juggernaut [draft]
  [a1] keyword [implemented]
    Oracle: Indestructible
    Keyword: indestructible
  [a2] static [needed: needs static, static:setBasePT]
    Oracle: Darksteel Juggernaut's power and toughness are each equal to the number of artifacts you control.
    Static: Darksteel Juggernaut has power and toughness each equal to the number of artifacts you control
  [a3] static [needed: needs static, static:mustAttack]
    Oracle: This creature attacks each combat if able.
    Static: Darksteel Juggernaut attacks each combat if able
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, static:setBasePT, static:mustAttack)

### Duplicant

Type: Artifact Creature — Shapeshifter

Oracle text:

> Imprint — When this creature enters, you may exile target nontoken creature.
> As long as a card exiled with this creature is a creature card, this creature has the power, toughness, and creature types of the last creature card exiled with it. It's still a Shapeshifter.

Re-rendered plain English:

```
Duplicant [draft]
  [a1] triggered [needed: needs field:exile_target.linkExile]
    Oracle: Imprint — When this creature enters, you may exile target nontoken creature.
    Trigger: Whenever Duplicant enters
    Target t1: target nontoken creature  <- prompt: "Choose target nontoken creature."
    Effect: You may exile target nontoken creature.
  [a2] static [needed: needs static, ref:linked_exile, static:setBasePT, static:copySubtypesOf]
    Oracle: As long as a card exiled with this creature is a creature card, this creature has the power, toughness, and creature types of the last creature card exiled with it. It's still a Shapeshifter.
    Static: Duplicant has the power and toughness of the card exiled with Duplicant and has the creature types of the card exiled with Duplicant as long as the card exiled with Duplicant is a creature
```

Player prompts:

- Duplicant: choose a target: Choose target nontoken creature.
- Duplicant: optional: Do you want to exile target nontoken creature?

Implementation: needed (field:exile_target.linkExile, static, ref:linked_exile, static:setBasePT, static:copySubtypesOf)

### Forsaken Monument

Type: Legendary Artifact

Oracle text:

> Colorless creatures you control get +2/+2.
> Whenever you tap a permanent for {C}, add an additional {C}.
> Whenever you cast a colorless spell, you gain 2 life.

Re-rendered plain English:

```
Forsaken Monument [draft]
  [a1] static [needed: needs static]
    Oracle: Colorless creatures you control get +2/+2.
    Static: Colorless creatures you control get +2/+2
  [a2] triggered [needed: needs scripted:tapped_for_colorless_mana, trigger:tap, trigger:subject, step:add_mana, field:add_mana.produces]
    Oracle: Whenever you tap a permanent for {C}, add an additional {C}.
    Trigger: Whenever a permanent you control becomes tapped
    Effect: Add {C}.
    Scripted (engine-specific rule, not described by the fields above): tapped_for_colorless_mana
  [a3] triggered [implemented]
    Oracle: Whenever you cast a colorless spell, you gain 2 life.
    Trigger: Whenever you cast a colorless spell
    Effect: Gain 2 life.
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, scripted:tapped_for_colorless_mana, trigger:tap, trigger:subject, step:add_mana, field:add_mana.produces)

### Graaz, Unstoppable Juggernaut

Type: Legendary Artifact Creature — Juggernaut

Oracle text:

> Juggernauts you control attack each combat if able.
> Juggernauts you control can't be blocked by Walls.
> Other creatures you control have base power and toughness 5/3 and are Juggernauts in addition to their other creature types.

Re-rendered plain English:

```
Graaz, Unstoppable Juggernaut [draft]
  [a1] static [needed: needs static, static:mustAttack]
    Oracle: Juggernauts you control attack each combat if able.
    Static: Juggernauts you control attack each combat if able
  [a2] static [needed: needs static]
    Oracle: Juggernauts you control can't be blocked by Walls.
    Static: Juggernauts you control can't be blocked by Walls
  [a3] static [needed: needs static, static:setBasePT, static:addTypes]
    Oracle: Other creatures you control have base power and toughness 5/3 and are Juggernauts in addition to their other creature types.
    Static: Other creatures you control have base power and toughness 5/3 and are juggernauts in addition to their other types
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, static:mustAttack, static:setBasePT, static:addTypes)

### Mazemind Tome

Type: Artifact — Book

Oracle text:

> {T}, Put a page counter on this artifact: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)
> {2}, {T}, Put a page counter on this artifact: Draw a card.
> When there are four or more page counters on this artifact, exile it. If you do, you gain 4 life.

Re-rendered plain English:

```
Mazemind Tome [draft]
  [a1] activated [needed: needs cost:counters, step:scry]
    Oracle: {T}, Put a page counter on this artifact: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)
    Cost: {T}, put a page counter on Mazemind Tome
    Effect: Scry 1.
  [a2] activated [needed: needs cost:counters]
    Oracle: {2}, {T}, Put a page counter on this artifact: Draw a card.
    Cost: {2}, {T}, put a page counter on Mazemind Tome
    Effect: Draw a card.
  [a3] triggered [needed: needs trigger:unspecified, trigger:intervening_if, predicate:stat, predicate:step_done]
    Oracle: When there are four or more page counters on this artifact, exile it. If you do, you gain 4 life.
    Trigger: When Mazemind Tome has 4 or more page counters
    Effect: Exile Mazemind Tome. Then, IF you did (s1): gain 4 life.
```

Player prompts:

- (none: no decisions)

Implementation: needed (cost:counters, step:scry, trigger:unspecified, trigger:intervening_if, predicate:stat, predicate:step_done)

### Mind's Eye

Type: Artifact

Oracle text:

> Whenever an opponent draws a card, you may pay {1}. If you do, draw a card.

Re-rendered plain English:

```
Mind's Eye [draft]
  [a1] triggered [needed: needs trigger:draw, field:draw_cards.optionalCost, field:draw_cards.srcs]
    Oracle: Whenever an opponent draws a card, you may pay {1}. If you do, draw a card.
    Trigger: Whenever an opponent draws a card
    Effect: Draw a card.
```

Player prompts:

- Mind's Eye: optional: Do you want to draw a card?

Implementation: needed (trigger:draw, field:draw_cards.optionalCost, field:draw_cards.srcs)

### Myr Battlesphere

Type: Artifact Creature — Myr Construct

Oracle text:

> When this creature enters, create four 1/1 colorless Myr artifact creature tokens.
> Whenever this creature attacks, you may tap X untapped Myr you control. If you do, this creature gets +X/+0 until end of turn and deals X damage to the player or planeswalker it's attacking.

Re-rendered plain English:

```
Myr Battlesphere [draft]
  [a1] triggered [implemented]
    Oracle: When this creature enters, create four 1/1 colorless Myr artifact creature tokens.
    Trigger: Whenever Myr Battlesphere enters
    Effect: Create four 1/1 colorless Myr artifact creature tokens.
  [a2] triggered [needed: needs quantity:step_result, step:choose, field:choose.anyNumber, field:choose.from, field:choose.saveAs]
    Oracle: Whenever this creature attacks, you may tap X untapped Myr you control. If you do, this creature gets +X/+0 until end of turn and deals X damage to the player or planeswalker it's attacking.
    Trigger: Whenever Myr Battlesphere attacks
    Effect: Choose an untapped Myr you control. Then, tap the chosen object. Then, Myr Battlesphere gets +the number affected this way (pick)/+0 until end of turn. Then, deal the number affected this way (pick) damage to the player or planeswalker it's attacking.
```

Player prompts:

- Myr Battlesphere: tap Myr: Choose any number of untapped Myr you control to tap (X = how many).

Implementation: needed (quantity:step_result, step:choose, field:choose.anyNumber, field:choose.from, field:choose.saveAs)

### Psychosis Crawler

Type: Artifact Creature — Phyrexian Horror

Oracle text:

> Psychosis Crawler's power and toughness are each equal to the number of cards in your hand.
> Whenever you draw a card, each opponent loses 1 life.

Re-rendered plain English:

```
Psychosis Crawler [draft]
  [a1] static [needed: needs static, static:setBasePT]
    Oracle: Psychosis Crawler's power and toughness are each equal to the number of cards in your hand.
    Static: Psychosis Crawler has power and toughness each equal to the number of cards in your hand
  [a2] triggered [needed: needs trigger:draw, field:life_change.who]
    Oracle: Whenever you draw a card, each opponent loses 1 life.
    Trigger: Whenever you draw a card
    Effect: Each opponent loses 1 life.
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, static:setBasePT, trigger:draw, field:life_change.who)

### Skysovereign, Consul Flagship

Type: Legendary Artifact — Vehicle

Oracle text:

> Flying
> Whenever Skysovereign enters or attacks, it deals 3 damage to target creature or planeswalker an opponent controls.
> Crew 3 (Tap any number of creatures you control with total power 3 or more: This Vehicle becomes an artifact creature until end of turn.)

Re-rendered plain English:

```
Skysovereign, Consul Flagship [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:multi_event]
    Oracle: Whenever Skysovereign enters or attacks, it deals 3 damage to target creature or planeswalker an opponent controls.
    Trigger: Whenever Skysovereign, Consul Flagship enters or attacks
    Target t1: target creature or planeswalker an opponent controls  <- prompt: "Choose target creature or planeswalker an opponent controls."
    Effect: Deal 3 damage to target creature or planeswalker an opponent controls.
  [a3] activated [needed: needs scripted:crew, keyword:crew, step:grant_effect, field:grant_effect.modify]
    Oracle: Crew 3 (Tap any number of creatures you control with total power 3 or more: This Vehicle becomes an artifact creature until end of turn.)
    Effect: Skysovereign, Consul Flagship becomes an artifact creature in addition to its other types until end of turn.
    Scripted (engine-specific rule, not described by the fields above): crew
    Keyword: crew 3
```

Player prompts:

- Skysovereign, Consul Flagship: choose a target: Choose target creature or planeswalker an opponent controls.

Implementation: needed (trigger:multi_event, scripted:crew, keyword:crew, step:grant_effect, field:grant_effect.modify)

### Steel Hellkite

Type: Artifact Creature — Dragon

Oracle text:

> Flying
> {2}: This creature gets +1/+0 until end of turn.
> {X}: Destroy each nonland permanent with mana value X whose controller was dealt combat damage by this creature this turn. Activate only once each turn.

Re-rendered plain English:

```
Steel Hellkite [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] activated [implemented]
    Oracle: {2}: This creature gets +1/+0 until end of turn.
    Cost: {2}
    Effect: Steel Hellkite gets +1/+0 until end of turn.
  [a3] activated [needed: needs timing, cost:x, field:destroy_all.filter]
    Oracle: {X}: Destroy each nonland permanent with mana value X whose controller was dealt combat damage by this creature this turn. Activate only once each turn.
    Cost: {X}
    Timing: 1 per turn
    Effect: Destroy each nonland permanent with mana value X whose controller was dealt combat damage by it this turn.
    X prompt: "Choose a value for X (paid in mana)."
```

Player prompts:

- Steel Hellkite: choose X: Choose a value for X (paid in mana).

Implementation: needed (timing, cost:x, field:destroy_all.filter)

### Fall from Favor

Type: Enchantment — Aura

Oracle text:

> Enchant creature
> When this Aura enters, tap enchanted creature and you become the monarch.
> Enchanted creature doesn't untap during its controller's untap step unless that player is the monarch.

Re-rendered plain English:

```
Fall from Favor [draft]
  [a1] spell_effect [needed: needs keyword:enchant]
    Oracle: Enchant creature
    Target t1: target creature  <- prompt: "Choose target creature."
    Keyword: enchant
  [a2] triggered [needed: needs scripted:become_monarch]
    Oracle: When this Aura enters, tap enchanted creature and you become the monarch.
    Trigger: Whenever Fall from Favor enters
    Effect: Tap the enchanted creature.
    Scripted (engine-specific rule, not described by the fields above): become_monarch
  [a3] static [needed: needs static]
    Oracle: Enchanted creature doesn't untap during its controller's untap step unless that player is the monarch.
    Static: The enchanted creature doesn't untap during its controller's untap step unless the controller of the enchanted creature is the monarch
```

Player prompts:

- Fall from Favor: choose a target: Choose target creature.

Implementation: needed (keyword:enchant, scripted:become_monarch, static)

### Padeem, Consul of Innovation

Type: Legendary Creature — Vedalken Artificer

Oracle text:

> Artifacts you control have hexproof. (They can't be the targets of spells or abilities your opponents control.)
> At the beginning of your upkeep, if you control the artifact with the greatest mana value or tied for the greatest mana value, draw a card.

Re-rendered plain English:

```
Padeem, Consul of Innovation [draft]
  [a1] static [needed: needs static]
    Oracle: Artifacts you control have hexproof. (They can't be the targets of spells or abilities your opponents control.)
    Static: Artifacts you control have hexproof
  [a2] triggered [needed: needs trigger:intervening_if]
    Oracle: At the beginning of your upkeep, if you control the artifact with the greatest mana value or tied for the greatest mana value, draw a card.
    Trigger: At the beginning of your upkeep, if you control an artifact with mana value greater than or equal to the greatest mana value among artifacts
    Effect: Draw a card.
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, trigger:intervening_if)

### Propaganda

Type: Enchantment

Oracle text:

> Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.

Re-rendered plain English:

```
Propaganda [draft]
  [a1] static [needed: needs static, static:attackTax]
    Oracle: Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.
    Static: Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, static:attackTax)

### Thirst for Knowledge

Type: Instant

Oracle text:

> Draw three cards. Then discard two cards unless you discard an artifact card.

Re-rendered plain English:

```
Thirst for Knowledge [draft]
  [a1] spell_effect [needed: needs step:unless_pay]
    Oracle: Draw three cards. Then discard two cards unless you discard an artifact card.
    Effect: Draw 3 cards. Then, discard 2 cards unless you discard an artifact card in your hand.
```

Player prompts:

- Thirst for Knowledge: discard: Choose 2 cards to discard.
- Thirst for Knowledge: pay or not: Do you want to discard an artifact card in your hand? If you don't, discard 2 cards.

Implementation: needed (step:unless_pay)

### Myr Retriever

Type: Artifact Creature — Myr

Oracle text:

> When this creature dies, return another target artifact card from your graveyard to your hand.

Re-rendered plain English:

```
Myr Retriever [draft]
  [a1] triggered [implemented]
    Oracle: When this creature dies, return another target artifact card from your graveyard to your hand.
    Trigger: Whenever Myr Retriever dies
    Target t1: another target artifact card in your graveyard  <- prompt: "Choose another target artifact card in your graveyard."
    Effect: Put another target artifact card in your graveyard into your hand.
```

Player prompts:

- Myr Retriever: choose a target: Choose another target artifact card in your graveyard.

Implementation: implemented

### Soul-Guide Lantern

Type: Artifact

Oracle text:

> When this artifact enters, exile target card from a graveyard.
> {T}, Sacrifice this artifact: Exile each opponent's graveyard.
> {1}, {T}, Sacrifice this artifact: Draw a card.

Re-rendered plain English:

```
Soul-Guide Lantern [draft]
  [a1] triggered [implemented]
    Oracle: When this artifact enters, exile target card from a graveyard.
    Trigger: Whenever Soul-Guide Lantern enters
    Target t1: target card in a graveyard  <- prompt: "Choose target card in a graveyard."
    Effect: Exile target card in a graveyard.
  [a2] activated [needed: needs cost:sacrifice, field:move_card_zone.all, field:move_card_zone.from, field:move_card_zone.who]
    Oracle: {T}, Sacrifice this artifact: Exile each opponent's graveyard.
    Cost: {T}, sacrifice Soul-Guide Lantern
    Effect: Exile all cards from each opponent's graveyard.
  [a3] activated [needed: needs cost:sacrifice]
    Oracle: {1}, {T}, Sacrifice this artifact: Draw a card.
    Cost: {1}, {T}, sacrifice Soul-Guide Lantern
    Effect: Draw a card.
```

Player prompts:

- Soul-Guide Lantern: choose a target: Choose target card in a graveyard.

Implementation: needed (cost:sacrifice, field:move_card_zone.all, field:move_card_zone.from, field:move_card_zone.who)

### Lonely Sandbar

Type: Land

Oracle text:

> This land enters tapped.
> {T}: Add {U}.
> Cycling {U} ({U}, Discard this card: Draw a card.)

Re-rendered plain English:

```
Lonely Sandbar [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped.
    Replacement: If Lonely Sandbar would enter, it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {U}.
    Cost: {T}
    Mana: add {U}
  [a3] activated (from hand) [needed: needs zone:hand, cost:discard]
    Oracle: Cycling {U} ({U}, Discard this card: Draw a card.)
    Cost: {U}, discard Lonely Sandbar
    Effect: Draw a card.
    Keyword: cycling
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter, zone:hand, cost:discard)

### Remote Isle

Type: Land

Oracle text:

> This land enters tapped.
> {T}: Add {U}.
> Cycling {2} ({2}, Discard this card: Draw a card.)

Re-rendered plain English:

```
Remote Isle [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped.
    Replacement: If Remote Isle would enter, it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {U}.
    Cost: {T}
    Mana: add {U}
  [a3] activated (from hand) [needed: needs zone:hand, cost:discard]
    Oracle: Cycling {2} ({2}, Discard this card: Draw a card.)
    Cost: {2}, discard Remote Isle
    Effect: Draw a card.
    Keyword: cycling
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter, zone:hand, cost:discard)

## Kernel to-do: missing capabilities across this deck

| capability | cards | needing it |
|---|---|---|
| `static` | 18 | Broodstar; Master of Etherium; Shimmer Dragon; Adaptive Omnitool; Darksteel Juggernaut; Duplicant; Forsaken Monument; Graaz, Unstoppable Juggernaut; Nettlecyst; Psychosis Crawler; Etherium Sculptor; Fall from Favor; Padeem, Consul of Innovation; Propaganda; Chief of the Foundry; Foundry Inspector; Shimmer Myr; Thought Vessel |
| `cost:sacrifice` | 7 | Sai, Master Thopterist; Aether Spellbomb; Hedron Archive; Mind Stone; Soul-Guide Lantern; Buried Ruin; Foundry of the Consuls |
| `cost_reduction` | 6 | Broodstar; Thought Monitor; Memory Guardian; Tamiyo's Logbook; Thoughtcast; Spire Golem |
| `field:create_tokens.tokenKeywords` | 6 | Sai, Master Thopterist; Thopter Fabricator; Thopter Spy Network; Launch Mishap; Whirler Rogue; Foundry of the Consuls |
| `static:setBasePT` | 6 | Broodstar; Master of Etherium; Darksteel Juggernaut; Duplicant; Graaz, Unstoppable Juggernaut; Psychosis Crawler |
| `field:grant_effect.modify` | 5 | Kappa Cannoneer; Thopter Fabricator; Cultivator's Caravan; Skysovereign, Consul Flagship; Whirler Rogue |
| `step:grant_effect` | 5 | Kappa Cannoneer; Thopter Fabricator; Cultivator's Caravan; Skysovereign, Consul Flagship; Whirler Rogue |
| `trigger:subject` | 5 | Kappa Cannoneer; Research Thief; Thopter Spy Network; Adaptive Omnitool; Forsaken Monument |
| `step:counter_spell` | 4 | Kappa Cannoneer; Counterspell; Launch Mishap; Negate |
| `trigger:draw` | 4 | Thopter Fabricator; Mind's Eye; Psychosis Crawler; Scrawling Crawler |
| `trigger:intervening_if` | 4 | Misleading Signpost; Thopter Spy Network; Mazemind Tome; Padeem, Consul of Innovation |
| `field:choose.from` | 3 | Master Transmuter; Adaptive Omnitool; Myr Battlesphere |
| `field:choose.saveAs` | 3 | Master Transmuter; Adaptive Omnitool; Myr Battlesphere |
| `keyword:crew` | 3 | Thopter Fabricator; Cultivator's Caravan; Skysovereign, Consul Flagship |
| `mana:variable` | 3 | Cultivator's Caravan; Arcane Signet; Ornithopter of Paradise |
| `replacement:would_enter` | 3 | Nevinyrral's Disk; Lonely Sandbar; Remote Isle |
| `scripted:crew` | 3 | Thopter Fabricator; Cultivator's Caravan; Skysovereign, Consul Flagship |
| `step:choose` | 3 | Master Transmuter; Adaptive Omnitool; Myr Battlesphere |
| `cost:discard` | 2 | Lonely Sandbar; Remote Isle |
| `cost:tapOther` | 2 | Shimmer Dragon; Whirler Rogue |
| `field:add_counters.on` | 2 | Kappa Cannoneer; Steel Overseer |
| `field:attach.to` | 2 | Adaptive Omnitool; Nettlecyst |
| `field:attach.what` | 2 | Adaptive Omnitool; Nettlecyst |
| `field:choose.count` | 2 | Master Transmuter; Adaptive Omnitool |
| `field:destroy_all.filter` | 2 | Nevinyrral's Disk; Steel Hellkite |
| `field:life_change.who` | 2 | Psychosis Crawler; Scrawling Crawler |
| `static:mustAttack` | 2 | Darksteel Juggernaut; Graaz, Unstoppable Juggernaut |
| `step:add_counters` | 2 | Kappa Cannoneer; Steel Overseer |
| `step:attach` | 2 | Adaptive Omnitool; Nettlecyst |
| `step:unless_pay` | 2 | Kappa Cannoneer; Thirst for Knowledge |
| `trigger:multi_event` | 2 | Skysovereign, Consul Flagship; Ichor Wellspring |
| `zone:hand` | 2 | Lonely Sandbar; Remote Isle |
| `cost:counters` | 1 | Mazemind Tome |
| `cost:life` | 1 | War Room |
| `cost:returnToHand` | 1 | Master Transmuter |
| `cost:x` | 1 | Steel Hellkite |
| `field:add_mana.produces` | 1 | Forsaken Monument |
| `field:choose.anyNumber` | 1 | Myr Battlesphere |
| `field:choose.fromLooked` | 1 | Adaptive Omnitool |
| `field:draw_cards.optionalCost` | 1 | Mind's Eye |
| `field:draw_cards.srcs` | 1 | Mind's Eye |
| `field:draw_cards.who` | 1 | Scrawling Crawler |
| `field:exile_target.linkExile` | 1 | Duplicant |
| `field:mass_bounce.filter` | 1 | Aetherize |
| `field:move_card_zone.all` | 1 | Soul-Guide Lantern |
| `field:move_card_zone.from` | 1 | Soul-Guide Lantern |
| `field:move_card_zone.order` | 1 | Adaptive Omnitool |
| `field:move_card_zone.position` | 1 | Adaptive Omnitool |
| `field:move_card_zone.what` | 1 | Adaptive Omnitool |
| `field:move_card_zone.who` | 1 | Soul-Guide Lantern |
| `field:repeat_for_each.over` | 1 | Steel Overseer |
| `field:repeat_for_each.steps` | 1 | Steel Overseer |
| `field:sacrifice_permanent.all` | 1 | All Is Dust |
| `field:sacrifice_permanent.filter` | 1 | All Is Dust |
| `field:sacrifice_permanent.who` | 1 | All Is Dust |
| `filter:colored` | 1 | All Is Dust |
| `keyword:enchant` | 1 | Fall from Favor |
| `keyword:improvise` | 1 | Kappa Cannoneer |
| `predicate:phase_is` | 1 | Misleading Signpost |
| `predicate:stat` | 1 | Mazemind Tome |
| `predicate:step_done` | 1 | Mazemind Tome |
| `quantity:step_result` | 1 | Myr Battlesphere |
| `quantity:X` | 1 | Pull from Tomorrow |
| `ref:created` | 1 | Nettlecyst |
| `ref:iterated` | 1 | Steel Overseer |
| `ref:linked_exile` | 1 | Duplicant |
| `scripted:become_monarch` | 1 | Fall from Favor |
| `scripted:improvise` | 1 | Kappa Cannoneer |
| `scripted:tapped_for_colorless_mana` | 1 | Forsaken Monument |
| `static:addTypes` | 1 | Graaz, Unstoppable Juggernaut |
| `static:attackTax` | 1 | Propaganda |
| `static:copySubtypesOf` | 1 | Duplicant |
| `step:add_mana` | 1 | Forsaken Monument |
| `step:look_top` | 1 | Adaptive Omnitool |
| `step:repeat_for_each` | 1 | Steel Overseer |
| `step:reselect_attack_target` | 1 | Misleading Signpost |
| `step:reveal` | 1 | Adaptive Omnitool |
| `step:scry` | 1 | Mazemind Tome |
| `timing` | 1 | Steel Hellkite |
| `trigger:batch` | 1 | Thopter Spy Network |
| `trigger:becomes_target` | 1 | Kappa Cannoneer |
| `trigger:leaves` | 1 | Ichor Wellspring |
| `trigger:nth` | 1 | Thopter Fabricator |
| `trigger:tap` | 1 | Forsaken Monument |
| `trigger:unspecified` | 1 | Mazemind Tome |
| `trigger:zones` | 1 | Ichor Wellspring |

## Decisions

- Consolidated schema pass: the workarounds reported by the five pilot decks (sentinels, review.ignore hacks, scripted stubs, placeholder refs) now use real fields; see src/kernel/SCHEMA_CHANGELOG.md.
- Monarch stays a scripted marker (become_monarch + the controller_is_monarch stat) by user decision; Crew, Improvise, Myriad, Storm, Read ahead, Manifest dread, Reselect attack target and tapped-for-{C} stay scripted markers (vocabulary listed in the changelog).
- Remaining genuine card-behaviour questions are collected in data/kernel-drafts/CONSOLIDATED_QUESTIONS.md, not per deck.
