// Decision hints: the legacy engine made its choices (targets, discards, selections) silently with its own heuristics, so the observer cannot
// ask it. But the choice shows in the legacy RESULT: the permanent that was destroyed / tapped / damaged / moved, the player whose life or hand
// changed, the cards that left the hand. `legacyHint` answers a kernel decision with the options that visibly changed between the legacy states
// S0 and S1, so the kernel replays the legacy choice instead of the default policy (which stays the fallback, and still marks the diff
// `choiceDependent`). Pure: only reads the sessions.
import type { GameSession, PlayerSeat, VisibleCard } from "../../lib/types";
import type { Choice, GameState, PendingView, PlayerId } from "../engine/types";
import type { AdaptResult } from "./adapter";

export type Hint = (p: PendingView, state: GameState, actor: PlayerId) => Choice | undefined;

interface Located { seat: PlayerSeat; zone: string; card: VisibleCard }

function locate(s: GameSession, legacyId: string): Located | undefined {
  for (const seat of s.seats) {
    const zones: Array<[string, VisibleCard[] | undefined]> = [["battlefield", seat.board.battlefield], ["hand", seat.board.hand], ["graveyard", seat.board.graveyard], ["exile", seat.board.exile], ["library", seat.library], ["command", seat.board.commander ? [seat.board.commander] : []]];
    for (const [zone, list] of zones) { const card = list?.find((c) => c.id === legacyId); if (card) return { seat, zone, card }; }
  }
  return undefined;
}

const counterKey = (c: VisibleCard): string => JSON.stringify((c.counters ?? []).filter((x) => x.count > 0).map((x) => [x.kind, x.count] as [string, number]).sort());

/** Did this legacy card visibly change (moved, died, tapped, countered, damaged, re-attached, changed controller) between S0 and S1? */
export function cardChanged(s0: GameSession, s1: GameSession, legacyId: string): boolean {
  const a = locate(s0, legacyId), b = locate(s1, legacyId);
  if (!a) return false;
  if (!b) return true;
  if (a.zone !== b.zone || a.seat.id !== b.seat.id) return true;
  if (a.zone !== "battlefield") return false;
  return !!a.card.tapped !== !!b.card.tapped || counterKey(a.card) !== counterKey(b.card) || (a.card.damage ?? 0) !== (b.card.damage ?? 0) || a.card.attachedToId !== b.card.attachedToId || !!a.card.attacking !== !!b.card.attacking;
}

export function playerChanged(s0: GameSession, s1: GameSession, seatId: string): boolean {
  const a = s0.seats.find((s) => s.id === seatId), b = s1.seats.find((s) => s.id === seatId);
  if (!a || !b) return false;
  return a.life !== b.life || a.board.hand.length !== b.board.hand.length || (a.board.graveyard?.length ?? 0) !== (b.board.graveyard?.length ?? 0) || (a.library?.length ?? 0) !== (b.library?.length ?? 0);
}

/** Hint that replays the legacy choice for target / card selections; undefined (-> default policy) for everything it cannot infer. */
export function legacyHint(s0: GameSession, s1: GameSession, a0: AdaptResult): Hint {
  /**
   * Did the legacy result move / change this object relative to where the KERNEL has it when it asks? (Not relative to S0: a land that
   * entered during the action is already on the battlefield in the kernel, and staying there is "unchanged".)
   */
  const changed = (id: string, state: GameState): boolean => {
    if (!id.startsWith("#")) return playerChanged(s0, s1, id);
    const o = state.objects[id], legacy = a0.toLegacy.get(id);
    if (!o || !legacy) return false;
    const after = locate(s1, legacy);
    if (!after) return o.zone === "battlefield" && !!o.token;
    if (after.zone !== o.zone || after.seat.id !== o.controller) return true;
    if (o.zone !== "battlefield") return false;
    const kc = JSON.stringify(Object.entries(o.counters).filter(([, n]) => n > 0).sort());
    return !!after.card.tapped !== o.tapped || counterKey(after.card) !== kc || (after.card.damage ?? 0) !== o.damage;
  };
  return (p, state) => {
    // "<Commander>: command zone?" (the replacement offered when a commander would go to the graveyard / exile): did the legacy engine put it there?
    if (p.kind === "choose_yes_no" && /command zone?s*$/i.test(p.prompt?.title ?? "")) {
      const name = (p.prompt?.title ?? "").replace(/:s*command zone?s*$/i, "");
      const inCommandZone = s1.seats.some((seat) => seat.board.commander?.name === name);
      return { yes: inCommandZone };
    }
    if (p.kind !== "choose_targets" && p.kind !== "cast_target_player" && p.kind !== "choose_cards") return undefined;
    const hit = p.options.map((o) => o.id).filter((id) => changed(id, state));
    if (hit.length < Math.max(1, p.min)) return undefined;
    return { ids: hit.slice(0, Math.max(1, p.max)) };
  };
}
