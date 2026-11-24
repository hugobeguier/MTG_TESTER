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
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

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
    case "token_created": return { seatId: seat(ev.player), message: `${P(ev.player)} creates ${C(ev.id)}.` };
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
    case "trigger_removed": return { message: `${C(ev.source)}'s ability has no legal target and is removed.` };
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
