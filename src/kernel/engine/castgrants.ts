// "The next spell you cast this turn has improvise / affinity for artifacts / cannot be countered" (kernel step 7) and improvise itself.
// A grant is a durable effect (`DurableEffect.nextSpell`) that the next spell its owner casts consumes: the caster's Draft carries the
// grants (`Draft.grants`), the stack object remembers them (`GameObject.castGrants`).
//   improvise: after the mana is chosen you may tap untapped artifacts you control; each pays for {1} of the generic part.
//   affinity for <type>: the generic part costs {1} less for each <type> you control when you cast it.
//   cant:be_countered: read by layers.cantBeCountered while the spell is on the stack.

import { chars, tryObj, type Run } from "./core";
import { durables } from "./durable";
import { objectsMatching } from "./query";
import type { ObjId, PlayerId } from "./types";

/** Consume the "next spell" grants of this player. */
export function takeNextSpellGrants(r: Run, pid: PlayerId): string[] {
  const mine = durables(r).filter((d) => d.nextSpell && d.owner === pid);
  if (!mine.length) return [];
  r.s.durableEffects = durables(r).filter((d) => !mine.includes(d));
  return mine.flatMap((d) => d.nextSpell!);
}

/** Does this cast have improvise (printed keyword or granted)? */
export function hasImprovise(r: Run, spell: ObjId, grants: string[] | undefined): boolean {
  return !!grants?.includes("improvise") || chars(r, spell).keywords.includes("improvise");
}

/** Untapped artifacts the caster controls (improvise candidates). */
export function improviseCandidates(r: Run, pid: PlayerId): ObjId[] {
  return objectsMatching(r, { types: ["artifact"], controller: "you" }, { controller: pid }).filter((id) => !tryObj(r, id)?.tapped);
}

/** Generic reduction from "affinity for artifacts"-style grants. */
export function affinityReduction(r: Run, pid: PlayerId, grants: string[] | undefined): number {
  let n = 0;
  for (const g of grants ?? []) {
    const m = /^affinity for (\w+?)s?$/.exec(g);
    if (m) n += objectsMatching(r, { types: [m[1]], controller: "you" }, { controller: pid }).length;
  }
  return n;
}

/** The grants the next spell would get (nothing is consumed until the cast is committed). */
export function peekNextSpellGrants(r: Run, pid: PlayerId): string[] {
  return durables(r).filter((d) => d.nextSpell && d.owner === pid).flatMap((d) => d.nextSpell!);
}
