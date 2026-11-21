// Regeneration (701.15): "the next time it would be destroyed this turn, instead tap it, remove it from combat and remove all damage from it".
// A shield is a counter of uses on the object (`GameObject.regen`), cleared at cleanup; destruction (destroyObject / lethal damage SBA) spends one.

import { emit, tryObj, type Run } from "./core";
import type { ObjId } from "./types";

export function addRegenShield(r: Run, id: ObjId): void {
  const o = tryObj(r, id);
  if (!o || o.zone !== "battlefield") return;
  o.regen = (o.regen ?? 0) + 1;
  emit(r, { type: "regeneration_shield", id });
}

export function removeFromCombat(r: Run, id: ObjId): void {
  const c = r.s.combat;
  if (!c) return;
  c.attackers = c.attackers.filter((a) => a.id !== id);
  for (const a of c.attackers) a.blockers = a.blockers.filter((b) => b.id !== id);
}

/** If the object has a regeneration shield, uses it (tap, remove from combat, heal) and returns true: the destruction does not happen. */
export function regenerates(r: Run, id: ObjId): boolean {
  const o = tryObj(r, id);
  if (!o || o.zone !== "battlefield" || !(o.regen && o.regen > 0)) return false;
  o.regen--; if (o.regen === 0) o.regen = undefined;
  o.tapped = true; o.damage = 0; o.dtHit = undefined;
  removeFromCombat(r, id);
  emit(r, { type: "regenerated", id });
  return true;
}

export function clearRegenShields(r: Run): void { for (const o of Object.values(r.s.objects)) if (o.regen) o.regen = undefined; }
