// Kernel step 7: per-unit mana (restrictions, riders, lasting mana), "any combination" decisions, mana_spent, filter-land alternatives,
// Phyrexian mana as a real decision, hybrid mana abilities.
import { describe, expect, it } from "vitest";
import type { Step } from "../schema";
import { cardUnsupported } from "./support";
import { fam, filler, mk, sorcery } from "./famkit";
import { realTable } from "./testdb";
import { loadDraft } from "./testkit";
const realDef = (slug: string) => ({ name: slug, types: [] as string[], kernel: loadDraft(slug) });
import { famCards } from "./famkit";
import type { Table } from "./testkit";

const cast = (t: Table, name: string, extra: Record<string, unknown> = {}) => t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", name, "hand"), ...extra });
const addMana = (produces: object[], extra: object = {}) => sorcery("Mana Maker", "{1}", [{ kind: "add_mana", produces, ...extra } as Step]);
const dragon = filler("Test Dragon", ["creature"], 2, 2, ["Dragon"]);
const bear = filler("Test Bear", ["creature"], 2, 2, ["Bear"]);
const dragonCost = (name: string) => mk(name, { manaCost: "{R}{R}", types: ["creature"], subtypes: ["Dragon"], power: 2, toughness: 2 }, []);

describe("restricted mana units", () => {
  const setup = (spec: object[], extra: object = {}) => {
    const t = fam({ "Mana Maker": addMana(spec, extra), "Red Dragon": dragonCost("Red Dragon"), "Red Bear": mk("Red Bear", { manaCost: "{R}{R}", types: ["creature"], subtypes: ["Bear"], power: 1, toughness: 1 }, []) });
    t.give("p1", "Plains", "battlefield");
    cast(t, "Mana Maker");
    return t;
  };
  it("restricted mana goes to its own unit list, not the plain pool", () => {
    const t = setup([{ colors: "{R}{R}", restriction: { subtypes: ["Dragon"] } }]);
    t.resolveTop();
    expect(t.p("p1").manaPool.R).toBe(0);
    expect(t.p("p1").manaUnits).toHaveLength(2);
  });
  it("can pay for a spell it matches", () => {
    const t = setup([{ colors: "{R}{R}", restriction: { subtypes: ["Dragon"] } }]); t.resolveTop();
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Red Dragon", "hand") });
    expect(t.p("p1").manaUnits).toHaveLength(0);
    expect(t.state.stack).toHaveLength(1);
  });
  it("cannot pay for a spell it does not match (and nothing is spent)", () => {
    const t = setup([{ colors: "{R}{R}", restriction: { subtypes: ["Dragon"] } }]); t.resolveTop();
    const res = t.do({ type: "castSpell", player: "p1", cardId: t.give("p1", "Red Bear", "hand") });
    expect(res.error?.code).toBe("cannot_pay");
    expect(t.p("p1").manaUnits).toHaveLength(2);
  });
  it("spells-only restriction (zone stack) pays for any spell, not for abilities", () => {
    const t = setup([{ colors: "{R}{R}", restriction: { zone: "stack" } }]); t.resolveTop();
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Red Bear", "hand") });
    expect(t.p("p1").manaUnits).toHaveLength(0);
  });
  it("abilitiesOf lets Dragon-restricted mana pay for an ability of a Dragon", () => {
    const pinger = mk("Dragon Pinger", { manaCost: "{1}", types: ["creature"], subtypes: ["Dragon"], power: 1, toughness: 1 }, [{ id: "a1", kind: "activated", text: "{R}: gain 1 life", costs: [{ mana: "{R}" }], steps: [{ kind: "life_change", who: "you", lifeDelta: 1 }] }]);
    const t = fam({ "Mana Maker": addMana([{ colors: "{R}", restriction: { subtypes: ["Dragon"] }, abilitiesOf: { subtypes: ["Dragon"] } }]), "Dragon Pinger": pinger });
    t.give("p1", "Plains", "battlefield"); const p = t.give("p1", "Dragon Pinger", "battlefield");
    cast(t, "Mana Maker"); t.resolveTop();
    t.ok({ type: "activateAbility", player: "p1", sourceId: p, abilityId: "a1" });
    expect(t.p("p1").manaUnits).toHaveLength(0);
  });
  it("mana restricted to Dragons cannot pay for a non-Dragon's ability", () => {
    const pinger = mk("Bear Pinger", { manaCost: "{1}", types: ["creature"], subtypes: ["Bear"], power: 1, toughness: 1 }, [{ id: "a1", kind: "activated", text: "{R}: gain 1 life", costs: [{ mana: "{R}" }], steps: [{ kind: "life_change", who: "you", lifeDelta: 1 }] }]);
    const t = fam({ "Mana Maker": addMana([{ colors: "{R}", restriction: { subtypes: ["Dragon"] }, abilitiesOf: { subtypes: ["Dragon"] } }]), "Bear Pinger": pinger });
    t.give("p1", "Plains", "battlefield"); const p = t.give("p1", "Bear Pinger", "battlefield");
    cast(t, "Mana Maker"); t.resolveTop();
    expect(t.do({ type: "activateAbility", player: "p1", sourceId: p, abilityId: "a1" }).error?.code).toBe("cannot_pay");
  });
  it("restricted mana empties with the step like any other mana", () => {
    const t = setup([{ colors: "{R}", restriction: { subtypes: ["Dragon"] } }]); t.resolveTop();
    t.ok({ type: "advancePhase", player: "p1" });
    expect(t.p("p1").manaUnits ?? []).toHaveLength(0);
  });
  it("lasting mana (duration until end of turn) survives steps and phases, but not the turn", () => {
    const t = setup([{ colors: "{R}{G}" }], { duration: "until_end_of_turn" }); t.resolveTop();
    expect(t.p("p1").manaUnits).toHaveLength(2);
    t.ok({ type: "advancePhase", player: "p1" }); t.ok({ type: "advancePhase", player: "p1" });
    expect(t.p("p1").manaUnits).toHaveLength(2);
    for (let i = 0; i < 40 && t.state.turn.number === 1; i++) { if (t.state.pending) break; t.ok({ type: "advancePhase", player: t.state.turn.active }); }
    expect(t.p("p1").manaUnits ?? []).toHaveLength(0);
  });
  it("lasting mana can be spent in a later phase", () => {
    const t = setup([{ colors: "{R}{R}" }], { duration: "until_end_of_turn" }); t.resolveTop();
    for (let i = 0; i < 8 && t.state.turn.phase !== "postcombat_main"; i++) t.ok({ type: "advancePhase", player: "p1" });
    expect(t.p("p1").manaUnits).toHaveLength(2);
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Red Bear", "hand") });
    expect(t.p("p1").manaUnits).toHaveLength(0);
  });
  it("Desolation of Smaug / Klauth / Savage Ventmaw / Crucible of the Spirit Dragon are supported", () => {
    for (const n of ["desolation-of-smaug", "klauth-unrivaled-ancient", "savage-ventmaw", "crucible-of-the-spirit-dragon"]) expect(cardUnsupported(realDef(n)).all, n).toEqual([]);
  });
});

describe("any combination of colors", () => {
  const spec = [{ anyColorAmount: 3 }];
  it("asks ONE decision with an amount per color", () => {
    const t = fam({ "Mana Maker": addMana(spec) }); t.give("p1", "Plains", "battlefield");
    cast(t, "Mana Maker"); t.resolveTop();
    const p = t.state.pending!;
    expect(p.kind).toBe("assign_mana");
    expect(p.mana).toEqual({ total: 3, colors: ["W", "U", "B", "R", "G"] });
    t.ok({ type: "answerDecision", player: "p1", decisionId: p.id, choice: { assign: { R: 2, U: 1 } } });
    expect(t.p("p1").manaPool).toMatchObject({ R: 2, U: 1 });
  });
  it("amounts that do not add up, unknown colors and negative numbers are rejected", () => {
    const t = fam({ "Mana Maker": addMana(spec) }); t.give("p1", "Plains", "battlefield");
    cast(t, "Mana Maker"); t.resolveTop();
    const p = t.state.pending!;
    for (const assign of [{ R: 2 }, { R: 4 }, { X: 3 }, { R: 4, U: -1 }] as Array<Record<string, number>>) expect(t.do({ type: "answerDecision", player: "p1", decisionId: p.id, choice: { assign } }).error?.code).toBe("invalid_choice");
    expect(t.do({ type: "answerDecision", player: "p2", decisionId: p.id, choice: { assign: { R: 3 } } }).error?.code).toBe("not_your_decision");
  });
  it("combination mana can carry a restriction", () => {
    const t = fam({ "Mana Maker": addMana([{ anyColorAmount: 2, restriction: { subtypes: ["Dragon"] } }]) }); t.give("p1", "Plains", "battlefield");
    cast(t, "Mana Maker"); t.resolveTop();
    t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { assign: { R: 2 } } });
    expect(t.p("p1").manaUnits!.every((u) => u.restriction?.subtypes?.[0] === "Dragon")).toBe(true);
  });
});

describe("mana_spent predicate", () => {
  const brume = sorcery("Brume Test", "{W}", [{ kind: "life_change", who: "you", lifeDelta: 5, condition: { when: "on_resolution", if: { check: "mana_spent", color: "W" } } } as Step, { kind: "life_change", who: "you", lifeDelta: 7, condition: { when: "on_resolution", if: { check: "mana_spent", color: "B" } } } as Step]);
  it("is true only for the colors actually spent on the spell", () => {
    const t = fam({ "Brume Test": brume }); t.give("p1", "Plains", "battlefield");
    cast(t, "Brume Test"); t.resolveTop();
    expect(t.p("p1").life).toBe(45);
  });
  it("hybrid / generic payments record the colors that were used", () => {
    const hy = sorcery("Hybrid Test", "{W/B}", [{ kind: "life_change", who: "you", lifeDelta: 7, condition: { when: "on_resolution", if: { check: "mana_spent", color: "B" } } } as Step]);
    const t = fam({ "Hybrid Test": hy }); t.give("p1", "Swamp", "battlefield");
    cast(t, "Hybrid Test"); t.resolveTop();
    expect(t.p("p1").life).toBe(47);
  });
  it("Batwing Brume's predicate is understood by the support check", () => {
    expect(cardUnsupported(realDef("batwing-brume")).all).not.toContain("predicate:mana_spent");
  });
});

describe("riders on mana", () => {
  it("a unit with a rider queues its steps as a trigger when it is spent on a spell", () => {
    const t = fam({ "Mana Maker": sorcery("Mana Maker", "{1}", []), Bear: bear });
    t.give("p1", "Plains", "battlefield");
    const spell = t.give("p1", "Fill A", "hand");
    t.p("p1").manaUnits = [{ color: "C", rider: [{ kind: "life_change", who: "you", lifeDelta: 3 } as Step], restriction: { zone: "stack" } }];
    t.ok({ type: "castSpell", player: "p1", cardId: spell });
    expect(t.state.stack.length + t.state.triggerQueue.length).toBeGreaterThan(1);
    for (let i = 0; i < 6 && t.state.stack.length; i++) t.ok({ type: "passPriority", player: t.state.priority! });
    expect(t.p("p1").life).toBe(43);
  });
});

describe("Phyrexian mana in activated abilities and X", () => {
  it("an activated ability's Phyrexian symbol asks too", () => {
    const dev = mk("Phy Device", { manaCost: "{1}", types: ["artifact"] }, [{ id: "a1", kind: "activated", text: "{G/P}: gain 1", costs: [{ mana: "{G/P}" }], steps: [{ kind: "life_change", who: "you", lifeDelta: 1 }] }]);
    const t = fam({ "Phy Device": dev }); const d = t.give("p1", "Phy Device", "battlefield"); t.give("p1", "Forest", "battlefield");
    t.ok({ type: "activateAbility", player: "p1", sourceId: d, abilityId: "a1" });
    expect(t.state.pending!.kind).toBe("choose_option");
    t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { ids: ["life"] } });
    expect(t.p("p1").life).toBe(38);
  });
  it("cancelling the cast at the Phyrexian question puts the card back and pays nothing", () => {
    const t = fam({ "Phy Spell": sorcery("Phy Spell", "{G/P}", []) }); t.give("p1", "Forest", "battlefield");
    const c = t.give("p1", "Phy Spell", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: c });
    t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { cancel: true } });
    expect(t.obj(c).zone).toBe("hand"); expect(t.p("p1").life).toBe(40);
  });
});

describe("filter lands: hybrid cost, several-symbol alternatives (Fetid Heath)", () => {
  it("Fetid Heath / Twilight Mire are supported", () => { for (const n of ["fetid-heath", "twilight-mire"]) expect(cardUnsupported(realDef(n)).all, n).toEqual([]); });
  it("pay {W/B} and tap: choose WW, WB or BB", () => {
    const t = realTable(["p1", "p2"], famCards);
    const heath = t.give("p1", "Fetid Heath", "battlefield"); t.give("p1", "Swamp", "battlefield");
    t.ok({ type: "activateAbility", player: "p1", sourceId: heath, abilityId: "a2" });
    const p = t.state.pending!;
    expect(p.options.map((o) => o.id).sort()).toEqual(["BB", "WB", "WW"]);
    t.ok({ type: "answerDecision", player: "p1", decisionId: p.id, choice: { ids: ["WB"] } });
    expect(t.p("p1").manaPool).toMatchObject({ W: 1, B: 1 });
    expect(t.obj(heath).tapped).toBe(true);
  });
  it("cannot activate without mana for the hybrid cost", () => {
    const t = realTable(["p1", "p2"], famCards);
    const heath = t.give("p1", "Fetid Heath", "battlefield");
    expect(t.do({ type: "activateAbility", player: "p1", sourceId: heath, abilityId: "a2", color: "WW" }).error?.code).toBe("cannot_pay");
  });
  it("an answer that is not one of the alternatives is rejected via the shortcut", () => {
    const t = realTable(["p1", "p2"], famCards);
    const heath = t.give("p1", "Fetid Heath", "battlefield"); t.give("p1", "Swamp", "battlefield");
    expect(t.do({ type: "activateAbility", player: "p1", sourceId: heath, abilityId: "a2", color: "RR" }).error?.code).toBe("invalid_choice");
  });
  it("auto-tap never uses the filter land by itself (it needs a hand-made activation)", () => {
    const t = realTable(["p1", "p2"], famCards);
    t.give("p1", "Fetid Heath", "battlefield");
    const res = t.do({ type: "castSpell", player: "p1", cardId: t.give("p1", "Plains", "hand") });
    expect(res.error).toBeDefined();
  });
});
