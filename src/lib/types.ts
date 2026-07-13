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
  manaValue: number;
  colors: string[];
  colorIdentity: string[];
  producedMana?: string[];
  rarity?: string;
  set?: string;
  collectorNumber?: string;
  power?: string;
  toughness?: string;
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
  power?: string;
  toughness?: string;
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
  deck?: CommanderDeck;
  zones: Record<ZoneName, number>;
  board: PlayerBoardState;
  landsPlayed?: number;
  commanderCasts?: number;
  lastThought?: string;
}

export interface VisibleCard {
  id: string;
  name: string;
  typeLine: string;
  oracleText: string;
  manaValue: number;
  colors: string[];
  colorIdentity?: string[];
  imageUris?: CardImageUris;
  faces?: CardFaceRecord[];
  faceIndex?: number;
  role: string;
  zone: ZoneName;
  tapped?: boolean;
  summoningSick?: boolean;
  attacking?: boolean;
  blocking?: boolean;
  commander?: boolean;
  battlefieldPosition?: {
    x: number;
    z: number;
  };
  power?: string;
  toughness?: string;
  counters?: Array<{
    kind: string;
    count: number;
  }>;
}

export interface PlayerBoardState {
  commander?: VisibleCard;
  hand: VisibleCard[];
  battlefield: VisibleCard[];
  library: VisibleCard[];
  graveyard: VisibleCard[];
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
    | "activate_ability"
    | "attack"
    | "block"
    | "pass_priority"
    | "end_turn";
  targetIds: string[];
  cardId?: string;
  manaPlan?: string;
  reason: string;
  fallbackAction: "pass_priority" | "end_turn";
}
