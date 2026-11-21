// Linked exile ("a card exiled with this permanent", hideaway, imprint, Mimic Vat). A link remembers the SOURCE permanent (with the
// timestamp it had) and the exiled OBJECT (with the timestamp it got when it was exiled). It stops counting when either of them is a
// new object (changed zone since, 400.7), which is how "the exiled card" stops referring to a card that was cast, returned or flickered.

import { tryObj, type Run } from "./core";
import type { ObjId } from "./types";

export interface Link { source: ObjId; sourceTs: number; object: ObjId; objectTs: number }

export const links = (r: Run): Link[] => (r.s.links ??= []);

export function addLink(r: Run, source: ObjId, object: ObjId): void {
  const s = tryObj(r, source), o = tryObj(r, object);
  if (!s || !o) return;
  links(r).push({ source, sourceTs: s.timestamp, object, objectTs: o.timestamp });
}

/** Objects still linked to `source`, oldest first. `source` must be the same object it was when the links were made. */
export function linkedObjs(r: Run, source: ObjId | undefined): ObjId[] {
  if (!source) return [];
  const s = tryObj(r, source);
  if (!s) return [];
  return links(r).filter((l) => l.source === source && l.sourceTs === s.timestamp && tryObj(r, l.object)?.timestamp === l.objectTs && tryObj(r, l.object)?.zone === "exile").map((l) => l.object);
}

/** Drop links that can never match again (keeps the state small). */
export function pruneLinks(r: Run): void {
  r.s.links = links(r).filter((l) => tryObj(r, l.source)?.timestamp === l.sourceTs && tryObj(r, l.object)?.timestamp === l.objectTs);
}
