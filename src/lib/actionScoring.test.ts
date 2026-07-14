import { describe, expect, it } from "vitest";
import { scoreLegalAction, scoreLegalActions, type CardLike, type ScorableAction, type ScoringContext } from "./actionScoring";

function action(overrides: Partial<ScorableAction> & Pick<ScorableAction, "id" | "actionType">): ScorableAction {
  return { targetIds: [], label: overrides.id, ...overrides };
}

function baseContext(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return { turn: 1, you: { life: 40, battlefield: [], hand: [] }, opponents: [], ...overrides };
}

describe("scoreLegalActions", () => {
  it("ranks playing a land above a middling spell early on", () => {
    const actions = [
      action({ id: "cast:x", actionType: "cast_spell", role: "creature" }),
      action({ id: "play-land:y", actionType: "play_land", role: "land" })
    ];
    const scored = scoreLegalActions(actions, baseContext());
    expect(scored[0].id).toBe("play-land:y");
  });

  it("scores ramp higher early in the game than later", () => {
    const rampAction = action({ id: "cast:ramp", actionType: "cast_spell", role: "ramp" });
    const early = scoreLegalAction(rampAction, baseContext({ turn: 2 }));
    const late = scoreLegalAction(rampAction, baseContext({ turn: 12 }));
    expect(early.score).toBeGreaterThan(late.score);
  });

  it("rewards removal aimed at the biggest threat and penalizes removal on a minor permanent", () => {
    const bigThreat: CardLike = { id: "big", power: "10", toughness: "10" };
    const smallThreat: CardLike = { id: "small", power: "1", toughness: "1" };
    const context = baseContext({ opponents: [{ id: "opp", battlefield: [bigThreat, smallThreat] }] });

    const removeBig = scoreLegalAction(
      action({ id: "cast:removal-big", actionType: "cast_spell", role: "removal", targetIds: ["big"] }),
      context
    );
    const removeSmall = scoreLegalAction(
      action({ id: "cast:removal-small", actionType: "cast_spell", role: "removal", targetIds: ["small"] }),
      context
    );
    expect(removeBig.score).toBeGreaterThan(removeSmall.score);
  });

  it("favors attacking when there are no untapped potential blockers", () => {
    const attacker: CardLike = { id: "atk", power: "3", toughness: "3" };
    const noBlockers = scoreLegalAction(
      action({ id: "attack:atk", actionType: "attack", cardId: "atk" }),
      baseContext({ you: { battlefield: [attacker] }, opponents: [{ battlefield: [] }] })
    );
    const bigBlocker: CardLike = { id: "blk", power: "6", toughness: "6", tapped: false };
    const withBadBlocker = scoreLegalAction(
      action({ id: "attack:atk", actionType: "attack", cardId: "atk" }),
      baseContext({ you: { battlefield: [attacker] }, opponents: [{ battlefield: [bigBlocker] }] })
    );
    expect(noBlockers.score).toBeGreaterThan(withBadBlocker.score);
  });

  it("prefers holding instants when the stack is empty during priority", () => {
    const respond = action({ id: "respond:x", actionType: "cast_spell" });
    const pass = action({ id: "pass-priority", actionType: "pass_priority" });
    const context = baseContext({ purpose: "priority_response", stack: [] });
    const respondScore = scoreLegalAction(respond, context).score;
    const passScore = scoreLegalAction(pass, context).score;
    expect(passScore).toBeGreaterThan(respondScore);
  });

  it("prefers responding when there is something on the stack to answer", () => {
    const respond = action({ id: "respond:x", actionType: "cast_spell" });
    const emptyStack = scoreLegalAction(respond, baseContext({ purpose: "priority_response", stack: [] })).score;
    const fullStack = scoreLegalAction(
      respond,
      baseContext({ purpose: "priority_response", stack: [{ id: "s1", cardName: "Threat" }] })
    ).score;
    expect(fullStack).toBeGreaterThan(emptyStack);
  });

  it("treats a ground creature as unable to legally block a flier, so a flying attacker scores as unblocked", () => {
    const flier: CardLike = { id: "atk", power: "2", toughness: "2", oracleText: "Flying" };
    const groundBlocker: CardLike = { id: "blk", power: "6", toughness: "6", tapped: false };
    const scored = scoreLegalAction(
      action({ id: "attack:atk", actionType: "attack", cardId: "atk" }),
      baseContext({ you: { battlefield: [flier] }, opponents: [{ battlefield: [groundBlocker] }] })
    );
    expect(scored.reasons).toContain("no untapped, legally-able blockers across opponents");
  });

  it("lets a reach creature legally block a flier", () => {
    const flier: CardLike = { id: "atk", power: "2", toughness: "2", oracleText: "Flying" };
    const reachBlocker: CardLike = { id: "blk", power: "6", toughness: "6", tapped: false, oracleText: "Reach" };
    const scored = scoreLegalAction(
      action({ id: "attack:atk", actionType: "attack", cardId: "atk" }),
      baseContext({ you: { battlefield: [flier] }, opponents: [{ battlefield: [reachBlocker] }] })
    );
    expect(scored.reasons).not.toContain("no untapped, legally-able blockers across opponents");
  });

  it("rewards a deathtouch attacker for threatening any blocker regardless of toughness", () => {
    const deathtoucher: CardLike = { id: "atk", power: "1", toughness: "1", oracleText: "Deathtouch" };
    const vanillaAttacker: CardLike = { id: "atk2", power: "1", toughness: "1" };
    const bigBlocker: CardLike = { id: "blk", power: "6", toughness: "6", tapped: false };
    const context = baseContext({ opponents: [{ battlefield: [bigBlocker] }] });

    const withDeathtouch = scoreLegalAction(
      action({ id: "attack:atk", actionType: "attack", cardId: "atk" }),
      { ...context, you: { battlefield: [deathtoucher] } }
    );
    const withoutDeathtouch = scoreLegalAction(
      action({ id: "attack:atk2", actionType: "attack", cardId: "atk2" }),
      { ...context, you: { battlefield: [vanillaAttacker] } }
    );
    expect(withDeathtouch.score).toBeGreaterThan(withoutDeathtouch.score);
  });

  it("never lets a pathological ranking beat the baseline order when no heuristic fires", () => {
    const actions = [
      action({ id: "pass-phase", actionType: "pass_priority" }),
      action({ id: "cast:neutral", actionType: "cast_spell", role: "creature" })
    ];
    const scored = scoreLegalActions(actions, baseContext());
    expect(scored[0].id).toBe("cast:neutral");
  });
});
