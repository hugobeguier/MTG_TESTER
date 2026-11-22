// resolve(state, action, ctx) -> { state, events, pending?, error? }: the engine entry point.
// Pure and deterministic: the input state is cloned, never mutated; on any error the ORIGINAL state is returned.

import type { Ability, Cost, ObjectFilter, Prompt, TargetSpec } from "../schema";
import { withCardDb } from "./carddb";
import { matchSimple, SIMPLE_EVENTS } from "./triggers6";
import { promptForModes, promptForTarget, promptForX } from "../prompts";
import {
  abilitiesOf, alive, faceNames, printedAbilities, apnap, chars, defOf, drawCards, emit, label, LoopDetected, makeLki, moveObject, NeedAsk, nextPlayer, obj, opponentsOf,
  parseManaCost, player, randInt, Reject, tick, tryObj, Unsupported, isSummoningSick, type Run
} from "./core";
import { autoTapFor, addMana, withTapBonus, manaAbilityActivatable, manaAbilityUsable, payManaAbilityCosts, payFromPool, phyrexianOptions, productionOfAbility, settleCost, totalPotentialMana } from "./mana";
import { evalPredicate, evalQuantity, matchesFilter, objectsMatching, resolveObjs, type QCtx } from "./query";
import { addCounters, changeLife, decide, discardCard, runExec, sacrificeObject, startExec, type AskSpec } from "./steps";
import { costCandidates, costCount, costNoun, costOptions, needsChoice, payChoiceCost, type ChoiceCost } from "./costs";
import { hostOf, invalidateIndex, landDrops, spellCostDelta } from "./layers";
import { anyFirstStrike, applyDamage, blockersToDeclare, checkAssignment, declareAttackers, declareBlockers, gatherDamage, legalAttackers, newCombat } from "./combat";
import { abilityUnsupported, cardUnsupported, SUPPORTED_TRIGGER_EVENTS } from "./support";
import { unattachIllegal } from "./attach";
import { affinityReduction, hasImprovise, improviseCandidates, peekNextSpellGrants, takeNextSpellGrants } from "./castgrants";
import { askCommandZone, overCommanderLimit } from "./commander";
import { checkCounterAnswer, counterCandidates, counterCount, counterSpec } from "./counters7";
import { addUnits, emptyPools, flushRiders, type SpendCtx } from "./manapool";
import { clearRegenShields, regenerates } from "./regen";
import { ofOpponent, opponentIds, slotUsesX, targetBounds, totalMax } from "./targets7";
import { addDurable, expiryFor, consumePermission, expireDurable, hasFlag, permissionIdOf, permissionOptions, permissionsFor, delayeds } from "./durable";
import { flashGrantCovers, playerCantCast, playerHas } from "./layers";
import { castableFaces } from "./faces";
import { addedSteps, baseChoices, castTags, mandatoryExtras, optionalExtras, optionLabel, selectedOptions, spellExtraCosts, spellManaString } from "./castopts";
import type {
  Action, CastInfo, Choice, Draft, EngineContext, Exec, GameEvent, GameObject, GameState, Lki, ObjId, Part, Pending, PendingView, PlayerId,
  QueuedTrigger, ResolveResult, StackItem, TriggerContext
} from "./types";
import { isObjId } from "./types";
import type { Phase, Step, TriggerSpec } from "../schema";

const STEP_ORDER: Phase[] = [
  "untap", "upkeep", "draw", "precombat_main", "beginning_of_combat", "declare_attackers", "declare_blockers", "first_strike_damage", "combat_damage", "end_of_combat",
  "postcombat_main", "end_step", "cleanup"
];
const MAIN: Phase[] = ["precombat_main", "postcombat_main"];

export function viewOf(p: Pending | null): PendingView | undefined {
  if (!p) return undefined;
  const { ctx: _ctx, ...view } = p;
  return view;
}

export function resolve(state: GameState, action: Action, ctx: EngineContext): ResolveResult {
  if (state.pending?.ctx.t === "replay" && action.type === "answerDecision") return answerReplay(state, action, ctx);
  return runAction(state, action, ctx, [], 0);
}

/**
 * Runs one action. `answers` are the recorded answers to replacement-ordering questions of earlier attempts: when the
 * pipeline needs one more, NeedOrder aborts the run and the decision keeps (state, action, answers) so that answering
 * re-runs the very same action with one more answer (see replacements.ts).
 */
function runAction(state: GameState, action: Action, ctx: EngineContext, answers: Choice[], delivered: number): ResolveResult {
  const r: Run = { s: structuredClone(state), events: [], defs: withCardDb(ctx.cards, ctx.db), db: ctx.db, scanned: 0, answers, answerIdx: 0 };
  r.s.decisionSeq += answers.length; // decision ids stay unique across the questions of one replayed action
  try {
    dispatch(r, action);
    return { state: r.s, events: r.events.slice(delivered), pending: viewOf(r.s.pending) };
  } catch (e) {
    if (e instanceof NeedAsk) {
      // the events emitted before the question are delivered NOW (the replay re-emits the same prefix; `delivered` skips it then)
      const s = structuredClone(state);
      s.decisionSeq += answers.length + 1;
      s.priority = null;
      s.pending = { ...e.spec, id: `d${s.decisionSeq}`, cancellable: false, ctx: { t: "replay", base: structuredClone(state), action, answers, delivered: r.events.length } };
      return { state: s, events: r.events.slice(delivered), pending: viewOf(s.pending) };
    }
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

function answerReplay(state: GameState, a: Extract<Action, { type: "answerDecision" }>, ctx: EngineContext): ResolveResult {
  const pend = state.pending!;
  const fail = (code: "not_your_decision" | "wrong_decision" | "invalid_choice", message: string): ResolveResult => ({ state, events: [], error: { code, message } });
  if (pend.player !== a.player) return fail("not_your_decision", `the pending decision belongs to ${pend.player}`);
  if (pend.id !== a.decisionId) return fail("wrong_decision", `pending decision is ${pend.id}, not ${a.decisionId}`);
  if (a.choice.cancel) return fail("invalid_choice", "this decision cannot be cancelled");
  try {
    const d = decide({ kind: pend.kind, player: pend.player, prompt: pend.prompt, options: pend.options, min: pend.min, max: pend.max, repeatable: pend.repeatable, numeric: pend.numeric }, a.choice);
    if ("ask" in d) return fail("invalid_choice", "answer required");
  } catch (e) { if (e instanceof Reject) return fail(e.code as "invalid_choice", e.message); throw e; }
  const c = pend.ctx as Extract<Pending["ctx"], { t: "replay" }>;
  const res = runAction(c.base, c.action, ctx, [...c.answers, { ids: a.choice.ids, number: a.choice.number, yes: a.choice.yes }], c.delivered);
  if (res.error && res.error.code !== "loop_detected") return { state, events: [], error: res.error }; // keep the question open
  return res;
}

function dispatch(r: Run, a: Action): void {
  if (r.s.gameOver) throw new Reject("game_over", "the game is over");
  const p = r.s.players.find((x) => x.id === a.player);
  if (!p) throw new Reject("unknown_object", `unknown player ${a.player}`);
  if (p.hasLost) throw new Reject("game_over", `${a.player} has lost the game`);
  if (a.type === "answerDecision") return answer(r, a);
  if (r.s.pending) throw new Reject("decision_pending", `decision ${r.s.pending.id} for ${r.s.pending.player} must be answered first`);
  if (a.type === "declareAttackers") return doDeclareAttackers(r, a);
  if (a.type === "declareBlockers") return doDeclareBlockers(r, a);
  if (r.s.combat?.expect) {
    const ex = r.s.combat.expect;
    // advancePhase is "everyone passes": for the declaring player it means declaring nothing
    if (a.type === "advancePhase" && ex.kind === "attackers" && ex.player === a.player) return doDeclareAttackers(r, { type: "declareAttackers", player: a.player, attackers: [] });
    throw new Reject("declaration_pending", ex.kind === "attackers" ? `${ex.player} must declare attackers (declareAttackers, an empty list = no attack)` : `blockers must be declared by ${ex.players.join(", ")} (declareBlockers)`);
  }
  if (r.s.priority !== a.player) throw new Reject("not_your_priority", `${a.player} does not have priority (${r.s.priority ?? "nobody"} does)`);
  switch (a.type) {
    case "castSpell": return castSpell(r, a);
    case "activateAbility": return activateAbility(r, a);
    case "playLand": return playLand(r, a);
    case "passPriority": return passPriority(r, a.player, !!a.fastForward);
    case "advancePhase": return advancePhase(r, a.player);
  }
}

// ================================================================ combat flow (rules in combat.ts)

/** Triggers, state-based actions, then priority: what every step does after its turn-based actions. */
function openPriority(r: Run, step: Phase): void {
  emit(r, { type: "begin_step", step, player: r.s.turn.active });
  if (step === "precombat_main") for (const id of [...r.s.battlefield]) { const o = r.s.objects[id]; if (o && o.controller === r.s.turn.active && chars(r, id).subtypes.some((s) => s.toLowerCase() === "saga")) addCounters(r, [id], "lore", 1); } // saga lore counters after the draw step
  if (step === "end_step" && r.s.monarch && r.s.monarch === r.s.turn.active) drawCards(r, r.s.monarch, 1); // the monarch draws at the beginning of their end step
  finish(r, undefined);
  if (!r.s.pending && !r.s.gameOver && !r.s.combat?.expect) { r.s.priority = r.s.turn.active; r.s.passes = []; }
}

function doDeclareAttackers(r: Run, a: Extract<Action, { type: "declareAttackers" }>): void {
  if (r.s.turn.phase !== "declare_attackers") throw new Reject("not_declaring", "attackers are declared in the declare attackers step");
  const n = declareAttackers(r, a);
  r.s.passes = [];
  if (n === 0) { enterStep(r, "end_of_combat"); return; } // 508.8: no attackers, no blockers and no damage
  openPriority(r, "declare_attackers");
}

function doDeclareBlockers(r: Run, a: Extract<Action, { type: "declareBlockers" }>): void {
  if (r.s.turn.phase !== "declare_blockers") throw new Reject("not_declaring", "blockers are declared in the declare blockers step");
  if (declareBlockers(r, a)) openPriority(r, "declare_blockers");
}

function runDamage(r: Run, which: "first" | "regular", assigned: Record<string, Record<string, number>>): void {
  const res = gatherDamage(r, which, assigned);
  if ("ask" in res) {
    setPending(r, res.ask.spec, { t: "combat_damage", which, assigned, attacker: res.ask.attacker });
    r.s.pending!.amounts = { total: res.ask.total, lethal: res.ask.lethal, trample: res.ask.trample };
    return;
  }
  applyDamage(r, which, res.items);
  openPriority(r, which === "first" ? "first_strike_damage" : "combat_damage");
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
  if (spec.what === "player" || spec.what === "any") for (const p of alive(r)) { if (f.controller === "opponent" && p.id === q.controller) continue; /* "target opponent" */ if (f.controller === "you" && p.id !== q.controller) continue; if (p.id === q.controller || !playerHas(r, p.id, "hexproof")) out.push(p.id); }
  if (spec.what === "object" || spec.what === "any") {
    const zone = f.zone ?? ((f.types ?? []).includes("spell") ? "stack" : "battlefield");
    let ids = objectsMatching(r, { ...f, zone }, q);
    if (spec.what === "any") ids = ids.filter((id) => ["creature", "planeswalker"].some((t) => chars(r, id).types.includes(t)));
    out.unshift(...ids.filter((id) => id !== selfSpell && (zone !== "battlefield" || !untargetable(r, id, q.controller))));
  }
  return out;
}

function chosenAnswerSpec(r: Run, name: string, spec: TargetSpec, cands: string[], player: PlayerId, q: QCtx): AskSpec {
  const b = targetBounds(r, spec, q, cands.length);
  return {
    kind: "choose_targets", player, prompt: spec.prompt ?? promptForTarget(name, spec),
    options: cands.map((id) => ({ id, label: label(r, id) })), min: Math.min(b.min, cands.length), max: Math.min(b.max, cands.length)
  };
}

/** Constraints on the chosen targets as a whole ("each with a different mana value"). */
function checkTargetRules(r: Run, d: Draft): void {
  for (const part of d.parts ?? []) for (const st of part.steps) {
    if (st.kind === "reanimate" && st.differentManaValues && typeof st.target === "string") {
      const mvs = (part.targets[st.target] ?? []).map((id) => chars(r, id).mv);
      if (new Set(mvs).size !== mvs.length) throw new Reject("illegal_target", "the targets must have different mana values");
    }
  }
}

function featuresOk(r: Run, specs: TargetSpec[], draft: Draft): boolean {
  const q = targetCtx(draft);
  return specs.every((s) => s.perOpponent || targetBounds(r, s, q, 1).min === 0 || targetCandidates(r, s, q, draft.objectId).length >= targetBounds(r, s, q, 1).min);
}

// ================================================================ draft (cast / activate / trigger placement)

function abilityOfDraft(r: Run, d: Draft): Ability | undefined {
  const src = tryObj(r, d.sourceId);
  if (!src) return undefined;
  return abilitiesOf(r, src).find((a) => a.id === d.abilityId);
}

function cardName(r: Run, d: Draft): string { return label(r, d.sourceId); }

function costX(r: Run, d: Draft, a: Ability | undefined): boolean {
  if (d.kind === "spell") return parseManaCost(spellManaString(r, d)).x > 0 || spellExtraCosts(r, d).some((c) => JSON.stringify(c).includes('"ref":"X"'));
  return (a?.costs ?? []).some((c) => ("mana" in c && /\{X\}/.test(c.mana)) || ("loyalty" in c && JSON.stringify(c.loyalty).includes('"ref":"X"')) || ("counters" in c && JSON.stringify(c.counters.count ?? 0).includes('"ref":"X"')));
}

/** Runs the choice stages in order. Returns the ask spec when a decision is needed, else commits the item. */
function advanceDraft(r: Run, d: Draft, answerIn?: Choice): { ask: AskSpec; stage: "face" | "option" | "extras" | "gift" | "modes" | "targets" | "x" | "color" | "costs" | "phyrexian" | "counters" | "improvise" } | "committed" {
  let answerLeft = answerIn;
  const name = cardName(r, d);
  const a = abilityOfDraft(r, d);

  // ---- face stage (modal double-faced / split cards): which face is cast; everything after reads that face
  if (d.kind === "spell" && !d.faceDone) {
    const card = obj(r, d.sourceId);
    const faces = castableFaces(defOf(r, card)!);
    const spec: AskSpec = { kind: "choose_cast_option", player: d.player, prompt: { title: `${name}: which face?`, instruction: "Choose the face to cast." }, options: faces.map((f) => ({ id: f, label: f })), min: 1, max: 1 };
    const dec = decide(spec, answerLeft);
    if ("ask" in dec) return { ask: dec.ask, stage: "face" };
    answerLeft = undefined;
    card.face = dec.ids[0];
    d.faceDone = true;
    d.abilityId = printedAbilities(r, card).find((x) => x.kind === "spell_effect")?.id ?? "";
    checkSpellTiming(r, card, d.player, d.origin!.zone);
    return advanceDraft(r, d, answerLeft);
  }

  // ---- cast option stage (spells): HOW to cast it (normal / flashback / escape / alternative cost / from another zone), then the optional extras (kicker, gift, optional additional costs)
  if (d.kind === "spell" && !d.castChosen) {
    const card = obj(r, d.sourceId);
    const origin = d.origin!.zone;
    if (!d.castBaseDone) {
      const bases = baseChoices(r, card, d.player, origin, d.permSnap);
      if (!bases.length) throw new Reject("not_castable", `${name} cannot be cast from ${origin} right now`);
      let pick = bases[0];
      if (bases.length > 1) {
        const spec: AskSpec = {
          kind: "choose_cast_option", player: d.player, prompt: { title: `${name}: how do you want to cast it?`, instruction: "Choose how to cast this spell." },
          options: bases.map((b) => ({ id: b ? b.id : "normal", label: optionLabel(b) })), min: 1, max: 1
        };
        const dec = decide(spec, answerLeft);
        if ("ask" in dec) return { ask: dec.ask, stage: "option" };
        answerLeft = undefined;
        pick = bases.find((b) => (b ? b.id : "normal") === dec.ids[0])!;
      }
      d.castBase = pick ? pick.id : ""; d.castBaseDone = true;
    }
    if (!d.castExtrasDone) {
      const opts = optionalExtras(r, card, d.player, origin);
      if (opts.length) {
        const spec: AskSpec = {
          kind: "choose_cast_option", player: d.player, prompt: { title: `${name}: optional costs`, instruction: "Choose any optional costs to pay (kicker, gift, additional costs), or none." },
          options: opts.map((c) => ({ id: c.id, label: optionLabel(c) })), min: 0, max: opts.length
        };
        const dec = decide(spec, answerLeft);
        if ("ask" in dec) return { ask: dec.ask, stage: "extras" };
        answerLeft = undefined;
        d.castExtras = dec.ids;
      } else d.castExtras = [];
      d.castExtrasDone = true;
    }
    const gifts = (d.castExtras ?? []).filter((id) => optionalExtras(r, card, d.player, origin).find((c) => c.id === id)?.kind === "gift");
    if (gifts.length && !d.giftTo) {
      const opps = opponentsOf(r, d.player);
      if (opps.length === 1) d.giftTo = opps[0].id;
      else if (opps.length > 1) {
        const spec: AskSpec = { kind: "choose_option", player: d.player, prompt: { title: `${name}: promise a gift`, instruction: "Choose the opponent who receives the gift." }, options: opps.map((p) => ({ id: p.id, label: label(r, p.id) })), min: 1, max: 1 };
        const dec = decide(spec, answerLeft);
        if ("ask" in dec) return { ask: dec.ask, stage: "gift" };
        answerLeft = undefined;
        d.giftTo = dec.ids[0];
      }
    }
    d.castChosen = [...(d.castBase ? [d.castBase] : []), ...mandatoryExtras(r, card, d.player, origin).map((c) => c.id), ...(d.castExtras ?? [])];
  }

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
    // a spell whose text the draft split into several spell_effect abilities (Rishkar's Expertise, Shamanic Revelation): every one of them happens, in order, as a part of its own
    if (d.kind === "spell" && a && !a.modes) {
      const o = obj(r, d.sourceId);
      for (const x of printedAbilities(r, o)) if (x.kind === "spell_effect" && x !== a && !x.modes && x.steps?.length && x.keyword?.name !== "enchant") d.parts.push({ specs: x.targets ?? [], steps: x.steps, targets: {} });
    }
  }

  // ---- X (asked BEFORE the targets when a target slot depends on it: "up to X targets", "mana value X or less")
  const xStage = (): { ask: AskSpec; stage: "x" } | undefined => {
    if (d.xChosen || !costX(r, d, a)) return undefined;
    const base = d.kind === "spell" ? parseManaCost(spellManaString(r, d)) : parseManaCost((a!.costs ?? []).filter((c) => "mana" in c).map((c) => (c as { mana: string }).mana).join(""));
    const fixed = base.mv;
    let max = base.x > 0 ? Math.max(0, Math.floor((totalPotentialMana(r, d.player) - fixed) / Math.max(1, base.x))) : Infinity;
    // X that appears in a NON-mana cost (pay X life, sacrifice X creatures) is capped by what can pay it
    for (const c of d.kind === "spell" ? spellExtraCosts(r, d) : []) {
      if (!JSON.stringify(c).includes('"ref":"X"')) continue;
      if ("life" in c) max = Math.min(max, player(r, d.player).life);
      else if (needsChoice(c)) max = Math.min(max, costCandidates(r, c, { player: d.player, source: d.sourceId, x: 0 }).length);
    }
    for (const c of d.kind === "activated" ? a?.costs ?? [] : []) if ("counters" in c && c.counters.remove && typeof c.counters.from === "object" && JSON.stringify(c.counters.count ?? 0).includes('"ref":"X"')) max = Math.min(max, counterCandidates(r, c.counters.kind, c.counters.from, { controller: d.player, source: d.sourceId, x: 0 }).reduce((n, x) => n + x.n, 0));
    for (const c of d.kind === "activated" ? a?.costs ?? [] : []) if ("loyalty" in c && JSON.stringify(c.loyalty).includes('"ref":"X"')) max = Math.min(max, obj(r, d.sourceId).counters.loyalty ?? 0); // "-X": at most the loyalty it has
    if (!Number.isFinite(max)) max = 0;
    const spec: AskSpec = { kind: "choose_x", player: d.player, prompt: a?.xPrompt ?? promptForX(name), options: [], min: 0, max, numeric: true };
    const dec = decide(spec, answerLeft);
    if ("ask" in dec) return { ask: dec.ask, stage: "x" };
    answerLeft = undefined;
    d.x = dec.number; d.xChosen = true;
    return undefined;
  };
  if (d.parts.some((p) => p.specs.some(slotUsesX))) { const asked = xStage(); if (asked) return asked; }

  // ---- targets
  for (const part of d.parts) {
    for (const spec of part.specs) {
      // a conditional slot ("if this spell was kicked") exists only while its predicate holds when the spell is cast / the ability is put on the stack; the options chosen so far are known (castTags)
      if (spec.onlyIf && !evalPredicate(r, spec.onlyIf, { ...targetCtx(d), cast: d.cast ? { ...d.cast, paid: castTags(d, r) } : d.cast })) { part.targets[spec.id] = []; continue; }
      if (spec.id in part.targets) continue;
      // a reflexive step ("When you do, return target ...") chooses its own target while it resolves, not now
      if (part.steps.some((st) => st.reflexive && st.target === spec.id)) { part.targets[spec.id] = []; continue; }
      const q = targetCtx(d);
      const cands = targetCandidates(r, spec, q, d.objectId);
      if (spec.perOpponent) {
        // "for each opponent, up to one target ...": one question per opponent (in turn order), each limited to that opponent's candidates
        const acc = ((d.perOpp ??= {})[spec.id] ??= { done: [], picked: [] });
        for (const opp of opponentIds(r, d.player)) {
          if (acc.done.includes(opp)) continue;
          const mine = ofOpponent(r, cands, opp);
          const b = targetBounds(r, spec, q, mine.length);
          if (b.min > 0 && mine.length < b.min) throw new Reject("illegal_target", `no legal targets for ${spec.id} (${label(r, opp)})`);
          if (mine.length === 0) { acc.done.push(opp); continue; }
          const ask = chosenAnswerSpec(r, name, spec, mine, d.player, q);
          const dec = decide(ask, answerLeft);
          if ("ask" in dec) return { ask: dec.ask, stage: "targets" };
          answerLeft = undefined;
          acc.picked.push(...dec.ids); acc.done.push(opp);
        }
        part.targets[spec.id] = acc.picked;
        continue;
      }
      const b = targetBounds(r, spec, q, cands.length);
      if (b.min > 0 && cands.length < b.min) throw new Reject("illegal_target", `no legal targets for ${spec.id}`);
      if (cands.length === 0 || b.max === 0) { part.targets[spec.id] = []; continue; }
      const ask = chosenAnswerSpec(r, name, spec, cands, d.player, q);
      const dec = decide(ask, answerLeft);
      if ("ask" in dec) return { ask: dec.ask, stage: "targets" };
      answerLeft = undefined;
      part.targets[spec.id] = dec.ids;
    }
  }

  checkTargetRules(r, d);
  { const asked = xStage(); if (asked) return asked; }

  // ---- costs that need a choice (sacrifice another permanent, discard, exile from graveyard, tap other permanents...): asked before anything is paid
  const choiceCosts = d.kind === "activated" ? a?.costs : d.kind === "spell" ? spellExtraCosts(r, d) : undefined;
  if (choiceCosts) {
    for (const [i, c] of choiceCosts.entries()) {
      if (!needsChoice(c) || (d.costChoices && i in d.costChoices)) continue;
      const cx = { player: d.player, source: d.sourceId, x: d.x };
      const cands = costCandidates(r, c, cx);
      const n = costCount(r, c, cx);
      if (cands.length < n) throw new Reject("cannot_pay", `not enough objects to ${costNoun(c)} (need ${n}, have ${cands.length})`);
      if (cands.length === n) { (d.costChoices ??= {})[i] = [...cands]; continue; } // no choice to make
      const spec: AskSpec = {
        kind: "choose_cards", player: d.player,
        prompt: (c as { prompt?: Prompt }).prompt ?? { title: `${name}: pay a cost`, instruction: `Choose ${n} to ${costNoun(c)}.` },
        options: costOptions(r, cands), min: n, max: n
      };
      const dec = decide(spec, answerLeft);
      if ("ask" in dec) return { ask: dec.ask, stage: "costs" };
      answerLeft = undefined;
      (d.costChoices ??= {})[i] = dec.ids;
    }
  }

  // ---- improvise: tap artifacts to pay for generic mana (asked late, before the payment)
  if (d.kind === "spell" && !d.improviseDone) {
    d.improviseDone = true;
    const gcost = parseManaCost(spellManaString(r, d));
    const gen = gcost.generic + gcost.x * (d.x ?? 0); // an artifact pays for {1} of the whole generic cost, X included (CR 702.126a)
    const cands = hasImprovise(r, d.sourceId, d.grants) ? improviseCandidates(r, d.player) : [];
    if (cands.length && gen > 0) {
      const spec: AskSpec = { kind: "choose_cards", player: d.player, prompt: { title: `${name}: improvise`, instruction: `Choose any artifacts to tap; each pays for {1} (at most ${gen}).` }, options: cands.map((id) => ({ id, label: label(r, id) })), min: 0, max: Math.min(gen, cands.length) };
      const given = answerLeft ?? (d.improvisePreset ? { ids: d.improvisePreset } : undefined);
      const dec = decide(spec, given);
      if ("ask" in dec) { d.improviseDone = false; return { ask: dec.ask, stage: "improvise" }; }
      answerLeft = undefined;
      d.improvised = dec.ids;
    }
  }

  // ---- counters removed "from among" several permanents (Hopeful Initiate, Retribution of the Ancients): which counters, asked before anything is paid
  if (d.kind === "activated") for (const [i, c] of (a?.costs ?? []).entries()) {
    if (!("counters" in c) || !c.counters.remove || typeof c.counters.from !== "object" || (d.counterChoices && i in d.counterChoices)) continue;
    const cx = { controller: d.player, source: d.sourceId, x: d.x ?? 0 };
    const n = counterCount(r, c.counters, cx);
    const cands = counterCandidates(r, c.counters.kind, c.counters.from, cx);
    const total = cands.reduce((s, x) => s + x.n, 0);
    if (total < n) throw new Reject("cannot_pay", `not enough ${c.counters.kind} counters (need ${n}, have ${total})`);
    if (n === 0) { (d.counterChoices ??= {})[i] = {}; continue; }
    if (total === n || cands.length === 1) { (d.counterChoices ??= {})[i] = cands.length === 1 ? { [cands[0].id]: n } : Object.fromEntries(cands.map((x) => [x.id, x.n])); continue; } // nothing to decide
    const spec = counterSpec(r, d.player, (c as { prompt?: Prompt }).prompt ?? { title: `${name}: remove counters`, instruction: `Choose ${n} ${c.counters.kind} counter${n === 1 ? "" : "s"} to remove from among your permanents.` }, Object.fromEntries(cands.map((x) => [x.id, x.n])), n, n, (id) => label(r, id));
    if (!answerLeft) return { ask: spec, stage: "counters" };
    (d.counterChoices ??= {})[i] = checkCounterAnswer(spec, answerLeft);
    answerLeft = undefined;
  }

  // ---- Phyrexian mana: each symbol is a REAL choice (pay the color, or 2 life), asked before anything is paid
  const phySyms = phyrexianCosts(r, d, a);
  if (phySyms.some((c) => c.phyrexian?.length)) {
    const flat = phySyms.flatMap((c) => (c.phyrexian ?? []).map((_, i) => ({ cost: c, i })));
    d.phy ??= [];
    while (d.phy.length < flat.length) {
      const k = d.phy.length, { cost, i } = flat[k];
      const opts = phyrexianOptions(r, d.player, cost, d.phy, i);
      const sym = cost.phyrexian![i];
      if (!opts.mana && !opts.life) throw new Reject("cannot_pay", `cannot pay the Phyrexian mana symbol {${sym.join("/")}/P}`);
      const preset = d.phyPreset?.[k];
      let pick: "mana" | "life";
      if (opts.mana && opts.life) {
        const spec: AskSpec = { kind: "choose_option", player: d.player, prompt: { title: `${name}: Phyrexian mana`, instruction: `Pay {${sym.join("/")}/P} with the mana or with 2 life.` }, options: [{ id: "mana", label: `Pay {${sym.join("/")}}` }, { id: "life", label: "Pay 2 life" }], min: 1, max: 1 };
        const given = answerLeft ?? (preset ? { ids: [preset] } : undefined);
        const dec = decide(spec, given);
        if ("ask" in dec) return { ask: dec.ask, stage: "phyrexian" };
        answerLeft = undefined;
        pick = dec.ids[0] as "mana" | "life";
      } else {
        if (preset && preset !== (opts.mana ? "mana" : "life")) throw new Reject("invalid_choice", `${preset} is not a legal way to pay the Phyrexian symbol`);
        pick = opts.mana ? "mana" : "life";
      }
      d.phy.push(pick);
    }
  }

  commitDraft(r, d, a);
  return "committed";
}

/** The mana costs (parsed) a draft will pay, in payment order: a spell's total cost, or the mana costs of the activated ability. */
function phyrexianCosts(r: Run, d: Draft, a: Ability | undefined): ReturnType<typeof parseManaCost>[] {
  if (d.kind === "spell") return [parseManaCost(spellManaString(r, d))];
  return (a?.costs ?? []).filter((c): c is { mana: string } & Cost => "mana" in c).map((c) => parseManaCost((c as { mana: string }).mana));
}

function payMana(r: Run, pid: PlayerId, rawCost: ReturnType<typeof parseManaCost>, x: number, d: Draft, exclude: ObjId[] = [], ctx?: SpendCtx): void {
  const nPhy = rawCost.phyrexian?.length ?? 0;
  const used = d.phyUsed ?? 0;
  const phy = d.phy?.slice(used, used + nPhy);
  d.phyUsed = used + nPhy;
  const { cost, life } = settleCost(r, pid, rawCost, phy, d.payWith);
  if (life > 0 && player(r, pid).life < life) throw new Reject("cannot_pay", "not enough life to pay the Phyrexian mana");
  if (payFromPool(r, pid, cost, x, ctx)) { if (life > 0) changeLife(r, undefined, pid, -life); return; }
  const allowTap = d.payWith !== undefined || d.autoPay !== false;
  if (!(allowTap && autoTapFor(r, pid, cost, x, d.payWith, exclude, ctx) && payFromPool(r, pid, cost, x, ctx))) throw new Reject("cannot_pay", "cannot pay the mana cost with the available mana");
  if (life > 0) changeLife(r, undefined, pid, -life);
}

/** "This ability costs {1} less for each ..." (Channel): the generic reduction of an activated ability. */
function abilityReduction(r: Run, d: Draft, a: Ability | undefined): number {
  const cr = a?.costReduction;
  if (!cr) return 0;
  const q: QCtx = { controller: d.player, source: d.sourceId, x: d.x };
  if (cr.condition && !evalPredicate(r, cr.condition, q)) return 0;
  const per = cr.per ? objectsMatching(r, cr.per, q).length : 1;
  return Math.max(0, evalQuantity(r, cr.amount, q) * per);
}

function payAbilityCosts(r: Run, d: Draft, costs: Cost[], a?: Ability): { sacrificed: ObjId[]; lki: Record<ObjId, Lki> } {
  const src = obj(r, d.sourceId);
  const paid = { sacrificed: [] as ObjId[], lki: {} as Record<ObjId, Lki> };
  let reduction = abilityReduction(r, d, a);
  for (const [ci, c] of costs.entries()) {
    if ("discard" in c && c.discard === "self") {
      // cycling / channel: discard this card from your hand as a cost
      if (src.zone !== "hand") throw new Reject("cannot_pay", `${label(r, src.id)} is no longer in your hand`);
      discardCard(r, d.player, src.id);
      if (a?.keyword?.name.toLowerCase() === "cycling") { emit(r, { type: "cycle", id: src.id, player: d.player, x: d.x ?? 0 }); r.s.turnLog.push({ type: "cycle", id: src.id, player: d.player, ts: r.s.clock }); }
      continue;
    }
    if ("loyalty" in c) {
      const n = evalQuantity(r, c.loyalty, { controller: d.player, source: d.sourceId, x: d.x });
      const cur = src.counters.loyalty ?? 0;
      if (src.zone !== "battlefield") throw new Reject("cannot_pay", "the planeswalker is no longer on the battlefield");
      if (n < 0 && cur < -n) throw new Reject("cannot_pay", `${label(r, src.id)} has only ${cur} loyalty`);
      if (n !== 0) { src.counters.loyalty = cur + n; if (src.counters.loyalty === 0) src.counters.loyalty = 0; emit(r, { type: n > 0 ? "counter_added" : "counter_removed", id: src.id, kind: "loyalty", amount: Math.abs(n) }); }
      continue;
    }
    if (needsChoice(c)) {
      const ids = d.costChoices?.[ci] ?? [];
      Object.assign(paid.lki, payChoiceCost(r, c as ChoiceCost, ids, { player: d.player, source: d.sourceId, x: d.x }));
      if ("sacrifice" in c) paid.sacrificed.push(...ids);
      continue;
    }
    if ("exileFrom" in c && (c as unknown as { what: unknown }).what === "self") {
      if (src.zone !== "battlefield") throw new Reject("cannot_pay", "the source is no longer on the battlefield");
      moveObject(r, src.id, "exile"); emit(r, { type: "exiled", id: src.id });
      continue;
    }
    if ("sacrifice" in c && c.sacrifice === "self") paid.sacrificed.push(src.id);
    if ("unsupported" in c) throw new Unsupported("cost:unsupported");
    if ("mana" in c) {
      const pc = parseManaCost(c.mana);
      if (reduction > 0) { const g = Math.max(0, pc.generic - reduction); reduction -= pc.generic - g; pc.mv -= pc.generic - g; pc.generic = g; }
      payMana(r, d.player, pc, d.x ?? 0, d, costs.some((k) => "tap" in k || ("sacrifice" in k && k.sacrifice === "self")) ? [d.sourceId] : [], { abilitySource: d.sourceId, spent: [] });
    } else if ("tap" in c) {
      if (src.zone !== "battlefield" || src.tapped) throw new Reject("cannot_pay", `${label(r, src.id)} is already tapped`);
      if (isSummoningSick(r, src)) throw new Reject("cannot_pay", `${label(r, src.id)} is summoning sick`);
      src.tapped = true; emit(r, { type: "tap", id: src.id, player: d.player });
    } else if ("sacrifice" in c) {
      if (src.zone !== "battlefield") throw new Reject("cannot_pay", "the source is no longer on the battlefield");
      r.s.turnLog.push({ type: "sacrifice", id: src.id, player: d.player, ts: r.s.clock });
      emit(r, { type: "sacrificed", id: src.id, player: d.player });
      moveObject(r, src.id, "graveyard");
      if (r.s.lki[src.id]) paid.lki[src.id] = r.s.lki[src.id];
    } else if ("life" in c) {
      const n = evalQuantity(r, c.life, { controller: d.player, source: d.sourceId, x: d.x });
      if (player(r, d.player).life < n) throw new Reject("cannot_pay", "not enough life");
      changeLife(r, undefined, d.player, -n);
    } else if ("counters" in c && typeof c.counters.from === "object" && c.counters.remove) {
      for (const [oid, k] of Object.entries(d.counterChoices?.[ci] ?? {})) {
        const o = tryObj(r, oid);
        if (!o || (o.counters[c.counters.kind] ?? 0) < k) throw new Reject("cannot_pay", `${label(r, oid)} no longer has the counters`);
        addCounters(r, [oid], c.counters.kind, -k);
      }
    } else if ("counters" in c) {
      const n = counterCount(r, c.counters, { controller: d.player, source: d.sourceId, x: d.x ?? 0 });
      const cur = src.counters[c.counters.kind] ?? 0;
      if (c.counters.remove && cur < n) throw new Reject("cannot_pay", `not enough ${c.counters.kind} counters`);
      src.counters[c.counters.kind] = cur + (c.counters.remove ? -n : n);
      if (src.counters[c.counters.kind] === 0) delete src.counters[c.counters.kind];
      emit(r, { type: c.counters.remove ? "counter_removed" : "counter_added", id: src.id, kind: c.counters.kind, amount: n });
    } else throw new Unsupported(`cost:${Object.keys(c)[0]}`);
  }
  return paid;
}

function commitDraft(r: Run, d: Draft, a: Ability | undefined): void {
  const pid = d.player;
  const src = obj(r, d.sourceId);
  let spellCard: GameObject | undefined;
  let paidCosts: ReturnType<typeof payAbilityCosts> | undefined;
  let spend: SpendCtx | undefined;

  if (d.kind === "spell") {
    spellCard = src;
    const tax = d.origin?.zone === "command" ? 2 * (player(r, pid).commanderCasts[src.id] ?? 0) : 0;
    const cost = parseManaCost(spellManaString(r, d));
    cost.generic += tax; cost.mv += tax;
    const delta = spellCostDelta(r, pid, src.id);
    if (delta) { const g = Math.max(0, cost.generic + delta); cost.mv += g - cost.generic; cost.generic = g; }
    { const aff = affinityReduction(r, pid, d.grants); if (aff) { const g = Math.max(0, cost.generic - aff); cost.mv -= cost.generic - g; cost.generic = g; } }
    // improvise: each tapped artifact pays for {1} of the generic part
    if (d.improvised?.length) {
      for (const id of d.improvised) { const ao = tryObj(r, id); if (!ao || ao.tapped || ao.zone !== "battlefield") throw new Reject("cannot_pay", `${label(r, id)} cannot be tapped for improvise`); }
      const total = cost.generic + cost.x * (d.x ?? 0);
      const n = Math.min(d.improvised.length, total);
      for (const id of d.improvised.slice(0, n)) { obj(r, id).tapped = true; emit(r, { type: "tap", id, player: pid, improvise: true }); }
      cost.mv -= Math.min(n, cost.generic);
      cost.generic = total - n; cost.x = 0; // the X part is folded into the generic mana still to pay
    }
    src.castX = d.x;
    if (d.grants?.length) takeNextSpellGrants(r, pid); // the grants are used up when the spell is really cast (cancelling keeps them)
    spend = { spell: d.objectId, spent: [] };
    payMana(r, pid, cost, d.x ?? 0, d, [], spend);
    if (d.cast) d.cast.spent = [...spend.spent];
    paidCosts = payAbilityCosts(r, d, spellExtraCosts(r, d));
    if (d.origin?.zone === "command") player(r, pid).commanderCasts[src.id] = (player(r, pid).commanderCasts[src.id] ?? 0) + 1;
    const chosen = selectedOptions(r, d);
    if (chosen.some((c) => c.afterResolution === "exile")) src.exileInstead = true;
    if (d.cast) { d.cast.paid = castTags(d, r); src.cast = structuredClone(d.cast); }
    for (const id of d.castChosen ?? []) { const pid2 = permissionIdOf(id); if (pid2) consumePermission(r, pid2); } // a permission is used up when you cast with it
    const extraSteps = addedSteps(r, d);
    if (extraSteps.length && d.parts?.length) {
      const who = d.giftTo;
      const rewritten = extraSteps.map((st) => ({ ...st, ...(st.who === "opponent" ? { who: "that_player" as const } : {}) }));
      d.parts[0].steps = [...(who ? [{ kind: "__iter", player: who } as unknown as Step] : []), ...rewritten, ...d.parts[0].steps];
    }
  } else if (d.kind === "activated" && a) {
    paidCosts = payAbilityCosts(r, d, a.costs ?? [], a);
  }

  const key = `${d.sourceId}:${d.abilityId}`;
  if (d.kind === "activated" && a?.costs?.some((c) => "loyalty" in c)) r.s.activations[`t:${d.sourceId}:loyalty`] = 1;
  if (d.kind === "activated" && a?.timing?.limit) {
    const lim = a.timing.limit;
    const k = (lim.per === "game" ? "g:" : "t:") + key;
    if ((r.s.activations[k] ?? 0) >= lim.count) throw new Reject("cannot_activate", `${label(r, d.sourceId)} can only be activated ${lim.count} time(s) per ${lim.per}`);
    r.s.activations[k] = (r.s.activations[k] ?? 0) + 1;
  }

  // "X is the greatest power among creatures you control as you cast this spell": quantities locked on cast are evaluated now and frozen into the steps
  for (const part of d.parts ?? []) {
    if (part.steps.some((st) => st.amountLockedOn === "cast" && st.amount !== undefined)) {
      const q = targetCtx(d);
      part.steps = part.steps.map((st) => (st.amountLockedOn === "cast" && st.amount !== undefined ? { ...st, amount: evalQuantity(r, st.amount as never, q) } : st));
    }
  }
  const item: StackItem = {
    id: `s${r.s.nextId++}`, kind: d.kind, sourceId: d.sourceId, objectId: d.objectId, controller: pid, abilityId: d.abilityId,
    parts: d.parts ?? [], x: d.x ?? 0, cast: d.cast, trigger: d.trigger,
    ...(paidCosts?.sacrificed.length ? { sacrificed: paidCosts.sacrificed, costLki: paidCosts.lki } : {})
  };
  r.s.stack.push(item);
  if (spend) flushRiders(r, pid, spend);
  r.s.passes = [];
  for (const part of item.parts) for (const ids of Object.values(part.targets)) for (const tid of ids) if (isObjId(tid)) emit(r, { type: "becomes_target", id: tid, by: item.objectId ?? item.id, player: pid });
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
  if (o.token) {
    const mine = only ? abilityUnsupported(only) : [];
    if (mine.length) throw new Unsupported(mine[0], `${o.token.name}: unsupported capability ${mine.join(", ")}`, mine);
    return;
  }
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
  const permitted = permissionsFor(r, o, a.player).some((d) => d.permission!.allow.includes("spell"));
  if (o.owner !== a.player && !permitted) throw new Reject("not_owner", `${a.player} does not own ${label(r, o.id)}`);
  const p = player(r, o.owner); // the zone lists of the card's OWNER (a permission can let you cast an opponent's exiled card)
  const from = o.zone;
  const zoneOk = from === "stack" || from === "battlefield" ? false
    : (from === "hand" && p.hand.includes(o.id) && o.owner === a.player) || (from === "command" && p.command.includes(o.id) && !!o.isCommander && o.owner === a.player)
    // another zone only through a cast option (flashback, escape, "cast from your graveyard") or a granted permission
    || ((from === "graveyard" || from === "exile" || from === "library" || from === "hand") && (p[from] as ObjId[]).includes(o.id) && baseChoices(r, o, a.player, from).length > 0);
  if (!zoneOk) throw new Reject("not_in_zone", `${label(r, o.id)} cannot be cast from ${o.zone} by ${a.player}`);
  const def = defOf(r, o)!;
  const c = chars(r, o.id);
  if (c.types.includes("land")) throw new Reject("not_castable", "lands are played, not cast");
  if (playerCantCast(r, a.player)) throw new Reject("wrong_timing", `${a.player} can't cast spells right now`);
  assertSupported(r, o);
  // double-faced cards: a preset face is validated now; with several castable faces and none given, the draft asks and re-checks the timing for the chosen one
  const faces = castableFaces(def);
  if (a.face !== undefined) { if (!faces.includes(a.face)) throw new Reject("invalid_choice", `"${a.face}" is not a face of ${def.name} that can be cast (${faces.join(", ")})`); o.face = a.face; }
  const deferTiming = faces.length > 1 && a.face === undefined;
  if (!deferTiming) checkSpellTiming(r, o, a.player, from);
  const spellAbility = printedAbilities(r, o).find((x) => x.kind === "spell_effect");

  const permSnap = permissionOptions(r, o); // read BEFORE the card moves: a permission names the object as it is now
  const index = (p[from as "hand" | "command"] as ObjId[]).indexOf(o.id);
  const faceChosen = a.face !== undefined || faces.length <= 1;
  (p[from as "hand" | "command"] as ObjId[]).splice(index, 1);
  void permitted;
  o.zone = "stack"; o.timestamp = tick(r);
  const draft: Draft = {
    kind: "spell", player: a.player, sourceId: o.id, objectId: o.id, abilityId: spellAbility?.id ?? "",
    cast: { turn: r.s.turn.number, phase: r.s.turn.phase, activePlayer: r.s.turn.active, from, caster: a.player },
    origin: { zone: from, index }, payWith: a.payWith, autoPay: a.autoPay, permSnap, faceDone: faceChosen
  };
  if (a.x !== undefined) { draft.x = a.x; draft.xChosen = true; }
  if (a.phyrexian) draft.phyPreset = [...a.phyrexian];
  if (a.improvise) draft.improvisePreset = [...a.improvise];
  { const g = peekNextSpellGrants(r, a.player); if (g.length) { draft.grants = g; o.castGrants = g; } }
  presetOptions(r, draft, o, a);
  preapply(r, draft, a);
  startDraft(r, draft, true);
}

/** castSpell shortcuts for the option stage: validated exactly like answers. */
function presetOptions(r: Run, d: Draft, card: GameObject, a: Extract<Action, { type: "castSpell" }>): void {
  const origin = d.origin!.zone;
  if (a.option !== undefined) {
    const bases = baseChoices(r, card, d.player, origin, d.permSnap);
    const hit = bases.find((b) => (b ? b.id : "normal") === (a.option === "" ? "normal" : a.option));
    if (!hit && hit !== null) throw new Reject("invalid_choice", `"${a.option}" is not a legal way to cast this spell (${bases.map((b) => (b ? b.id : "normal")).join(", ")})`);
    d.castBase = hit ? hit.id : ""; d.castBaseDone = true;
  }
  if (a.extras !== undefined) {
    const legal = optionalExtras(r, card, d.player, origin).map((c) => c.id);
    for (const id of a.extras) if (!legal.includes(id)) throw new Reject("invalid_choice", `"${id}" is not an optional cost of this spell (${legal.join(", ") || "none"})`);
    if (new Set(a.extras).size !== a.extras.length) throw new Reject("invalid_choice", "optional costs must be distinct");
    d.castExtras = [...a.extras]; d.castExtrasDone = true;
  }
}

function checkSpellTiming(r: Run, o: GameObject, pid: PlayerId, from: string): void {
  if (r.ignoreTiming) return;
  const c = chars(r, o.id);
  const spellAbility = printedAbilities(r, o).find((x) => x.kind === "spell_effect");
  const instantSpeed = c.types.includes("instant") || c.keywords.includes("flash") || flashGrantCovers(r, pid, o.id) || spellAbility?.timing?.speed === "instant" || spellAbility?.timing?.speed === "flash";
  if (!instantSpeed && !(r.s.turn.active === pid && MAIN.includes(r.s.turn.phase) && (r.s.stack.length === 0 || (o.zone === "stack" && r.s.stack.length === 0)))) throw new Reject("wrong_timing", `${c.name} can only be cast during your main phase with an empty stack`);
  const q: QCtx = { controller: pid, source: o.id };
  for (const pr of spellAbility?.timing?.only ?? []) if (!evalPredicate(r, pr, { ...q, cast: { turn: r.s.turn.number, phase: r.s.turn.phase, activePlayer: r.s.turn.active, from: from as never, caster: pid } })) throw new Reject("wrong_timing", `${c.name}: timing restriction not met`);
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
      const pb = targetBounds(r, spec, targetCtx(d), cands.length);
      if (ids.length < pb.min || ids.length > totalMax(r, spec, targetCtx(d), cands.length)) throw new Reject("illegal_target", `${specId}: choose ${pb.min}-${pb.max} target(s)`);
      for (const id of ids) if (!cands.includes(id)) throw new Reject("illegal_target", `${label(r, id)} is not a legal target for ${specId}`);
      part.targets[specId] = ids;
    }
  }
}

function activateAbility(r: Run, a: Extract<Action, { type: "activateAbility" }>): void {
  const src = r.s.objects[a.sourceId];
  if (!src) throw new Reject("unknown_object", `unknown object ${a.sourceId}`);
  const inPlay = src.zone === "battlefield";
  // on the battlefield the controller activates; an ability that works from your hand / graveyard (cycling, channel) is activated by the owner of the card
  if (inPlay ? src.controller !== a.player : src.owner !== a.player || !["hand", "graveyard", "exile", "command"].includes(src.zone)) throw new Reject("not_owner", `${a.player} does not control ${label(r, src.id)} (it is in ${src.zone})`);
  const ab = abilitiesOf(r, src).find((x) => x.id === a.abilityId);
  if (!ab) throw new Reject("unknown_ability", `${label(r, src.id)} has no ability ${a.abilityId}`);
  if (ab.kind !== "activated" && ab.kind !== "mana") throw new Reject("cannot_activate", `${a.abilityId} is not an activated ability`);
  if ((ab.zone ?? "battlefield") !== src.zone) throw new Reject("cannot_activate", `${a.abilityId} can only be activated from ${ab.zone ?? "the battlefield"}, not from ${src.zone}`);
  assertSupported(r, src, ab);
  if (ab.kind === "mana") return activateMana(r, a.player, src, ab, a.color);
  if (ab.scripted?.handler === "crew") return activateCrew(r, a, src, ab);
  const loyalty = (ab.costs ?? []).some((c) => "loyalty" in c);
  if (loyalty) {
    // 606.3: loyalty abilities are sorcery speed and only one per planeswalker each turn
    if (!chars(r, src.id).types.includes("planeswalker")) throw new Reject("cannot_activate", "only planeswalkers have loyalty abilities");
    if (!inMainWithEmptyStack(r, a.player)) throw new Reject("wrong_timing", "loyalty abilities can only be activated at sorcery speed");
    if (r.s.activations[`t:${src.id}:loyalty`]) throw new Reject("cannot_activate", `${label(r, src.id)} already activated a loyalty ability this turn`);
  }
  if (ab.timing?.speed === "sorcery" && !inMainWithEmptyStack(r, a.player)) throw new Reject("wrong_timing", "this ability can only be activated at sorcery speed");
  for (const pr of ab.timing?.only ?? []) if (!evalPredicate(r, pr, { controller: a.player, source: src.id })) throw new Reject("wrong_timing", "timing restriction not met");
  const draft: Draft = { kind: "activated", player: a.player, sourceId: src.id, abilityId: ab.id, payWith: a.payWith, autoPay: a.autoPay, ...(a.phyrexian ? { phyPreset: [...a.phyrexian] } : {}) };
  if (a.x !== undefined) { draft.x = a.x; draft.xChosen = true; }
  preapply(r, draft, a);
  startDraft(r, draft, true);
}

/**
 * Crew N (Vehicles): tap any number of untapped creatures you control with total power N or more, then the ability (the card's own steps: it becomes
 * an artifact creature until end of turn) goes on the stack. The tapping is the cost, chosen before the ability is put on the stack; tapping for a
 * cost ignores summoning sickness (302.6 only restricts the {T} symbol of the permanent itself).
 */
function activateCrew(r: Run, a: Extract<Action, { type: "activateAbility" }>, src: GameObject, ab: Ability, answer?: Choice): void {
  const n = Number(ab.keyword?.param ?? 0);
  const cands = r.s.battlefield.filter((id) => id !== src.id && r.s.objects[id].controller === a.player && !r.s.objects[id].tapped && chars(r, id).types.includes("creature"));
  const power = (id: ObjId) => Math.max(0, chars(r, id).power ?? 0);
  if (cands.reduce((s, id) => s + power(id), 0) < n) throw new Reject("cannot_activate", `not enough creatures to crew ${label(r, src.id)} (total power ${n} needed)`);
  const spec: AskSpec = { kind: "choose_cards", player: a.player, prompt: ab.prompt ?? { title: `${label(r, src.id)}: crew ${n}`, instruction: `Choose untapped creatures you control with total power ${n} or more to tap.` }, options: costOptions(r, cands), min: 1, max: cands.length };
  const dec = decide(spec, answer);
  if ("ask" in dec) { setPending(r, dec.ask, { t: "draft", stage: "crew", draft: { kind: "activated", player: a.player, sourceId: src.id, abilityId: ab.id, payWith: a.payWith, autoPay: a.autoPay } }, true); return; }
  if (dec.ids.reduce((s, id) => s + power(id), 0) < n) throw new Reject("invalid_choice", `the chosen creatures have total power ${dec.ids.reduce((s, id) => s + power(id), 0)}, crew ${n} needs ${n}`);
  for (const id of dec.ids) { r.s.objects[id].tapped = true; emit(r, { type: "tap", id, player: a.player }); }
  emit(r, { type: "crewed", id: src.id, by: dec.ids });
  startDraft(r, { kind: "activated", player: a.player, sourceId: src.id, abilityId: ab.id, payWith: a.payWith, autoPay: a.autoPay }, true);
}

function activateMana(r: Run, pid: PlayerId, src: GameObject, ab: Ability, color?: string, answer?: Choice, savedChoices?: Record<number, ObjId[]>): void {
  if (!manaAbilityActivatable(r, src, ab)) throw new Reject("cannot_activate", `${label(r, src.id)} cannot produce mana right now (tapped or summoning sick)`);
  // costs that need a choice ("Sacrifice a creature"): asked before anything is paid, like any activated ability
  const choices: Record<number, ObjId[]> = { ...(savedChoices ?? {}) };
  const costs = ab.costs ?? [];
  for (const [i, c] of costs.entries()) {
    if (!needsChoice(c) || i in choices) continue;
    const cx = { player: pid, source: src.id, x: 0 };
    const cands = costCandidates(r, c, cx), n = costCount(r, c, cx);
    if (cands.length < n) throw new Reject("cannot_activate", `nothing to ${costNoun(c)} for ${label(r, src.id)}`);
    if (cands.length === n) { choices[i] = [...cands]; continue; }
    const spec: AskSpec = { kind: "choose_cards", player: pid, prompt: (c as { prompt?: Prompt }).prompt ?? { title: `${label(r, src.id)}: choose`, instruction: `Choose ${n} to ${costNoun(c)}.` }, options: costOptions(r, cands), min: n, max: n };
    const dec = decide(spec, answer);
    if ("ask" in dec) { setPending(r, dec.ask, { t: "draft", stage: "color", draft: { kind: "activated", player: pid, sourceId: src.id, abilityId: ab.id, costChoices: choices } }, true); return; }
    answer = undefined;
    choices[i] = dec.ids;
  }
  const prod = productionOfAbility(r, pid, ab);
  let colors: string[];
  const askDraft = { t: "draft" as const, stage: "color" as const, draft: { kind: "activated" as const, player: pid, sourceId: src.id, abilityId: ab.id, costChoices: choices } };
  if ("fixed" in prod) colors = prod.fixed;
  else if ("alternatives" in prod) {
    // "Add {W}{W}, {W}{B}, or {B}{B}": the player picks one whole alternative
    let pick = color;
    if (!pick) {
      const spec: AskSpec = { kind: "choose_option", player: pid, prompt: { title: `${label(r, src.id)}: choose the mana`, instruction: "Choose which mana to add." }, options: prod.alternatives.map((alt) => ({ id: alt.join(""), label: alt.join("") })), min: 1, max: 1 };
      const dec = decide(spec, answer);
      if ("ask" in dec) { setPending(r, dec.ask, askDraft, true); return; }
      pick = dec.ids[0];
    }
    const alt = prod.alternatives.find((x) => x.join("") === pick);
    if (!alt) throw new Reject("invalid_choice", `${pick} is not something ${label(r, src.id)} can produce`);
    colors = alt;
  } else {
    let pick = color;
    if (!pick) {
      const spec: AskSpec = { kind: "choose_color", player: pid, prompt: { title: `${label(r, src.id)}: choose a color`, instruction: "Choose the color of mana to add." }, options: prod.choose.options.map((c) => ({ id: c, label: c })), min: 1, max: 1 };
      const dec = decide(spec, answer);
      if ("ask" in dec) { setPending(r, dec.ask, askDraft, true); return; }
      pick = dec.ids[0];
    }
    if (!prod.choose.options.includes(pick as never)) throw new Reject("invalid_choice", `${pick} is not a legal color for ${label(r, src.id)}`);
    colors = Array.from({ length: prod.choose.count }, () => pick!);
  }
  // a mana COST on the ability ("{W/B}, {T}: Add ..."): paid first, from the pool or by tapping other sources (never this one)
  for (const c of costs) if ("mana" in c) {
    const { cost, life } = settleCost(r, pid, parseManaCost(c.mana));
    const sctx = { abilitySource: src.id, spent: [] as never[] };
    if (life > 0 && player(r, pid).life < life) throw new Reject("cannot_pay", "not enough life to pay the Phyrexian mana");
    if (!payFromPool(r, pid, cost, 0, sctx) && !(autoTapFor(r, pid, cost, 0, undefined, [src.id], sctx) && payFromPool(r, pid, cost, 0, sctx))) throw new Reject("cannot_pay", "cannot pay the mana cost of this mana ability");
    if (life > 0) changeLife(r, undefined, pid, -life);
  }
  for (const [i, c] of costs.entries()) if (needsChoice(c)) payChoiceCost(r, c as ChoiceCost, choices[i], { player: pid, source: src.id, x: 0 });
  payManaAbilityCosts(r, src, ab, pid);
  if (prod.props) addUnits(r, pid, colors as never, prod.props, src.id); else addMana(r, pid, costs.some((c) => "tap" in c) ? withTapBonus(r, pid, colors as never) : (colors as never), src.id);
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
  const landPerm = permissionsFor(r, o, a.player).find((d) => d.permission!.allow.includes("land"));
  if (o.owner !== a.player && !landPerm) throw new Reject("not_owner", `${a.player} does not own ${label(r, o.id)}`);
  const p = player(r, a.player);
  if (!landPerm && (o.zone !== "hand" || !p.hand.includes(o.id))) throw new Reject("not_in_zone", `${label(r, o.id)} is not in ${a.player}'s hand`);
  if (a.face !== undefined) { if (!faceNames(defOf(r, o)!).includes(a.face)) throw new Reject("invalid_choice", `"${a.face}" is not a face of ${label(r, o.id)}`); o.face = a.face; }
  if (!chars(r, o.id).types.includes("land")) throw new Reject("not_castable", `${label(r, o.id)} is not a land`);
  if (!r.ignoreTiming && !inMainWithEmptyStack(r, a.player)) throw new Reject("wrong_timing", "lands can only be played during your main phase with an empty stack");
  if (p.landsPlayed >= landDrops(r, a.player)) throw new Reject("land_limit", "you already played a land this turn");
  assertSupported(r, o);
  p.landsPlayed++;
  if (landPerm) consumePermission(r, landPerm.id);
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
  r.s.lki = { ...(item.costLki ?? {}) }; // what was sacrificed as a cost is still known ("its power")
  if (item.trigger?.lki && item.trigger.eventObj) r.s.lki[item.trigger.eventObj] = item.trigger.lki; // the object that left / died: "if it had counters", "put those counters"
  const src = tryObj(r, item.sourceId);
  r.s.priorityAfter = null;
  const ok = legalizeTargets(r, item);
  if (!ok) {
    emit(r, { type: "spell_fizzled", id: item.objectId ?? item.sourceId, kind: item.kind });
    if (item.kind === "spell" && src) moveObject(r, src.id, "graveyard");
    finish(r); return;
  }
  const ab = src ? abilitiesOf(r, src).find((a) => a.id === item.abilityId) : undefined;
  if (item.kind === "triggered" && ab?.trigger?.interveningIf && !evalPredicate(r, ab.trigger.interveningIf, { controller: item.controller, source: item.sourceId, eventObj: item.trigger?.eventObj, eventPlayer: item.trigger?.eventPlayer, cast: item.cast, x: item.x })) {
    emit(r, { type: "trigger_fizzled", source: item.sourceId }); finish(r); return;
  }
  if (item.kind === "spell") {
    const c = chars(r, src!.id);
    const permanent = ["creature", "artifact", "enchantment", "planeswalker", "land", "battle"].some((t) => c.types.includes(t));
    emit(r, { type: "spell_resolving", id: src!.id, player: item.controller });
    if (permanent) {
      const aura = c.subtypes.some((s) => s.toLowerCase() === "aura");
      const host = aura ? item.parts.flatMap((p) => Object.values(p.targets).flat()).find((x) => isObjId(x)) : undefined;
      const moved = moveObject(r, src!.id, "battlefield", { controller: item.controller });
      const h = host ? r.s.objects[host] : undefined;
      if (moved && h && h.zone === "battlefield") { moved.attachedTo = h.id; moved.attachedToTs = h.timestamp; emit(r, { type: "attached", id: moved.id, to: h.id }); }
      emit(r, { type: "spell_resolved", id: src!.id, player: item.controller });
      // evoke: when the permanent enters, a trigger sacrifices it
      if (moved && moved.zone === "battlefield" && (item.cast?.paid ?? []).includes("evoke")) {
        r.s.triggerQueue.push({ id: `q${r.s.nextId++}`, sourceId: moved.id, abilityId: "__evoke", controller: item.controller, ctx: {}, label: `${label(r, moved.id)}: evoke sacrifice`, delayed: { steps: [{ kind: "sacrifice_permanent", target: "self" } as Step], targets: {} } });
      }
      finish(r); return;
    }
  }
  if (ab?.scripted?.handler === "become_monarch") { r.s.monarch = item.controller; emit(r, { type: "monarch_changed", player: item.controller }); }
  if (ab?.scripted?.handler === "roll_d20_result_is_X") {
    // "roll a d20. ... a number equal to the result": the roll uses the seeded RNG in the state (replayable) and becomes X for the steps
    const sides = Number((ab.scripted.params as { sides?: number } | undefined)?.sides ?? 20);
    const result = randInt(r, sides) + 1;
    item.x = result;
    emit(r, { type: "die_rolled", player: item.controller, sides, result, source: item.sourceId });
  }
  // a one-shot shield written on a spell / activated ability ("Prevent all combat damage that would be dealt this turn"): it starts when the ability resolves
  if (ab?.replacement && ab.kind !== "replacement") addDurable(r, { owner: item.controller, source: item.sourceId, expires: expiryFor(r, "until_end_of_turn", item.controller), replacement: { ...ab.replacement, duration: undefined } });
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
  if (runCastNow(r)) return;
  finish(r);
}

function advanceStep(r: Run): void {
  const cur = r.s.turn.phase;
  if (cur === "end_of_combat") {
    r.s.combat = null;
    if (r.s.extraCombats > 0) { r.s.extraCombats--; enterStep(r, "beginning_of_combat"); return; }
  }
  const idx = STEP_ORDER.indexOf(cur);
  if (cur === "cleanup" || idx === STEP_ORDER.length - 1) { startNextTurn(r); return; }
  enterStep(r, STEP_ORDER[idx + 1]);
}

function startNextTurn(r: Run): void {
  const extra = (r.s.extraTurns ??= []).pop();
  const next = (extra && r.s.players.find((p) => p.id === extra && !p.hasLost)) || nextPlayer(r, r.s.turn.active);
  r.s.turn = { number: r.s.turn.number + 1, active: next.id, phase: "untap" };
  r.s.turnLog = [];
  r.s.combat = null; r.s.extraCombats = 0;
  expireDurable(r, "turn_start");
  for (const k of Object.keys(r.s.activations)) if (k.startsWith("t:")) delete r.s.activations[k];
  emit(r, { type: "turn_started", turn: r.s.turn.number, player: next.id });
  enterStep(r, "untap", true);
}

function clearPools(r: Run, all = false): void { emptyPools(r, all); }

function enterStep(r: Run, step: Phase, turnStart = false): void {
  if (step === "first_strike_damage" && !anyFirstStrike(r)) { enterStep(r, "combat_damage"); return; } // 510.4: the extra step only exists when a first or double striker is in combat
  clearPools(r, step === "cleanup");
  r.s.turn.phase = step;
  const active = player(r, r.s.turn.active);
  emit(r, { type: "phase_changed", phase: step, player: active.id });
  if (step === "untap") {
    active.lastTurnStartTs = tick(r);
    active.landsPlayed = 0;
    // Unwinding Clock: its controller's artifacts also untap during each OTHER player's untap step
    for (const id of r.s.battlefield) { const o = r.s.objects[id]; if (o.controller !== active.id && o.tapped && chars(r, id).types.includes("artifact") && r.s.battlefield.some((cid) => r.s.objects[cid].controller === o.controller && abilitiesOf(r, r.s.objects[cid]).some((a) => a.scripted?.handler === "untap_during_each_other_players_untap_step"))) { o.tapped = false; emit(r, { type: "untap", id }); } }
    for (const id of r.s.battlefield) { const o = r.s.objects[id]; if (o.controller === active.id && o.tapped && !chars(r, id).keywords.includes("doesn't untap during its controller's untap step")) { o.tapped = false; emit(r, { type: "untap", id }); } }
    void turnStart;
    enterStep(r, "upkeep"); return;
  }
  if (step === "cleanup") { cleanup(r); return; }
  if (step === "end_step") expireDurable(r, "end_step");
  if (step === "draw") {
    const skip = r.s.config.skipFirstDraw && r.s.turn.number === 1;
    if (!skip) drawCards(r, active.id, 1);
  }
  if (step === "beginning_of_combat") r.s.combat = newCombat();
  if (step === "declare_attackers") {
    const combat = (r.s.combat ??= newCombat());
    if (!legalAttackers(r, active.id).length) { enterStep(r, "end_of_combat"); return; } // nothing could attack: no declaration, no blockers, no damage
    combat.expect = { kind: "attackers", player: active.id };
    r.s.priority = null; r.s.passes = [];
    return;
  }
  if (step === "declare_blockers") {
    const combat = (r.s.combat ??= newCombat());
    const defenders = blockersToDeclare(r, apnap(r).map((p) => p.id));
    if (defenders.length) { combat.expect = { kind: "blockers", players: defenders }; r.s.priority = null; r.s.passes = []; return; }
  }
  if (step === "first_strike_damage") { runDamage(r, "first", {}); return; }
  if (step === "combat_damage") { runDamage(r, "regular", {}); return; }
  openPriority(r, step);
}

function cleanup(r: Run): void {
  const active = player(r, r.s.turn.active);
  const excess = hasFlag(r, active.id, "no_max_hand_size") || playerHas(r, active.id, "no maximum hand size") ? 0 : active.hand.length - r.s.config.handSize;
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
  for (const id of r.s.battlefield) { r.s.objects[id].damage = 0; r.s.objects[id].dtHit = undefined; }
  r.s.effects = r.s.effects.filter((e) => e.until !== "end_of_turn");
  for (const id of r.s.battlefield) { const o = r.s.objects[id]; if (o.copyUntilEot) { o.copyDef = undefined; o.copyUntilEot = undefined; invalidateIndex(r); } } // "becomes a copy until end of turn" ends
  expireDurable(r, "cleanup");
  clearRegenShields(r);
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
      if (ctx.stage === "crew") {
        const src = obj(r, d.sourceId);
        const ab = abilitiesOf(r, src).find((x) => x.id === d.abilityId)!;
        activateCrew(r, { type: "activateAbility", player: d.player, sourceId: d.sourceId, abilityId: d.abilityId, payWith: d.payWith, autoPay: d.autoPay }, src, ab, choice);
        return;
      }
      if (ctx.stage === "color") {
        const src = obj(r, d.sourceId);
        const ab = abilitiesOf(r, src).find((x) => x.id === d.abilityId)!;
        activateMana(r, d.player, src, ab, undefined, choice, d.costChoices);
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
    case "combat_damage": {
      const am = pend.amounts!;
      const asg = checkAssignment({ ...am, options: pend.options.map((o) => o.id) }, choice);
      runDamage(r, ctx.which, { ...ctx.assigned, [ctx.attacker]: asg });
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
      const cmdr = overCommanderLimit(r, p.id);
      if (!p.hasLost && (p.life <= 0 || p.drewFromEmpty || cmdr) && !playerHas(r, p.id, "can't lose the game")) {
        p.hasLost = true; changed = true;
        emit(r, { type: "player_lost", player: p.id, reason: p.life <= 0 ? "life" : p.drewFromEmpty ? "empty_library" : "commander_damage" });
      }
    }
    // commander in the graveyard / exile: its owner may put it into the command zone (704.6d); asked once, remembered when declined
    for (const p of r.s.players) for (const id of [...p.graveyard, ...p.exile]) {
      const o = r.s.objects[id];
      if (o?.isCommander && !o.commanderDeclined && !p.hasLost) {
        if (askCommandZone(r, o, o.zone)) { moveObject(r, id, "command"); emit(r, { type: "commander_to_command_zone", id }); changed = true; }
        else o.commanderDeclined = true;
      }
    }
    // creatures that die TOGETHER all still see each other's replacement effects (Kalitas exiles what dies in the same combat as Kalitas): the holders of a replacement ability are checked last
    const holdsReplacement = (id: ObjId): boolean => abilitiesOf(r, r.s.objects[id]).some((a) => a.kind === "replacement");
    for (const id of [...r.s.battlefield].sort((a, b) => Number(holdsReplacement(a)) - Number(holdsReplacement(b)))) {
      const o = r.s.objects[id];
      if (!o || o.zone !== "battlefield") continue;
      const c = chars(r, id);
      if (c.subtypes.some((s) => s.toLowerCase() === "aura") && !hostOf(r, o)) { moveObject(r, id, "graveyard"); emit(r, { type: "sba_aura_unattached", id }); changed = true; continue; }
      if (unattachIllegal(r, o)) changed = true; // equipment whose host is gone or is no longer a creature (704.5n)
      if (c.types.includes("planeswalker") && (o.counters.loyalty ?? 0) <= 0) { moveObject(r, id, "graveyard"); emit(r, { type: "sba_zero_loyalty", id }); changed = true; continue; }
      if (c.subtypes.some((s) => s.toLowerCase() === "saga") && sagaDone(r, o)) { sacrificeObject(r, id); emit(r, { type: "sba_saga_done", id }); changed = true; continue; } // 714.4: the final chapter ability has left the stack
      if (c.types.includes("battle") && (o.counters.defense ?? 0) <= 0) { moveObject(r, id, "graveyard"); emit(r, { type: "sba_zero_defense", id }); changed = true; continue; }
      if (!c.types.includes("creature") || c.toughness === undefined) continue;
      if (c.toughness <= 0) { moveObject(r, id, "graveyard"); emit(r, { type: "sba_zero_toughness", id }); changed = true; }
      else if (o.damage >= c.toughness || (o.dtHit && o.damage > 0)) { if (destroyBySba(r, id)) changed = true; }
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

/** Saga rules (714): the highest chapter number among its chapter abilities, reached by lore counters and with none of its chapter triggers waiting or on the stack. */
function sagaDone(r: Run, o: GameObject): boolean {
  const chapters = abilitiesOf(r, o).filter((a) => a.kind === "triggered" && a.trigger?.chapters).flatMap((a) => a.trigger!.chapters!);
  if (!chapters.length || (o.counters.lore ?? 0) < Math.max(...chapters)) return false;
  return !r.s.triggerQueue.some((t) => t.sourceId === o.id) && !r.s.stack.some((i) => i.sourceId === o.id && i.kind === "triggered");
}

function destroyBySba(r: Run, id: ObjId): boolean {
  if (chars(r, id).keywords.includes("indestructible")) return false;
  if (regenerates(r, id)) return false;
  emit(r, { type: "destroyed", id, lethalDamage: true });
  moveObject(r, id, "graveyard");
  return true;
}

// ================================================================ triggers

function lkiMatches(f: ObjectFilter, l: Lki, q: QCtx, id: string): boolean {
  for (const k of Object.keys(f)) if (!["types", "notTypes", "subtypes", "controller", "owner", "token", "another", "named", "hasCounter", "zone"].includes(k)) throw new Unsupported(`filter:${k}@leaves_battlefield`);
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
  if (f.hasCounter && !((f.hasCounter === "any" ? Object.values(l.counters ?? {}).reduce((a, b) => a + b, 0) : (l.counters ?? {})[f.hasCounter]) > 0)) return false;
  return true;
}

function queueTrigger(r: Run, src: ObjId, ab: Ability, controller: PlayerId, ctx: TriggerContext): void {
  const needs = abilityUnsupported(ab);
  if (needs.length) {
    if (r.s.config.lenient) { emit(r, { type: "unsupported_ignored", source: src, ability: ab.id, needs }); return; }
    throw new Unsupported(needs[0], `${label(r, src)}: triggered ability ${ab.id} needs ${needs.join(", ")}`, needs);
  }
  const q: QCtx = { controller, source: src, eventObj: ctx.eventObj, eventPlayer: ctx.eventPlayer, cast: ctx.cast, x: ctx.x };
  if (ab.trigger?.interveningIf && !evalPredicate(r, ab.trigger.interveningIf, q)) return;
  r.s.triggerQueue.push({ id: `q${r.s.nextId++}`, sourceId: src, abilityId: ab.id, controller, ctx, label: `${label(r, src)}: ${ab.text.replace(/\s+/g, " ").slice(0, 80)}` });
}

/** Trigger alternatives of one ability: the main event plus every "alsoOn" event (omitted qualifiers are inherited). */
function triggerAlternatives(tr: TriggerSpec): TriggerSpec[] {
  const out: TriggerSpec[] = [tr];
  for (const alt of tr.alsoOn ?? []) out.push({ ...tr, ...Object.fromEntries(Object.entries(alt).filter(([, v]) => v !== undefined)), alsoOn: undefined } as TriggerSpec);
  return out;
}

/** Which trigger event names an engine event can fire. */
function triggerNames(ev: GameEvent & Record<string, unknown>): string[] {
  if (SIMPLE_EVENTS[ev.type]) return [SIMPLE_EVENTS[ev.type]];
  if (ev.type === "damage") return ["deals_damage", "dealt_damage", ...(ev.combat && !isObjId(ev.target as string) ? ["deals_combat_damage_to_player"] : [])];
  return [ev.type];
}

/** Does this combat / damage event fire the trigger `tr` of holder `h`? Returns the trigger's context. */
function matchCombat(r: Run, tr: TriggerSpec, h: { id: ObjId; controller: PlayerId }, ev: GameEvent & Record<string, unknown>): TriggerContext | null {
  const q: QCtx = { controller: h.controller, source: h.id };
  let actor: string | undefined, actorCtl: PlayerId | undefined;
  if (tr.event === "attack" || tr.event === "block") { actor = ev.id as string; actorCtl = ev.player as string; }
  else if (tr.event === "deals_damage" || tr.event === "deals_combat_damage_to_player") { actor = ev.source as string | undefined; actorCtl = actor && tryObj(r, actor) ? obj(r, actor).controller : undefined; }
  else { actor = ev.target as string; actorCtl = isObjId(actor) ? tryObj(r, actor)?.controller : actor; } // dealt_damage
  if (!actor) return null;
  const s = tr.subject;
  let ok: boolean;
  if (s === undefined) ok = tr.whose ? tr.whose === "each" || (tr.whose === "yours") === (actorCtl === h.controller) : actor === h.id;
  else if (s === "self") ok = actor === h.id;
  else if (s === "you") ok = actorCtl === h.controller;
  else if (s === "each_player") ok = true;
  else if (s === "opponent" || s === "each_opponent") ok = actorCtl !== undefined && actorCtl !== h.controller;
  else if (s === "enchanted" || s === "equipped") { const ho = obj(r, h.id); const host = hostOf(r, ho); ok = !!host && host.id === actor; }
  else if (typeof s === "object") ok = isObjId(actor) && !!tryObj(r, actor) && matchesFilter(r, actor, s as ObjectFilter, q);
  else throw new Unsupported(`trigger:subject:${String(s)}`);
  if (!ok) return null;
  if (tr.event === "attack" && tr.defender) {
    const d = ev.defender as string;
    const mine = d === h.controller || (isObjId(d) && tryObj(r, d)?.controller === h.controller);
    if (tr.defender === "you" ? d !== h.controller : tr.defender === "you_or_your_planeswalkers" ? !mine : mine) return null;
  }
  if (tr.damageSource) {
    const src = ev.source as string | undefined;
    if (!src || !isObjId(src) || !tryObj(r, src) || !matchesFilter(r, src, tr.damageSource, q)) return null;
  }
  if (tr.event === "attack") return { eventObj: ev.id as string, eventPlayer: ev.defendingPlayer as string | undefined };
  if (tr.event === "block") return { eventObj: ev.id as string, eventPlayer: ev.player as string };
  const target = ev.target as string;
  return { eventObj: ev.source as string | undefined, eventPlayer: isObjId(target) ? tryObj(r, target)?.controller : target, amount: ev.amount as number };
}

const SCANNED_EVENTS = new Set(["etb", "dies", "cast", "begin_step", "attack", "block", "damage", "cycle", "leaves", "becomes_target", ...Object.keys(SIMPLE_EVENTS)]);

function scanTriggers(r: Run): void {
  const scanWindow = r.scanned;
  while (r.scanned < r.events.length) {
    const evIdx = r.scanned;
    const ev = r.events[r.scanned++] as GameEvent & Record<string, unknown>;
    if (!SCANNED_EVENTS.has(ev.type)) continue;
    fireDelayed(r, ev, evIdx);
    // Saga: as it enters it gets a lore counter (chapter I triggers off it)
    if (ev.type === "etb" && r.s.objects[ev.id as string]?.zone === "battlefield" && chars(r, ev.id as string).subtypes.some((s) => s.toLowerCase() === "saga")) addCounters(r, [ev.id as string], "lore", 1);
    const names = triggerNames(ev);
    const holders: Array<{ id: ObjId; controller: PlayerId; lki?: boolean }> = r.s.battlefield.map((id) => ({ id, controller: r.s.objects[id].controller }));
    for (const p of r.s.players) for (const id of p.command) if (r.s.objects[id]?.token) holders.push({ id, controller: r.s.objects[id].controller }); // emblems: their abilities work from the command zone
    if (ev.type === "cast" && r.s.objects[ev.id as string]?.zone === "stack" && !holders.some((h) => h.id === ev.id)) holders.push({ id: ev.id as string, controller: ev.player as string }); // "when you cast this spell" (abilities that work on the stack)
    if (ev.type === "cycle" && r.s.objects[ev.id as string] && !holders.some((h) => h.id === ev.id)) holders.push({ id: ev.id as string, controller: ev.player as string }); // "When you cycle this card": it is in the graveyard by now
    if (ev.type === "leaves" && r.s.objects[ev.id as string] && !holders.some((h) => h.id === ev.id)) holders.push({ id: ev.id as string, controller: (ev.lki as Lki).controller, lki: true });
    if (ev.type === "dies") {
      const l = ev.lki as Lki;
      if (!holders.some((h) => h.id === ev.id) && r.s.objects[ev.id as string]) holders.push({ id: ev.id as string, controller: l.controller, lki: true });
    }
    if (ev.type === "damage" && ev.source && isObjId(ev.source as string)) {
      const sid = ev.source as string;
      if (!holders.some((h) => h.id === sid) && r.s.objects[sid]?.zone !== "battlefield" && r.s.objects[sid]) holders.push({ id: sid, controller: r.s.lki[sid]?.controller ?? r.s.objects[sid].controller, lki: true });
    }
    for (const h of holders) {
      const o = r.s.objects[h.id];
      if (!o) continue;
      for (const ab of abilitiesOf(r, o)) {
        if (ab.kind !== "triggered" || !ab.trigger) continue;
        if (ab.scripted?.handler === "tapped_for_mana" && !ev.forMana) continue; // Treasure Nabber: only a tap made to pay a MANA ability counts
        if (ab.scripted?.handler === "tapped_for_colorless_mana") continue; // Forsaken Monument: not a stack trigger, mana.ts adds the extra {C} when the permanent is tapped for mana
        if (!(h.lki || (ab.zone ?? "battlefield") === o.zone || (ev.type === "cycle" && ab.zone === "hand" && o.id === ev.id))) continue;
        for (const tr of triggerAlternatives(ab.trigger)) {
          if (!SUPPORTED_TRIGGER_EVENTS.has(tr.event) || !names.includes(tr.event)) continue;
          if (r.s.config.mirrorHeadless?.skipTriggerEvents.includes(tr.event)) { emit(r, { type: "trigger_suppressed", source: h.id, event: tr.event }); continue; }
          const q: QCtx = { controller: h.controller, source: h.id };
          const subject = tr.subject;
          let match = false;
          let ctx: TriggerContext = {};
          if (ev.type === "etb") {
            const eid = ev.id as string;
            match = subject === undefined || subject === "self" ? eid === h.id : typeof subject === "object" && matchesFilter(r, eid, subject as ObjectFilter, q);
            if (match && tr.fromZone && tr.fromZone !== ev.from) match = false; // "entered from a graveyard"
            ctx.eventObj = eid; ctx.eventPlayer = ev.player as string;
          } else if (ev.type === "dies") {
            const eid = ev.id as string, l = ev.lki as Lki;
            match = subject === undefined || subject === "self" ? eid === h.id : subject === "enchanted" || subject === "equipped" ? obj(r, h.id).attachedTo === eid : typeof subject === "object" && lkiMatches(subject as ObjectFilter, l, q, eid); // enchanted / equipped: still attached when it left (SBA unattach runs after the trigger scan)
            ctx.eventObj = eid; ctx.eventPlayer = l.controller; ctx.lki = l;
          } else if (ev.type === "cast") {
            const who = ev.player as string;
            // no subject: "Whenever an opponent casts their first spell each turn" names only WHO casts (trigger.whose), any spell counts
            if (subject === undefined && !tr.whose) throw new Unsupported("trigger:cast_without_subject", `${label(r, h.id)}: cast trigger needs a subject or a "whose"`);
            if (subject === undefined) match = tr.whose === "each" || (tr.whose === "yours") === (who === h.controller);
            else if (subject === "each_player") match = true;
            else if (subject === "self") match = ev.id === h.id;
            else if (subject === "you") match = who === h.controller;
            else if (subject === "opponent" || subject === "each_opponent") match = who !== h.controller;
            else if (typeof subject === "object") match = matchesFilter(r, ev.id as string, subject as ObjectFilter, q);
            else throw new Unsupported(`trigger:subject:${String(subject)}`);
            if (match && tr.nth) match = r.s.turnLog.filter((e) => e.type === "cast" && e.player === who).length === tr.nth.n;
            ctx.eventObj = ev.id as string; ctx.eventPlayer = who;
            const castItem = r.s.stack.find((i) => i.objectId === ev.id);
            ctx.cast = castItem?.cast;
            if (subject === "self" && castItem) {
              // storm: the number of spells cast before this one this turn; otherwise "for each creature sacrificed" / X of the spell
              ctx.amount = ab.scripted?.handler === "storm" ? r.s.turnLog.filter((e) => e.type === "cast").length - 1 : (castItem.sacrificed?.length ?? castItem.x);
              ctx.x = castItem.x;
            }
          } else if (ev.type === "leaves") {
            const eid = ev.id as string, l = ev.lki as Lki;
            if ((tr.fromZone ?? "battlefield") !== ev.from) continue; // leaves triggers mean the battlefield unless they name a zone
            if (tr.toZone && tr.toZone !== ev.to) continue;
            match = subject === undefined || subject === "self" ? eid === h.id : subject === "enchanted" || subject === "equipped" ? obj(r, h.id).attachedTo === eid : typeof subject === "object" && lkiMatches(subject as ObjectFilter, l, q, eid); // enchanted / equipped: still attached when it left (SBA unattach runs after the trigger scan)
            ctx.eventObj = eid; ctx.eventPlayer = l.controller; ctx.lki = l;
          } else if (ev.type === "becomes_target") {
            const tid = ev.id as string;
            if (subject === undefined || subject === "self") match = tid === h.id && !(ab.keyword?.name.toLowerCase() === "ward" && ev.player === h.controller); // ward: only spells / abilities an opponent controls
            else if (typeof subject === "object") match = !!tryObj(r, tid) && matchesFilter(r, tid, subject as ObjectFilter, q); // "whenever a Dragon you control becomes the target of ..."
            else throw new Unsupported("trigger:becomes_target.subject");
            if (match && (tr.whose === "opponents" || tr.whose === "yours") && (tr.whose === "yours") !== (ev.player === h.controller)) match = false;
            ctx.eventObj = ev.by as string; ctx.eventPlayer = ev.player as string;
          } else if (ev.type === "cycle") {
            const who = ev.player as string;
            if (subject === undefined || subject === "self") match = ev.id === h.id;
            else if (subject === "you") match = who === h.controller;
            else if (subject === "each_player") match = true;
            else if (subject === "opponent" || subject === "each_opponent") match = who !== h.controller;
            else if (typeof subject === "object") match = matchesFilter(r, ev.id as string, subject as ObjectFilter, q);
            else throw new Unsupported(`trigger:subject:${String(subject)}`);
            ctx.eventObj = ev.id as string; ctx.eventPlayer = who; ctx.x = ev.x as number | undefined;
          } else if (SIMPLE_EVENTS[ev.type]) {
            const c = matchSimple(r, ev, tr, h, evIdx);
            if (c) { match = true; ctx = c; }
          } else if (ev.type === "begin_step") {
            if (ev.step !== tr.step) continue;
            const whose = tr.whose ?? "yours";
            match = whose === "each" || (whose === "yours") === (ev.player === h.controller);
            ctx.eventPlayer = ev.player as string;
          } else {
            // attack / block / damage
            if (tr.batch && ev.batch !== undefined) {
              const key = `${h.id}:${ab.id}:${tr.event}:${String(ev.batch)}`;
              const seen = (r.seenBatch ??= new Set());
              if (seen.has(key)) continue;
              seen.add(key);
              const hits = r.events.filter((e) => e.type === ev.type && e.batch === ev.batch && triggerNames(e as never).includes(tr.event)).map((e) => matchCombat(r, tr, h, e as never)).filter((c): c is TriggerContext => !!c);
              if (hits.length < (tr.minCount ?? 1)) continue;
              ctx = hits[0]; match = true;
            } else {
              const c = matchCombat(r, tr, h, ev);
              if (c) { match = true; ctx = c; }
            }
          }
          if (match && tr.batch && !["attack", "block", "damage"].includes(ev.type)) {
            // "whenever one or more ...": everything one resolution / action did is ONE batch, so it triggers once for it
            const key = `${h.id}:${ab.id}:${tr.event}:w${scanWindow}`;
            const seen = (r.seenBatch ??= new Set());
            if (seen.has(key)) match = false; else seen.add(key);
          }
          if (match) queueTrigger(r, h.id, ab, h.controller, ctx);
        }
      }
    }
  }
}

/**
 * State triggers ("When there are four or more page counters on this, ..." = event unspecified, subject self, with a condition): they fire when
 * the condition becomes true and not again while the ability is already waiting or on the stack (603.8).
 */
function queueStateTriggers(r: Run): void {
  for (const id of r.s.battlefield) {
    const o = r.s.objects[id];
    for (const ab of abilitiesOf(r, o)) {
      const tr = ab.trigger;
      if (ab.kind !== "triggered" || !tr || tr.event !== "unspecified" || !tr.interveningIf || !(tr.subject === undefined || tr.subject === "self")) continue;
      if (r.s.triggerQueue.some((t) => t.sourceId === id && t.abilityId === ab.id) || r.s.stack.some((i) => i.sourceId === id && i.abilityId === ab.id)) continue;
      queueTrigger(r, id, ab, o.controller, {});
    }
  }
}

/** Delayed triggers ("at the beginning of the next end step", "when it dies this turn") that this event brings due go to the trigger queue. */
function fireDelayed(r: Run, ev: GameEvent & Record<string, unknown>, idx: number): void {
  for (const dt of [...delayeds(r)]) {
    if (idx < (r.dtBorn?.[dt.id] ?? 0)) continue;
    let due = false;
    if (dt.at.event === "begin_step") {
      if (ev.type === "begin_step" && ev.step === dt.at.step) due = dt.at.whose === "each" || (dt.at.whose === "yours") === (ev.player === dt.controller);
    } else if (ev.type === "dies" && dt.at.ids.includes(ev.id as string)) due = true;
    if (!due) continue;
    r.s.delayedTriggers = delayeds(r).filter((x) => x.id !== dt.id);
    r.s.triggerQueue.push({ id: `q${r.s.nextId++}`, sourceId: dt.source, abilityId: "delayed", controller: dt.controller, ctx: structuredClone(dt.ctx), label: dt.label, delayed: { steps: dt.steps, targets: dt.targets } });
  }
}

/** SBA + trigger scan until stable; returns true if a decision was created (triggers wait for it). */
function settle(r: Run): boolean {
  for (let guard = 0; guard < 10000; guard++) {
    scanTriggers(r); // before the state-based actions: a creature that deals damage and dies in the same moment still triggers
    sba(r);
    scanTriggers(r);
    queueStateTriggers(r);
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
    const draft: Draft = { kind: "triggered", player: p.id, sourceId: t.sourceId, abilityId: t.abilityId, trigger: t.ctx, triggerId: t.id, cast: t.ctx.cast, x: t.ctx.x, xChosen: t.ctx.x !== undefined };
    if (t.delayed) draft.parts = [{ specs: [], steps: t.delayed.steps, targets: structuredClone(t.delayed.targets) }];
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

// ================================================================ "you may play the exiled card" while an ability resolves (hideaway)

/**
 * Cards a resolving ability lets its controller cast / play right now (permission_to_play without a duration): after the ability has
 * finished, the first queued card is cast (or played, for a land) ignoring timing. The step already asked whether the player wants to
 * ("may"); a card that cannot be cast any more (no legal target...) is simply not cast. Returns true when the cast started a decision
 * or finished the resolution itself (the caller must not call finish again).
 */
function runCastNow(r: Run): boolean {
  while (r.castNow?.length) {
    const q = r.castNow.shift()!;
    const o = tryObj(r, q.id);
    if (!o || o.timestamp !== q.ts || r.s.pending) continue;
    const snap = structuredClone(r.s), nEvents = r.events.length;
    r.ignoreTiming = true;
    try {
      if (chars(r, o.id).types.includes("land")) playLand(r, { type: "playLand", player: q.player, cardId: o.id });
      else {
        const perm = permissionsFor(r, o, q.player).find((d) => d.permission!.allow.includes("spell"));
        r.castingMiracle = !!q.option;
        castSpell(r, { type: "castSpell", player: q.player, cardId: o.id, ...(q.option ? { option: q.option } : perm ? { option: `perm:${perm.id}` } : {}) });
      }
      return true;
    } catch (e) {
      if (!(e instanceof Reject)) throw e;
      r.s = snap; r.events.length = nEvents; invalidateIndex(r);
      r.s.durableEffects = (r.s.durableEffects ?? []).filter((d) => !(d.permission?.objectId === q.id && d.permission.objectTs === q.ts));
      emit(r, { type: "cast_now_failed", player: q.player, reason: e.message });
    } finally { r.ignoreTiming = false; r.castingMiracle = false; }
  }
  return false;
}
