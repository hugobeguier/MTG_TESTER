// Multiplayer host publisher (M3). When enabled: creates a relay room, keeps the host SSE stream open, tracks guests and publishes a filtered
// SPECTATOR snapshot whenever the game state changes. It only READS the game context - it never changes game behaviour. Disabled: does nothing.
// Pure logic lives in src/lib/multiplayer (snapshot.ts, connectionState.ts); this file is the React/network glue. See src/lib/multiplayer/README.md.
import { useEffect, useReducer, useRef } from "react";
import { pendingActionRequiredPasses, withPendingActionSourceCard } from "@/engine/priority";
import type { PendingActionView } from "@/components/ThreeGameTable";
import { PublishGate, hostReducer, initialHostState, connectedGuests, type HostState } from "@/lib/multiplayer/connectionState";
import { hostStatusStore } from "@/lib/multiplayer/hostStatusStore";
import type { HostEvent } from "@/lib/multiplayer/protocol";
import { buildSnapshot, snapshotFingerprint, type SnapshotInput } from "@/lib/multiplayer/snapshot";
import { SPECTATOR_VIEWER } from "@/lib/multiplayer/view";
import type { GameContext } from "./context";

export interface MpHostConfig {
  enabled: boolean;
  hostName?: string;
}

export const PUBLISH_DEBOUNCE_MS = 150;

async function post(path: string, token: string | null, body: unknown, keepalive = false) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    keepalive
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error((json as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
  return json;
}

/** Reads the live game out of the context in the shape snapshot.ts wants (stack items get their source card, as the table expects). */
function readSnapshotInput(ctx: GameContext, hostName: string): SnapshotInput {
  const { session, humanSeat, activeSeatId, prioritySeatId, gameStage } = ctx;
  const { pendingAction, stackActions, priorityPasses, priorityStopSettings, holdPriorityOnce } = ctx.stack;
  const view = (action: NonNullable<typeof pendingAction>) => withPendingActionSourceCard(session, action, stackActions) as unknown as PendingActionView;
  return {
    session,
    hostName,
    activeSeatId,
    prioritySeatId,
    priorityPasses,
    requiredPasses: pendingAction ? pendingActionRequiredPasses(session.seats, pendingAction, activeSeatId, session, ctx.mana.manaPools, priorityStopSettings, holdPriorityOnce ? humanSeat.id : undefined) : [],
    pendingAction: pendingAction ? view(pendingAction) : undefined,
    stackActions: stackActions.map(view),
    gameStage,
    mulligans: ctx.choices.mulligans,
    hostManaPool: ctx.mana.manaPools[humanSeat.id]
  };
}

export function useMpHost(ctx: GameContext, config: MpHostConfig): HostState {
  const { enabled } = config;
  const hostName = config.hostName ?? "Host";
  const [state, dispatch] = useReducer(hostReducer, initialHostState);
  const tokenRef = useRef<string | null>(null);
  const gateRef = useRef(new PublishGate());
  const latestRef = useRef({ ctx, hostName, guestCount: 0, enabled });
  latestRef.current = { ctx, hostName, guestCount: connectedGuests(state).length, enabled };
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlightRef = useRef(false);
  const dirtyRef = useRef(false);

  // Mirror state for the MpHostPanel (rendered beside AppFlow).
  useEffect(() => {
    if (enabled) hostStatusStore.set(state);
  }, [enabled, state]);

  async function publishNow() {
    const token = tokenRef.current;
    const { ctx: live, hostName: name, guestCount, enabled: on } = latestRef.current;
    if (!token || !on || guestCount === 0 || live.mode !== "game") return;
    if (inFlightRef.current) {
      dirtyRef.current = true;
      return;
    }
    const snapshot = buildSnapshot(readSnapshotInput(live, name), SPECTATOR_VIEWER);
    const rev = gateRef.current.admit(snapshotFingerprint(snapshot));
    if (rev === undefined) return;
    inFlightRef.current = true;
    try {
      // Every guest is a spectator in M3, so one identical snapshot goes to all slots. M4 will send per-seat views here.
      await post("/api/mp/publish", token, { toSeatId: "all", snapshot: { ...snapshot, rev }, rev });
    } catch (e) {
      gateRef.current.failed();
      dispatch({ type: "error", message: `Publish failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      inFlightRef.current = false;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        schedule();
      }
    }
  }

  function schedule() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void publishNow(), PUBLISH_DEBOUNCE_MS);
  }

  // Room + host stream lifecycle.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let source: EventSource | undefined;
    dispatch({ type: "creating" });
    (async () => {
      try {
        const room = (await post("/api/mp/rooms", null, { hostName })) as { roomCode: string; hostToken: string };
        if (cancelled) {
          void post("/api/mp/close", room.hostToken, {}).catch(() => {});
          return;
        }
        tokenRef.current = room.hostToken;
        dispatch({ type: "created", roomCode: room.roomCode });
        source = new EventSource(`/api/mp/stream?token=${encodeURIComponent(room.hostToken)}`);
        source.onopen = () => dispatch({ type: "stream_open" });
        source.onerror = () => dispatch({ type: "stream_lost" });
        source.onmessage = (message) => {
          try {
            const event = JSON.parse(message.data) as HostEvent;
            if (event.type === "guest_joined" || event.type === "host_ready") gateRef.current.force();
            dispatch({ type: "event", event });
            if (event.type === "guest_joined" || event.type === "host_ready") {
              latestRef.current.guestCount = Math.max(1, latestRef.current.guestCount);
              schedule();
            }
          } catch {
            /* ignore malformed frames */
          }
        };
      } catch (e) {
        if (!cancelled) dispatch({ type: "error", message: `Could not create room: ${e instanceof Error ? e.message : String(e)}` });
      }
    })();
    return () => {
      cancelled = true;
      source?.close();
      if (timerRef.current) clearTimeout(timerRef.current);
      const token = tokenRef.current;
      tokenRef.current = null;
      if (token) void post("/api/mp/close", token, {}, true).catch(() => {});
      dispatch({ type: "reset" });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Publish on every relevant game-state change (debounced; unchanged snapshots are skipped by the gate).
  const { session, activeSeatId, prioritySeatId, gameStage, mode } = ctx;
  const { pendingAction, stackActions, priorityPasses } = ctx.stack;
  const guestKey = connectedGuests(state)
    .map((g) => g.seatId)
    .join(",");
  useEffect(() => {
    if (!enabled) return;
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, session, activeSeatId, prioritySeatId, gameStage, mode, pendingAction, stackActions, priorityPasses, ctx.choices.mulligans, ctx.mana.manaPools, guestKey]);

  return state;
}
