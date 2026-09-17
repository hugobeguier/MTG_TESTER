import { describe, expect, it } from "vitest";
import { chooseAgentLibraryCardForRuleChoice, shouldConsultRulesAdvisor } from "./AppFlow";
import { deterministicRuleWorkflow } from "@/lib/rulesAdvisor";
import type { PlayerSeat, VisibleCard } from "@/lib/types";

// PendingRuleChoice is a private type inside AppFlow.tsx (not exported) — derived from the
// function's own signature instead, the same way this codebase already avoids hand-copying
// PrimitiveActionStep's JSON schema in cardParser.ts.
type LibraryChoice = Parameters<typeof chooseAgentLibraryCardForRuleChoice>[1];

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "typeLine">): VisibleCard {
  return { oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "library", ...overrides };
}

function seat(overrides: Partial<PlayerSeat> & Pick<PlayerSeat, "id" | "name" | "kind">): PlayerSeat {
  return {
    life: 40,
    commanderDamage: {},
    zones: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield: [] },
    ...overrides
  };
}

// Generic-primitive-resolution proof of concept (experiment/generic-primitive-resolution branch):
// Saga chapter mechanics generalized from Urza's Saga specifically (isUrzaSagaCard === card.name)
// to any real Saga (isSagaCard === typeLine.includes("Saga")), routing each chapter's own effect
// text through this engine's existing generic pipeline instead of bespoke per-card code — see the
// approved plan for the full design. advanceSagaLoreCounters/triggerSagaChapter/
// applySagaEntryLoreCounter themselves are closures inside the AppFlow component (they call
// consultRulesAdvisor/queueCommonTriggers, which read/write component state), so — same as
// advanceUrzaSagaLoreCounters before this refactor — they aren't unit-testable via a plain function
// import the way this file's other tests are; only the exported pure pieces below are covered here.
// parseSagaChapters/parseGainsAbilityGrant are covered in oracleClauses.test.ts, and
// extractManaValueRestriction/deterministicRuleWorkflow's Urza's Saga chapter III classification are
// covered in rulesAdvisor.test.ts — this file's own shouldConsultRulesAdvisor describe block below
// covers the piece that actually wires triggerSagaChapter's saga_chapter event into that workflow.
describe("chooseAgentLibraryCardForRuleChoice — manaValueRestriction (needed for Urza's Saga chapter III to actually behave correctly)", () => {
  function choice(overrides: Partial<LibraryChoice> = {}): LibraryChoice {
    return {
      id: "choice-1",
      kind: "choose_card_from_library",
      controllerSeatId: "p",
      sourceCardId: "urzas-saga",
      sourceCardName: "Urza's Saga",
      prompt: "",
      destination: "battlefield",
      maxChoices: 1,
      allowedCardFilter: "artifact",
      ...overrides
    };
  }

  it("excludes an artifact over the mana-value cap, matching Urza's Saga chapter III's real 'mana cost {0} or {1}' restriction", () => {
    const cheapArtifact = card({ id: "cheap", name: "Cheap Artifact", typeLine: "Artifact", manaValue: 1 });
    const expensiveArtifact = card({ id: "expensive", name: "Expensive Artifact", typeLine: "Artifact", manaValue: 3 });
    const player = seat({ id: "p", name: "You", kind: "agent", library: [expensiveArtifact, cheapArtifact] });
    const result = chooseAgentLibraryCardForRuleChoice(player, choice({ manaValueRestriction: { op: "lte", value: 1 } }));
    expect(result?.id).toBe("cheap");
  });

  it("fails to find (rather than falling back to the wrong-cost card) when nothing in the library meets the restriction", () => {
    const expensiveArtifact = card({ id: "expensive", name: "Expensive Artifact", typeLine: "Artifact", manaValue: 5 });
    const player = seat({ id: "p", name: "You", kind: "agent", library: [expensiveArtifact] });
    const result = chooseAgentLibraryCardForRuleChoice(player, choice({ manaValueRestriction: { op: "lte", value: 1 } }));
    expect(result).toBeUndefined();
  });

  it("is a no-op restriction when unset, unchanged from before this existed", () => {
    const artifact = card({ id: "art", name: "Some Artifact", typeLine: "Artifact", manaValue: 9 });
    const player = seat({ id: "p", name: "You", kind: "agent", library: [artifact] });
    const result = chooseAgentLibraryCardForRuleChoice(player, choice());
    expect(result?.id).toBe("art");
  });
});

// shouldConsultRulesAdvisor's own Saga exclusion (see its doc comment) blocks the whole-card ETB/
// cast events, but triggerSagaChapter's fallback call always passes event "saga_chapter" with
// oracleText already narrowed to one chapter's own clause — without the "saga_chapter" exemption
// this exercises, that call was silently redirected to the weaker LLM-only primitive-action planner
// instead of ever reaching deterministicRuleWorkflow's search_library_to_battlefield workflow (and
// its manaValueRestriction, added specifically for this card), for every real card in this shape —
// including Urza's Saga's own chapter III, the case the whole refactor was built around.
describe("shouldConsultRulesAdvisor — saga_chapter exemption", () => {
  const urzasSaga = card({
    id: "urzas-saga-1",
    name: "Urza's Saga",
    typeLine: "Enchantment Land — Urza's Saga",
    oracleText: "Search your library for an artifact card with mana cost {0} or {1}, put it onto the battlefield, then shuffle."
  });

  it("still declines a Saga on its normal ETB/cast events, unchanged from before this existed", () => {
    expect(shouldConsultRulesAdvisor("land_played", urzasSaga)).toBe(false);
    expect(shouldConsultRulesAdvisor("spell_resolved_to_battlefield", urzasSaga)).toBe(false);
  });

  it("allows a Saga through on its own chapter-scoped event", () => {
    expect(shouldConsultRulesAdvisor("saga_chapter", urzasSaga)).toBe(true);
  });

  it("end to end: a saga_chapter consultation for Urza's Saga's real chapter III text reaches the deterministic search_library_to_battlefield workflow", () => {
    expect(shouldConsultRulesAdvisor("saga_chapter", urzasSaga)).toBe(true);
    const workflow = deterministicRuleWorkflow({
      event: "saga_chapter",
      actorName: "You",
      sourceCard: urzasSaga,
      battlefield: [],
      hand: [],
      graveyard: [],
      exile: [],
      libraryPreview: []
    });
    expect(workflow?.workflow).toBe("search_library_to_battlefield");
    expect(workflow?.manaValueRestriction).toEqual({ op: "lte", value: 1 });
  });
});
