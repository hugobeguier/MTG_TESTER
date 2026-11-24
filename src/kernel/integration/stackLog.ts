// The stack / trigger resolution log: turns the kernel's events (already filtered for the viewer, see eventsFor) into a TREE a player can read to follow
// how a spell and everything it triggers resolved:
//   group  = one cast / activation / land drop / combat step / phase trigger window, from the first object put on the stack until the stack is empty
//   line   = one step with an indent (`depth`), a category (for the filters) and, for stack objects, the full ability text (`detail`)
// Pure and incremental: `StackLogBuilder.push(events, names)` after every action; nothing here reads or changes game state, so the same module serves the
// table (live), the replay command and the tests. Lines are plain text (card names are made hoverable by the UI, like the action log).
import type { GameEvent as KernelEvent } from "../engine/types";
import { formatEvent, type LogNames } from "./eventLog";

export type StackLogCat = "spell" | "trigger" | "replacement" | "state" | "combat" | "effect";
export const STACK_LOG_FILTERS: ReadonlyArray<{ cat: Exclude<StackLogCat, "effect">; label: string }> = [
  { cat: "spell", label: "Spells" }, { cat: "trigger", label: "Triggers" }, { cat: "replacement", label: "Replacements" }, { cat: "state", label: "State-based" }, { cat: "combat", label: "Combat" }
];

export interface StackLogLine {
  id: number;
  /** indent level inside the group (0 = directly under the group header) */
  depth: number;
  cat: StackLogCat;
  text: string;
  /** full ability / card text, shown when the line is expanded */
  detail?: string;
  /** stack item id of the object this line is the header of (or belongs to): the UI highlights the item that is resolving */
  item?: string;
  head?: boolean;
}
export interface StackLogGroup {
  id: number;
  title: string;
  cat: StackLogCat;
  lines: StackLogLine[];
  /** the stack was empty after the last resolution (the tree ends with "Stack empty") */
  stackEmpty: boolean;
}

export interface StackLogOptions {
  /** where an object is now ("battlefield", "graveyard"...), to word what a resolved spell did */
  where?: (id: string | undefined) => string | undefined;
  /** printed text of a card (shown when a spell line is expanded) */
  textOf?: (id: string | undefined) => string | undefined;
  /** keep at most this many groups (older ones are dropped, `dropped` counts them) */
  maxGroups?: number;
}

interface ItemMeta { kind: string; desc: string; level: number; cat: StackLogCat; head?: StackLogLine; rank?: number; lines: number }
interface Batch { start: number; header: StackLogLine; notes: StackLogLine[]; items: Array<{ line: StackLogLine; meta: ItemMeta }>; level: number; group: StackLogGroup }

const CAUSE_VERB: Record<string, string> = {
  etb: "entered the battlefield", dies: "died", leaves: "left the battlefield", cast: "was cast", attack: "attacked", block: "blocked", draw: "drew", discard: "discarded",
  gain_life: "gained life", lose_life: "lost life", sacrifice: "was sacrificed", becomes_target: "became a target", unlock_door: "had a door unlocked", token_created: "was created", counter_put: "got a counter",
  deals_damage: "dealt damage", deals_combat_damage_to_player: "dealt combat damage to a player", dealt_damage: "was dealt damage"
};
const PHASE_NAME: Record<string, string> = {
  untap: "the untap step", upkeep: "upkeep", draw: "the draw step", precombat_main: "the precombat main phase", beginning_of_combat: "combat", declare_attackers: "declare attackers",
  declare_blockers: "declare blockers", first_strike_damage: "first-strike damage", combat_damage: "combat damage", end_of_combat: "the end of combat", postcombat_main: "the postcombat main phase", end_step: "the end step", cleanup: "cleanup"
};

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const short = (s: string, n: number): string => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export class StackLogBuilder {
  readonly groups: StackLogGroup[] = [];
  /** groups dropped from the front to keep memory bounded */
  dropped = 0;
  /** bumps whenever anything changed (the UI re-renders on it) */
  version = 0;
  /** the stack item that is resolving right now (highlighted) */
  resolvingItem: string | undefined;
  private lineSeq = 0;
  private groupSeq = 0;
  private cur: StackLogGroup | undefined;
  private items = new Map<string, ItemMeta>();
  private order: string[] = []; // stack items still on the stack, bottom first
  private resolving: { item: string; meta: ItemMeta } | undefined;
  private anchor: number | undefined; // nesting level for what is put on the stack next (inside whatever just resolved)
  private batch: Batch | undefined;
  private phase = "";
  private lastDamage: { line: StackLogLine; player: string; amount: number } | undefined;
  private names: LogNames = { card: () => "a card", player: (id) => id ?? "someone" };
  private readonly maxGroups: number;

  constructor(private readonly opts: StackLogOptions = {}) { this.maxGroups = opts.maxGroups ?? 400; }

  /** Feed the events of one action (oldest first). `names` resolves ids at this moment (viewer-aware). */
  push(events: readonly KernelEvent[], names: LogNames): void {
    if (!events.length) return;
    this.names = names;
    for (const ev of events) this.onEvent(ev);
    this.version++;
  }

  // ------------------------------------------------------------------ helpers

  private C(id: unknown): string { return this.names.card(typeof id === "string" ? id : undefined); }
  private P(id: unknown): string { return this.names.player(typeof id === "string" ? id : undefined); }
  /** a target / affected thing: an object id ("#12") or a player id */
  private who(id: unknown): string { return typeof id === "string" && id.startsWith("#") ? this.C(id) : this.P(id); }
  private topLevel(): number { const top = this.order.length ? this.items.get(this.order[this.order.length - 1]) : undefined; return top ? top.level + 1 : 0; }
  private cardDetail(id: unknown): string | undefined { return this.opts.textOf?.(typeof id === "string" ? id : undefined); }

  private newGroup(title: string, cat: StackLogCat): StackLogGroup {
    const g: StackLogGroup = { id: ++this.groupSeq, title, cat, lines: [], stackEmpty: false };
    this.groups.push(g);
    if (this.groups.length > this.maxGroups) { this.groups.shift(); this.dropped++; }
    this.cur = g; this.batch = undefined; this.lastDamage = undefined; this.anchor = undefined;
    return g;
  }

  private addLine(g: StackLogGroup, depth: number, cat: StackLogCat, text: string, extra: Partial<StackLogLine> = {}): StackLogLine {
    this.batch = undefined; // anything but a trigger placement ends the batch
    this.lastDamage = undefined;
    const line: StackLogLine = { id: ++this.lineSeq, depth: Math.min(depth, 8), cat, text, ...extra };
    g.lines.push(line);
    g.stackEmpty = false;
    return line;
  }

  /** the group a line belongs to right now (a stray effect outside any group is dropped by the caller) */
  private group(): StackLogGroup | undefined { return this.cur; }

  private costText(paid: Record<string, unknown> | undefined): string {
    if (!paid) return "";
    const parts: string[] = [];
    if (typeof paid.mana === "string" && paid.mana) parts.push(`mana ${paid.mana}`);
    if (Array.isArray(paid.costs) && paid.costs.length) parts.push((paid.costs as string[]).join(", "));
    if (Array.isArray(paid.spent) && paid.spent.length) parts.push(`spent ${(paid.spent as string[]).join("")}`);
    if (num(paid.commanderTax)) parts.push(`incl. commander tax {${paid.commanderTax}}`);
    if (num(paid.life)) parts.push(`${paid.life} life`);
    if (Array.isArray(paid.sacrificed) && paid.sacrificed.length) parts.push(`sacrificed ${(paid.sacrificed as string[]).map((i) => this.C(i)).join(", ")}`);
    return parts.length ? ` (cost paid: ${parts.join("; ")})` : "";
  }

  private targetsText(ev: KernelEvent): string {
    const t = ev.targets;
    if (!Array.isArray(t)) return "";
    const ids = [...new Set((t as Array<Record<string, string[]>>).flatMap((p) => Object.values(p ?? {}).flat()))];
    return ids.length ? ` targeting ${ids.map((i) => this.who(i)).join(", ")}` : "";
  }

  private causeText(ev: KernelEvent): string {
    const e = str(ev.causeEvent);
    const verb = CAUSE_VERB[e];
    if (typeof ev.cause === "string" && ev.cause) return `because ${this.C(ev.cause)} ${verb ?? "triggered it"}`;
    if (typeof ev.causePlayer === "string" && ev.causePlayer && verb) return `because ${this.P(ev.causePlayer)} ${verb}`;
    if (e === "begin_step" || e === "end_step" || e === "upkeep") return this.phase ? `at the beginning of ${PHASE_NAME[this.phase] ?? this.phase}` : "at the beginning of a step";
    if (ev.delayed) return "a delayed trigger came due";
    return e ? `because of ${e.replace(/_/g, " ")}` : "";
  }

  private describe(ev: KernelEvent): string {
    const src = this.C(ev.source);
    const text = str(ev.text);
    return text ? `${src}: ${short(text, 90)}` : `${src}${ev.delayed && str(ev.label) ? `: ${short(str(ev.label).replace(/^[^:]*:\s*/, ""), 90)}` : "'s ability"}`;
  }

  // ------------------------------------------------------------------ events

  private onEvent(ev: KernelEvent): void {
    switch (ev.type) {
      case "turn_started": this.cur = undefined; this.batch = undefined; this.anchor = undefined; this.phase = "untap"; return;
      case "phase_changed": case "begin_step": { const p = str(ev.phase) || str(ev.step); if (p) this.phase = p; if (!this.order.length) { this.cur = undefined; this.batch = undefined; this.anchor = undefined; } return; }
      case "land_played": {
        if (this.order.length && this.cur) { this.addLine(this.cur, this.topLevel(), "spell", `${this.P(ev.player)} plays ${this.C(ev.id)}.`); return; }
        this.newGroup(`${this.P(ev.player)} plays ${this.C(ev.id)}`, "spell"); return;
      }
      case "cast": return this.onCast(ev);
      case "ability_activated": return this.onActivate(ev);
      case "spell_copied": case "ability_copied": return this.onCopy(ev);
      case "triggers_ordered": return this.onOrdered(ev);
      case "trigger_on_stack": return this.onTrigger(ev);
      case "resolving": return this.onResolving(ev);
      case "spell_resolved": return this.onResolved(ev, true);
      case "ability_resolved": return this.onResolved(ev, false);
      case "spell_countered": return this.onCountered(ev);
      case "spell_fizzled": case "trigger_fizzled": return this.onFizzled(ev);
      case "replacement_applied": return this.onReplacement(ev);
      case "unless_pay": return this.onUnless(ev);
      case "attackers_declared": {
        const n = num(ev.count) ?? 0;
        if (n > 0 && !this.order.length) this.newGroup(`${this.P(ev.player)} attacks with ${plural(n, "creature")}`, "combat");
        return;
      }
      case "combat_damage_step": { if (!this.order.length) this.newGroup(ev.which === "first" ? "First-strike combat damage" : "Combat damage", "combat"); return; }
      default: return this.onGeneric(ev);
    }
  }

  private onCast(ev: KernelEvent): void {
    const name = str(ev.name) || this.C(ev.id);
    const paid = (ev.paid ?? undefined) as Record<string, unknown> | undefined;
    const copy = ev.copy === true ? " (copy)" : "";
    const item = str(ev.item);
    const meta: ItemMeta = { kind: "spell", desc: `${name}${copy}`, level: 0, cat: "spell", lines: 0 };
    let g: StackLogGroup;
    if (!this.order.length || !this.cur) {
      g = this.newGroup(`${this.P(ev.player)} casts ${name}${copy}${this.costText(paid)}`, "spell");
      meta.level = 0;
      const from = str(ev.from);
      const head = this.addLine(g, 0, "spell", `Put on the stack${this.targetsText(ev)}${num(ev.x) ? `, X=${ev.x}` : ""}${from && from !== "hand" ? `, cast from ${from}` : ""}${Array.isArray(ev.modes) ? `, modes: ${(ev.modes as string[]).join(", ")}` : ""}.`, { item, head: true, ...(this.cardDetail(ev.id) ? { detail: this.cardDetail(ev.id) } : {}) });
      meta.head = head;
    } else {
      g = this.cur;
      meta.level = this.anchor !== undefined && this.resolving ? this.anchor : this.topLevel();
      meta.head = this.addLine(g, meta.level, "spell", `${this.P(ev.player)} casts ${name}${copy}${this.costText(paid)}${this.targetsText(ev)}${num(ev.x) ? `, X=${ev.x}` : ""}.`, { item, head: true, ...(this.cardDetail(ev.id) ? { detail: this.cardDetail(ev.id) } : {}) });
    }
    this.anchor = undefined;
    if (item) { this.items.set(item, meta); this.order.push(item); }
  }

  private onActivate(ev: KernelEvent): void {
    const item = str(ev.item);
    const paid = (ev.paid ?? undefined) as Record<string, unknown> | undefined;
    const meta: ItemMeta = { kind: "activated", desc: this.describe(ev), level: 0, cat: "spell", lines: 0 };
    const text = `${this.P(ev.player)} activates ${this.describe(ev)}${this.costText(paid)}${this.targetsText(ev)}${num(ev.x) ? `, X=${ev.x}` : ""}`;
    if (!this.order.length || !this.cur) {
      const g = this.newGroup(text, "spell");
      meta.head = this.addLine(g, 0, "spell", "Put on the stack.", { item, head: true, ...(str(ev.text) ? { detail: str(ev.text) } : {}) });
    } else {
      meta.level = this.anchor !== undefined && this.resolving ? this.anchor : this.topLevel();
      meta.head = this.addLine(this.cur, meta.level, "spell", `${text}.`, { item, head: true, ...(str(ev.text) ? { detail: str(ev.text) } : {}) });
    }
    this.anchor = undefined;
    if (item) { this.items.set(item, meta); this.order.push(item); }
  }

  private onCopy(ev: KernelEvent): void {
    const item = str(ev.item);
    const g = this.cur ?? this.newGroup("Copy put on the stack", "spell");
    const level = this.anchor !== undefined ? this.anchor : this.topLevel();
    const of = ev.type === "spell_copied" ? this.C(ev.of) : "an ability";
    const desc = ev.type === "spell_copied" ? `copy of ${this.C(ev.id)}` : `copy of ${of}${ev.source ? ` (${this.C(ev.source)})` : ""}`;
    const meta: ItemMeta = { kind: "copy", desc, level, cat: "spell", lines: 0 };
    meta.head = this.addLine(g, level, "spell", `${this.P(ev.controller)} puts a ${desc} on the stack.`, { item, head: true });
    if (item) { this.items.set(item, meta); this.order.push(item); }
  }

  private onOrdered(ev: KernelEvent): void {
    const list = Array.isArray(ev.order) ? (ev.order as Array<Record<string, unknown>>) : [];
    const g = this.cur ?? this.newGroup("Triggered abilities", "trigger");
    const text = `${this.P(ev.player)} chose the order of ${plural(list.length, "trigger")} (listed bottom to top: the first goes on the stack first and resolves last).`;
    const detail = list.map((t, i) => `${i + 1}. ${this.C(t.source)}: ${short(str(t.label).replace(/^[^:]*:\s*/, ""), 100)}`).join("\n");
    if (this.batch && this.batch.group === g) { const note = { id: ++this.lineSeq, depth: this.batch.level, cat: "trigger" as const, text, detail }; this.batch.notes.push(note); this.rebuildBatch(); return; }
    this.openBatch(g).notes.push({ id: ++this.lineSeq, depth: this.anchorLevel(), cat: "trigger", text, detail });
    this.rebuildBatch();
  }

  private anchorLevel(): number { return this.anchor !== undefined ? this.anchor : this.topLevel(); }

  private openBatch(g: StackLogGroup): Batch {
    const level = this.anchorLevel();
    const header: StackLogLine = { id: ++this.lineSeq, depth: level, cat: "trigger", text: "Triggers put on the stack" };
    const b: Batch = { start: g.lines.length, header, notes: [], items: [], level, group: g };
    this.batch = b; this.lastDamage = undefined; g.stackEmpty = false;
    return b;
  }

  private rebuildBatch(): void {
    const b = this.batch;
    if (!b) return;
    const n = b.items.length;
    b.items.forEach((it, i) => { it.meta.rank = n > 1 ? n - i : undefined; });
    b.header.text = n === 0 ? "Triggers waiting to be put on the stack" : n === 1 ? "Trigger put on the stack" : `${n} triggers put on the stack (listed in resolution order: the top of the stack resolves first)`;
    const lines = [b.header, ...b.notes, ...[...b.items].reverse().map((it) => { it.line.text = `${n > 1 ? `${it.meta.rank}. ` : ""}${it.line.text.replace(/^\d+\. /, "")}`; return it.line; })];
    b.group.lines.length = b.start;
    b.group.lines.push(...lines);
  }

  private onTrigger(ev: KernelEvent): void {
    const item = str(ev.item);
    let g = this.cur;
    if (!g) { g = this.newGroup(`Triggered abilities (${this.causeText(ev) || "triggered"})`, "trigger"); }
    if (!this.batch || this.batch.group !== g) this.openBatch(g);
    const b = this.batch!;
    const cause = this.causeText(ev);
    const depth = num(ev.depth) ?? this.order.length + 1;
    const desc = this.describe(ev);
    const text = `${desc} (${this.P(ev.controller)})${this.targetsText(ev)}${cause ? ` - ${cause}` : ""} [stack position ${depth}]${ev.ordered ? "" : ""}`;
    const meta: ItemMeta = { kind: "triggered", desc, level: b.level, cat: "trigger", lines: 0 };
    const line: StackLogLine = { id: ++this.lineSeq, depth: b.level + 1, cat: "trigger", text, item, head: true, ...(str(ev.text) ? { detail: str(ev.text) } : {}) };
    meta.head = line;
    b.items.push({ line, meta });
    if (item) { this.items.set(item, meta); this.order.push(item); }
    this.rebuildBatch();
  }

  private onResolving(ev: KernelEvent): void {
    const item = str(ev.item);
    const meta = this.items.get(item);
    const g = this.cur;
    this.batch = undefined; this.lastDamage = undefined;
    this.order = this.order.filter((i) => i !== item);
    this.resolvingItem = item;
    if (!meta || !g) { this.resolving = undefined; return; }
    this.resolving = { item, meta };
    this.anchor = meta.level + 1;
    this.addLine(g, meta.level, meta.cat, `Resolving ${meta.rank ? `${meta.rank}. ` : ""}${meta.desc}`, { item, head: true });
  }

  /** a result line of whatever is resolving (or a side effect when nothing is) */
  private result(cat: StackLogCat | undefined, text: string, extra: Partial<StackLogLine> = {}): StackLogLine | undefined {
    const g = this.cur;
    if (!g) return undefined;
    const r = this.resolving;
    if (r) r.meta.lines++;
    return this.addLine(g, r ? r.meta.level + 1 : this.anchor ?? this.topLevel(), cat ?? r?.meta.cat ?? "effect", text, { ...(r ? { item: r.item } : {}), ...extra });
  }

  private endResolving(ev: KernelEvent, text: string | undefined, cat?: StackLogCat): void {
    const r = this.resolving;
    if (text && this.cur) this.addLine(this.cur, r ? r.meta.level + 1 : this.anchor ?? 0, cat ?? r?.meta.cat ?? "spell", text, r ? { item: r.item } : {});
    const left = num(ev.left);
    if (this.cur && left === 0) { this.cur.stackEmpty = true; this.anchor = undefined; }
    if (r) this.items.delete(r.item);
    this.resolving = undefined; this.resolvingItem = undefined;
    // the anchor stays: triggers that this resolution caused nest inside it (cleared when the stack empties or something is cast)
    if (left === 0) this.anchor = r ? r.meta.level + 1 : undefined;
  }

  private onResolved(ev: KernelEvent, spell: boolean): void {
    const r = this.resolving;
    let text: string | undefined;
    if (spell) {
      const where = this.opts.where?.(str(ev.id));
      const name = this.C(ev.id);
      if (where === "battlefield") text = `${name} resolves and enters the battlefield.`;
      else if (where === "graveyard") text = `${name} resolves and goes to the graveyard.`;
      else if (where) text = `${name} resolves (now in ${where}).`;
      else text = `${name} resolves.`;
    } else if (r && r.meta.lines === 0) text = "No visible effect.";
    this.endResolving(ev, text);
  }

  private onCountered(ev: KernelEvent): void {
    const item = str(ev.item);
    const meta = this.items.get(item);
    const what = ev.ability === true ? `${this.C(ev.source)}'s ability` : this.C(ev.id);
    this.order = this.order.filter((i) => i !== item);
    this.items.delete(item);
    this.result("spell", `${what} is countered by ${this.C(ev.by)}.`);
    const left = num(ev.left);
    if (this.cur && left === 0) this.cur.stackEmpty = true;
    void meta;
  }

  private onFizzled(ev: KernelEvent): void {
    const what = ev.type === "spell_fizzled" ? this.C(ev.id) : `${this.C(ev.source)}'s trigger`;
    const why = ev.type === "trigger_fizzled" ? "its condition is no longer true" : "all of its targets are illegal";
    this.endResolving(ev, `${what} fizzles: ${why}.`);
    if (this.cur && this.order.length === 0) { this.cur.stackEmpty = true; this.anchor = undefined; }
  }

  private onReplacement(ev: KernelEvent): void {
    const src = this.C(ev.source);
    const kind = str(ev.event);
    const from = num(ev.from), to = num(ev.to);
    const sum: string[] = [];
    if (ev.cancelled === true) sum.push(kind === "damage" ? "the damage is prevented / replaced" : "the event is replaced");
    else if (from !== undefined && to !== undefined) {
      if (kind === "tokens") sum.push(`${this.P(ev.who)} creates ${plural(to, "token")} instead of ${from}${Array.isArray(ev.tokens) ? ` (${(ev.tokens as string[]).join(", ")})` : ""}`);
      else if (kind === "damage") sum.push(`${this.C(ev.dmgSource)}'s damage to ${this.who(ev.target)} becomes ${to} instead of ${from}`);
      else sum.push(`${kind.replace(/_/g, " ")} ${this.P(ev.who)}: ${from} becomes ${to}`);
    }
    if (typeof ev.toZone === "string") sum.push(`${this.C(ev.id)} goes to ${ev.toZone} instead of ${str(ev.fromZone)}`);
    if (ev.tapped === true) sum.push(`${this.C(ev.id)} enters tapped`);
    if (num(ev.counters)) sum.push(`${this.C(ev.id)} enters with ${ev.counters} counters`);
    const order = num(ev.contested) && (num(ev.contested) as number) > 1 ? ` (${ev.contested} replacement effects applied here; the order was chosen by the affected player)` : "";
    const text = `${src}'s replacement effect${sum.length ? `: ${sum.join("; ")}` : ` modifies the ${kind.replace(/_/g, " ")}`}${order}.`;
    this.result("replacement", text, str(ev.text) ? { detail: str(ev.text) } : {});
  }

  private onUnless(ev: KernelEvent): void {
    const payer = this.P(ev.payer);
    const cost = str(ev.cost) || "the cost";
    const text = ev.outcome === "paid" ? `${this.C(ev.source)}: ${payer} paid ${cost}.` : ev.outcome === "declined" ? `${this.C(ev.source)}: ${payer} declined to pay ${cost}.` : `${this.C(ev.source)}: ${payer} could not pay ${cost}.`;
    this.result(undefined, text);
  }

  private onGeneric(ev: KernelEvent): void {
    // combat damage / attack declarations without anything on the stack still form a group (their triggers follow)
    const g0 = this.cur;
    switch (ev.type) {
      case "sba_unattached": case "sba_aura_unattached": return void this.state(`${this.C(ev.id)} is put into the graveyard (not attached to anything legal).`);
      case "sba_zero_toughness": return void this.state(`${this.C(ev.id)} is put into the graveyard (toughness 0 or less).`);
      case "sba_zero_loyalty": return void this.state(`${this.C(ev.id)} is put into the graveyard (no loyalty).`);
      case "sba_zero_defense": return void this.state(`${this.C(ev.id)} is put into the graveyard (no defense).`);
      case "sba_saga_done": return void this.state(`${this.C(ev.id)} is sacrificed (final chapter done).`);
      case "player_lost": return void this.state(`${this.P(ev.player)} loses the game (${str(ev.reason).replace(/_/g, " ")}).`);
      case "destroyed": if (ev.lethalDamage === true) return void this.state(`${this.C(ev.id)} is destroyed (lethal damage).`); break;
      case "commander_to_command_zone": return void this.state(`${this.C(ev.id)} returns to the command zone.`);
      case "life_gain": case "life_loss": {
        const amount = num(ev.amount) ?? 0, life = num(ev.life);
        const p = str(ev.player);
        if (this.lastDamage && this.lastDamage.player === p && this.lastDamage.amount === amount && life !== undefined) { this.lastDamage.line.text = this.lastDamage.line.text.replace(/\.$/, ` (life ${life + amount} -> ${life}).`); this.lastDamage = undefined; return; }
        if (!g0) return;
        const verb = ev.type === "life_gain" ? "gains" : "loses";
        this.result(undefined, `${this.P(p)} ${verb} ${amount} life${life !== undefined ? ` (life ${ev.type === "life_gain" ? life - amount : life + amount} -> ${life})` : ""}.`);
        return;
      }
      case "damage": {
        const amount = num(ev.amount) ?? 0;
        if (amount <= 0) return;
        const combat = ev.combat === true;
        if (combat && !g0) this.newGroup("Combat damage", "combat");
        const target = ev.target;
        const toPlayer = typeof target === "string" && !target.startsWith("#");
        const line = this.result(combat ? "combat" : undefined, `${this.C(ev.source)} deals ${amount} ${combat ? "combat " : ""}damage to ${this.who(target)}.`);
        if (line && toPlayer) this.lastDamage = { line, player: String(target), amount };
        return;
      }
      case "blockers_declared": { const n = num(ev.count) ?? 0; if (n > 0 && this.cur?.cat === "combat") this.result("combat", `${this.P(ev.player)} blocks with ${plural(n, "creature")}.`); return; }
      case "trigger_removed": return void this.result("trigger", `${this.C(ev.source)}'s triggered ability has no legal target and is removed.`);
      case "effect_added": {
        const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
        const bits: string[] = [];
        if (num(ev.power) !== undefined || num(ev.toughness) !== undefined) bits.push(`gets ${sign(num(ev.power) ?? 0)}/${sign(num(ev.toughness) ?? 0)}`);
        if (typeof ev.grant === "string") bits.push(`gains ${ev.grant}`);
        if (typeof ev.lose === "string") bits.push(`loses ${ev.lose === "all abilities" ? "all abilities" : ev.lose}`);
        const base = ev.base as { power?: number; toughness?: number } | undefined;
        if (base) bits.push(`becomes ${base.power}/${base.toughness}`);
        const types = [...(Array.isArray(ev.addTypes) ? (ev.addTypes as string[]) : []), ...(Array.isArray(ev.setTypes) ? (ev.setTypes as string[]) : [])];
        if (types.length) bits.push(`becomes ${types.join(" ")}`);
        if (bits.length) this.result(undefined, `${this.C(ev.id)} ${bits.join(" and ")} until end of turn.`);
        return;
      }
      case "becomes_target": case "tap": case "untap": case "mana_added": case "tax_paid": case "option_chosen": case "number_chosen": case "color_chosen": case "player_chosen": case "cards_chosen": case "begin_step_done": return;
      default: break;
    }
    if (!g0) return;
    const f = formatEvent(ev, this.names);
    if (!f) return;
    const sba = ev.type === "dies" || ev.type === "destroyed";
    this.result(sba && !this.resolving ? "state" : undefined, f.message);
  }

  private state(text: string): void {
    const g = this.cur;
    if (!g) return;
    this.addLine(g, this.resolving ? this.resolving.meta.level + 1 : this.anchor ?? this.topLevel(), "state", `State-based action: ${text}`);
  }
}

/** The whole log as plain text (the bug-report export): groups with indented lines. */
export function stackLogText(groups: readonly StackLogGroup[], opts: { last?: number } = {}): string {
  const list = opts.last ? groups.slice(-opts.last) : groups;
  const out: string[] = [];
  for (const g of list) {
    out.push(g.title);
    for (const l of g.lines) out.push(`${"  ".repeat(l.depth + 1)}${l.text}`);
    if (g.stackEmpty) out.push("  Stack empty.");
  }
  return out.join("\n");
}

/** Which lines the filters leave visible (a category switched off hides its lines; the group header stays). */
export function visibleLines(g: StackLogGroup, hidden: ReadonlySet<StackLogCat>): StackLogLine[] {
  return hidden.size ? g.lines.filter((l) => !hidden.has(l.cat)) : g.lines;
}
