# Kernel draft approval: Saheeli

81 unique cards: 37 simple (A), 44 complex (B). Validator: 81/81 pass. Cards with implementation "needed": 72. All drafts are `review.status: "draft"`; nothing was written to the DB.

Reading guide: each card below shows the oracle text and what the structured JSON says back in plain English. Approve if they match.

## (A) Simple cards: spot-check one line each

- **Ancient Stone Idol** (Artifact Creature — Golem): Keyword flash | (costs {1} less for each attacking creature) | Keyword trample | Whenever Ancient Stone Idol dies: Create a 6/12 colorless Construct artifact creature token with trample [needs: cast_option, cost_reduction, field:create_tokens.tokenKeywords]
- **Arcane Signet** (Artifact): {T}: add one mana of any color in your commander's color identity [needs: mana:variable]
- **Blasphemous Act** (Sorcery): (costs {1} less for each creature) | Deal 13 damage to the target [needs: cast_option, cost_reduction, field:damage_target.all, field:damage_target.filter]
- **Buried Ruin** (Land): {T}: add {C} | {2}, {T}, sacrifice Buried Ruin: [targets: target artifact card in your graveyard] Put target artifact card in your graveyard into your hand [needs: cost:sacrifice]
- **Chief of the Foundry** (Artifact Creature — Construct): Other artifact creatures you control get +1/+1 [needs: static]
- **Command Tower** (Land): {T}: add one mana of any color in your commander's color identity [needs: mana:variable]
- **Counterspell** (Instant): [targets: target spell] Counter target spell [needs: step:counter_spell]
- **Darksteel Citadel** (Artifact Land): Keyword indestructible | {T}: add {C} [implemented]
- **Darksteel Forge** (Artifact): Artifacts you control have indestructible [needs: static]
- **Emry, Lurker of the Loch** (Legendary Creature — Merfolk Wizard): Keyword affinity artifacts | Whenever Emry, Lurker of the Loch enters: Mill 4 cards | {T}: [targets: target artifact card in your graveyard] You may you may play undefined until end of turn [needs: cost_reduction, step:permission_to_play]
- **Enthusiastic Mechanaut** (Artifact Creature — Goblin Artificer): Keyword flying | Artifact spells you cast cost {1} less to cast [needs: static]
- **Etherium Sculptor** (Artifact Creature — Vedalken Artificer): Artifact spells you cast cost {1} less to cast [needs: static]
- **Foundry Inspector** (Artifact Creature — Construct): Artifact spells you cast cost {1} less to cast [needs: static]
- **Gilded Lotus** (Artifact): {T}: add three mana of any one color [needs: mana:variable]
- **Great Furnace** (Artifact Land): {T}: add {R} [implemented]
- **Hedron Archive** (Artifact): {T}: add {C}{C} | {2}, {T}, sacrifice Hedron Archive: Draw 2 cards [needs: cost:sacrifice]
- **Island** (Basic Land — Island): {T}: add {U} [implemented]
- **Izzet Boilerworks** (Land): If Izzet Boilerworks would enter, it enters tapped | Whenever Izzet Boilerworks enters: Choose a land you control, then return the chosen object to its owner's hand | {T}: add {U}{R} [needs: replacement:would_enter, step:choose, field:choose.count, field:choose.from, field:choose.saveAs]
- **Izzet Signet** (Artifact): {1}, {T}: add {U}{R} [implemented]
- **Mind Unbound** (Enchantment): At the beginning of your upkeep: Put a lore counter on Mind Unbound, then draw the number of lore counters on self cards [needs: step:add_counters, field:add_counters.on, quantity:counters]
- **Mountain** (Basic Land — Mountain): {T}: add {R} [implemented]
- **Ornithopter of Paradise** (Artifact Creature — Thopter): Keyword flying | {T}: add one mana of any color [needs: mana:variable]
- **Prismatic Lens** (Artifact): {T}: add {C} | {1}, {T}: add one mana of any color [needs: mana:variable]
- **Reliquary Tower** (Land): You have no maximum hand size | {T}: add {C} [needs: static]
- **Seat of the Synod** (Artifact Land): {T}: add {U} [implemented]
- **Sharding Sphinx** (Artifact Creature — Sphinx): Keyword flying | Whenever an artifact creature you control deals combat damage to a player: You may create a 1/1 blue Thopter artifact creature token with flying [needs: trigger:subject, field:create_tokens.tokenKeywords]
- **Skullclamp** (Artifact — Equipment): The equipped creature gets +1/-1 | Whenever the equipped creature dies: Draw 2 cards | {1}: [targets: target creature you control] Attach Skullclamp to target creature you control [needs: static, trigger:subject, step:attach, field:attach.to, field:attach.what]
- **Sol Ring** (Artifact): {T}: add {C}{C} [implemented]
- **Swan Song** (Instant): [targets: target enchantment spell, instant spell, or sorcery spell] Counter target enchantment spell, instant spell, or sorcery spell, then create a 2/2 blue Bird creature token with flying [needs: step:counter_spell, field:create_tokens.tokenKeywords, field:create_tokens.who]
- **Swiftfoot Boots** (Artifact — Equipment): The equipped creature has hexproof and has haste | {1}: [targets: target creature you control] Attach Swiftfoot Boots to target creature you control [needs: static, step:attach, field:attach.to, field:attach.what]
- **Thopter Engineer** (Creature — Human Artificer): Whenever Thopter Engineer enters: Create a 1/1 colorless Thopter artifact creature token with flying | Artifact creatures you control have haste [needs: field:create_tokens.tokenKeywords, static]
- **Thought Monitor** (Artifact Creature — Construct): Keyword affinity artifacts | Keyword flying | Whenever Thought Monitor enters: Draw 2 cards [needs: cost_reduction]
- **Thran Dynamo** (Artifact): {T}: add {C}{C}{C} [implemented]
- **Tidings** (Sorcery): Draw 4 cards [implemented]
- **Triplicate Titan** (Artifact Creature — Golem): Keyword flying | Keyword vigilance | Keyword trample | Whenever Triplicate Titan dies: Create a 3/3 colorless Golem artifact creature token with flying, then create a 3/3 colorless Golem artifact creature token with vigilance, then create a 3/3 colorless Golem artifact creature token with trample [needs: field:create_tokens.tokenKeywords]
- **Whirler Rogue** (Creature — Human Rogue Artificer): Whenever Whirler Rogue enters: Create two 1/1 colorless Thopter artifact creature tokens with flying | tap 2 untapped artifacts you control: [targets: target creature] Target creature can't be blocked until end of turn [needs: field:create_tokens.tokenKeywords, cost:tapOther, step:grant_effect, field:grant_effect.modify]
- **Worn Powerstone** (Artifact): If Worn Powerstone would enter, it enters tapped | {T}: add {C}{C} [needs: replacement:would_enter]

## (B) Complex cards

### Saheeli, the Gifted

Type: Legendary Planeswalker — Saheeli

Oracle text:

> +1: Create a 1/1 colorless Servo artifact creature token.
> +1: The next spell you cast this turn has affinity for artifacts. (It costs {1} less to cast for each artifact you control as you cast it.)
> −7: For each artifact you control, create a token that's a copy of it. Those tokens gain haste. Exile those tokens at the beginning of the next end step.
> Saheeli, the Gifted can be your commander.

Re-rendered plain English:

```
Saheeli, the Gifted [draft]
  [a1] activated [needed: needs timing, cost:loyalty]
    Oracle: +1: Create a 1/1 colorless Servo artifact creature token.
    Cost: +1
    Timing: sorcery; 1 per turn
    Effect: Create a 1/1 colorless Servo artifact creature token.
  [a2] activated [needed: needs scripted:next_spell_gains_keyword, timing, cost:loyalty, step:grant_effect, field:grant_effect.appliesTo, field:grant_effect.modify]
    Oracle: +1: The next spell you cast this turn has affinity for artifacts. (It costs {1} less to cast for each artifact you control as you cast it.)
    Cost: +1
    Timing: sorcery; 1 per turn
    Effect: The target affinity for artifacts until end of turn.
    Scripted (engine-specific rule, not described by the fields above): next_spell_gains_keyword
  [a3] activated [needed: needs timing, cost:loyalty, step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, step:copy, field:copy.exileAt, field:copy.gainKeywords, field:copy.token]
    Oracle: −7: For each artifact you control, create a token that's a copy of it. Those tokens gain haste. Exile those tokens at the beginning of the next end step.
    Cost: −7
    Timing: sorcery; 1 per turn
    Effect: For each artifact you control, copy that object.
  [a4] scripted [needed: needs scripted:can_be_your_commander]
    Oracle: Saheeli, the Gifted can be your commander.
    Scripted (engine-specific rule, not described by the fields above): can_be_your_commander
```

Player prompts:

- (none: no decisions)

Implementation: needed (timing, cost:loyalty, scripted:next_spell_gains_keyword, step:grant_effect, field:grant_effect.appliesTo, field:grant_effect.modify, step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, step:copy, field:copy.exileAt, field:copy.gainKeywords, field:copy.token, scripted:can_be_your_commander)

Questions for you:

- Loyalty costs use the {loyalty: N} cost atom (+N adds counters, -N removes) with sorcery-speed, once-per-turn timing. OK?
- 'The next spell you cast this turn has affinity for artifacts' has no 'next spell' target, so it is a grant_effect step (appliesTo:'next_spell_cast') plus the scripted marker next_spell_gains_keyword. Should the schema grow a next-spell grant?
- 'Create a token that's a copy of each artifact you control, haste, exile at the next end step' is repeat_for_each + copy with gainKeywords:['haste'] and exileAt:'next_end_step' (same shape as Goldlust Triad's exileAt). 'Can be your commander' is a scripted marker (can_be_your_commander) the deck loader would read.

### Archway of Innovation

Type: Land

Oracle text:

> This land enters tapped unless you control an Island.
> {T}: Add {U}.
> {U}, {T}: The next spell you cast this turn has improvise. (Your artifacts can help cast that spell. Each artifact you tap after you're done activating mana abilities pays for {1}.)

Re-rendered plain English:

```
Archway of Innovation [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped unless you control an Island.
    Replacement: If Archway of Innovation would enter (only if it is not true that you control an Island), it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {U}.
    Cost: {T}
    Mana: add {U}
  [a3] activated [needed: needs scripted:next_spell_gains_keyword, step:grant_effect, field:grant_effect.appliesTo, field:grant_effect.modify]
    Oracle: {U}, {T}: The next spell you cast this turn has improvise. (Your artifacts can help cast that spell. Each artifact you tap after you're done activating mana abilities pays for {1}.)
    Cost: {U}, {T}
    Effect: The target gains improvise until end of turn.
    Scripted (engine-specific rule, not described by the fields above): next_spell_gains_keyword
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter, scripted:next_spell_gains_keyword, step:grant_effect, field:grant_effect.appliesTo, field:grant_effect.modify)

Questions for you:

- 'This land enters tapped unless you control an Island' is a would_enter modify tapped with a negated controls condition. 'The next spell you cast this turn has improvise' reuses the next_spell_cast grant shape from Saheeli, the Gifted. OK?

### Brudiclad, Telchor Engineer

Type: Legendary Artifact Creature — Phyrexian Artificer

Oracle text:

> Creature tokens you control have haste.
> At the beginning of combat on your turn, create a 2/1 blue Phyrexian Myr artifact creature token. Then you may choose a token you control. If you do, each other token you control becomes a copy of that token.

Re-rendered plain English:

```
Brudiclad, Telchor Engineer [draft]
  [a1] static [needed: needs static]
    Oracle: Creature tokens you control have haste.
    Static: Token creatures you control have haste
  [a2] triggered [needed: needs step:choose, field:choose.count, field:choose.from, field:choose.saveAs, step:copy, field:copy.all, field:copy.becomes, field:copy.excludeChosen, field:copy.filter, field:copy.of, predicate:step_done]
    Oracle: At the beginning of combat on your turn, create a 2/1 blue Phyrexian Myr artifact creature token. Then you may choose a token you control. If you do, each other token you control becomes a copy of that token.
    Trigger: At the beginning of combat on your turn
    Effect: Create a 2/1 blue Phyrexian Myr artifact creature token. Then, you may choose a token permanent you control. Then, IF you did (c1): copy the target.
```

Player prompts:

- Brudiclad: choose a token: You may choose a token you control. Each other token you control becomes a copy of it.

Implementation: needed (static, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, step:copy, field:copy.all, field:copy.becomes, field:copy.excludeChosen, field:copy.filter, field:copy.of, predicate:step_done)

Questions for you:

- 'Each other token you control becomes a copy of that token' is a copy step with all:true, becomes:true (the objects themselves change, no new tokens) and excludeChosen:true, gated by step_done on the optional choose. OK?

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

### Crackle with Power

Type: Sorcery

Oracle text:

> Crackle with Power deals five times X damage to each of up to X targets.

Re-rendered plain English:

```
Crackle with Power [draft]
  [a1] spell_effect [needed: needs targets:multi, targets:variable_count, quantity:math]
    Oracle: Crackle with Power deals five times X damage to each of up to X targets.
    Target t1: up to X targets  <- prompt: "Choose up to X targets (any target: creatures, players or planeswalkers)."
    Effect: Deal 5 x X damage to up to X targets.
    X prompt: "Choose a value for X (paid in mana as part of the spell's cost)."
```

Player prompts:

- Crackle with Power: choose targets: Choose up to X targets (any target: creatures, players or planeswalkers).
- Crackle with Power: choose X: Choose a value for X (paid in mana as part of the spell's cost).

Implementation: needed (targets:multi, targets:variable_count, quantity:math)

Questions for you:

- 'Each of up to X targets': TargetSpec.count.max must be a fixed integer, so it is {min:0,max:1} plus the scripted marker target_count_up_to_X. Should count.max accept a Quantity?

### Daretti, Scrap Savant

Type: Legendary Planeswalker — Daretti

Oracle text:

> +2: Discard up to two cards, then draw that many cards.
> −2: Sacrifice an artifact. If you do, return target artifact card from your graveyard to the battlefield.
> −10: You get an emblem with "Whenever an artifact is put into your graveyard from the battlefield, return that card to the battlefield at the beginning of the next end step."
> Daretti, Scrap Savant can be your commander.

Re-rendered plain English:

```
Daretti, Scrap Savant [draft]
  [a1] activated [needed: needs timing, cost:loyalty, field:discard.upTo, quantity:event_amount]
    Oracle: +2: Discard up to two cards, then draw that many cards.
    Cost: +2
    Timing: sorcery; 1 per turn
    Effect: Discard 2 cards. Then, draw that many cards.
  [a2] activated [needed: needs timing, cost:loyalty, field:sacrifice_permanent.amount, field:sacrifice_permanent.filter, predicate:step_done]
    Oracle: −2: Sacrifice an artifact. If you do, return target artifact card from your graveyard to the battlefield.
    Cost: −2
    Timing: sorcery; 1 per turn
    Target t1: target artifact card in your graveyard  <- prompt: "Choose target artifact card in your graveyard."
    Effect: Sacrifice an artifact you control. Then, IF you did (s1): return target artifact card in your graveyard from the graveyard to the battlefield.
  [a3] activated [needed: needs timing, cost:loyalty, step:create_emblem, field:create_emblem.emblem]
    Oracle: −10: You get an emblem with "Whenever an artifact is put into your graveyard from the battlefield, return that card to the battlefield at the beginning of the next end step."
    Cost: −10
    Timing: sorcery; 1 per turn
    Effect: You get an emblem with "Whenever an artifact is put into your graveyard from the battlefield, return that card to the battlefield at the beginning of the next end step.".
  [a4] scripted [needed: needs scripted:can_be_your_commander]
    Oracle: Daretti, Scrap Savant can be your commander.
    Scripted (engine-specific rule, not described by the fields above): can_be_your_commander
```

Player prompts:

- Daretti, Scrap Savant: discard: Choose 2 cards to discard.
- Daretti, Scrap Savant: choose a target: Choose target artifact card in your graveyard.
- Daretti, Scrap Savant: sacrifice: Choose a permanent to sacrifice.

Implementation: needed (timing, cost:loyalty, field:discard.upTo, quantity:event_amount, field:sacrifice_permanent.amount, field:sacrifice_permanent.filter, predicate:step_done, step:create_emblem, field:create_emblem.emblem, scripted:can_be_your_commander)

Questions for you:

- Loyalty costs use the {loyalty: N} cost atom (+N adds counters, -N removes) with sorcery-speed, once-per-turn timing. OK?
- Emblems have no step kind. Written as a grant_effect step with emblem:true whose modify.grantAbility carries the emblem's ability. Should the schema get a create_emblem step?
- 'Discard up to two cards, then draw that many': discard has upTo:true and the draw amount is event_amount (the number actually discarded). OK?

### Darksteel Juggernaut

Type: Artifact Creature — Juggernaut

Oracle text:

> Indestructible
> Darksteel Juggernaut's power and toughness are each equal to the number of artifacts you control.
> This creature attacks each combat if able.

Re-rendered plain English:

```
Darksteel Juggernaut [approved]
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

### Delete

Type: Sorcery

Oracle text:

> Delete deals X damage to each nonartifact creature and each player.

Re-rendered plain English:

```
Delete [draft]
  [a1] spell_effect [needed: needs quantity:X, field:damage_target.all, field:damage_target.filter, field:damage_target.who]
    Oracle: Delete deals X damage to each nonartifact creature and each player.
    Effect: Deal X damage to the target. Then, deal X damage to the target.
    X prompt: "Choose a value for X (paid in mana as part of the spell's cost)."
```

Player prompts:

- Delete: choose X: Choose a value for X (paid in mana as part of the spell's cost).

Implementation: needed (quantity:X, field:damage_target.all, field:damage_target.filter, field:damage_target.who)

### Fellwar Stone

Type: Artifact

Oracle text:

> {T}: Add one mana of any color that a land an opponent controls could produce.

Re-rendered plain English:

```
Fellwar Stone [draft]
  [a1] mana [needed: needs scripted:mana_colors_an_opponent_land_could_produce, mana:variable]
    Oracle: {T}: Add one mana of any color that a land an opponent controls could produce.
    Cost: {T}
    Scripted (engine-specific rule, not described by the fields above): mana_colors_an_opponent_land_could_produce
    Mana: add one mana of any color
```

Player prompts:

- (none: no decisions)

Implementation: needed (scripted:mana_colors_an_opponent_land_could_produce, mana:variable)

Questions for you:

- 'One mana of any color that a land an opponent controls could produce' is {anyColor:1} plus the scripted marker mana_colors_an_opponent_land_could_produce (the kernel must restrict the colors). Should ManaSpec get an 'optionsFrom' filter?

### Finale of Revelation

Type: Sorcery

Oracle text:

> Draw X cards. If X is 10 or more, instead shuffle your graveyard into your library, draw X cards, untap up to five lands, and you have no maximum hand size for the rest of the game.
> Exile Finale of Revelation.

Re-rendered plain English:

```
Finale of Revelation [draft]
  [a1] spell_effect [needed: needs step:if_else, field:if_else.else, field:if_else.if, field:if_else.then, predicate:compare, field:move_card_zone.all, field:move_card_zone.from, step:shuffle, quantity:X, field:untap_target.amount, field:untap_target.filter, field:untap_target.upTo, step:grant_effect, field:grant_effect.modify]
    Oracle: Draw X cards. If X is 10 or more, instead shuffle your graveyard into your library, draw X cards, untap up to five lands, and you have no maximum hand size for the rest of the game.
    Effect: If X is 10 or greater: put all cards from your graveyard into its owner's library, then shuffle, then draw X cards, then untap the target, then the target gains no maximum hand size; otherwise draw X cards.
    X prompt: "Choose a value for X (paid in mana as part of the spell's cost)."
  [a2] spell_effect [implemented]
    Oracle: Exile Finale of Revelation.
    Effect: Exile Finale of Revelation.
```

Player prompts:

- Finale of Revelation: choose X: Choose a value for X (paid in mana as part of the spell's cost).

Implementation: needed (step:if_else, field:if_else.else, field:if_else.if, field:if_else.then, predicate:compare, field:move_card_zone.all, field:move_card_zone.from, step:shuffle, quantity:X, field:untap_target.amount, field:untap_target.filter, field:untap_target.upTo, step:grant_effect, field:grant_effect.modify)

Questions for you:

- 'Draw X cards. If X is 10 or more, instead shuffle your graveyard into your library, draw X cards, untap up to five lands, and you have no maximum hand size for the rest of the game' is an if_else (compare X >= 10). The permanent 'no maximum hand size' is a grant_effect with duration 'instant' (= no expiry). 'Exile Finale of Revelation' is its own line and a move_card_zone step on self. OK?

### Forsaken Monument

Type: Legendary Artifact

Oracle text:

> Colorless creatures you control get +2/+2.
> Whenever you tap a permanent for {C}, add an additional {C}.
> Whenever you cast a colorless spell, you gain 2 life.

Re-rendered plain English:

```
Forsaken Monument [approved]
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

### Frostboil Snarl

Type: Land

Oracle text:

> As this land enters, you may reveal an Island or Mountain card from your hand. If you don't, this land enters tapped.
> {T}: Add {U} or {R}.

Re-rendered plain English:

```
Frostboil Snarl [draft]
  [a1] replacement [needed: needs replacement:would_enter, step:reveal, field:reveal.filter, predicate:not, predicate:step_done]
    Oracle: As this land enters, you may reveal an Island or Mountain card from your hand. If you don't, this land enters tapped.
    Replacement: If Frostboil Snarl would enter, also: reveal the target, then tap Frostboil Snarl
  [a2] mana [implemented]
    Oracle: {T}: Add {U} or {R}.
    Cost: {T}
    Mana: add {U} and {R}
```

Player prompts:

- Frostboil Snarl: reveal a land?: You may reveal an Island or Mountain card from your hand. If you don't, this land enters tapped.

Implementation: needed (replacement:would_enter, step:reveal, field:reveal.filter, predicate:not, predicate:step_done)

Questions for you:

- 'Add {U} or {R}': ManaSpec has no 'choose one' form. Written as one mana ability whose produces list has two single-colour entries ({U}, {R}); the convention is that several entries in one ability are alternatives the player chooses from, while a single entry like {U}{R} is all produced together. OK?
- 'As this land enters, you may reveal an Island or Mountain card from your hand. If you don't, this land enters tapped.' is a would_enter 'also' replacement: optional reveal step, then tap self unless the reveal happened (step_done). OK?

### Hellkite Igniter

Type: Creature — Dragon

Oracle text:

> Flying, haste
> {1}{R}: This creature gets +X/+0 until end of turn, where X is the number of artifacts you control.

Re-rendered plain English:

```
Hellkite Igniter [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] keyword [implemented]
    Oracle: haste
    Keyword: haste
  [a3] activated [needed: needs quantity:count]
    Oracle: {1}{R}: This creature gets +X/+0 until end of turn, where X is the number of artifacts you control.
    Cost: {1}{R}
    Effect: Hellkite Igniter gets +the number of artifacts you control/+0 until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (quantity:count)

### Idol of Oblivion

Type: Artifact

Oracle text:

> {T}: Draw a card. Activate only if you created a token this turn.
> {8}, {T}, Sacrifice this artifact: Create a 10/10 colorless Eldrazi creature token.

Re-rendered plain English:

```
Idol of Oblivion [draft]
  [a1] activated [needed: needs timing]
    Oracle: {T}: Draw a card. Activate only if you created a token this turn.
    Cost: {T}
    Timing: you token created this turn
    Effect: Draw a card.
  [a2] activated [needed: needs cost:sacrifice]
    Oracle: {8}, {T}, Sacrifice this artifact: Create a 10/10 colorless Eldrazi creature token.
    Cost: {8}, {T}, sacrifice Idol of Oblivion
    Effect: Create a 10/10 colorless Eldrazi creature token.
```

Player prompts:

- (none: no decisions)

Implementation: needed (timing, cost:sacrifice)

### Jhoira, Weatherlight Captain

Type: Legendary Creature — Human Artificer

Oracle text:

> Whenever you cast a historic spell, draw a card. (Artifacts, legendaries, and Sagas are historic.)

Re-rendered plain English:

```
Jhoira, Weatherlight Captain [draft]
  [a1] triggered [needed: needs trigger:subject]
    Oracle: Whenever you cast a historic spell, draw a card. (Artifacts, legendaries, and Sagas are historic.)
    Trigger: Whenever you cast an artifact spell, legendary spell, or Saga spell
    Effect: Draw a card.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:subject)

Questions for you:

- 'Historic' (artifacts, legendaries and Sagas, from the reminder text) is written as an anyOf filter on the cast trigger subject. OK?

### Loyal Apprentice

Type: Creature — Human Artificer

Oracle text:

> Haste
> Lieutenant — At the beginning of combat on your turn, if you control your commander, create a 1/1 colorless Thopter artifact creature token with flying. That token gains haste until end of turn.

Re-rendered plain English:

```
Loyal Apprentice [draft]
  [a1] keyword [implemented]
    Oracle: Haste
    Keyword: haste
  [a2] triggered [needed: needs ref:created, filter:isCommander, trigger:intervening_if, field:create_tokens.tokenKeywords, step:grant_effect, field:grant_effect.modify]
    Oracle: Lieutenant — At the beginning of combat on your turn, if you control your commander, create a 1/1 colorless Thopter artifact creature token with flying. That token gains haste until end of turn.
    Trigger: At the beginning of combat on your turn, if you control a commander permanent
    Effect: Create a 1/1 colorless Thopter artifact creature token with flying. Then, the token just created gains haste until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (ref:created, filter:isCommander, trigger:intervening_if, field:create_tokens.tokenKeywords, step:grant_effect, field:grant_effect.modify)

Questions for you:

- Lieutenant (an ability word) is just the intervening-if 'you control your commander', written with the filter flag isCommander. OK?

### Loyal Drake

Type: Creature — Drake

Oracle text:

> Flying
> Lieutenant — At the beginning of combat on your turn, if you control your commander, draw a card.

Re-rendered plain English:

```
Loyal Drake [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs filter:isCommander, trigger:intervening_if]
    Oracle: Lieutenant — At the beginning of combat on your turn, if you control your commander, draw a card.
    Trigger: At the beginning of combat on your turn, if you control a commander permanent
    Effect: Draw a card.
```

Player prompts:

- (none: no decisions)

Implementation: needed (filter:isCommander, trigger:intervening_if)

### Memnarch

Type: Legendary Artifact Creature — Wizard

Oracle text:

> {1}{U}{U}: Target permanent becomes an artifact in addition to its other types. (This effect lasts indefinitely.)
> {3}{U}: Gain control of target artifact. (This effect lasts indefinitely.)

Re-rendered plain English:

```
Memnarch [draft]
  [a1] activated [needed: needs step:grant_effect, field:grant_effect.modify]
    Oracle: {1}{U}{U}: Target permanent becomes an artifact in addition to its other types. (This effect lasts indefinitely.)
    Cost: {1}{U}{U}
    Target t1: target permanent  <- prompt: "Choose target permanent."
    Effect: Target permanent becomes an artifact in addition to its other types.
  [a2] activated [needed: needs step:gain_control]
    Oracle: {3}{U}: Gain control of target artifact. (This effect lasts indefinitely.)
    Cost: {3}{U}
    Target t1: target artifact  <- prompt: "Choose target artifact."
    Effect: Gain control of target artifact.
```

Player prompts:

- Memnarch: choose a target: Choose target permanent.
- Memnarch: choose a target: Choose target artifact.

Implementation: needed (step:grant_effect, field:grant_effect.modify, step:gain_control)

Questions for you:

- 'Lasts indefinitely' is written as no duration on the step (permanent effect). OK?

### Mimic Vat

Type: Artifact

Oracle text:

> Imprint — Whenever a nontoken creature dies, you may exile that card. If you do, return each other card exiled with this artifact to its owner's graveyard.
> {3}, {T}: Create a token that's a copy of a card exiled with this artifact. It gains haste. Exile it at the beginning of the next end step.

Re-rendered plain English:

```
Mimic Vat [draft]
  [a1] triggered [needed: needs ref:linked_exile, trigger:subject, field:exile_target.linkExile, field:move_card_zone.all, field:move_card_zone.excludeLatest, field:move_card_zone.filter, field:move_card_zone.from, predicate:step_done]
    Oracle: Imprint — Whenever a nontoken creature dies, you may exile that card. If you do, return each other card exiled with this artifact to its owner's graveyard.
    Trigger: Whenever a nontoken creature dies
    Effect: You may exile that object. Then, IF you did (e1): put all cards from your exile into its owner's graveyard.
  [a2] activated [needed: needs ref:linked_exile, step:copy, field:copy.exileAt, field:copy.gainKeywords, field:copy.token]
    Oracle: {3}, {T}: Create a token that's a copy of a card exiled with this artifact. It gains haste. Exile it at the beginning of the next end step.
    Cost: {3}, {T}
    Effect: Copy the card exiled with Mimic Vat.
```

Player prompts:

- Mimic Vat: optional: Do you want to exile that object?

Implementation: needed (ref:linked_exile, trigger:subject, field:exile_target.linkExile, field:move_card_zone.all, field:move_card_zone.excludeLatest, field:move_card_zone.filter, field:move_card_zone.from, predicate:step_done, step:copy, field:copy.exileAt, field:copy.gainKeywords, field:copy.token)

Questions for you:

- Imprint uses the pilot's linkExile / linked_exile pair. 'Return each other card exiled with this artifact' is a move_card_zone on linked_exile with excludeLatest:true (all but the card just exiled). OK?

### Mirrorworks

Type: Artifact

Oracle text:

> Whenever another nontoken artifact you control enters, you may pay {2}. If you do, create a token that's a copy of that artifact.

Re-rendered plain English:

```
Mirrorworks [draft]
  [a1] triggered [needed: needs trigger:subject, step:copy, field:copy.optionalCost, field:copy.srcs, field:copy.token]
    Oracle: Whenever another nontoken artifact you control enters, you may pay {2}. If you do, create a token that's a copy of that artifact.
    Trigger: Whenever a nontoken another artifact you control enters
    Effect: Copy that object.
```

Player prompts:

- Mirrorworks: optional payment: Do you want to pay {2}? If you do, create a token that's a copy of that artifact.

Implementation: needed (trigger:subject, step:copy, field:copy.optionalCost, field:copy.srcs, field:copy.token)

Questions for you:

- 'You may pay {2}. If you do, create a token copy' follows the Mind's Eye shape: optional step + optionalCost + paid_additional_cost condition. OK?

### Mycosynth Lattice

Type: Artifact

Oracle text:

> All permanents are artifacts in addition to their other types.
> All cards that aren't on the battlefield, spells, and permanents are colorless.
> Players may spend mana as though it were mana of any color.

Re-rendered plain English:

```
Mycosynth Lattice [draft]
  [a1] static [needed: needs static, static:addTypes]
    Oracle: All permanents are artifacts in addition to their other types.
    Static: Permanents are artifacts in addition to their other types
  [a2] static [needed: needs static, static:setColors]
    Oracle: All cards that aren't on the battlefield, spells, and permanents are colorless.
    Static: Cards are 
  [a3] static [needed: needs static]
    Oracle: Players may spend mana as though it were mana of any color.
    Static: Each player spend mana as though it were mana of any color
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, static:addTypes, static:setColors)

Questions for you:

- Line 2 ('all cards that aren't on the battlefield, spells, and permanents are colorless') is a static over zone:'any' with setColors:[] (empty = colorless). OK?

### Myr Battlesphere

Type: Artifact Creature — Myr Construct

Oracle text:

> When this creature enters, create four 1/1 colorless Myr artifact creature tokens.
> Whenever this creature attacks, you may tap X untapped Myr you control. If you do, this creature gets +X/+0 until end of turn and deals X damage to the player or planeswalker it's attacking.

Re-rendered plain English:

```
Myr Battlesphere [approved]
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

### Padeem, Consul of Innovation

Type: Legendary Creature — Vedalken Artificer

Oracle text:

> Artifacts you control have hexproof. (They can't be the targets of spells or abilities your opponents control.)
> At the beginning of your upkeep, if you control the artifact with the greatest mana value or tied for the greatest mana value, draw a card.

Re-rendered plain English:

```
Padeem, Consul of Innovation [approved]
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

### Pull from Tomorrow

Type: Instant

Oracle text:

> Draw X cards, then discard a card.

Re-rendered plain English:

```
Pull from Tomorrow [approved]
  [a1] spell_effect [needed: needs quantity:X]
    Oracle: Draw X cards, then discard a card.
    Effect: Draw X cards. Then, discard a card.
```

Player prompts:

- Pull from Tomorrow: discard: Choose a card to discard.

Implementation: needed (quantity:X)

### Reality Heist

Type: Instant

Oracle text:

> Affinity for artifacts (This spell costs {1} less to cast for each artifact you control.)
> Look at the top seven cards of your library. You may reveal up to two artifact cards from among them and put them into your hand. Put the rest on the bottom of your library in a random order.

Re-rendered plain English:

```
Reality Heist [draft]
  [a1] keyword [needed: needs cost_reduction]
    Oracle: Affinity for artifacts (This spell costs {1} less to cast for each artifact you control.)
    Cost reduction: this ability costs {1} less for each artifact you control
    Keyword: affinity artifacts
  [a2] spell_effect [needed: needs step:look_top, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, field:choose.upTo, step:reveal, field:move_card_zone.order, field:move_card_zone.position, field:move_card_zone.what]
    Oracle: Look at the top seven cards of your library. You may reveal up to two artifact cards from among them and put them into your hand. Put the rest on the bottom of your library in a random order.
    Effect: Look at the top seven cards of your library. Then, you may choose 2 artifact cards from among the looked-at cards. Then, reveal the chosen object. Then, put the chosen object into your hand. Then, put the rest of the looked-at cards on the bottom of your library in a random order.
```

Player prompts:

- Reality Heist: reveal artifacts: You may reveal up to two artifact cards from among the top seven cards of your library and put them into your hand.

Implementation: needed (cost_reduction, step:look_top, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, field:choose.upTo, step:reveal, field:move_card_zone.order, field:move_card_zone.position, field:move_card_zone.what)

### Reverse Engineer

Type: Sorcery

Oracle text:

> Improvise (Your artifacts can help cast this spell. Each artifact you tap after you're done activating mana abilities pays for {1}.)
> Draw three cards.

Re-rendered plain English:

```
Reverse Engineer [draft]
  [a1] keyword [needed: needs scripted:improvise, keyword:improvise]
    Oracle: Improvise (Your artifacts can help cast this spell. Each artifact you tap after you're done activating mana abilities pays for {1}.)
    Scripted (engine-specific rule, not described by the fields above): improvise
    Keyword: improvise
  [a2] spell_effect [implemented]
    Oracle: Draw three cards.
    Effect: Draw 3 cards.
```

Player prompts:

- (none: no decisions)

Implementation: needed (scripted:improvise, keyword:improvise)

### Saheeli, Sublime Artificer

Type: Legendary Planeswalker — Saheeli

Oracle text:

> Whenever you cast a noncreature spell, create a 1/1 colorless Servo artifact creature token.
> −2: Target artifact you control becomes a copy of another target artifact or creature you control until end of turn, except it's an artifact in addition to its other types.

Re-rendered plain English:

```
Saheeli, Sublime Artificer [draft]
  [a1] triggered [implemented]
    Oracle: Whenever you cast a noncreature spell, create a 1/1 colorless Servo artifact creature token.
    Trigger: Whenever you cast a noncreature spell
    Effect: Create a 1/1 colorless Servo artifact creature token.
  [a2] activated [needed: needs timing, cost:loyalty, step:copy, field:copy.exceptAddTypes, field:copy.of]
    Oracle: −2: Target artifact you control becomes a copy of another target artifact or creature you control until end of turn, except it's an artifact in addition to its other types.
    Cost: −2
    Timing: sorcery; 1 per turn
    Target t1: target artifact you control  <- prompt: "Choose target artifact you control."
    Target t2: another target artifact or creature you control  <- prompt: "Choose another target artifact or creature you control."
    Effect: Copy target artifact you control.
```

Player prompts:

- Saheeli, Sublime Artificer: choose a target: Choose target artifact you control.
- Saheeli, Sublime Artificer: choose a target: Choose another target artifact or creature you control.

Implementation: needed (timing, cost:loyalty, step:copy, field:copy.exceptAddTypes, field:copy.of)

Questions for you:

- 'Becomes a copy of another target artifact or creature until end of turn, except it's an artifact in addition' is a copy step with of:'t2', duration and exceptAddTypes:['Artifact'] (like Cursed Mirror's exceptGrant). OK?
- Loyalty costs use the {loyalty: N} cost atom (+N adds counters, -N removes) with sorcery-speed, once-per-turn timing. OK?

### Saheeli's Artistry

Type: Sorcery

Oracle text:

> Choose one or both —
> • Create a token that's a copy of target artifact.
> • Create a token that's a copy of target creature, except it's an artifact in addition to its other types.

Re-rendered plain English:

```
Saheeli's Artistry [draft]
  [a1] spell_effect [needed: needs modes, modes:multiple, step:copy, field:copy.token, field:copy.exceptAddTypes]
    Oracle: Choose one or both — / • Create a token that's a copy of target artifact. / • Create a token that's a copy of target creature, except it's an artifact in addition to its other types.
    Modes: choose 1-2  <- prompt: "Choose one or both modes."
      - Copy target artifact. (target: target artifact)
      - Copy target creature. (target: target creature)
```

Player prompts:

- Saheeli's Artistry: choose modes: Choose one or both modes.
- Saheeli's Artistry: choose a target: Choose target artifact.
- Saheeli's Artistry: choose a target: Choose target creature.

Implementation: needed (modes, modes:multiple, step:copy, field:copy.token, field:copy.exceptAddTypes)

Questions for you:

- VALIDATOR BUG: the mode check reads 'Choose one or both' as 'choose one' (regex has no 'one or both' branch) and demands choose 1..1. Workaround: the header line is left out of the ability text (marker choose_one_or_both on the ability) and the bullets are the text with modes.choose 1..2. Fix the validator (one or both = 1..2) and the header can be merged back.

### Saheeli's Directive

Type: Sorcery

Oracle text:

> Improvise (Each artifact you tap after you're done activating mana abilities pays for {1}.)
> Reveal the top X cards of your library. You may put any number of artifact cards with mana value X or less from among them onto the battlefield. Then put all cards revealed this way that weren't put onto the battlefield into your graveyard.

Re-rendered plain English:

```
Saheeli's Directive [draft]
  [a1] keyword [needed: needs scripted:improvise, keyword:improvise]
    Oracle: Improvise (Each artifact you tap after you're done activating mana abilities pays for {1}.)
    Scripted (engine-specific rule, not described by the fields above): improvise
    Keyword: improvise
  [a2] spell_effect [needed: needs step:look_top, quantity:X, field:look_top.reveal, step:choose, field:choose.anyNumber, field:choose.from, field:choose.fromLooked, field:choose.saveAs, field:move_card_zone.what]
    Oracle: Reveal the top X cards of your library. You may put any number of artifact cards with mana value X or less from among them onto the battlefield. Then put all cards revealed this way that weren't put onto the battlefield into your graveyard.
    Effect: Look at the top X cards of your library. Then, you may choose an artifact card with mana value less than or equal to X from among the looked-at cards. Then, put the chosen object onto the battlefield. Then, put the rest of the looked-at cards into your graveyard.
    X prompt: "Choose a value for X (paid in mana as part of the spell's cost)."
```

Player prompts:

- Saheeli's Directive: choose X: Choose a value for X (paid in mana as part of the spell's cost).
- Saheeli's Directive: put artifacts onto the battlefield: You may put any number of artifact cards with mana value X or less from among the revealed cards onto the battlefield.

Implementation: needed (scripted:improvise, keyword:improvise, step:look_top, quantity:X, field:look_top.reveal, step:choose, field:choose.anyNumber, field:choose.from, field:choose.fromLooked, field:choose.saveAs, field:move_card_zone.what)

Questions for you:

- 'Any number of' has no count form: written as anyNumber:true on the choose step. 'Reveal the top X cards' is look_top with reveal:true. OK?

### Shimmer Dragon

Type: Creature — Dragon

Oracle text:

> Flying
> As long as you control four or more artifacts, this creature has hexproof. (It can't be the target of spells or abilities your opponents control.)
> Tap two untapped artifacts you control: Draw a card.

Re-rendered plain English:

```
Shimmer Dragon [approved]
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

### Shivan Reef

Type: Land

Oracle text:

> {T}: Add {C}.
> {T}: Add {U} or {R}. This land deals 1 damage to you.

Re-rendered plain English:

```
Shivan Reef [draft]
  [a1] mana [implemented]
    Oracle: {T}: Add {C}.
    Cost: {T}
    Mana: add {C}
  [a2] mana [needed: needs field:damage_target.source]
    Oracle: {T}: Add {U} or {R}. This land deals 1 damage to you.
    Cost: {T}
    Effect: Shivan Reef deals 1 damage to the target.
    Mana: add {U} and {R}
```

Player prompts:

- (none: no decisions)

Implementation: needed (field:damage_target.source)

Questions for you:

- 'Add {U} or {R}': ManaSpec has no 'choose one' form. Written as one mana ability whose produces list has two single-colour entries ({U}, {R}); the convention is that several entries in one ability are alternatives the player chooses from, while a single entry like {U}{R} is all produced together. OK?
- The 1 damage a painland deals to you is a step on the mana ability (no target). OK?

### Silverbluff Bridge

Type: Artifact Land

Oracle text:

> This land enters tapped.
> Indestructible
> {T}: Add {U} or {R}.

Re-rendered plain English:

```
Silverbluff Bridge [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped.
    Replacement: If Silverbluff Bridge would enter, it enters tapped
  [a2] keyword [implemented]
    Oracle: Indestructible
    Keyword: indestructible
  [a3] mana [implemented]
    Oracle: {T}: Add {U} or {R}.
    Cost: {T}
    Mana: add {U} and {R}
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter)

Questions for you:

- 'Add {U} or {R}': ManaSpec has no 'choose one' form. Written as one mana ability whose produces list has two single-colour entries ({U}, {R}); the convention is that several entries in one ability are alternatives the player chooses from, while a single entry like {U}{R} is all produced together. OK?

### Steel Hellkite

Type: Artifact Creature — Dragon

Oracle text:

> Flying
> {2}: This creature gets +1/+0 until end of turn.
> {X}: Destroy each nonland permanent with mana value X whose controller was dealt combat damage by this creature this turn. Activate only once each turn.

Re-rendered plain English:

```
Steel Hellkite [approved]
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

### Sulfur Falls

Type: Land

Oracle text:

> This land enters tapped unless you control an Island or a Mountain.
> {T}: Add {U} or {R}.

Re-rendered plain English:

```
Sulfur Falls [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped unless you control an Island or a Mountain.
    Replacement: If Sulfur Falls would enter (only if it is not true that you control an Island or Mountain), it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {U} or {R}.
    Cost: {T}
    Mana: add {U} and {R}
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter)

Questions for you:

- 'Add {U} or {R}': ManaSpec has no 'choose one' form. Written as one mana ability whose produces list has two single-colour entries ({U}, {R}); the convention is that several entries in one ability are alternatives the player chooses from, while a single entry like {U}{R} is all produced together. OK?

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

Questions for you:

- 'When you spend this mana to cast a spell or activate an ability, copy that spell or ability' is a rider on a mana ability. Written as a copy step (optional, chooseNewTargets) on the mana ability plus a scripted marker; the kernel has no 'mana spent' trigger. OK?

### Swiftwater Cliffs

Type: Land

Oracle text:

> This land enters tapped.
> When this land enters, you gain 1 life.
> {T}: Add {U} or {R}.

Re-rendered plain English:

```
Swiftwater Cliffs [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped.
    Replacement: If Swiftwater Cliffs would enter, it enters tapped
  [a2] triggered [implemented]
    Oracle: When this land enters, you gain 1 life.
    Trigger: Whenever Swiftwater Cliffs enters
    Effect: Gain 1 life.
  [a3] mana [implemented]
    Oracle: {T}: Add {U} or {R}.
    Cost: {T}
    Mana: add {U} and {R}
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter)

Questions for you:

- 'Add {U} or {R}': ManaSpec has no 'choose one' form. Written as one mana ability whose produces list has two single-colour entries ({U}, {R}); the convention is that several entries in one ability are alternatives the player chooses from, while a single entry like {U}{R} is all produced together. OK?

### Talisman of Creativity

Type: Artifact

Oracle text:

> {T}: Add {C}.
> {T}: Add {U} or {R}. This artifact deals 1 damage to you.

Re-rendered plain English:

```
Talisman of Creativity [draft]
  [a1] mana [implemented]
    Oracle: {T}: Add {C}.
    Cost: {T}
    Mana: add {C}
  [a2] mana [needed: needs field:damage_target.source]
    Oracle: {T}: Add {U} or {R}. This artifact deals 1 damage to you.
    Cost: {T}
    Effect: Talisman of Creativity deals 1 damage to the target.
    Mana: add {U} and {R}
```

Player prompts:

- (none: no decisions)

Implementation: needed (field:damage_target.source)

Questions for you:

- 'Add {U} or {R}': ManaSpec has no 'choose one' form. Written as one mana ability whose produces list has two single-colour entries ({U}, {R}); the convention is that several entries in one ability are alternatives the player chooses from, while a single entry like {U}{R} is all produced together. OK?

### Tezzeret, Artifice Master

Type: Legendary Planeswalker — Tezzeret

Oracle text:

> +1: Create a 1/1 colorless Thopter artifact creature token with flying.
> 0: Draw a card. If you control three or more artifacts, draw two cards instead.
> −9: You get an emblem with "At the beginning of your end step, search your library for a permanent card, put it onto the battlefield, then shuffle."

Re-rendered plain English:

```
Tezzeret, Artifice Master [draft]
  [a1] activated [needed: needs timing, cost:loyalty, field:create_tokens.tokenKeywords]
    Oracle: +1: Create a 1/1 colorless Thopter artifact creature token with flying.
    Cost: +1
    Timing: sorcery; 1 per turn
    Effect: Create a 1/1 colorless Thopter artifact creature token with flying.
  [a2] activated [needed: needs timing, cost:loyalty, step:if_else, field:if_else.else, field:if_else.if, field:if_else.then]
    Oracle: 0: Draw a card. If you control three or more artifacts, draw two cards instead.
    Cost: +0
    Timing: sorcery; 1 per turn
    Effect: If you control three or more artifacts: draw 2 cards; otherwise draw a card.
  [a3] activated [needed: needs timing, cost:loyalty, step:create_emblem, field:create_emblem.emblem]
    Oracle: −9: You get an emblem with "At the beginning of your end step, search your library for a permanent card, put it onto the battlefield, then shuffle."
    Cost: −9
    Timing: sorcery; 1 per turn
    Effect: You get an emblem with "At the beginning of your end step, search your library for a permanent card, put it onto the battlefield, then shuffle.".
```

Player prompts:

- (none: no decisions)

Implementation: needed (timing, cost:loyalty, field:create_tokens.tokenKeywords, step:if_else, field:if_else.else, field:if_else.if, field:if_else.then, step:create_emblem, field:create_emblem.emblem)

Questions for you:

- Loyalty costs use the {loyalty: N} cost atom (+N adds counters, -N removes) with sorcery-speed, once-per-turn timing. OK?
- Emblems have no step kind. Written as a grant_effect step with emblem:true whose modify.grantAbility carries the emblem's ability. Should the schema get a create_emblem step?

### Thirst for Knowledge

Type: Instant

Oracle text:

> Draw three cards. Then discard two cards unless you discard an artifact card.

Re-rendered plain English:

```
Thirst for Knowledge [approved]
  [a1] spell_effect [needed: needs step:unless_pay]
    Oracle: Draw three cards. Then discard two cards unless you discard an artifact card.
    Effect: Draw 3 cards. Then, discard 2 cards unless you discard an artifact card in your hand.
```

Player prompts:

- Thirst for Knowledge: discard: Choose 2 cards to discard.
- Thirst for Knowledge: pay or not: Do you want to discard an artifact card in your hand? If you don't, discard 2 cards.

Implementation: needed (step:unless_pay)

### Thopter Assembly

Type: Artifact Creature — Thopter

Oracle text:

> Flying
> At the beginning of your upkeep, if you control no Thopters other than this creature, return this creature to its owner's hand and create five 1/1 colorless Thopter artifact creature tokens with flying.

Re-rendered plain English:

```
Thopter Assembly [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs trigger:intervening_if, predicate:not, field:create_tokens.tokenKeywords]
    Oracle: At the beginning of your upkeep, if you control no Thopters other than this creature, return this creature to its owner's hand and create five 1/1 colorless Thopter artifact creature tokens with flying.
    Trigger: At the beginning of your upkeep, if it is not true that you control an another Thopter
    Effect: Return Thopter Assembly to its owner's hand. Then, create five 1/1 colorless Thopter artifact creature tokens with flying.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:intervening_if, predicate:not, field:create_tokens.tokenKeywords)

### Thopter Spy Network

Type: Enchantment

Oracle text:

> At the beginning of your upkeep, if you control an artifact, create a 1/1 colorless Thopter artifact creature token with flying.
> Whenever one or more artifact creatures you control deal combat damage to a player, draw a card.

Re-rendered plain English:

```
Thopter Spy Network [approved]
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

### Treasure Nabber

Type: Creature — Goblin Rogue

Oracle text:

> Whenever an opponent taps an artifact for mana, gain control of that artifact until the end of your next turn.

Re-rendered plain English:

```
Treasure Nabber [draft]
  [a1] triggered [needed: needs scripted:tapped_for_mana, trigger:tap, trigger:subject, step:gain_control, duration:until_end_of_your_next_turn]
    Oracle: Whenever an opponent taps an artifact for mana, gain control of that artifact until the end of your next turn.
    Trigger: Whenever an artifact an opponent controls becomes tapped
    Effect: Gain control of that object until end of your next turn.
    Scripted (engine-specific rule, not described by the fields above): tapped_for_mana
```

Player prompts:

- (none: no decisions)

Implementation: needed (scripted:tapped_for_mana, trigger:tap, trigger:subject, step:gain_control, duration:until_end_of_your_next_turn)

Questions for you:

- 'Taps an artifact for mana' is a tap trigger plus the scripted marker tapped_for_mana (same as Forsaken Monument). OK?

### Unwinding Clock

Type: Artifact

Oracle text:

> Untap all artifacts you control during each other player's untap step.

Re-rendered plain English:

```
Unwinding Clock [draft]
  [a1] scripted [needed: needs scripted:untap_during_each_other_players_untap_step, field:untap_target.all, field:untap_target.filter]
    Oracle: Untap all artifacts you control during each other player's untap step.
    Effect: Untap the target.
    Scripted (engine-specific rule, not described by the fields above): untap_during_each_other_players_untap_step
```

Player prompts:

- (none: no decisions)

Implementation: needed (scripted:untap_during_each_other_players_untap_step, field:untap_target.all, field:untap_target.filter)

Questions for you:

- 'Untap all artifacts you control during each other player's untap step' is a turn-based action, not a trigger, so it is a scripted ability with an untap_target step. Should the schema get a step-based static ('during <step>')?

### Vedalken Humiliator

Type: Creature — Vedalken Wizard

Oracle text:

> Metalcraft — Whenever this creature attacks, if you control three or more artifacts, creatures your opponents control lose all abilities and have base power and toughness 1/1 until end of turn.

Re-rendered plain English:

```
Vedalken Humiliator [draft]
  [a1] triggered [needed: needs trigger:intervening_if, step:grant_effect, field:grant_effect.all, field:grant_effect.filter, field:grant_effect.modify]
    Oracle: Metalcraft — Whenever this creature attacks, if you control three or more artifacts, creatures your opponents control lose all abilities and have base power and toughness 1/1 until end of turn.
    Trigger: Whenever Vedalken Humiliator attacks, if you control three or more artifacts
    Effect: The target loses all abilities and has base power and toughness 1/1 until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:intervening_if, step:grant_effect, field:grant_effect.all, field:grant_effect.filter, field:grant_effect.modify)

Questions for you:

- Metalcraft is the intervening-if 'controls three or more artifacts'. 'Lose all abilities' is a lose entry in the grant_effect modify list. OK?

## Kernel to-do: missing capabilities across this deck

| capability | cards | needing it |
|---|---|---|
| `static` | 15 | Brudiclad, Telchor Engineer; Chief of the Foundry; Darksteel Forge; Darksteel Juggernaut; Enthusiastic Mechanaut; Etherium Sculptor; Forsaken Monument; Foundry Inspector; Mycosynth Lattice; Padeem, Consul of Innovation; Reliquary Tower; Shimmer Dragon; Skullclamp; Swiftfoot Boots; Thopter Engineer |
| `field:create_tokens.tokenKeywords` | 10 | Ancient Stone Idol; Loyal Apprentice; Sharding Sphinx; Swan Song; Tezzeret, Artifice Master; Thopter Assembly; Thopter Engineer; Thopter Spy Network; Triplicate Titan; Whirler Rogue |
| `replacement:would_enter` | 8 | Archway of Innovation; Frostboil Snarl; Izzet Boilerworks; Silverbluff Bridge; Sulfur Falls; Sunken Palace; Swiftwater Cliffs; Worn Powerstone |
| `trigger:subject` | 8 | Forsaken Monument; Jhoira, Weatherlight Captain; Mimic Vat; Mirrorworks; Sharding Sphinx; Skullclamp; Thopter Spy Network; Treasure Nabber |
| `field:grant_effect.modify` | 7 | Saheeli, the Gifted; Archway of Innovation; Finale of Revelation; Loyal Apprentice; Memnarch; Vedalken Humiliator; Whirler Rogue |
| `step:copy` | 7 | Saheeli, the Gifted; Brudiclad, Telchor Engineer; Mimic Vat; Mirrorworks; Saheeli, Sublime Artificer; Saheeli's Artistry; Sunken Palace |
| `step:grant_effect` | 7 | Saheeli, the Gifted; Archway of Innovation; Finale of Revelation; Loyal Apprentice; Memnarch; Vedalken Humiliator; Whirler Rogue |
| `mana:variable` | 6 | Arcane Signet; Command Tower; Fellwar Stone; Gilded Lotus; Ornithopter of Paradise; Prismatic Lens |
| `timing` | 6 | Saheeli, the Gifted; Daretti, Scrap Savant; Idol of Oblivion; Saheeli, Sublime Artificer; Steel Hellkite; Tezzeret, Artifice Master |
| `trigger:intervening_if` | 6 | Loyal Apprentice; Loyal Drake; Padeem, Consul of Innovation; Thopter Assembly; Thopter Spy Network; Vedalken Humiliator |
| `cost_reduction` | 5 | Ancient Stone Idol; Blasphemous Act; Emry, Lurker of the Loch; Reality Heist; Thought Monitor |
| `field:choose.from` | 5 | Brudiclad, Telchor Engineer; Izzet Boilerworks; Myr Battlesphere; Reality Heist; Saheeli's Directive |
| `field:choose.saveAs` | 5 | Brudiclad, Telchor Engineer; Izzet Boilerworks; Myr Battlesphere; Reality Heist; Saheeli's Directive |
| `step:choose` | 5 | Brudiclad, Telchor Engineer; Izzet Boilerworks; Myr Battlesphere; Reality Heist; Saheeli's Directive |
| `cost:loyalty` | 4 | Saheeli, the Gifted; Daretti, Scrap Savant; Saheeli, Sublime Artificer; Tezzeret, Artifice Master |
| `field:copy.token` | 4 | Saheeli, the Gifted; Mimic Vat; Mirrorworks; Saheeli's Artistry |
| `predicate:step_done` | 4 | Brudiclad, Telchor Engineer; Daretti, Scrap Savant; Frostboil Snarl; Mimic Vat |
| `quantity:X` | 4 | Delete; Finale of Revelation; Pull from Tomorrow; Saheeli's Directive |
| `cost:sacrifice` | 3 | Buried Ruin; Hedron Archive; Idol of Oblivion |
| `field:choose.count` | 3 | Brudiclad, Telchor Engineer; Izzet Boilerworks; Reality Heist |
| `field:if_else.if` | 3 | Chaos Warp; Finale of Revelation; Tezzeret, Artifice Master |
| `field:if_else.then` | 3 | Chaos Warp; Finale of Revelation; Tezzeret, Artifice Master |
| `step:if_else` | 3 | Chaos Warp; Finale of Revelation; Tezzeret, Artifice Master |
| `step:reveal` | 3 | Chaos Warp; Frostboil Snarl; Reality Heist |
| `cast_option` | 2 | Ancient Stone Idol; Blasphemous Act |
| `cost:tapOther` | 2 | Shimmer Dragon; Whirler Rogue |
| `field:attach.to` | 2 | Skullclamp; Swiftfoot Boots |
| `field:attach.what` | 2 | Skullclamp; Swiftfoot Boots |
| `field:choose.anyNumber` | 2 | Myr Battlesphere; Saheeli's Directive |
| `field:choose.fromLooked` | 2 | Reality Heist; Saheeli's Directive |
| `field:copy.exceptAddTypes` | 2 | Saheeli, Sublime Artificer; Saheeli's Artistry |
| `field:copy.exileAt` | 2 | Saheeli, the Gifted; Mimic Vat |
| `field:copy.gainKeywords` | 2 | Saheeli, the Gifted; Mimic Vat |
| `field:copy.of` | 2 | Brudiclad, Telchor Engineer; Saheeli, Sublime Artificer |
| `field:create_emblem.emblem` | 2 | Daretti, Scrap Savant; Tezzeret, Artifice Master |
| `field:damage_target.all` | 2 | Blasphemous Act; Delete |
| `field:damage_target.filter` | 2 | Blasphemous Act; Delete |
| `field:damage_target.source` | 2 | Shivan Reef; Talisman of Creativity |
| `field:grant_effect.appliesTo` | 2 | Saheeli, the Gifted; Archway of Innovation |
| `field:if_else.else` | 2 | Finale of Revelation; Tezzeret, Artifice Master |
| `field:move_card_zone.all` | 2 | Finale of Revelation; Mimic Vat |
| `field:move_card_zone.from` | 2 | Finale of Revelation; Mimic Vat |
| `field:move_card_zone.what` | 2 | Reality Heist; Saheeli's Directive |
| `field:untap_target.filter` | 2 | Finale of Revelation; Unwinding Clock |
| `filter:isCommander` | 2 | Loyal Apprentice; Loyal Drake |
| `keyword:improvise` | 2 | Reverse Engineer; Saheeli's Directive |
| `predicate:not` | 2 | Frostboil Snarl; Thopter Assembly |
| `scripted:can_be_your_commander` | 2 | Saheeli, the Gifted; Daretti, Scrap Savant |
| `scripted:improvise` | 2 | Reverse Engineer; Saheeli's Directive |
| `scripted:next_spell_gains_keyword` | 2 | Saheeli, the Gifted; Archway of Innovation |
| `step:attach` | 2 | Skullclamp; Swiftfoot Boots |
| `step:counter_spell` | 2 | Counterspell; Swan Song |
| `step:create_emblem` | 2 | Daretti, Scrap Savant; Tezzeret, Artifice Master |
| `step:gain_control` | 2 | Memnarch; Treasure Nabber |
| `step:look_top` | 2 | Reality Heist; Saheeli's Directive |
| `trigger:tap` | 2 | Forsaken Monument; Treasure Nabber |
| `cost:exileFrom` | 1 | Sunken Palace |
| `cost:x` | 1 | Steel Hellkite |
| `duration:until_end_of_your_next_turn` | 1 | Treasure Nabber |
| `field:add_counters.on` | 1 | Mind Unbound |
| `field:add_mana.produces` | 1 | Forsaken Monument |
| `field:choose.upTo` | 1 | Reality Heist |
| `field:copy.all` | 1 | Brudiclad, Telchor Engineer |
| `field:copy.becomes` | 1 | Brudiclad, Telchor Engineer |
| `field:copy.chooseNewTargets` | 1 | Sunken Palace |
| `field:copy.excludeChosen` | 1 | Brudiclad, Telchor Engineer |
| `field:copy.filter` | 1 | Brudiclad, Telchor Engineer |
| `field:copy.optionalCost` | 1 | Mirrorworks |
| `field:copy.srcs` | 1 | Mirrorworks |
| `field:create_tokens.who` | 1 | Swan Song |
| `field:damage_target.who` | 1 | Delete |
| `field:destroy_all.filter` | 1 | Steel Hellkite |
| `field:discard.upTo` | 1 | Daretti, Scrap Savant |
| `field:exile_target.linkExile` | 1 | Mimic Vat |
| `field:grant_effect.all` | 1 | Vedalken Humiliator |
| `field:grant_effect.filter` | 1 | Vedalken Humiliator |
| `field:look_top.reveal` | 1 | Saheeli's Directive |
| `field:move_card_zone.excludeLatest` | 1 | Mimic Vat |
| `field:move_card_zone.filter` | 1 | Mimic Vat |
| `field:move_card_zone.order` | 1 | Reality Heist |
| `field:move_card_zone.position` | 1 | Reality Heist |
| `field:move_card_zone.shuffle` | 1 | Chaos Warp |
| `field:move_card_zone.who` | 1 | Chaos Warp |
| `field:repeat_for_each.over` | 1 | Saheeli, the Gifted |
| `field:repeat_for_each.steps` | 1 | Saheeli, the Gifted |
| `field:reveal.filter` | 1 | Frostboil Snarl |
| `field:reveal.saveAs` | 1 | Chaos Warp |
| `field:reveal.what` | 1 | Chaos Warp |
| `field:reveal.who` | 1 | Chaos Warp |
| `field:sacrifice_permanent.amount` | 1 | Daretti, Scrap Savant |
| `field:sacrifice_permanent.filter` | 1 | Daretti, Scrap Savant |
| `field:untap_target.all` | 1 | Unwinding Clock |
| `field:untap_target.amount` | 1 | Finale of Revelation |
| `field:untap_target.upTo` | 1 | Finale of Revelation |
| `modes` | 1 | Saheeli's Artistry |
| `modes:multiple` | 1 | Saheeli's Artistry |
| `predicate:compare` | 1 | Finale of Revelation |
| `predicate:matches` | 1 | Chaos Warp |
| `quantity:count` | 1 | Hellkite Igniter |
| `quantity:counters` | 1 | Mind Unbound |
| `quantity:event_amount` | 1 | Daretti, Scrap Savant |
| `quantity:math` | 1 | Crackle with Power |
| `quantity:step_result` | 1 | Myr Battlesphere |
| `ref:created` | 1 | Loyal Apprentice |
| `ref:linked_exile` | 1 | Mimic Vat |
| `scripted:copy_spell_or_ability_when_mana_spent` | 1 | Sunken Palace |
| `scripted:mana_colors_an_opponent_land_could_produce` | 1 | Fellwar Stone |
| `scripted:tapped_for_colorless_mana` | 1 | Forsaken Monument |
| `scripted:tapped_for_mana` | 1 | Treasure Nabber |
| `scripted:untap_during_each_other_players_untap_step` | 1 | Unwinding Clock |
| `static:addTypes` | 1 | Mycosynth Lattice |
| `static:mustAttack` | 1 | Darksteel Juggernaut |
| `static:setBasePT` | 1 | Darksteel Juggernaut |
| `static:setColors` | 1 | Mycosynth Lattice |
| `step:add_counters` | 1 | Mind Unbound |
| `step:add_mana` | 1 | Forsaken Monument |
| `step:permission_to_play` | 1 | Emry, Lurker of the Loch |
| `step:repeat_for_each` | 1 | Saheeli, the Gifted |
| `step:shuffle` | 1 | Finale of Revelation |
| `step:unless_pay` | 1 | Thirst for Knowledge |
| `targets:multi` | 1 | Crackle with Power |
| `targets:variable_count` | 1 | Crackle with Power |
| `trigger:batch` | 1 | Thopter Spy Network |
