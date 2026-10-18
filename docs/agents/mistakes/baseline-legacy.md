# Agent mistake report — baseline-legacy

Pool `legacy`, 40 games, seeds 1000..1039, play guards on. Heuristic brain on every seat.

## Health

- Finished with a winner: 40/40 (100.0%); turn-cap 0, timeout 0, crash 0
- Average turns per seat: 10.6; audit violations: 0; avg wall clock 239 ms/game
- Winner spread: Seat A 20, Seat B 20
- Decisions: 4200; pass/end-turn share 44.5%; by action: play_land 612, pass_priority 1871, cast_spell 700, attack 835, cast_commander 53, block 129

## Flags by category

| Category | Flags | Games hit | Flags/game | Top cards |
|---|---:|---:|---:|---|
| pointless_sacrifice | 0 | 0 | 0.00 |  |
| removal_on_low_threat | 0 | 0 | 0.00 |  |
| idle_protection_spell | 0 | 0 | 0.00 |  |
| combat_spell_outside_combat | 0 | 0 | 0.00 |  |
| declined_free_attack | 0 | 0 | 0.00 |  |
| unused_mana_castable_left | 3 | 2 | 0.07 | Accursed Marauder (3) |
| missed_land_drop | 0 | 0 | 0.00 |  |
| spell_no_target_or_effect | 18 | 13 | 0.45 | Arcane Denial (4), Negate (3), Counterspell (3), Animate Dead (2) |
| own_wipe_while_ahead | 2 | 1 | 0.05 | Merciless Executioner (1), Fleshbag Marauder (1) |
| self_inflicted_loss | 7 | 6 | 0.17 | Aminatou, Veil Piercer (3), Smuggler's Share (2), Archaeomancer's Map (1), Mystic Remora (1) |
| tapped_out_into_lethal | 1 | 1 | 0.03 | One with the Multiverse (1) |
| repeated_activation | 0 | 0 | 0.00 |  |
| suicide_attack | 9 | 8 | 0.23 | Scalelord Reckoner (2), Callaphe, Beloved of the Sea (2), Midnight Reaper (1), Junji, the Midnight Sky (1) |
| pointless_block | 5 | 5 | 0.13 | Chief of the Foundry (2), Aminatou, Veil Piercer (2), Thrakkus the Butcher (1), Wood Elves (1) |
| self_lethal_life_cost | 0 | 0 | 0.00 |  |

## Examples

### spell_no_target_or_effect (18)

- game 13, turn 15 precombat main phase, Seat B (main_phase): counterspell cast with nothing on the stack to counter
  - chose: cast Negate; open mana 6; life {"Seat B":29,"Seat A":26}
  - hand: Negate, Aminatou, the Fateshifter, Shadow of the Second Sun, Devastation Tide, Swords to Plowshares
  - boards: Seat B: Talisman of Hierarchy, Aminatou, Veil Piercer 2/4, Soaring Lightbringer 4/5, Boon of the Spirit Realm, Greed | Seat A: Retrofitter Foundry, Saheeli, the Gifted 3/4, Etherium Sculptor 1/2(t), Saheeli, Filigree Master, Darksteel Juggernaut */*(t), Wurmcoil Engine 6/6
  - alternatives: cast Negate (3); cast Aminatou, the Fateshifter (3); cast Shadow of the Second Sun (3); cast Devastation Tide (3); cast Swords to Plowshares (3); pass this phase (0)

- game 15, turn 10 precombat main phase, Seat A (main_phase): counterspell cast with nothing on the stack to counter
  - chose: cast Arcane Denial; open mana 2; life {"Seat A":34,"Seat B":37}
  - hand: Shark Typhoon, Archon of Sun's Grace, Swords to Plowshares, Monologue Tax, Mind's Dilation, Brainsurge, Arcane Denial
  - boards: Seat A: Wayfarer's Bauble, Wayfarer's Bauble | Seat B: Insidious Fungus 1/2(t), Phyrexian Altar(t), Meren of Clan Nel Toth 3/4(t), Acidic Slime 2/2
  - alternatives: cast Arcane Denial (3); pass this phase (0); end turn and skip remaining phases (0)

- game 15, turn 17 precombat main phase, Seat B (main_phase): targeted creature removal cast with no opposing creature: it can only hit my own
  - chose: cast Animate Dead; open mana 3; life {"Seat B":37,"Seat A":11}
  - hand: Animate Dead, Kokusho, the Evening Star, Demon's Disciple
  - boards: Seat B: Insidious Fungus 1/2, Phyrexian Altar, Meren of Clan Nel Toth 3/4, Acidic Slime 2/2, Yawgmoth, Thran Physician 2/4, Carrion Feeder 1/1, Reclamation Sage 2/1, Blood Artist 0/1 | Seat A: Wayfarer's Bauble, Mystic Remora
  - alternatives: cast Animate Dead (3); cast Demon's Disciple (1); pass this phase (0); end turn and skip remaining phases (0)

### suicide_attack (9)

- game 9, turn 10 declare attackers step, Seat A (declare_attackers): Midnight Reaper attacks into Scalelord Reckoner, which can block and kill it without dying (1 attacker(s) vs 1 such blocker(s))
  - chose: attack Seat B with Midnight Reaper; open mana 2; life {"Seat A":40,"Seat B":40}
  - hand: Birthing Pod, Junji, the Midnight Sky, Fauna Shaman, Jarad, Golgari Lich Lord, Diabolic Intent
  - boards: Seat A: Midnight Reaper 3/2, Viscera Seer 1/1 | Seat B: Dragon's Hoard(t), Scalelord Reckoner 4/4, Orb of Dragonkind
  - alternatives: attack Seat B with Midnight Reaper (0); declare no attackers (0)

- game 9, turn 13 declare attackers step, Seat B (declare_attackers): Scalelord Reckoner attacks into Junji, the Midnight Sky, which can block and kill it without dying (1 attacker(s) vs 1 such blocker(s))
  - chose: attack Seat A with Scalelord Reckoner; open mana 1; life {"Seat B":39,"Seat A":35}
  - hand: Isolated Chapel, Yavimaya, Cradle of Growth
  - boards: Seat B: Dragon's Hoard(t), Scalelord Reckoner 4/4, Orb of Dragonkind, Carnelian Orb of Dragonkind, Garruk's Uprising, Tiamat 7/7, Mox Opal(t), Atarka, World Render 6/4 | Seat A: Viscera Seer 1/1(t), Junji, the Midnight Sky 5/5
  - alternatives: attack Seat A with Scalelord Reckoner (0); declare no attackers (0)

- game 11, turn 13 declare attackers step, Seat B (declare_attackers): Loyal Apprentice attacks into Balefire Dragon, which can block and kill it without dying (1 attacker(s) vs 1 such blocker(s))
  - chose: attack Seat A with Loyal Apprentice; open mana 0; life {"Seat B":40,"Seat A":38}
  - hand: Darksteel Forge, Foundry of the Consuls
  - boards: Seat B: Mycosynth Lattice, Saheeli, the Gifted 3/4, Jhoira, Weatherlight Captain 3/3, Loyal Apprentice 2/1 | Seat A: Orb of Dragonkind, Ramos, Dragon Engine 4/4(t), Balefire Dragon 6/6
  - alternatives: attack Seat A with Loyal Apprentice (1); declare no attackers (0)

### self_inflicted_loss (7)

- game 5, turn 11 precombat main phase, Seat B (outcome): casting cast Devastation Tide cost the caster ~15 of permanents (Archaeomancer's Map, Aminatou, Veil Piercer, Mystic Remora) against ~9 for everyone else
  - chose: cast Devastation Tide; open mana 0; life {"Seat A":40,"Seat B":38}
  - hand: Devastation Tide, Heliod, the Radiant Dawn, Shadow of the Second Sun, Soaring Lightbringer, Utter End
  - boards: Seat A: Skullclamp, Chief of the Foundry | Seat B: Archaeomancer's Map, Aminatou, Veil Piercer, Mystic Remora

- game 12, turn 10 precombat main phase, Seat B (outcome): casting cast Aminatou, Veil Piercer cost the caster ~8 of permanents (Aminatou, Veil Piercer) against ~0 for everyone else
  - chose: cast Aminatou, Veil Piercer; open mana 0; life {"Seat A":37,"Seat B":40}
  - hand: Aminatou, Veil Piercer, Brainsurge, Swamp, Callaphe, Beloved of the Sea, Virtue of Persistence
  - boards: Seat A: Saheeli, Sublime Artificer, Saheeli, the Gifted, Jhoira, Weatherlight Captain | Seat B: Talisman of Dominance, Mystic Remora, Aminatou, Veil Piercer

- game 26, turn 14 precombat main phase, Seat B (outcome): casting cast Duplicant cost the caster ~7 of permanents (Darksteel Juggernaut) against ~0 for everyone else
  - chose: cast Duplicant; open mana 0; life {"Seat A":25,"Seat B":34}
  - hand: Prototype Portal, Reliquary Tower, Academy Ruins, Duplicant
  - boards: Seat A: Herald's Horn, Garruk's Uprising | Seat B: Loyal Apprentice, Saheeli, the Gifted, Darksteel Juggernaut, Darksteel Juggernaut, Darksteel Juggernaut

### pointless_block (5)

- game 10, turn 15 declare blockers step, Seat B (declare_blockers_additional): Chief of the Foundry blocks Thrakkus the Butcher and dies without killing it, to save only 3 damage (life 20)
  - chose: block Thrakkus the Butcher with Chief of the Foundry; open mana 1; life {"Seat B":20,"Seat A":32}
  - hand: Whirler Rogue, Reflecting Pool, Darksteel Forge
  - boards: Seat B: Chief of the Foundry 2/3, Unwinding Clock, Blinkmoth Urn, Darksteel Juggernaut */* | Seat A: Dragonstorm Globe(t), Old Gnawbone 7/7(t), Thrakkus the Butcher 3/4(t), Twinflame Tyrant 3/5(t), Goldspan Dragon 4/4(t)
  - alternatives: block Thrakkus the Butcher with Chief of the Foundry (2); declare no blockers (0)

- game 14, turn 13 declare blockers step, Seat B (declare_blockers_additional): Wood Elves blocks Aminatou, Veil Piercer and dies without killing it, to save only 2 damage (life 35)
  - chose: block Aminatou, Veil Piercer with Wood Elves; open mana 0; life {"Seat B":35,"Seat A":33}
  - hand: Butcher of Malakir, Journey to Eternity, Zulaport Cutthroat
  - boards: Seat B: Plant Token 0/1(t), Phyrexian Altar(t), Twilight Diviner 3/3, Wood Elves 1/1 | Seat A: Copy Enchantment, Aminatou, Veil Piercer 2/4(t), Sphere of Safety
  - alternatives: block Aminatou, Veil Piercer with Wood Elves (2); declare no blockers (0)

- game 21, turn 21 declare blockers step, Seat A (declare_blockers_additional): Whirler Rogue blocks Aminatou, Veil Piercer and dies without killing it, to save only 2 damage (life 32)
  - chose: block Aminatou, Veil Piercer with Whirler Rogue; open mana 1; life {"Seat A":32,"Seat B":19}
  - hand: Thopter Spy Network, Vedalken Humiliator, Whir of Invention, Urza, Lord High Artificer, Myr Battlesphere, Jhoira, Weatherlight Captain
  - boards: Seat A: Sai, Master Thopterist 1/4, Saheeli, the Gifted 3/4, Padeem, Consul of Innovation 1/4(t), Whirler Rogue 2/2, Thopter artifact Token 1/1, Thopter artifact Token 1/1 | Seat B: Arcane Signet(t), Aminatou, Veil Piercer 2/4(t), Greed, Sigil of the Empty Throne, Shark Typhoon, Wayfarer's Bauble, Enhanced Surveillance, Demon of Fate's Design 6/6(t)
  - alternatives: block Aminatou, Veil Piercer with Whirler Rogue (2); block Aminatou, Veil Piercer with Thopter artifact Token (2); block Aminatou, Veil Piercer with Thopter artifact Token (2); declare no blockers (0)

### unused_mana_castable_left (3)

- game 24, turn 13 postcombat main phase, Seat A (main_phase): ended the turn with 3 mana open while Accursed Marauder was castable (Accursed Marauder: a wipe now costs me more (~18) than the table (~0) — I would be behind afterwards)
  - chose: pass this phase; open mana 3; life {"Seat A":40,"Seat B":25}
  - hand: Accursed Marauder, Kokusho, the Evening Star, Mikaeus, the Unhallowed, War Room
  - boards: Seat A: Fiend Artisan 1/1(t), Acidic Slime 2/2(t), Meren of Clan Nel Toth 3/4(t) | Seat B: Mox Opal, Dragon Tempest
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Accursed Marauder (-1)

- game 38, turn 18 postcombat main phase, Seat B (main_phase): ended the turn with 6 mana open while Accursed Marauder was castable (Accursed Marauder: a wipe now costs me more (~20) than the table (~0) — I would be behind afterwards)
  - chose: pass this phase; open mana 6; life {"Seat B":37,"Seat A":17}
  - hand: Accursed Marauder, Command Beacon, Dakmor Salvage
  - boards: Seat B: Demon's Disciple 3/1(t), Skullclamp, Sheoldred 4/5(t), Meren of Clan Nel Toth 3/4(t), Zulaport Cutthroat 1/1(t) | Seat A: Greed, Smuggler's Share, Talisman of Dominance(t)
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Accursed Marauder (-1)

- game 38, turn 20 postcombat main phase, Seat B (main_phase): ended the turn with 6 mana open while Accursed Marauder was castable (Accursed Marauder: a wipe now costs me more (~26) than the table (~0) — I would be behind afterwards)
  - chose: pass this phase; open mana 6; life {"Seat B":37,"Seat A":6}
  - hand: Accursed Marauder, Dakmor Salvage
  - boards: Seat B: Demon's Disciple 3/1(t), Skullclamp, Sheoldred 4/5(t), Meren of Clan Nel Toth 3/4(t), Zulaport Cutthroat 1/1(t), Midnight Reaper 3/2 | Seat A: Greed, Smuggler's Share, Talisman of Dominance, Monologue Tax, Talisman of Progress
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Accursed Marauder (-1)

### own_wipe_while_ahead (2)

- game 23, turn 15 precombat main phase, Seat B (main_phase): board wipe cast with my creature value 18 against 0 for the whole rest of the table
  - chose: cast Merciless Executioner; open mana 4; life {"Seat B":37,"Seat A":35}
  - hand: Acidic Slime, Mikaeus, the Unhallowed, Merciless Executioner, Fleshbag Marauder
  - boards: Seat B: Sidisi, Undead Vizier 4/6, Meren of Clan Nel Toth 3/4, Wight of the Reliquary 2/2 | Seat A: Greed, Talisman of Dominance
  - alternatives: cast Merciless Executioner (1); cast Fleshbag Marauder (1); pass this phase (0); end turn and skip remaining phases (0)

- game 23, turn 19 precombat main phase, Seat B (main_phase): board wipe cast with my creature value 29 against 0 for the whole rest of the table
  - chose: cast Fleshbag Marauder; open mana 6; life {"Seat B":37,"Seat A":12}
  - hand: Acidic Slime, Mikaeus, the Unhallowed, Fleshbag Marauder
  - boards: Seat B: Sidisi, Undead Vizier 4/6, Meren of Clan Nel Toth 3/4, Wight of the Reliquary 2/2, Merciless Executioner 3/1, Sheoldred, Whispering One 6/6 | Seat A: Greed, Talisman of Dominance, Greed
  - alternatives: cast Fleshbag Marauder (1); pass this phase (0); end turn and skip remaining phases (0)

### tapped_out_into_lethal (1)

- game 5, turn 23 precombat main phase, Seat B (main_phase): tapped out for One with the Multiverse while an opponent's board can swing ~6 against my 2 life
  - chose: cast One with the Multiverse; open mana 8; life {"Seat B":2,"Seat A":44}
  - hand: One with the Multiverse, Copy Enchantment, Shark Typhoon
  - boards: Seat B: Heliod, the Radiant Dawn 4/4, Mystic Remora, Enhanced Surveillance, Archaeomancer's Map | Seat A: Saheeli, the Gifted 3/4, Skullclamp, Thopter Assembly 5/5(t), Duplicant 2/4(t), Thought Monitor 2/2(t), Chief of the Foundry 2/3(t), Saheeli, Sublime Artificer
  - alternatives: cast One with the Multiverse (3); cast Copy Enchantment (3); cast Shark Typhoon (3); cast commander Aminatou, Veil Piercer (3); pass this phase (0); end turn and skip remaining phases (0)

## Engine gaps (not agent mistakes): spells cast that resolved with no modelled effect

- Arcane Denial: 4
- Lim-Dûl's Vault: 3
- Negate: 3
- One with the Machine: 3
- Counterspell: 3
- Portent: 2
- Saheeli's Directive: 1
