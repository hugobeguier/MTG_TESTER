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
  hasLost?: boolean;
  lossReason?: string;
  deck?: CommanderDeck;
  library?: VisibleCard[];
  zones: Record<ZoneName, number>;
  board: PlayerBoardState;
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
  role: string;
  zone: ZoneName;
  tapped?: boolean;
  summoningSick?: boolean;
  attacking?: boolean;
  attackTargetId?: string;
  blockDecided?: boolean;
  blocking?: boolean;
  blockingTargetId?: string;
  commander?: boolean;
  commanderTax?: number;
  token?: boolean;
  tokenSourceCardId?: string;
  ownerSeatId?: string;
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
  fallbackAction: "pass_priority" | "end_turn";
}
