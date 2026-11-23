// Action mapper: legacy intent / orchestrator action -> kernel action(s), and the runner that executes a mapped action on a kernel state.
//
// A legacy "action" is coarser than a kernel action: a legacy cast pays and resolves in one step (no stack), a legacy attack declaration is one
// attacker at a time, a legacy "phase:draw" is a turn-based action. `Mapped` describes the macro; `runMapped` turns it into kernel actions and
// settles the kernel (pass priority until the stack is empty, answering kernel decisions with a documented default policy).
import { resolve } from "../engine";
import type { Action, Choice, EngineContext, EngineError, GameEvent, GameState, ObjId, PendingView, PlayerId } from "../engine/types";
import type { AdaptResult } from "./adapter";
import type { GuestIntentName } from "../../lib/multiplayer/intentSpecs";
import type { GameSession, VisibleCard } from "../../lib/types";
import type { ObserverMeta } from "./types";
import type { Hint } from "./hints";

export type Mapped =
  | { kind: "playLand"; seat: string; legacyCardId: string; /** modal double-faced land: the face the legacy engine played (its name after the play) */ face?: string }
  | { kind: "cast"; seat: string; legacyCardId: string; x?: number; payWith: string[]; commander: boolean; /** cast from the graveyard (Gravecrawler, flashback): the card's graveyard cast option is chosen */ fromGraveyard?: boolean }
  | { kind: "attack"; seat: string; attackers: Array<{ legacyId: string; target: string }> }
  | { kind: "block"; seat: string; blocks: Array<{ blocker: string; attacker: string }> }
  /** turn-based phase actions: untap / draw / combat damage, run from the state of the PREVIOUS kernel step until `target` is reached */
  | { kind: "advanceTo"; seat: string; target: "untap" | "draw" | "combat_damage"; label: string }
  | { kind: "pass"; seat: string }
  | { kind: "skip"; seat: string; reason: string }
  | { kind: "unmapped"; seat: string; reason: string };

/** Legacy actionTypes the self-play orchestrator reports and what they map to. */
export const LEGACY_ACTION_COVERAGE: Record<string, { kernel: string; status: "mapped" | "skipped" | "unmapped"; note?: string }> = {
  play_land: { kernel: "playLand", status: "mapped" },
  cast_spell: { kernel: "castSpell + passPriority until the stack is empty", status: "mapped", note: "X derived from the mana paid; payWith = the legacy tapped sources; kernel decisions answered by the default policy" },
  cast_commander: { kernel: "castSpell from the command zone (+ tax)", status: "mapped" },
  attack: { kernel: "declareAttackers (all attackers of one combat grouped)", status: "mapped" },
  block: { kernel: "declareBlockers (all blocks of one combat grouped)", status: "mapped" },
  "phase:untap": { kernel: "advancePhase from the previous cleanup", status: "mapped" },
  "phase:draw": { kernel: "passPriority from upkeep to the draw step", status: "mapped" },
  "phase:combat_damage": { kernel: "passPriority from declare_blockers to combat_damage", status: "mapped" },
  "phase:upkeep": { kernel: "(legacy pending upkeep draws)", status: "skipped", note: "compared only for unexpected changes" },
  "phase:end_of_combat": { kernel: "(clears combat flags)", status: "skipped" },
  "phase:end_step": { kernel: "(Braids end step script)", status: "skipped", note: "compared only for unexpected changes" },
  activate_ability: { kernel: "activateAbility", status: "unmapped", note: "the orchestrator never offers it to brains; the live hook maps tap/mana abilities (see INTENT_COVERAGE)" },
  pass_priority: { kernel: "passPriority", status: "mapped", note: "no legacy state change" },
  end_turn: { kernel: "advancePhase", status: "mapped", note: "no legacy state change" }
};

export type IntentMapping = { kernel: string; status: "mapped" | "partial" | "unmapped"; note?: string };

const M = (kernel: string, note?: string): IntentMapping => ({ kernel, status: "mapped", ...(note ? { note } : {}) });
const P = (kernel: string, note: string): IntentMapping => ({ kernel, status: "partial", note });
const U = (note: string): IntentMapping => ({ kernel: "-", status: "unmapped", note });

/** Every guest intent (src/lib/multiplayer/intentSpecs.ts) and its kernel counterpart. A test checks that the table covers all of INTENT_SPECS. */
export const INTENT_COVERAGE: Record<GuestIntentName, IntentMapping> = {
  onKeepHand: U("mulligans are not modelled by the kernel (newGame deals the opening hand)"),
  onMulligan: U("mulligans are not modelled by the kernel"),
  onToggleMulliganReturnCard: U("mulligans are not modelled by the kernel"),
  onPassPriority: M("passPriority"),
  onAdvanceTurn: M("advancePhase"),
  onEndTurn: P("passPriority fastForward x N", "legacy skips the rest of the turn; the kernel needs one pass per step"),
  onPlayCard: P("playLand | castSpell", "land vs spell decided from the card's type line; position is UI only; zone 'hand'/'command' mapped, exile/graveyard need cast options"),
  onPlayCardFace: P("playLand {face} | castSpell {face}", "face index -> face name needs the CardDb"),
  onCycleCard: P("activateAbility (hand-zone cycling)", "ability id must be looked up on the card"),
  onCastFromExile: P("castSpell (permission)", "needs a permission_to_play durable effect"),
  onCastFromGraveyard: P("castSpell {option: flashback|escape...}", "option id must be looked up on the card"),
  onActivateGraveyardAbility: P("activateAbility (graveyard zone)", "ability id must be looked up on the card"),
  onCastCommander: M("castSpell from the command zone"),
  onUnlockRoomDoor: U("Rooms are not modelled by the kernel"),
  onRespondWithSelectedCard: P("castSpell with a non-empty stack", "the observer's legacy states have no stack"),
  onTapForMana: P("activateAbility (mana ability)", "mapped for sources with one mana ability"),
  onToggleTapCard: U("manual tap toggling is a UI action: not a rules action"),
  onClickPermanent: P("activateAbility (mana ability)", "one-click mana sources only"),
  onActivateSacrificeAbility: P("activateAbility", "legacy ability index -> kernel ability id needs text matching"),
  onActivateTapAbility: P("activateAbility", "legacy ability index -> kernel ability id needs text matching"),
  onActivateScriptedAbility: U("scripted legacy handlers have no kernel id"),
  onActivateSelfUntap: U("not mapped yet"),
  onActivateGenericMana: P("activateAbility", "legacy ability index -> kernel ability id needs text matching"),
  onActivateEquip: P("activateAbility (equip)", "equip target arrives later as a prompt answer"),
  onActivateManlandAnimation: P("activateAbility", "legacy ability index -> kernel ability id needs text matching"),
  onActivateLoyalty: P("activateAbility {loyalty}", "cost -> kernel ability id needs text matching"),
  onResolveMyriadLandscape: U("legacy-specific resolver"),
  onResolveBasicLandFetch: U("legacy-specific resolver"),
  onMoveBattlefieldCard: U("UI position only"),
  onToggleFullControl: U("UI setting"),
  onStopNext: U("UI setting"),
  onTogglePhaseStop: U("UI setting"),
  onToggleStopOnStackResponse: U("UI setting"),
  onToggleStopOnAttacked: U("UI setting"),
  onToggleStopOnTargeted: U("UI setting"),
  onToggleStopOnChoicePrompt: U("UI setting"),
  onToggleYield: U("UI setting"),
  onDeclareAttack: M("declareAttackers", "one attacker per legacy intent; grouped per combat by the observer"),
  onConfirmBlockers: M("declareBlockers"),
  onPassBlocks: M("declareBlockers {blocks: []}"),
  onChooseMana: P("answerDecision (choose_color)", "needs the open kernel decision"),
  onCancelManaChoice: P("answerDecision {cancel}", "needs the open kernel decision"),
  onChooseMyriadTapMana: U("legacy-specific prompt"),
  onChooseMyriadTapSearch: U("legacy-specific prompt"),
  onCancelMyriadTapChoice: U("legacy-specific prompt"),
  onCloseMyriadSearch: U("legacy-specific prompt"),
  onCompleteMyriadSearch: U("legacy-specific prompt"),
  onCloseBasicLandFetchSearch: U("legacy-specific prompt"),
  onCompleteBasicLandFetchSearch: U("legacy-specific prompt"),
  onCloseLibrarySearch: P("answerDecision {ids: []}", "search decline"),
  onSearchLibraryCardToHand: P("answerDecision {ids}", "search answer"),
  onFinishLibrarySearch: P("answerDecision", "search answer"),
  onSacrificeRuleSource: U("cumulative upkeep / echo style prompts are not modelled"),
  onPayCumulativeUpkeep: U("cumulative upkeep is not modelled"),
  onAcceptMiracle: P("answerDecision {yes}", "miracle prompt"),
  onDeclineMiracle: P("answerDecision {yes:false}", "miracle prompt"),
  onAcceptOptionalTrigger: P("answerDecision {yes}", "choose_yes_no"),
  onDeclineOptionalTrigger: P("answerDecision {yes:false}", "choose_yes_no"),
  onAcceptCommanderZoneChoice: P("answerDecision {yes}", "commander zone replacement prompt"),
  onDeclineCommanderZoneChoice: P("answerDecision {yes:false}", "commander zone replacement prompt"),
  onCompleteDiscardChoice: P("answerDecision {ids}", "choose_cards"),
  onCompletePutCardsOnLibrary: P("answerDecision {ids}", "choose_cards"),
  onCompleteConniveDiscard: P("answerDecision {ids}", "choose_cards"),
  onCompleteReturnLandToHand: P("answerDecision {ids}", "choose_cards"),
  onCompleteChoosePermanentToBlink: P("answerDecision {ids}", "choose_cards"),
  onChooseCreatureType: P("answerDecision {ids:[type]}", "choose_option"),
  onChooseColor: P("answerDecision {ids:[color]}", "choose_color"),
  onConfirmAttackTriggerManaColors: P("answerDecision {assign}", "assign_mana"),
  onChooseGraveyardReanimationTarget: P("answerDecision {ids}", "choose_targets"),
  onChooseSacrificeCostTarget: P("answerDecision {ids}", "choose_cards (cost)"),
  onChooseEachPlayerSacrifice: P("answerDecision {ids}", "choose_cards"),
  onChooseCreatureToSacrificeForCast: P("answerDecision {ids}", "choose_cards (cost)"),
  onChooseModalOption: P("answerDecision {ids:[mode]}", "choose_modes"),
  onChooseModalSet: P("answerDecision {ids:[modes]}", "choose_modes"),
  onChooseEffectTarget: P("answerDecision {ids:[target]}", "choose_targets"),
  onDeclineEffectTarget: P("answerDecision {ids: []}", "choose_targets with min 0"),
  onConfirmProliferateTargets: U("proliferate is not modelled"),
  onChooseBattlefieldCreatureTarget: P("answerDecision {ids}", "choose_targets"),
  onChooseAuraRetarget: U("retargeting is not modelled"),
  onChooseEquipTarget: P("answerDecision {ids}", "choose_targets"),
  onChooseNextTrigger: P("answerDecision {ids}", "order_triggers"),
  onKeepLibraryLookCardOnTop: P("answerDecision {ids}", "look_top / scry answers"),
  onOrderLibraryLookCardOnTop: P("answerDecision {ids}", "look_top / scry answers"),
  onPutLibraryLookCardOnBottom: P("answerDecision {ids}", "look_top / scry answers"),
  onPutLibraryLookCardInGraveyard: P("answerDecision {ids}", "surveil answers"),
  onSendLibraryLookCardToHand: P("answerDecision {ids}", "look_top answers"),
  onRepeatVaultLook: U("vault look is legacy-specific"),
  onKeepVaultLookCards: U("vault look is legacy-specific"),
  onCloseLibraryLook: P("answerDecision {ids: []}", "look_top decline")
};

const typeOf = (c: VisibleCard | undefined): string => c?.typeLine ?? "";
const isLandCard = (c: VisibleCard | undefined): boolean => /\bland\b/i.test(typeOf(c).split("—")[0]);

/** Map one observed legacy action (orchestrator meta) to a macro. `s0` is the legacy state BEFORE the action (the first one of a group). */
export function mapObserverAction(meta: ObserverMeta, s0: GameSession, s1: GameSession): Mapped {
  const seat = meta.seatId;
  const t = meta.actionType;
  if (t === "play_land" && meta.cardId) {
    const before = s0.seats.flatMap((s) => [...s.board.hand, ...(s.board.commander ? [s.board.commander] : []), ...(s.board.exile ?? []), ...(s.board.graveyard ?? [])]).find((c) => c.id === meta.cardId);
    const after = s1.seats.flatMap((s) => s.board.battlefield).find((c) => c.id === meta.cardId);
    const face = before && after && before.name !== after.name ? after.name : undefined;
    return { kind: "playLand", seat, legacyCardId: meta.cardId, ...(face ? { face } : {}) };
  }
  if ((t === "cast_spell" || t === "cast_commander") && meta.cardId) {
    const owner = s0.seats.find((s) => s.id === seat);
    const card = owner?.board.hand.find((c) => c.id === meta.cardId) ?? owner?.board.graveyard?.find((c) => c.id === meta.cardId) ?? owner?.board.commander;
    const hasX = /\{X\}/.test(card?.manaCost ?? "");
    // {X}{X}{X}{R}{R} (Crackle with Power): the mana paid beyond the fixed part is split over every X symbol
    const xSymbols = (card?.manaCost?.match(/\{X\}/g) ?? []).length;
    const x = hasX && meta.manaPayment ? Math.max(0, Math.floor((meta.manaPayment.totalCost - (card?.manaValue ?? 0)) / Math.max(1, xSymbols))) : undefined;
    const fromHand = !!owner?.board.hand.some((c) => c.id === meta.cardId);
    if (!fromHand && t === "cast_spell" && !owner?.board.graveyard?.some((c) => c.id === meta.cardId)) return { kind: "unmapped", seat, reason: "cast from a zone other than hand/graveyard/command" };
    return { kind: "cast", seat, legacyCardId: meta.cardId, ...(t === "cast_spell" && !fromHand ? { fromGraveyard: true } : {}), ...(x !== undefined ? { x } : {}), payWith: meta.manaPayment?.sourceIds ?? [], commander: t === "cast_commander" };
  }
  if (t === "attack") {
    // all creatures marked attacking in s1 (the group's last state)
    const attackers: Array<{ legacyId: string; target: string }> = [];
    for (const s of s1.seats) for (const c of s.board.battlefield) if (c.attacking && s.id === seat) attackers.push({ legacyId: c.id, target: c.attackTargetId ?? "" });
    return { kind: "attack", seat, attackers };
  }
  if (t === "block") {
    const blocks: Array<{ blocker: string; attacker: string }> = [];
    for (const s of s1.seats) for (const c of s.board.battlefield) {
      if (c.blocking && c.blockingTargetId) blocks.push({ blocker: c.id, attacker: c.blockingTargetId });
      if (c.blocking && c.extraBlockingTargetId) blocks.push({ blocker: c.id, attacker: c.extraBlockingTargetId });
    }
    return { kind: "block", seat, blocks };
  }
  if (t === "phase:untap") return { kind: "advanceTo", seat, target: "untap", label: t };
  if (t === "phase:draw") return { kind: "advanceTo", seat, target: "draw", label: t };
  if (t === "phase:combat_damage") return { kind: "advanceTo", seat, target: "combat_damage", label: t };
  if (t === "phase:end_of_combat" || t === "phase:upkeep" || t === "phase:end_step") return { kind: "skip", seat, reason: `legacy housekeeping (${t})` };
  if (t === "pass_priority") return { kind: "pass", seat };
  if (t === "end_turn") return { kind: "pass", seat };
  void s0;
  return { kind: "unmapped", seat, reason: `no mapping for legacy action type '${t}'` };
}

/**
 * Intent-level mapping for the live hook / replay: wire intent name + args (as in INTENT_SPECS) -> macro, or unmapped with the table's note.
 * Only the high-frequency intents are built; everything else answers with INTENT_COVERAGE's note.
 */
export function mapIntent(name: string, args: unknown[], seat: string, s0: GameSession): Mapped {
  const cov = (INTENT_COVERAGE as Record<string, IntentMapping>)[name];
  const own = s0.seats.find((s) => s.id === seat);
  switch (name) {
    case "onPlayCard": {
      const cardId = String(args[1]);
      const zone = (args[3] as string | undefined) ?? "hand";
      const card = (zone === "command" ? [own?.board.commander] : own?.board.hand)?.find((c) => c?.id === cardId) as VisibleCard | undefined;
      if (zone !== "hand" && zone !== "command") return { kind: "unmapped", seat, reason: `play from ${zone} needs cast options` };
      if (isLandCard(card)) return { kind: "playLand", seat, legacyCardId: cardId };
      return { kind: "cast", seat, legacyCardId: cardId, payWith: [], commander: zone === "command" };
    }
    case "onCastCommander": return own?.board.commander ? { kind: "cast", seat, legacyCardId: own.board.commander.id, payWith: [], commander: true } : { kind: "unmapped", seat, reason: "no commander in the command zone" };
    case "onPassPriority": case "onAdvanceTurn": case "onEndTurn": return { kind: "pass", seat };
    case "onDeclareAttack": return { kind: "attack", seat, attackers: [{ legacyId: String(args[0]), target: String(args[1]) }] };
    case "onConfirmBlockers": return { kind: "block", seat, blocks: [] };
    case "onPassBlocks": return { kind: "block", seat, blocks: [] };
    default: return { kind: "unmapped", seat, reason: cov ? `${cov.status}: ${cov.note ?? cov.kernel}` : `unknown intent ${name}` };
  }
}

// ---------------------------------------------------------------- running a mapped action on the kernel

export interface KernelRun {
  state: GameState;
  events: GameEvent[];
  /** set when the kernel refused the (first) kernel action of the macro */
  error?: EngineError;
  /** which kernel action was refused */
  failedAction?: Action;
  /** kinds of kernel decisions answered by the default policy */
  defaulted: string[];
  /** the prompt titles of those decisions (what the default policy was asked) */
  defaultedPrompts?: string[];
  /** kinds of kernel decisions answered by replaying the legacy choice (hints.ts) */
  hinted: string[];
  /** a decision was still open when the observer stopped answering */
  pending?: PendingView;
  actions: Action[];
}

const MAX_ANSWERS = 25;
const MAX_PASSES = 200;

/** The default policy for kernel decisions the legacy engine made silently: documented in README ("decision policy"). */
export function defaultAnswer(p: PendingView, state: GameState, actor: PlayerId): Choice | undefined {
  const ids = p.options.map((o) => o.id);
  const ownedByOpp = (id: string): number => {
    if (!id.startsWith("#")) return id === actor ? 1 : 0; // a player id: prefer an opponent
    const o = state.objects[id];
    return o && o.controller !== actor ? 0 : 1;
  };
  switch (p.kind) {
    // the commander replacement ("put it into the command zone instead?"): the legacy engine leaves a dead commander in the graveyard unless told otherwise; every other "may" is accepted
    case "choose_yes_no": return { yes: !/command zone/i.test(`${p.prompt?.title ?? ""} ${p.prompt?.instruction ?? ""}`) };
    case "pay_unless": return { yes: false };
    case "choose_x": case "choose_number": return { number: Math.max(p.min, 0) };
    case "choose_targets": case "cast_target_player": {
      const sorted = [...ids].sort((a, b) => ownedByOpp(a) - ownedByOpp(b));
      return { ids: sorted.slice(0, Math.max(p.min, Math.min(1, p.max))) };
    }
    case "assign_damage": {
      const lethal = p.amounts?.lethal ?? {};
      let left = p.amounts?.total ?? 0;
      const assign: Record<string, number> = {};
      const recips = Object.keys(lethal);
      for (const id of recips) { const n = Math.min(left, lethal[id]); if (n > 0) { assign[id] = n; left -= n; } }
      if (left > 0) assign[recips[recips.length - 1] ?? ids[0]] = (assign[recips[recips.length - 1] ?? ids[0]] ?? 0) + left;
      return { assign };
    }
    case "assign_mana": case "assign_counters": return undefined;
    case "choose_option": {
      // "choose an opponent" / the gift recipient: deterministic and simple. A harmful effect goes to the opponent with the most life, a gift to the one with the least; ties keep the first (turn order)
      const lifeOf = (id: string): number | undefined => state.players.find((x) => x.id === id)?.life;
      if (ids.length > 1 && ids.every((id) => lifeOf(id) !== undefined)) {
        const gift = /gift/i.test(`${p.prompt?.title ?? ""} ${p.prompt?.instruction ?? ""}`);
        const best = ids.reduce((a, b) => (gift ? lifeOf(b)! < lifeOf(a)! : lifeOf(b)! > lifeOf(a)!) ? b : a);
        return { ids: [best] };
      }
      return { ids: ids.slice(0, Math.max(p.min, 0)) };
    }
    default: return { ids: ids.slice(0, Math.max(p.min, 0)) };
  }
}

function toKernelCtxIds(adapt: AdaptResult, legacyId: string): ObjId | undefined { return adapt.toKernel.get(legacyId); }

/** Run the macro on (a clone of) the adapted state. Never throws for engine rejections (they are returned in `error`). */
export function runMapped(adapt: AdaptResult, m: Mapped, ctx: EngineContext, hint?: Hint): KernelRun {
  let state = structuredClone(adapt.state);
  const events: GameEvent[] = [];
  const defaulted: string[] = [];
  const hinted: string[] = [];
  const prompts: string[] = [];
  const actions: Action[] = [];
  const out = (extra: Partial<KernelRun> = {}): KernelRun => ({ state, events, defaulted, hinted, actions, ...(prompts.length ? { defaultedPrompts: prompts } : {}), ...(state.pending ? { pending: stripPending(state) } : {}), ...extra });

  const step = (a: Action): EngineError | undefined => {
    actions.push(a);
    const r = resolve(state, a, ctx);
    events.push(...r.events);
    if (r.error) { return r.error; }
    state = r.state;
    return undefined;
  };
  /** answer decisions with the default policy, then pass priority until the stack is empty (optionally stop when `stop` holds) */
  const settle = (actor: PlayerId, stop?: (s: GameState) => boolean): EngineError | undefined => {
    let answers = 0, passes = 0;
    for (;;) {
      if (state.gameOver) return undefined;
      if (state.pending) {
        if (answers++ >= MAX_ANSWERS) return undefined;
        const fromLegacy = hint?.(state.pending, state, actor);
        const ch = fromLegacy ?? defaultAnswer(state.pending, state, actor);
        if (!ch) return undefined;
        (fromLegacy ? hinted : defaulted).push(state.pending.kind);
        if (!fromLegacy) prompts.push(state.pending.prompt?.title ?? state.pending.kind);
        const err = step({ type: "answerDecision", player: state.pending.player, decisionId: state.pending.id, choice: ch });
        if (err) return err;
        continue;
      }
      if (stop?.(state)) return undefined;
      if (state.stack.length === 0) return undefined;
      if (!state.priority || passes++ >= MAX_PASSES) return undefined;
      const err = step({ type: "passPriority", player: state.priority, fastForward: true });
      if (err) return err;
    }
  };

  switch (m.kind) {
    case "playLand": {
      const id = toKernelCtxIds(adapt, m.legacyCardId);
      if (!id) return out({ error: { code: "unknown_object", message: "card not in adapted state" } });
      const err = step({ type: "playLand", player: m.seat, cardId: id, ...(m.face ? { face: m.face } : {}) });
      if (err) return out({ error: err, failedAction: actions[actions.length - 1] });
      const e2 = settle(m.seat);
      return out(e2 ? { error: e2 } : {});
    }
    case "cast": {
      const id = toKernelCtxIds(adapt, m.legacyCardId);
      if (!id) return out({ error: { code: "unknown_object", message: "card not in adapted state" } });
      // sources the legacy engine tapped: real mana sources go to payWith; the others (artifacts tapped for improvise, creatures for convoke)
      // are passed as the improvise list when they are artifacts, otherwise dropped (kernel decides)
      const payWith: ObjId[] = [], improvise: ObjId[] = [];
      for (const l of m.payWith) {
        const kid = toKernelCtxIds(adapt, l);
        if (!kid) continue;
        const def = ctx.cards(state.objects[kid].cardName);
        const isMana = !!state.objects[kid].token?.abilities?.some((a) => a.kind === "mana") || !!def?.types.includes("land") || !!def?.kernel.abilities.some((a) => a.kind === "mana");
        if (isMana) payWith.push(kid);
        else if (def?.types.includes("artifact") || state.objects[kid].token?.types.includes("artifact")) improvise.push(kid);
      }
      const gOpt = m.fromGraveyard ? ctx.cards(state.objects[id].cardName)?.kernel.castOptions?.find((c) => c.from === "graveyard")?.id : undefined;
      const err = step({ type: "castSpell", player: m.seat, cardId: id, ...(gOpt ? { option: gOpt } : {}), ...(m.x !== undefined ? { x: m.x } : {}), ...(payWith.length ? { payWith } : {}), ...(improvise.length ? { improvise } : {}), autoPay: true });
      if (err) return out({ error: err, failedAction: actions[actions.length - 1] });
      // the cast may have opened decisions (modes, targets...): settle answers them, then resolves the stack
      const e2 = settle(m.seat);
      // the legacy engine taps whole sources even when part of their mana is wasted (a {3} source + a {1} source for a {2} spell): the kernel taps
      // only what it needs, so the sources the legacy engine tapped are tapped here too (the same permanents are tapped, nothing more is paid)
      for (const l of m.payWith) { const kid = toKernelCtxIds(adapt, l); const o = kid ? state.objects[kid] : undefined; if (o && o.zone === "battlefield" && o.controller === m.seat) o.tapped = true; }
      for (const kid of improvise) { const o = state.objects[kid]; if (o && o.zone === "battlefield") o.tapped = true; }
      return out(e2 ? { error: e2 } : {});
    }
    case "attack": {
      const list = m.attackers.map((a) => ({ id: toKernelCtxIds(adapt, a.legacyId), defender: toKernelCtxIds(adapt, a.target) ?? a.target }));
      if (list.some((a) => !a.id)) return out({ error: { code: "unknown_object", message: "attacker not in adapted state" } });
      const err = step({ type: "declareAttackers", player: m.seat, attackers: list as Array<{ id: ObjId; defender: string }>, autoPay: true });
      if (err) return out({ error: err, failedAction: actions[actions.length - 1] });
      const e2 = settle(m.seat);
      return out(e2 ? { error: e2 } : {});
    }
    case "block": {
      const pairs = m.blocks.map((b) => ({ blocker: toKernelCtxIds(adapt, b.blocker), attacker: toKernelCtxIds(adapt, b.attacker) }));
      if (pairs.some((p) => !p.blocker || !p.attacker)) return out({ error: { code: "unknown_object", message: "blocker/attacker not in adapted state" } });
      const waiting = state.combat?.expect?.kind === "blockers" ? [...state.combat.expect.players] : [];
      for (const who of waiting) {
        const mine = (pairs as Array<{ blocker: ObjId; attacker: ObjId }>).filter((p) => state.objects[p.blocker]?.controller === who);
        const err = step({ type: "declareBlockers", player: who, blocks: mine, autoPay: true });
        if (err) return out({ error: err, failedAction: actions[actions.length - 1] });
      }
      const e2 = settle(m.seat);
      return out(e2 ? { error: e2 } : {});
    }
    case "advanceTo": return advanceTo(adapt, m, () => state, (s) => { state = s; }, step, settle, out);
    case "pass": return out();
    case "skip": return out();
    case "unmapped": return out();
  }
}

const stripPending = (s: GameState): PendingView => { const { ctx: _c, ...v } = s.pending!; return v; };

function advanceTo(
  adapt: AdaptResult, m: Extract<Mapped, { kind: "advanceTo" }>, get: () => GameState, set: (s: GameState) => void,
  step: (a: Action) => EngineError | undefined, settle: (actor: PlayerId, stop?: (s: GameState) => boolean) => EngineError | undefined,
  out: (extra?: Partial<KernelRun>) => KernelRun
): KernelRun {
  const s = get();
  const seats = s.players.map((p) => p.id);
  const active = s.turn.active;
  const fail = (e: EngineError): KernelRun => out({ error: e, failedAction: undefined });
  if (m.target === "untap") {
    // start from the end of the previous player's turn: advancing out of cleanup starts the next turn (untap, upkeep)
    const prev = seats[(seats.indexOf(active) - 1 + seats.length) % seats.length];
    const st = structuredClone(s);
    st.turn = { number: s.turn.number - 1, active: prev, phase: "cleanup" };
    st.priority = prev; st.passes = []; st.combat = null;
    set(st);
    const err = step({ type: "advancePhase", player: prev });
    if (err) return fail(err);
    const e2 = settle(active, (x) => x.turn.phase === "upkeep");
    return out(e2 ? { error: e2 } : {});
  }
  const st = structuredClone(s);
  st.passes = [];
  if (m.target === "draw") { st.turn.phase = "upkeep"; st.priority = active; st.combat = null; }
  else { st.turn.phase = "declare_blockers"; st.priority = active; if (st.combat) st.combat.expect = null; }
  set(st);
  for (let i = 0; i < MAX_PASSES; i++) {
    const cur = get();
    if (cur.pending) { const e = settle(active, () => false); if (e) return fail(e); if (get().pending) return out(); continue; }
    if (cur.turn.phase === m.target || cur.gameOver) break;
    if (cur.combat?.expect) {
      // a declaration is awaited (defending creatures at combat damage start): declare nothing
      const ex = cur.combat.expect;
      const err = ex.kind === "attackers" ? step({ type: "declareAttackers", player: ex.player, attackers: [] }) : step({ type: "declareBlockers", player: ex.players[0], blocks: [] });
      if (err) return fail(err);
      continue;
    }
    if (!cur.priority) return out({ error: { code: "not_your_priority", message: "nobody holds priority while advancing" } });
    const err = step({ type: "passPriority", player: cur.priority });
    if (err) return fail(err);
  }
  const e2 = settle(active, (x) => x.stack.length === 0);
  return out(e2 ? { error: e2 } : {});
}
