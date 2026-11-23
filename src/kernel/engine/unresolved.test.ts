// Continue mode (Config.onUnsupported = "continue"): unsupported cards / abilities emit `unresolved` events and the game goes on.
import { describe, expect, it } from "vitest";
import { cast, castAndResolve, mk, setup, spell, unres } from "./unresolvedkit";

describe("continue mode: steps", () => {
  const odd = spell("Odd Spell", [
    { kind: "life_change", lifeDelta: 2, who: "you" },
    { kind: "goad_everything", target: "self" },
    { kind: "draw_cards", amount: 1, who: "you" }
  ], { text: "You gain 2 life. Goad everything. Draw a card." });

  it("an unsupported step is skipped with one event naming card, clause and capability; the other steps resolve", () => {
    const t = setup([odd]);
    t.give("p1", "Island", "library");
    const before = t.p("p1").life;
    const { events } = castAndResolve(t, "Odd Spell");
    const u = unres(events);
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ card: "Odd Spell", capability: "step:goad_everything", effect: "skipped", abilityKind: "spell_effect", clause: "You gain 2 life. Goad everything. Draw a card." });
    expect(u[0].message).toContain("Odd Spell: step goad everything not supported");
    expect(t.p("p1").life).toBe(before + 2);
    expect(t.p("p1").hand).toHaveLength(1); // the draw after the unsupported step still happened
    expect(t.obj(t.state.players[0].graveyard[0]).cardName).toBe("Odd Spell");
  });
  it("the game continues: the player keeps priority and can cast again", () => {
    const t = setup([odd]);
    t.give("p1", "Island", "library"); t.give("p1", "Island", "library");
    castAndResolve(t, "Odd Spell");
    expect(t.state.priority).toBe("p1");
    expect(t.state.gameOver).toBeNull();
    const second = castAndResolve(t, "Odd Spell");
    expect(unres(second.events)).toHaveLength(1);
  });
  it("strict mode (the default) still refuses the same card with error code unsupported", () => {
    const t = setup([odd], { mode: "error" });
    const id = t.give("p1", "Odd Spell", "hand");
    const res = t.do({ type: "castSpell", player: "p1", cardId: id });
    expect(res.error?.code).toBe("unsupported");
    expect(res.error?.capability).toContain("step:goad_everything");
    expect(unres(res.events)).toHaveLength(0);
    expect(t.obj(id).zone).toBe("hand");
  });
  it("an unknown field on a supported step skips that step only", () => {
    const t = setup([spell("Odd Draw", [{ kind: "draw_cards", amount: 1, who: "you", upTo: true }, { kind: "life_change", lifeDelta: 1, who: "you" }])]);
    t.give("p1", "Island", "library");
    const life = t.p("p1").life;
    const { events } = castAndResolve(t, "Odd Draw");
    expect(unres(events)[0].capability).toBe("field:draw_cards.upTo");
    expect(t.p("p1").life).toBe(life + 1);
    expect(t.p("p1").hand).toHaveLength(0);
  });
  it("an unsupported duration skips the step", () => {
    const t = setup([spell("Odd Duration", [{ kind: "grant_effect", target: "self", modify: [{ cant: "be_blocked" }], duration: "until_your_next_turn" }, { kind: "life_change", lifeDelta: 3, who: "you" }])]);
    const life = t.p("p1").life;
    const { events } = castAndResolve(t, "Odd Duration");
    expect(unres(events)[0].capability).toBe("duration:until_your_next_turn");
    expect(t.p("p1").life).toBe(life + 3);
  });
  it("a step with an unsupported predicate in its condition is skipped", () => {
    const t = setup([spell("Odd Condition", [{ kind: "life_change", lifeDelta: 5, who: "you", condition: { if: { check: "moon_phase" } } }, { kind: "life_change", lifeDelta: 1, who: "you" }])]);
    const life = t.p("p1").life;
    const { events } = castAndResolve(t, "Odd Condition");
    expect(unres(events)[0].capability).toBe("predicate:moon_phase");
    expect(t.p("p1").life).toBe(life + 1);
  });
  it("an unsupported step nested in a supported container is skipped alone", () => {
    const t = setup([spell("Odd Nest", [{ kind: "repeat_for_each", over: "each_opponent", steps: [{ kind: "goad_everything", target: "self" }, { kind: "life_change", lifeDelta: 10, who: "you" }] }])]);
    const life = t.p("p1").life;
    const { events } = castAndResolve(t, "Odd Nest");
    expect(unres(events).map((e) => e.capability)).toEqual(["step:goad_everything"]);
    expect(t.p("p1").life).toBe(life + 10);
  });
  it("the same unsupported step twice in one resolution is reported once", () => {
    const t = setup([spell("Twice", [{ kind: "goad_everything", target: "self" }, { kind: "goad_everything", target: "self" }, { kind: "life_change", lifeDelta: 1, who: "you" }])]);
    const { events } = castAndResolve(t, "Twice");
    expect(unres(events)).toHaveLength(1);
  });
  it("two different unsupported steps give two events", () => {
    const t = setup([spell("Two Kinds", [{ kind: "goad_everything", target: "self" }, { kind: "unmake_reality", target: "self" }])]);
    const { events } = castAndResolve(t, "Two Kinds");
    expect(unres(events).map((e) => e.capability).sort()).toEqual(["step:goad_everything", "step:unmake_reality"]);
  });
  it("a step that only turns out unsupported while running (a player reference with no player chosen) is skipped too", () => {
    const t = setup([spell("Which Player", [{ kind: "life_change", lifeDelta: -3, who: "target_player" }, { kind: "life_change", lifeDelta: 1, who: "you" }])], { players: ["p1", "p2", "p3"] });
    const life = t.p("p1").life;
    const { events } = castAndResolve(t, "Which Player");
    const u = unres(events);
    expect(u).toHaveLength(1);
    expect(u[0].capability).toBe("player_ref:target_player_missing");
    expect(u[0].effect).toBe("skipped");
    expect(t.p("p1").life).toBe(life + 1);
  });
  it("an unsupported step in a modal spell is skipped, the chosen mode's other steps run", () => {
    const m = mk("Odd Modal", ["instant"], [{ kind: "spell_effect", modes: { choose: { min: 1, max: 1 }, options: [{ id: "m1", text: "Do odd.", steps: [{ kind: "goad_everything", target: "self" }, { kind: "life_change", lifeDelta: 4, who: "you" }] }] } }]);
    const t = setup([m]);
    const life = t.p("p1").life;
    const { id, res } = cast(t, "Odd Modal");
    const evs = [...res.events];
    let cur = res;
    while (cur.pending) { cur = t.answer(cur, { ids: ["m1"] }); evs.push(...cur.events); }
    while (t.state.stack.length) evs.push(...t.resolveTop().events);
    expect(unres(evs)).toHaveLength(1);
    expect(t.p("p1").life).toBe(life + 4);
    expect(id).toBeTruthy();
  });
});

describe("continue mode: spell abilities and targets", () => {
  it("a spell whose targets use an unsupported filter is still cast; its effect is skipped and reported at cast time", () => {
    const c = spell("Odd Target", [{ kind: "destroy_target", target: "t1" }], { targets: [{ id: "t1", what: "object", filter: { weirdness: 3 }, count: { min: 1, max: 1 } }] });
    const t = setup([c]);
    const { id, res } = cast(t, "Odd Target");
    expect(unres(res.events)).toHaveLength(1);
    expect(unres(res.events)[0]).toMatchObject({ card: "Odd Target", effect: "skipped", capability: "filter:weirdness" });
    while (t.state.stack.length) t.resolveTop();
    expect(t.obj(id).zone).toBe("graveyard");
  });
  it("a declined spell ability is reported by name and the spell resolves to the graveyard", () => {
    const c = mk("Declined Spell", ["sorcery"], [{ kind: "spell_effect", text: "Do something odd.", declined: { reason: "too weird" }, steps: [] }]);
    const t = setup([c]);
    const { id, res } = cast(t, "Declined Spell");
    const u = unres(res.events);
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ capability: "declined", clause: "Do something odd." });
    while (t.state.stack.length) t.resolveTop();
    expect(t.obj(id).zone).toBe("graveyard");
  });
  it("a cast event is emitted before the unresolved report of the same cast", () => {
    const c = spell("Odd Target 2", [{ kind: "destroy_target", target: "t1" }], { targets: [{ id: "t1", what: "object", filter: { weirdness: 3 }, count: { min: 1, max: 1 } }] });
    const t = setup([c]);
    const { res } = cast(t, "Odd Target 2");
    const types = res.events.map((e) => e.type);
    expect(types.indexOf("unresolved")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("cast")).toBeGreaterThanOrEqual(0);
  });
});
