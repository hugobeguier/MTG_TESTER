// Keyword-aware combat helpers shared by the action scorer and the strategy evaluator: which keywords a creature has, whether a block is
// legal, and what a one-on-one fight does once first strike, double strike, deathtouch and indestructible are applied.
import { hasKeyword as keywordLineHas } from "./keywords";
import type { CardLike } from "./actionScoring";

export function parseNum(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function hasKeyword(card: CardLike, keyword: string): boolean {
  if (card.keywords) return card.keywords.includes(keyword);
  return keywordLineHas(card.oracleText ?? "", keyword);
}

export function hasLifelink(card: CardLike) {
  return hasKeyword(card, "lifelink");
}

// What a one-on-one fight does, with the keyword rules applied in the order the rules apply them: first strikers deal damage in an
// earlier step (and a creature that dies in it deals none afterwards); double strikers deal in both; deathtouch makes any damage lethal;
// indestructible creatures survive lethal damage and deathtouch. Returns who dies and how much damage each side got in.
export function simulateDuel(attacker: CardLike, blocker: CardLike): { attackerDies: boolean; blockerDies: boolean; attackerDealt: number; blockerDealt: number; firstStrikeKillsBlocker: boolean } {
  const aPower = Math.max(0, parseNum(attacker.power) ?? 0);
  const bPower = Math.max(0, parseNum(blocker.power) ?? 0);
  const aToughness = parseNum(attacker.toughness) ?? Number.POSITIVE_INFINITY;
  const bToughness = parseNum(blocker.toughness) ?? Number.POSITIVE_INFINITY;
  const aFirst = hasFirstStrike(attacker) || hasDoubleStrike(attacker);
  const bFirst = hasFirstStrike(blocker) || hasDoubleStrike(blocker);
  const aRegular = !hasFirstStrike(attacker) || hasDoubleStrike(attacker);
  const bRegular = !hasFirstStrike(blocker) || hasDoubleStrike(blocker);
  let aDamage = 0;
  let bDamage = 0;
  let attackerDealt = 0;
  let blockerDealt = 0;
  let aAlive = true;
  let bAlive = true;
  const lethal = (source: CardLike, dealt: number, toughness: number, target: CardLike) => dealt > 0 && !hasIndestructible(target) && (hasDeathtouch(source) || dealt >= toughness);
  let firstStrikeKillsBlocker = false;
  // First-strike step.
  if (aFirst) {
    blockerDealt += 0;
    bDamage += aPower;
    attackerDealt += aPower;
  }
  if (bFirst) {
    aDamage += bPower;
    blockerDealt += bPower;
  }
  if (aFirst && lethal(attacker, bDamage, bToughness, blocker)) {
    bAlive = false;
    firstStrikeKillsBlocker = true;
  }
  if (bFirst && lethal(blocker, aDamage, aToughness, attacker)) aAlive = false;
  // Regular step: only creatures still alive after the first-strike step deal damage.
  if (aAlive && aRegular) {
    bDamage += aPower;
    attackerDealt += aPower;
  }
  if (bAlive && bRegular) {
    aDamage += bPower;
    blockerDealt += bPower;
  }
  if (lethal(attacker, bDamage, bToughness, blocker)) bAlive = false;
  if (lethal(blocker, aDamage, aToughness, attacker)) aAlive = false;
  return { attackerDies: !aAlive, blockerDies: !bAlive, attackerDealt, blockerDealt, firstStrikeKillsBlocker };
}

export function hasFlying(card: CardLike) {
  return hasKeyword(card, "flying");
}

export function hasReach(card: CardLike) {
  return hasKeyword(card, "reach");
}

export function hasDeathtouch(card: CardLike) {
  return hasKeyword(card, "deathtouch");
}

export function hasTrample(card: CardLike) {
  return hasKeyword(card, "trample");
}

export function hasFirstStrike(card: CardLike) {
  return hasKeyword(card, "first strike");
}

export function hasDoubleStrike(card: CardLike) {
  return hasKeyword(card, "double strike");
}

export function hasIndestructible(card: CardLike) {
  return hasKeyword(card, "indestructible");
}

export function hasInfect(card: CardLike) {
  return hasKeyword(card, "infect");
}

export function hasMenace(card: CardLike) {
  return hasKeyword(card, "menace");
}

// Mirrors AppFlow.tsx's canBlock: a menace attacker needs two-or-more blockers assigned at once,
// which this engine's single-blocker-per-attacker model can never offer — so no single candidate
// here is ever a legal block for one. Without this, attack-profitability scoring would think a
// menace attacker "has a potential blocker" and hold back an attack the engine will actually just
// wave through unblocked.
export function canLegallyBlock(attacker: CardLike, blocker: CardLike): boolean {
  if (hasMenace(attacker)) return false;
  return !hasFlying(attacker) || hasFlying(blocker) || hasReach(blocker);
}
