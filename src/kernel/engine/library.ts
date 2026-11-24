// Library steps: search_library, look_top, reveal. Hidden information lives here: a search or a look is PRIVATE to the player
// (the events carry the card names only to them, see view.ts), and a card is shown to everybody only by a `reveal` event.
// Only imported by steps.ts.

import type { ObjectFilter, Step } from "../schema";
import { chars, emit, label, moveObject, player, shuffleInPlace, tryObj, Unsupported, type Run } from "./core";
import { evalQuantity, matchesFilter, resolveObjs, resolvePlayers } from "./query";
import { saveList, saveLooked, setResult } from "./saved";
import { decide, type AskSpec, type StepResult, type StepSpec } from "./steps";
import { fallbackPrompt } from "./choose";
import type { Env, ObjId, PlayerId } from "./types";

export const SEARCH_FIELDS = ["who", "filter", "count", "upTo", "anyNumber", "min", "reveal", "to", "shuffle", "tapped", "position", "saveAs", "totalManaValueAtMost", "distinctNames", "excludeNamed", "sharesLandType"];
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
    if (step.totalManaValueAtMost !== undefined || step.distinctNames || step.excludeNamed !== undefined || step.sharesLandType) return { push: [{ kind: "__search_pick", base: step, picked: [] } as unknown as Step] };
    const cands = owners.flatMap((p) => player(r, p).library).filter((id) => matchesFilter(r, id, { ...filter, zone: undefined, owner: undefined }, { ...env, controller: searcher }));
    const count = step.count === "any" || step.anyNumber ? cands.length : step.count === undefined ? 1 : evalQuantity(r, step.count as never, env);
    const max = Math.min(count, cands.length);
    // a search for a quality may find nothing even if such cards exist (701.19b); a search for "a card" must take one
    const noQuality = Object.keys(filter).length === 0;
    const min = noQuality && !(step.upTo || step.anyNumber) ? max : step.min !== undefined ? Math.min(Number(step.min), max) : 0;

    let found: ObjId[] = [];
    // INTERCHANGEABLE candidates (every one is the same card name, e.g. basic Plains): there is nothing to choose, so the most the text allows is taken
    // without a question (and the search still ends with the shuffle); a prompt stays whenever the names differ
    if (max > 0 && cands.every((id) => chars(r, id).name === chars(r, cands[0]).name)) {
      found = cands.slice(0, max);
      emit(r, { type: "search_auto", player: searcher, source: env.source, names: names(r, found), count: found.length, to, reveal: !!step.reveal });
      return finishSearch(r, env, step, searcher, owners, found);
    }
    if (max === 0) emit(r, { type: "search_auto", player: searcher, source: env.source, names: [], count: 0, to, reveal: false });
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
    return finishSearch(r, env, step, searcher, owners, found);
  }
};

/**
 * A search whose chosen cards must fit TOGETHER ("total mana value 6 or less", "different names", "not named X", "share a land type"):
 * the cards are picked one at a time, each question listing only the cards that still fit with the ones already picked.
 */
export const searchPickStep = (r: Run, ex: { env: Env }, step: Step, answer: import("./types").Choice | undefined): StepResult => {
  const env = ex.env, base = step.base as Step, picked = step.picked as ObjId[];
  const searcher = resolvePlayers(r, base.who ?? "you", env)[0];
  const filter = (base.filter ?? {}) as ObjectFilter;
  const limit = base.count === "any" || base.anyNumber ? Infinity : base.count === undefined ? 1 : evalQuantity(r, base.count as never, env);
  const mvOf = (id: ObjId) => chars(r, id).mv;
  const subtypesOf = (id: ObjId) => chars(r, id).subtypes.map((x) => x.toLowerCase());
  const fits = (id: ObjId): boolean => {
    if (picked.includes(id)) return false;
    if (base.excludeNamed !== undefined && chars(r, id).name.toLowerCase() === String(base.excludeNamed).toLowerCase()) return false;
    if (base.distinctNames && picked.some((p) => chars(r, p).name === chars(r, id).name)) return false;
    if (base.totalManaValueAtMost !== undefined && picked.reduce((n, p) => n + mvOf(p), mvOf(id)) > evalQuantity(r, base.totalManaValueAtMost as never, env)) return false;
    if (base.sharesLandType && picked.length && !picked.every((p) => subtypesOf(p).some((t) => subtypesOf(id).includes(t)))) return false;
    return true;
  };
  const cands = picked.length >= limit ? [] : player(r, searcher).library.filter((id) => matchesFilter(r, id, { ...filter, zone: undefined, owner: undefined }, { ...env, controller: searcher }) && fits(id));
  if (!cands.length) return finishSearch(r, env, base, searcher, [searcher], picked);
  const spec: AskSpec = {
    kind: "choose_cards", player: searcher,
    prompt: base.prompt ?? fallbackPrompt(r, env, "search", "Search the library: choose a card (or none to stop)."),
    options: cands.map((id) => ({ id, label: label(r, id) })), min: 0, max: 1
  };
  const d = decide(spec, answer);
  if ("ask" in d) return d;
  if (!d.ids.length) return finishSearch(r, env, base, searcher, [searcher], picked);
  return { push: [{ kind: "__search_pick", base, picked: [...picked, d.ids[0]] } as unknown as Step] };
};

function finishSearch(r: Run, env: Env, step: Step, searcher: PlayerId, owners: PlayerId[], found: ObjId[]): "done" {
  {
    const to = String(step.to ?? "hand");
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
}

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
