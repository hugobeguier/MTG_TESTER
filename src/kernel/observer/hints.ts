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
  // rank: 3 moved / died, 2 counters or damage changed, 1 only tapped (a mana source tapped to PAY for the spell is not the chosen target), -1 unchanged
  const rank = (id: string, state: GameState): number => {
    if (!id.startsWith("#")) return playerChanged(s0, s1, id) ? 3 : -1;
    const o = state.objects[id], legacy = a0.toLegacy.get(id);
    if (!o || !legacy) return -1;
    const after = locate(s1, legacy);
    if (!after) return o.zone === "battlefield" && !!o.token ? 3 : -1;
    if (after.zone !== o.zone || after.seat.id !== o.controller) return 3;
    if (o.zone !== "battlefield") return -1;
    const kc = JSON.stringify(Object.entries(o.counters).filter(([, n]) => n > 0).sort());
    if (counterKey(after.card) !== kc || (after.card.damage ?? 0) !== o.damage) return 2;
    return !!after.card.tapped !== o.tapped ? 1 : -1;
  };
  const changed = (id: string, state: GameState): boolean => rank(id, state) >= 0;
  // the legacy combat log says how it divided an attacker's damage: "A trades combat damage with B and C (3 to B, 0 to C, 5 to A)"
  const seen0 = new Set(s0.events.map((e) => e.id));
  const logs = s1.events.filter((e) => !seen0.has(e.id)).map((e) => e.message);
  const norm = (n: string): string => n.replace(/ Token$/i, "").trim().toLowerCase();
  const dealt = (attacker: string): Record<string, number> | undefined => {
    const line = logs.find((m) => m.includes(" trades combat damage with ") && norm(m.split(" trades combat damage with ")[0]) === norm(attacker));
    if (!line) return undefined;
    const out: Record<string, number> = {};
    for (const m of line.slice(line.lastIndexOf("(")).matchAll(/(\d+) to ([^,)]+)/g)) out[norm(m[2])] = (out[norm(m[2])] ?? 0) + Number(m[1]);
    return out;
  };
  return (p, state, actor) => {
    if (p.kind === "assign_damage" && p.amounts) {
      const atk = state.combat?.attackers.find((a) => a.blockers.some((b) => p.amounts!.lethal[b.id] !== undefined));
      const atkObj = atk ? state.objects[atk.id] : undefined;
      const d = atkObj ? dealt(atkObj.token?.name ?? atkObj.cardName) : undefined;
      if (d) {
        const assign: Record<string, number> = {};
        for (const id of Object.keys(p.amounts.lethal)) { const o = state.objects[id]; const n = d[norm(o?.token?.name ?? o?.cardName ?? "")]; if (n) assign[id] = n; }
        if (Object.values(assign).reduce((a, b) => a + b, 0) === p.amounts.total) return { assign };
      }
      return undefined;
    }
    if (p.kind === "pay_unless") {
      // "discard two cards unless you discard an artifact card" (Thirst for Knowledge): paid when the legacy engine discarded exactly one non-spell card from the actor's hand
      // (the discarded cards may have been drawn during this very action, so compare the graveyards, not the old hand)
      const had = new Set((s0.seats.find((x) => x.id === actor)?.board.graveyard ?? []).map((c) => c.id));
      const gone = (s1.seats.find((x) => x.id === actor)?.board.graveyard ?? []).filter((c) => !had.has(c.id) && !/instant|sorcery/i.test(c.typeLine));
      if (gone.length === 1 && /artifact/i.test(gone[0].typeLine)) return { yes: true };
      if (gone.length >= 2) return { yes: false };
      // "you may pay {2}" (Mirrorworks): the legacy log says "<name> pays {2} for <card>"
      if (logs.some((m) => / pays \{\d+\} for /.test(m))) return { yes: true };
      return undefined;
    }
    if (p.kind === "choose_cards" && /manifest/i.test(p.prompt?.title ?? "")) {
      // manifest dread: the legacy engine sent one card to the graveyard and put the other onto the battlefield (face down)
      const pick = p.options.map((o) => o.id).find((id) => { const l = a0.toLegacy.get(id); const after = l ? locate(s1, l) : undefined; return after?.zone === "battlefield"; });
      return pick ? { ids: [pick] } : undefined;
    }
    // "<Commander>: command zone?" (the replacement offered when a commander would go to the graveyard / exile): did the legacy engine put it there?
    if (p.kind === "choose_yes_no" && /command zone?s*$/i.test(p.prompt?.title ?? "")) {
      const name = (p.prompt?.title ?? "").replace(/:s*command zone?s*$/i, "");
      const inCommandZone = s1.seats.some((seat) => seat.board.commander?.name === name);
      return { yes: inCommandZone };
    }
    if (p.kind !== "choose_targets" && p.kind !== "cast_target_player" && p.kind !== "choose_cards") return undefined;
    const all = p.options.map((o) => o.id).filter((id) => changed(id, state));
    const best = Math.max(-1, ...all.map((id) => rank(id, state)));
    const hit = all.filter((id) => rank(id, state) === best);
    if (hit.length < Math.max(1, p.min)) return undefined;
    return { ids: hit.slice(0, Math.max(1, p.max)) };
  };
}
