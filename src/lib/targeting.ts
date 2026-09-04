import type { GameSession, PlayerSeat, VisibleCard } from "./types";
import { effectivePower, effectiveToughness } from "./counters";
import { matchesTargetType, type RemovalTargetType } from "./removalSpells";
import { hasKeyword, protectionColors } from "./keywords";

// The reusable "who/what can this effect legally target" + "what would the AI pick" split this
// engine has never had (see AppFlow.tsx's own chooseRemovalTarget/chooseCounterTarget/... comments,
// which say outright that resolution has no target-selection UI). legalTargets is the single source
// of truth for BOTH a human's clickable pool and the resolution-time re-check that fizzles a spell
// whose target became illegal; preferredTargets is ONLY ever the AI's answer to that same prompt —
// nothing else should call it once a card's category is migrated onto this module (see the phased
// plan: legality gets shared, preference stays a leaf used exactly once).

export type TargetZone = "battlefield" | "graveyard" | "library" | "player";

export type TargetController = "any" | "you" | "opponent";

// Mirrors chooseRemovalTarget's own excludedColors param (full color words, not W/U/B/R/G codes) —
// kept as a separate small map here rather than importing AppFlow.tsx's PROTECTION_COLOR_CODE,
// since AppFlow.tsx will import THIS module (see the file-level note below on the import direction).
const PROTECTION_COLOR_CODE: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };

export interface TargetSpec {
  // Distinguishes sibling slots on the same spell ("target creature" and "another target creature")
  // so excludedCardIds/fizzle-checks can tell them apart; not shown to the player.
  id: string;
  zone: TargetZone;
  // Only meaningful for zone "battlefield"/"graveyard" — a player target has no permanent type.
  permanentType?: RemovalTargetType;
  controller: TargetController;
  min: number;
  max: number;
  // "Another target creature" — the spell's own source, or an earlier slot's already-chosen card.
  excludedCardIds?: string[];
  excludedColors?: string[];
  artifactsExcluded?: boolean;
  basicsExcluded?: boolean;
  prompt: string;
}

export interface LegalCardTarget {
  kind: "card";
  seatId: string;
  card: VisibleCard;
}

export interface LegalPlayerTarget {
  kind: "player";
  seatId: string;
}

export type LegalTarget = LegalCardTarget | LegalPlayerTarget;

export type ChosenTarget = { kind: "card"; seatId: string; cardId: string } | { kind: "player"; seatId: string };

function controllerMatches(controller: TargetController, casterSeatId: string, seatId: string): boolean {
  if (controller === "you") return seatId === casterSeatId;
  if (controller === "opponent") return seatId !== casterSeatId;
  return true;
}

// A permanent's own printed protection plus whatever protection an attached Aura/Equipment grants
// it — the same union AppFlow.tsx's allProtectionColors computes, reproduced here rather than
// imported since AppFlow.tsx is this module's consumer, not the other way around (importing back
// from it would be circular).
function cardProtectionColors(card: VisibleCard): string[] {
  return Array.from(new Set([...protectionColors(card.oracleText), ...(card.grantedProtectionColors ?? [])]));
}

function isProtectedFrom(protectedCard: VisibleCard, sourceCard: VisibleCard): boolean {
  const colors = cardProtectionColors(protectedCard);
  if (colors.length === 0) return false;
  return colors.some((color) => sourceCard.colors.includes(PROTECTION_COLOR_CODE[color]));
}

function cardHasKeyword(card: VisibleCard, keyword: string): boolean {
  // Layer 6: a creature that's lost all abilities has neither its printed keywords nor any granted
  // ones — same short-circuit as AppFlow.tsx's own hasKeyword.
  if (card.abilitiesStripped) return false;
  return hasKeyword(card.oracleText, keyword) || Boolean(card.grantedKeywords?.includes(keyword));
}

// Rule 601.2c/702.11c/702.12b: hexproof/shroud/protection all make a permanent an ILLEGAL target,
// not just a bad one — hexproof only blocks opponents, shroud and protection block everyone
// (including the caster targeting their own thing, though that's rare in practice).
function isLegalPermanentTarget(card: VisibleCard, casterSeatId: string, ownerSeatId: string, sourceCard: VisibleCard): boolean {
  if (cardHasKeyword(card, "shroud")) return false;
  if (cardHasKeyword(card, "hexproof") && ownerSeatId !== casterSeatId) return false;
  if (isProtectedFrom(card, sourceCard)) return false;
  if (card.phasedOut) return false;
  return true;
}

function matchesSpecFilters(card: VisibleCard, spec: TargetSpec): boolean {
  if (spec.permanentType && !matchesTargetType(card, spec.permanentType)) return false;
  if (spec.artifactsExcluded && card.typeLine.includes("Artifact")) return false;
  if (spec.basicsExcluded && card.typeLine.includes("Basic")) return false;
  if (spec.excludedColors && spec.excludedColors.length > 0) {
    const codes = spec.excludedColors.map((color) => PROTECTION_COLOR_CODE[color]).filter(Boolean);
    if (card.colors.some((color) => codes.includes(color))) return false;
  }
  if (spec.excludedCardIds?.includes(card.id)) return false;
  return true;
}

// The single source of truth for what a human may click AND what resolution re-checks for
// fizzling (rule 608.2b) — see the file-level comment. sourceCard is the spell/ability doing the
// targeting (needed for protection checks); omit it for effects with no printed color (tokens,
// activated abilities with colorless sources) since isProtectedFrom is vacuously false for those.
export function legalTargets(session: GameSession, casterSeatId: string, spec: TargetSpec, sourceCard: VisibleCard): LegalTarget[] {
  if (spec.zone === "player") {
    return session.seats
      .filter((seat) => !seat.hasLost && controllerMatches(spec.controller, casterSeatId, seat.id))
      .map((seat): LegalPlayerTarget => ({ kind: "player", seatId: seat.id }));
  }

  if (spec.zone === "library") {
    const targets: LegalCardTarget[] = [];
    for (const seat of session.seats) {
      if (!controllerMatches(spec.controller, casterSeatId, seat.id)) continue;
      for (const card of seat.library ?? []) {
        if (!matchesSpecFilters(card, spec)) continue;
        targets.push({ kind: "card", seatId: seat.id, card });
      }
    }
    return targets;
  }

  const targets: LegalCardTarget[] = [];
  for (const seat of session.seats) {
    if (!controllerMatches(spec.controller, casterSeatId, seat.id)) continue;
    const pool = spec.zone === "graveyard" ? seat.board.graveyard ?? [] : seat.board.battlefield;
    for (const card of pool) {
      if (!matchesSpecFilters(card, spec)) continue;
      // Hexproof/shroud/protection/phasing only apply to permanents actually on the battlefield —
      // a card sitting in a graveyard has none of those concerns.
      if (spec.zone === "battlefield" && !isLegalPermanentTarget(card, casterSeatId, seat.id, sourceCard)) continue;
      targets.push({ kind: "card", seatId: seat.id, card });
    }
  }
  return targets;
}

// Resolution-time re-check (rule 608.2b): a spell/ability whose target(s) all became illegal since
// they were chosen (removed, gained hexproof, phased out, ...) fizzles instead of resolving.
export function targetsStillLegal(session: GameSession, casterSeatId: string, spec: TargetSpec, sourceCard: VisibleCard, chosen: ChosenTarget[]): boolean {
  const pool = legalTargets(session, casterSeatId, spec, sourceCard);
  return chosen.every((target) =>
    target.kind === "player"
      ? pool.some((legal) => legal.kind === "player" && legal.seatId === target.seatId)
      : pool.some((legal) => legal.kind === "card" && legal.seatId === target.seatId && legal.card.id === target.cardId)
  );
}

// What an AI-controlled seat answers for a target prompt a human would otherwise click through —
// deliberately the ONLY consumer of "preference" logic; every category migrated onto this module
// deletes its own old chooseXTarget heuristic and calls this instead. Each hint below is a named
// stand-in for one (or several identical) existing heuristic's preference half — see the targeting
// plan for which AppFlow.tsx helper each replaces.
export type PreferenceHint =
  | "biggest_opponent_threat"
  | "biggest_own_creature"
  | "smallest_own_creature"
  | "lowest_life_opponent"
  | "highest_life_opponent"
  | "highest_mana_value"
  | "self";

function seatOf(session: GameSession, seatId: string): PlayerSeat | undefined {
  return session.seats.find((seat) => seat.id === seatId);
}

function combinedPT(card: VisibleCard): number {
  return effectivePower(card) + effectiveToughness(card);
}

export function preferredTargets(
  session: GameSession,
  casterSeatId: string,
  spec: TargetSpec,
  sourceCard: VisibleCard,
  hint: PreferenceHint
): ChosenTarget[] {
  const pool = legalTargets(session, casterSeatId, spec, sourceCard);
  if (pool.length === 0) return [];

  if (spec.zone === "player") {
    const players = pool.filter((target): target is LegalPlayerTarget => target.kind === "player");
    if (hint === "self") {
      const self = players.find((target) => target.seatId === casterSeatId);
      return self ? [self] : players.slice(0, spec.max);
    }
    const opponents = players.filter((target) => target.seatId !== casterSeatId);
    const ranked = opponents.length > 0 ? opponents : players;
    const bySeat = (target: LegalPlayerTarget) => seatOf(session, target.seatId);
    const best =
      hint === "lowest_life_opponent"
        ? ranked.reduce((a, b) => ((bySeat(b)?.life ?? 0) < (bySeat(a)?.life ?? 0) ? b : a))
        : ranked.reduce((a, b) => ((bySeat(b)?.life ?? 0) > (bySeat(a)?.life ?? 0) ? b : a));
    return [best].slice(0, Math.max(spec.max, 1));
  }

  const cards = pool.filter((target): target is LegalCardTarget => target.kind === "card");
  const own = cards.filter((target) => target.seatId === casterSeatId);
  const opponents = cards.filter((target) => target.seatId !== casterSeatId);

  let ranked: LegalCardTarget[];
  switch (hint) {
    case "biggest_own_creature":
    case "smallest_own_creature":
      ranked = own.length > 0 ? own : cards;
      break;
    case "biggest_opponent_threat":
    case "lowest_life_opponent":
    case "highest_life_opponent":
      ranked = opponents.length > 0 ? opponents : cards;
      break;
    default:
      ranked = cards;
  }

  const compareBy = (metric: (card: VisibleCard) => number, direction: "max" | "min") => (a: LegalCardTarget, b: LegalCardTarget) =>
    direction === "max" ? (metric(b.card) > metric(a.card) ? b : a) : metric(b.card) < metric(a.card) ? b : a;

  const picker =
    hint === "smallest_own_creature"
      ? compareBy(combinedPT, "min")
      : hint === "highest_mana_value"
        ? compareBy((card) => card.manaValue, "max")
        : compareBy(combinedPT, "max");

  const chosen: LegalCardTarget[] = [];
  let remaining = ranked;
  const count = Math.min(Math.max(spec.max, 1), remaining.length);
  for (let i = 0; i < count; i++) {
    const best = remaining.reduce(picker);
    chosen.push(best);
    remaining = remaining.filter((target) => target !== best);
  }
  return chosen.map((target) => ({ kind: "card", seatId: target.seatId, cardId: target.card.id }));
}
