// Miracle (702.94) and evoke (702.74), kernel step 7.
//   miracle: when a player draws a card with a miracle option as the FIRST card they drew this turn, a triggered ability (miracle trigger)
//   is queued; when it resolves its controller decides (yes/no, "reveal it and cast it for its miracle cost") and, on yes, the card is cast
//   during that resolution (castNow, timing ignored) with the miracle option. A card that left the hand since is simply not cast.
//   evoke: the card is cast with the evoke option (an alternative cost); when the permanent enters, a sacrifice trigger is queued.

import type { Step } from "../schema";
import { defOf, tryObj, type Run } from "./core";
import type { ObjId, PlayerId, QueuedTrigger } from "./types";

export const miracleOption = (r: Run, id: ObjId) => { const o = tryObj(r, id); return o && !o.token ? defOf(r, o)?.kernel.castOptions?.find((c) => c.kind === "miracle") : undefined; };

/** Called by drawCards right after `id` was drawn by `pid`; `drawsBefore` = cards that player had drawn this turn before this one. */
export function maybeQueueMiracle(r: Run, pid: PlayerId, id: ObjId, drawsBefore: number): void {
  if (drawsBefore !== 0) return;
  const opt = miracleOption(r, id);
  if (!opt) return;
  const o = tryObj(r, id)!;
  const q: QueuedTrigger = {
    id: `q${r.s.nextId++}`, sourceId: id, abilityId: "__miracle", controller: pid, ctx: { eventObj: id, eventPlayer: pid }, label: "miracle trigger",
    delayed: { steps: [{ kind: "__miracle", card: id, ts: o.timestamp, option: opt.id } as unknown as Step], targets: {} }
  };
  r.s.triggerQueue.push(q);
  r.events.push({ type: "miracle_triggered", seq: r.events.length, player: pid } as never);
}
