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

  it("prefers attacking the opponent with the lowest life among several opponents", () => {
    const attacker: CardLike = { id: "atk", power: "3", toughness: "3" };
    const context = baseContext({
      you: { battlefield: [attacker] },
      opponents: [
        { id: "weak", name: "Weak", life: 5, battlefield: [] },
        { id: "healthy", name: "Healthy", life: 40, battlefield: [] }
      ]
    });
    const attackWeak = scoreLegalAction(action({ id: "attack:weak", actionType: "attack", cardId: "atk", targetIds: ["weak"] }), context);
    const attackHealthy = scoreLegalAction(action({ id: "attack:healthy", actionType: "attack", cardId: "atk", targetIds: ["healthy"] }), context);
    expect(attackWeak.score).toBeGreaterThan(attackHealthy.score);
  });

  it("prefers attacking the opponent with the most board presence (imminent-winner signal)", () => {
    const attacker: CardLike = { id: "atk", power: "3", toughness: "3" };
    const bigBoard: CardLike[] = [{ id: "c1", power: "8", toughness: "8" }];
    const context = baseContext({
      you: { battlefield: [attacker] },
      opponents: [
        { id: "ahead", name: "Ahead", life: 40, battlefield: bigBoard },
        { id: "behind", name: "Behind", life: 40, battlefield: [] }
      ]
    });
    const attackAhead = scoreLegalAction(action({ id: "attack:ahead", actionType: "attack", cardId: "atk", targetIds: ["ahead"] }), context);
    const attackBehind = scoreLegalAction(action({ id: "attack:behind", actionType: "attack", cardId: "atk", targetIds: ["behind"] }), context);
    expect(attackAhead.score).toBeGreaterThan(attackBehind.score);
  });

  it("does not favor any opponent when all are tied on life and board presence", () => {
    const attacker: CardLike = { id: "atk", power: "3", toughness: "3" };
    const context = baseContext({
      you: { battlefield: [attacker] },
      opponents: [
        { id: "a", name: "A", life: 40, battlefield: [] },
        { id: "b", name: "B", life: 40, battlefield: [] }
      ]
    });
    const attackA = scoreLegalAction(action({ id: "attack:a", actionType: "attack", cardId: "atk", targetIds: ["a"] }), context);
    const attackB = scoreLegalAction(action({ id: "attack:b", actionType: "attack", cardId: "atk", targetIds: ["b"] }), context);
    expect(attackA.score).toBe(attackB.score);
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

describe("scoreBlockDecision", () => {
  it("rewards a block that kills the attacker while the blocker survives", () => {
    const blocker: CardLike = { id: "blk", power: "4", toughness: "6" };
    const attacker: CardLike = { id: "atk", power: "3", toughness: "3" };
    const context = baseContext({
      purpose: "declare_blockers",
      you: { life: 40, battlefield: [blocker] },
      opponents: [{ battlefield: [attacker] }]
    });
    const block = scoreLegalAction(action({ id: "block:blk", actionType: "block", cardId: "blk", targetIds: ["atk"] }), context);
    const noBlock = scoreLegalAction(action({ id: "no-blocks", actionType: "pass_priority", targetIds: ["atk"] }), context);
    expect(block.score).toBeGreaterThan(noBlock.score);
  });

  it("penalizes a block where the blocker dies for nothing at safe life totals", () => {
    const blocker: CardLike = { id: "blk", power: "1", toughness: "1" };
    const attacker: CardLike = { id: "atk", power: "5", toughness: "5" };
    const context = baseContext({
      purpose: "declare_blockers",
      you: { life: 40, battlefield: [blocker] },
      opponents: [{ battlefield: [attacker] }]
    });
    const block = scoreLegalAction(action({ id: "block:blk", actionType: "block", cardId: "blk", targetIds: ["atk"] }), context);
    const noBlock = scoreLegalAction(action({ id: "no-blocks", actionType: "pass_priority", targetIds: ["atk"] }), context);
    expect(noBlock.score).toBeGreaterThan(block.score);
  });

  it("favors a chump block when the attacker's damage would be lethal or near-lethal", () => {
    const blocker: CardLike = { id: "blk", power: "1", toughness: "1" };
    const attacker: CardLike = { id: "atk", power: "5", toughness: "5" };
    const context = baseContext({
      purpose: "declare_blockers",
      you: { life: 4, battlefield: [blocker] },
      opponents: [{ battlefield: [attacker] }]
    });
    const block = scoreLegalAction(action({ id: "block:blk", actionType: "block", cardId: "blk", targetIds: ["atk"] }), context);
    const noBlock = scoreLegalAction(action({ id: "no-blocks", actionType: "pass_priority", targetIds: ["atk"] }), context);
    expect(block.score).toBeGreaterThan(noBlock.score);
  });
});

describe("scoreMulliganDecision", () => {
  it("favors keeping a well-balanced hand", () => {
    const hand: CardLike[] = [
      { id: "l1", role: "land", typeLine: "Land" },
      { id: "l2", role: "land", typeLine: "Land" },
      { id: "l3", role: "land", typeLine: "Land" },
      { id: "c1", manaValue: 2, typeLine: "Creature" },
      { id: "c2", manaValue: 3, typeLine: "Creature" }
    ];
    const context = baseContext({ purpose: "opening_hand_mulligan", you: { hand } });
    const keep = scoreLegalAction(action({ id: "keep-hand", actionType: "keep_hand" }), context);
    const mulligan = scoreLegalAction(action({ id: "mulligan", actionType: "mulligan" }), context);
    expect(keep.score).toBeGreaterThan(mulligan.score);
  });

  it("favors mulliganing a hand with too few lands", () => {
    const hand: CardLike[] = [
      { id: "l1", role: "land", typeLine: "Land" },
      { id: "c1", manaValue: 4, typeLine: "Creature" },
      { id: "c2", manaValue: 5, typeLine: "Creature" },
      { id: "c3", manaValue: 6, typeLine: "Creature" },
      { id: "c4", manaValue: 6, typeLine: "Creature" }
    ];
    const context = baseContext({ purpose: "opening_hand_mulligan", you: { hand } });
    const keep = scoreLegalAction(action({ id: "keep-hand", actionType: "keep_hand" }), context);
    const mulligan = scoreLegalAction(action({ id: "mulligan", actionType: "mulligan" }), context);
    expect(mulligan.score).toBeGreaterThan(keep.score);
  });

  it("does not affect mulligan scoring outside the opening_hand_mulligan purpose", () => {
    const hand: CardLike[] = [{ id: "l1", role: "land", typeLine: "Land" }];
    const context = baseContext({ you: { hand } });
    const keep = scoreLegalAction(action({ id: "keep-hand", actionType: "keep_hand" }), context);
    expect(keep.reasons).toEqual([]);
  });
});

describe("scoreImmediateWinThreats", () => {
  it("prioritizes removal on a source already dealing significant commander damage over a bigger but harmless threat", () => {
    const dangerousCommander: CardLike = { id: "cmdr", power: "3", toughness: "3" };
    const biggerButHarmless: CardLike = { id: "big", power: "8", toughness: "8" };
    const context = baseContext({
      you: { life: 40, commanderDamage: { cmdr: 15 } },
      opponents: [{ battlefield: [dangerousCommander, biggerButHarmless] }]
    });
    const removeCommander = scoreLegalAction(
      action({ id: "cast:r1", actionType: "cast_spell", role: "removal", targetIds: ["cmdr"] }),
      context
    );
    const removeBig = scoreLegalAction(action({ id: "cast:r2", actionType: "cast_spell", role: "removal", targetIds: ["big"] }), context);
    expect(removeCommander.score).toBeGreaterThan(removeBig.score);
  });

  it("strongly favors blocking an attacker that would deal lethal commander damage if unblocked", () => {
    const lethalCommander: CardLike = { id: "cmdr", power: "8", toughness: "8" };
    const blocker: CardLike = { id: "blk", power: "1", toughness: "1" };
    const context = baseContext({
      purpose: "declare_blockers",
      you: { life: 40, commanderDamage: { cmdr: 15 }, battlefield: [blocker] },
      opponents: [{ battlefield: [lethalCommander] }]
    });
    const block = scoreLegalAction(action({ id: "block:blk", actionType: "block", cardId: "blk", targetIds: ["cmdr"] }), context);
    const noBlock = scoreLegalAction(action({ id: "no-blocks", actionType: "pass_priority", targetIds: ["cmdr"] }), context);
    expect(block.score).toBeGreaterThan(noBlock.score);
  });

  it("prioritizes removing an infect creature when already near the poison-lethal threshold", () => {
    const infectCreature: CardLike = { id: "inf", power: "2", toughness: "2", oracleText: "Infect" };
    const context = baseContext({
      you: { life: 40, poison: 7 },
      opponents: [{ battlefield: [infectCreature] }]
    });
    const removeInfect = scoreLegalAction(action({ id: "cast:r1", actionType: "cast_spell", role: "removal", targetIds: ["inf"] }), context);
    const doNothing = scoreLegalAction(action({ id: "pass-phase", actionType: "pass_priority" }), context);
    expect(removeInfect.score).toBeGreaterThan(doNothing.score + 2);
  });
});

describe("scoreStackResponse", () => {
  const wrathOracleText = "Destroy all creatures. They can't be regenerated.";

  it("favors countering a board wipe when you're ahead on board", () => {
    const context = baseContext({
      purpose: "priority_response",
      pendingAction: { id: "wrath", cardName: "Wrath of God", oracleText: wrathOracleText },
      you: { battlefield: [{ id: "big1", power: "6", toughness: "6" }, { id: "big2", power: "5", toughness: "5" }] },
      opponents: [{ battlefield: [{ id: "small", power: "1", toughness: "1" }] }]
    });
    const counter = scoreLegalAction(
      action({ id: "respond:counterspell", actionType: "cast_spell", detail: "{U}{U} Instant. Counter target spell." }),
      context
    );
    const pass = scoreLegalAction(action({ id: "pass-priority", actionType: "pass_priority" }), context);
    expect(counter.score).toBeGreaterThan(pass.score);
  });

  it("favors NOT countering a board wipe when you're behind on board", () => {
    const context = baseContext({
      purpose: "priority_response",
      pendingAction: { id: "wrath", cardName: "Wrath of God", oracleText: wrathOracleText },
      you: { battlefield: [{ id: "small", power: "1", toughness: "1" }] },
      opponents: [{ battlefield: [{ id: "big1", power: "6", toughness: "6" }, { id: "big2", power: "5", toughness: "5" }] }]
    });
    const counter = scoreLegalAction(
      action({ id: "respond:counterspell", actionType: "cast_spell", detail: "{U}{U} Instant. Counter target spell." }),
      context
    );
    const pass = scoreLegalAction(action({ id: "pass-priority", actionType: "pass_priority" }), context);
    expect(pass.score).toBeGreaterThan(counter.score);
  });

  it("does not treat a non-counterspell instant response as an attempt to stop the wipe", () => {
    const context = baseContext({
      purpose: "priority_response",
      pendingAction: { id: "wrath", cardName: "Wrath of God", oracleText: wrathOracleText },
      you: { battlefield: [{ id: "big1", power: "6", toughness: "6" }] },
      opponents: [{ battlefield: [{ id: "small", power: "1", toughness: "1" }] }]
    });
    const removal = scoreLegalAction(
      action({ id: "respond:removal", actionType: "cast_spell", detail: "{B} Instant. Destroy target creature." }),
      context
    );
    expect(removal.reasons.some((reason) => reason.includes("board lead") || reason.includes("throws away"))).toBe(false);
  });

  it("does not fire outside priority_response or for a non-board-wipe pending action", () => {
    const context = baseContext({
      purpose: "priority_response",
      pendingAction: { id: "murder", cardName: "Murder", oracleText: "Destroy target creature." },
      you: { battlefield: [{ id: "big1", power: "6", toughness: "6" }] },
      opponents: [{ battlefield: [{ id: "small", power: "1", toughness: "1" }] }]
    });
    const counter = scoreLegalAction(
      action({ id: "respond:counterspell", actionType: "cast_spell", detail: "{U}{U} Instant. Counter target spell." }),
      context
    );
    expect(counter.reasons.some((reason) => reason.includes("board lead") || reason.includes("throws away"))).toBe(false);
  });
});

describe("scoreSacrificeValue", () => {
  const mindStone: CardLike = { id: "mind-stone", oracleText: "{T}: Add {C}.\n{1}, {T}, Sacrifice this artifact: Draw a card." };

  it("penalizes sacrificing a mana rock for a card while still holding a full hand", () => {
    const context = baseContext({ you: { battlefield: [mindStone], hand: [{ id: "c1" }, { id: "c2" }, { id: "c3" }] } });
    const sac = scoreLegalAction(
      action({
        id: "activate-sacrifice:mind-stone:0",
        actionType: "activate_ability",
        cardId: "mind-stone",
        label: "activate Mind Stone (sacrifice Mind Stone)",
        detail: "Sacrifice this artifact: Draw a card."
      }),
      context
    );
    const pass = scoreLegalAction(action({ id: "pass-priority", actionType: "pass_priority" }), context);
    expect(pass.score).toBeGreaterThan(sac.score);
  });

  it("allows it when hellbent (empty hand)", () => {
    const context = baseContext({ you: { battlefield: [mindStone], hand: [] } });
    const sac = scoreLegalAction(
      action({
        id: "activate-sacrifice:mind-stone:0",
        actionType: "activate_ability",
        cardId: "mind-stone",
        label: "activate Mind Stone (sacrifice Mind Stone)",
        detail: "Sacrifice this artifact: Draw a card."
      }),
      context
    );
    const pass = scoreLegalAction(action({ id: "pass-priority", actionType: "pass_priority" }), context);
    expect(sac.score).toBeGreaterThan(pass.score);
  });

  it("does not penalize a pure sacrifice outlet with no recurring mana ability", () => {
    const viscera: CardLike = { id: "viscera-seer", oracleText: "Sacrifice a creature: Scry 1." };
    const context = baseContext({ you: { battlefield: [viscera], hand: [{ id: "c1" }, { id: "c2" }] } });
    const sac = scoreLegalAction(
      action({
        id: "activate-sacrifice:viscera-seer:0",
        actionType: "activate_ability",
        cardId: "viscera-seer",
        label: "activate Viscera Seer (sacrifice a creature)",
        detail: "Sacrifice a creature: Scry 1."
      }),
      context
    );
    expect(sac.reasons.some((reason) => reason.includes("mana rock"))).toBe(false);
  });

  it("does not penalize sacrificing OTHER creatures to transform a mana source into something bigger (Westvale Abbey)", () => {
    const westvale: CardLike = { id: "westvale", oracleText: "{T}: Add {C}.\n{5}, {T}, Sacrifice five creatures: Transform this land, then untap it." };
    const creatures = Array.from({ length: 6 }, (_, index) => ({ id: `c${index}`, power: "1", toughness: "1", typeLine: "Creature" }));
    const context = baseContext({
      you: { battlefield: [westvale, ...creatures], hand: [{ id: "h1" }, { id: "h2" }, { id: "h3" }] }
    });
    const sac = scoreLegalAction(
      action({
        id: "activate-sacrifice:westvale:0",
        actionType: "activate_ability",
        cardId: "westvale",
        label: "activate Westvale Abbey (sacrifice c0, c1, c2, c3, c4)",
        detail: "Sacrifice five creatures: Transform this land, then untap it."
      }),
      context
    );
    expect(sac.reasons.some((reason) => reason.includes("mana rock"))).toBe(false);
  });
});

describe("scoreTransformSacrifice", () => {
  const westvale: CardLike = { id: "westvale", oracleText: "{T}: Add {C}.\n{5}, {T}, Sacrifice five creatures: Transform this land, then untap it." };
  const transformAction = action({
    id: "activate-sacrifice:westvale:0",
    actionType: "activate_ability",
    cardId: "westvale",
    label: "activate Westvale Abbey (sacrifice c0, c1, c2, c3, c4)",
    detail: "Sacrifice five creatures: Transform this land, then untap it."
  });

  it("rewards transforming while keeping creatures in reserve", () => {
    const creatures = Array.from({ length: 7 }, (_, index) => ({ id: `c${index}`, typeLine: "Creature" }));
    const context = baseContext({ you: { battlefield: [westvale, ...creatures] } });
    const scored = scoreLegalAction(transformAction, context);
    expect(scored.reasons.some((reason) => reason.includes("reserve"))).toBe(true);
  });

  it("penalizes a transform that would require sacrificing the entire board", () => {
    const creatures = Array.from({ length: 5 }, (_, index) => ({ id: `c${index}`, typeLine: "Creature" }));
    const context = baseContext({ you: { battlefield: [westvale, ...creatures] } });
    const scored = scoreLegalAction(transformAction, context);
    expect(scored.reasons.some((reason) => reason.includes("entire board"))).toBe(true);
  });
});
