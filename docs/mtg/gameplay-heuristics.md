# Gameplay Heuristics

Multiplayer Commander decisions must account for all opponents.

Threat assessment:

- Prioritize players with imminent wins over players with merely large boards.
- Track open mana, known protection, graveyard resources, and commander recast pressure.
- Avoid using premium removal on value engines if another player is close to ending the game.

Politics:

- Do not overcommit into obvious sweepers.
- Let opponents answer threats when they are incentivized to do so.
- Avoid becoming the sole archenemy unless it creates a winning path.

Core priors (apply these even when nothing above names the exact situation):

- Before weighing broader board politics on an attack, check the simple arithmetic first: does any
  legal attack reduce a target player's life to 0 or below if it connects? A legalActions entry whose
  score reasoning calls out "lethal" has already done this math for you — take it unless you have a
  concrete reason it won't actually connect (a known blocker, a trick you've seen used). Don't reason
  your way past a free kill by comparing board presence or "who's the biggest threat" instead —
  ending a player's game outright always outweighs that.
- Protect your commander. It is your most reliable recurring threat and the thing an empty board
  can be rebuilt around — do not attack with it into an obviously bad trade, and do not leave it as
  the only blocker against a lethal swing when a lesser creature could soak the hit instead.
- Prefer a 2-for-1 over a 1-for-1 when both are available and roughly equally relevant: a removal
  spell that also draws a card, a block that kills an attacker for free, an attack that is unblockable
  profit rather than a even trade — all beat a play that only trades one resource for one resource.
- Before casting an additional creature, check the board first: does any opponent have a near-empty
  battlefield and meaningful untapped mana? A legalActions entry whose score reasoning calls out
  "reads as a held sweeper" has already flagged this — treat it as a real warning, not background
  noise, the same way a "lethal" score callout is a real signal on an attack. That combination is the
  signature of a held sweeper or counterspell, and playing another creature into it just to develop
  is how a strong board gets erased for nothing.
- When behind, prioritize survival and stabilization (blockers, life gain, removing the biggest active
  threat) over further development. When comfortably ahead, prioritize protecting the lead (holding
  up interaction, not overextending into a wipe) over greedily maximizing damage output.

Worked examples (abbreviated context/legalActions shown; use the same reasoning pattern on the
full JSON you actually receive):

Example 1 — don't overextend into a likely sweeper.
```
context: { turn: 6, you: { life: 38, hand: [3 creatures], battlefield: [2 creatures] },
           opponents: [{ name: "Vex", life: 35, battlefield: [], availableMana: { total: 4 } }] }
legalActions: [
  { id: "a1", actionType: "cast_spell", label: "Cast a 3rd creature", score: -1 },
  { id: "a2", actionType: "pass_priority", label: "Hold remaining hand", score: 0 }
]
```
Vex has an empty board turn 6 with 4 untapped mana — the score reasoning already flags this as
reading like a held sweeper, which is why casting a 3rd creature scores BELOW holding back despite
"playing a land/spell is usually good" being the default. Playing into it risks a 3-for-1 blowout for
one extra body now. Better to hold back and only commit as much board as you can afford to lose.
-> legalActionId: "a2", reason: "Opponent's untapped mana with an empty board reads as a held sweeper; not overcommitting a third creature into it."

Example 2 — protect the commander over a marginal attack.
```
context: { you: { commander: { name: "Malik", power: "4", toughness: "4" } },
           opponents: [{ battlefield: [{ name: "Wall", power: "0", toughness: "6" }] }] }
legalActions: [
  { id: "a1", actionType: "attack", cardId: "malik", label: "Attack with Malik into the Wall", score: -2 },
  { id: "a2", actionType: "end_turn", label: "Hold commander back", score: 0 }
]
```
The only blocker survives the hit and Malik gains nothing from attacking here — no evasion, no
must-answer trigger, no lethal line. Losing tempo on your commander (it would go to the command
zone if later killed while tapped out and unable to be protected) for zero payoff is a bad trade.
-> legalActionId: "a2", reason: "Attacking trades nothing but exposes the commander for no gain; holding back preserves it."

Example 3 — take the 2-for-1 over the 1-for-1.
```
context: { you: { hand: [{ id: "c1", name: "Removal (kills, no upside)" }, { id: "c2", name: "Removal + draws a card" }] } }
legalActions: [
  { id: "a1", actionType: "cast_spell", cardId: "c1", label: "Cast plain removal on the biggest threat", score: 3 },
  { id: "a2", actionType: "cast_spell", cardId: "c2", label: "Cast removal-plus-cantrip on the same threat", score: 3 }
]
```
Both answer the same threat equally well, but one also replaces itself with a card. When two
legal actions solve the same problem equally, prefer the one that leaves you with more resources.
-> legalActionId: "a2", reason: "Same threat answered either way; the cantrip removal is a strict 2-for-1 upgrade over the plain one."

Example 4 — take the free kill instead of reasoning about board politics.
```
context: { you: { battlefield: [{ id: "atk1", name: "Shivan Dragon", power: "5" }] },
           opponents: [{ id: "low", name: "Priest of Low Life", life: 3, battlefield: [] },
                       { id: "big", name: "Board Baron", life: 30, battlefield: [huge board] }] }
legalActions: [
  { id: "a1", actionType: "attack", targetIds: ["low"], label: "Attack Priest of Low Life", score: 8 },
  { id: "a2", actionType: "attack", targetIds: ["big"], label: "Attack Board Baron", score: 4 }
]
```
5 power vs. 3 life is lethal if it connects — that ends Priest of Low Life's game outright, this
turn. Board Baron having a bigger board is real, but "biggest threat" reasoning is for turns where
nobody is dying — it does not outweigh an actual kill sitting on the table right now.
-> legalActionId: "a1", reason: "5 damage is lethal to Priest of Low Life at 3 life; take the kill instead of the bigger-board target."
