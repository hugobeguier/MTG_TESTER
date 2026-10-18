# Agent mistake report — baseline-foundations-unguarded

Pool `foundations`, 60 games, seeds 1000..1059, play guards DISABLED (diagnostic run). Heuristic brain on every seat.

## Health

- Finished with a winner: 60/60 (100.0%); turn-cap 0, timeout 0, crash 0
- Average turns per seat: 11.1; audit violations: 0; avg wall clock 664 ms/game
- Winner spread: Tramplesaurus Rex 18, Calling All Angels 27, Wretched Ranks 9, Reign of Dragons 6
- Decisions: 12382; pass/end-turn share 39.5%; by action: play_land 1745, pass_priority 4891, cast_spell 2468, cast_commander 162, attack 2702, block 414

## Flags by category

| Category | Flags | Games hit | Flags/game | Top cards |
|---|---:|---:|---:|---|
| pointless_sacrifice | 0 | 0 | 0.00 |  |
| removal_on_low_threat | 3 | 3 | 0.05 | Swords to Plowshares (3), Champion of the Perished (2), Dragonmaster Outcast (1) |
| idle_protection_spell | 9 | 9 | 0.15 | Tamiyo's Safekeeping (9) |
| combat_spell_outside_combat | 12 | 12 | 0.20 | Arachnogenesis (9), Overwhelming Stampede (3) |
| declined_free_attack | 0 | 0 | 0.00 |  |
| unused_mana_castable_left | 0 | 0 | 0.00 |  |
| missed_land_drop | 0 | 0 | 0.00 |  |
| spell_no_target_or_effect | 1 | 1 | 0.02 | Exorcise (1) |
| own_wipe_while_ahead | 2 | 2 | 0.03 | Fleshbag Marauder (1), Day of Judgment (1) |
| self_inflicted_loss | 4 | 4 | 0.07 | Always Watching (1), Giada, Font of Hope (1), Merchant of Truth (1), Disciple of Griselbrand (1) |
| tapped_out_into_lethal | 11 | 7 | 0.18 | Blasphemous Act (6), Always Watching (1), Gravespawn Sovereign (1), Breaching Dragonstorm (1) |
| repeated_activation | 0 | 0 | 0.00 |  |
| suicide_attack | 26 | 19 | 0.43 | Clifftop Lookout (5), Wojek Investigator (4), Cryptbreaker (4), Starnheim Aspirant (3) |
| pointless_block | 30 | 17 | 0.50 | Yeva, Nature's Herald (9), Giada, Font of Hope (4), Thraben Watcher (3), Starnheim Aspirant (3) |
| self_lethal_life_cost | 0 | 0 | 0.00 |  |

## Examples

### pointless_block (30)

- game 1, turn 37 declare blockers step, Calling All Angels (declare_blockers_additional): Giada, Font of Hope blocks Parapet Thrasher and dies without killing it, to save only 4 damage (life 32)
  - chose: block Parapet Thrasher with Giada, Font of Hope; open mana 4; life {"Calling All Angels":32,"Reign of Dragons":25,"Tramplesaurus Rex":0,"Wretched Ranks":0}
  - hand: -
  - boards: Calling All Angels: Patchwork Banner(t), Arcane Signet(t), Angel of Vitality 2/2(t), Sunblast Angel 4/5(t), Court of Grace, Giada, Font of Hope 2/2, Linvala, the Preserver 5/5 | Reign of Dragons: Stormscale Scion 4/4, Clue, Parapet Thrasher 4/3(t), Atsushi, the Blazing Sky 4/4(t), Firespitter Whelp 2/2(t), Breaching Dragonstorm, Magda, the Hoardmaster 2/2 | Tramplesaurus Rex: - | Wretched Ranks: -
  - alternatives: block Parapet Thrasher with Giada, Font of Hope (2); declare no blockers (0)

- game 2, turn 63 declare blockers step, Calling All Angels (declare_blockers_additional): Thraben Watcher blocks Ayara, First of Locthwain and dies without killing it, to save only 2 damage (life 10)
  - chose: block Ayara, First of Locthwain with Thraben Watcher; open mana 8; life {"Calling All Angels":10,"Tramplesaurus Rex":0,"Wretched Ranks":29,"Reign of Dragons":0}
  - hand: -
  - boards: Calling All Angels: Heraldic Banner, Sol Ring, Mind Stone, Tome of Legends, Vanquisher's Banner, Dazzling Angel 2/3, Thraben Watcher 2/2 | Tramplesaurus Rex: - | Wretched Ranks: Phyrexian Reclamation, Dissection Tools, Ayara, First of Locthwain 2/3(t), Cryptbreaker 1/1(t), Sol Ring, Lord of the Accursed 2/3(t), Headless Rider 3/1(t), Stoneforge Masterwork | Reign of Dragons: -
  - alternatives: block Ayara, First of Locthwain with Thraben Watcher (2); declare no blockers (0)

- game 3, turn 16 declare blockers step, Calling All Angels (declare_blockers_additional): Giada, Font of Hope blocks Arasta of the Endless Web and dies without killing it, to save only 3 damage (life 39)
  - chose: block Arasta of the Endless Web with Giada, Font of Hope; open mana 1; life {"Calling All Angels":39,"Wretched Ranks":17,"Reign of Dragons":39,"Tramplesaurus Rex":38}
  - hand: Vanquisher's Banner, Swords to Plowshares, Arcane Signet, Marble Diamond, Reya Dawnbringer
  - boards: Calling All Angels: Segovian Angel 1/1, Giada, Font of Hope 2/2, Wojek Investigator 2/4, Always Watching | Wretched Ranks: Wight of Precinct Six 1/1(t), Fleshbag Marauder 3/1 | Reign of Dragons: Sarkhan, Dragon Ascendant 2/2(t), Dragon Token 4/4(t), Parapet Thrasher 4/3 | Tramplesaurus Rex: Sol Ring(t), Arasta of the Endless Web 3/5(t), Surrak and Goreclaw 6/5
  - alternatives: block Arasta of the Endless Web with Giada, Font of Hope (2); declare no blockers (0)

### suicide_attack (26)

- game 3, turn 23 declare attackers step, Reign of Dragons (declare_attackers): Sarkhan, Dragon Ascendant attacks into Wojek Investigator, which can block and kill it without dying (1 attacker(s) vs 1 such blocker(s))
  - chose: attack Calling All Angels with Sarkhan, Dragon Ascendant; open mana 2; life {"Reign of Dragons":36,"Calling All Angels":39,"Wretched Ranks":0,"Tramplesaurus Rex":29}
  - hand: Tyrant's Familiar, Skyline Despot, Firespitter Whelp
  - boards: Reign of Dragons: Sarkhan, Dragon Ascendant 2/2, Dragon Token 4/4(t), Parapet Thrasher 4/3(t), Goldlust Triad 4/3(t), Wojek Investigator 2/4 | Calling All Angels: Segovian Angel 1/1, Giada, Font of Hope 2/2, Wojek Investigator 2/4, Always Watching, Arcane Signet(t), Sol Ring(t), Marble Diamond, Vanquisher's Banner | Wretched Ranks: - | Tramplesaurus Rex: Sol Ring(t), Thrashing Brontodon 3/4, Steel Leaf Champion 5/4
  - alternatives: attack Calling All Angels with Sarkhan, Dragon Ascendant (1); declare no attackers (0); attack Tramplesaurus Rex with Sarkhan, Dragon Ascendant (-1)

- game 10, turn 15 declare attackers step, Tramplesaurus Rex (declare_attackers): Clifftop Lookout attacks into Exemplar of Light, which can block and kill it without dying (1 attacker(s) vs 1 such blocker(s))
  - chose: attack Calling All Angels with Clifftop Lookout; open mana 1; life {"Tramplesaurus Rex":37,"Calling All Angels":40,"Wretched Ranks":40,"Reign of Dragons":35}
  - hand: Monstrous Onslaught, Whisperer of the Wilds
  - boards: Tramplesaurus Rex: Elvish Mystic 1/1(t), Clifftop Lookout 1/2, Dungrove Elder */*, Sol Ring | Calling All Angels: Giada, Font of Hope 2/2(t), Exemplar of Light 3/3 | Wretched Ranks: Umbral Collar Zealot 3/2(t), Death Baron 2/2(t), Graveborn Muse 3/3 | Reign of Dragons: Commander's Sphere(t), Sol Ring(t), Atsushi, the Blazing Sky 4/4, Dragonstorm Globe
  - alternatives: attack Calling All Angels with Clifftop Lookout (2); attack Reign of Dragons with Clifftop Lookout (1); attack Wretched Ranks with Clifftop Lookout (0); declare no attackers (0)

- game 14, turn 22 declare attackers step, Tramplesaurus Rex (declare_attackers): Dungrove Elder attacks into Grave Titan, which can block and kill it without dying (1 attacker(s) vs 1 such blocker(s))
  - chose: attack Wretched Ranks with Dungrove Elder; open mana 1; life {"Tramplesaurus Rex":24,"Calling All Angels":41,"Wretched Ranks":37,"Reign of Dragons":40}
  - hand: Elder Gargaroth, Rishkar, Peema Renegade, Forest, Forest
  - boards: Tramplesaurus Rex: Ilysian Caryatid 1/1(t), Beast Token 3/3(t), Garruk's Uprising, Regal Imperiosaur 5/4(t), Dungrove Elder */*, Commander's Sphere | Calling All Angels: Arcane Signet(t), Dazzling Angel 2/3(t), Lyra Dawnbringer 5/5 | Wretched Ranks: Commander's Sphere(t), Mind Stone(t), Grave Titan 6/6, Zombie Token 2/2, Zombie Token 2/2 | Reign of Dragons: Arcane Signet(t), Atsushi, the Blazing Sky 4/4(t), Basilisk Collar, Outpost Siege, Sol Ring(t), Tyrant's Familiar 5/5(t)
  - alternatives: attack Wretched Ranks with Dungrove Elder (4); attack Calling All Angels with Dungrove Elder (2); attack Reign of Dragons with Dungrove Elder (2); declare no attackers (0)

### combat_spell_outside_combat (12)

- game 0, turn 39 precombat main phase, Tramplesaurus Rex (main_phase): Arachnogenesis held: it only matters once creatures are attacking you, and it is outside combat (it would do nothing now)
  - chose: cast Arachnogenesis; open mana 5; life {"Tramplesaurus Rex":33,"Wretched Ranks":30,"Reign of Dragons":0,"Calling All Angels":10}
  - hand: Ram Through, Arachnogenesis
  - boards: Tramplesaurus Rex: Yeva, Nature's Herald 4/4, Terrian, World Tyrant 9/7, Thickest in the Thicket, Birds of Paradise 0/1(t), Clue, Ilysian Caryatid 1/1, Rhonas's Monument, Rhonas the Indomitable 5/5 | Wretched Ranks: Patchwork Banner(t), Gravespawn Sovereign 3/3(t), Crown of Gondor, Disciple of Bolas 2/1 | Reign of Dragons: - | Calling All Angels: Search the Premises, Mind Stone, Merchant of Truth 2/5(t)
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Arachnogenesis [vetoed] (-47)

- game 1, turn 26 precombat main phase, Tramplesaurus Rex (main_phase): Overwhelming Stampede held: a pump spell cast outside combat with no lethal attack available just wastes it
  - chose: cast Overwhelming Stampede; open mana 6; life {"Tramplesaurus Rex":36,"Reign of Dragons":25,"Calling All Angels":36,"Wretched Ranks":3}
  - hand: Overwhelming Stampede
  - boards: Tramplesaurus Rex: Garruk's Uprising, Unnatural Growth, Whisperer of the Wilds 0/2 | Reign of Dragons: Thundermane Dragon 4/4(t), Stormscale Scion 4/4 | Calling All Angels: Patchwork Banner(t), Arcane Signet(t), Angel of Vitality 2/2(t), Sunblast Angel 4/5(t), Herald of War 3/3 | Wretched Ranks: Endless Ranks of the Dead, Cemetery Tampering, Crown of Gondor
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Overwhelming Stampede [vetoed] (-47)

- game 5, turn 5 precombat main phase, Tramplesaurus Rex (main_phase): Arachnogenesis held: it only matters once creatures are attacking you, and it is outside combat (it would do nothing now)
  - chose: cast Arachnogenesis; open mana 3; life {"Tramplesaurus Rex":40,"Reign of Dragons":40,"Calling All Angels":40,"Wretched Ranks":40}
  - hand: Yeva, Nature's Herald, Garruk's Packleader, Forest, Arachnogenesis, War Room
  - boards: Tramplesaurus Rex: Birds of Paradise 0/1 | Reign of Dragons: - | Calling All Angels: Segovian Angel 1/1 | Wretched Ranks: -
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Arachnogenesis [vetoed] (-47)

### tapped_out_into_lethal (11)

- game 6, turn 37 precombat main phase, Calling All Angels (main_phase): tapped out for Always Watching while an opponent's board can swing ~29 against my 25 life
  - chose: cast Always Watching; open mana 3; life {"Calling All Angels":25,"Tramplesaurus Rex":0,"Wretched Ranks":62,"Reign of Dragons":0}
  - hand: Seraph of the Sword, Austere Command, Search the Premises, Always Watching, Angel of Finality, Cut a Deal, Vanquisher's Banner, Archangel of Tithes, Sunblast Angel, Metropolis Reformer
  - boards: Calling All Angels: Starnheim Aspirant 2/2, Vanguard Seraph 3/3 | Tramplesaurus Rex: - | Wretched Ranks: Charcoal Diamond(t), Noxious Ghoul 3/3(t), Undead Butler 1/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t) | Reign of Dragons: -
  - alternatives: cast Always Watching (5); cast Seraph of the Sword (3); cast Angel of Finality (3); cast Cut a Deal (3); cast Archangel of Tithes (3); cast Metropolis Reformer (3)

- game 16, turn 33 precombat main phase, Wretched Ranks (main_phase): tapped out for Gravespawn Sovereign while an opponent's board can swing ~7 against my 6 life
  - chose: cast Gravespawn Sovereign; open mana 6; life {"Wretched Ranks":6,"Reign of Dragons":23,"Tramplesaurus Rex":52,"Calling All Angels":52}
  - hand: Gravespawn Sovereign, Bontu's Monument, Champion of the Perished, Consumed by Greed, Stoneforge Masterwork, Oversold Cemetery
  - boards: Wretched Ranks: Endless Ranks of the Dead | Reign of Dragons: Scourge of Valkas 4/4(t), Warstorm Surge | Tramplesaurus Rex: Beast Whisperer 2/3(t), Commander's Sphere, Surrak, the Hunt Caller 5/4(t), Verdant Sun's Avatar 5/5(t), Tangleweave Armor | Calling All Angels: Lyra Dawnbringer 5/5(t), Angel of Vitality 2/2(t), Vanquisher's Banner, Grasp of Fate
  - alternatives: cast Gravespawn Sovereign (3); cast Bontu's Monument (3); cast Champion of the Perished (3); cast Consumed by Greed (3); cast Stoneforge Masterwork (3); cast Oversold Cemetery (3)

- game 18, turn 32 precombat main phase, Reign of Dragons (main_phase): tapped out for Blasphemous Act while an opponent's board can swing ~14 against my 11 life
  - chose: cast Blasphemous Act; open mana 6; life {"Reign of Dragons":11,"Tramplesaurus Rex":47,"Calling All Angels":44,"Wretched Ranks":0}
  - hand: Goldlust Triad, Stormscale Scion, Swiftfoot Boots, Blasphemous Act, Abrade, Atsushi, the Blazing Sky
  - boards: Reign of Dragons: Parapet Thrasher 4/3 | Tramplesaurus Rex: Llanowar Tribe 3/3(t), Curious Altisaur 2/5, Unnatural Growth, Yeva, Nature's Herald 4/4(t), Rhonas the Indomitable 5/5(t), Verdant Sun's Avatar 5/5 | Calling All Angels: Youthful Valkyrie 1/3(t), Sunblast Angel 4/5(t), Marble Diamond, Angelic Sleuth 2/3(t), Inspiring Overseer 2/1 | Wretched Ranks: -
  - alternatives: cast Blasphemous Act (6); cast Goldlust Triad (3); cast Stormscale Scion (3); cast Swiftfoot Boots (3); cast Abrade (3); cast Atsushi, the Blazing Sky (3)

### idle_protection_spell (9)

- game 15, turn 29 precombat main phase, Tramplesaurus Rex (main_phase): protection held: nothing on the stack (or in combat) threatens your permanents, so casting it now just wastes it
  - chose: cast Tamiyo's Safekeeping; open mana 3; life {"Tramplesaurus Rex":22,"Calling All Angels":36,"Wretched Ranks":40,"Reign of Dragons":19}
  - hand: Ram Through, Overwhelming Stampede, Tamiyo's Safekeeping
  - boards: Tramplesaurus Rex: Sol Ring, Colossal Majesty, Beast Whisperer 2/3, Birds of Paradise 0/1 | Calling All Angels: Angel Token 3/3(t), Angel of Finality 3/4 | Wretched Ranks: Patchwork Banner(t), Undead Augur 2/2(t), Bontu's Monument, Graveborn Muse 3/3 | Reign of Dragons: Dragon Tempest, Parapet Thrasher 4/3(t), Treasure, Hellkite Charger 5/5(t), Hazoret's Monument
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Tamiyo's Safekeeping [vetoed] (-47)

- game 18, turn 1 precombat main phase, Tramplesaurus Rex (main_phase): protection held: nothing on the stack (or in combat) threatens your permanents, so casting it now just wastes it
  - chose: cast Tamiyo's Safekeeping; open mana 1; life {"Tramplesaurus Rex":40,"Calling All Angels":40,"Wretched Ranks":40,"Reign of Dragons":40}
  - hand: Llanowar Tribe, Tamiyo's Safekeeping, Curious Altisaur, Unnatural Growth, Witch's Clinic, Clifftop Lookout, Rhonas's Monument
  - boards: Tramplesaurus Rex: - | Calling All Angels: - | Wretched Ranks: - | Reign of Dragons: -
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Tamiyo's Safekeeping [vetoed] (-47)

- game 26, turn 7 precombat main phase, Tramplesaurus Rex (main_phase): protection held: nothing on the stack (or in combat) threatens your permanents, so casting it now just wastes it
  - chose: cast Tamiyo's Safekeeping; open mana 2; life {"Tramplesaurus Rex":40,"Calling All Angels":40,"Wretched Ranks":40,"Reign of Dragons":40}
  - hand: Monstrous Onslaught, Harmonize, Tamiyo's Safekeeping, Llanowar Tribe, Rogue's Passage, Regal Imperiosaur
  - boards: Tramplesaurus Rex: - | Calling All Angels: - | Wretched Ranks: Undead Butler 1/2 | Reign of Dragons: Orb of Dragonkind
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Tamiyo's Safekeeping [vetoed] (-47)

### self_inflicted_loss (4)

- game 3, turn 33 precombat main phase, Calling All Angels (outcome): casting cast Invoke the Divine cost the caster ~6 of permanents (Always Watching) against ~0 for everyone else
  - chose: cast Invoke the Divine; open mana 0; life {"Calling All Angels":36,"Wretched Ranks":0,"Reign of Dragons":26,"Tramplesaurus Rex":0}
  - hand: Invoke the Divine
  - boards: Calling All Angels: Always Watching, Arcane Signet, Sol Ring, Marble Diamond, Vanquisher's Banner, Angel of Vitality | Wretched Ranks: - | Reign of Dragons: Dragon Token, Parapet Thrasher, Goldlust Triad, Firespitter Whelp | Tramplesaurus Rex: -

- game 18, turn 14 precombat main phase, Calling All Angels (outcome): casting cast Sunblast Angel cost the caster ~9 of permanents (Giada, Font of Hope) against ~0 for everyone else
  - chose: cast Sunblast Angel; open mana 0; life {"Tramplesaurus Rex":42,"Calling All Angels":40,"Wretched Ranks":36,"Reign of Dragons":40}
  - hand: Austere Command, Reya Dawnbringer, Sunblast Angel, Marble Diamond
  - boards: Tramplesaurus Rex: Clue, Llanowar Tribe, Sol Ring | Calling All Angels: Sol Ring, Giada, Font of Hope, Youthful Valkyrie | Wretched Ranks: Disciple of Griselbrand | Reign of Dragons: Dragon Tempest, Hazoret's Monument

- game 28, turn 45 precombat main phase, Calling All Angels (outcome): casting cast Valorous Stance cost the caster ~6 of permanents (Merchant of Truth) against ~0 for everyone else
  - chose: cast Valorous Stance; open mana 0; life {"Wretched Ranks":19,"Reign of Dragons":0,"Tramplesaurus Rex":0,"Calling All Angels":7}
  - hand: Day of Judgment, Valorous Stance
  - boards: Wretched Ranks: Undead Butler, Patchwork Banner | Reign of Dragons: - | Tramplesaurus Rex: - | Calling All Angels: Heraldic Banner, Grasp of Fate, Angelic Sleuth, Herald of Eternal Dawn, Starnheim Aspirant, Segovian Angel, Court of Grace, Mind Stone

### removal_on_low_threat (3)

- game 22, turn 13 precombat main phase, Calling All Angels (main_phase): removal held: the best target (Dragonmaster Outcast, threat 2.4) is below the 4.0 bar for spending a removal spell — keep it for a real threat
  - chose: cast Swords to Plowshares; open mana 2; life {"Calling All Angels":40,"Tramplesaurus Rex":34,"Wretched Ranks":40,"Reign of Dragons":40}
  - hand: Cleansing Nova, Plains, Serra Avenger, Lyra Dawnbringer, Swords to Plowshares, Thraben Watcher
  - boards: Calling All Angels: Sol Ring(t), Wojek Investigator 2/4, Grasp of Fate | Tramplesaurus Rex: - | Wretched Ranks: Undead Butler 1/2(t) | Reign of Dragons: Dragonmaster Outcast 1/1
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Swords to Plowshares [vetoed] (-47)

- game 53, turn 6 precombat main phase, Calling All Angels (main_phase): removal held: the best target (Champion of the Perished, threat 2.0) is below the 3.0 bar for spending a removal spell — keep it for a real threat
  - chose: cast Swords to Plowshares; open mana 1; life {"Calling All Angels":40,"Reign of Dragons":40,"Tramplesaurus Rex":40,"Wretched Ranks":40}
  - hand: Swords to Plowshares, Day of Judgment, Metropolis Reformer, Angelic Sleuth, Exemplar of Light, Valorous Stance
  - boards: Calling All Angels: Sol Ring(t), Giada, Font of Hope 2/2 | Reign of Dragons: - | Tramplesaurus Rex: - | Wretched Ranks: Champion of the Perished 1/1
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Swords to Plowshares [vetoed] (-47)

- game 54, turn 5 precombat main phase, Calling All Angels (main_phase): removal held: the best target (Champion of the Perished, threat 2.0) is below the 3.0 bar for spending a removal spell — keep it for a real threat
  - chose: cast Swords to Plowshares; open mana 1; life {"Calling All Angels":40,"Tramplesaurus Rex":40,"Wretched Ranks":40,"Reign of Dragons":40}
  - hand: Cleansing Nova, Angelic Sleuth, Youthful Valkyrie, Grasp of Fate, Swords to Plowshares, Plains, Plains
  - boards: Calling All Angels: - | Tramplesaurus Rex: - | Wretched Ranks: Champion of the Perished 1/1 | Reign of Dragons: -
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Swords to Plowshares [vetoed] (-47)

### own_wipe_while_ahead (2)

- game 23, turn 29 precombat main phase, Wretched Ranks (main_phase): board wipe cast with my creature value 28 against 26 for the whole rest of the table
  - chose: cast Fleshbag Marauder; open mana 7; life {"Wretched Ranks":12,"Calling All Angels":0,"Reign of Dragons":39,"Tramplesaurus Rex":0}
  - hand: Fleshbag Marauder
  - boards: Wretched Ranks: Champion of the Perished 1/1, Lord of the Accursed 2/3, Wight of Precinct Six 1/1, Phyrexian Reclamation, Umbral Collar Zealot 3/2, Commander's Sphere, Ghoulcaller Gisa 3/4, Ayara, First of Locthwain 2/3 | Calling All Angels: - | Reign of Dragons: Sol Ring(t), Sarkhan, Dragon Ascendant 2/2(t), Dragon Token 4/4(t), Basilisk Collar, Stormscale Scion 4/4(t), Parapet Thrasher 4/3(t), Dragonstorm Globe | Tramplesaurus Rex: -
  - alternatives: cast Fleshbag Marauder (3); pass this phase (0); end turn and skip remaining phases (0)

- game 53, turn 30 precombat main phase, Calling All Angels (main_phase): board wipe cast with my creature value 30 against 29 for the whole rest of the table
  - chose: cast Day of Judgment; open mana 7; life {"Calling All Angels":43,"Reign of Dragons":12,"Tramplesaurus Rex":0,"Wretched Ranks":38}
  - hand: Day of Judgment, Archangel of Tithes
  - boards: Calling All Angels: Sol Ring, Metropolis Reformer 2/3, Angelic Sleuth 2/3, Segovian Angel 1/1, Exemplar of Light 3/3, Giada, Font of Hope 2/2 | Reign of Dragons: Fire Diamond(t), Basilisk Collar, Skyline Despot 5/5(t), Dragon's Hoard(t), Lathliss, Dragon Queen 6/6 | Tramplesaurus Rex: - | Wretched Ranks: Oversold Cemetery, Bad Moon, Cemetery Tampering, Stoneforge Masterwork, Midnight Reaper 3/2
  - alternatives: cast Day of Judgment (3); cast Archangel of Tithes (3); pass this phase (0); end turn and skip remaining phases (0)

### spell_no_target_or_effect (1)

- game 44, turn 9 precombat main phase, Calling All Angels (main_phase): targeted creature removal cast with no opposing creature: it can only hit my own
  - chose: cast Exorcise; open mana 4; life {"Calling All Angels":40,"Wretched Ranks":39,"Reign of Dragons":40,"Tramplesaurus Rex":40}
  - hand: Angel of the Ruins, Exorcise, Metallic Mimic, Search the Premises, Austere Command, Commander's Sphere
  - boards: Calling All Angels: Segovian Angel 1/1, Giada, Font of Hope 2/2 | Wretched Ranks: Sol Ring | Reign of Dragons: Arcane Signet | Tramplesaurus Rex: -
  - alternatives: cast Exorcise (3); cast Metallic Mimic (3); cast Commander's Sphere (3); pass this phase (0); end turn and skip remaining phases (0)

## Engine gaps (not agent mistakes): spells cast that resolved with no modelled effect

- Mana Geyser: 8
