// Kernel step 8, family 1: enters-with-counters replacements (Giada, Metallic Mimic) with real drafts.
import { describe, expect, it } from "vitest";
import { cardUnsupported } from "./support";
import { viewFor } from "./view";
import { filler, instant, mk, device } from "./famkit";
import { realDef, realTable, charsOf } from "./testdb";
import type { Table } from "./testkit";

const cards = { "Test Ench": mk("Test Ench", { manaCost: "{4}{W}", types: ["enchantment"] }, []), "Draw One": instant("Draw One", "{1}", [{ kind: "draw_cards", who: "you", amount: 1 } as never]), "Fill A": filler("Fill A"), "Kill It": instant("Kill It", "{1}", [{ kind: "destroy_target", target: "t1" } as never], [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: { min: 1, max: 1 } }]), "Test Angel": filler("Test Angel", ["creature"], 2, 2, ["Angel"]), "Test Elf": filler("Test Elf", ["creature"], 1, 1, ["Elf"]) };
const rt = () => realTable(["p1", "p2"], cards);
const settle = (t: Table) => { for (let i = 0; i < 8; i++) { if (t.state.pending) { const p = t.state.pending; if (p.kind === "choose_yes_no") t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: { yes: true } }); else break; } else if (t.state.stack.length) t.resolveTop(); else break; } };
const realChars = (t: Table, id: string) => charsOf(t, id);
const named = (t: Table, n: string) => t.state.battlefield.map((id) => t.obj(id)).find((o) => o.cardName === n)!;

describe("step 8.1 enters with additional counters", () => {
  it("Giada and Metallic Mimic are fully supported", () => { for (const n of ["Giada, Font of Hope", "Metallic Mimic"]) expect(cardUnsupported(realDef(n)!).all, n).toEqual([]); });
  it("Giada: another Angel enters with one counter per Angel already controlled", () => {
    const t = rt(); t.give("p1", "Giada, Font of Hope", "battlefield"); t.give("p1", "Test Angel", "battlefield"); t.give("p1", "Plains", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Test Angel", "hand") }); settle(t);
    const angels = t.state.battlefield.map((id) => t.obj(id)).filter((o) => o.cardName === "Test Angel");
    expect(angels.map((o) => o.counters["+1/+1"] ?? 0).sort()).toEqual([0, 2]); // Giada + the first Angel were already there
  });
  it("Giada does not buff a non-Angel", () => {
    const t = rt(); t.give("p1", "Giada, Font of Hope", "battlefield"); t.give("p1", "Plains", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Test Elf", "hand") }); settle(t);
    expect(named(t, "Test Elf").counters["+1/+1"] ?? 0).toBe(0);
  });
  it("Metallic Mimic: it is the chosen type, and other creatures of that type enter with a counter", () => {
    const t = rt(); const m = t.give("p1", "Metallic Mimic", "battlefield"); t.obj(m).chosen = { type: "Elf" }; t.give("p1", "Plains", "battlefield");
    expect(realChars(t, m).subtypes).toContain("Elf");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Test Elf", "hand") }); settle(t);
    expect(named(t, "Test Elf").counters["+1/+1"]).toBe(1);
  });
});

describe("step 8.1 undying granted by a static ability (Mikaeus, the Unhallowed)", () => {
  const kill = (t: Table, id: string) => { t.give("p1", "Swamp", "battlefield"); t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Kill It", "hand"), targets: { t1: [id] } }); settle(t); };
  it("Mikaeus is supported apart from its Human-damage trigger", () => { expect(cardUnsupported(realDef("Mikaeus, the Unhallowed")!).all).not.toContain("static"); });
  it("a non-Human with no counter comes back with a +1/+1 counter, once", () => {
    const t = rt(); t.give("p1", "Mikaeus, the Unhallowed", "battlefield"); const e = t.give("p1", "Test Elf", "battlefield");
    kill(t, e);
    expect(t.obj(e).zone).toBe("battlefield");
    expect(t.obj(e).counters["+1/+1"]).toBe(1);
    kill(t, e);
    expect(t.obj(e).zone).toBe("graveyard");
  });
});

describe("step 8.5 regression: cast_with asked about something that was not cast", () => {
  it("a land entering while Woe Strider is out does not ask Woe Strider's escape condition", () => {
    const t = rt(); t.give("p1", "Woe Strider", "battlefield");
    const res = t.do({ type: "playLand", player: "p1", cardId: t.give("p1", "Plains", "hand") });
    expect(res.error).toBeUndefined();
    expect(t.state.battlefield.map((id) => t.obj(id).cardName)).toContain("Plains");
  });
  it("Woe Strider put onto the battlefield without being cast simply does not escape", () => {
    const t = rt(); const w = t.give("p1", "Woe Strider", "graveyard");
    t.state.objects[w].zone = "graveyard";
    expect(() => t.give("p1", "Woe Strider", "battlefield")).not.toThrow();
  });
});

describe("step 8.2 Guardian Project (name_matches)", () => {
  it("is supported", () => { expect(cardUnsupported(realDef("Guardian Project")!).all).toEqual([]); });
  const cast = (t: Table, name: string) => { t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", name, "hand") }); settle(t); };
  it("draws for a creature with a new name, not for a repeat of a name you control or have in the graveyard", () => {
    const t = rt(); t.give("p1", "Guardian Project", "battlefield"); t.lands("p1", "Plains", 4);
    for (let i = 0; i < 4; i++) t.give("p1", "Plains", "library");
    const hand = () => t.p("p1").hand.length;
    cast(t, "Test Elf"); expect(t.p("p1").hand.length).toBe(1);
    cast(t, "Test Elf"); expect(t.p("p1").hand.length).toBe(1); // same name as the one in play
    t.give("p1", "Test Angel", "graveyard");
    cast(t, "Test Angel"); expect(t.p("p1").hand.length).toBe(1); // same name as a creature card in the graveyard
    cast(t, "Fill A"); expect(hand()).toBe(2);
  });
});

describe("step 8.2 Moseo, Vein's New Dean (life gained this turn)", () => {
  it("is supported", () => { expect(cardUnsupported(realDef("Moseo, Vein's New Dean")!).all).toEqual([]); });
  it("returns a creature card with mana value up to the life gained this turn at the end step", () => {
    const t = realTable(["p1", "p2"], { ...cards, "Gain Two": instant("Gain Two", "{1}", [{ kind: "life_change", who: "you", amount: 2 } as never]) });
    t.give("p1", "Moseo, Vein's New Dean", "battlefield"); t.give("p1", "Plains", "battlefield");
    const dead = t.give("p1", "Test Elf", "graveyard"), big = t.give("p1", "Giada, Font of Hope", "graveyard"); // mana value 1 and 3
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Gain Two", "hand") }); settle(t);
    expect(t.p("p1").life).toBe(42);
    for (let i = 0; i < 20 && t.state.turn.phase !== "end_step"; i++) t.ok({ type: "advancePhase", player: "p1" });
    for (let i = 0; i < 6 && (t.state.pending || t.state.stack.length); i++) { if (t.state.pending) { const p = t.state.pending; t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: p.kind === "choose_targets" ? { ids: [dead] } : { yes: true } } as never); } else t.resolveTop(); }
    expect(t.obj(dead).zone).toBe("battlefield");
    expect(t.obj(big).zone).toBe("graveyard");
  });
});

describe("step 8.2 mode memory and distinct targets", () => {
  const opts = (n: string) => ({ id: n, text: n, steps: [{ kind: "life_change", who: "you", amount: n === "m1" ? 1 : 2 }] });
  const dev = device("Mode Device", { costs: [], modes: { choose: { min: 1, max: 1 }, distinct: true, repeatRestriction: "this_turn", options: [opts("m1"), opts("m2")] } as never });
  it("a mode already chosen this turn is refused, the other one is allowed, and a new turn resets it", () => {
    const t = realTable(["p1", "p2"], { "Mode Device": dev }); const d = t.give("p1", "Mode Device", "battlefield");
    const act = (m: string) => t.do({ type: "activateAbility", player: "p1", sourceId: d, abilityId: "a1", modes: [m] } as never);
    expect(act("m1").error).toBeUndefined(); settle(t); expect(t.p("p1").life).toBe(41);
    expect(act("m1").error).toBeDefined();
    expect(act("m2").error).toBeUndefined(); settle(t); expect(t.p("p1").life).toBe(43);
    t.state.turn.number += 2; // a later turn
    expect(act("m1").error).toBeUndefined();
  });
  it("Parapet Thrasher and Shadrix Silverquill are supported", () => { for (const n of ["Parapet Thrasher", "Shadrix Silverquill"]) expect(cardUnsupported(realDef(n)!).all.filter((x) => x.startsWith("modes:")), n).toEqual([]); });
  it("distinctTargets: the second mode is not offered the player the first one targets", () => {
    const tg = [{ id: "t1", what: "player", count: { min: 1, max: 1 } }];
    const o = (n: string) => ({ id: n, text: n, targets: tg, steps: [{ kind: "life_change", who: "target_player", amount: 1 }] });
    const dd = device("Pair Device", { costs: [], modes: { choose: { min: 2, max: 2 }, distinct: true, distinctTargets: true, options: [o("m1"), o("m2")] } as never });
    const t = realTable(["p1", "p2"], { "Pair Device": dd }); const d = t.give("p1", "Pair Device", "battlefield");
    let res = t.ok({ type: "activateAbility", player: "p1", sourceId: d, abilityId: "a1" } as never);
    res = t.answer(res, { ids: ["m1", "m2"] });
    const first = t.state.pending!; expect(first.kind).toBe("choose_targets");
    res = t.answer(res, { ids: ["p1"] });
    const second = t.state.pending!; expect(second.kind).toBe("choose_targets");
    expect((second as never as { options: Array<{ id: string }> }).options.map((x) => x.id)).toEqual(["p2"]);
  });
});

describe("step 8.2 reflexive triggers (Skyfisher Spider, Obscura Storefront)", () => {
  it("Skyfisher Spider: sacrifice another creature, then choose and destroy a nonland permanent", () => {
    const t = rt(); const fodder = t.give("p1", "Test Elf", "battlefield"); const victim = t.give("p2", "Test Angel", "battlefield"); t.lands("p1", "Forest", 3); t.lands("p1", "Island", 3); t.lands("p1", "Mountain", 3); t.lands("p1", "Swamp", 2); t.lands("p1", "Plains", 2);
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Skyfisher Spider", "hand") });
    for (let i = 0; i < 12 && (t.state.pending || t.state.stack.length); i++) {
      const p = t.state.pending;
      if (!p) { t.resolveTop(); continue; }
      const opts = (p as never as { options?: Array<{ id: string }> }).options ?? [];
      t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: p.kind === "choose_yes_no" ? { yes: true } : { ids: [opts.find((o) => o.id === victim)?.id ?? opts[0].id] } } as never);
    }
    expect(t.obj(fodder).zone).toBe("graveyard");
    expect(t.obj(victim).zone).toBe("graveyard");
  });
  it("Obscura Storefront: sacrificed on entering, then fetches a basic Plains, Island or Swamp onto the battlefield", () => {
    const t = rt(); t.give("p1", "Swamp", "library");
    t.ok({ type: "playLand", player: "p1", cardId: t.give("p1", "Obscura Storefront", "hand") });
    for (let i = 0; i < 12 && (t.state.pending || t.state.stack.length); i++) {
      const p = t.state.pending;
      if (!p) { t.resolveTop(); continue; }
      const opts = (p as never as { options?: Array<{ id: string }> }).options ?? [];
      t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: p.kind === "choose_yes_no" ? { yes: true } : { ids: opts.length ? [opts[0].id] : [] } } as never);
    }
    expect(t.state.battlefield.map((id) => t.obj(id).cardName)).toEqual(["Swamp"]);
  });
});

describe("step 8.2 miracle granted by a static ability (Aminatou, Veil Piercer)", () => {
  const setup = () => {
    const t = rt(); t.give("p1", "Aminatou, Veil Piercer", "battlefield"); t.lands("p1", "Plains", 3); t.lands("p1", "Island", 2);
    t.give("p1", "Fill A", "library"); t.give("p1", "Test Ench", "library", { top: true });
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Draw One", "hand") });
    for (let i = 0; i < 6 && !t.state.pending && t.state.stack.length; i++) t.resolveTop();
    return t;
  };
  it("the first enchantment card drawn each turn offers a miracle cast for its mana cost reduced by {4}", () => {
    const t = setup();
    expect(t.state.pending?.kind).toBe("choose_yes_no");
    const rr = t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { yes: true } });
    const ench = t.p("p1").hand.concat(t.state.stack.map((i) => i.objectId!)).concat(t.state.battlefield).find((id) => t.obj(id).cardName === "Test Ench")!;
    expect(["stack", "battlefield"]).toContain(t.obj(ench).zone);
    expect(t.state.battlefield.filter((i) => t.obj(i).tapped && t.obj(i).cardName === "Plains")).toHaveLength(2); // Draw One {1} + miracle {W} (not {4}{W})
  });
});

describe("step 8.2 Magda, the Hoardmaster (commit a crime)", () => {
  it("targeting an opponent's creature makes one tapped Treasure, only once each turn", () => {
    expect(cardUnsupported(realDef("Magda, the Hoardmaster")!).all).toEqual([]);
    const t = rt(); t.give("p1", "Magda, the Hoardmaster", "battlefield"); t.lands("p1", "Plains", 4);
    const v1 = t.give("p2", "Test Elf", "battlefield"), v2 = t.give("p2", "Test Angel", "battlefield"), mine = t.give("p1", "Test Elf", "battlefield");
    const treasures = () => t.state.battlefield.filter((id) => t.obj(id).cardName === "Treasure");
    const kill = (id: string) => { t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Kill It", "hand"), targets: { t1: [id] } }); settle(t); };
    kill(mine); expect(treasures()).toHaveLength(0); // your own permanent is not a crime
    kill(v1); expect(treasures()).toHaveLength(1);
    expect(t.obj(treasures()[0]).tapped).toBe(true);
    kill(v2); expect(treasures()).toHaveLength(1);
  });
});

describe("step 8.2 Herald of Eternal Dawn (can't lose / can't win)", () => {
  it("the Herald's controller cannot lose, and the last opponent standing cannot win", () => {
    expect(cardUnsupported(realDef("Herald of Eternal Dawn")!).all).toEqual([]);
    const t = rt(); t.give("p1", "Herald of Eternal Dawn", "battlefield");
    t.p("p1").life = 0; t.p("p2").life = 0; // both at zero: p1 cannot lose, p2 loses
    t.ok({ type: "advancePhase", player: "p1" });
    expect(t.p("p1").hasLost).toBeFalsy(); expect(t.p("p2").hasLost).toBe(true);
    expect(t.state.gameOver?.winner).toBe("p1"); // its controller is not one of "your opponents": it can win
  });
  it("a lone survivor who is an opponent of the Herald does not win (recorded as a draw)", () => {
    const t = rt(); t.give("p2", "Herald of Eternal Dawn", "battlefield"); t.state.players[1].hasLost = true; // the Herald's controller is out (e.g. the Herald left), p1 is the opponent
    t.give("p1", "Herald of Eternal Dawn", "battlefield"); // p1 now also controls one; p2's Herald makes p1 an opponent of its controller
    t.state.players[1].hasLost = true; t.p("p1").life = 5;
    t.ok({ type: "advancePhase", player: "p1" });
    expect(t.state.gameOver?.winner).toBeUndefined();
    expect(t.state.gameOver?.draw).toBe(true);
  });
});

describe("step 8.4 top of library (Korlessa, Thundermane Dragon, One with the Multiverse)", () => {
  const dragons = { "Test Dragon": filler("Test Dragon", ["creature"], 4, 4, ["Dragon"]), "Test Land": mk("Test Land", { types: ["land"] }, []) };
  const tt = () => realTable(["p1", "p2"], { ...cards, ...dragons });
  it("the permissions are supported", () => { for (const n of ["Korlessa, Scale Singer", "One with the Multiverse"]) expect(cardUnsupported(realDef(n)!).all.filter((x) => /top|look|library/.test(x)), n).toEqual([]); });
  it("Korlessa: a Dragon on top can be cast from the library, a non-Dragon or a deeper card cannot", () => {
    const t = tt(); t.give("p1", "Korlessa, Scale Singer", "battlefield"); t.lands("p1", "Plains", 3);
    const deep = t.give("p1", "Test Dragon", "library"); const elf = t.give("p1", "Test Elf", "library", { top: true });
    expect(t.do({ type: "castSpell", player: "p1", cardId: elf }).error).toBeDefined();
    expect(t.do({ type: "castSpell", player: "p1", cardId: deep }).error).toBeDefined();
    const top = t.give("p1", "Test Dragon", "library", { top: true });
    t.ok({ type: "castSpell", player: "p1", cardId: top }); settle(t);
    expect(t.obj(top).zone).toBe("battlefield");
  });
  it("looking at the top card: its owner sees it in the view, nobody else does, and without the ability nobody does", () => {
    const t = tt(); const top = t.give("p1", "Test Dragon", "library", { top: true });
    expect(viewFor(t.state, "p1").players[0].topCard).toBeUndefined();
    t.give("p1", "Korlessa, Scale Singer", "battlefield"); t.lands("p1", "Plains", 1);
    t.ok({ type: "castSpell", player: "p1", cardId: top }); settle(t); // any action refreshes the lookers
    const t2 = tt(); const top2 = t2.give("p1", "Test Dragon", "library", { top: true }); t2.give("p1", "Korlessa, Scale Singer", "battlefield"); t2.give("p1", "Plains", "hand");
    t2.ok({ type: "playLand", player: "p1", cardId: t2.p("p1").hand[0] });
    expect(viewFor(t2.state, "p1").players[0].topCard).toBe(top2);
    expect(viewFor(t2.state, "p1").objects[top2]).toBeDefined();
    expect(viewFor(t2.state, "p2").players[0].topCard).toBeUndefined();
    expect(viewFor(t2.state, "p2").objects[top2]).toBeUndefined();
  });
  it("One with the Multiverse: a land on top can be played from the library", () => {
    const t = tt(); t.give("p1", "One with the Multiverse", "battlefield"); const land = t.give("p1", "Test Land", "library", { top: true });
    t.ok({ type: "playLand", player: "p1", cardId: land });
    expect(t.obj(land).zone).toBe("battlefield");
  });
  it("Thundermane Dragon: a power 4+ creature cast from the top gains haste this turn", () => {
    const t = tt(); t.give("p1", "Thundermane Dragon", "battlefield"); t.lands("p1", "Plains", 3);
    const top = t.give("p1", "Test Dragon", "library", { top: true });
    t.ok({ type: "castSpell", player: "p1", cardId: top }); settle(t);
    expect(charsOf(t, top).keywords).toContain("haste");
  });
});
