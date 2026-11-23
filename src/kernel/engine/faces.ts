// Double-faced / modal double-faced / split cards (kernel step 5). The faces of a card are the distinct `face` values of its abilities
// (front first); the host supplies the other faces' characteristics in `CardDef.faces` and the layout in `CardDef.layout`.
//   - A card shows its front face everywhere except on the stack / battlefield, where `GameObject.face` says which face it shows.
//   - Casting: "modal_dfc" and "split" cards ask which face to cast (an option stage in front of the other cast choices; the timing,
//     cost, types and abilities all read the chosen face). A "transform" (default) card can only be cast front face up.
//   - Lands: `playLand {face}` chooses the face of a modal double-faced land.
//   - `transform` flips a transforming permanent to its other face: same object, same timestamp, new characteristics and abilities.
// Not modelled: entering transformed, meld, disturb, Fuse, adventures (the "Omen" / adventure-style second spell).

import { emit, faceNames, defOf, tryObj, type Run } from "./core";
import { invalidateIndex } from "./layers";
import { resolveObjs } from "./query";
import type { StepSpec } from "./steps";
import type { CardDef } from "./types";

/** The faces a player may CAST (zero or one: nothing to choose; several: the cast asks). */
export function castableFaces(def: CardDef): string[] {
  const names = faceNames(def);
  if (names.length <= 1) return names;
  // a land face is played, never cast
  return def.layout === "modal_dfc" || def.layout === "split" ? names.filter((n, i) => i === 0 || !def.faces?.[n]?.types.includes("land")) : [names[0]];
}

/** The faces a land PLAY may use: only a modal double-faced card has a land face playable from hand. A transforming card's land back (Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun) is reached only by transforming on the battlefield, never played (CR 712.8a/b). */
export function playableFaces(def: CardDef): string[] {
  const names = faceNames(def);
  return def.layout === "modal_dfc" ? names : names.slice(0, 1);
}

export const transformStep: StepSpec = {
  fields: ["target"],
  run: (r: Run, ex, step) => {
    for (const id of resolveObjs(r, String(step.target ?? "self"), ex.env)) {
      const o = tryObj(r, id);
      if (!o || o.zone !== "battlefield" || o.token) continue;
      const def = defOf(r, o)!;
      const names = faceNames(def);
      if (names.length < 2 || (def.layout !== undefined && def.layout !== "transform")) continue; // only transforming double-faced cards transform
      const cur = o.face && names.includes(o.face) ? o.face : names[0];
      o.face = cur === names[0] ? names[1] : names[0];
      invalidateIndex(r);
      emit(r, { type: "transformed", id, face: o.face });
    }
    return "done";
  }
};
