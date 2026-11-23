// Talismans / pain lands in the kernel: the free {C} ability and the damaging coloured one, the colour choice, the damage rider, and automatic payment preferring free mana.
import { describe, expect, it } from "vitest";
import { realDef, realTable } from "./testdb";

describe("Talisman of Progress (real card)", () => {
  it("is in the card database with two mana abilities", () => {
    const def = realDef("Talisman of Progress");
    expect(def).toBeTruthy();
  });
  it("{C} ability: no damage", () => {
    const t = realTable();
    const tal = t.give("p1", "Talisman of Progress", "battlefield");
    const life = t.p("p1").life;
    expect(t.do({ type: "activateAbility", player: "p1", sourceId: tal, abilityId: "a1" } as never).error).toBeUndefined();
    expect(t.p("p1").manaPool.C).toBe(1);
    expect(t.p("p1").life).toBe(life);
  });
  it("coloured ability: the colour is chosen, 1 damage to you", () => {
    const t = realTable();
    const tal = t.give("p1", "Talisman of Progress", "battlefield");
    const life = t.p("p1").life;
    const res = t.do({ type: "activateAbility", player: "p1", sourceId: tal, abilityId: "a2", color: "U" } as never);
    expect(res.error).toBeUndefined();
    expect(t.p("p1").manaPool.U).toBe(1);
    expect(t.p("p1").life).toBe(life - 1);
  });
  it("automatic payment: a generic cost is paid with the free {C} (no damage)", () => {
    const t = realTable();
    t.give("p1", "Talisman of Progress", "battlefield");
    const ring = t.give("p1", "Sol Ring", "hand");
    const life = t.p("p1").life;
    expect(t.do({ type: "castSpell", player: "p1", cardId: ring, autoPay: true } as never).error).toBeUndefined();
    expect(t.p("p1").life).toBe(life);
  });
  it("automatic payment: a free Island pays {U} before the damaging Talisman; with only the Talisman it pays {U} and hurts", () => {
    const t = realTable();
    t.give("p1", "Talisman of Progress", "battlefield");
    t.give("p1", "Island", "battlefield");
    const elf = t.give("p1", "Brainstorm", "hand");
    const life = t.p("p1").life;
    expect(t.do({ type: "castSpell", player: "p1", cardId: elf, autoPay: true } as never).error).toBeUndefined();
    expect(t.p("p1").life).toBe(life);
    const u = realTable();
    u.give("p1", "Talisman of Progress", "battlefield");
    const elf2 = u.give("p1", "Brainstorm", "hand");
    const life2 = u.p("p1").life;
    expect(u.do({ type: "castSpell", player: "p1", cardId: elf2, autoPay: true } as never).error).toBeUndefined();
    expect(u.p("p1").life).toBe(life2 - 1);
  });
  it("pain land: Adarkar Wastes pays a generic cost with {C} for free", () => {
    const t = realTable();
    t.give("p1", "Adarkar Wastes", "battlefield");
    const ring = t.give("p1", "Sol Ring", "hand");
    const life = t.p("p1").life;
    expect(t.do({ type: "castSpell", player: "p1", cardId: ring, autoPay: true } as never).error).toBeUndefined();
    expect(t.p("p1").life).toBe(life);
  });
});
