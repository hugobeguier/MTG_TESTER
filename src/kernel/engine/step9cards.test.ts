// Kernel step 9: real-draft tests for protection, dredge, Living Death, unless-sacrifice (ward - Sacrifice a Food).
import { describe, expect, it } from "vitest";
import { filler, instant, mk, sorcery } from "./famkit";
import { cardUnsupported } from "./support";
import { realDef, realTable, charsOf } from "./testdb";
import type { Table } from "./testkit";

const humanZap = mk("Human Zap", { manaCost: "{R}", types: ["instant"], subtypes: ["Human"] }, [{ id: "a1", kind: "spell_effect", text: "zap", targets: [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: { min: 1, max: 1 } }], steps: [{ kind: "damage_target", target: "t1", amount: 3 }] } as never]);
const cards = { "Human Zap": humanZap, "Test Human": filler("Test Human", ["creature"], 2, 2, ["Human"]), "Test Elf": filler("Test Elf", ["creature"], 1, 1, ["Elf"]),
  "Hit It": instant("Hit It", "{R}", [{ kind: "damage_target", target: "t1", amount: 3 } as never], [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: { min: 1, max: 1 } }]) };
const rt = () => realTable(["p1", "p2"], cards);
const settle = (t: Table, yes = true) => { for (let i = 0; i < 20; i++) { const p = t.state.pending as never as { kind: string; player: string; id: string; options?: Array<{ id: string }> } | null; if (p) t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: p.kind === "choose_yes_no" || p.kind === "pay_unless" ? { yes, ids: [yes ? "yes" : "no"] } : { ids: p.options!.slice(0, 1).map((o) => o.id) } } as never); else if (t.state.stack.length) t.resolveTop(); else break; } };

describe("step 9 protection", () => {
  it("Yawgmoth is supported", () => { expect(cardUnsupported(realDef("Yawgmoth, Thran Physician")!).all).toEqual([]); });
  it("a Human cannot target it and its damage is prevented; a non-Human can", () => {
    const t = rt(); const y = t.give("p1", "Yawgmoth, Thran Physician", "battlefield");
    t.give("p2", "Mountain", "battlefield"); t.p("p2"); t.state.priority = "p2";
    expect(() => t.ok({ type: "castSpell", player: "p2", cardId: t.give("p2", "Hit It", "hand"), targets: { t1: [y] } })).not.toThrow(); // Hit It is not a Human
    expect(charsOf(t, y).keywords).toContain("protection");
    t.give("p2", "Mountain", "battlefield");
    expect(() => t.ok({ type: "castSpell", player: "p2", cardId: t.give("p2", "Human Zap", "hand"), targets: { t1: [y] } })).toThrow();
  });
});

const answer = (t: Table, pick: (o: Array<{ id: string }>) => string) => { const p = t.state.pending as never as { player: string; id: string; options: Array<{ id: string }> }; t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: { ids: [pick(p.options)] } } as never); };
const drawer = instant("Draw One", "{U}", [{ kind: "draw_cards", who: "you", amount: 1 } as never]);

describe("step 9 dredge", () => {
  it("Dakmor Salvage is supported", () => { expect(cardUnsupported(realDef("Dakmor Salvage")!).all).toEqual([]); });
  const setup = () => { const t = realTable(["p1", "p2"], { ...cards, "Draw One": drawer }); const d = t.give("p1", "Dakmor Salvage", "graveyard"); for (let i = 0; i < 6; i++) t.give("p1", "Test Elf", "library"); t.give("p1", "Island", "battlefield"); return { t, d }; };
  it("dredging mills N and returns the card to hand instead of drawing", () => {
    const { t, d } = setup();
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Draw One", "hand") }); t.resolveTop();
    expect(t.state.pending).toBeTruthy();
    answer(t, (o) => o[1].id);
    expect(t.obj(d).zone).toBe("hand");
    expect(t.p("p1").library.length).toBe(4);
  });
  it("declining draws a card normally", () => {
    const { t, d } = setup();
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Draw One", "hand") }); t.resolveTop();
    answer(t, (o) => o[0].id);
    expect(t.obj(d).zone).toBe("graveyard");
    expect(t.p("p1").library.length).toBe(5);
  });
});

describe("step 9 Living Death", () => {
  it("is supported; each player's creature cards return under their own control after the sacrifice", () => {
    expect(cardUnsupported(realDef("Living Death")!).all).toEqual([]);
    const t = realTable(["p1", "p2"], cards);
    const mine = t.give("p1", "Test Human", "graveyard"), theirs = t.give("p2", "Test Elf", "graveyard");
    const onBf = t.give("p1", "Test Elf", "battlefield");
    for (const c of ["Swamp", "Swamp", "Swamp", "Swamp", "Swamp"]) t.give("p1", c, "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Living Death", "hand") }); settle(t);
    expect(t.obj(onBf).zone).toBe("graveyard");
    expect(t.obj(mine).zone).toBe("battlefield");
    expect(t.obj(theirs).zone).toBe("battlefield");
    expect(t.obj(theirs).controller).toBe("p2");
    expect(t.obj(mine).controller).toBe("p1");
  });
});

describe("step 9 free casts (Omniscience, One with the Multiverse)", () => {
  it("both are supported", () => { for (const n of ["Omniscience", "One with the Multiverse"]) expect(cardUnsupported(realDef(n)!).all, n).toEqual([]); });
  it("Omniscience: a spell from hand is cast without paying its cost", () => {
    const t = realTable(["p1", "p2"], { ...cards, "Draw One": drawer });
    const om = t.give("p1", "Omniscience", "battlefield"); t.give("p1", "Island", "library");
    const card = t.give("p1", "Draw One", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: card, option: "free-hand:" + om });
    expect(t.obj(card).zone).toBe("stack");
    t.resolveTop();
    expect(t.p("p1").hand.length).toBe(1);
  });
  it("One with the Multiverse: free once per turn, from the library top too", () => {
    const t = realTable(["p1", "p2"], { ...cards, "Draw One": drawer });
    const om = t.give("p1", "One with the Multiverse", "battlefield");
    for (let i = 0; i < 3; i++) t.give("p1", "Island", "library");
    const top = t.give("p1", "Draw One", "library");
    const second = t.give("p1", "Draw One", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: top, option: "freecast1:" + om });
    expect(t.obj(top).zone).toBe("stack");
    expect(() => t.ok({ type: "castSpell", player: "p1", cardId: second, option: "freecast1:" + om })).toThrow(); // used up; no mana
  });
});

describe("step 9 constrained searches and land mana", () => {
  it("Protean Hulk, Tiamat, Myriad Landscape, Exotic Orchard, Reflecting Pool, The Ur-Dragon are supported", () => { for (const n of ["Protean Hulk", "Tiamat", "Myriad Landscape", "Exotic Orchard", "Reflecting Pool", "The Ur-Dragon"]) expect(cardUnsupported(realDef(n)!).all, n).toEqual([]); });
  const big = (n: string, mv: number) => mk(n, { manaCost: "{" + mv + "}", types: ["creature"], subtypes: ["Beast"], power: 1, toughness: 1 }, []);
  it("a total-mana-value search only offers cards that still fit", () => {
    const search = sorcery("Hulk Search", "{1}", [{ kind: "search_library", who: "you", filter: { types: ["creature"] }, count: "any", upTo: true, min: 0, totalManaValueAtMost: 6, to: "battlefield" } as never]);
    const t = realTable(["p1", "p2"], { ...cards, "Hulk Search": search, "Four A": big("Four A", 4), "Three B": big("Three B", 3), "Two C": big("Two C", 2), "Five D": big("Five D", 5) });
    t.give("p1", "Island", "battlefield");
    const a = t.give("p1", "Four A", "library"), b = t.give("p1", "Three B", "library"), c = t.give("p1", "Two C", "library"), d = t.give("p1", "Five D", "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Hulk Search", "hand") }); t.resolveTop();
    answer(t, () => a); // 4 so far: only the 2 still fits
    const p = t.state.pending as never as { options: Array<{ id: string }> };
    expect(p.options.map((o) => o.id)).toEqual([c]);
    answer(t, () => c);
    for (let i = 0; i < 3 && t.state.pending; i++) answer(t, () => "none");
    expect([t.obj(a).zone, t.obj(c).zone, t.obj(b).zone, t.obj(d).zone]).toEqual(["battlefield", "battlefield", "library", "library"]);
  });
  it("Myriad Landscape-style search only pairs lands that share a land type", () => {
    const search = sorcery("Pair Search", "{1}", [{ kind: "search_library", who: "you", filter: { types: ["land"], supertypes: ["basic"] }, count: 2, upTo: true, min: 0, sharesLandType: true, to: "hand" } as never]);
    const t = realTable(["p1", "p2"], { ...cards, "Pair Search": search });
    t.give("p1", "Island", "battlefield");
    const f1 = t.give("p1", "Forest", "library"), s1 = t.give("p1", "Swamp", "library"), f2 = t.give("p1", "Forest", "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Pair Search", "hand") }); t.resolveTop();
    answer(t, () => f1);
    const p = t.state.pending as never as { options: Array<{ id: string }> };
    expect(p.options.map((o) => o.id)).toEqual([f2]);
    expect(p.options.map((o) => o.id)).not.toContain(s1);
  });
  it("Exotic Orchard offers only colors an opponent's land could produce; Reflecting Pool reads your own lands", () => {
    const t = realTable(["p1", "p2"], cards);
    t.give("p2", "Forest", "battlefield"); t.give("p1", "Mountain", "battlefield");
    const orch = t.give("p1", "Exotic Orchard", "battlefield"), pool = t.give("p1", "Reflecting Pool", "battlefield");
    t.ok({ type: "activateAbility", player: "p1", sourceId: orch, abilityId: "a1", color: "G" });
    expect(t.p("p1").manaPool.G).toBe(1);
    expect(() => t.ok({ type: "activateAbility", player: "p1", sourceId: pool, abilityId: "a1", color: "G" })).toThrow();
    t.ok({ type: "activateAbility", player: "p1", sourceId: pool, abilityId: "a1", color: "R" });
    expect(t.p("p1").manaPool.R).toBe(1);
  });
  it("Syr Konrad: pings on a creature card milled into the graveyard (not from the battlefield) and when another creature dies", () => {
    expect(cardUnsupported(realDef("Syr Konrad, the Grim")!).all).toEqual([]);
    const mill = sorcery("Mill One", "{1}", [{ kind: "mill", who: "you", amount: 1 } as never]);
    const t = realTable(["p1", "p2"], { ...cards, "Mill One": mill });
    t.give("p1", "Syr Konrad, the Grim", "battlefield"); t.give("p1", "Island", "battlefield");
    t.give("p1", "Test Elf", "library");
    const life0 = t.p("p2").life;
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Mill One", "hand") }); settle(t);
    expect(t.p("p2").life).toBe(life0 - 1);
  });
  it("Animate Dead: reanimates the targeted creature card, is attached to it, and the creature is sacrificed when the Aura leaves", () => {
    expect(cardUnsupported(realDef("Animate Dead")!).all).toEqual([]);
    const smash = instant("Smash Ench", "{1}", [{ kind: "destroy_target", target: "t1" } as never], [{ id: "t1", what: "object", filter: { types: ["enchantment"] }, count: { min: 1, max: 1 } }]);
    const t = realTable(["p1", "p2"], { ...cards, "Smash Ench": smash });
    const dead = t.give("p1", "Test Human", "graveyard");
    for (let i = 0; i < 4; i++) t.give("p1", "Swamp", "battlefield");
    const ad = t.give("p1", "Animate Dead", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: ad, targets: { t1: [dead] } }); settle(t);
    expect(t.obj(dead).zone).toBe("battlefield");
    expect(t.obj(ad).zone).toBe("battlefield");
    expect(t.obj(ad).attachedTo).toBe(dead);
    t.give("p1", "Swamp", "battlefield"); t.give("p1", "Swamp", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Smash Ench", "hand"), targets: { t1: [ad] } }); settle(t);
    expect(t.obj(ad).zone).toBe("graveyard");
    expect(t.obj(dead).zone).toBe("graveyard");
  });
  it("Enhanced Surveillance adds two cards to every surveil; Heliod and Sphere of Safety are supported", () => {
    for (const n of ["Enhanced Surveillance", "Heliod, the Radiant Dawn", "Sphere of Safety"]) expect(cardUnsupported(realDef(n)!).all, n).toEqual([]);
    const surv = sorcery("Surveil One", "{1}", [{ kind: "surveil", who: "you", amount: 1 } as never]);
    const t = realTable(["p1", "p2"], { ...cards, "Surveil One": surv });
    t.give("p1", "Enhanced Surveillance", "battlefield"); t.give("p1", "Island", "battlefield");
    for (let i = 0; i < 5; i++) t.give("p1", "Test Elf", "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Surveil One", "hand") }); t.resolveTop();
    expect((t.state.pending as never as { options: unknown[] }).options.length).toBe(3);
  });
  it("Soaring Lightbringer: attacking creates a tapped, attacking Glimmer aimed at the defending player", () => {
    expect(cardUnsupported(realDef("Soaring Lightbringer")!).all).toEqual([]);
    const t = realTable(["p1", "p2"], cards);
    const sl = t.give("p1", "Soaring Lightbringer", "battlefield"); t.obj(sl).controlledSince = -1;
    for (let i = 0; i < 4 && t.state.turn.phase !== "declare_attackers"; i++) t.ok({ type: "advancePhase", player: "p1" });
    t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: sl, defender: "p2" }] });
    for (let i = 0; i < 6 && (t.state.stack.length || t.state.triggerQueue.length); i++) { if (t.state.stack.length) t.resolveTop(); else t.ok({ type: "passPriority", player: t.state.priority! }); }
    const glimmer = t.state.battlefield.map((id) => t.obj(id)).find((o) => o.cardName === "Glimmer" || o.token?.name === "Glimmer");
    expect(glimmer).toBeTruthy();
    expect(glimmer!.tapped).toBe(true);
    expect(t.state.combat!.attackers.some((a) => a.id === glimmer!.id && a.defender === "p2")).toBe(true);
  });
  it("Scavenger Regent // Exude Toxin shuffles itself into the library; Dracogenesis makes Dragon spells free", () => {
    for (const n of ["Scavenger Regent // Exude Toxin", "Dracogenesis", "Hellkite Tyrant"]) expect(cardUnsupported(realDef(n)!).all, n).toEqual([]);
    const t = realTable(["p1", "p2"], cards);
    for (let i = 0; i < 4; i++) t.give("p1", "Swamp", "battlefield");
    const sr = t.give("p1", "Scavenger Regent // Exude Toxin", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: sr, face: "Exude Toxin", x: 0 }); settle(t);
    expect(t.obj(sr).zone).toBe("library");
    const t2 = realTable(["p1", "p2"], { ...cards, "Test Dragon": filler("Test Dragon", ["creature"], 2, 2, ["Dragon"]) });
    const dg = t2.give("p1", "Dracogenesis", "battlefield");
    const d = t2.give("p1", "Test Dragon", "hand");
    t2.ok({ type: "castSpell", player: "p1", cardId: d, option: "free-hand:" + dg }); t2.resolveTop();
    expect(t2.obj(d).zone).toBe("battlefield");
  });
});
