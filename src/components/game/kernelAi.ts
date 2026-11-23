// A simple deterministic AI policy for seats of a kernel game: it picks ONE action out of the kernel's own legalActions list, so it can never try something
// illegal. The legacy brains (scoreLegalActions & co) speak the legacy action shapes and are not reused yet (plan phase 6); this is the slice heuristic:
//   decisions: defaultAnswer (opponent-first targets, "no" to pay-unless) | declare attackers: only creatures no untapped enemy creature can kill
//   declare blockers: block when the blocker survives or kills the attacker, or when the attack would be lethal | priority: land, then the most expensive
//   castable spell (never targets only its own side), then pass / advance.
import { defaultAnswer } from "@/kernel/observer/actions";
import { effectiveView, type LegalAction } from "@/kernel/engine/legal";
import { chooseDecision, planMain } from "@/kernel/ai/plan";
import type { ScriptEntry } from "@/kernel/ai/simulate";
import type { Action, Choice, EngineContext, GameState, PlayerId } from "@/kernel/engine/types";

const MAIN = ["precombat_main", "postcombat_main"];

export interface AiMemory {
  /** action ids that were refused this turn (never tried again) */
  banned: Set<string>;
  /** stack item ids this seat already answered with a response (at most one response per stack item: no response loops) */
  responded?: Set<string>;
  /** answers planned with the action just chosen (X, modes, targets, life payments), consumed by the decisions it opens */
  script?: ScriptEntry[];
  /** how often each action id was chosen this turn (an ability is not used more than twice a turn) */
  usage?: Record<string, number>;
}

function answerFor(a: LegalAction, state: GameState, ctx: EngineContext, seat: PlayerId, memory: AiMemory): Action | undefined {
  const p = a.pending;
  if (!p) return undefined;
  // 1. the answer planned together with the action that opened this decision (X, modes, targets, optional costs / life payments)
  const head = memory.script?.[0];
  if (head && head.kind === p.kind) { memory.script!.shift(); return { type: "answerDecision", player: seat, decisionId: p.id, choice: head.choice }; }
  memory.script = undefined;
  // 2. everything else the seat owns is decided by lookahead (targets, sacrifices, "may", "unless", picks); the commander replacement is always accepted
  if (/command zone/i.test(`${p.prompt?.title ?? ""} ${p.prompt?.instruction ?? ""}`) && p.kind === "choose_yes_no") return { type: "answerDecision", player: seat, decisionId: p.id, choice: { yes: true } };
  let choice: Choice | undefined;
  try { choice = chooseDecision(p, state, ctx, seat); } catch { choice = undefined; }
  if (!choice) choice = defaultAnswer(p, state, seat);
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
  if (first.kind === "answerDecision") return answerFor(first, state, ctx, seat, memory);
  memory.script = undefined;
  if (first.kind === "declareAttackers") return attackDeclaration(first, state, ctx, seat);
  if (first.kind === "declareBlockers") return blockDeclaration(first, state, ctx, seat);

  const counter = counterResponse(acts, state, ctx, seat, memory);
  if (counter) return counter;

  const mine = state.turn.active === seat;
  const emptyStack = state.stack.length === 0;
  if (mine && emptyStack && MAIN.includes(state.turn.phase)) {
    const land = acts.find((a) => a.kind === "playLand" && a.action && !memory.banned.has(a.id));
    if (land) return land.action;
    // lookahead: simulate each cast / activation (with its X, modes, targets, optional costs) and take the one that improves the position most; a no-op is never chosen
    const plan = planMain(acts, state, ctx, seat, memory.banned, (memory.usage ??= {}));
    if (plan) { memory.script = plan.script; memory.usage![plan.id] = (memory.usage![plan.id] ?? 0) + 1; return plan.action; }
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
