// Everything besides the GameSession that the table is given for one viewer: priority, the stack panel, floating mana, and the viewer's open decision.
// Pure functions of the kernel state (after viewFor redaction), like toSession.
import { viewFor } from "../engine/view";
import type { DecisionKind, DecisionOption, GameState, PendingView, PlayerId, StackItem } from "../engine/types";
import type { GameSession, ManaPool, VisibleCard } from "../../lib/types";
import type { PendingActionView } from "../../components/ThreeGameTable";
import type { StackItemDescription } from "../../lib/stackDescription";
import { cardForObject, manaPoolsOf, toSession, type ToSessionEnv } from "./toSession";

export interface DecisionOptionView extends DecisionOption {
  /** the card an object option stands for (targets, discards, search results), when it is visible to the viewer */
  card?: VisibleCard;
  /** a player option: the seat */
  seatId?: string;
}
export interface DecisionView {
  id: string;
  kind: DecisionKind;
  player: PlayerId;
  title: string;
  instruction: string;
  options: DecisionOptionView[];
  min: number;
  max: number;
  repeatable?: boolean;
  numeric?: boolean;
  cancellable: boolean;
  amounts?: PendingView["amounts"];
  mana?: PendingView["mana"];
  counters?: PendingView["counters"];
}
export interface WaitingFor { player: PlayerId; kind: DecisionKind; title: string }

export interface TableState {
  session: GameSession;
  /** who holds priority (undefined while a declaration or decision is awaited) */
  prioritySeatId?: string;
  priorityPasses: string[];
  /** players that must pass before the top stack item resolves */
  requiredPasses: string[];
  manaPools: Record<string, ManaPool>;
  /** the stack, top first: `pendingAction` is the top item, `stackActions` the rest */
  pendingAction?: PendingActionView;
  stackActions: PendingActionView[];
  /** the viewer's own open decision (options included) */
  decision?: DecisionView;
  /** somebody else's open decision (no options) */
  waitingFor?: WaitingFor;
  /** the player(s) who owe a declaration (attackers / blockers) */
  declaring?: { kind: "attackers" | "blockers"; players: PlayerId[] };
}

function describe(state: GameState, view: ReturnType<typeof viewFor>, item: StackItem, env: ToSessionEnv, summary: string): StackItemDescription {
  const name = (id: string) => (id.startsWith("#") ? (view.objects[id] ? view.objects[id].token?.name ?? view.objects[id].cardName : "a card") : view.players.find((p) => p.id === id)?.name ?? id);
  const targets: StackItemDescription["targets"] = [];
  for (const part of item.parts) for (const ids of Object.values(part.targets)) for (const id of ids) {
    if (!id.startsWith("#")) { targets.push({ kind: "player", label: name(id), seatId: id, seatName: name(id) }); continue; }
    const o = state.objects[id];
    if (!o) continue;
    const onStack = state.stack.some((s) => s.objectId === id);
    targets.push({ kind: onStack ? "stack" : "card", label: name(id), seatId: o.controller, seatName: name(o.controller), cardId: env.legacyIds?.get(id) ?? id });
  }
  const modes = item.parts.map((p) => p.modeId).filter((m): m is string => !!m);
  return { source: name(item.sourceId), controller: name(item.controller), controllerSeatId: item.controller, summary, modes, targets, targetsPending: false };
}

/** The stack as the table's panel shows it, top of the stack first. */
export function stackViews(state: GameState, viewer: PlayerId, env: ToSessionEnv): PendingActionView[] {
  const view = viewFor(state, viewer);
  const out: PendingActionView[] = [];
  for (const item of [...state.stack].reverse()) {
    const src = state.objects[item.sourceId];
    const visible = !!view.objects[item.sourceId];
    const cardName = visible ? view.objects[item.sourceId].token?.name ?? view.objects[item.sourceId].cardName : "a card";
    const def = src && !src.token ? env.ctx.cards(src.cardName) : undefined;
    const ability = def?.kernel.abilities.find((a) => a.id === item.abilityId);
    const summary = ability?.text ?? (item.kind === "spell" ? cardName : item.trigger ? "triggered ability" : "ability");
    const description = describe(state, view, item, env, summary);
    const sourceCard = visible ? cardForObject(state, viewer, env, item.sourceId, item.kind === "spell" ? "hand" : "battlefield") : undefined;
    if (item.kind === "spell") out.push({ id: item.id, type: "spell", actorSeatId: item.controller, cardName, ...(sourceCard ? { cardTypeLine: sourceCard.typeLine, sourceCard } : {}), message: `${cardName} is on the stack.`, description });
    else out.push({ id: item.id, type: "trigger", actorSeatId: item.controller, controllerSeatId: item.controller, sourceCardName: cardName, triggerKind: "common", message: summary, ...(sourceCard ? { sourceCard } : {}), description });
  }
  return out;
}

/** The open decision as the viewer may see it: their own with options (object options carry the card), somebody else's as "waiting for". */
export function decisionView(state: GameState, viewer: PlayerId, env: ToSessionEnv): { decision?: DecisionView; waitingFor?: WaitingFor } {
  const p = state.pending;
  if (!p) return {};
  const title = p.prompt?.title || p.kind;
  if (p.player !== viewer) return { waitingFor: { player: p.player, kind: p.kind, title } };
  const options: DecisionOptionView[] = p.options.map((o) => {
    if (o.id.startsWith("#")) { const card = cardForObject(state, viewer, env, o.id, state.objects[o.id]?.zone as VisibleCard["zone"]); return { ...o, ...(card ? { card } : {}) }; }
    if (state.players.some((x) => x.id === o.id)) return { ...o, seatId: o.id };
    return { ...o };
  });
  return {
    decision: {
      id: p.id, kind: p.kind, player: p.player, title, instruction: p.prompt?.instruction ?? "", options, min: p.min, max: p.max, cancellable: p.cancellable,
      ...(p.repeatable ? { repeatable: true } : {}), ...(p.numeric ? { numeric: true } : {}), ...(p.amounts ? { amounts: p.amounts } : {}), ...(p.mana ? { mana: p.mana } : {}), ...(p.counters ? { counters: p.counters } : {})
    }
  };
}

/** Everything the table needs for `viewer`, in one call (the session is reused from `previous` when nothing changed). */
export function toTableState(state: GameState, viewer: PlayerId, env: ToSessionEnv, previous?: TableState): TableState {
  const session = toSession(state, viewer, env, previous?.session);
  const stack = stackViews(state, viewer, env);
  const alive = state.players.filter((p) => !p.hasLost).map((p) => p.id);
  const ex = state.combat?.expect;
  return {
    session,
    ...(state.priority ? { prioritySeatId: state.priority } : {}),
    priorityPasses: [...state.passes],
    requiredPasses: state.stack.length ? alive.filter((id) => !state.passes.includes(id)) : [],
    manaPools: manaPoolsOf(state),
    ...(stack[0] ? { pendingAction: stack[0] } : {}),
    stackActions: stack.slice(1),
    ...decisionView(state, viewer, env),
    ...(ex ? { declaring: ex.kind === "attackers" ? { kind: "attackers" as const, players: [ex.player] } : { kind: "blockers" as const, players: [...ex.players] } } : {})
  };
}
