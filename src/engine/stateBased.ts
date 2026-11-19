// State-based actions, moved verbatim from components/AppFlow.tsx: checkStateBasedActions, runStateBasedActionsPass (lethal damage,
// legend rule, 0-toughness, planeswalker/saga cleanup, ...), winTheGame and the Starfield of Nyx animation helpers.
// Part of a deliberate import cycle with entry.ts / triggers.ts / tokens.ts / damage.ts / effects.ts (function declarations only).

import { hasIndestructible, playerCantLose } from "@/engine/damage";
import { countAcrossAllZones, hasChosenColor, sharesCreatureType, staticConditionMet } from "@/engine/effects";
import { destroyCreatures, returnLinkedExiles } from "@/engine/entry";
import { emblemSourceCards, hasKeyword } from "@/engine/shared";
import { applyImprisonedInTheMoon, applyTreasureNabber } from "@/engine/triggers";
import { findPermanentById, isPlaneswalkerCard, loyaltyCounterCount, possessive, rulesEvent } from "@/engine/zones";
import { attachedBasePowerToughness, attachedPowerToughnessBonus, attachmentStripsAllAbilities, grantedKeywords as attachmentGrantedKeywords, grantedProtectionColors as attachmentGrantedProtectionColors, isAura, isEquipment, playerCreatureLockEffect } from "@/lib/attachments";
import { computeDevotion, computeDevotionToColors, countMatchingPermanents, parseAllZonesCda, parseCharacteristicDefiningAbility, parseConditionalStaticBoosts, parseDevotionCda, parseDevotionNotCreature, parseGroupAnthemBoost, parseGroupKeywordGrant, parseGroupManaAbilityGrant, parseOwnGraveyardCda, parseSelfAnthemBoost, permanentMatchesQualifier } from "@/lib/characteristics";
import { counterCount, effectivePower, effectiveToughness } from "@/lib/counters";
import { shareSessionSeats } from "@/lib/structuralShare";
import { hasCardType, parseLandSubtypeGrants, parseOtherCreaturesGrant, parseTypeGrantEffects, typeGrantAppliesTo } from "@/lib/typeGrants";
import type { GameEvent, GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

// Runs after every session update (see the setSession wrapper below) so state-based actions are
// checked continuously rather than at scattered call sites, matching rule 704's "checked
// whenever a player would receive priority, all performed simultaneously, repeat until none
// remain" model as closely as this turn-driven engine reasonably can.
export function checkStateBasedActions(session: GameSession): GameSession {
  let current = session;
  for (let guard = 0; guard < 10; guard += 1) {
    const result = runStateBasedActionsPass(current);
    current = result.session;
    if (!result.changed) break;
  }
  // The pass rebuilds every seat/board/battlefield array even when it changed nothing; restore the input's references where the
  // content is equal so effects keyed on session.seats (and the 3D table) don't re-fire after a no-op pass.
  return shareSessionSeats(session, current);
}

// "As long as you control five or more enchantments, each other non-Aura enchantment you control
// is a creature in addition to its other types and has base power and base toughness each equal to
// its mana value." (Starfield of Nyx) — narrow to this exact wording, same single-card scoping as
// the other bespoke parsers in this file, rather than generalizing typeGrants.ts's unconditional
// "X you control are Y in addition to other types" grammar to also handle a board-count condition.
function hasStarfieldOfNyxEffect(oracleText: string): boolean {
  return /\bas long as you control five or more enchantments, each other non-aura enchantment you control is a creature in addition to its other types and has base power and base toughness each equal to its mana value\b/i.test(
    oracleText
  );
}

// Live, board-state-driven check (not a stored/cached field) so both the type-grant pass and the
// creature-characteristics pass below can independently ask "is this card Starfield-animated right
// now" without one depending on the other's output from a prior state-based-action pass.
function seatStarfieldAnimatesCard(seat: PlayerSeat, card: VisibleCard): boolean {
  if (card.typeLine.includes("Aura") || card.grantedTypes?.includes("Aura")) return false;
  if (!hasCardType(card, "Enchantment")) return false;
  const hasSource = seat.board.battlefield.some((source) => source.id !== card.id && hasStarfieldOfNyxEffect(source.oracleText));
  if (!hasSource) return false;
  const enchantmentCount = seat.board.battlefield.filter((item) => hasCardType(item, "Enchantment")).length;
  return enchantmentCount >= 5;
}

// "You win the game" (Hellkite Tyrant, Mechanized Production): every other player loses, and the state-based pass ends the game.
export function winTheGame(session: GameSession, winnerSeatId: string, sourceName: string): GameSession {
  const winner = session.seats.find((seat) => seat.id === winnerSeatId);
  if (!winner) return session;
  return rulesEvent(
    { ...session, seats: session.seats.map((seat) => (seat.id === winnerSeatId || seat.hasLost ? seat : { ...seat, hasLost: true, lossReason: `${winner.name} wins the game with ${sourceName}` })) },
    winnerSeatId,
    `${winner.name} wins the game with ${sourceName}!`
  );
}

export function runStateBasedActionsPass(session: GameSession): { session: GameSession; changed: boolean } {
  let changed = false;
  let next = applyImprisonedInTheMoon(applyTreasureNabber(session));
  if (next !== session) changed = true;
  // Stamp the turn every permanent entered on, whichever path put it there (tokens, reanimation, flicker, copies, ...): the paths that
  // bypass playCardFromZone leave enteredTurn unset, and this pass runs right after each action, still within that same turn.
  if (next.seats.some((seat) => seat.board.battlefield.some((card) => card.enteredTurn === undefined))) {
    next = { ...next, seats: next.seats.map((seat) => ({ ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.enteredTurn === undefined ? { ...card, enteredTurn: next.turn } : card)) } })) };
  }
  // Devoid: a permanent with it is colorless.
  if (next.seats.some((seat) => seat.board.battlefield.some((card) => card.colors.length > 0 && !card.abilitiesStripped && /^devoid\b/im.test(card.oracleText)))) {
    next = { ...next, seats: next.seats.map((seat) => ({ ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.colors.length > 0 && !card.abilitiesStripped && /^devoid\b/im.test(card.oracleText) ? { ...card, colors: [] } : card)) } })) };
    changed = true;
  }
  // Animate Dead: "When this Aura leaves the battlefield, that creature's controller sacrifices it."
  {
    const auraIds = new Set(next.seats.flatMap((seat) => seat.board.battlefield.map((card) => card.id)));
    const orphans = next.seats.flatMap((seat) =>
      seat.board.battlefield
        .filter((card) => card.reanimatedByAuraId && !auraIds.has(card.reanimatedByAuraId))
        .map((card) => ({ seatId: seat.id, cardId: card.id, message: `${card.name} is sacrificed because its Aura left the battlefield.` }))
    );
    if (orphans.length > 0) {
      next = destroyCreatures(
        { ...next, seats: next.seats.map((seat) => ({ ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.reanimatedByAuraId && !auraIds.has(card.reanimatedByAuraId) ? { ...card, reanimatedByAuraId: undefined } : card)) } })) },
        orphans,
        "Rules action"
      );
      changed = true;
    }
  }
  // The gods: "As long as your devotion to white and black is less than seven, Athreos isn't a creature."
  if (next.seats.some((seat) => seat.board.battlefield.some((card) => !(card.abilitiesStripped || card.phasedOut) && parseDevotionNotCreature(card.oracleText)))) {
    let godChanged = false;
    next = {
      ...next,
      seats: next.seats.map((seat) => ({
        ...seat,
        board: {
          ...seat.board,
          battlefield: seat.board.battlefield.map((card) => {
            const rule = card.abilitiesStripped ? undefined : parseDevotionNotCreature(card.oracleText);
            if (!rule) return card;
            const creatureNow = computeDevotionToColors(seat.board.battlefield, rule.colors) >= rule.threshold;
            if (!creatureNow && card.typeLine.includes("Creature")) {
              godChanged = true;
              return { ...card, typeLineWithCreature: card.typeLine, typeLine: card.typeLine.replace(/\s*Creature/, ""), attacking: false, blocking: false };
            }
            if (creatureNow && card.typeLineWithCreature) {
              godChanged = true;
              return { ...card, typeLine: card.typeLineWithCreature, typeLineWithCreature: undefined };
            }
            return card;
          })
        }
      }))
    };
    if (godChanged) changed = true;
  }
  const afterLinked = returnLinkedExiles(next);
  if (afterLinked !== next) {
    next = afterLinked;
    changed = true;
  }

  // Layer 7a CDA/devotion power-toughness, computed here — BEFORE the toughness<=0 death check just
  // below — rather than only in the full creature-characteristics pass much further down this same
  // function. A freshly-entered CDA creature (Darksteel Juggernaut: "power and toughness are each
  // equal to the number of artifacts you control") starts with cdaToughness undefined; effectiveToughness's
  // own fallback for that case reads its printed toughness, the literal string "*", which parses to
  // NaN and is coerced to 0 — so it read as toughness 0 until something computed the real value,
  // which didn't happen until that later pass, by which point the death check right after this
  // comment had already destroyed it "for having toughness 0 or less" even with artifacts on the
  // battlefield. Deliberately narrow (just power/toughness, not the full type-grant/attachment/
  // keyword pass) and redundant with that later, fuller pass by design — recomputing the same CDA
  // value twice in one call is harmless, and keeping this pre-pass small keeps its own risk small
  // too. Reported live as Darksteel Juggernaut dying the instant it entered.
  next = {
    ...next,
    seats: next.seats.map((seat) => ({
      ...seat,
      board: {
        ...seat.board,
        battlefield: seat.board.battlefield.map((card) => {
          if (!hasCardType(card, "Creature")) return card;
          const cda = parseCharacteristicDefiningAbility(card.oracleText);
          const devotionCda = parseDevotionCda(card.oracleText);
          const allZonesCda = parseAllZonesCda(card.oracleText);
          const ownGraveCda = parseOwnGraveyardCda(card.oracleText);
          if (!cda && !devotionCda && !allZonesCda && !ownGraveCda) return card;
          let cdaPower = card.cdaPower;
          let cdaToughness = card.cdaToughness;
          if (cda) {
            const count = countMatchingPermanents(seat.board.battlefield, cda.matcher);
            if (cda.stat === "both" || cda.stat === "power") cdaPower = count;
            if (cda.stat === "both" || cda.stat === "toughness") cdaToughness = count;
          }
          if (allZonesCda) {
            const count = countAcrossAllZones(next.seats, allZonesCda.terms);
            cdaPower = count;
            cdaToughness = count;
          }
          if (ownGraveCda) {
            // Old Stickfingers: creature CARDS in the controller's own graveyard.
            const count = countMatchingPermanents(seat.board.graveyard ?? [], ownGraveCda.matcher);
            cdaPower = count;
            cdaToughness = count;
          }
          if (devotionCda) {
            const devotion = computeDevotion(seat.board.battlefield, devotionCda.color);
            if (devotionCda.stat === "both" || devotionCda.stat === "power") cdaPower = devotion;
            if (devotionCda.stat === "both" || devotionCda.stat === "toughness") cdaToughness = devotion;
          }
          if (cdaPower === card.cdaPower && cdaToughness === card.cdaToughness) return card;
          return { ...card, cdaPower, cdaToughness };
        })
      }
    }))
  };

  // Toughness <= 0, no loyalty counters, and the legendary rule all destroy permanents.
  const destructions: Array<{ seatId: string; cardId: string; message: string }> = [];
  for (const seat of next.seats) {
    for (const card of seat.board.battlefield) {
      if (card.typeLine.includes("Creature") && effectiveToughness(card) <= 0) {
        destructions.push({ seatId: seat.id, cardId: card.id, message: `${card.name} is put into ${possessive(seat)} graveyard for having toughness 0 or less.` });
        continue;
      }
      // Rule 704.5g: damage marked on it (earlier this turn) now equals its toughness, e.g. after a toughness drop.
      if (card.typeLine.includes("Creature") && (card.damage ?? 0) > 0 && (card.damage ?? 0) >= effectiveToughness(card) && !hasIndestructible(card)) {
        destructions.push({ seatId: seat.id, cardId: card.id, message: `${card.name} is destroyed by the damage marked on it.` });
        continue;
      }
      if (isPlaneswalkerCard(card) && loyaltyCounterCount(card) <= 0) {
        destructions.push({ seatId: seat.id, cardId: card.id, message: `${card.name} is put into ${possessive(seat)} graveyard for having no loyalty counters.` });
      }
      if (isAura(card)) {
        const attachedSeat = card.attachedToSeatId ? next.seats.find((item) => item.id === card.attachedToSeatId) : undefined;
        const legallyAttached = card.attachedToSeatId
          ? attachedSeat !== undefined && !attachedSeat.hasLost
          : card.attachedToId !== undefined && findPermanentById(next, card.attachedToId) !== undefined;
        if (!legallyAttached) {
          destructions.push({ seatId: seat.id, cardId: card.id, message: `${card.name} is put into ${possessive(seat)} graveyard for not being attached to anything.` });
        }
      }
    }

    const legendaryByName = new Map<string, VisibleCard[]>();
    for (const card of seat.board.battlefield) {
      if (!card.typeLine.includes("Legendary")) continue;
      legendaryByName.set(card.name, [...(legendaryByName.get(card.name) ?? []), card]);
    }
    for (const group of legendaryByName.values()) {
      if (group.length < 2) continue;
      // Controller normally chooses which copy to keep; this engine has no such prompt, so it
      // deterministically keeps the most recently entered copy (last in the battlefield array).
      for (const card of group.slice(0, -1)) {
        destructions.push({ seatId: seat.id, cardId: card.id, message: `${card.name} is put into ${possessive(seat)} graveyard due to the legendary rule.` });
      }
    }
  }
  if (destructions.length > 0) {
    next = destroyCreatures(next, destructions, "State-based action");
    changed = true;
  }

  // +1/+1 and -1/-1 counters annihilate in matched pairs.
  next = {
    ...next,
    seats: next.seats.map((seat) => ({
      ...seat,
      board: {
        ...seat.board,
        battlefield: seat.board.battlefield.map((card) => {
          const plus = counterCount(card, "+1/+1");
          const minus = counterCount(card, "-1/-1");
          if (plus === 0 || minus === 0) return card;
          const removed = Math.min(plus, minus);
          changed = true;
          return {
            ...card,
            counters: (card.counters ?? [])
              .map((counter) => {
                if (counter.kind === "+1/+1") return { ...counter, count: plus - removed };
                if (counter.kind === "-1/-1") return { ...counter, count: minus - removed };
                return counter;
              })
              .filter((counter) => counter.count > 0)
          };
        })
      }
    }))
  };

  // Equipment attached to something that no longer exists (or isn't a creature anymore) becomes
  // unattached rather than destroyed (rule 704.5q); Auras in the same situation were already
  // destroyed above. Every creature's attachmentPowerBonus/attachmentToughnessBonus is then kept
  // in sync with whatever's currently legally attached to it, from any seat's battlefield (an
  // opponent's removal Aura lives in its controller's list, not the enchanted creature's).
  next = {
    ...next,
    seats: next.seats.map((seat) => ({
      ...seat,
      board: {
        ...seat.board,
        battlefield: seat.board.battlefield.map((card) => {
          if (!isEquipment(card) || !card.attachedToId) return card;
          const target = findPermanentById(next, card.attachedToId);
          if (target && target.typeLine.includes("Creature")) return card;
          changed = true;
          return { ...card, attachedToId: undefined };
        })
      }
    }))
  };

  const allAttachments = next.seats.flatMap((seat) =>
    seat.board.battlefield
      .filter((card) => (isAura(card) || isEquipment(card)) && card.attachedToId)
      .map((card) => ({ ...card, controllerSeatId: seat.id }))
  );
  // "Enchant player" Auras with a board-wide creature-lock effect (Overwhelming Splendor) — kept
  // separate from allAttachments above since these target a seat (attachedToSeatId), not a single
  // permanent (attachedToId), and apply to every creature that seat controls rather than one.
  const allPlayerLockAuras = next.seats.flatMap((seat) =>
    seat.board.battlefield.filter((card) => isAura(card) && card.attachedToSeatId && playerCreatureLockEffect(card.oracleText))
  );
  const sameList = (a: string[] | undefined, b: string[] | undefined) => (a?.join(",") ?? "") === (b?.join(",") ?? "");
  next = {
    ...next,
    seats: next.seats.map((seat) => ({
      ...seat,
      board: {
        ...seat.board,
        battlefield: seat.board.battlefield.map((card) => {
          // hasCardType, not a raw typeLine check: a permanent can be a creature only via a granted
          // type (Zur, Eternal Schemer's "target non-Aura enchantment becomes a creature," ...)
          // without that ever being printed on it. Checking typeLine directly here meant a
          // type-granted creature never got this pass's power/toughness/keyword computation at all —
          // it stayed a permanent 0/0 with no keywords, since layers 6/7a/7d below only ever ran for
          // permanents this check let through.
          if (!hasCardType(card, "Creature") && !seatStarfieldAnimatesCard(seat, card)) {
            // Padeem, Consul of Innovation: "Artifacts you control have hexproof." applies to noncreature artifacts too (they skip the creature pass below).
            const groupKeywords = new Set<string>();
            for (const sourceSeat of next.seats) {
              for (const grantSource of sourceSeat.board.battlefield.filter((source) => !source.phasedOut && !source.abilitiesStripped)) {
                for (const grant of parseGroupKeywordGrant(grantSource.oracleText)) {
                  if (grant.controlledOnly && sourceSeat.id !== seat.id) continue;
                  if (grant.excludeSelf && grantSource.id === card.id) continue;
                  if (!permanentMatchesQualifier(card, grant.matcher)) continue;
                  for (const keyword of grant.keywords) groupKeywords.add(keyword);
                }
              }
            }
            const nextGroup = groupKeywords.size > 0 ? Array.from(groupKeywords).sort() : undefined;
            if (sameList(nextGroup, card.groupGrantedKeywords)) return card;
            changed = true;
            return { ...card, groupGrantedKeywords: nextGroup };
          }

          // Layer 7a: characteristic-defining abilities establish this creature's own base P/T
          // from the current board (e.g. "power and toughness equal to the number of lands you
          // control"), evaluated against its own controller's battlefield.
          const cda = parseCharacteristicDefiningAbility(card.oracleText);
          let cdaPower: number | undefined;
          let cdaToughness: number | undefined;
          if (cda) {
            const count = countMatchingPermanents(seat.board.battlefield, cda.matcher);
            if (cda.stat === "both" || cda.stat === "power") cdaPower = count;
            if (cda.stat === "both" || cda.stat === "toughness") cdaToughness = count;
          }
          // Soulless One: counts every player's battlefield AND graveyards.
          const allZonesCdaFull = parseAllZonesCda(card.oracleText);
          if (allZonesCdaFull) {
            const count = countAcrossAllZones(next.seats, allZonesCdaFull.terms);
            cdaPower = count;
            cdaToughness = count;
          }

          const ownGraveCdaFull = parseOwnGraveyardCda(card.oracleText);
          if (ownGraveCdaFull) {
            const count = countMatchingPermanents(seat.board.graveyard ?? [], ownGraveCdaFull.matcher);
            cdaPower = count;
            cdaToughness = count;
          }

          // Layer 7a, devotion variant: "~'s power is equal to your devotion to blue" (Callaphe,
          // the God cycle) — counts colored mana symbols across the battlefield instead of matching
          // permanents, so it's a separate CDA parser/count from the one just above.
          const devotionCda = parseDevotionCda(card.oracleText);
          if (devotionCda) {
            const devotion = computeDevotion(seat.board.battlefield, devotionCda.color);
            if (devotionCda.stat === "both" || devotionCda.stat === "power") cdaPower = devotion;
            if (devotionCda.stat === "both" || devotionCda.stat === "toughness") cdaToughness = devotion;
          }

          // Zur, Eternal Schemer: "Its power and toughness are each equal to its mana value." — the
          // CDA clause granting this lives on Zur, not on the animated permanent's own oracle text,
          // so parseCharacteristicDefiningAbility above can never find it there. animatedAsCreature
          // is the marker resolveEnchantmentAnimation left behind for exactly this case.
          if (card.animatedAsCreature) {
            cdaPower ??= card.manaValue;
            cdaToughness ??= card.manaValue;
          }

          // Starfield of Nyx: "As long as you control five or more enchantments, each other non-
          // Aura enchantment you control is a creature ... and has base power and base toughness
          // each equal to its mana value." Same "power/toughness = own mana value" shape as
          // animatedAsCreature above, but recomputed live off current board state every pass
          // (seatStarfieldAnimatesCard) rather than a one-shot marker — this effect turns off again
          // the instant the enchantment count drops below five, which animatedAsCreature's persist-
          // until-zone-change semantics can't express.
          if (seatStarfieldAnimatesCard(seat, card)) {
            cdaPower ??= card.manaValue;
            cdaToughness ??= card.manaValue;
          }

          let power = 0;
          let toughness = 0;
          const keywordSet = new Set<string>();
          // Man-land animation's granted keywords (flying, vigilance, ...) — see
          // temporaryGrantedKeywords's own comment for why this needs its own field rather than
          // writing into grantedKeywords directly, which this whole pass fully overwrites below.
          for (const keyword of card.temporaryGrantedKeywords ?? []) keywordSet.add(keyword);
          const protectionSet = new Set<string>();
          const setEffectCandidates: Array<{ timestamp: number; power: number; toughness: number }> = [];
          // Layer 6: "Enchanted/equipped creature loses all abilities" (Utter Insignificance) or a
          // board-wide "Creatures enchanted player controls lose all abilities" (Overwhelming
          // Splendor, checked against allPlayerLockAuras below). Applied before layers 6/7 finish
          // computing keywordSet/setEffectCandidates so hasKeyword's abilitiesStripped short-circuit
          // is authoritative regardless of what a later grant/anthem would otherwise have added.
          let losesAllAbilities = false;
          for (const attachment of allAttachments) {
            if (attachment.attachedToId !== card.id) continue;
            if (attachmentStripsAllAbilities(attachment.oracleText)) losesAllAbilities = true;
            const bonus = attachedPowerToughnessBonus(attachment.oracleText);
            if (bonus) {
              power += bonus.power;
              toughness += bonus.toughness;
            }
            // "Equipped creature gets +X/+X, where X is the greatest mana value among your commanders." (Tangleweave Armor)
            if (/\bequipped creature gets \+x\/\+x, where x is the greatest mana value among your commanders\b/i.test(attachment.oracleText)) {
              const owner = next.seats.find((item) => item.id === (attachment.controllerSeatId ?? seat.id)) ?? seat;
              const commanders = [...owner.board.battlefield.filter((permanent) => permanent.commander), ...(owner.board.commander ? [owner.board.commander] : [])];
              const x = Math.max(0, ...commanders.map((commander) => commander.manaValue));
              power += x;
              toughness += x;
            }
            // "Equipped creature gets +1/+1 for each other creature you control that shares a creature type with it." (Stoneforge Masterwork)
            if (/\bequipped creature gets \+1\/\+1 for each other creature you control that shares a creature type with it\b/i.test(attachment.oracleText)) {
              const owner = next.seats.find((item) => item.id === (attachment.controllerSeatId ?? seat.id)) ?? seat;
              const sharing = owner.board.battlefield.filter((other) => other.id !== card.id && other.typeLine.includes("Creature") && sharesCreatureType(card, other)).length;
              power += sharing;
              toughness += sharing;
            }
            for (const keyword of attachmentGrantedKeywords(attachment.oracleText)) keywordSet.add(keyword);
            for (const color of attachmentGrantedProtectionColors(attachment.oracleText)) protectionSet.add(color);

            const override = attachedBasePowerToughness(attachment.oracleText);
            if (override) {
              const attachmentController = next.seats.find((item) => item.id === attachment.controllerSeatId);
              const resolved =
                override === "life_total"
                  ? { power: attachmentController?.life ?? 0, toughness: attachmentController?.life ?? 0 }
                  : override;
              setEffectCandidates.push({ timestamp: attachment.attachTimestamp ?? 0, ...resolved });
            }
          }
          for (const lockAura of allPlayerLockAuras) {
            if (lockAura.attachedToSeatId !== seat.id) continue;
            const lock = playerCreatureLockEffect(lockAura.oracleText);
            if (!lock) continue;
            losesAllAbilities = true;
            setEffectCandidates.push({ timestamp: lockAura.attachTimestamp ?? 0, ...lock });
          }
          // "Creatures your opponents control lose all abilities and have base power and toughness
          // N/N until end of turn." (Vedalken Humiliator, ...) — set directly on the card by
          // applyMetalcraftAttackDebuff rather than derived from an attachment, so it needs its own
          // source here. Number.MAX_SAFE_INTEGER as the timestamp always wins layer 7b's "newest
          // wins" tiebreak over any standing Aura-based override, matching a same-turn effect
          // resolving after whatever else is already on the creature.
          if (card.temporaryAbilitiesStripped) losesAllAbilities = true;
          if (card.temporaryBasePower !== undefined && card.temporaryBaseToughness !== undefined) {
            setEffectCandidates.push({ timestamp: Number.MAX_SAFE_INTEGER, power: card.temporaryBasePower, toughness: card.temporaryBaseToughness });
          }

          // Layer 7d: a self-anthem ("~ gets +1/+1 for each creature card in your graveyard," Jarad,
          // Golgari Lich Lord-style) adds on top of whatever base layers 7a/7b left behind, evaluated
          // live off the controller's current battlefield/graveyard so it tracks board state instead
          // of being cached from whenever the creature entered. Reuses attachmentPowerBonus/
          // attachmentToughnessBonus (already a generic "additive P/T bonus from any source" field,
          // not literally attachment-only) rather than adding a parallel field for the same layer.
          const selfAnthem = parseSelfAnthemBoost(card.oracleText);
          if (selfAnthem) {
            const source =
              selfAnthem.zone === "graveyard"
                ? (seat.board.graveyard ?? [])
                : selfAnthem.zone === "opponents_graveyards"
                  ? next.seats.filter((other) => other.id !== seat.id).flatMap((other) => other.board.graveyard ?? [])
                  : seat.board.battlefield;
            const count = countMatchingPermanents(source, selfAnthem.matcher);
            power += selfAnthem.power * count;
            toughness += selfAnthem.toughness * count;
          }

          // Layer 6: "[Other] [Qualifier] you control have Keyword[, ...]." (Soaring Lightbringer,
          // "Dragons you control have indestructible," "Enchantment creatures you control have
          // deathtouch, lifelink, and hexproof," ...) — scans every permanent this creature's
          // controller has (not just attachments) for a static keyword grant whose qualifier this
          // creature matches, distinct from parseSelfAnthemBoost (self-only P/T) and Aura/Equipment
          // grants (attached-target-only).
          // A grant that doesn't say "you control" (a lord over "Zombie creatures", Lord of the Undead)
          // reaches every player's matching creatures, so every seat's permanents are scanned as sources;
          // a "you control" one only counts when its source is on this creature's own side.
          // Emblems (Elspeth Sun's Champion's "Creatures you control get +2/+2 and have flying", Domri Rade's keywords, ...) are sources too: their
          // controller is the seat that holds them, and nothing can remove them.
          for (const sourceSeat of next.seats) {
            for (const grantSource of [...sourceSeat.board.battlefield.filter((source) => !source.phasedOut), ...emblemSourceCards(sourceSeat)]) {
              for (const grant of parseGroupKeywordGrant(grantSource.oracleText)) {
                if (grant.controlledOnly && sourceSeat.id !== seat.id) continue;
                if (grant.excludeSelf && grantSource.id === card.id) continue;
                if (!permanentMatchesQualifier(card, grant.matcher)) continue;
                if (grant.withKeyword && !hasKeyword(card, grant.withKeyword)) continue;
                for (const keyword of grant.keywords) keywordSet.add(keyword);
              }
            }
          }

          // Scion of Draco: "Each creature you control has vigilance if it's white, hexproof if it's blue, lifelink if it's black, first strike if it's red, and trample if it's green."
          // Envoy of the Ancestors: "Modified creatures you control have lifelink." (modified = has a counter, or an Equipment/Aura you control attached).
          // Zurgo and Ojutai: "[name] has hexproof as long as it entered this turn."
          for (const grantSource of seat.board.battlefield) {
            if ((grantSource.abilitiesStripped || grantSource.phasedOut)) continue;
            for (const line of grantSource.oracleText.split("\n")) {
              const byColor = line.replace(/\([^)]*\)/g, "").match(/^each creature you control has (.+?)\.?$/i);
              if (byColor && /\bif it'?s (?:white|blue|black|red|green)\b/i.test(byColor[1]) && card.typeLine.includes("Creature")) {
                for (const part of byColor[1].split(/,\s*(?:and\s+)?|\s+and\s+(?=[a-z ]+ if it)/i)) {
                  const m = part.trim().match(/^([a-z ]+?) if it'?s (white|blue|black|red|green)$/i);
                  if (m && hasChosenColor(card, m[2])) keywordSet.add(m[1].trim().toLowerCase());
                }
              }
              const modified = line.replace(/\([^)]*\)/g, "").trim().match(/^modified creatures you control have ([a-z ]+?)\.?$/i);
              if (modified && card.typeLine.includes("Creature")) {
                const isModified = (card.counters ?? []).some((counter) => counter.count > 0) || seat.board.battlefield.some((other) => other.attachedToId === card.id);
                if (isModified) for (const keyword of modified[1].split(/ and |, /)) keywordSet.add(keyword.trim().toLowerCase());
              }
              const selfJustEntered = line.match(/^([^.,]+?) has ([a-z ]+?) as long as it entered this turn\.?$/i);
              if (selfJustEntered && grantSource.id === card.id && card.enteredTurn !== undefined && card.enteredTurn === next.turn) {
                for (const keyword of selfJustEntered[2].split(/ and |, /)) keywordSet.add(keyword.trim().toLowerCase());
              }
            }
          }

          // Champion of Lambholt: "Creatures with power less than this creature's power can't block creatures you control." Recorded on
          // each of the controller's creatures as a pseudo-keyword carrying the current threshold (read back by attackerEvadesBlocker).
          if (card.typeLine.includes("Creature")) {
            for (const champion of seat.board.battlefield) {
              if ((champion.abilitiesStripped || champion.phasedOut)) continue;
              if (/creatures with power less than this creature'?s power can'?t block creatures you control/i.test(champion.oracleText)) {
                keywordSet.add(`can't be blocked by power below ${effectivePower(champion)}`);
              }
            }
          }

          // Same shape as the keyword-grant scan just above, but for a granted ACTIVATED mana
          // ability (Insidious Roots' "Creature tokens you control have '{T}: Add one mana of any
          // color.'") — kept in its own field (grantedManaAbilityText) rather than merged into
          // keywordSet, since there's no existing "set of granted abilities" concept to fold a raw
          // ability string into. The first matching grant wins; no real card grants more than one.
          let manaAbilityGrantText: string | undefined;
          for (const grantSource of seat.board.battlefield.filter((source) => !source.phasedOut)) {
            if (manaAbilityGrantText) break;
            for (const grant of parseGroupManaAbilityGrant(grantSource.oracleText)) {
              if (grant.excludeSelf && grantSource.id === card.id) continue;
              if (!permanentMatchesQualifier(card, grant.matcher)) continue;
              if (grant.requiresCounter && (card.counters ?? []).every((counter) => counter.count <= 0)) continue;
              manaAbilityGrantText = grant.abilityText;
              break;
            }
          }

          // Layer 7d (group anthem): "[Other] [Qualifier] you control get +N/+N[ for each ...]."
          // (Boon of the Spirit Realm's blessing-counter anthem, plain flat group pumps, ...) — the
          // group counterpart to parseSelfAnthemBoost above, evaluated the same live-off-board way.
          // Same scope rule as the keyword grants above: without "you control" the boost applies to every
          // player's matching creatures (Lord of the Undead, Bad Moon), so every seat is a possible source.
          for (const sourceSeat of next.seats) {
            for (const anthemSource of [...sourceSeat.board.battlefield.filter((source) => !source.phasedOut), ...emblemSourceCards(sourceSeat)]) {
              for (const anthem of parseGroupAnthemBoost(anthemSource.oracleText)) {
                if (anthem.controlledOnly && sourceSeat.id !== seat.id) continue;
                if (anthem.excludeSelf && anthemSource.id === card.id) continue;
                if (!permanentMatchesQualifier(card, anthem.matcher)) continue;
                if (anthem.requiresChosenType && (!anthemSource.chosenCreatureType || !card.typeLine.includes(anthemSource.chosenCreatureType))) continue;
                // Heraldic Banner: only creatures of the color chosen as it entered.
                if (anthem.requiresChosenColor && (!anthemSource.chosenColor || !hasChosenColor(card, anthemSource.chosenColor))) continue;
                const multiplier = anthem.multiplier
                  ? anthem.multiplier.kind === "counter"
                    ? counterCount(anthemSource, anthem.multiplier.counterKind)
                    : countMatchingPermanents(sourceSeat.board.battlefield, anthem.multiplier.countMatcher)
                  : 1;
                power += anthem.power * multiplier;
                toughness += anthem.toughness * multiplier;
              }
            }
          }

          // "As long as ..." boosts and grants (Angel of Vitality, Righteous Valkyrie, Angelic Field Marshal's lieutenant),
          // checked live against the source controller's life / commander. Only a creature's OWN controller's sources.
          for (const conditionalSource of seat.board.battlefield) {
            if ((conditionalSource.abilitiesStripped || conditionalSource.phasedOut)) continue;
            for (const boost of parseConditionalStaticBoosts(conditionalSource.oracleText)) {
              if (!staticConditionMet(boost.condition, seat, conditionalSource, next.activePlayerId)) continue;
              if (boost.scope === "self" && conditionalSource.id !== card.id) continue;
              power += boost.power;
              toughness += boost.toughness;
              if (boost.keyword) keywordSet.add(boost.keyword);
            }
          }

          // The Incarnation cycle: "As long as this card is in your graveyard and you control a Mountain, creatures you control have haste."
          // (Anger, Brawn, Wonder, ...) — a static grant that works from the graveyard.
          for (const graveCard of seat.board.graveyard ?? []) {
            const graveGrant = graveCard.oracleText.match(/as long as this card is in your graveyard and you control an? ([a-z]+), creatures you control have ([a-z]+)\./i);
            if (!graveGrant || !card.typeLine.includes("Creature")) continue;
            const landType = graveGrant[1].toLowerCase();
            if (seat.board.battlefield.some((land) => land.typeLine.toLowerCase().includes(landType) && land.typeLine.includes("Land"))) keywordSet.add(graveGrant[2].toLowerCase());
          }

          // Layer 7b: "set base power/toughness" effects override the 7a/printed base outright —
          // when more than one applies (rare), the most recently attached one wins.
          const winningSetEffect = setEffectCandidates.sort((a, b) => b.timestamp - a.timestamp)[0];

          const nextPowerBonus = power || undefined;
          const nextToughnessBonus = toughness || undefined;
          const nextKeywords = keywordSet.size > 0 ? Array.from(keywordSet).sort() : undefined;
          const nextProtection = protectionSet.size > 0 ? Array.from(protectionSet).sort() : undefined;
          const nextAbilitiesStripped = losesAllAbilities || undefined;
          if (
            nextPowerBonus === card.attachmentPowerBonus &&
            nextToughnessBonus === card.attachmentToughnessBonus &&
            sameList(nextKeywords, card.grantedKeywords) &&
            sameList(nextProtection, card.grantedProtectionColors) &&
            manaAbilityGrantText === card.grantedManaAbilityText &&
            cdaPower === card.cdaPower &&
            cdaToughness === card.cdaToughness &&
            winningSetEffect?.power === card.setPowerOverride &&
            winningSetEffect?.toughness === card.setToughnessOverride &&
            nextAbilitiesStripped === card.abilitiesStripped
          ) {
            return card;
          }
          changed = true;
          return {
            ...card,
            attachmentPowerBonus: nextPowerBonus,
            attachmentToughnessBonus: nextToughnessBonus,
            grantedKeywords: nextKeywords,
            grantedProtectionColors: nextProtection,
            grantedManaAbilityText: manaAbilityGrantText,
            cdaPower,
            cdaToughness,
            setPowerOverride: winningSetEffect?.power,
            setToughnessOverride: winningSetEffect?.toughness,
            abilitiesStripped: nextAbilitiesStripped
          };
        })
      }
    }))
  };

  // Static "X you control are Y in addition to their other types" effects (Secret Arcade,
  // Biotransference, ...) — recomputed every SBA pass from current board state, same
  // recompute-fresh-every-pass pattern as the attachment/CDA block above, but scoped to ALL
  // permanent types (not creature-only), since a grant can make a non-creature permanent relevant
  // to creature-only downstream checks (e.g. a granted Enchantment type mattering to an "an
  // enchantment enters" trigger elsewhere).
  // "All permanents are X in addition to their other types" (Mycosynth Lattice) has no controller —
  // unlike every other grant this pass handles ("Y you control are X"), it applies to every
  // permanent on the battlefield regardless of whose it is, so its sources are gathered once across
  // ALL seats up front rather than re-derived per seat from that seat's own battlefield alone.
  // Reported live as Mycosynth Lattice's own artifact grant not being counted by Saheeli's affinity
  // discount for lands and other nonartifact permanents it should have applied to.
  const globalGrantSources = next.seats.flatMap((seat) => seat.board.battlefield.filter((card) => !card.phasedOut).flatMap((card) => parseTypeGrantEffects(card.oracleText).filter((grant) => grant.global)));
  // Ygra, Eater of All: "Other creatures are Food artifacts in addition to their other types and have '...'" — every creature on the battlefield other
  // than the source, whoever controls it, gains the types and the granted activated ability. Sources are gathered across all seats.
  const otherCreatureGrantSources = next.seats.flatMap((seat) =>
    seat.board.battlefield.flatMap((card) => {
      if ((card.abilitiesStripped || card.phasedOut)) return [];
      const grant = parseOtherCreaturesGrant(card.oracleText);
      return grant ? [{ sourceId: card.id, grant }] : [];
    })
  );
  // Urborg, Tomb of Yawgmoth / Yavimaya, Cradle of Growth: "Each land is a Swamp/Forest in addition to its other land types." Sources are gathered
  // across all seats; a phased-out or ability-stripped source grants nothing, and since this pass rewrites grantedTypes from scratch every time, the
  // subtype disappears from every land the moment the source leaves, phases out or loses its abilities.
  const landSubtypeGrants = Array.from(
    new Set(next.seats.flatMap((seat) => seat.board.battlefield.filter((card) => !card.phasedOut && !card.abilitiesStripped).flatMap((card) => parseLandSubtypeGrants(card.oracleText))))
  );
  next = {
    ...next,
    seats: next.seats.map((seat) => {
      const grantSources = [...seat.board.battlefield.filter((card) => !card.phasedOut).flatMap((card) => parseTypeGrantEffects(card.oracleText).filter((grant) => !grant.global)), ...globalGrantSources];
      return {
        ...seat,
        board: {
          ...seat.board,
          battlefield: seat.board.battlefield.map((card) => {
            const grantedSet = new Set<string>();
            for (const grant of grantSources) {
              if (typeGrantAppliesTo(grant.granteeFilter, card)) grantedSet.add(grant.grantedType);
            }
            if (landSubtypeGrants.length > 0 && hasCardType(card, "Land")) for (const subtype of landSubtypeGrants) grantedSet.add(subtype);
            let grantedAbilityTexts: string[] = [];
            if (hasCardType(card, "Creature")) {
              for (const source of otherCreatureGrantSources) {
                if (source.sourceId === card.id) continue;
                for (const type of source.grant.addedTypes) grantedSet.add(type);
                if (source.grant.abilityText) grantedAbilityTexts = [...grantedAbilityTexts, source.grant.abilityText];
              }
            }
            const nextGrantedAbilityText = grantedAbilityTexts.length > 0 ? Array.from(new Set(grantedAbilityTexts)).join("\n") : undefined;
            // Starfield of Nyx's conditional "is a creature" grant — same board-state check the
            // creature-characteristics pass above independently uses for its P/T, so combat/removal-
            // targeting (which read grantedTypes via hasCardType, not the CDA fields) see it too.
            if (seatStarfieldAnimatesCard(seat, card)) grantedSet.add("Creature");
            // Man-land animation — same "this pass fully overwrites grantedTypes, so a one-shot
            // direct set would be wiped on the next recompute" reasoning as temporaryGrantedKeywords
            // above, needing its own persisted-until-clearTemporaryBuffs flag instead.
            if (card.temporaryAnimatedAsCreature) grantedSet.add("Creature");
            if (card.permanentlyArtifact) grantedSet.add("Artifact");
            const nextGrantedTypes = grantedSet.size > 0 ? Array.from(grantedSet).sort() : undefined;
            if (sameList(nextGrantedTypes, card.grantedTypes) && nextGrantedAbilityText === card.grantedAbilityText) return card;
            changed = true;
            return { ...card, grantedTypes: nextGrantedTypes, grantedAbilityText: nextGrantedAbilityText };
          })
        }
      };
    })
  };

  // Life <= 0 and 21+ combat damage from a single commander are both game losses.
  const previousLossState = new Map(next.seats.map((seat) => [seat.id, Boolean(seat.hasLost)]));
  // Rule 800.4a: a player who loses leaves the game, and every object they own leaves with them. Found by
  // 4-player self-play: an eliminated player's creatures stayed on the battlefield, still targetable —
  // an opponent's Swords to Plowshares exiled one and handed the already-dead player 6 life. Applied to
  // ANY seat that has lost (including "drew from an empty library", which sets hasLost elsewhere), and
  // idempotent. Cards go to exile rather than vanishing so every card stays accounted for; tokens
  // simply cease to exist.
  const eliminatedPermanentsLeave = (seat: PlayerSeat): PlayerSeat => {
    if (seat.board.battlefield.length === 0) return seat;
    const leaving = seat.board.battlefield.filter((card) => !card.token);
    return {
      ...seat,
      board: {
        ...seat.board,
        battlefield: [],
        exile: [...(seat.board.exile ?? []), ...leaving.map((card) => ({ ...card, zone: "exile" as const, tapped: false, attacking: false, blocking: false }))]
      },
      zones: { ...seat.zones, battlefield: 0, exile: seat.zones.exile + leaving.length }
    };
  };
  const seatsAfterLossChecks = next.seats.map((seat) => {
    if (seat.hasLost) return eliminatedPermanentsLeave(seat);
    // Herald of Eternal Dawn: "You can't lose the game" — life, poison and commander damage don't eliminate this player.
    if (playerCantLose(seat)) return seat;
    if (seat.life <= 0) return eliminatedPermanentsLeave({ ...seat, hasLost: true, lossReason: "life total reached 0" });
    if (Object.values(seat.commanderDamage).some((amount) => amount >= 21)) {
      return eliminatedPermanentsLeave({ ...seat, hasLost: true, lossReason: "took 21 or more combat damage from a single commander" });
    }
    if ((seat.poison ?? 0) >= 10) return eliminatedPermanentsLeave({ ...seat, hasLost: true, lossReason: "has 10 or more poison counters" });
    return seat;
  });
  if (seatsAfterLossChecks.some((seat, index) => seat !== next.seats[index])) changed = true;
  const lossEvents: GameEvent[] = seatsAfterLossChecks
    .filter((seat) => seat.hasLost && !previousLossState.get(seat.id))
    .map((seat) => ({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      seatId: seat.id,
      message: `${seat.name} loses the game (${seat.lossReason}).`,
      detail: "State-based action"
    }));
  if (lossEvents.length > 0) changed = true;
  next = { ...next, seats: seatsAfterLossChecks, events: [...lossEvents, ...next.events] };

  // Free-for-all: the game ends once at most one player remains standing. A game that started with a single seat (solo / goldfishing) has no one to
  // beat, so one survivor is not a win there: it only ends when that lone player loses (nobody remains, no winner).
  if (next.status === "playing") {
    const remaining = next.seats.filter((seat) => !seat.hasLost);
    if (remaining.length === 0 || (remaining.length === 1 && next.seats.length > 1)) {
      changed = true;
      next = {
        ...next,
        status: "complete",
        winnerSeatId: remaining[0]?.id,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: remaining[0]?.id,
            message: remaining[0] ? `${remaining[0].name} wins the game!` : "The game ends with no winner.",
            detail: "State-based action"
          },
          ...next.events
        ]
      };
    }
  }

  return { session: next, changed };
}
