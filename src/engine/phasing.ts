// Phasing (rule 702.26). A phased-out permanent is treated as though it does not exist: it does not trigger, its static abilities do not apply,
// it can't be targeted/attacked/blocked and it is not counted ("creatures you control", devotion, cost reducers). The engine encodes that by
// skipping `phasedOut` cards at every trigger finder / static-effect aggregation (see docs/ARCHITECTURE.md "Phasing").
//
// Direct phasing (Vanishing's Aura ability, the Phasing keyword): the permanent itself carries `phasedOut`. Permanents attached to it (Auras,
// Equipment, Fortifications) phase out WITH it ("indirectly": `phasedOutIndirectly`) and phase in with it; they never phase in on their own.
// Phasing in happens only as the first turn-based action of the untap step of the permanent's controller (applyPhasingStep, called by untapForSeat).
//
// UI signal: every phase change appends a GameEvent with `phasing: { cardId, direction }` and the message "<Card> phases out." / "<Card> phases in.",
// so the table can animate it; the card view carries the steady-state `phasedOut` flag.
import type { GameEvent, GameSession, VisibleCard } from "@/lib/types";

function phasingEvent(seatId: string, card: VisibleCard, direction: "out" | "in", via?: string): GameEvent {
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    seatId,
    message: `${card.name} phases ${direction}.${via ? ` (${via})` : ""}`,
    detail: "Rules action",
    phasing: { cardId: card.id, direction }
  };
}

function hasPhasingKeyword(card: VisibleCard) {
  return !card.abilitiesStripped && /^phasing\b/im.test(card.oracleText);
}

// Phases the given permanent out, plus everything attached to it. No-op when it is not on a battlefield or already phased out.
export function phaseOutPermanent(session: GameSession, cardId: string): GameSession {
  return phaseSet(session, [cardId], []);
}

// Shared engine: `outIds` phase out (with their attachments), `inIds` phase in (with their attachments), simultaneously.
function phaseSet(session: GameSession, outIds: string[], inIds: string[]): GameSession {
  const events: GameEvent[] = [];
  const allCards = session.seats.flatMap((seat) => seat.board.battlefield.map((card) => ({ seatId: seat.id, card })));
  const attachedTo = (hostId: string) => allCards.filter(({ card }) => card.attachedToId === hostId && !hasPhasingKeyword(card)).map(({ card }) => card.id);
  const outAll = new Map<string, string | undefined>(); // id -> host name when indirect
  const inAll = new Map<string, string | undefined>();
  for (const id of outIds) {
    const host = allCards.find((entry) => entry.card.id === id)?.card;
    if (!host || host.phasedOut) continue;
    outAll.set(id, undefined);
    for (const attachedId of attachedTo(id)) if (!allCards.find((entry) => entry.card.id === attachedId)?.card.phasedOut) outAll.set(attachedId, host.name);
  }
  for (const id of inIds) {
    const host = allCards.find((entry) => entry.card.id === id)?.card;
    if (!host || !host.phasedOut) continue;
    inAll.set(id, undefined);
    for (const attachedId of attachedTo(id)) if (allCards.find((entry) => entry.card.id === attachedId)?.card.phasedOutIndirectly) inAll.set(attachedId, host.name);
  }
  if (outAll.size === 0 && inAll.size === 0) return session;
  const seats = session.seats.map((seat) => ({
    ...seat,
    board: {
      ...seat.board,
      battlefield: seat.board.battlefield.map((card) => {
        if (outAll.has(card.id)) {
          const via = outAll.get(card.id);
          events.push(phasingEvent(seat.id, card, "out", via ? `with ${via}` : undefined));
          // Rule 506.4-ish: a permanent that phases out leaves combat.
          return { ...card, phasedOut: true, phasedOutIndirectly: via ? true : undefined, attacking: false, blocking: false, attackTargetId: undefined, blockingTargetId: undefined, extraBlockingTargetId: undefined };
        }
        if (inAll.has(card.id)) {
          const via = inAll.get(card.id);
          events.push(phasingEvent(seat.id, card, "in", via ? `with ${via}` : undefined));
          return { ...card, phasedOut: false, phasedOutIndirectly: undefined };
        }
        return card;
      })
    }
  }));
  return { ...session, seats, events: [...events.reverse(), ...session.events] };
}

// The first turn-based action of `seatId`'s untap step: its directly phased-out permanents phase in and its phased-in permanents with phasing
// phase out, simultaneously (attachments follow their host). Everything phased in then untaps normally in the same step.
export function applyPhasingStep(session: GameSession, seatId: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  const inIds = seat.board.battlefield.filter((card) => card.phasedOut && !card.phasedOutIndirectly).map((card) => card.id);
  const outIds = seat.board.battlefield.filter((card) => !card.phasedOut && hasPhasingKeyword(card)).map((card) => card.id);
  return phaseSet(session, outIds, inIds);
}
