// Differential checker: legacy (S0, intent, S1) vs the kernel's (toKernelState(S0), map(intent)) result.
//
// NORMALISATION (what counts as "the same", everything else is a diff):
//   - object ids are never compared (legacy ids are strings, kernel ids are "#n"); everything is by CARD NAME (tokens: token name) per player;
//   - unordered zones (hand, graveyard, exile, command, battlefield) are compared as sorted multisets; the library only by size (the two engines
//     shuffle / search differently); the stack as the multiset of names;
//   - battlefield entries compared per CONTROLLER: "Name"; separate fields for tapped ("Name|T"), counters ("Name|+1/+1=2", zero counts dropped),
//     effective P/T of creatures ("Name|2/3", kernel chars() vs legacy effectivePower/Toughness) and, in combat damage steps, damage marked;
//   - timestamps, priority, passes, rng/seed, event logs, the turn log and legacy UI fields are ignored;
//   - the phase is compared except for phase:untap (the kernel stops at upkeep there);
//   - a legacy `pending*` prompt queue and a kernel `state.pending` are compared only as "a decision is open";
//   - kernel decisions that the observer answered with its default policy mark the resulting diffs `choiceDependent` (the legacy engine made
//     those choices with its own heuristics, so a mismatch may be the policy, not a rules difference).
import { chars } from "../engine/core";
import { cardUnsupported } from "../engine/support";
import type { Run } from "../engine/core";
import type { EngineContext, GameState } from "../engine/types";
import { effectivePower, effectiveToughness } from "../../lib/counters";
import type { GameSession, VisibleCard } from "../../lib/types";
import { legacyHint } from "./hints";
import { toKernelState, hasPendingPrompt, type AdaptResult } from "./adapter";
import { mapObserverAction, runMapped, type KernelRun, type Mapped } from "./actions";
import type { DraftLookup } from "./draftLookup";
import type { Diff, DiffCategory, ObserverMeta, StepOutcome } from "./types";

export interface PlayerSnap {
  life: number;
  hasLost: boolean;
  hand: string[];
  graveyard: string[];
  exile: string[];
  command: string[];
  library: number;
  battlefield: string[];
  tapped: string[];
  counters: string[];
  pt: string[];
  damage: string[];
  commanderDamage: number;
}
export interface Snapshot {
  turn: number;
  phase: string;
  active: string;
  players: Record<string, PlayerSnap>;
  stack: string[];
  combat: string[];
  monarch: string;
  pending: boolean;
  gameOver: string;
}

const sorted = (a: string[]): string[] => [...a].sort();
const nameOf = (s: GameState, id: string): string => { const o = s.objects[id]; return o ? o.token?.name ?? o.cardName : id; };

/** Normalised view of a kernel state (see the header for the rules). `lookup` is needed for chars(). */
export function snapshotKernel(state: GameState, lookup: DraftLookup, ctx?: { legacyPending?: boolean }): Snapshot {
  const run = { s: state, events: [], defs: lookup.lookup, scanned: 0 } as unknown as Run;
  const players: Record<string, PlayerSnap> = {};
  for (const p of state.players) {
    const mine = state.battlefield.filter((id) => state.objects[id].controller === p.id);
    const bf: string[] = [], tapped: string[] = [], counters: string[] = [], pt: string[] = [], damage: string[] = [];
    for (const id of mine) {
      const o = state.objects[id];
      const n = nameOf(state, id);
      bf.push(n);
      if (o.tapped) tapped.push(n);
      for (const [k, v] of Object.entries(o.counters)) if (v > 0) counters.push(`${n}|${k}=${v}`);
      if (o.damage > 0) damage.push(`${n}|${o.damage}`);
      let c: ReturnType<typeof chars> | undefined;
      try { c = chars(run, id); } catch { c = undefined; }
      if (c?.types.includes("creature")) pt.push(`${n}|${c.power ?? "?"}/${c.toughness ?? "?"}`);
    }
    const cd = Object.values(state.commanderDamage?.[p.id] ?? {}).reduce((a, b) => a + b, 0);
    players[p.id] = {
      life: Math.max(0, p.life), hasLost: p.hasLost, // the legacy engine never shows a negative life total
      hand: sorted(p.hand.map((i) => nameOf(state, i))), graveyard: sorted(p.graveyard.map((i) => nameOf(state, i))),
      exile: sorted(p.exile.map((i) => nameOf(state, i))), command: sorted(p.command.map((i) => nameOf(state, i))),
      library: p.library.length, battlefield: sorted(bf), tapped: sorted(tapped), counters: sorted(counters), pt: sorted(pt), damage: sorted(damage), commanderDamage: cd
    };
  }
  const combat = (state.combat?.attackers ?? []).map((a) => `${nameOf(state, a.id)}>${state.objects[a.defender] ? nameOf(state, a.defender) : a.defender}[${sorted(a.blockers.map((b) => nameOf(state, b.id))).join(",")}]${a.blocked ? "B" : ""}`);
  return {
    turn: state.turn.number, phase: state.turn.phase, active: state.turn.active, players,
    stack: sorted(state.stack.map((s) => (s.objectId ? nameOf(state, s.objectId) : nameOf(state, s.sourceId)))), combat: sorted(combat),
    monarch: state.monarch ?? "", pending: ctx?.legacyPending ?? !!state.pending, gameOver: state.gameOver ? state.gameOver.winner ?? (state.gameOver.draw ? "draw" : "over") : ""
  };
}

/** Legacy-side snapshot, built from the legacy session directly where the kernel conversion would lose information (effective P/T). */
export function snapshotLegacy(session: GameSession, adapt: AdaptResult, lookup: DraftLookup): Snapshot {
  const snap = snapshotKernel(adapt.state, lookup, { legacyPending: hasPendingPrompt(session) });
  // P/T: replace the kernel's recomputed values by the legacy effective ones
  for (const seat of session.seats) {
    const pt: string[] = [];
    for (const c of seat.board.battlefield) if (/\bcreature\b/i.test(c.typeLine.split("—")[0]) || c.animatedAsCreature) pt.push(`${nameOf(adapt.state, adapt.toKernel.get(c.id) ?? "")}|${effectivePower(c)}/${effectiveToughness(c)}`);
    snap.players[seat.id].pt = sorted(pt);
    snap.players[seat.id].commanderDamage = Object.values(seat.commanderDamage ?? {}).reduce((a, b) => a + b, 0);
    snap.players[seat.id].damage = sorted(seat.board.battlefield.filter((c) => (c.damage ?? 0) > 0).map((c) => `${c.name}|${c.damage}`));
  }
  return snap;
}

const multisetDiff = (a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } => {
  const cb = new Map<string, number>();
  for (const x of b) cb.set(x, (cb.get(x) ?? 0) + 1);
  const onlyA: string[] = [];
  for (const x of a) { const n = cb.get(x) ?? 0; if (n > 0) cb.set(x, n - 1); else onlyA.push(x); }
  const onlyB: string[] = [];
  for (const [x, n] of cb) for (let i = 0; i < n; i++) onlyB.push(x);
  return { onlyA, onlyB };
};

export interface FieldDiff { field: string; legacy: unknown; kernel: unknown; cards: string[]; seat?: string }

/** All differences between a legacy snapshot and a kernel snapshot. `skip` lists fields to ignore (e.g. "phase", "damage"). */
export function diffSnapshots(legacy: Snapshot, kernel: Snapshot, skip: ReadonlySet<string> = new Set()): FieldDiff[] {
  const out: FieldDiff[] = [];
  const add = (field: string, l: unknown, k: unknown, cards: string[], seat?: string) => { if (!skip.has(field)) out.push({ field, legacy: l, kernel: k, cards, ...(seat ? { seat } : {}) }); };
  if (legacy.turn !== kernel.turn) add("turn", legacy.turn, kernel.turn, []);
  if (legacy.active !== kernel.active) add("active_player", legacy.active, kernel.active, []);
  if (legacy.phase !== kernel.phase) add("phase", legacy.phase, kernel.phase, []);
  for (const id of Object.keys(legacy.players)) {
    const l = legacy.players[id], k = kernel.players[id];
    if (!k) { add("players", id, null, []); continue; }
    if (l.life !== k.life) add("life", l.life, k.life, [], id);
    if (l.hasLost !== k.hasLost) add("has_lost", l.hasLost, k.hasLost, [], id);
    if (l.library !== k.library) add("zone:library_count", l.library, k.library, [], id);
    if (l.commanderDamage !== k.commanderDamage) add("commander_damage", l.commanderDamage, k.commanderDamage, [], id);
    for (const f of ["hand", "graveyard", "exile", "command", "battlefield", "tapped", "counters", "pt", "damage"] as const) {
      const d = multisetDiff(l[f], k[f]);
      if (d.onlyA.length || d.onlyB.length) add(f === "hand" || f === "graveyard" || f === "exile" || f === "command" || f === "battlefield" ? `zone:${f}` : f, { only: d.onlyA }, { only: d.onlyB }, [...new Set([...d.onlyA, ...d.onlyB].map((x) => x.split("|")[0]))], id);
    }
  }
  { const d = multisetDiff(legacy.stack, kernel.stack); if (d.onlyA.length || d.onlyB.length) add("stack", d.onlyA, d.onlyB, [...d.onlyA, ...d.onlyB]); }
  { const d = multisetDiff(legacy.combat, kernel.combat); if (d.onlyA.length || d.onlyB.length) add("combat", { only: d.onlyA }, { only: d.onlyB }, [...d.onlyA, ...d.onlyB].map((x) => x.split(">")[0])); }
  if (legacy.monarch !== kernel.monarch) add("monarch", legacy.monarch, kernel.monarch, []);
  if (legacy.pending !== kernel.pending) add("pending", legacy.pending, kernel.pending, []);
  if (legacy.gameOver !== kernel.gameOver) add("game_over", legacy.gameOver, kernel.gameOver, []);
  return out;
}

export interface CompareOptions {
  lookup: DraftLookup;
  ctx: EngineContext;
  game?: number;
  seed?: number;
  decks?: string[];
  actionIndex?: number;
  /** false when the legacy engine REFUSED / no-oped the action (live hook / replay): the kernel accepting it is then kernel_accepted_illegal_action */
  legacyAccepted?: boolean;
  /** use this mapping instead of mapObserverAction (live hook: mapIntent) */
  mapped?: Mapped;
  /** run the kernel in lenient mode (unsupported abilities are ignored instead of refused) */
  lenient?: boolean;
  /** s1 is the legacy state at the start of the NEXT action (its queued triggers were drained): phase / turn / active player are not compared */
  settled?: boolean;
}

const fieldsSkippedFor = (m: Mapped, s0: GameSession): Set<string> => {
  const s = new Set<string>();
  // a legacy prompt queue that was already stuck open before the action is not an effect of the action
  if (hasPendingPrompt(s0)) s.add("pending");
  if (!(m.kind === "advanceTo" && m.target === "combat_damage")) s.add("damage");
  // the legacy engine clears its attacking / blocking flags once damage is dealt, the kernel keeps the combat until end of combat
  if (m.kind === "advanceTo" && m.target === "combat_damage") s.add("combat");
  // the kernel stops at upkeep with the upkeep triggers on the stack; the legacy engine handles them in phase:upkeep
  if (m.kind === "advanceTo" && m.target === "untap") { s.add("phase"); s.add("stack"); }
  if (m.kind === "advanceTo" && m.target === "draw") s.add("combat");
  return s;
};

const cardOf = (s: GameSession, id: string | undefined): VisibleCard | undefined => {
  if (!id) return undefined;
  for (const seat of s.seats) for (const c of [...seat.board.hand, ...seat.board.battlefield, ...(seat.board.graveyard ?? []), ...(seat.board.exile ?? []), ...(seat.library ?? []), ...(seat.board.commander ? [seat.board.commander] : [])]) if (c.id === id) return c;
  return undefined;
};
const cardNameOf = (s: GameSession, id: string | undefined): string | undefined => cardOf(s, id)?.name;

/** Cards whose kernel behaviour matters for this action: the acting card, the sources tapped for it, attackers / blockers / combatants. */
function involvedCards(m: Mapped, s0: GameSession, s1: GameSession, meta: ObserverMeta): string[] {
  const names: string[] = [];
  // tokens are not cards: they never have a draft and carry their rules in the token definition
  const add = (id: string | undefined) => { const c = cardOf(s0, id) ?? cardOf(s1, id); if (c && !c.token) names.push(c.name); };
  switch (m.kind) {
    case "playLand": add(m.legacyCardId); break;
    case "cast": add(m.legacyCardId); m.payWith.forEach(add); break;
    case "attack": m.attackers.forEach((a) => add(a.legacyId)); break;
    case "block": m.blocks.forEach((b) => { add(b.blocker); add(b.attacker); }); break;
    case "advanceTo": if (m.target === "combat_damage") for (const seat of s0.seats) for (const c of seat.board.battlefield) if ((c.attacking || c.blocking) && !c.token) names.push(c.name); break;
    default: break;
  }
  void meta;
  return [...new Set(names)];
}

/**
 * BOARD DUMP for diffs about payments: the acting seat's battlefield sources (legacy view before / after the action, the printed mana
 * abilities the kernel knows, whether the legacy engine tapped them for this action), the pool, X and the total cost, so a refusal can be judged from the log.
 */
export function boardDump(s0: GameSession, s1: GameSession, m: Mapped, meta: ObserverMeta, a0: AdaptResult, lookup: DraftLookup): Record<string, unknown> {
  const seatId = m.seat ?? meta.seatId;
  const seat0 = s0.seats.find((s) => s.id === seatId);
  const seat1 = s1.seats.find((s) => s.id === seatId);
  const paid = new Set(meta.manaPayment?.sourceIds ?? (m.kind === "cast" ? m.payWith : []));
  const after = new Map((seat1?.board.battlefield ?? []).map((c) => [c.id, c]));
  const producesOf = (name: string, token?: boolean): string => {
    if (token) return "token";
    const def = lookup.lookup(name);
    const abs = (def?.kernel.abilities ?? []).filter((a) => a.kind === "mana");
    if (!abs.length) return def?.types.includes("land") ? "(basic land type)" : "";
    return abs.map((a) => JSON.stringify((a as { mana?: { produces?: unknown } }).mana?.produces ?? a.text)).join(" | ");
  };
  const sources = (seat0?.board.battlefield ?? []).map((c) => ({
    name: c.name, types: c.typeLine, tappedBefore: !!c.tapped, tappedAfter: !!after.get(c.id)?.tapped, summoningSick: !!c.summoningSick,
    tappedForThisAction: paid.has(c.id), produces: producesOf(c.name, c.token)
  })).filter((c) => c.produces || c.tappedForThisAction || /\bland\b/i.test(c.types));
  const card = m.kind === "cast" ? [...(seat0?.board.hand ?? []), ...(seat0?.board.commander ? [seat0.board.commander] : []), ...(seat0?.board.graveyard ?? [])].find((c) => c.id === m.legacyCardId) : undefined;
  return {
    seat: seatId,
    ...(card ? { cast: card.name, manaCost: card.manaCost, manaValue: card.manaValue, commanderTax: card.commanderTax } : {}),
    ...(m.kind === "cast" ? { x: m.x ?? null, payWith: m.payWith.map((id) => a0.legacyCards.get(id)?.name ?? id) } : {}),
    totalPaidByLegacy: meta.manaPayment?.totalCost ?? null,
    legacyFloatingMana: seat0?.floatingMana ?? {},
    kernelPool: a0.state.players.find((p) => p.id === seatId)?.manaPool ?? {},
    untappedSources: sources.filter((c) => !c.tappedBefore).map((c) => c.name + (c.summoningSick ? " (sick)" : "") + (c.tappedForThisAction ? " [legacy tapped]" : "") + (c.produces ? ` ${c.produces}` : "")),
    tappedSources: sources.filter((c) => c.tappedBefore).map((c) => c.name + (c.produces ? ` ${c.produces}` : "")),
    attackTaxHolders: s0.seats.flatMap((s) => s.board.battlefield).filter((c) => /attack.*(pay|unless)|(pay|unless).*attack/i.test(c.oracleText ?? "")).map((c) => c.name)
  };
}

/** Permanents on either battlefield whose drafts use capabilities the kernel does not run: a state mismatch next to one of them is probably THAT card (the kernel ignores a static / trigger it cannot run unless the card is involved). */
export function unsupportedOnBoard(s: GameSession, lookup: DraftLookup): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const seat of s.seats) for (const c of seat.board.battlefield) {
    if (c.token || out[c.name] || !lookup.hasDraft(c.name)) continue;
    try { const def = lookup.lookup(lookup.canonical(c.name).card); const caps = def ? cardUnsupported(def).all : []; if (caps.length) out[c.name] = caps.slice(0, 4); } catch { /* ignore */ }
  }
  return out;
}

export interface CompareResult { outcome: StepOutcome; mapped: Mapped; run?: KernelRun }

/**
 * The differential step. Pure with respect to the legacy sessions (they are only read). Never throws: an internal error becomes an
 * `observer_error` diff so a caller can attach this to the legacy path safely.
 */
export function compareIntent(s0: GameSession, s1: GameSession, meta: ObserverMeta, opts: CompareOptions): CompareResult {
  const base = (m: Mapped): Pick<Diff, "game" | "seed" | "decks" | "actionIndex" | "turn" | "phase" | "seat" | "intent"> => {
    const card = cardNameOf(s0, meta.cardId);
    return {
      game: opts.game ?? 0, ...(opts.seed !== undefined ? { seed: opts.seed } : {}), ...(opts.decks ? { decks: opts.decks } : {}), actionIndex: opts.actionIndex ?? 0,
      turn: s0.turn, phase: s0.phase, seat: m.seat ?? meta.seatId, intent: { type: meta.actionType, ...(meta.actionLabel ? { label: meta.actionLabel } : {}), ...(card ? { card } : {}) }
    };
  };
  let mapped: Mapped = { kind: "unmapped", seat: meta.seatId, reason: "not mapped yet" };
  try {
    mapped = opts.mapped ?? mapObserverAction(meta, s0, s1);
    const b = base(mapped);
    const mk = (category: DiffCategory, message: string, extra: Partial<Diff> = {}): Diff => ({ ...b, category, cards: [], message, ...extra });
    const skipped = (reason: string, diffs: Diff[] = []): CompareResult => ({ mapped, outcome: { kind: "skipped", intentType: meta.actionType, reason, seat: b.seat, diffs } });

    if (mapped.kind === "unmapped") return skipped("unmapped", [mk("unmapped_action", mapped.reason)]);
    if (mapped.kind === "pass") return skipped("no legacy state change");

    const a0 = toKernelState(s0, { lookup: opts.lookup, seed: opts.seed, lenient: opts.lenient });
    const a1 = toKernelState(s1, { lookup: opts.lookup, seed: opts.seed, lenient: opts.lenient });
    const gapDiffs = [...a0.gaps].map((g) => mk("adapter_gap", `legacy state carries unmapped data: ${g.field} (x${g.count})`, { field: g.field, cards: g.examples, context: { count: g.count } }));

    if (mapped.kind === "skip") {
      // legacy housekeeping: only flag unexpected changes of the observed zones
      const d = diffSnapshots(snapshotLegacy(s0, a0, opts.lookup), snapshotLegacy(s1, a1, opts.lookup), new Set(["phase", "turn", "active_player", "damage", "combat", "pending", "game_over"]));
      if (d.length === 0) return skipped(mapped.reason, gapDiffs);
      return skipped(mapped.reason, [...gapDiffs, mk("unmapped_action", `${mapped.reason} changed state (${d.map((x) => x.field).join(", ")}): the kernel has no equivalent step`, { cards: [...new Set(d.flatMap((x) => x.cards))], context: { fields: d.map((x) => x.field) } })]);
    }

    // cards without a draft: the kernel would run them as vanilla objects, so the comparison is meaningless
    const involved = involvedCards(mapped, s0, s1, meta);
    const missingCards = involved.filter((n) => !opts.lookup.hasDraft(n));
    if (missingCards.length) return skipped("no_draft", [...gapDiffs, mk("no_draft", `no kernel draft for: ${missingCards.join(", ")}`, { cards: missingCards })]);

    const run = runMapped(a0, mapped, opts.ctx, legacyHint(s0, s1, a0));
    // decisions answered by replaying the legacy choice (hints.ts) are not "defaulted": a diff after them is a real difference, listed as `hintedDecisions`
    const defaulted = { ...(run.defaulted.length ? { defaultedDecisions: run.defaulted, choiceDependent: true } : {}), ...(run.hinted.length ? { hintedDecisions: run.hinted } : {}), ...(run.defaultedPrompts ? { defaultedPrompts: run.defaultedPrompts } : {}) };
    const diffs: Diff[] = [...gapDiffs];

    if (run.error) {
      const e = run.error;
      if (opts.legacyAccepted === false) return { mapped, run, outcome: { kind: "agree", intentType: meta.actionType, seat: b.seat, diffs } };
      if (e.code === "unsupported") {
        const caps = e.capability?.length ? e.capability : ["unknown"];
        for (const c of caps) diffs.push(mk(`unsupported_capability:${c}`, `kernel cannot run it: ${e.message}`, { cards: involved, kernelError: e, ...defaulted }));
        return { mapped, run, outcome: { kind: "disagree", intentType: meta.actionType, seat: b.seat, diffs } };
      }
      diffs.push(mk("kernel_rejected_legal_action", `kernel refused (${e.code}): ${e.message}`, { cards: involved, kernelError: e, ...defaulted, context: { kernelAction: run.failedAction, board: boardDump(s0, s1, mapped, meta, a0, opts.lookup) } }));
      return { mapped, run, outcome: { kind: "disagree", intentType: meta.actionType, seat: b.seat, diffs } };
    }
    if (opts.legacyAccepted === false) {
      diffs.push(mk("kernel_accepted_illegal_action", "the legacy engine refused / ignored this action but the kernel accepted it", { cards: involved, ...defaulted }));
      return { mapped, run, outcome: { kind: "disagree", intentType: meta.actionType, seat: b.seat, diffs } };
    }
    const ls = snapshotLegacy(s1, a1, opts.lookup);
    const ks = snapshotKernel(run.state, opts.lookup);
    const skip = fieldsSkippedFor(mapped, s0);
    if (opts.settled) for (const f of ["phase", "turn", "active_player", "combat"]) skip.add(f);
    const fd = diffSnapshots(ls, ks, skip);
    const dormant = fd.length ? unsupportedOnBoard(s0, opts.lookup) : {};
    for (const f of fd) {
      diffs.push(mk(`state_mismatch:${f.field}`, `${f.field} differs${f.seat ? ` for ${f.seat}` : ""}`, { field: f.field, cards: f.cards, legacy: f.legacy, kernel: f.kernel, ...defaulted, ...(f.seat || Object.keys(dormant).length ? { context: { ...(f.seat ? { player: f.seat } : {}), ...(Object.keys(dormant).length ? { unsupportedOnBoard: dormant } : {}), ...(f.field === "tapped" && mapped.kind === "cast" ? { board: boardDump(s0, s1, mapped, meta, a0, opts.lookup) } : {}) } } : {}) }));
    }
    return { mapped, run, outcome: { kind: fd.length ? "disagree" : "agree", intentType: meta.actionType, seat: b.seat, diffs } };
  } catch (error) {
    const b = base(mapped);
    return { mapped, outcome: { kind: "skipped", intentType: meta.actionType, reason: "observer_error", seat: b.seat, diffs: [{ ...b, category: "observer_error", cards: [], message: error instanceof Error ? `${error.message}\n${(error.stack ?? "").split("\n").slice(1, 4).join("\n")}` : String(error) }] } };
  }
}

/** Convenience for tests: normalised comparison of two kernel states (no legacy involved). */
export function compareKernelStates(a: GameState, b: GameState, lookup: DraftLookup): FieldDiff[] {
  return diffSnapshots(snapshotKernel(a, lookup), snapshotKernel(b, lookup));
}

export type { VisibleCard };
