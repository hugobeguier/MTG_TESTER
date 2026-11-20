# Consolidated questions (card behaviour only)

All questions are resolved. Schema-plumbing questions from the five pilot decks were resolved by the consolidated schema pass (see `src/kernel/SCHEMA_CHANGELOG.md`). Monarch stays a scripted marker (your earlier decision).

## Mazemind Tome (keen-engineering) - RESOLVED: exact
"When there are four or more page counters on this, exile it. If you do, you gain 4 life."
Decision: the life gain happens ONLY if the exile actually happened (if the Tome was destroyed in response to the trigger, no life). The draft now gives the exile step `id: "s1"` and gates the life gain with the `step_done` predicate on `s1` (no more "is no longer on the battlefield" approximation).

## Ezuri's Predation (tramplesaurus-rex) - RESOLVED: exact
"For each creature your opponents control, create a 4/4 Beast. Each of those tokens fights a different one of those creatures."
Decision: make it exact. Step 1 creates ALL tokens first, with `tokenCount` = number of creatures opponents control (so token-count replacement effects such as Doubling Season apply and the token count may differ from the creature count). Step 2 is the new `fight_pairs` step: each token fights a DIFFERENT one of those creatures, the pairing CHOSEN BY THE CONTROLLER (prompt: "Choose which creature each token fights."); extra tokens beyond the number of creatures fight nothing.

## Cut a Deal (calling-all-angels) - RESOLVED: no change
"Each opponent draws a card, then you draw a card for each opponent who drew a card this way."
Decision: the draft is fine. A player with an empty library fails to draw and loses to state-based actions; no special handling needed.
