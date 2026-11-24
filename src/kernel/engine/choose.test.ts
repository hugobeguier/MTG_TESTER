// step:choose (cards, numbers, modes, colors) and the saved-choice references later steps read; Brainstorm, Archaeomancer's Map
// and hand-authored cards for the forms the drafts do not exercise.

import { describe, expect, it } from "vitest";
import type { Step } from "../schema";
import { cardUnsupported } from "./support";
import { fam, famCards, instant, mk, sorcery } from "./famkit";
import { lookup } from "./testkit";

const cast = (t: ReturnType<typeof fam>, id: string, player = "p1") => t.ok({ type: "castSpell", player, cardId: id });
const stack = (t: ReturnType<typeof fam>) => t.resolveTop();

function brainstormTable() {
  const t = fam();
  t.give("p1", "Island", "battlefield");
  for (const n of ["Fill A", "Fill B", "Fill C", "Fill D"]) t.give("p1", n, "library"); // top = Fill D
  const held = t.give("p1", "Fill E", "hand");
  const bs = t.give("p1", "Brainstorm", "hand");
  return { t, held, bs };
}

describe("Brainstorm: draw three, then choose two cards from hand", () => {
  it("is fully supported", () => { expect(cardUnsupported(lookup("Brainstorm")!).all).toEqual([]); });

  it("asks for 2 cards among the CURRENT hand (the drawn cards included, the spell itself excluded)", () => {
    const { t, held, bs } = brainstormTable();
    cast(t, bs);
    const res = stack(t);
    expect(res.pending).toMatchObject({ kind: "choose_cards", player: "p1", min: 2, max: 2 });
    const ids = res.pending!.options.map((o) => o.id);
    expect(ids).toHaveLength(4); // Fill E + three drawn
    expect(ids).toContain(held);
    expect(ids).not.toContain(bs);
    expect(res.pending!.options.map((o) => o.label).sort()).toEqual(["Fill B", "Fill C", "Fill D", "Fill E"]);
    expect(res.pending!.prompt.instruction).toBe("Choose 2 cards in your hand.");
  });

  it("then asks the order of the two cards going on top and puts the first named on top", () => {
    const { t, held, bs } = brainstormTable();
    cast(t, bs);
    const res = stack(t);
    const keep = res.pending!.options.find((o) => o.label === "Fill B")!.id;
    const second = t.answer(res, { ids: [held, keep] });
    expect(second.pending).toMatchObject({ kind: "order_library", min: 2, max: 2 });
    expect(second.pending!.options.map((o) => o.id).sort()).toEqual([held, keep].sort());
    const done = t.answer(second, { ids: [keep, held] });
    expect(done.pending).toBeUndefined();
    expect(t.p("p1").library.slice(0, 2)).toEqual([keep, held]);
    expect(t.p("p1").hand).toHaveLength(2);
    expect(t.state.stack).toHaveLength(0);
    expect(t.obj(bs).zone).toBe("graveyard");
  });

  it("the other order puts the other card on top", () => {
    const { t, held, bs } = brainstormTable();
    cast(t, bs);
    const res = stack(t);
    const keep = res.pending!.options.find((o) => o.label === "Fill B")!.id;
    const second = t.answer(res, { ids: [held, keep] });
    t.answer(second, { ids: [held, keep] });
    expect(t.p("p1").library.slice(0, 2)).toEqual([held, keep]);
  });

  it("a card put back on top is a new object that can be drawn again", () => {
    const { t, held, bs } = brainstormTable();
    cast(t, bs);
    const res = stack(t);
    const keep = res.pending!.options.find((o) => o.label === "Fill B")!.id;
    const ts = t.obj(held).timestamp;
    const second = t.answer(res, { ids: [held, keep] });
    t.answer(second, { ids: [held, keep] });
    expect(t.obj(held).timestamp).toBeGreaterThan(ts);
    expect(t.obj(held).zone).toBe("library");
  });

  it("rejects an answer from the wrong player, a stale decision id and a card that is not an option", () => {
    const { t, bs } = brainstormTable();
    cast(t, bs);
    const res = stack(t);
    const ids = res.pending!.options.map((o) => o.id);
    expect(t.do({ type: "answerDecision", player: "p2", decisionId: res.pending!.id, choice: { ids: ids.slice(0, 2) } }).error?.code).toBe("not_your_decision");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: "d999", choice: { ids: ids.slice(0, 2) } }).error?.code).toBe("wrong_decision");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: [ids[0], "#999"] } }).error?.code).toBe("invalid_choice");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: [ids[0]] } }).error?.code).toBe("invalid_choice");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: [ids[0], ids[0]] } }).error?.code).toBe("invalid_choice");
    expect(t.state.pending?.id).toBe(res.pending!.id);
    expect(t.do({ type: "passPriority", player: "p1" }).error?.code).toBe("decision_pending");
  });

  it("with fewer cards in hand than the count nothing is asked (all of them are chosen)", () => {
    const t = fam();
    t.give("p1", "Island", "battlefield");
    t.give("p1", "Fill A", "library");
    const bs = t.give("p1", "Brainstorm", "hand");
    cast(t, bs);
    const res = stack(t);
    expect(res.pending).toBeUndefined();
    expect(t.p("p1").hand).toHaveLength(0);
    expect(t.p("p1").hasLost).toBe(true); // one card for three draws: drew from an empty library and left the game (CR 800.4a)
  });

  it("is deterministic: the same game and answers give the same state and events", () => {
    const run = () => {
      const { t, held, bs } = brainstormTable();
      cast(t, bs);
      const res = stack(t);
      const keep = res.pending!.options.find((o) => o.label === "Fill B")!.id;
      const second = t.answer(res, { ids: [held, keep] });
      const done = t.answer(second, { ids: [keep, held] });
      return JSON.stringify([t.state, res.events, second.events, done.events]);
    };
    expect(run()).toBe(run());
  });
});

describe("Archaeomancer's Map: search for up to two basic Plains, reveal, hand, shuffle", () => {
  const setup = () => {
    const t = fam();
    t.lands("p1", "Plains", 3);
    for (const n of ["Plains", "Plains", "Plains", "Island", "Fill A"]) t.give("p1", n, "library");
    const map = t.give("p1", "Archaeomancer's Map", "hand");
    cast(t, map);
    t.resolveTop(); // the artifact spell enters
    const res = stack(t); // its trigger resolves -> search question
    return { t, map, res };
  };

  it("is fully supported", () => { expect(cardUnsupported(lookup("Archaeomancer's Map")!).all).toEqual([]); });

  it("interchangeable candidates (three basic Plains): no question, the two the text allows go to hand, revealed, then shuffled", () => {
    const { t, res } = setup();
    expect(res.pending).toBeUndefined();
    expect(t.state.pending).toBeNull();
    expect(t.p("p1").hand.filter((id) => t.obj(id).cardName === "Plains")).toHaveLength(2);
    expect(t.p("p1").library).toHaveLength(3);
    const types = res.events.map((e) => e.type);
    expect(types).toContain("search_auto");
    expect(types.indexOf("reveal")).toBeLessThan(types.indexOf("shuffle"));
    expect(res.events.find((e) => e.type === "reveal")).toMatchObject({ player: "p1", names: ["Plains", "Plains"] });
  });

  it("only one Plains left: that one is taken (no question); none left: no question, a log event, still shuffles", () => {
    const one = fam(); one.lands("p1", "Plains", 3); for (const n of ["Plains", "Island"]) one.give("p1", n, "library");
    cast(one, one.give("p1", "Archaeomancer's Map", "hand")); one.resolveTop(); const r1 = stack(one);
    expect(r1.pending).toBeUndefined();
    expect(one.p("p1").hand.map((id) => one.obj(id).cardName)).toEqual(["Plains"]);
    const none = fam(); none.lands("p1", "Plains", 3); none.give("p1", "Island", "library");
    cast(none, none.give("p1", "Archaeomancer's Map", "hand")); none.resolveTop(); const r0 = stack(none);
    expect(r0.pending).toBeUndefined();
    expect(none.p("p1").hand).toHaveLength(0);
    expect(r0.events.find((e) => e.type === "search_auto")).toMatchObject({ count: 0 });
    expect(r0.events.map((e) => e.type)).toContain("shuffle");
  });

  it("the shuffle is the seeded one: the same game shuffles the same way", () => {
    const a = setup(); const b = setup();
    expect(a.t.p("p1").library).toEqual(b.t.p("p1").library);
  });

  it("the second trigger: an opponent's land puts one of your hand lands onto the battlefield (optional choose, optional move)", () => {
    const t = fam();
    t.give("p1", "Archaeomancer's Map", "battlefield");
    t.lands("p2", "Forest", 2);
    const hl = t.give("p1", "Plains", "hand");
    t.give("p1", "Fill A", "hand");
    t.give("p2", "Mountain", "hand");
    t.state = { ...t.state, turn: { ...t.state.turn, active: "p2" }, priority: "p2" };
    t.ok({ type: "playLand", player: "p2", cardId: t.p("p2").hand[0] });
    let res = t.resolveTop();
    // ONE "you may put a land card from your hand onto the battlefield" question; with a single land in hand there is nothing more to choose
    expect(res.pending).toMatchObject({ kind: "choose_yes_no", player: "p1" });
    res = t.answer(res, { yes: true });
    expect(res.pending).toBeUndefined();
    expect(t.obj(hl)).toMatchObject({ zone: "battlefield", controller: "p1" });
  });

  it("declining the optional put leaves the land in hand", () => {
    const t = fam();
    t.give("p1", "Archaeomancer's Map", "battlefield");
    t.lands("p2", "Forest", 2);
    const hl = t.give("p1", "Plains", "hand");
    t.give("p2", "Mountain", "hand");
    t.state = { ...t.state, turn: { ...t.state.turn, active: "p2" }, priority: "p2" };
    t.ok({ type: "playLand", player: "p2", cardId: t.p("p2").hand[0] });
    let res = t.resolveTop();
    res = t.answer(res, { yes: false }); // the single "you may" is asked once
    expect(res.pending).toBeUndefined();
    expect(t.obj(hl).zone).toBe("hand");
  });
});

describe("choose: numbers, modes, colors and saved results", () => {
  const countSpell = sorcery("Count Spell", "{U}", [
    { kind: "choose", id: "n1", choice: "number", min: 0, max: 3 } as Step,
    { kind: "draw_cards", amount: { ref: "step_result", step: "n1" }, who: "you" } as Step
  ]);
  const withLib = (extra: Record<string, ReturnType<typeof sorcery>> = {}) => {
    const t = fam({ "Count Spell": countSpell, ...extra });
    t.give("p1", "Island", "battlefield");
    for (const n of ["Fill A", "Fill B", "Fill C", "Fill D", "Fill E"]) t.give("p1", n, "library");
    return t;
  };

  it("choose a number: numeric decision with min and max, the answer is a later quantity (step_result)", () => {
    const t = withLib();
    cast(t, t.give("p1", "Count Spell", "hand"));
    const res = stack(t);
    expect(res.pending).toMatchObject({ kind: "choose_number", numeric: true, min: 0, max: 3, player: "p1" });
    t.answer(res, { number: 2 });
    expect(t.p("p1").hand).toHaveLength(2);
  });

  it("a number out of range, or ids instead of a number, are rejected", () => {
    const t = withLib();
    cast(t, t.give("p1", "Count Spell", "hand"));
    const res = stack(t);
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { number: 4 } }).error?.code).toBe("invalid_choice");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { number: -1 } }).error?.code).toBe("invalid_choice");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: ["x"] } }).error?.code).toBe("invalid_choice");
  });

  it("zero is a legal number", () => {
    const t = withLib();
    cast(t, t.give("p1", "Count Spell", "hand"));
    t.answer(stack(t), { number: 0 });
    expect(t.p("p1").hand).toHaveLength(0);
  });

  it("choose a mode from named options; the decision lists them as options", () => {
    const modeSpell = sorcery("Mode Spell", "{U}", [
      { kind: "choose", id: "m1", choice: "mode", options: ["left", "right"] } as Step,
      { kind: "draw_cards", amount: 1, who: "you" } as Step
    ]);
    const t = fam({ "Mode Spell": modeSpell });
    t.give("p1", "Island", "battlefield"); t.give("p1", "Fill A", "library");
    cast(t, t.give("p1", "Mode Spell", "hand"));
    const res = stack(t);
    expect(res.pending).toMatchObject({ kind: "choose_option", min: 1, max: 1 });
    expect(res.pending!.options.map((o) => o.id)).toEqual(["left", "right"]);
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: ["up"] } }).error?.code).toBe("invalid_choice");
    const done = t.answer(res, { ids: ["right"] });
    expect(done.events.find((e) => e.type === "option_chosen")).toMatchObject({ option: "right" });
    expect(t.p("p1").hand).toHaveLength(1);
  });

  it("a remembered mode is stored on the source permanent", () => {
    const rememberer = mk("Rememberer", { manaCost: "{1}", types: ["enchantment"] }, [{
      id: "a1", kind: "triggered", text: "When this enters, choose left or right.", trigger: { event: "etb", subject: "self" },
      steps: [{ kind: "choose", choice: "mode", options: ["left", "right"], remember: true } as Step]
    }]);
    const t = fam({ Rememberer: rememberer });
    t.give("p1", "Island", "battlefield");
    cast(t, t.give("p1", "Rememberer", "hand"));
    t.resolveTop();
    const res = t.resolveTop();
    const perm = t.state.battlefield.find((id) => t.obj(id).cardName === "Rememberer")!;
    t.answer(res, { ids: ["left"] });
    expect(t.obj(perm).chosen?.mode).toBe("left");
  });

  it("choose a color keeps working (exclude)", () => {
    const colorSpell = sorcery("Color Spell", "{U}", [{ kind: "choose", id: "c1", choice: "color", exclude: ["white"] } as Step]);
    const t = fam({ "Color Spell": colorSpell });
    t.give("p1", "Island", "battlefield");
    cast(t, t.give("p1", "Color Spell", "hand"));
    const res = stack(t);
    expect(res.pending).toMatchObject({ kind: "choose_color" });
    expect(res.pending!.options.map((o) => o.id)).toEqual(["U", "B", "R", "G"]);
  });

  it("choose a creature you control, optional upTo, then act on the saved choice (target: chosen)", () => {
    const smite = sorcery("Pick And Bounce", "{U}", [
      { kind: "choose", from: { types: ["creature"], controller: "you", zone: "battlefield" }, count: 1, upTo: true, saveAs: "chosen" } as Step,
      { kind: "bounce_target", target: "chosen" } as Step
    ]);
    const t = fam({ "Pick And Bounce": smite });
    t.give("p1", "Island", "battlefield");
    const a = t.give("p1", "Fill A", "battlefield"); const b = t.give("p1", "Fill B", "battlefield"); t.give("p2", "Fill C", "battlefield");
    cast(t, t.give("p1", "Pick And Bounce", "hand"));
    const res = stack(t);
    expect(res.pending).toMatchObject({ kind: "choose_cards", min: 0, max: 1 });
    expect(res.pending!.options.map((o) => o.id).sort()).toEqual([a, b].sort()); // only my creatures
    t.answer(res, { ids: [b] });
    expect(t.obj(b).zone).toBe("hand");
    expect(t.obj(a).zone).toBe("battlefield");
  });

  it("choosing nothing from an 'up to' choice does nothing", () => {
    const smite = sorcery("Pick And Bounce", "{U}", [
      { kind: "choose", from: { types: ["creature"], controller: "you", zone: "battlefield" }, count: 1, upTo: true, saveAs: "chosen" } as Step,
      { kind: "bounce_target", target: "chosen" } as Step
    ]);
    const t = fam({ "Pick And Bounce": smite });
    t.give("p1", "Island", "battlefield");
    const a = t.give("p1", "Fill A", "battlefield"); t.give("p1", "Fill B", "battlefield");
    cast(t, t.give("p1", "Pick And Bounce", "hand"));
    t.answer(stack(t), { ids: [] });
    expect(t.obj(a).zone).toBe("battlefield");
  });

  it("no candidate: nothing is asked and the later steps see an empty choice", () => {
    const smite = sorcery("Pick And Bounce", "{U}", [
      { kind: "choose", from: { types: ["creature"], controller: "you", zone: "battlefield" }, count: 1, saveAs: "chosen" } as Step,
      { kind: "draw_cards", amount: 1, who: "you", condition: { when: "on_resolution", if: { check: "matches", obj: "chosen", filter: { types: ["creature"] } } } } as Step
    ]);
    const t = fam({ "Pick And Bounce": smite });
    t.give("p1", "Island", "battlefield"); t.give("p1", "Fill A", "library");
    cast(t, t.give("p1", "Pick And Bounce", "hand"));
    const res = stack(t);
    expect(res.pending).toBeUndefined();
    expect(t.p("p1").hand).toHaveLength(0);
  });

  it("candidates come from the CURRENT zones: a creature that just entered is offered, a card that just left the hand is not", () => {
    const seq = sorcery("Discard Then Pick", "{U}", [
      { kind: "create_tokens", tokenCount: 1, tokenName: "Bear", tokenPower: 2, tokenToughness: 2, tokenColors: ["green"], tokenTypeLine: "Creature - Bear", who: "you" } as Step,
      { kind: "choose", from: { types: ["creature"], controller: "you", zone: "battlefield" }, count: 1, saveAs: "chosen" } as Step
    ]);
    const t = fam({ "Discard Then Pick": seq });
    t.give("p1", "Island", "battlefield"); const a = t.give("p1", "Fill A", "battlefield");
    cast(t, t.give("p1", "Discard Then Pick", "hand"));
    const res = stack(t);
    expect(res.pending!.options).toHaveLength(2);
    expect(res.pending!.options.map((o) => o.id)).toContain(a);
  });

  it("a saved card that changed zone is a NEW object: the old reference no longer finds it, a saveAs on the move refreshes it", () => {
    const mkSpell = (saveMove: boolean) => sorcery("Twice", "{U}", [
      { kind: "choose", from: { zone: "hand", owner: "you" }, count: 1, saveAs: "chosen" } as Step,
      { kind: "move_card_zone", what: "chosen", moveTo: "graveyard", ...(saveMove ? { saveAs: "chosen" } : {}) } as Step,
      { kind: "move_card_zone", what: "chosen", moveTo: "exile" } as Step
    ]);
    for (const saveMove of [false, true]) {
      const t = fam({ Twice: mkSpell(saveMove) });
      t.give("p1", "Island", "battlefield");
      const a = t.give("p1", "Fill A", "hand"); t.give("p1", "Fill B", "hand");
      cast(t, t.give("p1", "Twice", "hand"));
      const res = stack(t);
      t.answer(res, { ids: [a] });
      expect(t.obj(a).zone).toBe(saveMove ? "exile" : "graveyard");
    }
  });
});
