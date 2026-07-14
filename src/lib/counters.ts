import type { VisibleCard } from "./types";

export function counterCount(card: VisibleCard, kind: string): number {
  return card.counters?.find((counter) => counter.kind === kind)?.count ?? 0;
}

// +1/+1 and -1/-1 counters are the only counter kinds that modify power/toughness; every other
// kind (loyalty, age, etc.) is tracked but doesn't feed into this.
export function plusMinusCounterBonus(card: VisibleCard): number {
  return counterCount(card, "+1/+1") - counterCount(card, "-1/-1");
}

export function effectivePower(card: VisibleCard): number {
  return (Number.parseInt(card.power ?? "0", 10) || 0) + plusMinusCounterBonus(card);
}

export function effectiveToughness(card: VisibleCard): number {
  return (Number.parseInt(card.toughness ?? "0", 10) || 0) + plusMinusCounterBonus(card);
}
