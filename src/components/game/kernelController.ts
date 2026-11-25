// KernelGameController: everything the UI does to ONE kernel game, as a plain class (no React) so it is testable headless.
//   - owns the KernelSession (the only truth), the human's seat, and the table-side bits the kernel does not have (log notes, attack / block picks)
//   - table(): the TableState the 3D table renders (session + stack + decision), with stable object identity until something changes
//   - the intent API: the same `on*` callback names ThreeGameTable already takes (tableProps()); intents with no kernel meaning are inert and leave a log note
//   - step(): ONE action for whoever the engine waits for when that is not a human decision: AI seats (kernelAi.ts) and the human's automatic passes
//   - startDriver(): paces step() with timers (the hook useKernelDriver owns its lifetime); never loops forever (per-turn cap, stall guard)
// A rejected action never changes anything (KernelSession.dispatch returns the old state); the controller turns the refusal into a log note.
import type { KernelSession, DispatchResult } from "@/kernel/integration/kernelSession";
import type { DecisionView, TableState } from "@/kernel/integration/tableState";
import type { KernelBoardPick, PendingActionView, StackFeedEntry } from "@/components/ThreeGameTable";
import { classifyChange, type PaceSnap, type PacingClock } from "./kernelPacing";
import { boardPickModel, canConfirm, castHint, classifyDecision, confirmLabel, pickChoice, selectionHint, toggleSelection } from "./kernelDecisionView";
import { legalActions, type LegalAction } from "@/kernel/engine/legal";
import { resolve } from "@/kernel/engine/resolve";
import type { Action, Choice, GameState, ObjId, PlayerId } from "@/kernel/engine/types";
import type { GameEvent as LogLine, GameSession, VisibleCard } from "@/lib/types";
import { chooseAiAction, freshMemory, quickAiAction, type AiMemory } from "./kernelAi";
import { adoptMemory, fromWire, toWire, type AiRunner } from "./kernelAiWork";
import { evaluateWindow, hasResponse, type WindowVerdict } from "./kernelStops";
import { DEFAULT_STOP_SETTINGS, stopKey, type PriorityStopSettings } from "@/lib/priorityStops";
import { toggleYield, type SeatYield } from "@/engine/yieldPolicy";
import { stackSession, type StackIndex } from "./tokenStacks";
import { paymentOf, payableSources, suggestionFor } from "./kernelPayment";
import { saveGameLog } from "./kernelGameLog";
import { DEBUG_ACTION_PREFIX, debugCardAction, debugOptionAction, type DebugInput } from "./kernelDebug";

/** the driver never takes more than this many automatic actions in one turn (a loop guard, not a rule) */
export const MAX_AUTO_ACTIONS_PER_TURN = 150;

/** One way to tap a permanent for mana: the button key (a colour, or a whole alternative like WB), its cost note, and the action that does it */
export interface ManaWay { key: string; hint?: string; action: Action }

/**
 * The ways to tap a permanent for mana, read from the ability texts of its legal mana abilities ("{T}: Add {W} or {U}. This artifact deals 1 damage to you."):
 * one way per listed alternative (the action carries the chosen colour), each noting the damage / life loss it costs. Any-colour mana is ONE way (the engine asks the colour).
 */
export function manaWays(entries: LegalAction[]): ManaWay[] {
  const out: ManaWay[] = [];
  for (const entry of entries) {
    if (!entry.action || entry.action.type !== "activateAbility") continue;
    const text = entry.label.slice(entry.label.indexOf(": ") + 2);
    const hurt = text.match(/deals? (\d+) damage to you|you lose (\d+) life/i);
    const hint = hurt ? `${hurt[1] ?? hurt[2]} damage to you` : undefined;
    const clause = text.match(/\badd\s+([^.]*)\./i)?.[1] ?? "";
    const alts = clause.split(/\s+or\s+|,\s*(?:or\s+)?/).map((alt) => alt.match(/\{[^}]+\}/g) ?? []).filter((symbols) => symbols.length > 0);
    const strip = (symbols: string[]) => symbols.map((x) => x.replace(/[{}]/g, "")).join("");
    // the kernel's own reading of what the ability produces wins over its text: a land split into two abilities ({U} / {B}) can carry the whole card text on each
    const real = entry.manaOptions;
    if (real?.length) {
      if (real.length > 1) for (const o of real) out.push({ key: o, ...(hint ? { hint } : {}), action: { ...entry.action, color: o } });
      else out.push({ key: alts.length === 1 ? strip(alts[0]) : real[0], ...(hint ? { hint } : {}), action: entry.action });
      continue;
    }
    if (alts.length > 1) for (const alt of alts) out.push({ key: strip(alt), ...(hint ? { hint } : {}), action: { ...entry.action, color: strip(alt) } });
    else out.push({ key: alts.length === 1 ? strip(alts[0]) : "Any", ...(hint ? { hint } : {}), action: entry.action });
  }
  const seen = new Set<string>();
  return out.filter((way) => (seen.has(way.key) ? false : (seen.add(way.key), true)));
}

export interface AttackerOption { id: string; name: string; defenders: Array<{ id: string; label: string }>; mustAttack: boolean }
export interface BlockerOption { id: string; name: string; attackers: Array<{ id: string; name: string }> }
export type Declaration =
  | { kind: "attackers"; attackers: AttackerOption[]; picks: Record<string, string> }
  | { kind: "blockers"; blockers: BlockerOption[]; picks: Record<string, string[]> };

export interface ControllerOptions {
  human: PlayerId;
  /** pace(baseMs) -> real ms (agentPaceMs in the app, 0 in tests) */
  pace?: (baseMs: number) => number;
  /** the human's priority-stop settings (default: the legacy defaults) and where changes are saved (the app passes localStorage; tests pass nothing) */
  stops?: PriorityStopSettings;
  saveStops?: (settings: PriorityStopSettings) => void;
  /** pacing (kernelPacing.ts): how long each visible change (a cast, a trigger, a resolution, combat) is shown before the next automatic step. Absent = no waiting (tests, headless). */
  pacing?: PacingClock;
}

type Timer = ReturnType<typeof setTimeout>;
type CardRef = { id: string; name: string };

export class KernelGameController {
  readonly ks: KernelSession;
  readonly human: PlayerId;
  private readonly pace: (ms: number) => number;
  private listeners = new Set<() => void>();
  private ver = 0;
  private notes: LogLine[] = [];
  private noteSeq = 0;
  /** table-side selection state (the legacy AppFlow keeps these in React state) */
  selectedCardId: string | undefined;
  inspectedCard: VisibleCard | undefined;
  selectHandCard = (card: VisibleCard): void => { this.selectedCardId = this.selectedCardId === card.id ? undefined : card.id; this.bump(); };
  inspectCard = (card: VisibleCard): void => {
    // clicking my own permanent that I just tapped for mana (mana unspent, nothing cast since) takes the tap back, like in the legacy table
    if (this.canUntapForMana(card.id)) { this.untapForMana(this.human, card.id); return; }
    this.stackChosen = undefined;
    this.inspectedCard = card; this.bump();
  };
  closeInspect = (): void => { this.stackChosen = undefined; this.inspectedCard = undefined; this.bump(); };

  // ------------------------------------------------------------------ token stacks (tokenStacks.ts)
  /** how the table's token stacks map to members; rebuilt by every table() */
  private stackIndex: StackIndex = { members: new Map(), repOf: new Map() };
  /** the session before stacking: what the legacy block modal lists, one card per token */
  private rawSession?: GameSession;
  /** how many tokens of the open stack the player chose (undefined = automatic: all for an attack, one for an ability or a mana tap) */
  private stackChosen?: number;
  /** the ids (table ids) of the tokens a card stands for: itself unless it is a stack's card or one of its members, sorted, so "first N" is deterministic */
  stackMembers(cardId: string): string[] {
    this.table();
    const rep = this.stackIndex.repOf.get(cardId) ?? cardId;
    return this.stackIndex.members.get(rep) ?? [cardId];
  }
  setStackChosen = (n: number | undefined): void => {
    const size = this.inspectedCard ? this.stackMembers(this.inspectedCard.id).length : 1;
    this.stackChosen = n === undefined ? undefined : Math.max(1, Math.min(size, Math.floor(n)));
    this.bump();
  };
  /** the count selector's data for the open inspector (only for a stack of 2+) */
  private inspectedStack(): { count: number; chosen: number | undefined; onChange: (n: number | undefined) => void } | undefined {
    if (!this.inspectedCard) return undefined;
    const count = this.stackMembers(this.inspectedCard.id).length;
    return count > 1 ? { count, chosen: this.stackChosen, onChange: this.setStackChosen } : undefined;
  }
  /** the first `n` members (kernel ids) of a card's stack that pass `ok` */
  private firstN(cardId: string, ok: (id: ObjId) => boolean, n: number): ObjId[] {
    return this.stackMembers(cardId).map((m) => this.kid(m)).filter(ok).slice(0, n);
  }
  /** the table ids picked right now (board pick or blockers), to show "2/5" on a stack */
  private pickedMemberIds(ts: TableState): Set<string> {
    const out = new Set<string>();
    const d = ts.decision;
    if (d && this.pickSel?.id === d.id && !this.pickSel.list) {
      const chosen = new Set(this.pickSel.ids);
      for (const [cardId, opt] of Object.entries(boardPickModel(d).cardOptions)) if (chosen.has(opt)) out.add(cardId);
    }
    const att = this.declaration()?.kind === "blockers" ? this.currentAttacker() : undefined;
    if (att) for (const b of this.blockPicks[att] ?? []) out.add(this.ks.legacyIdOf(b) ?? b);
    return out;
  }
  private withStackSelection(session: GameSession, picked: Set<string>): GameSession {
    if (!picked.size) return session;
    let changed = false;
    const seats = session.seats.map((seat) => {
      if (!seat.board.battlefield.some((c) => c.stackIds?.some((i) => picked.has(i)))) return seat;
      changed = true;
      return { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((c) => (c.stackIds ? { ...c, stackSelected: c.stackIds.filter((i) => picked.has(i)).length } : c)) } };
    });
    return changed ? { ...session, seats } : session;
  }
  private attackPicks: Record<string, string> = {};
  /** attacker (kernel id) -> its blockers (kernel ids) in the order they were tapped: that order is the damage-assignment order, as in the legacy modal */
  private blockPicks: Record<string, string[]> = {};
  /** the legacy modal asks about one attacker at a time: the index into blockQueue() */
  private blockIdx = 0;
  private toKernel = new Map<string, ObjId>();
  private tableCache?: { ver: number; table: TableState };
  private mergedCache?: { base: GameSession; notes: LogLine[]; session: GameSession };
  private declCache?: { ver: number; picks: string; decl: Declaration | undefined };
  private autoTurn = { turn: -1, count: 0 };
  private memory: AiMemory = { banned: new Set() };
  private memoryTurn = -1;
  private failures = 0;
  private stalledAt = -1;
  private timer?: Timer;
  private running = false;
  /** priority stops (phase 6): the settings, the running yield, and "Stop Next" (armed at a game version; it opens the first window after that version) */
  private stopSettings: PriorityStopSettings;
  private saveStops?: (settings: PriorityStopSettings) => void;
  private yielding?: SeatYield;
  private holdArmedAt?: number;
  private legalCache?: { ver: number; list: LegalAction[] };
  /** pacing: the clock (undefined = never wait), the stack items that just resolved (for the dock's "what it did" rows), and the driver's timer clearer */
  readonly pacing?: PacingClock;
  private resolvedFeed: StackFeedEntry[] = [];
  private feedCache?: { ver: number; feed: StackFeedEntry[] };
  private driverClear?: (t: Timer) => void;

  constructor(ks: KernelSession, o: ControllerOptions) {
    this.ks = ks;
    this.human = o.human;
    this.pace = o.pace ?? ((ms) => ms);
    this.stopSettings = { ...(o.stops ?? DEFAULT_STOP_SETTINGS), fullControl: false };
    this.saveStops = o.saveStops;
    this.pacing = o.pacing;
    for (const id of Object.keys(ks.state.objects)) { const legacy = ks.legacyIdOf(id); if (legacy) this.toKernel.set(legacy, id); }
  }

  // ------------------------------------------------------------------ subscription (useSyncExternalStore)

  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = (): number => this.ver;
  private bump(): void {
    this.ver++;
    for (const l of [...this.listeners]) { try { l(); } catch { /* a broken subscriber must not break the game */ } }
  }

  // ------------------------------------------------------------------ reading

  /** the kernel id of a card id the table sent (legacy id after a hand-off, the kernel id itself for objects made during the game) */
  kid(cardId: string): ObjId { return this.toKernel.get(cardId) ?? cardId; }

  private nameOf(id: string): string {
    const o = this.ks.state.objects[id];
    if (o) return o.token?.name ?? o.cardName;
    return this.ks.state.players.find((p) => p.id === id)?.name ?? id;
  }

  /** what the table renders; the same object until the game or the notes change */
  table(): TableState {
    if (this.tableCache?.ver === this.ver) return this.tableCache.table;
    const ts = this.ks.tableState(this.human);
    let session = ts.session;
    if (this.notes.length) {
      const m = this.mergedCache;
      if (m && m.base === ts.session && m.notes === this.notes) session = m.session;
      else { session = { ...ts.session, events: [...this.notes, ...ts.session.events] }; this.mergedCache = { base: ts.session, notes: this.notes, session }; }
    }
    this.promotePendingDrops();
    if (this.positions.size) session = this.withPositions(session);
    if (Object.keys(this.attackPicks).length) session = this.withAttackPicks(session);
    this.rawSession = session;
    const stacked = stackSession(session);
    this.stackIndex = stacked.index;
    session = this.withStackSelection(stacked.session, this.pickedMemberIds(ts));
    // an open inspector on a token follows the stack it belongs to (the representative can change when the stack splits or a member dies)
    if (this.inspectedCard?.token) {
      const want = this.stackIndex.repOf.get(this.inspectedCard.id) ?? this.inspectedCard.id;
      const fresh = session.seats.flatMap((s) => s.board.battlefield).find((c) => c.id === want);
      if (fresh && fresh !== this.inspectedCard) this.inspectedCard = fresh;
    }
    let table = session === ts.session ? ts : { ...ts, session };
    // the legacy table's priority UI (the stack dock with Pass Priority) is keyed on a pending action: when the human is stopped at an empty-stack window,
    // hand it the same "phase" window the legacy game opens, so there is exactly one priority UI
    if (!table.pendingAction && !table.decision && this.stopReason() !== undefined) {
      table = { ...table, pendingAction: { id: `kernel-window-${this.ks.version}`, type: "phase", actorSeatId: this.human, message: `You want to pass ${table.session.phase}.` } };
    }
    this.tableCache = { ver: this.ver, table };
    return table;
  }

  /** where the player dragged battlefield cards (purely visual: the kernel has no positions); cards keep their object identity unless they were moved */
  private positions = new Map<string, { x: number; z: number }>();
  /**
   * Where the player DROPPED a hand card (the yellow landing preview): the card is on the stack for a while, then enters; an object keeps its id across zones, so the spot
   * is promoted to a real battlefield position when the card arrives, and forgotten when the cast did not happen (the card is back in a hand / library).
   */
  private pendingDrops = new Map<string, { x: number; z: number; ver: number }>();
  private promotePendingDrops(): void {
    for (const [tableId, pos] of this.pendingDrops) {
      const zone = this.ks.state.objects[this.kid(tableId)]?.zone;
      if (zone === "battlefield") { this.positions.set(tableId, { x: pos.x, z: pos.z }); this.pendingDrops.delete(tableId); }
      // Only once the game has moved on since the drop (a table() read between the drop and the cast, with the card still in hand / command zone, must not forget it):
      else if (zone !== "stack" && !this.ks.state.pending && this.ks.version > pos.ver) this.pendingDrops.delete(tableId); // refused, cancelled, countered or an instant resolved: no spot to keep. While a question is open (targets, payment banner) the card is still in its old zone: keep it
    }
  }
  private withPositions(session: GameSession): GameSession {
    let changed = false;
    const seats = session.seats.map((seat) => {
      if (!seat.board.battlefield.some((c) => this.positions.has(c.id))) return seat;
      changed = true;
      return { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((c) => (this.positions.has(c.id) ? { ...c, battlefieldPosition: this.positions.get(c.id) } : c)) } };
    });
    return changed ? { ...session, seats } : session;
  }
  /** the attackers picked so far look like declared attackers (legacy: attacking, tapped unless vigilance, pointing at their target) before the kernel gets the declaration */
  private withAttackPicks(session: GameSession): GameSession {
    const picks = new Map(Object.entries(this.attackPicks).map(([id, def]) => [this.ks.legacyIdOf(id) ?? id, this.ks.legacyIdOf(def) ?? def]));
    const seats = session.seats.map((seat) => {
      if (!seat.board.battlefield.some((c) => picks.has(c.id))) return seat;
      return { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((c) => (picks.has(c.id) ? { ...c, attacking: true, attackTargetId: picks.get(c.id), tapped: c.tapped || !/\bvigilance\b/i.test(c.oracleText ?? "") } : c)) } };
    });
    return { ...session, seats };
  }
  moveBattlefieldCard = (_seatId: string, cardId: string, position: { x: number; z: number }): void => {
    for (const id of this.stackMembers(cardId)) this.positions.set(id, position); // a stack moves as one: every member keeps the new spot, so it stays put when the stack splits
    this.bump();
  };

  /** the log line shown in the table's event log (newest first); also used by the intents that cannot run */
  note(message: string, detail = "Kernel"): void {
    this.notes = [{ id: `kernel-note-${this.noteSeq++}`, at: "", seatId: this.human, message, detail }, ...this.notes].slice(0, 40);
    this.bump();
  }

  /** the seat the engine waits for when it is an AI seat (drives the "thinking" badge) */
  thinkingSeat(): string | undefined {
    const a = this.ks.actor;
    return a && a !== this.human ? a : undefined;
  }

  /** the human's open attack / block declaration with the picks made so far (undefined when none is awaited) */
  declaration(): Declaration | undefined {
    const key = JSON.stringify([this.attackPicks, this.blockPicks]);
    if (this.declCache && this.declCache.ver === this.ks.version && this.declCache.picks === key) return this.declCache.decl;
    let decl: Declaration | undefined;
    const ex = this.ks.state.combat?.expect;
    if (ex && !this.ks.state.pending && (ex.kind === "attackers" ? ex.player === this.human : ex.players.includes(this.human))) {
      const entry = this.legalNow().find((a) => a.kind === "declareAttackers" || a.kind === "declareBlockers");
      if (entry?.kind === "declareAttackers") {
        decl = { kind: "attackers", picks: { ...this.attackPicks }, attackers: (entry.attackers ?? []).map((a) => ({ id: a.id, name: this.nameOf(a.id), mustAttack: !!entry.mustAttack?.includes(a.id), defenders: a.defenders.map((d) => ({ id: d, label: d.startsWith("#") ? this.nameOf(d) : this.nameOf(d) })) })) };
      } else if (entry?.kind === "declareBlockers") {
        decl = { kind: "blockers", picks: { ...this.blockPicks }, blockers: (entry.blockers ?? []).filter((b) => b.attackers.length).map((b) => ({ id: b.id, name: this.nameOf(b.id), attackers: b.attackers.map((x) => ({ id: x, name: this.nameOf(x) })) })) };
      }
    }
    this.declCache = { ver: this.ks.version, picks: key, decl };
    return decl;
  }

  // ------------------------------------------------------------------ acting

  /** dispatch for the human; a refusal becomes a log note (a stale answer is silent). Returns true when the engine accepted it. */
  private act(action: Action): boolean {
    const before = this.ks.version;
    this.consumeHold();
    const seen = this.beforeStep();
    const res: DispatchResult = this.ks.dispatch(this.human, action);
    if (res.ok || this.ks.version !== before) { if (action.type === "declareAttackers" || action.type === "declareBlockers") this.declTax = undefined; this.stackChosen = undefined; this.attackPicks = {}; this.blockPicks = {}; this.blockIdx = 0; this.failures = 0; this.observe(seen, action); this.bump(); return res.ok; }
    if (!res.stale) {
      this.note(`Can't do that: ${res.error?.message ?? "the engine refused"}.`, "Rules");
      // an attack / block tax the pool does not cover: the payment banner stays up while the player taps sources, then declares again
      if ((action.type === "declareAttackers" || action.type === "declareBlockers") && res.error?.code === "cannot_pay" && /\btax\b/i.test(res.error.message)) this.declTax = { message: res.error.message, action };
    } else this.bump();
    return false;
  }

  private legalFor(kind: LegalAction["kind"], objectId: ObjId): LegalAction[] {
    return this.legalNow().filter((a) => a.kind === kind && a.objectId === objectId);
  }

  /** answer the open decision; `decisionId` is the id the dialog was rendered for (a late click on an older dialog is ignored) */
  answer = (decisionId: string, choice: Choice): boolean => {
    const seen = this.beforeStep();
    const res = this.ks.decide(this.human, decisionId, choice);
    if (!res.ok && !res.stale) this.note(`That choice was refused: ${res.error?.message ?? "invalid"}.`, "Rules");
    else { if (res.ok) this.observe(seen); this.bump(); }
    return res.ok;
  };

  // ------------------------------------------------------------------ pacing (kernelPacing.ts)

  private paceSnap(): PaceSnap {
    const s = this.ks.state;
    const atts = s.combat?.attackers ?? [];
    return { stack: s.stack.map((i) => i.id), turn: s.turn.number, phase: String(s.turn.phase), attackers: atts.length, blockers: atts.reduce((n, a) => n + a.blockers.length, 0) };
  }
  /** what to remember before a step so observe() can tell what the player saw happen (only gathered when pacing is on) */
  private beforeStep(): { snap: PaceSnap; top?: PendingActionView; eventId?: string } | undefined {
    if (!this.pacing) return undefined;
    const t = this.table();
    return { snap: this.paceSnap(), ...(t.pendingAction ? { top: t.pendingAction } : {}), eventId: t.session.events[0]?.id };
  }
  /** after a step: the stack item that just resolved joins the dock's feed, and the visible change holds the next automatic step for its pacing delay */
  private observe(seen: ReturnType<KernelGameController["beforeStep"]>, action?: Action): void {
    const pacing = this.pacing;
    if (!pacing || !seen) return;
    const next = this.paceSnap();
    if (seen.top && seen.top.type !== "phase" && !next.stack.includes(seen.top.id)) {
      this.resolvedFeed = [{ id: seen.top.id, view: seen.top, status: "resolved" as const, resolvedAt: Date.now(), startEventId: seen.eventId }, ...this.resolvedFeed].slice(0, 3);
    }
    if (this.yielding) { pacing.cancel(); return; } // "yield to end of turn" means: hurry
    const kind = classifyChange(seen.snap, next, action);
    if (kind !== "none") pacing.note(kind, next.turn);
    if (!pacing.active) return;
    // a decision, the human's own window, or the end of the game: nothing automatic follows, so nothing to wait for
    if (!this.needsStep()) pacing.cancel();
  }
  /** is the table holding an automatic step back to show what just happened? (the Skip button / Space; the decision timer must not count this) */
  isPacing(): boolean { return !!this.pacing && this.pacing.active && this.needsStep(); }
  /** speed past the current wait */
  skipPacing = (): void => {
    if (!this.pacing) return;
    this.pacing.skip();
    if (this.timer !== undefined && this.driverClear) { this.driverClear(this.timer); this.timer = undefined; }
    this.bump();
  };
  /** "Save game log" (stack log panel): writes the replay file of this game through the dev-only route (kernelGameLog.ts) */
  saveGameLog = (): ReturnType<typeof saveGameLog> => saveGameLog(this.ks, this.human);
  /** the stack dock's feed: the top item shows "Resolving..." while the table holds still on it, and the items that just resolved show what they did */
  stackFeed(): StackFeedEntry[] {
    if (!this.pacing) return [];
    if (this.feedCache?.ver === this.ver) return this.feedCache.feed;
    const t = this.table();
    const feed: StackFeedEntry[] = this.resolvedFeed.filter((e) => !t.stackActions.some((v) => v.id === e.id) && t.pendingAction?.id !== e.id);
    if (t.pendingAction && t.pendingAction.type !== "phase" && this.isPacing()) feed.unshift({ id: t.pendingAction.id, view: t.pendingAction, status: "resolving" });
    this.feedCache = { ver: this.ver, feed };
    return feed;
  }

  playCard = (seatId: string, cardId: string, pos?: { x: number; z: number }, _zone?: string): void => {
    if (seatId !== this.human) return this.inert("play a card for another seat");
    const id = this.kid(cardId);
    // dropped on the battlefield: the yellow landing preview showed this spot, so the permanent keeps it when it enters (see promotePendingDrops)
    const spot = this.keepDrop(id, pos);
    if (this.freeCastOn()) return this.debugCast(id);
    const lands = this.legalFor("playLand", id);
    const casts = this.legalFor("castSpell", id);
    // a two-halved card (a Room, a split card) with several halves castable: never pick one silently (Secret Arcade vs Dusty Parlor cost differently and unlock different doors)
    const faces = new Set(casts.map((a) => a.face).filter(Boolean));
    if (!lands.length && faces.size > 1) { this.dropRefused(spot, false); this.note(`${this.nameOf(id)} has ${faces.size} halves you can cast (${[...faces].join(", ")}): use the "Cast <half>" buttons or the card's actions.`, "Rules"); return; }
    const pick = lands[0] ?? casts.find((a) => a.free) ?? casts.find((a) => !a.option || a.option === "normal") ?? casts[0]; // a free-cast permission (Omniscience) is the default way; "Pay its mana cost" stays in the card actions
    if (pick?.action) { this.dropRefused(spot, this.act(pick.action)); return; }
    // not listed: ask the engine directly so the player gets its reason ("wrong timing", "cannot pay", ...)
    const o = this.ks.state.objects[id];
    const isLand = !!o && !!this.ks.ctx.cards(o.cardName)?.types.includes("land");
    this.dropRefused(spot, this.act(isLand ? { type: "playLand", player: this.human, cardId: id } : { type: "castSpell", player: this.human, cardId: id }));
  };

  playCardFace = (seatId: string, cardId: string, faceIndex: number): void => {
    if (seatId !== this.human) return this.inert("play a card for another seat");
    const id = this.kid(cardId);
    if (this.freeCastOn()) return this.debugCast(id);
    const options = [...this.legalFor("playLand", id), ...this.legalFor("castSpell", id)].filter((a) => a.face);
    const pick = options[faceIndex] ?? options[0];
    if (pick?.action) this.act(pick.action); else this.playCard(seatId, cardId);
  };

  /** remember where a card was dropped (the yellow landing preview) so the permanent enters there; see promotePendingDrops */
  private keepDrop(id: ObjId, pos?: { x: number; z: number }): string | undefined {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return undefined;
    const tableId = this.ks.legacyIdOf(id) ?? id;
    this.pendingDrops.set(tableId, { x: pos.x, z: pos.z, ver: this.ks.version });
    this.tableCache = undefined;
    return tableId;
  }
  /** a cast that did not start (refused) leaves no spot behind; while a question (payment, targets) is open the card is still in its old zone, so the spot stays */
  private dropRefused(tableId: string | undefined, accepted: boolean): void {
    if (tableId && !accepted && !this.ks.state.pending) this.pendingDrops.delete(tableId);
  }

  /**
   * Can the human cast their commander right now, and if not, why? The same answer the engine gives the cast button: the kernel lists a command-zone
   * cast only when the timing is right AND the whole cost (mana cost + commander tax) can be paid from untapped sources and/or the floating mana pool.
   * The reason is the engine's own refusal text. `cardId` is the table id of the commander (what the board shows).
   */
  commanderCast(): { castable: boolean; cardId?: string; reason?: string } {
    if (this.freeCastOn()) return this.commanderCastNow();
    if (this.cmdCache?.ver !== this.ks.version) this.cmdCache = { ver: this.ks.version, v: this.commanderCastNow() };
    return this.cmdCache.v;
  }
  private cmdCache?: { ver: number; v: { castable: boolean; cardId?: string; reason?: string } };
  private commanderCastNow(): { castable: boolean; cardId?: string; reason?: string } {
    const id = this.ks.state.players.find((p) => p.id === this.human)?.command[0];
    if (!id) return { castable: false, reason: "There is no commander in the command zone." };
    const cardId = this.ks.legacyIdOf(id) ?? id;
    if (this.freeCastOn()) return { castable: true, cardId };
    const s = this.ks.state;
    if (s.priority !== this.human || s.pending || s.combat?.expect) return { castable: false, cardId, reason: "You don't have priority" };
    if (this.legalNow().some((a) => a.kind === "castSpell" && a.zone === "command" && a.objectId === id && a.action)) return { castable: true, cardId };
    const why = resolve(s, { type: "castSpell", player: this.human, cardId: id, autoPay: true }, this.ks.ctx).error?.message;
    return { castable: false, cardId, reason: why ?? "Not castable now: not enough mana or wrong timing" };
  }

  castCommander = (seatId: string, position?: { x: number; z: number }): void => {
    if (seatId !== this.human) return this.inert("cast a commander for another seat");
    const id = this.ks.state.players.find((p) => p.id === this.human)?.command[0];
    if (!id) { this.note("There is no commander in the command zone.", "Rules"); return; }
    const spot = this.keepDrop(id, position);
    if (this.freeCastOn()) return this.debugCast(id);
    const cmd = this.legalNow().find((a) => a.kind === "castSpell" && a.zone === "command" && a.action);
    if (cmd?.action) { this.dropRefused(spot, this.act(cmd.action)); return; }
    // not listed: say why in the log instead of leaving a silent no-op (a dragged commander always gets this message)
    const c = this.commanderCast();
    if (position && c.reason) { this.note(`Cannot cast ${this.nameOf(id)}: ${c.reason}`, "Rules"); this.dropRefused(spot, false); }
    else this.dropRefused(spot, this.act({ type: "castSpell", player: this.human, cardId: id }));
  };

  /** cast from exile / graveyard (flashback, permissions): the kernel lists those casts itself */
  castFromZone = (seatId: string, cardId: string, position?: { x: number; z: number }): void => {
    if (seatId !== this.human) return this.inert("cast for another seat");
    const id = this.kid(cardId);
    const spot = this.keepDrop(id, position);
    if (this.freeCastOn()) return this.debugCast(id);
    const pick = this.legalFor("castSpell", id).find((a) => a.action);
    if (pick?.action) this.dropRefused(spot, this.act(pick.action));
    else { this.note(`${this.nameOf(id)} can't be cast from there right now.`, "Rules"); this.dropRefused(spot, false); }
  };

  // ------------------------------------------------------------------ debug mode (kernelDebug.ts, engine/sandbox.ts)

  /** debug mode is on for this game (the engine accepts the sandbox actions) */
  debugOn(): boolean { return this.ks.sandbox; }
  /** "Cast for free" mode: clicking a card of yours casts it with every cost waived */
  freeCast = false;
  private freeCastOn(): boolean { return this.freeCast && this.ks.sandbox; }
  /** the Debug mode checkbox: records the switch in the game (log line, replay file) */
  setDebug = (on: boolean): void => {
    if (on === this.ks.sandbox) return;
    if (!on) this.freeCast = false;
    this.act({ type: "sandboxMode", player: this.human, on });
    this.bump();
  };
  toggleFreeCast = (): void => { this.freeCast = !this.freeCast && this.ks.sandbox; this.bump(); };
  /** one debug action for the human's seat; a refusal is a log note like any other */
  debug = (input: DebugInput): boolean => this.act({ ...input, player: this.human } as Action);
  private debugCast(id: ObjId): void {
    const o = this.ks.state.objects[id];
    const isLand = !!o && !!this.ks.ctx.cards(o.cardName)?.types.includes("land");
    this.act(isLand ? { type: "sandboxPlayLand", player: this.human, cardId: id } : { type: "sandboxCast", player: this.human, cardId: id });
  }
  /** the debug picker's cards (library: the whole library, top first) and the conjure list's names */
  debugCards = (zone: "library" | "hand" | "graveyard" | "exile"): VisibleCard[] => this.ks.debugCards(this.human, zone);
  debugNames = (): readonly string[] => this.ks.debugCardNames();
  debugCardByName = (name: string): VisibleCard | undefined => this.ks.debugCardByName(name);
  /** the human's life total (the panel's +/- buttons) */
  humanLife(): number { return this.ks.state.players.find((p) => p.id === this.human)?.life ?? 0; }
  private debugCardEntry(cardId: string): ReturnType<typeof debugCardAction> {
    const id = this.kid(cardId);
    const o = this.ks.state.objects[id];
    return debugCardAction(this.ks.sandbox, o && { zone: o.zone, owner: o.owner, id, isLand: !!this.ks.ctx.cards(o.cardName)?.types.includes("land") }, this.human);
  }

  /** the open "which mana?" chooser of a permanent with several mana ways (a Talisman: {C}, or {W}/{U} and 1 damage); undefined when none is open */
  private manaPick: { cardName: string; options: ManaWay[] } | undefined;
  manaChoice(): { cardName: string; choices: never[]; hints: Record<string, string> } | undefined {
    const pick = this.manaPick;
    return pick ? { cardName: pick.cardName, choices: pick.options.map((o) => o.key) as never[], hints: Object.fromEntries(pick.options.filter((o) => o.hint).map((o) => [o.key, o.hint!])) } : undefined;
  }
  chooseMana = (key: string): void => {
    const way = this.manaPick?.options.find((o) => o.key === key);
    this.manaPick = undefined;
    if (way) this.act(way.action); else this.bump();
  };
  cancelManaChoice = (): void => { this.manaPick = undefined; this.bump(); };

  /** can the human take back the mana tap of this permanent right now? (the kernel's own legality: unspent, nothing cast or activated since, pure mana tap) */
  canUntapForMana(cardId: string): boolean {
    const id = this.kid(cardId);
    return this.ks.legal(this.human, { untap: true }).some((a) => a.kind === "untapForMana" && a.objectId === id);
  }

  /** the take-back: the kernel decides; a refusal becomes a "Rules" log note saying why */
  untapForMana = (seatId: string, cardId: string): void => {
    if (seatId !== this.human) return this.inert("untap another seat's permanent");
    this.act({ type: "untapForMana", player: this.human, permanentId: this.kid(cardId) });
  };

  /** the "T" key: an untapped permanent is tapped for mana; a tapped one is untapped when that is a legal take-back (otherwise the kernel's reason is logged) */
  toggleTap = (seatId: string, cardId: string): void => {
    if (seatId !== this.human) return this.inert("tap another seat's permanent");
    if (this.ks.state.objects[this.kid(cardId)]?.tapped) this.untapForMana(seatId, cardId); else this.tapForMana(seatId, cardId);
  };

  tapForMana = (seatId: string, cardId: string): void => {
    if (seatId !== this.human) return this.inert("tap another seat's permanent");
    const waysOf = (x: ObjId) => manaWays(this.legalFor("activateAbility", x).filter((a) => a.isMana && a.action));
    // a token stack taps / sacrifices the chosen number of its tokens (one unless the player chose more), one after the other
    const ids = this.firstN(cardId, (x) => waysOf(x).length > 0, this.stackChosen ?? 1);
    const id = ids[0] ?? this.kid(cardId);
    const ways = waysOf(id);
    // exactly one way: just do it; several (the free {C} and a damaging coloured ability, two colours): the player chooses, with the cost shown
    if (ways.length > 1) { this.manaPick = { cardName: this.nameOf(id), options: ways }; this.bump(); return; }
    if (!ways[0]) { this.note(`${this.nameOf(id)} has no mana ability you can use right now.`, "Rules"); return; }
    for (const x of ids) { const w = waysOf(x)[0]; if (!w || !this.act(w.action)) break; }
  };

  /** every legacy "activate ..." callback lands here: the kernel lists the abilities by id, the table only knows an index */
  activateAbility = (seatId: string, cardId: string, abilityIndex = 0): void => {
    if (seatId !== this.human) return this.inert("activate another seat's ability");
    const listOf = (x: ObjId) => this.legalFor("activateAbility", x).filter((a) => !a.isMana && a.action);
    const pickOf = (x: ObjId) => { const list = listOf(x); return list.length === 1 ? list[0] : list[abilityIndex] ?? list[0]; };
    // one token of a stack, or as many as the player chose
    const ids = this.firstN(cardId, (x) => !!pickOf(x)?.action, this.stackChosen ?? 1);
    if (!ids.length) { this.note(`${this.nameOf(this.kid(cardId))}: no ability can be activated right now.`, "Rules"); return; }
    for (const x of ids) { const pick = pickOf(x); if (!pick?.action || !this.act(pick.action)) break; }
  };

  activateLoyalty = (seatId: string, cardId: string, _cost: number, text: string): void => {
    if (seatId !== this.human) return this.inert("activate another seat's ability");
    const id = this.kid(cardId);
    const list = this.legalFor("activateAbility", id).filter((a) => !a.isMana && a.action);
    const pick = list.find((a) => text && a.label.toLowerCase().includes(text.toLowerCase().slice(0, 24))) ?? list[0];
    if (pick?.action) this.act(pick.action); else this.note(`${this.nameOf(id)}: no loyalty ability can be activated right now.`, "Rules");
  };

  /** "Respond Selected": cast / play the selected hand card (the kernel refuses it with a reason when the timing is wrong) */
  respondWithSelected = (): void => {
    if (!this.selectedCardId) { this.note("Select a card in your hand first.", "Rules"); return; }
    this.playCard(this.human, this.selectedCardId);
  };

  passPriority = (): void => {
    if (this.ks.actor !== this.human || this.ks.state.pending || this.ks.state.combat?.expect) { this.note("You can't pass priority right now.", "Rules"); return; }
    this.act({ type: "passPriority", player: this.human });
  };

  /**
   * "Pass to next step": ONE priority pass (the same rules action as Pass priority) that also arms "Stop Next" silently, so the very next window opens even where no stop is
   * ticked: the game moves one step (or one player's window) and waits for the human again. It never runs on through the rest of the turn (End turn does that);
   * with a declaration open it means "no more attackers" (legacy "Continue").
   */
  advanceTurn = (): void => {
    const s = this.ks.state;
    if (s.pending) { this.note("Answer the open question first.", "Rules"); return; }
    if (this.declaration()?.kind === "attackers") { this.confirmAttackers(); return; } // legacy "Continue" in the declare attackers step: the attackers picked so far go in
    if (this.ks.actor !== this.human || s.combat?.expect) { this.note("You can't pass priority right now.", "Rules"); return; }
    this.holdArmedAt = this.ks.version;
    if (!this.act({ type: "passPriority", player: this.human })) this.holdArmedAt = undefined;
  };

  /** hurry to the end of the human's turn: stops at a question, a declaration, or when the turn passes to somebody else */
  endTurn = (): void => {
    const turn = this.ks.state.turn.number;
    this.pacing?.skip(); // the human asked to hurry
    for (let i = 0; i < 40; i++) {
      const s = this.ks.state;
      if (s.gameOver || s.pending || s.turn.number !== turn || this.ks.actor !== this.human) break;
      if (s.turn.active !== this.human) break;
      if (this.declaration()?.kind === "attackers") { if (!this.confirmAttackers()) break; continue; }
      const ok = s.stack.length ? this.act({ type: "passPriority", player: this.human }) : this.act({ type: "advancePhase", player: this.human });
      if (!ok) break;
    }
    this.pacing?.skip();
  };

  // ---- combat declarations

  /** one attacker at a time (the legacy table's callback); sent together by confirmAttackers() */
  declareAttack = (cardId: string, targetId: string): void => {
    const d = this.declaration();
    if (!d || d.kind !== "attackers") { this.note("You are not declaring attackers now.", "Rules"); return; }
    // a token stack attacks with the chosen number of its tokens (all by default): the first N by id
    const ids = this.stackMembers(cardId).map((m) => this.kid(m));
    const n = this.stackChosen ?? ids.length;
    const opts = ids.map((id) => d.attackers.find((a) => a.id === id)).filter((o): o is AttackerOption => !!o);
    if (!opts.length) { this.note(`${this.nameOf(ids[0])} can't attack this turn.`, "Rules"); return; }
    if (!targetId) {
      const free = opts.filter((o) => !o.mustAttack);
      if (!free.length) this.note(`${opts[0].name} must attack if able.`, "Rules");
      else { const drop = new Set(free.filter((o) => o.id in this.attackPicks).slice(0, n).map((o) => o.id)); this.attackPicks = Object.fromEntries(Object.entries(this.attackPicks).filter(([id]) => !drop.has(id))); }
    } else {
      const target = this.kid(targetId);
      const able = opts.filter((o) => o.defenders.some((x) => x.id === target));
      if (!able.length) { this.note(`${opts[0].name} can't attack ${this.nameOf(target)}.`, "Rules"); return; }
      this.attackPicks = { ...this.attackPicks, ...Object.fromEntries(able.slice(0, n).map((o) => [o.id, target])) };
    }
    this.stackChosen = undefined;
    this.inspectedCard = undefined;
    this.bump();
  };
  toggleAttacker = (id: string, defender?: string): void => {
    const d = this.declaration();
    if (d?.kind !== "attackers") return;
    const next = { ...this.attackPicks };
    if (id in next && defender === undefined) delete next[id];
    else next[id] = defender ?? d.attackers.find((a) => a.id === id)?.defenders[0]?.id ?? "";
    if (!next[id]) delete next[id];
    this.attackPicks = next;
    this.bump();
  };
  attackWithAll = (): void => {
    const d = this.declaration();
    if (d?.kind !== "attackers") return;
    const next: Record<string, string> = {};
    for (const a of d.attackers) { const players = a.defenders.filter((x) => !x.id.startsWith("#")); const def = (players[0] ?? a.defenders[0])?.id; if (def) next[a.id] = def; }
    this.attackPicks = next;
    this.bump();
  };
  confirmAttackers = (): boolean => {
    const d = this.declaration();
    if (d?.kind !== "attackers") return false;
    const must = d.attackers.filter((a) => a.mustAttack && !(a.id in this.attackPicks)).map((a) => a.id);
    const picks = { ...this.attackPicks };
    for (const id of must) { const a = d.attackers.find((x) => x.id === id); if (a?.defenders[0]) { picks[id] = a.defenders[0].id; this.note(`${a.name} must attack: added to the attack.`, "Rules"); } }
    return this.act({ type: "declareAttackers", player: this.human, attackers: Object.entries(picks).map(([id, defender]) => ({ id, defender })) });
  };
  noAttack = (): boolean => { this.attackPicks = {}; return this.confirmAttackers() || this.act({ type: "declareAttackers", player: this.human, attackers: [] }); };

  // ---- the legacy block modal, one attacker at a time

  /** the attackers the human is asked about: everything attacking them or their planeswalkers, plus anything one of their blockers may block */
  private blockQueue(): string[] {
    const ex = this.ks.state.combat?.expect;
    if (!ex || ex.kind !== "blockers" || !ex.players.includes(this.human) || this.ks.state.pending) return [];
    const entry = this.legalNow().find((a) => a.kind === "declareBlockers");
    const blockable = new Set((entry?.blockers ?? []).flatMap((b) => b.attackers));
    const objs = this.ks.state.objects;
    return (this.ks.state.combat?.attackers ?? []).filter((att) => att.defender === this.human || objs[att.defender]?.controller === this.human || blockable.has(att.id)).map((a) => a.id);
  }
  private legalBlockersFor(attackerId: string): string[] {
    const entry = this.legalNow().find((a) => a.kind === "declareBlockers");
    const taken = new Set(Object.entries(this.blockPicks).filter(([att]) => att !== attackerId).flatMap(([, bl]) => bl));
    return (entry?.blockers ?? []).filter((b) => b.attackers.includes(attackerId) && !taken.has(b.id)).map((b) => b.id);
  }
  private currentAttacker(): string | undefined { return this.blockQueue()[this.blockIdx]; }
  private cardById(kernelId: string): VisibleCard | undefined {
    const legacy = this.ks.legacyIdOf(kernelId) ?? kernelId;
    this.table();
    for (const seat of (this.rawSession ?? this.table().session).seats) { const c = seat.board.battlefield.find((x) => x.id === legacy); if (c) return c; } // raw: the block modal lists one card per token
    return undefined;
  }
  /** the legal blockers for the block modal: tokens of one stack are ONE entry (stackCount = how many may block, stackSelected = how many are picked), other creatures one each */
  private blockerEntries(att: string): { cards: VisibleCard[]; selectedIds: string[] } {
    const legal = this.legalBlockersFor(att);
    const picks = this.blockPicks[att] ?? [];
    const cards: VisibleCard[] = [];
    const entryOf = new Map<string, string>(); // member legacy id -> its entry's id
    const done = new Set<string>();
    for (const id of legal) {
      const card = this.cardById(id);
      if (!card) continue;
      const rep = this.stackIndex.repOf.get(card.id);
      if (!rep) { cards.push(card); entryOf.set(card.id, card.id); continue; }
      if (done.has(rep)) continue;
      done.add(rep);
      const mem = (this.stackIndex.members.get(rep) ?? []).filter((m) => legal.includes(this.kid(m)));
      const first = this.cardById(mem[0]) ?? card;
      for (const m of mem) entryOf.set(m, first.id);
      cards.push(mem.length > 1 ? { ...first, stackCount: mem.length, stackIds: mem, stackSelected: picks.filter((x) => mem.includes(this.ks.legacyIdOf(x) ?? x)).length } : first);
    }
    const selectedIds = [...new Set(picks.map((x) => { const l = this.ks.legacyIdOf(x) ?? x; return entryOf.get(l) ?? l; }))];
    return { cards, selectedIds };
  }

  /** the props the legacy table needs to run attack / block declarations (spread next to tableProps; recomputed each version) */
  combatProps(): Record<string, unknown> {
    if (this.combatCache?.ver === this.ver) return this.combatCache.props;
    const props: Record<string, unknown> = {};
    const d = this.declaration();
    if (d?.kind === "attackers") {
      const open = this.inspectedCard ? new Set(this.stackMembers(this.inspectedCard.id).map((m) => this.kid(m))) : undefined;
      const a = d.attackers.find((x) => open?.has(x.id));
      if (a) {
        const targets = a.defenders.map((x) => ({ targetId: this.ks.legacyIdOf(x.id) ?? x.id, label: `Attack ${x.label}` }));
        if ([...(open ?? [])].some((x) => x in d.picks)) targets.push({ targetId: "", label: a.mustAttack ? "Attacks (must attack)" : "Do not attack" });
        props.humanAttackTargets = targets;
      }
    } else if (d?.kind === "blockers") {
      const att = this.currentAttacker();
      const attackingCard = att ? this.cardById(att) : undefined;
      if (att && attackingCard) {
        const seats = this.table().session.seats;
        const attackerSeat = seats.find((s) => s.board.battlefield.some((c) => c.id === attackingCard.id));
        const { cards: blockers, selectedIds } = this.blockerEntries(att);
        props.blockChoice = { attackerName: attackerSeat?.name ?? "Opponent", defenderName: seats.find((s) => s.id === this.human)?.name ?? "You", attackingCard, blockers };
        props.selectedBlockerIds = selectedIds;
      }
    }
    const stack = this.inspectedStack();
    if (stack) props.inspectedStack = stack;
    this.combatCache = { ver: this.ver, props };
    return props;
  }
  private combatCache?: { ver: number; props: Record<string, unknown> };

  /** legacy onToggleBlocker: tap a creature to add it (damage order = tap order) or remove it */
  toggleBlocker = (cardId: string): void => {
    const att = this.currentAttacker();
    if (!att) return;
    const legal = this.legalBlockersFor(att);
    const cur = this.blockPicks[att] ?? [];
    // a token stack: each tap adds one more of its tokens (first by id); when all of them block, the next tap takes them all back
    const members = this.stackMembers(cardId).map((m) => this.kid(m)).filter((m) => legal.includes(m));
    if (!members.length) { const id = this.kid(cardId); this.note(`${this.nameOf(id)} can't block ${this.nameOf(att)}.`, "Rules"); return; }
    const next = members.find((m) => !cur.includes(m));
    this.blockPicks = { ...this.blockPicks, [att]: next ? [...cur, next] : cur.filter((x) => !members.includes(x)) };
    this.bump();
  };
  /** legacy "Confirm N Blockers" / "Do Not Block": settle this attacker, ask about the next, declare once the last is settled */
  private settleCurrentBlock(blockers: string[]): boolean {
    const att = this.currentAttacker();
    if (!att) return false;
    this.blockPicks = { ...this.blockPicks, [att]: blockers };
    this.blockIdx++;
    if (this.blockIdx < this.blockQueue().length) { this.bump(); return true; }
    const ok = this.confirmBlockers();
    if (!ok) { this.blockPicks = {}; this.blockIdx = 0; this.bump(); }
    return ok;
  }
  confirmCurrentBlock = (): boolean => { const att = this.currentAttacker(); return att ? this.settleCurrentBlock(this.blockPicks[att] ?? []) : false; };
  passCurrentBlock = (): boolean => this.settleCurrentBlock([]);

  /** everything picked so far, sent as the one declaration the kernel wants */
  confirmBlockers = (): boolean => this.declaration()?.kind === "blockers" && this.act({ type: "declareBlockers", player: this.human, blocks: Object.entries(this.blockPicks).flatMap(([attacker, bl]) => bl.map((blocker) => ({ blocker, attacker }))) });
  /** no blocks at all (tests and the automatic skip) */
  passBlocks = (): boolean => { this.blockPicks = {}; return this.declaration()?.kind === "blockers" && this.act({ type: "declareBlockers", player: this.human, blocks: [] }); };

  // ---- everything the kernel has no meaning for

  private inert(what: string): void { this.note(`Not available in kernel mode yet: ${what}.`, "Kernel"); }
  private inertFn = (what: string) => (): void => this.inert(what);

  /** Props for ThreeGameTable: the intent API of the legacy table, mapped on the kernel. Stable identity (built once). */
  private props?: Record<string, unknown>;
  tableProps(): Record<string, unknown> {
    if (this.props) return this.props;
    const inert = this.inertFn;
    this.props = {
      testTools: false,
      onSelectHandCard: this.selectHandCard, onInspectCard: this.inspectCard, onCloseInspectCard: this.closeInspect,
      onPlayCard: this.playCard, onPlayCardFace: this.playCardFace, onCastCommander: this.castCommander,
      onCastFromExile: this.castFromZone, onCastFromGraveyard: this.castFromZone,
      onTapForMana: this.tapForMana, onChooseMana: this.chooseMana, onCancelManaChoice: this.cancelManaChoice,
      onActivateSacrificeAbility: this.activateAbility, onActivateTapAbility: this.activateAbility, onActivateSelfUntap: this.activateAbility,
      onActivateGenericMana: this.activateAbility, onActivateEquip: (s: string, c: string) => this.activateAbility(s, c, 0),
      onActivateManlandAnimation: (s: string, c: string) => this.activateAbility(s, c, 0),
      onActivateScriptedAbility: (s: string, c: string) => this.activateAbility(s, c, 0),
      onActivateGraveyardAbility: (s: string, c: string) => this.activateAbility(s, c, 0),
      onActivateLoyalty: this.activateLoyalty,
      onPassPriority: this.passPriority, onAdvanceTurn: this.advanceTurn, onEndTurn: this.endTurn,
      onDeclareAttack: this.declareAttack, onToggleBlocker: this.toggleBlocker, onConfirmBlockers: this.confirmCurrentBlock, onPassBlocks: this.passCurrentBlock,
      // no separate "respond" review: while the human holds priority they cast / activate directly (glowing cards, "Respond Selected"), and Pass answers the window
      onRespond: () => this.note("Click a glowing card in your hand (or a permanent's ability) to respond; Pass Priority lets the stack resolve.", "Priority"), onRespondWithSelectedCard: this.respondWithSelected,
      onResolvePendingTrigger: this.passPriority,
      onDrawCard: inert("draw a card"), onShuffleLibrary: inert("shuffle the library"), onOpenLibrarySearch: inert("search the library"),
      onMoveCardToGraveyard: inert("move a card to the graveyard"), onMoveCardToExile: inert("move a card to exile"), onMoveCardToHand: inert("move a card to hand"),
      onChangeCounter: inert("change counters"), onChangeLife: inert("change life"), onToggleTapCard: this.toggleTap, // the "T" key: taps for mana through the card's mana ability, or takes back an unspent mana tap
      onCycleCard: inert("cycling"), onUnlockRoomDoor: inert("unlock a room door"),
      onPayCumulativeUpkeep: inert("cumulative upkeep"), onSacrificeRuleSource: inert("sacrifice a rule source"),
      onResolveMyriadLandscape: inert("myriad landscape"), onResolveBasicLandFetch: inert("basic land fetch"),
      // dragging a card on the board is purely visual; the stop settings, Full Control, Yield and Stop Next are the controller's own (kernelStops.ts)
      onMoveBattlefieldCard: this.moveBattlefieldCard, onTogglePhaseStop: this.togglePhaseStop, onToggleStopOnStackResponse: this.toggleStopOnStackResponse, onToggleStopOnAttacked: this.toggleStopOnAttacked, onToggleStopOnTargeted: this.toggleStopOnTargeted,
      onToggleStopOnChoicePrompt: this.toggleStopOnChoicePrompt, onToggleFullControl: this.toggleFullControl, onToggleYield: this.toggleYieldIntent, onStopNext: this.stopNext
    };
    return this.props;
  }

  // ------------------------------------------------------------------ AI + automatic passes

  /** is anything left for the driver to do right now? (false = the engine waits for a human click or the game is over) */
  needsStep(): boolean {
    const s = this.ks.state;
    if (s.gameOver || this.ks.degraded || this.stalledAt === this.ks.version) return false;
    const actor = this.ks.actor;
    if (!actor) return false;
    if (actor !== this.human) return true;
    return this.humanAutoAction() !== undefined;
  }

  /** the human has priority and nothing the slice asks them about: pass / advance for them (they can still act during the pace delay) */
  private humanAutoAction(): Action | undefined {
    const s = this.ks.state;
    // nothing attacks them and nothing of theirs could block: no modal to show, declare no blocks
    const ex = s.combat?.expect;
    if (ex?.kind === "blockers" && ex.players[0] === this.human && !s.pending && this.blockQueue().length === 0) return { type: "declareBlockers", player: this.human, blocks: [] };
    if (ex?.kind === "attackers" && ex.player === this.human && !s.pending && !(this.legalNow().find((a) => a.kind === "declareAttackers")?.attackers ?? []).length) return { type: "declareAttackers", player: this.human, attackers: [] };
    if (s.pending || s.combat?.expect || s.priority !== this.human) return undefined;
    const v = this.windowVerdict();
    if (v.stop) return undefined; // a stop: the human decides (pass / respond / continue)
    if (s.stack.length || s.turn.active !== this.human) return { type: "passPriority", player: this.human };
    return { type: "advancePhase", player: this.human };
  }

  // ------------------------------------------------------------------ priority stops (phase 6)

  /** the human's legal actions now (the kernel probes every candidate, so this is cached per game version) */
  legalNow(): LegalAction[] {
    if (this.legalCache?.ver !== this.ks.version) this.legalCache = { ver: this.ks.version, list: this.ks.legal(this.human) };
    return this.legalCache.list;
  }

  private holdActive(): boolean { return this.holdArmedAt !== undefined && this.ks.version > this.holdArmedAt; }
  private consumeHold(): void { if (this.holdActive()) this.holdArmedAt = undefined; }

  private verdictCache?: { ver: number; key: string; v: WindowVerdict };
  /** stop or pass for the human's current window; clears a yield that no longer holds (with a log note). Cached per game version + settings. */
  private windowVerdict(): WindowVerdict {
    const key = JSON.stringify([this.stopSettings, this.yielding, this.holdActive()]);
    if (this.verdictCache?.ver === this.ks.version && this.verdictCache.key === key) return this.verdictCache.v;
    const v = evaluateWindow({ state: this.ks.state, human: this.human, legal: this.legalNow(), settings: this.stopSettings, yielding: this.yielding, holdOnce: this.holdActive() });
    if (v.yieldEnded) { this.yielding = undefined; this.note(`Yield ended: ${v.yieldEnded}.`, "Priority"); }
    this.verdictCache = { ver: this.ks.version, key: JSON.stringify([this.stopSettings, this.yielding, this.holdActive()]), v };
    return v;
  }

  private aheadCache?: { ver: number; key: string; stop: boolean };
  /**
   * An AI active player with an empty stack normally just advances the step (nobody else gets priority). When the human WOULD be stopped in this step
   * (a ticked stop with a response, Full Control, Stop Next), the AI passes priority instead so the human gets the window.
   */
  private humanWindowAhead(): boolean {
    const key = JSON.stringify([this.stopSettings, this.yielding, this.holdActive()]);
    if (this.aheadCache?.ver === this.ks.version && this.aheadCache.key === key) return this.aheadCache.stop;
    const s = this.ks.state;
    const probe: GameState = { ...s, priority: this.human, passes: [] };
    let stop = false;
    try {
      const v = evaluateWindow({ state: probe, human: this.human, legal: legalActions(probe, this.human, this.ks.ctx), settings: this.stopSettings, yielding: this.yielding, holdOnce: this.holdActive() });
      stop = v.stop;
    } catch { stop = false; }
    this.aheadCache = { ver: this.ks.version, key, stop };
    return stop;
  }

  /** why the human is being asked right now (undefined when not waiting at a priority window); the UI may show it */
  stopReason(): string | undefined {
    const s = this.ks.state;
    if (s.pending || s.combat?.expect || s.priority !== this.human) return undefined;
    const v = this.windowVerdict();
    return v.stop ? v.reason : undefined;
  }

  stops(): PriorityStopSettings { return this.stopSettings; }
  isYielding(): boolean { return this.yielding !== undefined; }
  isHoldArmed(): boolean { return this.holdArmedAt !== undefined; }
  private setStops(next: PriorityStopSettings): void {
    this.stopSettings = next;
    try { this.saveStops?.({ ...next, fullControl: false }); } catch { /* storage problems never reach the game */ }
    this.bump();
  }
  togglePhaseStop = (phase: string, seatIndex: number): void => {
    const key = stopKey(phase, seatIndex);
    const stops = { ...this.stopSettings.phaseStops };
    if (stops[key]) delete stops[key]; else stops[key] = true;
    this.setStops({ ...this.stopSettings, phaseStops: stops });
  };
  toggleStopOnStackResponse = (): void => this.setStops({ ...this.stopSettings, stopOnStackResponse: !this.stopSettings.stopOnStackResponse });
  toggleStopOnAttacked = (): void => this.setStops({ ...this.stopSettings, stopOnAttacked: !this.stopSettings.stopOnAttacked });
  toggleStopOnTargeted = (): void => this.setStops({ ...this.stopSettings, stopOnTargeted: !this.stopSettings.stopOnTargeted });
  toggleStopOnChoicePrompt = (): void => this.setStops({ ...this.stopSettings, stopOnChoicePrompt: this.stopSettings.stopOnChoicePrompt === false });
  /** Full Control: every window of the human's own turn opens and every window with a real response opens on others' turns; it also cancels a yield */
  toggleFullControl = (): void => {
    const fullControl = !this.stopSettings.fullControl;
    if (fullControl) this.yielding = undefined;
    this.stopSettings = { ...this.stopSettings, fullControl };
    this.note(fullControl ? "Full Control on: every priority window opens." : "Full Control off.", "Priority");
  };
  /** "Yield to end of turn": no stops until the end step of this turn, except being targeted / attacked / full control / stop next */
  toggleYieldIntent = (): void => {
    const s = this.ks.state;
    const next = toggleYield(this.yielding ? { [this.human]: this.yielding } : {}, this.human, s.turn.number, s.turn.active)[this.human];
    this.yielding = next;
    if (next) this.pacing?.skip();
    this.note(next ? "Yielding until the end of this turn." : "Yield cancelled.", "Priority");
  };
  /** "Stop Next": the very next priority window opens, whatever the settings */
  stopNext = (): void => { this.holdArmedAt = this.ks.version; this.note("Stop Next: you will be asked at the next priority window.", "Priority"); };

  // ------------------------------------------------------------------ what the human may do now (the options panel)

  /** the actions worth a button: casts (every way of casting), non-mana abilities, morph / prepared; land drops. Empty unless the human holds priority. */
  options(): LegalAction[] {
    const s = this.ks.state;
    if (s.pending || s.combat?.expect || s.priority !== this.human) return [];
    return this.legalNow().filter((a) => !!a.action && !a.isMana && (a.kind === "castSpell" || a.kind === "activateAbility" || a.kind === "turnFaceUp" || a.kind === "unlockDoor" || a.kind === "castPrepared" || a.kind === "playLand"));
  }
  /** the ways of using one card that only the kernel lists (turn a morph face up, cast a prepared copy, flashback / alternative-cost casts); shown in the card's detail view */
  cardActions(cardId: string): Array<{ id: string; label: string; title?: string }> {
    const id = this.kid(cardId);
    const dbg = this.debugCardEntry(cardId);
    return [...this.normalCardActions(id), ...(dbg ? [dbg] : [])];
  }
  private normalCardActions(id: ObjId): Array<{ id: string; label: string; title?: string }> {
    return this.options()
      .filter((a) => a.objectId === id && (a.kind === "turnFaceUp" || a.kind === "activateAbility" || // every legal non-mana activated ability, whether or not the legacy text parsers recognise its wording (Zur's "becomes a creature")
 a.kind === "unlockDoor" || a.kind === "castPrepared" || (a.kind === "castSpell" && ((!!a.option && a.option !== "normal") || (!!a.face && this.options().filter((x) => x.kind === "castSpell" && x.objectId === id && x.face).length > 1)))))
      .map((a) => ({ id: a.id, label: a.label, ...(a.asks ? { title: `Asks: ${a.asks.replace(/_/g, " ")}` } : {}) }));
  }
  /** can the selected hand card be cast / played right now (the dock's "Respond Selected") */
  selectedCanRespond(): boolean {
    return !!this.selectedCardId && this.handHints().castable.includes(this.selectedCardId);
  }
  /** hand card ids (legacy ids when they had one) that can be played right now, for highlighting */
  playableCardIds(): Set<string> {
    const out = new Set<string>();
    for (const a of this.options()) if (a.objectId && (a.kind === "castSpell" || a.kind === "playLand") && a.zone === "hand") out.add(this.ks.legacyIdOf(a.objectId) ?? a.objectId);
    return out;
  }
  /** hand cards that glow (castable / playable now) and, for the others, the reason shown in their tooltip; empty unless the human may act */
  handHints(): { castable: string[]; reasons: Record<string, string> } {
    // free-cast mode (debug): every card of the hand can be cast; not cached (the mode flips without a game version change)
    if (this.freeCastOn()) return { castable: (this.table().session.seats.find((x) => x.id === this.human)?.board.hand ?? []).map((c) => c.id), reasons: {} };
    if (this.hintCache?.ver === this.ks.version) return this.hintCache.hints;
    const s = this.ks.state;
    const holds = s.priority === this.human && !s.pending && !s.combat?.expect;
    const playable = this.playableCardIds();
    const hand = this.table().session.seats.find((x) => x.id === this.human)?.board.hand ?? [];
    const hints = { castable: [] as string[], reasons: {} as Record<string, string> };
    for (const c of hand) {
      const h = castHint(c.id, { playable, holdsPriority: holds, isLand: /\bland\b/i.test(c.typeLine), stackEmpty: !s.stack.length, mainPhase: /main/i.test(String(s.turn.phase ?? "")), activeTurn: s.turn.active === this.human });
      if (h.castable) hints.castable.push(c.id); else if (h.reason && holds) hints.reasons[c.id] = h.reason;
    }
    this.hintCache = { ver: this.ks.version, hints };
    return hints;
  }
  private hintCache?: { ver: number; hints: { castable: string[]; reasons: Record<string, string> } };

  // ---- click-to-pick for the open decision (targets, discards, sacrifices ...): the selection lives here so the board and the dialog share one truth
  private pickSel?: { id: string; ids: string[]; list: boolean };
  private selFor(d: DecisionView): { id: string; ids: string[]; list: boolean } {
    if (this.pickSel?.id !== d.id) this.pickSel = { id: d.id, ids: [], list: false };
    return this.pickSel;
  }
  // ------------------------------------------------------------------ paying by hand (kernelPayment.ts)

  /** the 'Auto-pay (suggest)' proposal for the open payment: shown on the table first, tapped only when the player confirms it */
  private paySuggestion: { decisionId: string; ids: ObjId[] | null } | undefined;
  /** an attack / block declaration refused because its tax is not in the pool */
  private declTax: { message: string; action: Action } | undefined;
  private tableIdOf(id: ObjId): string { const t = this.ks.legacyIdOf(id) ?? id; return this.stackIndex.repOf.get(t) ?? t; }

  /** The payment banner (the legacy board-pick banner): the total with its parts, the pool, what is missing; glowing sources to click; Auto-pay (suggest) / Cancel. */
  paymentPick(): KernelBoardPick | undefined {
    const model = paymentOf(this.ks.state, this.human);
    const tax = !model && this.declTax && this.declaration() ? this.declTax : undefined;
    if (!model && !tax) return undefined;
    this.table();
    const legal = this.legalNow();
    const sources = payableSources(legal);
    const suggestion = model ? (this.paySuggestion?.decisionId === model.decisionId ? this.paySuggestion.ids : undefined) : undefined;
    const uniq = (ids: string[]) => [...new Set(ids)];
    const base = {
      legalCardIds: uniq(sources.map((id) => this.tableIdOf(id))), legalSeatIds: [] as string[],
      selectedCardIds: uniq((suggestion ?? []).map((id) => this.tableIdOf(id))), selectedSeatIds: [] as string[],
      onToggleCard: (cardId: string) => this.toggleTap(this.human, cardId),
      onToggleSeat: () => undefined,
      allowTapKey: true
    };
    if (tax) {
      return { ...base, title: tax.action.type === "declareAttackers" ? "Attack tax" : "Block tax", instruction: tax.message, summary: "Tap sources for the tax (click the glowing permanents), then declare again.", canConfirm: true, confirmLabel: "Declare again",
        onConfirm: () => { this.act(tax.action); }, onCancel: () => { this.declTax = undefined; this.bump(); } };
    }
    const m = model!;
    return {
      ...base,
      title: m.title, instruction: m.instruction,
      summary: suggestion ? `Suggested: ${suggestion.map((id) => this.nameOf(id)).join(", ") || "nothing more to tap"}. Press the button to tap them.` : suggestion === null ? "No automatic suggestion (Treasures and damaging sources are never suggested): tap sources yourself." : "Click the glowing permanents to tap them for mana; the cost is paid as soon as your pool covers it.",
      canConfirm: suggestion !== null,
      confirmLabel: suggestion?.length ? `Tap the suggested sources (${suggestion.length})` : "Auto-pay (suggest)",
      onConfirm: () => {
        if (suggestion?.length) { this.answer(m.decisionId, { ids: ["pay"], payWith: suggestion }); return; }
        this.paySuggestion = { decisionId: m.decisionId, ids: suggestionFor(this.ks.state, this.ks.ctx, this.human) ?? null };
        this.bump();
      },
      onCancel: () => { this.paySuggestion = undefined; this.answer(m.decisionId, { ids: ["cancel"] }); }
    };
  }
  /** is a payment (or a taxed declaration) waiting for the human? */
  paying(): boolean { return !!paymentOf(this.ks.state, this.human) || !!(this.declTax && this.declaration()); }

  /** the current board pick (undefined when the decision is not board-clickable, or the player asked for the list) */
  boardPick(): KernelBoardPick | undefined {
    const pay = this.paymentPick();
    if (pay) return pay;
    const d = this.table().decision;
    if (!d || !classifyDecision(d).board) return undefined;
    const sel = this.selFor(d);
    if (sel.list) return undefined;
    const m = boardPickModel(d);
    const chosen = new Set(sel.ids);
    const cardOf = (opt: string) => Object.keys(m.cardOptions).find((k) => m.cardOptions[k] === opt);
    // token stacks: the table shows one card for a stack, so the card ids it can click are the stack's representative; a click adds one more member, the tap after the last takes them all back
    this.table();
    const repOf = (id: string) => this.stackIndex.repOf.get(id) ?? id;
    const uniq = (ids: string[]) => [...new Set(ids)];
    return {
      title: d.source?.card ?? d.title,
      instruction: d.source?.card ? `${d.title}${d.instruction ? ": " + d.instruction : ""}` : d.instruction,
      legalCardIds: uniq(Object.keys(m.cardOptions).map(repOf)), legalSeatIds: Object.keys(m.seatOptions),
      selectedCardIds: uniq(Object.values(m.cardOptions).filter((o) => chosen.has(o)).map((o) => cardOf(o)!).filter(Boolean).map(repOf)),
      selectedSeatIds: Object.keys(m.seatOptions).filter((k) => chosen.has(m.seatOptions[k])),
      summary: selectionHint(d, sel.ids), canConfirm: canConfirm(d, sel.ids), confirmLabel: confirmLabel(d, sel.ids),
      onToggleCard: (cardId) => {
        const mem = this.stackMembers(cardId).filter((x) => m.cardOptions[x]);
        if (!mem.length) return;
        const next = mem.find((x) => !chosen.has(m.cardOptions[x]));
        if (next || mem.length === 1) this.togglePick(d.id, m.cardOptions[next ?? mem[0]]);
        else for (const x of mem) this.togglePick(d.id, m.cardOptions[x]);
      },
      onToggleSeat: (seatId) => { const o = m.seatOptions[seatId]; if (o) this.togglePick(d.id, o); },
      onConfirm: () => this.confirmPick(d.id),
      ...(d.cancellable ? { onCancel: () => { this.answer(d.id, { cancel: true }); } } : {}),
      onList: () => this.showList(d.id, true),
      ...(d.sourceCard ? { sourceCard: d.sourceCard } : {})
    };
  }
  /** art of the card a decision comes from (looked up by the name in the card JSON's prompt.source: the stack, then the board, then the hand) */
  decisionSourceArt(): string | undefined {
    const d = this.table().decision;
    const name = d?.source?.card;
    if (!name) return undefined;
    const t = this.table();
    const stackCards = [t.pendingAction, ...t.stackActions].map((a) => (a && "sourceCard" in a ? a.sourceCard : undefined));
    const cards = [...stackCards, ...t.session.seats.flatMap((s) => [...s.board.battlefield, ...s.board.hand, ...(s.board.graveyard ?? [])])];
    const c = cards.find((x) => x && x.name === name);
    return c?.imageUris?.small ?? c?.imageUris?.normal;
  }
  togglePick = (decisionId: string, optionId: string): void => {
    const d = this.table().decision;
    if (!d || d.id !== decisionId) return;
    const sel = this.selFor(d);
    sel.ids = toggleSelection(d, sel.ids, optionId);
    this.bump();
  };
  confirmPick = (decisionId: string): boolean => {
    const d = this.table().decision;
    if (!d || d.id !== decisionId) return false;
    const sel = this.selFor(d);
    if (!canConfirm(d, sel.ids)) return false;
    return this.answer(decisionId, pickChoice(sel.ids));
  };
  showList = (decisionId: string, list: boolean): void => {
    const d = this.table().decision;
    if (!d || d.id !== decisionId) return;
    this.selFor(d).list = list;
    this.bump();
  };

  /** run one listed action by its stable id (a stale id is a quiet no-op) */
  doOption = (id: string): boolean => {
    if (id.startsWith(DEBUG_ACTION_PREFIX)) { const d = debugOptionAction(id, (c) => { const o = this.ks.state.objects[c]; return !!o && !!this.ks.ctx.cards(o.cardName)?.types.includes("land"); }); return d ? this.debug(d) : false; }
    const a = this.legalNow().find((x) => x.id === id);
    if (!a?.action) { this.bump(); return false; }
    return this.act(a.action);
  };
  /** does the human have a response right now (instant, flash, ability)? */
  canRespondNow(): boolean {
    const s = this.ks.state;
    return s.priority === this.human && hasResponse(this.legalNow(), s.turn.active === this.human && !s.stack.length);
  }

  /** One automatic action (an AI seat's choice, or the human's automatic pass). Returns false when it did nothing. Never throws. */
  step(): boolean { return this.runStep(); }

  /** the AI thinks in a worker (kernelAiWork.ts / kernelAiWorker.ts) instead of on the main thread; absent = in-process, as before */
  private aiRunner?: AiRunner;
  private thinking = false;
  hasAiRunner(): boolean { return !!this.aiRunner; }
  setAiRunner(r: AiRunner | undefined): void { this.aiRunner?.dispose?.(); this.aiRunner = r; }

  /**
   * step() for a driver that must not block rendering: when the AI seat needs real thinking (not a plain pass), the worker computes legal actions + the choice while the
   * page keeps drawing; the result is applied only if the game did not move meanwhile. Same answer as step() (the AI is a pure function of state, seat and memory).
   */
  async stepAsync(): Promise<boolean> {
    const s = this.ks.state;
    const actor = this.ks.actor;
    const runner = this.aiRunner;
    if (!runner || !actor || actor === this.human || s.gameOver || this.ks.degraded || quickAiAction(s, actor, { banned: new Set() })) return this.step();
    if (this.memoryTurn !== s.turn.number) { this.memory = freshMemory(this.memory); this.memoryTurn = s.turn.number; }
    const ver = this.ks.version;
    let reply;
    try { reply = await runner.choose({ state: s, seat: actor, memory: toWire(this.memory) }); }
    catch { this.aiRunner = undefined; return this.step(); } // the worker is broken: think in-process from now on
    if (this.ks.version !== ver) return true; // the game moved on while the AI was thinking (a human click): the answer is stale, ask again
    if (reply.error) { this.aiRunner = undefined; return this.step(); }
    adoptMemory(this.memory, fromWire(reply.memory));
    return this.runStep({ action: reply.action });
  }

  private runStep(decided?: { action: Action | undefined }): boolean {
    try {
      const s = this.ks.state;
      if (s.gameOver || this.ks.degraded) return false;
      const actor = this.ks.actor;
      if (!actor) return false;
      if (this.autoTurn.turn !== s.turn.number) { this.autoTurn = { turn: s.turn.number, count: 0 }; }
      if (this.memoryTurn !== s.turn.number) { this.memory = freshMemory(this.memory); this.memoryTurn = s.turn.number; }
      let action: Action | undefined;
      if (actor === this.human) action = this.humanAutoAction();
      else {
        action = decided ? decided.action : quickAiAction(s, actor, this.memory); // a plain pass / advance needs no legal-action list (kernelAi.ts)
        if (!action && !decided) action = chooseAiAction(this.ks.legal(actor), s, this.ks.ctx, actor, this.memory);
        if (!action) { this.stall(`${this.nameOf(actor)} has no legal action`); return false; }
        if (this.autoTurn.count >= MAX_AUTO_ACTIONS_PER_TURN) action = fallbackPass(s, actor);
        else if (action.type === "advancePhase" && !s.stack.length && !s.combat?.expect && this.humanWindowAhead()) action = { type: "passPriority", player: actor };
      }
      if (!action) return false;
      this.autoTurn.count++;
      const before = this.ks.version;
      const seen = this.beforeStep();
      const res = this.ks.dispatch(actor, action);
      if (res.ok || this.ks.version !== before) { this.failures = 0; this.observe(seen, action); this.bump(); return true; }
      // refused: never retry the same thing; fall back to the least committal move, and give up loudly after three refusals in a row
      this.failures++;
      const key = actionKey(action);
      if (action.type === "castSpell" || action.type === "playLand" || action.type === "activateAbility") for (const a of this.ks.legal(actor)) if (a.action && actionKey(a.action) === key) this.memory.banned.add(a.id);
      if (this.failures >= 3) { this.stall(`${this.nameOf(actor)}'s action was refused (${res.error?.message ?? "unknown"})`); return false; }
      const fb = this.ks.legal(actor)[0]?.kind === "answerDecision" ? undefined : fallbackPass(this.ks.state, actor);
      if (fb && actionKey(fb) !== key) { const r2 = this.ks.dispatch(actor, fb); if (r2.ok) { this.bump(); return true; } }
      this.bump();
      return true;
    } catch (e) {
      this.stall(`driver error: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  private stall(why: string): void {
    this.stalledAt = this.ks.version;
    this.note(`The kernel game is waiting: ${why}.`, "Kernel");
  }

  /** Pace step() with timers until stopped. Re-arms itself whenever the game changes (a human click, an AI action). Returns the stop function. */
  startDriver(setT: (fn: () => void, ms: number) => Timer = setTimeout, clearT: (t: Timer) => void = clearTimeout): () => void {
    if (this.running) return () => undefined;
    this.running = true;
    this.driverClear = clearT;
    const arm = (): void => {
      if (!this.running || this.timer !== undefined || this.thinking || !this.needsStep()) return;
      const human = this.ks.actor === this.human;
      // a visible change (a cast, a trigger, a resolution, combat) is shown for its pacing delay before anyone passes or advances; a new wait noted while a shorter timer runs re-arms
      const hold = this.pacing?.remaining() ?? 0;
      this.timer = setT(() => {
        this.timer = undefined;
        if ((this.pacing?.remaining() ?? 0) > 0) { arm(); return; }
        if (this.aiRunner) { this.thinking = true; void this.stepAsync().catch(() => false).finally(() => { this.thinking = false; arm(); }); return; }
        this.step(); arm();
      }, hold > 0 ? hold : this.pace(human ? 900 : 700));
    };
    const unsub = this.subscribe(arm);
    arm();
    return () => { this.running = false; unsub(); if (this.timer !== undefined) clearT(this.timer); this.timer = undefined; };
  }
}

function fallbackPass(s: { turn: { active: string }; stack: unknown[] }, seat: PlayerId): Action {
  return s.turn.active === seat && !s.stack.length ? { type: "advancePhase", player: seat } : { type: "passPriority", player: seat };
}

function actionKey(a: Action): string { return JSON.stringify(a); }

export type { CardRef };
