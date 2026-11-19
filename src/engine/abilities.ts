// Activated-ability resolution: generic sacrifice/tap/mana cost payment, applySacrificeEffect, applyGenericAbilityEffect,
// applyGenericTapEffect, equip, manland animation, loyalty-ability parsing, graveyard-return abilities and cycling.
// Extracted verbatim from components/AppFlow.tsx; AppFlow.tsx re-exports the previously public symbols.

import { isNonAuraEnchantment } from "@/engine/casting";
import { manaValueFromManaCost } from "@/engine/costs";
import { applyMill, applyPrimitiveAction, applyZoneEffect, chooseCounterTarget, choosePumpTarget, chooseSacrificeTargets, chooseWorstHandCardToDiscard, discardableHandCards, drawForSeat, drawMultipleForSeat, genericCostShim, genericManaAbilityCostShim, noLegalTargetEvent, parseTargetedPump, removalEffectHasLegalTarget, resolveAgentLibraryLookWorkflow, resolveDeferredChoice, strongestControlledCreature, transformPermanent, zoneEffectHasLegalTarget, type PumpEffect } from "@/engine/effects";
import { hasIndestructible } from "@/engine/damage";
import { destroyCreatures, moveCardAcrossSeats, moveLibraryCardToDestination } from "@/engine/entry";
import { nextTimestamp } from "@/engine/etb";
import { activateOnlyIfConditionMet, chooseManaSourcesForCost, isBoardConditionMet, payCostFromPool, spendManaSources } from "@/engine/mana";
import { applyDigPick, commanderColorCount, hideawayDamageConditionMet, surveilBonusForSeat } from "@/engine/oneShotEffects";
import { basicLandTypes, hasHaste, hasKeyword, isLandCard, numberWordToInt } from "@/engine/shared";
import { createCopyTokenForSeat, createTokensForSeat, parseCreateTokenSpecs } from "@/engine/tokens";
import { applyDigToBattlefield, applyTargetedEffect, commonTriggerEffect, findPermanentOwnerTarget, hasOnceEachTurnLimiter, resolveTriggerEffect } from "@/engine/triggers";
import { type PendingAction, type TriggerEffect } from "@/engine/types";
import { applyCounterDelta, findPermanentById, moveCardBetweenVisibleZones, queuePlayerChoice, rulesEvent, shuffleCards } from "@/engine/zones";
import { parseGenericManaAbilities, parseGenericSacrificeAbilities, parseGenericTapAbilities, parseManlandAnimation, parseSearchLibraryEffectText, parseSelfUntapAbilities, type GenericManaAbility, type GenericTapAbility, type GenericTapEffect, type SacrificeAbility, type SearchLibraryEffect } from "@/lib/activatedAbilities";
import { parseTapCreaturesAltCost } from "@/lib/altCosts";
import { equipCost, isAura } from "@/lib/attachments";
import { permanentMatchesQualifier } from "@/lib/characteristics";
import { counterCount, effectivePower, effectiveToughness } from "@/lib/counters";
import { parseCycling } from "@/lib/cycling";
import { etbEffectText } from "@/lib/oracleClauses";
import { parseRemovalEffect, type RemovalEffect } from "@/lib/removalSpells";
import { zoneEffectTargetSpec } from "@/lib/targetSpecs";
import { parseTargetedEffect } from "@/lib/targetedEffects";
import { legalTargets, type TargetSpec } from "@/lib/targeting";
import { phaseOutPermanent } from "@/engine/phasing";
import { abilityOracleText, hasCardType } from "@/lib/typeGrants";
import { type GameSession, type ManaPool, type PlayerSeat, type VisibleCard } from "@/lib/types";
import { parseZoneEffect, type ZoneEffect } from "@/lib/zoneEffects";

// "This creature can't block." (Gravecrawler, Carrion Feeder) / "Razorlash Transmogrant can't block." — the
// creature's OWN restriction, named by "this creature", its full name or its short name. A group
// restriction ("Creatures you control can't block ...") is a different shape and isn't matched here.
// What Zur, Eternal Schemer may point at: a non-Aura enchantment its controller has.
export function animateEnchantmentSpec(seat: PlayerSeat, sourceName: string): TargetSpec {
  return {
    id: "target",
    zone: "battlefield",
    permanentType: "enchantment",
    controller: "you",
    min: 1,
    max: 1,
    excludedCardIds: seat.board.battlefield.filter((card) => isAura(card)).map((card) => card.id),
    prompt: `${sourceName}: choose a non-Aura enchantment you control to become a creature.`
  };
}

export function parseLoyaltyAbilities(oracleText: string): Array<{ cost: number; text: string }> {
  return oracleText
    .split("\n")
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^([+−-]?\d+):\s*(.+)$/);
      if (!match) return undefined;
      return { cost: Number.parseInt(match[1].replace("−", "-"), 10), text: match[2] };
    })
    .filter((ability): ability is { cost: number; text: string } => Boolean(ability && Number.isFinite(ability.cost) && ability.text));
}

// No interactive targeting for equip either; prefers the creature the equipment would most
// improve (highest resulting combined power+toughness).
//
// Deliberately does NOT exclude the current holder from the ranking (an earlier version did, to
// avoid "re-equipping the same creature" as a no-op action) — that exclusion is what caused a real,
// reproduced infinite loop: with the holder excluded, ranking the REMAINING creatures always finds
// some *other* "best" one to move to, and once moved, the creature that just lost the equipment is
// no longer excluded and becomes the new best target again, forever alternating between the top two
// creatures on the board with neither side ever a real improvement (reported live as an agent stuck
// re-equipping Lightning Greaves back and forth between Meren of Clan Nel Toth and Acidic Slime
// hundreds of times without the turn ever advancing). Ranking ALL creatures (holder included) and
// only recommending a move when some other creature is a genuine, strict improvement over the
// current holder fixes this at the source: once equipment is on the actual best creature, this
// returns undefined and "equip" stops being offered as a legal action at all, rather than an
// artificial exclusion manufacturing a new "best" target every single time.
export function chooseEquipTarget(seat: PlayerSeat, equipment: VisibleCard): VisibleCard | undefined {
  const creatures = seat.board.battlefield.filter((card) => card.typeLine.includes("Creature"));
  if (creatures.length === 0) return undefined;
  const best = creatures.reduce((a, b) => (effectivePower(b) + effectiveToughness(b) > effectivePower(a) + effectiveToughness(a) ? b : a));
  return best.id === equipment.attachedToId ? undefined : best;
}

// humanPool: see payGenericSacrificeCost's own doc comment — same pool-first-then-auto-tap
// preference. Returns undefined (rather than the unchanged session) when nothing could be done, so
// the caller can tell "equip failed" apart from "equip succeeded, nothing to sync" the same way
// payGenericSacrificeCost's undefined-vs-object return already does.
export function resolveEquip(
  session: GameSession,
  seatId: string,
  cardId: string,
  humanPool?: ManaPool,
  // A human's already-chosen creature (see choose_equip_target) — when provided, used instead of
  // chooseEquipTarget's auto-pick heuristic. Undefined for the agent path, which keeps the exact
  // heuristic behavior it had before. Unlike chooseEquipTarget, a pre-chosen target has no
  // same-creature exclusion — a real click-to-choose re-equip to the same creature is still legal.
  preChosenTargetId?: string
): { session: GameSession; poolSpent?: ManaPool } | undefined {
  const seat = session.seats.find((item) => item.id === seatId);
  const card = seat?.board.battlefield.find((item) => item.id === cardId);
  if (!seat || !card) return undefined;
  const cost = equipCost(card.oracleText);
  if (cost === undefined) return undefined;
  const target = preChosenTargetId
    ? seat.board.battlefield.find((item) => item.id === preChosenTargetId && item.typeLine.includes("Creature"))
    : chooseEquipTarget(seat, card);
  if (!target) return undefined;
  const costCard = genericCostShim(cost);
  const poolPayment = cost > 0 && humanPool ? payCostFromPool(humanPool, costCard, cost) : undefined;
  const payment = cost > 0 ? (poolPayment?.ok ? poolPayment : chooseManaSourcesForCost(seat, costCard, cost, undefined, session.seats)) : undefined;
  if (cost > 0 && !payment?.ok) return undefined;

  let next = session;
  if (payment?.ok && !poolPayment?.ok) {
    next = { ...next, seats: next.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item)) };
  }
  const { timestamp, session: stampedNext } = nextTimestamp(next);
  next = stampedNext;

  return {
    session: {
    ...next,
    seats: next.seats.map((item) =>
      item.id === seatId
        ? {
            ...item,
            board: {
              ...item.board,
              battlefield: item.board.battlefield.map((permanent) => (permanent.id === cardId ? { ...permanent, attachedToId: target.id, attachTimestamp: timestamp } : permanent))
            }
          }
        : item
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${seat.name} equips ${card.name} to ${target.name}.`,
        detail: "Rules action"
      },
      ...next.events
    ]
    },
    poolSpent: poolPayment?.ok ? poolPayment.pool : undefined
  };
}

// humanPool: same pool-first-then-auto-tap preference as resolveEquip/payGenericSacrificeCost.
export function resolveManlandAnimation(session: GameSession, seatId: string, cardId: string, humanPool?: ManaPool): { session: GameSession; poolSpent?: ManaPool } | undefined {
  const seat = session.seats.find((item) => item.id === seatId);
  const card = seat?.board.battlefield.find((item) => item.id === cardId);
  if (!seat || !card) return undefined;
  const animation = parseManlandAnimation(card.oracleText);
  if (!animation) return undefined;
  const costCard = genericCostShim(animation.cost);
  const poolPayment = animation.cost > 0 && humanPool ? payCostFromPool(humanPool, costCard, animation.cost) : undefined;
  const payment = animation.cost > 0 ? (poolPayment?.ok ? poolPayment : chooseManaSourcesForCost(seat, costCard, animation.cost, undefined, session.seats)) : undefined;
  if (animation.cost > 0 && !payment?.ok) return undefined;

  let next = session;
  if (payment?.ok && !poolPayment?.ok) {
    next = { ...next, seats: next.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item)) };
  }

  return {
    session: {
      ...next,
      seats: next.seats.map((item) =>
        item.id === seatId
          ? {
              ...item,
              board: {
                ...item.board,
                battlefield: item.board.battlefield.map((permanent) =>
                  permanent.id === cardId
                    ? {
                        ...permanent,
                        temporaryAnimatedAsCreature: true,
                        temporaryBasePower: animation.power,
                        temporaryBaseToughness: animation.toughness,
                        temporaryGrantedKeywords: animation.keywords
                      }
                    : permanent
                )
              }
            }
          : item
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} activates ${card.name}: it becomes a ${animation.power}/${animation.toughness} creature until end of turn.`,
          detail: "Rules action"
        },
        ...next.events
      ]
    },
    poolSpent: poolPayment?.ok ? poolPayment.pool : undefined
  };
}


// Same "no choice UI, pick deterministically" pattern as chooseSacrificeTarget, for a generic tap
// ability's "target X you control" (a counter/upgrade or a bounce-to-hand) — every such target this
// engine's generic tap parser recognizes is always "you control", so this only ever searches the
// activating seat's own battlefield. Prefers the lowest combined power+toughness match, same
// reasoning as chooseSacrificeTarget: spend the least valuable eligible permanent when there's a
// choice, rather than guessing at which one the controller would actually want.
export function chooseGenericTapTarget(seat: PlayerSeat, typeFilter: string | undefined): VisibleCard | undefined {
  const candidates = seat.board.battlefield.filter(
    (card) => card.typeLine.includes("Creature") && (!typeFilter || card.typeLine.toLowerCase().includes(typeFilter.toLowerCase()))
  );
  if (candidates.length === 0) return undefined;
  return candidates.reduce((worst, card) =>
    effectivePower(card) + effectiveToughness(card) < effectivePower(worst) + effectiveToughness(worst) ? card : worst
  );
}

// Annihilator lets the defending player choose which permanents to sacrifice; with no choice UI
// for this yet, deterministically picks the least costly ones to lose (tokens first, then lowest
// mana value), avoiding the commander unless nothing else is left.
export function chooseAnnihilatorSacrifices(seat: PlayerSeat, count: number): VisibleCard[] {
  const nonCommanders = seat.board.battlefield.filter((card) => !card.commander);
  const pool = nonCommanders.length > 0 ? nonCommanders : seat.board.battlefield;
  const sorted = [...pool].sort((a, b) => {
    if (Boolean(a.token) !== Boolean(b.token)) return a.token ? -1 : 1;
    return a.manaValue - b.manaValue;
  });
  return sorted.slice(0, count);
}

// Same "prefer a token, then cheapest" bias as choosePlaguecrafterSacrifice above, for a punisher
// effect's "sacrifices a nonland permanent" outcome (Torment of Hailfire, ...) instead of a typed
// filter — "nonland" isn't one of matchesEachPlayerSacrificeFilter's word tokens, so this needs its
// own pool instead of reusing that function with an invented filter string.
export function chooseNonlandPermanentToSacrifice(seat: PlayerSeat): VisibleCard | undefined {
  const candidates = seat.board.battlefield.filter((card) => !card.typeLine.includes("Land"));
  if (candidates.length === 0) return undefined;
  const nonCommanders = candidates.filter((card) => !card.commander);
  const pool = nonCommanders.length > 0 ? nonCommanders : candidates;
  return pool.reduce((best, card) => {
    if (Boolean(card.token) !== Boolean(best.token)) return card.token ? card : best;
    return card.manaValue < best.manaValue ? card : best;
  });
}

// Karoo/bounce lands' mandatory "return a land you control" — bouncing the karoo land itself (a
// legal but pointless choice, always available since it's already on the battlefield by the time
// this fires) defeats the entire point of the card, so this prefers any OTHER land, and among those
// a basic land specifically: cheapest to just replay next turn, versus giving up a nonbasic utility
// land's other abilities for a turn. Falls back to the karoo land itself only when it's the
// controller's sole land (an edge case, not the common path).
export function chooseLandToReturn(seat: PlayerSeat, excludeId: string): VisibleCard | undefined {
  const lands = seat.board.battlefield.filter((card) => card.typeLine.includes("Land"));
  const others = lands.filter((card) => card.id !== excludeId);
  return others.find((card) => basicLandTypes(card).length > 0) ?? others[0] ?? lands.find((card) => card.id === excludeId);
}

// Prefers a permanent with its own "when/whenever this enters" ability, since that's the whole
// point of blinking something (Aminatou, the Fateshifter's -1, ...) — falls back to any other
// permanent when nothing on the board has one, and only ever falls back to the source itself
// defensively (finishTriggerResolution already only offers this choice when a real other-permanent
// target exists).
export function choosePermanentToBlink(seat: PlayerSeat, excludeId: string): VisibleCard | undefined {
  const others = seat.board.battlefield.filter((card) => card.id !== excludeId);
  const withEtb = others.find((card) => etbEffectText(card.oracleText).trim().length > 0);
  return withEtb ?? others[0] ?? seat.board.battlefield.find((card) => card.id === excludeId);
}

// Pays a generic sacrifice ability's cost (mana + discard + sacrifice) without resolving its
// effect — kept separate from applySacrificeEffect so activateGenericSacrificeAbility (the
// component closure both the human's click and the agent dispatch loop funnel through) can pay
// the cost first, sync the floating-pool React state if it was used, and only then either open the
// interactive library-search choice (search_library effects) or resolve everything else via
// applySacrificeEffect — pendingRuleChoice/setSeatManaPool are component state applySacrificeEffect,
// a pure module-level function, has no access to.
// humanPool: the human caller's floating mana pool (undefined for an agent seat, which never has
// one) — preferred over auto-tapping untapped lands when it already covers the cost, so choosing
// which specific lands to tap for this actually works, the same as casting a spell from hand
// The human seat's PlayerSeat.name is literally "You" (see sessionStore.ts's emptySeat) so it
// reads naturally in the UI's own per-seat panels ("Your battlefield," ...), but most event
// messages in this file interpolate seat.name into a THIRD-person template ("Veyra draws for
// turn.") — for the human seat that collides into ungrammatical text ("You untaps their
// permanents.", "You discards a card to activate X."). Module-level (not nested in the component)
// so both component closures and standalone functions like this one's neighbors can use it.
// Applied to the phase/combat banners that fire every turn and the cost-payment messages a human
// actually triggers by clicking an activate-ability button; the long tail of rarer one-off event
// messages elsewhere in this file has the same underlying issue and would need the same treatment
// if it's ever worth a full sweep.
export function seatVerb(seat: { name: string }, thirdPerson: string, secondPerson: string): string {
  return seat.name === "You" ? secondPerson : thirdPerson;
}

// already does. Falls back to auto-tap when the pool doesn't cover it (or there isn't one), so a
// human who hasn't pre-tapped still isn't stuck. poolSpent on the return value tells the caller
// (a component closure, which alone can update the live manaPools React state) to sync it.
export function payGenericSacrificeCost(
  session: GameSession,
  seatId: string,
  cardId: string,
  abilityIndex: number,
  humanPool?: ManaPool,
  // A human's already-chosen creature(s) for a "sacrifice a creature" cost (see
  // choose_creature_to_sacrifice) — when provided, used instead of chooseSacrificeTargets' heuristic.
  // Undefined for every other caller (search_library's own cost payment, the agent path, "sacrifice
  // this creature" self-sacrifices), which all keep the exact heuristic behavior they had before.
  preChosenSacrificeTargets?: VisibleCard[]
): { session: GameSession; ability: SacrificeAbility; card: VisibleCard; sacrificed: VisibleCard[]; poolSpent?: ManaPool; xValue?: number } | undefined {
  const seat = session.seats.find((item) => item.id === seatId);
  const card = seat?.board.battlefield.find((item) => item.id === cardId);
  if (!seat || !card) return undefined;
  const ability = parseGenericSacrificeAbilities(abilityOracleText(card))[abilityIndex];
  if (!ability || (ability.costTap && card.tapped)) return undefined;
  if (ability.costTap && card.typeLine.includes("Creature") && card.summoningSick && !hasHaste(card)) return undefined;
  if (!activateOnlyIfConditionMet(ability.clause, seat)) return undefined;
  // An {X} in the cost (Fiend Artisan): the engine picks X, and the cost below is paid with it.
  const xValue = ability.costX ? chooseAbilityX(session, seat, card, ability) : 0;
  if (xValue === undefined) return undefined;
  const payAbility = ability.costX ? abilityCostWithX(ability, xValue) : ability;

  const discardCard = ability.costDiscard ? chooseWorstHandCardToDiscard(seat) : undefined;
  if (ability.costDiscard && !discardCard) return undefined;
  // Rule 119.4: a life payment can only be made if the player's life total is at least that much
  // (Arid Mesa and the rest of the fetch-land cycle's "Pay 1 life" cost, ...) — without this gate a
  // seat at 0 life could still activate a life-cost ability.
  if (ability.costLife > 0 && seat.life < ability.costLife) return undefined;

  const totalManaCost = manaValueFromManaCost(payAbility.costManaText);
  const costCard = genericManaAbilityCostShim(payAbility);
  const poolPayment = totalManaCost > 0 && humanPool ? payCostFromPool(humanPool, costCard, totalManaCost) : undefined;
  // excludeCardId: cardId — this ability's own {T} already requires the source untapped; it can't
  // also tap itself via a separate mana ability of its own to help pay this same activation's
  // generic cost (a permanent can only supply one tap). See the sibling exclusion in
  // legalActivatedAbilityActions' own affordability check above.
  const payment =
    totalManaCost > 0
      ? poolPayment?.ok
        ? poolPayment
        : chooseManaSourcesForCost(seat, costCard, totalManaCost, cardId, session.seats)
      : undefined;
  if (totalManaCost > 0 && !payment?.ok) return undefined;

  const sacrificeTargets =
    ability.sacrificeTarget === "self"
      ? [card]
      : (preChosenSacrificeTargets ?? chooseSacrificeTargets(seat, ability.sacrificeTargetTypeFilter, ability.sacrificeCount, ability.sacrificeExcludesSelf || ability.sacrificeTarget === "permanent" ? card.id : undefined, ability.sacrificeTarget === "permanent"));
  if (!sacrificeTargets || sacrificeTargets.length === 0) return undefined;

  let next = session;
  if (payment?.ok && !poolPayment?.ok) {
    next = {
      ...next,
      seats: next.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item))
    };
  }

  if (ability.costLife > 0) {
    next = {
      ...next,
      seats: next.seats.map((item) => (item.id === seatId ? { ...item, life: item.life - ability.costLife } : item))
    };
  }

  if (discardCard) {
    next = {
      ...next,
      seats: next.seats.map((item) =>
        item.id === seatId
          ? {
              ...item,
              board: {
                ...item.board,
                hand: item.board.hand.filter((handCard) => handCard.id !== discardCard.id),
                graveyard: [...(item.board.graveyard ?? []), { ...discardCard, zone: "graveyard" as const, counters: undefined, interpretedEffects: undefined }]
              }
            }
          : item
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: seatVerb(seat, `${seat.name} discards ${discardCard.name} to activate ${card.name}.`, `You discard ${discardCard.name} to activate ${card.name}.`),
          detail: "Rules action"
        },
        ...next.events
      ]
    };
  }

  // Paying the {T} in the cost taps the source — same as payGenericTapCost's sibling step. Mapping
  // over battlefield to tap cardId is a harmless no-op when sacrificeTarget === "self" (the source
  // is about to be removed by the destroyCreatures call right below anyway).
  if (ability.costTap) {
    next = {
      ...next,
      seats: next.seats.map((item) =>
        item.id === seatId ? { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((c) => (c.id === cardId ? { ...c, tapped: true } : c)) } } : item
      )
    };
  }

  if (ability.exileSelf) {
    next = rulesEvent(moveCardBetweenVisibleZones(next, seatId, card.id, "exile"), seatId, `${seat.name} exiles ${card.name} to activate it.`);
    return { session: next, ability, card, sacrificed: sacrificeTargets, poolSpent: poolPayment?.ok ? poolPayment.pool : undefined, xValue };
  }
  next = destroyCreatures(
    next,
    sacrificeTargets.map((target) => ({
      seatId,
      cardId: target.id,
      message:
        sacrificeTargets.length === 1
          ? seatVerb(seat, `${seat.name} sacrifices ${target.name} to activate ${card.name}.`, `You sacrifice ${target.name} to activate ${card.name}.`)
          : seatVerb(
              seat,
              `${seat.name} sacrifices ${target.name} (part of ${sacrificeTargets.length} creatures) to activate ${card.name}.`,
              `You sacrifice ${target.name} (part of ${sacrificeTargets.length} creatures) to activate ${card.name}.`
            )
    })),
    "Rules action"
  );

  return { session: next, ability, card, sacrificed: sacrificeTargets, poolSpent: poolPayment?.ok ? poolPayment.pool : undefined, xValue };
}

export function applySacrificeEffect(
  session: GameSession,
  seatId: string,
  sourceCard: VisibleCard,
  effect: SacrificeAbility["effect"],
  clause: string,
  // The creature(s) sacrificed to pay for this activation — Ghoulcaller Gisa's X is "the sacrificed
  // creature's power".
  sacrificed: VisibleCard[] = []
): GameSession {
  const sourceCardId = sourceCard.id;
  const sourceCardName = sourceCard.name;
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;

  // search_library never actually reaches this function: activateGenericSacrificeAbility detects
  // it before ever calling applySacrificeEffect and opens the interactive library-search choice
  // instead (pendingRuleChoice is component state applySacrificeEffect can't reach). This branch
  // only exists to keep the switch exhaustive for the type checker.
  if (effect.kind === "search_library") return session;

  // Command Beacon: the commander leaves the command zone for the hand (its tax is untouched).
  if (effect.kind === "commander_to_hand") {
    const commander = seat.board.commander;
    if (!commander) return rulesEvent(session, seatId, `${seat.name} has no commander in the command zone for ${sourceCardName}.`);
    return rulesEvent(
      {
        ...session,
        seats: session.seats.map((item) =>
          item.id !== seatId ? item : { ...item, board: { ...item.board, commander: undefined, hand: [...item.board.hand, { ...commander, zone: "hand" as const }] }, zones: { ...item.zones, command: Math.max(0, item.zones.command - 1), hand: item.zones.hand + 1 } }
        )
      },
      seatId,
      `${seat.name} puts ${commander.name} into their hand from the command zone with ${sourceCardName}.`
    );
  }

  if (effect.kind === "create_tokens") {
    const specs = parseCreateTokenSpecs(clause);
    if (specs.length === 0) return session;
    const created = createTokensForSeat(session, seatId, sourceCardId, specs);
    const createdNames = created.createdTokens.map((token) => token.name);
    return {
      ...created.session,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} activates ${sourceCardName} and creates ${createdNames.join(", ")}.`,
          detail: "Rules action"
        },
        ...created.session.events
      ]
    };
  }

  if (effect.kind === "zone_effect") return applyZoneEffect(session, seatId, sourceCardName, effect.effect);

  // Ghoulcaller Gisa: X Zombies, X = the sacrificed creature's power.
  if (effect.kind === "create_tokens_by_sacrificed_power") {
    const count = Math.max(0, ...sacrificed.map((creature) => effectivePower(creature)));
    const specs = parseCreateTokenSpecs(clause.replace(/\bcreate x\b/i, "create two"));
    if (specs.length === 0 || count <= 0) {
      return rulesEvent(session, seatId, `${sourceCardName} resolves, but the sacrificed creature had no power to make tokens from.`);
    }
    const created = createTokensForSeat(session, seatId, sourceCardId, specs.map((spec) => ({ ...spec, count })));
    return rulesEvent(created.session, seatId, `${seat.name} activates ${sourceCardName} and creates ${count} ${created.createdTokens[0]?.name ?? "token"}${count === 1 ? "" : "s"}.`);
  }

  // Disciple of Griselbrand: gain life equal to the sacrificed creature's toughness (last-known information, so read off the sacrificed card).
  if (effect.kind === "gain_life_by_sacrificed_toughness") {
    const amount = Math.max(0, ...sacrificed.map((creature) => effectiveToughness(creature)));
    if (amount <= 0) return rulesEvent(session, seatId, `${sourceCardName} resolves, but the sacrificed creature had no toughness.`);
    return rulesEvent({ ...session, seats: session.seats.map((item) => (item.id === seatId ? { ...item, life: item.life + amount } : item)) }, seatId, `${seat.name} gains ${amount} life from ${sourceCardName}.`);
  }

  if (effect.kind === "pump_self_by_sacrificed_mv") {
    const bonus = sacrificed.reduce((total, permanent) => total + permanent.manaValue, 0);
    return rulesEvent(
      {
        ...session,
        seats: session.seats.map((item) =>
          item.id !== seatId
            ? item
            : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === sourceCardId ? { ...card, temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + bonus } : card)) } }
        )
      },
      seatId,
      `${sourceCardName} gets +${bonus}/+0 until end of turn.`
    );
  }
  // Dina, Essence Brewer: gain X life and put X +1/+1 counters on a creature you control (an agent picks its strongest; a human is asked).
  if (effect.kind === "gain_life_counters_by_sacrificed_power") {
    const amount = Math.max(0, ...sacrificed.map((creature) => effectivePower(creature)));
    if (amount <= 0) return rulesEvent(session, seatId, `${sourceCardName} resolves, but the sacrificed creature had no power.`);
    const gained = rulesEvent({ ...session, seats: session.seats.map((item) => (item.id === seatId ? { ...item, life: item.life + amount } : item)) }, seatId, `${seat.name} gains ${amount} life from ${sourceCardName}.`);
    const targets = seat.board.battlefield.filter((card) => card.typeLine.includes("Creature") && !sacrificed.some((gone) => gone.id === card.id));
    if (targets.length === 0) return gained;
    if (seat.kind === "human" && targets.length >= 1) {
      return queuePlayerChoice(gained, {
        seatId, sourceCardId, sourceCardName,
        prompt: `${sourceCardName}: put ${amount} +1/+1 counter${amount === 1 ? "" : "s"} on which creature you control?`,
        options: targets.map((card) => ({ label: `${card.name} (${effectivePower(card)}/${effectiveToughness(card)})`, value: card.id })),
        resolver: "counters_on_creature", data: { amount }
      });
    }
    const best = [...targets].sort((a, b) => effectivePower(b) - effectivePower(a))[0];
    return resolveDeferredChoice(gained, seatId, sourceCardId, sourceCardName, "counters_on_creature", { amount }, best.id);
  }
  if (effect.kind === "drain_by_sacrificed_power" || effect.kind === "mill_by_sacrificed_power") {
    const amount = Math.max(0, ...sacrificed.map((creature) => effectivePower(creature)));
    if (amount <= 0) return rulesEvent(session, seatId, `${sourceCardName} resolves, but the sacrificed creature had no power.`);
    if (effect.kind === "mill_by_sacrificed_power") {
      // "Target player": the opponent with the most cards left to lose.
      const victim = session.seats.filter((other) => other.id !== seatId && !other.hasLost).sort((a, b) => (b.library?.length ?? 0) - (a.library?.length ?? 0))[0];
      return victim ? applyMill(session, victim.id, sourceCardName, amount) : session;
    }
    const victims = session.seats.filter((other) => other.id !== seatId && !other.hasLost);
    const drained: GameSession = { ...session, seats: session.seats.map((other) => (victims.some((victim) => victim.id === other.id) ? { ...other, life: other.life - amount } : other)) };
    return rulesEvent(drained, seatId, `${sourceCardName}: each opponent loses ${amount} life.`);
  }
  if (effect.kind === "search_creature_by_sacrificed_mv" || effect.kind === "search_creature_by_x") return session;

  if (effect.kind === "draw_cards") {
    const drawnOnly = drawMultipleForSeat(session, seatId, effect.amount, `${seat.name} draws ${effect.amount} from ${sourceCardName}.`);
    // Izoni, Thousand-Eyed: "You gain 1 life and draw a card."
    const drawn = effect.alsoGainLife
      ? rulesEvent({ ...drawnOnly, seats: drawnOnly.seats.map((item) => (item.id === seatId ? { ...item, life: item.life + effect.alsoGainLife! } : item)) }, seatId, `${seat.name} gains ${effect.alsoGainLife} life from ${sourceCardName}.`)
      : drawnOnly;
    if (!effect.alsoLoseLife) return drawn;
    return rulesEvent(
      { ...drawn, seats: drawn.seats.map((item) => (item.id === seatId ? { ...item, life: item.life - effect.alsoLoseLife! } : item)) },
      seatId,
      `${seat.name} loses ${effect.alsoLoseLife} life from ${sourceCardName}.`
    );
  }

  if (effect.kind === "gain_life" || effect.kind === "lose_life") {
    const delta = effect.kind === "gain_life" ? effect.amount : -effect.amount;
    return {
      ...session,
      seats: session.seats.map((item) => (item.id === seatId ? { ...item, life: Math.max(0, item.life + delta) } : item)),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} ${delta > 0 ? "gains" : "loses"} ${Math.abs(delta)} life from ${sourceCardName}.`
        },
        ...session.events
      ]
    };
  }

  if (effect.kind === "add_counter") {
    return {
      ...session,
      seats: session.seats.map((item) =>
        item.id === seatId
          ? {
              ...item,
              board: {
                ...item.board,
                battlefield: item.board.battlefield.map((card) => (card.id === sourceCardId ? applyCounterDelta(card, effect.counterKind, effect.amount) : card))
              }
            }
          : item
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} puts a ${effect.counterKind} counter on ${sourceCardName}.`
        },
        ...session.events
      ]
    };
  }

  if (effect.kind === "transform_self") {
    return transformPermanent(session, seatId, sourceCardId, sourceCardName, /\bthen untap it\b/i.test(clause));
  }

  if (effect.kind === "dig_type_to_hand") return applyDigPick(session, seatId, sourceCardName, effect.count, effect.typeWord);

  if (effect.kind === "exile_all_graveyards") {
    const exiled = session.seats.reduce((next, other) => (other.board.graveyard ?? []).reduce((acc, card) => moveCardAcrossSeats(acc, other.id, card.id, other.id, "exile").session, next), session);
    return rulesEvent(exiled, seatId, `${seat.name} sacrifices ${sourceCardName}: all graveyards are exiled.`);
  }

  if (effect.kind === "prevent_combat_damage") {
    return {
      ...session,
      combatDamagePrevented: { turn: session.turn },
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} sacrifices ${sourceCardName}; all combat damage is prevented this turn.`,
          detail: "Rules action"
        },
        ...session.events
      ]
    };
  }

  if (effect.kind === "removal") {
    // sourceCard has already left the battlefield by the time this runs (payGenericSacrificeCost
    // sacrifices it before the effect resolves) — passed through anyway since applyRemovalEffect
    // only reads it for excluded-self/self-name checks, same as a normal spell's own source card
    // is still readable off the stack after it's already been sacrificed as an additional cost.
    return applyPrimitiveAction(session, seatId, sourceCard, { kind: "removal", effect: effect.effect });
  }

  // Scry/surveil auto-resolve deterministically for both agents and humans (no dedicated
  // interactive prompt wired up for this entry point yet, matching the auto-resolved mana/search
  // choices used elsewhere in this engine).
  if (effect.kind === "targeted_effect") return applyTargetedEffect(session, seatId, sourceCard, effect.effect);
  // Selfless Spirit / Spectacular Spider-Man: the controller's creatures gain the keywords until end of turn (read off temporaryGrantedKeywords).
  if (effect.kind === "grant_keywords_to_your_creatures") {
    const granted = session.seats.map((item) =>
      item.id !== seatId
        ? item
        : {
            ...item,
            board: {
              ...item.board,
              battlefield: item.board.battlefield.map((permanent) =>
                hasCardType(permanent, "Creature") ? { ...permanent, temporaryGrantedKeywords: [...(permanent.temporaryGrantedKeywords ?? []), ...effect.keywords] } : permanent
              )
            }
          }
    );
    return rulesEvent({ ...session, seats: granted }, seatId, `${seat.name} activates ${sourceCardName}: their creatures gain ${effect.keywords.join(" and ")} until end of turn.`);
  }
  // Fixed mana from a sacrifice (Ashnod's Altar) goes into the human's pool in finishPaidSacrificeAbility, which has the pool state.
  if (effect.kind === "add_mana") return session;
  const surveilAdjustedAmount = effect.kind === "surveil" ? effect.amount + surveilBonusForSeat(seat) : effect.amount;
  return resolveAgentLibraryLookWorkflow(session, seatId, sourceCardName, effect.kind === "surveil" ? "surveil_cards" : "scry_cards", surveilAdjustedAmount);
}

// Pays a generic tap ability's cost (mana + discard + tap) without resolving its effect — kept
// separate from applyGenericTapEffect for the same reason payGenericSacrificeCost is split from
// applySacrificeEffect: activateGenericTapAbility's search_library branch needs to pay the cost,
// sync the floating pool if used, and then open the interactive library-search choice itself.
// humanPool: see payGenericSacrificeCost's own doc comment — same pool-first-then-auto-tap
// preference, and the same poolSpent-on-the-return-value handoff back to the caller.
export function payGenericTapCost(
  session: GameSession,
  seatId: string,
  cardId: string,
  abilityIndex: number,
  humanPool?: ManaPool,
  // A human's own pick for a "Discard a card" cost (Cryptbreaker, ...) — chooseWorstHandCardToDiscard
  // is only the fallback for agents and callers with no prompt of their own.
  chosenDiscardId?: string,
  // A human's own picks for "Tap N untapped Zombies you control" (Cryptbreaker).
  chosenTapCreatureIds?: string[]
): { session: GameSession; ability: GenericTapAbility; card: VisibleCard; poolSpent?: ManaPool } | undefined {
  const seat = session.seats.find((item) => item.id === seatId);
  const card = seat?.board.battlefield.find((item) => item.id === cardId);
  if (!seat || !card) return undefined;
  const ability = parseGenericTapAbilities(abilityOracleText(card))[abilityIndex];
  if (!ability) return undefined;
  // "Tap three untapped Zombies you control" has no {T} of its own, so the source's own tapped/summoning-sick state is irrelevant.
  if (!ability.costTapCreatures) {
    if (card.tapped) return undefined;
    if (card.typeLine.includes("Creature") && card.summoningSick && !hasHaste(card)) return undefined;
  }
  const chosenTaps = ability.costTapCreatures && chosenTapCreatureIds && chosenTapCreatureIds.length === ability.costTapCreatures.count
    ? chosenTapCreatureIds.map((id) => seat.board.battlefield.find((creature) => creature.id === id && !creature.tapped)).filter((creature): creature is VisibleCard => Boolean(creature))
    : undefined;
  const tappedForCost = ability.costTapCreatures
    ? chosenTaps && chosenTaps.length === ability.costTapCreatures.count
      ? chosenTaps
      : chooseCreaturesToTapForCost(seat, ability.costTapCreatures.count, ability.costTapCreatures.subtype)
    : undefined;
  if (ability.costTapCreatures && !tappedForCost) return undefined;
  if (!activateOnlyIfConditionMet(ability.clause, seat)) return undefined;
  if (ability.costRemoveCounter && counterCount(card, ability.costRemoveCounter) < 1) return undefined;
  if (ability.costExileGraveyard && (seat.board.graveyard?.length ?? 0) < ability.costExileGraveyard) return undefined;
  const lifeCost = (ability.costLifeCommanderColors ? commanderColorCount(seat) : 0) + (ability.costLife ?? 0);
  if (lifeCost > 0 && seat.life <= lifeCost) return undefined;
  const tapIds = new Set((tappedForCost ?? []).map((creature) => creature.id));

  const discardCard = ability.costDiscard
    ? (chosenDiscardId ? discardableHandCards(seat, ability.costDiscardType).find((handCard) => handCard.id === chosenDiscardId) : undefined) ?? chooseWorstHandCardToDiscard(seat, ability.costDiscardType)
    : undefined;
  if (ability.costDiscard && !discardCard) return undefined;

  const totalManaCost = manaValueFromManaCost(ability.costManaText);
  const costCard = genericManaAbilityCostShim(ability);
  const poolPayment = totalManaCost > 0 && humanPool ? payCostFromPool(humanPool, costCard, totalManaCost) : undefined;
  // excludeCardId: cardId — same self-tap exclusion as payGenericSacrificeCost above: this
  // ability's own {T} already requires the source untapped, so it can't also tap itself via a
  // separate mana ability of its own to help pay this same activation's generic cost.
  const payment =
    totalManaCost > 0
      ? poolPayment?.ok
        ? poolPayment
        : chooseManaSourcesForCost(seat, costCard, totalManaCost, cardId, session.seats)
      : undefined;
  if (totalManaCost > 0 && !payment?.ok) return undefined;

  let next = session;
  if (payment?.ok && !poolPayment?.ok) {
    next = { ...next, seats: next.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item)) };
  }
  if (lifeCost > 0) {
    next = rulesEvent({ ...next, seats: next.seats.map((item) => (item.id === seatId ? { ...item, life: item.life - lifeCost } : item)) }, seatId, `${seat.name} pays ${lifeCost} life to activate ${card.name}.`);
  }
  if (discardCard) {
    next = {
      ...next,
      seats: next.seats.map((item) =>
        item.id === seatId
          ? {
              ...item,
              board: {
                ...item.board,
                hand: item.board.hand.filter((handCard) => handCard.id !== discardCard.id),
                graveyard: [...(item.board.graveyard ?? []), { ...discardCard, zone: "graveyard" as const, counters: undefined, interpretedEffects: undefined }]
              }
            }
          : item
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: seatVerb(seat, `${seat.name} discards ${discardCard.name} to activate ${card.name}.`, `You discard ${discardCard.name} to activate ${card.name}.`),
          detail: "Rules action"
        },
        ...next.events
      ]
    };
  }
  // "Exile seven cards from your graveyard" (Sunken Palace): the least valuable cards go first (spells and lands before creatures).
  if (ability.costExileGraveyard) {
    const keepValue = (graveCard: VisibleCard) => (graveCard.typeLine.includes("Creature") ? 3 : /Instant|Sorcery/.test(graveCard.typeLine) ? 1 : 2) + graveCard.manaValue * 0.1;
    const toExile = [...(seat.board.graveyard ?? [])].sort((a, b) => keepValue(a) - keepValue(b)).slice(0, ability.costExileGraveyard);
    next = toExile.reduce((current, graveCard) => moveCardBetweenVisibleZones(current, seatId, graveCard.id, "exile"), next);
    next = rulesEvent(next, seatId, `${seat.name} exiles ${toExile.length} cards from their graveyard to activate ${card.name}.`);
  }
  // Paying the {T} in the cost taps the source; an "Untap ~." effect (Retrofitter Foundry's 2nd/3rd
  // abilities) then immediately untaps it again as part of resolving — net result is it stays
  // untapped, and can be activated again the same turn if its cost can be paid again.
  next = {
    ...next,
    seats: next.seats.map((item) =>
      item.id === seatId
        ? {
            ...item,
            board: {
              ...item.board,
              battlefield: item.board.battlefield.map((c) =>
                tapIds.has(c.id)
                  ? { ...c, tapped: true }
                  : c.id !== cardId || ability.costTapCreatures
                  ? c
                  : {
                      ...c,
                      tapped: !ability.untapsSelf,
                      // "Remove a gold counter from this artifact" is part of the cost.
                      ...(ability.costPutCounter ? { counters: applyCounterDelta(c, ability.costPutCounter, 1).counters } : {}),
                      ...(ability.costRemoveCounter
                        ? { counters: (c.counters ?? []).map((counter) => (counter.kind === ability.costRemoveCounter ? { ...counter, count: counter.count - 1 } : counter)).filter((counter) => counter.count > 0) }
                        : {})
                    }
              )
            }
          }
        : item
    )
  };

  // Mazemind Tome: "When there are four or more page counters on this artifact, exile it. If you do, you gain 4 life." Counters only change as this
  // cost is paid, so the state trigger is checked right here.
  if (ability.costPutCounter) {
    const threshold = card.oracleText.match(/when there are (four|five|six|seven|\d+) or more ([a-z]+) counters on this [a-z]+, exile it\. if you do, you gain (\d+) life/i);
    const placed = next.seats.find((item) => item.id === seatId)?.board.battlefield.find((c) => c.id === cardId);
    if (threshold && placed && threshold[2].toLowerCase() === ability.costPutCounter && counterCount(placed, ability.costPutCounter) >= (numberWordToInt(threshold[1].toLowerCase()) ?? Number.parseInt(threshold[1], 10))) {
      next = moveCardBetweenVisibleZones(next, seatId, cardId, "exile");
      const gain = Number.parseInt(threshold[3], 10);
      next = rulesEvent({ ...next, seats: next.seats.map((item) => (item.id === seatId ? { ...item, life: item.life + gain } : item)) }, seatId, `${card.name} is exiled with ${threshold[1]} or more ${ability.costPutCounter} counters, and ${seat.name} gains ${gain} life.`);
    }
  }

  return { session: next, ability, card, poolSpent: poolPayment?.ok ? poolPayment.pool : undefined };
}

// The effect half of a plain "{cost}: effect." activated ability (parseGenericManaAbilities'
// GenericManaAbility.effectText) — dispatched through the same removal/zone/common-trigger parsers
// already used for modal spells and recurring phase triggers, rather than re-narrowing the effect
// vocabulary a fourth time. Unlike parseGenericModalEffect's per-mode variant, this also tries
// removalEffect first: a single (non-modal) ability isn't already owned by removalSpells.ts's own
// modal system the way a modal bullet can be, so there's no overlap to guard against here.
type GenericAbilityEffect =
  | { kind: "removal"; effect: RemovalEffect }
  | { kind: "zone"; effect: ZoneEffect }
  | { kind: "pump"; effect: PumpEffect }
  | { kind: "search_library"; effect: SearchLibraryEffect }
  | { kind: "animate_enchantment" }
  | { kind: "trigger"; effect: TriggerEffect }
  | { kind: "phase_out" }
  // "{2}{C}: Exile enchanted creature." (Utter Insignificance): exiles whatever this Aura is attached to.
  | { kind: "exile_enchanted" }
  // Scavenging Ooze: "Exile target card from a graveyard. If it was a creature card, put a +1/+1 counter on this creature and you gain 1 life."
  | { kind: "exile_graveyard_card_scavenge" }
  // "Untap all lands you control." (Beledros Witherbloom)
  | { kind: "untap_all_lands" }
  | { kind: "transform_self" };

// "Transform Heliod." (Heliod, the Radiant Dawn's own activated ability, naming itself rather than
// "this creature") — reuses transformPermanent, the same flip-to-other-face logic
// SacrificeEffect's own "transform_self" kind already applies for sacrifice-costed transformers
// (Westvale Abbey). The "not target" exclusion keeps this from misreading an unrelated "Transform
// target X" effect (transforming something else) as this shape.
function parseTransformSelfEffect(effectText: string): boolean {
  return /^transform\s+(?!target\b)/i.test(effectText);
}

// "Enchanted/equipped creature phases out." (Vanishing) — no other card in this engine's real-card
// sample uses this shape, matched narrowly like parseEnchantmentAnimationEffect above rather than a
// general "X phases out" grammar.
function parsePhaseOutEffect(effectText: string): boolean {
  return /\b(?:enchanted|equipped) creature phases out\b/i.test(effectText);
}

// Shared by every "enter as a copy" shape parseEnterAsCopyEffect recognizes: controlledOnly (Estrid's
// Invocation) only ever looks at the caster's own battlefield, while the broader "any ... on the
// battlefield" shape (Mirrormade) searches everyone's — the caster's own permanents first (matching
// the "prefer your own stuff" bias other unmodeled-choice heuristics in this file already use, e.g.
// chooseNonAuraEnchantmentTarget for Zur), then every other seat's in turn order.
// The target spec for a zone effect only when the human really has more than one thing to choose between.
// A reanimation ability's target (Whip of Erebos, Cauldron of Essence): a creature/permanent card in your graveyard, or in any graveyard.
function reanimateAbilitySpec(effect: ZoneEffect): TargetSpec | undefined {
  if (effect.kind !== "reanimate") return undefined;
  return {
    id: "target",
    zone: "graveyard",
    permanentType: effect.targetType === "card" ? undefined : (effect.targetType as TargetSpec["permanentType"]),
    controller: effect.anyGraveyard ? "any" : "you",
    min: 1,
    max: 1,
    prompt: `Return target ${effect.targetType === "card" ? "card" : effect.targetType.replace(/_/g, " ")} card from ${effect.anyGraveyard ? "a" : "your"} graveyard to the battlefield.`
  };
}

export function zoneChoiceSpecFor(session: GameSession, seatId: string, effect: ZoneEffect, sourceCard: VisibleCard): TargetSpec | undefined {
  const spec = zoneEffectTargetSpec(effect) ?? reanimateAbilitySpec(effect);
  if (!spec) return undefined;
  return legalTargets(session, seatId, spec, sourceCard).length > 0 ? spec : undefined;
}

// Zur, Eternal Schemer: "Target non-Aura enchantment becomes a creature. It's still an enchantment.
// Its power and toughness are each equal to its mana value." No other card in this engine's real-card
// sample uses this shape, so it's matched loosely (the two load-bearing phrases, not the whole
// sentence verbatim) rather than pinned to one exact wording.
function parseEnchantmentAnimationEffect(effectText: string): boolean {
  const text = effectText.toLowerCase();
  // The current Oracle wording is "Target non-Aura enchantment you control becomes a creature in addition to its other types and has base power
  // and base toughness each equal to its mana value." ("you control" was added by errata; the old text had no such phrase).
  return /\btarget non-aura enchantment(?: you control)? becomes an? creature\b/.test(text) && /\bequal to its mana value\b/.test(text);
}

// No chosenX exists for an activated ability (parseGenericManaAbilities already declines {X}-cost
// abilities outright), so unlike the modal/spell path this never substitutes X — a "target creature
// gets -X/-X" activated ability is simply declined, the same "no guessing" behavior it always had.
export function parseGenericAbilityEffect(effectText: string): GenericAbilityEffect | undefined {
  // "Untap all lands you control." (Beledros Witherbloom's "Pay 10 life: ...").
  if (/^untap all lands you control\.?(?:\s*activate only once each turn\.?)?$/i.test(effectText.trim())) return { kind: "untap_all_lands" };
  if (/^exile target card from a graveyard\.\s*if it was a creature card, put a \+1\/\+1 counter on this creature and you gain 1 life\.?$/i.test(effectText.trim())) {
    return { kind: "exile_graveyard_card_scavenge" };
  }
  // One verb on a chosen target ("Target creature gains flying until end of turn.", "Put a +1/+1 counter on target creature. Activate only as a
  // sorcery."): the shared targeted effect, so a human is asked for the target. The timing restriction is enforced by the ability's own limiter.
  const targetedWhole = parseTargetedEffect(effectText.replace(/\s*activate only (?:as a sorcery|during your turn)[^.]*\.?\s*$/i, ""));
  if (targetedWhole) return { kind: "trigger", effect: { kind: "targeted_effect", effect: targetedWhole } };
  const removal = parseRemovalEffect(effectText);
  if (removal) return { kind: "removal", effect: removal };
  const pump = parseTargetedPump(effectText);
  if (pump) return { kind: "pump", effect: pump };
  const searchLibrary = parseSearchLibraryEffectText(effectText);
  if (searchLibrary) return { kind: "search_library", effect: searchLibrary };
  if (parseEnchantmentAnimationEffect(effectText)) return { kind: "animate_enchantment" };
  if (parsePhaseOutEffect(effectText)) return { kind: "phase_out" };
  if (/^exile enchanted (?:creature|permanent)\.?$/i.test(effectText.trim())) return { kind: "exile_enchanted" };
  if (parseTransformSelfEffect(effectText)) return { kind: "transform_self" };
  const zone = parseZoneEffect(effectText);
  if (zone) return { kind: "zone", effect: zone };
  const trigger = commonTriggerEffect(effectText, "clause");
  if (trigger) return { kind: "trigger", effect: trigger };
  return undefined;
}

// No "you control" restriction is printed on Zur's ability, but a deterministic policy still needs
// to pick one side first: the caster's own non-Aura enchantment is almost always the intended target
// (it's what benefits from Zur's "enchantment creatures you control have deathtouch, lifelink, and
// hexproof"), so that's preferred; an opponent's is only considered if the caster controls none.
function chooseNonAuraEnchantmentTarget(session: GameSession, casterSeatId: string): { seatId: string; card: VisibleCard } | undefined {
  const ownCandidates = session.seats.find((seat) => seat.id === casterSeatId)?.board.battlefield.filter(isNonAuraEnchantment) ?? [];
  if (ownCandidates.length > 0) return { seatId: casterSeatId, card: ownCandidates[0] };
  for (const seat of session.seats) {
    if (seat.id === casterSeatId || seat.hasLost) continue;
    const candidate = seat.board.battlefield.find(isNonAuraEnchantment);
    if (candidate) return { seatId: seat.id, card: candidate };
  }
  return undefined;
}

export function applyEnchantmentAnimation(session: GameSession, casterSeatId: string, sourceCardName: string, target: { seatId: string; card: VisibleCard }): GameSession {
  return {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === target.seatId
        ? {
            ...seat,
            board: {
              ...seat.board,
              battlefield: seat.board.battlefield.map((card) =>
                card.id === target.card.id
                  ? { ...card, grantedTypes: [...(card.grantedTypes ?? []).filter((type) => type !== "Creature"), "Creature"], animatedAsCreature: true }
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
        message: `${target.card.name} becomes a ${target.card.manaValue}/${target.card.manaValue} creature from ${sourceCardName}.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

// "Enchanted/equipped creature phases out." (the Vanishing Aura). The permanent (and anything attached to it) is treated as though it does not exist
// until it phases in at its controller's next untap step: see src/engine/phasing.ts for the full rules summary and the places that skip phasedOut.
function applyPhaseOut(session: GameSession, _casterSeatId: string, sourceCard: VisibleCard): GameSession {
  const targetId = sourceCard.attachedToId;
  if (!targetId) return session;
  return phaseOutPermanent(session, targetId);
}

export function genericAbilityEffectHasLegalTarget(session: GameSession, casterSeatId: string, sourceCard: VisibleCard, effect: GenericAbilityEffect): boolean {
  if (effect.kind === "removal") return removalEffectHasLegalTarget(session, casterSeatId, sourceCard, effect.effect);
  if (effect.kind === "zone") return zoneEffectHasLegalTarget(session, casterSeatId, effect.effect);
  if (effect.kind === "pump") return choosePumpTarget(session, casterSeatId, effect.effect) !== undefined;
  if (effect.kind === "animate_enchantment") return chooseNonAuraEnchantmentTarget(session, casterSeatId) !== undefined;
  if (effect.kind === "exile_graveyard_card_scavenge") return session.seats.some((seat) => (seat.board.graveyard ?? []).length > 0);
  if (effect.kind === "phase_out") {
    const target = sourceCard.attachedToId ? findPermanentById(session, sourceCard.attachedToId) : undefined;
    return target !== undefined && !target.phasedOut;
  }
  if (effect.kind === "exile_enchanted") return sourceCard.attachedToId !== undefined && findPermanentById(session, sourceCard.attachedToId) !== undefined;
  if (effect.kind === "transform_self") return Boolean(sourceCard.faces && sourceCard.faces.length === 2);
  if (effect.kind === "untap_all_lands") return (session.seats.find((item) => item.id === casterSeatId)?.board.battlefield ?? []).some((card) => card.tapped && card.typeLine.includes("Land"));
  if (effect.kind === "search_library") {
    const seat = session.seats.find((item) => item.id === casterSeatId);
    return (seat?.library?.length ?? 0) > 0;
  }
  if (effect.effect.kind === "add_counter" && effect.effect.scope !== "self" && effect.effect.scope !== "context") {
    return chooseCounterTarget(session, casterSeatId, effect.effect.counterKind, effect.effect.scope === "target_creature_you_control") !== undefined;
  }
  return true;
}

export function applyGenericAbilityEffect(session: GameSession, casterSeatId: string, sourceCard: VisibleCard, effect: GenericAbilityEffect, chosenCardId?: string): GameSession {
  if (effect.kind === "removal") return applyPrimitiveAction(session, casterSeatId, sourceCard, { kind: "removal", effect: effect.effect });
  if (effect.kind === "zone") return applyPrimitiveAction(session, casterSeatId, sourceCard, { kind: "zone", effect: effect.effect });
  if (effect.kind === "pump") return applyPrimitiveAction(session, casterSeatId, sourceCard, { kind: "pump_target", effect: effect.effect });
  if (effect.kind === "animate_enchantment") {
    const target = chooseNonAuraEnchantmentTarget(session, casterSeatId);
    return target ? applyEnchantmentAnimation(session, casterSeatId, sourceCard.name, target) : session;
  }
  // search_library never actually reaches this function: activateGenericManaAbility detects it
  // before ever calling applyGenericAbilityEffect and opens the interactive library-search choice
  // instead (pendingRuleChoice is component state this pure function can't reach).
  if (effect.kind === "search_library") return session;
  if (effect.kind === "exile_graveyard_card_scavenge") {
    const caster = session.seats.find((seat) => seat.id === casterSeatId);
    const all = session.seats.flatMap((seat) => (seat.board.graveyard ?? []).map((card) => ({ seatId: seat.id, card })));
    // Prefers an opponent's creature card (growth + graveyard hate), then any other opponent card; never your own creature
    // cards, which may be reanimation targets. Falls back to your own non-creature card only when nothing else exists.
    const rank = (entry: { seatId: string; card: VisibleCard }) => {
      const isCreature = entry.card.typeLine.includes("Creature");
      if (entry.seatId !== casterSeatId) return (isCreature ? 20 : 10) + entry.card.manaValue / 100;
      return isCreature ? -1 : 1;
    };
    const pick = (chosenCardId ? all.find((entry) => entry.card.id === chosenCardId) : undefined) ?? all.reduce<(typeof all)[number] | undefined>((best, entry) => (!best || rank(entry) > rank(best) ? entry : best), undefined);
    if (!caster || !pick) return rulesEvent(session, casterSeatId, `${sourceCard.name} has no card in any graveyard to exile.`);
    const exiled = moveCardAcrossSeats(session, pick.seatId, pick.card.id, pick.seatId, "exile").session;
    if (!pick.card.typeLine.includes("Creature")) return rulesEvent(exiled, casterSeatId, `${caster.name} exiles ${pick.card.name} with ${sourceCard.name}.`);
    const grown: GameSession = {
      ...exiled,
      seats: exiled.seats.map((seat) =>
        seat.id !== casterSeatId
          ? seat
          : {
              ...seat,
              life: seat.life + 1,
              board: {
                ...seat.board,
                battlefield: seat.board.battlefield.map((card) =>
                  card.id === sourceCard.id
                    ? { ...card, counters: [...(card.counters ?? []).filter((counter) => counter.kind !== "+1/+1"), { kind: "+1/+1", count: ((card.counters ?? []).find((counter) => counter.kind === "+1/+1")?.count ?? 0) + 1 }] }
                    : card
                )
              }
            }
      )
    };
    return rulesEvent(grown, casterSeatId, `${caster.name} exiles ${pick.card.name} with ${sourceCard.name}: a +1/+1 counter and 1 life.`);
  }
  if (effect.kind === "untap_all_lands") {
    const owner = session.seats.find((seat) => seat.id === casterSeatId);
    const tappedLands = (owner?.board.battlefield ?? []).filter((card) => card.tapped && card.typeLine.includes("Land"));
    const untapped: GameSession = {
      ...session,
      seats: session.seats.map((seat) =>
        seat.id !== casterSeatId ? seat : { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.tapped && card.typeLine.includes("Land") ? { ...card, tapped: false } : card)) } }
      )
    };
    return rulesEvent(untapped, casterSeatId, `${owner?.name ?? "A player"} untaps ${tappedLands.length} land${tappedLands.length === 1 ? "" : "s"} with ${sourceCard.name}.`);
  }
  if (effect.kind === "phase_out") return applyPhaseOut(session, casterSeatId, sourceCard);
  if (effect.kind === "exile_enchanted") {
    const holder = sourceCard.attachedToId ? session.seats.find((seat) => seat.board.battlefield.some((card) => card.id === sourceCard.attachedToId)) : undefined;
    const target = holder?.board.battlefield.find((card) => card.id === sourceCard.attachedToId);
    if (!holder || !target) return noLegalTargetEvent(session, casterSeatId, sourceCard.name);
    return rulesEvent(moveCardBetweenVisibleZones(session, holder.id, target.id, "exile"), casterSeatId, `${sourceCard.name} exiles ${target.name}.`);
  }
  if (effect.kind === "transform_self") return transformPermanent(session, casterSeatId, sourceCard.id, sourceCard.name, false);
  const syntheticTrigger: Extract<PendingAction, { type: "trigger" }> = {
    id: crypto.randomUUID(),
    type: "trigger",
    actorSeatId: casterSeatId,
    controllerSeatId: casterSeatId,
    sourceCardId: sourceCard.id,
    sourceCardName: sourceCard.name,
    triggerKind: "common",
    effect: effect.effect,
    message: ""
  };
  return resolveTriggerEffect(session, syntheticTrigger);
}

// Pays a generic mana-cost ability's cost (mana + discard + once-each-turn marking) without
// resolving its effect — kept separate from applyGenericAbilityEffect for the same reason
// payGenericSacrificeCost/payGenericTapCost are: a search_library effect needs to open the
// interactive library-search choice, which this pure function can't do.
// humanPool: see payGenericSacrificeCost's own doc comment — same pool-first-then-auto-tap
// preference, and the same poolSpent-on-the-return-value handoff back to the caller.
export function payGenericManaCost(
  session: GameSession,
  seatId: string,
  cardId: string,
  abilityIndex: number,
  humanPool?: ManaPool
): { session: GameSession; ability: GenericManaAbility; card: VisibleCard; effect: GenericAbilityEffect; poolSpent?: ManaPool } | undefined {
  const seat = session.seats.find((item) => item.id === seatId);
  const card = seat?.board.battlefield.find((item) => item.id === cardId);
  if (!seat || !card) return undefined;
  const ability = parseGenericManaAbilities(card.oracleText)[abilityIndex];
  if (!ability) return undefined;
  if (!activateOnlyIfConditionMet(ability.clause, seat)) return undefined;

  const onceKey = `${session.turn}:${cardId}:generic_mana:${abilityIndex}`;
  const limitedOnceEachTurn = hasOnceEachTurnLimiter(ability.clause);
  if (limitedOnceEachTurn && session.onceEachTurnEffectsUsed?.includes(onceKey)) return undefined;

  const effect = parseGenericAbilityEffect(ability.effectText);
  if (!effect) return undefined;

  const discardCard = ability.costDiscard ? chooseWorstHandCardToDiscard(seat) : undefined;
  if (ability.costDiscard && !discardCard) return undefined;

  // Rule 118.4: a life-payment cost can't be paid below 0 life — checked as a hard precondition,
  // same as costDiscard's "nothing to discard" check above.
  if (seat.life < ability.costLife) return undefined;
  const totalManaCost = manaValueFromManaCost(ability.costManaText);
  const costCard = genericManaAbilityCostShim(ability);
  const poolPayment = totalManaCost > 0 && humanPool ? payCostFromPool(humanPool, costCard, totalManaCost) : undefined;
  const payment =
    totalManaCost > 0
      ? poolPayment?.ok
        ? poolPayment
        : chooseManaSourcesForCost(seat, costCard, totalManaCost, undefined, session.seats)
      : undefined;
  if (totalManaCost > 0 && !payment?.ok) return undefined;

  let next = session;
  if (limitedOnceEachTurn) {
    next = { ...next, onceEachTurnEffectsUsed: [...(next.onceEachTurnEffectsUsed ?? []), onceKey] };
  }
  if (payment?.ok && !poolPayment?.ok) {
    next = { ...next, seats: next.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item)) };
  }
  if (ability.costLife > 0) {
    next = {
      ...next,
      seats: next.seats.map((item) => (item.id === seatId ? { ...item, life: item.life - ability.costLife } : item)),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} pays ${ability.costLife} life to activate ${card.name}.`,
          detail: "Rules action"
        },
        ...next.events
      ]
    };
  }
  if (discardCard) {
    next = {
      ...next,
      seats: next.seats.map((item) =>
        item.id === seatId
          ? {
              ...item,
              board: {
                ...item.board,
                hand: item.board.hand.filter((handCard) => handCard.id !== discardCard.id),
                graveyard: [...(item.board.graveyard ?? []), { ...discardCard, zone: "graveyard" as const, counters: undefined, interpretedEffects: undefined }]
              }
            }
          : item
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: seatVerb(seat, `${seat.name} discards ${discardCard.name} to activate ${card.name}.`, `You discard ${discardCard.name} to activate ${card.name}.`),
          detail: "Rules action"
        },
        ...next.events
      ]
    };
  }

  return { session: next, ability, card, effect, poolSpent: poolPayment?.ok ? poolPayment.pool : undefined };
}

// humanPool: see payGenericSacrificeCost's own doc comment — same pool-first-then-auto-tap
// preference, and the same poolSpent-on-the-return-value handoff back to the caller.
export function resolveSelfUntapAbility(session: GameSession, seatId: string, cardId: string, abilityIndex: number, humanPool?: ManaPool): { session: GameSession; poolSpent?: ManaPool } {
  const seat = session.seats.find((item) => item.id === seatId);
  const card = seat?.board.battlefield.find((item) => item.id === cardId);
  if (!seat || !card || !card.tapped) return { session };
  const ability = parseSelfUntapAbilities(card.oracleText)[abilityIndex];
  if (!ability) return { session };
  if (!activateOnlyIfConditionMet(ability.clause, seat)) return { session };

  const costCard = genericCostShim(ability.costMana);
  const poolPayment = ability.costMana > 0 && humanPool ? payCostFromPool(humanPool, costCard, ability.costMana) : undefined;
  const payment =
    ability.costMana > 0 ? (poolPayment?.ok ? poolPayment : chooseManaSourcesForCost(seat, costCard, ability.costMana, undefined, session.seats)) : undefined;
  if (ability.costMana > 0 && !payment?.ok) return { session };

  let next = session;
  if (payment?.ok && !poolPayment?.ok) {
    next = { ...next, seats: next.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item)) };
  }
  return {
    session: {
      ...next,
      seats: next.seats.map((item) =>
        item.id === seatId
          ? { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((c) => (c.id === cardId ? { ...c, tapped: false } : c)) } }
          : item
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} activates ${card.name}: untaps it.`,
          detail: "Rules action"
        },
        ...next.events
      ]
    },
    poolSpent: poolPayment?.ok ? poolPayment.pool : undefined
  };
}

// Inserts a creature type into the subtype section (after the em dash) rather than just
// appending it to the end of the type line, so a "becomes a 4/4 Construct ... in addition to its
// other types" upgrade reads as "Artifact Creature — Construct Servo", not "Artifact Creature —
// Servo Construct" tacked on after the whole line.
function addCreatureTypeToTypeLine(typeLine: string, newType: string): string {
  if (typeLine.toLowerCase().includes(newType.toLowerCase())) return typeLine;
  const dashIndex = typeLine.indexOf("—");
  if (dashIndex === -1) return `${typeLine} — ${newType}`;
  const before = typeLine.slice(0, dashIndex).trim();
  const after = typeLine.slice(dashIndex + 1).trim();
  return `${before} — ${newType}${after ? ` ${after}` : ""}`;
}

// Every non-indestructible permanent of the given plural types ("artifacts", "creatures"...) on the whole battlefield. Also used by the AI gate in legalActions.
export function destroyAllTypesVictims(session: GameSession, types: string[]): Array<{ seatId: string; card: VisibleCard }> {
  const wanted = types.map((type) => type.replace(/s$/, ""));
  return session.seats.flatMap((item) => item.board.battlefield.filter((card) => !hasIndestructible(card) && wanted.some((type) => hasCardType(card, type[0].toUpperCase() + type.slice(1)))).map((card) => ({ seatId: item.id, card })));
}

export function applyGenericTapEffect(
  session: GameSession,
  seatId: string,
  sourceCardId: string,
  sourceCardName: string,
  effect: GenericTapEffect,
  clause: string,
  // The human's pick for "exile/choose target card in a graveyard" effects (Cemetery Reaper, Zul Ashur).
  chosenCardId?: string,
  options?: { skipDiscardSeatId?: string }
): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;

  // search_library never actually reaches this function: activateGenericTapAbility detects it
  // before ever calling applyGenericTapEffect and opens the interactive library-search choice
  // instead (pendingRuleChoice is component state applyGenericTapEffect can't reach). This branch
  // only exists to keep the switch exhaustive for the type checker.
  if (effect.kind === "search_library") return session;

  if (effect.kind === "self_counter") {
    return rulesEvent(
      { ...session, seats: session.seats.map((item) => (item.id !== seatId ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === sourceCardId ? applyCounterDelta(card, effect.counterKind, effect.amount) : card)) } })) },
      seatId,
      `${seat.name} activates ${sourceCardName}: it gets ${effect.amount} ${effect.counterKind} counter${effect.amount === 1 ? "" : "s"}.`
    );
  }

  if (effect.kind === "scry") return resolveAgentLibraryLookWorkflow(session, seatId, sourceCardName, "scry_cards", effect.amount + surveilBonusForSeat(seat));

  // Steel Overseer: a counter on each matching permanent you control (the source itself included when it matches).
  if (effect.kind === "counter_on_each_you_control") {
    const matched = seat.board.battlefield.filter((card) => permanentMatchesQualifier(card, effect.qualifier));
    if (matched.length === 0) return rulesEvent(session, seatId, `${sourceCardName} resolves, but you control no ${effect.qualifier}.`);
    const ids = new Set(matched.map((card) => card.id));
    return rulesEvent(
      { ...session, seats: session.seats.map((item) => (item.id !== seatId ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (ids.has(card.id) ? applyCounterDelta(card, effect.counterKind, effect.amount) : card)) } })) },
      seatId,
      `${seat.name} activates ${sourceCardName}: ${matched.length} ${effect.qualifier} get ${effect.amount} ${effect.counterKind} counter${effect.amount === 1 ? "" : "s"}.`
    );
  }

  // Nevinyrral's Disk: destroy every permanent of the listed types; indestructible ones survive (rule 702.12b).
  if (effect.kind === "destroy_all_types") {
    const victims = destroyAllTypesVictims(session, effect.types);
    return destroyCreatures(rulesEvent(session, seatId, `${seat.name} activates ${sourceCardName}: destroy all ${effect.types.join(", ")}.`), victims.map((victim) => ({ seatId: victim.seatId, cardId: victim.card.id, message: `${victim.card.name} is destroyed by ${sourceCardName}.` })), "Rules action");
  }

  if (effect.kind === "next_spell_improvise") {
    return rulesEvent({ ...session, seats: session.seats.map((item) => (item.id === seatId ? { ...item, nextSpellHasImprovise: true } : item)) }, seatId, `${seat.name} activates ${sourceCardName}: the next spell this turn has improvise.`);
  }

  if (effect.kind === "copy_imprinted_card") {
    // The best imprinted card (highest mana value) — a human is not asked which.
    const imprinted = session.seats.flatMap((item) => item.board.exile ?? []).filter((card) => card.imprintedOnId === sourceCardId).sort((a, b) => b.manaValue - a.manaValue)[0];
    if (!imprinted) return rulesEvent(session, seatId, `${sourceCardName} has no imprinted card to copy.`);
    const copied = createCopyTokenForSeat(session, seatId, imprinted);
    const hasted: GameSession = {
      ...copied.session,
      seats: copied.session.seats.map((item) =>
        item.id !== seatId
          ? item
          : {
              ...item,
              board: {
                ...item.board,
                battlefield: item.board.battlefield.map((card) =>
                  card.id === copied.token.id ? { ...card, summoningSick: false, exileAtEndStep: true, grantedKeywords: [...(card.grantedKeywords ?? []), "haste"], temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), "haste"] } : card
                )
              }
            }
      )
    };
    return rulesEvent(hasted, seatId, `${seat.name} activates ${sourceCardName} and creates a token copy of ${imprinted.name} with haste (exiled at the next end step).`);
  }

  if (effect.kind === "create_tokens") {
    const specs = parseCreateTokenSpecs(clause);
    if (specs.length === 0) return session;
    const created = createTokensForSeat(session, seatId, sourceCardId, specs);
    const createdNames = created.createdTokens.map((token) => token.name);
    return {
      ...created.session,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} activates ${sourceCardName} and creates ${createdNames.join(", ")}.`,
          detail: "Rules action"
        },
        ...created.session.events
      ]
    };
  }

  if (effect.kind === "counter_and_transform") {
    const target = chooseGenericTapTarget(seat, effect.targetTypeFilter);
    if (!target) return session;
    const transforms = effect.power !== undefined && effect.toughness !== undefined;
    return {
      ...session,
      seats: session.seats.map((item) =>
        item.id === seatId
          ? {
              ...item,
              board: {
                ...item.board,
                battlefield: item.board.battlefield.map((permanent) => {
                  if (permanent.id !== target.id) return permanent;
                  const withCounter = applyCounterDelta(permanent, "+1/+1", 1);
                  if (!transforms) return withCounter;
                  return {
                    ...withCounter,
                    power: String(effect.power),
                    toughness: String(effect.toughness),
                    typeLine: effect.addedType ? addCreatureTypeToTypeLine(withCounter.typeLine, effect.addedType) : withCounter.typeLine
                  };
                })
              }
            }
          : item
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: transforms
            ? `${seat.name} activates ${sourceCardName}: ${target.name} gets a +1/+1 counter and becomes a ${effect.power}/${effect.toughness}${effect.addedType ? ` ${effect.addedType}` : ""}.`
            : `${seat.name} activates ${sourceCardName}: ${target.name} gets a +1/+1 counter.`,
          detail: "Rules action"
        },
        ...session.events
      ]
    };
  }

  if (effect.kind === "zone_effect") return applyZoneEffect(session, seatId, sourceCardName, effect.effect);

  // Castle Locthwain: "Draw a card, then you lose life equal to the number of cards in your hand."
  if (effect.kind === "draw_then_lose_life_equal_hand") {
    const drawn = drawForSeat(session, seatId, `${seat.name} draws a card from ${sourceCardName}.`);
    const handSize = drawn.seats.find((item) => item.id === seatId)?.board.hand.length ?? 0;
    return rulesEvent(
      { ...drawn, seats: drawn.seats.map((item) => (item.id === seatId ? { ...item, life: item.life - handSize } : item)) },
      seatId,
      `${seat.name} loses ${handSize} life (cards in hand) from ${sourceCardName}.`
    );
  }

  if (effect.kind === "target_unblockable" || effect.kind === "commander_gains_keyword") {
    const keyword = effect.kind === "target_unblockable" ? "can't be blocked" : effect.keyword;
    const mine = session.seats.find((item) => item.id === seatId);
    const pool = (mine?.board.battlefield ?? []).filter((card) => (effect.kind === "commander_gains_keyword" ? card.commander : card.typeLine.includes("Creature") && !card.summoningSick));
    const target = pool.sort((a, b) => effectivePower(b) - effectivePower(a))[0] ?? (effect.kind === "target_unblockable" ? strongestControlledCreature(mine) : undefined);
    if (!mine || !target) return rulesEvent(session, seatId, `${sourceCardName} has no creature to target.`);
    return rulesEvent(
      {
        ...session,
        seats: session.seats.map((item) =>
          item.id !== seatId
            ? item
            : {
                ...item,
                board: {
                  ...item.board,
                  battlefield: item.board.battlefield.map((card) =>
                    card.id === target.id ? { ...card, temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), keyword], grantedKeywords: [...new Set([...(card.grantedKeywords ?? []), keyword])] } : card
                  )
                }
              }
        )
      },
      seatId,
      `${seat.name} activates ${sourceCardName}: ${target.name} ${effect.kind === "target_unblockable" ? "can't be blocked this turn" : `gains ${keyword} until end of turn`}.`
    );
  }
  if (effect.kind === "hideaway_play") {
    const mine = session.seats.find((item) => item.id === seatId);
    const hidden = (mine?.board.exile ?? []).find((card) => card.hideawaySourceId === sourceCardId);
    if (!mine || !hidden) return rulesEvent(session, seatId, `${sourceCardName} has no hidden card.`);
    const damageCondition = hideawayDamageConditionMet(session, seatId, effect.conditionText);
    const conditionMet = damageCondition !== undefined ? damageCondition : isBoardConditionMet(effect.conditionText, mine, session.seats);
    if (!conditionMet) return rulesEvent(session, seatId, `${seat.name} activates ${sourceCardName}, but the condition isn't met.`);
    return rulesEvent(
      {
        ...session,
        seats: session.seats.map((item) =>
          item.id !== seatId ? item : { ...item, board: { ...item.board, exile: (item.board.exile ?? []).map((card) => (card.id === hidden.id ? { ...card, exiledPlayableBySeatId: seatId, exiledPlayableFree: true, exiledPlayableAnyTime: !isLandCard(card), hideawaySourceId: undefined } : card)) } }
        )
      },
      seatId,
      `${seat.name} may play ${hidden.name} from exile without paying its mana cost (${sourceCardName}).${seat.kind === "human" ? " Open your exile pile and use Cast from Exile." : ""}`
    );
  }
  if (effect.kind === "dig_creature_to_battlefield") {
    const lands = seat.board.battlefield.filter((card) => isLandCard(card)).length;
    return applyDigToBattlefield(session, seatId, sourceCardName, effect.count, lands);
  }
  if (effect.kind === "draw_and_lose_life") {
    const drawn = drawMultipleForSeat(session, seatId, effect.draw, `${seat.name} draws ${effect.draw} card${effect.draw === 1 ? "" : "s"} from ${sourceCardName}.`);
    return rulesEvent({ ...drawn, seats: drawn.seats.map((item) => (item.id === seatId ? { ...item, life: item.life - effect.lose } : item)) }, seatId, `${seat.name} loses ${effect.lose} life from ${sourceCardName}.`);
  }
  if (effect.kind === "draw_cards") {
    return drawMultipleForSeat(session, seatId, effect.amount, `${seat.name} draws ${effect.amount} card${effect.amount === 1 ? "" : "s"} from ${sourceCardName}.`);
  }

  // Geier Reach Sanitarium: each player draws a card, then discards a card.
  if (effect.kind === "each_player_loots") {
    let next = session;
    for (const player of session.seats) {
      if (player.hasLost) continue;
      next = drawForSeat(next, player.id, `${player.name} draws a card from ${sourceCardName}.`);
      const current = next.seats.find((item) => item.id === player.id);
      const discard = current && player.id !== options?.skipDiscardSeatId ? chooseWorstHandCardToDiscard(current) : undefined;
      if (discard) {
        next = moveCardBetweenVisibleZones(next, player.id, discard.id, "graveyard");
        next = rulesEvent(next, player.id, `${player.name} discards ${discard.name} (${sourceCardName}).`);
      }
    }
    return next;
  }

  // Lord of the Accursed: all Zombies gain menace until end of turn (every player's).
  if (effect.kind === "grant_keyword_to_all_until_eot") {
    const seats = session.seats.map((item) => ({
      ...item,
      board: {
        ...item.board,
        battlefield: item.board.battlefield.map((permanent) =>
          permanentMatchesQualifier(permanent, effect.typeMatcher) ? { ...permanent, temporaryGrantedKeywords: [...(permanent.temporaryGrantedKeywords ?? []), effect.keyword] } : permanent
        )
      }
    }));
    return rulesEvent({ ...session, seats }, seatId, `${seat.name} activates ${sourceCardName}: all ${effect.typeMatcher}s gain ${effect.keyword} until end of turn.`);
  }

  // Cemetery Reaper: exile a creature card from a graveyard, then create the token.
  if (effect.kind === "exile_graveyard_creature_then_tokens") {
    const candidates = session.seats.flatMap((item) => (item.board.graveyard ?? []).filter((c) => c.typeLine.includes("Creature")).map((c) => ({ seatId: item.id, card: c })));
    // Prefers an opponent's best card (graveyard hate), otherwise the weakest card of its own.
    const opposing = candidates.filter((entry) => entry.seatId !== seatId);
    const heuristicPick = opposing.length > 0 ? opposing.reduce((a, b) => (b.card.manaValue > a.card.manaValue ? b : a)) : candidates.reduce((a, b) => (b.card.manaValue < a.card.manaValue ? b : a), candidates[0]);
    const pick = candidates.find((entry) => entry.card.id === chosenCardId) ?? heuristicPick;
    if (!pick) return rulesEvent(session, seatId, `${sourceCardName} has no creature card in any graveyard to exile.`);
    const exiled = moveCardAcrossSeats(session, pick.seatId, pick.card.id, pick.seatId, "exile").session;
    const specs = parseCreateTokenSpecs(clause);
    const created = specs.length > 0 ? createTokensForSeat(exiled, seatId, sourceCardId, specs).session : exiled;
    return rulesEvent(created, seatId, `${seat.name} activates ${sourceCardName}: exiles ${pick.card.name} and creates a token.`);
  }

  // Zul Ashur: pick the best matching creature card in the graveyard and let its controller cast it this turn.
  if (effect.kind === "grant_graveyard_cast") {
    const options = (seat.board.graveyard ?? []).filter((c) => permanentMatchesQualifier(c, effect.cardMatcher));
    const best = options.find((c) => c.id === chosenCardId) ?? (options.length > 0 ? options.reduce((a, b) => (b.manaValue > a.manaValue ? b : a)) : undefined);
    if (!best) return rulesEvent(session, seatId, `${sourceCardName} has no ${effect.cardMatcher} card in your graveyard to cast.`);
    return rulesEvent(
      {
        ...session,
        seats: session.seats.map((item) =>
          item.id === seatId
            ? { ...item, board: { ...item.board, graveyard: (item.board.graveyard ?? []).map((c) => (c.id === best.id ? { ...c, graveyardCastGrant: { seatId, turn: session.turn } } : c)) } }
            : item
        )
      },
      seatId,
      `${seat.name} may cast ${best.name} from the graveyard this turn (${sourceCardName}).`
    );
  }

  if (effect.kind === "targeted_effect") {
    const tapSource = session.seats.flatMap((item) => item.board.battlefield).find((card) => card.id === sourceCardId) ?? ({ id: sourceCardId, name: sourceCardName, typeLine: "", oracleText: "", manaValue: 0, colors: [], role: "effect", zone: "battlefield" } as VisibleCard);
    return applyTargetedEffect(session, seatId, tapSource, effect.effect, chosenCardId ? findPermanentOwnerTarget(session, chosenCardId) : undefined);
  }
  if (effect.kind !== "bounce_own") return session;
  // bounce_own
  const target = chooseGenericTapTarget(seat, effect.targetTypeFilter);
  if (!target) return session;
  const bounced = moveCardBetweenVisibleZones(session, seatId, target.id, "hand");
  return {
    ...bounced,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${seat.name} activates ${sourceCardName}: returns ${target.name} to hand.`,
        detail: "Rules action"
      },
      ...bounced.events
    ]
  };
}

export function cycleCardInSession(session: GameSession, seatId: string, cardId: string, options?: { skipSearch?: boolean }): { ok: true; session: GameSession } | { ok: false; message: string } {
  const seat = session.seats.find((item) => item.id === seatId);
  const card = seat?.board.hand.find((item) => item.id === cardId);
  if (!seat || !card) return { ok: false, message: "That card isn't in your hand." };
  const cycling = parseCycling(card.oracleText);
  if (!cycling) return { ok: false, message: `${card.name} doesn't have cycling.` };
  // "Cycling {X}{1}{U}" (Shark Typhoon): X is the most the seat can afford beyond the fixed part.
  const fixedCostText = cycling.costManaText.replace(/\{X\}/gi, "");
  const hasX = /\{X\}/i.test(cycling.costManaText);
  const fixedTotal = manaValueFromManaCost(fixedCostText);
  let cycleX = 0;
  if (hasX) {
    for (let x = 12; x >= 0; x -= 1) {
      if (chooseManaSourcesForCost(seat, genericManaAbilityCostShim({ costManaText: fixedCostText }), fixedTotal + x, undefined, session.seats).ok) {
        cycleX = x;
        break;
      }
    }
  }
  const total = fixedTotal + cycleX;
  const payment = chooseManaSourcesForCost(seat, genericManaAbilityCostShim({ costManaText: fixedCostText }), total, undefined, session.seats);
  if (!payment.ok) return { ok: false, message: `${seat.name} can't pay ${cycling.costManaText} to cycle ${card.name}.` };
  const paid: GameSession = { ...session, seats: session.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item)) };
  const discarded = moveCardBetweenVisibleZones(paid, seatId, cardId, "graveyard");
  let withEvent = rulesEvent(discarded, seatId, `${seat.name} cycles ${card.name} (${cycling.costManaText}${hasX ? `, X=${cycleX}` : ""}).`);
  // "When you cycle this card, create an X/X blue Shark creature token with flying." (Shark Typhoon)
  const cycleToken = card.oracleText.match(/when you cycle this card, create an x\/x ([a-z ]+?) creature token with flying/i);
  if (cycleToken) {
    withEvent = createTokensForSeat(withEvent, seatId, card.id, [{ count: 1, name: "Shark Token", colors: ["U"], typeLine: "Token Creature - Shark", power: String(cycleX), toughness: String(cycleX), oracleText: "Flying", role: "creature" }]).session;
  }
  // A human picks the card to fetch themselves (the caller opens the library search): pay and discard only.
  if (cycling.searchType && options?.skipSearch) return { ok: true, session: withEvent };
  if (cycling.searchType) {
    // Plainscycling and friends: fetch the first matching card (basic only for "basic landcycling") and shuffle.
    const wanted = cycling.searchType;
    const found = (seat.library ?? []).find((candidate) => candidate.typeLine.includes(wanted) && (!cycling.basicOnly || candidate.typeLine.includes("Basic")));
    if (!found) {
      const shuffled = { ...withEvent, seats: withEvent.seats.map((item) => (item.id === seatId ? { ...item, library: shuffleCards(item.library ?? []) } : item)) };
      return { ok: true, session: rulesEvent(shuffled, seatId, `${seat.name} finds no ${wanted} card.`) };
    }
    const fetched = moveLibraryCardToDestination(withEvent, seatId, found.id, "hand", false);
    const shuffled = { ...fetched, seats: fetched.seats.map((item) => (item.id === seatId ? { ...item, library: shuffleCards(item.library ?? []) } : item)) };
    return { ok: true, session: rulesEvent(shuffled, seatId, `${seat.name} searches for ${found.name} with ${card.name}'s ${wanted.toLowerCase()}cycling and puts it into their hand.`) };
  }
  return { ok: true, session: drawForSeat(withEvent, seatId, `${seat.name} draws a card from cycling ${card.name}.`) };
}

// "Tap three untapped Zombies you control" — the weakest eligible creatures, so the best stay untapped. Undefined when there aren't enough.
// "Tap N untapped <things> you control" as a cost (Cryptbreaker's Zombies, Shimmer Dragon's and Whirler Rogue's artifacts, ...): artifacts/lands/enchantments need not be creatures,
// and being summoning sick never matters (it is not a {T} cost of the permanent itself).
export function canTapForCost(card: VisibleCard, subtype: string): boolean {
  const nonCreatureKind = /^(?:artifacts?|enchantments?|lands?|permanents?|planeswalkers?)$/i.test(subtype.trim());
  return !card.tapped && !card.phasedOut && (nonCreatureKind || card.typeLine.includes("Creature")) && permanentMatchesQualifier(card, subtype);
}

export function chooseCreaturesToTapForCost(seat: PlayerSeat, count: number, subtype: string): VisibleCard[] | undefined {
  const eligible = seat.board.battlefield
    .filter((card) => canTapForCost(card, subtype))
    .sort((a, b) => effectivePower(a) - effectivePower(b));
  return eligible.length >= count ? eligible.slice(0, count) : undefined;
}

// Sephara-style "pay {W} and tap four flyers": the cost and which creatures would be tapped, when that many untapped ones exist.
export function tapCreaturesAltCostFor(seat: PlayerSeat, card: VisibleCard): { costManaText: string; count: number; withKeyword?: string; creatureIds: string[] } | undefined {
  const alt = parseTapCreaturesAltCost(card.oracleText);
  if (!alt) return undefined;
  const creatures = seat.board.battlefield
    .filter((permanent) => permanent.typeLine.includes("Creature") && !permanent.tapped && !permanent.phasedOut && permanent.id !== card.id && (!alt.withKeyword || hasKeyword(permanent, alt.withKeyword)))
    .sort((a, b) => effectivePower(a) - effectivePower(b));
  return creatures.length >= alt.count ? { ...alt, creatureIds: creatures.map((permanent) => permanent.id) } : undefined;
}

// A fake card carrying a GenericManaAbility's raw cost text as its manaCost, so
// chooseManaSourcesForCost/manaRequirementForCost can pull the correct colored requirement out of
// it the same way they already do for a real card's casting cost — genericCostShim's plain numeric
// amount has no color information, which silently treated a colored activation cost (Greed's
// "{B}, Pay 2 life: Draw a card.") as free, since its digit-only mana-symbol sum found no digits.
// The cost of an ability with an {X} (Fiend Artisan) once X is chosen: {X} becomes that many generic mana (or nothing at 0).
export function abilityCostWithX(ability: SacrificeAbility, x: number): SacrificeAbility {
  return { ...ability, costManaText: ability.costManaText.replace(/{X}/gi, x > 0 ? `{${x}}` : "") };
}

// The X an {X} ability is activated with: the cheapest X that reaches the best creature card in the library the controller can afford, so
// no mana is paid for a card that cannot be fetched. Undefined when nothing can be fetched (no creature card at or below what is affordable).
export function chooseAbilityX(session: GameSession, seat: PlayerSeat, card: VisibleCard, ability: SacrificeAbility): number | undefined {
  if (!ability.costX) return 0;
  const creatureValues = (seat.library ?? []).filter((candidate) => candidate.typeLine.includes("Creature")).map((candidate) => candidate.manaValue);
  if (creatureValues.length === 0) return undefined;
  let maxX = -1;
  for (let x = 0; x <= 15; x += 1) {
    const paying = abilityCostWithX(ability, x);
    const total = manaValueFromManaCost(paying.costManaText);
    if (total > 0 && !chooseManaSourcesForCost(seat, genericManaAbilityCostShim(paying), total, card.id, session.seats).ok) break;
    maxX = x;
  }
  if (maxX < 0) return undefined;
  const reachable = creatureValues.filter((value) => value <= maxX);
  return reachable.length > 0 ? Math.max(...reachable) : undefined;
}

export function genericManaAbilityAffordable(seat: PlayerSeat, ability: GenericManaAbility, allSeats?: PlayerSeat[]): boolean {
  if (seat.life < ability.costLife) return false;
  const totalCost = manaValueFromManaCost(ability.costManaText);
  return totalCost === 0 || chooseManaSourcesForCost(seat, genericManaAbilityCostShim(ability), totalCost, undefined, allSeats).ok;
}
