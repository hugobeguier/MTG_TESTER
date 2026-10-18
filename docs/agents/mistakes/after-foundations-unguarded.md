# Agent mistake report — after-foundations-unguarded

Pool `foundations`, 60 games, seeds 1000..1059, play guards DISABLED (diagnostic run). Heuristic brain on every seat.

## Health

- Finished with a winner: 60/60 (100.0%); turn-cap 0, timeout 0, crash 0
- Average turns per seat: 11.9; audit violations: 0; avg wall clock 707 ms/game
- Winner spread: Wretched Ranks 13, Tramplesaurus Rex 21, Calling All Angels 20, Reign of Dragons 6
- Decisions: 13160; pass/end-turn share 40.7%; by action: play_land 1829, pass_priority 5357, cast_spell 2651, cast_commander 183, attack 2817, block 323

## Flags by category

| Category | Flags | Games hit | Flags/game | Top cards |
|---|---:|---:|---:|---|
| pointless_sacrifice | 0 | 0 | 0.00 |  |
| removal_on_low_threat | 13 | 12 | 0.22 | Swords to Plowshares (6), Kenrith's Transformation (3), Llanowar Elves (3), Go for the Throat (2) |
| idle_protection_spell | 12 | 12 | 0.20 | Tamiyo's Safekeeping (12) |
| combat_spell_outside_combat | 11 | 10 | 0.18 | Arachnogenesis (9), Overwhelming Stampede (2) |
| declined_free_attack | 0 | 0 | 0.00 |  |
| unused_mana_castable_left | 3 | 2 | 0.05 | The Elder Dragon War (2), Fleshbag Marauder (1) |
| missed_land_drop | 0 | 0 | 0.00 |  |
| spell_no_target_or_effect | 1 | 1 | 0.02 | Go for the Throat (1) |
| own_wipe_while_ahead | 2 | 2 | 0.03 | Cleansing Nova (1), Austere Command (1) |
| self_inflicted_loss | 5 | 5 | 0.08 | Commander's Sphere (1), Atsushi, the Blazing Sky (1), Giada, Font of Hope (1), Drakuseth, Maw of Flames (1) |
| tapped_out_into_lethal | 10 | 8 | 0.17 | Blasphemous Act (5), Oversold Cemetery (1), Dragon's Hoard (1), Austere Command (1) |
| repeated_activation | 1 | 1 | 0.02 | Gravecrawler from the graveyard (1) |
| suicide_attack | 27 | 22 | 0.45 | Firemane Commando (5), Managorger Hydra (3), Sarkhan, Dragon Ascendant (3), Beast Token (3) |
| pointless_block | 0 | 0 | 0.00 |  |
| self_lethal_life_cost | 0 | 0 | 0.00 |  |

## Examples

### suicide_attack (27)

- game 2, turn 15 declare attackers step, Wretched Ranks (declare_attackers): Cemetery Reaper attacks into Firemane Commando, which can block and kill it without dying (1 attacker(s) vs 1 such blocker(s))
  - chose: attack Calling All Angels with Cemetery Reaper; open mana 3; life {"Wretched Ranks":43,"Tramplesaurus Rex":40,"Calling All Angels":27,"Reign of Dragons":40}
  - hand: Swamp, Ambition's Cost, Gravespawn Sovereign
  - boards: Wretched Ranks: Sol Ring(t), Cemetery Reaper 2/2, Headless Rider 3/1 | Tramplesaurus Rex: Steel Leaf Champion 5/4(t), Clue, Goreclaw, Terror of Qal Sisma 4/3 | Calling All Angels: Firemane Commando 4/3 | Reign of Dragons: Dragonspeaker Shaman 2/2
  - alternatives: attack Calling All Angels with Cemetery Reaper (0); declare no attackers (0); attack Reign of Dragons with Cemetery Reaper (-1); attack Tramplesaurus Rex with Cemetery Reaper (-2)

- game 2, turn 16 declare attackers step, Reign of Dragons (declare_attackers): Dragonspeaker Shaman attacks into Firemane Commando, which can block and kill it without dying (1 attacker(s) vs 1 such blocker(s))
  - chose: attack Calling All Angels with Dragonspeaker Shaman; open mana 1; life {"Reign of Dragons":40,"Tramplesaurus Rex":40,"Calling All Angels":27,"Wretched Ranks":43}
  - hand: Mountain, Chandra's Ignition, Mountain
  - boards: Reign of Dragons: Dragonspeaker Shaman 2/2, Gadrak, the Crown-Scourge 5/4, Orb of Dragonkind | Tramplesaurus Rex: Steel Leaf Champion 5/4(t), Clue, Goreclaw, Terror of Qal Sisma 4/3 | Calling All Angels: Firemane Commando 4/3 | Wretched Ranks: Sol Ring(t), Headless Rider 3/1, Zombie Token 2/2
  - alternatives: attack Calling All Angels with Dragonspeaker Shaman (2); attack Tramplesaurus Rex with Dragonspeaker Shaman (0); attack Wretched Ranks with Dragonspeaker Shaman (0); declare no attackers (0)

- game 5, turn 21 declare attackers step, Tramplesaurus Rex (declare_attackers): Clifftop Lookout attacks into Draconic Visitor, which can block and kill it without dying (1 attacker(s) vs 1 such blocker(s))
  - chose: attack Reign of Dragons with Clifftop Lookout; open mana 0; life {"Tramplesaurus Rex":39,"Reign of Dragons":22,"Calling All Angels":43,"Wretched Ranks":37}
  - hand: Commander's Sphere, Rhonas's Monument, Ezuri's Predation, Arachnogenesis
  - boards: Tramplesaurus Rex: Clifftop Lookout 1/2, Hulking Raptor 5/3(t), Gigantosaurus 10/10, Sol Ring(t), Swiftfoot Boots | Reign of Dragons: Swiftfoot Boots, Clue, Draconic Visitor 5/5 | Calling All Angels: Giada, Font of Hope 2/2(t), Arcane Signet(t), Inspiring Overseer 2/1(t), Dazzling Angel 2/3(t), Exemplar of Light 3/3 | Wretched Ranks: Fleshbag Marauder 3/1(t), Lord of the Undead 2/2
  - alternatives: attack Reign of Dragons with Clifftop Lookout (2); attack Calling All Angels with Clifftop Lookout (2); attack Wretched Ranks with Clifftop Lookout (0); declare no attackers (0)

### removal_on_low_threat (13)

- game 0, turn 9 precombat main phase, Wretched Ranks (main_phase): removal held: the best target (Dragonmaster Outcast, threat 2.4) is below the 3.0 bar for spending a removal spell — keep it for a real threat
  - chose: cast Go for the Throat; open mana 2; life {"Wretched Ranks":43,"Reign of Dragons":40,"Tramplesaurus Rex":40,"Calling All Angels":40}
  - hand: Graveborn Muse, Go for the Throat, Swamp, Swamp, Soulless One
  - boards: Wretched Ranks: Arcane Signet | Reign of Dragons: Dragonmaster Outcast 1/1 | Tramplesaurus Rex: - | Calling All Angels: Sol Ring(t)
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Go for the Throat [vetoed] (-47)

- game 7, turn 4 precombat main phase, Calling All Angels (main_phase): removal held: the best target (Elvish Mystic, threat 2.7) is below the 3.0 bar for spending a removal spell — keep it for a real threat
  - chose: cast Swords to Plowshares; open mana 1; life {"Calling All Angels":40,"Wretched Ranks":40,"Reign of Dragons":40,"Tramplesaurus Rex":40}
  - hand: Swords to Plowshares, Plains, Plains, Plains, Angel of Vitality, Vanguard Seraph, Plains
  - boards: Calling All Angels: - | Wretched Ranks: - | Reign of Dragons: - | Tramplesaurus Rex: Elvish Mystic 1/1
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Swords to Plowshares [vetoed] (-47)

- game 12, turn 58 precombat main phase, Wretched Ranks (main_phase): removal held: no opposing creature to target, so the spell could only hit your own
  - chose: cast Go for the Throat; open mana 9; life {"Wretched Ranks":13,"Reign of Dragons":0,"Tramplesaurus Rex":21,"Calling All Angels":0}
  - hand: Go for the Throat
  - boards: Wretched Ranks: Phyrexian Reclamation, Cemetery Tampering, Lord of the Accursed 2/3, Lashwrithe, Grave Titan 6/6, Zombie Token 2/2, Zombie Token 2/2, Disciple of Griselbrand 1/1 | Reign of Dragons: - | Tramplesaurus Rex: Colossal Majesty | Calling All Angels: -
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Go for the Throat [vetoed] (-47)

### idle_protection_spell (12)

- game 1, turn 22 precombat main phase, Tramplesaurus Rex (main_phase): protection held: nothing on the stack (or in combat) threatens your permanents, so casting it now just wastes it
  - chose: cast Tamiyo's Safekeeping; open mana 1; life {"Tramplesaurus Rex":35,"Reign of Dragons":40,"Calling All Angels":35,"Wretched Ranks":29}
  - hand: Beast Whisperer, Scavenging Ooze, Tamiyo's Safekeeping
  - boards: Tramplesaurus Rex: Dungrove Elder */* | Reign of Dragons: Sol Ring(t), Arcane Signet(t), Hazoret's Monument, Orb of Dragonkind, Sarkhan the Masterless, Lathliss, Dragon Queen 6/6 | Calling All Angels: Patchwork Banner(t), Swiftfoot Boots | Wretched Ranks: Arcane Signet(t), Patchwork Banner(t), Charcoal Diamond(t), Soulless One */*
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Tamiyo's Safekeeping [vetoed] (-47)

- game 8, turn 41 precombat main phase, Tramplesaurus Rex (main_phase): protection held: nothing on the stack (or in combat) threatens your permanents, so casting it now just wastes it
  - chose: cast Tamiyo's Safekeeping; open mana 2; life {"Tramplesaurus Rex":31,"Wretched Ranks":0,"Reign of Dragons":0,"Calling All Angels":78}
  - hand: Tamiyo's Safekeeping, Thrashing Brontodon
  - boards: Tramplesaurus Rex: Sol Ring, Unnatural Growth, Managorger Hydra 1/1 | Wretched Ranks: - | Reign of Dragons: - | Calling All Angels: Marble Diamond(t), Arcane Signet(t), Commander's Sphere(t), Sephara, Sky's Blade 7/7(t), Herald of Eternal Dawn 6/6
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Tamiyo's Safekeeping [vetoed] (-47)

- game 13, turn 7 precombat main phase, Tramplesaurus Rex (main_phase): protection held: nothing on the stack (or in combat) threatens your permanents, so casting it now just wastes it
  - chose: cast Tamiyo's Safekeeping; open mana 2; life {"Tramplesaurus Rex":40,"Reign of Dragons":40,"Calling All Angels":40,"Wretched Ranks":40}
  - hand: Tamiyo's Safekeeping, Unnatural Growth, Surrak, the Hunt Caller, Forest, Overwhelming Stampede
  - boards: Tramplesaurus Rex: Llanowar Elves 1/1, Fyndhorn Elves 1/1 | Reign of Dragons: Dragonlord's Servant 1/3 | Calling All Angels: - | Wretched Ranks: -
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Tamiyo's Safekeeping [vetoed] (-47)

### combat_spell_outside_combat (11)

- game 0, turn 39 precombat main phase, Tramplesaurus Rex (main_phase): Overwhelming Stampede held: a pump spell cast outside combat with no lethal attack available just wastes it
  - chose: cast Overwhelming Stampede; open mana 5; life {"Tramplesaurus Rex":40,"Wretched Ranks":47,"Reign of Dragons":1,"Calling All Angels":41}
  - hand: Overwhelming Stampede
  - boards: Tramplesaurus Rex: Unnatural Growth, Swiftfoot Boots, Garruk's Uprising, Clifftop Lookout 1/2, Yeva, Nature's Herald 4/4 | Wretched Ranks: Endless Ranks of the Dead, Gravespawn Sovereign 3/3 | Reign of Dragons: Sol Ring(t), Crucible of Fire, Orb of Dragonkind, Hazoret's Monument, Leyline Tyrant 4/4, Sarkhan, Dragon Ascendant 2/2, Treasure | Calling All Angels: Sol Ring(t), Swiftfoot Boots, Arcane Signet(t), Merchant of Truth 2/5, Firemane Commando 4/3
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Overwhelming Stampede [vetoed] (-47)

- game 5, turn 33 precombat main phase, Tramplesaurus Rex (main_phase): Arachnogenesis held: it only matters once creatures are attacking you, and it is outside combat (it would do nothing now)
  - chose: cast Arachnogenesis; open mana 2; life {"Tramplesaurus Rex":39,"Reign of Dragons":0,"Calling All Angels":42,"Wretched Ranks":37}
  - hand: Arachnogenesis
  - boards: Tramplesaurus Rex: Sol Ring, Swiftfoot Boots, Commander's Sphere, Rhonas's Monument, Scrapshooter 4/4, Steel Leaf Champion 5/4 | Reign of Dragons: - | Calling All Angels: Arcane Signet(t), Grasp of Fate, Endless Atlas | Wretched Ranks: Phyrexian Arena, Patchwork Banner(t), Lashwrithe, Zul Ashur, Lich Lord 2/2, Ghoulcaller Gisa 3/4
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Arachnogenesis [vetoed] (-47)

- game 19, turn 44 precombat main phase, Tramplesaurus Rex (main_phase): Arachnogenesis held: it only matters once creatures are attacking you, and it is outside combat (it would do nothing now)
  - chose: cast Arachnogenesis; open mana 9; life {"Tramplesaurus Rex":39,"Calling All Angels":24,"Wretched Ranks":0,"Reign of Dragons":7}
  - hand: Ram Through, Swiftfoot Boots, Arachnogenesis
  - boards: Tramplesaurus Rex: Rhonas's Monument | Calling All Angels: Marble Diamond, Emeria Shepherd 4/4(t), Wojek Investigator 2/4, Metropolis Reformer 2/3, Search the Premises, Angel of the Ruins 5/7(t), Inspiring Overseer 2/1(t), Sol Ring | Wretched Ranks: - | Reign of Dragons: Count on Luck, Goldlust Triad 4/3(t), Atsushi, the Blazing Sky 4/4(t), Tyrant's Familiar 5/5(t), Breaching Dragonstorm
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Arachnogenesis [vetoed] (-47)

### tapped_out_into_lethal (10)

- game 0, turn 30 precombat main phase, Reign of Dragons (main_phase): tapped out for Blasphemous Act while an opponent's board can swing ~13 against my 1 life
  - chose: cast Blasphemous Act; open mana 8; life {"Reign of Dragons":1,"Wretched Ranks":47,"Tramplesaurus Rex":40,"Calling All Angels":41}
  - hand: Blasphemous Act, Crucible of Fire, Orb of Dragonkind, Unexpected Windfall, Hazoret's Monument, Leyline Tyrant, Breaching Dragonstorm
  - boards: Reign of Dragons: Sol Ring, Treasure | Wretched Ranks: Kalitas, Traitor of Ghet 3/4(t), Grave Titan 6/6(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Endless Ranks of the Dead | Tramplesaurus Rex: Unnatural Growth, Garruk's Packleader 4/4(t), Llanowar Tribe 3/3, Swiftfoot Boots | Calling All Angels: Sol Ring(t), Starnheim Aspirant 2/2(t), Swiftfoot Boots, Exemplar of Light 3/3(t), Inspiring Overseer 2/1(t), Angel of Finality 3/4, Herald of War 3/3
  - alternatives: cast Blasphemous Act (6); cast Crucible of Fire (3); cast Orb of Dragonkind (3); cast Unexpected Windfall (3); cast Hazoret's Monument (3); cast Leyline Tyrant (3)

- game 11, turn 57 precombat main phase, Reign of Dragons (main_phase): tapped out for Blasphemous Act while an opponent's board can swing ~6 against my 1 life
  - chose: cast Blasphemous Act; open mana 8; life {"Reign of Dragons":1,"Calling All Angels":38,"Wretched Ranks":0,"Tramplesaurus Rex":33}
  - hand: Utvara Hellkite, Blasphemous Act, Cursed Mirror, Dragonspeaker Shaman, Count on Luck, Taurean Mauler, Dragon Tempest, Sarkhan's Triumph, Thunderbreak Regent, Hazoret's Monument, Tyrant's Familiar, Hellkite Charger
  - boards: Reign of Dragons: - | Calling All Angels: Patchwork Banner(t), Angel of Vitality 2/2(t), Segovian Angel 1/1, Grasp of Fate, Vanguard Seraph 3/3(t), Marble Diamond(t) | Wretched Ranks: - | Tramplesaurus Rex: Sol Ring, Rishkar, Peema Renegade 2/2(t), Fyndhorn Elves 1/1(t), Birds of Paradise 0/1
  - alternatives: cast Blasphemous Act (6); cast Utvara Hellkite (3); cast Cursed Mirror (3); cast Dragonspeaker Shaman (3); cast Count on Luck (3); cast Taurean Mauler (3)

- game 11, turn 57 postcombat main phase, Reign of Dragons (main_phase): tapped out for Blasphemous Act while an opponent's board can swing ~6 against my 1 life
  - chose: cast Blasphemous Act; open mana 8; life {"Reign of Dragons":1,"Calling All Angels":38,"Wretched Ranks":0,"Tramplesaurus Rex":33}
  - hand: Utvara Hellkite, Blasphemous Act, Cursed Mirror, Dragonspeaker Shaman, Count on Luck, Taurean Mauler, Dragon Tempest, Sarkhan's Triumph, Thunderbreak Regent, Hazoret's Monument, Tyrant's Familiar, Hellkite Charger
  - boards: Reign of Dragons: - | Calling All Angels: Patchwork Banner(t), Angel of Vitality 2/2(t), Segovian Angel 1/1, Grasp of Fate, Vanguard Seraph 3/3(t), Marble Diamond(t) | Wretched Ranks: - | Tramplesaurus Rex: Sol Ring, Rishkar, Peema Renegade 2/2(t), Fyndhorn Elves 1/1(t), Birds of Paradise 0/1
  - alternatives: cast Blasphemous Act (6); cast Utvara Hellkite (3); cast Cursed Mirror (3); cast Dragonspeaker Shaman (3); cast Count on Luck (3); cast Taurean Mauler (3)

### self_inflicted_loss (5)

- game 4, turn 26 precombat main phase, Tramplesaurus Rex (outcome): casting cast Collective Resistance cost the caster ~6 of permanents (Commander's Sphere) against ~0 for everyone else
  - chose: cast Collective Resistance; open mana 0; life {"Wretched Ranks":17,"Reign of Dragons":38,"Tramplesaurus Rex":35,"Calling All Angels":0}
  - hand: Collective Resistance, Pugnacious Hammerskull
  - boards: Wretched Ranks: Vengeful Dead, Gravecrawler | Reign of Dragons: Dragonspeaker Shaman, Crucible of Fire, Goldlust Triad, Parapet Thrasher, Draconic Visitor, Nogi, Draco-Zealot | Tramplesaurus Rex: Llanowar Elves, Clifftop Lookout, Surrak and Goreclaw, Challenger Troll, Commander's Sphere | Calling All Angels: -

- game 10, turn 26 precombat main phase, Reign of Dragons (outcome): casting cast Cursed Mirror cost the caster ~7 of permanents (Atsushi, the Blazing Sky) against ~0 for everyone else
  - chose: cast Cursed Mirror; open mana 0; life {"Tramplesaurus Rex":30,"Calling All Angels":34,"Wretched Ranks":39,"Reign of Dragons":36}
  - hand: Mountain, Cursed Mirror
  - boards: Tramplesaurus Rex: Swiftfoot Boots, Paradise Druid | Calling All Angels: Arcane Signet, Sol Ring, Search the Premises | Wretched Ranks: Dissection Tools, Oversold Cemetery | Reign of Dragons: Atsushi, the Blazing Sky

- game 11, turn 15 precombat main phase, Calling All Angels (outcome): casting cast Sunblast Angel cost the caster ~9 of permanents (Giada, Font of Hope) against ~4 for everyone else
  - chose: cast Sunblast Angel; open mana 0; life {"Calling All Angels":42,"Wretched Ranks":33,"Reign of Dragons":37,"Tramplesaurus Rex":40}
  - hand: Sunblast Angel, Destroy Evil, Archangel of Tithes, Seraph of the Sword, Plains
  - boards: Calling All Angels: Giada, Font of Hope, Patchwork Banner | Wretched Ranks: Zombie Token | Reign of Dragons: - | Tramplesaurus Rex: Sol Ring, Thrashing Brontodon

### unused_mana_castable_left (3)

- game 38, turn 59 postcombat main phase, Reign of Dragons (main_phase): ended the turn with 11 mana open while The Elder Dragon War was castable (The Elder Dragon War: a wipe now costs me more (~17) than the table (~0) — I would be behind afterwards)
  - chose: pass this phase; open mana 11; life {"Reign of Dragons":10,"Tramplesaurus Rex":0,"Calling All Angels":0,"Wretched Ranks":10}
  - hand: The Elder Dragon War
  - boards: Reign of Dragons: Dragonstorm Globe, Carnelian Orb of Dragonkind, Dragon Tempest, Dragon Token 5/5(t), Orb of Dragonkind, Sol Ring, Stormscale Scion 4/4(t) | Tramplesaurus Rex: - | Calling All Angels: - | Wretched Ranks: Oversold Cemetery, Cemetery Tampering, Sol Ring, Crown of Gondor, Arcane Signet, Endless Ranks of the Dead
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast The Elder Dragon War (-1)

- game 38, turn 63 postcombat main phase, Reign of Dragons (main_phase): ended the turn with 10 mana open while The Elder Dragon War was castable (The Elder Dragon War: a wipe now costs me more (~21) than the table (~2) — I would be behind afterwards)
  - chose: pass this phase; open mana 10; life {"Reign of Dragons":10,"Tramplesaurus Rex":0,"Calling All Angels":0,"Wretched Ranks":3}
  - hand: The Elder Dragon War
  - boards: Reign of Dragons: Dragonstorm Globe, Carnelian Orb of Dragonkind, Dragon Tempest, Dragon Token 5/5(t), Orb of Dragonkind, Sol Ring, Stormscale Scion 4/4(t), Sarkhan, Dragon Ascendant 2/2 | Tramplesaurus Rex: - | Calling All Angels: - | Wretched Ranks: Oversold Cemetery, Cemetery Tampering, Sol Ring, Crown of Gondor, Arcane Signet, Endless Ranks of the Dead, Undead Butler 1/2
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast The Elder Dragon War (-1)

- game 50, turn 31 postcombat main phase, Wretched Ranks (main_phase): ended the turn with 4 mana open while Fleshbag Marauder was castable (Fleshbag Marauder: a wipe now costs me more (~13) than the table (~0) — I would be behind afterwards)
  - chose: pass this phase; open mana 4; life {"Wretched Ranks":43,"Tramplesaurus Rex":29,"Calling All Angels":48,"Reign of Dragons":40}
  - hand: Fleshbag Marauder
  - boards: Wretched Ranks: Undead Warchief 1/1(t), Gravespawn Sovereign 3/3(t) | Tramplesaurus Rex: - | Calling All Angels: - | Reign of Dragons: -
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Fleshbag Marauder (-1)

### own_wipe_while_ahead (2)

- game 54, turn 17 precombat main phase, Calling All Angels (main_phase): board wipe cast with my creature value 25 against 25 for the whole rest of the table
  - chose: cast Cleansing Nova; open mana 6; life {"Calling All Angels":43,"Tramplesaurus Rex":39,"Wretched Ranks":41,"Reign of Dragons":30}
  - hand: Cleansing Nova, Plains, Plains, Sol Ring, Plains
  - boards: Calling All Angels: Giada, Font of Hope 2/2, Wojek Investigator 2/4, Lyra Dawnbringer 5/5 | Tramplesaurus Rex: Elvish Mystic 1/1(t), Ripjaw Raptor 4/5(t), Gigantosaurus 10/10 | Wretched Ranks: Bad Moon, Ayara, First of Locthwain 2/3 | Reign of Dragons: Arcane Signet
  - alternatives: cast Cleansing Nova (3); cast Sol Ring (3); pass this phase (0); end turn and skip remaining phases (0)

- game 59, turn 35 precombat main phase, Calling All Angels (main_phase): board wipe cast with my creature value 30 against 29 for the whole rest of the table
  - chose: cast Austere Command; open mana 7; life {"Calling All Angels":30,"Wretched Ranks":0,"Reign of Dragons":7,"Tramplesaurus Rex":34}
  - hand: Austere Command, Marble Diamond
  - boards: Calling All Angels: Youthful Valkyrie 1/3, Dazzling Angel 2/3, Norn's Choirmaster 5/4, Archangel of Tithes 3/5, Vanguard Seraph 3/3, Commander's Sphere | Wretched Ranks: - | Reign of Dragons: Clue, Rapacious Dragon 3/3(t), Dragon Tempest, Skyline Despot 5/5(t), Dragonhawk, Fate's Tempest 5/5(t) | Tramplesaurus Rex: Unnatural Growth, Swiftfoot Boots, Managorger Hydra 1/1
  - alternatives: cast Austere Command (3); cast Marble Diamond (3); pass this phase (0); end turn and skip remaining phases (0)

### spell_no_target_or_effect (1)

- game 12, turn 58 precombat main phase, Wretched Ranks (main_phase): targeted creature removal cast with no opposing creature: it can only hit my own
  - chose: cast Go for the Throat; open mana 9; life {"Wretched Ranks":13,"Reign of Dragons":0,"Tramplesaurus Rex":21,"Calling All Angels":0}
  - hand: Go for the Throat
  - boards: Wretched Ranks: Phyrexian Reclamation, Cemetery Tampering, Lord of the Accursed 2/3, Lashwrithe, Grave Titan 6/6, Zombie Token 2/2, Zombie Token 2/2, Disciple of Griselbrand 1/1 | Reign of Dragons: - | Tramplesaurus Rex: Colossal Majesty | Calling All Angels: -
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Go for the Throat [vetoed] (-47)

### repeated_activation (1)

- game 33, turn 40 precombat main phase, Wretched Ranks (main_phase): cast Gravecrawler from the graveyard chosen 3 times in the same phase
  - chose: cast Gravecrawler from the graveyard; open mana 3; life {"Wretched Ranks":33,"Reign of Dragons":28,"Tramplesaurus Rex":0,"Calling All Angels":38}
  - hand: -
  - boards: Wretched Ranks: Cemetery Tampering, Grave Titan 6/6, Zombie Token 2/2, Zombie Token 2/2, Bonehoard, Undead Augur 2/2 | Reign of Dragons: Sarkhan, Dragon Ascendant 2/2(t), Basilisk Collar, Swiftfoot Boots | Tramplesaurus Rex: - | Calling All Angels: Always Watching, Clue, Court of Grace, Mind Stone, Dazzling Angel 2/3
  - alternatives: cast Gravecrawler from the graveyard (3); pass this phase (0); end turn and skip remaining phases (0)

## Engine gaps (not agent mistakes): spells cast that resolved with no modelled effect

- Mana Geyser: 14
