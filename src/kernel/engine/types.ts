// Kernel engine state model. Everything here is plain JSON (no Map/Set/class instances) so a state can be
// serialized, snapshotted and compared with toEqual. See README.md for the protocol.

import type { Ability, Card, Phase, Prompt, ReplacementSpec, Step, TargetSpec, Zone } from "../schema";

export type PlayerId = string;
/** Object ids are "#<n>"; player ids are whatever the host chose and must not start with "#". */
export type ObjId = string;
export const isObjId = (id: string): boolean => id.startsWith("#");

export type ManaColor = "W" | "U" | "B" | "R" | "G" | "C";
export const MANA_COLORS: readonly ManaColor[] = ["W", "U", "B", "R", "G", "C"];
export type ManaPool = Record<ManaColor, number>;

// ---------------------------------------------------------------- card definitions (host-provided lookup)

/** What the engine needs to know about a card. `kernel` is the v2 card JSON from data/kernel-drafts. */
export interface CardDef {
  name: string;
  /** e.g. "{2}{U}{U}"; absent for lands/tokens */
  manaCost?: string;
  types: string[];            // lowercase: "creature", "instant", "land", "artifact"...
  subtypes?: string[];        // as printed: "Swamp", "Sphinx"
  supertypes?: string[];      // "legendary", "basic"
  /** omitted -> derived from manaCost */
  colors?: string[];
  power?: number;
  toughness?: number;
  /** planeswalkers: starting loyalty (enters with this many loyalty counters) */
  loyalty?: number;
  /**
   * Double-faced / modal double-faced / split cards: the host-provided characteristics of the OTHER faces by face name (the faces are the
   * distinct `face` values of the card's abilities, front first; the front face uses the fields above). A face missing here uses the front's.
   */
  faces?: Record<string, FaceDef>;
  /** "transform" (default: only the front face can be cast; the step transform flips it), "modal_dfc" / "split": the face is chosen on cast */
  layout?: "transform" | "modal_dfc" | "split" | "adventure";
  kernel: Card;
}
export interface FaceDef { manaCost?: string; types: string[]; subtypes?: string[]; supertypes?: string[]; colors?: string[]; power?: number; toughness?: number; loyalty?: number }
export type CardLookup = (name: string) => CardDef | undefined;

export interface TokenDef {
  name: string;
  types: string[];
  subtypes: string[];
  colors: string[];
  power?: number;
  toughness?: number;
  keywords: string[];
  /** the token's own abilities (predefined Treasure/Food/Clue rules, or the printed abilities of a copied card); keywords above are separate */
  abilities?: Ability[];
  /** a token that is a copy of a card has that card's mana cost (so its mana value is right) and supertypes (legendary) */
  manaCost?: string;
  supertypes?: string[];
}

// ---------------------------------------------------------------- state

export interface GameObject {
  id: ObjId;
  /** definition name (tokens: the token's name; its characteristics come from `token`) */
  cardName: string;
  owner: PlayerId;
  controller: PlayerId;
  zone: Zone;
  /** monotonic; refreshed every time the object changes zone (new object, rule 400.7) */
  timestamp: number;
  /** clock value when the current controller gained control; summoning sickness compares it to the controller's turn start */
  controlledSince: number;
  tapped: boolean;
  counters: Record<string, number>;
  damage: number;
  token?: TokenDef;
  isCommander?: boolean;
  /** the owner declined to move this commander from the graveyard / exile to the command zone (cleared when it changes zone) */
  commanderDeclined?: boolean;
  /** Auras/Equipment: the object this one is attached to; valid only while that object is on the battlefield with the same timestamp */
  attachedTo?: ObjId;
  attachedToTs?: number;
  /** the X this permanent was cast with ("enters with X counters") */
  castX?: number;
  /** "As this enters, choose a color": remembered by the choose step (remember: true), read back by chosen_is / mana */
  chosen?: { color?: string; mode?: string; type?: string; cardType?: string; landType?: string; name?: string };
  /** exiled / put onto the battlefield face down: only the owner may know what it is (viewFor hides the name from everyone else) */
  faceDown?: boolean;
  /** dealt damage by a deathtouch source this turn: destroyed by state-based actions (704.5h), cleared with the damage */
  dtHit?: boolean;
  /** flashback & co.: if this spell would leave the stack it is exiled instead (cleared whenever the object changes zone) */
  exileInstead?: boolean;
  /** the face this object currently shows (double-faced cards: set by casting a chosen face, playing a land face, transform); undefined = front */
  face?: string;
  /** a COPY of a spell: a new object that exists only on the stack (and, as a permanent-spell copy, on the battlefield); it ceases to exist elsewhere */
  isCopy?: boolean;
  /** layer 1: this permanent is a copy of something (copiable values snapshot, like a token copy); cleared when it leaves the battlefield */
  copyDef?: TokenDef;
  /** the copy effect ends at the cleanup step of this turn ("until end of turn") */
  copyUntilEot?: boolean;
  /** the "next spell" grants this spell was cast with (improvise, affinity for artifacts, cant:be_countered) */
  castGrants?: string[];
  /** regeneration shields (regen.ts): cleared at cleanup */
  regen?: number;
  /** how this object was cast (kept while it is the spell and the permanent it becomes: "was kicked", "cast with escape") */
  cast?: CastInfo;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  life: number;
  library: ObjId[];   // index 0 = top
  hand: ObjId[];
  graveyard: ObjId[]; // last = most recent
  exile: ObjId[];
  command: ObjId[];
  manaPool: ManaPool;
  /** mana with a spending restriction / rider / duration (manapool.ts); plain mana is in manaPool */
  manaUnits?: import("./manapool").ManaUnit[];
  landsPlayed: number;
  /** clock value when this player's most recent turn began (summoning sickness) */
  lastTurnStartTs: number;
  hasLost: boolean;
  drewFromEmpty: boolean;
  colorIdentity: string[];
  commanderCasts: Record<ObjId, number>;
  /** counters ON THE PLAYER (experience, poison...), by kind */
  counters?: Record<string, number>;
}

export interface CastInfo {
  turn: number;
  phase: Phase;
  activePlayer: PlayerId;
  from: Zone;
  caster: PlayerId;
  /** the cast options really paid (ids AND kinds: "kicker", "c1"...): read by kicked / paid_additional_cost / cast_with */
  paid?: string[];
  /** the colors of the mana spent to cast this spell (read by mana_spent: "if {W} was spent to cast this spell") */
  spent?: ManaColor[];
}

/** One chosen mode (or the implicit single part of a non-modal ability) with its chosen targets. */
export interface Part {
  modeId?: string;
  specs: TargetSpec[];
  steps: Step[];
  targets: Record<string, string[]>;
}

export interface TriggerContext {
  /** the object the event is about (entering/dying/cast spell) */
  eventObj?: ObjId;
  eventPlayer?: PlayerId;
  amount?: number;
  /** last-known characteristics of eventObj if it left the battlefield */
  lki?: Lki;
  /** cast triggers: how the spell was cast (so "if it was kicked" / "if an additional cost was paid" can be read) */
  cast?: CastInfo;
  /** X of the ability that caused the trigger (cycling {X}{1}{U}: "When you cycle this card, create an X/X Shark") */
  x?: number;
}

export interface Lki { controller: PlayerId; owner: PlayerId; name: string; types: string[]; subtypes: string[]; colors: string[]; mv: number; power?: number; toughness?: number; token: boolean; counters?: Record<string, number> }

export interface StackItem {
  id: string;
  kind: "spell" | "activated" | "triggered";
  sourceId: ObjId;
  /** spells: the card object (zone "stack") */
  objectId?: ObjId;
  controller: PlayerId;
  abilityId: string;
  parts: Part[];
  x: number;
  cast?: CastInfo;
  trigger?: TriggerContext;
  /** permanents sacrificed as a cost (refs "sacrificed") and their last-known information */
  sacrificed?: ObjId[];
  costLki?: Record<ObjId, Lki>;
}

export interface QueuedTrigger {
  id: string;
  sourceId: ObjId;
  abilityId: string;
  controller: PlayerId;
  ctx: TriggerContext;
  label: string;
  /** the controller already chose this trigger's place in their ordering */
  ordered?: boolean;
  /** a delayed trigger that came due: its steps and the targets of the ability that created it (it has no ability on any object) */
  delayed?: { steps: Step[]; targets: Record<string, string[]> };
}

export interface ContinuousEffect {
  id: string;
  timestamp: number;
  objectId: ObjId;
  /** timestamp of the object when the effect was created: an effect on an object that changed zones no longer applies */
  objectTimestamp: number;
  power?: number;
  toughness?: number;
  grant?: string;
  /** "all abilities" or a keyword name: removes abilities of EARLIER timestamps only (layer 6) */
  lose?: string;
  /** base power/toughness (layer 7b) */
  base?: { power: number; toughness: number };
  addTypes?: string[];
  setColors?: string[];
  until: "end_of_turn";
}

// ---------------------------------------------------------------- durable effects and delayed triggers (kernel step 5)

/** When a durable effect ends: at the first `ev` occurrence on or after turn `turn` (restricted to turns of `player` when set). `never`: it lasts until used up / the object moves. */
export interface Expiry { ev: "cleanup" | "turn_start" | "end_step" | "never"; turn?: number; player?: PlayerId }

/**
 * Effects that belong to a PLAYER (not to an object): permission to cast / play specific cards, replacement shields granted for a
 * while ("prevent all combat damage that would be dealt to you this turn"), player flags ("no maximum hand size").
 * Stored in `GameState.durableEffects`, read by the casting code (permissions), the replacement pipeline (shields) and cleanup (flags).
 */
export interface DurableEffect {
  id: string;
  timestamp: number;
  owner: PlayerId;
  source: ObjId;
  expires: Expiry;
  permission?: { objectId: ObjId; objectTs: number; zone: Zone; withoutPaying: boolean; allow: Array<"land" | "spell"> };
  replacement?: ReplacementSpec;
  flag?: string;
  /** "exile ... until this leaves the battlefield": when the source (same object) leaves, the object returns to the battlefield under its owner's control */
  /** "the next spell you cast this turn has ..." grants (castgrants.ts) */
  nextSpell?: string[];
  unexile?: { objectId: ObjId; objectTs: number; sourceId: ObjId; sourceTs: number };
  /** "gain control of X until ...": when it expires, the object (if still the same one) returns to `was` */
  control?: { objectId: ObjId; objectTs: number; was: PlayerId };
}

/** "At the beginning of the next end step / upkeep, ..." and "when <object> dies this turn, ...": a one-shot trigger created by a step. */
export interface DelayedTrigger {
  id: string;
  source: ObjId;
  controller: PlayerId;
  at: { event: "begin_step"; step: Phase; whose: "yours" | "opponents" | "each" } | { event: "dies"; ids: ObjId[] };
  steps: Step[];
  /** the targets of the ability that created it ("t1" keeps meaning the same object) */
  targets: Record<string, string[]>;
  ctx: TriggerContext;
  expires?: Expiry;
  label: string;
}

export type LogEntry = { type: string; player?: PlayerId; id?: ObjId; name?: string; types?: string[]; token?: boolean; amount?: number; ts: number };

export interface Config {
  /** true: abilities the engine cannot run on a card that enters play are ignored with an `unsupported_ignored` event instead of an error */
  lenient: boolean;
  skipFirstDraw: boolean;
  maxEventsPerPass: number;
  handSize: number;
}

// ---------------------------------------------------------------- combat

export interface CombatCreature { id: ObjId; /** timestamp when it was declared: a creature that left and came back is not in combat any more */ ts: number }
export interface Attacker extends CombatCreature {
  /** the defending player's id, or the id of the planeswalker / battle being attacked */
  defender: string;
  /** blockers in the order they were declared */
  blockers: CombatCreature[];
  /** stays true when every blocker leaves (a blocked creature stays blocked, 506.4) */
  blocked: boolean;
}
export type CombatExpect =
  | { kind: "attackers"; player: PlayerId }
  | { kind: "blockers"; /** defending players that still have to declare, in turn order */ players: PlayerId[] };
export interface CombatState {
  attackers: Attacker[];
  /** creatures that dealt damage in the first-strike step (they do not deal regular damage again unless they have double strike) */
  dealtFirst: ObjId[];
  /** what the engine waits for (a declare* action) before the step goes on; priority is null meanwhile */
  expect: CombatExpect | null;
}

export interface GameState {
  version: 1;
  config: Config;
  seed: number;
  rngState: number;
  nextId: number;
  clock: number;
  decisionSeq: number;
  players: PlayerState[];
  objects: Record<ObjId, GameObject>;
  battlefield: ObjId[];
  stack: StackItem[];
  turn: { number: number; active: PlayerId; phase: Phase };
  /** null while nobody holds priority (untap/cleanup, a pending decision, game over) */
  priority: PlayerId | null;
  /** players that passed in succession since the last action */
  passes: PlayerId[];
  effects: ContinuousEffect[];
  /** last-known information of permanents that left the battlefield during the current resolution ("its controller", "its power") */
  lki: Record<ObjId, Lki>;
  turnLog: LogEntry[];
  /** "<objectId>:<abilityId>" -> count this turn / this game ("g:" prefix) */
  activations: Record<string, number>;
  triggerQueue: QueuedTrigger[];
  /** who receives priority once triggers are put on the stack (the caster after a cast, else the active player) */
  priorityAfter: PlayerId | null;
  pending: Pending | null;
  gameOver: { winner?: PlayerId; draw?: boolean; reason: string } | null;
  /** null outside the combat phase */
  combat: CombatState | null;
  /** additional combat phases still to come this turn (extra_combat) */
  extraCombats: number;
  /** the monarch (kernel step 6): draws at their end step; combat damage to them by a creature steals it */
  monarch?: PlayerId;
  /** player-scoped durable effects (older states may lack the field: read it with `?? []`) */
  durableEffects?: DurableEffect[];
  /** delayed triggers waiting for their moment */
  delayedTriggers?: DelayedTrigger[];
  /** players with an extra turn coming (the last entry is next) */
  extraTurns?: PlayerId[];
  /** linked exile (links.ts): hideaway, imprint, "cards exiled with this" */
  links?: Array<{ source: ObjId; sourceTs: number; object: ObjId; objectTs: number }>;
  /** per-opponent / per-spell commander bookkeeping (commander.ts) */
  commanderDamage?: Record<PlayerId, Record<ObjId, number>>;
}

// ---------------------------------------------------------------- pending decisions

export type DecisionKind =
  | "choose_modes" | "choose_targets" | "choose_x" | "choose_cards" | "choose_yes_no" | "choose_color"
  | "order_triggers" | "cast_target_player" | "order_replacements" | "assign_damage" | "choose_option" | "choose_number" | "pay_unless" | "choose_cast_option" | "assign_mana" | "assign_counters";

export interface DecisionOption { id: string; label: string }

export interface PendingView {
  id: string;
  kind: DecisionKind;
  player: PlayerId;
  prompt: Prompt;
  options: DecisionOption[];
  min: number;
  max: number;
  /** true when the same option id may appear more than once in the answer (repeatable modes) */
  repeatable?: boolean;
  /** true for answers that are a number rather than option ids */
  numeric?: boolean;
  /** assign_damage: how much combat damage the attacker has to divide, and the lethal amount per recipient (blockers; the defender needs none) */
  amounts?: { total: number; lethal: Record<string, number>; trample: boolean };
  /** assign_mana: split `total` mana between `colors`; the answer is `assign: {color: amount}` */
  mana?: { total: number; colors: string[] };
  /** assign_counters: split between the options (counter kinds, or objects holding counters of one kind); the answer is `assign: {optionId: amount}` */
  counters?: { min: number; max: number; available: Record<string, number> };
  cancellable: boolean;
}

export interface Pending extends PendingView {
  /** internal continuation; opaque to adapters */
  ctx: PendingCtx;
}

export type PendingCtx =
  | { t: "draft"; draft: Draft; stage: "face" | "option" | "extras" | "gift" | "modes" | "targets" | "x" | "color" | "costs" | "crew" | "phyrexian" | "counters" | "improvise"; partIndex?: number; specIndex?: number }
  | { t: "exec"; exec: Exec }
  | { t: "triggers"; stage: "order" | "targets"; player: PlayerId; triggerId?: string; draft?: Draft }
  | { t: "cleanup_discard" }
  /** combat damage waiting for an attacker's controller to divide its damage among several blockers (combat.ts) */
  | { t: "combat_damage"; which: "first" | "regular"; assigned: Record<ObjId, Record<string, number>>; attacker: ObjId }
  /** a replacement-ordering question: answering re-runs `action` from `base` with the recorded answers (see replacements.ts) */
  | { t: "replay"; base: GameState; action: Action; answers: Choice[]; delivered: number };

// ---------------------------------------------------------------- casting drafts / interpreter

export interface Draft {
  kind: "spell" | "activated" | "triggered";
  player: PlayerId;
  sourceId: ObjId;
  objectId?: ObjId;
  abilityId: string;
  modeIds?: string[];
  parts?: Part[];
  x?: number;
  xChosen?: boolean;
  cast?: CastInfo;
  trigger?: TriggerContext;
  triggerId?: string;
  /** where the card came from (to put it back on cancel) */
  origin?: { zone: Zone; index: number };
  payWith?: ObjId[];
  autoPay?: boolean;
  /** "for each opponent" target slots: opponents already asked and the targets picked so far, by slot id */
  perOpp?: Record<string, { done: string[]; picked: string[] }>;
  /** Phyrexian mana symbols, in cost order: how each is paid ("mana" or "life"); filled by the phyrexian stage, preset by the action shortcut */
  phy?: Array<"mana" | "life">;
  phyPreset?: Array<"mana" | "life">;
  phyUsed?: number;
  /** "next spell" grants consumed by this cast, and the artifacts tapped for improvise */
  grants?: string[];
  improvised?: string[];
  improviseDone?: boolean;
  /** castSpell shortcut: the artifacts to tap for improvise */
  improvisePreset?: string[];
  /** cost index -> counters chosen to remove from among permanents (object id -> amount) */
  counterChoices?: Record<number, Record<string, number>>;
  /** mana ability being activated: chosen color */
  color?: string;
  /** cost index -> object ids the player chose for a cost that needs a choice (sacrifice another, discard, tap other...) */
  costChoices?: Record<number, string[]>;
  /** casting option stage: the ids of the options in force (base option + extras + mandatory additional costs); undefined = not decided yet */
  castChosen?: string[];
  /** the base way was decided ("normal" or a replacing option) / the optional extras were decided */
  castBaseDone?: boolean;
  /** double-faced: the face to cast was decided */
  faceDone?: boolean;
  castExtrasDone?: boolean;
  castExtras?: string[];
  /** the base option id the caster picked ("" = the normal way) */
  castBase?: string;
  /** gift: the opponent who gets the gift */
  giftTo?: PlayerId;
  /** the "you may cast it" permissions the card had when the cast began (they refer to the object BEFORE it moved to the stack) */
  permSnap?: import("../schema").CastOption[];
  /** loyalty cost of a planeswalker ability, already applied while paying */
  loyaltyPaid?: boolean;
}

export interface Frame { steps: Step[]; i: number }
export interface Env {
  item: StackItem;
  source: ObjId;
  controller: PlayerId;
  x: number;
  targets: Record<string, string[]>;
  chosen: Record<string, string[]>;
  done: string[];
  created: string[];
  iterated?: string;
  eventObj?: string;
  eventPlayer?: PlayerId;
  amount?: number;
  lastLifeLost?: number;
  sacrificed?: string[];
  /** object id -> timestamp it had when a step saved it (a saved object that changed zone since is a NEW object and is no longer referenced) */
  savedTs?: Record<string, number>;
  /** the saved-choice key written last ("chosen" in the card text) */
  lastChosen?: string;
  /** cards a look_top step looked at (rest_of_looked_cards / choose fromLooked) */
  looked?: string[];
  /** the player the current repeat_for_each iteration is about ("that player") */
  thatPlayer?: PlayerId;
}
export interface Exec { frames: Frame[]; env: Env; partIndex: number }

// ---------------------------------------------------------------- actions

export type Action =
  | { type: "castSpell"; player: PlayerId; cardId: ObjId; modes?: string[]; targets?: Record<string, string[]>; x?: number; payWith?: ObjId[]; autoPay?: boolean;
      /** how each Phyrexian mana symbol is paid, in cost order (asked as a decision when omitted) */
      phyrexian?: Array<"mana" | "life">;
      /** artifacts to tap for improvise (asked as a decision when omitted) */
      improvise?: ObjId[];
      /** cast option stage shortcuts: the replacing option id ("normal" / "" = the normal way) and the optional extras to add (kicker, gift...) */
      option?: string; extras?: string[];
      /** double-faced cards: the face to cast (modal double-faced / split) */
      face?: string }
  | { type: "activateAbility"; player: PlayerId; sourceId: ObjId; abilityId: string; targets?: Record<string, string[]>; x?: number; color?: string; payWith?: ObjId[]; autoPay?: boolean; phyrexian?: Array<"mana" | "life"> }
  | { type: "playLand"; player: PlayerId; cardId: ObjId; /** modal double-faced lands: which face to play */ face?: string }
  | { type: "passPriority"; player: PlayerId; fastForward?: boolean }
  | { type: "answerDecision"; player: PlayerId; decisionId: string; choice: Choice }
  | { type: "advancePhase"; player: PlayerId }
  /** the active player's turn-based action in the declare attackers step; an empty list = no attack. Attack taxes are paid from the pool / by tapping sources (payWith, autoPay as for casting). */
  | { type: "declareAttackers"; player: PlayerId; attackers: Array<{ id: ObjId; defender: string }>; payWith?: ObjId[]; autoPay?: boolean }
  /** a defending player's declaration; each block names one of the player's own creatures and the attacker it blocks */
  | { type: "declareBlockers"; player: PlayerId; blocks: Array<{ blocker: ObjId; attacker: ObjId }>; payWith?: ObjId[]; autoPay?: boolean };

export interface Choice {
  ids?: string[]; number?: number; yes?: boolean; cancel?: boolean;
  /** assign_damage: recipient id -> damage (must add up to the amount to divide) */
  assign?: Record<string, number>;
}

export type EventBase = { type: string; [k: string]: unknown };
export interface GameEvent extends EventBase { seq: number }

export type ErrorCode =
  | "game_over" | "decision_pending" | "no_decision" | "wrong_decision" | "not_your_priority" | "not_your_decision"
  | "wrong_timing" | "not_in_zone" | "not_owner" | "unknown_object" | "unknown_card" | "unknown_ability"
  | "illegal_target" | "invalid_choice" | "cannot_pay" | "cannot_activate" | "unsupported" | "loop_detected"
  | "not_castable" | "stack_not_empty" | "land_limit"
  // combat
  | "declaration_pending" | "not_declaring" | "not_your_declaration" | "illegal_attack" | "illegal_block" | "attack_requirement";

export interface EngineError { code: ErrorCode; message: string; capability?: string[] }

export interface ResolveResult {
  state: GameState;
  events: GameEvent[];
  pending?: PendingView;
  error?: EngineError;
}

/** Printed data of one card from the host's database. */
export interface CardInfo { name: string; manaCost?: string; types: string[]; subtypes?: string[]; supertypes?: string[]; colors?: string[]; power?: number; toughness?: number; loyalty?: number; layout?: CardDef["layout"] | "adventure"; faces?: Record<string, FaceDef>; oracle?: string }
/**
 * The host's card database (kernel step 6). Used by "choose a creature type / card name" (the full lists) and to complete multi-faced
 * cards (faces, layout). Pure lookups: the engine never does I/O. A test adapter built from data/cards.db lives in testdb.ts.
 */
export interface CardDb {
  creatureTypes(): readonly string[];
  cardNames(): readonly string[];
  card(name: string): CardInfo | undefined;
}
export interface EngineContext { cards: CardLookup; db?: CardDb }
