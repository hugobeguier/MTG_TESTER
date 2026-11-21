// Library steps: search_library, look_top, reveal. Hidden information lives here: a search or a look is PRIVATE to the player
// (the events carry the card names only to them, see view.ts), and a card is shown to everybody only by a `reveal` event.
// Only imported by steps.ts.

import type { ObjectFilter, Step } from "../schema";
import { emit, label, moveObject, player, shuffleInPlace, tryObj, Unsupported, type Run } from "./core";
import { evalQuantity, matchesFilter, resolveObjs, resolvePlayers } from "./query";
import { saveList, saveLooked, setResult } from "./saved";
import { decide, type AskSpec, type StepSpec } from "./steps";
import { fallbackPrompt } from "./choose";
import type { ObjId, PlayerId } from "./types";

export const SEARCH_FIELDS = ["who", "filter", "count", "upTo", "anyNumber", "min", "reveal", "to", "shuffle", "tapped", "position", "saveAs"];
export const SEARCH_DESTINATIONS = ["hand", "battlefield", "library", "graveyard", "revealed"];
export const LOOK_FIELDS = ["amount", "who", "reveal"];
export const REVEAL_FIELDS = ["what", "target", "who", "saveAs"];

const names = (r: Run, ids: ObjId[]): string[] => ids.map((id) => label(r, id));

export function revealCards(r: Run, player: PlayerId, ids: ObjId[], source: string): void {
  if (ids.length) emit(r, { type: "reveal", player, ids: [...ids], names: names(r, ids), source });
}

export const searchStep: StepSpec = {
  fields: SEARCH_FIELDS,
  run: (r, ex, step, answer) => {
    const env = ex.env;
    const owners = resolvePlayers(r, step.who ?? "you", env);
    if (owners.length !== 1) throw new Unsupported("field:search_library.who", "search_library needs exactly one searching player");
    const searcher = owners[0]; // "its controller may search THEIR library": the who-player searches their own library
    const to = String(step.to ?? "hand");
    if (!SEARCH_DESTINATIONS.includes(to)) throw new Unsupported(`field:search_library.to=${to}`);
    const filter = (step.filter ?? {}) as ObjectFilter;
    const cands = owners.flatMap((p) => player(r, p).library).filter((id) => matchesFilter(r, id, { ...filter, zone: undefined, owner: undefined }, { ...env, controller: searcher }));
    const count = step.count === "any" || step.anyNumber ? cands.length : step.count === undefined ? 1 : evalQuantity(r, step.count as never, env);
    const max = Math.min(count, cands.length);
    // a search for a quality may find nothing even if such cards exist (701.19b); a search for "a card" must take one
    const noQuality = Object.keys(filter).length === 0;
    const min = noQuality && !(step.upTo || step.anyNumber) ? max : step.min !== undefined ? Math.min(Number(step.min), max) : 0;

    let found: ObjId[] = [];
    if (max > 0) {
      const spec: AskSpec = {
        kind: "choose_cards", player: searcher,
        prompt: step.prompt ?? fallbackPrompt(r, env, "search", `Search the library: choose ${min === 0 ? "up to " : ""}${max} card${max === 1 ? "" : "s"}.`),
        options: cands.map((id) => ({ id, label: label(r, id) })), min, max
      };
      const d = decide(spec, answer);
      if ("ask" in d) return d;
      found = d.ids;
    }
    emit(r, { type: "library_searched", player: searcher, owner: owners[0], found: found.length });
    if (step.reveal) revealCards(r, searcher, found, env.source);
    if (to === "library" && step.shuffle) for (const p of owners) { shuffleInPlace(r, player(r, p).library); emit(r, { type: "shuffle", player: p }); }
    const placing = to === "library" && step.position !== "bottom" ? [...found].reverse() : found;
    // to "revealed": the found cards are only shown; a later step (choose fromRevealed, move rest_of_revealed_cards) moves them
    if (to === "revealed") saveLooked(r, env, found);
    else for (const id of placing) moveObject(r, id, to as never, { position: step.position as "top" | "bottom" | undefined, controller: to === "battlefield" ? searcher : undefined, tapped: !!step.tapped });
    if (to !== "library" && step.shuffle) for (const p of owners) { shuffleInPlace(r, player(r, p).library); emit(r, { type: "shuffle", player: p }); }
    saveList(r, env, String(step.saveAs ?? "found"), found.filter((id) => tryObj(r, id)));
    setResult(env, step.id, found.length);
    return "done";
  }
};

export const lookTopStep: StepSpec = {
  fields: LOOK_FIELDS,
  run: (r, ex, step) => {
    const env = ex.env;
    const looker = env.controller;
    const owner = resolvePlayers(r, step.who ?? "you", env)[0];
    const n = evalQuantity(r, (step.amount ?? 1) as never, env);
    const ids = player(r, owner).library.slice(0, n);
    saveLooked(r, env, ids);
    emit(r, { type: "looked_at", player: looker, owner, ids: [...ids], names: names(r, ids) });
    if (step.reveal) revealCards(r, looker, ids, env.source);
    return "done";
  }
};

export const revealStep: StepSpec = {
  fields: REVEAL_FIELDS,
  run: (r, ex, step: Step) => {
    const env = ex.env;
    let ids: ObjId[];
    if (step.what === "top_card_of_library") ids = resolvePlayers(r, step.who ?? "you", env).flatMap((p) => player(r, p).library.slice(0, 1));
    else if (step.what === undefined && step.target) ids = resolveObjs(r, step.target as string, env);
    else throw new Unsupported(`field:reveal.what=${String(step.what)}`);
    revealCards(r, env.controller, ids, env.source);
    if (step.saveAs) saveList(r, env, String(step.saveAs), ids);
    return "done";
  }
};
