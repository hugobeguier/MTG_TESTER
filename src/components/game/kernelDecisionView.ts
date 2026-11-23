// Pure view-model for the kernel's open decision (TableState.decision): no React, no DOM, so every decision type is testable headless.
//   - classifyDecision(): which "layout" renders the decision and whether its options can be clicked on the board (battlefield permanents, player avatars,
//     the human's own hand cards) instead of in the dialog's list
//   - the selection state machine (toggle / min / max / "up to" / repeatable / single-pick replace / reorder) and the Choice it confirms with
//   - the numeric and split-amount helpers (X value, assign damage / mana / counters)
// It never invents options: every id it returns came from decision.options (or the numeric / split ranges the kernel stated).
import type { Choice } from "@/kernel/engine/types";
import type { DecisionOptionView, DecisionView } from "@/kernel/integration/tableState";

export type DecisionLayout = "yes_no" | "number" | "split" | "order" | "place" | "pick";

export interface DecisionClass {
  layout: DecisionLayout;
  /** the options are all permanents / players / hand cards the table shows, so the player may click them on the board */
  board: boolean;
  /** the kernel will take an empty answer (min 0): "up to N" */
  upTo: boolean;
  /** a short label for the dialog's header ("Target", "Choose cards", ...) */
  label: string;
}

const LABEL: Record<string, string> = {
  choose_targets: "Choose targets", cast_target_player: "Choose a player", choose_modes: "Choose modes", choose_x: "Choose X", choose_number: "Choose a number",
  choose_cards: "Choose cards", choose_yes_no: "Yes or no", choose_color: "Choose a colour", order_triggers: "Order triggers", order_replacements: "Order effects",
  assign_damage: "Assign combat damage", choose_option: "Choose", pay_unless: "Pay or not", choose_cast_option: "How to cast", assign_mana: "Assign mana", assign_counters: "Assign counters", order_library: "Place cards"
};

/** options a click on the board can answer: the viewer's battlefield permanents / hand cards (ThreeGameTable renders these) and players (their life plate) */
export function boardClickable(o: DecisionOptionView): boolean {
  if (o.seatId) return true;
  const z = o.card?.zone;
  return !!o.card && (z === "battlefield" || z === "hand");
}

export function classifyDecision(d: DecisionView): DecisionClass {
  const base = { upTo: d.min === 0 && !d.numeric, label: LABEL[d.kind] ?? d.kind.replace(/_/g, " ") };
  if (d.kind === "assign_damage" || d.kind === "assign_mana" || d.kind === "assign_counters") return { ...base, layout: "split", board: false };
  if (d.kind === "order_library") return { ...base, layout: "place", board: false, upTo: false };
  if (d.numeric) return { ...base, layout: "number", board: false };
  if (d.kind === "choose_yes_no" || d.kind === "pay_unless") return { ...base, layout: "yes_no", board: false };
  if (d.kind === "order_triggers" || d.kind === "order_replacements") return { ...base, layout: "order", board: false };
  const board = (d.kind === "choose_targets" || d.kind === "cast_target_player" || d.kind === "choose_cards" || d.kind === "choose_option")
    && d.options.length > 0 && !d.repeatable && d.options.every(boardClickable);
  return { ...base, layout: "pick", board };
}

// ---------------------------------------------------------------- selection (pick layout)

type Range = Pick<DecisionView, "min" | "max" | "repeatable">;

/** click on option `id`: add it, remove it, or (max 1) replace the pick; at the max nothing more is added; repeatable options may be added again */
export function toggleSelection(d: Range, picked: readonly string[], id: string): string[] {
  if (d.repeatable) return picked.length < d.max ? [...picked, id] : [...picked];
  if (picked.includes(id)) return picked.filter((x) => x !== id);
  if (d.max === 1) return [id];
  return picked.length < d.max ? [...picked, id] : [...picked];
}
export function undoLast(picked: readonly string[]): string[] { return picked.slice(0, -1); }
export function canConfirm(d: Range, picked: readonly string[]): boolean { return picked.length >= d.min && picked.length <= d.max; }
export function pickChoice(picked: readonly string[]): Choice { return { ids: [...picked] }; }

/** "Choose 2", "Choose up to 3", "Choose 1 to 3" */
export function selectionHint(d: Range, picked: readonly string[]): string {
  const rule = d.min === d.max ? `${d.min}` : d.min === 0 ? `up to ${d.max}` : `${d.min} to ${d.max}`;
  return `Selected ${picked.length} (choose ${rule})`;
}
/** the label of the confirm button: "None" for an empty up-to answer */
export function confirmLabel(d: Range, picked: readonly string[]): string { return d.min === 0 && picked.length === 0 ? "None" : "Confirm"; }

/** move one entry (ordering decisions): the answer lists the ids in the order chosen */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return [...list];
  const out = [...list];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

/** the initial order of an ordering decision: the kernel's own order */
export function initialOrder(d: DecisionView): string[] { return d.options.map((o) => o.id); }
/**
 * One row of an ordering dialog: the kernel's entries that are identical in effect AND cause (same source object, ability, causing object, amount ... = the same `group`)
 * are shown once with a count badge and move together; every other entry is its own row.
 */
export interface OrderEntry { key: string; ids: string[]; count: number; option: DecisionView["options"][number] }
export function orderEntries(d: Pick<DecisionView, "options">): OrderEntry[] {
  const out: OrderEntry[] = [];
  const byGroup = new Map<string, OrderEntry>();
  for (const o of d.options) {
    const g = o.group;
    const hit = g !== undefined ? byGroup.get(g) : undefined;
    if (hit) { hit.ids.push(o.id); hit.count++; continue; }
    const e: OrderEntry = { key: o.id, ids: [o.id], count: 1, option: o };
    out.push(e);
    if (g !== undefined) byGroup.set(g, e);
  }
  return out;
}
/** the answer for an order of entry keys: every entry's ids in that order (a merged row contributes its ids side by side); max 1 = just the first id */
export function entriesChoice(d: Pick<DecisionView, "max" | "options">, order: readonly string[]): Choice {
  const by = new Map(orderEntries(d).map((e) => [e.key, e]));
  const ids = order.flatMap((k) => by.get(k)?.ids ?? []);
  return { ids: d.max <= 1 ? ids.slice(0, 1) : ids };
}
/** the full text of an ordering entry (never truncated): the ability's text, else the kernel's label */
export function entryText(o: { label: string; text?: string }): string { return o.text ?? o.label; }
/** "because Fear of Sleep Paralysis entered the battlefield" for entries that have a causing card */
export function causeLine(o: { causeLabel?: string; causeCard?: { name: string } }): string | undefined { return o.causeCard ? `because ${o.causeCard.name}${o.causeLabel ? " " + o.causeLabel : ""}` : undefined; }

/** order_triggers / order_replacements: one id (the first to apply) is the answer when max is 1, otherwise the whole order */
export function orderChoice(d: Pick<DecisionView, "max">, order: readonly string[]): Choice { return { ids: d.max <= 1 ? order.slice(0, 1) : [...order] }; }

// ---------------------------------------------------------------- numbers (X, choose_number)

export function clampNumber(d: Pick<DecisionView, "min" | "max">, n: number): number {
  const v = Number.isFinite(n) ? Math.floor(n) : d.min;
  return Math.min(d.max, Math.max(d.min, v));
}
export function numberChoice(d: Pick<DecisionView, "min" | "max">, n: number): Choice { return { number: clampNumber(d, n) }; }
/** the "max" of an X question is what the player can afford; say so */
export function numberHint(d: Pick<DecisionView, "kind" | "min" | "max">): string {
  return d.kind === "choose_x" ? `X from ${d.min} to ${d.max} (the most you can afford)` : `${d.min} to ${d.max}`;
}

// ---------------------------------------------------------------- split amounts (assign_damage / assign_mana / assign_counters)

export interface SplitModel {
  ids: string[];
  /** per-id upper bound for the stepper */
  caps: Record<string, number>;
  /** exact total required (damage, mana), or the min..max range (counters) */
  total?: number;
  min: number;
  max: number;
}
export function splitModel(d: DecisionView): SplitModel {
  if (d.kind === "assign_damage") {
    const lethal = Object.keys(d.amounts?.lethal ?? {});
    const ids = lethal.length ? lethal : d.options.map((o) => o.id);
    const total = d.amounts?.total ?? 0;
    return { ids, caps: Object.fromEntries(ids.map((i) => [i, total])), total, min: total, max: total };
  }
  if (d.kind === "assign_mana") {
    const ids = d.mana?.colors ?? [];
    const total = d.mana?.total ?? 0;
    return { ids, caps: Object.fromEntries(ids.map((i) => [i, total])), total, min: total, max: total };
  }
  const avail = d.counters?.available ?? {};
  const ids = Object.keys(avail);
  return { ids, caps: { ...avail }, min: d.counters?.min ?? d.min, max: d.counters?.max ?? d.max };
}
export function splitSum(m: SplitModel, vals: Record<string, number>): number { return m.ids.reduce((n, id) => n + (vals[id] ?? 0), 0); }
export function splitValid(m: SplitModel, vals: Record<string, number>): boolean {
  const sum = splitSum(m, vals);
  if (m.ids.some((id) => (vals[id] ?? 0) > (m.caps[id] ?? 0))) return false;
  return m.total !== undefined ? sum === m.total : sum >= m.min && sum <= m.max;
}
export function setSplit(m: SplitModel, vals: Record<string, number>, id: string, n: number): Record<string, number> {
  const v = Math.min(m.caps[id] ?? 0, Math.max(0, Number.isFinite(n) ? Math.floor(n) : 0));
  return { ...vals, [id]: v };
}
export function splitChoice(m: SplitModel, vals: Record<string, number>): Choice {
  return { assign: Object.fromEntries(m.ids.filter((id) => (vals[id] ?? 0) > 0).map((id) => [id, vals[id]])) };
}
/** damage: put the lethal amount on each recipient in order, the rest on the last one (a sensible starting point the player edits) */
export function defaultDamageSplit(m: SplitModel, lethal: Record<string, number>): Record<string, number> {
  let left = m.total ?? 0;
  const out: Record<string, number> = {};
  m.ids.forEach((id, i) => {
    const give = i === m.ids.length - 1 ? left : Math.min(left, lethal[id] ?? 0);
    out[id] = give;
    left -= give;
  });
  return out;
}

// ---------------------------------------------------------------- the board bridge

/** what ThreeGameTable needs to run a board pick for a decision (ids are the table's: card.id, seat ids) */
export interface BoardPickModel {
  title: string;
  instruction: string;
  /** table card id -> option id */
  cardOptions: Record<string, string>;
  /** seat id -> option id */
  seatOptions: Record<string, string>;
}
export function boardPickModel(d: DecisionView): BoardPickModel {
  const cardOptions: Record<string, string> = {};
  const seatOptions: Record<string, string> = {};
  for (const o of d.options) {
    if (o.seatId) seatOptions[o.seatId] = o.id;
    else if (o.card) cardOptions[o.card.id] = o.id;
  }
  return { title: d.title, instruction: d.instruction, cardOptions, seatOptions };
}

// ---------------------------------------------------------------- castable highlighting

export interface CastHint { castable: boolean; reason?: string }
/**
 * Why a hand card glows or not. `playable` = ids from the controller's playableCardIds(); `holdsPriority` = the human may act now.
 * (The kernel lists a cast only when it can be paid, so "not listed" means timing or mana.)
 */
export function castHint(cardId: string, o: { playable: ReadonlySet<string>; holdsPriority: boolean; isLand: boolean; stackEmpty: boolean; mainPhase: boolean; activeTurn: boolean }): CastHint {
  if (o.playable.has(cardId)) return { castable: true };
  if (!o.holdsPriority) return { castable: false, reason: "You don't have priority" };
  if (o.isLand) return { castable: false, reason: o.activeTurn && o.mainPhase && o.stackEmpty ? "No land drop left" : "Lands can only be played in your main phase with an empty stack" };
  return { castable: false, reason: "Not castable now: not enough mana or wrong timing" };
}
