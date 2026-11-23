// Pure helpers for showing a card in a kernel decision: which image to use, and the text lines (name, cost, type, rules, P/T, counters) that are shown next to
// or instead of the art. No React, no DOM. The data is whatever the kernel's table state put on the VisibleCard (printed data from the card pack); nothing is looked up here.
import type { VisibleCard } from "@/lib/types";

export type ImageSize = "small" | "normal" | "large";

/** the best image URL for the wanted size (falls back to any other size, then the first face), or undefined when the card has no art */
export function cardImageUrl(card: Pick<VisibleCard, "imageUris" | "faces"> | undefined, size: ImageSize = "normal"): string | undefined {
  if (!card) return undefined;
  const pick = (u: VisibleCard["imageUris"]): string | undefined => {
    if (!u) return undefined;
    const order: ImageSize[] = size === "small" ? ["small", "normal", "large"] : size === "large" ? ["large", "normal", "small"] : ["normal", "large", "small"];
    for (const k of order) if (u[k]) return u[k];
    return u.png ?? undefined;
  };
  return pick(card.imageUris) ?? pick(card.faces?.[0]?.imageUris);
}

export interface CardInfo {
  name: string;
  manaCost?: string;
  typeLine: string;
  oracleText: string;
  /** "3/4", or "Loyalty 4" */
  stats?: string;
  /** "2 +1/+1, 1 charge" */
  counters?: string;
  imageUrl?: string;
}

/** the text view of a card, the fallback when there is no art (and the readable text beside it) */
export function cardInfo(card: VisibleCard, size: ImageSize = "normal"): CardInfo {
  const stats = card.power !== undefined && card.toughness !== undefined ? `${card.power}/${card.toughness}` : card.loyalty !== undefined ? `Loyalty ${card.loyalty}` : undefined;
  const counters = card.counters?.length ? card.counters.map((c) => `${c.count} ${c.kind}`).join(", ") : undefined;
  const imageUrl = cardImageUrl(card, size);
  return { name: card.name, ...(card.manaCost ? { manaCost: card.manaCost } : {}), typeLine: card.typeLine, oracleText: card.oracleText, ...(stats ? { stats } : {}), ...(counters ? { counters } : {}), ...(imageUrl ? { imageUrl } : {}) };
}

/** the one-line tooltip / aria text of a card */
export function cardSummary(card: VisibleCard): string {
  const i = cardInfo(card);
  return [i.name + (i.manaCost ? ` ${i.manaCost}` : ""), i.typeLine, i.oracleText, i.stats].filter(Boolean).join("\n");
}

/** ids of the cards a decision's options show (the ones that carry a card): only what the kernel listed */
export function optionCards(options: ReadonlyArray<{ id: string; card?: VisibleCard }>): Array<{ id: string; card: VisibleCard }> {
  return options.filter((o): o is { id: string; card: VisibleCard } => !!o.card);
}

/**
 * scry / surveil / look-at-top style decision: a "choose cards" whose options are all cards still in a library, answered with the ones to MOVE.
 * Returns the destination of the picked cards ("bottom" of the library or the "graveyard" ...) read from the kernel's own instruction, else undefined.
 */
export function pileDestination(d: { kind: string; instruction: string; title: string; options: ReadonlyArray<{ card?: VisibleCard }> }): "bottom" | "graveyard" | "top" | "exile" | "hand" | undefined {
  if (d.kind !== "choose_cards" || d.options.length === 0 || !d.options.every((o) => o.card?.zone === "library")) return undefined;
  const t = `${d.title} ${d.instruction}`.toLowerCase();
  const m = /put (?:any|them|those|the|it|up to|each|one)?[^.]*?\b(on the bottom|into (?:your|its owner's|their) graveyard|into the graveyard|on top|into (?:your )?hand|into exile|exile)/.exec(t);
  if (!m) return undefined;
  const w = m[1];
  return w.includes("bottom") ? "bottom" : w.includes("graveyard") ? "graveyard" : w.includes("top") ? "top" : w.includes("hand") ? "hand" : "exile";
}
