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

// ---- Choosing the right printing ----
// Scryfall has many token objects with the same name (Pest 1/1 B/G exists with "When this token dies, you gain 1 life" AND "Whenever this token attacks, you gain 1 life").
// Looking up by name+stats and taking the newest printing showed the wrong face. We now fetch every printing of the name and score them against the engine token's
// own characteristics: oracle text first, then type line, colors, power/toughness.
export type TokenCandidate = {
  name?: string;
  type_line?: string;
  oracle_text?: string;
  colors?: string[];
  power?: string;
  toughness?: string;
  image_uris?: Record<string, string>;
};
export type TokenSpec = Pick<VisibleCard, "name" | "power" | "toughness" | "colors"> & { typeLine?: string; oracleText?: string };

// Cache/client key: includes the oracle text so die-trigger and attack-trigger Pests never share art.
export function tokenArtLookupKey(card: TokenSpec): string {
  return `v2|${tokenArtKey(card)}|${normalizeTokenText(card.oracleText)}`;
}

export function normalizeTokenText(text: string | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // reminder text
    .replace(/["“”]/g, "")
    .replace(/\bthis (token|artifact|creature|permanent)\b/g, "this")
    .replace(/[.\s]+/g, " ")
    .trim();
}

function sameColors(a: string[] | undefined, b: string[] | undefined): boolean {
  return [...(a ?? [])].sort().join("") === [...(b ?? [])].sort().join("");
}

function creatureTypes(typeLine: string | undefined): string {
  return (typeLine ?? "").split(/\s[—-]\s/).slice(1).join(" ").trim().toLowerCase();
}

// Returns the image URIs of the printing that best matches the token, or undefined when every candidate would show different rules text (the UI then draws the
// engine's own text instead of a mismatching face).
export function pickTokenPrinting(card: TokenSpec, candidates: TokenCandidate[]): CardImageUris | undefined {
  const base = tokenBaseName(card.name).toLowerCase();
  const withArt = candidates.filter((c) => c.image_uris?.normal && (c.name ?? "").toLowerCase() === base);
  if (withArt.length === 0) return undefined;
  const wantText = normalizeTokenText(card.oracleText);
  const wantTypes = creatureTypes(card.typeLine);
  const statsMatch = (c: TokenCandidate) => (card.power === undefined || c.power === card.power) && (card.toughness === undefined || c.toughness === card.toughness);
  const colorsMatch = (c: TokenCandidate) => sameColors(c.colors, card.colors);
  const typesMatch = (c: TokenCandidate) => !wantTypes || !creatureTypes(c.type_line) || creatureTypes(c.type_line).includes(wantTypes) || wantTypes.includes(creatureTypes(c.type_line));
  const text = (c: TokenCandidate) => normalizeTokenText(c.oracle_text);
  const tiers: Array<(c: TokenCandidate) => boolean> = [
    (c) => wantText !== "" && text(c) === wantText && colorsMatch(c) && statsMatch(c) && typesMatch(c),
    (c) => wantText !== "" && text(c) === wantText && colorsMatch(c) && statsMatch(c),
    (c) => wantText !== "" && text(c) === wantText && statsMatch(c),
    (c) => wantText !== "" && text(c) !== "" && (text(c).includes(wantText) || wantText.includes(text(c))) && colorsMatch(c) && statsMatch(c),
    // vanilla engine token (no rules text): printings without rules text, preferring matching colors/stats/types
    (c) => wantText === "" && text(c) === "" && colorsMatch(c) && statsMatch(c) && typesMatch(c),
    (c) => wantText === "" && text(c) === "" && colorsMatch(c) && statsMatch(c)
  ];
  let found: TokenCandidate | undefined;
  for (const tier of tiers) {
    found = withArt.find(tier);
    if (found) break;
  }
  // name+colors+P/T fallback is only safe when the printings do not disagree about rules text (so it cannot pick a different ability).
  if (!found) {
    const texts = new Set(withArt.map(text));
    if (texts.size <= 1) found = withArt.find((c) => colorsMatch(c) && statsMatch(c)) ?? withArt[0];
  }
  const uris = found?.image_uris;
  return uris ? ({ small: uris.small, normal: uris.normal, large: uris.large, png: uris.png, artCrop: uris.art_crop, borderCrop: uris.border_crop } as CardImageUris) : undefined;
}

export type TokenArtResult = { imageUris?: CardImageUris };
