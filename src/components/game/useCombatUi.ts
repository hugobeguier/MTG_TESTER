// Combat UI handlers: declaring attackers (human + agent entry points), choosing blockers, confirming/passing blocks.
// Part of the AppFlow() split: shared state arrives through `ctx` (see ./context.ts); handlers owned by other hooks are called through `lateFn` so every hook sees the current render's functions.
import { type GameSession } from "@/lib/types";
import { annihilatorAmount } from "@/lib/keywords";
import { applyMetalcraftAttackDebuff, assignBlockers, attackLockedOut, canAttack, hasVigilance, resolveAttackTarget, resolveHumanUnblockedDamage, totalAttackTax } from "@/engine/combat";
import { attackTriggerManaHeuristicSplit, chooseManaSourcesForCost, payCostFromPool, spendManaSources } from "@/engine/mana";
import { chooseAnnihilatorSacrifices, seatVerb } from "@/engine/abilities";
import { createTokensForSeat, parseCreateTokenSpecs } from "@/engine/tokens";
import { destroyCreatures } from "@/engine/entry";
import { effectivePower } from "@/lib/counters";
import { findBreenaAttackTriggers, parseMetalcraftAttackDebuff } from "@/engine/triggerFinders";
import { genericCostShim } from "@/engine/effects";
import { hasCardType } from "@/lib/typeGrants";
import { isAttackTriggerAddManaClause, oracleClauses } from "@/lib/oracleClauses";
import { phaseEvent, resolveTriggerEffect } from "@/engine/triggers";
import { type GameContext, lateFn } from "./context";

export function useCombatUi(ctx: GameContext) {
  const { setSession, activeSeatId, setInspectedCard, humanSeat } = ctx;
  const { setPendingRuleChoice, blockChoice, setBlockChoice, selectedBlockerIds, setSelectedBlockerIds } = ctx.choices;
  const { pendingAction } = ctx.stack;
  const addRestrictedManaBatch = lateFn(ctx, "addRestrictedManaBatch");
  const clearManaContributions = lateFn(ctx, "clearManaContributions");
  const poolForSeat = lateFn(ctx, "poolForSeat");
  const setSeatManaPool = lateFn(ctx, "setSeatManaPool");

  function declareAttack(session: GameSession, seatId: string, cardId: string | undefined, targetId: string | undefined): GameSession {
    const attacker = session.seats.find((seat) => seat.id === seatId);
    if (!attacker) return session;
    const attackingCard = attacker.board.battlefield.find((card) => card.id === cardId && canAttack(card, attacker.board.battlefield) && !attackLockedOut(session, card));
    const target = resolveAttackTarget(session, targetId);

    if (!attackingCard || !target) {
      return {
        ...session,
        events: [phaseEvent(seatId, seatVerb(attacker, `${attacker.name} declares no attackers.`, "You declare no attackers.")), ...session.events]
      };
    }

    const targetLabel = target.planeswalker ? `${target.planeswalker.name} (${target.seat.name})` : target.seat.name;
    const tax = totalAttackTax(target.seat, Boolean(target.planeswalker));
    const taxCard = genericCostShim(tax);
    // Prefer whatever the attacker (a human) has already manually tapped into their floating pool —
    // same pool-first-then-auto-tap preference as every other cost in this engine, so choosing which
    // specific lands pay an attack tax actually works instead of always auto-tapping invisibly.
    const attackerPool = attacker.kind === "human" ? poolForSeat(seatId) : undefined;
    const taxPoolPayment = tax > 0 && attackerPool ? payCostFromPool(attackerPool, taxCard, tax) : undefined;
    const payment = tax > 0 ? (taxPoolPayment?.ok ? taxPoolPayment : chooseManaSourcesForCost(attacker, taxCard, tax, undefined, session.seats)) : undefined;
    if (tax > 0 && !payment?.ok) {
      return {
        ...session,
        events: [
          phaseEvent(
            seatId,
            seatVerb(
              attacker,
              `${attacker.name} cannot attack ${targetLabel} with ${attackingCard.name}: unable to pay the {${tax}} attack tax.`,
              `You cannot attack ${targetLabel} with ${attackingCard.name}: unable to pay the {${tax}} attack tax.`
            )
          ),
          ...session.events
        ]
      };
    }
    if (taxPoolPayment?.ok) {
      setSeatManaPool(seatId, taxPoolPayment.pool);
      clearManaContributions(seatId);
    }

    const staysUntapped = hasVigilance(attackingCard);
    const taxedAttacker = payment?.ok && !taxPoolPayment?.ok ? spendManaSources(attacker, payment.sourceIds) : attacker;

    const attackDeclaredSession: GameSession = {
      ...session,
      attackPool: session.attackPool?.turn === session.turn ? session.attackPool : { turn: session.turn, ids: attacker.board.battlefield.map((card) => card.id) },
      // Drained by the pendingAttackDeclarations effect, which queues this attacker's "whenever ... attacks"
      // triggers (and any watcher's, e.g. Marchesa's Decree on the defending player's side).
      pendingAttackDeclarations: [...(session.pendingAttackDeclarations ?? []), { seatId, card: { ...attackingCard, attacking: true }, defendingSeatId: target.seat.id }],
      seats: session.seats.map((seat) =>
        seat.id === seatId
          ? {
              ...taxedAttacker,
              board: {
                ...taxedAttacker.board,
                battlefield: taxedAttacker.board.battlefield.map((card) =>
                  card.id === attackingCard.id
                    ? { ...card, attacking: true, tapped: staysUntapped ? card.tapped : true, attackTargetId: target.planeswalker?.id ?? target.seat.id }
                    : card
                )
              }
            }
          : seat
      ),
      events: [
        phaseEvent(
          seatId,
          seatVerb(
            attacker,
            `${attacker.name} attacks ${targetLabel} with ${attackingCard.name}${tax > 0 ? ` after paying {${tax}} for the attack tax` : ""}.`,
            `You attack ${targetLabel} with ${attackingCard.name}${tax > 0 ? ` after paying {${tax}} for the attack tax` : ""}.`
          )
        ),
        ...session.events
      ]
    };

    // Klauth, Unrivaled Ancient: "Whenever ~ attacks, add X mana in any combination of colors,
    // where X is the total power of attacking creatures. Spend this mana only to cast spells. Until
    // end of turn, you don't lose this mana as steps and phases end." X is read off THIS seat's
    // currently-attacking creatures at the moment this specific attack is declared — this engine
    // declares attackers one at a time (not as one simultaneous batch the way real Magic's declare-
    // attackers step works), so if Klauth isn't the last attacker declared this combat, X undercounts
    // the eventual full attacking party; a real, disclosed simplification rather than a rules-perfect
    // model. A human gets a real choice of how to split X across colors (distribute_attack_trigger_
    // mana); an agent gets an immediate heuristic split (see attackTriggerManaHeuristicSplit).
    if (isAttackTriggerAddManaClause(attackingCard.oracleText)) {
      const attackerSeatAfterDeclare = attackDeclaredSession.seats.find((item) => item.id === seatId);
      const totalAttackingPower = (attackerSeatAfterDeclare?.board.battlefield ?? [])
        .filter((permanent) => permanent.attacking)
        .reduce((total, permanent) => total + effectivePower(permanent), 0);
      if (totalAttackingPower > 0) {
        if (attacker.kind === "human") {
          window.setTimeout(
            () =>
              setPendingRuleChoice({
                id: crypto.randomUUID(),
                kind: "distribute_attack_trigger_mana",
                controllerSeatId: seatId,
                sourceCardId: attackingCard.id,
                sourceCardName: attackingCard.name,
                prompt: `${attackingCard.name}: distribute ${totalAttackingPower} mana among any combination of colors.`,
                amount: totalAttackingPower
              }),
            0
          );
        } else {
          addRestrictedManaBatch(seatId, attackingCard.name, attackTriggerManaHeuristicSplit(attacker, totalAttackingPower));
        }
      }
    }

    // "Metalcraft — Whenever this creature attacks, if you control three or more artifacts,
    // creatures your opponents control lose all abilities and have base power and toughness N/N
    // until end of turn." (Vedalken Humiliator) — checked directly here for the same reason as the
    // "whenever you attack a player" block just below: this needs to know exactly which creature is
    // attacking and who its controller's opponents are, which the generic "declare attackers step"
    // phase-trigger sweep (fires once per phase entry regardless of which creature is actually
    // attacking, with no concept of "this creature" or "your opponents") can't express — reported
    // live as it debuffing the attacker's own creatures instead of the opponents'.
    const metalcraftDebuff = parseMetalcraftAttackDebuff(attackingCard.oracleText);
    const controlsThreeOrMoreArtifacts = taxedAttacker.board.battlefield.filter((card) => hasCardType(card, "Artifact")).length >= 3;
    const metalcraftDebuffedSession =
      metalcraftDebuff && controlsThreeOrMoreArtifacts
        ? applyMetalcraftAttackDebuff(attackDeclaredSession, seatId, attackingCard.name, metalcraftDebuff)
        : attackDeclaredSession;

    // "Whenever you attack a player, EFFECT" (Soaring Lightbringer's token creation, ...) — a
    // genuinely different trigger family from the phase-based triggers this engine already models:
    // hasPhaseTrigger's "declare attackers step" match only fires once per phase entry (not once per
    // individual attack declared) and doesn't distinguish attacking a player from attacking a
    // planeswalker, so it was never actually wired up anywhere. Checked directly here, the one place
    // that already knows an attack against a PLAYER specifically (not a planeswalker) was just
    // declared. Scoped to token-creation effects only (the only shape this card pool needs); other
    // effect kinds are declined rather than guessed at.
    let attackTriggeredSession = metalcraftDebuffedSession;
    if (!target.planeswalker) {
      for (const source of taxedAttacker.board.battlefield) {
        if (source.abilitiesStripped || source.phasedOut) continue;
        const attackEffectClause = oracleClauses(source.oracleText)
          .map((clause) => clause.match(/^whenever you attack an? player,\s*(.+)$/i))
          .find((match): match is RegExpMatchArray => match !== null)?.[1];
        if (!attackEffectClause) continue;
        const tokenSpecs = parseCreateTokenSpecs(attackEffectClause);
        if (tokenSpecs.length === 0) continue;
        const created = createTokensForSeat(attackTriggeredSession, seatId, source.id, tokenSpecs);
        const createdTokenIds = new Set(created.createdTokens.map((token) => token.id));
        attackTriggeredSession = {
          ...created.session,
          seats: created.session.seats.map((seat) =>
            seat.id === seatId
              ? {
                  ...seat,
                  board: {
                    ...seat.board,
                    battlefield: seat.board.battlefield.map((card) =>
                      createdTokenIds.has(card.id) ? { ...card, tapped: true, attacking: true, attackTargetId: target.seat.id, summoningSick: false } : card
                    )
                  }
                }
              : seat
          ),
          events: [
            {
              id: crypto.randomUUID(),
              at: new Date().toISOString(),
              seatId,
              message: `${source.name} triggers: ${attacker.name} creates ${created.createdTokens.map((token) => token.name).join(", ")}, tapped and attacking ${target.seat.name}.`,
              detail: "Rules action"
            },
            ...created.session.events
          ]
        };
      }
    }

    // Breena, the Demagogue: symmetric and board-wide (see findBreenaAttackTriggers's own doc
    // comment) — resolved inline here, the same synchronous-resolution convention this function
    // already uses for the Metalcraft debuff and "whenever you attack a player" token creation just
    // above, rather than routed through the stack-based trigger queue those don't use either.
    // Excludes a planeswalker attack, matching the same `!target.planeswalker` scope the "whenever
    // you attack a player" block above already applies to its own identical "attacks a player"
    // wording.
    if (!target.planeswalker) {
      const breenaTriggers = findBreenaAttackTriggers(attackTriggeredSession, seatId, target.seat.id);
      for (const trigger of breenaTriggers) {
        attackTriggeredSession = {
          ...attackTriggeredSession,
          events: [
            { id: crypto.randomUUID(), at: new Date().toISOString(), seatId: trigger.controllerSeatId, message: trigger.message, detail: "Rules action" },
            ...attackTriggeredSession.events
          ]
        };
        // The draw half resolves now; a human Breena controller then picks which creature gets the counters.
        const counterThen = trigger.effect.then?.kind === "add_counter" ? trigger.effect.then : undefined;
        const controllerIsHuman = attackTriggeredSession.seats.find((item) => item.id === trigger.controllerSeatId)?.kind === "human";
        if (counterThen && controllerIsHuman) {
          const { then: _deferred, ...drawOnly } = trigger.effect;
          attackTriggeredSession = resolveTriggerEffect(attackTriggeredSession, { ...trigger, effect: drawOnly as typeof trigger.effect });
          const controllerSeat = attackTriggeredSession.seats.find((item) => item.id === trigger.controllerSeatId);
          if (controllerSeat?.board.battlefield.some((card) => card.typeLine.includes("Creature"))) {
            attackTriggeredSession = {
              ...attackTriggeredSession,
              pendingCounterChoices: [
                ...(attackTriggeredSession.pendingCounterChoices ?? []),
                { seatId: trigger.controllerSeatId, sourceCardId: trigger.sourceCardId, sourceCardName: trigger.sourceCardName, counterKind: counterThen.counterKind, amount: counterThen.amount, restrictToYourControl: true }
              ]
            };
          }
        } else {
          attackTriggeredSession = resolveTriggerEffect(attackTriggeredSession, trigger);
        }
      }
    }

    const annihilatorN = annihilatorAmount(attackingCard.oracleText);
    if (!annihilatorN) return attackTriggeredSession;
    // A human defender chooses which permanents to sacrifice (the picker opens from pendingSacrificeChoices).
    if (target.seat.kind === "human" && target.seat.board.battlefield.length > annihilatorN) {
      return { ...attackTriggeredSession, pendingSacrificeChoices: [...(attackTriggeredSession.pendingSacrificeChoices ?? []), { seatId: target.seat.id, sourceCardId: attackingCard.id, sourceCardName: attackingCard.name + "'s annihilator", count: annihilatorN, typeFilter: "permanent" }] };
    }
    const sacrifices = chooseAnnihilatorSacrifices(target.seat, annihilatorN);
    if (sacrifices.length === 0) return attackTriggeredSession;
    return destroyCreatures(
      attackTriggeredSession,
      sacrifices.map((card) => ({
        seatId: target.seat.id,
        cardId: card.id,
        message: `${target.seat.name} sacrifices ${card.name} to ${attackingCard.name}'s annihilator ${annihilatorN}.`
      })),
      "Rules action"
    );
  }

  // Shared by both the human UI (toggle-then-confirm) and the agent decision loop (accumulate one
  // creature at a time, then finalize) — assigns every id in blockerCardIds as a blocker for this
  // attacker, in that order, which becomes the attacker's damage-assignment order (rule 509.2:
  // whoever declared the blocks chooses the order, so "the order you picked them in" is exactly
  // that choice). An empty array declares no blockers, same as before.
  function toggleHumanBlocker(blockerCardId: string) {
    setSelectedBlockerIds((current) => (current.includes(blockerCardId) ? current.filter((id) => id !== blockerCardId) : [...current, blockerCardId]));
  }

  // A remote friend declares blockers with the creature ids they picked on their own table (their selection never touches the host's selectedBlockerIds).
  function confirmBlockersFor(blockerCardIds: string[]) {
    const choice = blockChoice;
    if (!choice) return;
    setBlockChoice(undefined);
    setSession((current) => assignBlockers(current, choice, blockerCardIds));
  }

  function confirmHumanBlockers() {
    const choice = blockChoice;
    if (!choice) return;
    setBlockChoice(undefined);
    setSession((current) => assignBlockers(current, choice, selectedBlockerIds));
    setSelectedBlockerIds([]);
  }

  function passHumanBlocks() {
    const choice = blockChoice;
    if (!choice) return;
    setBlockChoice(undefined);
    setSelectedBlockerIds([]);
    setSession((current) => resolveHumanUnblockedDamage(current, choice));
  }

  function declareHumanAttack(cardId: string, targetId: string, actingSeatId: string = humanSeat.id) {
    if (pendingAction || activeSeatId !== actingSeatId) return;
    setSession((current) => declareAttack(current, actingSeatId, cardId, targetId));
    setInspectedCard(undefined);
  }

  return { confirmBlockersFor, confirmHumanBlockers, declareAttack, declareHumanAttack, passHumanBlocks, toggleHumanBlocker };
}
