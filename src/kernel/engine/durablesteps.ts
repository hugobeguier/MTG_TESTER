// Steps that create durable effects / delayed triggers (see durable.ts): permission_to_play, create_delayed_trigger, and the
// player-scoped form of grant_effect (a replacement shield or a player flag for a while).

import type { Step } from "../schema";
import { describeStep } from "../prompts";
import { Unsupported, tryObj, label, type Run } from "./core";
import { resolveObjs, resolvePlayers } from "./query";
import { addDelayed, addDurable, expiryFor, SUPPORTED_DURABLE_DURATIONS } from "./durable";
import type { StepSpec } from "./steps";
import type { Env, PlayerId } from "./types";

export { isDurablePermission } from "../prompts"; // (the predicate lives with the prompt generator: durable permissions never carry a prompt)

export const permissionStep: StepSpec = {
  fields: ["what", "target", "zone", "withoutPaying", "withoutPayingManaCost", "duration", "allow", "who", "elseToHand"],
  run: (r, ex, step) => {
    const env = ex.env;
    const ref = (step.what ?? step.target) as string | undefined;
    if (!ref) throw new Unsupported("field:permission_to_play.what", "permission_to_play needs a card reference");
    const dur = step.duration;
    // hideaway and friends: "you may play the exiled card" is decided as the ability resolves (queued: resolve.ts runCastNow)
    const now = (ref === "linked_exile" && dur === undefined) || dur === "instant"; // "you may cast it as part of this resolution" (Rishkar's Expertise, hideaway)
    if (!now && dur !== undefined && (typeof dur !== "string" || !SUPPORTED_DURABLE_DURATIONS.has(dur))) throw new Unsupported(`duration:${typeof dur === "string" ? dur : Object.keys(dur)[0]}`);
    const owner = resolvePlayers(r, step.who ?? "you", env)[0];
    const allow = (step.allow as Array<"land" | "spell"> | undefined) ?? ["land", "spell"];
    for (const id of resolveObjs(r, ref, env)) {
      const o = tryObj(r, id);
      if (!o || o.zone === "battlefield" || o.zone === "stack") continue;
      if (step.zone && step.zone !== "any" && o.zone !== step.zone) continue;
      if (now) { (r.castNow ??= []).push({ player: owner, id, ts: o.timestamp, withoutPaying: !!(step.withoutPaying || step.withoutPayingManaCost), ...(step.elseToHand ? { elseToHand: true } : {}) }); }
      addDurable(r, {
        owner, source: env.source, expires: now ? { ev: "cleanup", turn: r.s.turn.number } : expiryFor(r, dur, owner),
        permission: { objectId: id, objectTs: o.timestamp, zone: o.zone, withoutPaying: !!(step.withoutPaying || step.withoutPayingManaCost), allow }
      });
    }
    return "done";
  }
};

/** "at the beginning of the next end step, return The Ur-Dragon to its owner's command zone": the readable line for the log and the trigger's stack label. */
function describeDelayed(r: Run, steps: Step[], targets: Record<string, string[]>, source: string, at: { event: string; step?: string; whose?: string }): string {
  const nameOf = (ref: string): string | undefined => {
    const ids = ref === "self" ? [source] : targets[ref];
    return ids?.length ? ids.map((i) => label(r, i)).join(" and ") : undefined;
  };
  const named = JSON.parse(JSON.stringify(steps), (_k, v) => (typeof v === "string" && /^(td+|__c|__e|self)$/.test(v) ? nameOf(v) ?? v : v)) as Step[];
  const what = named.map((s) => { try { return describeStep(s); } catch { return String(s.kind).replace(/_/g, " "); } }).join(", then ") || "do something";
  const step = (at.step ?? "").replace(/_/g, " ");
  const when = at.event === "begin_step" ? `at the beginning of ${at.whose === "yours" ? "your" : at.whose === "opponents" ? "an opponent's" : "the"} next ${step}` : at.event === "dies" ? "when it dies this turn" : "when it leaves the battlefield";
  return `${when}, ${what}`;
}

export const delayedStep: StepSpec = {
  fields: ["at", "trigger", "steps", "duration"],
  run: (r, ex, step) => {
    const env = ex.env;
    const at = (step.at ?? step.trigger) as { event: string; step?: string; whose?: string; next?: boolean; subject?: string } | undefined;
    if (!at) throw new Unsupported("field:create_delayed_trigger.at");
    const dur = step.duration;
    if (dur !== undefined && dur !== "until_end_of_turn") throw new Unsupported(`duration:${typeof dur === "string" ? dur : Object.keys(dur)[0]}`);
    const ctx = { eventObj: env.eventObj, eventPlayer: env.eventPlayer, amount: env.amount, x: env.x };
    // "chosen" in the delayed steps means what the creating ability chose: snapshot it as an explicit target slot (__c)
    const targets = structuredClone(env.targets) as Record<string, string[]>;
    let steps = (step.steps ?? []) as Step[];
    if (JSON.stringify(steps).includes('"chosen"')) {
      targets.__c = (env.chosen[env.lastChosen ?? "chosen"] ?? []).filter((id) => id.startsWith("#")); // the chosen cards themselves (they may have moved since: the delayed effect follows them)
      steps = JSON.parse(JSON.stringify(steps).replace(/"(target|what)":"chosen"/g, '"$1":"__c"'));
    }
    if (JSON.stringify(steps).includes('"enchanted"')) { // "that creature" of an Aura (Animate Dead): the delayed effect follows the creature it enchanted when it was created, the Aura itself is gone by then
      targets.__e = resolveObjs(r, "enchanted", env);
      steps = JSON.parse(JSON.stringify(steps).replace(/"(target|what)":"enchanted"/g, '"$1":"__e"'));
    }
    for (const k of Object.keys(env.chosen)) if (steps && JSON.stringify(steps).includes(`"list":"${k}"`)) targets["__l_" + k] = (env.chosen[k] ?? []).filter((id) => id.startsWith("#")); // lists the delayed steps count ("for each of those cards still exiled")
    const base = { source: env.source, controller: env.controller, steps, targets, ctx, label: `${label(r, env.source)}: ${describeDelayed(r, steps, targets, env.source, at)}` };
    if (at.event === "begin_step") {
      if (!at.step || at.next === false) throw new Unsupported("field:create_delayed_trigger.at");
      addDelayed(r, { ...base, at: { event: "begin_step", step: at.step as never, whose: (at.whose as "yours" | "opponents" | "each" | undefined) ?? "yours" } });
    } else if (at.event === "dies") {
      const ids = resolveObjs(r, at.subject, env);
      addDelayed(r, { ...base, at: { event: "dies", ids }, expires: expiryFor(r, (dur as "until_end_of_turn" | undefined) ?? "until_end_of_turn", env.controller) });
    } else if (at.event === "leaves") {
      // "when this leaves the battlefield, ..." (Animate Dead): the nested steps read the source through its last-known information
      addDelayed(r, { ...base, at: { event: "leaves", ids: resolveObjs(r, at.subject, env) } });
    } else throw new Unsupported(`field:create_delayed_trigger.at=${at.event}`);
    return "done";
  }
};

/** grant_effect on PLAYERS (no target / filter): a replacement shield ("prevent all combat damage dealt to you this turn") or a flag ("no maximum hand size"). */
export function grantToPlayers(r: Run, env: Env, step: Step): void {
  const dur = step.duration;
  if (dur !== undefined && !(typeof dur === "string" && (SUPPORTED_DURABLE_DURATIONS.has(dur) || dur === "instant")) && !(typeof dur === "object" && "until" in dur && String(dur.until) === "unspecified")) {
    throw new Unsupported(`duration:${typeof dur === "string" ? dur : Object.keys(dur)[0]}`);
  }
  // whoever is named gets one shield; "each_player" is a single shield that covers everyone (the spec's recipient decides what it hits)
  const whoRef = (step.who as string | undefined) ?? "you";
  const owner: PlayerId = whoRef === "each_player" || whoRef === "each_opponent" ? env.controller : resolvePlayers(r, whoRef as never, env)[0];
  const expires = expiryFor(r, typeof dur === "string" && SUPPORTED_DURABLE_DURATIONS.has(dur) ? dur : undefined, owner);
  if (step.appliesTo === "next_spell_cast") {
    const grants: string[] = [];
    for (const m of (step.modify ?? []) as Array<Record<string, unknown>>) {
      if (typeof m.grant === "string") grants.push(m.grant.toLowerCase());
      else if (m.cant === "be_countered") grants.push("cant:be_countered");
      else throw new Unsupported(`field:grant_effect.modify.${Object.keys(m)[0]}`, "this next-spell grant is not modelled");
    }
    addDurable(r, { owner, source: env.source, expires: expiryFor(r, "until_end_of_turn", owner), nextSpell: grants });
    return;
  }
  if (step.appliesTo !== undefined) throw new Unsupported("field:grant_effect.appliesTo");
  const rep = step.replacement as import("../schema").ReplacementSpec | undefined;
  if (rep) { addDurable(r, { owner, source: env.source, expires, replacement: { ...rep, duration: undefined } }); return; }
  const mods = (step.modify ?? []) as Array<Record<string, unknown>>;
  for (const m of mods) {
    if ("grant" in m && String(m.grant).toLowerCase() === "no maximum hand size") addDurable(r, { owner, source: env.source, expires, flag: "no_max_hand_size" });
    else if ("grant" in m && String(m.grant).toLowerCase() === "protection from everything") addDurable(r, { owner, source: env.source, expires, flag: "protection_everything" }); // Perch Protection: damage to the player is prevented, nothing can target the player
    else throw new Unsupported(`field:grant_effect.modify.${Object.keys(m)[0]}`, "this player-scoped grant is not modelled");
  }
}
