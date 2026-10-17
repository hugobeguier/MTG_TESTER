// Cheap one-step look-ahead and opponent-interference awareness for agent decisions. Everything here feeds SCORE ADJUSTMENTS
// (actionScoring.scoreLegalAction) — it never forbids an action. Casual-Commander level: a few arithmetic checks, no search.
//   (a) worst-case blocks for an attack, what the board looks like after a board wipe, what a removal spell leaves behind;
//   (b) estimateOpponentInterferenceRisk: how likely an opponent can counter / protect against what I am about to cast, and the
//       timing modifiers (bait, wait a turn, cast into a tapped-out table) built on it.

import type { CardLike, ScorableAction, ScoringContext } from "./actionScoring";
import { isBoardWipeText } from "./actionScoring";
import { simulateDuel, hasDeathtouch, hasFirstStrike, hasDoubleStrike, hasIndestructible, parseNum } from "./combatSim";
import { creatureValue } from "./strategy";
import { removalGuard } from "./playGuards";

type Opponent = NonNullable<ScoringContext["opponents"]>[number];
type Delta = (amount: number, reason: string) => void;

function isCreature(card: CardLike): boolean {
  return (card.typeLine ?? "").includes("Creature") || (parseNum(card.power) !== undefined && parseNum(card.toughness) !== undefined);
}

function cleanText(text: string | undefined): string {
  return (text ?? "").replace(/\([^)]*\)/g, "").toLowerCase();
}

// ---------------------------------------------------------------------------------------------------------------------------------
// (a) look-ahead
// ---------------------------------------------------------------------------------------------------------------------------------

export interface BlockOutcome {
  attackerDies: boolean;
  // True when no single blocker kills it but two blockers together do.
  onlyByGangBlock: boolean;
  killsABlocker: boolean;
}

// The worst the defender can do to this attacker with the given untapped blockers: any single blocker (full keyword rules via
// simulateDuel), or a double block whose combined damage is lethal (counting a first-strike attacker killing the weaker blocker first).
export function worstCaseBlock(attacker: CardLike, blockers: CardLike[]): BlockOutcome {
  const duels = blockers.map((blocker) => ({ blocker, duel: simulateDuel(attacker, blocker) }));
  const killsABlocker = duels.some((entry) => entry.duel.blockerDies);
  if (duels.some((entry) => entry.duel.attackerDies)) return { attackerDies: true, onlyByGangBlock: false, killsABlocker };
  if (hasIndestructible(attacker)) return { attackerDies: false, onlyByGangBlock: false, killsABlocker };
  const toughness = parseNum(attacker.toughness) ?? Number.POSITIVE_INFINITY;
  const aPower = Math.max(0, parseNum(attacker.power) ?? 0);
  const strikesFirst = hasFirstStrike(attacker) || hasDoubleStrike(attacker);
  for (let i = 0; i < blockers.length; i += 1) {
    for (let j = i + 1; j < blockers.length; j += 1) {
      const pair = [blockers[i], blockers[j]];
      // A first-strike attacker removes one blocker before it hits back if its power covers that blocker's toughness.
      const survivors = strikesFirst ? pair.filter((b) => !hasDeathtouch(attacker) && aPower < (parseNum(b.toughness) ?? Number.POSITIVE_INFINITY)) : pair;
      const dealt = survivors.reduce((sum, b) => sum + Math.max(0, parseNum(b.power) ?? 0), 0);
      if (survivors.some((b) => hasDeathtouch(b)) || dealt >= toughness) return { attackerDies: true, onlyByGangBlock: true, killsABlocker };
    }
  }
  return { attackerDies: false, onlyByGangBlock: false, killsABlocker };
}

export function scoreGangBlockRisk(action: ScorableAction, context: ScoringContext, delta: Delta) {
  if (action.actionType !== "attack") return;
  const attacker = (context.you?.battlefield ?? []).find((card) => card.id === action.cardId);
  if (!attacker || parseNum(attacker.power) === undefined) return;
  const defender = (context.opponents ?? []).find((o) => o.id === action.targetIds[0] || (o.battlefield ?? []).some((c) => c.id === action.targetIds[0]));
  const blockers = (defender?.battlefield ?? []).filter((card) => isCreature(card) && !card.tapped);
  if (blockers.length < 2) return;
  const outcome = worstCaseBlock(attacker, blockers);
  if (outcome.onlyByGangBlock) {
    delta(creatureValue(attacker) >= 4 ? -3 : -1.5, "worst case: two untapped creatures can double-block and kill this attacker");
  }
}

// Value of the creatures a sweeper would remove from one side (indestructible ones survive "destroy" wipes).
function creaturesLost(cards: CardLike[] | undefined, text: string): number {
  return (cards ?? [])
    .filter((card) => isCreature(card) && !(hasIndestructible(card) && /\bdestroy\b/.test(text)))
    .reduce((sum, card) => sum + creatureValue(card), 0);
}

// Casting my own board wipe: am I ahead after it? Positive when it costs the table more than it costs me.
export function scoreOwnBoardWipe(action: ScorableAction, context: ScoringContext, delta: Delta) {
  if (action.actionType !== "cast_spell") return;
  const text = cleanText((action.detail ?? "").replace(/Payable with[\s\S]*$/i, ""));
  if (!isBoardWipeText(text) || /\bcounter target\b/.test(text)) return;
  const mine = creaturesLost(context.you?.battlefield, text);
  const theirs = (context.opponents ?? []).reduce((sum, opponent) => sum + creaturesLost(opponent.battlefield, text), 0);
  const net = theirs - mine;
  if (net >= 4) delta(3, `after the wipe the table loses ~${theirs.toFixed(0)} of creature value against my ~${mine.toFixed(0)}`);
  else if (net <= -2) delta(-4, `a wipe now costs me more (~${mine.toFixed(0)}) than the table (~${theirs.toFixed(0)}) — I would be behind afterwards`);
}

// What the opposing board looks like once the removal's best target is gone: defusing a lethal swing is worth a little extra.
export function scoreRemovalAftermath(action: ScorableAction, context: ScoringContext, delta: Delta) {
  const assessment = removalGuard(action, context);
  const target = assessment.bestTarget;
  if (!target || !assessment.allowed) return;
  const owner = (context.opponents ?? []).find((o) => (o.battlefield ?? []).some((c) => c.id === target.id));
  if (!owner) return;
  const myLife = Math.max(1, context.you?.life ?? 40);
  const power = (cards: CardLike[]) => cards.filter(isCreature).reduce((s, c) => s + Math.max(0, parseNum(c.power) ?? 0), 0);
  const before = power(owner.battlefield ?? []);
  const after = before - Math.max(0, parseNum(target.power) ?? 0);
  if (before >= myLife && after < myLife) delta(3, `removing ${target.name ?? "it"} takes ${owner.name ?? "that opponent"}'s board below lethal against my ${myLife} life`);
  else if (before >= myLife * 0.6 && after < myLife * 0.4) delta(1, `removing ${target.name ?? "it"} defuses most of ${owner.name ?? "that opponent"}'s offense`);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// (b) opponent interference risk
// ---------------------------------------------------------------------------------------------------------------------------------

const COUNTER_TELL_RE = /\bcounter target (?:[a-z-]+ )*spell\b|\bcounter (?:it|that spell) unless\b/;
const PROTECTION_TELL_RE = /\b(?:gains?|have|has) (?:hexproof|indestructible|protection from)\b|\bphases? out\b/;

// What a card in a public zone (graveyard / exile) tells about the deck: it was a counterspell or a protection trick.
export function classifyTell(oracleText: string | undefined, typeLine?: string): "counter" | "protection" | undefined {
  const text = cleanText(oracleText);
  if (!text || (typeLine && !/instant|sorcery/i.test(typeLine) && !/flash/.test(text))) return undefined;
  if (COUNTER_TELL_RE.test(text)) return "counter";
  if (PROTECTION_TELL_RE.test(text) && /\byou control\b/.test(text)) return "protection";
  return undefined;
}

export interface InterferenceRisk {
  counter: number;
  protection: number;
  // Chance that SOMETHING stops or blunts what I cast (1 - no counter and no protection).
  overall: number;
  reasons: string[];
}

function handCount(opponent: Opponent): number {
  return Array.isArray(opponent.hand) ? opponent.hand.length : opponent.hand?.count ?? 0;
}

// How likely this opponent can counter a spell of mine / protect their stuff from my removal or wipe RIGHT NOW. Inputs are all things a
// human can read off the table: their commander's colors, the untapped mana they hold (and in which colors), the size of their hand and
// whether counterspells / protection tricks have already shown up in their graveyard or exile this game. Probabilities are coarse on
// purpose — they only rank "worth waiting / baiting" against "just cast it".
export function estimateOpponentInterferenceRisk(opponent: Opponent): InterferenceRisk {
  const reasons: string[] = [];
  const hand = handCount(opponent);
  const open = opponent.availableMana?.total ?? 0;
  const byColor = opponent.availableMana?.byColor ?? {};
  const identity = opponent.colorIdentity ?? [];
  const tells = opponent.shownTells ?? { counterspells: 0, protection: 0 };
  if (hand === 0) return { counter: 0, protection: 0, overall: 0, reasons: ["no cards in hand"] };

  const handFactor = 0.5 + 0.5 * Math.min(1, hand / 3);
  const blue = identity.includes("U") || tells.counterspells > 0;
  let counter = 0;
  if (blue) {
    const blueOpen = (byColor.U ?? 0) >= 1 && open >= 2;
    // A free counter (Force of Will, Pact of Negation) needs no mana at all, but is rare.
    const free = 0.04;
    if (blueOpen) {
      counter = 0.5 + Math.min(0.4, tells.counterspells * 0.25);
      reasons.push(`blue with ${open} open mana (${byColor.U ?? 0} blue) and ${hand} cards in hand${tells.counterspells > 0 ? `, already showed ${tells.counterspells} counterspell(s)` : ""}`);
    } else {
      counter = free;
      reasons.push(open === 0 ? "blue but tapped out" : "blue but without the open blue mana for a counterspell");
    }
    counter = Math.min(0.95, counter * (counter > free ? handFactor : 1));
  }

  let protection = 0;
  if (open >= 1) {
    const base = identity.includes("W") || identity.includes("G") ? 0.2 : identity.length > 0 ? 0.1 : 0.05;
    protection = Math.min(0.9, (base + Math.min(0.4, tells.protection * 0.3)) * handFactor);
    if (tells.protection > 0) reasons.push(`already showed ${tells.protection} protection trick(s)`);
  }
  const overall = 1 - (1 - counter) * (1 - protection);
  return { counter, protection, overall, reasons };
}

// A spell worth protecting from a counter: expensive, the commander, or a sweeper.
function keySpellValue(action: ScorableAction, context: ScoringContext): number {
  if (action.actionType === "cast_commander") return 8;
  const hand = context.you?.hand ?? [];
  const mv = hand.find((card) => card.id === action.cardId)?.manaValue ?? 0;
  const text = cleanText(action.detail);
  return mv + (isBoardWipeText(text) ? 2 : 0);
}

const KEY_SPELL_VALUE = 5;
const HIGH_COUNTER_RISK = 0.5;

// Timing around counterspells and protection. Only my own main phase (a response to the stack is a different decision).
// Waiting is capped by construction: the penalty applies on at most two of every three turns, so a key spell is never held for
// longer than two turns, and cheap spells (value < 5) are never held at all.
export function scoreInterferenceTiming(action: ScorableAction, context: ScoringContext, delta: Delta) {
  if (context.purpose !== "main_phase") return;
  if (action.actionType !== "cast_spell" && action.actionType !== "cast_commander") return;
  const opponents = context.opponents ?? [];
  if (opponents.length === 0) return;
  const risks = opponents.map((opponent) => ({ opponent, risk: estimateOpponentInterferenceRisk(opponent) }));
  const worstCounter = risks.reduce((max, entry) => (entry.risk.counter > max.risk.counter ? entry : max), risks[0]);
  const turn = context.turn ?? 1;
  const mayWait = turn % 3 !== 0;
  const value = keySpellValue(action, context);
  const mana = context.you?.availableMana?.total ?? 0;
  const hand = context.you?.hand ?? [];

  if (value >= KEY_SPELL_VALUE) {
    const counterCapable = opponents.filter((o) => (o.colorIdentity ?? []).includes("U") || (o.shownTells?.counterspells ?? 0) > 0);
    if (counterCapable.length > 0 && counterCapable.every((o) => estimateOpponentInterferenceRisk(o).counter <= 0.05)) {
      delta(2, "every counterspell-capable opponent is tapped out or lacks blue mana — a safe window for this spell");
    } else if (worstCounter.risk.counter >= HIGH_COUNTER_RISK && mayWait) {
      const bait = hand.some((card) => card.id !== action.cardId && !(card.typeLine ?? "").includes("Land") && (card.manaValue ?? 0) >= 2 && (card.manaValue ?? 0) < value && (card.manaValue ?? 0) <= mana);
      delta(bait ? -3 : -1.5, `${worstCounter.opponent.name ?? "an opponent"} likely holds a counter (${worstCounter.risk.reasons[0] ?? "open blue mana"}) — ${bait ? "bait with a cheaper spell first" : "wait for a window"}`);
    }
    // Wraths and removal that the opponent with the most to protect can blank.
    const protector = risks.reduce((max, entry) => (entry.risk.protection > max.risk.protection ? entry : max), risks[0]);
    if (isBoardWipeText(cleanText(action.detail)) && protector.risk.protection >= 0.4 && mayWait) {
      delta(-2, `${protector.opponent.name ?? "an opponent"} has open mana and protection tells — a wipe may be blanked`);
    }
    return;
  }

  // The bait itself: a mid-cost spell cast first while a key spell waits behind a probable counter.
  if (worstCounter.risk.counter >= HIGH_COUNTER_RISK && value >= 2) {
    const keyInHand = hand.some((card) => card.id !== action.cardId && !(card.typeLine ?? "").includes("Land") && (card.manaValue ?? 0) >= KEY_SPELL_VALUE && (card.manaValue ?? 0) <= mana);
    if (keyInHand) delta(1.5, "cast this first as bait into the likely counterspell before the bigger spell");
  }
}
