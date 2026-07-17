export type SeatKind = "human" | "agent";

export type ZoneName =
  | "library"
  | "hand"
  | "battlefield"
  | "graveyard"
  | "exile"
  | "command";

export type AgentName = "Veyra" | "Malik" | "Sable";

export interface CardRecord {
  id: string;
  oracleId?: string;
  name: string;
  typeLine: string;
  oracleText: string;
  manaCost?: string;
  manaValue: number;
  colors: string[];
  colorIdentity: string[];
  producedMana?: string[];
  rarity?: string;
  set?: string;
  collectorNumber?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  imageUris?: CardImageUris;
  faces?: CardFaceRecord[];
  legalities?: Record<string, string>;
  isGameChanger?: boolean;
}

export interface CardImageUris {
  small?: string;
  normal?: string;
  large?: string;
  png?: string;
  artCrop?: string;
  borderCrop?: string;
}

export interface CardFaceRecord {
  name: string;
  typeLine: string;
  oracleText: string;
  colors: string[];
  manaCost?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  imageUris?: CardImageUris;
}

export interface DeckCard {
  name: string;
  count: number;
  role?: string;
  cardId?: string;
  card?: CardRecord;
}

export interface CommanderDeck {
  id: string;
  name: string;
  commander: string;
  bracket: 3;
  colors: string[];
  commanderCard?: CardRecord;
  cards: DeckCard[];
  createdBy: string;
  createdAt: string;
  validation: DeckValidationReport;
  score: DeckScore;
}

export interface DeckValidationReport {
  legal: boolean;
  errors: string[];
  warnings: string[];
  cardCount: number;
  uniqueNonBasicCount: number;
  gameChangerCount: number;
}

export interface DeckScore {
  total: number;
  curve: number;
  mana: number;
  interaction: number;
  synergy: number;
  resilience: number;
  bracketFit: number;
  notes: string[];
}

export interface PlayerSeat {
  id: string;
  name: string;
  kind: SeatKind;
  agentName?: AgentName;
  life: number;
  commanderDamage: Record<string, number>;
  poison?: number;
  hasLost?: boolean;
  lossReason?: string;
  deck?: CommanderDeck;
  library?: VisibleCard[];
  zones: Record<ZoneName, number>;
  board: PlayerBoardState;
  // "The next spell you cast this turn has affinity for artifacts" (Saheeli, the Gifted's second
  // +1) — a boolean rather than a locked-in number because the reduction is "for each artifact you
  // control as you cast it" (reminder text), i.e. evaluated at cast time, not activation time.
  nextSpellHasArtifactAffinity?: boolean;
}

export interface InterpretedEffect {
  kind: "attack_tax";
  amountPerAttacker: number;
  formula?: "enchantment_count";
  appliesTo: "controller" | "planeswalkers" | "both";
  sourceCardId: string;
  sourceCardName: string;
  interpretedBy: "deterministic" | "ollama";
}

export interface VisibleCard {
  id: string;
  name: string;
  typeLine: string;
  oracleText: string;
  manaCost?: string;
  manaValue: number;
  colors: string[];
  colorIdentity?: string[];
  producedMana?: string[];
  imageUris?: CardImageUris;
  faces?: CardFaceRecord[];
  unlockedFaceIndices?: number[];
  interpretedEffects?: InterpretedEffect[];
  temporaryPowerBonus?: number;
  temporaryToughnessBonus?: number;
  attachedToId?: string;
  // Set instead of attachedToId for an "Enchant player" Aura (Overwhelming Splendor, the Curse
  // cycle, ...) — this engine has no per-creature-permanent object for a player to attach to, so
  // the enchanted seat is referenced directly.
  attachedToSeatId?: string;
  attachmentPowerBonus?: number;
  attachmentToughnessBonus?: number;
  grantedKeywords?: string[];
  grantedProtectionColors?: string[];
  // Additional card types granted by a static ability elsewhere (Secret Arcade-style "X you
  // control are Y in addition to their other types") — recomputed every state-based-action pass
  // from current board state, same pattern as grantedKeywords. Everything reading card.typeLine
  // directly still ignores this; hasCardType() (src/lib/typeGrants.ts) is the choke point for
  // code that needs to see through it.
  grantedTypes?: string[];
  // "As this enters, choose a creature type." (Cavern of Souls, Urza's Incubator, Morophon, ...) —
  // locked in once at ETB and referenced by later "of the chosen type" clauses on the same card.
  // Real Magic leaves the choice up to the controller with no UI to prompt for it yet, so this
  // engine picks deterministically (see pickChosenCreatureType in characteristics.ts).
  chosenCreatureType?: string;
  // "As this land enters, choose a color other than X." (the Thriving cycle, the Gate cycle, ...)
  // — a single WUBRG letter, locked in once at ETB the same way chosenCreatureType is.
  chosenColor?: string;
  attachTimestamp?: number;
  cdaPower?: number;
  cdaToughness?: number;
  setPowerOverride?: number;
  setToughnessOverride?: number;
  role: string;
  zone: ZoneName;
  tapped?: boolean;
  summoningSick?: boolean;
  attacking?: boolean;
  attackTargetId?: string;
  blockDecided?: boolean;
  blocking?: boolean;
  blockingTargetId?: string;
  // Set on the ATTACKING creature when it has two or more blockers: the order (blocker card ids)
  // its controller assigns combat damage in — first entry gets lethal before any excess moves to
  // the next (rule 509.2/510.1c). Undefined/single-blocker attacks don't need it.
  damageAssignmentOrder?: string[];
  commander?: boolean;
  commanderTax?: number;
  token?: boolean;
  tokenSourceCardId?: string;
  // The seat this card truly belongs to, distinct from whichever seat's zone array currently
  // holds it — set whenever a card changes controller (reanimation, theft, temporary control
  // change) so it still goes to its OWNER's graveyard when it eventually dies, per rule 404.4/
  // "permanents are put into their owner's graveyard," not whoever controls it at the time.
  // Undefined means "never changed hands" (owner == whichever seat currently holds it, which is
  // still true for the overwhelming majority of cards — only reanimation/theft effects set this).
  ownerSeatId?: string;
  // Which seat may currently cast/play this card while it sits in exile (impulse-draw effects
  // like "exile the top card, you may play it this turn," or steal-and-play effects like
  // Praetor's Grasp). Undefined means it's just a normal exiled card with no play permission.
  exiledPlayableBySeatId?: string;
  // The last turn number this exile-play permission is valid through; undefined means no time
  // limit (Praetor's Grasp-style "for as long as it remains exiled" — only losing exile ends it).
  exiledPlayableUntilTurn?: number;
  // Set when the exile-play permission also waives the mana cost (Mind's Dilation-style "you may
  // cast that card without paying its mana cost") — undefined/false means the normal cost still
  // applies, same as any other exile-cast permission.
  exiledPlayableFree?: boolean;
  // Set when a "gain control...until end of turn" effect (Threaten-style) moved this permanent to
  // a new controller's battlefield — cleared, and control reverted to ownerSeatId, by
  // clearTemporaryBuffs at the next turn change, same timing as temporaryPowerBonus.
  temporaryControlChange?: boolean;
  battlefieldPosition?: {
    x: number;
    z: number;
  };
  power?: string;
  toughness?: string;
  loyalty?: string;
  counters?: Array<{
    kind: string;
    count: number;
  }>;
}

export interface PlayerBoardState {
  commander?: VisibleCard;
  hand: VisibleCard[];
  battlefield: VisibleCard[];
  graveyard?: VisibleCard[];
  exile?: VisibleCard[];
}

export interface GameEvent {
  id: string;
  at: string;
  seatId?: string;
  message: string;
  detail?: string;
}

// A snapshot of one agent seat's most recent LLM decision, kept purely for the "thinking" HUD
// badge/modal (AppFlow -> ThreeGameTable) — UI/debug state, not real game-rules state, so it never
// touches GameSession itself. reason may be "" for deterministic fallback decisions (no LLM
// round-trip happened, e.g. a JSON-parse failure or network error on the /api/agents/action call).
export interface AgentReasoning {
  label: string;
  reason: string;
  purpose: string;
  at: string;
  // The agent's internal "argue with itself" pass over its top candidate actions before committing
  // — only requested for main_phase/priority_response purposes (see app/api/agents/action/route.ts),
  // since asking for it on every attack/block declaration too would meaningfully slow the game down
  // for a small local model with no proportional benefit (those choices are already fairly
  // mechanical). Undefined for deterministic-fallback decisions and for purposes that don't ask for it.
  deliberation?: string;
}

export interface GameSession {
  id: string;
  createdAt: string;
  status: "lobby" | "deckbuilding" | "ready" | "playing" | "complete";
  winnerSeatId?: string;
  activePlayerId?: string;
  phase: string;
  turn: number;
  xmage: {
    enabled: boolean;
    status: "not_configured" | "offline" | "connected" | "error";
    matchId?: string;
    message: string;
  };
  seats: PlayerSeat[];
  events: GameEvent[];
  // A monotonic counter (not wall-clock time) stamped onto continuous effects as they're created
  // (Aura attaches, Equipment equips, ...) so layer 7b's "the newest effect wins" rule has
  // something real to compare when multiple effects would otherwise conflict.
  effectTimestampCounter?: number;
  // Creatures destroyed since the last drain, recorded here because destroyCreatures() is a pure
  // session transformer with no access to the trigger-queueing machinery (which lives in
  // AppFlow's component scope). The setSession choke point drains this after every state-based
  // action pass, looks up "whenever a creature dies" triggers against it, and clears it — so every
  // death path (combat, removal spells, sacrifice, state-based 0-toughness) fires death triggers
  // uniformly instead of each call site having to remember to do it.
  // attachedSourceIds: ids of any Equipment/Aura that were attached to this card at the moment it
  // died, captured before the same state-based-action pass clears their attachedToId (since the
  // creature is already gone from the battlefield by then) — "whenever equipped/enchanted creature
  // dies" triggers need this snapshot rather than the (by-then-cleared) live attachedToId.
  pendingDeaths?: Array<{ seatId: string; card: VisibleCard; attachedSourceIds?: string[] }>;
  // Dedup keys ("turn:sourceCardId:effectKind") for triggered effects restricted by a trailing
  // "Do this only once each turn" clause — resolveTriggerEffect() is a pure function with no
  // per-turn ref to check against, so the dedup state lives on the session itself instead.
  onceEachTurnEffectsUsed?: string[];
  // Circuit breaker for common-trigger resolution: counts how many have resolved this turn so an
  // unbounded self-recursive chain (e.g. a self-copying permanent whose "once each turn"
  // restriction is per-object, not per-player, so each fresh copy can trigger again) gets stopped
  // instead of looping forever. Self-resets when the turn number changes.
  triggerChainGuard?: { turn: number; count: number };
}

export interface AgentAction {
  actionType:
    | "keep_hand"
    | "mulligan"
    | "play_land"
    | "cast_spell"
    | "cast_commander"
    | "activate_ability"
    | "attack"
    | "block"
    | "pass_priority"
    | "end_turn";
  legalActionId?: string;
  targetIds: string[];
  cardId?: string;
  manaPlan?: string;
  reason: string;
  // The agent's own written-out argument with itself over its top candidate actions, weighing what
  // each accomplishes against what it costs or risks, before settling on legalActionId — see
  // AgentReasoning.deliberation for where this ends up surfaced.
  deliberation?: string;
  fallbackAction: "pass_priority" | "end_turn";
}
