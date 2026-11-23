// Token stacks (kernel mode): identical tokens on a battlefield are shown as ONE card with a count, grouped by every visible state.
// Pure: takes a GameSession, returns one where each group of 2+ mergeable permanents is replaced by a representative card carrying
// `stackCount` / `stackIds`; everything downstream (the 3D table, the inspector, the controller's intents) addresses the representative's id and the
// controller maps it back to member ids. A group of one stays the original card object, so a lone token renders exactly like any permanent.
import type { GameSession, VisibleCard } from "@/lib/types";
import { isSummoningSick } from "@/lib/summoningSickness";

/** The grouping rule is pluggable: tokens only for now (basic lands could be switched on later by returning true for them). */
export type Groupable = (card: VisibleCard) => boolean;
export const groupTokensOnly: Groupable = (card) => card.token === true && !card.commander;

/** Fields that identify a permanent, not what it looks like or what state it is in. */
const IGNORED = new Set(["id", "permanentTimestamp", "battlefieldPosition", "enteredTurn", "enteredFrom", "tokenSourceCardId", "summoningSick", "stackCount", "stackIds", "stackSelected"]);

function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : v));
}

/** Two cards with the same key look and behave the same: name, types, effective P/T inputs, abilities, colours, counters, damage, tapped / attacking / blocking, sick, phased out, owner... */
export function stackKey(card: VisibleCard): string {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(card)) if (!IGNORED.has(k) && v !== undefined && v !== false) rest[k] = v;
  rest.sick = isSummoningSick(card);
  return stable(rest);
}

const byId = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });

export interface StackIndex {
  /** representative id -> member ids (sorted; "first N by id" is the order intents use) */
  members: Map<string, string[]>;
  /** any member id -> its representative id */
  repOf: Map<string, string>;
}

export interface StackResult { session: GameSession; index: StackIndex }

export function stackSession(session: GameSession, opts: { groupable?: Groupable; keepSingle?: ReadonlySet<string> } = {}): StackResult {
  const groupable = opts.groupable ?? groupTokensOnly;
  const index: StackIndex = { members: new Map(), repOf: new Map() };
  // a permanent with anything attached to it never merges (the attachment points at one specific id)
  const hosts = new Set<string>();
  for (const seat of session.seats) for (const c of seat.board.battlefield) if (c.attachedToId) hosts.add(c.attachedToId);
  let changed = false;
  const seats = session.seats.map((seat) => {
    const groups = new Map<string, VisibleCard[]>();
    const order: Array<VisibleCard | string> = [];
    for (const card of seat.board.battlefield) {
      if (!groupable(card) || card.attachedToId || hosts.has(card.id) || opts.keepSingle?.has(card.id)) { order.push(card); continue; }
      const key = stackKey(card);
      const g = groups.get(key);
      if (g) g.push(card); else { groups.set(key, [card]); order.push(key); }
    }
    if (![...groups.values()].some((g) => g.length > 1)) return seat;
    changed = true;
    const battlefield: VisibleCard[] = [];
    const usedPositions = new Map<string, number>();
    for (const item of order) {
      if (typeof item !== "string") { battlefield.push(item); continue; }
      const g = groups.get(item)!;
      if (g.length === 1) { battlefield.push(g[0]); continue; }
      const sorted = [...g].sort((a, b) => byId(a.id, b.id));
      const ids = sorted.map((c) => c.id);
      const rep = sorted[0];
      // a dragged stack keeps its spot; split groups that share one explicit spot are fanned out sideways so they never sit on top of each other
      const pos = sorted.find((c) => c.battlefieldPosition)?.battlefieldPosition;
      let battlefieldPosition = pos;
      if (pos) { const k = `${pos.x},${pos.z}`; const n = usedPositions.get(k) ?? 0; usedPositions.set(k, n + 1); if (n) battlefieldPosition = { x: pos.x + n * 0.85, z: pos.z }; }
      battlefield.push({ ...rep, ...(battlefieldPosition ? { battlefieldPosition } : {}), stackCount: ids.length, stackIds: ids });
      index.members.set(rep.id, ids);
      for (const id of ids) index.repOf.set(id, rep.id);
    }
    return { ...seat, board: { ...seat.board, battlefield } };
  });
  return { session: changed ? { ...session, seats } : session, index };
}
