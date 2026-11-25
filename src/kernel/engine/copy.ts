// The `copy` step (kernel step 5). Two kinds of copies, both NEW objects (400.7: a copy is never the object it copies):
//   - a copy of a PERMANENT is a token that has the copiable values of the original (name, types, mana cost, P/T, abilities, ...),
//     snapshotted into the token's definition, plus the step's exceptions (not legendary, gains haste, is also an artifact...).
//     Copying a token copies its definition; copying a copy copies the copy's definition (so exceptions carry over, as the rules say).
//     The creation goes through the `would_create_token` replacement event like any other token creation (Doubling Season, ...)
//     and the copy enters the battlefield normally (enters-the-battlefield triggers fire for it).
//   - a copy of a SPELL (storm, "copy it for each creature sacrificed") is a new object on the stack with its own stack item: same
//     modes, targets, X and how it was cast. It is not cast (no cast triggers); it ceases to exist when it leaves the stack or
//     the battlefield. A permanent-spell copy that resolves becomes a permanent (not a token unless the card says so).
// Not modelled (reported as unsupported fields, never ignored): becoming a copy (`of`), entering as a copy (`asEnters`), choosing
// new targets, copies that enter tapped / attacking, `forEach`, `chooseOne`, extra abilities on the copy.

import type { Ability, Step } from "../schema";
import { baseChars, chars, defOf, faceMeta, isRoomOnBattlefield, emit, label, newObject, opponentsOf, player, tick, tryObj, Unsupported, type Run } from "./core";
import { addDelayed } from "./durable";
import { evalQuantity, objectsMatching, resolveObjs, resolvePlayers } from "./query";
import { invalidateIndex } from "./layers";
import { applyReplacements, runAfter } from "./replacements";
import { createToken, decide, type StepSpec } from "./steps";
import type { GameObject, ObjId, PlayerId, StackItem, TokenDef } from "./types";

export const COPY_FIELDS = ["what", "target", "count", "token", "controller", "notLegendary", "gainKeywords", "exceptAddTypes", "exileAt", "reflexive", "who", "of", "duration", "exceptGrant", "asEnters", "addAbility", "all", "filter", "becomes", "excludeChosen", "chooseNewTargets", "chooseOne", "exceptName", "forEach", "forPlayer", "tapped", "attacking", "setPower", "setToughness"];

/** The copiable values of an object as a token definition (exceptions are applied by the caller). */
export function copiableDef(r: Run, o: GameObject): TokenDef {
  if (o.token || o.copyDef) return structuredClone((o.copyDef ?? o.token)!);
  const c = baseChars(r, o);
  const d = defOf(r, o)!, m = faceMeta(d, o); // the copied FACE's mana cost and loyalty (a back face has no mana cost: the token's mana value is 0, 707.8)
  return {
    name: c.name, types: [...c.types], subtypes: [...c.subtypes], supertypes: [...c.supertypes], colors: [...c.colors],
    power: c.power, toughness: c.toughness, keywords: [], abilities: structuredClone(c.abilities), manaCost: isRoomOnBattlefield(d, o) ? d.manaCost : m.manaCost,
    ...(m.loyalty !== undefined && c.types.includes("planeswalker") ? { loyalty: m.loyalty } : {})
  };
}

function applyExceptions(def: TokenDef, step: Step): TokenDef {
  const d = structuredClone(def);
  d.copy = true;
  if (step.exceptName) d.name = String(step.exceptName);
  if (step.notLegendary) d.supertypes = (d.supertypes ?? []).filter((s) => s.toLowerCase() !== "legendary");
  for (const t of (step.exceptAddTypes as string[] | undefined) ?? []) {
    const l = t.toLowerCase();
    if (l === "legendary") { if (!(d.supertypes ?? []).includes("legendary")) d.supertypes = [...(d.supertypes ?? []), "legendary"]; continue; }
    if (["artifact", "creature", "enchantment", "land", "planeswalker", "battle", "kindred"].includes(l)) { if (!d.types.includes(l)) d.types.push(l); }
    else if (!d.subtypes.includes(t)) d.subtypes.push(t);
  }
  for (const k of ((step.gainKeywords ?? step.exceptGrant) as string[] | undefined) ?? []) if (!d.keywords.some((x) => x.toLowerCase() === k.toLowerCase())) d.keywords.push(k.toLowerCase());
  if (step.addAbility) d.abilities = [...(d.abilities ?? []), { ...(step.addAbility as Ability), id: (step.addAbility as Ability).id ?? "copy:added" }];
  return d;
}

/** A copy of the spell `spellObj` (on the stack) controlled by `controller`: new object + new stack item on top of the stack. */
export function copySpell(r: Run, spellObj: GameObject, controller: PlayerId): ObjId | undefined {
  const item = r.s.stack.find((i) => i.objectId === spellObj.id);
  if (!item) return undefined;
  const copy = newObject(r, spellObj.cardName, spellObj.owner, "stack", { isCopy: true, controller, castX: spellObj.castX, cast: spellObj.cast ? structuredClone(spellObj.cast) : undefined });
  copy.controller = controller;
  if (spellObj.token) copy.token = structuredClone(spellObj.token);
  const ci: StackItem = {
    id: `s${r.s.nextId++}`, kind: "spell", sourceId: copy.id, objectId: copy.id, controller, abilityId: item.abilityId,
    parts: structuredClone(item.parts), x: item.x, cast: item.cast ? structuredClone(item.cast) : undefined,
    ...(item.sacrificed?.length ? { sacrificed: [...item.sacrificed], costLki: structuredClone(item.costLki ?? {}) } : {})
  };
  r.s.stack.push(ci);
  emit(r, { type: "spell_copied", id: copy.id, of: spellObj.id, controller, item: ci.id, depth: r.s.stack.length });
  tick(r);
  return copy.id;
}

/**
 * "Becomes a copy of" / "enters as a copy of" (layer 1, kernel step 6): the permanent keeps its object identity but takes the copiable values of
 * another object (`copyDef`, a token-style snapshot) plus the step's exceptions and extra abilities, until end of turn or for good. `of` is a
 * reference (a target, "chosen", a saved name) or an object filter: then the controller CHOOSES the object to copy first (a decision).
 */
function becomeStep(r: Run, ex: { env: import("./types").Env }, step: Step): "done" | { push: Step[] } {
  const env = ex.env;
  const source = (step.of ?? (step.asEnters ? step.what : undefined)) as unknown;
  if (source && typeof source === "object") {
    const key = "__copy_of";
    const { what: _w, asEnters: _a, ...rest } = step;
    return { push: [
      { kind: "choose", from: source as never, count: 1, saveAs: key, who: "you", prompt: { title: `${label(r, env.source)}: choose what to copy`, instruction: "Choose the object to copy." } } as Step,
      { ...rest, of: key, target: step.target ?? (step.asEnters ? "self" : undefined) } as Step
    ] };
  }
  const copied = resolveObjs(r, String(source), env).map((id) => tryObj(r, id)).filter((o): o is GameObject => !!o)[0];
  if (!copied) return "done"; // nothing (left) to copy
  const becomers = step.all
    ? objectsMatching(r, step.filter as never, env).filter((id) => !(step.excludeChosen && id === copied.id))
    : resolveObjs(r, String(step.target ?? "self"), env);
  const def = applyExceptions(copiableDef(r, copied), step);
  for (const id of becomers) {
    const o = tryObj(r, id);
    if (!o) continue;
    if (o.zone !== "battlefield" && !(r.entering && r.entering.id === id) && o.zone !== "stack") continue;
    o.copyDef = structuredClone(def);
    o.copyUntilEot = step.duration === "until_end_of_turn" ? true : undefined;
    invalidateIndex(r);
    emit(r, { type: "became_copy", id, of: copied.id });
  }
  return "done";
}

export const copyStep: StepSpec = {
  fields: COPY_FIELDS,
  run: (r, ex, step, answer) => {
    if (step.of !== undefined || step.asEnters) return becomeStep(r, ex, step);
    const env = ex.env;
    // "a token that's a copy of ONE of them" (Twilight Diviner): the controller picks which of the objects of the batch
    if (step.chooseOne && step.what === "event_object" && (env.batchObjs?.length ?? 0) > 1) return { push: [{ kind: "__choose_ids" as never, ids: env.batchObjs, saveAs: "chosen" } as unknown as Step, { ...step, chooseOne: undefined, what: "chosen" } as Step] };
    const ref = String(step.what ?? step.target ?? "");
    if (!ref) throw new Unsupported("field:copy.what");
    // a copy of an ABILITY on the stack (Sunken Palace: "copy that spell or ability"): a new stack item with the same targets / modes / X; it has no source object of its own
    if (ref === "event_object" && env.eventObj && /^s\d+$/.test(env.eventObj)) {
      const item = r.s.stack.find((i) => i.id === env.eventObj);
      if (!item) return "done";
      const who0: PlayerId = resolvePlayers(r, (step.controller ?? step.who ?? "you") as never, env)[0];
      const ci: StackItem = { ...structuredClone(item), id: `s${r.s.nextId++}`, controller: who0 };
      r.s.stack.push(ci);
      emit(r, { type: "ability_copied", of: item.id, controller: who0, item: ci.id, depth: r.s.stack.length, source: ci.sourceId });
      tick(r);
      return step.chooseNewTargets ? { push: [{ kind: "__retarget" as never, itemId: ci.id, pi: 0, si: 0 } as unknown as Step] } : "done";
    }
    if (step.forEach !== undefined) {
      // Myriad (CR 702.116): for each opponent other than the defending player, you MAY make a token copy attacking that player or a planeswalker they control
      if (step.forEach !== "opponent_other_than_defending_player") throw new Unsupported(`field:copy.forEach=${String(step.forEach)}`);
      const others = opponentsOf(r, env.controller).filter((p) => p.id !== env.eventPlayer);
      return { push: others.map((p) => ({ ...step, forEach: undefined, forPlayer: p.id, optional: true, prompt: { title: `${label(r, env.source)}: myriad`, instruction: `Create a tapped and attacking token copy of ${label(r, env.source)} that attacks ${p.name}?` } }) as Step) };
    }
    // a copy that enters attacking: the defender is the named player or one of their planeswalkers (asked when there is a choice)
    let defender: string | undefined;
    if (step.attacking) {
      const fp = (step.forPlayer ?? env.eventPlayer) as PlayerId | undefined;
      if (!fp) throw new Unsupported("field:copy.attacking");
      if (!r.s.combat) return "done";
      const pws = r.s.battlefield.filter((id) => r.s.objects[id].controller === fp && chars(r, id).types.includes("planeswalker"));
      if (!pws.length) defender = fp;
      else {
        const d = decide({ kind: "choose_option", player: env.controller, prompt: { title: `${label(r, env.source)}: what does the copy attack?`, instruction: `Choose ${player(r, fp).name} or one of their planeswalkers.` }, options: [{ id: fp, label: player(r, fp).name }, ...pws.map((id) => ({ id, label: label(r, id) }))], min: 1, max: 1 }, answer);
        if ("ask" in d) return d;
        defender = d.ids[0];
      }
    }
    const sources = ref === "self" ? [env.source] : resolveObjs(r, ref, env);
    const n = step.count === undefined ? 1 : Math.max(0, Number(typeof step.count === "number" ? step.count : evalQuantity(r, step.count as never, env)));
    const who: PlayerId = resolvePlayers(r, (step.controller ?? step.who ?? "you") as never, env)[0];
    env.created = [];
    const copiedItems: string[] = [];
    for (const id of sources) {
      const o = tryObj(r, id);
      if (!o && !r.s.lki[id]?.copyDef) continue;
      if (o && o.zone === "stack") {
        // a copy of a spell (the object may also be a copy: copy of a copy)
        for (let i = 0; i < n; i++) { const c = copySpell(r, o, who); if (c) { env.created.push(c); const it = r.s.stack.find((x) => x.objectId === c); if (it) copiedItems.push(it.id); } }
        continue;
      }
      if (!step.token) throw new Unsupported("field:copy.token", "a non-token copy of a permanent only exists as 'enters as a copy' (not modelled)");
      let def: TokenDef;
      if (o && o.zone === "battlefield") def = applyExceptions(copiableDef(r, o), step);
      else {
        // it left the battlefield during this resolution ("destroy it; if it dies, its controller creates two tokens that are copies of that creature", Saw in Half): copy how it last existed
        const lk = r.s.lki[id];
        const base = lk?.copyDef ? structuredClone(lk.copyDef) : o && lk ? copiableDef(r, o) : undefined;
        if (!base) continue;
        def = applyExceptions(base, step);
      }
      if (step.setPower !== undefined) def.power = evalQuantity(r, step.setPower as never, env); // "except its power is half ..."
      if (step.setToughness !== undefined) def.toughness = evalQuantity(r, step.setToughness as never, env);
      const ev = applyReplacements(r, { kind: "tokens", player: who, groups: n > 0 ? [{ def, count: n, tapped: false }] : [] });
      if (!ev.cancelled && ev.kind === "tokens") for (const g of ev.groups) for (let i = 0; i < g.count; i++) createToken(r, who, g.def, !!g.tapped || !!step.tapped, env.created);
      runAfter(r, ev);
    }
    if (defender && r.s.combat) for (const id of env.created) { const o = tryObj(r, id); if (o && o.zone === "battlefield") r.s.combat.attackers.push({ id, ts: o.timestamp, defender, blockers: [], blocked: false }); } // never declared as attackers: no attack triggers
    const exileAt = step.exileAt as string | undefined;
    if (exileAt && env.created.length) {
      if (exileAt !== "next_end_step" && exileAt !== "end_of_combat") throw new Unsupported(`field:copy.exileAt=${exileAt}`);
      const key = "t901";
      addDelayed(r, {
        source: env.source, controller: env.controller, steps: [{ kind: "exile_target", target: key } as Step], targets: { [key]: [...env.created] }, ctx: {},
        at: { event: "begin_step", step: exileAt === "end_of_combat" ? "end_of_combat" : "end_step", whose: "each" }, label: `${label(r, env.source)}: at the beginning of the ${exileAt === "end_of_combat" ? "end of combat" : "next end step"}, exile ${env.created.map((i) => label(r, i)).join(" and ")}`
      });
    }
    // "You may choose new targets for the copy": the controller of the copy re-chooses each target slot (keeping the same targets is allowed)
    if (step.chooseNewTargets && copiedItems.length) return { push: copiedItems.map((itemId) => ({ kind: "__retarget" as never, itemId, pi: 0, si: 0 }) as unknown as Step) };
    return "done";
  }
};
