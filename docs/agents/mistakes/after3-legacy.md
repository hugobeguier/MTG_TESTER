# Agent mistake report — after3-legacy

Pool `legacy`, 40 games, seeds 1000..1039, play guards on. Heuristic brain on every seat.

## Health

- Finished with a winner: 40/40 (100.0%); turn-cap 0, timeout 0, crash 0
- Average turns per seat: 9.9; audit violations: 2; avg wall clock 257 ms/game
- Winner spread: Seat A 25, Seat B 15
- Decisions: 3938; pass/end-turn share 45.8%; by action: play_land 580, pass_priority 1805, cast_spell 631, attack 780, cast_commander 43, block 99

## Flags by category

| Category | Flags | Games hit | Flags/game | Top cards |
|---|---:|---:|---:|---|
| pointless_sacrifice | 0 | 0 | 0.00 |  |
| removal_on_low_threat | 0 | 0 | 0.00 |  |
| idle_protection_spell | 0 | 0 | 0.00 |  |
| combat_spell_outside_combat | 0 | 0 | 0.00 |  |
| declined_free_attack | 0 | 0 | 0.00 |  |
| unused_mana_castable_left | 2 | 1 | 0.05 | Yawgmoth, Thran Physician (2), Junji, the Midnight Sky (2), Syr Konrad, the Grim (2), commander Meren of Clan Nel Toth (2) |
| missed_land_drop | 0 | 0 | 0.00 |  |
| spell_no_target_or_effect | 1 | 1 | 0.03 | Utter Insignificance (1) |
| own_wipe_while_ahead | 0 | 0 | 0.00 |  |
| self_inflicted_loss | 2 | 2 | 0.05 | Rivaz of the Claw (1), Talisman of Progress (1), Talisman of Hierarchy (1), Talisman of Dominance (1) |
| tapped_out_into_lethal | 3 | 3 | 0.07 | Wayfarer's Bauble (1), Dracogenesis (1), Sheoldred (1) |
| repeated_activation | 0 | 0 | 0.00 |  |
| suicide_attack | 3 | 2 | 0.07 | Moon-Blessed Cleric (2), Saheeli, the Gifted (2), Emry, Lurker of the Loch (1), Aminatou, Veil Piercer (1) |
| pointless_block | 0 | 0 | 0.00 |  |
| self_lethal_life_cost | 0 | 0 | 0.00 |  |
| sequencing_wipe_after_creature | 0 | 0 | 0.00 |  |

## Examples

### suicide_attack (3)

- game 5, turn 8 declare attackers step, Seat A (declare_attackers): Emry, Lurker of the Loch attacks into Aminatou, Veil Piercer, which can block and kill it without dying (1 attacker(s) vs 1 such blocker(s))
  - chose: attack Seat B with Emry, Lurker of the Loch; open mana 0; life {"Seat A":37,"Seat B":40}
  - hand: Thopter Assembly, Loyal Apprentice, Duplicant, Tomb of the Spirit Dragon, Island, Saheeli's Directive
  - boards: Seat A: Emry, Lurker of the Loch 1/2, Saheeli, the Gifted 3/4 | Seat B: Moon-Blessed Cleric 3/2(t), Aminatou, Veil Piercer 2/4
  - alternatives: attack Seat B with Emry, Lurker of the Loch (0); declare no attackers (0)

- game 36, turn 14 declare attackers step, Seat B (declare_attackers): Moon-Blessed Cleric attacks into Saheeli, the Gifted, which can block and kill it without dying (1 attacker(s) vs 1 such blocker(s))
  - chose: attack Saheeli, the Gifted (Seat A's planeswalker, 4 loyalty) with Moon-Blessed Cleric; open mana 1; life {"Seat B":40,"Seat A":37}
  - hand: Heliod, the Radiant Dawn, Mirrormade, Soaring Lightbringer, Devastation Tide, Archon of Sun's Grace, Boon of the Spirit Realm
  - boards: Seat B: Talisman of Hierarchy, Monologue Tax, Moon-Blessed Cleric 3/2, Smuggler's Share | Seat A: Saheeli, the Gifted 3/4
  - alternatives: attack Saheeli, the Gifted (Seat A's planeswalker, 4 loyalty) with Moon-Blessed Cleric (0); declare no attackers (0); attack Seat A with Moon-Blessed Cleric [vetoed] (-50)

- game 36, turn 16 declare attackers step, Seat B (declare_attackers): Moon-Blessed Cleric attacks into Saheeli, the Gifted, which can block and kill it without dying (1 attacker(s) vs 1 such blocker(s))
  - chose: attack Saheeli, the Gifted (Seat A's planeswalker, 1 loyalty) with Moon-Blessed Cleric; open mana 0; life {"Seat B":40,"Seat A":37}
  - hand: Mirrormade, Soaring Lightbringer, Devastation Tide, Archon of Sun's Grace, Boon of the Spirit Realm, Utter Insignificance
  - boards: Seat B: Talisman of Hierarchy(t), Monologue Tax, Moon-Blessed Cleric 3/2, Smuggler's Share, Heliod, the Radiant Dawn 4/4 | Seat A: Saheeli, the Gifted 3/4, Daretti, Scrap Savant
  - alternatives: attack Saheeli, the Gifted (Seat A's planeswalker, 1 loyalty) with Moon-Blessed Cleric (1); attack Daretti, Scrap Savant (Seat A's planeswalker, 3 loyalty) with Moon-Blessed Cleric (1); declare no attackers (0); attack Seat A with Moon-Blessed Cleric [vetoed] (-49)

### tapped_out_into_lethal (3)

- game 7, turn 16 precombat main phase, Seat A (main_phase): tapped out for Wayfarer's Bauble while an opponent's board can swing ~14 against my 14 life
  - chose: cast Wayfarer's Bauble; open mana 1; life {"Seat A":14,"Seat B":32}
  - hand: Wayfarer's Bauble, Flawless Maneuver
  - boards: Seat A: Talisman of Dominance(t), Extravagant Replication, Propaganda, Grave Betrayal | Seat B: Merciless Executioner 3/1(t), Warren Soultrader 3/3(t), Massacre Wurm 6/5(t), Satyr Wayfinder 1/1
  - alternatives: cast Wayfarer's Bauble (3); pass this phase (0); end turn and skip remaining phases (0)

- game 17, turn 17 precombat main phase, Seat B (main_phase): tapped out for Dracogenesis while an opponent's board can swing ~13 against my 7 life
  - chose: cast Dracogenesis; open mana 7; life {"Seat B":7,"Seat A":36}
  - hand: Miirym, Sentinel Wyrm, Dracogenesis, Morophon, the Boundless
  - boards: Seat B: Urza's Incubator | Seat A: Meren of Clan Nel Toth 3/4(t), Yawgmoth, Thran Physician 2/4(t), Syr Konrad, the Grim 5/4(t), Acidic Slime 2/2(t), Ashnod's Altar
  - alternatives: cast Dracogenesis (3); cast Morophon, the Boundless (3); pass this phase (0); end turn and skip remaining phases (0)

- game 25, turn 14 precombat main phase, Seat A (main_phase): tapped out for Sheoldred while an opponent's board can swing ~13 against my 7 life
  - chose: cast Sheoldred; open mana 5; life {"Seat A":7,"Seat B":37}
  - hand: Massacre Wurm, Sheoldred, Agadeem's Awakening, Bojuka Bog, Revitalizing Repast
  - boards: Seat A: Birthing Pod | Seat B: Orb of Dragonkind, Terror of the Peaks 5/4(t), Goldspan Dragon 4/4(t), Ancient Copper Dragon 6/5(t), Roaming Throne 4/4
  - alternatives: cast Sheoldred (5); pass this phase (0); end turn and skip remaining phases (0)

### self_inflicted_loss (2)

- game 2, turn 9 precombat main phase, Seat A (outcome): casting cast Crux of Fate cost the caster ~6 of permanents (Rivaz of the Claw) against ~0 for everyone else
  - chose: cast Crux of Fate; open mana 0; life {"Seat A":39,"Seat B":39}
  - hand: Crux of Fate, Two-Headed Hellkite, Ancient Silver Dragon, Ancient Copper Dragon, Mox Opal
  - boards: Seat A: Korlessa, Scale Singer, Rivaz of the Claw | Seat B: Saheeli, Sublime Artificer, Saheeli, the Gifted

- game 12, turn 12 precombat main phase, Seat B (outcome): casting cast Devastation Tide cost the caster ~24 of permanents (Talisman of Progress, Talisman of Hierarchy, Talisman of Dominance, Aminatou, Veil Piercer, Sphere of Safety) against ~15 for everyone else
  - chose: cast Devastation Tide; open mana 0; life {"Seat A":38,"Seat B":36}
  - hand: Virtue of Persistence, Archaeomancer's Map, Brainsurge, Secret Arcade, Devastation Tide
  - boards: Seat A: Everflowing Chalice, Enthusiastic Mechanaut, Saheeli, Sublime Artificer, Prototype Portal | Seat B: Talisman of Progress, Talisman of Hierarchy, Talisman of Dominance, Aminatou, Veil Piercer, Sphere of Safety

### unused_mana_castable_left (2)

- game 31, turn 19 postcombat main phase, Seat B (main_phase): ended the turn with 5 mana open while Yawgmoth, Thran Physician, Junji, the Midnight Sky, Syr Konrad, the Grim, commander Meren of Clan Nel Toth was castable (Yawgmoth, Thran Physician: hold Yawgmoth, Thran Physician: Jarad, Golgari Lich Lord is going to be cast this turn and would kill it — wipe first, then deploy with the remaining mana; Junji, the Midnight Sky: hold Junji, the Midnight Sky: Jarad, Golgari Lich Lord is going to be cast this turn and would kill it — wipe first, then deploy with the remaining mana; Syr Konrad, the Grim: hold Syr Konrad, the Grim: Jarad, Golgari Lich Lord is going to be cast this turn and would kill it — wipe first, then deploy with the remaining mana; commander Meren of Clan Nel Toth: hold Meren of Clan Nel Toth: Jarad, Golgari Lich Lord is going to be cast this turn and would kill it — wipe first, then deploy with the remaining mana)
  - chose: pass this phase; open mana 5; life {"Seat B":10,"Seat A":19}
  - hand: Yawgmoth, Thran Physician, Junji, the Midnight Sky, Syr Konrad, the Grim, Jarad, Golgari Lich Lord
  - boards: Seat B: Skullclamp, Blood Artist 0/1(t), Fleshbag Marauder 3/1(t) | Seat A: Talisman of Progress(t), Aminatou, Veil Piercer 2/4(t), Soaring Lightbringer 4/5(t), Archon of Sun's Grace 3/4(t), Sol Ring, Sphere of Safety, Talisman of Progress, Aminatou, the Fateshifter
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Yawgmoth, Thran Physician (-4); cast Junji, the Midnight Sky (-4); cast Syr Konrad, the Grim (-4); cast commander Meren of Clan Nel Toth (-4)

- game 31, turn 21 postcombat main phase, Seat B (main_phase): ended the turn with 5 mana open while Yawgmoth, Thran Physician, Junji, the Midnight Sky, Syr Konrad, the Grim, commander Meren of Clan Nel Toth was castable (Yawgmoth, Thran Physician: hold Yawgmoth, Thran Physician: Jarad, Golgari Lich Lord is going to be cast this turn and would kill it — wipe first, then deploy with the remaining mana; Junji, the Midnight Sky: hold Junji, the Midnight Sky: Jarad, Golgari Lich Lord is going to be cast this turn and would kill it — wipe first, then deploy with the remaining mana; Syr Konrad, the Grim: hold Syr Konrad, the Grim: Jarad, Golgari Lich Lord is going to be cast this turn and would kill it — wipe first, then deploy with the remaining mana; commander Meren of Clan Nel Toth: hold Meren of Clan Nel Toth: Jarad, Golgari Lich Lord is going to be cast this turn and would kill it — wipe first, then deploy with the remaining mana)
  - chose: pass this phase; open mana 5; life {"Seat B":1,"Seat A":19}
  - hand: Yawgmoth, Thran Physician, Junji, the Midnight Sky, Syr Konrad, the Grim, Jarad, Golgari Lich Lord
  - boards: Seat B: Skullclamp, Blood Artist 0/1(t), Fleshbag Marauder 3/1(t) | Seat A: Talisman of Progress, Aminatou, Veil Piercer 2/4(t), Soaring Lightbringer 4/5(t), Archon of Sun's Grace 3/4(t), Sol Ring, Sphere of Safety, Talisman of Progress, Aminatou, the Fateshifter
  - alternatives: pass this phase (0); end turn and skip remaining phases (0); cast Yawgmoth, Thran Physician (-4); cast Junji, the Midnight Sky (-4); cast Syr Konrad, the Grim (-4); cast commander Meren of Clan Nel Toth (-4)

### spell_no_target_or_effect (1)

- game 36, turn 14 precombat main phase, Seat B (main_phase): targeted creature removal cast with no opposing creature: it can only hit my own
  - chose: cast Utter Insignificance; open mana 3; life {"Seat B":40,"Seat A":37}
  - hand: Heliod, the Radiant Dawn, Mirrormade, Soaring Lightbringer, Devastation Tide, Utter Insignificance, Archon of Sun's Grace, Boon of the Spirit Realm
  - boards: Seat B: Talisman of Hierarchy, Monologue Tax, Moon-Blessed Cleric 3/2, Smuggler's Share | Seat A: Saheeli, the Gifted 3/4
  - alternatives: cast Utter Insignificance (3); pass this phase (0); end turn and skip remaining phases (0)

## Engine gaps (not agent mistakes): spells cast that resolved with no modelled effect

- One with the Machine: 5
- Saheeli's Directive: 4
- Lim-Dûl's Vault: 4
- Whir of Invention: 3
- Portent: 1
