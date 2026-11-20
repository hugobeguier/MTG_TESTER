// Kernel engine state model. Everything here is plain JSON (no Map/Set/class instances) so a state can be
// serialized, snapshotted and compared with toEqual. See README.md for the protocol.

import type { Card, Phase, Prompt, Step, TargetSpec, Zone } from "../schema";

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
  kernel: Card;
}
export type CardLookup = (name: string) => CardDef | undefined;

export interface TokenDef {
  name: string;
  types: string[];
  subtypes: string[];
  colors: string[];
  power?: number;
  toughness?: number;
  keywords: string[];
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
  landsPlayed: number;
  /** clock value when this player's most recent turn began (summoning sickness) */
  lastTurnStartTs: number;
  hasLost: boolean;
  drewFromEmpty: boolean;
  colorIdentity: string[];
  commanderCasts: Record<ObjId, number>;
}

export interface CastInfo {
  turn: number;
  phase: Phase;
  activePlayer: PlayerId;
  from: Zone;
  caster: PlayerId;
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
}

export interface Lki { controller: PlayerId; owner: PlayerId; name: string; types: string[]; subtypes: string[]; colors: string[]; mv: number; power?: number; toughness?: number; token: boolean }

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
  until: "end_of_turn";
}

export type LogEntry = { type: string; player?: PlayerId; id?: ObjId; name?: string; types?: string[]; token?: boolean; amount?: number; ts: number };

export interface Config {
  /** true: abilities the engine cannot run on a card that enters play are ignored with an `unsupported_ignored` event instead of an error */
  lenient: boolean;
  skipFirstDraw: boolean;
  maxEventsPerPass: number;
  handSize: number;
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
}

// ---------------------------------------------------------------- pending decisions

export type DecisionKind =
  | "choose_modes" | "choose_targets" | "choose_x" | "choose_cards" | "choose_yes_no" | "choose_color"
  | "order_triggers" | "cast_target_player";

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
  /** how many events the caller already received (resume bookkeeping) */
  cancellable: boolean;
}

export interface Pending extends PendingView {
  /** internal continuation; opaque to adapters */
  ctx: PendingCtx;
}

export type PendingCtx =
  | { t: "draft"; draft: Draft; stage: "modes" | "targets" | "x" | "color"; partIndex?: number; specIndex?: number }
  | { t: "exec"; exec: Exec }
  | { t: "triggers"; stage: "order" | "targets"; player: PlayerId; triggerId?: string; draft?: Draft }
  | { t: "cleanup_discard" };

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
  /** mana ability being activated: chosen color */
  color?: string;
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
}
export interface Exec { frames: Frame[]; env: Env; partIndex: number }

// ---------------------------------------------------------------- actions

export type Action =
  | { type: "castSpell"; player: PlayerId; cardId: ObjId; modes?: string[]; targets?: Record<string, string[]>; x?: number; payWith?: ObjId[]; autoPay?: boolean }
  | { type: "activateAbility"; player: PlayerId; sourceId: ObjId; abilityId: string; targets?: Record<string, string[]>; x?: number; color?: string; payWith?: ObjId[]; autoPay?: boolean }
  | { type: "playLand"; player: PlayerId; cardId: ObjId }
  | { type: "passPriority"; player: PlayerId; fastForward?: boolean }
  | { type: "answerDecision"; player: PlayerId; decisionId: string; choice: Choice }
  | { type: "advancePhase"; player: PlayerId };

export interface Choice { ids?: string[]; number?: number; yes?: boolean; cancel?: boolean }

export type EventBase = { type: string; [k: string]: unknown };
export interface GameEvent extends EventBase { seq: number }

export type ErrorCode =
  | "game_over" | "decision_pending" | "no_decision" | "wrong_decision" | "not_your_priority" | "not_your_decision"
  | "wrong_timing" | "not_in_zone" | "not_owner" | "unknown_object" | "unknown_card" | "unknown_ability"
  | "illegal_target" | "invalid_choice" | "cannot_pay" | "cannot_activate" | "unsupported" | "loop_detected"
  | "not_castable" | "stack_not_empty" | "land_limit";

export interface EngineError { code: ErrorCode; message: string; capability?: string[] }

export interface ResolveResult {
  state: GameState;
  events: GameEvent[];
  pending?: PendingView;
  error?: EngineError;
}

export interface EngineContext { cards: CardLookup }
