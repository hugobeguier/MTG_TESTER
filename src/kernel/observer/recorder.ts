// Server/host-side recording hook for a LIVE game (deliverable 5). The legacy game state lives in the browser (AppFlow.tsx), so the observer cannot
// run next to it without touching React code. Instead a thin, flag-guarded call site (not wired by this change) can append one JSON line per
// applied intent with `recordStep`, and `npm run kernel:observe-replay -- <file>` replays the file through the same differential checker offline.
// Guarded by the explicit flag MTG_KERNEL_OBSERVER=1 (default OFF); every function swallows its own errors and never throws into the caller.
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { GameSession } from "../../lib/types";
import type { ObserverMeta } from "./types";

export const observerEnabled = (): boolean => typeof process !== "undefined" && process.env?.MTG_KERNEL_OBSERVER === "1";

/** One recorded legacy step: the state before, the state after, what was done, and whether the legacy engine accepted it. */
export interface RecordedStep {
  s0: GameSession;
  s1: GameSession;
  /** wire intent (INTENT_SPECS name + args) with the acting seat, or the orchestrator-style meta */
  intent?: { name: string; args: unknown[]; seat: string };
  meta?: ObserverMeta;
  /** false when the legacy engine refused / no-oped the intent */
  accepted?: boolean;
}

/** Append one step to `file` (JSONL). No-op unless MTG_KERNEL_OBSERVER=1. Never throws. */
export function recordStep(file: string, step: RecordedStep): void {
  if (!observerEnabled()) return;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(step) + "\n");
  } catch { /* observer problems never reach the game */ }
}
