// Kernel step 7, batch C: miracle, evoke, becomes_target with a filter subject, damage-prevention shields on abilities (Spore Frog).
import { describe, expect, it } from "vitest";
import { cardUnsupported } from "./support";
import { famCards, filler, mk } from "./famkit";
import { realDef, realTable } from "./testdb";
import { eventsFor, pendingFor, viewFor } from "./view";
import type { Table } from "./testkit";

const ans = (t: Table, choice: object) => t.ok({ type: "answerDecision", player: t.state.pending!.player, decisionId: t.state.pending!.id, choice });
const pass = (t: Table) => { for (let i = 0; i < 20 && (t.state.stack.length || t.state.pending); i++) { const p = t.state.pending; if (p) { if (p.kind !== "order_triggers") return; ans(t, { ids: p.options.map((o) => o.id) }); } else t.ok({ type: "passPriority", player: t.state.priority! }); } };
const study = mk("Study Test", { manaCost: "{U}", types: ["sorcery"] }, [{ id: "a1", kind: "spell_effect", text: "Draw two.", steps: [{ kind: "draw_cards", who: "you", amount: 2 }] }]);
const world = () => realTable(["p1", "p2"], { ...famCards, "Study Test": study });

describe("miracle", () => {
  it("Devastation Tide / Redress Fate / Temporal Mastery are supported", () => { for (const n of ["Devastation Tide", "Redress Fate", "Temporal Mastery"]) expect(cardUnsupported(realDef(n)!).all, n).toEqual([]); });
  const setup = () => {
    const t = world(); t.lands("p1", "Island", 3);
    t.give("p1", "Fill A", "library"); t.give("p1", "Fill B", "library");
    const tide = t.give("p1", "Devastation Tide", "library"); // on top: drawn FIRST
    const victim = t.give("p2", "Fill C", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Study Test", "hand") });
    pass(t);
    return { t, tide, victim };
  };
  it("the first card drawn this turn triggers a miracle offer", () => {
    const { t, tide } = setup();
    expect(t.state.pending!.kind).toBe("choose_yes_no");
    expect(t.state.pending!.player).toBe("p1");
    expect(t.obj(tide).zone).toBe("hand");
  });
  it("yes: it is cast for the miracle cost ({1}{U}) right away and resolves", () => {
    const { t, tide, victim } = setup();
    ans(t, { yes: true });
    expect(t.obj(tide).zone).toBe("stack");
    expect(t.state.battlefield.filter((i) => t.obj(i).tapped)).toHaveLength(3); // Study {U} + miracle {1}{U}
    pass(t);
    expect(t.obj(victim).zone).toBe("hand");
  });
  it("no: the card just stays in hand", () => {
    const { t, tide } = setup();
    ans(t, { no: true, yes: false });
    expect(t.obj(tide).zone).toBe("hand");
    expect(t.state.stack).toHaveLength(0);
  });
  it("only the drawing player may answer; the other player sees no options", () => {
    const { t } = setup();
    const p = t.state.pending!;
    expect(t.do({ type: "answerDecision", player: "p2", decisionId: p.id, choice: { yes: true } }).error?.code).toBe("not_your_decision");
    expect((pendingFor(t.state.pending, "p2") as { options: unknown[] }).options).toEqual([]);
  });
  it("the second card drawn does not trigger (only the first of the turn)", () => {
    const t = world(); t.lands("p1", "Island", 3);
    const tide = t.give("p1", "Devastation Tide", "library"); t.give("p1", "Fill A", "library"); // Fill A on top
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Study Test", "hand") });
    pass(t);
    expect(t.obj(tide).zone).toBe("hand");
    expect(t.state.pending).toBeNull();
  });
  it("a card drawn when it is not the first draw this turn is never offered, even later", () => {
    const t = world(); t.lands("p1", "Island", 3);
    t.give("p1", "Fill A", "library"); t.give("p1", "Fill B", "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Study Test", "hand") }); pass(t);
    t.give("p1", "Devastation Tide", "library");
    t.state.priority = "p1";
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Study Test", "hand") }); pass(t);
    expect(t.state.pending).toBeNull();
  });
  it("the miracle cost is not available when casting normally from hand", () => {
    const t = world(); t.lands("p1", "Island", 6);
    const tide = t.give("p1", "Devastation Tide", "hand");
    expect(t.do({ type: "castSpell", player: "p1", cardId: tide, option: "c1" }).error?.code).toBe("invalid_choice");
  });
  it("Temporal Mastery's miracle gives an extra turn", () => {
    const t = world(); t.lands("p1", "Island", 3);
    for (const p of ["p1", "p2"]) for (let i = 0; i < 10; i++) t.give(p, "Fill A", "library");
    t.give("p1", "Temporal Mastery", "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Study Test", "hand") }); pass(t);
    ans(t, { yes: true }); pass(t);
    expect(t.state.extraTurns).toEqual(["p1"]);
  });
});

describe("evoke", () => {
  it("Shriekmaw is supported", () => { expect(cardUnsupported(realDef("Shriekmaw")!).all).toEqual([]); });
  it("evoked: costs the evoke cost, its enter trigger happens, and it is sacrificed", () => {
    const t = world(); t.lands("p1", "Swamp", 2);
    const victim = t.give("p2", "Fill C", "battlefield");
    const sm = t.give("p1", "Shriekmaw", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: sm, option: "c1" });
    expect(t.state.battlefield.filter((i) => t.obj(i).tapped)).toHaveLength(2);
    pass(t);
    if (t.state.pending?.kind === "choose_targets") { ans(t, { ids: [victim] }); pass(t); }
    expect(t.obj(sm).zone).toBe("graveyard");
    expect(t.obj(victim).zone).toBe("graveyard");
  });
  it("cast normally it stays on the battlefield", () => {
    const t = world(); t.lands("p1", "Swamp", 5);
    t.give("p2", "Fill C", "battlefield");
    const sm = t.give("p1", "Shriekmaw", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: sm, option: "normal" });
    pass(t);
    if (t.state.pending?.kind === "choose_targets") { ans(t, { ids: [t.state.pending.options[0].id] }); pass(t); }
    expect(t.obj(sm).zone).toBe("battlefield");
  });
  it("evoke needs the evoke mana: one land is not enough", () => {
    const t = world(); t.lands("p1", "Swamp", 1);
    expect(t.do({ type: "castSpell", player: "p1", cardId: t.give("p1", "Shriekmaw", "hand"), option: "c1" }).error?.code).toBe("cannot_pay");
  });
});

describe("becomes_target with a filter subject", () => {
  const dragon = filler("Test Dragon", ["creature"], 2, 2, ["Dragon"]);
  const bolt = mk("Test Bolt", { manaCost: "{R}", types: ["instant"] }, [{ id: "a1", kind: "spell_effect", text: "target creature", targets: [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: { min: 1, max: 1 } }], steps: [{ kind: "life_change", who: "you", lifeDelta: 0 }] }]);
  it("Thunderbreak Regent / Scalelord Reckoner are supported", () => { for (const n of ["Thunderbreak Regent", "Scalelord Reckoner"]) expect(cardUnsupported(realDef(n)!).all, n).toEqual([]); });
  it("an opponent targeting my Dragon makes Thunderbreak Regent deal 3 damage to them", () => {
    const t = realTable(["p1", "p2"], { ...famCards, "Test Dragon": dragon, "Test Bolt": bolt });
    t.give("p1", "Thunderbreak Regent", "battlefield"); const d = t.give("p1", "Test Dragon", "battlefield");
    t.lands("p2", "Mountain", 1); t.state.turn.active = "p2"; t.state.priority = "p2";
    t.ok({ type: "castSpell", player: "p2", cardId: t.give("p2", "Test Bolt", "hand"), targets: { t1: [d] } });
    pass(t);
    expect(t.p("p2").life).toBe(37);
  });
  it("my own spell targeting my Dragon does nothing", () => {
    const t = realTable(["p1", "p2"], { ...famCards, "Test Dragon": dragon, "Test Bolt": bolt });
    t.give("p1", "Thunderbreak Regent", "battlefield"); const d = t.give("p1", "Test Dragon", "battlefield");
    t.lands("p1", "Mountain", 1);
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Test Bolt", "hand"), targets: { t1: [d] } });
    pass(t);
    expect(t.p("p1").life).toBe(40); expect(t.p("p2").life).toBe(40);
  });
  it("a non-Dragon of mine being targeted does not trigger it", () => {
    const t = realTable(["p1", "p2"], { ...famCards, "Test Bolt": bolt });
    t.give("p1", "Thunderbreak Regent", "battlefield"); const a = t.give("p1", "Fill A", "battlefield");
    t.lands("p2", "Mountain", 1); t.state.turn.active = "p2"; t.state.priority = "p2";
    t.ok({ type: "castSpell", player: "p2", cardId: t.give("p2", "Test Bolt", "hand"), targets: { t1: [a] } });
    pass(t);
    expect(t.p("p2").life).toBe(40);
  });
});

describe("damage-prevention shields written on abilities (Spore Frog)", () => {
  it("Spore Frog / Arachnogenesis are supported", () => { for (const n of ["Spore Frog", "Arachnogenesis"]) expect(cardUnsupported(realDef(n)!).all, n).toEqual([]); });
  it("sacrificing it prevents all combat damage this turn", () => {
    const t = realTable(["p1", "p2"], famCards);
    const frog = t.give("p1", "Spore Frog", "battlefield"); const atk = t.give("p2", "Big Elf", "battlefield");
    t.state.turn.active = "p2"; t.state.priority = "p1";
    t.ok({ type: "activateAbility", player: "p1", sourceId: frog, abilityId: "a1" });
    expect(t.obj(frog).zone).toBe("graveyard");
    t.ok({ type: "passPriority", player: t.state.priority! }); t.ok({ type: "passPriority", player: t.state.priority! });
    expect(t.state.durableEffects!.some((d) => d.replacement)).toBe(true);
    for (let i = 0; i < 4 && t.state.turn.phase !== "declare_attackers"; i++) t.ok({ type: "advancePhase", player: "p2" });
    t.ok({ type: "declareAttackers", player: "p2", attackers: [{ id: atk, defender: "p1" }] });
    for (let i = 0; i < 12 && t.state.turn.phase !== "end_of_combat" && !t.state.pending; i++) { if (t.state.combat?.expect) { t.ok({ type: "advancePhase", player: t.state.combat.expect.kind === "blockers" ? t.state.combat.expect.players[0] : "p2" }); continue; } t.ok({ type: "advancePhase", player: "p2" }); }
    expect(t.p("p1").life).toBe(40);
  });
  it("the shield ends with the turn", () => {
    const t = realTable(["p1", "p2"], famCards);
    const frog = t.give("p1", "Spore Frog", "battlefield");
    t.ok({ type: "activateAbility", player: "p1", sourceId: frog, abilityId: "a1" });
    t.ok({ type: "passPriority", player: "p1" }); t.ok({ type: "passPriority", player: "p2" });
    for (let i = 0; i < 40 && t.state.turn.number === 1; i++) { if (t.state.pending) break; t.ok({ type: "advancePhase", player: t.state.turn.active }); }
    expect((t.state.durableEffects ?? []).filter((d) => d.replacement)).toHaveLength(0);
  });
});

describe("hidden information still holds for the new features", () => {
  it("a miracle draw by p1 leaks no card name to p2 (events, queue labels)", () => {
    const t = world(); t.lands("p1", "Island", 3);
    t.give("p1", "Fill A", "library"); t.give("p1", "Fill B", "library"); t.give("p1", "Devastation Tide", "library");
    const res = t.do({ type: "castSpell", player: "p1", cardId: t.give("p1", "Study Test", "hand") });
    const rest = t.resolveTop();
    const evs = [...res.events, ...rest.events];
    const seen = JSON.stringify(eventsFor(t.state, "p2", evs)) + JSON.stringify(viewFor(t.state, "p2").triggerQueue);
    expect(seen).not.toContain("Devastation Tide");
  });
  it("p2 never sees p1's decision options or the exiled hideaway card name", () => {
    const t = world(); t.lands("p1", "Island", 3);
    t.give("p1", "Fill A", "library"); t.give("p1", "Fill B", "library"); t.give("p1", "Devastation Tide", "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Study Test", "hand") }); pass(t);
    expect(JSON.stringify(viewFor(t.state, "p2").pending)).not.toContain("Devastation");
  });
  it("restricted mana units are public information (everyone sees the pool)", () => {
    const t = world();
    t.state.players[0].manaUnits = [{ color: "R", restriction: { subtypes: ["Dragon"] } }];
    expect(viewFor(t.state, "p2").players[0].manaUnits).toHaveLength(1);
  });
});
