// Opening hand and deck-to-session setup: agent mulligans (London mulligan), opening-hand construction, library shuffling, Lim-Dul's
// Vault agent choice, creating visible cards from deck entries.
// Extracted verbatim from components/AppFlow.tsx; AppFlow.tsx re-exports the previously public symbols.

import { moveCardAcrossSeats } from "@/engine/entry";
import { isLandCard } from "@/engine/shared";
import { rulesEvent, shuffleCards } from "@/engine/zones";
import { evaluateOpeningHand } from "@/lib/mulliganHeuristics";
import { type CommanderDeck, type GameEvent, type GameSession, type PlayerSeat, type VisibleCard } from "@/lib/types";

// Cards in an opening hand that may begin the game on the battlefield (Leyline of Abundance, ...).
export function openingHandBattlefieldCards(seat: PlayerSeat): VisibleCard[] {
  return seat.board.hand.filter((card) => /if this card is in your opening hand, you may begin the game with it on the battlefield/i.test(card.oracleText));
}

export function putOpeningHandCardOnBattlefield(session: GameSession, seatId: string, cardId: string): GameSession {
  const card = session.seats.find((item) => item.id === seatId)?.board.hand.find((entry) => entry.id === cardId);
  if (!card) return session;
  const moved = moveCardAcrossSeats(session, seatId, cardId, seatId, "battlefield");
  return rulesEvent(moved.session, seatId, `${card.name} begins the game on the battlefield.`);
}

export function resolveAgentMulligans(seats: PlayerSeat[]) {
  const mulligans: Record<string, number> = {};
  const keptHands: Record<string, boolean> = {};
  const events: GameEvent[] = [];

  const resolvedSeats = seats.map((seat) => {
    if (seat.kind !== "agent") return seat;
    let nextSeat = seat;
    let count = 0;
    while (!agentKeepsHand(nextSeat, count) && count < MULLIGAN_HARD_CAP) {
      if (count >= MULLIGAN_SOFT_CAP && nextSeat.board.hand.some(isLandCard)) break;
      count += 1;
      nextSeat = withOpeningHand(nextSeat, 7, count);
    }
    mulligans[seat.id] = count;
    keptHands[seat.id] = true;
    nextSeat = keepOpeningHandSize(nextSeat, openingHandKeepSize(count));
    events.push({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      seatId: seat.id,
      message: describeMulliganOutcome(seat.name, count)
    });
    return nextSeat;
  });

  return { seats: resolvedSeats, mulligans, keptHands, events };
}

export function agentKeepsHand(seat: PlayerSeat, mulligansTaken = 0) {
  return evaluateOpeningHand(seat, mulligansTaken).keep;
}

// The user's own stated preference: a 4-card hand (mulligan count 4, see openingHandKeepSize below)
// is as far down as it's worth going for a normal bad hand — beyond that the card disadvantage
// outweighs any improvement in quality. MULLIGAN_HARD_CAP is the one exception: a hand that still
// has no land at all past the soft cap is unplayable regardless, so it's worth pushing further,
// up to this absolute safety valve so a persistently landless shuffle can't loop forever.
export const MULLIGAN_SOFT_CAP = 4;
export const MULLIGAN_HARD_CAP = 6;

// This table's house rule: the first mulligan is a free "friendly mulligan" (fresh 7, no cards
// bottomed), and the standard London mulligan (rule 103.5, bottom one card per mulligan) only kicks
// in from the second mulligan onward — so 0 or 1 mulligans both keep 7, 2 keeps 6, 3 keeps 5, etc.
// (Not the plain Comprehensive Rules London mulligan, which would bottom a card on the very first
// mulligan too — deliberately different here, confirmed by the user after a wrong "fix" attempt.)
export function openingHandKeepSize(mulliganCount: number) {
  if (mulliganCount <= 1) return 7;
  return Math.max(1, 8 - mulliganCount);
}

// Spells out the mulligan count explicitly rather than collapsing every non-mulligan outcome into
// a single "kept 7" — the free mulligan (count 1) also keeps 7, so without this the action log gave
// no way to tell "kept the original hand" apart from "mulliganed once, then kept the fresh 7."
// Reported live: a user unable to tell from the log whether an agent had taken its free mulligan.
function describeMulliganOutcome(seatName: string, count: number): string {
  if (count === 0) return `${seatName} kept the original 7.`;
  if (count === 1) return `${seatName} took the free mulligan and kept a fresh 7.`;
  return `${seatName} mulliganed ${count} times and kept ${openingHandKeepSize(count)}.`;
}

export function keepOpeningHandSize(seat: PlayerSeat, keepSize: number, returnCardIds: string[] = [], shuffleReturned = false): PlayerSeat {
  const returnSet = new Set(returnCardIds);
  const chosenReturns = returnCardIds.length > 0 ? seat.board.hand.filter((card) => returnSet.has(card.id)) : seat.board.hand.slice(keepSize);
  const hand = returnCardIds.length > 0 ? seat.board.hand.filter((card) => !returnSet.has(card.id)) : seat.board.hand.slice(0, keepSize);
  const returnedLibraryCards = chosenReturns.map((card) => ({ ...card, zone: "library" as const }));
  const library = [...(seat.library ?? []), ...returnedLibraryCards];
  return {
    ...seat,
    library: shuffleReturned ? shuffleCards(library) : library,
    board: {
      ...seat.board,
      hand
    },
    zones: {
      ...seat.zones,
      hand: hand.length,
      library: (seat.library?.length ?? seat.zones.library) + returnedLibraryCards.length
    }
  };
}

export function withOpeningHand(seat: PlayerSeat, size: number, mulliganCount: number): PlayerSeat {
  const library = makeShuffledLibrary(seat, mulliganCount);
  const hand = library.slice(0, size).map((card) => ({ ...card, zone: "hand" as const }));
  const remainingLibrary = library.slice(size);
  return {
    ...seat,
    library: remainingLibrary,
    board: {
      ...seat.board,
      hand
    },
    zones: {
      ...seat.zones,
      hand: hand.length,
      library: remainingLibrary.length
    }
  };
}

export function makeShuffledLibrary(seat: PlayerSeat, shuffleCount: number) {
  const deckCards = expandDeckCards(seat);
  if (deckCards.length === 0) {
    return Array.from({ length: 99 }, (_, index) =>
      createVisibleFromDeckCard({ name: "Wastes", role: "land" }, [], `${seat.id}-fallback-library-${shuffleCount}-${index}`, "library")
    );
  }
  return shuffleCards(
    deckCards.map((card, index) => createVisibleFromDeckCard(card, seat.deck?.colors ?? [], `${seat.id}-library-${shuffleCount}-${index}-${crypto.randomUUID()}`, "library"))
  );
}

export function expandDeckCards(seat: PlayerSeat) {
  const cards = seat.deck?.cards.filter((card) => card.role !== "commander") ?? [];
  return cards.flatMap((card) => Array.from({ length: card.count }, () => card));
}

// How much an agent wants a looked-at card for Lim-Dûl's Vault (deterministic; higher = keep nearer the top). Lands are
// worth a lot until the seat has ~4 lands, a fair amount until ~7, and little after; spells are worth more the higher their
// mana value, except that something far beyond the seat's current mana is discounted (it can't be cast for a long time).
function limDulCardValue(card: VisibleCard, landCount: number): number {
  if (isLandCard(card)) return landCount < 4 ? 10 : landCount < 7 ? 6 : 2;
  const overBudget = card.manaValue > landCount + 3;
  return 4 + Math.min(card.manaValue, 6) * 0.5 - (overBudget ? 3 : 0);
}

const LIM_DUL_GOOD_CARD_VALUE = 6;
const LIM_DUL_MAX_PAYMENTS = 3;
const LIM_DUL_LIFE_FLOOR = 12; // an agent never pays life that would leave it at or below this
const LIM_DUL_MIN_LIBRARY = 10; // never churn a nearly-empty library

// An AGENT's resolution of Lim-Dûl's Vault (the human gets an interactive flow instead). Deterministic chooser:
//  - Pay 1 life and look again only while fewer than 2 of the 5 looked-at cards are "good" (value >= 6), at most 3 times, only
//    if life stays above 12 and the library has at least 10 cards. The loop is therefore always bounded.
//  - The cards put on the bottom keep the order they were looked at in (unobservable, as with Growing Rites of Itlimoc).
//  - Finally shuffle the rest of the library and put the five last-looked-at cards on top, best card first (it is drawn next).
// The log states only public facts (how much life was paid, that the top cards were arranged), never card names.
export function resolveAgentLimDulVault(session: GameSession, seatId: string, sourceCardName: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  const library = seat.library ?? [];
  if (library.length === 0) return addLibraryLookEvent(session, seatId, `${seat.name} resolves ${sourceCardName}, but the library is empty.`);
  const landCount = seat.board.battlefield.filter((card) => isLandCard(card)).length + seat.board.hand.filter((card) => isLandCard(card)).length;
  let current = library;
  let life = seat.life;
  let payments = 0;
  let looked = current.slice(0, 5);
  while (
    payments < LIM_DUL_MAX_PAYMENTS &&
    life - 1 > LIM_DUL_LIFE_FLOOR &&
    current.length >= LIM_DUL_MIN_LIBRARY &&
    looked.filter((card) => limDulCardValue(card, landCount) >= LIM_DUL_GOOD_CARD_VALUE).length < 2
  ) {
    life -= 1;
    payments += 1;
    current = [...current.slice(looked.length), ...looked];
    looked = current.slice(0, 5);
  }
  const lookedIds = new Set(looked.map((card) => card.id));
  const ordered = [...looked].sort((a, b) => limDulCardValue(b, landCount) - limDulCardValue(a, landCount));
  const rest = shuffleCards(current.filter((card) => !lookedIds.has(card.id)));
  const nextLibrary = [...ordered.map((card) => ({ ...card, zone: "library" as const })), ...rest];
  return {
    ...session,
    seats: session.seats.map((item) => (item.id === seatId ? { ...item, life, library: nextLibrary } : item)),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message:
          payments > 0
            ? `${seat.name} resolves ${sourceCardName}: pays ${payments} life to look again ${payments === 1 ? "once" : `${payments} times`}, shuffles, and puts the last ${looked.length} cards looked at on top of their library in an order of their choosing.`
            : `${seat.name} resolves ${sourceCardName}: looks at the top ${looked.length} cards, pays no life, shuffles, and puts those cards back on top in an order of their choosing.`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

export function isLimDulsVault(name: string | undefined): boolean {
  return Boolean(name) && name!.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase() === "lim-dul's vault";
}

export function addLibraryLookEvent(session: GameSession, seatId: string, message: string): GameSession {
  return {
    ...session,
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

export function basicLandForColor(color: string): string | undefined {
  if (color === "W") return "Plains";
  if (color === "U") return "Island";
  if (color === "B") return "Swamp";
  if (color === "R") return "Mountain";
  if (color === "G") return "Forest";
  return undefined;
}

function createVisibleFromDeckCard(deckCard: { name: string; role?: string; card?: CommanderDeck["cards"][number]["card"] }, colors: string[], id: string, zone: VisibleCard["zone"]): VisibleCard {
  const name = deckCard.card?.name ?? deckCard.name;
  const role = deckCard.role ?? "spell";
  const isLand = role === "land" || ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"].includes(name);
  // A multi-faced card's CardRecord.typeLine/oracleText is Scryfall's *combined* string across
  // both faces (e.g. "Land // Legendary Creature — Demon" for Westvale Abbey // Ormendahl), never
  // meant for gameplay checks. A permanent always starts as its front face (faces[0]), matching
  // what transformPermanent later flips away from and what unlockedFaceIndices defaults to.
  const frontFace = deckCard.card?.faces?.[0];
  const typeLine = frontFace?.typeLine ?? deckCard.card?.typeLine;
  const fallbackTypeLine = fallbackTypeLineForCard(name, role, isLand);
  const isCreature = typeLine?.includes("Creature") ?? fallbackTypeLine.includes("Creature");
  return {
    id,
    name: frontFace?.name ?? name,
    typeLine: typeLine ?? fallbackTypeLine,
    oracleText: frontFace?.oracleText ?? deckCard.card?.oracleText ?? (isLand ? "Tap: Add mana." : `Mock ${role} card. Full rules text will come from card data lookup.`),
    manaCost: frontFace?.manaCost ?? deckCard.card?.manaCost,
    manaValue: deckCard.card?.manaValue ?? fallbackManaValueForCard(name, role, isLand),
    colors: frontFace?.colors ?? deckCard.card?.colors ?? (isLand ? [] : colors.slice(0, 1)),
    colorIdentity: deckCard.card?.colorIdentity ?? colors,
    producedMana: deckCard.card?.producedMana,
    imageUris: frontFace?.imageUris ?? deckCard.card?.imageUris,
    faces: deckCard.card?.faces,
    unlockedFaceIndices: deckCard.card?.faces ? [0] : undefined,
    role,
    zone,
    power: frontFace?.power ?? deckCard.card?.power ?? (isCreature ? "2" : undefined),
    toughness: frontFace?.toughness ?? deckCard.card?.toughness ?? (isCreature ? "2" : undefined),
    loyalty: frontFace?.loyalty ?? deckCard.card?.loyalty
  };
}

function fallbackTypeLineForCard(name: string, role: string, isLand: boolean) {
  if (isLand) return "Land";
  if (isKnownManaArtifact(name)) return "Artifact";
  if (role === "removal" || role === "protection") return "Instant";
  if (["creature", "synergy", "wincon", "draw"].includes(role)) return "Creature - Spell";
  return "Spell";
}

function fallbackManaValueForCard(name: string, role: string, isLand: boolean) {
  if (isLand) return 0;
  if (name === "Sol Ring" || name === "Wayfarer's Bauble") return 1;
  if (isKnownManaArtifact(name)) return 2;
  if (role === "removal") return 2;
  if (role === "ramp") return 2;
  return 4;
}

function isKnownManaArtifact(name: string) {
  const lower = name.toLowerCase();
  return lower === "sol ring" || lower.includes("signet") || lower.includes("talisman") || lower === "wayfarer's bauble";
}
