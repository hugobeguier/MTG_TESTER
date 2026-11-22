# Kernel draft approval: Wretched Ranks

68 unique cards: 42 simple (A), 26 complex (B). Validator: 68/68 pass. Cards with implementation "needed": 60. All drafts are `review.status: "draft"`; nothing was written to the DB.

Reading guide: each card below shows the oracle text and what the structured JSON says back in plain English. Approve if they match.

## (A) Simple cards: spot-check one line each

- **Ambition's Cost** (Sorcery): Draw 3 cards, then lose 3 life [implemented]
- **Arcane Signet** (Artifact): {T}: add one mana of any color in your commander's color identity [needs: mana:variable]
- **Bad Moon** (Enchantment): Black creatures get +1/+1 [needs: static]
- **Bojuka Bog** (Land): If Bojuka Bog would enter, it enters tapped | Whenever Bojuka Bog enters: [targets: target player] Exile a card | {T}: add {B} [needs: replacement:would_enter, field:move_card_zone.what]
- **Carrion Feeder** (Creature — Zombie): Carrion Feeder can't block | sacrifice a creature you control: Put a +1/+1 counter on Carrion Feeder [needs: static, cost:sacrifice, step:add_counters, field:add_counters.on]
- **Cemetery Reaper** (Creature — Zombie): Other Zombies you control get +1/+1 | {2}{B}, {T}: [targets: target creature card in a graveyard] Exile target creature card in a graveyard, then create a 2/2 black Zombie creature token [needs: static]
- **Champion of the Perished** (Creature — Zombie): Whenever an another Zombie you control enters: Put a +1/+1 counter on Champion of the Perished [needs: trigger:subject, step:add_counters, field:add_counters.on]
- **Charcoal Diamond** (Artifact): If Charcoal Diamond would enter, it enters tapped | {T}: add {B} [needs: replacement:would_enter]
- **Commander's Sphere** (Artifact): {T}: add one mana of any color in your commander's color identity | sacrifice Commander's Sphere: Draw a card [needs: mana:variable, cost:sacrifice]
- **Cryptbreaker** (Creature — Zombie): {1}{B}, {T}, discard a card in a hand: Create a 2/2 black Zombie creature token | tap 3 untapped untapped Zombies you control: Draw a card, then lose 1 life [needs: cost:discard, cost:tapOther]
- **Death Baron** (Creature — Zombie Wizard): Skeletons or other Zombies you control get +1/+1 and have deathtouch [needs: static]
- **Diregraf Colossus** (Creature — Zombie Giant): If Diregraf Colossus would enter, modify it: {"counters":{"kind":"+1/+1","amount":{"ref":"count","of":{"subtypes":["Zombie"],"zone":"graveyard","owner":"you"}}}} | Whenever you cast a Zombie spell: Create a 2/2 black Zombie creature token tapped [needs: replacement:would_enter, field:create_tokens.tokenTapped]
- **Disciple of Griselbrand** (Creature — Human Cleric): {1}, sacrifice a creature you control: Gain the sacrificed permanent's toughness life [needs: ref:sacrificed, cost:sacrifice, quantity:stat, field:life_change.amount]
- **Dissection Tools** (Artifact — Equipment): Whenever Dissection Tools enters: Manifest dread, then attach Dissection Tools to the token just created | The equipped creature gets +2/+2 and has deathtouch and has lifelink | sacrifice a creature you control: [targets: target creature you control] Attach Dissection Tools to target creature you control [needs: ref:created, step:manifest_dread, step:attach, field:attach.to, field:attach.what, static, cost:sacrifice]
- **Fleshbag Marauder** (Creature — Zombie Warrior): Whenever Fleshbag Marauder enters: Each player sacrifices a creature [needs: field:sacrifice_permanent.filter, field:sacrifice_permanent.who]
- **Geier Reach Sanitarium** (Legendary Land): {T}: add {C} | {2}, {T}: Each player draws a card, then each player discard a card [needs: field:draw_cards.who, field:discard.who]
- **Go for the Throat** (Instant): [targets: target nonartifact creature] Destroy target nonartifact creature [implemented]
- **Grave Titan** (Creature — Giant): Keyword deathtouch | Whenever Grave Titan enters or attacks: Create two 2/2 black Zombie creature tokens [needs: trigger:multi_event]
- **Gravespawn Sovereign** (Creature — Zombie): tap 5 untapped untapped Zombies you control: [targets: target creature card in a graveyard] Return target creature card in a graveyard from the graveyard to the battlefield [needs: cost:tapOther]
- **Headless Rider** (Creature — Zombie): Whenever a nontoken Zombie you control dies: Create a 2/2 black Zombie creature token [needs: trigger:subject]
- **Lashwrithe** (Artifact — Equipment): Whenever Lashwrithe enters: Create a 0/0 black Phyrexian Germ creature token, then attach Lashwrithe to the token just created | The equipped creature gets +X/+X, where X is the number of Swamps you control | {B/P}{B/P}: [targets: target creature you control] Attach Lashwrithe to target creature you control [needs: ref:created, step:attach, field:attach.to, field:attach.what, static]
- **Liliana's Mastery** (Enchantment): Zombies you control get +1/+1 | Whenever Liliana's Mastery enters: Create two 2/2 black Zombie creature tokens [needs: static]
- **Lord of the Undead** (Creature — Zombie): Other Zombies get +1/+1 | {1}{B}, {T}: [targets: target Zombie card in your graveyard] Put target Zombie card in your graveyard into your hand [needs: static]
- **Memorial to Folly** (Land): If Memorial to Folly would enter, it enters tapped | {T}: add {B} | {2}{B}, {T}, sacrifice Memorial to Folly: [targets: target creature card in your graveyard] Put target creature card in your graveyard into your hand [needs: replacement:would_enter, cost:sacrifice]
- **Midnight Reaper** (Creature — Zombie Knight): Whenever a nontoken creature you control dies: Deal 1 damage to the target, then draw a card [needs: trigger:subject]
- **Mind Stone** (Artifact): {T}: add {C} | {1}, {T}, sacrifice Mind Stone: Draw a card [needs: cost:sacrifice]
- **Mire Triton** (Creature — Zombie Merfolk): Keyword deathtouch | Whenever Mire Triton enters: Mill 2 cards, then gain 2 life [implemented]
- **Necrotic Hex** (Sorcery): Each player sacrifices a creature, then create six 2/2 black Zombie creature tokens tapped [needs: field:sacrifice_permanent.amount, field:sacrifice_permanent.filter, field:sacrifice_permanent.who, field:create_tokens.tokenTapped]
- **Night's Whisper** (Sorcery): Draw 2 cards, then lose 2 life [implemented]
- **Phyrexian Arena** (Enchantment): At the beginning of your upkeep: Draw a card, then lose 1 life [implemented]
- **Phyrexian Reclamation** (Enchantment): {1}{B}, pay 2 life: [targets: target creature card in your graveyard] Put target creature card in your graveyard into your hand [needs: cost:life]
- **Sol Ring** (Artifact): {T}: add {C}{C} [implemented]
- **Soulless One** (Creature — Zombie Avatar): Soulless One has power and toughness each equal to the number of Zombies + the number of Zombie cards in a graveyard [needs: static, static:setBasePT]
- **Stoneforge Masterwork** (Artifact — Equipment): The equipped creature gets +X/+X, where X is the number of other creatures that shares a creature type with the equipped creature you control | {2}: [targets: target creature you control] Attach Stoneforge Masterwork to target creature you control [needs: static, filter:sharesCreatureTypeWith, step:attach, field:attach.to, field:attach.what]
- **Swamp** (Basic Land — Swamp): {T}: add {B} [implemented]
- **Umbral Collar Zealot** (Creature — Human Cleric): sacrifice a creature or artifact you control: Surveil 1 [needs: cost:sacrifice, step:surveil]
- **Undead Augur** (Creature — Zombie Wizard): Whenever a Zombie you control dies: Draw a card, then lose 1 life [needs: trigger:subject]
- **Undead Butler** (Creature — Zombie): Whenever Undead Butler enters: Mill 3 cards | Whenever Undead Butler dies: [targets: target creature card in your graveyard] You may exile Undead Butler, then put target creature card in your graveyard into your hand [needs: field:move_card_zone.reflexive, predicate:step_done]
- **Undead Warchief** (Creature — Zombie): Zombie spells you cast cost {1} less to cast | Zombies you control get +2/+1 [needs: static]
- **Wight of Precinct Six** (Creature — Zombie): Wight of Precinct Six gets +X/+X, where X is the number of creature cards in an opponent's graveyard [needs: static]
- **Withering Torment** (Instant): [targets: target creature or enchantment] Destroy target creature or enchantment, then lose 2 life [implemented]
- **Zul Ashur, Lich Lord** (Legendary Creature — Zombie Warlock): Whenever Zul Ashur, Lich Lord becomes the target of a spell or ability: Counter that object | {T}: [targets: target Zombie card in your graveyard] You may you may play t1 until end of turn [needs: trigger:becomes_target, step:counter_spell, step:unless_pay, step:permission_to_play, field:permission_to_play.what, field:permission_to_play.zone]

## (B) Complex cards

### Ghoulcaller Gisa

Type: Legendary Creature — Human Wizard

Oracle text:

> {B}, {T}, Sacrifice another creature: Create X 2/2 black Zombie creature tokens, where X is the sacrificed creature's power.

Re-rendered plain English:

```
Ghoulcaller Gisa [draft]
  [a1] activated [needed: needs ref:sacrificed, cost:sacrifice, quantity:stat]
    Oracle: {B}, {T}, Sacrifice another creature: Create X 2/2 black Zombie creature tokens, where X is the sacrificed creature's power.
    Cost: {B}, {T}, sacrifice an another creature you control
    Effect: Create the sacrificed permanent's power 2/2 black Zombie creature tokens.
```

Player prompts:

- Ghoulcaller Gisa: choose what to sacrifice: Choose 1 another creature you control to sacrifice.

Implementation: needed (ref:sacrificed, cost:sacrifice, quantity:stat)

### Army of the Damned

Type: Sorcery

Oracle text:

> Create thirteen tapped 2/2 black Zombie creature tokens.
> Flashback {7}{B}{B}{B} (You may cast this card from your graveyard for its flashback cost. Then exile it.)

Re-rendered plain English:

```
Army of the Damned [draft]
  Cast option c1: you may use flashback (from graveyard, cost {7}{B}{B}{B}, replaces mana cost) [needed]
  [a1] spell_effect [needed: needs field:create_tokens.tokenTapped]
    Oracle: Create thirteen tapped 2/2 black Zombie creature tokens.
    Effect: Create thirteen 2/2 black Zombie creature tokens tapped.
```

Player prompts:

- Army of the Damned: flashback option: Do you want to cast it using its flashback cost ({7}{B}{B}{B})?

Implementation: needed (field:create_tokens.tokenTapped, cast_option:flashback)

### Ayara, First of Locthwain

Type: Legendary Creature — Elf Noble

Oracle text:

> Whenever Ayara or another black creature you control enters, each opponent loses 1 life and you gain 1 life.
> {T}, Sacrifice another black creature: Draw a card.

Re-rendered plain English:

```
Ayara, First of Locthwain [draft]
  [a1] triggered [needed: needs trigger:subject, field:life_change.who]
    Oracle: Whenever Ayara or another black creature you control enters, each opponent loses 1 life and you gain 1 life.
    Trigger: Whenever a black creature you control enters
    Effect: Each opponent loses 1 life. Then, gain 1 life.
  [a2] activated [needed: needs cost:sacrifice]
    Oracle: {T}, Sacrifice another black creature: Draw a card.
    Cost: {T}, sacrifice an another black creature you control
    Effect: Draw a card.
```

Player prompts:

- Ayara, First of Locthwain: choose what to sacrifice: Choose 1 another black creature you control to sacrifice.

Implementation: needed (trigger:subject, field:life_change.who, cost:sacrifice)

### Barren Moor

Type: Land

Oracle text:

> This land enters tapped.
> {T}: Add {B}.
> Cycling {B} ({B}, Discard this card: Draw a card.)

Re-rendered plain English:

```
Barren Moor [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped.
    Replacement: If Barren Moor would enter, it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {B}.
    Cost: {T}
    Mana: add {B}
  [a3] activated (from hand) [needed: needs zone:hand, cost:discard]
    Oracle: Cycling {B} ({B}, Discard this card: Draw a card.)
    Cost: {B}, discard Barren Moor
    Effect: Draw a card.
    Keyword: cycling
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter, zone:hand, cost:discard)

### Bonehoard

Type: Artifact — Equipment

Oracle text:

> Living weapon (When this Equipment enters, create a 0/0 black Phyrexian Germ creature token, then attach this to it.)
> Equipped creature gets +X/+X, where X is the number of creature cards in all graveyards.
> Equip {2}

Re-rendered plain English:

```
Bonehoard [draft]
  [a1] triggered [needed: needs ref:created, step:attach, field:attach.to, field:attach.what]
    Oracle: Living weapon (When this Equipment enters, create a 0/0 black Phyrexian Germ creature token, then attach this to it.)
    Trigger: Whenever Bonehoard enters
    Effect: Create a 0/0 black Phyrexian Germ creature token. Then, attach Bonehoard to the token just created.
    Keyword: living_weapon
  [a2] static [needed: needs static]
    Oracle: Equipped creature gets +X/+X, where X is the number of creature cards in all graveyards.
    Static: The equipped creature gets +X/+X, where X is the number of creature cards in a graveyard
  [a3] activated [needed: needs step:attach, field:attach.to, field:attach.what]
    Oracle: Equip {2}
    Cost: {2}
    Timing: sorcery
    Target t1: target creature you control  <- prompt: "Choose target creature you control."
    Effect: Attach Bonehoard to target creature you control.
    Keyword: equip
```

Player prompts:

- Bonehoard: choose a target: Choose target creature you control.

Implementation: needed (ref:created, step:attach, field:attach.to, field:attach.what, static)

### Bontu's Monument

Type: Legendary Artifact

Oracle text:

> Black creature spells you cast cost {1} less to cast.
> Whenever you cast a creature spell, each opponent loses 1 life and you gain 1 life.

Re-rendered plain English:

```
Bontu's Monument [draft]
  [a1] static [needed: needs static]
    Oracle: Black creature spells you cast cost {1} less to cast.
    Static: Black creature spells you cast cost {1} less to cast
  [a2] triggered [needed: needs field:life_change.who]
    Oracle: Whenever you cast a creature spell, each opponent loses 1 life and you gain 1 life.
    Trigger: Whenever you cast a creature spell
    Effect: Each opponent loses 1 life. Then, gain 1 life.
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, field:life_change.who)

### Castle Locthwain

Type: Land

Oracle text:

> This land enters tapped unless you control a Swamp.
> {T}: Add {B}.
> {1}{B}{B}, {T}: Draw a card, then you lose life equal to the number of cards in your hand.

Re-rendered plain English:

```
Castle Locthwain [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped unless you control a Swamp.
    Replacement: If Castle Locthwain would enter (only if it is not true that you control a Swamp), it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {B}.
    Cost: {T}
    Mana: add {B}
  [a3] activated [needed: needs quantity:count, field:life_change.amount, field:life_change.lose]
    Oracle: {1}{B}{B}, {T}: Draw a card, then you lose life equal to the number of cards in your hand.
    Cost: {1}{B}{B}, {T}
    Effect: Draw a card. Then, gain the number of cards in your hand life.
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter, quantity:count, field:life_change.amount, field:life_change.lose)

### Cemetery Recruitment

Type: Sorcery

Oracle text:

> Return target creature card from your graveyard to your hand. If it's a Zombie card, draw a card.

Re-rendered plain English:

```
Cemetery Recruitment [draft]
  [a1] spell_effect [needed: needs predicate:matches]
    Oracle: Return target creature card from your graveyard to your hand. If it's a Zombie card, draw a card.
    Target t1: target creature card in your graveyard  <- prompt: "Choose target creature card in your graveyard."
    Effect: Put target creature card in your graveyard into your hand. Then, IF t1 is a Zombie: draw a card.
```

Player prompts:

- Cemetery Recruitment: choose a target: Choose target creature card in your graveyard.

Implementation: needed (predicate:matches)

### Cemetery Tampering

Type: Enchantment

Oracle text:

> Hideaway 5 (When this enchantment enters, look at the top five cards of your library, exile one face down, then put the rest on the bottom in a random order.)
> At the beginning of your upkeep, you may mill three cards. Then if there are twenty or more cards in your graveyard, you may play the exiled card without paying its mana cost.

Re-rendered plain English:

```
Cemetery Tampering [draft]
  [a1] triggered [needed: needs step:look_top, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, field:move_card_zone.faceDown, field:move_card_zone.linkExile, field:move_card_zone.order, field:move_card_zone.position, field:move_card_zone.what]
    Oracle: Hideaway 5 (When this enchantment enters, look at the top five cards of your library, exile one face down, then put the rest on the bottom in a random order.)
    Trigger: Whenever Cemetery Tampering enters
    Effect: Look at the top five cards of your library. Then, choose a card from among the looked-at cards. Then, exile the chosen object face down. Then, put the rest of the looked-at cards on the bottom of your library in a random order.
    Keyword: hideaway 5
  [a2] triggered [needed: needs ref:linked_exile, step:permission_to_play, field:permission_to_play.what, field:permission_to_play.withoutPaying, field:permission_to_play.zone]
    Oracle: At the beginning of your upkeep, you may mill three cards. Then if there are twenty or more cards in your graveyard, you may play the exiled card without paying its mana cost.
    Trigger: At the beginning of your upkeep
    Effect: You may mill 3 cards. Then, IF you have 20 or greater cards in graveyard: you may you may play linked_exile without paying its mana cost.
```

Player prompts:

- Cemetery Tampering: choose: Choose a card from among the looked-at cards.
- Cemetery Tampering: optional: Do you want to mill 3 cards?
- Cemetery Tampering: optional: Do you want to you may play linked_exile without paying its mana cost?

Implementation: needed (step:look_top, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, field:move_card_zone.faceDown, field:move_card_zone.linkExile, field:move_card_zone.order, field:move_card_zone.position, field:move_card_zone.what, ref:linked_exile, step:permission_to_play, field:permission_to_play.what, field:permission_to_play.withoutPaying, field:permission_to_play.zone)

### Consumed by Greed

Type: Instant

Oracle text:

> Gift a card (You may promise an opponent a gift as you cast this spell. If you do, they draw a card before its other effects.)
> Target opponent sacrifices a creature with the greatest power among creatures they control. If the gift was promised, return target creature card from your graveyard to your hand.

Re-rendered plain English:

```
Consumed by Greed [draft]
  Cast option c1: you may use gift (from hand, cost ) [needed]
  [a1] spell_effect [needed: needs targets:multi, field:sacrifice_permanent.filter, field:sacrifice_permanent.greatestPower, field:sacrifice_permanent.who, predicate:paid_additional_cost]
    Oracle: Target opponent sacrifices a creature with the greatest power among creatures they control. If the gift was promised, return target creature card from your graveyard to your hand.
    Target t1: target player  <- prompt: "Choose target player."
    Target t2: up to one target creature card in your graveyard  <- prompt: "Choose up to one target creature card in your graveyard."
    Effect: Target player sacrifices a creature. Then, IF the additional cost (gift) was paid: put up to one target creature card in your graveyard into your hand.
```

Player prompts:

- Consumed by Greed: choose a target: Choose target player.
- Consumed by Greed: choose a target: Choose up to one target creature card in your graveyard.
- Consumed by Greed: sacrifice: Choose a permanent to sacrifice.
- Consumed by Greed: gift: Do you want to promise a card to an opponent? If you do, choose that opponent.

Implementation: needed (targets:multi, field:sacrifice_permanent.filter, field:sacrifice_permanent.greatestPower, field:sacrifice_permanent.who, predicate:paid_additional_cost, cast_option:gift, field:draw_cards.who)

### Consuming Corruption

Type: Instant

Oracle text:

> Consuming Corruption deals X damage to target creature or planeswalker and you gain X life, where X is the number of Swamps you control.

Re-rendered plain English:

```
Consuming Corruption [draft]
  [a1] spell_effect [needed: needs quantity:count, field:life_change.amount]
    Oracle: Consuming Corruption deals X damage to target creature or planeswalker and you gain X life, where X is the number of Swamps you control.
    Target t1: target creature or planeswalker  <- prompt: "Choose target creature or planeswalker."
    Effect: Deal the number of Swamps you control damage to target creature or planeswalker. Then, gain the number of Swamps you control life.
```

Player prompts:

- Consuming Corruption: choose a target: Choose target creature or planeswalker.

Implementation: needed (quantity:count, field:life_change.amount)

### Crown of Gondor

Type: Legendary Artifact — Equipment

Oracle text:

> Equipped creature gets +1/+1 for each creature you control.
> When a legendary creature you control enters, if there is no monarch, you become the monarch.
> Equip {4}. This ability costs {3} less to activate if you're the monarch.

Re-rendered plain English:

```
Crown of Gondor [draft]
  [a1] static [needed: needs static]
    Oracle: Equipped creature gets +1/+1 for each creature you control.
    Static: The equipped creature gets +X/+X, where X is the number of creatures you control
  [a2] triggered [needed: needs scripted:become_monarch, trigger:intervening_if, predicate:stat, trigger:subject]
    Oracle: When a legendary creature you control enters, if there is no monarch, you become the monarch.
    Trigger: Whenever a legendary creature you control enters, if Crown of Gondor's monarch exists is 0
    Scripted (engine-specific rule, not described by the fields above): become_monarch
  [a3] activated [needed: needs cost_reduction, cost_reduction:conditional, predicate:stat, step:attach, field:attach.to, field:attach.what]
    Oracle: Equip {4}. This ability costs {3} less to activate if you're the monarch.
    Cost: {4}
    Timing: sorcery
    Target t1: target creature you control  <- prompt: "Choose target creature you control."
    Effect: Attach Crown of Gondor to target creature you control.
    Cost reduction: this ability costs {3} less if the controller of Crown of Gondor is the monarch
    Keyword: equip
```

Player prompts:

- Crown of Gondor: choose a target: Choose target creature you control.

Implementation: needed (static, scripted:become_monarch, trigger:intervening_if, predicate:stat, trigger:subject, cost_reduction, cost_reduction:conditional, step:attach, field:attach.to, field:attach.what)

### Disciple of Bolas

Type: Creature — Human Wizard

Oracle text:

> When this creature enters, sacrifice another creature. You gain X life and draw X cards, where X is that creature's power.

Re-rendered plain English:

```
Disciple of Bolas [draft]
  [a1] triggered [needed: needs ref:sacrificed, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, quantity:stat, field:life_change.amount]
    Oracle: When this creature enters, sacrifice another creature. You gain X life and draw X cards, where X is that creature's power.
    Trigger: Whenever Disciple of Bolas enters
    Effect: Choose an another creature you control. Then, sacrifice a permanent. Then, gain the sacrificed permanent's power life. Then, draw the sacrificed permanent's power cards.
```

Player prompts:

- Disciple of Bolas: choose: Choose an another creature you control.
- Disciple of Bolas: sacrifice: Choose a permanent to sacrifice.

Implementation: needed (ref:sacrificed, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, quantity:stat, field:life_change.amount)

### Endless Ranks of the Dead

Type: Enchantment

Oracle text:

> At the beginning of your upkeep, create X 2/2 black Zombie creature tokens, where X is half the number of Zombies you control, rounded down.

Re-rendered plain English:

```
Endless Ranks of the Dead [draft]
  [a1] triggered [needed: needs quantity:division, quantity:math]
    Oracle: At the beginning of your upkeep, create X 2/2 black Zombie creature tokens, where X is half the number of Zombies you control, rounded down.
    Trigger: At the beginning of your upkeep
    Effect: Create the number of Zombies you control divided by 2, rounded down 2/2 black Zombie creature tokens.
```

Player prompts:

- (none: no decisions)

Implementation: needed (quantity:division, quantity:math)

### Graveborn Muse

Type: Creature — Zombie Spirit

Oracle text:

> At the beginning of your upkeep, you draw X cards and you lose X life, where X is the number of Zombies you control.

Re-rendered plain English:

```
Graveborn Muse [draft]
  [a1] triggered [needed: needs quantity:count, field:life_change.amount, field:life_change.lose]
    Oracle: At the beginning of your upkeep, you draw X cards and you lose X life, where X is the number of Zombies you control.
    Trigger: At the beginning of your upkeep
    Effect: Draw the number of Zombies you control cards. Then, gain the number of Zombies you control life.
```

Player prompts:

- (none: no decisions)

Implementation: needed (quantity:count, field:life_change.amount, field:life_change.lose)

### Gravecrawler

Type: Creature — Zombie

Oracle text:

> This creature can't block.
> You may cast this card from your graveyard as long as you control a Zombie.

Re-rendered plain English:

```
Gravecrawler [draft]
  Cast option c1: you may use cast_from_zone (from graveyard, cost ) [needed]
  [a1] static [needed: needs static]
    Oracle: This creature can't block.
    Static: Gravecrawler can't block
  [a2] cast_option [needed: needs cast_option]
    Oracle: You may cast this card from your graveyard as long as you control a Zombie.
```

Player prompts:

- Gravecrawler: cast_from_zone option: Do you want to cast it from graveyard?

Implementation: needed (static, cast_option, cast_option:cast_from_zone, cast_option:conditional)

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

### Kalitas, Traitor of Ghet

Type: Legendary Creature — Vampire Warrior

Oracle text:

> Lifelink
> If a nontoken creature an opponent controls would die, instead exile that card and create a 2/2 black Zombie creature token.
> {2}{B}, Sacrifice another Vampire or Zombie: Put two +1/+1 counters on Kalitas.

Re-rendered plain English:

```
Kalitas, Traitor of Ghet [draft]
  [a1] keyword [implemented]
    Oracle: Lifelink
    Keyword: lifelink
  [a2] replacement [needed: needs replacement:would_die]
    Oracle: If a nontoken creature an opponent controls would die, instead exile that card and create a 2/2 black Zombie creature token.
    Replacement: If a nontoken creature an opponent controls would die, instead: exile that object, then create a 2/2 black Zombie creature token
  [a3] activated [needed: needs cost:sacrifice, step:add_counters, field:add_counters.on]
    Oracle: {2}{B}, Sacrifice another Vampire or Zombie: Put two +1/+1 counters on Kalitas.
    Cost: {2}{B}, sacrifice a Vampire or Zombie you control
    Effect: Put 2 +1/+1 counters on Kalitas, Traitor of Ghet.
```

Player prompts:

- Kalitas, Traitor of Ghet: choose what to sacrifice: Choose 1 Vampire or Zombie you control to sacrifice.

Implementation: needed (replacement:would_die, cost:sacrifice, step:add_counters, field:add_counters.on)

### Lord of the Accursed

Type: Creature — Zombie

Oracle text:

> Other Zombies you control get +1/+1.
> {1}{B}, {T}: All Zombies gain menace until end of turn.

Re-rendered plain English:

```
Lord of the Accursed [draft]
  [a1] static [needed: needs static]
    Oracle: Other Zombies you control get +1/+1.
    Static: Other Zombies you control get +1/+1
  [a2] activated [needed: needs ref:iterated, step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, step:grant_effect, field:grant_effect.modify]
    Oracle: {1}{B}, {T}: All Zombies gain menace until end of turn.
    Cost: {1}{B}, {T}
    Effect: For each Zombie, that object gains menace until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, ref:iterated, step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, step:grant_effect, field:grant_effect.modify)

### Mutilate

Type: Sorcery

Oracle text:

> All creatures get -1/-1 until end of turn for each Swamp you control.

Re-rendered plain English:

```
Mutilate [draft]
  [a1] spell_effect [needed: needs quantity:math, field:mass_pump.filter]
    Oracle: All creatures get -1/-1 until end of turn for each Swamp you control.
    Effect: All creatures get +-1 x the number of Swamps you control/+-1 x the number of Swamps you control until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (quantity:math, field:mass_pump.filter)

### Noxious Ghoul

Type: Creature — Zombie

Oracle text:

> Whenever this creature or another Zombie enters, all non-Zombie creatures get -1/-1 until end of turn.

Re-rendered plain English:

```
Noxious Ghoul [draft]
  [a1] triggered [needed: needs filter:notSubtypes, trigger:subject, field:mass_pump.filter]
    Oracle: Whenever this creature or another Zombie enters, all non-Zombie creatures get -1/-1 until end of turn.
    Trigger: Whenever a Zombie enters
    Effect: All creatures get -1/-1 until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (filter:notSubtypes, trigger:subject, field:mass_pump.filter)

### Oversold Cemetery

Type: Enchantment

Oracle text:

> At the beginning of your upkeep, if you have four or more creature cards in your graveyard, you may return target creature card from your graveyard to your hand.

Re-rendered plain English:

```
Oversold Cemetery [draft]
  [a1] triggered [needed: needs trigger:intervening_if]
    Oracle: At the beginning of your upkeep, if you have four or more creature cards in your graveyard, you may return target creature card from your graveyard to your hand.
    Trigger: At the beginning of your upkeep, if you have 4 or greater creatures in graveyard
    Target t1: target creature card in your graveyard  <- prompt: "Choose target creature card in your graveyard."
    Effect: Put target creature card in your graveyard into your hand.
    (optional: Do you want to put target creature card in your graveyard into your hand?)
```

Player prompts:

- Oversold Cemetery: choose a target: Choose target creature card in your graveyard.
- Oversold Cemetery: optional: Do you want to put target creature card in your graveyard into your hand?

Implementation: needed (trigger:intervening_if)

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

### Tendrils of Corruption

Type: Instant

Oracle text:

> Tendrils of Corruption deals X damage to target creature and you gain X life, where X is the number of Swamps you control.

Re-rendered plain English:

```
Tendrils of Corruption [draft]
  [a1] spell_effect [needed: needs quantity:count, field:life_change.amount]
    Oracle: Tendrils of Corruption deals X damage to target creature and you gain X life, where X is the number of Swamps you control.
    Target t1: target creature  <- prompt: "Choose target creature."
    Effect: Deal the number of Swamps you control damage to target creature. Then, gain the number of Swamps you control life.
```

Player prompts:

- Tendrils of Corruption: choose a target: Choose target creature.

Implementation: needed (quantity:count, field:life_change.amount)

### Vengeful Dead

Type: Creature — Zombie

Oracle text:

> Whenever this creature or another Zombie dies, each opponent loses 1 life.

Re-rendered plain English:

```
Vengeful Dead [draft]
  [a1] triggered [needed: needs trigger:subject, field:life_change.who]
    Oracle: Whenever this creature or another Zombie dies, each opponent loses 1 life.
    Trigger: Whenever a Zombie dies
    Effect: Each opponent loses 1 life.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:subject, field:life_change.who)

### Witch's Cottage

Type: Land — Swamp

Oracle text:

> ({T}: Add {B}.)
> This land enters tapped unless you control three or more other Swamps.
> When this land enters untapped, you may put target creature card from your graveyard on top of your library.

Re-rendered plain English:

```
Witch's Cottage [draft]
  [a1] mana [implemented]
    Oracle: ({T}: Add {B}.)
    Cost: {T}
    Mana: add {B}
  [a2] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped unless you control three or more other Swamps.
    Replacement: If Witch's Cottage would enter (only if it is not true that you control three or more other Swamps), it enters tapped
  [a3] triggered [needed: needs trigger:intervening_if, predicate:not, predicate:source_state, field:move_card_zone.position]
    Oracle: When this land enters untapped, you may put target creature card from your graveyard on top of your library.
    Trigger: Whenever Witch's Cottage enters, if it is not true that Witch's Cottage is tapped
    Target t1: target creature card in your graveyard  <- prompt: "Choose target creature card in your graveyard."
    Effect: Put target creature card in your graveyard on the top of its owner's library.
    (optional: Do you want to put target creature card in your graveyard on the top of its owner's library?)
```

Player prompts:

- Witch's Cottage: choose a target: Choose target creature card in your graveyard.
- Witch's Cottage: optional: Do you want to put target creature card in your graveyard on the top of its owner's library?

Implementation: needed (replacement:would_enter, trigger:intervening_if, predicate:not, predicate:source_state, field:move_card_zone.position)

## Kernel to-do: missing capabilities across this deck

| capability | cards | needing it |
|---|---|---|
| `static` | 18 | Bad Moon; Bonehoard; Bontu's Monument; Carrion Feeder; Cemetery Reaper; Crown of Gondor; Death Baron; Dissection Tools; Gravecrawler; Lashwrithe; Liliana's Mastery; Lord of the Accursed; Lord of the Undead; Patchwork Banner; Soulless One; Stoneforge Masterwork; Undead Warchief; Wight of Precinct Six |
| `cost:sacrifice` | 10 | Ghoulcaller Gisa; Ayara, First of Locthwain; Carrion Feeder; Commander's Sphere; Disciple of Griselbrand; Dissection Tools; Kalitas, Traitor of Ghet; Memorial to Folly; Mind Stone; Umbral Collar Zealot |
| `replacement:would_enter` | 8 | Barren Moor; Bojuka Bog; Castle Locthwain; Charcoal Diamond; Diregraf Colossus; Memorial to Folly; Patchwork Banner; Witch's Cottage |
| `trigger:subject` | 8 | Ayara, First of Locthwain; Champion of the Perished; Crown of Gondor; Headless Rider; Midnight Reaper; Noxious Ghoul; Undead Augur; Vengeful Dead |
| `field:life_change.amount` | 7 | Castle Locthwain; Consuming Corruption; Disciple of Bolas; Disciple of Griselbrand; Graveborn Muse; Gray Merchant of Asphodel; Tendrils of Corruption |
| `field:attach.to` | 5 | Bonehoard; Crown of Gondor; Dissection Tools; Lashwrithe; Stoneforge Masterwork |
| `field:attach.what` | 5 | Bonehoard; Crown of Gondor; Dissection Tools; Lashwrithe; Stoneforge Masterwork |
| `step:attach` | 5 | Bonehoard; Crown of Gondor; Dissection Tools; Lashwrithe; Stoneforge Masterwork |
| `field:life_change.who` | 4 | Ayara, First of Locthwain; Bontu's Monument; Gray Merchant of Asphodel; Vengeful Dead |
| `quantity:count` | 4 | Castle Locthwain; Consuming Corruption; Graveborn Muse; Tendrils of Corruption |
| `field:add_counters.on` | 3 | Carrion Feeder; Champion of the Perished; Kalitas, Traitor of Ghet |
| `field:create_tokens.tokenTapped` | 3 | Army of the Damned; Diregraf Colossus; Necrotic Hex |
| `field:life_change.lose` | 3 | Castle Locthwain; Graveborn Muse; Gray Merchant of Asphodel |
| `field:sacrifice_permanent.filter` | 3 | Consumed by Greed; Fleshbag Marauder; Necrotic Hex |
| `field:sacrifice_permanent.who` | 3 | Consumed by Greed; Fleshbag Marauder; Necrotic Hex |
| `mana:variable` | 3 | Arcane Signet; Commander's Sphere; Patchwork Banner |
| `quantity:stat` | 3 | Ghoulcaller Gisa; Disciple of Bolas; Disciple of Griselbrand |
| `ref:created` | 3 | Bonehoard; Dissection Tools; Lashwrithe |
| `ref:sacrificed` | 3 | Ghoulcaller Gisa; Disciple of Bolas; Disciple of Griselbrand |
| `step:add_counters` | 3 | Carrion Feeder; Champion of the Perished; Kalitas, Traitor of Ghet |
| `step:choose` | 3 | Cemetery Tampering; Disciple of Bolas; Patchwork Banner |
| `trigger:intervening_if` | 3 | Crown of Gondor; Oversold Cemetery; Witch's Cottage |
| `cost:discard` | 2 | Barren Moor; Cryptbreaker |
| `cost:tapOther` | 2 | Cryptbreaker; Gravespawn Sovereign |
| `field:choose.count` | 2 | Cemetery Tampering; Disciple of Bolas |
| `field:choose.from` | 2 | Cemetery Tampering; Disciple of Bolas |
| `field:choose.saveAs` | 2 | Cemetery Tampering; Disciple of Bolas |
| `field:draw_cards.who` | 2 | Consumed by Greed; Geier Reach Sanitarium |
| `field:mass_pump.filter` | 2 | Mutilate; Noxious Ghoul |
| `field:move_card_zone.position` | 2 | Cemetery Tampering; Witch's Cottage |
| `field:move_card_zone.what` | 2 | Bojuka Bog; Cemetery Tampering |
| `field:permission_to_play.what` | 2 | Cemetery Tampering; Zul Ashur, Lich Lord |
| `field:permission_to_play.zone` | 2 | Cemetery Tampering; Zul Ashur, Lich Lord |
| `quantity:math` | 2 | Endless Ranks of the Dead; Mutilate |
| `step:permission_to_play` | 2 | Cemetery Tampering; Zul Ashur, Lich Lord |
| `cast_option` | 1 | Gravecrawler |
| `cast_option:cast_from_zone` | 1 | Gravecrawler |
| `cast_option:conditional` | 1 | Gravecrawler |
| `cast_option:flashback` | 1 | Army of the Damned |
| `cast_option:gift` | 1 | Consumed by Greed |
| `cost_reduction` | 1 | Crown of Gondor |
| `cost_reduction:conditional` | 1 | Crown of Gondor |
| `cost:life` | 1 | Phyrexian Reclamation |
| `field:choose.choice` | 1 | Patchwork Banner |
| `field:choose.fromLooked` | 1 | Cemetery Tampering |
| `field:choose.remember` | 1 | Patchwork Banner |
| `field:discard.who` | 1 | Geier Reach Sanitarium |
| `field:grant_effect.modify` | 1 | Lord of the Accursed |
| `field:move_card_zone.faceDown` | 1 | Cemetery Tampering |
| `field:move_card_zone.linkExile` | 1 | Cemetery Tampering |
| `field:move_card_zone.order` | 1 | Cemetery Tampering |
| `field:move_card_zone.reflexive` | 1 | Undead Butler |
| `field:permission_to_play.withoutPaying` | 1 | Cemetery Tampering |
| `field:repeat_for_each.over` | 1 | Lord of the Accursed |
| `field:repeat_for_each.steps` | 1 | Lord of the Accursed |
| `field:sacrifice_permanent.amount` | 1 | Necrotic Hex |
| `field:sacrifice_permanent.greatestPower` | 1 | Consumed by Greed |
| `filter:chosenType` | 1 | Patchwork Banner |
| `filter:notSubtypes` | 1 | Noxious Ghoul |
| `filter:sharesCreatureTypeWith` | 1 | Stoneforge Masterwork |
| `predicate:matches` | 1 | Cemetery Recruitment |
| `predicate:not` | 1 | Witch's Cottage |
| `predicate:paid_additional_cost` | 1 | Consumed by Greed |
| `predicate:source_state` | 1 | Witch's Cottage |
| `predicate:stat` | 1 | Crown of Gondor |
| `predicate:step_done` | 1 | Undead Butler |
| `quantity:devotion` | 1 | Gray Merchant of Asphodel |
| `quantity:division` | 1 | Endless Ranks of the Dead |
| `quantity:life_lost_this_way` | 1 | Gray Merchant of Asphodel |
| `ref:iterated` | 1 | Lord of the Accursed |
| `ref:linked_exile` | 1 | Cemetery Tampering |
| `replacement:would_die` | 1 | Kalitas, Traitor of Ghet |
| `scripted:become_monarch` | 1 | Crown of Gondor |
| `static:setBasePT` | 1 | Soulless One |
| `step:counter_spell` | 1 | Zul Ashur, Lich Lord |
| `step:grant_effect` | 1 | Lord of the Accursed |
| `step:look_top` | 1 | Cemetery Tampering |
| `step:manifest_dread` | 1 | Dissection Tools |
| `step:repeat_for_each` | 1 | Lord of the Accursed |
| `step:surveil` | 1 | Umbral Collar Zealot |
| `step:unless_pay` | 1 | Zul Ashur, Lich Lord |
| `targets:multi` | 1 | Consumed by Greed |
| `trigger:becomes_target` | 1 | Zul Ashur, Lich Lord |
| `trigger:multi_event` | 1 | Grave Titan |
| `zone:hand` | 1 | Barren Moor |

## Decisions

- Consolidated schema pass: the workarounds reported by the five pilot decks (sentinels, review.ignore hacks, scripted stubs, placeholder refs) now use real fields; see src/kernel/SCHEMA_CHANGELOG.md.
- Monarch stays a scripted marker (become_monarch + the controller_is_monarch stat) by user decision; Crew, Improvise, Myriad, Storm, Read ahead, Manifest dread, Reselect attack target and tapped-for-{C} stay scripted markers (vocabulary listed in the changelog).
- Remaining genuine card-behaviour questions are collected in data/kernel-drafts/CONSOLIDATED_QUESTIONS.md, not per deck.
