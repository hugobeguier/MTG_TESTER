import type { VisibleCard } from "./types";

export function counterCount(card: VisibleCard, kind: string): number {
  return card.counters?.find((counter) => counter.kind === kind)?.count ?? 0;
}

// +1/+1 and -1/-1 counters are the only counter kinds that modify power/toughness; every other
// kind (loyalty, age, etc.) is tracked but doesn't feed into this.
export function plusMinusCounterBonus(card: VisibleCard): number {
  return counterCount(card, "+1/+1") - counterCount(card, "-1/-1");
}

// Layer order (rule 613): 7a characteristic-defining abilities establish the base, 7b "set base
// power/toughness" effects replace that base outright (newest one wins — see
// GameSession.effectTimestampCounter), then 7c counters and 7d other +N/-N effects (temporary
// buffs, Aura/Equipment pumps) add on top of whichever base layers 7a/7b left behind.
export function effectivePower(card: VisibleCard): number {
  const base = card.setPowerOverride ?? card.cdaPower ?? (Number.parseInt(card.power ?? "0", 10) || 0);
  return base + plusMinusCounterBonus(card) + (card.temporaryPowerBonus ?? 0) + (card.attachmentPowerBonus ?? 0);
}

export function effectiveToughness(card: VisibleCard): number {
  const base = card.setToughnessOverride ?? card.cdaToughness ?? (Number.parseInt(card.toughness ?? "0", 10) || 0);
  return base + plusMinusCounterBonus(card) + (card.temporaryToughnessBonus ?? 0) + (card.attachmentToughnessBonus ?? 0);
}
