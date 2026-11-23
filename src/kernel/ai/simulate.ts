// Lookahead for the kernel AI: "if I take this action, what does the position look like once the stack has resolved?" on a CLONE of the real state
// (resolve never touches its input). Pure and deterministic: no Math.random, no clock; the budget is a count of `resolve` calls (Work), not milliseconds,
// so the same state always gives the same choice. Sub-decisions the action opens (X, modes, targets, optional costs / life payments, yes-no, picks) are
// BRANCHED (a handful of sensible candidates each) when they belong to the acting seat, answered by a fast policy otherwise.
import { resolve } from "../engine/resolve";
import { defaultAnswer } from "../observer/actions";
import { effectiveViews } from "../engine/legal";
import { objectValue } from "./evaluate";
import type { Action, Choice, DecisionKind, EngineContext, GameState, PendingView, PlayerId } from "../engine/types";

export interface Work { n: number; cap: number }
export interface ScriptEntry { kind: DecisionKind; choice: Choice }
export interface Leaf { state: GameState; script: ScriptEntry[]; settled: boolean }

const STEP_CAP = 60;
const isObj = (id: string): boolean => id.startsWith("#");

/** the options of a decision as things with an owner / value: objects by controller + value, players by life */
function ranked(p: PendingView, state: GameState, ctx: EngineContext, who: PlayerId): Array<{ id: string; own: boolean; value: number }> {
  return p.options.map((o) => {
    const id = o.id;
    if (isObj(id)) { const ob = state.objects[id]; return { id, own: !!ob && (ob.zone === "battlefield" ? ob.controller === who : ob.owner === who), value: objectValue(state, ctx, id) }; }
    const pl = state.players.find((x) => x.id === id);
    return { id, own: id === who, value: pl ? 10 - pl.life / 10 : 0 };
  });
}

/** Fast deterministic answer (no lookahead): targets go to the other side's best, picks give up the least valuable, "may" yes, "unless" no. */
export function policyAnswer(p: PendingView, state: GameState, ctx: EngineContext, who: PlayerId): Choice {
  switch (p.kind) {
    case "choose_yes_no": return { yes: true };
    case "pay_unless": return { yes: false };
    case "choose_targets": case "cast_target_player": {
      const r = ranked(p, state, ctx, who).sort((a, b) => Number(a.own) - Number(b.own) || b.value - a.value);
      const n = Math.max(p.min, Math.min(1, p.max));
      return { ids: r.slice(0, n).map((x) => x.id) };
    }
    case "choose_cards": {
      const r = ranked(p, state, ctx, who).sort((a, b) => a.value - b.value);
      return { ids: r.slice(0, Math.max(p.min, 0)).map((x) => x.id) };
    }
    default: {
      const c = defaultAnswer(p, state, who);
      if (c) return c;
      if (p.kind === "assign_mana" && p.mana) return { assign: { [p.mana.colors[0]]: p.mana.total } };
      if (p.kind === "assign_counters" && p.counters) {
        const first = Object.keys(p.counters.available)[0];
        return { assign: first ? { [first]: Math.min(p.counters.available[first], Math.max(p.counters.min, 0)) } : {} };
      }
      return p.cancellable ? { cancel: true } : { ids: [] };
    }
  }
}

function thin<T>(xs: T[], k: number): T[] {
  if (xs.length <= k) return xs;
  if (k <= 1) return xs.slice(0, 1);
  const out: T[] = [];
  for (let i = 0; i < k; i++) out.push(xs[Math.round((i * (xs.length - 1)) / (k - 1))]);
  return [...new Set(out)];
}

function subsets(ids: string[], min: number, max: number, cap: number): string[][] {
  const out: string[][] = [];
  const rec = (start: number, cur: string[]) => {
    if (out.length >= cap) return;
    if (cur.length >= min && cur.length <= max && (cur.length > 0 || min === 0)) out.push([...cur]);
    if (cur.length >= max) return;
    for (let i = start; i < ids.length; i++) { cur.push(ids[i]); rec(i + 1, cur); cur.pop(); }
  };
  rec(0, []);
  return out;
}

/** Candidate answers of the acting seat for a decision, the policy answer first. Empty = not worth branching (use the policy). */
export function candidates(p: PendingView, state: GameState, ctx: EngineContext, who: PlayerId): Choice[] {
  if (p.numeric) {
    const lo = Math.max(p.min, 0), hi = Math.min(p.max < 0 ? 40 : p.max, 60);
    if (hi < lo) return [];
    const set = new Set<number>([hi, Math.floor((lo + hi) / 2), 1, 2, 3]);
    const views = effectiveViews(state, ctx, state.battlefield);
    for (const v of Object.values(views)) if (v.types.includes("creature") && v.toughness !== undefined) { set.add(Math.max(1, v.toughness)); set.add(Math.max(1, v.toughness) + 1); }
    for (const pl of state.players) if (pl.id !== who && !pl.hasLost && pl.life <= hi) set.add(Math.max(1, pl.life));
    let xs = [...set].filter((x) => x >= lo && x <= hi).sort((a, b) => a - b);
    if (xs.length > 1 && xs[0] === 0) xs = xs.slice(1); // 0 is almost always a no-op: only when nothing else is possible
    if (!xs.length) xs = [lo];
    return thin(xs, 8).map((number) => ({ number }));
  }
  const pol = policyAnswer(p, state, ctx, who);
  const out: Choice[] = [pol];
  const add = (c: Choice) => { if (!out.some((x) => JSON.stringify(x) === JSON.stringify(c))) out.push(c); };
  const maxN = p.max < 0 ? p.options.length : p.max;
  switch (p.kind) {
    case "choose_yes_no": case "pay_unless": add({ yes: !pol.yes }); return out;
    case "choose_targets": case "cast_target_player": {
      const r = ranked(p, state, ctx, who);
      const k = Math.max(p.min, Math.min(1, maxN));
      const opp = r.filter((x) => !x.own && isObj(x.id)).sort((a, b) => b.value - a.value);
      const mine = r.filter((x) => x.own && isObj(x.id)).sort((a, b) => b.value - a.value);
      const pls = r.filter((x) => !isObj(x.id)).sort((a, b) => Number(a.own) - Number(b.own) || b.value - a.value);
      if (k <= 1) {
        for (const x of [...opp.slice(0, 2), ...pls.slice(0, 2), ...mine.slice(0, 2), ...opp.slice(2, 3), ...mine.slice(2, 3), ...pls.slice(2)]) add({ ids: [x.id] });
        if (p.min === 0) add({ ids: [] });
      } else {
        add({ ids: [...opp, ...pls, ...mine].slice(0, Math.min(maxN, r.length)).map((x) => x.id) });
        add({ ids: [...opp, ...pls, ...mine].slice(0, k).map((x) => x.id) });
        add({ ids: [...mine, ...pls, ...opp].slice(0, k).map((x) => x.id) });
        if (p.min === 0) add({ ids: [] });
      }
      return out.slice(0, 7);
    }
    case "choose_modes": {
      const ids = p.options.map((o) => o.id);
      for (const s of subsets(ids, p.min, maxN, 24)) add({ ids: s });
      return out.slice(0, 16);
    }
    case "choose_cards": case "choose_option": case "choose_cast_option": {
      if (p.repeatable) return [];
      const r = ranked(p, state, ctx, who).sort((a, b) => a.value - b.value);
      const lo = Math.max(p.min, 0), hi = Math.min(maxN, r.length);
      const sizes = [...new Set([lo, hi])].filter((n) => n >= 0 && n <= r.length);
      if (hi === 1 && lo <= 1 && r.length <= 8) { for (const x of r) add({ ids: [x.id] }); if (lo === 0) add({ ids: [] }); return out; }
      for (const n of sizes) { add({ ids: r.slice(0, n).map((x) => x.id) }); add({ ids: r.slice(r.length - n).map((x) => x.id) }); }
      return out.slice(0, 5);
    }
    default: return [];
  }
}

function step(s: GameState, a: Action, ctx: EngineContext, work: Work): GameState | undefined {
  work.n++;
  try { const r = resolve(s, a, ctx); return r.error ? undefined : r.state; } catch { return undefined; }
}

/**
 * Apply `action` on a clone and follow it through: sub-decisions (branched for `seat`, policy for others), then pass priority until the stack is empty.
 * Returns the end states (leaves) with the answers that led to each. `forced` replays a recorded script instead of branching (same kind order).
 */
export function explore(state: GameState, action: Action, ctx: EngineContext, seat: PlayerId, work: Work, opts: { maxLeaves?: number; branch?: boolean; forced?: ScriptEntry[] } = {}): Leaf[] {
  const leaves: Leaf[] = [];
  const branch = opts.branch !== false;
  const first = step(state, action, ctx, work);
  if (!first) return leaves;
  const walk = (s0: GameState, script0: ScriptEntry[], cap: number, forced: ScriptEntry[]): void => {
    let s = s0, script = script0, steps = 0;
    const fq = [...forced];
    for (;;) {
      if (steps++ > STEP_CAP || work.n >= work.cap) { leaves.push({ state: s, script, settled: false }); return; }
      const p = s.pending;
      if (p) {
        const owner = p.player;
        const view: PendingView = { ...p };
        if (fq.length && fq[0].kind === p.kind && owner === seat) {
          const c = fq.shift()!.choice;
          const r = step(s, { type: "answerDecision", player: owner, decisionId: p.id, choice: c }, ctx, work);
          if (!r) { leaves.push({ state: s, script, settled: false }); return; }
          s = r; script = [...script, { kind: p.kind, choice: c }]; continue;
        }
        const cands = owner === seat && branch && cap > 1 && !fq.length ? candidates(view, s, ctx, seat) : [];
        if (cands.length > 1) {
          const use = thin(cands, Math.min(cands.length, cap));
          const per = Math.max(1, Math.floor(cap / use.length));
          for (const c of use) {
            const r = step(s, { type: "answerDecision", player: owner, decisionId: p.id, choice: c }, ctx, work);
            if (r) walk(r, [...script, { kind: p.kind, choice: c }], per, []);
          }
          return;
        }
        const c = cands[0] ?? policyAnswer(view, s, ctx, owner);
        let r = step(s, { type: "answerDecision", player: owner, decisionId: p.id, choice: c }, ctx, work);
        if (!r) r = step(s, { type: "answerDecision", player: owner, decisionId: p.id, choice: p.cancellable ? { cancel: true } : { ids: [] } }, ctx, work);
        if (!r) { leaves.push({ state: s, script, settled: false }); return; }
        if (owner === seat && cands[0]) script = [...script, { kind: p.kind, choice: c }];
        s = r;
        continue;
      }
      if (s.gameOver || s.combat?.expect || s.stack.length === 0) { leaves.push({ state: s, script, settled: true }); return; }
      if (!s.priority) { leaves.push({ state: s, script, settled: false }); return; }
      const r = step(s, { type: "passPriority", player: s.priority, fastForward: true }, ctx, work);
      if (!r) { leaves.push({ state: s, script, settled: false }); return; }
      s = r;
    }
  };
  walk(first, [], opts.maxLeaves ?? 8, opts.forced ?? []);
  return leaves;
}

/** The same position with every library in the opposite order: a cheap deterministic way to see whether an outcome depends on hidden information. */
export function withReversedLibraries(state: GameState): GameState {
  const s = structuredClone(state);
  for (const p of s.players) p.library.reverse();
  return s;
}
