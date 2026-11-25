// Everything besides the GameSession that the table is given for one viewer: priority, the stack panel, floating mana, and the viewer's open decision.
// Pure functions of the kernel state (after viewFor redaction), like toSession.
import { xNote } from "./stackLog";
import { viewFor } from "../engine/view";
import type { DecisionKind, DecisionOption, GameState, PendingView, PlayerId, StackItem } from "../engine/types";
import type { GameSession, ManaPool, VisibleCard } from "../../lib/types";
import type { PendingActionView } from "../../components/ThreeGameTable";
import type { StackItemDescription } from "../../lib/stackDescription";
import { cardForListedObject, cardForName, cardForObject, manaPoolsOf, toSession, type ToSessionEnv } from "./toSession";

export interface DecisionOptionView extends DecisionOption {
  /** the card an object option stands for (targets, discards, search results), when it is visible to the viewer */
  card?: VisibleCard;
  /** a player option: the seat */
  seatId?: string;
  /** ordering decisions: the object that caused the entry (the permanent that entered / died, the spell cast), with its card when the viewer may see it. `source` / `text` / `causeLabel` / `group` come from the kernel's option (DecisionOption). */
  causeCard?: VisibleCard;
}
export interface DecisionView {
  id: string;
  kind: DecisionKind;
  player: PlayerId;
  title: string;
  instruction: string;
  /** the card / ability the question comes from (the card JSON's prompt.source), for the dialog header */
  source?: { card?: string; ability?: string };
  /** the card named by `source`, with its printed text and art, looked up by name (stack, board, graveyard, else the pack's card definitions) */
  sourceCard?: VisibleCard;
  options: DecisionOptionView[];
  min: number;
  max: number;
  repeatable?: boolean;
  numeric?: boolean;
  cancellable: boolean;
  amounts?: PendingView["amounts"];
  mana?: PendingView["mana"];
  counters?: PendingView["counters"];
  placement?: PendingView["placement"];
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
    const printed = ability?.text ?? (item.kind === "spell" ? cardName : item.trigger ? "triggered ability" : "ability");
    const xn = xNote(item.x, ability?.text ?? (src && !src.token ? env.display?.(src.cardName)?.oracleText : undefined)); // the chosen X, visible to whoever decides to counter it
    const summary = `${printed}${xn}`;
    const description = describe(state, view, item, env, summary);
    const sourceCard = visible ? cardForObject(state, viewer, env, item.sourceId, item.kind === "spell" ? "hand" : "battlefield") : undefined;
    if (item.kind === "spell") out.push({ id: item.id, type: "spell", actorSeatId: item.controller, cardName, ...(sourceCard ? { cardTypeLine: sourceCard.typeLine, sourceCard } : {}), message: `${cardName} is on the stack${xn}.`, description });
    else out.push({ id: item.id, type: "trigger", actorSeatId: item.controller, controllerSeatId: item.controller, sourceCardName: cardName, triggerKind: "common", message: summary, ...(sourceCard ? { sourceCard } : {}), description });
  }
  return out;
}

/** The card a decision comes from: the visible object of that name on the stack / battlefield / graveyard (live text), else its printed data by name. */
function sourceCardOf(state: GameState, viewer: PlayerId, env: ToSessionEnv, p: NonNullable<GameState["pending"]>): VisibleCard | undefined {
  // the card JSON names it (prompt.source.card), else the pending's own continuation knows which object is asking
  const c = p.ctx as { exec?: { env?: { source?: string } }; draft?: { sourceId?: string } };
  const asking = c.exec?.env?.source ?? c.draft?.sourceId;
  const name = p.prompt?.source?.card ?? (asking ? state.objects[asking]?.cardName : undefined);
  if (!name) return undefined;
  const ids = [...state.stack.map((i) => i.sourceId).reverse(), ...state.battlefield, ...state.players.flatMap((p) => p.graveyard)];
  const hit = ids.find((id) => state.objects[id]?.cardName === name && !state.objects[id]?.faceDown);
  return (hit ? cardForObject(state, viewer, env, hit, state.objects[hit].zone as VisibleCard["zone"]) : undefined) ?? cardForName(env, name);
}

/** The open decision as the viewer may see it: their own with options (object options carry the card), somebody else's as "waiting for". */
export function decisionView(state: GameState, viewer: PlayerId, env: ToSessionEnv): { decision?: DecisionView; waitingFor?: WaitingFor } {
  const p = state.pending;
  if (!p) return {};
  const title = p.prompt?.title || p.kind;
  if (p.player !== viewer) return { waitingFor: { player: p.player, kind: p.kind, title } };
  if (p.kind === "pay_mana") return {}; // paying by hand is the table's payment banner (kernelPayment.ts), never a dialog
  const options: DecisionOptionView[] = p.options.map((o) => {
    if (p.kind === "order_triggers" || p.kind === "order_replacements") { // entries come from an ability: show its source card and the card that caused it
      const zoneOf = (id: string) => (state.objects[id]?.zone ?? "battlefield") as VisibleCard["zone"];
      const card = o.source ? cardForObject(state, viewer, env, o.source, zoneOf(o.source)) : undefined;
      const causeCard = o.cause ? cardForObject(state, viewer, env, o.cause, zoneOf(o.cause)) : undefined;
      return { ...o, ...(card ? { card } : {}), ...(causeCard ? { causeCard } : {}) };
    }
    if (o.id.startsWith("#")) { const card = cardForListedObject(state, viewer, env, o.id, o.label); return { ...o, ...(card ? { card } : {}) }; }
    if (state.players.some((x) => x.id === o.id)) return { ...o, seatId: o.id };
    return { ...o };
  });
  const sourceCard = sourceCardOf(state, viewer, env, p);
  return {
    decision: {
      id: p.id, kind: p.kind, player: p.player, title, instruction: p.prompt?.instruction ?? "", ...(p.prompt?.source ? { source: p.prompt.source } : {}), ...(sourceCard ? { sourceCard } : {}), options, min: p.min, max: p.max, cancellable: p.cancellable,
      ...(p.repeatable ? { repeatable: true } : {}), ...(p.numeric ? { numeric: true } : {}), ...(p.amounts ? { amounts: p.amounts } : {}), ...(p.mana ? { mana: p.mana } : {}), ...(p.counters ? { counters: p.counters } : {}), ...(p.placement ? { placement: p.placement } : {})
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
