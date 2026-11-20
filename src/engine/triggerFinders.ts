// Trigger discovery: find*Triggers helpers for attacks, combat damage, deaths/sacrifices, leaves-the-battlefield, life gain, casts,
// land raids, enters-batch watchers, plus agent target picking for triggers.
// Extracted verbatim from components/AppFlow.tsx; AppFlow.tsx re-exports the previously public symbols.

import { agentScriptedTarget } from "@/engine/cardScripts";
import { agentRemovalEffectTarget, encodeChosenTarget, labeledTargetOptions, targetableView } from "@/engine/castTargets";
import { plusOneCounterCount } from "@/engine/combat";
import { manaValueFromManaCost } from "@/engine/costs";
import { hasHexproof, hasShroud } from "@/engine/damage";
import { chooseCounterTarget, chooseDamageTarget, chooseReanimationTarget, genericManaAbilityCostShim, parseGenericModalEffect, strongestControlledCreature, substituteX } from "@/engine/effects";
import { moveCardAcrossSeats } from "@/engine/entry";
import { chooseManaSourcesForCost, spendManaSources } from "@/engine/mana";
import { substituteManaValueCount } from "@/engine/oneShotEffects";
import { capitalizeWord, hasKeyword, numberWordToInt } from "@/engine/shared";
import { predefinedTokenSpec } from "@/engine/tokens";
import { commonTriggerEffect, makeCommonTrigger, modalClauseTriggerEffect, pickTargetedEffectTarget } from "@/engine/triggers";
import { type LabeledSlot, type PendingAction, type TriggerEffect } from "@/engine/types";
import { applyCounterDelta, findPermanentById, possessive, rulesEvent } from "@/engine/zones";
import { permanentMatchesQualifier } from "@/lib/characteristics";
import { hasActiveAbilities } from "@/lib/effectivePermanent";
import { effectivePower } from "@/lib/counters";
import { parseGraveyardReturnAbility, reduceGenericCost } from "@/lib/graveyardAbilities";
import { hasKeyword as hasKeywordText } from "@/lib/keywords";
import { isActivatedAbilityClause, isAttackTriggerAddManaClause, oracleClauses } from "@/lib/oracleClauses";
import { type RemovalEffect } from "@/lib/removalSpells";
import { matchWatcherSubject } from "@/lib/triggerWatchers";
import { hasCardType } from "@/lib/typeGrants";
import { type GameSession, type PlayerSeat, type VisibleCard } from "@/lib/types";

// Triggered "deals N damage to any target" (Dragon Tempest-style, Scourge of Valkas, Warstorm Surge, Outpost Siege's Dragons): the damage the
// human aims, the source for legality checks, and the target pool. Undefined when the trigger isn't a single-target damage trigger.
export function triggerDamageAiming(session: GameSession, trigger: Extract<PendingAction, { type: "trigger" }>, controllerSeatId: string): { effect: RemovalEffect; options: LabeledSlot["options"] } | undefined {
  const fallbackSource = { id: trigger.sourceCardId, name: trigger.sourceCardName, typeLine: "", oracleText: "", manaValue: 0, colors: [], role: "effect", zone: "battlefield" } as VisibleCard;
  const source = findPermanentById(session, trigger.sourceCardId) ?? fallbackSource;
  if (trigger.effect.kind === "damage_effect" && trigger.effect.effect.kind === "damage") {
    const dmg = trigger.effect.effect;
    // "target creature or planeswalker an opponent controls" (Skysovereign) / "target creature defending player controls" (Tyrant's Familiar):
    // only the opponents' permanents are legal, not just any creature.
    const opponentOnly = dmg.targetType === "creature" && /\btarget creature(?: or planeswalker)? (?:an opponent controls|defending player controls|you don'?t control)/i.test(source.oracleText ?? "");
    const slot = opponentOnly ? (/target creature or planeswalker\b/i.test(source.oracleText ?? "") ? "opponent_creature_or_planeswalker" : "opponent_creature") : dmg.targetType === "player" ? "player" : dmg.targetType === "creature" ? "any_creature" : "any_damage";
    return { effect: dmg, options: labeledTargetOptions(session, controllerSeatId, slot, source) };
  }
  if (trigger.effect.kind === "context_power_damage") {
    const entering = trigger.contextCardId ? findPermanentById(session, trigger.contextCardId) : undefined;
    const power = entering ? Math.max(0, effectivePower(entering)) : 0;
    if (!entering || power <= 0) return undefined;
    return { effect: { kind: "damage", amount: power, targetType: "any" }, options: labeledTargetOptions(session, controllerSeatId, "any_damage", entering) };
  }
  return undefined;
}

// Rule 603.3d: a triggered ability's target is chosen as it goes on the stack. An agent's targeted trigger used to pick it only as it resolved, so
// the stack panel showed nothing to respond to. Returns the encoded target (the same string a human's pick is stored as in effect.chosenOption:
// "p:seat" / "c:seat:card" for the damage kinds, a bare card id for the counter/pump/destroy kinds) for the kinds whose resolution already reads it,
// or undefined when the trigger needs no target or nothing is legal (resolution then keeps its own pick).
export const agentTargetedTriggerKinds = new Set<string>([
  "targeted_effect", "damage_effect", "context_power_damage", "add_counter", "pump_target_creature", "double_power_counters", "target_creature_gains_keyword",
  "destroy_tapped_creature", "aura_reanimate", "exile_card_from_graveyard", "become_artifact_target", "gain_control_target_artifact", "scripted"
]);

export function agentTriggerTarget(session: GameSession, trigger: Extract<PendingAction, { type: "trigger" }>): string | undefined {
  const seatId = trigger.controllerSeatId;
  const mine = session.seats.find((seat) => seat.id === seatId);
  const source = findPermanentById(session, trigger.sourceCardId);
  const effect = trigger.effect;
  const bare = (pick: { seatId: string; card: VisibleCard } | undefined) => pick?.card.id;
  switch (effect.kind) {
    case "targeted_effect": {
      const picked = source ? pickTargetedEffectTarget(session, seatId, source, effect.effect) : undefined;
      return picked ? encodeChosenTarget(picked) : undefined;
    }
    // "Deals N damage to any target" (Scourge of Valkas, Dragon Tempest): the same deterministic damage chooser a spell uses.
    case "damage_effect": {
      if (!source || effect.effect.kind === "modal") return undefined;
      const picked = agentRemovalEffectTarget(session, seatId, source, effect.effect, undefined, false);
      return picked ? encodeChosenTarget(picked) : undefined;
    }
    // Warstorm Surge: the entering creature deals damage equal to its power.
    case "context_power_damage": {
      const entering = trigger.contextCardId ? findPermanentById(session, trigger.contextCardId) : undefined;
      const power = entering ? Math.max(0, effectivePower(entering)) : 0;
      if (!entering || power <= 0) return undefined;
      const aim = chooseDamageTarget(session, seatId, power, "any", entering);
      if (!aim) return undefined;
      return encodeChosenTarget(aim.kind === "player" ? { kind: "player", seatId: aim.seat.id } : { kind: "card", seatId: aim.seatId, cardId: aim.card.id });
    }
    case "add_counter": {
      if (effect.scope !== "target_creature" && effect.scope !== "target_creature_you_control") return undefined;
      return bare(chooseCounterTarget(targetableView(session, seatId, source ?? ({ id: trigger.sourceCardId, name: trigger.sourceCardName, typeLine: "", oracleText: "", colors: [], manaValue: 0, role: "effect", zone: "battlefield" } as VisibleCard)), seatId, effect.counterKind, effect.scope === "target_creature_you_control"));
    }
    case "pump_target_creature":
    case "double_power_counters":
      return bare(mine && strongestControlledCreature(mine) ? { seatId, card: strongestControlledCreature(mine)! } : undefined);
    case "target_creature_gains_keyword": {
      const keywords = effect.keywords;
      const best = (mine?.board.battlefield ?? [])
        .filter((card) => card.typeLine.includes("Creature") && !keywords.every((keyword) => hasKeyword(card, keyword)))
        .sort((a, b) => Number(Boolean(b.summoningSick)) - Number(Boolean(a.summoningSick)) || effectivePower(b) - effectivePower(a))[0];
      return best?.id;
    }
    // "You may destroy target creature if it's tapped": the opposing tapped creature worth the most.
    case "destroy_tapped_creature": {
      const worth = (card: VisibleCard) => card.manaValue * 2 + Math.max(0, effectivePower(card)) + (card.commander ? 5 : 0);
      const pool = session.seats
        .filter((seat) => seat.id !== seatId)
        .flatMap((seat) => seat.board.battlefield.filter((card) => card.tapped && card.typeLine.includes("Creature") && !hasShroud(card) && !hasHexproof(card) && !card.phasedOut));
      return [...pool].sort((a, b) => worth(b) - worth(a))[0]?.id;
    }
    // Animate Dead and friends: the best creature card in any graveyard.
    case "aura_reanimate":
      return chooseReanimationTarget(session, seatId, true, "creature")?.card.id;
    // Soul-Guide Lantern: an opponent's best graveyard card, else any.
    case "exile_card_from_graveyard": {
      const worth = (card: VisibleCard) => card.manaValue + (card.typeLine.includes("Creature") ? 2 : 0);
      const pool = session.seats.flatMap((seat) => (seat.board.graveyard ?? []).map((card) => ({ seatId: seat.id, card })));
      return [...pool].sort((a, b) => Number(b.seatId !== seatId) - Number(a.seatId !== seatId) || worth(b.card) - worth(a.card))[0]?.card.id;
    }
    // Memnarch: an agent turns one of its own nonartifact permanents into an artifact (a creature first, else its best other permanent).
    case "become_artifact_target": {
      const pool = (mine?.board.battlefield ?? []).filter((card) => !hasCardType(card, "Artifact") && !card.phasedOut && !hasShroud(card));
      return [...pool].sort((a, b) => Number(b.typeLine.includes("Creature")) - Number(a.typeLine.includes("Creature")) || b.manaValue - a.manaValue)[0]?.id;
    }
    case "gain_control_target_artifact": {
      const pool = session.seats
        .filter((seat) => seat.id !== seatId)
        .flatMap((seat) => seat.board.battlefield.filter((card) => hasCardType(card, "Artifact") && !hasShroud(card) && !hasHexproof(card) && !card.phasedOut));
      return [...pool].sort((a, b) => b.manaValue + Math.max(0, effectivePower(b)) - (a.manaValue + Math.max(0, effectivePower(a))))[0]?.id;
    }
    case "scripted":
      return agentScriptedTarget(session, trigger);
    default:
      return undefined;
  }
}

// "Whenever one or more other creatures you control enter, if they entered or were cast from a graveyard, create a token that's a copy of one of
// them. This ability triggers only once each turn." (Twilight Diviner). A batch watcher: ONE trigger per source for everything that entered together
// (`entries` is one simultaneous batch), judged on each entry's enteredFrom stamp (see VisibleCard.enteredFrom). The once-each-turn limit is checked
// here (no trigger when it already fired this turn) and again when the trigger resolves (resolveTriggerEffect's oncePerTurn key).
export function findEntersBatchWatcherTriggers(session: GameSession, entries: Array<{ seatId: string; card: VisibleCard }>): Array<Extract<PendingAction, { type: "trigger" }>> {
  const triggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];
  if (entries.length === 0) return triggers;
  for (const seat of session.seats) {
    if (seat.hasLost) continue;
    for (const source of seat.board.battlefield) {
      if (source.abilitiesStripped || source.phasedOut) continue;
      const clause = oracleClauses(source.oracleText).find((line) => /^whenever one or more other creatures you control enter,\s*if they entered or were cast from a graveyard,\s*create a token that'?s a copy of one of them\b/i.test(line));
      if (!clause) continue;
      const once = /\bthis ability triggers only once each turn\b/i.test(clause);
      if (once && session.onceEachTurnEffectsUsed?.includes(`${session.turn}:${source.id}:once:copy_token`)) continue;
      const candidates = entries
        .filter((entry) => entry.seatId === seat.id && entry.card.id !== source.id && entry.card.enteredFrom === "graveyard")
        .map((entry) => findPermanentById(session, entry.card.id))
        .filter((card): card is VisibleCard => card !== undefined && hasCardType(card, "Creature"));
      if (candidates.length === 0) continue;
      const effect: TriggerEffect = { kind: "copy_token", scope: "one_of_candidates", candidateIds: candidates.map((card) => card.id), ...(once ? { oncePerTurn: true } : {}) };
      triggers.push(makeCommonTrigger(seat.id, seat.id, source, effect, `${source.name} triggers because ${candidates.map((card) => card.name).join(", ")} entered from a graveyard.`, candidates[0].id));
    }
  }
  return triggers;
}

// "Metalcraft — Whenever this creature attacks, if you control three or more artifacts, creatures
// your opponents control lose all abilities and have base power and toughness N/N until end of
// turn." (Vedalken Humiliator) — narrow to this exact wording, same single-card-scoped pattern as
// isArchaeomancersMapLandRaidTrigger below. Called from declareAttack, which already knows exactly
// which creature is attacking and who its controller's opponents are — see that call site's own
// comment for why the generic "declare attackers step" phase-trigger sweep can't express this.
export function parseMetalcraftAttackDebuff(oracleText: string): { power: number; toughness: number } | undefined {
  const match = oracleText
    .toLowerCase()
    .match(
      /\bwhenever this creature attacks, if you control three or more artifacts, creatures your opponents control lose all abilities and have base power and toughness (\d+)\/(\d+) until end of turn\b/
    );
  return match ? { power: Number.parseInt(match[1], 10), toughness: Number.parseInt(match[2], 10) } : undefined;
}

// "Whenever a land an opponent controls enters, if that player controls more lands than you, you
// may put a land card from your hand onto the battlefield." (Archaeomancer's Map) — narrow to this
// exact wording rather than generalizing enteredTriggerApplies' own qualifier handling (which only
// understands "you control"/unqualified, not "an opponent controls") for what's currently a single
// motivating card. Scoped to the land-play entry point only (not every other way a land could
// enter, e.g. a search-to-battlefield effect) — the overwhelming majority of "a land enters" events
// in a real game are ordinary land drops. This previously required "you may pay {1}. If you do, put
// ... tapped" — text this card has never actually had — so the trigger never matched at all,
// reported live as it silently never firing even with more lands than the opponent.
export function isArchaeomancersMapLandRaidTrigger(oracleText: string): boolean {
  return /\bwhenever a land an opponent controls enters, if that player controls more lands than you, you may put a land card from your hand onto the battlefield\b/i.test(
    oracleText
  );
}

export function findLandRaidTriggers(session: GameSession, enteringSeatId: string, enteredCard: VisibleCard): Array<Extract<PendingAction, { type: "trigger" }>> {
  if (!enteredCard.typeLine.includes("Land")) return [];
  const enteringSeat = session.seats.find((seat) => seat.id === enteringSeatId);
  if (!enteringSeat) return [];
  const enteringLandCount = enteringSeat.board.battlefield.filter((card) => card.typeLine.includes("Land")).length;
  const triggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];
  for (const seat of session.seats) {
    if (seat.id === enteringSeatId) continue;
    const landCount = seat.board.battlefield.filter((card) => card.typeLine.includes("Land")).length;
    if (enteringLandCount <= landCount) continue;
    for (const source of seat.board.battlefield) {
      if (!hasActiveAbilities(source)) continue;
      if (!isArchaeomancersMapLandRaidTrigger(source.oracleText)) continue;
      triggers.push(
        makeCommonTrigger(enteringSeatId, seat.id, source, { kind: "put_land_from_hand" }, `${source.name} triggers because ${enteredCard.name} entered under ${possessive(enteringSeat)} control.`)
      );
    }
  }
  return triggers;
}

// "When Atsushi dies, choose one — • ... • ..." — the modes sit on the bullet lines after the header clause.
function modalDeathTriggerEffect(source: VisibleCard): TriggerEffect | undefined {
  return modalClauseTriggerEffect(source, /^(?:when|whenever)\b[^,]*\bdies, choose (?:one|two)\b.*[—-]\s*$/i);
}

// "Whenever a player sacrifices another permanent, put a +1/+1 counter on each creature you control." (Mazirek,
// Kraul Death Priest) — fires once per sacrificed permanent (any player's, never Mazirek itself) for each such
// watcher on the battlefield. Deaths come from destroyCreatures' pendingDeaths, which marks sacrifices.
export function findSacrificeWatcherTriggers(
  session: GameSession,
  deaths: Array<{ seatId: string; card: VisibleCard; sacrificed?: boolean }>
): Array<Extract<PendingAction, { type: "trigger" }>> {
  const triggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];
  for (const death of deaths) {
    if (!death.sacrificed) continue;
    for (const seat of session.seats) {
      if (seat.hasLost) continue;
      for (const source of seat.board.battlefield) {
        if (source.id === death.card.id || (source.abilitiesStripped || source.phasedOut)) continue;
        const clause = oracleClauses(source.oracleText).find((line) => /^whenever a player sacrifices another permanent\b/i.test(line));
        if (!clause) continue;
        const effectText = clause.replace(/^whenever a player sacrifices another permanent,\s*/i, "");
        const effect = commonTriggerEffect(effectText, "clause", undefined, seat);
        if (!effect) continue;
        triggers.push(makeCommonTrigger(death.seatId, seat.id, source, effect, `${source.name} triggers because ${death.card.name} was sacrificed.`, death.card.id));
      }
    }
    // "Whenever you sacrifice a creature / a black creature / a green creature, ..." (Dina, Essence Brewer; Savra, Queen of the Golgari): only the
    // sacrificing player's own watchers, and the sacrificed card itself counts (a creature that watches its own sacrifice still sees it).
    const sacrificer = session.seats.find((item) => item.id === death.seatId);
    if (sacrificer && !sacrificer.hasLost) {
      for (const source of [...sacrificer.board.battlefield, ...(sacrificer.board.battlefield.some((card) => card.id === death.card.id) ? [] : [death.card])]) {
        if ((source.abilitiesStripped || source.phasedOut)) continue;
        for (const line of oracleClauses(source.oracleText)) {
          const match = line.match(/^whenever you sacrifice (?:an?|another) ([a-z]+ )?(creature|permanent|artifact|food|land)s?,\s*(.+)$/i);
          if (!match) continue;
          const adjective = match[1]?.trim().toLowerCase();
          const noun = match[2].toLowerCase();
          if (/\banother\b/i.test(line.slice(0, 40)) && source.id === death.card.id) continue;
          if (!deathMatchesSacrificeSubject(death.card, adjective, noun)) continue;
          const effectText = match[3];
          const effect = sacrificeWatcherEffect(effectText, sacrificer);
          if (!effect) continue;
          triggers.push(makeCommonTrigger(death.seatId, sacrificer.id, source, effect, `${source.name} triggers because ${death.card.name} was sacrificed.`, death.card.id));
        }
      }
    }
  }
  // "Whenever one or more other creatures die, ..." (Morbid Opportunist): one trigger per watcher for the whole batch of deaths.
  const dyingCreatures = deaths.filter((death) => hasCardType(death.card, "Creature"));
  if (dyingCreatures.length > 0) {
    for (const seat of session.seats) {
      if (seat.hasLost) continue;
      for (const source of [...seat.board.battlefield, ...dyingCreatures.filter((death) => death.seatId === seat.id).map((death) => death.card)]) {
        if ((source.abilitiesStripped || source.phasedOut)) continue;
        const clause = oracleClauses(source.oracleText).find((line) => /^whenever one or more other creatures die,/i.test(line));
        if (!clause) continue;
        if (!dyingCreatures.some((death) => death.card.id !== source.id)) continue;
        const once = /\bthis ability triggers only once each turn\b/i.test(clause);
        const effect = commonTriggerEffect(clause.replace(/^whenever one or more other creatures die,\s*/i, "").replace(/\s*this ability triggers only once each turn\.?$/i, ""), "clause", undefined, seat);
        if (!effect) continue;
        if (triggers.some((existing) => existing.sourceCardId === source.id && existing.effect.kind === effect.kind && existing.message.includes("one or more"))) continue;
        triggers.push(makeCommonTrigger(seat.id, seat.id, source, once ? { ...effect, oncePerTurn: true } : effect, `${source.name} triggers because one or more other creatures died.`, dyingCreatures[0].card.id));
      }
    }
  }
  return triggers;
}

// A creature's own name in its rules text ("put a +1/+1 counter on Gorma", "you gain life equal to its power") read as "this creature", which is
// what the trigger parsers know how to resolve.
function selfNameAsThisCreature(card: VisibleCard): string {
  const names = [card.name, card.name.split(",")[0], card.name.split(" of ")[0]].filter((name, index, all) => name.length >= 4 && all.indexOf(name) === index).sort((a, b) => b.length - a.length);
  let text = card.oracleText;
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`\\b${escaped}(?![a-z])`, "g"), "this creature");
  }
  return text;
}

// Whether a sacrificed card fits "a creature / a black creature / a green creature / a Food / another permanent" in a "whenever you sacrifice ..." watcher.
function deathMatchesSacrificeSubject(card: VisibleCard, adjective: string | undefined, noun: string): boolean {
  if (noun === "creature" && !hasCardType(card, "Creature")) return false;
  if (noun === "artifact" && !hasCardType(card, "Artifact")) return false;
  if (noun === "land" && !hasCardType(card, "Land")) return false;
  if (noun === "food" && !/\bfood\b/i.test(card.typeLine)) return false;
  if (!adjective) return true;
  const colorLetter: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
  if (colorLetter[adjective]) return (card.colors ?? []).includes(colorLetter[adjective]);
  if (adjective === "nontoken") return !card.token;
  return true;
}

// The effect of a "whenever you sacrifice ..." watcher: the shapes the common parser doesn't know about (Savra's pay-2-life edict) first.
function sacrificeWatcherEffect(effectText: string, controller: PlayerSeat): TriggerEffect | undefined {
  const once = /\bthis ability triggers only once each turn\.?$/i.test(effectText);
  const text = effectText.replace(/\s*this ability triggers only once each turn\.?$/i, "").trim();
  // "you may pay 2 life. If you do, each other player sacrifices a creature of their choice." (Savra)
  const payEdict = text.match(/^you may pay (\d+) life\. if you do, each other player sacrifices an? creature of their choice\.?$/i);
  if (payEdict) return { kind: "lose_life", amount: Number.parseInt(payEdict[1], 10), optional: true, then: { kind: "each_opponent_sacrifices", filter: "creature" } };
  // "you may gain 2 life." (Savra's green half)
  const mayGain = text.match(/^you may gain (\d+) life\.?$/i);
  if (mayGain) return { kind: "gain_life", amount: Number.parseInt(mayGain[1], 10), optional: true };
  const effect = commonTriggerEffect(text, "clause", undefined, controller);
  if (!effect) return undefined;
  return once ? { ...effect, oncePerTurn: true } : effect;
}

// "Whenever a Food is put into a graveyard from the battlefield, put two +1/+1 counters on Ygra." (Ygra, Eater of All): a watcher on ANY permanent of the
// named type (a creature counts when it has been made that type, and so do real Food tokens), whoever controls it. Separate from the "dies" scan above, which
// only reads the word "dies" and only looks at creatures.
export function findPutIntoGraveyardTriggers(session: GameSession, deadSeatId: string, deadCard: VisibleCard): Array<Extract<PendingAction, { type: "trigger" }>> {
  const triggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];
  for (const seat of session.seats) {
    for (const source of seat.board.battlefield) {
      if ((source.abilitiesStripped || source.phasedOut) || source.id === deadCard.id) continue;
      for (const clause of oracleClauses(selfNameAsThisCreature(source))) {
        const match = clause.match(/^whenever an? ([a-z]+) is put into a graveyard from the battlefield, (.+)$/i);
        if (!match) continue;
        const type = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
        if (!hasCardType(deadCard, type)) continue;
        const effect = commonTriggerEffect(match[2], "clause", undefined, seat);
        if (effect) triggers.push(makeCommonTrigger(deadSeatId, seat.id, source, effect, `${source.name} triggers because ${deadCard.name} was put into a graveyard.`));
      }
    }
  }
  return triggers;
}

export function findCommonTriggersForPermanentDied(
  session: GameSession,
  deadSeatId: string,
  deadCard: VisibleCard,
  attachedSourceIds?: string[],
  // Rule 603.10/603.6d ("look back in time"): every OTHER creature that died in the same
  // simultaneous event (a board wipe, most commonly) must still be visible to a triggered ability
  // that died in that same event — a Meren of Clan Nel Toth who dies alongside 4 other creatures
  // to Crux of Fate still triggers once per OTHER creature that died, even though she's gone too.
  // Defaults to just this one death (the pre-existing behavior) for the one other call site that
  // evaluates a single death in isolation, outside a batched destroyCreatures pass.
  simultaneousDeaths: Array<{ seatId: string; card: VisibleCard }> = [{ seatId: deadSeatId, card: deadCard }]
): Array<Extract<PendingAction, { type: "trigger" }>> {
  if (!hasCardType(deadCard, "Creature")) return [];
  const triggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];

  for (const seat of session.seats) {
    const simultaneousDeathsForSeat = simultaneousDeaths.filter((death) => death.seatId === seat.id).map((death) => death.card);
    // An Aura that fell off with the creature is already in the graveyard, but its own "when enchanted creature dies" still triggers.
    const fallenAttachments = (seat.board.graveyard ?? []).filter((card) => attachedSourceIds?.includes(card.id));
    const sources = [...seat.board.battlefield, ...simultaneousDeathsForSeat, ...fallenAttachments];
    for (const source of sources) {
      if (!hasActiveAbilities(source)) continue;
      // Felisa, Fang of Silverquill: "create X ... tokens, where X is the number of counters it had on it" counts counters of EVERY kind.
      // The watcher (Felisa) is a different permanent from the creature that died, so this applies to any source with that wording.
      const dynamicCounterCount = /\bnumber of counters it had on it\b/i.test(source.oracleText) ? (deadCard.counters ?? []).reduce((sum, counter) => sum + counter.count, 0) : source.id === deadCard.id ? plusOneCounterCount(deadCard) : undefined;
      const effect = modalDeathTriggerEffect(source) ?? commonTriggerEffect(selfNameAsThisCreature(source), "died", dynamicCounterCount);
      if (!effect || !deathTriggerApplies(source, seat.id, deadCard, deadSeatId, attachedSourceIds)) continue;
      const resolvedEffect: TriggerEffect = effect.kind === "gain_life_equal_power" ? { kind: "gain_life", amount: Math.max(0, effectivePower(source)) } : effect;
      triggers.push(makeCommonTrigger(deadSeatId, seat.id, source, resolvedEffect, `${source.name} triggers because ${deadCard.name} died.`, resolvedEffect.kind === "scripted" ? deadCard.id : undefined));
    }
  }

  // Imprint — Mimic Vat: any seat's Vat reacts to a NONTOKEN creature dying (the dead card must be in a graveyard to be exiled).
  if (!deadCard.token) {
    for (const seat of session.seats) {
      for (const vat of seat.board.battlefield) {
        if (vat.abilitiesStripped || vat.phasedOut || !/imprint\s*[—-]\s*whenever a nontoken creature dies, you may exile that card/i.test(vat.oracleText)) continue;
        triggers.push(makeCommonTrigger(deadSeatId, seat.id, vat, { kind: "imprint_dying_creature" }, `${vat.name} triggers because ${deadCard.name} died.`, deadCard.id));
      }
    }
  }

  // Undying / persist (printed or granted, e.g. by Mikaeus, the Unhallowed): checked against the counters it died with.
  const hadCounter = (kind: string) => (deadCard.counters ?? []).some((counter) => counter.kind === kind && counter.count > 0);
  const returnKind = hasKeyword(deadCard, "undying") && !hadCounter("+1/+1") ? "+1/+1" : hasKeyword(deadCard, "persist") && !hadCounter("-1/-1") ? "-1/-1" : undefined;
  if (returnKind && !deadCard.token) {
    const ownerSeatId = deadCard.ownerSeatId ?? deadSeatId;
    triggers.push(makeCommonTrigger(deadSeatId, ownerSeatId, deadCard, { kind: "undying_return", counterKind: returnKind }, `${deadCard.name} triggers (${returnKind === "+1/+1" ? "undying" : "persist"}).`));
  }

  // Dying is one way to leave the battlefield; the others (bounce, exile) arrive through pendingLeaves.
  triggers.push(...findLeavesBattlefieldTriggers(session, deadSeatId, deadCard));

  return triggers;
}

// "• Dragons — Whenever a creature you control leaves the battlefield, this enchantment deals 1 damage to any target." (Outpost Siege)
export function findLeavesBattlefieldTriggers(session: GameSession, leavingSeatId: string, leavingCard: VisibleCard): Array<Extract<PendingAction, { type: "trigger" }>> {
  const triggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];
  const hadCounters = (leavingCard.counters ?? []).some((counter) => counter.count > 0);
  if (!leavingCard.typeLine.includes("Creature") && !hadCounters) return triggers;
  // Athreos, Shroud-Veiled: any seat's watcher reacts to a marked creature of ANY controller dying or being exiled.
  for (const seat of session.seats) {
    for (const watcher of seat.board.battlefield) {
      if ((watcher.abilitiesStripped || watcher.phasedOut) || watcher.id === leavingCard.id) continue;
      for (const clause of oracleClauses(watcher.oracleText)) {
        const marked = clause.match(/^whenever a creature with an? ([a-z+/-]+) counter on it dies or is put into exile, return that card to the battlefield under your control\.?$/i);
        if (!marked || !(leavingCard.counters ?? []).some((counter) => counter.kind.toLowerCase() === marked[1].toLowerCase() && counter.count > 0)) continue;
        triggers.push(makeCommonTrigger(leavingSeatId, seat.id, watcher, { kind: "return_marked_to_battlefield" }, `${watcher.name} triggers because ${leavingCard.name} left the battlefield.`, leavingCard.id));
      }
    }
  }
  const watcherSeat = session.seats.find((seat) => seat.id === leavingSeatId);
  for (const watcher of watcherSeat?.board.battlefield ?? []) {
    if ((watcher.abilitiesStripped || watcher.phasedOut) || watcher.id === leavingCard.id) continue;
    for (const clause of oracleClauses(watcher.oracleText)) {
      // "Whenever another permanent you control leaves the battlefield, if it had counters on it, investigate." (Angelic Sleuth)
      const withCounters = hadCounters ? clause.match(/^whenever another permanent you control leaves the battlefield, if it had counters on it, (.+)$/i) : null;
      if (withCounters) {
        const countersEffect = commonTriggerEffect(withCounters[1], "clause");
        if (countersEffect) triggers.push(makeCommonTrigger(leavingSeatId, leavingSeatId, watcher, countersEffect, watcher.name + " triggers because " + leavingCard.name + " left the battlefield."));
        continue;
      }
      if (!leavingCard.typeLine.includes("Creature")) continue;
      const match = clause.match(/^(?:[•*]\s*)?(?:([A-Za-z]+)\s*[—-]\s*)?whenever a creature you control leaves the battlefield, (.+)$/i);
      if (!match) continue;
      if (match[1] && !watcher.chosenMode) continue;
      if (match[1] && watcher.chosenMode && watcher.chosenMode.toLowerCase() !== match[1].toLowerCase()) continue;
      const leaveEffect = commonTriggerEffect(match[2], "clause");
      if (leaveEffect) triggers.push(makeCommonTrigger(leavingSeatId, leavingSeatId, watcher, leaveEffect, watcher.name + " triggers because " + leavingCard.name + " left the battlefield."));
    }
  }
  return triggers;
}

// "Whenever a creature you control deals combat damage to a player, ..." (Toski, Bearer of
// Secrets, ...) — scoped to just dealingSeatId's own battlefield since every real instance of this
// template is self-relative ("a creature YOU control"), unlike findCommonTriggersForPermanentDied's
// all-seats scan. See pendingCombatDamageToPlayer's own comment on GameSession for why this can't
// just be a generic phase trigger.
// Every "Whenever <subject> attacks" trigger caused by ONE declared attacker, on any seat's battlefield
// (the watcher can be the attacker itself, another of its controller's permanents, or the defending
// player's — Marchesa's Decree). `unparsed` lists attacker-side sources whose clause no deterministic
// parser understands, which the caller sends to the rules advisor as the old phase sweep did.
// Gives one specific creature keywords until end of turn (the human's pick for a "target creature gains ..." effect).
export function grantKeywordsToCreature(session: GameSession, seatId: string, cardId: string, keywords: string[], sourceName: string): GameSession {
  const owner = session.seats.find((seat) => seat.id === seatId);
  const target = owner?.board.battlefield.find((card) => card.id === cardId);
  if (!owner || !target) return session;
  return rulesEvent(
    {
      ...session,
      seats: session.seats.map((seat) =>
        seat.id !== seatId
          ? seat
          : {
              ...seat,
              board: {
                ...seat.board,
                battlefield: seat.board.battlefield.map((card) =>
                  card.id === cardId ? { ...card, temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), ...keywords], grantedKeywords: [...new Set([...(card.grantedKeywords ?? []), ...keywords])] } : card
                )
              }
            }
      )
    },
    seatId,
    sourceName + " gives " + target.name + " " + keywords.join(" and ") + " until end of turn."
  );
}

// "Whenever you gain life, ..." (Archangel of Thune, Exemplar of Light, Ajani's Pridemate) and "Whenever you gain life for the
// first time each turn, ..." (Vanguard Seraph). Only the source's controller gaining life counts. `firstThisTurn` is supplied by
// the caller, which is the one place that sees every gain.
export function findLifeGainTriggers(
  session: GameSession,
  gain: { seatId: string; amount: number; firstThisTurn: boolean }
): Array<Extract<PendingAction, { type: "trigger" }>> {
  const triggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];
  const sourceSeat = session.seats.find((seat) => seat.id === gain.seatId);
  if (!sourceSeat || sourceSeat.hasLost || gain.amount <= 0) return triggers;
  for (const source of sourceSeat.board.battlefield) {
    if ((source.abilitiesStripped || source.phasedOut)) continue;
    for (const clause of oracleClauses(source.oracleText)) {
      if (isActivatedAbilityClause(clause)) continue;
      const match = clause.match(/^(?:when|whenever) you gain life( for the first time each turn)?,/i);
      if (!match) continue;
      if (match[1] && !gain.firstThisTurn) continue;
      const effect = commonTriggerEffect(clause, "clause", undefined, sourceSeat);
      if (effect) triggers.push(makeCommonTrigger(gain.seatId, gain.seatId, source, effect, `${source.name} triggers because ${sourceSeat.name} gained life.`));
    }
  }
  return triggers;
}

// Angel of Vitality: "If you would gain life, you gain that much life plus 1 instead." One extra life per such permanent.
export function lifeGainReplacementBonus(seat: PlayerSeat): number {
  return seat.board.battlefield.filter((card) => !card.abilitiesStripped && /\bif you would gain life, you gain that much life plus 1 instead\b/i.test(card.oracleText)).length;
}

// "Whenever you attack with two or more creatures, ..." for the attacker's own permanents, and "Whenever another player attacks with
// two or more creatures, they draw a card if none of those creatures attacked you." for everyone else's. `keys` are the
// once-each-turn markers the caller records so a later declaration in the same combat doesn't fire them again.
export function findMultiAttackTriggers(session: GameSession, attackerSeatId: string): { triggers: Array<Extract<PendingAction, { type: "trigger" }>>; keys: string[] } {
  const triggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];
  const keys: string[] = [];
  const attacker = session.seats.find((seat) => seat.id === attackerSeatId);
  const attackers = attacker?.board.battlefield.filter((card) => card.attacking) ?? [];
  // "Whenever one or more Dragons you control attack, draw that many cards, then you may put a permanent card from your hand onto the
  // battlefield." (The Ur-Dragon): once per declaration, for the attacking creatures of that subtype.
  if (attacker) {
    for (const source of attacker.board.battlefield) {
      if ((source.abilitiesStripped || source.phasedOut)) continue;
      const clause = oracleClauses(source.oracleText).find((line) => /^whenever one or more [a-z]+s you control attack, draw that many cards, then you may put a permanent card from your hand onto the battlefield/i.test(line));
      const subtype = clause?.match(/^whenever one or more ([a-z]+)s you control attack/i)?.[1];
      const key = `${session.turn}:${source.id}:subtype_attack`;
      if (!clause || !subtype || session.onceEachTurnEffectsUsed?.includes(key)) continue;
      const count = attackers.filter((card) => permanentMatchesQualifier(card, subtype)).length;
      if (count === 0) continue;
      keys.push(key);
      triggers.push(makeCommonTrigger(attackerSeatId, attackerSeatId, source, { kind: "draw_then_permanent", amount: count }, `${source.name} triggers because ${count} ${subtype}${count === 1 ? "" : "s"} attacked.`));
    }
  }
  if (!attacker || attackers.length < 2) return { triggers, keys };
  for (const sourceSeat of session.seats) {
    if (sourceSeat.hasLost) continue;
    for (const source of sourceSeat.board.battlefield) {
      if ((source.abilitiesStripped || source.phasedOut)) continue;
      const key = `${session.turn}:${source.id}:multi_attack:${attackerSeatId}`;
      if (session.onceEachTurnEffectsUsed?.includes(key)) continue;
      for (const clause of oracleClauses(source.oracleText)) {
        if (sourceSeat.id === attackerSeatId) {
          const own = clause.match(/^whenever you attack with two or more creatures, (.+)$/i);
          const effect = own ? commonTriggerEffect(own[1], "clause", undefined, sourceSeat) : undefined;
          if (effect) {
            triggers.push(makeCommonTrigger(attackerSeatId, sourceSeat.id, source, effect, `${source.name} triggers because ${attacker.name} attacked with two or more creatures.`));
            keys.push(key);
          }
        } else if (/^whenever another player attacks with two or more creatures, they draw a card if none of those creatures attacked you\b/i.test(clause)) {
          keys.push(key);
          if (attackers.some((card) => card.attackTargetId === sourceSeat.id)) continue;
          triggers.push(makeCommonTrigger(attackerSeatId, sourceSeat.id, source, { kind: "actor_draws_cards", amount: 1 }, `${source.name} triggers because ${attacker.name} attacked with two or more creatures, none at ${sourceSeat.name}.`));
        }
      }
    }
  }
  return { triggers, keys };
}

export function findAttackTriggers(
  session: GameSession,
  attack: { seatId: string; card: VisibleCard; defendingSeatId: string },
  event: "attacks" | "blocks" = "attacks"
): { triggers: Array<Extract<PendingAction, { type: "trigger" }>>; unparsed: Array<{ seatId: string; source: VisibleCard }> } {
  const triggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];
  const unparsed: Array<{ seatId: string; source: VisibleCard }> = [];
  for (const sourceSeat of session.seats) {
    if (sourceSeat.hasLost) continue;
    for (const source of sourceSeat.board.battlefield) {
      if ((source.abilitiesStripped || source.phasedOut)) continue;
      // Dethrone (Scourge of the Throne): attacking the player with the most life (or tied) puts a +1/+1 counter on the attacker.
      if (event === "attacks" && source.id === attack.card.id && hasKeywordText(source.oracleText, "dethrone")) {
        const defending = session.seats.find((seat) => seat.id === attack.defendingSeatId);
        if (defending && session.seats.filter((seat) => !seat.hasLost).every((seat) => defending.life >= seat.life)) {
          triggers.push(makeCommonTrigger(attack.seatId, sourceSeat.id, source, { kind: "add_counter", counterKind: "+1/+1", amount: 1, scope: "self" }, `${source.name} triggers (dethrone).`, attack.card.id));
        }
      }
      if (event === "attacks" && source.id === attack.card.id && hasKeywordText(source.oracleText, "battle cry")) {
        triggers.push(makeCommonTrigger(attack.seatId, sourceSeat.id, source, { kind: "battle_cry" }, `${source.name} triggers (battle cry).`, attack.card.id));
      }
      if (event === "attacks" && source.id === attack.card.id && hasKeywordText(source.oracleText, "melee")) {
        triggers.push(makeCommonTrigger(attack.seatId, sourceSeat.id, source, { kind: "melee" }, `${source.name} triggers (melee).`, attack.card.id));
      }
      // Myriad: a token copy of the attacker for every opponent other than the defending player.
      if (event === "attacks" && source.id === attack.card.id && hasKeywordText(source.oracleText, "myriad")) {
        triggers.push(makeCommonTrigger(attack.seatId, sourceSeat.id, source, { kind: "myriad", defendingSeatId: attack.defendingSeatId, optional: true }, `${source.name} triggers (myriad).`, attack.card.id));
      }
      // Martial Impetus: an Aura on the attacker — "Whenever enchanted creature attacks, each other creature that's attacking one of your opponents gets +1/+1 until end of turn."
      if (event === "attacks" && source.attachedToId === attack.card.id && /whenever enchanted creature attacks, each other creature that'?s attacking one of your opponents gets \+1\/\+1 until end of turn/i.test(source.oracleText)) {
        triggers.push(makeCommonTrigger(attack.seatId, sourceSeat.id, source, { kind: "pump_other_attackers", power: 1, toughness: 1 }, `${source.name} triggers because ${attack.card.name} attacked.`, attack.card.id));
      }
      const sourceClauses = oracleClauses(source.oracleText);
      const dragonPing = /^whenever a creature attacks you or a planeswalker you control, each dragon you control deals 1 damage to that creature\.?$/i;
      if (event === "attacks" && attack.defendingSeatId === sourceSeat.id && sourceClauses.some((clause) => dragonPing.test(clause.replace(/\([^)]*\)/g, "").trim()))) {
        triggers.push(makeCommonTrigger(attack.seatId, sourceSeat.id, source, { kind: "dragons_ping_attacker" }, `${source.name} triggers because ${attack.card.name} attacked.`, attack.card.id));
      }
      for (const [clauseIndex, clause] of sourceClauses.entries()) {
        if (dragonPing.test(clause.replace(/\([^)]*\)/g, "").trim())) continue;
        const eventPattern = event === "attacks" ? /\b(?:when|whenever)\b[^,.]*\battacks\b/i : /\b(?:when|whenever)\b[^,.]*\bblocks\b/i;
        if (isActivatedAbilityClause(clause) || !eventPattern.test(clause)) continue;
        // Myriad's reminder text ("Myriad (Whenever this creature attacks, ...)") is handled above by the keyword itself.
        if (/^(?:myriad|battle cry|melee)\b/i.test(clause)) continue;
        // Owned by declareAttack's own inline handling.
        if (isAttackTriggerAddManaClause(clause) || parseMetalcraftAttackDebuff(clause)) continue;
        // "Lieutenant — As long as you control your commander, this creature gets +2/+2 and has \"Whenever this
        // creature attacks, it deals 7 damage to target creature defending player controls.\"" (Tyrant's Familiar):
        // the trigger is the QUOTED ability, and only exists while you control your commander.
        let triggerClause = clause;
        if (/^lieutenant\b/i.test(clause)) {
          if (!sourceSeat.board.battlefield.some((permanent) => permanent.commander)) continue;
          const quoted = clause.match(/"([^"]+)"/);
          if (!quoted) continue;
          triggerClause = quoted[1];
        }
        // "Whenever this creature attacks, put a +1/+1 counter on it." — "it" is the attacker itself.
        if (/^(?:when|whenever) (?:this creature|[a-z',-]+) (?:attacks|blocks)\b/i.test(triggerClause) && source.id === attack.card.id) {
          triggerClause = triggerClause.replace(/\bon it\b/i, "on this creature");
        }
        const applies = matchWatcherSubject(triggerClause, event, {
          sourceId: source.id,
          sourceName: source.name,
          subject: attack.card,
          subjectIsControlledBySourceController: attack.seatId === sourceSeat.id,
          defendingPlayerIsSourceController: attack.defendingSeatId === sourceSeat.id
        });
        if (applies === false) continue;
        if (applies === undefined) {
          if (sourceSeat.id === attack.seatId && source.id === attack.card.id) unparsed.push({ seatId: sourceSeat.id, source });
          continue;
        }
        let effect = commonTriggerEffect(triggerClause, "clause", undefined, sourceSeat);
        // "..., choose one —" with the modes on the following bullet lines.
        if (!effect && /[—-]\s*$/.test(triggerClause)) {
          const bullets: string[] = [];
          for (const next of sourceClauses.slice(clauseIndex + 1)) {
            if (!/^[•*]/.test(next)) break;
            bullets.push(next);
          }
          const modal = parseGenericModalEffect([triggerClause, ...bullets].join("\n"), undefined);
          if (modal) effect = { kind: "modal", modal };
        }
        // "...attacks for the first time each turn, if it's attacking the player with the most life or tied for most life, ..."
        // (Scourge of the Throne): once per turn per source, and only against a player at the top of the life totals.
        if (/\bfor the first time each turn\b/i.test(triggerClause) && session.onceEachTurnEffectsUsed?.includes(`${session.turn}:${source.id}:first_attack`)) continue;
        if (/\bif it'?s attacking the player with the most life or tied for most life\b/i.test(triggerClause)) {
          const defending = session.seats.find((seat) => seat.id === attack.defendingSeatId);
          if (!defending || !session.seats.filter((seat) => !seat.hasLost).every((seat) => defending.life >= seat.life)) continue;
        }
        // "...attacks while you don't control another Dinosaur, ..." (Pugnacious Hammerskull)
        const noOtherOfType = triggerClause.match(/\bwhile you don'?t control another ([a-z]+)\b/i);
        if (effect && noOtherOfType) effect = { ...effect, condition: { kind: "controls_no_other", subtype: noOtherOfType[1] } };
        if (effect?.kind === "scripted") effect = { ...effect, params: { ...effect.params, defendingSeatId: attack.defendingSeatId } };
        if (effect) {
          triggers.push(makeCommonTrigger(attack.seatId, sourceSeat.id, source, effect, `${source.name} triggers because ${attack.card.name} ${event === "attacks" ? "attacked" : "blocked"}.`, attack.card.id));
        } else if (sourceSeat.id === attack.seatId) {
          unparsed.push({ seatId: sourceSeat.id, source });
        }
      }
    }
  }
  return { triggers, unparsed };
}

export function findCombatDamageToPlayerTriggers(
  session: GameSession,
  dealingSeatId: string,
  dealingCard: VisibleCard,
  damagedSeatId?: string,
  // The combat damage dealt (Balefire Dragon: "that much damage to each creature that player controls").
  damageAmount?: number
): Array<Extract<PendingAction, { type: "trigger" }>> {
  if (!hasCardType(dealingCard, "Creature")) return [];
  const seat = session.seats.find((item) => item.id === dealingSeatId);
  if (!seat) return [];
  const triggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];
  for (const source of seat.board.battlefield) {
      if (!hasActiveAbilities(source)) continue;
    // Renown N (the keyword itself, with its own once-only rule) replaces whatever the reminder text would otherwise parse as.
    const renownMatch = source.id === dealingCard.id && !source.abilitiesStripped ? source.oracleText.match(/^renown (\d+)/im) : null;
    if (renownMatch) {
      if (!source.renowned) triggers.push(makeCommonTrigger(dealingSeatId, seat.id, source, { kind: "renown", amount: Number.parseInt(renownMatch[1], 10) }, `${source.name} triggers (renown).`));
      continue;
    }
    // "Whenever THIS creature deals combat damage to a player" (Liliana's Reaver) only applies to the source's
    // own damage; "a creature you control" (Toski) applies to any. This used to fire for every creature.
    const damageClause = oracleClauses(source.oracleText).find((clause) => /\b(?:when|whenever)\b[^,.]*\bdeals? combat damage to a player\b/i.test(clause));
    const damageSubject = damageClause?.toLowerCase().match(/\b(?:when|whenever)\s+(.+?)\s+deals? combat damage to a player/)?.[1]?.trim();
    // "Whenever an artifact creature you control deals combat damage..." / "one or more artifact creatures you control deal...": the dealer must be that kind.
    const subjectQualifier = damageSubject?.match(/^(?:an?|one or more) ([a-z]+) creatures? you control$/)?.[1];
    if (subjectQualifier && subjectQualifier !== "other") {
      const word = subjectQualifier.startsWith("non") ? subjectQualifier.slice(3) : subjectQualifier;
      const has = word === "token" ? Boolean(dealingCard.token) : hasCardType(dealingCard, capitalizeWord(word)) || dealingCard.typeLine.toLowerCase().includes(word);
      if (subjectQualifier.startsWith("non") ? has : !has) continue;
    }
    const shortName = source.name.toLowerCase().split(" // ")[0].split(",")[0].trim();
    if (damageSubject && (/^this\b/.test(damageSubject) || damageSubject === source.name.toLowerCase() || damageSubject === shortName) && source.id !== dealingCard.id) continue;
    // Old Gnawbone: "...deals combat damage to a player, create that many Treasure tokens." — the damage dealt is the creature's power here.
    if (/\bcreate that many treasure tokens\b/i.test(source.oracleText) && /\bwhenever a creature you control deals combat damage to a player\b/i.test(source.oracleText)) {
      const amount = Math.max(0, effectivePower(dealingCard));
      if (amount > 0) {
        triggers.push(makeCommonTrigger(dealingSeatId, seat.id, source, { kind: "create_tokens", tokens: [{ ...predefinedTokenSpec("Treasure"), count: amount }] }, `${source.name} triggers because ${dealingCard.name} dealt ${amount} combat damage to a player.`));
      }
      continue;
    }
    const rawEffect = commonTriggerEffect(source.oracleText, "combat_damage_to_player");
    const effect = rawEffect && rawEffect.then?.kind === "seat_discards" && damagedSeatId ? { ...rawEffect, then: { ...rawEffect.then, seatId: damagedSeatId } } : rawEffect;
    if (!effect) {
      // "Whenever one or more Dragons you control deal combat damage to an opponent, choose one that hasn't been chosen this turn —"
      // (Parapet Thrasher). The damaged player rides along as the trigger's actor so "each other opponent" can exclude them.
      const sourceClauses = oracleClauses(source.oracleText);
      // "Whenever Rankle deals combat damage to a player, choose any number —": the creature's own trigger.
      if (source.id === dealingCard.id) {
        const ownModal = modalClauseTriggerEffect(source, /^whenever [^,]+ deals combat damage to a player, choose (?:one or more|one or both|any number|up to (?:two|three)|one|two|three)\b.*[—-]\s*$/i);
        if (ownModal) {
          triggers.push(makeCommonTrigger(dealingSeatId, seat.id, source, ownModal, `${source.name} triggers because it dealt combat damage to a player.`));
          continue;
        }
      }
      const groupIndex = sourceClauses.findIndex((clause) => /^whenever one or more [a-z]+s you control deal combat damage to an opponent, choose one\b.*[—-]\s*$/i.test(clause));
      const groupSubject = groupIndex >= 0 ? sourceClauses[groupIndex].match(/^whenever one or more ([a-z]+)s you control/i)?.[1] : undefined;
      if (groupIndex >= 0 && groupSubject && permanentMatchesQualifier(dealingCard, groupSubject)) {
        const bullets: string[] = [];
        for (const next of sourceClauses.slice(groupIndex + 1)) {
          if (!/^[•*]/.test(next)) break;
          bullets.push(next);
        }
        const modal = parseGenericModalEffect([sourceClauses[groupIndex], ...bullets].join("\n"), undefined);
        if (modal) {
          triggers.push(makeCommonTrigger(damagedSeatId ?? dealingSeatId, seat.id, source, { kind: "modal", modal }, `${source.name} triggers because ${dealingCard.name} dealt combat damage to an opponent.`));
        }
      }
      continue;
    }
    if (effect.kind === "scripted") {
      // "one or more Dragons you control" (Zurgo and Ojutai) only counts a Dragon dealing the damage.
      if (effect.script === "look_three_take_one" && !dealingCard.typeLine.toLowerCase().includes(String(effect.params?.subtype ?? ""))) continue;
      triggers.push(makeCommonTrigger(dealingSeatId, seat.id, source, { ...effect, params: { ...effect.params, damagedSeatId, amount: damageAmount ?? Math.max(0, effectivePower(dealingCard)) } }, `${source.name} triggers because ${dealingCard.name} dealt combat damage to a player.`, dealingCard.id));
      continue;
    }
    triggers.push(makeCommonTrigger(dealingSeatId, seat.id, source, effect, `${source.name} triggers because ${dealingCard.name} dealt combat damage to a player.`));
  }
  return triggers;
}

// "Whenever a creature deals combat damage to one of your opponents, its controller may pay 1
// life. If they do, they draw a card." (Gix, Yawgmoth Praetor) — a fully separate, narrow parser
// rather than reusing isCombatDamageToPlayerClause/combatDamageToPlayerEffectText above: that
// matcher requires the literal substring "deals combat damage to a player", which Gix's real text
// ("...to one of your opponents") never contains, so the two shapes can't accidentally double-fire
// off the same clause. Only the exact "pay N life, draw M cards" payoff is recognized; a card with
// this same trigger condition but a different payoff would need its own extension here.
export function parseAnyCreatureCombatDamageToOpponentTrigger(oracleText: string): { lifeCost: number; drawAmount: number } | undefined {
  const clause = oracleClauses(oracleText).find((item) => /^whenever a creature deals combat damage to (?:one of your opponents|an opponent)\b/i.test(item));
  if (!clause) return undefined;
  const match = clause.match(/its controller may pay (\d+) life\.\s*if they do,\s*(?:they draw|draw)\s+(a|one|two|three|four|five|\d+)\s+cards?\b/i);
  if (!match) return undefined;
  const drawAmount = numberWordToInt(match[2]);
  if (!drawAmount) return undefined;
  return { lifeCost: Number.parseInt(match[1], 10), drawAmount };
}

// Gix, Yawgmoth Praetor's trigger is symmetric and board-wide: it watches ANY creature (controlled
// by anyone) dealing combat damage, and only cares whether the DAMAGED player is an opponent of the
// WATCHING seat — completely independent of who controls the attacker. findCombatDamageToPlayerTriggers
// just above is structurally blind to this shape (it only ever scans the dealing creature's own
// controller's battlefield, matching every OTHER real card's self-relative "a creature YOU control"
// wording), so this is its own all-seats scan instead of a case inside that function. The effect
// applies to actorSeatId (the ATTACKING creature's controller — "its controller," not Gix's own),
// which is why this creates an "actor_may_pay_life_to_draw" trigger instead of any of the generic
// kinds above (see that kind's own doc comment for why). Reported live as Gix simply never firing.
export function findAnyCombatDamageToOpponentTriggers(
  session: GameSession,
  dealingSeatId: string,
  dealingCard: VisibleCard,
  damagedSeatId: string
): Array<Extract<PendingAction, { type: "trigger" }>> {
  if (!hasCardType(dealingCard, "Creature")) return [];
  const triggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];
  for (const seat of session.seats) {
    // This app models free-for-all only (no teams) — any other seat is, by definition, an opponent
    // of the watcher, same "every other seat counts as an opponent" convention actionScoring.ts's
    // opponentBattlefields already uses. A watcher can't be triggered by damage dealt to its OWN
    // controller (not an opponent of themselves).
    if (seat.hasLost || seat.id === damagedSeatId) continue;
    for (const source of seat.board.battlefield) {
      if (!hasActiveAbilities(source)) continue;
      const parsed = parseAnyCreatureCombatDamageToOpponentTrigger(source.oracleText);
      if (!parsed) continue;
      triggers.push(
        makeCommonTrigger(
          dealingSeatId,
          seat.id,
          source,
          { kind: "actor_may_pay_life_to_draw", lifeCost: parsed.lifeCost, drawAmount: parsed.drawAmount },
          `${source.name} triggers because ${dealingCard.name} dealt combat damage to an opponent.`
        )
      );
    }
  }
  return triggers;
}

// "Whenever a player attacks one of your opponents, if that opponent has more life than another of
// your opponents, that attacking player draws a card and you put two +1/+1 counters on a creature
// you control." (Breena, the Demagogue) — a fully separate parser from the "whenever you attack a
// player" self-relative shape declareAttack already handles inline: that one only ever scans the
// ATTACKING creature's own controller's battlefield, but Breena watches ANY player's attack against
// ANY of her own controller's opponents, independent of who's attacking. Only the exact "draws a
// card... put N +1/+1 counters on a creature you control" payoff is recognized.
export function parseBreenaAttackTrigger(oracleText: string): { drawAmount: number; counterAmount: number } | undefined {
  const clause = oracleClauses(oracleText).find((item) =>
    /^whenever a player attacks one of your opponents, if that opponent has more life than another of your opponents,/i.test(item)
  );
  if (!clause) return undefined;
  const match = clause.match(/that attacking player draws (a|one|two|three|four|five|\d+) cards?[\s\S]*?you put (a|one|two|three|four|five|\d+) \+1\/\+1 counters? on a creature you control\b/i);
  if (!match) return undefined;
  const drawAmount = numberWordToInt(match[1]);
  const counterAmount = numberWordToInt(match[2]);
  if (!drawAmount || !counterAmount) return undefined;
  return { drawAmount, counterAmount };
}

// Board-wide scan (a sibling to findAnyCombatDamageToOpponentTriggers's own board-wide shape, for
// the same "symmetric, third-party-beneficial trigger" reason) — called once per attack declared
// (from declareAttack, which already knows the attacking seat and the defending seat at the exact
// moment of declaration), checking every OTHER seat's battlefield for a Breena-shaped watcher.
// "if that opponent has more life than another of your opponents" is a genuine multi-seat life
// comparison relative to the WATCHING seat, not the attacker: it only holds when the defending seat
// has strictly more life than at least one OTHER opponent of the watcher (a seat that is neither the
// watcher nor the defender). A watcher with only one opponent total can never satisfy this — there's
// no "another" to compare against. Reported live as Breena never doing anything at all.
export function findBreenaAttackTriggers(session: GameSession, attackingSeatId: string, defendingSeatId: string): Array<Extract<PendingAction, { type: "trigger" }>> {
  const defendingSeat = session.seats.find((seat) => seat.id === defendingSeatId);
  if (!defendingSeat) return [];
  const triggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];
  for (const seat of session.seats) {
    if (seat.hasLost || seat.id === defendingSeatId) continue;
    const hasLowerLifeOtherOpponent = session.seats.some(
      (other) => !other.hasLost && other.id !== seat.id && other.id !== defendingSeatId && other.life < defendingSeat.life
    );
    if (!hasLowerLifeOtherOpponent) continue;
    for (const source of seat.board.battlefield) {
      if (!hasActiveAbilities(source)) continue;
      const parsed = parseBreenaAttackTrigger(source.oracleText);
      if (!parsed) continue;
      triggers.push(
        makeCommonTrigger(
          attackingSeatId,
          seat.id,
          source,
          {
            kind: "actor_draws_cards",
            amount: parsed.drawAmount,
            then: { kind: "add_counter", counterKind: "+1/+1", amount: parsed.counterAmount, scope: "target_creature_you_control" }
          },
          `${source.name} triggers because a player attacked ${defendingSeat.name}, who has more life than another of ${seat.name}'s opponents.`
        )
      );
    }
  }
  return triggers;
}

// "Whenever one or more cards leave your graveyard, ..." (Willow Geist, Insidious Roots) — scans
// only the GRAVEYARD OWNER'S OWN battlefield (the text says "your graveyard," so the watching
// permanent's controller must be the graveyard's own owner, not whoever caused the departure).
export function findCardsLeftGraveyardTriggers(session: GameSession, graveyardSeatId: string): Array<Extract<PendingAction, { type: "trigger" }>> {
  const seat = session.seats.find((item) => item.id === graveyardSeatId);
  if (!seat) return [];
  const triggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];
  for (const source of seat.board.battlefield) {
      if (!hasActiveAbilities(source)) continue;
    const effect = commonTriggerEffect(source.oracleText, "cards_left_graveyard");
    if (!effect) continue;
    triggers.push(makeCommonTrigger(graveyardSeatId, seat.id, source, effect, `${source.name} triggers because one or more cards left ${seat.name}'s graveyard.`));
  }
  return triggers;
}

interface CastTriggerCondition {
  // Relative to the permanent's own controller — "you" only fires when its controller is the
  // caster, "opponent" only fires when the caster is a different seat, "any" (Ledger Shredder's
  // "whenever A PLAYER casts...") fires regardless of who cast it, mirroring how real oracle text is
  // always written relative to whoever controls the triggered ability, not any fixed seat.
  relativity: "you" | "opponent" | "any";
  // "their first spell"/"their second spell"/etc — undefined means no ordinal restriction at all
  // ("whenever you cast a spell,"). 1 for "first", 2 for "second", and so on.
  requiredOrdinal?: number;
  spellTypeFilter?: "noncreature" | "instant_or_sorcery" | "enchantment" | "artifact" | "creature" | "planeswalker" | "land" | "historic";
  // Any other descriptor word before "spell" — a creature subtype ("Zombie spell", Diregraf Colossus) or color,
  // matched with the shared qualifier matcher.
  spellDescriptor?: string;
  // "noncreature or Dragon spell" (Firespitter Whelp): also matches this descriptor (the type filter above is then "noncreature").
  alsoDescriptor?: string;
  effectClause: string;
}

const ORDINAL_WORDS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };

// "Whenever you cast a[n] [type] spell, ..." / "Whenever an opponent casts their first spell each
// turn, ..." / "Whenever an opponent casts their second spell each turn, ..." (Shark Typhoon,
// Murmuring Mystic, Mind's Dilation, Monologue Tax, ...) — a whole category of triggered abilities
// keyed to a spell being cast, distinct from the phase-triggered and ETB/death triggers this engine
// already models. "you"/"an opponent" is read relative to whichever seat controls the permanent
// bearing this text (checked by the caller against the actual caster), not hardcoded to any fixed
// player. The type-word list isn't exhaustive of every possible card type, just every one actually
// seen in this codebase's card pool so far (noncreature/instant-or-sorcery/enchantment/artifact/
// creature/planeswalker/land) — declined rather than guessed at for anything else, same as every
// other parser here.
const CAST_TRIGGER_PATTERN =
  /^whenever (you cast|an opponent casts|a player casts) (?:an?|(?:your|their) (first|second|third|fourth|fifth))\s*((?:instant or sorcery|noncreature or [a-z]+|[a-z]+)\s+)?spells?(?: each turn)?,\s*(.+)$/i;

function parseCastTriggerCondition(clause: string): CastTriggerCondition | undefined {
  const match = clause.match(CAST_TRIGGER_PATTERN);
  if (!match) return undefined;
  const relativity = /^you/i.test(match[1]) ? "you" : /^a player/i.test(match[1]) ? "any" : "opponent";
  const requiredOrdinal = match[2] ? ORDINAL_WORDS[match[2].toLowerCase()] : undefined;
  const typeWord = match[3]?.trim().toLowerCase();
  const orMatch = typeWord?.match(/^noncreature or ([a-z]+)$/);
  if (orMatch) return { relativity, requiredOrdinal, spellTypeFilter: "noncreature", alsoDescriptor: orMatch[1], effectClause: match[4].trim() };
  const spellTypeFilter =
    typeWord === "noncreature" ||
    typeWord === "enchantment" ||
    typeWord === "artifact" ||
    typeWord === "creature" ||
    typeWord === "planeswalker" ||
    typeWord === "land" ||
    typeWord === "historic"
      ? typeWord
      : typeWord === "instant or sorcery"
        ? "instant_or_sorcery"
        : undefined;
  const spellDescriptor = typeWord && !spellTypeFilter && typeWord !== "instant or sorcery" ? typeWord : undefined;
  return { relativity, requiredOrdinal, spellTypeFilter, spellDescriptor, effectClause: match[4].trim() };
}

function spellMatchesCastTriggerFilter(card: VisibleCard, filter: CastTriggerCondition["spellTypeFilter"]): boolean {
  if (filter === "noncreature") return !card.typeLine.includes("Creature");
  if (filter === "instant_or_sorcery") return card.typeLine.includes("Instant") || card.typeLine.includes("Sorcery");
  if (filter === "enchantment") return card.typeLine.includes("Enchantment");
  if (filter === "artifact") return card.typeLine.includes("Artifact");
  if (filter === "creature") return card.typeLine.includes("Creature");
  if (filter === "planeswalker") return card.typeLine.includes("Planeswalker");
  if (filter === "land") return card.typeLine.includes("Land");
  // Historic (Jhoira): artifacts, legendaries and Sagas.
  if (filter === "historic") return hasCardType(card, "Artifact") || card.typeLine.includes("Legendary") || card.typeLine.includes("Saga");
  return true;
}

// "Exile the top card of [that player]'s library. Until end of turn, you may cast that card
// without paying its mana cost if it's a nonland card." (an imperative-mood impulse-draw card) /
// "...that player exiles the top card of their library. If it's a nonland card, you may cast it
// without paying its mana cost." (Mind's Dilation's own third-person phrasing, since it's "that
// player" — the opponent whose spell triggered it — doing the exiling, not "you") — cross-seat and
// cost-waiving in a way no generic TriggerEffect models (see the "impulse_cast_free" kind's own
// comment), so it's detected as its own bespoke shape rather than folded into the generic parsers.
// "exiles?" tolerates both verb conjugations; matching only the imperative "exile" left Mind's
// Dilation's trigger never recognized at all, reported live as it "not triggering."
function isImpulseCastFreeEffectClause(clause: string): boolean {
  return /\bexiles? the top card of (their|your) library\b/i.test(clause) && /\bwithout paying its mana cost\b/i.test(clause) && /\bnonland\b/i.test(clause);
}

export function findCastTriggers(
  session: GameSession,
  casterSeatId: string,
  castCard: VisibleCard,
  castOrdinalThisTurnForCaster: number
): Array<Extract<PendingAction, { type: "trigger" }>> {
  const triggers: Array<Extract<PendingAction, { type: "trigger" }>> = [];

  for (const seat of session.seats) {
    for (const source of seat.board.battlefield) {
      if (!hasActiveAbilities(source)) continue;
      for (const clause of oracleClauses(source.oracleText)) {
        if (isActivatedAbilityClause(clause)) continue;
        const condition = parseCastTriggerCondition(clause);
        if (!condition) continue;
        if (condition.relativity === "you" && seat.id !== casterSeatId) continue;
        if (condition.relativity === "opponent" && seat.id === casterSeatId) continue;
        if (condition.requiredOrdinal !== undefined && condition.requiredOrdinal !== castOrdinalThisTurnForCaster) continue;
        const matchesFilter = spellMatchesCastTriggerFilter(castCard, condition.spellTypeFilter);
        const matchesAlso = condition.alsoDescriptor ? permanentMatchesQualifier(castCard, condition.alsoDescriptor) : false;
        if (!matchesFilter && !matchesAlso) continue;
        if (condition.spellDescriptor && !permanentMatchesQualifier(castCard, condition.spellDescriptor)) continue;
        // "... unless that player pays {N}." (Mystic Remora, Esper Sentinel, ...) is a tax-
        // conditional effect this generic scan has no way to model — the tax itself is dropped, same
        // simplification as everywhere else in this codebase that models a cost as "always paid" or
        // "never paid" rather than as a real choice (see e.g. Gix, Yawgmoth Praetor's own "may pay
        // life" resolution nearby). This USED TO be deferred entirely to a separate function
        // (findTriggeredAbilityForSpell) that ran at the triggering SPELL'S OWN RESOLUTION time
        // instead of at cast time — which meant the trigger only ever fired if the spell that caused
        // it actually resolved. A triggered ability is its own independent object on the stack the
        // instant it triggers (rule 603.3b): countering the spell that caused it doesn't cancel it.
        // Since a countered spell's own resolvePendingAction is never reached at all (it's removed
        // from the stack directly inside the COUNTERING spell's resolution instead), that deferred
        // check never ran, and the trigger silently never fired. Reported live as Esper Sentinel not
        // triggering off an opponent's Grave Pact once the human Countered it. Handled here instead,
        // at the correct (cast) time, so it goes through the exact same commonTriggerEffect fall-
        // through as every other cast trigger below — "draw a card" is still all commonTriggerEffect
        // ever extracts from this clause, so the amount is unaffected; only the TIMING changed.

        if (isImpulseCastFreeEffectClause(condition.effectClause)) {
          triggers.push(
            makeCommonTrigger(casterSeatId, seat.id, source, { kind: "impulse_cast_free", fromSeatId: casterSeatId }, `${source.name} triggers because ${castCard.name} was cast.`)
          );
          continue;
        }

        // "X" in the effect text (Shark Typhoon's "create an X/X ... token, where X is that
        // spell's mana value") means the just-cast spell's own mana value, resolved here since only
        // this scan actually knows which spell was cast — commonTriggerEffect's parsers have no
        // other way to learn it. "A number of ... counters equal to that spell's mana value" (Dusty
        // Parlor) is the same idea spelled out in full instead of abbreviated to a bare "X" — resolved
        // the same way, before the counter-count parser (which only understands a literal number
        // word/digit) ever sees it.
        // Ramos, Dragon Engine: "put a +1/+1 counter on Ramos for each of that spell's colors" (a multicolored spell gives several, colorless none).
        if (/\bput a \+1\/\+1 counter on [^.]+? for each of that spell'?s colors\b/i.test(condition.effectClause)) {
          const colorCount = castCard.colors.length;
          if (colorCount > 0) {
            triggers.push(makeCommonTrigger(casterSeatId, seat.id, source, { kind: "add_counter", counterKind: "+1/+1", amount: colorCount, scope: "self" }, `${source.name} triggers because ${castCard.name} was cast.`));
          }
          continue;
        }
        const effect = commonTriggerEffect(
          substituteManaValueCount(substituteX(condition.effectClause, castCard.manaValue), castCard.manaValue),
          "clause"
        );
        if (!effect) continue;
        triggers.push(makeCommonTrigger(casterSeatId, seat.id, source, effect, `${source.name} triggers because ${castCard.name} was cast.`));
      }
    }
  }

  return triggers;
}

function deathTriggerApplies(source: VisibleCard, sourceSeatId: string, deadCard: VisibleCard, deadSeatId: string, attachedSourceIds?: string[]) {
  const text = source.oracleText.toLowerCase();
  if (!text.includes("dies")) return false;
  // See enteredTriggerApplies: structured subject first (Headless Rider, Midnight Reaper, Open the
  // Graves, Undead Augur, Vengeful Dead — "nontoken", "Zombie", "this creature or another ..."), old
  // heuristics only for clauses it declines.
  const parsedSubject = matchWatcherSubject(source.oracleText, "dies", {
    sourceId: source.id,
    sourceName: source.name,
    subject: deadCard,
    subjectIsControlledBySourceController: deadSeatId === sourceSeatId
  });
  if (parsedSubject !== undefined) return parsedSubject;
  const underYourControl = deadSeatId === sourceSeatId;
  const isAnother = source.id !== deadCard.id;

  // "Whenever this creature or another creature dies, ..." (Blood Artist, and the same
  // aristocrats-drain shape on several other cards) — self-OR-other in one clause, meaning it
  // always applies regardless of whose death it was. Checked before the self-only branch right
  // below (which starts with the same "this ... dies" prefix and would otherwise misread this as
  // self-only, since it has no way to see the "or another" that follows) and before the
  // "another creature dies" branch further down (which would otherwise misread it as other-only
  // and exclude the source's own death) — reported live as Blood Artist never triggering off
  // another creature's death, only its own.
  if (/\b(?:when|whenever)\s+this\b(?:\s+[a-z]+){0,3}\s+or another\b(?:\s+[a-z]+){0,3}\s+dies\b/.test(text)) {
    return text.includes("you control") ? underYourControl : true;
  }

  // Same self-referential-clause fix as enteredTriggerApplies, and for the same reason: "when this
  // creature dies, draw a card" must not also fire when a DIFFERENT creature dies just because the
  // text contains the substring "creature dies".
  if (/\b(when|whenever)\s+this\b.{0,30}\bdies\b/.test(text)) return source.id === deadCard.id;

  // "Whenever equipped/enchanted creature dies, ..." (Skullclamp, ...) refers to whichever specific
  // creature THIS Equipment/Aura was actually attached to — checked before the generic "creature ...
  // dies" fallback below, which would otherwise match the substring "creature dies" inside "equipped
  // creature dies" and fire for every death on the board regardless of whether that creature was ever
  // actually equipped/enchanted by this one. Uses the attachedSourceIds snapshot captured at the
  // moment of death (destroyCreatures), not the live attachedToId — by the time this runs, the same
  // state-based-action pass that recorded the death has already cleared attachedToId on any Equipment
  // whose target is no longer on the battlefield, so the live value is always already gone.
  if (/\b(?:when|whenever)\b(?:(?!\.).){0,30}\b(?:equipped|enchanted) creature dies\b/.test(text)) {
    return attachedSourceIds?.includes(source.id) ?? false;
  }

  // Same "when/whenever must actually precede the phrase" fix as enteredTriggerApplies, and for the
  // same reason: a plain `.includes("creature dies")` also matches non-trigger text that happens to
  // contain that substring anywhere on the card, not just inside an actual "whenever ... dies" clause.
  // "another" tolerates 0-2 qualifier words before "creature" (Grim Haruspex's real text is
  // "another NONTOKEN creature you control dies" — without this, the extra word broke the match
  // entirely, silently falling through to the unqualified "creature ... dies" branch below, which
  // has no self-exclusion at all and let Grim Haruspex's own death satisfy its own "another creature"
  // trigger — the exact bug this fixes).
  // Massacre Wurm: "Whenever a creature an opponent controls dies, ..." fires for every other seat's creatures, never the controller's own.
  if (/\b(?:when|whenever)\b(?:(?!\.).){0,40}\bcreatures? an opponent controls dies\b/.test(text)) return deadSeatId !== sourceSeatId;
  if (/\b(?:when|whenever)\b(?:(?!\.).){0,60}\banother(?:\s+[a-z]+){0,2}\s+creature(?: you control)? dies\b/.test(text)) {
    if (!isAnother) return false;
    return text.includes("you control") ? underYourControl : true;
  }
  if (/\b(?:when|whenever)\b(?:(?!\.).){0,60}\bcreature(?: you control)? dies\b/.test(text)) {
    return text.includes("you control") ? underYourControl : true;
  }
  return false;
}

// "Activate only as a sorcery." (Heliod, the Radiant Dawn's transform ability, and the general rule
// 602.3a templating for any activated ability restricted to sorcery speed) — same generic-limiter
// shape as hasOnceEachTurnLimiter above, checked against legalActivatedAbilityActions' existing
// sorcerySpeedAllowed parameter (already used for equip/loyalty) rather than adding a parallel gate.
export function hasSorcerySpeedOnlyLimiter(clause: string): boolean {
  return /\bactivate only as a sorcery\b|\band only as a sorcery\b/i.test(clause);
}

// Pure half of cycling: pays with untapped mana sources, discards the card, draws one.
// Razorlash Transmogrant: pay the (possibly discounted) cost and return the card from the graveyard to the battlefield.
export function activateGraveyardReturnInSession(session: GameSession, seatId: string, cardId: string): { ok: true; session: GameSession } | { ok: false; message: string } {
  const seat = session.seats.find((item) => item.id === seatId);
  const card = (seat?.board.graveyard ?? []).find((item) => item.id === cardId);
  if (!seat || !card) return { ok: false, message: "That card isn't in your graveyard." };
  const ability = parseGraveyardReturnAbility(card.oracleText);
  if (!ability) return { ok: false, message: `${card.name} has no ability that works from the graveyard.` };
  const nonbasic = (other: PlayerSeat) => other.board.battlefield.filter((permanent) => permanent.typeLine.includes("Land") && !permanent.typeLine.includes("Basic")).length;
  const discounted = ability.discount ? session.seats.some((other) => other.id !== seatId && !other.hasLost && nonbasic(other) >= ability.discount!.nonbasicLands) : false;
  const costText = discounted && ability.discount ? reduceGenericCost(ability.costManaText, ability.discount.amount) : ability.costManaText;
  const total = manaValueFromManaCost(costText);
  const payment = chooseManaSourcesForCost(seat, genericManaAbilityCostShim({ costManaText: costText }), total, undefined, session.seats);
  if (!payment.ok) return { ok: false, message: `${seat.name} can't pay ${costText || "{0}"} to return ${card.name}.` };
  const paid: GameSession = { ...session, seats: session.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item)) };
  const moved = moveCardAcrossSeats(paid, seatId, cardId, seatId, "battlefield");
  if (!moved.movedCard) return { ok: false, message: `${card.name} couldn't be returned.` };
  const withCounter: GameSession = ability.withCounter
    ? {
        ...moved.session,
        seats: moved.session.seats.map((item) =>
          item.id !== seatId ? item : { ...item, board: { ...item.board, battlefield: item.board.battlefield.map((permanent) => (permanent.id === cardId ? applyCounterDelta(permanent, "+1/+1", 1) : permanent)) } }
        )
      }
    : moved.session;
  return { ok: true, session: rulesEvent(withCounter, seatId, `${seat.name} pays ${costText || "{0}"} and returns ${card.name} from the graveyard to the battlefield${ability.withCounter ? " with a +1/+1 counter" : ""}.`) };
}
