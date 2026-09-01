import { describe, expect, it } from "vitest";
import { chooseAgentLibraryCardForRuleChoice, isAvailableManaSource } from "./AppFlow";
import type { PlayerSeat, VisibleCard } from "@/lib/types";

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "typeLine">): VisibleCard {
  return { oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "battlefield", ...overrides };
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

describe("isAvailableManaSource — summoning sickness", () => {
  const ELVISH_MYSTIC_TEXT = "{T}: Add {G}.";

  it("refuses a freshly entered mana dork with no haste (Elvish Mystic just fetched/played)", () => {
    const dork = card({ id: "dork", name: "Elvish Mystic", typeLine: "Creature — Elf Druid", oracleText: ELVISH_MYSTIC_TEXT, summoningSick: true });
    const player = seat({ id: "p", name: "Player", kind: "agent", board: { hand: [], battlefield: [dork] } });
    expect(isAvailableManaSource(dork, player)).toBe(false);
  });

  it("still allows the same mana dork once summoning sickness has worn off", () => {
    const dork = card({ id: "dork", name: "Elvish Mystic", typeLine: "Creature — Elf Druid", oracleText: ELVISH_MYSTIC_TEXT, summoningSick: false });
    const player = seat({ id: "p", name: "Player", kind: "agent", board: { hand: [], battlefield: [dork] } });
    expect(isAvailableManaSource(dork, player)).toBe(true);
  });

  it("allows a freshly entered mana dork that actually has haste", () => {
    const dork = card({ id: "dork", name: "Fireslinger Elf", typeLine: "Creature — Elf", oracleText: "Haste\n{T}: Add {G}.", summoningSick: true });
    const player = seat({ id: "p", name: "Player", kind: "agent", board: { hand: [], battlefield: [dork] } });
    expect(isAvailableManaSource(dork, player)).toBe(true);
  });

  it("still allows a freshly entered non-creature mana source (a land is never summoning sick)", () => {
    const forest = card({ id: "forest", name: "Forest", typeLine: "Basic Land — Forest" });
    const player = seat({ id: "p", name: "Player", kind: "agent", board: { hand: [], battlefield: [forest] } });
    expect(isAvailableManaSource(forest, player)).toBe(true);
  });
});

describe("chooseAgentLibraryCardForRuleChoice — typed search filter", () => {
  it("picks a Forest over a creature when the search names 'forest' specifically (Three Visits)", () => {
    const mystic = card({ id: "mystic", name: "Elvish Mystic", typeLine: "Creature — Elf Druid" });
    const forest = card({ id: "forest", name: "Forest", typeLine: "Basic Land — Forest" });
    const player = seat({ id: "p", name: "Player", kind: "agent", library: [mystic, forest] });
    const choice = {
      id: "choice-1",
      kind: "choose_card_from_library" as const,
      controllerSeatId: "p",
      sourceCardId: "three-visits",
      sourceCardName: "Three Visits",
      prompt: "Search your library for a Forest card.",
      destination: "battlefield" as const,
      maxChoices: 1,
      allowedCardFilter: "forest"
    };
    const picked = chooseAgentLibraryCardForRuleChoice(player, choice);
    expect(picked?.id).toBe("forest");
  });

  it("still prefers a creature for a fully generic filter with no real type extracted", () => {
    const mystic = card({ id: "mystic", name: "Elvish Mystic", typeLine: "Creature — Elf Druid" });
    const forest = card({ id: "forest", name: "Forest", typeLine: "Basic Land — Forest" });
    const player = seat({ id: "p", name: "Player", kind: "agent", library: [forest, mystic] });
    const choice = {
      id: "choice-2",
      kind: "choose_card_from_library" as const,
      controllerSeatId: "p",
      sourceCardId: "some-tutor",
      sourceCardName: "Some Tutor",
      prompt: "Search your library for a card.",
      destination: "battlefield" as const,
      maxChoices: 1,
      allowedCardFilter: "cards matching the source effect"
    };
    const picked = chooseAgentLibraryCardForRuleChoice(player, choice);
    expect(picked?.id).toBe("mystic");
  });
});
