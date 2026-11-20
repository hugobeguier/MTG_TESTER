import { describe, expect, it } from "vitest";
import { table, type Table } from "./testkit";
import type { Action } from "./types";

const cast = (t: Table, who: string, id: string, extra: Partial<Extract<Action, { type: "castSpell" }>> = {}) => t.ok({ type: "castSpell", player: who, cardId: id, ...extra });
const opponentsTurn = (t: Table) => { t.state = { ...t.state, turn: { ...t.state.turn, active: "p2" }, priority: "p1" }; };

describe("Sphinx's Insight (cast_during main phase addendum)", () => {
  const setup = () => {
    const t = table();
    t.lands("p1", "Island", 4);
    for (let i = 0; i < 6; i++) t.give("p1", "Island", "library");
    const sphinx = t.give("p1", "Sphinx's Insight", "hand");
    return { t, sphinx };
  };

  it("cast in your own main phase: draw two and gain 2 life", () => {
    const { t, sphinx } = setup();
    cast(t, "p1", sphinx);
    expect(t.state.objects[sphinx].zone).toBe("stack");
    t.pass("p1", "p2");
    expect(t.p("p1").hand).toHaveLength(2);
    expect(t.p("p1").life).toBe(42);
    expect(t.state.objects[sphinx].zone).toBe("graveyard");
  });

  it("cast with instant timing on the opponent's turn: draw two, NO life", () => {
    const { t, sphinx } = setup();
    opponentsTurn(t);
    cast(t, "p1", sphinx);
    t.pass("p1", "p2");
    expect(t.p("p1").hand).toHaveLength(2);
    expect(t.p("p1").life).toBe(40);
  });

  it("cast in your own end step (not a main phase): no life", () => {
    const { t, sphinx } = setup();
    t.state = { ...t.state, turn: { ...t.state.turn, phase: "end_step" } };
    cast(t, "p1", sphinx);
    t.pass("p1", "p2");
    expect(t.p("p1").hand).toHaveLength(2);
    expect(t.p("p1").life).toBe(40);
  });

  it("the cast-time phase is remembered: passing priority into another step before resolution does not change the answer", () => {
    const { t, sphinx } = setup();
    cast(t, "p1", sphinx);
    expect(t.state.stack[0].cast).toMatchObject({ phase: "precombat_main", activePlayer: "p1", caster: "p1" });
  });

  it("mana is spent: 4 Islands pay {2}{U}{U} (autopay)", () => {
    const { t, sphinx } = setup();
    cast(t, "p1", sphinx);
    expect(t.state.battlefield.filter((id) => t.obj(id).tapped)).toHaveLength(4);
  });

  it("not enough mana: rejected and nothing changes", () => {
    const t = table();
    t.lands("p1", "Island", 3);
    const sphinx = t.give("p1", "Sphinx's Insight", "hand");
    const before = t.state;
    const res = t.do({ type: "castSpell", player: "p1", cardId: sphinx });
    expect(res.error?.code).toBe("cannot_pay");
    expect(res.state).toBe(before);
    expect(t.obj(sphinx).zone).toBe("hand");
  });
});

describe("Lightning Bolt (targets as a pending decision)", () => {
  it("returns a pending target prompt from the card JSON with legal options from the current board", () => {
    const t = table();
    t.give("p1", "Mountain", "battlefield");
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    const bear = t.give("p2", "Bear Cub", "battlefield");
    const res = cast(t, "p1", bolt);
    expect(res.pending).toMatchObject({ kind: "choose_targets", player: "p1", min: 1, max: 1 });
    expect(res.pending!.prompt.title).toBe("Lightning Bolt: choose a target");
    expect(res.pending!.options.map((o) => o.id).sort()).toEqual(["p1", "p2", bear].sort());
    // the spell being cast is on the stack, not a candidate and not in hand
    expect(t.obj(bolt).zone).toBe("stack");
    expect(t.p("p1").hand).not.toContain(bolt);
  });

  it("answering with a legal target puts the spell on the stack; resolving deals 3", () => {
    const t = table();
    t.give("p1", "Mountain", "battlefield");
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    const res = cast(t, "p1", bolt);
    t.answer(res, { ids: ["p2"] });
    expect(t.state.stack).toHaveLength(1);
    expect(t.state.pending).toBeNull();
    expect(t.state.priority).toBe("p1");
    t.pass("p1", "p2");
    expect(t.p("p2").life).toBe(37);
    expect(t.obj(bolt).zone).toBe("graveyard");
  });

  it("an illegal target answer is rejected and the decision stays open", () => {
    const t = table();
    t.give("p1", "Mountain", "battlefield");
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    const land = t.give("p2", "Mountain", "battlefield");
    const res = cast(t, "p1", bolt);
    const bad = t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: [land] } });
    expect(bad.error?.code).toBe("invalid_choice");
    expect(t.state.pending?.id).toBe(res.pending!.id);
    const none = t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: [] } });
    expect(none.error?.code).toBe("invalid_choice");
  });

  it("a shortcut target in the action is validated too", () => {
    const t = table();
    t.give("p1", "Mountain", "battlefield");
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    const land = t.give("p2", "Mountain", "battlefield");
    expect(t.do({ type: "castSpell", player: "p1", cardId: bolt, targets: { t1: [land] } }).error?.code).toBe("illegal_target");
    expect(t.state.pending).toBeNull();
  });

  it("a creature takes damage and dies to lethal damage (state-based action)", () => {
    const t = table();
    t.give("p1", "Mountain", "battlefield");
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    const bear = t.give("p2", "Bear Cub", "battlefield");
    cast(t, "p1", bolt, { targets: { t1: [bear] } });
    t.pass("p1", "p2");
    expect(t.obj(bear).zone).toBe("graveyard");
  });

  it("cancelling the cast puts the card back in hand at its old position and spends nothing", () => {
    const t = table();
    t.give("p1", "Mountain", "battlefield");
    const a = t.give("p1", "Island", "hand");
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    const b = t.give("p1", "Island", "hand");
    const res = cast(t, "p1", bolt);
    t.ok({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { cancel: true } });
    expect(t.p("p1").hand).toEqual([a, bolt, b]);
    expect(t.state.priority).toBe("p1");
    expect(t.state.stack).toHaveLength(0);
  });

  it("hexproof: a creature with hexproof is not offered as an opposing target", () => {
    const t = table();
    t.give("p1", "Mountain", "battlefield");
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    const cub = t.give("p2", "Bear Cub", "battlefield");
    t.state = { ...t.state, effects: [{ id: "e", timestamp: 9, objectId: cub, objectTimestamp: t.obj(cub).timestamp, grant: "hexproof", until: "end_of_turn" }] };
    const res = cast(t, "p1", bolt);
    expect(res.pending!.options.map((o) => o.id)).not.toContain(cub);
  });
});

describe("mana abilities: Sol Ring and Arcane Signet", () => {
  it("Sol Ring taps for {C}{C} into the pool without using the stack", () => {
    const t = table();
    const sol = t.give("p1", "Sol Ring", "battlefield");
    const res = t.ok({ type: "activateAbility", player: "p1", sourceId: sol, abilityId: "a1" });
    expect(t.p("p1").manaPool.C).toBe(2);
    expect(t.obj(sol).tapped).toBe(true);
    expect(t.state.stack).toHaveLength(0);
    expect(res.events.map((e) => e.type)).toContain("mana_added");
    expect(t.state.priority).toBe("p1");
  });

  it("a tapped Sol Ring cannot be used again", () => {
    const t = table();
    const sol = t.give("p1", "Sol Ring", "battlefield", { tapped: true });
    expect(t.do({ type: "activateAbility", player: "p1", sourceId: sol, abilityId: "a1" }).error?.code).toBe("cannot_activate");
  });

  it("pool mana pays for a spell: Sol Ring's {C}{C} casts Mind-Stone ({2})", () => {
    const t = table();
    const sol = t.give("p1", "Sol Ring", "battlefield");
    const stone = t.give("p1", "Mind-Stone", "hand");
    t.ok({ type: "activateAbility", player: "p1", sourceId: sol, abilityId: "a1" });
    cast(t, "p1", stone, { autoPay: false });
    expect(t.p("p1").manaPool.C).toBe(0);
    t.pass("p1", "p2");
    expect(t.obj(stone).zone).toBe("battlefield");
  });

  it("autoPay taps mana sources for the cost: Sol Ring then pays for a 2-drop", () => {
    const t = table();
    t.give("p1", "Sol Ring", "battlefield");
    const stone = t.give("p1", "Mind-Stone", "hand");
    cast(t, "p1", stone);
    expect(t.p("p1").manaPool.C).toBe(0);
    expect(t.state.stack).toHaveLength(1);
  });

  it("explicit payWith restricts which sources are tapped", () => {
    const t = table();
    const [a, b] = t.lands("p1", "Island", 2);
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    t.give("p1", "Mountain", "battlefield");
    const mtn = t.state.battlefield[t.state.battlefield.length - 1];
    cast(t, "p1", bolt, { targets: { t1: ["p2"] }, payWith: [mtn] });
    expect(t.obj(mtn).tapped).toBe(true);
    expect(t.obj(a).tapped).toBe(false);
    expect(t.obj(b).tapped).toBe(false);
  });

  it("autoPay: false with an empty pool is refused", () => {
    const t = table();
    t.give("p1", "Mountain", "battlefield");
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    expect(t.do({ type: "castSpell", player: "p1", cardId: bolt, autoPay: false, targets: { t1: ["p2"] } }).error?.code).toBe("cannot_pay");
  });

  it("colored requirements: {R} cannot be paid with an Island", () => {
    const t = table();
    t.give("p1", "Island", "battlefield");
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    expect(t.do({ type: "castSpell", player: "p1", cardId: bolt, targets: { t1: ["p2"] } }).error?.code).toBe("cannot_pay");
  });

  it("Arcane Signet asks which color (commander identity) and adds it", () => {
    const t = table();
    t.state = { ...t.state, players: t.state.players.map((p) => (p.id === "p1" ? { ...p, colorIdentity: ["W", "U"] } : p)) };
    const sig = t.give("p1", "Arcane Signet", "battlefield");
    const res = t.ok({ type: "activateAbility", player: "p1", sourceId: sig, abilityId: "a1" });
    expect(res.pending?.kind).toBe("choose_color");
    expect(res.pending?.options.map((o) => o.id)).toEqual(["W", "U"]);
    expect(t.obj(sig).tapped).toBe(false); // nothing happens until the color is chosen
    t.answer(res, { ids: ["U"] });
    expect(t.p("p1").manaPool.U).toBe(1);
    expect(t.obj(sig).tapped).toBe(true);
  });

  it("Arcane Signet: a color outside the commander's identity is refused", () => {
    const t = table();
    t.state = { ...t.state, players: t.state.players.map((p) => (p.id === "p1" ? { ...p, colorIdentity: ["W"] } : p)) };
    const sig = t.give("p1", "Arcane Signet", "battlefield");
    expect(t.do({ type: "activateAbility", player: "p1", sourceId: sig, abilityId: "a1", color: "R" }).error?.code).toBe("invalid_choice");
  });

  it("floating mana empties at the end of the step", () => {
    const t = table();
    const sol = t.give("p1", "Sol Ring", "battlefield");
    t.ok({ type: "activateAbility", player: "p1", sourceId: sol, abilityId: "a1" });
    t.ok({ type: "advancePhase", player: "p1" });
    expect(t.p("p1").manaPool.C).toBe(0);
  });

  it("dual lands with a pain clause: Caves of Koilos taps for W and deals 1 damage to its controller", () => {
    const t = table();
    const caves = t.give("p1", "Caves of Koilos", "battlefield");
    t.ok({ type: "activateAbility", player: "p1", sourceId: caves, abilityId: "a2" });
    expect(t.p("p1").manaPool.W).toBe(1);
    expect(t.p("p1").life).toBe(39);
  });
});

describe("modal spells", () => {
  const casualtiesTable = () => {
    const t = table();
    t.lands("p1", "Swamp", 2); t.lands("p1", "Forest", 2); t.lands("p1", "Plains", 2);
    const cow = t.give("p1", "Casualties of War", "hand");
    return { t, cow };
  };

  it("Valorous Stance: asks for the mode first (prompt from the card), then the target for that mode", () => {
    const t = table();
    t.lands("p1", "Plains", 2);
    const stance = t.give("p1", "Valorous Stance", "hand");
    const big = t.give("p2", "Bear Cub", "battlefield", { counters: { "+1/+1": 2 } }); // 4/4
    const res = cast(t, "p1", stance);
    expect(res.pending).toMatchObject({ kind: "choose_modes", min: 1, max: 1 });
    expect(res.pending!.prompt.title).toBe("Valorous Stance: choose a mode");
    expect(res.pending!.options.map((o) => o.id)).toEqual(["m1", "m2"]);
    const res2 = t.answer(res, { ids: ["m1"] });
    expect(res2.pending?.kind).toBe("choose_targets");
    expect(res2.pending!.options.map((o) => o.id)).toContain(big);
    t.answer(res2, { ids: [big] });
    t.pass("p1", "p2");
    // indestructible until end of turn
    const eff = t.state.effects.find((e) => e.grant === "indestructible");
    expect(eff?.objectId).toBe(big);
  });

  it("Valorous Stance: a mode with no legal target is not offered", () => {
    const t = table();
    t.lands("p1", "Plains", 2);
    const stance = t.give("p1", "Valorous Stance", "hand");
    t.give("p2", "Bear Cub", "battlefield"); // toughness 2: mode 2 needs toughness >= 4
    const res = cast(t, "p1", stance);
    expect(res.pending!.options.map((o) => o.id)).toEqual(["m1"]);
  });

  it("Valorous Stance: no creature at all means no legal mode and the cast is refused", () => {
    const t = table();
    t.lands("p1", "Plains", 2);
    const stance = t.give("p1", "Valorous Stance", "hand");
    expect(t.do({ type: "castSpell", player: "p1", cardId: stance }).error?.code).toBe("illegal_target");
    expect(t.obj(stance).zone).toBe("hand");
  });

  it("Valorous Stance: an illegal mode answer is rejected", () => {
    const t = table();
    t.lands("p1", "Plains", 2);
    const stance = t.give("p1", "Valorous Stance", "hand");
    t.give("p2", "Bear Cub", "battlefield");
    const res = cast(t, "p1", stance);
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: ["m2"] } }).error?.code).toBe("invalid_choice");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: ["m1", "m1"] } }).error?.code).toBe("invalid_choice");
  });

  it("Casualties of War: choose one or more (min 1, max 5, distinct); each chosen mode asks its own target", () => {
    const { t, cow } = casualtiesTable();
    const bear = t.give("p2", "Bear Cub", "battlefield");
    const sol = t.give("p2", "Sol Ring", "battlefield");
    const isl = t.give("p2", "Island", "battlefield");
    const res = cast(t, "p1", cow);
    expect(res.pending).toMatchObject({ kind: "choose_modes", min: 1, max: 3 }); // no enchantment/planeswalker in play: those modes are not offered
    expect(res.pending!.options).toHaveLength(3);
    let r2 = t.answer(res, { ids: ["m1", "m2", "m4"] });
    expect(r2.pending!.options.map((o) => o.id)).toEqual([sol]);
    r2 = t.answer(r2, { ids: [sol] });
    expect(r2.pending!.options.map((o) => o.id)).toContain(bear);
    r2 = t.answer(r2, { ids: [bear] });
    expect(r2.pending!.options.map((o) => o.id)).toContain(isl);
    t.answer(r2, { ids: [isl] });
    t.pass("p1", "p2");
    for (const id of [sol, bear, isl]) expect(t.obj(id).zone).toBe("graveyard");
  });

  it("Casualties of War: zero modes and duplicate modes are rejected (distinct)", () => {
    const { t, cow } = casualtiesTable();
    t.give("p2", "Bear Cub", "battlefield");
    const res = cast(t, "p1", cow);
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: [] } }).error?.code).toBe("invalid_choice");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: ["m2", "m2"] } }).error?.code).toBe("invalid_choice");
  });

  it("Casualties of War via the action shortcut (modes + targets)", () => {
    const { t, cow } = casualtiesTable();
    const bear = t.give("p2", "Bear Cub", "battlefield");
    cast(t, "p1", cow, { modes: ["m2"], targets: { t1: [bear] } });
    expect(t.state.stack).toHaveLength(1);
    expect(t.state.stack[0].parts).toHaveLength(1);
    t.pass("p1", "p2");
    expect(t.obj(bear).zone).toBe("graveyard");
  });

  it("repeatable modes: Triple Choice (choose three, same mode more than once)", () => {
    const t = table();
    t.lands("p1", "Mountain", 3);
    for (let i = 0; i < 5; i++) t.give("p1", "Island", "library");
    const tc = t.give("p1", "Triple Choice", "hand");
    const res = cast(t, "p1", tc);
    expect(res.pending).toMatchObject({ kind: "choose_modes", min: 3, max: 3, repeatable: true });
    // same mode three times is legal; two targets of mode 3 are asked separately
    let r2 = t.answer(res, { ids: ["m1", "m1", "m3"] });
    expect(r2.pending?.kind).toBe("choose_targets");
    t.answer(r2, { ids: ["p2"] });
    t.pass("p1", "p2");
    expect(t.p("p1").hand).toHaveLength(2);
    expect(t.p("p2").life).toBe(39);
  });

  it("repeatable modes: the same damage mode three times asks three targets and deals 3 total", () => {
    const t = table();
    t.lands("p1", "Mountain", 3);
    const tc = t.give("p1", "Triple Choice", "hand");
    let res = cast(t, "p1", tc);
    res = t.answer(res, { ids: ["m3", "m3", "m3"] });
    for (let i = 0; i < 3; i++) { expect(res.pending?.kind).toBe("choose_targets"); res = t.answer(res, { ids: ["p2"] }); }
    t.pass("p1", "p2");
    expect(t.p("p2").life).toBe(37);
  });

  it("a non-repeatable list may not use more modes than min/max allow", () => {
    const t = table();
    t.lands("p1", "Mountain", 3);
    const tc = t.give("p1", "Triple Choice", "hand");
    const res = cast(t, "p1", tc);
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: ["m1", "m1"] } }).error?.code).toBe("invalid_choice");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: ["m1", "m1", "m1", "m1"] } }).error?.code).toBe("invalid_choice");
  });
});

describe("X spells, optional steps, discard choices", () => {
  it("X is a pending numeric decision bounded by available mana; the spell deals X", () => {
    const t = table();
    t.lands("p1", "Mountain", 4);
    const fb = t.give("p1", "Fireball Lite", "hand");
    const res = cast(t, "p1", fb, { targets: { t1: ["p2"] } });
    expect(res.pending).toMatchObject({ kind: "choose_x", numeric: true, min: 0, max: 3 });
    expect(res.pending!.prompt.title).toContain("choose X");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { number: 4 } }).error?.code).toBe("invalid_choice");
    t.answer(res, { number: 3 });
    t.pass("p1", "p2");
    expect(t.p("p2").life).toBe(37);
    expect(t.state.battlefield.filter((id) => t.obj(id).tapped)).toHaveLength(4);
  });

  it("X given in the action skips the prompt", () => {
    const t = table();
    t.lands("p1", "Mountain", 3);
    const fb = t.give("p1", "Fireball Lite", "hand");
    cast(t, "p1", fb, { targets: { t1: ["p2"] }, x: 2 });
    expect(t.state.stack[0].x).toBe(2);
  });

  it("an optional ('may') step asks yes/no with the card's prompt; 'no' does nothing", () => {
    const t = table();
    t.lands("p1", "Island", 1);
    t.give("p1", "Island", "library");
    const peek = t.give("p1", "Curious Peek", "hand");
    cast(t, "p1", peek);
    let res = t.pass("p1", "p2");
    expect(res.pending?.kind).toBe("choose_yes_no");
    expect(res.pending!.prompt.title).toContain("optional");
    res = t.answer(res, { yes: false });
    expect(t.p("p1").hand).toHaveLength(0);
    expect(t.state.stack).toHaveLength(0);
  });

  it("an optional step answered yes performs the step", () => {
    const t = table();
    t.lands("p1", "Island", 1);
    t.give("p1", "Island", "library");
    const peek = t.give("p1", "Curious Peek", "hand");
    cast(t, "p1", peek);
    const res = t.pass("p1", "p2");
    t.answer(res, { yes: true });
    expect(t.p("p1").hand).toHaveLength(1);
  });

  it("discard: the TARGET player chooses, from their own hand only, and the spell itself is never an option", () => {
    const t = table();
    t.lands("p1", "Swamp", 3);
    const rot = t.give("p1", "Mind Rot", "hand");
    const mine = t.give("p1", "Island", "hand");
    const h1 = t.give("p2", "Island", "hand"), h2 = t.give("p2", "Mountain", "hand"), h3 = t.give("p2", "Plains", "hand");
    cast(t, "p1", rot, { targets: { t1: ["p2"] } });
    const res = t.pass("p1", "p2");
    expect(res.pending).toMatchObject({ kind: "choose_cards", player: "p2", min: 2, max: 2 });
    const ids = res.pending!.options.map((o) => o.id);
    expect(ids.sort()).toEqual([h1, h2, h3].sort());
    expect(ids).not.toContain(rot);
    expect(ids).not.toContain(mine);
    // the caster may not answer for the victim
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: [h1, h2] } }).error?.code).toBe("not_your_decision");
    // a card from another zone/player is not a legal answer
    expect(t.do({ type: "answerDecision", player: "p2", decisionId: res.pending!.id, choice: { ids: [h1, mine] } }).error?.code).toBe("invalid_choice");
    t.answer(res, { ids: [h1, h3] });
    expect(t.p("p2").hand).toEqual([h2]);
    expect(t.p("p2").graveyard).toEqual([h1, h3]);
  });

  it("discard with a hand no bigger than the amount discards everything without asking", () => {
    const t = table();
    t.lands("p1", "Swamp", 3);
    const rot = t.give("p1", "Mind Rot", "hand");
    t.give("p2", "Island", "hand");
    cast(t, "p1", rot, { targets: { t1: ["p2"] } });
    const res = t.pass("p1", "p2");
    expect(res.pending).toBeUndefined();
    expect(t.p("p2").hand).toHaveLength(0);
  });
});

describe("counterspells and fizzling", () => {
  it("Counterspell offers only spells on the stack (never itself) and counters the chosen one", () => {
    const t = table();
    t.give("p1", "Mountain", "battlefield");
    t.lands("p2", "Island", 2);
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    const cs = t.give("p2", "Counterspell", "hand");
    cast(t, "p1", bolt, { targets: { t1: ["p2"] } });
    t.pass("p1");
    const res = cast(t, "p2", cs);
    expect(res.pending!.options.map((o) => o.id)).toEqual([bolt]);
    t.answer(res, { ids: [bolt] });
    t.pass("p2", "p1");
    expect(t.state.stack).toHaveLength(0);
    expect(t.obj(bolt).zone).toBe("graveyard");
    expect(t.obj(cs).zone).toBe("graveyard");
    expect(t.p("p2").life).toBe(40);
  });

  it("Negate cannot target a creature spell", () => {
    const t = table();
    t.lands("p1", "Forest", 2);
    t.lands("p2", "Island", 2);
    const bear = t.give("p1", "Bear Cub", "hand");
    const neg = t.give("p2", "Negate", "hand");
    cast(t, "p1", bear);
    t.pass("p1");
    expect(t.do({ type: "castSpell", player: "p2", cardId: neg }).error?.code).toBe("illegal_target");
  });

  it("a counterspell with no spell to target cannot be cast", () => {
    const t = table();
    t.lands("p1", "Island", 2);
    const cs = t.give("p1", "Counterspell", "hand");
    expect(t.do({ type: "castSpell", player: "p1", cardId: cs }).error?.code).toBe("illegal_target");
  });

  it("a spell whose only target is gone fizzles (no effect, goes to the graveyard)", () => {
    const t = table();
    t.give("p1", "Mountain", "battlefield");
    t.give("p2", "Plains", "battlefield");
    const bear = t.give("p2", "Bear Cub", "battlefield");
    const pinger = t.give("p1", "Fizzle Pinger", "hand");
    const swords = t.give("p2", "Swords to Plowshares", "hand");
    cast(t, "p1", pinger, { targets: { t1: [bear] } });
    t.pass("p1");
    cast(t, "p2", swords, { targets: { t1: [bear] } });
    const res = t.pass("p2", "p1"); // swords resolves: bear exiled, p2 gains 2
    expect(t.obj(bear).zone).toBe("exile");
    expect(t.p("p2").life).toBe(42); // Swords: its controller gains life equal to its power (last known: 2)
    const res2 = t.resolveTop();
    expect(res2.events.map((e) => e.type)).toContain("spell_fizzled");
    expect(t.obj(pinger).zone).toBe("graveyard");
    expect(res).toBeDefined();
  });

  it("a second counterspell fizzles when the spell it targets was already countered", () => {
    const t = table();
    t.give("p1", "Mountain", "battlefield");
    t.lands("p2", "Island", 4);
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    const cs = t.give("p2", "Counterspell", "hand");
    const neg = t.give("p2", "Negate", "hand");
    cast(t, "p1", bolt, { targets: { t1: ["p2"] } });
    t.pass("p1");
    cast(t, "p2", neg, { targets: { t1: [bolt] } });
    cast(t, "p2", cs, { targets: { t1: [bolt] } });
    expect(t.state.stack).toHaveLength(3);
    t.pass("p2", "p1");               // Counterspell resolves, counters Bolt
    expect(t.obj(bolt).zone).toBe("graveyard");
    const res = t.resolveTop();       // Negate: its target is gone
    expect(res.events.map((e) => e.type)).toContain("spell_fizzled");
    expect(t.obj(neg).zone).toBe("graveyard");
    expect(t.p("p2").life).toBe(40);
  });

  it("a spell with one legal target left still resolves (partial fizzle)", () => {
    const t = table();
    t.lands("p1", "Mountain", 3);
    const tc = t.give("p1", "Triple Choice", "hand");
    const cub = t.give("p2", "Bear Cub", "battlefield");
    let res = cast(t, "p1", tc);
    res = t.answer(res, { ids: ["m3", "m3", "m2"] });
    res = t.answer(res, { ids: [cub] });
    res = t.answer(res, { ids: ["p2"] });
    t.state = { ...t.state, objects: { ...t.state.objects, [cub]: { ...t.obj(cub), zone: "graveyard" } }, battlefield: t.state.battlefield.filter((x) => x !== cub) };
    t.pass("p1", "p2");
    expect(t.p("p2").life).toBe(39);
    expect(t.p("p1").life).toBe(42);
  });
});
