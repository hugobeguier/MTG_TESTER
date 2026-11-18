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
  /** Game-state check for the acting seat; return a reason to refuse (wrong stage, already decided, ...). */
  check?: (seatId: string) => string | undefined;
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
  const parsed = entry.schema.safeParse(event.args);
  if (!parsed.success) return { ok: false, reason: `bad arguments for ${event.name}` };
  const refusal = entry.check?.(seatId);
  if (refusal) return { ok: false, reason: refusal };
  entry.call(seatId, ...parsed.data);
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
