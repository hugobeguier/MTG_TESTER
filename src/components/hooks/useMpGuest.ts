// Guest side of multiplayer: joins a room, holds the relay stream open (auto-reconnect with backoff; the relay replays the last snapshot) and exposes
// the latest snapshot. State transitions are the pure guestReducer in src/lib/multiplayer/connectionState.ts.
import { useCallback, useEffect, useReducer, useRef } from "react";
import { guestReducer, initialGuestState, reconnectDelayMs, type GuestState } from "@/lib/multiplayer/connectionState";
import { POLL_INTERVAL_MS, STREAM_OPEN_TIMEOUT_MS, chooseTransport, diagnosticsReducer, forcePollRequested, initialDiagnostics, type GuestDiagnostics } from "@/lib/multiplayer/guestTransport";
import type { GuestEvent } from "@/lib/multiplayer/protocol";
import { isLobbyMessage } from "@/lib/multiplayer/lobby";
import { isMpSnapshot } from "@/lib/multiplayer/snapshot";

const storageKey = (code: string) => `mtg-mp-seat:${code}`;

function readToken(code: string): string | undefined {
  try {
    return sessionStorage.getItem(storageKey(code)) ?? undefined;
  } catch {
    return undefined;
  }
}
function writeToken(code: string, token: string) {
  try {
    sessionStorage.setItem(storageKey(code), token);
  } catch {
    /* storage unavailable: a refresh will rejoin as a new guest */
  }
}
function clearToken(code: string) {
  try {
    sessionStorage.removeItem(storageKey(code));
  } catch {
    /* ignore */
  }
}

function safeStored(): string | null {
  try {
    return localStorage.getItem("mpForcePoll");
  } catch {
    return null;
  }
}

export interface MpGuestApi extends GuestState {
  join: (roomCode: string, displayName: string) => Promise<void>;
  leave: () => void;
  /** Sends an intent to the host through the relay; resolves to an error text, or undefined when it was delivered. */
  /** Transport / timing details for the "connection details" line. */
  diagnostics: GuestDiagnostics;
  sendIntent: (name: string, args: unknown[]) => Promise<string | undefined>;
}

export function useMpGuest(): MpGuestApi {
  const [state, dispatch] = useReducer(guestReducer, initialGuestState);
  const [diag, diagDispatch] = useReducer(diagnosticsReducer, initialDiagnostics);
  const sourceRef = useRef<EventSource | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stoppedRef = useRef(false);
  const tokenRef = useRef<string | undefined>(undefined);
  const seqRef = useRef(Date.now()); // time-based start: a reloaded page must not restart below the host's last accepted clientSeq

  const stop = useCallback(() => {
    stoppedRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    sourceRef.current?.close();
    sourceRef.current = undefined;
  }, []);

  useEffect(() => stop, [stop]);

  // One handler for both transports (stream frames and poll results are the same events).
  const handleEvent = useCallback(
    (event: GuestEvent) => {
      diagDispatch({ type: "event", now: Date.now() });
      if (event.type === "welcome") dispatch({ type: "welcome", seatId: event.seatId, roomCode: event.roomCode });
      else if (event.type === "snapshot" && isLobbyMessage(event.snapshot)) dispatch({ type: "lobby", message: event.snapshot });
      else if (event.type === "snapshot" && isMpSnapshot(event.snapshot)) dispatch({ type: "snapshot", rev: event.rev, snapshot: event.snapshot });
      else if (event.type === "room_closed") {
        stop();
        dispatch({ type: "room_closed" });
      } else if (event.type === "error") {
        stop();
        dispatch({ type: "error", message: event.message });
      }
    },
    [stop]
  );

  // Polling fallback: GET /api/mp/poll every second until the session ends.
  const startPolling = useCallback(
    (token: string) => {
      if (stoppedRef.current) return;
      sourceRef.current?.close();
      sourceRef.current = undefined;
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      diagDispatch({ type: "transport", transport: "poll" });
      let afterId = 0;
      let healthy = false;
      let welcomed = false;
      const tick = async () => {
        if (stoppedRef.current) return;
        try {
          const res = await fetch(`/api/mp/poll?token=${encodeURIComponent(token)}&after=${afterId}`, { cache: "no-store" });
          if (stoppedRef.current) return;
          const body = (await res.json().catch(() => null)) as { seatId?: string; roomCode?: string; message?: { id: number; rev: number; snapshot: unknown }; closed?: boolean; reason?: string; error?: string } | null;
          if (res.status === 401) {
            stop();
            dispatch({ type: "error", message: "You are no longer in this room (it was closed or you were removed)." });
            return;
          }
          if (!res.ok || !body) throw new Error(body?.error ?? `HTTP ${res.status}`);
          if (body.closed) {
            stop();
            if (body.reason === "kicked") dispatch({ type: "error", message: "You were removed from the room" });
            else dispatch({ type: "room_closed" });
            return;
          }
          diagDispatch({ type: "event", now: Date.now() });
          if (!healthy) {
            healthy = true;
            dispatch({ type: "stream_open" });
          }
          if (!welcomed && body.seatId && body.roomCode) {
            welcomed = true;
            dispatch({ type: "welcome", seatId: body.seatId, roomCode: body.roomCode });
          }
          if (body.message) {
            afterId = body.message.id;
            handleEvent({ type: "snapshot", rev: body.message.rev, snapshot: body.message.snapshot });
          }
        } catch (e) {
          if (stoppedRef.current) return;
          healthy = false;
          diagDispatch({ type: "error", message: `poll: ${e instanceof Error ? e.message : String(e)}` });
          dispatch({ type: "stream_lost" });
        }
        if (!stoppedRef.current) timerRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
      };
      void tick();
    },
    [handleEvent, stop]
  );

  const open = useCallback(
    (token: string, forcePoll: boolean) => {
      if (forcePoll) return startPolling(token);
      const startedAt = Date.now();
      let heard = false;
      let errors = 0;
      const check = () => {
        if (stoppedRef.current) return;
        const next = chooseTransport({ transport: "stream", elapsedMs: Date.now() - startedAt, heard, errors });
        if (next === "poll") startPolling(token);
      };
      const connect = () => {
        sourceRef.current?.close();
        const source = new EventSource(`/api/mp/stream?token=${encodeURIComponent(token)}`);
        sourceRef.current = source;
        source.onopen = () => {
          heard = true;
          diagDispatch({ type: "event", now: Date.now() });
          dispatch({ type: "stream_open" });
        };
        source.onmessage = (message) => {
          heard = true;
          try {
            handleEvent(JSON.parse(message.data) as GuestEvent);
          } catch {
            /* ignore malformed frames */
          }
        };
        source.onerror = () => {
          source.close();
          if (stoppedRef.current) return;
          errors++;
          diagDispatch({ type: "error", message: "event stream error" });
          dispatch({ type: "stream_lost" });
          check();
          if (!stoppedRef.current && sourceRef.current === source) timerRef.current = setTimeout(connect, reconnectDelayMs(errors - 1));
        };
      };
      watchdogRef.current = setTimeout(check, STREAM_OPEN_TIMEOUT_MS);
      connect();
    },
    [handleEvent, startPolling]
  );

  const join = useCallback(
    async function join(roomCode: string, displayName: string): Promise<void> {
      stop();
      stoppedRef.current = false;
      const code = roomCode.trim().toUpperCase();
      dispatch({ type: "joining" });
      try {
        const res = await fetch(`/api/mp/rooms/${encodeURIComponent(code)}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: displayName.trim() || "Guest", seatToken: readToken(code) })
        });
        const body = (await res.json().catch(() => null)) as { seatToken?: string; seatId?: string; error?: string } | null;
        if (!res.ok || !body?.seatToken) {
          // A stale remembered token must not block a fresh join.
          if (res.status === 401 && readToken(code)) {
            clearToken(code);
            return join(code, displayName);
          }
          dispatch({ type: "error", message: body?.error ?? `Could not join (HTTP ${res.status})` });
          return;
        }
        writeToken(code, body.seatToken);
        tokenRef.current = body.seatToken;
        dispatch({ type: "connecting" });
        const forcePoll = forcePollRequested(window.location.search, safeStored());
        diagDispatch({ type: "start", now: Date.now(), transport: forcePoll ? "poll" : "stream" });
        open(body.seatToken, forcePoll);
      } catch (e) {
        dispatch({ type: "error", message: `Could not reach the host: ${e instanceof Error ? e.message : String(e)}` });
      }
    },
    [open, stop]
  );

  const leave = useCallback(() => {
    stop();
    dispatch({ type: "room_closed" });
  }, [stop]);

  const sendIntent = useCallback(async (name: string, args: unknown[]): Promise<string | undefined> => {
    const token = tokenRef.current;
    if (!token) return "Not connected.";
    try {
      const res = await fetch("/api/mp/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, args, clientSeq: ++seqRef.current })
      });
      if (res.ok) return undefined;
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return body?.error ?? `Request failed (HTTP ${res.status})`;
    } catch {
      return "Could not reach the host.";
    }
  }, []);

  return { ...state, diagnostics: diag, join, leave, sendIntent };
}
