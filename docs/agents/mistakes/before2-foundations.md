# Agent mistake report — before2-foundations

Pool `foundations`, 120 games, seeds 1000..1119, play guards on. Heuristic brain on every seat.

## Health

- Finished with a winner: 120/120 (100.0%); turn-cap 0, timeout 0, crash 0
- Average turns per seat: 11.2; audit violations: 0; avg wall clock 735 ms/game
- Winner spread: Wretched Ranks 19, Calling All Angels 53, Tramplesaurus Rex 36, Reign of Dragons 12
- Decisions: 25085; pass/end-turn share 40.3%; by action: play_land 3537, pass_priority 10103, cast_spell 4915, cast_commander 339, attack 5512, block 679

## Flags by category

| Category | Flags | Games hit | Flags/game | Top cards |
|---|---:|---:|---:|---|
| pointless_sacrifice | 0 | 0 | 0.00 |  |
| removal_on_low_threat | 0 | 0 | 0.00 |  |
| idle_protection_spell | 0 | 0 | 0.00 |  |
| combat_spell_outside_combat | 0 | 0 | 0.00 |  |
| declined_free_attack | 0 | 0 | 0.00 |  |
| unused_mana_castable_left | 3 | 3 | 0.03 | The Elder Dragon War (1), Fleshbag Marauder (1), Whiptongue Hydra (1) |
| missed_land_drop | 0 | 0 | 0.00 |  |
| spell_no_target_or_effect | 0 | 0 | 0.00 |  |
| own_wipe_while_ahead | 3 | 3 | 0.03 | Mutilate (1), Cleansing Nova (1), Day of Judgment (1) |
| self_inflicted_loss | 5 | 5 | 0.04 | Giada, Font of Hope (1), Lord of the Undead (1), Cryptbreaker (1), Kalitas, Traitor of Ghet (1) |
| tapped_out_into_lethal | 20 | 14 | 0.17 | Blasphemous Act (8), Ezuri's Predation (2), Surrak, the Hunt Caller (1), Hulking Raptor (1) |
| repeated_activation | 2 | 2 | 0.02 | Gravecrawler from the graveyard (2) |
| suicide_attack | 50 | 39 | 0.42 | Firemane Commando (5), Magda, the Hoardmaster (5), Sarkhan, Dragon Ascendant (5), Managorger Hydra (5) |
| pointless_block | 3 | 3 | 0.03 | Speaker of the Heavens (3), Llanowar Tribe (1), Ayara, First of Locthwain (1), Beast Token (1) |
| self_lethal_life_cost | 0 | 0 | 0.00 |  |

## Examples

### suicide_attack (50)

- game 0, turn 43 declare attackers step, Tramplesaurus Rex (declare_attackers): Clifftop Lookout attacks into Zombie Token, Diregraf Colossus, Ghoulcaller Gisa, which can block and kill it without dying (2 attacker(s) vs 3 such blocker(s))
  - chose: attack Wretched Ranks with Clifftop Lookout; open mana 1; life {"Tramplesaurus Rex":47,"Wretched Ranks":29,"Reign of Dragons":0,"Calling All Angels":0}
  - hand: Forest, Forest, Rishkar's Expertise, Tranquil Thicket, Goreclaw, Terror of Qal Sisma
  - boards: Tramplesaurus Rex: Unnatural Growth, Swiftfoot Boots, Garruk's Uprising, Clifftop Lookout 1/2, Steel Leaf Champion 5/4(t), Colossal Majesty, Ghalta, Primal Hunger 12/12 | Wretched Ranks: Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t) | Reign of Dragons: - | Calling All Angels: -
  - alternatives: attack Wretched Ranks with Clifftop Lookout (0); declare no attackers (0)

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

### tapped_out_into_lethal (20)

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

- game 0, turn 47 precombat main phase, Tramplesaurus Rex (main_phase): tapped out for Surrak, the Hunt Caller while an opponent's board can swing ~32 against my 5 life
  - chose: cast Surrak, the Hunt Caller; open mana 4; life {"Tramplesaurus Rex":5,"Wretched Ranks":17,"Reign of Dragons":0,"Calling All Angels":0}
  - hand: Forest, Tranquil Thicket, Rishkar, Peema Renegade, Verdant Sun's Avatar, Loot, Exuberant Explorer, Tamiyo's Safekeeping, Forest, Ezuri's Predation, Elemental Bond, Rhonas's Monument, Surrak, the Hunt Caller, Beast Within, Hulking Raptor, Forest
  - boards: Tramplesaurus Rex: Unnatural Growth, Swiftfoot Boots, Garruk's Uprising, Steel Leaf Champion 5/4, Colossal Majesty, Goreclaw, Terror of Qal Sisma 4/3, Regal Imperiosaur 5/4 | Wretched Ranks: Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t) | Reign of Dragons: - | Calling All Angels: -
  - alternatives: cast Surrak, the Hunt Caller (5); cast Rishkar, Peema Renegade (3); cast Loot, Exuberant Explorer (3); cast Elemental Bond (3); cast Rhonas's Monument (3); cast Beast Within (3)

### self_inflicted_loss (5)

- game 11, turn 15 precombat main phase, Calling All Angels (outcome): casting cast Sunblast Angel cost the caster ~9 of permanents (Giada, Font of Hope) against ~4 for everyone else
  - chose: cast Sunblast Angel; open mana 0; life {"Calling All Angels":42,"Wretched Ranks":33,"Reign of Dragons":37,"Tramplesaurus Rex":40}
  - hand: Sunblast Angel, Destroy Evil, Archangel of Tithes, Seraph of the Sword, Plains
  - boards: Calling All Angels: Giada, Font of Hope, Patchwork Banner | Wretched Ranks: Zombie Token | Reign of Dragons: - | Tramplesaurus Rex: Sol Ring, Thrashing Brontodon

- game 35, turn 26 precombat main phase, Wretched Ranks (outcome): casting cast Mutilate cost the caster ~7 of permanents (Lord of the Undead, Cryptbreaker) against ~5 for everyone else
  - chose: cast Mutilate; open mana 0; life {"Calling All Angels":41,"Wretched Ranks":33,"Reign of Dragons":45,"Tramplesaurus Rex":45}
  - hand: Necrotic Hex, Mutilate, Phyrexian Arena
  - boards: Calling All Angels: Arcane Signet, Angelic Sleuth | Wretched Ranks: Endless Ranks of the Dead, Lord of the Undead, Cryptbreaker | Reign of Dragons: Fire Diamond, Dragonstorm Globe, Outpost Siege | Tramplesaurus Rex: -

- game 38, turn 26 precombat main phase, Wretched Ranks (outcome): casting cast Headless Rider cost the caster ~6 of permanents (Kalitas, Traitor of Ghet) against ~5 for everyone else
  - chose: cast Headless Rider; open mana 0; life {"Tramplesaurus Rex":24,"Calling All Angels":40,"Wretched Ranks":38,"Reign of Dragons":40}
  - hand: Headless Rider, Crown of Gondor, Gravespawn Sovereign
  - boards: Tramplesaurus Rex: Clue, Challenger Troll | Calling All Angels: Endless Atlas, Angel of Vitality | Wretched Ranks: Oversold Cemetery, Cemetery Tampering, Kalitas, Traitor of Ghet, Zombie Token, Noxious Ghoul, Zombie Token, Sol Ring, Vengeful Dead | Reign of Dragons: Nogi, Draco-Zealot, Dragonstorm Globe

### unused_mana_castable_left (3)

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

- game 104, turn 37 postcombat main phase, Tramplesaurus Rex (main_phase): ended the turn with 7 mana open while Whiptongue Hydra was castable (Whiptongue Hydra: a wipe now costs me more (~42) than the table (~27) — I would be behind afterwards)
  - chose: pass this phase; open mana 7; life {"Tramplesaurus Rex":22,"Wretched Ranks":0,"Reign of Dragons":0,"Calling All Angels":15}
  - hand: Whiptongue Hydra
  - boards: Tramplesaurus Rex: Surrak, the Hunt Caller 5/4(t), Garruk's Uprising, Arasta of the Endless Web 3/5(t), Beast Token 3/3(t), Elvish Mystic 1/1(t), Ghalta, Primal Hunger 12/12(t), Fyndhorn Elves 1/1(t), Birds of Paradise 0/1(t) | Wretched Ranks: - | Reign of Dragons: - | Calling All Angels: Angelic Field Marshal 3/3(t), Swiftfoot Boots, Angel of Finality 3/4(t), Herald of War 3/3(t), Angelic Sleuth 2/3(t), Marble Diamond
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Whiptongue Hydra (-1)

### own_wipe_while_ahead (3)

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

- game 72, turn 34 precombat main phase, Calling All Angels (main_phase): board wipe cast with my creature value 22 against 22 for the whole rest of the table
  - chose: cast Day of Judgment; open mana 9; life {"Calling All Angels":26,"Wretched Ranks":0,"Reign of Dragons":0,"Tramplesaurus Rex":22}
  - hand: Day of Judgment
  - boards: Calling All Angels: Angel of Finality 3/4, Herald of Eternal Dawn 6/6, Firemane Commando 4/3, Patchwork Banner | Wretched Ranks: - | Reign of Dragons: - | Tramplesaurus Rex: Fyndhorn Elves 1/1(t), Tangleweave Armor, Phyrexian Germ Token 0/0(t), Whisperer of the Wilds 0/2(t), Garruk's Packleader 4/4(t), Carnage Tyrant 7/6
  - alternatives: cast Day of Judgment (3); pass this phase (0); end turn and skip remaining phases (0)

### pointless_block (3)

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

- game 106, turn 27 declare blockers step, Calling All Angels (declare_blockers): Speaker of the Heavens blocks Beast Token and dies without killing it, to save only 3 damage (life 50)
  - chose: block Beast Token with Speaker of the Heavens; open mana 1; life {"Calling All Angels":50,"Tramplesaurus Rex":9,"Wretched Ranks":14,"Reign of Dragons":0}
  - hand: Radiant Fountain, Angel of the Ruins, Plains
  - boards: Calling All Angels: Inspiring Overseer 2/1(t), Archangel of Tithes 3/5(t), Linvala, the Preserver 5/5(t), Speaker of the Heavens 1/1 | Tramplesaurus Rex: Beast Token 3/3(t), Hulking Raptor 5/3(t), Challenger Troll 6/5(t), Beast Whisperer 2/3, Yeva, Nature's Herald 4/4 | Wretched Ranks: Lord of the Accursed 2/3(t), Lord of the Undead 2/2(t), Gravecrawler 2/1(t), Bad Moon, Midnight Reaper 3/2 | Reign of Dragons: -
  - alternatives: block Beast Token with Speaker of the Heavens (0); declare no blockers (0)

### repeated_activation (2)

- game 33, turn 40 precombat main phase, Wretched Ranks (main_phase): cast Gravecrawler from the graveyard chosen 3 times in the same phase
  - chose: cast Gravecrawler from the graveyard; open mana 3; life {"Wretched Ranks":33,"Reign of Dragons":28,"Tramplesaurus Rex":0,"Calling All Angels":38}
  - hand: -
  - boards: Wretched Ranks: Cemetery Tampering, Grave Titan 6/6, Zombie Token 2/2, Zombie Token 2/2, Bonehoard, Undead Augur 2/2 | Reign of Dragons: Sarkhan, Dragon Ascendant 2/2(t), Basilisk Collar, Swiftfoot Boots | Tramplesaurus Rex: - | Calling All Angels: Always Watching, Clue, Court of Grace, Mind Stone, Dazzling Angel 2/3
  - alternatives: cast Gravecrawler from the graveyard (3); pass this phase (0); end turn and skip remaining phases (0)

- game 64, turn 29 precombat main phase, Wretched Ranks (main_phase): cast Gravecrawler from the graveyard chosen 3 times in the same phase
  - chose: cast Gravecrawler from the graveyard; open mana 1; life {"Wretched Ranks":5,"Reign of Dragons":0,"Tramplesaurus Rex":32,"Calling All Angels":51}
  - hand: Barren Moor
  - boards: Wretched Ranks: Sol Ring(t), Dissection Tools, Undead Butler 1/2, Liliana's Mastery, Zombie Token 2/2, Zombie Token 2/2 | Reign of Dragons: - | Tramplesaurus Rex: Tangleweave Armor, Colossal Majesty, Llanowar Tribe 3/3, Clue | Calling All Angels: Righteous Valkyrie 2/4(t), Sol Ring, Archangel of Tithes 3/5(t), Metropolis Reformer 2/3, Search the Premises, Mind Stone, Spirit Token 1/1(t), Spirit Token 1/1(t)
  - alternatives: cast Gravecrawler from the graveyard (3); pass this phase (0); end turn and skip remaining phases (0)

## Engine gaps (not agent mistakes): spells cast that resolved with no modelled effect

- Mana Geyser: 22
