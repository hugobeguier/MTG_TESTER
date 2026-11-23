# Kernel draft approval: Squirreled Away

85 unique cards: 42 simple (A), 43 complex (B). Validator: 85/85 pass. Cards with implementation "needed": 79. All drafts are `review.status: "draft"`; nothing was written to the DB.

Reading guide: each card below shows the oracle text and what the structured JSON says back in plain English. Approve if they match.

## (A) Simple cards: spot-check one line each

- **Arasta of the Endless Web** (Legendary Enchantment Creature — Spider): Keyword reach | Whenever an opponent casts an instant spell or sorcery spell: Create a 1/2 green Spider creature token with reach [needs: trigger:subject, field:create_tokens.tokenKeywords]
- **Arcane Signet** (Artifact): {T}: add one mana of any color in your commander's color identity [needs: mana:variable]
- **Bojuka Bog** (Land): If Bojuka Bog would enter, it enters tapped | Whenever Bojuka Bog enters: [targets: target player] Exile a card | {T}: add {B} [needs: replacement:would_enter, field:move_card_zone.what]
- **Command Tower** (Land): {T}: add one mana of any color in your commander's color identity [needs: mana:variable]
- **Deep Forest Hermit** (Creature — Elf Druid): Keyword vanishing 3 | Whenever Deep Forest Hermit enters: Create four 1/1 green Squirrel creature tokens | Squirrels you control get +1/+1 [needs: static]
- **Evolving Wilds** (Land): {T}, sacrifice Evolving Wilds: Search your library for a basic land, put it onto the battlefield, then shuffle [needs: cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to]
- **Forest** (Basic Land — Forest): {T}: add {G} [implemented]
- **Garruk, Cursed Huntsman** (Legendary Planeswalker — Garruk): +0: Create two 2/2 black and green Wolf creature tokens and "When this token dies, put a loyalty counter on each Garruk you control." | −3: [targets: target creature] Destroy target creature, then draw a card | −6: You get an emblem with "Creatures you control get +3/+3 and have trample." [needs: ref:iterated, timing, cost:loyalty, field:create_tokens.tokenAbilities, step:create_emblem, field:create_emblem.emblem]
- **Gilded Goose** (Creature — Bird): Keyword flying | Whenever Gilded Goose enters: Create a ?/? colorless Food artifact token | {1}{G}, {T}: Create a ?/? colorless Food artifact token | {T}, sacrifice a Food you control: add one mana of any color [needs: mana:variable, cost:sacrifice]
- **Golgari Rot Farm** (Land): If Golgari Rot Farm would enter, it enters tapped | Whenever Golgari Rot Farm enters: Choose a land you control, then put the chosen object into your hand | {T}: add {B}{G} [needs: replacement:would_enter, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, field:move_card_zone.from]
- **Golgari Signet** (Artifact): {1}, {T}: add {B}{G} [implemented]
- **Gourmand's Talent** (Enchantment — Class): Keyword class | Artifacts you control are foods in addition to their other types and have an ability as long as it is your turn | {2}{G}: | Whenever you gain life for the first time each turn: Create a 3/3 green Raccoon creature token | {3}{G}: | Whenever you gain life for the first time each turn: For each creature you control, put a +1/+1 counter on that object [needs: static, static:addTypes, condition_when:static, predicate:stat, trigger:gain_life, trigger:nth, trigger:subject, ref:iterated, step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, step:add_counters, field:add_counters.on]
- **Grim Backwoods** (Land): {T}: add {C} | {2}{B}{G}, {T}, sacrifice a creature you control: Draw a card [needs: cost:sacrifice]
- **Haunted Mire** (Land — Swamp Forest): {T}: add {B} and {G} | If Haunted Mire would enter, it enters tapped [needs: replacement:would_enter]
- **Haywire Mite** (Artifact Creature — Insect): Whenever Haywire Mite dies: Gain 2 life | {G}, sacrifice Haywire Mite: [targets: target noncreature artifact or noncreature enchantment] Exile target noncreature artifact or noncreature enchantment [needs: field:life_change.amount, cost:sacrifice]
- **Honored Dreyleader** (Creature — Squirrel Warrior): Keyword trample | Whenever Honored Dreyleader enters: Put the number of other Squirrels or other Foods you control +1/+1 counters on Honored Dreyleader | Whenever an another Squirrel or another Food you control enters: Put a +1/+1 counter on Honored Dreyleader [needs: step:add_counters, quantity:count, field:add_counters.on, trigger:subject]
- **Jungle Hollow** (Land): If Jungle Hollow would enter, it enters tapped | Whenever Jungle Hollow enters: Gain 1 life | {T}: add {B} and {G} [needs: replacement:would_enter, field:life_change.amount]
- **Llanowar Wastes** (Land): {T}: add {C} | {T}: add {B} and {G} [needs: field:damage_target.source]
- **Maelstrom Pulse** (Sorcery): [targets: target nonland permanent] Destroy target nonland permanent, then destroy each another permanent with the same name as t1 [needs: filter:sameNameAs, field:destroy_all.filter]
- **Maskwood Nexus** (Artifact): Creatures you control, creature spells you control, creature cards in your hand, creature cards in your graveyard, creature cards in your library, or creature cards in exile have changeling | {3}, {T}: Create a 2/2 blue Shapeshifter creature token with changeling [needs: static, field:create_tokens.tokenKeywords]
- **Moldervine Reclamation** (Enchantment): Whenever a creature you control dies: Gain 1 life, then draw a card [needs: trigger:subject, field:life_change.amount]
- **Moonstone Eulogist** (Creature — Bat Warlock): Keyword flying | Whenever a creature an opponent controls dies: Create a ?/? colorless Blood artifact token | Whenever an artifact you control is sacrificed: Put a +1/+1 counter on Moonstone Eulogist, then gain 1 life [needs: trigger:subject, trigger:sacrifice, step:add_counters, field:add_counters.on, field:life_change.amount]
- **Ogre Slumlord** (Creature — Ogre Rogue): Whenever a nontoken another creature dies: Create a 1/1 black Rat creature token | Rats you control have deathtouch [needs: trigger:subject, static]
- **Oran-Rief, the Vastwood** (Land): If Oran-Rief, the Vastwood would enter, it enters tapped | {T}: add {G} | {T}: For each that entered this turn green creature, put a +1/+1 counter on that object [needs: replacement:would_enter, ref:iterated, filter:enteredThisTurn, step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, step:add_counters, field:add_counters.on]
- **Plaguecrafter** (Creature — Human Shaman): Whenever Plaguecrafter enters: Each player sacrifices a creature or planeswalker, then each player discard a card [needs: field:sacrifice_permanent.filter, field:sacrifice_permanent.who, field:discard.who, predicate:not, predicate:step_done]
- **Prosperous Innkeeper** (Creature — Halfling Citizen): Whenever Prosperous Innkeeper enters: Create a ?/? colorless Treasure artifact token | Whenever an another creature you control enters: Gain 1 life [needs: trigger:subject, field:life_change.amount]
- **Putrefy** (Instant): [targets: target artifact or creature] Destroy target artifact or creature [needs: field:destroy_target.noRegenerate]
- **Ravenous Squirrel** (Creature — Squirrel): Whenever an artifact or creature you control is sacrificed: Put a +1/+1 counter on Ravenous Squirrel | {1}{B}{G}, sacrifice an artifact or creature you control: Gain 1 life, then draw a card [needs: trigger:sacrifice, trigger:subject, step:add_counters, field:add_counters.on, cost:sacrifice, field:life_change.amount]
- **Shamanic Revelation** (Sorcery): Draw the number of creatures you control cards | Gain NaN life [needs: quantity:count]
- **Skullclamp** (Artifact — Equipment): The equipped creature gets +1/-1 | Whenever the equipped creature dies: Draw 2 cards | {1}: [targets: target creature you control] Attach Skullclamp to target creature you control [needs: static, trigger:subject, step:attach, field:attach.to, field:attach.what]
- **Sol Ring** (Artifact): {T}: add {C}{C} [implemented]
- **Squirrel Nest** (Enchantment — Aura): [targets: target land] | The enchanted creature has an ability [needs: keyword:enchant, static]
- **Squirrel Sovereign** (Creature — Squirrel Noble): Other Squirrels you control get +1/+1 [needs: static]
- **Swamp** (Basic Land — Swamp): {T}: add {B} [implemented]
- **Swarmyard** (Land): {T}: add {C} | {T}: [targets: target Insect, Rat, Spider, or Squirrel] Regenerate target Insect, Rat, Spider, or Squirrel [needs: step:regenerate]
- **Sword of the Squeak** (Artifact — Equipment): The equipped creature gets +X/+X, where X is the number of permanents with power 1 or permanents with toughness 1 you control | Whenever a Hamster, Mouse, Rat, or Squirrel you control enters: Attach Sword of the Squeak to that object | {2}: [targets: target creature you control] Attach Sword of the Squeak to target creature you control [needs: static, trigger:subject, step:attach, field:attach.to, field:attach.what]
- **Talisman of Resilience** (Artifact): {T}: add {C} | {T}: add {B} and {G} [needs: field:damage_target.source]
- **Temple of Malady** (Land): If Temple of Malady would enter, it enters tapped | Whenever Temple of Malady enters: Scry 1 | {T}: add {B} and {G} [needs: replacement:would_enter, step:scry]
- **Terramorphic Expanse** (Land): {T}, sacrifice Terramorphic Expanse: Search your library for a basic land, put it onto the battlefield, then shuffle [needs: cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to]
- **Tireless Provisioner** (Creature — Elf Scout): Whenever a land you control enters: Choose one of Food or Treasure, then create a ?/? colorless Food artifact token, then create a ?/? colorless Treasure artifact token [needs: trigger:subject, step:choose, field:choose.choice, field:choose.options, field:choose.remember, predicate:chosen_is]
- **Twilight Mire** (Land): {T}: add {C} | {B/G}, {T}: add {B}{B} and {B}{G} and {G}{G} [implemented]
- **Viridescent Bog** (Land): {1}, {T}: add {B}{G} [implemented]

## (B) Complex cards

### Hazel of the Rootbloom

Type: Legendary Creature — Squirrel Druid

Oracle text:

> {T}, Pay 2 life, Tap X untapped tokens you control: Add X mana in any combination of colors.
> At the beginning of your end step, create a token that's a copy of target token you control. If that token is a Squirrel, instead create two tokens that are copies of it.

Re-rendered plain English:

```
Hazel of the Rootbloom [draft]
  [a1] mana [needed: needs mana:variable, cost:life, cost:tapOther]
    Oracle: {T}, Pay 2 life, Tap X untapped tokens you control: Add X mana in any combination of colors.
    Cost: {T}, pay 2 life, tap X untapped untapped token permanents you control
    Mana: add X mana in any combination of colors
    X prompt: "Choose a value for X (the amount used in the cost)."
  [a2] triggered [needed: needs step:if_else, field:if_else.else, field:if_else.if, field:if_else.then, predicate:matches, step:copy, field:copy.count, field:copy.token]
    Oracle: At the beginning of your end step, create a token that's a copy of target token you control. If that token is a Squirrel, instead create two tokens that are copies of it.
    Trigger: At the beginning of your end step
    Target t1: target token permanent you control  <- prompt: "Choose target token permanent you control."
    Effect: If t1 is a Squirrel: copy target token permanent you control; otherwise copy target token permanent you control.
```

Player prompts:

- Hazel of the Rootbloom: choose X: Choose a value for X (the amount used in the cost).
- Hazel of the Rootbloom: choose what to tap: Choose X untapped untapped token permanents you control to tap.
- Hazel of the Rootbloom: choose a target: Choose target token permanent you control.

Implementation: needed (mana:variable, cost:life, cost:tapOther, step:if_else, field:if_else.else, field:if_else.if, field:if_else.then, predicate:matches, step:copy, field:copy.count, field:copy.token)

### Academy Manufactor

Type: Artifact Creature — Assembly-Worker

Oracle text:

> If you would create a Clue, Food, or Treasure token, instead create one of each.

Re-rendered plain English:

```
Academy Manufactor [draft]
  [a1] replacement [needed: needs replacement:would_create_token, quantity:event_amount]
    Oracle: If you would create a Clue, Food, or Treasure token, instead create one of each.
    Replacement: If a Clue, Food, or Treasure you control would create token, instead: create that many ?/? colorless Clue artifact tokens, then create that many ?/? colorless Food artifact tokens, then create that many ?/? colorless Treasure artifact tokens
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_create_token, quantity:event_amount)

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

### Bastion of Remembrance

Type: Enchantment

Oracle text:

> When this enchantment enters, create a 1/1 white Human Soldier creature token.
> Whenever a creature you control dies, each opponent loses 1 life and you gain 1 life.

Re-rendered plain English:

```
Bastion of Remembrance [draft]
  [a1] triggered [implemented]
    Oracle: When this enchantment enters, create a 1/1 white Human Soldier creature token.
    Trigger: Whenever Bastion of Remembrance enters
    Effect: Create a 1/1 white Human Soldier creature token.
  [a2] triggered [needed: needs trigger:subject, field:life_change.amount, field:life_change.lose, field:life_change.who]
    Oracle: Whenever a creature you control dies, each opponent loses 1 life and you gain 1 life.
    Trigger: Whenever a creature you control dies
    Effect: Each opponent gains 1 life. Then, gain 1 life.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:subject, field:life_change.amount, field:life_change.lose, field:life_change.who)

### Beastmaster Ascension

Type: Enchantment

Oracle text:

> Whenever a creature you control attacks, you may put a quest counter on this enchantment.
> As long as this enchantment has seven or more quest counters on it, creatures you control get +5/+5.

Re-rendered plain English:

```
Beastmaster Ascension [draft]
  [a1] triggered [needed: needs trigger:subject, step:add_counters, field:add_counters.on]
    Oracle: Whenever a creature you control attacks, you may put a quest counter on this enchantment.
    Trigger: Whenever a creature you control attacks
    Effect: Put a quest counter on Beastmaster Ascension.
    (optional: Do you want to put a quest counter on Beastmaster Ascension?)
  [a2] static [needed: needs static]
    Oracle: As long as this enchantment has seven or more quest counters on it, creatures you control get +5/+5.
    Static: Creatures you control get +5/+5 as long as the number of quest counters on self is 7 or greater
```

Player prompts:

- Beastmaster Ascension: optional: Do you want to put a quest counter on Beastmaster Ascension?

Implementation: needed (trigger:subject, step:add_counters, field:add_counters.on, static)

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

### Binding the Old Gods

Type: Enchantment — Saga

Oracle text:

> (As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)
> I — Destroy target nonland permanent an opponent controls.
> II — Search your library for a Forest card, put it onto the battlefield tapped, then shuffle.
> III — Creatures you control gain deathtouch until end of turn.

Re-rendered plain English:

```
Binding the Old Gods [draft]
  [a1] keyword [implemented]
    Oracle: (As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)
    Keyword: saga
  [a2] triggered [needed: needs trigger:counter_put, trigger:chapters]
    Oracle: I — Destroy target nonland permanent an opponent controls.
    Trigger: Chapter I
    Target t1: target nonland permanent an opponent controls  <- prompt: "Choose target nonland permanent an opponent controls."
    Effect: Destroy target nonland permanent an opponent controls.
  [a3] triggered [needed: needs trigger:counter_put, trigger:chapters, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to]
    Oracle: II — Search your library for a Forest card, put it onto the battlefield tapped, then shuffle.
    Trigger: Chapter II
    Effect: Search your library for a Forest, put it onto the battlefield, then shuffle.
  [a4] triggered [needed: needs trigger:counter_put, trigger:chapters, step:grant_effect, field:grant_effect.all, field:grant_effect.filter, field:grant_effect.modify]
    Oracle: III — Creatures you control gain deathtouch until end of turn.
    Trigger: Chapter III
    Effect: The target gains deathtouch until end of turn.
```

Player prompts:

- Binding the Old Gods: choose a target: Choose target nonland permanent an opponent controls.
- Binding the Old Gods: search: Choose a Forest from the library.

Implementation: needed (trigger:counter_put, trigger:chapters, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to, step:grant_effect, field:grant_effect.all, field:grant_effect.filter, field:grant_effect.modify)

### Cache Grab

Type: Instant

Oracle text:

> Mill four cards. You may put a permanent card from among the cards milled this way into your hand. If you control a Squirrel or returned a Squirrel card to your hand this way, create a Food token. (To mill four cards, put the top four cards of your library into your graveyard. A Food token is an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life.")

Re-rendered plain English:

```
Cache Grab [draft]
  [a1] spell_effect [needed: needs step:choose, field:choose.count, field:choose.from, field:choose.fromMilled, field:choose.saveAs, field:move_card_zone.from, predicate:step_done, predicate:all, predicate:matches]
    Oracle: Mill four cards. You may put a permanent card from among the cards milled this way into your hand. If you control a Squirrel or returned a Squirrel card to your hand this way, create a Food token. (To mill four cards, put the top four cards of your library into your graveyard. A Food token is an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life.")
    Effect: Mill 4 cards. Then, you may choose a permanent card in your graveyard. Then, IF you did (s2): put the chosen object into your hand. Then, IF you control a Squirrel or you did (s3) and the chosen object is a Squirrel: create a ?/? colorless Food artifact token.
```

Player prompts:

- Cache Grab: optional: Do you want to choose a permanent card in your graveyard?

Implementation: needed (step:choose, field:choose.count, field:choose.from, field:choose.fromMilled, field:choose.saveAs, field:move_card_zone.from, predicate:step_done, predicate:all, predicate:matches)

### Casualties of War

Type: Sorcery

Oracle text:

> Choose one or more —
> • Destroy target artifact.
> • Destroy target creature.
> • Destroy target enchantment.
> • Destroy target land.
> • Destroy target planeswalker.

Re-rendered plain English:

```
Casualties of War [draft]
  [a1] spell_effect [needed: needs modes, modes:multiple]
    Oracle: Choose one or more — / • Destroy target artifact. / • Destroy target creature. / • Destroy target enchantment. / • Destroy target land. / • Destroy target planeswalker.
    Modes: choose 1-5  <- prompt: "Choose one or more modes."
      - Destroy target artifact. (target: target artifact)
      - Destroy target creature. (target: target creature)
      - Destroy target enchantment. (target: target enchantment)
      - Destroy target land. (target: target land)
      - Destroy target planeswalker. (target: target planeswalker)
```

Player prompts:

- Casualties of War: choose modes: Choose one or more modes.
- Casualties of War: choose a target: Choose target artifact.
- Casualties of War: choose a target: Choose target creature.
- Casualties of War: choose a target: Choose target enchantment.
- Casualties of War: choose a target: Choose target land.
- Casualties of War: choose a target: Choose target planeswalker.

Implementation: needed (modes, modes:multiple)

### Chatterfang, Squirrel General

Type: Legendary Creature — Squirrel Warrior

Oracle text:

> Forestwalk (This creature can't be blocked as long as defending player controls a Forest.)
> If one or more tokens would be created under your control, those tokens plus that many 1/1 green Squirrel creature tokens are created instead.
> {B}, Sacrifice X Squirrels: Target creature gets +X/-X until end of turn.

Re-rendered plain English:

```
Chatterfang, Squirrel General [draft]
  [a1] keyword [needed: needs keyword:landwalk]
    Oracle: Forestwalk (This creature can't be blocked as long as defending player controls a Forest.)
    Keyword: landwalk Forest
  [a2] replacement [needed: needs replacement:would_create_token, quantity:event_amount]
    Oracle: If one or more tokens would be created under your control, those tokens plus that many 1/1 green Squirrel creature tokens are created instead.
    Replacement: If you would create token, also: create that many 1/1 green Squirrel creature tokens
  [a3] activated [needed: needs cost:sacrifice, quantity:X, quantity:math]
    Oracle: {B}, Sacrifice X Squirrels: Target creature gets +X/-X until end of turn.
    Cost: {B}, sacrifice X Squirrels you control
    Target t1: target creature  <- prompt: "Choose target creature."
    Effect: Target creature gets +X/+-1 x X until end of turn.
    X prompt: "Choose a value for X (the amount used in the cost)."
```

Player prompts:

- Chatterfang, Squirrel General: choose a target: Choose target creature.
- Chatterfang, Squirrel General: choose X: Choose a value for X (the amount used in the cost).
- Chatterfang, Squirrel General: choose what to sacrifice: Choose X Squirrels you control to sacrifice.

Implementation: needed (keyword:landwalk, replacement:would_create_token, quantity:event_amount, cost:sacrifice, quantity:X, quantity:math)

### Chatterstorm

Type: Sorcery

Oracle text:

> Create a 1/1 green Squirrel creature token.
> Storm (When you cast this spell, copy it for each spell cast before it this turn.)

Re-rendered plain English:

```
Chatterstorm [draft]
  [a1] spell_effect [implemented]
    Oracle: Create a 1/1 green Squirrel creature token.
    Effect: Create a 1/1 green Squirrel creature token.
  [a2] triggered (from stack) [needed: needs scripted:storm, zone:stack, step:copy, field:copy.count]
    Oracle: Storm (When you cast this spell, copy it for each spell cast before it this turn.)
    Trigger: Whenever a player casts Chatterstorm
    Effect: Copy Chatterstorm.
    Scripted (engine-specific rule, not described by the fields above): storm
    Keyword: storm
```

Player prompts:

- (none: no decisions)

Implementation: needed (scripted:storm, zone:stack, step:copy, field:copy.count)

### Chittering Witch

Type: Creature — Human Warlock

Oracle text:

> When this creature enters, create a number of 1/1 black Rat creature tokens equal to the number of opponents you have.
> {1}{B}, Sacrifice a creature: Target creature gets -2/-2 until end of turn.

Re-rendered plain English:

```
Chittering Witch [draft]
  [a1] triggered [needed: needs quantity:opponents_count]
    Oracle: When this creature enters, create a number of 1/1 black Rat creature tokens equal to the number of opponents you have.
    Trigger: Whenever Chittering Witch enters
    Effect: Create the number of opponents you have 1/1 black Rat creature tokens.
  [a2] activated [needed: needs cost:sacrifice]
    Oracle: {1}{B}, Sacrifice a creature: Target creature gets -2/-2 until end of turn.
    Cost: {1}{B}, sacrifice a creature you control
    Target t1: target creature  <- prompt: "Choose target creature."
    Effect: Target creature gets -2/-2 until end of turn.
```

Player prompts:

- Chittering Witch: choose a target: Choose target creature.
- Chittering Witch: choose what to sacrifice: Choose 1 creature you control to sacrifice.

Implementation: needed (quantity:opponents_count, cost:sacrifice)

### Chitterspitter

Type: Artifact

Oracle text:

> At the beginning of your upkeep, you may sacrifice a token. If you do, put an acorn counter on this artifact.
> Squirrels you control get +1/+1 for each acorn counter on this artifact.
> {G}, {T}: Create a 1/1 green Squirrel creature token.

Re-rendered plain English:

```
Chitterspitter [draft]
  [a1] triggered [needed: needs field:sacrifice_permanent.filter, step:add_counters, field:add_counters.on, predicate:step_done]
    Oracle: At the beginning of your upkeep, you may sacrifice a token. If you do, put an acorn counter on this artifact.
    Trigger: At the beginning of your upkeep
    Effect: You may sacrifice a token permanent you control. Then, IF you did (s1): put a acorn counter on Chitterspitter.
  [a2] static [needed: needs static]
    Oracle: Squirrels you control get +1/+1 for each acorn counter on this artifact.
    Static: Squirrels you control get +X/+X, where X is the number of acorn counters on self
  [a3] activated [implemented]
    Oracle: {G}, {T}: Create a 1/1 green Squirrel creature token.
    Cost: {G}, {T}
    Effect: Create a 1/1 green Squirrel creature token.
```

Player prompts:

- Chitterspitter: optional: Do you want to sacrifice a token permanent you control?

Implementation: needed (field:sacrifice_permanent.filter, step:add_counters, field:add_counters.on, predicate:step_done, static)

### Deadly Dispute

Type: Instant

Oracle text:

> As an additional cost to cast this spell, sacrifice an artifact or creature.
> Draw two cards and create a Treasure token. (It's an artifact with "{T}, Sacrifice this token: Add one mana of any color.")

Re-rendered plain English:

```
Deadly Dispute [draft]
  Cast option c1: you may use additional (from hand, cost sacrifice an artifact or creature you control) [needed]
  [a1] cast_option [needed: needs cast_option]
    Oracle: As an additional cost to cast this spell, sacrifice an artifact or creature.
  [a2] spell_effect [implemented]
    Oracle: Draw two cards and create a Treasure token. (It's an artifact with "{T}, Sacrifice this token: Add one mana of any color.")
    Effect: Draw 2 cards. Then, create a ?/? colorless Treasure artifact token.
```

Player prompts:

- Deadly Dispute: additional cost: Choose how to pay the additional cost (sacrifice an artifact or creature you control).

Implementation: needed (cast_option, cast_option:additional, cast_option:mandatory, cost:sacrifice)

### Decree of Pain

Type: Sorcery

Oracle text:

> Destroy all creatures. They can't be regenerated. Draw a card for each creature destroyed this way.
> Cycling {3}{B}{B} ({3}{B}{B}, Discard this card: Draw a card.)
> When you cycle this card, all creatures get -2/-2 until end of turn.

Re-rendered plain English:

```
Decree of Pain [draft]
  [a1] spell_effect [needed: needs quantity:step_result, field:destroy_all.filter, field:destroy_all.noRegenerate]
    Oracle: Destroy all creatures. They can't be regenerated. Draw a card for each creature destroyed this way.
    Effect: Destroy each creature. Then, draw the number affected this way (s1) cards.
  [a2] activated (from hand) [needed: needs zone:hand, cost:discard]
    Oracle: Cycling {3}{B}{B} ({3}{B}{B}, Discard this card: Draw a card.)
    Cost: {3}{B}{B}, discard Decree of Pain
    Effect: Draw a card.
    Keyword: cycling {3}{B}{B}
  [a3] triggered (from hand) [needed: needs zone:hand, trigger:cycle, field:mass_pump.filter]
    Oracle: When you cycle this card, all creatures get -2/-2 until end of turn.
    Trigger: Whenever a player cycles Decree of Pain
    Effect: All creatures get -2/-2 until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (quantity:step_result, field:destroy_all.filter, field:destroy_all.noRegenerate, zone:hand, cost:discard, trigger:cycle, field:mass_pump.filter)

### End-Raze Forerunners

Type: Creature — Boar

Oracle text:

> Vigilance, trample, haste
> When this creature enters, other creatures you control get +2/+2 and gain vigilance and trample until end of turn.

Re-rendered plain English:

```
End-Raze Forerunners [draft]
  [a1] keyword [implemented]
    Oracle: Vigilance
    Keyword: vigilance
  [a2] keyword [implemented]
    Oracle: Trample
    Keyword: trample
  [a3] keyword [implemented]
    Oracle: Haste
    Keyword: haste
  [a4] triggered [needed: needs step:grant_effect, field:grant_effect.all, field:grant_effect.filter, field:grant_effect.modify]
    Oracle: When this creature enters, other creatures you control get +2/+2 and gain vigilance and trample until end of turn.
    Trigger: Whenever End-Raze Forerunners enters
    Effect: The target gets +2/+2 and gains vigilance and gains trample until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (step:grant_effect, field:grant_effect.all, field:grant_effect.filter, field:grant_effect.modify)

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

### Hazel's Brewmaster

Type: Creature — Squirrel Warlock

Oracle text:

> Menace
> Whenever this creature enters or attacks, exile up to one target card from a graveyard and create a Food token.
> Foods you control have all activated abilities of all creature cards exiled with this creature.

Re-rendered plain English:

```
Hazel's Brewmaster [draft]
  [a1] keyword [implemented]
    Oracle: Menace
    Keyword: menace
  [a2] triggered [needed: needs trigger:multi_event, targets:multi, field:exile_target.linkExile]
    Oracle: Whenever this creature enters or attacks, exile up to one target card from a graveyard and create a Food token.
    Trigger: Whenever Hazel's Brewmaster enters or attacks
    Target t1: up to one target card in a graveyard  <- prompt: "Choose up to one target card in a graveyard."
    Effect: Exile up to one target card in a graveyard. Then, create a ?/? colorless Food artifact token.
  [a3] static [needed: needs static]
    Oracle: Foods you control have all activated abilities of all creature cards exiled with this creature.
    Static: Foods you control have an ability
```

Player prompts:

- Hazel's Brewmaster: choose a target: Choose up to one target card in a graveyard.

Implementation: needed (trigger:multi_event, targets:multi, field:exile_target.linkExile, static)

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

### Insatiable Frugivore

Type: Creature — Rat Berserker

Oracle text:

> When this creature enters, create a Food token, then you may exile three cards from your graveyard. If you do, repeat this process.
> {3}{B}, Sacrifice X Foods: Creatures you control get +X/+0 and gain menace until end of turn.

Re-rendered plain English:

```
Insatiable Frugivore [draft]
  [a1] triggered [needed: needs step:repeat_process, field:repeat_process.repeatIf, field:repeat_process.steps, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, field:move_card_zone.what, predicate:step_done]
    Oracle: When this creature enters, create a Food token, then you may exile three cards from your graveyard. If you do, repeat this process.
    Trigger: Whenever Insatiable Frugivore enters
    Effect: Create a ?/? colorless Food artifact token, then choose 3 cards in your graveyard, then exile a card; then repeat this process as long as you did (s2).
  [a2] activated [needed: needs cost:sacrifice, step:grant_effect, field:grant_effect.all, field:grant_effect.filter, field:grant_effect.modify]
    Oracle: {3}{B}, Sacrifice X Foods: Creatures you control get +X/+0 and gain menace until end of turn.
    Cost: {3}{B}, sacrifice X Foods you control
    Effect: The target gets +X/+0 and gains menace until end of turn.
    X prompt: "Choose a value for X (the amount used in the cost)."
```

Player prompts:

- Insatiable Frugivore: exile three cards: Choose three cards from your graveyard to exile. If you do, repeat this process.
- Insatiable Frugivore: choose X: Choose a value for X (the amount used in the cost).
- Insatiable Frugivore: choose what to sacrifice: Choose X Foods you control to sacrifice.

Implementation: needed (step:repeat_process, field:repeat_process.repeatIf, field:repeat_process.steps, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, field:move_card_zone.what, predicate:step_done, cost:sacrifice, step:grant_effect, field:grant_effect.all, field:grant_effect.filter, field:grant_effect.modify)

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

### Nadier's Nightblade

Type: Creature — Elf Warrior

Oracle text:

> Whenever a token you control leaves the battlefield, each opponent loses 1 life and you gain 1 life.

Re-rendered plain English:

```
Nadier's Nightblade [draft]
  [a1] triggered [needed: needs trigger:leaves, trigger:subject, trigger:zones, field:life_change.amount, field:life_change.lose, field:life_change.who]
    Oracle: Whenever a token you control leaves the battlefield, each opponent loses 1 life and you gain 1 life.
    Trigger: Whenever a token permanent you control leaves the battlefield
    Effect: Each opponent gains 1 life. Then, gain 1 life.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:leaves, trigger:subject, trigger:zones, field:life_change.amount, field:life_change.lose, field:life_change.who)

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

### Nested Shambler

Type: Creature — Zombie

Oracle text:

> When this creature dies, create X tapped 1/1 green Squirrel creature tokens, where X is this creature's power.

Re-rendered plain English:

```
Nested Shambler [draft]
  [a1] triggered [needed: needs quantity:stat, field:create_tokens.tokenTapped]
    Oracle: When this creature dies, create X tapped 1/1 green Squirrel creature tokens, where X is this creature's power.
    Trigger: Whenever Nested Shambler dies
    Effect: Create Nested Shambler's power 1/1 green Squirrel creature tokens tapped.
```

Player prompts:

- (none: no decisions)

Implementation: needed (quantity:stat, field:create_tokens.tokenTapped)

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

### Plumb the Forbidden

Type: Instant

Oracle text:

> As an additional cost to cast this spell, you may sacrifice one or more creatures. When you do, copy this spell for each creature sacrificed this way.
> You draw a card and lose 1 life.

Re-rendered plain English:

```
Plumb the Forbidden [draft]
  Cast option c1: you may use additional (from hand, cost sacrifice X creatures you control) [needed]
  [a1] triggered (from stack) [needed: needs zone:stack, trigger:intervening_if, predicate:paid_additional_cost, step:copy, field:copy.count, field:copy.reflexive]
    Oracle: As an additional cost to cast this spell, you may sacrifice one or more creatures. When you do, copy this spell for each creature sacrificed this way.
    Trigger: Whenever a player casts Plumb the Forbidden, if the additional cost was paid
    Effect: Copy Plumb the Forbidden.
  [a2] spell_effect [needed: needs field:life_change.amount, field:life_change.lose]
    Oracle: You draw a card and lose 1 life.
    Effect: Draw a card. Then, gain 1 life.
```

Player prompts:

- Plumb the Forbidden: additional option: Do you want to pay the additional cost (sacrifice X creatures you control)?

Implementation: needed (zone:stack, trigger:intervening_if, predicate:paid_additional_cost, step:copy, field:copy.count, field:copy.reflexive, field:life_change.amount, field:life_change.lose, cast_option:additional, cost:sacrifice)

### Poison-Tip Archer

Type: Creature — Elf Archer

Oracle text:

> Reach (This creature can block creatures with flying.)
> Deathtouch (Any amount of damage this deals to a creature is enough to destroy it.)
> Whenever another creature dies, each opponent loses 1 life.

Re-rendered plain English:

```
Poison-Tip Archer [draft]
  [a1] keyword [implemented]
    Oracle: Reach (This creature can block creatures with flying.)
    Keyword: reach
  [a2] keyword [implemented]
    Oracle: Deathtouch (Any amount of damage this deals to a creature is enough to destroy it.)
    Keyword: deathtouch
  [a3] triggered [needed: needs trigger:subject, field:life_change.amount, field:life_change.lose, field:life_change.who]
    Oracle: Whenever another creature dies, each opponent loses 1 life.
    Trigger: Whenever an another creature dies
    Effect: Each opponent gains 1 life.
```

Player prompts:

- (none: no decisions)

Implementation: needed (trigger:subject, field:life_change.amount, field:life_change.lose, field:life_change.who)

### Rootcast Apprenticeship

Type: Sorcery

Oracle text:

> Choose three. You may choose the same mode more than once.
> • Put two +1/+1 counters on target creature.
> • Create a token that's a copy of target token you control.
> • Target player creates a 1/1 green Squirrel creature token.
> • Target opponent sacrifices a nontoken artifact of their choice.

Re-rendered plain English:

```
Rootcast Apprenticeship [draft]
  [a1] spell_effect [needed: needs modes, modes:repeatable, modes:multiple, step:add_counters, field:add_counters.on, step:copy, field:copy.count, field:copy.token, field:create_tokens.who, field:sacrifice_permanent.filter, field:sacrifice_permanent.who]
    Oracle: Choose three. You may choose the same mode more than once. / • Put two +1/+1 counters on target creature. / • Create a token that's a copy of target token you control. / • Target player creates a 1/1 green Squirrel creature token. / • Target opponent sacrifices a nontoken artifact of their choice.
    Modes: choose 3 (the same mode may be chosen more than once)  <- prompt: "Choose three modes. You may choose the same mode more than once."
      - Put 2 +1/+1 counters on target creature. (target: target creature)
      - Copy target token permanent you control. (target: target token permanent you control)
      - Create a 1/1 green Squirrel creature token. (target: target player)
      - Target player sacrifices a nontoken artifact. (target: target player)
```

Player prompts:

- Rootcast Apprenticeship: choose modes: Choose three modes. You may choose the same mode more than once.
- Rootcast Apprenticeship: choose a target: Choose target creature.
- Rootcast Apprenticeship: choose a target: Choose target token permanent you control.
- Rootcast Apprenticeship: choose a target: Choose target player.
- Rootcast Apprenticeship: sacrifice: Choose a permanent to sacrifice.

Implementation: needed (modes, modes:repeatable, modes:multiple, step:add_counters, field:add_counters.on, step:copy, field:copy.count, field:copy.token, field:create_tokens.who, field:sacrifice_permanent.filter, field:sacrifice_permanent.who)

### Saw in Half

Type: Instant

Oracle text:

> Destroy target creature. If that creature dies this way, its controller creates two tokens that are copies of that creature, except their power is half that creature's power and their toughness is half that creature's toughness. Round up each time.

Re-rendered plain English:

```
Saw in Half [draft]
  [a1] spell_effect [needed: needs quantity:step_result, quantity:division, step:copy, field:copy.count, field:copy.setPower, field:copy.setToughness, field:copy.token, field:copy.who, predicate:compare]
    Oracle: Destroy target creature. If that creature dies this way, its controller creates two tokens that are copies of that creature, except their power is half that creature's power and their toughness is half that creature's toughness. Round up each time.
    Target t1: target creature  <- prompt: "Choose target creature."
    Effect: Destroy target creature. Then, IF the number affected this way (s1) is 1 or greater: copy target creature.
```

Player prompts:

- Saw in Half: choose a target: Choose target creature.

Implementation: needed (quantity:step_result, quantity:division, step:copy, field:copy.count, field:copy.setPower, field:copy.setToughness, field:copy.token, field:copy.who, predicate:compare)

### Scurry of Squirrels

Type: Creature — Squirrel Scout

Oracle text:

> Myriad, myriad (Whenever this creature attacks, for each opponent other than defending player, you may create a token that's a copy of this creature that's tapped and attacking that player or a planeswalker they control. Then do it again. Exile the tokens at end of combat.)
> Whenever this creature deals combat damage to a player, put a +1/+1 counter on target creature you control.

Re-rendered plain English:

```
Scurry of Squirrels [draft]
  [a1] triggered [needed: needs scripted:myriad, step:copy, field:copy.attacking, field:copy.exileAt, field:copy.forEach, field:copy.tapped, field:copy.token]
    Oracle: Myriad, myriad (Whenever this creature attacks, for each opponent other than defending player, you may create a token that's a copy of this creature that's tapped and attacking that player or a planeswalker they control. Then do it again. Exile the tokens at end of combat.)
    Trigger: Whenever Scurry of Squirrels attacks
    Effect: Copy Scurry of Squirrels. Then, copy Scurry of Squirrels.
    Scripted (engine-specific rule, not described by the fields above): myriad
    Keyword: myriad
  [a2] triggered [needed: needs step:add_counters, field:add_counters.on]
    Oracle: Whenever this creature deals combat damage to a player, put a +1/+1 counter on target creature you control.
    Trigger: Whenever Scurry of Squirrels deals combat damage to a player
    Target t1: target creature you control  <- prompt: "Choose target creature you control."
    Effect: Put a +1/+1 counter on target creature you control.
```

Player prompts:

- Scurry of Squirrels: choose a target: Choose target creature you control.

Implementation: needed (scripted:myriad, step:copy, field:copy.attacking, field:copy.exileAt, field:copy.forEach, field:copy.tapped, field:copy.token, step:add_counters, field:add_counters.on)

### Second Harvest

Type: Instant

Oracle text:

> For each token you control, create a token that's a copy of that permanent.

Re-rendered plain English:

```
Second Harvest [draft]
  [a1] spell_effect [needed: needs ref:iterated, step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, step:copy, field:copy.count, field:copy.token]
    Oracle: For each token you control, create a token that's a copy of that permanent.
    Effect: For each token permanent you control, copy that object.
```

Player prompts:

- (none: no decisions)

Implementation: needed (ref:iterated, step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, step:copy, field:copy.count, field:copy.token)

### Skyfisher Spider

Type: Creature — Spider

Oracle text:

> Reach
> When this creature enters, you may sacrifice another creature. When you do, destroy target nonland permanent.
> When this creature dies, you may gain 1 life for each creature card in your graveyard. If you do, exile this card from your graveyard.

Re-rendered plain English:

```
Skyfisher Spider [draft]
  [a1] keyword [implemented]
    Oracle: Reach
    Keyword: reach
  [a2] triggered [needed: needs field:sacrifice_permanent.filter, field:destroy_target.reflexive, predicate:step_done]
    Oracle: When this creature enters, you may sacrifice another creature. When you do, destroy target nonland permanent.
    Trigger: Whenever Skyfisher Spider enters
    Target t1: target nonland permanent  <- prompt: "Choose target nonland permanent."
    Effect: You may sacrifice an another creature you control. Then, IF you did (s1): destroy target nonland permanent.
  [a3] triggered [needed: needs quantity:count, field:life_change.amount, field:move_card_zone.from, predicate:step_done]
    Oracle: When this creature dies, you may gain 1 life for each creature card in your graveyard. If you do, exile this card from your graveyard.
    Trigger: Whenever Skyfisher Spider dies
    Effect: You may gain the number of creature cards in your graveyard life. Then, IF you did (s1): exile Skyfisher Spider.
```

Player prompts:

- Skyfisher Spider: choose a target: Choose target nonland permanent.
- Skyfisher Spider: optional: Do you want to sacrifice an another creature you control?
- Skyfisher Spider: optional: Do you want to gain the number of creature cards in your graveyard life?

Implementation: needed (field:sacrifice_permanent.filter, field:destroy_target.reflexive, predicate:step_done, quantity:count, field:life_change.amount, field:move_card_zone.from)

### Swarmyard Massacre

Type: Sorcery

Oracle text:

> Create two 1/1 green Squirrel creature tokens. Then each creature that isn't an Insect, Rat, Spider, or Squirrel gets -1/-1 until end of turn for each creature you control that's an Insect, Rat, Spider, or Squirrel.

Re-rendered plain English:

```
Swarmyard Massacre [draft]
  [a1] spell_effect [needed: needs filter:notSubtypes, quantity:math, field:mass_pump.filter]
    Oracle: Create two 1/1 green Squirrel creature tokens. Then each creature that isn't an Insect, Rat, Spider, or Squirrel gets -1/-1 until end of turn for each creature you control that's an Insect, Rat, Spider, or Squirrel.
    Effect: Create two 1/1 green Squirrel creature tokens. Then, all creatures get +-1 x the number of Insects, Rats, Spiders, or Squirrels you control/+-1 x the number of Insects, Rats, Spiders, or Squirrels you control until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (filter:notSubtypes, quantity:math, field:mass_pump.filter)

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

### Tear Asunder

Type: Instant

Oracle text:

> Kicker {1}{B} (You may pay an additional {1}{B} as you cast this spell.)
> Exile target artifact or enchantment. If this spell was kicked, exile target nonland permanent instead.

Re-rendered plain English:

```
Tear Asunder [draft]
  Cast option c1: you may use kicker (from hand, cost {1}{B}) [needed]
  [a1] spell_effect [needed: needs step:if_else, field:if_else.else, field:if_else.if, field:if_else.then, predicate:kicked]
    Oracle: Exile target artifact or enchantment. If this spell was kicked, exile target nonland permanent instead.
    Target t1: target artifact or enchantment  <- prompt: "Choose target artifact or enchantment."
    Target t2: target nonland permanent  <- prompt: "Choose target nonland permanent."
    Effect: If the additional cost was paid: exile target nonland permanent; otherwise exile target artifact or enchantment.
```

Player prompts:

- Tear Asunder: choose a target: Choose target artifact or enchantment.
- Tear Asunder: choose a target: Choose target nonland permanent.
- Tear Asunder: kicker option: Do you want to pay the additional kicker cost ({1}{B})?

Implementation: needed (step:if_else, field:if_else.else, field:if_else.if, field:if_else.then, predicate:kicked, cast_option:kicker)

### The Odd Acorn Gang

Type: Legendary Creature — Squirrel Warrior

Oracle text:

> Menace, trample, reach
> Squirrels you control have "{T}: Target Squirrel gets +2/+2 and gains trample until end of turn. Activate only as a sorcery."
> Whenever one or more Squirrels you control deal combat damage to a player, draw a card.

Re-rendered plain English:

```
The Odd Acorn Gang [draft]
  [a1] keyword [implemented]
    Oracle: Menace
    Keyword: menace
  [a2] keyword [implemented]
    Oracle: Trample
    Keyword: trample
  [a3] keyword [implemented]
    Oracle: Reach
    Keyword: reach
  [a4] static [needed: needs static]
    Oracle: Squirrels you control have "{T}: Target Squirrel gets +2/+2 and gains trample until end of turn. Activate only as a sorcery."
    Static: Squirrels you control have an ability
  [a5] triggered [needed: needs trigger:batch, trigger:subject]
    Oracle: Whenever one or more Squirrels you control deal combat damage to a player, draw a card.
    Trigger: Whenever one or more Squirrels you control deal combat damage to a player
    Effect: Draw a card.
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, trigger:batch, trigger:subject)

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

### Windgrace's Judgment

Type: Instant

Oracle text:

> For any number of opponents, destroy target nonland permanent that player controls.

Re-rendered plain English:

```
Windgrace's Judgment [draft]
  [a1] spell_effect [needed: needs targets:multi, targets:per_opponent]
    Oracle: For any number of opponents, destroy target nonland permanent that player controls.
    Target t1: up to one target nonland permanent an opponent controls (one choice for each opponent)  <- prompt: "Choose up to one target nonland permanent an opponent controls (one choice for each opponent)."
    Effect: Destroy up to one target nonland permanent an opponent controls (one choice for each opponent).
```

Player prompts:

- Windgrace's Judgment: choose a target: Choose up to one target nonland permanent an opponent controls (one choice for each opponent).

Implementation: needed (targets:multi, targets:per_opponent)

### Woe Strider

Type: Creature — Horror

Oracle text:

> When this creature enters, create a 0/1 white Goat creature token.
> Sacrifice another creature: Scry 1.
> Escape—{3}{B}{B}, Exile four other cards from your graveyard. (You may cast this card from your graveyard for its escape cost.)
> This creature escapes with two +1/+1 counters on it.

Re-rendered plain English:

```
Woe Strider [draft]
  Cast option c1: you may use escape (from graveyard, cost {3}{B}{B}, exile 4 other cards in your graveyard, replaces mana cost) [needed]
  [a1] triggered [implemented]
    Oracle: When this creature enters, create a 0/1 white Goat creature token.
    Trigger: Whenever Woe Strider enters
    Effect: Create a 0/1 white Goat creature token.
  [a2] activated [needed: needs cost:sacrifice, step:scry]
    Oracle: Sacrifice another creature: Scry 1.
    Cost: sacrifice an another creature you control
    Effect: Scry 1.
  [a3] replacement [needed: needs replacement:would_enter]
    Oracle: This creature escapes with two +1/+1 counters on it.
    Replacement: If Woe Strider would enter (only if it was cast with escape), modify it: {"counters":{"+1/+1":2}}
```

Player prompts:

- Woe Strider: choose what to sacrifice: Choose 1 another creature you control to sacrifice.
- Woe Strider: escape option: Do you want to cast it using its escape cost ({3}{B}{B}, exile 4 other cards in your graveyard)?

Implementation: needed (cost:sacrifice, step:scry, replacement:would_enter, cast_option:escape, cost:exileFrom)

### Wolfwillow Haven

Type: Enchantment — Aura

Oracle text:

> Enchant land
> Whenever enchanted land is tapped for mana, its controller adds an additional {G}.
> {4}{G}, Sacrifice this Aura: Create a 2/2 green Wolf creature token. Activate only during your turn.

Re-rendered plain English:

```
Wolfwillow Haven [draft]
  [a1] spell_effect [needed: needs keyword:enchant]
    Oracle: Enchant land
    Target t1: target land  <- prompt: "Choose target land."
    Keyword: enchant
  [a2] triggered [needed: needs trigger:tap, trigger:subject, step:add_mana, field:add_mana.produces, field:add_mana.who]
    Oracle: Whenever enchanted land is tapped for mana, its controller adds an additional {G}.
    Trigger: Whenever the enchanted creature becomes tapped
    Effect: Add {G}.
  [a3] activated [needed: needs timing, predicate:turn_is, cost:sacrifice]
    Oracle: {4}{G}, Sacrifice this Aura: Create a 2/2 green Wolf creature token. Activate only during your turn.
    Cost: {4}{G}, sacrifice Wolfwillow Haven
    Timing: it is your turn
    Effect: Create a 2/2 green Wolf creature token.
```

Player prompts:

- Wolfwillow Haven: choose a target: Choose target land.

Implementation: needed (keyword:enchant, trigger:tap, trigger:subject, step:add_mana, field:add_mana.produces, field:add_mana.who, timing, predicate:turn_is, cost:sacrifice)

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
| `trigger:subject` | 20 | Arasta of the Endless Web; Bastion of Remembrance; Beastmaster Ascension; Gourmand's Talent; Honored Dreyleader; Moldervine Reclamation; Moonstone Eulogist; Morbid Opportunist; Nadier's Nightblade; Ogre Slumlord; Poison-Tip Archer; Prosperous Innkeeper; Ravenous Squirrel; Skullclamp; Sword of the Squeak; The Odd Acorn Gang; Tireless Provisioner; Toski, Bearer of Secrets; Wolfwillow Haven; Zulaport Cutthroat |
| `cost:sacrifice` | 14 | Chatterfang, Squirrel General; Chittering Witch; Deadly Dispute; Evolving Wilds; Gilded Goose; Grim Backwoods; Haywire Mite; Idol of Oblivion; Insatiable Frugivore; Plumb the Forbidden; Ravenous Squirrel; Terramorphic Expanse; Woe Strider; Wolfwillow Haven |
| `static` | 13 | Beastmaster Ascension; Chitterspitter; Deep Forest Hermit; Gourmand's Talent; Hazel's Brewmaster; Maskwood Nexus; Ogre Slumlord; Skullclamp; Squirrel Nest; Squirrel Sovereign; Sword of the Squeak; The Odd Acorn Gang; Toski, Bearer of Secrets |
| `field:life_change.amount` | 12 | Bastion of Remembrance; Haywire Mite; Jungle Hollow; Moldervine Reclamation; Moonstone Eulogist; Nadier's Nightblade; Plumb the Forbidden; Poison-Tip Archer; Prosperous Innkeeper; Ravenous Squirrel; Skyfisher Spider; Zulaport Cutthroat |
| `replacement:would_enter` | 12 | Barren Moor; Bojuka Bog; Golgari Rot Farm; Haunted Mire; Jungle Hollow; Necroblossom Snarl; Oran-Rief, the Vastwood; Path of Ancestry; Temple of Malady; Tranquil Thicket; Woe Strider; Woodland Cemetery |
| `field:add_counters.on` | 9 | Beastmaster Ascension; Chitterspitter; Gourmand's Talent; Honored Dreyleader; Moonstone Eulogist; Oran-Rief, the Vastwood; Ravenous Squirrel; Rootcast Apprenticeship; Scurry of Squirrels |
| `step:add_counters` | 9 | Beastmaster Ascension; Chitterspitter; Gourmand's Talent; Honored Dreyleader; Moonstone Eulogist; Oran-Rief, the Vastwood; Ravenous Squirrel; Rootcast Apprenticeship; Scurry of Squirrels |
| `step:copy` | 7 | Hazel of the Rootbloom; Chatterstorm; Plumb the Forbidden; Rootcast Apprenticeship; Saw in Half; Scurry of Squirrels; Second Harvest |
| `field:copy.count` | 6 | Hazel of the Rootbloom; Chatterstorm; Plumb the Forbidden; Rootcast Apprenticeship; Saw in Half; Second Harvest |
| `mana:variable` | 6 | Hazel of the Rootbloom; Arcane Signet; Command Tower; Exotic Orchard; Gilded Goose; Path of Ancestry |
| `predicate:step_done` | 6 | Cache Grab; Chitterspitter; Insatiable Frugivore; Necroblossom Snarl; Plaguecrafter; Skyfisher Spider |
| `timing` | 6 | Beledros Witherbloom; Garruk, Cursed Huntsman; Idol of Oblivion; Morbid Opportunist; Tainted Wood; Wolfwillow Haven |
| `field:copy.token` | 5 | Hazel of the Rootbloom; Rootcast Apprenticeship; Saw in Half; Scurry of Squirrels; Second Harvest |
| `field:life_change.lose` | 5 | Bastion of Remembrance; Nadier's Nightblade; Plumb the Forbidden; Poison-Tip Archer; Zulaport Cutthroat |
| `field:life_change.who` | 4 | Bastion of Remembrance; Nadier's Nightblade; Poison-Tip Archer; Zulaport Cutthroat |
| `field:sacrifice_permanent.filter` | 4 | Chitterspitter; Plaguecrafter; Rootcast Apprenticeship; Skyfisher Spider |
| `ref:iterated` | 4 | Garruk, Cursed Huntsman; Gourmand's Talent; Oran-Rief, the Vastwood; Second Harvest |
| `step:choose` | 4 | Cache Grab; Golgari Rot Farm; Insatiable Frugivore; Tireless Provisioner |
| `cost:discard` | 3 | Barren Moor; Decree of Pain; Tranquil Thicket |
| `field:choose.count` | 3 | Cache Grab; Golgari Rot Farm; Insatiable Frugivore |
| `field:choose.from` | 3 | Cache Grab; Golgari Rot Farm; Insatiable Frugivore |
| `field:choose.saveAs` | 3 | Cache Grab; Golgari Rot Farm; Insatiable Frugivore |
| `field:grant_effect.all` | 3 | Binding the Old Gods; End-Raze Forerunners; Insatiable Frugivore |
| `field:grant_effect.filter` | 3 | Binding the Old Gods; End-Raze Forerunners; Insatiable Frugivore |
| `field:grant_effect.modify` | 3 | Binding the Old Gods; End-Raze Forerunners; Insatiable Frugivore |
| `field:move_card_zone.from` | 3 | Cache Grab; Golgari Rot Farm; Skyfisher Spider |
| `field:repeat_for_each.over` | 3 | Gourmand's Talent; Oran-Rief, the Vastwood; Second Harvest |
| `field:repeat_for_each.steps` | 3 | Gourmand's Talent; Oran-Rief, the Vastwood; Second Harvest |
| `field:search_library.count` | 3 | Binding the Old Gods; Evolving Wilds; Terramorphic Expanse |
| `field:search_library.filter` | 3 | Binding the Old Gods; Evolving Wilds; Terramorphic Expanse |
| `field:search_library.shuffle` | 3 | Binding the Old Gods; Evolving Wilds; Terramorphic Expanse |
| `field:search_library.tapped` | 3 | Binding the Old Gods; Evolving Wilds; Terramorphic Expanse |
| `field:search_library.to` | 3 | Binding the Old Gods; Evolving Wilds; Terramorphic Expanse |
| `quantity:count` | 3 | Honored Dreyleader; Shamanic Revelation; Skyfisher Spider |
| `step:grant_effect` | 3 | Binding the Old Gods; End-Raze Forerunners; Insatiable Frugivore |
| `step:repeat_for_each` | 3 | Gourmand's Talent; Oran-Rief, the Vastwood; Second Harvest |
| `step:scry` | 3 | Path of Ancestry; Temple of Malady; Woe Strider |
| `step:search_library` | 3 | Binding the Old Gods; Evolving Wilds; Terramorphic Expanse |
| `zone:hand` | 3 | Barren Moor; Decree of Pain; Tranquil Thicket |
| `zone:stack` | 3 | Chatterstorm; Plumb the Forbidden; Toski, Bearer of Secrets |
| `cast_option:additional` | 2 | Deadly Dispute; Plumb the Forbidden |
| `cost:life` | 2 | Hazel of the Rootbloom; Beledros Witherbloom |
| `field:attach.to` | 2 | Skullclamp; Sword of the Squeak |
| `field:attach.what` | 2 | Skullclamp; Sword of the Squeak |
| `field:create_tokens.tokenAbilities` | 2 | Beledros Witherbloom; Garruk, Cursed Huntsman |
| `field:create_tokens.tokenKeywords` | 2 | Arasta of the Endless Web; Maskwood Nexus |
| `field:damage_target.source` | 2 | Llanowar Wastes; Talisman of Resilience |
| `field:destroy_all.filter` | 2 | Decree of Pain; Maelstrom Pulse |
| `field:if_else.else` | 2 | Hazel of the Rootbloom; Tear Asunder |
| `field:if_else.if` | 2 | Hazel of the Rootbloom; Tear Asunder |
| `field:if_else.then` | 2 | Hazel of the Rootbloom; Tear Asunder |
| `field:mass_pump.filter` | 2 | Decree of Pain; Swarmyard Massacre |
| `field:move_card_zone.what` | 2 | Bojuka Bog; Insatiable Frugivore |
| `field:sacrifice_permanent.who` | 2 | Plaguecrafter; Rootcast Apprenticeship |
| `keyword:enchant` | 2 | Squirrel Nest; Wolfwillow Haven |
| `modes` | 2 | Casualties of War; Rootcast Apprenticeship |
| `modes:multiple` | 2 | Casualties of War; Rootcast Apprenticeship |
| `predicate:matches` | 2 | Hazel of the Rootbloom; Cache Grab |
| `predicate:not` | 2 | Necroblossom Snarl; Plaguecrafter |
| `quantity:event_amount` | 2 | Academy Manufactor; Chatterfang, Squirrel General |
| `quantity:math` | 2 | Chatterfang, Squirrel General; Swarmyard Massacre |
| `quantity:step_result` | 2 | Decree of Pain; Saw in Half |
| `replacement:would_create_token` | 2 | Academy Manufactor; Chatterfang, Squirrel General |
| `step:attach` | 2 | Skullclamp; Sword of the Squeak |
| `step:if_else` | 2 | Hazel of the Rootbloom; Tear Asunder |
| `targets:multi` | 2 | Hazel's Brewmaster; Windgrace's Judgment |
| `trigger:batch` | 2 | Morbid Opportunist; The Odd Acorn Gang |
| `trigger:multi_event` | 2 | Hazel's Brewmaster; Zulaport Cutthroat |
| `trigger:sacrifice` | 2 | Moonstone Eulogist; Ravenous Squirrel |
| `cast_option` | 1 | Deadly Dispute |
| `cast_option:escape` | 1 | Woe Strider |
| `cast_option:kicker` | 1 | Tear Asunder |
| `cast_option:mandatory` | 1 | Deadly Dispute |
| `condition_when:static` | 1 | Gourmand's Talent |
| `cost:exileFrom` | 1 | Woe Strider |
| `cost:loyalty` | 1 | Garruk, Cursed Huntsman |
| `cost:tapOther` | 1 | Hazel of the Rootbloom |
| `field:add_mana.produces` | 1 | Wolfwillow Haven |
| `field:add_mana.who` | 1 | Wolfwillow Haven |
| `field:choose.choice` | 1 | Tireless Provisioner |
| `field:choose.fromMilled` | 1 | Cache Grab |
| `field:choose.options` | 1 | Tireless Provisioner |
| `field:choose.remember` | 1 | Tireless Provisioner |
| `field:copy.attacking` | 1 | Scurry of Squirrels |
| `field:copy.exileAt` | 1 | Scurry of Squirrels |
| `field:copy.forEach` | 1 | Scurry of Squirrels |
| `field:copy.reflexive` | 1 | Plumb the Forbidden |
| `field:copy.setPower` | 1 | Saw in Half |
| `field:copy.setToughness` | 1 | Saw in Half |
| `field:copy.tapped` | 1 | Scurry of Squirrels |
| `field:copy.who` | 1 | Saw in Half |
| `field:create_emblem.emblem` | 1 | Garruk, Cursed Huntsman |
| `field:create_tokens.tokenTapped` | 1 | Nested Shambler |
| `field:create_tokens.who` | 1 | Rootcast Apprenticeship |
| `field:destroy_all.noRegenerate` | 1 | Decree of Pain |
| `field:destroy_target.noRegenerate` | 1 | Putrefy |
| `field:destroy_target.reflexive` | 1 | Skyfisher Spider |
| `field:discard.who` | 1 | Plaguecrafter |
| `field:exile_target.linkExile` | 1 | Hazel's Brewmaster |
| `field:repeat_process.repeatIf` | 1 | Insatiable Frugivore |
| `field:repeat_process.steps` | 1 | Insatiable Frugivore |
| `field:reveal.filter` | 1 | Necroblossom Snarl |
| `field:untap_target.all` | 1 | Beledros Witherbloom |
| `field:untap_target.filter` | 1 | Beledros Witherbloom |
| `filter:enteredThisTurn` | 1 | Oran-Rief, the Vastwood |
| `filter:notSubtypes` | 1 | Swarmyard Massacre |
| `filter:sameNameAs` | 1 | Maelstrom Pulse |
| `keyword:landwalk` | 1 | Chatterfang, Squirrel General |
| `modes:repeatable` | 1 | Rootcast Apprenticeship |
| `predicate:all` | 1 | Cache Grab |
| `predicate:chosen_is` | 1 | Tireless Provisioner |
| `predicate:compare` | 1 | Saw in Half |
| `predicate:kicked` | 1 | Tear Asunder |
| `predicate:paid_additional_cost` | 1 | Plumb the Forbidden |
| `predicate:stat` | 1 | Gourmand's Talent |
| `predicate:turn_is` | 1 | Wolfwillow Haven |
| `quantity:division` | 1 | Saw in Half |
| `quantity:opponents_count` | 1 | Chittering Witch |
| `quantity:stat` | 1 | Nested Shambler |
| `quantity:X` | 1 | Chatterfang, Squirrel General |
| `scripted:colors_lands_opponents_control_could_produce` | 1 | Exotic Orchard |
| `scripted:mana_rider_text` | 1 | Path of Ancestry |
| `scripted:mana_spent_on_creature_sharing_type_with_commander` | 1 | Path of Ancestry |
| `scripted:myriad` | 1 | Scurry of Squirrels |
| `scripted:storm` | 1 | Chatterstorm |
| `static:addTypes` | 1 | Gourmand's Talent |
| `static:mustAttack` | 1 | Toski, Bearer of Secrets |
| `step:add_mana` | 1 | Wolfwillow Haven |
| `step:create_emblem` | 1 | Garruk, Cursed Huntsman |
| `step:regenerate` | 1 | Swarmyard |
| `step:repeat_process` | 1 | Insatiable Frugivore |
| `step:reveal` | 1 | Necroblossom Snarl |
| `targets:per_opponent` | 1 | Windgrace's Judgment |
| `trigger:chapters` | 1 | Binding the Old Gods |
| `trigger:counter_put` | 1 | Binding the Old Gods |
| `trigger:cycle` | 1 | Decree of Pain |
| `trigger:gain_life` | 1 | Gourmand's Talent |
| `trigger:intervening_if` | 1 | Plumb the Forbidden |
| `trigger:leaves` | 1 | Nadier's Nightblade |
| `trigger:nth` | 1 | Gourmand's Talent |
| `trigger:tap` | 1 | Wolfwillow Haven |
| `trigger:zones` | 1 | Nadier's Nightblade |

## Decisions

- SCHEMA QUESTION: variable-count mana (Hazel of the Rootbloom "Add X mana in any combination of colors"): ManaSpec.anyColor is a fixed int, so the kind:mana ability says anyColor 1 and the real amount is an add_mana step with amount X. Wanted: anyColor accepting a Quantity.
- SCHEMA QUESTION: "the number of opponents you have" (Chittering Witch) has no Quantity; drafted as players_count(each_opponent, not life<0) as an always-true predicate. Wanted: Quantity ref opponents_count.
- SCHEMA QUESTION: "for each creature destroyed this way" (Decree of Pain) has no Quantity; drafted as event_amount plus step field amountOf:"s1" on draw_cards. Wanted: Quantity ref step_count {step} (also usable for Plumb the Forbidden "for each creature sacrificed this way").
- SCHEMA QUESTION: Plumb the Forbidden: optional additional cost "sacrifice one or more creatures" has no variable-count cost atom; drafted as castOptions additional optional with count X (X is not in the oracle) and a reflexive copy trigger (kind triggered, zone stack, trigger cast self, interveningIf paid_additional_cost). Wanted: cost count range {min,max} and a reflexive cast trigger.
- SCHEMA QUESTION: keywords with built-in rules and no scripted marker in the allowed list: Vanishing (Deep Forest Hermit), Escape (Woe Strider, castOptions escape is fine but "escapes with two +1/+1 counters" is a would_enter modify set {counters} with condition cast_from graveyard), Cycling (keyword + zone hand, as in earlier decks), Class levels (Gourmand's Talent). Vanishing is a bare keyword ability (param 3); the time-counter upkeep/sacrifice loop is a kernel rule like Saga.
- SCHEMA QUESTION: Class (Gourmand's Talent): level-up abilities are kind activated with keyword class_level (param N), sorcery timing and the mana cost, no steps; the level-gated abilities use conditions [{when:static, if: stat(self, class_level) >= N}]. Wanted: first-class Class levels (ability.level / class_level counter).
- SCHEMA QUESTION: repeat-until loop (Insatiable Frugivore "you may exile three cards from your graveyard. If you do, repeat this process"): drafted as if_else on step_done s2 whose then is a repeat_for_each step carrying repeatProcess {from:s1, through:s2}. Wanted: a repeat step (kind repeat_process) with a stop condition.
- SCHEMA QUESTION: no emblem step (Garruk, Cursed Huntsman -6): drafted as grant_effect with emblem:true, all:true, filter creatures you control, no duration. Wanted: kind create_emblem with static modifiers.
- SCHEMA QUESTION: no regenerate step or "can't be regenerated" rider: Swarmyard drafts grant_effect grant "regeneration shield"; Putrefy/Decree of Pain use the step flag noRegenerate:true.
- SCHEMA QUESTION: tokens with their own abilities (Beledros Witherbloom Pests, Garruk Wolves) use the passthrough field tokenAbilities: [ability records]. Wanted: typed tokenAbilities on create_tokens.
- SCHEMA QUESTION: ObjectFilter has no "entered the battlefield this turn" (Oran-Rief): repeat_for_each carries the flag enteredThisTurn:true and a review.ignore for the "duration" lexeme. Similarly no "base power or toughness" (Sword of the Squeak: anyOf power=1 / toughness=1, which is current not base).
- SCHEMA QUESTION: "same name as that permanent" (Maelstrom Pulse): destroy_all with filter another:true plus step field sameNameAs:"t1". ObjectFilter.sameName is a group qualifier, not a reference.
- SCHEMA QUESTION: "for each token" copies with changed stats (Saw in Half "half that creature's power, round up") are copy steps with setPower/setToughness Quantities (div_up) and who controller_of_target; the copy step has no typed fields for this.
- SCHEMA QUESTION: Tear Asunder: the second target (t2, nonland permanent) only exists if kicked; both targets are declared and an if_else on kicked picks which one is used. Wanted: TargetSpec.condition (e.g. only when kicked).
- SCHEMA QUESTION: Wolfwillow Haven "Whenever enchanted land is tapped for mana, its controller adds an additional {G}" is a triggered mana ability: trigger event tap on enchanted (no "for mana" qualifier) with an add_mana step. Wanted: trigger qualifier tapped_for_mana (the marker tapped_for_colorless_mana is only for colorless).
- SCHEMA QUESTION: validator: STRUCT_UNDECLARED_TARGET scans nested grantAbility records, so a granted ability that has its own target (The Odd Acorn Gang) cannot name it t1; its inner target uses id g1 and the step field targetRef g1. Granted-ability records have no schema (loose record).
- SCHEMA QUESTION: Maskwood Nexus applies changeling to creatures on the battlefield and to creature spells / cards outside the battlefield: static affects is an anyOf of six zone-specific filters (battlefield/stack controlled by you, hand/graveyard/library/exile owned by you).
- SCHEMA QUESTION: Hazel's Brewmaster: "Foods you control have all activated abilities of all creature cards exiled with this creature" is a grantAbility record with linkedExile:true (copy abilities); the exile step carries linkExile:true. Wanted: modify copyAbilitiesOf linked_exile.
- SCHEMA QUESTION: Tireless Provisioner "Food token or a Treasure token" is a choose step (choice mode, remember) followed by two create_tokens steps gated by chosen_is. Landfall is written as etb with subject land you control.
- Identical cards copied from other decks (latest copy): Arasta of the Endless Web, Arcane Signet, Barren Moor, Bojuka Bog, Command Tower, Evolving Wilds, Exotic Orchard, Forest, Grim Backwoods, Haywire Mite, Idol of Oblivion, Path of Ancestry, Plaguecrafter, Shamanic Revelation, Skullclamp, Sol Ring, Swamp, Terramorphic Expanse, Tranquil Thicket, Zulaport Cutthroat.
- BEHAVIOUR QUESTION: Cache Grab "returned a Squirrel card to your hand this way" is drafted as step_done on the optional choose plus matches(chosen, Squirrel). Confirm the Food is made when you control a Squirrel even if you take nothing.
- BEHAVIOUR QUESTION: Chatterfang + Academy Manufactor both replace token creation (Academy: instead one of each; Chatterfang: also Squirrels). The kernel needs the 616.1 ordering prompt for the affected player; no card field is involved.
- BEHAVIOUR QUESTION: Woe Strider "escapes with two +1/+1 counters": drafted as would_enter modify with condition cast_from graveyard (cast via escape is the only way a Woe Strider is cast from the graveyard). Confirm.
