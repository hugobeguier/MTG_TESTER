// Enter-the-battlefield and library-search resolution: aura attachment, chosen creature type / color, explore, saga chapters, Myriad
// Landscape and basic-land-fetch searches, cast-reveal-until.
// Extracted verbatim from components/AppFlow.tsx; AppFlow.tsx re-exports the previously public symbols.

import { chooseColorGapBasicLand, transformPermanent } from "@/engine/effects";
import { basicLandForColor } from "@/engine/mulligan";
import { basicLandTypes, capitalizeWord, hasHaste, isBasicLandCard, numberWordToInt } from "@/engine/shared";
import { commonTriggerEffect, resolveTriggerEffect } from "@/engine/triggers";
import { applyCounterDelta, applyLoreCounterEtb, moveCardBetweenVisibleZones, shuffleCards } from "@/engine/zones";
import { attachmentGrantsExtraBeginningPhase, enchantRestriction, isRemovalStyleAura } from "@/lib/attachments";
import { pickChosenColor, pickChosenCreatureType, type ManaColorLetter } from "@/lib/characteristics";
import { effectivePower, effectiveToughness } from "@/lib/counters";
import { basicLandFetchCostRequiresTap, isBasicLandFetchAbility, isSagaTransformChapter, parseGainsAbilityGrant, parseSagaChapters, type SagaChapters } from "@/lib/oracleClauses";
import { type GameSession, type PlayerSeat, type VisibleCard } from "@/lib/types";

export type AuraAttachResult =
  | { kind: "attach"; seatId: string; cardId: string }
  | { kind: "attach_player"; seatId: string }
  | { kind: "no_target" }
  | { kind: "unsupported" };

// No interactive targeting exists for Auras, so this picks a legal target deterministically:
// "Enchant creature you control" (or a positive/buff aura with an unrestricted "Enchant
// creature") targets the caster's own best creature; a removal-style aura (Pacifism, "can't
// attack or block") targets the best opposing creature instead.
export function chooseAuraAttachTarget(session: GameSession, casterSeatId: string, oracleText: string): AuraAttachResult {
  const restriction = enchantRestriction(oracleText);
  if (restriction === "player") {
    // Shadow of the Second Sun is the one printed "Enchant player" exception to the "always a
    // hoser, never self-targeted" assumption below — its extra untap/upkeep/draw is a benefit to
    // whoever it's on, so casting it on anyone but yourself would be pointless. Reported live: cast
    // on an opponent by the general "pick a target" logic below, the caster's own postcombat main
    // phase never matched hasExtraBeginningPhaseAura(session, activeSeat.id) (attachedToSeatId
    // pointed at the wrong seat), so the extra phase never fired for the player who actually wanted it.
    if (attachmentGrantsExtraBeginningPhase(oracleText)) return { kind: "attach_player", seatId: casterSeatId };
    // "Enchant player" (Overwhelming Splendor, the Curse cycle, ...) is overwhelmingly a hoser
    // aimed at an opponent rather than the caster's own player — so pick the opponent who looks
    // like the biggest threat (highest life total), mirroring chooseRemovalTarget's "biggest
    // threat" tie-break below.
    const opponents = session.seats.filter((seat) => seat.id !== casterSeatId && !seat.hasLost);
    if (opponents.length === 0) return { kind: "no_target" };
    const best = opponents.reduce((a, b) => (b.life > a.life ? b : a));
    return { kind: "attach_player", seatId: best.id };
  }
  if (restriction === undefined || restriction === "other" || restriction === "permanent") return { kind: "unsupported" };

  const targetOwn = restriction === "creature_you_control" || !isRemovalStyleAura(oracleText);
  const candidates: Array<{ seatId: string; card: VisibleCard }> = [];
  for (const seat of session.seats) {
    if (targetOwn ? seat.id !== casterSeatId : seat.id === casterSeatId) continue;
    for (const card of seat.board.battlefield) {
      if (card.typeLine.includes("Creature")) candidates.push({ seatId: seat.id, card });
    }
  }
  if (candidates.length === 0) return { kind: "no_target" };

  const best = candidates.reduce((a, b) =>
    effectivePower(b.card) + effectiveToughness(b.card) > effectivePower(a.card) + effectiveToughness(a.card) ? b : a
  );
  return { kind: "attach", seatId: best.seatId, cardId: best.card.id };
}

// Continuous effects (Aura attachments, Equip) are stamped with a monotonic counter, not
// wall-clock time, so layer 7b can deterministically pick "the newest one" when more than one
// "set base power/toughness" effect ends up on the same creature.
export function nextTimestamp(session: GameSession): { timestamp: number; session: GameSession } {
  const timestamp = session.effectTimestampCounter ?? 0;
  return { timestamp, session: { ...session, effectTimestampCounter: timestamp + 1 } };
}

export function applyAuraAttachment(session: GameSession, casterSeatId: string, auraCardId: string, targetSeatId: string, targetCardId: string): GameSession {
  const { timestamp, session: stampedSession } = nextTimestamp(session);
  return {
    ...stampedSession,
    seats: stampedSession.seats.map((seat) =>
      seat.id === casterSeatId
        ? {
            ...seat,
            board: {
              ...seat.board,
              battlefield: seat.board.battlefield.map((card) => (card.id === auraCardId ? { ...card, attachedToId: targetCardId, attachTimestamp: timestamp } : card))
            }
          }
        : seat
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: casterSeatId,
        message: `${session.seats.find((seat) => seat.id === casterSeatId)?.board.battlefield.find((card) => card.id === auraCardId)?.name ?? "Aura"} attaches to ${
          session.seats.find((seat) => seat.id === targetSeatId)?.board.battlefield.find((card) => card.id === targetCardId)?.name ?? "a creature"
        }.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

export function applyAuraAttachToPlayer(session: GameSession, casterSeatId: string, auraCardId: string, targetSeatId: string): GameSession {
  const { timestamp, session: stampedSession } = nextTimestamp(session);
  return {
    ...stampedSession,
    seats: stampedSession.seats.map((seat) =>
      seat.id === casterSeatId
        ? {
            ...seat,
            board: {
              ...seat.board,
              battlefield: seat.board.battlefield.map((card) =>
                card.id === auraCardId ? { ...card, attachedToSeatId: targetSeatId, attachTimestamp: timestamp } : card
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
        message: `${session.seats.find((seat) => seat.id === casterSeatId)?.board.battlefield.find((card) => card.id === auraCardId)?.name ?? "Aura"} attaches to ${
          session.seats.find((seat) => seat.id === targetSeatId)?.name ?? "a player"
        }.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

// Rule 500.7: "Take an extra turn after this one." (Temporal Mastery, Time Warp, Nexus of Fate,
// ...) — matched narrowly to this exact, extremely consistent real-card phrasing, same "only the
// well-templated shape, no guessing" boundary as the rest of this file's deterministic parsers.
// "Untap all lands you control. You get an emblem..."-style variants with additional clauses on the
// same card (Karn's Temporal Sundering, Time Walk's "you may play an additional land"-adjacent
// text) still match here for the extra-turn half — this only ever grants the turn, not any other
// clause bundled onto the same spell, since those are handled by their own respective parsers.
export function grantsExtraTurn(oracleText: string): boolean {
  return /\btake an extra turn after this one\b/i.test(oracleText);
}

export function entersWithXCounters(oracleText: string): boolean {
  return /\benters?(?: the battlefield)? with x \+1\/\+1 counters? on (?:it|this (?:creature|artifact|permanent))\b/i.test(oracleText);
}

// "This artifact enters with a charge counter on it for each time it was kicked." (Everflowing
// Chalice, and the rest of the multikicker-charge-counter cycle) — without this, a multikicker
// artifact that only ever tracks +1/+1 counters (entersWithXCounters, creature-only) never got its
// charge counters at all, so its own "add {C} for each charge counter" ability always produced
// nothing, kicked or not — the actual bug reported: an agent paid {0} (never kicked, since nothing
// ever offered a reason to) and the game never even understood a kicked cast would have done
// anything different.
export function entersWithChargeCounterPerKick(oracleText: string): boolean {
  return /\benters? (?:the battlefield )?with a charge counter on it for each time it was kicked\b/i.test(oracleText);
}

// The controller's full owned card pool for pickChosenCreatureType/pickChosenColor — prefers the
// deck list (so a tribal/mono-color-heavy deck picks its actual theme even before any copies have
// been drawn) and falls back to whatever visible zones exist when there's no deck record
// (synthetic/test sessions).
function controllerCardPool(seat: PlayerSeat): Array<{ typeLine: string; manaCost?: string }> {
  const deckCards = seat.deck?.cards.flatMap((entry) => (entry.card ? [entry.card] : [])) ?? [];
  if (deckCards.length > 0) return deckCards;
  return [...seat.board.hand, ...seat.board.battlefield, ...(seat.board.graveyard ?? []), ...(seat.library ?? [])];
}

export function applyChosenCreatureType(session: GameSession, seatId: string, cardId: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const permanent = seat?.board.battlefield.find((card) => card.id === cardId);
  if (!seat || !permanent || permanent.chosenCreatureType) return session;
  const chosenType = pickChosenCreatureType(controllerCardPool(seat));
  if (!chosenType) return session;
  return {
    ...session,
    seats: session.seats.map((item) =>
      item.id === seatId
        ? { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === cardId ? { ...card, chosenCreatureType: chosenType } : card)) } }
        : item
    )
  };
}

export function applyChosenColor(session: GameSession, seatId: string, cardId: string, excludedColor: ManaColorLetter | undefined): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const permanent = seat?.board.battlefield.find((card) => card.id === cardId);
  if (!seat || !permanent || permanent.chosenColor) return session;
  const chosenColor = pickChosenColor(controllerCardPool(seat), excludedColor);
  if (!chosenColor) return session;
  return {
    ...session,
    seats: session.seats.map((item) =>
      item.id === seatId
        ? { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === cardId ? { ...card, chosenColor } : card)) } }
        : item
    )
  };
}

// Only matches the self-referential "When this creature enters, it explores" phrasing (Jadelight
// Spelunker-style) — explore triggered by other conditions (combat, gaining life, ...) isn't
// covered, since this engine has no generic "whenever X, do Y" trigger-condition system yet.
export function exploreCount(oracleText: string): number | undefined {
  const match = oracleText.toLowerCase().match(/when(?:ever)? this creature enters,?\s+(?:it\s+)?explores?(?:\s+(x|\d+|one|two|three)\s+times?)?/);
  if (!match) return undefined;
  return numberWordToInt(match[1]) ?? 1;
}

// "Reveal the top card of your library. Put that card into your hand if it's a land. Otherwise,
// put a +1/+1 counter on this creature, then put the card back or put it into your graveyard."
// With no choice UI, defaults to keeping a non-land card on top rather than milling it.
export function resolveExplore(session: GameSession, seatId: string, cardId: string, times: number): GameSession {
  let next = session;
  for (let iteration = 0; iteration < times; iteration += 1) {
    const seat = next.seats.find((item) => item.id === seatId);
    const topCard = seat?.library?.[0];
    if (!seat || !topCard) break;
    const isLand = topCard.typeLine.includes("Land");
    next = {
      ...next,
      seats: next.seats.map((item) => {
        if (item.id !== seatId) return item;
        if (isLand) {
          return {
            ...item,
            library: (item.library ?? []).slice(1),
            board: { ...item.board, hand: [...item.board.hand, { ...topCard, zone: "hand" as const }] },
            zones: { ...item.zones, hand: item.zones.hand + 1, library: Math.max(0, item.zones.library - 1) }
          };
        }
        return {
          ...item,
          board: {
            ...item.board,
            battlefield: item.board.battlefield.map((card) => (card.id === cardId ? applyCounterDelta(card, "+1/+1", 1) : card))
          }
        };
      }),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: isLand
            ? `${seat.name} explores: reveals ${topCard.name}, a land, and puts it into hand.`
            : `${seat.name} explores: reveals ${topCard.name}, not a land, puts a +1/+1 counter on it, and keeps ${topCard.name} on top.`,
          detail: "Rules action"
        },
        ...next.events
      ]
    };
  }
  return next;
}

export function resolveMyriadLandscapeSearch(session: GameSession, seatId: string, cardId: string, chosenCardIds: string[]): GameSession {
  let sourceName = "";
  let foundNames: string[] = [];
  // For the landfall watchers (Avenger of Zendikar, ...) and Mazirek-style sacrifice watchers: the lands that entered and the sacrificed source.
  let enteredLands: VisibleCard[] = [];
  let sacrificedSource: VisibleCard | undefined;

  const seats = session.seats.map((seat) => {
    if (seat.id !== seatId) return seat;
    const source = seat.board.battlefield.find((card) => card.id === cardId);
    if (!source || source.name !== "Myriad Landscape") return seat;

    sourceName = source.name;
    const library = seat.library ?? [];
    const chosenIdSet = new Set(chosenCardIds.slice(0, 2));
    const chosen = library.filter((card) => chosenIdSet.has(card.id) && isBasicLandCard(card));
    const sharedTypes = sharedBasicLandTypes(chosen);
    const found = chosen.length > 0 && sharedTypes.length > 0 ? chosen.slice(0, 2) : [];
    foundNames = found.map((card) => card.name);
    const foundIds = new Set(found.map((card) => card.id));
    const graveyard = seat.board.graveyard ?? [];
    enteredLands = found.map((card) => ({ ...card, zone: "battlefield" as const, tapped: true, battlefieldPosition: undefined, enteredFrom: "library" as const }));
    sacrificedSource = source;

    return {
      ...seat,
      // "... then shuffle."
      library: shuffleCards(library.filter((card) => !foundIds.has(card.id))),
      board: {
        ...seat.board,
        battlefield: [
          ...seat.board.battlefield.filter((card) => card.id !== cardId),
          ...found.map((card) => ({
            ...card,
            zone: "battlefield" as const,
            tapped: true,
            battlefieldPosition: undefined,
            enteredFrom: "library" as const
          }))
        ],
        graveyard: [
          ...graveyard,
          {
            ...source,
            zone: "graveyard" as const,
            tapped: false,
            battlefieldPosition: undefined
          }
        ]
      },
      zones: {
        ...seat.zones,
        battlefield: seat.zones.battlefield - 1 + found.length,
        graveyard: seat.zones.graveyard + 1,
        library: Math.max(0, seat.zones.library - found.length)
      }
    };
  });

  if (!sourceName) return session;

  const seatName = session.seats.find((seat) => seat.id === seatId)?.name ?? "Player";
  const detail = foundNames.length > 0 ? ` Finds ${foundNames.join(", ")}. They enter tapped.` : " No basic lands were found.";
  return {
    ...session,
    seats,
    pendingEntries: enteredLands.length > 0 ? [...(session.pendingEntries ?? []), ...enteredLands.map((card) => ({ seatId, card }))] : session.pendingEntries,
    pendingDeaths: sacrificedSource ? [...(session.pendingDeaths ?? []), { seatId, card: sacrificedSource, sacrificed: true }] : session.pendingDeaths,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${seatName} sacrifices ${sourceName} and searches for up to two basic lands.${detail}`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

// Urza's Saga's chapter III ("Search your library for an artifact card with mana cost {0} or {1},
// put it onto the battlefield, then shuffle.") now flows through the generic search pipeline
// (deterministicRuleWorkflow's search_library_to_battlefield + manaValueRestriction, via
// triggerSagaChapter/consultRulesAdvisor) instead of this bespoke function — deleted along with it.

// "You may behold an Elf. If you do, untap that land." (Elven Passage) — the type word, or undefined for any other fetch.
export function basicLandFetchBeholdType(oracleText: string): string | undefined {
  const match = oracleText.match(/you may behold an? ([A-Za-z]+)\.\s*if you do, untap that land/i);
  return match ? capitalizeWord(match[1].toLowerCase()) : undefined;
}

// The cards in `hand` carrying one of the given types (creature types, land types, ...), never `excludeId`.
export function handCardsOfTypes(hand: VisibleCard[], types: string[], excludeId?: string): VisibleCard[] {
  return hand.filter((candidate) => candidate.id !== excludeId && types.some((type) => candidate.typeLine.includes(type)));
}

export function resolveBasicLandFetchSearch(session: GameSession, seatId: string, cardId: string, chosenCardId?: string): GameSession {
  let sourceName = "";
  let foundName = "";
  let lifePaid = 0;
  let beholdNote = "";
  let beholdPrompt: { cardId: string; cardName: string; revealTypes: string[] } | undefined;

  const seats = session.seats.map((seat) => {
    if (seat.id !== seatId) return seat;
    const source = seat.board.battlefield.find((card) => card.id === cardId);
    if (!source || !isBasicLandFetchAbility(source)) return seat;
    const requiresTap = basicLandFetchCostRequiresTap(source);
    if (requiresTap && source.tapped) return seat;
    if (requiresTap && source.typeLine.includes("Creature") && source.summoningSick && !hasHaste(source)) return seat;

    sourceName = source.name;
    // "{T}, Pay 1 life, Sacrifice this land: ..." (Elven Passage): the life is part of the cost.
    const lifeCost = Number(source.oracleText.split("\n").find((line) => /search your library for a basic land card/i.test(line))?.split(":")[0].match(/pay (\d+) life/i)?.[1] ?? 0);
    lifePaid = lifeCost;
    const library = seat.library ?? [];
    const chosen =
      (chosenCardId ? library.find((card) => card.id === chosenCardId && isBasicLandCard(card)) : undefined) ??
      chooseBestBasicLandForFetch(seat);
    // Behold: choosing a permanent you control of that type costs nothing; otherwise reveal one from hand (agents just do it, humans are asked).
    const beholdType = basicLandFetchBeholdType(source.oracleText);
    const controlsType = beholdType ? seat.board.battlefield.some((card) => card.id !== cardId && card.typeLine.includes(beholdType)) : false;
    const handBehold = beholdType ? handCardsOfTypes(seat.board.hand, [beholdType]) : [];
    const beholdNow = Boolean(chosen && beholdType && (controlsType || (handBehold.length > 0 && seat.kind !== "human")));
    if (chosen && beholdType && beholdNow) beholdNote = controlsType ? ` Beholds a ${beholdType} it controls, so the land is untapped.` : ` Reveals ${handBehold[0].name} from hand to behold a ${beholdType}, so the land is untapped.`;
    if (chosen && beholdType && !beholdNow && handBehold.length > 0 && seat.kind === "human") beholdPrompt = { cardId: chosen.id, cardName: chosen.name, revealTypes: [beholdType] };
    const graveyard = seat.board.graveyard ?? [];
    const sacrificedSource = {
      ...source,
      zone: "graveyard" as const,
      tapped: false,
      battlefieldPosition: undefined
    };

    if (!chosen) {
      return {
        ...seat,
        life: Math.max(0, seat.life - lifeCost),
        board: {
          ...seat.board,
          battlefield: seat.board.battlefield.filter((card) => card.id !== cardId),
          graveyard: [...graveyard, sacrificedSource]
        },
        zones: {
          ...seat.zones,
          battlefield: Math.max(0, seat.zones.battlefield - 1),
          graveyard: seat.zones.graveyard + 1
        }
      };
    }

    foundName = chosen.name;
    return {
      ...seat,
      life: Math.max(0, seat.life - lifeCost),
      library: shuffleCards(library.filter((card) => card.id !== chosen.id)),
      board: {
        ...seat.board,
        battlefield: [
          ...seat.board.battlefield.filter((card) => card.id !== cardId),
          {
            ...chosen,
            zone: "battlefield" as const,
            tapped: !beholdNow,
            battlefieldPosition: undefined,
            enteredFrom: "library" as const
          }
        ],
        graveyard: [...graveyard, sacrificedSource]
      },
      zones: {
        ...seat.zones,
        battlefield: seat.zones.battlefield,
        graveyard: seat.zones.graveyard + 1,
        library: Math.max(0, seat.zones.library - 1)
      }
    };
  });

  if (!sourceName) return session;

  const seatName = session.seats.find((seat) => seat.id === seatId)?.name ?? "Player";
  const detail = (foundName ? ` Finds ${foundName}, puts it onto the battlefield tapped, then shuffles.` : " No basic land was found.") + (lifePaid > 0 ? ` Pays ${lifePaid} life.` : "") + beholdNote;
  return {
    ...session,
    seats,
    ...(beholdPrompt ? { pendingShockChoices: [...(session.pendingShockChoices ?? []), { seatId, life: 0, ...beholdPrompt }] } : {}),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${seatName} sacrifices ${sourceName} and searches for a basic land.${detail}`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

function sharedBasicLandTypes(cards: VisibleCard[]) {
  if (cards.length === 0) return [];
  return basicLandTypes(cards[0]).filter((type) => cards.every((card) => basicLandTypes(card).includes(type)));
}

export function getMyriadLandscapeOptions(library: VisibleCard[]) {
  return library.filter((card) => isBasicLandCard(card) && basicLandTypes(card).length > 0);
}

export function getBasicLandFetchOptions(library: VisibleCard[]) {
  return library.filter(isBasicLandCard);
}

export function chooseBestBasicLandPairForMyriad(seat: PlayerSeat): VisibleCard[] {
  const options = getMyriadLandscapeOptions(seat.library ?? []);
  // Myriad Landscape's own "share a land type" restriction means only a type with at least two
  // copies actually sitting in the library can be fetched as a pair at all — narrowed to those
  // before the color-gap preference below runs, so it never picks a first land whose type has no
  // possible partner (which would make the pair search fail entirely for no reason).
  const seenOnce = new Set<string>();
  const pairableTypes = new Set<string>();
  for (const card of options) {
    for (const type of basicLandTypes(card)) {
      if (seenOnce.has(type)) pairableTypes.add(type);
      else seenOnce.add(type);
    }
  }
  const pairableOptions = options.filter((card) => basicLandTypes(card).some((type) => pairableTypes.has(type)));
  const first = chooseColorGapBasicLand(seat, pairableOptions);
  if (!first) return [];
  const firstTypes = basicLandTypes(first).filter((type) => pairableTypes.has(type));
  const second = pairableOptions.find((card) => card.id !== first.id && basicLandTypes(card).some((type) => firstTypes.includes(type)));
  return second ? [first, second] : [];
}

function chooseBestBasicLandForFetch(seat: PlayerSeat) {
  const basics = getBasicLandFetchOptions(seat.library ?? []);
  if (basics.length === 0) return undefined;
  const preferredNames = (seat.deck?.colors ?? seat.board.commander?.colorIdentity ?? [])
    .map((color) => basicLandForColor(color))
    .filter((name): name is string => Boolean(name));
  return basics.find((card) => preferredNames.includes(card.name)) ?? basics[0];
}

// Generalized from isUrzaSagaCard (card.name === "Urza's Saga") — see parseSagaChapters/
// advanceSagaLoreCounters, which now work for any real Saga instead of just that one.
export function isSagaCard(card: VisibleCard) {
  return card.typeLine.includes("Saga");
}

export function loreCounterCount(card: VisibleCard): number {
  return card.counters?.find((counter) => counter.kind === "lore")?.count ?? 0;
}

// Headless Saga support for the self-play simulator. The live game's version (applySagaEntryLoreCounter /
// advanceSagaLoreCounters / triggerSagaChapter, nested in the component) defers each chapter through window.setTimeout into
// React-bound queues; here a chapter resolves synchronously through the same pure pieces (grant text, transform, or
// commonTriggerEffect + resolveTriggerEffect). A chapter no deterministic parser owns does nothing (the live game would hand it
// to the rules advisor). Read ahead takes the last chapter, the live agent heuristic's default (chooseReadAheadChapter).
function sagaChapterHeadless(session: GameSession, seatId: string, saga: VisibleCard, chapterText: string): GameSession {
  const grantedAbility = parseGainsAbilityGrant(chapterText);
  if (grantedAbility) {
    return { ...session, seats: session.seats.map((seat) => (seat.id === seatId ? { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === saga.id ? { ...card, oracleText: `${card.oracleText}\n${grantedAbility}` } : card)) } } : seat)) };
  }
  if (isSagaTransformChapter(chapterText)) return transformPermanent(session, seatId, saga.id, saga.name, false);
  const effect = commonTriggerEffect(chapterText, "clause");
  if (!effect) return session;
  return resolveTriggerEffect(session, { id: crypto.randomUUID(), type: "trigger", actorSeatId: seatId, controllerSeatId: seatId, sourceCardId: saga.id, sourceCardName: saga.name, triggerKind: "common", effect, message: `${saga.name}'s chapter triggers.` });
}

function sagaLoreStepHeadless(session: GameSession, seatId: string, saga: VisibleCard, chapters: SagaChapters, newCount: number, counterSteps: number): GameSession {
  let next = session;
  for (let index = 0; index < counterSteps; index += 1) next = applyLoreCounterEtb(next, seatId, saga.id);
  const chapterText = chapters.effectByChapter.get(newCount);
  if (chapterText) next = sagaChapterHeadless(next, seatId, saga, chapterText);
  if (newCount >= chapters.chapterCount && chapters.sacrificesOnFinalChapter) next = moveCardBetweenVisibleZones(next, seatId, saga.id, "graveyard");
  return next;
}

// Chapter I as the Saga enters (only if it has no lore counter yet).
export function applySagaEntryLoreCounterHeadless(session: GameSession, seatId: string, cardId: string): GameSession {
  const saga = session.seats.find((seat) => seat.id === seatId)?.board.battlefield.find((card) => card.id === cardId);
  const chapters = saga && isSagaCard(saga) && loreCounterCount(saga) === 0 ? parseSagaChapters(saga.oracleText) : undefined;
  if (!saga || !chapters) return session;
  if (/^read ahead\b/im.test(saga.oracleText)) return sagaLoreStepHeadless(session, seatId, saga, chapters, chapters.chapterCount, chapters.chapterCount);
  return sagaLoreStepHeadless(session, seatId, saga, chapters, 1, 1);
}

// Each Saga the seat controls that is still short of its last chapter gains a counter (after the draw step).
export function advanceSagaLoreCountersHeadless(session: GameSession, seatId: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  let next = session;
  for (const saga of seat.board.battlefield.filter(isSagaCard)) {
    const chapters = parseSagaChapters(saga.oracleText);
    const count = loreCounterCount(saga);
    if (chapters && count < chapters.chapterCount) next = sagaLoreStepHeadless(next, seatId, saga, chapters, count + 1, 1);
  }
  return next;
}

// The agent's read-ahead pick: the sweeper chapter only when the opponents' boards are clearly bigger than its own; otherwise the
// last chapter (usually the payoff) right away.
export function chooseReadAheadChapter(session: GameSession, seatId: string, chapters: SagaChapters): number {
  const mine = session.seats.find((seat) => seat.id === seatId)?.board.battlefield.filter((card) => card.typeLine.includes("Creature")).length ?? 0;
  const theirs = session.seats.filter((seat) => seat.id !== seatId && !seat.hasLost).reduce((total, seat) => total + seat.board.battlefield.filter((card) => card.typeLine.includes("Creature")).length, 0);
  const firstText = chapters.effectByChapter.get(1) ?? "";
  if (/deals \d+ damage to each creature/i.test(firstText) && theirs >= mine * 2 + 2) return 1;
  return chapters.chapterCount;
}
