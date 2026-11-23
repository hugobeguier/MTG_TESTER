// Kernel step 10 (e): Morophon, Rith (excess damage), Arena of Glory (exert + haste rider), Roaming Throne (extra trigger), Ganax.
import { describe, expect, it } from "vitest";
import { instant, mk } from "./famkit";
import { drain } from "./step10kit";
import { cardUnsupported } from "./support";
import { charsOf, realDef, realTable } from "./testdb";

describe("step 10e: supported", () => { for (const n of ["Morophon, the Boundless", "Rith, Liberated Primeval", "Arena of Glory", "Roaming Throne", "Ganax, Astral Hunter"]) it(n, () => { expect(cardUnsupported(realDef(n)!).all, n).toEqual([]); }); });

describe("Morophon, the Boundless: only colored mana is reduced", () => {
  it("a chosen-type spell costs {W}{U}{B}{R}{G} less colored mana, generic stays", () => {
    const dragon = mk("Test Dragon", { manaCost: "{2}{W}{U}", types: ["creature"], subtypes: ["Dragon"], power: 2, toughness: 2 }, []);
    const t = realTable(["p1", "p2"], { "Test Dragon": dragon });
    const m = t.give("p1", "Morophon, the Boundless", "battlefield"); t.obj(m).chosen = { type: "Dragon" };
    t.give("p1", "Plains", "battlefield"); t.give("p1", "Plains", "battlefield");
    expect(t.do({ type: "castSpell", player: "p1", cardId: t.give("p1", "Test Dragon", "hand") }).error).toBeUndefined(); // {2} left to pay: W and U are gone
    const u = realTable(["p1", "p2"], { "Test Dragon": dragon });
    u.give("p1", "Morophon, the Boundless", "battlefield").toString();
    u.obj(u.state.battlefield[0]).chosen = { type: "Dragon" };
    u.give("p1", "Plains", "battlefield");
    expect(u.do({ type: "castSpell", player: "p1", cardId: u.give("p1", "Test Dragon", "hand") }).error?.code).toBe("cannot_pay"); // generic {2} not reduced
  });
});

describe("Rith, Liberated Primeval: excess damage", () => {
  const bolt = instant("Big Bolt", "{R}", [{ kind: "damage_target", target: "t1", amount: 5 } as never], [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: { min: 1, max: 1 } }]);
  it("makes a 4/4 Dragon at your end step when an opponent's creature was dealt excess damage", () => {
    const t = realTable(["p1", "p2"], { "Big Bolt": bolt, Bear: mk("Bear", { manaCost: "{1}", types: ["creature"], power: 2, toughness: 2 }, []) });
    t.give("p1", "Rith, Liberated Primeval", "battlefield");
    const bear = t.give("p2", "Bear", "battlefield"); t.give("p1", "Mountain", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Big Bolt", "hand"), targets: { t1: [bear] } }); drain(t);
    expect(t.state.turnLog.some((e) => e.type === "excess_damage")).toBe(true);
    for (let i = 0; i < 12 && String(t.state.turn.phase) !== "end_step"; i++) t.ok({ type: "advancePhase", player: "p1" });
    drain(t);
    expect(t.state.battlefield.some((id) => t.obj(id).token?.name === "Dragon" && t.obj(id).controller === "p1")).toBe(true);
  });
  it("no excess damage, no Dragon", () => {
    const t = realTable(["p1", "p2"], { "Small Bolt": instant("Small Bolt", "{R}", [{ kind: "damage_target", target: "t1", amount: 2 } as never], [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: { min: 1, max: 1 } }]), Bear: mk("Bear", { manaCost: "{1}", types: ["creature"], power: 2, toughness: 2 }, []) });
    t.give("p1", "Rith, Liberated Primeval", "battlefield");
    const bear = t.give("p2", "Bear", "battlefield"); t.give("p1", "Mountain", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Small Bolt", "hand"), targets: { t1: [bear] } }); drain(t);
    for (let i = 0; i < 12 && String(t.state.turn.phase) !== "end_step"; i++) t.ok({ type: "advancePhase", player: "p1" });
    drain(t);
    expect(t.state.battlefield.some((id) => t.obj(id).token?.name === "Dragon")).toBe(false);
  });
});

describe("Arena of Glory: exert, and haste for the creature spell the mana pays for", () => {
  it("is exerted (skips its next untap) and the creature spell gets haste", () => {
    const bear = mk("Bear", { manaCost: "{R}{R}", types: ["creature"], power: 2, toughness: 2 }, []);
    const t = realTable(["p1", "p2"], { Bear: bear });
    const arena = t.give("p1", "Arena of Glory", "battlefield"); t.give("p1", "Mountain", "battlefield");
    t.ok({ type: "activateAbility", player: "p1", sourceId: arena, abilityId: "a3" });
    expect(t.obj(arena).exerted).toBeDefined();
    const b = t.give("p1", "Bear", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: b }); drain(t);
    expect(t.obj(b).zone).toBe("battlefield");
    expect(charsOf(t, b).keywords).toContain("haste");
  });
});

describe("Roaming Throne: another creature of the chosen type triggers an additional time", () => {
  it("an ETB of an Elf makes two Treasures", () => {
    const elf = mk("Treasure Elf", { manaCost: "{1}", types: ["creature"], subtypes: ["Elf"], power: 1, toughness: 1 }, [{ id: "a1", kind: "triggered", text: "etb", trigger: { event: "etb", subject: "self" }, steps: [{ kind: "create_tokens", tokenCount: 1, tokenName: "Treasure", tokenColors: ["colorless"], tokenTypeLine: "Artifact — Treasure" }] } as never]);
    const t = realTable(["p1", "p2"], { "Treasure Elf": elf });
    const th = t.give("p1", "Roaming Throne", "battlefield"); t.obj(th).chosen = { type: "Elf" };
    t.give("p1", "Island", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Treasure Elf", "hand") }); drain(t);
    expect(t.state.battlefield.filter((id) => t.obj(id).token?.name === "Treasure").length).toBe(2);
    expect(charsOf(t, th).subtypes).toContain("Elf");
  });
});

describe("Scourge of the Throne: first attack each turn against the player with the most life", () => {
  it("is supported, untaps attackers and adds a combat only the first time it attacks", () => {
    expect(cardUnsupported(realDef("Scourge of the Throne")!).all).toEqual([]);
    const t = realTable(["p1", "p2"]);
    for (let i = 0; i < 6; i++) { t.give("p1", "Island", "library"); t.give("p2", "Island", "library"); }
    const s = t.give("p1", "Scourge of the Throne", "battlefield"); t.obj(s).controlledSince = -1;
    for (let i = 0; i < 4 && String(t.state.turn.phase) !== "declare_attackers"; i++) t.ok({ type: "advancePhase", player: "p1" });
    t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: s, defender: "p2" }] }); drain(t);
    expect(t.state.extraCombats).toBe(1);
    expect(t.obj(s).tapped).toBe(false);
  });
});
