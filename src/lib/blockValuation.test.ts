import { describe, expect, it } from "vitest";
import { resolveGuardedChoice, scoreLegalActions, type CardLike, type ScorableAction, type ScoringContext } from "./actionScoring";

const NO_BLOCKS: ScorableAction = { id: "no-blocks", actionType: "pass_priority", targetIds: ["atk"], label: "declare no blockers" };

function blockAction(blocker: CardLike, attackerId = "atk"): ScorableAction {
  return { id: `block:${blocker.id}`, actionType: "block", cardId: blocker.id, targetIds: [attackerId], label: `block with ${blocker.name ?? blocker.id}` };
}

function servo(id: string): CardLike {
  return { id, name: "Servo", typeLine: "Token Artifact Creature - Servo", power: "1", toughness: "1", manaValue: 0, token: true };
}

function saheeli(overrides: Partial<CardLike> = {}): CardLike {
  return { id: "pw", name: "Saheeli, the Gifted", typeLine: "Legendary Planeswalker - Saheeli", loyalty: "5", manaValue: 4, commander: true, commanderTax: 4, ...overrides };
}

function hulk(overrides: Partial<CardLike> = {}): CardLike {
  return { id: "atk", name: "Deathbonnet Hulk", typeLine: "Creature - Zombie", power: "5", toughness: "5", manaValue: 5, attacking: true, attackTargetId: "pw", ...overrides };
}

function ctx(you: NonNullable<ScoringContext["you"]>, attackers: CardLike[], purpose = "declare_blockers", extra: Partial<ScoringContext> = {}): ScoringContext {
  return { turn: 20, purpose, you: { id: "malik", ...you }, opponents: [{ id: "human", life: 40, battlefield: attackers }], ...extra };
}

function decide(context: ScoringContext, blockers: CardLike[], llmChoice: string) {
  const scored = scoreLegalActions([...blockers.map((b) => blockAction(b)), NO_BLOCKS], context);
  return { scored, guarded: resolveGuardedChoice(scored, llmChoice) };
}

describe("block valuation: protecting what is attacked", () => {
  it("chumps with a Servo to save a commander planeswalker, overriding the LLM's 'no blockers'", () => {
    const blockers = [servo("s1"), servo("s2")];
    const { scored, guarded } = decide(ctx({ life: 34, battlefield: [saheeli(), ...blockers] }, [hulk()]), blockers, "no-blocks");
    expect(guarded.overridden).toBe(true);
    expect(guarded.action?.actionType).toBe("block");
    expect(guarded.action?.id).toBe("block:s1");
    expect(guarded.reason).toMatch(/block required by value/);
    expect(guarded.reason).toMatch(/commander planeswalker/);
    expect(scored.find((a) => a.id === "no-blocks")?.vetoReason).toBeTruthy();
  });

  it("also chumps for a non-commander planeswalker that would die", () => {
    const blockers = [servo("s1")];
    const { guarded } = decide(ctx({ life: 34, battlefield: [saheeli({ commander: undefined, commanderTax: undefined }), ...blockers] }, [hulk()]), blockers, "no-blocks");
    expect(guarded.overridden).toBe(true);
    expect(guarded.action?.actionType).toBe("block");
  });

  it("does not throw away a valuable creature when the planeswalker survives with high loyalty", () => {
    const valuable: CardLike = { id: "v", name: "Elder", typeLine: "Creature - Elf", power: "3", toughness: "3", manaValue: 5, oracleText: "Whenever you cast a spell, draw a card." };
    const { scored, guarded } = decide(ctx({ life: 34, battlefield: [saheeli({ loyalty: "10", commander: undefined }), valuable] }, [hulk({ power: "3", toughness: "6" })]), [valuable], "no-blocks");
    expect(guarded.overridden).toBe(false);
    expect(guarded.action?.id).toBe("no-blocks");
    expect(scored.find((a) => a.id === "block:v")!.score).toBeLessThan(scored.find((a) => a.id === "no-blocks")!.score);
  });

  it("does not chump for a planeswalker that the other attackers kill anyway", () => {
    const blockers = [servo("s1")];
    const attackers = [hulk(), hulk({ id: "atk2", name: "Second Hulk" })];
    const { scored } = decide(ctx({ life: 34, battlefield: [saheeli({ loyalty: "4" }), ...blockers] }, attackers), blockers, "no-blocks");
    // blocking one 5-power attacker does not help: 5 damage from the other still kills it
    expect(scored.find((a) => a.id === "no-blocks")!.vetoReason).toBeUndefined();
  });
});

describe("block valuation: attacks at the player", () => {
  const player = (life: number) => ctx({ life, battlefield: [servo("s1")] }, [hulk({ attackTargetId: "malik" })]);

  it("does not chump a survivable hit when life is plentiful", () => {
    const { guarded } = decide(player(40), [servo("s1")], "no-blocks");
    expect(guarded.action?.id).toBe("no-blocks");
    expect(guarded.overridden).toBe(false);
  });

  it("chumps when the hit leaves the player near lethal", () => {
    const { guarded } = decide(player(9), [servo("s1")], "no-blocks");
    expect(guarded.action?.id).toBe("block:s1");
    expect(guarded.overridden).toBe(true);
  });

  it("keeps the existing 'combined attack is lethal' blocking", () => {
    const attackers = [hulk({ id: "a1", attackTargetId: "malik", power: "6" }), hulk({ id: "a2", attackTargetId: "malik", power: "5" })];
    const blockers = [servo("s1")];
    const scored = scoreLegalActions([{ ...blockAction(blockers[0], "a1") }, { ...NO_BLOCKS, targetIds: ["a1"] }], ctx({ life: 10, battlefield: blockers }, attackers));
    expect(scored[0].actionType).toBe("block");
  });
});

describe("block valuation: choosing blockers", () => {
  it("picks the cheapest blocker among legal ones", () => {
    const pricey: CardLike = { id: "p", name: "Bear", typeLine: "Creature - Bear", power: "2", toughness: "2", manaValue: 3 };
    const blockers = [pricey, servo("s1")];
    const { guarded } = decide(ctx({ life: 34, battlefield: [saheeli(), ...blockers] }, [hulk()]), blockers, "no-blocks");
    expect(guarded.action?.id).toBe("block:s1");
  });

  it("vetoes throwing away a valuable creature for almost nothing", () => {
    const valuable: CardLike = { id: "v", name: "Titan", typeLine: "Creature - Giant", power: "6", toughness: "6", manaValue: 7, keywords: ["trample"], oracleText: "Whenever Titan attacks, draw a card." };
    const attacker = hulk({ power: "8", toughness: "8", attackTargetId: "malik" });
    const { guarded } = decide(ctx({ life: 40, battlefield: [valuable] }, [attacker]), [valuable], "block:v");
    expect(guarded.overridden).toBe(true);
    expect(guarded.action?.id).toBe("no-blocks");
  });

  it("a deathtouch attacker kills any blocker, so a big creature is not offered up for a survivable player hit", () => {
    const big: CardLike = { id: "b", name: "Giant", typeLine: "Creature - Giant", power: "7", toughness: "7", manaValue: 7 };
    const attacker = hulk({ power: "2", toughness: "2", manaValue: 2, keywords: ["deathtouch"], attackTargetId: "malik" });
    const { scored } = decide(ctx({ life: 40, battlefield: [big] }, [attacker]), [big], "block:b");
    expect(scored[0].id).toBe("no-blocks");
  });

  it("starts a gang block that kills the attacker, then adds the second blocker", () => {
    const g1: CardLike = { id: "g1", name: "Wolf", typeLine: "Creature - Wolf", power: "3", toughness: "3", manaValue: 3 };
    const g2: CardLike = { id: "g2", name: "Wolf Two", typeLine: "Creature - Wolf", power: "3", toughness: "3", manaValue: 3 };
    const attacker = hulk({ power: "4", toughness: "6", manaValue: 6, attackTargetId: "malik" });
    const first = decide(ctx({ life: 40, battlefield: [g1, g2] }, [attacker]), [g1, g2], "no-blocks");
    expect(first.scored[0].actionType).toBe("block");
    expect(first.scored.find((a) => a.id === "block:g1")!.reasons.join(" ")).toMatch(/gang block/);

    const second = scoreLegalActions([blockAction(g2), NO_BLOCKS], ctx({ life: 40, battlefield: [g1, g2] }, [attacker], "declare_blockers_additional", { blockingSoFar: ["g1"] }));
    expect(second[0].id).toBe("block:g2");
  });
});
