import type { GameSession, VisibleCard } from "./types";
import type { ChosenTarget } from "./targeting";

// A pure, UI-agnostic description of one item on the stack (spell, triggered ability or activated ability), so the
// stack HUD can say who controls it, what it does and what it targets, and flag the ones that touch the human.
// Structural input type (a subset of AppFlow's PendingAction) so this module needn't import the huge component.
export interface StackItemLike {
  id: string;
  type: "phase" | "spell" | "trigger";
  actorSeatId: string;
  controllerSeatId?: string;
  cardId?: string;
  cardName?: string;
  sourceCardId?: string;
  sourceCardName?: string;
  message?: string;
  // Spells: modes/targets chosen as the spell was cast.
  castChoices?: { targets: ChosenTarget[] };
  // Counterspell responses: the id of the stack item being countered.
  counterTargetId?: string;
  // Triggers/abilities: a chosen target is stored encoded in chosenOption ("p:seat", "c:seat:card" or bare card ids).
  effect?: { kind?: string; chosenOption?: string };
  sourceCard?: Pick<VisibleCard, "oracleText" | "typeLine"> | undefined;
}

export interface StackTarget {
  kind: "player" | "card" | "stack";
  label: string;
  // Controller (permanent) or owner (graveyard/exile card) or the player themself.
  seatId: string;
  seatName: string;
  cardId?: string;
}

export interface StackItemDescription {
  source: string;
  controller: string;
  controllerSeatId: string;
  summary: string;
  targets: StackTarget[];
  // The effect text says "target" but nothing was recorded (e.g. an agent that picks on resolution).
  targetsPending: boolean;
  // The human seat id when this item (controlled by someone else) targets the human, their permanents, cards or stack items.
  affectsPlayerSeatId?: string;
}

export function parseStackTargetToken(token: string): ChosenTarget | undefined {
  const parts = token.split(":");
  if (parts[0] === "p" && parts[1]) return { kind: "player", seatId: parts[1] };
  if (parts[0] === "c" && parts[1] && parts[2]) return { kind: "card", seatId: parts[1], cardId: parts[2] };
  return undefined;
}

function locateCard(session: GameSession, cardId: string): { card: VisibleCard; seatId: string; zone: string } | undefined {
  for (const seat of session.seats) {
    const zones: Array<[string, VisibleCard[] | undefined]> = [
      ["battlefield", seat.board.battlefield],
      ["graveyard", seat.board.graveyard],
      ["exile", seat.board.exile],
      ["hand", seat.board.hand]
    ];
    for (const [zone, cards] of zones) {
      const card = cards?.find((item) => item.id === cardId);
      if (card) return { card, seatId: seat.id, zone };
    }
    if (seat.board.commander?.id === cardId) return { card: seat.board.commander, seatId: seat.id, zone: "command" };
  }
  return undefined;
}

function describeChosenTarget(session: GameSession, target: ChosenTarget): StackTarget {
  const seat = session.seats.find((item) => item.id === target.seatId);
  const seatName = seat?.name ?? "Unknown player";
  if (target.kind === "player") return { kind: "player", label: seatName, seatId: target.seatId, seatName };
  const found = locateCard(session, target.cardId);
  const zone = found && found.zone !== "battlefield" ? ` (in ${found.zone})` : "";
  return { kind: "card", label: `${found?.card.name ?? "a card that left play"}${zone}`, seatId: found?.seatId ?? target.seatId, seatName, cardId: target.cardId };
}

// Trigger/ability targets recorded at put-on-stack time. chosenOption is shared with mode indices and picked-card lists, so only
// tokens that decode to a player or locate a real card count as targets.
function triggerTargets(session: GameSession, chosenOption: string | undefined): ChosenTarget[] {
  if (!chosenOption) return [];
  const out: ChosenTarget[] = [];
  for (const token of chosenOption.split(",")) {
    const trimmed = token.trim();
    if (!trimmed || /^\d+$/.test(trimmed)) continue;
    const decoded = parseStackTargetToken(trimmed);
    if (decoded) {
      out.push(decoded);
      continue;
    }
    const found = locateCard(session, trimmed);
    if (found) out.push({ kind: "card", seatId: found.seatId, cardId: trimmed });
  }
  return out;
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function summaryFor(item: StackItemLike): string {
  const oracle = item.sourceCard?.oracleText?.trim();
  if (item.type === "trigger" && oracle) {
    const lines = oracle.split(/\n+/);
    const triggerLine = lines.find((line) => /^(when|whenever|at the beginning|at end of|landfall)/i.test(line.trim()));
    if (triggerLine && lines.length > 1) return truncate(triggerLine, 240);
  }
  if (oracle) return truncate(oracle, 240);
  return item.message ?? "";
}

export function describeStackItem(session: GameSession, item: StackItemLike, stack: StackItemLike[] = []): StackItemDescription {
  const humanSeat = session.seats.find((seat) => seat.kind === "human");
  const controllerSeatId = item.type === "trigger" ? item.controllerSeatId ?? item.actorSeatId : item.actorSeatId;
  const controller = session.seats.find((seat) => seat.id === controllerSeatId)?.name ?? "Unknown player";
  const source = item.type === "spell" ? item.cardName ?? "A spell" : item.type === "trigger" ? item.sourceCardName ?? "An ability" : "Phase change";
  const targets: StackTarget[] = [];

  if (item.type === "spell") {
    for (const target of item.castChoices?.targets ?? []) targets.push(describeChosenTarget(session, target));
    if (item.counterTargetId) {
      const countered = stack.find((other) => other.id === item.counterTargetId);
      if (countered) {
        const name = countered.type === "spell" ? countered.cardName : `${countered.sourceCardName ?? "an ability"} (ability)`;
        const seatId = countered.type === "trigger" ? countered.controllerSeatId ?? countered.actorSeatId : countered.actorSeatId;
        targets.push({ kind: "stack", label: name ?? "a spell", seatId, seatName: session.seats.find((seat) => seat.id === seatId)?.name ?? "Unknown player", cardId: countered.type === "spell" ? countered.cardId : countered.sourceCardId });
      }
    }
  } else if (item.type === "trigger") {
    for (const target of triggerTargets(session, item.effect?.chosenOption)) targets.push(describeChosenTarget(session, target));
  }

  const summary = summaryFor(item);
  const mentionsTarget = /\btargets?\b/i.test(item.sourceCard?.oracleText ?? "");
  const targetsPending = item.type !== "phase" && targets.length === 0 && mentionsTarget;
  const affectsHuman = humanSeat !== undefined && controllerSeatId !== humanSeat.id && targets.some((target) => target.seatId === humanSeat.id);

  return {
    source,
    controller,
    controllerSeatId,
    summary,
    targets,
    targetsPending,
    affectsPlayerSeatId: affectsHuman ? humanSeat.id : undefined
  };
}

// One line like "Lightning Bolt -> You, Grizzly Bears (yours)", for compact places (the agent's own context, event log).
export function formatStackTargets(description: StackItemDescription, humanSeatId?: string): string {
  if (description.targets.length === 0) return description.targetsPending ? "target chosen on resolution" : "no targets";
  return description.targets
    .map((target) => {
      if (target.kind === "player") return target.seatId === humanSeatId ? "you" : target.label;
      return `${target.label} (${target.seatId === humanSeatId ? "yours" : `${target.seatName}'s`})`;
    })
    .join(", ");
}
