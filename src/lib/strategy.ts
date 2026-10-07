// Strategic evaluation for the AI: how much a creature is worth to its owner's plan, how dangerous each opponent is, and what an attack
// really gains and risks. All numbers are in rough "mana worth of stuff" units so a gain and a risk can be set against each other.

import type { CardLike, ScoringContext } from "./actionScoring";
import { canLegallyBlock, hasDeathtouch, hasDoubleStrike, hasFirstStrike, hasFlying, hasIndestructible, hasKeyword, hasLifelink, hasMenace, hasTrample, parseNum, simulateDuel } from "./combatSim";

type Opponent = NonNullable<ScoringContext["opponents"]>[number];

const STARTING_LIFE = 40;

function creatures(cards: CardLike[] | undefined): CardLike[] {
  return (cards ?? []).filter((card) => (card.typeLine ?? "").includes("Creature") || (parseNum(card.power) !== undefined && parseNum(card.toughness) !== undefined));
}

function textOf(card: CardLike): string {
  return (card.oracleText ?? "").replace(/\([^)]*\)/g, "").toLowerCase();
}

// What losing this creature costs its owner. Raw stats and cost set the floor; keywords that win fights, and abilities that make the deck
// work (card draw, tokens, anthems, mana, a commander) raise it — those are the pieces worth keeping out of a bad attack.
export function creatureValue(card: CardLike): number {
  const power = Math.max(0, parseNum(card.power) ?? 0);
  const toughness = Math.max(0, parseNum(card.toughness) ?? 0);
  let value = Math.max(card.manaValue ?? 0, (power + toughness) / 2);
  if (hasFlying(card)) value += 1.5;
  if (hasDeathtouch(card)) value += 2;
  if (hasDoubleStrike(card)) value += 2;
  else if (hasFirstStrike(card)) value += 1;
  if (hasLifelink(card)) value += 1;
  if (hasIndestructible(card)) value += 2;
  if (hasKeyword(card, "hexproof")) value += 1;
  if (hasMenace(card)) value += 0.8;
  if (hasTrample(card)) value += 0.7;
  const text = textOf(card);
  if (/\bdraw (?:a|one|two|three|\d+) cards?\b/.test(text)) value += 1.5;
  if (/\bcreate\b[^.]*\btokens?\b/.test(text)) value += 1.2;
  if (/\b(?:other )?[a-z ]*creatures? you control (?:get|have)\b|\bother [a-z]+s? you control get\b/.test(text)) value += 3;
  if (/\{t\}: add\b/.test(text)) value += 1.5;
  if (/\bwhenever\b/.test(text)) value += 0.8;
  if (card.commander) value += 4;
  return value;
}

export interface Threat {
  score: number;
  // Damage this opponent could put on the table against the deciding seat next turn.
  offense: number;
  reasons: string[];
}

// How dangerous an opponent is to the deciding seat: what their board can do to my life, whether their commander is closing in on 21 damage,
// the strength of their engine, and their reserves. Larger is more dangerous.
export function threatAssessment(opponent: Opponent, context: ScoringContext): Threat {
  const reasons: string[] = [];
  const myLife = Math.max(1, context.you?.life ?? STARTING_LIFE);
  const board = creatures(opponent.battlefield);
  const offense = board.reduce((total, card) => {
    const power = Math.max(0, parseNum(card.power) ?? 0);
    const evasive = hasFlying(card) || hasTrample(card) || hasMenace(card);
    return total + power * (evasive ? 1.3 : 1) * (hasDoubleStrike(card) ? 2 : 1);
  }, 0);
  let score = (offense / myLife) * 10;
  if (offense > 0) reasons.push(`${Math.round(offense)} damage on board against my ${myLife} life`);

  const engine = board.reduce((total, card) => total + creatureValue(card), 0) * 0.25;
  score += engine;
  const commanderOnBoard = (opponent.battlefield ?? []).some((card) => card.commander) || Boolean(opponent.commander);
  if (commanderOnBoard) {
    score += 2;
    reasons.push("their commander is in play");
  }
  const dealt = Object.values(context.you?.commanderDamage ?? {}).reduce((max, value) => Math.max(max, value), 0);
  if (dealt >= 10 && commanderOnBoard) {
    score += (dealt / 21) * 6;
    reasons.push(`commander damage on me is already ${dealt}/21`);
  }
  const hand = Array.isArray(opponent.hand) ? opponent.hand.length : opponent.hand?.count ?? 0;
  score += hand * 0.4;
  score += (opponent.availableMana?.total ?? 0) * 0.2;
  if ((opponent.poison ?? 0) >= 5) {
    score += opponent.poison! * 0.4;
    reasons.push(`${opponent.poison} poison counters`);
  }
  return { score, offense, reasons };
}

export function defenderOf(context: ScoringContext, targetId: string | undefined): Opponent | undefined {
  if (!targetId) return undefined;
  return (context.opponents ?? []).find((opponent) => opponent.id === targetId || (opponent.battlefield ?? []).some((card) => card.id === targetId));
}

export interface AttackEconomics {
  gain: number;
  risk: number;
  net: number;
  reasons: string[];
}

// The attack as a trade: what it is worth if things go right against what it can cost. Gains: expected damage (worth more against a
// threat or a low-life player), a blocker it would kill, attack triggers. Risks: the attacker dying to the best available blocker (priced
// at its full strategic value, so engines and the commander are protected), and the crack-back — what the defence loses by this
// creature being tapped when the opponents swing back.
export function attackEconomics(attacker: CardLike, defender: Opponent | undefined, context: ScoringContext, threatShare = 0): AttackEconomics {
  const reasons: string[] = [];
  const power = Math.max(0, parseNum(attacker.power) ?? 0);
  const myCreatures = creatures(context.you?.battlefield).filter((card) => !card.tapped);
  const attackersAvailable = Math.max(1, myCreatures.length);
  // With no identified defender, assume any opponent's creatures could be in the way.
  const defenderBoard = defender ? defender.battlefield : (context.opponents ?? []).flatMap((opponent) => opponent.battlefield ?? []);
  const blockers = creatures(defenderBoard).filter((card) => !card.tapped && canLegallyBlock(attacker, card, defenderBoard));
  const pBlocked = blockers.length === 0 ? 0 : Math.min(0.95, blockers.length / attackersAvailable);

  const duels = blockers.map((blocker) => ({ blocker, duel: simulateDuel(attacker, blocker) }));
  const killers = duels.filter(({ duel }) => duel.attackerDies);
  const myValue = creatureValue(attacker);

  // ---- Gain
  const lifeFraction = Math.min(1, Math.max(0, 1 - (defender?.life ?? STARTING_LIFE) / STARTING_LIFE));
  const damageWeight = 0.4 + 0.6 * lifeFraction + 0.5 * threatShare;
  const trampleThrough = hasTrample(attacker) && blockers.length > 0 ? Math.max(0, power - Math.min(...blockers.map((b) => Math.max(0, parseNum(b.toughness) ?? 0)))) : 0;
  const expectedDamage = power * (1 - pBlocked) + trampleThrough * pBlocked;
  let gain = expectedDamage * damageWeight;
  if (expectedDamage > 0) reasons.push(`~${expectedDamage.toFixed(1)} damage to ${defender?.name ?? "the target"} (weighted ${damageWeight.toFixed(1)})`);

  const kills = duels.filter(({ duel }) => duel.blockerDies);
  if (kills.length > 0 && killers.length === 0) {
    const bestKill = Math.max(...kills.map(({ blocker }) => creatureValue(blocker)));
    const killGain = bestKill * pBlocked * 0.6;
    gain += killGain;
    reasons.push(`could kill a blocker worth ${bestKill.toFixed(1)}`);
  }
  if (/\bwhenever this creature attacks\b|\bwhenever [^.]*\bdeals combat damage\b/.test(textOf(attacker))) {
    gain += 1.2;
    reasons.push("has an attack/damage trigger");
  }

  // ---- Risk
  let risk = 0;
  if (killers.length > 0) {
    // They pick the blocker that kills it most cheaply, and take the block only when it favours them.
    const cheapest = killers.reduce((best, entry) => (creatureValue(entry.blocker) < creatureValue(best.blocker) ? entry : best));
    const theyLose = cheapest.duel.blockerDies ? creatureValue(cheapest.blocker) : 0;
    const pLoss = Math.max(pBlocked, 0.75);
    const tradeNet = theyLose - myValue; // positive: the trade favours me
    if (tradeNet > 0) {
      gain += tradeNet * pLoss * 0.8;
      reasons.push(`a trade with ${cheapest.blocker.name ?? "a blocker"} (worth ${theyLose.toFixed(1)}) wins value for a ${myValue.toFixed(1)} creature`);
    } else {
      risk += -tradeNet * pLoss;
      reasons.push(`${cheapest.blocker.name ?? "a blocker"} can kill it (${theyLose > 0 ? "trading worth " + theyLose.toFixed(1) : "for free"}); it is worth ${myValue.toFixed(1)} to my plan`);
    }
  }

  // Crack-back: my untapped creatures soak up their biggest attackers. Tapping this one removes one such blocker.
  if (!hasKeyword(attacker, "vigilance")) {
    const myLife = Math.max(1, context.you?.life ?? STARTING_LIFE);
    const theirPowers = (context.opponents ?? [])
      .flatMap((opponent) => creatures(opponent.battlefield).map((card) => Math.max(0, parseNum(card.power) ?? 0)))
      .sort((a, b) => b - a);
    const exposure = (blockersLeft: number) => theirPowers.slice(blockersLeft).reduce((total, value) => total + value, 0);
    const stayingHome = Math.max(0, myCreatures.length - 1);
    const withAttackerHome = exposure(stayingHome + 1);
    const withAttackerTapped = exposure(stayingHome);
    const extra = withAttackerTapped - withAttackerHome;
    if (extra > 0) {
      const lethal = withAttackerTapped >= myLife;
      const crackBack = lethal ? 8 : (extra / myLife) * 6 + (withAttackerTapped / myLife) * 2;
      risk += crackBack;
      reasons.push(`tapping it leaves ${withAttackerTapped} damage unblocked on the crack-back against ${myLife} life${lethal ? " (lethal!)" : ""}`);
    }
  }
  return { gain, risk, net: gain - risk, reasons };
}

// A rough share (0..1) of the total opponent threat that sits with one opponent.
export function threatShares(context: ScoringContext): Map<string, { share: number; threat: Threat }> {
  const entries = (context.opponents ?? []).map((opponent) => ({ id: opponent.id ?? "", threat: threatAssessment(opponent, context) }));
  const total = entries.reduce((sum, entry) => sum + Math.max(0.01, entry.threat.score), 0);
  return new Map(entries.map((entry) => [entry.id, { share: Math.max(0.01, entry.threat.score) / total, threat: entry.threat }]));
}
