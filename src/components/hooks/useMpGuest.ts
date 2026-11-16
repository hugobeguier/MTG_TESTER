// Guest side of multiplayer: joins a room, holds the relay stream open (auto-reconnect with backoff; the relay replays the last snapshot) and exposes
// the latest snapshot. State transitions are the pure guestReducer in src/lib/multiplayer/connectionState.ts.
import { useCallback, useEffect, useReducer, useRef } from "react";
import { guestReducer, initialGuestState, reconnectDelayMs, type GuestState } from "@/lib/multiplayer/connectionState";
import type { GuestEvent } from "@/lib/multiplayer/protocol";
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

export interface MpGuestApi extends GuestState {
  join: (roomCode: string, displayName: string) => Promise<void>;
  leave: () => void;
}

export function useMpGuest(): MpGuestApi {
  const [state, dispatch] = useReducer(guestReducer, initialGuestState);
  const sourceRef = useRef<EventSource | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stoppedRef = useRef(false);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    sourceRef.current?.close();
    sourceRef.current = undefined;
  }, []);

  useEffect(() => stop, [stop]);

  const open = useCallback((token: string, attempt: number) => {
    sourceRef.current?.close();
    const source = new EventSource(`/api/mp/stream?token=${encodeURIComponent(token)}`);
    sourceRef.current = source;
    source.onopen = () => {
      attempt = 0;
      dispatch({ type: "stream_open" });
    };
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as GuestEvent;
        if (event.type === "welcome") dispatch({ type: "welcome", seatId: event.seatId, roomCode: event.roomCode });
        else if (event.type === "snapshot" && isMpSnapshot(event.snapshot)) dispatch({ type: "snapshot", rev: event.rev, snapshot: event.snapshot });
        else if (event.type === "room_closed") {
          stop();
          dispatch({ type: "room_closed" });
        } else if (event.type === "error") {
          stop();
          dispatch({ type: "error", message: event.message });
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    source.onerror = () => {
      source.close();
      if (stoppedRef.current) return;
      dispatch({ type: "stream_lost" });
      timerRef.current = setTimeout(() => open(token, attempt + 1), reconnectDelayMs(attempt));
    };
  }, [stop]);

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
        dispatch({ type: "connecting" });
        open(body.seatToken, 0);
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

  return { ...state, join, leave };
}
