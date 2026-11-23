// Phasing (kernel step 9, CR 702.26): a permanent that phases out is treated as though it does not exist. The object keeps its zone
// ("battlefield"), its counters, its attachments and its timestamp, but its id leaves `GameState.battlefield` and sits in
// `GameState.phased` (so every battlefield scan in the engine simply cannot see it). Permanents attached to it phase out WITH it
// (indirectly) and phase in with it. Directly phased-out permanents phase in during their controller's next untap step.
import { emit, tryObj, tick, type Run } from "./core";
import { invalidateIndex } from "./layers";
import type { ObjId } from "./types";

export function phaseOut(r: Run, id: ObjId): void {
  const o = tryObj(r, id);
  if (!o || o.zone !== "battlefield" || !r.s.battlefield.includes(id)) return;
  const phased = (r.s.phased ??= []);
  const out = (x: ObjId, indirectOf?: ObjId) => {
    r.s.battlefield = r.s.battlefield.filter((b) => b !== x);
    phased.push({ id: x, ...(indirectOf ? { indirectOf } : {}) });
    emit(r, { type: "phased_out", id: x });
  };
  out(id);
  for (const b of [...r.s.battlefield]) if (tryObj(r, b)?.attachedTo === id) out(b, id);
  const c = r.s.combat; // a phased-out attacker / blocker leaves combat
  if (c) { c.attackers = c.attackers.filter((a) => a.id !== id); }
  invalidateIndex(r);
}

/** Untap step of `pid`: their directly phased-out permanents (and what phased out with them) phase in. */
export function phaseInFor(r: Run, pid: string): void {
  const phased = r.s.phased;
  if (!phased?.length) return;
  const direct = phased.filter((p) => !p.indirectOf && tryObj(r, p.id)?.controller === pid).map((p) => p.id);
  if (!direct.length) return;
  const back = phased.filter((p) => direct.includes(p.id) || (p.indirectOf && direct.includes(p.indirectOf)));
  r.s.phased = phased.filter((p) => !back.includes(p));
  for (const p of back) { r.s.battlefield.push(p.id); emit(r, { type: "phased_in", id: p.id }); }
  tick(r);
  invalidateIndex(r);
}
