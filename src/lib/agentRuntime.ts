// Module-level agent runtime plumbing used by AppFlow: request timeouts / pacing, model warm-up, priority-stop settings persistence.
// Extracted verbatim from components/AppFlow.tsx; AppFlow.tsx re-exports the previously public symbols.

import { type PendingAction } from "@/engine/types";
import { DEFAULT_STOP_SETTINGS, type PriorityStopSettings } from "@/lib/priorityStops";

// TURN_PHASES itself now lives in src/lib/priorityStops.ts (imported above) — single source of
// truth shared with ThreeGameTable's PriorityStopsModal grid, see that module's own comment.

// Defense-in-depth: the server-side Ollama fetches (src/lib/ollama.ts)
// already have their own shorter timeouts and fall back gracefully on expiry, so these client
// fetches should rarely fire — but if the route itself ever hangs (not just Ollama), this stops an
// unbounded `await fetch(...)` from skipping the calling function's `finally` block, which is what
// clears the "a decision is in flight" guard (agentDecisionRequests) that would otherwise lock a
// phase out of ever being retried.
export const AGENT_REQUEST_TIMEOUT_MS = 45000;

// The resolving "beat": how long a spell/ability/trigger stays visibly "Resolving…" on the stack once everyone has passed, before its effect is
// applied, so it can be read instead of flashing past. localStorage "mtg-stack-beat" is a multiplier (1 = default, 0 = off, 2 = twice as long).
export function stackBeatMs(action: PendingAction): number {
  if (action.type === "phase") return 0;
  let scale = 1;
  try {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("mtg-stack-beat") : null;
    const parsed = stored === null ? NaN : Number(stored);
    if (Number.isFinite(parsed) && parsed >= 0) scale = parsed;
  } catch {
    // storage unavailable: default beat
  }
  return Math.round((action.type === "spell" ? 1800 : 1200) * scale);
}

// In-memory cap on session.events (newest first). Generous: a full Commander game is a few thousand lines.
export const MAX_SESSION_EVENTS = 5000;

// Fixed "let the human watch" pauses between agent steps. They never affect a decision, only wall-clock time, so they scale by one
// setting: localStorage "mtg-agent-pace" = a multiplier (1 = the original pacing, 0 = instant). Default 0.3 keeps each step visible.
export function agentPaceMs(baseMs: number): number {
  let scale = 0.3;
  try {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("mtg-agent-pace") : null;
    const parsed = stored === null ? NaN : Number(stored);
    if (Number.isFinite(parsed) && parsed >= 0) scale = parsed;
  } catch {
    // storage unavailable: keep the default
  }
  return Math.round(baseMs * scale);
}

// Generous enough to cover Ollama's own OLLAMA_WARMUP_TIMEOUT_MS (120s) plus round-trip overhead —
// this fetch is meant to sit through whatever cold-load time the model needs, unlike
// AGENT_REQUEST_TIMEOUT_MS above which guards a real, time-boxed decision.
const AGENT_WARMUP_TIMEOUT_MS = 125000;

// Absorbs a seat's own Ollama model's cold-load time (see warmUpOllamaModel in lib/ollama.ts) before
// its first real decision request, which has a much tighter timeout. Best-effort and silent: a
// failed or slow warm-up just means the next real request pays the cold-load cost itself, exactly as
// it would without this call.
export async function warmUpAgentModel(agentName: string) {
  try {
    await fetch("/api/agents/warmup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(AGENT_WARMUP_TIMEOUT_MS),
      body: JSON.stringify({ agentName })
    });
  } catch {
    // Swallowed — see comment above.
  }
}

// The human player's priority-stop preferences (src/lib/priorityStops.ts) — the second thing this
// app persists to localStorage, and the first real user preference of any kind. Read once on mount
// (not at module init: no localStorage during SSR) and written on every change.
const PRIORITY_STOP_SETTINGS_STORAGE_KEY = "mtg-priority-stop-settings-v1";

export function loadPriorityStopSettings(): PriorityStopSettings {
  if (typeof window === "undefined") return DEFAULT_STOP_SETTINGS;
  try {
    const raw = window.localStorage.getItem(PRIORITY_STOP_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_STOP_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<PriorityStopSettings>;
    return {
      phaseStops: parsed.phaseStops ?? DEFAULT_STOP_SETTINGS.phaseStops,
      stopOnStackResponse: parsed.stopOnStackResponse ?? DEFAULT_STOP_SETTINGS.stopOnStackResponse,
      stopOnAttacked: parsed.stopOnAttacked ?? DEFAULT_STOP_SETTINGS.stopOnAttacked,
      stopOnTargeted: parsed.stopOnTargeted ?? DEFAULT_STOP_SETTINGS.stopOnTargeted,
      stopOnChoicePrompt: parsed.stopOnChoicePrompt ?? DEFAULT_STOP_SETTINGS.stopOnChoicePrompt,
      fullControl: false // never persist "full control" left on from a previous session
    };
  } catch {
    // Corrupt/incompatible cache from an older shape — safe to ignore, falls back to defaults same
    // as any other cache miss.
    return DEFAULT_STOP_SETTINGS;
  }
}

export function savePriorityStopSettings(settings: PriorityStopSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PRIORITY_STOP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full/unavailable (private browsing, quota, ...) — the in-memory setting still works
    // for the rest of this session, it just won't survive a reload.
  }
}
