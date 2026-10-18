# Agent mistake report — baseline-foundations

Pool `foundations`, 120 games, seeds 1000..1119, play guards on. Heuristic brain on every seat.

## Health

- Finished with a winner: 120/120 (100.0%); turn-cap 0, timeout 0, crash 0
- Average turns per seat: 11.3; audit violations: 0; avg wall clock 682 ms/game
- Winner spread: Tramplesaurus Rex 44, Calling All Angels 34, Wretched Ranks 26, Reign of Dragons 16
- Decisions: 25294; pass/end-turn share 39.8%; by action: play_land 3585, pass_priority 10062, cast_spell 4896, attack 5577, cast_commander 349, block 825

## Flags by category

| Category | Flags | Games hit | Flags/game | Top cards |
|---|---:|---:|---:|---|
| pointless_sacrifice | 0 | 0 | 0.00 |  |
| removal_on_low_threat | 0 | 0 | 0.00 |  |
| idle_protection_spell | 0 | 0 | 0.00 |  |
| combat_spell_outside_combat | 0 | 0 | 0.00 |  |
| declined_free_attack | 0 | 0 | 0.00 |  |
| unused_mana_castable_left | 0 | 0 | 0.00 |  |
| missed_land_drop | 0 | 0 | 0.00 |  |
| spell_no_target_or_effect | 5 | 5 | 0.04 | Go for the Throat (2), Swords to Plowshares (2), Kenrith's Transformation (1) |
| own_wipe_while_ahead | 0 | 0 | 0.00 |  |
| self_inflicted_loss | 8 | 8 | 0.07 | Righteous Valkyrie (3), Dragon Token (2), Treasure (2), Lathliss, Dragon Queen (1) |
| tapped_out_into_lethal | 13 | 11 | 0.11 | Blasphemous Act (3), Sol Ring (2), Defy Death (1), Commander's Sphere (1) |
| repeated_activation | 1 | 1 | 0.01 | Gravecrawler from the graveyard (1) |
| suicide_attack | 54 | 41 | 0.45 | Cryptbreaker (7), Sarkhan, Dragon Ascendant (6), Ghalta, Primal Hunger (5), Starnheim Aspirant (5) |
| pointless_block | 33 | 25 | 0.28 | Giada, Font of Hope (6), Ghoulcaller Gisa (5), Speaker of the Heavens (4), Beast Whisperer (3) |
| self_lethal_life_cost | 1 | 1 | 0.01 | Zul Ashur, Lich Lord (1) |

## Examples

### suicide_attack (54)

- game 2, turn 19 declare attackers step, Wretched Ranks (declare_attackers): Disciple of Bolas attacks into Angelic Field Marshal, which can block and kill it without dying (1 attacker(s) vs 1 such blocker(s))
  - chose: attack Calling All Angels with Disciple of Bolas; open mana 1; life {"Wretched Ranks":37,"Tramplesaurus Rex":40,"Calling All Angels":36,"Reign of Dragons":40}
  - hand: Gray Merchant of Asphodel, Arcane Signet, Witch's Cottage, Swamp
  - boards: Wretched Ranks: Stoneforge Masterwork, Disciple of Bolas 2/1 | Tramplesaurus Rex: Hulking Raptor 5/3 | Calling All Angels: Sol Ring(t), Speaker of the Heavens 1/1, Angelic Field Marshal 3/3, Tome of Legends | Reign of Dragons: Carnelian Orb of Dragonkind(t), Dragonhawk, Fate's Tempest 5/5
  - alternatives: attack Calling All Angels with Disciple of Bolas (2); declare no attackers (0); attack Tramplesaurus Rex with Disciple of Bolas (-2); attack Reign of Dragons with Disciple of Bolas (-2)

- game 2, turn 26 declare attackers step, Calling All Angels (declare_attackers): Speaker of the Heavens attacks into Verdant Sun's Avatar, which can block and kill it without dying (1 attacker(s) vs 1 such blocker(s))
  - chose: attack Tramplesaurus Rex with Speaker of the Heavens; open mana 0; life {"Calling All Angels":40,"Tramplesaurus Rex":43,"Wretched Ranks":30,"Reign of Dragons":38}
  - hand: Angel of Finality, Inspiring Overseer, Swords to Plowshares
  - boards: Calling All Angels: Sol Ring(t), Speaker of the Heavens 1/1, Tome of Legends, Angel of the Ruins 5/7(t), Exemplar of Light 3/3 | Tramplesaurus Rex: Hulking Raptor 5/3(t), Whiptongue Hydra 4/4(t), Verdant Sun's Avatar 5/5 | Wretched Ranks: Gray Merchant of Asphodel 2/4 | Reign of Dragons: Skyline Despot 5/5
  - alternatives: attack Tramplesaurus Rex with Speaker of the Heavens (3); attack Wretched Ranks with Speaker of the Heavens (2); attack Reign of Dragons with Speaker of the Heavens (1); declare no attackers (0)

- game 2, turn 33 declare attackers step, Tramplesaurus Rex (declare_attackers): Managorger Hydra attacks into Ghoulcaller Gisa, which can block and kill it without dying (1 attacker(s) vs 1 such blocker(s))
  - chose: attack Wretched Ranks with Managorger Hydra; open mana 0; life {"Tramplesaurus Rex":52,"Calling All Angels":42,"Wretched Ranks":10,"Reign of Dragons":20}
  - hand: -
  - boards: Tramplesaurus Rex: Hulking Raptor 5/3(t), Managorger Hydra 1/1, Commander's Sphere(t), Ilysian Caryatid 1/1(t), Curious Altisaur 2/5, Tangleweave Armor, Phyrexian Germ Token 0/0, Ghalta, Primal Hunger 12/12 | Calling All Angels: Sol Ring(t), Tome of Legends, Angel of the Ruins 5/7(t), Angel of Finality 3/4, Inspiring Overseer 2/1 | Wretched Ranks: Gray Merchant of Asphodel 2/4(t), Arcane Signet, Bad Moon, Disciple of Bolas 2/1(t), Ghoulcaller Gisa 3/4 | Reign of Dragons: Skyline Despot 5/5(t), Lathliss, Dragon Queen 6/6
  - alternatives: attack Wretched Ranks with Managorger Hydra (3); attack Reign of Dragons with Managorger Hydra (1); declare no attackers (0); attack Calling All Angels with Managorger Hydra (-1)

### pointless_block (33)

- game 0, turn 47 declare blockers step, Calling All Angels (declare_blockers_additional): Giada, Font of Hope blocks Beast Whisperer and dies without killing it, to save only 2 damage (life 40)
  - chose: block Beast Whisperer with Giada, Font of Hope; open mana 6; life {"Calling All Angels":40,"Wretched Ranks":0,"Reign of Dragons":0,"Tramplesaurus Rex":16}
  - hand: Reya Dawnbringer
  - boards: Calling All Angels: Marble Diamond, Search the Premises, Lyra Dawnbringer 5/5(t), Court of Grace, Linvala, the Preserver 5/5(t), Angel Token 3/3(t), Metropolis Reformer 2/3, Giada, Font of Hope 2/2 | Wretched Ranks: - | Reign of Dragons: - | Tramplesaurus Rex: Sol Ring(t), Garruk's Uprising, Yeva, Nature's Herald 4/4(t), Beast Whisperer 2/3(t), Whisperer of the Wilds 0/2(t), Llanowar Elves 1/1(t), Surrak and Goreclaw 6/5(t), Dungrove Elder */*
  - alternatives: block Beast Whisperer with Giada, Font of Hope (2); declare no blockers (0)

- game 1, turn 30 declare blockers step, Calling All Angels (declare_blockers_additional): Thraben Watcher blocks Curious Altisaur and dies without killing it, to save only 2 damage (life 51)
  - chose: block Curious Altisaur with Thraben Watcher; open mana 7; life {"Calling All Angels":51,"Reign of Dragons":0,"Tramplesaurus Rex":22,"Wretched Ranks":44}
  - hand: -
  - boards: Calling All Angels: Giada, Font of Hope 2/2, Dazzling Angel 2/3, Sol Ring, Mind Stone, Thraben Watcher 2/2, Vanquisher's Banner, Righteous Valkyrie 2/4, Serra Avenger 3/3 | Reign of Dragons: - | Tramplesaurus Rex: Beast Whisperer 2/3, Tangleweave Armor, Phyrexian Germ Token 0/0(t), Ghalta, Primal Hunger 12/12(t), Curious Altisaur 2/5, Challenger Troll 6/5 | Wretched Ranks: Arcane Signet(t), Bonehoard, Endless Ranks of the Dead, Ghoulcaller Gisa 3/4
  - alternatives: block Curious Altisaur with Thraben Watcher (2); block Curious Altisaur with Righteous Valkyrie (2); block Curious Altisaur with Serra Avenger (2); declare no blockers (0)

- game 14, turn 40 declare blockers step, Calling All Angels (declare_blockers_additional): Speaker of the Heavens blocks Umbral Collar Zealot and dies without killing it, to save only 3 damage (life 41)
  - chose: block Umbral Collar Zealot with Speaker of the Heavens; open mana 2; life {"Calling All Angels":41,"Tramplesaurus Rex":0,"Wretched Ranks":39,"Reign of Dragons":0}
  - hand: Herald of Eternal Dawn
  - boards: Calling All Angels: Tome of Legends, Swiftfoot Boots, Herald of War 3/3(t), Norn's Choirmaster 5/4(t), Speaker of the Heavens 1/1, Serra Avenger 3/3, Starnheim Aspirant 2/2 | Tramplesaurus Rex: - | Wretched Ranks: Oversold Cemetery, Commander's Sphere, Bonehoard, Umbral Collar Zealot 3/2(t), Ghoulcaller Gisa 3/4(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Arcane Signet | Reign of Dragons: -
  - alternatives: block Umbral Collar Zealot with Speaker of the Heavens (2); block Umbral Collar Zealot with Starnheim Aspirant (2); declare no blockers (0)

### tapped_out_into_lethal (13)

- game 7, turn 22 precombat main phase, Reign of Dragons (main_phase): tapped out for Blasphemous Act while an opponent's board can swing ~12 against my 5 life
  - chose: cast Blasphemous Act; open mana 7; life {"Reign of Dragons":5,"Calling All Angels":43,"Wretched Ranks":40,"Tramplesaurus Rex":40}
  - hand: Blasphemous Act, Leyline Tyrant, Thunderbreak Regent, Dragonhawk, Fate's Tempest, Firespitter Whelp, Sarkhan's Triumph
  - boards: Reign of Dragons: Dragon's Hoard | Calling All Angels: Giada, Font of Hope 2/2, Speaker of the Heavens 1/1, Righteous Valkyrie 2/4, Marble Diamond(t), Always Watching, Arcane Signet | Wretched Ranks: Sol Ring(t), Cryptbreaker 1/1(t), Fleshbag Marauder 3/1(t), Bonehoard, Headless Rider 3/1(t), Gravespawn Sovereign 3/3 | Tramplesaurus Rex: Fyndhorn Elves 1/1(t), Ilysian Caryatid 1/1(t), Curious Altisaur 2/5, Thrashing Brontodon 3/4, Rhonas the Indomitable 5/5
  - alternatives: cast Blasphemous Act (6); cast Leyline Tyrant (3); cast Thunderbreak Regent (3); cast Dragonhawk, Fate's Tempest (3); cast Firespitter Whelp (3); cast Sarkhan's Triumph (3)

- game 7, turn 22 postcombat main phase, Reign of Dragons (main_phase): tapped out for Blasphemous Act while an opponent's board can swing ~12 against my 5 life
  - chose: cast Blasphemous Act; open mana 7; life {"Reign of Dragons":5,"Calling All Angels":43,"Wretched Ranks":40,"Tramplesaurus Rex":40}
  - hand: Blasphemous Act, Leyline Tyrant, Thunderbreak Regent, Dragonhawk, Fate's Tempest, Firespitter Whelp, Sarkhan's Triumph
  - boards: Reign of Dragons: Dragon's Hoard | Calling All Angels: Giada, Font of Hope 2/2, Speaker of the Heavens 1/1, Righteous Valkyrie 2/4, Marble Diamond(t), Always Watching, Arcane Signet | Wretched Ranks: Sol Ring(t), Cryptbreaker 1/1(t), Fleshbag Marauder 3/1(t), Bonehoard, Headless Rider 3/1(t), Gravespawn Sovereign 3/3 | Tramplesaurus Rex: Fyndhorn Elves 1/1(t), Ilysian Caryatid 1/1(t), Curious Altisaur 2/5, Thrashing Brontodon 3/4, Rhonas the Indomitable 5/5
  - alternatives: cast Blasphemous Act (6); cast Leyline Tyrant (3); cast Thunderbreak Regent (3); cast Dragonhawk, Fate's Tempest (3); cast Firespitter Whelp (3); cast Sarkhan's Triumph (3)

- game 9, turn 36 precombat main phase, Tramplesaurus Rex (main_phase): tapped out for Sol Ring while an opponent's board can swing ~13 against my 5 life
  - chose: cast Sol Ring; open mana 1; life {"Tramplesaurus Rex":5,"Reign of Dragons":38,"Calling All Angels":33,"Wretched Ranks":38}
  - hand: Verdant Sun's Avatar, Tamiyo's Safekeeping, Overwhelming Stampede, Arasta of the Endless Web, Regal Imperiosaur, Dungrove Elder, Sol Ring
  - boards: Tramplesaurus Rex: Thickest in the Thicket | Reign of Dragons: Commander's Sphere(t), Warstorm Surge, Drakuseth, Maw of Flames 7/7(t), Lathliss, Dragon Queen 6/6 | Calling All Angels: Swiftfoot Boots, Patchwork Banner(t), Search the Premises, Norn's Choirmaster 5/4 | Wretched Ranks: Mind Stone(t), Bonehoard, Endless Ranks of the Dead, Soulless One */*
  - alternatives: cast Sol Ring (3); pass this phase (0); end turn and skip remaining phases (0); cast Tamiyo's Safekeeping [vetoed] (-47)

### self_inflicted_loss (8)

- game 61, turn 50 precombat main phase, Reign of Dragons (outcome): casting cast Cursed Mirror cost the caster ~14 of permanents (Lathliss, Dragon Queen) against ~0 for everyone else
  - chose: cast Cursed Mirror; open mana 0; life {"Reign of Dragons":29,"Tramplesaurus Rex":0,"Calling All Angels":39,"Wretched Ranks":0}
  - hand: Cursed Mirror
  - boards: Reign of Dragons: Fire Diamond, Lathliss, Dragon Queen | Tramplesaurus Rex: - | Calling All Angels: Tome of Legends, Merchant of Truth, Angelic Field Marshal, Sol Ring, Sunblast Angel, Clue | Wretched Ranks: -

- game 68, turn 35 precombat main phase, Calling All Angels (outcome): casting cast Swords to Plowshares cost the caster ~6 of permanents (Inspiring Overseer) against ~0 for everyone else
  - chose: cast Swords to Plowshares; open mana 0; life {"Wretched Ranks":35,"Reign of Dragons":23,"Tramplesaurus Rex":40,"Calling All Angels":42}
  - hand: Swords to Plowshares
  - boards: Wretched Ranks: Sol Ring, Cemetery Tampering, Bad Moon | Reign of Dragons: Hazoret's Monument, Commander's Sphere, Crucible of Fire | Tramplesaurus Rex: Colossal Majesty, Garruk's Uprising | Calling All Angels: Clue, Clue, Clue, Clue, Patchwork Banner, Inspiring Overseer

- game 74, turn 20 precombat main phase, Calling All Angels (outcome): casting cast Destroy Evil cost the caster ~8 of permanents (Righteous Valkyrie) against ~0 for everyone else
  - chose: cast Destroy Evil; open mana 0; life {"Tramplesaurus Rex":29,"Calling All Angels":41,"Wretched Ranks":44,"Reign of Dragons":40}
  - hand: Destroy Evil, Lyra Dawnbringer, Grasp of Fate
  - boards: Tramplesaurus Rex: - | Calling All Angels: Righteous Valkyrie, Search the Premises, Endless Atlas | Wretched Ranks: Fleshbag Marauder, Lashwrithe | Reign of Dragons: Sarkhan, Dragon Ascendant, Dragon's Hoard, Fire Diamond, Goldlust Triad

### spell_no_target_or_effect (5)

- game 10, turn 5 precombat main phase, Wretched Ranks (main_phase): targeted creature removal cast with no opposing creature: it can only hit my own
  - chose: cast Go for the Throat; open mana 2; life {"Wretched Ranks":40,"Tramplesaurus Rex":40,"Calling All Angels":40,"Reign of Dragons":40}
  - hand: Endless Ranks of the Dead, Go for the Throat, Swamp, Commander's Sphere, Zul Ashur, Lich Lord, Graveborn Muse
  - boards: Wretched Ranks: Gravecrawler 2/1 | Tramplesaurus Rex: - | Calling All Angels: - | Reign of Dragons: -
  - alternatives: cast Go for the Throat (3); cast Zul Ashur, Lich Lord (3); pass this phase (0); end turn and skip remaining phases (0)

- game 29, turn 5 precombat main phase, Wretched Ranks (main_phase): targeted creature removal cast with no opposing creature: it can only hit my own
  - chose: cast Go for the Throat; open mana 2; life {"Wretched Ranks":40,"Reign of Dragons":40,"Tramplesaurus Rex":40,"Calling All Angels":40}
  - hand: Fleshbag Marauder, Go for the Throat, Gravespawn Sovereign, Lord of the Undead, Vengeful Dead, Gray Merchant of Asphodel
  - boards: Wretched Ranks: Carrion Feeder 1/1 | Reign of Dragons: - | Tramplesaurus Rex: - | Calling All Angels: -
  - alternatives: cast Go for the Throat (3); pass this phase (0); end turn and skip remaining phases (0)

- game 49, turn 6 precombat main phase, Tramplesaurus Rex (main_phase): targeted creature removal cast with no opposing creature: it can only hit my own
  - chose: cast Kenrith's Transformation; open mana 3; life {"Tramplesaurus Rex":37,"Reign of Dragons":40,"Calling All Angels":40,"Wretched Ranks":40}
  - hand: Tranquil Thicket, Forest, Kenrith's Transformation, Forest, Witch's Clinic, Forest
  - boards: Tramplesaurus Rex: Llanowar Elves 1/1 | Reign of Dragons: Sol Ring | Calling All Angels: - | Wretched Ranks: -
  - alternatives: cast Kenrith's Transformation (3); pass this phase (0); end turn and skip remaining phases (0)

### repeated_activation (1)

- game 48, turn 29 precombat main phase, Wretched Ranks (main_phase): cast Gravecrawler from the graveyard chosen 3 times in the same phase
  - chose: cast Gravecrawler from the graveyard; open mana 4; life {"Wretched Ranks":40,"Reign of Dragons":36,"Tramplesaurus Rex":36,"Calling All Angels":34}
  - hand: -
  - boards: Wretched Ranks: Bonehoard, Bad Moon, Noxious Ghoul 3/3, Undead Butler 1/2 | Reign of Dragons: Commander's Sphere, Dragonstorm Globe | Tramplesaurus Rex: Arasta of the Endless Web 3/5 | Calling All Angels: Arcane Signet(t), Sol Ring(t), Merchant of Truth 2/5(t), Clue, Reya Dawnbringer 4/6
  - alternatives: cast Gravecrawler from the graveyard (3); pass this phase (0); end turn and skip remaining phases (0)

### self_lethal_life_cost (1)

- game 55, turn 29 precombat main phase, Wretched Ranks (main_phase): Zul Ashur, Lich Lord costs 2 life and I only have 2
  - chose: cast Zul Ashur, Lich Lord; open mana 2; life {"Wretched Ranks":2,"Calling All Angels":44,"Reign of Dragons":26,"Tramplesaurus Rex":40}
  - hand: Vengeful Dead, Lord of the Accursed, Zul Ashur, Lich Lord
  - boards: Wretched Ranks: Phyrexian Arena, Headless Rider 3/1 | Calling All Angels: Mind Stone(t), Vanquisher's Banner, Linvala, the Preserver 5/5 | Reign of Dragons: Hazoret's Monument, Arcane Signet(t) | Tramplesaurus Rex: Swiftfoot Boots, Beast Token 3/3
  - alternatives: cast Zul Ashur, Lich Lord (3); pass this phase (0); end turn and skip remaining phases (0)

## Engine gaps (not agent mistakes): spells cast that resolved with no modelled effect

- Mana Geyser: 11
