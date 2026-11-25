// Behavioural sweep over the Aminatou deck (data/kernel-drafts/aminatou): each risky card is played through the real engine (via KernelSession, so the
// stack log is built too) and the oracle-text effect is asserted: zone changes, counters, tokens, mana, life; no `unresolved` event; no "No visible effect" line.
import { expect } from "vitest";
import "./resolve";
import { ctx, mini } from "../integration/testgame";
import { KernelSession } from "../integration/kernelSession";
import { chars } from "./core";
import type { Action, Choice, GameEvent, ObjId, PendingView, PlayerId } from "./types";

export type Mini = ReturnType<typeof mini>;
export type Answerer = (p: PendingView, g: G) => Choice | undefined;

export class G {
  ks: KernelSession;
  events: GameEvent[] = [];
  asked: string[] = [];
  constructor(public m: Mini) { this.ks = KernelSession.fromState(m.state, { ctx }); }
  get s() { return this.ks.state; }
  do(player: PlayerId, a: Action) {
    const r = this.ks.dispatch(player, a);
    this.events.push(...r.events);
    if (!r.ok) throw new Error(`${a.type} refused: ${JSON.stringify(r.error)}`);
    return r;
  }
  /** answer decisions (default: yes / first options / min number) and pass priority until the stack is empty */
  drive(answer?: Answerer): void {
    for (let i = 0; i < 120; i++) {
      const p = this.s.pending;
      if (p) {
        this.asked.push(p.kind);
        const c = answer?.(p, this) ?? (p.numeric ? { number: p.min } : p.kind === "choose_yes_no" ? { yes: true } : p.kind === "order_library" ? { place: { top: p.options.map((o) => o.id) } } : { ids: p.options.slice(0, Math.max(p.min, 1)).map((o) => o.id) });
        this.do(p.player, { type: "answerDecision", player: p.player, decisionId: p.id, choice: c });
      } else if (this.s.stack.length && this.s.priority) this.do(this.s.priority, { type: "passPriority", player: this.s.priority });
      else break;
    }
  }
  cast(p: PlayerId, id: ObjId, o: Partial<Extract<Action, { type: "castSpell" }>> = {}, answer?: Answerer) { this.do(p, { type: "castSpell", player: p, cardId: id, autoPay: true, ...o } as Action); this.drive(answer); }
  act(p: PlayerId, src: ObjId, ab: string, o: Record<string, unknown> = {}, answer?: Answerer) { this.do(p, { type: "activateAbility", player: p, sourceId: src, abilityId: ab, autoPay: true, ...o } as Action); this.drive(answer); }
  land(p: PlayerId, id: ObjId, answer?: Answerer) { this.do(p, { type: "playLand", player: p, cardId: id } as Action); this.drive(answer); }
  obj(id: ObjId) { return this.s.objects[id]; }
  zone(id: ObjId) { return this.s.objects[id]?.zone; }
  chars(id: ObjId) { return chars({ s: structuredClone(this.s), events: [], defs: ctx.cards, scanned: 0 } as never, id); }
  find(name: string, zone?: string, ctl?: PlayerId): ObjId[] { return Object.values(this.s.objects).filter((o) => o.cardName === name && (!zone || o.zone === zone) && (!ctl || o.controller === ctl)).map((o) => o.id); }
  bf(name: string, ctl?: PlayerId) { return this.find(name, "battlefield", ctl); }
  pl(id: PlayerId) { return this.s.players.find((p) => p.id === id)!; }
  unresolved(): string[] { return this.events.filter((e) => (e as { kind?: string }).kind === "unresolved" || (e as { type?: string }).type === "unresolved").map((e) => JSON.stringify(e)); }
  noEffect(): string[] { return this.ks.stackLog("p1").groups.flatMap((g) => g.lines.map((l) => l.text)).filter((t) => t.includes("No visible effect")); }
  log(): string[] { return this.ks.stackLog("p1").groups.flatMap((g) => g.lines.map((l) => l.text)); }
  clean(label = "") { expect(this.unresolved(), label).toEqual([]); expect(this.noEffect(), label).toEqual([]); }
}
export function base(o: { lib?: boolean; phase?: "upkeep" | "precombat_main" } = {}) {
  const m = mini(["p1", "p2"], { phase: o.phase ?? "precombat_main" });
  if (o.lib !== false) for (const p of ["p1", "p2"]) for (let i = 0; i < 12; i++) m.give(p, i % 2 ? "Island" : "Swamp", "library");
  return m;
}
export const lands = (m: Mini, p: PlayerId, ...names: string[]) => names.forEach((n) => m.give(p, n, "battlefield"));
export const rich = (m: Mini, p: PlayerId = "p1") => lands(m, p, "Plains", "Plains", "Plains", "Island", "Island", "Island", "Swamp", "Swamp", "Swamp", "Plains", "Island", "Swamp");
export const ids = (...x: ObjId[]): Answerer => () => ({ ids: x });


export const abId = (name: string, re: RegExp) => ctx.cards(name)!.kernel!.abilities.find((a) => re.test(a.text ?? ""))!.id;
export const labelPick = (re: RegExp, n = 1): Answerer => (p) => ({ ids: p.options.filter((o) => re.test(o.label)).slice(0, n).map((o) => o.id) });
export const names = (g: G, ids: ObjId[]) => ids.map((i) => g.obj(i).cardName);

/** advance phases (the active player passing) until `who`'s next upkeep (triggers of that step are on the stack / resolved by drive) */
export function toUpkeep(g: G, who: PlayerId, answer?: Answerer): void {
  let started = false;
  for (let i = 0; i < 80; i++) {
    if (g.s.pending || (g.s.stack.length && g.s.priority)) { g.drive(answer); continue; }
    if (g.s.turn.active === who && g.s.turn.phase === "upkeep" && started) return;
    started = true;
    const a = g.s.turn.active;
    if (g.s.combat?.expect) {
      const ex = g.s.combat.expect as { kind: string; player?: PlayerId; players?: PlayerId[] };
      if (ex.kind === "attackers") g.do(ex.player!, { type: "declareAttackers", player: ex.player!, attackers: [] } as Action);
      else for (const p of ex.players!) g.do(p, { type: "declareBlockers", player: p, blocks: [] } as Action);
      continue;
    }
    g.do(a, { type: "advancePhase", player: a } as Action);
  }
  throw new Error("never reached upkeep");
}
