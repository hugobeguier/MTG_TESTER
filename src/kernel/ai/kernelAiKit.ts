// TEST SUPPORT for the kernel AI tests: a position builder over real cards and a driver that lets the AI play one decision through (cast + its decisions + resolution).
import { mini, ctx } from "../integration/testgame";
import { legalActions } from "../engine/legal";
import { chooseAiAction, type AiMemory } from "../../components/game/kernelAi";
import type { Action, GameState, ObjId, PlayerId } from "../engine/types";

export type Table = ReturnType<typeof mini>;

/** A position: `seats` get lands / permanents / hand cards by name (real cards); every library gets a few Swamps so draws are safe. */
export function board(spec: Record<PlayerId, { lands?: Record<string, number>; field?: string[]; hand?: string[]; life?: number }>, opts: { library?: number } = {}): { t: Table; ids: Record<string, ObjId[]> } {
  const seats = Object.keys(spec);
  const t = mini(seats);
  const ids: Record<string, ObjId[]> = {};
  for (const [seat, s] of Object.entries(spec)) {
    for (const [land, n] of Object.entries(s.lands ?? {})) for (let i = 0; i < n; i++) t.give(seat, land, "battlefield");
    for (const n of s.field ?? []) (ids[`${seat}:${n}`] ??= []).push(t.give(seat, n, "battlefield"));
    for (const n of s.hand ?? []) (ids[`${seat}:${n}`] ??= []).push(t.give(seat, n, "hand"));
    for (let i = 0; i < (opts.library ?? 6); i++) t.give(seat, "Swamp", "library");
    if (s.life !== undefined) t.state.players.find((p) => p.id === seat)!.life = s.life;
  }
  return { t, ids };
}

export interface Move { action: Action; label: string; chosen: boolean }

/** what `seat` would do now (without doing it) */
export function choose(t: Table, seat: PlayerId, memory: AiMemory = { banned: new Set() }): { action?: Action; memory: AiMemory; label: string } {
  const acts = legalActions(t.state, seat, ctx);
  const action = chooseAiAction(acts, t.state, ctx, seat, memory);
  const hit = acts.find((a) => a.action && JSON.stringify(a.action) === JSON.stringify(action));
  return { action, memory, label: hit?.label ?? action?.type ?? "none" };
}

/** the AI of `seat` plays ONE main-phase decision: returns its label ("Cast Delete") or undefined when it passes / advances; then everything it opened is played out (every seat's decisions answered by the AI, priority passed until the stack is empty) */
export function playOne(t: Table, seat: PlayerId, memories: Record<string, AiMemory> = {}): { label?: string; steps: number } {
  const mem = (p: PlayerId) => (memories[p] ??= { banned: new Set() });
  const first = choose(t, seat, mem(seat));
  if (!first.action || first.action.type === "passPriority" || first.action.type === "advancePhase") return { steps: 0 };
  t.ok(first.action);
  let steps = 0;
  for (let i = 0; i < 80 && (t.state.pending || t.state.stack.length); i++, steps++) {
    if (t.state.pending) {
      const p = t.state.pending.player;
      const a = chooseAiAction(legalActions(t.state, p, ctx), t.state, ctx, p, mem(p));
      if (!a) throw new Error("AI has no answer for " + t.state.pending.kind);
      t.ok(a);
    } else t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
  }
  return { label: first.label, steps };
}

export const zoneOf = (t: Table, id: ObjId): string => t.state.objects[id].zone;
export const life = (t: Table, seat: PlayerId): number => t.state.players.find((p) => p.id === seat)!.life;
export type { GameState };
