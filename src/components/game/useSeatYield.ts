// "Yield until end of turn" for every human seat (the host's own and each friend's): the toggle handler (button, Shift+Space, a friend's onToggleYield intent)
// and the effect that ends a yield and logs why. The decision itself is the pure yieldPolicy.ts, consulted by priority.ts for every window; this effect only
// clears the stored yield with the SAME facts (turn over, attacked, a spell aimed at the seat, Full Control) so the badge and the log stay truthful.
import { useEffect, useRef } from "react";
import { yieldMomentFor } from "@/engine/priority";
import { toggleYield, withoutYields, yieldCancelReason } from "@/engine/yieldPolicy";
import { type GameContext, lateFn } from "./context";

export function useSeatYield(ctx: GameContext) {
  const { session, activeSeatId, prioritySeatId, mode, gameStage, humanSeat } = ctx;
  const { pendingAction, priorityStopSettings, holdPriorityOnce, seatYields, setSeatYields } = ctx.stack;
  const addEvent = lateFn(ctx, "addEvent");
  const passPriority = lateFn(ctx, "passPriority");
  const loggedEnd = useRef(new Set<string>());

  // Button / Space shortcut / intent: start the yield for the current turn, or cancel the running one.
  function toggleSeatYield(seatId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat || seat.kind !== "human" || seat.hasLost) return;
    if (seatYields[seatId]) {
      setSeatYields((current) => withoutYields(current, [seatId]));
      addEvent("Yield ended: you cancelled it.", seatId);
      return;
    }
    setSeatYields((current) => toggleYield(current, seatId, session.turn, activeSeatId));
    addEvent(`${seat.id === humanSeat.id ? "You yield" : `${seat.name} yields`} until end of turn.`, seatId);
    // A window is already waiting on this seat: yielding answers it too.
    if (pendingAction && prioritySeatId === seatId) passPriority();
  }

  useEffect(() => {
    if (mode !== "game" || gameStage !== "playing" || Object.keys(seatYields).length === 0) return;
    const ended: Array<{ seatId: string; reason: string }> = [];
    for (const [seatId, seatYield] of Object.entries(seatYields)) {
      const seat = session.seats.find((item) => item.id === seatId);
      if (!seat) continue;
      const reason = seat.hasLost ? "you are out of the game" : yieldCancelReason(seatYield, yieldMomentFor(seat, pendingAction, session, activeSeatId, priorityStopSettings, holdPriorityOnce && seat.id === humanSeat.id ? seat.id : undefined));
      if (reason) ended.push({ seatId, reason });
    }
    if (ended.length === 0) return;
    setSeatYields((current) => withoutYields(current, ended.map((item) => item.seatId)));
    for (const { seatId, reason } of ended) {
      const key = `${seatId}:${session.turn}:${reason}`;
      if (loggedEnd.current.has(key)) continue;
      loggedEnd.current.add(key);
      addEvent(`Yield ended: ${reason}.`, seatId);
    }
  }, [mode, gameStage, seatYields, session.turn, session.phase, session.seats, pendingAction, activeSeatId, priorityStopSettings, holdPriorityOnce]);

  return { toggleSeatYield };
}
