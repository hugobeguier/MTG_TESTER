import { describe, expect, it } from "vitest";
import { scoreLegalActions, fallbackAction, type CardLike, type ScorableAction, type ScoringContext } from "./actionScoring";
import { evaluatePlayGuards, suicideAttackGuard } from "./playGuards";

function creature(id: string, name: string, power: string, toughness: string, extra: Partial<CardLike> = {}): CardLike {
  return { id, name, typeLine: "Creature — Test", manaValue: Number(power) + 1, power, toughness, oracleText: "", ...extra };
}
function attack(card: CardLike, target = "opp"): ScorableAction {
  return { id: `attack:${card.id}:${target}`, actionType: "attack", cardId: card.id, targetIds: [target], label: `attack ${target} with ${card.name}` };
}
const noAttack: ScorableAction = { id: "none", actionType: "pass_priority", targetIds: [], label: "declare no attackers" };
function ctx(mine: CardLike[], theirs: CardLike[], oppLife = 40, extra: Partial<NonNullable<ScoringContext["opponents"]>[number]> = {}): ScoringContext {
  return { purpose: "declare_attackers", phase: "declare attackers step", turn: 8, you: { id: "me", life: 40, battlefield: mine, hand: [] }, opponents: [{ id: "opp", name: "Opp", life: oppLife, battlefield: theirs, ...extra }] };
}

describe("suicideAttackGuard", () => {
  const knight = creature("k", "Knight", "3", "3");
  const wall = creature("w", "Big Wall", "5", "5");

  it("vetoes a lone attacker into a blocker that kills it and survives, and the scorer then declines the attack", () => {
    const context = ctx([knight], [wall]);
    expect(suicideAttackGuard(attack(knight), context).allowed).toBe(false);
    expect(evaluatePlayGuards(attack(knight), context).vetoed).toBe(true);
    const scored = scoreLegalActions([attack(knight), noAttack], context);
    expect(fallbackAction(scored, "t").legalActionId).toBe("none");
  });

  it("allows it when the blocker cannot block it (flying) or is tapped", () => {
    expect(suicideAttackGuard(attack(creature("f", "Flier", "3", "3", { oracleText: "Flying" })), ctx([knight], [wall])).allowed).toBe(true);
    expect(suicideAttackGuard(attack(knight), ctx([knight], [{ ...wall, tapped: true }])).allowed).toBe(true);
  });

  it("allows it when the attack is lethal, or the defender is low enough for the team to finish", () => {
    expect(suicideAttackGuard(attack(knight), ctx([knight], [wall], 3)).allowed).toBe(true);
    const second = creature("k2", "Knight 2", "3", "3");
    expect(suicideAttackGuard(attack(knight), ctx([knight, second, creature("k3", "Knight 3", "3", "3")], [wall], 7)).allowed).toBe(true);
  });

  it("allows it when I send more attackers than the defender has killer blockers", () => {
    expect(suicideAttackGuard(attack(knight), ctx([knight, creature("k2", "Knight 2", "3", "3")], [wall])).allowed).toBe(true);
  });

  it("allows a forced attacker (goaded), a cheap body and a token", () => {
    expect(suicideAttackGuard(attack(creature("g", "Goaded", "3", "3", { goaded: true })), ctx([knight], [wall])).allowed).toBe(true);
    expect(suicideAttackGuard(attack(creature("c", "Cheap", "1", "1")), ctx([knight], [wall])).allowed).toBe(true);
    expect(suicideAttackGuard(attack(creature("t", "Token", "3", "3", { token: true })), ctx([knight], [wall])).allowed).toBe(true);
  });

  it("allows a deathtouch attacker (it trades up) and ignores attacks on planeswalkers", () => {
    const deathtouch = creature("d", "Deathtoucher", "2", "2", { oracleText: "Deathtouch", manaValue: 4 });
    expect(suicideAttackGuard(attack(deathtouch), ctx([deathtouch], [wall])).allowed).toBe(true);
    expect(suicideAttackGuard(attack(knight, "some-planeswalker"), ctx([knight], [wall])).allowed).toBe(true);
  });

  it("allows a commander with 12+ commander damage already dealt to that player", () => {
    const commander = creature("cmd", "Commander", "3", "3", { commander: true });
    expect(suicideAttackGuard(attack(commander), ctx([commander], [wall], 40, { commanderDamage: { cmd: 14 } })).allowed).toBe(true);
    expect(suicideAttackGuard(attack(commander), ctx([commander], [wall])).allowed).toBe(false);
  });
});
