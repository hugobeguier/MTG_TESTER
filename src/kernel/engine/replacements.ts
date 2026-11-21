// Replacement effects: ONE event pipeline. Every game event that can be replaced (a permanent entering, tokens being
// created, a draw, life gain/loss, damage, a zone change / dying, a discard, counters being put on a permanent) is built as
// a plain event object and passed through `applyReplacements(r, event)` BEFORE it happens:
//   1. collect the applicable replacement effects (replacement abilities of permanents in play, plus the entering/moving
//      object's own), minus the ones already applied to this event (each effect applies at most once per event);
//   2. self-replacement effects first; if several others apply, the AFFECTED player chooses the order (a pending
//      decision, kind "order_replacements") - unless every order gives the identical result, then no question is asked;
//   3. apply the chosen effect (instead / also / modify / prevent) and repeat.
// The caller then performs whatever is left of the event (and `runAfter` runs "also" steps).
//
// Asking in the middle of an arbitrary choke point (moveObject, drawCards, dealDamage...) cannot use the resumable-step
// protocol, so the engine REPLAYS: `NeedAsk` aborts the whole `resolve` call, the pending decision stores the
// pre-action state, the action and the answers so far, and answering re-runs the action from that state with one more
// recorded answer (resolve.ts). The engine is deterministic (seeded RNG in the state), so the re-run reaches the
// same question; events emitted before the question are re-emitted by the final run, never twice.

import type { Ability, ObjectFilter, PlayerRef, Prompt, ReplacementSpec, Step } from "../schema";
import { chars, emit, label, NeedAsk, obj, printedAbilities, Reject, takeAnswer, tryObj, Unsupported, type Run } from "./core";
import { getIndex } from "./layers";
import { durables } from "./durable";
import { evalPredicate, evalQuantity, matchesFilter, resolvePlayers, type QCtx } from "./query";
import { changeLife, decide, runInline, standardCounterPT, tokenDefFromStep, type AskSpec } from "./steps";
import type { ObjId, PlayerId, TokenDef } from "./types";
import { isObjId } from "./types";
import type { Zone } from "../schema";

export interface TokenGroup { def: TokenDef; count: number; tapped?: boolean }
export interface After { key: string; steps: Step[]; src: ObjId; controller: PlayerId; eventObj?: string; eventPlayer?: PlayerId; amount?: number }
interface Common { cancelled?: boolean; after?: After[] }
export type ReplEvent = Common & (
  | { kind: "enter"; id: ObjId; from: Zone; controller: PlayerId; tapped: boolean; counters: Record<string, number>; x?: number }
  | { kind: "tokens"; player: PlayerId; groups: TokenGroup[] }
  | { kind: "draw"; player: PlayerId }
  | { kind: "gain_life" | "lose_life"; player: PlayerId; amount: number }
  | { kind: "damage"; source?: string; target: string; amount: number; combat: boolean }
  | { kind: "zone"; id: ObjId; from: Zone; to: Zone; position?: "top" | "bottom" }
  | { kind: "discard"; player: PlayerId; id: ObjId }
  | { kind: "counters"; id: ObjId; counter: string; amount: number }
);

interface Cand { key: string; src: ObjId; ability: Ability; spec: ReplacementSpec; controller: PlayerId; ts: number; self: boolean }

const EVENT_LABEL: Record<ReplEvent["kind"], string> = {
  enter: "permanent entering the battlefield", tokens: "token creation", draw: "card draw", gain_life: "life gain", lose_life: "life loss",
  damage: "damage", zone: "zone change", discard: "discard", counters: "counters being put on a permanent"
};

// ---------------------------------------------------------------- candidates

function specEvents(r: Run, ev: ReplEvent): ReplacementSpec["event"][] {
  switch (ev.kind) {
    case "enter": return ["would_enter"];
    case "tokens": return ["would_create_token"];
    case "draw": return ["would_draw"];
    case "gain_life": return ["would_gain_life"];
    case "lose_life": return ["would_lose_life"];
    case "damage": return ["would_deal_damage"];
    case "discard": return ["would_discard"];
    case "counters": return ["would_add_counters"];
    case "zone": return ev.from === "battlefield" && ev.to === "graveyard" && chars(r, ev.id).types.includes("creature") ? ["would_die", "would_be_put_into_zone"] : ["would_be_put_into_zone"];
  }
}

const q = (c: Cand, extra: Partial<QCtx> = {}): QCtx => ({ controller: c.controller, source: c.src, ...extra });

function playerMatches(r: Run, c: Cand, pid: PlayerId): boolean {
  const s = c.spec.subject;
  if (s === undefined) return c.controller === pid;
  if (typeof s === "string") return resolvePlayers(r, s as PlayerRef, q(c)).includes(pid);
  throw new Unsupported("replacement:subject_filter_on_player_event");
}

function objectSubject(r: Run, c: Cand, id: ObjId): boolean {
  const s = c.spec.subject;
  if (s === undefined || (s as string) === "self" || (s as string) === "you") return c.src === id; // "you" on an object event = the card itself ("you may have this enter as ...")
  if (typeof s === "string") throw new Unsupported(`replacement:subject:${s}`);
  return matchesFilter(r, id, s as ObjectFilter, q(c));
}

/** Token filters are judged on the token's OWN definition (never on statics like Mycosynth Lattice). */
const TOKEN_FILTER_KEYS = new Set(["types", "notTypes", "subtypes", "notSubtypes", "colors", "notColors", "controller", "token", "anyOf", "colored"]);
function tokenMatches(f: ObjectFilter, def: TokenDef, owner: PlayerId, c: Cand): boolean {
  for (const k of Object.keys(f)) if (!TOKEN_FILTER_KEYS.has(k)) throw new Unsupported(`filter:${k}@token_replacement`);
  if (f.anyOf && !f.anyOf.some((sub) => tokenMatches(sub, def, owner, c))) return false;
  const types = def.types.map((t) => t.toLowerCase()), subs = def.subtypes.map((t) => t.toLowerCase());
  if (f.types) for (const t of f.types.map((x) => x.toLowerCase())) { if (t === "token" || t === "permanent" || t === "card") continue; if (!types.includes(t)) return false; }
  if (f.notTypes && f.notTypes.some((t) => types.includes(t.toLowerCase()))) return false;
  if (f.subtypes && !f.subtypes.every((t) => subs.includes(t.toLowerCase()))) return false;
  if (f.notSubtypes && f.notSubtypes.some((t) => subs.includes(t.toLowerCase()))) return false;
  const colorName: Record<string, string> = { W: "white", U: "blue", B: "black", R: "red", G: "green" };
  const has = (x: string) => def.colors.some((k) => (colorName[k] ?? k).toLowerCase() === x.toLowerCase());
  if (f.colors && !f.colors.every(has)) return false;
  if (f.notColors && f.notColors.some(has)) return false;
  if (f.colored !== undefined && (def.colors.length > 0) !== f.colored) return false;
  if (f.token === false) return false;
  if (f.controller === "you" && owner !== c.controller) return false;
  if (f.controller === "opponent" && owner === c.controller) return false;
  return true;
}

function damageRecipientMatches(r: Run, c: Cand, ev: Extract<ReplEvent, { kind: "damage" }>): boolean {
  const rec = c.spec.recipient;
  if (rec === undefined) return true;
  if (rec === "self") return ev.target === c.src;
  if (typeof rec === "string") {
    if (isObjId(ev.target)) return false; // PlayerRef recipients name players
    return resolvePlayers(r, rec as PlayerRef, q(c)).includes(ev.target);
  }
  const f = rec as ObjectFilter;
  if (isObjId(ev.target)) return matchesFilter(r, ev.target, f, q(c));
  // a player: only the controller-style keys can apply
  for (const k of Object.keys(f)) if (k !== "controller" && k !== "owner") throw new Unsupported(`filter:${k}@damage_recipient`);
  const who = f.controller ?? f.owner;
  return who === undefined || (who === "you" ? ev.target === c.controller : ev.target !== c.controller);
}

function applies(r: Run, c: Cand, ev: ReplEvent): boolean {
  const spec = c.spec;
  if (spec.duration) throw new Unsupported(`replacement:${spec.event}.duration`);
  if (spec.condition && !evalPredicate(r, spec.condition, q(c))) return false;
  switch (ev.kind) {
    case "enter": return objectSubject(r, c, ev.id);
    case "tokens": {
      const s = spec.subject;
      if (s === undefined || typeof s === "string") return ev.groups.length > 0 && playerMatches(r, c, ev.player);
      return ev.groups.some((g) => tokenMatches(s as ObjectFilter, g.def, ev.player, c));
    }
    case "draw": case "gain_life": case "lose_life": case "discard": return playerMatches(r, c, ev.player);
    case "damage": {
      if (spec.damageType && (spec.damageType === "combat") !== ev.combat) return false;
      if (spec.damageSource) {
        if (!ev.source || !isObjId(ev.source) || !matchesFilter(r, ev.source, spec.damageSource, q(c))) return false;
      }
      return damageRecipientMatches(r, c, ev);
    }
    case "counters": return objectSubject(r, c, ev.id);
    case "zone": {
      if (spec.fromZone && spec.fromZone !== ev.from) return false;
      if (spec.toZone && spec.toZone !== ev.to) return false;
      return objectSubject(r, c, ev.id);
    }
  }
}

function eventObjectId(ev: ReplEvent): ObjId | undefined {
  return "id" in ev ? ev.id : undefined;
}

function candidates(r: Run, ev: ReplEvent, done: Set<string>): Cand[] {
  const names = specEvents(r, ev);
  const out: Cand[] = [];
  const consider = (src: ObjId, ability: Ability, controller: PlayerId, ts: number) => {
    const spec = ability.replacement;
    if (!spec || !names.includes(spec.event)) return;
    const key = `${src}:${ability.id}`;
    if (done.has(key)) return;
    const c: Cand = { key, src, ability, spec, controller, ts, self: src === eventObjectId(ev) };
    if (applies(r, c, ev)) out.push(c);
  };
  for (const s of getIndex(r).repls) consider(s.id, s.ability, s.controller, s.ts);
  // shields granted to players for a while (grant_effect with a replacement): the durable effect IS the ability
  for (const d of durables(r)) if (d.replacement) consider(d.source, { id: `d:${d.id}`, kind: "replacement", text: "", replacement: d.replacement } as Ability, d.owner, d.timestamp);
  const id = eventObjectId(ev);
  const o = id ? tryObj(r, id) : undefined;
  if (o && o.zone !== "battlefield" && (ev.kind === "enter" || ev.kind === "zone")) {
    for (const a of printedAbilities(r, o)) if (a.kind === "replacement") consider(o.id, a, ev.kind === "enter" ? ev.controller : o.controller, o.timestamp);
  }
  return out.sort((a, b) => Number(b.self) - Number(a.self) || a.ts - b.ts || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------- applying one effect

/** A rewrite of the event that needs no steps (modify / prevent / token and counter additions). */
const isRewrite = (c: Cand): boolean => {
  const m = c.spec.result.mode;
  if (m === "modify" || m === "prevent") return true;
  const steps = (c.spec.result as { steps: Step[] }).steps;
  if (c.spec.event === "would_create_token") return steps.every((s) => s.kind === "create_tokens");
  if (c.spec.event === "would_enter") return m === "also" && steps.every((s) => s.kind === "add_counters");
  return false;
};

/** Pure = a rewrite with no question to the player: order-insensitivity can be judged without asking. */
const isPure = (c: Cand): boolean => !c.spec.optional && !hasUnlessPay(c) && isRewrite(c);

function num(cur: number, v: unknown, what: string): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    const o = v as { multiply?: number; add?: number };
    if (typeof o.multiply === "number") return cur * o.multiply;
    if (typeof o.add === "number") return cur + o.add;
  }
  throw new Unsupported(`replacement:modify.${what}`);
}

function modifyEvent(ev: ReplEvent, set: Record<string, unknown>): ReplEvent {
  const e = structuredClone(ev) as ReplEvent;
  for (const [k, v] of Object.entries(set)) {
    if (e.kind === "enter" && k === "tapped") e.tapped = !!v;
    else if (e.kind === "enter" && k === "counters" && v && typeof v === "object") for (const [ck, n] of Object.entries(v as Record<string, number>)) e.counters[ck] = (e.counters[ck] ?? 0) + n;
    else if (e.kind === "tokens" && k === "count") for (const g of e.groups) g.count = Math.max(0, num(g.count, v, k));
    else if (e.kind === "tokens" && k === "tapped") for (const g of e.groups) g.tapped = !!v;
    else if ((e.kind === "gain_life" || e.kind === "lose_life" || e.kind === "damage" || e.kind === "counters") && k === "amount") e.amount = Math.max(0, num(e.amount, v, k));
    else if (e.kind === "damage" && k === "damageMultiplier" && typeof v === "number") e.amount *= v;
    else if (e.kind === "zone" && k === "to" && typeof v === "string") e.to = v as Zone;
    else throw new Unsupported(`replacement:modify.${k}`);
  }
  return e;
}

function stepGroups(r: Run, c: Cand, steps: Step[], amount: number, tapped: boolean | undefined): TokenGroup[] {
  const out: TokenGroup[] = [];
  for (const s of steps) {
    if (s.kind !== "create_tokens") throw new Unsupported(`replacement:would_create_token.step:${s.kind}`);
    if (s.who !== undefined && s.who !== "you") throw new Unsupported("replacement:would_create_token.who");
    const env = q(c, { amount });
    const count = s.tokenCount === undefined ? 1 : evalQuantity(r, s.tokenCount as never, env);
    if (count > 0) out.push({ def: tokenDefFromStep(r, env, s), count, tapped: tapped || !!s.tokenTapped });
  }
  return out;
}

function applyPure(r: Run, ev: ReplEvent, c: Cand): ReplEvent {
  const res = c.spec.result;
  if (res.mode === "prevent") return { ...structuredClone(ev), cancelled: true } as ReplEvent;
  if (res.mode === "modify") return modifyEvent(ev, res.set);
  const e = structuredClone(ev) as ReplEvent;
  if (e.kind === "tokens") {
    if (res.mode === "also") {
      const total = e.groups.reduce((a, g) => a + g.count, 0);
      e.groups.push(...stepGroups(r, c, res.steps, total, false));
    } else {
      const s = c.spec.subject;
      const hit = (g: TokenGroup) => s === undefined || typeof s === "string" || tokenMatches(s as ObjectFilter, g.def, e.player, c);
      const next: TokenGroup[] = [];
      for (const g of e.groups) { if (hit(g)) next.push(...stepGroups(r, c, res.steps, g.count, g.tapped)); else next.push(g); }
      e.groups = next;
    }
    return e;
  }
  if (e.kind === "enter" && res.mode === "also") {
    for (const st of res.steps) {
      if (st.kind !== "add_counters" || (st.on !== "self" && st.on !== "event_object" && st.on !== undefined)) throw new Unsupported(`replacement:would_enter.also:${st.kind}`);
      standardCounterPT(st);
      const n = st.amount === undefined ? 1 : evalQuantity(r, st.amount as never, q(c, { x: e.x ?? 0 }));
      const kind = String(st.counterKind);
      if (n > 0) e.counters[kind] = (e.counters[kind] ?? 0) + n;
    }
    return e;
  }
  throw new Unsupported(`replacement:${c.spec.event}.${res.mode}`);
}

function envOf(ev: ReplEvent): { eventObj?: string; eventPlayer?: PlayerId; amount?: number } {
  const o: { eventObj?: string; eventPlayer?: PlayerId; amount?: number } = {};
  if ("id" in ev) o.eventObj = ev.id;
  if ("player" in ev) o.eventPlayer = ev.player;
  if ("amount" in ev) o.amount = ev.amount;
  if (ev.kind === "damage" && isObjId(ev.target)) o.eventObj = ev.target;
  if (ev.kind === "tokens") o.amount = ev.groups.reduce((a, g) => a + g.count, 0);
  return o;
}

function runSteps(r: Run, a: After): void {
  (r.activeRepl ??= []).push(a.key);
  try { runInline(r, { source: a.src, controller: a.controller, steps: a.steps, eventObj: a.eventObj, eventPlayer: a.eventPlayer, amount: a.amount }); }
  finally { r.activeRepl!.pop(); }
}

function applyEffect(r: Run, ev: ReplEvent, c: Cand): ReplEvent {
  if (hasUnlessPay(c)) return applyUnlessPay(r, ev, c);
  if (isRewrite(c)) return applyPure(r, ev, c);
  const res = c.spec.result;
  if (res.mode === "instead" || res.mode === "also") {
    if (ev.kind === "enter") return applyEnterSteps(r, ev, c, res);
    const a: After = { key: c.key, steps: res.steps, src: c.src, controller: c.controller, ...envOf(ev) };
    if (res.mode === "instead") { runSteps(r, a); return { ...ev, cancelled: true } as ReplEvent; }
    return { ...ev, after: [...(ev.after ?? []), a] } as ReplEvent;
  }
  throw new Unsupported(`replacement:${c.spec.event}.${res.mode}`);
}

/**
 * "As this enters, ..." effects with real steps (shock land: pay 2 life or enters tapped; Thriving land: choose a color).
 * The steps run NOW, before the permanent moves: tapping it or putting counters on it changes the pending event (r.entering),
 * and they may ask the player (the question replays the action, see core.NeedAsk).
 */
function applyEnterSteps(r: Run, ev: Extract<ReplEvent, { kind: "enter" }>, c: Cand, res: { mode: string; steps?: Step[] }): ReplEvent {
  // "enters as a copy of ..." (Estrid's Invocation) is an `instead` whose steps only make the entering object a copy: it still enters
  if (res.mode !== "also" && !(res.mode === "instead" && (res.steps ?? []).every((s) => s.kind === "copy" && s.asEnters))) throw new Unsupported(`replacement:would_enter.${res.mode}`);
  const e = structuredClone(ev);
  const keep = r.entering;
  r.entering = { id: e.id, tapped: e.tapped, counters: e.counters };
  (r.activeRepl ??= []).push(c.key);
  try { runInline(r, { source: c.src, controller: c.controller, steps: res.steps ?? [], eventObj: e.id, x: e.x }); }
  finally { r.activeRepl!.pop(); e.tapped = r.entering.tapped; r.entering = keep; }
  return e;
}

/** Runs the "also" steps queued by applied replacement effects (after the event itself happened). */
export function runAfter(r: Run, ev: ReplEvent): void {
  const list = ev.after;
  if (!list?.length) return;
  ev.after = undefined;
  for (const a of list) runSteps(r, a);
}

// ---------------------------------------------------------------- optional effects and "unless you pay"

function yesNo(r: Run, player: PlayerId, prompt: Prompt): boolean {
  const spec: AskSpec = { kind: "choose_yes_no", player, prompt, options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }], min: 1, max: 1 };
  const a = takeAnswer(r);
  if (a === undefined) throw new NeedAsk(spec);
  const d = decide(spec, a); // a bad answer is rejected here (the action is not applied)
  if ("ask" in d) throw new NeedAsk(spec);
  return !!d.yes;
}

/** "You may" replacement effects: the affected player says whether this one applies (deterministic replay: the answer is recorded like an ordering answer). */
function wantsToApply(r: Run, ev: ReplEvent, c: Cand): boolean {
  const prompt = c.spec.prompt ?? c.ability.prompt ?? { title: `${label(r, c.src)}: optional`, instruction: "Do you want to apply this replacement effect?" };
  return yesNo(r, affectedPlayer(r, ev), prompt);
}

const hasUnlessPay = (c: Cand): boolean => c.spec.result.mode === "modify" && (c.spec.result.set as Record<string, unknown>).unlessPay !== undefined;

/** "As this enters, you may pay N life. If you don't, it enters tapped": a modify with set.unlessPay {life}. A player who cannot pay is not asked. */
function applyUnlessPay(r: Run, ev: ReplEvent, c: Cand): ReplEvent {
  const res = c.spec.result as { set: Record<string, unknown> };
  const { unlessPay, ...rest } = res.set;
  const life = (unlessPay as { life?: number }).life;
  if (typeof life !== "number" || Object.keys(unlessPay as object).some((k) => k !== "life")) throw new Unsupported(`replacement:${c.spec.event}.modify.unlessPay`);
  const who = affectedPlayer(r, ev);
  const p = r.s.players.find((x) => x.id === who)!;
  if (p.life >= life && yesNo(r, who, { title: `${label(r, c.src)}: pay ${life} life?`, instruction: `You may pay ${life} life. If you don't, the replacement applies.` })) {
    changeLife(r, undefined, who, -life); // paid as it enters: the event is unchanged
    return ev;
  }
  return modifyEvent(ev, rest);
}

// ---------------------------------------------------------------- choosing the order

/** Every final result reachable by ordering the (pure) effects; null when some effect has side effects or there are too many. */
function outcomes(r: Run, ev: ReplEvent, done: Set<string>, depth = 0): Set<string> | null {
  if (ev.cancelled) return new Set([JSON.stringify({ cancelled: true })]);
  const cands = candidates(r, ev, done);
  if (!cands.length) return new Set([JSON.stringify(ev)]);
  if (cands.length > 5 || depth > 8 || cands.some((c) => !isPure(c))) return null;
  const all = new Set<string>();
  for (const c of cands) {
    const next = outcomes(r, applyPure(r, ev, c), new Set([...done, c.key]), depth + 1);
    if (!next) return null;
    for (const s of next) all.add(s);
  }
  return all;
}

function affectedPlayer(r: Run, ev: ReplEvent): PlayerId {
  switch (ev.kind) {
    case "enter": return ev.controller;
    case "tokens": case "draw": case "gain_life": case "lose_life": case "discard": return ev.player;
    case "damage": return isObjId(ev.target) ? (tryObj(r, ev.target)?.controller ?? r.s.turn.active) : ev.target;
    case "zone": return obj(r, ev.id).owner;
    case "counters": return obj(r, ev.id).controller;
  }
}

function choose(r: Run, ev: ReplEvent, cands: Cand[], done: Set<string>): Cand {
  if (cands[0].self) return cands[0]; // 616.1a: self-replacement effects first
  if (cands.length === 1) return cands[0];
  const out = outcomes(r, ev, done);
  if (out && out.size === 1) return cands[0]; // every order gives the same result: nothing to decide
  const spec: AskSpec = {
    kind: "order_replacements", player: affectedPlayer(r, ev),
    prompt: orderPrompt(ev),
    options: cands.map((c) => ({ id: c.key, label: `${label(r, c.src)}: ${(c.spec.prompt?.title ?? c.ability.text).replace(/\s+/g, " ").slice(0, 140)}` })),
    min: 1, max: 1
  };
  const given = takeAnswer(r)?.ids?.[0];
  if (given === undefined) throw new NeedAsk(spec);
  const pick = cands.find((c) => c.key === given);
  if (!pick) throw new Reject("invalid_choice", `"${given}" is not one of the replacement effects that apply`);
  return pick;
}

function orderPrompt(ev: ReplEvent): Prompt {
  return { title: "Choose the order of replacement effects", instruction: `More than one replacement effect would change this ${EVENT_LABEL[ev.kind]}. Choose the one to apply first (the others apply afterwards if they still can).` };
}

// ---------------------------------------------------------------- entry point

/** Runs the event through every applicable replacement effect. Returns the (possibly changed or cancelled) event. */
export function applyReplacements(r: Run, ev: ReplEvent): ReplEvent {
  const idx = getIndex(r);
  const id = eventObjectId(ev);
  const o = id ? tryObj(r, id) : undefined;
  const own = !!o && o.zone !== "battlefield" && (ev.kind === "enter" || ev.kind === "zone") && printedAbilities(r, o).some((a) => a.kind === "replacement");
  if (!idx.repls.length && !own && !durables(r).some((d) => d.replacement)) return ev;
  const done = new Set<string>(r.activeRepl ?? []);
  let cur: ReplEvent = ev;
  for (let guard = 0; guard < 64; guard++) {
    if (cur.cancelled) break;
    const cands = candidates(r, cur, done);
    if (!cands.length) break;
    const pick = choose(r, cur, cands, done);
    done.add(pick.key);
    if (pick.spec.optional && !hasUnlessPay(pick) && !wantsToApply(r, cur, pick)) continue; // declined: this effect does not apply (and may not be offered again for this event)
    cur = applyEffect(r, cur, pick);
    emit(r, { type: "replacement_applied", source: pick.src, ability: pick.ability.id, event: cur.kind });
  }
  return cur;
}
