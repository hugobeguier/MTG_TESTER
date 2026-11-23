// KernelGameController: everything the UI does to ONE kernel game, as a plain class (no React) so it is testable headless.
//   - owns the KernelSession (the only truth), the human's seat, and the table-side bits the kernel does not have (log notes, attack / block picks)
//   - table(): the TableState the 3D table renders (session + stack + decision), with stable object identity until something changes
//   - the intent API: the same `on*` callback names ThreeGameTable already takes (tableProps()); intents with no kernel meaning are inert and leave a log note
//   - step(): ONE action for whoever the engine waits for when that is not a human decision: AI seats (kernelAi.ts) and the human's automatic passes
//   - startDriver(): paces step() with timers (the hook useKernelDriver owns its lifetime); never loops forever (per-turn cap, stall guard)
// A rejected action never changes anything (KernelSession.dispatch returns the old state); the controller turns the refusal into a log note.
import type { KernelSession, DispatchResult } from "@/kernel/integration/kernelSession";
import type { DecisionView, TableState } from "@/kernel/integration/tableState";
import type { KernelBoardPick } from "@/components/ThreeGameTable";
import { boardPickModel, canConfirm, castHint, classifyDecision, confirmLabel, pickChoice, selectionHint, toggleSelection } from "./kernelDecisionView";
import { legalActions, type LegalAction } from "@/kernel/engine/legal";
import type { Action, Choice, GameState, ObjId, PlayerId } from "@/kernel/engine/types";
import type { GameEvent as LogLine, GameSession, VisibleCard } from "@/lib/types";
import { chooseAiAction, type AiMemory } from "./kernelAi";
import { evaluateWindow, hasResponse, type WindowVerdict } from "./kernelStops";
import { DEFAULT_STOP_SETTINGS, stopKey, type PriorityStopSettings } from "@/lib/priorityStops";
import { toggleYield, type SeatYield } from "@/engine/yieldPolicy";

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
    this.inspectedCard = card; this.bump();
  };
  closeInspect = (): void => { this.inspectedCard = undefined; this.bump(); };
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

  constructor(ks: KernelSession, o: ControllerOptions) {
    this.ks = ks;
    this.human = o.human;
    this.pace = o.pace ?? ((ms) => ms);
    this.stopSettings = { ...(o.stops ?? DEFAULT_STOP_SETTINGS), fullControl: false };
    this.saveStops = o.saveStops;
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
    if (this.positions.size) session = this.withPositions(session);
    if (Object.keys(this.attackPicks).length) session = this.withAttackPicks(session);
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
    this.positions.set(cardId, position);
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
    const res: DispatchResult = this.ks.dispatch(this.human, action);
    if (res.ok || this.ks.version !== before) { this.attackPicks = {}; this.blockPicks = {}; this.blockIdx = 0; this.failures = 0; this.bump(); return res.ok; }
    if (!res.stale) this.note(`Can't do that: ${res.error?.message ?? "the engine refused"}.`, "Rules");
    else this.bump();
    return false;
  }

  private legalFor(kind: LegalAction["kind"], objectId: ObjId): LegalAction[] {
    return this.legalNow().filter((a) => a.kind === kind && a.objectId === objectId);
  }

  /** answer the open decision; `decisionId` is the id the dialog was rendered for (a late click on an older dialog is ignored) */
  answer = (decisionId: string, choice: Choice): boolean => {
    const res = this.ks.decide(this.human, decisionId, choice);
    if (!res.ok && !res.stale) this.note(`That choice was refused: ${res.error?.message ?? "invalid"}.`, "Rules");
    else this.bump();
    return res.ok;
  };

  playCard = (seatId: string, cardId: string, _pos?: unknown, _zone?: string): void => {
    if (seatId !== this.human) return this.inert("play a card for another seat");
    const id = this.kid(cardId);
    const lands = this.legalFor("playLand", id);
    const casts = this.legalFor("castSpell", id);
    const pick = lands[0] ?? casts.find((a) => !a.option || a.option === "normal") ?? casts[0];
    if (pick?.action) { this.act(pick.action); return; }
    // not listed: ask the engine directly so the player gets its reason ("wrong timing", "cannot pay", ...)
    const o = this.ks.state.objects[id];
    const isLand = !!o && !!this.ks.ctx.cards(o.cardName)?.types.includes("land");
    this.act(isLand ? { type: "playLand", player: this.human, cardId: id } : { type: "castSpell", player: this.human, cardId: id, autoPay: true });
  };

  playCardFace = (seatId: string, cardId: string, faceIndex: number): void => {
    if (seatId !== this.human) return this.inert("play a card for another seat");
    const id = this.kid(cardId);
    const options = [...this.legalFor("playLand", id), ...this.legalFor("castSpell", id)].filter((a) => a.face);
    const pick = options[faceIndex] ?? options[0];
    if (pick?.action) this.act(pick.action); else this.playCard(seatId, cardId);
  };

  castCommander = (seatId: string): void => {
    if (seatId !== this.human) return this.inert("cast a commander for another seat");
    const cmd = this.legalNow().find((a) => a.kind === "castSpell" && a.zone === "command" && a.action);
    if (cmd?.action) { this.act(cmd.action); return; }
    const id = this.ks.state.players.find((p) => p.id === this.human)?.command[0];
    if (id) this.act({ type: "castSpell", player: this.human, cardId: id, autoPay: true }); else this.note("There is no commander in the command zone.", "Rules");
  };

  /** cast from exile / graveyard (flashback, permissions): the kernel lists those casts itself */
  castFromZone = (seatId: string, cardId: string): void => {
    if (seatId !== this.human) return this.inert("cast for another seat");
    const id = this.kid(cardId);
    const pick = this.legalFor("castSpell", id).find((a) => a.action);
    if (pick?.action) this.act(pick.action); else this.note(`${this.nameOf(id)} can't be cast from there right now.`, "Rules");
  };

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
    const id = this.kid(cardId);
    const ways = manaWays(this.legalFor("activateAbility", id).filter((a) => a.isMana && a.action));
    // exactly one way: just do it; several (the free {C} and a damaging coloured ability, two colours): the player chooses, with the cost shown
    if (ways.length > 1) { this.manaPick = { cardName: this.nameOf(id), options: ways }; this.bump(); return; }
    if (ways[0]) this.act(ways[0].action); else this.note(`${this.nameOf(id)} has no mana ability you can use right now.`, "Rules");
  };

  /** every legacy "activate ..." callback lands here: the kernel lists the abilities by id, the table only knows an index */
  activateAbility = (seatId: string, cardId: string, abilityIndex = 0): void => {
    if (seatId !== this.human) return this.inert("activate another seat's ability");
    const id = this.kid(cardId);
    const list = this.legalFor("activateAbility", id).filter((a) => !a.isMana && a.action);
    const pick = list.length === 1 ? list[0] : list[abilityIndex] ?? list[0];
    if (pick?.action) this.act(pick.action); else this.note(`${this.nameOf(id)}: no ability can be activated right now.`, "Rules");
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

  /** "next phase": the active player's shortcut (nobody else gets priority); with a declaration open it means "no attack" */
  advanceTurn = (): void => {
    const s = this.ks.state;
    if (s.pending) { this.note("Answer the open question first.", "Rules"); return; }
    if (this.declaration()?.kind === "attackers") { this.confirmAttackers(); return; } // legacy "Continue" in the declare attackers step: the attackers picked so far go in
    if (s.turn.active === this.human && !s.stack.length) { this.act({ type: "advancePhase", player: this.human }); return; }
    this.passPriority();
  };

  /** hurry to the end of the human's turn: stops at a question, a declaration, or when the turn passes to somebody else */
  endTurn = (): void => {
    const turn = this.ks.state.turn.number;
    for (let i = 0; i < 40; i++) {
      const s = this.ks.state;
      if (s.gameOver || s.pending || s.turn.number !== turn || this.ks.actor !== this.human) break;
      if (s.turn.active !== this.human) break;
      if (this.declaration()?.kind === "attackers") { if (!this.confirmAttackers()) break; continue; }
      const ok = s.stack.length ? this.act({ type: "passPriority", player: this.human }) : this.act({ type: "advancePhase", player: this.human });
      if (!ok) break;
    }
  };

  // ---- combat declarations

  /** one attacker at a time (the legacy table's callback); sent together by confirmAttackers() */
  declareAttack = (cardId: string, targetId: string): void => {
    const id = this.kid(cardId);
    if (!this.declaration() || this.declaration()?.kind !== "attackers") { this.note("You are not declaring attackers now.", "Rules"); return; }
    const opt = this.declaration()?.kind === "attackers" ? (this.declaration() as Extract<Declaration, { kind: "attackers" }>).attackers.find((a) => a.id === id) : undefined;
    if (!opt) { this.note(`${this.nameOf(id)} can't attack this turn.`, "Rules"); return; }
    if (!targetId) {
      if (opt.mustAttack) this.note(`${opt.name} must attack if able.`, "Rules");
      else { const { [id]: _gone, ...rest } = this.attackPicks; this.attackPicks = rest; }
    } else {
      const target = this.kid(targetId);
      if (!opt.defenders.some((d) => d.id === target)) { this.note(`${opt.name} can't attack ${this.nameOf(target)}.`, "Rules"); return; }
      this.attackPicks = { ...this.attackPicks, [id]: target };
    }
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
    return this.act({ type: "declareAttackers", player: this.human, attackers: Object.entries(picks).map(([id, defender]) => ({ id, defender })), autoPay: true });
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
    for (const seat of this.table().session.seats) { const c = seat.board.battlefield.find((x) => x.id === legacy); if (c) return c; }
    return undefined;
  }

  /** the props the legacy table needs to run attack / block declarations (spread next to tableProps; recomputed each version) */
  combatProps(): Record<string, unknown> {
    if (this.combatCache?.ver === this.ver) return this.combatCache.props;
    const props: Record<string, unknown> = {};
    const d = this.declaration();
    if (d?.kind === "attackers") {
      const open = this.inspectedCard ? this.kid(this.inspectedCard.id) : undefined;
      const a = d.attackers.find((x) => x.id === open);
      if (a) {
        const targets = a.defenders.map((x) => ({ targetId: this.ks.legacyIdOf(x.id) ?? x.id, label: `Attack ${x.label}` }));
        if (a.id in d.picks) targets.push({ targetId: "", label: a.mustAttack ? "Attacks (must attack)" : "Do not attack" });
        props.humanAttackTargets = targets;
      }
    } else if (d?.kind === "blockers") {
      const att = this.currentAttacker();
      const attackingCard = att ? this.cardById(att) : undefined;
      if (att && attackingCard) {
        const seats = this.table().session.seats;
        const attackerSeat = seats.find((s) => s.board.battlefield.some((c) => c.id === attackingCard.id));
        const blockers = this.legalBlockersFor(att).map((id) => this.cardById(id)).filter((c): c is VisibleCard => !!c);
        props.blockChoice = { attackerName: attackerSeat?.name ?? "Opponent", defenderName: seats.find((s) => s.id === this.human)?.name ?? "You", attackingCard, blockers };
        props.selectedBlockerIds = (this.blockPicks[att] ?? []).map((id) => this.ks.legacyIdOf(id) ?? id);
      }
    }
    this.combatCache = { ver: this.ver, props };
    return props;
  }
  private combatCache?: { ver: number; props: Record<string, unknown> };

  /** legacy onToggleBlocker: tap a creature to add it (damage order = tap order) or remove it */
  toggleBlocker = (cardId: string): void => {
    const att = this.currentAttacker();
    if (!att) return;
    const id = this.kid(cardId);
    if (!this.legalBlockersFor(att).includes(id)) { this.note(`${this.nameOf(id)} can't block ${this.nameOf(att)}.`, "Rules"); return; }
    const cur = this.blockPicks[att] ?? [];
    this.blockPicks = { ...this.blockPicks, [att]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
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
  confirmBlockers = (): boolean => this.declaration()?.kind === "blockers" && this.act({ type: "declareBlockers", player: this.human, blocks: Object.entries(this.blockPicks).flatMap(([attacker, bl]) => bl.map((blocker) => ({ blocker, attacker }))), autoPay: true });
  /** no blocks at all (tests and the automatic skip) */
  passBlocks = (): boolean => { this.blockPicks = {}; return this.declaration()?.kind === "blockers" && this.act({ type: "declareBlockers", player: this.human, blocks: [], autoPay: true }); };

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
    this.note(next ? "Yielding until the end of this turn." : "Yield cancelled.", "Priority");
  };
  /** "Stop Next": the very next priority window opens, whatever the settings */
  stopNext = (): void => { this.holdArmedAt = this.ks.version; this.note("Stop Next: you will be asked at the next priority window.", "Priority"); };

  // ------------------------------------------------------------------ what the human may do now (the options panel)

  /** the actions worth a button: casts (every way of casting), non-mana abilities, morph / prepared; land drops. Empty unless the human holds priority. */
  options(): LegalAction[] {
    const s = this.ks.state;
    if (s.pending || s.combat?.expect || s.priority !== this.human) return [];
    return this.legalNow().filter((a) => !!a.action && !a.isMana && (a.kind === "castSpell" || a.kind === "activateAbility" || a.kind === "turnFaceUp" || a.kind === "castPrepared" || a.kind === "playLand"));
  }
  /** the ways of using one card that only the kernel lists (turn a morph face up, cast a prepared copy, flashback / alternative-cost casts); shown in the card's detail view */
  cardActions(cardId: string): Array<{ id: string; label: string; title?: string }> {
    const id = this.kid(cardId);
    return this.options()
      .filter((a) => a.objectId === id && (a.kind === "turnFaceUp" || a.kind === "castPrepared" || (a.kind === "castSpell" && !!a.option && a.option !== "normal")))
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
  /** the current board pick (undefined when the decision is not board-clickable, or the player asked for the list) */
  boardPick(): KernelBoardPick | undefined {
    const d = this.table().decision;
    if (!d || !classifyDecision(d).board) return undefined;
    const sel = this.selFor(d);
    if (sel.list) return undefined;
    const m = boardPickModel(d);
    const chosen = new Set(sel.ids);
    const cardOf = (opt: string) => Object.keys(m.cardOptions).find((k) => m.cardOptions[k] === opt);
    return {
      title: d.source?.card ?? d.title,
      instruction: d.source?.card ? `${d.title}${d.instruction ? ": " + d.instruction : ""}` : d.instruction,
      legalCardIds: Object.keys(m.cardOptions), legalSeatIds: Object.keys(m.seatOptions),
      selectedCardIds: Object.values(m.cardOptions).filter((o) => chosen.has(o)).map((o) => cardOf(o)!).filter(Boolean),
      selectedSeatIds: Object.keys(m.seatOptions).filter((k) => chosen.has(m.seatOptions[k])),
      summary: selectionHint(d, sel.ids), canConfirm: canConfirm(d, sel.ids), confirmLabel: confirmLabel(d, sel.ids),
      onToggleCard: (cardId) => { const o = m.cardOptions[cardId]; if (o) this.togglePick(d.id, o); },
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
  step(): boolean {
    try {
      const s = this.ks.state;
      if (s.gameOver || this.ks.degraded) return false;
      const actor = this.ks.actor;
      if (!actor) return false;
      if (this.autoTurn.turn !== s.turn.number) { this.autoTurn = { turn: s.turn.number, count: 0 }; }
      if (this.memoryTurn !== s.turn.number) { this.memory = { banned: new Set() }; this.memoryTurn = s.turn.number; }
      let action: Action | undefined;
      if (actor === this.human) action = this.humanAutoAction();
      else {
        const acts = this.ks.legal(actor);
        action = chooseAiAction(acts, s, this.ks.ctx, actor, this.memory);
        if (!action) { this.stall(`${this.nameOf(actor)} has no legal action`); return false; }
        if (this.autoTurn.count >= MAX_AUTO_ACTIONS_PER_TURN) action = fallbackPass(s, actor);
        else if (action.type === "advancePhase" && !s.stack.length && !s.combat?.expect && this.humanWindowAhead()) action = { type: "passPriority", player: actor };
      }
      if (!action) return false;
      this.autoTurn.count++;
      const before = this.ks.version;
      const res = this.ks.dispatch(actor, action);
      if (res.ok || this.ks.version !== before) { this.failures = 0; this.bump(); return true; }
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
    const arm = (): void => {
      if (!this.running || this.timer !== undefined || !this.needsStep()) return;
      const human = this.ks.actor === this.human;
      this.timer = setT(() => { this.timer = undefined; this.step(); arm(); }, this.pace(human ? 900 : 700));
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
