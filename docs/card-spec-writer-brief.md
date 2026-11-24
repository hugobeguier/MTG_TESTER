# Brief for a blind card-spec writer

You write the behaviour spec of ONE card (or a batch of cards, one file each). The point of the spec is to be an **independent** check of the kernel: you must not know how the kernel implements the card, otherwise your spec will inherit its mistakes. Follow this exactly.

## What you may read

1. The card's `oracle_text`, `type_line`, `mana_cost`, power/toughness: from `data/cards.db` (table `cards`, columns `name, type_line, mana_cost, oracle_text, raw`). Read it yourself, never from memory and never from a brief: rulings and printings differ.
   `node -e "const D=require('better-sqlite3');const d=new D('data/cards.db',{readonly:true});console.log(d.prepare(\"select name,type_line,mana_cost,oracle_text from cards where name=? or name like ?||' // %'\").get('<Card Name>','<Card Name>'))"`
2. The Comprehensive Rules (CR). Look up every rule your expectations depend on (the keyword's section, 117 priority, 118.12 "unless" costs, 601 casting, 603 triggers, 608 resolution, 613 layers, 614 replacement effects, 704 SBA, 709 Rooms, ...) and cite it in `why`. If a rule is not available locally, fetch the current CR from the Wizards website; do not rely on memory for numbered rules.
3. `docs/card-spec-format.md` (the format, the helper catalog, how to run) and the existing examples in `data/kernel-specs/` for style.

## What you must NOT read

`src/kernel/**`, `data/kernel-drafts/**`, `public/kernel-packs/**`, `docs/kernel-*`, any test of the kernel, any earlier spec of the same card by someone else. If you catch yourself opening them, stop. The only code you run is `npm run kernel:spec -- --file <your file>` to validate and look at results (a failing result is information for the triage step, not something to "fix" by editing the expectation).

## What a good spec is

Each scenario is one rule situation: a position (setup), a script of actions, and expectations that each carry a `why` quoting the oracle clause or CR section. Write expectations from the **rules**, never from what you think the engine returns. When in doubt about a ruling, read the CR and the official rulings; if still unclear, write the scenario for the strictest reading you can justify and say so in `description`.

Cover **every clause of the card**. Checklist (skip an item only if the card has no such clause, and say which in `notes`):

- **Each triggered ability**
  - positive case: it triggers, goes on the stack above the spell that caused it (CR 603.3), resolves correctly;
  - negative cases: wrong player (you vs an opponent vs each of 3 opponents), wrong object type (creature vs noncreature, token vs nontoken, land vs nonland), wrong zone (from graveyard / exile / hand instead of the battlefield), second time when the text says "first"/"second spell each turn", an intervening "if" that is false (CR 603.4), the source having left the battlefield, a trigger that must NOT happen when the source is a copy / lost its abilities;
  - optional ("may") triggers: accept and decline; "unless pays" triggers: pays and does not pay;
  - several triggers at once (ordering, CR 603.3b), a trigger that has no legal target (removed from the stack).
- **Each activated ability**: cost payable and not payable (missing mana, no creature to sacrifice, already tapped, summoning sickness for {T}), timing (sorcery-speed restriction, once per turn), targets legal / illegal / target gone on resolution (fizzle, CR 608.2b), X costs (X = 0 and X > 0), loyalty abilities (one per turn), activation from the right zone only, mana abilities (do not use the stack, CR 605).
- **Each static ability**: what exactly it applies to (your / opponents' / all; permanents vs spells on the stack; nonland / tokens), the effective characteristics through the layers (CR 613: use `permanent` checks on power, toughness, types, subtypes, keywords, abilityText, abilitiesStripped), timestamps when two effects compete, and that it **stops when the source leaves the battlefield** (or loses its abilities), and does not apply from the wrong zone.
- **Each replacement effect**: applies to the right events only (your tokens, not the opponent's; dying, not exiled), applies to each instance, interacts with a second replacement (the affected player/controller orders, CR 616), stops applying when the source loses abilities or leaves; "as it enters" choices and "enters tapped" / "enters with counters".
- **Modes, X, kicker, alternative and additional costs, flashback / cycling / miracle / free-cast permissions, "can't be countered", cost reductions and increases**: each mode alone and every illegal combination, X = 0, kicked and unkicked, the way of casting recorded for "if it was kicked" riders.
- **Players**: wherever the text says opponent / each opponent / target player / each player / another player, write a **4-player variant** (`players: 4`) and check every seat that must and must not be affected; also the 2-player case. Whose turn it is matters (`active`).
- **Stack interaction**: the spell/ability is responded to (an opponent casts Lightning Bolt / Swords to Plowshares in response), countered (`Counterspell`), fizzles when targets become illegal, copies of it, what happens when the source is removed in response (abilities exist independently of their source, CR 113.7a; last known information).
- **The card as a spell** (permanents too): casting restrictions, timing (flash / sorcery speed), where it ends up (graveyard, exile, battlefield), summoning sickness for creatures, commander tax if it is the commander.
- **Combat** (when relevant): attackers, blockers, damage, first strike, "whenever this attacks / deals combat damage".

Typically **4 to 12 scenarios per card**: a vanilla land needs 1-2, a Mystic Remora needs 9. Name every scenario by the rule it tests ("Opponent's creature spell does not trigger Remora"), not by its number.

## Practical rules

- File: `data/kernel-specs/<card-slug>.spec.json`, `"status": "draft"`. Put the oracle text you read into `"oracle"`.
- Use real names for the card under test and for real interaction pieces (`Lightning Bolt`, `Counterspell`, `Swords to Plowshares`, basic lands); use the catalog stand-ins for everything else. Do not invent new cards.
- Give the player exactly the mana they need (lands on the battlefield); a library only when drawing / milling / searching matters (otherwise leave it out); no extra permanents that could interact.
- One rule per scenario. Prefer state expectations (`life`, `zone`, `permanent`, `tokens`, `stack`, `pending`) over `log` / `events`, whose vocabulary belongs to the engine.
- Answer decisions with `answers` (order-insensitive, matched by kind/player/prompt). Do not put `kind` on an answer unless you care that the engine asks that kind.
- If a scenario needs a rule the format cannot express, write it down in `notes` and keep the closest expressible scenario; never fake it.
- Never copy expected numbers from a failing run. If a run fails, re-read the oracle text and the CR once; if the spec is right, **leave it failing** and report it (triage decides, `docs/card-spec-triage.md`). If the spec was wrong, fix it and say why in your report.
- Validate: `npm run kernel:spec -- --file data/kernel-specs/<slug>.spec.json --no-save`. SPEC ERROR means your file is wrong: fix it. FAIL / UNSUPPORTED are results, not your errors.

## Report (for each card)

- the file path; the scenarios (one line each: what rule);
- results: PASS / FAIL / UNSUPPORTED / SPEC ERROR counts;
- for each FAIL or UNSUPPORTED: scenario name, the `why` of the failed expectation, expected vs actual (copy from the runner), and whether you believe the spec is right (one sentence citing the oracle clause or CR number);
- clauses of the card you could not cover and why.
