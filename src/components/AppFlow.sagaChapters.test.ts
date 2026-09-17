import { describe, expect, it } from "vitest";
import { chooseAgentLibraryCardForRuleChoice } from "./AppFlow";
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
// covered in rulesAdvisor.test.ts.
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
