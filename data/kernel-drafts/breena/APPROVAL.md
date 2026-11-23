# Kernel draft approval: Breena, the Demagogue

89 unique cards: 32 simple (A), 57 complex (B). Validator: 89/89 pass. Cards with implementation "needed": 82. All drafts are `review.status: "draft"`; nothing was written to the DB.

Reading guide: each card below shows the oracle text and what the structured JSON says back in plain English. Approve if they match.

## (A) Simple cards: spot-check one line each

- **Caves of Koilos** (Land): {T}: add {C} | {T}: add {W} | {T}: add {B} [needs: field:damage_target.source]
- **Command Tower** (Land): {T}: add one mana of any color in your commander's color identity [needs: mana:variable]
- **Commander's Sphere** (Artifact): {T}: add one mana of any color in your commander's color identity | sacrifice Commander's Sphere: Draw a card [needs: mana:variable, cost:sacrifice]
- **Evolving Wilds** (Land): {T}, sacrifice Evolving Wilds: Search your library for a basic land, put it onto the battlefield, then shuffle [needs: cost:sacrifice, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to]
- **Marble Diamond** (Artifact): If Marble Diamond would enter, it enters tapped | {T}: add {W} [needs: replacement:would_enter]
- **Plains** (Basic Land — Plains): {T}: add {W} [implemented]
- **Rogue's Passage** (Land): {T}: add {C} | {4}, {T}: [targets: target creature] Target creature can't be blocked until end of turn [needs: step:grant_effect, field:grant_effect.modify]
- **Secret Rendezvous** (Sorcery): [targets: target player] Draw 3 cards [needs: field:draw_cards.alsoWho]
- **Swamp** (Basic Land — Swamp): {T}: add {B} [implemented]
- **Swords to Plowshares** (Instant): [targets: target creature] Exile target creature, then its controller gains t1's power life [needs: quantity:stat, field:life_change.amount, field:life_change.who]
- **Temple of Silence** (Land): If Temple of Silence would enter, it enters tapped | Whenever Temple of Silence enters: Scry 1 | {T}: add {W} | {T}: add {B} [needs: replacement:would_enter, step:scry]
- **War Room** (Land): {T}: add {C} | {3}, {T}, pay life equal to the number of colors in your commanders' color identity: Draw a card [needs: cost:life]
- **Anguished Unmaking** (Instant): [targets: target nonland permanent] Exile target nonland permanent, then lose 3 life [implemented]
- **Ash Barrens** (Land): {T}: add {C} | {1}, discard Ash Barrens: Search your library for a basic land, put it onto your hand, then shuffle (from hand) [needs: zone:hand, cost:discard, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.reveal, field:search_library.shuffle, field:search_library.to]
- **Despark** (Instant): [targets: target permanent with mana value 4 or greater] Exile target permanent with mana value 4 or greater [implemented]
- **Fetid Heath** (Land): {T}: add {C} | {W/B}, {T}: add {W}{W} and {W}{B} and {B}{B} [implemented]
- **Fracture** (Instant): [targets: target artifact, enchantment, or planeswalker] Destroy target artifact, enchantment, or planeswalker [implemented]
- **Generous Gift** (Instant): [targets: target permanent] Destroy target permanent, then create a 3/3 green Elephant creature token [needs: field:create_tokens.who]
- **Hall of Heliod's Generosity** (Legendary Land): {T}: add {C} | {1}{W}, {T}: [targets: target enchantment card in your graveyard] Put target enchantment card in your graveyard on the top of its owner's library [needs: field:move_card_zone.position]
- **Kambal, Consul of Allocation** (Legendary Creature — Human Advisor): Whenever an opponent casts a noncreature spell: That player loses 2 life, then gain 2 life [needs: field:life_change.who]
- **Lightning Greaves** (Artifact — Equipment): The equipped creature has haste and has shroud | {0}: [targets: target creature you control] Attach Lightning Greaves to target creature you control [needs: static, step:attach, field:attach.to, field:attach.what]
- **Mortify** (Instant): [targets: target creature or enchantment] Destroy target creature or enchantment [implemented]
- **Orzhov Basilica** (Land): If Orzhov Basilica would enter, it enters tapped | Whenever Orzhov Basilica enters: Choose a land you control, then put the chosen object into your hand | {T}: add {W}{B} [needs: replacement:would_enter, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, field:move_card_zone.from]
- **Orzhov Guildgate** (Land — Gate): If Orzhov Guildgate would enter, it enters tapped | {T}: add {W} and {B} [needs: replacement:would_enter]
- **Orzhov Locket** (Artifact): {T}: add {W} and {B} | {W/B}{W/B}{W/B}{W/B}, {T}, sacrifice Orzhov Locket: Draw 2 cards [needs: cost:sacrifice]
- **Path to Exile** (Instant): [targets: target creature] Exile target creature, then you may its controller searches their library for a basic land, put it onto the battlefield, then shuffle [needs: step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to, field:search_library.who]
- **Sigarda's Summons** (Enchantment): Creatures with a +1/+1 counter on it you control have base power and toughness 4/4 and have flying and are angels in addition to their other types [needs: static, static:setBasePT, static:addTypes]
- **Sign in Blood** (Sorcery): [targets: target player] Target player draws 2 cards, then target player loses 2 life [needs: field:draw_cards.who, field:life_change.who]
- **Sword of the Animist** (Legendary Artifact — Equipment): The equipped creature gets +1/+1 | Whenever the equipped creature attacks: You may search your library for a basic land, put it onto the battlefield, then shuffle | {2}: [targets: target creature you control] Attach Sword of the Animist to target creature you control [needs: static, trigger:subject, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to, step:attach, field:attach.to, field:attach.what]
- **Together Forever** (Enchantment): Whenever Together Forever enters: [targets: up to two target creatures] Put a +1/+1 counter on up to two target creatures | {1}: [targets: target creature with a counter on it] Create a delayed trigger [needs: targets:multi, step:add_counters, field:add_counters.on, step:create_delayed_trigger, field:create_delayed_trigger.at, field:create_delayed_trigger.steps]
- **Vow of Malice** (Enchantment — Aura): [targets: target creature] | The enchanted creature gets +2/+2 and has intimidate and can't attack you or planeswalkers you control [needs: keyword:enchant, static, static:cant_protects]
- **Yathan Tombguard** (Creature — Human Warrior): Keyword menace | Whenever a creature with a counter on it you control deals combat damage to a player: Draw a card, then lose 1 life [needs: trigger:subject]

## (B) Complex cards

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

### Breena, the Demagogue

Type: Legendary Creature — Bird Warlock

Oracle text:

> Flying
> Whenever a player attacks one of your opponents, if that opponent has more life than another of your opponents, that attacking player draws a card and you put two +1/+1 counters on a creature you control.

Re-rendered plain English:

```
Breena, the Demagogue [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs quantity:life_total, quantity:players_count, trigger:batch, trigger:intervening_if, predicate:compare, trigger:subject, trigger:defender, field:draw_cards.who, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, step:add_counters, field:add_counters.on]
    Oracle: Whenever a player attacks one of your opponents, if that opponent has more life than another of your opponents, that attacking player draws a card and you put two +1/+1 counters on a creature you control.
    Trigger: Whenever a player attacks a player other than you, if the number of opponents for which that player's life total is less than an opponent's life total is 1 or greater
    Effect: That player draws a card. Then, choose a creature you control. Then, put 2 +1/+1 counters on the chosen object.
```

Player prompts:

- Breena, the Demagogue: choose: Choose a creature you control.

Implementation: needed (quantity:life_total, quantity:players_count, trigger:batch, trigger:intervening_if, predicate:compare, trigger:subject, trigger:defender, field:draw_cards.who, step:choose, field:choose.count, field:choose.from, field:choose.saveAs, step:add_counters, field:add_counters.on)

Questions for you:

- Trigger 'that opponent has more life than another of your opponents': no way to name the attacked opponent inside a Quantity. Written as players_count(each_opponent where life < life_total{who:'opponent'}) >= 1 with who:'opponent' meaning the attacked opponent. Needs an explicit 'defending/attacked player' PlayerRef.
- 'that attacking player draws a card' uses who:'that_player' (the event's player = the attacker). The attacked opponent is a second player in the same event; the schema has one 'that_player'.

### Batwing Brume

Type: Instant

Oracle text:

> Prevent all combat damage that would be dealt this turn if {W} was spent to cast this spell. Each player loses 1 life for each attacking creature they control if {B} was spent to cast this spell. (Do both if {W}{B} was spent.)

Re-rendered plain English:

```
Batwing Brume [draft]
  [a1] spell_effect [needed: needs predicate:mana_spent, step:grant_effect, field:grant_effect.replacement, field:grant_effect.who, step:repeat_for_each, field:repeat_for_each.steps, field:repeat_for_each.who, quantity:math, field:life_change.amount, field:life_change.who]
    Oracle: Prevent all combat damage that would be dealt this turn if {W} was spent to cast this spell. Each player loses 1 life for each attacking creature they control if {B} was spent to cast this spell. (Do both if {W}{B} was spent.)
    Effect: IF at least one {W} mana was spent to cast this spell: the target gains an effect until end of turn. Then, IF at least one {B} mana was spent to cast this spell: repeat for each matching object.
```

Player prompts:

- (none: no decisions)

Implementation: needed (predicate:mana_spent, step:grant_effect, field:grant_effect.replacement, field:grant_effect.who, step:repeat_for_each, field:repeat_for_each.steps, field:repeat_for_each.who, quantity:math, field:life_change.amount, field:life_change.who)

Questions for you:

- Batwing Brume checks which colors of mana were spent on the spell. There is no 'mana of color X was spent to cast this' predicate; written as paid_additional_cost with option 'mana_spent:{W}' / 'mana_spent:B'. Needs a real predicate (and engine tracking of mana spent).
- 'each attacking creature they control' inside a per-player loop: ObjectFilter.controller has no 'the iterated player' value, so the count filter is not tied to the player; needs controller:'that_player'.

### Bloodthirsty Blade

Type: Artifact — Equipment

Oracle text:

> Equipped creature gets +2/+0 and is goaded. (It attacks each combat if able and attacks a player other than you if able.)
> {1}: Attach this Equipment to target creature an opponent controls. Activate only as a sorcery.

Re-rendered plain English:

```
Bloodthirsty Blade [draft]
  [a1] static [needed: needs static]
    Oracle: Equipped creature gets +2/+0 and is goaded. (It attacks each combat if able and attacks a player other than you if able.)
    Static: The equipped creature gets +2/+0 and has goaded
  [a2] activated [needed: needs step:attach, field:attach.to, field:attach.what]
    Oracle: {1}: Attach this Equipment to target creature an opponent controls. Activate only as a sorcery.
    Cost: {1}
    Timing: sorcery
    Target t1: target creature an opponent controls  <- prompt: "Choose target creature an opponent controls."
    Effect: Attach Bloodthirsty Blade to target creature an opponent controls.
```

Player prompts:

- Bloodthirsty Blade: choose a target: Choose target creature an opponent controls.

Implementation: needed (static, step:attach, field:attach.to, field:attach.what)

### Citadel Siege

Type: Enchantment

Oracle text:

> As this enchantment enters, choose Khans or Dragons.
> • Khans — At the beginning of combat on your turn, put two +1/+1 counters on target creature you control.
> • Dragons — At the beginning of combat on each opponent's turn, tap target creature that player controls.

Re-rendered plain English:

```
Citadel Siege [draft]
  [a1] replacement [needed: needs replacement:would_enter, step:choose, field:choose.choice, field:choose.options, field:choose.remember]
    Oracle: As this enchantment enters, choose Khans or Dragons.
    Replacement: If Citadel Siege would enter, also: choose one of Khans or Dragons
  [a2] triggered [needed: needs trigger:intervening_if, predicate:chosen_is, step:add_counters, field:add_counters.on]
    Oracle: • Khans — At the beginning of combat on your turn, put two +1/+1 counters on target creature you control.
    Trigger: At the beginning of combat on your turn, if the chosen mode is Khans
    Target t1: target creature you control  <- prompt: "Choose target creature you control."
    Effect: Put 2 +1/+1 counters on target creature you control.
  [a3] triggered [needed: needs trigger:intervening_if, predicate:chosen_is]
    Oracle: • Dragons — At the beginning of combat on each opponent's turn, tap target creature that player controls.
    Trigger: At the beginning of combat on each opponent's turn, if the chosen mode is Dragons
    Target t1: target creature the active player controls  <- prompt: "Choose target creature an opponent controls."
    Effect: Tap target creature the active player controls.
```

Player prompts:

- Citadel Siege: choose: Choose one of Khans or Dragons.
- Citadel Siege: choose a target: Choose target creature you control.
- Citadel Siege: choose a target: Choose target creature an opponent controls.

Implementation: needed (replacement:would_enter, step:choose, field:choose.choice, field:choose.options, field:choose.remember, trigger:intervening_if, predicate:chosen_is, step:add_counters, field:add_counters.on)

Questions for you:

- Citadel Siege (Dragons): the target must be a creature controlled by the opponent whose turn it is ('that player'). ObjectFilter.controller:'opponent' allows any opponent's creature; needs controller:'active_player'.

### Combat Calligrapher

Type: Creature — Bird Cleric

Oracle text:

> Flying
> Inklings can't attack you or planeswalkers you control.
> Whenever a player attacks one of your opponents, that attacking player creates a tapped 2/1 white and black Inkling creature token with flying that's attacking that opponent.

Re-rendered plain English:

```
Combat Calligrapher [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] static [needed: needs static, static:cant_protects]
    Oracle: Inklings can't attack you or planeswalkers you control.
    Static: Inklings can't attack you or planeswalkers you control
  [a3] triggered [needed: needs trigger:batch, trigger:subject, trigger:defender, field:create_tokens.tokenAttacking, field:create_tokens.tokenKeywords, field:create_tokens.tokenTapped, field:create_tokens.who]
    Oracle: Whenever a player attacks one of your opponents, that attacking player creates a tapped 2/1 white and black Inkling creature token with flying that's attacking that opponent.
    Trigger: Whenever a player attacks a player other than you
    Effect: Create a 2/1 white and black Inkling creature token with flying tapped and attacking that opponent.
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, static:cant_protects, trigger:batch, trigger:subject, trigger:defender, field:create_tokens.tokenAttacking, field:create_tokens.tokenKeywords, field:create_tokens.tokenTapped, field:create_tokens.who)

Questions for you:

- Static 'can't attack you or planeswalkers you control': StaticSpec cant:'attack' has no 'protects/only-against' field (only attackTax has protects), so it reads as 'Inklings can't attack at all'. Needs cant:{attack, protects:'you_and_planeswalkers'}.
- Token 'tapped and attacking that opponent': create_tokens has no tapped/attacking fields; written as passthrough tokenTapped / tokenAttacking:'attacked_opponent'. Needs typed fields.

### Council's Judgment

Type: Sorcery

Oracle text:

> Will of the council — Starting with you, each player votes for a nonland permanent you don't control. Exile each permanent with the most votes or tied for most votes.

Re-rendered plain English:

```
Council's Judgment [draft]
  [a1] spell_effect [needed: needs step:vote, field:vote.candidates, field:vote.tie, field:vote.voters]
    Oracle: Will of the council — Starting with you, each player votes for a nonland permanent you don't control. Exile each permanent with the most votes or tied for most votes.
    Effect: Each player votes for a nonland permanent an opponent controls (starting with you); every one tied for the most votes wins. Then, exile vote_winners.
```

Player prompts:

- Council's Judgment: vote: Vote for a nonland permanent an opponent controls. Players vote in turn order starting with the caster; every choice tied for the most votes wins.

Implementation: needed (step:vote, field:vote.candidates, field:vote.tie, field:vote.voters)

Questions for you:

- Voting (Will of the council): no vote step. Written as choose{who:each_player, vote:true} then exile_target{winners:'most_votes_or_tied'} (passthrough). Needs a vote step: each player (in turn order starting with the caster) picks one candidate, ties resolve by exiling all tied objects. Also 'permanent you don't control' (relative to the caster, not the voter) is approximated by controller:'opponent'.

### Deathbringer Liege

Type: Creature — Horror

Oracle text:

> Other white creatures you control get +1/+1.
> Other black creatures you control get +1/+1.
> Whenever you cast a white spell, you may tap target creature.
> Whenever you cast a black spell, you may destroy target creature if it's tapped.

Re-rendered plain English:

```
Deathbringer Liege [draft]
  [a1] static [needed: needs static]
    Oracle: Other white creatures you control get +1/+1.
    Static: Other white creatures you control get +1/+1
  [a2] static [needed: needs static]
    Oracle: Other black creatures you control get +1/+1.
    Static: Other black creatures you control get +1/+1
  [a3] triggered [implemented]
    Oracle: Whenever you cast a white spell, you may tap target creature.
    Trigger: Whenever you cast a white spell
    Target t1: target creature  <- prompt: "Choose target creature."
    Effect: You may tap target creature.
  [a4] triggered [needed: needs predicate:matches]
    Oracle: Whenever you cast a black spell, you may destroy target creature if it's tapped.
    Trigger: Whenever you cast a black spell
    Target t1: target creature  <- prompt: "Choose target creature."
    Effect: IF t1 is a tapped permanent: you may destroy target creature.
```

Player prompts:

- Deathbringer Liege: choose a target: Choose target creature.
- Deathbringer Liege: optional: Do you want to tap target creature?
- Deathbringer Liege: optional: Do you want to destroy target creature?

Implementation: needed (static, predicate:matches)

### Duelist's Heritage

Type: Enchantment

Oracle text:

> Whenever one or more creatures attack, you may have target attacking creature gain double strike until end of turn.

Re-rendered plain English:

```
Duelist's Heritage [draft]
  [a1] triggered [needed: needs trigger:batch, trigger:subject, step:grant_effect, field:grant_effect.modify]
    Oracle: Whenever one or more creatures attack, you may have target attacking creature gain double strike until end of turn.
    Trigger: Whenever one or more creatures attack
    Target t1: target attacking creature  <- prompt: "Choose target attacking creature."
    Effect: You may target attacking creature gains double strike until end of turn.
```

Player prompts:

- Duelist's Heritage: choose a target: Choose target attacking creature.
- Duelist's Heritage: optional: Do you want to target attacking creature gains double strike until end of turn?

Implementation: needed (trigger:batch, trigger:subject, step:grant_effect, field:grant_effect.modify)

### Dusk Legion Duelist

Type: Creature — Vampire Soldier

Oracle text:

> Vigilance
> Whenever one or more +1/+1 counters are put on this creature, draw a card. This ability triggers only once each turn.

Re-rendered plain English:

```
Dusk Legion Duelist [draft]
  [a1] keyword [implemented]
    Oracle: Vigilance
    Keyword: vigilance
  [a2] triggered [needed: needs timing, trigger:counter_put, trigger:batch]
    Oracle: Whenever one or more +1/+1 counters are put on this creature, draw a card. This ability triggers only once each turn.
    Trigger: Whenever a counter is put on Dusk Legion Duelist
    Timing: 1 per turn
    Effect: Draw a card.
```

Player prompts:

- (none: no decisions)

Implementation: needed (timing, trigger:counter_put, trigger:batch)

### Eiganjo, Seat of the Empire

Type: Legendary Land

Oracle text:

> {T}: Add {W}.
> Channel — {2}{W}, Discard this card: It deals 4 damage to target attacking or blocking creature. This ability costs {1} less to activate for each legendary creature you control.

Re-rendered plain English:

```
Eiganjo, Seat of the Empire [draft]
  [a1] mana [implemented]
    Oracle: {T}: Add {W}.
    Cost: {T}
    Mana: add {W}
  [a2] activated (from hand) [needed: needs zone:hand, cost_reduction, filter:blocking, cost:discard, field:damage_target.source]
    Oracle: Channel — {2}{W}, Discard this card: It deals 4 damage to target attacking or blocking creature. This ability costs {1} less to activate for each legendary creature you control.
    Cost: {2}{W}, discard Eiganjo, Seat of the Empire
    Target t1: target attacking creature or blocking creature  <- prompt: "Choose target attacking creature or creature with blocking."
    Effect: Eiganjo, Seat of the Empire deals 4 damage to target attacking creature or blocking creature.
    Cost reduction: this ability costs {1} less for each legendary creature you control
    Keyword: channel
```

Player prompts:

- Eiganjo, Seat of the Empire: choose a target: Choose target attacking creature or creature with blocking.

Implementation: needed (zone:hand, cost_reduction, filter:blocking, cost:discard, field:damage_target.source)

Questions for you:

- Eiganjo targets 'attacking or blocking creature': ObjectFilter has `attacking` but no `blocking`; written as anyOf with with:['blocking']. Needs a typed `blocking` field.

### Enshrouding Mist

Type: Instant

Oracle text:

> Target creature gets +1/+1 until end of turn. Prevent all damage that would be dealt to it this turn. If it's renowned, untap it.

Re-rendered plain English:

```
Enshrouding Mist [draft]
  [a1] spell_effect [needed: needs step:grant_effect, field:grant_effect.replacement, predicate:matches]
    Oracle: Target creature gets +1/+1 until end of turn. Prevent all damage that would be dealt to it this turn. If it's renowned, untap it.
    Target t1: target creature  <- prompt: "Choose target creature."
    Effect: Target creature gets +1/+1 until end of turn. Then, target creature gains an effect until end of turn. Then, IF t1 is a permanent with renowned: untap target creature.
```

Player prompts:

- Enshrouding Mist: choose a target: Choose target creature.

Implementation: needed (step:grant_effect, field:grant_effect.replacement, predicate:matches)

Questions for you:

- Enshrouding Mist: damage prevention aimed at a specific targeted object (it). ReplacementSpec.recipient accepts a filter/player/'self' but not an ObjRef like t1; written as a grant_effect on t1 with recipient:'self'. 'renowned' is a designation: written as filter.with:['renowned'].

### Envoy of the Ancestors

Type: Creature — Human Cleric

Oracle text:

> Outlast {W} ({W}, {T}: Put a +1/+1 counter on this creature. Outlast only as a sorcery.)
> Modified creatures you control have lifelink. (Equipment, Auras you control, and counters are modifications.)

Re-rendered plain English:

```
Envoy of the Ancestors [draft]
  [a1] activated [needed: needs step:add_counters, field:add_counters.on]
    Oracle: Outlast {W} ({W}, {T}: Put a +1/+1 counter on this creature. Outlast only as a sorcery.)
    Cost: {W}, {T}
    Timing: sorcery
    Effect: Put a +1/+1 counter on Envoy of the Ancestors.
    Keyword: outlast {W}
  [a2] static [needed: needs static]
    Oracle: Modified creatures you control have lifelink. (Equipment, Auras you control, and counters are modifications.)
    Static: Creatures with modified you control have lifelink
```

Player prompts:

- (none: no decisions)

Implementation: needed (step:add_counters, field:add_counters.on, static)

Questions for you:

- 'Modified' (equipped, enchanted by your Aura, or has a counter) is written as filter.with:['modified']; there is no typed `modified` filter field.

### Felisa, Fang of Silverquill

Type: Legendary Creature — Vampire Wizard

Oracle text:

> Flying
> Mentor (Whenever this creature attacks, put a +1/+1 counter on target attacking creature with lesser power.)
> Whenever a nontoken creature you control dies, if it had counters on it, create X tapped 2/1 white and black Inkling creature tokens with flying, where X is the number of counters it had on it.

Re-rendered plain English:

```
Felisa, Fang of Silverquill [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] triggered [needed: needs step:add_counters, field:add_counters.on]
    Oracle: Mentor (Whenever this creature attacks, put a +1/+1 counter on target attacking creature with lesser power.)
    Trigger: Whenever Felisa, Fang of Silverquill attacks
    Target t1: target attacking creature with power less than Felisa, Fang of Silverquill's power  <- prompt: "Choose target attacking creature with power less than Felisa, Fang of Silverquill's power."
    Effect: Put a +1/+1 counter on target attacking creature with power less than Felisa, Fang of Silverquill's power.
    Keyword: mentor
  [a3] triggered [needed: needs trigger:intervening_if, predicate:matches, trigger:subject, quantity:counters, field:create_tokens.tokenKeywords, field:create_tokens.tokenTapped]
    Oracle: Whenever a nontoken creature you control dies, if it had counters on it, create X tapped 2/1 white and black Inkling creature tokens with flying, where X is the number of counters it had on it.
    Trigger: Whenever a nontoken creature you control dies, if that object is a permanent with a counter on it
    Effect: Create the number of any counters on event_object 2/1 white and black Inkling creature tokens with flying tapped.
```

Player prompts:

- Felisa, Fang of Silverquill: choose a target: Choose target attacking creature with power less than Felisa, Fang of Silverquill's power.

Implementation: needed (step:add_counters, field:add_counters.on, trigger:intervening_if, predicate:matches, trigger:subject, quantity:counters, field:create_tokens.tokenKeywords, field:create_tokens.tokenTapped)

Questions for you:

- Felisa/Ozolith/Reluctant Role Model/Resourceful Defense: 'had counters on it' of an object that already left the battlefield (last-known information). Written as filter.hasCounter:'any' and Quantity counters{kind:'any', on:'event_object'}; needs an agreed 'any counter kind' and LKI semantics.
- Tapped token: create_tokens has no `tapped` field; written as passthrough tokenTapped.

### Flawless Maneuver

Type: Instant

Oracle text:

> If you control a commander, you may cast this spell without paying its mana cost.
> Creatures you control gain indestructible until end of turn.

Re-rendered plain English:

```
Flawless Maneuver [draft]
  Cast option c1: you may use alternative (from hand, cost , replaces mana cost) [needed]
  [a1] cast_option [needed: needs cast_option]
    Oracle: If you control a commander, you may cast this spell without paying its mana cost.
  [a2] spell_effect [needed: needs step:grant_effect, field:grant_effect.filter, field:grant_effect.modify]
    Oracle: Creatures you control gain indestructible until end of turn.
    Effect: The target gains indestructible until end of turn.
```

Player prompts:

- Flawless Maneuver: alternative option: Do you want to cast it using its alternative cost?

Implementation: needed (cast_option, step:grant_effect, field:grant_effect.filter, field:grant_effect.modify, cast_option:alternative, cast_option:conditional)

### Ghostly Prison

Type: Enchantment

Oracle text:

> Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.

Re-rendered plain English:

```
Ghostly Prison [draft]
  [a1] static [needed: needs static, static:attackTax]
    Oracle: Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.
    Static: Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, static:attackTax)

### Gix, Yawgmoth Praetor

Type: Legendary Creature — Phyrexian Praetor

Oracle text:

> Whenever a creature deals combat damage to one of your opponents, its controller may pay 1 life. If they do, they draw a card.
> {4}{B}{B}{B}, Discard X cards: Exile the top X cards of target opponent's library. You may play lands and cast spells from among cards exiled this way without paying their mana costs.

Re-rendered plain English:

```
Gix, Yawgmoth Praetor [draft]
  [a1] triggered [needed: needs trigger:subject, field:life_change.who, field:draw_cards.who, predicate:step_done]
    Oracle: Whenever a creature deals combat damage to one of your opponents, its controller may pay 1 life. If they do, they draw a card.
    Trigger: Whenever a creature deals combat damage to a player
    Effect: You may that player loses 1 life. Then, IF you did (s1): that player draws a card.
  [a2] activated [needed: needs cost:discard, field:move_card_zone.position, field:move_card_zone.saveAs, field:move_card_zone.who, step:permission_to_play, field:permission_to_play.allow, field:permission_to_play.what, field:permission_to_play.withoutPayingManaCost]
    Oracle: {4}{B}{B}{B}, Discard X cards: Exile the top X cards of target opponent's library. You may play lands and cast spells from among cards exiled this way without paying their mana costs.
    Cost: {4}{B}{B}{B}, discard X cards in your hand
    Target t1: target player  <- prompt: "Choose target player."
    Effect: Exile a card. Then, you may you may play exiled.
    X prompt: "Choose a value for X (the amount used in the cost)."
```

Player prompts:

- Gix, Yawgmoth Praetor: optional: Do you want to that player loses 1 life?
- Gix, Yawgmoth Praetor: choose a target: Choose target player.
- Gix, Yawgmoth Praetor: choose X: Choose a value for X (the amount used in the cost).
- Gix, Yawgmoth Praetor: choose what to discard: Choose X cards in your hand to discard.
- Gix, Yawgmoth Praetor: optional: Do you want to you may play exiled?

Implementation: needed (trigger:subject, field:life_change.who, field:draw_cards.who, predicate:step_done, cost:discard, field:move_card_zone.position, field:move_card_zone.saveAs, field:move_card_zone.who, step:permission_to_play, field:permission_to_play.allow, field:permission_to_play.what, field:permission_to_play.withoutPayingManaCost)

Questions for you:

- Gix trigger 'a creature deals combat damage to one of your opponents': deals_combat_damage_to_player has no qualifier for the damaged player being your opponent (any creature, any victim). 'Its controller' is written as who:'that_player'.

### Godless Shrine

Type: Land — Plains Swamp

Oracle text:

> ({T}: Add {W} or {B}.)
> As this land enters, you may pay 2 life. If you don't, it enters tapped.

Re-rendered plain English:

```
Godless Shrine [draft]
  [a1] replacement [needed: needs replacement:would_enter, predicate:not, predicate:step_done]
    Oracle: As this land enters, you may pay 2 life. If you don't, it enters tapped.
    Replacement: If Godless Shrine would enter, also: lose 2 life, then tap Godless Shrine
  [a2] mana [implemented]
    Oracle: ({T}: Add {W} or {B}.)
    Cost: {T}
    Mana: add {W} and {B}
```

Player prompts:

- Godless Shrine: optional: Do you want to lose 2 life?

Implementation: needed (replacement:would_enter, predicate:not, predicate:step_done)

### Hopeful Initiate

Type: Creature — Human Warlock

Oracle text:

> Training (Whenever this creature attacks with another creature with greater power, put a +1/+1 counter on this creature.)
> {2}{W}, Remove two +1/+1 counters from among creatures you control: Destroy target artifact or enchantment.

Re-rendered plain English:

```
Hopeful Initiate [draft]
  [a1] triggered [needed: needs trigger:intervening_if, step:add_counters, field:add_counters.on]
    Oracle: Training (Whenever this creature attacks with another creature with greater power, put a +1/+1 counter on this creature.)
    Trigger: Whenever Hopeful Initiate attacks, if you control an another attacking creature with power greater than Hopeful Initiate's power
    Effect: Put a +1/+1 counter on Hopeful Initiate.
    Keyword: training
  [a2] activated [needed: needs cost:counters, cost:counters_from_filter]
    Oracle: {2}{W}, Remove two +1/+1 counters from among creatures you control: Destroy target artifact or enchantment.
    Cost: {2}{W}, remove 2 +1/+1 counters from among creatures you control (you choose which)
    Target t1: target artifact or enchantment  <- prompt: "Choose target artifact or enchantment."
    Effect: Destroy target artifact or enchantment.
```

Player prompts:

- Hopeful Initiate: choose a target: Choose target artifact or enchantment.

Implementation: needed (trigger:intervening_if, step:add_counters, field:add_counters.on, cost:counters, cost:counters_from_filter)

Questions for you:

- Hopeful Initiate / Retribution of the Ancients cost 'Remove N +1/+1 counters from among creatures you control': the counters cost atom only supports from:'self'. Written with from:'self' (lossy). Needs from:{filter} (any creatures you control) and the player choosing which.

### Incarnation Technique

Type: Sorcery

Oracle text:

> Demonstrate (When you cast this spell, you may copy it. If you do, choose an opponent to also copy it.)
> Mill five cards, then return a creature card from your graveyard to the battlefield.

Re-rendered plain English:

```
Incarnation Technique [draft]
  [a1] triggered [needed: needs step:copy, step:choose, field:choose.choice, field:choose.saveAs, predicate:step_done, field:copy.who]
    Oracle: Demonstrate (When you cast this spell, you may copy it. If you do, choose an opponent to also copy it.)
    Trigger: Whenever a player casts Incarnation Technique
    Effect: You may copy Incarnation Technique. Then, IF you did (d1): choose a opponent. Then, IF you did (d1): copy Incarnation Technique.
    Keyword: demonstrate
  [a2] spell_effect [needed: needs field:move_card_zone.filter, field:move_card_zone.from, field:move_card_zone.what]
    Oracle: Mill five cards, then return a creature card from your graveyard to the battlefield.
    Effect: Mill 5 cards. Then, put a card onto the battlefield.
```

Player prompts:

- Incarnation Technique: optional: Do you want to copy Incarnation Technique?
- Incarnation Technique: choose: Choose a opponent.

Implementation: needed (step:copy, step:choose, field:choose.choice, field:choose.saveAs, predicate:step_done, field:copy.who, field:move_card_zone.filter, field:move_card_zone.from, field:move_card_zone.what)

Questions for you:

- Demonstrate has no castOption kind. Written as a triggered ability on cast (copy optional, then a second copy for a chosen opponent). The chosen opponent's copy should be controlled by that opponent: copy {who:'chosen'} is passthrough.

### Keen Duelist

Type: Creature — Human Wizard

Oracle text:

> At the beginning of your upkeep, you and target opponent each reveal the top card of your library. You each lose life equal to the mana value of the card revealed by the other player. You each put the card you revealed into your hand.

Re-rendered plain English:

```
Keen Duelist [draft]
  [a1] triggered [needed: needs step:choose, field:choose.alsoWho, field:choose.count, field:choose.from, field:choose.position, field:choose.reveal, field:choose.saveAs, quantity:math, field:life_change.amount, field:life_change.lifeFrom, field:life_change.who, field:move_card_zone.alsoWho, field:move_card_zone.what]
    Oracle: At the beginning of your upkeep, you and target opponent each reveal the top card of your library. You each lose life equal to the mana value of the card revealed by the other player. You each put the card you revealed into your hand.
    Trigger: At the beginning of your upkeep
    Target t1: target player  <- prompt: "Choose target player."
    Effect: Choose a card in a library. Then, gain -1 x the chosen object's mana value life. Then, target player gains -1 x the chosen object's mana value life. Then, put a card into your hand.
```

Player prompts:

- Keen Duelist: choose a target: Choose target player.
- Keen Duelist: choose: Choose a card in a library.

Implementation: needed (step:choose, field:choose.alsoWho, field:choose.count, field:choose.from, field:choose.position, field:choose.reveal, field:choose.saveAs, quantity:math, field:life_change.amount, field:life_change.lifeFrom, field:life_change.who, field:move_card_zone.alsoWho, field:move_card_zone.what)

Questions for you:

- Keen Duelist / Parker Luck: two revealed cards (one per player) must be referred to separately ('the mana value of the card revealed by the other player'). ObjRef has only one 'chosen' slot, so the two life_change steps use of:'chosen' plus a passthrough lifeFrom:'<saveAs name>'. Needs ObjRef by saveAs name (e.g. {saved:'theirs'}).

### Knight of the White Orchid

Type: Creature — Human Knight

Oracle text:

> First strike
> When this creature enters, if an opponent controls more lands than you, you may search your library for a Plains card, put it onto the battlefield, then shuffle.

Re-rendered plain English:

```
Knight of the White Orchid [draft]
  [a1] keyword [implemented]
    Oracle: First strike
    Keyword: first strike
  [a2] triggered [needed: needs trigger:intervening_if, predicate:compare, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to]
    Oracle: When this creature enters, if an opponent controls more lands than you, you may search your library for a Plains card, put it onto the battlefield, then shuffle.
    Trigger: Whenever Knight of the White Orchid enters, if the number of lands an opponent controls is greater than the number of lands you control
    Effect: You may search your library for a Plains, put it onto the battlefield, then shuffle.
```

Player prompts:

- Knight of the White Orchid: optional: Do you want to search your library for a Plains, put it onto the battlefield, then shuffle?

Implementation: needed (trigger:intervening_if, predicate:compare, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.shuffle, field:search_library.tapped, field:search_library.to)

### Land Tax

Type: Enchantment

Oracle text:

> At the beginning of your upkeep, if an opponent controls more lands than you, you may search your library for up to three basic land cards, reveal them, put them into your hand, then shuffle.

Re-rendered plain English:

```
Land Tax [draft]
  [a1] triggered [needed: needs trigger:intervening_if, predicate:compare, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.reveal, field:search_library.shuffle, field:search_library.to, field:search_library.upTo]
    Oracle: At the beginning of your upkeep, if an opponent controls more lands than you, you may search your library for up to three basic land cards, reveal them, put them into your hand, then shuffle.
    Trigger: At the beginning of your upkeep, if the number of lands an opponent controls is greater than the number of lands you control
    Effect: You may search your library for a basic land, put it onto your hand, then shuffle.
```

Player prompts:

- Land Tax: optional: Do you want to search your library for a basic land, put it onto your hand, then shuffle?

Implementation: needed (trigger:intervening_if, predicate:compare, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.reveal, field:search_library.shuffle, field:search_library.to, field:search_library.upTo)

### Loran's Escape

Type: Instant

Oracle text:

> Target artifact or creature gains hexproof and indestructible until end of turn. Scry 1.

Re-rendered plain English:

```
Loran's Escape [draft]
  [a1] spell_effect [needed: needs step:grant_effect, field:grant_effect.modify, step:scry]
    Oracle: Target artifact or creature gains hexproof and indestructible until end of turn. Scry 1.
    Target t1: target artifact or creature  <- prompt: "Choose target artifact or creature."
    Effect: Target artifact or creature gains hexproof and gains indestructible until end of turn. Then, scry 1.
```

Player prompts:

- Loran's Escape: choose a target: Choose target artifact or creature.

Implementation: needed (step:grant_effect, field:grant_effect.modify, step:scry)

### Mana Tithe

Type: Instant

Oracle text:

> Counter target spell unless its controller pays {1}.

Re-rendered plain English:

```
Mana Tithe [draft]
  [a1] spell_effect [needed: needs step:counter_spell, step:unless_pay]
    Oracle: Counter target spell unless its controller pays {1}.
    Target t1: target spell  <- prompt: "Choose target spell."
    Effect: Counter target spell unless controller of target pays {1}.
```

Player prompts:

- Mana Tithe: choose a target: Choose target spell.
- Mana Tithe: pay or not: Do you want to pay {1}? If you don't, counter target spell.

Implementation: needed (step:counter_spell, step:unless_pay)

### Mangara, the Diplomat

Type: Legendary Creature — Human Cleric

Oracle text:

> Lifelink
> Whenever an opponent attacks with creatures, if two or more of those creatures are attacking you and/or planeswalkers you control, draw a card.
> Whenever an opponent casts their second spell each turn, draw a card.

Re-rendered plain English:

```
Mangara, the Diplomat [draft]
  [a1] keyword [implemented]
    Oracle: Lifelink
    Keyword: lifelink
  [a2] triggered [needed: needs filter:attackingYou, trigger:batch, trigger:intervening_if, predicate:compare, trigger:subject]
    Oracle: Whenever an opponent attacks with creatures, if two or more of those creatures are attacking you and/or planeswalkers you control, draw a card.
    Trigger: Whenever an opponent attacks, if the number of attacking creatures attacking you is 2 or greater
    Effect: Draw a card.
  [a3] triggered [needed: needs trigger:nth]
    Oracle: Whenever an opponent casts their second spell each turn, draw a card.
    Trigger: Whenever an opponent casts their second spell each turn
    Effect: Draw a card.
```

Player prompts:

- (none: no decisions)

Implementation: needed (filter:attackingYou, trigger:batch, trigger:intervening_if, predicate:compare, trigger:subject, trigger:nth)

### Martial Impetus

Type: Enchantment — Aura

Oracle text:

> Enchant creature
> Enchanted creature gets +1/+1 and is goaded. (It attacks each combat if able and attacks a player other than you if able.)
> Whenever enchanted creature attacks, each other creature that's attacking one of your opponents gets +1/+1 until end of turn.

Re-rendered plain English:

```
Martial Impetus [draft]
  [a1] spell_effect [needed: needs keyword:enchant]
    Oracle: Enchant creature
    Target t1: target creature  <- prompt: "Choose target creature."
    Keyword: enchant
  [a2] static [needed: needs static]
    Oracle: Enchanted creature gets +1/+1 and is goaded. (It attacks each combat if able and attacks a player other than you if able.)
    Static: The enchanted creature gets +1/+1 and has goaded
  [a3] triggered [needed: needs filter:attackingOpponent, trigger:subject, field:mass_pump.filter]
    Oracle: Whenever enchanted creature attacks, each other creature that's attacking one of your opponents gets +1/+1 until end of turn.
    Trigger: Whenever the enchanted creature attacks
    Effect: All creatures get +1/+1 until end of turn.
```

Player prompts:

- Martial Impetus: choose a target: Choose target creature.

Implementation: needed (keyword:enchant, static, filter:attackingOpponent, trigger:subject, field:mass_pump.filter)

Questions for you:

- Martial Impetus 'each other creature that's attacking one of your opponents' is written as other attacking creatures; the 'attacking one of your opponents' (not you) restriction is not modelled (ObjectFilter has attackingYou but no attackingOpponent).

### Master of Ceremonies

Type: Creature — Rhino Druid

Oracle text:

> At the beginning of your upkeep, each opponent chooses money, friends, or secrets. For each player who chose money, you and that player each create a Treasure token. For each player who chose friends, you and that player each create a 1/1 green and white Citizen creature token. For each player who chose secrets, you and that player each draw a card.

Re-rendered plain English:

```
Master of Ceremonies [draft]
  [a1] triggered [needed: needs step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, step:choose, field:choose.choice, field:choose.options, field:choose.remember, field:choose.saveAs, field:choose.who, field:create_tokens.alsoWho, predicate:chosen_is, field:draw_cards.alsoWho]
    Oracle: At the beginning of your upkeep, each opponent chooses money, friends, or secrets. For each player who chose money, you and that player each create a Treasure token. For each player who chose friends, you and that player each create a 1/1 green and white Citizen creature token. For each player who chose secrets, you and that player each draw a card.
    Trigger: At the beginning of your upkeep
    Effect: For each permanent, choose one of money, friends, or secrets, then create a ?/? colorless Treasure artifact token, then create a 1/1 green and white Citizen creature token, then draw a card.
```

Player prompts:

- Master of Ceremonies: choose: Choose one of money, friends, or secrets.

Implementation: needed (step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, step:choose, field:choose.choice, field:choose.options, field:choose.remember, field:choose.saveAs, field:choose.who, field:create_tokens.alsoWho, predicate:chosen_is, field:draw_cards.alsoWho)

Questions for you:

- Master of Ceremonies: each opponent chooses an option for themselves. choose{who:'that_player', remember:true} stores the answer per iteration; chosen_is reads 'the option remembered by the source', which is a single slot. Needs a per-iteration chosen value.

### Mister Negative

Type: Legendary Creature — Human Villain

Oracle text:

> Vigilance, lifelink
> Darkforce Inversion — When Mister Negative enters, you may exchange life totals with target opponent. If you lost life this way, draw that many cards.

Re-rendered plain English:

```
Mister Negative [draft]
  [a1] keyword [implemented]
    Oracle: Vigilance, lifelink
    Keyword: vigilance
  [a2] keyword [implemented]
    Oracle: Vigilance, lifelink
    Keyword: lifelink
  [a3] triggered [needed: needs step:exchange_life, field:exchange_life.withWho, quantity:life_lost_this_way, predicate:compare]
    Oracle: Darkforce Inversion — When Mister Negative enters, you may exchange life totals with target opponent. If you lost life this way, draw that many cards.
    Trigger: Whenever Mister Negative enters
    Target t1: target player  <- prompt: "Choose target player."
    Effect: You may exchange life totals with target player. Then, IF the life lost this way is greater than 0: draw the life lost this way cards.
```

Player prompts:

- Mister Negative: choose a target: Choose target player.
- Mister Negative: optional: Do you want to exchange life totals with target player?

Implementation: needed (step:exchange_life, field:exchange_life.withWho, quantity:life_lost_this_way, predicate:compare)

Questions for you:

- Mister Negative: no 'exchange life totals' step. Written as set_life {who:'you', target:'t1', exchange:true} (passthrough). Needs a dedicated step.

### Nihil Spellbomb

Type: Artifact

Oracle text:

> {T}, Sacrifice this artifact: Exile target player's graveyard.
> When this artifact is put into a graveyard from the battlefield, you may pay {B}. If you do, draw a card.

Re-rendered plain English:

```
Nihil Spellbomb [draft]
  [a1] activated [needed: needs cost:sacrifice, field:move_card_zone.who]
    Oracle: {T}, Sacrifice this artifact: Exile target player's graveyard.
    Cost: {T}, sacrifice Nihil Spellbomb
    Target t1: target player  <- prompt: "Choose target player."
    Effect: Exile a card.
  [a2] triggered [needed: needs trigger:leaves, trigger:zones, step:if_else, field:if_else.optionalCost, predicate:step_done]
    Oracle: When this artifact is put into a graveyard from the battlefield, you may pay {B}. If you do, draw a card.
    Trigger: Whenever Nihil Spellbomb is put into a graveyard from the battlefield
    Effect: You may if ?: . Then, IF you did (s1): draw a card.
```

Player prompts:

- Nihil Spellbomb: choose a target: Choose target player.
- Nihil Spellbomb: optional payment: Do you want to pay {B}? If you do, draw a card.

Implementation: needed (cost:sacrifice, field:move_card_zone.who, trigger:leaves, trigger:zones, step:if_else, field:if_else.optionalCost, predicate:step_done)

### Nils, Discipline Enforcer

Type: Legendary Creature — Human Cleric

Oracle text:

> At the beginning of your end step, for each player, put a +1/+1 counter on up to one target creature that player controls.
> Each creature with one or more counters on it can't attack you or planeswalkers you control unless its controller pays {X}, where X is the number of counters on that creature.

Re-rendered plain English:

```
Nils, Discipline Enforcer [draft]
  [a1] triggered [needed: needs targets:multi, targets:per_opponent, step:add_counters, field:add_counters.on]
    Oracle: At the beginning of your end step, for each player, put a +1/+1 counter on up to one target creature that player controls.
    Trigger: At the beginning of your end step
    Target t1: up to one target creature you control  <- prompt: "Choose up to one target creature you control."
    Target t2: up to one target creature an opponent controls (one choice for each opponent)  <- prompt: "Choose up to one target creature an opponent controls (one choice for each opponent)."
    Effect: Put a +1/+1 counter on up to one target creature you control. Then, put a +1/+1 counter on up to one target creature an opponent controls (one choice for each opponent).
  [a2] static [needed: needs static, static:attackTax]
    Oracle: Each creature with one or more counters on it can't attack you or planeswalkers you control unless its controller pays {X}, where X is the number of counters on that creature.
    Static: Creatures with a counter on it can't attack you or planeswalkers you control unless their controller pays {X} for each creature they control that's attacking a protected player or planeswalker
```

Player prompts:

- Nils, Discipline Enforcer: choose a target: Choose up to one target creature you control.
- Nils, Discipline Enforcer: choose a target: Choose up to one target creature an opponent controls (one choice for each opponent).

Implementation: needed (targets:multi, targets:per_opponent, step:add_counters, field:add_counters.on, static, static:attackTax)

Questions for you:

- Nils: attackTax.cost is a mana string; 'pays {X}, where X is the number of counters on that creature' has no place for the per-creature Quantity (Sphere of Safety used a scripted attack_tax handler). Left as cost '{X}' with no quantity.

### Orzhov Advokist

Type: Creature — Human Advisor

Oracle text:

> At the beginning of your upkeep, each player may put two +1/+1 counters on a creature they control. If a player does, creatures that player controls can't attack you or planeswalkers you control until your next turn.

Re-rendered plain English:

```
Orzhov Advokist [draft]
  [a1] triggered [needed: needs ref:iterated, step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, step:choose, field:choose.count, field:choose.from, field:choose.ofPlayer, field:choose.saveAs, field:choose.who, step:add_counters, field:add_counters.on, step:grant_effect, field:grant_effect.filter, field:grant_effect.modify, field:grant_effect.ofPlayer, field:grant_effect.who, predicate:step_done, duration:until_your_next_turn]
    Oracle: At the beginning of your upkeep, each player may put two +1/+1 counters on a creature they control. If a player does, creatures that player controls can't attack you or planeswalkers you control until your next turn.
    Trigger: At the beginning of your upkeep
    Effect: For each permanent, choose a creature, then put 2 +1/+1 counters on the chosen object, then the target can't attack you or planeswalkers you control until your next turn.
```

Player prompts:

- Orzhov Advokist: optional: Do you want to choose a creature?

Implementation: needed (ref:iterated, step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, step:choose, field:choose.count, field:choose.from, field:choose.ofPlayer, field:choose.saveAs, field:choose.who, step:add_counters, field:add_counters.on, step:grant_effect, field:grant_effect.filter, field:grant_effect.modify, field:grant_effect.ofPlayer, field:grant_effect.who, predicate:step_done, duration:until_your_next_turn)

Questions for you:

- Orzhov Advokist / Nils / Vow of Malice / Combat Calligrapher / Promise of Loyalty: StaticSpec cant:'attack' cannot be limited to 'attacking you or planeswalkers you control' (only attackTax has protects). ObjectFilter.controller cannot name 'the target player' / 'the iterated player' (only you/opponent/any/defending_player); the step is written with passthrough fields (ofPlayer / owner iterated). Needs controller:'target_player' | 'iterated_player'.

### Parker Luck

Type: Enchantment

Oracle text:

> At the beginning of your end step, two target players each reveal the top card of their library. They each lose life equal to the mana value of the card revealed by the other player. Then they each put the card they revealed into their hand.

Re-rendered plain English:

```
Parker Luck [draft]
  [a1] triggered [needed: needs targets:multi, step:choose, field:choose.count, field:choose.from, field:choose.position, field:choose.reveal, field:choose.saveAs, field:choose.who, quantity:math, field:life_change.amount, field:life_change.lifeFrom, field:life_change.who, field:move_card_zone.what, field:move_card_zone.who]
    Oracle: At the beginning of your end step, two target players each reveal the top card of their library. They each lose life equal to the mana value of the card revealed by the other player. Then they each put the card they revealed into their hand.
    Trigger: At the beginning of your end step
    Target t1: two target players  <- prompt: "Choose two target players."
    Effect: Choose a card in a library. Then, target player gains -1 x the chosen object's mana value life. Then, put a card into your hand.
```

Player prompts:

- Parker Luck: choose targets: Choose two target players.
- Parker Luck: choose: Choose a card in a library.

Implementation: needed (targets:multi, step:choose, field:choose.count, field:choose.from, field:choose.position, field:choose.reveal, field:choose.saveAs, field:choose.who, quantity:math, field:life_change.amount, field:life_change.lifeFrom, field:life_change.who, field:move_card_zone.what, field:move_card_zone.who)

Questions for you:

- Parker Luck: see Keen Duelist (two revealed cards cross-referenced between the two target players).

### Parting Gust

Type: Instant

Oracle text:

> Gift a tapped Fish (You may promise an opponent a gift as you cast this spell. If you do, they create a tapped 1/1 blue Fish creature token before its other effects.)
> Exile target nontoken creature. If the gift wasn't promised, return that card to the battlefield under its owner's control with a +1/+1 counter on it at the beginning of the next end step.

Re-rendered plain English:

```
Parting Gust [draft]
  Cast option c1: you may use gift (from hand, cost ) [needed]
  [a1] spell_effect [needed: needs step:create_delayed_trigger, field:create_delayed_trigger.at, field:create_delayed_trigger.steps, predicate:not, predicate:paid_additional_cost, field:move_card_zone.underControlOf, field:move_card_zone.withCounters]
    Oracle: Exile target nontoken creature. If the gift wasn't promised, return that card to the battlefield under its owner's control with a +1/+1 counter on it at the beginning of the next end step.
    Target t1: target nontoken creature  <- prompt: "Choose target nontoken creature."
    Effect: Exile target nontoken creature. Then, IF it is not true that the additional cost (gift) was paid: create a delayed trigger.
```

Player prompts:

- Parting Gust: choose a target: Choose target nontoken creature.
- Parting Gust: gift: Do you want to promise a tapped Fish to an opponent? If you do, choose that opponent.

Implementation: needed (step:create_delayed_trigger, field:create_delayed_trigger.at, field:create_delayed_trigger.steps, predicate:not, predicate:paid_additional_cost, field:move_card_zone.underControlOf, field:move_card_zone.withCounters, cast_option:gift, field:create_tokens.tokenTapped, field:create_tokens.who)

Questions for you:

- Parting Gust: 'return ... under its owner's control with a +1/+1 counter' written with passthrough fields underControlOf:'owner' and withCounters on move_card_zone.

### Perch Protection

Type: Instant

Oracle text:

> Gift an extra turn (You may promise an opponent a gift as you cast this spell. If you do, they take an extra turn after this one.)
> Create four 2/2 blue Bird creature tokens with flying. If the gift was promised, all permanents you control phase out, and until your next turn, your life total can't change and you gain protection from everything.
> Exile Perch Protection.

Re-rendered plain English:

```
Perch Protection [draft]
  Cast option c1: you may use gift (from hand, cost ) [needed]
  [a1] spell_effect [needed: needs field:create_tokens.tokenKeywords, step:grant_effect, field:grant_effect.filter, field:grant_effect.modify, predicate:paid_additional_cost, field:grant_effect.replacement, duration:until_your_next_turn]
    Oracle: Create four 2/2 blue Bird creature tokens with flying. If the gift was promised, all permanents you control phase out, and until your next turn, your life total can't change and you gain protection from everything.
    Effect: Create four 2/2 blue Bird creature tokens with flying. Then, IF the additional cost (gift) was paid: the target gains phased out. Then, IF the additional cost (gift) was paid: the target gains an effect until your next turn. Then, IF the additional cost (gift) was paid: the target gains an effect until your next turn. Then, IF the additional cost (gift) was paid: the target protection from everything until your next turn.
  [a2] spell_effect [implemented]
    Oracle: Exile Perch Protection.
    Effect: Exile Perch Protection.
```

Player prompts:

- Perch Protection: gift: Do you want to promise a extra turn to an opponent? If you do, choose that opponent.

Implementation: needed (field:create_tokens.tokenKeywords, step:grant_effect, field:grant_effect.filter, field:grant_effect.modify, predicate:paid_additional_cost, field:grant_effect.replacement, duration:until_your_next_turn, cast_option:gift, step:extra_turn, field:extra_turn.who)

Questions for you:

- Perch Protection: no phase-out step (written as grant_effect granting 'phased out' to all your permanents); 'your life total can't change' is two prevent replacements (would_gain_life and would_lose_life). The opponent's extra turn comes 'after this one' (extra_turn who:'opponent').

### Promise of Loyalty

Type: Sorcery

Oracle text:

> Each player puts a vow counter on a creature they control and sacrifices the rest. Each of those creatures can't attack you or planeswalkers you control for as long as it has a vow counter on it.

Re-rendered plain English:

```
Promise of Loyalty [draft]
  [a1] spell_effect [needed: needs ref:iterated, step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, step:choose, field:choose.count, field:choose.from, field:choose.ofPlayer, field:choose.saveAs, field:choose.who, step:add_counters, field:add_counters.on, quantity:math, field:sacrifice_permanent.amount, field:sacrifice_permanent.except, field:sacrifice_permanent.filter, field:sacrifice_permanent.who, step:grant_effect, field:grant_effect.modify, duration:forAsLongAs]
    Oracle: Each player puts a vow counter on a creature they control and sacrifices the rest. Each of those creatures can't attack you or planeswalkers you control for as long as it has a vow counter on it.
    Effect: For each permanent, choose a creature, then put a vow counter on the chosen object, then that player sacrifices a creature, then the chosen object can't attack you or planeswalkers you control for a duration.
```

Player prompts:

- Promise of Loyalty: choose: Choose a creature.
- Promise of Loyalty: sacrifice: Choose a permanent to sacrifice.

Implementation: needed (ref:iterated, step:repeat_for_each, field:repeat_for_each.over, field:repeat_for_each.steps, step:choose, field:choose.count, field:choose.from, field:choose.ofPlayer, field:choose.saveAs, field:choose.who, step:add_counters, field:add_counters.on, quantity:math, field:sacrifice_permanent.amount, field:sacrifice_permanent.except, field:sacrifice_permanent.filter, field:sacrifice_permanent.who, step:grant_effect, field:grant_effect.modify, duration:forAsLongAs)

Questions for you:

- Promise of Loyalty: 'sacrifices the rest' (all creatures except the chosen one) is written with passthrough except:'chosen', amount:'all'. ObjectFilter.controller cannot name 'the target player' / 'the iterated player' (only you/opponent/any/defending_player); the step is written with passthrough fields (ofPlayer / owner iterated). Needs controller:'target_player' | 'iterated_player'.

### Reluctant Role Model

Type: Creature — Human Survivor

Oracle text:

> Survival — At the beginning of your second main phase, if this creature is tapped, put a flying, lifelink, or +1/+1 counter on it.
> Whenever this creature or another creature you control dies, if it had counters on it, put those counters on up to one target creature.

Re-rendered plain English:

```
Reluctant Role Model [draft]
  [a1] triggered [needed: needs trigger:begin_step:postcombat_main, trigger:intervening_if, predicate:source_state, step:choose, field:choose.choice, field:choose.options, field:choose.saveAs, step:add_counters, field:add_counters.on]
    Oracle: Survival — At the beginning of your second main phase, if this creature is tapped, put a flying, lifelink, or +1/+1 counter on it.
    Trigger: At the beginning of your second main phase, if Reluctant Role Model is tapped
    Effect: Choose one of flying, lifelink, or +1/+1. Then, put a from_choice counter on Reluctant Role Model.
    Keyword: survival
  [a2] triggered [needed: needs trigger:intervening_if, predicate:matches, trigger:subject, targets:multi, step:add_counters, quantity:counters, field:add_counters.on]
    Oracle: Whenever this creature or another creature you control dies, if it had counters on it, put those counters on up to one target creature.
    Trigger: Whenever a creature you control dies, if that object is a permanent with a counter on it
    Target t1: up to one target creature  <- prompt: "Choose up to one target creature."
    Effect: Put the number of any counters on event_object same_as_source counters on up to one target creature.
```

Player prompts:

- Reluctant Role Model: choose: Choose one of flying, lifelink, or +1/+1.
- Reluctant Role Model: choose a target: Choose up to one target creature.

Implementation: needed (trigger:begin_step:postcombat_main, trigger:intervening_if, predicate:source_state, step:choose, field:choose.choice, field:choose.options, field:choose.saveAs, step:add_counters, field:add_counters.on, predicate:matches, trigger:subject, targets:multi, quantity:counters)

Questions for you:

- Reluctant Role Model / The Ozolith / Resourceful Defense: 'put those counters on X' (all counters of every kind, by kind) is written as add_counters{counterKind:'same_as_source', amount: counters(any)} (passthrough); needs a real 'move/copy counters from <object> (LKI)' step. The choice of flying/lifelink/+1/+1 counter kind is choose(mode) then counterKind:'chosen'.

### Resourceful Defense

Type: Enchantment

Oracle text:

> Whenever a permanent you control leaves the battlefield, if it had counters on it, put those counters on target permanent you control.
> {4}{W}: Move any number of counters from target permanent you control onto a second target permanent you control.

Re-rendered plain English:

```
Resourceful Defense [draft]
  [a1] triggered [needed: needs trigger:leaves, trigger:intervening_if, predicate:matches, trigger:subject, trigger:zones, step:add_counters, quantity:counters, field:add_counters.on]
    Oracle: Whenever a permanent you control leaves the battlefield, if it had counters on it, put those counters on target permanent you control.
    Trigger: Whenever a permanent you control leaves the battlefield, if that object is a permanent with a counter on it
    Target t1: target permanent you control  <- prompt: "Choose target permanent you control."
    Effect: Put the number of any counters on event_object same_as_source counters on target permanent you control.
  [a2] activated [needed: needs step:remove_counters, quantity:counters, field:remove_counters.on, field:remove_counters.saveAs, field:remove_counters.upTo, step:add_counters, field:add_counters.from, field:add_counters.on]
    Oracle: {4}{W}: Move any number of counters from target permanent you control onto a second target permanent you control.
    Cost: {4}{W}
    Target t1: target permanent you control  <- prompt: "Choose target permanent you control."
    Target t2: target permanent you control  <- prompt: "Choose target permanent you control."
    Effect: Remove the number of any counters on t1 any counters from target permanent you control. Then, put the number of any counters on t1 same_as_source counters on target permanent you control.
```

Player prompts:

- Resourceful Defense: choose a target: Choose target permanent you control.

Implementation: needed (trigger:leaves, trigger:intervening_if, predicate:matches, trigger:subject, trigger:zones, step:add_counters, quantity:counters, field:add_counters.on, step:remove_counters, field:remove_counters.on, field:remove_counters.saveAs, field:remove_counters.upTo, field:add_counters.from)

### Retribution of the Ancients

Type: Enchantment

Oracle text:

> {B}, Remove X +1/+1 counters from among creatures you control: Target creature gets -X/-X until end of turn.

Re-rendered plain English:

```
Retribution of the Ancients [draft]
  [a1] activated [needed: needs cost:counters, cost:counters_from_filter, quantity:math]
    Oracle: {B}, Remove X +1/+1 counters from among creatures you control: Target creature gets -X/-X until end of turn.
    Cost: {B}, remove X +1/+1 counters from among creatures you control (you choose which)
    Target t1: target creature  <- prompt: "Choose target creature."
    Effect: Target creature gets +-1 x X/+-1 x X until end of turn.
    X prompt: "Choose a value for X (the amount used in the cost)."
```

Player prompts:

- Retribution of the Ancients: choose a target: Choose target creature.
- Retribution of the Ancients: choose X: Choose a value for X (the amount used in the cost).

Implementation: needed (cost:counters, cost:counters_from_filter, quantity:math)

### Scheming Symmetry

Type: Sorcery

Oracle text:

> Choose two target players. Each of them searches their library for a card, then shuffles and puts that card on top.

Re-rendered plain English:

```
Scheming Symmetry [draft]
  [a1] spell_effect [needed: needs targets:multi, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.position, field:search_library.shuffle, field:search_library.to, field:search_library.who]
    Oracle: Choose two target players. Each of them searches their library for a card, then shuffles and puts that card on top.
    Target t1: two target players  <- prompt: "Choose two target players."
    Effect: Target player searches their library for a permanent, put it onto the library, then shuffle.
```

Player prompts:

- Scheming Symmetry: choose targets: Choose two target players.
- Scheming Symmetry: search: Choose a permanent from the library.

Implementation: needed (targets:multi, step:search_library, field:search_library.count, field:search_library.filter, field:search_library.position, field:search_library.shuffle, field:search_library.to, field:search_library.who)

### Selfless Spirit

Type: Creature — Spirit Cleric

Oracle text:

> Flying
> Sacrifice this creature: Creatures you control gain indestructible until end of turn.

Re-rendered plain English:

```
Selfless Spirit [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] activated [needed: needs cost:sacrifice, step:grant_effect, field:grant_effect.filter, field:grant_effect.modify]
    Oracle: Sacrifice this creature: Creatures you control gain indestructible until end of turn.
    Cost: sacrifice Selfless Spirit
    Effect: The target gains indestructible until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (cost:sacrifice, step:grant_effect, field:grant_effect.filter, field:grant_effect.modify)

### Selfless Squire

Type: Creature — Human Soldier

Oracle text:

> Flash
> When this creature enters, prevent all damage that would be dealt to you this turn.
> Whenever damage that would be dealt to you is prevented, put that many +1/+1 counters on this creature.

Re-rendered plain English:

```
Selfless Squire [draft]
  [a1] keyword [implemented]
    Oracle: Flash
    Keyword: flash
  [a2] triggered [needed: needs step:grant_effect, field:grant_effect.replacement]
    Oracle: When this creature enters, prevent all damage that would be dealt to you this turn.
    Trigger: Whenever Selfless Squire enters
    Effect: The target gains an effect until end of turn.
  [a3] triggered [needed: needs trigger:damage_prevented, trigger:subject, step:add_counters, quantity:event_amount, field:add_counters.on]
    Oracle: Whenever damage that would be dealt to you is prevented, put that many +1/+1 counters on this creature.
    Trigger: Whenever damage that would be dealt to you is prevented
    Effect: Put that many +1/+1 counters on Selfless Squire.
```

Player prompts:

- (none: no decisions)

Implementation: needed (step:grant_effect, field:grant_effect.replacement, trigger:damage_prevented, trigger:subject, step:add_counters, quantity:event_amount, field:add_counters.on)

Questions for you:

- Selfless Squire: 'whenever damage that would be dealt to you is prevented' has no trigger event (EVENT_NAMES lacks damage_prevented). Written with event:'unspecified' and Quantity event_amount = the amount prevented. Needs event damage_prevented {recipient, amount}.

### Shadowspear

Type: Legendary Artifact — Equipment

Oracle text:

> Equipped creature gets +1/+1 and has trample and lifelink.
> {1}: Permanents your opponents control lose hexproof and indestructible until end of turn.
> Equip {2}

Re-rendered plain English:

```
Shadowspear [draft]
  [a1] static [needed: needs static]
    Oracle: Equipped creature gets +1/+1 and has trample and lifelink.
    Static: The equipped creature gets +1/+1 and has trample and has lifelink
  [a2] activated [needed: needs step:grant_effect, field:grant_effect.filter, field:grant_effect.modify, field:grant_effect.who]
    Oracle: {1}: Permanents your opponents control lose hexproof and indestructible until end of turn.
    Cost: {1}
    Effect: The target loses hexproof and loses indestructible until end of turn.
  [a3] activated [needed: needs step:attach, field:attach.to, field:attach.what]
    Oracle: Equip {2}
    Cost: {2}
    Timing: sorcery
    Target t1: target creature you control  <- prompt: "Choose target creature you control."
    Effect: Attach Shadowspear to target creature you control.
    Keyword: equip {2}
```

Player prompts:

- Shadowspear: choose a target: Choose target creature you control.

Implementation: needed (static, step:grant_effect, field:grant_effect.filter, field:grant_effect.modify, field:grant_effect.who, step:attach, field:attach.to, field:attach.what)

### Shadrix Silverquill

Type: Legendary Creature — Elder Dragon

Oracle text:

> Flying, double strike
> At the beginning of combat on your turn, you may choose two. Each mode must target a different player.
> • Target player creates a 2/1 white and black Inkling creature token with flying.
> • Target player draws a card and loses 1 life.
> • Target player puts a +1/+1 counter on each creature they control.

Re-rendered plain English:

```
Shadrix Silverquill [draft]
  [a1] keyword [implemented]
    Oracle: Flying, double strike
    Keyword: flying
  [a2] keyword [implemented]
    Oracle: Flying, double strike
    Keyword: double strike
  [a3] triggered [needed: needs modes, ref:iterated, modes:multiple, modes:distinct_targets, field:create_tokens.tokenKeywords, field:create_tokens.who, field:draw_cards.who, field:life_change.who, step:repeat_for_each, field:repeat_for_each.ofPlayer, field:repeat_for_each.over, field:repeat_for_each.steps, step:add_counters, field:add_counters.on]
    Oracle: At the beginning of combat on your turn, you may choose two. Each mode must target a different player. / • Target player creates a 2/1 white and black Inkling creature token with flying. / • Target player draws a card and loses 1 life. / • Target player puts a +1/+1 counter on each creature they control.
    Trigger: At the beginning of combat on your turn
    Modes: choose 2  <- prompt: "Choose two modes (each different)."
      - Create a 2/1 white and black Inkling creature token with flying. (target: target player)
      - Target player draws a card. Then, target player loses 1 life. (target: target player)
      - For each creature, put a +1/+1 counter on that object. (target: target player)
    (optional: Do you want to use this ability?)
```

Player prompts:

- Shadrix Silverquill: choose modes: Choose two modes (each different).
- Shadrix Silverquill: choose a target: Choose target player.
- Shadrix Silverquill: optional: Do you want to use this ability?

Implementation: needed (modes, ref:iterated, modes:multiple, modes:distinct_targets, field:create_tokens.tokenKeywords, field:create_tokens.who, field:draw_cards.who, field:life_change.who, step:repeat_for_each, field:repeat_for_each.ofPlayer, field:repeat_for_each.over, field:repeat_for_each.steps, step:add_counters, field:add_counters.on)

Questions for you:

- Shadrix Silverquill: 'Each mode must target a different player' has no field (modes.options each target a player but nothing forces the targets to differ). Written as plain modes (choose exactly two, distinct) - the different-player constraint is only in the text. Also 'you may choose two' = optional ability choosing exactly two. ObjectFilter.controller cannot name 'the target player' / 'the iterated player'; written with a passthrough field (ofPlayer).

### Shattered Sanctum

Type: Land

Oracle text:

> This land enters tapped unless you control two or more other lands.
> {T}: Add {W} or {B}.

Re-rendered plain English:

```
Shattered Sanctum [draft]
  [a1] replacement [needed: needs replacement:would_enter]
    Oracle: This land enters tapped unless you control two or more other lands.
    Replacement: If Shattered Sanctum would enter (only if it is not true that you control two or more other lands), it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {W} or {B}.
    Cost: {T}
    Mana: add {W} and {B}
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter)

### Shineshadow Snarl

Type: Land

Oracle text:

> As this land enters, you may reveal a Plains or Swamp card from your hand. If you don't, this land enters tapped.
> {T}: Add {W} or {B}.

Re-rendered plain English:

```
Shineshadow Snarl [draft]
  [a1] replacement [needed: needs replacement:would_enter, step:reveal, field:reveal.filter, predicate:not, predicate:step_done]
    Oracle: As this land enters, you may reveal a Plains or Swamp card from your hand. If you don't, this land enters tapped.
    Replacement: If Shineshadow Snarl would enter, also: reveal the target, then tap Shineshadow Snarl
  [a2] mana [implemented]
    Oracle: {T}: Add {W} or {B}.
    Cost: {T}
    Mana: add {W} and {B}
```

Player prompts:

- Shineshadow Snarl: optional: Do you want to reveal the target?

Implementation: needed (replacement:would_enter, step:reveal, field:reveal.filter, predicate:not, predicate:step_done)

### Spectacular Spider-Man

Type: Legendary Creature — Spider Human Hero

Oracle text:

> Flash
> {1}: Spectacular Spider-Man gains flying until end of turn.
> {1}, Sacrifice Spectacular Spider-Man: Creatures you control gain hexproof and indestructible until end of turn.

Re-rendered plain English:

```
Spectacular Spider-Man [draft]
  [a1] keyword [implemented]
    Oracle: Flash
    Keyword: flash
  [a2] activated [needed: needs step:grant_effect, field:grant_effect.modify]
    Oracle: {1}: Spectacular Spider-Man gains flying until end of turn.
    Cost: {1}
    Effect: Spectacular Spider-Man gains flying until end of turn.
  [a3] activated [needed: needs cost:sacrifice, step:grant_effect, field:grant_effect.filter, field:grant_effect.modify]
    Oracle: {1}, Sacrifice Spectacular Spider-Man: Creatures you control gain hexproof and indestructible until end of turn.
    Cost: {1}, sacrifice Spectacular Spider-Man
    Effect: The target gains hexproof and gains indestructible until end of turn.
```

Player prompts:

- (none: no decisions)

Implementation: needed (step:grant_effect, field:grant_effect.modify, cost:sacrifice, field:grant_effect.filter)

### The Ozolith

Type: Legendary Artifact

Oracle text:

> Whenever a creature you control leaves the battlefield, if it had counters on it, put those counters on The Ozolith.
> At the beginning of combat on your turn, if The Ozolith has counters on it, you may move all counters from The Ozolith onto target creature.

Re-rendered plain English:

```
The Ozolith [draft]
  [a1] triggered [needed: needs trigger:leaves, trigger:intervening_if, predicate:matches, trigger:subject, trigger:zones, step:add_counters, quantity:counters, field:add_counters.on]
    Oracle: Whenever a creature you control leaves the battlefield, if it had counters on it, put those counters on The Ozolith.
    Trigger: Whenever a creature you control leaves the battlefield, if that object is a permanent with a counter on it
    Effect: Put the number of any counters on event_object same_as_source counters on The Ozolith.
  [a2] triggered [needed: needs trigger:intervening_if, predicate:compare, step:remove_counters, quantity:counters, field:remove_counters.on, field:remove_counters.saveAs, step:add_counters, field:add_counters.from, field:add_counters.on]
    Oracle: At the beginning of combat on your turn, if The Ozolith has counters on it, you may move all counters from The Ozolith onto target creature.
    Trigger: At the beginning of combat on your turn, if the number of any counters on self is greater than 0
    Target t1: target creature  <- prompt: "Choose target creature."
    Effect: You may remove the number of any counters on self any counters from The Ozolith. Then, put the number of any counters on self same_as_source counters on target creature.
```

Player prompts:

- The Ozolith: choose a target: Choose target creature.
- The Ozolith: optional: Do you want to remove the number of any counters on self any counters from The Ozolith?

Implementation: needed (trigger:leaves, trigger:intervening_if, predicate:matches, trigger:subject, trigger:zones, step:add_counters, quantity:counters, field:add_counters.on, predicate:compare, step:remove_counters, field:remove_counters.on, field:remove_counters.saveAs, field:add_counters.from)

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

### Vault of Champions

Type: Land

Oracle text:

> This land enters tapped unless you have two or more opponents.
> {T}: Add {W} or {B}.

Re-rendered plain English:

```
Vault of Champions [draft]
  [a1] replacement [needed: needs replacement:would_enter, quantity:opponents_count]
    Oracle: This land enters tapped unless you have two or more opponents.
    Replacement: If Vault of Champions would enter (only if it is not true that the number of opponents you have is 2 or greater), it enters tapped
  [a2] mana [implemented]
    Oracle: {T}: Add {W} or {B}.
    Cost: {T}
    Mana: add {W} and {B}
```

Player prompts:

- (none: no decisions)

Implementation: needed (replacement:would_enter, quantity:opponents_count)

Questions for you:

- Vault of Champions: 'two or more opponents' has no Quantity for the number of opponents; written as players_count(each_opponent where a trivially-true life check) >= 2. Needs {ref:'players_count', who:'each_opponent'} without a required 'where'.

### Windborn Muse

Type: Creature — Spirit

Oracle text:

> Flying
> Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.

Re-rendered plain English:

```
Windborn Muse [draft]
  [a1] keyword [implemented]
    Oracle: Flying
    Keyword: flying
  [a2] static [needed: needs static, static:attackTax]
    Oracle: Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.
    Static: Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you
```

Player prompts:

- (none: no decisions)

Implementation: needed (static, static:attackTax)

## Kernel to-do: missing capabilities across this deck

| capability | cards | needing it |
|---|---|---|
| `field:add_counters.on` | 14 | Breena, the Demagogue; Citadel Siege; Envoy of the Ancestors; Felisa, Fang of Silverquill; Hopeful Initiate; Nils, Discipline Enforcer; Orzhov Advokist; Promise of Loyalty; Reluctant Role Model; Resourceful Defense; Selfless Squire; Shadrix Silverquill; The Ozolith; Together Forever |
| `static` | 14 | Archangel of Tithes; Bloodthirsty Blade; Combat Calligrapher; Deathbringer Liege; Envoy of the Ancestors; Ghostly Prison; Lightning Greaves; Martial Impetus; Nils, Discipline Enforcer; Shadowspear; Sigarda's Summons; Sword of the Animist; Vow of Malice; Windborn Muse |
| `step:add_counters` | 14 | Breena, the Demagogue; Citadel Siege; Envoy of the Ancestors; Felisa, Fang of Silverquill; Hopeful Initiate; Nils, Discipline Enforcer; Orzhov Advokist; Promise of Loyalty; Reluctant Role Model; Resourceful Defense; Selfless Squire; Shadrix Silverquill; The Ozolith; Together Forever |
| `step:grant_effect` | 14 | Inkshield; Rogue's Passage; Batwing Brume; Duelist's Heritage; Enshrouding Mist; Flawless Maneuver; Loran's Escape; Orzhov Advokist; Perch Protection; Promise of Loyalty; Selfless Spirit; Selfless Squire; Shadowspear; Spectacular Spider-Man |
| `trigger:subject` | 13 | Breena, the Demagogue; Combat Calligrapher; Duelist's Heritage; Felisa, Fang of Silverquill; Gix, Yawgmoth Praetor; Mangara, the Diplomat; Martial Impetus; Reluctant Role Model; Resourceful Defense; Selfless Squire; Sword of the Animist; The Ozolith; Yathan Tombguard |
| `replacement:would_enter` | 12 | Isolated Chapel; Marble Diamond; Myriad Landscape; Secluded Steppe; Temple of Silence; Citadel Siege; Godless Shrine; Orzhov Basilica; Orzhov Guildgate; Shattered Sanctum; Shineshadow Snarl; Vault of Champions |
| `field:grant_effect.modify` | 10 | Rogue's Passage; Duelist's Heritage; Flawless Maneuver; Loran's Escape; Orzhov Advokist; Perch Protection; Promise of Loyalty; Selfless Spirit; Shadowspear; Spectacular Spider-Man |
| `step:choose` | 10 | Breena, the Demagogue; Citadel Siege; Incarnation Technique; Keen Duelist; Master of Ceremonies; Orzhov Advokist; Orzhov Basilica; Parker Luck; Promise of Loyalty; Reluctant Role Model |
| `trigger:intervening_if` | 10 | Breena, the Demagogue; Citadel Siege; Felisa, Fang of Silverquill; Hopeful Initiate; Knight of the White Orchid; Land Tax; Mangara, the Diplomat; Reluctant Role Model; Resourceful Defense; The Ozolith |
| `field:choose.saveAs` | 9 | Breena, the Demagogue; Incarnation Technique; Keen Duelist; Master of Ceremonies; Orzhov Advokist; Orzhov Basilica; Parker Luck; Promise of Loyalty; Reluctant Role Model |
| `field:life_change.who` | 8 | Swords to Plowshares; Batwing Brume; Gix, Yawgmoth Praetor; Kambal, Consul of Allocation; Keen Duelist; Parker Luck; Shadrix Silverquill; Sign in Blood |
| `field:search_library.count` | 8 | Evolving Wilds; Myriad Landscape; Ash Barrens; Knight of the White Orchid; Land Tax; Path to Exile; Scheming Symmetry; Sword of the Animist |
| `field:search_library.filter` | 8 | Evolving Wilds; Myriad Landscape; Ash Barrens; Knight of the White Orchid; Land Tax; Path to Exile; Scheming Symmetry; Sword of the Animist |
| `field:search_library.shuffle` | 8 | Evolving Wilds; Myriad Landscape; Ash Barrens; Knight of the White Orchid; Land Tax; Path to Exile; Scheming Symmetry; Sword of the Animist |
| `field:search_library.to` | 8 | Evolving Wilds; Myriad Landscape; Ash Barrens; Knight of the White Orchid; Land Tax; Path to Exile; Scheming Symmetry; Sword of the Animist |
| `step:search_library` | 8 | Evolving Wilds; Myriad Landscape; Ash Barrens; Knight of the White Orchid; Land Tax; Path to Exile; Scheming Symmetry; Sword of the Animist |
| `cost:sacrifice` | 7 | Commander's Sphere; Evolving Wilds; Myriad Landscape; Nihil Spellbomb; Orzhov Locket; Selfless Spirit; Spectacular Spider-Man |
| `field:choose.count` | 6 | Breena, the Demagogue; Keen Duelist; Orzhov Advokist; Orzhov Basilica; Parker Luck; Promise of Loyalty |
| `field:choose.from` | 6 | Breena, the Demagogue; Keen Duelist; Orzhov Advokist; Orzhov Basilica; Parker Luck; Promise of Loyalty |
| `field:grant_effect.filter` | 6 | Flawless Maneuver; Orzhov Advokist; Perch Protection; Selfless Spirit; Shadowspear; Spectacular Spider-Man |
| `predicate:compare` | 6 | Breena, the Demagogue; Knight of the White Orchid; Land Tax; Mangara, the Diplomat; Mister Negative; The Ozolith |
| `predicate:matches` | 6 | Deathbringer Liege; Enshrouding Mist; Felisa, Fang of Silverquill; Reluctant Role Model; Resourceful Defense; The Ozolith |
| `predicate:step_done` | 6 | Gix, Yawgmoth Praetor; Godless Shrine; Incarnation Technique; Nihil Spellbomb; Orzhov Advokist; Shineshadow Snarl |
| `quantity:math` | 6 | Batwing Brume; Keen Duelist; Parker Luck; Promise of Loyalty; Retribution of the Ancients; Toxic Deluge |
| `field:grant_effect.replacement` | 5 | Inkshield; Batwing Brume; Enshrouding Mist; Perch Protection; Selfless Squire |
| `field:repeat_for_each.steps` | 5 | Batwing Brume; Master of Ceremonies; Orzhov Advokist; Promise of Loyalty; Shadrix Silverquill |
| `field:search_library.tapped` | 5 | Evolving Wilds; Myriad Landscape; Knight of the White Orchid; Path to Exile; Sword of the Animist |
| `step:repeat_for_each` | 5 | Batwing Brume; Master of Ceremonies; Orzhov Advokist; Promise of Loyalty; Shadrix Silverquill |
| `targets:multi` | 5 | Nils, Discipline Enforcer; Parker Luck; Reluctant Role Model; Scheming Symmetry; Together Forever |
| `trigger:batch` | 5 | Breena, the Demagogue; Combat Calligrapher; Duelist's Heritage; Dusk Legion Duelist; Mangara, the Diplomat |
| `cost:discard` | 4 | Secluded Steppe; Ash Barrens; Eiganjo, Seat of the Empire; Gix, Yawgmoth Praetor |
| `field:attach.to` | 4 | Bloodthirsty Blade; Lightning Greaves; Shadowspear; Sword of the Animist |
| `field:attach.what` | 4 | Bloodthirsty Blade; Lightning Greaves; Shadowspear; Sword of the Animist |
| `field:choose.choice` | 4 | Citadel Siege; Incarnation Technique; Master of Ceremonies; Reluctant Role Model |
| `field:choose.who` | 4 | Master of Ceremonies; Orzhov Advokist; Parker Luck; Promise of Loyalty |
| `field:create_tokens.tokenKeywords` | 4 | Combat Calligrapher; Felisa, Fang of Silverquill; Perch Protection; Shadrix Silverquill |
| `field:create_tokens.who` | 4 | Combat Calligrapher; Generous Gift; Parting Gust; Shadrix Silverquill |
| `field:draw_cards.who` | 4 | Breena, the Demagogue; Gix, Yawgmoth Praetor; Shadrix Silverquill; Sign in Blood |
| `field:life_change.amount` | 4 | Swords to Plowshares; Batwing Brume; Keen Duelist; Parker Luck |
| `field:repeat_for_each.over` | 4 | Master of Ceremonies; Orzhov Advokist; Promise of Loyalty; Shadrix Silverquill |
| `quantity:counters` | 4 | Felisa, Fang of Silverquill; Reluctant Role Model; Resourceful Defense; The Ozolith |
| `static:attackTax` | 4 | Archangel of Tithes; Ghostly Prison; Nils, Discipline Enforcer; Windborn Muse |
| `step:attach` | 4 | Bloodthirsty Blade; Lightning Greaves; Shadowspear; Sword of the Animist |
| `field:choose.options` | 3 | Citadel Siege; Master of Ceremonies; Reluctant Role Model |
| `field:create_tokens.tokenTapped` | 3 | Combat Calligrapher; Felisa, Fang of Silverquill; Parting Gust |
| `field:grant_effect.who` | 3 | Batwing Brume; Orzhov Advokist; Shadowspear |
| `field:move_card_zone.what` | 3 | Incarnation Technique; Keen Duelist; Parker Luck |
| `field:move_card_zone.who` | 3 | Gix, Yawgmoth Praetor; Nihil Spellbomb; Parker Luck |
| `mana:variable` | 3 | Command Tower; Commander's Sphere; Exotic Orchard |
| `predicate:not` | 3 | Godless Shrine; Parting Gust; Shineshadow Snarl |
| `ref:iterated` | 3 | Orzhov Advokist; Promise of Loyalty; Shadrix Silverquill |
| `trigger:leaves` | 3 | Nihil Spellbomb; Resourceful Defense; The Ozolith |
| `trigger:zones` | 3 | Nihil Spellbomb; Resourceful Defense; The Ozolith |
| `zone:hand` | 3 | Secluded Steppe; Ash Barrens; Eiganjo, Seat of the Empire |
| `cast_option` | 2 | Flawless Maneuver; Toxic Deluge |
| `cast_option:gift` | 2 | Parting Gust; Perch Protection |
| `cost:counters` | 2 | Hopeful Initiate; Retribution of the Ancients |
| `cost:counters_from_filter` | 2 | Hopeful Initiate; Retribution of the Ancients |
| `cost:life` | 2 | War Room; Toxic Deluge |
| `duration:until_your_next_turn` | 2 | Orzhov Advokist; Perch Protection |
| `field:add_counters.from` | 2 | Resourceful Defense; The Ozolith |
| `field:choose.ofPlayer` | 2 | Orzhov Advokist; Promise of Loyalty |
| `field:choose.position` | 2 | Keen Duelist; Parker Luck |
| `field:choose.remember` | 2 | Citadel Siege; Master of Ceremonies |
| `field:choose.reveal` | 2 | Keen Duelist; Parker Luck |
| `field:create_delayed_trigger.at` | 2 | Parting Gust; Together Forever |
| `field:create_delayed_trigger.steps` | 2 | Parting Gust; Together Forever |
| `field:damage_target.source` | 2 | Caves of Koilos; Eiganjo, Seat of the Empire |
| `field:draw_cards.alsoWho` | 2 | Secret Rendezvous; Master of Ceremonies |
| `field:life_change.lifeFrom` | 2 | Keen Duelist; Parker Luck |
| `field:mass_pump.filter` | 2 | Martial Impetus; Toxic Deluge |
| `field:move_card_zone.from` | 2 | Incarnation Technique; Orzhov Basilica |
| `field:move_card_zone.position` | 2 | Gix, Yawgmoth Praetor; Hall of Heliod's Generosity |
| `field:remove_counters.on` | 2 | Resourceful Defense; The Ozolith |
| `field:remove_counters.saveAs` | 2 | Resourceful Defense; The Ozolith |
| `field:search_library.reveal` | 2 | Ash Barrens; Land Tax |
| `field:search_library.upTo` | 2 | Myriad Landscape; Land Tax |
| `field:search_library.who` | 2 | Path to Exile; Scheming Symmetry |
| `keyword:enchant` | 2 | Martial Impetus; Vow of Malice |
| `predicate:chosen_is` | 2 | Citadel Siege; Master of Ceremonies |
| `predicate:paid_additional_cost` | 2 | Parting Gust; Perch Protection |
| `static:cant_protects` | 2 | Combat Calligrapher; Vow of Malice |
| `step:create_delayed_trigger` | 2 | Parting Gust; Together Forever |
| `step:remove_counters` | 2 | Resourceful Defense; The Ozolith |
| `step:scry` | 2 | Temple of Silence; Loran's Escape |
| `timing` | 2 | Tainted Field; Dusk Legion Duelist |
| `trigger:defender` | 2 | Breena, the Demagogue; Combat Calligrapher |
| `cast_option:additional` | 1 | Toxic Deluge |
| `cast_option:alternative` | 1 | Flawless Maneuver |
| `cast_option:conditional` | 1 | Flawless Maneuver |
| `cast_option:mandatory` | 1 | Toxic Deluge |
| `cost_reduction` | 1 | Eiganjo, Seat of the Empire |
| `duration:forAsLongAs` | 1 | Promise of Loyalty |
| `field:choose.alsoWho` | 1 | Keen Duelist |
| `field:copy.who` | 1 | Incarnation Technique |
| `field:create_tokens.alsoWho` | 1 | Master of Ceremonies |
| `field:create_tokens.tokenAttacking` | 1 | Combat Calligrapher |
| `field:exchange_life.withWho` | 1 | Mister Negative |
| `field:extra_turn.who` | 1 | Perch Protection |
| `field:grant_effect.ofPlayer` | 1 | Orzhov Advokist |
| `field:if_else.optionalCost` | 1 | Nihil Spellbomb |
| `field:mass_pump.amountLockedOn` | 1 | Toxic Deluge |
| `field:move_card_zone.alsoWho` | 1 | Keen Duelist |
| `field:move_card_zone.filter` | 1 | Incarnation Technique |
| `field:move_card_zone.saveAs` | 1 | Gix, Yawgmoth Praetor |
| `field:move_card_zone.underControlOf` | 1 | Parting Gust |
| `field:move_card_zone.withCounters` | 1 | Parting Gust |
| `field:permission_to_play.allow` | 1 | Gix, Yawgmoth Praetor |
| `field:permission_to_play.what` | 1 | Gix, Yawgmoth Praetor |
| `field:permission_to_play.withoutPayingManaCost` | 1 | Gix, Yawgmoth Praetor |
| `field:remove_counters.upTo` | 1 | Resourceful Defense |
| `field:repeat_for_each.ofPlayer` | 1 | Shadrix Silverquill |
| `field:repeat_for_each.who` | 1 | Batwing Brume |
| `field:reveal.filter` | 1 | Shineshadow Snarl |
| `field:sacrifice_permanent.amount` | 1 | Promise of Loyalty |
| `field:sacrifice_permanent.except` | 1 | Promise of Loyalty |
| `field:sacrifice_permanent.filter` | 1 | Promise of Loyalty |
| `field:sacrifice_permanent.who` | 1 | Promise of Loyalty |
| `field:search_library.min` | 1 | Myriad Landscape |
| `field:search_library.position` | 1 | Scheming Symmetry |
| `field:search_library.sharesLandType` | 1 | Myriad Landscape |
| `field:vote.candidates` | 1 | Council's Judgment |
| `field:vote.tie` | 1 | Council's Judgment |
| `field:vote.voters` | 1 | Council's Judgment |
| `filter:attackingOpponent` | 1 | Martial Impetus |
| `filter:attackingYou` | 1 | Mangara, the Diplomat |
| `filter:blocking` | 1 | Eiganjo, Seat of the Empire |
| `modes` | 1 | Shadrix Silverquill |
| `modes:distinct_targets` | 1 | Shadrix Silverquill |
| `modes:multiple` | 1 | Shadrix Silverquill |
| `predicate:mana_spent` | 1 | Batwing Brume |
| `predicate:source_state` | 1 | Reluctant Role Model |
| `quantity:event_amount` | 1 | Selfless Squire |
| `quantity:life_lost_this_way` | 1 | Mister Negative |
| `quantity:life_total` | 1 | Breena, the Demagogue |
| `quantity:opponents_count` | 1 | Vault of Champions |
| `quantity:players_count` | 1 | Breena, the Demagogue |
| `quantity:stat` | 1 | Swords to Plowshares |
| `scripted:colors_lands_opponents_control_could_produce` | 1 | Exotic Orchard |
| `static:addTypes` | 1 | Sigarda's Summons |
| `static:blockTax` | 1 | Archangel of Tithes |
| `static:setBasePT` | 1 | Sigarda's Summons |
| `step:copy` | 1 | Incarnation Technique |
| `step:counter_spell` | 1 | Mana Tithe |
| `step:exchange_life` | 1 | Mister Negative |
| `step:extra_turn` | 1 | Perch Protection |
| `step:if_else` | 1 | Nihil Spellbomb |
| `step:permission_to_play` | 1 | Gix, Yawgmoth Praetor |
| `step:reveal` | 1 | Shineshadow Snarl |
| `step:unless_pay` | 1 | Mana Tithe |
| `step:vote` | 1 | Council's Judgment |
| `targets:per_opponent` | 1 | Nils, Discipline Enforcer |
| `trigger:begin_step:postcombat_main` | 1 | Reluctant Role Model |
| `trigger:counter_put` | 1 | Dusk Legion Duelist |
| `trigger:damage_prevented` | 1 | Selfless Squire |
| `trigger:nth` | 1 | Mangara, the Diplomat |
