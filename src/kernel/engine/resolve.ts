// resolve(state, action, ctx) -> { state, events, pending?, error? }: the engine entry point.
// Pure and deterministic: the input state is cloned, never mutated; on any error the ORIGINAL state is returned.

import type { Ability, ObjectFilter, Prompt, TargetSpec } from "../schema";
import { promptForModes, promptForTarget, promptForX } from "../prompts";
import {
  abilitiesOf, alive, apnap, chars, defOf, drawCards, emit, label, LoopDetected, makeLki, moveObject, nextPlayer, obj, opponentsOf,
  parseManaCost, player, Reject, tick, tryObj, Unsupported, isSummoningSick, type Run
} from "./core";
import { autoTapFor, addMana, manaAbilityUsable, payFromPool, productionOf, totalPotentialMana } from "./mana";
import { evalPredicate, matchesFilter, objectsMatching, resolveObjs, type QCtx } from "./query";
import { decide, runExec, startExec, type AskSpec } from "./steps";
import { abilityUnsupported, cardUnsupported, SUPPORTED_TRIGGER_EVENTS } from "./support";
import type {
  Action, CastInfo, Choice, Draft, EngineContext, Exec, GameEvent, GameObject, GameState, Lki, ObjId, Part, Pending, PendingView, PlayerId,
  QueuedTrigger, ResolveResult, StackItem, TriggerContext
} from "./types";
import { isObjId } from "./types";
import type { Phase } from "../schema";

const STEP_ORDER: Phase[] = ["untap", "upkeep", "draw", "precombat_main", "beginning_of_combat", "combat", "end_of_combat", "postcombat_main", "end_step", "cleanup"];
const MAIN: Phase[] = ["precombat_main", "postcombat_main"];

export function viewOf(p: Pending | null): PendingView | undefined {
  if (!p) return undefined;
  const { ctx: _ctx, ...view } = p;
  return view;
}

export function resolve(state: GameState, action: Action, ctx: EngineContext): ResolveResult {
  const r: Run = { s: structuredClone(state), events: [], defs: ctx.cards, scanned: 0 };
  try {
    dispatch(r, action);
    return { state: r.s, events: r.events, pending: viewOf(r.s.pending) };
  } catch (e) {
    if (e instanceof Reject) return { state, events: [], error: e.toError() };
    if (e instanceof Unsupported) return { state, events: [], error: { code: "unsupported", message: e.message, capability: e.all } };
    if (e instanceof LoopDetected) {
      const s = structuredClone(state);
      s.pending = null; s.priority = null;
      s.gameOver = { draw: true, reason: "loop detected: a mandatory loop never ends, the game is a draw (rule 722)" };
      return { state: s, events: [{ type: "loop_detected", seq: 0, message: e.message }], error: { code: "loop_detected", message: e.message } };
    }
    throw e;
  }
}

function dispatch(r: Run, a: Action): void {
  if (r.s.gameOver) throw new Reject("game_over", "the game is over");
  const p = r.s.players.find((x) => x.id === a.player);
  if (!p) throw new Reject("unknown_object", `unknown player ${a.player}`);
  if (p.hasLost) throw new Reject("game_over", `${a.player} has lost the game`);
  if (a.type === "answerDecision") return answer(r, a);
  if (r.s.pending) throw new Reject("decision_pending", `decision ${r.s.pending.id} for ${r.s.pending.player} must be answered first`);
  if (r.s.priority !== a.player) throw new Reject("not_your_priority", `${a.player} does not have priority (${r.s.priority ?? "nobody"} does)`);
  switch (a.type) {
    case "castSpell": return castSpell(r, a);
    case "activateAbility": return activateAbility(r, a);
    case "playLand": return playLand(r, a);
    case "passPriority": return passPriority(r, a.player, !!a.fastForward);
    case "advancePhase": return advancePhase(r, a.player);
  }
}

// ================================================================ pending helpers

function setPending(r: Run, spec: AskSpec, ctx: Pending["ctx"], cancellable = false): void {
  r.s.priority = null;
  r.s.pending = { ...spec, id: `d${++r.s.decisionSeq}`, ctx, cancellable };
}

// ================================================================ targeting

function targetCtx(draft: Draft): QCtx { return { controller: draft.player, source: draft.sourceId, x: draft.x, cast: draft.cast }; }

function untargetable(r: Run, id: ObjId, by: PlayerId): boolean {
  const c = chars(r, id);
  return c.keywords.includes("shroud") || (c.keywords.includes("hexproof") && obj(r, id).controller !== by);
}

export function targetCandidates(r: Run, spec: TargetSpec, q: QCtx, selfSpell?: ObjId): string[] {
  const out: string[] = [];
  const f: ObjectFilter = spec.filter ?? {};
  if (spec.what === "player" || spec.what === "any") for (const p of alive(r)) out.push(p.id);
  if (spec.what === "object" || spec.what === "any") {
    const zone = f.zone ?? ((f.types ?? []).includes("spell") ? "stack" : "battlefield");
    let ids = objectsMatching(r, { ...f, zone }, q);
    if (spec.what === "any") ids = ids.filter((id) => ["creature", "planeswalker"].some((t) => chars(r, id).types.includes(t)));
    out.unshift(...ids.filter((id) => id !== selfSpell && (zone !== "battlefield" || !untargetable(r, id, q.controller))));
  }
  return out;
}

function chosenAnswerSpec(r: Run, name: string, spec: TargetSpec, cands: string[], player: PlayerId): AskSpec {
  return {
    kind: "choose_targets", player, prompt: spec.prompt ?? promptForTarget(name, spec),
    options: cands.map((id) => ({ id, label: label(r, id) })), min: spec.count.min, max: Math.min(spec.count.max, cands.length)
  };
}

function featuresOk(r: Run, specs: TargetSpec[], draft: Draft): boolean {
  return specs.every((s) => s.count.min === 0 || targetCandidates(r, s, targetCtx(draft), draft.objectId).length >= s.count.min);
}

// ================================================================ draft (cast / activate / trigger placement)

function abilityOfDraft(r: Run, d: Draft): Ability | undefined {
  const src = tryObj(r, d.sourceId);
  if (!src) return undefined;
  return abilitiesOf(r, src).find((a) => a.id === d.abilityId);
}

function cardName(r: Run, d: Draft): string { return label(r, d.sourceId); }

function costX(r: Run, d: Draft, a: Ability | undefined): boolean {
  if (d.kind === "spell") { const def = defOf(r, obj(r, d.sourceId))!; return parseManaCost(def.manaCost).x > 0; }
  return (a?.costs ?? []).some((c) => "mana" in c && /\{X\}/.test(c.mana));
}

/** Runs the choice stages in order. Returns the ask spec when a decision is needed, else commits the item. */
function advanceDraft(r: Run, d: Draft, answerIn?: Choice): { ask: AskSpec; stage: "modes" | "targets" | "x" | "color" } | "committed" {
  let answerLeft = answerIn;
  const a = abilityOfDraft(r, d);
  const name = cardName(r, d);

  // ---- modes
  if (a?.modes && !d.modeIds) {
    const m = a.modes;
    const feasible = m.options.filter((o) => featuresOk(r, o.targets ?? [], d));
    const repeatable = m.repeatable === true || m.distinct === false;
    if (feasible.length < m.choose.min && !(repeatable && feasible.length > 0)) throw new Reject("illegal_target", "no legal combination of modes (not enough legal targets)");
    const spec: AskSpec = {
      kind: "choose_modes", player: d.player, prompt: m.prompt ?? promptForModes(name, m),
      options: feasible.map((o) => ({ id: o.id, label: o.text })), min: m.choose.min, max: repeatable ? m.choose.max : Math.min(m.choose.max, feasible.length), repeatable
    };
    const dec = decide(spec, answerLeft);
    if ("ask" in dec) return { ask: dec.ask, stage: "modes" };
    answerLeft = undefined;
    d.modeIds = dec.ids;
  }
  if (!d.parts) {
    d.parts = a?.modes
      ? d.modeIds!.map((id) => { const o = a.modes!.options.find((x) => x.id === id)!; return { modeId: id, specs: o.targets ?? [], steps: o.steps, targets: {} } as Part; })
      : [{ specs: a?.targets ?? [], steps: a?.steps ?? [], targets: {} }];
  }

  // ---- targets
  for (const part of d.parts) {
    for (const spec of part.specs) {
      if (spec.id in part.targets) continue;
      const cands = targetCandidates(r, spec, targetCtx(d), d.objectId);
      if (spec.count.min > 0 && cands.length < spec.count.min) throw new Reject("illegal_target", `no legal targets for ${spec.id}`);
      if (cands.length === 0) { part.targets[spec.id] = []; continue; }
      const ask = chosenAnswerSpec(r, name, spec, cands, d.player);
      const dec = decide(ask, answerLeft);
      if ("ask" in dec) return { ask: dec.ask, stage: "targets" };
      answerLeft = undefined;
      part.targets[spec.id] = dec.ids;
    }
  }

  // ---- X
  if (!d.xChosen && costX(r, d, a)) {
    const base = d.kind === "spell" ? parseManaCost(defOf(r, obj(r, d.sourceId))!.manaCost) : parseManaCost((a!.costs ?? []).filter((c) => "mana" in c).map((c) => (c as { mana: string }).mana).join(""));
    const fixed = base.mv;
    const max = Math.max(0, Math.floor((totalPotentialMana(r, d.player) - fixed) / Math.max(1, base.x)));
    const spec: AskSpec = { kind: "choose_x", player: d.player, prompt: a?.xPrompt ?? promptForX(name), options: [], min: 0, max, numeric: true };
    const dec = decide(spec, answerLeft);
    if ("ask" in dec) return { ask: dec.ask, stage: "x" };
    answerLeft = undefined;
    d.x = dec.number; d.xChosen = true;
  }

  commitDraft(r, d, a);
  return "committed";
}

function payMana(r: Run, pid: PlayerId, cost: ReturnType<typeof parseManaCost>, x: number, d: Draft, exclude: ObjId[] = []): void {
  if (payFromPool(r, pid, cost, x)) return;
  const allowTap = d.payWith !== undefined || d.autoPay !== false;
  if (!(allowTap && autoTapFor(r, pid, cost, x, d.payWith, exclude) && payFromPool(r, pid, cost, x))) throw new Reject("cannot_pay", "cannot pay the mana cost with the available mana");
}

function payAbilityCosts(r: Run, d: Draft, a: Ability): void {
  const src = obj(r, d.sourceId);
  for (const c of a.costs ?? []) {
    if ("unsupported" in c) throw new Unsupported("cost:unsupported");
    if ("mana" in c) payMana(r, d.player, parseManaCost(c.mana), d.x ?? 0, d, (a.costs ?? []).some((k) => "tap" in k || "sacrifice" in k) ? [d.sourceId] : []);
    else if ("tap" in c) {
      if (src.zone !== "battlefield" || src.tapped) throw new Reject("cannot_pay", `${label(r, src.id)} is already tapped`);
      if (isSummoningSick(r, src)) throw new Reject("cannot_pay", `${label(r, src.id)} is summoning sick`);
      src.tapped = true; emit(r, { type: "tap", id: src.id, player: d.player });
    } else if ("sacrifice" in c) {
      if (src.zone !== "battlefield") throw new Reject("cannot_pay", "the source is no longer on the battlefield");
      r.s.turnLog.push({ type: "sacrifice", id: src.id, player: d.player, ts: r.s.clock });
      emit(r, { type: "sacrificed", id: src.id, player: d.player });
      moveObject(r, src.id, "graveyard");
    } else if ("life" in c) {
      const n = typeof c.life === "number" ? c.life : 0;
      if (player(r, d.player).life < n) throw new Reject("cannot_pay", "not enough life");
      player(r, d.player).life -= n; emit(r, { type: "life_loss", player: d.player, amount: n });
    } else if ("counters" in c) {
      const n = typeof c.counters.count === "number" ? c.counters.count : 0;
      const cur = src.counters[c.counters.kind] ?? 0;
      if (c.counters.remove && cur < n) throw new Reject("cannot_pay", `not enough ${c.counters.kind} counters`);
      src.counters[c.counters.kind] = cur + (c.counters.remove ? -n : n);
      if (src.counters[c.counters.kind] === 0) delete src.counters[c.counters.kind];
      emit(r, { type: c.counters.remove ? "counter_removed" : "counter_added", id: src.id, kind: c.counters.kind, amount: n });
    } else throw new Unsupported(`cost:${Object.keys(c)[0]}`);
  }
}

function commitDraft(r: Run, d: Draft, a: Ability | undefined): void {
  const pid = d.player;
  const src = obj(r, d.sourceId);
  let spellCard: GameObject | undefined;

  if (d.kind === "spell") {
    spellCard = src;
    const def = defOf(r, src)!;
    const tax = d.origin?.zone === "command" ? 2 * (player(r, pid).commanderCasts[src.id] ?? 0) : 0;
    const cost = parseManaCost(def.manaCost);
    cost.generic += tax; cost.mv += tax;
    payMana(r, pid, cost, d.x ?? 0, d);
    if (d.origin?.zone === "command") player(r, pid).commanderCasts[src.id] = (player(r, pid).commanderCasts[src.id] ?? 0) + 1;
  } else if (d.kind === "activated" && a) {
    payAbilityCosts(r, d, a);
  }

  const key = `${d.sourceId}:${d.abilityId}`;
  if (d.kind === "activated" && a?.timing?.limit) {
    const lim = a.timing.limit;
    const k = (lim.per === "game" ? "g:" : "t:") + key;
    if ((r.s.activations[k] ?? 0) >= lim.count) throw new Reject("cannot_activate", `${label(r, d.sourceId)} can only be activated ${lim.count} time(s) per ${lim.per}`);
    r.s.activations[k] = (r.s.activations[k] ?? 0) + 1;
  }

  const item: StackItem = {
    id: `s${r.s.nextId++}`, kind: d.kind, sourceId: d.sourceId, objectId: d.objectId, controller: pid, abilityId: d.abilityId,
    parts: d.parts ?? [], x: d.x ?? 0, cast: d.cast, trigger: d.trigger
  };
  r.s.stack.push(item);
  r.s.passes = [];
  if (d.kind === "triggered") {
    r.s.triggerQueue = r.s.triggerQueue.filter((t) => t.id !== d.triggerId);
    emit(r, { type: "trigger_on_stack", source: d.sourceId, ability: d.abilityId, controller: pid });
  } else if (d.kind === "spell") {
    const c = chars(r, src.id);
    emit(r, { type: "cast", id: src.id, player: pid, name: c.name, from: d.cast?.from, targets: item.parts.map((p) => p.targets) });
    r.s.turnLog.push({ type: "cast", player: pid, id: src.id, name: c.name, types: c.types, ts: r.s.clock });
    r.s.priorityAfter = pid;
  } else {
    emit(r, { type: "ability_activated", source: d.sourceId, ability: d.abilityId, player: pid });
    r.s.priorityAfter = pid;
  }
  void spellCard;
}

function startDraft(r: Run, d: Draft, cancellable: boolean, answerIn?: Choice): void {
  const res = advanceDraft(r, d, answerIn);
  if (res === "committed") { finish(r); return; }
  setPending(r, res.ask, { t: "draft", draft: d, stage: res.stage }, cancellable);
}

// ================================================================ actions

function inMainWithEmptyStack(r: Run, pid: PlayerId): boolean {
  return r.s.turn.active === pid && MAIN.includes(r.s.turn.phase) && r.s.stack.length === 0;
}

function assertSupported(r: Run, o: GameObject, only?: Ability): void {
  const def = defOf(r, o)!;
  const sup = cardUnsupported(def);
  if (only) {
    const mine = abilityUnsupported(only);
    if (mine.length) throw new Unsupported(mine[0], `${def.name}: unsupported capability ${mine.join(", ")}`, mine);
    return;
  }
  if (sup.ok) return;
  if (r.s.config.lenient) {
    for (const x of sup.abilities) if (x.needs.length) emit(r, { type: "unsupported_ignored", card: def.name, ability: x.id, needs: x.needs });
    return;
  }
  throw new Unsupported(sup.all[0], `${def.name}: unsupported capability ${sup.all.join(", ")}`, sup.all);
}

function castSpell(r: Run, a: Extract<Action, { type: "castSpell" }>): void {
  const o = r.s.objects[a.cardId];
  if (!o) throw new Reject("unknown_object", `unknown card ${a.cardId}`);
  if (o.owner !== a.player) throw new Reject("not_owner", `${a.player} does not own ${label(r, o.id)}`);
  const p = player(r, a.player);
  const from = o.zone;
  const zoneOk = (from === "hand" && p.hand.includes(o.id)) || (from === "command" && p.command.includes(o.id) && !!o.isCommander);
  if (!zoneOk) throw new Reject("not_in_zone", `${label(r, o.id)} is not in ${a.player}'s hand (it is in ${o.zone})`);
  const def = defOf(r, o)!;
  const c = chars(r, o.id);
  if (c.types.includes("land")) throw new Reject("not_castable", "lands are played, not cast");
  const spellAbility = def.kernel.abilities.find((x) => x.kind === "spell_effect");
  assertSupported(r, o);
  const instantSpeed = c.types.includes("instant") || c.keywords.includes("flash") || spellAbility?.timing?.speed === "instant" || spellAbility?.timing?.speed === "flash";
  if (!instantSpeed && !inMainWithEmptyStack(r, a.player)) throw new Reject("wrong_timing", `${def.name} can only be cast during your main phase with an empty stack`);
  const q: QCtx = { controller: a.player, source: o.id };
  for (const pr of spellAbility?.timing?.only ?? []) if (!evalPredicate(r, pr, { ...q, cast: { turn: r.s.turn.number, phase: r.s.turn.phase, activePlayer: r.s.turn.active, from, caster: a.player } })) throw new Reject("wrong_timing", `${def.name}: timing restriction not met`);

  const index = (p[from as "hand" | "command"] as ObjId[]).indexOf(o.id);
  (p[from as "hand" | "command"] as ObjId[]).splice(index, 1);
  o.zone = "stack"; o.timestamp = tick(r);
  const draft: Draft = {
    kind: "spell", player: a.player, sourceId: o.id, objectId: o.id, abilityId: spellAbility?.id ?? "",
    cast: { turn: r.s.turn.number, phase: r.s.turn.phase, activePlayer: r.s.turn.active, from, caster: a.player },
    origin: { zone: from, index }, payWith: a.payWith, autoPay: a.autoPay
  };
  if (a.x !== undefined) { draft.x = a.x; draft.xChosen = true; }
  preapply(r, draft, a);
  startDraft(r, draft, true);
}

/** Apply modes/targets given inside the action itself (shortcut for adapters/tests); validated like an answer. */
function preapply(r: Run, d: Draft, a: { modes?: string[]; targets?: Record<string, string[]> }): void {
  const ab = abilityOfDraft(r, d);
  if (a.modes && ab?.modes) {
    const m = ab.modes;
    const repeatable = m.repeatable === true || m.distinct === false;
    const spec: AskSpec = { kind: "choose_modes", player: d.player, prompt: { title: "", instruction: "" }, options: m.options.map((o) => ({ id: o.id, label: o.text })), min: m.choose.min, max: m.choose.max, repeatable };
    const dec = decide(spec, { ids: a.modes });
    if ("ask" in dec) return;
    d.modeIds = dec.ids;
    d.parts = dec.ids.map((id) => { const o = m.options.find((x) => x.id === id)!; return { modeId: id, specs: o.targets ?? [], steps: o.steps, targets: {} } as Part; });
  } else if (a.modes) throw new Reject("invalid_choice", "this ability has no modes");
  if (a.targets) {
    if (!d.parts) d.parts = [{ specs: ab?.targets ?? [], steps: ab?.steps ?? [], targets: {} }];
    const used = new Set<string>();
    for (const [specId, ids] of Object.entries(a.targets)) {
      const part = d.parts.find((p, i) => p.specs.some((s) => s.id === specId) && !(specId in p.targets) && !used.has(`${i}:${specId}`));
      if (!part) throw new Reject("invalid_choice", `no target slot "${specId}"`);
      const spec = part.specs.find((s) => s.id === specId)!;
      const cands = targetCandidates(r, spec, targetCtx(d), d.objectId);
      if (ids.length < spec.count.min || ids.length > spec.count.max) throw new Reject("illegal_target", `${specId}: choose ${spec.count.min}-${spec.count.max} target(s)`);
      for (const id of ids) if (!cands.includes(id)) throw new Reject("illegal_target", `${label(r, id)} is not a legal target for ${specId}`);
      part.targets[specId] = ids;
    }
  }
}

function activateAbility(r: Run, a: Extract<Action, { type: "activateAbility" }>): void {
  const src = r.s.objects[a.sourceId];
  if (!src) throw new Reject("unknown_object", `unknown object ${a.sourceId}`);
  if (src.controller !== a.player || src.zone !== "battlefield") throw new Reject("not_owner", `${a.player} does not control ${label(r, src.id)} on the battlefield`);
  const ab = abilitiesOf(r, src).find((x) => x.id === a.abilityId);
  if (!ab) throw new Reject("unknown_ability", `${label(r, src.id)} has no ability ${a.abilityId}`);
  if (ab.kind !== "activated" && ab.kind !== "mana") throw new Reject("cannot_activate", `${a.abilityId} is not an activated ability`);
  assertSupported(r, src, ab);
  if (ab.kind === "mana") return activateMana(r, a.player, src, ab, a.color);
  if (ab.timing?.speed === "sorcery" && !inMainWithEmptyStack(r, a.player)) throw new Reject("wrong_timing", "this ability can only be activated at sorcery speed");
  for (const pr of ab.timing?.only ?? []) if (!evalPredicate(r, pr, { controller: a.player, source: src.id })) throw new Reject("wrong_timing", "timing restriction not met");
  const draft: Draft = { kind: "activated", player: a.player, sourceId: src.id, abilityId: ab.id, payWith: a.payWith, autoPay: a.autoPay };
  if (a.x !== undefined) { draft.x = a.x; draft.xChosen = true; }
  preapply(r, draft, a);
  startDraft(r, draft, true);
}

function activateMana(r: Run, pid: PlayerId, src: GameObject, ab: Ability, color?: string, answer?: Choice): void {
  if (!manaAbilityUsable(r, src, ab)) throw new Reject("cannot_activate", `${label(r, src.id)} cannot produce mana right now (tapped or summoning sick)`);
  const prod = productionOf(r, pid, ab.mana!.produces[0]);
  let colors: string[];
  if ("fixed" in prod) colors = prod.fixed;
  else {
    let pick = color;
    if (!pick) {
      const spec: AskSpec = { kind: "choose_color", player: pid, prompt: { title: `${label(r, src.id)}: choose a color`, instruction: "Choose the color of mana to add." }, options: prod.choose.options.map((c) => ({ id: c, label: c })), min: 1, max: 1 };
      const dec = decide(spec, answer);
      if ("ask" in dec) { setPending(r, dec.ask, { t: "draft", stage: "color", draft: { kind: "activated", player: pid, sourceId: src.id, abilityId: ab.id } }, true); return; }
      pick = dec.ids[0];
    }
    if (!prod.choose.options.includes(pick as never)) throw new Reject("invalid_choice", `${pick} is not a legal color for ${label(r, src.id)}`);
    colors = Array.from({ length: prod.choose.count }, () => pick!);
  }
  for (const c of ab.costs ?? []) if ("tap" in c) { src.tapped = true; emit(r, { type: "tap", id: src.id, player: pid }); }
  addMana(r, pid, colors as never, src.id);
  if (ab.steps?.length) {
    const item: StackItem = { id: `m${r.s.nextId++}`, kind: "activated", sourceId: src.id, controller: pid, abilityId: ab.id, parts: [{ specs: [], steps: ab.steps, targets: {} }], x: 0 };
    const st = runExec(r, startExec(item));
    if (st.status === "ask") throw new Unsupported("mana:decision_in_mana_ability");
  }
  if (!r.s.pending) finish(r, /* keep priority */ pid);
}

function playLand(r: Run, a: Extract<Action, { type: "playLand" }>): void {
  const o = r.s.objects[a.cardId];
  if (!o) throw new Reject("unknown_object", `unknown card ${a.cardId}`);
  if (o.owner !== a.player) throw new Reject("not_owner", `${a.player} does not own ${label(r, o.id)}`);
  const p = player(r, a.player);
  if (o.zone !== "hand" || !p.hand.includes(o.id)) throw new Reject("not_in_zone", `${label(r, o.id)} is not in ${a.player}'s hand`);
  if (!chars(r, o.id).types.includes("land")) throw new Reject("not_castable", `${label(r, o.id)} is not a land`);
  if (!inMainWithEmptyStack(r, a.player)) throw new Reject("wrong_timing", "lands can only be played during your main phase with an empty stack");
  if (p.landsPlayed >= 1) throw new Reject("land_limit", "you already played a land this turn");
  assertSupported(r, o);
  p.landsPlayed++;
  emit(r, { type: "land_played", player: a.player, id: o.id });
  moveObject(r, o.id, "battlefield", { controller: a.player });
  finish(r, a.player);
}

// ================================================================ priority / stack / turn structure

function passPriority(r: Run, pid: PlayerId, fast: boolean): void {
  r.s.passes.push(pid);
  const n = alive(r).length;
  if (r.s.passes.length < n) { r.s.priority = nextPlayer(r, pid).id; return; }
  for (;;) {
    r.s.passes = [];
    if (r.s.stack.length === 0) { advanceStep(r); return; }
    resolveTop(r);
    if (r.s.pending || r.s.gameOver) return;
    if (!fast || r.s.stack.length === 0) return;
  }
}

function advancePhase(r: Run, pid: PlayerId): void {
  if (r.s.turn.active !== pid) throw new Reject("not_your_priority", "only the active player can advance the phase");
  if (r.s.stack.length) throw new Reject("stack_not_empty", "the stack must be empty to advance the phase");
  advanceStep(r);
}

function grantPriority(r: Run, to?: PlayerId | null): void {
  const who = to ?? r.s.priorityAfter ?? r.s.turn.active;
  r.s.priorityAfter = null;
  const holder = r.s.players.find((p) => p.id === who && !p.hasLost) ?? nextPlayer(r, who);
  r.s.priority = holder.id;
  r.s.passes = [];
}

/** Settle (SBA + triggers); if nothing is pending, hand out priority. */
function finish(r: Run, keep?: PlayerId): void {
  if (settle(r)) return;
  if (r.s.gameOver) { r.s.priority = null; return; }
  if (keep) { r.s.priorityAfter = null; r.s.priority = keep; return; }
  grantPriority(r);
}

function legalizeTargets(r: Run, item: StackItem): boolean {
  let chosen = 0, legal = 0;
  const q: QCtx = { controller: item.controller, source: item.sourceId, x: item.x, cast: item.cast };
  for (const part of item.parts) {
    for (const spec of part.specs) {
      const ids = part.targets[spec.id] ?? [];
      chosen += ids.length;
      const cands = targetCandidates(r, spec, q);
      part.targets[spec.id] = ids.filter((id) => cands.includes(id));
      legal += part.targets[spec.id].length;
    }
  }
  return !(chosen > 0 && legal === 0);
}

function resolveTop(r: Run): void {
  const item = r.s.stack.pop()!;
  r.s.lki = {};
  const src = tryObj(r, item.sourceId);
  r.s.priorityAfter = null;
  const ok = legalizeTargets(r, item);
  if (!ok) {
    emit(r, { type: "spell_fizzled", id: item.objectId ?? item.sourceId, kind: item.kind });
    if (item.kind === "spell" && src) moveObject(r, src.id, "graveyard");
    finish(r); return;
  }
  const ab = src ? abilitiesOf(r, src).find((a) => a.id === item.abilityId) : undefined;
  if (item.kind === "triggered" && ab?.trigger?.interveningIf && !evalPredicate(r, ab.trigger.interveningIf, { controller: item.controller, source: item.sourceId, eventObj: item.trigger?.eventObj, eventPlayer: item.trigger?.eventPlayer })) {
    emit(r, { type: "trigger_fizzled", source: item.sourceId }); finish(r); return;
  }
  if (item.kind === "spell") {
    const c = chars(r, src!.id);
    const permanent = ["creature", "artifact", "enchantment", "planeswalker", "land", "battle"].some((t) => c.types.includes(t));
    emit(r, { type: "spell_resolving", id: src!.id, player: item.controller });
    if (permanent) {
      moveObject(r, src!.id, "battlefield", { controller: item.controller });
      emit(r, { type: "spell_resolved", id: src!.id, player: item.controller });
      finish(r); return;
    }
  }
  const ex = startExec(item);
  continueExec(r, ex);
}

function continueExec(r: Run, ex: Exec, answerIn?: Choice): void {
  const st = runExec(r, ex, answerIn);
  if (st.status === "ask") { scanTriggers(r); setPending(r, st.spec, { t: "exec", exec: ex }); return; }
  const item = ex.env.item;
  if (item.kind === "spell" && item.objectId) {
    const o = tryObj(r, item.objectId);
    if (o && o.zone === "stack") moveObject(r, item.objectId, "graveyard");
    emit(r, { type: "spell_resolved", id: item.objectId, player: item.controller });
  } else emit(r, { type: "ability_resolved", source: item.sourceId, kind: item.kind });
  finish(r);
}

function advanceStep(r: Run): void {
  const cur = r.s.turn.phase;
  const idx = STEP_ORDER.indexOf(cur);
  if (cur === "cleanup" || idx === STEP_ORDER.length - 1) { startNextTurn(r); return; }
  enterStep(r, STEP_ORDER[idx + 1]);
}

function startNextTurn(r: Run): void {
  const next = nextPlayer(r, r.s.turn.active);
  r.s.turn = { number: r.s.turn.number + 1, active: next.id, phase: "untap" };
  r.s.turnLog = [];
  for (const k of Object.keys(r.s.activations)) if (k.startsWith("t:")) delete r.s.activations[k];
  emit(r, { type: "turn_started", turn: r.s.turn.number, player: next.id });
  enterStep(r, "untap", true);
}

function clearPools(r: Run): void { for (const p of r.s.players) p.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }; }

function enterStep(r: Run, step: Phase, turnStart = false): void {
  clearPools(r);
  r.s.turn.phase = step;
  const active = player(r, r.s.turn.active);
  emit(r, { type: "phase_changed", phase: step, player: active.id });
  if (step === "untap") {
    active.lastTurnStartTs = tick(r);
    active.landsPlayed = 0;
    for (const id of r.s.battlefield) { const o = r.s.objects[id]; if (o.controller === active.id && o.tapped) { o.tapped = false; emit(r, { type: "untap", id }); } }
    void turnStart;
    enterStep(r, "upkeep"); return;
  }
  if (step === "cleanup") { cleanup(r); return; }
  if (step === "draw") {
    const skip = r.s.config.skipFirstDraw && r.s.turn.number === 1;
    if (!skip) drawCards(r, active.id, 1);
  }
  emit(r, { type: "begin_step", step, player: active.id });
  finish(r, undefined);
  if (!r.s.pending && !r.s.gameOver) { r.s.priority = r.s.turn.active; r.s.passes = []; }
}

function cleanup(r: Run): void {
  const active = player(r, r.s.turn.active);
  const excess = active.hand.length - r.s.config.handSize;
  if (excess > 0) {
    setPending(r, {
      kind: "choose_cards", player: active.id, prompt: { title: "Cleanup: discard down to hand size", instruction: `Choose ${excess} card${excess === 1 ? "" : "s"} to discard.` },
      options: active.hand.map((id) => ({ id, label: label(r, id) })), min: excess, max: excess
    }, { t: "cleanup_discard" });
    return;
  }
  endCleanup(r);
}

function endCleanup(r: Run): void {
  for (const id of r.s.battlefield) r.s.objects[id].damage = 0;
  r.s.effects = r.s.effects.filter((e) => e.until !== "end_of_turn");
  emit(r, { type: "end_of_turn", turn: r.s.turn.number });
  startNextTurn(r);
}

// ================================================================ answering decisions

function answer(r: Run, a: Extract<Action, { type: "answerDecision" }>): void {
  const pend = r.s.pending;
  if (!pend) throw new Reject("no_decision", "there is no pending decision");
  if (pend.player !== a.player) throw new Reject("not_your_decision", `the pending decision belongs to ${pend.player}`);
  if (pend.id !== a.decisionId) throw new Reject("wrong_decision", `pending decision is ${pend.id}, not ${a.decisionId}`);
  const choice = a.choice;
  const ctx = pend.ctx;
  if (choice.cancel) {
    if (!pend.cancellable || ctx.t !== "draft") throw new Reject("invalid_choice", "this decision cannot be cancelled");
    const d = ctx.draft;
    if (d.kind === "spell" && d.origin) {
      const o = obj(r, d.sourceId);
      o.zone = d.origin.zone; o.timestamp = tick(r);
      (player(r, o.owner)[d.origin.zone as "hand" | "command"] as ObjId[]).splice(d.origin.index, 0, o.id);
    }
    r.s.pending = null; r.s.priority = d.player; r.s.priorityAfter = null;
    emit(r, { type: "cast_cancelled", player: d.player, id: d.sourceId });
    return;
  }
  r.s.pending = null;
  switch (ctx.t) {
    case "draft": {
      const d = ctx.draft;
      if (ctx.stage === "color") {
        const src = obj(r, d.sourceId);
        const ab = abilitiesOf(r, src).find((x) => x.id === d.abilityId)!;
        activateMana(r, d.player, src, ab, undefined, choice);
        return;
      }
      startDraft(r, d, pend.cancellable, choice);
      return;
    }
    case "exec": continueExec(r, ctx.exec, choice); return;
    case "triggers": {
      if (ctx.stage === "order") {
        const group = r.s.triggerQueue.filter((t) => t.controller === ctx.player);
        const spec: AskSpec = { kind: "order_triggers", player: ctx.player, prompt: pend.prompt, options: group.map((t) => ({ id: t.id, label: t.label })), min: group.length, max: group.length };
        const dec = decide(spec, choice);
        if ("ask" in dec) throw new Reject("invalid_choice", "answer required");
        const others = r.s.triggerQueue.filter((t) => t.controller !== ctx.player);
        const ordered = dec.ids.map((id) => ({ ...group.find((t) => t.id === id)!, ordered: true }));
        r.s.triggerQueue = [...others, ...ordered];
        finish(r);
      }
      return;
    }
    case "cleanup_discard": {
      const active = player(r, r.s.turn.active);
      const excess = active.hand.length - r.s.config.handSize;
      const spec: AskSpec = { kind: "choose_cards", player: active.id, prompt: pend.prompt, options: pend.options, min: excess, max: excess };
      const dec = decide(spec, choice);
      if ("ask" in dec) throw new Reject("invalid_choice", "answer required");
      for (const id of dec.ids) { moveObject(r, id, "graveyard"); emit(r, { type: "discard", player: active.id, id, cleanup: true }); }
      endCleanup(r);
      return;
    }
  }
}

// ================================================================ state-based actions

function sba(r: Run): boolean {
  let any = false;
  for (let guard = 0; guard < 1000; guard++) {
    let changed = false;
    for (const p of r.s.players) {
      if (!p.hasLost && (p.life <= 0 || p.drewFromEmpty)) {
        p.hasLost = true; changed = true;
        emit(r, { type: "player_lost", player: p.id, reason: p.life <= 0 ? "life" : "empty_library" });
      }
    }
    for (const id of [...r.s.battlefield]) {
      const o = r.s.objects[id];
      if (!o || o.zone !== "battlefield") continue;
      const c = chars(r, id);
      if (!c.types.includes("creature") || c.toughness === undefined) continue;
      if (c.toughness <= 0) { moveObject(r, id, "graveyard"); emit(r, { type: "sba_zero_toughness", id }); changed = true; }
      else if (o.damage >= c.toughness) { if (destroyBySba(r, id)) changed = true; }
    }
    if (!changed) break;
    any = true;
  }
  const left = alive(r);
  if (!r.s.gameOver && left.length <= 1 && r.s.players.length > 1) {
    r.s.gameOver = left.length === 1 ? { winner: left[0].id, reason: "last player standing" } : { draw: true, reason: "all players lost simultaneously" };
    emit(r, { type: "game_over", ...r.s.gameOver });
  }
  return any;
}

function destroyBySba(r: Run, id: ObjId): boolean {
  if (chars(r, id).keywords.includes("indestructible")) return false;
  emit(r, { type: "destroyed", id, lethalDamage: true });
  moveObject(r, id, "graveyard");
  return true;
}

// ================================================================ triggers

function lkiMatches(f: ObjectFilter, l: Lki, q: QCtx, id: string): boolean {
  for (const k of Object.keys(f)) if (!["types", "notTypes", "subtypes", "controller", "owner", "token", "another", "named"].includes(k)) throw new Unsupported(`filter:${k}@leaves_battlefield`);
  const lc = (a: string[]) => a.map((x) => x.toLowerCase());
  if (f.types && !lc(f.types).every((t) => l.types.includes(t))) return false;
  if (f.notTypes && lc(f.notTypes).some((t) => l.types.includes(t))) return false;
  if (f.subtypes && !lc(f.subtypes).every((t) => lc(l.subtypes).includes(t))) return false;
  if (f.controller === "you" && l.controller !== q.controller) return false;
  if (f.controller === "opponent" && l.controller === q.controller) return false;
  if (f.owner === "you" && l.owner !== q.controller) return false;
  if (f.owner === "opponent" && l.owner === q.controller) return false;
  if (f.token !== undefined && l.token !== f.token) return false;
  if (f.another && id === q.source) return false;
  if (f.named && l.name.toLowerCase() !== f.named.toLowerCase()) return false;
  return true;
}

function queueTrigger(r: Run, src: ObjId, ab: Ability, controller: PlayerId, ctx: TriggerContext): void {
  const needs = abilityUnsupported(ab);
  if (needs.length) {
    if (r.s.config.lenient) { emit(r, { type: "unsupported_ignored", source: src, ability: ab.id, needs }); return; }
    throw new Unsupported(needs[0], `${label(r, src)}: triggered ability ${ab.id} needs ${needs.join(", ")}`, needs);
  }
  const q: QCtx = { controller, source: src, eventObj: ctx.eventObj, eventPlayer: ctx.eventPlayer };
  if (ab.trigger?.interveningIf && !evalPredicate(r, ab.trigger.interveningIf, q)) return;
  r.s.triggerQueue.push({ id: `q${r.s.nextId++}`, sourceId: src, abilityId: ab.id, controller, ctx, label: `${label(r, src)}: ${ab.text.replace(/\s+/g, " ").slice(0, 80)}` });
}

function scanTriggers(r: Run): void {
  while (r.scanned < r.events.length) {
    const ev = r.events[r.scanned++] as GameEvent & Record<string, unknown>;
    if (ev.type !== "etb" && ev.type !== "dies" && ev.type !== "cast" && ev.type !== "begin_step") continue;
    const holders: Array<{ id: ObjId; controller: PlayerId; lki?: boolean }> = r.s.battlefield.map((id) => ({ id, controller: r.s.objects[id].controller }));
    if (ev.type === "dies") {
      const l = ev.lki as Lki;
      if (!holders.some((h) => h.id === ev.id) && r.s.objects[ev.id as string]) holders.push({ id: ev.id as string, controller: l.controller, lki: true });
    }
    for (const h of holders) {
      const o = r.s.objects[h.id];
      if (!o) continue;
      for (const ab of abilitiesOf(r, o)) {
        const tr = ab.trigger;
        if (ab.kind !== "triggered" || !tr || (ab.zone && ab.zone !== "battlefield")) continue;
        if (!SUPPORTED_TRIGGER_EVENTS.has(tr.event) && !(tr.alsoOn?.length)) continue;
        if (tr.event !== ev.type) continue;
        const q: QCtx = { controller: h.controller, source: h.id };
        const subject = tr.subject;
        let match = false;
        const ctx: TriggerContext = {};
        if (ev.type === "etb") {
          const eid = ev.id as string;
          match = subject === undefined || subject === "self" ? eid === h.id : typeof subject === "object" && matchesFilter(r, eid, subject as ObjectFilter, q);
          ctx.eventObj = eid; ctx.eventPlayer = ev.player as string;
        } else if (ev.type === "dies") {
          const eid = ev.id as string, l = ev.lki as Lki;
          match = subject === undefined || subject === "self" ? eid === h.id : typeof subject === "object" && lkiMatches(subject as ObjectFilter, l, q, eid);
          ctx.eventObj = eid; ctx.eventPlayer = l.controller; ctx.lki = l;
        } else if (ev.type === "cast") {
          const who = ev.player as string;
          if (subject === undefined) throw new Unsupported("trigger:cast_without_subject", `${label(r, h.id)}: cast trigger needs a subject`);
          if (subject === "each_player") match = true;
          else if (subject === "you") match = who === h.controller;
          else if (subject === "opponent" || subject === "each_opponent") match = who !== h.controller;
          else if (typeof subject === "object") match = matchesFilter(r, ev.id as string, subject as ObjectFilter, q);
          else throw new Unsupported(`trigger:subject:${String(subject)}`);
          if (match && tr.nth) match = r.s.turnLog.filter((e) => e.type === "cast" && e.player === who).length === tr.nth.n;
          ctx.eventObj = ev.id as string; ctx.eventPlayer = who;
        } else if (ev.type === "begin_step") {
          if (ev.step !== tr.step) continue;
          const whose = tr.whose ?? "yours";
          match = whose === "each" || (whose === "yours") === (ev.player === h.controller);
          ctx.eventPlayer = ev.player as string;
        }
        if (match) queueTrigger(r, h.id, ab, h.controller, ctx);
      }
    }
  }
}

/** SBA + trigger scan until stable; returns true if a decision was created (triggers wait for it). */
function settle(r: Run): boolean {
  for (let guard = 0; guard < 10000; guard++) {
    sba(r);
    scanTriggers(r);
    if (r.s.gameOver) return false;
    if (r.s.triggerQueue.length === 0) return false;
    if (placeNextTrigger(r)) return true;
  }
  throw new LoopDetected("trigger placement did not terminate");
}

/** Puts the next trigger (APNAP order) on the stack. Returns true if it needs a decision first. */
function placeNextTrigger(r: Run): boolean {
  for (const p of apnap(r)) {
    const group = r.s.triggerQueue.filter((t) => t.controller === p.id);
    if (!group.length) continue;
    if (group.length > 1 && !group.every((t) => t.ordered)) {
      setPending(r, {
        kind: "order_triggers", player: p.id,
        prompt: { title: "Order your triggered abilities", instruction: "Choose the order to put your triggered abilities on the stack (the first one you choose goes on the stack first and resolves last)." },
        options: group.map((t) => ({ id: t.id, label: t.label })), min: group.length, max: group.length
      }, { t: "triggers", stage: "order", player: p.id });
      return true;
    }
    const t = group[0] as QueuedTrigger;
    const draft: Draft = { kind: "triggered", player: p.id, sourceId: t.sourceId, abilityId: t.abilityId, trigger: t.ctx, triggerId: t.id };
    let res: ReturnType<typeof advanceDraft>;
    try { res = advanceDraft(r, draft); } catch (e) {
      if (e instanceof Reject && e.code === "illegal_target") { r.s.triggerQueue = r.s.triggerQueue.filter((x) => x.id !== t.id); emit(r, { type: "trigger_removed", source: t.sourceId, reason: "no legal target" }); return false; }
      throw e;
    }
    if (res === "committed") return false;
    setPending(r, res.ask, { t: "draft", draft, stage: res.stage });
    return true;
  }
  return false;
}

export { opponentsOf, makeLki, resolveObjs, promptForModes, type Prompt, type CastInfo };
