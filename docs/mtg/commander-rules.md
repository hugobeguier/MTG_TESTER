# Commander Rules Summary

Commander decks contain exactly 100 cards including the commander. Except for basic lands and cards that explicitly allow otherwise, cards are singleton.

Players start at 40 life. A commander starts in the command zone. A player loses if they receive 21 combat damage from the same commander over the game.

Color identity restricts cards to the commander's color identity. The authoritative rules engine must enforce card legality, zones, priority, the stack, replacement effects, and state-based actions.

Tapping is a single, exclusive state per permanent: a creature, artifact, or land can only be tapped for one thing at a time (rule 302.6/602.5a). Once something is tapped — to pay for a spell, activate an ability, or attack — it cannot also tap for mana, another ability, or blocking until it untaps. Mana is paid as part of casting a spell or activating an ability, immediately, not after it resolves (rule 601.2h); the legalActions list already reflects this, so a permanent already committed to one cost never appears as available for a second, unrelated tap effect.

For this project, XMage is the rules authority. Agents propose actions; XMage decides what is legal.
