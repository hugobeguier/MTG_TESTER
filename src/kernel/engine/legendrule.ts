// The legend rule (CR 704.5j): if a player controls two or more legendary permanents with the same name, that player chooses one of them and puts
// the rest into their owners' graveyards (a token simply ceases to exist). Checked by the state-based actions. The question uses the replay protocol
// (like the commander-zone question): `NeedAsk` is thrown and the action is replayed with the answer. Permanents with no name (face-down, locked
// Room halves) never match each other.

import type { Prompt } from "../schema";
import { NeedAsk, chars, emit, label, moveObject, takeAnswer, type Run } from "./core";
import { withCharsEpoch } from "./layers";
import type { ObjId } from "./types";

/** Returns true when something was put into a graveyard. */
export function applyLegendRule(r: Run): boolean {
  let changed = false;
  for (const p of r.s.players) {
    const byName = new Map<string, ObjId[]>();
    withCharsEpoch(r, () => { // pure reads: one shared characteristics memo for the whole pass
      for (const id of r.s.battlefield) {
        const o = r.s.objects[id];
        if (!o || o.zone !== "battlefield" || o.controller !== p.id) continue;
        const c = chars(r, id);
        if (!c.name || !c.supertypes.some((s) => s.toLowerCase() === "legendary")) continue;
        const k = c.name.toLowerCase();
        byName.set(k, [...(byName.get(k) ?? []), id]);
      }
    });
    for (const ids of byName.values()) {
      if (ids.length < 2) continue;
      const name = label(r, ids[0]);
      const given = takeAnswer(r);
      const options = ids.map((id) => ({ id, label: `${name}${r.s.objects[id].token ? " (token)" : ""}` }));
      if (given === undefined) {
        const prompt: Prompt = { title: `Legend rule: ${name}`, instruction: `You control more than one legendary permanent named ${name}. Choose the one to keep; the others are put into their owners' graveyards.` };
        throw new NeedAsk({ kind: "choose_option", player: p.id, prompt, options, min: 1, max: 1 });
      }
      const keep = given.ids?.[0];
      if (!keep || !ids.includes(keep)) throw new NeedAsk({ kind: "choose_option", player: p.id, prompt: { title: `Legend rule: ${name}`, instruction: "That is not a legal choice. Choose the legendary permanent to keep." }, options, min: 1, max: 1 });
      for (const id of ids) if (id !== keep) { emit(r, { type: "sba_legend_rule", id, kept: keep, player: p.id }); moveObject(r, id, "graveyard"); changed = true; }
    }
  }
  return changed;
}
