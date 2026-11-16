// Land-entry helpers, extracted verbatim from components/AppFlow.tsx (see docs/ARCHITECTURE.md section 5).
// Owns: entersBattlefieldTapped and the land templates it recognises (shocklands, reveal/behold lands, check/fast/slow
// lands, opponent-count lands, known always-tapped cards), plus per-turn land-drop bookkeeping (landDropsAllowed,
// landPlaysMade, recordLandPlay, landTurnKey).
// AppFlow.tsx re-exports the previously public symbols so existing importers keep working.

import type { PlayerSeat, VisibleCard } from "@/lib/types";
import { basicLandTypes, capitalizeWord, numberWordToInt } from "@/engine/shared";

// "Shockland" replacement effect (Steam Vents, Blood Crypt, and the same template on the newer
// pay-life MDFC lands): the CONTROLLER chooses, at the moment it enters, whether to pay life for an
// untapped land or take it tapped for free — a real choice, not an unconditional "enters tapped"
// like a check/fast/slow land. Without this, the generic `/\benters tapped\b/` catch-all below still
// matched the "...if you don't, it enters tapped" clause (the literal substring is right there),
// so every shockland always entered tapped with the life-payment option silently unavailable —
// removing the entire reason these lands exist. Deliberately keyed off the exact replacement-effect
// wording rather than card names: any land templated this way (Ravnica shocks, the pay-life MDFC
// lands, future ones) is covered without a name list to maintain.
export function shocklandPayLifeAmount(oracleText: string): number | undefined {
  const match = oracleText.toLowerCase().match(/as this land enters,? you may pay (\d+) life\.\s*if you don.t,? it enters tapped\b/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

// No interactive prompt (yet) for either seat — paying life for the tempo of an untapped land is
// correct in the vast majority of real games (Commander's 40 starting life gives a lot of room), so
// this defaults to paying unless the controller is already in real danger, rather than always taking
// the free tapped land and just as silently defeating the card's purpose the other way.
const SHOCKLAND_MINIMUM_SAFE_LIFE = 10;

// "Checkland-style reveal" lands (the Snarls: Frostboil, Furycalm, Shineshadow, Vineglimmer, Choked Estuary-likes, ...):
// "As this land enters, you may reveal a Mountain or Island card from your hand. If you don't, this land enters tapped."
// Returns the revealable land types (capitalized), or undefined for any other text. Keyed off the wording, not names.
export function revealLandTypes(oracleText: string): string[] | undefined {
  const lower = oracleText.toLowerCase();
  // Two templates: "...If you don't, this land enters tapped." (Snarls, Gilt-Leaf Palace, Murmuring Bosk) and "...This land enters tapped
  // unless you revealed a Dragon card this way or you control a Dragon." (Temple of the Dragon Queen, Fortified Beachhead).
  const match =
    lower.match(/as (?:this land|~|[^.,]+?) enters,? you may reveal an? ([a-z]+)(?: or (?:an? )?([a-z]+))? card from your hand\.\s*if you don.t,? (?:it|this land|[^.,]+?) enters (?:the battlefield )?tapped/) ??
    lower.match(/as (?:this land|~|[^.,]+?) enters,? you may reveal an? ([a-z]+)(?: or (?:an? )?([a-z]+))? card from your hand\.\s*(?:this land|it|[^.,]+?) enters (?:the battlefield )?tapped unless you revealed/) ??
    // "behold" (Theorist's Sanctum): choose a Jace you control OR reveal one from hand — handled like the reveal template.
    lower.match(/as (?:this land|~|[^.,]+?) enters,? you may behold an? ([a-z]+)()\.\s*if you don.t,? (?:it|this land|[^.,]+?) enters (?:the battlefield )?tapped/);
  if (!match) return undefined;
  return [match[1], match[2]].filter((word): word is string => Boolean(word)).map(capitalizeWord);
}

// "...or you control a Dragon" — the permanent-control alternative to revealing (Temple of the Dragon Queen, Fortified Beachhead).
export function revealLandControlExempt(card: VisibleCard, controller: PlayerSeat | undefined): boolean {
  const types = revealLandTypes(card.oracleText);
  if (!types || !controller || !(/tapped unless you revealed [^.]*\bor you control an? /i.test(card.oracleText) || /you may behold an? [a-z]+\./i.test(card.oracleText))) return false;
  return controller.board.battlefield.some((permanent) => permanent.id !== card.id && types.some((type) => permanent.typeLine.includes(type)));
}

// The cards in `hand` that could be revealed for a reveal-land (never the land itself).
export function revealableLandCards(card: VisibleCard, hand: VisibleCard[]): VisibleCard[] {
  const types = revealLandTypes(card.oracleText);
  if (!types) return [];
  return hand.filter((candidate) => candidate.id !== card.id && types.some((type) => candidate.typeLine.includes(type)));
}

export function entersBattlefieldTapped(card: VisibleCard, controller?: PlayerSeat, allSeats?: PlayerSeat[]) {
  const text = card.oracleText.toLowerCase();
  // Reveal-land: revealing is free, so untapped exactly when something revealable is in hand (a human is asked first on a land DROP).
  if (revealLandTypes(card.oracleText)) {
    return !controller || (revealableLandCards(card, controller.board.hand).length === 0 && !revealLandControlExempt(card, controller));
  }
  // "This land enters tapped unless your opponents control eight or more lands." (Turbulent Fen and
  // the rest of that cycle) — counts lands across ALL opponents combined, not just one.
  const opponentLandsMatch = text.match(/enters (?:the battlefield )?tapped unless your opponents control (\w+) or more lands/);
  if (opponentLandsMatch) {
    const needed = numberWordToInt(opponentLandsMatch[1]);
    if (!controller || !allSeats || needed === undefined) return true;
    const opponentLands = allSeats.filter((other) => other.id !== controller.id).reduce((sum, other) => sum + other.board.battlefield.filter((permanent) => permanent.typeLine.includes("Land")).length, 0);
    return opponentLands < needed;
  }
  // "This land enters tapped unless you have two or more opponents." (Vault of Champions, the Battlebond friend-or-foe lands)
  const opponentCountMatch = text.match(/enters (?:the battlefield )?tapped unless you have (\w+) or more opponents/);
  if (opponentCountMatch) {
    const needed = numberWordToInt(opponentCountMatch[1]);
    if (!controller || !allSeats || needed === undefined) return true;
    return allSeats.filter((other) => other.id !== controller.id && !other.hasLost).length < needed;
  }
  const shockCost = shocklandPayLifeAmount(text);
  if (shockCost !== undefined) {
    return Boolean(controller) && (controller!.life ?? 40) <= SHOCKLAND_MINIMUM_SAFE_LIFE;
  }
  const checkLandMatch = text.match(/enters (?:the battlefield )?tapped unless you control an? ([a-z]+) or an? ([a-z]+)/);
  if (checkLandMatch) {
    const types = [checkLandMatch[1], checkLandMatch[2]].map(capitalizeWord);
    return !controller || !controlsLandType(controller, types);
  }
  if (text.includes("enters tapped unless you control two or more basic lands")) {
    return !controller || controller.board.battlefield.filter((permanent) => basicLandTypes(permanent).length > 0).length < 2;
  }
  // "This land enters tapped unless you control a Swamp." (Castle Locthwain) — a single land type, no
  // "or"; and "...unless you control three or more other Swamps." (Witch's Cottage). Both used to fall to
  // the catch-all at the bottom, which matches the literal "enters tapped" prefix and so always tapped them.
  const singleTypeMatch = text.match(/enters (?:the battlefield )?tapped unless you control an? ([a-z]+)\b(?! or\b)/);
  if (singleTypeMatch) return !controller || !controlsLandType(controller, [capitalizeWord(singleTypeMatch[1])]);
  const countOtherTypeMatch = text.match(/enters (?:the battlefield )?tapped unless you control (a|one|two|three|four|five|\d+) or more other ([a-z]+?)s?\b/);
  if (countOtherTypeMatch) {
    const needed = numberWordToInt(countOtherTypeMatch[1]) ?? 1;
    const wantedType = capitalizeWord(countOtherTypeMatch[2]);
    const have = controller ? controller.board.battlefield.filter((permanent) => permanent.id !== card.id && basicLandTypes(permanent).includes(wantedType)).length : 0;
    return have < needed;
  }
  // Fastlands ("...unless you control two or FEWER other lands", Blackcleave Cliffs, ...) and
  // slowlands ("...two or MORE other lands", Deserted Beach, ...) — heavily played efficient duals
  // with no handling at all before this: the generic `/\benters tapped\b/` catch-all below matched
  // the literal "enters tapped unless..." prefix unconditionally, so both cycles always entered
  // tapped regardless of board state, including turn-1 fastlands that should have come in untapped.
  const otherLandsMatch = text.match(/enters (?:the battlefield )?tapped unless you control two or (fewer|more) other lands\b/);
  if (otherLandsMatch) {
    const otherLandCount = controller ? controller.board.battlefield.filter((permanent) => permanent.typeLine.includes("Land")).length : 0;
    return otherLandsMatch[1] === "fewer" ? otherLandCount > 2 : otherLandCount < 2;
  }
  return (
    /\benters tapped\b/.test(text) ||
    /\benters the battlefield tapped\b/.test(text) ||
    /\benters the battlefield tapped unless\b/.test(text) ||
    knownEntersTappedCards.has(card.name)
  );
}

function controlsLandType(seat: PlayerSeat, types: string[]) {
  return seat.board.battlefield.some((permanent) => basicLandTypes(permanent).some((type) => types.includes(type)));
}

const knownEntersTappedCards = new Set([
  "Bojuka Bog",
  "Arcane Sanctum",
  "Contaminated Aquifer",
  "Halimar Depths",
  "Myriad Landscape",
  "Prairie Stream",
  "Temple of Deceit",
  "Temple of Silence",
  "Thriving Heath",
  "Thriving Isle",
  "Thriving Moor"
]);

export function landTurnKey(seatId: string, turn: number) {
  return `${turn}:${seatId}`;
}

// Land drops: one per turn, plus one for each "You may play an additional land on each of your turns." (Loot, Exuberant Explorer, Exploration).
export function landDropsAllowed(seat: PlayerSeat): number {
  return 1 + seat.board.battlefield.filter((card) => !card.abilitiesStripped && /\byou may play an additional land on each of your turns\b/i.test(card.oracleText)).length;
}

// How many lands a seat has played this turn, kept in a set of keys: the base key for the first, then "<key>:2", "<key>:3", ...
export function landPlaysMade(plays: Set<string>, key: string): number {
  let made = plays.has(key) ? 1 : 0;
  while (plays.has(`${key}:${made + 1}`)) made += 1;
  return made;
}

export function recordLandPlay(plays: Set<string>, key: string): void {
  const made = landPlaysMade(plays, key);
  plays.add(made === 0 ? key : `${key}:${made + 1}`);
}

