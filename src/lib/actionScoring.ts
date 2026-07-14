export type ScorableActionType =
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

export interface ScorableAction {
  id: string;
  actionType: ScorableActionType;
  cardId?: string;
  targetIds: string[];
  label: string;
  detail?: string;
  role?: string;
}

export interface CardLike {
  id: string;
  name?: string;
  power?: string;
  toughness?: string;
  manaValue?: number;
  role?: string;
  tapped?: boolean;
  oracleText?: string;
}

export interface ScoringContext {
  purpose?: string;
  turn?: number;
  you?: {
    life?: number;
    battlefield?: CardLike[];
    hand?: CardLike[];
    commander?: CardLike;
    availableMana?: { total?: number };
  };
  opponents?: Array<{
    id?: string;
    name?: string;
    life?: number;
    battlefield?: CardLike[];
  }>;
  stack?: Array<{ id?: string; cardName?: string }>;
}

export interface ScoredAction extends ScorableAction {
  score: number;
  reasons: string[];
}

const BASELINE_SCORE_BY_ACTION_TYPE: Record<ScorableActionType, number> = {
  play_land: 4,
  cast_spell: 3,
  cast_commander: 3,
  activate_ability: 2,
  attack: 2,
  block: 2,
  keep_hand: 1,
  mulligan: 0,
  pass_priority: 0,
  end_turn: 0
};

const EARLY_RAMP_TURN_CUTOFF = 4;
const MID_RAMP_TURN_CUTOFF = 8;

function parseNum(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function findCard(cards: CardLike[] | undefined, id: string | undefined): CardLike | undefined {
  if (!id) return undefined;
  return cards?.find((card) => card.id === id);
}

function opponentBattlefields(context: ScoringContext): CardLike[] {
  return (context.opponents ?? []).flatMap((opponent) => opponent.battlefield ?? []);
}

function hasKeyword(card: CardLike, keyword: string): boolean {
  return new RegExp(`\\b${keyword}\\b`, "i").test(card.oracleText ?? "");
}

function hasFlying(card: CardLike) {
  return hasKeyword(card, "flying");
}

function hasReach(card: CardLike) {
  return hasKeyword(card, "reach");
}

function hasDeathtouch(card: CardLike) {
  return hasKeyword(card, "deathtouch");
}

function hasTrample(card: CardLike) {
  return hasKeyword(card, "trample");
}

function hasFirstStrike(card: CardLike) {
  return hasKeyword(card, "first strike");
}

function hasDoubleStrike(card: CardLike) {
  return hasKeyword(card, "double strike");
}

function hasIndestructible(card: CardLike) {
  return hasKeyword(card, "indestructible");
}

function canLegallyBlock(attacker: CardLike, blocker: CardLike): boolean {
  return !hasFlying(attacker) || hasFlying(blocker) || hasReach(blocker);
}

function isLethalTo(source: CardLike, damage: number, targetToughness: number): boolean {
  if (damage <= 0) return false;
  return hasDeathtouch(source) || damage >= targetToughness;
}

function scoreLandsBeforeSpells(action: ScorableAction, delta: (amount: number, reason: string) => void) {
  if (action.actionType === "play_land") {
    delta(2, "playing a land uses a free resource and should rarely be skipped");
  }
}

function scoreRampEarly(action: ScorableAction, context: ScoringContext, delta: (amount: number, reason: string) => void) {
  if (action.actionType !== "cast_spell" && action.actionType !== "cast_commander") return;
  if (action.role !== "ramp") return;
  const turn = context.turn ?? 1;
  if (turn <= EARLY_RAMP_TURN_CUTOFF) {
    delta(3, "ramp is most valuable when cast early");
  } else if (turn <= MID_RAMP_TURN_CUTOFF) {
    delta(1, "ramp still helps at this turn but is less impactful than earlier");
  }
}

function scoreRemovalTargeting(action: ScorableAction, context: ScoringContext, delta: (amount: number, reason: string) => void) {
  if (action.actionType !== "cast_spell" || action.role !== "removal") return;
  const targetId = action.targetIds[0];
  if (!targetId) {
    return;
  }
  const allOpponentCreatures = opponentBattlefields(context);
  const target = findCard(allOpponentCreatures, targetId);
  if (!target) return;
  const targetPower = parseNum(target.power) ?? 0;
  const biggestThreatPower = Math.max(0, ...allOpponentCreatures.map((card) => parseNum(card.power) ?? 0));
  if (biggestThreatPower > 0 && targetPower >= biggestThreatPower) {
    delta(2, "removal aimed at the biggest threat on the board");
  } else if (biggestThreatPower > 0 && targetPower < biggestThreatPower / 2) {
    delta(-2, "removal spent on a comparatively minor permanent while bigger threats exist");
  }
}

function scoreAttackProfitability(action: ScorableAction, context: ScoringContext, delta: (amount: number, reason: string) => void) {
  if (action.actionType !== "attack") return;
  const attacker = findCard(context.you?.battlefield, action.cardId);
  const attackerPower = parseNum(attacker?.power);
  const attackerToughness = parseNum(attacker?.toughness);
  if (!attacker || attackerPower === undefined) return;

  const potentialBlockers = opponentBattlefields(context).filter(
    (card) => !card.tapped && parseNum(card.power) !== undefined && canLegallyBlock(attacker, card)
  );
  if (potentialBlockers.length === 0) {
    delta(3, "no untapped, legally-able blockers across opponents");
    return;
  }

  const survivesEveryBlock = potentialBlockers.every((blocker) => {
    if (hasIndestructible(attacker)) return true;
    const blockerPower = parseNum(blocker.power) ?? 0;
    return attackerToughness === undefined || !isLethalTo(blocker, blockerPower, attackerToughness);
  });
  const killsAtLeastOneBlocker = potentialBlockers.some((blocker) => {
    if (hasIndestructible(blocker)) return false;
    const blockerToughness = parseNum(blocker.toughness);
    return blockerToughness !== undefined && isLethalTo(attacker, attackerPower, blockerToughness);
  });

  if (hasDeathtouch(attacker)) {
    delta(1, "deathtouch threatens any blocker regardless of toughness");
  }
  if (hasTrample(attacker) && killsAtLeastOneBlocker) {
    delta(1, "trample carries excess damage through a dying blocker");
  }
  if ((hasFirstStrike(attacker) || hasDoubleStrike(attacker)) && killsAtLeastOneBlocker) {
    delta(1, "first/double strike can kill a blocker before it deals damage back");
  }

  if (survivesEveryBlock && killsAtLeastOneBlocker) {
    delta(2, "attacker favorably trades or survives against likely blockers");
  } else if (!survivesEveryBlock && !killsAtLeastOneBlocker) {
    delta(-2, "attacker likely dies without killing a blocker");
  }
}

function scoreHoldInstants(action: ScorableAction, context: ScoringContext, delta: (amount: number, reason: string) => void) {
  if (context.purpose !== "priority_response") return;
  const stackHasSomethingToAnswer = (context.stack?.length ?? 0) > 0;
  if (action.actionType === "cast_spell") {
    if (stackHasSomethingToAnswer) {
      delta(1, "responding while something is on the stack");
    } else {
      delta(-3, "casting an instant into an empty stack instead of holding it for a better window");
    }
  } else if (action.actionType === "pass_priority" && !stackHasSomethingToAnswer) {
    delta(1, "holding instants for a better priority window");
  }
}

function scoreUpkeepValue(action: ScorableAction, context: ScoringContext, delta: (amount: number, reason: string) => void) {
  if (action.actionType !== "activate_ability") return;
  if (!/upkeep/i.test(action.detail ?? "")) return;
  const life = context.you?.life ?? 40;
  if (life <= 10) {
    delta(-1, "paying a rising upkeep cost while at low life is risky");
  }
}

export function scoreLegalAction(action: ScorableAction, context: ScoringContext): { score: number; reasons: string[] } {
  let score = BASELINE_SCORE_BY_ACTION_TYPE[action.actionType] ?? 0;
  const reasons: string[] = [];
  const delta = (amount: number, reason: string) => {
    score += amount;
    reasons.push(reason);
  };

  scoreLandsBeforeSpells(action, delta);
  scoreRampEarly(action, context, delta);
  scoreRemovalTargeting(action, context, delta);
  scoreAttackProfitability(action, context, delta);
  scoreHoldInstants(action, context, delta);
  scoreUpkeepValue(action, context, delta);

  return { score, reasons };
}

export function scoreLegalActions(actions: ScorableAction[], context: ScoringContext): ScoredAction[] {
  return actions
    .map((action) => ({ ...action, ...scoreLegalAction(action, context) }))
    .sort((a, b) => b.score - a.score);
}
