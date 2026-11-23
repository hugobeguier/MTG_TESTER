// Kernel mode: tapping a permanent with several mana ways (Talisman: free {C}, or {W}/{U} and 1 damage) asks which, shows the cost, and applies the damage.
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { KernelGameController, manaWays } from "./kernelController";
import { legalActions } from "@/kernel/engine/legal";

function game(card: string) {
  const t = mini(["p1", "p2"], { phase: "precombat_main" });
  const id = t.give("p1", card, "battlefield");
  for (let i = 0; i < 4; i++) { t.give("p1", "Island", "library"); t.give("p2", "Island", "library"); }
  const ks = KernelSession.fromState(t.state, { ctx, display: (() => undefined) as never, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } } as never);
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
  return { ks, c, id };
}

describe("Talisman of Progress through the kernel controller", () => {
  it("asks which mana: {C} free, {W} and {U} with '1 damage to you'; choosing U adds U and costs 1 life", () => {
    const { ks, c, id } = game("Talisman of Progress");
    const life = ks.state.players[0].life;
    c.tapForMana("p1", id);
    const choice = c.manaChoice();
    expect(choice?.cardName).toBe("Talisman of Progress");
    expect([...choice!.choices].sort()).toEqual(["C", "U", "W"]);
    expect(choice!.hints).toEqual({ W: "1 damage to you", U: "1 damage to you" });
    c.chooseMana("U");
    expect(ks.state.players[0].manaPool.U).toBe(1);
    expect(ks.state.players[0].life).toBe(life - 1);
    expect(c.manaChoice()).toBeUndefined();
  });
  it("choosing {C}: no damage", () => {
    const { ks, c, id } = game("Talisman of Progress");
    const life = ks.state.players[0].life;
    c.tapForMana("p1", id);
    c.chooseMana("C");
    expect(ks.state.players[0].manaPool.C).toBe(1);
    expect(ks.state.players[0].life).toBe(life);
  });
  it("a plain Island is tapped at once (exactly one way)", () => {
    const { ks, c, id } = game("Island");
    c.tapForMana("p1", id);
    expect(c.manaChoice()).toBeUndefined();
    expect(ks.state.players[0].manaPool.U).toBe(1);
  });
  it("cancel closes the chooser without tapping", () => {
    const { ks, c, id } = game("Talisman of Progress");
    c.tapForMana("p1", id);
    c.cancelManaChoice();
    expect(c.manaChoice()).toBeUndefined();
    expect(ks.state.objects[id].tapped).toBeFalsy();
  });
  it("manaWays reads filter-land alternatives and any-colour mana", () => {
    const fake = (label: string) => ({ label, action: { type: "activateAbility", player: "p1", sourceId: "x", abilityId: "a" } }) as never;
    expect(manaWays([fake("Land: {T}: Add {W} or {U}. This land deals 1 damage to you.")]).map((w) => [w.key, w.hint])).toEqual([["W", "1 damage to you"], ["U", "1 damage to you"]]);
    expect(manaWays([fake("Gem: {T}: Add one mana of any color.")]).map((w) => w.key)).toEqual(["Any"]);
    expect(manaWays([fake("Mystic Gate: {W/U}, {T}: Add {W}{W}, {W}{U}, or {U}{U}.")]).map((w) => w.key)).toEqual(["WW", "WU", "UU"]);
    void legalActions;
  });
});

describe("take-back through the controller (T key / click)", () => {
  it("T on a tapped land untaps it and removes its mana; after the mana is spent it is refused with a Rules note", () => {
    const { ks, c, id } = game("Island");
    const props = c.tableProps() as Record<string, (...a: unknown[]) => void>;
    props.onToggleTapCard("p1", id);
    expect(ks.state.players[0].manaPool.U).toBe(1);
    props.onToggleTapCard("p1", id);
    expect(ks.state.objects[id].tapped).toBeFalsy();
    expect(ks.state.players[0].manaPool.U).toBe(0);
    props.onToggleTapCard("p1", id);
    ks.dispatch("p1", { type: "passPriority", player: "p1" });
    const v = ks.version;
    props.onToggleTapCard("p1", id);
    expect(ks.version).toBe(v);
    expect(c.table().session.events[0].message).toMatch(/not tapped for mana|can't|cannot/i);
  });
  it("a damaging Talisman tap is not retractable", () => {
    const { ks, c, id } = game("Talisman of Progress");
    c.tapForMana("p1", id);
    c.chooseMana("W");
    expect(ks.state.players[0].manaPool.W).toBe(1);
    expect(c.canUntapForMana(id)).toBe(false);
  });
});
