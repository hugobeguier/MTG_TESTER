// "Reveal cards until ..." and the revealed / milled card sets (kernel step 7). A reveal-until, a search that only reveals ("to: revealed")
// remember the revealed cards as the LOOKED set of the resolving ability (the same set look_top uses), so `fromRevealed`,
// `rest_of_revealed_cards` and `revealed_cards` are the looked-at refs; the cards stay in the library until a later step moves them.
// A mill remembers the cards it milled (`chosen.__milled`) for `fromMilled`.

import type { ObjectFilter, Step } from "../schema";
import { player, tryObj, type Run } from "./core";
import { evalQuantity, matchesFilter, resolvePlayers } from "./query";
import { saveLooked, setResult } from "./saved";
import { revealCards } from "./library";
import type { Env, ObjId } from "./types";

export const MILLED_KEY = "__milled";

/** The cards a "reveal until" step reveals: from the top of the library until the condition is met (all of it when it never is). */
export function revealUntil(r: Run, env: Env, step: Step): ObjId[] {
  const who = resolvePlayers(r, step.who ?? "you", env)[0];
  const lib = player(r, who).library;
  const u = step.until as { count?: unknown; filter?: ObjectFilter } & ObjectFilter;
  const filter = (u.count !== undefined ? u.filter : u) ?? {};
  const bare = { ...filter, zone: undefined, owner: undefined, controller: undefined } as ObjectFilter;
  const need = u.count !== undefined ? evalQuantity(r, u.count as never, env) : 1;
  const out: ObjId[] = [];
  let hits = 0;
  if (need <= 0) return out;
  for (const id of lib) {
    out.push(id);
    if (matchesFilter(r, id, bare, { ...env, controller: who })) { hits++; if (hits >= need) break; }
  }
  return out;
}

export function revealUntilRun(r: Run, env: Env, step: Step): void {
  const ids = revealUntil(r, env, step);
  saveLooked(r, env, ids);
  revealCards(r, env.controller, ids, env.source);
  if (typeof step.saveAs === "string") env.chosen[step.saveAs] = [...ids];
  setResult(env, step.id as string | undefined, ids.length);
}

/** Cards a mill step just milled: remembered for "choose a card milled this way". */
export function recordMilled(env: Env, ids: ObjId[]): void { env.chosen[MILLED_KEY] = ids; }

export const milledLive = (r: Run, env: Env): ObjId[] => (env.chosen[MILLED_KEY] ?? []).filter((id) => tryObj(r, id)?.zone === "graveyard");

// (a top-level `void emit; void Unsupported;` here read core's bindings while core.ts was still initialising in the browser bundle: a TDZ crash)
