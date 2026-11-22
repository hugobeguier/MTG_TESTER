// The stateful observer: attach `observer.onAction` to the self-play orchestrator's `onAction` hook (or call it from a replay / live hook).
// It never throws and never mutates the sessions it is given. Consecutive attack declarations (and block declarations) of one combat are
// grouped, because the kernel declares all attackers / all blockers in a single action.
import type { GameSession } from "../../lib/types";
import type { EngineContext } from "../engine/types";
import { createEngine } from "../engine";
import { compareIntent } from "./compare";
import { classifyAction } from "./knownLegacy";
import type { DraftLookup } from "./draftLookup";
import { Aggregate } from "./report";
import type { Diff, ObserverMeta, StepOutcome } from "./types";

export interface ObserverOptions {
  lookup: DraftLookup;
  game?: number;
  seed?: number;
  decks?: string[];
  /** seat id -> deck name, for the per-deck readiness numbers */
  deckOfSeat?: Record<string, string>;
  /** receives every diff as it is found (e.g. appends a JSONL line); exceptions are swallowed */
  sink?: (diff: Diff) => void;
  aggregate?: Aggregate;
  lenient?: boolean;
  /** stop comparing after this many diffs in one game (keeps one pathological game from flooding the output) */
  maxDiffsPerGame?: number;
}

interface Group { type: "attack" | "block"; s0: GameSession; s1: GameSession; meta: ObserverMeta }
/** casts and land plays whose result is compared against the legacy state at the START of the next action (see `settle`) */
const SETTLED_TYPES = new Set(["play_land", "cast_spell", "cast_commander"]);

export class KernelObserver {
  readonly aggregate: Aggregate;
  readonly ctx: EngineContext;
  private actionIndex = 0;
  private group?: Group;
  private deferred?: Group;
  private seenGaps = new Set<string>();
  private seenNoDraft = new Set<string>();
  private diffCount = 0;
  readonly outcomes: StepOutcome[] = [];
  /** keep outcomes in memory (tests); the CLI leaves it off */
  keepOutcomes = false;

  constructor(private readonly opts: ObserverOptions) {
    this.aggregate = opts.aggregate ?? new Aggregate();
    this.ctx = createEngine(opts.lookup.lookup, opts.lookup.db).ctx;
  }

  /** the orchestrator's `onAction(prev, next, meta)` signature */
  readonly onAction = (prev: GameSession, next: GameSession, meta: ObserverMeta): void => {
    try {
      this.settle(prev);
      if (meta.actionType === "attack" || meta.actionType === "block") {
        if (this.group && this.group.type === meta.actionType) { this.group.s1 = next; this.group.meta = meta; return; }
        this.flush();
        this.group = { type: meta.actionType, s0: prev, s1: next, meta };
        return;
      }
      this.flush();
      if (SETTLED_TYPES.has(meta.actionType)) { this.deferred = { type: "attack", s0: prev, s1: next, meta }; return; }
      this.process(prev, next, meta);
    } catch (error) {
      this.safeSink({ category: "observer_error", game: this.opts.game ?? 0, actionIndex: this.actionIndex, turn: prev.turn, phase: prev.phase, seat: meta.seatId, intent: { type: meta.actionType }, cards: [], message: String(error) });
    }
  };

  /** call at the end of a game: compares a still-open attack / block group */
  finish(): void {
    try { this.settle(undefined); this.flush(); } catch { /* never reaches the caller */ }
  }

  /**
   * The legacy engine queues the enters-the-battlefield / cast triggers of a spell or land and drains them lazily (its first action of the next
   * step): the state right after the action still has them pending, while the kernel resolves everything. So a cast / land play is compared with
   * the legacy state at the START of the following action, once the queue was drained (same turn and same active player only; otherwise the
   * state right after the action is used). Phase / turn / active player are not compared for such a settled state.
   */
  private settle(nextPrev: GameSession | undefined): void {
    const d = this.deferred;
    if (!d) return;
    this.deferred = undefined;
    const same = !!nextPrev && nextPrev.turn === d.s1.turn && nextPrev.activePlayerId === d.s1.activePlayerId && nextPrev.status !== "complete";
    this.process(d.s0, same ? nextPrev! : d.s1, d.meta, same);
  }

  private flush(): void {
    const g = this.group;
    if (!g) return;
    this.group = undefined;
    this.process(g.s0, g.s1, g.meta);
  }

  private process(s0: GameSession, s1: GameSession, meta: ObserverMeta, settled = false): void {
    if (this.opts.maxDiffsPerGame !== undefined && this.diffCount >= this.opts.maxDiffsPerGame) return;
    const index = this.actionIndex++;
    const { outcome } = compareIntent(s0, s1, meta, { lookup: this.opts.lookup, ctx: this.ctx, game: this.opts.game, seed: this.opts.seed, decks: this.opts.decks, actionIndex: index, lenient: this.opts.lenient, settled });
    outcome.deck = this.opts.deckOfSeat?.[outcome.seat];
    const kept: Diff[] = [];
    for (const d of outcome.diffs) {
      if (d.category === "adapter_gap") { const k = d.field ?? d.message; if (this.seenGaps.has(k)) continue; this.seenGaps.add(k); }
      if (d.category === "no_draft") { const fresh = d.cards.filter((c) => !this.seenNoDraft.has(c)); if (!fresh.length) continue; fresh.forEach((c) => this.seenNoDraft.add(c)); d.cards = fresh; }
      kept.push(d);
    }
    outcome.diffs = kept;
    // what the legacy engine said happened during this action (its event log delta, oldest first): the first thing to read when classifying a diff
    if (kept.length && kept.some((d) => d.category.startsWith("state_mismatch") || d.category === "kernel_rejected_legal_action")) {
      const seen = new Set(s0.events.map((e) => e.id));
      const delta = s1.events.filter((e) => !seen.has(e.id)).map((e) => e.message.slice(0, 220)).reverse().slice(-14);
      const boards = Object.fromEntries(s0.seats.map((st) => [st.id, st.board.battlefield.map((c) => c.name)]));
      kept[0].context = { ...(kept[0].context ?? {}), ...(delta.length ? { legacyLog: delta } : {}), boardBefore: boards };
    }
    if (outcome.kind === "disagree") { const rule = classifyAction(kept); if (rule) { outcome.knownLegacy = rule.id; for (const d of kept) d.knownLegacy = rule.id; } }
    this.aggregate.addOutcome(outcome);
    for (const d of kept) { this.diffCount += 1; this.aggregate.addDiff(d); this.safeSink(d); }
    if (this.keepOutcomes) this.outcomes.push(outcome);
  }

  private safeSink(d: Diff): void {
    try { this.opts.sink?.(d); } catch { /* ignore */ }
  }
}
