// Continue mode (Config.onUnsupported === "continue", the live-game mode). POLICY: when the engine meets a card / ability it cannot run it never
// crashes, refuses the action or ends the game. It (a) emits an `unresolved` event naming the CARD and exactly WHAT could not be resolved (the
// ability / clause text and the missing capability), and (b) keeps playing: only the unsupported step / clause is skipped, the rest of the card
// resolves normally. The kernel stays pure: it only emits events; the host writes them to the shared sink (unresolvedBridge.ts).
//
// What happens per category (strict mode, the default, still refuses with error code "unsupported"):
//   step (any kind / field / duration / reference / predicate it cannot evaluate)  skipped, event effect "skipped"; the other steps run
//   cost of an activated / mana ability, or of a cast option (kicker, alternative cost ...)  NEVER silently free: the ability is NOT performed
//        (nothing is paid, nothing goes on the stack, the player keeps priority; effect "not_performed"); an unsupported cast OPTION is simply
//        not offered, the normal way to cast the card stays available
//   targets / timing / zone / keyword / scripted marker of an activated or mana ability  same: not performed
//   spell ability (spell_effect) whose frame is unsupported  the spell is cast and goes to its zone as usual, its effect is skipped
//   trigger that the engine cannot detect / evaluate, static ability the layers cannot apply, replacement effect, keyword ability  ignored (never
//        fires / applies); reported ONCE per permanent, when it first matters (the first state it is on the battlefield), not on every pass
//   anything else that still throws Unsupported deep inside an action  last resort in resolve(): the action is a no-op plus an event
// Determinism: the events depend only on (state, action, seed, card data): same input -> same events.

import type { Ability, CastOption, Step } from "../schema";
import { abilityFrameNeeds, castOptionNeeds, stepNeedsShallow } from "./support";
import { continueHooks, continuing, emit, label, rawPrintedAbilities, tryObj, type Run } from "./core";
import type { GameEvent, ObjId } from "./types";

export type UnresolvedEffect = "skipped" | "not_performed" | "ignored";

/** The `unresolved` event as emitted. `card` / `clause` / `capabilities` are what the host logs; see view.ts for what other players may see. */
export interface UnresolvedEvent extends GameEvent {
  type: "unresolved";
  /** the card (or token) whose text could not be resolved */
  card: string;
  /** the object it is, when there is one */
  source?: ObjId;
  /** the zone that object was in (hidden zones are redacted for other viewers) */
  zone?: string;
  /** the ability id and kind (spell_effect / triggered / static / replacement / activated / mana / keyword / cast_option / ...) */
  ability?: string;
  abilityKind: string;
  /** the ability / clause text from the card data */
  clause: string;
  /** the first missing capability, and all of them ("step:copy", "cost:unsupported", "trigger:nth", ...) */
  capability: string;
  capabilities: string[];
  /** what the engine did instead: skipped the step, did not perform the ability, or ignores the ability from now on */
  effect: UnresolvedEffect;
  /** a ready-to-print sentence for the game log */
  message: string;
  turn: number;
  phase: string;
  /** the player the card belongs to for this purpose (its controller, else the active player) */
  player: string;
}

const BLOCKABLE_KINDS = new Set(["spell_effect", "static", "replacement", "triggered"]);
const frameMemo = new WeakMap<Ability, string[]>();
const stepMemo = new WeakMap<Step, string[]>();

/** Memoized support.abilityFrameNeeds (card data objects are stable across runs). */
export function frameNeeds(a: Ability): string[] {
  let n = frameMemo.get(a);
  if (!n) { n = abilityFrameNeeds(a); frameMemo.set(a, n); }
  return n;
}
export function stepNeeds(s: Step): string[] {
  let n = stepMemo.get(s);
  if (!n) { n = stepNeedsShallow(s); stepMemo.set(s, n); }
  return n;
}

/** Continue mode leaves these out of every read of a card's abilities (triggers never fire, statics / replacements never apply, a spell has no effect). Activated / mana abilities stay visible: using one reports it. */
export function abilityBlocked(_r: Run, a: Ability): boolean {
  return (BLOCKABLE_KINDS.has(a.kind) || !!a.costReduction) && frameNeeds(a).length > 0;
}
export function optionBlocked(_r: Run, c: CastOption): boolean { return castOptionNeeds(c).length > 0; }
continueHooks.blocked = abilityBlocked;
continueHooks.optionBlocked = optionBlocked;
continueHooks.unusable = (a) => frameNeeds(a).length > 0;
continueHooks.continuous = (r, id) => reportContinuous(r, id);
continueHooks.stepNeeds = (s) => stepNeeds(s);
continueHooks.stepSkipped = (r, source, abilityId, step, needs) => {
  const so = tryObj(r, source);
  const a = so ? rawPrintedAbilities(r, so).find((x) => x.id === abilityId) : undefined;
  reportStepSkipped(r, source, a, step, needs);
};

const describe = (cap: string): string => cap.replace(/^(\w+):/, "$1 ").replace(/_/g, " ");
const shorten = (s: string, n = 140): string => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}...` : t; };
const EFFECT_TEXT: Record<UnresolvedEffect, string> = { skipped: "that part was skipped", not_performed: "it was not performed", ignored: "it is ignored" };

export interface UnresolvedInfo {
  /** the card / token object concerned */
  source?: ObjId;
  /** used when there is no object */
  card?: string;
  ability?: { id: string; kind: string; text: string };
  /** overrides the ability text (a step's kind, an event) */
  clause?: string;
  needs: string[];
  effect: UnresolvedEffect;
}

/** Emits one `unresolved` event, once per (card, ability, clause, capabilities, effect) in this run. Never throws. */
export function emitUnresolved(r: Run, info: UnresolvedInfo): void {
  const needs = info.needs.length ? [...new Set(info.needs)] : ["unknown"];
  const card = info.source ? label(r, info.source) : info.card ?? "(engine)";
  const clause = shorten(info.clause ?? info.ability?.text ?? "");
  const key = `${info.source ?? card}|${info.ability?.id ?? ""}|${clause}|${needs.join(",")}|${info.effect}`;
  const seen = (r.unresolvedRun ??= new Set());
  if (seen.has(key)) return;
  seen.add(key);
  const so = info.source ? tryObj(r, info.source) : undefined;
  const cap = needs[0];
  const message = `${card}: ${describe(cap)}${needs.length > 1 ? ` (+${needs.length - 1} more)` : ""} not supported${clause ? ` ("${clause}")` : ""}; ${EFFECT_TEXT[info.effect]}`;
  emit(r, {
    type: "unresolved", card, ...(info.source ? { source: info.source } : {}), ...(so ? { zone: so.zone } : {}), ...(info.ability ? { ability: info.ability.id } : {}),
    abilityKind: info.ability?.kind ?? "engine", clause, capability: cap, capabilities: needs, effect: info.effect, message,
    turn: r.s.turn.number, phase: r.s.turn.phase, player: so?.controller ?? r.s.turn.active
  });
}

/** Continuous things (statics, replacements, triggers, keywords): reported once per object, ever (state.unresolvedSeen), the first time they matter. */
export function reportOnce(r: Run, source: ObjId, a: Ability, needs: string[], effect: UnresolvedEffect = "ignored"): void {
  const key = `${source}|${a.id}|${needs.join(",")}`;
  const seen = (r.s.unresolvedSeen ??= {});
  if (seen[key]) return;
  seen[key] = 1;
  emitUnresolved(r, { source, ability: a, needs, effect });
}

/**
 * Called whenever the effects index is (re)built: every ability of a permanent (graveyard / command zone / stack object) in its working zone that is
 * not an activated / mana ability and whose frame is unsupported is reported once.
 */
export function reportContinuous(r: Run, id: ObjId): void {
  if (!continuing(r)) return;
  const o = tryObj(r, id);
  if (!o) return;
  for (const a of rawPrintedAbilities(r, o)) {
    if (a.kind === "activated" || a.kind === "mana" || a.kind === "spell_effect" || a.kind === "cast_option") continue;
    if ((a.zone ?? "battlefield") !== o.zone) continue;
    const needs = frameNeeds(a);
    if (needs.length) reportOnce(r, id, a, needs, "ignored");
  }
}

/** A spell is being cast: report what makes its spell ability / cast options / stack statics unusable (the steps are judged when it resolves). */
export function reportCast(r: Run, id: ObjId): void {
  const o = tryObj(r, id);
  if (!o) return;
  for (const a of rawPrintedAbilities(r, o)) {
    if (a.kind === "activated" || a.kind === "mana") continue;
    if (!(a.kind === "spell_effect" || a.kind === "cast_option" || a.zone === "stack")) continue;
    const needs = frameNeeds(a);
    if (needs.length) reportOnce(r, id, a, needs, a.kind === "spell_effect" ? "skipped" : "ignored");
  }
  if (o.token) return;
  const def = r.defs(o.cardName);
  for (const c of def?.kernel.castOptions ?? []) {
    const needs = castOptionNeeds(c);
    if (needs.length) reportOnce(r, id, { id: c.id, kind: "cast_option", text: `${c.kind}${c.cost?.length ? ` ${JSON.stringify(c.cost)}` : ""}` } as Ability, needs, "not_performed");
  }
}

/** An activated / mana ability whose frame (cost, targets, timing, zone, keyword, scripted marker) is unsupported: not performed. Returns true when it was reported. */
export function reportAbilityNotPerformed(r: Run, source: ObjId, a: Ability): boolean {
  const needs = frameNeeds(a);
  if (!needs.length) return false;
  emitUnresolved(r, { source, ability: a, needs, effect: "not_performed", clause: a.text });
  return true;
}

/** A step of a resolving ability the engine cannot run (judged before it runs) or that threw Unsupported while running: skipped. */
export function reportStepSkipped(r: Run, source: ObjId, a: Ability | undefined, step: Step, needs: string[]): void {
  const ab = a ? { id: a.id, kind: a.kind, text: a.text } : undefined;
  const clause = a?.text || `step ${String((step as { kind?: string }).kind)}`;
  emitUnresolved(r, { source, ability: ab, needs, effect: "skipped", clause });
}
