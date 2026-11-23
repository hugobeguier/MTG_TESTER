// Read-only queries for hosts, UIs and AI drivers: "what may this player do right now?" and "what does this object look like after layers?".
//
// legalActions(state, player, ctx) lists the things the player can START now, at the level of cards / abilities (not target combinations):
//   playLand, castSpell (one entry per face / way of casting), activateAbility (mana abilities included), passPriority,
//   declareAttackers / declareBlockers (the candidates), answerDecision (the open decision with its options and ready-made choices).
// Consistency with `resolve` is by construction: every playLand / castSpell / activateAbility candidate is PROBED, i.e. the very action is run
// through `resolve` on the state (resolve clones it, the input is never touched) and kept only if it is accepted. A cast / activation that opens
// questions is followed through with least-committal answers to see whether it can be PAID; one that fails with `cannot_pay` is not listed
// (the question stage asks for payment last, so a spell that cannot be paid would otherwise only fail after the player answered everything).
// Hidden information: the result only ever contains what `player` could see (their own hand / zones, public objects, their own decision options).
//
// effectiveView(state, id, ctx) = the object as it is NOW (layers, restrictions, summoning sickness, combat role, attachments) for display.

import type { Ability } from "../schema";
import { attackerEntry, abilitiesOf, chars, defOf, faceNames, isBlocking, isSummoningSick, printedAbilities, type Run } from "./core";
import { withCardDb } from "./carddb";
import { castableFaces } from "./faces";
import { baseChoices } from "./castopts";
import { permissionsFor } from "./durable";
import { attackProblem, blockProblem, defenderOptions, legalAttackers } from "./combat";
import { goadersOf, hostOf, mustAttack, restrictionsOf } from "./layers";
import { resolve, untapForManaProblem } from "./resolve";
import type { Action, Choice, DecisionKind, EngineContext, GameState, ObjId, PendingView, PlayerId } from "./types";
import { isObjId } from "./types";

export interface LegalAction {
  /** stable id: "<kind>:<object>[:<ability|face|option>]" (the same action keeps the same id from one call to the next) */
  id: string;
  kind: "playLand" | "castSpell" | "activateAbility" | "untapForMana" | "turnFaceUp" | "castPrepared" | "passPriority" | "declareAttackers" | "declareBlockers" | "answerDecision";
  player: PlayerId;
  label: string;
  /** a ready action for `resolve` (casts / activations use autoPay; declarations and answers have their own fields below) */
  action?: Action;
  objectId?: ObjId;
  abilityId?: string;
  face?: string;
  /** castSpell: the way of casting ("normal", "flashback", ...) when more than one exists */
  option?: string;
  zone?: string;
  isMana?: boolean;
  /** the first question the start of this cast / activation opens (targets, modes, X, a cast option ...); absent = it goes straight on the stack / resolves */
  asks?: DecisionKind;
  /** when `asks` is choose_targets: the object / player ids that can be chosen first */
  targetOptions?: string[];
  /** declareAttackers: creatures that may attack, each with the defenders it may attack (players, planeswalkers, battles) */
  attackers?: Array<{ id: ObjId; defenders: string[] }>;
  /** declareAttackers: creatures that must attack if able */
  mustAttack?: ObjId[];
  /** declareBlockers: creatures that may block, each with the attackers it may block */
  blockers?: Array<{ id: ObjId; attackers: ObjId[] }>;
  /** answerDecision: the open decision */
  pending?: PendingView;
  /** answerDecision: ready-made answers for small decisions (single pick, yes / no, cancel); numeric and multi-pick decisions give min / max in `pending` */
  choices?: Choice[];
}

const MAIN = ["precombat_main", "postcombat_main"];

function makeRun(state: GameState, ctx: EngineContext): Run {
  return { s: state, events: [], defs: withCardDb(ctx.cards, ctx.db), db: ctx.db, scanned: 0 };
}

/** least-committal answer used to follow a cast through to payment; undefined = stop following (assign_* decisions) */
function simpleAnswer(p: PendingView): Choice | undefined {
  if (p.numeric) return { number: Math.max(0, p.min) };
  switch (p.kind) {
    case "choose_yes_no": case "pay_unless": return { yes: false };
    case "assign_damage": case "assign_mana": case "assign_counters": return undefined;
    default: return { ids: p.options.slice(0, Math.max(0, p.min)).map((o) => o.id) };
  }
}

interface Probe { ok: boolean; asks?: DecisionKind; targetOptions?: string[] }

/** Run `action` through resolve; follow its questions with minimal answers; ok = accepted and (if it was followed to the end) payable. */
function probe(state: GameState, action: Action, ctx: EngineContext, follow: boolean): Probe {
  let res = resolve(state, action, ctx);
  if (res.error) return { ok: false };
  // continue mode: "this ability / option is not performed" is an `unresolved` event and nothing else happened -> not an action the player has
  if (res.events.length > 0 && res.events.every((e) => e.type === "unresolved") && res.state.stack.length === state.stack.length && !res.pending) return { ok: false };
  const out: Probe = { ok: true };
  if (res.pending) {
    out.asks = res.pending.kind;
    if (res.pending.kind === "choose_targets" || res.pending.kind === "cast_target_player") out.targetOptions = res.pending.options.map((o) => o.id);
  }
  if (!follow) return out;
  for (let i = 0; i < 16 && res.pending; i++) {
    const ans = simpleAnswer(res.pending);
    if (!ans) return out;
    res = resolve(res.state, { type: "answerDecision", player: res.pending.player, decisionId: res.pending.id, choice: ans }, ctx);
    if (res.error) return res.error.code === "cannot_pay" ? { ok: false } : out; // anything else = our guess was wrong, not "illegal"
  }
  return out;
}

const cardName = (r: Run, id: ObjId): string => { try { return chars(r, id).name || r.s.objects[id]?.cardName || id; } catch { return r.s.objects[id]?.cardName ?? id; } };

function choicesOf(p: PendingView): Choice[] {
  const out: Choice[] = [];
  if (p.numeric) { if (p.cancellable) out.push({ cancel: true }); return out; }
  if (p.kind === "choose_yes_no" || p.kind === "pay_unless") out.push({ yes: true }, { yes: false });
  else if (p.kind === "order_library") { const ids = p.options.map((o) => o.id); out.push({ place: { top: ids } }); if (p.placement?.to === "bottom") out.push({ place: { toBottom: ids } }); if (p.placement?.to === "graveyard") out.push({ place: { toGraveyard: ids } }); }
  else if (p.kind === "assign_damage" || p.kind === "assign_mana" || p.kind === "assign_counters") { /* needs a split: see pending */ }
  else if (p.max === 1) { for (const o of p.options) out.push({ ids: [o.id] }); if (p.min === 0) out.push({ ids: [] }); }
  else if (p.min === 0 && p.max >= 0) out.push({ ids: [] });
  if (p.cancellable) out.push({ cancel: true });
  return out;
}

export interface LegalOptions {
  /** also list mana abilities (default true) */
  mana?: boolean;
  /** also list `untapForMana` (taking back a mana tap). Off by default: it is a UI convenience, never a move for the AI, the stops logic or random play */
  untap?: boolean;
}

/** Everything `player` may start now. Empty for a player who has lost, a finished game, or when somebody else holds priority / owes a declaration or decision. */
export function legalActions(state: GameState, player: PlayerId, ctx: EngineContext, opts: LegalOptions = {}): LegalAction[] {
  const me = state.players.find((p) => p.id === player);
  if (!me || me.hasLost || state.gameOver) return [];
  const r = makeRun(state, ctx);
  // 1. an open decision: only its owner may act, and only by answering
  if (state.pending) {
    if (state.pending.player !== player) return [];
    const { ctx: _c, ...view } = state.pending; void _c;
    return [{ id: `answer:${view.id}`, kind: "answerDecision", player, label: view.prompt?.title || view.kind, pending: view, choices: choicesOf(view) }];
  }
  // 2. a declaration (attackers / blockers) is a turn-based action
  const ex = state.combat?.expect;
  if (ex) {
    if (ex.kind === "attackers") return ex.player === player ? [attackDeclaration(r, player, ctx)] : [];
    if (ex.players.includes(player)) return [blockDeclaration(r, player, ctx)];
    return [];
  }
  // 3. priority
  if (state.priority !== player) return [];
  const out: LegalAction[] = [];
  const seen = new Set<string>();
  const add = (a: LegalAction) => { if (!seen.has(a.id)) { seen.add(a.id); out.push(a); } };

  // lands: hand, or a permission to play it from elsewhere (exile, top of library)
  const mainTiming = state.turn.active === player && MAIN.includes(state.turn.phase) && state.stack.length === 0;
  const landCands: ObjId[] = [...me.hand];
  for (const p of state.players) for (const id of [...p.exile, ...(p.id === player ? p.library.slice(0, 1) : [])]) landCands.push(id);
  if (mainTiming) {
    for (const id of landCands) {
      const o = state.objects[id];
      if (!o || o.owner !== player && !permissionsFor(r, o, player).length) continue;
      if (o.zone !== "hand" && o.zone !== "exile" && o.zone !== "library") continue;
      const def = defOf(r, o);
      if (!def || !(def.types.includes("land") || Object.values(def.faces ?? {}).some((f) => f.types.includes("land")))) continue;
      const faces = faceNames(def);
      const variants: Array<string | undefined> = faces.length > 1 ? faces : [undefined];
      for (const face of variants) {
        const action: Action = { type: "playLand", player, cardId: id, ...(face ? { face } : {}) };
        const pr = probe(state, action, ctx, false);
        if (pr.ok) add({ id: `playLand:${id}${face ? `:${face}` : ""}`, kind: "playLand", player, objectId: id, ...(face ? { face } : {}), zone: o.zone, label: `Play ${face ?? cardName(r, id)}`, action });
      }
    }
  }

  // spells: hand, command zone, other zones only through a cast option / permission
  const castCands: ObjId[] = [...me.hand, ...me.command];
  for (const id of [...me.graveyard, ...me.library.slice(0, 1)]) castCands.push(id);
  for (const p of state.players) for (const id of p.exile) castCands.push(id);
  for (const id of castCands) {
    const o = state.objects[id];
    if (!o) continue;
    if (o.zone !== "hand" && o.zone !== "command" && baseChoices(r, o, player, o.zone).length === 0) continue;
    const def = defOf(r, o);
    if (!def) continue;
    if (def.types.includes("land") && faceNames(def).length <= 1) continue; // lands are played, not cast
    const faces = castableFaces(def);
    const faceVariants: Array<string | undefined> = faces.length > 1 ? faces : [undefined];
    const bases = baseChoices(r, o, player, o.zone);
    const ways: Array<string | undefined> = bases.length > 1 || (bases.length === 1 && bases[0] !== null) ? bases.map((b) => (b ? b.id : "normal")) : [undefined];
    for (const face of faceVariants) for (const way of ways) {
      const action: Action = { type: "castSpell", player, cardId: id, autoPay: true, ...(face ? { face } : {}), ...(way ? { option: way } : {}) };
      const pr = probe(state, action, ctx, true);
      if (!pr.ok) continue;
      const nm = face ?? cardName(r, id);
      add({ id: `castSpell:${id}${face ? `:${face}` : ""}${way ? `:${way}` : ""}`, kind: "castSpell", player, objectId: id, ...(face ? { face } : {}), ...(way ? { option: way } : {}), zone: o.zone, label: `Cast ${nm}${way && way !== "normal" ? ` (${way})` : ""}`, action, ...(pr.asks ? { asks: pr.asks } : {}), ...(pr.targetOptions ? { targetOptions: pr.targetOptions } : {}) });
    }
  }

  // activated abilities (mana abilities too): permanents you control, plus hand / graveyard / exile / command abilities of your own cards
  const actCands: ObjId[] = [...state.battlefield.filter((id) => state.objects[id].controller === player), ...me.hand, ...me.graveyard, ...me.exile, ...me.command];
  for (const id of actCands) {
    const o = state.objects[id];
    if (!o) continue;
    let abilities: Ability[];
    try { abilities = abilitiesOf(r, o); } catch { continue; }
    for (const ab of abilities) {
      if (ab.kind !== "activated" && ab.kind !== "mana") continue;
      if ((ab.zone ?? "battlefield") !== o.zone) continue;
      if (ab.kind === "mana" && opts.mana === false) continue;
      const action: Action = { type: "activateAbility", player, sourceId: id, abilityId: ab.id, autoPay: true };
      const pr = probe(state, action, ctx, ab.kind !== "mana");
      if (!pr.ok) continue;
      add({ id: `activateAbility:${id}:${ab.id}`, kind: "activateAbility", player, objectId: id, abilityId: ab.id, zone: o.zone, isMana: ab.kind === "mana", label: `${cardName(r, id)}: ${ab.text}`, action, ...(pr.asks ? { asks: pr.asks } : {}), ...(pr.targetOptions ? { targetOptions: pr.targetOptions } : {}) });
    }
  }

  // special actions on the battlefield: turn a morph face up (no stack), cast the spell copy of a prepared permanent
  for (const id of state.battlefield) {
    const o = state.objects[id];
    if (!o || o.controller !== player) continue;
    if (o.faceDown) {
      const action: Action = { type: "turnFaceUp", player, objectId: id, autoPay: true };
      if (probe(state, action, ctx, false).ok) add({ id: `turnFaceUp:${id}`, kind: "turnFaceUp", player, objectId: id, zone: o.zone, label: `Turn ${cardName(r, id)} face up (morph)`, action });
    }
    if (o.prepared) {
      const action: Action = { type: "castPrepared", player, objectId: id, autoPay: true };
      const pr = probe(state, action, ctx, true);
      if (pr.ok) add({ id: `castPrepared:${id}`, kind: "castPrepared", player, objectId: id, zone: o.zone, label: `Cast a copy of the prepared spell of ${cardName(r, id)}`, action, ...(pr.asks ? { asks: pr.asks } : {}), ...(pr.targetOptions ? { targetOptions: pr.targetOptions } : {}) });
    }
  }

  if (opts.untap) {
    for (const t of me.manaTaps ?? []) {
      const action: Action = { type: "untapForMana", player, permanentId: t.source };
      if (!untapForManaProblem(r, action as Extract<Action, { type: "untapForMana" }>)) add({ id: `untapForMana:${t.source}`, kind: "untapForMana", player, objectId: t.source, zone: "battlefield", label: `Untap ${cardName(r, t.source)} (take back its mana)`, action });
    }
  }
  add({ id: "passPriority", kind: "passPriority", player, label: state.stack.length ? "Pass (let the top of the stack resolve)" : "Pass priority", action: { type: "passPriority", player } });
  return out;
}

function attackDeclaration(r: Run, player: PlayerId, ctx: EngineContext): LegalAction {
  const defs = defenderOptions(r, player);
  const attackers = legalAttackers(r, player).map((id) => ({ id, defenders: defs.filter((d) => attackProblem(r, id, player, d) === null) }));
  const must = attackers.filter((a) => mustAttack(r, a.id) || goadersOf(r, a.id).length > 0).map((a) => a.id);
  // the smallest legal declaration: nothing, or just the creatures that must attack (first defender they may attack)
  const minimal: Action = { type: "declareAttackers", player, attackers: attackers.filter((a) => must.includes(a.id) && a.defenders.length).map((a) => ({ id: a.id, defender: a.defenders[0] })) };
  const ok = !resolve(r.s, minimal, ctx).error;
  return { id: "declareAttackers", kind: "declareAttackers", player, label: "Declare attackers", attackers, mustAttack: must, ...(ok ? { action: minimal } : {}) };
}

function blockDeclaration(r: Run, player: PlayerId, ctx: EngineContext): LegalAction {
  const atk = (r.s.combat?.attackers ?? []).filter((a) => attackerEntry(r, a.id)).map((a) => a.id);
  const blockers = r.s.battlefield
    .filter((id) => r.s.objects[id].controller === player)
    .map((id) => ({ id, attackers: atk.filter((a) => blockProblem(r, id, a, player) === null) }))
    .filter((b) => b.attackers.length > 0);
  const none: Action = { type: "declareBlockers", player, blocks: [] };
  const ok = !resolve(r.s, none, ctx).error;
  return { id: "declareBlockers", kind: "declareBlockers", player, label: "Declare blockers", blockers, ...(ok ? { action: none } : {}) };
}

/** Cheap check for priority-stop logic: does `player` have any action besides passing (mana abilities do not count)? */
export function canRespond(state: GameState, player: PlayerId, ctx: EngineContext): boolean {
  return legalActions(state, player, ctx, { mana: false }).some((a) => a.kind !== "passPriority");
}

// ---------------------------------------------------------------- effective view of an object

export interface ObjectAbilityView { id: string; kind: string; text: string }
export interface ObjectView {
  id: ObjId;
  name: string;
  types: string[];
  subtypes: string[];
  supertypes: string[];
  colors: string[];
  manaValue: number;
  /** effective values after layers and counters (undefined = not a creature / no P/T) */
  power?: number;
  toughness?: number;
  /** printed values before any effect (what the card says) */
  printedPower?: number;
  printedToughness?: number;
  keywords: string[];
  abilities: ObjectAbilityView[];
  /** effective abilities the object did not print (granted by a static / temporary effect) */
  grantedAbilities: ObjectAbilityView[];
  /** layer 6 removed every ability the object printed (Pacifism-style "loses all abilities") */
  abilitiesStripped: boolean;
  /** printed keywords no longer present */
  lostKeywords: string[];
  owner: PlayerId;
  controller: PlayerId;
  zone: string;
  tapped: boolean;
  summoningSick: boolean;
  damage: number;
  counters: Record<string, number>;
  /** the permanent this Aura / Equipment is attached to (valid hosts only) */
  attachedTo?: ObjId;
  /** objects attached to this one */
  attachments: ObjId[];
  token: boolean;
  isCommander: boolean;
  faceDown: boolean;
  face?: string;
  attacking: boolean;
  /** the player / planeswalker an attacking creature attacks */
  attackTarget?: string;
  blocking: boolean;
  /** the attacker(s) a blocking creature blocks */
  blockedAttackers: ObjId[];
  cantAttack: boolean;
  cantBlock: boolean;
  loyalty?: number;
}

/** The object as it is right now. Throws for an unknown id. Callers that serve a player pass only ids that player may see. */
export function effectiveView(state: GameState, id: ObjId, ctx: EngineContext): ObjectView {
  return viewIn(makeRun(state, ctx), id);
}

/** Views of many objects sharing one Run (cheaper than calling effectiveView per object). Unknown ids are skipped. */
export function effectiveViews(state: GameState, ctx: EngineContext, ids: readonly ObjId[]): Record<ObjId, ObjectView> {
  const r = makeRun(state, ctx);
  const out: Record<ObjId, ObjectView> = {};
  for (const id of ids) if (isObjId(id) && state.objects[id]) out[id] = viewIn(r, id);
  return out;
}

function viewIn(r: Run, id: ObjId): ObjectView {
  const o = r.s.objects[id];
  if (!o) throw new Error(`unknown object ${id}`);
  const c = chars(r, id);
  const onBf = o.zone === "battlefield";
  let printed: Ability[] = [];
  try { printed = printedAbilities(r, o); } catch { /* unknown card */ }
  const effective = onBf ? c.abilities : abilitiesOf(r, o);
  const kw = (a: Ability[]) => a.filter((x) => x.kind === "keyword" && x.keyword).map((x) => x.keyword!.name.toLowerCase().replace(/_/g, " "));
  const atk = attackerEntry(r, id);
  const blocked = (r.s.combat?.attackers ?? []).filter((a) => attackerEntry(r, a.id) && a.blockers.some((b) => b.id === id && b.ts === o.timestamp)).map((a) => a.id);
  const restr = onBf ? restrictionsOf(r, id) : [];
  const host = o.attachedTo ? hostOf(r, o) : undefined;
  const printedKw = kw(printed);
  const def = o.token || o.copyDef ? undefined : defOf(r, o);
  const base = def ? def : undefined;
  const loyalty = o.counters.loyalty;
  return {
    id, name: c.name || o.cardName, types: c.types, subtypes: c.subtypes, supertypes: c.supertypes, colors: c.colors, manaValue: c.mv,
    ...(c.power !== undefined ? { power: c.power } : {}), ...(c.toughness !== undefined ? { toughness: c.toughness } : {}),
    ...((o.token || o.copyDef) ? ((o.copyDef ?? o.token)!.power !== undefined ? { printedPower: (o.copyDef ?? o.token)!.power } : {}) : base?.power !== undefined ? { printedPower: base.power } : {}),
    ...((o.token || o.copyDef) ? ((o.copyDef ?? o.token)!.toughness !== undefined ? { printedToughness: (o.copyDef ?? o.token)!.toughness } : {}) : base?.toughness !== undefined ? { printedToughness: base.toughness } : {}),
    keywords: c.keywords, abilities: effective.map((a) => ({ id: a.id, kind: a.kind, text: a.text })),
    grantedAbilities: effective.filter((a) => !printed.some((p) => p.id === a.id)).map((a) => ({ id: a.id, kind: a.kind, text: a.text })),
    abilitiesStripped: onBf && printed.length > 0 && effective.length === 0,
    lostKeywords: onBf ? printedKw.filter((k) => !c.keywords.includes(k)) : [],
    owner: o.owner, controller: o.controller, zone: o.zone, tapped: o.tapped, summoningSick: onBf && isSummoningSick(r, o), damage: o.damage, counters: { ...o.counters },
    ...(host ? { attachedTo: host.id } : {}),
    attachments: onBf ? r.s.battlefield.filter((x) => x !== id && r.s.objects[x].attachedTo === id && hostOf(r, r.s.objects[x])?.id === id) : [],
    token: !!o.token, isCommander: !!o.isCommander, faceDown: !!o.faceDown, ...(o.face ? { face: o.face } : {}),
    attacking: !!atk, ...(atk ? { attackTarget: atk.defender } : {}), blocking: isBlocking(r, id), blockedAttackers: blocked,
    cantAttack: restr.some((x) => x.kind === "cant" && x.what === "attack" && !x.protects), cantBlock: restr.some((x) => x.kind === "cant" && x.what === "block"),
    ...(loyalty !== undefined ? { loyalty } : {})
  };
}
