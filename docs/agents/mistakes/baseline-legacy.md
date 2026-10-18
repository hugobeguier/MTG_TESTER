# Agent mistake report — baseline-legacy

Pool `legacy`, 40 games, seeds 1000..1039, play guards on. Heuristic brain on every seat.

## Health

- Finished with a winner: 40/40 (100.0%); turn-cap 0, timeout 0, crash 0
- Average turns per seat: 10.1; audit violations: 0; avg wall clock 224 ms/game
- Winner spread: Seat A 23, Seat B 17
- Decisions: 4012; pass/end-turn share 45.1%; by action: play_land 587, pass_priority 1810, cast_spell 654, attack 789, cast_commander 46, block 126

## Flags by category

| Category | Flags | Games hit | Flags/game | Top cards |
|---|---:|---:|---:|---|
| pointless_sacrifice | 0 | 0 | 0.00 |  |
| removal_on_low_threat | 0 | 0 | 0.00 |  |
| idle_protection_spell | 0 | 0 | 0.00 |  |
| combat_spell_outside_combat | 0 | 0 | 0.00 |  |
| declined_free_attack | 0 | 0 | 0.00 |  |
| unused_mana_castable_left | 1 | 1 | 0.03 | Merciless Executioner (1) |
| missed_land_drop | 0 | 0 | 0.00 |  |
| spell_no_target_or_effect | 14 | 12 | 0.35 | Counterspell (4), Duplicant (2), Negate (2), Arcane Denial (2) |
| own_wipe_while_ahead | 0 | 0 | 0.00 |  |
| self_inflicted_loss | 4 | 4 | 0.10 | Aminatou, Veil Piercer (2), Rivaz of the Claw (1), Thopter Assembly (1), Talisman of Progress (1) |
| tapped_out_into_lethal | 2 | 2 | 0.05 | Dracogenesis (1), Sheoldred (1) |
| repeated_activation | 0 | 0 | 0.00 |  |
| suicide_attack | 8 | 6 | 0.20 | Aminatou, Veil Piercer (3), Emry, Lurker of the Loch (2), Merciless Executioner (2), Moon-Blessed Cleric (2) |
| pointless_block | 4 | 3 | 0.10 | Esper Sentinel (2), Archetype of Imagination (1), Duplicant (1), Warren Soultrader (1) |
| self_lethal_life_cost | 0 | 0 | 0.00 |  |

## Examples

### spell_no_target_or_effect (14)

- game 5, turn 14 precombat main phase, Seat A (main_phase): targeted creature removal cast with no opposing creature: it can only hit my own
  - chose: cast Duplicant; open mana 7; life {"Seat A":29,"Seat B":38}
  - hand: Duplicant, Saheeli's Directive, Path of Ancestry
  - boards: Seat A: Saheeli, the Gifted 3/4, Thopter Assembly 5/5 | Seat B: Sigil of the Empty Throne
  - alternatives: cast Duplicant (3); pass this phase (0); end turn and skip remaining phases (0)

- game 6, turn 9 precombat main phase, Seat A (main_phase): counterspell cast with nothing on the stack to counter
  - chose: cast Negate; open mana 2; life {"Seat A":38,"Seat B":40}
  - hand: Sphere of Safety, Swords to Plowshares, Starfield of Nyx, Negate, Brainstorm
  - boards: Seat A: Copy Enchantment, Smuggler's Share, Ledger Shredder 1/3 | Seat B: Fiend Artisan 1/1(t)
  - alternatives: cast Negate (3); cast Brainstorm (3); pass this phase (0); end turn and skip remaining phases (0); cast Swords to Plowshares [vetoed] (-47)

- game 7, turn 20 precombat main phase, Seat A (main_phase): counterspell cast with nothing on the stack to counter
  - chose: cast Counterspell; open mana 7; life {"Seat A":19,"Seat B":36}
  - hand: Flawless Maneuver, Counterspell
  - boards: Seat A: Talisman of Dominance, Extravagant Replication, Propaganda, Grave Betrayal, Wayfarer's Bauble, Demon of Fate's Design 6/6 | Seat B: Aminatou, Veil Piercer 2/4, Plant Token 0/1(t), Satyr Wayfinder 1/1(t), Sakura-Tribe Elder 1/1(t), Cankerbloom 3/2, Ashnod's Altar
  - alternatives: cast Counterspell (3); pass this phase (0); end turn and skip remaining phases (0); cast Flawless Maneuver [vetoed] (-47)

### suicide_attack (8)

- game 5, turn 8 declare attackers step, Seat A (declare_attackers): Emry, Lurker of the Loch attacks into Aminatou, Veil Piercer, which can block and kill it without dying (1 attacker(s) vs 1 such blocker(s))
  - chose: attack Seat B with Emry, Lurker of the Loch; open mana 0; life {"Seat A":37,"Seat B":40}
  - hand: Thopter Assembly, Loyal Apprentice, Duplicant, Tomb of the Spirit Dragon, Island, Saheeli's Directive
  - boards: Seat A: Emry, Lurker of the Loch 1/2, Saheeli, the Gifted 3/4 | Seat B: Moon-Blessed Cleric 3/2(t), Aminatou, Veil Piercer 2/4
  - alternatives: attack Seat B with Emry, Lurker of the Loch (0); declare no attackers (0)

- game 5, turn 30 declare attackers step, Seat A (declare_attackers): Padeem, Consul of Innovation attacks into Soaring Lightbringer, which can block and kill it without dying (1 attacker(s) vs 1 such blocker(s))
  - chose: attack Seat B with Padeem, Consul of Innovation; open mana 3; life {"Seat A":26,"Seat B":13}
  - hand: -
  - boards: Seat A: Saheeli, the Gifted 3/4, Foundry Inspector 3/2(t), Padeem, Consul of Innovation 1/4, Mycosynth Lattice(t), Mirrorworks(t) | Seat B: Sigil of the Empty Throne, One with the Multiverse, Sol Ring, Soaring Lightbringer 4/5
  - alternatives: attack Seat B with Padeem, Consul of Innovation (0); declare no attackers (0)

- game 7, turn 9 declare attackers step, Seat B (declare_attackers): Merciless Executioner attacks into Aminatou, Veil Piercer, which can block and kill it without dying (1 attacker(s) vs 1 such blocker(s))
  - chose: attack Seat A with Merciless Executioner; open mana 0; life {"Seat B":40,"Seat A":40}
  - hand: Satyr Wayfinder, Reanimate, Dauthi Voidwalker, Journey to Eternity, Buried Alive, Village Rites
  - boards: Seat B: Merciless Executioner 3/1, Warren Soultrader 3/3 | Seat A: Talisman of Dominance(t), Aminatou, Veil Piercer 2/4
  - alternatives: attack Seat A with Merciless Executioner (1); declare no attackers (0)

### self_inflicted_loss (4)

- game 2, turn 9 precombat main phase, Seat A (outcome): casting cast Crux of Fate cost the caster ~6 of permanents (Rivaz of the Claw) against ~0 for everyone else
  - chose: cast Crux of Fate; open mana 0; life {"Seat A":39,"Seat B":39}
  - hand: Crux of Fate, Two-Headed Hellkite, Ancient Silver Dragon, Ancient Copper Dragon, Mox Opal
  - boards: Seat A: Korlessa, Scale Singer, Rivaz of the Claw | Seat B: Saheeli, Sublime Artificer, Saheeli, the Gifted

- game 5, turn 14 precombat main phase, Seat A (outcome): casting cast Duplicant cost the caster ~9 of permanents (Thopter Assembly) against ~0 for everyone else
  - chose: cast Duplicant; open mana 0; life {"Seat A":29,"Seat B":38}
  - hand: Duplicant, Saheeli's Directive, Path of Ancestry
  - boards: Seat A: Saheeli, the Gifted, Thopter Assembly | Seat B: Sigil of the Empty Throne

- game 12, turn 12 precombat main phase, Seat B (outcome): casting cast Devastation Tide cost the caster ~24 of permanents (Talisman of Progress, Talisman of Hierarchy, Talisman of Dominance, Aminatou, Veil Piercer, Sphere of Safety) against ~15 for everyone else
  - chose: cast Devastation Tide; open mana 0; life {"Seat A":38,"Seat B":36}
  - hand: Virtue of Persistence, Archaeomancer's Map, Brainsurge, Secret Arcade, Devastation Tide
  - boards: Seat A: Everflowing Chalice, Enthusiastic Mechanaut, Saheeli, Sublime Artificer, Prototype Portal | Seat B: Talisman of Progress, Talisman of Hierarchy, Talisman of Dominance, Aminatou, Veil Piercer, Sphere of Safety

### pointless_block (4)

- game 4, turn 21 declare blockers step, Seat B (declare_blockers_additional): Archetype of Imagination blocks Duplicant and dies without killing it, to save only 2 damage (life 14)
  - chose: block Duplicant with Archetype of Imagination; open mana 1; life {"Seat B":14,"Seat A":38}
  - hand: Redress Fate, Omniscience, Estrid's Invocation
  - boards: Seat B: Arcane Signet(t), Copy Enchantment, Sphere of Safety, Archetype of Imagination 3/2, Extravagant Replication, Sigil of the Empty Throne, Mystic Remora, Yennett, Cryptic Sovereign 3/5 | Seat A: Saheeli, the Gifted 3/4, Everflowing Chalice(t), Duplicant 2/4(t), Soul of New Phyrexia 6/6(t), Mycosynth Lattice, Prototype Portal, Retrofitter Foundry, Hellkite Igniter 5/5(t)
  - alternatives: block Duplicant with Archetype of Imagination (2); declare no blockers (0)

- game 30, turn 14 declare blockers step, Seat A (declare_blockers_additional): Esper Sentinel blocks Warren Soultrader and dies without killing it, to save only 3 damage (life 20)
  - chose: block Warren Soultrader with Esper Sentinel; open mana 0; life {"Seat A":20,"Seat B":36}
  - hand: Inkshield, Soaring Lightbringer, Starfield of Nyx, Debtors' Knell, Extravagant Replication, Archetype of Imagination, Lim-Dûl's Vault
  - boards: Seat A: Esper Sentinel 1/1, Talisman of Hierarchy(t), Aminatou, the Fateshifter, Archon of Sun's Grace 3/4 | Seat B: Warren Soultrader 3/3(t), Meren of Clan Nel Toth 3/4(t), Syr Konrad, the Grim 5/4(t), Sidisi, Undead Vizier 4/6(t), Kokusho, the Evening Star 5/5
  - alternatives: block Warren Soultrader with Esper Sentinel (2); declare no blockers (0)

- game 30, turn 16 declare blockers step, Seat A (declare_blockers_additional): Esper Sentinel blocks Meren of Clan Nel Toth and dies without killing it, to save only 3 damage (life 10)
  - chose: block Meren of Clan Nel Toth with Esper Sentinel; open mana 2; life {"Seat A":10,"Seat B":36}
  - hand: Inkshield, Soaring Lightbringer, Starfield of Nyx, Debtors' Knell, Extravagant Replication, Archetype of Imagination, Callaphe, Beloved of the Sea
  - boards: Seat A: Esper Sentinel 1/1, Talisman of Hierarchy, Aminatou, the Fateshifter, Archon of Sun's Grace 3/4 | Seat B: Meren of Clan Nel Toth 3/4(t), Syr Konrad, the Grim 5/4(t), Sidisi, Undead Vizier 4/6(t), Kokusho, the Evening Star 5/5(t), Grave Pact, Insidious Fungus 1/2
  - alternatives: block Meren of Clan Nel Toth with Esper Sentinel (2); declare no blockers (0)

### tapped_out_into_lethal (2)

- game 17, turn 19 precombat main phase, Seat B (main_phase): tapped out for Dracogenesis while an opponent's board can swing ~5 against my 2 life
  - chose: cast Dracogenesis; open mana 7; life {"Seat B":2,"Seat A":24}
  - hand: Dracogenesis
  - boards: Seat B: Urza's Incubator, Miirym, Sentinel Wyrm 6/6, Scalelord Reckoner 4/4, Scalelord Reckoner 4/4 | Seat A: Meren of Clan Nel Toth 3/4, Syr Konrad, the Grim 5/4(t), Acidic Slime 2/2(t), Ashnod's Altar, Dauthi Voidwalker 3/2, Ramos, Dragon Engine 4/4
  - alternatives: cast Dracogenesis (3); pass this phase (0); end turn and skip remaining phases (0)

- game 25, turn 14 precombat main phase, Seat A (main_phase): tapped out for Sheoldred while an opponent's board can swing ~13 against my 7 life
  - chose: cast Sheoldred; open mana 5; life {"Seat A":7,"Seat B":37}
  - hand: Massacre Wurm, Sheoldred, Grisly Salvage, Solemn Simulacrum, Junji, the Midnight Sky
  - boards: Seat A: Birthing Pod | Seat B: Orb of Dragonkind, Terror of the Peaks 5/4(t), Goldspan Dragon 4/4(t), Ancient Copper Dragon 6/5(t), Roaming Throne 4/4
  - alternatives: cast Sheoldred (5); cast Junji, the Midnight Sky (5); cast Grisly Salvage (3); cast Solemn Simulacrum (3); pass this phase (0); end turn and skip remaining phases (0)

### unused_mana_castable_left (1)

- game 39, turn 17 postcombat main phase, Seat B (main_phase): ended the turn with 3 mana open while Merciless Executioner was castable (Merciless Executioner: a wipe now costs me more (~25) than the table (~8) — I would be behind afterwards)
  - chose: pass this phase; open mana 3; life {"Seat B":33,"Seat A":5}
  - hand: Merciless Executioner
  - boards: Seat B: Caustic Caterpillar 1/1(t), Dauthi Voidwalker 3/2(t), Junji, the Midnight Sky 5/5(t), Birthing Pod, Eternal Witness 2/1(t), Blood Artist 0/1(t), Meren of Clan Nel Toth 3/4 | Seat A: Aminatou, Veil Piercer 2/4(t), Arcane Signet, Starfield of Nyx, Talisman of Dominance, Archaeomancer's Map
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Merciless Executioner (-1)

## Engine gaps (not agent mistakes): spells cast that resolved with no modelled effect

- One with the Machine: 5
- Saheeli's Directive: 4
- Whir of Invention: 4
- Counterspell: 4
- Lim-Dûl's Vault: 4
- Negate: 2
- Arcane Denial: 2
- Portent: 1
