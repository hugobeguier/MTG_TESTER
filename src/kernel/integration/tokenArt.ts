// Token art for kernel games. A kernel token is an object defined by the step that made it (name, types, colours, P/T, abilities): it has no card identity,
// so toSession cannot look its art up by card name the way it does for a real card. The legacy game asks Scryfall (route /api/cards/token) once per distinct
// token and stamps the answer on the card; here the same candidates (every printing of the token name, slimmed) are fetched at `npm run kernel:bundle-drafts`
// time, stored in the pack (`tokenPrintings`) and resolved in the browser by the SAME chooser the legacy route uses (`pickTokenPrinting`), plus fallbacks.
// Pure: no fs, no network. The Node side that fetches and attaches the candidates is nodeTokenArt.ts.
import type { CardImageUris } from "../../lib/types";
import { normalizeTokenText, pickTokenPrinting, tokenBaseName, type TokenCandidate, type TokenSpec } from "../../lib/tokenArt";

/** every printing of a token name, lower-cased base name -> candidates (newest first, distinct by text / colours / P/T / type line) */
export type TokenPrintings = Record<string, TokenCandidate[]>;

/** Predefined tokens every deck may create through a predefined step ("investigate", "gift a Treasure", Treasure-makers) or through a card the draft names. */
export const PREDEFINED_TOKEN_NAMES = ["Treasure", "Food", "Clue", "Blood", "Powerstone", "Map", "Incubator", "Shard", "Junk", "Gold", "Walker", "Role"] as const;

const LETTER: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G", colorless: "" };
const letters = (cs: readonly string[] | undefined): string[] => (cs ?? []).map((c) => (LETTER[c.toLowerCase()] ?? c.toUpperCase()).slice(0, 1)).filter(Boolean);

export const printingKey = (name: string): string => tokenBaseName(name).toLowerCase();

/** The token names a card definition's JSON can create (create_tokens steps at any depth, "investigate" = Clue). */
export function tokenNamesOf(json: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (typeof o.tokenName === "string" && o.tokenName) out.add(o.tokenName);
    if (o.kind === "investigate") out.add("Clue");
    for (const x of Object.values(o)) walk(x);
  };
  walk(json);
  return [...out].sort();
}

/** What the pack keeps of a Scryfall token printing. */
export function slimPrinting(c: TokenCandidate & { image_uris?: Record<string, string> }): TokenCandidate {
  const u = c.image_uris ?? {};
  const image_uris: Record<string, string> = {};
  for (const k of ["small", "normal", "large", "art_crop"]) if (u[k]) image_uris[k] = u[k];
  return { name: c.name, type_line: c.type_line, oracle_text: c.oracle_text, colors: c.colors ?? [], ...(c.power !== undefined ? { power: c.power } : {}), ...(c.toughness !== undefined ? { toughness: c.toughness } : {}), image_uris };
}

const sameColors = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean => [...(a ?? [])].sort().join("") === [...(b ?? [])].sort().join("");
const urisOf = (u: Record<string, string>): CardImageUris => ({ small: u.small, normal: u.normal, large: u.large, ...(u.art_crop ? { artCrop: u.art_crop } : {}) } as CardImageUris);

/**
 * The art for a token spec: the legacy chooser first (rules text + colours + P/T + type), then looser tiers so that a token whose text we word differently from
 * Scryfall still gets its face: name + colours + P/T, name + P/T, name + colours, any printing of the name. undefined = no printing of that name has art
 * (the table then draws the placeholder card: name, type line, P/T, rules text).
 */
export function resolveTokenArt(printings: TokenPrintings | undefined, spec: TokenSpec): CardImageUris | undefined {
  const list = printings?.[printingKey(spec.name)];
  if (!list?.length) return undefined;
  const strict = pickTokenPrinting(spec, list);
  if (strict) return strict;
  const base = printingKey(spec.name);
  const withArt = list.filter((c) => c.image_uris?.normal && (c.name ?? "").toLowerCase() === base);
  const stats = (c: TokenCandidate) => (spec.power === undefined || c.power === spec.power) && (spec.toughness === undefined || c.toughness === spec.toughness);
  const colors = (c: TokenCandidate) => sameColors(c.colors, spec.colors);
  const hit = withArt.find((c) => colors(c) && stats(c)) ?? withArt.find(stats) ?? withArt.find(colors) ?? withArt[0];
  return hit?.image_uris ? urisOf(hit.image_uris) : undefined;
}

/** A memoised resolver over a printings map (the key is the whole spec, so the answer for one spec is always the same object). */
export function tokenArtResolver(printings: TokenPrintings | undefined): (spec: TokenSpec) => CardImageUris | undefined {
  const memo = new Map<string, CardImageUris | null>();
  return (spec) => {
    const key = `${printingKey(spec.name)}|${spec.power ?? ""}/${spec.toughness ?? ""}|${[...(spec.colors ?? [])].sort().join("")}|${(spec.typeLine ?? "").toLowerCase()}|${normalizeTokenText(spec.oracleText)}`;
    let hit = memo.get(key);
    if (hit === undefined) { hit = resolveTokenArt(printings, spec) ?? null; memo.set(key, hit); }
    return hit ?? undefined;
  };
}

/** The spec of a kernel token as toSession shows it (colours as W/U/B/R/G letters, "Token " stripped from the type line). */
export function tokenSpecOf(t: { name: string; colors: readonly string[]; power?: number; toughness?: number }, typeLine: string, oracleText: string, colorsAreLetters = false): TokenSpec {
  return { name: t.name, ...(t.power !== undefined ? { power: String(t.power) } : {}), ...(t.toughness !== undefined ? { toughness: String(t.toughness) } : {}), colors: colorsAreLetters ? [...t.colors] : letters(t.colors), typeLine: typeLine.replace(/^Token\s+/i, ""), oracleText };
}
