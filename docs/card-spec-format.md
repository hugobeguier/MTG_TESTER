# Card behaviour specs: format

A spec says, in plain data, **what the oracle text and the Comprehensive Rules (CR) require to happen** in a concrete position. The runner builds that position in the real kernel, plays the script through the real engine (`resolve` / `legalActions`) and compares. A spec never mentions engine ids, ability ids, the card drafts or any code. If you have to look at `src/kernel/**` to write it, it is not a spec.

- One file per card: `data/kernel-specs/<card-slug>.spec.json` (slug: lowercase, every run of non-alphanumerics becomes `-`; `Archaeomancer's Map` -> `archaeomancer-s-map`). Two-faced cards use the front face (`Secret Arcade`).
- Validated by a strict zod schema (`src/kernel/spec/schema.ts`): an unknown key, a missing `why`, a bad player id is reported as **SPEC ERROR**, never as a card failure.
- Run: `npm run kernel:spec -- --card "Mystic Remora"` (see "Running").

## File

```json
{
  "card": "Mystic Remora",              // the card under test, real name
  "cards": ["Utter Insignificance"],    // optional: other real cards this file exercises (so --card finds the file)
  "deck": "aminatou",                   // optional: whose drafts win when several decks draft the same card
  "status": "draft",                    // draft | accepted   (accepted = permanent regression test)
  "oracle": "…",                        // optional: the oracle text you read (documentation)
  "notes": "…",                         // optional
  "scenarios": [ { … }, { … } ]         // 1 or more, unique names
}
```

## Scenario

```json
{
  "name": "Opponent pays {4}: no draw",          // required, unique in the file
  "description": "…",                            // optional
  "players": 2,                                  // 2 (default) | 3 | 4; players are p1..p4
  "active": "p1",                                // whose turn (default p1); that player starts with priority
  "phase": "precombat_main",                     // start phase: upkeep draw precombat_main beginning_of_combat postcombat_main end_step
  "turnNumber": 1, "startingLife": 40, "seed": 7,
  "setup": { "p1": { …player setup… }, "p2": { … } },
  "manualPay": ["p1"],                           // optional: p1 pays by hand (a pay_mana decision opens); default: mana is paid automatically
  "steps": [ …actions… ],
  "expect": [ …expectations checked after the last step… ],
  "knownFailure": "ENGINE BUG: …"                // optional, see "Status and known failures"
}
```

### Player setup

All keys optional. Cards are named by their **real card name** or by a catalog stand-in (below). A bare string is a card; an object adds options.

| key | meaning |
|---|---|
| `life` | life total (default `startingLife`, 40) |
| `hand`, `battlefield`, `graveyard`, `exile`, `command` | lists of entries. Graveyard: oldest first (last = most recent). `battlefield` of a player = the permanents they own (use `controller` on an entry for stolen ones) |
| `library` | top card first. **Omitted = 30 Islands** (so drawing never loses the game); `[]` = really empty |
| `commander` | shorthand: that card is in the command zone as your commander |
| `pool` | mana already in the pool, `{"U": 1, "C": 2}` |
| `counters` | counters on the player (`{"experience": 2}`) |
| `landsPlayed` | lands already played this turn |

Entry object: `{ "card": "Mystic Remora", "counters": {"age": 2}, "tapped": true, "fresh": true, "faceDown": true, "damage": 1, "count": 3, "as": "alias", "controller": "p2", "attachedTo": "p2:Vanilla 2/2", "chosen": {"color": "R"}, "unlocked": ["Dusty Parlor"] }`

- `fresh`: came under its controller's control this turn (summoning sick). Default: has been there since before the turn.
- `count`: n copies. `as`: a name you can use later to refer to this exact object (only until it changes zone).
- `attachedTo`: Aura / Equipment host (object reference) or a player id (`"p2"`) for an Aura that enchants a player.
- `chosen`: "as it enters, choose a color" already made. `unlocked`: Room doors that are unlocked.
- Tokens: `{ "token": { "name": "Squirrel", "types": ["Creature"], "subtypes": ["Squirrel"], "colors": ["G"], "power": 1, "toughness": 1, "keywords": [] }, "count": 2 }` (battlefield only).
- Setup places cards directly: **nothing triggers**, no ETB, no cast. To test an ETB, cast / play the card in a step.

### Helper catalog (stand-in permanents / spells with known simple text)

Use them for "the opponent has a creature". Source of truth: `src/kernel/spec/catalog.ts`.

| name | what it is |
|---|---|
| `Vanilla 1/1`, `Vanilla 2/2`, `Vanilla 3/3`, `Vanilla 5/5` | colorless creatures {1} {2} {3} {5}, no abilities |
| `Vanilla 2/2 Flyer`, `Vanilla 5/5 Flyer` | flying, {3} / {6} |
| `Vanilla 2/2 Haste`, `Vanilla 2/2 First Strike`, `Vanilla 2/2 Deathtouch` | one keyword, {3} |
| `Vanilla 1/1 Hexproof` | hexproof, {2} |
| `Grizzly Bears` | green Bear 2/2, {1}{G} |
| `Vanilla Artifact Creature` | artifact creature - Golem 2/2, {3} |
| `Vanilla Artifact`, `Vanilla Enchantment` | no abilities, {2} |
| `Vanilla Instant`, `Vanilla Sorcery` | {1}, do nothing when they resolve |
| `Vanilla Land` | a land with no abilities |
| `Token Maker` | sorcery {2}: create a 1/1 white Soldier creature token |
| `Life Gainer` | instant {1}: you gain 3 life |
| `Card Drawer` | sorcery {2}: you draw a card |

Real cards by name work too and are usually better for "the opponent responds": `Lightning Bolt`, `Counterspell`, `Swords to Plowshares`, `Island`, `Plains`, `Swamp`, `Mountain`, `Forest`. A real card needs a kernel draft (data/kernel-drafts) to have its abilities; basic lands do not. A card without a draft is a stub with **no abilities** (reported as a note; the card under test without one = UNSUPPORTED).

## Referring to objects ("object references")

A string. `Name` finds a card or token by name (real name, face name of a two-faced card, or token name), case-insensitive. Add qualifiers:

- `p2:Vanilla 2/2`: owned (non-battlefield) / controlled (battlefield) by p2.
- `hand:Island`, `battlefield:Island`, `graveyard:…`, `exile:…`, `library:…`, `command:…`, `stack:…` (a spell on the stack). Combine: `p2:graveyard:Island`.
- `Island#2`: the second match (1-based, in battlefield order, then stack, hand, graveyard, exile, command, library).
- an `as` alias from the setup.

Players are `p1`..`p4`. When the reference is ambiguous the first match wins, so qualify it.

## Actions (`steps`)

Every action may carry: `label`, `answers` (decisions it runs into), `expectRejected` (error code the engine must answer with), `expect` (expectations checked right after this action).

| `do` | fields | what it does |
|---|---|---|
| `cast` | `player`, `card`, `targets`, `modes`, `x`, `face`, `way`, `extras`, `pay` | cast a spell. Stops when the spell is on the stack (and its cast-time decisions are answered). `targets`: one entry per targeting decision, in order, each a reference or a list of references (`["p2"]`, `[["Vanilla 2/2","Vanilla 3/3"]]`); a missing target decision is a FAIL. `modes`: mode texts to choose (substring ok). `face`: `"Dusty Parlor"` for a two-faced card. `way`: `"normal"`, `"free"` (a free-cast permission such as Omniscience) or a substring of the offered way's label (`"flashback"`). `pay`: `"auto"` (explicitly tap automatically, also for a manualPay player), `"pool"`, or `{"tap": ["Island#1"]}` |
| `activate` | `player`, `source`, `ability`, `targets`, `x`, `color`, `pay` | activate an ability of a permanent. `ability`: an integer N = the Nth **activated or mana** ability in oracle-text order (1-based), or a substring of the ability's text |
| `tapForMana` | `player`, `permanent`, `color` | tap for mana (picks the mana ability that can make `color` if the land has one per colour) |
| `playLand` | `player`, `card`, `face` | play a land |
| `unlockDoor` | `player`, `card`, `door`, `pay` | Room special action (CR 116.2m / 709.5): pay a locked door's cost |
| `pass` | `player?`, `times?` | pass priority literally (default: the player who holds it) |
| `resolve` | | everybody passes priority until the stack is empty or a decision no remaining answer fits is open |
| `advance` | `to` (phase), `active?` (whose turn) | advance step by step (empty declarations, passing) until that phase; stops with beginning-of-step triggers still on the stack |
| `answer` | `answers` (>= 1) | answer the currently pending decision(s) |
| `declareAttackers` | `player`, `attackers: [{creature, defender?}]` | `defender` is a player id or a planeswalker reference; optional with one opponent |
| `declareBlockers` | `player`, `blocks: [{blocker, attacker}]` | |
| `put` | `player`, `zone`, `card` | add a card to a zone mid-scenario (nothing triggers) |

Opponents' actions are the same actions with another `player`. Priority matters: after `cast`, the caster keeps priority; to let an opponent respond, `pass` as the caster first (`{"do":"pass","player":"p1"}`), then `cast` as p2, then `resolve`. In a sorcery-speed situation the active player has priority at the start of the scenario.

### Answers (decisions)

An answer is matched to **the first pending decision it fits**; an answer that fits nothing asked is simply unused (a forced choice the engine may not ask about is not an error; the expectations decide). Set `required: true` to demand that the decision is asked. Targets in `cast`/`activate` are always required.

```json
{ "kind": "choose_yes_no", "player": "p1", "promptContains": "pay", "yes": true }
{ "pick": ["Vanilla 2/2"] }          // option label / card name; "Island#2" = second option labelled Island; {"index": 0} = by position
{ "number": 3 }   { "none": true }   { "cancel": true }
{ "payWith": ["Island#1"] }          // pay_mana decision: tap exactly these
{ "assign": {"Vanilla 2/2": 2, "Vanilla 5/5": 1} }   // damage / counters / mana split by option label
{ "place": {"top": ["A","B"], "toBottom": ["C"]} }    // scry / surveil / reorder
```
`kind`/`player`/`promptContains` are assertions as well as matchers: leave them out unless the *kind* of decision, who is asked, or what is asked is part of what you test. Decision kinds: `choose_modes choose_targets choose_x choose_cards choose_yes_no choose_color choose_option choose_number order_triggers order_library pay_unless pay_mana assign_damage assign_counters assign_mana cast_target_player order_replacements choose_cast_option`. Color options may be given as `Red`/`R`.

If the scenario ends with a decision still open and no `pending` expectation declares it, that is a FAIL: every question the engine opens must be answered by the script.

## Expectations

Each is `{ "check": …, …, "why": "<oracle clause or CR number>" }`. **`why` is required** (>= 10 characters): quote the oracle text clause or the CR rule that makes this expectation true. Place them in `steps[i].expect` (checked right after that action) or the scenario's `expect` (checked at the end).

Comparisons: a **number** field takes `5` (equals) or `{"equals":5,"atLeast":2,"atMost":9}`; a **list** field takes `{"exactly":[…],"atLeast":[…],"noneOf":[…]}` (any combination, case-insensitive, duplicates count: `["Plains","Plains"]` means two).

| `check` | fields |
|---|---|
| `life` | `player`, `value` |
| `zone` | `player`, `zone` (hand battlefield graveyard exile library command), `cards` (list), `count` (number), `ordered` (with `cards.exactly`: top-first order, library). Battlefield = permanents the player **controls**; tokens by token name |
| `permanent` | `ref`, then any of: `exists`, `zone`, `controller`, `owner`, `name`, `power`, `toughness`, `manaValue`, `damage` (numbers); `types`, `subtypes`, `supertypes`, `keywords`, `colors` (lists, **effective values after all layers**; colors `white` or `W`); `abilityText` (list of substrings of the object's current abilities), `abilitiesStripped`, `tapped`, `summoningSick`, `faceDown`, `token`, `attacking`, `blocking` (booleans); `attachedTo` (reference or `null`), `attachments` (list of names); `counters` (`{"age": 2}`, absent = 0); `unlocked` (list of Room door names), `chosenColor` |
| `tokens` | `player`, optional `name`, `count`, `power`, `toughness`, `types`, `subtypes`, `colors`, `keywords`, `tapped`: **every** token the player controls with that name must satisfy the per-token fields; `count` counts them |
| `stack` | `items` (list), `count`, `topFirst` (exact order). Items: `Lightning Bolt (spell)`, `Mystic Remora (triggered)`, `Chatterfang, Squirrel General (activated)`; without the `(kind)` suffix any kind matches |
| `pending` | `present`, then `kind`, `player`, `promptContains`, `options` (list of option labels), `min`, `max` |
| `pool` | `player`, `equals` (`{"U":1}`, unlisted colors must be 0), `atLeast`, `total` |
| `turn` | `active`, `phase`, `number` |
| `player` | `player`, `hasLost`, `monarch`, `counters` |
| `game` | `over`, `winner` |
| `log` | `contains` / `absent`: lists of substrings looked for in the event lines (`since`: `scenario` or `lastAction`). Lines look like `damage_dealt source=Lightning Bolt target=p2 amount=3`; prefer state expectations, the event vocabulary is the engine's |
| `events` | `type`, `where` (field -> value), `count` (default at least 1), `since` |
| `legal` | `player`, `action` (`cast`/`playLand`/`activate`), `card`, `ability`, `free`, `exists`: does the player have this legal action right now |
| `noUnresolved` | the engine reported nothing it could not run. (Even without this check an `unresolved` event makes the scenario UNSUPPORTED) |

## Statuses

| status | meaning |
|---|---|
| PASS | everything held |
| FAIL | an expectation did not hold, a scripted action was refused / not offered, a scripted target / option does not exist, an expected refusal did not happen, a decision was left open. The card or engine disagrees with the oracle text (or the spec is wrong: triage decides, see card-spec-triage.md) |
| SPEC ERROR | the spec is malformed or refers to something that does not exist in its own setup (schema violation, unknown card, unresolvable object reference, a setup player not in the game) |
| UNSUPPORTED | the engine said it cannot run something the card says (`unresolved` event / `unsupported` error), or the card under test has no kernel draft |

Every FAIL prints: where (setup / step n / final), the check, the `why`, expected, actual, the action log, the last events and the stack at the end.

### Status and known failures

`status: "draft"` files are work in progress (run them by hand). `status: "accepted"` files are run by `npx vitest run src/kernel/spec` as permanent regression tests. A scenario that documents a **real, not yet fixed bug** carries `knownFailure: "ENGINE BUG: …"`: the wrapper stays green while it still fails and turns red when it starts to pass (remove the field then). Never loosen a correct expectation to make it green.

## Running

```
npm run kernel:spec                                  # every file
npm run kernel:spec -- --deck Aminatou               # the specs of the deck's cards (that deck's drafts), plus which cards have no spec yet
npm run kernel:spec -- --card "Mystic Remora"        # one card (also finds files that list it under "cards")
npm run kernel:spec -- --file path/to/x.spec.json    # one file anywhere
npm run kernel:spec -- --scenario "pays"             # scenario names containing the text
npm run kernel:spec -- --status accepted             # only accepted / draft files
npm run kernel:spec -- --changed                     # spec files newer than the last saved run
npm run kernel:spec -- --json                        # machine-readable results on stdout
options: --verbose (also detail for known failures)  --no-save (do not write results)
```
Results are saved to `data/kernel-specs/_results/<timestamp>.json` and `.md` (grouped by card, failures first). Exit code 1 if anything is not green. Scenarios run in-process, deterministic (fixed seed), with a watchdog (3000 engine calls / 20 s) so nothing hangs.

## Example (Lightning Bolt, shortened)

```json
{
  "card": "Lightning Bolt", "status": "accepted",
  "scenarios": [{
    "name": "Bolt to the face",
    "setup": { "p1": { "hand": ["Lightning Bolt"], "battlefield": ["Mountain"] } },
    "steps": [
      { "do": "cast", "player": "p1", "card": "Lightning Bolt", "targets": ["p2"],
        "expect": [{ "check": "stack", "items": { "exactly": ["Lightning Bolt (spell)"] }, "why": "CR 601.2a: a cast spell is on the stack until it resolves" }] },
      { "do": "resolve" }
    ],
    "expect": [
      { "check": "life", "player": "p2", "value": 37, "why": "Oracle: deals 3 damage to any target (p2 starts at 40)" },
      { "check": "zone", "player": "p1", "zone": "graveyard", "cards": { "exactly": ["Lightning Bolt"] }, "why": "CR 608.2m: an instant goes to its owner's graveyard as the last step of resolving" }
    ]
  }]
}
```
More worked examples, including hard cases (Remora's cumulative upkeep and `unless` payment in 4 players, Plaguecrafter's sequencing, a chosen-colour land, a free-cast permission, Chatterfang's replacement stopped by an Aura, a Room with locked doors): `data/kernel-specs/*.spec.json`.
