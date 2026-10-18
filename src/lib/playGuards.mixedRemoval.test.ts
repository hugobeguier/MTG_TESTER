import { describe, expect, it } from "vitest";
import { loadCardCatalog, lookupCard } from "./cardCatalog";
import type { CardLike, ScorableAction, ScoringContext } from "./actionScoring";
import { parseTargetedRemoval, removalGuard } from "./playGuards";

// Real Oracle text from the catalog: artifact / enchantment / mixed-type removal needs an OPPOSING legal target, not just any permanent.
const catalog = loadCardCatalog();
function castAction(name: string): ScorableAction {
  const rec = lookupCard(catalog, name)!;
  return { id: `cast:${name}`, actionType: "cast_spell", cardId: `hand-${name}`, targetIds: [], label: `cast ${name}`, detail: `{${rec.manaValue}} ${rec.typeLine}. ${rec.oracleText} Payable with lands.` };
}
function perm(name: string, id: string, extra: Partial<CardLike> = {}): CardLike {
  const rec = lookupCard(catalog, name)!;
  return { id, name, typeLine: rec.typeLine, oracleText: rec.oracleText, manaValue: rec.manaValue, power: rec.power, toughness: rec.toughness, ...extra };
}
function ctx(mine: CardLike[], theirs: CardLike[]): ScoringContext {
  return { purpose: "main_phase", turn: 6, you: { id: "me", life: 40, battlefield: mine, hand: [] }, opponents: [{ id: "opp", life: 40, battlefield: theirs }] };
}

describe("artifact / enchantment / mixed removal (real Oracle text)", () => {
  it("parses the target types", () => {
    expect(parseTargetedRemoval(castAction("Exorcise"))?.types).toEqual(expect.arrayContaining(["artifact", "enchantment", "creature"]));
    expect(parseTargetedRemoval(castAction("Putrefy"))?.types).toEqual(expect.arrayContaining(["artifact", "creature"]));
    expect(parseTargetedRemoval(castAction("Swords to Plowshares"))?.scope).toBe("creature");
  });

  for (const name of ["Exorcise", "Putrefy"]) {
    it(`${name}: held when the opponents control nothing it can hit`, () => {
      const verdict = removalGuard(castAction(name), ctx([perm("Patchwork Banner", "mine")], [perm("Plains", "land")]));
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toMatch(/no opposing/);
    });
  }

  it("Exorcise: allowed with any opposing artifact (the creature threat bar does not apply to artifacts)", () => {
    expect(removalGuard(castAction("Exorcise"), ctx([], [perm("Sol Ring", "ring")])).allowed).toBe(true);
  });

  it("Putrefy: allowed against an opposing creature, still judged by the threat bar for creature-only removal", () => {
    expect(removalGuard(castAction("Putrefy"), ctx([], [perm("Grizzly Bears", "bear", { power: "2", toughness: "2", typeLine: "Creature — Bear" })])).allowed).toBe(true);
  });
});
