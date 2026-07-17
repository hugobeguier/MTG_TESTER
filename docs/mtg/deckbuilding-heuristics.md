# Deckbuilding Heuristics

Bracket 3 Commander deck targets:

- 35-38 lands depending on curve and ramp.
- 10-14 ramp sources.
- 10-14 card advantage sources.
- 8-12 spot interaction or flexible removal pieces.
- 2-4 board wipes depending on colors.
- 4-8 protection, recursion, or resilience pieces.
- Clear primary plan and one backup plan.
- Mana curve should let the deck affect the game by turn 2 or 3.

## Synergy coherence

- Prefer cards that support two or more of the commander's core themes over generic "good stuff"
  staples that don't interact with anything else in the deck. A card earns its slot by doing
  something *because* of what else is in the 99, not just because it's independently strong.
- For every card, be able to state in one sentence why it's in the deck relative to the game plan
  (this reasoning belongs in the `notes` field). "Good card" is not a reason; "enables the
  sacrifice/reanimation loop with the commander" is.
- When a generic staple and a synergy hit compete for the same functional slot (e.g. two removal
  spells, two ramp rocks), prefer the synergy hit unless the generic staple is meaningfully more
  efficient or more resilient — raw power level still matters, synergy is a tiebreaker and a
  differentiator, not an excuse to run strictly worse cards.

## Mana curve shape

- Front-load the curve: aim for a meaningful number of impactful 1-3 mana plays so the deck can do
  something relevant before turn 4, not just ramp and pass.
- Cap 6+ mana cards to a small handful (roughly 6-10 across the whole 99, ramp and lands aside).
  A curve that's top-heavy can't interact with the board until turn 5+ and loses tempo to any
  faster opponent.
- Every color should have some early plays available even in a multicolor deck — don't let the
  curve's early slots be dominated by cards in only one of the commander's colors.

## Using EDHREC synergy data

- When a list of EDHREC high-synergy cards for this exact commander is supplied, treat it as a
  **starting point to prune from**, not merely an additive suggestion list layered on top of a
  generic build. Build the synergy package first from that list, then fill remaining role slots
  (ramp/draw/removal/wipes/protection) with generically strong cards only where the synergy list
  doesn't already cover that role.
- Where a generic curated fallback and an EDHREC synergy hit both fill the same role, prefer the
  synergy hit — that's the whole point of having the list available.

## Avoid an unfocused 99

Checklist before finalizing:

- No more than 2-3 unrelated sub-themes. Every sub-theme should connect back to the primary plan
  or the backup plan, not exist in isolation.
- One primary win condition, plus one clearly-stated backup — not a pile of unrelated "this could
  also maybe win" cards.
- Don't stack redundant effects at the expense of role balance — e.g. more than 3-4 pure
  ramp-only mana rocks (not ramp that also does something else) usually means draw, interaction,
  or wipes are underbuilt relative to the role targets above.
- Deck critique should explain weak packages and recommend role-level improvements before
  individual card swaps.
