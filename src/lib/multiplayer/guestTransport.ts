// Pure decision logic for the guest's transport: the event stream (EventSource) is preferred, but when something between the two machines
// (Hamachi, antivirus, a proxy) buffers or blocks the long-lived response, the guest falls back to polling GET /api/mp/poll.

export type GuestTransport = "stream" | "poll";

export const STREAM_OPEN_TIMEOUT_MS = 5_000;
export const STREAM_MAX_ERRORS = 2;
export const POLL_INTERVAL_MS = 1_000;

export interface TransportInput {
  transport: GuestTransport;
  /** ms since the stream was opened. */
  elapsedMs: number;
  /** onopen or any message arrived on the stream. */
  heard: boolean;
  /** Number of EventSource errors so far. */
  errors: number;
  forcePoll?: boolean;
}

/** Which transport the guest should use now. Once polling, it stays polling for the session. */
export function chooseTransport(i: TransportInput): GuestTransport {
  if (i.transport === "poll" || i.forcePoll) return "poll";
  if (i.errors >= STREAM_MAX_ERRORS) return "poll";
  if (!i.heard && i.elapsedMs >= STREAM_OPEN_TIMEOUT_MS) return "poll";
  return "stream";
}

export interface GuestDiagnostics {
  transport: GuestTransport;
  /** Epoch ms of the join (undefined before joining). */
  joinedAt?: number;
  lastEventAt?: number;
  lastError?: string;
}

export const initialDiagnostics: GuestDiagnostics = { transport: "stream" };

export type DiagAction =
  | { type: "start"; now: number; transport: GuestTransport }
  | { type: "transport"; transport: GuestTransport }
  | { type: "event"; now: number }
  | { type: "error"; message: string };

export function diagnosticsReducer(state: GuestDiagnostics, action: DiagAction): GuestDiagnostics {
  switch (action.type) {
    case "start":
      return { transport: action.transport, joinedAt: action.now };
    case "transport":
      return { ...state, transport: action.transport };
    case "event":
      return { ...state, lastEventAt: action.now };
    case "error":
      return { ...state, lastError: action.message };
  }
}

/** Is the debug flag set (query `?mpForcePoll=1` or localStorage `mpForcePoll=1`)? */
export function forcePollRequested(search: string, stored: string | null | undefined): boolean {
  return new URLSearchParams(search).get("mpForcePoll") === "1" || stored === "1";
}
