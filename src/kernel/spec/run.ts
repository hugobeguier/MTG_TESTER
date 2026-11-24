// Executes one spec scenario against the real kernel: builds the position, runs the scripted actions through the real `resolve` / `legalActions`,
// answers decisions as scripted, checks the expectations. Statuses: PASS / FAIL (an expectation or a scripted action did not hold: the card or engine
// disagrees with the oracle text) / SPEC_ERROR (the spec itself is wrong: unknown card, unresolvable reference, ...) / UNSUPPORTED (the engine reported
// `unresolved` or `unsupported` for something the card says, or the card has no draft).
import "../engine/resolve"; // FIRST (import cycle, see env.ts)
import { newObject, type Run } from "../engine/core";
import { effectiveView, legalActions, type ObjectView } from "../engine/legal";
import { newGame } from "../engine/setup";
import { resolve } from "../engine/resolve";
import type { Action, Choice, GameEvent, GameState, ObjId, PendingView, PlayerId, TokenDef } from "../engine/types";
import type { ActionSpec, AnswerSpec, EntrySpec, ExpectationSpec, ListSpec, NumSpec, ScenarioSpec, SpecFileSpec } from "./schema";
import { getEnv, type SpecEnv } from "./env";

export type SpecStatus = "PASS" | "FAIL" | "SPEC_ERROR" | "UNSUPPORTED";
export interface Failure { where: string; check: string; why?: string; expected: string; actual: string }
export interface ScenarioResult {
  card: string; scenario: string; status: SpecStatus; knownFailure?: string;
  failures: Failure[]; specError?: string; unsupported: string[]; noDraft: string[];
  actionLog: string[]; lastEvents: string[]; stack: string[]; durationMs: number;
}

class SpecError extends Error {}
/** a scripted action could not be performed / a scripted decision is not what the engine asked: the scenario stops there */
class Rejected extends Error { constructor(readonly error: { code: string; message: string }) { super(error.message); } }
class Stop extends Error { constructor(readonly failure: Failure) { super(failure.actual); } }

const ZONES = ["hand", "battlefield", "graveyard", "exile", "library", "command"] as const;
type Zone = (typeof ZONES)[number];
const ids4 = ["p1", "p2", "p3", "p4"];
const MAX_ACTIONS = 3000;
const MAX_MS = 20000;
const lc = (s: string) => s.toLowerCase();
const COLOR_WORD: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G", colorless: "C" };
const normColor = (s: string) => COLOR_WORD[lc(s)] ?? s.toUpperCase();

// ---------------------------------------------------------------- comparisons
const numOk = (v: number, s: NumSpec): boolean => (typeof s === "number" ? v === s : (s.equals === undefined || v === s.equals) && (s.atLeast === undefined || v >= s.atLeast) && (s.atMost === undefined || v <= s.atMost));
const numStr = (s: NumSpec): string => (typeof s === "number" ? `${s}` : [s.equals !== undefined ? `= ${s.equals}` : "", s.atLeast !== undefined ? `>= ${s.atLeast}` : "", s.atMost !== undefined ? `<= ${s.atMost}` : ""].filter(Boolean).join(" and "));
const bag = (xs: string[]) => { const m = new Map<string, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return m; };
/** problems of `actual` against a list spec; `sub`: expected entries are substrings of actual entries */
function listProblems(actual: string[], s: ListSpec, norm: (x: string) => string = lc, sub = false): string[] {
  const a = actual.map(norm); const out: string[] = [];
  const has = (e: string, pool: string[]) => (sub ? pool.some((x) => x.includes(e)) : pool.includes(e));
  if (s.exactly) {
    const e = s.exactly.map(norm);
    if (sub) { for (const x of e) if (!has(x, a)) out.push(`missing "${x}"`); if (a.length !== e.length) out.push(`has ${a.length} entries, expected ${e.length}`); }
    else { const ba = bag(a), be = bag(e); for (const [k, n] of be) if ((ba.get(k) ?? 0) < n) out.push(`missing ${n - (ba.get(k) ?? 0)}x "${k}"`); for (const [k, n] of ba) if ((be.get(k) ?? 0) < n) out.push(`unexpected ${n - (be.get(k) ?? 0)}x "${k}"`); }
  }
  if (s.atLeast) { const ba = bag(a); const need = bag(s.atLeast.map(norm)); for (const [k, n] of need) { const got = sub ? (has(k, a) ? n : 0) : ba.get(k) ?? 0; if (got < n) out.push(`missing ${n - got}x "${k}"`); } }
  if (s.noneOf) for (const x of s.noneOf.map(norm)) if (has(x, a)) out.push(`must not contain "${x}"`);
  return out;
}
const listStr = (s: ListSpec): string => [s.exactly ? `exactly [${s.exactly.join(", ")}]` : "", s.atLeast ? `at least [${s.atLeast.join(", ")}]` : "", s.noneOf ? `none of [${s.noneOf.join(", ")}]` : ""].filter(Boolean).join("; ");

// ---------------------------------------------------------------- the running game
interface Marker { step: number; line: string }
export class Game {
  state!: GameState;
  aliases = new Map<string, ObjId>();
  events: Array<{ step: number; line: string; ev: GameEvent }> = [];
  unresolved: string[] = [];
  actionLog: string[] = [];
  step = -1;
  calls = 0;
  started = Date.now();
  usedCards = new Set<string>();
  expectReject?: string;
  wasRejected = false;
  private partsCache = new Map<string, string[]>();
  /** every name a card goes by: the engine name, the full "A // B" name and each face name */
  names(cardName: string): string[] {
    let r = this.partsCache.get(cardName);
    if (!r) { let full = cardName; try { full = this.env.lookup.db.card(cardName)?.name ?? cardName; } catch { /* no DB */ } r = [...new Set([cardName, full, ...full.split(" // "), ...cardName.split(" // ")])].map(lc); this.partsCache.set(cardName, r); }
    return r;
  }
  constructor(readonly env: SpecEnv) {}

  run(): Run { return { s: this.state, events: [], defs: this.env.ctx.cards, scanned: 0 } as Run; }
  nameOf(id: string): string { const o = this.state.objects[id]; return o ? o.token?.name ?? o.copyDef?.name ?? o.cardName : id; }
  view(id: ObjId): ObjectView { return effectiveView(this.state, id, this.env.ctx); }

  describe(e: GameEvent): string {
    const parts: string[] = [e.type];
    for (const [k, v] of Object.entries(e)) {
      if (k === "type" || k === "seq") continue;
      const f = (x: unknown): string => (typeof x === "string" && /^#\d+$/.test(x) ? this.nameOf(x) : Array.isArray(x) ? `[${x.map(f).join(", ")}]` : x && typeof x === "object" ? JSON.stringify(x).replace(/#\d+/g, (m) => this.nameOf(m)) : String(x));
      parts.push(`${k}=${f(v)}`);
    }
    return parts.join(" ");
  }

  /** the one place the engine is called */
  apply(a: Action): { error?: { code: string; message: string }; pending?: PendingView; events: GameEvent[] } {
    if (++this.calls > MAX_ACTIONS || Date.now() - this.started > MAX_MS) throw new Stop({ where: this.where(), check: "watchdog", expected: "the scenario finishes", actual: `watchdog: more than ${MAX_ACTIONS} engine calls or ${MAX_MS} ms (a loop in the script or in the engine)` });
    const res = resolve(this.state, a, this.env.ctx);
    if (res.error) return { error: res.error, events: [] };
    this.state = res.state;
    for (const ev of res.events) {
      const line = this.describe(ev);
      this.events.push({ step: this.step, line, ev });
      if (ev.type === "unresolved") this.unresolved.push(line);
    }
    return { pending: res.pending, events: res.events };
  }
  where(): string { return this.step < 0 ? "setup" : `step ${this.step + 1}`; }

  // ------------------------------------------------------------ references
  /** all objects a reference names, in search order */
  find(ref: string, o: { zones?: readonly (Zone | "stack")[]; player?: PlayerId } = {}): ObjId[] {
    let player: string | undefined = o.player; let zone: string | undefined; let name = ref; let nth = 0;
    for (;;) {
      let m = /^(p[1-4]):(.*)$/.exec(name);
      if (m) { player = m[1]; name = m[2]; continue; }
      m = /^(hand|battlefield|graveyard|exile|library|command|stack):(.*)$/.exec(name);
      if (m) { zone = m[1]; name = m[2]; continue; }
      break;
    }
    const nm = /^(.*)#(\d+)$/.exec(name);
    if (nm) { name = nm[1]; nth = Number(nm[2]); }
    const want = lc(name);
    const matches = (id: ObjId) => { const ob = this.state.objects[id]; if (!ob) return false; return lc(this.nameOf(id)) === want || (!ob.token && this.names(ob.cardName).includes(want)); };
    const out: ObjId[] = [];
    const al = this.aliases.get(name);
    if (al && this.state.objects[al] && (!zone || this.state.objects[al].zone === zone)) out.push(al);
    const zs = zone ? [zone as Zone | "stack"] : o.zones ?? (["battlefield", "stack", "hand", "graveyard", "exile", "command", "library"] as const);
    for (const z of zs) {
      let list: ObjId[];
      if (z === "battlefield") list = this.state.battlefield.filter((id) => !player || this.state.objects[id].controller === player);
      else if (z === "stack") list = this.state.stack.filter((i) => i.objectId && i.kind === "spell" && (!player || i.controller === player)).map((i) => i.objectId!);
      else list = this.state.players.filter((p) => !player || p.id === player).flatMap((p) => p[z] as ObjId[]);
      for (const id of list) if (matches(id) && !out.includes(id)) out.push(id);
    }
    return nth ? (out[nth - 1] ? [out[nth - 1]] : []) : out;
  }
  findOne(ref: string, o: Parameters<Game["find"]>[1] = {}, ctx = "reference"): ObjId {
    const r = this.find(ref, o);
    if (!r.length) throw new SpecError(`${this.where()}: no object matches ${ctx} "${ref}" (searched ${(o.zones ?? ["battlefield", "stack", "hand", "graveyard", "exile", "command", "library"]).join(", ")}${o.player ? ` of ${o.player}` : ""})`);
    return r[0];
  }

  // ------------------------------------------------------------ placing cards
  entryName(e: EntrySpec): string | undefined { return typeof e === "string" ? e : e.card; }
  place(owner: PlayerId, zone: Zone, entry: EntrySpec, top = false): ObjId[] {
    const e = typeof entry === "string" ? { card: entry } : entry;
    const out: ObjId[] = [];
    const r = this.run();
    const p = this.state.players.find((x) => x.id === owner);
    if (!p) throw new SpecError(`${this.where()}: no player ${owner} in a ${this.state.players.length}-player game`);
    if (e.as && (e.count ?? 1) > 1) throw new SpecError(`"as" cannot be combined with count > 1 (${e.as})`);
    for (let i = 0; i < (e.count ?? 1); i++) {
      let o;
      if (e.token) {
        if (zone !== "battlefield") throw new SpecError(`tokens can only be placed on the battlefield (${e.token.name})`);
        const t: TokenDef = { name: e.token.name, types: e.token.types.map(lc), subtypes: e.token.subtypes, colors: e.token.colors, ...(e.token.power !== undefined ? { power: e.token.power } : {}), ...(e.token.toughness !== undefined ? { toughness: e.token.toughness } : {}), keywords: e.token.keywords.map(lc) };
        o = newObject(r, t.name, owner, zone, { token: t });
      } else {
        const raw = e.card!;
        const full = this.env.canonical(raw);
        if (!full) throw new SpecError(`${this.where()}: unknown card "${raw}" (not in data/cards.db, not a catalog stand-in)`);
        this.usedCards.add(full);
        o = newObject(r, full, owner, zone);
      }
      if (zone === "battlefield") {
        this.state.battlefield.push(o.id);
        o.controller = e.controller ?? owner;
        o.controlledSince = e.fresh ? ++this.state.clock : 0;
        o.tapped = !!e.tapped;
        if (e.counters) o.counters = { ...e.counters };
        if (e.faceDown) o.faceDown = true;
        if (e.chosen) o.chosen = { ...e.chosen };
        if (e.unlocked) o.unlocked = [...e.unlocked];
        if (e.damage) o.damage = e.damage;
      } else {
        if (e.tapped || e.fresh || e.controller || e.unlocked) throw new SpecError(`${this.where()}: tapped/fresh/controller/unlocked only apply on the battlefield (${zone})`);
        if (e.counters) throw new SpecError(`${this.where()}: counters only apply on the battlefield`);
        if (zone === "library" && top) p.library.unshift(o.id); else (p[zone] as ObjId[]).push(o.id);
        if (e.faceDown) o.faceDown = true;
      }
      if (zone === "command") o.isCommander = true;
      if (e.as) this.aliases.set(e.as, o.id);
      if (e.attachedTo) {
        const t = /^p[1-4]$/.test(e.attachedTo) ? e.attachedTo : this.findOne(e.attachedTo, { zones: ["battlefield"] }, "attachedTo");
        if (/^p[1-4]$/.test(t)) o.attachedPlayer = t; else { o.attachedTo = t; o.attachedToTs = this.state.objects[t].timestamp; }
      }
      out.push(o.id);
    }
    return out;
  }
}

// ---------------------------------------------------------------- building the position
const START_PHASES = ["upkeep", "draw", "precombat_main", "beginning_of_combat", "postcombat_main", "end_step"];
function build(g: Game, sc: ScenarioSpec): void {
  if (!START_PHASES.includes(sc.phase)) throw new SpecError(`phase "${sc.phase}" cannot be a starting phase; start earlier (one of ${START_PHASES.join(", ")}) and use an "advance" step`);
  const players = ids4.slice(0, sc.players);
  for (const k of Object.keys(sc.setup)) if (!players.includes(k)) throw new SpecError(`setup for ${k} but the scenario has ${sc.players} players`);
  if (!players.includes(sc.active)) throw new SpecError(`active player ${sc.active} is not in the game`);
  g.state = newGame({
    players: players.map((id) => ({ id, deck: [] })), cards: g.env.ctx.cards, seed: sc.seed ?? 7, startingLife: sc.startingLife ?? 40, openingHand: 0, startPhase: "precombat_main", shuffle: false,
    config: { onUnsupported: "continue", ...(sc.manualPay ? { manualPay: sc.manualPay } : {}) }
  });
  g.state.turn = { number: sc.turnNumber ?? 1, active: sc.active, phase: sc.phase };
  g.state.priority = sc.active;
  g.state.players.find((p) => p.id === sc.active)!.lastTurnStartTs = ++g.state.clock;
  // first every object (so `as` aliases and attachedTo can point anywhere), attachments last
  const order: Zone[] = ["library", "hand", "graveyard", "exile", "command", "battlefield"];
  for (const pid of players) {
    const su = sc.setup[pid] ?? {};
    const ps = g.state.players.find((p) => p.id === pid)!;
    if (su.life !== undefined) ps.life = su.life;
    if (su.pool) for (const [c, n] of Object.entries(su.pool)) ps.manaPool[c as "W"] = n!;
    if (su.counters) ps.counters = { ...su.counters };
    if (su.landsPlayed) ps.landsPlayed = su.landsPlayed;
    const lib = su.library ?? Array.from({ length: 30 }, () => "Island");
    const zones: Record<Zone, EntrySpec[]> = { library: lib, hand: su.hand ?? [], graveyard: su.graveyard ?? [], exile: su.exile ?? [], command: [...(su.command ?? []), ...(su.commander ? [{ card: su.commander }] : [])], battlefield: su.battlefield ?? [] };
    for (const z of order) for (const e of zones[z]) {
      // an entry with attachedTo needs its host to exist: placed in a second pass below
      if (typeof e !== "string" && e.attachedTo) continue;
      g.place(pid, z, e);
    }
  }
  for (const pid of players) {
    const su = sc.setup[pid] ?? {};
    for (const e of su.battlefield ?? []) if (typeof e !== "string" && e.attachedTo) g.place(pid, "battlefield", e);
  }
  g.step = 0 - 1;
}

// ---------------------------------------------------------------- answering decisions
interface Q { a: AnswerSpec; targets?: boolean }
const isRequired = (q: Q): boolean => !!q.targets || !!q.a.required;
/** why this scripted answer does not fit the pending decision (undefined = it fits) */
function mismatch(q: Q, p: PendingView): string | undefined {
  const a = q.a;
  if (q.targets && p.kind !== "choose_targets" && p.kind !== "cast_target_player") return "a targeting decision for the scripted targets";
  if (a.kind && p.kind !== a.kind) return `a ${a.kind} decision`;
  if (a.player && p.player !== a.player) return `a decision for ${a.player}`;
  if (a.promptContains && !lc(`${p.prompt?.title ?? ""} ${p.prompt?.instruction ?? ""}`).includes(lc(a.promptContains))) return `a decision whose prompt contains "${a.promptContains}"`;
  return undefined;
}
function matchOptions(g: Game, p: PendingView, picks: NonNullable<AnswerSpec["pick"]>): string[] {
  const used = new Set<string>(); const out: string[] = [];
  for (const pick of picks) {
    let hit: string | undefined;
    if (typeof pick !== "string") { hit = p.options[pick.index]?.id; if (!hit) throw new Stop({ where: g.where(), check: "answer", expected: `option index ${pick.index}`, actual: `the decision has ${p.options.length} options: ${optsStr(p)}` }); }
    else {
      const free = (id: string) => !used.has(id);
      hit = p.options.find((o) => o.id === pick && free(o.id))?.id;
      if (!hit && !/^#\d+$/.test(pick)) {
        const nm = /^(.*)#(\d+)$/.exec(pick);
        const label = nm && !/^(p[1-4]|hand|battlefield|graveyard|exile|library|command|stack):/.test(pick) ? nm[1] : undefined;
        const lab = (o: { label: string }) => lc(o.label) === lc(label ?? pick);
        if (label) { hit = p.options.filter(lab)[Number(nm![2]) - 1]?.id; }
        if (!hit) { // a reference (possibly "p2:Vanilla 2/2"): any object it names that is an option
          for (const id of g.find(pick, { zones: ["battlefield", "stack", "hand", "graveyard", "exile", "command", "library"] })) if (p.options.some((o) => o.id === id) && free(id)) { hit = id; break; }
        }
        if (!hit) hit = p.options.find((o) => lab(o) && free(o.id))?.id;
        if (!hit) hit = p.options.find((o) => lc(o.label).includes(lc(label ?? pick)) && free(o.id))?.id;
        if (!hit && /^p[1-4]$/.test(pick)) hit = p.options.find((o) => o.id === pick)?.id;
        if (!hit && COLOR_WORD[lc(pick)]) hit = p.options.find((o) => o.id.toUpperCase() === COLOR_WORD[lc(pick)] && free(o.id))?.id;
      }
      if (!hit) throw new Stop({ where: g.where(), check: "answer", expected: `an option named "${pick}"`, actual: `not offered. Options: ${optsStr(p)}` });
    }
    used.add(hit); out.push(hit);
  }
  return out;
}
const optsStr = (p: PendingView) => (p.options.length ? p.options.map((o) => `${o.label}`).join(" | ") : "(none)");
const pendStr = (p: PendingView) => `${p.kind} for ${p.player}: "${p.prompt?.title ?? ""}" — ${p.prompt?.instruction ?? ""} [options: ${optsStr(p)}; min ${p.min} max ${p.max}]`;

function answerOne(g: Game, q: Q): void {
  const p = g.state.pending;
  if (!p) throw new Stop({ where: g.where(), check: "decision", expected: `a pending decision (${q.a.kind ?? "any"})`, actual: "no decision is pending" });
  const view: PendingView = { id: p.id, kind: p.kind, player: p.player, prompt: p.prompt, options: p.options, min: p.min, max: p.max, numeric: p.numeric, cancellable: p.cancellable };
  const a = q.a;
  const bad = (why: string): never => { throw new Stop({ where: g.where(), check: "decision", expected: why, actual: pendStr(view) }); };
  const mm = mismatch(q, p as PendingView);
  if (mm) bad(mm);
  const choice: Choice = {};
  if (a.cancel) choice.cancel = true;
  else if (a.yes !== undefined) choice.yes = a.yes;
  else if (a.number !== undefined) choice.number = a.number;
  else if (a.assign) choice.assign = Object.fromEntries(Object.entries(a.assign).map(([k, v]) => [p.options.find((o) => lc(o.label) === lc(k) || o.id === k)?.id ?? k, v]));
  else if (a.place) {
    const m = (xs?: string[]) => (xs ? matchOptions(g, view, xs) : undefined);
    choice.place = { ...(a.place.top ? { top: m(a.place.top) } : {}), ...(a.place.toBottom ? { toBottom: m(a.place.toBottom) } : {}), ...(a.place.toGraveyard ? { toGraveyard: m(a.place.toGraveyard) } : {}) };
  } else if (a.payWith) { choice.ids = ["pay"]; choice.payWith = a.payWith.map((r) => g.findOne(r, { zones: ["battlefield"] }, "payWith")); }
  else if (a.none) choice.ids = [];
  else if (a.pick) choice.ids = matchOptions(g, view, a.pick);
  else bad("an answer with pick / yes / number / none / cancel");
  const label = JSON.stringify(a).slice(0, 120);
  const res = g.apply({ type: "answerDecision", player: p.player, decisionId: p.id, choice });
  g.actionLog.push(`  answer ${p.kind} ${label}${res.error ? ` -> REJECTED ${res.error.code}: ${res.error.message}` : ""}`);
  if (res.error && g.expectReject) throw new Rejected(res.error);
  if (res.error) throw new Stop({ where: g.where(), check: "answer", expected: `the engine accepts ${label}`, actual: `rejected ${res.error.code}: ${res.error.message}. Decision: ${pendStr(view)}` });
}
/** answers the pending decisions with the first scripted answer that fits each one (an answer that fits nothing asked is not an error by itself, unless it is `required`: a forced choice may legitimately not be asked, the expectations decide). Returns false when a decision stays open that no remaining answer fits. */
function drive(g: Game, queue: Q[]): boolean {
  while (g.state.pending && queue.length) {
    const p = g.state.pending as never as PendingView;
    const i = queue.findIndex((q) => !mismatch(q, p));
    if (i < 0) {
      const req = queue.find(isRequired);
      if (req) throw new Stop({ where: g.where(), check: "decision", expected: mismatch(req, p) ?? "a decision", actual: pendStr(p) });
      return false;
    }
    // a required answer before the fitting one was skipped: it must still be asked later, so keep it
    answerOne(g, queue.splice(i, 1)[0]);
  }
  return true;
}
function leftover(g: Game, queue: Q[]): void {
  queue = queue.filter(isRequired);
  if (!queue.length) return;
  throw new Stop({ where: g.where(), check: "decision", expected: `the engine asks for ${queue.length} more scripted answer(s): ${queue.map((q) => (q.targets ? `targets ${JSON.stringify(q.a.pick)}` : JSON.stringify(q.a))).join(", ")}`, actual: g.state.pending ? pendStr(g.state.pending as never) : "no further decision was asked" });
}

// ---------------------------------------------------------------- actions
function targetQ(t: ActionSpec & { targets?: Array<string | string[]> }): Q[] { return (t.targets ?? []).map((x) => ({ a: { pick: Array.isArray(x) ? x : [x] }, targets: true })); }
function autoPay(pay: unknown): { autoPay?: true; payWith?: undefined } { return pay === "auto" ? { autoPay: true } : {}; }
function payWith(g: Game, pay: unknown): { payWith?: ObjId[] } {
  if (pay && typeof pay === "object" && "tap" in pay) return { payWith: (pay as { tap: string[] }).tap.map((r) => g.findOne(r, { zones: ["battlefield"] }, "pay.tap")) };
  return {};
}
function reject(g: Game, s: ActionSpec, res: { error?: { code: string; message: string } }, what: string): boolean {
  if (res.error && s.expectRejected) {
    if (res.error.code !== s.expectRejected) throw new Stop({ where: g.where(), check: "rejected", expected: `${what} refused with ${s.expectRejected}`, actual: `refused with ${res.error.code}: ${res.error.message}` });
    g.wasRejected = true;
    g.actionLog.push(`  -> rejected as expected (${res.error.code})`);
    return true;
  }
  if (res.error) {
    if (res.error.code === "unsupported") { g.unresolved.push(`${what}: unsupported: ${res.error.message}`); throw new Stop({ where: g.where(), check: "unsupported", expected: `${what} runs`, actual: `engine: unsupported: ${res.error.message}` }); }
    throw new Stop({ where: g.where(), check: "action", expected: `${what} is accepted`, actual: `engine refused: ${res.error.code}: ${res.error.message}` });
  }
  return false;
}

/** one scripted step; an expected rejection may come at any point of a cast / activation (the engine reports "cannot pay" only after the last decision): the attempt is then abandoned (cancelled) like a player backing out */
function execStep(g: Game, s: ActionSpec): void {
  g.expectReject = s.expectRejected; g.wasRejected = false;
  try { execStep0(g, s); }
  catch (e) {
    if (!(e instanceof Rejected)) throw e;
    if (e.error.code !== s.expectRejected) throw new Stop({ where: g.where(), check: "rejected", expected: `the action is refused with ${s.expectRejected}`, actual: `refused with ${e.error.code}: ${e.error.message}` });
    g.wasRejected = true;
    g.actionLog.push(`  -> rejected as expected (${e.error.code}); the attempt is abandoned`);
    const p = g.state.pending;
    if (p?.cancellable) g.apply({ type: "answerDecision", player: p.player, decisionId: p.id, choice: { cancel: true } });
  } finally { g.expectReject = undefined; }
  if (s.expectRejected && !g.wasRejected) throw new Stop({ where: g.where(), check: "rejected", expected: `the action is refused with ${s.expectRejected}`, actual: "the engine accepted it" });
}
function execStep0(g: Game, s: ActionSpec): void {
  const queue: Q[] = [...((s as { answers?: AnswerSpec[] }).answers ?? []).map((a) => ({ a }))];
  const log = (t: string) => g.actionLog.push(`${g.where()}: ${t}`);
  switch (s.do) {
    case "cast": {
      const cardId = g.findOne(s.card, { zones: ["hand", "command", "graveyard", "exile", "library", "battlefield"], player: s.player }, "card to cast");
      const act: Extract<Action, { type: "castSpell" }> = { type: "castSpell", player: s.player, cardId, ...(s.x !== undefined ? { x: s.x } : {}), ...(s.face ? { face: s.face } : {}), ...(s.extras ? { extras: s.extras } : {}), ...autoPay(s.pay), ...payWith(g, s.pay) };
      if (s.way) {
        const las = legalActions(g.state, s.player, g.env.ctx).filter((l) => l.kind === "castSpell" && l.objectId === cardId && (!s.face || l.face === s.face));
        const w = lc(s.way);
        const la = las.find((l) => (w === "free" ? l.free : w === "normal" ? !l.free && (!l.option || l.option === "normal") : lc(l.label).includes(w) || lc(l.option ?? "") === w));
        if (!la) throw new Stop({ where: g.where(), check: "action", expected: `a "${s.way}" way to cast ${s.card}`, actual: `ways offered: ${las.length ? las.map((l) => `${l.label}${l.free ? " [free]" : ""}`).join(" | ") : "none (the engine offers no way to cast it)"}` });
        if (la.option) act.option = la.option;
      }
      if (s.modes) queue.unshift({ a: { kind: "choose_modes", pick: s.modes } });
      queue.splice(s.modes ? 1 : 0, 0, ...targetQ(s));
      log(`cast ${s.card} (${s.player})`);
      const res = g.apply(act);
      if (reject(g, s, res, `casting ${s.card}`)) return;
      drive(g, queue); leftover(g, queue);
      return;
    }
    case "activate": {
      const src = g.findOne(s.source, { zones: ["battlefield", "graveyard", "hand", "exile", "command", "library"], player: undefined }, "ability source");
      const abil = g.view(src).abilities.filter((a) => a.kind === "activated" || a.kind === "mana");
      const ab = typeof s.ability === "number" ? abil[s.ability - 1] : abil.find((a) => lc(a.text).includes(lc(s.ability as string)));
      if (!ab) throw new Stop({ where: g.where(), check: "action", expected: `${s.source} has activated ability ${JSON.stringify(s.ability)}`, actual: `activated abilities: ${abil.length ? abil.map((a, i) => `${i + 1}. ${a.text.replace(/\s+/g, " ").slice(0, 100)}`).join(" || ") : "none"}` });
      const act: Action = { type: "activateAbility", player: s.player, sourceId: src, abilityId: ab.id, ...(s.x !== undefined ? { x: s.x } : {}), ...(s.color ? { color: s.color } : {}), ...autoPay(s.pay), ...payWith(g, s.pay) };
      queue.unshift(...targetQ(s));
      log(`activate ${s.source}: ${ab.text.slice(0, 60)} (${s.player})`);
      const res = g.apply(act);
      if (reject(g, s, res, `activating ${s.source}`)) return;
      drive(g, queue); leftover(g, queue);
      return;
    }
    case "tapForMana": {
      const src = g.findOne(s.permanent, { zones: ["battlefield"] }, "permanent to tap");
      const abs = g.view(src).abilities.filter((a) => a.kind === "mana");
      if (!abs.length) throw new Stop({ where: g.where(), check: "action", expected: `${s.permanent} has a mana ability`, actual: `abilities: ${g.view(src).abilities.map((a) => `${a.kind}: ${a.text.slice(0, 60)}`).join(" || ") || "none"}` });
      const mk = (id: string): Action => ({ type: "activateAbility", player: s.player, sourceId: src, abilityId: id, ...(s.color ? { color: s.color } : {}) });
      // several mana abilities (a dual land drafted as one ability per colour): use the first that really makes the asked colour
      let ab = abs[0];
      if (s.color && abs.length > 1) {
        const before = g.state.players.find((p) => p.id === s.player)!.manaPool[s.color];
        const hit = abs.find((a) => { const r = resolve(g.state, mk(a.id), g.env.ctx); return !r.error && (r.state.players.find((p) => p.id === s.player)!.manaPool[s.color!] ?? 0) > before; });
        if (hit) ab = hit;
      }
      log(`tap ${s.permanent} for mana${s.color ? ` {${s.color}}` : ""} (${s.player}) via "${ab.text.slice(0, 50)}"`);
      const res = g.apply(mk(ab.id));
      if (reject(g, s, res, `tapping ${s.permanent}`)) return;
      drive(g, queue); leftover(g, queue);
      return;
    }
    case "playLand": {
      const cardId = g.findOne(s.card, { zones: ["hand", "graveyard", "exile", "library", "command"], player: s.player }, "land to play");
      log(`play land ${s.card} (${s.player})`);
      const res = g.apply({ type: "playLand", player: s.player, cardId, ...(s.face ? { face: s.face } : {}) });
      if (reject(g, s, res, `playing ${s.card}`)) return;
      drive(g, queue); leftover(g, queue);
      return;
    }
    case "unlockDoor": {
      const id = g.findOne(s.card, { zones: ["battlefield"], player: s.player }, "Room");
      log(`unlock door ${s.door} of ${s.card} (${s.player})`);
      const res = g.apply({ type: "unlockDoor", player: s.player, objectId: id, face: s.door, ...autoPay(s.pay), ...payWith(g, s.pay) });
      if (reject(g, s, res, `unlocking ${s.door}`)) return;
      drive(g, queue); leftover(g, queue);
      return;
    }
    case "pass": {
      for (let i = 0; i < (s.times ?? 1); i++) {
        const who = s.player ?? g.state.priority;
        if (!who) throw new Stop({ where: g.where(), check: "action", expected: "somebody has priority to pass", actual: g.state.pending ? `a decision is pending: ${pendStr(g.state.pending as never)}` : "nobody holds priority" });
        log(`pass priority (${who})`);
        const res = g.apply({ type: "passPriority", player: who });
        if (reject(g, s, res, "passing priority")) return;
        drive(g, queue);
        if (g.state.pending && !queue.length) break;
      }
      leftover(g, queue);
      return;
    }
    case "resolve": {
      log("resolve the stack (everyone passes)");
      for (let i = 0; i < 400 && (g.state.stack.length > 0 || g.state.pending) && !g.state.gameOver; i++) {
        if (g.state.pending) { if (!queue.length || !drive(g, queue)) break; continue; }
        const who = g.state.priority;
        if (!who) break;
        const res = g.apply({ type: "passPriority", player: who });
        if (reject(g, s, res, "passing priority")) return;
      }
      leftover(g, queue);
      return;
    }
    case "advance": {
      log(`advance to ${s.to}${s.active ? ` of ${s.active}'s turn` : ""}`);
      let moved = false;
      for (let i = 0; i < 300; i++) {
        if (g.state.pending) { if (!queue.length || !drive(g, queue)) break; continue; }
        if (moved && g.state.turn.phase === s.to && (!s.active || g.state.turn.active === s.active) && !g.state.combat?.expect) break; // stop with the beginning-of-step triggers still on the stack
        if (g.state.gameOver) break;
        if (g.state.stack.length) { const res = g.apply({ type: "passPriority", player: g.state.priority! }); if (reject(g, s, res, "passing priority")) return; continue; }
        const res = g.apply({ type: "advancePhase", player: g.state.turn.active });
        moved = true;
        if (reject(g, s, res, "advancing the phase")) return;
      }
      if (!g.state.pending && !(g.state.turn.phase === s.to && (!s.active || g.state.turn.active === s.active))) throw new Stop({ where: g.where(), check: "advance", expected: `the game reaches ${s.to}${s.active ? ` on ${s.active}'s turn` : ""}`, actual: `stopped at ${g.state.turn.phase} of ${g.state.turn.active}'s turn ${g.state.turn.number}${g.state.gameOver ? " (game over)" : ""}` });
      leftover(g, queue);
      return;
    }
    case "answer": {
      log(`answer ${queue.length} decision(s)`);
      drive(g, queue); leftover(g, queue);
      return;
    }
    case "declareAttackers": {
      const opp = g.state.players.filter((p) => p.id !== s.player && !p.hasLost);
      const attackers = s.attackers.map((a) => {
        const id = g.findOne(a.creature, { zones: ["battlefield"], player: s.player }, "attacker");
        let def = a.defender;
        if (!def) { if (opp.length !== 1) throw new SpecError(`${g.where()}: say which defender "${a.creature}" attacks (several opponents)`); def = opp[0].id; }
        return { id, defender: /^p[1-4]$/.test(def) ? def : g.findOne(def, { zones: ["battlefield"] }, "defender") };
      });
      log(`declare attackers ${s.attackers.map((a) => a.creature).join(", ") || "(none)"} (${s.player})`);
      const res = g.apply({ type: "declareAttackers", player: s.player, attackers });
      if (reject(g, s, res, "declaring attackers")) return;
      drive(g, queue); leftover(g, queue);
      return;
    }
    case "declareBlockers": {
      const blocks = s.blocks.map((b) => ({ blocker: g.findOne(b.blocker, { zones: ["battlefield"], player: s.player }, "blocker"), attacker: g.findOne(b.attacker, { zones: ["battlefield"] }, "attacker") }));
      log(`declare blockers ${s.blocks.map((b) => `${b.blocker}->${b.attacker}`).join(", ") || "(none)"} (${s.player})`);
      const res = g.apply({ type: "declareBlockers", player: s.player, blocks });
      if (reject(g, s, res, "declaring blockers")) return;
      drive(g, queue); leftover(g, queue);
      return;
    }
    case "put": {
      log(`put ${typeof s.card === "string" ? s.card : s.card.card ?? s.card.token?.name} into ${s.player}'s ${s.zone}`);
      g.state = structuredClone(g.state);
      g.place(s.player, s.zone, s.card, s.zone === "library");
      return;
    }
  }
}

// ---------------------------------------------------------------- expectations
function evalExpect(g: Game, e: ExpectationSpec): Omit<Failure, "where"> | undefined {
  const fail = (expected: string, actual: string): Omit<Failure, "where"> => ({ check: e.check, why: e.why, expected, actual });
  const st = g.state;
  const player = (id: string) => { const p = st.players.find((x) => x.id === id); if (!p) throw new SpecError(`expectation refers to ${id}, not in the game`); return p; };
  switch (e.check) {
    case "life": { const p = player(e.player); return numOk(p.life, e.value) ? undefined : fail(`${e.player} life ${numStr(e.value)}`, `${p.life}`); }
    case "zone": {
      const p = player(e.player);
      const ids = e.zone === "battlefield" ? st.battlefield.filter((id) => st.objects[id].controller === e.player) : (p[e.zone] as ObjId[]);
      const names = ids.map((id) => g.nameOf(id));
      const parts: string[] = [];
      if (e.count !== undefined && !numOk(names.length, e.count)) parts.push(`${names.length} cards, expected ${numStr(e.count)}`);
      if (e.cards) {
        if (e.ordered && e.cards.exactly) { if (lc(names.join("|")) !== lc(e.cards.exactly.join("|"))) parts.push(`order differs`); }
        else parts.push(...listProblems(names, e.cards));
      }
      if (e.cards?.exactly === undefined && e.ordered) parts.push("(`ordered` needs cards.exactly)");
      return parts.length ? fail(`${e.player} ${e.zone}${e.cards ? ` ${listStr(e.cards)}` : ""}${e.count !== undefined ? ` count ${numStr(e.count)}` : ""}${e.ordered ? " (in this order, top first)" : ""}`, `[${names.join(", ")}]${parts.length ? `: ${parts.join("; ")}` : ""}`) : undefined;
    }
    case "permanent": {
      const ids = g.find(e.ref, { zones: ["battlefield", "stack", "hand", "graveyard", "exile", "command", "library"] });
      if (e.exists === false) return ids.length ? fail(`${e.ref} does not exist`, `exists in ${ids.map((i) => st.objects[i].zone).join(", ")}`) : undefined;
      if (!ids.length) return fail(`${e.ref} exists`, "no object with that name");
      const v = g.view(ids[0]); const o = st.objects[ids[0]];
      const bad: string[] = []; const want: string[] = [];
      const num = (k: string, got: number | undefined, s: NumSpec | undefined) => { if (s === undefined) return; want.push(`${k} ${numStr(s)}`); if (got === undefined || !numOk(got, s)) bad.push(`${k} is ${got ?? "none"}`); };
      const list = (k: string, got: string[], s: ListSpec | undefined, norm?: (x: string) => string, sub = false) => { if (!s) return; want.push(`${k} ${listStr(s)}`); const pr = listProblems(got, s, norm, sub); if (pr.length) bad.push(`${k} = [${got.join(", ")}] (${pr.join("; ")})`); };
      const flag = (k: string, got: boolean, s: boolean | undefined) => { if (s === undefined) return; want.push(`${k}=${s}`); if (got !== s) bad.push(`${k} is ${got}`); };
      if (e.zone) { want.push(`zone ${e.zone}`); if (o.zone !== e.zone) bad.push(`zone is ${o.zone}`); }
      if (e.controller) { want.push(`controller ${e.controller}`); if (o.controller !== e.controller) bad.push(`controller is ${o.controller}`); }
      if (e.owner) { want.push(`owner ${e.owner}`); if (o.owner !== e.owner) bad.push(`owner is ${o.owner}`); }
      if (e.name) { want.push(`name ${e.name}`); if (lc(v.name) !== lc(e.name)) bad.push(`name is "${v.name}"`); }
      num("power", v.power, e.power); num("toughness", v.toughness, e.toughness); num("manaValue", v.manaValue, e.manaValue); num("damage", v.damage, e.damage);
      list("types", v.types, e.types); list("subtypes", v.subtypes, e.subtypes); list("supertypes", v.supertypes, e.supertypes); list("keywords", v.keywords, e.keywords, (x) => lc(x).replace(/_/g, " "));
      list("colors", v.colors, e.colors, (x) => normColor(x));
      list("abilityText", v.abilities.map((a) => a.text), e.abilityText, lc, true);
      flag("abilitiesStripped", v.abilitiesStripped, e.abilitiesStripped); flag("tapped", v.tapped, e.tapped); flag("summoningSick", v.summoningSick, e.summoningSick);
      flag("faceDown", v.faceDown, e.faceDown); flag("token", v.token, e.token); flag("attacking", v.attacking, e.attacking); flag("blocking", v.blocking, e.blocking);
      if (e.attachedTo !== undefined) {
        want.push(`attachedTo ${e.attachedTo ?? "nothing"}`);
        const host = v.attachedTo ? g.nameOf(v.attachedTo) : null;
        if (e.attachedTo === null ? host !== null : !host || !(g.find(e.attachedTo, { zones: ["battlefield"] }).includes(v.attachedTo!))) bad.push(`attachedTo is ${host ?? "nothing"}`);
      }
      list("attachments", v.attachments.map((i) => g.nameOf(i)), e.attachments);
      if (e.counters) for (const [k, s] of Object.entries(e.counters)) num(`counters.${k}`, v.counters[k] ?? 0, s);
      list("unlocked", o.unlocked ?? [], e.unlocked);
      if (e.chosenColor) { want.push(`chosenColor ${e.chosenColor}`); if (o.chosen?.color !== e.chosenColor) bad.push(`chosenColor is ${o.chosen?.color ?? "none"}`); }
      return bad.length ? fail(`${e.ref}: ${want.join(", ")}`, `${bad.join("; ")}  [${v.name}: ${v.power ?? "-"}/${v.toughness ?? "-"} ${v.types.join(" ")}${v.subtypes.length ? " - " + v.subtypes.join(" ") : ""}; ${v.keywords.join(", ") || "no keywords"}; counters ${JSON.stringify(v.counters)}; zone ${o.zone}]`) : undefined;
    }
    case "tokens": {
      const ids = st.battlefield.filter((id) => st.objects[id].controller === e.player && st.objects[id].token && (!e.name || lc(st.objects[id].token!.name) === lc(e.name)));
      const bad: string[] = [];
      if (e.count !== undefined && !numOk(ids.length, e.count)) bad.push(`${ids.length} tokens`);
      const lines: string[] = [];
      for (const id of ids) {
        const v = g.view(id);
        const own: string[] = [];
        if (e.power !== undefined && !(v.power !== undefined && numOk(v.power, e.power))) own.push(`power ${v.power}`);
        if (e.toughness !== undefined && !(v.toughness !== undefined && numOk(v.toughness, e.toughness))) own.push(`toughness ${v.toughness}`);
        for (const [k, s, got, norm] of [["types", e.types, v.types, lc], ["subtypes", e.subtypes, v.subtypes, lc], ["colors", e.colors, v.colors, normColor], ["keywords", e.keywords, v.keywords, lc]] as const) if (s) { const pr = listProblems(got, s, norm); if (pr.length) own.push(`${k} [${got.join(", ")}] ${pr.join("; ")}`); }
        if (e.tapped !== undefined && v.tapped !== e.tapped) own.push(`tapped ${v.tapped}`);
        if (own.length) bad.push(`${v.name}: ${own.join(", ")}`);
        lines.push(`${v.name} ${v.power}/${v.toughness}`);
      }
      return bad.length ? fail(`${e.player} tokens${e.name ? ` named ${e.name}` : ""}: ${[e.count !== undefined ? `count ${numStr(e.count)}` : "", e.power !== undefined ? `power ${numStr(e.power)}` : "", e.toughness !== undefined ? `toughness ${numStr(e.toughness)}` : ""].filter(Boolean).join(", ")}`, `${bad.join("; ")} (tokens: ${lines.join(", ") || "none"})`) : undefined;
    }
    case "stack": {
      const items = st.stack.map((i) => ({ name: g.nameOf(i.sourceId), card: st.objects[i.sourceId]?.cardName, kind: i.kind === "spell" ? "spell" : i.kind }));
      const names = items.map((i) => `${i.name} (${i.kind})`);
      const bad: string[] = [];
      if (e.count !== undefined && !numOk(items.length, e.count)) bad.push(`${items.length} items`);
      const matchItem = (want: string, it: { name: string; card?: string; kind: string }) => { const m = /^(.*) \((spell|triggered|activated)\)$/.exec(want); const nm = (w: string) => lc(it.name) === lc(w) || (it.card ? g.names(it.card).includes(lc(w)) : false); return m ? nm(m[1]) && m[2] === it.kind : nm(want); };
      const lstP = (s: ListSpec) => {
        if (s.exactly) { const pool = [...items]; for (const w of s.exactly) { const i = pool.findIndex((it) => matchItem(w, it)); if (i < 0) bad.push(`missing "${w}"`); else pool.splice(i, 1); } for (const it of pool) bad.push(`unexpected "${it.name} (${it.kind})"`); }
        if (s.atLeast) { const pool = [...items]; for (const w of s.atLeast) { const i = pool.findIndex((it) => matchItem(w, it)); if (i < 0) bad.push(`missing "${w}"`); else pool.splice(i, 1); } }
        if (s.noneOf) for (const w of s.noneOf) if (items.some((it) => matchItem(w, it))) bad.push(`must not contain "${w}"`);
      };
      if (e.items) lstP(e.items);
      if (e.topFirst) { const top = [...items].reverse(); if (top.length !== e.topFirst.length || !top.every((it, i) => matchItem(e.topFirst![i], it))) bad.push(`order differs`); }
      return bad.length ? fail(`stack ${e.items ? listStr(e.items) : ""}${e.topFirst ? `top first [${e.topFirst.join(", ")}]` : ""}${e.count !== undefined ? ` count ${numStr(e.count)}` : ""}`, `top first: [${[...names].reverse().join(", ")}] (${bad.join("; ")})`) : undefined;
    }
    case "pending": {
      const p = st.pending;
      if (!e.present) return p ? fail("no decision pending", pendStr(p as never)) : undefined;
      if (!p) return fail(`a pending decision${e.kind ? ` (${e.kind})` : ""}`, "no decision is pending");
      const bad: string[] = [];
      if (e.kind && p.kind !== e.kind) bad.push(`kind is ${p.kind}`);
      if (e.player && p.player !== e.player) bad.push(`player is ${p.player}`);
      if (e.promptContains && !lc(`${p.prompt?.title ?? ""} ${p.prompt?.instruction ?? ""}`).includes(lc(e.promptContains))) bad.push(`prompt does not contain "${e.promptContains}"`);
      if (e.options) bad.push(...listProblems(p.options.map((o) => o.label), e.options, (x) => COLOR_WORD[lc(x)] ?? lc(x)));
      if (e.min !== undefined && !numOk(p.min, e.min)) bad.push(`min is ${p.min}`);
      if (e.max !== undefined && !numOk(p.max, e.max)) bad.push(`max is ${p.max}`);
      return bad.length ? fail(`a pending decision ${[e.kind, e.player, e.promptContains ? `prompt~"${e.promptContains}"` : "", e.options ? `options ${listStr(e.options)}` : ""].filter(Boolean).join(" ")}`, `${bad.join("; ")}. Actual: ${pendStr(p as never)}`) : undefined;
    }
    case "pool": {
      const p = player(e.player); const bad: string[] = [];
      const tot = Object.values(p.manaPool).reduce((a, b) => a + b, 0) + (p.manaUnits ?? []).reduce((a, u) => a + ((u as { amount?: number }).amount ?? 1), 0);
      for (const [c, n] of Object.entries(e.equals ?? {})) if ((p.manaPool[c as "W"] ?? 0) !== n) bad.push(`${c}=${p.manaPool[c as "W"]}`);
      if (e.equals) for (const c of ["W", "U", "B", "R", "G", "C"] as const) if (!(c in e.equals) && p.manaPool[c]) bad.push(`${c}=${p.manaPool[c]} (expected 0)`);
      for (const [c, n] of Object.entries(e.atLeast ?? {})) if ((p.manaPool[c as "W"] ?? 0) < n!) bad.push(`${c}=${p.manaPool[c as "W"]} (< ${n})`);
      if (e.total !== undefined && !numOk(tot, e.total)) bad.push(`total ${tot}`);
      return bad.length ? fail(`${e.player} pool ${JSON.stringify(e.equals ?? e.atLeast ?? {})}${e.total !== undefined ? ` total ${numStr(e.total)}` : ""}`, `${JSON.stringify(p.manaPool)}${p.manaUnits?.length ? ` + ${p.manaUnits.length} restricted unit(s)` : ""}: ${bad.join("; ")}`) : undefined;
    }
    case "turn": {
      const bad: string[] = []; const t = st.turn;
      if (e.active && t.active !== e.active) bad.push(`active is ${t.active}`);
      if (e.phase && t.phase !== e.phase) bad.push(`phase is ${t.phase}`);
      if (e.number !== undefined && !numOk(t.number, e.number)) bad.push(`turn number is ${t.number}`);
      return bad.length ? fail(`turn ${JSON.stringify({ active: e.active, phase: e.phase, number: e.number })}`, bad.join("; ")) : undefined;
    }
    case "player": {
      const p = player(e.player); const bad: string[] = [];
      if (e.hasLost !== undefined && p.hasLost !== e.hasLost) bad.push(`hasLost is ${p.hasLost}`);
      if (e.monarch !== undefined && (st.monarch === e.player) !== e.monarch) bad.push(`monarch is ${st.monarch ?? "nobody"}`);
      for (const [k, s] of Object.entries(e.counters ?? {})) if (!numOk(p.counters?.[k] ?? 0, s)) bad.push(`${k} counters ${p.counters?.[k] ?? 0}`);
      return bad.length ? fail(`${e.player} ${JSON.stringify({ hasLost: e.hasLost, monarch: e.monarch, counters: e.counters })}`, bad.join("; ")) : undefined;
    }
    case "game": {
      const bad: string[] = []; const go = st.gameOver;
      if (e.over !== undefined && !!go !== e.over) bad.push(`game over is ${!!go}`);
      if (e.winner && go?.winner !== e.winner) bad.push(`winner is ${go?.winner ?? "nobody"}`);
      return bad.length ? fail(`game ${JSON.stringify({ over: e.over, winner: e.winner })}`, `${bad.join("; ")}${go ? ` (${go.reason})` : ""}`) : undefined;
    }
    case "log": {
      const lines = g.events.filter((x) => (e.since === "lastAction" ? x.step === g.step : true)).map((x) => lc(x.line));
      const bad: string[] = [];
      for (const c of e.contains ?? []) if (!lines.some((l) => l.includes(lc(c)))) bad.push(`no event line contains "${c}"`);
      for (const c of e.absent ?? []) if (lines.some((l) => l.includes(lc(c)))) bad.push(`an event line contains "${c}"`);
      return bad.length ? fail(`log ${e.contains ? `contains [${e.contains.join(" | ")}]` : ""}${e.absent ? ` absent [${e.absent.join(" | ")}]` : ""}`, `${bad.join("; ")}. Recent lines: ${lines.slice(-12).join(" // ")}`) : undefined;
    }
    case "events": {
      const evs = g.events.filter((x) => (e.since === "lastAction" ? x.step === g.step : true) && x.ev.type === e.type);
      const nameIf = (v: unknown) => (typeof v === "string" && /^#\d+$/.test(v) ? g.nameOf(v) : String(v));
      const hits = evs.filter((x) => Object.entries(e.where ?? {}).every(([k, v]) => lc(nameIf(x.ev[k])) === lc(String(v))));
      const want: NumSpec = e.count ?? { atLeast: 1 };
      return numOk(hits.length, want) ? undefined : fail(`${numStr(want)} "${e.type}" event(s)${e.where ? ` matching ${JSON.stringify(e.where)}` : ""}`, `${hits.length} (events of that type: ${evs.map((x) => x.line).slice(0, 6).join(" // ") || "none"})`);
    }
    case "legal": {
      const zones = e.action === "activate" ? (["battlefield", "graveyard", "hand", "exile", "command", "library"] as const) : (["hand", "command", "graveyard", "exile", "library"] as const);
      const ids = g.find(e.card, { zones, player: e.player });
      const las = legalActions(st, e.player, g.env.ctx).filter((l) => ids.includes(l.objectId ?? "") && (e.action === "cast" ? l.kind === "castSpell" : e.action === "playLand" ? l.kind === "playLand" : l.kind === "activateAbility" && !l.isMana));
      let pool = las;
      if (e.action === "activate" && e.ability !== undefined) {
        const id = ids[0]; const abil = id ? g.view(id).abilities.filter((a) => a.kind === "activated") : [];
        const ab = typeof e.ability === "number" ? abil[e.ability - 1] : abil.find((a) => lc(a.text).includes(lc(e.ability as string)));
        pool = las.filter((l) => l.abilityId === ab?.id);
      }
      if (e.free !== undefined) pool = pool.filter((l) => !!l.free === e.free);
      const exists = pool.length > 0;
      return exists === e.exists ? undefined : fail(`${e.player} ${e.exists ? "can" : "cannot"} ${e.action} ${e.card}${e.free !== undefined ? (e.free ? " for free" : " normally") : ""}`, exists ? `legal: ${pool.map((l) => l.label).join(" | ")}` : `not legal (legal ways: ${las.map((l) => l.label + (l.free ? " [free]" : "")).join(" | ") || "none"})`);
    }
    case "noUnresolved": return g.unresolved.length ? fail("no unresolved events", g.unresolved.join(" // ")) : undefined;
  }
}

// ---------------------------------------------------------------- scenario driver
export function runScenario(file: SpecFileSpec, sc: ScenarioSpec, opts: { deck?: string } = {}): ScenarioResult {
  const t0 = Date.now();
  const env = getEnv(opts.deck ?? file.deck);
  const g = new Game(env);
  const failures: Failure[] = [];
  let specError: string | undefined;
  const unsupported: string[] = [];
  const check = (list: ExpectationSpec[] | undefined, where: string) => {
    for (const e of list ?? []) {
      try { const f = evalExpect(g, e); if (f) failures.push({ where, ...f }); }
      catch (err) { if (err instanceof SpecError) throw err; failures.push({ where, check: e.check, why: e.why, expected: "expectation evaluates", actual: `evaluator error: ${(err as Error).message}` }); }
    }
  };
  try {
    build(g, sc);
    const subject = [file.card, ...(file.cards ?? [])].map((n) => env.canonical(n) ?? n);
    const missing = subject.filter((n) => !env.hasDraft(n));
    if (missing.length) { unsupported.push(`no kernel draft for ${missing.join(", ")}`); return finish(); }
    for (let i = 0; i < sc.steps.length; i++) {
      g.step = i;
      const s = sc.steps[i];
      try { execStep(g, s); }
      catch (err) { if (err instanceof Stop) { failures.push({ ...err.failure, where: `step ${i + 1} (${s.label ?? s.do})` }); if (err.failure.check === "unsupported") unsupported.push(err.failure.actual); break; } throw err; }
      check(s.expect, `after step ${i + 1} (${s.label ?? s.do})`);
    }
    if (!failures.some((f) => ["action", "decision", "answer", "rejected", "unsupported", "advance", "watchdog"].includes(f.check))) {
      g.step = sc.steps.length - 1; check(sc.expect, "final");
      // a decision nobody answered at the end is either a scripted expectation (a `pending` check) or the engine asking more than the oracle text implies
      const last = sc.steps[sc.steps.length - 1]?.expect ?? [];
      const declared = [...sc.expect, ...last].some((e) => e.check === "pending" && e.present);
      if (g.state.pending && !declared) failures.push({ where: "final", check: "pending", why: "every decision the engine opens must be answered by the script (or declared with a pending expectation)", expected: "no unanswered decision at the end of the scenario", actual: pendStr(g.state.pending as never) });
    }
  } catch (err) {
    if (err instanceof SpecError) specError = err.message;
    else if (err instanceof Stop) failures.push({ ...err.failure });
    else failures.push({ where: g.where(), check: "crash", expected: "the engine does not throw", actual: `${(err as Error).stack?.split("\n").slice(0, 4).join(" | ") ?? String(err)}` });
  }
  return finish();

  function finish(): ScenarioResult {
    const noDraft = [...g.usedCards].filter((n) => !env.hasDraft(n));
    const unres = g.unresolved;
    let status: SpecStatus = specError ? "SPEC_ERROR" : unsupported.length || unres.length ? "UNSUPPORTED" : failures.length ? "FAIL" : "PASS";
    const stack: string[] = [];
    if (g.state) for (const it of [...g.state.stack].reverse()) stack.push(`${g.nameOf(it.sourceId)} (${it.kind})`);
    const result: ScenarioResult = {
      card: file.card, scenario: sc.name, status, failures, specError, unsupported: [...unsupported, ...unres.map((u) => `engine reported: ${u}`)], noDraft,
      actionLog: g.actionLog, lastEvents: g.events.slice(-25).map((x) => `[${x.step + 1}] ${x.line}`), stack, durationMs: Date.now() - t0
    };
    if (sc.knownFailure) result.knownFailure = sc.knownFailure;
    return result;
  }
}
