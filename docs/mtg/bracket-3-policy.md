# Bracket 3 Policy

Bracket 3 is the target for upgraded Commander decks: stronger than preconstructed/casual decks but not tuned cEDH.

Project policy for v1:

- Maximum 3 Game Changer cards.
- Avoid deterministic early wins before turn 6.
- Avoid heavy stacks of free interaction, fast mana, and compact two-card wins.
- Use enough interaction to play real multiplayer Magic.
- Prefer commanders and packages that create interactive games.

The Game Changer list is stored in code for validation and must be updated when the Commander bracket guidance changes.

## What "interactive" means in practice

- The deck should be able to respond to at least a few of the following in a typical game: a
  problematic creature, an equipment/aura, an artifact/enchantment, and a board-wide threat. Eight
  to twelve spot-interaction pieces and two to four board wipes (see deckbuilding-heuristics.md)
  is the concrete target — don't trade those slots away for more win-condition redundancy.
- Board wipes should be castable at a range of mana costs, not all clustered at the same point in
  the curve, so the deck has an answer whether the board gets out of hand on turn 5 or turn 12.

## Fast mana and combo discipline

- A small number of individually-strong cards (a couple of cheap ramp rocks, a tutor) is fine and
  expected at Bracket 3. What's not fine is stacking enough of them that the deck can reliably
  assemble a win before the rest of the table has taken meaningful actions.
- Two-card combos that come together by turn 4-5 with no real setup cost are out of place here
  even if no single piece is individually banned — judge the deck's overall speed, not just
  card-by-card legality.
- A single extra-turn spell is a normal value card; chaining/looping extra turns together
  (e.g. around Nexus of Fate-style effects) is not, since it can lock other players out of the
  game.

## Explaining choices in `notes`

When building or critiquing a deck, use the `notes` field to call out anything that's a deliberate
bracket-policy tradeoff — e.g. why a Game Changer was included over an alternative, or why a
combo-adjacent card was left out. This makes it easy to audit whether the deck is actually staying
inside policy rather than just hitting the raw card-count targets.
