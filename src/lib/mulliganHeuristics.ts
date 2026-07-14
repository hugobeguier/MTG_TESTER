import type { PlayerSeat, VisibleCard } from "./types";

export interface OpeningHandEvaluation {
  keep: boolean;
  score: number;
  reasons: string[];
}

type ManaColor = "W" | "U" | "B" | "R" | "G" | "C";

const BASIC_LAND_COLORS: Record<string, ManaColor> = {
  Plains: "W",
  Island: "U",
  Swamp: "B",
  Mountain: "R",
  Forest: "G",
  Wastes: "C"
};

const IDEAL_MIN_LANDS = 2;
const IDEAL_MAX_LANDS = 4;
const ACCEPTABLE_MAX_LANDS = 5;
const MIN_TOTAL_SOURCES = 3;
const CHEAP_RAMP_MAX_MANA_VALUE = 2;
const MAX_CHEAP_RAMP_BONUS = 2;

function isLand(card: VisibleCard) {
  return card.role === "land" || card.typeLine.includes("Land");
}

function isRamp(card: VisibleCard) {
  return card.role === "ramp";
}

function producedColors(card: VisibleCard): Set<ManaColor> {
  const colors = new Set<ManaColor>();
  for (const color of card.producedMana ?? []) {
    const normalized = color.toUpperCase();
    if (normalized === "W" || normalized === "U" || normalized === "B" || normalized === "R" || normalized === "G" || normalized === "C") {
      colors.add(normalized as ManaColor);
    }
  }
  for (const [name, color] of Object.entries(BASIC_LAND_COLORS)) {
    if (card.name === name || card.typeLine.includes(name)) colors.add(color);
  }
  return colors;
}

function missingCommanderColors(hand: VisibleCard[], colorIdentity: string[]): string[] {
  if (colorIdentity.length === 0) return [];
  const covered = new Set<ManaColor>();
  for (const card of hand) {
    if (!isLand(card) && !isRamp(card)) continue;
    for (const color of producedColors(card)) covered.add(color);
  }
  return colorIdentity.filter((color) => !covered.has(color as ManaColor));
}

function countEarlyPlays(hand: VisibleCard[]) {
  return hand.filter((card) => !isLand(card) && card.manaValue >= 1 && card.manaValue <= 3).length;
}

export function evaluateOpeningHand(seat: PlayerSeat): OpeningHandEvaluation {
  const hand = seat.board.hand;
  const lands = hand.filter(isLand);
  const ramp = hand.filter(isRamp);
  const cheapRamp = ramp.filter((card) => card.manaValue <= CHEAP_RAMP_MAX_MANA_VALUE);
  const expensiveRampCount = ramp.length - cheapRamp.length;
  const totalSources = lands.length + ramp.length;

  const reasons: string[] = [];
  let score = 0;

  if (lands.length < IDEAL_MIN_LANDS) {
    score -= 3;
    reasons.push(`only ${lands.length} land${lands.length === 1 ? "" : "s"} in hand`);
  } else if (lands.length <= IDEAL_MAX_LANDS) {
    score += 2;
    reasons.push(`${lands.length} lands is an ideal count`);
  } else if (lands.length <= ACCEPTABLE_MAX_LANDS) {
    reasons.push(`${lands.length} lands is acceptable but flood-prone`);
  } else {
    score -= 3;
    reasons.push(`${lands.length} lands risks flooding`);
  }

  if (totalSources < MIN_TOTAL_SOURCES) {
    score -= 2;
    reasons.push(`only ${totalSources} total mana sources (lands + ramp)`);
  }

  if (cheapRamp.length > 0) {
    score += Math.min(cheapRamp.length, MAX_CHEAP_RAMP_BONUS);
    reasons.push(`${cheapRamp.length} cheap ramp piece${cheapRamp.length === 1 ? "" : "s"}`);
  }
  if (expensiveRampCount > 0) {
    reasons.push(`${expensiveRampCount} higher-cost ramp piece${expensiveRampCount === 1 ? "" : "s"} (less impactful early)`);
  }

  const earlyPlays = countEarlyPlays(hand);
  if (earlyPlays === 0) {
    score -= 1;
    reasons.push("no 1-3 mana value plays in hand");
  } else {
    score += 1;
    reasons.push(`${earlyPlays} early play${earlyPlays === 1 ? "" : "s"} (1-3 mana value)`);
  }

  const commanderColors = seat.board.commander?.colorIdentity ?? [];
  const missingColors = missingCommanderColors(hand, commanderColors);
  if (missingColors.length > 0) {
    score -= missingColors.length;
    reasons.push(`missing a mana source for commander color${missingColors.length === 1 ? "" : "s"} ${missingColors.join("")}`);
  } else if (commanderColors.length > 0) {
    score += 1;
    reasons.push("hand covers all commander colors");
  }

  return { keep: score >= 0, score, reasons };
}

export function agentKeepsHand(seat: PlayerSeat) {
  return evaluateOpeningHand(seat).keep;
}
