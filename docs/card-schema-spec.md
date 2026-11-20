# Card schema v2 - design spec (Phase 0 of TODO_card_parsing.md)

Status: DRAFT for user review. Nothing here is implemented. No source, DB or deck file was changed.

Goal: one JSON shape per card that is complete enough for a deterministic kernel
`resolve(gameState, {card, player, phase, inResponseTo}) -> {outcome, newState | pendingDecision}`
to act on with no oracle-text re-reading. The LLM drafts rows; the validator (section 4) and the
user approve them.

Today's shape (for reference): `AbilitySchema` (`src/lib/cardParser.ts:42`) = `{kind, triggerEvent,
condition: string, cost: string, text, steps[], declined, optional}`; steps are the 20 kinds in
`src/lib/primitiveActionPlan.ts:61`. Why Sphinx's Insight is wrong today: the "Addendum" sentence has
nowhere to put "only if cast in a main phase", so `condition` stays `""` and the `life_change` step runs always.

Design rules:
1. Additive. Every v1 field keeps its name and meaning; v2 adds fields. A v1 row is a valid v2 row
   with `schemaVersion` absent (treated as "unverified").
2. Closed vocabularies. Conditions, quantities, filters, events are enums + small objects. Anything
   outside them is written as `{"unsupported": "<exact text>"}`, which blocks `verified` (section 4).
3. Every ability carries its exact oracle line in `text` and every step/condition says which sentence
   it covers (`src`), so coverage is checkable by machine.

---------------------------------------------------------------------------------------------------
## 1. Schema

```ts
// ---------- shared building blocks ----------
type PlayerRef = "you" | "opponent" | "each_opponent" | "each_player" | "target_player"
               | "controller_of_target" | "owner_of_target" | "that_player" /* event's player */;
type ObjRef    = "self" | "equipped" | "enchanted" | "event_object" | "chosen" | `t${number}`; // t1 = targets[0]
type Zone      = "battlefield"|"hand"|"library"|"graveyard"|"exile"|"stack"|"command";
type Cmp       = { op: "<"|"<="|"="|">="|">"; value: Quantity };

// Numbers. A bare number is a constant; the object forms are computed at resolution time.
type Quantity = number
  | { ref: "X" }                                   // X paid / chosen
  | { ref: "count"; of: ObjectFilter }             // "number of Squirrels you control"
  | { ref: "devotion"; color: "W"|"U"|"B"|"R"|"G" }
  | { ref: "stat"; of: ObjRef; stat: "power"|"toughness"|"mana_value" }
  | { ref: "counters"; kind: string; on: ObjRef | PlayerRef }   // incl. experience, energy
  | { ref: "life_lost_this_way" } | { ref: "event_amount" }      // "that much", "that many"
  | { ref: "greatest"|"sum"; of: ObjectFilter; stat: string }
  | { math: "+"|"-"|"*"|"min"|"max"; args: Quantity[] };

type ObjectFilter = {
  types?: string[]; notTypes?: string[]; subtypes?: string[]; supertypes?: string[];   // "nonbasic" = notSupertypes
  notSupertypes?: string[]; colors?: string[]; notColors?: string[];
  controller?: "you"|"opponent"|"any";     // default any
  owner?: "you"|"opponent"|"any";
  zone?: Zone;                              // default battlefield
  another?: boolean;                        // "another" / "other"
  token?: boolean; tapped?: boolean; attacking?: boolean; hasCounter?: string;
  mv?: Cmp; power?: Cmp; toughness?: Cmp;
  named?: string;                           // "Squirrel tokens" are subtypes+token, not named
  with?: string[];                          // keywords: "flying"
};

// ---------- conditions (replaces the free string) ----------
type Predicate =
  | { check: "cast_during"; phase: "main"|"combat"|"your_turn"|"opponent_turn"|"end_step" }  // Addendum
  | { check: "cast_from"; zone: Zone }
  | { check: "turn_is"; whose: "yours"|"opponents" }
  | { check: "phase_is"; phase: Phase }
  | { check: "nth_this_turn"; event: EventName; n: number; actor: PlayerRef; filter?: ObjectFilter } // "second spell each turn"
  | { check: "controls"; filter: ObjectFilter; count?: Cmp }
  | { check: "life"; who: PlayerRef; cmp: Cmp }
  | { check: "zone_count"; who: PlayerRef; zone: Zone; filter?: ObjectFilter; cmp: Cmp }       // threshold, delirium
  | { check: "did_this_turn"; event: EventName; actor: PlayerRef; cmp?: Cmp }
  | { check: "stat"; of: ObjRef; stat: string; cmp: Cmp }       // "if that card's MV <= experience counters"
  | { check: "matches"; obj: ObjRef; filter: ObjectFilter }     // "if it's a creature"
  | { check: "kicked"|"paid_additional_cost"; option?: string }
  | { check: "source_state"; state: "tapped"|"attacking"|"on_battlefield"|"equipped" }
  | { all: Predicate[] } | { any: Predicate[] } | { not: Predicate }
  | { unsupported: string };

// `when` = at which moment it is evaluated. This is the field the TODO asks for.
type Condition = {
  when: "on_cast"          // legality of casting/activating (also timing restrictions, see Timing)
      | "on_trigger"       // does the trigger fire at all (event filter + intervening-if, 1st check)
      | "on_resolution"    // evaluated as the effect resolves (Addendum, "if you do", "if X >= 5")
      | "static";          // continuously ("as long as ...")
  if: Predicate;
  src?: number;            // index of the oracle sentence it covers
};

// ---------- timing / speed ----------
type Timing = {
  speed?: "instant"|"sorcery"|"flash"|"default";     // default = derived from type line
  only?: Predicate[];                                // "only during your turn", "before attackers are declared"
  limit?: { count: number; per: "turn"|"game"|"each_combat" };  // "Activate only once each turn"
  window?: { event: "drawn"; firstThisTurn?: boolean } | { event: "exiled_by_this" } // miracle, impulse draw
};

// ---------- targets ----------
type TargetSpec = {
  id: `t${number}`;
  what: "object"|"player"|"any";           // any = creature/planeswalker/battle/player (damage)
  filter?: ObjectFilter;                   // controller filter lives here: {controller:"opponent"}
  count: { min: number; max: number };     // "up to two" = {0,2}; "another target" => filter.another
  distinct?: boolean;
};

// ---------- modes ----------
type Modes = {
  choose: { min: number; max: number };    // "choose one" {1,1}; "one or more" {1,5}; "choose two" {2,2}
  distinct: boolean;                       // true unless text says "You may choose the same mode more than once"
  options: Array<{ id: string; text: string; targets?: TargetSpec[]; steps: Step[]; src?: number }>;
  // ability-level targets/steps are then empty; each option owns its own.
};

// ---------- costs ----------
type Cost =
  | { mana: string }                                         // "{1}{G}" or "{X}{1}{U}" (X allowed)
  | { tap: "self" } | { untap: "self" }
  | { tapOther: ObjectFilter; count: Quantity }              // convoke-like, "tap an untapped Elf you control"
  | { sacrifice: "self" | ObjectFilter; count: Quantity }    // "Sacrifice X Squirrels" count={ref:"X"}
  | { discard: "self" | ObjectFilter | "hand"; count: Quantity }
  | { life: Quantity }
  | { exileFrom: Zone; what: "self" | ObjectFilter; count: Quantity }   // exile from graveyard
  | { returnToHand: "self" | ObjectFilter; count: Quantity }
  | { counters: { kind: string; count: Quantity; remove: boolean; from: "self" } }
  | { reveal: "self" | ObjectFilter } | { energy: number };
type CostReduction = { per: ObjectFilter; amount: number; applies: "generic"|"any" }; // "costs {1} less per legendary creature"

// ---------- additional / alternative costs, cast options (card level) ----------
type CastOption = {
  id: string;
  kind: "additional" | "alternative" | "kicker" | "flashback" | "escape" | "miracle"
      | "evoke" | "overload" | "madness" | "convoke" | "cast_from_zone";
  from: Zone;                         // flashback/escape = graveyard, miracle = hand
  cost: Cost[];                       // total cost for "alternative"/flashback/escape/miracle; extra for "additional"/kicker
  replacesManaCost: boolean;
  when?: Timing["window"];            // miracle: {event:"drawn", firstThisTurn:true}
  afterResolution?: "exile";          // flashback, Temporal Mastery "Exile ~"
  effects?: { addSteps?: Step[]; replaceSteps?: Step[]; ifPaid?: Condition[] };   // kicker adds, overload rewrites
  optional: true;                     // always a player choice
};

// ---------- triggers ----------
type EventName = "etb"|"leaves"|"dies"|"cast"|"draw"|"discard"|"attack"|"block"|"deals_damage"
  | "deals_combat_damage_to_player"|"begin_step"|"gain_life"|"lose_life"|"token_created"
  | "counter_put"|"sacrifice"|"exploit"|"cycle"|"tap"|"landfall"|"becomes_target"|"activate"|"mill"|"unspecified";
type TriggerSpec = {
  event: EventName;
  subject?: ObjectFilter | PlayerRef | "self";   // who/what the event happens to ("another creature you control")
  step?: Phase;                                  // for begin_step ("your end step")
  whose?: "yours"|"opponents"|"each";
  nth?: { n: number; per: "turn"|"game" };
  interveningIf?: Predicate;                     // checked on trigger AND on resolution (rule 603.4)
  fromZone?: Zone; toZone?: Zone;
};

// ---------- replacement / prevention ----------
type ReplacementSpec = {
  event: "would_create_token"|"would_die"|"would_be_put_into_zone"|"would_draw"|"would_gain_life"
       |"would_lose_life"|"would_deal_damage"|"would_enter"|"would_discard"|"would_become_tapped";
  subject?: ObjectFilter | PlayerRef;           // "tokens you would create", "a card an opponent would put into a graveyard"
  fromZone?: Zone; toZone?: Zone;
  result: { mode: "instead"; steps: Step[] }    // exile it instead
        | { mode: "also";    steps: Step[] }    // original happens plus extra (Chatterfang, Academy Manufactor)
        | { mode: "modify";  set: Record<string, unknown> }  // enters tapped, enters with N counters, x2 amounts
        | { mode: "prevent" };                  // prevention = replacement with no result
  optional?: boolean;                           // "you may"; affected player chooses ordering per rule 616.1
  condition?: Predicate;
};

// ---------- the ability (extends v1 AbilitySchema) ----------
type Ability = {
  // v1 fields, unchanged: kind, triggerEvent, condition(string), cost(string), text, steps, declined, optional
  id: string;                                   // "a1".. stable key for coverage + tests
  kind: "spell_effect"|"activated"|"triggered"|"static"|"keyword"|"replacement"|"mana"
      | "cast_option"|"scripted";
  text: string;                                 // exact oracle line (reminder text may be stripped)
  zone?: Zone;                                  // where it is usable; default battlefield. channel/cycling = "hand"
  timing?: Timing;
  costs?: Cost[];  costReduction?: CostReduction;
  trigger?: TriggerSpec;                        // kind=triggered
  conditions?: Condition[];                     // replaces string `condition`
  targets?: TargetSpec[];
  modes?: Modes;
  steps?: Step[];                               // v1 steps, widened (below)
  replacement?: ReplacementSpec;                // kind=replacement
  static?: StaticSpec;                          // kind=static
  mana?: { produces: ManaSpec[] };              // kind=mana: no stack, resolves immediately
  optional?: boolean;                           // "you may" for the whole ability
  keyword?: { name: string; param?: string | number };  // kind=keyword; flying, equip, exploit...
  scripted?: { handler: string };               // escape hatch, section 5 Q2
  declined?: boolean;                           // only legal if the validator can't verify
};
type Card = { schemaVersion: 2; abilities: Ability[]; castOptions?: CastOption[];
              review?: { status: "draft"|"verified"; by?: string; at?: string; coverage?: CoverageReport } };

// ---------- static / continuous ----------
type StaticSpec = {
  affects: ObjRef | ObjectFilter | PlayerRef;                 // "equipped creature", "creatures you control"
  modify: Array<
    | { pt: { power: Quantity; toughness: Quantity } }
    | { grant: string /*keyword*/ } | { grantAbility: Ability } | { lose: string }
    | { setTypes: string[] } | { cant: "attack"|"block"|"be_blocked"|"be_countered"|"cast"|"gain_life"|"search" ; except?: ObjectFilter }
    | { evasion: { cantBeBlockedBy?: ObjectFilter; unlessDefenderControls?: ObjectFilter } }
    | { costMod: { filter: ObjectFilter; delta: number } } | { copyOf: ObjRef } >;
  while?: Predicate;                                          // "as long as ..."
  duration?: Duration;                                        // default "while_source_on_battlefield"
};

type Duration = "instant" | "until_end_of_turn" | "until_your_next_turn" | "while_source_on_battlefield"
              | "while_attached" | { until: EventName } | { forAsLongAs: Predicate };

// ---------- mana ----------
type ManaSpec = { colors: string }                           // "{B}{G}" fixed
              | { anyColor: number; restriction?: ObjectFilter }
              | { perCount: ObjectFilter; color: string };   // "{G} for each Forest"
```

### Step vocabulary (reuse the 20 existing + additions)

Every step additionally gets: `id?`, `src?` (sentence index), `who?: PlayerRef`, `target?: ObjRef`,
`optional?: boolean` ("you may"), `condition?: Condition` (always `when:"on_resolution"` here),
`unlessPay?: {payer: PlayerRef; cost: Cost[]}` ("draw a card unless that player pays"),
`duration?: Duration`, `amount: Quantity` (widened from int; legacy ints still valid).

Kept as-is (v1 names and fields): destroy_target, destroy_all, exile_target, bounce_target, reanimate,
mill, draw_cards, life_change, drain, damage_target, discard, tap_target, untap_target, pump_target,
mass_pump, mass_bounce, create_tokens, put_counters_on_self, sacrifice_permanent, move_card_zone.
`pump_target.power/toughness` widen to Quantity; `create_tokens.tokenCount` widens; `duration` added.

New kinds needed by the 16 examples (and most of the 399 cards):

| kind | purpose | key fields |
|---|---|---|
| `search_library` | tutors, Sakura-Tribe Elder, Boseiju's reward | `who, filter, count, to: Zone, tapped?, reveal?, shuffle` |
| `add_counters` / `remove_counters` | counters on any object/player (generalizes put_counters_on_self) | `kind, amount, on: ObjRef/PlayerRef` |
| `extra_turn` | Temporal Mastery | `who, count` |
| `connive` | Ledger Shredder (draw, discard, +1 counter if nonland) | `on: ObjRef` |
| `exploit` | sacrifice a creature on ETB, emits `exploit` event | `optional:true` (event consumed by a trigger) |
| `attach` | Auras/equipment re-attach, Animate Dead | `what: ObjRef, to: ObjRef` |
| `gain_control` | threaten effects, Kenrith's Transformation-style | `target, duration` |
| `grant_effect` | temporary keyword/ability/static ("gains indestructible until EOT") | `target, modify: StaticSpec["modify"], duration` |
| `permission_to_play` | "you may play it this turn without paying" (Dauthi) | `what: ObjRef, zone, withoutPaying, duration` |
| `choose` | pick a card/object/color/number, bind it to `chosen` | `from: ObjectFilter, zone, count, saveAs` |
| `add_mana` | mana abilities | `produces: ManaSpec[]` |
| `create_delayed_trigger` | "at the beginning of the next end step ..." | `trigger: TriggerSpec, steps` |
| `counter_spell` | counterspells (currently hand-coded) | `target, unlessPay?` |
| `copy` | copy spell/permanent | `what, controller` |
| `scry` / `surveil` / `look_top` | library manipulation | `amount, to` |
| `repeat_for_each` | "for each X, do Y" | `over: ObjectFilter, steps` |
| `shuffle` / `reveal` / `transform` / `set_life` | minor | |
| `if_else` | branch inside steps | `if: Predicate, then: Step[], else?: Step[]` |

---------------------------------------------------------------------------------------------------
## 2. Migration of existing rows

- Row marker: `parsed_cards.abilities` JSON stays an array for v1; v2 stores `{schemaVersion:2, abilities, castOptions, review}`
  in the same column (reader checks `Array.isArray`). No DB column change is needed for Phase 0-3.
- Adapter `liftV1(ability) -> v2` (pure function, runs at read time):
  - `condition` string non-empty -> `conditions:[{when:"on_resolution", if:{unsupported: condition}}]`. It still works as today but cannot be `verified`.
  - `cost` string -> `costs:[{mana: ...}]` only if it parses as pure mana; otherwise `[{unsupported}]`.
  - `triggerEvent` -> `trigger.event`; `kind:"activated"` with `Add {` in text -> `kind:"mana"`.
  - `declined:true` stays; the kernel treats it as "no deterministic outcome, ask the user / fall back to the legacy path".
  - v1 steps are accepted verbatim (superset). `targetType`, `damageTargetType` map to a synthesized `targets[0]` (`"creature"` -> `{what:"object", filter:{types:["creature"]}, count:{1,1}}`).
- Rows stay `review.status:"draft"` until the validator passes and the user approves. Kernel flag: v1/draft rows go to the old engine path, verified v2 rows to the kernel (matches the Phase 4 "per-deck flag").
- The 30k catalog stays v1 and is lifted lazily when a card enters a deck (see Q3).
- Legacy `optional` (ability-level) is kept; step-level `optional` is new.

---------------------------------------------------------------------------------------------------
## 3. Worked examples (all in the 13 decks)

Notation: `// GAP` marks an oracle clause the schema cannot yet express. `src` = sentence index within the line.

### 3.1 Sphinx's Insight (timing/addendum; current row WRONG)
Oracle: Draw two cards. / Addendum - If you cast this spell during your main phase, you gain 2 life.
```json
{ "schemaVersion": 2, "abilities": [{
  "id":"a1","kind":"spell_effect",
  "text":"Draw two cards.\nAddendum — If you cast this spell during your main phase, you gain 2 life.",
  "steps":[
    {"kind":"draw_cards","amount":2,"who":"you","src":0},
    {"kind":"life_change","lifeDelta":2,"who":"you","src":1,
     "condition":{"when":"on_resolution","if":{"check":"cast_during","phase":"main"},"src":1}}
  ]}]}
```
The kernel's `resolve` input has `phase` and the stack object remembers the phase it was cast in, so `cast_during` is checkable.

### 3.2 Valorous Stance (modal, choose one, targets per mode)
```json
{ "id":"a1","kind":"spell_effect","text":"Choose one — ...",
  "modes":{"choose":{"min":1,"max":1},"distinct":true,"options":[
   {"id":"m1","text":"Target creature gains indestructible until end of turn.",
    "targets":[{"id":"t1","what":"object","filter":{"types":["creature"]},"count":{"min":1,"max":1}}],
    "steps":[{"kind":"grant_effect","target":"t1","modify":[{"grant":"indestructible"}],"duration":"until_end_of_turn"}]},
   {"id":"m2","text":"Destroy target creature with toughness 4 or greater.",
    "targets":[{"id":"t1","what":"object","filter":{"types":["creature"],"toughness":{"op":">=","value":4}},"count":{"min":1,"max":1}}],
    "steps":[{"kind":"destroy_target","target":"t1"}]}]}}
```
3.2b Casualties of War: same with `choose:{min:1,max:5}`, five options, each `destroy_target` with its own `targets` (artifact / creature / enchantment / land / planeswalker). Currently `declined`; fully expressible. Kernel decision: mode choice happens on cast (rule 601.2b), targets are then chosen only for selected modes.

### 3.3 Boseiju, Who Endures (channel land + mana ability) - currently `failed`
```json
{"schemaVersion":2,"abilities":[
 {"id":"a1","kind":"mana","text":"{T}: Add {G}.","costs":[{"tap":"self"}],"mana":{"produces":[{"colors":"{G}"}]}},
 {"id":"a2","kind":"activated","zone":"hand","text":"Channel — {1}{G}, Discard this card: Destroy target artifact, enchantment, or nonbasic land an opponent controls. That player may search their library for a land card with a basic land type, put it onto the battlefield, then shuffle. This ability costs {1} less to activate for each legendary creature you control.",
  "costs":[{"mana":"{1}{G}"},{"discard":"self","count":1}],
  "costReduction":{"per":{"types":["creature"],"supertypes":["legendary"],"controller":"you"},"amount":1,"applies":"generic"},
  "targets":[{"id":"t1","what":"object","count":{"min":1,"max":1},
     "filter":{"controller":"opponent","types":["artifact","enchantment","land"]}}],
     // GAP: "artifact, enchantment, OR nonbasic land" - nonbasic applies only to land. Needs filter union:
     //   filter: {anyOf:[ {types:["artifact"]},{types:["enchantment"]},{types:["land"],notSupertypes:["basic"]} ]}
     // Proposed small addition: ObjectFilter.anyOf?: ObjectFilter[]  (added to the schema above on adoption)
  "steps":[
    {"kind":"destroy_target","target":"t1","src":0},
    {"kind":"search_library","who":"controller_of_target","optional":true,
     "filter":{"types":["land"],"hasBasicLandType":true},"count":1,"to":"battlefield","shuffle":true,"src":1}
     // GAP: "land card with a basic land type" - needs filter field basicLandType:boolean
  ]}]}
```

### 3.4 Temporal Mastery (miracle + exile-self) - ok-but-empty today
```json
{"schemaVersion":2,
 "abilities":[{"id":"a1","kind":"spell_effect","text":"Take an extra turn after this one. Exile Temporal Mastery.",
   "steps":[{"kind":"extra_turn","who":"you","src":0},{"kind":"move_card_zone","target":"self","moveTo":"exile","src":1}]}],
 "castOptions":[{"id":"c1","kind":"miracle","from":"hand","cost":[{"mana":"{1}{U}"}],"replacesManaCost":true,
   "when":{"event":"drawn","firstThisTurn":true},"optional":true}]}
```
Miracle is a trigger-then-cast in real rules (reveal -> trigger -> cast from stack). The kernel models it as a pending decision created at the draw event, matching commit 7df5877 behaviour. Devastation Tide and Redress Fate use the same castOption.

### 3.5 Sidisi, Undead Vizier (exploit; second ability triggers off the first)
```json
{"abilities":[
 {"id":"a1","kind":"keyword","text":"Deathtouch","keyword":{"name":"deathtouch"}},
 {"id":"a2","kind":"triggered","text":"Exploit (...)","keyword":{"name":"exploit"},
  "trigger":{"event":"etb","subject":"self"},"optional":true,
  "steps":[{"kind":"exploit","optional":true,"amount":1}]},
 {"id":"a3","kind":"triggered","text":"When Sidisi exploits a creature, you may search your library for a card, put it into your hand, then shuffle.",
  "trigger":{"event":"exploit","subject":"self"},"optional":true,
  "steps":[{"kind":"search_library","who":"you","filter":{},"count":1,"to":"hand","shuffle":true}]}]}
```
Today both abilities are `etb` triggers with empty steps (so the tutor fires on ETB even without a sacrifice).

### 3.6 Ledger Shredder (connive + Nth-spell trigger)
```json
{"id":"a2","kind":"triggered",
 "text":"Whenever a player casts their second spell each turn, this creature connives.",
 "trigger":{"event":"cast","subject":"each_player","nth":{"n":2,"per":"turn"}},
 "steps":[{"kind":"connive","on":"self"}]}
```
Reminder text ("Draw a card, then discard...") is stripped from validation; `connive` is a kernel-defined composite. Current row expands it into draw+discard and loses the +1/+1 counter. "Each player" with per-player counting: `nth` counts per actor (rule text "their").

### 3.7 Shark Typhoon (X cycling, triggered X token, cycle trigger)
```json
{"abilities":[
 {"id":"a1","kind":"triggered","text":"Whenever you cast a noncreature spell, create an X/X blue Shark creature token with flying, where X is that spell's mana value.",
  "trigger":{"event":"cast","subject":{"notTypes":["creature"]},"whose":"yours"},
  "steps":[{"kind":"create_tokens","tokenCount":1,"tokenName":"Shark","tokenPower":{"ref":"stat","of":"event_object","stat":"mana_value"},
            "tokenToughness":{"ref":"stat","of":"event_object","stat":"mana_value"},"tokenColors":["blue"],"tokenTypeLine":"Creature — Shark","tokenKeywords":["flying"]}]},
 {"id":"a2","kind":"activated","zone":"hand","keyword":{"name":"cycling"},"text":"Cycling {X}{1}{U}",
  "costs":[{"mana":"{X}{1}{U}"},{"discard":"self","count":1}],"steps":[{"kind":"draw_cards","amount":1,"who":"you"}]},
 {"id":"a3","kind":"triggered","text":"When you cycle this card, create an X/X blue Shark creature token with flying.",
  "zone":"hand","trigger":{"event":"cycle","subject":"self"},
  "steps":[{"kind":"create_tokens","tokenCount":1,"tokenName":"Shark","tokenPower":{"ref":"X"},"tokenToughness":{"ref":"X"},"tokenColors":["blue"],"tokenKeywords":["flying"]}]}]}
```
Note v1 `create_tokens` has int power (max 20) and no keywords: current row makes a 1/1 with no flying. Needs `tokenKeywords` and Quantity power. The X for a3 is the X paid for the cycling cost, so the kernel must carry `X` from the activation to the linked trigger ("cycle" event payload includes X). GAP: that link is implicit; the event payload spec `event_amount`/`X` is needed in `TriggerSpec` (noted, small).

### 3.8 Chatterfang (replacement "also" + X-sacrifice activated)
```json
{"abilities":[
 {"id":"a1","kind":"keyword","text":"Forestwalk","keyword":{"name":"landwalk","param":"Forest"}},
 {"id":"a2","kind":"replacement","text":"If one or more tokens would be created under your control, those tokens plus that many 1/1 green Squirrel creature tokens are created instead.",
  "replacement":{"event":"would_create_token","subject":"you",
    "result":{"mode":"also","steps":[{"kind":"create_tokens","tokenCount":{"ref":"event_amount"},"tokenName":"Squirrel","tokenPower":1,"tokenToughness":1,"tokenColors":["green"],"tokenTypeLine":"Creature — Squirrel"}]}}},
 {"id":"a3","kind":"activated","text":"{B}, Sacrifice X Squirrels: Target creature gets +X/-X until end of turn.",
  "costs":[{"mana":"{B}"},{"sacrifice":{"subtypes":["Squirrel"],"controller":"you"},"count":{"ref":"X"}}],
  "targets":[{"id":"t1","what":"object","filter":{"types":["creature"]},"count":{"min":1,"max":1}}],
  "steps":[{"kind":"pump_target","target":"t1","power":{"ref":"X"},"toughness":{"math":"*","args":[-1,{"ref":"X"}]},"duration":"until_end_of_turn"}]}]}
```
Today the replacement is stored as `static` with empty steps (so it is ignored or mishandled). X here is "number sacrificed", chosen at activation (rule 107.3).

### 3.9 Dauthi Voidwalker (replacement-instead with state + sacrifice ability)
```json
{"id":"a2","kind":"replacement","text":"If a card would be put into an opponent's graveyard from anywhere, instead exile it with a void counter on it.",
 "replacement":{"event":"would_be_put_into_zone","subject":{"zone":"any","owner":"opponent"},"toZone":"graveyard",
   "result":{"mode":"instead","steps":[{"kind":"move_card_zone","target":"event_object","moveTo":"exile"},
                                         {"kind":"add_counters","on":"event_object","counterKind":"void","amount":1}]}}},
{"id":"a3","kind":"activated","text":"{T}, Sacrifice this creature: Choose an exiled card an opponent owns with a void counter on it. You may play it this turn without paying its mana cost.",
 "costs":[{"tap":"self"},{"sacrifice":"self","count":1}],
 "steps":[{"kind":"choose","from":{"zone":"exile","owner":"opponent","hasCounter":"void"},"count":1,"saveAs":"chosen"},
          {"kind":"permission_to_play","what":"chosen","withoutPaying":true,"duration":"until_end_of_turn","optional":true}]}
```
Current row: a `dies` trigger with `exile_target` (wrong semantic: replacement fired as a trigger).
GAP: `ObjectFilter.zone:"any"`; the sentence "from anywhere" needs it. Add `"any"` to the filter `zone` type. Tokens also never reach the graveyard, which the kernel handles in zone-move code.

### 3.10 Skullclamp (equipment: static + trigger + equip)
```json
{"abilities":[
 {"id":"a1","kind":"static","text":"Equipped creature gets +1/-1.",
  "static":{"affects":"equipped","modify":[{"pt":{"power":1,"toughness":-1}}]}},
 {"id":"a2","kind":"triggered","text":"Whenever equipped creature dies, draw two cards.",
  "trigger":{"event":"dies","subject":"equipped"},"steps":[{"kind":"draw_cards","amount":2,"who":"you"}]},
 {"id":"a3","kind":"activated","text":"Equip {1}","keyword":{"name":"equip"},
  "timing":{"speed":"sorcery"},"costs":[{"mana":"{1}"}],
  "targets":[{"id":"t1","what":"object","filter":{"types":["creature"],"controller":"you"},"count":{"min":1,"max":1}}],
  "steps":[{"kind":"attach","what":"self","to":"t1"}]}]}
```
Subtle: "dies" for a creature that WAS equipped uses last-known information; kernel spec item, not a schema gap. Today the equip ability has `steps:[]`.

### 3.11 Animate Dead (aura with ETB that rewrites itself) - currently `failed`
```json
{"abilities":[
 {"id":"a1","kind":"spell_effect","text":"Enchant creature card in a graveyard",
  "keyword":{"name":"enchant"},"targets":[{"id":"t1","what":"object","filter":{"types":["creature"],"zone":"graveyard"},"count":{"min":1,"max":1}}]},
 {"id":"a2","kind":"triggered","text":"When this Aura enters, if it's on the battlefield, it loses ... Return enchanted creature card to the battlefield under your control and attach this Aura to it. When this Aura leaves the battlefield, that creature's controller sacrifices it.",
  "trigger":{"event":"etb","subject":"self","interveningIf":{"check":"source_state","state":"on_battlefield"}},
  "steps":[{"kind":"reanimate","target":"enchanted","who":"you"},{"kind":"attach","what":"self","to":"event_object"},
           {"kind":"create_delayed_trigger","trigger":{"event":"leaves","subject":"self"},
            "steps":[{"kind":"sacrifice_permanent","target":"chosen","who":"controller_of_target"}]}]},
 {"id":"a3","kind":"static","text":"Enchanted creature gets -1/-0.","static":{"affects":"enchanted","modify":[{"pt":{"power":-1,"toughness":0}}]}}]}
```
GAP: "it loses 'enchant creature card in a graveyard' and gains 'enchant creature put onto the battlefield with this Aura'" (rewriting the Aura's own enchant restriction). Not expressible; recommend `scripted: {handler:"animate_dead"}` (Q2) or a `rewrite_enchant` step. Only 1-2 cards in the decks need this.

### 3.12 Meren of Clan Nel Toth (commander, two triggers, experience, conditional branch) - currently `failed`
```json
{"abilities":[
 {"id":"a1","kind":"triggered","text":"Whenever another creature you control dies, you get an experience counter.",
  "trigger":{"event":"dies","subject":{"types":["creature"],"controller":"you","another":true}},
  "steps":[{"kind":"add_counters","on":"you","counterKind":"experience","amount":1}]},
 {"id":"a2","kind":"triggered","text":"At the beginning of your end step, choose target creature card in your graveyard. If that card's mana value is less than or equal to the number of experience counters you have, return it to the battlefield. Otherwise, put it into your hand.",
  "trigger":{"event":"begin_step","step":"end_step","whose":"yours"},
  "targets":[{"id":"t1","what":"object","filter":{"types":["creature"],"zone":"graveyard","owner":"you"},"count":{"min":1,"max":1}}],
  "steps":[{"kind":"if_else",
    "if":{"check":"stat","of":"t1","stat":"mana_value","cmp":{"op":"<=","value":{"ref":"counters","kind":"experience","on":"you"}}},
    "then":[{"kind":"reanimate","target":"t1","who":"you"}],
    "else":[{"kind":"move_card_zone","target":"t1","moveTo":"hand"}],"src":1}]}]}
```
If no creature card is in the graveyard, the trigger is removed from the stack (no legal target): kernel rule, no schema field.

### 3.13 Viridescent Bog (mana ability with cost, multi-colour output)
```json
{"id":"a1","kind":"mana","text":"{1}, {T}: Add {B}{G}.","costs":[{"mana":"{1}"},{"tap":"self"}],"mana":{"produces":[{"colors":"{B}{G}"}]}}
```
`kind:"mana"` => no stack, can be activated during cost payment (rule 605). Mana abilities that need a choice use `{anyColor:1}`.

### 3.14 Esper Sentinel (unless-pay with X = source power)
```json
{"id":"a1","kind":"triggered","text":"Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is this creature's power.",
 "trigger":{"event":"cast","subject":{"notTypes":["creature"]},"whose":"opponents","nth":{"n":1,"per":"turn"}},
 "steps":[{"kind":"draw_cards","amount":1,"who":"you",
   "unlessPay":{"payer":"that_player","cost":[{"mana":"{X}"}],"x":{"ref":"stat","of":"self","stat":"power"}}}]}
```
`nth` here counts only noncreature spells ("first noncreature spell"): the `subject` filter is applied BEFORE counting. Needs to be a stated rule in the kernel; also the `unlessPay.x` field is a new addition to the step modifier.

### 3.15 Steel Hellkite (X cost, per-turn limit, conditional filter on event history) - currently `failed`
```json
{"abilities":[
 {"id":"a1","kind":"keyword","text":"Flying","keyword":{"name":"flying"}},
 {"id":"a2","kind":"activated","text":"{2}: This creature gets +1/+0 until end of turn.","costs":[{"mana":"{2}"}],
  "steps":[{"kind":"pump_target","target":"self","power":1,"toughness":0,"duration":"until_end_of_turn"}]},
 {"id":"a3","kind":"activated","text":"{X}: Destroy each nonland permanent with mana value X whose controller was dealt combat damage by this creature this turn. Activate only once each turn.",
  "costs":[{"mana":"{X}"}],"timing":{"limit":{"count":1,"per":"turn"}},
  "steps":[{"kind":"destroy_all","filter":{"notTypes":["land"],"mv":{"op":"=","value":{"ref":"X"}},
            "controllerWasDealtCombatDamageBy":"self"}}]}]}
```
GAP: filter predicate "whose controller was dealt combat damage by this creature this turn" (history query). Proposed: `ObjectFilter.controllerDealtDamageBy?: ObjRef` (kernel keeps a per-turn damage log). v1 `destroy_all` takes only `targetType`, so the `filter` field is a widening of that step.

### 3.16 Boundary: what the schema deliberately cannot do
- "Doubling" replacement chains whose ordering depends on player choice among 3+ effects (rule 616.1): schema is fine, kernel needs a decision prompt.
- Cards that copy/become other cards (clones), "choose a creature type" with persistent memory: needs `choose` + `saveAs` persistence on the permanent (`chosen` lives on the object).
- Layers beyond a simple order (timestamp + dependency): kernel concern.

### Summary of GAPs discovered by the examples (add to the schema on adoption)
1. `ObjectFilter.anyOf`, `basicLandType`, `zone:"any"`, `controllerDealtDamageBy`.
2. `create_tokens`: `tokenKeywords`, Quantity power/toughness.
3. `unlessPay.x`.
4. Linked-ability payload (X of a cycling activation reaching its "when you cycle" trigger).
5. `rewrite_enchant` (or scripted handler) for Animate Dead.

---------------------------------------------------------------------------------------------------
## 4. Validator design (clause coverage)

Input: oracle text (from `cards`), the draft Card JSON. Output: `CoverageReport {status, uncovered[], warnings[]}`;
`verified` requires zero uncovered, zero `unsupported`, zero `declined`.

Pipeline (all deterministic, no LLM):

1. Normalize oracle text: replace card name and "this creature/Aura/..." with `~`; strip reminder text
   (parenthesised) but keep it in a side list for checking keyword abilities; split into lines.
   Strip ability words ("Addendum —", "Channel —", "Landfall —") into a label but keep them as clauses.
2. Segment each line into clauses: split on sentences (`. `), bullet points (`•` -> modes), and
   `, then ` / ` and ` only at the top level of verbs (so "gain 2 life" stays one clause). Each clause gets an index.
3. Line-to-ability matching: every line must be claimed by exactly one ability (`ability.text` equals the
   line after normalization; a line may produce several abilities, e.g. exploit). Unclaimed line => error `LINE_UNCLAIMED`.
4. Clause-to-field matching: every clause index must appear as a `src` on at least one step, condition,
   cost, target, trigger or mode. Unclaimed clause => error `CLAUSE_UNCOVERED` (Sphinx's Insight sentence 1 would be claimed only by life_change, and the next check fires).
5. Trigger-word lexicon (the "ok but wrong" net). A table maps surface words to the field that must be non-empty
   in the SAME clause. Missing field => error `LEXEME_UNBACKED`:

   | lexeme in clause | must exist on the covering node |
   |---|---|
   | "if", "unless", "as long as", "only if", "during your", "Addendum" | `conditions[]` (or `step.condition`, `interveningIf`, `static.while`, `unlessPay`) with non-`unsupported` predicate |
   | "only", "any time you could cast" | `timing.only` / `timing.limit` / `timing.speed` |
   | "may" | `optional:true` on step or ability |
   | "up to", "any number" | `targets[].count.min===0` or step amount `min` |
   | "another", "other" | `filter.another` |
   | "target" | `targets[]` with at least one referenced `tN` by a step |
   | "choose one/two/one or more", "•" | `modes` with matching `choose` and option count == bullet count |
   | "each opponent/player", "all", "each" | a `who` of `each_*` or `destroy_all`/`mass_*`/`repeat_for_each` |
   | "until end of turn", "this turn", "for as long as" | `duration` |
   | "instead", "would" | a `replacement` ability |
   | "X", "that many", "equal to" | a `Quantity` with `ref` (not a bare number) |
   | "At the beginning of", "Whenever", "When" | `trigger` with matching `event`/`step` |
   | `{T}` before a colon | `costs` contains `{tap:"self"}`; and `Add {` => `kind:"mana"` |
   | "Sacrifice", "Discard", "Exile" before a colon | corresponding `costs` atom |
   | "kicker/flashback/escape/miracle/cycling/channel/evoke/overload..." | `castOptions` entry or `zone`-ed activated ability with that keyword |
   | "first/second/third ... each turn" | `trigger.nth` or predicate `nth_this_turn` |

6. Literal cross-check: the multiset of numbers and mana symbols in the clause must equal the multiset in the
   covering nodes (`2` in "gain 2 life" == `lifeDelta:2`; `{1}{G}` == `costs[].mana`; "5 life" == amount 5). Mismatch => `LITERAL_MISMATCH`.
   This alone catches Shark Typhoon's 1/1 token and Kokusho's duplicate 5-life lose+gain.
7. Structural lint: every `tN` referenced is declared; `saveAs`/`chosen` is defined before use; each mode option has
   its own targets/steps; `kind:"mana"` has no targets; triggered abilities have `trigger`; replacement abilities have `replacement`;
   `unsupported` anywhere => status `draft` (never `verified`).
8. Round-trip rendering for human approval: a template renderer turns the JSON back into plain English
   (e.g. "Draw 2 cards. Then, IF this spell was cast during a main phase: you gain 2 life.") and the approval UI
   shows oracle text and rendered text side by side per clause, with the coverage table. The user approves the
   rendering, not raw JSON. Approved rows are written with `review:{status:"verified", by, at, coverage}`.
9. Golden tests (Phase 4): each verified row is stored in the repo as expected JSON; the validator runs in CI.
   Kernel scenario tests per row for the tricky ones (Sphinx cast in main vs on opponent's turn).

Calibration: step 3-4 (structure) are cheap and certain; step 5 (lexicon) has false positives ("if" inside a
reminder) which is acceptable: a false positive costs one manual `ignore: [{lexeme, reason}]` annotation on
the row, a false negative costs a wrong game. Expected tooling: `src/lib/cardValidator.ts` with a pure
`validateCard(oracle, card): CoverageReport`, reused by the Phase 1 audit script.

---------------------------------------------------------------------------------------------------
## 5. Open questions for the user (max 5)

1. Closed vocabulary vs. escape hatch. Should anything the vocabulary cannot express block a card from
   `verified` (my recommendation), or may it carry `{unsupported}` and still be playable behind a warning?
   Recommend: block. Growing the vocabulary is the point; each new `unsupported` pattern in the 399 becomes
   a new Predicate/step kind added once and reused by the catalog.

2. Scripted handlers for the long tail. Cards like Animate Dead, Dauthi Voidwalker's linked "void counter" memory
   or Doubling-Season-style chains fit the schema badly. Allow `kind:"scripted", handler:"<id>"` (TypeScript in the
   kernel, keyed by oracle_id, still clause-covered via `text`), capped and listed in the triage report?
   Recommend: yes, but only with a count budget (say <= 15 cards of the 399) so the kernel does not
   quietly re-become hand-written per-card code.

3. Catalog migration. Keep the 30k catalog on v1 and lift lazily when a card enters a deck (recommended; answers the
   open question already in TODO_card_parsing.md) vs a bulk migration. Recommend lazy lift + the `liftV1` adapter, with
   deck "playable" status requiring all cards `verified` v2.

4. Interaction with the player. The kernel needs to ask for decisions mid-resolution (modes, targets, may-choices,
   replacement ordering, miracle, unless-pay). Should `resolve` return `{status:"pending_decision", decision, resume}`
   (recommended: pure, testable, works for the future multiplayer server) or call back into the UI/AI?
   Recommend the pending-decision return; the same shape the multiplayer server needs later.

5. Approval workflow. LLM drafts -> validator -> user. Do you want to approve every card (399 rows, a few minutes each
   with the English rendering) or only cards the validator flags plus a random sample of 10 percent of clean ones?
   Recommend: approve all cards that have any of triggers/replacement/modes/conditions (about half), auto-approve
   vanilla keyword/mana-only rows that pass the validator, and spot-check the rest.
