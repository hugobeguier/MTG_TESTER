import { describe, expect, it } from "vitest";
import { removalEffectTargetSpec, zoneEffectTargetSpec } from "./targetSpecs";
import type { RemovalEffect } from "./removalSpells";
import type { ZoneEffect } from "./zoneEffects";

describe("removalEffectTargetSpec", () => {
  it("maps destroy to a battlefield spec excluding the source and honoring exclusions", () => {
    const effect: RemovalEffect = { kind: "destroy", targetType: "creature", excludedColors: ["white"], artifactsExcluded: true, basicsExcluded: false };
    const spec = removalEffectTargetSpec(effect, "src-1");
    expect(spec).toEqual({
      id: "target",
      zone: "battlefield",
      permanentType: "creature",
      controller: "any",
      min: 1,
      max: 1,
      excludedCardIds: ["src-1"],
      excludedColors: ["white"],
      artifactsExcluded: true,
      basicsExcluded: false,
      prompt: "Destroy target creature."
    });
  });

  it("maps exile to a battlefield spec", () => {
    const effect: RemovalEffect = { kind: "exile", targetType: "artifact" };
    const spec = removalEffectTargetSpec(effect, "src-1");
    expect(spec?.zone).toBe("battlefield");
    expect(spec?.permanentType).toBe("artifact");
    expect(spec?.prompt).toBe("Exile target artifact.");
  });

  it("maps bounce to a battlefield spec", () => {
    const effect: RemovalEffect = { kind: "bounce", targetType: "creature_or_planeswalker" };
    const spec = removalEffectTargetSpec(effect, "src-1");
    expect(spec?.zone).toBe("battlefield");
    expect(spec?.prompt).toBe("Return target creature or planeswalker to its owner's hand.");
  });

  it("maps single-target creature damage to a battlefield spec", () => {
    const effect: RemovalEffect = { kind: "damage", amount: 3, targetType: "creature" };
    const spec = removalEffectTargetSpec(effect, "src-1");
    expect(spec?.zone).toBe("battlefield");
    expect(spec?.permanentType).toBe("creature");
  });

  it("maps single-target player damage to a player spec", () => {
    const effect: RemovalEffect = { kind: "damage", amount: 3, targetType: "player" };
    const spec = removalEffectTargetSpec(effect, "src-1");
    expect(spec).toMatchObject({ zone: "player", controller: "any", min: 1, max: 1 });
  });

  it("declines 'any target' damage — needs a combined pool this phase doesn't build", () => {
    const effect: RemovalEffect = { kind: "damage", amount: 3, targetType: "any" };
    expect(removalEffectTargetSpec(effect, "src-1")).toBeUndefined();
  });

  it("declines mass/non-targeted effects", () => {
    expect(removalEffectTargetSpec({ kind: "destroy_all", targetType: "creature", excludedColors: [] }, "src-1")).toBeUndefined();
    expect(removalEffectTargetSpec({ kind: "mass_damage", amount: 2, scope: "all" }, "src-1")).toBeUndefined();
    expect(removalEffectTargetSpec({ kind: "proliferate" }, "src-1")).toBeUndefined();
    expect(removalEffectTargetSpec({ kind: "destroy_all_conditional", threshold: 3, comparison: "or_less" }, "src-1")).toBeUndefined();
  });
});

describe("zoneEffectTargetSpec", () => {
  it("maps regrow with no type restriction ('target card') to an unrestricted graveyard spec", () => {
    const effect: ZoneEffect = { kind: "regrow", targetType: "card" };
    const spec = zoneEffectTargetSpec(effect);
    expect(spec).toEqual({
      id: "target",
      zone: "graveyard",
      permanentType: undefined,
      controller: "you",
      min: 1,
      max: 1,
      prompt: "Return target card from your graveyard to your hand."
    });
  });

  it("maps a type-restricted regrow to a permanentType-filtered graveyard spec", () => {
    const effect: ZoneEffect = { kind: "regrow", targetType: "enchantment" };
    const spec = zoneEffectTargetSpec(effect);
    expect(spec?.permanentType).toBe("enchantment");
    expect(spec?.prompt).toBe("Return target enchantment from your graveyard to your hand.");
  });

  it("declines effects this phase doesn't cover", () => {
    expect(zoneEffectTargetSpec({ kind: "reanimate", anyGraveyard: true, targetType: "creature" })).toBeUndefined();
    expect(zoneEffectTargetSpec({ kind: "gain_control", untilEndOfTurn: false })).toBeUndefined();
    expect(zoneEffectTargetSpec({ kind: "mill", amount: 3, scope: "you" })).toBeUndefined();
  });
});
