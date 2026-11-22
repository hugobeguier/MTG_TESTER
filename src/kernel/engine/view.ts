// Hidden information. The server holds the FULL GameState (server-authoritative); every player gets a filtered view of it:
//   viewFor(state, viewer)          the redacted state: other players' hands and everybody's library are replaced by counts, face-down
//                                   cards of others are anonymous, the RNG seed and the replay data inside pending decisions are gone
//   eventsFor(state, viewer, evs)   the event stream as that player may see it (a draw by someone else carries no card, a search that
//                                   moves a card library -> hand shows no name unless a `reveal` event followed; `looked_at` is private)
//   pendingFor(pending, viewer)     another player's decision shows its kind / prompt / bounds but NO options
//   viewResult(res, state, viewer)  all of the above for one ResolveResult
// Public in real Magic: battlefield, graveyards, exile (face up), command zone, the stack, life totals, `reveal` events. Private: hands,
// libraries (also their order), face-down cards, what a player looked at (`looked_at`) and the options of their open decision.

import type { Zone } from "../schema";
import type { GameEvent, GameObject, GameState, ObjId, Pending, PendingView, PlayerId, PlayerState, ResolveResult } from "./types";

export type PlayerViewState = Omit<PlayerState, "library" | "hand"> & {
  /** the viewer's own hand; [] for everybody else (see handCount) */
  hand: ObjId[];
  handCount: number;
  /** libraries are never listed, not even for their owner (the order is unknown to everyone) */
  library: [];
  libraryCount: number;
};

/** Another player's open decision: kind, prompt and bounds, never the options (they can name hidden cards). */
export type HiddenPendingView = Omit<PendingView, "options"> & { options: []; optionCount: number; hidden: true };

export type PlayerView = Omit<GameState, "players" | "objects" | "pending" | "seed" | "rngState" | "triggerQueue" | "unresolvedSeen"> & {
  viewer: PlayerId;
  players: PlayerViewState[];
  objects: Record<ObjId, GameObject>;
  pending: PendingView | HiddenPendingView | null;
  triggerQueue: Array<{ id: string; sourceId: ObjId; controller: PlayerId; label: string }>;
};

const HIDDEN_ZONES: Zone[] = ["hand", "library"];

function visibleObject(o: GameObject, viewer: PlayerId, st: GameState): GameObject | undefined {
  if (o.zone === "library") return undefined;
  if (o.zone === "hand") return o.owner === viewer ? o : undefined;
  if (o.faceDown && o.owner !== viewer && o.controller !== viewer) {
    // a face-down card is anonymous to everybody but its owner / controller (its zone and state are public)
    return { ...o, cardName: "Face-down card", counters: o.counters, token: undefined, attachedTo: o.attachedTo };
  }
  void st;
  return o;
}

export function pendingFor(p: Pending | PendingView | null | undefined, viewer: PlayerId): PendingView | HiddenPendingView | null {
  if (!p) return null;
  const { ctx: _ctx, ...view } = p as Pending;
  void _ctx;
  if (view.player === viewer) return view;
  return { ...view, options: [], optionCount: view.options.length, hidden: true };
}

export function viewFor(state: GameState, viewer: PlayerId): PlayerView {
  const players: PlayerViewState[] = state.players.map((p) => ({
    ...p, hand: p.id === viewer ? [...p.hand] : [], handCount: p.hand.length, library: [], libraryCount: p.library.length
  }));
  const objects: Record<ObjId, GameObject> = {};
  for (const [id, o] of Object.entries(state.objects)) { const v = visibleObject(o, viewer, state); if (v) objects[id] = structuredClone(v); }
  const { seed: _seed, rngState: _rng, players: _p, objects: _o, pending, triggerQueue, unresolvedSeen: _seen, ...rest } = state;
  void _seed; void _rng; void _p; void _o; void _seen;
  return {
    ...structuredClone(rest),
    // the turn log names the card a player drew: only the drawer may keep that
    turnLog: rest.turnLog.map((e) => (e.type === "draw" && e.player !== viewer ? { type: "draw", player: e.player, ts: e.ts } : structuredClone(e))),
    viewer, players, objects,
    pending: pendingFor(pending, viewer),
    triggerQueue: triggerQueue.map((t) => ({ id: t.id, sourceId: t.sourceId, controller: t.controller, label: t.label }))
  } as PlayerView;
}

/** The events one player may see. Hidden details are removed, never the fact that something happened. */
export function eventsFor(state: GameState, viewer: PlayerId, events: GameEvent[]): GameEvent[] {
  const out: GameEvent[] = [];
  for (const ev of events) {
    switch (ev.type) {
      case "looked_at":
        if (ev.player === viewer) out.push(ev);
        break;
      case "unresolved": {
        // public: the fact that something could not be resolved. Only when the card sat in somebody else's hand / library does the viewer not learn its name or text
        const zone = ev.zone as Zone | undefined;
        const owner = state.objects[ev.source as ObjId]?.owner;
        if (zone && HIDDEN_ZONES.includes(zone) && owner !== viewer) out.push({ type: "unresolved", seq: ev.seq, hidden: true, effect: ev.effect, turn: ev.turn, phase: ev.phase, player: ev.player, message: "A card could not be fully resolved." } as GameEvent);
        else out.push(ev);
        break;
      }
      case "draw":
        out.push(ev.player === viewer ? ev : { type: "draw", seq: ev.seq, player: ev.player, hidden: true } as GameEvent);
        break;
      case "zone_change": {
        const from = ev.from as Zone, to = ev.to as Zone;
        const owner = (ev.owner as PlayerId | undefined) ?? state.objects[ev.id as ObjId]?.owner;
        if (HIDDEN_ZONES.includes(from) && HIDDEN_ZONES.includes(to) && owner !== viewer) {
          out.push({ type: "zone_change", seq: ev.seq, from, to, owner, hidden: true } as GameEvent);
        } else if (HIDDEN_ZONES.includes(from) && owner !== viewer && to === "exile" && state.objects[ev.id as ObjId]?.faceDown) {
          out.push({ type: "zone_change", seq: ev.seq, from, to, owner, hidden: true } as GameEvent);
        } else out.push(ev);
        break;
      }
      default: out.push(ev);
    }
  }
  return out;
}

/** One action's result as seen by `viewer`: their view of the state, their events, their (possibly option-less) pending decision. */
export function viewResult(res: ResolveResult, viewer: PlayerId): { state: PlayerView; events: GameEvent[]; pending: PendingView | HiddenPendingView | null; error?: ResolveResult["error"] } {
  return { state: viewFor(res.state, viewer), events: eventsFor(res.state, viewer, res.events), pending: pendingFor(res.pending, viewer), error: res.error };
}
