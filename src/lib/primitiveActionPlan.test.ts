import { describe, expect, it } from "vitest";
import {
  PrimitiveActionPlanSchema,
  PrimitiveActionStepSchema,
  LenientPrimitiveActionStepArraySchema,
  filterGroundedSteps,
  isStepGroundedInText
} from "./primitiveActionPlan";

describe("PrimitiveActionStepSchema", () => {
  it("parses a minimal destroy_target step", () => {
    const step = PrimitiveActionStepSchema.parse({ kind: "destroy_target", targetType: "creature" });
    expect(step.kind).toBe("destroy_target");
    expect(step.targetType).toBe("creature");
  });

  it("accepts a bare { kind } with every other field omitted — the JSON schema only requires kind", () => {
    const step = PrimitiveActionStepSchema.parse({ kind: "mass_bounce" });
    expect(step.kind).toBe("mass_bounce");
    expect(step.amount).toBeUndefined();
  });

  it("coerces a lenient enum field wrapped in stray punctuation/case, same as rulesAdvisor's DestinationSchema", () => {
    const step = PrimitiveActionStepSchema.parse({ kind: "sacrifice_permanent", sacrificeScope: " :Creature_You_Control: " });
    expect(step.sacrificeScope).toBe("creature_you_control");
  });

  it("drops an enum value outside the allowed list instead of throwing", () => {
    const step = PrimitiveActionStepSchema.parse({ kind: "destroy_target", targetType: "spaceship" });
    expect(step.targetType).toBeUndefined();
  });

  it("rejects a kind outside the fixed primitive vocabulary", () => {
    expect(() => PrimitiveActionStepSchema.parse({ kind: "search_library" })).toThrow();
  });

  it("clamps numeric fields to their declared range only via validation, not silent clamping — out-of-range throws", () => {
    expect(() => PrimitiveActionStepSchema.parse({ kind: "draw_cards", amount: 999 })).toThrow();
  });
});

describe("LenientPrimitiveActionStepArraySchema", () => {
  // Reproduced live via the bulk parser's failed_cards.log: the single largest recurring failure
  // pattern is the model inventing a step kind outside the vocabulary ("static", "attach_equipment",
  // "add_mana", "aura", "cast", "search_library", ...) for a shape it should have declined instead —
  // which, with a plain strict z.enum, throws and fails the WHOLE containing steps array even when
  // every other step was valid.
  it("drops a step with an unrecognized kind instead of throwing, keeping the valid steps around it", () => {
    const steps = LenientPrimitiveActionStepArraySchema.parse([
      { kind: "draw_cards", amount: 1 },
      { kind: "static" },
      { kind: "destroy_target", targetType: "creature" }
    ]);
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.kind)).toEqual(["draw_cards", "destroy_target"]);
  });

  it("still throws for a KNOWN kind with a genuinely out-of-range field, same as the strict schema", () => {
    expect(() => LenientPrimitiveActionStepArraySchema.parse([{ kind: "draw_cards", amount: 999 }])).toThrow();
  });

  it("defaults to an empty array when omitted", () => {
    expect(LenientPrimitiveActionStepArraySchema.parse(undefined)).toEqual([]);
  });
});

describe("PrimitiveActionPlanSchema", () => {
  it("defaults summary/declined/steps when omitted, mirroring RuleWorkflowSchema's lenient defaults", () => {
    const plan = PrimitiveActionPlanSchema.parse({});
    expect(plan.summary).toBe("");
    expect(plan.declined).toBe(false);
    expect(plan.steps).toEqual([]);
  });

  it("defaults condition to empty string when omitted", () => {
    const plan = PrimitiveActionPlanSchema.parse({});
    expect(plan.condition).toBe("");
  });

  it("keeps a captured 'if X' condition alongside a non-declined plan with steps", () => {
    const plan = PrimitiveActionPlanSchema.parse({
      declined: false,
      condition: "if you control a commander",
      steps: [{ kind: "draw_cards", amount: 1 }]
    });
    expect(plan.declined).toBe(false);
    expect(plan.condition).toBe("if you control a commander");
    expect(plan.steps).toHaveLength(1);
  });

  it("parses a declined plan with no steps", () => {
    const plan = PrimitiveActionPlanSchema.parse({ declined: true, summary: "not a primitive-shaped effect" });
    expect(plan.declined).toBe(true);
    expect(plan.steps).toEqual([]);
  });

  it("parses a multi-step plan (the Brainstorm shape: draw then move cards back to library top)", () => {
    const plan = PrimitiveActionPlanSchema.parse({
      summary: "Draw 3, put 2 back",
      declined: false,
      steps: [
        { kind: "draw_cards", amount: 3 },
        { kind: "move_card_zone", moveFrom: "hand", moveTo: "library_top", moveFilter: "worst", moveCount: 2 }
      ]
    });
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[1].moveTo).toBe("library_top");
  });
});

describe("filterGroundedSteps", () => {
  // Reproduced live: "When this creature dies, you may draw a card." (Aven Fisher) parsed into a
  // correct draw_cards step AND a fabricated move_card_zone (discard) step with no basis in the
  // text at all — this is the exact regression case that motivated the grounding filter.
  it("drops a step whose kind has no textual basis while keeping a grounded one, matching the Aven Fisher repro", () => {
    const oracleText = "When this creature dies, you may draw a card.";
    const steps = filterGroundedSteps(
      [
        { kind: "draw_cards", amount: 1 },
        { kind: "move_card_zone", moveFrom: "hand", moveTo: "graveyard", moveFilter: "worst", moveCount: 1 }
      ],
      oracleText
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe("draw_cards");
  });

  it("keeps a step whose kind's keyword is present in the text", () => {
    expect(isStepGroundedInText({ kind: "destroy_target", targetType: "creature" }, "Destroy target creature.")).toBe(true);
  });

  it("drops a step whose kind's keyword is absent from the text", () => {
    expect(isStepGroundedInText({ kind: "destroy_target", targetType: "creature" }, "Draw a card.")).toBe(false);
  });

  it("keeps a drain step when the text mentions life (Blood Artist's own shape)", () => {
    expect(isStepGroundedInText({ kind: "drain", amount: 1, drainScope: "target_player" }, "target player loses 1 life and you gain 1 life")).toBe(true);
  });

  it("keeps a damage_target step when the text mentions damage", () => {
    expect(isStepGroundedInText({ kind: "damage_target", amount: 3, damageTargetType: "creature" }, "deals 3 damage to target creature")).toBe(true);
  });

  it("keeps a discard step when the text mentions discard", () => {
    expect(isStepGroundedInText({ kind: "discard", amount: 1, discardScope: "target_player" }, "target player discards a card")).toBe(true);
  });

  // Reproduced live: Duress ("Target opponent reveals their hand. You choose a noncreature,
  // nonland card from it. That player discards that card.") still parsed as a plain unrestricted
  // discard even after the prompt was told to decline this shape — the anti-pattern check is the
  // deterministic backstop for that.
  it("drops a discard step whose text is a reveal-hand-then-choose shape (Duress)", () => {
    expect(
      isStepGroundedInText(
        { kind: "discard", amount: 1, discardScope: "target_player" },
        "Target opponent reveals their hand. You choose a noncreature, nonland card from it. That player discards that card."
      )
    ).toBe(false);
  });

  it("drops a discard step whose text has a type restriction on the discarded card", () => {
    expect(isStepGroundedInText({ kind: "discard", amount: 1, discardScope: "target_player" }, "Target player discards a noncreature card.")).toBe(false);
  });

  it("keeps a tap_target step when the text mentions tap", () => {
    expect(isStepGroundedInText({ kind: "tap_target", targetType: "creature" }, "Tap target creature.")).toBe(true);
  });

  it("keeps an untap_target step when the text mentions untap", () => {
    expect(isStepGroundedInText({ kind: "untap_target", targetType: "permanent" }, "Untap target permanent.")).toBe(true);
  });

  it("drops a tap_target step whose text only mentions untap, not tap", () => {
    expect(isStepGroundedInText({ kind: "tap_target", targetType: "creature" }, "Untap target creature.")).toBe(false);
  });
});
