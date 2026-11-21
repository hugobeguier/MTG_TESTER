// Player-scoped durable effects and delayed triggers (kernel step 5, question 2).
//   - durableEffects: permission to cast / play specific cards (permission_to_play), replacement shields granted for a while
//     (Inkshield: "prevent all combat damage that would be dealt to you this turn..."), player flags ("no maximum hand size").
//   - delayedTriggers: "at the beginning of the next end step / upkeep ..." and "when it dies this turn ...".
// Both live in the game state with an owner, a timestamp and an expiry EVENT (cleanup / turn start / end step), and are read by
// the casting code, the replacement pipeline (replacements.ts) and cleanup. Nothing is stored on objects.

import type { CastOption, Duration, Phase, Step } from "../schema";
import { emit, moveObject, tick, type Run } from "./core";
import type { DelayedTrigger, DurableEffect, Expiry, GameObject, ObjId, PlayerId, TriggerContext } from "./types";

const PRE_END: Phase[] = ["untap", "upkeep", "draw", "precombat_main", "beginning_of_combat", "declare_attackers", "declare_blockers", "first_strike_damage", "combat_damage", "end_of_combat", "postcombat_main"];

export const durables = (r: Run): DurableEffect[] => (r.s.durableEffects ??= []);
export const delayeds = (r: Run): DelayedTrigger[] => (r.s.delayedTriggers ??= []);

/** The expiry a step duration means for `player`, evaluated now. Unknown durations are the caller's business (support.ts rejects them). */
export function expiryFor(r: Run, d: Duration | undefined, player: PlayerId): Expiry {
  const turn = r.s.turn.number;
  if (d === "until_end_of_turn") return { ev: "cleanup", turn };
  if (d === "until_end_of_your_next_turn") return { ev: "cleanup", turn: turn + 1, player };
  if (d === "until_your_next_turn") return { ev: "turn_start", turn: turn + 1, player };
  if (d === "until_your_next_end_step") return { ev: "end_step", turn: r.s.turn.active === player && PRE_END.includes(r.s.turn.phase) ? turn : turn + 1, player };
  return { ev: "never" };
}
export const SUPPORTED_DURABLE_DURATIONS: ReadonlySet<string> = new Set(["until_end_of_turn", "until_end_of_your_next_turn", "until_your_next_turn", "until_your_next_end_step"]);

export function addDurable(r: Run, e: Omit<DurableEffect, "id" | "timestamp">): DurableEffect {
  const d: DurableEffect = { ...e, id: `dur${r.s.nextId++}`, timestamp: tick(r) };
  durables(r).push(d);
  emit(r, { type: "durable_effect_added", id: d.id, owner: d.owner, source: d.source, kind: d.permission ? "permission" : d.replacement ? "replacement" : "flag" });
  return d;
}

const due = (r: Run, x: Expiry | undefined, ev: Expiry["ev"]): boolean =>
  !!x && x.ev === ev && (x.turn === undefined || r.s.turn.number >= x.turn) && (!x.player || r.s.turn.active === x.player);

/** Drop every durable effect / delayed trigger whose expiry event just happened. */
export function expireDurable(r: Run, ev: Expiry["ev"]): void {
  const dead = durables(r).filter((d) => due(r, d.expires, ev));
  for (const d of dead) {
    const c = d.control, o = c ? r.s.objects[c.objectId] : undefined;
    if (c && o && o.zone === "battlefield" && o.timestamp === c.objectTs) { o.controller = c.was; o.controlledSince = tick(r); emit(r, { type: "control_changed", id: o.id, from: d.owner, to: c.was }); }
  }
  if (dead.length) { r.s.durableEffects = durables(r).filter((d) => !dead.includes(d)); for (const d of dead) emit(r, { type: "durable_effect_expired", id: d.id, owner: d.owner }); }
  r.s.delayedTriggers = delayeds(r).filter((d) => !due(r, d.expires, ev));
}

// ---------------------------------------------------------------- permissions

/** Valid permissions on this object (it is still the same object: it did not change zone since the permission was made). */
export function permissionsFor(r: Run, o: GameObject, pid?: PlayerId): DurableEffect[] {
  return durables(r).filter((d) => d.permission && d.permission.objectId === o.id && d.permission.objectTs === o.timestamp && d.permission.zone === o.zone && (!pid || d.owner === pid));
}

/** The synthetic cast options permissions give a card: "you may cast it" (optionally without paying its mana cost). Ids start with "perm:". */
export function permissionOptions(r: Run, o: GameObject): CastOption[] {
  return permissionsFor(r, o).filter((d) => d.permission!.allow.includes("spell")).map((d) => ({
    id: `perm:${d.id}`, kind: "cast_from_zone" as const, from: d.permission!.zone, cost: [], replacesManaCost: d.permission!.withoutPaying, optional: true
  }));
}
export const permissionIdOf = (optionId: string): string | undefined => (optionId.startsWith("perm:") ? optionId.slice(5) : undefined);
export const permissionOwner = (r: Run, optionId: string): PlayerId | undefined => durables(r).find((d) => d.id === permissionIdOf(optionId))?.owner;

export function consumePermission(r: Run, durableId: string): void {
  r.s.durableEffects = durables(r).filter((d) => d.id !== durableId);
}

export const hasFlag = (r: Run, pid: PlayerId, flag: string): boolean => durables(r).some((d) => d.flag === flag && d.owner === pid);

// ---------------------------------------------------------------- delayed triggers

export function addDelayed(r: Run, t: Omit<DelayedTrigger, "id">): DelayedTrigger {
  const d: DelayedTrigger = { ...t, id: `dt${r.s.nextId++}` };
  delayeds(r).push(d);
  (r.dtBorn ??= {})[d.id] = r.events.length; // events already emitted in this run cannot fire it ("next end step" = a later one)
  emit(r, { type: "delayed_trigger_created", id: d.id, source: d.source, controller: d.controller });
  return d;
}

export interface DelayedSteps { steps: Step[]; ctx: TriggerContext }

/** "Exile ... until this leaves the battlefield": the source (same object) just left, so what it exiled comes back under its owner's control. */
export function releaseUnexiled(r: Run, sourceId: ObjId, sourceTs: number): void {
  const hits = durables(r).filter((d) => d.unexile && d.unexile.sourceId === sourceId && d.unexile.sourceTs === sourceTs);
  if (!hits.length) return;
  r.s.durableEffects = durables(r).filter((d) => !hits.includes(d));
  for (const d of hits) {
    const u = d.unexile!;
    const o = r.s.objects[u.objectId];
    if (o && o.zone === "exile" && o.timestamp === u.objectTs) { moveObject(r, u.objectId, "battlefield", { controller: o.owner }); emit(r, { type: "returned_from_exile", id: u.objectId }); }
  }
}
