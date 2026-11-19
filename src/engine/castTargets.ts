// Cast-time targeting and prompts: spellTargetSlots, nextCastPrompt, labeled target options, agent target choosers for
// removal/zone/pump/extra effects, hasResolvableTarget checks.
// Extracted verbatim from components/AppFlow.tsx; AppFlow.tsx re-exports the previously public symbols.

import { hasPayableAdditionalDiscardCost, hasPayableAdditionalSacrificeCost } from "@/engine/casting";
import { hasHexproof, hasIndestructible, hasShroud, isProtectedFrom, playerHasHexproof } from "@/engine/damage";
import { applyGenericModalEffect, applyRemovalEffect, applySpellExtraEffect, applyTargetedPumpEffect, applyZoneEffect, castTargetLegal, chooseControlTarget, chooseCounterTarget, chooseCreatureCardsFromOwnGraveyard, chooseDamageTarget, chooseGraveyardExileTarget, choosePumpTarget, chooseReanimationTarget, chooseRegrowTarget, chooseRemovalTarget, genericCostShim, genericModalModeHasLegalTarget, greatestCreaturePower, noLegalTargetEvent, parseGenericModalEffect, parseTargetedPump, removalEffectHasLegalTarget, removalModeScore, removalModeViable, resolveDynamicAmount, resolvePreChosenBattlefieldTarget, strongestControlledCreature, substituteX, zoneEffectHasLegalTarget, type GenericModalEffect, type GenericModalMode, type PumpEffect } from "@/engine/effects";
import { chooseAuraAttachTarget } from "@/engine/etb";
import { chooseManaSourcesForCost } from "@/engine/mana";
import { agentPlannedCastChoices, parseEtbZoneEffect, parseSimpleLifeChange } from "@/engine/oneShotEffects";
import { isLandCard } from "@/engine/shared";
import { applyTargetedEffect, pickTargetedEffectTarget } from "@/engine/triggers";
import { type CastChoices, type LabeledContinuation, type LabeledSlot } from "@/engine/types";
import { rulesEvent } from "@/engine/zones";
import { enchantRestriction, isAura } from "@/lib/attachments";
import { effectivePower, effectiveToughness } from "@/lib/counters";
import { etbEffectText, oracleClauses, parseModalHeader, parseSpellModalHeader } from "@/lib/oracleClauses";
import { parseRemovalEffect, type RemovalEffect, type RemovalTargetType } from "@/lib/removalSpells";
import { parseSpellExtraEffects, type SpellExtraEffect } from "@/lib/spellExtras";
import { removalEffectTargetSpec, zoneEffectTargetSpec } from "@/lib/targetSpecs";
import { parseTargetedEffect, targetedEffectSpec, type TargetedEffect } from "@/lib/targetedEffects";
import { legalTargets, type ChosenTarget, type TargetSpec } from "@/lib/targeting";
import { type GameSession, type PlayerSeat, type VisibleCard } from "@/lib/types";
import { parseZoneEffect, type ZoneEffect } from "@/lib/zoneEffects";

export function encodeChosenTarget(target: ChosenTarget): string {
  return target.kind === "player" ? "p:" + target.seatId : "c:" + target.seatId + ":" + target.cardId;
}

// The other permanents still available to sacrifice (God-Eternal Bontu), plus a final "done" entry.
export function sacrificeOptions(seat: PlayerSeat, sourceCardId: string, alreadyPicked: string[]): Array<{ index: number; label: string }> {
  const remaining = seat.board.battlefield.filter((card) => card.id !== sourceCardId && !alreadyPicked.includes(card.id));
  return [...remaining.map((card, index) => ({ index, label: "Sacrifice " + card.name + (card.tapped ? " (tapped)" : "") })), { index: remaining.length, label: alreadyPicked.length === 0 ? "Sacrifice nothing" : "Done (sacrifice " + alreadyPicked.length + ", draw " + alreadyPicked.length + ")" }];
}

// The hand cards still available to discard, plus a final "done" entry (The Elder Dragon War's chapter II).
export function discardOptions(seat: PlayerSeat, alreadyPicked: string[]): Array<{ index: number; label: string }> {
  const remaining = seat.board.hand.filter((card) => !alreadyPicked.includes(card.id));
  return [...remaining.map((card, index) => ({ index, label: "Discard " + card.name })), { index: remaining.length, label: alreadyPicked.length === 0 ? "Discard nothing" : "Done (discard " + alreadyPicked.length + ", draw " + alreadyPicked.length + ")" }];
}

// Applies one SpellExtraEffect (spellExtras.ts) for its caster. Same deterministic, no-target-prompt
// conventions as the rest of this file's removal/pump appliers: the "best" target is picked by
// heuristic for every seat kind (there's no selection UI for these shapes yet).
// The clickable list for one target slot. Opponent-side targets are filtered by hexproof/shroud/protection and player hexproof, like the
// automatic picks are.
// The modes a human may choose between for a cast modal spell, with the removal/generic parse that owns the card. Undefined when the card
// isn't modal, or fewer than two modes are usable (the automatic path then does the one thing that can be done).
export function spellModePrompt(
  session: GameSession,
  controllerSeatId: string,
  source: VisibleCard,
  chosenX?: number
): { chooseCount: number; labels: string[]; removalModes?: Array<Exclude<RemovalEffect, { kind: "modal" }>>; genericModes?: GenericModalMode[]; distinctPerTurn?: boolean } | undefined {
  if (!parseSpellModalHeader(source.oracleText)) return undefined;
  const removal = parseRemovalEffect(etbEffectText(source.oracleText));
  if (removal?.kind === "modal") {
    const modes = removal.modes.filter((mode) => removalEffectHasLegalTarget(session, controllerSeatId, source, mode));
    if (modes.length < 2) return undefined;
    return { chooseCount: Math.min(removal.chooseCount, modes.length), labels: modes.map((mode) => describeRemovalMode(mode)), removalModes: modes };
  }
  if (removal) return undefined;
  const generic = parseGenericModalEffect(source.oracleText, chosenX);
  if (!generic) return undefined;
  const modes = generic.modes.filter((mode) => genericModalModeHasLegalTarget(session, controllerSeatId, mode));
  if (modes.length < 2) return undefined;
  return { chooseCount: Math.min(generic.chooseCount, modes.length), labels: modes.map((mode, index) => mode.text ?? `Mode ${index + 1}`), genericModes: modes, distinctPerTurn: generic.distinctPerTurn };
}

// "Enchant ..." targets of an Aura as it is cast: creatures, lands, "creature, land, or planeswalker", any permanent, or a player (its own controller included).
function auraPrompt(card: VisibleCard, restriction: Extract<CastStructure, { kind: "aura" }>["restriction"]): string {
  const what = restriction === "player" ? "the player to enchant" : restriction === "land" ? "the land to enchant" : restriction === "permanent" ? "the permanent to enchant" : restriction === "creature_land_planeswalker" ? "the creature, land or planeswalker to enchant" : "the creature to enchant" + (restriction === "creature_you_control" ? " (a creature you control)" : "");
  return `${card.name}: choose ${what}.`;
}
export function auraTargetOptions(session: GameSession, seatId: string, restriction: Extract<CastStructure, { kind: "aura" }>["restriction"], card: VisibleCard): LabeledSlot["options"] {
  if (restriction === "creature" || restriction === "creature_you_control") return labeledTargetOptions(session, seatId, restriction === "creature_you_control" ? "own_creature" : "any_creature", card);
  if (restriction === "player") {
    return session.seats.filter((seat) => !seat.hasLost && (seat.id === seatId || !playerHasHexproof(seat))).map((seat) => ({ label: `${seat.name}${seat.id === seatId ? " (you)" : ""} (${seat.life} life)`, target: { kind: "player" as const, seatId: seat.id } }));
  }
  const wanted = (permanent: VisibleCard) => (restriction === "land" ? permanent.typeLine.includes("Land") : restriction === "creature_land_planeswalker" ? /Creature|Land|Planeswalker/.test(permanent.typeLine) : true);
  const options: LabeledSlot["options"] = [];
  for (const seat of session.seats) {
    if (seat.hasLost) continue;
    for (const permanent of seat.board.battlefield) {
      if (permanent.id === card.id || permanent.phasedOut || !wanted(permanent)) continue;
      if (seat.id !== seatId && (hasShroud(permanent) || hasHexproof(permanent) || isProtectedFrom(permanent, card))) continue;
      options.push({ label: `${permanent.name} — ${seat.id === seatId ? "yours" : seat.name}`, target: { kind: "card" as const, seatId: seat.id, cardId: permanent.id } });
    }
  }
  return options.sort((x, y) => Number(x.target.seatId === seatId) - Number(y.target.seatId === seatId)).slice(0, 40);
}

export function labeledTargetOptions(
  session: GameSession,
  controllerSeatId: string,
  slot: "any_damage" | "player" | "own_creature" | "own_permanent" | "any_permanent" | "opponent_creature" | "opponent_creature_or_planeswalker" | "any_creature",
  source: VisibleCard
): LabeledSlot["options"] {
  const options: LabeledSlot["options"] = [];
  const cardLabel = (card: VisibleCard, seat: PlayerSeat) => {
    const stats = card.typeLine.includes("Creature") ? ` (${effectivePower(card)}/${effectiveToughness(card)})` : "";
    return `${card.name}${stats} — ${seat.id === controllerSeatId ? "yours" : seat.name}`;
  };
  const targetable = (card: VisibleCard, seat: PlayerSeat) => seat.id === controllerSeatId || (!hasShroud(card) && !hasHexproof(card) && !isProtectedFrom(card, source));
  for (const seat of session.seats) {
    if (seat.hasLost) continue;
    const own = seat.id === controllerSeatId;
    if (slot === "any_damage" || slot === "player") {
      if (slot === "player" || own || !playerHasHexproof(seat)) {
        if (!own || slot === "any_damage") options.push({ label: `${seat.name} (${seat.life} life)`, target: { kind: "player", seatId: seat.id } });
      }
    }
    for (const card of seat.board.battlefield) {
      const isCreature = card.typeLine.includes("Creature");
      const isPlaneswalker = card.typeLine.includes("Planeswalker");
      const wanted =
        slot === "any_damage" ? isCreature || isPlaneswalker :
        slot === "own_creature" ? own && isCreature :
        slot === "own_permanent" ? own :
        slot === "any_permanent" ? true :
        slot === "any_creature" ? isCreature :
        slot === "opponent_creature" ? !own && isCreature :
        slot === "opponent_creature_or_planeswalker" ? !own && (isCreature || isPlaneswalker) :
        false;
      if (wanted && targetable(card, seat)) options.push({ label: cardLabel(card, seat), target: { kind: "card", seatId: seat.id, cardId: card.id } });
    }
  }
  // Opponents' things first, then by name — the likely choices lead the list; capped so the modal stays usable.
  return options
    .sort((a, b) => Number(a.target.seatId === controllerSeatId) - Number(b.target.seatId === controllerSeatId))
    .slice(0, 16);
}

// ---- Cast-time targeting (rule 601.2c): modes and targets are chosen as the spell is cast, so opponents see them on the stack.

function optionsFromSpec(session: GameSession, seatId: string, spec: TargetSpec, source: VisibleCard): LabeledSlot["options"] {
  return legalTargets(session, seatId, spec, source)
    .map((target) => {
      if (target.kind === "player") {
        const seat = session.seats.find((item) => item.id === target.seatId);
        return { label: `${seat?.name ?? "Player"} (${seat?.life ?? 0} life)`, target: { kind: "player" as const, seatId: target.seatId } };
      }
      const owner = session.seats.find((item) => item.id === target.seatId);
      const stats = target.card.typeLine.includes("Creature") ? ` (${effectivePower(target.card)}/${effectiveToughness(target.card)})` : "";
      const where = spec.zone === "graveyard" ? `${owner?.id === seatId ? "your" : owner?.name + "'s"} graveyard` : owner?.id === seatId ? "yours" : owner?.name;
      return { label: `${target.card.name}${stats} — ${where}`, target: { kind: "card" as const, seatId: target.seatId, cardId: target.card.id } };
    })
    .slice(0, 24);
}

// The target slots one removal-shaped effect (or mode) asks for.
function removalSlots(session: GameSession, seatId: string, source: VisibleCard, effect: RemovalEffect): LabeledSlot[] {
  const named = (prompt: string, options: LabeledSlot["options"]): LabeledSlot[] => [{ prompt: `${source.name}: ${prompt}`, options }];
  switch (effect.kind) {
    case "destroy":
    case "exile":
    case "bounce": {
      const spec = removalEffectTargetSpec(effect, source.id);
      return spec ? named(spec.prompt.replace(/^./, (c) => c.toLowerCase()).replace(/^/, "choose a target — "), optionsFromSpec(session, seatId, spec, source)) : [];
    }
    case "damage": {
      if (effect.targetType === "creature") {
        const spec = removalEffectTargetSpec(effect, source.id);
        return spec ? named("choose a creature to damage.", optionsFromSpec(session, seatId, spec, source)) : [];
      }
      return named("choose a target for the damage.", labeledTargetOptions(session, seatId, effect.targetType === "player" ? "player" : "any_damage", source));
    }
    case "grant_keywords":
      return named("choose a creature you control to gain " + effect.keywords.join(" and ") + " until end of turn.", labeledTargetOptions(session, seatId, "own_creature", source));
    default:
      return [];
  }
}

function zoneSlots(session: GameSession, seatId: string, source: VisibleCard, effect: ZoneEffect): LabeledSlot[] {
  // Victimize: "Choose two target creature cards in your graveyard. Sacrifice a creature. If you do, return the chosen cards ..." —
  // one slot per graveyard target, then the creature to sacrifice (picked up front, since the cast prompt is where the player decides).
  if (effect.kind === "sacrifice_then_reanimate") {
    const owner = session.seats.find((item) => item.id === seatId);
    const graveyardOptions: LabeledSlot["options"] = (owner?.board.graveyard ?? [])
      .filter((card) => card.typeLine.includes("Creature"))
      .map((card) => ({ label: `${card.name} (mana value ${card.manaValue})`, target: { kind: "card" as const, seatId, cardId: card.id } }));
    const slots: LabeledSlot[] = Array.from({ length: effect.targetCount }, (_, index) => ({
      prompt: `${source.name}: choose creature card ${index + 1} of ${effect.targetCount} in your graveyard.`,
      options: graveyardOptions
    }));
    const sacrificeOptions = labeledTargetOptions(session, seatId, "own_creature", source);
    if (sacrificeOptions.length > 0) slots.push({ prompt: `${source.name}: choose the creature you sacrifice when it resolves.`, options: sacrificeOptions });
    return slots;
  }
  const spec = zoneEffectTargetSpec(effect);
  return spec ? [{ prompt: `${source.name}: ${spec.prompt}`, options: optionsFromSpec(session, seatId, spec, source) }] : [];
}

// The spellExtras shapes that name targets as the spell is cast (rule 601.2c): Bite Down's two creatures, Chandra's Ignition's creature, Chaos Warp's
// permanent, "target permanent you control gains ...", and the "target opponent" ones (Consumed by Greed, Secret Rendezvous).
const CAST_TARGETED_EXTRA_KINDS: string[] = ["creature_bites", "grant_keywords", "shuffle_permanent_reveal_top", "creature_damages_everything_else", "opponent_sacrifices_greatest_power", "you_and_opponent_draw"];

type CastStructure =
  | { kind: "removal"; effect: Exclude<RemovalEffect, { kind: "modal" }> }
  | { kind: "removal_modal"; modal: Extract<RemovalEffect, { kind: "modal" }> }
  | { kind: "generic_modal"; modal: GenericModalEffect }
  | { kind: "zone"; effect: ZoneEffect }
  | { kind: "extra"; effect: SpellExtraEffect }
  | { kind: "pump"; effect: PumpEffect }
  | { kind: "targeted"; effect: TargetedEffect }
  // An Aura spell targets as it is CAST (rule 303.4a / 601.2c): "Enchant creature [you control]".
  | { kind: "aura"; restriction: "creature" | "creature_you_control" | "player" | "permanent" | "land" | "creature_land_planeswalker" };

// What a spell does that needs the caster's decisions — only for instants and sorceries (a permanent's enters effect is a trigger, whose
// targets are chosen when it triggers).
export function castStructure(card: VisibleCard, chosenX?: number): CastStructure | undefined {
  if (!card.typeLine.includes("Instant") && !card.typeLine.includes("Sorcery")) {
    if (isAura(card)) {
      const restriction = enchantRestriction(card.oracleText);
      if (restriction && restriction !== "other") return { kind: "aura", restriction };
    }
    return undefined;
  }
  const text = etbEffectText(card.oracleText);
  if (parseModalHeader(card.oracleText)) {
    const removal = parseRemovalEffect(text);
    if (removal?.kind === "modal") return { kind: "removal_modal", modal: removal };
    if (removal) return undefined;
    const generic = parseGenericModalEffect(card.oracleText, chosenX);
    return generic ? { kind: "generic_modal", modal: generic } : undefined;
  }
  const removal = parseRemovalEffect(text);
  if (removal && removal.kind !== "modal") return { kind: "removal", effect: removal };
  const zone = parseZoneEffect(text);
  if (zone) return { kind: "zone", effect: zone };
  const extra = parseSpellExtraEffects(text).find((effect) => CAST_TARGETED_EXTRA_KINDS.includes(effect.kind));
  if (extra) return { kind: "extra", effect: extra };
  const pump = parseTargetedPump(chosenX !== undefined ? substituteX(text, chosenX) : text);
  if (pump) return { kind: "pump", effect: pump };
  const targetedSpell = parseTargetedEffect(text);
  if (targetedSpell) return { kind: "targeted", effect: targetedSpell };
  return undefined;
}

function extraSlots(session: GameSession, seatId: string, source: VisibleCard, effect: SpellExtraEffect): LabeledSlot[] {
  const text = etbEffectText(source.oracleText);
  if (effect.kind === "creature_bites") {
    return [
      { prompt: `${source.name}: choose the creature you control that deals the damage.`, options: labeledTargetOptions(session, seatId, "own_creature", source) },
      { prompt: `${source.name}: choose the creature that takes it.`, options: labeledTargetOptions(session, seatId, /creature or planeswalker you don'?t control/i.test(text) ? "opponent_creature_or_planeswalker" : "opponent_creature", source) }
    ];
  }
  if (effect.kind === "shuffle_permanent_reveal_top") {
    return [{ prompt: `${source.name}: choose the permanent its owner shuffles into their library.`, options: labeledTargetOptions(session, seatId, "any_permanent", source) }];
  }
  if (effect.kind === "grant_keywords") {
    return [{ prompt: `${source.name}: choose a permanent you control to gain ${effect.keywords.join(" and ")} until end of turn.`, options: labeledTargetOptions(session, seatId, "own_permanent", source) }];
  }
  if (effect.kind === "creature_damages_everything_else") {
    return [{ prompt: `${source.name}: choose the creature you control that deals the damage.`, options: labeledTargetOptions(session, seatId, "own_creature", source) }];
  }
  if (effect.kind === "opponent_sacrifices_greatest_power" || effect.kind === "you_and_opponent_draw") {
    return [{ prompt: `${source.name}: choose a target opponent.`, options: labeledTargetOptions(session, seatId, "player", source) }];
  }
  return [];
}

function genericModeSlots(session: GameSession, seatId: string, source: VisibleCard, mode: GenericModalMode): LabeledSlot[] {
  if (mode.kind === "zone") return zoneSlots(session, seatId, source, mode.effect);
  if (mode.kind === "removal") return removalSlots(session, seatId, source, mode.effect);
  if (mode.kind === "pump") return [{ prompt: `${source.name}: choose a creature.`, options: labeledTargetOptions(session, seatId, "any_creature", source) }];
  // One verb on a chosen target (Saheeli's Artistry's token copies): the legal targets of the shared target spec.
  if (mode.kind === "trigger" && mode.effect.kind === "targeted_effect") {
    const spec = targetedEffectSpec(mode.effect.effect, source.id, source.name);
    const options = legalTargets(session, seatId, spec, source).map((target) => {
      if (target.kind === "player") return { label: session.seats.find((seat) => seat.id === target.seatId)?.name ?? "Player", target: { kind: "player" as const, seatId: target.seatId } };
      const owner = session.seats.find((seat) => seat.id === target.seatId);
      return { label: `${target.card.name} — ${owner?.id === seatId ? "yours" : owner?.name ?? ""}`, target: { kind: "card" as const, seatId: target.seatId, cardId: target.card.id } };
    });
    return [{ prompt: `${source.name}: ${spec.prompt}`, options }];
  }
  return [];
}

// The next question to put to the caster, given what they have already answered; undefined when nothing is left to ask.
export function nextCastPrompt(
  session: GameSession,
  seatId: string,
  card: VisibleCard,
  chosenX: number | undefined,
  answers: CastChoices
): { kind: "modes"; prompt: string; options: Array<{ label: string; mode: number }> } | { kind: "target"; prompt: string; options: LabeledSlot["options"] } | undefined {
  const structure = castStructure(card, chosenX);
  if (!structure) return undefined;
  let slots: LabeledSlot[] = [];
  if (structure.kind === "removal_modal" || structure.kind === "generic_modal") {
    const all = structure.kind === "removal_modal" ? structure.modal.modes : structure.modal.modes;
    const viable = all
      .map((mode, index) => ({ mode, index }))
      .filter(({ mode }) => (structure.kind === "removal_modal" ? removalEffectHasLegalTarget(session, seatId, card, mode as Exclude<RemovalEffect, { kind: "modal" }>) : genericModalModeHasLegalTarget(session, seatId, mode as GenericModalMode)));
    const wanted = Math.min(structure.modal.chooseCount, viable.length);
    const picked = answers.modes ?? [];
    // "One or more / one or both": the player may stop early, so even a spell whose every mode is viable asks.
    const atMost = structure.kind === "generic_modal" && Boolean(structure.modal.atMost) && viable.length > 1;
    if (picked.length < wanted && !answers.modesDone) {
      const remaining = viable.filter(({ index }) => !picked.includes(index));
      // Nothing to decide when every viable mode has to be picked anyway.
      if (!atMost && remaining.length === wanted - picked.length) {
        answers.modes = [...picked, ...remaining.map(({ index }) => index)];
      } else {
        const options = remaining.map(({ mode, index }) => ({
          label: structure.kind === "removal_modal" ? describeRemovalMode(mode as Exclude<RemovalEffect, { kind: "modal" }>) : (mode as GenericModalMode).text ?? `Mode ${index + 1}`,
          mode: index
        }));
        if (atMost && picked.length >= 1) options.push({ label: "Done choosing", mode: -1 });
        return {
          kind: "modes",
          prompt: atMost ? `${card.name}: choose a mode (${picked.length} chosen).` : `${card.name}: choose mode ${picked.length + 1} of ${wanted}.`,
          options
        };
      }
    }
    const chosen = answers.modes ?? [];
    slots = chosen.flatMap((index) => (structure.kind === "removal_modal" ? removalSlots(session, seatId, card, structure.modal.modes[index]) : genericModeSlots(session, seatId, card, structure.modal.modes[index] as GenericModalMode)));
  } else if (structure.kind === "removal") {
    slots = removalSlots(session, seatId, card, structure.effect);
  } else if (structure.kind === "zone") {
    slots = zoneSlots(session, seatId, card, structure.effect);
  } else if (structure.kind === "extra") {
    slots = extraSlots(session, seatId, card, structure.effect);
  } else if (structure.kind === "targeted") {
    slots = [{ prompt: `${card.name}: choose a target.`, options: optionsFromSpec(session, seatId, targetedEffectSpec(structure.effect, card.id, card.name), card) }];
  } else if (structure.kind === "aura") {
    slots = [{ prompt: auraPrompt(card, structure.restriction), options: auraTargetOptions(session, seatId, structure.restriction, card) }];
  } else {
    slots = [{ prompt: `${card.name}: choose a creature.`, options: labeledTargetOptions(session, seatId, "any_creature", card) }];
  }
  const slot = slots[answers.targets.length];
  if (!slot || slot.options.length === 0) return undefined;
  // A card already picked for an earlier slot can't be picked again (Victimize's second graveyard creature).
  const alreadyPicked = new Set(answers.targets.flatMap((target) => (target.kind === "card" ? [target.cardId] : [])));
  const options = slot.options.filter((option) => option.target.kind !== "card" || !alreadyPicked.has(option.target.cardId));
  if (options.length === 0) return undefined;
  return { kind: "target", prompt: slot.prompt, options };
}

// A card by id in any visible zone of any seat (battlefield, hand, graveyard, exile, library) — lets the text-option pickers show real card art.
export function findCardAnywhere(session: GameSession, cardId: string, seatId?: string): VisibleCard | undefined {
  for (const seat of seatId ? session.seats.filter((item) => item.id === seatId).concat(session.seats.filter((item) => item.id !== seatId)) : session.seats) {
    const found = [...seat.board.battlefield, ...seat.board.hand, ...(seat.board.graveyard ?? []), ...(seat.board.exile ?? []), ...(seat.library ?? [])].find((card) => card.id === cardId);
    if (found) return found;
  }
  return undefined;
}

// " targeting Grizzly Bears, Sable" for the event log when an agent casts a spell with recorded targets; a countered spell is named too.
// A modal spell also names its chosen modes: " (chooses: Destroy target creature.; Gain 3 life.) targeting ...".
export function stackTargetText(session: GameSession, targets: ChosenTarget[], counteredName?: string, modeLabels: string[] = []): string {
  const modeText = modeLabels.length > 0 ? ` (chooses: ${modeLabels.join("; ")})` : "";
  const names = targets.map((target) => {
    const seat = session.seats.find((item) => item.id === target.seatId);
    if (target.kind === "player") return seat?.name ?? "a player";
    const card = [...(seat?.board.battlefield ?? []), ...(seat?.board.graveyard ?? [])].find((item) => item.id === target.cardId);
    return card ? `${card.name} (${seat?.name ?? "?"}'s)` : "a card";
  });
  if (counteredName) names.push(counteredName);
  return `${modeText}${names.length > 0 ? ` targeting ${names.join(", ")}` : ""}`;
}

// The session as seen by the seat that is about to aim `source`: opposing permanents `source` could never legally target (shroud, hexproof,
// protection) are hidden, so the cast-time pickers below never choose something that would fizzle on resolution.
export function targetableView(session: GameSession, controllerSeatId: string, source: VisibleCard): GameSession {
  return {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === controllerSeatId
        ? seat
        : { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.filter((card) => !hasShroud(card) && !hasHexproof(card) && !isProtectedFrom(card, source)) } }
    )
  };
}

function cardTarget(pick: { seatId: string; card: VisibleCard } | undefined): ChosenTarget | undefined {
  return pick ? { kind: "card", seatId: pick.seatId, cardId: pick.card.id } : undefined;
}

// The opponent a "target player" spell is aimed at: not eliminated, no player hexproof; `prefer` orders the candidates.
function agentOpponentTarget(session: GameSession, seatId: string, prefer: (a: PlayerSeat, b: PlayerSeat) => number): ChosenTarget | undefined {
  const opponents = session.seats.filter((seat) => seat.id !== seatId && !seat.hasLost && !playerHasHexproof(seat)).sort(prefer);
  return opponents[0] ? { kind: "player", seatId: opponents[0].id } : undefined;
}

// One removal-shaped effect (or one mode of a modal) -> the target the agent aims it at; undefined when it needs none or nothing is legal.
// `inModal`: a mode of a modal spell is only taken against opponents (see removalModeViable).
export function agentRemovalEffectTarget(session: GameSession, seatId: string, card: VisibleCard, effect: Exclude<RemovalEffect, { kind: "modal" }>, chosenX: number | undefined, inModal: boolean): ChosenTarget | undefined {
  // Direct damage ("deals 3 damage to any target"): the same deterministic damage chooser resolution used, run as the spell is cast.
  if (effect.kind === "damage") {
    const amount = effect.amount === "X" ? (effect.xDefinition ? resolveDynamicAmount(session, seatId, effect.xDefinition) : chosenX ?? 0) : effect.amount;
    if (amount <= 0) return undefined;
    const aim = chooseDamageTarget(session, seatId, amount, effect.targetType, card);
    if (!aim) return undefined;
    return aim.kind === "player" ? { kind: "player", seatId: aim.seat.id } : { kind: "card", seatId: aim.seatId, cardId: aim.card.id };
  }
  if (effect.kind === "grant_keywords") return cardTarget(chooseCounterTarget(targetableView(session, seatId, card), seatId, "+1/+1", true));
  if (effect.kind === "destroy") {
    return cardTarget(chooseRemovalTarget(session, seatId, effect.targetType, card, effect.excludedColors, effect.artifactsExcluded, effect.basicsExcluded, true, effect.minToughness, inModal ? true : effect.opponentOnly));
  }
  if (effect.kind === "exile" || effect.kind === "bounce") {
    return cardTarget(inModal ? chooseRemovalTarget(session, seatId, effect.targetType, card, [], false, false, false, undefined, true) : chooseRemovalTarget(session, seatId, effect.targetType, card));
  }
  return undefined;
}

// A reanimate/regrow/gain-control/"target player's graveyard" spell: the graveyard card(s), permanent or player it names as it is cast
// (the same deterministic choosers applyZoneEffect used to run only on resolution).
export function agentZoneEffectTargets(session: GameSession, seatId: string, card: VisibleCard, effect: ZoneEffect): ChosenTarget[] | undefined {
  const inGraveyard = (pick: { seatId: string; card: VisibleCard } | undefined): ChosenTarget[] | undefined => (pick ? [{ kind: "card", seatId: pick.seatId, cardId: pick.card.id }] : undefined);
  switch (effect.kind) {
    case "reanimate": {
      const maxManaValue =
        effect.manaValueCeiling === "graveyard_permanent_count"
          ? (session.seats.find((seat) => seat.id === seatId)?.board.graveyard ?? []).filter((item) => !item.typeLine.includes("Instant") && !item.typeLine.includes("Sorcery")).length
          : undefined;
      return inGraveyard(chooseReanimationTarget(session, seatId, effect.anyGraveyard, effect.targetType, maxManaValue));
    }
    case "regrow": {
      const pick = chooseRegrowTarget(session, seatId, effect.targetType, effect.subtype);
      return pick ? [{ kind: "card", seatId, cardId: pick.id }] : undefined;
    }
    case "gain_control": {
      const pick = cardTarget(chooseControlTarget(targetableView(session, seatId, card), seatId));
      return pick ? [pick] : undefined;
    }
    case "mill": {
      if (effect.scope !== "target_player") return undefined;
      const pick = agentOpponentTarget(session, seatId, () => 0);
      return pick ? [pick] : undefined;
    }
    case "graveyard_to_library": {
      if (effect.scope !== "target_player") return undefined;
      const pick = agentOpponentTarget(session, seatId, (a, b) => Number((b.board.graveyard ?? []).length > 0) - Number((a.board.graveyard ?? []).length > 0));
      return pick ? [pick] : undefined;
    }
    case "exile_graveyard": {
      if (effect.scope !== "target_player") return undefined;
      const seatPick = session.seats.find((seat) => seat.id === chooseGraveyardExileTarget(session, seatId));
      return seatPick && (seatPick.id === seatId || !playerHasHexproof(seatPick)) ? [{ kind: "player", seatId: seatPick.id }] : undefined;
    }
    // Victimize: the graveyard creatures it returns (the creature it sacrifices stays an as-it-resolves choice).
    case "sacrifice_then_reanimate": {
      const cards = chooseCreatureCardsFromOwnGraveyard(session, seatId, effect.targetCount);
      return cards ? cards.map((item) => ({ kind: "card" as const, seatId, cardId: item.id })) : undefined;
    }
    default:
      return undefined;
  }
}

// "Target creature gets +X/+X / -X/-X [and gains ...] until end of turn": a buff goes on the agent's own creature, a shrink on an opposing one
// that the spell could legally target.
export function agentPumpTarget(session: GameSession, seatId: string, card: VisibleCard, effect: PumpEffect): ChosenTarget | undefined {
  const pick = choosePumpTarget(targetableView(session, seatId, card), seatId, effect, effect.another ? card.id : undefined);
  if (!pick) return undefined;
  const beneficial = effect.power + effect.toughness >= 0;
  if (beneficial !== (pick.seatId === seatId)) return undefined;
  return cardTarget(pick);
}

// The spellExtras shapes that name targets: Bite Down's dealer + victim, Chandra's Ignition's dealer, "target permanent you control gains ...",
// and the two "target opponent" spells.
function agentExtraEffectTargets(session: GameSession, seatId: string, card: VisibleCard, effect: SpellExtraEffect): ChosenTarget[] | undefined {
  const caster = session.seats.find((seat) => seat.id === seatId);
  const view = targetableView(session, seatId, card);
  switch (effect.kind) {
    case "shuffle_permanent_reveal_top": {
      const pick = chooseRemovalTarget(session, seatId, "nonland_permanent", card) ?? chooseRemovalTarget(session, seatId, "permanent", card);
      const target = cardTarget(pick);
      return target ? [target] : undefined;
    }
    case "creature_bites": {
      const dealer = strongestControlledCreature(caster);
      const power = dealer ? Math.max(0, effectivePower(dealer)) : 0;
      if (!dealer || power <= 0) return undefined;
      const aim = chooseDamageTarget(view, seatId, power, "creature", dealer);
      if (!aim || aim.kind !== "creature") return undefined;
      return [
        { kind: "card", seatId, cardId: dealer.id },
        { kind: "card", seatId: aim.seatId, cardId: aim.card.id }
      ];
    }
    case "creature_damages_everything_else": {
      const dealer = strongestControlledCreature(caster);
      return dealer && effectivePower(dealer) > 0 ? [{ kind: "card", seatId, cardId: dealer.id }] : undefined;
    }
    case "grant_keywords": {
      const target = cardTarget(chooseCounterTarget(view, seatId, "+1/+1", true));
      return target ? [target] : undefined;
    }
    case "opponent_sacrifices_greatest_power": {
      // The opponent whose best creature is the biggest (same threat bias the untargeted pick used).
      const best = (seat: PlayerSeat) => (strongestControlledCreature(seat) ? effectivePower(strongestControlledCreature(seat)!) : -1);
      const pick = agentOpponentTarget(session, seatId, (a, b) => best(b) - best(a));
      const chosen = pick && pick.kind === "player" ? session.seats.find((seat) => seat.id === pick.seatId) : undefined;
      return pick && chosen && best(chosen) >= 0 ? [pick] : undefined;
    }
    case "you_and_opponent_draw": {
      // The weakest (lowest life) opponent, so the symmetric draw doesn't feed the biggest threat.
      const pick = agentOpponentTarget(session, seatId, (a, b) => a.life - b.life);
      return pick ? [pick] : undefined;
    }
    default:
      return undefined;
  }
}

// An agent's modal spell: which modes it takes (the same viability and ordering resolution used) and each taken mode's target, in order.
function agentModalCastChoices(session: GameSession, seatId: string, card: VisibleCard, structure: Extract<CastStructure, { kind: "removal_modal" | "generic_modal" }>, chosenX?: number): CastChoices | undefined {
  const modes: number[] = [];
  const targets: ChosenTarget[] = [];
  if (structure.kind === "removal_modal") {
    const ranked = structure.modal.modes
      .map((mode, index) => ({ mode, index }))
      .filter(({ mode }) => removalModeViable(session, seatId, card, mode))
      .map((entry) => ({ ...entry, score: removalModeScore(session, seatId, entry.mode) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, structure.modal.chooseCount);
    for (const { mode, index } of ranked) {
      if (removalSlots(session, seatId, card, mode).length > 0) {
        const target = agentRemovalEffectTarget(session, seatId, card, mode, chosenX, true);
        if (!target) continue;
        targets.push(target);
      }
      modes.push(index);
    }
  } else {
    const modal = structure.modal;
    const viable = modal.modes
      .map((mode, index) => ({ mode, index }))
      .filter(({ mode, index }) => genericModalModeHasLegalTarget(session, seatId, mode) && !(modal.distinctPerTurn && session.onceEachTurnEffectsUsed?.includes(`${session.turn}:${card.id}:mode:${index}`)))
      .slice(0, modal.chooseCount);
    for (const { mode, index } of viable) {
      if (genericModeSlots(session, seatId, card, mode).length > 0) {
        const target = agentGenericModeTarget(session, seatId, card, mode, chosenX);
        if (!target) continue;
        targets.push(target);
      }
      modes.push(index);
    }
  }
  return modes.length > 0 ? { modes, targets } : undefined;
}

function agentGenericModeTarget(session: GameSession, seatId: string, card: VisibleCard, mode: GenericModalMode, chosenX?: number): ChosenTarget | undefined {
  if (mode.kind === "zone") return agentZoneEffectTargets(session, seatId, card, mode.effect)?.[0];
  if (mode.kind === "removal" && mode.effect.kind !== "modal") return agentRemovalEffectTarget(session, seatId, card, mode.effect, chosenX, true);
  if (mode.kind === "pump") return agentPumpTarget(session, seatId, card, mode.effect);
  if (mode.kind === "trigger" && mode.effect.kind === "targeted_effect") return pickTargetedEffectTarget(session, seatId, card, mode.effect.effect);
  return undefined;
}

// Rule 601.2c: modes and targets are chosen as the spell is cast. An agent's spell used to pick them only as it resolved, so the stack showed
// nothing the human could respond to. Pick them as it is cast instead (the same deterministic choosers resolution used), record them in
// castChoices, and let resolution re-check them (castTargetLegal / applyCast*, rule 608.2b). `card` is the face actually being cast.
// Anything this does not recognise returns undefined and keeps its resolution-time pick.
export function agentCastTimeRemovalChoices(session: GameSession, seatId: string, card: VisibleCard, chosenX?: number): CastChoices | undefined {
  const structure = castStructure(card, chosenX);
  if (!structure) return card.typeLine.includes("Instant") || card.typeLine.includes("Sorcery") ? agentPlannedCastChoices(session, seatId, card) : undefined;
  // An agent's Aura names its creature as it is cast (the same deterministic choice resolution used to make).
  if (structure.kind === "aura") {
    const attach = chooseAuraAttachTarget(session, seatId, card.oracleText);
    return attach.kind === "attach" ? { targets: [{ kind: "card", seatId: attach.seatId, cardId: attach.cardId }] } : undefined;
  }
  // A single-verb targeted spell (tap/untap/counter/copy/gain-keyword effects on a chosen target).
  if (structure.kind === "targeted") {
    const picked = pickTargetedEffectTarget(session, seatId, card, structure.effect);
    return picked ? { targets: [picked] } : undefined;
  }
  if (structure.kind === "removal") {
    const target = agentRemovalEffectTarget(session, seatId, card, structure.effect, chosenX, false);
    return target ? { targets: [target] } : undefined;
  }
  if (structure.kind === "pump") {
    const target = agentPumpTarget(session, seatId, card, structure.effect);
    return target ? { targets: [target] } : undefined;
  }
  if (structure.kind === "zone") {
    const targets = agentZoneEffectTargets(session, seatId, card, structure.effect);
    return targets ? { targets } : undefined;
  }
  if (structure.kind === "extra") {
    const targets = agentExtraEffectTargets(session, seatId, card, structure.effect);
    return targets ? { targets } : undefined;
  }
  return agentModalCastChoices(session, seatId, card, structure, chosenX);
}

// The card as one face of it is cast: a Room door, an Adventure/Omen/split spell half or a modal-DFC's spell face reads as that face's name,
// type line and text (its combined oracle text would otherwise be parsed as a single spell).
export function castFaceCard(card: VisibleCard, face: { name: string; typeLine: string; oracleText: string } | undefined): VisibleCard {
  return face ? { ...card, name: face.name, typeLine: face.typeLine, oracleText: face.oracleText } : card;
}

// "Mode 1; Mode 2" for the log and stack panel: the chosen modes of a modal spell, by the card's own mode text.
export function castModeLabels(card: VisibleCard, chosenX: number | undefined, choices: CastChoices | undefined): string[] {
  if (!choices?.modes?.length) return [];
  const structure = castStructure(card, chosenX);
  if (structure?.kind === "removal_modal") return choices.modes.map((index) => (structure.modal.modes[index] ? describeRemovalMode(structure.modal.modes[index]) : `Mode ${index + 1}`));
  if (structure?.kind === "generic_modal") return choices.modes.map((index) => structure.modal.modes[index]?.text ?? `Mode ${index + 1}`);
  return [];
}

// Applies a removal-shaped effect (or modal's chosen modes) using the targets chosen at cast time; modes/targets that became illegal fizzle.
export function applyCastRemoval(session: GameSession, casterSeatId: string, source: VisibleCard, effect: RemovalEffect, chosenX: number | undefined, choices: CastChoices): GameSession {
  const modes = effect.kind === "modal" ? (choices.modes ?? []).map((index) => effect.modes[index]).filter(Boolean) : [effect];
  let next = session;
  let used = 0;
  for (const mode of modes) {
    const needsTarget = removalSlots(session, casterSeatId, source, mode).length > 0;
    const target = needsTarget ? choices.targets[used++] : undefined;
    if (needsTarget && (!target || !castTargetLegal(next, casterSeatId, source, target))) {
      next = rulesEvent(next, casterSeatId, `${source.name}'s target is no longer legal; that part of the spell does nothing.`);
      continue;
    }
    next = applyRemovalEffect(next, casterSeatId, source.name, source, mode, chosenX, target);
  }
  return next;
}

// Same for a non-removal modal spell's chosen modes.
export function applyCastGenericModes(session: GameSession, casterSeatId: string, source: VisibleCard, modal: GenericModalEffect, choices: CastChoices): GameSession {
  // "Choose one that hasn't been chosen this turn": each mode taken is used up for the turn (applyGenericModalEffect does the same).
  let next: GameSession = modal.distinctPerTurn
    ? { ...session, onceEachTurnEffectsUsed: [...(session.onceEachTurnEffectsUsed ?? []), ...(choices.modes ?? []).map((index) => `${session.turn}:${source.id}:mode:${index}`)] }
    : session;
  let used = 0;
  for (const index of choices.modes ?? []) {
    const mode = modal.modes[index];
    if (!mode) continue;
    const needsTarget = genericModeSlots(session, casterSeatId, source, mode).length > 0;
    const target = needsTarget ? choices.targets[used++] : undefined;
    if (needsTarget && (!target || !castTargetLegal(next, casterSeatId, source, target))) {
      next = rulesEvent(next, casterSeatId, `${source.name}'s target is no longer legal; that mode does nothing.`);
      continue;
    }
    if (mode.kind === "zone") next = applyZoneEffect(next, casterSeatId, source.name, mode.effect, undefined, target);
    else if (mode.kind === "pump") next = applyTargetedPumpEffect(next, casterSeatId, source, mode.effect, target);
    else if (mode.kind === "removal") next = applyRemovalEffect(next, casterSeatId, source.name, source, mode.effect, undefined, target);
    else if (mode.kind === "trigger" && mode.effect.kind === "targeted_effect") next = applyTargetedEffect(next, casterSeatId, source, mode.effect.effect, target);
    else next = applyGenericModalEffect(next, casterSeatId, source, { chooseCount: 1, modes: [mode] });
  }
  return next;
}

// The target slots a human-cast spell needs (Ram Through's two creatures, Tamiyo's Safekeeping's permanent, "any target" damage), or
// undefined when the spell has nothing to choose between.
export function spellTargetSlots(session: GameSession, controllerSeatId: string, source: VisibleCard, chosenX?: number): { slots: LabeledSlot[]; continuation: LabeledContinuation } | undefined {
  const text = etbEffectText(source.oracleText);
  const extra = parseSpellExtraEffects(text).find((effect) => effect.kind === "creature_bites" || effect.kind === "grant_keywords" || effect.kind === "shuffle_permanent_reveal_top" || effect.kind === "creature_damages_everything_else" || effect.kind === "opponent_sacrifices_greatest_power" || effect.kind === "you_and_opponent_draw");
  // Chandra's Ignition: "Target creature you control deals damage equal to its power to each other creature and each opponent."
  if (extra?.kind === "creature_damages_everything_else") {
    const own = labeledTargetOptions(session, controllerSeatId, "own_creature", source);
    if (own.length === 0) return undefined;
    return { slots: [{ prompt: `${source.name}: choose the creature you control that deals the damage.`, options: own }], continuation: { kind: "extra", effect: extra } };
  }
  // Consumed by Greed / Secret Rendezvous: "target opponent".
  if (extra?.kind === "opponent_sacrifices_greatest_power" || extra?.kind === "you_and_opponent_draw") {
    const opponents = labeledTargetOptions(session, controllerSeatId, "player", source);
    if (opponents.length === 0) return undefined;
    return { slots: [{ prompt: `${source.name}: choose a target opponent.`, options: opponents }], continuation: { kind: "extra", effect: extra } };
  }
  if (extra?.kind === "creature_bites") {
    const mine = labeledTargetOptions(session, controllerSeatId, "own_creature", source);
    const theirs = labeledTargetOptions(session, controllerSeatId, /creature or planeswalker you don'?t control/i.test(text) ? "opponent_creature_or_planeswalker" : "opponent_creature", source);
    if (mine.length === 0 || theirs.length === 0) return undefined;
    return {
      slots: [
        { prompt: `${source.name}: choose the creature you control that deals the damage.`, options: mine },
        { prompt: `${source.name}: choose the creature that takes it.`, options: theirs }
      ],
      continuation: { kind: "extra", effect: extra }
    };
  }
  if (extra?.kind === "shuffle_permanent_reveal_top") {
    const all = labeledTargetOptions(session, controllerSeatId, "any_permanent", source);
    if (all.length === 0) return undefined;
    return { slots: [{ prompt: `${source.name}: choose the permanent its owner shuffles into their library.`, options: all }], continuation: { kind: "extra", effect: extra } };
  }
  if (extra?.kind === "grant_keywords") {
    const own = labeledTargetOptions(session, controllerSeatId, "own_permanent", source);
    if (own.length === 0) return undefined;
    return {
      slots: [{ prompt: `${source.name}: choose a permanent you control to gain ${extra.keywords.join(" and ")} until end of turn.`, options: own }],
      continuation: { kind: "extra", effect: extra, lifeAmount: parseSimpleLifeChange(text)?.kind === "gain_life" ? parseSimpleLifeChange(text)!.amount : undefined }
    };
  }
  if (parseModalHeader(source.oracleText)) return undefined;
  const removal = parseRemovalEffect(text);
  if (removal?.kind === "damage" && removal.targetType !== "creature") {
    const options = labeledTargetOptions(session, controllerSeatId, removal.targetType === "player" ? "player" : "any_damage", source);
    if (options.length === 0) return undefined;
    return { slots: [{ prompt: `${source.name}: choose a target for the damage.`, options }], continuation: { kind: "damage", effect: removal, chosenX } };
  }
  return undefined;
}

// Runs a labeled target choice's continuation once the human has answered every slot. A pick that stopped being legal fizzles.
export function applyLabeledContinuation(session: GameSession, controllerSeatId: string, source: VisibleCard, continuation: LabeledContinuation, picks: ChosenTarget[]): GameSession {
  const stillThere = (target: ChosenTarget | undefined) =>
    target?.kind === "player" ? session.seats.some((seat) => seat.id === target.seatId && !seat.hasLost) : target?.kind === "card" ? Boolean(resolvePreChosenBattlefieldTarget(session, target)) : false;
  if (!picks.every(stillThere)) return noLegalTargetEvent(session, controllerSeatId, source.name);
  if (continuation.kind === "damage") return applyRemovalEffect(session, controllerSeatId, source.name, source, continuation.effect, continuation.chosenX, picks[0]);
  let next = applySpellExtraEffect(session, controllerSeatId, source, continuation.effect, undefined, picks);
  if (continuation.lifeAmount) {
    next = rulesEvent({ ...next, seats: next.seats.map((seat) => (seat.id === controllerSeatId ? { ...seat, life: seat.life + continuation.lifeAmount! } : seat)) }, controllerSeatId, `${source.name}: ${next.seats.find((seat) => seat.id === controllerSeatId)?.name ?? "Player"} gains ${continuation.lifeAmount} life.`);
  }
  return next;
}

// Steel Hellkite: the X values worth offering (each distinct mana value among the nonland permanents of players it damaged this turn that the seat can pay for).
export function steelHellkiteXOptions(session: GameSession, seat: PlayerSeat, card: VisibleCard): Array<{ x: number; theirs: number; mine: number; best?: boolean }> {
  const damaged = card.damagedPlayersThisTurn ?? [];
  if (damaged.length === 0 || session.onceEachTurnEffectsUsed?.includes(`${session.turn}:${card.id}:steel_hellkite_x`)) return [];
  const victims = session.seats.filter((other) => damaged.includes(other.id)).flatMap((other) => other.board.battlefield.filter((permanent) => !isLandCard(permanent) && !hasIndestructible(permanent)).map((permanent) => ({ ownerId: other.id, permanent })));
  const values = Array.from(new Set(victims.map((entry) => entry.permanent.manaValue))).sort((a, b) => a - b);
  const worth = (permanent: VisibleCard) => Math.max(1, permanent.manaValue) + Math.max(0, effectivePower(permanent)) / 2;
  const options = values
    .filter((x) => chooseManaSourcesForCost(seat, genericCostShim(x), x, undefined, session.seats).ok)
    .map((x) => {
      const hit = victims.filter((entry) => entry.permanent.manaValue === x);
      const theirs = hit.filter((entry) => entry.ownerId !== seat.id);
      const mine = hit.filter((entry) => entry.ownerId === seat.id);
      return { x, theirs: theirs.length, mine: mine.length, net: theirs.reduce((sum, entry) => sum + worth(entry.permanent), 0) - mine.reduce((sum, entry) => sum + worth(entry.permanent), 0) };
    });
  const top = [...options].sort((a, b) => b.net - a.net)[0];
  return options.map(({ x, theirs, mine, net }) => ({ x, theirs, mine, ...(top && top.net > 0 && net === top.net && x === top.x ? { best: true } : {}) }));
}

// Human-readable label for one mode button in the choose_modal_option modal — generated from the
// already-parsed structured effect rather than threading the card's original bullet text through
// ModalEffect (which only stores the parsed shape, not the source string), so it stays correct even
// though it can't reproduce the card's exact original wording verbatim.
function describeRemovalTargetType(targetType: RemovalTargetType): string {
  return targetType.replace(/_/g, " ");
}

export function describeRemovalMode(mode: Exclude<RemovalEffect, { kind: "modal" }>): string {
  switch (mode.kind) {
    case "destroy":
      return `Destroy target ${describeRemovalTargetType(mode.targetType)}.`;
    case "destroy_up_to_x":
      return `Destroy up to X target ${describeRemovalTargetType(mode.targetType)}.`;
    case "destroy_all":
      return `Destroy all ${mode.excludeType ? `non-${mode.excludeType} ` : ""}${mode.targetType}s.`;
    case "destroy_all_conditional":
      return `Destroy all creatures with mana value ${mode.threshold} or ${mode.comparison === "or_less" ? "less" : "greater"}.`;
    case "exile":
      return `Exile target ${describeRemovalTargetType(mode.targetType)}.`;
    case "bounce":
      return `Return target ${describeRemovalTargetType(mode.targetType)} to its owner's hand.`;
    case "damage":
      return `Deal ${mode.amount} damage to ${mode.targetType === "any" ? "any target" : mode.targetType === "player" ? "target player" : "target creature"}.`;
    case "mass_damage":
      return `Deal ${mode.amount} damage to each ${mode.excludeType ? `non-${mode.excludeType} ` : ""}creature${mode.scope === "opponents" ? " you don't control" : ""}.`;
    case "proliferate":
      return "Proliferate.";
    case "grant_keywords":
      return `Target creature gains ${mode.keywords.join(" and ")} until end of turn.`;
  }
}

// Top-level dispatcher for the generic destroy/exile/damage primitives parsed by
// src/lib/removalSpells.ts. Deliberately narrow, matching that module's scope: multi-target-divided
// damage and non-destroy/exile/damage follow-up effects (Chaos Warp's shuffle-and-reveal, Swords to
// Plowshares' life gain, Beast Within's token) aren't modeled here — parseRemovalEffect already
// declines to match those shapes, so this only ever runs for the plain "destroy/exile/damage a
// target" pattern (or a "choose N" spell built from those patterns) it recognizes.
// Rule 601.2c: a spell that requires a target can't legally be cast at all if no legal target
// exists for it. Without this, legalMainPhaseActions/legalPriorityActions would offer "cast" for a
// removal spell with nothing to destroy/exile/bounce/damage on the board, the agent (or a human)
// would go ahead and cast it, and it would resolve into noLegalTargetEvent's silent whiff at
// resolution time — mirrors the exact same removalEffectHasLegalTarget check applyRemovalEffect
// itself uses below, just run one step earlier, before mana and the card are spent on something
// that can never do anything.
export function hasResolvableRemovalTarget(session: GameSession, casterSeatId: string, card: VisibleCard): boolean {
  const effect = parseRemovalEffect(etbEffectText(card.oracleText));
  if (!effect) return true;
  return removalEffectHasLegalTarget(session, casterSeatId, card, effect);
}

// Same "no legal target = illegal to cast" check as hasResolvableRemovalTarget, for the
// reanimate/regrow/gain_control zone effects that also need one — mill, graveyard_to_library,
// impulse_draw, and steal_and_play are always "legal" to cast even when they'd do little (milling
// an empty library, exiling from an empty-ish deck), so only the genuinely target-dependent kinds
// are checked here.
function hasResolvableZoneEffectTarget(session: GameSession, casterSeatId: string, card: VisibleCard): boolean {
  const effect = parseEtbZoneEffect(etbEffectText(card.oracleText));
  if (!effect) return true;
  return zoneEffectHasLegalTarget(session, casterSeatId, effect);
}

// Aura-based reanimation (Animate Dead, Necromancy, ...) is explicitly out of scope for
// parseZoneEffect (see zoneEffects.ts's file comment) — its ETB trigger text ("Return enchanted
// creature card to the battlefield...") doesn't match that parser's "target creature card"
// phrasing, since an Aura targets via its own "Enchant X" line rather than the spell itself. But an
// Aura's legality to cast still hinges on that Enchant line finding a legal object (rule 303.4c) —
// independent of whatever its ETB trigger does — so this checks that directly rather than needing
// the ETB effect itself to be understood.
function hasResolvableAuraEnchantTarget(session: GameSession, casterSeatId: string, card: VisibleCard): boolean {
  if (!card.typeLine.includes("Aura")) return true;
  const enchantLine = oracleClauses(card.oracleText).find((clause) => /^enchant\b/i.test(clause));
  if (!enchantLine) return true;
  const graveyardEnchant = enchantLine.match(/^enchant creature card in (a|your) graveyard\b/i);
  if (!graveyardEnchant) return true;
  return chooseReanimationTarget(session, casterSeatId, graveyardEnchant[1].toLowerCase() === "a") !== undefined;
}

// Printed text of instants/sorceries the engine has NO deterministic resolution for (checked against every shipped deck). Kept in step with the
// "Human/agent parity gaps" section of docs/agents/system.md and guarded by AppFlow.humanAgentParity.test.ts.
export const AGENT_UNSUPPORTED_SPELL_TEXT: RegExp[] = [
  // Promise of Loyalty: needs a per-creature "can't attack you" restriction that lasts while the vow counter stays.
  /each player puts a vow counter on a creature they control and sacrifices the rest/i,
  // Agadeem's Awakening: any number of targets with pairwise-different mana values.
  /return from your graveyard to the battlefield any number of target creature cards that each have a different mana value/i
];

export function hasResolvableTarget(session: GameSession, casterSeatId: string, card: VisibleCard): boolean {
  // "As an additional cost to cast this spell, sacrifice X creatures." (Immoral Bargain) has no X-choosing cost step here: refuse the cast rather than
  // let it be paid for and then do nothing.
  if (/as an additional cost to cast this spell, sacrifice x creatures/i.test(card.oracleText)) return false;
  // Human/agent parity (docs/agents/system.md, "Human/agent parity gaps"): spells whose resolution no deterministic handler owns. A human resolves them by
  // hand; an agent would pay for them and get nothing, so agents refuse to cast them.
  if (session.seats.find((seat) => seat.id === casterSeatId)?.kind !== "human" && AGENT_UNSUPPORTED_SPELL_TEXT.some((pattern) => pattern.test(card.oracleText))) return false;
  return (
    hasResolvableRemovalTarget(session, casterSeatId, card) &&
    hasResolvableZoneEffectTarget(session, casterSeatId, card) &&
    hasResolvableAuraEnchantTarget(session, casterSeatId, card) &&
    hasResolvableGenericCreatureTarget(session, casterSeatId, card) &&
    hasResolvableSpellExtraTarget(session, casterSeatId, card) &&
    hasPayableAdditionalSacrificeCost(session, casterSeatId, card) &&
    hasPayableAdditionalDiscardCost(session, casterSeatId, card)
  );
}

// "Target creature you control deals damage ..." (Bite Down, Chandra's Ignition) and the other
// spellExtras shapes that need something on the board — casting them with nothing to point at just
// wastes the card (Bite Down fizzled six times in a 40-game self-play batch because the agent cast it
// with no creature of its own).
function hasResolvableSpellExtraTarget(session: GameSession, casterSeatId: string, card: VisibleCard): boolean {
  const caster = session.seats.find((seat) => seat.id === casterSeatId);
  const effects = parseSpellExtraEffects(etbEffectText(card.oracleText));
  const hasOwnAttacker = greatestCreaturePower(caster) > 0;
  const opposingCreature = session.seats.some((seat) => seat.id !== casterSeatId && !seat.hasLost && seat.board.battlefield.some((item) => item.typeLine.includes("Creature")));
  return effects.every((effect) => {
    switch (effect.kind) {
      case "creature_bites": {
        const dealer = strongestControlledCreature(caster);
        return Boolean(dealer) && hasOwnAttacker && chooseDamageTarget(session, casterSeatId, Math.max(0, effectivePower(dealer!)), "creature", dealer!) !== undefined;
      }
      case "creature_damages_everything_else":
        return hasOwnAttacker;
      case "divided_damage_greatest_power":
        return hasOwnAttacker && opposingCreature;
      case "shuffle_permanent_reveal_top":
        return chooseRemovalTarget(session, casterSeatId, "permanent", card) !== undefined;
      case "each_other_player_sacrifices":
      case "opponent_sacrifices_greatest_power":
        return opposingCreature;
      // "Return up to two creature cards from your graveyard to your hand" (Find, Regrowth-style): legal with no target, but an agent would just throw the card
      // away. A human may still cast it (the rules allow zero targets for "up to").
      case "return_creatures_from_graveyard":
        return caster?.kind === "human" || (caster?.board.graveyard ?? []).some((item) => item.typeLine.includes("Creature"));
      default:
        return true;
    }
  });
}

// Fallback for "target creature" spells that aren't a destroy/exile/damage effect (removalSpells.ts)
// or a graveyard-return effect (zoneEffects.ts) — pump spells, protection, Malakir Rebirth-style
// death-ward grants, and the like. Without this, a spell whose entire effect hinges on "target
// creature" with zero creatures anywhere in play (a real turn-1 scenario) still got offered as
// castable, since none of the other three checks recognize this shape and all default to "legal."
// Deliberately narrow: only the plain "target creature[, you control|an opponent controls]" phrasing
// is understood; anything else (planeswalkers, "target creature or player", multiple targets) is left
// alone rather than risk declining a spell that actually does have a legal target.
function hasResolvableGenericCreatureTarget(session: GameSession, casterSeatId: string, card: VisibleCard): boolean {
  if (parseRemovalEffect(etbEffectText(card.oracleText))) return true;
  if (parseEtbZoneEffect(etbEffectText(card.oracleText))) return true;
  if (card.typeLine.includes("Aura")) return true;
  // A modal spell might have a non-targeting mode that's still perfectly castable even when its
  // creature-targeting mode isn't — this checker has no mode-selection logic of its own (unlike
  // removalEffectHasLegalTarget's per-mode filtering), so declining here would risk hiding a
  // genuinely legal cast rather than just failing to catch an illegal one.
  if (parseModalHeader(card.oracleText)) return true;
  const clause = oracleClauses(card.oracleText).find(
    (item) => /\btarget creature\b/i.test(item) && !/\btarget creature (?:card|or )/i.test(item)
  );
  if (!clause) return true;
  const wantsOwn = /\btarget creature you control\b/i.test(clause);
  const wantsOpp = /\btarget creature (?:an opponent controls|you don't control)\b/i.test(clause);
  return session.seats.some((seat) => {
    if (wantsOwn && seat.id !== casterSeatId) return false;
    if (wantsOpp && seat.id === casterSeatId) return false;
    return seat.board.battlefield.some((permanent) => permanent.typeLine.includes("Creature"));
  });
}
