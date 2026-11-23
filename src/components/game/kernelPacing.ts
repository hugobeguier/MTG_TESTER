// Pacing for kernel mode: how long the table SHOWS what just happened before the next automatic step (an AI action, the human's auto-pass) is taken.
// Pure and clock-driven (no React, no timers of its own): the controller notes a visible change, the driver waits `remaining()` before stepping.
//   - one wait per visible change: a spell cast / ability activated / trigger put on the stack ("push"), an item resolving / countering / fizzling ("resolve"),
//     attackers or blockers declared ("combat"), combat damage ("damage"), a land drop ("land"); a bare phase change stays fast ("phase", <= 400 ms)
//   - speed setting Off / Fast 800 / Normal 2500 / Slow 4000 ms per stack item (persisted); the other kinds are fractions of that
//   - skip() ends the current wait now, cancel() drops it (a decision or the human's own window opened); a per-turn budget stops it from ever dragging on
//   - disabled (headless, tests, observers): every delay is 0 and nothing is ever waited for
export type PaceSpeed = "off" | "fast" | "normal" | "slow";
export type PaceKind = "push" | "resolve" | "combat" | "damage" | "land" | "phase" | "none";

export const PACE_ITEM_MS: Record<PaceSpeed, number> = { off: 0, fast: 800, normal: 2500, slow: 4000 };
export const PACE_SPEEDS: PaceSpeed[] = ["off", "fast", "normal", "slow"];
export const DEFAULT_PACE_SPEED: PaceSpeed = "normal";
/** a bare phase / step change is never held longer than this */
export const PHASE_PACE_CAP_MS = 400;
/** total waiting the clock hands out per turn (it never drags a turn on forever) */
export const PACE_TURN_BUDGET_MS = 60000;

/** how long to show a visible change of this kind at this speed */
export function delayFor(kind: PaceKind, speed: PaceSpeed): number {
  const item = PACE_ITEM_MS[speed];
  if (!item) return 0;
  switch (kind) {
    case "push": case "resolve": return item;
    case "combat": case "damage": return Math.round(item * 0.6); // Normal: 1500 ms
    case "land": return Math.round(item * 0.4);
    case "phase": return Math.min(PHASE_PACE_CAP_MS, Math.round(item * 0.15));
    default: return 0;
  }
}

/** the few facts about a game state that decide what a step looked like (plain data: the controller fills it from the kernel state) */
export interface PaceSnap {
  stack: string[];
  turn: number;
  phase: string;
  attackers: number;
  blockers: number;
}

/** what the player just SAW happen between two snapshots (priority order: stack changes, combat, damage, land, phase) */
export function classifyChange(prev: PaceSnap, next: PaceSnap, action?: { type: string }): PaceKind {
  if (next.stack.length > prev.stack.length) return "push";
  if (prev.stack.some((id) => !next.stack.includes(id))) return "resolve";
  if (action?.type === "declareAttackers" && next.attackers > prev.attackers) return "combat";
  if (action?.type === "declareBlockers" && next.blockers > prev.blockers) return "combat";
  if (next.phase !== prev.phase && /damage/.test(next.phase) && next.turn === prev.turn) return "damage";
  if (action?.type === "playLand") return "land";
  if (next.phase !== prev.phase || next.turn !== prev.turn) return "phase";
  return "none";
}

export interface PacingOptions {
  speed?: PaceSpeed;
  /** false = headless / nobody watching: no waits at all */
  enabled?: boolean;
  now?: () => number;
  turnBudgetMs?: number;
  /** called when the speed changes (the app persists it) */
  onSpeed?: (speed: PaceSpeed) => void;
}

export class PacingClock {
  speed: PaceSpeed;
  enabled: boolean;
  private until = 0;
  private spentTurn = -1;
  private spent = 0;
  private readonly now: () => number;
  private readonly budget: number;
  private readonly onSpeed?: (speed: PaceSpeed) => void;
  /** the kind of the wait in progress (for the UI) */
  kind: PaceKind = "none";

  constructor(o: PacingOptions = {}) {
    this.speed = o.speed ?? DEFAULT_PACE_SPEED;
    this.enabled = o.enabled ?? true;
    this.now = o.now ?? (() => Date.now());
    this.budget = o.turnBudgetMs ?? PACE_TURN_BUDGET_MS;
    this.onSpeed = o.onSpeed;
  }

  setSpeed(speed: PaceSpeed): void {
    this.speed = speed;
    if (speed === "off") this.cancel();
    try { this.onSpeed?.(speed); } catch { /* storage problems never reach the game */ }
  }

  /** a visible change happened this turn: hold the next automatic step for its delay (the longest pending wait wins; the turn budget caps the total). Returns the ms added. */
  note(kind: PaceKind, turn: number): number {
    if (!this.enabled) return 0;
    if (turn !== this.spentTurn) { this.spentTurn = turn; this.spent = 0; }
    const want = Math.min(delayFor(kind, this.speed), Math.max(0, this.budget - this.spent));
    if (want <= 0) return 0;
    const t = this.now();
    const end = Math.max(this.until, t + want);
    this.spent += Math.max(0, end - Math.max(this.until, t));
    this.until = end;
    this.kind = kind;
    return want;
  }

  /** ms still to wait before the next automatic step (0 = go) */
  remaining(): number { return this.enabled ? Math.max(0, this.until - this.now()) : 0; }
  get active(): boolean { return this.remaining() > 0; }
  /** the human sped past the wait */
  skip(): void { this.until = 0; this.kind = "none"; }
  /** a decision / the human's own window opened: nothing to wait for any more */
  cancel(): void { this.until = 0; this.kind = "none"; }
}

const STORAGE_KEY = "mtg-kernel-pace";

export function loadPaceSpeed(): PaceSpeed {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    return PACE_SPEEDS.includes(raw as PaceSpeed) ? (raw as PaceSpeed) : DEFAULT_PACE_SPEED;
  } catch { return DEFAULT_PACE_SPEED; }
}

export function savePaceSpeed(speed: PaceSpeed): void {
  try { if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, speed); } catch { /* storage unavailable */ }
}

/** the clock the app uses: the persisted speed, saving every change */
export function appPacingClock(): PacingClock {
  return new PacingClock({ speed: loadPaceSpeed(), onSpeed: savePaceSpeed });
}
