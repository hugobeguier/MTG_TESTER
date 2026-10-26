// Token art: Scryfall has real token card objects (layout "token"), found by name + power/toughness. A server route asks Scryfall once per distinct token and
// caches the answer on disk (data/token-art.json); the client keeps its own map and stamps imageUris on matching tokens.
import type { CardImageUris, VisibleCard } from "./types";

export function tokenArtKey(card: Pick<VisibleCard, "name" | "power" | "toughness" | "colors">): string {
  return `${tokenBaseName(card.name).toLowerCase()}|${card.power ?? ""}/${card.toughness ?? ""}|${(card.colors ?? []).join("")}`;
}

export function tokenBaseName(name: string): string {
  return name.replace(/\s+Token$/i, "").replace(/\s+artifact$/i, "").trim();
}

// The Scryfall query for a token: name (without " Token") + stats when it is a creature token.
export function tokenSearchQuery(card: Pick<VisibleCard, "name" | "power" | "toughness" | "colors">, withStats: boolean): string {
  const parts = ["t:token", `name:"${tokenBaseName(card.name).replace(/"/g, "")}"`];
  if (withStats && card.power !== undefined && card.toughness !== undefined && /^\d+$/.test(card.power) && /^\d+$/.test(card.toughness)) parts.push(`pow=${card.power}`, `tou=${card.toughness}`);
  return parts.join(" ");
}

export function needsTokenArt(card: VisibleCard): boolean {
  return Boolean(card.token) && !card.imageUris?.normal && !card.imageUris?.large && !card.imageUris?.png;
}

export type TokenArtResult = { imageUris?: CardImageUris };
