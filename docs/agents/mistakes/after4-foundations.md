# Agent mistake report — after4-foundations

Pool `foundations`, 120 games, seeds 1000..1119, play guards on. Heuristic brain on every seat.

## Health

- Finished with a winner: 120/120 (100.0%); turn-cap 0, timeout 0, crash 0
- Average turns per seat: 11.4; audit violations: 0; avg wall clock 792 ms/game
- Winner spread: Wretched Ranks 18, Calling All Angels 53, Reign of Dragons 15, Tramplesaurus Rex 34
- Decisions: 25303; pass/end-turn share 40.6%; by action: play_land 3558, pass_priority 10263, cast_spell 4938, cast_commander 341, attack 5570, block 633

## Flags by category

| Category | Flags | Games hit | Flags/game | Top cards |
|---|---:|---:|---:|---|
| pointless_sacrifice | 0 | 0 | 0.00 |  |
| removal_on_low_threat | 0 | 0 | 0.00 |  |
| idle_protection_spell | 0 | 0 | 0.00 |  |
| combat_spell_outside_combat | 0 | 0 | 0.00 |  |
| declined_free_attack | 0 | 0 | 0.00 |  |
| unused_mana_castable_left | 4 | 4 | 0.03 | Fleshbag Marauder (2), The Elder Dragon War (1), Whiptongue Hydra (1) |
| missed_land_drop | 0 | 0 | 0.00 |  |
| spell_no_target_or_effect | 0 | 0 | 0.00 |  |
| own_wipe_while_ahead | 4 | 4 | 0.03 | Cleansing Nova (2), Mutilate (1), Austere Command (1) |
| self_inflicted_loss | 5 | 4 | 0.04 | Giada, Font of Hope (1), Lord of the Undead (1), Cryptbreaker (1), Sarkhan the Masterless (1) |
| tapped_out_into_lethal | 18 | 12 | 0.15 | Blasphemous Act (6), Dissection Tools (2), Surrak, the Hunt Caller (1), Hulking Raptor (1) |
| repeated_activation | 2 | 2 | 0.02 | Gravecrawler from the graveyard (2) |
| suicide_attack | 5 | 5 | 0.04 | Lathliss, Dragon Queen (2), Loot, Exuberant Explorer (1), Fleshbag Marauder (1), Dragonhawk, Fate's Tempest (1) |
| pointless_block | 5 | 5 | 0.04 | Speaker of the Heavens (5), Llanowar Tribe (1), Ayara, First of Locthwain (1), Garruk's Packleader (1) |
| self_lethal_life_cost | 0 | 0 | 0.00 |  |
| sequencing_wipe_after_creature | 1 | 1 | 0.01 | Blasphemous Act (1), Dragon Token (1) |

## Examples

### tapped_out_into_lethal (18)

- game 0, turn 34 precombat main phase, Reign of Dragons (main_phase): tapped out for Blasphemous Act while an opponent's board can swing ~42 against my 16 life
  - chose: cast Blasphemous Act; open mana 5; life {"Reign of Dragons":16,"Wretched Ranks":44,"Tramplesaurus Rex":39,"Calling All Angels":33}
  - hand: Blasphemous Act, Unexpected Windfall, Hazoret's Monument, Leyline Tyrant, Breaching Dragonstorm
  - boards: Reign of Dragons: Orb of Dragonkind, Sol Ring, Crucible of Fire | Wretched Ranks: Zombie Token 2/2, Zombie Token 2/2, Zombie Token 2/2, Zombie Token 2/2, Zombie Token 2/2, Zombie Token 2/2, Zombie Token 2/2, Zombie Token 2/2 | Tramplesaurus Rex: Unnatural Growth, Swiftfoot Boots, Garruk's Uprising | Calling All Angels: Sol Ring(t), Swiftfoot Boots, Arcane Signet
  - alternatives: cast Blasphemous Act (6); cast Unexpected Windfall (3); cast Hazoret's Monument (3); cast Leyline Tyrant (3); cast Breaching Dragonstorm (3); cast commander Lathliss, Dragon Queen (3)

- game 0, turn 34 postcombat main phase, Reign of Dragons (main_phase): tapped out for Blasphemous Act while an opponent's board can swing ~42 against my 16 life
  - chose: cast Blasphemous Act; open mana 5; life {"Reign of Dragons":16,"Wretched Ranks":44,"Tramplesaurus Rex":39,"Calling All Angels":33}
  - hand: Blasphemous Act, Unexpected Windfall, Hazoret's Monument, Leyline Tyrant, Breaching Dragonstorm
  - boards: Reign of Dragons: Orb of Dragonkind, Sol Ring, Crucible of Fire | Wretched Ranks: Zombie Token 2/2, Zombie Token 2/2, Zombie Token 2/2, Zombie Token 2/2, Zombie Token 2/2, Zombie Token 2/2, Zombie Token 2/2, Zombie Token 2/2 | Tramplesaurus Rex: Unnatural Growth, Swiftfoot Boots, Garruk's Uprising | Calling All Angels: Sol Ring(t), Swiftfoot Boots, Arcane Signet
  - alternatives: cast Blasphemous Act (6); cast Unexpected Windfall (3); cast Hazoret's Monument (3); cast Leyline Tyrant (3); cast Breaching Dragonstorm (3); cast commander Lathliss, Dragon Queen (3)

- game 0, turn 47 precombat main phase, Tramplesaurus Rex (main_phase): tapped out for Surrak, the Hunt Caller while an opponent's board can swing ~34 against my 5 life
  - chose: cast Surrak, the Hunt Caller; open mana 4; life {"Tramplesaurus Rex":5,"Wretched Ranks":17,"Reign of Dragons":0,"Calling All Angels":0}
  - hand: Forest, Tranquil Thicket, Rishkar, Peema Renegade, Verdant Sun's Avatar, Loot, Exuberant Explorer, Tamiyo's Safekeeping, Forest, Ezuri's Predation, Elemental Bond, Rhonas's Monument, Surrak, the Hunt Caller, Beast Within, Hulking Raptor, Forest
  - boards: Tramplesaurus Rex: Unnatural Growth, Swiftfoot Boots, Garruk's Uprising, Clifftop Lookout 1/2, Steel Leaf Champion 5/4, Colossal Majesty, Goreclaw, Terror of Qal Sisma 4/3, Regal Imperiosaur 5/4 | Wretched Ranks: Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t) | Reign of Dragons: - | Calling All Angels: -
  - alternatives: cast Surrak, the Hunt Caller (6); cast Rishkar, Peema Renegade (3); cast Loot, Exuberant Explorer (3); cast Elemental Bond (3); cast Rhonas's Monument (3); cast Beast Within (3)

### self_inflicted_loss (5)

- game 11, turn 15 precombat main phase, Calling All Angels (outcome): casting cast Sunblast Angel cost the caster ~9 of permanents (Giada, Font of Hope) against ~4 for everyone else
  - chose: cast Sunblast Angel; open mana 0; life {"Calling All Angels":42,"Wretched Ranks":34,"Reign of Dragons":40,"Tramplesaurus Rex":38}
  - hand: Sunblast Angel, Destroy Evil, Archangel of Tithes, Seraph of the Sword, Plains
  - boards: Calling All Angels: Speaker of the Heavens, Giada, Font of Hope, Patchwork Banner | Wretched Ranks: Headless Rider | Reign of Dragons: Dragonmaster Outcast, Dragonlord's Servant | Tramplesaurus Rex: Sol Ring, Thrashing Brontodon

- game 35, turn 26 precombat main phase, Wretched Ranks (outcome): casting cast Mutilate cost the caster ~7 of permanents (Lord of the Undead, Cryptbreaker) against ~5 for everyone else
  - chose: cast Mutilate; open mana 0; life {"Calling All Angels":41,"Wretched Ranks":33,"Reign of Dragons":45,"Tramplesaurus Rex":45}
  - hand: Necrotic Hex, Mutilate, Phyrexian Arena
  - boards: Calling All Angels: Arcane Signet, Angelic Sleuth | Wretched Ranks: Endless Ranks of the Dead, Lord of the Undead, Cryptbreaker | Reign of Dragons: Fire Diamond, Dragonstorm Globe, Outpost Siege | Tramplesaurus Rex: -

- game 35, turn 75 precombat main phase, Reign of Dragons (outcome): casting cast Magmaquake (X=9) cost the caster ~7 of permanents (Sarkhan the Masterless) against ~0 for everyone else
  - chose: cast Magmaquake (X=9); open mana 0; life {"Calling All Angels":23,"Wretched Ranks":0,"Reign of Dragons":22,"Tramplesaurus Rex":0}
  - hand: Magmaquake
  - boards: Calling All Angels: Arcane Signet, Marble Diamond, Mind Stone, Sol Ring, Vanquisher's Banner | Wretched Ranks: - | Reign of Dragons: Fire Diamond, Dragonstorm Globe, Outpost Siege, Sarkhan the Masterless, Hazoret's Monument, Orb of Dragonkind, Commander's Sphere | Tramplesaurus Rex: -

### suicide_attack (5)

- game 30, turn 38 declare attackers step, Tramplesaurus Rex (declare_attackers): Loot, Exuberant Explorer attacks into Lathliss, Dragon Queen, which can block and kill it without dying (1 attacker(s) vs 1 such blocker(s))
  - chose: attack Sarkhan the Masterless (Reign of Dragons's planeswalker, 5 loyalty) with Loot, Exuberant Explorer; open mana 1; life {"Tramplesaurus Rex":26,"Calling All Angels":45,"Wretched Ranks":0,"Reign of Dragons":33}
  - hand: Llanowar Tribe, Ram Through
  - boards: Tramplesaurus Rex: Loot, Exuberant Explorer 1/4, Tangleweave Armor | Calling All Angels: Patchwork Banner(t), Thraben Watcher 2/2, Firemane Commando 4/3 | Wretched Ranks: - | Reign of Dragons: Sarkhan the Masterless, Orb of Dragonkind, Terror of Mount Velus 5/5(t), Arcane Signet, Lathliss, Dragon Queen 6/6
  - alternatives: attack Sarkhan the Masterless (Reign of Dragons's planeswalker, 5 loyalty) with Loot, Exuberant Explorer (0); declare no attackers (0); attack Reign of Dragons with Loot, Exuberant Explorer [vetoed] (-50); attack Calling All Angels with Loot, Exuberant Explorer [vetoed] (-52)

- game 35, turn 34 declare attackers step, Wretched Ranks (declare_attackers): Fleshbag Marauder attacks into Dragonhawk, Fate's Tempest, which can block and kill it without dying (1 attacker(s) vs 1 such blocker(s))
  - chose: attack Sarkhan the Masterless (Reign of Dragons's planeswalker, 5 loyalty) with Fleshbag Marauder; open mana 0; life {"Wretched Ranks":33,"Calling All Angels":41,"Reign of Dragons":45,"Tramplesaurus Rex":45}
  - hand: Necrotic Hex
  - boards: Wretched Ranks: Endless Ranks of the Dead, Phyrexian Arena, Fleshbag Marauder 3/1, Arcane Signet(t), Ghoulcaller Gisa 3/4 | Calling All Angels: Arcane Signet(t), Marble Diamond(t), Emeria Shepherd 4/4 | Reign of Dragons: Fire Diamond(t), Dragonstorm Globe(t), Outpost Siege, Sarkhan the Masterless, Dragonhawk, Fate's Tempest 5/5 | Tramplesaurus Rex: Dungrove Elder */*, Terrian, World Tyrant 9/7
  - alternatives: attack Sarkhan the Masterless (Reign of Dragons's planeswalker, 5 loyalty) with Fleshbag Marauder (0); declare no attackers (0); attack Calling All Angels with Fleshbag Marauder [vetoed] (-48); attack Reign of Dragons with Fleshbag Marauder [vetoed] (-50); attack Tramplesaurus Rex with Fleshbag Marauder [vetoed] (-51)

- game 36, turn 32 declare attackers step, Wretched Ranks (declare_attackers): Gray Merchant of Asphodel attacks into Atsushi, the Blazing Sky, which can block and kill it without dying (1 attacker(s) vs 1 such blocker(s))
  - chose: attack Sarkhan the Masterless (Reign of Dragons's planeswalker, 5 loyalty) with Gray Merchant of Asphodel; open mana 0; life {"Wretched Ranks":24,"Reign of Dragons":32,"Tramplesaurus Rex":44,"Calling All Angels":33}
  - hand: Cemetery Recruitment, Bonehoard
  - boards: Wretched Ranks: Noxious Ghoul 3/3(t), Gray Merchant of Asphodel 2/4, Umbral Collar Zealot 3/2(t), Kalitas, Traitor of Ghet 3/4, Crown of Gondor, Gravecrawler 2/1 | Reign of Dragons: Arcane Signet(t), Basilisk Collar, Dragonstorm Globe, Sarkhan the Masterless, Thundermane Dragon 4/4(t), Atsushi, the Blazing Sky 4/4 | Tramplesaurus Rex: Verdant Sun's Avatar 5/5(t), Beast Whisperer 2/3 | Calling All Angels: Patchwork Banner(t), Vanquisher's Banner, Metropolis Reformer 2/3, Sol Ring(t), Reya Dawnbringer 4/6
  - alternatives: attack Sarkhan the Masterless (Reign of Dragons's planeswalker, 5 loyalty) with Gray Merchant of Asphodel (1); attack Tramplesaurus Rex with Gray Merchant of Asphodel (1); declare no attackers (0); attack Reign of Dragons with Gray Merchant of Asphodel [vetoed] (-49); attack Calling All Angels with Gray Merchant of Asphodel [vetoed] (-52)

### pointless_block (5)

- game 64, turn 47 declare blockers step, Calling All Angels (declare_blockers): Speaker of the Heavens blocks Llanowar Tribe and dies without killing it, to save only 3 damage (life 48)
  - chose: block Llanowar Tribe with Speaker of the Heavens; open mana 7; life {"Calling All Angels":48,"Wretched Ranks":0,"Reign of Dragons":0,"Tramplesaurus Rex":1}
  - hand: -
  - boards: Calling All Angels: Righteous Valkyrie 2/4(t), Sol Ring, Archangel of Tithes 3/5(t), Search the Premises, Mind Stone, Spirit Token 1/1(t), Spirit Token 1/1(t), Grasp of Fate | Wretched Ranks: - | Reign of Dragons: - | Tramplesaurus Rex: Colossal Majesty, Llanowar Tribe 3/3(t), Clue, Rhonas's Monument, Beast Whisperer 2/3(t), Ghalta, Primal Hunger 12/12(t)
  - alternatives: block Llanowar Tribe with Speaker of the Heavens (0); declare no blockers (0)

- game 74, turn 21 declare blockers step, Calling All Angels (declare_blockers): Speaker of the Heavens blocks Ayara, First of Locthwain and dies without killing it, to save only 2 damage (life 43)
  - chose: block Ayara, First of Locthwain with Speaker of the Heavens; open mana 1; life {"Calling All Angels":43,"Tramplesaurus Rex":32,"Wretched Ranks":42,"Reign of Dragons":16}
  - hand: Angelic Destiny, Search the Premises, Herald of Eternal Dawn
  - boards: Calling All Angels: Giada, Font of Hope 2/2, Tome of Legends, Speaker of the Heavens 1/1, Righteous Valkyrie 2/4(t) | Tramplesaurus Rex: Llanowar Elves 1/1(t) | Wretched Ranks: Gravecrawler 2/1(t), Disciple of Griselbrand 1/1(t), Undead Augur 2/2(t), Ayara, First of Locthwain 2/3(t), Oversold Cemetery, Ghoulcaller Gisa 3/4 | Reign of Dragons: Goldlust Triad 4/3, Sol Ring
  - alternatives: block Ayara, First of Locthwain with Speaker of the Heavens (0); declare no blockers (0); block Ayara, First of Locthwain with Giada, Font of Hope (-1)

- game 78, turn 30 declare blockers step, Calling All Angels (declare_blockers): Speaker of the Heavens blocks Garruk's Packleader and dies without killing it, to save only 4 damage (life 43)
  - chose: block Garruk's Packleader with Speaker of the Heavens; open mana 0; life {"Calling All Angels":43,"Tramplesaurus Rex":26,"Wretched Ranks":0,"Reign of Dragons":37}
  - hand: Angel of the Ruins
  - boards: Calling All Angels: Speaker of the Heavens 1/1, Seraph of the Sword 3/3, Marble Diamond(t) | Tramplesaurus Rex: Elder Gargaroth 6/6, Whiptongue Hydra 4/4(t), Swiftfoot Boots, Garruk's Packleader 4/4(t), Ghalta, Primal Hunger 12/12 | Wretched Ranks: - | Reign of Dragons: Dragonspeaker Shaman 2/2, Scourge of the Throne 5/5, Sarkhan, Dragon Ascendant 2/2, Treasure, Lathliss, Dragon Queen 6/6
  - alternatives: block Garruk's Packleader with Speaker of the Heavens (0); declare no blockers (0); block Garruk's Packleader with Seraph of the Sword (-1)

### unused_mana_castable_left (4)

- game 1, turn 29 postcombat main phase, Reign of Dragons (main_phase): ended the turn with 6 mana open while The Elder Dragon War was castable (The Elder Dragon War: a wipe now costs me more (~23) than the table (~4) — I would be behind afterwards)
  - chose: pass this phase; open mana 6; life {"Reign of Dragons":40,"Tramplesaurus Rex":35,"Calling All Angels":35,"Wretched Ranks":15}
  - hand: The Elder Dragon War
  - boards: Reign of Dragons: Sol Ring, Arcane Signet, Hazoret's Monument, Orb of Dragonkind, Sarkhan the Masterless, Drakuseth, Maw of Flames 7/7(t), Lathliss, Dragon Queen 6/6(t) | Tramplesaurus Rex: - | Calling All Angels: Patchwork Banner, Swiftfoot Boots, Tome of Legends, Commander's Sphere | Wretched Ranks: Arcane Signet(t), Patchwork Banner(t), Charcoal Diamond(t), Phyrexian Arena, Disciple of Bolas 2/1
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast The Elder Dragon War (-1)

- game 38, turn 38 postcombat main phase, Wretched Ranks (main_phase): ended the turn with 4 mana open while Fleshbag Marauder was castable (Fleshbag Marauder: a wipe now costs me more (~29) than the table (~22) — I would be behind afterwards)
  - chose: pass this phase; open mana 4; life {"Wretched Ranks":36,"Tramplesaurus Rex":0,"Calling All Angels":12,"Reign of Dragons":21}
  - hand: Fleshbag Marauder
  - boards: Wretched Ranks: Oversold Cemetery, Cemetery Tampering, Zombie Token 2/2(t), Sol Ring, Vengeful Dead 3/2(t), Zombie Token 2/2(t), Crown of Gondor, Zombie Token 2/2(t) | Tramplesaurus Rex: - | Calling All Angels: Endless Atlas, Marble Diamond, Thraben Watcher 2/2 | Reign of Dragons: Dragonstorm Globe, Carnelian Orb of Dragonkind, Dragon Tempest, Lathliss, Dragon Queen 6/6(t)
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Fleshbag Marauder (-1)

- game 50, turn 31 postcombat main phase, Wretched Ranks (main_phase): ended the turn with 4 mana open while Fleshbag Marauder was castable (Fleshbag Marauder: a wipe now costs me more (~13) than the table (~11) — I would be behind afterwards)
  - chose: pass this phase; open mana 4; life {"Wretched Ranks":42,"Tramplesaurus Rex":29,"Calling All Angels":44,"Reign of Dragons":40}
  - hand: Fleshbag Marauder
  - boards: Wretched Ranks: Undead Warchief 1/1(t), Gravespawn Sovereign 3/3(t) | Tramplesaurus Rex: - | Calling All Angels: Merchant of Truth 2/5(t), Sol Ring, Youthful Valkyrie 1/3 | Reign of Dragons: -
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Fleshbag Marauder (-1)

### own_wipe_while_ahead (4)

- game 5, turn 26 precombat main phase, Calling All Angels (main_phase): board wipe cast with my creature value 11 against 10 for the whole rest of the table
  - chose: cast Cleansing Nova; open mana 6; life {"Calling All Angels":43,"Reign of Dragons":6,"Tramplesaurus Rex":39,"Wretched Ranks":37}
  - hand: Cleansing Nova, Speaker of the Heavens
  - boards: Calling All Angels: Arcane Signet, Inspiring Overseer 2/1, Dazzling Angel 2/3, Grasp of Fate, Endless Atlas | Reign of Dragons: Swiftfoot Boots, Clue | Tramplesaurus Rex: Clifftop Lookout 1/2(t), Hulking Raptor 5/3(t), Sol Ring(t), Swiftfoot Boots, Commander's Sphere(t), Rhonas's Monument, Beast Token 3/3 | Wretched Ranks: Phyrexian Arena, Patchwork Banner
  - alternatives: cast Cleansing Nova (3); cast Speaker of the Heavens (3); pass this phase (0); end turn and skip remaining phases (0)

- game 35, turn 26 precombat main phase, Wretched Ranks (main_phase): board wipe cast with my creature value 7 against 5 for the whole rest of the table
  - chose: cast Mutilate; open mana 6; life {"Wretched Ranks":33,"Calling All Angels":41,"Reign of Dragons":45,"Tramplesaurus Rex":45}
  - hand: Necrotic Hex, Mutilate, Phyrexian Arena
  - boards: Wretched Ranks: Endless Ranks of the Dead, Lord of the Undead 2/2, Cryptbreaker 1/1 | Calling All Angels: Arcane Signet(t), Angelic Sleuth 2/3 | Reign of Dragons: Fire Diamond(t), Dragonstorm Globe(t), Outpost Siege | Tramplesaurus Rex: -
  - alternatives: cast Mutilate (3); cast Phyrexian Arena (3); cast commander Ghoulcaller Gisa (3); pass this phase (0); end turn and skip remaining phases (0)

- game 54, turn 17 precombat main phase, Calling All Angels (main_phase): board wipe cast with my creature value 25 against 25 for the whole rest of the table
  - chose: cast Cleansing Nova; open mana 6; life {"Calling All Angels":43,"Tramplesaurus Rex":39,"Wretched Ranks":41,"Reign of Dragons":30}
  - hand: Cleansing Nova, Plains, Plains, Sol Ring, Plains
  - boards: Calling All Angels: Giada, Font of Hope 2/2, Wojek Investigator 2/4, Lyra Dawnbringer 5/5 | Tramplesaurus Rex: Elvish Mystic 1/1(t), Ripjaw Raptor 4/5(t), Gigantosaurus 10/10 | Wretched Ranks: Bad Moon, Ayara, First of Locthwain 2/3 | Reign of Dragons: Arcane Signet
  - alternatives: cast Cleansing Nova (3); cast Sol Ring (3); pass this phase (0); end turn and skip remaining phases (0)

### repeated_activation (2)

- game 33, turn 40 precombat main phase, Wretched Ranks (main_phase): cast Gravecrawler from the graveyard chosen 3 times in the same phase
  - chose: cast Gravecrawler from the graveyard; open mana 3; life {"Wretched Ranks":33,"Reign of Dragons":38,"Tramplesaurus Rex":0,"Calling All Angels":38}
  - hand: -
  - boards: Wretched Ranks: Cemetery Tampering, Grave Titan 6/6, Zombie Token 2/2, Zombie Token 2/2, Bonehoard, Undead Augur 2/2 | Reign of Dragons: Sarkhan, Dragon Ascendant 2/2(t), Basilisk Collar, Swiftfoot Boots | Tramplesaurus Rex: - | Calling All Angels: Always Watching, Clue, Court of Grace, Mind Stone, Dazzling Angel 2/3
  - alternatives: cast Gravecrawler from the graveyard (3); pass this phase (0); end turn and skip remaining phases (0)

- game 64, turn 29 precombat main phase, Wretched Ranks (main_phase): cast Gravecrawler from the graveyard chosen 3 times in the same phase
  - chose: cast Gravecrawler from the graveyard; open mana 1; life {"Wretched Ranks":5,"Reign of Dragons":0,"Tramplesaurus Rex":32,"Calling All Angels":51}
  - hand: Barren Moor
  - boards: Wretched Ranks: Sol Ring(t), Dissection Tools, Undead Butler 1/2, Liliana's Mastery, Zombie Token 2/2, Zombie Token 2/2 | Reign of Dragons: - | Tramplesaurus Rex: Tangleweave Armor, Colossal Majesty, Llanowar Tribe 3/3, Clue | Calling All Angels: Righteous Valkyrie 2/4(t), Sol Ring, Archangel of Tithes 3/5(t), Metropolis Reformer 2/3, Search the Premises, Mind Stone, Spirit Token 1/1(t), Spirit Token 1/1(t)
  - alternatives: cast Gravecrawler from the graveyard (3); pass this phase (0); end turn and skip remaining phases (0)

### sequencing_wipe_after_creature (1)

- game 46, turn 29 precombat main phase, Reign of Dragons (main_phase): Blasphemous Act wipes my own Dragon Token, which entered this turn
  - chose: cast Blasphemous Act; open mana 9; life {"Reign of Dragons":30,"Tramplesaurus Rex":38,"Calling All Angels":41,"Wretched Ranks":9}
  - hand: Commander's Sphere, Blasphemous Act, Scourge of Valkas, Atsushi, the Blazing Sky, Dragonhawk, Fate's Tempest, Drakuseth, Maw of Flames, Dragonmaster Outcast
  - boards: Reign of Dragons: Orb of Dragonkind, Treasure, Treasure, Treasure, Treasure, Dragon Token 6/6 | Tramplesaurus Rex: Yeva, Nature's Herald 4/4(t), Whiptongue Hydra 4/4(t), Surrak, the Hunt Caller 5/4, Ghalta, Primal Hunger 12/12 | Calling All Angels: Marble Diamond, Mind Stone, Exemplar of Light 3/3(t), Angelic Sleuth 2/3(t), Starnheim Aspirant 2/2 | Wretched Ranks: Phyrexian Reclamation, Fleshbag Marauder 3/1(t), Crown of Gondor, Patchwork Banner(t), Death Baron 2/2, Wight of Precinct Six 1/1, Disciple of Griselbrand 1/1
  - alternatives: cast Blasphemous Act (6); cast Commander's Sphere (3); pass this phase (0); end turn and skip remaining phases (0); cast Scourge of Valkas [vetoed] (-54); cast Atsushi, the Blazing Sky [vetoed] (-54)

## Engine gaps (not agent mistakes): spells cast that resolved with no modelled effect

- Mana Geyser: 22
