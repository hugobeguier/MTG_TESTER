// An Aura that enters the battlefield WITHOUT being cast (a token copy of an Aura, reanimated / returned / blinked Auras, Redress Fate,
// Starfield of Nyx, ...) is not targeted: its controller CHOOSES what it will enchant as it enters, among the objects its "Enchant ..."
// restriction allows (CR 303.4f, 303.4g, 303.4h, 707.9). With exactly one legal choice it is picked without a question; with none the Aura does
// not enter (a card stays where it was, a token ceases to exist) and the log says so. An Aura that was CAST takes its host from its target
// (resolve.ts); an Aura entering from the stack never gets here.
// The question uses the replay protocol (like the commander-zone question): moveObject throws NeedAsk and the action is replayed with the answer.

import type { Prompt, TargetSpec } from "../schema";
import { NeedAsk, chars, label, takeAnswer, type Run } from "./core";
import { objectsMatching } from "./query";
import { protectedFrom } from "./protection";
import type { AskSpec } from "./steps";
import type { GameObject, ObjId, PlayerId } from "./types";

export type AuraHost = { host: ObjId } | { player: PlayerId } | "none";

/** The restriction of an Aura's "Enchant ..." keyword, if it has one the engine can evaluate on the battlefield. */
export function enchantSpec(r: Run, id: ObjId): TargetSpec | undefined {
  const c = chars(r, id);
  if (!c.subtypes.some((s) => s.toLowerCase() === "aura")) return undefined;
  const ab = c.abilities.find((a) => a.keyword?.name?.toLowerCase() === "enchant" && a.targets?.length);
  const spec = ab?.targets?.[0] as TargetSpec | undefined;
  if (!spec) return undefined;
  const zone = spec.filter?.zone;
  if (zone && zone !== "battlefield") return undefined; // "enchant creature card in a graveyard" (Animate Dead) is only ever cast
  return spec;
}

/** What the Aura `o` (about to enter under `controller`) can enchant, other than itself. */
export function auraCandidates(r: Run, o: GameObject, spec: TargetSpec, controller: PlayerId): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  const f = spec.filter ?? {};
  if (spec.what === "player" || spec.what === "any") {
    for (const p of r.s.players) {
      if (p.hasLost) continue;
      if (f.controller === "opponent" && p.id === controller) continue;
      if (f.controller === "you" && p.id !== controller) continue;
      out.push({ id: p.id, label: p.name });
    }
  }
  if (spec.what === "object" || spec.what === "any") {
    let ids = objectsMatching(r, { ...f, zone: "battlefield" }, { controller, source: o.id });
    if (spec.what === "any") ids = ids.filter((id) => ["creature", "planeswalker"].some((t) => chars(r, id).types.includes(t)));
    for (const id of ids) if (id !== o.id && !protectedFrom(r, id, o.id)) out.push({ id, label: label(r, id) });
  }
  return out;
}

/** Decide what the entering Aura enchants. undefined = not an Aura this applies to (enter normally). */
export function chooseAuraHost(r: Run, o: GameObject, controller: PlayerId): AuraHost | undefined {
  const spec = enchantSpec(r, o.id);
  if (!spec) return undefined;
  const cands = auraCandidates(r, o, spec, controller);
  if (!cands.length) return "none";
  let pick = cands[0].id;
  if (cands.length > 1) {
    const given = takeAnswer(r);
    if (given === undefined) {
      const name = label(r, o.id);
      const prompt: Prompt = { title: `${name}: what does it enchant?`, instruction: `${name} enters the battlefield without being cast. Choose what it enchants (${spec.prompt?.instruction?.replace(/^Choose /, "").replace(/\.$/, "") ?? "a legal object"}).` };
      const ask: AskSpec = { kind: "choose_option", player: controller, prompt, options: cands, min: 1, max: 1 };
      throw new NeedAsk(ask);
    }
    const id = given.ids?.[0];
    if (!id || !cands.some((c) => c.id === id)) throw new NeedAsk({ kind: "choose_option", player: controller, prompt: { title: `${label(r, o.id)}: what does it enchant?`, instruction: "That is not a legal choice. Choose what the Aura enchants." }, options: cands, min: 1, max: 1 });
    pick = id;
  }
  return r.s.objects[pick] ? { host: pick } : { player: pick };
}
