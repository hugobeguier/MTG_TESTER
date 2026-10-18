import { describe, expect, it } from "vitest";
import { fallbackAction, scoreLegalActions, type CardLike, type ScorableAction, type ScoringContext } from "./actionScoring";
import { wipeScope, wipeSequencingGuard, wipeVictims } from "./wipeSequencing";

// Real Oracle text for the sweepers; boards invented.
const WRATH = "Destroy all creatures. They can't be regenerated.";
const VANDALBLAST = "Destroy target artifact an opponent controls.\nOverload {4}{R} (You may cast this spell for its overload cost. If you do, change its text by replacing all instances of \"target\" with \"each.\")";
const BLASPHEMOUS = "This spell costs {X} less to cast, where X is the greatest power among creatures you control.\nBlasphemous Act deals 13 damage to each creature.";
const TOXIC = "All creatures get -2/-2 until end of turn.";
const POWER_ARTIFACT = "Destroy all artifacts.";

function card(id: string, name: string, typeLine: string, mv: number, power?: string, toughness?: string, extra: Partial<CardLike> = {}): CardLike {
  return { id, name, typeLine, manaValue: mv, power, toughness, oracleText: "", ...extra };
}
function cast(name: string, typeLine: string, mv: number, text: string, id = `hand-${name}`): { action: ScorableAction; card: CardLike } {
  return { card: { id, name, typeLine, manaValue: mv, oracleText: text }, action: { id: `cast:${id}`, actionType: "cast_spell", cardId: id, targetIds: [], label: `cast ${name}`, detail: `{${mv}} ${typeLine}. ${text} Payable with lands.` } };
}
const pass: ScorableAction = { id: "pass", actionType: "pass_priority", targetIds: [], label: "pass" };
function ctx(you: Partial<NonNullable<ScoringContext["you"]>>, theirs: CardLike[]): ScoringContext {
  return { purpose: "main_phase", turn: 7, phase: "precombat main phase", you: { id: "me", life: 40, battlefield: [], hand: [], availableMana: { total: 8 }, ...you }, opponents: [{ id: "opp", life: 40, battlefield: theirs }] };
}
const giants = [card("g1", "Hill Giant", "Creature — Giant", 4, "3", "3"), card("g2", "Hill Giant", "Creature — Giant", 4, "3", "3")];

describe("wipe scope", () => {
  it("recognizes creature sweepers, -X/-X, damage-to-each, and artifact sweepers", () => {
    expect(wipeScope(WRATH)).toBe("creature");
    expect(wipeScope(BLASPHEMOUS)).toBe("creature");
    expect(wipeScope(TOXIC)).toBe("creature");
    expect(wipeScope(POWER_ARTIFACT)).toBe("artifact");
    expect(wipeScope("Counter target spell.")).toBeUndefined();
    expect(wipeScope("Destroy target creature.")).toBeUndefined();
  });
  it("victims follow the scope and skip lands", () => {
    const board = [card("c", "Bear", "Creature — Bear", 2, "2", "2"), card("a", "Sol Ring", "Artifact", 1), card("l", "Forest", "Land", 0)];
    expect(wipeVictims(WRATH, board).map((c) => c.id)).toEqual(["c"]);
    expect(wipeVictims(POWER_ARTIFACT, board).map((c) => c.id)).toEqual(["a"]);
  });
});

describe("wipe after deploying (user report)", () => {
  const wrath = cast("Wrath of God", "Sorcery", 4, WRATH);
  const fresh = card("f", "Test Giant", "Creature — Giant", 5, "4", "4", { enteredTurn: 7, summoningSick: true });

  it("vetoes a marginal wipe that would kill a creature cast this turn", () => {
    expect(wipeSequencingGuard(wrath.action, ctx({ hand: [wrath.card], battlefield: [fresh] }, giants)).allowed).toBe(false);
  });
  it("allows it when the creature was cast on an earlier turn", () => {
    const old = { ...fresh, enteredTurn: 5, summoningSick: false };
    expect(wipeSequencingGuard(wrath.action, ctx({ hand: [wrath.card], battlefield: [old] }, giants)).allowed).toBe(true);
  });
  it("allows it when still clearly net-positive, or when facing lethal", () => {
    const many = [...giants, card("g3", "Hill Giant", "Creature — Giant", 4, "3", "3"), card("g4", "Hill Giant", "Creature — Giant", 4, "3", "3")];
    expect(wipeSequencingGuard(wrath.action, ctx({ hand: [wrath.card], battlefield: [fresh] }, many)).allowed).toBe(true);
    const lethal = [card("b1", "Brute", "Creature — Ogre", 3, "10", "10"), card("b2", "Brute", "Creature — Ogre", 3, "10", "10")];
    expect(wipeSequencingGuard(wrath.action, ctx({ hand: [wrath.card], battlefield: [fresh], life: 8 }, lethal)).allowed).toBe(true);
  });
  it("catches artifact sweepers killing a rock just played", () => {
    const sweeper = cast("Smash", "Sorcery", 3, POWER_ARTIFACT);
    const rock = card("r", "Big Rock", "Artifact", 4, undefined, undefined, { enteredTurn: 7 });
    expect(wipeSequencingGuard(sweeper.action, ctx({ hand: [sweeper.card], battlefield: [rock] }, [card("a2", "Their Rock", "Artifact", 4)])).allowed).toBe(false);
  });
});

describe("creatures wait for the wipe", () => {
  it("ranks the wipe first and the creature below passing while the wipe is castable", () => {
    const wrath = cast("Wrath of God", "Sorcery", 4, WRATH);
    const giant = cast("Test Giant", "Creature — Giant", 5, "");
    giant.card.power = "4";
    giant.card.toughness = "4";
    const context = ctx({ hand: [wrath.card, giant.card], availableMana: { total: 9 } }, giants);
    const scored = scoreLegalActions([giant.action, wrath.action, pass], context);
    expect(scored[0].id).toBe(wrath.action.id);
    const giantScore = scored.find((s) => s.id === giant.action.id)!;
    expect(giantScore.reasons.join(" ")).toMatch(/wipe first/);
    expect(giantScore.score).toBeLessThan(scored.find((s) => s.id === "pass")!.score);
  });
  it("does not hold a creature when the wipe is not worth casting", () => {
    const wrath = cast("Wrath of God", "Sorcery", 4, WRATH);
    const giant = cast("Test Giant", "Creature — Giant", 5, "");
    giant.card.power = "4";
    giant.card.toughness = "4";
    const context = ctx({ hand: [wrath.card, giant.card], availableMana: { total: 9 } }, []);
    expect(fallbackAction(scoreLegalActions([giant.action, pass], context), "t").legalActionId).toBe(giant.action.id);
  });
});

describe("LLM path: an LLM that picks the creature first is overruled", () => {
  it("resolveGuardedChoice replaces the creature with the wipe", async () => {
    const { resolveGuardedChoice } = await import("./actionScoring");
    const wrath = cast("Wrath of God", "Sorcery", 4, WRATH);
    const giant = cast("Test Giant", "Creature — Giant", 5, "");
    giant.card.power = "4";
    giant.card.toughness = "4";
    const scored = scoreLegalActions([giant.action, wrath.action, pass], ctx({ hand: [wrath.card, giant.card], availableMana: { total: 9 } }, giants));
    const decision = resolveGuardedChoice(scored, giant.action.id);
    expect(decision.overridden).toBe(true);
    expect(decision.action?.id).toBe(wrath.action.id);
    expect(decision.reason).toMatch(/cast the wipe first/);
  });
});
