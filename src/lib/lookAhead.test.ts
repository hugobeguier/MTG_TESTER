import { describe, expect, it } from "vitest";
import { scoreLegalAction, type CardLike, type ScorableAction, type ScoringContext } from "./actionScoring";
import { classifyTell, estimateOpponentInterferenceRisk, worstCaseBlock } from "./lookAhead";

// Real Oracle texts.
const COUNTERSPELL = "Counter target spell.";
const HEROIC = "Permanents you control gain hexproof and indestructible until end of turn.";
const WRATH = "Destroy all creatures. They can't be regenerated.";

let n = 0;
function creature(name: string, power: number, toughness: number, extra: Partial<CardLike> = {}): CardLike {
  n += 1;
  return { id: `${name}#${n}`, name, typeLine: "Creature — Test", power: String(power), toughness: String(toughness), manaValue: power, oracleText: "", ...extra };
}
type Opp = NonNullable<ScoringContext["opponents"]>[number];
function blueOpp(over: Partial<Opp> = {}): Opp {
  return { id: "opp", name: "Blue", life: 40, battlefield: [], hand: { count: 4 }, colorIdentity: ["U"], availableMana: { total: 4, byColor: { U: 3, C: 1 } }, shownTells: { counterspells: 0, protection: 0 }, ...over };
}
function ctx(over: Partial<ScoringContext> = {}): ScoringContext {
  return { purpose: "main_phase", turn: 4, you: { id: "me", life: 40, battlefield: [], hand: [], availableMana: { total: 7 } }, opponents: [blueOpp()], ...over };
}
function cast(id: string, detail: string): ScorableAction {
  return { id: `cast:${id}`, actionType: "cast_spell", cardId: id, targetIds: [], label: `cast ${id}`, detail };
}
const bigSpell = { id: "titan", name: "Grave Titan", typeLine: "Creature — Giant", manaValue: 6, oracleText: "Deathtouch" };
const midSpell = { id: "mid", name: "Mid", typeLine: "Creature — Elf", manaValue: 3, oracleText: "" };

describe("worstCaseBlock", () => {
  it("sees a double block kill an attacker no single blocker can", () => {
    const attacker = creature("Attacker", 4, 4);
    const blockers = [creature("A", 2, 3), creature("B", 2, 3)];
    const outcome = worstCaseBlock(attacker, blockers);
    expect(outcome.attackerDies).toBe(true);
    expect(outcome.onlyByGangBlock).toBe(true);
  });
  it("a deathtouch blocker kills it alone", () => {
    const outcome = worstCaseBlock(creature("Attacker", 5, 5), [creature("Snake", 1, 1, { oracleText: "Deathtouch", keywords: ["deathtouch"] })]);
    expect(outcome.attackerDies).toBe(true);
    expect(outcome.onlyByGangBlock).toBe(false);
  });
  it("is safe against weak blockers", () => {
    expect(worstCaseBlock(creature("Attacker", 4, 4), [creature("A", 1, 1), creature("B", 1, 1)]).attackerDies).toBe(false);
  });
  it("penalizes the attack score when only a double block kills it", () => {
    const attacker = creature("Attacker", 4, 4);
    const context = ctx({ you: { id: "me", life: 40, battlefield: [attacker] }, opponents: [blueOpp({ battlefield: [creature("A", 2, 3), creature("B", 2, 3)] })] });
    const withGang = scoreLegalAction({ id: "atk", actionType: "attack", cardId: attacker.id, targetIds: ["opp"], label: "attack" }, context);
    expect(withGang.reasons.some((r) => /double-block/.test(r))).toBe(true);
  });
});

describe("own board wipe look-ahead", () => {
  it("rewards a wipe when the table loses more than I do, and penalizes it when I am the one ahead", () => {
    const detail = `{2}{W}{W} Sorcery. ${WRATH}`;
    const behind = ctx({ you: { id: "me", life: 40, battlefield: [creature("Tiny", 1, 1)] }, opponents: [blueOpp({ battlefield: [creature("Big", 6, 6), creature("Big2", 5, 5)] })] });
    const ahead = ctx({ you: { id: "me", life: 40, battlefield: [creature("Big", 6, 6), creature("Big2", 5, 5)] }, opponents: [blueOpp({ battlefield: [creature("Tiny", 1, 1)] })] });
    expect(scoreLegalAction(cast("wrath", detail), behind).reasons.some((r) => /table loses/.test(r))).toBe(true);
    expect(scoreLegalAction(cast("wrath", detail), ahead).reasons.some((r) => /behind afterwards/.test(r))).toBe(true);
  });
});

describe("estimateOpponentInterferenceRisk", () => {
  it("is zero with an empty hand, and near zero for a tapped-out blue player", () => {
    expect(estimateOpponentInterferenceRisk(blueOpp({ hand: { count: 0 } })).overall).toBe(0);
    const tapped = estimateOpponentInterferenceRisk(blueOpp({ availableMana: { total: 0, byColor: {} } }));
    expect(tapped.counter).toBeLessThanOrEqual(0.05);
  });
  it("is high for open blue mana with cards in hand, and higher once a counterspell has been shown", () => {
    const open = estimateOpponentInterferenceRisk(blueOpp());
    const shown = estimateOpponentInterferenceRisk(blueOpp({ shownTells: { counterspells: 1, protection: 0 } }));
    expect(open.counter).toBeGreaterThanOrEqual(0.3);
    expect(shown.counter).toBeGreaterThan(open.counter);
  });
  it("is zero counter risk for a red deck, and protection risk grows with white/green identity and shown tricks", () => {
    const red = estimateOpponentInterferenceRisk(blueOpp({ colorIdentity: ["R"] }));
    expect(red.counter).toBe(0);
    const white = estimateOpponentInterferenceRisk(blueOpp({ colorIdentity: ["W"] }));
    const whiteShown = estimateOpponentInterferenceRisk(blueOpp({ colorIdentity: ["W"], shownTells: { counterspells: 0, protection: 1 } }));
    expect(white.protection).toBeGreaterThan(red.protection);
    expect(whiteShown.protection).toBeGreaterThan(white.protection);
  });
  it("reads tells off graveyard cards", () => {
    expect(classifyTell(COUNTERSPELL, "Instant")).toBe("counter");
    expect(classifyTell(HEROIC, "Instant")).toBe("protection");
    expect(classifyTell(WRATH, "Sorcery")).toBeUndefined();
  });
});

describe("counterspell timing", () => {
  const titanAction = cast("titan", "{4}{B}{B} Creature — Giant. Deathtouch");
  const base = (opp: Opp, turn = 4, hand: CardLike[] = [bigSpell]) => ctx({ turn, opponents: [opp], you: { id: "me", life: 40, battlefield: [], hand, availableMana: { total: 7 } } });

  it("holds a key spell into open blue mana (capped: casts on every third turn)", () => {
    const waiting = scoreLegalAction(titanAction, base(blueOpp(), 4));
    expect(waiting.reasons.some((r) => /counter/.test(r))).toBe(true);
    const capped = scoreLegalAction(titanAction, base(blueOpp(), 6));
    expect(capped.reasons.some((r) => /counter/.test(r))).toBe(false);
  });
  it("prefers baiting when a cheaper spell is in hand", () => {
    const hand = [bigSpell, midSpell];
    const keyScore = scoreLegalAction(titanAction, base(blueOpp(), 4, hand));
    const baitScore = scoreLegalAction(cast("mid", "{2}{G} Creature — Elf."), base(blueOpp(), 4, hand));
    expect(keyScore.reasons.some((r) => /bait/.test(r))).toBe(true);
    expect(baitScore.reasons.some((r) => /bait/.test(r))).toBe(true);
  });
  it("casts into a tapped-out blue player with a bonus, and never penalizes cheap spells", () => {
    const tapped = scoreLegalAction(titanAction, base(blueOpp({ availableMana: { total: 0, byColor: {} } })));
    expect(tapped.reasons.some((r) => /safe window/.test(r))).toBe(true);
    const cheap = scoreLegalAction(cast("mid", "{2}{G} Creature — Elf."), base(blueOpp(), 4, [midSpell]));
    expect(cheap.reasons.some((r) => /counter|bait/.test(r))).toBe(false);
  });
  it("does not hold a key spell against a non-blue table", () => {
    const red = scoreLegalAction(titanAction, base(blueOpp({ colorIdentity: ["R"] })));
    expect(red.reasons.some((r) => /counter/.test(r))).toBe(false);
  });
});
