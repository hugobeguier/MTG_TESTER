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
  typeLine?: string;
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
    poison?: number;
    // Commander damage this seat has taken, keyed by the dealing commander's card id (see
    // AppFlow.tsx's applyCombatDamageToTarget) — lets scoring recognize "this specific attacker
    // is already close to the 21-damage loss condition" rather than just comparing raw stats.
    commanderDamage?: Record<string, number>;
    battlefield?: CardLike[];
    hand?: CardLike[];
    commander?: CardLike;
    availableMana?: { total?: number };
  };
  opponents?: Array<{
    id?: string;
    name?: string;
    life?: number;
    poison?: number;
    commanderDamage?: Record<string, number>;
    battlefield?: CardLike[];
  }>;
  stack?: Array<{ id?: string; cardName?: string; oracleText?: string }>;
  // The item currently awaiting a response (as opposed to `stack`, which holds everything already
  // passed on and waiting below it) — see AppFlow.tsx's pendingActionSourceCard for how oracleText
  // gets attached.
  pendingAction?: { id?: string; cardName?: string; oracleText?: string };
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

function hasInfect(card: CardLike) {
  return hasKeyword(card, "infect");
}

function hasMenace(card: CardLike) {
  return hasKeyword(card, "menace");
}

// Mirrors AppFlow.tsx's canBlock: a menace attacker needs two-or-more blockers assigned at once,
// which this engine's single-blocker-per-attacker model can never offer — so no single candidate
// here is ever a legal block for one. Without this, attack-profitability scoring would think a
// menace attacker "has a potential blocker" and hold back an attack the engine will actually just
// wave through unblocked.
function canLegallyBlock(attacker: CardLike, blocker: CardLike): boolean {
  if (hasMenace(attacker)) return false;
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

// Without this, every opponent an attacker could legally hit scores identically (scoreAttackProfitability
// only judges "is attacking good," not "who"), so the deterministic fallback's stable sort always
// broke the tie in favor of whichever opponent happened to come first in the opponents array — which
// in this engine is consistently the same seat (the human sits at a fixed index), producing a
// systematic "always attacks the human" pattern regardless of actual board state. Comparing each
// candidate target against the *other* opponents (not you) gives a real multiplayer signal instead:
// attack whoever's weakest (easiest to close out) or whoever's biggest (an imminent-winner threat),
// matching gameplay-heuristics.md's "prioritize players with imminent wins" guidance.
function scoreAttackTargetSelection(action: ScorableAction, context: ScoringContext, delta: (amount: number, reason: string) => void) {
  if (action.actionType !== "attack") return;
  const targetId = action.targetIds[0];
  const opponents = context.opponents ?? [];
  if (!targetId || opponents.length < 2) return;

  const targetOpponent = opponents.find((opponent) => opponent.id === targetId) ?? opponents.find((opponent) => (opponent.battlefield ?? []).some((card) => card.id === targetId));
  if (!targetOpponent) return;

  const lifeTotals = opponents.map((opponent) => opponent.life ?? 40);
  const lowestLife = Math.min(...lifeTotals);
  const targetLife = targetOpponent.life ?? 40;
  if (targetLife <= lowestLife && lifeTotals.some((life) => life !== targetLife)) {
    delta(2, `${targetOpponent.name ?? "this opponent"} has the lowest life among opponents (${targetLife})`);
  }

  const boardValues = opponents.map((opponent) => boardValue(opponent.battlefield));
  const highestBoardValue = Math.max(...boardValues);
  const targetBoardValue = boardValue(targetOpponent.battlefield);
  if (targetBoardValue >= highestBoardValue && boardValues.some((value) => value !== targetBoardValue)) {
    delta(2, `${targetOpponent.name ?? "this opponent"} has the most board presence among opponents and looks like the biggest threat`);
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

// Generic-sacrifice activated abilities (parseGenericSacrificeAbilities in activatedAbilities.ts)
// get a flat activate_ability baseline (2) with nothing discounting a bad trade — legalMainPhaseActions
// offers "sacrifice Mind Stone: draw a card" as just another action, and once no cast_spell/play_land
// is affordable it can out-score pass_priority (0), so an agent (or the zero-judgment fallback picker)
// sacrifices a permanent that still has ongoing value the instant nothing else scores higher. The
// common shape this misfires on is a mana rock with BOTH a plain recurring tap ability and a separate
// sacrifice-cost ability (Mind Stone's "{T}: Add {C}." plus "...Sacrifice this artifact: Draw a card.")
// — trading away the recurring ramp for a one-shot card is usually wrong while the hand still has
// options, and only reasonable when hellbent (empty/near-empty hand).
function scoreSacrificeValue(action: ScorableAction, context: ScoringContext, delta: (amount: number, reason: string) => void) {
  if (action.actionType !== "activate_ability") return;
  // Only the "sacrifice THIS permanent" self-sacrifice shape (Mind Stone: "Sacrifice this
  // artifact: Draw a card.") is the one-shot-vs-ongoing-ramp trade-off this heuristic is about.
  // Sacrificing OTHER creatures to power up/transform this permanent (Westvale Abbey: "Sacrifice
  // five creatures: Transform this land...") keeps the recurring mana ability intact and buys a
  // much bigger payoff — a completely different trade (see scoreTransformSacrifice) that this
  // heuristic must not weigh in on just because its label also contains "(sacrifice ...)".
  if (!/\bsacrifice this\b/i.test(action.detail ?? "")) return;
  const source = findCard(context.you?.battlefield, action.cardId);
  if (!source?.oracleText) return;
  const hasRecurringTapAbility = /\{t\}:\s*add\b/i.test(source.oracleText);
  if (!hasRecurringTapAbility) return;
  const handSize = context.you?.hand?.length ?? 0;
  if (handSize <= 1) {
    delta(1, "hellbent — trading a mana rock's ramp for a card is worth it with an empty hand");
    return;
  }
  delta(-3, "sacrificing a mana rock's ongoing ramp for a one-shot payoff while still holding cards");
}

const NUMBER_WORD_TO_INT: Record<string, number> = {
  a: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
};

function wordOrDigitToInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : NUMBER_WORD_TO_INT[value.toLowerCase()];
}

// A multi-creature sacrifice that transforms/upgrades its source into something dramatically
// bigger (Westvale Abbey -> Ormendahl, Profane Prince) is a strong trade as long as it doesn't
// require giving up most of the board to pay for it. With no signal at all, this action just sat
// at the generic activate_ability baseline — indistinguishable from a marginal upkeep tap ability
// — so an agent (or the zero-judgment deterministic fallback) had no reason to prefer it even when
// it was clearly worth doing, and no reason to avoid it when it would empty the board.
function scoreTransformSacrifice(action: ScorableAction, context: ScoringContext, delta: (amount: number, reason: string) => void) {
  if (action.actionType !== "activate_ability" || !/\btransform\b/i.test(action.detail ?? "")) return;
  const countMatch = (action.detail ?? "").match(/\bsacrifice (\w+) creatures\b/i);
  if (!countMatch) return;
  const sacrificeCount = wordOrDigitToInt(countMatch[1]);
  if (!sacrificeCount) return;
  const creatureCount = (context.you?.battlefield ?? []).filter((card) => (card.typeLine ?? "").includes("Creature")).length;
  const remaining = creatureCount - sacrificeCount;
  if (remaining >= 2) {
    delta(4, `transforms into a much bigger threat while keeping ${remaining} creature${remaining === 1 ? "" : "s"} in reserve`);
  } else if (remaining <= 0) {
    delta(-3, "this transform would require sacrificing the entire board");
  }
}

// Mirrors scoreAttackProfitability's trade simulation from the blocker's side. Only "block" and
// "no blocks" actions from a declare_blockers decision carry a meaningful attacker/blocker pair —
// everything else (including block actions outside that purpose) is left at baseline.
function scoreBlockDecision(action: ScorableAction, context: ScoringContext, delta: (amount: number, reason: string) => void) {
  if (context.purpose !== "declare_blockers" || action.actionType !== "block") return;
  const blocker = findCard(context.you?.battlefield, action.cardId);
  const attacker = findCard(opponentBattlefields(context), action.targetIds[0]);
  if (!blocker || !attacker) return;

  const blockerPower = parseNum(blocker.power) ?? 0;
  const blockerToughness = parseNum(blocker.toughness);
  const attackerPower = parseNum(attacker.power) ?? 0;
  const attackerToughness = parseNum(attacker.toughness);

  const blockerDies = blockerToughness !== undefined && !hasIndestructible(blocker) && isLethalTo(attacker, attackerPower, blockerToughness);
  const attackerDies = attackerToughness !== undefined && !hasIndestructible(attacker) && isLethalTo(blocker, blockerPower, attackerToughness);

  if (attackerDies && !blockerDies) {
    delta(3, "block kills the attacker while the blocker survives");
  } else if (attackerDies && blockerDies) {
    delta(1, "block trades with the attacker");
  } else if (!attackerDies && blockerDies) {
    const life = context.you?.life ?? 40;
    if (life <= attackerPower) {
      delta(2, "chump block needed to avoid taking lethal or near-lethal damage");
    } else {
      // Block's baseline score is +2 (BASELINE_SCORE_BY_ACTION_TYPE), so this needs to outweigh
      // that on its own to actually rank below declining to block, not just cancel it out to a tie.
      delta(-3, "blocker dies for no value against a survivable attacker");
    }
  } else {
    delta(1, "block absorbs damage with no losses on either side");
  }

  if (hasDeathtouch(blocker) && !attackerDies) {
    delta(1, "deathtouch blocker threatens the attacker regardless of toughness");
  }
}

const IDEAL_MIN_LANDS = 2;
const IDEAL_MAX_LANDS = 4;
const ACCEPTABLE_MAX_LANDS = 5;
const MIN_TOTAL_MANA_SOURCES = 3;

function isLandLike(card: CardLike): boolean {
  return card.role === "land" || (card.typeLine ?? "").includes("Land");
}

function isRampLike(card: CardLike): boolean {
  return card.role === "ramp";
}

// A slimmed-down version of src/lib/mulliganHeuristics.ts' evaluateOpeningHand, reimplemented
// against this module's CardLike/ScoringContext shape rather than the full VisibleCard/PlayerSeat
// types that function needs — this module crosses the API boundary (it's what the /api/agents/action
// route falls back to when Ollama is unreachable) and only ever sees the JSON snapshot sent over
// the wire. Deliberately narrower: no color-identity coverage check, since producedMana/
// colorIdentity aren't part of that snapshot today. Land/early-play thresholds match the fuller
// heuristic so the two don't disagree on the same hand.
function openingHandScore(hand: CardLike[]): number {
  const lands = hand.filter(isLandLike);
  const ramp = hand.filter(isRampLike);
  const totalSources = lands.length + ramp.length;
  let score = 0;
  if (lands.length < IDEAL_MIN_LANDS) score -= 3;
  else if (lands.length <= IDEAL_MAX_LANDS) score += 2;
  else if (lands.length > ACCEPTABLE_MAX_LANDS) score -= 3;
  if (totalSources < MIN_TOTAL_MANA_SOURCES) score -= 2;
  const earlyPlays = hand.filter((card) => !isLandLike(card) && (card.manaValue ?? 0) >= 1 && (card.manaValue ?? 0) <= 3).length;
  score += earlyPlays > 0 ? 1 : -1;
  return score;
}

// Without this, the deterministic fallback (used whenever Ollama is unreachable) picks whichever
// action has the higher static baseline score, which for keep_hand vs. mulligan is always
// keep_hand — meaning agents always kept a bad opening hand any time the LLM was unavailable.
function scoreMulliganDecision(action: ScorableAction, context: ScoringContext, delta: (amount: number, reason: string) => void) {
  if (context.purpose !== "opening_hand_mulligan") return;
  if (action.actionType !== "keep_hand" && action.actionType !== "mulligan") return;
  const hand = context.you?.hand;
  if (!hand) return;
  const handScore = openingHandScore(hand);
  if (action.actionType === "keep_hand") {
    delta(handScore, `opening hand quality score ${handScore}`);
  } else {
    delta(-handScore, `mulligan value relative to opening hand quality score ${handScore}`);
  }
}

const COMMANDER_DAMAGE_LETHAL = 21;
const COMMANDER_DAMAGE_DANGER_THRESHOLD = 13;
const POISON_LETHAL = 10;
const POISON_DANGER_THRESHOLD = 6;

// "Immediate-win prevention" (the system prompt already asks the LLM to weigh this, but gives it
// no structured signal) — recognizes a specific attacker/target that's already close to one of the
// two alternate loss conditions (21 commander damage from a single source, 10 poison counters) and
// prioritizes answering it over a same-sized but non-threatening permanent. Deliberately narrow:
// only removal and block decisions get this bonus; it doesn't (yet) push your own commander damage
// or poison output on offense, and it doesn't weigh general "who's ahead" multiplayer politics —
// that's still left to the LLM's own judgment, per the system prompt.
function scoreImmediateWinThreats(action: ScorableAction, context: ScoringContext, delta: (amount: number, reason: string) => void) {
  const you = context.you;
  if (!you) return;
  const poison = you.poison ?? 0;

  if (action.actionType === "cast_spell" && action.role === "removal") {
    const target = findCard(opponentBattlefields(context), action.targetIds[0]);
    if (!target) return;
    const existingCommanderDamage = you.commanderDamage?.[target.id] ?? 0;
    if (existingCommanderDamage >= COMMANDER_DAMAGE_DANGER_THRESHOLD) {
      // Large enough to outweigh scoreRemovalTargeting's "minor permanent" penalty (-2) when this
      // source is small relative to other threats on the board — near-lethal commander damage is
      // a bigger deal than raw stats, matching the system prompt's "immediate-win prevention"
      // instruction to override the default higher-scored-action preference.
      delta(5, `removing a source that has already dealt ${existingCommanderDamage} commander damage (21 is lethal)`);
    }
    if (hasInfect(target) && poison >= POISON_DANGER_THRESHOLD) {
      delta(3, `removing an infect creature while already at ${poison} poison counters (10 is lethal)`);
    }
    return;
  }

  if (action.actionType === "block") {
    const attacker = findCard(opponentBattlefields(context), action.targetIds[0]);
    if (!attacker) return;
    const attackerPower = parseNum(attacker.power) ?? 0;
    const existingCommanderDamage = you.commanderDamage?.[attacker.id] ?? 0;
    if (existingCommanderDamage > 0) {
      if (existingCommanderDamage + attackerPower >= COMMANDER_DAMAGE_LETHAL) {
        delta(4, "this attacker would deal lethal (21+) commander damage if left unblocked");
      } else if (existingCommanderDamage >= COMMANDER_DAMAGE_DANGER_THRESHOLD) {
        delta(2, "this attacker is a commander already dealing significant damage to you");
      }
    }
    if (hasInfect(attacker)) {
      if (poison + attackerPower >= POISON_LETHAL) {
        delta(4, "this infect attacker would deal lethal (10+) poison counters if left unblocked");
      } else if (poison >= POISON_DANGER_THRESHOLD) {
        delta(2, `already at ${poison} poison counters, infect damage is dangerous`);
      }
    }
  }
}

const BOARD_WIPE_PATTERNS = [
  /\bdestroy all creatures\b/,
  /\ball creatures? (?:get|gets) -\d+\/-\d+\b/,
  /\beach (?:creature|player'?s? creatures?)\b.{0,40}\b(?:dies|destroyed|sacrifice)\b/,
  /\bdeals? \d+ damage to each creature\b/,
  /\beach player sacrifices\b.{0,20}\bcreatures?\b/
];

function isBoardWipeText(oracleText: string): boolean {
  const text = oracleText.toLowerCase();
  return BOARD_WIPE_PATTERNS.some((pattern) => pattern.test(text));
}

function isCounterspellAction(action: ScorableAction): boolean {
  return /\bcounter target spell\b/i.test(action.detail ?? "");
}

function boardValue(battlefield: CardLike[] | undefined): number {
  return (battlefield ?? []).reduce((total, card) => total + (parseNum(card.power) ?? 0) + (parseNum(card.toughness) ?? 0), 0);
}

// "If I have a counterspell and an opponent casts a board wipe, does it actually benefit me to
// stop it, or would I lose more by letting my own (bigger) board get destroyed along with
// everyone else's?" — the general instant-holding heuristic above has no opinion on THIS
// specific spell; this compares board value before deciding whether answering it is correct.
// Deliberately narrow: only recognizes symmetric board wipes (not one-sided removal, which is
// good to answer or ignore for unrelated reasons already covered elsewhere), and only scores an
// actual counterspell response specially — a different instant being cast in response (e.g.
// value-grabbing removal before the wipe lands) isn't assumed to be an attempt to stop it.
function scoreStackResponse(action: ScorableAction, context: ScoringContext, delta: (amount: number, reason: string) => void) {
  if (context.purpose !== "priority_response") return;
  const pending = context.pendingAction;
  if (!pending?.oracleText || !isBoardWipeText(pending.oracleText)) return;

  const myValue = boardValue(context.you?.battlefield);
  const opponentsValue = (context.opponents ?? []).reduce((total, opponent) => total + boardValue(opponent.battlefield), 0);
  const iAmAhead = myValue > opponentsValue;

  if (action.actionType === "cast_spell" && isCounterspellAction(action)) {
    if (iAmAhead) {
      delta(4, `countering ${pending.cardName ?? "a board wipe"} protects your board lead (you: ${myValue}, opponents combined: ${opponentsValue})`);
    } else {
      delta(-4, `countering ${pending.cardName ?? "a board wipe"} while behind on board (you: ${myValue}, opponents combined: ${opponentsValue}) throws away a reset that would help you`);
    }
  } else if (action.actionType === "pass_priority" && !iAmAhead) {
    delta(2, "letting a board wipe resolve while behind on board resets to a more even position");
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
  scoreAttackTargetSelection(action, context, delta);
  scoreBlockDecision(action, context, delta);
  scoreHoldInstants(action, context, delta);
  scoreUpkeepValue(action, context, delta);
  scoreSacrificeValue(action, context, delta);
  scoreTransformSacrifice(action, context, delta);
  scoreMulliganDecision(action, context, delta);
  scoreImmediateWinThreats(action, context, delta);
  scoreStackResponse(action, context, delta);

  return { score, reasons };
}

export function scoreLegalActions(actions: ScorableAction[], context: ScoringContext): ScoredAction[] {
  return actions
    .map((action) => ({ ...action, ...scoreLegalAction(action, context) }))
    .sort((a, b) => b.score - a.score);
}
