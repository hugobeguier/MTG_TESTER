// Kernel events -> the legacy game-log lines (GameEvent { id, at, seatId, message, detail }) the table's log panel shows.
// Input events are ALREADY filtered for the viewer (eventsFor): a hidden draw has no card, a hidden zone change has no id, so the text can only
// name what that viewer may know. Names of objects come from the viewer's redacted state view (an object the viewer cannot see is "a card").
import type { GameEvent as KernelEvent, GameState } from "../engine/types";
import type { GameEvent as LogLine } from "../../lib/types";
import type { PlayerView } from "../engine/view";
import { displayTurnNumber } from "../../lib/turnNumber";

export interface LogNames { card(id: string | undefined): string; player(id: string | undefined): string; /** seats at the table (turn lines show the round number when known) */ seatCount?: number }

export function namesFrom(view: Pick<PlayerView, "objects" | "players">): LogNames {
  const players = new Map(view.players.map((p) => [p.id, p.name]));
  return {
    card: (id) => (id && view.objects[id] ? view.objects[id].token?.name ?? view.objects[id].cardName : "a card"),
    player: (id) => (id ? players.get(id) ?? id : "someone"),
    seatCount: view.players.length
  };
}

/** Names as `viewer` may know them, straight from the full state (same visibility rules as viewFor, without cloning the state). */
export function namesForViewer(state: GameState, viewer: string): LogNames {
  const players = new Map(state.players.map((p) => [p.id, p.name]));
  return {
    card: (id) => {
      const o = id ? state.objects[id] : undefined;
      if (!o) return "a card";
      if ((o.zone === "hand" || o.zone === "library") && o.owner !== viewer) return "a card";
      if (o.faceDown && o.owner !== viewer && o.controller !== viewer) return "a card";
      return o.token?.name ?? o.cardName;
    },
    player: (id) => (id ? players.get(id) ?? id : "someone"),
    seatCount: state.players.length
  };
}

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const short = (s: string, n: number): string => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export const CAUSE_VERB: Record<string, string> = {
  etb: "entered the battlefield", dies: "died", leaves: "left the battlefield", cast: "was cast", attack: "attacked", block: "blocked", draw: "drew", discard: "discarded",
  gain_life: "gained life", lose_life: "lost life", sacrifice: "was sacrificed", becomes_target: "became a target", unlock_door: "had a door unlocked", token_created: "was created", counter_put: "got a counter",
  deals_damage: "dealt damage", deals_combat_damage_to_player: "dealt combat damage to a player", dealt_damage: "was dealt damage"
};

/**
 * The line for a triggered ability removed on resolution because its intervening "if" is no longer true (CR 603.4), shared with the action log:
 * "Archaeomancer's Map (because Island entered): condition no longer true on resolution (Sable controls 4 lands, you control 4): no effect."
 */
export function conditionLostText(ev: KernelEvent, names: LogNames): string {
  const C = (id: unknown) => names.card(typeof id === "string" ? id : undefined);
  const P = (id: unknown) => names.player(typeof id === "string" ? id : undefined);
  const verb = CAUSE_VERB[str(ev.causeEvent)] ?? "triggered it";
  const why = typeof ev.cause === "string" && ev.cause ? ` (because ${C(ev.cause)} ${verb})` : typeof ev.causePlayer === "string" && ev.causePlayer ? ` (because ${P(ev.causePlayer)} ${verb})` : "";
  const f = ev.facts as { op?: string; left?: { n: number; player?: string; what?: string }; right?: { n: number; player?: string; what?: string } } | undefined;
  const side = (x: { n: number; player?: string; what?: string } | undefined) => (x ? (x.player ? `${P(x.player)} ${P(x.player).toLowerCase() === "you" ? "control" : "controls"} ${x.n}${x.what ? ` ${x.what}` : ""}` : `${x.n}`) : "");
  const clause = /\b(if [^,.;]+)/i.exec(str(ev.text))?.[1];
  const detail = f?.left && f.right ? ` (${side(f.left)}, ${side(f.right)})` : clause ? ` (${short(clause, 80)})` : "";
  return `${C(ev.source)}${why}: condition no longer true on resolution${detail}: no effect.`;
}

/** Debug mode only: a trigger that did not go on the stack because its intervening "if" was false when the event happened (CR 603.4). */
export function conditionNotTriggeredText(ev: KernelEvent, names: LogNames): string {
  return conditionLostText(ev, names).replace(": condition no longer true on resolution", " did not trigger: its condition was false when the event happened").replace(/: no effect\.$/, ".");
}

/** One log line, or undefined for events that are bookkeeping (phase changes, taps, mana, effects). */
export function formatEvent(ev: KernelEvent, n: LogNames): { seatId?: string; message: string; detail?: string } | undefined {
  const seat = (id: unknown) => (typeof id === "string" ? id : undefined);
  const P = (id: unknown) => n.player(seat(id));
  const C = (id: unknown) => n.card(seat(id));
  switch (ev.type) {
    // the number players see (rounds), as the legacy log words it; the kernel's own count is one per player's turn
    case "turn_started": return { seatId: seat(ev.player), message: `Turn ${n.seatCount ? displayTurnNumber(num(ev.turn), n.seatCount) : num(ev.turn)}: ${P(ev.player)}'s turn begins.` };
    case "land_played": return { seatId: seat(ev.player), message: `${P(ev.player)} plays ${C(ev.id)}.` };
    case "cast": return { seatId: seat(ev.player), message: `${P(ev.player)} casts ${str(ev.name) || C(ev.id)}.` };
    case "ability_activated": return { seatId: seat(ev.player), message: `${P(ev.player)} activates an ability of ${C(ev.source)}.` };
    case "spell_resolved": return { seatId: seat(ev.player), message: `${C(ev.id)} resolves.` };
    case "spell_countered": return { seatId: seat(ev.controller), message: `${C(ev.id)} is countered.` };
    case "spell_fizzled": return { message: `${C(ev.id)} fizzles (no legal target).` };
    case "etb": return ev.from === "stack" ? undefined : { seatId: seat(ev.player), message: `${C(ev.id)} enters the battlefield.` };
    case "token_created": { const nm = str(ev.name) || C(ev.id); return { seatId: seat(ev.player), message: ev.copy === true ? `${P(ev.player)} creates a token copy of ${nm}.` : `${P(ev.player)} creates ${nm}.` }; }
    case "dies": return { seatId: seat(ev.player), message: `${str((ev.lki as { name?: string } | undefined)?.name) || C(ev.id)} dies.` };
    case "destroyed": return { message: `${C(ev.id)} is destroyed.` };
    case "exiled": return { message: `${C(ev.id)} is exiled.` };
    case "bounced": return { message: `${C(ev.id)} returns to its owner's hand.` };
    case "sacrificed": return { seatId: seat(ev.player), message: `${P(ev.player)} sacrifices ${C(ev.id)}.` };
    case "discard": return { seatId: seat(ev.player), message: `${P(ev.player)} discards ${C(ev.id)}.` };
    case "mill": return { seatId: seat(ev.player), message: `${P(ev.player)} mills ${C(ev.id)}.` };
    case "draw": return { seatId: seat(ev.player), message: ev.hidden || !ev.id ? `${P(ev.player)} draws a card.` : `${P(ev.player)} draws ${C(ev.id)}.` };
    case "draw_failed": return { seatId: seat(ev.player), message: `${P(ev.player)} cannot draw (empty library).` };
    case "life_gain": return { seatId: seat(ev.player), message: `${P(ev.player)} gains ${num(ev.amount)} life.` };
    case "life_loss": return { seatId: seat(ev.player), message: `${P(ev.player)} loses ${num(ev.amount)} life.` };
    case "damage": return num(ev.amount) > 0 ? { message: `${C(ev.source)} deals ${num(ev.amount)} damage to ${typeof ev.target === "string" && ev.target.startsWith("#") ? C(ev.target) : P(ev.target)}${ev.combat ? " (combat)" : ""}.` } : undefined;
    case "attackers_declared": return num(ev.count) > 0 ? { seatId: seat(ev.player), message: `${P(ev.player)} attacks with ${plural(num(ev.count), "creature")}.` } : { seatId: seat(ev.player), message: `${P(ev.player)} does not attack.` };
    case "blockers_declared": return num(ev.count) > 0 ? { seatId: seat(ev.player), message: `${P(ev.player)} blocks with ${plural(num(ev.count), "creature")}.` } : undefined;
    case "counter_added": return { message: `${plural(num(ev.amount), `${str(ev.kind)} counter`)} put on ${C(ev.id)}.` };
    case "reveal": return { seatId: seat(ev.player), message: `${P(ev.player)} reveals ${Array.isArray(ev.names) ? (ev.names as string[]).join(", ") : "a card"}.` };
    case "looked_at": return { seatId: seat(ev.player), message: `You look at ${Array.isArray(ev.names) ? (ev.names as string[]).join(", ") : "a card"}.` };
    case "search_auto": {
      // "Archaeomancer's Map: put 2 Plains into your hand" (interchangeable cards are taken without a question); other seats see the count only
      const nm = Array.isArray(ev.names) ? (ev.names as string[]) : [];
      const count = num(ev.count);
      const groups = new Map<string, number>();
      for (const x of nm) groups.set(x, (groups.get(x) ?? 0) + 1);
      const what = nm.length ? [...groups].map(([x, k]) => (k > 1 ? `${k} ${x}` : x)).join(", ") : plural(count, "card");
      const mine = !ev.other;
      const dest = ev.to === "hand" ? (mine ? "into your hand" : "into their hand") : ev.to === "battlefield" ? "onto the battlefield" : `into ${str(ev.to) || "play"}`;
      const src = str(ev.source) ? `${C(ev.source)}: ` : "";
      return { seatId: seat(ev.player), message: count ? `${src}${mine ? "put" : `${P(ev.player)} puts`} ${what} ${dest}.` : `${src}no card found.` };
    }
    case "shuffle": return { seatId: seat(ev.player), message: `${P(ev.player)} shuffles their library.` };
    case "monarch_changed": return { seatId: seat(ev.player), message: `${P(ev.player)} becomes the monarch.` };
    case "control_changed": return { message: `${P(ev.to)} gains control of ${C(ev.id)}.` };
    case "commander_to_command_zone": return { message: `${C(ev.id)} returns to the command zone.` };
    case "transformed": return { message: `${C(ev.id)} transforms.` };
    case "cast_cancelled": return { seatId: seat(ev.player), message: `${P(ev.player)} cancels casting ${C(ev.id)}.` };
    case "player_lost": return { seatId: seat(ev.player), message: `${P(ev.player)} loses the game (${str(ev.reason).replace(/_/g, " ")}).` };
    case "game_over": return { message: ev.winner ? `Game over: ${P(ev.winner)} wins.` : "Game over: the game is a draw." };
    case "loop_detected": return { message: str(ev.message) || "The game is a draw: a mandatory loop never ends." };
    case "extra_turn_added": return { seatId: seat(ev.player), message: `${P(ev.player)} takes an extra turn.` };
    case "die_rolled": return { seatId: seat(ev.player), message: `${P(ev.player)} rolls a d${num(ev.sides)}: ${num(ev.result)}.` };
    case "unresolved":
      // continue mode: a part of a card the kernel could not resolve (public; a card in a hidden zone is nameless, see eventsFor)
      return { seatId: seat(ev.player), message: str(ev.message) || "A card could not be fully resolved.", detail: "Unresolved" };
    // a free cast ("cast it without paying") that could not start; public text only (the card is in a public zone, a face-down one shows as such)
    case "cast_now_failed": return { seatId: seat(ev.player), message: `Could not cast ${C(ev.id)}${ev.code === "illegal_target" ? ": no legal target" : str(ev.reason) ? `: ${str(ev.reason)}` : ""}.` };
    // debug mode (sandbox.ts): every debug action and the switch itself are public lines, marked so a bug report shows them
    case "sandbox": return { seatId: seat(ev.player), message: str(ev.text) || "Debug: a debug action was used.", detail: "Debug" };
    case "sandbox_mode": return { seatId: seat(ev.player), message: str(ev.text) || "Debug mode switched.", detail: "Debug" };
    // CR 603.4: an intervening "if" that is no longer true on resolution: the ability is removed and does nothing (said for EACH such trigger, never silently)
    case "trigger_fizzled": return { seatId: seat(ev.controller), message: conditionLostText(ev, n) };
    case "nothing_to_choose": return { seatId: seat(ev.player), message: `${C(ev.source)}: ${P(ev.player)} has no ${str(ev.zone) === "hand" ? "card in their hand" : str(ev.zone) ? `card in their ${str(ev.zone)}` : "legal choice"} to choose: nothing happens.` };
    case "may_declined": return { seatId: seat(ev.player), message: `${P(ev.player)} chooses not to (${C(ev.source)}).` };
    case "trigger_not_triggered": return { seatId: seat(ev.controller), message: `Debug: ${conditionNotTriggeredText(ev, n)}`, detail: "Debug" };
    case "delayed_trigger_created": return { seatId: seat(ev.controller), message: `Delayed trigger created: ${str(ev.label) || `${C(ev.source)}: a delayed effect`}.` };
    case "trigger_removed": return { message: `${C(ev.source)}'s ability has no legal target and is removed.` };
    // a card returned to its owner's hand from the graveyard / exile (Heliod's ETB, Regrowth effects): no other event says so ("bounced" is the battlefield case)
    case "zone_change": if (ev.to === "command") return { seatId: seat(ev.owner), message: `${C(ev.id)} is put into the command zone.` }; return ev.to === "hand" && (ev.from === "graveyard" || ev.from === "exile") && !ev.hidden ? { seatId: seat(ev.owner), message: `${C(ev.id)} returns from the ${str(ev.from)} to ${P(ev.owner)}'s hand.` } : undefined;
    default: return undefined;
  }
}

/** Format a batch (oldest first) into log lines (oldest first); ids are `<prefix><n>`. */
export function formatEvents(events: readonly KernelEvent[], names: LogNames, idPrefix: string, startAt: number, at = ""): LogLine[] {
  const out: LogLine[] = [];
  let n = startAt;
  for (const ev of events) {
    const f = formatEvent(ev, names);
    if (!f) continue;
    out.push({ id: `${idPrefix}${n++}`, at, ...(f.seatId ? { seatId: f.seatId } : {}), message: f.message, ...(f.detail ? { detail: f.detail } : {}) });
  }
  return out;
}
