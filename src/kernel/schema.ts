// Card schema v2 (see docs/card-schema-spec.md). NEW code only: nothing in the engine, DB or
// existing parsers imports this yet.
//
// Design: closed vocabularies for everything the validator must reason about (conditions,
// quantities, filters, costs, triggers). Steps are `passthrough` so v1 steps (targetType,
// lifeDelta, ...) stay valid verbatim, with the new cross-cutting fields typed.

import { z } from "zod";

// ---------------------------------------------------------------- vocab constants

export const EXISTING_STEP_KINDS = [
  "destroy_target", "destroy_all", "exile_target", "bounce_target", "reanimate", "mill", "draw_cards",
  "life_change", "drain", "damage_target", "discard", "tap_target", "untap_target", "pump_target",
  "mass_pump", "mass_bounce", "create_tokens", "put_counters_on_self", "sacrifice_permanent", "move_card_zone"
] as const;

export const NEW_STEP_KINDS = [
  "search_library", "add_counters", "remove_counters", "extra_turn", "connive", "exploit", "attach",
  "gain_control", "grant_effect", "permission_to_play", "choose", "add_mana", "create_delayed_trigger",
  "counter_spell", "copy", "scry", "surveil", "look_top", "repeat_for_each", "shuffle", "reveal",
  "transform", "set_life", "if_else", "rewrite_enchant",
  // consolidated pass
  "fight", "investigate", "proliferate", "extra_combat",
  // pairing pass: each of several created objects fights a different object from a pool, pairing chosen by the controller
  "fight_pairs",
  // cleanup pass: Will-of-the-council voting, exchange life totals, regenerate, "repeat this process", emblems
  "vote", "exchange_life", "regenerate", "repeat_process", "create_emblem",
  // round 2: manifest dread (face-down 2/2 from the top two cards)
  "manifest_dread", "reselect_attack_target"
] as const;

export const STEP_KINDS = [...EXISTING_STEP_KINDS, ...NEW_STEP_KINDS] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const PHASES = [
  "untap", "upkeep", "draw", "main", "beginning_of_combat", "combat", "declare_attackers", "declare_blockers",
  "first_strike_damage", "combat_damage", "end_of_combat", "end_step", "cleanup",
  // "your first main phase" / "your second main phase"
  "precombat_main", "postcombat_main"
] as const;
export type Phase = (typeof PHASES)[number];

export const EVENT_NAMES = [
  "etb", "leaves", "dies", "cast", "draw", "discard", "attack", "block", "deals_damage",
  "deals_combat_damage_to_player", "begin_step", "gain_life", "lose_life", "token_created", "counter_put",
  "sacrifice", "exploit", "cycle", "tap", "landfall", "becomes_target", "activate", "mill", "unspecified",
  // "is dealt damage" (the damaged object; deals_damage is the dealer) and "commits a crime"
  "dealt_damage", "commit_crime",
  // "whenever damage that would be dealt to you is prevented" (event_amount = the amount prevented)
  "damage_prevented"
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

const PLAYER_REFS = [
  "you", "opponent", "each_opponent", "each_player", "target_player", "controller_of_target",
  "owner_of_target", "that_player"
] as const;
export const PlayerRefSchema = z.enum(PLAYER_REFS);
export type PlayerRef = z.infer<typeof PlayerRefSchema>;

export const ObjRefSchema = z.union([
  // sacrificed = the object sacrificed as a cost (last known information); created = the token created by the previous step; iterated = the current object of the enclosing repeat_for_each
  z.enum(["self", "equipped", "enchanted", "event_object", "chosen", "linked_exile", "sacrificed", "created", "iterated",
    // vote_winners = the objects that got the most votes (all of them when tied) in the previous `vote` step
    "vote_winners"]),
  z.string().regex(/^t\d+$/)
]);
export type ObjRef = z.infer<typeof ObjRefSchema>;

const ZONES = ["battlefield", "hand", "library", "graveyard", "exile", "stack", "command"] as const;
export const ZoneSchema = z.enum(ZONES);
export type Zone = z.infer<typeof ZoneSchema>;
const FilterZoneSchema = z.enum([...ZONES, "any"]);

const int = z.number().int();
const srcField = int.min(0).optional();

// ---------------------------------------------------------------- prompts (Phase 0b)

export const PromptSchema = z.object({
  title: z.string().min(1),
  instruction: z.string().min(1),
  // the card/ability the decision comes from (filled by the generator)
  source: z.object({ card: z.string().optional(), ability: z.string().optional() }).strict().optional()
}).strict();
export type Prompt = z.infer<typeof PromptSchema>;

// ---------------------------------------------------------------- recursive types

export type Cmp = { op: "<" | "<=" | "=" | ">=" | ">"; value: Quantity };

export type Quantity =
  | number
  | { ref: "X" }
  | { ref: "count"; of: ObjectFilter }
  // several colours = ONE count of symbols that are any of them (a hybrid {W/B} symbol counts once): "devotion to white and black"
  | { ref: "devotion"; color: "W" | "U" | "B" | "R" | "G" | ("W" | "U" | "B" | "R" | "G")[] }
  // cleanup pass: number of opponents; "for each X destroyed/sacrificed/exiled this way" (objects or amount a step affected);
  // how many times a step ran; life points gained this turn
  | { ref: "opponents_count" }
  | { ref: "step_result"; step: string }
  | { ref: "step_count"; step: string }
  | { ref: "life_gained_this_turn"; who: PlayerRef }
  | { ref: "stat"; of: ObjRef; stat: "power" | "toughness" | "mana_value" }
  | { ref: "counters"; kind: string; on: ObjRef | PlayerRef }
  | { ref: "life_lost_this_way" }
  | { ref: "event_amount" }
  | { ref: "commander_colors" }
  | { ref: "greatest" | "sum"; of: ObjectFilter; stat: string }
  // a player's life total ("has more life than you"), and the format's starting life ("starting life total" = 40 in Commander)
  | { ref: "life_total"; who: PlayerRef }
  | { ref: "starting_life" }
  // how many times <event> happened this turn, optionally only for objects matching `filter` / by `actor`
  // ("the number of nontoken creatures that died this turn")
  | { ref: "count_this_turn"; event: EventName; filter?: ObjectFilter; actor?: PlayerRef }
  // how many players of `who` satisfy `where` (evaluated with "that_player" = the player being tested)
  | { ref: "players_count"; who: PlayerRef; where: Predicate }
  // div_down / div_up: args[0] divided by args[1], rounded down / up ("half X, rounded down")
  | { math: "+" | "-" | "*" | "min" | "max" | "div_down" | "div_up"; args: Quantity[] };

export interface ObjectFilter {
  types?: string[]; notTypes?: string[]; subtypes?: string[]; supertypes?: string[];
  notSupertypes?: string[]; colors?: string[]; notColors?: string[];
  controller?: "you" | "opponent" | "any" | "defending_player" | "that_player" | "active_player"; // defending_player: the player the source creature is attacking; that_player: the player of the enclosing loop/event; active_player: the player whose turn it is
  owner?: "you" | "opponent" | "any";
  zone?: Zone | "any";
  // colored: true = "one or more colors", false = colorless
  colored?: boolean;
  another?: boolean; token?: boolean; tapped?: boolean; attacking?: boolean; hasCounter?: string;
  mv?: Cmp; power?: Cmp; toughness?: Cmp;
  named?: string;
  with?: string[];
  // GAPs adopted from spec section 3 summary
  anyOf?: ObjectFilter[];
  hasBasicLandType?: boolean;
  controllerDealtDamageBy?: ObjRef;
  // consolidated pass
  notSubtypes?: string[];          // "non-Zombie"
  without?: string[];              // keyword negation: "without flying"
  isCommander?: boolean;           // "your commander", "a commander you control"
  sameName?: boolean;              // group qualifier: the matching objects all share one name ("three lands with the same name")
  sharesCreatureTypeWith?: ObjRef; // "shares a creature type with it"
  chosenType?: boolean;            // has the creature type remembered by the source (see step choose + remember)
  chosenColor?: boolean;           // is the color remembered by the source
  attackingYou?: boolean;          // "attacking you" (the controller of the ability)
  // cleanup pass
  blocking?: boolean;              // "blocking creature" (attacking OR blocking = anyOf)
  enteredThisTurn?: boolean;       // "entered the battlefield this turn"
  attackingOpponent?: boolean;     // "attacking one of your opponents" (not you or your planeswalkers)
  sameNameAs?: ObjRef;             // has the same name as <ref> ("same name as that permanent")
}

export type Predicate =
  | { check: "cast_during"; phase: "main" | "your_main" | "combat" | "your_turn" | "opponent_turn" | "end_step" }
  | { check: "cast_from"; zone: Zone }
  | { check: "turn_is"; whose: "yours" | "opponents" }
  | { check: "phase_is"; phase: Phase }
  | { check: "nth_this_turn"; event: EventName; n: number; actor: PlayerRef; filter?: ObjectFilter }
  | { check: "controls"; filter: ObjectFilter; count?: Cmp }
  | { check: "life"; who: PlayerRef; cmp: Cmp }
  | { check: "zone_count"; who: PlayerRef; zone: Zone; filter?: ObjectFilter; cmp: Cmp }
  | { check: "did_this_turn"; event: EventName; actor: PlayerRef; cmp?: Cmp }
  | { check: "stat"; of: ObjRef; stat: string; cmp: Cmp }
  | { check: "matches"; obj: ObjRef; filter: ObjectFilter }
  | { check: "kicked" | "paid_additional_cost"; option?: string }
  | { check: "source_state"; state: "tapped" | "attacking" | "on_battlefield" | "equipped" }
  // consolidated pass
  | { check: "compare"; left: Quantity; cmp: Cmp }                       // any two quantities ("total power 8 or greater")
  | { check: "turn_number"; scope: "game" | "yours"; cmp: Cmp }            // game turn number / "your Nth turn of the game"
  | { check: "chosen_is"; kind: "mode" | "color" | "creature_type" | "card_type" | "basic_land_type" | "card_name"; value: string } // the option remembered by the source
  | { check: "most_life"; who: PlayerRef }                                // has the most life or is tied for most life (among all players)
  | { check: "step_done"; step: string; who?: PlayerRef }                 // "if you do": an earlier optional step (by id) was performed; `who` = by that player (per-player loops)
  // cleanup pass
  | { check: "mana_spent"; color: "W" | "U" | "B" | "R" | "G" | "C"; cmp?: Cmp } // "if {B} was spent to cast this spell" (cmp = how many symbols of that colour)
  | { check: "cast_with"; option: string }                                // "was cast with escape / flashback / evoke ..."
  | { check: "name_matches"; obj: ObjRef; among: ObjectFilter[] }         // obj has the same name as some object matching any of the filters (negate with `not`)
  | { check: "attacked_defender"; defender: "you" | "you_or_your_planeswalkers"; who: "all" | "none" | "any" } // of the attackers in this trigger, did all/none/any attack you?
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate }
  | { unsupported: string };

// ---------------------------------------------------------------- recursive schemas

export const QuantitySchema: z.ZodType<Quantity> = z.lazy(() =>
  z.union([
    z.number(),
    z.object({ ref: z.literal("X") }).strict(),
    z.object({ ref: z.literal("count"), of: ObjectFilterSchema }).strict(),
    z.object({ ref: z.literal("devotion"), color: z.union([z.enum(["W", "U", "B", "R", "G"]), z.array(z.enum(["W", "U", "B", "R", "G"])).min(1)]) }).strict(),
    z.object({ ref: z.literal("opponents_count") }).strict(),
    z.object({ ref: z.literal("step_result"), step: z.string() }).strict(),
    z.object({ ref: z.literal("step_count"), step: z.string() }).strict(),
    z.object({ ref: z.literal("life_gained_this_turn"), who: PlayerRefSchema }).strict(),
    z.object({ ref: z.literal("stat"), of: ObjRefSchema, stat: z.enum(["power", "toughness", "mana_value"]) }).strict(),
    z.object({ ref: z.literal("counters"), kind: z.string(), on: z.union([ObjRefSchema, PlayerRefSchema]) }).strict(),
    z.object({ ref: z.literal("life_lost_this_way") }).strict(),
    z.object({ ref: z.literal("event_amount") }).strict(),
    z.object({ ref: z.literal("commander_colors") }).strict(),
    z.object({ ref: z.enum(["greatest", "sum"]), of: ObjectFilterSchema, stat: z.string() }).strict(),
    z.object({ ref: z.literal("life_total"), who: PlayerRefSchema }).strict(),
    z.object({ ref: z.literal("starting_life") }).strict(),
    z.object({ ref: z.literal("count_this_turn"), event: z.enum(EVENT_NAMES), filter: ObjectFilterSchema.optional(), actor: PlayerRefSchema.optional() }).strict(),
    z.object({ ref: z.literal("players_count"), who: PlayerRefSchema, where: PredicateSchema }).strict(),
    z.object({ math: z.enum(["+", "-", "*", "min", "max", "div_down", "div_up"]), args: z.array(QuantitySchema) }).strict()
  ])
) as z.ZodType<Quantity>;

export const CmpSchema: z.ZodType<Cmp> = z.lazy(() =>
  z.object({ op: z.enum(["<", "<=", "=", ">=", ">"]), value: QuantitySchema }).strict()
);

const strArr = z.array(z.string());
export const ObjectFilterSchema: z.ZodType<ObjectFilter> = z.lazy(() =>
  z.object({
    types: strArr.optional(), notTypes: strArr.optional(), subtypes: strArr.optional(),
    supertypes: strArr.optional(), notSupertypes: strArr.optional(), colors: strArr.optional(),
    notColors: strArr.optional(),
    controller: z.enum(["you", "opponent", "any", "defending_player", "that_player", "active_player"]).optional(),
    owner: z.enum(["you", "opponent", "any"]).optional(),
    zone: FilterZoneSchema.optional(),
    colored: z.boolean().optional(),
    another: z.boolean().optional(), token: z.boolean().optional(), tapped: z.boolean().optional(),
    attacking: z.boolean().optional(), hasCounter: z.string().optional(),
    mv: CmpSchema.optional(), power: CmpSchema.optional(), toughness: CmpSchema.optional(),
    named: z.string().optional(), with: strArr.optional(),
    anyOf: z.array(ObjectFilterSchema).optional(),
    hasBasicLandType: z.boolean().optional(),
    controllerDealtDamageBy: ObjRefSchema.optional(),
    notSubtypes: strArr.optional(), without: strArr.optional(), isCommander: z.boolean().optional(),
    sameName: z.boolean().optional(), sharesCreatureTypeWith: ObjRefSchema.optional(),
    chosenType: z.boolean().optional(), chosenColor: z.boolean().optional(), attackingYou: z.boolean().optional(),
    blocking: z.boolean().optional(), enteredThisTurn: z.boolean().optional(), attackingOpponent: z.boolean().optional(),
    sameNameAs: ObjRefSchema.optional()
  }).strict()
);

export const PredicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    z.object({ check: z.literal("cast_during"), phase: z.enum(["main", "your_main", "combat", "your_turn", "opponent_turn", "end_step"]) }).strict(),
    z.object({ check: z.literal("cast_from"), zone: ZoneSchema }).strict(),
    z.object({ check: z.literal("turn_is"), whose: z.enum(["yours", "opponents"]) }).strict(),
    z.object({ check: z.literal("phase_is"), phase: z.enum(PHASES) }).strict(),
    z.object({ check: z.literal("nth_this_turn"), event: z.enum(EVENT_NAMES), n: int, actor: PlayerRefSchema, filter: ObjectFilterSchema.optional() }).strict(),
    z.object({ check: z.literal("controls"), filter: ObjectFilterSchema, count: CmpSchema.optional() }).strict(),
    z.object({ check: z.literal("life"), who: PlayerRefSchema, cmp: CmpSchema }).strict(),
    z.object({ check: z.literal("zone_count"), who: PlayerRefSchema, zone: ZoneSchema, filter: ObjectFilterSchema.optional(), cmp: CmpSchema }).strict(),
    z.object({ check: z.literal("did_this_turn"), event: z.enum(EVENT_NAMES), actor: PlayerRefSchema, cmp: CmpSchema.optional() }).strict(),
    z.object({ check: z.literal("stat"), of: ObjRefSchema, stat: z.string(), cmp: CmpSchema }).strict(),
    z.object({ check: z.literal("matches"), obj: ObjRefSchema, filter: ObjectFilterSchema }).strict(),
    z.object({ check: z.enum(["kicked", "paid_additional_cost"]), option: z.string().optional() }).strict(),
    z.object({ check: z.literal("source_state"), state: z.enum(["tapped", "attacking", "on_battlefield", "equipped"]) }).strict(),
    z.object({ check: z.literal("compare"), left: QuantitySchema, cmp: CmpSchema }).strict(),
    z.object({ check: z.literal("turn_number"), scope: z.enum(["game", "yours"]), cmp: CmpSchema }).strict(),
    z.object({ check: z.literal("chosen_is"), kind: z.enum(["mode", "color", "creature_type", "card_type", "basic_land_type", "card_name"]), value: z.string() }).strict(),
    z.object({ check: z.literal("most_life"), who: PlayerRefSchema }).strict(),
    z.object({ check: z.literal("step_done"), step: z.string(), who: PlayerRefSchema.optional() }).strict(),
    z.object({ check: z.literal("mana_spent"), color: z.enum(["W", "U", "B", "R", "G", "C"]), cmp: CmpSchema.optional() }).strict(),
    z.object({ check: z.literal("cast_with"), option: z.string() }).strict(),
    z.object({ check: z.literal("name_matches"), obj: ObjRefSchema, among: z.array(ObjectFilterSchema).min(1) }).strict(),
    z.object({ check: z.literal("attacked_defender"), defender: z.enum(["you", "you_or_your_planeswalkers"]), who: z.enum(["all", "none", "any"]) }).strict(),
    z.object({ all: z.array(PredicateSchema) }).strict(),
    z.object({ any: z.array(PredicateSchema) }).strict(),
    z.object({ not: PredicateSchema }).strict(),
    z.object({ unsupported: z.string() }).strict()
  ])
) as z.ZodType<Predicate>;

// ---------------------------------------------------------------- conditions / timing / duration

export const ConditionSchema = z.object({
  when: z.enum(["on_cast", "on_trigger", "on_resolution", "static"]),
  if: PredicateSchema,
  src: srcField
}).strict();
export type Condition = z.infer<typeof ConditionSchema>;

export const TimingSchema = z.object({
  speed: z.enum(["instant", "sorcery", "flash", "default"]).optional(),
  only: z.array(PredicateSchema).optional(),
  limit: z.object({ count: int.min(1), per: z.enum(["turn", "game", "each_combat"]) }).strict().optional(),
  window: z.union([
    z.object({ event: z.literal("drawn"), firstThisTurn: z.boolean().optional() }).strict(),
    z.object({ event: z.literal("exiled_by_this") }).strict()
  ]).optional()
}).strict();
export type Timing = z.infer<typeof TimingSchema>;

export const DurationSchema = z.union([
  z.enum(["instant", "until_end_of_turn", "until_your_next_turn", "while_source_on_battlefield", "while_attached",
    // "until the end of your next turn" / "until your next end step"
    "until_end_of_your_next_turn", "until_your_next_end_step"]),
  z.object({ until: z.enum(EVENT_NAMES) }).strict(),
  z.object({ forAsLongAs: PredicateSchema }).strict()
]);
export type Duration = z.infer<typeof DurationSchema>;

// ---------------------------------------------------------------- targets / modes

export const TargetSpecSchema = z.object({
  id: z.string().regex(/^t\d+$/),
  what: z.enum(["object", "player", "any"]),
  filter: ObjectFilterSchema.optional(),
  count: z.object({ min: int.min(0), max: int.min(1) }).strict(),
  distinct: z.boolean().optional(),
  // "for each opponent, up to one target ... that player controls": count applies once per opponent
  perOpponent: z.boolean().optional(),
  // "any number of target ...": min 0, no upper bound (count.max is then only a placeholder and must be 1)
  anyNumber: z.boolean().optional(),
  // "up to X target ..." / "X target ...": the maximum is this Quantity (count.max is a placeholder of 1)
  maxQuantity: QuantitySchema.optional(),
  // conditional slot: this target exists only while the predicate holds when the spell is cast / the ability is put on the stack
  // (Tear Asunder: the kicked target slot). An inactive slot is never asked, never validated, and its ref resolves to nothing.
  onlyIf: PredicateSchema.optional(),
  prompt: PromptSchema.optional(),
  src: srcField
}).strict();
export type TargetSpec = z.infer<typeof TargetSpecSchema>;

// ---------------------------------------------------------------- costs

const costMeta = { prompt: PromptSchema.optional(), src: srcField };
const selfOrFilter = z.union([z.literal("self"), ObjectFilterSchema]);
export const CostSchema = z.union([
  z.object({ mana: z.string(), ...costMeta }).strict(),
  z.object({ tap: z.literal("self"), ...costMeta }).strict(),
  z.object({ untap: z.literal("self"), ...costMeta }).strict(),
  z.object({ tapOther: ObjectFilterSchema, count: QuantitySchema, ...costMeta }).strict(),
  z.object({ sacrifice: selfOrFilter, count: QuantitySchema, ...costMeta }).strict(),
  z.object({ discard: z.union([z.literal("self"), z.literal("hand"), ObjectFilterSchema]), count: QuantitySchema, ...costMeta }).strict(),
  z.object({ life: QuantitySchema, ...costMeta }).strict(),
  z.object({ exileFrom: ZoneSchema, what: selfOrFilter, count: QuantitySchema, ...costMeta }).strict(),
  z.object({ returnToHand: selfOrFilter, count: QuantitySchema, ...costMeta }).strict(),
  z.object({ counters: z.object({ kind: z.string(), count: QuantitySchema, remove: z.boolean(), from: selfOrFilter }).strict(), ...costMeta }).strict(),
  z.object({ reveal: selfOrFilter, ...costMeta }).strict(),
  z.object({ energy: int, ...costMeta }).strict(),
  // planeswalker loyalty cost: +N adds counters, negative removes ("-3"); a Quantity allows "-X"
  z.object({ loyalty: QuantitySchema, ...costMeta }).strict(),
  z.object({ unsupported: z.string(), ...costMeta }).strict()
]);
export type Cost = z.infer<typeof CostSchema>;

// "costs {1} less for each <per>" (per + amount) or "costs {3} less if you're the monarch" (condition + amount)
// or "costs {X} less, where X is ..." (amount a Quantity, no per).
export const CostReductionSchema = z.object({
  per: ObjectFilterSchema.optional(), amount: QuantitySchema, applies: z.enum(["generic", "any"]),
  condition: PredicateSchema.optional(), src: srcField
}).strict();

// ---------------------------------------------------------------- steps

export interface Step {
  kind: StepKind;
  id?: string;
  src?: number;
  who?: PlayerRef;
  target?: ObjRef;
  optional?: boolean;
  condition?: Condition;
  unlessPay?: { payer: PlayerRef; cost: Cost[]; x?: Quantity; prompt?: Prompt };
  duration?: Duration;
  amount?: Quantity;
  filter?: ObjectFilter;
  prompt?: Prompt;
  if?: Predicate;
  then?: Step[];
  else?: Step[];
  steps?: Step[];
  /** fight_pairs: the fighters (ref "created" = ALL tokens the previous create_tokens step made) */
  fighters?: ObjRef;
  /** fight_pairs: the pool the fighters are paired with, one DIFFERENT object each (fixed at resolution) */
  against?: ObjectFilter;
  /** fight_pairs: who decides the pairing; fighters left without a partner fight nothing */
  pairing?: "controller_chooses";
  source?: ObjRef;
  excessTo?: ObjRef | PlayerRef;
  divided?: boolean;
  alsoWho?: PlayerRef;
  excludeWho?: PlayerRef;
  position?: "top" | "bottom";
  order?: "random" | "chosen";
  faceDown?: boolean;
  choice?: "color" | "creature_type" | "card_type" | "basic_land_type" | "card_name" | "mode" | "player" | "opponent" | "number";
  options?: string[];
  remember?: boolean;
  reflexive?: boolean;
  amountLockedOn?: "cast";
  [extra: string]: unknown;
}

const quantityFields = ["amount", "power", "toughness", "tokenPower", "tokenToughness", "tokenCount"] as const;

export const StepSchema: z.ZodType<Step> = z.lazy(() =>
  z.object({
    kind: z.enum(STEP_KINDS),
    id: z.string().optional(),
    src: srcField,
    who: PlayerRefSchema.optional(),
    target: ObjRefSchema.optional(),
    optional: z.boolean().optional(),
    condition: ConditionSchema.optional(),
    unlessPay: z.object({
      payer: PlayerRefSchema, cost: z.array(CostSchema), x: QuantitySchema.optional(), prompt: PromptSchema.optional()
    }).strict().optional(),
    duration: DurationSchema.optional(),
    amount: QuantitySchema.optional(),
    power: QuantitySchema.optional(),
    toughness: QuantitySchema.optional(),
    tokenPower: QuantitySchema.optional(),
    tokenToughness: QuantitySchema.optional(),
    tokenCount: QuantitySchema.optional(),
    filter: ObjectFilterSchema.optional(),
    prompt: PromptSchema.optional(),
    if: PredicateSchema.optional(),
    then: z.array(StepSchema).optional(),
    else: z.array(StepSchema).optional(),
    steps: z.array(StepSchema).optional(),
    // typed extension fields (consolidated pass); the legacy executor ignores them, so capabilities reports them as needs
    fighters: ObjRefSchema.optional(),                     // fight_pairs: the fighters (created = all tokens just created)
    against: ObjectFilterSchema.optional(),                // fight_pairs: the pool each fighter is paired with (one different object each)
    pairing: z.enum(["controller_chooses"]).optional(),    // fight_pairs: the controller chooses the pairing (extra fighters fight nothing)
    source: ObjRefSchema.optional(),                       // damage_target/fight: the object dealing the damage ("it deals damage equal to its power")
    excessTo: z.union([ObjRefSchema, PlayerRefSchema]).optional(), // damage_target: where excess damage beyond lethal goes (trample-like)
    divided: z.boolean().optional(),                       // damage_target/add_counters: divided as you choose among the targets
    alsoWho: PlayerRefSchema.optional(),                   // a second player who does the same (Secret Rendezvous: you and target opponent each draw)
    excludeWho: PlayerRefSchema.optional(),                // "each other opponent": scope minus this player
    position: z.enum(["top", "bottom"]).optional(),        // move_card_zone: where in the library
    order: z.enum(["random", "chosen"]).optional(),        // move_card_zone: order when several cards go to a library
    faceDown: z.boolean().optional(),                      // move_card_zone: exile / battlefield face down
    choice: z.enum(["color", "creature_type", "card_type", "basic_land_type", "card_name", "mode", "player", "opponent", "number"]).optional(), // choose: what kind of option
    options: z.array(z.string()).optional(),               // choose (choice:"mode"): the named options
    remember: z.boolean().optional(),                      // choose: store the answer on the source permanent (chosen_is / chosenType / chosenColor read it)
    amountLockedOn: z.literal("cast").optional(),          // the amount is fixed when the spell is cast ("X ... as you cast this spell")
    reflexive: z.boolean().optional(),                     // "When you do, ...": this step is a reflexive trigger, its targets are chosen when it triggers
    // ---- cleanup pass (typed; the legacy executor ignores them, so capabilities reports them as needs)
    tokenTapped: z.boolean().optional(),                   // create_tokens: the tokens enter tapped
    tokenAttacking: z.union([z.literal(true), z.enum(["attacked_opponent", "same_defender", "controller_chooses"])]).optional(), // create_tokens: enter attacking (true / controller_chooses = you choose who; that opponent; the same defender the source attacks)
    tokenAbilities: z.array(z.lazy(() => AbilitySchema)).optional(), // create_tokens: abilities the tokens have (full ability records)
    noRegenerate: z.boolean().optional(),                  // destroy_*: "it can't be regenerated"
    voters: z.enum(["each_player", "each_opponent"]).optional(), // vote: who votes (in turn order starting with the caster)
    candidates: ObjectFilterSchema.optional(),             // vote: the objects that can be voted for (omit + `voteOptions` = named options)
    voteOptions: z.array(z.string()).optional(),           // vote: named options ("evidence" / "bribery")
    tie: z.enum(["all_tied", "controller_chooses"]).optional(), // vote: every candidate tied for most votes wins / the controller picks among them
    withWho: PlayerRefSchema.optional(),                   // exchange_life: the other player
    repeatIf: PredicateSchema.optional(),                  // repeat_process: after the body ran, run it again while this holds
    emblem: z.object({ abilities: z.array(z.lazy(() => AbilitySchema)).min(1) }).strict().optional() // create_emblem: the emblem's abilities
  }).passthrough()
) as unknown as z.ZodType<Step>;
export { quantityFields };

export const ModesSchema = z.object({
  choose: z.object({ min: int.min(0), max: int.min(1) }).strict(),
  distinct: z.boolean(),
  // "Each mode must target a different player": the chosen modes' targets must all differ
  distinctTargets: z.boolean().optional(),
  // "You may choose the same mode more than once": the same option can be picked several times (distinct is then false)
  repeatable: z.boolean().optional(),
  options: z.array(z.object({
    id: z.string(), text: z.string(), targets: z.array(TargetSpecSchema).optional(),
    steps: z.array(StepSchema), src: srcField
  }).strict()),
  // "choose one that hasn't been chosen this turn": a mode already chosen by this source this turn is not offered
  repeatRestriction: z.enum(["this_turn"]).optional(),
  prompt: PromptSchema.optional()
}).strict();
export type Modes = z.infer<typeof ModesSchema>;

// ---------------------------------------------------------------- kernel-implementation flag

export const ImplementationSchema = z.enum(["implemented", "needed"]);
export type Implementation = z.infer<typeof ImplementationSchema>;
const implFields = { implementation: ImplementationSchema.optional(), needs: z.array(z.string()).optional() };

// ---------------------------------------------------------------- cast options

export const CastOptionSchema = z.object({
  id: z.string(),
  kind: z.enum(["additional", "alternative", "kicker", "flashback", "escape", "miracle", "evoke", "overload", "madness", "convoke", "cast_from_zone", "gift", "escalate"]),
  from: ZoneSchema,
  cost: z.array(CostSchema),
  replacesManaCost: z.boolean(),
  when: TimingSchema.shape.window,
  afterResolution: z.literal("exile").optional(),
  effects: z.object({
    addSteps: z.array(StepSchema).optional(), replaceSteps: z.array(StepSchema).optional(),
    ifPaid: z.array(ConditionSchema).optional()
  }).strict().optional(),
  // true: the caster chooses whether to use it (kicker, gift...). false: a mandatory additional cost.
  optional: z.boolean(),
  // "You may cast this card from your graveyard as long as you control a Zombie": the option only exists while this holds
  condition: PredicateSchema.optional(),
  // escalate: the cost is paid once for each mode chosen beyond the first
  perExtraMode: z.boolean().optional(),
  // gift: what the chosen opponent receives ("card", "Treasure", "Food", "Fish", "tapped Fish", "Octopus", "extra turn")
  gift: z.string().optional(),
  prompt: PromptSchema.optional(),
  ...implFields
}).strict();
export type CastOption = z.infer<typeof CastOptionSchema>;

// ---------------------------------------------------------------- triggers / replacement / static

export const TriggerSpecSchema = z.object({
  event: z.enum(EVENT_NAMES),
  subject: z.union([ObjectFilterSchema, PlayerRefSchema, ObjRefSchema]).optional(),
  step: z.enum(PHASES).optional(),
  whose: z.enum(["yours", "opponents", "each"]).optional(),
  nth: z.object({ n: int.min(1), per: z.enum(["turn", "game"]) }).strict().optional(),
  interveningIf: PredicateSchema.optional(),
  // "one or more creatures ... deal damage": fires once per event batch, not once per matching object
  batch: z.boolean().optional(),
  fromZone: ZoneSchema.optional(), toZone: ZoneSchema.optional(),
  // "from anywhere other than the battlefield": any origin zone except this one
  notFromZone: ZoneSchema.optional(),
  // "whenever a Human deals damage to you": the object that dealt the damage
  damageSource: ObjectFilterSchema.optional(),
  // Saga chapter abilities: fires when a lore counter brings the Saga to one of these chapter numbers ("I, II" = [1, 2])
  chapters: z.array(int.min(1)).optional(),
  // "attacks with two or more creatures": fires only when at least this many objects are in the batch (use with batch)
  minCount: int.min(2).optional(),
  // attack triggers: who the attack is aimed at ("attacks you or a planeswalker you control")
  defender: z.enum(["you", "you_or_your_planeswalkers", "other_player"]).optional(),
  // further events that fire the same ability ("enters or attacks", "enters or is put into a graveyard from the battlefield").
  // Each alternative overrides the main event's qualifiers; omitted qualifiers are inherited.
  alsoOn: z.array(z.object({
    event: z.enum(EVENT_NAMES),
    subject: z.union([ObjectFilterSchema, PlayerRefSchema, ObjRefSchema]).optional(),
    step: z.enum(PHASES).optional(),
    whose: z.enum(["yours", "opponents", "each"]).optional(),
    fromZone: ZoneSchema.optional(), toZone: ZoneSchema.optional(), notFromZone: ZoneSchema.optional()
  }).strict()).optional()
}).strict();
export type TriggerSpec = z.infer<typeof TriggerSpecSchema>;

export const ReplacementSpecSchema = z.object({
  event: z.enum([
    "would_create_token", "would_die", "would_be_put_into_zone", "would_draw", "would_gain_life",
    "would_lose_life", "would_deal_damage", "would_enter", "would_discard", "would_become_tapped",
    // "if one or more counters would be put on a permanent" (Hardened Scales, Doubling Season): modify `set: {amount: {add|multiply}}`
    "would_add_counters"
  ]),
  subject: z.union([ObjectFilterSchema, PlayerRefSchema]).optional(),
  fromZone: ZoneSchema.optional(), toZone: ZoneSchema.optional(),
  result: z.union([
    z.object({ mode: z.literal("instead"), steps: z.array(StepSchema) }).strict(),
    z.object({ mode: z.literal("also"), steps: z.array(StepSchema) }).strict(),
    z.object({ mode: z.literal("modify"), set: z.record(z.unknown()) }).strict(),
    z.object({ mode: z.literal("prevent") }).strict()
  ]),
  optional: z.boolean().optional(),
  condition: PredicateSchema.optional(),
  // would_deal_damage / would_lose_life...: who or what is hit, whether it must be combat, and what deals it
  recipient: z.union([ObjectFilterSchema, PlayerRefSchema, z.literal("self"), ObjRefSchema]).optional(),
  damageType: z.enum(["combat", "noncombat"]).optional(),
  damageSource: ObjectFilterSchema.optional(),
  // a one-shot replacement/prevention shield that lasts for a while ("this turn")
  duration: DurationSchema.optional(),
  prompt: PromptSchema.optional()
}).strict();
export type ReplacementSpec = z.infer<typeof ReplacementSpecSchema>;

export const StaticSpecSchema = z.object({
  affects: z.union([ObjRefSchema, PlayerRefSchema, ObjectFilterSchema]),
  modify: z.array(z.union([
    z.object({ pt: z.object({ power: QuantitySchema, toughness: QuantitySchema }).strict() }).strict(),
    z.object({ grant: z.string() }).strict(),
    // spec has `grantAbility: Ability`; loosened to avoid a recursive type (deviation, see README)
    z.object({ grantAbility: z.record(z.unknown()) }).strict(),
    z.object({ lose: z.string() }).strict(),
    z.object({ setTypes: strArr }).strict(),
    // protects: the restriction only covers attacks aimed at you ("can't attack you or planeswalkers you control")
    z.object({ cant: z.enum(["attack", "block", "be_blocked", "be_countered", "cast", "gain_life", "search"]), except: ObjectFilterSchema.optional(), protects: z.enum(["you", "you_and_planeswalkers"]).optional() }).strict(),
    z.object({ evasion: z.object({ cantBeBlockedBy: ObjectFilterSchema.optional(), unlessDefenderControls: ObjectFilterSchema.optional() }).strict() }).strict(),
    z.object({ costMod: z.object({ filter: ObjectFilterSchema, delta: QuantitySchema }).strict() }).strict(),
    z.object({ copyOf: ObjRefSchema }).strict(),
    // pilot-draft additions (Keen Engineering): "base power and toughness 5/3", "are Juggernauts in addition", attack tax
    z.object({ setBasePT: z.object({ power: QuantitySchema, toughness: QuantitySchema }).strict() }).strict(),
    z.object({ addTypes: strArr }).strict(),
    // "attacks each combat if able"
    z.object({ mustAttack: z.literal(true) }).strict(),
    // "has the creature types of <ref>" (Duplicant: linked_exile)
    z.object({ copySubtypesOf: ObjRefSchema }).strict(),
    z.object({ attackTax: z.object({ cost: z.string(), per: z.enum(["attacker"]), protects: z.enum(["you", "you_and_planeswalkers"]).optional() }).strict() }).strict(),
    // consolidated pass
    z.object({ blockTax: z.object({ cost: z.string(), per: z.enum(["blocker"]) }).strict() }).strict(),
    z.object({ addChosenType: z.literal(true) }).strict(),  // "is the chosen type in addition to its other types"
    z.object({ setColors: strArr }).strict(),               // "is green" / "is a green Elk": replaces the colors
    z.object({ extraLandDrops: int.min(1) }).strict()       // "you may play an additional land on each of your turns"
  ])),
  while: PredicateSchema.optional(),
  duration: DurationSchema.optional()
}).strict();
export type StaticSpec = z.infer<typeof StaticSpecSchema>;

// Spend restriction: `restriction` = spells of this kind may be cast with it; `abilitiesOf` = abilities of permanents of
// this kind may be activated with it ("only to cast Dragon spells or activate abilities of Dragons").
const manaRestriction = { restriction: ObjectFilterSchema.optional(), abilitiesOf: ObjectFilterSchema.optional() };
export type ManaSpec =
  | { colors: string; restriction?: ObjectFilter; abilitiesOf?: ObjectFilter }
  | { anyColor: number; restriction?: ObjectFilter; abilitiesOf?: ObjectFilter }
  | { perCount: ObjectFilter; color: string; restriction?: ObjectFilter; abilitiesOf?: ObjectFilter }
  | { commanderIdentity: number }
  | { chosenColor: number; restriction?: ObjectFilter; abilitiesOf?: ObjectFilter }   // the color remembered by the source
  | { anyColorAmount: Quantity; restriction?: ObjectFilter; abilitiesOf?: ObjectFilter } // "X mana in any combination of colors"
  | { conditional: { if: Predicate; then: ManaSpec[]; else: ManaSpec[] } };           // "if you control X, add two mana instead"
export const ManaSpecSchema: z.ZodType<ManaSpec> = z.lazy(() => z.union([
  z.object({ colors: z.string(), ...manaRestriction }).strict(),
  z.object({ anyColor: int.min(1), ...manaRestriction }).strict(),
  z.object({ perCount: ObjectFilterSchema, color: z.string(), ...manaRestriction }).strict(),
  // "one mana of any color in your commander's color identity"
  z.object({ commanderIdentity: int.min(1) }).strict(),
  z.object({ chosenColor: int.min(1), ...manaRestriction }).strict(),
  z.object({ anyColorAmount: QuantitySchema, ...manaRestriction }).strict(),
  z.object({ conditional: z.object({ if: PredicateSchema, then: z.array(ManaSpecSchema), else: z.array(ManaSpecSchema) }).strict() }).strict()
])) as z.ZodType<ManaSpec>;

// ---------------------------------------------------------------- ability + card

export const AbilityKindSchema = z.enum([
  "spell_effect", "activated", "triggered", "static", "keyword", "replacement", "mana", "cast_option", "scripted"
]);
export type AbilityKind = z.infer<typeof AbilityKindSchema>;

export const AbilitySchema = z.object({
  id: z.string(),
  kind: AbilityKindSchema,
  text: z.string(),
  zone: ZoneSchema.optional(),
  // double-faced / modal double-faced / split cards: the face this ability belongs to (omit on single-faced cards)
  face: z.string().optional(),
  timing: TimingSchema.optional(),
  costs: z.array(CostSchema).optional(),
  costReduction: CostReductionSchema.optional(),
  trigger: TriggerSpecSchema.optional(),
  conditions: z.array(ConditionSchema).optional(),
  targets: z.array(TargetSpecSchema).optional(),
  modes: ModesSchema.optional(),
  steps: z.array(StepSchema).optional(),
  replacement: ReplacementSpecSchema.optional(),
  static: StaticSpecSchema.optional(),
  mana: z.object({ produces: z.array(ManaSpecSchema) }).strict().optional(),
  optional: z.boolean().optional(),
  keyword: z.object({ name: z.string(), param: z.union([z.string(), z.number()]).optional() }).strict().optional(),
  // Scripted marker: an engine-specific rule the schema has no vocabulary for. `params` may carry the numbers the
  // handler uses; a PURE stub (no steps/modes/static) is exempt from the literal check for its own text (see README).
  scripted: z.object({ handler: z.string(), params: z.record(z.unknown()).optional() }).strict().optional(),
  declined: z.boolean().optional(),
  // clause indices (within `text`) this ability covers without a more specific node (headers etc.)
  srcs: z.array(int.min(0)).optional(),
  // prompts (Phase 0b): ability-level "may", and the X choice
  prompt: PromptSchema.optional(),
  xPrompt: PromptSchema.optional(),
  // v1 free-text fields kept for traceability when lifted
  legacy: z.object({ condition: z.string().optional(), cost: z.string().optional(), triggerEvent: z.string().optional() }).strict().optional(),
  ...implFields
}).strict();
export type Ability = z.infer<typeof AbilitySchema>;

export const ReviewSchema = z.object({
  status: z.enum(["draft", "approved"]),
  by: z.string().optional(),
  at: z.string().optional(),
  // validator escape hatch: a lexeme the validator flagged falsely, with the reason a human gave
  ignore: z.array(z.object({ lexeme: z.string(), reason: z.string().min(1) }).strict()).optional(),
  // for cards missing from data/cards.db: the oracle text to validate against, with where it came from
  oracleOverride: z.object({ text: z.string().min(1), source: z.string().min(1), typeLine: z.string().optional() }).strict().optional(),
  // free-form reviewer notes: rulings, kernel implications, why a modelling choice was made (never read by the validator)
  notes: z.array(z.string().min(1)).optional()
}).strict();
export type Review = z.infer<typeof ReviewSchema>;

export const CardSchema = z.object({
  schemaVersion: z.literal(2),
  abilities: z.array(AbilitySchema),
  castOptions: z.array(CastOptionSchema).optional(),
  review: ReviewSchema.optional()
}).strict();
export type Card = z.infer<typeof CardSchema>;
