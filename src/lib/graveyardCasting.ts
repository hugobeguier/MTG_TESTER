// Which cards in a graveyard their owner may CAST from there, and at what cost. Three sources:
//   - Flashback {cost} (Army of the Damned, Moan of the Unhallowed): cast for the flashback cost, then the
//     card is exiled instead of going back to the graveyard.
//   - A standing permission printed on the card: "You may cast this card from your graveyard as long as you
//     control a Zombie." (Gravecrawler) — normal cost, goes back to the graveyard like any spell.
//   - A one-turn grant another permanent made: "{T}: You may cast target Zombie creature card from your
//     graveyard this turn." (Zul Ashur, Lich Lord) — normal cost, recorded on the card as graveyardCastGrant.
// Pure text/board checks, no session mutation. Declines (undefined) anything it doesn't fully understand.

import { permanentMatchesQualifier } from "./characteristics";

export interface GraveyardCastPermission {
  kind: "flashback" | "static" | "granted";
  // Flashback only: the mana cost to pay INSTEAD of the card's own, e.g. "{5}{B}{B}".
  costText?: string;
  // Flashback: the card is exiled when the spell would leave the stack.
  exileAfter: boolean;
}

interface CardLike {
  oracleText: string;
  typeLine: string;
  graveyardCastGrant?: { seatId: string; turn: number };
  colors?: string[];
  token?: boolean;
}

export function parseFlashbackCost(oracleText: string): string | undefined {
  const match = oracleText.match(/\bflashback\s+((?:\{[^}]+\})+)/i);
  return match ? match[1] : undefined;
}

// "You may cast this card from your graveyard [as long as you control a Zombie]."
export function parseStaticGraveyardCast(oracleText: string): { requiredType?: string } | undefined {
  for (const rawClause of oracleText.split("\n")) {
    const clause = rawClause.replace(/\([^)]*\)/g, "").trim();
    const match = clause.match(/^you may cast this card from your graveyard(?: as long as you control an? ([A-Za-z]+))?\.?$/i);
    if (match) return { requiredType: match[1]?.toLowerCase() };
  }
  return undefined;
}

// "{T}: You may cast target Zombie creature card from your graveyard this turn." (Zul Ashur) — the type of card
// whose cast permission this activated ability hands out.
export function parseGraveyardCastGrantAbility(oracleText: string): { cardMatcher: string } | undefined {
  for (const rawClause of oracleText.split("\n")) {
    const clause = rawClause.replace(/\([^)]*\)/g, "").trim();
    const match = clause.match(/:\s*you may cast target ([A-Za-z ]+?) card from your graveyard this turn\.?$/i);
    if (match) return { cardMatcher: match[1].trim().toLowerCase() };
  }
  return undefined;
}

export function graveyardCastPermission(
  card: CardLike,
  context: { seatId: string; turn: number; controllerBattlefield: Array<{ typeLine: string; token?: boolean; colors?: string[]; grantedTypes?: string[] }> }
): GraveyardCastPermission | undefined {
  // Lands are played, not cast.
  if (card.typeLine.includes("Land")) return undefined;
  if (card.graveyardCastGrant && card.graveyardCastGrant.seatId === context.seatId && card.graveyardCastGrant.turn === context.turn) {
    return { kind: "granted", exileAfter: false };
  }
  const flashbackCost = parseFlashbackCost(card.oracleText);
  if (flashbackCost) return { kind: "flashback", costText: flashbackCost, exileAfter: true };
  const staticCast = parseStaticGraveyardCast(card.oracleText);
  if (staticCast) {
    if (staticCast.requiredType && !context.controllerBattlefield.some((permanent) => permanentMatchesQualifier(permanent, staticCast.requiredType!))) return undefined;
    return { kind: "static", exileAfter: false };
  }
  return undefined;
}
