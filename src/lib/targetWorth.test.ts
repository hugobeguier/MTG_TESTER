import { describe, expect, it } from "vitest";
import { loadCardCatalog, lookupCard } from "./cardCatalog";
import { scoreLegalAction, type CardLike, type ScorableAction, type ScoringContext } from "./actionScoring";
import { evaluateTargetWorth, removalGuard } from "./playGuards";

// Real catalog text: WHY a target deserves a removal spell (docs/agents/system.md "Removal discipline").
const catalog = loadCardCatalog();
function spell(name: string, id = `hand-${name}`): { action: ScorableAction; card: CardLike } {
  const rec = lookupCard(catalog, name)!;
  return {
    action: { id: `cast:${id}`, actionType: "cast_spell", cardId: id, targetIds: [], label: `cast ${name}`, detail: `{${rec.manaValue}} ${rec.typeLine}. ${rec.oracleText} Payable with 1 land.` },
    card: { id, name, typeLine: rec.typeLine, oracleText: rec.oracleText, manaValue: rec.manaValue }
  };
}
function perm(name: string, id: string, extra: Partial<CardLike> = {}): CardLike {
  const rec = lookupCard(catalog, name)!;
  return { id, name, typeLine: rec.typeLine, oracleText: rec.oracleText, manaValue: rec.manaValue, power: rec.power, toughness: rec.toughness, ...extra };
}
const servo = (): CardLike => ({ id: "servo", name: "Servo Token", typeLine: "Token Artifact Creature — Servo", oracleText: "", manaValue: 0, power: "1", toughness: "1", token: true });
function ctx(theirs: CardLike[], hand: CardLike[], mine: CardLike[] = [], life = 40): ScoringContext {
  return { purpose: "main_phase", turn: 6, you: { id: "me", life, battlefield: mine, hand }, opponents: [{ id: "opp", life: 40, battlefield: theirs }] };
}

describe("target worth: explicit reasons", () => {
  it("a Servo is worth far less than a flyer or a lifelink-deathtouch flyer, and says why", () => {
    const context = ctx([], []);
    const servoWorth = evaluateTargetWorth(servo(), context);
    const nighthawk = evaluateTargetWorth(perm("Vampire Nighthawk", "nh"), context);
    const serra = evaluateTargetWorth(perm("Serra Angel", "sa"), context);
    expect(servoWorth.score).toBeLessThan(2);
    expect(nighthawk.score).toBeGreaterThan(servoWorth.score + 4);
    expect(serra.score).toBeGreaterThan(servoWorth.score + 4);
    expect(servoWorth.reasons.join(" ")).toMatch(/vanilla token/);
    expect(serra.reasons.join(" ")).toMatch(/flying and I have nothing with flying or reach/);
  });

  it("flying matters less when I can already block it", () => {
    const withReach = evaluateTargetWorth(perm("Serra Angel", "sa"), ctx([], [], [{ id: "r", name: "Archer", typeLine: "Creature — Elf", oracleText: "Reach", power: "2", toughness: "3", manaValue: 3 }]));
    const without = evaluateTargetWorth(perm("Serra Angel", "sa"), ctx([], []));
    expect(without.score).toBeGreaterThan(withReach.score);
  });

  it("Swords to Plowshares: held on a lone Servo, spent on the flyer, spent on their commander", () => {
    const swords = spell("Swords to Plowshares");
    const hand = [swords.card];
    expect(removalGuard(swords.action, ctx([servo()], hand)).allowed).toBe(false);
    const withFlyer = removalGuard(swords.action, ctx([servo(), perm("Serra Angel", "sa")], hand));
    expect(withFlyer.allowed).toBe(true);
    expect(withFlyer.worth?.target).toBe("Serra Angel");
    expect(withFlyer.worth?.reasons.join(" ")).toMatch(/flying/);
    const commander = perm("Atraxa, Praetors' Voice", "atraxa", { commander: true });
    expect(removalGuard(swords.action, ctx([servo(), commander], hand)).allowed).toBe(true);
  });

  it("premium cheap removal waits: Swords has a higher bar than Murder against the same mid-size target", () => {
    const body = perm("Vampire Nighthawk", "nh");
    const swordsVerdict = removalGuard(spell("Swords to Plowshares").action, ctx([body], [spell("Swords to Plowshares").card]));
    const murderVerdict = removalGuard(spell("Murder").action, ctx([body], [spell("Murder").card]));
    expect(swordsVerdict.threshold).toBeGreaterThan(0);
    expect(swordsVerdict.worth?.reasons.join(" ")).toMatch(/premium cheap removal waits/);
    expect(murderVerdict.worth?.reasons.join(" ")).not.toMatch(/premium/);
  });

  it("Murder: indestructible Darksteel Juggernaut is worthless to destroy, a lifelinker is not", () => {
    const murder = spell("Murder");
    const hand = [murder.card];
    const jug = perm("Darksteel Juggernaut", "dj", { power: "5", toughness: "5" });
    const verdict = removalGuard(murder.action, ctx([jug], hand));
    expect(verdict.allowed).toBe(false);
    expect(verdict.worth?.reasons.join(" ")).toMatch(/indestructible/);
    expect(removalGuard(murder.action, ctx([perm("Vampire Nighthawk", "nh")], hand)).allowed).toBe(true);
  });

  it("Abrade: a Servo alone is held; a Sol Ring (artifact mode) or a creature 3 damage kills is worth it", () => {
    const abrade = spell("Abrade");
    const hand = [abrade.card];
    expect(removalGuard(abrade.action, ctx([servo()], hand)).allowed).toBe(false);
    expect(removalGuard(abrade.action, ctx([servo(), perm("Sol Ring", "ring")], hand)).allowed).toBe(true);
    expect(removalGuard(abrade.action, ctx([servo(), perm("Vampire Nighthawk", "nh")], hand)).allowed).toBe(true);
  });

  it("Chaos Warp is premium removal now: held on a Servo, thrown at a real threat", () => {
    const warp = spell("Chaos Warp");
    const hand = [warp.card];
    expect(removalGuard(warp.action, ctx([servo()], hand)).allowed).toBe(false);
    expect(removalGuard(warp.action, ctx([servo(), perm("Atraxa, Praetors' Voice", "atraxa", { commander: true })], hand)).allowed).toBe(true);
  });

  it("lethal pressure changes the answer: three 1/1s against 3 life make even a Servo worth removing", () => {
    const swords = spell("Swords to Plowshares");
    const tokens = [servo(), { ...servo(), id: "s2" }, { ...servo(), id: "s3" }];
    const verdict = removalGuard(swords.action, ctx(tokens, [swords.card], [], 3));
    expect(verdict.allowed).toBe(true);
    expect(verdict.worth?.reasons.join(" ")).toMatch(/lethal/);
  });

  it("the scored action carries the target-worth reason first, so the model (and the recorded decision) can quote it", () => {
    const swords = spell("Swords to Plowshares");
    const scored = scoreLegalAction(swords.action, ctx([servo()], [swords.card]));
    expect(scored.reasons[0]).toMatch(/^Target worth: Servo Token/);
    expect(scored.reasons[0]).toMatch(/vanilla token/);
    expect(scored.vetoReason).toMatch(/Why:/);
  });
});
