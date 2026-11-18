// Host side of GAME intents from seated friends (M4 stage 3: the opening-hand intents). Used by useMpHost with one line:
//   const gameIntentRef = useMpIntents(ctx, enabled);   // and onmessage forwards `intent` events to gameIntentRef.current
//
// Why a queue: every host handler (keepOpeningHand, ...) closes over the state of the render it was created in. Two intents run back to back in
// one tick would both see the same stale state (the second would not see the first's effect). So intents wait in an in-order queue and ONE is
// processed per React commit (an effect with no deps), with `ctx.late` holding that commit's handlers - the same handlers the host's own UI clicks use.
//
// Safety: only names in the registry below are runnable (a whitelist, not "any handler by name"); every entry validates its args with zod and
// is called as the sender's seat, taken from the slot -> seat map (never from args); slots that hold no seat are rejected. The pure parts
// (registry, dispatchIntent, IntentQueue) are in lib/multiplayer/intentDispatch.ts and tested without React.
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { z } from "zod";
import { IntentQueue, dispatchIntent, type IntentEvent, type IntentRegistry } from "@/lib/multiplayer/intentDispatch";
import { isLobbyIntentName } from "@/lib/multiplayer/lobby";
import { seatForSlot } from "@/lib/multiplayer/seatMap";
import type { GameContext, HandlerApi } from "./context";

/** What the registry needs from the host: the (late-bound) handlers and a read of the current stage. */
export interface MpIntentDeps {
  handlers: Pick<HandlerApi, "keepOpeningHand" | "mulliganOpeningHand" | "toggleMulliganReturnCard">;
  /** True while the game is in the opening-hand step. */
  inMulligan: () => boolean;
  /** Has this seat already kept its hand? */
  hasKept: (seatId: string) => boolean;
}

/**
 * The whitelist: wire name (the table's callback name, see intentProxy.ts) -> validation + seat check + call. The acting seat is always the sender's.
 * Later stages add priority/stack/combat/prompt intents here.
 */
export function buildMpIntentRegistry(deps: MpIntentDeps): IntentRegistry {
  const duringOpeningHand = (seatId: string) => (!deps.inMulligan() ? "not in the opening-hand step" : deps.hasKept(seatId) ? "already kept" : undefined);
  return {
    onKeepHand: { schema: z.tuple([]), check: duringOpeningHand, call: (seatId) => deps.handlers.keepOpeningHand(seatId) },
    onMulligan: { schema: z.tuple([]), check: duringOpeningHand, call: (seatId) => deps.handlers.mulliganOpeningHand(seatId) },
    onToggleMulliganReturnCard: {
      schema: z.tuple([z.string().min(1).max(200)]),
      check: duringOpeningHand,
      call: (seatId, cardId: string) => deps.handlers.toggleMulliganReturnCard({ id: cardId }, seatId)
    }
  };
}

type Listener = (event: IntentEvent) => void;

/** Returns a ref whose `.current` takes the relay's `intent` events (the host stream calls it). */
export function useMpIntents(ctx: GameContext, enabled: boolean): MutableRefObject<Listener | undefined> {
  const queueRef = useRef(new IntentQueue());
  const listenerRef = useRef<Listener | undefined>(undefined);
  const [, setTick] = useState(0);

  listenerRef.current = (event) => {
    if (!enabled || isLobbyIntentName(event.name)) return; // lobby intents belong to useMpLobby
    if (queueRef.current.push(event)) setTick((n) => n + 1);
  };

  // No deps on purpose: runs after every commit, so each queued intent sees that commit's state and handlers.
  useEffect(() => {
    if (!enabled) return;
    const event = queueRef.current.shift();
    if (!event) return;
    if (ctx.mode === "game") {
      const registry = buildMpIntentRegistry({
        handlers: ctx.late,
        inMulligan: () => ctx.gameStage === "mulligan",
        hasKept: (seatId) => Boolean(ctx.choices.keptHandsRef.current[seatId])
      });
      const result = dispatchIntent(registry, event, (slot) => seatForSlot(ctx.session, slot));
      if (!result.ok) console.warn(`[mp] intent ${event.name} from ${event.fromSeatId} refused: ${result.reason}`);
    }
    if (queueRef.current.length > 0) setTick((n) => n + 1);
  });

  return listenerRef;
}
