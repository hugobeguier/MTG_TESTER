// Small game-mutation primitives used everywhere: addEvent, changeLife, moving cards between zones, counters, land-play queries, human-action-blocked-by-choice guard.
// Part of the AppFlow() split: shared state arrives through `ctx` (see ./context.ts); handlers owned by other hooks are called through `lateFn` so every hook sees the current render's functions.
import { applyCounterDelta, moveCardBetweenVisibleZones } from "@/engine/zones";
import { commonTriggerEffect } from "@/engine/triggers";
import { findCommonTriggersForPermanentDied } from "@/engine/triggerFinders";
import { landDropsAllowed, landPlaysMade, landTurnKey } from "@/engine/lands";
import { applySeatStopChange, seatStopSettingsOf, type SeatStopChange } from "@/lib/multiplayer/seatStops";
import { type GameContext, lateFn } from "./context";

export function useGameActions(ctx: GameContext) {
  const { session, setSession, setSelectedHandCardId, setInspectedCard, humanSeat } = ctx;
  const { pendingRuleChoice, choiceMinimized } = ctx.choices;
  const { landPlaysThisTurn } = ctx.turn;
  const consultRulesAdvisor = lateFn(ctx, "consultRulesAdvisor");
  const queueCommonTriggers = lateFn(ctx, "queueCommonTriggers");

  // True (and logs why) when the human tried to act while a minimized choice is still waiting for an answer. Acting then could overwrite
  // the parked choice or resolve things out of order, so the player resumes it first. Agents' actions are never blocked.
  function humanActionBlockedByChoice(seatId?: string): boolean {
    if (!choiceMinimized) return false;
    if (seatId !== undefined && seatId !== humanSeat.id) return false;
    const prompt = pendingRuleChoice && "prompt" in pendingRuleChoice ? pendingRuleChoice.prompt : undefined;
    addEvent(`Finish the pending choice first${prompt ? ` (${prompt})` : ""} — press Resume at the top of the board.`, humanSeat.id, "Rules action");
    return true;
  }

  function addEvent(message: string, seatId?: string, detail?: string) {
    setSession((current) => ({
      ...current,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message,
          detail
        },
        ...current.events
      ]
    }));
  }

  function hasPlayedLandThisTurn(seatId: string, turn: number) {
    const seat = session.seats.find((item) => item.id === seatId);
    return landPlaysMade(landPlaysThisTurn.current, landTurnKey(seatId, turn)) >= (seat ? landDropsAllowed(seat) : 1);
  }

  // A remote friend toggled one of THEIR stop controls (Full Control, Stop Next, the grid): updates that seat's own settings (never the host's).
  function updateSeatStops(seatId: string, change: SeatStopChange) {
    const index = session.seats.findIndex((seat) => seat.id === seatId);
    if (index < 0) return;
    ctx.stack.setSeatStops((current) => ({ ...current, [seatId]: applySeatStopChange(seatStopSettingsOf({ bySeat: current }, seatId, index, session.seats.length), change) }));
  }

  function changeLife(seatId: string, delta: number) {
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) => (seat.id === seatId ? { ...seat, life: Math.max(0, seat.life + delta) } : seat)),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${current.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} ${delta > 0 ? "gains" : "loses"} ${Math.abs(delta)} life.`
        },
        ...current.events
      ]
    }));
  }

  function moveCardToGraveyard(seatId: string, cardId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.hand.find((item) => item.id === cardId) ?? seat?.board.battlefield.find((item) => item.id === cardId) ?? seat?.board.exile?.find((item) => item.id === cardId);
    setSelectedHandCardId(undefined);
    setInspectedCard(undefined);
    const nextSession = moveCardBetweenVisibleZones(session, seatId, cardId, "graveyard");
    const triggers = card && card.zone === "battlefield" ? findCommonTriggersForPermanentDied(nextSession, seatId, card) : [];
    setSession(nextSession);
    // See the matching guard in resolvePendingAction: skip the advisor when the deterministic
    // common-trigger system already owns this card's death clause, to avoid double-resolving it
    // (or, for effect kinds outside the advisor's workflow enum, risking an Ollama hallucination).
    if (card && card.zone === "battlefield" && commonTriggerEffect(card.oracleText, "died") === undefined) {
      void consultRulesAdvisor("card_moved_to_graveyard", seatId, card);
    }
    if (triggers.length > 0) {
      window.setTimeout(() => queueCommonTriggers(triggers), 0);
    }
  }

  function moveCardToExile(seatId: string, cardId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card =
      seat?.board.hand.find((item) => item.id === cardId) ??
      seat?.board.battlefield.find((item) => item.id === cardId) ??
      seat?.board.graveyard?.find((item) => item.id === cardId);
    setSelectedHandCardId(undefined);
    setInspectedCard(undefined);
    setSession((current) => moveCardBetweenVisibleZones(current, seatId, cardId, "exile"));
    if (card) void consultRulesAdvisor("card_moved_to_exile", seatId, card);
  }

  function moveCardToHand(seatId: string, cardId: string) {
    setSession((current) => moveCardBetweenVisibleZones(current, seatId, cardId, "hand"));
  }

  function moveBattlefieldCard(seatId: string, cardId: string, position: { x: number; z: number }) {
    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) =>
        seat.id === seatId
          ? {
              ...seat,
              board: {
                ...seat.board,
                battlefield: seat.board.battlefield.map((card) => (card.id === cardId ? { ...card, battlefieldPosition: position } : card))
              }
            }
          : seat
      )
    }));
  }

  function changeCounter(seatId: string, cardId: string, kind: string, delta: number) {
    setSession((current) => {
      const next = {
        ...current,
        seats: current.seats.map((seat) =>
          seat.id === seatId
            ? {
                ...seat,
                board: {
                  ...seat.board,
                  battlefield: seat.board.battlefield.map((card) => (card.id === cardId ? applyCounterDelta(card, kind, delta) : card))
                }
              }
            : seat
        ),
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId,
            message: `${current.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} ${delta > 0 ? "adds" : "removes"} a ${kind} counter ${delta > 0 ? "to" : "from"} ${
              current.seats.find((seat) => seat.id === seatId)?.board.battlefield.find((card) => card.id === cardId)?.name ?? "a permanent"
            }.`
          },
          ...current.events
        ]
      };
      return next;
    });
  }

  return { addEvent, changeCounter, changeLife, hasPlayedLandThisTurn, humanActionBlockedByChoice, moveBattlefieldCard, updateSeatStops, moveCardToExile, moveCardToGraveyard, moveCardToHand };
}
