// Shared sink format for "Couldn't resolve" records: the legacy engine writes one per effect clause it could not apply, the kernel will write
// one per unsupported capability (policy: log what it couldn't resolve and keep playing). Pure module (no node imports), so client code can use it;
// the disk append lives in unresolvedLogFile.ts and the POST route in app/api/dev/unresolved/route.ts.

export const UNRESOLVED_ENGINES = ["legacy", "kernel"] as const;
export type UnresolvedEngine = (typeof UNRESOLVED_ENGINES)[number];
export const UNRESOLVED_SEAT_KINDS = ["human", "agent"] as const;
export const UNRESOLVED_LOG_RELATIVE_PATH = "data/observer/live-unresolved.jsonl";

export interface UnresolvedRecord {
  cardName: string;
  clause: string;
  /** What was being resolved: spell, etb, trigger, saga_chapter, loyalty_ability, activated_ability, ... */
  abilityKind: string;
  engine: UnresolvedEngine;
  decks: string[];
  turn: number;
  phase: string;
  seatKind: "human" | "agent";
  at: string;
  gameId: string;
}

const MAX_NAME = 120;
const MAX_CLAUSE = 600;
const MAX_KIND = 40;
const MAX_DECKS = 6;

function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  // Collapse control characters/newlines so one record is always one JSON line's worth of plain text.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : undefined;
}

/** Strict validation: unknown fields are dropped, oversize strings truncated, anything malformed returns undefined. */
export function validateUnresolvedPayload(input: unknown, now: () => string = () => new Date().toISOString()): UnresolvedRecord | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;
  const cardName = cleanString(raw.cardName, MAX_NAME);
  const clause = cleanString(raw.clause, MAX_CLAUSE);
  const abilityKind = cleanString(raw.abilityKind, MAX_KIND);
  const gameId = cleanString(raw.gameId, MAX_NAME);
  const phase = cleanString(raw.phase, MAX_NAME);
  if (!cardName || !clause || !abilityKind || !gameId || !phase) return undefined;
  const engine = raw.engine === undefined ? "legacy" : (UNRESOLVED_ENGINES as readonly unknown[]).includes(raw.engine) ? (raw.engine as UnresolvedEngine) : undefined;
  if (!engine) return undefined;
  const seatKind = (UNRESOLVED_SEAT_KINDS as readonly unknown[]).includes(raw.seatKind) ? (raw.seatKind as "human" | "agent") : undefined;
  if (!seatKind) return undefined;
  const turn = typeof raw.turn === "number" && Number.isInteger(raw.turn) && raw.turn >= 0 && raw.turn < 100000 ? raw.turn : undefined;
  if (turn === undefined) return undefined;
  const decks = Array.isArray(raw.decks) ? raw.decks.map((d) => cleanString(d, MAX_NAME)).filter((d): d is string => d !== undefined).slice(0, MAX_DECKS) : [];
  const providedAt = typeof raw.at === "string" && !Number.isNaN(Date.parse(raw.at)) ? new Date(raw.at).toISOString() : now();
  return { cardName, clause, abilityKind, engine, decks, turn, phase, seatKind, at: providedAt, gameId };
}

export function unresolvedDedupeKey(record: Pick<UnresolvedRecord, "gameId" | "cardName" | "clause">): string {
  return `${record.gameId}\u0001${record.cardName.toLowerCase()}\u0001${record.clause.toLowerCase()}`;
}

/** Remembers keys it has seen (bounded) so a retried clause is written once per game+card+clause. */
export class UnresolvedDeduper {
  private seen = new Set<string>();
  constructor(private readonly limit = 5000) {}
  /** True when the record is new (and is now remembered). */
  admit(record: Pick<UnresolvedRecord, "gameId" | "cardName" | "clause">): boolean {
    const key = unresolvedDedupeKey(record);
    if (this.seen.has(key)) return false;
    if (this.seen.size >= this.limit) this.seen.clear();
    this.seen.add(key);
    return true;
  }
}

export function unresolvedLoggingEnabled(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV !== "production" && env.MTG_UNRESOLVED_LOG !== "0";
}

/** Client side, fire-and-forget: never throws, never blocks the game. */
export function postUnresolved(record: UnresolvedRecord): void {
  try {
    if (typeof fetch !== "function") return;
    void fetch("/api/dev/unresolved", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(record), keepalive: true }).catch(() => undefined);
  } catch {
    /* logging must never reach the game */
  }
}
