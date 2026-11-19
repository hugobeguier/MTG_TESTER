// Damage, damage prevention and protection helpers, moved verbatim from components/AppFlow.tsx: combat/noncombat damage to creatures
// and targets, damage shields/doubling, dealt-damage triggers, evasion/keyword predicates (hasFlying, hasDeathtouch, ...), protection.
// Part of a deliberate import cycle with the other resolution modules (function declarations only).

import { applyDamagedWatchers, recordExcessDamage } from "@/engine/cardScripts";
import { strongestControlledCreature } from "@/engine/effects";
import { destroyCreatures } from "@/engine/entry";
import { hasKeyword } from "@/engine/shared";
import { createTokensForSeat, parseCreateTokenSpecs } from "@/engine/tokens";
import { commonTriggerEffect, makeCommonTrigger, resolveTriggerEffect } from "@/engine/triggers";
import { applyCounterDelta, applyCounterDeltaAtSession, rulesEvent } from "@/engine/zones";
import { effectiveToughness } from "@/lib/counters";
import type { DamagePreventionSpec, DamageSubject } from "@/lib/damagePrevention";
import { consumeDamageShields } from "@/lib/damagePrevention";
import { protectionColors as cardProtectionColors } from "@/lib/keywords";
import { oracleClauses } from "@/lib/oracleClauses";
import type { ChosenTarget } from "@/lib/targeting";
import type { DamageShield, GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

export function hasFlying(card: VisibleCard) {
  return hasKeyword(card, "flying");
}

export function hasDeathtouch(card: VisibleCard) {
  return hasKeyword(card, "deathtouch");
}

// "Prevent all damage that would be dealt to this creature." (static, any kind of damage)
function preventsAllDamageToSelf(card: VisibleCard): boolean {
  return !card.abilitiesStripped && /\bprevent all damage that would be dealt to this creature\b/i.test(card.oracleText);
}

// "You have hexproof." (Metropolis Reformer)
export function playerHasHexproof(seat: PlayerSeat): boolean {
  return seat.board.battlefield.some((card) => !card.abilitiesStripped && /^you have hexproof\b/im.test(card.oracleText));
}

// "You can't lose the game and your opponents can't win the game." (Herald of Eternal Dawn)
export function playerCantLose(seat: PlayerSeat): boolean {
  return seat.board.battlefield.some((card) => !card.abilitiesStripped && /\byou can'?t lose the game\b/i.test(card.oracleText));
}

export function hasIndestructible(card: VisibleCard) {
  return hasKeyword(card, "indestructible");
}

export function hasLifelink(card: VisibleCard) {
  return hasKeyword(card, "lifelink");
}

export function hasWither(card: VisibleCard) {
  return hasKeyword(card, "wither");
}

export function hasInfect(card: VisibleCard) {
  return hasKeyword(card, "infect");
}

export function hasHexproof(card: VisibleCard) {
  return hasKeyword(card, "hexproof");
}

export function hasShroud(card: VisibleCard) {
  return hasKeyword(card, "shroud");
}

// "Whenever a Human deals damage to you, destroy it." (Mikaeus, the Unhallowed): checked after any damage a Human source dealt to the watcher's controller.
export function applyCombatDamageToTarget(
  session: GameSession,
  sourceName: string,
  target: { seat: PlayerSeat; planeswalker?: VisibleCard },
  amount: number,
  source?: VisibleCard,
  sourceControllerSeatId?: string,
  damageKind: "combat" | "noncombat" = "combat"
): GameSession {
  if (amount <= 0) return session;
  amount *= damageDoublingFactor(session, sourceControllerSeatId, target.seat.id);
  const prevention = applyDamagePrevention(
    session,
    target.planeswalker ? { kind: "permanent", seatId: target.seat.id, cardId: target.planeswalker.id, isCreature: false } : { kind: "player", seatId: target.seat.id },
    target.planeswalker?.name ?? target.seat.name,
    amount,
    damageKind === "combat",
    sourceName,
    source
  );
  if (prevention.remaining <= 0) return prevention.session;
  session = prevention.session;
  amount = prevention.remaining;
  let next = applyCombatDamageToTargetCore(session, sourceName, target, amount, source, sourceControllerSeatId, damageKind);
  if (next !== session && damageKind === "combat" && !target.planeswalker && source && sourceControllerSeatId && amount > 0) {
    next = {
      ...next,
      seats: next.seats.map((seat) =>
        seat.id !== sourceControllerSeatId
          ? seat
          : { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === source.id ? { ...card, damagedPlayersThisTurn: Array.from(new Set([...(card.damagedPlayersThisTurn ?? []), target.seat.id])) } : card)) } }
      )
    };
  }
  if (next === session || target.planeswalker || !source || !sourceControllerSeatId || !source.typeLine.includes("Human") || amount <= 0) return next;
  const watcher = next.seats.find((seat) => seat.id === target.seat.id);
  if (!watcher || !watcher.board.battlefield.some((card) => !card.abilitiesStripped && /whenever a human deals damage to you, destroy it/i.test(card.oracleText))) return next;
  if (!next.seats.find((seat) => seat.id === sourceControllerSeatId)?.board.battlefield.some((card) => card.id === source.id)) return next;
  return destroyCreatures(next, [{ seatId: sourceControllerSeatId, cardId: source.id, message: `${source.name} is destroyed (it dealt damage to ${watcher.name}).` }], "Rules action");
}

// The single choke point for damage prevention: every damage path (combat, burn, fight/bite, triggers) runs its (already doubled) amount through
// here before anything is dealt. Returns what is left, logs what was prevented, and fires the "for each 1 damage prevented" follow-ups.
export function applyDamagePrevention(
  session: GameSession,
  subject: DamageSubject,
  subjectName: string,
  amount: number,
  combat: boolean,
  sourceName: string,
  source?: VisibleCard
): { session: GameSession; remaining: number } {
  if (amount <= 0 || !session.damageShields?.length) return { session, remaining: amount };
  const result = consumeDamageShields(session.damageShields, subject, amount, combat, source?.id, session.turn);
  if (result.applied.length === 0) return { session, remaining: amount };
  const preventedTotal = amount - result.remaining;
  let next: GameSession = { ...session, damageShields: result.shields };
  next = rulesEvent(next, subject.seatId, `${sourceName}'s ${preventedTotal} ${combat ? "combat " : ""}damage to ${subjectName} is prevented by ${result.applied.map((entry) => entry.shield.sourceName).join(" and ")}.`);
  for (const { shield, prevented } of result.applied) {
    const specs = shield.tokenClause ? parseCreateTokenSpecs(shield.tokenClause) : [];
    if (specs.length > 0) next = createTokensForSeat(next, shield.controllerSeatId, shield.sourceId, specs.map((spec) => ({ ...spec, count: prevented }))).session;
  }
  // "Whenever damage that would be dealt to you is prevented, put that many +1/+1 counters on this creature." (Selfless Squire)
  if (subject.kind === "player") {
    for (const card of next.seats.find((seat) => seat.id === subject.seatId)?.board.battlefield ?? []) {
      if (card.abilitiesStripped || !/whenever damage that would be dealt to you is prevented, put that many \+1\/\+1 counters on this creature/i.test(card.oracleText)) continue;
      next = rulesEvent(applyCounterDeltaAtSession(next, subject.seatId, card.id, "+1/+1", preventedTotal), subject.seatId, `${card.name} gets ${preventedTotal} +1/+1 counter${preventedTotal === 1 ? "" : "s"} (damage was prevented).`);
    }
  }
  return { session: next, remaining: result.remaining };
}

// Adds shields for a parsed "prevent ..." clause. `target` is what the spell/ability was aimed at (a card or a player); with none, the caster
// (or their best creature) stands in, the same fallback the other single-target resolvers use.
export function addDamageShieldsFromSpec(
  session: GameSession,
  controllerSeatId: string,
  source: { id: string; name: string },
  spec: DamagePreventionSpec,
  target?: ChosenTarget
): GameSession {
  const caster = session.seats.find((seat) => seat.id === controllerSeatId);
  const fallbackCreature = strongestControlledCreature(caster);
  const resolved: ChosenTarget | undefined = target ?? (spec.allowsPlayer || !fallbackCreature ? { kind: "player", seatId: controllerSeatId } : { kind: "card", seatId: controllerSeatId, cardId: fallbackCreature.id });
  const protects: DamageShield["protect"][] = [];
  switch (spec.scope) {
    case "you": protects.push({ kind: "player", seatId: controllerSeatId }); break;
    case "self": protects.push({ kind: "permanent", cardId: source.id }); break;
    case "controlled_creatures": protects.push({ kind: "controlled_creatures", seatId: controllerSeatId }); break;
    case "you_and_creatures": protects.push({ kind: "player", seatId: controllerSeatId }, { kind: "controlled_creatures", seatId: controllerSeatId }); break;
    case "it":
    case "target":
      if (resolved) protects.push(resolved.kind === "player" ? { kind: "player", seatId: resolved.seatId } : { kind: "permanent", cardId: resolved.cardId });
      break;
    case "source_target":
      if (resolved?.kind === "card") protects.push({ kind: "from_source", cardId: resolved.cardId });
      break;
  }
  if (protects.length === 0) return session;
  const shields: DamageShield[] = protects.map((protect, index) => ({
    id: crypto.randomUUID(),
    turn: session.turn,
    sourceId: source.id,
    sourceName: source.name,
    controllerSeatId,
    protect,
    ...(spec.combatOnly ? { combatOnly: true } : {}),
    ...(spec.amount !== undefined ? { amount: spec.amount } : {}),
    ...(spec.tokenClause && index === 0 ? { tokenClause: spec.tokenClause } : {})
  }));
  const whom = spec.scope === "you" ? "you" : spec.scope === "controlled_creatures" ? "your creatures" : spec.scope === "you_and_creatures" ? "you and your creatures" : "the target";
  return rulesEvent(
    { ...session, damageShields: [...(session.damageShields ?? []).filter((shield) => shield.turn === session.turn), ...shields] },
    controllerSeatId,
    `${source.name}: ${spec.amount === undefined ? "all" : `the next ${spec.amount}`} ${spec.combatOnly ? "combat " : ""}damage ${spec.scope === "source_target" ? "dealt by the target" : `to ${whom}`} is prevented this turn.`
  );
}

function applyCombatDamageToTargetCore(
  session: GameSession,
  sourceName: string,
  target: { seat: PlayerSeat; planeswalker?: VisibleCard },
  amount: number,
  source?: VisibleCard,
  sourceControllerSeatId?: string,
  damageKind: "combat" | "noncombat" = "combat"
): GameSession {
  if (amount <= 0) return session;

  const base: GameSession =
    source && hasLifelink(source) && sourceControllerSeatId
      ? {
          ...session,
          seats: session.seats.map((seat) => (seat.id === sourceControllerSeatId ? { ...seat, life: seat.life + amount } : seat))
        }
      : session;

  if (target.planeswalker) {
    const planeswalkerId = target.planeswalker.id;
    return {
      ...base,
      seats: base.seats.map((seat) =>
        seat.id === target.seat.id
          ? {
              ...seat,
              board: {
                ...seat.board,
                battlefield: seat.board.battlefield.map((card) => (card.id === planeswalkerId ? applyCounterDelta(card, "loyalty", -amount) : card))
              }
            }
          : seat
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: target.seat.id,
          message: `${sourceName} deals ${amount} ${damageKind === "combat" ? "combat " : ""}damage to ${target.planeswalker.name}.`,
          detail: damageKind === "combat" ? "Combat damage" : "Rules action"
        },
        ...base.events
      ]
    };
  }

  const isInfect = Boolean(source && hasInfect(source));
  // "Whenever a creature you control deals combat damage to a player, ..." (Toski, Bearer of
  // Secrets, ...) — recorded here, not matched as a generic phase trigger, specifically because this
  // is the one place that actually knows the damage landed on a player (as opposed to a planeswalker
  // or another creature) rather than merely that it's currently the combat damage step. See
  // pendingCombatDamageToPlayer's own comment for the bug this fixes.
  const combatDamageToPlayerEntry =
    damageKind === "combat" && source && sourceControllerSeatId && source.typeLine.includes("Creature")
      ? [{ seatId: sourceControllerSeatId, card: source, damagedSeatId: target.seat.id, amount }]
      : [];
  return {
    ...base,
    seats: base.seats.map((seat) =>
      seat.id === target.seat.id
        ? {
            ...seat,
            life: isInfect ? seat.life : Math.max(0, seat.life - amount),
            poison: isInfect ? (seat.poison ?? 0) + amount : seat.poison,
            commanderDamage:
              // Commander damage (the 21-damage loss condition) only tracks combat damage —
              // a spell/ability the commander happens to be the source of doesn't count.
              source?.commander && damageKind === "combat"
                ? { ...seat.commanderDamage, [source.id]: (seat.commanderDamage[source.id] ?? 0) + amount }
                : seat.commanderDamage
          }
        : seat
    ),
    pendingCombatDamageToPlayer: [...(base.pendingCombatDamageToPlayer ?? []), ...combatDamageToPlayerEntry],
    damageThisTurn: {
      turn: base.turn,
      bySeat: { ...(base.damageThisTurn?.turn === base.turn ? base.damageThisTurn.bySeat : {}), [target.seat.id]: ((base.damageThisTurn?.turn === base.turn ? base.damageThisTurn.bySeat[target.seat.id] : 0) ?? 0) + amount }
    },
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: target.seat.id,
        message: `${sourceName} deals ${amount} ${isInfect ? "infect " : ""}${damageKind === "combat" ? "combat " : ""}damage to ${target.seat.name}${isInfect ? ` (${amount} poison)` : ""}.`,
        detail: damageKind === "combat" ? "Combat damage" : "Rules action"
      },
      ...base.events
    ]
  };
}

// Non-combat direct damage to a creature (e.g. Lightning Bolt, Bedevil) — reuses the same
// lifelink/wither/infect handling as combat damage, but resolves lethality against the current
// battlefield state directly rather than through simulateBlockedCombat. Like combat damage
// elsewhere in this engine, damage isn't tracked as a persistent marked-damage counter — a
// non-lethal hit simply doesn't destroy the creature, so it "heals" at end of turn implicitly.
export function dealDamageToCreature(
  session: GameSession,
  sourceName: string,
  targetSeatId: string,
  targetCardId: string,
  amount: number,
  source?: VisibleCard,
  sourceControllerSeatId?: string
): GameSession {
  const damaged = session.seats.find((seat) => seat.id === targetSeatId)?.board.battlefield.find((card) => card.id === targetCardId);
  if (!damaged || amount <= 0) return session;
  if (preventsAllDamageToSelf(damaged)) return rulesEvent(session, targetSeatId, `${sourceName}'s damage to ${damaged.name} is prevented by ${damaged.name}.`);
  const doubled = amount * damageDoublingFactor(session, sourceControllerSeatId, targetSeatId);
  const prevention = applyDamagePrevention(session, { kind: "permanent", seatId: targetSeatId, cardId: targetCardId, isCreature: damaged.typeLine.includes("Creature") }, damaged.name, doubled, false, sourceName, source);
  if (prevention.remaining <= 0) return prevention.session;
  const result = dealDamageToCreatureCore(prevention.session, sourceName, targetSeatId, targetCardId, prevention.remaining, source, sourceControllerSeatId);
  return applyDealtDamageTriggers(result, targetSeatId, damaged, prevention.remaining);
}

// "Whenever this creature is dealt damage, ..." (Ripjaw Raptor's enrage draw, Metropolis Reformer's lifegain). Resolved on the
// spot rather than queued: the effects involved (draw, gain life) never need a choice.
export function applyDealtDamageTriggers(session: GameSession, seatId: string, card: VisibleCard, amount: number): GameSession {
  if (amount <= 0) return session;
  // Rith, Liberated Primeval reads this at the end step; Wrathful Red Dragon watches every Dragon its controller owns.
  let next = applyDamagedWatchers(recordExcessDamage(session, seatId, card, amount), seatId, card, amount);
  if (card.abilitiesStripped || card.phasedOut) return next;
  for (const clause of oracleClauses(card.oracleText)) {
    const match = clause.match(/(?:^|— )whenever this creature is dealt damage, (.+)$/i);
    if (!match) continue;
    const effectText = match[1].replace(/\([^)]*\)/g, "").trim();
    if (/^you gain that much life\.?$/i.test(effectText)) {
      next = rulesEvent({ ...next, seats: next.seats.map((seat) => (seat.id === seatId ? { ...seat, life: seat.life + amount } : seat)) }, seatId, `${card.name}: gains its controller ${amount} life.`);
      continue;
    }
    const effect = commonTriggerEffect(effectText, "clause");
    if (!effect) continue;
    next = resolveTriggerEffect(next, makeCommonTrigger(seatId, seatId, card, effect, `${card.name} was dealt damage.`));
  }
  return next;
}

// Damage that doesn't kill stays marked on the creature until cleanup, so a second hit the same turn can finish it.
export function markDamageOnCard(seats: GameSession["seats"], seatId: string, cardId: string, amount: number): GameSession["seats"] {
  if (amount <= 0) return seats;
  return seats.map((seat) =>
    seat.id !== seatId ? seat : { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === cardId ? { ...card, damage: (card.damage ?? 0) + amount } : card)) } }
  );
}

// "If a source you control would deal damage to an opponent or a permanent an opponent controls, it deals double that damage instead." (Twinflame Tyrant) —
// each such permanent doubles once more.
export function damageDoublingFactor(session: GameSession, sourceControllerSeatId: string | undefined, targetSeatId: string): number {
  if (!sourceControllerSeatId || sourceControllerSeatId === targetSeatId) return 1;
  const controller = session.seats.find((seat) => seat.id === sourceControllerSeatId);
  const doublers = (controller?.board.battlefield ?? []).filter((card) => !card.abilitiesStripped && /if a source you control would deal damage to an opponent or a permanent an opponent controls, it deals double that damage instead/i.test(card.oracleText)).length;
  return 2 ** doublers;
}

function dealDamageToCreatureCore(
  session: GameSession,
  sourceName: string,
  targetSeatId: string,
  targetCardId: string,
  amount: number,
  source?: VisibleCard,
  sourceControllerSeatId?: string
): GameSession {
  if (amount <= 0) return session;
  const targetSeat = session.seats.find((seat) => seat.id === targetSeatId);
  const target = targetSeat?.board.battlefield.find((card) => card.id === targetCardId);
  if (!targetSeat || !target) return session;

  const base: GameSession =
    source && hasLifelink(source) && sourceControllerSeatId
      ? {
          ...session,
          seats: session.seats.map((seat) => (seat.id === sourceControllerSeatId ? { ...seat, life: seat.life + amount } : seat))
        }
      : session;

  // Wither/infect sources mark the damage as -1/-1 counters instead of normal damage (rule 702.90/120.3c).
  if (source && (hasWither(source) || hasInfect(source))) {
    return {
      ...base,
      seats: base.seats.map((seat) =>
        seat.id === targetSeatId
          ? {
              ...seat,
              board: {
                ...seat.board,
                battlefield: seat.board.battlefield.map((card) => (card.id === targetCardId ? applyCounterDelta(card, "-1/-1", amount) : card))
              }
            }
          : seat
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: targetSeatId,
          message: `${sourceName} deals ${amount} damage to ${target.name} (-${amount}/-${amount} in -1/-1 counters).`,
          detail: "Rules action"
        },
        ...base.events
      ]
    };
  }

  const isLethal = !hasIndestructible(target) && ((target.damage ?? 0) + amount >= effectiveToughness(target) || Boolean(source && hasDeathtouch(source)));
  const withEvent: GameSession = {
    ...base,
    seats: isLethal ? base.seats : markDamageOnCard(base.seats, targetSeatId, targetCardId, amount),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: targetSeatId,
        message: `${sourceName} deals ${amount} damage to ${target.name}.`,
        detail: "Rules action"
      },
      ...base.events
    ]
  };

  if (!isLethal) return withEvent;

  return destroyCreatures(
    withEvent,
    [{ seatId: targetSeatId, cardId: targetCardId, message: `${target.name} is destroyed by ${amount} damage from ${sourceName}.` }],
    "Rules action"
  );
}

export const PROTECTION_COLOR_CODE: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };

// A permanent's own printed protection plus whatever protection an attached Aura/Equipment
// grants it (e.g. Sword of Fire and Ice's "protection from red and from blue").
export function allProtectionColors(card: VisibleCard): string[] {
  return Array.from(new Set([...cardProtectionColors(card.oracleText), ...(card.grantedProtectionColors ?? [])]));
}

export function isProtectedFrom(protectedCard: VisibleCard, sourceCard: VisibleCard): boolean {
  const colors = allProtectionColors(protectedCard);
  if (colors.length === 0) return false;
  return colors.some((color) => sourceCard.colors.includes(PROTECTION_COLOR_CODE[color]));
}
