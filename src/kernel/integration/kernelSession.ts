// KernelSession: the host-side object that owns ONE kernel game. It is the only thing that mutates kernel state in the app:
//   dispatch(player, action) -> resolve + unresolved-bridge push + per-player log; never throws, never leaves a half-done state
//   decide(player, decisionId, choice) -> dispatch(answerDecision) with a "stale answer" flag for the table
//   view(player) -> the legacy GameSession for that player (memoised, object identity stable across calls)
//   tableState(player) -> session + priority + stack panel + decision + declaring, in one call
// Pure TypeScript: no React, no DOM, no fs. It can move to a server unchanged (see the multiplayer plan, section 2.1).
// Determinism: same decks + same seed + same sequence of (player, action) = same game, events and logs (no Date / Math.random inside).
import { resolve } from "../engine/resolve";
import { newGame, type PlayerSetup } from "../engine/setup";
import { eventsFor, pendingFor, viewFor, type PlayerView } from "../engine/view";
import { legalActions, type LegalAction, type LegalOptions } from "../engine/legal";
import type { Action, Choice, EngineContext, EngineError, GameEvent, GameState, ObjId, PendingView, PlayerId } from "../engine/types";
import type { GameEvent as LogLine, GameSession, VisibleCard } from "../../lib/types";
import { UnresolvedBridge, type BridgeContext } from "../unresolvedBridge";
import type { UnresolvedRecord } from "../../lib/unresolvedLog";
import { toKernelState } from "../observer/adapter";
import type { DraftLookup } from "../observer/draftLookup";
import { formatEvents, namesForViewer } from "./eventLog";
import { StackLogBuilder } from "./stackLog";
import { fingerprint, type RecordedStep } from "./replayFile";
import { packDraftLookup } from "./packLookup";
import { displayFromDef, type DisplayCard, type PackKit } from "./cardPack";
import { cardForName, SPECTATOR, toSession, type SeatMeta, type ToSessionEnv } from "./toSession";
import { toTableState, type TableState } from "./tableState";

export { SPECTATOR };

export interface KernelDeck { id: PlayerId; name?: string; deck: string[]; commander?: string; kind?: SeatMeta["kind"]; agentName?: SeatMeta["agentName"]; remoteSlot?: string }

export interface KernelSessionOptions {
  /** engine card lookup + CardDb (a pack kit's `lookup` / `db`) */
  ctx: EngineContext;
  /** printed display data by card name (art, oracle text); default: synthesised from the card definitions */
  display?: (name: string) => DisplayCard | undefined;
  /** token art by spec (a pack kit's `tokenArt`); default none = the placeholder card */
  tokenArt?: ToSessionEnv["tokenArt"];
  /** per-seat metadata (human / agent / remote slot) */
  seats?: Record<PlayerId, SeatMeta>;
  /** receives each distinct `unresolved` occurrence (full, unredacted events); e.g. appendUnresolvedRecord on the server */
  sink?: (record: UnresolvedRecord) => void;
  gameId?: string;
  /** deck names for the unresolved records */
  deckNames?: string[];
  /** ISO timestamp source for log lines and unresolved records (default "": tests and replays stay deterministic) */
  now?: () => string;
  /** the log keeps this many lines per viewer (default 300) */
  maxLog?: number;
}

export interface FromDecksOptions extends KernelSessionOptions {
  decks: KernelDeck[];
  seed?: number;
  startingLife?: number;
  /** default "precombat_main" so the first player can act at once; "upkeep" plays the whole first turn */
  startPhase?: "upkeep" | "precombat_main";
  openingHand?: number;
  /** Commander legality checks on the commanders (default off) */
  commanderRules?: boolean;
}

export interface DispatchResult {
  ok: boolean;
  /** the engine's refusal (state unchanged), or `internal` when the engine threw (the game is marked degraded) */
  error?: { code: EngineError["code"] | "internal"; message: string; capability?: string[] };
  /** the answer named a decision that is not open any more (a late click on an old dialog): show nothing, not an error */
  stale?: boolean;
  /** the full events of this action (host side; guests get `eventsFor(player)`) */
  events: GameEvent[];
  /** the decision the action opened (the full one: use pendingFor / view for a player) */
  pending?: PendingView;
  /** bumps by one for every accepted action */
  version: number;
}

export interface KernelSessionJson { v: 1; gameId: string; version: number; logSeq: number; state: GameState; logs: Record<string, LogLine[]>; degraded?: string }

const STALE = new Set<string>(["wrong_decision", "no_decision"]);

export class KernelSession {
  readonly ctx: EngineContext;
  readonly gameId: string;
  /** the ONLY truth in kernel mode */
  private st: GameState;
  private ver = 0;
  private logSeq = 0;
  private logs = new Map<string, LogLine[]>();
  private cache = new Map<string, { ver: number; table: TableState }>();
  private bridge?: UnresolvedBridge;
  private degradedWhy?: string;
  private legacyIds?: ReadonlyMap<ObjId, string>;
  private readonly opts: KernelSessionOptions;
  /** the stack / trigger resolution log, one per viewer (events are filtered per viewer, names too) */
  private stackLogs = new Map<string, StackLogBuilder>();
  /** replay recording: the state the game started from and every accepted action since, in order (see replayFile.ts) */
  private initial: GameState;
  private steps: RecordedStep[] = [];

  private constructor(state: GameState, opts: KernelSessionOptions, legacyIds?: ReadonlyMap<ObjId, string>) {
    this.st = state;
    this.opts = opts;
    this.ctx = opts.ctx;
    this.gameId = opts.gameId ?? `kernel-${state.seed}`;
    this.legacyIds = legacyIds;
    this.initial = structuredClone(state);
    if (opts.sink) {
      const bc: BridgeContext = { gameId: this.gameId, decks: opts.deckNames, seatKindOf: (id) => (opts.seats?.[id]?.kind === "human" ? "human" : "agent"), ...(opts.now ? { now: opts.now } : {}) };
      this.bridge = new UnresolvedBridge(bc, opts.sink);
    }
    for (const p of state.players) this.logs.set(p.id, []);
    this.logs.set(SPECTATOR, []);
    this.applyManualPay();
    this.initial = structuredClone(this.st);
    for (const id of this.logs.keys()) this.stackLogs.set(id, this.newStackLog());
  }

  /** Human seats pay mana costs BY HAND (CR 601.2g-h): the engine never taps their sources for them (see config.manualPay); agents, the observer and tests are paid for automatically. */
  private applyManualPay(): void {
    const humans = this.st.players.map((p) => p.id).filter((id) => this.opts.seats?.[id]?.kind === "human");
    if (humans.length) this.st.config.manualPay = humans; else delete this.st.config.manualPay;
  }

  // ------------------------------------------------------------------ creation

  /** A new game from deck lists (card names). Seats are the `decks` in order; the first one starts. Live-game mode: `onUnsupported: "continue"`. */
  static fromDecks(o: FromDecksOptions): KernelSession {
    const players: PlayerSetup[] = o.decks.map((d) => ({ id: d.id, name: d.name ?? d.id, deck: d.deck, ...(d.commander ? { commander: d.commander } : {}) }));
    const state = newGame({ players, cards: o.ctx.cards, seed: o.seed ?? 1, ...(o.startingLife !== undefined ? { startingLife: o.startingLife } : {}), startPhase: o.startPhase ?? "precombat_main", ...(o.openingHand !== undefined ? { openingHand: o.openingHand } : {}), ...(o.commanderRules ? { commanderRules: true } : {}), config: { onUnsupported: "continue" } });
    const seats = { ...Object.fromEntries(o.decks.map((d) => [d.id, { kind: d.kind, agentName: d.agentName, remoteSlot: d.remoteSlot } as SeatMeta])), ...(o.seats ?? {}) };
    return new KernelSession(state, { ...o, seats });
  }

  /** An existing state (tests, saves, hosts that built the state themselves). */
  static fromState(state: GameState, o: KernelSessionOptions): KernelSession { return new KernelSession(structuredClone(state), o); }

  /**
   * The end of the legacy mulligans: the legacy session (hands kept, seats, commanders) becomes the kernel game, through the forward adapter.
   * Card ids stay the legacy ids on the derived session (`legacyIds`), the display data of the cards the players already saw is used as is.
   * `lookup` is a DraftLookup (Node: loadDraftLookup(); browser: packDraftLookup(kit)).
   */
  static fromLegacyHandoff(session: GameSession, o: KernelSessionOptions & { lookup: DraftLookup | PackKit; seed?: number }): KernelSession {
    const lookup: DraftLookup = "register" in o.lookup ? o.lookup : packDraftLookup(o.lookup);
    const adapt = toKernelState(session, { lookup, seed: o.seed ?? 1, onUnsupported: "continue", strictHooks: true });
    const seen = new Map<string, DisplayCard>();
    for (const seat of session.seats) for (const c of [...seat.board.hand, ...seat.board.battlefield, ...(seat.board.graveyard ?? []), ...(seat.board.exile ?? []), ...(seat.library ?? []), ...(seat.board.commander ? [seat.board.commander] : [])]) {
      if (c.token || seen.has(c.name)) continue;
      seen.set(c.name, { name: c.name, typeLine: c.typeLine, oracleText: c.oracleText, ...(c.manaCost ? { manaCost: c.manaCost } : {}), manaValue: c.manaValue, colors: c.colors, ...(c.colorIdentity ? { colorIdentity: c.colorIdentity } : {}), ...(c.producedMana ? { producedMana: c.producedMana } : {}), ...(c.imageUris ? { imageUris: c.imageUris } : {}), ...(c.faces ? { faces: c.faces } : {}), ...(c.power !== undefined ? { power: c.power } : {}), ...(c.toughness !== undefined ? { toughness: c.toughness } : {}), ...(c.loyalty !== undefined ? { loyalty: c.loyalty } : {}) });
    }
    const display = (name: string) => seen.get(name) ?? o.display?.(name);
    const seats = { ...Object.fromEntries(session.seats.map((s) => [s.id, { kind: s.kind, agentName: s.agentName, remoteSlot: s.remoteSlot } as SeatMeta])), ...(o.seats ?? {}) };
    const ks = new KernelSession(adapt.state, { ...o, display, seats, gameId: o.gameId ?? session.id }, adapt.toLegacy);
    ks.advanceToPriority();
    ks.initial = structuredClone(ks.st); ks.steps = []; // the replay starts from the position after the hand-off
    for (const id of ks.logs.keys()) ks.stackLogs.set(id, ks.newStackLog());
    return ks;
  }

  /** Restore from `toJSON()`. */
  static restore(json: KernelSessionJson, o: KernelSessionOptions): KernelSession {
    const ks = new KernelSession(structuredClone(json.state), { ...o, gameId: o.gameId ?? json.gameId });
    ks.ver = json.version; ks.logSeq = json.logSeq; ks.degradedWhy = json.degraded;
    for (const [k, v] of Object.entries(json.logs)) ks.logs.set(k, [...v]);
    return ks;
  }

  toJSON(): KernelSessionJson {
    return { v: 1, gameId: this.gameId, version: this.ver, logSeq: this.logSeq, state: structuredClone(this.st), logs: Object.fromEntries(this.logs), ...(this.degradedWhy ? { degraded: this.degradedWhy } : {}) };
  }

  // ------------------------------------------------------------------ reading

  /** the full state (host only: never send it to a player; use `viewFor` / `view`) */
  get state(): GameState { return this.st; }
  get version(): number { return this.ver; }
  /** set when the engine threw while handling an action (the state is the one before it); the host shows a banner */
  get degraded(): string | undefined { return this.degradedWhy; }
  get gameOver(): GameState["gameOver"] { return this.st.gameOver; }
  /** who the engine is waiting for: the decision owner, the declaring player, or the priority holder */
  get actor(): PlayerId | undefined {
    const s = this.st;
    if (s.gameOver) return undefined;
    if (s.pending) return s.pending.player;
    const ex = s.combat?.expect;
    if (ex) return ex.kind === "attackers" ? ex.player : ex.players[0];
    return s.priority ?? undefined;
  }

  private env(viewer: PlayerId): ToSessionEnv {
    return { ctx: this.ctx, display: this.opts.display ?? ((n) => { const d = this.ctx.cards(n); return d ? displayFromDef(d) : undefined; }), tokenArt: this.opts.tokenArt, seats: this.opts.seats, log: this.logs.get(viewer) ?? [], legacyIds: this.legacyIds, id: this.gameId };
  }

  /** The legacy GameSession for `viewer` (a player id or SPECTATOR). Memoised per version; untouched cards / seats keep their object identity. */
  view(viewer: PlayerId): GameSession { return this.tableState(viewer).session; }

  /** session + priority + stack panel + decision + declaring state. Memoised per (viewer, version). */
  tableState(viewer: PlayerId): TableState {
    const hit = this.cache.get(viewer);
    if (hit && hit.ver === this.ver) return hit.table;
    const table = toTableState(this.st, viewer, this.env(viewer), hit?.table);
    // the log array is part of the session; a new line list is a new session even when the board did not change
    this.cache.set(viewer, { ver: this.ver, table });
    return table;
  }

  /** the redacted kernel view (what a remote client may be sent) */
  viewFor(viewer: PlayerId): PlayerView { return viewFor(this.st, viewer); }
  /** the open decision as `viewer` may see it (options only for its owner) */
  pendingFor(viewer: PlayerId): ReturnType<typeof pendingFor> { return pendingFor(this.st.pending, viewer); }
  /** events as `viewer` may see them (pass the `events` of a DispatchResult) */
  eventsFor(viewer: PlayerId, events: readonly GameEvent[]): GameEvent[] { return eventsFor(this.st, viewer, [...events]); }
  /** the game log lines for `viewer`, newest first */
  log(viewer: PlayerId): readonly LogLine[] { return this.logs.get(viewer) ?? []; }
  /** the stack / trigger resolution log as `viewer` may see it (stackLog.ts) */
  stackLog(viewer: PlayerId): StackLogBuilder { let b = this.stackLogs.get(viewer); if (!b) { b = this.newStackLog(); this.stackLogs.set(viewer, b); } return b; }
  private newStackLog(): StackLogBuilder {
    return new StackLogBuilder({
      where: (id) => (id ? this.st.objects[id]?.zone : undefined),
      textOf: (id) => { const o = id ? this.st.objects[id] : undefined; if (!o) return undefined; const n = o.token?.name ?? o.cardName; return this.opts.display?.(n)?.oracleText; }
    });
  }
  /** the recording of this game: the state it started from and every accepted action in order (the engine is deterministic, so this replays the exact game) */
  recording(): { initialState: GameState; steps: readonly RecordedStep[]; seats: Record<PlayerId, SeatMeta> | undefined } { return { initialState: this.initial, steps: this.steps, seats: this.opts.seats }; }
  /** everything `player` may start now */
  legal(player: PlayerId, o?: LegalOptions): LegalAction[] { return legalActions(this.st, player, this.ctx, o); }

  // ------------------------------------------------------------------ acting

  /** Apply one action. The action's own `player` must be `player` (a mismatch is refused: a client can never act for somebody else). */
  dispatch(player: PlayerId, action: Action): DispatchResult {
    if (action.player !== player) return { ok: false, error: { code: "not_your_priority", message: `action is for ${action.player}, sent by ${player}` }, events: [], version: this.ver };
    let res;
    try { res = resolve(this.st, action, this.ctx); }
    catch (e) {
      // never into React: the state is the one before the action (resolve clones its input)
      this.degradedWhy = e instanceof Error ? e.message : String(e);
      return { ok: false, error: { code: "internal", message: this.degradedWhy }, events: [], version: this.ver };
    }
    // the bridge sees the FULL events of every call, accepted or not (a refused cast can still report what it could not do)
    try { this.bridge?.push(res.events); } catch { /* logging must never reach the game */ }
    if (res.error && res.error.code !== "loop_detected") return { ok: false, error: res.error, ...(STALE.has(res.error.code) ? { stale: true } : {}), events: res.events, version: this.ver };
    this.st = res.state;
    this.ver++;
    this.steps.push({ p: player, a: structuredClone(action), fp: fingerprint(this.st) });
    this.appendLog(res.events);
    return { ok: !res.error, ...(res.error ? { error: res.error } : {}), events: res.events, ...(res.pending ? { pending: res.pending } : {}), version: this.ver };
  }

  /** debug mode (sandbox.ts) is on for this game */
  get sandbox(): boolean { return !!this.st.config.sandbox; }
  /** True once debug mode was switched on or a debug action was used: replay files and the stack log say so */
  get sandboxUsed(): boolean { return !!this.st.sandboxUsed; }
  /** The host's debug-mode switch (recorded like any action: a replay shows when it was on). Never offered to a multiplayer guest. */
  setSandbox(player: PlayerId, on: boolean): DispatchResult { return this.dispatch(player, { type: "sandboxMode", player, on }); }

  /** Debug mode only (else empty): the viewer's OWN cards of a zone as tiles with art, for the debug picker; the library is listed top first. Ids are the kernel object ids. */
  debugCards(viewer: PlayerId, zone: "library" | "hand" | "graveyard" | "exile"): VisibleCard[] {
    if (!this.st.config.sandbox) return [];
    const p = this.st.players.find((x) => x.id === viewer);
    if (!p) return [];
    const env = this.env(viewer);
    const out: VisibleCard[] = [];
    for (const id of p[zone]) {
      const o = this.st.objects[id];
      const card = o ? cardForName(env, o.cardName) : undefined;
      if (card) out.push({ ...card, id, zone });
    }
    return out;
  }
  /** Debug mode only (else empty): every card name the loaded card packs know (what "Conjure card" can create) */
  debugCardNames(): readonly string[] { return this.st.config.sandbox ? this.ctx.db?.cardNames() ?? [] : []; }
  /** Debug mode only: a card by name as a tile (for the conjure list) */
  debugCardByName(name: string): VisibleCard | undefined { return this.st.config.sandbox ? cardForName(this.env(this.st.players[0].id), name) : undefined; }

  /** Answer the open decision. A late answer to an old decision is refused with `stale: true` and changes nothing. */
  decide(player: PlayerId, decisionId: string, choice: Choice): DispatchResult { return this.dispatch(player, { type: "answerDecision", player, decisionId, choice }); }

  private appendLog(events: readonly GameEvent[]): void {
    if (!events.length) return;
    const max = this.opts.maxLog ?? 300;
    const at = this.opts.now?.() ?? "";
    for (const viewer of this.logs.keys()) {
      const lines = formatEvents(eventsFor(this.st, viewer, [...events]), namesForViewer(this.st, viewer), "k", this.logSeq, at);
      if (!lines.length) continue;
      const old = this.logs.get(viewer)!;
      this.logs.set(viewer, [...lines.reverse(), ...old].slice(0, max)); // newest first, like GameSession.events
    }
    for (const [viewer, b] of this.stackLogs) b.push(eventsFor(this.st, viewer, [...events]), namesForViewer(this.st, viewer));
    this.logSeq += events.length;
  }

  /**
   * A hand-off from the legacy "untap step" (nobody holds priority there): start the turn the way the engine does, by advancing out of the previous
   * player's cleanup step, so untap and the first draw rule run and the active player ends up with priority in the upkeep.
   */
  advanceToPriority(): void {
    const s = this.st;
    if (s.gameOver || s.pending || s.combat?.expect || s.priority !== null || s.turn.phase !== "untap") return;
    const seats = s.players.map((p) => p.id);
    const prev = seats[(seats.indexOf(s.turn.active) - 1 + seats.length) % seats.length];
    const st = structuredClone(s);
    st.turn = { number: s.turn.number - 1, active: prev, phase: "cleanup" };
    st.priority = prev; st.passes = []; st.combat = null;
    const res = resolve(st, { type: "advancePhase", player: prev }, this.ctx);
    if (res.error) return;
    this.st = res.state;
    this.ver++;
    this.appendLog(res.events);
  }

  /** Re-point a legacy hand-off card (used by hosts that renamed ids); returns the legacy id of a kernel object, if it had one. */
  legacyIdOf(id: ObjId): string | undefined { return this.legacyIds?.get(id); }
  /** the card as the table shows it (for dialogs); undefined when hidden from `viewer` */
  cardFor(viewer: PlayerId, id: ObjId): VisibleCard | undefined {
    const ts = this.tableState(viewer);
    for (const s of ts.session.seats) for (const c of [...s.board.battlefield, ...s.board.hand, ...(s.board.graveyard ?? []), ...(s.board.exile ?? []), ...(s.board.commander ? [s.board.commander] : [])]) if (c.id === (this.legacyIds?.get(id) ?? id)) return c;
    return undefined;
  }
}
