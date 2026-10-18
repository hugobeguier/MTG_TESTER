import { describe, expect, it } from "vitest";
import { scoreLegalActions, type CardLike, type ScorableAction, type ScoringContext } from "@/lib/actionScoring";
import { createSelfPlayGame, playGame } from "./orchestrator";
import { heuristicBrain, type Brain } from "./brains";
import { MistakeRecorder, analyzeDecision, type DecisionPoint, type MistakeCategory } from "./mistakes";

function creature(id: string, name: string, power: string, toughness: string, extra: Partial<CardLike> = {}): CardLike {
  return { id, name, typeLine: "Creature — Test", manaValue: Number(power) + 1, power, toughness, oracleText: "", ...extra };
}
function ctx(purpose: string, phase: string, you: Partial<NonNullable<ScoringContext["you"]>>, opponents: NonNullable<ScoringContext["opponents"]>): ScoringContext {
  return { purpose, turn: 8, phase, you: { id: "me", life: 40, battlefield: [], hand: [], availableMana: { total: 6 }, ...you }, opponents };
}
const pass: ScorableAction = { id: "pass", actionType: "pass_priority", targetIds: [], label: "pass this phase" };
function flagsFor(purpose: string, context: ScoringContext, legalActions: ScorableAction[], chosen: ScorableAction): MistakeCategory[] {
  const point: DecisionPoint = { purpose, context, legalActions };
  return analyzeDecision(point, chosen, scoreLegalActions(legalActions, context)).map((flag) => flag.category);
}
function cast(card: CardLike): ScorableAction {
  return { id: `cast:${card.id}`, actionType: "cast_spell", cardId: card.id, targetIds: [], label: `cast ${card.name}`, detail: `{${card.manaValue}} ${card.typeLine}. ${card.oracleText} Payable with lands.` };
}

describe("mistake detector: decision flags", () => {
  it("flags passing the postcombat main phase with mana open and a castable permanent", () => {
    const golem = creature("g", "Test Golem", "3", "3", { manaValue: 4, typeLine: "Artifact Creature — Golem" });
    const context = ctx("main_phase", "postcombat main phase", { hand: [golem], availableMana: { total: 6 } }, [{ id: "opp", life: 40, battlefield: [] }]);
    expect(flagsFor("main_phase", context, [cast(golem), pass], pass)).toContain("unused_mana_castable_left");
  });

  it("does not flag passing with a sweeper or instant in hand", () => {
    const wrath: CardLike = { id: "w", name: "Wrath", typeLine: "Sorcery", manaValue: 4, oracleText: "Destroy all creatures." };
    const context = ctx("main_phase", "postcombat main phase", { hand: [wrath], availableMana: { total: 6 } }, [{ id: "opp", life: 40, battlefield: [] }]);
    expect(flagsFor("main_phase", context, [cast(wrath), pass], pass)).not.toContain("unused_mana_castable_left");
  });

  it("flags passing with a land drop available", () => {
    const land: ScorableAction = { id: "land", actionType: "play_land", cardId: "forest", targetIds: [], label: "play Forest" };
    const context = ctx("main_phase", "precombat main phase", {}, [{ id: "opp", life: 40, battlefield: [] }]);
    expect(flagsFor("main_phase", context, [land, pass], pass)).toContain("missed_land_drop");
  });

  it("flags tapping out for a non-creature while an opponent's board is lethal", () => {
    const rock: CardLike = { id: "r", name: "Big Rock", typeLine: "Artifact", manaValue: 6, oracleText: "{T}: Add {C}{C}." };
    const wall = [creature("a", "A", "5", "5"), creature("b", "B", "5", "5")];
    const context = ctx("main_phase", "precombat main phase", { life: 8, hand: [rock], availableMana: { total: 6 } }, [{ id: "opp", life: 40, battlefield: wall }]);
    expect(flagsFor("main_phase", context, [cast(rock), pass], cast(rock))).toContain("tapped_out_into_lethal");
  });

  it("flags my own board wipe when I have the stronger board", () => {
    const wrath: CardLike = { id: "w", name: "Wrath of God", typeLine: "Sorcery", manaValue: 4, oracleText: "Destroy all creatures. They can't be regenerated." };
    const mine = [creature("m1", "M1", "5", "5"), creature("m2", "M2", "4", "4")];
    const context = ctx("main_phase", "precombat main phase", { hand: [wrath], battlefield: mine }, [{ id: "opp", life: 40, battlefield: [creature("o", "O", "1", "1")] }]);
    expect(flagsFor("main_phase", context, [cast(wrath), pass], cast(wrath))).toContain("own_wipe_while_ahead");
  });

  it("flags a lone attacker sent into a blocker that kills it and survives", () => {
    const attacker = creature("att", "Attacker", "3", "3");
    const blocker = creature("blk", "Blocker", "5", "5");
    const attack: ScorableAction = { id: "atk", actionType: "attack", cardId: "att", targetIds: ["opp"], label: "attack Opp with Attacker" };
    const context = ctx("declare_attackers", "declare attackers step", { battlefield: [attacker] }, [{ id: "opp", life: 40, battlefield: [blocker] }]);
    expect(flagsFor("declare_attackers", context, [attack, pass], attack)).toContain("suicide_attack");
  });

  it("does not flag a wide attack that the single big blocker cannot eat entirely, nor a flier past ground blockers", () => {
    const a = creature("a1", "A1", "3", "3");
    const b = creature("a2", "A2", "3", "3");
    const blocker = creature("blk", "Blocker", "5", "5");
    const attackA: ScorableAction = { id: "atkA", actionType: "attack", cardId: "a1", targetIds: ["opp"], label: "attack Opp with A1" };
    const attackB: ScorableAction = { id: "atkB", actionType: "attack", cardId: "a2", targetIds: ["opp"], label: "attack Opp with A2" };
    const wide = ctx("declare_attackers", "declare attackers step", { battlefield: [a, b] }, [{ id: "opp", life: 40, battlefield: [blocker] }]);
    expect(flagsFor("declare_attackers", wide, [attackA, attackB, pass], attackA)).not.toContain("suicide_attack");
    const flier = creature("f", "Flier", "3", "3", { oracleText: "Flying" });
    const attackF: ScorableAction = { id: "atkF", actionType: "attack", cardId: "f", targetIds: ["opp"], label: "attack Opp with Flier" };
    const air = ctx("declare_attackers", "declare attackers step", { battlefield: [flier] }, [{ id: "opp", life: 40, battlefield: [blocker] }]);
    expect(flagsFor("declare_attackers", air, [attackF, pass], attackF)).not.toContain("suicide_attack");
  });
});

describe("mistake detector: recorder", () => {
  it("flags the same spell chosen three times in one phase", async () => {
    const recorder = new MistakeRecorder(0, { me: "Me" });
    const imp = creature("imp", "Imp", "1", "1", { typeLine: "Creature — Imp" });
    const action = cast(imp);
    const context = ctx("main_phase", "precombat main phase", { hand: [imp], availableMana: { total: 1 } }, [{ id: "opp", life: 40, battlefield: [] }]);
    const request = { seatId: "me", seatName: "Me", purpose: "main_phase", legalActions: [action, pass] as never, context };
    for (let i = 0; i < 3; i += 1) recorder.observe(request, action.id);
    expect(recorder.log.records.map((record) => record.category)).toContain("repeated_activation");
  });

  it("records a short headless game end to end without changing play", async () => {
    const run = async (wrap: boolean) => {
      const session = createSelfPlayGame({ deckListPaths: ["decks/foundations/WretchedRanks.txt", "decks/foundations/CallingAllAngels.txt"], seatNames: ["A", "B"], forceFirstSeatIndex: 0, seed: 3 });
      const recorder = new MistakeRecorder(0, Object.fromEntries(session.seats.map((seat) => [seat.id, seat.name])));
      const brain: Brain = wrap ? recorder.wrap(heuristicBrain) : heuristicBrain;
      const result = await playGame(session, Object.fromEntries(session.seats.map((seat) => [seat.id, brain])), { turnCap: 6, onAction: recorder.onAction });
      return { recorder, result };
    };
    const { recorder, result } = await run(true);
    expect(recorder.log.decisions).toBeGreaterThan(10);
    expect(result.terminationReason).not.toBe("crash");
    expect(Object.keys(recorder.log.actionsByType).length).toBeGreaterThan(1);
  }, 30000);
});
