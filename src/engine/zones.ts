// Zone-movement and permanent-entry helpers, extracted verbatim from components/AppFlow.tsx (see docs/ARCHITECTURE.md section 5).
// Owns: finding a permanent / exiled card, the rules-event log helper, queuePlayerChoice, resetting a card for a zone change,
// battlefield<->graveyard/exile/library/hand moves (moveCardBetweenVisibleZones, destroyCreaturesCore, moveCommanderToCommandZone,
// changeControlWithinBattlefield, library/graveyard moves), counter deltas and "enters with N counters" replacements,
// and enter-as-copy resolution.
// NOT here (blocked by a cycle through devour -> destroyCreatures -> createTokensForSeat -> state-based actions / triggers):
// applyEntryEffects, moveCardAcrossSeats(+Core), moveLibraryCardToDestination, applyEntersWithCounterReplacements (devour wrapper),
// applyDevour/finishDevour, destroyCreatures, returnLinkedExiles, applyGraveyardReturn(+Picked) - they still live in AppFlow.tsx.
// AppFlow.tsx re-exports the previously public symbols so existing importers keep working.

import type { GameEvent, GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import { effectivePower, effectiveToughness } from "@/lib/counters";
import { hasGraveyardShuffleReplacement, parseEntersWithCounterReplacements, parseExileInsteadOfDyingReplacement } from "@/lib/oracleClauses";
import { numberWordToInt } from "@/engine/shared";
import { countMatchingPermanents, permanentMatchesQualifier } from "@/lib/characteristics";

export function applyCounterDelta(card: VisibleCard, kind: string, delta: number): VisibleCard {
  const counters = card.counters ?? [];
  const existing = counters.find((counter) => counter.kind === kind);
  const nextCount = Math.max(0, (existing?.count ?? 0) + delta);
  const nextCounters =
    nextCount === 0
      ? counters.filter((counter) => counter.kind !== kind)
      : existing
        ? counters.map((counter) => (counter.kind === kind ? { ...counter, count: nextCount } : counter))
        : [...counters, { kind, count: nextCount }];
  return { ...card, counters: nextCounters };
}

export function applyLoreCounterEtb(session: GameSession, seatId: string, cardId: string): GameSession {
  return {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === seatId
        ? { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === cardId ? applyCounterDelta(card, "lore", 1) : card)) } }
        : seat
    )
  };
}

// Same session-level wrapper shape as applyLoreCounterEtb just above, generalized to any counter
// kind/amount on any one battlefield permanent — used by applyPrimitiveAction's put_counters case
// rather than duplicating this map-over-battlefield pattern a third time.
export function applyCounterDeltaAtSession(session: GameSession, seatId: string, cardId: string, kind: string, delta: number): GameSession {
  return {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === seatId
        ? { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === cardId ? applyCounterDelta(card, kind, delta) : card)) } }
        : seat
    )
  };
}

export function isPlaneswalkerCard(card: VisibleCard) {
  return card.typeLine.includes("Planeswalker");
}

export function loyaltyCounterCount(card: VisibleCard) {
  return card.counters?.find((counter) => counter.kind === "loyalty")?.count ?? 0;
}

export function withInitialLoyaltyCounters(card: VisibleCard) {
  if (loyaltyCounterCount(card) > 0) return card.counters;
  const printed = Number.parseInt(card.loyalty ?? "", 10);
  if (!Number.isFinite(printed) || printed <= 0) return card.counters;
  return [...(card.counters ?? []), { kind: "loyalty", count: printed }];
}

// "This land enters [tapped] with N <kind> counter(s) on it." (Gemstone Mine's three mining
// counters, Dark Depths' ten ice counters, the Vivid land cycle's two charge counters, Tendo Ice
// Bridge's one charge counter, ...) — a FIXED, printed count (not the X-cost/per-kicked/per-color
// shapes above), previously entirely unmodeled: every "storage land" entered with zero counters, so
// its own "remove a counter: add mana" ability could never legally find one to remove. Excludes
// +1/+1 and -1/-1 (owned by entersWithXCounters/entersWithCounterPerColorControlled/multikicker's
// charge-counter case above, which have their own non-printed-count logic) to avoid double-handling
// the same clause two different ways. Two negative lookaheads guard against reading a qualified
// clause as if it were an unconditional flat count: "for each" (Everflowing Chalice's "a charge
// counter on it for each time it was kicked" — its literal "a ... counter" prefix would otherwise
// match here too, and — running after entersWithChargeCounterPerKick's own correct X-based
// placement in the ETB pipeline — silently clobber it back down to 1 regardless of kicks) and a
// trailing "if" condition (Myojin of Seeing Winds' "with a divinity counter on it IF you cast it
// from your hand," Indominus Rex, Alpha's "with a flying counter on it IF a card discarded this way
// has flying" — unconditionally placing either counter regardless of whether the real condition was
// met would be a genuine rules error, not just an approximation, so both are declined outright).
export function entersWithFixedCounterKind(oracleText: string): { kind: string; count: number } | undefined {
  const match = oracleText.match(/\benters?(?: the battlefield)?(?: tapped)? with (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) ([a-z]+) counters? on it\b(?! for each| if\b)/i);
  if (!match) return undefined;
  const count = numberWordToInt(match[1]);
  return count ? { kind: match[2].toLowerCase(), count } : undefined;
}

// "Ramos, Dragon Engine enters the battlefield with a +1/+1 counter on it for each color among
// permanents you control." — a fixed (not X-cost) ETB counter count driven by board state instead
// of anything the caster chose, so it's a separate check from entersWithXCounters above.
export function entersWithCounterPerColorControlled(oracleText: string): boolean {
  return /\benters?(?: the battlefield)? with an? \+1\/\+1 counter on it for each color among permanents you control\b/i.test(oracleText);
}

// Real ruling: Ramos doesn't count its own colors toward this — the replacement effect is
// calculated as it enters, based on what's already out, so the entering card's own id is excluded.
// seat.board.battlefield already includes the commander once it's actually in play (it only lives
// in the separate seat.board.commander slot while sitting in the command zone), so no separate
// commander lookup is needed here.
export function colorsAmongPermanentsControlled(seat: PlayerSeat, excludeCardId: string): number {
  const colors = new Set<string>();
  for (const permanent of seat.board.battlefield) {
    if (permanent.id === excludeCardId) continue;
    for (const color of permanent.colors ?? []) colors.add(color);
  }
  return colors.size;
}

export function applyEntersWithCounterKind(session: GameSession, seatId: string, cardId: string, kind: string, count: number): GameSession {
  if (count <= 0) return session;
  return {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === seatId
        ? {
            ...seat,
            board: {
              ...seat.board,
              battlefield: seat.board.battlefield.map((card) =>
                card.id === cardId ? { ...card, counters: [...(card.counters ?? []).filter((counter) => counter.kind !== kind), { kind, count }] } : card
              )
            }
          }
        : seat
    )
  };
}

export function applyEntersWithCounterReplacementsCore(session: GameSession, seatId: string, cardId: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const entering = seat?.board.battlefield.find((card) => card.id === cardId);
  if (!seat || !entering || !entering.typeLine.includes("Creature")) return session;
  const others = seat.board.battlefield.filter((card) => card.id !== cardId);
  let extra = 0;
  const sources: string[] = [];
  // Its OWN "enters with a +1/+1 counter on it for each Zombie card in your graveyard." (Diregraf Colossus).
  const selfGraveyardCounters = entering.oracleText.match(/enters with an? \+1\/\+1 counter on it for each ([A-Za-z]+) cards? in your graveyard/i);
  if (selfGraveyardCounters) {
    const count = countMatchingPermanents(seat.board.graveyard ?? [], selfGraveyardCounters[1].toLowerCase());
    if (count > 0) {
      extra += count;
      sources.push(entering.name);
    }
  }
  for (const source of others) {
    if ((source.abilitiesStripped || source.phasedOut)) continue;
    // Gorma, the Gullet: "Nontoken creatures you control enter with an additional +1/+1 counter on them for each creature that died under your
    // control this turn."
    if (!entering.token && /\bnontoken creatures you control enter with an additional \+1\/\+1 counter on them for each creature that died under your control this turn\b/i.test(source.oracleText)) {
      const died = session.creaturesDiedThisTurn?.turn === session.turn ? session.creaturesDiedThisTurn.bySeat[seatId] ?? 0 : 0;
      if (died > 0) {
        extra += died;
        sources.push(source.name);
      }
    }
    for (const replacement of parseEntersWithCounterReplacements(source.oracleText)) {
      if (!permanentMatchesQualifier(entering, replacement.matcher)) continue;
      if (replacement.requiresChosenType && (!source.chosenCreatureType || !entering.typeLine.includes(source.chosenCreatureType))) continue;
      const count = replacement.perAlreadyControlled ? countMatchingPermanents(others, replacement.perAlreadyControlled) : 1;
      if (count <= 0) continue;
      extra += count;
      sources.push(source.name);
    }
  }
  if (extra <= 0) return session;
  const existing = entering.counters?.find((counter) => counter.kind === "+1/+1")?.count ?? 0;
  return {
    ...session,
    seats: session.seats.map((item) =>
      item.id === seatId
        ? {
            ...item,
            board: {
              ...item.board,
              battlefield: item.board.battlefield.map((card) =>
                card.id === cardId ? { ...card, counters: [...(card.counters ?? []).filter((counter) => counter.kind !== "+1/+1"), { kind: "+1/+1", count: existing + extra }] } : card
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
        message: `${entering.name} enters with ${extra} additional +1/+1 counter${extra === 1 ? "" : "s"} (${sources.join(", ")}).`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

export function applyEntersWithXCounters(session: GameSession, seatId: string, cardId: string, x: number): GameSession {
  if (x <= 0) return session;
  return {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === seatId
        ? {
            ...seat,
            board: {
              ...seat.board,
              battlefield: seat.board.battlefield.map((card) =>
                card.id === cardId
                  ? {
                      ...card,
                      counters: [...(card.counters ?? []).filter((counter) => counter.kind !== "+1/+1"), { kind: "+1/+1", count: x }]
                    }
                  : card
              )
            }
          }
        : seat
    )
  };
}

// Same "You" quirk as seatVerb just above (PlayerSeat.name is literally "You" for the human seat),
// but for building a possessive mid-sentence instead of swapping the whole sentence — building
// `${seat.name}'s graveyard` reads as the ungrammatical "You's graveyard" for the human seat, since
// seatVerb's two-full-alternate-sentences shape doesn't fit a single inline phrase. Covers exactly
// the "long tail" of one-off messages seatVerb's own doc comment above already flags as not yet
// swept — reported live as "Meren of Clan Nel Toth returns Cankerbloom from You's graveyard...".
export function possessive(seat: { name: string }): string {
  return seat.name === "You" ? "your" : `${seat.name}'s`;
}

// "You may have this enchantment enter as a copy of an enchantment you control, except it has
// '...'." (Estrid's Invocation) — a replacement effect on ETB, applied directly in playCardFromZone
// rather than through the trigger/GenericAbilityEffect machinery those two functions feed (this
// isn't a triggered ability with an effect to resolve later; it replaces how the permanent enters in
// the first place).
//
// "You may have this enchantment enter as a copy of any artifact or enchantment on the battlefield."
// (Mirrormade) is the same replacement-effect shape but broader in two ways real oracle text
// actually varies on: ANY permanent on the battlefield, not just one you control, and artifacts as
// well as enchantments — reported live as "must be cast as a copy of another enchantment or artifact
// on the battlefield" not working at all, because this parser only ever recognized Estrid's
// Invocation's narrower "an enchantment you control" wording and Mirrormade's real text matches
// neither restriction, so it silently entered as a blank, uncopied enchantment instead.
export function parseEnterAsCopyEffect(
  oracleText: string
): { extraAbilityText?: string; controlledOnly: boolean; allowedTypes: Array<"artifact" | "enchantment" | "creature">; temporary?: boolean; extraKeyword?: string } | undefined {
  // "As this artifact enters, you may have it become a copy of any creature on the battlefield until end of turn, except it has haste."
  // (Cursed Mirror) — the same replacement effect, but it wears off at end of turn and the copy gets an extra keyword.
  const temporaryMatch = oracleText.match(/\byou may have it become a copy of any creature on the battlefield until end of turn, except it has ([a-z]+)\b/i);
  if (temporaryMatch) return { controlledOnly: false, allowedTypes: ["creature"], temporary: true, extraKeyword: temporaryMatch[1].toLowerCase() };
  // "You may have this creature enter as a copy of any creature on the battlefield." (Clone) / "...any artifact or creature..." (Phyrexian Metamorph).
  // Exceptions after the comma (Phantasmal Image's Illusion, Sakashima's name change) aren't modeled.
  const creatureCopyMatch = oracleText.match(/\byou may have this creature enter as a copy of any (artifact or creature|creature) on the battlefield\b/i);
  if (creatureCopyMatch) return { controlledOnly: false, allowedTypes: creatureCopyMatch[1].toLowerCase().includes("artifact") ? ["artifact", "creature"] : ["creature"] };
  const controlledMatch = oracleText.match(
    /\byou may have this enchantment enter as a copy of an enchantment you control(?:,?\s*except it has\s*"([^"]+)")?/i
  );
  if (controlledMatch) return { extraAbilityText: controlledMatch[1], controlledOnly: true, allowedTypes: ["enchantment"] };
  const anyMatch = oracleText.match(
    /\byou may have this (?:enchantment|artifact|permanent) enter as a copy of any (artifact or enchantment|enchantment or artifact|artifact|enchantment) on the battlefield(?:,?\s*except it has\s*"([^"]+)")?/i
  );
  if (!anyMatch) return undefined;
  const kinds = anyMatch[1].toLowerCase();
  const allowedTypes: Array<"artifact" | "enchantment"> =
    kinds.includes("artifact") && kinds.includes("enchantment") ? ["artifact", "enchantment"] : kinds.includes("artifact") ? ["artifact"] : ["enchantment"];
  return { extraAbilityText: anyMatch[2], controlledOnly: false, allowedTypes };
}

// Every permanent the copy could legally be of (what the human chooses between).
export function enterAsCopyCandidates(session: GameSession, actingSeatId: string, effect: { controlledOnly: boolean; allowedTypes: Array<"artifact" | "enchantment" | "creature"> }): VisibleCard[] {
  const matchesType = (card: VisibleCard) => effect.allowedTypes.some((type) => card.typeLine.includes(type === "artifact" ? "Artifact" : type === "creature" ? "Creature" : "Enchantment"));
  // Never offer (or default to) copying a legendary permanent I already control: the legend rule would put one of the two into the graveyard (Cursed Mirror copying my own commander).
  return session.seats
    .filter((seat) => !effect.controlledOnly || seat.id === actingSeatId)
    .flatMap((seat) => seat.board.battlefield.map((card) => ({ card, mine: seat.id === actingSeatId })))
    .filter(({ card, mine }) => matchesType(card) && !card.phasedOut && !(mine && card.typeLine.includes("Legendary")))
    .map(({ card }) => card);
}

export function findEnterAsCopyTarget(
  session: GameSession,
  actingSeatId: string,
  effect: { controlledOnly: boolean; allowedTypes: Array<"artifact" | "enchantment" | "creature"> },
  chosenId?: string
): VisibleCard | undefined {
  // The human's own pick ("none" = they declined to copy anything).
  if (chosenId === "none") return undefined;
  if (chosenId) {
    const picked = enterAsCopyCandidates(session, actingSeatId, effect).find((card) => card.id === chosenId);
    if (picked) return picked;
  }
  const matchesType = (card: VisibleCard) => effect.allowedTypes.some((type) => card.typeLine.includes(type === "artifact" ? "Artifact" : type === "creature" ? "Creature" : "Enchantment"));
  const actingSeat = session.seats.find((seat) => seat.id === actingSeatId);
  // "Any creature on the battlefield" (Cursed Mirror): the strongest one, whoever controls it.
  if (effect.allowedTypes.length === 1 && effect.allowedTypes[0] === "creature") {
    return enterAsCopyCandidates(session, actingSeatId, effect).sort((a, b) => effectivePower(b) + effectiveToughness(b) - (effectivePower(a) + effectiveToughness(a)))[0];
  }
  const ownMatch = actingSeat?.board.battlefield.find(matchesType);
  if (ownMatch || effect.controlledOnly) return ownMatch;
  for (const candidateSeat of session.seats) {
    if (candidateSeat.id === actingSeatId) continue;
    const match = candidateSeat.board.battlefield.find(matchesType);
    if (match) return match;
  }
  return undefined;
}

export function findPermanentById(session: GameSession, cardId: string): VisibleCard | undefined {
  for (const seat of session.seats) {
    const card = seat.board.battlefield.find((item) => item.id === cardId);
    if (card) return card;
  }
  return undefined;
}

// A card exiled by an effect like Mind's Dilation's physically sits in its OWNER's exile zone, not
// necessarily the seat granted permission to cast it (see the impulse_cast_free trigger resolution
// and playCardFromZone's own cross-seat handling) — so "is this card in exile and can this seat
// currently cast it" has to search every seat's exile, not just the seat's own. Callers still check
// exiledPlayableBySeatId/exiledPlayableUntilTurn themselves; this only finds the card.
export function findExiledCardAnySeat(session: GameSession, cardId: string): VisibleCard | undefined {
  for (const seat of session.seats) {
    const card = seat.board.exile?.find((item) => item.id === cardId);
    if (card) return card;
  }
  return undefined;
}

// A "new object" once it leaves the battlefield (rule 400.7) — counters, cached interpreted
// effects, and attachment/typing state from its time on the battlefield don't carry over. Shared
// between destroyCreatures and moveCardAcrossSeats.
export function resetForZoneChange<T extends VisibleCard>(card: T, zone: VisibleCard["zone"]): T {
  // Rule 711.8a: a double-faced permanent leaving the battlefield always becomes/represents its
  // front face again in the new zone, even if it was transformed (e.g. an Ormendahl bounced to
  // hand goes back to being Westvale Abbey), so name/typeLine/etc. revert to faces[0] here too.
  const frontFace = card.faces?.[0];
  return {
    ...card,
    zone,
    enteredTurn: undefined,
    enteredFrom: undefined,
    ...(frontFace
      ? {
          name: frontFace.name,
          typeLine: frontFace.typeLine,
          oracleText: frontFace.oracleText,
          manaCost: frontFace.manaCost,
          power: frontFace.power,
          toughness: frontFace.toughness,
          loyalty: frontFace.loyalty,
          imageUris: frontFace.imageUris ?? card.imageUris,
          unlockedFaceIndices: [0]
        }
      : {}),
    // A copy that leaves the battlefield is just the real card again (name/text/art of what it truly is), see copyOriginal.
    ...(card.copyOriginal ?? card.temporaryCopyOriginal ?? {}),
    copyOriginal: undefined,
    temporaryCopyOriginal: undefined,
    phasedOut: undefined,
    tapped: false,
    attacking: false,
    damage: undefined,
    attackTargetId: undefined,
    blockDecided: false,
    blocking: false,
    blockingTargetId: undefined,
    extraBlockingTargetId: undefined,
    battlefieldPosition: undefined,
    chosenCopyTargetId: undefined,
    chosenCastX: undefined,
    chosenTapAltIds: undefined,
    chosenAdditionalDiscardIds: undefined,
    counters: undefined,
    interpretedEffects: undefined,
    attachedToId: undefined,
    attachmentPowerBonus: undefined,
    attachmentToughnessBonus: undefined,
    // Until-end-of-turn effects (-X/-X, pumps, base P/T, stripped abilities) belong to the old object
    // too — otherwise a creature killed by a temporary -N/-N and returned the same turn (Meren, Victimize)
    // re-enters still at 0 toughness and dies again.
    temporaryPowerBonus: undefined,
    temporaryToughnessBonus: undefined,
    temporaryBasePower: undefined,
    temporaryBaseToughness: undefined,
    temporaryAbilitiesStripped: undefined,
    temporaryAnimatedAsCreature: undefined,
    temporaryGrantedKeywords: undefined,
    grantedKeywords: undefined,
    grantedProtectionColors: undefined,
    grantedManaAbilityText: undefined,
    grantedTypes: undefined,
    grantedAbilityText: undefined,
    attachTimestamp: undefined,
    cdaPower: undefined,
    cdaToughness: undefined,
    setPowerOverride: undefined,
    setToughnessOverride: undefined,
    animatedAsCreature: undefined,
    exiledPlayableBySeatId: undefined,
    exiledPlayableUntilTurn: undefined,
    permanentlyArtifact: undefined,
    imprisonedOriginal: undefined,
    nabbedFromSeatId: undefined,
    nabbedUntil: undefined
  };
}

export function findExileInsteadOfDying(
  session: GameSession,
  dyingSeatId: string,
  cardId: string
): { sourceId: string; sourceName: string; sourceSeatId: string; tokenClause: string } | undefined {
  const card = session.seats.find((seat) => seat.id === dyingSeatId)?.board.battlefield.find((item) => item.id === cardId);
  if (!card || card.token || !card.typeLine.includes("Creature")) return undefined;
  for (const sourceSeat of session.seats) {
    if (sourceSeat.id === dyingSeatId || sourceSeat.hasLost) continue;
    for (const source of sourceSeat.board.battlefield) {
      if ((source.abilitiesStripped || source.phasedOut)) continue;
      const replacement = parseExileInsteadOfDyingReplacement(source.oracleText);
      if (replacement) return { sourceId: source.id, sourceName: source.name, sourceSeatId: sourceSeat.id, tokenClause: replacement.tokenClause };
    }
  }
  return undefined;
}

export function destroyCreaturesCore(
  session: GameSession,
  destructions: Array<{ seatId: string; cardId: string; message: string }>,
  detail: string
): GameSession {
  const events: GameEvent[] = [];
  const newDeaths: Array<{ seatId: string; card: VisibleCard; attachedSourceIds?: string[]; sacrificed?: boolean }> = [];
  // Equipment/Aura attachedToId snapshot, taken from the pre-destruction battlefield before this
  // same state-based-action pass clears it once the creature it points at is actually gone — see
  // types.ts's pendingDeaths comment.
  const allBattlefieldCards = session.seats.flatMap((item) => item.board.battlefield);
  // Keyed by TRUE owner (card.ownerSeatId, falling back to whoever currently controls it if it
  // never changed hands) rather than by the controlling seat being processed — a reanimated or
  // stolen permanent must go to its owner's graveyard, not its controller's (rule 404.4), and
  // those can be different seats now that control-changing effects exist.
  const toGraveyardByOwnerSeatId = new Map<string, VisibleCard[]>();
  // Blightsteel Colossus/Darksteel Colossus/Progenitus-style "would be put into a graveyard from
  // anywhere, reveal and shuffle into owner's library instead" — a replacement effect (rule 614),
  // so the card never actually reaches a graveyard at all. Same owner-keyed bucket shape as above.
  const toLibraryByOwnerSeatId = new Map<string, VisibleCard[]>();

  const seatsAfterRemoval = session.seats.map((seat) => {
    const toDestroy = destructions.filter((entry) => entry.seatId === seat.id);
    if (toDestroy.length === 0) return seat;
    const destroyIds = new Set(toDestroy.map((entry) => entry.cardId));
    const destroyedCards = seat.board.battlefield.filter((card) => destroyIds.has(card.id));
    for (const card of destroyedCards) {
      // Redirected before ever reaching a graveyard — it never actually dies (rule 700.4), so it
      // must not appear as a death for "whenever another creature you control dies"-style triggers.
      if (hasGraveyardShuffleReplacement(card.oracleText)) continue;
      const attachedSourceIds = allBattlefieldCards.filter((permanent) => permanent.attachedToId === card.id).map((permanent) => permanent.id);
      // Every sacrifice path words its log message "sacrifice(s)/sacrificed" (destroy paths say "destroyed"), so the message tells them apart.
      const wasSacrificed = /\bsacrifice[sd]?\b/i.test(toDestroy.find((entry) => entry.cardId === card.id)?.message ?? "");
      newDeaths.push({ seatId: seat.id, card, attachedSourceIds: attachedSourceIds.length > 0 ? attachedSourceIds : undefined, ...(wasSacrificed ? { sacrificed: true } : {}) });
    }
    for (const entry of toDestroy) {
      const card = destroyedCards.find((item) => item.id === entry.cardId);
      const ownerSeat = card ? session.seats.find((item) => item.id === (card.ownerSeatId ?? seat.id)) : undefined;
      const message =
        card && ownerSeat && hasGraveyardShuffleReplacement(card.oracleText)
          ? `${card.name} is revealed and shuffled into ${possessive(ownerSeat)} library.`
          : entry.message;
      events.push({ id: crypto.randomUUID(), at: new Date().toISOString(), seatId: seat.id, message, detail });
    }

    // Tokens cease to exist rather than sitting in the graveyard (rule 704.5d). A destroyed
    // commander is no longer force-redirected to the command zone here — rule 903.9a's
    // "graveyard-or-exile" replacement is genuinely optional, owner's choice, so a dying commander
    // now goes to the graveyard like any other creature (still carrying commander: true) and the
    // pendingDeaths-draining effect offers the human a real "move to the command zone instead?"
    // choice afterward (auto-accepted for an agent seat, matching the old unconditional behavior).
    const toLibrary = destroyedCards.filter((card) => !card.token && hasGraveyardShuffleReplacement(card.oracleText));
    const toGraveyard = destroyedCards.filter((card) => !card.token && !hasGraveyardShuffleReplacement(card.oracleText));
    const dyingCommander = destroyedCards.some((card) => card.commander);

    for (const card of toGraveyard) {
      const ownerSeatId = card.ownerSeatId ?? seat.id;
      const bucket = toGraveyardByOwnerSeatId.get(ownerSeatId) ?? [];
      bucket.push(resetForZoneChange(card, "graveyard"));
      toGraveyardByOwnerSeatId.set(ownerSeatId, bucket);
    }
    for (const card of toLibrary) {
      const ownerSeatId = card.ownerSeatId ?? seat.id;
      const bucket = toLibraryByOwnerSeatId.get(ownerSeatId) ?? [];
      bucket.push(resetForZoneChange(card, "library"));
      toLibraryByOwnerSeatId.set(ownerSeatId, bucket);
    }

    return {
      ...seat,
      board: {
        ...seat.board,
        commander: dyingCommander ? undefined : seat.board.commander,
        battlefield: seat.board.battlefield.filter((card) => !destroyIds.has(card.id))
      },
      zones: {
        ...seat.zones,
        battlefield: Math.max(0, seat.zones.battlefield - destroyedCards.length)
      }
    };
  });

  const seats = seatsAfterRemoval.map((seat) => {
    const graveyardAdditions = toGraveyardByOwnerSeatId.get(seat.id);
    const libraryAdditions = toLibraryByOwnerSeatId.get(seat.id);
    if ((!graveyardAdditions || graveyardAdditions.length === 0) && (!libraryAdditions || libraryAdditions.length === 0)) return seat;
    return {
      ...seat,
      board:
        graveyardAdditions && graveyardAdditions.length > 0
          ? { ...seat.board, graveyard: [...(seat.board.graveyard ?? []), ...graveyardAdditions] }
          : seat.board,
      library: libraryAdditions && libraryAdditions.length > 0 ? shuffleCards([...(seat.library ?? []), ...libraryAdditions]) : seat.library,
      zones: {
        ...seat.zones,
        graveyard: seat.zones.graveyard + (graveyardAdditions?.length ?? 0),
        library: seat.zones.library + (libraryAdditions?.length ?? 0)
      }
    };
  });

  // Gorma, the Gullet: how many creatures died under each player's control this turn.
  const diedCreatures = newDeaths.filter((death) => death.card.typeLine.includes("Creature"));
  const diedThisTurn = diedCreatures.length === 0 ? session.creaturesDiedThisTurn : { turn: session.turn, bySeat: diedCreatures.reduce<Record<string, number>>((acc, death) => ({ ...acc, [death.seatId]: (acc[death.seatId] ?? 0) + 1 }), session.creaturesDiedThisTurn?.turn === session.turn ? { ...session.creaturesDiedThisTurn.bySeat } : {}) };
  // Every player's nontoken creatures together (Gadrak, the Crown-Scourge: "a Treasure token for each nontoken creature that died this turn").
  const nontokenDied = diedCreatures.filter((death) => !death.card.token).length;
  const nontokenDiedThisTurn = nontokenDied === 0 ? session.nontokenCreaturesDiedThisTurn : { turn: session.turn, count: nontokenDied + (session.nontokenCreaturesDiedThisTurn?.turn === session.turn ? session.nontokenCreaturesDiedThisTurn.count : 0) };
  return { ...session, seats, events: [...events, ...session.events], pendingDeaths: [...(session.pendingDeaths ?? []), ...newDeaths], ...(diedThisTurn ? { creaturesDiedThisTurn: diedThisTurn } : {}), ...(nontokenDiedThisTurn ? { nontokenCreaturesDiedThisTurn: nontokenDiedThisTurn } : {}) };
}

// Resolves the "move to the command zone instead?" replacement (rule 903.9a) once accepted — for
// a human via commander_zone_choice, or auto-applied for an agent seat (see the detection effect
// that calls this). cardId is expected to be sitting in seatId's own graveyard.
export function moveCommanderToCommandZone(session: GameSession, seatId: string, cardId: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  // Graveyard (own) first, then exile in ANY seat (a caster's exile pile can hold another player's card).
  const graveyardCard = seat.board.graveyard?.find((item) => item.id === cardId);
  const exileHolder = graveyardCard ? undefined : session.seats.find((item) => (item.board.exile ?? []).some((entry) => entry.id === cardId));
  const card = graveyardCard ?? exileHolder?.board.exile?.find((item) => item.id === cardId);
  if (!card) return session;
  const fromZone: "graveyard" | "exile" = graveyardCard ? "graveyard" : "exile";
  const commanderTax = card.commanderTax ?? 0; // tax rises on CAST (903.8), not on moving to the command zone
  // Moving zones makes it a new object: the "until ~ leaves the battlefield" link (Grasp of Fate) is severed,
  // so the holder leaving later does NOT bring the commander back to the battlefield.
  const commanderCard = { ...resetForZoneChange(card, "command"), commanderTax, exiledUntilSourceLeaves: undefined };
  return {
    ...session,
    seats: session.seats.map((item) => {
      let next = item;
      if (fromZone === "graveyard" && item.id === seatId) {
        next = { ...next, board: { ...next.board, graveyard: (item.board.graveyard ?? []).filter((entry) => entry.id !== cardId) }, zones: { ...next.zones, graveyard: Math.max(0, item.zones.graveyard - 1) } };
      }
      if (fromZone === "exile" && item.id === exileHolder?.id) {
        next = { ...next, board: { ...next.board, exile: (item.board.exile ?? []).filter((entry) => entry.id !== cardId) }, zones: { ...next.zones, exile: Math.max(0, item.zones.exile - 1) } };
      }
      if (item.id === seatId) next = { ...next, board: { ...next.board, commander: commanderCard }, zones: { ...next.zones, command: next.zones.command + 1 } };
      return next;
    }),
    // "Whenever one or more cards leave your graveyard, ..." (Willow Geist, Insidious Roots) — the
    // graveyard's OWNER is seatId here (this function never crosses seats), matching every other
    // recording site's "departure belongs to whoever's graveyard it was" rule.
    pendingGraveyardDepartures: fromZone === "graveyard" ? [...(session.pendingGraveyardDepartures ?? []), { seatId, cards: [card] }] : session.pendingGraveyardDepartures,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${card.name} moves from ${fromZone} to the command zone. Commander tax is now +${commanderTax}.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

export type CrossSeatZone = "hand" | "battlefield" | "graveyard" | "exile" | "library";

// "You may have this enter as a copy of ..." for a permanent that did NOT come from a cast (a Clone reanimated, flickered
// or tutored). The cast path asks the human first (choose_cast_copy); these paths have no prompt, so — like the AI seats —
// it takes the best legal target (findEnterAsCopyTarget's heuristic), and stays a blank card only if there is none.
// Cursed Mirror's temporary copy is left to the cast path.
export function applyEnterAsCopyOnEntry(session: GameSession, seatId: string, cardId: string): GameSession {
  const entering = session.seats.find((seat) => seat.id === seatId)?.board.battlefield.find((card) => card.id === cardId);
  if (!entering || entering.token) return session;
  const effect = parseEnterAsCopyEffect(entering.oracleText);
  if (!effect || effect.temporary) return session;
  // The entering permanent must not be able to copy itself.
  const without: GameSession = { ...session, seats: session.seats.map((seat) => ({ ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.filter((card) => card.id !== cardId) } })) };
  const target = findEnterAsCopyTarget(without, seatId, effect, entering.chosenCopyTargetId);
  if (!target) return session;
  // A human with a real choice (2+ legal copy targets) is asked, exactly like the cast path (choose_cast_copy): Estrid's Invocation returning from its
  // upkeep rider must let its owner pick a NEW enchantment. The permanent waits on the battlefield as the blank card until they answer.
  const seat = session.seats.find((item) => item.id === seatId);
  const candidates = enterAsCopyCandidates(without, seatId, effect);
  if (seat?.kind === "human" && !entering.chosenCopyTargetId && candidates.length >= 2) {
    return queuePlayerChoice(session, {
      seatId,
      sourceCardId: cardId,
      sourceCardName: entering.name,
      prompt: `${entering.name}: choose ${effect.controlledOnly ? "an enchantment you control" : "a permanent"} to enter as a copy of.`,
      options: [...candidates.map((card) => ({ label: `${card.name} (${card.typeLine})`, value: card.id })), { label: "Don't copy anything", value: "none" }],
      resolver: "enter_as_copy",
      data: {}
    });
  }
  return applyEnterAsCopyTarget(session, seatId, cardId, target);
}

// Turns the (blank) entering permanent into a permanent copy of `target`, remembering what it really is (copyOriginal) so it reverts on any zone change.
export function applyEnterAsCopyTarget(session: GameSession, seatId: string, cardId: string, target: VisibleCard): GameSession {
  const entering = session.seats.find((seat) => seat.id === seatId)?.board.battlefield.find((card) => card.id === cardId);
  if (!entering) return session;
  const effect = parseEnterAsCopyEffect(entering.oracleText);
  if (!effect) return session;
  const copy: VisibleCard = {
    ...entering,
    copyOriginal: entering.copyOriginal ?? {
      name: entering.name,
      typeLine: entering.typeLine,
      oracleText: entering.oracleText,
      manaCost: entering.manaCost,
      manaValue: entering.manaValue,
      colors: entering.colors,
      colorIdentity: entering.colorIdentity,
      power: entering.power,
      toughness: entering.toughness,
      imageUris: entering.imageUris
    },
    name: target.name,
    typeLine: target.typeLine,
    oracleText: effect.extraAbilityText ? `${target.oracleText}\n${effect.extraAbilityText}` : target.oracleText,
    manaCost: target.manaCost,
    manaValue: target.manaValue,
    colors: target.colors,
    colorIdentity: target.colorIdentity,
    power: target.power,
    toughness: target.toughness,
    imageUris: target.imageUris ?? entering.imageUris
  };
  return rulesEvent(
    {
      ...session,
      seats: session.seats.map((seat) => (seat.id === seatId ? { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === cardId ? copy : card)) } } : seat))
    },
    seatId,
    `${entering.name} enters as a copy of ${target.name}.`
  );
}

// A control change (Threaten/Mind Control-style) is NOT a zone change (rule 400.7 only triggers on
// actually leaving/entering a zone) — the permanent stays the SAME object. Counters, attachments,
// and tapped status all carry over; only summoning sickness resets for the new controller (rule
// 302.6) and the true owner is preserved so it still dies into the right graveyard later.
export function changeControlWithinBattlefield(session: GameSession, cardId: string, fromSeatId: string, toSeatId: string, temporary: boolean = false): GameSession {
  if (fromSeatId === toSeatId) return session;
  const fromSeat = session.seats.find((seat) => seat.id === fromSeatId);
  const card = fromSeat?.board.battlefield.find((item) => item.id === cardId);
  if (!card) return session;
  const ownerSeatId = card.ownerSeatId ?? fromSeatId;
  const movedCard: VisibleCard = {
    ...card,
    ownerSeatId,
    summoningSick: card.typeLine.includes("Creature") ? true : card.summoningSick,
    // Rule 506.4: a permanent that changes controllers is removed from combat.
    attacking: false,
    blocking: false,
    attackTargetId: undefined,
    blockingTargetId: undefined,
    extraBlockingTargetId: undefined,
    temporaryControlChange: temporary || undefined
  };

  return {
    ...session,
    seats: session.seats.map((seat) => {
      if (seat.id === fromSeatId) return { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.filter((item) => item.id !== cardId) }, zones: { ...seat.zones, battlefield: Math.max(0, seat.zones.battlefield - 1) } };
      if (seat.id === toSeatId) return { ...seat, board: { ...seat.board, battlefield: [...seat.board.battlefield, movedCard] }, zones: { ...seat.zones, battlefield: seat.zones.battlefield + 1 } };
      return seat;
    })
  };
}

export function rulesEvent(session: GameSession, seatId: string, message: string): GameSession {
  return { ...session, events: [{ id: crypto.randomUUID(), at: new Date().toISOString(), seatId, message, detail: "Rules action" }, ...session.events] };
}

export function queuePlayerChoice(session: GameSession, entry: NonNullable<GameSession["pendingPlayerChoices"]>[number]): GameSession {
  return { ...session, pendingPlayerChoices: [...(session.pendingPlayerChoices ?? []), entry] };
}

// Moves the top card of a library into its owner's hand WITHOUT it being a draw (Keen Duelist / Parker Luck "put the card you revealed into your hand").
export function moveTopLibraryCardToHand(session: GameSession, seatId: string): GameSession {
  return {
    ...session,
    seats: session.seats.map((seat) => {
      if (seat.id !== seatId) return seat;
      const [top, ...library] = seat.library ?? [];
      if (!top) return seat;
      return { ...seat, library, board: { ...seat.board, hand: [...seat.board.hand, { ...top, zone: "hand" as const }] }, zones: { ...seat.zones, hand: seat.zones.hand + 1, library: Math.max(0, seat.zones.library - 1) } };
    })
  };
}

// "Return up to N target creature/permanent cards (with mana value X or less) from your graveyard to your hand / the battlefield" as a resolution step
// (Witch of the Moors, Moseo's Infusion, Find, Deadly Brew). An agent takes the highest mana value cards that qualify; a human is asked one card at a
// time (with a "none" option, since all of these are "up to"). The graveyard is the caster's own.
export interface GraveyardReturnOptions {
  destination: "hand" | "battlefield";
  typeFilter: "creature" | "permanent";
  count: number;
  maxManaValue?: number;
  excludeCardId?: string;
  tapped?: boolean;
}

export function applyGraveyardToLibrary(session: GameSession, seatId: string, sourceName: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const graveyard = seat?.board.graveyard ?? [];
  if (!seat || graveyard.length === 0) return session;
  const shuffled = shuffleCards([...(seat.library ?? []), ...graveyard.map((card) => resetForZoneChange(card, "library" as const))]);
  return {
    ...session,
    seats: session.seats.map((item) =>
      item.id === seatId
        ? { ...item, library: shuffled, board: { ...item.board, graveyard: [] }, zones: { ...item.zones, library: item.zones.library + graveyard.length, graveyard: 0 } }
        : item
    ),
    // "Whenever one or more cards leave your graveyard, ..." — one entry for the whole shuffled-back
    // graveyard, not one per card (already guaranteed non-empty by the guard above).
    pendingGraveyardDepartures: [...(session.pendingGraveyardDepartures ?? []), { seatId, cards: graveyard }],
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${sourceName} shuffles ${possessive(seat)} graveyard into ${seat.name === "You" ? "your" : "their"} library.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

export function applyGraveyardExile(session: GameSession, seatId: string, sourceName: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const graveyard = seat?.board.graveyard ?? [];
  if (!seat || graveyard.length === 0) return session;
  const exiled = graveyard.map((card) => resetForZoneChange(card, "exile" as const));
  return {
    ...session,
    seats: session.seats.map((item) =>
      item.id === seatId
        ? {
            ...item,
            board: { ...item.board, graveyard: [], exile: [...(item.board.exile ?? []), ...exiled] },
            zones: { ...item.zones, graveyard: 0, exile: item.zones.exile + exiled.length }
          }
        : item
    ),
    // "Whenever one or more cards leave your graveyard, ..." — one entry for the whole exiled
    // graveyard, not one per card (already guaranteed non-empty by the guard above).
    pendingGraveyardDepartures: [...(session.pendingGraveyardDepartures ?? []), { seatId, cards: graveyard }],
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${sourceName} exiles ${possessive(seat)} graveyard (${exiled.length} card${exiled.length === 1 ? "" : "s"}).`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

// Moves the given hand cards to the top of the seat's library — the shared "put card(s) from hand
// on top of library" mechanic behind both the interactive pendingRuleChoice flow
// (finishTriggerResolution/completePutCardsOnLibrary) and applyDrawXThenPutBack's deterministic
// fallback above. Order follows cardIds (first id ends up on the very top).
export function applyPutCardsOnLibrary(session: GameSession, seatId: string, sourceName: string, cardIds: string[]): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const cardIdOrder = new Map(cardIds.map((id, index) => [id, index]));
  const putBack = (seat?.board.hand.filter((card) => cardIdOrder.has(card.id)) ?? []).sort(
    (a, b) => cardIdOrder.get(a.id)! - cardIdOrder.get(b.id)!
  );
  if (!seat || putBack.length === 0) return session;
  const putBackIds = new Set(putBack.map((card) => card.id));
  const seatName = seat.name;
  return {
    ...session,
    seats: session.seats.map((item) =>
      item.id === seatId
        ? {
            ...item,
            board: { ...item.board, hand: item.board.hand.filter((card) => !putBackIds.has(card.id)) },
            library: [...putBack.map((card) => ({ ...card, zone: "library" as const })), ...(item.library ?? [])],
            zones: { ...item.zones, hand: Math.max(0, item.zones.hand - putBack.length), library: item.zones.library + putBack.length }
          }
        : item
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${seatName} puts ${putBack.map((card) => card.name).join(", ")} from hand on top of their library (${sourceName}).`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

// A creature that leaves the battlefield for somewhere other than the graveyard (deaths are recorded through pendingDeaths) is queued in
// pendingLeaves, so "whenever a creature you control leaves the battlefield" triggers see bounce and exile too.
export function withLeaveRecord(before: GameSession, after: GameSession, seatId: string, cardId: string, destinationIsGraveyard: boolean): GameSession {
  if (destinationIsGraveyard || after === before) return after;
  const card = before.seats.find((seat) => seat.id === seatId)?.board.battlefield.find((item) => item.id === cardId);
  if (!card || (!card.typeLine.includes("Creature") && !(card.counters ?? []).some((counter) => counter.count > 0))) return after;
  const stillThere = after.seats.some((seat) => seat.board.battlefield.some((item) => item.id === cardId));
  if (stillThere) return after;
  return { ...after, pendingLeaves: [...(after.pendingLeaves ?? []), { seatId, card }] };
}

export function moveCardBetweenVisibleZones(session: GameSession, seatId: string, cardId: string, destination: "hand" | "graveyard" | "exile"): GameSession {
  return withLeaveRecord(session, moveCardBetweenVisibleZonesCore(session, seatId, cardId, destination), seatId, cardId, destination === "graveyard");
}

function moveCardBetweenVisibleZonesCore(session: GameSession, seatId: string, cardId: string, destination: "hand" | "graveyard" | "exile"): GameSession {
  const controllerSeat = session.seats.find((seat) => seat.id === seatId);
  if (!controllerSeat) return session;
  const graveyard = controllerSeat.board.graveyard ?? [];
  const exile = controllerSeat.board.exile ?? [];
  const handCard = controllerSeat.board.hand.find((card) => card.id === cardId);
  const battlefieldCard = controllerSeat.board.battlefield.find((card) => card.id === cardId);
  const graveyardCard = graveyard.find((card) => card.id === cardId);
  const exileCard = exile.find((card) => card.id === cardId);
  const card = handCard ?? battlefieldCard ?? graveyardCard ?? exileCard;
  if (!card) return session;

  const source: "hand" | "battlefield" | "graveyard" | "exile" = handCard ? "hand" : battlefieldCard ? "battlefield" : graveyardCard ? "graveyard" : "exile";
  if (source === destination) return session;

  // Rule 903.9: the replacement also covers a commander that would go to hand (bounce), not just
  // exile — same unconditional-redirect precedent as exile. Graveyard is deliberately excluded
  // here now: 903.9a's graveyard-or-exile replacement is genuinely optional, owner's choice, so a
  // commander headed to the graveyard falls through to the normal move below instead, and the
  // pendingDeaths-draining effect offers the human a real choice afterward (see its own comment) —
  // auto-accepted for an agent seat, matching the old unconditional behavior. Exile still always
  // redirects (no legitimate reason to want a commander stuck in exile), and so does hand.
  if (card.commander && source === "battlefield" && (destination === "exile" || destination === "hand")) {
    const commanderTax = card.commanderTax ?? 0; // tax rises on CAST (903.8), not on moving to the command zone
    return {
      ...session,
      seats: session.seats.map((seat) =>
        seat.id === seatId
          ? {
              ...seat,
              board: {
                ...seat.board,
                commander: {
                  ...card,
                  zone: "command" as const,
                  tapped: false,
                  attacking: false,
                  blocking: false,
                  battlefieldPosition: undefined,
                  commanderTax
                },
                battlefield: seat.board.battlefield.filter((item) => item.id !== cardId),
                graveyard,
                exile
              },
              zones: {
                ...seat.zones,
                battlefield: Math.max(0, seat.zones.battlefield - 1),
                command: seat.zones.command + 1
              }
            }
          : seat
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${controllerSeat.name} returns ${card.name} to the command zone. Commander tax is now +${commanderTax}.`
        },
        ...session.events
      ]
    };
  }

  if (card.token && source === "battlefield") {
    const destinationCount = destination === "graveyard" ? "graveyard" : destination === "exile" ? "exile" : "hand";
    return {
      ...session,
      seats: session.seats.map((seat) =>
        seat.id === seatId
          ? {
              ...seat,
              board: {
                ...seat.board,
                battlefield: seat.board.battlefield.filter((item) => item.id !== cardId),
                graveyard,
                exile
              },
              zones: {
                ...seat.zones,
                battlefield: Math.max(0, seat.zones.battlefield - 1),
                [destinationCount]: seat.zones[destinationCount]
              }
            }
          : seat
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${controllerSeat.name} moves ${card.name} from ${source} to ${destination}.`
        },
        ...session.events
      ]
    };
  }

  // A stolen/reanimated permanent (or a discard/sacrifice of one) must land in its OWNER's zones
  // (rule 404.4/400.3), not its controller's — and a Blightsteel Colossus/Darksteel Colossus/
  // Progenitus-style "would be put into a graveyard from anywhere ... shuffle it into its owner's
  // library instead" replacement (rule 614) redirects it into the owner's library instead of any
  // graveyard at all, regardless of whether owner and controller are the same seat.
  const ownerSeatId = card.ownerSeatId ?? seatId;
  const ownerSeat = session.seats.find((seat) => seat.id === ownerSeatId) ?? controllerSeat;
  const shuffleReplacement = destination === "graveyard" && hasGraveyardShuffleReplacement(card.oracleText);

  // A card is a "new object" once it changes zones — counters, cached interpreted effects, and
  // attack/block linkage from its time on the battlefield don't carry over.
  const movedCard: VisibleCard = {
    ...card,
    zone: shuffleReplacement ? "library" : destination,
    tapped: destination === "graveyard" || destination === "exile" ? false : card.tapped,
    attacking: false,
    attackTargetId: undefined,
    blockDecided: false,
    blocking: false,
    blockingTargetId: undefined,
    battlefieldPosition: destination === "graveyard" || destination === "exile" ? undefined : card.battlefieldPosition,
    counters: undefined,
    interpretedEffects: undefined,
    attachedToId: undefined,
    attachmentPowerBonus: undefined,
    attachmentToughnessBonus: undefined,
    grantedKeywords: undefined,
    grantedProtectionColors: undefined,
    grantedManaAbilityText: undefined,
    grantedTypes: undefined,
    grantedAbilityText: undefined,
    attachTimestamp: undefined,
    cdaPower: undefined,
    cdaToughness: undefined,
    setPowerOverride: undefined,
    setToughnessOverride: undefined,
    animatedAsCreature: undefined,
    temporaryPowerBonus: undefined,
    temporaryToughnessBonus: undefined,
    temporaryBasePower: undefined,
    temporaryBaseToughness: undefined,
    temporaryAbilitiesStripped: undefined,
    temporaryAnimatedAsCreature: undefined,
    temporaryGrantedKeywords: undefined
  };

  const seats = session.seats.map((seat) => {
    const isController = seat.id === seatId;
    const isOwner = seat.id === ownerSeatId;
    if (!isController && !isOwner) return seat;

    let board = seat.board;
    let library = seat.library;
    let handDelta = 0;
    let battlefieldDelta = 0;
    let graveyardDelta = 0;
    let exileDelta = 0;
    let libraryDelta = 0;

    if (isController) {
      if (source === "hand") {
        board = { ...board, hand: board.hand.filter((item) => item.id !== cardId) };
        handDelta -= 1;
      } else if (source === "battlefield") {
        board = { ...board, battlefield: board.battlefield.filter((item) => item.id !== cardId) };
        battlefieldDelta -= 1;
      } else if (source === "graveyard") {
        board = { ...board, graveyard: (board.graveyard ?? []).filter((item) => item.id !== cardId) };
        graveyardDelta -= 1;
      } else {
        board = { ...board, exile: (board.exile ?? []).filter((item) => item.id !== cardId) };
        exileDelta -= 1;
      }
    }

    if (isOwner) {
      if (shuffleReplacement) {
        library = shuffleCards([...(library ?? []), movedCard]);
        libraryDelta += 1;
      } else if (destination === "hand") {
        board = { ...board, hand: [...board.hand, movedCard] };
        handDelta += 1;
      } else if (destination === "graveyard") {
        board = { ...board, graveyard: [...(board.graveyard ?? []), movedCard] };
        graveyardDelta += 1;
      } else {
        board = { ...board, exile: [...(board.exile ?? []), movedCard] };
        exileDelta += 1;
      }
    }

    return {
      ...seat,
      board,
      library,
      zones: {
        ...seat.zones,
        hand: seat.zones.hand + handDelta,
        battlefield: Math.max(0, seat.zones.battlefield + battlefieldDelta),
        graveyard: Math.max(0, seat.zones.graveyard + graveyardDelta),
        exile: Math.max(0, seat.zones.exile + exileDelta),
        library: Math.max(0, seat.zones.library + libraryDelta)
      }
    };
  });

  const message = shuffleReplacement
    ? `${movedCard.name} is revealed and shuffled into ${possessive(ownerSeat)} library.`
    : ownerSeatId !== seatId
      ? `${controllerSeat.name} moves ${movedCard.name} from ${source} to ${possessive(ownerSeat)} ${destination}.`
      : `${controllerSeat.name} moves ${movedCard.name} from ${source} to ${destination}.`;

  return {
    ...session,
    seats,
    // "Whenever one or more cards leave your graveyard, ..." — the departure belongs to the
    // graveyard's own seat (this function's `seatId`, the controller param), which for a
    // graveyard-sourced move IS whoever's board.graveyard array the card actually left.
    pendingGraveyardDepartures:
      source === "graveyard" ? [...(session.pendingGraveyardDepartures ?? []), { seatId, cards: [card] }] : session.pendingGraveyardDepartures,
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

export function moveLibraryCard(session: GameSession, seatId: string, cardId: string, destination: "top" | "bottom" | "graveyard"): GameSession {
  let movedName = "";
  const seats = session.seats.map((seat) => {
    if (seat.id !== seatId) return seat;
    const library = seat.library ?? [];
    const card = library.find((item) => item.id === cardId);
    if (!card) return seat;
    movedName = card.name;
    const remainingLibrary = library.filter((item) => item.id !== cardId);
    const graveyard = seat.board.graveyard ?? [];

    if (destination === "top") {
      return {
        ...seat,
        library: [{ ...card, zone: "library" as const }, ...remainingLibrary]
      };
    }

    if (destination === "bottom") {
      return {
        ...seat,
        library: [...remainingLibrary, { ...card, zone: "library" as const }]
      };
    }

    return {
      ...seat,
      library: remainingLibrary,
      board: {
        ...seat.board,
        graveyard: [...graveyard, { ...card, zone: "graveyard" as const }]
      },
      zones: {
        ...seat.zones,
        graveyard: seat.zones.graveyard + 1,
        library: Math.max(0, seat.zones.library - 1)
      }
    };
  });

  if (!movedName) return session;

  return {
    ...session,
    seats,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message:
          destination === "top"
            ? `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} keeps ${movedName} on top of their library.`
            : destination === "bottom"
            ? `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} puts ${movedName} on the bottom of their library.`
            : `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} surveils ${movedName} into their graveyard.`
      },
      ...session.events
    ]
  };
}

export function reorderTopLibraryCards(session: GameSession, seatId: string, orderedCards: VisibleCard[]): GameSession {
  const orderedIds = new Set(orderedCards.map((card) => card.id));
  const seatName = session.seats.find((seat) => seat.id === seatId)?.name ?? "Player";
  return {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === seatId
        ? {
            ...seat,
            library: [
              ...orderedCards.map((card) => ({ ...card, zone: "library" as const })),
              ...(seat.library ?? []).filter((card) => !orderedIds.has(card.id))
            ]
          }
        : seat
    ),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${seatName} put ${orderedCards.length} looked-at card${orderedCards.length === 1 ? "" : "s"} back on top in a chosen order.`
      },
      ...session.events
    ]
  };
}

// "Put the rest into your graveyard." (Grisly Salvage) — mirrors applyMill's own handling of the
// Blightsteel Colossus/Darksteel Colossus/Progenitus-style "would be put into a graveyard from
// anywhere ... shuffle it into its owner's library instead" replacement effect (see its comment):
// these cards are headed to the graveyard from the library too, so the same redirect applies.
export function putLookedAtCardsInGraveyard(session: GameSession, seatId: string, cards: VisibleCard[]): GameSession {
  if (cards.length === 0) return session;
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  const cardIds = new Set(cards.map((card) => card.id));
  const redirected = cards.filter((card) => hasGraveyardShuffleReplacement(card.oracleText));
  const toGraveyard = cards.filter((card) => !hasGraveyardShuffleReplacement(card.oracleText)).map((card) => resetForZoneChange(card, "graveyard" as const));
  const remainingLibrary = (seat.library ?? []).filter((card) => !cardIds.has(card.id));
  return {
    ...session,
    seats: session.seats.map((item) =>
      item.id === seatId
        ? {
            ...item,
            library:
              redirected.length > 0
                ? shuffleCards([...remainingLibrary, ...redirected.map((card) => resetForZoneChange(card, "library" as const))])
                : remainingLibrary,
            board: toGraveyard.length > 0 ? { ...item.board, graveyard: [...(item.board.graveyard ?? []), ...toGraveyard] } : item.board,
            zones: { ...item.zones, graveyard: item.zones.graveyard + toGraveyard.length, library: Math.max(0, item.zones.library - toGraveyard.length) }
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
        message: `${seat.name} puts ${cards.length} looked-at card${cards.length === 1 ? "" : "s"} into the graveyard.`
      },
      ...session.events
    ]
  };
}

export function shuffleCards(cards: VisibleCard[]) {
  const shuffled = cards.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function randomInt(maxExclusive: number) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % maxExclusive;
}
