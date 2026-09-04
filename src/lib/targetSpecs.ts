// Maps a parsed effect (RemovalEffect / ZoneEffect) onto the shared TargetSpec used by
// src/lib/targeting.ts's legalTargets/targetsStillLegal — the single source of truth for what a
// human may click and for the resolution-time re-check (rule 608.2b). undefined means "not a
// single mandatory-target effect this phase covers": mass effects (destroy_all, mass_damage),
// Proliferate (not targeted at all — rule 121.9 is "choose any number"), modal headers (a mode
// isn't chosen yet when this runs), "any target" damage (needs a combined creature-or-player pool
// this phase doesn't build), and multi-target effects like Victimize's "choose two target creature
// cards" (needs a multi-select UI this phase doesn't build) — all left on the deterministic
// heuristic unchanged, same as every other declared simplification in this codebase.

import type { RemovalEffect } from "./removalSpells";
import type { ZoneEffect, RegrowTargetType } from "./zoneEffects";
import type { TargetSpec } from "./targeting";

function describeTargetType(targetType: string): string {
  return targetType.replace(/_/g, " ");
}

export function removalEffectTargetSpec(effect: RemovalEffect, sourceCardId: string): TargetSpec | undefined {
  switch (effect.kind) {
    case "destroy":
      return {
        id: "target",
        zone: "battlefield",
        permanentType: effect.targetType,
        controller: "any",
        min: 1,
        max: 1,
        excludedCardIds: [sourceCardId],
        excludedColors: effect.excludedColors,
        artifactsExcluded: effect.artifactsExcluded,
        basicsExcluded: effect.basicsExcluded,
        prompt: `Destroy target ${describeTargetType(effect.targetType)}.`
      };
    case "exile":
      return {
        id: "target",
        zone: "battlefield",
        permanentType: effect.targetType,
        controller: "any",
        min: 1,
        max: 1,
        excludedCardIds: [sourceCardId],
        prompt: `Exile target ${describeTargetType(effect.targetType)}.`
      };
    case "bounce":
      return {
        id: "target",
        zone: "battlefield",
        permanentType: effect.targetType,
        controller: "any",
        min: 1,
        max: 1,
        excludedCardIds: [sourceCardId],
        prompt: `Return target ${describeTargetType(effect.targetType)} to its owner's hand.`
      };
    case "damage":
      // "target creature" and "target player" each have a single, simple pool; "any target" (a
      // creature, player, or planeswalker all being legal at once) needs a combined pool this phase
      // doesn't build — left on chooseDamageTarget's heuristic unchanged until that lands.
      if (effect.targetType === "creature") {
        return {
          id: "target",
          zone: "battlefield",
          permanentType: "creature",
          controller: "any",
          min: 1,
          max: 1,
          excludedCardIds: [sourceCardId],
          prompt: `Deal ${effect.amount} damage to target creature.`
        };
      }
      if (effect.targetType === "player") {
        return { id: "target", zone: "player", controller: "any", min: 1, max: 1, prompt: `Deal ${effect.amount} damage to target player.` };
      }
      return undefined;
    default:
      return undefined;
  }
}

// Mirrors RegrowTargetType's overlap with RemovalTargetType (both share the literal strings
// "creature"/"permanent"/"land"/"enchantment"/"artifact") except "card", which has no
// RemovalTargetType equivalent — TargetSpec.permanentType left undefined means "any card", which is
// exactly what "card" (Eternal Witness's real wording: "target card", no restriction) means here.
function regrowPermanentType(targetType: RegrowTargetType): TargetSpec["permanentType"] {
  return targetType === "card" ? undefined : targetType;
}

export function zoneEffectTargetSpec(effect: ZoneEffect): TargetSpec | undefined {
  if (effect.kind === "regrow") {
    return {
      id: "target",
      zone: "graveyard",
      permanentType: regrowPermanentType(effect.targetType),
      controller: "you",
      min: 1,
      max: 1,
      prompt: `Return target ${effect.targetType === "card" ? "card" : describeTargetType(effect.targetType)} from your graveyard to your hand.`
    };
  }
  return undefined;
}
