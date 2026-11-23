// TEST / SCRIPT SUPPORT (Node only): real Wretched Ranks games from data/kernel-drafts + data/cards.db.
import { loadDraftLookup } from "../observer/draftLookup";
import { newGame, type NewGameOptions } from "../engine/setup";
import type { EngineContext, GameState } from "../engine/types";
import { readDeck } from "./nodePack";

export const dl = loadDraftLookup();
export const ctx: EngineContext = { cards: dl.lookup, db: dl.db };

export function deckNames(deckName: string): { cards: string[]; commander?: string } {
  const d = readDeck(deckName);
  if (!d) throw new Error(`deck file not found: ${deckName}`);
  const cards: string[] = [];
  for (const c of d.cards) { if (c.name === d.commander) continue; for (let i = 0; i < c.count; i++) cards.push(c.name); }
  return { cards, commander: d.commander };
}

/** A game of `decks` (deck names under decks/**), seats p1..pN, kernel defaults (2 seats: first player skips the draw). */
export function realGame(decks: string[] = ["Wretched Ranks", "Wretched Ranks"], o: Partial<NewGameOptions> & { upkeep?: boolean } = {}): GameState {
  const players = decks.map((d, i) => { const { cards, commander } = deckNames(d); return { id: `p${i + 1}`, name: `Player ${i + 1}`, deck: cards, ...(commander ? { commander } : {}) }; });
  const { upkeep, ...rest } = o;
  return newGame({ players, cards: dl.lookup, seed: 11, startPhase: upkeep ? "upkeep" : "precombat_main", config: { onUnsupported: "continue" }, ...rest });
}

import { debugPlaceCard } from "../engine/setup";
import { resolve } from "../engine/resolve";
import type { Action, Choice, ObjId, PlayerId, ResolveResult } from "../engine/types";
import type { Zone } from "../schema";

/** A small hand-built position of real cards: empty zones, `give` places cards, `ok` / `answer` run actions. */
export function mini(players: PlayerId[] = ["p1", "p2"], opts: { phase?: "upkeep" | "precombat_main"; config?: Partial<GameState["config"]> } = {}) {
  let state = newGame({ players: players.map((id) => ({ id, name: id, deck: [] })), cards: dl.lookup, seed: 7, openingHand: 0, startPhase: opts.phase ?? "precombat_main", config: { onUnsupported: "continue", ...opts.config } });
  const api = {
    get state(): GameState { return state; },
    set state(s: GameState) { state = s; },
    give(owner: PlayerId, name: string, zone: Zone, o?: { tapped?: boolean; fresh?: boolean; counters?: Record<string, number>; top?: boolean }): ObjId {
      const res = debugPlaceCard(state, dl.lookup, owner, name, zone, o);
      state = res.state;
      return res.id;
    },
    do(action: Action): ResolveResult { const res = resolve(state, action, ctx); if (!res.error) state = res.state; return res; },
    ok(action: Action): ResolveResult { const res = api.do(action); if (res.error) throw new Error(`${action.type} failed: ${res.error.code} ${res.error.message}`); return res; },
    answer(choice: Choice): ResolveResult { const p = state.pending!; return api.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice }); },
    /** pass priority (fastForward) until the stack is empty or a decision opens */
    settle(): void { for (let i = 0; i < 20 && state.stack.length && !state.pending && state.priority; i++) api.ok({ type: "passPriority", player: state.priority, fastForward: true }); }
  };
  return api;
}
