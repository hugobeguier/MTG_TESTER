// Ordered placement of cards the player looked at (CR 701.18 scry, 701.46 surveil, "put them back in any order", "put them on the bottom of your library in any order").
// One decision kind, `order_library`: pending.options = the looked-at cards (private to the deciding player), pending.placement = { to, stack }.
//   answer: choice.place = { toBottom?: ids, toGraveyard?: ids, top?: ids } with EVERY listed card exactly once;
//     toBottom (scry): sent to the bottom of the library, first = closest to the top of that group; toGraveyard (surveil): sent to the graveyard;
//     top: the ordered stack, first = the next card drawn (stack "top") or the card nearest the top of the bottom group (stack "bottom").
//   the older answer `ids` still works: to "none" it is the whole ordered stack; to "bottom" / "graveyard" it is the cards sent there (the rest stay on top in their current order).
// Only imported by steps.ts, moves.ts.

import type { Prompt } from "../schema";
import { Reject, moveObject, player, type Run } from "./core";
import type { AskSpec } from "./steps";
import type { Choice, DecisionOption, ObjId, PlayerId } from "./types";

export type Placement = { to: "bottom" | "graveyard" | "none"; stack: "top" | "bottom" };
export interface Placed { toBottom: ObjId[]; toGraveyard: ObjId[]; top: ObjId[] }

export function placementSpec(who: PlayerId, prompt: Prompt, options: DecisionOption[], placement: Placement): AskSpec {
  const n = options.length;
  return { kind: "order_library", player: who, prompt, options, min: placement.to === "none" ? n : 0, max: n, placement };
}

/** Validate the answer against the spec and return the three groups (never mutates). */
export function readPlacement(spec: AskSpec, answer: Choice): Placed {
  const pl = spec.placement!;
  const all = spec.options.map((o) => o.id);
  const valid = new Set(all);
  const bad = (m: string): never => { throw new Reject("invalid_choice", m); };
  let toBottom: string[] = [], toGraveyard: string[] = [], top: string[];
  if (answer.place) {
    toBottom = answer.place.toBottom ?? []; toGraveyard = answer.place.toGraveyard ?? []; top = answer.place.top ?? [];
    if (toBottom.length && pl.to !== "bottom") bad("cards can't be put on the bottom by this effect");
    if (toGraveyard.length && pl.to !== "graveyard") bad("cards can't be put into the graveyard by this effect");
  } else if (answer.ids) {
    const ids = answer.ids;
    if (pl.to === "none") top = ids;
    else {
      if (pl.to === "bottom") toBottom = ids; else toGraveyard = ids;
      top = all.filter((id) => !ids.includes(id));
    }
  } else return bad("answer with choice.place: { toBottom, toGraveyard, top }");
  const seen = new Set<string>();
  for (const id of [...toBottom, ...toGraveyard, ...top]) {
    if (!valid.has(id)) bad(`"${id}" is not one of the cards you looked at`);
    if (seen.has(id)) bad(`"${id}" is placed more than once`);
    seen.add(id);
  }
  if (seen.size !== all.length) bad(`every card must be placed exactly once (${seen.size} of ${all.length} placed)`);
  return { toBottom, toGraveyard, top };
}

/** Apply a validated placement to the library of `who`: the cards looked at are the first `n` cards of the library (scry / surveil) or are already somewhere else (the ordered put-back). */
export function applyScry(r: Run, who: PlayerId, placed: Placed): void {
  for (const id of placed.toBottom) moveObject(r, id, "library", { position: "bottom" });
  for (const id of placed.toGraveyard) moveObject(r, id, "graveyard", { position: "bottom" });
  const lib = player(r, who).library;
  // the kept cards are still the first cards of the library: lay them out in the chosen order
  const keep = placed.top.filter((id) => lib.includes(id));
  const rest = lib.filter((id) => !keep.includes(id));
  lib.splice(0, lib.length, ...keep, ...rest);
}
