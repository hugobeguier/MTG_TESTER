// Activated-ability costs that need a CHOICE from the player (sacrifice another permanent, discard cards, exile cards from a graveyard,
// tap other untapped permanents, return a permanent to hand). During activation they are asked as pending decisions BEFORE anything is
// paid (so cancelling is free); candidates come from the CURRENT zones. The spell being cast is on the stack, never a discard
// candidate. Tapping a permanent for a cost that is not the {T} symbol ignores summoning sickness (302.6 only restricts {T}/{Q}).

import type { Cost, ObjectFilter } from "../schema";
import { emit, label, moveObject, player, tryObj, Reject, type Run } from "./core";
import { evalQuantity, matchesFilter, objectsMatching } from "./query";
import { discardCard } from "./steps";
import type { Lki, ObjId, PlayerId } from "./types";

export type ChoiceCost = Extract<Cost, { sacrifice: unknown } | { discard: unknown } | { exileFrom: unknown } | { tapOther: unknown } | { returnToHand: unknown }>;

/** Does this cost ask the player to pick objects? (sacrifice / discard / exile / return "self" is handled without a choice) */
export function needsChoice(c: Cost): c is ChoiceCost {
  if ("sacrifice" in c) return c.sacrifice !== "self";
  if ("discard" in c) return c.discard !== "self";
  if ("exileFrom" in c) return c.what !== "self";
  if ("returnToHand" in c) return c.returnToHand !== "self";
  return "tapOther" in c;
}

export interface CostCtx { player: PlayerId; source: ObjId; x?: number }

const bare = (f: ObjectFilter): ObjectFilter => ({ ...f, zone: undefined, owner: undefined, controller: undefined });

/** The objects that may pay this cost right now. */
export function costCandidates(r: Run, c: ChoiceCost, cx: CostCtx): ObjId[] {
  const q = { controller: cx.player, source: cx.source, x: cx.x };
  const mine = (f: ObjectFilter) => objectsMatching(r, { ...f, zone: "battlefield", controller: "you" }, q);
  if ("sacrifice" in c) return mine(c.sacrifice as ObjectFilter);
  if ("returnToHand" in c) return mine(c.returnToHand as ObjectFilter);
  if ("tapOther" in c) return mine(c.tapOther).filter((id) => id !== cx.source && !r.s.objects[id].tapped);
  if ("discard" in c) {
    const hand = player(r, cx.player).hand;
    const f = c.discard === "hand" ? undefined : bare(c.discard as ObjectFilter);
    return hand.filter((id) => id !== cx.source && (!f || matchesFilter(r, id, f, q)));
  }
  // exileFrom a zone (graveyard / hand / exile) that the player owns
  const zone = c.exileFrom as "graveyard" | "hand" | "exile" | "library";
  const f = bare(c.what as ObjectFilter);
  return player(r, cx.player)[zone].filter((id) => id !== cx.source && matchesFilter(r, id, f, q));
}

export function costCount(r: Run, c: ChoiceCost, cx: CostCtx): number {
  const n = "tapOther" in c || "sacrifice" in c || "discard" in c || "exileFrom" in c || "returnToHand" in c ? evalQuantity(r, c.count, { controller: cx.player, source: cx.source, x: cx.x }) : 1;
  return Math.max(0, n);
}

export const costNoun = (c: ChoiceCost): string =>
  "sacrifice" in c ? "sacrifice" : "discard" in c ? "discard" : "exileFrom" in c ? "exile" : "tapOther" in c ? "tap" : "return to hand";

/** Pay one choice cost with the chosen objects (already validated against costCandidates). Returns the LKI of sacrificed permanents. */
export function payChoiceCost(r: Run, c: ChoiceCost, ids: ObjId[], cx: CostCtx): Record<ObjId, Lki> {
  const lki: Record<ObjId, Lki> = {};
  const legal = costCandidates(r, c, cx);
  const n = costCount(r, c, cx);
  if (ids.length !== n || new Set(ids).size !== n || ids.some((id) => !legal.includes(id))) throw new Reject("cannot_pay", `the chosen objects cannot pay this cost (${costNoun(c)} ${n})`);
  for (const id of ids) {
    if ("sacrifice" in c) {
      r.s.turnLog.push({ type: "sacrifice", id, player: cx.player, ts: r.s.clock });
      emit(r, { type: "sacrificed", id, player: cx.player });
      moveObject(r, id, "graveyard");
      if (r.s.lki[id]) lki[id] = r.s.lki[id];
    } else if ("discard" in c) discardCard(r, cx.player, id);
    else if ("exileFrom" in c) { moveObject(r, id, "exile"); emit(r, { type: "exiled", id }); }
    else if ("tapOther" in c) { const o = tryObj(r, id)!; o.tapped = true; emit(r, { type: "tap", id, player: cx.player }); }
    else { moveObject(r, id, "hand"); emit(r, { type: "bounced", id }); }
  }
  return lki;
}

export const costOptions = (r: Run, ids: ObjId[]) => ids.map((id) => ({ id, label: label(r, id) }));
