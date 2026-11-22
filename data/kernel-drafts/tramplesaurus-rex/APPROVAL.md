# Kernel draft approval: Tramplesaurus Rex

69 unique cards: 39 simple (A), 30 complex (B). Validator: 69/69 pass. Cards with implementation "needed": 59. All drafts are `review.status: "draft"`; nothing was written to the DB.

Reading guide: each card below shows the oracle text and what the structured JSON says back in plain English. Approve if they match.

## (A) Simple cards: spot-check one line each

- **Arasta of the Endless Web** (Legendary Enchantment Creature — Spider): Keyword reach | Whenever an opponent casts an instant spell or sorcery spell: Create a 1/2 green Spider creature token with reach [needs: trigger:subject, field:create_tokens.tokenKeywords]
- **Beast Whisperer** (Creature — Elf Druid): Whenever you cast a creature spell: Draw a card [implemented]
- **Birds of Paradise** (Creature — Bird): Keyword flying | {T}: add one mana of any color [needs: mana:variable]
- **Carnage Tyrant** (Creature — Dinosaur): Carnage Tyrant can't be countered | Keyword trample | Keyword hexproof [needs: static, zone:stack]
- **Curious Altisaur** (Creature — Dinosaur): Keyword vigilance | Keyword reach | Whenever a Dinosaur you control deals combat damage to a player: Draw a card [needs: trigger:subject]
- **Dungrove Elder** (Creature — Treefolk): Keyword hexproof | Dungrove Elder has power and toughness each equal to the number of Forests you control [needs: static, static:setBasePT]
- **Ezuri's Predation** (Sorcery): Create the number of creatures an opponent controls 4/4 green Phyrexian Beast creature tokens, then each of the tokens just created fights a different creature an opponent controls, the pairing chosen by you [needs: ref:created, quantity:count, step:fight_pairs, field:fight_pairs.against, field:fight_pairs.fighters, field:fight_pairs.pairing]
- **Gigantosaurus** (Creature — Dinosaur):  [implemented]
- **Hulking Raptor** (Creature — Dinosaur): Whenever Hulking Raptor becomes the target of a spell or ability: Counter that object | At the beginning of your first main phase: Add {G}{G} [needs: trigger:becomes_target, step:counter_spell, step:unless_pay, trigger:begin_step:precombat_main, step:add_mana, field:add_mana.produces]
- **Loot, Exuberant Explorer** (Legendary Creature — Beast Noble): You may play an additional land on each of your turns | {4}{G}{G}, {T}: Look at the top six cards of your library, then you may choose a creature card with mana value less than or equal to the number of lands you control from among the looked-at cards, then reveal the chosen object, then put the chosen object onto the battlefield, then put the rest of the looked-at cards on the bottom of your library in a random order [needs: static, static:extraLandDrops, step:look_top, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, step:reveal, field:move_card_zone.order, field:move_card_zone.position, field:move_card_zone.what]
- **Managorger Hydra** (Creature — Hydra): Keyword trample | Whenever a player casts a spell: Put a +1/+1 counter on Managorger Hydra [needs: step:add_counters, field:add_counters.on]
- **Pugnacious Hammerskull** (Creature — Dinosaur): Whenever Pugnacious Hammerskull attacks, if it is not true that you control an another Dinosaur: Put a stun counter on Pugnacious Hammerskull [needs: trigger:intervening_if, predicate:not, step:add_counters, field:add_counters.on]
- **Regal Imperiosaur** (Creature — Dinosaur): Other Dinosaurs you control get +1/+1 [needs: static]
- **Ripjaw Raptor** (Creature — Dinosaur): Whenever Ripjaw Raptor is dealt damage: Draw a card [needs: trigger:dealt_damage]
- **Shamanic Revelation** (Sorcery): Draw the number of creatures you control cards | Gain NaN life [needs: quantity:count]
- **Steel Leaf Champion** (Creature — Elf Knight): Steel Leaf Champion can't be blocked by creatures with power 2 or less [needs: static]
- **Verdant Sun's Avatar** (Creature — Dinosaur Avatar): Whenever a creature you control enters: Gain NaN life [needs: trigger:subject]
- **Whiptongue Hydra** (Creature — Lizard Hydra): Keyword reach | Whenever Whiptongue Hydra enters: Destroy each creature with flying, then put 1 x that many +1/+1 counters on Whiptongue Hydra [needs: field:destroy_all.filter, step:add_counters, quantity:math, field:add_counters.on]
- **Yeva, Nature's Herald** (Legendary Creature — Elf Shaman): Keyword flash | You cast green creature spells as though they had flash [needs: static]
- **Scavenger Grounds** (Land — Desert): {T}: add {C} | {2}, {T}, sacrifice a Desert you control: Exile all cards from each player's graveyard [needs: cost:sacrifice, field:move_card_zone.all, field:move_card_zone.from, field:move_card_zone.who]
- **War Room** (Land): {T}: add {C} | {3}, {T}, pay life equal to the number of colors in your commanders' color identity: Draw a card [needs: cost:life]
- **Beast Within** (Instant): [targets: target permanent] Destroy target permanent, then create a 3/3 green Beast creature token [needs: field:create_tokens.who]
- **Bite Down** (Instant): [targets: target creature you control; target creature or planeswalker an opponent controls] Target creature you control deals t1's power damage to target creature or planeswalker an opponent controls [needs: quantity:stat, field:damage_target.source]
- **Challenger Troll** (Creature — Troll): Creatures with power 4 or greater you control can't be blocked by more than one creature [needs: static]
- **Elemental Bond** (Enchantment): Whenever a creature with power 3 or greater you control enters: Draw a card [needs: trigger:subject]
- **Elvish Mystic** (Creature — Elf Druid): {T}: add {G} [implemented]
- **Fyndhorn Elves** (Creature — Elf Druid): {T}: add {G} [implemented]
- **Garruk's Packleader** (Creature — Beast): Whenever an another creature with power 3 or greater you control enters: You may draw a card [needs: trigger:subject]
- **Harmonize** (Sorcery): Draw 3 cards [implemented]
- **Kenrith's Transformation** (Enchantment — Aura): [targets: target creature] | Whenever Kenrith's Transformation enters: Draw a card | The enchanted creature loses all abilities and is Creature Elk and is green and has base power and toughness 3/3 [needs: keyword:enchant, static, static:setColors, static:setBasePT]
- **Llanowar Elves** (Creature — Elf Druid): {T}: add {G} [implemented]
- **Llanowar Tribe** (Creature — Elf Druid): {T}: add {G}{G}{G} [implemented]
- **Terrian, World Tyrant** (Legendary Creature — Dinosaur Ooze):  [implemented]
- **Thrashing Brontodon** (Creature — Dinosaur): {1}, sacrifice Thrashing Brontodon: [targets: target artifact or enchantment] Destroy target artifact or enchantment [needs: cost:sacrifice]
- **Commander's Sphere** (Artifact): {T}: add one mana of any color in your commander's color identity | sacrifice Commander's Sphere: Draw a card [needs: mana:variable, cost:sacrifice]
- **Sol Ring** (Artifact): {T}: add {C}{C} [implemented]
- **Swiftfoot Boots** (Artifact — Equipment): The equipped creature has hexproof and has haste | {1}: [targets: target creature you control] Attach Swiftfoot Boots to target creature you control [needs: static, step:attach, field:attach.to, field:attach.what]
- **Rogue's Passage** (Land): {T}: add {C} | {4}, {T}: [targets: target creature] Target creature can't be blocked until end of turn [needs: step:grant_effect, field:grant_effect.modify]
- **Forest** (Basic Land — Forest): {T}: add {G} [implemented]

## (B) Complex cards

### Ghalta, Primal Hunger

Type: Legendary Creature — Elder Dinosaur

Oracle text:

> This spell costs {X} less to cast, where X is the total power of creatures you control.
> Trample (This creature can deal excess combat damage to the player or planeswalker it's attacking.)

Re-rendered plain English:

```
Ghalta, Primal Hunger [draft]
  [a1] static (from stack) [needed: needs zone:stack, cost_reduction, cost_reduction:variable]
    Oracle: This spell costs {X} less to cast, where X is the total power of creatures you control.
    Cost reduction: this ability costs {X}, where X is the total power of creatures you control, less
  [a2] keyword [implemented]
    Oracle: Trample
    Keyword: trample
```

Player prompts:

- (none: no decisions)

Implementation: needed (zone:stack, cost_reduction, cost_reduction:variable)

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

### Elder Gargaroth

Type: Creature — Beast

Oracle text:

> Vigilance, reach, trample
> Whenever this creature attacks or blocks, choose one —
> • Create a 3/3 green Beast creature token.
> • You gain 3 life.
> • Draw a card.

Re-rendered plain English:

```
Elder Gargaroth [draft]
  [a1] keyword [implemented]
    Oracle: Vigilance
    Keyword: vigilance
  [a2] keyword [implemented]
    Oracle: Reach
    Keyword: reach
  [a3] keyword [implemented]
    Oracle: Trample
    Keyword: trample
  [a4] triggered [needed: needs modes, trigger:multi_event, trigger:block]
    Oracle: Whenever this creature attacks or blocks, choose one — / • Create a 3/3 green Beast creature token. / • You gain 3 life. / • Draw a card.
    Trigger: Whenever Elder Gargaroth attacks or blocks
    Modes: choose 1  <- prompt: "Choose one mode."
      - Create a 3/3 green Beast creature token.
      - Gain 3 life.
      - Draw a card.
```

Player prompts:

- Elder Gargaroth: choose a mode: Choose one mode.

Implementation: needed (modes, trigger:multi_event, trigger:block)

### Overwhelming Stampede

Type: Sorcery

Oracle text:

> Until end of turn, creatures you control gain trample and get +X/+X, where X is the greatest power among creatures you control.

Re-rendered plain English:

```
Overwhelming Stampede [draft]
  [a1] spell_effect [needed: needs quantity:greatest, field:mass_pump.filter, step:grant_effect, field:grant_effect.filter, field:grant_effect.modify]
    Oracle: Until end of turn, creatures you control gain trample and get +X/+X, where X is the greatest power among creatures you control.
    Effect: All creatures get +the greatest power among creatures you control/+the greatest power among creatures you control until end of turn. Then, the target gains trample until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (quantity:greatest, field:mass_pump.filter, step:grant_effect, field:grant_effect.filter, field:grant_effect.modify)

### Rhonas the Indomitable

Type: Legendary Creature — God

Oracle text:

> Deathtouch, indestructible
> Rhonas can't attack or block unless you control another creature with power 4 or greater.
> {2}{G}: Another target creature gets +2/+0 and gains trample until end of turn.

Re-rendered plain English:

```
Rhonas the Indomitable [draft]
  [a1] keyword [implemented]
    Oracle: Deathtouch
    Keyword: deathtouch
  [a2] keyword [implemented]
    Oracle: Indestructible
    Keyword: indestructible
  [a3] static [needed: needs static]
    Oracle: Rhonas can't attack or block unless you control another creature with power 4 or greater.
    Static: Rhonas the Indomitable can't attack and can't block unless you control an another creature with power 4 or greater
  [a4] activated [needed: needs step:grant_effect, field:grant_effect.modify]
    Oracle: {2}{G}: Another target creature gets +2/+0 and gains trample until end of turn.
    Cost: {2}{G}
    Target t1: another target creature  <- prompt: "Choose another target creature."
    Effect: Another target creature gets +2/+0 until end of turn. Then, another target creature gains trample until end of turn.
```

Player prompts:

- Rhonas the Indomitable: choose a target: Choose another target creature.

Implementation: needed (static, step:grant_effect, field:grant_effect.modify)

### Rishkar's Expertise

Type: Sorcery

Oracle text:

> Draw cards equal to the greatest power among creatures you control.
> You may cast a spell with mana value 5 or less from your hand without paying its mana cost.

Re-rendered plain English:

```
Rishkar's Expertise [draft]
  [a1] spell_effect [needed: needs quantity:greatest]
    Oracle: Draw cards equal to the greatest power among creatures you control.
    Effect: Draw the greatest power among creatures you control cards.
  [a2] spell_effect [needed: needs step:choose, field:choose.count, field:choose.from, field:choose.saveAs, step:permission_to_play, field:permission_to_play.what, field:permission_to_play.withoutPaying, field:permission_to_play.zone]
    Oracle: You may cast a spell with mana value 5 or less from your hand without paying its mana cost.
    Effect: You may choose a nonland card with mana value 5 or less in your hand. Then, you may play chosen without paying its mana cost.
```

Player prompts:

- Rishkar's Expertise: optional: Do you want to choose a nonland card with mana value 5 or less in your hand?

Implementation: needed (quantity:greatest, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, step:permission_to_play, field:permission_to_play.what, field:permission_to_play.withoutPaying, field:permission_to_play.zone)

### Scavenging Ooze

Type: Creature — Ooze

Oracle text:

> {G}: Exile target card from a graveyard. If it was a creature card, put a +1/+1 counter on this creature and you gain 1 life.

Re-rendered plain English:

```
Scavenging Ooze [draft]
  [a1] activated [needed: needs step:if_else, field:if_else.if, field:if_else.then, predicate:matches, step:add_counters, field:add_counters.on]
    Oracle: {G}: Exile target card from a graveyard. If it was a creature card, put a +1/+1 counter on this creature and you gain 1 life.
    Cost: {G}
    Target t1: target card in a graveyard  <- prompt: "Choose target card in a graveyard."
    Effect: Exile target card in a graveyard. Then, if t1 is a creature: put a +1/+1 counter on Scavenging Ooze, then gain 1 life.
```

Player prompts:

- Scavenging Ooze: choose a target: Choose target card in a graveyard.

Implementation: needed (step:if_else, field:if_else.if, field:if_else.then, predicate:matches, step:add_counters, field:add_counters.on)

### Scrapshooter

Type: Creature — Raccoon Archer

Oracle text:

> Gift a card (You may promise an opponent a gift as you cast this spell. If you do, when it enters, they draw a card.)
> Reach
> When this creature enters, if the gift was promised, destroy target artifact or enchantment an opponent controls.

Re-rendered plain English:

```
Scrapshooter [draft]
  Cast option c1: you may use gift (from hand, cost ) [needed]
  [a1] triggered [needed: needs trigger:intervening_if, predicate:paid_additional_cost, field:draw_cards.who]
    Oracle: Gift a card (You may promise an opponent a gift as you cast this spell. If you do, when it enters, they draw a card.)
    Trigger: Whenever Scrapshooter enters, if the additional cost (gift) was paid
    Effect: An opponent draws a card.
    Keyword: gift a card
  [a2] keyword [implemented]
    Oracle: Reach
    Keyword: reach
  [a3] triggered [needed: needs trigger:intervening_if, predicate:paid_additional_cost]
    Oracle: When this creature enters, if the gift was promised, destroy target artifact or enchantment an opponent controls.
    Trigger: Whenever Scrapshooter enters, if the additional cost (gift) was paid
    Target t1: target artifact or enchantment an opponent controls  <- prompt: "Choose target artifact or enchantment an opponent controls."
    Effect: Destroy target artifact or enchantment an opponent controls.
```

Player prompts:

- Scrapshooter: choose a target: Choose target artifact or enchantment an opponent controls.
- Scrapshooter: gift: Do you want to promise a card to an opponent? If you do, choose that opponent.

Implementation: needed (trigger:intervening_if, predicate:paid_additional_cost, field:draw_cards.who, cast_option:gift)

### Surrak and Goreclaw

Type: Legendary Creature — Human Bear

Oracle text:

> Trample
> Other creatures you control have trample.
> Whenever another nontoken creature you control enters, put a +1/+1 counter on it. It gains haste until end of turn.

Re-rendered plain English:

```
Surrak and Goreclaw [draft]
  [a1] keyword [implemented]
    Oracle: Trample
    Keyword: trample
  [a2] static [needed: needs static]
    Oracle: Other creatures you control have trample.
    Static: Other creatures you control have trample
  [a3] triggered [needed: needs trigger:subject, step:add_counters, field:add_counters.on, step:grant_effect, field:grant_effect.modify]
    Oracle: Whenever another nontoken creature you control enters, put a +1/+1 counter on it. It gains haste until end of turn.
    Trigger: Whenever a nontoken another creature you control enters
    Effect: Put a +1/+1 counter on that object. Then, that object gains haste until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, trigger:subject, step:add_counters, field:add_counters.on, step:grant_effect, field:grant_effect.modify)

### Surrak, the Hunt Caller

Type: Legendary Creature — Human Warrior

Oracle text:

> Formidable — At the beginning of combat on your turn, if creatures you control have total power 8 or greater, target creature you control gains haste until end of turn. (It can attack and {T} no matter when it came under your control.)

Re-rendered plain English:

```
Surrak, the Hunt Caller [draft]
  [a1] triggered [needed: needs trigger:intervening_if, predicate:compare, step:grant_effect, field:grant_effect.modify]
    Oracle: Formidable — At the beginning of combat on your turn, if creatures you control have total power 8 or greater, target creature you control gains haste until end of turn. (It can attack and {T} no matter when it came under your control.)
    Trigger: At the beginning of combat on your turn, if the total power of creatures you control is 8 or greater
    Target t1: target creature you control  <- prompt: "Choose target creature you control."
    Effect: Target creature you control gains haste until end of turn.
```

Player prompts:

- Surrak, the Hunt Caller: choose a target: Choose target creature you control.

Implementation: needed (trigger:intervening_if, predicate:compare, step:grant_effect, field:grant_effect.modify)

### Tangleweave Armor

Type: Artifact — Equipment

Oracle text:

> Living weapon (When this Equipment enters, create a 0/0 black Phyrexian Germ creature token, then attach this to it.)
> Equipped creature gets +X/+X, where X is the greatest mana value among your commanders.
> Equip {4}

Re-rendered plain English:

```
Tangleweave Armor [draft]
  [a1] triggered [needed: needs ref:created, step:attach, field:attach.to, field:attach.what]
    Oracle: Living weapon (When this Equipment enters, create a 0/0 black Phyrexian Germ creature token, then attach this to it.)
    Trigger: Whenever Tangleweave Armor enters
    Effect: Create a 0/0 black Phyrexian Germ creature token. Then, attach Tangleweave Armor to the token just created.
    Keyword: living_weapon
  [a2] static [needed: needs static, filter:isCommander]
    Oracle: Equipped creature gets +X/+X, where X is the greatest mana value among your commanders.
    Static: The equipped creature gets +X/+X, where X is the greatest mana value among commander cards
  [a3] activated [needed: needs step:attach, field:attach.to, field:attach.what]
    Oracle: Equip {4}
    Cost: {4}
    Timing: sorcery
    Target t1: target creature you control  <- prompt: "Choose target creature you control."
    Effect: Attach Tangleweave Armor to target creature you control.
    Keyword: equip
```

Player prompts:

- Tangleweave Armor: choose a target: Choose target creature you control.

Implementation: needed (ref:created, step:attach, field:attach.to, field:attach.what, static, filter:isCommander)

### Thickest in the Thicket

Type: Enchantment

Oracle text:

> When this enchantment enters, put X +1/+1 counters on target creature, where X is that creature's power.
> At the beginning of your end step, draw two cards if you control the creature with the greatest power or tied for the greatest power.

Re-rendered plain English:

```
Thickest in the Thicket [draft]
  [a1] triggered [needed: needs step:add_counters, quantity:stat, field:add_counters.on]
    Oracle: When this enchantment enters, put X +1/+1 counters on target creature, where X is that creature's power.
    Trigger: Whenever Thickest in the Thicket enters
    Target t1: target creature  <- prompt: "Choose target creature."
    Effect: Put t1's power +1/+1 counters on target creature.
  [a2] triggered [needed: needs trigger:intervening_if]
    Oracle: At the beginning of your end step, draw two cards if you control the creature with the greatest power or tied for the greatest power.
    Trigger: At the beginning of your end step, if you control a creature with power greater than or equal to the greatest power among creatures
    Effect: Draw 2 cards.
```

Player prompts:

- Thickest in the Thicket: choose a target: Choose target creature.

Implementation: needed (step:add_counters, quantity:stat, field:add_counters.on, trigger:intervening_if)

### Unnatural Growth

Type: Enchantment

Oracle text:

> At the beginning of each combat, double the power and toughness of each creature you control until end of turn.

Re-rendered plain English:

```
Unnatural Growth [draft]
  [a1] triggered [needed: needs ref:iterated, step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, quantity:stat]
    Oracle: At the beginning of each combat, double the power and toughness of each creature you control until end of turn.
    Trigger: At the beginning of combat on each turn
    Effect: For each creature you control, that object gets +that object's power/+that object's toughness until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (ref:iterated, step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, quantity:stat)

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

### Mosswort Bridge

Type: Land

Oracle text:

> Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
> This land enters tapped.
> {T}: Add {G}.
> {G}, {T}: You may play the exiled card without paying its mana cost if creatures you control have total power 10 or greater.

Re-rendered plain English:

```
Mosswort Bridge [draft]
  [a1] triggered [needed: needs step:look_top, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, field:move_card_zone.faceDown, field:move_card_zone.linkExile, field:move_card_zone.order, field:move_card_zone.position, field:move_card_zone.what]
    Oracle: Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
    Trigger: Whenever Mosswort Bridge enters
    Effect: Look at the top four cards of your library. Then, choose a card from among the looked-at cards. Then, exile the chosen object face down. Then, put the rest of the looked-at cards on the bottom of your library in a random order.
    Keyword: hideaway 4
  [a2] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped.
    Replacement: If Mosswort Bridge would enter, it enters tapped
  [a3] mana [implemented]
    Oracle: {T}: Add {G}.
    Cost: {T}
    Mana: add {G}
  [a4] activated [needed: needs ref:linked_exile, step:permission_to_play, field:permission_to_play.what, field:permission_to_play.withoutPaying, field:permission_to_play.zone, predicate:compare]
    Oracle: {G}, {T}: You may play the exiled card without paying its mana cost if creatures you control have total power 10 or greater.
    Cost: {G}, {T}
    Effect: IF the total power of creatures you control is 10 or greater: you may you may play linked_exile without paying its mana cost.
```

Player prompts:

- Mosswort Bridge: choose: Choose a card from among the looked-at cards.
- Mosswort Bridge: optional: Do you want to you may play linked_exile without paying its mana cost?

Implementation: needed (step:look_top, step:choose, field:choose.count, field:choose.from, field:choose.fromLooked, field:choose.saveAs, field:move_card_zone.faceDown, field:move_card_zone.linkExile, field:move_card_zone.order, field:move_card_zone.position, field:move_card_zone.what, replacement:would_enter, ref:linked_exile, step:permission_to_play, field:permission_to_play.what, field:permission_to_play.withoutPaying, field:permission_to_play.zone, predicate:compare)

### Witch's Clinic

Type: Land

Oracle text:

> {T}: Add {C}.
> {2}, {T}: Target commander gains lifelink until end of turn.

Re-rendered plain English:

```
Witch's Clinic [draft]
  [a1] mana [implemented]
    Oracle: {T}: Add {C}.
    Cost: {T}
    Mana: add {C}
  [a2] activated [needed: needs filter:isCommander, step:grant_effect, field:grant_effect.modify]
    Oracle: {2}, {T}: Target commander gains lifelink until end of turn.
    Cost: {2}, {T}
    Target t1: target commander permanent  <- prompt: "Choose target commander permanent."
    Effect: Target commander permanent gains lifelink until end of turn.
```

Player prompts:

- Witch's Clinic: choose a target: Choose target commander permanent.

Implementation: needed (filter:isCommander, step:grant_effect, field:grant_effect.modify)

### Clifftop Lookout

Type: Creature — Frog Scout

Oracle text:

> Reach
> When this creature enters, reveal cards from the top of your library until you reveal a land card. Put that card onto the battlefield tapped and the rest on the bottom of your library in a random order.

Re-rendered plain English:

```
Clifftop Lookout [draft]
  [a1] keyword [implemented]
    Oracle: Reach
    Keyword: reach
  [a2] triggered [needed: needs step:reveal, field:reveal.until, step:choose, field:choose.count, field:choose.from, field:choose.fromRevealed, field:choose.saveAs, field:move_card_zone.tapped, field:move_card_zone.order, field:move_card_zone.position, field:move_card_zone.what]
    Oracle: When this creature enters, reveal cards from the top of your library until you reveal a land card. Put that card onto the battlefield tapped and the rest on the bottom of your library in a random order.
    Trigger: Whenever Clifftop Lookout enters
    Effect: Reveal the target. Then, choose a land card in a library. Then, put the chosen object onto the battlefield. Then, put a card on the bottom of its owner's library.
```

Player prompts:

- Clifftop Lookout: choose: Choose a land card in a library.

Implementation: needed (step:reveal, field:reveal.until, step:choose, field:choose.count, field:choose.from, field:choose.fromRevealed, field:choose.saveAs, field:move_card_zone.tapped, field:move_card_zone.order, field:move_card_zone.position, field:move_card_zone.what)

### Collective Resistance

Type: Instant

Oracle text:

> Escalate {G} (Pay this cost for each mode chosen beyond the first.)
> Choose one or more —
> • Destroy target artifact.
> • Destroy target enchantment.
> • Target creature gains hexproof and indestructible until end of turn.

Re-rendered plain English:

```
Collective Resistance [draft]
  Cast option c1: you may use escalate (from hand, cost {G}) [needed]
  [a1] spell_effect [needed: needs modes, modes:multiple, step:grant_effect, field:grant_effect.modify]
    Oracle: Choose one or more — / • Destroy target artifact. / • Destroy target enchantment. / • Target creature gains hexproof and indestructible until end of turn.
    Modes: choose 1-3  <- prompt: "Choose one or more modes (up to three)."
      - Destroy target artifact. (target: target artifact)
      - Destroy target enchantment. (target: target enchantment)
      - Target creature gains hexproof and gains indestructible until end of turn. (target: target creature)
```

Player prompts:

- Collective Resistance: choose modes: Choose one or more modes (up to three).
- Collective Resistance: choose a target: Choose target artifact.
- Collective Resistance: choose a target: Choose target enchantment.
- Collective Resistance: choose a target: Choose target creature.
- Collective Resistance: escalate: Do you want to pay {G} for each mode beyond the first?

Implementation: needed (modes, modes:multiple, step:grant_effect, field:grant_effect.modify, cast_option:escalate, cast_option:per_extra_mode)

### Colossal Majesty

Type: Enchantment

Oracle text:

> At the beginning of your upkeep, if you control a creature with power 4 or greater, draw a card.

Re-rendered plain English:

```
Colossal Majesty [draft]
  [a1] triggered [needed: needs trigger:intervening_if]
    Oracle: At the beginning of your upkeep, if you control a creature with power 4 or greater, draw a card.
    Trigger: At the beginning of your upkeep, if you control a creature with power 4 or greater
    Effect: Draw a card.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:intervening_if)

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

### Goreclaw, Terror of Qal Sisma

Type: Legendary Creature — Bear

Oracle text:

> Creature spells you cast with power 4 or greater cost {2} less to cast.
> Whenever Goreclaw attacks, each creature you control with power 4 or greater gets +1/+1 and gains trample until end of turn.

Re-rendered plain English:

```
Goreclaw, Terror of Qal Sisma [draft]
  [a1] static [needed: needs static]
    Oracle: Creature spells you cast with power 4 or greater cost {2} less to cast.
    Static: Creature spells with power 4 or greater you cast cost {2} less to cast
  [a2] triggered [needed: needs ref:iterated, step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, step:grant_effect, field:grant_effect.modify]
    Oracle: Whenever Goreclaw attacks, each creature you control with power 4 or greater gets +1/+1 and gains trample until end of turn.
    Trigger: Whenever Goreclaw, Terror of Qal Sisma attacks
    Effect: For each creature with power 4 or greater you control, that object gets +1/+1 until end of turn, then that object gains trample until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, ref:iterated, step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, step:grant_effect, field:grant_effect.modify)

### Ilysian Caryatid

Type: Creature — Plant

Oracle text:

> {T}: Add one mana of any color. If you control a creature with power 4 or greater, add two mana of any one color instead.

Re-rendered plain English:

```
Ilysian Caryatid [draft]
  [a1] mana [needed: needs mana:variable, mana:conditional]
    Oracle: {T}: Add one mana of any color. If you control a creature with power 4 or greater, add two mana of any one color instead.
    Cost: {T}
    Mana: add if you control a creature with power 4 or greater: two mana of any one color; otherwise one mana of any color
```

Player prompts:

- (none: no decisions)

Implementation: needed (mana:variable, mana:conditional)

### Monstrous Onslaught

Type: Sorcery

Oracle text:

> Monstrous Onslaught deals X damage divided as you choose among any number of target creatures, where X is the greatest power among creatures you control as you cast this spell.

Re-rendered plain English:

```
Monstrous Onslaught [draft]
  [a1] spell_effect [needed: needs targets:multi, quantity:greatest, field:damage_target.amountLockedOn, field:damage_target.divided]
    Oracle: Monstrous Onslaught deals X damage divided as you choose among any number of target creatures, where X is the greatest power among creatures you control as you cast this spell.
    Target t1: up to 99 target creatures  <- prompt: "Choose up to 99 target creatures."
    Effect: Deal the greatest power among creatures you control damage divided as you choose among up to 99 target creatures.
```

Player prompts:

- Monstrous Onslaught: choose targets: Choose up to 99 target creatures.

Implementation: needed (targets:multi, quantity:greatest, field:damage_target.amountLockedOn, field:damage_target.divided)

### Paradise Druid

Type: Creature — Elf Druid

Oracle text:

> This creature has hexproof as long as it's untapped. (It can't be the target of spells or abilities your opponents control.)
> {T}: Add one mana of any color.

Re-rendered plain English:

```
Paradise Druid [draft]
  [a1] static [needed: needs static]
    Oracle: This creature has hexproof as long as it's untapped. (It can't be the target of spells or abilities your opponents control.)
    Static: Paradise Druid has hexproof unless Paradise Druid is tapped
  [a2] mana [needed: needs mana:variable]
    Oracle: {T}: Add one mana of any color.
    Cost: {T}
    Mana: add one mana of any color
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, mana:variable)

### Ram Through

Type: Instant

Oracle text:

> Target creature you control deals damage equal to its power to target creature you don't control. If the creature you control has trample, excess damage is dealt to that creature's controller instead.

Re-rendered plain English:

```
Ram Through [draft]
  [a1] spell_effect [needed: needs step:if_else, field:if_else.else, field:if_else.if, field:if_else.then, predicate:matches, quantity:stat, field:damage_target.excessTo, field:damage_target.source]
    Oracle: Target creature you control deals damage equal to its power to target creature you don't control. If the creature you control has trample, excess damage is dealt to that creature's controller instead.
    Target t1: target creature you control  <- prompt: "Choose target creature you control."
    Target t2: target creature an opponent controls  <- prompt: "Choose target creature an opponent controls."
    Effect: If t1 is a permanent with trample: target creature you control deals t1's power damage to target creature an opponent controls, excess damage is dealt to controller_of_target instead; otherwise target creature you control deals t1's power damage to target creature an opponent controls.
```

Player prompts:

- Ram Through: choose a target: Choose target creature you control.
- Ram Through: choose a target: Choose target creature an opponent controls.

Implementation: needed (step:if_else, field:if_else.else, field:if_else.if, field:if_else.then, predicate:matches, quantity:stat, field:damage_target.excessTo, field:damage_target.source)

### Rishkar, Peema Renegade

Type: Legendary Creature — Elf Druid

Oracle text:

> When Rishkar enters, put a +1/+1 counter on each of up to two target creatures.
> Each creature you control with a counter on it has "{T}: Add {G}."

Re-rendered plain English:

```
Rishkar, Peema Renegade [draft]
  [a1] triggered [needed: needs targets:multi, step:add_counters, field:add_counters.on]
    Oracle: When Rishkar enters, put a +1/+1 counter on each of up to two target creatures.
    Trigger: Whenever Rishkar, Peema Renegade enters
    Target t1: up to two target creatures  <- prompt: "Choose up to two target creatures."
    Effect: Put a +1/+1 counter on up to two target creatures.
  [a2] static [needed: needs static]
    Oracle: Each creature you control with a counter on it has "{T}: Add {G}."
    Static: Creatures with a counter on it you control have an ability
```

Player prompts:

- Rishkar, Peema Renegade: choose targets: Choose up to two target creatures.

Implementation: needed (targets:multi, step:add_counters, field:add_counters.on, static)

### Tamiyo's Safekeeping

Type: Instant

Oracle text:

> Target permanent you control gains hexproof and indestructible until end of turn. You gain 2 life. (A permanent with hexproof and indestructible can't be the target of spells or abilities your opponents control. Damage and effects that say "destroy" don't destroy it.)

Re-rendered plain English:

```
Tamiyo's Safekeeping [draft]
  [a1] spell_effect [needed: needs step:grant_effect, field:grant_effect.modify]
    Oracle: Target permanent you control gains hexproof and indestructible until end of turn. You gain 2 life. (A permanent with hexproof and indestructible can't be the target of spells or abilities your opponents control. Damage and effects that say "destroy" don't destroy it.)
    Target t1: target permanent you control  <- prompt: "Choose target permanent you control."
    Effect: Target permanent you control gains hexproof and gains indestructible until end of turn. Then, gain 2 life.
```

Player prompts:

- Tamiyo's Safekeeping: choose a target: Choose target permanent you control.

Implementation: needed (step:grant_effect, field:grant_effect.modify)

### Whisperer of the Wilds

Type: Creature — Human Shaman

Oracle text:

> {T}: Add {G}.
> Ferocious — {T}: Add {G}{G}. Activate only if you control a creature with power 4 or greater.

Re-rendered plain English:

```
Whisperer of the Wilds [draft]
  [a1] mana [implemented]
    Oracle: {T}: Add {G}.
    Cost: {T}
    Mana: add {G}
  [a2] mana [needed: needs timing]
    Oracle: Ferocious — {T}: Add {G}{G}. Activate only if you control a creature with power 4 or greater.
    Cost: {T}
    Timing: you control a creature with power 4 or greater
    Mana: add {G}{G}
```

Player prompts:

- (none: no decisions)

Implementation: needed (timing)

### Rhonas's Monument

Type: Legendary Artifact

Oracle text:

> Green creature spells you cast cost {1} less to cast.
> Whenever you cast a creature spell, target creature you control gets +2/+2 and gains trample until end of turn.

Re-rendered plain English:

```
Rhonas's Monument [draft]
  [a1] static [needed: needs static]
    Oracle: Green creature spells you cast cost {1} less to cast.
    Static: Green creature spells you cast cost {1} less to cast
  [a2] triggered [needed: needs step:grant_effect, field:grant_effect.modify]
    Oracle: Whenever you cast a creature spell, target creature you control gets +2/+2 and gains trample until end of turn.
    Trigger: Whenever you cast a creature spell
    Target t1: target creature you control  <- prompt: "Choose target creature you control."
    Effect: Target creature you control gets +2/+2 until end of turn. Then, target creature you control gains trample until end of turn.
```

Player prompts:

- Rhonas's Monument: choose a target: Choose target creature you control.

Implementation: needed (static, step:grant_effect, field:grant_effect.modify)

### Tranquil Thicket

Type: Land

Oracle text:

> This land enters tapped.
> {T}: Add {G}.
> Cycling {G} ({G}, Discard this card: Draw a card.)

Re-rendered plain English:

```
Tranquil Thicket [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped.
    Replacement: If Tranquil Thicket would enter, it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {G}.
    Cost: {T}
    Mana: add {G}
  [a3] activated (from hand) [needed: needs zone:hand, cost:discard]
    Oracle: Cycling {G} ({G}, Discard this card: Draw a card.)
    Cost: {G}, discard Tranquil Thicket
    Effect: Draw a card.
    Keyword: cycling
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter, zone:hand, cost:discard)

## Kernel to-do: missing capabilities across this deck

| capability | cards | needing it |
|---|---|---|
| `static` | 17 | Carnage Tyrant; Dungrove Elder; Loot, Exuberant Explorer; Regal Imperiosaur; Rhonas the Indomitable; Steel Leaf Champion; Surrak and Goreclaw; Tangleweave Armor; Yeva, Nature's Herald; Challenger Troll; Garruk's Uprising; Goreclaw, Terror of Qal Sisma; Kenrith's Transformation; Paradise Druid; Rishkar, Peema Renegade; Rhonas's Monument; Swiftfoot Boots |
| `field:grant_effect.modify` | 10 | Overwhelming Stampede; Rhonas the Indomitable; Surrak and Goreclaw; Surrak, the Hunt Caller; Witch's Clinic; Collective Resistance; Goreclaw, Terror of Qal Sisma; Tamiyo's Safekeeping; Rhonas's Monument; Rogue's Passage |
| `step:grant_effect` | 10 | Overwhelming Stampede; Rhonas the Indomitable; Surrak and Goreclaw; Surrak, the Hunt Caller; Witch's Clinic; Collective Resistance; Goreclaw, Terror of Qal Sisma; Tamiyo's Safekeeping; Rhonas's Monument; Rogue's Passage |
| `field:add_counters.on` | 7 | Managorger Hydra; Pugnacious Hammerskull; Scavenging Ooze; Surrak and Goreclaw; Thickest in the Thicket; Whiptongue Hydra; Rishkar, Peema Renegade |
| `step:add_counters` | 7 | Managorger Hydra; Pugnacious Hammerskull; Scavenging Ooze; Surrak and Goreclaw; Thickest in the Thicket; Whiptongue Hydra; Rishkar, Peema Renegade |
| `trigger:subject` | 7 | Arasta of the Endless Web; Curious Altisaur; Surrak and Goreclaw; Verdant Sun's Avatar; Elemental Bond; Garruk's Packleader; Garruk's Uprising |
| `trigger:intervening_if` | 6 | Pugnacious Hammerskull; Scrapshooter; Surrak, the Hunt Caller; Thickest in the Thicket; Colossal Majesty; Garruk's Uprising |
| `field:choose.count` | 4 | Loot, Exuberant Explorer; Rishkar's Expertise; Mosswort Bridge; Clifftop Lookout |
| `field:choose.from` | 4 | Loot, Exuberant Explorer; Rishkar's Expertise; Mosswort Bridge; Clifftop Lookout |
| `field:choose.saveAs` | 4 | Loot, Exuberant Explorer; Rishkar's Expertise; Mosswort Bridge; Clifftop Lookout |
| `mana:variable` | 4 | Birds of Paradise; Ilysian Caryatid; Paradise Druid; Commander's Sphere |
| `quantity:stat` | 4 | Thickest in the Thicket; Unnatural Growth; Bite Down; Ram Through |
| `step:choose` | 4 | Loot, Exuberant Explorer; Rishkar's Expertise; Mosswort Bridge; Clifftop Lookout |
| `cost:sacrifice` | 3 | Scavenger Grounds; Thrashing Brontodon; Commander's Sphere |
| `field:move_card_zone.order` | 3 | Loot, Exuberant Explorer; Mosswort Bridge; Clifftop Lookout |
| `field:move_card_zone.position` | 3 | Loot, Exuberant Explorer; Mosswort Bridge; Clifftop Lookout |
| `field:move_card_zone.what` | 3 | Loot, Exuberant Explorer; Mosswort Bridge; Clifftop Lookout |
| `quantity:count` | 3 | Arachnogenesis; Ezuri's Predation; Shamanic Revelation |
| `quantity:greatest` | 3 | Overwhelming Stampede; Rishkar's Expertise; Monstrous Onslaught |
| `field:attach.to` | 2 | Tangleweave Armor; Swiftfoot Boots |
| `field:attach.what` | 2 | Tangleweave Armor; Swiftfoot Boots |
| `field:choose.fromLooked` | 2 | Loot, Exuberant Explorer; Mosswort Bridge |
| `field:create_tokens.tokenKeywords` | 2 | Arachnogenesis; Arasta of the Endless Web |
| `field:damage_target.source` | 2 | Bite Down; Ram Through |
| `field:if_else.if` | 2 | Scavenging Ooze; Ram Through |
| `field:if_else.then` | 2 | Scavenging Ooze; Ram Through |
| `field:permission_to_play.what` | 2 | Rishkar's Expertise; Mosswort Bridge |
| `field:permission_to_play.withoutPaying` | 2 | Rishkar's Expertise; Mosswort Bridge |
| `field:permission_to_play.zone` | 2 | Rishkar's Expertise; Mosswort Bridge |
| `field:repeat_for_each.over` | 2 | Unnatural Growth; Goreclaw, Terror of Qal Sisma |
| `field:repeat_for_each.steps` | 2 | Unnatural Growth; Goreclaw, Terror of Qal Sisma |
| `filter:isCommander` | 2 | Tangleweave Armor; Witch's Clinic |
| `modes` | 2 | Elder Gargaroth; Collective Resistance |
| `predicate:compare` | 2 | Surrak, the Hunt Caller; Mosswort Bridge |
| `predicate:matches` | 2 | Scavenging Ooze; Ram Through |
| `ref:created` | 2 | Ezuri's Predation; Tangleweave Armor |
| `ref:iterated` | 2 | Unnatural Growth; Goreclaw, Terror of Qal Sisma |
| `replacement:would_enter` | 2 | Mosswort Bridge; Tranquil Thicket |
| `static:setBasePT` | 2 | Dungrove Elder; Kenrith's Transformation |
| `step:attach` | 2 | Tangleweave Armor; Swiftfoot Boots |
| `step:if_else` | 2 | Scavenging Ooze; Ram Through |
| `step:look_top` | 2 | Loot, Exuberant Explorer; Mosswort Bridge |
| `step:permission_to_play` | 2 | Rishkar's Expertise; Mosswort Bridge |
| `step:repeat_for_each` | 2 | Unnatural Growth; Goreclaw, Terror of Qal Sisma |
| `step:reveal` | 2 | Loot, Exuberant Explorer; Clifftop Lookout |
| `targets:multi` | 2 | Monstrous Onslaught; Rishkar, Peema Renegade |
| `timing` | 2 | Bonders' Enclave; Whisperer of the Wilds |
| `zone:stack` | 2 | Ghalta, Primal Hunger; Carnage Tyrant |
| `cast_option:escalate` | 1 | Collective Resistance |
| `cast_option:gift` | 1 | Scrapshooter |
| `cast_option:per_extra_mode` | 1 | Collective Resistance |
| `cost_reduction` | 1 | Ghalta, Primal Hunger |
| `cost_reduction:variable` | 1 | Ghalta, Primal Hunger |
| `cost:discard` | 1 | Tranquil Thicket |
| `cost:life` | 1 | War Room |
| `field:add_mana.produces` | 1 | Hulking Raptor |
| `field:choose.fromRevealed` | 1 | Clifftop Lookout |
| `field:create_tokens.who` | 1 | Beast Within |
| `field:damage_target.amountLockedOn` | 1 | Monstrous Onslaught |
| `field:damage_target.divided` | 1 | Monstrous Onslaught |
| `field:damage_target.excessTo` | 1 | Ram Through |
| `field:destroy_all.filter` | 1 | Whiptongue Hydra |
| `field:draw_cards.who` | 1 | Scrapshooter |
| `field:fight_pairs.against` | 1 | Ezuri's Predation |
| `field:fight_pairs.fighters` | 1 | Ezuri's Predation |
| `field:fight_pairs.pairing` | 1 | Ezuri's Predation |
| `field:grant_effect.filter` | 1 | Overwhelming Stampede |
| `field:if_else.else` | 1 | Ram Through |
| `field:mass_pump.filter` | 1 | Overwhelming Stampede |
| `field:move_card_zone.all` | 1 | Scavenger Grounds |
| `field:move_card_zone.faceDown` | 1 | Mosswort Bridge |
| `field:move_card_zone.from` | 1 | Scavenger Grounds |
| `field:move_card_zone.linkExile` | 1 | Mosswort Bridge |
| `field:move_card_zone.tapped` | 1 | Clifftop Lookout |
| `field:move_card_zone.who` | 1 | Scavenger Grounds |
| `field:reveal.until` | 1 | Clifftop Lookout |
| `filter:attackingYou` | 1 | Arachnogenesis |
| `filter:notSubtypes` | 1 | Arachnogenesis |
| `keyword:enchant` | 1 | Kenrith's Transformation |
| `mana:conditional` | 1 | Ilysian Caryatid |
| `modes:multiple` | 1 | Collective Resistance |
| `predicate:not` | 1 | Pugnacious Hammerskull |
| `predicate:paid_additional_cost` | 1 | Scrapshooter |
| `quantity:math` | 1 | Whiptongue Hydra |
| `ref:linked_exile` | 1 | Mosswort Bridge |
| `replacement:damage_qualifiers` | 1 | Arachnogenesis |
| `replacement:duration` | 1 | Arachnogenesis |
| `replacement:would_deal_damage` | 1 | Arachnogenesis |
| `static:extraLandDrops` | 1 | Loot, Exuberant Explorer |
| `static:setColors` | 1 | Kenrith's Transformation |
| `step:add_mana` | 1 | Hulking Raptor |
| `step:counter_spell` | 1 | Hulking Raptor |
| `step:fight_pairs` | 1 | Ezuri's Predation |
| `step:unless_pay` | 1 | Hulking Raptor |
| `trigger:becomes_target` | 1 | Hulking Raptor |
| `trigger:begin_step:precombat_main` | 1 | Hulking Raptor |
| `trigger:block` | 1 | Elder Gargaroth |
| `trigger:dealt_damage` | 1 | Ripjaw Raptor |
| `trigger:multi_event` | 1 | Elder Gargaroth |
| `zone:hand` | 1 | Tranquil Thicket |

## Decisions

- Consolidated schema pass: the workarounds reported by the five pilot decks (sentinels, review.ignore hacks, scripted stubs, placeholder refs) now use real fields; see src/kernel/SCHEMA_CHANGELOG.md.
- Monarch stays a scripted marker (become_monarch + the controller_is_monarch stat) by user decision; Crew, Improvise, Myriad, Storm, Read ahead, Manifest dread, Reselect attack target and tapped-for-{C} stay scripted markers (vocabulary listed in the changelog).
- Remaining genuine card-behaviour questions are collected in data/kernel-drafts/CONSOLIDATED_QUESTIONS.md, not per deck.
