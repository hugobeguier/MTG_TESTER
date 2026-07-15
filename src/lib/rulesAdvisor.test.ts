import { describe, expect, it } from "vitest";
import { deterministicRuleWorkflow, type RuleAdvisorInput } from "./rulesAdvisor";
import type { VisibleCard } from "./types";

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "oracleText">): VisibleCard {
  return { typeLine: "Sorcery", manaValue: 1, colors: [], role: "spell", zone: "hand", ...overrides };
}

function input(sourceCard: VisibleCard, event = "spell_resolved_to_graveyard"): RuleAdvisorInput {
  return {
    event,
    actorName: "Test Player",
    sourceCard,
    battlefield: [],
    hand: [],
    graveyard: [],
    exile: [],
    libraryPreview: []
  };
}

describe("deterministicRuleWorkflow", () => {
  it("chooses reorder_top_cards for a card that looks at and reorders its top cards before drawing (Ponder)", () => {
    const ponder = card({
      id: "ponder-1",
      name: "Ponder",
      oracleText: "Look at the top three cards of your library, then put them back in any order. You may shuffle.\nDraw a card."
    });
    const workflow = deterministicRuleWorkflow(input(ponder));
    expect(workflow?.workflow).toBe("reorder_top_cards");
    expect(workflow?.maxChoices).toBe(3);
  });

  it("still chooses draw_cards for a plain draw spell with no look/reorder text", () => {
    const divination = card({ id: "divination-1", name: "Divination", oracleText: "Draw two cards." });
    const workflow = deterministicRuleWorkflow(input(divination));
    expect(workflow?.workflow).toBe("draw_cards");
    expect(workflow?.maxChoices).toBe(2);
  });

  it("chooses look_at_top_cards for a look-only effect with no reorder or draw text", () => {
    const peek = card({ id: "peek-1", name: "Peek Effect", oracleText: "Look at the top four cards of target opponent's library." });
    const workflow = deterministicRuleWorkflow(input(peek));
    expect(workflow?.workflow).toBe("look_at_top_cards");
  });

  it("returns no workflow for a check land whose text is only the tapped condition and a mana ability (Isolated Chapel)", () => {
    const isolatedChapel = card({
      id: "isolated-chapel-1",
      name: "Isolated Chapel",
      typeLine: "Land",
      oracleText: "This land enters tapped unless you control a Plains or a Swamp.\n{T}: Add {W} or {B}."
    });
    const workflow = deterministicRuleWorkflow(input(isolatedChapel, "land_played"));
    expect(workflow?.workflow).toBe("none");
  });

  it("does not suppress a land with a genuine extra trigger beyond the tapped condition (Bojuka Bog)", () => {
    const bojukaBog = card({
      id: "bojuka-bog-1",
      name: "Bojuka Bog",
      typeLine: "Land",
      oracleText: "This land enters tapped.\nWhen this land enters, exile target player's graveyard.\n{T}: Add {B}."
    });
    const workflow = deterministicRuleWorkflow(input(bojukaBog, "land_played"));
    expect(workflow?.workflow).not.toBe("none");
  });

  it("does not suppress a tap-land with a genuine reorder trigger (Halimar Depths)", () => {
    const halimarDepths = card({
      id: "halimar-depths-1",
      name: "Halimar Depths",
      typeLine: "Land",
      oracleText: "This land enters tapped.\nWhen this land enters, look at the top three cards of your library, then put them back in any order.\n{T}: Add {U}."
    });
    const workflow = deterministicRuleWorkflow(input(halimarDepths, "land_played"));
    expect(workflow?.workflow).toBe("reorder_top_cards");
  });

  it("does not offer draw_cards when an artifact with a sacrifice-cost draw ability resolves to the battlefield (Mind Stone)", () => {
    const mindStone = card({
      id: "mind-stone-1",
      name: "Mind Stone",
      typeLine: "Artifact",
      oracleText: "{T}: Add {C}.\n{1}, {T}, Sacrifice this artifact: Draw a card."
    });
    const workflow = deterministicRuleWorkflow(input(mindStone, "spell_resolved_to_battlefield"));
    expect(workflow?.workflow).toBe("none");
  });

  it("picks the ETB land-search trigger, not the unrelated dies-triggered draw, when a creature enters (Solemn Simulacrum)", () => {
    const solemnSimulacrum = card({
      id: "solemn-simulacrum-1",
      name: "Solemn Simulacrum",
      typeLine: "Artifact Creature",
      oracleText:
        "When this creature enters, you may search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.\nWhen this creature dies, you may draw a card."
    });
    const enterWorkflow = deterministicRuleWorkflow(input(solemnSimulacrum, "spell_resolved_to_battlefield"));
    expect(enterWorkflow?.workflow).toBe("search_library_to_battlefield");
    expect(enterWorkflow?.tapped).toBe(true);

    const deathWorkflow = deterministicRuleWorkflow(input(solemnSimulacrum, "card_moved_to_graveyard"));
    expect(deathWorkflow?.workflow).toBe("draw_cards");
  });

  it("recognizes a direct-cast proliferate spell and requires no human choice (Contentious Plan)", () => {
    const contentiousPlan = card({
      id: "contentious-plan-1",
      name: "Contentious Plan",
      typeLine: "Sorcery",
      oracleText: "Proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)\nDraw a card."
    });
    const workflow = deterministicRuleWorkflow(input(contentiousPlan, "spell_resolved_to_graveyard"));
    expect(workflow?.workflow).toBe("proliferate");
    expect(workflow?.requiresHumanChoice).toBe(false);
  });
});
