// One-shot effect parsers and appliers: simple life/draw/mass pump/bounce parsing, primitive-action plans, connive, dig picks,
// emblems, each-player-sacrifice, punisher choices, Living Death, surveil/hideaway helpers.
// Extracted verbatim from components/AppFlow.tsx; AppFlow.tsx re-exports the previously public symbols.

import { primitiveActionPlanCache, ruleWorkflowCacheKey } from "@/lib/agentRuntime";
import { chooseNonlandPermanentToSacrifice } from "@/engine/abilities";
import { agentPumpTarget, agentRemovalEffectTarget, agentZoneEffectTargets } from "@/engine/castTargets";
import { applyPrimitiveAction, castTargetLegal, choosePlaguecrafterSacrifice, chooseWorstHandCardToDiscard, matchesEachPlayerSacrificeFilter, type MassPumpEffect, type PrimitiveAction } from "@/engine/effects";
import { destroyCreatures, moveCardAcrossSeats } from "@/engine/entry";
import { capitalizeWord, isBasicLandCard, numberWordToInt } from "@/engine/shared";
import { type CastChoices } from "@/engine/types";
import { applyCounterDelta, moveCardBetweenVisibleZones, rulesEvent, shuffleCards } from "@/engine/zones";
import { cardMatchesTypeFilter, oracleClauses } from "@/lib/oracleClauses";
import { emblemDisplayName, type DelayedPhaseTrigger } from "@/lib/phaseTriggers";
import { type PrimitiveActionStep } from "@/lib/primitiveActionPlan";
import { type RemovalTargetType } from "@/lib/removalSpells";
import { zoneEffectTargetSpec } from "@/lib/targetSpecs";
import { type ChosenTarget } from "@/lib/targeting";
import { hasCardType } from "@/lib/typeGrants";
import { type EmblemState, type GameSession, type PlayerSeat, type VisibleCard } from "@/lib/types";
import { parseZoneEffect, type RegrowTargetType, type ZoneEffect } from "@/lib/zoneEffects";

// Same as parseZoneEffect, except "surveil N" is left out: a surveil is the rules advisor's look-at-top workflow (human prompt, agent
// agentSurveilDecision), never a silent auto-resolution in the ETB/land/spell resolution paths that used to claim it as a "zone effect".
export function parseEtbZoneEffect(text: string): ZoneEffect | undefined {
  const effect = parseZoneEffect(text);
  return effect?.kind === "surveil" ? undefined : effect;
}

// "Put a number of +1/+1 counters equal to that spell's mana value on up to one target creature."
// (Dusty Parlor) — the same "a dynamic amount spelled out in prose instead of abbreviated to X"
// shape substituteX already resolves, just for a specific manaValue-sized counter count rather than
// a general X. Only ever called with the just-cast spell's own manaValue (findCastTriggers is the
// only context that knows what was cast), so "that spell's"/"its own"/"its" all resolve to the same
// number here.
export function substituteManaValueCount(text: string, manaValue: number): string {
  return text.replace(
    /\ba number of ([a-z0-9+/-]+ )?counters?\s+equal to (?:that spell'?s|its own|its) mana value\b/gi,
    (_, kind) => `${manaValue} ${kind ?? ""}counters`
  );
}

// "You gain N life."/"You lose N life." as an EXTRA clause on a spell whose main effect is
// something else entirely (Locthwain Scorn's "Target creature gets -3/-3 until end of turn. You
// gain 2 life." — a very common real-card template pairing removal/pump with a flat life change) —
// a plain substring search rather than an anchored match, since it only ever runs alongside
// removalEffect/pumpEffect/massPumpEffect above (each of which already owns matching its own single
// sentence) and just needs to notice this second, independent sentence anywhere in the same text.
export function parseSimpleLifeChange(text: string): { kind: "gain_life" | "lose_life"; amount: number } | undefined {
  const lower = text.toLowerCase();
  // "You gain 4 life for each creature you control with power 4 or greater." scales; the flat amount here would be wrong.
  if (/\byou gain\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\s+for each\b/.test(lower)) return undefined;
  const gainMatch = lower.match(/\byou gain\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\b/);
  if (gainMatch) {
    const amount = numberWordToInt(gainMatch[1]);
    if (amount) return { kind: "gain_life", amount };
  }
  // "You draw two cards AND LOSE 2 life." (Night's Whisper, Ambition's Cost) — the lose half has no second
  // "you", which the plain "you lose N life" match never accepted, so the draw happened and the life
  // payment never did.
  const loseMatch = lower.match(/\b(?:you lose|and lose)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\b/);
  if (loseMatch) {
    const amount = numberWordToInt(loseMatch[1]);
    if (amount) return { kind: "lose_life", amount };
  }
  return undefined;
}

// "Draw two cards." (Village Rites, and the same plain-draw shape on plenty of other instants/
// sorceries) — Village Rites' own sacrifice is an additional COST (paid at cast time, not part of
// this resolution effect at all), so this only ever needs to model the draw itself. Deliberately
// scoped to non-battlefield destinations only (see its call site) — a permanent's own ETB "draw a
// card" trigger is already fully owned by commonTriggerEffect's draw_cards case and the queued-
// trigger system (findCommonTriggersForPermanentEntered); applying this here too for a permanent
// would double the draw.
export function parseSimpleDrawEffect(text: string): { amount: number } | undefined {
  const lowered = text.toLowerCase();
  // Symmetric draws are owned by spellExtras (Secret Rendezvous, Cut a Deal) — a plain "draw three cards" here gave only
  // the caster the cards.
  if (/\bdraw a card for each\b/.test(lowered)) return undefined;
  // "Draw three cards. Then discard two cards unless you discard an artifact card." (Thirst for Knowledge) and "Draw X cards, then discard a card." (Pull from Tomorrow):
  // the discard half is owned by spellExtras; the bare draw here handed out the cards and never asked for the discard.
  if (/\bdraw (?:a|one|two|three|four|five|\d+|x) cards?(?:,|\.) (?:then )?discard\b/.test(lowered)) return undefined;
  if (/\byou and target opponent each draw\b|\beach opponent draws a card, then you draw/.test(lowered)) return undefined;
  // "Scry 2, then draw two cards." (Read the Bones): the scry workflow performs the draw after the scry.
  if (/^\s*scry \w+,? then draw\b/.test(lowered)) return undefined;
  // "If it's a Zombie card, draw a card." (Cemetery Recruitment) — a CONDITIONAL draw owned by the regrow
  // effect it follows; an unconditional draw here was giving the card for free.
  if (/\bif (?:it'?s|that card is|you do)\b[^.]*,\s*(?:you )?draw\b/.test(lowered)) return undefined;
  // "Draw three cards, then put two cards from your hand on top of your library in any order."
  // (Brainstorm, ...) — the bare draw regex below happily matches the "draw three cards" prefix on
  // its own, which set ownEtbAlreadyHandled and skipped the rules advisor entirely (see this
  // function's call site), silently dropping the "then put back" half. Same ordering fix already
  // applied to commonTriggerEffect's and the deterministic rules-advisor workflow's own
  // drawThenPutBack checks; declining here lets the advisor's draw_then_put_back workflow handle it
  // instead.
  if (
    /\bdraw\s+(a|one|two|three|four|five|\d+)\s+cards?,?\s*then put\s+(a|one|two|three|four|five|\d+)\s+cards?\s+from your hand on top of your library\b/.test(
      lowered
    )
  ) {
    return undefined;
  }
  // "Look at the top three cards of your library, then put them back in any order. You may
  // shuffle. Draw a card." (Ponder, and the same look/reorder-then-draw template on other cards) —
  // same ordering bug as the Brainstorm guard just above: the bare draw regex below happily
  // matches the trailing "Draw a card." on its own, which set ownEtbAlreadyHandled and skipped the
  // rules advisor entirely, silently dropping the whole look/reorder step. Declining here lets the
  // advisor's own reorder_top_cards workflow (rulesAdvisor.ts) handle it instead — see that
  // workflow's matching "put them back in any order" phrasing. Reported live as "Ponder just draws
  // a card, it skipped the whole look at the top 3... put them back" step.
  if (/\bput (?:them|those cards) back in any order\b/.test(lowered)) {
    return undefined;
  }
  const match = lowered.match(/\bdraw\s+(a|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\b/);
  if (!match) return undefined;
  const amount = numberWordToInt(match[1]);
  return amount ? { amount } : undefined;
}

// Board-wide sibling of parseTargetedPump's single-target shape: "Each [non-Type] creature[s] [you
// control/an opponent controls] gets ±N/±N until end of turn." (Exude Toxin's -X/-X board wipe
// mode once substituteX has resolved X, "Each creature you control gets +1/+1 until end of turn"
// anthem-style tricks, ...) — previously entirely unmodeled, so a spell shaped like this (no single
// "target creature" to find) silently did nothing.
export function parseMassPump(text: string): MassPumpEffect | undefined {
  const match = text.match(/\beach (?:non-([a-z]+) )?creatures?(?: (you control)| (an? opponent controls))? gets? ([+-]\d+)\/([+-]\d+) until end of turn\b/i);
  if (!match) return undefined;
  return {
    power: Number.parseInt(match[4], 10),
    toughness: Number.parseInt(match[5], 10),
    excludeType: match[1]?.toLowerCase(),
    scope: match[2] ? "controlled" : match[3] ? "opponents" : "all"
  };
}

// "Return all creatures to their owners' hands." (Evacuation, and the same unqualified mass-bounce
// wording on a few other cards) — previously entirely unmodeled: no TriggerEffect/ZoneEffect kind
// covers "every creature on the battlefield goes to hand," so a spell shaped like this silently did
// nothing at all. Reported live as "Evacuation did not return all creatures to their owners hands."
// Deliberately narrow to this exact unqualified wording — a card that bounces only SOME creatures
// (Whelming Wave's power-4-or-greater restriction, Cyclonic Rift's "don't control," ...) needs its
// own scoped parser and isn't this shape.
// "Return all nonland permanents to their owners' hands." (Devastation Tide) — the same unmodeled
// mass-bounce shape as Evacuation above, just a wider target pool (every permanent, not only
// creatures). Reported live as Devastation Tide doing nothing at all: the old regex only matched
// the literal word "creatures", so this text never matched, and even if it had,
// applyMassBounceEffect's own battlefield filter was hardcoded to creatures only.
export function parseMassBounceEffect(text: string): "creatures" | "nonland_permanents" | undefined {
  if (/\breturn all creatures to their owners'? hands?\b/i.test(text)) return "creatures";
  if (/\breturn all nonland permanents to their owners'? hands?\b/i.test(text)) return "nonland_permanents";
  return undefined;
}

// Safe fallback for a target-type string that either wasn't supplied or fell outside
// RemovalTargetType's own vocabulary (e.g. the LLM-facing schema's bare "planeswalker", which
// RemovalTargetType only ever expresses combined with creature/artifact — see removalSpells.ts) —
// "creature" is the single most common real target of a removal-shaped effect, so it's the least
// surprising default rather than refusing the whole step outright.
function toRemovalTargetType(targetType?: string): RemovalTargetType {
  switch (targetType) {
    case "creature":
    case "artifact":
    case "enchantment":
    case "permanent":
    case "land":
    case "nonland_permanent":
      return targetType;
    case "planeswalker":
      return "creature_or_planeswalker";
    default:
      return "creature";
  }
}

function toRegrowTargetType(targetType?: string): RegrowTargetType {
  switch (targetType) {
    case "card":
    case "permanent":
    case "creature":
    case "land":
    case "enchantment":
    case "artifact":
      return targetType;
    default:
      return "creature";
  }
}

// Translates one flat, LLM-facing PrimitiveActionStep (src/lib/primitiveActionPlan.ts) into this
// file's own richer, nested PrimitiveAction — the one place that gap is bridged, so every other
// consumer of PrimitiveAction (applyPrimitiveAction itself, the deterministic parsers already
// wired into it) stays untouched. Returns undefined for a step whose required fields are missing
// (a small model omitting a field it was supposed to fill in) — declined rather than guessed at,
// same convention as every deterministic parser in this file.
function mapPrimitiveActionStep(step: PrimitiveActionStep): PrimitiveAction | undefined {
  switch (step.kind) {
    case "destroy_target":
      return { kind: "removal", effect: { kind: "destroy", targetType: toRemovalTargetType(step.targetType), excludedColors: [], artifactsExcluded: false, basicsExcluded: false } };
    case "destroy_all": {
      const targetType = step.targetType === "artifact" || step.targetType === "enchantment" ? step.targetType : "creature";
      return { kind: "removal", effect: { kind: "destroy_all", targetType, excludedColors: [] } };
    }
    case "exile_target":
      return { kind: "removal", effect: { kind: "exile", targetType: toRemovalTargetType(step.targetType), lifeGainToControllerEqualToPower: false } };
    case "bounce_target":
      return { kind: "removal", effect: { kind: "bounce", targetType: toRemovalTargetType(step.targetType) } };
    case "reanimate":
      return { kind: "zone", effect: { kind: "reanimate", anyGraveyard: step.anyGraveyard ?? false, targetType: toRegrowTargetType(step.regrowTargetType) } };
    case "mill":
      return step.amount ? { kind: "zone", effect: { kind: "mill", amount: step.amount, scope: step.millScope ?? "you" } } : undefined;
    case "draw_cards":
      return step.amount ? { kind: "draw_cards", amount: step.amount } : undefined;
    case "drain":
      return step.amount ? { kind: "drain", amount: step.amount, scope: step.drainScope ?? "target_player" } : undefined;
    case "damage_target":
      return step.amount ? { kind: "removal", effect: { kind: "damage", targetType: step.damageTargetType ?? "creature", amount: step.amount } } : undefined;
    case "discard":
      return step.amount ? { kind: "discard", amount: step.amount, scope: step.discardScope ?? "target_player" } : undefined;
    case "tap_target":
      return { kind: "tap_target", targetType: toRemovalTargetType(step.targetType) };
    case "untap_target":
      return { kind: "untap_target", targetType: toRemovalTargetType(step.targetType) };
    case "life_change":
      return step.lifeDelta
        ? { kind: "life_change", effect: step.lifeDelta > 0 ? { kind: "gain_life", amount: step.lifeDelta } : { kind: "lose_life", amount: -step.lifeDelta } }
        : undefined;
    case "pump_target":
      return step.power !== undefined && step.toughness !== undefined ? { kind: "pump_target", effect: { power: step.power, toughness: step.toughness } } : undefined;
    case "mass_pump":
      return step.power !== undefined && step.toughness !== undefined
        ? { kind: "mass_pump", effect: { power: step.power, toughness: step.toughness, scope: step.massPumpScope ?? "all" } }
        : undefined;
    case "mass_bounce":
      return { kind: "mass_bounce" };
    case "create_tokens":
      return step.tokenCount && step.tokenName
        ? {
            kind: "create_tokens",
            specs: [
              {
                count: step.tokenCount,
                name: step.tokenName,
                colors: step.tokenColors ?? [],
                typeLine: step.tokenTypeLine ?? "Creature",
                power: step.tokenPower !== undefined ? String(step.tokenPower) : undefined,
                toughness: step.tokenToughness !== undefined ? String(step.tokenToughness) : undefined,
                oracleText: "",
                role: "token"
              }
            ]
          }
        : undefined;
    case "put_counters_on_self":
      return step.counterKind && step.amount ? { kind: "put_counters_on_self", counterKind: step.counterKind, amount: step.amount } : undefined;
    case "sacrifice_permanent":
      return { kind: "sacrifice_permanent", scope: step.sacrificeScope ?? "self" };
    case "move_card_zone":
      return step.moveFrom && step.moveTo
        ? { kind: "move_card_zone", from: step.moveFrom, to: step.moveTo, filter: step.moveFilter ?? "worst", count: step.moveCount ?? 1 }
        : undefined;
  }
}

// Folds a whole LLM-produced plan over applyPrimitiveAction one step at a time — steps that fail to
// map (mapPrimitiveActionStep returning undefined) are simply skipped rather than aborting the rest
// of the plan, so a model getting one step wrong doesn't also cost the steps it got right.
// Does this planned step aim at a target (and which of the target pickers above can name one at cast time)?
function planActionNeedsTarget(action: PrimitiveAction): boolean {
  if (action.kind === "pump_target") return true;
  if (action.kind === "zone") return zoneEffectTargetSpec(action.effect) !== undefined;
  return action.kind === "removal" && ["damage", "destroy", "exile", "bounce", "grant_keywords"].includes(action.effect.kind);
}

// An agent's spell the deterministic parsers do not understand is resolved from a Rules Advisor (LLM) plan: text -> steps, which carry no target
// ids (the deterministic appliers pick those). The plan is fetched asynchronously, so only when this card text's plan is already cached (a
// repeat cast, or a card whose plan was fetched earlier this session) can its targets be named at cast time; they are recorded in castChoices
// and handed to the same steps on resolution (applyPrimitiveActionPlan's castTargets), which re-check them. First-ever cast: unchanged.
export function agentPlannedCastChoices(session: GameSession, seatId: string, card: VisibleCard): CastChoices | undefined {
  if (!/\btargets?\b/i.test(card.oracleText)) return undefined;
  const cached = primitiveActionPlanCache.get(ruleWorkflowCacheKey("spell_resolved_to_graveyard", card.oracleText));
  if (!cached || cached.plan.declined || cached.plan.optional || cached.plan.condition) return undefined;
  const targets: ChosenTarget[] = [];
  for (const step of cached.plan.steps) {
    const action = mapPrimitiveActionStep(step);
    if (!action || !planActionNeedsTarget(action)) continue;
    const target =
      action.kind === "removal" ? (action.effect.kind === "modal" ? undefined : agentRemovalEffectTarget(session, seatId, card, action.effect, action.chosenX, false)) :
      action.kind === "zone" ? agentZoneEffectTargets(session, seatId, card, action.effect)?.[0] :
      action.kind === "pump_target" ? agentPumpTarget(session, seatId, card, action.effect) :
      undefined;
    // One unnamed target would shift the rest out of step with the steps that consume them: keep the resolution-time pick instead.
    if (!target) return undefined;
    targets.push(target);
  }
  return targets.length > 0 ? { targets } : undefined;
}

export function applyPrimitiveActionPlan(session: GameSession, seatId: string, sourceCard: VisibleCard, steps: PrimitiveActionStep[], castTargets?: ChosenTarget[]): GameSession {
  // "drain" already moves the caster's own life for a Blood Artist-style effect — the prompt tells
  // the model never to also emit a life_change step for that same gain, but a small local model
  // doesn't reliably follow that (reproduced live: Blood Artist parsed as drain + a redundant
  // life_change lifeDelta=1, which would double the caster's gain if both ran). Dropping any
  // positive life_change step whenever a drain step is present is a deterministic backstop for
  // that specific double-count, not a prompt-only fix — cheaper and more certain than trying to
  // make the model perfectly reliable here.
  const hasDrainStep = steps.some((step) => step.kind === "drain");
  const dedupedSteps = hasDrainStep ? steps.filter((step) => !(step.kind === "life_change" && (step.lifeDelta ?? 0) > 0)) : steps;
  let usedTargets = 0;
  return dedupedSteps.reduce((current, step) => {
    const action = mapPrimitiveActionStep(step);
    if (!action) return current;
    // Targets named as the spell was cast go to the steps that aim at something, in order; one that is no longer legal does nothing (608.2b).
    if (castTargets && planActionNeedsTarget(action)) {
      const named = castTargets[usedTargets++];
      if (!named || !castTargetLegal(current, seatId, sourceCard, named)) {
        return rulesEvent(current, seatId, `${sourceCard.name}'s target is no longer legal; that part of the spell does nothing.`);
      }
      return applyPrimitiveAction(current, seatId, sourceCard, action, named);
    }
    return applyPrimitiveAction(current, seatId, sourceCard, action);
  }, session);
}

export const MODAL_DONE_INDEX = 999;

// The "then discard a card" half of connive (Ledger Shredder, ...) — the draw already happened by
// the time this runs (see finishTriggerResolution's connive branch/startConniveIteration); this
// just moves the chosen card to the graveyard and, if it wasn't a land, puts a +1/+1 counter on the
// connived source. Mirrors resolveTriggerEffect's own connive case, which stays as the deterministic
// (chooseWorstHandCardToDiscard) fallback for pure-function callers that have no pendingRuleChoice
// to route an interactive pick through.
export function applyConniveDiscard(session: GameSession, seatId: string, sourceCardId: string, sourceCardName: string, discardCardId: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const discardCard = seat?.board.hand.find((card) => card.id === discardCardId);
  if (!seat || !discardCard) return session;
  const isNonland = !discardCard.typeLine.includes("Land");
  const seatName = seat.name;
  const discardedSession = moveCardBetweenVisibleZones(session, seatId, discardCardId, "graveyard");
  const countedSession = isNonland
    ? {
        ...discardedSession,
        seats: discardedSession.seats.map((item) =>
          item.id === seatId
            ? {
                ...item,
                board: {
                  ...item.board,
                  battlefield: item.board.battlefield.map((card) => (card.id === sourceCardId ? applyCounterDelta(card, "+1/+1", 1) : card))
                }
              }
            : item
        )
      }
    : discardedSession;
  return {
    ...countedSession,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${sourceCardName} connives: ${seatName} discards ${discardCard.name}${isNonland ? `, putting a +1/+1 counter on ${sourceCardName}` : ""}.`
      },
      ...countedSession.events
    ]
  };
}

// "...the number of colors in your commanders' color identity" (War Room).
export function commanderColorCount(seat: PlayerSeat): number {
  const commanders = [...seat.board.battlefield.filter((card) => card.commander), ...(seat.board.commander ? [seat.board.commander] : [])];
  return new Set(commanders.flatMap((card) => card.colorIdentity ?? card.colors ?? [])).size;
}

// "You may look at an additional two cards each time you surveil." (Enhanced Surveillance) — a
// static bonus to every surveil the controller does, from any source, not just this card's own.
// Narrow to this exact wording, matching this file's other single-card parsers; scry is a distinct
// action this doesn't touch.
function surveilCountBonus(oracleText: string): number {
  const match = oracleText.match(/\byou may look at an additional (\d+|a|one|two|three|four|five) cards? each time you surveil\b/i);
  return match ? numberWordToInt(match[1]) ?? 0 : 0;
}

export function surveilBonusForSeat(seat: PlayerSeat): number {
  return seat.board.battlefield.reduce((total, card) => total + surveilCountBonus(card.oracleText), 0);
}

// "an opponent was dealt 7 or more damage this turn" (Spinerock Knoll): any damage from any source to any one of the controller's opponents.
export function hideawayDamageConditionMet(session: GameSession, controllerSeatId: string, conditionText: string): boolean | undefined {
  // Shelldock Isle: "a library has twenty or fewer cards in it" (any player's). Howltooth Hollow: "each player has no cards in hand".
  const libraryMatch = conditionText.match(/^a library has (\d+|twenty) or fewer cards in it$/);
  if (libraryMatch) {
    const limit = libraryMatch[1] === "twenty" ? 20 : Number.parseInt(libraryMatch[1], 10);
    return session.seats.some((seat) => !seat.hasLost && (seat.library?.length ?? seat.zones.library) <= limit);
  }
  if (conditionText === "each player has no cards in hand") return session.seats.every((seat) => seat.hasLost || seat.board.hand.length === 0);
  const match = conditionText.match(/^an opponent was dealt (\d+) or more damage this turn$/);
  if (!match) return undefined;
  const needed = Number.parseInt(match[1], 10);
  if (session.damageThisTurn?.turn !== session.turn) return false;
  return Object.entries(session.damageThisTurn.bySeat).some(([seatId, dealt]) => seatId !== controllerSeatId && dealt >= needed);
}

export function applyDigPick(session: GameSession, seatId: string, sourceName: string, count: number, typeWord: string, pickedId?: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  const library = seat.library ?? [];
  const top = library.slice(0, count);
  const qualifies = (card: VisibleCard) => card.typeLine.toLowerCase().includes(typeWord);
  const found = pickedId === "none" ? undefined : pickedId ? top.find((card) => card.id === pickedId && qualifies(card)) : top.find(qualifies);
  const rest = top.filter((card) => card.id !== found?.id);
  const seats = session.seats.map((item) => {
    if (item.id !== seatId) return item;
    const remaining = [...library.slice(top.length), ...shuffleCards(rest)];
    return {
      ...item,
      library: remaining,
      board: { ...item.board, hand: found ? [...item.board.hand, { ...found, zone: "hand" as const }] : item.board.hand },
      zones: { ...item.zones, library: remaining.length, hand: item.zones.hand + (found ? 1 : 0) }
    };
  });
  return rulesEvent({ ...session, seats }, seatId, found ? `${seat.name} sacrifices ${sourceName} and puts ${found.name} into their hand.` : `${seat.name} sacrifices ${sourceName} and takes no ${typeWord}.`);
}

// The cards a human's library-search picker may offer: the search's own printed restriction ("Forest card",
// "basic land card", "creature card", a mana-value ceiling) is enforced, so the player can't pick an illegal
// card by mistake (rule 701.19: a search can only find cards that match; an empty list is a legal "fail to
// find"). A placeholder/unrecognized phrase (the rules advisor's generic "cards matching the source effect",
// "basic lands sharing a land type") leaves the whole library visible, as before.
export function searchableLibraryCards(
  library: VisibleCard[],
  choice: {
    allowedCardFilter?: string;
    manaValueRestriction?: { op: "lte" | "eq" | "gte"; value: number };
    // Protean Hulk: the budget still unspent (limit minus the picks' mana values so far).
    remainingTotalManaValue?: number;
  }
): VisibleCard[] {
  const rawFilter = (choice.allowedCardFilter ?? "").toLowerCase().trim();
  const filter = rawFilter.replace(/\s+cards?$/, "").trim();
  const usableFilter = filter && !/^cards?$/.test(filter) && !/matching the source effect|sharing a land type/.test(filter);
  const restriction = choice.manaValueRestriction;
  return library.filter((card) => {
    if (choice.remainingTotalManaValue !== undefined && card.manaValue > choice.remainingTotalManaValue) return false;
    if (usableFilter) {
      // "basic land" / "basic plains" (landcycling): the card must be a basic land, then match the remaining type word if there is one.
      const wantsBasic = /^basic\b/.test(filter);
      const typeWord = (wantsBasic ? filter.replace(/^basic\s*/, "") : filter).replace(/^lands?$/, "").trim();
      if (wantsBasic && !isBasicLandCard(card)) return false;
      if (typeWord && !cardMatchesTypeFilter(card.typeLine, typeWord)) return false;
    }
    if (restriction) {
      if (restriction.op === "lte" && card.manaValue > restriction.value) return false;
      if (restriction.op === "gte" && card.manaValue < restriction.value) return false;
      if (restriction.op === "eq" && card.manaValue !== restriction.value) return false;
    }
    return true;
  });
}

export function remainingLibraryTotalManaValue(
  choice: { totalManaValueLimit?: number; chosenCardIds?: string[] },
  library: VisibleCard[]
): number | undefined {
  if (choice.totalManaValueLimit === undefined) return undefined;
  const chosen = new Set(choice.chosenCardIds ?? []);
  const spent = library.filter((card) => chosen.has(card.id)).reduce((sum, card) => sum + card.manaValue, 0);
  return Math.max(0, choice.totalManaValueLimit - spent);
}

// Rule 111.2/111.7-111.9: "You get an emblem with ..." — one emblem per grant (an emblem that prints several abilities, Saheeli's
// "...+1/+1" and "...cost {1} less", is still ONE emblem; its clauses are kept as separate lines of oracleText, which every parser here already
// reads line by line). Emblems stay in seat.emblems for the rest of the game and are public information.
export function addEmblemToSeat(session: GameSession, seatId: string, sourceName: string, clauses: string[]): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const text = clauses.map((clause) => clause.trim()).filter(Boolean);
  if (!seat || text.length === 0) return session;
  const emblem: EmblemState = { id: crypto.randomUUID(), sourceName, oracleText: text.join("\n") };
  return {
    ...session,
    seats: session.seats.map((item) => (item.id === seatId ? { ...item, emblems: [...(item.emblems ?? []), emblem] } : item)),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${seat.name} gets an emblem from ${sourceName}: ${text.map((clause) => `"${clause}"`).join(" and ")}`,
        detail: "Rules action"
      },
      ...session.events
    ]
  };
}

// "Search your library for a permanent card, put it onto the battlefield, then shuffle." (the clause of a phase trigger) -> the searched type word.
export function parseSearchLibraryPutEffect(clauseText: string): { filter: string; tapped: boolean; optional: boolean } | undefined {
  const match = clauseText
    .replace(/\([^)]*\)/g, "")
    .match(/(?:^|,\s*)(you may )?search your library for an? ([a-z][a-z' -]*?) card, (?:reveal it, )?put it onto the battlefield( tapped)?, then shuffle\.?\s*$/i);
  if (!match) return undefined;
  return { filter: match[2].trim().toLowerCase(), tapped: Boolean(match[3]), optional: Boolean(match[1]) };
}

// Emblem "whenever" watchers that return cards: "Whenever an artifact is put into your graveyard from the battlefield, return that card to the
// battlefield at the beginning of the next end step." (Daretti, Scrap Savant -10) and "Whenever a creature dies, return it to the battlefield
// under your control at the beginning of the next end step." (Liliana, Heretical Healer -8).
interface EmblemReturnWatcher {
  typeWord: string;
  // Whose graveyard counts: "you" = the emblem controller's own ("your graveyard"), "any" = every player's ("a creature dies").
  graveyardOf: "you" | "any";
  // Who controls the card when it returns: its owner, or the emblem's controller.
  returnsUnder: "owner" | "you";
}
function parseEmblemReturnWatchers(oracleText: string): EmblemReturnWatcher[] {
  const out: EmblemReturnWatcher[] = [];
  for (const clause of oracleClauses(oracleText)) {
    const text = clause.replace(/\([^)]*\)/g, "").trim();
    const put = text.match(/^whenever an? ([a-z]+) is put into your graveyard from the battlefield, return that card to the battlefield(?: under your control)? at the beginning of the next end step\.?$/i);
    if (put) out.push({ typeWord: put[1].toLowerCase(), graveyardOf: "you", returnsUnder: /under your control/i.test(text) ? "you" : "owner" });
    const dies = text.match(/^whenever an? ([a-z]+) dies, return it to the battlefield under your control at the beginning of the next end step\.?$/i);
    if (dies) out.push({ typeWord: dies[1].toLowerCase(), graveyardOf: "any", returnsUnder: "you" });
  }
  return out;
}

// Compares two consecutive session snapshots (path-independent: combat damage, destroy spells, sacrifice, state-based actions all end the same way)
// and returns the delayed "return it at the next end step" triggers earned by cards that went battlefield -> graveyard in between. Tokens cease to
// exist in the graveyard (rule 111.7) so they never come back; a card that is not in the graveyard any more when the step arrives is skipped then.
export function findEmblemGraveyardReturns(before: GameSession, after: GameSession): Array<Omit<DelayedPhaseTrigger, "id" | "createdTurn" | "createdPhase">> {
  const found: Array<Omit<DelayedPhaseTrigger, "id" | "createdTurn" | "createdPhase">> = [];
  if (!after.seats.some((seat) => (seat.emblems?.length ?? 0) > 0)) return found;
  const wasOnBattlefield = new Map<string, VisibleCard>();
  for (const seat of before.seats) for (const card of seat.board.battlefield) wasOnBattlefield.set(card.id, card);
  const alreadyGraveyard = new Set(before.seats.flatMap((seat) => (seat.board.graveyard ?? []).map((card) => card.id)));
  for (const emblemSeat of after.seats) {
    for (const emblem of emblemSeat.emblems ?? []) {
      for (const watcher of parseEmblemReturnWatchers(emblem.oracleText)) {
        for (const graveSeat of after.seats) {
          if (watcher.graveyardOf === "you" && graveSeat.id !== emblemSeat.id) continue;
          for (const card of graveSeat.board.graveyard ?? []) {
            if (alreadyGraveyard.has(card.id) || card.token) continue;
            const prior = wasOnBattlefield.get(card.id);
            if (!prior || prior.token) continue;
            if (!hasCardType(prior, capitalizeWord(watcher.typeWord))) continue;
            const ownerSeatId = card.ownerSeatId ?? graveSeat.id;
            found.push({
              controllerSeatId: emblemSeat.id,
              sourceCardId: emblem.id,
              sourceCardName: emblemDisplayName(emblem.sourceName),
              phase: "end step",
              scope: "any",
              effectText: `Return ${card.name} to the battlefield.`,
              returnCard: { cardId: card.id, cardName: card.name, ownerSeatId, controlSeatId: watcher.returnsUnder === "you" ? emblemSeat.id : ownerSeatId }
            });
          }
        }
      }
    }
  }
  return found;
}

// "Each player sacrifices a creature or planeswalker of their choice. If a player can't, they
// discard a card instead." (Plaguecrafter, and the same "everyone independently, not just you or a
// single chosen opponent" edict shape on similar cards) — no existing effect kind models "every
// player does this to themselves" (TriggerEffect's kinds all either affect only the controller, a
// single chosen target, or every OTHER player, never every player symmetrically including the
// controller), so this is detected and applied as its own bespoke ETB shape rather than forced into
// that union. The discardFallback regex previously looked for "if a player can't, they discard a
// card instead" — a phrasing that doesn't match Plaguecrafter's real printed text ("Each player who
// can't discards a card.") at all, so discardFallback was always false for the actual card and this
// whole branch was silently dead code, verified against the real Scryfall-sourced oracle text (this
// codebase's own local card database), not a guess. Reported live as "Plaguecrafter does not let you
// choose what card to discard if you got no creatures" — with the wrong regex, nothing happened for
// that player at all.
export function parseEachPlayerSacrificeEffect(text: string): { typeFilter: string; discardFallback: boolean } | undefined {
  const match = text.toLowerCase().match(/\beach player sacrifices an? ([a-z ]+?) of their choice\b/);
  if (!match) return undefined;
  return { typeFilter: match[1].trim(), discardFallback: /\beach player who can'?t discards? a card\b/i.test(text) };
}

export function applyEachPlayerSacrificeEffect(
  session: GameSession,
  sourceCardName: string,
  effect: { typeFilter: string; discardFallback: boolean }
): { session: GameSession; humanDiscardNeededSeatId?: string; humanSacrificeNeededSeatId?: string } {
  const destructions: Array<{ seatId: string; cardId: string; message: string }> = [];
  const discarders: string[] = [];
  let humanDiscardNeededSeatId: string | undefined;
  let humanSacrificeNeededSeatId: string | undefined;
  for (const seat of session.seats) {
    if (seat.hasLost) continue;
    // A human with a genuine choice (more than one legal creature/planeswalker to sacrifice) picks
    // their own — see the choose_each_player_sacrifice PendingRuleChoice this defers to, opened by
    // the resolvePendingAction call site that reads humanSacrificeNeededSeatId back. A human with 0
    // or 1 candidate has no real decision to make (0 falls through to the discard-fallback branch
    // below exactly as before, 1 has only one possible pick), so both stay on the same deterministic
    // path an agent seat always uses — there's nothing to choose between either way.
    if (seat.kind === "human" && seat.board.battlefield.filter((card) => matchesEachPlayerSacrificeFilter(card, effect.typeFilter)).length > 1) {
      humanSacrificeNeededSeatId = seat.id;
      continue;
    }
    const target = choosePlaguecrafterSacrifice(seat, effect.typeFilter);
    if (target) {
      destructions.push({ seatId: seat.id, cardId: target.id, message: `${seat.name} sacrifices ${target.name} to ${sourceCardName}.` });
    } else if (effect.discardFallback) {
      // A human player chooses which card to discard themselves — see the interactive
      // choose-a-card-to-discard prompt resolvePendingAction opens for humanDiscardNeededSeatId,
      // reusing discard_to_hand_size's picker UI. Only an agent seat gets auto-resolved here.
      if (seat.kind === "human") humanDiscardNeededSeatId = seat.id;
      else discarders.push(seat.id);
    }
  }
  // Sacrifices resolve through the same destroyCreatures pipeline every other death path uses
  // (combat, removal, state-based) so death triggers fire correctly for each of them — Blood
  // Artist's controller draining life off a Plaguecrafter-forced sacrifice needs exactly this, not
  // a direct graveyard move that would silently skip the death-trigger scan entirely.
  let next = destroyCreatures(session, destructions, "Rules action");
  for (const seatId of discarders) {
    const seat = next.seats.find((item) => item.id === seatId);
    const discard = seat ? chooseWorstHandCardToDiscard(seat) : undefined;
    if (!seat || !discard) continue;
    next = moveCardBetweenVisibleZones(next, seatId, discard.id, "graveyard");
    next = {
      ...next,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${seat.name} can't sacrifice a ${effect.typeFilter} and discards ${discard.name} instead.`,
          detail: "Rules action"
        },
        ...next.events
      ]
    };
  }
  return { session: next, humanDiscardNeededSeatId, humanSacrificeNeededSeatId };
}

// Applies the human controller's OWN pick from a choose_each_player_sacrifice choice — every other
// seat's sacrifice/discard has already resolved by the time this runs (see
// applyEachPlayerSacrificeEffect's humanSacrificeNeededSeatId deferral), so this only ever handles
// the one remaining seat. Routed through destroyCreatures, same reasoning as
// applyEachPlayerSacrificeEffect's own sacrifices, so death triggers (Meren, Blood Artist, ...) fire
// correctly for the human's pick too, not just the auto-resolved ones.
export function applyChosenEachPlayerSacrifice(session: GameSession, seatId: string, cardId: string, sourceCardName: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const card = seat?.board.battlefield.find((item) => item.id === cardId);
  if (!seat || !card) return session;
  return destroyCreatures(session, [{ seatId, cardId, message: `${seat.name} sacrifices ${card.name} to ${sourceCardName}.` }], "Rules action");
}

// Braids, Arisen Nightmare: "At the beginning of your end step, you may sacrifice an artifact, creature, enchantment, land, or planeswalker.
// If you do, each opponent may sacrifice a permanent of their choice that shares a card type with it. For each opponent who doesn't, that
// player loses 2 life and you draw a card." A human answers each "may" through a picker (closing it declines); agents decide by heuristic.
export function isBraidsEndStepText(oracleText: string): boolean {
  return /\bat the beginning of your end step, you may sacrifice an artifact, creature, enchantment, land, or planeswalker\b.*\beach opponent may sacrifice\b/is.test(oracleText);
}

// "Repeat the following process X times. Each opponent loses N life unless that player sacrifices a
// nonland permanent or discards a card." (Torment of Hailfire, and the same "punisher" template on
// similarly-worded cards) — X is the spell's own chosenX (the same X-cost convention
// entersWithXCounters/multikicker already use elsewhere), not parsed out of the text itself.
export function parsePunisherChoiceEffect(text: string): { lifeAmount: number } | undefined {
  const match = text
    .toLowerCase()
    .match(/\brepeat the following process \w+ times\.\s*each opponent loses (\d+) life unless that player sacrifices an? nonland permanent(?: of their choice)? or discards a card\b/);
  if (!match) return undefined;
  return { lifeAmount: Number(match[1]) };
}

// No interactive choice exists for a non-controller seat anywhere in this engine yet (the interactive-
// targeting plan tracks per-controller choices as future work; a choice belonging to someone OTHER
// than the spell's own controller isn't even scoped there) — so, same as applyEachPlayerSacrificeEffect
// just below auto-deciding everyone's sacrifice for them, every affected opponent's outcome here is
// auto-decided by a heuristic regardless of seat kind: keep the life loss while it's not dangerous
// (a small, bounded per-iteration amount against Commander's 40 starting life rarely is), otherwise
// give up whatever's cheapest to lose first — a token permanent, then a spare hand card, then a real
// nonland permanent — before finally accepting the life loss as a last resort with nothing left to
// spend. Previously fell entirely to the LLM fallback with no deterministic path at all, and reported
// live as no choice ever being offered to the affected opponent for what the effect actually did.
export function applyPunisherChoiceEffect(session: GameSession, casterSeatId: string, sourceCardName: string, effect: { lifeAmount: number }, times: number): GameSession {
  let next = session;
  // A human victim chooses (lose the life, sacrifice, or discard) each time; their repetitions are queued for the picker.
  const humanVictims = session.seats.filter((seat) => seat.id !== casterSeatId && !seat.hasLost && seat.kind === "human");
  if (humanVictims.length > 0 && times > 0) {
    next = { ...next, pendingPunisherChoices: [...(next.pendingPunisherChoices ?? []), ...humanVictims.map((seat) => ({ seatId: seat.id, sourceName: sourceCardName, lifeAmount: effect.lifeAmount, times }))] };
  }
  for (let iteration = 0; iteration < times; iteration++) {
    for (const seat of next.seats) {
      if (seat.id === casterSeatId || seat.hasLost || seat.kind === "human") continue;
      const current = next.seats.find((item) => item.id === seat.id);
      if (!current) continue;
      const survivesComfortably = current.life - effect.lifeAmount > 10;
      const sacrificeCandidate = survivesComfortably ? undefined : chooseNonlandPermanentToSacrifice(current);
      const tokenToSacrifice = sacrificeCandidate?.token ? sacrificeCandidate : undefined;
      const discardTarget = !survivesComfortably && !tokenToSacrifice ? chooseWorstHandCardToDiscard(current) : undefined;
      const permanentToSacrifice = !discardTarget && !tokenToSacrifice ? sacrificeCandidate : undefined;
      if (tokenToSacrifice) {
        next = destroyCreatures(
          next,
          [{ seatId: seat.id, cardId: tokenToSacrifice.id, message: `${current.name} sacrifices ${tokenToSacrifice.name} to avoid losing ${effect.lifeAmount} life to ${sourceCardName}.` }],
          "Rules action"
        );
      } else if (discardTarget) {
        next = moveCardBetweenVisibleZones(next, seat.id, discardTarget.id, "graveyard");
        next = {
          ...next,
          events: [
            {
              id: crypto.randomUUID(),
              at: new Date().toISOString(),
              seatId: seat.id,
              message: `${current.name} discards ${discardTarget.name} to avoid losing ${effect.lifeAmount} life to ${sourceCardName}.`,
              detail: "Rules action"
            },
            ...next.events
          ]
        };
      } else if (permanentToSacrifice) {
        next = destroyCreatures(
          next,
          [{ seatId: seat.id, cardId: permanentToSacrifice.id, message: `${current.name} sacrifices ${permanentToSacrifice.name} to avoid losing ${effect.lifeAmount} life to ${sourceCardName}.` }],
          "Rules action"
        );
      } else {
        next = {
          ...next,
          seats: next.seats.map((item) => (item.id === seat.id ? { ...item, life: Math.max(0, item.life - effect.lifeAmount) } : item)),
          events: [
            {
              id: crypto.randomUUID(),
              at: new Date().toISOString(),
              seatId: seat.id,
              message: `${current.name} loses ${effect.lifeAmount} life to ${sourceCardName}.`,
              detail: "Rules action"
            },
            ...next.events
          ]
        };
      }
    }
  }
  return next;
}

// "Each player exiles all creature cards from their graveyard, then sacrifices all creatures they
// control, then puts all cards they exiled this way onto the battlefield." (Living Death) — no
// existing effect kind models this "snapshot state, act on everyone, then reanimate exactly what
// was snapshotted" three-step combo (closest is applyEachPlayerSacrificeEffect's "everyone does
// this to themselves" shape just above, but that's a single step with no ordering dependency),
// so it's its own bespoke shape, applied unconditionally to every seat, like that one. Previously
// unhandled by any deterministic parser, reported live as "Living Death did not work."
export function isLivingDeathEffect(text: string): boolean {
  return /\beach player exiles all creature cards from their graveyard,\s*then sacrifices all creatures they control,\s*then puts all cards they exiled this way onto the battlefield\b/i.test(
    text
  );
}

export function applyLivingDeathEffect(session: GameSession, sourceCardName: string): GameSession {
  // Step 1: snapshot and exile each player's own graveyard creatures FIRST, before anything else
  // moves — the creatures that die in step 2 must land in the graveyard as normal (this same spell
  // doesn't bring those back too), only what was already in the graveyard when Living Death resolved.
  let next = session;
  const exiledIdsBySeat = new Map<string, string[]>();
  for (const seat of session.seats) {
    const creatureCardIds = (seat.board.graveyard ?? []).filter((card) => card.typeLine.includes("Creature")).map((card) => card.id);
    if (creatureCardIds.length === 0) continue;
    exiledIdsBySeat.set(seat.id, creatureCardIds);
    for (const cardId of creatureCardIds) {
      next = moveCardBetweenVisibleZones(next, seat.id, cardId, "exile");
    }
  }

  // Step 2: each player sacrifices every creature they control.
  const destructions: Array<{ seatId: string; cardId: string; message: string }> = [];
  for (const seat of next.seats) {
    for (const card of seat.board.battlefield) {
      if (card.typeLine.includes("Creature")) destructions.push({ seatId: seat.id, cardId: card.id, message: `${seat.name} sacrifices ${card.name} to ${sourceCardName}.` });
    }
  }
  next = destroyCreatures(next, destructions, "Rules action");

  // Step 3: each player puts all the cards THEY exiled this way (step 1's snapshot, not anything
  // else that might separately reach exile in between) onto the battlefield under their own control.
  for (const [seatId, cardIds] of exiledIdsBySeat) {
    for (const cardId of cardIds) {
      next = moveCardAcrossSeats(next, seatId, cardId, seatId, "battlefield").session;
    }
  }
  return next;
}

// "When you cast this spell, reveal cards from the top of your library until you reveal X creature cards. Put all creature cards revealed this way
// into your graveyard, then put the rest on the bottom of your library in a random order." (Old Stickfingers) — X is the {X} paid in the spell's
// cost; it only decides HOW MANY creature cards get revealed (it does NOT set power/toughness, which is a graveyard-count CDA). Revealing X = 0
// creature cards reveals nothing. Resolved deterministically at cast time (it has no choices) for humans and agents alike.
export function applyCastRevealUntilCreatures(session: GameSession, seatId: string, card: VisibleCard, chosenX: number | undefined): GameSession {
  const match = card.oracleText
    .toLowerCase()
    .match(/when you cast this spell, reveal cards from the top of your library until you reveal (x|\d+) ([a-z]+) cards?\. put all \2 cards revealed this way into your graveyard, then put the rest on the bottom of your library in a random order/);
  if (!match) return session;
  const wanted = match[1] === "x" ? Math.max(0, chosenX ?? 0) : Number.parseInt(match[1], 10);
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  const typeName = match[2].charAt(0).toUpperCase() + match[2].slice(1);
  const library = seat.library ?? [];
  const revealed: VisibleCard[] = [];
  let found = 0;
  let index = 0;
  while (found < wanted && index < library.length) {
    revealed.push(library[index]);
    if (library[index].typeLine.includes(typeName)) found += 1;
    index += 1;
  }
  const toGraveyard = revealed.filter((item) => item.typeLine.includes(typeName)).map((item) => ({ ...item, zone: "graveyard" as const }));
  const toBottom = shuffleCards(revealed.filter((item) => !item.typeLine.includes(typeName)));
  return {
    ...session,
    seats: session.seats.map((item) =>
      item.id !== seatId ? item : { ...item, library: [...library.slice(index), ...toBottom], board: { ...item.board, graveyard: [...(item.board.graveyard ?? []), ...toGraveyard] } }
    ),
    events: [
      { id: crypto.randomUUID(), at: new Date().toISOString(), seatId, message: `${card.name}: ${seat.name} reveals ${revealed.length} card${revealed.length === 1 ? "" : "s"} and puts ${toGraveyard.length} ${match[2]} card${toGraveyard.length === 1 ? "" : "s"} into their graveyard.`, detail: "Cast trigger" },
      ...session.events
    ]
  };
}
