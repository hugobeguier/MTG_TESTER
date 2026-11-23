// Host side of GAME intents from seated friends. Used by useMpHost with one line:
//   const { listenerRef, acks } = useMpIntents(ctx, enabled);   // and onmessage forwards `intent` events to listenerRef.current
//
// Why a queue: every host handler (playCard, passPriority, ...) closes over the state of the render it was created in. Two intents run back to back in
// one tick would both see the same stale state (the second would not see the first's effect). So intents wait in an in-order queue and ONE is
// processed per React commit (an effect with no deps), with `ctx.late` holding that commit's handlers - the same handlers the host's own UI clicks use.
//
// Safety: only names in INTENT_SPECS (lib/multiplayer/intentSpecs.ts) are runnable (a whitelist, not "any handler by name"); every entry validates its args
// with zod, checks the game state (it is that seat's priority / that seat owns the prompt / ...) and is called as the sender's seat, taken from the slot ->
// seat map (never from args); slots that hold no seat are rejected. The pure parts (specs, dispatchIntent, IntentQueue) are tested without React.
// Every intent gets an ack (the last processed clientSeq + an error text when it was refused) that the host publishes in that guest's next snapshot.
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { IntentQueue, dispatchIntent, type IntentEntry, type IntentEvent, type IntentRegistry } from "@/lib/multiplayer/intentDispatch";
import { GUEST_INTENT_NAMES, INTENT_SPECS, checkIntentArgs, checkIntentWhen, type GuestIntentName, type IntentGameState, type IntentSpec } from "@/lib/multiplayer/intentSpecs";
import { answerRefusal } from "@/lib/multiplayer/answerGuard";
import { isLobbyIntentName } from "@/lib/multiplayer/lobby";
import { seatForSlot } from "@/lib/multiplayer/seatMap";
import { promptOwnersOf } from "@/lib/multiplayer/seatPrompts";
import { attackLockedOut, canAttack, resolveAttackTarget } from "@/engine/combat";
import { attackBannedAgainst } from "@/engine/lockdownEffects";
import { parseLoyaltyAbilities } from "@/engine/abilities";
import type { GameSession, ManaPool } from "@/lib/types";
import { emptyManaPool } from "@/engine/mana";
import { untapForManaDecision, type ManaContribution } from "@/engine/tapUsed";
import type { GameContext, HandlerApi } from "./context";

/** What the registry needs from the host: the (late-bound) handlers and a read of the game state the `when` checks look at. */
export interface MpIntentDeps {
  handlers: HandlerApi;
  state: IntentGameState;
}

type Call = (seatId: string, ...args: never[]) => void;

/** name -> how to run it as `seat`. Args are already validated by the spec's schema. */
function callTable(h: HandlerApi): Record<GuestIntentName, Call> {
  const table: Record<GuestIntentName, (seat: string, ...args: any[]) => void> = {
    onKeepHand: (s) => h.keepOpeningHand(s),
    onMulligan: (s) => h.mulliganOpeningHand(s),
    onToggleMulliganReturnCard: (s, cardId: string) => h.toggleMulliganReturnCard({ id: cardId }, s),
    onPassPriority: () => h.passPriority(),
    onAdvanceTurn: () => h.advanceTurn(),
    onEndTurn: (s) => h.endTurn(s),
    onPlayCard: (s, _seat, cardId, position, zone) => h.playCard(s, cardId, position, zone),
    onPlayCardFace: (s, _seat, cardId, face) => h.playCard(s, cardId, undefined, "hand", face),
    onCycleCard: (s, _seat, cardId) => h.cycleCard(s, cardId),
    onCastFromExile: (s, _seat, cardId) => h.castFromExile(s, cardId),
    onCastFromGraveyard: (s, _seat, cardId) => h.castFromGraveyard(s, cardId),
    onActivateGraveyardAbility: (s, _seat, cardId) => h.activateGraveyardAbility(s, cardId),
    onCastCommander: (s, _seat, position) => h.castCommander(s, position),
    onUnlockRoomDoor: (s, _seat, cardId, face) => h.unlockRoomDoor(s, cardId, face),
    onRespondWithSelectedCard: (s, cardId, zone) => h.respondWithCard(cardId, zone ?? "hand", undefined, undefined, undefined, s),
    onTapForMana: (s, _seat, cardId) => h.tapPermanentForMana(s, cardId),
    onToggleTapCard: (s, _seat, cardId, location) => h.toggleTapCard(s, cardId, location),
    onClickPermanent: (s, cardId) => h.clickPermanentForSeat(s, cardId),
    onActivateSacrificeAbility: (s, _seat, cardId, index) => h.activateGenericSacrificeAbility(s, cardId, index),
    onActivateTapAbility: (s, _seat, cardId, index) => h.activateGenericTapAbility(s, cardId, index),
    onActivateScriptedAbility: (s, _seat, cardId, abilityId) => h.activateScriptedAbility(s, cardId, abilityId),
    onActivateSelfUntap: (s, _seat, cardId, index) => h.activateSelfUntapAbility(s, cardId, index),
    onActivateGenericMana: (s, _seat, cardId, index) => h.activateGenericManaAbility(s, cardId, index),
    onActivateEquip: (s, _seat, cardId) => h.activateEquip(s, cardId),
    onActivateManlandAnimation: (s, _seat, cardId) => h.activateManlandAnimation(s, cardId),
    onActivateLoyalty: (s, _seat, cardId, cost, text) => h.activateLoyaltyAbility(s, cardId, cost, text),
    onResolveMyriadLandscape: (s, _seat, cardId) => h.resolveMyriadLandscape(s, cardId),
    onResolveBasicLandFetch: (s, _seat, cardId) => h.resolveBasicLandFetch(s, cardId),
    onMoveBattlefieldCard: (s, _seat, cardId, position) => h.moveBattlefieldCard(s, cardId, position),
    onToggleFullControl: (s) => h.updateSeatStops(s, { kind: "fullControl" }),
    onStopNext: (s) => h.updateSeatStops(s, { kind: "stopNext" }),
    onTogglePhaseStop: (s, phase: string, seatIndex: number) => h.updateSeatStops(s, { kind: "phase", phase, seatIndex }),
    onToggleStopOnStackResponse: (s) => h.updateSeatStops(s, { kind: "stackResponse" }),
    onToggleStopOnAttacked: (s) => h.updateSeatStops(s, { kind: "attacked" }),
    onToggleStopOnTargeted: (s) => h.updateSeatStops(s, { kind: "targeted" }),
    onToggleStopOnChoicePrompt: (s) => h.updateSeatStops(s, { kind: "choicePrompt" }),
    onToggleYield: (s) => h.toggleSeatYield(s),
    onDeclareAttack: (s, cardId, targetId) => h.declareHumanAttack(cardId, targetId, s),
    onConfirmBlockers: (_s, ids) => h.confirmBlockersFor(ids),
    onPassBlocks: () => h.passHumanBlocks(),
    onChooseMana: (_s, color) => h.chooseManaColor(color),
    onCancelManaChoice: () => h.cancelManaChoice(),
    onChooseMyriadTapMana: () => h.chooseMyriadLandscapeTapMana(),
    onChooseMyriadTapSearch: () => h.chooseMyriadLandscapeSearch(),
    onCancelMyriadTapChoice: () => h.cancelMyriadTapChoice(),
    onCloseMyriadSearch: () => h.closeMyriadSearch(),
    onCompleteMyriadSearch: (_s, ids) => h.completeMyriadLandscape(ids),
    onCloseBasicLandFetchSearch: () => h.closeBasicLandFetchSearch(),
    onCompleteBasicLandFetchSearch: (_s, cardId) => h.completeBasicLandFetch(cardId),
    onCloseLibrarySearch: (s) => h.closeLibrarySearch(s),
    onSearchLibraryCardToHand: (s, cardId, destination) => h.searchOrChooseLibraryCard(s, cardId, destination),
    onFinishLibrarySearch: () => h.finishRuleLibrarySearch(),
    onSacrificeRuleSource: () => h.sacrificeRuleChoiceSource(),
    onPayCumulativeUpkeep: () => h.payCumulativeUpkeep(),
    onAcceptMiracle: (_s, face) => h.acceptMiracleOffer(face),
    onDeclineMiracle: () => h.declineMiracleOffer(),
    onAcceptOptionalTrigger: () => h.acceptOptionalTrigger(),
    onDeclineOptionalTrigger: () => h.declineOptionalTrigger(),
    onAcceptCommanderZoneChoice: () => h.acceptCommanderZoneChoice(),
    onDeclineCommanderZoneChoice: () => h.declineCommanderZoneChoice(),
    onCompleteDiscardChoice: (_s, ids) => h.completeDiscardChoice(ids),
    onCompletePutCardsOnLibrary: (_s, ids) => h.completePutCardsOnLibrary(ids),
    onCompleteConniveDiscard: (_s, ids) => h.completeConniveDiscard(ids),
    onCompleteReturnLandToHand: (_s, ids) => h.completeReturnLandToHand(ids),
    onCompleteChoosePermanentToBlink: (_s, ids) => h.completeChoosePermanentToBlink(ids),
    onChooseCreatureType: (_s, type) => h.chooseCreatureTypeChoice(type),
    onChooseColor: (_s, color) => h.chooseColorChoice(color),
    onConfirmAttackTriggerManaColors: (_s, distribution) => h.confirmAttackTriggerManaColors(distribution),
    onChooseGraveyardReanimationTarget: (_s, seatId, cardId) => h.chooseGraveyardReanimationTarget(seatId, cardId),
    onChooseSacrificeCostTarget: (s, _seat, cardId) => h.chooseSacrificeCostTarget(s, cardId),
    onChooseEachPlayerSacrifice: (s, _seat, cardId) => h.chooseEachPlayerSacrificeTarget(s, cardId),
    onChooseCreatureToSacrificeForCast: (s, _seat, cardId) => h.chooseCreatureToSacrificeForCast(s, cardId),
    onChooseModalOption: (_s, index) => h.chooseModalOption(index),
    onChooseModalSet: (_s, positions) => h.completeCastModeSet(positions),
    onChooseEffectTarget: (_s, target) => h.chooseEffectTarget(target),
    onDeclineEffectTarget: () => h.declineEffectTarget(),
    onConfirmProliferateTargets: (_s, cardIds, seatIds) => h.chooseProliferateTargets(cardIds, seatIds),
    onChooseBattlefieldCreatureTarget: (_s, seatId, cardId) => h.chooseBattlefieldCreatureTarget(seatId, cardId),
    onChooseAuraRetarget: (_s, seatId, cardId) => h.chooseAuraRetarget(seatId, cardId),
    onChooseEquipTarget: (_s, cardId) => h.confirmEquipTarget(cardId),
    onChooseNextTrigger: (_s, cardId) => h.chooseNextUpkeepTrigger(cardId),
    onKeepLibraryLookCardOnTop: (_s, cardId) => h.keepLibraryLookCardOnTop(cardId),
    onOrderLibraryLookCardOnTop: (_s, cardId) => h.orderLibraryLookCardOnTop(cardId),
    onPutLibraryLookCardOnBottom: (_s, cardId) => h.putLibraryLookCardOnBottom(cardId),
    onPutLibraryLookCardInGraveyard: (_s, cardId) => h.putLibraryLookCardInGraveyard(cardId),
    onSendLibraryLookCardToHand: (_s, cardId) => h.sendLibraryLookCardToHand(cardId),
    onRepeatVaultLook: () => h.repeatLimDulVault(),
    onKeepVaultLookCards: () => h.keepLimDulVaultCards(),
    onCloseLibraryLook: () => h.closeLibraryLook()
  };
  return table as unknown as Record<GuestIntentName, Call>;
}

/**
 * The whitelist: one registry entry per INTENT_SPECS name (validation + state/seat check + call). The acting seat is always the sender's.
 * `deps.handlers` is read when an intent runs, not when the registry is built (the host builds a fresh one per commit).
 */
export function buildMpIntentRegistry(deps: MpIntentDeps): IntentRegistry {
  const calls = callTable(deps.handlers);
  const registry: IntentRegistry = {};
  for (const name of GUEST_INTENT_NAMES) {
    const spec = INTENT_SPECS[name] as IntentSpec;
    const entry: IntentEntry<unknown[]> = {
      schema: spec.schema as IntentEntry<unknown[]>["schema"],
      check: (seatId, ...args) => checkIntentWhen(spec.when, seatId, deps.state) ?? checkIntentArgs(name, seatId, args, deps.state),
      call: (seatId, ...args) => (calls[name] as unknown as (seat: string, ...a: unknown[]) => void)(seatId, ...args)
    };
    registry[name] = entry;
  }
  return registry;
}

type Listener = (event: IntentEvent) => void;

/** Per-guest-slot result of the newest intent the host processed: published in that guest's snapshot so the friend sees why a click did nothing. */
export type IntentAcks = Record<string, { seq: number; error?: string }>;

/**
 * Board-aware refusals for the guest intents that would otherwise trust their arguments. Pure over a session.
 *  - toggle tap: a guest may TAP an untapped permanent of their own battlefield, or take back their own mana tap whose mana is still unspent (the same rule as the
 *    host: untapForManaDecision). Any other untap is refused (the untap step and untap effects are the only legal ways); the command zone has nothing to tap.
 *  - attack: own untapped non-sick non-defender creature that has not attacked yet, aimed at ANOTHER seat that is still in the game or at a planeswalker that
 *    seat controls (the engine's declareAttack would also accept your own seat or planeswalker as a target).
 *  - loyalty: cost and text must be one of the planeswalker's printed loyalty abilities (the handler applies `cost` to the loyalty counters as given).
 */
export function guestRefusals(session: GameSession, mana?: { contributions: Record<string, ManaContribution[]>; pools: Record<string, ManaPool> }): Pick<IntentGameState, "toggleTapRefusal" | "attackRefusal" | "loyaltyRefusal"> {
  const bf = (seatId: string) => session.seats.find((seat) => seat.id === seatId)?.board.battlefield ?? [];
  return {
    toggleTapRefusal: (seatId, cardId, location) => {
      if (location !== "battlefield") return "that card is not a permanent you can tap";
      const card = bf(seatId).find((item) => item.id === cardId);
      if (!card) return "that is not one of your permanents";
      // A tapped permanent may only be a take-back of the guest's OWN unspent mana tap (engine/tapUsed.ts untapForManaDecision); without the mana records, fail closed.
      if (card.tapped) {
        const decision = untapForManaDecision(card, mana?.contributions[seatId] ?? [], mana?.pools[seatId] ?? emptyManaPool());
        return decision.ok ? undefined : decision.reason;
      }
      return undefined;
    },
    attackRefusal: (seatId, cardId, targetId) => {
      const battlefield = bf(seatId);
      const attacker = battlefield.find((item) => item.id === cardId);
      if (!attacker) return "that is not one of your creatures";
      if (!canAttack(attacker, battlefield) || attackLockedOut(session, attacker)) return `${attacker.name} cannot attack right now`;
      const target = resolveAttackTarget(session, targetId);
      if (!target || target.seat.id === seatId || target.seat.hasLost) return "that is not a legal attack target";
      const attackerSeat = session.seats.find((item) => item.id === seatId);
      if (attackerSeat && attackBannedAgainst(attackerSeat, attacker, target.seat)) return `${attacker.name} cannot attack that player`;
      return undefined;
    },
    loyaltyRefusal: (seatId, cardId, cost, text) => {
      const card = bf(seatId).find((item) => item.id === cardId);
      if (!card) return "that is not one of your permanents";
      return parseLoyaltyAbilities(card.oracleText).some((ability) => ability.cost === cost && ability.text === text) ? undefined : "that is not one of this planeswalker's loyalty abilities";
    }
  };
}

/** Reads the host's live state into what the `when` checks need. */
export function readIntentState(ctx: GameContext, paused = false): IntentGameState {
  const { choices, mana, session } = ctx;
  return {
    ...guestRefusals(session, { contributions: mana.manaContributions, pools: mana.manaPools }),
    answerRefusal: (name, seatId, args) =>
      answerRefusal(name, seatId, args, {
        session,
        slots: {
          pendingRuleChoice: choices.pendingRuleChoice,
          libraryLook: choices.libraryLook,
          blockChoice: choices.blockChoice,
          manaChoice: mana.manaChoice,
          myriadTapChoice: choices.myriadTapChoice,
          myriadSearch: choices.myriadSearch,
          basicLandFetchSearch: choices.basicLandFetchSearch,
          manualLibrarySearch: choices.manualLibrarySearch
        }
      }),
    gameStage: ctx.gameStage === "kernel" ? "playing" : ctx.gameStage,
    activeSeatId: ctx.activeSeatId,
    prioritySeatId: ctx.prioritySeatId,
    hasPendingAction: Boolean(ctx.stack.pendingAction),
    phase: session.phase,
    paused,
    owners: promptOwnersOf({
      pendingRuleChoice: choices.pendingRuleChoice,
      libraryLook: choices.libraryLook,
      blockChoice: choices.blockChoice,
      manaChoice: mana.manaChoice,
      myriadTapChoice: choices.myriadTapChoice,
      myriadSearch: choices.myriadSearch,
      basicLandFetchSearch: choices.basicLandFetchSearch,
      manualLibrarySearch: choices.manualLibrarySearch
    }),
    hasKept: (seatId) => Boolean(choices.keptHandsRef.current[seatId]),
    battlefieldIds: (seatId) => session.seats.find((seat) => seat.id === seatId)?.board.battlefield.map((card) => card.id) ?? []
  };
}

/** Returns a ref whose `.current` takes the relay's `intent` events (the host stream calls it), plus the acks to publish. */
export function useMpIntents(ctx: GameContext, enabled: boolean, paused = false): { listenerRef: MutableRefObject<Listener | undefined>; acks: IntentAcks } {
  const queueRef = useRef(new IntentQueue());
  const listenerRef = useRef<Listener | undefined>(undefined);
  const acksRef = useRef<IntentAcks>({});
  const [, setTick] = useState(0);
  const [acks, setAcks] = useState<IntentAcks>({});

  listenerRef.current = (event) => {
    if (!enabled || isLobbyIntentName(event.name)) return; // lobby intents belong to useMpLobby
    if (queueRef.current.push(event)) setTick((n) => n + 1);
  };

  // No deps on purpose: runs after every commit, so each queued intent sees that commit's state and handlers.
  useEffect(() => {
    if (!enabled) return;
    const event = queueRef.current.shift();
    if (!event) return;
    let error: string | undefined;
    if (ctx.mode === "game") {
      const registry = buildMpIntentRegistry({ handlers: ctx.late, state: readIntentState(ctx, paused) });
      const result = dispatchIntent(registry, event, (slot) => seatForSlot(ctx.session, slot));
      if (!result.ok) {
        error = result.reason;
        console.warn(`[mp] intent ${event.name} from ${event.fromSeatId} refused: ${result.reason}`);
      }
    } else {
      error = "the game is not running";
    }
    acksRef.current = { ...acksRef.current, [event.fromSeatId]: { seq: event.clientSeq, ...(error ? { error } : {}) } };
    setAcks(acksRef.current);
    if (queueRef.current.length > 0) setTick((n) => n + 1);
  });

  return { listenerRef, acks };
}
