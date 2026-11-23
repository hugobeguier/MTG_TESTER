// Multiplayer host publisher (M3). When enabled: creates a relay room, keeps the host SSE stream open, tracks guests and publishes a filtered
// SPECTATOR snapshot whenever the game state changes. It only READS the game context - it never changes game behaviour. Disabled: does nothing.
// Pure logic lives in src/lib/multiplayer (snapshot.ts, connectionState.ts); this file is the React/network glue. See src/lib/multiplayer/README.md.
import { useEffect, useReducer, useRef } from "react";
import { pendingActionRequiredPasses, withPendingActionSourceCard } from "@/engine/priority";
import type { PendingActionView } from "@/components/ThreeGameTable";
import { PublishGate, hostReducer, initialHostState, connectedGuests, type HostState } from "@/lib/multiplayer/connectionState";
import { hostGameStore, hostStatusStore } from "@/lib/multiplayer/hostStatusStore";
import type { HostEvent } from "@/lib/multiplayer/protocol";
import { buildSnapshot, snapshotFingerprint, type SnapshotInput } from "@/lib/multiplayer/snapshot";
import { publishDelayMs } from "@/lib/multiplayer/publishTiming";
import { seatForSlot } from "@/lib/multiplayer/seatMap";
import { SPECTATOR_VIEWER } from "@/lib/multiplayer/view";
import type { GameContext } from "./context";
import { useMpIntents } from "./mpIntents";
import { useMpLobby } from "./useMpLobby";

/** The name friends see for the host (the host's own seat stays "You" internally: engine wording depends on it). */
export const DEFAULT_HOST_NAME = "Hugo";

export interface MpHostConfig {
  enabled: boolean;
  hostName?: string;
}

export async function post(path: string, token: string | null, body: unknown, keepalive = false) {
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
    requiredPasses: pendingAction ? pendingActionRequiredPasses(session.seats, pendingAction, activeSeatId, session, ctx.mana.manaPools, priorityStopSettings, holdPriorityOnce ? humanSeat.id : undefined, undefined, stackActions) : [],
    pendingAction: pendingAction ? view(pendingAction) : undefined,
    stackActions: stackActions.map(view),
    gameStage: gameStage === "kernel" ? "playing" : gameStage,
    mulligans: ctx.choices.mulligans,
    hostManaPool: ctx.mana.manaPools[humanSeat.id],
    manaPools: ctx.mana.manaPools,
    keptHands: ctx.choices.keptHands,
    mulliganReturnCardIds: ctx.choices.mulliganReturnCardIds,
    prompts: {
      pendingRuleChoice: ctx.choices.pendingRuleChoice,
      libraryLook: ctx.choices.libraryLook,
      blockChoice: ctx.choices.blockChoice,
      manaChoice: ctx.mana.manaChoice,
      myriadTapChoice: ctx.choices.myriadTapChoice,
      myriadSearch: ctx.choices.myriadSearch,
      basicLandFetchSearch: ctx.choices.basicLandFetchSearch,
      manualLibrarySearch: ctx.choices.manualLibrarySearch
    },
    landPlayed: Object.fromEntries(session.seats.filter((seat) => seat.kind === "human").map((seat) => [seat.id, ctx.late.hasPlayedLandThisTurn(seat.id, session.turn)])),
    pausedFor: ctx.mpPausedFor,
    sandbox: ctx.sandboxMode,
    seatStops: ctx.stack.seatStops,
    yieldingSeatIds: Object.keys(ctx.stack.seatYields)
  };
}

export function useMpHost(ctx: GameContext, config: MpHostConfig): HostState {
  const { enabled } = config;
  const hostName = config.hostName ?? DEFAULT_HOST_NAME;
  const [state, dispatch] = useReducer(hostReducer, initialHostState);
  const tokenRef = useRef<string | null>(null);
  // One gate per guest slot: each guest gets its own view (a seated friend's hand, a spectator's stubs), so each has its own rev/fingerprint.
  const gatesRef = useRef(new Map<string, PublishGate>());
  const gateFor = (slot: string) => {
    let gate = gatesRef.current.get(slot);
    if (!gate) gatesRef.current.set(slot, (gate = new PublishGate()));
    return gate;
  };
  const latestRef = useRef({ ctx, hostName, guestSlots: [] as string[], enabled });
  latestRef.current = { ctx, hostName, guestSlots: connectedGuests(state).map((g) => g.seatId), enabled };
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const intentRef = useRef<((event: Extract<HostEvent, { type: "intent" }>) => void) | undefined>(undefined);

  // Mirror state for the MpHostPanel (rendered beside AppFlow).
  useEffect(() => {
    if (enabled) hostStatusStore.set(state);
  }, [enabled, state]);

  // One slot at a time per guest (a slow POST to one friend must not hold up another guest's snapshot); a change that lands while a slot's POST is in
  // flight marks it dirty and is published right after, from the then-current game.
  const slotsRef = useRef(new Map<string, { inFlight: boolean; dirty: boolean }>());
  const inputCacheRef = useRef<{ ctx: GameContext; name: string; input: SnapshotInput } | undefined>(undefined);
  const lastPublishAtRef = useRef<number | undefined>(undefined);

  async function publishSlot(slot: string) {
    let state = slotsRef.current.get(slot);
    if (!state) slotsRef.current.set(slot, (state = { inFlight: false, dirty: false }));
    if (state.inFlight) {
      state.dirty = true;
      return;
    }
    state.inFlight = true;
    try {
      do {
        state.dirty = false;
        const token = tokenRef.current;
        const { ctx: live, hostName: name, guestSlots, enabled: on } = latestRef.current;
        if (!token || !on || !guestSlots.includes(slot) || live.mode !== "game") return;
        // The (costly) game read is shared by all slots of one render.
        let cached = inputCacheRef.current;
        if (!cached || cached.ctx !== live || cached.name !== name) inputCacheRef.current = cached = { ctx: live, name, input: readSnapshotInput(live, name) };
        const input = cached.input;
        // A guest sitting at a remote seat gets that seat's view; a guest without a seat (late joiner) is a spectator.
        const seatId = seatForSlot(live.session, slot);
        const snapshot = buildSnapshot(seatId ? { ...input, ack: acksRef.current[slot] } : input, seatId ?? SPECTATOR_VIEWER);
        const gate = gateFor(slot);
        const rev = gate.admit(snapshotFingerprint(snapshot));
        if (rev === undefined) continue;
        const startedAt = performance.now();
        const body = { toSeatId: slot, snapshot: { ...snapshot, rev }, rev };
        try {
          await post("/api/mp/publish", token, body);
          if ((window as unknown as { __mpTiming?: boolean }).__mpTiming) { // opt-in dev probe: set window.__mpTiming = true in the host tab
            console.info(`[mp] publish ${slot} rev ${rev}: ${Math.round(performance.now() - startedAt)} ms, ${JSON.stringify(body).length} bytes`);
          }
        } catch (e) {
          gate.failed();
          dispatch({ type: "error", message: `Publish failed: ${e instanceof Error ? e.message : String(e)}` });
        }
      } while (state.dirty);
    } finally {
      state.inFlight = false;
    }
  }

  function publishNow() {
    lastPublishAtRef.current = Date.now();
    inputCacheRef.current = undefined;
    for (const slot of latestRef.current.guestSlots) void publishSlot(slot);
  }

  function schedule() {
    if (timerRef.current) return; // a pending publish is never pushed back: it will read the newest game state when it fires
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      publishNow();
    }, publishDelayMs(Date.now(), lastPublishAtRef.current));
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
            if (event.type === "intent") {
              intentRef.current?.(event); // lobby intents (setup screen)
              gameIntentRef.current?.(event); // game intents (opening hand, later priority/stack/...)
            }
            if (event.type === "guest_joined") gateFor(event.seatId).force();
            if (event.type === "host_ready") for (const g of event.guests) gateFor(g.seatId).force();
            dispatch({ type: "event", event });
            if (event.type === "guest_joined" || event.type === "host_ready") {
              if (event.type === "guest_joined" && !latestRef.current.guestSlots.includes(event.seatId)) latestRef.current.guestSlots = [...latestRef.current.guestSlots, event.seatId];
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
      timerRef.current = undefined;
      const token = tokenRef.current;
      tokenRef.current = null;
      if (token) void post("/api/mp/close", token, {}, true).catch(() => {});
      dispatch({ type: "reset" });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const { session, activeSeatId, prioritySeatId, gameStage, mode } = ctx;
  // Friends whose seat is taken but whose connection is gone: the game waits for them (every game effect is gated by ctx.mpPausedFor).
  const connectedSlots = new Set(connectedGuests(state).map((g) => g.seatId));
  const absent = enabled && mode === "game" ? session.seats.filter((seat) => seat.remoteSlot !== undefined && !seat.hasLost && !connectedSlots.has(seat.remoteSlot)).map((seat) => seat.name) : [];
  const absentKey = JSON.stringify(absent);
  // The panel chip (components/MpHostPanel.tsx) needs the app mode and who the game is paused for.
  useEffect(() => {
    if (enabled) hostGameStore.set({ mode, pausedFor: absent });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, mode, absentKey]);
  useEffect(() => {
    ctx.setMpPausedFor((current) => (JSON.stringify(current) === absentKey ? current : absent));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [absentKey]);
  const { listenerRef: gameIntentRef, acks } = useMpIntents(ctx, enabled, absent.length > 0);
  const acksRef = useRef(acks);
  acksRef.current = acks;
  // Publish on every relevant game-state change (debounced; unchanged snapshots are skipped by the gate).
  const { pendingAction, stackActions, priorityPasses } = ctx.stack;
  const guestKey = connectedGuests(state)
    .map((g) => g.seatId)
    .join(",");
  useEffect(() => {
    if (!enabled) return;
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, session, activeSeatId, prioritySeatId, gameStage, mode, pendingAction, stackActions, priorityPasses, ctx.choices.mulligans, ctx.choices.keptHands, ctx.choices.mulliganReturnCardIds, ctx.mana.manaPools, guestKey, acks, ctx.mpPausedFor, ctx.stack.seatStops, ctx.stack.seatYields, ctx.choices.pendingRuleChoice, ctx.choices.libraryLook, ctx.choices.blockChoice, ctx.mana.manaChoice, ctx.choices.myriadTapChoice, ctx.choices.myriadSearch, ctx.choices.basicLandFetchSearch, ctx.choices.manualLibrarySearch]);

  useMpLobby({ ctx, state, enabled, hostName, tokenRef, intentRef, post, removeGuest: (slot) => dispatch({ type: "guest_removed", seatId: slot }) });

  return state;
}
