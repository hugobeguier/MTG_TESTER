import { attackEconomics, defenderOf, threatShares } from "./strategy";
import { mustAttackEachCombat } from "./combatRestrictions";
import { canLegallyBlock, hasDeathtouch, hasDoubleStrike, hasFirstStrike, hasFlying, hasIndestructible, hasInfect, hasKeyword, hasLifelink, hasMenace, hasReach, hasTrample, parseNum, simulateDuel } from "./combatSim";

export { simulateDuel };

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
  // The keywords the card actually has right now (printed, granted by other permanents, until-end-of-turn). When present this is the
  // authority; without it, only the card's keyword lines are read, never rules text that merely mentions a keyword.
  keywords?: string[];
  // True for the owner's commander (the deck's engine — losing it costs more than its stats say).
  commander?: boolean;
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
    availableMana?: { total?: number };
    commander?: CardLike;
    // For an opponent only the size of the hand is known.
    hand?: CardLike[] | { count?: number };
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

function findCard(cards: CardLike[] | undefined, id: string | undefined): CardLike | undefined {
  if (!id) return undefined;
  return cards?.find((card) => card.id === id);
}

// The opponent a "targetIds[0]" refers to: a player's own seat id, or a planeswalker on their battlefield.
function defendingOpponent(context: ScoringContext, targetId: string | undefined) {
  if (!targetId) return undefined;
  return (context.opponents ?? []).find((opponent) => opponent.id === targetId || (opponent.battlefield ?? []).some((card) => card.id === targetId));
}

function opponentBattlefields(context: ScoringContext): CardLike[] {
  return (context.opponents ?? []).flatMap((opponent) => opponent.battlefield ?? []);
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

const OPEN_MANA_SWEEPER_TELL_THRESHOLD = 3;
const OPEN_MANA_SWEEPER_TELL_MAX_BOARD = 1;

// "Don't overextend a hand onto the board when an opponent's untapped mana with little to no board
// reads as a held sweeper or counterspell" (gameplay-heuristics.md's own worked example, almost
// word for word) — a local model was observed reasoning purely about board development and never
// engaging with this signal even with the doc spelling it out, so this backs the prompt with a real
// deterministic nudge instead of relying entirely on the model noticing it unprompted, the same
// "score signal plus prompt reinforcement" combination that fixed the equivalent lethal-attack gap
// (see scoreLethalAttack). Deliberately scoped to creature-adding spells — the shape the worked
// example itself uses — and to "meaningful" open mana on a near-empty board: 1-2 untapped mana on an
// early turn is unremarkable, and an opponent who already committed to their own board reads very
// differently than one sitting empty waiting. This is a signal, not proof, so it's a nudge, not a
// hard veto — a real reason to develop anyway (see the core prior on being behind) can still
// outweigh it. Sized to actually flip cast_spell's +3 baseline below pass_priority's 0 rather than
// merely cancel it to a tie: a tie left the model's own (occasionally incoherent) tie-breaking
// reasoning in charge, observed live concluding "this reads as a held sweeper... therefore casting
// is the safer play" — a real score gap gives the prompt's directive something to actually bite on.
function scoreOverextendIntoOpenMana(action: ScorableAction, context: ScoringContext, delta: (amount: number, reason: string) => void) {
  if (action.actionType !== "cast_spell" && action.actionType !== "cast_commander") return;
  if (action.role !== "creature") return;
  const wary = (context.opponents ?? []).find(
    (opponent) =>
      (opponent.availableMana?.total ?? 0) >= OPEN_MANA_SWEEPER_TELL_THRESHOLD && (opponent.battlefield?.length ?? 0) <= OPEN_MANA_SWEEPER_TELL_MAX_BOARD
  );
  if (!wary) return;
  delta(-4, `${wary.name ?? "an opponent"}'s open mana with little to no board reads as a held sweeper or counterspell — overcommitting into it risks a blowout`);
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

// What an attack gains against what it risks (see strategy.ts' attackEconomics): expected damage, weighted by how much that player matters;
// a blocker it could kill; against the attacker dying to the best blocker (priced at its value to the deck, so engines and the commander
// stay home) and the crack-back when it is tapped. Only the defending player's creatures count as blockers.
function scoreAttackProfitability(action: ScorableAction, context: ScoringContext, delta: (amount: number, reason: string) => void) {
  if (action.actionType !== "attack") return;
  const attacker = findCard(context.you?.battlefield, action.cardId);
  if (!attacker || parseNum(attacker.power) === undefined) return;

  // "Attacks each combat if able": the engine forces it, so don't weigh it as a choice.
  if (mustAttackEachCombat({ oracleText: attacker.oracleText ?? "" })) delta(8, "must attack each combat if able");

  const defender = defendingOpponent(context, action.targetIds[0]);
  const share = defender?.id ? threatShares(context).get(defender.id)?.share ?? 0 : 0;
  const economics = attackEconomics(attacker, defender, context, share);
  const defenderCreatures = defender ? defender.battlefield ?? [] : opponentBattlefields(context);
  const potentialBlockers = defenderCreatures.filter((card) => !card.tapped && parseNum(card.power) !== undefined && canLegallyBlock(attacker, card, defender?.battlefield));

  if (potentialBlockers.length === 0) {
    delta(3, defender ? `${defender.name ?? "the defender"} has no untapped creature that can block this attacker` : "no untapped, legally-able blockers across opponents");
    if (economics.risk > 0.5) delta(-Math.min(5, Math.round(economics.risk)), `but tapping it has a cost: ${economics.reasons.filter((reason) => /crack-back/.test(reason)).join("; ") || "it leaves the defence thin"}`);
    return;
  }
  const net = Math.max(-6, Math.min(5, Math.round(economics.net * 0.7)));
  delta(net, `attack economics: gain ~${economics.gain.toFixed(1)} vs risk ~${economics.risk.toFixed(1)} — ${economics.reasons.join("; ")}`);
}

// Without this, every opponent an attacker could legally hit scores identically (scoreAttackProfitability
// only judges "is attacking good," not "who"), so the deterministic fallback's stable sort always
// broke the tie in favor of whichever opponent happened to come first in the opponents array — which
// in this engine is consistently the same seat (the human sits at a fixed index), producing a
// systematic "always attacks the human" pattern regardless of actual board state. Comparing each
// candidate target against the *other* opponents (not you) gives a real multiplayer signal instead:
// attack whoever's weakest (easiest to close out) or whoever's biggest (an imminent-winner threat),
// matching gameplay-heuristics.md's "prioritize players with imminent wins" guidance.
// "Would this attack, if it connects, take the target player's life to 0 or below?" — a strictly
// bigger deal than merely being the lowest-life opponent (scoreAttackTargetSelection just below):
// that only signals "an easier kill eventually," this signals "ends their game outright, this turn."
// Without a DETERMINISTIC signal for this, nothing distinguished a genuinely lethal attack from a
// merely-good one, and a local model doing broader multiplayer-politics reasoning ("who's the
// biggest threat") was observed skipping a free kill entirely — it never even checked the simple
// power-vs-life arithmetic before reasoning about board state. Scoped to a direct attack on a player
// (targetIds resolves straight to an opponent's seat id) — an attack on a planeswalker resolves
// through the same targetIds shape but deals its damage to loyalty, not life, so it's deliberately
// excluded here rather than mistaken for lethal. Worded as "if it connects" rather than asserting
// certainty: a defender can still block during declare_blockers, which scoreAttackProfitability
// separately scores — the two signals compound correctly (a lethal attack with no legal blockers
// scores highest of all, exactly as it should).
function scoreLethalAttack(action: ScorableAction, context: ScoringContext, delta: (amount: number, reason: string) => void) {
  if (action.actionType !== "attack") return;
  const targetId = action.targetIds[0];
  const targetOpponent = (context.opponents ?? []).find((opponent) => opponent.id === targetId);
  if (!targetOpponent) return;
  const attacker = findCard(context.you?.battlefield, action.cardId);
  const attackerPower = parseNum(attacker?.power);
  const targetLife = targetOpponent.life;
  if (attackerPower === undefined || attackerPower <= 0 || targetLife === undefined || targetLife <= 0) return;
  if (attackerPower >= targetLife) {
    delta(6, `would be lethal to ${targetOpponent.name ?? "this opponent"} if it connects (${attackerPower} damage vs ${targetLife} life)`);
  }
}

function scoreAttackTargetSelection(action: ScorableAction, context: ScoringContext, delta: (amount: number, reason: string) => void) {
  if (action.actionType !== "attack") return;
  const targetId = action.targetIds[0];
  const opponents = context.opponents ?? [];
  if (!targetId || opponents.length < 2) return;

  const targetOpponent = defenderOf(context, targetId);
  if (!targetOpponent) return;
  const name = targetOpponent.name ?? "this opponent";

  const lifeTotals = opponents.map((opponent) => opponent.life ?? 40);
  const lowestLife = Math.min(...lifeTotals);
  const targetLife = targetOpponent.life ?? 40;
  if (targetLife <= lowestLife && lifeTotals.some((life) => life !== targetLife)) {
    delta(2, `${name} has the lowest life among opponents (${targetLife})`);
  }

  // Who is the biggest threat: their damage against my life, commander pressure, engine strength, reserves.
  const shares = threatShares(context);
  const mine = targetOpponent.id ? shares.get(targetOpponent.id) : undefined;
  const REAL_THREAT = 4; // below this an opponent's board is too small for "biggest threat" to mean anything
  const strongestOther = Math.max(0, ...opponents.filter((opponent) => opponent.id !== targetOpponent.id).map((opponent) => (opponent.id ? shares.get(opponent.id)?.threat.score ?? 0 : 0)));
  if (mine) {
    const fair = 1 / opponents.length;
    if (mine.share >= fair * 1.4 && mine.threat.score >= REAL_THREAT) {
      delta(2, `${name} is the biggest threat (${Math.round(mine.share * 100)}% of the table's threat${mine.threat.reasons.length ? ": " + mine.threat.reasons.join(", ") : ""})`);
    } else if (mine.share <= fair * 0.6 && strongestOther >= REAL_THREAT) {
      delta(-1, `${name} is a minor threat compared with the others (${Math.round(mine.share * 100)}%)`);
    }
  }

  // Within reach: this player could be dropped (or nearly) by what I can send.
  const myPower = (context.you?.battlefield ?? []).filter((card) => !card.tapped).reduce((total, card) => total + Math.max(0, parseNum(card.power) ?? 0), 0);
  if (myPower > 0 && targetLife <= myPower * 1.5) {
    delta(1, `${name} is within reach of my ${myPower} power (at ${targetLife} life)`);
  }
}

// Plays that grow the deck's engine are worth more than their stats suggest — but only while they have time to pay off, and an anthem
// only matters with creatures to boost. Kept small so it balances with (never overrides) the attack and survival signals.
function scoreDevelopment(action: ScorableAction, context: ScoringContext, delta: (amount: number, reason: string) => void) {
  if (action.actionType !== "cast_spell" && action.actionType !== "cast_commander") return;
  const text = (action.detail ?? "").replace(/\([^)]*\)/g, "").toLowerCase();
  const turn = context.turn ?? 1;
  const myCreatures = (context.you?.battlefield ?? []).filter((card) => (card.typeLine ?? "").includes("Creature")).length;
  const handSize = context.you?.hand?.length ?? 0;
  const permanent = /\b(?:creature|artifact|enchantment|planeswalker)\b/.test(text) && !/\b(?:instant|sorcery)\b/.test(text);
  if (action.actionType === "cast_commander" && turn <= 8) delta(2, "casting the commander gets the deck's engine online");
  if (permanent && /\b(?:other )?[a-z ]*creatures? you control (?:get|have)\b|\bother [a-z]+s? you control get\b/.test(text) && myCreatures >= 2) {
    delta(Math.min(3, Math.floor(myCreatures / 2) + 1), `an anthem now boosts ${myCreatures} creatures`);
  }
  if (permanent && turn <= 6 && /\bwhenever you (?:cast|draw|gain|attack)|\bat the beginning of your (?:upkeep|end step)\b/.test(text)) {
    delta(1, "an engine pays off the longer it is in play");
  }
  if (/\bdraw (?:two|three|\d+) cards\b/.test(text) && handSize <= 2) delta(1, "refuels a nearly empty hand");
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

// A protection effect's (role "protection" — see deckParser.ts's isProtectionEffectText) whole
// value is answering a specific threat, so casting it during your OWN main phase — with nothing on
// the stack to actually protect against, unlike scoreHoldInstants' priority_response scope, which
// never applies to a proactive main-phase cast — spends a reactive resource for nothing. Scoped to
// a genuine instant: a sorcery-speed protection effect has no "hold it" option at all, so casting it
// during the only phase it can ever be cast isn't a waste. Reported live as Tamiyo's Safekeeping
// cast on a land and a mana artifact during a quiet main phase instead of held for a real removal
// spell aimed at a creature.
function scoreProactiveProtectionCast(action: ScorableAction, context: ScoringContext, delta: (amount: number, reason: string) => void) {
  if (action.actionType !== "cast_spell" || action.role !== "protection") return;
  if (context.purpose !== "main_phase") return;
  if (!/\binstant\b/i.test(action.detail ?? "")) return;
  delta(-3, "casting a reactive protection effect during your own main phase instead of holding it for a real threat");
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

  const attackerPower = parseNum(attacker.power) ?? 0;
  const duel = simulateDuel(attacker, blocker);
  const blockerDies = duel.blockerDies;
  const attackerDies = duel.attackerDies;
  if (hasDeathtouch(attacker) && blockerDies) delta(-1, "the attacker has deathtouch: any damage it deals kills the blocker, whatever its toughness");
  if (duel.firstStrikeKillsBlocker && !hasFirstStrike(blocker) && !hasDoubleStrike(blocker)) delta(-1, "first strike kills the blocker before it can deal damage back");

  if (attackerDies && !blockerDies) {
    delta(3, "block kills the attacker while the blocker survives");
  } else if (attackerDies && blockerDies) {
    // A trade is only good if what you lose is worth no more than what you take: a 6/6 into a 1/1 deathtouch is a bad trade.
    const worth = (card: CardLike) => (card.manaValue ?? 0) + (parseNum(card.power) ?? 0) + (parseNum(card.toughness) ?? 0);
    const life = context.you?.life ?? 40;
    if (worth(blocker) > worth(attacker) + 3 && life > attackerPower * 2) {
      delta(-3, "block trades a much more valuable creature for a cheap one");
    } else {
      delta(1, "block trades with the attacker");
    }
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

  if (hasDeathtouch(blocker) && !attackerDies && duel.blockerDealt === 0) {
    delta(0, "the blocker deals no damage in this fight, so its deathtouch never applies");
  }
  if (hasLifelink(blocker) && duel.blockerDealt > 0) delta(1, "lifelink blocker gains life from the damage it deals");
  if (hasIndestructible(blocker) && !blockerDies) delta(1, "indestructible blocker takes the hit for free");
}

const IDEAL_MAX_LANDS = 4;
const MIN_TOTAL_MANA_SOURCES = 3;

function isLandLike(card: CardLike): boolean {
  return card.role === "land" || (card.typeLine ?? "").includes("Land");
}

function isRampLike(card: CardLike): boolean {
  return card.role === "ramp";
}

function isDrawLike(card: CardLike): boolean {
  return card.role === "draw";
}

// Covers both removal and counterspells — see the matching comment in mulliganHeuristics.ts.
function isInteractionLike(card: CardLike): boolean {
  return card.role === "removal";
}

const CURVE_TURNS = [3, 4] as const;
const CURVE_BOTH_TURNS_BONUS = 2;
const CURVE_ONE_TURN_BONUS = 1;
const CURVE_NO_PLAYS_PENALTY = -2;
const MAX_DRAW_BONUS = 2;
const MAX_INTERACTION_BONUS = 1;

// Mirrors mulliganHeuristics.ts' projectedManaOnTurn — see its comment for the assumptions.
function projectedManaOnTurn(landCount: number, ramp: CardLike[], turn: number): number {
  const landsInPlay = Math.min(landCount, turn);
  const onlineRamp = ramp.filter((card) => (card.manaValue ?? 0) <= turn - 1).length;
  return landsInPlay + onlineRamp;
}

function hasPlayOnTurn(hand: CardLike[], projectedMana: number): boolean {
  return hand.some((card) => !isLandLike(card) && (card.manaValue ?? 0) >= 1 && (card.manaValue ?? 0) <= projectedMana);
}

// A slimmed-down version of src/lib/mulliganHeuristics.ts' evaluateOpeningHand, reimplemented
// against this module's CardLike/ScoringContext shape rather than the full VisibleCard/PlayerSeat
// types that function needs — this module crosses the API boundary (it's what the /api/agents/action
// route falls back to when Ollama is unreachable) and only ever sees the JSON snapshot sent over
// the wire. Deliberately narrower: no color-identity coverage check, since producedMana/
// colorIdentity aren't part of that snapshot today. Land/curve/draw/interaction weights match the
// fuller heuristic so the two don't disagree on the same hand.
function openingHandScore(hand: CardLike[]): number {
  const lands = hand.filter(isLandLike);
  const ramp = hand.filter(isRampLike);
  const totalSources = lands.length + ramp.length;
  let score = 0;
  // Mirrors mulliganHeuristics.ts' land bands: 0/7 and 1/6 lands are each treated as steeply worse
  // than the merely-risky/flood-prone middle ground, since standard mulligan advice calls those
  // counts an almost-automatic mulligan regardless of what else is in the hand.
  if (lands.length === 0 || lands.length === 7) score -= 6;
  else if (lands.length === 1 || lands.length === 6) score -= 4;
  else if (lands.length <= IDEAL_MAX_LANDS) score += 2;
  if (totalSources < MIN_TOTAL_MANA_SOURCES) score -= 2;

  const turnsWithPlays = CURVE_TURNS.filter((turn) => hasPlayOnTurn(hand, projectedManaOnTurn(lands.length, ramp, turn)));
  if (turnsWithPlays.length === CURVE_TURNS.length) score += CURVE_BOTH_TURNS_BONUS;
  else if (turnsWithPlays.length > 0) score += CURVE_ONE_TURN_BONUS;
  else score += CURVE_NO_PLAYS_PENALTY;

  const drawCount = hand.filter(isDrawLike).length;
  score += Math.min(drawCount, MAX_DRAW_BONUS);

  const interactionCount = hand.filter(isInteractionLike).length;
  score += Math.min(interactionCount, MAX_INTERACTION_BONUS);

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

export function isBoardWipeText(oracleText: string): boolean {
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
  scoreOverextendIntoOpenMana(action, context, delta);
  scoreRemovalTargeting(action, context, delta);
  scoreAttackProfitability(action, context, delta);
  scoreLethalAttack(action, context, delta);
  scoreAttackTargetSelection(action, context, delta);
  scoreBlockDecision(action, context, delta);
  scoreHoldInstants(action, context, delta);
  scoreProactiveProtectionCast(action, context, delta);
  scoreUpkeepValue(action, context, delta);
  scoreSacrificeValue(action, context, delta);
  scoreTransformSacrifice(action, context, delta);
  scoreMulliganDecision(action, context, delta);
  scoreImmediateWinThreats(action, context, delta);
  scoreStackResponse(action, context, delta);
  scoreDevelopment(action, context, delta);

  return { score, reasons };
}

export function scoreLegalActions(actions: ScorableAction[], context: ScoringContext): ScoredAction[] {
  return actions
    .map((action) => ({ ...action, ...scoreLegalAction(action, context) }))
    .sort((a, b) => b.score - a.score);
}

export interface FallbackAgentAction {
  actionType: ScorableActionType;
  legalActionId: string;
  targetIds: string[];
  cardId?: string;
  reason: string;
  fallbackAction: "pass_priority" | "end_turn";
}

// Moved out of app/api/agents/action/route.ts (was a local function there) so the deterministic
// "what do we do when there's no LLM decision to trust" rule lives in exactly one place — both the
// live route (when Ollama times out/returns garbage) and the headless self-play harness's
// heuristicBrain (src/lib/selfplay/brains.ts, which has no LLM at all in this milestone) import it
// from here rather than keeping two copies that could silently drift apart.
export function fallbackAction(scoredActions: ScoredAction[], reason: string): FallbackAgentAction {
  const preferred = scoredActions[0];

  return {
    actionType: preferred.actionType,
    legalActionId: preferred.id,
    targetIds: preferred.targetIds,
    cardId: preferred.cardId,
    reason,
    fallbackAction: preferred.actionType === "end_turn" ? "end_turn" : "pass_priority"
  };
}
