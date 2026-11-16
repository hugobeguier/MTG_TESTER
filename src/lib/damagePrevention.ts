// General damage prevention: parsing of "prevent ..." text and the pure shield arithmetic. The engine side (events, tokens, counters) lives in
// AppFlow.tsx's applyDamagePrevention, the single choke point every damage path (combat, burn, fight/bite, triggers) goes through.
import type { DamageShield, GameSession } from "@/lib/types";

export interface DamagePreventionSpec {
  /** you / target (creature, player, permanent) / it (the pumped target) / self (this creature) / creatures you control / you and creatures you control / source_target (damage BY the target). */
  scope: "you" | "target" | "it" | "self" | "controlled_creatures" | "you_and_creatures" | "source_target";
  combatOnly: boolean;
  /** "prevent the next N damage": undefined = all. */
  amount?: number;
  tokenClause?: string;
  /** The recipient phrase can also be a player ("target creature or player", "any target"). */
  allowsPlayer?: boolean;
}

export function parseDamagePrevention(rawText: string): DamagePreventionSpec | undefined {
  const text = rawText.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ");
  const tokenClause = text.match(/for each 1 damage prevented this way, (create [^.]+)/i)?.[1];
  const by = text.match(/\bprevent all (combat )?damage (?:that would be dealt by |target (?:creature|permanent) would deal)/i);
  if (by) {
    if (!/\btarget (?:creature|permanent)\b/i.test(text.slice(by.index ?? 0))) return undefined;
    return { scope: "source_target", combatOnly: Boolean(by[1]) };
  }
  const match = text.match(/\bprevent (all|the next (\d+)) (combat )?damage that would be dealt to ([^.]*?) this turn\b/i);
  if (!match) return undefined;
  const who = match[4].trim().toLowerCase();
  const base = { combatOnly: Boolean(match[3]), ...(match[2] ? { amount: Number.parseInt(match[2], 10) } : {}), ...(tokenClause ? { tokenClause } : {}) };
  if (who === "you") return { scope: "you", ...base };
  if (who === "it") return { scope: "it", ...base };
  if (who === "this creature" || who === "this permanent") return { scope: "self", ...base };
  if (/^(?:each )?creatures? you control$/.test(who)) return { scope: "controlled_creatures", ...base };
  if (/^you and (?:each |all )?(?:other )?creatures? you control$/.test(who)) return { scope: "you_and_creatures", ...base };
  if (/^(?:any target|target (?:creature|player|permanent|planeswalker)(?: or (?:player|planeswalker|creature|permanent))*)$/.test(who)) return { scope: "target", allowsPlayer: /player|any target/.test(who), ...base };
  return undefined;
}

export type DamageSubject = { kind: "player"; seatId: string } | { kind: "permanent"; seatId: string; cardId: string; isCreature: boolean };

function shieldMatches(shield: DamageShield, subject: DamageSubject, combat: boolean, sourceId: string | undefined, turn: number): boolean {
  if (shield.turn !== turn || (shield.combatOnly && !combat)) return false;
  switch (shield.protect.kind) {
    case "player":
      return subject.kind === "player" && subject.seatId === shield.protect.seatId;
    case "permanent":
      return subject.kind === "permanent" && subject.cardId === shield.protect.cardId;
    case "controlled_creatures":
      return subject.kind === "permanent" && subject.isCreature && subject.seatId === shield.protect.seatId;
    case "from_source":
      return sourceId !== undefined && sourceId === shield.protect.cardId;
  }
}

/** Runs `amount` through every matching shield in order. Depleted "next N" shields are dropped; unrelated ones are untouched. */
export function consumeDamageShields(
  shields: DamageShield[] | undefined,
  subject: DamageSubject,
  amount: number,
  combat: boolean,
  sourceId: string | undefined,
  turn: number
): { remaining: number; shields: DamageShield[]; applied: Array<{ shield: DamageShield; prevented: number }> } {
  let remaining = amount;
  const applied: Array<{ shield: DamageShield; prevented: number }> = [];
  const next: DamageShield[] = [];
  for (const shield of shields ?? []) {
    if (shield.turn !== turn) continue;
    if (remaining <= 0 || !shieldMatches(shield, subject, combat, sourceId, turn)) {
      next.push(shield);
      continue;
    }
    const prevented = Math.min(remaining, shield.amount ?? remaining);
    remaining -= prevented;
    if (prevented > 0) applied.push({ shield, prevented });
    const left = shield.amount === undefined ? undefined : shield.amount - prevented;
    if (left === undefined || left > 0) next.push({ ...shield, amount: left, preventedTotal: (shield.preventedTotal ?? 0) + prevented });
  }
  return { remaining, shields: next, applied };
}

/** One-line summaries of the live shields, for the AI's game-state view. */
export function describeDamageShields(session: GameSession): string[] {
  return (session.damageShields ?? [])
    .filter((shield) => shield.turn === session.turn)
    .map((shield) => {
      const seatName = (id: string) => session.seats.find((seat) => seat.id === id)?.name ?? id;
      const cardName = (id: string) => session.seats.flatMap((seat) => seat.board.battlefield).find((card) => card.id === id)?.name ?? "a permanent";
      const what = shield.protect.kind === "player" ? seatName(shield.protect.seatId) : shield.protect.kind === "permanent" ? cardName(shield.protect.cardId) : shield.protect.kind === "controlled_creatures" ? `creatures ${seatName(shield.protect.seatId)} controls` : `damage dealt by ${cardName(shield.protect.cardId)}`;
      const how = shield.amount === undefined ? "all" : `next ${shield.amount}`;
      return `${shield.sourceName}: prevents ${how} ${shield.combatOnly ? "combat " : ""}damage ${shield.protect.kind === "from_source" ? "" : "to "}${what} this turn.`;
    });
}
