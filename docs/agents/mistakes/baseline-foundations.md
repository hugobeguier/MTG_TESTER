# Agent mistake report — baseline-foundations

Pool `foundations`, 120 games, seeds 1000..1119, play guards on. Heuristic brain on every seat.

## Health

- Finished with a winner: 120/120 (100.0%); turn-cap 0, timeout 0, crash 0
- Average turns per seat: 11.4; audit violations: 0; avg wall clock 649 ms/game
- Winner spread: Wretched Ranks 21, Tramplesaurus Rex 37, Reign of Dragons 14, Calling All Angels 48
- Decisions: 25275; pass/end-turn share 39.9%; by action: play_land 3568, pass_priority 10096, cast_spell 4997, cast_commander 340, attack 5505, block 769

## Flags by category

| Category | Flags | Games hit | Flags/game | Top cards |
|---|---:|---:|---:|---|
| pointless_sacrifice | 0 | 0 | 0.00 |  |
| removal_on_low_threat | 0 | 0 | 0.00 |  |
| idle_protection_spell | 0 | 0 | 0.00 |  |
| combat_spell_outside_combat | 0 | 0 | 0.00 |  |
| declined_free_attack | 0 | 0 | 0.00 |  |
| unused_mana_castable_left | 4 | 3 | 0.03 | The Elder Dragon War (2), Whiptongue Hydra (2) |
| missed_land_drop | 0 | 0 | 0.00 |  |
| spell_no_target_or_effect | 6 | 6 | 0.05 | Go for the Throat (3), Swords to Plowshares (1), Fateful Absence (1), Kenrith's Transformation (1) |
| own_wipe_while_ahead | 3 | 3 | 0.03 | Mutilate (1), Cleansing Nova (1), Day of Judgment (1) |
| self_inflicted_loss | 10 | 10 | 0.08 | Commander's Sphere (1), Atsushi, the Blazing Sky (1), Giada, Font of Hope (1), Drakuseth, Maw of Flames (1) |
| tapped_out_into_lethal | 18 | 13 | 0.15 | Blasphemous Act (6), Ezuri's Predation (2), Surrak, the Hunt Caller (1), Hulking Raptor (1) |
| repeated_activation | 2 | 2 | 0.02 | Gravecrawler from the graveyard (2) |
| suicide_attack | 52 | 41 | 0.43 | Giada, Font of Hope (6), Firemane Commando (5), Magda, the Hoardmaster (5), Managorger Hydra (5) |
| pointless_block | 22 | 16 | 0.18 | Giada, Font of Hope (6), Thrashing Brontodon (5), Speaker of the Heavens (4), Lord of the Accursed (3) |
| self_lethal_life_cost | 0 | 0 | 0.00 |  |

## Examples

### suicide_attack (52)

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

### pointless_block (22)

- game 3, turn 19 declare blockers step, Calling All Angels (declare_blockers_additional): Angel of Vitality blocks Nogi, Draco-Zealot and dies without killing it, to save only 3 damage (life 33)
  - chose: block Nogi, Draco-Zealot with Angel of Vitality; open mana 0; life {"Calling All Angels":33,"Wretched Ranks":41,"Reign of Dragons":34,"Tramplesaurus Rex":34}
  - hand: Norn's Choirmaster, Plains
  - boards: Calling All Angels: Giada, Font of Hope 2/2(t), Marble Diamond(t), Vanquisher's Banner, Angel of Vitality 2/2, Exemplar of Light 3/3 | Wretched Ranks: Patchwork Banner(t), Phyrexian Arena, Gray Merchant of Asphodel 2/4 | Reign of Dragons: Nogi, Draco-Zealot 3/3(t), Draconic Visitor 5/5(t), Hellkite Charger 5/5(t) | Tramplesaurus Rex: Llanowar Elves 1/1(t), Fyndhorn Elves 1/1(t), Pugnacious Hammerskull 6/6(t), Hulking Raptor 5/3
  - alternatives: block Nogi, Draco-Zealot with Angel of Vitality (2); declare no blockers (0)

- game 19, turn 52 declare blockers step, Calling All Angels (declare_blockers_additional): Metropolis Reformer blocks Thrashing Brontodon and dies without killing it, to save only 3 damage (life 24)
  - chose: block Thrashing Brontodon with Metropolis Reformer; open mana 12; life {"Calling All Angels":24,"Wretched Ranks":0,"Reign of Dragons":0,"Tramplesaurus Rex":16}
  - hand: -
  - boards: Calling All Angels: Marble Diamond, Emeria Shepherd 4/4(t), Wojek Investigator 2/4, Metropolis Reformer 2/3, Search the Premises, Angel of the Ruins 5/7(t), Inspiring Overseer 2/1(t), Sol Ring | Wretched Ranks: - | Reign of Dragons: - | Tramplesaurus Rex: Rhonas's Monument, Thrashing Brontodon 3/4(t), Swiftfoot Boots, Ghalta, Primal Hunger 12/12
  - alternatives: block Thrashing Brontodon with Metropolis Reformer (2); block Thrashing Brontodon with Giada, Font of Hope (2); declare no blockers (0)

- game 19, turn 52 declare blockers step, Calling All Angels (declare_blockers_additional): Giada, Font of Hope blocks Thrashing Brontodon and dies without killing it, to save only 3 damage (life 24)
  - chose: block Thrashing Brontodon with Giada, Font of Hope; open mana 12; life {"Calling All Angels":24,"Wretched Ranks":0,"Reign of Dragons":0,"Tramplesaurus Rex":16}
  - hand: -
  - boards: Calling All Angels: Marble Diamond, Emeria Shepherd 4/4(t), Wojek Investigator 2/4, Metropolis Reformer 2/3, Search the Premises, Angel of the Ruins 5/7(t), Inspiring Overseer 2/1(t), Sol Ring | Wretched Ranks: - | Reign of Dragons: - | Tramplesaurus Rex: Rhonas's Monument, Thrashing Brontodon 3/4(t), Swiftfoot Boots, Ghalta, Primal Hunger 12/12
  - alternatives: block Thrashing Brontodon with Giada, Font of Hope (2); declare no blockers (0)

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

- game 0, turn 47 precombat main phase, Tramplesaurus Rex (main_phase): tapped out for Surrak, the Hunt Caller while an opponent's board can swing ~32 against my 5 life
  - chose: cast Surrak, the Hunt Caller; open mana 4; life {"Tramplesaurus Rex":5,"Wretched Ranks":17,"Reign of Dragons":0,"Calling All Angels":0}
  - hand: Forest, Tranquil Thicket, Rishkar, Peema Renegade, Verdant Sun's Avatar, Loot, Exuberant Explorer, Tamiyo's Safekeeping, Forest, Ezuri's Predation, Elemental Bond, Rhonas's Monument, Surrak, the Hunt Caller, Beast Within, Hulking Raptor, Forest
  - boards: Tramplesaurus Rex: Unnatural Growth, Swiftfoot Boots, Garruk's Uprising, Steel Leaf Champion 5/4, Colossal Majesty, Goreclaw, Terror of Qal Sisma 4/3, Regal Imperiosaur 5/4 | Wretched Ranks: Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t), Zombie Token 2/2(t) | Reign of Dragons: - | Calling All Angels: -
  - alternatives: cast Surrak, the Hunt Caller (5); cast Rishkar, Peema Renegade (3); cast Loot, Exuberant Explorer (3); cast Elemental Bond (3); cast Rhonas's Monument (3); cast Beast Within (3)

### self_inflicted_loss (10)

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

### spell_no_target_or_effect (6)

- game 12, turn 58 precombat main phase, Wretched Ranks (main_phase): targeted creature removal cast with no opposing creature: it can only hit my own
  - chose: cast Go for the Throat; open mana 9; life {"Wretched Ranks":13,"Reign of Dragons":0,"Tramplesaurus Rex":21,"Calling All Angels":0}
  - hand: Go for the Throat
  - boards: Wretched Ranks: Phyrexian Reclamation, Cemetery Tampering, Lord of the Accursed 2/3, Lashwrithe, Grave Titan 6/6, Zombie Token 2/2, Zombie Token 2/2, Disciple of Griselbrand 1/1 | Reign of Dragons: - | Tramplesaurus Rex: Colossal Majesty | Calling All Angels: -
  - alternatives: cast Go for the Throat (3); pass this phase (0); end turn and skip remaining phases (0)

- game 42, turn 5 precombat main phase, Wretched Ranks (main_phase): targeted creature removal cast with no opposing creature: it can only hit my own
  - chose: cast Go for the Throat; open mana 2; life {"Wretched Ranks":40,"Tramplesaurus Rex":40,"Calling All Angels":40,"Reign of Dragons":40}
  - hand: Go for the Throat, Wight of Precinct Six, Night's Whisper, Vengeful Dead, Tendrils of Corruption, Bojuka Bog
  - boards: Wretched Ranks: Cryptbreaker 1/1 | Tramplesaurus Rex: - | Calling All Angels: - | Reign of Dragons: -
  - alternatives: cast Go for the Throat (3); cast Wight of Precinct Six (3); cast Night's Whisper (3); pass this phase (0); end turn and skip remaining phases (0)

- game 43, turn 15 precombat main phase, Calling All Angels (main_phase): targeted creature removal cast with no opposing creature: it can only hit my own
  - chose: cast Swords to Plowshares; open mana 2; life {"Calling All Angels":40,"Wretched Ranks":37,"Reign of Dragons":40,"Tramplesaurus Rex":40}
  - hand: Angel of the Ruins, Swords to Plowshares, Sunblast Angel, Arcane Signet, Grasp of Fate, Plains, Heraldic Banner, Serra Avenger
  - boards: Calling All Angels: Metallic Mimic 2/1 | Wretched Ranks: - | Reign of Dragons: Sol Ring(t), The Misty Mountains Cold | Tramplesaurus Rex: -
  - alternatives: cast Swords to Plowshares (3); cast Arcane Signet (3); cast Serra Avenger (3); pass this phase (0); end turn and skip remaining phases (0)

### unused_mana_castable_left (4)

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

- game 92, turn 40 postcombat main phase, Tramplesaurus Rex (main_phase): ended the turn with 6 mana open while Whiptongue Hydra was castable (Whiptongue Hydra: a wipe now costs me more (~48) than the table (~25) — I would be behind afterwards)
  - chose: pass this phase; open mana 6; life {"Tramplesaurus Rex":7,"Wretched Ranks":0,"Reign of Dragons":0,"Calling All Angels":19}
  - hand: Whiptongue Hydra
  - boards: Tramplesaurus Rex: Unnatural Growth, Surrak and Goreclaw 6/5(t), Birds of Paradise 0/1(t), Arasta of the Endless Web 3/5(t), Swiftfoot Boots, Llanowar Elves 1/1(t), Managorger Hydra 1/1(t), Ilysian Caryatid 1/1(t) | Wretched Ranks: - | Reign of Dragons: - | Calling All Angels: Sol Ring, Angel of Finality 3/4(t), Angelic Sleuth 2/3(t), Grasp of Fate, Endless Atlas, Clue, Norn's Choirmaster 5/4(t), Vanguard Seraph 3/3(t)
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
  - chose: cast Day of Judgment; open mana 9; life {"Calling All Angels":14,"Wretched Ranks":0,"Reign of Dragons":0,"Tramplesaurus Rex":22}
  - hand: Day of Judgment
  - boards: Calling All Angels: Angel of Finality 3/4, Herald of Eternal Dawn 6/6, Firemane Commando 4/3, Patchwork Banner | Wretched Ranks: - | Reign of Dragons: - | Tramplesaurus Rex: Fyndhorn Elves 1/1(t), Tangleweave Armor, Phyrexian Germ Token 0/0(t), Whisperer of the Wilds 0/2(t), Garruk's Packleader 4/4(t), Carnage Tyrant 7/6
  - alternatives: cast Day of Judgment (3); pass this phase (0); end turn and skip remaining phases (0)

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

- Mana Geyser: 19
