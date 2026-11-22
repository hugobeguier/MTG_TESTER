// Saved choices / results of earlier steps of the same resolving ability ("chosen", "found", "exiled", looked-at cards).
// A card that changes zone is a NEW object (rule 400.7): a saved reference remembers the object's timestamp (refreshed by every
// zone change) and stops referring to it once that differs, so "choose a card in your hand, put it into your graveyard, then ..."
// cannot act on the same card twice and a flickered permanent is not "the same" permanent any more.

import { tryObj, type Run } from "./core";
import type { Env, ObjId } from "./types";
import { isObjId } from "./types";

type SavedEnv = Pick<Env, "chosen"> & Partial<Pick<Env, "savedTs" | "lastChosen" | "looked">>;

/** Remember `ids` under `key` (objects are stamped with their current timestamp). */
export function saveList(r: Run, env: SavedEnv, key: string, ids: string[]): void {
  env.chosen[key] = [...ids];
  env.lastChosen = key;
  if (key === "event_object") (env as { eventObj?: string }).eventObj = ids[0]; // "reveal ... that card is the event object" for the next steps
  const ts = (env.savedTs ??= {});
  for (const id of ids) { const o = tryObj(r, id); if (o) ts[id] = o.timestamp; }
}

/** A numeric result (choose number, how many were destroyed...) readable as `{ref:"step_result"}`. */
export function setResult(env: SavedEnv, stepId: string | undefined, n: number): void { if (stepId) env.chosen[stepId] = [String(n)]; }
export function resultOf(env: SavedEnv, stepId: string): number | undefined {
  const v = env.chosen[stepId]?.[0];
  if (v !== undefined && /^-?\d+$/.test(v)) return Number(v);
  // a choose-from-cards step that saved a list under its id: its result is how many cards were chosen ("tap X untapped Myr")
  const list = env.chosen[stepId];
  return list && list.every((x) => isObjId(x)) ? list.length : undefined;
}

/** Saved object ids that are still the same object (same timestamp); player ids and numbers pass through. */
export function liveIds(r: Run, env: SavedEnv, ids: string[]): string[] {
  return ids.filter((id) => {
    if (!isObjId(id)) return true;
    const o = tryObj(r, id);
    if (!o) return false;
    const ts = env.savedTs?.[id];
    return ts === undefined || ts === o.timestamp;
  });
}

/** The cards a look_top step looked at that are still where it left them (a card moved since is a new object). */
export function lookedLive(r: Run, env: SavedEnv): ObjId[] { return liveIds(r, env, env.looked ?? []).filter((id) => tryObj(r, id)?.zone === "library"); }

export function saveLooked(r: Run, env: SavedEnv, ids: string[]): void {
  env.looked = [...ids];
  const ts = (env.savedTs ??= {});
  for (const id of ids) { const o = tryObj(r, id); if (o) ts[id] = o.timestamp; }
}

/** `{ref:"chosen"}`-style reads: the last saved list, or a list saved under that exact name. */
export function savedObjs(r: Run, env: SavedEnv, ref: string): ObjId[] {
  if (ref === "chosen") {
    const key = env.lastChosen && env.chosen[env.lastChosen] ? env.lastChosen : undefined;
    const list = key ? env.chosen[key] : Object.values(env.chosen).flat();
    return liveIds(r, env, list.filter(isObjId));
  }
  return liveIds(r, env, (env.chosen[ref] ?? []).filter(isObjId));
}
