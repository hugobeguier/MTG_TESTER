// Deterministic block valuation for agent seats. A block is worth making when what it SAVES is at least what it COSTS:
//   saved = value of the damage it prevents to the specific thing under attack (the player's life, or a planeswalker's loyalty / its very survival)
//   gain  = value of killing the attacker
//   lost  = value of the blockers that die
// The old rule ("a blocker that dies against a survivable attacker is a mistake") ignored WHAT was being attacked, so an agent let a commander
// planeswalker die rather than chump with a 1/1 token. Everything here is a pure function of the scoring context (see actionScoring.ts), in the
// same rough "mana worth of stuff" units as strategy.creatureValue.

import type { CardLike, ScoringContext } from "./actionScoring";
import { creatureValue } from "./strategy";
import { hasDeathtouch, hasDoubleStrike, hasFirstStrike, hasIndestructible, hasTrample, parseNum, simulateDuel } from "./combatSim";

// Weights (all in "mana worth" units).
export const BLOCK_WEIGHTS = {
  tokenDiscount: 0.7, // a token costs no card, so losing one is cheaper than its stats suggest
  deathTriggerRelief: 1.5, // a blocker with a "when this dies" payoff loses less by dying
  killGainShare: 0.8, // killing the attacker is worth most of its value
  planeswalkerBase: 3, // + 0.8 per mana value of the planeswalker
  commanderLossBase: 7, // commander planeswalker/creature dying: command zone + {2} tax each time
  commanderTaxShare: 0.75, // per point of (tax already paid + the 2 the next death adds)
  loyaltyRate: 0.35, // value of one prevented loyalty loss when the planeswalker survives anyway
  commanderLoyaltyRate: 0.5,
  doomedLoyaltyRate: 0.15, // blocking cannot save it: nearly worthless
  lifeRates: [0.12, 0.25, 0.5, 1.0], // per prevented life point, by life left if the attack connects: >=25, >=15, >=8, below
  preventsLethal: 15,
  worthwhileNet: 0.75, // net value needed to call a block clearly good
  mandatoryNet: 3, // net value at which declining to block is vetoed
  terribleNet: -4 // net value at which a block is vetoed (with at least `terribleLoss` of value thrown away)
} as const;
export const TERRIBLE_BLOCK_LOSS = 4;

export interface BlockAssessment {
  net: number;
  saved: number;
  killGain: number;
  lost: number;
  attackerDies: boolean;
  deadBlockers: CardLike[];
  stake: string; // human-readable: what the block protects
}

function powerOf(card: CardLike): number {
  return Math.max(0, parseNum(card.power) ?? 0);
}

function isPlaneswalker(card: CardLike | undefined): boolean {
  return Boolean(card && (card.typeLine ?? "").includes("Planeswalker"));
}

// What dying costs the blocker's owner.
export function blockLoss(blocker: CardLike): number {
  let value = creatureValue(blocker);
  const text = (blocker.oracleText ?? "").toLowerCase();
  if (blocker.token) value *= BLOCK_WEIGHTS.tokenDiscount;
  if (/\bwhen(?:ever)? (?:this creature|[^,.]*?) dies\b/.test(text) && !/\bwhenever (?:a|another|one or more)\b/.test(text)) value = Math.max(0.3, value - BLOCK_WEIGHTS.deathTriggerRelief);
  if (blocker.commander) value += commanderLossValue(blocker);
  return value;
}

// Losing a commander: it goes to the command zone and every later cast costs {2} more, so it is worth far more than its card.
export function commanderLossValue(card: CardLike): number {
  const tax = Number((card as { commanderTax?: number }).commanderTax ?? 0);
  return BLOCK_WEIGHTS.commanderLossBase + 0.5 * (card.manaValue ?? 0) + BLOCK_WEIGHTS.commanderTaxShare * (tax + 2);
}

function planeswalkerValue(pw: CardLike): number {
  const base = BLOCK_WEIGHTS.planeswalkerBase + 0.8 * (pw.manaValue ?? 4);
  return pw.commander ? base + commanderLossValue(pw) : base;
}

function opponentAttackers(context: ScoringContext): CardLike[] {
  return (context.opponents ?? []).flatMap((opponent) => opponent.battlefield ?? []).filter((card) => card.attacking && ((card.typeLine ?? "").includes("Creature") || parseNum(card.power) !== undefined));
}

function attackPower(card: CardLike): number {
  return powerOf(card) * (hasDoubleStrike(card) ? 2 : 1);
}

// Value of preventing `absorbed` of the attacker's damage, given what it is attacking.
export function attackStake(attacker: CardLike, context: ScoringContext, absorbed: number): { saved: number; stake: string } {
  if (absorbed <= 0) return { saved: 0, stake: "nothing (no damage prevented)" };
  const you = context.you;
  const targetId = attacker.attackTargetId;
  const pw = targetId && targetId !== you?.id ? (you?.battlefield ?? []).find((card) => card.id === targetId) : undefined;
  const attackers = opponentAttackers(context);

  if (pw && isPlaneswalker(pw)) {
    const loyalty = parseNum(pw.loyalty) ?? 4;
    const incoming = attackers.filter((card) => card.attackTargetId === pw.id).reduce((sum, card) => sum + attackPower(card), 0) || attackPower(attacker);
    const label = `${pw.name ?? "a planeswalker"}${pw.commander ? " (your commander planeswalker)" : ""}`;
    const wouldDie = incoming >= loyalty;
    const remaining = incoming - absorbed;
    if (wouldDie && remaining < loyalty) {
      return { saved: planeswalkerValue(pw), stake: `${label} (${loyalty} loyalty) would die to ${incoming} damage and this block saves it${pw.commander ? "; losing a commander sends it to the command zone and raises its tax by {2}" : ""}` };
    }
    if (wouldDie) return { saved: absorbed * BLOCK_WEIGHTS.doomedLoyaltyRate, stake: `${label} dies to the other attackers anyway` };
    const rate = pw.commander ? BLOCK_WEIGHTS.commanderLoyaltyRate : BLOCK_WEIGHTS.loyaltyRate;
    const low = loyalty - incoming <= 2 ? 1.5 : 1;
    return { saved: absorbed * rate * low, stake: `${absorbed} loyalty on ${label}, which survives the attack (${loyalty} loyalty vs ${incoming} damage)` };
  }

  if (!targetId || targetId === you?.id || !you?.id) {
    const life = you?.life ?? 40;
    const incoming = attackers.filter((card) => !card.attackTargetId || card.attackTargetId === you?.id || !you?.id).reduce((sum, card) => sum + attackPower(card), 0) || attackPower(attacker);
    const lifeAfter = life - incoming;
    const rates = BLOCK_WEIGHTS.lifeRates;
    const rate = lifeAfter >= 25 ? rates[0] : lifeAfter >= 15 ? rates[1] : lifeAfter >= 8 ? rates[2] : rates[3];
    let saved = absorbed * rate;
    if (lifeAfter <= 0 && life - (incoming - absorbed) > 0) saved += BLOCK_WEIGHTS.preventsLethal;
    // Commander damage is its own clock to 21.
    if (attacker.commander) {
      const dealt = you?.commanderDamage?.[attacker.id] ?? 0;
      saved += absorbed * 0.3;
      if (dealt + powerOf(attacker) >= 21 && dealt < 21) saved += BLOCK_WEIGHTS.preventsLethal;
    }
    return { saved, stake: `${absorbed} of your ${life} life (${Math.max(lifeAfter, 0)} left if it connects)` };
  }

  return { saved: absorbed * 0.2, stake: "damage to something else (a battle or another player's permanent)" };
}

function lethalNeeded(attacker: CardLike, blocker: CardLike): number {
  return hasDeathtouch(attacker) ? 1 : Math.max(1, parseNum(blocker.toughness) ?? 1);
}

interface GroupOutcome {
  attackerDies: boolean;
  deadBlockers: CardLike[];
  absorbed: number;
}

// What a block by one or several blockers does. One blocker uses the exact duel simulation; a gang uses the damage-assignment model:
// the attacker spends its power killing blockers (most valuable first, deathtouch needs 1 each), first strikers' victims deal nothing back.
function groupOutcome(attacker: CardLike, blockers: CardLike[]): GroupOutcome {
  const total = attackPower(attacker);
  if (blockers.length === 1) {
    const duel = simulateDuel(attacker, blockers[0]);
    const needed = lethalNeeded(attacker, blockers[0]);
    const absorbed = hasTrample(attacker) ? Math.min(total, needed) : total;
    return { attackerDies: duel.attackerDies, deadBlockers: duel.blockerDies ? [blockers[0]] : [], absorbed };
  }
  const first = hasFirstStrike(attacker) || hasDoubleStrike(attacker);
  let budget = total;
  const dead: CardLike[] = [];
  for (const blocker of [...blockers].sort((a, b) => blockLoss(b) - blockLoss(a))) {
    if (hasIndestructible(blocker)) continue;
    const need = lethalNeeded(attacker, blocker);
    if (budget >= need) {
      dead.push(blocker);
      budget -= need;
    }
  }
  const dealing = first ? blockers.filter((blocker) => !dead.includes(blocker)) : blockers;
  const damage = dealing.reduce((sum, blocker) => sum + powerOf(blocker), 0);
  const deathtouch = dealing.some((blocker) => hasDeathtouch(blocker) && powerOf(blocker) > 0);
  const toughness = parseNum(attacker.toughness) ?? Number.POSITIVE_INFINITY;
  const attackerDies = !hasIndestructible(attacker) && (deathtouch || damage >= toughness) && damage > 0;
  const soak = blockers.reduce((sum, blocker) => sum + lethalNeeded(attacker, blocker), 0);
  return { attackerDies, deadBlockers: dead, absorbed: hasTrample(attacker) ? Math.min(total, soak) : total };
}

export function assessBlock(attacker: CardLike, blockers: CardLike[], context: ScoringContext): BlockAssessment {
  const outcome = groupOutcome(attacker, blockers);
  const { saved, stake } = attackStake(attacker, context, outcome.absorbed);
  const killGain = outcome.attackerDies ? BLOCK_WEIGHTS.killGainShare * creatureValue(attacker) : 0;
  const lost = outcome.deadBlockers.reduce((sum, blocker) => sum + blockLoss(blocker), 0);
  return { net: saved + killGain - lost, saved, killGain, lost, attackerDies: outcome.attackerDies, deadBlockers: outcome.deadBlockers, stake };
}

export function describeAssessment(a: BlockAssessment): string {
  const parts = [`protects ${a.stake}`];
  if (a.attackerDies) parts.push(`kills the attacker (worth ${a.killGain.toFixed(1)})`);
  parts.push(a.deadBlockers.length ? `costs ${a.deadBlockers.map((card) => card.name ?? "a blocker").join(" + ")} (worth ${a.lost.toFixed(1)})` : "costs nothing");
  return `${parts.join("; ")} => net ${a.net.toFixed(1)} (saved ${a.saved.toFixed(1)}, kill ${a.killGain.toFixed(1)}, lost ${a.lost.toFixed(1)})`;
}

// Best group of up to three of `candidates` against one attacker (cheapest groups win ties). Includes the singles.
export function bestBlockPlan(attacker: CardLike, candidates: CardLike[], context: ScoringContext, maxSize = 3): { blockers: CardLike[]; assessment: BlockAssessment } | undefined {
  const pool = [...candidates].sort((a, b) => blockLoss(a) - blockLoss(b)).slice(0, 8);
  let best: { blockers: CardLike[]; assessment: BlockAssessment } | undefined;
  const consider = (group: CardLike[]) => {
    const assessment = assessBlock(attacker, group, context);
    // Menace needs two blockers; the legal-block generator offers single blocks only when legal, so a single is never evaluated for menace here.
    if (!best || assessment.net > best.assessment.net + 1e-9) best = { blockers: group, assessment };
  };
  for (let i = 0; i < pool.length; i += 1) {
    consider([pool[i]]);
    if (maxSize >= 2) for (let j = i + 1; j < pool.length; j += 1) {
      consider([pool[i], pool[j]]);
      if (maxSize >= 3) for (let k = j + 1; k < pool.length; k += 1) consider([pool[i], pool[j], pool[k]]);
    }
  }
  return best;
}
