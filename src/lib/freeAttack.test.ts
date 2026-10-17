import { describe, expect, it } from "vitest";
import { buildCatalog, lookupCard } from "./cardCatalog";
import { fallbackAction, resolveGuardedChoice, scoreLegalActions, type CardLike, type ScorableAction, type ScoringContext } from "./actionScoring";
import { freeAttackVerdict, preferredFreeDefender } from "./freeAttack";
import type { CardRecord } from "./types";

function record(name: string, typeLine: string, manaValue: number, oracleText: string): CardRecord {
  return { id: `test-${name}`, name, typeLine, oracleText, manaValue, colors: [], colorIdentity: [] };
}
const catalog = buildCatalog(
  [
    record("Speaker of the Heavens", "Creature — Human Cleric", 3, "{T}: Create a 4/4 white Angel creature token with flying and lifelink. Activate only if you have at least 7 life more than your starting life total."),
    record("Grizzly Bears", "Creature — Bear", 2, ""),
    record("Llanowar Elves", "Creature — Elf Druid", 1, "{T}: Add {G}."),
    record("Skyknight", "Creature — Human Knight", 3, "Flying"),
    record("Giant Spider", "Creature — Spider", 4, "Reach"),
    record("Lightning Bolt", "Instant", 1, "Lightning Bolt deals 3 damage to any target.")
  ],
  undefined,
  "builtin"
);
let nextId = 0;
function perm(name: string, power: string, toughness: string, extra: Partial<CardLike> = {}): CardLike {
  const rec = lookupCard(catalog, name)!;
  nextId += 1;
  return { id: `${name}#${nextId}`, name, typeLine: rec.typeLine, oracleText: rec.oracleText, manaValue: rec.manaValue, power, toughness, ...extra };
}
function attack(attacker: CardLike, defenderId: string, detail = ""): ScorableAction {
  return { id: `attack:${attacker.id}:${defenderId}`, actionType: "attack", cardId: attacker.id, targetIds: [defenderId], label: `attack ${defenderId} with ${attacker.name}`, detail };
}
const noAttack: ScorableAction = { id: "no-attacks", actionType: "pass_priority", targetIds: [], label: "declare no attackers" };
function ctx(mine: CardLike[], opponents: Array<{ id: string; life?: number; battlefield?: CardLike[] }>, life = 40, hand: CardLike[] = []): ScoringContext {
  return {
    purpose: "declare_attackers",
    turn: 6,
    you: { id: "me", life, battlefield: mine, hand },
    opponents: opponents.map((opponent) => ({ name: opponent.id, life: 40, battlefield: [], ...opponent }))
  };
}

describe("free attack", () => {
  const speaker = () => perm("Speaker of the Heavens", "2", "2");

  it("Speaker of the Heavens attacks into two empty boards at 40 life (its ability is gated off)", () => {
    const s = speaker();
    const context = ctx([s], [{ id: "a" }, { id: "b" }]);
    expect(freeAttackVerdict(attack(s, "a"), context).free).toBe(true);
    const scored = scoreLegalActions([noAttack, attack(s, "a"), attack(s, "b")], context);
    expect(scored[0].actionType).toBe("attack");
    expect(scored.find((entry) => entry.id === "no-attacks")?.vetoReason).toMatch(/free attack declined/);
    // An LLM that picked "declare no attackers" is overruled.
    const resolved = resolveGuardedChoice(scored, "no-attacks");
    expect(resolved.overridden).toBe(true);
    expect(resolved.action?.actionType).toBe("attack");
    expect(fallbackAction(scored, "x").actionType).toBe("attack");
  });

  it("keeps Speaker home when its tap ability is usable (life >= 47)", () => {
    const s = speaker();
    const context = ctx([s], [{ id: "a" }], 47);
    const verdict = freeAttackVerdict(attack(s, "a"), context);
    expect(verdict.free).toBe(false);
    expect(verdict.downside).toMatch(/usable now/);
    expect(scoreLegalActions([noAttack, attack(s, "a")], context).find((e) => e.id === "no-attacks")?.vetoReason).toBeUndefined();
  });

  it("is not free when a blocker exists, but summoning-sick and flying cases are handled", () => {
    const s = speaker();
    const sickBears = perm("Grizzly Bears", "2", "2", { summoningSick: true } as Partial<CardLike>);
    expect(freeAttackVerdict(attack(s, "a"), ctx([s], [{ id: "a", battlefield: [sickBears] }])).free).toBe(false);
    const tappedBears = perm("Grizzly Bears", "2", "2", { tapped: true });
    expect(freeAttackVerdict(attack(s, "a"), ctx([s], [{ id: "a", battlefield: [tappedBears] }])).free).toBe(true);
    const flier = perm("Skyknight", "2", "2");
    const bears = perm("Grizzly Bears", "2", "2");
    expect(freeAttackVerdict(attack(flier, "a"), ctx([flier], [{ id: "a", battlefield: [bears] }])).free).toBe(true);
    const spider = perm("Giant Spider", "2", "4");
    expect(freeAttackVerdict(attack(flier, "a"), ctx([flier], [{ id: "a", battlefield: [spider] }])).free).toBe(false);
  });

  it("a mana creature stays home only when there are spells to cast", () => {
    const elf = perm("Llanowar Elves", "1", "1");
    const bolt = { id: "hand-bolt", name: "Lightning Bolt", typeLine: "Instant", oracleText: "", manaValue: 1 };
    expect(freeAttackVerdict(attack(elf, "a"), ctx([elf], [{ id: "a" }], 40, [bolt])).free).toBe(false);
    expect(freeAttackVerdict(attack(elf, "a"), ctx([elf], [{ id: "a" }], 40, [])).free).toBe(true);
  });

  it("is not free when it costs attack tax or leaves a lethal crack-back", () => {
    const s = speaker();
    expect(freeAttackVerdict(attack(s, "a", "Attacking here costs an additional {2} generic mana due to a static effect."), ctx([s], [{ id: "a" }])).free).toBe(false);
    const hugeA = perm("Grizzly Bears", "20", "20", { tapped: true });
    const hugeB = perm("Grizzly Bears", "20", "20", { tapped: true });
    expect(freeAttackVerdict(attack(s, "a"), ctx([s], [{ id: "a" }, { id: "b", battlefield: [hugeA, hugeB] }], 10)).free).toBe(false);
  });

  it("prefers the defender it can eliminate, then the lowest life; a defended player is not free", () => {
    const bears = perm("Grizzly Bears", "3", "3");
    const blocker = perm("Grizzly Bears", "2", "2");
    const context = ctx([bears], [{ id: "a", life: 30 }, { id: "b", life: 3 }, { id: "c", life: 5, battlefield: [blocker] }]);
    expect(preferredFreeDefender(bears, context)?.id).toBe("b");
    const scored = scoreLegalActions([noAttack, attack(bears, "a"), attack(bears, "b"), attack(bears, "c")], context);
    expect(scored[0].id).toBe(`attack:${bears.id}:b`);
  });
});
