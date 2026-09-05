import { describe, expect, it } from "vitest";
import { costlyTapManaColors, manaAmountFromAddClause } from "./AppFlow";

const ARENA_OF_GLORY_ORACLE_TEXT =
  "This land enters tapped unless you control a Mountain.\n{T}: Add {R}.\n{R}, {T}, Exert this land: Add {R}{R}. If that mana is spent on a creature spell, it gains haste until end of turn. (An exerted permanent won't untap during your next untap step.)";

describe("manaAmountFromAddClause — prefers a free clause over a costlier one on the same card", () => {
  it("Arena of Glory's free {T}: Add {R} wins over its costlier Add {R}{R} exert ability", () => {
    expect(manaAmountFromAddClause(ARENA_OF_GLORY_ORACLE_TEXT)).toBe(1);
  });

  it("Phyrexian Tower has the exact same shape as Arena of Glory and gets the same fix: its free {T}: Add {C} wins over its costlier sacrifice ability, not 2", () => {
    expect(manaAmountFromAddClause("{T}: Add {C}.\n{T}, Sacrifice a creature: Add {B}{B}.")).toBe(1);
  });

  it("Ashnod's Altar (costly, no {T} in its cost at all) still returns 2", () => {
    expect(manaAmountFromAddClause("Sacrifice a creature: Add {C}{C}.")).toBe(2);
  });

  it("a plain single-ability land is unaffected either way", () => {
    expect(manaAmountFromAddClause("{T}: Add {G}.")).toBe(1);
  });
});

describe("costlyTapManaColors — regression guard for the fix this function documents", () => {
  it("Sunken Palace's plain {T}: Add {U} keeps blue free despite its own separate costly blue ability", () => {
    const sunkenPalace = "{T}: Add {U}.\n{1}{U}, {T}, Exile seven cards from your graveyard: Add {U}. Draw a card.";
    expect(costlyTapManaColors(sunkenPalace).has("U")).toBe(false);
  });

  it("Arena of Glory's red stays free (both its abilities produce red)", () => {
    expect(costlyTapManaColors(ARENA_OF_GLORY_ORACLE_TEXT).has("R")).toBe(false);
  });
});
