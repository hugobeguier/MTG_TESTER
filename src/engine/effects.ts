// Spell/ability effect resolution, moved verbatim from components/AppFlow.tsx: applySpellExtraEffect, applyRemovalEffect, applyZoneEffect,
// applyPrimitiveAction, generic modal and counter-accumulation effects, targeting choosers, discard/sacrifice/mill/surveil/look-dig
// helpers, draw helpers, library-look workflows, deferred choices.
// Part of a deliberate import cycle with the other resolution modules (function declarations only).

import { applyDrawThenLand, resolveScriptedChoice } from "@/engine/cardScripts";
import { manaValueFromManaCost } from "@/engine/costs";
import { PROTECTION_COLOR_CODE, addDamageShieldsFromSpec, applyCombatDamageToTarget, dealDamageToCreature, hasFlying, hasHexproof, hasIndestructible, hasShroud, isProtectedFrom, playerCantLose, playerHasHexproof } from "@/engine/damage";
import { applyDevour, applyGraveyardReturn, applyGraveyardReturnPicked, destroyCreatures, finishDevour, moveCardAcrossSeats, moveLibraryCardToDestination } from "@/engine/entry";
import { chooseManaSourcesForCost, manaChoicesForCard, manaColorForBasicLand, normalizeManaColors, spendManaSources } from "@/engine/mana";
import { COMMANDER_STARTING_LIFE, basicLandTypes, capitalizeWord, hasKeyword, isBasicLandCard, isLandCard, numberWordToInt } from "@/engine/shared";
import type { TokenSpec } from "@/engine/tokens";
import { createCopyTokenForSeat, createCopyTokensForSeat, createTokensForSeat, parseCreateTokenSpecs, predefinedTokenSpec } from "@/engine/tokens";
import { commonTriggerEffect, phaseEvent, resolveTriggerEffect } from "@/engine/triggers";
import type { PendingAction, PendingRuleChoice, TriggerEffect } from "@/engine/types";
import type { GraveyardReturnOptions } from "@/engine/zones";
import { applyCounterDelta, applyCounterDeltaAtSession, applyEnterAsCopyTarget, applyGraveyardExile, applyGraveyardToLibrary, applyPutCardsOnLibrary, changeControlWithinBattlefield, findPermanentById, moveCardBetweenVisibleZones, moveTopLibraryCardToHand, possessive, putLookedAtCardsInGraveyard, queuePlayerChoice, reorderTopLibraryCards, resetForZoneChange, rulesEvent, shuffleCards } from "@/engine/zones";
import type { StaticCondition } from "@/lib/characteristics";
import { countMatchingPermanents, permanentMatchesQualifier } from "@/lib/characteristics";
import { counterCount, effectivePower, effectiveToughness } from "@/lib/counters";
import { parseDamagePrevention } from "@/lib/damagePrevention";
import { wardAmount as cardWardAmount, wardLifeAmount } from "@/lib/keywords";
import { cardMatchesTypeFilter, etbEffectText, hasGraveyardShuffleReplacement, oracleClauses, parseModalHeader, parseSpellModalHeader } from "@/lib/oracleClauses";
import type { DynamicAmount, RemovalEffect, RemovalTargetType } from "@/lib/removalSpells";
import { matchesTargetType, parseRemovalEffect } from "@/lib/removalSpells";
import type { SpellExtraEffect } from "@/lib/spellExtras";
import { parseSpellExtraEffects } from "@/lib/spellExtras";
import { scoreSurveil } from "@/lib/surveilScoring";
import { targetedEffectSpec } from "@/lib/targetedEffects";
import type { ChosenTarget } from "@/lib/targeting";
import { legalTargets } from "@/lib/targeting";
import { hasCardType } from "@/lib/typeGrants";
import type { GameSession, ManaColor, PlayerSeat, VisibleCard } from "@/lib/types";
import type { LookDigEffect, RegrowTargetType, ZoneEffect } from "@/lib/zoneEffects";
import { parseZoneEffect } from "@/lib/zoneEffects";

// "Choose any number of permanents and/or players that have a counter on them, then give each
// another counter of a kind already there." No choice UI exists for this yet, so it proliferates
// everything eligible (every permanent's existing counters, and poison/experience counters, the
// two player-level counters this engine tracks — experienceCounters was previously missed here even
// though it's tracked the same way poison is, meaning a Meren of Clan Nel Toth player never actually
// benefited from proliferating their own experience counters).
export function resolveProliferate(session: GameSession): GameSession {
  return {
    ...session,
    seats: session.seats.map((seat) => ({
      ...seat,
      poison: (seat.poison ?? 0) > 0 ? (seat.poison ?? 0) + 1 : seat.poison,
      experienceCounters: (seat.experienceCounters ?? 0) > 0 ? (seat.experienceCounters ?? 0) + 1 : seat.experienceCounters,
      board: {
        ...seat.board,
        battlefield: seat.board.battlefield.map((card) =>
          card.counters && card.counters.length > 0 ? { ...card, counters: card.counters.map((counter) => ({ ...counter, count: counter.count + 1 })) } : card
        )
      }
    })),
    events: [
      { id: crypto.randomUUID(), at: new Date().toISOString(), message: "Proliferate: every permanent and player with a counter gets one more of each kind already there.", detail: "Rules action" },
      ...session.events
    ]
  };
}

// Same deterministic "spend what you'd miss least" pattern as chooseSacrificeTarget, extended to a
// fixed-count sacrifice (Westvale Abbey's "Sacrifice five creatures") — spends tokens before real
// cards, lowest combined power+toughness first within each group, and returns undefined (not a
// legal activation) if there aren't enough creatures to pay the full count.
// A sacrifice cost's descriptor ("Servo", "black creature", "Vampire or Zombie") checked with the shared
// qualifier matcher, so colors and "or" alternatives work — a plain type-line substring never matched
// "another black creature" (Ayara) or "another Vampire or Zombie" (Kalitas).
export function matchesSacrificeFilter(card: VisibleCard, filter: string | undefined): boolean {
  if (!filter) return true;
  return filter
    .toLowerCase()
    .split(/\s+or\s+/)
    .some((alternative) => permanentMatchesQualifier(card, alternative.trim()));
}

// A non-creature sacrifice cost ("Sacrifice an artifact / a land / a permanent / a Treasure"): does this permanent qualify?
export function matchesPermanentSacrificeFilter(card: VisibleCard, filter: string | undefined): boolean {
  if (!filter || filter === "permanent") return true;
  if (filter === "nonland permanent") return !card.typeLine.includes("Land");
  // "creature or artifact": any one alternative is enough.
  return filter
    .toLowerCase()
    .split(/\s+or\s+/)
    .some((alternative) => alternative === "permanent" || (alternative === "nonland permanent" ? !card.typeLine.includes("Land") : `${card.typeLine} ${(card.grantedTypes ?? []).join(" ")}`.toLowerCase().includes(alternative.trim())));
}

export function chooseSacrificeTargets(seat: PlayerSeat, typeFilter: string | undefined, count: number, excludeCardId?: string, anyPermanent = false): VisibleCard[] | undefined {
  const creatures = seat.board.battlefield.filter((card) =>
    anyPermanent
      ? card.id !== excludeCardId && matchesPermanentSacrificeFilter(card, typeFilter)
      : card.typeLine.includes("Creature") && card.id !== excludeCardId && matchesSacrificeFilter(card, typeFilter)
  );
  if (creatures.length < count) return undefined;
  const byValue = (card: VisibleCard) => effectivePower(card) + effectiveToughness(card);
  const tokens = [...creatures.filter((card) => card.token)].sort((a, b) => byValue(a) - byValue(b));
  const nonTokens = [...creatures.filter((card) => !card.token)].sort((a, b) => byValue(a) - byValue(b));
  return [...tokens, ...nonTokens].slice(0, count);
}

// "creature or planeswalker" / "creature" / "artifact or enchantment" / ... (Plaguecrafter's own
// exact wording, and the same "each player sacrifices a(n) X of their choice" template on similar
// mass-edict effects) — the type-word vocabulary matched here mirrors removalSpells.ts's own
// TARGET_TYPE_PATTERNS rather than duplicating a separate list.
export function matchesEachPlayerSacrificeFilter(card: VisibleCard, typeFilter: string): boolean {
  return typeFilter.split(/\s+or\s+/).some((word) => {
    const trimmed = word.trim();
    if (trimmed === "creature") return card.typeLine.includes("Creature");
    if (trimmed === "planeswalker") return card.typeLine.includes("Planeswalker");
    if (trimmed === "artifact") return card.typeLine.includes("Artifact");
    if (trimmed === "enchantment") return card.typeLine.includes("Enchantment");
    if (trimmed === "land") return card.typeLine.includes("Land");
    if (trimmed === "nontoken creature") return card.typeLine.includes("Creature") && !card.token;
    if (trimmed === "permanent") return true;
    if (trimmed === "nonland permanent") return !card.typeLine.includes("Land");
    return false;
  });
}

// Same "least costly to lose" bias as chooseAnnihilatorSacrifices above, scoped to whatever type
// filter this specific edict names instead of "everything."
export function choosePlaguecrafterSacrifice(seat: PlayerSeat, typeFilter: string): VisibleCard | undefined {
  const candidates = seat.board.battlefield.filter((card) => matchesEachPlayerSacrificeFilter(card, typeFilter));
  if (candidates.length === 0) return undefined;
  const nonCommanders = candidates.filter((card) => !card.commander);
  const pool = nonCommanders.length > 0 ? nonCommanders : candidates;
  return pool.reduce((best, card) => {
    if (Boolean(card.token) !== Boolean(best.token)) return card.token ? card : best;
    return card.manaValue < best.manaValue ? card : best;
  });
}

// A human who must discard with a real choice (more cards than the discard) chooses; the resolver records it and a component effect asks.
export function deferHumanDiscard(session: GameSession, seatId: string, count: number, sourceName: string, thenDraw?: number): GameSession | undefined {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat || seat.kind !== "human" || seat.board.hand.length <= count) return undefined;
  return { ...session, pendingDiscardChoices: [...(session.pendingDiscardChoices ?? []), { seatId, count, sourceName, thenDraw }] };
}

// Hand cards that can pay a "Discard a [Type] card" cost (Fauna Shaman: creature cards only); any card when untyped.
export function discardableHandCards(seat: PlayerSeat, cardType?: string): VisibleCard[] {
  return cardType ? seat.board.hand.filter((card) => hasCardType(card, cardType)) : seat.board.hand;
}

export function chooseWorstHandCardToDiscard(seat: PlayerSeat, cardType?: string): VisibleCard | undefined {
  const pool = discardableHandCards(seat, cardType);
  if (pool.length === 0) return undefined;
  return pool.reduce((worst, card) => (card.manaValue > worst.manaValue ? card : worst));
}

// Flips a transform double-faced permanent to its other face (Westvale Abbey -> Ormendahl, Profane
// Prince). Rule 302.6/711.4c: transforming isn't leaving and re-entering the battlefield, so a
// permanent that's been under the same controller's control since the turn began is never
// summoning sick just because transforming made it a creature for the first time.
export function transformPermanent(session: GameSession, seatId: string, cardId: string, sourceCardName: string, untapAfter: boolean): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const card = seat?.board.battlefield.find((item) => item.id === cardId);
  if (!seat || !card || !card.faces || card.faces.length !== 2) return session;
  const currentFaceIndex = card.unlockedFaceIndices?.[0] ?? 0;
  const nextFaceIndex = currentFaceIndex === 0 ? 1 : 0;
  const nextFace = card.faces[nextFaceIndex];
  const transformed: VisibleCard = {
    ...card,
    name: nextFace.name,
    typeLine: nextFace.typeLine,
    oracleText: nextFace.oracleText,
    manaCost: nextFace.manaCost,
    power: nextFace.power,
    toughness: nextFace.toughness,
    loyalty: nextFace.loyalty,
    imageUris: nextFace.imageUris ?? card.imageUris,
    unlockedFaceIndices: [nextFaceIndex],
    tapped: untapAfter ? false : card.tapped,
    summoningSick: false
  };
  return {
    ...session,
    seats: session.seats.map((item) =>
      item.id === seatId
        ? { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((c) => (c.id === cardId ? transformed : c)) } }
        : item
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${seat.name} transforms ${sourceCardName} into ${nextFace.name}.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

// This engine has no generic multi-target selection UI, so targeting for destroy/exile spells is
// resolved deterministically for both agents and humans — prefer an opponent's permanent over the
// caster's own, then the biggest threat by combined effective power+toughness (mirrors
// chooseAuraAttachTarget's heuristic).
export function chooseRemovalTarget(
  session: GameSession,
  casterSeatId: string,
  targetType: RemovalTargetType,
  sourceCard: VisibleCard,
  excludedColors: string[] = [],
  artifactsExcluded: boolean = false,
  basicsExcluded: boolean = false,
  // "Destroy" only (never passed for exile/bounce, where indestructible is irrelevant): an
  // indestructible permanent is still a LEGAL target (rule 702.12b doesn't make it illegal, just
  // pointless to destroy), but picking one over an equally available non-indestructible target
  // wastes the whole spell for nothing. Same preference shape as the existing ward avoidance just
  // below. Reported live as Krosan Grip auto-targeting Darksteel Citadel (indestructible) while an
  // opponent's non-indestructible artifact was sitting right there.
  avoidIndestructible: boolean = false,
  // "toughness 4 or greater" (Destroy Evil): candidates below this toughness aren't legal targets.
  minToughness?: number,
  // "target creature an opponent controls" (Ravenous Chupacabra): only other players' permanents are legal — never a fallback to your own.
  opponentOnly: boolean = false
): { seatId: string; card: VisibleCard } | undefined {
  const excludedColorCodes = excludedColors.map((color) => PROTECTION_COLOR_CODE[color]).filter(Boolean);
  const candidates: Array<{ seatId: string; card: VisibleCard }> = [];
  for (const seat of session.seats) {
    if (opponentOnly && seat.id === casterSeatId) continue;
    for (const card of seat.board.battlefield) {
      if (!matchesTargetType(card, targetType)) continue;
      if (artifactsExcluded && card.typeLine.includes("Artifact")) continue;
      if (basicsExcluded && card.typeLine.includes("Basic")) continue;
      if (minToughness !== undefined && effectiveToughness(card) < minToughness) continue;
      if (excludedColorCodes.length > 0 && card.colors.some((color) => excludedColorCodes.includes(color))) continue;
      // Rule 601.2c/702.11c/702.12b: hexproof/shroud/protection all make a permanent an illegal
      // target, not just a bad one — hexproof only blocks opponents, shroud and protection block
      // everyone (including the caster targeting their own thing, though that's rare in practice).
      if (hasShroud(card)) continue;
      if (hasHexproof(card) && seat.id !== casterSeatId) continue;
      if (isProtectedFrom(card, sourceCard)) continue;
      if (card.phasedOut) continue;
      candidates.push({ seatId: seat.id, card });
    }
  }
  if (candidates.length === 0) return undefined;

  const opponentCandidates = candidates.filter((entry) => entry.seatId !== casterSeatId);
  // Never fall back to the caster's OWN permanents (Exorcise exiling my own Patchwork Banner, Swords on my own commander): with only own
  // targets left the deterministic chooser has no target, so the spell is not offered/cast. A human's explicit pick bypasses this chooser.
  // Humans keep the fallback: a legal cast whose only legal targets are their own permanents must stay castable.
  const casterIsHuman = session.seats.find((seat) => seat.id === casterSeatId)?.kind === "human";
  const pool = opponentCandidates.length > 0 || !casterIsHuman ? opponentCandidates : candidates;
  if (pool.length === 0) return undefined;
  // Ward doesn't make a target illegal, just costly (see payWardIfNeeded) — prefer a ward-free
  // target when one is equally available, so the caster isn't paying a tax for no reason.
  const unwardedPool = pool.filter((entry) => cardWardAmount(entry.card.oracleText) === undefined);
  const wardFilteredPool = unwardedPool.length > 0 ? unwardedPool : pool;
  const destructiblePool = avoidIndestructible ? wardFilteredPool.filter((entry) => !hasIndestructible(entry.card)) : wardFilteredPool;
  const finalPool = destructiblePool.length > 0 ? destructiblePool : wardFilteredPool;
  return finalPool.reduce((a, b) => (effectivePower(b.card) + effectiveToughness(b.card) > effectivePower(a.card) + effectiveToughness(a.card) ? b : a));
}

// "Tap/untap target X" as a spell's/ability's OWN effect (not an activated ability's own cost —
// that's a payment, handled entirely separately by payGenericTapCost etc.). Reuses
// chooseRemovalTarget's own per-card eligibility rules (shroud/hexproof/protection/phasedOut all
// make a permanent an illegal target the same way regardless of what the effect does), but with its
// own targeting bias: tap prefers an OPPONENT's biggest currently-untapped creature (removing a
// blocker/attacker, the same disruptive intent chooseRemovalTarget already assumes for real
// removal); untap prefers the CASTER's OWN biggest currently-tapped permanent (almost always
// self-beneficial — extra mana, a surprise blocker). Both fall back to the full candidate pool
// (ignoring the tapped-state/own-vs-opponent preference in turn) rather than refusing outright, the
// same graceful-degradation shape chooseRemovalTarget/chooseCounterTarget already use.
function chooseTapUntapTarget(
  session: GameSession,
  casterSeatId: string,
  targetType: RemovalTargetType,
  sourceCard: VisibleCard,
  tapping: boolean
): { seatId: string; card: VisibleCard } | undefined {
  const candidates: Array<{ seatId: string; card: VisibleCard }> = [];
  for (const seat of session.seats) {
    for (const card of seat.board.battlefield) {
      if (!matchesTargetType(card, targetType)) continue;
      if (hasShroud(card)) continue;
      if (hasHexproof(card) && seat.id !== casterSeatId) continue;
      if (isProtectedFrom(card, sourceCard)) continue;
      if (card.phasedOut) continue;
      candidates.push({ seatId: seat.id, card });
    }
  }
  if (candidates.length === 0) return undefined;

  const usefulPool = candidates.filter((entry) => entry.card.tapped !== tapping);
  const stateFiltered = usefulPool.length > 0 ? usefulPool : candidates;
  const preferredPool = stateFiltered.filter((entry) => (tapping ? entry.seatId !== casterSeatId : entry.seatId === casterSeatId));
  const pool = preferredPool.length > 0 ? preferredPool : stateFiltered;
  return pool.reduce((a, b) => (effectivePower(b.card) + effectiveToughness(b.card) > effectivePower(a.card) + effectiveToughness(a.card) ? b : a));
}

function applyTapUntapPrimitive(session: GameSession, casterSeatId: string, sourceCard: VisibleCard, targetType: RemovalTargetType, tapping: boolean): GameSession {
  const target = chooseTapUntapTarget(session, casterSeatId, targetType, sourceCard, tapping);
  if (!target) return noLegalTargetEvent(session, casterSeatId, sourceCard.name);
  const warded = payWardIfNeeded(session, casterSeatId, target.card, sourceCard.name);
  if (warded.countered) return warded.session;
  return {
    ...warded.session,
    seats: warded.session.seats.map((seat) =>
      seat.id === target.seatId
        ? { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === target.card.id ? { ...card, tapped: tapping } : card)) } }
        : seat
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: casterSeatId,
        message: `${sourceCard.name} ${tapping ? "taps" : "untaps"} ${target.card.name}.`,
        detail: "Rules action"
      },
      ...warded.session.events
    ]
  };
}

// Same deterministic-heuristic targeting as chooseRemovalTarget, applied to a triggered ability's
// "put a counter on target creature": +1/+1 counters reinforce a threat, so prefer the trigger
// controller's own biggest creature; every other counter kind (-1/-1, and non-+1/+1 kinds like
// Athreos, Shroud-Veiled's coin counter — a marker the controller wants on an opponent's best
// creature, since it's what lets them eventually steal or shrink it) is removal-or-value-adjacent,
// so it prefers an opponent's biggest creature instead. Falls back to the full candidate pool if the
// preferred side has no creatures.
export function chooseCounterTarget(
  session: GameSession,
  controllerSeatId: string,
  counterKind: string,
  restrictToOwnCreatures: boolean
): { seatId: string; card: VisibleCard } | undefined {
  const candidates: Array<{ seatId: string; card: VisibleCard }> = [];
  for (const seat of session.seats) {
    if (restrictToOwnCreatures && seat.id !== controllerSeatId) continue;
    for (const card of seat.board.battlefield) {
      if (card.typeLine.includes("Creature")) candidates.push({ seatId: seat.id, card });
    }
  }
  if (candidates.length === 0) return undefined;

  const preferOwn = counterKind === "+1/+1";
  const preferredPool = restrictToOwnCreatures
    ? candidates
    : candidates.filter((entry) => (preferOwn ? entry.seatId === controllerSeatId : entry.seatId !== controllerSeatId));
  const pool = preferredPool.length > 0 ? preferredPool : candidates;
  return pool.reduce((a, b) => (effectivePower(b.card) + effectiveToughness(b.card) > effectivePower(a.card) + effectiveToughness(a.card) ? b : a));
}

type DamageTarget = { kind: "player"; seat: PlayerSeat } | { kind: "creature"; seatId: string; card: VisibleCard };

// Same "no target-selection UI" deterministic heuristic as chooseRemovalTarget: take a lethal kill
// on an opponent's creature when one's available, otherwise send "any target" damage to the
// lowest-life opponent, otherwise chip the biggest opposing creature (for creature-only damage),
// otherwise there's no legal target.
export function chooseDamageTarget(session: GameSession, casterSeatId: string, amount: number, targetType: "any" | "creature" | "player", sourceCard: VisibleCard): DamageTarget | undefined {
  const opponents = session.seats.filter((seat) => seat.id !== casterSeatId && !seat.hasLost);
  // A hexproof player (Metropolis Reformer's "You have hexproof.") can't be chosen; their creatures still can.
  const targetablePlayers = opponents.filter((seat) => !playerHasHexproof(seat));

  // "target player or planeswalker" can never legally resolve against a creature — checked before
  // any of the creature-candidate logic below, unlike "any target" which prefers a lethal creature
  // kill when one's available.
  if (targetType === "player") {
    if (targetablePlayers.length === 0) return undefined;
    const lowestLife = targetablePlayers.reduce((a, b) => (b.life < a.life ? b : a));
    return { kind: "player", seat: lowestLife };
  }

  const creatureCandidates: Array<{ seatId: string; card: VisibleCard }> = [];
  for (const seat of opponents) {
    for (const card of seat.board.battlefield) {
      if (card.typeLine.includes("Creature") && !hasShroud(card) && !hasHexproof(card) && !isProtectedFrom(card, sourceCard)) {
        creatureCandidates.push({ seatId: seat.id, card });
      }
    }
  }

  const allLethal = creatureCandidates.filter((entry) => !hasIndestructible(entry.card) && effectiveToughness(entry.card) <= amount);
  // "Any target" burn is never spent on a vanilla token or a 1/1 body while a player can take it instead (Lightning Strike on a Servo).
  const worthKilling = (entry: { card: VisibleCard }) => !(entry.card.token && !entry.card.oracleText.trim()) && (entry.card.manaValue >= 2 || effectivePower(entry.card) >= 2 || entry.card.oracleText.trim().length > 0);
  const lethalCandidates = targetType === "any" && targetablePlayers.length > 0 ? allLethal.filter(worthKilling) : allLethal;
  if (lethalCandidates.length > 0) {
    const best = lethalCandidates.reduce((a, b) =>
      effectivePower(b.card) + effectiveToughness(b.card) > effectivePower(a.card) + effectiveToughness(a.card) ? b : a
    );
    return { kind: "creature", seatId: best.seatId, card: best.card };
  }

  if (targetType === "any" && targetablePlayers.length > 0) {
    const lowestLife = targetablePlayers.reduce((a, b) => (b.life < a.life ? b : a));
    return { kind: "player", seat: lowestLife };
  }

  if (creatureCandidates.length > 0) {
    const biggest = creatureCandidates.reduce((a, b) =>
      effectivePower(b.card) + effectiveToughness(b.card) > effectivePower(a.card) + effectiveToughness(a.card) ? b : a
    );
    return { kind: "creature", seatId: biggest.seatId, card: biggest.card };
  }

  return undefined;
}

// A DynamicAmount X ("where X is the number of Swamps you control"), read off the board as the spell
// resolves — see removalSpells.ts's DynamicAmount for why this isn't just chosenX.
export function resolveDynamicAmount(session: GameSession, casterSeatId: string, amount: DynamicAmount): number {
  if (amount.kind === "creatures_on_battlefield") {
    return session.seats.reduce((total, seat) => total + seat.board.battlefield.filter((card) => card.typeLine.includes("Creature")).length, 0);
  }
  const caster = session.seats.find((seat) => seat.id === casterSeatId);
  if (amount.kind === "permanents_you_control") return countMatchingPermanents(caster?.board.battlefield ?? [], amount.matcher);
  return (caster?.board.battlefield ?? []).filter((card) => card.typeLine.toLowerCase().includes(amount.subtype)).length;
}

function hasCreatureSubtype(card: VisibleCard, subtype: string): boolean {
  return new RegExp(`\\b${subtype}\\b`, "i").test(card.typeLine.split("—")[1] ?? "");
}

export function greatestCreaturePower(seat: PlayerSeat | undefined, excludeSubtype?: string): number {
  const powers = (seat?.board.battlefield ?? [])
    .filter((card) => card.typeLine.includes("Creature") && !(excludeSubtype && hasCreatureSubtype(card, excludeSubtype)))
    .map((card) => effectivePower(card));
  return powers.length > 0 ? Math.max(0, ...powers) : 0;
}

export function strongestControlledCreature(seat: PlayerSeat | undefined): VisibleCard | undefined {
  const creatures = (seat?.board.battlefield ?? []).filter((card) => card.typeLine.includes("Creature"));
  if (creatures.length === 0) return undefined;
  return creatures.reduce((best, card) => (effectivePower(card) > effectivePower(best) ? card : best));
}

// Is a target chosen at cast time still legal as the spell resolves? An illegal one makes the spell fizzle (rule 608.2b).
export function castTargetLegal(session: GameSession, controllerSeatId: string, source: VisibleCard, target: ChosenTarget): boolean {
  if (target.kind === "player") {
    const seat = session.seats.find((item) => item.id === target.seatId);
    return Boolean(seat && !seat.hasLost && (seat.id === controllerSeatId || !playerHasHexproof(seat)));
  }
  const seat = session.seats.find((item) => item.id === target.seatId);
  const onBattlefield = seat?.board.battlefield.find((card) => card.id === target.cardId);
  if (onBattlefield) return seat!.id === controllerSeatId || (!hasShroud(onBattlefield) && !hasHexproof(onBattlefield) && !isProtectedFrom(onBattlefield, source));
  return Boolean(seat?.board.graveyard?.some((card) => card.id === target.cardId));
}

// Keen Duelist ("you and target opponent each reveal the top card of your library") and Parker Luck ("two target players each reveal ..."): both
// players reveal their top card, each loses life equal to the mana value of the card the OTHER one revealed, then each puts the card they
// revealed into their hand. The reveal is public, so the log names the cards.
function applyRevealTopExchange(session: GameSession, controllerSeatId: string, sourceName: string, ids: [string, string]): GameSession {
  const [a, b] = ids;
  const seatA = session.seats.find((seat) => seat.id === a);
  const seatB = session.seats.find((seat) => seat.id === b);
  if (!seatA || !seatB || a === b) return session;
  const topA = seatA.library?.[0];
  const topB = seatB.library?.[0];
  const lossA = topB?.manaValue ?? 0;
  const lossB = topA?.manaValue ?? 0;
  let next: GameSession = {
    ...session,
    seats: session.seats.map((seat) => (seat.id === a ? { ...seat, life: Math.max(0, seat.life - lossA) } : seat.id === b ? { ...seat, life: Math.max(0, seat.life - lossB) } : seat))
  };
  next = moveTopLibraryCardToHand(moveTopLibraryCardToHand(next, a), b);
  return rulesEvent(
    next,
    controllerSeatId,
    `${sourceName}: ${seatA.name} reveals ${topA?.name ?? "nothing"} and ${seatB.name} reveals ${topB?.name ?? "nothing"}. ${seatA.name} loses ${lossA} life and ${seatB.name} loses ${lossB} life; each puts the revealed card into their hand.`
  );
}

// Who an AGENT aims a reveal-exchange at: the living opponents with the most life (the exchange costs them life and gives them a card, so the healthiest
// ones can afford it least in the long run, and the controller is never one of the two for Parker Luck).
function agentRevealExchangeTargets(session: GameSession, controllerSeatId: string, count: 1 | 2): string[] {
  return session.seats
    .filter((seat) => seat.id !== controllerSeatId && !seat.hasLost)
    .sort((x, y) => y.life - x.life)
    .slice(0, count)
    .map((seat) => seat.id);
}

// Keen Duelist / Parker Luck at the phase: an agent aims at its healthiest opponent(s); a human is asked which player(s).
export function resolveRevealExchangeTrigger(session: GameSession, seatId: string, source: VisibleCard, mode: "keen" | "parker"): GameSession {
  const controller = session.seats.find((seat) => seat.id === seatId);
  if (!controller) return session;
  const living = session.seats.filter((seat) => !seat.hasLost);
  if (controller.kind === "human") {
    const options =
      mode === "keen"
        ? living.filter((seat) => seat.id !== seatId).map((seat) => ({ label: `${seat.name} (${seat.life} life)`, value: seat.id }))
        : living.flatMap((first, index) => living.slice(index + 1).map((second) => ({ label: `${first.name} and ${second.name}`, value: `${first.id}|${second.id}` })));
    if (options.length === 0) return session;
    return queuePlayerChoice(session, {
      seatId, sourceCardId: source.id, sourceCardName: source.name,
      prompt: mode === "keen" ? `${source.name}: choose the opponent who reveals their top card with you.` : `${source.name}: choose the two players who reveal their top card.`,
      options, resolver: "reveal_exchange", data: { mode, controllerSeatId: seatId }
    });
  }
  const targets = agentRevealExchangeTargets(session, seatId, mode === "keen" ? 1 : 2);
  if (mode === "keen") return targets[0] ? applyRevealTopExchange(session, seatId, source.name, [seatId, targets[0]]) : session;
  return targets.length === 2 ? applyRevealTopExchange(session, seatId, source.name, [targets[0], targets[1]]) : rulesEvent(session, seatId, `${source.name}: there are not two players to aim it at.`);
}

// Master of Ceremonies: "each opponent chooses money, friends, or secrets. For each player who chose money, you and that player each create a Treasure token.
// For friends, a 1/1 green and white Citizen creature token. For secrets, you and that player each draw a card." A human opponent is asked (the prompt
// opens for THEM, not for the controller); an agent opponent decides by what it lacks: cards in hand, then mana, otherwise a body.
const CEREMONIES_TOKEN_TEXT = { money: "create a Treasure token", friends: "create a 1/1 green and white Citizen creature token" } as const;

function agentCeremoniesPick(chooser: PlayerSeat): "money" | "friends" | "secrets" {
  if (chooser.board.hand.length <= 2 && chooser.zones.library > 0) return "secrets";
  const lands = chooser.board.battlefield.filter((card) => isLandCard(card)).length;
  return lands < 5 ? "money" : "friends";
}

function applyCeremoniesPick(session: GameSession, controllerSeatId: string, chooserSeatId: string, source: { id: string; name: string }, pick: "money" | "friends" | "secrets"): GameSession {
  const chooserName = session.seats.find((seat) => seat.id === chooserSeatId)?.name ?? "A player";
  let next = session;
  for (const id of [controllerSeatId, chooserSeatId]) {
    if (pick === "secrets") next = drawForSeat(next, id, `${session.seats.find((seat) => seat.id === id)?.name ?? "Player"} draws a card from ${source.name}.`);
    else next = createTokensForSeat(next, id, source.id, parseCreateTokenSpecs(CEREMONIES_TOKEN_TEXT[pick])).session;
  }
  return rulesEvent(next, chooserSeatId, `${source.name}: ${chooserName} chose ${pick}.`);
}

export function applyMasterOfCeremonies(session: GameSession, controllerSeatId: string, source: { id: string; name: string }, remainingOpponentIds: string[]): GameSession {
  let next = session;
  for (let index = 0; index < remainingOpponentIds.length; index += 1) {
    const chooser = next.seats.find((seat) => seat.id === remainingOpponentIds[index]);
    if (!chooser || chooser.hasLost) continue;
    if (chooser.kind === "human") {
      return queuePlayerChoice(next, {
        seatId: chooser.id, sourceCardId: source.id, sourceCardName: source.name,
        prompt: `${source.name}: choose money (you and the controller each create a Treasure), friends (each create a 1/1 Citizen) or secrets (each draw a card).`,
        options: [{ label: "Money: each create a Treasure", value: "money" }, { label: "Friends: each create a 1/1 Citizen", value: "friends" }, { label: "Secrets: each draw a card", value: "secrets" }],
        resolver: "ceremonies_choice", data: { controllerSeatId, remaining: remainingOpponentIds.slice(index + 1) }
      });
    }
    next = applyCeremoniesPick(next, controllerSeatId, chooser.id, source, agentCeremoniesPick(chooser));
  }
  return next;
}

function queueCrackleTarget(session: GameSession, seatId: string, source: VisibleCard, multiplier: number, x: number, picked: string[]): GameSession {
  const options: Array<{ label: string; value: string }> = [];
  for (const seat of session.seats.filter((item) => item.id !== seatId && !item.hasLost)) {
    if (!picked.includes(`p:${seat.id}`)) options.push({ label: `${seat.name} (player, ${seat.life} life)`, value: `p:${seat.id}` });
    for (const card of seat.board.battlefield.filter((entry) => entry.typeLine.includes("Creature") && !hasShroud(entry) && !hasHexproof(entry) && !entry.phasedOut)) {
      if (!picked.includes(`c:${seat.id}:${card.id}`)) options.push({ label: `${card.name} (${seat.name}'s ${card.power}/${card.toughness})`, value: `c:${seat.id}:${card.id}` });
    }
  }
  if (options.length === 0 || picked.length >= x) return resolveDeferredChoice(session, seatId, source.id, source.name, "crackle", { multiplier, x, picked }, "done");
  if (picked.length > 0) options.push({ label: "Done choosing targets", value: "done" });
  return queuePlayerChoice(session, { seatId, sourceCardId: source.id, sourceCardName: source.name, prompt: `${source.name}: choose target ${picked.length + 1} of up to ${x} (${multiplier * x} damage each).`, options, resolver: "crackle", data: { multiplier, x, picked } });
}

export function activateSteelHellkiteX(session: GameSession, seatId: string, cardId: string, x: number): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const card = seat?.board.battlefield.find((item) => item.id === cardId);
  if (!seat || !card) return session;
  if (x < 0) return session;
  const damaged = card.damagedPlayersThisTurn ?? [];
  const key = `${session.turn}:${cardId}:steel_hellkite_x`;
  if (damaged.length === 0 || session.onceEachTurnEffectsUsed?.includes(key)) return session;
  const payment = x > 0 ? chooseManaSourcesForCost(seat, genericCostShim(x), x, undefined, session.seats) : undefined;
  if (x > 0 && !payment?.ok) return session;
  let next: GameSession = { ...session, onceEachTurnEffectsUsed: [...(session.onceEachTurnEffectsUsed ?? []), key], seats: payment?.ok ? session.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item)) : session.seats };
  const creatures: Array<{ seatId: string; cardId: string; message: string }> = [];
  for (const other of next.seats.filter((item) => damaged.includes(item.id))) {
    for (const permanent of other.board.battlefield.filter((entry) => !isLandCard(entry) && entry.manaValue === x && !hasIndestructible(entry))) {
      if (permanent.typeLine.includes("Creature")) creatures.push({ seatId: other.id, cardId: permanent.id, message: `${permanent.name} is destroyed by ${card.name}.` });
      else next = moveCardBetweenVisibleZones(next, other.id, permanent.id, "graveyard");
    }
  }
  return destroyCreatures(rulesEvent(next, seatId, `${seat.name} activates ${card.name} with X=${x}.`), creatures, "Rules action");
}

// Saheeli, Sublime Artificer -2: the artifact takes the copy target's copiable values until end of turn (reverted by the cleanup via temporaryCopyOriginal) and stays an artifact.
export function becomeTemporaryCopy(session: GameSession, seatId: string, artifactId: string, sourceId: string, sourceName: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const artifact = seat?.board.battlefield.find((card) => card.id === artifactId);
  const copied = seat?.board.battlefield.find((card) => card.id === sourceId);
  if (!seat || !artifact || !copied) return session;
  const original = { name: artifact.name, typeLine: artifact.typeLine, oracleText: artifact.oracleText, manaCost: artifact.manaCost, manaValue: artifact.manaValue, colors: artifact.colors, colorIdentity: artifact.colorIdentity, power: artifact.power, toughness: artifact.toughness, imageUris: artifact.imageUris };
  const typeLine = copied.typeLine.includes("Artifact") ? copied.typeLine : `Artifact ${copied.typeLine}`;
  return rulesEvent(
    {
      ...session,
      seats: session.seats.map((item) =>
        item.id !== seatId
          ? item
          : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === artifactId ? { ...card, name: copied.name, typeLine, oracleText: copied.oracleText, manaCost: copied.manaCost, manaValue: copied.manaValue, colors: copied.colors, colorIdentity: copied.colorIdentity, power: copied.power, toughness: copied.toughness, imageUris: copied.imageUris ?? card.imageUris, temporaryCopyOriginal: card.temporaryCopyOriginal ?? original } : card)) } }
      )
    },
    seatId,
    `${sourceName}: ${artifact.name} becomes a copy of ${copied.name} until end of turn.`
  );
}

// Resolves the human's answer to a parked choice (pendingPlayerChoices). `value` is the stored option value; undefined = the prompt was dismissed.
export function resolveDeferredChoice(session: GameSession, seatId: string, sourceCardId: string, sourceName: string, resolver: string, data: Record<string, unknown>, value: string | undefined): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  if (resolver === "scripted_choice") return resolveScriptedChoice(session, seatId, sourceCardId, sourceName, data, value);
  if (resolver === "reveal_exchange") {
    const controllerId = String(data.controllerSeatId ?? seatId);
    const picked = (value ?? "").split("|").filter(Boolean);
    const participants = data.mode === "keen" ? [controllerId, ...picked] : picked;
    if (participants.length !== 2) return session;
    return applyRevealTopExchange(session, controllerId, sourceName, [participants[0], participants[1]]);
  }
  if (resolver === "ceremonies_choice") {
    const controllerId = String(data.controllerSeatId ?? "");
    const pick = value === "friends" || value === "secrets" ? value : "money";
    const applied = applyCeremoniesPick(session, controllerId, seatId, { id: sourceCardId, name: sourceName }, pick);
    return applyMasterOfCeremonies(applied, controllerId, { id: sourceCardId, name: sourceName }, (data.remaining as string[] | undefined) ?? []);
  }
  if (resolver === "toxic_deluge") {
    const x = Math.max(0, Math.min(Number.parseInt(value ?? "0", 10) || 0, seat.life - 1));
    if (x <= 0) return rulesEvent(session, seatId, `${seat.name} casts ${sourceName} for X=0.`);
    const paid: GameSession = { ...session, seats: session.seats.map((item) => (item.id === seatId ? { ...item, life: item.life - x } : item)) };
    return rulesEvent(applyMassPumpEffect(paid, seatId, sourceName, { power: -x, toughness: -x, scope: "all" } as MassPumpEffect), seatId, `${seat.name} pays ${x} life for ${sourceName}: all creatures get -${x}/-${x}.`);
  }
  if (resolver === "copy_token_choice") {
    const chosen = value ? findPermanentById(session, value) : undefined;
    if (!chosen) return session;
    const { session: copied } = createCopyTokenForSeat(session, seatId, chosen);
    return rulesEvent(copied, seatId, `${sourceName} trigger resolves. ${seat.name} creates a token that's a copy of ${chosen.name}.`);
  }
  if (resolver === "counters_on_creature") {
    const amount = Number(data.amount ?? 1);
    const target = seat.board.battlefield.find((card) => card.id === value);
    if (!target) return session;
    const countered: GameSession = { ...session, seats: session.seats.map((item) => (item.id !== seatId ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === target.id ? applyCounterDelta(card, "+1/+1", amount) : card)) } })) };
    return rulesEvent(countered, seatId, `${sourceName}: ${target.name} gets ${amount} +1/+1 counter${amount === 1 ? "" : "s"}.`);
  }
  if (resolver === "finality") {
    const counters = Number(data.counters ?? 2);
    const shrink = Number(data.shrink ?? 4);
    let next = session;
    const target = value && value !== "none" ? seat.board.battlefield.find((card) => card.id === value) : undefined;
    if (target) {
      next = { ...next, seats: next.seats.map((item) => (item.id !== seatId ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === target.id ? applyCounterDelta(card, "+1/+1", counters) : card)) } })) };
      next = rulesEvent(next, seatId, `${sourceName}: ${target.name} gets ${counters} +1/+1 counters.`);
    }
    return rulesEvent(applyMassPumpEffect(next, seatId, sourceName, { power: -shrink, toughness: -shrink, scope: "all" } as MassPumpEffect), seatId, `${sourceName}: all creatures get -${shrink}/-${shrink} until end of turn.`);
  }
  if (resolver === "devour") {
    const perCreature = Number(data.perCreature ?? 1);
    const picked = [...((data.picked as string[] | undefined) ?? [])];
    const devourer = seat.board.battlefield.find((card) => card.id === sourceCardId);
    if (!devourer) return session;
    if (value && value !== "done") picked.push(value);
    return value && value !== "done" ? applyDevour(session, seatId, devourer, perCreature, picked) : finishDevour(session, seatId, devourer, perCreature, picked);
  }
  if (resolver === "enter_as_copy") {
    // The owner's pick for a permanent that entered without being cast (Estrid's Invocation returning from its upkeep rider, a flickered Clone).
    const target = value && value !== "none" ? findPermanentById(session, value) : undefined;
    const entering = seat.board.battlefield.find((card) => card.id === sourceCardId);
    if (!entering) return session;
    return target ? applyEnterAsCopyTarget(session, seatId, sourceCardId, target) : rulesEvent(session, seatId, `${sourceName} enters without copying anything.`);
  }
  if (resolver === "sacrifice_token_for_counter") {
    // Chitterspitter: sacrifice a token (it ceases to exist), then put the counter on the source.
    const token = value && value !== "none" ? seat.board.battlefield.find((card) => card.id === value && card.token) : undefined;
    if (!token) return session;
    const counterKind = String(data.counterKind ?? "acorn");
    let next = token.typeLine.includes("Creature")
      ? destroyCreatures(session, [{ seatId, cardId: token.id, message: `${seat.name} sacrifices ${token.name} (${sourceName}).` }], "Rules action")
      : rulesEvent(moveCardBetweenVisibleZones(session, seatId, token.id, "graveyard"), seatId, `${seat.name} sacrifices ${token.name} (${sourceName}).`);
    next = { ...next, seats: next.seats.map((item) => (item.id !== seatId ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((entry) => (entry.id === sourceCardId ? applyCounterDelta(entry, counterKind, 1) : entry)) } })) };
    return rulesEvent(next, seatId, `${sourceName} gets a${/^[aeiou]/i.test(counterKind) ? "n" : ""} ${counterKind} counter.`);
  }
  if (resolver === "hulk_exile") {
    if (!value || value === "none") return session;
    const [ownerSeatId, cardId] = value.split(":");
    const card = session.seats.find((item) => item.id === ownerSeatId)?.board.graveyard?.find((entry) => entry.id === cardId);
    if (!card) return session;
    let next = rulesEvent(moveCardAcrossSeats(session, ownerSeatId, cardId, ownerSeatId, "exile").session, seatId, `${sourceName}: ${seat.name} exiles ${card.name} from a graveyard.`);
    if (card.typeLine.includes("Creature")) {
      next = { ...next, seats: next.seats.map((item) => (item.id !== seatId ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((entry) => (entry.id === sourceCardId ? applyCounterDelta(entry, "+1/+1", 1) : entry)) } })) };
      next = rulesEvent(next, seatId, `${sourceName} gets a +1/+1 counter.`);
    }
    return next;
  }
  if (resolver === "graveyard_return") {
    const options = data.options as GraveyardReturnOptions;
    const picked = [...((data.picked as string[] | undefined) ?? [])];
    if (!value || value === "none") return applyGraveyardReturnPicked(session, seatId, { id: sourceCardId, name: sourceName }, options, picked);
    picked.push(value);
    return picked.length >= options.count ? applyGraveyardReturnPicked(session, seatId, { id: sourceCardId, name: sourceName }, options, picked) : applyGraveyardReturn(session, seatId, { id: sourceCardId, name: sourceName }, options, picked);
  }
  if (resolver === "council_vote") {
    const worth = (card: VisibleCard) => card.manaValue * 2 + Math.max(0, effectivePower(card)) + (card.commander ? 5 : 0);
    const pool = session.seats.filter((item) => item.id !== seatId).flatMap((item) => item.board.battlefield.filter((card) => !isLandCard(card)).map((card) => ({ seatId: item.id, card })));
    if (pool.length === 0) return session;
    const votes = new Map<string, number>();
    const vote = (id: string) => votes.set(id, (votes.get(id) ?? 0) + 1);
    vote(value && pool.some((entry) => entry.card.id === value) ? value : [...pool].sort((a, b) => worth(b.card) - worth(a.card))[0].card.id);
    for (const voter of session.seats.filter((item) => item.id !== seatId && !item.hasLost)) {
      const others = pool.filter((entry) => entry.seatId !== voter.id);
      vote((others.length > 0 ? others : pool).sort((a, b) => worth(a.card) - worth(b.card))[0].card.id);
    }
    const top = Math.max(...votes.values());
    let next = session;
    const exiled: string[] = [];
    for (const entry of pool.filter((candidate) => votes.get(candidate.card.id) === top)) {
      next = moveCardAcrossSeats(next, entry.seatId, entry.card.id, entry.card.ownerSeatId ?? entry.seatId, "exile").session;
      exiled.push(entry.card.name);
    }
    return rulesEvent(next, seatId, `${sourceName}: the vote exiles ${exiled.join(", ")}.`);
  }
  if (resolver === "crackle") {
    const multiplier = Number(data.multiplier ?? 1);
    const x = Number(data.x ?? 0);
    const picked = [...((data.picked as string[] | undefined) ?? [])];
    if (value && value !== "done") picked.push(value);
    if (value && value !== "done" && picked.length < x) {
      const stub = { id: sourceCardId, name: sourceName } as VisibleCard;
      return queueCrackleTarget(session, seatId, stub, multiplier, x, picked);
    }
    let next = session;
    const amount = multiplier * x;
    for (const pick of picked) {
      const [kind, targetSeatId, cardId] = pick.split(":");
      const targetSeat = next.seats.find((item) => item.id === targetSeatId);
      if (!targetSeat) continue;
      next = kind === "p" ? applyCombatDamageToTarget(next, sourceName, { seat: targetSeat }, amount, undefined, seatId, "noncombat") : dealDamageToCreature(next, sourceName, targetSeatId, cardId, amount, undefined, seatId);
    }
    return rulesEvent(next, seatId, `${sourceName} deals ${amount} damage to each of ${picked.length} target${picked.length === 1 ? "" : "s"}.`);
  }
  if (resolver === "discard_unless") {
    if (value?.startsWith("one:")) return moveCardBetweenVisibleZones(session, seatId, value.slice(4), "graveyard");
    const count = Number(data.count ?? 0);
    const hand = seat.board.hand;
    if (count <= 0 || hand.length === 0) return session;
    return queuePlayerChoice(session, { seatId, sourceCardId, sourceCardName: sourceName, prompt: `${sourceName}: choose a card to discard (${count} left).`, options: hand.map((card) => ({ label: card.name, value: card.id })), resolver: "discard_pick", data: { count } });
  }
  if (resolver === "discard_pick") {
    if (!value) return session;
    const next = moveCardBetweenVisibleZones(session, seatId, value, "graveyard");
    const left = Number(data.count ?? 1) - 1;
    const hand = next.seats.find((item) => item.id === seatId)?.board.hand ?? [];
    return left > 0 && hand.length > 0 ? queuePlayerChoice(next, { seatId, sourceCardId, sourceCardName: sourceName, prompt: `${sourceName}: choose a card to discard (${left} left).`, options: hand.map((card) => ({ label: card.name, value: card.id })), resolver: "discard_pick", data: { count: left } }) : next;
  }
  if (resolver === "become_artifact") {
    if (!value) return session;
    return rulesEvent({ ...session, seats: session.seats.map((item) => ({ ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === value ? { ...card, permanentlyArtifact: true } : card)) } })) }, seatId, `${sourceName}: ${session.seats.flatMap((item) => item.board.battlefield).find((card) => card.id === value)?.name ?? "a permanent"} becomes an artifact in addition to its other types.`);
  }
  if (resolver === "gain_control_artifact") {
    const [fromSeatId, cardId] = (value ?? "").split(":");
    if (!cardId) return session;
    const taken = session.seats.find((item) => item.id === fromSeatId)?.board.battlefield.find((card) => card.id === cardId);
    return taken ? rulesEvent(changeControlWithinBattlefield(session, cardId, fromSeatId, seatId), seatId, `${seat.name} gains control of ${taken.name} with ${sourceName}.`) : session;
  }
  if (resolver === "steel_hellkite_x") {
    return activateSteelHellkiteX(session, seatId, String(data.cardId ?? sourceCardId), Number.parseInt(value ?? "-1", 10));
  }
  if (resolver === "destroy_pick") {
    const [targetSeatId, cardId] = (value ?? "").split(":");
    if (!cardId) return rulesEvent(session, seatId, `${seat.name} chooses not to destroy anything with ${sourceName}.`);
    return destroyCreatures(session, [{ seatId: targetSeatId, cardId, message: `${session.seats.find((item) => item.id === targetSeatId)?.board.battlefield.find((card) => card.id === cardId)?.name ?? "The creature"} is destroyed by ${sourceName}.` }], "Rules action");
  }
  if (resolver === "saheeli_copy_artifact") {
    const artifactId = value;
    if (!artifactId) return session;
    const options = seat.board.battlefield.filter((card) => card.id !== artifactId && card.id !== sourceCardId && (hasCardType(card, "Artifact") || card.typeLine.includes("Creature"))).map((card) => ({ label: card.name, value: card.id }));
    if (options.length === 0) return session;
    return queuePlayerChoice(session, { seatId, sourceCardId, sourceCardName: sourceName, prompt: `${sourceName}: which artifact or creature does it copy?`, options, resolver: "saheeli_copy_source", data: { artifactId } });
  }
  if (resolver === "saheeli_copy_source") {
    return value ? becomeTemporaryCopy(session, seatId, String(data.artifactId), value, sourceName) : session;
  }
  if (resolver === "brudiclad") {
    const chosen = value ? seat.board.battlefield.find((card) => card.id === value && card.token) : undefined;
    if (!chosen) return rulesEvent(session, seatId, `${sourceName}: no token chosen.`);
    const unified: GameSession = {
      ...session,
      seats: session.seats.map((item) =>
        item.id !== seatId
          ? item
          : {
              ...item,
              board: {
                ...item.board,
                battlefield: item.board.battlefield.map((card) =>
                  card.token && card.id !== chosen.id ? { ...card, name: chosen.name, typeLine: chosen.typeLine, oracleText: chosen.oracleText, power: chosen.power, toughness: chosen.toughness, colors: chosen.colors, colorIdentity: chosen.colorIdentity, imageUris: chosen.imageUris } : card
                )
              }
            }
      )
    };
    return rulesEvent(unified, seatId, `${sourceName}: every other token becomes a copy of ${chosen.name}.`);
  }
  return session;
}

export function applySpellExtraEffect(session: GameSession, casterSeatId: string, source: VisibleCard, effect: SpellExtraEffect, chosenX?: number, chosenTargets?: ChosenTarget[]): GameSession {
  const caster = session.seats.find((seat) => seat.id === casterSeatId);
  if (!caster) return session;
  const sourceName = source.name;

  switch (effect.kind) {
    case "draw_and_lose_life": {
      const drawn = drawMultipleForSeat(session, casterSeatId, effect.draw, `${caster.name} draws ${effect.draw} card${effect.draw === 1 ? "" : "s"} from ${sourceName}.`);
      const afterLoss: GameSession = {
        ...drawn,
        seats: drawn.seats.map((seat) => (seat.id === casterSeatId ? { ...seat, life: seat.life - effect.lose } : seat))
      };
      return rulesEvent(afterLoss, casterSeatId, `${caster.name} loses ${effect.lose} life from ${sourceName}.`);
    }

    // Toxic Deluge: pay X life, all creatures get -X/-X. No X prompt exists for a life cost, so X is the smallest value that makes the table's loss worth it
    // (opposing creature value killed minus own), never more than life-1.
    case "pay_x_life_mass_shrink": {
      if (caster.kind === "human" && chosenX === undefined) {
        const options = [];
        for (let x = 0; x <= Math.min(caster.life - 1, 12); x += 1) {
          let mine = 0;
          let theirs = 0;
          for (const seat of session.seats) for (const card of seat.board.battlefield) if (card.typeLine.includes("Creature") && effectiveToughness(card) <= x) (seat.id === casterSeatId ? (mine += 1) : (theirs += 1));
          options.push({ label: `X = ${x} (pay ${x} life): kills ${mine} of yours, ${theirs} of theirs`, value: String(x) });
        }
        return queuePlayerChoice(session, { seatId: casterSeatId, sourceCardId: source.id, sourceCardName: sourceName, prompt: `${sourceName}: how much life do you pay (X)? All creatures get -X/-X.`, options, resolver: "toxic_deluge", data: {} });
      }
      const value = (card: VisibleCard) => Math.max(1, card.manaValue) + Math.max(0, effectivePower(card)) / 2;
      let bestX = chosenX ?? -1;
      if (bestX < 0) {
        let bestNet = 0;
        bestX = 0;
        for (let x = 1; x <= Math.min(caster.life - 1, 12); x += 1) {
          let net = -x * 0.3;
          for (const seat of session.seats) {
            for (const card of seat.board.battlefield) {
              if (!card.typeLine.includes("Creature") || effectiveToughness(card) > x) continue;
              net += seat.id === casterSeatId ? -value(card) : value(card);
            }
          }
          if (net > bestNet) {
            bestNet = net;
            bestX = x;
          }
        }
      }
      if (bestX <= 0) return rulesEvent(session, casterSeatId, `${caster.name} casts ${sourceName} for X=0.`);
      const paid: GameSession = { ...session, seats: session.seats.map((seat) => (seat.id === casterSeatId ? { ...seat, life: seat.life - bestX } : seat)) };
      const shrunk = applyMassPumpEffect(paid, casterSeatId, sourceName, { power: -bestX, toughness: -bestX, scope: "all" } as MassPumpEffect);
      return rulesEvent(shrunk, casterSeatId, `${caster.name} pays ${bestX} life for ${sourceName}: all creatures get -${bestX}/-${bestX}.`);
    }

    // Incarnation Technique: mill N, then return the best creature card in your graveyard (highest mana value) to the battlefield.
    case "mill_then_reanimate_creature": {
      const milled = applyMill(session, casterSeatId, sourceName, effect.mill);
      const graveyard = milled.seats.find((seat) => seat.id === casterSeatId)?.board.graveyard ?? [];
      const best = graveyard.filter((card) => card.typeLine.includes("Creature")).sort((a, b) => b.manaValue - a.manaValue)[0];
      if (!best) return rulesEvent(milled, casterSeatId, `${sourceName}: no creature card to return.`);
      return rulesEvent(moveCardAcrossSeats(milled, casterSeatId, best.id, casterSeatId, "battlefield").session, casterSeatId, `${caster.name} returns ${best.name} to the battlefield with ${sourceName}.`);
    }

    case "sacrifice_all_colored_permanents": {
      const creatures: Array<{ seatId: string; cardId: string; message: string }> = [];
      let next = session;
      for (const seat of session.seats) {
        for (const card of seat.board.battlefield.filter((entry) => (entry.colors ?? []).length > 0)) {
          if (card.typeLine.includes("Creature")) creatures.push({ seatId: seat.id, cardId: card.id, message: `${card.name} is sacrificed to ${sourceName}.` });
          else next = moveCardBetweenVisibleZones(next, seat.id, card.id, "graveyard");
        }
      }
      return destroyCreatures(rulesEvent(next, casterSeatId, `${sourceName}: each player sacrifices every colored permanent.`), creatures, "Rules action");
    }

    case "bounce_all_attackers": {
      let next = session;
      let count = 0;
      for (const seat of session.seats) {
        for (const card of seat.board.battlefield.filter((entry) => entry.attacking && entry.typeLine.includes("Creature"))) {
          next = moveCardBetweenVisibleZones(next, seat.id, card.id, "hand");
          count += 1;
        }
      }
      return rulesEvent(next, casterSeatId, `${sourceName} returns ${count} attacking creature${count === 1 ? "" : "s"} to their owners' hands.`);
    }

    // Council's Judgment: each player votes for a nonland permanent the CASTER doesn't control. The caster votes for the best opposing permanent; every
    // other player votes for the least valuable such permanent not controlled by themselves (their own if nothing else). Ties exile all tied.
    case "council_judgment": {
      if (caster.kind === "human" && chosenTargets === undefined) {
        const candidates = session.seats.filter((seat) => seat.id !== casterSeatId).flatMap((seat) => seat.board.battlefield.filter((card) => !isLandCard(card)).map((card) => ({ seat, card })));
        if (candidates.length === 0) return noLegalTargetEvent(session, casterSeatId, sourceName);
        return queuePlayerChoice(session, { seatId: casterSeatId, sourceCardId: source.id, sourceCardName: sourceName, prompt: `${sourceName}: vote for a nonland permanent you don't control (the others vote after you).`, options: candidates.map(({ seat, card }) => ({ label: `${card.name} (${seat.name})`, value: card.id })), resolver: "council_vote", data: {} });
      }
      const worth = (card: VisibleCard) => card.manaValue * 2 + Math.max(0, effectivePower(card)) + (card.commander ? 5 : 0);
      const pool = session.seats.filter((seat) => seat.id !== casterSeatId).flatMap((seat) => seat.board.battlefield.filter((card) => !isLandCard(card)).map((card) => ({ seatId: seat.id, card })));
      if (pool.length === 0) return noLegalTargetEvent(session, casterSeatId, sourceName);
      const votes = new Map<string, number>();
      const vote = (id: string) => votes.set(id, (votes.get(id) ?? 0) + 1);
      vote([...pool].sort((a, b) => worth(b.card) - worth(a.card))[0].card.id);
      for (const voter of session.seats.filter((seat) => seat.id !== casterSeatId && !seat.hasLost)) {
        const others = pool.filter((entry) => entry.seatId !== voter.id);
        const choices = (others.length > 0 ? others : pool).sort((a, b) => worth(a.card) - worth(b.card));
        vote(choices[0].card.id);
      }
      const top = Math.max(...votes.values());
      let next = session;
      const exiled: string[] = [];
      for (const entry of pool.filter((candidate) => votes.get(candidate.card.id) === top)) {
        next = moveCardAcrossSeats(next, entry.seatId, entry.card.id, entry.card.ownerSeatId ?? entry.seatId, "exile").session;
        exiled.push(entry.card.name);
      }
      return rulesEvent(next, casterSeatId, `${sourceName}: the vote exiles ${exiled.join(", ")}.`);
    }

    // Thirst for Knowledge: draw, then discard N cards unless you discard one card of the type. A human is asked which; an agent discards the cheapest artifact, else its worst cards.
    case "draw_then_discard_unless": {
      const drawn = drawMultipleForSeat(session, casterSeatId, effect.draw, `${caster.name} draws ${effect.draw} card${effect.draw === 1 ? "" : "s"} from ${sourceName}.`);
      const hand = drawn.seats.find((seat) => seat.id === casterSeatId)?.board.hand ?? [];
      const ofType = hand.filter((card) => card.typeLine.toLowerCase().includes(effect.unlessType));
      if (caster.kind === "human" && hand.length > 0) {
        return queuePlayerChoice(drawn, {
          seatId: casterSeatId,
          sourceCardId: source.id,
          sourceCardName: sourceName,
          prompt: `${sourceName}: discard ${effect.discard} cards, or just one ${effect.unlessType} card?`,
          options: [...ofType.map((card) => ({ label: `Discard only ${card.name} (${effect.unlessType})`, value: `one:${card.id}` })), ...(hand.length >= 1 ? [{ label: `Discard ${Math.min(effect.discard, hand.length)} cards (I will choose)`, value: "many" }] : [])],
          resolver: "discard_unless",
          data: { count: Math.min(effect.discard, hand.length), sourceName }
        });
      }
      const worth = (card: VisibleCard) => card.manaValue + (isLandCard(card) ? -1 : 0);
      const cheapestOfType = [...ofType].sort((a, b) => worth(a) - worth(b))[0];
      let next = drawn;
      if (cheapestOfType) return moveCardBetweenVisibleZones(next, casterSeatId, cheapestOfType.id, "graveyard");
      for (const card of [...hand].sort((a, b) => worth(a) - worth(b)).slice(0, effect.discard)) next = moveCardBetweenVisibleZones(next, casterSeatId, card.id, "graveyard");
      return next;
    }

    // Pull from Tomorrow: draw X, then discard N (the agent/auto choice: the least valuable card — lands beyond the fourth first).
    case "draw_x_then_discard": {
      const x = Math.max(0, chosenX ?? 0);
      const drawn = x > 0 ? drawMultipleForSeat(session, casterSeatId, x, `${caster.name} draws ${x} card${x === 1 ? "" : "s"} from ${sourceName}.`) : session;
      const hand = drawn.seats.find((seat) => seat.id === casterSeatId)?.board.hand ?? [];
      const lands = hand.filter((card) => isLandCard(card)).length;
      const worst = [...hand].sort((a, b) => (isLandCard(a) && lands > 4 ? -1 : 0) - (isLandCard(b) && lands > 4 ? -1 : 0) || a.manaValue - b.manaValue);
      let next = drawn;
      for (const card of worst.slice(0, effect.discard)) next = moveCardBetweenVisibleZones(next, casterSeatId, card.id, "graveyard");
      return next;
    }

    // Finale of Revelation: draw X; with X >= the threshold, shuffle the graveyard into the library first, untap lands, and lose the hand-size limit.
    case "finale_of_revelation": {
      const x = Math.max(0, chosenX ?? 0);
      let next = session;
      if (x >= effect.threshold) {
        next = {
          ...next,
          seats: next.seats.map((seat) => {
            if (seat.id !== casterSeatId) return seat;
            const library = shuffleCards([...(seat.library ?? []), ...(seat.board.graveyard ?? []).map((card) => resetForZoneChange(card, "library"))]);
            return { ...seat, library, board: { ...seat.board, graveyard: [] }, zones: { ...seat.zones, library: library.length, graveyard: 0 } };
          })
        };
      }
      next = drawMultipleForSeat(next, casterSeatId, x, `${caster.name} draws ${x} card${x === 1 ? "" : "s"} from ${sourceName}.`);
      if (x >= effect.threshold) {
        let toUntap = effect.untapLands;
        next = {
          ...next,
          seats: next.seats.map((seat) =>
            seat.id !== casterSeatId
              ? seat
              : {
                  ...seat,
                  noMaximumHandSize: true,
                  board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (toUntap > 0 && isLandCard(card) && card.tapped ? ((toUntap -= 1), { ...card, tapped: false }) : card)) }
                }
          )
        };
        next = rulesEvent(next, casterSeatId, `${caster.name} shuffles their graveyard into their library, untaps up to ${effect.untapLands} lands, and has no maximum hand size for the rest of the game.`);
      }
      return next;
    }

    // Reality Heist: look at the top N; take up to M cards of the type (the best by mana value) to hand; the rest to the bottom in a random order.
    case "look_take_type_rest_bottom": {
      const library = caster.library ?? [];
      const top = library.slice(0, effect.look);
      const matchesType = (card: VisibleCard) => card.typeLine.toLowerCase().includes(effect.cardType);
      const taken = top.filter(matchesType).sort((a, b) => b.manaValue - a.manaValue).slice(0, effect.take);
      let next = session;
      for (const card of taken) next = moveCardAcrossSeats(next, casterSeatId, card.id, casterSeatId, "hand").session;
      const takenIds = new Set(taken.map((card) => card.id));
      const rest = top.filter((card) => !takenIds.has(card.id));
      next = {
        ...next,
        seats: next.seats.map((seat) => {
          if (seat.id !== casterSeatId) return seat;
          const restIds = new Set(rest.map((card) => card.id));
          const rebuilt = [...(seat.library ?? []).filter((card) => !restIds.has(card.id)), ...shuffleCards(rest)];
          return { ...seat, library: rebuilt, zones: { ...seat.zones, library: rebuilt.length } };
        })
      };
      return rulesEvent(next, casterSeatId, `${caster.name} looks at the top ${top.length} cards with ${sourceName}${taken.length > 0 ? `, reveals ${taken.map((card) => card.name).join(" and ")} and puts ${taken.length === 1 ? "it" : "them"} into their hand` : " and finds nothing to take"}; the rest go to the bottom.`);
    }

    // Saheeli's Directive: reveal the top X; every matching card with mana value <= X enters the battlefield (taking all is always right), the rest go to the graveyard.
    case "reveal_x_put_cheap_permanents": {
      const x = Math.max(0, chosenX ?? 0);
      const revealed = (caster.library ?? []).slice(0, x);
      const matchesType = (card: VisibleCard) => card.typeLine.toLowerCase().includes(effect.cardType) && card.manaValue <= x;
      let next = session;
      for (const card of revealed.filter(matchesType)) next = moveCardAcrossSeats(next, casterSeatId, card.id, casterSeatId, "battlefield").session;
      for (const card of revealed.filter((entry) => !matchesType(entry))) next = moveCardAcrossSeats(next, casterSeatId, card.id, casterSeatId, "graveyard").session;
      return rulesEvent(next, casterSeatId, `${caster.name} reveals the top ${revealed.length} card${revealed.length === 1 ? "" : "s"} with ${sourceName}: ${revealed.filter(matchesType).length} ${effect.cardType}${revealed.filter(matchesType).length === 1 ? "" : "s"} enter the battlefield, the rest go to the graveyard.`);
    }

    // Crackle with Power: multiplier * X damage to each of up to X targets. Deterministic target choice (opponents first, then their biggest creatures);
    // a human is not asked to aim it.
    case "damage_times_x_to_up_to_x_targets": {
      const x = Math.max(0, chosenX ?? 0);
      const amount = effect.multiplier * x;
      if (x === 0 || amount <= 0) return noLegalTargetEvent(session, casterSeatId, sourceName);
      if (caster.kind === "human" && chosenTargets === undefined) return queueCrackleTarget(session, casterSeatId, source, effect.multiplier, x, []);
      type Aim = { kind: "player"; seatId: string } | { kind: "creature"; seatId: string; card: VisibleCard };
      const opponents = session.seats.filter((seat) => seat.id !== casterSeatId && !seat.hasLost);
      const aims: Aim[] = opponents.map((seat) => ({ kind: "player" as const, seatId: seat.id }));
      const creatures: Aim[] = opponents
        .flatMap((seat) => seat.board.battlefield.filter((card) => card.typeLine.includes("Creature") && !hasShroud(card) && !hasHexproof(card) && !card.phasedOut).map((card) => ({ kind: "creature" as const, seatId: seat.id, card })))
        .sort((a, b) => (b.kind === "creature" ? effectivePower(b.card) : 0) - (a.kind === "creature" ? effectivePower(a.card) : 0));
      const chosen = [...aims, ...creatures].slice(0, x);
      let next = session;
      for (const aim of chosen) {
        next = aim.kind === "player"
          ? applyCombatDamageToTarget(next, sourceName, { seat: next.seats.find((seat) => seat.id === aim.seatId)! }, amount, source, casterSeatId, "noncombat")
          : dealDamageToCreature(next, sourceName, aim.seatId, aim.card.id, amount, source, casterSeatId);
      }
      return rulesEvent(next, casterSeatId, `${sourceName} deals ${amount} damage to each of ${chosen.length} target${chosen.length === 1 ? "" : "s"}.`);
    }

    case "discover": {
      // Rule 701.57: exile cards from the top until a nonland card with mana value N or less; cast it
      // free or put it in hand; the rest go to the bottom in a random order. Always taking the "put it
      // in your hand" option here — a legal choice, and it sidesteps casting a spell with no stack.
      const library = caster.library ?? [];
      const revealed: VisibleCard[] = [];
      let found: VisibleCard | undefined;
      for (const card of library) {
        if (!isLandCard(card) && card.manaValue <= effect.amount) {
          found = card;
          break;
        }
        revealed.push(card);
      }
      let next = session;
      // A human may instead cast it free: it waits in exile, with a free-cast permission, until they answer (pendingDiscoverChoices).
      const humanChoosesDiscover = Boolean(found && caster.kind === "human");
      if (found && humanChoosesDiscover) {
        const exiled = moveCardAcrossSeats(next, casterSeatId, found.id, casterSeatId, "exile").session;
        next = {
          ...exiled,
          seats: exiled.seats.map((seat) =>
            seat.id !== casterSeatId ? seat : { ...seat, board: { ...seat.board, exile: (seat.board.exile ?? []).map((card) => (card.id === found!.id ? { ...card, exiledPlayableBySeatId: casterSeatId, exiledPlayableFree: true, exiledPlayableAnyTime: true } : card)) } }
          ),
          pendingDiscoverChoices: [...(exiled.pendingDiscoverChoices ?? []), { seatId: casterSeatId, cardId: found.id, cardName: found.name, sourceName }]
        };
      } else if (found) next = moveCardAcrossSeats(next, casterSeatId, found.id, casterSeatId, "hand").session;
      const revealedIds = new Set(revealed.map((card) => card.id));
      next = {
        ...next,
        seats: next.seats.map((seat) => {
          if (seat.id !== casterSeatId) return seat;
          const remaining = (seat.library ?? []).filter((card) => !revealedIds.has(card.id));
          const library = [...remaining, ...shuffleCards(revealed)];
          return { ...seat, library, zones: { ...seat.zones, library: library.length } };
        })
      };
      next = rulesEvent(
        next,
        casterSeatId,
        found ? (humanChoosesDiscover ? `${caster.name} discovers ${effect.amount} with ${sourceName} and exiles ${found.name}.` : `${caster.name} discovers ${effect.amount} with ${sourceName} and puts ${found.name} into their hand.`) : `${caster.name} discovers ${effect.amount} with ${sourceName} but finds no card.`
      );
      if (found && effect.treasuresForDifference && found.manaValue < effect.amount) {
        const difference = effect.amount - found.manaValue;
        next = createTokensForSeat(next, casterSeatId, source.id, [{ ...predefinedTokenSpec("Treasure"), count: difference, tapped: true }]).session;
      }
      return next;
    }

    case "each_player_sacrifices": {
      // The tokens this same spell creates ("You create six tapped 2/2 Zombie tokens") come AFTER the
      // sacrifice, so they're excluded from what a player can be made to sacrifice.
      const destructions: Array<{ seatId: string; cardId: string; message: string }> = [];
      const humanChoices: Array<{ seatId: string; sourceCardId: string; sourceCardName: string; count: number }> = [];
      for (const seat of session.seats) {
        if (seat.hasLost) continue;
        const candidates = seat.board.battlefield
          .filter((card) => card.typeLine.includes("Creature") && !(card.token && card.tokenSourceCardId === source.id))
          .sort((a, b) => Number(Boolean(b.token)) - Number(Boolean(a.token)) || effectivePower(a) + effectiveToughness(a) - (effectivePower(b) + effectiveToughness(b)));
        // A human with more candidates than they must sacrifice chooses which; the picker opens from pendingSacrificeChoices.
        if (seat.kind === "human" && candidates.length > effect.count) {
          humanChoices.push({ seatId: seat.id, sourceCardId: source.id, sourceCardName: sourceName, count: effect.count });
          continue;
        }
        for (const card of candidates.slice(0, effect.count)) {
          destructions.push({ seatId: seat.id, cardId: card.id, message: `${seat.name} sacrifices ${card.name} to ${sourceName}.` });
        }
      }
      const sacrificed = destroyCreatures(session, destructions, "Rules action");
      return humanChoices.length > 0 ? { ...sacrificed, pendingSacrificeChoices: [...(sacrificed.pendingSacrificeChoices ?? []), ...humanChoices] } : sacrificed;
    }

    // Dark Ritual: the mana itself is added to the human's floating pool by resolvePendingAction (capturedSpellMana); an agent has no pool to spend it from.
    case "add_fixed_mana":
      return session;

    // Culling Ritual: destroys every nonland permanent (any controller) with mana value 2 or less, tokens included (mana value 0).
    case "destroy_each_nonland_at_most": {
      const destructions: Array<{ seatId: string; cardId: string; message: string }> = [];
      let next = session;
      for (const seat of session.seats) {
        for (const card of seat.board.battlefield) {
          if (isLandCard(card) || card.manaValue > effect.maxManaValue || hasIndestructible(card) || card.phasedOut) continue;
          if (card.typeLine.includes("Creature")) destructions.push({ seatId: seat.id, cardId: card.id, message: `${card.name} is destroyed by ${sourceName}.` });
          else next = moveCardBetweenVisibleZones(next, seat.id, card.id, "graveyard");
        }
      }
      return destroyCreatures(rulesEvent(next, casterSeatId, `${sourceName}: every nonland permanent with mana value ${effect.maxManaValue} or less is destroyed.`), destructions, "Rules action");
    }

    // Mulch: reveal the top N, lands to hand, the rest to the graveyard.
    case "mulch": {
      const top = (caster.library ?? []).slice(0, effect.count);
      let next = session;
      for (const card of top) next = moveLibraryCardToDestination(next, casterSeatId, card.id, isLandCard(card) ? "hand" : "graveyard", false);
      return rulesEvent(next, casterSeatId, `${sourceName}: ${caster.name} reveals ${top.map((card) => card.name).join(", ") || "nothing"}; ${top.filter((card) => isLandCard(card)).length} land${top.filter((card) => isLandCard(card)).length === 1 ? "" : "s"} go to hand, the rest to the graveyard.`);
    }

    // Deadly Brew: every player sacrifices a creature or planeswalker of their choice (a human with a choice picks); if the caster did, they may return
    // ANOTHER permanent card from their graveyard to hand (so the card they just sacrificed is never the one returned).
    case "each_player_sacrifices_then_regrow": {
      const destructions: Array<{ seatId: string; cardId: string; message: string }> = [];
      const humanChoices: Array<{ seatId: string; sourceCardId: string; sourceCardName: string; count: number; typeFilter: string }> = [];
      let casterSacrificed: string | undefined;
      for (const seat of session.seats) {
        if (seat.hasLost) continue;
        const candidates = seat.board.battlefield
          .filter((card) => card.typeLine.includes("Creature") || card.typeLine.includes("Planeswalker"))
          .sort((a, b) => Number(Boolean(b.token)) - Number(Boolean(a.token)) || effectivePower(a) + effectiveToughness(a) - (effectivePower(b) + effectiveToughness(b)));
        if (candidates.length === 0) continue;
        if (seat.id === casterSeatId) casterSacrificed = candidates[0].id;
        if (seat.kind === "human" && candidates.length > 1) {
          humanChoices.push({ seatId: seat.id, sourceCardId: source.id, sourceCardName: sourceName, count: 1, typeFilter: "creature or planeswalker" });
          continue;
        }
        destructions.push({ seatId: seat.id, cardId: candidates[0].id, message: `${seat.name} sacrifices ${candidates[0].name} to ${sourceName}.` });
      }
      const sacrificed = destroyCreatures(session, destructions, "Rules action");
      const queued = humanChoices.length > 0 ? { ...sacrificed, pendingSacrificeChoices: [...(sacrificed.pendingSacrificeChoices ?? []), ...humanChoices] } : sacrificed;
      return casterSacrificed ? applyGraveyardReturn(queued, casterSeatId, source, { destination: "hand", typeFilter: "permanent", count: 1, excludeCardId: casterSacrificed }) : queued;
    }

    // Exsanguinate: each opponent loses X, you gain the total actually lost.
    case "drain_x_each_opponent": {
      const x = Math.max(0, chosenX ?? 0);
      const opponents = session.seats.filter((seat) => seat.id !== casterSeatId && !seat.hasLost);
      if (x <= 0 || opponents.length === 0) return rulesEvent(session, casterSeatId, `${sourceName} resolves for X=${x}: no life is lost.`);
      const total = x * opponents.length;
      const drained: GameSession = { ...session, seats: session.seats.map((seat) => (seat.id === casterSeatId ? { ...seat, life: seat.life + total } : opponents.some((opponent) => opponent.id === seat.id) ? { ...seat, life: seat.life - x } : seat)) };
      return rulesEvent(drained, casterSeatId, `${sourceName}: each opponent loses ${x} life and ${caster.name} gains ${total}.`);
    }

    // Find: up to two creature cards from your graveyard to your hand.
    case "return_creatures_from_graveyard":
      return applyGraveyardReturn(session, casterSeatId, source, { destination: "hand", typeFilter: "creature", count: effect.count });

    // Finality: the counters go on a creature that will survive the shrink (an agent), or on the creature a human picks.
    case "counters_then_mass_shrink": {
      const survivors = caster.board.battlefield.filter((card) => card.typeLine.includes("Creature"));
      if (caster.kind === "human" && survivors.length > 0) {
        return queuePlayerChoice(session, {
          seatId: casterSeatId, sourceCardId: source.id, sourceCardName: sourceName,
          prompt: `${sourceName}: put ${effect.counters} +1/+1 counters on a creature you control? Then all creatures get -${effect.shrink}/-${effect.shrink} until end of turn.`,
          options: [...survivors.map((card) => ({ label: `${card.name} (${effectivePower(card)}/${effectiveToughness(card)}${effectiveToughness(card) + effect.counters - effect.shrink > 0 ? ", survives" : ", dies anyway"})`, value: card.id })), { label: "No counters", value: "none" }],
          resolver: "finality", data: { counters: effect.counters, shrink: effect.shrink }
        });
      }
      const best = survivors.filter((card) => effectiveToughness(card) + effect.counters - effect.shrink > 0).sort((a, b) => effectivePower(b) - effectivePower(a))[0];
      return resolveDeferredChoice(session, casterSeatId, source.id, sourceName, "finality", { counters: effect.counters, shrink: effect.shrink }, best?.id ?? "none");
    }

    case "divided_damage_greatest_power": {
      let remaining = greatestCreaturePower(caster);
      if (remaining <= 0) return noLegalTargetEvent(session, casterSeatId, sourceName);
      const victims = session.seats
        .filter((seat) => seat.id !== casterSeatId && !seat.hasLost)
        .flatMap((seat) => seat.board.battlefield.filter((card) => card.typeLine.includes("Creature") && !hasShroud(card) && !hasHexproof(card) && !isProtectedFrom(card, source)).map((card) => ({ seatId: seat.id, card })))
        .sort((a, b) => effectiveToughness(a.card) - effectiveToughness(b.card));
      if (victims.length === 0) return noLegalTargetEvent(session, casterSeatId, sourceName);
      // Divide as you choose: lethal damage to as many creatures as the total allows, cheapest kills first.
      let next = session;
      let dealtAny = false;
      for (const victim of victims) {
        const lethal = Math.max(1, effectiveToughness(victim.card));
        if (remaining < lethal) continue;
        const warded = payWardIfNeeded(next, casterSeatId, victim.card, sourceName);
        if (warded.countered) {
          next = warded.session;
          continue;
        }
        next = dealDamageToCreature(warded.session, sourceName, victim.seatId, victim.card.id, lethal, source, casterSeatId);
        remaining -= lethal;
        dealtAny = true;
      }
      // Nothing was killable with the damage available: put it all on the weakest target rather than waste it.
      if (!dealtAny) next = dealDamageToCreature(next, sourceName, victims[0].seatId, victims[0].card.id, remaining, source, casterSeatId);
      return next;
    }

    case "tokens_fight_each_opponent_creature": {
      const victims = session.seats
        .filter((seat) => seat.id !== casterSeatId && !seat.hasLost)
        .flatMap((seat) => seat.board.battlefield.filter((card) => card.typeLine.includes("Creature")).map((card) => ({ seatId: seat.id, card })));
      if (victims.length === 0) return rulesEvent(session, casterSeatId, `${sourceName} resolves with no opposing creatures.`);
      const created = createTokensForSeat(session, casterSeatId, source.id, [
        {
          count: victims.length,
          name: `${effect.subtype} Token`,
          colors: effect.colors,
          typeLine: `Token Creature - ${effect.subtype}`,
          power: effect.power,
          toughness: effect.toughness,
          oracleText: "",
          role: "creature"
        }
      ]);
      // Each token fights a different creature: both deal damage equal to their power to the other.
      let next = created.session;
      created.createdTokens.forEach((token, index) => {
        const victim = victims[index];
        if (!victim) return;
        next = dealDamageToCreature(next, sourceName, victim.seatId, victim.card.id, Math.max(0, effectivePower(token)), token, casterSeatId);
        next = dealDamageToCreature(next, sourceName, casterSeatId, token.id, Math.max(0, effectivePower(victim.card)), victim.card, victim.seatId);
      });
      return next;
    }

    case "pump_dynamic": {
      const amount =
        effect.basis.kind === "greatest_power_you_control"
          ? greatestCreaturePower(caster)
          : effect.basis.kind === "fixed"
            ? effect.basis.amount
            : effect.basis.kind === "creatures_on_battlefield" || effect.basis.kind === "lands_you_control"
              ? resolveDynamicAmount(session, casterSeatId, effect.basis)
              : (chosenX ?? 0);
      const delta = effect.sign * amount;
      let affected = 0;
      const seats = session.seats.map((seat) => {
        if (effect.scope === "controlled" && seat.id !== casterSeatId) return seat;
        return {
          ...seat,
          board: {
            ...seat.board,
            battlefield: seat.board.battlefield.map((card) => {
              if (!card.typeLine.includes("Creature")) return card;
              if (effect.excludeSubtype && hasCreatureSubtype(card, effect.excludeSubtype)) return card;
              affected += 1;
              return {
                ...card,
                temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + delta,
                temporaryToughnessBonus: (card.temporaryToughnessBonus ?? 0) + delta,
                ...(effect.grantsTrample ? { temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), "trample"] } : {})
              };
            })
          }
        };
      });
      const sign = delta >= 0 ? "+" : "";
      return rulesEvent(
        { ...session, seats },
        casterSeatId,
        affected > 0
          ? `${sourceName} gives ${effect.scope === "controlled" ? "creatures you control" : "each creature"} ${sign}${delta}/${sign}${delta}${effect.grantsTrample ? " and trample" : ""} until end of turn.`
          : `${sourceName} resolves with no creatures to affect.`
      );
    }

    case "draw_greatest_power_then_free_cast": {
      const count = greatestCreaturePower(caster, effect.excludeSubtype);
      let next = drawMultipleForSeat(session, casterSeatId, count, `${caster.name} draws ${count} card${count === 1 ? "" : "s"} from ${sourceName}.`);
      if (effect.freeCastMaxManaValue < 0) return next;
      // "You may cast a spell ... without paying its mana cost." There's no free-cast pipeline for a
      // spell resolving mid-resolution, so this takes the clean, always-legal subset: the best
      // PERMANENT in hand with a small enough mana value goes onto the battlefield. (Its ETB triggers
      // aren't run — a known simplification.) Instants/sorceries are left in hand.
      const handNow = next.seats.find((seat) => seat.id === casterSeatId)?.board.hand ?? [];
      const choice = handNow
        .filter((card) => !isLandCard(card) && !card.typeLine.includes("Instant") && !card.typeLine.includes("Sorcery") && card.manaValue <= effect.freeCastMaxManaValue)
        .sort((a, b) => b.manaValue - a.manaValue)[0];
      if (choice) {
        next = moveCardAcrossSeats(next, casterSeatId, choice.id, casterSeatId, "battlefield").session;
        next = rulesEvent(next, casterSeatId, `${caster.name} casts ${choice.name} without paying its mana cost from ${sourceName}.`);
      }
      return next;
    }

    case "shuffle_permanent_reveal_top": {
      const target = resolvePreChosenBattlefieldTarget(session, chosenTargets?.[0]) ?? chooseRemovalTarget(session, casterSeatId, "permanent", source);
      if (!target) return noLegalTargetEvent(session, casterSeatId, sourceName);
      const warded = payWardIfNeeded(session, casterSeatId, target.card, sourceName);
      if (warded.countered) return warded.session;
      const ownerSeatId = target.card.ownerSeatId ?? target.seatId;
      let next: GameSession;
      if (target.card.token) {
        // A token that leaves the battlefield ceases to exist — it never reaches the library.
        next = {
          ...warded.session,
          seats: warded.session.seats.map((seat) =>
            seat.id === target.seatId
              ? { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.filter((card) => card.id !== target.card.id) }, zones: { ...seat.zones, battlefield: Math.max(0, seat.zones.battlefield - 1) } }
              : seat
          )
        };
        return rulesEvent(next, casterSeatId, `${sourceName}: ${target.card.name} ceases to exist.`);
      }
      next = moveCardAcrossSeats(warded.session, target.seatId, target.card.id, ownerSeatId, "library", { libraryPosition: "top" }).session;
      next = {
        ...next,
        seats: next.seats.map((seat) => (seat.id === ownerSeatId ? { ...seat, library: shuffleCards(seat.library ?? []) } : seat))
      };
      next = rulesEvent(next, casterSeatId, `${sourceName} shuffles ${target.card.name} into its owner's library.`);
      const top = next.seats.find((seat) => seat.id === ownerSeatId)?.library?.[0];
      if (top && !top.typeLine.includes("Instant") && !top.typeLine.includes("Sorcery")) {
        next = moveCardAcrossSeats(next, ownerSeatId, top.id, ownerSeatId, "battlefield").session;
        next = rulesEvent(next, ownerSeatId, `${sourceName} reveals ${top.name}, a permanent card, and it's put onto the battlefield.`);
      } else if (top) {
        next = rulesEvent(next, ownerSeatId, `${sourceName} reveals ${top.name}, which stays on top of the library.`);
      }
      return next;
    }

    // Second Harvest: one creation event for every copy, so Chatterfang adds its Squirrels once, by count.
    case "copy_each_token_you_control": {
      const tokens = caster.board.battlefield.filter((card) => card.token && !card.phasedOut);
      if (tokens.length === 0) return rulesEvent(session, casterSeatId, `${sourceName} resolves, but ${caster.name} controls no tokens.`);
      const copied = createCopyTokensForSeat(session, casterSeatId, tokens, {}, source.id);
      return rulesEvent(copied.session, casterSeatId, `${sourceName}: ${caster.name} creates a token that's a copy of each of ${tokens.length} token${tokens.length === 1 ? "" : "s"} they control.`);
    }

    // Swarmyard Massacre: every creature outside the listed types gets -N/-N, N = how many creatures of the listed types the caster controls.
    case "shrink_others_per_own_of_types": {
      // Whole type line, not only the part after an em dash: a created token's type line uses a plain hyphen ("Token Creature - Squirrel").
      const inTypes = (card: VisibleCard) => card.typeLine.includes("Creature") && effect.types.some((type) => new RegExp(`\\b${type}\\b`, "i").test(card.typeLine));
      const amount = caster.board.battlefield.filter((card) => !card.phasedOut && inTypes(card)).length;
      if (amount <= 0) return rulesEvent(session, casterSeatId, `${sourceName}: ${caster.name} controls none of the listed creature types, so nothing shrinks.`);
      const seats = session.seats.map((seat) => ({
        ...seat,
        board: {
          ...seat.board,
          battlefield: seat.board.battlefield.map((card) =>
            card.typeLine.includes("Creature") && !card.phasedOut && !inTypes(card)
              ? { ...card, temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) - amount, temporaryToughnessBonus: (card.temporaryToughnessBonus ?? 0) - amount }
              : card
          )
        }
      }));
      return rulesEvent({ ...session, seats }, casterSeatId, `${sourceName}: each creature that isn't an ${effect.types.map(capitalizeWord).join(", ")} gets -${amount}/-${amount} until end of turn.`);
    }

    case "creature_damages_everything_else": {
      const chosenIgnitionDealer = resolvePreChosenBattlefieldTarget(session, chosenTargets?.[0]);
      const dealer = chosenIgnitionDealer && chosenIgnitionDealer.seatId === casterSeatId ? chosenIgnitionDealer.card : strongestControlledCreature(caster);
      const power = dealer ? Math.max(0, effectivePower(dealer)) : 0;
      if (!dealer || power <= 0) return noLegalTargetEvent(session, casterSeatId, sourceName);
      let next = session;
      for (const seat of session.seats) {
        for (const card of seat.board.battlefield) {
          if (card.id === dealer.id || !card.typeLine.includes("Creature")) continue;
          next = dealDamageToCreature(next, sourceName, seat.id, card.id, power, dealer, casterSeatId);
        }
      }
      for (const seat of session.seats) {
        if (seat.id === casterSeatId || seat.hasLost) continue;
        const current = next.seats.find((item) => item.id === seat.id);
        if (current) next = applyCombatDamageToTarget(next, sourceName, { seat: current }, power, dealer, casterSeatId, "noncombat");
      }
      return rulesEvent(next, casterSeatId, `${dealer.name} deals ${power} damage to each other creature and each opponent (${sourceName}).`);
    }

    case "creature_bites": {
      const chosenDealer = resolvePreChosenBattlefieldTarget(session, chosenTargets?.[0]);
      const chosenVictim = resolvePreChosenBattlefieldTarget(session, chosenTargets?.[1]);
      const dealer = chosenDealer && chosenDealer.seatId === casterSeatId ? chosenDealer.card : strongestControlledCreature(caster);
      const power = dealer ? Math.max(0, effectivePower(dealer)) : 0;
      if (!dealer || power <= 0) return noLegalTargetEvent(session, casterSeatId, sourceName);
      const target: DamageTarget | undefined = chosenVictim ? { kind: "creature", seatId: chosenVictim.seatId, card: chosenVictim.card } : chooseDamageTarget(session, casterSeatId, power, "creature", dealer);
      if (!target || target.kind !== "creature") return noLegalTargetEvent(session, casterSeatId, sourceName);
      const warded = payWardIfNeeded(session, casterSeatId, target.card, sourceName);
      if (warded.countered) return warded.session;
      const bitten = dealDamageToCreature(warded.session, sourceName, target.seatId, target.card.id, power, dealer, casterSeatId);
      // Ram Through: with trample on the creature you control, the damage past lethal goes to that creature's controller.
      const excess = effect.trampleExcess && hasKeyword(dealer, "trample") ? power - Math.max(0, effectiveToughness(target.card)) : 0;
      if (excess <= 0) return bitten;
      return rulesEvent(
        { ...bitten, seats: bitten.seats.map((seat) => (seat.id === target.seatId ? { ...seat, life: seat.life - excess } : seat)) },
        casterSeatId,
        `${sourceName} tramples over: ${excess} excess damage is dealt to ${bitten.seats.find((seat) => seat.id === target.seatId)?.name ?? "the controller"}.`
      );
    }

    case "draw_per_creature": {
      const count = caster.board.battlefield.filter((card) => card.typeLine.includes("Creature")).length;
      return count === 0 ? session : drawMultipleForSeat(session, casterSeatId, count, `${caster.name} draws ${count} card${count === 1 ? "" : "s"} from ${sourceName}.`);
    }

    case "gain_life_per_creature": {
      const count = caster.board.battlefield.filter((card) => card.typeLine.includes("Creature") && effectivePower(card) >= effect.minPower).length;
      if (count === 0) return session;
      const amount = count * effect.perCreature;
      return rulesEvent({ ...session, seats: session.seats.map((seat) => (seat.id === casterSeatId ? { ...seat, life: seat.life + amount } : seat)) }, casterSeatId, `${caster.name} gains ${amount} life from ${sourceName}.`);
    }

    case "grant_keywords":
      return applyRemovalEffect(session, casterSeatId, sourceName, source, { kind: "grant_keywords", keywords: effect.keywords }, undefined, chosenTargets?.[0]);

    case "grant_keywords_all_permanents":
      return rulesEvent(
        {
          ...session,
          seats: session.seats.map((seat) =>
            seat.id !== casterSeatId
              ? seat
              : {
                  ...seat,
                  board: {
                    ...seat.board,
                    battlefield: seat.board.battlefield.map((card) => ({
                      ...card,
                      temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), ...effect.keywords],
                      grantedKeywords: [...new Set([...(card.grantedKeywords ?? []), ...effect.keywords])]
                    }))
                  }
                }
          )
        },
        casterSeatId,
        `${sourceName}: permanents ${caster.name} controls gain ${effect.keywords.join(" and ")} until end of turn.`
      );

    case "each_other_player_sacrifices": {
      const destructions: Array<{ seatId: string; cardId: string; message: string }> = [];
      for (const other of session.seats) {
        if (other.id === casterSeatId || other.hasLost) continue;
        const victim = chooseSacrificeTargets(other, undefined, 1)?.[0];
        if (victim) destructions.push({ seatId: other.id, cardId: victim.id, message: `${other.name} sacrifices ${victim.name} to ${sourceName}.` });
      }
      let next = destroyCreatures(session, destructions, "Rules action");
      const specs = effect.tokenClause ? parseCreateTokenSpecs(effect.tokenClause) : [];
      if (specs.length > 0 && destructions.length > 0) {
        next = createTokensForSeat(next, casterSeatId, source.id, specs.map((spec) => ({ ...spec, count: spec.count * destructions.length }))).session;
      }
      return destructions.length === 0 ? noLegalTargetEvent(next, casterSeatId, sourceName) : next;
    }

    case "opponent_sacrifices_greatest_power": {
      // "Target opponent": the one whose best creature is the biggest, same threat bias as other untargeted picks.
      const options = session.seats
        .filter((other) => other.id !== casterSeatId && !other.hasLost)
        .map((other) => ({ other, best: strongestControlledCreature(other) }))
        .filter((item): item is { other: PlayerSeat; best: VisibleCard } => item.best !== undefined);
      const pickedOpponentId = chosenTargets?.[0]?.kind === "player" ? chosenTargets[0].seatId : undefined;
      if (options.length === 0) return noLegalTargetEvent(session, casterSeatId, sourceName);
      const chosen = options.find((item) => item.other.id === pickedOpponentId) ?? options.reduce((a, b) => (effectivePower(b.best) > effectivePower(a.best) ? b : a));
      return destroyCreatures(session, [{ seatId: chosen.other.id, cardId: chosen.best.id, message: `${chosen.other.name} sacrifices ${chosen.best.name} to ${sourceName}.` }], "Rules action");
    }

    case "you_and_opponent_draw": {
      // "Target opponent": the weakest (lowest life) one, so the symmetric draw doesn't feed the biggest threat.
      const opponents = session.seats.filter((other) => other.id !== casterSeatId && !other.hasLost);
      const pickedDrawOpponent = chosenTargets?.[0]?.kind === "player" ? opponents.find((other) => other.id === chosenTargets[0].seatId) : undefined;
      const target = pickedDrawOpponent ?? (opponents.length > 0 ? opponents.reduce((a, b) => (b.life < a.life ? b : a)) : undefined);
      let next = drawMultipleForSeat(session, casterSeatId, effect.amount, `${caster.name} draws ${effect.amount} card${effect.amount === 1 ? "" : "s"} from ${sourceName}.`);
      if (target) next = drawMultipleForSeat(next, target.id, effect.amount, `${target.name} draws ${effect.amount} card${effect.amount === 1 ? "" : "s"} from ${sourceName}.`);
      return next;
    }

    case "opponents_draw_then_you_draw": {
      const opponents = session.seats.filter((other) => other.id !== casterSeatId && !other.hasLost);
      let next = session;
      let drew = 0;
      for (const opponent of opponents) {
        if (!(opponent.library?.length ?? 0)) continue;
        next = drawForSeat(next, opponent.id, `${opponent.name} draws a card from ${sourceName}.`);
        drew += 1;
      }
      return drew > 0 ? drawMultipleForSeat(next, casterSeatId, drew, `${caster.name} draws ${drew} card${drew === 1 ? "" : "s"} from ${sourceName}.`) : next;
    }

    // Needs the live game's mana pool — see manaFromTappedOpponentLands.
    case "add_mana_per_tapped_opponent_land":
    case "add_restricted_mana":
      return session;
  }
}

export function noLegalTargetEvent(session: GameSession, seatId: string, sourceName: string): GameSession {
  return {
    ...session,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${sourceName} finds no legal target and has no effect.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

// Can this mode of a modal removal spell be taken at all? A targeted destroy/exile/bounce mode whose only legal targets are the caster's own
// permanents is not viable, so it is never taken just because it is legal.
export function removalModeViable(session: GameSession, casterSeatId: string, source: VisibleCard, mode: Exclude<RemovalEffect, { kind: "modal" }>): boolean {
  return (
    removalEffectHasLegalTarget(session, casterSeatId, source, mode) &&
    (mode.kind === "destroy"
      ? chooseRemovalTarget(session, casterSeatId, mode.targetType, source, mode.excludedColors, mode.artifactsExcluded, mode.basicsExcluded, true, mode.minToughness, true) !== undefined
      : mode.kind === "exile" || mode.kind === "bounce"
        ? chooseRemovalTarget(session, casterSeatId, mode.targetType, source, [], false, false, false, undefined, true) !== undefined
        : true)
  );
}

// How good a mode is for its caster: what a sweeper takes from OPPONENTS minus what it takes from the caster. Single-target
// modes just score a flat 1 (their legality is already checked).
export function removalModeScore(session: GameSession, casterSeatId: string, mode: Exclude<RemovalEffect, { kind: "modal" }>): number {
  const worth = (card: VisibleCard) => (card.typeLine.includes("Creature") ? 1 + Math.max(0, effectivePower(card)) + Math.max(0, effectiveToughness(card)) : Math.max(1, card.manaValue));
  const sweep = (matches: (card: VisibleCard) => boolean) =>
    session.seats.reduce(
      (total, seat) => total + seat.board.battlefield.filter((card) => matches(card) && !hasIndestructible(card)).reduce((sum, card) => sum + (seat.id === casterSeatId ? -worth(card) : worth(card)), 0),
      0
    );
  if (mode.kind === "destroy_all") {
    if (mode.targetType === "creature") return sweep((card) => card.typeLine.includes("Creature") && (!mode.onlyType || card.typeLine.toLowerCase().includes(mode.onlyType)) && !cardMatchesExcludedType(card, mode.excludeType) && !cardMatchesExcludedColor(card, mode.excludedColors));
    if (mode.targetType === "artifact") return sweep((card) => card.typeLine.includes("Artifact"));
    if (mode.targetType === "enchantment") return sweep((card) => card.typeLine.includes("Enchantment"));
    return sweep((card) => card.typeLine.includes("Artifact") || card.typeLine.includes("Enchantment"));
  }
  if (mode.kind === "destroy_all_conditional") {
    return sweep((card) => card.typeLine.includes("Creature") && (mode.comparison === "or_less" ? card.manaValue <= mode.threshold : card.manaValue >= mode.threshold));
  }
  if (mode.kind === "grant_keywords") return 0.5;
  return 1;
}

// Rule 117.6/702.13c: a spell whose only legal target(s) would be countered by ward, the caster
// can't pay for, or that's otherwise hexproof/protected/shrouded, effectively targets nothing —
// mirrors the same "no legal target = illegal to cast" check as hasResolvableRemovalTarget, one
// level deeper (per-mode, so a modal spell's still-viable modes are checked individually).
export function removalEffectHasLegalTarget(session: GameSession, casterSeatId: string, sourceCard: VisibleCard, effect: RemovalEffect): boolean {
  switch (effect.kind) {
    case "destroy_all":
    case "destroy_all_conditional":
      return true;
    case "destroy":
      return chooseRemovalTarget(session, casterSeatId, effect.targetType, sourceCard, effect.excludedColors, effect.artifactsExcluded, effect.basicsExcluded, true, effect.minToughness, effect.opponentOnly) !== undefined;
    // Rule 601.2c: "up to X" never requires a legal target — choosing zero is always legal, same
    // reasoning as proliferate's "choose any number" just below.
    case "destroy_up_to_x":
      return true;
    case "exile":
    case "bounce":
      return chooseRemovalTarget(session, casterSeatId, effect.targetType, sourceCard) !== undefined;
    case "damage":
      return chooseDamageTarget(session, casterSeatId, effect.amount === "X" ? 0 : effect.amount, effect.targetType, sourceCard) !== undefined;
    case "mass_damage":
      return true;
    // Proliferate never fails for lack of a target the way destroy/exile/damage do — "choose any
    // number" legally includes choosing none, so it's always at least a legal (if sometimes
    // pointless) mode, same as the unconditional mass-effect kinds above.
    case "proliferate":
    case "draw_then_land":
      return true;
    case "grant_keywords":
      return chooseCounterTarget(session, casterSeatId, "+1/+1", false) !== undefined;
    case "modal":
      return effect.modes.some((mode) => removalEffectHasLegalTarget(session, casterSeatId, sourceCard, mode));
  }
}

export function zoneEffectHasLegalTarget(session: GameSession, casterSeatId: string, effect: ZoneEffect): boolean {
  switch (effect.kind) {
    case "reanimate":
      return chooseReanimationTarget(session, casterSeatId, effect.anyGraveyard, effect.targetType) !== undefined;
    case "regrow":
      return chooseRegrowTarget(session, casterSeatId, effect.targetType, effect.subtype) !== undefined;
    case "gain_control":
      return chooseControlTarget(session, casterSeatId) !== undefined;
    case "sacrifice_then_reanimate":
      return chooseCreatureCardsFromOwnGraveyard(session, casterSeatId, effect.targetCount) !== undefined;
    case "return_all_to_battlefield":
    case "mill":
    case "put_land_from_graveyard_on_top":
    case "graveyard_to_library":
    case "exile_graveyard":
    case "impulse_draw":
    case "steal_and_play":
    case "draw_x_then_put_back":
    case "surveil":
    case "look_dig":
      return true;
  }
}

// Rule 702.13c: a permanent with ward counters a spell/ability that targets it unless that spell's
// controller pays the ward cost. No interactive "do you want to pay" prompt exists anywhere else in
// this engine's deterministic targeting (every choice here is auto-resolved), so this mirrors that:
// auto-attempt payment from the caster's untapped mana, same as the existing counterspell-tax
// payment in resolvePendingAction's counterTargetId branch. Unpayable means the effect is countered.
// Every targeted spell/ability goes through here, so it is also where "becomes the target" watchers are checked.
export function payWardIfNeeded(session: GameSession, casterSeatId: string, targetCard: VisibleCard, sourceName: string): { session: GameSession; countered: boolean } {
  const result = payWardIfNeededCore(session, casterSeatId, targetCard, sourceName);
  return { ...result, session: applyBecomesTargetTriggers(result.session, casterSeatId, targetCard, sourceName) };
}

// "Whenever a Dragon you control becomes the target of a spell or ability an opponent controls, this creature deals 3 damage to
// that player." (Thunderbreak Regent)
function applyBecomesTargetTriggers(session: GameSession, casterSeatId: string, targetCard: VisibleCard, sourceName: string): GameSession {
  let next = session;
  const controller = session.seats.find((seat) => seat.board.battlefield.some((card) => card.id === targetCard.id));
  if (!controller || controller.id === casterSeatId) return session;
  for (const watcher of controller.board.battlefield) {
    if ((watcher.abilitiesStripped || watcher.phasedOut)) continue;
    for (const clause of oracleClauses(watcher.oracleText)) {
      const match = clause.match(/^whenever an? ([a-z]+) you control becomes the target of a spell or ability an opponent controls, this creature deals (\d+) damage to that player\b/i);
      if (!match || !permanentMatchesQualifier(targetCard, match[1])) continue;
      const amount = Number.parseInt(match[2], 10);
      next = rulesEvent(
        { ...next, seats: next.seats.map((seat) => (seat.id === casterSeatId ? { ...seat, life: seat.life - amount } : seat)) },
        controller.id,
        `${watcher.name} deals ${amount} damage to ${next.seats.find((seat) => seat.id === casterSeatId)?.name ?? "the opponent"} for targeting ${targetCard.name} with ${sourceName}.`
      );
    }
  }
  return next;
}

function payWardIfNeededCore(session: GameSession, casterSeatId: string, targetCard: VisibleCard, sourceName: string): { session: GameSession; countered: boolean } {
  const wardCost = cardWardAmount(targetCard.oracleText);
  const lifeWard = wardLifeAmount(targetCard.oracleText);
  const casterSeat = session.seats.find((seat) => seat.id === casterSeatId);
  // "Ward—Pay 2 life." (Zul Ashur): pay the life if it wouldn't be fatal, otherwise the spell/ability is countered.
  if (lifeWard !== undefined && wardCost === undefined && casterSeat && casterSeat.id !== (targetCard.ownerSeatId ?? "")) {
    const affordable = casterSeat.life > lifeWard;
    const result: GameSession = affordable
      ? { ...session, seats: session.seats.map((seat) => (seat.id === casterSeatId ? { ...seat, life: seat.life - lifeWard } : seat)) }
      : session;
    return {
      session: rulesEvent(
        result,
        casterSeatId,
        affordable ? `${casterSeat.name} pays ${lifeWard} life for ${targetCard.name}'s ward.` : `${targetCard.name}'s ward counters ${sourceName}: ${casterSeat.name} can't pay ${lifeWard} life.`
      ),
      countered: !affordable
    };
  }
  // "Ward—Sacrifice a Food." (Ygra, Eater of All): the targeting player sacrifices a Food they control (a real Food, or any creature made a Food by
  // Ygra itself), or the spell/ability is countered. The cheapest Food goes: a true Food first, then the weakest creature.
  if (/\bward\s*[—-]\s*sacrifice an? food\b/i.test(targetCard.oracleText) && casterSeat && casterSeat.id !== (targetCard.ownerSeatId ?? "")) {
    const foods = casterSeat.board.battlefield.filter((permanent) => permanent.id !== targetCard.id && hasCardType(permanent, "Food"));
    // Rank: a real Food (its own type line says Food) first, then the lowest mana value.
    const wardRank = (permanent: VisibleCard) => (permanent.typeLine.includes("Food") ? 0 : 1000) + permanent.manaValue;
    const food = [...foods].sort((a, b) => wardRank(a) - wardRank(b))[0];
    if (!food) {
      return { session: rulesEvent(session, casterSeatId, `${targetCard.name}'s ward counters ${sourceName}: ${casterSeat.name} has no Food to sacrifice.`), countered: true };
    }
    return {
      session: destroyCreatures(
        rulesEvent(session, casterSeatId, `${casterSeat.name} sacrifices ${food.name} to pay ${targetCard.name}'s ward.`),
        [{ seatId: casterSeatId, cardId: food.id, message: `${casterSeat.name} sacrifices ${food.name} to pay ${targetCard.name}'s ward.` }],
        "Rules action"
      ),
      countered: false
    };
  }
  if (wardCost === undefined || wardCost <= 0) return { session, countered: false };
  if (!casterSeat) return { session, countered: false };
  const payment = chooseManaSourcesForCost(casterSeat, genericCostShim(wardCost), wardCost, undefined, session.seats);
  if (!payment.ok) {
    return {
      session: {
        ...session,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: casterSeatId,
            message: `${targetCard.name}'s ward counters ${sourceName}: ${casterSeat.name} can't pay {${wardCost}}.`,
            detail: "Rules action"
          },
          ...session.events
        ]
      },
      countered: true
    };
  }
  return {
    session: {
      ...session,
      seats: session.seats.map((seat) => (seat.id === casterSeatId ? spendManaSources(seat, payment.sourceIds) : seat)),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: casterSeatId,
          message: `${casterSeat.name} pays ${targetCard.name}'s ward {${wardCost}}.`,
          detail: "Rules action"
        },
        ...session.events
      ]
    },
    countered: false
  };
}

// "nontoken" (destroy_all/mass_damage's excludeType) is the one qualifier that can't be read off
// typeLine at all — a token's typeLine looks identical to a nontoken permanent of the same type, so
// it needs the separate `token` flag instead. Every other qualifier this codebase's real card pool
// uses ("dragon," "artifact," "legendary," "land," ...) is a plain typeLine substring.
function cardMatchesExcludedType(card: VisibleCard, excludeType: string | undefined): boolean {
  if (!excludeType) return false;
  if (excludeType === "token") return Boolean(card.token);
  return card.typeLine.toLowerCase().includes(excludeType);
}

function cardMatchesExcludedColor(card: VisibleCard, excludedColors: string[]): boolean {
  if (excludedColors.length === 0) return false;
  return excludedColors.some((color) => card.colors.includes(PROTECTION_COLOR_CODE[color]));
}

// A human's own pick from choose_effect_target, threaded through in place of chooseRemovalTarget's/
// chooseDamageTarget's heuristic — mirrors payGenericSacrificeCost's existing preChosenSacrificeTargets
// param exactly. Always undefined for an agent seat (they never open that choice), so this changes
// nothing about agent behavior. Re-derives the live card (rather than trusting a stale reference)
// since some time may have passed between the choice opening and the human clicking a target.
export function resolvePreChosenBattlefieldTarget(session: GameSession, preChosenTarget?: ChosenTarget): { seatId: string; card: VisibleCard } | undefined {
  if (!preChosenTarget || preChosenTarget.kind !== "card") return undefined;
  const seat = session.seats.find((item) => item.id === preChosenTarget.seatId);
  const card = seat?.board.battlefield.find((item) => item.id === preChosenTarget.cardId);
  return seat && card ? { seatId: seat.id, card } : undefined;
}

export function applyRemovalEffect(
  session: GameSession,
  casterSeatId: string,
  sourceName: string,
  source: VisibleCard,
  effect: RemovalEffect,
  chosenX?: number,
  preChosenTarget?: ChosenTarget
): GameSession {
  switch (effect.kind) {
    case "destroy_all": {
      const destructions: Array<{ seatId: string; cardId: string; message: string }> = [];
      // Rule 702.12b/704.5g: destroying a permanent with indestructible doesn't destroy it — a
      // board wipe still resolves, it just leaves indestructible permanents (Toski, Bearer of
      // Secrets, ...) standing, same as combat damage already correctly leaves them alive (see
      // hasIndestructible's other call sites). Reported live as Generous Gift (the single-target
      // "destroy" case just below) destroying an indestructible creature outright.
      const typeMatches = (card: VisibleCard) => {
        const baseMatch =
          effect.targetType === "creature"
            ? card.typeLine.includes("Creature")
            : effect.targetType === "artifact"
              ? card.typeLine.includes("Artifact")
              : effect.targetType === "artifact_or_enchantment"
                ? card.typeLine.includes("Artifact") || card.typeLine.includes("Enchantment")
                : card.typeLine.includes("Enchantment");
        return (
          baseMatch &&
          (effect.exile || !hasIndestructible(card)) &&
          (!effect.onlyType || card.typeLine.toLowerCase().includes(effect.onlyType)) &&
          !cardMatchesExcludedType(card, effect.excludeType) &&
          !cardMatchesExcludedColor(card, effect.excludedColors) &&
          (!effect.requireTapped || Boolean(card.tapped)) &&
          (!effect.requireKeyword || hasKeyword(card, effect.requireKeyword))
        );
      };
      for (const seat of session.seats) {
        for (const card of seat.board.battlefield) {
          if (typeMatches(card)) destructions.push({ seatId: seat.id, cardId: card.id, message: `${card.name} is destroyed by ${sourceName}.` });
        }
      }
      if (effect.exile) {
        return destructions.reduce((current, item) => moveCardBetweenVisibleZones(current, item.seatId, item.cardId, "exile"), session);
      }
      const destroyedAll = destroyCreatures(session, destructions, "Rules action");
      if (!effect.drawPerDestroyed || destructions.length === 0) return destroyedAll;
      // Decree of Pain: one card per creature that really left the battlefield (an indestructible one never made the list; a replaced death does not count).
      const remaining = new Set(destroyedAll.seats.flatMap((seat) => seat.board.battlefield.map((card) => card.id)));
      const died = destructions.filter((item) => !remaining.has(item.cardId)).length;
      const caster = destroyedAll.seats.find((seat) => seat.id === casterSeatId);
      return died > 0 && caster ? drawMultipleForSeat(destroyedAll, casterSeatId, died, `${caster.name} draws ${died} card${died === 1 ? "" : "s"} from ${sourceName}.`) : destroyedAll;
    }
    case "mass_damage": {
      // X read from the board BEFORE any damage is dealt (Chain Reaction counts creatures as it
      // resolves, not as each one dies), or from the caster's chosen {X} when it's a cost.
      const amount = effect.amount === "X" ? (effect.xDefinition ? resolveDynamicAmount(session, casterSeatId, effect.xDefinition) : chosenX ?? 0) : effect.amount;
      if (amount <= 0) return noLegalTargetEvent(session, casterSeatId, sourceName);
      const targets: Array<{ seatId: string; cardId: string }> = [];
      const planeswalkerTargets: Array<{ seat: PlayerSeat; card: VisibleCard }> = [];
      for (const seat of session.seats) {
        if (effect.scope === "opponents" && seat.id === casterSeatId) continue;
        for (const card of seat.board.battlefield) {
          if (effect.includePlaneswalkers && card.typeLine.includes("Planeswalker")) {
            planeswalkerTargets.push({ seat, card });
            continue;
          }
          if (!card.typeLine.includes("Creature")) continue;
          if (cardMatchesExcludedType(card, effect.excludeType)) continue;
          if (effect.excludeFlying && hasFlying(card)) continue;
          targets.push({ seatId: seat.id, cardId: card.id });
        }
      }
      if (targets.length === 0 && planeswalkerTargets.length === 0 && !effect.includePlayers) return noLegalTargetEvent(session, casterSeatId, sourceName);
      // No payWardIfNeeded here (unlike the single-"target creature" damage case below) — a mass
      // effect like this never targets any individual creature (rule 601.2c doesn't apply), so ward
      // — which only triggers on being targeted — never fires for it.
      const creaturesDamaged = targets.reduce((current, target) => dealDamageToCreature(current, sourceName, target.seatId, target.cardId, amount, source, casterSeatId), session);
      const withPlaneswalkers = planeswalkerTargets.reduce(
        (current, target) => applyCombatDamageToTarget(current, sourceName, { seat: target.seat, planeswalker: target.card }, amount, source, casterSeatId, "noncombat"),
        creaturesDamaged
      );
      // "...and each opponent": the players take it too.
      const damaged = effect.includePlayers
        ? session.seats
            .filter((seat) => !seat.hasLost && (effect.includePlayers === "all" || seat.id !== casterSeatId))
            .reduce((current, seat) => applyCombatDamageToTarget(current, sourceName, { seat: current.seats.find((item) => item.id === seat.id)! }, amount, source, casterSeatId, "noncombat"), withPlaneswalkers)
        : withPlaneswalkers;
      return {
        ...damaged,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: casterSeatId,
            message: `${sourceName} deals ${amount} damage to each ${effect.excludeType ? `non-${effect.excludeType} ` : ""}creature${effect.scope === "opponents" ? " you don't control" : ""}.`,
            detail: "Rules action"
          },
          ...damaged.events
        ]
      };
    }
    case "destroy_all_conditional": {
      const destructions: Array<{ seatId: string; cardId: string; message: string }> = [];
      for (const seat of session.seats) {
        for (const card of seat.board.battlefield) {
          if (!card.typeLine.includes("Creature") || hasIndestructible(card)) continue;
          const meetsThreshold = effect.comparison === "or_less" ? card.manaValue <= effect.threshold : card.manaValue >= effect.threshold;
          if (meetsThreshold) destructions.push({ seatId: seat.id, cardId: card.id, message: `${card.name} is destroyed by ${sourceName}.` });
        }
      }
      return destroyCreatures(session, destructions, "Rules action");
    }
    // applyRemovalEffect is a pure function with no access to setPendingRuleChoice, so this is only
    // ever the deterministic/agent fallback — a human choosing this specific mode is intercepted
    // BEFORE this function is ever called (see the modal mode-choice dispatch, which opens
    // choose_proliferate_targets instead of reaching this case at all for a human controller).
    case "proliferate":
      return resolveProliferate(session);
    // Insidious Fungus: draw, then you may put a land card from your hand onto the battlefield tapped (a human chooses which land, or none).
    case "draw_then_land":
      return applyDrawThenLand(session, casterSeatId, sourceName);
    // Protective mode: your best creature gains the keywords until end of turn (hexproof/indestructible resolve on the next state pass).
    case "grant_keywords": {
      const picked = resolvePreChosenBattlefieldTarget(session, preChosenTarget);
      const target = picked && picked.seatId === casterSeatId ? { seatId: picked.seatId, card: picked.card } : chooseCounterTarget(session, casterSeatId, "+1/+1", false);
      if (!target) return noLegalTargetEvent(session, casterSeatId, sourceName);
      return rulesEvent(
        {
          ...session,
          seats: session.seats.map((seat) =>
            seat.id !== target.seatId
              ? seat
              : {
                  ...seat,
                  board: {
                    ...seat.board,
                    battlefield: seat.board.battlefield.map((card) =>
                      card.id === target.card.id ? { ...card, temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), ...effect.keywords], grantedKeywords: [...new Set([...(card.grantedKeywords ?? []), ...effect.keywords])] } : card
                    )
                  }
                }
          )
        },
        casterSeatId,
        `${sourceName} gives ${target.card.name} ${effect.keywords.join(" and ")} until end of turn.`
      );
    }
    case "modal": {
      // No target-selection UI exists here any more than elsewhere in this file's deterministic
      // targeting — skip modes with nothing to do (an empty-graveyard reanimate-shaped mode, a
      // damage mode with no target) rather than burning a "choose N" slot on a guaranteed no-op,
      // and take the first `chooseCount` modes that do have something to do.
      // A targeted destroy/exile/bounce mode whose only legal targets are the caster's own permanents (Collective Resistance destroying your own
      // Commander's Sphere) is skipped, not taken just because it is legal.
      const viableModes = effect.modes.filter((mode) => removalModeViable(session, casterSeatId, source, mode));
      // Best modes first (by what each sweeps away from opponents vs from you) instead of printed order: Austere Command
      // always destroyed artifacts and enchantments, your own included, and could never pick the creature modes.
      const chosenModes = viableModes
        .map((mode) => ({ mode, score: removalModeScore(session, casterSeatId, mode) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, effect.chooseCount)
        .map((entry) => entry.mode);
      if (chosenModes.length === 0) return noLegalTargetEvent(session, casterSeatId, sourceName);
      return chosenModes.reduce((current, mode) => applyRemovalEffect(current, casterSeatId, sourceName, source, mode, chosenX), session);
    }
    // "Destroy up to X target artifacts and/or enchantments." (Pest Infestation) — rule 601.2c: "up
    // to X" never requires a legal target at all (see removalEffectHasLegalTarget's own "true"
    // return for this case), so X = 0 or a board with nothing to destroy both legally resolve as a
    // no-op rather than a failed cast. No dedicated interactive multi-select UI exists for this yet
    // (removalEffectTargetSpec returns undefined for this kind, so the human never gets intercepted
    // into choose_effect_target for it — same declared-simplification boundary this file already
    // accepts for destroy_all/mass_damage/proliferate/scry/surveil, applied uniformly to every seat
    // kind rather than half-building a new multi-target picker for one card): picks up to `chosenX`
    // targets one at a time via chooseRemovalTarget's existing biggest-first heuristic, each pick
    // naturally excluding whatever the previous pick already destroyed since `current` is threaded
    // through the loop.
    case "destroy_up_to_x": {
      const totalTargets = Math.max(0, chosenX ?? 0);
      if (totalTargets === 0) return session;
      let current = session;
      let destroyedAny = false;
      for (let picked = 0; picked < totalTargets; picked += 1) {
        const target = chooseRemovalTarget(current, casterSeatId, effect.targetType, source);
        if (!target) break;
        const warded = payWardIfNeeded(current, casterSeatId, target.card, sourceName);
        if (warded.countered) {
          current = warded.session;
          continue;
        }
        if (hasIndestructible(target.card)) {
          current = {
            ...warded.session,
            events: [
              {
                id: crypto.randomUUID(),
                at: new Date().toISOString(),
                seatId: casterSeatId,
                message: `${target.card.name} is indestructible; ${sourceName} fails to destroy it.`,
                detail: "Rules action"
              },
              ...warded.session.events
            ]
          };
          continue;
        }
        current = destroyCreatures(warded.session, [{ seatId: target.seatId, cardId: target.card.id, message: `${target.card.name} is destroyed by ${sourceName}.` }], "Rules action");
        destroyedAny = true;
      }
      return destroyedAny ? current : noLegalTargetEvent(current, casterSeatId, sourceName);
    }
    case "destroy": {
      const target =
        resolvePreChosenBattlefieldTarget(session, preChosenTarget) ??
        chooseRemovalTarget(session, casterSeatId, effect.targetType, source, effect.excludedColors, effect.artifactsExcluded, effect.basicsExcluded, true, effect.minToughness, effect.opponentOnly);
      if (!target) return noLegalTargetEvent(session, casterSeatId, sourceName);
      const warded = payWardIfNeeded(session, casterSeatId, target.card, sourceName);
      if (warded.countered) return warded.session;
      // Rule 702.12b/704.5g: indestructible doesn't make a permanent an illegal target (unlike
      // hexproof/shroud/protection, which chooseRemovalTarget already filters out above) — the
      // spell still resolves and still spends ward if the target had it, it just fails to actually
      // destroy anything. Reported live as Generous Gift destroying Toski, Bearer of Secrets outright.
      if (hasIndestructible(target.card)) {
        return {
          ...warded.session,
          events: [
            {
              id: crypto.randomUUID(),
              at: new Date().toISOString(),
              seatId: casterSeatId,
              message: `${target.card.name} is indestructible; ${sourceName} fails to destroy it.`,
              detail: "Rules action"
            },
            ...warded.session.events
          ]
        };
      }
      let destroyedSession = destroyCreatures(warded.session, [{ seatId: target.seatId, cardId: target.card.id, message: `${target.card.name} is destroyed by ${sourceName}.` }], "Rules action");
      // Feed the Swarm: "You lose life equal to that permanent's mana value." — the caster loses it, even if
      // the target had been indestructible-free; read off the target card captured before destruction.
      if (effect.casterLosesLifeEqualToManaValue) {
        const lifeLoss = Math.max(0, target.card.manaValue);
        if (lifeLoss > 0) {
          destroyedSession = {
            ...destroyedSession,
            seats: destroyedSession.seats.map((seat) => (seat.id === casterSeatId ? { ...seat, life: seat.life - lifeLoss } : seat)),
            events: [
              {
                id: crypto.randomUUID(),
                at: new Date().toISOString(),
                seatId: casterSeatId,
                message: `${destroyedSession.seats.find((seat) => seat.id === casterSeatId)?.name ?? "Player"} loses ${lifeLoss} life from ${sourceName} (${target.card.name}'s mana value).`,
                detail: "Rules action"
              },
              ...destroyedSession.events
            ]
          };
        }
      }
      // Saw in Half: "If that creature dies this way, its controller creates two tokens that are copies of that creature, except their power is half
      // that creature's power and their toughness is half that creature's toughness. Round up each time." Power/toughness are what it had as it died.
      if (effect.controllerCopiesHalved) {
        const stillThere = destroyedSession.seats.some((seat) => seat.board.battlefield.some((card) => card.id === target.card.id));
        if (stillThere) return destroyedSession;
        const half = (value: number) => String(Math.ceil(Math.max(0, value) / 2));
        const power = half(effectivePower(target.card));
        const toughness = half(effectiveToughness(target.card));
        const copies = createCopyTokensForSeat(destroyedSession, target.seatId, [target.card, target.card], {}, source.id);
        const copyIds = new Set(copies.tokens.map((token) => token.id));
        const halved: GameSession = {
          ...copies.session,
          seats: copies.session.seats.map((seat) =>
            seat.id !== target.seatId ? seat : { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (copyIds.has(card.id) ? { ...card, power, toughness } : card)) } }
          )
        };
        return rulesEvent(halved, casterSeatId, `${sourceName}: ${target.card.name} dies, and its controller creates two token copies of it with ${power}/${toughness}.`);
      }
      // "Its controller investigates." (Fateful Absence) — the Clue goes to whoever controlled the
      // destroyed permanent, not to the caster.
      if (!effect.controllerInvestigates) return destroyedSession;
      return createTokensForSeat(destroyedSession, target.seatId, source.id, [predefinedTokenSpec("Clue")]).session;
    }
    case "exile": {
      const target = resolvePreChosenBattlefieldTarget(session, preChosenTarget) ?? chooseRemovalTarget(session, casterSeatId, effect.targetType, source);
      if (!target) return noLegalTargetEvent(session, casterSeatId, sourceName);
      const warded = payWardIfNeeded(session, casterSeatId, target.card, sourceName);
      if (warded.countered) return warded.session;
      // Swords to Plowshares' "Its controller gains life equal to its power" — power is read off the
      // target BEFORE it's exiled (effectivePower already accounts for +1/+1 counters, pumps, and
      // other continuous effects live on the battlefield; once exiled none of that state exists).
      const lifeGain = effect.lifeGainToControllerEqualToPower ? Math.max(0, effectivePower(target.card)) : 0;
      const exiledSession = moveCardBetweenVisibleZones(warded.session, target.seatId, target.card.id, "exile");
      if (lifeGain <= 0) return exiledSession;
      return {
        ...exiledSession,
        seats: exiledSession.seats.map((seat) => (seat.id === target.seatId ? { ...seat, life: seat.life + lifeGain } : seat)),
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: target.seatId,
            message: `${exiledSession.seats.find((seat) => seat.id === target.seatId)?.name ?? "Player"} gains ${lifeGain} life from ${sourceName}.`,
            detail: "Rules action"
          },
          ...exiledSession.events
        ]
      };
    }
    case "damage": {
      const amount = effect.amount === "X" ? (effect.xDefinition ? resolveDynamicAmount(session, casterSeatId, effect.xDefinition) : chosenX ?? 0) : effect.amount;
      if (amount <= 0) return noLegalTargetEvent(session, casterSeatId, sourceName);
      // "...and you gain X life" (Consuming Corruption, Tendrils of Corruption): the same X, gained
      // by the caster whether or not the damage ended up being dealt to something.
      const withLifeGain = (resolved: GameSession): GameSession =>
        effect.alsoGainLife
          ? {
              ...resolved,
              seats: resolved.seats.map((seat) => (seat.id === casterSeatId ? { ...seat, life: seat.life + amount } : seat)),
              events: [
                {
                  id: crypto.randomUUID(),
                  at: new Date().toISOString(),
                  seatId: casterSeatId,
                  message: `${resolved.seats.find((seat) => seat.id === casterSeatId)?.name ?? "Player"} gains ${amount} life from ${sourceName}.`,
                  detail: "Rules action"
                },
                ...resolved.events
              ]
            }
          : resolved;
      const preChosenDamageTarget: DamageTarget | undefined =
        preChosenTarget?.kind === "card"
          ? (() => {
              const battlefieldTarget = resolvePreChosenBattlefieldTarget(session, preChosenTarget);
              return battlefieldTarget ? { kind: "creature" as const, seatId: battlefieldTarget.seatId, card: battlefieldTarget.card } : undefined;
            })()
          : preChosenTarget?.kind === "player"
            ? (() => {
                const seat = session.seats.find((item) => item.id === preChosenTarget.seatId);
                return seat ? { kind: "player" as const, seat } : undefined;
              })()
            : undefined;
      const target = preChosenDamageTarget ?? chooseDamageTarget(session, casterSeatId, amount, effect.targetType, source);
      if (!target) return noLegalTargetEvent(session, casterSeatId, sourceName);
      if (target.kind === "creature") {
        const warded = payWardIfNeeded(session, casterSeatId, target.card, sourceName);
        if (warded.countered) return warded.session;
        return withLifeGain(dealDamageToCreature(warded.session, sourceName, target.seatId, target.card.id, amount, source, casterSeatId));
      }
      return withLifeGain(applyCombatDamageToTarget(session, sourceName, { seat: target.seat }, amount, source, casterSeatId, "noncombat"));
    }
    case "bounce": {
      const target = resolvePreChosenBattlefieldTarget(session, preChosenTarget) ?? chooseRemovalTarget(session, casterSeatId, effect.targetType, source);
      if (!target) return noLegalTargetEvent(session, casterSeatId, sourceName);
      const warded = payWardIfNeeded(session, casterSeatId, target.card, sourceName);
      if (warded.countered) return warded.session;
      // Goes to its OWNER's hand, not necessarily its current controller's (rule: bounce always
      // targets the owner) — relevant once a control-changing effect has already moved it.
      const ownerSeatId = target.card.ownerSeatId ?? target.seatId;
      const { session: bouncedSession } = moveCardAcrossSeats(warded.session, target.seatId, target.card.id, ownerSeatId, "hand");
      return {
        ...bouncedSession,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: casterSeatId,
            message: `${sourceName} returns ${target.card.name} to its owner's hand.`,
            detail: "Rules action"
          },
          ...bouncedSession.events
        ]
      };
    }
  }
}

function matchesReanimateTargetType(card: VisibleCard, targetType: RegrowTargetType): boolean {
  if (targetType === "enchantment") return card.typeLine.includes("Enchantment");
  if (targetType === "artifact") return card.typeLine.includes("Artifact");
  if (targetType === "land") return card.typeLine.includes("Land");
  // Sun Titan: "return target permanent card ... from your graveyard to the battlefield" — any
  // permanent type qualifies (a graveyard can also hold Instants/Sorceries, which don't), not just
  // creatures; this used to fall through to the "creature" default below and wrongly restrict Sun
  // Titan to creature cards only.
  if (targetType === "permanent") return !card.typeLine.includes("Instant") && !card.typeLine.includes("Sorcery");
  // Fathomless descent (Squirming Emergence, ...): "target nonland permanent card" — same as
  // "permanent" above, further excluding lands.
  if (targetType === "nonland_permanent") return !card.typeLine.includes("Instant") && !card.typeLine.includes("Sorcery") && !card.typeLine.includes("Land");
  return card.typeLine.includes("Creature");
}

// Best available creature by combined effective power+toughness — mirrors chooseRemovalTarget's
// "biggest is the meaningful pick" convention, reused here for "biggest is worth reanimating." A
// non-creature targetType (Starfield of Nyx's "target enchantment card", ...) has no power/toughness
// to rank by, so mana value stands in as the "more impactful" proxy instead. Any graveyard is
// searched when anyGraveyard is true (Reanimate); otherwise only the caster's own. targetType
// defaults to "creature" so the Aura-reanimation call site (Animate Dead's "Enchant creature card in
// a graveyard") keeps its existing behavior unchanged.
export function chooseReanimationTarget(
  session: GameSession,
  casterSeatId: string,
  anyGraveyard: boolean,
  targetType: RegrowTargetType = "creature",
  // Fathomless descent's dynamic ceiling ("...with mana value less than or equal to the number of
  // permanent cards in your graveyard") — computed by the caller (applyZoneEffect's "reanimate"
  // case) from actual board state at resolution time, not guessed at here.
  maxManaValue?: number
): { seatId: string; card: VisibleCard } | undefined {
  const candidates: Array<{ seatId: string; card: VisibleCard }> = [];
  for (const seat of session.seats) {
    if (!anyGraveyard && seat.id !== casterSeatId) continue;
    for (const card of seat.board.graveyard ?? []) {
      if (!matchesReanimateTargetType(card, targetType)) continue;
      if (maxManaValue !== undefined && card.manaValue > maxManaValue) continue;
      candidates.push({ seatId: seat.id, card });
    }
  }
  if (candidates.length === 0) return undefined;
  if (targetType !== "creature") {
    return candidates.reduce((a, b) => (b.card.manaValue > a.card.manaValue ? b : a));
  }
  return candidates.reduce((a, b) => (effectivePower(b.card) + effectiveToughness(b.card) > effectivePower(a.card) + effectiveToughness(a.card) ? b : a));
}

// Victimize's "choose N target creature cards in your graveyard" half — a MULTI-target pick, unlike
// chooseReanimationTarget above (always exactly one card), so it needs its own selection: highest
// combined power+toughness first, same "biggest is best" bias used everywhere else in this file.
// Returns undefined if there aren't count legal creature-card targets, matching rule 601.2c: the
// spell can't be cast at all without them (contrast the separate sacrifice half, which — per this
// card's actual templating, not an additional cost — can legally fail and just do nothing instead).
export function chooseCreatureCardsFromOwnGraveyard(session: GameSession, casterSeatId: string, count: number): VisibleCard[] | undefined {
  const seat = session.seats.find((item) => item.id === casterSeatId);
  const candidates = (seat?.board.graveyard ?? []).filter((card) => card.typeLine.includes("Creature"));
  if (candidates.length < count) return undefined;
  return [...candidates].sort((a, b) => effectivePower(b) + effectiveToughness(b) - (effectivePower(a) + effectiveToughness(a))).slice(0, count);
}

// Regrow effects in this codebase's real-card sample are all self-graveyard-only (Regrowth,
// Nature's Spiral) — no "any graveyard" variant found, so this deliberately doesn't take one.
// Reuses removalSpells.ts's matchesTargetType (the same type-matching logic chooseRemovalTarget
// already trusts) for every RegrowTargetType value it also recognizes — "card" (the one RegrowTargetType
// value matchesTargetType has no concept of, meaning "any card, no restriction") is the sole special
// case. The hand-written version this replaced only ever recognized "card"/"permanent"/"creature"/
// "land", silently treating EVERY other RegrowTargetType (enchantment, artifact, nonland_permanent)
// as "matches nothing" — so a regrow effect targeting any of those three always found zero candidates
// regardless of what was actually in the graveyard, and the spell became uncastable outright ("no
// legal target") even with a real match sitting right there. Reported live as Heliod, the Radiant
// Dawn refusing to cast with Mind's Dilation (an Enchantment) in the graveyard.
export function chooseRegrowTarget(session: GameSession, casterSeatId: string, targetType: RegrowTargetType, subtype?: string): VisibleCard | undefined {
  const seat = session.seats.find((item) => item.id === casterSeatId);
  const candidates = (seat?.board.graveyard ?? []).filter(
    (card) => (targetType === "card" ? true : matchesTargetType(card, targetType)) && (!subtype || card.typeLine.toLowerCase().includes(subtype.toLowerCase()))
  );
  if (candidates.length === 0) return undefined;
  return candidates.reduce((a, b) => (b.manaValue > a.manaValue ? b : a));
}

// -1/-1 counters and wither/infect don't apply to a mill/graveyard-recursion target the way they
// do to combat/removal — this just moves cards, so the "best" pick for a control-changing/
// reanimation-adjacent target is a stats-based heuristic, not a threat-assessment one; kept
// separate from chooseRemovalTarget since gaining control specifically prefers OPPONENTS' creatures
// (it's a form of removal-plus-upside), matching real deckbuilding intuition.
export function chooseControlTarget(session: GameSession, casterSeatId: string): { seatId: string; card: VisibleCard } | undefined {
  const candidates: Array<{ seatId: string; card: VisibleCard }> = [];
  for (const seat of session.seats) {
    if (seat.id === casterSeatId) continue;
    for (const card of seat.board.battlefield) {
      if (card.typeLine.includes("Creature")) candidates.push({ seatId: seat.id, card });
    }
  }
  if (candidates.length === 0) return undefined;
  return candidates.reduce((a, b) => (effectivePower(b.card) + effectiveToughness(b.card) > effectivePower(a.card) + effectiveToughness(a.card) ? b : a));
}

export function applyMill(session: GameSession, seatId: string, sourceName: string, amount: number): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  const library = seat.library ?? [];
  const sliced = library.slice(0, amount);
  if (sliced.length === 0) return session;
  // Blightsteel Colossus/Darksteel Colossus/Progenitus-style "would be put into a graveyard from
  // anywhere ... shuffle it into its owner's library instead" — a mill still moves the card off the
  // library, but this replacement effect redirects it right back in (shuffled), never into the
  // graveyard. A seat only ever mills its own library here, so owner === seatId trivially.
  const redirected = sliced.filter((card) => hasGraveyardShuffleReplacement(card.oracleText));
  const milled = sliced.filter((card) => !hasGraveyardShuffleReplacement(card.oracleText)).map((card) => resetForZoneChange(card, "graveyard" as const));
  return {
    ...session,
    seats: session.seats.map((item) =>
      item.id === seatId
        ? {
            ...item,
            library:
              redirected.length > 0
                ? shuffleCards([...library.slice(amount), ...redirected.map((card) => resetForZoneChange(card, "library" as const))])
                : library.slice(amount),
            board: milled.length > 0 ? { ...item.board, graveyard: [...(item.board.graveyard ?? []), ...milled] } : item.board,
            zones: { ...item.zones, library: Math.max(0, item.zones.library - milled.length), graveyard: item.zones.graveyard + milled.length }
          }
        : item
    ),
    events: [
      ...redirected.map((card) => ({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${card.name} is revealed and shuffled into ${possessive(seat)} library.`,
        detail: "Rules action"
      })),
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${sourceName} mills ${seat.name} for ${sliced.length} card${sliced.length === 1 ? "" : "s"}.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

// "Target player" has no strong heuristic among opponents the way +1/+1-counter-style effects do
// (this is a hazard, not a benefit, so it's aimed at an opponent rather than the caster) — prefers
// whichever opponent's graveyard is actually worth denying (the most cards in it), falling back to
// any opponent with a nonempty graveyard, then any opponent at all, then the caster only if there
// are none (a 1-player-left game, which can't happen before this would already be over).
export function chooseGraveyardExileTarget(session: GameSession, casterSeatId: string): string {
  const opponents = session.seats.filter((seat) => seat.id !== casterSeatId && !seat.hasLost);
  if (opponents.length === 0) return casterSeatId;
  const withGraveyard = opponents.filter((seat) => (seat.board.graveyard ?? []).length > 0);
  const pool = withGraveyard.length > 0 ? withGraveyard : opponents;
  return pool.reduce((best, seat) => ((seat.board.graveyard ?? []).length > (best.board.graveyard ?? []).length ? seat : best)).id;
}

// Top-level dispatcher for src/lib/zoneEffects.ts's parsed effects, mirroring applyRemovalEffect's
// shape and "no legal target = log and no-op" convention.
// Same reasoning as resolvePreChosenBattlefieldTarget, for a graveyard-sourced pick (regrow) —
// looks in the CASTER's own graveyard only, matching every real "regrow" card in this codebase's
// pool (self-graveyard-only; see zoneEffects.ts's own comment on RegrowEffect).
function resolvePreChosenGraveyardTarget(session: GameSession, casterSeatId: string, preChosenTarget?: ChosenTarget): VisibleCard | undefined {
  if (!preChosenTarget || preChosenTarget.kind !== "card") return undefined;
  const seat = session.seats.find((item) => item.id === casterSeatId);
  return seat?.board.graveyard?.find((item) => item.id === preChosenTarget.cardId);
}

export function applyZoneEffect(
  session: GameSession,
  casterSeatId: string,
  sourceName: string,
  effect: ZoneEffect,
  chosenX?: number,
  preChosenTarget?: ChosenTarget,
  // Every cast-time target in order (Victimize: the graveyard creatures, then the creature to sacrifice).
  preChosenTargets?: ChosenTarget[]
): GameSession {
  switch (effect.kind) {
    case "return_all_to_battlefield": {
      const owner = session.seats.find((seat) => seat.id === casterSeatId);
      const wanted = (owner?.board.graveyard ?? []).filter((card) => effect.types.some((type) => card.typeLine.includes(type.charAt(0).toUpperCase() + type.slice(1))));
      if (!owner || wanted.length === 0) return rulesEvent(session, casterSeatId, `${sourceName}: no matching cards in the graveyard.`);
      const next = wanted.reduce((current, card) => moveCardAcrossSeats(current, owner.id, card.id, owner.id, "battlefield").session, session);
      return rulesEvent(next, casterSeatId, `${sourceName}: ${owner.name} returns ${wanted.length} card${wanted.length === 1 ? "" : "s"} from the graveyard to the battlefield.`);
    }
    case "reanimate": {
      // Fathomless descent's dynamic ceiling: "the number of permanent cards in your graveyard" —
      // same "permanent card" definition matchesReanimateTargetType's own "permanent" branch uses
      // (not Instant, not Sorcery), counted at resolution time against the caster's own graveyard.
      const maxManaValue =
        effect.manaValueCeiling === "graveyard_permanent_count"
          ? (session.seats.find((seat) => seat.id === casterSeatId)?.board.graveyard ?? []).filter(
              (card) => !card.typeLine.includes("Instant") && !card.typeLine.includes("Sorcery")
            ).length
          : undefined;
      // The human's own pick (an activated ability's target prompt), when it is a card in a graveyard.
      const pickedCard = preChosenTarget?.kind === "card" ? session.seats.find((seat) => seat.id === preChosenTarget.seatId)?.board.graveyard?.find((card) => card.id === preChosenTarget.cardId) : undefined;
      const target = pickedCard && preChosenTarget?.kind === "card" ? { seatId: preChosenTarget.seatId, card: pickedCard } : chooseReanimationTarget(session, casterSeatId, effect.anyGraveyard, effect.targetType, maxManaValue);
      if (!target) return noLegalTargetEvent(session, casterSeatId, sourceName);
      const { session: movedSession } = moveCardAcrossSeats(session, target.seatId, target.card.id, casterSeatId, "battlefield");
      const counterRule = effect.counterIfType;
      const reanimatedSession: GameSession =
        counterRule && target.card.typeLine.toLowerCase().includes(counterRule.typeWord)
          ? {
              ...movedSession,
              seats: movedSession.seats.map((seat) =>
                seat.id !== casterSeatId ? seat : { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === target.card.id ? applyCounterDelta(card, "+1/+1", counterRule.count) : card)) } }
              )
            }
          : movedSession;
      const reanimateLifeLoss = effect.loseLifeEqualToManaValue ? target.card.manaValue : 0;
      return {
        ...reanimatedSession,
        seats: reanimateLifeLoss > 0 ? reanimatedSession.seats.map((seat) => (seat.id === casterSeatId ? { ...seat, life: seat.life - reanimateLifeLoss } : seat)) : reanimatedSession.seats,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: casterSeatId,
            message: `${sourceName} returns ${target.card.name} from a graveyard to the battlefield under its new controller.${reanimateLifeLoss > 0 ? ` The caster loses ${reanimateLifeLoss} life.` : ""}`,
            detail: "Rules action"
          },
          ...reanimatedSession.events
        ]
      };
    }
    case "regrow": {
      const target = resolvePreChosenGraveyardTarget(session, casterSeatId, preChosenTarget) ?? chooseRegrowTarget(session, casterSeatId, effect.targetType, effect.subtype);
      if (!target) return noLegalTargetEvent(session, casterSeatId, sourceName);
      const { session: regrownSession } = moveCardAcrossSeats(session, casterSeatId, target.id, casterSeatId, "hand");
      const regrown: GameSession = {
        ...regrownSession,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: casterSeatId,
            message: `${sourceName} returns ${target.name} from the graveyard to hand.`,
            detail: "Rules action"
          },
          ...regrownSession.events
        ]
      };
      // Cemetery Recruitment: only draws when the returned card is the named type.
      if (effect.drawIfType && target.typeLine.toLowerCase().includes(effect.drawIfType)) {
        return drawMultipleForSeat(regrown, casterSeatId, 1, `${sourceName}: ${target.name} is a ${effect.drawIfType}, so ${session.seats.find((seat) => seat.id === casterSeatId)?.name ?? "the caster"} draws a card.`);
      }
      return regrown;
    }
    case "mill": {
      // "target player" has no strong heuristic preference among opponents (milling is a hazard,
      // not a benefit, so it's aimed at an opponent rather than the caster) — just picks the first.
      const seatIds =
        effect.scope === "you"
          ? [casterSeatId]
          : effect.scope === "target_player"
            ? [preChosenTarget?.kind === "player" ? preChosenTarget.seatId : session.seats.find((seat) => seat.id !== casterSeatId)?.id ?? casterSeatId]
            : effect.scope === "each_opponent"
              ? session.seats.filter((seat) => seat.id !== casterSeatId).map((seat) => seat.id)
              : session.seats.map((seat) => seat.id);
      const milled = seatIds.reduce((next, seatId) => applyMill(next, seatId, sourceName, effect.amount), session);
      if (effect.then?.kind !== "put_land_from_graveyard_on_top") return milled;
      // "You may put a land card from your graveyard on top of your library." (Glowspore Shaman) —
      // always beneficial (filtering a land toward your next draw), so auto-accepted for every seat
      // kind, the same "take the beneficial optional action" default this engine already applies to
      // other optional zone effects. No dedicated interactive "which land" picker exists yet (same
      // declared simplification chooseReanimationTarget's own deterministic pick already accepts) —
      // ties broken by highest mana value, mirroring chooseRegrowTarget's own non-creature tie-break.
      const casterSeat = milled.seats.find((seat) => seat.id === casterSeatId);
      const landCards = (casterSeat?.board.graveyard ?? []).filter((card) => card.typeLine.includes("Land"));
      if (landCards.length === 0) return milled;
      const chosenLand = landCards.reduce((a, b) => (b.manaValue > a.manaValue ? b : a));
      const { session: filteredSession } = moveCardAcrossSeats(milled, casterSeatId, chosenLand.id, casterSeatId, "library");
      return {
        ...filteredSession,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: casterSeatId,
            message: `${sourceName} puts ${chosenLand.name} from the graveyard on top of the library.`,
            detail: "Rules action"
          },
          ...filteredSession.events
        ]
      };
    }
    case "put_land_from_graveyard_on_top":
      // Never reached as a top-level effect — only ever attached as MillEffect.then and applied
      // inline by the "mill" case above (see its own comment). Kept as its own switch case purely
      // so the exhaustiveness check above (zoneEffectHasLegalTarget) and this one stay in sync with
      // the ZoneEffect union; if this ever WAS reached directly, doing nothing is the safe default.
      return session;
    case "graveyard_to_library": {
      const seatId =
        effect.scope === "you" ? casterSeatId : preChosenTarget?.kind === "player" ? preChosenTarget.seatId : session.seats.find((seat) => seat.id !== casterSeatId && (seat.board.graveyard ?? []).length > 0)?.id ?? casterSeatId;
      return applyGraveyardToLibrary(session, seatId, sourceName);
    }
    case "exile_graveyard": {
      const seatIds =
        effect.scope === "you"
          ? [casterSeatId]
          : effect.scope === "target_player"
            ? [preChosenTarget?.kind === "player" ? preChosenTarget.seatId : chooseGraveyardExileTarget(session, casterSeatId)]
            : effect.scope === "each_opponent"
              ? session.seats.filter((seat) => seat.id !== casterSeatId).map((seat) => seat.id)
              : session.seats.map((seat) => seat.id);
      return seatIds.reduce((next, seatId) => applyGraveyardExile(next, seatId, sourceName), session);
    }
    case "gain_control": {
      const target = resolvePreChosenBattlefieldTarget(session, preChosenTarget) ?? chooseControlTarget(session, casterSeatId);
      if (!target) return noLegalTargetEvent(session, casterSeatId, sourceName);
      const controlledSession = changeControlWithinBattlefield(session, target.card.id, target.seatId, casterSeatId, effect.untilEndOfTurn);
      return {
        ...controlledSession,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: casterSeatId,
            message: `${sourceName} gains control of ${target.card.name}${effect.untilEndOfTurn ? " until end of turn" : ""}.`,
            detail: "Rules action"
          },
          ...controlledSession.events
        ]
      };
    }
    case "sacrifice_then_reanimate": {
      const casterSeat = session.seats.find((seat) => seat.id === casterSeatId);
      // The player's own cast-time picks (still in the graveyard / on the battlefield) win over the heuristic.
      const pickedGraveyardCards = (preChosenTargets ?? [])
        .slice(0, effect.targetCount)
        .flatMap((target) => (target.kind === "card" ? [casterSeat?.board.graveyard?.find((card) => card.id === target.cardId && card.typeLine.includes("Creature"))] : []))
        .filter((card): card is VisibleCard => Boolean(card));
      const chosenCards = preChosenTargets ? (pickedGraveyardCards.length > 0 ? pickedGraveyardCards : undefined) : chooseCreatureCardsFromOwnGraveyard(session, casterSeatId, effect.targetCount);
      if (!casterSeat || !chosenCards) return noLegalTargetEvent(session, casterSeatId, sourceName);
      const pickedSacrificeTarget = preChosenTargets?.[effect.targetCount];
      const pickedSacrifice =
        pickedSacrificeTarget?.kind === "card" ? casterSeat.board.battlefield.find((card) => card.id === pickedSacrificeTarget.cardId && card.typeLine.includes("Creature")) : undefined;
      const sacrificeTargets = pickedSacrifice ? [pickedSacrifice] : chooseSacrificeTargets(casterSeat, undefined, effect.sacrificeCount);
      if (!sacrificeTargets) {
        // Rule 608.2c: the sacrifice isn't an additional cost on this card's actual templating (see
        // SacrificeThenReanimateEffect's own doc comment) — it's a resolution-time instruction the
        // caster can simply fail to perform if they control no creature. "If you do" then never
        // triggers, so the chosen graveyard cards just stay put; still a fully legal cast overall.
        return {
          ...session,
          events: [
            {
              id: crypto.randomUUID(),
              at: new Date().toISOString(),
              seatId: casterSeatId,
              message: `${sourceName}: ${casterSeat.name} has no creature to sacrifice, so nothing returns to the battlefield.`,
              detail: "Rules action"
            },
            ...session.events
          ]
        };
      }
      // Through destroyCreatures (not a raw zone move) so the sacrifice fires death triggers (Blood Artist, Grim Haruspex, Syr Konrad)
      // and Mazirek-style "whenever a player sacrifices" watchers.
      const sacrificedSession = destroyCreatures(
        session,
        sacrificeTargets.map((target) => ({ seatId: casterSeatId, cardId: target.id, message: `${casterSeat.name} sacrifices ${target.name} to ${sourceName}.` })),
        "Rules action"
      );
      const returnedSession = chosenCards.reduce(
        (acc, card) => moveCardAcrossSeats(acc, casterSeatId, card.id, casterSeatId, "battlefield", { tapped: effect.tapped }).session,
        sacrificedSession
      );
      return {
        ...returnedSession,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: casterSeatId,
            message: `${sourceName}: ${casterSeat.name} sacrifices ${sacrificeTargets.map((card) => card.name).join(", ")} and returns ${chosenCards.map((card) => card.name).join(", ")} to the battlefield${effect.tapped ? " tapped" : ""}.`,
            detail: "Rules action"
          },
          ...returnedSession.events
        ]
      };
    }
    case "impulse_draw":
      return applyImpulseDraw(session, casterSeatId, sourceName, effect.amount, effect.untilEndOfNextTurn);
    case "steal_and_play":
      return applyStealAndPlay(session, casterSeatId, sourceName);
    case "draw_x_then_put_back":
      return applyDrawXThenPutBack(session, casterSeatId, sourceName, effect.drawAmount ?? chosenX ?? 0, effect.putBackAmount);
    case "surveil":
      return applySurveilEffect(session, casterSeatId, sourceName, effect.amount);
    case "look_dig":
      return applyLookDigEffect(session, casterSeatId, sourceName, effect);
  }
}

// Surveil N: look at the top N library cards, put any number into the graveyard, the rest back on
// top in any order (rule 701.42).
// The deterministic ruling on which looked-at cards an AGENT surveils into its graveyard, and the order of the rest, is src/lib/surveilScoring.ts
// (scoreSurveil): every card gets a keep value from what the agent needs now (lands vs the lands it wants, missing colours, castability within ~2
// turns, dead removal, legendary duplicates, reanimation targets when it runs a graveyard engine, library safety). `kept` is best-first (top of library first).
// A human never uses this: surveil is a rules-advisor workflow that opens the look-at-top prompt (startLibraryLook "surveil").
export function agentSurveilDecision(seat: PlayerSeat, looked: VisibleCard[], session?: GameSession): { binned: VisibleCard[]; kept: VisibleCard[] } {
  const decision = scoreSurveil(
    {
      turn: session?.turn ?? 1,
      life: seat.life,
      librarySize: seat.library?.length ?? looked.length,
      battlefield: seat.board.battlefield,
      hand: seat.board.hand,
      graveyard: seat.board.graveyard ?? [],
      commander: seat.board.commander,
      opponents: (session?.seats ?? []).filter((item) => item.id !== seat.id && !item.hasLost).map((item) => ({ id: item.id, life: item.life, battlefield: item.board.battlefield }))
    },
    looked
  );
  const byId = new Map(looked.map((card) => [card.id, card]));
  return { binned: decision.toGraveyard.map((id) => byId.get(id)!), kept: decision.topOrder.map((id) => byId.get(id)!) };
}

function applySurveilEffect(session: GameSession, casterSeatId: string, sourceName: string, amount: number): GameSession {
  const seat = session.seats.find((item) => item.id === casterSeatId);
  if (!seat) return session;
  const library = seat.library ?? [];
  const looked = library.slice(0, amount);
  if (looked.length === 0) return session;
  const { binned, kept } = agentSurveilDecision(seat, looked, session);
  const rest = library.slice(looked.length);

  return {
    ...session,
    seats: session.seats.map((item) => {
      if (item.id !== casterSeatId) return item;
      return {
        ...item,
        library: [...kept, ...rest],
        board: { ...item.board, graveyard: [...(item.board.graveyard ?? []), ...binned.map((card) => ({ ...card, zone: "graveyard" as const }))] },
        zones: { ...item.zones, graveyard: item.zones.graveyard + binned.length }
      };
    }),
    events: [
      phaseEvent(
        casterSeatId,
        binned.length > 0
          ? `${seat.name} surveils ${amount} with ${sourceName}, putting ${binned.map((card) => card.name).join(", ")} into the graveyard and the rest on top.`
          : `${seat.name} surveils ${amount} with ${sourceName} and keeps everything on top.`
      ),
      ...session.events
    ]
  };
}

// "Reveal/look at the top N cards, put [a matching one / one of them] into your hand, put the rest
// into the graveyard / back on top in any order" (Grisly Salvage, Diabolic Vision). Auto-choice: the
// FIRST card among those looked at that matches cardTypeFilter (or, with no filter, simply the first
// one) goes to hand; this doesn't try to evaluate which candidate is actually best, same
// simplification as every other auto-pick in this file. "Rest back on top in any order" keeps its
// original relative order — a fully legal resolution of "any order," not an attempt to sequence a
// future draw.
function applyLookDigEffect(session: GameSession, casterSeatId: string, sourceName: string, effect: LookDigEffect): GameSession {
  const seat = session.seats.find((item) => item.id === casterSeatId);
  if (!seat) return session;
  const library = seat.library ?? [];
  const looked = library.slice(0, effect.amount);
  if (looked.length === 0) return session;
  const rest = library.slice(looked.length);

  const chosen = effect.cardTypeFilter ? looked.find((card) => cardMatchesTypeFilter(card.typeLine, effect.cardTypeFilter!)) : looked[0];
  const notChosen = looked.filter((card) => card.id !== chosen?.id);
  const toGraveyard = effect.restDestination === "graveyard";
  const newLibrary = toGraveyard ? rest : [...notChosen, ...rest];

  return {
    ...session,
    seats: session.seats.map((item) => {
      if (item.id !== casterSeatId) return item;
      return {
        ...item,
        library: newLibrary,
        board: {
          ...item.board,
          hand: chosen ? [...item.board.hand, { ...chosen, zone: "hand" as const }] : item.board.hand,
          graveyard: toGraveyard ? [...(item.board.graveyard ?? []), ...notChosen.map((card) => ({ ...card, zone: "graveyard" as const }))] : item.board.graveyard
        },
        zones: {
          ...item.zones,
          graveyard: toGraveyard ? item.zones.graveyard + notChosen.length : item.zones.graveyard
        }
      };
    }),
    events: [
      phaseEvent(
        casterSeatId,
        chosen
          ? `${seat.name} digs with ${sourceName}, puts ${chosen.name} into hand, and ${toGraveyard ? "puts the rest into the graveyard" : "keeps the rest on top"}.`
          : `${seat.name} digs with ${sourceName} but finds no ${effect.cardTypeFilter ?? "matching"} card, ${toGraveyard ? "putting them all into the graveyard" : "keeping them all on top"}.`
      ),
      ...session.events
    ]
  };
}

// Replaces the standalone word "X" with the caster's actual paid X, so a mode/effect written with
// a variable amount ("Target player loses X life," "Target creature gets -X/-X until end of
// turn") can be parsed by the same fixed-number parsers used everywhere else in this file (mill,
// draw, life, the pump parser below, ...) instead of every regex separately learning a symbolic
// "x". Resolving X in the text itself, once, up front, is simpler and safer than threading a
// dynamic value through every downstream effect kind — and it's exactly why several of those
// regexes already tolerate a literal "x" in their own alternation (harmless dead weight once this
// substitution runs, and the correct "decline, don't guess" behavior on the rare path where
// chosenX isn't available and "x" is left as-is).
export function substituteX(text: string, chosenX: number): string {
  return text.replace(/\bx\b/gi, String(chosenX));
}

// The two-sided "target player loses N life, you gain N life" (Blood Artist) / "each opponent
// loses N, you gain N" (Zulaport Cutthroat, Cruel Celebrant) shape. Extracted out of
// resolveTriggerEffect's own inline "drain" TriggerEffect handling (still called from there
// unchanged below) so applyPrimitiveAction's new "drain" PrimitiveAction case can reuse the exact
// same execution instead of re-deriving it for the LLM-fallback path.
export function applyDrainEffect(
  session: GameSession,
  casterSeatId: string,
  sourceName: string,
  amount: number,
  scope: "target_player" | "each_opponent",
  verb = "resolves",
  // Zulaport Cutthroat/Cruel Celebrant/Blood Artist all print a single flat gain ("you gain N life")
  // regardless of how many opponents actually lost life to it — that's the default (false) below.
  // Gray Merchant of Asphodel's devotion-drain cycle instead prints "you gain life equal to the life
  // lost this way," i.e. the SUM across every opponent (devotion × opponent count), a genuinely
  // different total when there's more than one opponent — set true only for that shape.
  gainEqualsTotalLoss = false,
  // "Each opponent loses 1 life." with no gain (Vengeful Dead) — a pure life loss.
  noGain = false
): GameSession {
  const seatName = session.seats.find((seat) => seat.id === casterSeatId)?.name ?? "Player";
  const opponents = session.seats.filter((seat) => seat.id !== casterSeatId && !seat.hasLost);
  // "target player" (Blood Artist) — no interactive targeting for this shape any more than removal
  // spells have one; prefers the biggest threat (highest life), same bias chooseAuraAttachTarget's
  // "Enchant player" branch already uses for the same "no real choice UI, pick a sensible default"
  // reason. "each opponent" (Zulaport Cutthroat, Cruel Celebrant, Gray Merchant) hits everyone at once.
  const losers = scope === "each_opponent" ? opponents : opponents.length > 0 ? [opponents.reduce((a, b) => (b.life > a.life ? b : a))] : [];
  const gainAmount = noGain ? 0 : gainEqualsTotalLoss ? amount * losers.length : amount;
  // Both scopes build losers from `opponents` above, so the controller can never also be in
  // loserIds — gain and loss never land on the same seat.
  const loserIds = new Set(losers.map((seat) => seat.id));
  const nextSeats = session.seats.map((seat) => {
    if (seat.id === casterSeatId) return { ...seat, life: seat.life + gainAmount };
    if (loserIds.has(seat.id)) return { ...seat, life: Math.max(0, seat.life - amount) };
    return seat;
  });
  const loserNames = losers.map((seat) => seat.name).join(", ") || "no one (no legal target)";
  return {
    ...session,
    seats: nextSeats,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: casterSeatId,
        message: noGain ? `${sourceName} ${verb}. ${loserNames} loses ${amount} life each.` : `${sourceName} ${verb}. ${seatName} gains ${gainAmount} life; ${loserNames} loses ${amount} life each.`
      },
      ...session.events
    ]
  };
}

// "target player discards N cards" (target_player)/"each opponent discards" (each_opponent)/"you
// discard" (you)/"each player discards" (each_player) — mirrors applyDrainEffect's own scope
// handling (target_player prefers the biggest threat, same bias chooseAuraAttachTarget's "Enchant
// player" branch uses), just moving cards to the graveyard instead of moving life totals. Card
// selection per seat reuses chooseWorstHandCardToDiscard's existing "give up the priciest card"
// heuristic (already used for a seat forced to discard by its own choice) rather than a new one.
export function applyDiscardEffect(
  session: GameSession,
  casterSeatId: string,
  sourceName: string,
  amount: number,
  scope: "you" | "target_player" | "each_opponent" | "each_player",
  verb = "resolves"
): GameSession {
  const opponents = session.seats.filter((seat) => seat.id !== casterSeatId && !seat.hasLost);
  const casterSeat = session.seats.find((seat) => seat.id === casterSeatId);
  const targets =
    scope === "you"
      ? casterSeat
        ? [casterSeat]
        : []
      : scope === "each_player"
        ? session.seats.filter((seat) => !seat.hasLost)
        : scope === "each_opponent"
          ? opponents
          : opponents.length > 0
            ? [opponents.reduce((a, b) => (b.life > a.life ? b : a))]
            : [];
  if (targets.length === 0) return noLegalTargetEvent(session, casterSeatId, sourceName);

  let nextSession = session;
  const discardedBySeat = new Map<string, string[]>();
  let deferredAny = false;
  for (const target of targets) {
    const discarded: string[] = [];
    const deferredSession = deferHumanDiscard(nextSession, target.id, amount, sourceName);
    if (deferredSession) {
      nextSession = deferredSession;
      deferredAny = true;
      continue;
    }
    for (let i = 0; i < amount; i += 1) {
      const seat = nextSession.seats.find((item) => item.id === target.id);
      const card = seat ? chooseWorstHandCardToDiscard(seat) : undefined;
      if (!seat || !card) break;
      nextSession = moveCardBetweenVisibleZones(nextSession, seat.id, card.id, "graveyard");
      discarded.push(card.name);
    }
    if (discarded.length > 0) discardedBySeat.set(target.id, discarded);
  }
  if (discardedBySeat.size === 0) return deferredAny ? nextSession : noLegalTargetEvent(nextSession, casterSeatId, sourceName);

  const summary = Array.from(discardedBySeat.entries())
    .map(([seatId, cards]) => {
      const seatName = session.seats.find((item) => item.id === seatId)?.name ?? "Player";
      return `${seatName} discards ${cards.join(", ")}`;
    })
    .join("; ");
  return {
    ...nextSession,
    events: [
      { id: crypto.randomUUID(), at: new Date().toISOString(), seatId: casterSeatId, message: `${sourceName} ${verb}. ${summary}.`, detail: "Rules action" },
      ...nextSession.events
    ]
  };
}

export function applySimpleLifeChange(
  session: GameSession,
  casterSeatId: string,
  sourceName: string,
  effect: { kind: "gain_life" | "lose_life"; amount: number }
): GameSession {
  const delta = effect.kind === "gain_life" ? effect.amount : -effect.amount;
  return {
    ...session,
    seats: session.seats.map((seat) => (seat.id === casterSeatId ? { ...seat, life: Math.max(0, seat.life + delta) } : seat)),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: casterSeatId,
        message: `${session.seats.find((seat) => seat.id === casterSeatId)?.name ?? "Player"} ${delta > 0 ? "gains" : "loses"} ${Math.abs(delta)} life from ${sourceName}.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

export interface PumpEffect {
  power: number;
  toughness: number;
  // "gains trample" (Rhonas the Indomitable): keywords granted until end of turn.
  keywords?: string[];
  // "Another target creature": the source itself is not a legal target.
  another?: boolean;
}

// "Target creature gets +N/+N or -N/-N until end of turn." (Giant Growth-style tricks, Afflict-
// style debuffs, Profane Command's -X/-X mode once substituteX has resolved X, ...) — one of the
// single most common instant/sorcery templates in the whole card pool, and previously entirely
// unmodeled (no TriggerEffect/ZoneEffect kind covers a temporary, targeted P/T change). Reuses the
// existing temporaryPowerBonus/temporaryToughnessBonus fields (already used for prowess) rather
// than adding a parallel mechanism.
export function parseTargetedPump(text: string): PumpEffect | undefined {
  const match = text.match(/\b(another )?target creature gets ([+-]\d+)\/([+-]\d+)(?: and gains ([a-z, ]+?))? until end of turn\b/i);
  if (!match) return undefined;
  const keywords = match[4] ? match[4].split(/,| and /).map((word) => word.trim().toLowerCase()).filter(Boolean) : [];
  return { power: Number.parseInt(match[2], 10), toughness: Number.parseInt(match[3], 10), ...(keywords.length ? { keywords } : {}), ...(match[1] ? { another: true } : {}) };
}

// Reuses chooseCounterTarget's existing polarity-aware heuristic (a positive change prefers the
// caster's own best creature; a negative one prefers the biggest threat among opponents) rather
// than writing a parallel targeting heuristic — the "which creature" question is identical whether
// the +N/-N is being applied via counters or a temporary bonus.
export function choosePumpTarget(session: GameSession, casterSeatId: string, effect: PumpEffect, excludeCardId?: string) {
  const hidden = excludeCardId
    ? { ...session, seats: session.seats.map((seat) => ({ ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.filter((card) => card.id !== excludeCardId) } })) }
    : session;
  return chooseCounterTarget(hidden, casterSeatId, effect.power >= 0 ? "+1/+1" : "-1/-1", false);
}

export function applyTargetedPumpEffect(session: GameSession, casterSeatId: string, sourceCard: VisibleCard, effect: PumpEffect, preChosenTarget?: ChosenTarget): GameSession {
  const picked = resolvePreChosenBattlefieldTarget(session, preChosenTarget);
  const target = picked ?? choosePumpTarget(session, casterSeatId, effect, effect.another ? sourceCard.id : undefined);
  if (!target || (effect.another && target.card.id === sourceCard.id)) return noLegalTargetEvent(session, casterSeatId, sourceCard.name);
  const powerText = `${effect.power >= 0 ? "+" : ""}${effect.power}`;
  const toughnessText = `${effect.toughness >= 0 ? "+" : ""}${effect.toughness}`;
  const pumped: GameSession = {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === target.seatId
        ? {
            ...seat,
            board: {
              ...seat.board,
              battlefield: seat.board.battlefield.map((card) =>
                card.id === target.card.id
                  ? {
                      ...card,
                      temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + effect.power,
                      temporaryToughnessBonus: (card.temporaryToughnessBonus ?? 0) + effect.toughness,
                      ...(effect.keywords?.length
                        ? {
                            temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), ...effect.keywords],
                            grantedKeywords: [...new Set([...(card.grantedKeywords ?? []), ...effect.keywords])]
                          }
                        : {})
                    }
                  : card
              )
            }
          }
        : seat
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: casterSeatId,
        message: `${sourceCard.name} gives ${target.card.name} ${powerText}/${toughnessText}${effect.keywords?.length ? " and " + effect.keywords.join(" and ") : ""} until end of turn.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
  // Enshrouding Mist: "... Prevent all damage that would be dealt to it this turn. If it's renowned, untap it." — "it" is the creature just pumped.
  const itSpec = parseDamagePrevention(sourceCard.oracleText);
  if (itSpec?.scope !== "it") return pumped;
  const shielded = addDamageShieldsFromSpec(pumped, casterSeatId, sourceCard, itSpec, { kind: "card", seatId: target.seatId, cardId: target.card.id });
  if (!target.card.renowned || !/if it'?s renowned, untap it/i.test(sourceCard.oracleText)) return shielded;
  return rulesEvent({ ...shielded, seats: shielded.seats.map((seat) => (seat.id !== target.seatId ? seat : { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === target.card.id ? { ...card, tapped: false } : card)) } })) }, casterSeatId, `${target.card.name} is renowned and untaps.`);
}

export interface MassPumpEffect {
  // Only creatures matching this qualifier ("Dragons you control get +1/+0", Lathliss).
  matcher?: string;
  // "each creature you control with power 4 or greater" (Goreclaw) and "...gets +1/+1 and gains trample" — only creatures at or above
  // this power, and an optional keyword granted along with the pump.
  minPower?: number;
  grantsKeyword?: string;
  power: number;
  toughness: number;
  // Lowercased creature type excluded from the effect (Exude Toxin's "non-Dragon"), undefined for
  // an unqualified "each creature."
  excludeType?: string;
  scope: "all" | "controlled" | "opponents";
  // "+X/+X, where X is the number of creatures you control" (Craterhoof Behemoth): power and toughness are the
  // caster's creature count at resolution, ignoring the fixed numbers above.
  xFromCreatureCount?: boolean;
}

export function applyMassPumpEffect(session: GameSession, casterSeatId: string, sourceCardName: string, rawEffect: MassPumpEffect): GameSession {
  const creatureCount = rawEffect.xFromCreatureCount
    ? (session.seats.find((seat) => seat.id === casterSeatId)?.board.battlefield.filter((card) => card.typeLine.includes("Creature")).length ?? 0)
    : 0;
  const effect = rawEffect.xFromCreatureCount ? { ...rawEffect, power: creatureCount, toughness: creatureCount } : rawEffect;
  const qualifierText = effect.excludeType ? `non-${effect.excludeType} ` : "";
  const powerText = `${effect.power >= 0 ? "+" : ""}${effect.power}`;
  const toughnessText = `${effect.toughness >= 0 ? "+" : ""}${effect.toughness}`;
  let affectedCount = 0;
  const seats = session.seats.map((seat) => {
    if (effect.scope === "controlled" && seat.id !== casterSeatId) return seat;
    if (effect.scope === "opponents" && seat.id === casterSeatId) return seat;
    return {
      ...seat,
      board: {
        ...seat.board,
        battlefield: seat.board.battlefield.map((card) => {
          if (!card.typeLine.includes("Creature")) return card;
          if (effect.excludeType && card.typeLine.toLowerCase().includes(effect.excludeType)) return card;
          if (effect.matcher && !permanentMatchesQualifier(card, effect.matcher)) return card;
          if (effect.minPower !== undefined && effectivePower(card) < effect.minPower) return card;
          affectedCount += 1;
          return {
            ...card,
            temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + effect.power,
            temporaryToughnessBonus: (card.temporaryToughnessBonus ?? 0) + effect.toughness,
            ...(effect.grantsKeyword ? { temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), effect.grantsKeyword] } : {})
          };
        })
      }
    };
  });
  return {
    ...session,
    seats,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: casterSeatId,
        message:
          affectedCount > 0
            ? `${sourceCardName} gives each ${qualifierText}creature ${powerText}/${toughnessText} until end of turn.`
            : `${sourceCardName} resolves with no ${qualifierText}creatures to affect.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

export function applyMassBounceEffect(session: GameSession, casterSeatId: string, sourceCardName: string, scope: "creatures" | "nonland_permanents" = "creatures"): GameSession {
  const targets = session.seats.flatMap((seat) =>
    seat.board.battlefield
      .filter((card) => (scope === "nonland_permanents" ? !isLandCard(card) : card.typeLine.includes("Creature")))
      .map((card) => ({ seatId: seat.id, cardId: card.id }))
  );
  // Reuses the single-card mover (rather than moving every hand array by hand) so a bounced
  // commander still gets its own 903.9a command-zone replacement instead of unconditionally
  // landing in hand — the same reason completeRuleChoice's discard_to_hand_size branch reduces
  // over moveCardBetweenVisibleZones one card at a time instead of bulk-splicing arrays.
  const bouncedSession = targets.reduce((next, target) => moveCardBetweenVisibleZones(next, target.seatId, target.cardId, "hand"), session);
  const targetNoun = scope === "nonland_permanents" ? "nonland permanents" : "creatures";
  return {
    ...bouncedSession,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: casterSeatId,
        message:
          targets.length > 0
            ? `${sourceCardName} returns all ${targetNoun} to their owners' hands.`
            : `${sourceCardName} resolves with no ${targetNoun} to return.`,
        detail: "Rules action"
      },
      ...bouncedSession.events
    ]
  };
}

// A card's effect, reduced to one of a small, closed set of composable primitive verbs — step 1 of
// unifying this file's per-effect-family dispatchers (removalEffect/zoneEffect/pump/mass-pump/mass-
// bounce/tokens/counters/draw, each currently applied through its own separate call site) behind
// ONE shared entry point, so a future source (an LLM fallback for card text none of the deterministic
// parsers below recognize, the way rulesAdvisor.ts already does for the narrower draw/scry/search
// case) has a single, closed, already-tested vocabulary to target instead of freeform reasoning.
// Deliberately PURE PLUMBING: every case here forwards to the exact function this file's own
// deterministic parsers already call today (applyRemovalEffect, applyZoneEffect, ...) — no new
// resolution logic, no behavior change, just one shared dispatcher instead of a dozen scattered
// `if (effect.kind === ...)` call sites.
//
// Deliberately excludes verbs this file has no standalone (non-queue-coupled) function for yet:
// - Most of TriggerEffect's remaining vocabulary (add_counter with a "target_creature" scope,
//   connive, copy_token, impulse_cast_free, ...) is real and already implemented, but only inside
//   resolveTriggerEffect, which is coupled to the triggered-ability queue (PendingAction shape,
//   chainCount loop guard) rather than a standalone (session, action) => session function. Folding
//   those in cleanly is a follow-up, not plumbing onto an existing pure function the way every case
//   below is. ("drain" WAS in that category — applyDrainEffect above pulled it out into a
//   standalone function precisely so it could join this list.)
// - "Sacrifice a permanent" as a SPELL's own effect (as opposed to an activated ability's own cost,
//   which payGenericSacrificeCost already owns) had no existing function to forward to at all — a
//   genuinely new primitive (applySacrificePrimitive below), not an existing one plumbed in.
//   "Tap/untap target permanent" as a spell's own effect was the same kind of gap; see
//   chooseTapUntapTarget/applyTapUntapPrimitive below for the same treatment.
export type PrimitiveAction =
  | { kind: "removal"; effect: RemovalEffect; chosenX?: number }
  | { kind: "zone"; effect: ZoneEffect; chosenX?: number }
  | { kind: "draw_cards"; amount: number }
  | { kind: "draw_then_put_back"; drawAmount: number; putBackAmount: number }
  | { kind: "life_change"; effect: { kind: "gain_life" | "lose_life"; amount: number } }
  | { kind: "drain"; amount: number; scope: "target_player" | "each_opponent" }
  // "discard" the same way "drain" already models "target player loses life, you gain life" — the
  // "who discards" scope reuses drain's/mill's own target_player-picks-highest-life-opponent
  // convention (applyDiscardEffect below), just for hands instead of libraries/life totals.
  | { kind: "discard"; amount: number; scope: "you" | "target_player" | "each_opponent" | "each_player" }
  // "Tap/untap target permanent" as a SPELL's/ability's own effect — genuinely new (see the comment
  // above this union), now built via chooseTapUntapTarget/applyTapUntapPrimitive below rather than
  // left unimplemented.
  | { kind: "tap_target" | "untap_target"; targetType: RemovalTargetType }
  | { kind: "pump_target"; effect: PumpEffect }
  | { kind: "mass_pump"; effect: MassPumpEffect }
  | { kind: "mass_bounce" }
  | { kind: "create_tokens"; specs: TokenSpec[] }
  | { kind: "put_counters_on_self"; counterKind: string; amount: number }
  // "Sacrifice a creature." (edict-style, e.g. cast as your own cost/effect rather than an
  // opponent's) / "Sacrifice this permanent." — no existing standalone applier before this; reuses
  // choosePlaguecrafterSacrifice's "least costly to lose" targeting heuristic (already used for
  // applyEachPlayerSacrificeEffect) for the two non-self scopes, and destroyCreatures for the actual
  // move so death triggers fire correctly, same as every other sacrifice path in this file.
  | { kind: "sacrifice_permanent"; scope: "self" | "creature_you_control" | "permanent_you_control" }
  // Unifies moving a KNOWN card between hand/graveyard/exile/library-top — deliberately excludes
  // "battlefield" on either end (a card entering/leaving the battlefield is what the "removal"/"zone"
  // primitive kinds already own; folding it in here too would create two competing ways to express
  // the same move). "library_top" is only reachable FROM "hand" (applyPutCardsOnLibrary's own
  // scope); anything else between hand/graveyard/exile goes through moveCardBetweenVisibleZones,
  // which already looks the card up wherever it currently sits.
  | { kind: "move_card_zone"; from: "hand" | "graveyard"; to: "hand" | "graveyard" | "exile" | "library_top"; filter: "worst" | "best" | "any"; count: number };

// `preChosen`: the target recorded when the spell was cast (a planned step then uses it instead of picking one again).
export function applyPrimitiveAction(session: GameSession, casterSeatId: string, sourceCard: VisibleCard, action: PrimitiveAction, preChosen?: ChosenTarget): GameSession {
  const seatName = session.seats.find((seat) => seat.id === casterSeatId)?.name ?? "Player";
  switch (action.kind) {
    case "removal":
      return applyRemovalEffect(session, casterSeatId, sourceCard.name, sourceCard, action.effect, action.chosenX, preChosen);
    case "zone":
      return applyZoneEffect(session, casterSeatId, sourceCard.name, action.effect, action.chosenX, preChosen);
    case "draw_cards":
      return drawMultipleForSeat(session, casterSeatId, action.amount, `${sourceCard.name} resolves. ${seatName} draws ${action.amount} card${action.amount === 1 ? "" : "s"}.`);
    case "draw_then_put_back":
      return applyDrawXThenPutBack(session, casterSeatId, sourceCard.name, action.drawAmount, action.putBackAmount);
    case "life_change":
      return applySimpleLifeChange(session, casterSeatId, sourceCard.name, action.effect);
    case "drain":
      return applyDrainEffect(session, casterSeatId, sourceCard.name, action.amount, action.scope);
    case "discard":
      return applyDiscardEffect(session, casterSeatId, sourceCard.name, action.amount, action.scope);
    case "tap_target":
      return applyTapUntapPrimitive(session, casterSeatId, sourceCard, action.targetType, true);
    case "untap_target":
      return applyTapUntapPrimitive(session, casterSeatId, sourceCard, action.targetType, false);
    case "pump_target":
      return applyTargetedPumpEffect(session, casterSeatId, sourceCard, action.effect, preChosen);
    case "mass_pump":
      return applyMassPumpEffect(session, casterSeatId, sourceCard.name, action.effect);
    case "mass_bounce":
      return applyMassBounceEffect(session, casterSeatId, sourceCard.name);
    case "create_tokens":
      return createTokensForSeat(session, casterSeatId, sourceCard.id, action.specs).session;
    case "put_counters_on_self":
      return applyCounterDeltaAtSession(session, casterSeatId, sourceCard.id, action.counterKind, action.amount);
    case "sacrifice_permanent":
      return applySacrificePrimitive(session, casterSeatId, sourceCard, action.scope);
    case "move_card_zone":
      return applyMoveCardZonePrimitive(session, casterSeatId, sourceCard.name, action);
  }
}

function applySacrificePrimitive(session: GameSession, casterSeatId: string, sourceCard: VisibleCard, scope: "self" | "creature_you_control" | "permanent_you_control"): GameSession {
  const seat = session.seats.find((item) => item.id === casterSeatId);
  if (!seat) return session;
  // "Sacrifice a creature / permanent you control" (Disciple of Bolas, ...): a human with a real choice picks it themselves (the picker opens from pendingSacrificeChoices).
  if (seat.kind === "human" && scope !== "self") {
    const candidates = seat.board.battlefield.filter((card) => (scope === "creature_you_control" ? card.typeLine.includes("Creature") : true) && !(sourceCard.typeLine.includes("Creature") && card.id === sourceCard.id));
    if (candidates.length > 1) {
      return { ...session, pendingSacrificeChoices: [...(session.pendingSacrificeChoices ?? []), { seatId: casterSeatId, sourceCardId: sourceCard.id, sourceCardName: sourceCard.name, count: 1, typeFilter: scope === "creature_you_control" ? "creature" : "permanent" }] };
    }
  }
  const target =
    scope === "self" ? seat.board.battlefield.find((card) => card.id === sourceCard.id) : choosePlaguecrafterSacrifice(seat, scope === "creature_you_control" ? "creature" : "permanent");
  if (!target) return session;
  return destroyCreatures(session, [{ seatId: casterSeatId, cardId: target.id, message: `${seat.name} sacrifices ${target.name} to ${sourceCard.name}.` }], "Rules action");
}

// Selects `count` cards from `from` (hand/graveyard), biased by `filter` — "worst" sorts by
// descending mana value (the same "give up the priciest, hardest-to-recast card" convention
// chooseWorstHandCardToDiscard and applyDrawXThenPutBack already use elsewhere in this file),
// "best" the reverse, "any" takes them in their existing order.
function selectCardsForPrimitiveMove(seat: PlayerSeat, from: "hand" | "graveyard", filter: "worst" | "best" | "any", count: number): VisibleCard[] {
  const pool = from === "hand" ? seat.board.hand : (seat.board.graveyard ?? []);
  const ordered = filter === "any" ? pool : [...pool].sort((a, b) => (filter === "worst" ? b.manaValue - a.manaValue : a.manaValue - b.manaValue));
  return ordered.slice(0, Math.max(0, count));
}

function applyMoveCardZonePrimitive(
  session: GameSession,
  casterSeatId: string,
  sourceCardName: string,
  action: Extract<PrimitiveAction, { kind: "move_card_zone" }>
): GameSession {
  const seat = session.seats.find((item) => item.id === casterSeatId);
  if (!seat) return session;
  const selected = selectCardsForPrimitiveMove(seat, action.from, action.filter, action.count);
  if (selected.length === 0) return session;
  if (action.to === "library_top") {
    // Only reachable from hand (applyPutCardsOnLibrary's own scope) — the LLM-facing schema
    // enforces this too, but declining rather than guessing keeps this pure function honest even
    // if a caller somehow slips a graveyard-sourced request through.
    if (action.from !== "hand") return session;
    return applyPutCardsOnLibrary(session, casterSeatId, sourceCardName, selected.map((card) => card.id));
  }
  return selected.reduce((current, card) => moveCardBetweenVisibleZones(current, casterSeatId, card.id, action.to as "hand" | "graveyard" | "exile"), session);
}

export type GenericModalMode = (
  | { kind: "trigger"; effect: TriggerEffect }
  | { kind: "zone"; effect: ZoneEffect }
  | { kind: "pump"; effect: PumpEffect }
  // A single removal-shaped bullet inside a trigger's choose-one (Parapet Thrasher's "Destroy target artifact that opponent controls.")
  | { kind: "removal"; effect: RemovalEffect }
  // A spell-extra shape ("Each player sacrifices a creature of their choice.")
  | { kind: "extra"; effect: SpellExtraEffect }
  // A mode of several sentences ("Create a Treasure token. You lose 1 life."): every part happens, in order.
  | { kind: "all"; parts: GenericModalMode[] }
) & { text?: string };

export interface GenericModalEffect {
  chooseCount: number;
  // "Choose one or more / any number / up to two": the player may stop before chooseCount modes.
  atMost?: boolean;
  modes: GenericModalMode[];
  // "choose one that hasn't been chosen this turn" (Parapet Thrasher): each mode can be picked once per turn per source.
  distinctPerTurn?: boolean;
}

// "Choose one/two/three —\n• mode.\n• mode. ..." (Profane Command, Behold the Beyond, ...) for the
// case removalSpells.ts's own modal handling doesn't own: every bullet is non-removal-shaped (if
// even one bullet were destroy/exile/damage-shaped, parseRemovalEffect would already return a
// modal effect for this card, and that system owns it instead — see the call site in
// resolvePendingAction). Each bullet's own isolated text (with X already substituted, when known)
// is matched against the same zone-effect/common-trigger/pump parsers already used for ordinary
// ETB/spell resolution elsewhere in this file, so a mode none of them recognize (a life-drain-and-
// gain pair, a multi-target "up to X creatures" grant, ...) is simply dropped — the same "decline
// rather than guess" behavior as every other unmatched shape in this codebase, and the same
// behavior removalSpells.ts's own modal parsing already has for modes it can't place.
export function parseGenericModalEffect(oracleText: string, chosenX: number | undefined): GenericModalEffect | undefined {
  if (parseRemovalEffect(etbEffectText(oracleText))) return undefined;
  const header = parseSpellModalHeader(oracleText);
  if (!header) return undefined;
  const modes: GenericModalMode[] = [];
  for (const rawModeText of header.modeTexts) {
    const modeText = chosenX !== undefined ? substituteX(rawModeText, chosenX) : rawModeText;
    const before = modes.length;
    parseOneGenericMode(modeText, modes);
    // The bullet's own wording labels the mode in the prompt a human sees.
    if (modes.length > before) modes[modes.length - 1] = { ...modes[modes.length - 1], text: modeText.replace(/^[•*]\s*/, "").trim() };
  }
  return modes.length > 0 ? { chooseCount: header.chooseCount, modes, ...(header.atMost ? { atMost: true } : {}), ...(/hasn'?t been chosen this turn/i.test(oracleText) ? { distinctPerTurn: true } : {}) } : undefined;
}

function parseOneGenericMode(modeText: string, modes: GenericModalMode[]): void {
  // A bullet of several sentences ("Create a Treasure token. You lose 1 life.") is one mode when EVERY sentence is understood; a
  // flavour label ("Sell Contraband — ") and reminder text are dropped first.
  const body = modeText.replace(/\([^)]*\)/g, "").replace(/^[•*]\s*/, "").replace(/^[A-Z][A-Za-z' ,]{1,40} — /, "").trim();
  const sentences = body.split(/(?<=\.)\s+/).filter(Boolean);
  if (sentences.length > 1) {
    const parts: GenericModalMode[] = [];
    for (const sentence of sentences) {
      const before = parts.length;
      parseSingleGenericMode(sentence, parts);
      if (parts.length === before) break;
    }
    if (parts.length === sentences.length) {
      modes.push({ kind: "all", parts });
      return;
    }
  }
  parseSingleGenericMode(modeText, modes);
}

function parseSingleGenericMode(modeText: string, modes: GenericModalMode[]): void {
  {
    const extra = parseSpellExtraEffects(modeText)[0];
    if (extra) {
      modes.push({ kind: "extra", effect: extra });
      return;
    }
    const pump = parseTargetedPump(modeText);
    if (pump) {
      modes.push({ kind: "pump", effect: pump });
      return;
    }
    const zone = parseZoneEffect(modeText);
    if (zone) {
      modes.push({ kind: "zone", effect: zone });
      return;
    }
    const trigger = commonTriggerEffect(modeText, "clause");
    if (trigger?.kind === "damage_each_other_opponent") {
      modes.push({ kind: "trigger", effect: trigger });
      return;
    }
    const removal = parseRemovalEffect(modeText);
    if (removal && removal.kind !== "modal") {
      modes.push({ kind: "removal", effect: removal });
      return;
    }
    if (trigger) modes.push({ kind: "trigger", effect: trigger });
  }
}

export function genericModalModeHasLegalTarget(session: GameSession, casterSeatId: string, mode: GenericModalMode): boolean {
  if (mode.kind === "all") return mode.parts.every((part) => genericModalModeHasLegalTarget(session, casterSeatId, part));
  if (mode.kind === "extra") return true;
  if (mode.kind === "trigger" && mode.effect.kind === "targeted_effect") {
    const probe = { id: "", name: "", typeLine: "", oracleText: "", colors: [], manaValue: 0, role: "permanent", zone: "battlefield" } as VisibleCard;
    return legalTargets(session, casterSeatId, targetedEffectSpec(mode.effect.effect, "", ""), probe).length > 0;
  }
  if (mode.kind === "removal") return removalEffectHasLegalTarget(session, casterSeatId, { id: "", name: "", typeLine: "", oracleText: "", colors: [], manaValue: 0, role: "permanent", zone: "battlefield" } as VisibleCard, mode.effect);
  if (mode.kind === "zone") return zoneEffectHasLegalTarget(session, casterSeatId, mode.effect);
  if (mode.kind === "pump") return choosePumpTarget(session, casterSeatId, mode.effect) !== undefined;
  if (mode.effect.kind === "add_counter" && mode.effect.scope !== "self" && mode.effect.scope !== "context") {
    return chooseCounterTarget(session, casterSeatId, mode.effect.counterKind, mode.effect.scope === "target_creature_you_control") !== undefined;
  }
  return true;
}

// Same "take the first chooseCount viable modes, in printed order" heuristic removalSpells.ts's
// own modal application already uses (see the "modal" case in applyRemovalEffect) rather than
// scoring between modes — no target-selection UI exists here any more than elsewhere in this
// file's deterministic targeting. A "you may" mode is always taken as accepted: resolveTriggerEffect
// has no notion of declining (that only happens upstream, in the accept/decline UI a real triggered
// ability goes through before ever reaching it), and a synthetic trigger built here skips that step
// entirely, matching how cheaply this engine already treats "optional" ETB effects elsewhere.
export function applyGenericModalEffect(session: GameSession, casterSeatId: string, sourceCard: VisibleCard, effect: GenericModalEffect, contextSeatId?: string, forcedIndex?: number | number[]): GameSession {
  const forced = forcedIndex === undefined ? undefined : Array.isArray(forcedIndex) ? forcedIndex : [forcedIndex];
  const modeKey = (index: number) => `${session.turn}:${sourceCard.id}:mode:${index}`;
  const indexed = effect.modes.map((mode, index) => ({ mode, index }));
  const viableModes = indexed.filter(
    ({ mode, index }) =>
      (forced === undefined || forced.includes(index)) &&
      genericModalModeHasLegalTarget(session, casterSeatId, mode) &&
      !(effect.distinctPerTurn && session.onceEachTurnEffectsUsed?.includes(modeKey(index)))
  );
  const chosen = viableModes.slice(0, effect.chooseCount);
  if (chosen.length === 0) return noLegalTargetEvent(session, casterSeatId, sourceCard.name);
  const marked: GameSession = effect.distinctPerTurn ? { ...session, onceEachTurnEffectsUsed: [...(session.onceEachTurnEffectsUsed ?? []), ...chosen.map(({ index }) => modeKey(index))] } : session;
  const applyMode = (current: GameSession, mode: GenericModalMode): GameSession => {
    if (mode.kind === "all") return mode.parts.reduce(applyMode, current);
    if (mode.kind === "extra") return applySpellExtraEffect(current, casterSeatId, sourceCard, mode.effect);
    if (mode.kind === "zone") return applyZoneEffect(current, casterSeatId, sourceCard.name, mode.effect);
    if (mode.kind === "pump") return applyTargetedPumpEffect(current, casterSeatId, sourceCard, mode.effect);
    if (mode.kind === "removal") return applyRemovalEffect(current, casterSeatId, sourceCard.name, sourceCard, mode.effect);
    const syntheticTrigger: Extract<PendingAction, { type: "trigger" }> = {
      id: crypto.randomUUID(),
      type: "trigger",
      actorSeatId: contextSeatId ?? casterSeatId,
      controllerSeatId: casterSeatId,
      sourceCardId: sourceCard.id,
      sourceCardName: sourceCard.name,
      triggerKind: "common",
      effect: mode.effect,
      message: ""
    };
    return resolveTriggerEffect(current, syntheticTrigger);
  };
  return chosen.map(({ mode }) => mode).reduce(applyMode, marked);
}

interface CounterAccumulationEffect {
  counterKind: string;
  addAmount: number;
  threshold: number;
  payoff: TriggerEffect;
}

// "At the beginning of your upkeep, choose one — • Put a loyalty counter on Idol of Oblivion. • If
// Idol of Oblivion has three or more loyalty counters on it, remove all of them and create a 5/5
// colorless Avatar creature token." (Idol of Oblivion, and the same "charge up, then cash in" shape
// on similar permanents) — this doesn't fit the generic modal machinery above: mode two's threshold
// check references mode one's own counter kind, and "remove them and <payoff>" is a compound
// conditional no single-mode parser (pump/zone/trigger) represents on its own. Handled as its own
// dedicated shape, tried before the generic modal fallback in applyDeterministicPhaseTrigger, the
// same way this file already special-cases other common-but-not-generic patterns (Thopter
// Assembly's gated return-and-remake, Everflowing Chalice's kicker-scaled counters). Restricted to
// self-targeting (the counter always lands on the permanent with the ability) — every real card of
// this shape works that way; a "put a counter on target permanent, cash in on a different one" card
// doesn't exist and would need real per-mode targeting this engine doesn't have anyway.
export function parseCounterAccumulationTrigger(oracleText: string, cardName: string): CounterAccumulationEffect | undefined {
  const header = parseModalHeader(oracleText);
  if (!header || header.modeTexts.length !== 2) return undefined;
  const [modeA, modeB] = header.modeTexts;
  const escapedName = cardName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const selfRef = `(?:this (?:artifact|creature|permanent|enchantment|land|planeswalker)|${escapedName})`;
  const addMatch = modeA.match(new RegExp(`^put (a|one|two|three|four|five|\\d+) ([a-z][a-z0-9+/\\- ]*?) counters? on ${selfRef}\\.?$`, "i"));
  if (!addMatch) return undefined;
  const addAmount = numberWordToInt(addMatch[1]);
  const counterKind = addMatch[2].trim().toLowerCase();
  if (!addAmount || !counterKind) return undefined;
  const escapedKind = counterKind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const thresholdMatch = modeB.match(
    new RegExp(`^if ${selfRef} has (a|one|two|three|four|five|\\d+) or more ${escapedKind} counters? on it,\\s*remove (?:all of )?them and (.+)$`, "i")
  );
  if (!thresholdMatch) return undefined;
  const threshold = numberWordToInt(thresholdMatch[1]);
  if (!threshold) return undefined;
  const tokenSpecs = parseCreateTokenSpecs(thresholdMatch[2]);
  if (tokenSpecs.length === 0) return undefined;
  return { counterKind, addAmount, threshold, payoff: { kind: "create_tokens", tokens: tokenSpecs } };
}

// Greedy "cash in the moment you're eligible" rather than this file's usual "first viable mode in
// printed order" modal heuristic (see applyGenericModalEffect's own comment on that default) —
// printed order here is always [add, cash-in], so the default heuristic would pick "add" forever
// and the payoff mode would never be reachable, which is worse than the usual heuristic's tradeoff
// since it makes the card's entire reason for being played inert.
export function applyCounterAccumulationEffect(session: GameSession, seatId: string, sourceCard: VisibleCard, effect: CounterAccumulationEffect): GameSession {
  const currentCount = counterCount(sourceCard, effect.counterKind);
  const withCounterDelta = (delta: number): GameSession => ({
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === seatId
        ? {
            ...seat,
            board: {
              ...seat.board,
              battlefield: seat.board.battlefield.map((card) =>
                card.id === sourceCard.id ? applyCounterDelta(card, effect.counterKind, delta) : card
              )
            }
          }
        : seat
    )
  });
  if (currentCount >= effect.threshold) {
    const trigger: Extract<PendingAction, { type: "trigger" }> = {
      id: crypto.randomUUID(),
      type: "trigger",
      actorSeatId: seatId,
      controllerSeatId: seatId,
      sourceCardId: sourceCard.id,
      sourceCardName: sourceCard.name,
      triggerKind: "common",
      effect: effect.payoff,
      message: ""
    };
    return resolveTriggerEffect(withCounterDelta(-currentCount), trigger);
  }
  return {
    ...withCounterDelta(effect.addAmount),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${sourceCard.name} gets ${effect.addAmount === 1 ? "a" : effect.addAmount} ${effect.counterKind} counter${effect.addAmount === 1 ? "" : "s"}.`
      },
      ...session.events
    ]
  };
}

// Brainsurge-style: draw X (the spell's own paid X, supplied by the caller), then put a fixed
// number of cards from hand back on top of the library. No interactive "choose N cards" UI exists
// anywhere in this engine (every hand/library choice here is auto-resolved — see chooseAuraAttachTarget,
// chooseRemovalTarget, etc.), so this puts back the highest-mana-value cards currently in hand: the
// same "keep what's cheap and castable, cycle the rest" bias a player defaults to with no clearly
// worse specific card to name.
// Only used by the pure-function trigger-resolution path (applyGenericAbilityEffect and friends,
// which can't reach pendingRuleChoice — see its own comment on the search_library effect for the
// same constraint), where no interactive per-player choice is possible. The interactive path
// (finishTriggerResolution's draw_then_put_back branch, covering loyalty/ETB/death/phase triggers —
// i.e. Aminatou, the Fateshifter's +1 and the like) draws, then opens a real pendingRuleChoice
// instead of calling this at all.
export function applyDrawXThenPutBack(session: GameSession, seatId: string, sourceName: string, drawCount: number, putBackAmount: number): GameSession {
  const seatName = session.seats.find((seat) => seat.id === seatId)?.name ?? "Player";
  const drawnSession =
    drawCount > 0 ? drawMultipleForSeat(session, seatId, drawCount, `${seatName} draws ${drawCount} from ${sourceName}.`) : session;
  const seat = drawnSession.seats.find((item) => item.id === seatId);
  if (!seat) return drawnSession;
  const putBack = [...seat.board.hand].sort((a, b) => b.manaValue - a.manaValue).slice(0, Math.min(putBackAmount, seat.board.hand.length));
  return applyPutCardsOnLibrary(drawnSession, seatId, sourceName, putBack.map((card) => card.id));
}

function applyImpulseDraw(session: GameSession, seatId: string, sourceName: string, amount: number, untilEndOfNextTurn: boolean): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  const library = seat.library ?? [];
  const cards = library.slice(0, amount);
  if (cards.length === 0) return session;
  const exiledPlayableUntilTurn = untilEndOfNextTurn ? session.turn + 1 : session.turn;
  const exiled = cards.map((card) => ({
    ...resetForZoneChange(card, "exile" as const),
    ownerSeatId: card.ownerSeatId ?? seatId,
    exiledPlayableBySeatId: seatId,
    exiledPlayableUntilTurn
  }));
  return {
    ...session,
    seats: session.seats.map((item) =>
      item.id === seatId
        ? {
            ...item,
            library: library.slice(amount),
            board: { ...item.board, exile: [...(item.board.exile ?? []), ...exiled] },
            zones: { ...item.zones, library: Math.max(0, item.zones.library - exiled.length), exile: item.zones.exile + exiled.length }
          }
        : item
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${sourceName} exiles ${exiled.length} card${exiled.length === 1 ? "" : "s"} from the top of ${possessive(seat)} library — playable ${untilEndOfNextTurn ? "until the end of next turn" : "this turn"}.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

// Same "no generic hidden-zone search UI" deterministic heuristic used everywhere else in this
// engine: highest mana value nonland card, across any opponent's library (this engine doesn't
// distinguish "target opponent" from "any opponent" for search-target selection elsewhere either —
// see chooseControlTarget/chooseRemovalTarget's similar cross-opponent pooling).
function chooseStealAndPlayTarget(session: GameSession, casterSeatId: string): { seatId: string; card: VisibleCard } | undefined {
  const candidates: Array<{ seatId: string; card: VisibleCard }> = [];
  for (const seat of session.seats) {
    if (seat.id === casterSeatId) continue;
    for (const card of seat.library ?? []) {
      if (!isLandCard(card)) candidates.push({ seatId: seat.id, card });
    }
  }
  if (candidates.length === 0) return undefined;
  return candidates.reduce((a, b) => (b.card.manaValue > a.card.manaValue ? b : a));
}

function applyStealAndPlay(session: GameSession, casterSeatId: string, sourceName: string): GameSession {
  const target = chooseStealAndPlayTarget(session, casterSeatId);
  if (!target) return noLegalTargetEvent(session, casterSeatId, sourceName);
  const { session: exiledSession } = moveCardAcrossSeats(session, target.seatId, target.card.id, casterSeatId, "exile");
  const withPlayPermission: GameSession = {
    ...exiledSession,
    seats: exiledSession.seats.map((seat) =>
      seat.id === casterSeatId
        ? {
            ...seat,
            board: {
              ...seat.board,
              exile: (seat.board.exile ?? []).map((card) =>
                card.id === target.card.id ? { ...card, exiledPlayableBySeatId: casterSeatId, exiledPlayableUntilTurn: undefined } : card
              )
            }
          }
        : seat
    )
  };
  return {
    ...withPlayPermission,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: casterSeatId,
        message: `${sourceName} searches an opponent's library and exiles ${target.card.name} — playable for as long as it remains exiled.`,
        detail: "Rules action"
      },
      ...withPlayPermission.events
    ]
  };
}

// Shallow-copies power/toughness onto their current effective values (counters, static buffs, ...)
// so a view built from this reads the same numbers combat math will actually use — the raw
// card.power/toughness strings are what's printed on the card, not what's currently true.
// Creature subtypes of a type line (either dash), for "shares a creature type"; a Changeling shares a type with every creature.
function creatureSubtypesOf(card: VisibleCard): string[] {
  if (!card.typeLine.includes("Creature")) return [];
  const match = card.typeLine.match(/[—-]\s*(.+)$/);
  return match ? match[1].trim().split(/\s+/).filter(Boolean) : [];
}

export function sharesCreatureType(a: VisibleCard, b: VisibleCard): boolean {
  const isChangeling = (card: VisibleCard) => !card.abilitiesStripped && /\bchangeling\b/i.test(card.oracleText);
  if (isChangeling(a) || isChangeling(b)) return true;
  const types = new Set(creatureSubtypesOf(a).map((type) => type.toLowerCase()));
  return creatureSubtypesOf(b).some((type) => types.has(type.toLowerCase()));
}

export function chooseAgentLibraryCardForRuleChoice(
  seat: PlayerSeat,
  choice: Extract<PendingRuleChoice, { kind: "choose_card_from_library" }>,
  excludeIds: Set<string> = new Set(),
  // Cards already picked earlier in THIS SAME search (Kodama's Reach/Cultivate's own "up to two
  // basic land cards" both go through this same loop) — folded into the color-gap computation below
  // so the second pick chases a DIFFERENT missing color instead of just re-confirming the first pick
  // already covers the one it found.
  alreadyChosen: VisibleCard[] = [],
  allSeats?: PlayerSeat[]
) {
  const library = (seat.library ?? []).filter((card) => !excludeIds.has(card.id));
  if (library.length === 0) return undefined;
  const filter = choice.allowedCardFilter?.toLowerCase() ?? "";
  // rule 701.19b: a search with a real, specific restriction (a named basic land type, "basic
  // land," a creature type, ...) that finds no legal match fails to find — it does NOT fall back to
  // some other card just because the library still has cards left in it. Reported live as Sable's
  // Three Visits (searching only for "Forest") fetching Elvish Mystic once its own Forests were
  // already used up: both this branch's `?? library[0]` and the generic type-match branch below
  // used to always hand back *some* card rather than admitting the search came up empty.
  if (filter.includes("basic land")) {
    // Prefer a basic land type that actually fills a gap in this deck's manabase (a color from the
    // commander's identity this seat has no source of yet) over just the first basic land in
    // library order. Reported live as Kodama's Reach (a 5-color deck missing white and red) always
    // fetching a color the seat already had instead.
    return chooseColorGapBasicLand(seat, library.filter((card) => isBasicLandCard(card)), alreadyChosen, allSeats);
  }
  // A search restricted to a specific card type (Fauna Shaman's "creature card," an activated
  // ability's SearchLibraryEffect.cardTypeFilter, ...) — prefer a matching card over the generic
  // destination-based fallback below. The spell-level Rules Advisor's own allowedCardFilter is a
  // free-text phrase ("cards matching the source effect"), not a type word, so this simply never
  // matches for that path and is the one shape allowed to still fall through to the fallback below.
  if (filter && !/^cards?$/.test(filter)) {
    // "Forest or Plains", "Mountain or Swamp", ... (Three Visits and its ilk) name several
    // alternative subtypes rather than one — checking the whole phrase against typeLine never
    // matches (no card's type line literally contains "forest or plains"), which silently fell
    // through to the destination-based fallback below and, for a battlefield-bound search, handed
    // out the first CREATURE in the library instead of a land. Reproduced live: Three Visits found
    // Seedborn Muse. Match against any single alternative instead.
    // A longer list ("Plains, Island, Swamp, or Mountain," Farseek) uses commas between alternatives
    // too, not just "or" — splitting on " or " alone left the first three names stuck together as
    // one never-matching blob ("plains, island, swamp,"), which is exactly as unmatchable as the
    // whole un-split phrase was, and fell through to the same creature-first fallback below.
    // Reported live as Farseek fetching Atarka, World Render. Splits on ", " (optionally swallowing
    // a following "or ") or a standalone " or ", so both "Forest or Plains" and "Plains, Island,
    // Swamp, or Mountain" resolve to their real individual type words.
    const alternatives = filter
      .split(/\s*,\s*(?:or\s+)?|\s+or\s+/)
      .map((word) => word.trim())
      .filter(Boolean);
    // A mana-value restriction alongside the type restriction (Urza's Saga chapter III's "an
    // artifact card with mana cost {0} or {1},", any real "search for a card with mana value N or
    // less" tutor) — see choice.manaValueRestriction's own doc comment.
    const restriction = choice.manaValueRestriction;
    const matchesManaValue = (card: VisibleCard) =>
      !restriction || (restriction.op === "lte" ? card.manaValue <= restriction.value : restriction.op === "gte" ? card.manaValue >= restriction.value : card.manaValue === restriction.value);
    // "permanent card" (Tezzeret, Artifice Master's emblem, Garruk-style "search for a permanent"): anything that is not an instant or sorcery.
    // Put onto the battlefield, the best one is the most expensive (a creature on a tie, a land last), not simply the first in library order.
    if (alternatives.some((word) => /^(?:nonland )?permanent$/.test(word))) {
      const candidates = library.filter((card) => cardMatchesTypeFilter(card.typeLine, filter) && matchesManaValue(card));
      if (choice.destination !== "battlefield") return candidates[0];
      return candidates.reduce<VisibleCard | undefined>((best, card) => {
        const rank = (item: VisibleCard) => item.manaValue * 10 + (item.typeLine.includes("Creature") ? 5 : 0) + (isLandCard(item) ? -100 : 0);
        return !best || rank(card) > rank(best) ? card : best;
      }, undefined);
    }
    const typeMatch = library.find((card) => {
      const typeLine = card.typeLine.toLowerCase();
      return alternatives.some((word) => typeLine.includes(word)) && matchesManaValue(card);
    });
    if (typeMatch) return typeMatch;
    // A real type name matched nothing — fail to find, same reasoning as the basic-land branch
    // above — UNLESS this is rulesAdvisor.ts's own generic placeholder for "couldn't extract a real
    // type at all," which can never match any typeLine by construction and is meant to fall through
    // to the creature/land bias below rather than be read as a failed search.
    if (filter !== "cards matching the source effect") return undefined;
  }
  // A graveyard-bound tutor (Entomb, Buried Alive, ...) is almost always paired with reanimation,
  // so it gets the same "prefer a creature" bias as a battlefield-bound one rather than the generic
  // hand-tutor fallback below.
  if (choice.destination === "battlefield" || choice.destination === "graveyard") {
    return library.find((card) => card.typeLine.includes("Creature")) ?? library.find((card) => !card.typeLine.includes("Instant") && !card.typeLine.includes("Sorcery")) ?? library[0];
  }
  return library.find((card) => !isLandCard(card)) ?? library[0];
}

// An agent's resolution of "search your library for a <type> card, put it onto the battlefield, then shuffle": the same deterministic chooser every
// other agent library search uses (chooseAgentLibraryCardForRuleChoice), then the shared tutor-to-battlefield mover (ETB triggers, enteredFrom/enteredTurn).
// A search with no legal card finds nothing; the library is shuffled either way (rule 701.19).
export function resolveSearchLibraryPut(session: GameSession, trigger: Extract<PendingAction, { type: "trigger" }>): GameSession {
  const effect = trigger.effect;
  if (effect.kind !== "search_library_put") return session;
  const seat = session.seats.find((item) => item.id === trigger.controllerSeatId);
  if (!seat) return session;
  const choice: Extract<PendingRuleChoice, { kind: "choose_card_from_library" }> = {
    id: trigger.id,
    kind: "choose_card_from_library",
    controllerSeatId: seat.id,
    sourceCardId: trigger.sourceCardId,
    sourceCardName: trigger.sourceCardName,
    prompt: "",
    destination: "battlefield",
    tapped: effect.tapped,
    maxChoices: 1,
    allowedCardFilter: effect.filter
  };
  const found = chooseAgentLibraryCardForRuleChoice(seat, choice, new Set(), [], session.seats);
  let next = session;
  if (found) {
    next = moveLibraryCardToDestination(session, seat.id, found.id, "battlefield", Boolean(effect.tapped), true);
  } else {
    next = rulesEvent(session, seat.id, `${seat.name} searches their library for a ${effect.filter} card (${trigger.sourceCardName}) but finds nothing, then shuffles.`);
  }
  return { ...next, seats: next.seats.map((item) => (item.id === seat.id ? { ...item, library: shuffleCards(item.library ?? []) } : item)) };
}

export function staticConditionMet(condition: StaticCondition, seat: PlayerSeat, source?: VisibleCard, activePlayerId?: string): boolean {
  if (condition.kind === "your_turn") return activePlayerId === seat.id;
  if (condition.kind === "self_untapped") return source !== undefined && !source.tapped;
  if (condition.kind === "life_at_least") return seat.life >= condition.amount;
  if (condition.kind === "life_over_starting") return seat.life >= COMMANDER_STARTING_LIFE + condition.amount;
  return seat.board.battlefield.some((card) => card.commander);
}

// A card's colors against a chosen color stored as a letter ("W") or a word ("white").
export function hasChosenColor(card: VisibleCard, chosen: string): boolean {
  const letter = ({ white: "W", blue: "U", black: "B", red: "R", green: "G" } as Record<string, string>)[chosen.toLowerCase()] ?? chosen.toUpperCase();
  return (card.colors ?? []).some((color) => color.toUpperCase() === letter);
}

// Sum of matching permanents/cards across EVERY seat's battlefield or graveyard (Soulless One).
export function countAcrossAllZones(seats: PlayerSeat[], terms: Array<{ zone: "battlefield" | "graveyard"; matcher: string }>): number {
  return terms.reduce(
    (total, term) =>
      total + seats.reduce((sum, seat) => sum + countMatchingPermanents(term.zone === "battlefield" ? seat.board.battlefield : (seat.board.graveyard ?? []), term.matcher), 0),
    0
  );
}

// "..., where X is [half] the number of <Qualifier> you control[, rounded down|up]" read off the seat's own
// battlefield. undefined when the clause has no such definition.
export function resolveWhereXBoardCount(text: string, seat: PlayerSeat): number | undefined {
  const match = text.match(/\bwhere x is (half )?the number of ([a-z ]+?) you control(?:, rounded (down|up))?/i);
  if (!match) return undefined;
  const count = countMatchingPermanents(seat.board.battlefield, match[2].trim().toLowerCase());
  if (!match[1]) return count;
  return match[3]?.toLowerCase() === "up" ? Math.ceil(count / 2) : Math.floor(count / 2);
}

// A purely-generic fake card, used to reuse chooseManaSourcesForCost for costs that don't come
// from an actual card's mana cost (e.g. paying an attack tax on declaration).
export function genericCostShim(amount: number): VisibleCard {
  return {
    id: "attack-tax-shim",
    name: "Attack Tax",
    typeLine: "",
    oracleText: "",
    manaValue: amount,
    colors: [],
    colorIdentity: [],
    role: "effect",
    zone: "battlefield"
  };
}

export function genericManaAbilityCostShim(ability: { costManaText: string }): VisibleCard {
  return { ...genericCostShim(manaValueFromManaCost(ability.costManaText)), manaCost: ability.costManaText || undefined };
}

export function drawForSeat(session: GameSession, seatId: string, message: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (seat && !seat.hasLost && !seat.library?.[0] && playerCantLose(seat)) return session;
  if (seat && !seat.hasLost && !seat.library?.[0]) {
    return {
      ...session,
      seats: session.seats.map((item) => (item.id === seatId ? { ...item, hasLost: true, lossReason: "drew from an empty library" } : item)),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} attempted to draw from an empty library and loses the game.`,
          detail: "State-based action"
        },
        ...session.events
      ]
    };
  }

  const seats = session.seats.map((seat) => {
    if (seat.id !== seatId || seat.zones.library <= 0) return seat;
    const [drawn, ...library] = seat.library ?? [];
    if (!drawn) return seat;
    return {
      ...seat,
      drawnThisTurn: { turn: session.turn, count: (seat.drawnThisTurn?.turn === session.turn ? seat.drawnThisTurn.count : 0) + 1 },
      library,
      board: {
        ...seat.board,
        hand: [...seat.board.hand, { ...drawn, zone: "hand" as const }]
      },
      zones: {
        ...seat.zones,
        hand: seat.zones.hand + 1,
        library: Math.max(0, seat.zones.library - 1)
      }
    };
  });

  // "Whenever an opponent draws a card, that player loses 1 life." (Scrawling Crawler): every opposing watcher punishes the drawer.
  const drawPunishers = session.seats
    .filter((watcher) => watcher.id !== seatId && !watcher.hasLost)
    .reduce((total, watcher) => total + watcher.board.battlefield.filter((card) => !card.abilitiesStripped && /whenever an opponent draws a card, that player loses (\d+) life/i.test(card.oracleText)).reduce((sum, card) => sum + Number.parseInt(card.oracleText.match(/whenever an opponent draws a card, that player loses (\d+) life/i)![1], 10), 0), 0);
  const drewACard = seats.some((item) => item.id === seatId && item.board.hand.length > (session.seats.find((old) => old.id === seatId)?.board.hand.length ?? 0));
  const punishedSeats = drawPunishers > 0 && drewACard ? seats.map((item) => (item.id === seatId ? { ...item, life: item.life - drawPunishers } : item)) : seats;
  return {
    ...session,
    seats: punishedSeats,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message
      },
      ...session.events
    ]
  };
}

export function drawMultipleForSeat(session: GameSession, seatId: string, count: number, message: string): GameSession {
  let next = session;
  for (let index = 0; index < count; index += 1) {
    next = drawForSeat(next, seatId, index === 0 ? message : `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} draws a card.`);
  }
  return next;
}

export function resolveAgentLibraryLookWorkflow(
  session: GameSession,
  seatId: string,
  sourceCardName: string,
  workflow: "scry_cards" | "surveil_cards" | "look_at_top_cards" | "look_at_top_cards_reveal_type_to_hand" | "reorder_top_cards",
  count: number,
  allowedCardFilter?: string,
  // reorder_top_cards only (Ponder's "...then draw a card.") — leaving the top of the library
  // untouched is already a legal resolution of the reorder itself (see the no-op comment below),
  // but the trailing draw is unconditional and still has to happen even when nothing else does.
  drawCountAfter?: number,
  // look_at_top_cards_reveal_type_to_hand only: where the cards NOT taken to hand go — undefined/
  // "bottom" (Growing Rites of Itlimoc) or "graveyard" (Grisly Salvage). See RuleWorkflow's own
  // restDestination field.
  restDestination?: "bottom" | "graveyard"
): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const seatName = seat?.name ?? "Agent";

  // "look_at_top_cards_reveal_type_to_hand" (Growing Rites of Itlimoc: look at N, may reveal a
  // card matching allowedCardFilter to hand, the rest to the bottom) — rule 701.19b: a restricted
  // search that finds no legal match fails to find, it does NOT fall back to some other card; the
  // whole batch goes to the bottom with nothing taken, same as chooseAgentLibraryCardForRuleChoice's
  // own "no card matches, don't guess" behavior for a graveyard/library search elsewhere.
  if (workflow === "look_at_top_cards_reveal_type_to_hand") {
    const cards = (seat?.library ?? []).slice(0, count);
    if (cards.length === 0) {
      return {
        ...session,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId,
            message: `${seatName} resolves ${sourceCardName}, but the library is empty.`
          },
          ...session.events
        ]
      };
    }
    const eligible = allowedCardFilter ? cards.filter((card) => cardMatchesTypeFilter(card.typeLine, allowedCardFilter)) : cards;
    const chosen = eligible.length > 0 ? eligible.reduce((best, card) => (card.manaValue > best.manaValue ? card : best)) : undefined;
    const rest = cards.filter((card) => card.id !== chosen?.id);
    const withChosenInHand = chosen ? moveLibraryCardToDestination(session, seatId, chosen.id, "hand", false) : session;
    const finalSession =
      restDestination === "graveyard" ? putLookedAtCardsInGraveyard(withChosenInHand, seatId, rest) : putLookedAtCardsOnBottom(withChosenInHand, seatId, rest);
    const restPlace = restDestination === "graveyard" ? "into the graveyard" : "on the bottom";
    return {
      ...finalSession,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: chosen
            ? `${seatName} resolves ${sourceCardName}: looks at the top ${cards.length}, puts ${chosen.name} into hand, and puts the rest ${restPlace}.`
            : `${seatName} resolves ${sourceCardName}: looks at the top ${cards.length}, finds no ${allowedCardFilter ?? "matching"} card, and puts them all ${restPlace}.`
        },
        ...finalSession.events
      ]
    };
  }

  // scry/surveil/reorder have no modeled agent choice, so leaving the top of the library exactly
  // as it is is already a legal resolution (choosing to keep every card on top, in the same order,
  // is one of the real options each of those effects offers) — a no-op here isn't a missed effect,
  // just a suboptimal-but-valid one. "look_at_top_cards" (Diabolic Vision: look at N, put one into
  // hand, the rest back on top) is different: no card ever reaching hand is not a legal resolution
  // of that text, so it needs an actual implementation rather than this same no-op.
  if (workflow === "look_at_top_cards") {
    const cards = (seat?.library ?? []).slice(0, count);
    if (cards.length === 0) {
      return {
        ...session,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId,
            message: `${seatName} resolves ${sourceCardName}, but the library is empty.`
          },
          ...session.events
        ]
      };
    }
    // No modeled "which card is actually best" evaluation — default to the highest mana value as a
    // rough "probably the most impactful" proxy, the same kind of no-choice-UI default used
    // elsewhere in this engine (chooseSacrificeTarget's opposite "least valuable" bias).
    const chosen = cards.reduce((best, card) => (card.manaValue > best.manaValue ? card : best));
    const rest = cards.filter((card) => card.id !== chosen.id);
    const withChosenInHand = moveLibraryCardToDestination(session, seatId, chosen.id, "hand", false);
    const finalSession = reorderTopLibraryCards(withChosenInHand, seatId, rest);
    return {
      ...finalSession,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seatName} resolves ${sourceCardName}: looks at the top ${cards.length}, puts ${chosen.name} into hand, and returns the rest to the top.`
        },
        ...finalSession.events
      ]
    };
  }

  const withEvent = {
    ...session,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${seatName} resolves ${sourceCardName}: ${workflow.replaceAll("_", " ")} ${count}.`
      },
      ...session.events
    ]
  };
  // Surveil: the agent's deterministic ruling (agentSurveilDecision) bins what it judges better in the graveyard; the rest stays on top.
  if (workflow === "surveil_cards") return applySurveilEffect(session, seatId, sourceCardName, count);
  if ((workflow === "reorder_top_cards" || workflow === "scry_cards") && drawCountAfter) {
    return drawMultipleForSeat(withEvent, seatId, drawCountAfter, `${seatName} draws ${drawCountAfter === 1 ? "a card" : `${drawCountAfter} cards`}.`);
  }
  return withEvent;
}

// Colors from this seat's own deck identity that NOTHING on its battlefield (plus anything already
// picked earlier in the same search, via alreadySecured) can produce yet — an empty result means
// every color the deck plays is already covered, or the deck's colors aren't known at all. Used to
// prefer fetching a basic land that actually plugs a gap over one that just pads an already-covered
// color. Reported live as Kodama's Reach (Veyra, a 5-color WUBRG deck already covering green and
// black) fetching more of a covered color while white and red sat completely unrepresented.
function missingDeckColors(seat: PlayerSeat, alreadySecured: VisibleCard[], allSeats?: PlayerSeat[]): ManaColor[] {
  const deckColors = normalizeManaColors(seat.deck?.colors ?? seat.board.commander?.colorIdentity ?? []);
  if (deckColors.length === 0) return [];
  const covered = new Set<ManaColor>();
  for (const permanent of [...seat.board.battlefield, ...alreadySecured]) {
    for (const color of manaChoicesForCard(permanent, seat, allSeats)) covered.add(color);
  }
  return deckColors.filter((color) => !covered.has(color));
}

// The single basic land (among `options`) that best helps this seat's manabase: a totally missing
// deck color beats one it already has some source of, which in turn beats a color the deck doesn't
// even play (still preferred over an arbitrary pick — see chooseBestBasicLandForFetch's own
// deck-identity preference for the single-fetch case this mirrors). Falls all the way back to
// options[0] only when the deck's colors aren't known at all.
export function chooseColorGapBasicLand(seat: PlayerSeat, options: VisibleCard[], alreadySecured: VisibleCard[] = [], allSeats?: PlayerSeat[]): VisibleCard | undefined {
  if (options.length === 0) return undefined;
  const missing = missingDeckColors(seat, alreadySecured, allSeats);
  if (missing.length > 0) {
    const gapMatch = options.find((card) => basicLandTypes(card).some((type) => missing.includes(manaColorForBasicLand(type) as ManaColor)));
    if (gapMatch) return gapMatch;
  }
  const deckColors = normalizeManaColors(seat.deck?.colors ?? seat.board.commander?.colorIdentity ?? []);
  const onColorMatch = options.find((card) => basicLandTypes(card).some((type) => deckColors.includes(manaColorForBasicLand(type) as ManaColor)));
  return onColorMatch ?? options[0];
}

// "Put the rest on the bottom of your library in any order." (Growing Rites of Itlimoc) — mirrors
// reorderTopLibraryCards above, but appends to the END of the library array instead of the front.
// No dedicated interactive reordering step for the bottom half (unlike the top-return "reorder"
// mode) — the bottom of a real library is functionally unobservable in practice, so preserving the
// cards' existing relative order is a fine, low-stakes default rather than a real missing choice.
export function putLookedAtCardsOnBottom(session: GameSession, seatId: string, cards: VisibleCard[]): GameSession {
  if (cards.length === 0) return session;
  const cardIds = new Set(cards.map((card) => card.id));
  const seatName = session.seats.find((seat) => seat.id === seatId)?.name ?? "Player";
  return {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === seatId
        ? {
            ...seat,
            library: [...(seat.library ?? []).filter((card) => !cardIds.has(card.id)), ...cards.map((card) => ({ ...card, zone: "library" as const }))]
          }
        : seat
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${seatName} puts ${cards.length} looked-at card${cards.length === 1 ? "" : "s"} on the bottom of the library.`
      },
      ...session.events
    ]
  };
}

// "When this land enters, sacrifice it. When you do, search your library for a basic Plains, Island, or Swamp card, put it onto the battlefield
// tapped, then shuffle and you gain 1 life." (Obscura Storefront and the rest of its cycle) as one deterministic step - the agent path, and the
// pure fallback for anything that reaches resolveTriggerEffect. The land is sacrificed FIRST (wherever it now sits on its controller's
// battlefield); only if that happened does the reflexive "when you do" search/shuffle/life gain follow (rule 603.12). An agent never leaves the
// land in play: the sacrifice is mandatory and has no payment to decline.
export function resolveSacrificeSelfThenSearch(session: GameSession, trigger: Extract<PendingAction, { type: "trigger" }>): GameSession {
  const effect = trigger.effect;
  if (effect.kind !== "sacrifice_self_then_search") return session;
  const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
  if (!owner || !owner.board.battlefield.some((card) => card.id === trigger.sourceCardId)) return session;
  const sacrificed = moveCardBetweenVisibleZones(session, owner.id, trigger.sourceCardId, "graveyard");
  let next = rulesEvent(sacrificed, owner.id, `${trigger.sourceCardName} is sacrificed.`);
  const alternatives = effect.filter.split(/\s*,\s*/).map((word) => word.trim().toLowerCase()).filter(Boolean);
  const seatNow = next.seats.find((item) => item.id === owner.id)!;
  const found = (seatNow.library ?? []).find((card) => isBasicLandCard(card) && alternatives.some((word) => card.typeLine.toLowerCase().includes(word)));
  if (found) next = moveLibraryCardToDestination(next, owner.id, found.id, "battlefield", true, true);
  else next = rulesEvent(next, owner.id, `${owner.name} searches their library for a basic ${effect.filter} card (${trigger.sourceCardName}) but finds nothing, then shuffles.`);
  return {
    ...next,
    seats: next.seats.map((item) => (item.id === owner.id ? { ...item, library: shuffleCards(item.library ?? []), life: item.life + effect.lifeGain } : item)),
    events: effect.lifeGain > 0 ? [{ id: crypto.randomUUID(), at: new Date().toISOString(), seatId: owner.id, message: `${owner.name} gains ${effect.lifeGain} life (${trigger.sourceCardName}).`, detail: "Rules action" }, ...next.events] : next.events
  };
}
