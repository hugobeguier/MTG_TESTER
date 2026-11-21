// Game creation and host-side (NOT action) helpers. `debugPlaceCard` is for adapters and tests: it builds a position
// directly and is deliberately not reachable through `resolve`, so a client can never use it to pull cards around.

import type { Zone } from "../schema";
import { emptyPool, newObject, shuffleInPlace, drawCards, type Run } from "./core";
import type { CardDb, CardLookup, Config, GameState, ObjId, PlayerId, PlayerState } from "./types";
import { resolve } from "./resolve";
import { canBeCommander } from "./commander";
import type { Action, EngineContext, ResolveResult } from "./types";

export interface PlayerSetup {
  id: PlayerId;
  name?: string;
  /** card names, library order is shuffled with the seed unless `shuffle: false` */
  deck: string[];
  commander?: string;
  colorIdentity?: string[];
}

export interface NewGameOptions {
  players: PlayerSetup[];
  cards: CardLookup;
  seed?: number;
  startingLife?: number;
  /** Commander format checks: every `commander` must be a legal commander (legendary creature or "can be your commander"); default off */
  commanderRules?: boolean;
  shuffle?: boolean;
  /** cards drawn at the start (no mulligans yet); default 7 */
  openingHand?: number;
  /** default precombat_main of turn 1 so tests and adapters can act immediately */
  startPhase?: "upkeep" | "precombat_main";
  config?: Partial<Config>;
}

export function newGame(o: NewGameOptions): GameState {
  const config: Config = { lenient: false, skipFirstDraw: o.players.length === 2, maxEventsPerPass: 5000, handSize: 7, ...o.config };
  const players: PlayerState[] = o.players.map((p) => ({
    id: p.id, name: p.name ?? p.id, life: o.startingLife ?? 40, library: [], hand: [], graveyard: [], exile: [], command: [],
    manaPool: emptyPool(), landsPlayed: 0, lastTurnStartTs: 0, hasLost: false, drewFromEmpty: false,
    colorIdentity: p.colorIdentity ?? ["W", "U", "B", "R", "G"], commanderCasts: {}
  }));
  const state: GameState = {
    version: 1, config, seed: o.seed ?? 1, rngState: o.seed ?? 1, nextId: 1, clock: 0, decisionSeq: 0, players, objects: {}, battlefield: [], stack: [],
    turn: { number: 1, active: players[0].id, phase: o.startPhase ?? "precombat_main" }, priority: players[0].id, passes: [], effects: [], lki: {}, turnLog: [],
    activations: {}, triggerQueue: [], priorityAfter: null, pending: null, gameOver: null, combat: null, extraCombats: 0
  };
  const r: Run = { s: state, events: [], defs: o.cards, scanned: 0 };
  for (const [i, ps] of o.players.entries()) {
    for (const name of ps.deck) { const ob = newObject(r, name, ps.id, "library"); players[i].library.push(ob.id); }
    if (ps.commander && o.commanderRules && !canBeCommander(o.cards(ps.commander))) throw new Error(`${ps.commander} cannot be a commander`);
    if (ps.commander) { const ob = newObject(r, ps.commander, ps.id, "command", { isCommander: true }); players[i].command.push(ob.id); }
    if (o.shuffle !== false) shuffleInPlace(r, players[i].library);
  }
  const n = o.openingHand ?? 7;
  for (const p of players) drawCards(r, p.id, n);
  state.triggerQueue = []; state.turnLog = []; // opening hands never trigger miracle and do not count as drawn this turn
  state.turn = { number: 1, active: players[0].id, phase: o.startPhase ?? "precombat_main" };
  players[0].lastTurnStartTs = ++state.clock;
  return state;
}

/** Host/test helper: put a new card directly into a zone (returns the new state and the object id). */
export function debugPlaceCard(state: GameState, cards: CardLookup, owner: PlayerId, name: string, zone: Zone, opts: { controller?: PlayerId; tapped?: boolean; counters?: Record<string, number>; fresh?: boolean; top?: boolean } = {}): { state: GameState; id: ObjId } {
  const s = structuredClone(state);
  const r: Run = { s, events: [], defs: cards, scanned: 0 };
  const o = newObject(r, name, owner, zone);
  const p = s.players.find((x) => x.id === owner)!;
  if (zone === "battlefield") {
    s.battlefield.push(o.id);
    o.controller = opts.controller ?? owner;
    // by default the permanent has been under control since before the controller's turn began (no summoning sickness)
    o.controlledSince = opts.fresh ? ++s.clock : 0;
    o.tapped = !!opts.tapped;
    if (opts.counters) o.counters = { ...opts.counters };
  } else if (zone === "library") { if (opts.top === false) p.library.push(o.id); else p.library.unshift(o.id); }
  else if (zone !== "stack") (p[zone as "hand" | "graveyard" | "exile" | "command"] as ObjId[]).push(o.id);
  return { state: s, id: o.id };
}

/** Convenience wrapper binding a card lookup. */
export function createEngine(cards: CardLookup, db?: CardDb) {
  const ctx: EngineContext = { cards, db };
  return {
    ctx,
    resolve: (state: GameState, action: Action): ResolveResult => resolve(state, action, ctx),
    newGame: (o: Omit<NewGameOptions, "cards">) => newGame({ ...o, cards }),
    place: (state: GameState, owner: PlayerId, name: string, zone: Zone, opts?: Parameters<typeof debugPlaceCard>[5]) => debugPlaceCard(state, cards, owner, name, zone, opts)
  };
}
