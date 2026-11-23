// FROZEN COPY of the pre-lookahead kernel AI (heuristics only), kept ONLY so `npm run kernel:ai-selfplay -- --ai old` can measure the new AI against it. Not used by the app.
// A simple deterministic AI policy for seats of a kernel game: it picks ONE action out of the kernel's own legalActions list, so it can never try something
// illegal. The legacy brains (scoreLegalActions & co) speak the legacy action shapes and are not reused yet (plan phase 6); this is the slice heuristic:
//   decisions: defaultAnswer (opponent-first targets, "no" to pay-unless) | declare attackers: only creatures no untapped enemy creature can kill
//   declare blockers: block when the blocker survives or kills the attacker, or when the attack would be lethal | priority: land, then the most expensive
//   castable spell (never targets only its own side), then pass / advance.
import { defaultAnswer } from "../src/kernel/observer/actions";
import { effectiveView, type LegalAction } from "../src/kernel/engine/legal";
import type { Action, Choice, EngineContext, GameState, PlayerId } from "../src/kernel/engine/types";

const MAIN = ["precombat_main", "postcombat_main"];

export interface AiMemory {
  /** action ids that were refused this turn (never tried again) */
  banned: Set<string>;
  /** stack item ids this seat already answered with a response (at most one response per stack item: no response loops) */
  responded?: Set<string>;
}

function answerFor(a: LegalAction, state: GameState, seat: PlayerId): Action | undefined {
  const p = a.pending;
  if (!p) return undefined;
  let choice: Choice | undefined = defaultAnswer(p, state, seat);
  if (!choice && p.kind === "assign_mana" && p.mana) choice = { assign: { [p.mana.colors[0]]: p.mana.total } };
  if (!choice && p.kind === "assign_counters" && p.counters) {
    const first = Object.keys(p.counters.available)[0];
    choice = { assign: first ? { [first]: Math.min(p.counters.available[first], Math.max(p.counters.min, 0)) } : {} };
  }
  if (!choice) choice = p.cancellable ? { cancel: true } : { ids: [] };
  return { type: "answerDecision", player: seat, decisionId: p.id, choice };
}

function view(state: GameState, ctx: EngineContext, id: string) {
  try { return effectiveView(state, id, ctx); } catch { return undefined; }
}

function attackDeclaration(a: LegalAction, state: GameState, ctx: EngineContext, seat: PlayerId): Action {
  const enemies = state.battlefield.filter((id) => state.objects[id].controller !== seat && !state.objects[id].tapped).map((id) => view(state, ctx, id)).filter((v): v is NonNullable<typeof v> => !!v && v.types.includes("creature"));
  const attackers: Array<{ id: string; defender: string }> = [];
  for (const c of a.attackers ?? []) {
    const v = view(state, ctx, c.id);
    if (!v || !c.defenders.length) continue;
    const power = Number(v.power ?? 0), toughness = Number(v.toughness ?? 0);
    const killers = enemies.filter((e) => Number(e.power ?? 0) >= toughness);
    const safe = killers.length === 0 || (enemies.length <= 1 && power >= Math.max(...enemies.map((e) => Number(e.toughness ?? 0)), 0) && toughness > Math.max(...enemies.map((e) => Number(e.power ?? 0)), 0));
    if (!(safe || a.mustAttack?.includes(c.id))) continue;
    if (power <= 0 && !a.mustAttack?.includes(c.id)) continue;
    // prefer a player over a planeswalker / battle; among players the one with the least life
    const players = c.defenders.filter((d) => !d.startsWith("#"));
    const pool = players.length ? players : c.defenders;
    const defender = [...pool].sort((x, y) => (state.players.find((p) => p.id === x)?.life ?? 99) - (state.players.find((p) => p.id === y)?.life ?? 99))[0];
    attackers.push({ id: c.id, defender });
  }
  return { type: "declareAttackers", player: seat, attackers };
}

function blockDeclaration(a: LegalAction, state: GameState, ctx: EngineContext, seat: PlayerId): Action {
  const me = state.players.find((p) => p.id === seat);
  const attackers = (state.combat?.attackers ?? []).map((x) => ({ id: x.id, v: view(state, ctx, x.id), defender: (x as { defender?: string }).defender }));
  const incoming = attackers.filter((x) => x.defender === seat || x.defender === undefined).reduce((n, x) => n + Number(x.v?.power ?? 0), 0);
  const lethal = !!me && incoming >= me.life;
  const used = new Set<string>();
  const taken = new Set<string>();
  const blocks: Array<{ blocker: string; attacker: string }> = [];
  for (const b of a.blockers ?? []) {
    const bv = view(state, ctx, b.id);
    if (!bv) continue;
    const options = b.attackers.filter((id) => !taken.has(id)).map((id) => ({ id, v: view(state, ctx, id) })).filter((x) => x.v);
    const good = options.find((x) => Number(bv.toughness ?? 0) > Number(x.v!.power ?? 0) || Number(bv.power ?? 0) >= Number(x.v!.toughness ?? 0) && Number(x.v!.power ?? 0) <= Number(bv.power ?? 0) + 1);
    const pick = good ?? (lethal ? options[0] : undefined);
    if (!pick || used.has(b.id)) continue;
    used.add(b.id); taken.add(pick.id);
    blocks.push({ blocker: b.id, attacker: pick.id });
  }
  return { type: "declareBlockers", player: seat, blocks };
}

/** The one action `seat` takes now, or undefined when it has nothing legal (the caller stalls loudly). Pure: reads state, never mutates it. */
export function chooseAiAction(acts: LegalAction[], state: GameState, ctx: EngineContext, seat: PlayerId, memory: AiMemory = { banned: new Set() }): Action | undefined {
  if (!acts.length) return undefined;
  const first = acts[0];
  if (first.kind === "answerDecision") return answerFor(first, state, seat);
  if (first.kind === "declareAttackers") return attackDeclaration(first, state, ctx, seat);
  if (first.kind === "declareBlockers") return blockDeclaration(first, state, ctx, seat);

  const counter = counterResponse(acts, state, ctx, seat, memory);
  if (counter) return counter;

  const mine = state.turn.active === seat;
  const emptyStack = state.stack.length === 0;
  if (mine && emptyStack && MAIN.includes(state.turn.phase)) {
    const land = acts.find((a) => a.kind === "playLand" && a.action && !memory.banned.has(a.id));
    if (land) return land.action;
    const casts = acts
      .filter((a) => a.kind === "castSpell" && a.action && !memory.banned.has(a.id))
      .filter((a) => {
        // targeted spells only when some legal target belongs to the other side (the default answer prefers opponents)
        if (a.asks !== "choose_targets" || !a.targetOptions) return true;
        return a.targetOptions.some((t) => (t.startsWith("#") ? state.objects[t]?.controller !== seat : t !== seat));
      })
      .map((a) => ({ a, mv: a.objectId ? Number(view(state, ctx, a.objectId)?.manaValue ?? 0) : 0 }))
      .sort((x, y) => y.mv - x.mv);
    if (casts.length) return casts[0].a.action;
  }
  if (mine && emptyStack) return { type: "advancePhase", player: seat };
  return acts.find((a) => a.kind === "passPriority")?.action ?? { type: "passPriority", player: seat };
}

/**
 * Responses (kept deliberately small and safe): when an OPPONENT's spell is the top of the stack and this seat holds a castable counterspell, cast it once
 * for that stack item (memory.responded caps it at one response per item, so a counter war cannot loop); anything else passes.
 */
function counterResponse(acts: LegalAction[], state: GameState, ctx: EngineContext, seat: PlayerId, memory: AiMemory): Action | undefined {
  const top = state.stack[state.stack.length - 1];
  if (!top || top.controller === seat || top.kind !== "spell" || !top.objectId) return undefined;
  const responded = (memory.responded ??= new Set());
  if (responded.has(top.id)) return undefined;
  const pick = acts.find((a) => {
    if (a.kind !== "castSpell" || !a.action || a.zone !== "hand" || !a.objectId || memory.banned.has(a.id)) return false;
    if (!a.targetOptions?.includes(top.objectId!)) return false;
    return !!view(state, ctx, a.objectId)?.abilities.some((x) => /\bcounter target (?:\w+ )*spell\b/i.test(x.text));
  });
  if (!pick) return undefined;
  responded.add(top.id);
  return pick.action;
}
