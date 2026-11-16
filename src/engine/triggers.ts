// Trigger finding and resolution, moved verbatim from components/AppFlow.tsx: findCommonTriggersFor* (ETB/death/leave/...), makeCommonTrigger,
// commonTriggerEffect, resolveTriggerEffect(+Once), phase/end-step triggers, delayed returns, venture/initiative, Braids/Meren end steps.
// Part of a deliberate import cycle with entry.ts / stateBased.ts / effects.ts (function declarations only; the only top-level values
// here are literal constants, so module-init order does not matter).

import { manaValueFromManaCost } from "@/engine/costs";
import { addDamageShieldsFromSpec, applyCombatDamageToTarget, dealDamageToCreature, hasFlying, hasHexproof, hasIndestructible, hasShroud, isProtectedFrom, playerHasHexproof } from "@/engine/damage";
import { applyCounterAccumulationEffect, applyDiscardEffect, applyDrainEffect, applyDrawXThenPutBack, applyGenericModalEffect, applyMassPumpEffect, applyMasterOfCeremonies, applyMill, applyPrimitiveAction, applyRemovalEffect, applyTargetedPumpEffect, applyZoneEffect, becomeTemporaryCopy, castTargetLegal, chooseCounterTarget, chooseReanimationTarget, chooseWorstHandCardToDiscard, deferHumanDiscard, drawForSeat, drawMultipleForSeat, genericManaAbilityCostShim, matchesEachPlayerSacrificeFilter, noLegalTargetEvent, parseCounterAccumulationTrigger, parseGenericModalEffect, parseTargetedPump, resolveAgentLibraryLookWorkflow, resolveDeferredChoice, resolveProliferate, resolveRevealExchangeTrigger, resolveSacrificeSelfThenSearch, resolveSearchLibraryPut, resolveWhereXBoardCount, strongestControlledCreature, transformPermanent } from "@/engine/effects";
import { applyGraveyardReturn, destroyCreatures, moveCardAcrossSeats, moveLibraryCardToDestination } from "@/engine/entry";
import { entersBattlefieldTapped } from "@/engine/lands";
import { chooseManaSourcesForCost, isBoardConditionMet, isRecognizedBoardCondition, lifeGainedThisTurn, spendManaSources } from "@/engine/mana";
import { capitalizeWord, hasKeyword, isBasicLandCard, isLandCard, numberWordToInt } from "@/engine/shared";
import { checkStateBasedActions, winTheGame } from "@/engine/stateBased";
import { createCopyTokenForSeat, createTokenCard, createTokensForSeat, parseCreateTokenSpecs, predefinedTokenSpec, resolveCopyOneOfCandidates } from "@/engine/tokens";
import type { PendingAction, TriggerCondition, TriggerEffect, TurnPhase } from "@/engine/types";
import { applyCounterDelta, changeControlWithinBattlefield, findPermanentById, moveCardBetweenVisibleZones, possessive, queuePlayerChoice, randomInt, resetForZoneChange, rulesEvent, shuffleCards } from "@/engine/zones";
import { attachedPowerToughnessBonus } from "@/lib/attachments";
import type { ManaColorLetter } from "@/lib/characteristics";
import { computeDevotion, permanentMatchesQualifier } from "@/lib/characteristics";
import { counterCount, effectivePower, effectiveToughness } from "@/lib/counters";
import { parseDamagePrevention } from "@/lib/damagePrevention";
import { cardsLeaveGraveyardEffectText, combatDamageToPlayerEffectText, deathEffectText, etbEffectText, etbTriggerEffectText, isActivatedAbilityClause, isEntersWatcherClause, mergeModalBulletClauses, oracleClauses } from "@/lib/oracleClauses";
import type { DelayedReturnCard } from "@/lib/phaseTriggers";
import { parseRemovalEffect } from "@/lib/removalSpells";
import type { TargetedEffect } from "@/lib/targetedEffects";
import { parseTargetedEffect, targetedEffectIsBeneficial, targetedEffectSpec } from "@/lib/targetedEffects";
import type { ChosenTarget } from "@/lib/targeting";
import { legalTargets, targetsStillLegal } from "@/lib/targeting";
import { matchWatcherSubject } from "@/lib/triggerWatchers";
import { hasCardType } from "@/lib/typeGrants";
import type { GameEvent, GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import type { UndercityRoom } from "@/lib/undercity";
import { UNDERCITY_ROOM_NAMES, UNDERCITY_ROOM_TEXT, isUndercityRoom, nextUndercityRooms, preferredUndercityRoom } from "@/lib/undercity";
import { parseZoneEffect } from "@/lib/zoneEffects";

export function phaseEvent(seatId: string, message: string): GameEvent {
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    seatId,
    message,
    detail: "Phase change"
  };
}

// Rule 608.2b for a triggered ability: a target recorded when it went on the stack that has since left (or become hexproof/protected) makes the
// ability do nothing, instead of quietly swapping in a different target at resolution.
function recordedTriggerTargetGone(session: GameSession, trigger: Extract<PendingAction, { type: "trigger" }>): boolean {
  const recorded = trigger.effect.chosenOption;
  if (!recorded) return false;
  const kind = trigger.effect.kind;
  const source = findPermanentById(session, trigger.sourceCardId) ?? ({ id: trigger.sourceCardId, name: trigger.sourceCardName, typeLine: "", oracleText: "", colors: [], manaValue: 0, role: "effect", zone: "battlefield" } as VisibleCard);
  if (kind === "damage_effect" || kind === "context_power_damage") {
    const aimed = decodeChosenTarget(recorded);
    return aimed !== undefined && !castTargetLegal(session, trigger.controllerSeatId, source, aimed);
  }
  const battlefieldKind =
    (trigger.effect.kind === "add_counter" && (trigger.effect.scope === "target_creature" || trigger.effect.scope === "target_creature_you_control")) ||
    ["pump_target_creature", "double_power_counters", "target_creature_gains_keyword", "destroy_tapped_creature", "become_artifact_target", "gain_control_target_artifact"].includes(kind);
  if (battlefieldKind) {
    const owner = session.seats.find((seat) => seat.board.battlefield.some((card) => card.id === recorded));
    return !owner || !castTargetLegal(session, trigger.controllerSeatId, source, { kind: "card", seatId: owner.id, cardId: recorded });
  }
  if (kind === "aura_reanimate" || kind === "exile_card_from_graveyard") {
    return !session.seats.some((seat) => (seat.board.graveyard ?? []).some((card) => card.id === recorded));
  }
  return false;
}

function decodeChosenTarget(value: string | undefined): ChosenTarget | undefined {
  if (!value) return undefined;
  const parts = value.split(":");
  if (parts[0] === "p" && parts[1]) return { kind: "player", seatId: parts[1] };
  if (parts[0] === "c" && parts[1] && parts[2]) return { kind: "card", seatId: parts[1], cardId: parts[2] };
  return undefined;
}

// The "When this creature/Linvala enters, [if <condition>,] <effect>" clauses of a permanent's own text, each split into
// its optional intervening-if condition and its effect.
function selfEntersClauses(source: VisibleCard): Array<{ condition?: string; effectText: string }> {
  const shortName = source.name.toLowerCase().split(" // ")[0].split(",")[0].trim();
  const clauses: Array<{ condition?: string; effectText: string }> = [];
  for (const rawClause of oracleClauses(source.oracleText)) {
    const clause = rawClause.replace(/\([^)]*\)/g, "").trim();
    const match = clause.match(/^when ([^,]+?) enters(?: the battlefield)?,\s*(?:if (.+?),\s*)?(.+)$/i);
    if (!match) continue;
    const subject = match[1].trim().toLowerCase();
    if (!(/^this\b/.test(subject) || subject === source.name.toLowerCase() || subject === shortName)) continue;
    clauses.push({ condition: match[2]?.trim(), effectText: match[3].trim() });
  }
  return clauses;
}

export function findCommonTriggersForPermanentEntered(session: GameSession, enteringSeatId: string, enteringCard: VisibleCard): Array<Extract<PendingAction, { type: "trigger" }>> {
  const enteringSeat = session.seats.find((seat) => seat.id === enteringSeatId);
  if (!enteringSeat) return [];
  const enteredPermanent = enteringSeat.board.battlefield.find((card) => card.id === enteringCard.id) ?? enteringCard;
  const triggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];

  for (const seat of session.seats) {
    for (const source of seat.board.battlefield) {
      // Animate Dead: an Aura that returns a creature card from a graveyard and attaches to it.
      if (source.id === enteredPermanent.id && /\baura\b/i.test(source.typeLine) && /return enchanted creature card to the battlefield under your control and attach this aura to it/i.test(source.oracleText)) {
        triggers.push(makeCommonTrigger(enteringSeatId, seat.id, source, { kind: "aura_reanimate" }, `${source.name} enters and returns a creature card from a graveyard.`, enteredPermanent.id));
        continue;
      }
      // "When this creature enters, choose two —" (Titan of Industry): the bullets are the modes.
      if (source.id === enteredPermanent.id) {
        const modalEtb = modalClauseTriggerEffect(source, /^when (?:this [a-z]+|[^,]+?) enters(?: the battlefield)?, choose (?:one or more|one or both|any number|up to (?:two|three)|one|two|three)\b.*[—-]\s*$/i);
        if (modalEtb) {
          triggers.push(makeCommonTrigger(enteringSeatId, seat.id, source, modalEtb, `${source.name} triggers because it entered the battlefield.`, enteredPermanent.id));
          continue;
        }
      }
      // "When ~ enters, if <condition>, <effect>" (Linvala, the Preserver has TWO such lines; Garruk's Uprising one):
      // each clause is its own trigger with its own condition, instead of one merged effect that ignored the ifs.
      if (source.id === enteredPermanent.id) {
        const conditionalClauses = selfEntersClauses(source);
        if (conditionalClauses.some((clause) => clause.condition)) {
          for (const clause of conditionalClauses) {
            // "if he was kicked" (Josu Vess) — true only for a kicked cast.
            if (clause.condition && /\bwas kicked\b/i.test(clause.condition) && !source.kicked) continue;
            if (clause.condition && isRecognizedBoardCondition(clause.condition) && !isBoardConditionMet(clause.condition, seat, session.seats)) continue;
            const clauseEffect = commonTriggerEffect(clause.effectText, "clause", undefined, seat);
            if (!clauseEffect) continue;
            triggers.push(makeCommonTrigger(enteringSeatId, seat.id, source, clauseEffect, `${source.name} triggers because it entered the battlefield.`, enteredPermanent.id));
          }
          continue;
        }
      }
      // "Whenever this creature enters or attacks, ..." (Dragonhawk, Fate's Tempest): the entering half; the attack half is findAttackTriggers'.
      if (source.id === enteredPermanent.id) {
        const entersOrAttacks = oracleClauses(source.oracleText).find((clause) => /^(?:when|whenever) [^,]*\benters? or attacks\b/i.test(clause));
        // Only when the entering permanent IS the subject: "Whenever your commander enters or attacks" (Tome of Legends) is not about the Tome itself
        // entering - it used to add a second page counter on top of the one the Tome enters with.
        const subjectIsSource = entersOrAttacks
          ? matchWatcherSubject(entersOrAttacks, "enters", { sourceId: source.id, sourceName: source.name, subject: enteredPermanent, subjectIsControlledBySourceController: true })
          : undefined;
        const entersOrAttacksEffect = entersOrAttacks && subjectIsSource !== false ? commonTriggerEffect(entersOrAttacks, "clause", undefined, seat) : undefined;
        if (entersOrAttacksEffect) {
          triggers.push(makeCommonTrigger(enteringSeatId, seat.id, source, entersOrAttacksEffect, `${source.name} triggers because it entered the battlefield.`, enteredPermanent.id));
          continue;
        }
      }
      // "When Old Rutstein enters and at the beginning of your upkeep, ..." - the entering half. (The upkeep half is a phase trigger, and the whole
      // clause is classed as one, so the normal enters-effect text never contained it.)
      if (source.id === enteredPermanent.id) {
        const entersAndUpkeep = oracleClauses(source.oracleText).find((clause) => /^when(?:ever)? [^,]*\benters(?: the battlefield)? and at the beginning of your upkeep,/i.test(clause));
        const entersAndUpkeepEffect = entersAndUpkeep ? commonTriggerEffect(entersAndUpkeep, "clause", undefined, seat) : undefined;
        if (entersAndUpkeepEffect) {
          triggers.push(makeCommonTrigger(enteringSeatId, seat.id, source, entersAndUpkeepEffect, `${source.name} triggers because it entered the battlefield.`, enteredPermanent.id));
          continue;
        }
      }
      // Another permanent entering: every watcher clause on the source is judged on its own (Dragon Tempest has two: fliers gain haste, and a
      // Dragon deals damage). Judging the card's whole text at once applied the first effect found to every creature that entered.
      if (source.id !== enteredPermanent.id) {
        const perClause = oracleClauses(source.oracleText).filter((clause) => isEntersWatcherClause(clause) && !/\bthis\b[^,.]*\bor another\b/i.test(clause));
        if (perClause.length > 1) {
          for (const clause of perClause) {
            const clauseEffect = commonTriggerEffect(clause, "clause", undefined, seat);
            if (!clauseEffect || !enteredTriggerApplies({ ...source, oracleText: clause }, seat.id, enteredPermanent, enteringSeatId)) continue;
            triggers.push(makeCommonTrigger(enteringSeatId, seat.id, source, clauseEffect, `${source.name} triggers because ${enteredPermanent.name} entered the battlefield.`, enteredPermanent.id));
          }
          continue;
        }
      }
      // A card with BOTH its own enters effect and a watcher on other permanents (Sarkhan, Dragon Ascendant): parse each side from
      // its own clause, or the first effect found would be applied for both.
      const watcherClauses = oracleClauses(source.oracleText).filter((clause) => isEntersWatcherClause(clause) && !/\bthis\b[^,.]*\bor another\b/i.test(clause));
      const ownEnterText = etbEffectText(source.oracleText).trim();
      const effect =
        watcherClauses.length > 0 && ownEnterText
          ? source.id === enteredPermanent.id
            ? commonTriggerEffect(ownEnterText, "entered", undefined, seat)
            : commonTriggerEffect(watcherClauses.join(" "), "clause", undefined, seat)
          : commonTriggerEffect(source.oracleText, "entered", undefined, seat);
      if (!effect || !enteredTriggerApplies(source, seat.id, enteredPermanent, enteringSeatId)) continue;
      // Guardian Project: "... if it doesn't have the same name as another creature you control or a creature card in your graveyard, draw a card."
      if (
        source.id !== enteredPermanent.id &&
        /\bif it doesn'?t have the same name as another creature you control or a creature card in your graveyard\b/i.test(source.oracleText)
      ) {
        const sameNameCreature = (card: VisibleCard) => card.id !== enteredPermanent.id && card.name === enteredPermanent.name && hasCardType(card, "Creature");
        if (seat.board.battlefield.some(sameNameCreature) || (seat.board.graveyard ?? []).some(sameNameCreature)) continue;
      }
      // "When ~ enters, if he was kicked, ..." (Josu Vess) only fires for a kicked cast.
      if (source.id === enteredPermanent.id && /\bif (?:he|she|it|this creature|this permanent) was kicked\b/i.test(source.oracleText) && !source.kicked) continue;
      triggers.push(
        makeCommonTrigger(enteringSeatId, seat.id, source, effect, `${source.name} triggers because ${enteredPermanent.name} entered the battlefield.`, enteredPermanent.id)
      );
    }
  }

  // Graveyard watchers: "Whenever a Dragon you control enters, you may pay {R}. If you do, return this card from your graveyard to your hand." (Spit Flame)
  for (const seat of session.seats) {
    for (const source of seat.board.graveyard ?? []) {
      if (!/return this card from your graveyard to your hand/i.test(source.oracleText) || source.id === enteredPermanent.id) continue;
      const clause = oracleClauses(source.oracleText).find((line) => /^whenever .* enters, you may pay \{r\}/i.test(line));
      if (!clause || !enteredTriggerApplies({ ...source, oracleText: clause }, seat.id, enteredPermanent, enteringSeatId)) continue;
      const effect = commonTriggerEffect(clause, "clause", undefined, seat);
      if (effect) triggers.push(makeCommonTrigger(enteringSeatId, seat.id, source, effect, `${source.name} triggers from the graveyard because ${enteredPermanent.name} entered the battlefield.`, enteredPermanent.id));
    }
  }

  return triggers;
}

// "When this creature enters, choose two —" / "Whenever ~ deals combat damage to a player, choose any number —": the same
// bullet-line modal under any trigger header.
export function modalClauseTriggerEffect(source: VisibleCard, header: RegExp): TriggerEffect | undefined {
  const clauses = oracleClauses(source.oracleText);
  const headerIndex = clauses.findIndex((clause) => header.test(clause));
  if (headerIndex < 0) return undefined;
  const bullets: string[] = [];
  for (const next of clauses.slice(headerIndex + 1)) {
    if (!/^[•*]/.test(next)) break;
    bullets.push(next);
  }
  const modal = parseGenericModalEffect([clauses[headerIndex], ...bullets].join("\n"), undefined);
  return modal ? { kind: "modal", modal } : undefined;
}

export function makeCommonTrigger(
  actorSeatId: string,
  controllerSeatId: string,
  source: VisibleCard,
  effect: TriggerEffect,
  message: string,
  contextCardId?: string
): Extract<PendingAction, { type: "trigger" }> {
  return {
    id: crypto.randomUUID(),
    type: "trigger",
    actorSeatId,
    controllerSeatId,
    sourceCardId: source.id,
    sourceCardName: source.name,
    triggerKind: "common",
    effect,
    contextCardId,
    message
  };
}

// Every "watches other permanents enter" phrasing this engine recognizes, checked most-specific
// first (so "nonland permanent"/"artifact creature" don't fall through to the more generic
// "permanent"/"creature"/"artifact" substrings that would also technically match). Generic across
// type words rather than hardcoded to creatures, and grantedTypes-aware (see typeGrants.ts) — so a
// permanent that's only an enchantment because of a separate static ability (Secret Arcade-style)
// still satisfies "an enchantment enters."
const ETB_WATCH_TYPE_WORDS = ["nonland permanent", "artifact creature", "creature", "artifact", "enchantment", "land", "planeswalker", "battle", "permanent"];

function cardHasWatchedType(card: VisibleCard, typeWord: string): boolean {
  if (typeWord === "permanent") return true;
  if (typeWord === "nonland permanent") return !isLandCard(card);
  if (typeWord === "artifact creature") return hasCardType(card, "Artifact") && hasCardType(card, "Creature");
  return hasCardType(card, typeWord.charAt(0).toUpperCase() + typeWord.slice(1));
}

function enteredTriggerApplies(source: VisibleCard, sourceSeatId: string, enteredCard: VisibleCard, enteredSeatId: string) {
  const text = source.oracleText.toLowerCase();
  if (!text.includes("enter")) return false;
  // The structured subject parser (this/another/a + nontoken, color, creature subtype, "you control",
  // the source's own short name) decides first; the older type-word heuristics below only run for a
  // clause it declines to interpret.
  const parsedSubject = matchWatcherSubject(source.oracleText, "enters", {
    sourceId: source.id,
    sourceName: source.name,
    subject: enteredCard,
    subjectIsControlledBySourceController: enteredSeatId === sourceSeatId
  });
  if (parsedSubject !== undefined) return parsedSubject;
  // "As this enchantment enters, choose Khans or Dragons." (Outpost Siege) — only ever about its own entry.
  if (/\bas this (?:enchantment|artifact|permanent|creature) enters, choose\b/.test(text)) return source.id === enteredCard.id;
  const underYourControl = enteredSeatId === sourceSeatId;
  const isAnother = source.id !== enteredCard.id;
  const selfEntered = source.id === enteredCard.id;

  // "Whenever this enchantment or another enchantment you control enters, ..." (Constellation,
  // Eerie, and the same "self-or-sibling" shape on other keyword templates) — explicitly covers
  // BOTH the source's own entry and any other matching permanent's. Checked before the self-only
  // and generic "another X" checks below, since either of those on its own misreads this: the
  // self-only check would (correctly) match the "this enchantment" half but then wrongly exclude
  // every OTHER enchantment entering, and the generic loop's "another X" branch below would
  // (correctly) match the "another enchantment" half but then wrongly exclude the source's own
  // entry — reproduced live as Boon of the Spirit Realm's own Constellation trigger never firing
  // off itself, only off a second enchantment entering afterward.
  const selfOrAnotherMatch = text.match(/\b(?:when|whenever)\s+this\s+[a-z]+\s+or\s+another\s+([a-z]+)(?: you control)? enters\b/);
  if (selfOrAnotherMatch) {
    if (!cardHasWatchedType(enteredCard, selfOrAnotherMatch[1])) return false;
    return text.includes("you control") ? underYourControl : true;
  }

  // A self-referential clause ("when this creature/artifact/land/... enters") only ever applies to
  // the source's own entry — checked first and exclusively, so it can't also misfire off some
  // other permanent entering just because the text happens to contain a shared substring like
  // "creature enters" (a real, separate bug from the generic loop below: "when this creature
  // enters, draw a card" would otherwise ALSO fire every time any other creature enters, since
  // that loop's "creature enters" check doesn't know the "this" refers only to itself). Modern
  // oracle text templating dropped "the battlefield" (it's just "enters" now, confirmed against
  // the full card catalog: virtually every ETB clause omits it), so this doesn't require that
  // suffix either — the old version requiring "enters the battlefield" silently missed almost
  // every real self-ETB trigger.
  if (/\b(when|whenever)\s+this\b.{0,30}\benters?\b/.test(text)) return selfEntered;

  // Generic "watches other permanents enter" — find which type word the clause uses, confirm the
  // entering permanent actually has that type (printed or granted), then apply the same
  // another/unqualified and you-control heuristics regardless of which type word matched. An
  // unrestricted "a creature enters" (no "another") does apply to the source's own entry too, per
  // the real rule — only "another X enters" explicitly excludes self.
  const controlQualified = text.includes("under your control") || text.includes("you control");
  for (const typeWord of ETB_WATCH_TYPE_WORDS) {
    if (!cardHasWatchedType(enteredCard, typeWord)) continue;
    // Require "when"/"whenever" to actually precede "<type> enters" within the same sentence (bounded
    // by not crossing a period), the same fix as the self-referential branch above and for the same
    // reason — a plain `.includes("land enters")` also matches non-trigger static/reminder text that
    // happens to contain that substring, e.g. Dakmor Salvage's "This land enters tapped." (an ETB
    // replacement effect, not a trigger) or a Dredge reminder line, which made it fire — and draw a
    // card off its "you may [...] draw a card" reminder text — every time *any* land entered, not
    // just itself.
    // "another" tolerates 0-2 qualifier words before the type word (a "nontoken"/color/creature-
    // type adjective, ...) — same fix and reason as deathTriggerApplies' own "another creature"
    // pattern above: without it, e.g. "another nontoken creature enters" would silently fall
    // through to the unqualified anyPattern below, which has no self-exclusion at all.
    const anotherPattern = new RegExp(`\\b(?:when|whenever)\\b(?:(?!\\.).){0,60}\\banother(?:\\s+[a-z]+){0,2}\\s+${typeWord}(?: you control)? enters\\b`);
    const anyPattern = new RegExp(`\\b(?:when|whenever)\\b(?:(?!\\.).){0,60}\\b${typeWord}(?: you control)? enters\\b`);
    if (anotherPattern.test(text)) {
      if (!isAnother) return false;
      return controlQualified ? underYourControl : true;
    }
    if (anyPattern.test(text)) {
      return controlQualified ? underYourControl : true;
    }
  }
  return false;
}

// "entered"/"died" derive the relevant text themselves (deathEffectText/etbEffectText), for callers
// passing a permanent's raw, full oracle text and asking "what does this do on death/ETB." "clause"
// skips that derivation and uses the given text as-is, for callers that already isolated exactly
// the relevant clause through some other mechanism — a phase-trigger's own text (phaseEffectText,
// e.g. a "declare attackers step" or "declare blockers step" trigger), a single modal mode's text,
// a loyalty ability's own effect text, or a generic activated ability's effect text. Passing
// already-isolated non-ETB text (e.g. "whenever ~ attacks, create a token") through "entered" here
// used to be harmless before etbEffectText was tightened to reject non-"enters" whenever-clauses
// (see isNonEtbWheneverClause) — after that change it silently strips the clause a second time and
// the trigger stops firing at all, which is exactly what broke Soaring Lightbringer's real "whenever
// it attacks" trigger (and any modal mode/loyalty ability/generic ability effect shaped the same
// way) as a side effect of fixing its ETB misclassification.
export function commonTriggerEffect(
  oracleText: string,
  mode: "entered" | "died" | "combat_damage_to_player" | "cards_left_graveyard" | "clause",
  dynamicCounterCount?: number,
  controllerSeat?: PlayerSeat
): TriggerEffect | undefined {
  const relevantText =
    mode === "died"
      ? deathEffectText(oracleText)
      : mode === "combat_damage_to_player"
        ? combatDamageToPlayerEffectText(oracleText)
        : mode === "cards_left_graveyard"
          ? cardsLeaveGraveyardEffectText(oracleText)
          : mode === "clause"
            ? oracleText
            : etbTriggerEffectText(oracleText);
  const text = relevantText.toLowerCase();
  // A single text-wide "you may" check rather than per-match position tracking — good enough for
  // this engine's one-effect-per-clause parsing (see the module comment on TriggerEffect); a card
  // with multiple clauses where only one is optional would be mis-flagged, a declared simplification.
  const optional = /\byou may\b/.test(text) || undefined;
  if (mode === "entered" || mode === "clause") {
    const preventSpec = parseDamagePrevention(text.replace(/^(?:when|whenever|at the beginning)\b[^,]*,\s*/, ""));
    if (preventSpec && ["you", "self", "controlled_creatures", "you_and_creatures"].includes(preventSpec.scope)) return { kind: "prevent_damage", spec: preventSpec };
  }
  if (/^choose left or right\. each player gains control of all nonland permanents other than [^.]+ controlled by the next player in the chosen direction\.?$/.test(text.replace(/\([^)]*\)/g, "").trim())) return { kind: "rotate_control" };
  if (/^until end of turn, each planeswalker you control becomes a 4\/4 red dragon creature and gains flying\.?$/.test(text.replace(/\([^)]*\)/g, "").replace(/^[+\-−]?\d+:\s*/, "").trim())) return { kind: "planeswalkers_become_dragons" };
  const storefront = text
    .replace(/\([^)]*\)/g, "")
    .match(/^when this land enters, sacrifice it\. when you do, search your library for a basic ([a-z, ]+?) card, put it onto the battlefield tapped, then shuffle(?: and you gain (\d+) life)?\.?$/);
  if (storefront) return { kind: "sacrifice_self_then_search", filter: storefront[1].replace(/,? or /g, ", ").replace(/\s+/g, " "), lifeGain: storefront[2] ? Number.parseInt(storefront[2], 10) : 0 };
  // One verb on a target the player chooses: parsed first so the older "pick the best creature" shapes below can't take it.
  {
    const cleaned = text.replace(/\([^)]*\)/g, "").trim();
    const body = /^(?:when|whenever|at the beginning)\b/.test(cleaned) ? cleaned.replace(/^[^,]*,\s*/, "") : cleaned.replace(/^[a-z' ]+ — /, "");
    const early = parseTargetedEffect(body) ?? (/^you may /.test(body) ? parseTargetedEffect(body.replace(/^you may /, "")) : undefined);
    if (early) return { kind: "targeted_effect", effect: early, ...(optional ? { optional } : {}) };
  }
  // Single-card shapes the generic parsers below would misread (a flat draw for a conditional one) or miss entirely.
  if (mode === "entered" && /^living weapon\b/im.test(oracleText)) return { kind: "living_weapon" };
  if (/\bdouble the power and toughness of each creature you control until end of turn\b/.test(text)) return { kind: "double_power_toughness" };
  const formidable = text.match(/if creatures you control have total power (\d+) or greater, target creature you control gains ([a-z ]+?) until end of turn/);
  if (formidable) {
    return { kind: "target_creature_gains_keyword", keywords: formidable[2].split(/ and |, /), condition: { kind: "total_power_at_least", amount: Number.parseInt(formidable[1], 10) } };
  }
  const extraCombat = text.match(/(?:you may pay (\{[^.]*?\})\. if you do, )?untap all attacking creatures(?: and|\.) ?after this phase, there is an additional combat phase/);
  if (extraCombat) return extraCombat[1] ? { kind: "additional_combat", payCostText: extraCombat[1].toUpperCase(), optional: true } : { kind: "additional_combat" };
  if (/when enchanted creature dies, return this card to its owner'?s hand/.test(text) || (mode === "died" && /^return this card to its owner'?s hand\.?$/.test(text.trim()))) return { kind: "return_self_to_hand" };
  if (/^investigate\.?$/.test(text.replace(/\([^)]*\)/g, "").replace(/^[^,]*,\s*/, "").trim())) return { kind: "create_tokens", tokens: [{ ...predefinedTokenSpec("Clue"), count: 1 }] };
  const putAnyBody = text.replace(/\([^)]*\)/g, "").replace(/^(?:when|whenever|at the beginning)\b[^,]*,\s*/, "").trim();
  // (Anywhere in the text: Ghalta's enters clause sits beside its cost-reduction line.)
  const putAny = putAnyBody.match(/(?:^|[.,:]\s+)put any number of (creature|land|artifact|permanent) cards from your hand onto the battlefield( tapped)?\.?(?:\s|$)/);
  if (putAny) return { kind: "put_any_from_hand", filter: putAny[1] as "creature", ...(putAny[2] ? { tapped: true } : {}) };
  // "Each player discards a card." / "Each player loses 1 life and draws a card." (Rankle, Master of Pranks)
  const eachPlayer = text.replace(/\([^)]*\)/g, "").trim().match(/^each player (?:discards (a|one|two|\d+) cards?|loses (\d+) life(?: and draws (a|one|two|\d+) cards?)?)\.?$/);
  if (eachPlayer) {
    return {
      kind: "each_player_basics",
      ...(eachPlayer[1] ? { discard: numberWordToInt(eachPlayer[1]) ?? 1 } : {}),
      ...(eachPlayer[2] ? { loseLife: Number.parseInt(eachPlayer[2], 10) } : {}),
      ...(eachPlayer[3] ? { draw: numberWordToInt(eachPlayer[3]) ?? 1 } : {})
    };
  }
  // "Each opponent sacrifices a creature of their choice." (as a trigger's effect, after the "Whenever ..., " head)
  const edictBody = text.replace(/\([^)]*\)/g, "").replace(/^(?:when|whenever|at the beginning)\b[^,]*,\s*/, "").trim();
  // ("Each player sacrifices ..." is the cast-time resolver's, parseEachPlayerSacrificeEffect; matching it here too would sacrifice twice.)
  const edict = edictBody.match(/^each (opponent|other player) sacrifices an? ((?:nontoken )?creature(?: or planeswalker)?)(?: of (?:their|his or her) choice)?\.?$/);
  if (edict) return { kind: "each_opponent_sacrifices", filter: edict[2], ...(edict[1] === "player" ? { includeSelf: true } : {}) };
  // Massacre Wurm: "Whenever a creature an opponent controls dies, that player loses 2 life." (the actor is the player whose creature died)
  const thatPlayerLoses = mode === "died" ? edictBody.match(/^that player loses (\d+) life\.?$/) : null;
  if (thatPlayerLoses) return { kind: "actor_loses_life", amount: Number.parseInt(thatPlayerLoses[1], 10) };
  // The Ancient Dragons: "...deals combat damage to a player, roll a d20. <payoff equal to the result>."
  const d20Body = text.replace(/\([^)]*\)/g, "").replace(/^[^,]*,\s*/, "").trim();
  if (/^roll a d20\. you create a number of treasure tokens equal to the result\.?$/.test(d20Body)) return { kind: "d20_roll", payoff: "treasures" };
  if (/^roll a d20\. draw cards equal to the result\b/.test(d20Body)) return { kind: "d20_roll", payoff: "draw" };
  if (/^roll a d20\. you create a number of 1\/1 blue faerie dragon creature tokens with flying equal to the result\.?$/.test(d20Body)) return { kind: "d20_roll", payoff: "faerie_dragons" };
  if (/^exile all graveyards\.?$/.test(text.replace(/\([^)]*\)/g, "").trim())) return { kind: "exile_all_graveyards" };
  const otherOpponents = text.match(/^(?:this creature|it) deals (\d+) damage to each other opponent\.?$/);
  if (otherOpponents) return { kind: "damage_each_other_opponent", amount: Number.parseInt(otherOpponents[1], 10) };
  if (/^reveal cards from the top of your library until you reveal a land card\. put that card onto the battlefield tapped and the rest on the bottom of your library in a random order\.?$/.test(text.replace(/^[^,]*,\s*/, "").trim()) || /reveal cards from the top of your library until you reveal a land card\. put that card onto the battlefield tapped/.test(text)) {
    return { kind: "reveal_until_land_to_battlefield" };
  }
  if (/if the gift was promised, destroy target artifact or enchantment an opponent controls/.test(text)) return { kind: "gift_destroy_artifact_or_enchantment" };
  // "You may behold a Dragon. If you do, create a Treasure token." (Sarkhan, Dragon Ascendant): the rest only if you can behold.
  const behold = text.match(/\byou may behold an? ([a-z]+)\. if you do, ([^.]+)\.?/);
  if (behold) {
    const inner = commonTriggerEffect(behold[2], "clause", dynamicCounterCount, controllerSeat);
    if (inner) return { ...inner, condition: { kind: "behold", subtype: behold[1] }, optional: true };
  }
  // "Put a +1/+1 counter on Sarkhan. Until end of turn, Sarkhan becomes a Dragon in addition to his other types and gains flying."
  const counterAndFly = text.match(/\bput a \+1\/\+1 counter on [a-z',-]+\. until end of turn, [a-z',-]+ becomes an? [a-z]+ in addition to (?:his|her|its|their) other types and gains ([a-z ]+?)\.?$/);
  if (counterAndFly) {
    return { kind: "add_counter", counterKind: "+1/+1", amount: 1, scope: "self", then: { kind: "self_gains_keywords", keywords: counterAndFly[1].split(/ and |, /) } };
  }
  const noReminder = text.replace(/\([^)]*\)/g, "").trim().replace(/^(?:when|whenever) [^,]*\benters?,\s*/, "");
  const exileUpTo = noReminder.match(/\bexile up to (one|two|three) target artifacts? and\/or enchantments?\./);
  if (exileUpTo) return { kind: "exile_up_to_artifacts_enchantments", count: numberWordToInt(exileUpTo[1]) ?? 1 };
  if (/\bfor each opponent, exile up to one target nonland permanent that player controls until this (?:enchantment|artifact|creature|permanent) leaves the battlefield\./.test(noReminder)) return { kind: "exile_until_leaves_each_opponent" };
  if (/you may pay \{r\}\. if you do, return this card from your graveyard to your hand/.test(text)) return { kind: "pay_red_return_self_from_graveyard", optional: true };
  if (/you may pay any amount of \{r\}\. when you do, it deals that much damage to any target/.test(text)) return { kind: "pay_red_for_damage", optional: true };
  if (/exile cards from the top of your library until you exile a nonland card\. you may cast it without paying its mana cost if that spell'?s mana value is 8 or less\. if you don'?t, put that card into your hand/.test(text)) return { kind: "dig_nonland_to_hand" };
  if (/(?:^|, )return this (?:enchantment|artifact|permanent|creature) to its owner'?s hand\.?$/.test(text.replace(/\([^)]*\)/g, "").trim())) return { kind: "return_self_to_hand" };
  const millOnly = text.replace(/\([^)]*\)/g, "").trim().match(/^(?:when [^,]+, )?(mill (?:a|one|two|three|four|five|\d+) cards?)\.?$/);
  if (millOnly) {
    const millZone = parseZoneEffect(millOnly[1]);
    if (millZone?.kind === "mill") return { kind: "zone_effect", effect: millZone };
  }
  if (/whenever a land you control enters, you may return target nonland permanent card from your graveyard to your hand\./.test(text)) {
    return { kind: "landfall_return_nonland_permanent", plainsToBattlefield: /if that land is a plains, you may return that (?:nonland permanent )?card to the battlefield instead/.test(text), optional: true };
  }
  const nogi = text.match(/if you control (one|two|three|four|five) or more ([a-z]+)s, until end of turn, [a-z',-]+ becomes an? ([a-z]+) with base power and toughness (\d+)\/(\d+) and gains ([a-z ]+?)\./);
  if (nogi) {
    return {
      kind: "self_becomes_dragon",
      power: Number.parseInt(nogi[4], 10),
      toughness: Number.parseInt(nogi[5], 10),
      keywords: nogi[6].split(/ and |, /),
      condition: { kind: "controls_subtype_count", subtype: nogi[2], amount: numberWordToInt(nogi[1]) ?? 1 }
    };
  }
  const packTactics = text.match(/if you attacked with creatures with total power (\d+) or greater this combat, you may put an? ([a-z]+) creature card from your hand onto the battlefield tapped and attacking/);
  if (packTactics) return { kind: "dragon_from_hand_attacking", subtype: packTactics[2], condition: { kind: "attacking_power_at_least", amount: Number.parseInt(packTactics[1], 10) } };
  if (/^(?:[^,]*,\s*)?discard any number of cards, then draw that many cards\.?$/.test(noReminder)) return { kind: "discard_any_then_draw" };
  if (/^(?:[^,]*,\s*)?discard any number of cards, then draw that many cards plus one\.?$/.test(noReminder)) return { kind: "discard_any_then_draw", plusOne: true };
  // "Discard up to two cards, then draw that many cards." (Daretti, Scrap Savant's +2)
  const discardUpTo = noReminder.match(/^(?:[^,]*,\s*)?discard up to (one|two|three|four|\d+) cards?, then draw that many cards\.?$/);
  if (discardUpTo) return { kind: "discard_any_then_draw", max: { one: 1, two: 2, three: 3, four: 4 }[discardUpTo[1]] ?? Number.parseInt(discardUpTo[1], 10) };
  if (/^put any number of cards from your hand on the bottom of your library, then draw that many cards plus one\.?$/.test(noReminder)) return { kind: "discard_any_then_draw", plusOne: true, toLibraryBottom: true };
  const hawk = text.match(/exile the top x cards of your library, where x is the number of creatures you control with power (\d+) or greater\. you may play those cards until your next end step\..*?deals (\d+) damage to each opponent for each of those cards that are still exiled/);
  if (hawk) return { kind: "exile_top_by_power_then_damage", minPower: Number.parseInt(hawk[1], 10), damagePerCard: Number.parseInt(hawk[2], 10) };
  if (/you may exile it\. when you do, return target creature card from your graveyard to your hand/.test(text)) return { kind: "exile_self_return_creature_to_hand", optional: true };
  if (/you may put (?:him|her|it|them) into (?:his|her|its|their) owner'?s library third from the top/.test(text)) return { kind: "self_to_library_third", optional: true };
  if (/when this land enters untapped, you may put target creature card from your graveyard on top of your library/.test(text)) {
    return { kind: "graveyard_creature_to_library_top", condition: { kind: "source_untapped" }, optional: true };
  }
  if (/sacrifice any number of other permanents, then draw that many cards/.test(text)) return { kind: "sacrifice_surplus_then_draw" };
  const hideawayMatch = text.match(/(?:^|\s)hideaway (\d+)\b/);
  if (hideawayMatch && mode === "entered") return { kind: "hideaway", count: Number.parseInt(hideawayMatch[1], 10) };
  // "When this creature dies, you gain life equal to its power." (Willow Geist): converted to a plain gain_life of the dying creature's power as
  // the trigger is created (findCommonTriggersForPermanentDied), because the power is only known from the creature as it died.
  if (mode === "died" && /(?:^|,\s*)you gain life equal to (?:its|this creature'?s) power\.?$/.test(text.replace(/\([^)]*\)/g, "").trim())) return { kind: "gain_life_equal_power" };
  if (/\bmill a card\. if a land card is milled this way, create a treasure token\. if a creature card is milled this way, create a 1\/1 green insect creature token\. if a noncreature, nonland card is milled this way, create a blood token\b/.test(text)) return { kind: "mill_with_rewards" };
  const namedMode = text.match(/\bas this (?:enchantment|artifact|permanent|creature) enters, choose ([a-z]+) or ([a-z]+)\./);
  if (namedMode && mode === "entered") return { kind: "choose_named_mode", options: [namedMode[1], namedMode[2]].map((label) => label.charAt(0).toUpperCase() + label.slice(1)) };
  // Syr Konrad, the Grim: "Whenever another creature dies, or ..., Syr Konrad deals 1 damage to each opponent." (the dies half; the graveyard halves are not tracked)
  const namedEachOpponentDamage = mode === "died" ? text.match(/, [a-z' ,-]+? deals (\d+) damage to each opponent\.?$/) : null;
  if (namedEachOpponentDamage) return { kind: "damage_each_opponent", amount: Number.parseInt(namedEachOpponentDamage[1], 10) };
  const eachOpponentDamage = text.match(/^(?:this creature|it) deals (\d+) damage to each opponent\.?$/);
  if (eachOpponentDamage) return { kind: "damage_each_opponent", amount: Number.parseInt(eachOpponentDamage[1], 10) };
  const targetPump = text.match(/^target creature you control gets ([+-]\d+)\/([+-]\d+)(?: and gains ([a-z ]+?))? until end of turn\.?$/);
  if (targetPump) {
    return { kind: "pump_target_creature", power: Number.parseInt(targetPump[1], 10), toughness: Number.parseInt(targetPump[2], 10), keywords: targetPump[3] ? targetPump[3].split(/ and |, /) : [] };
  }
  if (/\bmanifest dread, then attach this equipment to that creature\b/.test(text)) return { kind: "manifest_dread_attach" };
  if (/(?:^|,\s*)exile target card from a graveyard\.?$/.test(text)) return { kind: "exile_card_from_graveyard" };
  if (/^(?:you may )?destroy target creature if it'?s tapped\.?$/.test(text.trim())) return { kind: "destroy_tapped_creature", optional: true };
  if (/^target artifact you control becomes a copy of another target artifact or creature you control until end of turn, except it'?s an artifact in addition to its other types\.?$/.test(text.replace(/\([^)]*\)/g, "").trim())) return { kind: "artifact_becomes_copy_eot" };
  if (/^target permanent becomes an artifact in addition to its other types\.?$/.test(text.trim())) return { kind: "become_artifact_target" };
  if (/^gain control of target artifact\.?$/.test(text.trim())) return { kind: "gain_control_target_artifact" };
  const pumpPer = text.trim().match(/^this creature gets \+x\/\+0 until end of turn, where x is the number of ([a-z]+?)s? you control\.?$/);
  if (pumpPer) return { kind: "self_pump_per_permanent", matcher: pumpPer[1] };
  const discardMill = text.match(/^each opponent discards (a|one|two|three|four|five|\d+) cards?, then mills (a|one|two|three|four|five|\d+) cards?\.?$/);
  if (discardMill) return { kind: "each_opponent_discard_then_mill", discard: numberWordToInt(discardMill[1]) ?? 1, mill: numberWordToInt(discardMill[2]) ?? 1 };
  if (/^for each opponent, destroy up to one target creature or planeswalker that player controls\.?$/.test(text)) return { kind: "destroy_one_per_opponent" };
  if (/^put all creature cards from all graveyards onto the battlefield under your control\. exile this saga, then return it to the battlefield/.test(text)) return { kind: "reanimate_all_graveyards_and_flip_saga" };
  if (/(?:^|\byou )?may exchange life totals with target opponent\. if you lost life this way, draw that many cards\.?$/.test(text)) return { kind: "exchange_life_draw_lost", optional: true };
  const support = text.match(/(?:^|,\s*|\.\s*)support (one|two|three|four|\d+)\b/);
  if (support) return { kind: "counters_on_up_to_creatures", counterKind: "+1/+1", amount: 1, count: numberWordToInt(support[1]) ?? 1 };
  const rummage = text.match(/\byou may discard a card\. if you do, draw (a|one|two|three) cards?\b/);
  if (rummage) return { kind: "discard_then_draw", draw: numberWordToInt(rummage[1]) ?? 1, optional: true };
  if (/\byou gain life equal to that creature'?s toughness\b/.test(text)) return { kind: "gain_life_context_toughness" };
  const upToCreatures = text.match(/\bput an? (\+1\/\+1) counter on each of up to (one|two|three) target creatures\b/);
  if (upToCreatures) return { kind: "counters_on_up_to_creatures", counterKind: upToCreatures[1], amount: 1, count: numberWordToInt(upToCreatures[2]) ?? 1 };
  if (/(?:^|,\s*)proliferate\.?$/.test(text.replace(/\([^)]*\)/g, "").trim())) return { kind: "proliferate" };
  if (/\binvestigate once for each opponent who has more cards in hand than you\b/.test(text)) return { kind: "investigate_per_opponent_with_more_cards" };
  if (/\bput x \+1\/\+1 counters on target creature, where x is that creature'?s power\b/.test(text)) return { kind: "double_power_counters" };
  if (/\bdraw two cards if you control the creature with the greatest power or tied for the greatest power\b/.test(text)) {
    return { kind: "draw_cards", amount: 2, condition: { kind: "controls_greatest_power" } };
  }
  const treasurePayoff = relevantText.match(/^create a treasure token\. then if you control (\w+) or more treasures, (sacrifice this [a-z]+\. if you do, )?(create .+?\.)(?: \(.*)?$/i);
  if (treasurePayoff) {
    const threshold = numberWordToInt(treasurePayoff[1].toLowerCase()) ?? Number.parseInt(treasurePayoff[1], 10);
    const payoffTokens = parseCreateTokenSpecs(treasurePayoff[3], undefined, controllerSeat);
    if (threshold > 0 && payoffTokens.length > 0) {
      return { kind: "create_tokens", tokens: [predefinedTokenSpec("Treasure")], ifTreasures: { threshold, sacrificeSelf: Boolean(treasurePayoff[2]), tokens: payoffTokens } };
    }
  }
  const groupGrant = text.match(/^(?:[^,]*,\s*)?creatures you control gain ([a-z ]+?) until end of turn\.?$/);
  if (groupGrant && !/\bget\b/.test(text)) return { kind: "creatures_gain_keywords", keywords: groupGrant[1].split(/ and |, /) };
  const tokenSpecs = parseCreateTokenSpecs(relevantText, dynamicCounterCount, controllerSeat);
  if (tokenSpecs.length > 0) {
    // "..., then put a +1/+1 counter on each Plant you control." (Insidious Roots, following its own
    // "create a 0/1 green Plant creature token") — a second, board-wide effect chained onto the
    // token creation with "then," which this function would otherwise silently drop by returning
    // the create_tokens effect immediately. See TriggerEffect's shared `then` field.
    const thenCounterMatch = text.match(/\bthen put (a|one|two|three|four|five|\d+) (\+1\/\+1|-1\/-1|[a-z]+) counters? on each ([a-z][a-z ]*?) you control\b/);
    const thenAmount = thenCounterMatch ? numberWordToInt(thenCounterMatch[1]) : undefined;
    const thenDiscardMatch = text.match(/\bthat player discards\s+(a|one|two|three|\d+)\s+cards?\b/);
    const thenDiscardAmount = thenDiscardMatch ? numberWordToInt(thenDiscardMatch[1]) : undefined;
    const then: TriggerEffect | undefined =
      thenCounterMatch && thenAmount
        ? { kind: "add_counter", counterKind: thenCounterMatch[2], amount: thenAmount, scope: "each_matching_you_control", matcher: thenCounterMatch[3].trim() }
        : thenDiscardAmount
          ? { kind: "seat_discards", amount: thenDiscardAmount }
          : undefined;
    return { kind: "create_tokens", tokens: tokenSpecs, optional, then };
  }

  // "Target player loses N life and you gain N life." (Blood Artist) / "Each opponent loses N life
  // and you gain N life." (Zulaport Cutthroat, Cruel Celebrant) — checked before the plain gainLife
  // match below, which would otherwise match the "you gain N life" half of this same clause first
  // and silently drop the life-loss half entirely (reproduced live: Blood Artist's death trigger
  // only ever gained its controller life, the target-player loss never happened). Only the loss
  // amount is captured — every real card with this shape prints the same number for both halves.
  const targetPlayerDrain = text.match(/\btarget player loses\s+(\d+|one|two|three|four|five)\s+life and you gain\s+(?:\d+|one|two|three|four|five)\s+life\b/);
  if (targetPlayerDrain) {
    const amount = numberWordToInt(targetPlayerDrain[1]);
    // The target player is the controller's choice (Blood Artist), so it goes through the shared targeted effect.
    if (amount) return { kind: "targeted_effect", effect: { verb: { kind: "life", delta: -amount }, who: { kind: "player", opponentOnly: false }, youGainLife: amount }, optional };
  }
  const eachOpponentDrain = text.match(/\beach opponent loses\s+(\d+|one|two|three|four|five)\s+life and you gain\s+(?:\d+|one|two|three|four|five)\s+life\b/);
  if (eachOpponentDrain) {
    const amount = numberWordToInt(eachOpponentDrain[1]);
    if (amount) return { kind: "drain", amount, scope: "each_opponent", optional };
  }
  // "Each opponent loses life equal to your devotion to black. You gain life equal to the life lost
  // this way." (Gray Merchant of Asphodel, and the rest of the devotion-drain cycle) — checked as its
  // own shape rather than folded into eachOpponentDrain above, since the amount here is board-state-
  // dependent (computed at resolution time, see applyDrainEffect's own doc comment), not a literal
  // number this parser could ever read out of the text. Previously entirely unmodeled: no drain
  // variant covered a devotion-computed amount, so this whole clause silently failed to parse and the
  // ability never did anything at all. Reported live as "Gray Merchant did not give life to me or
  // take life from my opponents."
  // Both printed wordings: "loses life equal to your devotion to black" and the real Gray Merchant text
  // "loses X life, where X is your devotion to black" — the old pattern only knew the first, so Gray
  // Merchant fell to the LLM fallback.
  const devotionDrain = text.match(
    /\beach opponent loses (?:life equal to your devotion to|x life, where x is your devotion to) (white|blue|black|red|green)\b[\s\S]*?\byou gain life equal to the life lost this way\b/
  );
  if (devotionDrain) {
    const devotionColor = { white: "W", blue: "U", black: "B", red: "R", green: "G" }[devotionDrain[1]] as ManaColorLetter;
    return { kind: "drain", amount: 0, scope: "each_opponent", devotionColor, optional };
  }

  // "Connives." (Ledger Shredder, ...) — Streets of New Capenna keyword action, checked before the
  // plain draw-count match further down since its own reminder text ("Draw a card, then discard a
  // card...") contains "draw a card" and would otherwise be misread as a bare draw_cards effect,
  // silently dropping the discard/counter half.
  const conniveMatch = text.match(/\b(?:this creature|it) connives?(?:\s+(twice))?\b/);
  if (conniveMatch) return { kind: "connive", amount: conniveMatch[1] ? 2 : 1, optional };

  // Karoo/bounce lands (Simic Growth Chamber, ...): "return a land you control to its owner's
  // hand." Previously entirely unmodeled — the land still correctly entered tapped (a separate,
  // already-handled replacement effect), but this ETB trigger just silently did nothing, turning
  // what should be a 1-for-1 tempo trade into a pure land-count gain.
  if (/\breturn a land you control to its owner'?s hand\b/.test(text)) return { kind: "return_land_to_hand", optional };

  // "Exile another target permanent you own, then return it to the battlefield under your
  // control." (Aminatou, the Fateshifter's -1, and the same self-blink template on a few other
  // cards) — this engine had no blink (exile-then-return-to-the-battlefield) primitive at all
  // before this; WHICH permanent is a real choice (same "resolveTriggerEffect is a pure function
  // with no access to pendingRuleChoice" reasoning as return_land_to_hand just above), so it
  // routes through the same trigger+pendingRuleChoice detour. Reported live as "did nothing, I did
  // not get the chance to choose a permanent I control."
  if (/\bexile another target permanent you own,?\s*then return it to the battlefield under your control\b/.test(text)) {
    return { kind: "blink", optional };
  }

  if (/\byou become the monarch\b/.test(text)) return { kind: "become_monarch", optional };
  // "Put a +1/+1 counter on target creature you control." and the other one-verb effects on a chosen target.
  const targetedTail = parseTargetedEffect(noReminder.replace(/^(?:when|whenever|at the beginning of)[^,]*,\s*/, ""));
  if (targetedTail) return { kind: "targeted_effect", effect: targetedTail };
  const itGains = noReminder.match(/^(?:(?:whenever|when) [^,]*\benters?,\s*)?it gains ([a-z ,]+?) until end of turn\.?$/);
  if (itGains) return { kind: "context_gains_keywords", keywords: itGains[1].split(/ and |, /).map((word) => word.trim()).filter(Boolean) };
  if (/destroy all creatures with flying\. put a \+1\/\+1 counter on (?:this creature|[a-z',\- ]+) for each creature destroyed this way/.test(noReminder)) return { kind: "destroy_fliers_then_counters" };
  if (/^(?:[^,]*,\s*)?you take the initiative\.?$/.test(noReminder)) return { kind: "take_initiative" };

  const payThen = relevantText.match(/\byou may pay ((?:\{[^}]+\})+)\.\s*if you do,\s*([^.]+\.?)/i);
  if (payThen) {
    const zoneEffect = parseZoneEffect(payThen[2].endsWith(".") ? payThen[2] : `${payThen[2]}.`);
    if (zoneEffect) return { kind: "pay_then_zone", costText: payThen[1], zoneEffect, optional: true };
  }

  const actorLosesLife = text.match(/\b(?:that creature'?s|its) controller loses\s+(\d+|one|two|three|four|five)\s+life\b/);
  if (actorLosesLife) {
    const amount = numberWordToInt(actorLosesLife[1]);
    if (amount) return { kind: "actor_loses_life", amount, optional };
  }

  // "You draw a card and lose 1 life." (Undead Augur, Phyrexian Arena, ...) / "This creature deals 1
  // damage to you and you draw a card." (Midnight Reaper) — a draw plus a life payment in ONE clause.
  // Checked before the single-effect gain/lose/draw matches below, each of which would otherwise return
  // just ITS half and silently drop the other (the draw happened but the life never went down, or the
  // reverse).
  const drawAndLoseLife = text.match(/\b(?:you )?draws?\s+(a|an|one|two|three|four|five|\d+) (?:additional )?cards?,? and (?:you )?lose\s+(\d+|one|two|three|four|five)\s+life\b/);
  const damageToYouAndDraw = text.match(/\bdeals?\s+(\d+|one|two|three|four|five)\s+damage to you and you draw\s+(a|an|one|two|three|four|five|\d+) cards?\b/);
  // "You gain 1 life and draw a card." (Inspiring Overseer, Bishop of Wings-style) — the plain gain-life match
  // below returned only that half and silently dropped the draw.
  const gainAndDraw = text.match(/\byou gain\s+(\d+|one|two|three|four|five)\s+life and (?:you )?draw\s+(a|an|one|two|three|four|five|\d+) cards?\b/);
  if (gainAndDraw) {
    const lifeAmount = numberWordToInt(gainAndDraw[1]);
    const drawAmount = numberWordToInt(gainAndDraw[2]);
    if (lifeAmount && drawAmount) return { kind: "draw_cards", amount: drawAmount, optional, then: { kind: "gain_life", amount: lifeAmount } };
  }
  if (drawAndLoseLife) {
    const drawAmount = numberWordToInt(drawAndLoseLife[1]);
    const lifeAmount = numberWordToInt(drawAndLoseLife[2]);
    if (drawAmount && lifeAmount) return { kind: "draw_cards", amount: drawAmount, optional, then: { kind: "lose_life", amount: lifeAmount } };
  }
  if (damageToYouAndDraw) {
    const lifeAmount = numberWordToInt(damageToYouAndDraw[1]);
    const drawAmount = numberWordToInt(damageToYouAndDraw[2]);
    if (drawAmount && lifeAmount) return { kind: "draw_cards", amount: drawAmount, optional, then: { kind: "lose_life", amount: lifeAmount } };
  }

  // "Each opponent loses N life." with NO matching "you gain" (Vengeful Dead) — the drain checks above
  // all require the gain half.
  const opponentsLoseOnly = text.match(/\beach opponent loses\s+(\d+|one|two|three|four|five)\s+life\b(?!\s+and you gain)/);
  if (opponentsLoseOnly) {
    const amount = numberWordToInt(opponentsLoseOnly[1]);
    if (amount) return { kind: "drain", amount, scope: "each_opponent", noGain: true, optional };
  }

  // "Put a +1/+1 counter on each creature you control." (Archangel of Thune) and "Surveil 1." / "Scry 2." (Vanguard Seraph) as a
  // trigger's whole effect. Only in clause mode, where the text is a single triggered ability.
  if (mode === "clause") {
    const eachCounter = text.match(/\bput (a|one|two|three|\d+) (\+1\/\+1|-1\/-1) counters? on each ([a-z][a-z ]*?) you control\b/);
    const eachAmount = eachCounter ? numberWordToInt(eachCounter[1]) : undefined;
    if (eachCounter && eachAmount) return { kind: "add_counter", counterKind: eachCounter[2], amount: eachAmount, scope: "each_matching_you_control", matcher: eachCounter[3].trim(), optional };
    const lookMatch = text.match(/(?:^|[,.] ?)(scry|surveil) (\d+|a|one|two|three|four|five)\b/);
    const lookAmount = lookMatch ? numberWordToInt(lookMatch[2]) : undefined;
    if (lookMatch && lookAmount) return { kind: lookMatch[1] === "scry" ? "scry_cards" : "surveil_cards", amount: lookAmount };
  }

  const gainLife = text.match(/\byou gain\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\b/);
  if (gainLife) {
    const amount = numberWordToInt(gainLife[1]);
    if (amount) return { kind: "gain_life", amount, optional };
  }

  const loseLife = text.match(/\byou lose\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\b/);
  if (loseLife) {
    const amount = numberWordToInt(loseLife[1]);
    if (amount) return { kind: "lose_life", amount, optional };
  }

  // "You get an experience counter." (Meren of Clan Nel Toth's death trigger, and the same shape on
  // several other commanders) — no number word in the real templating (always exactly one at a
  // time), unlike gain/lose life above.
  const experienceCounter = /\byou get an experience counter\b/.test(text);
  if (experienceCounter) return { kind: "get_experience_counter", amount: 1, optional };

  // Checked before the plain draw count below: "Draw a card, then put a card from your hand on top
  // of your library." (Aminatou, the Fateshifter's +1) is a compound effect — matching it as plain
  // draw_cards first (extractCommonDrawCount would happily match the "draw a card" prefix) silently
  // dropped the "put back" half, since commonTriggerEffect only ever returns one effect per clause.
  const drawThenPutBack = text.match(
    /\bdraw\s+(a|one|two|three|four|five|\d+)\s+cards?,?\s*then put\s+(a|one|two|three|four|five|\d+)\s+cards?\s+from your hand on top of your library\b/
  );
  if (drawThenPutBack) {
    const drawAmount = numberWordToInt(drawThenPutBack[1]);
    const putBackAmount = numberWordToInt(drawThenPutBack[2]);
    if (drawAmount && putBackAmount) return { kind: "draw_then_put_back", drawAmount, putBackAmount, optional };
  }

  const drawThenLand = text.match(/\bdraw (a|one|two|\d+) cards?(?:,? then|\.) you may put a land card from your hand onto the battlefield\b/);
  if (drawThenLand) return { kind: "draw_then_land", amount: numberWordToInt(drawThenLand[1]) ?? 1, ...(/owner draws/.test(text) ? { ownerToo: true } : {}) };

  const drawInstead = text.match(/^draw (a|one|two|three) cards?\. if you control (a|one|two|three|four|five|\d+) or more ([a-z]+?)s?, draw (two|three|four|\d+) cards? instead\b/);
  if (drawInstead) {
    return { kind: "draw_cards", amount: numberWordToInt(drawInstead[1]) ?? 1, optional, moreIf: { type: drawInstead[3], atLeast: numberWordToInt(drawInstead[2]) ?? 1, amount: numberWordToInt(drawInstead[4]) ?? 2 } };
  }
  const drawCount = extractCommonDrawCount(text);
  if (drawCount) return { kind: "draw_cards", amount: drawCount, optional };

  // "put a +1/+1 counter on this creature" (self) / "...on target creature (you control)?" — this
  // engine has no generic targeted-trigger choice UI, so "target creature" resolves through the
  // same deterministic heuristic used for removal-spell targeting (see chooseCounterTarget). In
  // "entered" mode only, "on it"/"on that creature" (Cathars' Crusade-style: "whenever a creature
  // enters the battlefield under your control, put a +1/+1 counter on it") refers to the entering
  // permanent, not the trigger source — that shape doesn't make sense for a death trigger, since
  // the dying creature is gone and can't receive a counter, so it's excluded there. Counter kind
  // isn't always +1/+1 or -1/-1 — Athreos, Shroud-Veiled's "put a coin counter on target creature or
  // planeswalker" needs an arbitrary word to match too; "target creature" still matches as a prefix
  // of "target creature or planeswalker" here (the trailing "or planeswalker" is left unconsumed by
  // the match, not specially recognized — this engine has no planeswalker-target picker yet, so that
  // half of the target pool is narrowed to creatures only rather than left completely unhandled).
  // "on (another |up to one )?target creature" — Athreos, Shroud-Veiled's own real text is "put a
  // coin counter on another target creature" (not "target creature or planeswalker" as an earlier
  // pass here assumed) and Dusty Parlor's is "...on up to one target creature" — either qualifier
  // sitting between "on " and "target creature" made the old anchored alternation miss both,
  // silently dropping the whole trigger. The qualifier itself doesn't change who's a legal target
  // (still resolved via chooseCounterTarget same as a bare "target creature"), so it's just skipped
  // over rather than separately modeled.
  // "this creature" isn't the only self-reference shape — Boon of the Spirit Realm's Constellation
  // trigger puts its own blessing counter "on this enchantment," and other non-creature permanents
  // use "this artifact"/"this permanent"/"this land" the same way (mirrors the same alternation
  // transform_self's own parser already uses for "transform this X"). Without this, a self-counter
  // clause on any permanent that isn't literally a creature never matched at all.
  // "Tap up to one target creature and put a stun counter on it." (Fear of Sleep Paralysis's Eerie
  // ability) — checked before the generic counterPattern below, which would otherwise match "...
  // counter on it" and misread "it" via the "context" scope (meaning "the entering permanent," e.g.
  // Cathars' Crusade's "put a +1/+1 counter on it" referring to the creature that just entered).
  // Here "it" instead refers back to "target creature" named earlier in the SAME clause — an
  // unrelated, separately-chosen target, not the trigger's own entering permanent. Reported live as
  // the counter landing on the entering enchantment/itself instead of a real target creature, with
  // the tap half silently dropped entirely (no other kind here models tapping AND countering the
  // same permanent in one clause).
  const tapAndCounterMatch = text.match(
    /\btap up to one target creature and put (a|one|two|three|four|five|\d+) ([a-z]+) counters? on it\b/
  );
  if (tapAndCounterMatch) {
    const amount = numberWordToInt(tapAndCounterMatch[1]);
    if (amount) return { kind: "add_counter", counterKind: tapAndCounterMatch[2], amount, scope: "target_creature", alsoTap: true, optional: true };
  }

  const selfReference = "this (?:creature|artifact|enchantment|permanent|land|planeswalker)";
  const counterPattern =
    mode === "entered"
      ? new RegExp(`\\bput (a|one|two|three|four|five|\\d+) (\\+1\\/\\+1|-1\\/-1|[a-z]+) counters? on (${selfReference}|that creature|it|(?:another |up to one )?target creature(?: you control)?)\\b`)
      : new RegExp(`\\bput (a|one|two|three|four|five|\\d+) (\\+1\\/\\+1|-1\\/-1|[a-z]+) counters? on (${selfReference}|(?:another |up to one )?target creature(?: you control)?)\\b`);
  const counterMatch = text.match(counterPattern);
  if (counterMatch) {
    const amount = numberWordToInt(counterMatch[1]);
    if (amount) {
      const counterKind = counterMatch[2];
      const rawScope = counterMatch[3];
      const scope =
        rawScope.startsWith("this ")
          ? "self"
          : rawScope === "that creature" || rawScope === "it"
            ? "context"
            : rawScope.includes("you control")
              ? "target_creature_you_control"
              : "target_creature";
      return { kind: "add_counter", counterKind, amount, scope, optional };
    }
  }

  // "create a token that's a copy of it" (context — the permanent that triggered this, e.g. Ondu
  // Spiritdancer) / "...of this creature/artifact/enchantment/permanent/land/planeswalker" (self).
  // Deliberately narrow, matching this codebase's pattern elsewhere: a trailing "except it's also
  // X..." modifier (extremely common on copy effects) changes what gets copied in a way this
  // doesn't model, so it's declined rather than guessed at; likewise "of target X" (needs generic
  // targeting this engine doesn't have) and "of that card/permanent" referring to something
  // established in an earlier, separate clause.
  // Miirym, Sentinel Wyrm: "...create a token that's a copy of it, except the token isn't legendary."
  const tapPump = text.match(/(?:^|,\s*)you may tap x untapped ([a-z]+?)s? you control\. if you do, (?:this creature|~) gets \+x\/\+0 until end of turn and deals x damage to the player or planeswalker it'?s attacking/);
  if (tapPump) return { kind: "tap_subtype_pump_damage", subtype: capitalizeWord(tapPump[1]) };
  if (/\bfor each artifact you control, create a token that'?s a copy of it\. those tokens gain haste\. exile those tokens at the beginning of the next end step\b/.test(text)) return { kind: "copy_each_artifact_temp" };
  if (/\bcreate a token that'?s a copy of it, except the token isn'?t legendary\b/.test(text)) return { kind: "copy_token", scope: "context", notLegendary: true, optional };
  // Mirrorworks: "...you may pay {2}. If you do, create a token that's a copy of that artifact."
  const payCopy = text.match(/\byou may pay ((?:\{[^}]+\})+)\.\s*if you do, create a token that'?s a copy of that (?:artifact|creature|permanent|enchantment)\.?$/);
  if (payCopy) return { kind: "copy_token", scope: "context", payCostText: payCopy[1].toUpperCase(), optional: true };
  const copyMatch = text.match(/\bcreate a token that'?s a copy of (it|itself|this (?:creature|artifact|enchantment|permanent|land|planeswalker))\b(?!,?\s*except)/);
  if (copyMatch) {
    return { kind: "copy_token", scope: copyMatch[1] === "it" || copyMatch[1] === "itself" ? "context" : "self", optional };
  }

  // "[Each ][non-Type ]creature[s] [you control|your opponents control] get(s) +N/+N|-N/-N until end
  // of turn" as a triggered-ability clause (Doomwake Giant's Constellation "creatures your
  // opponents control get -1/-1 until end of turn") — the triggered-ability sibling of
  // parseMassPump, which only ever matches a spell's "each creature..." phrasing and misses this
  // "creatures your opponents control get..." shape.
  // "This creature gets +1/+0 until end of turn." — itself only. The broad "creature gets" pattern below read this as a
  // pump for EVERY creature.
  const selfPumpMatch = text.match(/\b(?:this creature|it) gets ([+-]\d+)\/([+-]\d+) until end of turn\b/);
  if (selfPumpMatch) return { kind: "self_pump", power: Number.parseInt(selfPumpMatch[1], 10), toughness: Number.parseInt(selfPumpMatch[2], 10), optional };
  // "Creatures you control gain trample and get +X/+X until end of turn, where X is the number of creatures you control." (Craterhoof Behemoth)
  const xPumpMatch = text.match(/\bcreatures you control gain ([a-z ]+?) and get \+x\/\+x until end of turn, where x is the number of creatures you control\b/);
  if (xPumpMatch) return { kind: "mass_pump", scope: "controlled", power: 0, toughness: 0, grantsKeyword: xPumpMatch[1], xFromCreatureCount: true, optional };
  // "Dragons you control get +1/+0 until end of turn." (Lathliss)
  const groupPumpMatch = text.match(/\b([a-z]+?)s you control get ([+-]\d+)\/([+-]\d+) until end of turn\b/);
  if (groupPumpMatch && groupPumpMatch[1] !== "creature") {
    return { kind: "mass_pump", scope: "controlled", matcher: groupPumpMatch[1], power: Number.parseInt(groupPumpMatch[2], 10), toughness: Number.parseInt(groupPumpMatch[3], 10), optional };
  }
  // "Each creature you control with power 4 or greater gets +1/+1 and gains trample until end of turn." (Goreclaw)
  const thresholdPump = text.match(/\beach creature you control with power (\d+) or greater gets ([+-]\d+)\/([+-]\d+)(?: and gains ([a-z ]+?))? until end of turn\b/);
  if (thresholdPump) {
    return {
      kind: "mass_pump",
      scope: "controlled",
      minPower: Number.parseInt(thresholdPump[1], 10),
      power: Number.parseInt(thresholdPump[2], 10),
      toughness: Number.parseInt(thresholdPump[3], 10),
      ...(thresholdPump[4] ? { grantsKeyword: thresholdPump[4] } : {}),
      optional
    };
  }
  const massPumpMatch = text.match(
    /\b(?:each )?(?:non-([a-z]+) )?creatures?(?: (you control)| (your opponents control|an opponent controls))? gets? ([+-]\d+)\/([+-]\d+) until end of turn\b/
  );
  if (massPumpMatch) {
    return {
      kind: "mass_pump",
      excludeType: massPumpMatch[1]?.toLowerCase(),
      power: Number.parseInt(massPumpMatch[4], 10),
      toughness: Number.parseInt(massPumpMatch[5], 10),
      scope: massPumpMatch[2] ? "controlled" : massPumpMatch[3] ? "opponents" : "all",
      optional
    };
  }

  // Triggered damage: "it deals X damage to any target, where X is the number of Dragons you control", "deals 4
  // damage to any target", "deals 7 damage to target creature ...". Previously no trigger kind modeled damage at all, so every
  // Dragon damage trigger was LLM-only or silently absent.
  if (/\bdeals damage equal to (?:its|that creature's) power to any target\b/.test(text)) return { kind: "context_power_damage", optional };
  const damageEffect = parseRemovalEffect(text);
  if (damageEffect && (damageEffect.kind === "damage" || damageEffect.kind === "mass_damage")) return { kind: "damage_effect", effect: damageEffect, optional };

  return undefined;
}

// A trailing "Do this only once each turn."/"Activate only once each turn." sentence is a generic
// limiter this engine enforces via a per-source-per-turn dedup key, the same shape as the
// loyalty-ability-once-per-turn tracker.
export function hasOnceEachTurnLimiter(oracleText: string): boolean {
  return /\b(?:do this|activate(?: this ability)?) only once (?:each|per) turn\b/i.test(oracleText);
}

function extractCommonDrawCount(text: string) {
  const match = text.match(/\bdraw\s+(a|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\b/);
  if (!match) return undefined;
  return numberWordToInt(match[1]);
}

// Generic circuit breaker, not specific to any one card: a self-copying permanent whose "only
// once each turn" restriction is scoped to the specific object (not the player or card name) can
// genuinely recurse forever in real rules — each token copy is a fresh object that hasn't used its
// own restriction yet. This engine auto-resolves "you may" as yes with no player-facing loop-count
// prompt, so without a hard stop that would actually hang on an unbounded setTimeout chain rather
// than modeling "the player gets to choose when to stop." 400/turn is well above any realistic
// non-looping turn (checked against normal SBA/ETB-trigger volumes elsewhere in this engine) but
// low enough to stop fast. Same "guard counter" pattern as checkStateBasedActions' pass limit.
const MAX_TRIGGER_RESOLUTIONS_PER_TURN = 400;

// Applies trigger.effect.then (Insidious Roots' "create a token, then put a +1/+1 counter on each
// Plant you control") as a second, recursively-resolved trigger against whatever session the
// primary effect left behind — the outer entry point every call site actually uses.
// resolveTriggerEffectOnce below (the original body of this function) resolves exactly one effect.
export function resolveTriggerEffect(session: GameSession, trigger: Extract<PendingAction, { type: "trigger" }>): GameSession {
  if (trigger.effect.oncePerTurn) {
    const onceKey = `${session.turn}:${trigger.sourceCardId}:once:${trigger.effect.kind}`;
    if (session.onceEachTurnEffectsUsed?.includes(onceKey)) return session;
    session = { ...session, onceEachTurnEffectsUsed: [...(session.onceEachTurnEffectsUsed ?? []), onceKey] };
  }
  const resolved = resolveTriggerEffectOnce(session, trigger);
  if (!trigger.effect.then) return resolved;
  return resolveTriggerEffect(resolved, { ...trigger, id: crypto.randomUUID(), effect: trigger.effect.then, message: "" });
}

// Pays {R} for each of `exact` (or as many as possible, up to twelve) from untapped sources. Undefined if none can be paid.
export function payRedMana(session: GameSession, seatId: string, exact?: number): { session: GameSession; count: number } | undefined {
  const payer = session.seats.find((item) => item.id === seatId);
  if (!payer) return undefined;
  const costText = (count: number) => "{R}".repeat(count);
  for (let count = exact ?? 12; count >= (exact ?? 1); count -= 1) {
    if (count < 1) break;
    const payment = chooseManaSourcesForCost(payer, genericManaAbilityCostShim({ costManaText: costText(count) }), count, undefined, session.seats);
    if (payment.ok) {
      const paid = { ...session, seats: session.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item)) };
      return { session: rulesEvent(paid, seatId, `${payer.name} pays ${costText(count)}.`), count };
    }
  }
  return undefined;
}

// "Look at the top N cards of your library. You may reveal a <type> card from among them and put it into your hand. Put the rest on
// the bottom in a random order." pickedId is the human's choice; omitted, the first qualifying card is taken. "none" takes nothing.
// Loot's version: the found creature enters the battlefield (its enters triggers follow through pendingEntries), subject to a mana value cap.
export function applyDigToBattlefield(session: GameSession, seatId: string, sourceName: string, count: number, maxManaValue: number, pickedId?: string, options?: { throne?: boolean }): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  const library = seat.library ?? [];
  const top = library.slice(0, count);
  const qualifies = (card: VisibleCard) => card.typeLine.includes("Creature") && card.manaValue <= maxManaValue;
  const found = pickedId === "none" ? undefined : pickedId ? top.find((card) => card.id === pickedId && qualifies(card)) : [...top].filter(qualifies).sort((a, b) => b.manaValue - a.manaValue)[0];
  const rest = top.filter((card) => card.id !== found?.id);
  const bottomed: GameSession = {
    ...session,
    seats: session.seats.map((item) => {
      if (item.id !== seatId) return item;
      const remaining = [...library.slice(top.length), ...shuffleCards(rest), ...(found ? [found] : [])];
      return { ...item, library: remaining, zones: { ...item.zones, library: remaining.length } };
    })
  };
  const entered = found ? moveLibraryCardToDestination(bottomed, seatId, found.id, "battlefield", false) : bottomed;
  // Throne of the Dead Three: three +1/+1 counters and hexproof (until your next turn — modelled as until end of turn).
  const placed =
    found && options?.throne
      ? { ...entered, seats: entered.seats.map((seat) => (seat.id !== seatId ? seat : { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === found.id ? { ...applyCounterDelta(card, "+1/+1", 3), temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), "hexproof"], grantedKeywords: [...(card.grantedKeywords ?? []), "hexproof"] } : card)) } })) }
      : entered;
  return rulesEvent(placed, seatId, found ? `${seat.name} uses ${sourceName} and puts ${found.name} onto the battlefield.` : `${seat.name} uses ${sourceName} but finds no creature that can enter.`);
}

export function findPermanentOwnerTarget(session: GameSession, cardId: string): ChosenTarget | undefined {
  const owner = session.seats.find((seat) => seat.board.battlefield.some((card) => card.id === cardId));
  return owner ? { kind: "card", seatId: owner.id, cardId } : undefined;
}

function triggerConditionMet(session: GameSession, trigger: Extract<PendingAction, { type: "trigger" }>, condition: TriggerCondition): boolean {
  const seat = session.seats.find((item) => item.id === trigger.controllerSeatId);
  if (!seat) return false;
  if (condition.kind === "source_untapped") {
    return seat.board.battlefield.some((card) => card.id === trigger.sourceCardId && !card.tapped);
  }
  if (condition.kind === "behold") {
    // "Behold a Dragon": control one, or reveal one from hand.
    const needle = condition.subtype.toLowerCase();
    return seat.board.battlefield.some((card) => card.typeLine.toLowerCase().includes(needle)) || seat.board.hand.some((card) => card.typeLine.toLowerCase().includes(needle));
  }
  if (condition.kind === "total_power_at_least") {
    return seat.board.battlefield.filter((card) => card.typeLine.includes("Creature")).reduce((total, card) => total + Math.max(0, effectivePower(card)), 0) >= condition.amount;
  }
  if (condition.kind === "controls_subtype_count") {
    return seat.board.battlefield.filter((card) => card.typeLine.toLowerCase().includes(condition.subtype.toLowerCase())).length >= condition.amount;
  }
  if (condition.kind === "attacking_power_at_least") {
    return seat.board.battlefield.filter((card) => card.attacking && card.typeLine.includes("Creature")).reduce((total, card) => total + Math.max(0, effectivePower(card)), 0) >= condition.amount;
  }
  if (condition.kind === "controls_no_other") {
    return !seat.board.battlefield.some((card) => card.id !== trigger.sourceCardId && card.typeLine.toLowerCase().includes(condition.subtype.toLowerCase()));
  }
  // "...if you control the creature with the greatest power or tied for the greatest power" — among ALL creatures.
  const powers = (target: PlayerSeat) => target.board.battlefield.filter((card) => card.typeLine.includes("Creature")).map((card) => effectivePower(card));
  const mine = Math.max(-Infinity, ...powers(seat));
  const best = Math.max(-Infinity, ...session.seats.flatMap(powers));
  return mine !== -Infinity && mine >= best;
}

function resolveTriggerEffectOnce(session: GameSession, trigger: Extract<PendingAction, { type: "trigger" }>): GameSession {
  const chainCount = (session.triggerChainGuard?.turn === session.turn ? session.triggerChainGuard.count : 0) + 1;
  session = { ...session, triggerChainGuard: { turn: session.turn, count: chainCount } };
  if (trigger.effect.condition && !triggerConditionMet(session, trigger, trigger.effect.condition)) return session;
  // Rule 603.4: an intervening "if" is checked again as the trigger resolves; if it is no longer true the ability does nothing.
  if (trigger.effect.recheckClause && phaseConditionBlocks(session, trigger.controllerSeatId, trigger.effect.recheckClause)) {
    return rulesEvent(session, trigger.controllerSeatId, `${trigger.sourceCardName}: its "if" condition is no longer true as it resolves, so it does nothing.`);
  }
  if (trigger.effect.kind === "phase_trigger") return resolvePhaseTriggerEffect(session, trigger, trigger.effect);
  if (recordedTriggerTargetGone(session, trigger)) {
    return rulesEvent(session, trigger.controllerSeatId, `${trigger.sourceCardName}'s target is no longer legal; the ability does nothing.`);
  }
  if (chainCount > MAX_TRIGGER_RESOLUTIONS_PER_TURN) {
    return {
      ...session,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: trigger.controllerSeatId,
          message: `${trigger.sourceCardName}'s trigger is not resolved — over ${MAX_TRIGGER_RESOLUTIONS_PER_TURN} triggered abilities have already resolved this turn, which likely means an unbounded loop. Stopping here.`,
          detail: "Rules action"
        },
        ...session.events
      ]
    };
  }

  const seatName = session.seats.find((seat) => seat.id === trigger.controllerSeatId)?.name ?? "Player";
  if (trigger.effect.kind === "draw_cards" && trigger.effect.moreIf) {
    const more = trigger.effect.moreIf;
    const controlled = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const drawAmount = controlled && controlled.board.battlefield.filter((card) => hasCardType(card, capitalizeWord(more.type))).length >= more.atLeast ? more.amount : trigger.effect.amount;
    return drawMultipleForSeat(session, trigger.controllerSeatId, drawAmount, `${trigger.sourceCardName} trigger resolves. ${seatName} draws ${drawAmount} card${drawAmount === 1 ? "" : "s"}.`);
  }
  if (trigger.effect.kind === "draw_cards") {
    return drawMultipleForSeat(session, trigger.controllerSeatId, trigger.effect.amount, `${trigger.sourceCardName} trigger resolves. ${seatName} draws ${trigger.effect.amount} card${trigger.effect.amount === 1 ? "" : "s"}.`);
  }
  if (trigger.effect.kind === "proliferate") return resolveProliferate(session);
  if (trigger.effect.kind === "search_library_put") return resolveSearchLibraryPut(session, trigger);
  if (trigger.effect.kind === "sacrifice_self_then_search") return resolveSacrificeSelfThenSearch(session, trigger);
  if (trigger.effect.kind === "exile_up_to_artifacts_enchantments" || trigger.effect.kind === "exile_until_leaves_each_opponent") {
    const controllerSeatId = trigger.controllerSeatId;
    const sourceCard = session.seats.flatMap((item) => item.board.battlefield).find((card) => card.id === trigger.sourceCardId) ?? ({ id: trigger.sourceCardId, name: trigger.sourceCardName, typeLine: "", oracleText: "", colors: [], manaValue: 0, role: "permanent", zone: "battlefield" } as VisibleCard);
    const legal = (seatId: string, card: VisibleCard) => seatId !== controllerSeatId && !hasShroud(card) && !hasHexproof(card) && !isProtectedFrom(card, sourceCard) && !card.phasedOut;
    const chosenIds = trigger.effect.chosenOption ? trigger.effect.chosenOption.split(",").filter(Boolean) : undefined;
    if (trigger.effect.kind === "exile_up_to_artifacts_enchantments") {
      const pool = session.seats.flatMap((item) => item.board.battlefield.filter((card) => (card.typeLine.includes("Artifact") || card.typeLine.includes("Enchantment")) && legal(item.id, card)).map((card) => ({ seatId: item.id, card })));
      const picks = chosenIds ? pool.filter((entry) => chosenIds.includes(entry.card.id)) : pool.sort((a, b) => b.card.manaValue - a.card.manaValue).slice(0, trigger.effect.count);
      let next = session;
      for (const pick of picks.slice(0, trigger.effect.count)) {
        next = moveCardAcrossSeats(next, pick.seatId, pick.card.id, pick.card.ownerSeatId ?? pick.seatId, "exile").session;
        next = rulesEvent(next, controllerSeatId, `${trigger.sourceCardName} exiles ${pick.card.name}.`);
      }
      return next;
    }
    let next = session;
    for (const opponent of session.seats) {
      if (opponent.id === controllerSeatId || opponent.hasLost) continue;
      const mine = opponent.board.battlefield.filter((card) => !isLandCard(card) && legal(opponent.id, card));
      const pick = (chosenIds ? mine.find((card) => chosenIds.includes(card.id)) : undefined) ?? (chosenIds ? undefined : [...mine].sort((a, b) => b.manaValue - a.manaValue)[0]);
      if (!pick) continue;
      const ownerId = pick.ownerSeatId ?? opponent.id;
      const moved = moveCardAcrossSeats(next, opponent.id, pick.id, ownerId, "exile");
      if (!moved.movedCard) continue;
      next = {
        ...moved.session,
        seats: moved.session.seats.map((item) =>
          item.id === ownerId ? { ...item, board: { ...item.board, exile: (item.board.exile ?? []).map((card) => (card.id === pick.id ? { ...card, exiledUntilSourceLeaves: trigger.sourceCardId } : card)) } } : item
        )
      };
      next = rulesEvent(next, controllerSeatId, `${trigger.sourceCardName} exiles ${pick.name} until it leaves the battlefield.`);
    }
    return next;
  }
  if (trigger.effect.kind === "pay_red_return_self_from_graveyard") {
    const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const card = owner?.board.graveyard?.find((item) => item.id === trigger.sourceCardId);
    if (!owner || !card) return session;
    const paid = payRedMana(session, owner.id, 1);
    if (!paid) return rulesEvent(session, owner.id, `${owner.name} can't pay {R} for ${trigger.sourceCardName}.`);
    return rulesEvent(
      {
        ...paid.session,
        seats: paid.session.seats.map((item) =>
          item.id !== owner.id
            ? item
            : {
                ...item,
                board: { ...item.board, graveyard: (item.board.graveyard ?? []).filter((entry) => entry.id !== card.id), hand: [...item.board.hand, { ...card, zone: "hand" as const }] },
                zones: { ...item.zones, graveyard: Math.max(0, item.zones.graveyard - 1), hand: item.zones.hand + 1 }
              }
        )
      },
      owner.id,
      `${owner.name} returns ${card.name} from their graveyard to their hand.`
    );
  }
  if (trigger.effect.kind === "damage_each_opponent") {
    const { amount } = trigger.effect;
    const sourceCard = session.seats.flatMap((item) => item.board.battlefield).find((card) => card.id === trigger.sourceCardId);
    let next = session;
    for (const opponent of session.seats) {
      if (opponent.id === trigger.controllerSeatId || opponent.hasLost) continue;
      next = applyCombatDamageToTarget(next, trigger.sourceCardName, { seat: next.seats.find((item) => item.id === opponent.id)! }, amount, sourceCard, trigger.controllerSeatId, "noncombat");
    }
    return next;
  }
  if (trigger.effect.kind === "pump_target_creature") {
    const { power, toughness, keywords } = trigger.effect;
    const mine = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const target = (trigger.effect.chosenOption ? mine?.board.battlefield.find((card) => card.id === trigger.effect.chosenOption) : undefined) ?? strongestControlledCreature(mine);
    if (!mine || !target) return session;
    return rulesEvent(
      {
        ...session,
        seats: session.seats.map((item) =>
          item.id !== mine.id
            ? item
            : {
                ...item,
                board: {
                  ...item.board,
                  battlefield: item.board.battlefield.map((card) =>
                    card.id === target.id
                      ? {
                          ...card,
                          temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + power,
                          temporaryToughnessBonus: (card.temporaryToughnessBonus ?? 0) + toughness,
                          temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), ...keywords],
                          grantedKeywords: [...new Set([...(card.grantedKeywords ?? []), ...keywords])]
                        }
                      : card
                  )
                }
              }
        )
      },
      mine.id,
      `${trigger.sourceCardName}: ${target.name} gets ${power >= 0 ? "+" : ""}${power}/${toughness >= 0 ? "+" : ""}${toughness}${keywords.length ? " and gains " + keywords.join(" and ") : ""} until end of turn.`
    );
  }
  if (trigger.effect.kind === "choose_named_mode") {
    const { options } = trigger.effect;
    const picked = (trigger.effect.chosenOption !== undefined ? options[Number.parseInt(trigger.effect.chosenOption, 10)] : undefined) ?? options[0];
    return rulesEvent(
      {
        ...session,
        seats: session.seats.map((item) => ({ ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === trigger.sourceCardId ? { ...card, chosenMode: picked } : card)) } }))
      },
      trigger.controllerSeatId,
      trigger.sourceCardName + ": " + picked + " is chosen."
    );
  }
  if (trigger.effect.kind === "hideaway") {
    const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const library = owner?.library ?? [];
    if (!owner || library.length === 0) return session;
    const top = library.slice(0, trigger.effect.count);
    // Keeps the most expensive nonland card (the best thing to play for free later), else the first card.
    const chosenIndex = trigger.effect.chosenOption !== undefined ? Number.parseInt(trigger.effect.chosenOption, 10) : undefined;
    const kept = (chosenIndex !== undefined ? top[chosenIndex] : undefined) ?? [...top].sort((a, b) => Number(!isLandCard(b)) - Number(!isLandCard(a)) || b.manaValue - a.manaValue)[0];
    const rest = top.filter((card) => card.id !== kept.id);
    const hidden: VisibleCard = { ...resetForZoneChange(kept, "exile"), ownerSeatId: kept.ownerSeatId ?? owner.id, hideawaySourceId: trigger.sourceCardId };
    const seats = session.seats.map((item) => {
      if (item.id !== owner.id) return item;
      const remaining = [...library.slice(top.length), ...shuffleCards(rest)];
      return { ...item, library: remaining, board: { ...item.board, exile: [...(item.board.exile ?? []), hidden] }, zones: { ...item.zones, library: remaining.length, exile: item.zones.exile + 1 } };
    });
    return rulesEvent({ ...session, seats }, owner.id, `${trigger.sourceCardName}: ${owner.name} exiles a card face down (hideaway).`);
  }
  if (trigger.effect.kind === "mill_with_rewards") {
    const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const top = owner?.library?.[0];
    if (!owner || !top) return rulesEvent(session, trigger.controllerSeatId, `${trigger.sourceCardName}: ${owner?.name ?? "the player"} has no card to mill.`);
    const milled = applyMill(session, owner.id, trigger.sourceCardName, 1);
    const reward = isLandCard(top) ? "create a Treasure token." : top.typeLine.includes("Creature") ? "create a 1/1 green Insect creature token." : "create a Blood token.";
    const specs = parseCreateTokenSpecs(reward);
    return specs.length > 0 ? createTokensForSeat(milled, owner.id, trigger.sourceCardId, specs).session : milled;
  }
  if (trigger.effect.kind === "sacrifice_surplus_then_draw") {
    const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    if (!owner) return session;
    const lands = owner.board.battlefield.filter((card) => isLandCard(card) && card.id !== trigger.sourceCardId).sort((a, b) => Number(Boolean(b.tapped)) - Number(Boolean(a.tapped)));
    const option = trigger.effect.chosenOption;
    const chosenCount = option !== undefined && /^\d+$/.test(option) ? Number.parseInt(option, 10) : undefined;
    // The human's own picks (any permanents); agents sacrifice surplus lands beyond seven.
    const pickedIds = option !== undefined && chosenCount === undefined ? option.split(",").filter(Boolean) : undefined;
    const surplus = pickedIds
      ? owner.board.battlefield.filter((card) => pickedIds.includes(card.id) && card.id !== trigger.sourceCardId)
      : lands.slice(0, chosenCount !== undefined ? Math.max(0, Math.min(chosenCount, lands.length)) : Math.max(0, lands.length - 7));
    if (surplus.length === 0) return rulesEvent(session, owner.id, `${trigger.sourceCardName}: ${owner.name} sacrifices nothing.`);
    const ids = new Set(surplus.map((card) => card.id));
    const sacrificed: GameSession = {
      ...session,
      seats: session.seats.map((item) =>
        item.id !== owner.id
          ? item
          : {
              ...item,
              board: {
                ...item.board,
                battlefield: item.board.battlefield.filter((card) => !ids.has(card.id)),
                graveyard: [...(item.board.graveyard ?? []), ...surplus.filter((card) => !card.token).map((card) => ({ ...resetForZoneChange(card, "graveyard"), ownerSeatId: card.ownerSeatId ?? owner.id }))]
              },
              zones: { ...item.zones, battlefield: item.zones.battlefield - surplus.length, graveyard: item.zones.graveyard + surplus.filter((card) => !card.token).length }
            }
      )
    };
    return drawMultipleForSeat(rulesEvent(sacrificed, owner.id, `${trigger.sourceCardName}: ${owner.name} sacrifices ${surplus.length} surplus land${surplus.length === 1 ? "" : "s"}.`), owner.id, surplus.length, `${owner.name} draws ${surplus.length} card${surplus.length === 1 ? "" : "s"} from ${trigger.sourceCardName}.`);
  }
  if (trigger.effect.kind === "graveyard_creature_to_library_top") {
    const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const best = (trigger.effect.chosenOption ? owner?.board.graveyard?.find((card) => card.id === trigger.effect.chosenOption) : undefined) ?? (owner?.board.graveyard ?? []).filter((card) => card.typeLine.includes("Creature")).sort((a, b) => b.manaValue - a.manaValue)[0];
    if (!owner || !best) return session;
    return rulesEvent(moveCardAcrossSeats(session, owner.id, best.id, owner.id, "library", { libraryPosition: "top" }).session, owner.id, `${owner.name} puts ${best.name} on top of their library (${trigger.sourceCardName}).`);
  }
  if (trigger.effect.kind === "self_to_library_third") {
    const holder = session.seats.find((item) => [...(item.board.graveyard ?? []), ...(item.board.exile ?? [])].some((card) => card.id === trigger.sourceCardId));
    const card = holder ? [...(holder.board.graveyard ?? []), ...(holder.board.exile ?? [])].find((c) => c.id === trigger.sourceCardId) : undefined;
    if (!holder || !card) return session;
    const ownerId = card.ownerSeatId ?? holder.id;
    const removed = session.seats.map((item) =>
      item.id !== holder.id ? item : { ...item, board: { ...item.board, graveyard: (item.board.graveyard ?? []).filter((c) => c.id !== card.id), exile: (item.board.exile ?? []).filter((c) => c.id !== card.id) }, zones: { ...item.zones, graveyard: Math.max(0, item.zones.graveyard - ((item.board.graveyard ?? []).some((c) => c.id === card.id) ? 1 : 0)), exile: Math.max(0, item.zones.exile - ((item.board.exile ?? []).some((c) => c.id === card.id) ? 1 : 0)) } }
    );
    const placed = removed.map((item) => {
      if (item.id !== ownerId) return item;
      const library = [...(item.library ?? [])];
      library.splice(Math.min(2, library.length), 0, { ...resetForZoneChange(card, "library"), zone: "library" as const });
      return { ...item, library, zones: { ...item.zones, library: library.length } };
    });
    return rulesEvent({ ...session, seats: placed }, ownerId, `${trigger.sourceCardName} is put into its owner's library third from the top.`);
  }
  if (trigger.effect.kind === "zone_effect") return applyZoneEffect(session, trigger.controllerSeatId, trigger.sourceCardName, trigger.effect.effect);
  if (trigger.effect.kind === "landfall_return_nonland_permanent") {
    const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const permanentCard = (card: VisibleCard) => !isLandCard(card) && /Creature|Artifact|Enchantment|Planeswalker|Battle/.test(card.typeLine);
    const pick =
      (trigger.effect.chosenOption ? owner?.board.graveyard?.find((card) => card.id === trigger.effect.chosenOption && permanentCard(card)) : undefined) ??
      (trigger.effect.chosenOption ? undefined : [...(owner?.board.graveyard ?? [])].filter(permanentCard).sort((a, b) => b.manaValue - a.manaValue)[0]);
    if (!owner || !pick) return session;
    const land = session.seats.flatMap((item) => item.board.battlefield).find((card) => card.id === trigger.contextCardId);
    const toBattlefield = trigger.effect.plainsToBattlefield && !trigger.effect.toHand && Boolean(land?.typeLine.includes("Plains"));
    const moved = moveCardAcrossSeats(session, owner.id, pick.id, owner.id, toBattlefield ? "battlefield" : "hand");
    return rulesEvent(moved.session, owner.id, `${trigger.sourceCardName}: ${owner.name} returns ${pick.name} from their graveyard to ${toBattlefield ? "the battlefield" : "their hand"}.`);
  }
  if (trigger.effect.kind === "self_becomes_dragon") {
    const { power, toughness, keywords } = trigger.effect;
    return {
      ...session,
      seats: session.seats.map((item) => ({
        ...item,
        board: {
          ...item.board,
          battlefield: item.board.battlefield.map((card) =>
            card.id !== trigger.sourceCardId
              ? card
              : {
                  ...card,
                  temporaryOriginalTypeLine: card.temporaryOriginalTypeLine ?? card.typeLine,
                  typeLine: card.typeLine.includes("Dragon") ? card.typeLine : card.typeLine + " Dragon",
                  temporaryBasePower: power,
                  temporaryBaseToughness: toughness,
                  temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), ...keywords],
                  grantedKeywords: [...new Set([...(card.grantedKeywords ?? []), ...keywords])]
                }
          )
        }
      }))
    };
  }
  if (trigger.effect.kind === "dragon_from_hand_attacking") {
    const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    if (!owner) return session;
    const word = trigger.effect.subtype.toLowerCase();
    const candidates = owner.board.hand.filter((card) => card.typeLine.includes("Creature") && card.typeLine.toLowerCase().includes(word));
    const chosenIndex = trigger.effect.chosenOption !== undefined ? Number.parseInt(trigger.effect.chosenOption, 10) : undefined;
    const pick = chosenIndex !== undefined ? candidates[chosenIndex] : [...candidates].sort((a, b) => effectivePower(b) - effectivePower(a))[0];
    if (!pick) return session;
    const attacker = owner.board.battlefield.find((card) => card.id === trigger.contextCardId && card.attacking) ?? owner.board.battlefield.find((card) => card.attacking);
    const moved = moveCardAcrossSeats(session, owner.id, pick.id, owner.id, "battlefield", { tapped: true });
    if (!moved.movedCard) return session;
    return rulesEvent(
      {
        ...moved.session,
        seats: moved.session.seats.map((item) =>
          item.id !== owner.id ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === pick.id ? { ...card, attacking: true, attackTargetId: attacker?.attackTargetId, tapped: true } : card)) } }
        )
      },
      owner.id,
      `${trigger.sourceCardName}: ${owner.name} puts ${pick.name} onto the battlefield tapped and attacking.`
    );
  }
  if (trigger.effect.kind === "renown") {
    const amount = trigger.effect.amount;
    const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const card = owner?.board.battlefield.find((entry) => entry.id === trigger.sourceCardId);
    if (!owner || !card || card.renowned) return session;
    return rulesEvent(
      { ...session, seats: session.seats.map((item) => (item.id !== owner.id ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((entry) => (entry.id === card.id ? { ...applyCounterDelta(entry, "+1/+1", amount), renowned: true } : entry)) } })) },
      owner.id,
      `${card.name} becomes renowned and gets ${amount} +1/+1 counter${amount === 1 ? "" : "s"}.`
    );
  }
  if (trigger.effect.kind === "battle_cry") {
    const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    if (!owner) return session;
    const others = owner.board.battlefield.filter((card) => card.attacking && card.id !== trigger.sourceCardId);
    if (others.length === 0) return session;
    const ids = new Set(others.map((card) => card.id));
    return rulesEvent(
      { ...session, seats: session.seats.map((item) => (item.id !== owner.id ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (ids.has(card.id) ? { ...card, temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + 1 } : card)) } })) },
      owner.id,
      `${trigger.sourceCardName} (battle cry): ${others.length} other attacking creature${others.length === 1 ? " gets" : "s get"} +1/+0.`
    );
  }
  if (trigger.effect.kind === "melee") {
    const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    if (!owner) return session;
    // One per different opponent being attacked this combat (a planeswalker counts for its controller).
    const attacked = new Set<string>();
    for (const attacker of owner.board.battlefield.filter((card) => card.attacking)) {
      const targetSeat = session.seats.find((item) => item.id === attacker.attackTargetId) ?? session.seats.find((item) => item.board.battlefield.some((card) => card.id === attacker.attackTargetId));
      if (targetSeat && targetSeat.id !== owner.id) attacked.add(targetSeat.id);
    }
    if (attacked.size === 0) return session;
    return rulesEvent(
      { ...session, seats: session.seats.map((item) => (item.id !== owner.id ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === trigger.sourceCardId ? { ...card, temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + attacked.size, temporaryToughnessBonus: (card.temporaryToughnessBonus ?? 0) + attacked.size } : card)) } })) },
      owner.id,
      `${trigger.sourceCardName} (melee): +${attacked.size}/+${attacked.size} until end of turn.`
    );
  }
  if (trigger.effect.kind === "myriad") {
    const { defendingSeatId } = trigger.effect;
    const original = session.seats.flatMap((item) => item.board.battlefield).find((card) => card.id === trigger.sourceCardId);
    if (!original) return session;
    let next = session;
    for (const opponent of session.seats) {
      if (opponent.id === trigger.controllerSeatId || opponent.id === defendingSeatId || opponent.hasLost) continue;
      const created = createCopyTokenForSeat(next, trigger.controllerSeatId, original);
      next = {
        ...created.session,
        seats: created.session.seats.map((item) =>
          item.id !== trigger.controllerSeatId
            ? item
            : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === created.token.id ? { ...card, tapped: true, attacking: true, attackTargetId: opponent.id, summoningSick: false, exileAtEndOfCombat: true } : card)) } }
        )
      };
      next = rulesEvent(next, trigger.controllerSeatId, `${trigger.sourceCardName} (myriad): a token copy enters tapped and attacking ${opponent.name}.`);
    }
    return next;
  }
  if (trigger.effect.kind === "exile_top_by_power_then_damage") {
    const { minPower, damagePerCard } = trigger.effect;
    const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    if (!owner) return session;
    const amount = owner.board.battlefield.filter((card) => card.typeLine.includes("Creature") && effectivePower(card) >= minPower).length;
    const topIds = (owner.library ?? []).slice(0, amount).map((card) => card.id);
    let next = session;
    for (const id of topIds) next = moveCardAcrossSeats(next, owner.id, id, owner.id, "exile").session;
    next = {
      ...next,
      seats: next.seats.map((item) =>
        item.id !== owner.id
          ? item
          : {
              ...item,
              board: {
                ...item.board,
                exile: (item.board.exile ?? []).map((card) =>
                  topIds.includes(card.id)
                    ? { ...card, exiledPlayableBySeatId: owner.id, exiledPlayableUntilTurn: session.turn, exileEndStepDamage: { sourceName: trigger.sourceCardName, controllerSeatId: owner.id, amount: damagePerCard } }
                    : card
                )
              }
            }
      )
    };
    return rulesEvent(next, owner.id, `${trigger.sourceCardName}: ${owner.name} exiles the top ${topIds.length} card${topIds.length === 1 ? "" : "s"} of their library and may play them until their end step.`);
  }
  if (trigger.effect.kind === "shock_pay") {
    const shockOwner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const shockLand = shockOwner?.board.battlefield.find((card) => card.id === trigger.sourceCardId);
    const shockLife = trigger.effect.life;
    if (trigger.effect.chosenOption !== "0" || !shockOwner || !shockLand || shockOwner.life <= shockLife) return rulesEvent(session, trigger.controllerSeatId, `${trigger.sourceCardName} stays tapped.`);
    const paid = { ...session, seats: session.seats.map((item) => (item.id !== shockOwner.id ? item : { ...item, life: item.life - shockLife, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === shockLand.id ? { ...card, tapped: false } : card)) } })) } as GameSession;
    return rulesEvent(paid, shockOwner.id, `${shockOwner.name} pays ${shockLife} life: ${trigger.sourceCardName} enters untapped.`);
  }
  if (trigger.effect.kind === "reveal_land_untap") {
    const revealOwner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const revealLand = revealOwner?.board.battlefield.find((card) => card.id === trigger.sourceCardId);
    const revealIds = trigger.effect.cardIds;
    const pickedIndex = trigger.effect.chosenOption !== undefined ? Number.parseInt(trigger.effect.chosenOption, 10) : Number.NaN;
    const revealed = Number.isFinite(pickedIndex) ? revealOwner?.board.hand.find((card) => card.id === revealIds[pickedIndex]) : undefined;
    if (!revealOwner || !revealLand || !revealed) return rulesEvent(session, trigger.controllerSeatId, `${trigger.sourceCardName}: ${revealOwner?.name ?? "Player"} does not reveal a card, so it stays tapped.`);
    const untapped = { ...session, seats: session.seats.map((item) => (item.id !== revealOwner.id ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === revealLand.id ? { ...card, tapped: false } : card)) } })) } as GameSession;
    return rulesEvent(untapped, revealOwner.id, `${revealOwner.name} reveals ${revealed.name} from their hand: ${trigger.sourceCardName} enters untapped.`);
  }
  if (trigger.effect.kind === "phase_optional") {
    if (trigger.effect.chosenOption !== "0") return rulesEvent(session, trigger.controllerSeatId, `${trigger.sourceCardName}: you decline.`);
    const phaseSource = findPermanentById(session, trigger.sourceCardId);
    return (phaseSource ? applyDeterministicPhaseTrigger(session, trigger.controllerSeatId, phaseSource, trigger.effect.phase) : undefined) ?? session;
  }
  if (trigger.effect.kind === "discard_any_then_draw") {
    const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    if (!owner) return session;
    const lands = owner.board.battlefield.filter((card) => isLandCard(card)).length;
    // Agents discard what they can't use: extra lands once they have plenty, and spells far above their mana.
    const aiPicks = owner.board.hand.filter((card) => (isLandCard(card) ? lands >= 6 : card.manaValue >= lands + 4)).map((card) => card.id);
    const ids = (trigger.effect.chosenOption !== undefined ? trigger.effect.chosenOption.split(",").filter(Boolean) : aiPicks).filter((id) => owner.board.hand.some((card) => card.id === id)).slice(0, trigger.effect.max ?? Number.POSITIVE_INFINITY);
    const bonus = trigger.effect.plusOne ? 1 : 0;
    if (ids.length === 0 && bonus === 0) return rulesEvent(session, owner.id, `${trigger.sourceCardName}: ${owner.name} discards nothing.`);
    let next = session;
    for (const id of ids) {
      next = trigger.effect.toLibraryBottom ? moveCardAcrossSeats(next, owner.id, id, owner.id, "library", { libraryPosition: "bottom" }).session : moveCardBetweenVisibleZones(next, owner.id, id, "graveyard");
    }
    next = rulesEvent(next, owner.id, `${trigger.sourceCardName}: ${owner.name} ${trigger.effect.toLibraryBottom ? "puts" : "discards"} ${ids.length} card${ids.length === 1 ? "" : "s"}${trigger.effect.toLibraryBottom ? " on the bottom of their library" : ""}.`);
    return drawMultipleForSeat(next, owner.id, ids.length + bonus, `${owner.name} draws ${ids.length + bonus} card${ids.length + bonus === 1 ? "" : "s"} from ${trigger.sourceCardName}.`);
  }
  if (trigger.effect.kind === "exile_self_return_creature_to_hand") {
    const holder = session.seats.find((item) => (item.board.graveyard ?? []).some((card) => card.id === trigger.sourceCardId));
    const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    if (!holder || !owner) return session;
    const exiled = moveCardAcrossSeats(session, holder.id, trigger.sourceCardId, holder.id, "exile").session;
    const ownGraveyard = exiled.seats.find((item) => item.id === owner.id)?.board.graveyard ?? [];
    const best = (trigger.effect.chosenOption ? ownGraveyard.find((card) => card.id === trigger.effect.chosenOption) : undefined) ?? ownGraveyard.filter((card) => card.typeLine.includes("Creature")).sort((a, b) => b.manaValue - a.manaValue)[0];
    const withEvent = rulesEvent(exiled, owner.id, `${owner.name} exiles ${trigger.sourceCardName}.`);
    return best ? rulesEvent(moveCardAcrossSeats(withEvent, owner.id, best.id, owner.id, "hand").session, owner.id, `${trigger.sourceCardName} returns ${best.name} to ${owner.name}'s hand.`) : withEvent;
  }
  if (trigger.effect.kind === "dig_nonland_to_hand") {
    const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const library = owner?.library ?? [];
    const index = library.findIndex((card) => !isLandCard(card));
    if (!owner) return session;
    const exiledLands = (index < 0 ? library : library.slice(0, index)).map((card) => ({ ...resetForZoneChange(card, "exile"), ownerSeatId: card.ownerSeatId ?? owner.id }));
    const found = index >= 0 ? library[index] : undefined;
    const cut = index < 0 ? library.length : index + 1;
    // "You may cast it without paying its mana cost if that spell's mana value is 8 or less. If you don't, put that card into your hand."
    // The card waits in exile with a free-cast permission; a cast-or-hand decision (pendingDiscoverChoices) follows.
    const castable = Boolean(found && found.manaValue <= 8);
    const foundInExile = found && castable ? { ...resetForZoneChange(found, "exile"), ownerSeatId: found.ownerSeatId ?? owner.id, exiledPlayableBySeatId: owner.id, exiledPlayableFree: true, exiledPlayableAnyTime: true } : undefined;
    const seats = session.seats.map((item) =>
      item.id !== owner.id
        ? item
        : {
            ...item,
            library: library.slice(cut),
            board: {
              ...item.board,
              exile: [...(item.board.exile ?? []), ...exiledLands, ...(foundInExile ? [foundInExile] : [])],
              hand: found && !castable ? [...item.board.hand, { ...found, zone: "hand" as const }] : item.board.hand
            },
            zones: { ...item.zones, library: library.length - cut, exile: item.zones.exile + exiledLands.length + (foundInExile ? 1 : 0), hand: item.zones.hand + (found && !castable ? 1 : 0) }
          }
    );
    if (found && castable) {
      return rulesEvent(
        { ...session, seats, pendingDiscoverChoices: [...(session.pendingDiscoverChoices ?? []), { seatId: owner.id, cardId: found.id, cardName: found.name, sourceName: trigger.sourceCardName }] },
        owner.id,
        `${trigger.sourceCardName}: ${owner.name} exiles ${exiledLands.length} land${exiledLands.length === 1 ? "" : "s"} and ${found.name}, which may be cast without paying its mana cost.`
      );
    }
    return rulesEvent({ ...session, seats }, owner.id, found ? `${trigger.sourceCardName}: ${owner.name} exiles ${exiledLands.length} land${exiledLands.length === 1 ? "" : "s"} and puts ${found.name} into their hand.` : `${trigger.sourceCardName}: no nonland card to find.`);
  }
  if (trigger.effect.kind === "pay_red_for_damage") {
    const payer = session.seats.find((item) => item.id === trigger.controllerSeatId);
    if (!payer) return session;
    // The human's pick is an exact amount; otherwise every red it can pay.
    const exact = trigger.effect.chosenOption !== undefined ? Number.parseInt(trigger.effect.chosenOption, 10) : undefined;
    if (exact === 0) return session;
    const paidResult = payRedMana(session, payer.id, exact);
    if (!paidResult) return rulesEvent(session, payer.id, `${payer.name} has no red mana to pay for ${trigger.sourceCardName}.`);
    const source = { id: trigger.sourceCardId, name: trigger.sourceCardName, typeLine: "", oracleText: "", colors: ["R"], manaValue: 0, role: "permanent", zone: "graveyard" } as VisibleCard;
    return applyRemovalEffect(paidResult.session, payer.id, trigger.sourceCardName, source, { kind: "damage", amount: paidResult.count, targetType: "any" });
  }
  if (trigger.effect.kind === "self_gains_keywords") {
    const keywords = trigger.effect.keywords;
    return {
      ...session,
      seats: session.seats.map((item) => ({
        ...item,
        board: {
          ...item.board,
          battlefield: item.board.battlefield.map((card) =>
            card.id === trigger.sourceCardId ? { ...card, temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), ...keywords], grantedKeywords: [...new Set([...(card.grantedKeywords ?? []), ...keywords])] } : card
          )
        }
      }))
    };
  }
  if (trigger.effect.kind === "gift_destroy_artifact_or_enchantment") {
    const source = session.seats.flatMap((item) => item.board.battlefield).find((card) => card.id === trigger.sourceCardId);
    const before = new Map(session.seats.map((item) => [item.id, item.board.battlefield.length]));
    const destroyed = applyRemovalEffect(session, trigger.controllerSeatId, trigger.sourceCardName, source ?? ({ id: trigger.sourceCardId, name: trigger.sourceCardName, typeLine: "", oracleText: "", colors: [], manaValue: 0, role: "permanent", zone: "battlefield" } as VisibleCard), {
      kind: "destroy",
      targetType: "artifact_or_enchantment",
      excludedColors: [],
      artifactsExcluded: false,
      basicsExcluded: false
    }, undefined, trigger.effect.chosenOption ? findPermanentOwnerTarget(session, trigger.effect.chosenOption) : undefined);
    const victim = destroyed.seats.find((item) => item.id !== trigger.controllerSeatId && item.board.battlefield.length < (before.get(item.id) ?? 0));
    if (!victim) return session;
    return drawForSeat(destroyed, victim.id, `${victim.name} draws a card (the gift promised with ${trigger.sourceCardName}).`);
  }
  if (trigger.effect.kind === "reveal_until_land_to_battlefield") {
    const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const library = owner?.library ?? [];
    const landIndex = library.findIndex((card) => isLandCard(card));
    if (!owner) return session;
    if (landIndex < 0) return rulesEvent(session, owner.id, `${trigger.sourceCardName}: no land card in ${owner.name}'s library.`);
    const revealed = library.slice(0, landIndex);
    const land = library[landIndex];
    const afterLand = moveLibraryCardToDestination(session, owner.id, land.id, "battlefield", true);
    const revealedIds = new Set(revealed.map((card) => card.id));
    const reordered: GameSession = {
      ...afterLand,
      seats: afterLand.seats.map((item) => {
        if (item.id !== owner.id) return item;
        const rest = (item.library ?? []).filter((card) => !revealedIds.has(card.id));
        const library = [...rest, ...shuffleCards(revealed)];
        return { ...item, library, zones: { ...item.zones, library: library.length } };
      })
    };
    return rulesEvent(reordered, owner.id, `${trigger.sourceCardName}: ${owner.name} reveals ${revealed.length + 1} card${revealed.length === 0 ? "" : "s"} and puts ${land.name} onto the battlefield tapped.`);
  }
  if (trigger.effect.kind === "aura_reanimate") {
    const controllerId = trigger.controllerSeatId;
    // The human's pick (a card id), else the best creature card in any graveyard.
    let holderId: string | undefined;
    let cardId: string | undefined;
    if (trigger.effect.chosenOption) {
      const holder = session.seats.find((other) => (other.board.graveyard ?? []).some((card) => card.id === trigger.effect.chosenOption));
      if (holder) {
        holderId = holder.id;
        cardId = trigger.effect.chosenOption;
      }
    }
    if (!cardId) {
      const best = chooseReanimationTarget(session, controllerId, true, "creature");
      if (best) {
        holderId = best.seatId;
        cardId = best.card.id;
      }
    }
    if (!holderId || !cardId) return rulesEvent(session, controllerId, `${trigger.sourceCardName}: no creature card in any graveyard.`);
    const moved = moveCardAcrossSeats(session, holderId, cardId, controllerId, "battlefield");
    return rulesEvent(
      {
        ...moved.session,
        seats: moved.session.seats.map((other) =>
          other.id !== controllerId
            ? other
            : {
                ...other,
                board: {
                  ...other.board,
                  battlefield: other.board.battlefield.map((card) =>
                    card.id === trigger.sourceCardId ? { ...card, attachedToId: cardId } : card.id === cardId ? { ...card, reanimatedByAuraId: trigger.sourceCardId } : card
                  )
                }
              }
        )
      },
      controllerId,
      `${trigger.sourceCardName} returns a creature card from a graveyard and attaches to it.`
    );
  }
  if (trigger.effect.kind === "put_any_from_hand") {
    const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    if (!owner) return session;
    const matches = (card: VisibleCard) =>
      trigger.effect.kind === "put_any_from_hand" &&
      (trigger.effect.filter === "permanent" ? !/Instant|Sorcery/.test(card.typeLine) : card.typeLine.includes(trigger.effect.filter.charAt(0).toUpperCase() + trigger.effect.filter.slice(1)));
    const wanted = trigger.effect.chosenOption !== undefined ? trigger.effect.chosenOption.split(",").filter(Boolean) : owner.board.hand.filter(matches).sort((a, b) => b.manaValue - a.manaValue).map((card) => card.id);
    let next = session;
    let count = 0;
    for (const id of wanted) {
      const card = owner.board.hand.find((item) => item.id === id);
      if (!card || !matches(card)) continue;
      next = moveCardAcrossSeats(next, owner.id, id, owner.id, "battlefield", { tapped: trigger.effect.tapped }).session;
      count += 1;
    }
    return rulesEvent(next, owner.id, `${trigger.sourceCardName}: ${owner.name} puts ${count} card${count === 1 ? "" : "s"} from hand onto the battlefield.`);
  }
  if (trigger.effect.kind === "return_marked_to_battlefield") {
    const holder = session.seats.find((item) => [...(item.board.graveyard ?? []), ...(item.board.exile ?? [])].some((card) => card.id === trigger.contextCardId));
    if (!holder || !trigger.contextCardId) return rulesEvent(session, trigger.controllerSeatId, `${trigger.sourceCardName}: the card is no longer in a graveyard or exile, so nothing returns.`);
    const moved = moveCardAcrossSeats(session, holder.id, trigger.contextCardId, trigger.controllerSeatId, "battlefield");
    return rulesEvent(moved.session, trigger.controllerSeatId, `${trigger.sourceCardName} returns ${moved.movedCard?.name ?? "the card"} to the battlefield under its controller's control.`);
  }
  if (trigger.effect.kind === "undying_return") {
    const holder = session.seats.find((item) => (item.board.graveyard ?? []).some((card) => card.id === trigger.sourceCardId));
    if (!holder) return session;
    const ownerId = (holder.board.graveyard ?? []).find((card) => card.id === trigger.sourceCardId)?.ownerSeatId ?? holder.id;
    const kind = trigger.effect.counterKind;
    const moved = moveCardAcrossSeats(session, holder.id, trigger.sourceCardId, ownerId, "battlefield");
    const returned = moved.session.seats
      .find((item) => item.id === ownerId)
      ?.board.battlefield.find((card) => card.id === trigger.sourceCardId);
    if (!returned) return moved.session;
    return rulesEvent(
      {
        ...moved.session,
        seats: moved.session.seats.map((item) =>
          item.id !== ownerId
            ? item
            : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === trigger.sourceCardId ? { ...card, counters: [...(card.counters ?? []).filter((counter) => counter.kind !== kind), { kind, count: 1 }] } : card)) } }
        )
      },
      ownerId,
      `${trigger.sourceCardName} returns to the battlefield with a ${kind} counter.`
    );
  }
  if (trigger.effect.kind === "d20_roll") {
    const roll = randomInt(20) + 1;
    const rolled = rulesEvent(session, trigger.controllerSeatId, `${trigger.sourceCardName}: rolls a d20 and gets ${roll}.`);
    if (trigger.effect.payoff === "draw") return drawMultipleForSeat(rolled, trigger.controllerSeatId, roll, `${trigger.sourceCardName}: draws ${roll} cards.`);
    const specs = trigger.effect.payoff === "treasures"
      ? [{ ...predefinedTokenSpec("Treasure"), count: roll }]
      : parseCreateTokenSpecs("create a 1/1 blue Faerie Dragon creature token with flying").map((spec) => ({ ...spec, count: roll }));
    return createTokensForSeat(rolled, trigger.controllerSeatId, trigger.sourceCardId, specs).session;
  }
  if (trigger.effect.kind === "each_opponent_sacrifices") {
    const { filter, includeSelf } = trigger.effect;
    const destructions: Array<{ seatId: string; cardId: string; message: string }> = [];
    const humanChoices: Array<{ seatId: string; sourceCardId: string; sourceCardName: string; count: number; typeFilter: string }> = [];
    for (const victim of session.seats) {
      if (victim.hasLost || (victim.id === trigger.controllerSeatId && !includeSelf)) continue;
      if (trigger.effect.onlySeatId && victim.id !== trigger.effect.onlySeatId) continue;
      const candidates = victim.board.battlefield
        .filter((card) => matchesEachPlayerSacrificeFilter(card, filter))
        .sort((a, b) => Number(Boolean(b.token)) - Number(Boolean(a.token)) || effectivePower(a) + effectiveToughness(a) - (effectivePower(b) + effectiveToughness(b)));
      if (candidates.length === 0) continue;
      if (victim.kind === "human" && candidates.length > 1) {
        humanChoices.push({ seatId: victim.id, sourceCardId: trigger.sourceCardId, sourceCardName: trigger.sourceCardName, count: 1, typeFilter: filter });
        continue;
      }
      destructions.push({ seatId: victim.id, cardId: candidates[0].id, message: `${victim.name} sacrifices ${candidates[0].name} to ${trigger.sourceCardName}.` });
    }
    const sacrificed = destroyCreatures(session, destructions, "Rules action");
    return humanChoices.length > 0 ? { ...sacrificed, pendingSacrificeChoices: [...(sacrificed.pendingSacrificeChoices ?? []), ...humanChoices] } : sacrificed;
  }
  if (trigger.effect.kind === "each_player_basics") {
    const { discard, loseLife, draw } = trigger.effect;
    let next = session;
    if (discard) next = applyDiscardEffect(next, trigger.controllerSeatId, trigger.sourceCardName, discard, "each_player");
    for (const player of session.seats.filter((item) => !item.hasLost)) {
      if (loseLife) next = rulesEvent({ ...next, seats: next.seats.map((item) => (item.id === player.id ? { ...item, life: item.life - loseLife } : item)) }, player.id, `${trigger.sourceCardName}: ${player.name} loses ${loseLife} life.`);
      if (draw) next = drawMultipleForSeat(next, player.id, draw, `${trigger.sourceCardName}: ${player.name} draws ${draw} card${draw === 1 ? "" : "s"}.`);
    }
    return next;
  }
  if (trigger.effect.kind === "dragons_ping_attacker") {
    const controller = session.seats.find((seat) => seat.id === trigger.controllerSeatId);
    const attackerHolder = session.seats.find((seat) => seat.board.battlefield.some((card) => card.id === trigger.contextCardId));
    const attacker = attackerHolder?.board.battlefield.find((card) => card.id === trigger.contextCardId);
    if (!controller || !attackerHolder || !attacker) return session;
    const dragons = controller.board.battlefield.filter((card) => card.typeLine.includes("Dragon")).length;
    if (dragons <= 0) return session;
    const source = controller.board.battlefield.find((card) => card.id === trigger.sourceCardId);
    return dealDamageToCreature(session, trigger.sourceCardName, attackerHolder.id, attacker.id, dragons, source, controller.id);
  }
  if (trigger.effect.kind === "planeswalkers_become_dragons") {
    const owner = session.seats.find((seat) => seat.id === trigger.controllerSeatId);
    const walkers = owner?.board.battlefield.filter((card) => card.typeLine.includes("Planeswalker") && !card.temporaryAnimatedAsCreature) ?? [];
    if (!owner || walkers.length === 0) return session;
    const ids = new Set(walkers.map((card) => card.id));
    return rulesEvent(
      {
        ...session,
        seats: session.seats.map((seat) =>
          seat.id !== owner.id
            ? seat
            : {
                ...seat,
                board: {
                  ...seat.board,
                  battlefield: seat.board.battlefield.map((card) =>
                    ids.has(card.id)
                      ? {
                          ...card,
                          temporaryOriginalTypeLine: card.temporaryOriginalTypeLine ?? card.typeLine,
                          // ("Creature" itself comes from temporaryAnimatedAsCreature in the layer pass, as for an animated land; only the Dragon subtype is added here.)
                          typeLine: card.typeLine.includes(" — ") ? card.typeLine + " Dragon" : card.typeLine + " — Dragon",
                          temporaryAnimatedAsCreature: true,
                          temporaryBasePower: 4,
                          temporaryBaseToughness: 4,
                          temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), "flying"],
                          grantedKeywords: [...new Set([...(card.grantedKeywords ?? []), "flying"])]
                        }
                      : card
                  )
                }
              }
        )
      },
      owner.id,
      `${trigger.sourceCardName}: ${walkers.map((card) => card.name).join(", ")} become 4/4 Dragon creatures with flying until end of turn.`
    );
  }
  if (trigger.effect.kind === "rotate_control") {
    const alive = session.seats.filter((seat) => !seat.hasLost);
    if (alive.length < 2) return session;
    const step = trigger.effect.chosenOption === "1" ? -1 : 1;
    // Every seat takes the nonland permanents of the next seat in the chosen direction, all at once (decided from the board as it is now).
    const moves = alive.flatMap((taker, index) => {
      const giver = alive[(index + step + alive.length) % alive.length];
      return giver.board.battlefield
        .filter((card) => !card.typeLine.includes("Land") && card.id !== trigger.sourceCardId)
        .map((card) => ({ cardId: card.id, fromSeatId: giver.id, toSeatId: taker.id }));
    });
    const moved = moves.reduce((current, move) => changeControlWithinBattlefield(current, move.cardId, move.fromSeatId, move.toSeatId), session);
    return rulesEvent(moved, trigger.controllerSeatId, `${trigger.sourceCardName}: every player gains control of the next player's nonland permanents (${step === 1 ? "left" : "right"}).`);
  }
  if (trigger.effect.kind === "shuffle_library") {
    const targetSeatId = trigger.effect.seatId;
    if (trigger.effect.chosenOption !== "0") return session;
    return rulesEvent(
      { ...session, seats: session.seats.map((seat) => (seat.id === targetSeatId ? { ...seat, library: shuffleCards(seat.library ?? []) } : seat)) },
      trigger.controllerSeatId,
      `${trigger.sourceCardName}: ${session.seats.find((seat) => seat.id === targetSeatId)?.name ?? "the player"}'s library is shuffled.`
    );
  }
  if (trigger.effect.kind === "exile_all_graveyards") {
    const count = session.seats.reduce((total, item) => total + (item.board.graveyard ?? []).length, 0);
    return rulesEvent(
      {
        ...session,
        seats: session.seats.map((item) => ({
          ...item,
          board: { ...item.board, graveyard: [], exile: [...(item.board.exile ?? []), ...(item.board.graveyard ?? []).map((card) => ({ ...card, zone: "exile" as const }))] },
          zones: { ...item.zones, graveyard: 0, exile: (item.zones.exile ?? 0) + (item.board.graveyard ?? []).length }
        }))
      },
      trigger.controllerSeatId,
      `${trigger.sourceCardName} exiles all graveyards (${count} card${count === 1 ? "" : "s"}).`
    );
  }
  if (trigger.effect.kind === "damage_each_other_opponent") {
    const { amount } = trigger.effect;
    const victims = session.seats.filter((item) => item.id !== trigger.controllerSeatId && item.id !== trigger.actorSeatId && !item.hasLost && !playerHasHexproof({ ...item, board: { ...item.board, battlefield: [] } }));
    if (victims.length === 0) return session;
    const ids = new Set(victims.map((item) => item.id));
    return rulesEvent(
      { ...session, seats: session.seats.map((item) => (ids.has(item.id) ? { ...item, life: item.life - amount } : item)) },
      trigger.controllerSeatId,
      `${trigger.sourceCardName} deals ${amount} damage to ${victims.map((item) => item.name).join(", ")}.`
    );
  }
  if (trigger.effect.kind === "return_self_to_hand") {
    const onBattlefield = session.seats.find((item) => item.board.battlefield.some((card) => card.id === trigger.sourceCardId));
    if (onBattlefield) {
      const ownerId = onBattlefield.board.battlefield.find((card) => card.id === trigger.sourceCardId)?.ownerSeatId ?? onBattlefield.id;
      return rulesEvent(moveCardAcrossSeats(session, onBattlefield.id, trigger.sourceCardId, ownerId, "hand").session, ownerId, `${trigger.sourceCardName} returns to its owner's hand.`);
    }
    const holder = session.seats.find((item) => (item.board.graveyard ?? []).some((card) => card.id === trigger.sourceCardId));
    if (!holder) return session;
    const ownerId = (holder.board.graveyard ?? []).find((card) => card.id === trigger.sourceCardId)?.ownerSeatId ?? holder.id;
    return rulesEvent(moveCardAcrossSeats(session, holder.id, trigger.sourceCardId, ownerId, "hand").session, ownerId, `${trigger.sourceCardName} returns to its owner's hand.`);
  }
  if (trigger.effect.kind === "additional_combat") {
    // Marks the once-each-turn gate findAttackTriggers reads for "attacks for the first time each turn".
    let next: GameSession = { ...session, onceEachTurnEffectsUsed: [...(session.onceEachTurnEffectsUsed ?? []), `${session.turn}:${trigger.sourceCardId}:first_attack`] };
    const payer = session.seats.find((seat) => seat.id === trigger.controllerSeatId);
    if (!payer) return session;
    if (trigger.effect.payCostText) {
      const total = manaValueFromManaCost(trigger.effect.payCostText);
      const payment = chooseManaSourcesForCost(payer, genericManaAbilityCostShim({ costManaText: trigger.effect.payCostText }), total, undefined, session.seats);
      if (!payment.ok) return rulesEvent(session, payer.id, `${payer.name} can't pay ${trigger.effect.payCostText} for ${trigger.sourceCardName}.`);
      next = { ...next, seats: next.seats.map((seat) => (seat.id === payer.id ? spendManaSources(seat, payment.sourceIds) : seat)) };
    }
    next = {
      ...next,
      extraCombatsPending: (next.extraCombatsPending ?? 0) + 1,
      seats: next.seats.map((seat) =>
        seat.id !== payer.id ? seat : { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.attacking ? { ...card, tapped: false } : card)) } }
      )
    };
    return rulesEvent(next, payer.id, `${trigger.sourceCardName}: attacking creatures untap, and there will be an additional combat phase after this one.`);
  }
  if (trigger.effect.kind === "double_power_toughness") {
    return rulesEvent(
      {
        ...session,
        seats: session.seats.map((item) =>
          item.id !== trigger.controllerSeatId
            ? item
            : {
                ...item,
                board: {
                  ...item.board,
                  battlefield: item.board.battlefield.map((card) =>
                    card.typeLine.includes("Creature")
                      ? { ...card, temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + Math.max(0, effectivePower(card)), temporaryToughnessBonus: (card.temporaryToughnessBonus ?? 0) + Math.max(0, effectiveToughness(card)) }
                      : card
                  )
                }
              }
        )
      },
      trigger.controllerSeatId,
      `${trigger.sourceCardName}: the power and toughness of each creature ${seatName} controls is doubled until end of turn.`
    );
  }
  if (trigger.effect.kind === "target_creature_gains_keyword") {
    const keywords = trigger.effect.keywords;
    const mine = session.seats.find((item) => item.id === trigger.controllerSeatId);
    // Best beneficiary: the strongest creature that doesn't already have the keyword (a hasty attacker, in practice).
    const target =
      (trigger.effect.chosenOption ? mine?.board.battlefield.find((card) => card.id === trigger.effect.chosenOption) : undefined) ??
      (mine?.board.battlefield ?? [])
        .filter((card) => card.typeLine.includes("Creature") && !keywords.every((keyword) => hasKeyword(card, keyword)))
        .sort((a, b) => Number(Boolean(b.summoningSick)) - Number(Boolean(a.summoningSick)) || effectivePower(b) - effectivePower(a))[0];
    if (!mine || !target) return session;
    return rulesEvent(
      {
        ...session,
        seats: session.seats.map((item) =>
          item.id !== mine.id
            ? item
            : {
                ...item,
                board: {
                  ...item.board,
                  battlefield: item.board.battlefield.map((card) =>
                    card.id === target.id
                      ? { ...card, summoningSick: keywords.includes("haste") ? false : card.summoningSick, temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), ...keywords], grantedKeywords: [...new Set([...(card.grantedKeywords ?? []), ...keywords])] }
                      : card
                  )
                }
              }
        )
      },
      mine.id,
      `${trigger.sourceCardName}: ${target.name} gains ${keywords.join(" and ")} until end of turn.`
    );
  }
  if (trigger.effect.kind === "discard_then_draw") {
    const mine = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const deferred = deferHumanDiscard(session, trigger.controllerSeatId, 1, trigger.sourceCardName, trigger.effect.draw);
    if (deferred) return deferred;
    const discard = mine ? chooseWorstHandCardToDiscard(mine) : undefined;
    if (!mine || !discard) return rulesEvent(session, trigger.controllerSeatId, `${trigger.sourceCardName}: no card to discard, so nothing is drawn.`);
    let next = moveCardBetweenVisibleZones(session, mine.id, discard.id, "graveyard");
    next = rulesEvent(next, mine.id, `${mine.name} discards ${discard.name} (${trigger.sourceCardName}).`);
    return drawMultipleForSeat(next, mine.id, trigger.effect.draw, `${mine.name} draws ${trigger.effect.draw} card${trigger.effect.draw === 1 ? "" : "s"} from ${trigger.sourceCardName}.`);
  }
  if (trigger.effect.kind === "living_weapon") {
    const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const equipment = owner?.board.battlefield.find((card) => card.id === trigger.sourceCardId);
    if (!owner || !equipment) return session;
    const germ = createTokenCard(owner.id, equipment.id, { count: 1, name: "Phyrexian Germ Token", colors: ["B"], typeLine: "Token Creature - Phyrexian Germ", power: "0", toughness: "0", oracleText: "", role: "creature" });
    // The Germ is 0/0 until the equipment's own bonus applies; seed that bonus now so the next state-based check doesn't bury it.
    const flat = attachedPowerToughnessBonus(equipment.oracleText) ?? { power: 0, toughness: 0 };
    const commanderX = /\bequipped creature gets \+x\/\+x, where x is the greatest mana value among your commanders\b/i.test(equipment.oracleText)
      ? Math.max(0, ...[...owner.board.battlefield.filter((permanent) => permanent.commander), ...(owner.board.commander ? [owner.board.commander] : [])].map((commander) => commander.manaValue))
      : 0;
    const seeded: VisibleCard = { ...germ, attachmentPowerBonus: flat.power + commanderX || undefined, attachmentToughnessBonus: flat.toughness + commanderX || undefined };
    const attached = {
      ...session,
      seats: session.seats.map((item) =>
        item.id !== owner.id
          ? item
          : {
              ...item,
              board: {
                ...item.board,
                battlefield: [...item.board.battlefield.map((card) => (card.id === equipment.id ? { ...card, attachedToId: seeded.id, attachTimestamp: Date.now() } : card)), seeded]
              },
              zones: { ...item.zones, battlefield: item.zones.battlefield + 1 }
            }
        )
    };
    return rulesEvent(checkStateBasedActions(attached), owner.id, `${equipment.name}: a Phyrexian Germ token is created and equipped.`);
  }
  if (trigger.effect.kind === "counters_on_up_to_creatures") {
    const { counterKind, amount, count } = trigger.effect;
    const mine = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const pickedIds = trigger.effect.chosenOption?.split(",") ?? [];
    const chosen = pickedIds.length > 0
      ? (mine?.board.battlefield ?? []).filter((card) => pickedIds.includes(card.id))
      : (mine?.board.battlefield ?? [])
          .filter((card) => card.typeLine.includes("Creature"))
          .sort((a, b) => effectivePower(b) - effectivePower(a))
          .slice(0, count);
    if (!mine || chosen.length === 0) return session;
    const ids = new Set(chosen.map((card) => card.id));
    return rulesEvent(
      {
        ...session,
        seats: session.seats.map((item) =>
          item.id !== mine.id ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (ids.has(card.id) ? applyCounterDelta(card, counterKind, amount) : card)) } }
        )
      },
      mine.id,
      `${trigger.sourceCardName}: ${chosen.map((card) => card.name).join(" and ")} get${chosen.length === 1 ? "s" : ""} a ${counterKind} counter.`
    );
  }
  if (trigger.effect.kind === "gain_life_context_toughness") {
    const entering = session.seats.flatMap((item) => item.board.battlefield).find((card) => card.id === trigger.contextCardId);
    const amount = entering ? Math.max(0, effectiveToughness(entering)) : 0;
    if (amount === 0) return session;
    return rulesEvent({ ...session, seats: session.seats.map((item) => (item.id === trigger.controllerSeatId ? { ...item, life: item.life + amount } : item)) }, trigger.controllerSeatId, `${trigger.sourceCardName}: ${seatName} gains ${amount} life (${entering?.name}'s toughness).`);
  }
  if (trigger.effect.kind === "creatures_gain_keywords") {
    const keywords = trigger.effect.keywords;
    return rulesEvent(
      {
        ...session,
        seats: session.seats.map((item) =>
          item.id !== trigger.controllerSeatId
            ? item
            : {
                ...item,
                board: {
                  ...item.board,
                  battlefield: item.board.battlefield.map((card) =>
                    card.typeLine.includes("Creature") ? { ...card, temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), ...keywords], grantedKeywords: [...new Set([...(card.grantedKeywords ?? []), ...keywords])] } : card
                  )
                }
              }
        )
      },
      trigger.controllerSeatId,
      `${trigger.sourceCardName}: creatures ${seatName} controls gain ${keywords.join(" and ")} until end of turn.`
    );
  }
  if (trigger.effect.kind === "investigate_per_opponent_with_more_cards") {
    const mine = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const count = mine ? session.seats.filter((item) => item.id !== mine.id && !item.hasLost && item.board.hand.length > mine.board.hand.length).length : 0;
    if (count === 0) return session;
    return createTokensForSeat(session, trigger.controllerSeatId, trigger.sourceCardId, [{ ...predefinedTokenSpec("Clue"), count }]).session;
  }
  if (trigger.effect.kind === "double_power_counters") {
    const mine = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const target = (trigger.effect.chosenOption ? mine?.board.battlefield.find((card) => card.id === trigger.effect.chosenOption) : undefined) ?? strongestControlledCreature(mine);
    const amount = target ? Math.max(0, effectivePower(target)) : 0;
    if (!mine || !target || amount === 0) return session;
    return rulesEvent(
      {
        ...session,
        seats: session.seats.map((item) =>
          item.id !== mine.id
            ? item
            : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === target.id ? { ...card, counters: [...(card.counters ?? []).filter((counter) => counter.kind !== "+1/+1"), { kind: "+1/+1", count: ((card.counters ?? []).find((counter) => counter.kind === "+1/+1")?.count ?? 0) + amount }] } : card)) } }
        )
      },
      mine.id,
      `${trigger.sourceCardName}: ${target.name} gets ${amount} +1/+1 counters.`
    );
  }
  if (trigger.effect.kind === "modal") {
    const modalSource = session.seats.flatMap((seat) => seat.board.battlefield).find((card) => card.id === trigger.sourceCardId);
    // A "when this dies" modal source has already left the battlefield; only its name is needed then.
    const source = modalSource ?? ({ id: trigger.sourceCardId, name: trigger.sourceCardName, typeLine: "", oracleText: "", colors: [], manaValue: 0, role: "permanent", zone: "graveyard" } as VisibleCard);
    return applyGenericModalEffect(session, trigger.controllerSeatId, source, trigger.effect.modal, trigger.actorSeatId, trigger.effect.chosenOption !== undefined ? trigger.effect.chosenOption.split(",").map((part) => Number.parseInt(part, 10)).filter((n) => Number.isFinite(n)) : undefined);
  }
  if (trigger.effect.kind === "scry_cards" || trigger.effect.kind === "surveil_cards") {
    return resolveAgentLibraryLookWorkflow(session, trigger.controllerSeatId, trigger.sourceCardName, trigger.effect.kind, trigger.effect.amount);
  }
  if (trigger.effect.kind === "draw_then_put_back") {
    return applyDrawXThenPutBack(session, trigger.controllerSeatId, trigger.sourceCardName, trigger.effect.drawAmount, trigger.effect.putBackAmount);
  }
  if (trigger.effect.kind === "gain_life" || trigger.effect.kind === "lose_life") {
    const delta = trigger.effect.kind === "gain_life" ? trigger.effect.amount : -trigger.effect.amount;
    return {
      ...session,
      seats: session.seats.map((seat) => (seat.id === trigger.controllerSeatId ? { ...seat, life: Math.max(0, seat.life + delta) } : seat)),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: trigger.controllerSeatId,
          message: `${trigger.sourceCardName} trigger resolves. ${seatName} ${delta > 0 ? "gains" : "loses"} ${Math.abs(delta)} life.`
        },
        ...session.events
      ]
    };
  }
  if (trigger.effect.kind === "drain") {
    const devotionColor = trigger.effect.devotionColor;
    const controllerSeat = devotionColor ? session.seats.find((seat) => seat.id === trigger.controllerSeatId) : undefined;
    // Recomputed here, not read off trigger.effect.amount (parsed as a 0 placeholder) — devotion is
    // board-state-dependent and can genuinely change between this trigger being queued and actually
    // resolving (responses on the stack in between), so parse-time would be a stale/wrong number.
    const amount = devotionColor && controllerSeat ? computeDevotion(controllerSeat.board.battlefield, devotionColor) : trigger.effect.amount;
    return applyDrainEffect(session, trigger.controllerSeatId, trigger.sourceCardName, amount, trigger.effect.scope, "trigger resolves", Boolean(devotionColor), Boolean(trigger.effect.noGain));
  }
  if (trigger.effect.kind === "connive") {
    let next = session;
    for (let i = 0; i < trigger.effect.amount; i += 1) {
      const seat = next.seats.find((item) => item.id === trigger.controllerSeatId);
      if (!seat) break;
      next = drawForSeat(next, trigger.controllerSeatId, `${trigger.sourceCardName} connives: ${seatName} draws a card.`);
      const drawnSeat = next.seats.find((item) => item.id === trigger.controllerSeatId);
      const discard = drawnSeat ? chooseWorstHandCardToDiscard(drawnSeat) : undefined;
      if (!discard) continue;
      const isNonland = !discard.typeLine.includes("Land");
      next = moveCardBetweenVisibleZones(next, trigger.controllerSeatId, discard.id, "graveyard");
      next = {
        ...next,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: trigger.controllerSeatId,
            message: `${trigger.sourceCardName} connives: ${seatName} discards ${discard.name}${isNonland ? `, putting a +1/+1 counter on ${trigger.sourceCardName}` : ""}.`
          },
          ...next.events
        ]
      };
      if (isNonland) {
        next = {
          ...next,
          seats: next.seats.map((item) =>
            item.id === trigger.controllerSeatId
              ? {
                  ...item,
                  board: {
                    ...item.board,
                    battlefield: item.board.battlefield.map((card) => (card.id === trigger.sourceCardId ? applyCounterDelta(card, "+1/+1", 1) : card))
                  }
                }
              : item
          )
        };
      }
    }
    return next;
  }
  if (trigger.effect.kind === "get_experience_counter") {
    const experienceAmount = trigger.effect.amount;
    return {
      ...session,
      seats: session.seats.map((seat) =>
        seat.id === trigger.controllerSeatId ? { ...seat, experienceCounters: (seat.experienceCounters ?? 0) + experienceAmount } : seat
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: trigger.controllerSeatId,
          message: `${trigger.sourceCardName} trigger resolves. ${seatName} gets an experience counter.`
        },
        ...session.events
      ]
    };
  }
  if (trigger.effect.kind === "draw_then_permanent") {
    const drawn = drawMultipleForSeat(session, trigger.controllerSeatId, trigger.effect.amount, `${trigger.sourceCardName}: draws ${trigger.effect.amount} card${trigger.effect.amount === 1 ? "" : "s"}.`);
    return resolveTriggerEffect(drawn, { ...trigger, effect: { kind: "put_permanent_from_hand" } });
  }
  if (trigger.effect.kind === "put_permanent_from_hand") {
    const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const permanents = (owner?.board.hand ?? []).filter((card) => !/Instant|Sorcery/.test(card.typeLine));
    const chosenIndex = trigger.effect.chosenOption !== undefined ? Number.parseInt(trigger.effect.chosenOption, 10) : undefined;
    // The human's "Don't put one" answer is an index past the last permanent card.
    if (!owner || permanents.length === 0 || (chosenIndex !== undefined && chosenIndex >= permanents.length)) {
      return rulesEvent(session, trigger.controllerSeatId, `${trigger.sourceCardName}: no permanent card is put onto the battlefield.`);
    }
    const pick = (chosenIndex !== undefined ? permanents[chosenIndex] : undefined) ?? [...permanents].sort((a, b) => b.manaValue - a.manaValue)[0];
    const moved = moveCardAcrossSeats(session, owner.id, pick.id, owner.id, "battlefield");
    return rulesEvent(moved.session, owner.id, `${trigger.sourceCardName}: ${owner.name} puts ${pick.name} onto the battlefield.`);
  }
  if (trigger.effect.kind === "draw_then_land") {
    const { amount, ownerToo } = trigger.effect;
    const owner = ownerToo ? findPermanentById(session, trigger.sourceCardId)?.ownerSeatId : undefined;
    let next = session;
    for (const seatId of [trigger.controllerSeatId, ...(owner && owner !== trigger.controllerSeatId ? [owner] : [])]) {
      next = drawMultipleForSeat(next, seatId, amount, `${next.seats.find((item) => item.id === seatId)?.name ?? "Player"} draws ${amount} from ${trigger.sourceCardName}.`);
      next = resolveTriggerEffect(next, { ...trigger, controllerSeatId: seatId, effect: { kind: "put_land_from_hand" } });
    }
    return next;
  }
  if (trigger.effect.kind === "put_land_from_hand") {
    const controllerSeat = session.seats.find((seat) => seat.id === trigger.controllerSeatId);
    const landsInHand = controllerSeat?.board.hand.filter((card) => card.typeLine.includes("Land")) ?? [];
    // Prefer a nonbasic (a utility land is generically the more valuable thing to ramp into) —
    // falls back to a basic if that's all there is.
    const chosenIndex = trigger.effect.chosenOption !== undefined ? Number.parseInt(trigger.effect.chosenOption, 10) : undefined;
    // The human's "Don't put a land" answer is an index past the last land.
    if (chosenIndex !== undefined && chosenIndex >= landsInHand.length) return rulesEvent(session, trigger.controllerSeatId, `${trigger.sourceCardName}: no land is put onto the battlefield.`);
    const chosenLand = (chosenIndex !== undefined ? landsInHand[chosenIndex] : undefined) ?? landsInHand.find((card) => !isBasicLandCard(card)) ?? landsInHand[0];
    if (!controllerSeat || !chosenLand) {
      return {
        ...session,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: trigger.controllerSeatId,
            message: `${trigger.sourceCardName} trigger resolves. ${seatName} has no land card in hand to put onto the battlefield.`,
            detail: "Rules action"
          },
          ...session.events
        ]
      };
    }
    // No "tapped" in the real oracle text (see isArchaeomancersMapLandRaidTrigger) — the land
    // enters exactly like a normal land drop would, subject to its own printed ETB-tapped clause.
    const { session: movedSession } = moveCardAcrossSeats(session, trigger.controllerSeatId, chosenLand.id, trigger.controllerSeatId, "battlefield", {
      tapped: entersBattlefieldTapped(chosenLand, controllerSeat, session.seats)
    });
    return {
      ...movedSession,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: trigger.controllerSeatId,
          message: `${trigger.sourceCardName} trigger resolves. ${seatName} puts ${chosenLand.name} onto the battlefield.`,
          detail: "Rules action"
        },
        ...movedSession.events
      ]
    };
  }
  if (trigger.effect.kind === "create_tokens") {
    const created = createTokensForSeat(session, trigger.controllerSeatId, trigger.sourceCardId, trigger.effect.tokens);
    const createdNames = created.createdTokens.map((token) => token.name);
    const payoff = trigger.effect.ifTreasures;
    if (payoff) {
      const treasures = created.session.seats.find((item) => item.id === trigger.controllerSeatId)?.board.battlefield.filter((card) => card.typeLine.includes("Treasure")).length ?? 0;
      const base = rulesEvent(created.session, trigger.controllerSeatId, `${trigger.sourceCardName} trigger resolves. ${seatName} creates ${createdNames.join(", ")} and controls ${treasures} Treasure${treasures === 1 ? "" : "s"}.`);
      if (treasures < payoff.threshold) return base;
      const sacrificed = payoff.sacrificeSelf ? moveCardBetweenVisibleZones(base, trigger.controllerSeatId, trigger.sourceCardId, "graveyard") : base;
      const payoffCreated = createTokensForSeat(sacrificed, trigger.controllerSeatId, trigger.sourceCardId, payoff.tokens);
      return rulesEvent(payoffCreated.session, trigger.controllerSeatId, `${trigger.sourceCardName}: ${payoff.sacrificeSelf ? "sacrificed, " : ""}creates ${payoffCreated.createdTokens.map((token) => token.name).join(", ")}.`);
    }
    return {
      ...created.session,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: trigger.controllerSeatId,
          message: `${trigger.sourceCardName} trigger resolves. ${seatName} creates ${createdNames.join(", ")}.`
        },
        ...created.session.events
      ]
    };
  }
  if (trigger.effect.kind === "add_counter") {
    const { counterKind, amount, scope, alsoTap, matcher } = trigger.effect;
    // "each_matching_you_control": "... put a +1/+1 counter on each Plant you control." (Insidious
    // Roots) — board-wide, not a single chosen/looked-up target like every other scope below, so it
    // gets its own branch entirely: every permanent on the controller's own battlefield matching
    // `matcher` (via the same permanentMatchesQualifier every static group-grant already uses) gets
    // the counter, including ones from earlier triggers this same turn.
    if (scope === "each_matching_you_control") {
      const controllerSeat = session.seats.find((seat) => seat.id === trigger.controllerSeatId);
      const matchingCards = controllerSeat?.board.battlefield.filter((card) => permanentMatchesQualifier(card, matcher ?? "")) ?? [];
      if (!controllerSeat || matchingCards.length === 0) {
        return {
          ...session,
          events: [
            {
              id: crypto.randomUUID(),
              at: new Date().toISOString(),
              seatId: trigger.controllerSeatId,
              message: `${trigger.sourceCardName} trigger finds no matching permanent and has no effect.`
            },
            ...session.events
          ]
        };
      }
      return {
        ...session,
        seats: session.seats.map((seat) =>
          seat.id === trigger.controllerSeatId
            ? {
                ...seat,
                board: {
                  ...seat.board,
                  battlefield: seat.board.battlefield.map((card) =>
                    permanentMatchesQualifier(card, matcher ?? "") ? applyCounterDelta(card, counterKind, amount) : card
                  )
                }
              }
            : seat
        ),
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: trigger.controllerSeatId,
            message: `${trigger.sourceCardName} trigger resolves. Each ${matcher ?? "matching permanent"} ${controllerSeat.name} controls gets ${amount === 1 ? "a" : amount} ${counterKind} counter${amount === 1 ? "" : "s"}.`
          },
          ...session.events
        ]
      };
    }
    // "self" looks up the trigger source itself; "context" looks up the permanent "it"/"that
    // creature" referred to (the entering permanent — not always the source, e.g. Cathars'
    // Crusade watches OTHER creatures enter). Neither is a chosen target, so both search the
    // battlefield for that exact card rather than going through chooseCounterTarget's heuristic.
    let target: { seatId: string; card: VisibleCard } | undefined;
    if (scope === "self" || scope === "context") {
      const lookupId = scope === "self" ? trigger.sourceCardId : trigger.contextCardId;
      for (const seat of session.seats) {
        const card = lookupId ? seat.board.battlefield.find((item) => item.id === lookupId) : undefined;
        if (card) {
          target = { seatId: seat.id, card };
          break;
        }
      }
    } else {
      const pickedTarget = trigger.effect.chosenOption ? session.seats.flatMap((seat) => seat.board.battlefield.filter((card) => card.id === trigger.effect.chosenOption).map((card) => ({ seatId: seat.id, card })))[0] : undefined;
      target = pickedTarget ?? chooseCounterTarget(session, trigger.controllerSeatId, counterKind, scope === "target_creature_you_control");
    }
    if (!target) {
      return {
        ...session,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: trigger.controllerSeatId,
            message: `${trigger.sourceCardName} trigger finds no legal target and has no effect.`
          },
          ...session.events
        ]
      };
    }
    return {
      ...session,
      seats: session.seats.map((seat) =>
        seat.id === target.seatId
          ? {
              ...seat,
              board: {
                ...seat.board,
                battlefield: seat.board.battlefield.map((card) =>
                  card.id === target.card.id ? { ...applyCounterDelta(card, counterKind, amount), tapped: alsoTap ? true : card.tapped } : card
                )
              }
            }
          : seat
      ),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: trigger.controllerSeatId,
          message: `${trigger.sourceCardName} trigger resolves. ${target.card.name}${alsoTap ? " is tapped and" : ""} gets ${amount === 1 ? "a" : amount} ${counterKind} counter${amount === 1 ? "" : "s"}.`
        },
        ...session.events
      ]
    };
  }
  if (trigger.effect.kind === "tap_subtype_pump_damage") {
    const subtype = trigger.effect.subtype;
    const holder = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const attacker = holder?.board.battlefield.find((card) => card.id === trigger.sourceCardId);
    if (!holder || !attacker) return session;
    const helpers = holder.board.battlefield.filter((card) => card.id !== attacker.id && !card.tapped && card.typeLine.includes(subtype));
    const x = helpers.length;
    if (x === 0) return rulesEvent(session, holder.id, `${trigger.sourceCardName}: no untapped ${subtype} to tap.`);
    const helperIds = new Set(helpers.map((card) => card.id));
    let next: GameSession = {
      ...session,
      seats: session.seats.map((seat) =>
        seat.id !== holder.id
          ? seat
          : {
              ...seat,
              board: {
                ...seat.board,
                battlefield: seat.board.battlefield.map((card) =>
                  helperIds.has(card.id) ? { ...card, tapped: true } : card.id === attacker.id ? { ...card, temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + x } : card
                )
              }
            }
      )
    };
    // The defender: the player (or the controller of the planeswalker) this creature is attacking.
    const targetId = attacker.attackTargetId;
    const defenderSeat = next.seats.find((seat) => seat.id === targetId);
    const planeswalker = defenderSeat ? undefined : next.seats.flatMap((seat) => seat.board.battlefield.map((card) => ({ seat, card }))).find((entry) => entry.card.id === targetId);
    const live = next.seats.find((seat) => seat.id === holder.id)?.board.battlefield.find((card) => card.id === attacker.id) ?? attacker;
    if (defenderSeat) next = applyCombatDamageToTarget(next, trigger.sourceCardName, { seat: defenderSeat }, x, live, holder.id, "noncombat");
    else if (planeswalker) next = applyCombatDamageToTarget(next, trigger.sourceCardName, { seat: planeswalker.seat, planeswalker: planeswalker.card }, x, live, holder.id, "noncombat");
    return rulesEvent(next, holder.id, `${trigger.sourceCardName}: taps ${x} ${subtype}, gets +${x}/+0 and deals ${x} damage to what it is attacking.`);
  }
  if (trigger.effect.kind === "deferred_choice") {
    const pick = trigger.effect.chosenOption !== undefined ? Number.parseInt(trigger.effect.chosenOption, 10) : Number.NaN;
    return resolveDeferredChoice(session, trigger.controllerSeatId, trigger.sourceCardId, trigger.sourceCardName, trigger.effect.resolver, trigger.effect.data, Number.isFinite(pick) ? trigger.effect.values[pick] : undefined);
  }
  if (trigger.effect.kind === "destroy_tapped_creature") {
    const holder = session.seats.find((item) => item.id === trigger.controllerSeatId);
    if (!holder) return session;
    // Named when the ability went on the stack (chosenOption = the picked card id): no second question at resolution.
    if (trigger.effect.chosenOption) {
      const picked = session.seats.find((seat) => seat.board.battlefield.some((card) => card.id === trigger.effect.chosenOption));
      return picked ? resolveDeferredChoice(session, holder.id, trigger.sourceCardId, trigger.sourceCardName, "destroy_pick", {}, `${picked.id}:${trigger.effect.chosenOption}`) : rulesEvent(session, holder.id, `${trigger.sourceCardName}: its target is gone.`);
    }
    const worth = (card: VisibleCard) => card.manaValue * 2 + Math.max(0, effectivePower(card)) + (card.commander ? 5 : 0);
    const pool = session.seats.flatMap((seat) => seat.board.battlefield.filter((card) => card.tapped && card.typeLine.includes("Creature") && !hasShroud(card) && !(hasHexproof(card) && seat.id !== holder.id) && !card.phasedOut).map((card) => ({ seatId: seat.id, card })));
    if (pool.length === 0) return rulesEvent(session, holder.id, `${trigger.sourceCardName}: no tapped creature to destroy.`);
    if (holder.kind === "human") {
      return queuePlayerChoice(session, { seatId: holder.id, sourceCardId: trigger.sourceCardId, sourceCardName: trigger.sourceCardName, prompt: `${trigger.sourceCardName}: destroy a tapped creature?`, options: [...pool.map(({ seatId, card }) => ({ label: `${card.name} (${session.seats.find((item) => item.id === seatId)?.name})`, value: `${seatId}:${card.id}` })), { label: "Don't destroy", value: "" }], resolver: "destroy_pick", data: {} });
    }
    const best = [...pool].filter((entry) => entry.seatId !== holder.id).sort((a, b) => worth(b.card) - worth(a.card))[0];
    return best ? destroyCreatures(session, [{ seatId: best.seatId, cardId: best.card.id, message: `${best.card.name} is destroyed by ${trigger.sourceCardName}.` }], "Rules action") : rulesEvent(session, holder.id, `${trigger.sourceCardName}: no opposing tapped creature.`);
  }
  if (trigger.effect.kind === "pump_other_attackers") {
    const { power, toughness } = trigger.effect;
    const holder = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const enchanted = trigger.contextCardId;
    if (!holder) return session;
    const next: GameSession = {
      ...session,
      seats: session.seats.map((seat) =>
        seat.id !== (session.seats.find((item) => item.board.battlefield.some((card) => card.id === enchanted))?.id ?? "")
          ? seat
          : { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.attacking && card.id !== enchanted ? { ...card, temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + power, temporaryToughnessBonus: (card.temporaryToughnessBonus ?? 0) + toughness } : card)) } }
      )
    };
    return rulesEvent(next, holder.id, `${trigger.sourceCardName}: every other attacking creature gets +${power}/+${toughness} until end of turn.`);
  }
  if (trigger.effect.kind === "artifact_becomes_copy_eot") {
    const holder = session.seats.find((item) => item.id === trigger.controllerSeatId);
    if (!holder) return session;
    const artifacts = holder.board.battlefield.filter((card) => hasCardType(card, "Artifact") && card.id !== trigger.sourceCardId);
    const copyable = holder.board.battlefield.filter((card) => (hasCardType(card, "Artifact") || card.typeLine.includes("Creature")) && card.id !== trigger.sourceCardId);
    if (artifacts.length === 0 || copyable.length < 2) return rulesEvent(session, holder.id, `${trigger.sourceCardName}: needs an artifact and another artifact or creature to copy.`);
    if (holder.kind === "human") {
      return queuePlayerChoice(session, { seatId: holder.id, sourceCardId: trigger.sourceCardId, sourceCardName: trigger.sourceCardName, prompt: `${trigger.sourceCardName}: which artifact becomes the copy?`, options: artifacts.map((card) => ({ label: card.name, value: card.id })), resolver: "saheeli_copy_artifact", data: {} });
    }
    const worth = (card: VisibleCard) => card.manaValue * 2 + Math.max(0, effectivePower(card)) + Math.max(0, effectiveToughness(card));
    const source = [...copyable].sort((a, b) => worth(b) - worth(a))[0];
    const target = [...artifacts].filter((card) => card.id !== source.id).sort((a, b) => worth(a) - worth(b))[0];
    return target ? becomeTemporaryCopy(session, holder.id, target.id, source.id, trigger.sourceCardName) : session;
  }
  if (trigger.effect.kind === "become_artifact_target") {
    const holder = session.seats.find((item) => item.id === trigger.controllerSeatId);
    if (!holder) return session;
    if (trigger.effect.chosenOption) return resolveDeferredChoice(session, holder.id, trigger.sourceCardId, trigger.sourceCardName, "become_artifact", {}, trigger.effect.chosenOption);
    const pool = session.seats.flatMap((seat) => seat.board.battlefield.filter((card) => !hasCardType(card, "Artifact") && !hasShroud(card) && !(hasHexproof(card) && seat.id !== holder.id) && !card.phasedOut).map((card) => ({ seat, card })));
    if (pool.length === 0) return rulesEvent(session, holder.id, `${trigger.sourceCardName}: no nonartifact permanent to target.`);
    if (holder.kind === "human") {
      return queuePlayerChoice(session, { seatId: holder.id, sourceCardId: trigger.sourceCardId, sourceCardName: trigger.sourceCardName, prompt: `${trigger.sourceCardName}: choose a permanent to become an artifact.`, options: pool.map(({ seat, card }) => ({ label: `${card.name} (${seat.id === holder.id ? "yours" : seat.name})`, value: card.id })), resolver: "become_artifact", data: {} });
    }
    // Agents turn one of their own nonartifact permanents into an artifact (artifact count, affinity, improvise): a creature first, else a land.
    const mine = pool.filter((entry) => entry.seat.id === holder.id).sort((a, b) => Number(b.card.typeLine.includes("Creature")) - Number(a.card.typeLine.includes("Creature")) || b.card.manaValue - a.card.manaValue);
    return mine[0] ? resolveDeferredChoice(session, holder.id, trigger.sourceCardId, trigger.sourceCardName, "become_artifact", {}, mine[0].card.id) : session;
  }
  if (trigger.effect.kind === "gain_control_target_artifact") {
    const holder = session.seats.find((item) => item.id === trigger.controllerSeatId);
    if (!holder) return session;
    if (trigger.effect.chosenOption) {
      const from = session.seats.find((seat) => seat.board.battlefield.some((card) => card.id === trigger.effect.chosenOption));
      return from ? resolveDeferredChoice(session, holder.id, trigger.sourceCardId, trigger.sourceCardName, "gain_control_artifact", {}, `${from.id}:${trigger.effect.chosenOption}`) : rulesEvent(session, holder.id, `${trigger.sourceCardName}: its target is gone.`);
    }
    const pool = session.seats.filter((seat) => seat.id !== holder.id).flatMap((seat) => seat.board.battlefield.filter((card) => hasCardType(card, "Artifact") && !hasShroud(card) && !hasHexproof(card) && !card.phasedOut).map((card) => ({ seat, card })));
    if (pool.length === 0) return rulesEvent(session, holder.id, `${trigger.sourceCardName}: no opposing artifact to take.`);
    if (holder.kind === "human") {
      return queuePlayerChoice(session, { seatId: holder.id, sourceCardId: trigger.sourceCardId, sourceCardName: trigger.sourceCardName, prompt: `${trigger.sourceCardName}: choose an artifact to gain control of.`, options: pool.map(({ seat, card }) => ({ label: `${card.name} (${seat.name})`, value: `${seat.id}:${card.id}` })), resolver: "gain_control_artifact", data: {} });
    }
    const best = [...pool].sort((a, b) => b.card.manaValue + Math.max(0, effectivePower(b.card)) - (a.card.manaValue + Math.max(0, effectivePower(a.card))))[0];
    return resolveDeferredChoice(session, holder.id, trigger.sourceCardId, trigger.sourceCardName, "gain_control_artifact", {}, `${best.seat.id}:${best.card.id}`);
  }
  if (trigger.effect.kind === "self_pump_per_permanent") {
    const holder = session.seats.find((item) => item.id === trigger.controllerSeatId);
    if (!holder) return session;
    const x = holder.board.battlefield.filter((card) => permanentMatchesQualifier({ ...card, typeLine: card.typeLine + (card.grantedTypes?.length ? " " + card.grantedTypes.join(" ") : "") }, trigger.effect.kind === "self_pump_per_permanent" ? trigger.effect.matcher : "")).length;
    return rulesEvent(
      { ...session, seats: session.seats.map((seat) => (seat.id !== holder.id ? seat : { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === trigger.sourceCardId ? { ...card, temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + x } : card)) } })) },
      holder.id,
      `${trigger.sourceCardName} gets +${x}/+0 until end of turn.`
    );
  }
  if (trigger.effect.kind === "manifest_dread_attach") {
    const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const equipment = owner?.board.battlefield.find((card) => card.id === trigger.sourceCardId);
    const top = (owner?.library ?? []).slice(0, 2);
    if (!owner || top.length === 0) return rulesEvent(session, trigger.controllerSeatId, `${trigger.sourceCardName}: no card to manifest.`);
    // Manifest the cheaper card (the face-down 2/2 is only worth its body); the other goes to the graveyard.
    const [toManifest, toYard] = [...top].sort((a, b) => a.manaValue - b.manaValue);
    const manifest: VisibleCard = { ...toManifest, name: "Manifested Creature", typeLine: "Creature", oracleText: "", manaCost: undefined, manaValue: 0, power: "2", toughness: "2", colors: [], zone: "battlefield", summoningSick: true, tapped: false, faceDownCardName: toManifest.name } as VisibleCard;
    let next: GameSession = {
      ...session,
      seats: session.seats.map((item) => {
        if (item.id !== owner.id) return item;
        const library = (item.library ?? []).filter((card) => card.id !== toManifest.id && card.id !== toYard?.id);
        return {
          ...item,
          library,
          board: {
            ...item.board,
            battlefield: [...item.board.battlefield.map((card) => (equipment && card.id === equipment.id ? { ...card, attachedToId: manifest.id } : card)), manifest],
            graveyard: toYard ? [...(item.board.graveyard ?? []), { ...toYard, zone: "graveyard" as const }] : item.board.graveyard
          },
          zones: { ...item.zones, library: library.length, battlefield: item.zones.battlefield + 1, graveyard: item.zones.graveyard + (toYard ? 1 : 0) }
        };
      }),
      pendingEntries: [...(session.pendingEntries ?? []), { seatId: owner.id, card: manifest }]
    };
    next = rulesEvent(next, owner.id, `${owner.name} manifests dread: a face-down 2/2 enters and ${trigger.sourceCardName} attaches to it${toYard ? `; ${toYard.name} goes to the graveyard` : ""}.`);
    return next;
  }
  if (trigger.effect.kind === "exile_card_from_graveyard" && trigger.effect.chosenOption) {
    const owner = session.seats.find((seat) => (seat.board.graveyard ?? []).some((card) => card.id === trigger.effect.chosenOption));
    const chosen = owner?.board.graveyard?.find((card) => card.id === trigger.effect.chosenOption);
    return owner && chosen ? rulesEvent(moveCardAcrossSeats(session, owner.id, chosen.id, chosen.ownerSeatId ?? owner.id, "exile").session, trigger.controllerSeatId, `${trigger.sourceCardName} exiles ${chosen.name} from a graveyard.`) : rulesEvent(session, trigger.controllerSeatId, `${trigger.sourceCardName}: its target is gone.`);
  }
  if (trigger.effect.kind === "exile_card_from_graveyard") {
    const worth = (card: VisibleCard) => card.manaValue + (card.typeLine.includes("Creature") ? 2 : 0);
    const pool = session.seats.flatMap((seat) => (seat.board.graveyard ?? []).map((card) => ({ seatId: seat.id, card })));
    const pick = [...pool].sort((a, b) => Number(b.seatId !== trigger.controllerSeatId) - Number(a.seatId !== trigger.controllerSeatId) || worth(b.card) - worth(a.card))[0];
    if (!pick) return rulesEvent(session, trigger.controllerSeatId, `${trigger.sourceCardName}: no card in any graveyard to exile.`);
    return rulesEvent(moveCardAcrossSeats(session, pick.seatId, pick.card.id, pick.card.ownerSeatId ?? pick.seatId, "exile").session, trigger.controllerSeatId, `${trigger.sourceCardName} exiles ${pick.card.name} from a graveyard.`);
  }
  if (trigger.effect.kind === "each_opponent_discard_then_mill") {
    const effect = trigger.effect;
    let next = session;
    for (const opp of session.seats.filter((item) => item.id !== trigger.controllerSeatId && !item.hasLost)) {
      // The discards are the opponent's choice: the least valuable cards (lands beyond the fourth, then cheapest spells).
      const lands = (next.seats.find((item) => item.id === opp.id)?.board.hand ?? []).filter((card) => isLandCard(card)).length;
      const hand = [...(next.seats.find((item) => item.id === opp.id)?.board.hand ?? [])].sort((a, b) => (isLandCard(b) && lands > 4 ? 1 : 0) - (isLandCard(a) && lands > 4 ? 1 : 0) || a.manaValue - b.manaValue);
      for (const card of hand.slice(0, effect.discard)) next = moveCardBetweenVisibleZones(next, opp.id, card.id, "graveyard");
      next = applyMill(next, opp.id, trigger.sourceCardName, effect.mill);
    }
    return rulesEvent(next, trigger.controllerSeatId, `${trigger.sourceCardName}: each opponent discards ${effect.discard} and mills ${effect.mill}.`);
  }
  if (trigger.effect.kind === "destroy_one_per_opponent") {
    const worth = (card: VisibleCard) => card.manaValue * 2 + Math.max(0, effectivePower(card)) + (card.commander ? 5 : 0);
    const kills: Array<{ seatId: string; cardId: string; message: string }> = [];
    let next = session;
    for (const opp of session.seats.filter((item) => item.id !== trigger.controllerSeatId && !item.hasLost)) {
      const pick = opp.board.battlefield.filter((card) => (card.typeLine.includes("Creature") || card.typeLine.includes("Planeswalker")) && !hasShroud(card) && !hasHexproof(card) && !card.phasedOut && !hasIndestructible(card)).sort((a, b) => worth(b) - worth(a))[0];
      if (!pick) continue;
      if (pick.typeLine.includes("Creature")) kills.push({ seatId: opp.id, cardId: pick.id, message: `${pick.name} is destroyed by ${trigger.sourceCardName}.` });
      else next = moveCardBetweenVisibleZones(next, opp.id, pick.id, "graveyard");
    }
    return destroyCreatures(next, kills, "Rules action");
  }
  if (trigger.effect.kind === "reanimate_all_graveyards_and_flip_saga") {
    let next = session;
    for (const seat of session.seats) {
      for (const card of (seat.board.graveyard ?? []).filter((entry) => entry.typeLine.includes("Creature"))) {
        next = moveCardAcrossSeats(next, seat.id, card.id, trigger.controllerSeatId, "battlefield").session;
      }
    }
    const holder = next.seats.find((item) => item.id === trigger.controllerSeatId)?.board.battlefield.find((card) => card.id === trigger.sourceCardId);
    if (holder) next = moveCardAcrossSeats(moveCardAcrossSeats(next, trigger.controllerSeatId, holder.id, holder.ownerSeatId ?? trigger.controllerSeatId, "exile").session, holder.ownerSeatId ?? trigger.controllerSeatId, holder.id, holder.ownerSeatId ?? trigger.controllerSeatId, "battlefield").session;
    return rulesEvent(next, trigger.controllerSeatId, `${trigger.sourceCardName}: every creature card in every graveyard enters under ${session.seats.find((item) => item.id === trigger.controllerSeatId)?.name ?? "your"} control.`);
  }
  if (trigger.effect.kind === "exchange_life_draw_lost") {
    const me = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const target = session.seats.filter((item) => item.id !== trigger.controllerSeatId && !item.hasLost).sort((a, b) => b.life - a.life)[0];
    if (!me || !target || target.life <= me.life) return rulesEvent(session, trigger.controllerSeatId, `${trigger.sourceCardName}: no beneficial life exchange.`);
    const swapped: GameSession = { ...session, seats: session.seats.map((item) => (item.id === me.id ? { ...item, life: target.life } : item.id === target.id ? { ...item, life: me.life } : item)) };
    // Exchanging with a higher total means I GAIN, not lose: the draw only triggers when my total went down.
    return rulesEvent(swapped, me.id, `${me.name} exchanges life totals with ${target.name} (${me.life} <-> ${target.life}).`);
  }
  if (trigger.effect.kind === "prevent_damage") {
    return addDamageShieldsFromSpec(session, trigger.controllerSeatId, { id: trigger.sourceCardId, name: trigger.sourceCardName }, trigger.effect.spec);
  }
  if (trigger.effect.kind === "copy_each_artifact_temp") {
    const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    if (!owner) return session;
    let next = session;
    let made = 0;
    for (const artifact of owner.board.battlefield.filter((card) => hasCardType(card, "Artifact") && !card.phasedOut)) {
      const copied = createCopyTokenForSeat(next, owner.id, artifact);
      next = {
        ...copied.session,
        seats: copied.session.seats.map((item) =>
          item.id !== owner.id
            ? item
            : {
                ...item,
                board: {
                  ...item.board,
                  battlefield: item.board.battlefield.map((card) =>
                    card.id === copied.token.id ? { ...card, summoningSick: false, exileAtEndStep: true, grantedKeywords: [...(card.grantedKeywords ?? []), "haste"], temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), "haste"] } : card
                  )
                }
              }
        )
      };
      made += 1;
    }
    return rulesEvent(next, owner.id, `${trigger.sourceCardName}: ${owner.name} creates ${made} token cop${made === 1 ? "y" : "ies"} of their artifacts with haste; they are exiled at the next end step.`);
  }
  if (trigger.effect.kind === "imprint_dying_creature") {
    const vat = session.seats.flatMap((item) => item.board.battlefield).find((card) => card.id === trigger.sourceCardId);
    const holder = session.seats.find((item) => item.id === trigger.controllerSeatId);
    const dying = trigger.contextCardId ? session.seats.flatMap((item) => (item.board.graveyard ?? []).map((card) => ({ seatId: item.id, card }))).find((entry) => entry.card.id === trigger.contextCardId) : undefined;
    if (!vat || !holder || !dying) return session;
    // Return every card already imprinted on this artifact to its owner's graveyard first (the new one replaces them).
    let next = session;
    for (const seat of session.seats) {
      for (const old of (seat.board.exile ?? []).filter((card) => card.imprintedOnId === vat.id)) {
        next = moveCardAcrossSeats(next, seat.id, old.id, old.ownerSeatId ?? seat.id, "graveyard").session;
      }
    }
    const moved = moveCardAcrossSeats(next, dying.seatId, dying.card.id, dying.card.ownerSeatId ?? dying.seatId, "exile");
    const ownerId = dying.card.ownerSeatId ?? dying.seatId;
    return rulesEvent(
      {
        ...moved.session,
        seats: moved.session.seats.map((item) => (item.id === ownerId ? { ...item, board: { ...item.board, exile: (item.board.exile ?? []).map((card) => (card.id === dying.card.id ? { ...card, imprintedOnId: vat.id } : card)) } } : item))
      },
      holder.id,
      `${holder.name} imprints ${dying.card.name} on ${trigger.sourceCardName}.`
    );
  }
  if (trigger.effect.kind === "copy_token" && trigger.effect.scope === "one_of_candidates") {
    return resolveCopyOneOfCandidates(session, trigger.controllerSeatId, trigger.sourceCardId, trigger.sourceCardName, trigger.effect.candidateIds ?? []);
  }
  if (trigger.effect.kind === "copy_token") {
    const sourceCard = session.seats.find((seat) => seat.id === trigger.controllerSeatId)?.board.battlefield.find((card) => card.id === trigger.sourceCardId);
    const onceKey = `${session.turn}:${trigger.sourceCardId}:copy_token`;
    if (sourceCard && hasOnceEachTurnLimiter(sourceCard.oracleText) && session.onceEachTurnEffectsUsed?.includes(onceKey)) {
      return {
        ...session,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: trigger.controllerSeatId,
            message: `${trigger.sourceCardName} has already done this once this turn.`
          },
          ...session.events
        ]
      };
    }

    const lookupId = trigger.effect.scope === "self" ? trigger.sourceCardId : trigger.contextCardId;
    let copySource: { seatId: string; card: VisibleCard } | undefined;
    for (const seat of session.seats) {
      const card = lookupId ? seat.board.battlefield.find((item) => item.id === lookupId) : undefined;
      if (card) {
        copySource = { seatId: seat.id, card };
        break;
      }
    }
    if (!copySource) {
      return {
        ...session,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: trigger.controllerSeatId,
            message: `${trigger.sourceCardName} trigger finds nothing to copy and has no effect.`
          },
          ...session.events
        ]
      };
    }

    const markedSession =
      sourceCard && hasOnceEachTurnLimiter(sourceCard.oracleText)
        ? { ...session, onceEachTurnEffectsUsed: [...(session.onceEachTurnEffectsUsed ?? []), onceKey] }
        : session;
    // "You may pay {2}. If you do, ...": the cost is paid as the trigger resolves; unaffordable means nothing happens.
    let paidSession = markedSession;
    if (trigger.effect.payCostText) {
      const payer = markedSession.seats.find((seat) => seat.id === trigger.controllerSeatId);
      const total = manaValueFromManaCost(trigger.effect.payCostText);
      const payment = payer ? chooseManaSourcesForCost(payer, genericManaAbilityCostShim({ costManaText: trigger.effect.payCostText }), total, undefined, markedSession.seats) : undefined;
      if (!payer || !payment?.ok) return rulesEvent(markedSession, trigger.controllerSeatId, `${trigger.sourceCardName}: ${payer?.name ?? "the player"} can't pay ${trigger.effect.payCostText}.`);
      paidSession = rulesEvent({ ...markedSession, seats: markedSession.seats.map((seat) => (seat.id === payer.id ? spendManaSources(seat, payment.sourceIds) : seat)) }, payer.id, `${payer.name} pays ${trigger.effect.payCostText} for ${trigger.sourceCardName}.`);
    }
    const { session: copiedSession } = createCopyTokenForSeat(paidSession, trigger.controllerSeatId, copySource.card, { notLegendary: trigger.effect.notLegendary });
    return {
      ...copiedSession,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: trigger.controllerSeatId,
          message: `${trigger.sourceCardName} trigger resolves. ${seatName} creates a token that's a copy of ${copySource.card.name}.`,
          detail: "Rules action"
        },
        ...copiedSession.events
      ]
    };
  }
  if (trigger.effect.kind === "mass_pump") {
    return applyMassPumpEffect(session, trigger.controllerSeatId, trigger.sourceCardName, trigger.effect);
  }
  if (trigger.effect.kind === "impulse_cast_free") {
    const impulseEffect = trigger.effect;
    const fromSeat = session.seats.find((seat) => seat.id === impulseEffect.fromSeatId);
    const library = fromSeat?.library ?? [];
    if (!fromSeat || library.length === 0) {
      return {
        ...session,
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId: trigger.controllerSeatId,
            message: `${trigger.sourceCardName} triggers, but ${fromSeat?.name ?? "that player"} has no cards left in their library to exile.`
          },
          ...session.events
        ]
      };
    }
    const [topCard, ...restLibrary] = library;
    const isLand = isLandCard(topCard);
    const exiledCard: VisibleCard = {
      ...resetForZoneChange(topCard, "exile"),
      ownerSeatId: topCard.ownerSeatId ?? fromSeat.id,
      exiledPlayableBySeatId: isLand ? undefined : trigger.controllerSeatId,
      // No stated duration in this effect's own text ("...you may cast it without paying its mana
      // cost") — same "for as long as it remains exiled" shape playCardFromZone already uses for
      // Bribery-style steal-and-play (exiledPlayableUntilTurn left undefined, never swept by
      // clearTemporaryBuffs, which only expires a turn-limited value). Previously hardcoded to the
      // CURRENT turn, which expired the permission before the controller — who doesn't get
      // priority again until their own next turn, since this triggers off an OPPONENT's cast —
      // ever had a real chance to use it. Reported live as "Mind's Dilation does not work at all,
      // I don't get to play the cards that are getting exiled by it."
      exiledPlayableUntilTurn: undefined,
      exiledPlayableFree: !isLand
    };
    return {
      ...session,
      seats: session.seats.map((seat) => {
        if (seat.id !== fromSeat.id) return seat;
        // The exiled card lives in its OWNER's exile zone (fromSeat), not the controller's, even
        // though the controller is who's permitted to cast it — an exiled card can never appear in
        // another player's exile pile just because they have permission to play it. Reported live
        // as "the card should land in their exile pile not mine."
        return {
          ...seat,
          library: restLibrary,
          board: { ...seat.board, exile: [...(seat.board.exile ?? []), exiledCard] },
          zones: { ...seat.zones, library: Math.max(0, seat.zones.library - 1), exile: seat.zones.exile + 1 }
        };
      }),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: trigger.controllerSeatId,
          message: `${trigger.sourceCardName} exiles ${exiledCard.name} from ${possessive(fromSeat)} library.${isLand ? "" : " Playable without paying its mana cost."}`
        },
        ...session.events
      ]
    };
  }
  // Gix, Yawgmoth Praetor: "its controller may pay 1 life. If they do, they draw a card." — resolves
  // against trigger.actorSeatId (the ATTACKING creature's controller), not trigger.controllerSeatId
  // (Gix's own controller) like every other kind above. The "may" here is decided deterministically
  // rather than via a real prompt (see this kind's own doc comment for why beginTriggerResolution's
  // generic optional_trigger flow — which always asks controllerSeatId — would ask the wrong seat):
  // pay only when it can't be fatal (life strictly greater than the cost) — a real player would
  // always take a free card off spare life, and never risk their own life total to do it.
  if (trigger.effect.kind === "actor_may_pay_life_to_draw") {
    const { lifeCost, drawAmount } = trigger.effect;
    const actorSeat = session.seats.find((seat) => seat.id === trigger.actorSeatId);
    if (!actorSeat || actorSeat.hasLost || actorSeat.life <= lifeCost) return session;
    const paidSession: GameSession = {
      ...session,
      seats: session.seats.map((seat) => (seat.id === trigger.actorSeatId ? { ...seat, life: seat.life - lifeCost } : seat))
    };
    return drawMultipleForSeat(
      paidSession,
      trigger.actorSeatId,
      drawAmount,
      `${trigger.sourceCardName} triggers: ${actorSeat.name} pays ${lifeCost} life and draws ${drawAmount} card${drawAmount === 1 ? "" : "s"}.`
    );
  }
  // Breena, the Demagogue: "that attacking player draws a card" — unconditional (unlike Gix's "may
  // pay life" above), resolves against trigger.actorSeatId (the ATTACKING player). The chained
  // `then: add_counter` (see this kind's own doc comment) resolves separately, against
  // trigger.controllerSeatId (Breena's own controller), via resolveTriggerEffect's existing
  // recursive `then` handling just below this function — nothing extra needed here for that half.
  if (trigger.effect.kind === "self_pump") {
    const { power, toughness } = trigger.effect;
    return rulesEvent(
      {
        ...session,
        seats: session.seats.map((seat) => ({
          ...seat,
          board: {
            ...seat.board,
            battlefield: seat.board.battlefield.map((card) =>
              card.id === trigger.sourceCardId ? { ...card, temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + power, temporaryToughnessBonus: (card.temporaryToughnessBonus ?? 0) + toughness } : card
            )
          }
        }))
      },
      trigger.controllerSeatId,
      `${trigger.sourceCardName} gets ${power >= 0 ? "+" : ""}${power}/${toughness >= 0 ? "+" : ""}${toughness} until end of turn.`
    );
  }
  if (trigger.effect.kind === "damage_effect") {
    const source = findPermanentById(session, trigger.sourceCardId) ?? ({ id: trigger.sourceCardId, name: trigger.sourceCardName, typeLine: "", oracleText: "", manaValue: 0, colors: [], role: "effect", zone: "battlefield" } as VisibleCard);
    const aimed = decodeChosenTarget(trigger.effect.chosenOption);
    return applyRemovalEffect(session, trigger.controllerSeatId, trigger.sourceCardName, source, trigger.effect.effect, undefined, aimed);
  }
  if (trigger.effect.kind === "context_power_damage") {
    const entering = trigger.contextCardId ? findPermanentById(session, trigger.contextCardId) : undefined;
    const power = entering ? Math.max(0, effectivePower(entering)) : 0;
    if (power <= 0 || !entering) return noLegalTargetEvent(session, trigger.controllerSeatId, trigger.sourceCardName);
    return applyRemovalEffect(session, trigger.controllerSeatId, trigger.sourceCardName, entering, { kind: "damage", amount: power, targetType: "any" }, undefined, decodeChosenTarget(trigger.effect.chosenOption));
  }
  if (trigger.effect.kind === "targeted_effect") {
    const shim = findPermanentById(session, trigger.sourceCardId) ?? ({ id: trigger.sourceCardId, name: trigger.sourceCardName, typeLine: "", oracleText: "", manaValue: 0, colors: [], role: "effect", zone: "battlefield" } as VisibleCard);
    return applyTargetedEffect(session, trigger.controllerSeatId, shim, trigger.effect.effect, decodeTargetedChoice(session, trigger.effect.chosenOption));
  }
  if (trigger.effect.kind === "context_gains_keywords") {
    const gained = trigger.effect.keywords;
    const target = trigger.contextCardId ? findPermanentById(session, trigger.contextCardId) : undefined;
    if (!target) return session;
    return rulesEvent(
      { ...session, seats: session.seats.map((seat) => ({ ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === target.id ? { ...card, temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), ...gained], grantedKeywords: [...new Set([...(card.grantedKeywords ?? []), ...gained])] } : card)) } })) },
      trigger.controllerSeatId,
      `${trigger.sourceCardName}: ${target.name} gains ${gained.join(" and ")} until end of turn.`
    );
  }
  if (trigger.effect.kind === "destroy_fliers_then_counters") {
    const victims = session.seats.flatMap((seat) => seat.board.battlefield.filter((card) => card.typeLine.includes("Creature") && hasFlying(card) && !hasIndestructible(card) && !card.phasedOut).map((card) => ({ seatId: seat.id, card })));
    const destroyed = destroyCreatures(session, victims.map((victim) => ({ seatId: victim.seatId, cardId: victim.card.id, message: `${victim.card.name} is destroyed by ${trigger.sourceCardName}.` })), "Rules action");
    if (victims.length === 0) return destroyed;
    return rulesEvent(
      { ...destroyed, seats: destroyed.seats.map((seat) => ({ ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === trigger.sourceCardId ? applyCounterDelta(card, "+1/+1", victims.length) : card)) } })) },
      trigger.controllerSeatId,
      `${trigger.sourceCardName} gets ${victims.length} +1/+1 counter${victims.length === 1 ? "" : "s"}.`
    );
  }
  if (trigger.effect.kind === "take_initiative") return takeInitiative(session, trigger.controllerSeatId);
  if (trigger.effect.kind === "venture_room") {
    const room = trigger.effect.room;
    const option = trigger.effect.chosenOption;
    const owner = session.seats.find((item) => item.id === trigger.controllerSeatId);
    if (!owner || !isUndercityRoom(room)) return session;
    const roomName = UNDERCITY_ROOM_NAMES[room];
    switch (room) {
      case "secret_entrance": {
        const land = (option ? owner.library?.find((card) => card.id === option) : undefined) ?? owner.library?.find((card) => isBasicLandCard(card));
        const fetched = land ? moveLibraryCardToDestination(session, owner.id, land.id, "hand", false) : session;
        const shuffled = { ...fetched, seats: fetched.seats.map((seat) => (seat.id === owner.id ? { ...seat, library: shuffleCards(seat.library ?? []) } : seat)) };
        return rulesEvent(shuffled, owner.id, land ? `${owner.name} puts ${land.name} into their hand (${roomName}).` : `${owner.name} finds no basic land (${roomName}).`);
      }
      case "forge": {
        const target = (option ? owner.board.battlefield.find((card) => card.id === option) : undefined) ?? strongestControlledCreature(owner);
        if (!target) return rulesEvent(session, owner.id, `${roomName}: no creature to put counters on.`);
        return rulesEvent(
          { ...session, seats: session.seats.map((seat) => (seat.id === owner.id ? { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === target.id ? applyCounterDelta(card, "+1/+1", 2) : card)) } } : seat)) },
          owner.id,
          `${roomName}: ${target.name} gets two +1/+1 counters.`
        );
      }
      case "lost_well":
        return resolveAgentLibraryLookWorkflow(session, owner.id, roomName, "scry_cards", 2);
      case "trap": {
        const picked = decodeChosenTarget(option);
        const victim =
          (picked?.kind === "player" ? session.seats.find((seat) => seat.id === picked.seatId) : undefined) ??
          session.seats.filter((seat) => seat.id !== owner.id && !seat.hasLost).sort((a, b) => b.life - a.life)[0];
        if (!victim) return session;
        return rulesEvent({ ...session, seats: session.seats.map((seat) => (seat.id === victim.id ? { ...seat, life: seat.life - 5 } : seat)) }, owner.id, `${roomName}: ${victim.name} loses 5 life.`);
      }
      case "arena": {
        const candidates = session.seats.filter((seat) => seat.id !== owner.id && !seat.hasLost).flatMap((seat) => seat.board.battlefield.filter((card) => card.typeLine.includes("Creature") && !hasShroud(card) && !hasHexproof(card)));
        const goaded = (option ? candidates.find((card) => card.id === option) : undefined) ?? [...candidates].sort((a, b) => effectivePower(b) - effectivePower(a))[0];
        if (!goaded) return rulesEvent(session, owner.id, `${roomName}: no creature to goad.`);
        return rulesEvent(
          { ...session, seats: session.seats.map((seat) => ({ ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === goaded.id ? { ...card, goaded: { bySeatId: owner.id } } : card)) } })) },
          owner.id,
          `${roomName}: ${goaded.name} is goaded.`
        );
      }
      case "stash":
        return rulesEvent(createTokensForSeat(session, owner.id, trigger.sourceCardId, [{ ...predefinedTokenSpec("Treasure"), count: 1 }]).session, owner.id, `${roomName}: ${owner.name} creates a Treasure.`);
      case "archives":
        return drawForSeat(session, owner.id, `${owner.name} draws a card (${roomName}).`);
      case "catacombs":
        return rulesEvent(
          createTokensForSeat(session, owner.id, trigger.sourceCardId, [{ count: 1, name: "Skeleton Token", colors: ["B"], typeLine: "Token Creature - Skeleton", power: "4", toughness: "1", oracleText: "Menace", role: "creature" }]).session,
          owner.id,
          `${roomName}: ${owner.name} creates a 4/1 Skeleton with menace.`
        );
      case "throne":
        return applyDigToBattlefield(session, owner.id, roomName, 10, 999, option, { throne: true });
    }
  }
  if (trigger.effect.kind === "become_monarch") {
    const newMonarch = session.seats.find((seat) => seat.id === trigger.controllerSeatId);
    if (!newMonarch || newMonarch.hasLost) return session;
    return rulesEvent({ ...session, monarchSeatId: newMonarch.id }, newMonarch.id, `${newMonarch.name} becomes the monarch (${trigger.sourceCardName}).`);
  }
  if (trigger.effect.kind === "pay_then_zone") {
    const payer = session.seats.find((seat) => seat.id === trigger.controllerSeatId);
    if (!payer) return session;
    const total = manaValueFromManaCost(trigger.effect.costText);
    const payment = chooseManaSourcesForCost(payer, genericManaAbilityCostShim({ costManaText: trigger.effect.costText }), total, undefined, session.seats);
    if (!payment.ok) {
      return rulesEvent(session, payer.id, `${payer.name} can't pay ${trigger.effect.costText} for ${trigger.sourceCardName}.`);
    }
    const paid = { ...session, seats: session.seats.map((seat) => (seat.id === payer.id ? spendManaSources(seat, payment.sourceIds) : seat)) };
    return applyZoneEffect(rulesEvent(paid, payer.id, `${payer.name} pays ${trigger.effect.costText} for ${trigger.sourceCardName}.`), payer.id, trigger.sourceCardName, trigger.effect.zoneEffect, undefined, trigger.effect.chosenOption ? { kind: "card", seatId: payer.id, cardId: trigger.effect.chosenOption } : undefined);
  }
  if (trigger.effect.kind === "seat_discards") {
    const { amount } = trigger.effect;
    const discarderId = trigger.effect.seatId ?? trigger.actorSeatId;
    const deferredDiscard = deferHumanDiscard(session, discarderId, amount, trigger.sourceCardName);
    if (deferredDiscard) return deferredDiscard;
    let next = session;
    for (let i = 0; i < amount; i += 1) {
      const discarder = next.seats.find((seat) => seat.id === discarderId);
      const toDiscard = discarder ? chooseWorstHandCardToDiscard(discarder) : undefined;
      if (!discarder || !toDiscard) break;
      next = moveCardBetweenVisibleZones(next, discarderId, toDiscard.id, "graveyard");
      next = rulesEvent(next, discarderId, `${discarder.name} discards ${toDiscard.name} (${trigger.sourceCardName}).`);
    }
    return next;
  }
  if (trigger.effect.kind === "actor_loses_life") {
    const { amount } = trigger.effect;
    const actorSeat = session.seats.find((seat) => seat.id === trigger.actorSeatId);
    if (!actorSeat || actorSeat.hasLost) return session;
    return rulesEvent(
      { ...session, seats: session.seats.map((seat) => (seat.id === trigger.actorSeatId ? { ...seat, life: seat.life - amount } : seat)) },
      trigger.actorSeatId,
      `${trigger.sourceCardName} triggers: ${actorSeat.name} loses ${amount} life.`
    );
  }
  if (trigger.effect.kind === "actor_draws_cards") {
    const { amount } = trigger.effect;
    const actorSeat = session.seats.find((seat) => seat.id === trigger.actorSeatId);
    if (!actorSeat || actorSeat.hasLost) return session;
    return drawMultipleForSeat(session, trigger.actorSeatId, amount, `${trigger.sourceCardName} triggers: ${actorSeat.name} draws ${amount} card${amount === 1 ? "" : "s"}.`);
  }
  return {
    ...session,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId: trigger.controllerSeatId,
        message: `${trigger.sourceCardName} trigger resolves.`
      },
      ...session.events
    ]
  };
}

// The delayed return itself: only if the card is still in the graveyard it died into (it may have been exiled or reanimated in the meantime).
function resolveDelayedReturnCard(session: GameSession, trigger: Extract<PendingAction, { type: "trigger" }>, ret: DelayedReturnCard): GameSession {
  const graveSeat = session.seats.find((seat) => (seat.board.graveyard ?? []).some((card) => card.id === ret.cardId));
  if (!graveSeat) return rulesEvent(session, trigger.controllerSeatId, `${trigger.sourceCardName}: ${ret.cardName} is no longer in a graveyard, so it does not return.`);
  const moved = moveCardAcrossSeats(session, graveSeat.id, ret.cardId, ret.controlSeatId, "battlefield");
  const controller = session.seats.find((seat) => seat.id === ret.controlSeatId);
  return rulesEvent(moved.session, trigger.controllerSeatId, `${trigger.sourceCardName}: ${ret.cardName} returns to the battlefield${controller ? ` under ${controller.name}'s control` : ""}.`);
}

export function phaseTriggerTextMatches(text: string, phase: TurnPhase) {
  if (phase === "untap step") return text.includes("at the beginning of your untap") || text.includes("during your untap") || text.includes("phasing");
  if (phase === "upkeep step") return /^(?:vanishing|fading) \d+/.test(text) || /^echo (?:\{|\d)/.test(text) || text.includes("at the beginning of your upkeep") || text.includes("at the beginning of each upkeep") || text.includes("cumulative upkeep");
  if (phase === "draw step") return text.includes("at the beginning of your draw step");
  if (phase === "precombat main phase") return text.includes("at the beginning of your precombat main phase") || text.includes("first main phase");
  // "each combat" (Unnatural Growth) only fires on its controller's own combat here — the sweep walks the active seat's permanents.
  if (phase === "beginning of combat step") return text.includes("at the beginning of combat") || text.includes("at the beginning of each combat") || text.includes("beginning of combat on your turn");
  // Vedalken Humiliator's Metalcraft attack trigger is deliberately excluded here — it's owned by
  // declareAttack instead (see parseMetalcraftAttackDebuff's own comment for why this generic,
  // once-per-phase-entry sweep can't express it correctly), and this loose "whenever...attacks"
  // substring match would otherwise also catch it, doubling the effect (once correct via
  // declareAttack, once via this sweep falling through to a rules-advisor consult that has no
  // workflow kind for it anyway).
  // "Whenever ... attacks" triggers are NOT matched here any more: this sweep fires once per phase entry for
  // every permanent with such text, whether or not it attacked (Grave Titan, Drakuseth, Tyrant's Familiar,
  // Eternal Taskmaster all triggered with nothing attacking). They are queued per declared attacker via
  // pendingAttackDeclarations / findAttackTriggers instead.
  if (phase === "declare attackers step") return false;
  if (phase === "declare blockers step") return text.includes("whenever") && (text.includes(" blocks") || text.includes("becomes blocked"));
  // "Whenever a creature you control deals combat damage to a player, ..." (Toski, Bearer of
  // Secrets, and the same standard templating on plenty of other cards) is excluded here even
  // though it contains "combat damage" — this generic sweep only knows "it's currently the combat
  // damage step," not whether THIS card's controller actually had a creature connect with a player
  // this combat (as opposed to being blocked, dealing damage only to a creature or planeswalker, or
  // not attacking at all), so matching it here fired the trigger unconditionally every combat damage
  // step regardless. applyCombatDamageToTarget records the real event onto
  // pendingCombatDamageToPlayer instead (see its own comment), drained by a dedicated effect that
  // checks the actual damage recipient.
  if (phase === "combat damage step") {
    return (
      (text.includes("combat damage") && !/\bdeals? combat damage to a player\b/.test(text)) ||
      text.includes("whenever a creature dies") ||
      text.includes("whenever another creature dies")
    );
  }
  if (phase === "end of combat step") return text.includes("at end of combat") || text.includes("at the end of combat") || text.includes("until end of combat");
  if (phase === "postcombat main phase") return text.includes("at the beginning of your postcombat main phase") || text.includes("second main phase");
  if (phase === "end step") return text.includes("at the beginning of your end step") || text.includes("at the beginning of each end step") || text.includes("at the beginning of the end step");
  if (phase === "cleanup step") return text.includes("at the beginning of your cleanup step") || text.includes("cleanup step");
  return false;
}

// Isolates just the clause(s) that actually match this phase's trigger condition, so the
// deterministic parsers below don't misread some unrelated ability on the same card — same
// "clause, not whole card" discipline as etbEffectText/deathEffectText. mergeModalBulletClauses
// runs first so a recurring modal trigger's header ("At the beginning of your end step, choose
// one —") and its bullet modes survive together as one clause (see its own doc comment) — without
// it, the header alone contains the phase-trigger wording this filter matches on, and the bullets
// alone contain the actual effect text, so a plain per-line filter would keep one and drop the
// other, losing Abiding Grace-style recurring choices entirely.
export function phaseEffectText(oracleText: string, phase: TurnPhase): string {
  return mergeModalBulletClauses(oracleClauses(oracleText))
    .filter((clause) => !isActivatedAbilityClause(clause) && phaseTriggerTextMatches(clause.toLowerCase(), phase))
    .join(" ");
}

// Enters an Undercity room: records the progress and queues its effect (pendingVentureRooms) for the component to put on the stack.
export function enterUndercityRoom(session: GameSession, seatId: string, room: UndercityRoom): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  return rulesEvent(
    { ...session, undercityRooms: { ...(session.undercityRooms ?? {}), [seatId]: room }, pendingVentureRooms: [...(session.pendingVentureRooms ?? []), { seatId, room }] },
    seatId,
    `${seat.name} ventures into the Undercity: ${UNDERCITY_ROOM_NAMES[room]}. ${UNDERCITY_ROOM_TEXT[room]}`
  );
}

// Venture into the Undercity: the next room (a human picks between branches; an agent takes the better one).
export function ventureIntoUndercity(session: GameSession, seatId: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat || seat.hasLost) return session;
  const options = nextUndercityRooms(session.undercityRooms?.[seatId]);
  if (options.length > 1 && seat.kind === "human") {
    return { ...session, pendingVentureChoices: [...(session.pendingVentureChoices ?? []), { seatId, options }] };
  }
  return enterUndercityRoom(session, seatId, options.length === 1 ? options[0] : preferredUndercityRoom(options));
}

// "You take the initiative": you have it from now on, and you venture into the Undercity.
export function takeInitiative(session: GameSession, seatId: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat || seat.hasLost) return session;
  return ventureIntoUndercity(rulesEvent({ ...session, initiativeSeatId: seatId }, seatId, `${seat.name} takes the initiative.`), seatId);
}

// Effects that happen "at the beginning of your end step" and must not be lost when the End Turn shortcut skips the step: the monarch's draw
// and Dragonhawk's delayed damage. Safe to call twice in a turn.
// Imprisoned in the Moon: "Enchanted permanent is a colorless land with '{T}: Add {C}' and loses all other card types and abilities." Applied while the Aura is
// attached (the original characteristics are kept in imprisonedOriginal) and undone when it is not.
const IMPRISONED_RE = /enchanted permanent is a colorless land with "\{t\}: add \{c\}" and loses all other card types and abilities/i;

export function applyImprisonedInTheMoon(session: GameSession): GameSession {
  const auras = session.seats.flatMap((seat) => seat.board.battlefield.filter((card) => card.attachedToId && IMPRISONED_RE.test(card.oracleText)));
  const imprisonedIds = new Set(auras.map((aura) => aura.attachedToId!));
  const needsWork = session.seats.some((seat) => seat.board.battlefield.some((card) => (imprisonedIds.has(card.id) && !card.imprisonedOriginal) || (!imprisonedIds.has(card.id) && card.imprisonedOriginal)));
  if (!needsWork) return session;
  return {
    ...session,
    seats: session.seats.map((seat) => ({
      ...seat,
      board: {
        ...seat.board,
        battlefield: seat.board.battlefield.map((card) => {
          if (imprisonedIds.has(card.id) && !card.imprisonedOriginal) {
            return { ...card, imprisonedOriginal: { typeLine: card.typeLine, oracleText: card.oracleText, power: card.power, toughness: card.toughness, colors: card.colors, abilitiesStripped: card.abilitiesStripped, counters: card.counters }, typeLine: "Land", oracleText: "{T}: Add {C}.", power: undefined, toughness: undefined, colors: [], attacking: false, blocking: false, goaded: undefined };
          }
          if (!imprisonedIds.has(card.id) && card.imprisonedOriginal) {
            const original = card.imprisonedOriginal;
            return { ...card, typeLine: original.typeLine, oracleText: original.oracleText, power: original.power, toughness: original.toughness, colors: original.colors, abilitiesStripped: original.abilitiesStripped, imprisonedOriginal: undefined };
          }
          return card;
        })
      }
    }))
  };
}

// Treasure Nabber: "Whenever an opponent taps an artifact for mana, gain control of that artifact until the end of your next turn." Runs from the
// state-based pass: spendManaSources flags each artifact tapped for mana; the first opposing Nabber takes it.
export function applyTreasureNabber(session: GameSession): GameSession {
  const tapped = session.seats.flatMap((seat) => seat.board.battlefield.filter((card) => card.justTappedForMana).map((card) => ({ seatId: seat.id, card })));
  if (tapped.length === 0) return session;
  let next: GameSession = { ...session, seats: session.seats.map((seat) => ({ ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.justTappedForMana ? { ...card, justTappedForMana: undefined } : card)) } })) };
  for (const { seatId, card } of tapped) {
    const nabber = next.seats.find((seat) => seat.id !== seatId && !seat.hasLost && seat.board.battlefield.some((permanent) => !permanent.abilitiesStripped && /whenever an opponent taps an artifact for mana, gain control of that artifact until the end of your next turn/i.test(permanent.oracleText)));
    if (!nabber || card.nabbedFromSeatId) continue;
    next = changeControlWithinBattlefield(next, card.id, seatId, nabber.id);
    next = {
      ...next,
      seats: next.seats.map((seat) =>
        seat.id !== nabber.id ? seat : { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((permanent) => (permanent.id === card.id ? { ...permanent, nabbedFromSeatId: seatId, nabbedUntil: { seatId: nabber.id, afterTurn: next.turn } } : permanent)) } }
      )
    };
    next = rulesEvent(next, nabber.id, `${nabber.name} gains control of ${card.name} until the end of their next turn (Treasure Nabber).`);
  }
  return next;
}

// Who an agent aims a targeted effect at: helpful verbs go on its own best permanent (or itself); harmful ones on the opponent they hurt most.
export function pickTargetedEffectTarget(session: GameSession, controllerSeatId: string, source: VisibleCard, effect: TargetedEffect): ChosenTarget | undefined {
  const spec = targetedEffectSpec(effect, source.id, source.name);
  const legal = legalTargets(session, controllerSeatId, spec, source);
  if (legal.length === 0) return undefined;
  const beneficial = targetedEffectIsBeneficial(effect);
  if (effect.who.kind === "player") {
    const players = legal.filter((entry): entry is Extract<typeof legal[number], { kind: "player" }> => entry.kind === "player");
    const mine = players.find((entry) => entry.seatId === controllerSeatId);
    const others = players.filter((entry) => entry.seatId !== controllerSeatId);
    if (beneficial) {
      const pick = mine ?? players[0];
      return pick ? { kind: "player", seatId: pick.seatId } : undefined;
    }
    const victim = [...others].sort((a, b) => (session.seats.find((seat) => seat.id === a.seatId)?.life ?? 0) - (session.seats.find((seat) => seat.id === b.seatId)?.life ?? 0))[0];
    return victim ? { kind: "player", seatId: victim.seatId } : undefined;
  }
  const cards = legal.filter((entry): entry is Extract<typeof legal[number], { kind: "card" }> => entry.kind === "card");
  const score = (entry: { card: VisibleCard }) =>
    effect.verb.kind === "copy_token" ? entry.card.manaValue * 2 + effectivePower(entry.card) : effectivePower(entry.card) + effectiveToughness(entry.card) + (entry.card.commander ? 3 : 0);
  const wanted = effect.verb.kind === "untap" ? cards.filter((entry) => entry.card.tapped) : effect.verb.kind === "tap" ? cards.filter((entry) => !entry.card.tapped) : cards;
  const side = wanted.filter((entry) => (beneficial ? entry.seatId === controllerSeatId : entry.seatId !== controllerSeatId));
  const best = [...side].sort((a, b) => score(b) - score(a))[0];
  return best ? { kind: "card", seatId: best.seatId, cardId: best.card.id } : undefined;
}

// Applies a one-verb targeted effect to the chosen target (the human's pick), or to the agent's best target when none was chosen.
export function applyTargetedEffect(session: GameSession, controllerSeatId: string, source: VisibleCard, effect: TargetedEffect, chosen?: ChosenTarget): GameSession {
  const controller = session.seats.find((seat) => seat.id === controllerSeatId);
  if (!controller) return session;
  const spec = targetedEffectSpec(effect, source.id, source.name);
  let target: ChosenTarget | undefined;
  if (chosen) target = targetsStillLegal(session, controllerSeatId, spec, source, [chosen]) ? chosen : undefined;
  else target = pickTargetedEffectTarget(session, controllerSeatId, source, effect);
  if (!target) return rulesEvent(session, controllerSeatId, `${source.name}: no legal target, so the effect does nothing.`);
  let next = session;
  const verb = effect.verb;
  if (target.kind === "card") {
    const targetCard = session.seats.find((seat) => seat.id === target.seatId)?.board.battlefield.find((card) => card.id === target.cardId);
    if (!targetCard) return rulesEvent(session, controllerSeatId, `${source.name}: the target is gone.`);
    if (verb.kind === "copy_token") {
      const copied = createCopyTokenForSeat(next, controllerSeatId, targetCard, { asArtifact: verb.asArtifact }).session;
      next = rulesEvent(copied, controllerSeatId, `${source.name}: creates a token that's a copy of ${targetCard.name}.`);
      return next;
    }
    const changeBase = (card: VisibleCard): VisibleCard => {
      if (verb.kind === "cant_block_source") return { ...card, temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), "can't block:" + source.id] };
      if (verb.kind === "add_counters") return applyCounterDelta(card, verb.counterKind, verb.amount);
      if (verb.kind === "gain_keywords") return { ...card, temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), ...verb.keywords], grantedKeywords: [...new Set([...(card.grantedKeywords ?? []), ...verb.keywords])] };
      if (verb.kind === "pump")
        return {
          ...card,
          temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + verb.power,
          temporaryToughnessBonus: (card.temporaryToughnessBonus ?? 0) + verb.toughness,
          ...(verb.keywords.length ? { temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), ...verb.keywords], grantedKeywords: [...new Set([...(card.grantedKeywords ?? []), ...verb.keywords])] } : {})
        };
      if (verb.kind === "tap") return { ...card, tapped: true };
      if (verb.kind === "untap") return { ...card, tapped: false };
      return card;
    };
    // "...Tap it." (Gyome, Master Chef) taps the target after the verb is applied.
    const change = (card: VisibleCard): VisibleCard => (effect.alsoTap ? { ...changeBase(card), tapped: true } : changeBase(card));
    next = { ...next, seats: next.seats.map((seat) => (seat.id !== target.seatId ? seat : { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === target.cardId ? change(card) : card)) } })) };
    const what = verb.kind === "add_counters" ? `gets ${verb.amount} ${verb.counterKind} counter${verb.amount === 1 ? "" : "s"}` : verb.kind === "gain_keywords" ? `gains ${verb.keywords.join(" and ")} until end of turn` : verb.kind === "pump" ? `gets ${verb.power >= 0 ? "+" : ""}${verb.power}/${verb.toughness >= 0 ? "+" : ""}${verb.toughness}${verb.keywords.length ? " and gains " + verb.keywords.join(" and ") : ""} until end of turn` : verb.kind === "tap" ? "becomes tapped" : "becomes untapped";
    next = rulesEvent(next, controllerSeatId, `${source.name}: ${targetCard.name} ${what}.`);
  } else {
    const victim = next.seats.find((seat) => seat.id === target.seatId);
    if (!victim) return session;
    if (verb.kind === "life") {
      next = rulesEvent({ ...next, seats: next.seats.map((seat) => (seat.id === victim.id ? { ...seat, life: seat.life + verb.delta } : seat)) }, controllerSeatId, `${source.name}: ${victim.name} ${verb.delta < 0 ? "loses" : "gains"} ${Math.abs(verb.delta)} life.`);
    } else if (verb.kind === "draw") {
      next = drawMultipleForSeat(next, victim.id, verb.amount, `${victim.name} draws ${verb.amount} card${verb.amount === 1 ? "" : "s"} (${source.name}).`);
    } else if (verb.kind === "discard") {
      const deferred = deferHumanDiscard(next, victim.id, verb.amount, source.name);
      if (deferred) next = deferred;
      else {
        for (let count = 0; count < verb.amount; count += 1) {
          const fresh = next.seats.find((seat) => seat.id === victim.id);
          const card = fresh ? chooseWorstHandCardToDiscard(fresh) : undefined;
          if (!card) break;
          next = rulesEvent(moveCardBetweenVisibleZones(next, victim.id, card.id, "graveyard"), victim.id, `${victim.name} discards ${card.name} (${source.name}).`);
        }
      }
    }
  }
  if (effect.youGainLife) next = rulesEvent({ ...next, seats: next.seats.map((seat) => (seat.id === controllerSeatId ? { ...seat, life: seat.life + effect.youGainLife! } : seat)) }, controllerSeatId, `${controller.name} gains ${effect.youGainLife} life (${source.name}).`);
  if (effect.youLoseLife) next = rulesEvent({ ...next, seats: next.seats.map((seat) => (seat.id === controllerSeatId ? { ...seat, life: seat.life - effect.youLoseLife! } : seat)) }, controllerSeatId, `${controller.name} loses ${effect.youLoseLife} life (${source.name}).`);
  if (effect.youDraw) next = drawMultipleForSeat(next, controllerSeatId, effect.youDraw, `${controller.name} draws ${effect.youDraw} card${effect.youDraw === 1 ? "" : "s"} (${source.name}).`);
  return next;
}

function decodeTargetedChoice(session: GameSession, value: string | undefined): ChosenTarget | undefined {
  if (!value) return undefined;
  const player = decodeChosenTarget(value);
  if (player) return player;
  return findPermanentOwnerTarget(session, value);
}

export function echoCostText(raw: string): string {
  return /^\d+$/.test(raw) ? `{${raw}}` : raw.toUpperCase();
}

// Echo: pay the cost (choice "pay"), sacrifice (choice "sacrifice"), or pay when affordable and sacrifice otherwise ("if_affordable", agents).
export function resolveEcho(session: GameSession, seatId: string, cardId: string, costText: string, choice: "pay" | "sacrifice" | "if_affordable"): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  const live = seat?.board.battlefield.find((card) => card.id === cardId);
  if (!seat || !live) return session;
  const marked: GameSession = { ...session, seats: session.seats.map((item) => (item.id !== seatId ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === cardId ? { ...card, echoResolved: true } : card)) } })) };
  const payment = choice === "sacrifice" ? undefined : chooseManaSourcesForCost(seat, genericManaAbilityCostShim({ costManaText: costText }), manaValueFromManaCost(costText), cardId, session.seats);
  if (payment?.ok) {
    const paidSession = { ...marked, seats: marked.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item)) };
    return rulesEvent(paidSession, seatId, `${seat.name} pays echo ${costText} for ${live.name}.`);
  }
  return live.typeLine.includes("Creature")
    ? destroyCreatures(marked, [{ seatId, cardId, message: `${live.name} is sacrificed (echo not paid).` }], "Rules action")
    : rulesEvent(moveCardBetweenVisibleZones(marked, seatId, cardId, "graveyard"), seatId, `${live.name} is sacrificed (echo not paid).`);
}

// Phase-triggered permanent abilities (upkeep, draw step, combat, ...) already resolve immediately
// in this engine, with no stack/priority window — a pre-existing simplification, not something new
// here. This just extends that same immediate-resolution model to check the deterministic zone-
// effect/removal/common-trigger parsers first, so a card like Virtue of Persistence ("At the
// beginning of your upkeep, put target creature card from a graveyard onto the battlefield under
// your control") is handled correctly instead of only ever reaching the Rules Advisor's narrow
// search/scry/draw workflow classifier — which has no concept of reanimation at all. An optional
// ("you may") phase trigger resolves as yes here rather than getting a real prompt, matching phase
// triggers' existing no-stack model (they had no chance to decline before this change either).
// Whether a phase clause's leading "if <condition>," (if it has one) holds for this seat; an unrecognised condition counts as not met here so a
// human isn't asked about a trigger the deterministic resolver would decline anyway.
// An intervening "if" on a phase trigger ("At the beginning of your upkeep, if an opponent controls more lands than you, ...",
// Land Tax) that this engine can evaluate and that is currently false: the trigger doesn't go on the stack at all. An unrecognized
// condition does NOT block (the advisor path still gets to look at it).
export function phaseConditionBlocks(session: GameSession, seatId: string, clauseText: string): boolean {
  const match = clauseText.replace(/^.*?\bat the beginning of[^,]*,\s*/i, "").match(/^if\s+(.+?),/i);
  if (!match || !isRecognizedBoardCondition(match[1])) return false;
  return !phaseClauseConditionMet(session, seatId, clauseText);
}

export function phaseClauseConditionMet(session: GameSession, seatId: string, clauseText: string): boolean {
  const match = clauseText.replace(/^.*?\bat the beginning of[^,]*,\s*/i, "").match(/^if\s+(.+?),/i);
  if (!match) return true;
  if (!isRecognizedBoardCondition(match[1])) return false;
  const seat = session.seats.find((item) => item.id === seatId);
  return Boolean(seat && isBoardConditionMet(match[1], seat, session.seats));
}

// Resolves a phase_trigger stack item: the source as it is now, else the last-known snapshot (the source may have left in response).
function resolvePhaseTriggerEffect(session: GameSession, trigger: Extract<PendingAction, { type: "trigger" }>, effect: Extract<TriggerEffect, { kind: "phase_trigger" }>): GameSession {
  const controller = session.seats.find((item) => item.id === trigger.controllerSeatId);
  const chosen = effect.chosenOption;
  if (effect.delayedReturn) return resolveDelayedReturnCard(session, trigger, effect.delayedReturn);
  if (effect.delayedEffectText !== undefined) {
    const inner = commonTriggerEffect(effect.delayedEffectText, "clause", undefined, controller);
    if (!inner) return rulesEvent(session, trigger.controllerSeatId, `${trigger.sourceCardName}: its delayed effect has no deterministic resolution.`);
    return resolveTriggerEffect(session, { ...trigger, id: crypto.randomUUID(), effect: { ...inner, chosenOption: chosen ?? inner.chosenOption }, message: trigger.message });
  }
  if (effect.viaEffect) {
    return resolveTriggerEffect(session, { ...trigger, id: crypto.randomUUID(), effect: { ...effect.viaEffect, chosenOption: chosen ?? effect.viaEffect.chosenOption }, message: trigger.message });
  }
  const source = findPermanentById(session, trigger.sourceCardId) ?? effect.sourceSnapshot;
  if (!source) return session;
  return applyDeterministicPhaseTrigger(session, trigger.controllerSeatId, source, effect.phase) ?? session;
}

export function applyDeterministicPhaseTrigger(session: GameSession, seatId: string, sourceCard: VisibleCard, phase: TurnPhase): GameSession | undefined {
  const clauseText = phaseEffectText(sourceCard.oracleText, phase);
  if (!clauseText.trim()) return undefined;
  // "• Khans — At the beginning of your upkeep, ..." (Outpost Siege) only runs when that label was the one chosen as it entered.
  const modeLabel = clauseText.match(/^[•*]\s*([A-Za-z]+)\s*[—-]/)?.[1];
  if (modeLabel && (sourceCard.chosenMode ?? modeLabel).toLowerCase() !== modeLabel.toLowerCase() && sourceCard.chosenMode) return session;

  // Master of Ceremonies, Keen Duelist, Parker Luck: the other players' / the aimed players' part of the trigger is a real decision (see
  // applyMasterOfCeremonies, resolveRevealExchangeTrigger): a human is asked, an agent decides deterministically.
  if (/\beach opponent chooses money, friends, or secrets\b/i.test(clauseText)) {
    return applyMasterOfCeremonies(session, seatId, sourceCard, session.seats.filter((item) => item.id !== seatId && !item.hasLost).map((item) => item.id));
  }
  if (/\byou and target opponent each reveal the top card of your library\. you each lose life equal to the mana value of the card revealed by the other player\b/i.test(clauseText)) {
    return resolveRevealExchangeTrigger(session, seatId, sourceCard, "keen");
  }
  if (/\btwo target players each reveal the top card of their library\. they each lose life equal to the mana value of the card revealed by the other player\b/i.test(clauseText)) {
    return resolveRevealExchangeTrigger(session, seatId, sourceCard, "parker");
  }

  // Echo {cost}: the first upkeep after it came under your control, pay it or sacrifice the permanent (agents pay when they can).
  const echoKeyword = clauseText.match(/^echo ((?:\{[^}]+\})+|\d+)/i);
  if (echoKeyword) {
    const live = session.seats.find((item) => item.id === seatId)?.board.battlefield.find((card) => card.id === sourceCard.id);
    if (!live || live.echoResolved) return session;
    return resolveEcho(session, seatId, live.id, echoCostText(echoKeyword[1]), "if_affordable");
  }

  // Vanishing N / Fading N: N time/fade counters (put on at the first upkeep), one removed each upkeep; vanishing sacrifices when the last
  // is removed, fading when one can't be removed.
  const timeKeyword = clauseText.match(/^(vanishing|fading) (\d+)/i);
  if (timeKeyword) {
    const kind = timeKeyword[1].toLowerCase() === "vanishing" ? "time" : "fade";
    const live = session.seats.find((item) => item.id === seatId)?.board.battlefield.find((card) => card.id === sourceCard.id);
    if (!live) return session;
    let card = live.timeCountersInitialized ? live : { ...applyCounterDelta(live, kind, Number.parseInt(timeKeyword[2], 10)), timeCountersInitialized: true };
    const sacrificeNow = kind === "time" ? counterCount(card, kind) - 1 <= 0 : counterCount(card, kind) <= 0;
    if (counterCount(card, kind) > 0) card = applyCounterDelta(card, kind, -1);
    const updated: GameSession = { ...session, seats: session.seats.map((item) => (item.id !== seatId ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((entry) => (entry.id === card.id ? card : entry)) } })) };
    if (!sacrificeNow) return updated;
    const gone = card.typeLine.includes("Creature")
      ? destroyCreatures(updated, [{ seatId, cardId: card.id, message: `${card.name} is sacrificed (${timeKeyword[1].toLowerCase()}).` }], "Rules action")
      : rulesEvent(moveCardBetweenVisibleZones(updated, seatId, card.id, "graveyard"), seatId, `${card.name} is sacrificed (${timeKeyword[1].toLowerCase()}).`);
    return gone;
  }

  // "At the beginning of your upkeep, if you're the monarch, create a 5/5 red Dragon token with flying." (Skyline
  // Despot) — only does anything while you hold the monarchy.
  const monarchOnly = clauseText.match(/at the beginning of [^,]+, if you(?:'re| are) the monarch, (create [^.]+)\./i);
  if (monarchOnly) {
    if (session.monarchSeatId !== seatId) return session;
    const specs = parseCreateTokenSpecs(monarchOnly[1]);
    if (specs.length > 0) return createTokensForSeat(session, seatId, sourceCard.id, specs).session;
  }


  // "At the beginning of your end step, if you gained life this turn, each opponent sacrifices a creature of their choice and you return up to
  // one target creature card from your graveyard to your hand." (Witch of the Moors)
  if (/\bif you gained life this turn, each opponent sacrifices a creature of their choice and you return up to one target creature card from your graveyard to your hand\b/i.test(clauseText)) {
    const owner = session.seats.find((item) => item.id === seatId);
    if (!owner || lifeGainedThisTurn(owner) <= 0) return session;
    const sacrificed = resolveTriggerEffect(session, makeCommonTrigger(seatId, seatId, sourceCard, { kind: "each_opponent_sacrifices", filter: "creature" }, `${sourceCard.name} triggers at the end step.`));
    return applyGraveyardReturn(sacrificed, seatId, sourceCard, { destination: "hand", typeFilter: "creature", count: 1 });
  }
  // "Infusion - At the beginning of your end step, if you gained life this turn, return up to one target creature card with mana value X or less from
  // your graveyard to the battlefield, where X is the amount of life you gained this turn." (Moseo, Vein's New Dean)
  if (/\bif you gained life this turn, return up to one target creature card with mana value x or less from your graveyard to the battlefield, where x is the amount of life you gained this turn\b/i.test(clauseText)) {
    const owner = session.seats.find((item) => item.id === seatId);
    const gained = owner ? lifeGainedThisTurn(owner) : 0;
    if (!owner || gained <= 0) return session;
    return applyGraveyardReturn(session, seatId, sourceCard, { destination: "battlefield", typeFilter: "creature", count: 1, maxManaValue: gained });
  }

  // Old Rutstein: "When Old Rutstein enters and at the beginning of your upkeep, mill a card. If a land card is milled this way, create a Treasure token. ..."
  if (commonTriggerEffect(clauseText, "clause")?.kind === "mill_with_rewards") {
    return resolveTriggerEffect(session, makeCommonTrigger(seatId, seatId, sourceCard, { kind: "mill_with_rewards" }, `${sourceCard.name} triggers at the beginning of your upkeep.`));
  }
  // Gadrak, the Crown-Scourge: "At the beginning of your end step, create a Treasure token for each nontoken creature that died this turn."
  if (/\bcreate a treasure token for each nontoken creature that died this turn\b/i.test(clauseText)) {
    const died = session.nontokenCreaturesDiedThisTurn?.turn === session.turn ? session.nontokenCreaturesDiedThisTurn.count : 0;
    if (died <= 0) return session;
    return createTokensForSeat(session, seatId, sourceCard.id, [{ ...predefinedTokenSpec("Treasure"), count: died }]).session;
  }
  // Ribtruss Roaster: "At the beginning of your end step, create a number of 1/1 black and green Pest creature tokens equal to the number of +1/+1
  // counters on this creature. They have "When this token dies, you gain 1 life.""
  const counterTokens = clauseText.match(/\bcreate a number of (1\/1 [a-z ]+? tokens?) equal to the number of \+1\/\+1 counters on this creature\.\s*they have "([^"]+)"/i);
  if (counterTokens) {
    const live = session.seats.find((item) => item.id === seatId)?.board.battlefield.find((card) => card.id === sourceCard.id);
    const counters = live ? counterCount(live, "+1/+1") : 0;
    if (counters <= 0) return session;
    const specs = parseCreateTokenSpecs(`create ${counters} ${counterTokens[1]} with "${counterTokens[2]}"`);
    return specs.length > 0 ? createTokensForSeat(session, seatId, sourceCard.id, specs).session : undefined;
  }
  // Deathbonnet Sprout: "At the beginning of your upkeep, mill a card. Then if there are three or more creature cards in your graveyard, transform this creature."
  const sproutText = clauseText.match(/\bmill a card\. then if there are (one|two|three|four|five|\d+) or more creature cards in your graveyard, transform this creature\b/i);
  if (sproutText && (sourceCard.unlockedFaceIndices?.[0] ?? 0) === 0) {
    const milled = applyMill(session, seatId, sourceCard.name, 1);
    const graveyardCreatures = (milled.seats.find((item) => item.id === seatId)?.board.graveyard ?? []).filter((card) => card.typeLine.includes("Creature")).length;
    return graveyardCreatures >= (numberWordToInt(sproutText[1]) ?? 3) ? transformPermanent(milled, seatId, sourceCard.id, sourceCard.name, false) : milled;
  }
  // Deathbonnet Hulk: "At the beginning of your upkeep, you may exile a card from a graveyard. If a creature card was exiled this way, put a +1/+1 counter on this creature."
  if (/\byou may exile a card from a graveyard\. if a creature card was exiled this way, put a \+1\/\+1 counter on this creature\b/i.test(clauseText) && ((sourceCard.unlockedFaceIndices?.[0] ?? 1) === 1 || !sproutText)) {
    const options: Array<{ label: string; value: string; creature: boolean; own: boolean }> = session.seats.flatMap((item) =>
      (item.board.graveyard ?? []).map((card) => ({ label: `${card.name} (${item.name}'s graveyard${card.typeLine.includes("Creature") ? ", creature: +1/+1 counter" : ""})`, value: `${item.id}:${card.id}`, creature: card.typeLine.includes("Creature"), own: item.id === seatId }))
    );
    if (options.length === 0) return session;
    if (session.seats.find((item) => item.id === seatId)?.kind === "human") {
      return queuePlayerChoice(session, {
        seatId, sourceCardId: sourceCard.id, sourceCardName: sourceCard.name,
        prompt: `${sourceCard.name}: you may exile a card from a graveyard. If it is a creature card, ${sourceCard.name} gets a +1/+1 counter.`,
        options: [...options.map(({ label, value }) => ({ label, value })), { label: "Don't exile a card", value: "none" }],
        resolver: "hulk_exile", data: {}
      });
    }
    // An agent only exiles an opponent's creature card: it feeds the counter and does not cost its own recursion.
    const pick = options.find((option) => option.creature && !option.own);
    return pick ? resolveDeferredChoice(session, seatId, sourceCard.id, sourceCard.name, "hulk_exile", {}, pick.value) : session;
  }

  // Brudiclad, Telchor Engineer: "At the beginning of combat on your turn, create a 2/1 blue Phyrexian Myr artifact creature token. Then you may
  // choose a token you control. If you do, each other token you control becomes a copy of that token." Both halves are deterministic here: the
  // choice is the token whose copies are worth the most (done only when that beats the board as it stands) — a human is not prompted.
  const brudiclad = clauseText.match(/\b(create\b[^.]*\btoken)\.\s*then you may choose a token you control\.\s*if you do, each other token you control becomes a copy of that token/i);
  if (brudiclad) {
    const specs = parseCreateTokenSpecs(brudiclad[1]);
    if (specs.length === 0) return undefined;
    const created = createTokensForSeat(session, seatId, sourceCard.id, specs).session;
    const tokenValue = (card: VisibleCard) => Math.max(0, parseInt(card.power ?? "0", 10) || 0) + Math.max(0, parseInt(card.toughness ?? "0", 10) || 0) + (card.oracleText ? 1.5 : 0);
    const tokens = created.seats.find((item) => item.id === seatId)?.board.battlefield.filter((card) => card.token) ?? [];
    const current = tokens.reduce((sum, card) => sum + tokenValue(card), 0);
    const best = tokens.reduce<VisibleCard | undefined>((top, card) => (!top || tokenValue(card) > tokenValue(top) ? card : top), undefined);
    if (tokens.length >= 2 && session.seats.find((item) => item.id === seatId)?.kind === "human") {
      const distinct = tokens.filter((card, index) => tokens.findIndex((other) => other.name === card.name && other.power === card.power && other.toughness === card.toughness) === index);
      return queuePlayerChoice(created, {
        seatId,
        sourceCardId: sourceCard.id,
        sourceCardName: sourceCard.name,
        prompt: `${sourceCard.name}: choose a token — every other token you control becomes a copy of it.`,
        options: [...distinct.map((card) => ({ label: `${card.name} (${card.power}/${card.toughness})`, value: card.id })), { label: "Don't choose", value: "" }],
        resolver: "brudiclad",
        data: {}
      });
    }
    if (!best || tokens.length < 2 || tokenValue(best) * tokens.length <= current) return created;
    const unified: GameSession = {
      ...created,
      seats: created.seats.map((item) =>
        item.id !== seatId
          ? item
          : {
              ...item,
              board: {
                ...item.board,
                battlefield: item.board.battlefield.map((card) =>
                  card.token && card.id !== best.id
                    ? { ...card, name: best.name, typeLine: best.typeLine, oracleText: best.oracleText, power: best.power, toughness: best.toughness, colors: best.colors, colorIdentity: best.colorIdentity, imageUris: best.imageUris }
                    : card
                )
              }
            }
      )
    };
    return rulesEvent(unified, seatId, `${sourceCard.name}: every other token becomes a copy of ${best.name}.`);
  }

  // "At the beginning of your upkeep, each player draws a card." (Scrawling Crawler): active player first, then the others in turn order.
  if (/\beach player draws a card\b/i.test(clauseText) && !/\bdiscard/i.test(clauseText)) {
    const order = [...session.seats.slice(session.seats.findIndex((item) => item.id === seatId)), ...session.seats.slice(0, session.seats.findIndex((item) => item.id === seatId))];
    return order.filter((item) => !item.hasLost).reduce((next, item) => drawForSeat(next, item.id, `${item.name} draws a card from ${sourceCard.name}.`), session);
  }

  // Mind Unbound: "At the beginning of your upkeep, put a lore counter on this enchantment, then draw a card for each lore counter on this
  // enchantment." The count grows every upkeep (1, 2, 3...) — it used to fall to the plain "draw a card" parser and always drew one.
  if (/\bput a lore counter on this (?:enchantment|permanent), then draw a card for each lore counter on (?:this (?:enchantment|permanent)|it)\b/i.test(clauseText)) {
    const live = session.seats.find((item) => item.id === seatId)?.board.battlefield.find((card) => card.id === sourceCard.id);
    if (!live) return session;
    const withCounter = applyCounterDelta(live, "lore", 1);
    const counted: GameSession = { ...session, seats: session.seats.map((item) => (item.id !== seatId ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((card) => (card.id === live.id ? withCounter : card)) } })) };
    const amount = counterCount(withCounter, "lore");
    return drawMultipleForSeat(counted, seatId, amount, `${sourceCard.name}: ${amount} lore counter${amount === 1 ? "" : "s"}, draws ${amount}.`);
  }

  // Hellkite Tyrant: "At the beginning of your upkeep, if you control twenty or more artifacts, you win the game."
  const winArtifacts = clauseText.match(/\bif you control (twenty|\d+) or more artifacts, you win the game\b/i);
  if (winArtifacts) {
    const needed = winArtifacts[1].toLowerCase() === "twenty" ? 20 : Number.parseInt(winArtifacts[1], 10);
    const owner = session.seats.find((item) => item.id === seatId);
    return owner && owner.board.battlefield.filter((card) => card.typeLine.includes("Artifact")).length >= needed ? winTheGame(session, seatId, sourceCard.name) : session;
  }
  // "At the beginning of your upkeep, if you control no Thopters other than this creature, return
  // this creature to its owner's hand and create five ... tokens" (Thopter Assembly, ...) — none of
  // the parsers below understand a leading "if ~," condition gating the whole effect on their own,
  // so isRecognizedBoardCondition/isBoardConditionMet (the same evaluator "activate only if X"
  // already uses for activated abilities) is checked here first instead of letting them blindly
  // apply the effect every time the phase comes around. An UNRECOGNIZED condition still declines to
  // the Rules Advisor exactly as before (this engine has no evaluator for it at all); a recognized
  // one that's genuinely false resolves as a real, silent no-op instead of a decline; a recognized
  // one that's true falls through to the effect parsers below exactly as an unconditioned trigger
  // would. "You may" isn't caught by this — it's already handled as an optional trigger, not a
  // gating condition.
  // The "at the beginning of..." phrase isn't always the very first thing in the clause — a keyword
  // ability name can sit in front of it ("Lieutenant — At the beginning of combat on your turn, if
  // you control your commander, ..."), so the strip can't be anchored to the start of the string:
  // doing so left that leading "Lieutenant — " untouched, the whole replace a no-op, and the "if"
  // check failing to match a string that still started with "Lieutenant" — reproduced live as Loyal
  // Apprentice creating its Thopter every combat regardless of whether its commander was out.
  const ifConditionMatch = clauseText.replace(/^.*?\bat the beginning of[^,]*,\s*/i, "").match(/^if\s+(.+?),/i);
  if (ifConditionMatch) {
    if (!isRecognizedBoardCondition(ifConditionMatch[1])) return undefined;
    const conditionSeat = session.seats.find((item) => item.id === seatId);
    if (!conditionSeat || !isBoardConditionMet(ifConditionMatch[1], conditionSeat, session.seats, sourceCard.id)) return session;
  }
  // "...return this creature to its owner's hand and create five 1/1 ... tokens" (Thopter Assembly): the bounce is part of the same
  // trigger, then the (token) effect parsers below run on what is left.
  if (/\breturn this (?:creature|permanent|artifact) to its owner's hand and (create\b.+)$/i.test(clauseText)) {
    const tokenText = clauseText.match(/\breturn this (?:creature|permanent|artifact) to its owner's hand and (create\b.+)$/i)![1];
    const specs = parseCreateTokenSpecs(tokenText);
    if (specs.length > 0) {
      const bounced = moveCardAcrossSeats(session, seatId, sourceCard.id, sourceCard.ownerSeatId ?? seatId, "hand").session;
      return createTokensForSeat(rulesEvent(bounced, seatId, `${sourceCard.name} returns to its owner's hand.`), seatId, sourceCard.id, specs).session;
    }
  }

  // "At the beginning of your end step, if you control four or more creatures, transform Growing
  // Rites of Itlimoc." (Growing Rites of Itlimoc, Storm the Vault, and the rest of the Ixalan "boon"
  // cycle) — reuses transformPermanent, the same flip-to-other-face logic the activated-ability
  // "transform_self" kind (parseTransformSelfEffect) already applies, just not anchored to the start
  // of the string here: that parser expects an already-isolated effect text with no cost/condition
  // prefix, but clauseText still carries its own "at the beginning of..., if ..." preamble (now
  // confirmed true, if there was one, by the check just above).
  if (/\btransform\s+(?!target\b)/i.test(clauseText)) return transformPermanent(session, seatId, sourceCard.id, sourceCard.name, false);

  // "At the beginning of your upkeep, look at the top card of your library. If it's a creature card of the chosen type, you may
  // reveal it and put it into your hand." (Herald's Horn) — revealing is always the right call, so the optional part resolves as yes.
  if (/look at the top card of your library\.\s*if it'?s a creature card of the chosen type, you may reveal it and put it into your hand/i.test(clauseText)) {
    const seatForHorn = session.seats.find((item) => item.id === seatId);
    const topCard = seatForHorn?.library?.[0];
    if (!seatForHorn || !topCard || !sourceCard.chosenCreatureType || !topCard.typeLine.includes("Creature") || !topCard.typeLine.includes(sourceCard.chosenCreatureType)) return session;
    return rulesEvent(
      {
        ...session,
        seats: session.seats.map((item) =>
          item.id !== seatId
            ? item
            : {
                ...item,
                library: item.library!.slice(1),
                board: { ...item.board, hand: [...item.board.hand, { ...topCard, zone: "hand" as const }] },
                zones: { ...item.zones, library: item.zones.library - 1, hand: item.zones.hand + 1 }
              }
        )
      },
      seatId,
      `${seatForHorn.name} reveals ${topCard.name} with ${sourceCard.name} and puts it into their hand.`
    );
  }

  // "At the beginning of the end step, sacrifice this creature." (Ball Lightning, Blistering Firecat, ...)
  if (/^at the beginning of (?:the|your|each) end step, sacrifice (?:this creature|this permanent)\.?$/i.test(clauseText.trim())) {
    return destroyCreatures(session, [{ seatId, cardId: sourceCard.id, message: `${sourceCard.name} is sacrificed at the end step.` }], "Rules action");
  }

  // Mechanized Production: "At the beginning of your upkeep, create a token that's a copy of enchanted artifact. Then if you control eight or
  // more artifacts with the same name as the enchanted artifact, you win the game."
  if (/\bcreate a token that'?s a copy of enchanted artifact\b/i.test(clauseText)) {
    const owner = session.seats.find((item) => item.id === seatId);
    const enchanted = sourceCard.attachedToId ? owner?.board.battlefield.find((card) => card.id === sourceCard.attachedToId) : undefined;
    if (!owner || !enchanted) return session;
    const copied = createCopyTokenForSeat(session, seatId, enchanted).session;
    const sameName = (copied.seats.find((item) => item.id === seatId)?.board.battlefield ?? []).filter((card) => card.typeLine.includes("Artifact") && card.name === enchanted.name).length;
    const withEvent = rulesEvent(copied, seatId, `${sourceCard.name}: creates a token that's a copy of ${enchanted.name}.`);
    return sameName >= 8 ? winTheGame(withEvent, seatId, sourceCard.name) : withEvent;
  }
  // Braids, Arisen Nightmare (see applyBraidsEndStep): a human controller is asked through pendingBraidsChoices before this is ever reached;
  // this is the agent's decision. (Resolving it as a plain "draw a card" used to hand out a free card every end step.)
  if (/\byou may sacrifice an artifact, creature, enchantment, land, or planeswalker\b.*\beach opponent may sacrifice\b/i.test(clauseText)) return applyBraidsEndStep(session, seatId, sourceCard);

  const removalEffect = parseRemovalEffect(clauseText);
  if (removalEffect) return applyPrimitiveAction(session, seatId, sourceCard, { kind: "removal", effect: removalEffect });

  // Checked before the generic modal fallback below: a "put a counter on self / cash in once you
  // have enough of them" choose-one (Idol of Oblivion, ...) parses as zero generic modes (see
  // parseCounterAccumulationTrigger's own comment on why), which would otherwise fall all the way
  // through to the Rules Advisor's fixed workflow enum — which has no "add a counter" or
  // "conditional payoff" shape either, so the trigger silently no-ops as manual_review forever.
  const counterAccumulation = parseCounterAccumulationTrigger(clauseText, sourceCard.name);
  if (counterAccumulation) return applyCounterAccumulationEffect(session, seatId, sourceCard, counterAccumulation);

  // "At the beginning of your end step, choose one — ..." (Abiding Grace, ...) — a recurring modal
  // trigger, same non-removal-shaped-modes handling as the one-shot spell/ETB case in
  // resolvePendingAction, just re-evaluated fresh every time this phase comes around (chosen mode
  // isn't "locked in" the way chosenCreatureType is — nothing here suggests it should be). No
  // chosenX exists for a recurring phase trigger (it isn't a spell being cast), so X-based modes
  // are declined here the same way they always were before X support existed.
  const genericModalEffect = !removalEffect ? parseGenericModalEffect(clauseText, undefined) : undefined;
  if (genericModalEffect) return applyGenericModalEffect(session, seatId, sourceCard, genericModalEffect);

  const pumpEffect = parseTargetedPump(clauseText);
  if (pumpEffect) return applyTargetedPumpEffect(session, seatId, sourceCard, pumpEffect);

  // Meren of Clan Nel Toth: "choose target creature card in your graveyard. If that card's mana
  // value is less than or equal to the number of experience counters you have, return it to the
  // battlefield. Otherwise, put it into your hand." Checked before the generic zoneEffect scan
  // below since this conditional, counter-gated shape has no equivalent there (ZoneEffect's own
  // reanimate/regrow kinds are both unconditional, single-outcome effects) — narrow to this exact
  // wording, matching this file's other single-card parsers.
  if (isMerenEndStepEffect(clauseText)) return applyMerenEndStepEffect(session, seatId, sourceCard.name);

  const zoneEffect = parseZoneEffect(clauseText);
  if (zoneEffect) return applyZoneEffect(session, seatId, sourceCard.name, zoneEffect);

  // An X that's a board count, not a cost: "you draw X cards and lose X life, where X is the number of
  // Zombies you control." (Graveborn Muse) and "create X 2/2 black Zombie creature tokens, where X is
  // half the number of Zombies you control, rounded down." (Endless Ranks of the Dead). Neither reached
  // any deterministic path before — the draw/life half went to the LLM, and the token count parsed the
  // bare "X" as 1.
  const phaseSeat = session.seats.find((item) => item.id === seatId);
  const xAmount = phaseSeat ? resolveWhereXBoardCount(clauseText, phaseSeat) : undefined;
  if (phaseSeat && xAmount !== undefined) {
    if (/\byou draw x cards? and (?:you )?lose x life\b/i.test(clauseText)) {
      const drawn = drawMultipleForSeat(session, seatId, xAmount, `${phaseSeat.name} draws ${xAmount} card${xAmount === 1 ? "" : "s"} from ${sourceCard.name}.`);
      const afterLoss: GameSession = { ...drawn, seats: drawn.seats.map((item) => (item.id === seatId ? { ...item, life: item.life - xAmount } : item)) };
      return rulesEvent(afterLoss, seatId, `${phaseSeat.name} loses ${xAmount} life from ${sourceCard.name}.`);
    }
    if (/\bcreate x\b/i.test(clauseText)) {
      const specs = parseCreateTokenSpecs(clauseText.replace(/\bcreate x\b/i, "create two"));
      if (specs.length > 0 && xAmount > 0) {
        return createTokensForSeat(session, seatId, sourceCard.id, specs.map((spec) => ({ ...spec, count: xAmount }))).session;
      }
      return rulesEvent(session, seatId, `${sourceCard.name} resolves with X = ${xAmount}; nothing is created.`);
    }
  }

  // "Create a 1/1 white Spirit creature token with flying. If you're the monarch, instead create a 4/4 white Angel
  // creature token with flying and vigilance." (Court of Grace) — ONE of the two, chosen by whether you're the
  // monarch; reading both clauses made it create a Spirit AND an Angel every upkeep.
  // Real wording: "create a 1/1 ... Spirit ... token with flying. If you're the monarch, create a 4/4 ... Angel ...
  // token with flying instead." ("instead" at the END); the older "instead create" ordering is accepted too.
  const monarchInstead =
    clauseText.match(/(create [^.]+)\.\s*if you(?:'re| are) the monarch, (create [^.]+?) instead\./i) ??
    clauseText.match(/(create [^.]+)\.\s*if you(?:'re| are) the monarch, instead (create [^.]+)\./i);
  if (monarchInstead) {
    const chosenClause = session.monarchSeatId === seatId ? monarchInstead[2] : monarchInstead[1];
    const specs = parseCreateTokenSpecs(chosenClause);
    if (specs.length > 0) return createTokensForSeat(session, seatId, sourceCard.id, specs).session;
  }
  const commonEffect = commonTriggerEffect(clauseText, "clause");
  if (commonEffect) {
    const trigger = makeCommonTrigger(seatId, seatId, sourceCard, commonEffect, `${sourceCard.name}'s ${phase} trigger resolves.`);
    return resolveTriggerEffect(session, trigger);
  }

  return undefined;
}

export const BRAIDS_TYPE_FILTER = "artifact or creature or enchantment or land or planeswalker";

// The card types of the sacrificed permanent, as the "a or b" filter the sacrifice picker understands.
export function braidsSharedTypeFilter(card: VisibleCard): string {
  const lowered = card.typeLine.toLowerCase();
  const types = ["artifact", "creature", "enchantment", "land", "planeswalker"].filter((type) => lowered.includes(type));
  return types.length > 0 ? types.join(" or ") : BRAIDS_TYPE_FILTER;
}

// An opponent who doesn't sacrifice loses 2 life and the Braids controller draws a card.
export function braidsDeclinePenalty(session: GameSession, opponentSeatId: string, braidsSeatId: string, sourceName: string): GameSession {
  const opponent = session.seats.find((item) => item.id === opponentSeatId);
  const controller = session.seats.find((item) => item.id === braidsSeatId);
  if (!opponent || !controller) return session;
  const lost: GameSession = { ...session, seats: session.seats.map((item) => (item.id === opponentSeatId ? { ...item, life: item.life - 2 } : item)) };
  const logged = rulesEvent(lost, opponentSeatId, `${opponent.name} doesn't sacrifice a permanent to ${sourceName} and loses 2 life.`);
  return drawMultipleForSeat(logged, braidsSeatId, 1, `${controller.name} draws a card from ${sourceName}.`);
}

function braidsAgentOpponentPick(opponent: PlayerSeat, typeFilter: string): VisibleCard | undefined {
  const candidates = opponent.board.battlefield.filter((card) => matchesEachPlayerSacrificeFilter(card, typeFilter));
  if (candidates.length === 0) return undefined;
  const cheapest = [...candidates].sort((a, b) => Number(Boolean(b.token)) - Number(Boolean(a.token)) || a.manaValue - b.manaValue)[0];
  // A token is free to give up; anything real is only worth it once life is getting low (2 life is cheaper than a card).
  return cheapest.token || opponent.life <= 12 ? cheapest : undefined;
}

// Runs the opponents' halves in turn order. An agent decides on the spot; a human with something to sacrifice is queued (the rest of the
// opponents follow after their answer); a human with nothing to sacrifice simply takes the penalty.
export function braidsRunOpponents(
  session: GameSession,
  braidsSeatId: string,
  sourceName: string,
  sourceCardId: string,
  typeFilter: string,
  opponentIds: string[]
): GameSession {
  let next = session;
  for (let index = 0; index < opponentIds.length; index += 1) {
    const opponent = next.seats.find((item) => item.id === opponentIds[index]);
    if (!opponent || opponent.hasLost) continue;
    const hasCandidate = opponent.board.battlefield.some((card) => matchesEachPlayerSacrificeFilter(card, typeFilter));
    if (opponent.kind === "human") {
      if (!hasCandidate) {
        next = braidsDeclinePenalty(next, opponent.id, braidsSeatId, sourceName);
        continue;
      }
      return {
        ...next,
        pendingBraidsChoices: [
          ...(next.pendingBraidsChoices ?? []),
          { stage: "opponent", seatId: opponent.id, braidsSeatId, sourceName, sourceCardId, typeFilter, remainingOpponentIds: opponentIds.slice(index + 1) }
        ]
      };
    }
    const pick = braidsAgentOpponentPick(opponent, typeFilter);
    next = pick
      ? destroyCreatures(next, [{ seatId: opponent.id, cardId: pick.id, message: `${opponent.name} sacrifices ${pick.name} to ${sourceName}.` }], "Rules action")
      : braidsDeclinePenalty(next, opponent.id, braidsSeatId, sourceName);
  }
  return next;
}

export function braidsOpponentIds(session: GameSession, braidsSeatId: string): string[] {
  const start = session.seats.findIndex((item) => item.id === braidsSeatId);
  const ordered = start < 0 ? session.seats : [...session.seats.slice(start + 1), ...session.seats.slice(0, start)];
  return ordered.filter((item) => item.id !== braidsSeatId && !item.hasLost).map((item) => item.id);
}

// The whole trigger for an AGENT controller (a human's "may sacrifice" is asked through pendingBraidsChoices instead): it sacrifices a
// token, or a land it has plenty of; otherwise it declines (a real permanent isn't worth a probable card).
export function applyBraidsEndStep(session: GameSession, seatId: string, sourceCard: VisibleCard): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  const lands = seat.board.battlefield.filter((card) => card.typeLine.includes("Land"));
  const pick =
    seat.board.battlefield.find((card) => card.token && card.id !== sourceCard.id) ?? (lands.length >= 7 ? lands.find((land) => !land.commander) : undefined);
  if (!pick) return rulesEvent(session, seatId, `${seat.name} doesn't sacrifice anything to ${sourceCard.name}.`);
  const sacrificed = destroyCreatures(session, [{ seatId, cardId: pick.id, message: `${seat.name} sacrifices ${pick.name} to ${sourceCard.name}.` }], "Rules action");
  return braidsRunOpponents(sacrificed, seatId, sourceCard.name, sourceCard.id, braidsSharedTypeFilter(pick), braidsOpponentIds(sacrificed, seatId));
}

export function isMerenEndStepEffect(clauseText: string): boolean {
  return /\bchoose target creature card in your graveyard\.\s*if that card'?s mana value is less than or equal to the number of experience counters you have,\s*return it to the battlefield\.\s*otherwise,\s*put it into your hand\b/i.test(
    clauseText
  );
}

// Deterministic target choice for Meren's own conditional: prefer the strongest reanimatable
// creature (mana value within the experience-counter budget) by combined effective power+toughness,
// same "biggest is best" bias chooseReanimationTarget already uses; if none qualify, this engine
// still owes a legal target (rule 601.2c-equivalent) among the graveyard's other creature cards, so
// it falls back to the highest mana value one (headed to hand instead, where a bigger card is still
// generically the better pick) rather than declining the trigger outright.
export function applyMerenEndStepEffect(session: GameSession, seatId: string, sourceCardName: string): GameSession {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return session;
  const creatureCards = (seat.board.graveyard ?? []).filter((card) => card.typeLine.includes("Creature"));
  if (creatureCards.length === 0) return session;
  const experienceCounters = seat.experienceCounters ?? 0;
  const reanimatable = creatureCards.filter((card) => card.manaValue <= experienceCounters);
  if (reanimatable.length > 0) {
    const best = reanimatable.reduce((a, b) => (effectivePower(b) + effectiveToughness(b) > effectivePower(a) + effectiveToughness(a) ? b : a));
    const { session: moved } = moveCardAcrossSeats(session, seatId, best.id, seatId, "battlefield");
    return {
      ...moved,
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message: `${sourceCardName} returns ${best.name} from ${possessive(seat)} graveyard to the battlefield.`,
          detail: "Rules action"
        },
        ...moved.events
      ]
    };
  }
  const best = creatureCards.reduce((a, b) => (b.manaValue > a.manaValue ? b : a));
  const moved = moveCardBetweenVisibleZones(session, seatId, best.id, "hand");
  return {
    ...moved,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${sourceCardName} puts ${best.name} from ${possessive(seat)} graveyard into ${seat.name === "You" ? "your" : "their"} hand (mana value too high to return to the battlefield with ${experienceCounters} experience counter${experienceCounters === 1 ? "" : "s"}).`,
        detail: "Rules action"
      },
      ...moved.events
    ]
  };
}
