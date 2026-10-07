import { describe, expect, it } from "vitest";
import { scoreLegalAction, type CardLike, type ScoringContext } from "./actionScoring";
import { attackEconomics, creatureValue, threatAssessment, threatShares } from "./strategy";

const creature = (id: string, power: string, toughness: string, extra: Partial<CardLike> = {}): CardLike => ({ id, name: id, typeLine: "Creature", power, toughness, ...extra });

describe("creatureValue", () => {
  it("values engines and the commander above vanilla creatures of the same size", () => {
    const vanilla = creature("v", "2", "2", { manaValue: 3 });
    const engine = creature("e", "2", "2", { manaValue: 3, oracleText: "Whenever you cast a spell, draw a card.\nOther creatures you control get +1/+1." });
    const commander = creature("c", "2", "2", { manaValue: 3, commander: true });
    expect(creatureValue(engine)).toBeGreaterThan(creatureValue(vanilla) + 3);
    expect(creatureValue(commander)).toBeGreaterThan(creatureValue(vanilla) + 3);
  });
  it("counts keywords that win fights", () => {
    expect(creatureValue(creature("d", "1", "1", { oracleText: "Deathtouch" }))).toBeGreaterThan(creatureValue(creature("v", "1", "1")));
    expect(creatureValue(creature("g", "1", "1", { keywords: ["indestructible", "flying"] }))).toBeGreaterThan(creatureValue(creature("v", "1", "1")) + 3);
  });
});

describe("threatAssessment / threatShares", () => {
  const context = (opponents: ScoringContext["opponents"]): ScoringContext => ({ turn: 6, you: { life: 20, battlefield: [] }, opponents });
  it("ranks an opponent with a big evasive board far above one with nothing", () => {
    const ctx = context([
      { id: "big", name: "Big", life: 40, battlefield: [creature("a", "5", "5", { keywords: ["flying"] }), creature("b", "4", "4")] },
      { id: "empty", name: "Empty", life: 40, battlefield: [] }
    ]);
    const shares = threatShares(ctx);
    expect(shares.get("big")!.share).toBeGreaterThan(0.8);
    expect(threatAssessment(ctx.opponents![0], ctx).offense).toBeGreaterThan(9);
  });
  it("notices a commander closing in on 21 damage", () => {
    const ctx: ScoringContext = { turn: 8, you: { life: 30, battlefield: [], commanderDamage: { cmd: 17 } }, opponents: [{ id: "x", battlefield: [creature("cmd", "5", "5", { commander: true })] }] };
    expect(threatAssessment(ctx.opponents![0], ctx).reasons.join(" ")).toMatch(/commander damage/);
  });
});

describe("attackEconomics", () => {
  const base = (life = 40): ScoringContext => ({ turn: 6, you: { life, battlefield: [] }, opponents: [] });
  it("keeps a valuable creature at home rather than trading it for a cheap deathtouch blocker", () => {
    const wurm = creature("wurm", "6", "6", { manaValue: 6 });
    const viper = creature("viper", "1", "1", { manaValue: 1, oracleText: "Deathtouch" });
    const ctx = { ...base(), you: { life: 40, battlefield: [wurm] } };
    const into = attackEconomics(wurm, { id: "d", name: "Defender", life: 40, battlefield: [viper] }, ctx);
    expect(into.net).toBeLessThan(0);
    expect(into.reasons.join(" ")).toMatch(/can kill it/);
  });
  it("sends an expendable token into the same blocker happily", () => {
    const token = creature("tok", "1", "1", { manaValue: 0 });
    const viper = creature("viper", "1", "1", { manaValue: 1, oracleText: "Deathtouch" });
    const ctx = { ...base(), you: { life: 40, battlefield: [token, creature("x", "3", "3"), creature("y", "3", "3")] } };
    const result = attackEconomics(token, { id: "d", name: "D", life: 40, battlefield: [viper] }, ctx);
    expect(result.net).toBeGreaterThan(-1);
  });
  it("refuses to tap the last blockers when the crack-back would be lethal", () => {
    const guard = creature("guard", "3", "3");
    const ctx: ScoringContext = {
      turn: 9,
      you: { life: 8, battlefield: [guard] },
      opponents: [{ id: "d", name: "D", life: 40, battlefield: [] }, { id: "e", name: "E", life: 40, battlefield: [creature("h", "6", "6"), creature("i", "5", "5")] }]
    };
    const result = attackEconomics(guard, ctx.opponents![0], ctx);
    expect(result.risk).toBeGreaterThan(5);
    expect(result.reasons.join(" ")).toMatch(/lethal/);
  });
  it("a vigilant attacker has no crack-back cost", () => {
    const knight = creature("kn", "3", "3", { keywords: ["vigilance"] });
    const ctx: ScoringContext = { turn: 9, you: { life: 8, battlefield: [knight] }, opponents: [{ id: "d", battlefield: [] }, { id: "e", battlefield: [creature("h", "6", "6")] }] };
    expect(attackEconomics(knight, ctx.opponents![0], ctx).risk).toBe(0);
  });
});

describe("whom to attack (full scoring)", () => {
  it("prefers the real threat over a harmless opponent when the attack itself is equally safe", () => {
    const attacker = creature("atk", "3", "3", { keywords: ["flying"] });
    const ctx: ScoringContext = {
      turn: 7,
      you: { life: 30, battlefield: [attacker, creature("home", "2", "2")] },
      opponents: [
        { id: "threat", name: "Threat", life: 40, battlefield: [creature("t1", "6", "6", { tapped: true }), creature("t2", "5", "5", { tapped: true })] },
        { id: "calm", name: "Calm", life: 40, battlefield: [] }
      ]
    };
    const hit = (target: string) => scoreLegalAction({ id: target, actionType: "attack", cardId: "atk", targetIds: [target], label: "attack" }, ctx);
    expect(hit("threat").score).toBeGreaterThan(hit("calm").score);
    expect(hit("threat").reasons.join(" ")).toMatch(/biggest threat/);
  });
});

describe("development", () => {
  it("values casting the commander early and an anthem when there are creatures to boost", () => {
    const ctx: ScoringContext = { turn: 4, you: { life: 40, battlefield: [creature("a", "1", "1"), creature("b", "1", "1"), creature("c", "1", "1")], hand: [] }, opponents: [] };
    const commander = scoreLegalAction({ id: "c", actionType: "cast_commander", cardId: "k", targetIds: [], label: "cast", detail: "{3}{G} Legendary Creature. Trample" }, ctx);
    expect(commander.reasons.join(" ")).toMatch(/commander/);
    const anthem = scoreLegalAction({ id: "a", actionType: "cast_spell", cardId: "x", targetIds: [], label: "cast", detail: "{2}{W} Enchantment. Creatures you control get +1/+1." }, ctx);
    expect(anthem.reasons.join(" ")).toMatch(/anthem/);
    const noCreatures = scoreLegalAction({ id: "a", actionType: "cast_spell", cardId: "x", targetIds: [], label: "cast", detail: "{2}{W} Enchantment. Creatures you control get +1/+1." }, { ...ctx, you: { ...ctx.you, battlefield: [] } });
    expect(noCreatures.reasons.join(" ")).not.toMatch(/anthem/);
  });
});
