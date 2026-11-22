// Priority and stack-pass logic plus agent decision context: pendingActionRequiredPasses, canReceivePriorityForPendingAction, prompt
// notes, pending-action summaries and agent card/seat snapshots, shouldConsultRulesAdvisor.
// Extracted verbatim from components/AppFlow.tsx; AppFlow.tsx re-exports the previously public symbols.

import { castModeLabels, hasResolvableTarget } from "@/engine/castTargets";
import { applyChosenFaceToCard, canCastAtInstantSpeed, seatHasFlashGrant, spellCastLockedOut } from "@/engine/casting";
import { describeKeywords } from "@/engine/combat";
import { adjustedCastingCost, maxAffordableX, totalCastingCost } from "@/engine/costs";
import { EMPTY_LOYALTY_KEYS, isPendingActionLikelyIrrelevantToSeat, legalActivatedAbilityActions, legalCounterSpellTargets, legalPriorityActions, seatIsBeingAttacked } from "@/engine/legalActions";
import { chooseManaSourcesForCost, emptyManaPool, payCostFromPool, summarizeAvailableMana } from "@/engine/mana";
import { parseEtbZoneEffect } from "@/engine/oneShotEffects";
import { type PendingAction } from "@/engine/types";
import { parseCounterSpellAbility } from "@/lib/counterSpells";
import { effectivePower, effectiveToughness } from "@/lib/counters";
import { describeDamageShields } from "@/lib/damagePrevention";
import { classifyTell } from "@/lib/lookAhead";
import { deathEffectText, etbEffectText, isActivatedAbilityClause, oracleClauses, parseModalHeader } from "@/lib/oracleClauses";
import { shouldStopForPriority, type PriorityStopSettings } from "@/lib/priorityStops";
import { describeStackItem, type StackItemDescription, type StackItemLike } from "@/lib/stackDescription";
import { priorityStopsForSeat, remoteSeatCanAct, remoteSeatsCanAct } from "@/lib/multiplayer/remoteSeatPolicy";
import { yieldAutoPasses, type YieldMoment } from "@/engine/yieldPolicy";
import { type GameSession, type ManaPool, type PlayerSeat, type VisibleCard } from "@/lib/types";

// Without a session, this used to only send the card's NAME for anything on the stack — meaning
// an agent deciding whether to counter/answer something had to recognize the card from training
// data instead of reading what it actually does, the exact hallucination risk this codebase avoids
// everywhere else (e.g. the Rules Advisor's system prompt explicitly forbids it). Looking up the
// actual source card (still sitting in hand/command for an unresolved spell, or on the battlefield
// for a trigger source) lets the real oracle text ride along instead.
export function pendingActionSourceCard(session: GameSession, action: PendingAction): VisibleCard | undefined {
  if (action.type === "spell") {
    const seat = session.seats.find((item) => item.id === action.actorSeatId);
    return action.sourceZone === "command"
      ? seat?.board.commander
      : action.sourceZone === "exile"
        ? seat?.board.exile?.find((card) => card.id === action.cardId)
        : action.sourceZone === "graveyard"
          ? seat?.board.graveyard?.find((card) => card.id === action.cardId)
          : action.sourceZone === "library"
            ? seat?.library?.find((card) => card.id === action.cardId)
            : seat?.board.hand.find((card) => card.id === action.cardId);
  }
  if (action.type === "trigger") {
    const seat = session.seats.find((item) => item.id === action.controllerSeatId);
    return seat?.board.battlefield.find((card) => card.id === action.sourceCardId);
  }
  return undefined;
}

// UI-only view of a PendingAction that also carries the live source card, so the stack HUD can
// render real card art (VisualCard) instead of just a name string. Never stored in state — derived
// fresh every render from pendingActionSourceCard so it can't go stale if the card's zone/counters
// change while it sits on the stack.
export function withPendingActionSourceCard(session: GameSession, action: PendingAction, stack: PendingAction[] = []): PendingAction & { sourceCard?: VisibleCard; description?: StackItemDescription } {
  const sourceCard = pendingActionSourceCard(session, action);
  // Who controls it, what it does and what it targets (src/lib/stackDescription.ts), for the stack HUD's target lines and "targets you" badge.
  const faceCard = sourceCard && action.type === "spell" ? applyChosenFaceToCard(sourceCard, action.faceIndex) : sourceCard;
  const modeLabels = faceCard && action.type === "spell" ? castModeLabels(faceCard, action.chosenX, action.castChoices) : undefined;
  const description = action.type === "phase" ? undefined : describeStackItem(session, { ...action, sourceCard, modeLabels } as StackItemLike, stack as StackItemLike[]);
  return { ...action, sourceCard, description };
}

export function pendingActionSummary(session: GameSession, action: PendingAction) {
  return {
    id: action.id,
    type: action.type,
    actorSeatId: action.actorSeatId,
    cardName: "cardName" in action ? action.cardName : "sourceCardName" in action ? action.sourceCardName : undefined,
    oracleText: pendingActionSourceCard(session, action)?.oracleText,
    message: action.message,
    // Targets chosen at cast time (a card on someone's battlefield, or a player), so agents can tell whether a spell is aimed at them.
    targetCardIds: action.type === "spell" ? (action.castChoices?.targets ?? []).flatMap((target) => (target.kind === "card" ? [target.cardId] : [])) : undefined,
    targetSeatIds: action.type === "spell" ? (action.castChoices?.targets ?? []).flatMap((target) => (target.kind === "player" ? [target.seatId] : [])) : undefined
  };
}

export function buildAgentDecisionContext(
  session: GameSession,
  seat: PlayerSeat,
  extra: Record<string, unknown>
) {
  return {
    ...extra,
    // Damage-prevention shields live this turn (Fog effects, Inkshield, ...), so an agent doesn't attack into or waste burn on a shielded target.
    activeDamagePrevention: [...describeDamageShields(session), ...(session.combatDamagePrevented?.turn === session.turn ? [`All combat damage is prevented this turn${session.combatDamagePrevented.exceptType ? ` except from ${session.combatDamagePrevented.exceptType} creatures` : ""}.`] : [])],
    you: agentSeatSnapshot(seat, true),
    opponents: session.seats.filter((item) => item.id !== seat.id && !item.hasLost).map((item) => agentSeatSnapshot(item, false))
  };
}

function agentSeatSnapshot(seat: PlayerSeat, includeHand: boolean) {
  return {
    id: seat.id,
    name: seat.name,
    life: seat.life,
    commanderDamage: seat.commanderDamage,
    poison: seat.poison ?? 0,
    availableMana: summarizeAvailableMana(seat),
    commander: seat.board.commander ? agentCardSnapshot(seat.board.commander) : undefined,
    // For counterspell/protection awareness (lookAhead.estimateOpponentInterferenceRisk): the commander's colors, and counterspells /
    // protection tricks this seat has already shown in its graveyard or exile.
    colorIdentity: seat.board.commander?.colorIdentity ?? seat.board.commander?.colors,
    shownTells: (() => {
      const tells = [...(seat.board.graveyard ?? []), ...(seat.board.exile ?? [])].map((card) => classifyTell(card.oracleText, card.typeLine));
      return { counterspells: tells.filter((tell) => tell === "counter").length, protection: tells.filter((tell) => tell === "protection").length };
    })(),
    // Only for the deciding seat's own view ("you"), not an opponent's — this is the agent's own
    // deck's game plan (see bracketPolicy.ts' buildDeckGamePlan), not intelligence about others.
    gamePlan: includeHand ? seat.deck?.gamePlan : undefined,
    hand: includeHand ? seat.board.hand.map(agentCardSnapshot) : { count: seat.board.hand.length },
    battlefield: seat.board.battlefield.map(agentCardSnapshot),
    graveyard: (seat.board.graveyard ?? []).slice(-8).map(agentCardSnapshot),
    exile: (seat.board.exile ?? []).slice(-8).map(agentCardSnapshot),
    libraryCount: seat.library?.length ?? seat.zones.library
  };
}

function agentCardSnapshot(card: VisibleCard) {
  return {
    id: card.id,
    name: card.name,
    typeLine: card.typeLine,
    role: card.role,
    manaCost: card.manaCost,
    manaValue: card.manaValue,
    power: card.power !== undefined ? String(effectivePower(card)) : card.power,
    toughness: card.toughness !== undefined ? String(effectiveToughness(card)) : card.toughness,
    loyalty: card.loyalty,
    tapped: card.tapped,
    summoningSick: card.summoningSick,
    enteredTurn: card.enteredTurn,
    phasedOut: card.phasedOut ? true : undefined,
    // "Loses all abilities" (Utter Insignificance): the oracleText below is NOT in force; read this flag before trusting it.
    abilitiesStripped: card.abilitiesStripped ? true : undefined,
    cantAttack: card.attachmentCantAttack ? true : undefined,
    cantBlock: card.attachmentCantBlock ? true : undefined,
    // Seats this creature may not attack (Vow of Malice, vow counters, Orzhov Advokist, Combat Calligrapher's ban on Inklings) -- the legal attack list already omits them.
    cantAttackSeatIds: [...new Set([...(card.attachmentCantAttackSeatIds ?? []), ...(card.attackBans ?? []).filter((ban) => !ban.whileCounter || (card.counters ?? []).some((counter) => counter.kind === ban.whileCounter && counter.count > 0)).map((ban) => ban.againstSeatId)])].sort().join(",") || undefined,
    lostKeywords: card.lostKeywords?.length ? card.lostKeywords : undefined,
    attacking: card.attacking,
    attackTargetId: card.attacking ? card.attackTargetId : undefined,
    blocking: card.blocking,
    counters: card.counters,
    oracleText: card.oracleText,
    goaded: card.goaded ? true : undefined,
    // What the card can actually do right now in combat terms (printed, granted, until end of turn) — read this rather than the text.
    keywords: describeKeywords(card),
    faces: card.faces?.map((face) => ({ name: face.name, typeLine: face.typeLine, manaCost: face.manaCost, oracleText: face.oracleText })),
    unlockedFaceIndices: card.unlockedFaceIndices,
    interpretedEffects: card.interpretedEffects,
    attachedToId: card.attachedToId,
    grantedKeywords: card.grantedKeywords,
    grantedProtectionColors: card.grantedProtectionColors,
    grantedTypes: card.grantedTypes,
    commander: card.commander,
    commanderTax: card.commanderTax,
    token: card.token
  };
}

export function findSpellSourceCard(session: GameSession, action: Extract<PendingAction, { type: "spell" }>) {
  const actor = session.seats.find((seat) => seat.id === action.actorSeatId);
  return action.sourceZone === "command"
    ? actor?.board.commander
    : action.sourceZone === "exile"
      ? actor?.board.exile?.find((card) => card.id === action.cardId)
      : action.sourceZone === "graveyard"
        ? actor?.board.graveyard?.find((card) => card.id === action.cardId)
        : action.sourceZone === "library"
          ? actor?.library?.find((card) => card.id === action.cardId)
          : actor?.board.hand.find((card) => card.id === action.cardId);
}

export function shouldConsultRulesAdvisor(event: string, card: VisibleCard) {
  if (event === "activated_ability") return true;
  // Sagas (rule 714) gate each numbered chapter's text behind a lore-counter count that only
  // advances over several of the controller's own turns — the advisor has no concept of that
  // gating and reads the card's whole oracle text as one blob, so consulting it on ETB (event
  // "land_played"/spell cast) would immediately run every later chapter's effect the same turn the
  // Saga entered, instead of waiting for its lore counters to actually reach that chapter. Every
  // Saga instead gets its own chapter-scoped consultation from triggerSagaChapter/
  // applySagaLoreCounter/advanceSagaLoreCounters, fired at the right lore-counter threshold — this
  // exclusion just stops the normal ETB/cast consultation path from misfiring on the whole card.
  // event "saga_chapter" is exempted: by the time triggerSagaChapter calls consultRulesAdvisor with
  // it, oracleText has already been narrowed to just that one chapter's own clause (not the whole
  // card), so there's no whole-card-blob risk left to guard against — and without this exemption,
  // deterministicRuleWorkflow's search_library_to_battlefield workflow (and its manaValueRestriction,
  // added for exactly this case) never actually runs for a search-shaped chapter like Urza's Saga's
  // own chapter III, which fell through to the weaker LLM-only primitive-action planner instead.
  if (event !== "saga_chapter" && card.typeLine.includes("Saga")) return false;
  // A land's ETB is now checked against parseZoneEffect deterministically before this ever runs
  // (see playCard's playingAsLand branch) — Bojuka Bog's "exile target player's graveyard" and the
  // rest of that shape (mill/reanimate/regrow/graveyard_to_library/gain_control/...) are already
  // resolved by the time this is reached, so consulting the advisor too would either redundantly
  // re-ask about the same clause or, worse, offer a confusing second manual_review prompt for an
  // effect that already happened.
  if (event === "land_played" && parseEtbZoneEffect(etbEffectText(card.oracleText))) return false;
  // Scope the pattern match to the card's own standing/triggered text, not text describing what an
  // OPTIONAL activated ability's cost or effect does — e.g. Phyrexian Tower's "{T}, Sacrifice a
  // creature: Add {B}{B}." contains "sacrifice", but that's a cost the controller chooses to pay,
  // not something that happens on its own. Without this, playing the land at all (event
  // "land_played") would consult the advisor purely because that word appears somewhere on the
  // card, with nothing relevant for the advisor to actually resolve — and an LLM asked "what should
  // happen" about a card whose only matching text is a sacrifice cost can hallucinate an actual
  // sacrifice.
  // "~ enters the battlefield tapped[, unless/because ...]." (Myriad Landscape, Karplusan Forest,
  // Bojuka Bog, and the huge share of nonbasic lands templated this way) is a static replacement
  // clause, not a "when ~ enters" triggered ability — it's already fully handled by the tapped flag
  // set at the moment the land is played. But it's plain prose that happens to contain the word
  // "enters," so without this it matched the "enters" keyword below on nearly every tapped land
  // played, wastefully consulting the advisor (and often landing on a pointless manual_review
  // prompt) for a card with nothing left for it to actually resolve.
  //
  // For an ETB or death event specifically, scope to etbEffectText/deathEffectText — the exact same
  // scoping requestRuleWorkflow's own deterministicRuleWorkflow applies via eventRelevantOracleText
  // — rather than this function's own looser "just drop activated-ability clauses" filter. Without
  // this, a clause genuinely irrelevant to THIS event (Skullclamp's "Whenever equipped creature
  // dies, draw two cards." — a real trigger, just not an ETB one) still leaked its "whenever"/"dies"/
  // "draw cards" keywords into the pre-check for a "spell_resolved_to_battlefield" consultation,
  // triggering one anyway. The deterministic classifier then correctly found nothing (its own
  // properly-scoped text was just "Equipped creature gets +1/-1.", matching no known shape) and fell
  // through to Ollama — which, asked to classify a bare static-bonus line as some kind of workflow,
  // hallucinated an unrelated explanation about death triggers and counters. Reproduced live.
  const isEtbEvent = event === "land_played" || event === "spell_resolved_to_battlefield";
  const isDeathEvent = event === "card_moved_to_graveyard";
  // The "~ enters tapped" replacement clause has to be dropped from the ORIGINAL, still-per-line
  // oracle text, before etbEffectText ever joins lines together — dropping it afterward (on the
  // already-space-joined blob) let the prefix match consume an entire merged clause, silently
  // swallowing a genuine second ETB trigger that happened to share a line with it once joined.
  // Reproduced live: Temple of Deceit's "This land enters tapped.\nWhen this land enters, scry 1...."
  // joins into one string, whose START still literally reads "this land enters tapped" — so the old
  // post-join filter matched that as a prefix and threw away the whole clause, scry trigger
  // included, and the land never actually scried. Filtering per original line first still correctly
  // drops a land whose ENTIRE separate line is just the (possibly conditional, e.g. "...unless you
  // control two or more basic lands") tapped clause, with nothing else on it.
  const tappedConditionFilteredOracleText = isEtbEvent
    ? oracleClauses(card.oracleText)
        .filter((clause) => !/^[a-z][a-z',. -]* enters (?:the battlefield )?tapped\b/i.test(clause))
        .join("\n")
    : card.oracleText;
  const scopedOracleText = isEtbEvent
    ? etbEffectText(tappedConditionFilteredOracleText)
    : isDeathEvent
      ? deathEffectText(card.oracleText)
      : card.oracleText;
  const text = oracleClauses(scopedOracleText)
    .filter((clause) => !isActivatedAbilityClause(clause))
    .join(" ")
    .toLowerCase();
  if (!text.trim()) return false;
  // "draw a card"/"draw cards" as fixed substrings miss any numbered draw ("draw three cards," a
  // number word or digit sitting between "draw" and "card(s)") — which is exactly Brainstorm's
  // "Draw three cards, then put two cards from your hand on top of your library in any order.": no
  // entry below matched it, so shouldConsultRulesAdvisor returned false and consultRulesAdvisor was
  // never even called, silently dropping both the draw and the put-back (parseSimpleDrawEffect
  // deliberately declines this exact "draw N, then put M back" shape so the rules advisor's
  // draw_then_put_back workflow can own it — see that function's own comment — but nothing reaches
  // that workflow if this gate blocks the call first). Reported live as "Brainstorm still does not
  // work." A bare regex test for the word "draw" covers every numbered/unnumbered phrasing at once.
  if (/\bdraw\b/.test(text)) return true;
  // A bare substring check for "sacrifice " (with a trailing space) never matches "sacrifices" or
  // "sacrificing" — a real card's own wording almost always inflects the verb (Torment of Hailfire's
  // "...unless that player sacrifices a nonland permanent...") rather than using the bare infinitive,
  // so this gate silently rejected nearly every sacrifice-shaped card it was meant to catch. "sacrific"
  // (no trailing space) covers every inflection at once, the same way the \bdraw\b check just above
  // already covers every numbered draw.
  if (/\bsacrific/.test(text)) return true;
  return [
    "when ",
    "whenever ",
    "at the beginning",
    "enters",
    "dies",
    "search your library",
    "create ",
    "return ",
    "exile ",
    "surveil",
    "scry"
  ].some((pattern) => text.includes(pattern));
}

export function isStackAction(action: PendingAction): action is Extract<PendingAction, { type: "spell" | "trigger" }> {
  return action.type === "spell" || action.type === "trigger";
}

// Rule 117.3b: a player who casts a spell/activates an ability receives priority again
// immediately afterward, before anyone else does — they can hold priority to cast a second spell
// in response to their own first one (the actor used to be structurally excluded here, so the
// caster of a spell could never respond to it themselves; fixed by including them like anyone
// else who's able to act, with nextPrioritySeatId giving them first crack below).
export type CanReceivePriority = (seat: PlayerSeat, action: PendingAction) => boolean;

// Public, context-based signature used throughout AppFlow; delegates to the predicate-injected core below
// (which src/engine/stack.ts uses, having no session/mana/stops context of its own).
export function pendingActionRequiredPasses(
  seats: PlayerSeat[],
  action: PendingAction,
  activeSeatId: string | undefined,
  session: GameSession,
  manaPools: Record<string, ManaPool>,
  stops: PriorityStopSettings,
  holdPriorityOnceSeatId: string | undefined,
  remoteCanAct: boolean = remoteSeatsCanAct,
  stack: PendingAction[] = []
) {
  return pendingActionRequiredPassesWithPredicate(seats, action, (seat, a) => canReceivePriorityForPendingAction(seat, a, activeSeatId, session, manaPools, stops, holdPriorityOnceSeatId, remoteCanAct, stack));
}

export function nextPrioritySeatId(
  seats: PlayerSeat[],
  actorSeatId: string,
  passes: string[],
  action: PendingAction,
  activeSeatId: string | undefined,
  session: GameSession,
  manaPools: Record<string, ManaPool>,
  stops: PriorityStopSettings,
  holdPriorityOnceSeatId: string | undefined,
  remoteCanAct: boolean = remoteSeatsCanAct,
  stack: PendingAction[] = []
) {
  return nextPrioritySeatIdWithPredicate(seats, actorSeatId, passes, action, (seat, a) => canReceivePriorityForPendingAction(seat, a, activeSeatId, session, manaPools, stops, holdPriorityOnceSeatId, remoteCanAct, stack));
}

export function pendingActionRequiredPassesWithPredicate(
  seats: PlayerSeat[],
  action: PendingAction,
  canReceivePriority: CanReceivePriority
) {
  if (action.type === "trigger") {
    // An agent's trigger always needs its controller's "pass" (that is how the engine drives it). A HUMAN's own trigger used to
    // demand a manual pass every time; now it asks only when the same stop policy used for spells says to (a real legal
    // response plus a matching stop, or full control / hold-once) and otherwise resolves on its own.
    // Rule 603.3 / 117.4: a trigger on the stack gives EVERY player priority, not just its controller, so every other seat
    // (the human included) is also required whenever the same gate used for spells finds a real legal response for it.
    // This used to return only the agent controller, so an agent's trigger never opened a window for the human. A seat
    // with no response is never added, so a batch of triggers still auto-resolves without a prompt per trigger.
    return seats
      .filter((seat) => {
        // A step's own "at the beginning of ..." trigger (phase_trigger) is the exception: a whole step can have many of them, so its agent
        // controller does not take a pass of its own; the window opens only for a seat with a real response (the fast path resolves the rest).
        if (seat.id === action.controllerSeatId && seat.kind === "agent" && !action.effect.fromPhaseStep) return true;
        return canReceivePriority(seat, action);
      })
      .map((seat) => seat.id);
  }
  return seats
    .filter((seat) => canReceivePriority(seat, action))
    .map((seat) => seat.id);
}

export function nextPrioritySeatIdWithPredicate(
  seats: PlayerSeat[],
  actorSeatId: string,
  passes: string[],
  action: PendingAction,
  canReceivePriority: CanReceivePriority
) {
  const required = pendingActionRequiredPassesWithPredicate(seats, action, canReceivePriority);
  // The actor gets first crack at responding to their own action (rule 117.3b) — only once
  // they've passed does priority move on to the rest of the table in turn order.
  if (required.includes(actorSeatId) && !passes.includes(actorSeatId)) return actorSeatId;
  const startIndex = Math.max(0, seats.findIndex((seat) => seat.id === actorSeatId));
  for (let offset = 1; offset <= seats.length; offset += 1) {
    const seat = seats[(startIndex + offset) % seats.length];
    if (required.includes(seat.id) && !passes.includes(seat.id)) return seat.id;
  }
  return actorSeatId;
}

// After `passerSeatId` passes: priority goes to the next seat in turn order (117.3d) that still has to pass, wrapping around and
// skipping seats that already passed. Unlike nextPrioritySeatIdWithPredicate this has no "actor first" rule: that only applies when
// a window opens (the caster holds priority), and a REOPENED window starts with the active player, so the window's own actor must
// not jump the queue after the first pass. Falls back to the passer if nobody is left.
export function nextSeatAfterPassWithPredicate(
  seats: PlayerSeat[],
  passerSeatId: string | undefined,
  passes: string[],
  action: PendingAction,
  canReceivePriority: CanReceivePriority
) {
  const required = pendingActionRequiredPassesWithPredicate(seats, action, canReceivePriority);
  const startIndex = Math.max(0, seats.findIndex((seat) => seat.id === passerSeatId));
  for (let offset = 1; offset <= seats.length; offset += 1) {
    const seat = seats[(startIndex + offset) % seats.length];
    if (required.includes(seat.id) && !passes.includes(seat.id)) return seat.id;
  }
  return passerSeatId ?? action.actorSeatId;
}

export function nextSeatAfterPass(
  seats: PlayerSeat[],
  passerSeatId: string | undefined,
  passes: string[],
  action: PendingAction,
  activeSeatId: string | undefined,
  session: GameSession,
  manaPools: Record<string, ManaPool>,
  stops: PriorityStopSettings,
  holdPriorityOnceSeatId: string | undefined,
  remoteCanAct: boolean = remoteSeatsCanAct,
  stack: PendingAction[] = []
) {
  return nextSeatAfterPassWithPredicate(seats, passerSeatId, passes, action, (seat, a) => canReceivePriorityForPendingAction(seat, a, activeSeatId, session, manaPools, stops, holdPriorityOnceSeatId, remoteCanAct, stack));
}

// Whether resolving `action` will open a choice prompt for this (human) seat — the "last chance to respond first" cases the stop policy
// should never skip: an edict-style sacrifice or a discard that names this seat, and the human's own optional / option-picking triggers.
// Deliberately narrow (text patterns for the common shapes, not every possible prompt); a false positive only opens a window the player
// can pass, and it is still gated by the seat having a real legal response.
const EDICT_OR_DISCARD_TEXT = /\b(?:each (?:player|opponent|other player)|target (?:player|opponent)|that player|defending player)\b[^.]*?\b(?:sacrifices?|discards?)\b/i;
function pendingActionWillPromptSeat(seat: PlayerSeat, action: PendingAction, session: GameSession): boolean {
  if (seat.kind !== "human") return false;
  if (action.type === "spell") {
    const text = findSpellSourceCard(session, action)?.oracleText ?? "";
    if (!text) return false;
    if (EDICT_OR_DISCARD_TEXT.test(text)) return true;
    return action.actorSeatId === seat.id && /\byou sacrifice (?:a|an|one|two|x) /i.test(text);
  }
  if (action.type === "trigger" && action.controllerSeatId === seat.id) {
    return Boolean(action.effect.optional) || action.effect.kind === "put_any_from_hand" || action.effect.kind === "modal";
  }
  return false;
}

// The line shown on a stack entry when resolving it will make this (human) seat choose something, so the player knows this is the moment to
// respond (sacrifice things their own way, cast the instant) — the choice itself only appears once it resolves, and nothing can be done then.
export function resolutionPromptNote(seat: PlayerSeat, action: PendingAction, session: GameSession): string | undefined {
  if (!pendingActionWillPromptSeat(seat, action, session)) return undefined;
  if (action.type === "trigger") return "When this resolves you'll be asked whether to do it. Respond first if you want to.";
  const text = action.type === "spell" ? (findSpellSourceCard(session, action)?.oracleText ?? "") : "";
  if (/\bsacrifices? all\b/i.test(text)) return "When this resolves you sacrifice permanents with no choice. Respond first if you want to deal with them another way.";
  if (/\bsacrifices?\b/i.test(text)) return "When this resolves you must choose what to sacrifice. Respond first to sacrifice things your own way.";
  if (/\bdiscards?\b/i.test(text)) return "When this resolves you must choose what to discard. Respond first if you want to play or use cards.";
  return "When this resolves you'll be asked to choose. Respond first if you want to.";
}

/** The facts yieldPolicy.ts needs about this seat and (optionally) the spell/ability on the stack. Exported for the yield effect, which clears ended yields with the same facts. */
export function yieldMomentFor(
  seat: PlayerSeat,
  action: PendingAction | undefined,
  session: GameSession,
  activeSeatId: string | undefined,
  stops: PriorityStopSettings,
  holdPriorityOnceSeatId: string | undefined
): YieldMoment {
  const seatStops = priorityStopsForSeat(seat, stops, session.seats.indexOf(seat), session.seats.length);
  const description = action && action.type !== "phase" ? withPendingActionSourceCard(session, action).description : undefined;
  return {
    seatId: seat.id,
    turn: session.turn,
    phase: session.phase,
    activeSeatId,
    beingAttacked: seatIsBeingAttacked(session, seat.id),
    fullControl: seatStops.fullControl,
    holdOnce: holdPriorityOnceSeatId === seat.id || Boolean(seatStops.holdOnce),
    pending: description ? { controllerSeatId: description.controllerSeatId, targetSeatIds: description.targets.map((target) => target.seatId), sourceName: `${description.controller}'s ${description.source}` } : undefined
  };
}

export function canReceivePriorityForPendingAction(
  seat: PlayerSeat,
  action: PendingAction,
  activeSeatId: string | undefined,
  session: GameSession,
  manaPools: Record<string, ManaPool>,
  stops: PriorityStopSettings,
  holdPriorityOnceSeatId: string | undefined,
  remoteCanAct: boolean = remoteSeatsCanAct,
  // Every item currently on the stack (the pending `action` is added automatically); lets a counterspell be judged against deeper spells.
  stack: PendingAction[] = []
) {
  if (seat.hasLost) return false;
  // A friend's seat that cannot respond yet (no pass/respond intents) is never waited on: it counts as having passed every window.
  if (!remoteSeatCanAct(seat, remoteCanAct)) return false;
  if (seat.kind === "agent") {
    // Used to unconditionally return true here, meaning every agent seat — even ones holding zero
    // instant-speed cards or usable abilities — had to individually "confirm" passing on every
    // single phase transition, each needing its own decision-timer delay and (with a real model
    // configured) LLM round trip. That's what makes turns crawl in real play: three idle agents
    // each getting asked whether they want to do something during untap/upkeep/draw/combat
    // damage/cleanup, phases where a response was never actually possible for them. Mirrors the
    // human check below: only require a pass when there's a genuine response available. Agents have
    // no stops UI of their own — the priorityStops policy (phase grid, full control, hold-once) is
    // human-only, so this branch is untouched by it.
    return legalPriorityActions(seat, action, activeSeatId, session).some((item) => item.actionType !== "pass_priority");
  }
  // "Yield until end of turn": a yielding human seat passes this window on its own (see yieldPolicy.ts; cancelled by a spell aimed at it, an attack, Full Control, ...).
  if (stops.yields?.[seat.id] && yieldAutoPasses(stops.yields[seat.id], yieldMomentFor(seat, action, session, activeSeatId, stops, holdPriorityOnceSeatId))) return false;
  const pool = manaPools[seat.id] ?? emptyManaPool();
  const flashGranted = seatHasFlashGrant(seat);
  // A human whose only legal instant-speed response is an activated ability on a battlefield
  // permanent (not a card in hand) previously never had a priority window opened for them at all —
  // this loop only ever checked seat.board.hand, so e.g. a usable instant-speed sacrifice ability
  // was silently unreachable via priority even though the agent side of this same function already
  // covered it (legalPriorityActions, which the agent branch above delegates to, already includes
  // legalActivatedAbilityActions). sorcerySpeedAllowed=false/EMPTY_LOYALTY_KEYS matches exactly how
  // legalPriorityActions calls it for the instant-speed-only case.
  // Cards the human could actually cast as a response: instants/flash in hand, plus exiled cards they currently have
  // permission to cast (impulse draw, steal-and-play) — the same two sources respondWithCard and the agent path accept.
  // Previously only the hand was scanned, so a castable exiled instant never opened a window.
  const respondableCards: Array<{ card: VisibleCard; zone: "hand" | "exile" }> = [
    ...seat.board.hand.map((card) => ({ card, zone: "hand" as const })),
    ...session.seats
      .flatMap((s) => s.board.exile ?? [])
      .filter((card) => card.exiledPlayableBySeatId === seat.id && (card.exiledPlayableUntilTurn === undefined || session.turn <= card.exiledPlayableUntilTurn))
      .map((card) => ({ card, zone: "exile" as const }))
  ];
  const castingLockedOut = spellCastLockedOut(session, seat.id, activeSeatId);
  const hasLegalResponse =
    legalActivatedAbilityActions(seat, false, session.turn, EMPTY_LOYALTY_KEYS, session).length > 0 ||
    (!castingLockedOut && respondableCards.some(({ card, zone }) => {
    if (!canCastAtInstantSpeed(card, flashGranted || seatHasFlashGrant(seat, card)) && !(zone === "exile" && card.exiledPlayableAnyTime)) return false;
    // A spell with no legal target (a "destroy target creature" instant on an empty board) isn't a response either —
    // the agent path already filters on this; without it the human was asked to pass for a card they could never cast.
    if (!hasResolvableTarget(session, seat.id, card)) return false;
    // A type-restricted counterspell ("counter target creature/noncreature/commander spell") isn't
    // a real response option if it can't legally target what's actually on the stack — without this,
    // a human whose only instant-speed card was e.g. Negate got offered a priority window (and the
    // "Respond"/"Pass Priority" choice) against a creature spell it can never legally counter, when
    // the window should never have opened at all — same gap already closed in respondWithCard and
    // selectedCardCanRespond, just missing from the check that decides whether to open the window
    // in the first place. This also covers action.type !== "spell" (a plain phase-pass or a trigger
    // window, i.e. nothing on the stack at all): "counter target spell" is a mandatory target, so a
    // pure counterspell can't legally be cast when there's no spell to target, and a priority window
    // shouldn't open on its account either. A modal card is skipped here (matches
    // hasResolvableGenericCreatureTarget's same carve-out) since it may have a non-counter mode that's
    // perfectly castable with no spell on the stack; this check has no per-mode logic of its own, so
    // excluding it would risk hiding a genuinely legal response rather than just an illegal one.
    const counterAbility = parseCounterSpellAbility(card.oracleText);
    if (counterAbility && !parseModalHeader(card.oracleText)) {
      // A counterspell may target ANY spell on the stack, not only the top one: judge the whole stack plus the pending window.
      if (legalCounterSpellTargets(session, [...stack, action], counterAbility).length === 0) return false;
    }
    const fixedCost = adjustedCastingCost(seat, card, card.manaValue, zone, activeSeatId, session.seats);
    const chosenX = maxAffordableX(seat, card, fixedCost);
    const totalCost = totalCastingCost(seat, card, card.manaValue, chosenX, session.seats);
    // A human hasn't necessarily tapped anything into their mana pool yet at this point — that
    // normally happens once they actually get priority and choose to respond. Checking only
    // payCostFromPool's already-tapped pool here meant a human with untapped lands and a castable
    // instant was never even offered a priority window: they needed priority to tap mana, but only
    // got priority if mana was already tapped. chooseManaSourcesForCost simulates tapping directly
    // from the battlefield (same color-aware logic already used for agents), so check that too.
    return payCostFromPool(pool, card, totalCost).ok || chooseManaSourcesForCost(seat, card, totalCost, undefined, session.seats).ok;
  }));
  const turnOwnerSeatIndex = Math.max(0, session.seats.findIndex((item) => item.id === activeSeatId));
  // A remote friend is judged by THEIR OWN stop settings (same defaults and rules as the host), never by the host's.
  const seatStops = priorityStopsForSeat(seat, stops, session.seats.indexOf(seat), session.seats.length);
  return (
    shouldStopForPriority({
      settings: seatStops,
      phase: session.phase,
      turnOwnerSeatIndex,
      actionType: action.type,
      actionIsMine: action.actorSeatId === seat.id,
      hasLegalResponse,
      isDefendingPlayer: seatIsBeingAttacked(session, seat.id),
      // isPendingActionLikelyIrrelevantToSeat was written to judge a SPELL/TRIGGER's oracle text —
      // a bare "phase" action has none, so it early-returns false ("not irrelevant") for every single
      // one, which inverted to actionAffectsMe: true would make "stop when I/my permanents are
      // targeted" fire on literally every phase transition on every seat's turn, not just real
      // targeted effects. Reported live: a human with only stopOnTargeted (+ stack response/attacked/
      // a ticked End Step) configured was asked to pass priority at every single phase of every
      // agent's turn. A phase-pass can never target anyone — there's no effect to be affected by.
      actionAffectsMe: action.type !== "phase" && !isPendingActionLikelyIrrelevantToSeat(seat, action, session),
      holdOnce: holdPriorityOnceSeatId === seat.id || Boolean(seatStops.holdOnce),
      willPromptMe: pendingActionWillPromptSeat(seat, action, session)
    }) !== undefined
  );
}
