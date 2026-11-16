// Permanent-entry and cross-zone movement, moved verbatim from components/AppFlow.tsx (see docs/ARCHITECTURE.md section 6).
// Owns: applyEntryEffects, moveCardAcrossSeats(+Core), moveLibraryCardToDestination, returnLinkedExiles, applyGraveyardReturn(+Picked),
// destroyCreatures, and the devour / enters-with-counters wrappers. These sit in one call cycle with tokens.ts, stateBased.ts and
// triggers.ts; every cross-module reference is a function declaration used at call time, so the circular import is safe.

import { entersBattlefieldTapped } from "@/engine/lands";
import { createTokensForSeat, parseCreateTokenSpecs } from "@/engine/tokens";
import type { CrossSeatZone, GraveyardReturnOptions } from "@/engine/zones";
import { applyCounterDelta, applyEnterAsCopyOnEntry, applyEntersWithCounterKind, applyEntersWithCounterReplacementsCore, applyEntersWithXCounters, colorsAmongPermanentsControlled, destroyCreaturesCore, entersWithCounterPerColorControlled, entersWithFixedCounterKind, findExileInsteadOfDying, isPlaneswalkerCard, moveCardBetweenVisibleZones, queuePlayerChoice, resetForZoneChange, rulesEvent, withInitialLoyaltyCounters, withLeaveRecord } from "@/engine/zones";
import type { GameSession, VisibleCard } from "@/lib/types";

// Hangarback Walker/Walking Ballista-style permanents print base power/toughness "0/0" and rely
// entirely on their enters-with-X-counters clause. Counters are the single source of truth for
// +1/+1 bonuses (see src/lib/counters.ts's effectivePower/effectiveToughness) — every read site
// computes the bonus from here rather than having it baked into the printed power/toughness.
// Replacement effects on ANOTHER permanent's entry (rule 614.1c): "Each other Angel you control enters
// with an additional +1/+1 counter on it for each Angel you already control." (Giada, Font of Hope).
// Reads every permanent the controller already has for such a clause, and ADDS to whatever counters the
// entering permanent already got from its own text (unlike applyEntersWithXCounters, which sets them).
// Reported live as Giada not giving Metropolis Reformer a counter. Cast spells only — a token or a
// reanimated creature entering doesn't pass through here yet.
export function applyEntersWithCounterReplacements(session: GameSession, seatId: string, cardId: string): GameSession {
  const entered = session.seats.find((item) => item.id === seatId)?.board.battlefield.find((card) => card.id === cardId);
  const devour = entered?.oracleText.match(/\bdevour (\d+)\b/i);
  const devoured = entered && devour ? applyDevour(session, seatId, entered, Number.parseInt(devour[1], 10)) : session;
  return applyEntersWithCounterReplacementsCore(devoured, seatId, cardId);
}

// Devour N (Ribtruss Roaster): "As this creature enters, you may sacrifice any number of creatures. This creature enters with N +1/+1 counters on it for
// each creature sacrificed this way." An agent devours its creature TOKENS only (a token is worth less than the counters it buys; real cards stay);
// a human picks the creatures one at a time (a deferred prompt, "Done" ends it).
export function applyDevour(session: GameSession, seatId: string, devourer: VisibleCard, perCreature: number, picked: string[] = []): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  const fodder = seat.board.battlefield.filter((card) => card.id !== devourer.id && card.typeLine.includes("Creature") && !picked.includes(card.id));
  if (seat.kind === "human") {
    if (fodder.length === 0) return picked.length > 0 ? finishDevour(session, seatId, devourer, perCreature, picked) : session;
    return queuePlayerChoice(session, {
      seatId, sourceCardId: devourer.id, sourceCardName: devourer.name,
      prompt: `${devourer.name} (devour ${perCreature}): sacrifice which creatures? ${picked.length} chosen so far.`,
      options: [...fodder.map((card) => ({ label: `${card.name}${card.token ? " (token)" : ""} ${card.power ?? "?"}/${card.toughness ?? "?"}`, value: card.id })), { label: picked.length > 0 ? "Done" : "Sacrifice none", value: "done" }],
      resolver: "devour", data: { perCreature, picked }
    });
  }
  return finishDevour(session, seatId, devourer, perCreature, fodder.filter((card) => card.token).map((card) => card.id));
}

export function finishDevour(session: GameSession, seatId: string, devourer: VisibleCard, perCreature: number, ids: string[]): GameSession {
  if (ids.length === 0) return session;
  const seat = session.seats.find((item) => item.id === seatId);
  const names = (seat?.board.battlefield ?? []).filter((card) => ids.includes(card.id)).map((card) => card.name);
  const sacrificed = destroyCreatures(session, ids.map((id) => ({ seatId, cardId: id, message: `${seat?.name ?? "Player"} sacrifices ${(seat?.board.battlefield ?? []).find((card) => card.id === id)?.name ?? "a creature"} to devour (${devourer.name}).` })), "Rules action");
  const withCounters: GameSession = { ...sacrificed, seats: sacrificed.seats.map((item) => (item.id !== seatId ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === devourer.id ? applyCounterDelta(card, "+1/+1", ids.length * perCreature) : card)) } })) };
  return rulesEvent(withCounters, seatId, `${devourer.name} devours ${names.join(", ")} and enters with ${ids.length * perCreature} +1/+1 counter${ids.length * perCreature === 1 ? "" : "s"}.`);
}

// "Until this enchantment leaves the battlefield" exiles (Grasp of Fate): once the holder is gone, the card comes back under its owner's control.
export function returnLinkedExiles(session: GameSession): GameSession {
  const onBattlefield = new Set(session.seats.flatMap((seat) => seat.board.battlefield.map((card) => card.id)));
  let next = session;
  for (const seat of session.seats) {
    for (const card of seat.board.exile ?? []) {
      if (!card.exiledUntilSourceLeaves || onBattlefield.has(card.exiledUntilSourceLeaves)) continue;
      const ownerId = card.ownerSeatId ?? seat.id;
      const moved = moveCardAcrossSeats(next, seat.id, card.id, ownerId, "battlefield");
      if (!moved.movedCard) continue;
      next = {
        ...moved.session,
        seats: moved.session.seats.map((item) => (item.id === ownerId ? { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((entry) => (entry.id === card.id ? { ...entry, exiledUntilSourceLeaves: undefined } : entry)) } } : item))
      };
      next = rulesEvent(next, ownerId, `${card.name} returns to the battlefield.`);
    }
  }
  return next;
}

// "If a nontoken creature an opponent controls would die, instead exile that card and create a 2/2 black
// Zombie creature token." (Kalitas, Traitor of Ghet) — a replacement effect, so the creature never dies:
// no death triggers, it goes to exile, and the replacement's controller gets the token. Applied here at
// the single place every death path (combat, removal, sacrifice, state-based) funnels through.
export function destroyCreatures(
  session: GameSession,
  destructions: Array<{ seatId: string; cardId: string; message: string }>,
  detail: string = "Combat damage"
): GameSession {
  if (destructions.length === 0) return session;
  const replaced = destructions
    .map((entry) => ({ entry, replacement: findExileInsteadOfDying(session, entry.seatId, entry.cardId) }))
    .filter((item): item is { entry: (typeof destructions)[number]; replacement: NonNullable<ReturnType<typeof findExileInsteadOfDying>> } => item.replacement !== undefined);
  if (replaced.length === 0) return destroyCreaturesCore(session, destructions, detail);
  let working = session;
  for (const { entry, replacement } of replaced) {
    const dyingCard = working.seats.find((seat) => seat.id === entry.seatId)?.board.battlefield.find((card) => card.id === entry.cardId);
    working = moveCardBetweenVisibleZones(working, entry.seatId, entry.cardId, "exile");
    working = rulesEvent(working, replacement.sourceSeatId, `${replacement.sourceName} exiles ${dyingCard?.name ?? "the creature"} instead of it dying.`);
    const specs = parseCreateTokenSpecs(replacement.tokenClause);
    if (specs.length > 0) working = createTokensForSeat(working, replacement.sourceSeatId, replacement.sourceId, specs).session;
  }
  const replacedIds = new Set(replaced.map((item) => item.entry.cardId));
  const remaining = destructions.filter((entry) => !replacedIds.has(entry.cardId));
  return remaining.length > 0 ? destroyCreaturesCore(working, remaining, detail) : working;
}

// The generic zone-mover moveCardBetweenVisibleZones (further below) is hard-locked to a single
// seat — it can only shuffle a card between that SAME seat's own zones. Reanimation, mill,
// graveyard recursion, and steal-a-card-from-a-library effects all need to move a card from one
// player's zone into a DIFFERENT player's zone (or the same player's, which this also handles).
// Always a full "new object" reset (rule 400.7), since this is always an actual zone change —
// contrast with changeControlWithinBattlefield below, which is NOT a zone change and must NOT
// reset the object.
export function moveCardAcrossSeats(
  session: GameSession,
  sourceSeatId: string,
  cardId: string,
  destinationSeatId: string,
  destinationZone: CrossSeatZone,
  options: { tapped?: boolean; libraryPosition?: "top" | "bottom" } = {}
): { session: GameSession; movedCard?: VisibleCard } {
  const result = moveCardAcrossSeatsCore(session, sourceSeatId, cardId, destinationSeatId, destinationZone, options);
  return { ...result, session: withLeaveRecord(session, result.session, sourceSeatId, cardId, destinationZone === "graveyard") };
}

function moveCardAcrossSeatsCore(
  session: GameSession,
  sourceSeatId: string,
  cardId: string,
  destinationSeatId: string,
  destinationZone: CrossSeatZone,
  options: { tapped?: boolean; libraryPosition?: "top" | "bottom" } = {}
): { session: GameSession; movedCard?: VisibleCard } {
  const sourceSeat = session.seats.find((seat) => seat.id === sourceSeatId);
  if (!sourceSeat) return { session };
  const handCard = sourceSeat.board.hand.find((card) => card.id === cardId);
  const battlefieldCard = sourceSeat.board.battlefield.find((card) => card.id === cardId);
  const graveyardCard = (sourceSeat.board.graveyard ?? []).find((card) => card.id === cardId);
  const exileCard = (sourceSeat.board.exile ?? []).find((card) => card.id === cardId);
  const libraryCard = (sourceSeat.library ?? []).find((card) => card.id === cardId);
  const card = handCard ?? battlefieldCard ?? graveyardCard ?? exileCard ?? libraryCard;
  if (!card) return { session };
  const sourceZone: CrossSeatZone = handCard ? "hand" : battlefieldCard ? "battlefield" : graveyardCard ? "graveyard" : exileCard ? "exile" : "library";

  // Rule 903.9: "If a commander would be put into its owner's hand or library from anywhere, that
  // player may put it into the command zone instead." The graveyard/exile half of this same
  // replacement effect is already handled in moveCardBetweenVisibleZones; this covers the other
  // half (bounce/tuck), which this function is the actual path for — reproduced live via
  // applyRemovalEffect's "bounce" case calling this with destinationZone "hand": without this, an
  // opponent's Boomerang-style bounce spell against a commander just put it in hand permanently,
  // with no way back to the command zone, unlike every other zone it could have left from. No
  // choice UI exists for the "may" here, so — matching the graveyard/exile precedent, which also
  // redirects unconditionally rather than asking — this always takes the redirect, since sitting in
  // the command zone (recastable, if pricier each time) is essentially always better for a
  // Commander deck's commander than sitting in a 99-card library or a hand it can be discarded from.
  if (card.commander && sourceZone === "battlefield" && (destinationZone === "hand" || destinationZone === "library")) {
    const ownerSeatId = card.ownerSeatId ?? sourceSeatId;
    const commanderTax = card.commanderTax ?? 0; // tax rises on CAST (903.8), not on moving to the command zone
    const seats = session.seats.map((seat) => {
      if (seat.id === sourceSeatId && seat.id === ownerSeatId) {
        return {
          ...seat,
          board: {
            ...seat.board,
            commander: { ...card, zone: "command" as const, tapped: false, attacking: false, blocking: false, battlefieldPosition: undefined, commanderTax },
            battlefield: seat.board.battlefield.filter((item) => item.id !== cardId)
          },
          zones: { ...seat.zones, battlefield: Math.max(0, seat.zones.battlefield - 1), command: seat.zones.command + 1 }
        };
      }
      if (seat.id === sourceSeatId) {
        return { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.filter((item) => item.id !== cardId) }, zones: { ...seat.zones, battlefield: Math.max(0, seat.zones.battlefield - 1) } };
      }
      if (seat.id === ownerSeatId) {
        return {
          ...seat,
          board: { ...seat.board, commander: { ...card, zone: "command" as const, tapped: false, attacking: false, blocking: false, battlefieldPosition: undefined, commanderTax } },
          zones: { ...seat.zones, command: seat.zones.command + 1 }
        };
      }
      return seat;
    });
    // Every caller of this function adds its own "moved to hand/library" event after the fact
    // (this function itself never touches session.events) — without logging the redirect here too,
    // e.g. bounce's own "returns ~ to its owner's hand" message would be left standing as the only,
    // now-inaccurate, description of what actually happened.
    const ownerName = session.seats.find((seat) => seat.id === ownerSeatId)?.name ?? "its owner";
    return {
      session: {
        ...session,
        seats,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: ownerSeatId,
            message: `${card.name} returns to ${ownerName}'s command zone instead. Commander tax is now +${commanderTax}.`,
            detail: "Rules action"
          },
          ...session.events
        ]
      },
      movedCard: { ...card, zone: "command", commanderTax }
    };
  }

  // The card's true owner never changes just because it changes zones or controllers — preserve
  // whatever it already was (falling back to the seat it's currently leaving, for a card that's
  // never changed hands before).
  const ownerSeatId = card.ownerSeatId ?? sourceSeatId;
  const movedCard: VisibleCard = {
    ...resetForZoneChange(card, destinationZone),
    ownerSeatId,
    // Tapped lands (shock/check/"unless") enter tapped on every path, not only when the caller remembered to ask.
    tapped: destinationZone === "battlefield" ? Boolean(options.tapped) || entersBattlefieldTapped(card, session.seats.find((seat) => seat.id === destinationSeatId), session.seats) : false,
    summoningSick: destinationZone === "battlefield" ? card.typeLine.includes("Creature") : undefined,
    enteredTurn: destinationZone === "battlefield" ? session.turn : undefined,
    // Where it came from (Twilight Diviner's "entered from a graveyard"): reanimation, Meren's end step, flicker (exile) and bounce replays all pass here.
    enteredFrom: destinationZone === "battlefield" ? sourceZone : undefined,
    counters: destinationZone === "battlefield" && isPlaneswalkerCard(card) ? withInitialLoyaltyCounters(card) : undefined
  };

  const seatsAfterRemoval = session.seats.map((seat) => {
    if (seat.id !== sourceSeatId) return seat;
    return {
      ...seat,
      board: {
        ...seat.board,
        hand: sourceZone === "hand" ? seat.board.hand.filter((c) => c.id !== cardId) : seat.board.hand,
        battlefield: sourceZone === "battlefield" ? seat.board.battlefield.filter((c) => c.id !== cardId) : seat.board.battlefield,
        graveyard: sourceZone === "graveyard" ? (seat.board.graveyard ?? []).filter((c) => c.id !== cardId) : seat.board.graveyard,
        exile: sourceZone === "exile" ? (seat.board.exile ?? []).filter((c) => c.id !== cardId) : seat.board.exile
      },
      library: sourceZone === "library" ? (seat.library ?? []).filter((c) => c.id !== cardId) : seat.library,
      zones: {
        ...seat.zones,
        hand: seat.zones.hand - (sourceZone === "hand" ? 1 : 0),
        battlefield: seat.zones.battlefield - (sourceZone === "battlefield" ? 1 : 0),
        graveyard: seat.zones.graveyard - (sourceZone === "graveyard" ? 1 : 0),
        exile: seat.zones.exile - (sourceZone === "exile" ? 1 : 0),
        library: seat.zones.library - (sourceZone === "library" ? 1 : 0)
      }
    };
  });

  const seats = seatsAfterRemoval.map((seat) => {
    if (seat.id !== destinationSeatId) return seat;
    return {
      ...seat,
      board: {
        ...seat.board,
        hand: destinationZone === "hand" ? [...seat.board.hand, movedCard] : seat.board.hand,
        battlefield: destinationZone === "battlefield" ? [...seat.board.battlefield, movedCard] : seat.board.battlefield,
        graveyard: destinationZone === "graveyard" ? [...(seat.board.graveyard ?? []), movedCard] : seat.board.graveyard,
        exile: destinationZone === "exile" ? [...(seat.board.exile ?? []), movedCard] : seat.board.exile
      },
      library:
        destinationZone === "library"
          ? options.libraryPosition === "bottom"
            ? [...(seat.library ?? []), movedCard]
            : [movedCard, ...(seat.library ?? [])]
          : seat.library,
      zones: {
        ...seat.zones,
        hand: seat.zones.hand + (destinationZone === "hand" ? 1 : 0),
        battlefield: seat.zones.battlefield + (destinationZone === "battlefield" ? 1 : 0),
        graveyard: seat.zones.graveyard + (destinationZone === "graveyard" ? 1 : 0),
        exile: seat.zones.exile + (destinationZone === "exile" ? 1 : 0),
        library: seat.zones.library + (destinationZone === "library" ? 1 : 0)
      }
    };
  });

  const pendingEntries =
    destinationZone === "battlefield"
      ? [...(session.pendingEntries ?? []), { seatId: destinationSeatId, card: movedCard }]
      : session.pendingEntries;
  // "Whenever one or more cards leave your graveyard, ..." (Willow Geist, Insidious Roots) — the
  // departure belongs to sourceSeatId (the graveyard's owner), NOT destinationSeatId — an opponent's
  // Reanimate pulling a creature out of YOUR graveyard triggers YOUR Willow Geist, not theirs.
  const pendingGraveyardDepartures =
    sourceZone === "graveyard"
      ? [...(session.pendingGraveyardDepartures ?? []), { seatId: sourceSeatId, cards: [card] }]
      : session.pendingGraveyardDepartures;
  const moved: GameSession = { ...session, seats, pendingEntries, pendingGraveyardDepartures };
  return { session: destinationZone === "battlefield" ? applyEntryEffects(moved, destinationSeatId, movedCard.id) : moved, movedCard };
}

// The shared "a permanent enters the battlefield" step for every path that is NOT a cast (reanimate, flicker,
// return from exile, tutor-to-battlefield, copy tokens): the self "enters with N counters" clauses and the
// other permanents' "enters with an additional +1/+1 counter" replacements (Dragonstorm Globe, Giada).
// X counters are deliberately absent: X is 0 for anything not cast (Hangarback Walker flickered really does die).
// The cast path applies the same pieces inline in resolution (see applyEntersWithCounterReplacements's caller).
export function applyEntryEffects(session: GameSession, seatId: string, cardId: string): GameSession {
  const entering = session.seats.find((seat) => seat.id === seatId)?.board.battlefield.find((card) => card.id === cardId);
  if (!entering) return session;
  let next = session;
  const fixed = entersWithFixedCounterKind(entering.oracleText);
  if (fixed && !(entering.counters ?? []).some((counter) => counter.kind === fixed.kind)) next = applyEntersWithCounterKind(next, seatId, cardId, fixed.kind, fixed.count);
  if (entersWithCounterPerColorControlled(entering.oracleText)) {
    const seat = next.seats.find((item) => item.id === seatId);
    if (seat) next = applyEntersWithXCounters(next, seatId, cardId, colorsAmongPermanentsControlled(seat, cardId));
  }
  return applyEntersWithCounterReplacements(applyEnterAsCopyOnEntry(next, seatId, cardId), seatId, cardId);
}

export function applyGraveyardReturnPicked(session: GameSession, seatId: string, source: { id: string; name: string }, options: GraveyardReturnOptions, ids: string[]): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  let next = session;
  for (const id of ids) {
    const card = (next.seats.find((item) => item.id === seatId)?.board.graveyard ?? []).find((entry) => entry.id === id);
    if (!card) continue;
    next = rulesEvent(moveCardAcrossSeats(next, seatId, id, seatId, options.destination, { tapped: options.tapped }).session, seatId, `${source.name}: ${seat.name} returns ${card.name} from the graveyard to ${options.destination === "hand" ? "their hand" : "the battlefield"}.`);
  }
  return ids.length === 0 ? rulesEvent(next, seatId, `${source.name}: no card is returned from the graveyard.`) : next;
}

export function applyGraveyardReturn(session: GameSession, seatId: string, source: { id: string; name: string }, options: GraveyardReturnOptions, picked: string[] = []): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  const qualifies = (card: VisibleCard) =>
    card.id !== options.excludeCardId &&
    !picked.includes(card.id) &&
    (options.typeFilter === "creature" ? card.typeLine.includes("Creature") : !/Instant|Sorcery/.test(card.typeLine)) &&
    (options.maxManaValue === undefined || card.manaValue <= options.maxManaValue);
  const candidates = (seat.board.graveyard ?? []).filter(qualifies).sort((a, b) => b.manaValue - a.manaValue);
  const remaining = options.count - picked.length;
  const finish = (ids: string[]) => applyGraveyardReturnPicked(session, seatId, source, options, ids);
  if (remaining <= 0 || candidates.length === 0) return finish(picked);
  if (seat.kind !== "human") return finish([...picked, ...candidates.slice(0, remaining).map((card) => card.id)]);
  // Only one card could be taken and the human has nothing to choose between: still ask, because every one of these is a "may / up to".
  return queuePlayerChoice(session, {
    seatId,
    sourceCardId: source.id,
    sourceCardName: source.name,
    prompt: `${source.name}: choose ${picked.length > 0 ? "another " : "a "}${options.typeFilter} card in your graveyard to return to ${options.destination === "hand" ? "your hand" : "the battlefield"}${options.maxManaValue !== undefined ? ` (mana value ${options.maxManaValue} or less)` : ""}.`,
    options: [...candidates.map((card) => ({ label: `${card.name} (mana value ${card.manaValue})`, value: card.id })), { label: picked.length > 0 ? "Done" : "Don't return a card", value: "none" }],
    resolver: "graveyard_return",
    data: { options, picked }
  });
}

export function moveLibraryCardToDestination(
  session: GameSession,
  seatId: string,
  cardId: string,
  destination: "hand" | "battlefield" | "graveyard" | "library",
  tapped: boolean,
  // "Search your library for a Dragon creature card, reveal it, put it into your hand" (Sarkhan's Triumph, most tutors): the card
  // is shown to the table, so the log (every player's view of an opponent's search) names it as REVEALED and says where it went.
  reveal = false
): GameSession {
  let movedName = "";
  let enteredBattlefieldCard: VisibleCard | undefined;
  const seats = session.seats.map((seat) => {
    if (seat.id !== seatId) return seat;
    const library = seat.library ?? [];
    const card = library.find((item) => item.id === cardId);
    if (!card) return seat;
    movedName = card.name;
    const remainingLibrary = library.filter((item) => item.id !== cardId);
    const movedCard: VisibleCard = {
      ...card,
      zone: destination === "library" ? "library" : destination,
      tapped: destination === "battlefield" ? tapped || entersBattlefieldTapped(card, seat, session.seats) : card.tapped,
      summoningSick: destination === "battlefield" && card.typeLine.includes("Creature") ? true : card.summoningSick,
      enteredFrom: destination === "battlefield" ? ("library" as const) : card.enteredFrom,
      // Same stamp every other entry path sets (moveCardAcrossSeats): "entered this turn" checks (Zurgo, landfall-style conditions) read it.
      enteredTurn: destination === "battlefield" ? session.turn : card.enteredTurn
    };
    if (destination === "battlefield") enteredBattlefieldCard = movedCard;

    // "library" (a tutor putting the found card on top instead of into hand/battlefield/graveyard,
    // e.g. Mystical Tutor, Enlightened Tutor, Moon-Blessed Cleric) never leaves the library zone, so
    // it goes back on top of remainingLibrary instead of into a board zone, and the library count
    // doesn't change.
    if (destination === "library") {
      return { ...seat, library: [movedCard, ...remainingLibrary] };
    }

    return {
      ...seat,
      library: remainingLibrary,
      board: {
        ...seat.board,
        hand: destination === "hand" ? [...seat.board.hand, movedCard] : seat.board.hand,
        battlefield: destination === "battlefield" ? [...seat.board.battlefield, movedCard] : seat.board.battlefield,
        graveyard: destination === "graveyard" ? [...(seat.board.graveyard ?? []), movedCard] : seat.board.graveyard
      },
      zones: {
        ...seat.zones,
        hand: seat.zones.hand + (destination === "hand" ? 1 : 0),
        battlefield: seat.zones.battlefield + (destination === "battlefield" ? 1 : 0),
        graveyard: seat.zones.graveyard + (destination === "graveyard" ? 1 : 0),
        library: Math.max(0, seat.zones.library - 1)
      }
    };
  });

  if (!movedName) return session;
  const searched: GameSession = {
    ...session,
    seats,
    pendingEntries: enteredBattlefieldCard ? [...(session.pendingEntries ?? []), { seatId, card: enteredBattlefieldCard }] : session.pendingEntries,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message:
          destination === "library"
            ? `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} searches their library for ${movedName} and puts it on top.`
            : `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} searches their library for ${movedName}${reveal ? `, reveals ${movedName},` : ""} and puts it ${destination === "graveyard" || destination === "hand" ? "into" : "onto"} ${destination === "hand" ? "their hand" : `the ${destination}`}.`
      },
      ...session.events
    ]
  };
  // Same shared entry step as every other non-cast entry (counters, Dragonstorm Globe/Giada).
  return enteredBattlefieldCard ? applyEntryEffects(searched, seatId, enteredBattlefieldCard.id) : searched;
}
