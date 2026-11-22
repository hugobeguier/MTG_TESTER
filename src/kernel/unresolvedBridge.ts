// Bridge from kernel `unresolved` events to the shared "Couldn't resolve" sink (src/lib/unresolvedLog.ts, data/observer/live-unresolved.jsonl).
// The kernel itself stays pure (it only emits events); the HOST (live game server / client, the observer, a replay tool) calls this after every
// resolve() with the events it got and hands the records to its sink, for example:
//
//   const bridge = new UnresolvedBridge({ gameId, decks, seatKindOf: (id) => (id === humanId ? "human" : "agent") }, (rec) => appendUnresolvedRecord(rec));
//   const res = resolve(state, action, ctx);
//   bridge.push(res.events);                           // server side: full (unredacted) events, never the per-viewer ones
//
// Pure module: no node imports. Never throws (logging must never reach the game).

import { UnresolvedDeduper, validateUnresolvedPayload, type UnresolvedRecord } from "../lib/unresolvedLog";
import type { GameEvent } from "./engine/types";

export interface BridgeContext {
  gameId: string;
  decks?: string[];
  /** player (seat) id -> human / agent; default "agent" */
  seatKindOf?: (playerId: string) => "human" | "agent";
  /** ISO timestamp source (tests); default: now */
  now?: () => string;
}

/** The sink payload of ONE `unresolved` event, or undefined when the event is not one (or is a redacted / malformed one). */
export function unresolvedEventToRecord(ev: GameEvent, ctx: BridgeContext): UnresolvedRecord | undefined {
  try {
    if (ev.type !== "unresolved" || ev.hidden === true) return undefined;
    const e = ev as GameEvent & { card?: string; clause?: string; message?: string; abilityKind?: string; capability?: string; turn?: number; phase?: string; player?: string; effect?: string };
    return validateUnresolvedPayload({
      cardName: e.card,
      // the clause text; an event without one (a step / engine failure) falls back to the sentence the log shows
      clause: e.clause || e.message,
      abilityKind: e.abilityKind || "unknown",
      engine: "kernel",
      decks: ctx.decks ?? [],
      turn: e.turn,
      phase: e.phase,
      seatKind: ctx.seatKindOf?.(e.player ?? "") ?? "agent",
      gameId: ctx.gameId,
      capability: e.capability,
      seat: e.player,
      effect: e.effect
    }, ctx.now);
  } catch {
    return undefined;
  }
}

/** Every valid record of an event list, in order, deduplicated by game + card + clause + capability (within this call). */
export function unresolvedRecordsOf(events: readonly GameEvent[], ctx: BridgeContext, deduper: UnresolvedDeduper = new UnresolvedDeduper()): UnresolvedRecord[] {
  const out: UnresolvedRecord[] = [];
  for (const ev of events) {
    const rec = unresolvedEventToRecord(ev, ctx);
    if (rec && deduper.admit(rec)) out.push(rec);
  }
  return out;
}

/** Stateful helper for a host: remembers what it already sent for this game and passes new records to `sink`. */
export class UnresolvedBridge {
  private readonly deduper = new UnresolvedDeduper();
  constructor(private readonly ctx: BridgeContext, private readonly sink: (record: UnresolvedRecord) => void) {}
  /** returns the records handed to the sink */
  push(events: readonly GameEvent[]): UnresolvedRecord[] {
    const recs = unresolvedRecordsOf(events, this.ctx, this.deduper);
    for (const r of recs) { try { this.sink(r); } catch { /* the sink must never reach the game */ } }
    return recs;
  }
}
