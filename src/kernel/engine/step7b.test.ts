// Kernel step 7, batch B: batch triggers for non-combat events, improvise, "next spell" grants, flash / keep-mana player grants.
import { describe, expect, it } from "vitest";
import type { Ability, Step } from "../schema";
import { cardUnsupported } from "./support";
import { fam, famCards, filler, mk, sorcery } from "./famkit";
import { cantBeCountered } from "./layers";
import { runOf } from "./testcards";
import { loadDraft, type Table } from "./testkit";

const def = (slug: string) => ({ name: slug, types: [] as string[], kernel: loadDraft(slug) });
const ans = (t: Table, choice: object) => t.ok({ type: "answerDecision", player: t.state.pending!.player, decisionId: t.state.pending!.id, choice });
const pass = (t: Table) => { for (let i = 0; i < 20 && (t.state.stack.length || t.state.pending); i++) { const p = t.state.pending; if (p) { if (p.kind !== "order_triggers") return; ans(t, { ids: p.options.map((o) => o.id) }); } else t.ok({ type: "passPriority", player: t.state.priority! }); } };
const gain1: Step[] = [{ kind: "life_change", who: "you", lifeDelta: 1 }];
const watcher = (name: string, batch: boolean) => mk(name, { manaCost: "{1}", types: ["enchantment"] }, [{ id: "a1", kind: "triggered", text: "Whenever creatures die, gain 1.", trigger: { event: "dies", subject: { types: ["creature"] }, ...(batch ? { batch: true } : {}) }, steps: gain1 }]);
const wrath = sorcery("Wrath Test", "{1}", [{ kind: "destroy_all", filter: { types: ["creature"] } } as Step]);

describe("batch triggers (non-combat events)", () => {
  it("Morbid Opportunist / Willow Geist / Insidious Roots / Twilight Diviner are supported", () => {
    for (const n of ["morbid-opportunist", "willow-geist", "insidious-roots"]) expect(cardUnsupported(def(n)).all, n).toEqual([]);
  });
  it("one or more creatures dying at once triggers ONCE", () => {
    const t = fam({ W: watcher("W", true), Wrath: wrath }); t.give("p1", "W", "battlefield"); t.lands("p1", "Plains", 1);
    for (const n of ["Fill A", "Fill B", "Fill C"]) t.give("p2", n, "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Wrath", "hand") }); pass(t);
    expect(t.p("p1").life).toBe(41);
  });
  it("without 'batch' each dying creature triggers", () => {
    const t = fam({ W: watcher("W", false), Wrath: wrath }); t.give("p1", "W", "battlefield"); t.lands("p1", "Plains", 1);
    for (const n of ["Fill A", "Fill B", "Fill C"]) t.give("p2", n, "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Wrath", "hand") }); pass(t);
    expect(t.p("p1").life).toBe(43);
  });
  it("two separate resolutions are two batches", () => {
    const kill = sorcery("Kill One", "{1}", [{ kind: "destroy_target", target: "t1" } as Step], [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: { min: 1, max: 1 } }]);
    const t = fam({ W: watcher("W", true), "Kill One": kill }); t.give("p1", "W", "battlefield"); t.lands("p1", "Plains", 2);
    const a = t.give("p2", "Fill A", "battlefield"), b = t.give("p2", "Fill B", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Kill One", "hand"), targets: { t1: [a] } }); pass(t);
    t.state.priority = "p1";
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Kill One", "hand"), targets: { t1: [b] } }); pass(t);
    expect(t.p("p1").life).toBe(42);
  });
  it("cards leaving a graveyard: one trigger for several cards (Willow Geist shape)", () => {
    const geist = mk("Geist Test", { manaCost: "{1}", types: ["creature"], power: 1, toughness: 1 }, [{ id: "a2", kind: "triggered", text: "Whenever one or more cards leave your graveyard, +1/+1 counter.", trigger: { event: "leaves", subject: { zone: "graveyard", owner: "you" }, fromZone: "graveyard", batch: true }, steps: [{ kind: "add_counters", on: "self", counterKind: "+1/+1", amount: 1 } as Step] }]);
    const rez = sorcery("Rez Test", "{1}", [{ kind: "move_card_zone", who: "you", from: "graveyard", all: true, moveTo: "hand" } as Step]);
    const t = fam({ "Geist Test": geist, "Rez Test": rez });
    const g = t.give("p1", "Geist Test", "battlefield"); t.lands("p1", "Plains", 1);
    t.give("p1", "Fill A", "graveyard"); t.give("p1", "Fill B", "graveyard"); t.give("p1", "Fill C", "graveyard");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Rez Test", "hand") }); pass(t);
    expect(t.obj(g).counters["+1/+1"]).toBe(1);
  });
  it("leaves-the-battlefield triggers are NOT fooled by graveyard departures", () => {
    const lb = mk("Leave Watcher", { manaCost: "{1}", types: ["enchantment"] }, [{ id: "a1", kind: "triggered", text: "Whenever a creature leaves the battlefield, gain 1.", trigger: { event: "leaves", subject: { types: ["creature"] } }, steps: gain1 }]);
    const rez = sorcery("Rez Test", "{1}", [{ kind: "move_card_zone", who: "you", from: "graveyard", all: true, moveTo: "hand" } as Step]);
    const t = fam({ "Leave Watcher": lb, "Rez Test": rez }); t.give("p1", "Leave Watcher", "battlefield"); t.lands("p1", "Plains", 1);
    t.give("p1", "Fill A", "graveyard");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Rez Test", "hand") }); pass(t);
    expect(t.p("p1").life).toBe(40);
  });
  it("entering from a graveyard (etb fromZone) is distinguished from entering from hand", () => {
    const e = mk("Grave Watcher", { manaCost: "{1}", types: ["enchantment"] }, [{ id: "a1", kind: "triggered", text: "Whenever creatures enter from a graveyard, gain 1.", trigger: { event: "etb", subject: { types: ["creature"] }, batch: true, fromZone: "graveyard" }, steps: gain1 }]);
    const rez = sorcery("Rez All", "{1}", [{ kind: "move_card_zone", who: "you", from: "graveyard", all: true, moveTo: "battlefield" } as Step]);
    const t = fam({ "Grave Watcher": e, "Rez All": rez }); t.give("p1", "Grave Watcher", "battlefield"); t.lands("p1", "Plains", 1);
    t.give("p1", "Fill A", "graveyard"); t.give("p1", "Fill B", "graveyard");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Rez All", "hand") }); pass(t);
    expect(t.p("p1").life).toBe(41);
    const hand = t.give("p1", "Fill C", "hand");
    t.state.priority = "p1";
    void hand;
  });
});

describe("improvise", () => {
  const imp = mk("Imp Spell", { manaCost: "{3}{U}", types: ["sorcery"] }, [
    { id: "k", kind: "keyword", text: "Improvise", keyword: { name: "improvise" }, scripted: { handler: "improvise" } } as Ability,
    { id: "a1", kind: "spell_effect", text: "gain 5", steps: [{ kind: "life_change", who: "you", lifeDelta: 5 } as Step] }
  ]);
  const setup = (artifacts: number) => {
    const t = fam({ "Imp Spell": imp }); t.give("p1", "Island", "battlefield");
    const arts = Array.from({ length: artifacts }, () => t.give("p1", "Fill Artifact", "battlefield"));
    return { t, arts };
  };
  it("asks which artifacts to tap; each pays {1} of the generic part", () => {
    const { t, arts } = setup(3);
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Imp Spell", "hand") });
    expect(t.state.pending!.kind).toBe("choose_cards");
    expect(t.state.pending!.max).toBe(3);
    ans(t, { ids: arts });
    expect(arts.every((a) => t.obj(a).tapped)).toBe(true);
    expect(t.state.stack).toHaveLength(1);
  });
  it("cannot be paid: not enough mana left after improvise", () => {
    const { t, arts } = setup(1);
    const res = t.do({ type: "castSpell", player: "p1", cardId: t.give("p1", "Imp Spell", "hand"), improvise: arts });
    expect(res.error?.code).toBe("cannot_pay");
  });
  it("shortcut: tapping three artifacts with an Island pays {3}{U} fully", () => {
    const { t, arts } = setup(3);
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Imp Spell", "hand"), improvise: arts });
    expect(t.state.stack).toHaveLength(1);
    expect(t.state.battlefield.filter((i) => t.obj(i).tapped)).toHaveLength(4);
  });
  it("a tapped artifact or a non-artifact is not a legal choice", () => {
    const { t, arts } = setup(2);
    t.state.objects[arts[0]].tapped = true;
    const other = t.give("p1", "Fill A", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Imp Spell", "hand") });
    const p = t.state.pending!;
    expect(p.options.map((o) => o.id)).toEqual([arts[1]]);
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: p.id, choice: { ids: [other] } }).error?.code).toBe("invalid_choice");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: p.id, choice: { ids: [arts[0]] } }).error?.code).toBe("invalid_choice");
  });
  it("no artifacts: no question", () => {
    const { t } = setup(0);
    t.lands("p1", "Island", 3);
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Imp Spell", "hand") });
    expect(t.state.pending).toBeNull();
  });
  it("Kappa Cannoneer / Reverse Engineer / Saheeli's Directive are supported", () => {
    for (const n of ["kappa-cannoneer", "reverse-engineer", "saheeli-s-directive"]) expect(cardUnsupported(def(n)).all, n).toEqual([]);
  });
});

describe("the next spell you cast this turn ...", () => {
  const grantCard = (g: object) => mk("Granter", { manaCost: "{1}", types: ["artifact"] }, [{ id: "a1", kind: "activated", text: "{T}: next spell", costs: [{ tap: "self" }], steps: [{ kind: "grant_effect", who: "you", appliesTo: "next_spell_cast", modify: [g], duration: "until_end_of_turn" } as Step] }]);
  const plain = mk("Plain Spell", { manaCost: "{3}{U}", types: ["sorcery"] }, [{ id: "a1", kind: "spell_effect", text: "gain 5", steps: [{ kind: "life_change", who: "you", lifeDelta: 5 } as Step] }]);
  it("improvise: the next spell can be paid with artifacts; the grant is used up by it", () => {
    const t = fam({ Granter: grantCard({ grant: "improvise" }), "Plain Spell": plain }); t.give("p1", "Island", "battlefield");
    const g = t.give("p1", "Granter", "battlefield"); const arts = [1, 2, 3].map(() => t.give("p1", "Fill Artifact", "battlefield"));
    t.ok({ type: "activateAbility", player: "p1", sourceId: g, abilityId: "a1" }); pass(t);
    expect(t.state.durableEffects!.some((d) => d.nextSpell)).toBe(true);
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Plain Spell", "hand"), improvise: arts });
    expect(t.state.stack).toHaveLength(1);
    expect(t.state.durableEffects!.some((d) => d.nextSpell)).toBe(false);
  });
  it("without the grant the same spell cannot improvise", () => {
    const t = fam({ "Plain Spell": plain }); t.give("p1", "Island", "battlefield");
    const arts = [1, 2, 3].map(() => t.give("p1", "Fill Artifact", "battlefield"));
    const res = t.do({ type: "castSpell", player: "p1", cardId: t.give("p1", "Plain Spell", "hand"), improvise: arts });
    expect(res.error).toBeDefined();
  });
  it("cancelling the cast keeps the grant", () => {
    const t = fam({ Granter: grantCard({ grant: "improvise" }), "Plain Spell": plain }); t.give("p1", "Island", "battlefield");
    const g = t.give("p1", "Granter", "battlefield"); t.give("p1", "Fill Artifact", "battlefield");
    t.ok({ type: "activateAbility", player: "p1", sourceId: g, abilityId: "a1" }); pass(t);
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Plain Spell", "hand") });
    ans(t, { cancel: true });
    expect(t.state.durableEffects!.some((d) => d.nextSpell)).toBe(true);
  });
  it("affinity for artifacts: costs {1} less for each artifact", () => {
    const t = fam({ Granter: grantCard({ grant: "affinity for artifacts" }), "Plain Spell": plain }); t.lands("p1", "Island", 1);
    const g = t.give("p1", "Granter", "battlefield"); t.give("p1", "Fill Artifact", "battlefield"); t.give("p1", "Fill Artifact", "battlefield");
    t.ok({ type: "activateAbility", player: "p1", sourceId: g, abilityId: "a1" }); pass(t);
    // 3 artifacts (the Granter too): {3}{U} costs {U}
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Plain Spell", "hand") });
    expect(t.state.stack).toHaveLength(1);
  });
  it("can't be countered: the spell on the stack cannot be countered", () => {
    const t = fam({ Granter: grantCard({ cant: "be_countered" }), "Plain Spell": plain }); t.lands("p1", "Island", 4);
    const g = t.give("p1", "Granter", "battlefield");
    t.ok({ type: "activateAbility", player: "p1", sourceId: g, abilityId: "a1" }); pass(t);
    const spell = t.give("p1", "Plain Spell", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: spell });
    expect(cantBeCountered(runOf(t.state), spell)).toBe(true);
  });
  it("Saheeli the Gifted / Archway of Innovation / Mistrise Village are supported", () => {
    for (const n of ["saheeli-the-gifted", "archway-of-innovation", "mistrise-village"]) expect(cardUnsupported(def(n)).all, n).toEqual([]);
  });
  it("another player's next spell is unaffected", () => {
    const t = fam({ Granter: grantCard({ grant: "improvise" }), "Plain Spell": plain }); t.give("p1", "Island", "battlefield");
    const g = t.give("p1", "Granter", "battlefield");
    t.ok({ type: "activateAbility", player: "p1", sourceId: g, abilityId: "a1" }); pass(t);
    t.lands("p2", "Island", 4); t.state.turn.active = "p2"; t.state.priority = "p2";
    t.ok({ type: "castSpell", player: "p2", cardId: t.give("p2", "Plain Spell", "hand") });
    expect(t.state.durableEffects!.some((d) => d.nextSpell)).toBe(true);
  });
});

describe("player grants: flash for some spells, keep unspent red mana", () => {
  const myr = mk("Flash Myr", { manaCost: "{1}", types: ["creature"], power: 1, toughness: 1 }, [{ id: "s1", kind: "static", text: "You may cast artifact spells as though they had flash.", static: { affects: "you", modify: [{ grant: "cast artifact spells as though they had flash" }] } }]);
  const gadget = mk("Gadget", { manaCost: "{1}", types: ["artifact"] }, []);
  const toCombat = (t: Table) => { for (let i = 0; i < 6 && t.state.turn.phase !== "beginning_of_combat"; i++) t.ok({ type: "advancePhase", player: "p1" }); };
  it("an artifact spell can be cast at instant speed, a creature spell cannot", () => {
    const t = fam({ "Flash Myr": myr, Gadget: gadget }); t.give("p1", "Flash Myr", "battlefield"); t.lands("p1", "Plains", 3);
    toCombat(t);
    expect(t.do({ type: "castSpell", player: "p1", cardId: t.give("p1", "Gadget", "hand") }).error).toBeUndefined();
    expect(t.do({ type: "castSpell", player: "p1", cardId: t.give("p1", "Fill A", "hand") }).error?.code).toBe("wrong_timing");
  });
  it("without the permanent there is no flash", () => {
    const t = fam({ Gadget: gadget }); t.lands("p1", "Plains", 2); toCombat(t);
    expect(t.do({ type: "castSpell", player: "p1", cardId: t.give("p1", "Gadget", "hand") }).error?.code).toBe("wrong_timing");
  });
  it("only its controller benefits", () => {
    const t = fam({ "Flash Myr": myr, Gadget: gadget }); t.give("p2", "Flash Myr", "battlefield"); t.lands("p1", "Plains", 2); toCombat(t);
    expect(t.do({ type: "castSpell", player: "p1", cardId: t.give("p1", "Gadget", "hand") }).error?.code).toBe("wrong_timing");
  });
  it("Shimmer Myr and Yeva are understood", () => {
    expect(cardUnsupported(def("shimmer-myr")).all).not.toContain("static:affects:you");
    expect(cardUnsupported(def("yeva-nature-s-herald")).all).not.toContain("static:affects:you");
  });
  it("keep unspent red mana between steps: red stays, other colors empty", () => {
    const tyr = mk("Red Keeper", { manaCost: "{1}", types: ["creature"], power: 1, toughness: 1 }, [{ id: "s1", kind: "static", text: "You do not lose unspent red mana as steps and phases end.", static: { affects: "you", modify: [{ grant: "keep_unspent_red_mana_between_steps_and_phases" }] } }]);
    const t = fam({ "Red Keeper": tyr }); t.give("p1", "Red Keeper", "battlefield");
    t.state.players[0].manaPool = { W: 1, U: 0, B: 0, R: 2, G: 1, C: 0 };
    t.ok({ type: "advancePhase", player: "p1" });
    expect(t.p("p1").manaPool).toEqual({ W: 0, U: 0, B: 0, R: 2, G: 0, C: 0 });
  });
});

void filler; void famCards;
