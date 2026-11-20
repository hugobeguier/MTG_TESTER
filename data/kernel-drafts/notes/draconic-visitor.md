# Draconic Visitor - notes (not yet applied to a draft)

Source: https://mtg.wtf/card/pfra/80p/Draconic-Visitor (Reality Fracture Promos, pfra #80p). Not verified against Scryfall/Gatherer.
Not in data/cards.db or XMage, so the draft needs an `oracleOverride` recording this source.

Oracle text (the replacement line is two fragments joined by a space; exact punctuation unverified):
- {3}{R}{R}, Creature - Dragon, 5/5
- Flying
- If one or more artifact tokens would be created under your control, that many 5/5 red Dragon creature tokens with flying are created instead.

Rulings (all dated 2026-08-21, summarised):
- If an effect changes who controls a token being created, that effect applies before Draconic Visitor's replacement. If it changes control as the token enters, that effect applies after.
- A nonartifact token that becomes an artifact as it enters is not affected. Example: Mycosynth Lattice makes ALL permanents (on the battlefield now and entering later) artifacts, but a token is only a permanent once it is on the battlefield. At the moment of creation it is still a nonartifact token, so the replacement does not see an artifact token. Tokens that are artifact tokens by their own definition (Treasure, Clue, Food, Thopter...) are still replaced.
  Kernel implication: evaluate "is this an artifact token?" from the token's own characteristics at creation, before static effects like Lattice apply.
- Replaced tokens become 5/5 red Dragon creature tokens with flying and lose any abilities they would have been created with. Other instructions of the creating effect still apply (enters tapped, enters attacking, "gains haste", "exile at end of combat").

Also appears in decks/custom/Lathliss, Dragon Queen.txt (FRA 80) and decks/foundations/Reign Of Dragons.txt.
