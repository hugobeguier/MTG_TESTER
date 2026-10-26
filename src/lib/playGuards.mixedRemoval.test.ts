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

  it("Putrefy: an opposing creature is judged by the creature threat bar (a vanilla bear is held, a big threat is allowed)", () => {
    expect(removalGuard(castAction("Putrefy"), ctx([], [perm("Grizzly Bears", "bear", { power: "2", toughness: "2", typeLine: "Creature — Bear" })])).allowed).toBe(false);
    expect(removalGuard(castAction("Putrefy"), ctx([], [perm("Grave Titan", "titan", { power: "6", toughness: "6", typeLine: "Creature — Giant" })])).allowed).toBe(true);
  });
});

describe("modal and damage removal on tokens (Abrade on a Servo, Bugs2 follow-up)", () => {
  const servo = (): CardLike => ({ id: "servo", name: "Servo Token", typeLine: "Token Artifact Creature — Servo", oracleText: "", manaValue: 0, power: "1", toughness: "1", token: true });
  it("Abrade is recognised as modal removal (it used to be skipped entirely, so nothing guarded it)", () => {
    const spell = parseTargetedRemoval(castAction("Abrade"));
    expect(spell?.modes).toHaveLength(2);
    expect(spell?.modes?.map((mode) => mode.kind)).toEqual(["damage", "destroy"]);
  });
  it("held when the only target is a 1/1 artifact Servo token — both modes could hit it, neither is worth it", () => {
    const verdict = removalGuard(castAction("Abrade"), ctx([], [servo()]));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/removal held/);
  });
  it("allowed when a real target exists next to the Servo (a mana rock via the artifact mode, or a creature the 3 damage kills)", () => {
    expect(removalGuard(castAction("Abrade"), ctx([], [servo(), perm("Sol Ring", "ring")])).allowed).toBe(true);
    const threat = perm("Vampire Nighthawk", "nh", { power: "2", toughness: "3", typeLine: "Creature — Vampire Shaman", oracleText: "Flying\nDeathtouch\nLifelink", manaValue: 3 });
    expect(removalGuard(castAction("Abrade"), ctx([], [servo(), threat])).allowed).toBe(true);
  });
  it("3 damage cannot kill a 6/6, so Abrade is held against it", () => {
    const big = perm("Grave Titan", "titan", { power: "6", toughness: "6", typeLine: "Creature — Giant" });
    expect(removalGuard(castAction("Abrade"), ctx([], [big])).allowed).toBe(false);
  });
  it("Smash to Smithereens (plain destroy-artifact) no longer fires at a Servo token either", () => {
    expect(removalGuard(castAction("Smash to Smithereens"), ctx([], [servo()])).allowed).toBe(false);
    expect(removalGuard(castAction("Smash to Smithereens"), ctx([], [servo(), perm("Sol Ring", "ring")])).allowed).toBe(true);
  });
});
