// Turn structure: untap step, upkeep draws, extra untap effects, end-step effects, temporary-buff cleanup, phase-trigger planning
// (beginning/end of turn triggers, delayed triggers), seat rotation / extra turns, starting-player roll.
// Extracted verbatim from components/AppFlow.tsx; AppFlow.tsx re-exports the previously public symbols.

import { returnFlaggedCommandersToCommandZone } from "@/engine/cardScripts";
import { seatVerb } from "@/engine/abilities";
import { applyCombatDamageToTarget } from "@/engine/damage";
import { drawForSeat, drawMultipleForSeat } from "@/engine/effects";
import { moveCardAcrossSeats } from "@/engine/entry";
import { isBoardConditionMet, isRecognizedBoardCondition } from "@/engine/mana";
import { applyPhasingStep } from "@/engine/phasing";
import { clearPlayerLock, expireAttackBans } from "@/engine/lockdownEffects";
import { parseSearchLibraryPutEffect } from "@/engine/oneShotEffects";
import { emblemAsShimCard } from "@/engine/shared";
import { agentTargetedTriggerKinds, agentTriggerTarget } from "@/engine/triggerFinders";
import { applyDeterministicPhaseTrigger, commonTriggerEffect, makeCommonTrigger, phaseConditionBlocks, phaseEffectText, phaseEvent, phaseTriggerTextMatches } from "@/engine/triggers";
import { type PendingAction, type TriggerEffect, type TurnPhase } from "@/engine/types";
import { applyCounterDelta, changeControlWithinBattlefield, possessive, rulesEvent } from "@/engine/zones";
import { attachmentGrantsExtraBeginningPhase, isAura } from "@/lib/attachments";
import { cantUntap } from "@/lib/combatRestrictions";
import { counterCount } from "@/lib/counters";
import { isActivatedAbilityClause, mergeModalBulletClauses, oracleClauses } from "@/lib/oracleClauses";
import { collectPhaseTriggers, stackResolutionOrder, type DelayedPhaseTrigger } from "@/lib/phaseTriggers";
import { TURN_PHASES } from "@/lib/priorityStops";
import { type GameSession, type PlayerSeat, type VisibleCard } from "@/lib/types";
import { parseZoneEffect, type ZoneEffect } from "@/lib/zoneEffects";

// --- Hoisted from inside AppFlow (were nested closures with no React state access) ---
// Moved verbatim, no behavior change, so the headless self-play orchestrator (later milestone) can
// call the same phase-advance primitives the live UI uses. Not every originally-planned function in
// this group could be hoisted this way — see the ones still nested just above AppFlow's closing
// brace (clearAllManaPools, declareAttack, runPhaseActions, advanceSagaLoreCounters) for why.

// Arcane Denial's "at the beginning of the next turn's upkeep" delayed draws (see
// GameSession.pendingUpkeepDraws and parseDelayedUpkeepDraws) — "the next turn's upkeep" means
// the very next upkeep step that begins, whoever's turn it is, not each scheduled seat's own next
// upkeep. So this drains the WHOLE queue the first time any upkeep step is reached, rather than
// filtering by the seat whose upkeep this is.
// CR 103.8: in a TWO-player game the player who goes first skips the draw step of their first turn; with three or more players (Commander pods)
// nobody skips. The session's turn counter counts every seat's turn, so turn 1 is the starting player's first turn.
export function skipsFirstTurnDraw(session: GameSession, seatId: string): boolean {
  return session.turn === 1 && session.seats.length === 2 && session.activePlayerId === seatId;
}

export function resolvePendingUpkeepDraws(session: GameSession): GameSession {
  const pending = session.pendingUpkeepDraws;
  if (!pending || pending.length === 0) return session;
  let next: GameSession = { ...session, pendingUpkeepDraws: [] };
  for (const entry of pending) {
    const seat = next.seats.find((item) => item.id === entry.seatId);
    if (!seat) continue;
    next = drawMultipleForSeat(next, entry.seatId, entry.amount, `${entry.sourceName} resolves. ${seat.name} draws ${entry.amount === 1 ? "a card" : `${entry.amount} cards`}.`);
  }
  return next;
}

export function untapForSeat(session: GameSession, seatId: string): GameSession {
  // Rule 502.1: the untap step's first turn-based action is phasing — this seat's permanents phase in/out BEFORE anything untaps.
  session = applyPhasingStep(session, seatId);
  // "Until your next turn" lockdowns (Orzhov Advokist's attack bans, Perch Protection's player lock) end as this player's turn begins.
  session = clearPlayerLock(expireAttackBans(session, seatId), seatId);
  const seat = session.seats.find((item) => item.id === seatId);
  // Rule 701.44b: a permanent with a stun counter removes one stun counter instead of untapping
  // this step — it stays tapped, but the counter comes off, so it untaps normally again once none
  // are left. summoningSick/attacking/blocking still clear either way (those track "since your
  // last turn began"/"this combat", not tap state).
  // Rule 702.26h: a phased-out permanent phases IN at the start of this same step, before any
  // untapping happens — simplified here to just untapping it along with everything else rather
  // than separately restoring its exact pre-phase-out tapped status, which this engine doesn't
  // track (see phasedOut's doc comment on VisibleCard).
  // "Stun counters can't be removed from permanents your opponents control." (Fear of Sleep
  // Paralysis) overrides rule 701.44b above for whichever seat it's aimed at: normally a stun
  // counter just costs one untap step before wearing off, but this locks it in place — the
  // permanent stays tapped and stunned indefinitely until Fear of Sleep Paralysis itself leaves
  // the battlefield (this check re-runs fresh every untap step, so it stops applying the moment
  // that happens). Reported live as stun counters this seat received always still wearing off
  // after one turn regardless.
  const opponentStunLockActive = session.seats.some(
    (other) => other.id !== seatId && other.board.battlefield.some((card) => /stun counters can'?t be removed from permanents your opponents control/i.test(card.oracleText))
  );
  const everyPermanent = session.seats.flatMap((other) => other.board.battlefield);
  // Goad lasts until the goading player's next turn.
  session = { ...session, seats: session.seats.map((other) => ({ ...other, board: { ...other.board, battlefield: other.board.battlefield.map((card) => (card.goaded?.bySeatId === seatId ? { ...card, goaded: undefined } : card)) } })) };
  const untapOrRemoveStun = (card: VisibleCard): VisibleCard => {
    // Phasing already happened (applyPhasingStep below): what is still phased out (just phased out by its Phasing keyword, or phased out indirectly
    // with its host) does not untap.
    if (card.phasedOut) return card;
    // "This creature doesn't untap during your untap step." / "Enchanted creature doesn't untap during its controller's untap step."
    if (card.tapped && cantUntap(card, everyPermanent, { controllerSeatId: seatId, monarchSeatId: session.monarchSeatId })) return { ...card, summoningSick: false, attacking: false, blocking: false };
    if (counterCount(card, "stun") > 0) {
      return opponentStunLockActive
        ? { ...card, summoningSick: false, attacking: false, blocking: false }
        : { ...applyCounterDelta(card, "stun", -1), summoningSick: false, attacking: false, blocking: false };
    }
    return { ...card, tapped: false, tapUsed: false, summoningSick: false, attacking: false, blocking: false };
  };
  const untappedSession = {
    ...session,
    seats: session.seats.map((item) =>
      item.id === seatId
        ? {
            ...item,
            board: {
              ...item.board,
              commander: item.board.commander ? untapOrRemoveStun(item.board.commander) : undefined,
              battlefield: item.board.battlefield.map(untapOrRemoveStun)
            }
          }
        : item
    ),
    events: [
      phaseEvent(
        seatId,
        seat ? seatVerb(seat, `${seat.name} untaps their permanents.`, "You untap your permanents.") : "Player untaps their permanents."
      ),
      ...session.events
    ]
  };
  // "Untap all artifacts/permanents you control during each other player's untap step." (Unwinding
  // Clock, Seedborn Muse) — every OTHER seat's own untap step also untaps this seat's stuff, not
  // just this seat's own.
  return applyExtraUntapEffects(untappedSession, seatId);
}

export function isMainPhase(phase: string) {
  return phase === "precombat main phase" || phase === "postcombat main phase";
}

const DEFAULT_MAX_HAND_SIZE = 7;

// Rule 402.2: only the very common, consistently-worded "you have no maximum hand size" grant is
// recognized here (Spellbook, Thought Reflection, Reliquary Tower, ...) — matching this codebase's
// existing pattern of handling the standard real-card phrasing deterministically and declining
// rarer/looser shapes (a numeric override like "your maximum hand size is X" isn't modeled) rather
// than guessing at them.
function hasNoMaximumHandSize(seat: PlayerSeat): boolean {
  if (seat.noMaximumHandSize) return true;
  const permanents = [seat.board.commander, ...seat.board.battlefield].filter((card): card is VisibleCard => Boolean(card));
  return permanents.some((card) => /\bno maximum hand size\b/i.test(card.oracleText));
}

export function effectiveMaxHandSize(seat: PlayerSeat): number {
  return hasNoMaximumHandSize(seat) ? Number.POSITIVE_INFINITY : DEFAULT_MAX_HAND_SIZE;
}

// "Until end of turn" effects (prowess, combat pumps, ...) expire when the turn ends.
export function clearTemporaryBuffs(session: GameSession): GameSession {
  const withBuffsCleared: GameSession = {
    ...session,
    seats: session.seats.map((seat) => ({
      ...seat,
      // Safety net for "the next spell you cast this turn" if no spell was ever cast — the normal
      // consumption path is checkCastTriggeredKeywords, which only runs when a spell is cast.
      nextSpellHasArtifactAffinity: undefined,
      createdTokenThisTurn: undefined,
      // Snapshot at each turn change: "if you gained life this turn" (Witch of the Moors, Moseo, Eccentric Pestfinder) reads as life now above this.
      lifeAtTurnStart: seat.life,
      board: {
        ...seat.board,
        // Every until-end-of-turn field is cleared together: a creature can carry several at once (a pump that also grants trample,
        // Nogi's temporary Dragon P/T plus a keyword), and clearing only the first kind found left the rest on all game.
        battlefield: seat.board.battlefield.map((card) =>
          card.temporaryPowerBonus ||
          card.temporaryToughnessBonus ||
          card.temporaryBasePower !== undefined ||
          card.temporaryBaseToughness !== undefined ||
          card.temporaryAbilitiesStripped ||
          card.temporaryAnimatedAsCreature ||
          card.temporaryGrantedKeywords ||
          card.temporaryKeywordLosses ||
          card.temporaryOriginalTypeLine !== undefined ||
          card.temporaryCopyOriginal ||
          card.damagedPlayersThisTurn ||
          card.damage
            ? {
                ...card,
                damage: undefined,
                damagedPlayersThisTurn: undefined,
                ...(card.temporaryCopyOriginal ? { ...card.temporaryCopyOriginal, temporaryCopyOriginal: undefined } : {}),
                temporaryPowerBonus: undefined,
                temporaryToughnessBonus: undefined,
                temporaryBasePower: undefined,
                temporaryBaseToughness: undefined,
                temporaryAbilitiesStripped: undefined,
                temporaryAnimatedAsCreature: undefined,
                temporaryGrantedKeywords: undefined,
                temporaryKeywordLosses: undefined,
                temporaryKeywordStamps: undefined,
                temporaryStripStamp: undefined,
                // The layer pass recomputes grantedKeywords on the next state check; dropping the temporary ones now keeps it right in between.
                ...(card.temporaryGrantedKeywords?.length ? { grantedKeywords: card.grantedKeywords?.filter((keyword) => !card.temporaryGrantedKeywords!.includes(keyword)) } : {}),
                ...(card.temporaryOriginalTypeLine !== undefined ? { typeLine: card.temporaryOriginalTypeLine, temporaryOriginalTypeLine: undefined } : {})
              }
            : card
        )
      }
    }))
  };

  // Revert any "gain control...until end of turn" changes (Threaten-style) back to the true
  // owner's battlefield — same timing as the power/toughness buffs above.
  const reverting = withBuffsCleared.seats.flatMap((seat) =>
    seat.board.battlefield.filter((card) => card.temporaryControlChange).map((card) => ({ fromSeatId: seat.id, cardId: card.id, toSeatId: card.ownerSeatId ?? seat.id }))
  );
  const controlReverted = reverting.reduce(
    (next, entry) => (entry.fromSeatId === entry.toSeatId ? next : changeControlWithinBattlefield(next, entry.cardId, entry.fromSeatId, entry.toSeatId)),
    withBuffsCleared
  );

  // Time-limited exile-play permission (impulse draw's "until end of turn"/"until the end of your
  // next turn") that's expired — the card just stays exiled, it isn't destroyed or moved.
  // controlReverted.turn is already the NEW turn number by the time this runs (both call sites
  // update it before calling clearTemporaryBuffs).
  return {
    ...controlReverted,
    seats: controlReverted.seats.map((seat) => ({
      ...seat,
      board: {
        ...seat.board,
        exile: (seat.board.exile ?? []).map((card) =>
          card.exiledPlayableUntilTurn !== undefined && controlReverted.turn > card.exiledPlayableUntilTurn
            ? { ...card, exiledPlayableBySeatId: undefined, exiledPlayableUntilTurn: undefined }
            : card
        )
      }
    }))
  };
}

// Dragonhawk's delayed trigger, at the beginning of its controller's end step: 2 damage to each opponent for each exiled card not played.
export function resolveEndStepExileDamage(session: GameSession, activeSeatId: string): GameSession {
  const active = session.seats.find((seat) => seat.id === activeSeatId);
  const marked = (active?.board.exile ?? []).filter((card) => card.exileEndStepDamage?.controllerSeatId === activeSeatId);
  if (!active || marked.length === 0) return session;
  const { sourceName, amount } = marked[0].exileEndStepDamage!;
  let next: GameSession = {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id !== activeSeatId ? seat : { ...seat, board: { ...seat.board, exile: (seat.board.exile ?? []).map((card) => (card.exileEndStepDamage?.controllerSeatId === activeSeatId ? { ...card, exileEndStepDamage: undefined } : card)) } }
    )
  };
  const source = next.seats.flatMap((seat) => seat.board.battlefield).find((card) => card.name === sourceName);
  for (const opponent of session.seats) {
    if (opponent.id === activeSeatId || opponent.hasLost) continue;
    next = applyCombatDamageToTarget(next, sourceName, { seat: next.seats.find((item) => item.id === opponent.id)! }, amount * marked.length, source, activeSeatId, "noncombat");
  }
  return rulesEvent(next, activeSeatId, `${sourceName}: ${marked.length} exiled card${marked.length === 1 ? " was" : "s were"} not played, so each opponent takes ${amount * marked.length} damage.`);
}

// "Untap all artifacts you control during each other player's untap step." (Unwinding Clock) /
// "Untap all permanents you control during each other player's untap step." (Seedborn Muse) — not
// a triggered ability at all (no "when"/"whenever"), so it doesn't belong in
// findCommonTriggersForPermanentEntered/died's trigger-scan machinery; it's a standing effect that
// extends WHO untaps during a given untap step, checked directly from untapForSeat below instead.
// Previously had no implementation anywhere in the engine for either wording, so a controller's
// artifacts/permanents only ever untapped on their own untap step like normal, never during anyone
// else's — reported live as both Unwinding Clock and, separately, Seedborn Muse "not working."
function extraUntapAbilityScope(card: { oracleText: string }): "artifacts" | "permanents" | undefined {
  if (/\buntap all artifacts you control during each other player's untap step\b/i.test(card.oracleText)) return "artifacts";
  if (/\buntap all permanents you control during each other player's untap step\b/i.test(card.oracleText)) return "permanents";
  return undefined;
}

// Called after a seat's own untap step already ran (untapForSeat) — untaps the artifacts/permanents
// of every OTHER seat that controls an Unwinding Clock or Seedborn Muse (or the same effect on any
// other permanent), since this step is "each other player's" untap step from each such controller's
// point of view. Each source's own controller is unaffected by their own copy (their stuff already
// untaps normally on their own untap step) — only every seat that ISN'T the one whose untap step
// this is can have a source granting them a bonus untap here. A seat with more than one qualifying
// source (unlikely, but not prevented) is scoped to the broadest one found ("permanents" beats
// "artifacts") rather than applying each separately, which would be indistinguishable in outcome
// anyway once "permanents" has already untapped everything.
function applyExtraUntapEffects(session: GameSession, activeUntapSeatId: string): GameSession {
  let next = session;
  for (const sourceSeat of session.seats) {
    if (sourceSeat.id === activeUntapSeatId) continue;
    const scopes = sourceSeat.board.battlefield.map(extraUntapAbilityScope).filter((scope): scope is "artifacts" | "permanents" => scope !== undefined);
    if (scopes.length === 0) continue;
    const scope = scopes.includes("permanents") ? "permanents" : "artifacts";
    const sourceName = scope === "permanents" ? "Seedborn Muse" : "Unwinding Clock";
    next = {
      ...next,
      seats: next.seats.map((item) =>
        item.id === sourceSeat.id
          ? {
              ...item,
              board: {
                ...item.board,
                commander: scope === "permanents" && item.board.commander?.tapped ? { ...item.board.commander, tapped: false } : item.board.commander,
                battlefield: item.board.battlefield.map((card) =>
                  card.tapped && (scope === "permanents" || card.typeLine.includes("Artifact")) ? { ...card, tapped: false, tapUsed: false } : card
                )
              }
            }
          : item
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: sourceSeat.id,
          message: `${sourceName} untaps ${possessive(sourceSeat)} ${scope} during ${(() => {
            const untapSeat = session.seats.find((seat) => seat.id === activeUntapSeatId);
            return untapSeat ? possessive(untapSeat) : "another player's";
          })()} untap step.`,
          detail: "Phase change"
        },
        ...next.events
      ]
    };
  }
  return next;
}

export function phaseTriggeredCards(seat: PlayerSeat, phase: TurnPhase) {
  const permanents = seat.board.battlefield.filter((card) => hasPhaseTrigger(card, phase));
  const emblems = (seat.emblems ?? []).map(emblemAsShimCard).filter((card) => hasPhaseTrigger(card, phase));
  return [...permanents, ...emblems];
}

// Shadow of the Second Sun-style "enchant player" Auras live on their CASTER's battlefield, not
// the enchanted player's — scans every seat's battlefield rather than just the enchanted seat's own.
export function hasExtraBeginningPhaseAura(session: GameSession, enchantedSeatId: string): boolean {
  return session.seats.some((seat) =>
    seat.board.battlefield.some((card) => isAura(card) && card.attachedToSeatId === enchantedSeatId && attachmentGrantsExtraBeginningPhase(card.oracleText))
  );
}

export function hasPhaseTrigger(card: VisibleCard, phase: TurnPhase) {
  // A creature that's lost all abilities (abilitiesStripped) can't fire its own phase-triggered
  // ability either — same suppression hasKeyword already applies to its keywords.
  if ((card.abilitiesStripped || card.phasedOut)) return false;
  return mergeModalBulletClauses(oracleClauses(card.oracleText)).some(
    (clause) => !isActivatedAbilityClause(clause) && phaseTriggerTextMatches(clause.toLowerCase(), phase)
  );
}

// "At the beginning of your upkeep, if you have four or more creature cards in your graveyard, you may return target creature card from your
// graveyard to your hand." (Oversold Cemetery, Reya Dawnbringer, ...): what a human is asked at the phase, or "skip" when its "if" isn't met.
export function humanPhaseGraveyardChoice(session: GameSession, seatId: string, sourceCard: VisibleCard, phase: TurnPhase): "skip" | { effect: ZoneEffect; optional: boolean } | undefined {
  const clauseText = phaseEffectText(sourceCard.oracleText, phase);
  if (!clauseText.trim()) return undefined;
  const effect = parseZoneEffect(clauseText);
  if (!effect || (effect.kind !== "regrow" && !(effect.kind === "reanimate" && !effect.anyGraveyard))) return undefined;
  const condition = clauseText.replace(/^.*?\bat the beginning of[^,]*,\s*/i, "").match(/^if\s+(.+?),/i);
  if (condition) {
    if (!isRecognizedBoardCondition(condition[1])) return undefined;
    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat || !isBoardConditionMet(condition[1], seat, session.seats)) return "skip";
  }
  return { effect, optional: /\byou may\b/i.test(clauseText) };
}

export function applyEndStepEffects(session: GameSession, seatId: string): GameSession {
  let next = session;
  // Treasure Nabber's steals end at the stealer's end step on a LATER turn than the tap.
  for (const holder of next.seats) {
    for (const card of holder.board.battlefield.filter((permanent) => permanent.nabbedUntil && permanent.nabbedUntil.seatId === seatId && next.turn > permanent.nabbedUntil.afterTurn && permanent.nabbedFromSeatId)) {
      const back = card.nabbedFromSeatId!;
      next = changeControlWithinBattlefield(next, card.id, holder.id, back);
      next = { ...next, seats: next.seats.map((seat) => (seat.id !== back ? seat : { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((permanent) => (permanent.id === card.id ? { ...permanent, nabbedFromSeatId: undefined, nabbedUntil: undefined, summoningSick: false } : permanent)) } })) };
    }
  }
  const monarch = next.seats.find((seat) => seat.id === seatId);
  if (next.monarchSeatId === seatId && next.monarchDrawTurn !== next.turn && monarch && !monarch.hasLost) {
    next = drawForSeat({ ...next, monarchDrawTurn: next.turn }, seatId, `${monarch.name} draws a card as the monarch.`);
  }
  // "Exile it at the beginning of the next end step": tokens just cease to exist, a real card goes to exile.
  const doomed = next.seats.flatMap((item) => item.board.battlefield.filter((card) => card.exileAtEndStep).map((card) => ({ seatId: item.id, card })));
  for (const entry of doomed) {
    next = entry.card.token
      ? { ...next, seats: next.seats.map((item) => (item.id === entry.seatId ? { ...item, board: { ...item.board, battlefield: item.board.battlefield.filter((card) => card.id !== entry.card.id) }, zones: { ...item.zones, battlefield: Math.max(0, item.zones.battlefield - 1) } } : item)) }
      : moveCardAcrossSeats(next, entry.seatId, entry.card.id, entry.card.ownerSeatId ?? entry.seatId, "exile").session;
  }
  return resolveEndStepExileDamage(returnFlaggedCommandersToCommandZone(next), seatId);
}

export function phaseEventName(phase: TurnPhase) {
  return `${phase.replace(/ /g, "_")}_trigger`;
}

// Whether this phase's clause on sourceCard is a reanimate effect sourced from ANY graveyard (not
// just the controller's own) — Virtue of Persistence's shape. Checked at the phase-trigger dispatch
// site (before applyDeterministicPhaseTrigger ever runs) so a human controller can be asked to pick
// the actual target instead of it going straight to chooseReanimationTarget's heuristic.
export function isReanimateFromAnyGraveyardPhaseTrigger(sourceCard: VisibleCard, phase: TurnPhase): boolean {
  const effect = parseZoneEffect(phaseEffectText(sourceCard.oracleText, phase));
  return effect?.kind === "reanimate" && effect.anyGraveyard;
}

// Whether this phase's clause on sourceCard puts a counter on a battlefield creature the
// controller doesn't get to auto-resolve for free — Athreos, Shroud-Veiled's "put a coin counter
// on another target creature" shape. Checked at the phase-trigger dispatch site, same reasoning as
// isReanimateFromAnyGraveyardPhaseTrigger just above.
export function targetCreatureCounterPhaseTrigger(
  sourceCard: VisibleCard,
  phase: TurnPhase
): Extract<TriggerEffect, { kind: "add_counter" }> | undefined {
  const effect = commonTriggerEffect(phaseEffectText(sourceCard.oracleText, phase), "clause");
  if (effect?.kind !== "add_counter") return undefined;
  return effect.scope === "target_creature" || effect.scope === "target_creature_you_control" ? effect : undefined;
}

// --- phase triggers on the stack ---------------------------------------------------------------------------------------------------------------
// A step's "at the beginning of ..." abilities used to be applied directly by the phase sweep (no stack, no response window, no recorded target).
// src/lib/phaseTriggers.ts now derives the standing watchers of every seat's permanents; the sweep turns them into real trigger stack items here.
function phaseStepLabel(phase: TurnPhase): string {
  return phase === "end of combat step" ? "end of combat" : phase === "beginning of combat step" ? "combat" : phase.replace(/ step$/, " step");
}

function hasInterveningIf(clauseText: string): boolean {
  return /^.*?\bat the beginning of[^,]*,\s*if\s/i.test(clauseText);
}

function stubSourceCard(id: string, name: string): VisibleCard {
  return { id, name, typeLine: "", oracleText: "", colors: [], manaValue: 0, role: "effect", zone: "battlefield" } as VisibleCard;
}

// The stack item for one of the ACTIVE player's own phase triggers that resolves without a human decision (after the sweep's human prompts have
// been offered). "blocked": its intervening "if" is false right now (rule 603.4: it does not trigger at all). undefined: no deterministic handler,
// so the rules-advisor fallback owns it. An agent's aimed trigger records its target as it goes on the stack (rule 603.3d).
export function makePhaseStackTrigger(session: GameSession, seatId: string, sourceCard: VisibleCard, phase: TurnPhase): Extract<PendingAction, { type: "trigger" }> | "blocked" | undefined {
  const clause = phaseEffectText(sourceCard.oracleText, phase);
  if (!clause.trim()) return undefined;
  if (phaseConditionBlocks(session, seatId, clause)) return "blocked";
  const seat = session.seats.find((item) => item.id === seatId);
  // "At the beginning of your end step, search your library for a permanent card, put it onto the battlefield, then shuffle." (Tezzeret's and Garruk's
  // emblems): a real stack item whose resolution opens the library picker for a human / makes the deterministic pick for an agent.
  const searchPut = parseSearchLibraryPutEffect(clause);
  if (searchPut) {
    return makeCommonTrigger(seatId, seatId, sourceCard, { kind: "search_library_put", filter: searchPut.filter, tapped: searchPut.tapped, optional: searchPut.optional, fromPhaseStep: true, ...(hasInterveningIf(clause) ? { recheckClause: clause } : {}) }, `${sourceCard.name} triggers at the beginning of ${seat?.name ?? "the"} ${phaseStepLabel(phase)}.`);
  }
  if (applyDeterministicPhaseTrigger(session, seatId, sourceCard, phase) === undefined) return undefined;
  let effect: Extract<TriggerEffect, { kind: "phase_trigger" }> = { kind: "phase_trigger", phase, sourceSnapshot: sourceCard, fromPhaseStep: true, ...(hasInterveningIf(clause) ? { recheckClause: clause } : {}) };
  if (seat?.kind === "agent") {
    const common = commonTriggerEffect(clause, "clause", undefined, seat);
    if (common && agentTargetedTriggerKinds.has(common.kind)) {
      const aimed = agentTriggerTarget(session, makeCommonTrigger(seatId, seatId, sourceCard, common, ""));
      if (aimed) effect = { ...effect, viaEffect: common, chosenOption: aimed };
    }
  }
  return makeCommonTrigger(seatId, seatId, sourceCard, effect, `${sourceCard.name} triggers at the beginning of ${seat?.name ?? "the"} ${phaseStepLabel(phase)}.`);
}

// Phase triggers that are NOT the active player's own legacy-swept permanents: every other seat's permanents ("each upkeep", "each opponent's
// upkeep", "at the beginning of each combat", Sheoldred's edict, ...) and due one-shot delayed triggers. Returned in resolution order (APNAP: the
// non-active players' triggers resolve before the active player's), already shaped as stack items. consumedDelayedIds are removed from the session
// once queued (they fire once).
export function planOffTurnPhaseTriggers(session: GameSession, phase: TurnPhase, activeSeatId: string): { triggers: Array<Extract<PendingAction, { type: "trigger" }>>; consumedDelayedIds: string[] } {
  const groups = collectPhaseTriggers(session.seats, phase, activeSeatId, { delayed: session.delayedPhaseTriggers, turn: session.turn });
  const active = session.seats.find((item) => item.id === activeSeatId);
  const triggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];
  const consumedDelayedIds: string[] = [];
  for (const entry of stackResolutionOrder(groups)) {
    const { watcher, delayed } = entry;
    const controller = session.seats.find((item) => item.id === watcher.controllerSeatId);
    if (!controller) continue;
    const spec = watcher.spec;
    const card = controller.board.battlefield.find((item) => item.id === watcher.sourceCardId);
    const emblem = watcher.emblem ? (controller.emblems ?? []).find((item) => item.id === watcher.sourceCardId) : undefined;
    const sourceCard = card ?? (emblem ? emblemAsShimCard(emblem) : stubSourceCard(watcher.sourceCardId, watcher.sourceCardName));
    if (delayed) {
      consumedDelayedIds.push(delayed.id);
      triggers.push(makeCommonTrigger(activeSeatId, controller.id, sourceCard, { kind: "phase_trigger", phase, delayedEffectText: delayed.effectText, sourceSnapshot: sourceCard, fromPhaseStep: true, ...(delayed.returnCard ? { delayedReturn: delayed.returnCard } : {}) }, `${watcher.sourceCardName}'s delayed trigger happens at the beginning of ${active?.name ?? "the"} ${phaseStepLabel(phase)}.`));
      continue;
    }
    // The active player's own permanents are owned by the sweep's per-card flow (human prompts included) whenever its legacy matcher claims them.
    if (watcher.controllerSeatId === activeSeatId && sourceCard && hasPhaseTrigger(sourceCard, phase)) continue;
    if (spec.keyword) continue;
    if (spec.condition && phaseConditionBlocks(session, controller.id, spec.clause)) continue;
    let effect: TriggerEffect | undefined;
    if (spec.scope === "opponents" && /^that player sacrifices an? (?:nontoken )?creature of their choice/i.test(spec.effectText)) {
      effect = { kind: "each_opponent_sacrifices", filter: "creature", onlySeatId: activeSeatId };
    } else if (/\b(?:that player|each player|the active player|enchanted player|defending player|target player)\b/i.test(spec.effectText)) {
      // The effect is about whoever's turn it is, which the generic parsers read as the controller: not resolved rather than resolved wrongly.
      continue;
    } else {
      effect = commonTriggerEffect(spec.clause, "clause", undefined, controller);
    }
    if (!effect) continue;
    effect = { ...effect, fromPhaseStep: true, ...(spec.condition ? { recheckClause: spec.clause } : {}) };
    triggers.push(makeCommonTrigger(activeSeatId, controller.id, sourceCard, effect, `${sourceCard.name} triggers at the beginning of ${active?.name ?? "the"} ${phaseStepLabel(phase)}.`));
  }
  return { triggers, consumedDelayedIds };
}

// Schedules a one-shot delayed "at the beginning of the next <step>" trigger (rule 603.7) created by a resolved effect.
export function scheduleDelayedPhaseTrigger(session: GameSession, trigger: Omit<DelayedPhaseTrigger, "id" | "createdTurn" | "createdPhase">): GameSession {
  const createdPhase = (TURN_PHASES as readonly string[]).includes(session.phase) ? (session.phase as TurnPhase) : "precombat main phase";
  return { ...session, delayedPhaseTriggers: [...(session.delayedPhaseTriggers ?? []), { ...trigger, id: crypto.randomUUID(), createdTurn: session.turn, createdPhase }] };
}

// Free-for-all Commander games continue while 2+ players remain — eliminated seats stay in the
// array (for history/log purposes) but are skipped when finding whose turn/priority is next.
function nextInRotation(seats: PlayerSeat[], fromIndex: number): PlayerSeat {
  for (let offset = 1; offset <= seats.length; offset += 1) {
    const candidate = seats[(fromIndex + offset) % seats.length];
    if (!candidate.hasLost) return candidate;
  }
  return seats[fromIndex];
}

// Rule 500.7: an extra turn is inserted immediately after the current one, without disturbing the
// base rotation — once it (and any other still-queued extra turns) concludes, play resumes exactly
// where normal rotation would have left off. Achieved for free here: activeIndex stays pinned to
// whoever is CURRENTLY active (the extra-turn taker included), so once the queue drains,
// nextInRotation(seats, activeIndex) naturally computes the same next player it would have if the
// extra turn(s) had never been inserted. Eliminated players' queued extra turns are skipped, same
// as nextInRotation already skips them for normal rotation.
export function nextSeatForTurn(seats: PlayerSeat[], activeIndex: number, extraTurnsQueue: string[] | undefined): { seat: PlayerSeat; queue: string[] } {
  const queue = extraTurnsQueue ?? [];
  for (let i = 0; i < queue.length; i += 1) {
    const queuedSeat = seats.find((seat) => seat.id === queue[i] && !seat.hasLost);
    if (queuedSeat) return { seat: queuedSeat, queue: queue.slice(i + 1) };
  }
  return { seat: nextInRotation(seats, activeIndex), queue: [] };
}

export function nextSeatId(seats: PlayerSeat[], seatId: string) {
  const index = Math.max(0, seats.findIndex((seat) => seat.id === seatId));
  return nextInRotation(seats, index).id;
}

function rollD20() {
  return 1 + Math.floor(Math.random() * 20);
}

// Rule 103.2: before the game, each player rolls a die (traditionally a d20); the highest roll
// chooses who plays first. Ties are broken by having only the tied players re-roll against each
// other, not by falling back to seat/array order.
export function rollForStartingSeat(seats: PlayerSeat[]): { winnerId: string; rolls: Record<string, number> } {
  const allRolls: Record<string, number> = {};
  let contenders = seats;
  let guard = 0;
  while (guard < 20) {
    guard += 1;
    const roundRolls: Record<string, number> = {};
    for (const seat of contenders) roundRolls[seat.id] = rollD20();
    Object.assign(allRolls, roundRolls);
    const highest = Math.max(...contenders.map((seat) => roundRolls[seat.id]));
    const tiedForHighest = contenders.filter((seat) => roundRolls[seat.id] === highest);
    if (tiedForHighest.length === 1) return { winnerId: tiedForHighest[0].id, rolls: allRolls };
    contenders = tiedForHighest;
  }
  return { winnerId: contenders[0]?.id ?? seats[0].id, rolls: allRolls };
}
