// Host side of guest -> host game intents (pure; the React glue is components/game/mpIntents.ts). Three pieces:
//  * IntentQueue: in-order queue per host; drops duplicate/old `clientSeq` per slot (the guest's counter only goes up), so a retried POST never acts twice.
//  * dispatchIntent: looks the name up in a WHITELIST registry, rejects slots that hold no seat, validates args with zod, runs the entry's seat check,
//    then calls the handler with the acting seat forced to the sender's seat. A seat id in `args` is never read: entries receive the seat from the
//    slot -> seat map (seatMap.ts), so a guest cannot act for someone else.
//  * The host hook processes ONE queued intent per React commit: handlers close over render-time state, so two back-to-back calls would act on stale state.
import type { ZodType } from "zod";
import type { SlotId } from "./protocol";

export interface IntentEvent {
  fromSeatId: SlotId;
  name: string;
  args: unknown[];
  clientSeq: number;
}

export interface IntentEntry<A extends unknown[] = unknown[]> {
  /** zod schema of the args array (a tuple); anything else is rejected before any handler runs. */
  schema: ZodType<A>;
  /** Game-state check for the acting seat (and the validated args); return a reason to refuse (wrong stage, not your priority, a seat id that is not yours, ...). */
  check?: (seatId: string, ...args: A) => string | undefined;
  /** Runs the host handler as `seatId`. */
  call: (seatId: string, ...args: A) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IntentRegistry = Record<string, IntentEntry<any>>;

export type DispatchResult = { ok: true } | { ok: false; reason: string };

export function dispatchIntent(registry: IntentRegistry, event: IntentEvent, seatOfSlot: (slot: SlotId) => string | undefined): DispatchResult {
  const entry = Object.prototype.hasOwnProperty.call(registry, event.name) ? (registry[event.name] as IntentEntry<unknown[]>) : undefined;
  if (!entry) return { ok: false, reason: `unknown intent ${event.name}` };
  const seatId = seatOfSlot(event.fromSeatId);
  if (!seatId) return { ok: false, reason: "this guest holds no seat" };
  // JSON turns a skipped optional argument (undefined) into null; a table callback never passes null, so read it back as undefined.
  const parsed = entry.schema.safeParse(Array.isArray(event.args) ? event.args.map((arg) => (arg === null ? undefined : arg)) : event.args);
  if (!parsed.success) return { ok: false, reason: `bad arguments for ${event.name}` };
  const refusal = entry.check?.(seatId, ...parsed.data);
  if (refusal) return { ok: false, reason: refusal };
  // A handler that throws on an odd (but schema-valid) argument must cost the sender that one action, not take down the host's intent queue.
  try {
    entry.call(seatId, ...parsed.data);
  } catch {
    return { ok: false, reason: `${event.name} failed on the host` };
  }
  return { ok: true };
}

export class IntentQueue {
  private items: IntentEvent[] = [];
  private lastSeq = new Map<SlotId, number>();

  /** Queues an intent; false when its clientSeq is not newer than the last one accepted from that slot (duplicate / replay / out of date). */
  push(event: IntentEvent): boolean {
    if (!Number.isFinite(event.clientSeq)) return false;
    const last = this.lastSeq.get(event.fromSeatId);
    if (last !== undefined && event.clientSeq <= last) return false;
    this.lastSeq.set(event.fromSeatId, event.clientSeq);
    this.items.push(event);
    return true;
  }

  /** Removes and returns the oldest queued intent. */
  shift(): IntentEvent | undefined {
    return this.items.shift();
  }

  get length(): number {
    return this.items.length;
  }

  /** Forget a slot's sequence counter (guest left; a rejoining guest starts counting from 1 again). */
  forget(slot: SlotId) {
    this.lastSeq.delete(slot);
    this.items = this.items.filter((item) => item.fromSeatId !== slot);
  }
}
